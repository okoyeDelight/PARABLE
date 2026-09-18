import { getDeployStore, getStore } from '@netlify/blobs';
import {
  bootstrapContinuity,
  compactContinuityContext,
  evaluateAndApplyScene,
  type ContinuitySnapshot,
  type SceneContinuityInput
} from './_lib/continuity-core.mts';
import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  readProjectRevision,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  const make = (name: string) => production
    ? getStore(name, { consistency: 'strong' })
    : getDeployStore(name);

  return {
    continuity: make('parable-continuity'),
    adaptations: make('parable-adaptations'),
    understandings: make('parable-understandings'),
    projects: make('parable-projects')
  };
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

async function resolveBible(projectId: string, bodyBible: unknown) {
  if (bodyBible && typeof bodyBible === 'object') return bodyBible as Record<string, any>;
  const { adaptations, understandings } = stores();
  const [adaptation, understanding] = await Promise.all([
    adaptations.get(`project/${projectId}/latest`, { type: 'json' }) as Promise<Record<string, any> | null>,
    understandings.get(`project/${projectId}/latest`, { type: 'json' }) as Promise<Record<string, any> | null>
  ]);
  return adaptation?.production_bible || understanding?.understanding || understanding || null;
}

async function loadLatest(projectId: string) {
  const { continuity } = stores();
  return continuity.get(`project/${projectId}/latest`, { type: 'json' }) as Promise<ContinuitySnapshot | null>;
}

async function saveSnapshot(snapshot: ContinuitySnapshot) {
  const { continuity, projects } = stores();
  const version = clean(snapshot.story_version) || 'story_unknown';
  await Promise.all([
    continuity.setJSON(`project/${snapshot.project_id}/latest`, snapshot),
    continuity.setJSON(`project/${snapshot.project_id}/versions/${version}/latest`, snapshot)
  ]);

  const project = await projects.get(`project/${snapshot.project_id}`, { type: 'json' }) as Record<string, any> | null;
  if (project) {
    await projects.setJSON(`project/${snapshot.project_id}`, {
      ...project,
      continuity_version: snapshot.schema_version,
      continuity_story_version: snapshot.story_version,
      continuity_scene_cursor: snapshot.scene_cursor,
      continuity_last_scene_id: snapshot.last_scene_id,
      continuity_warning_count: snapshot.warnings.length,
      status: snapshot.scene_cursor > 0 ? 'continuity_active' : project.status,
      progress: Math.max(Number(project.progress || 0), snapshot.scene_cursor > 0 ? 48 : 44),
      updated_at: new Date().toISOString()
    });
  }
}

export default async (request: Request) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'));
    const compact = url.searchParams.get('compact') === '1';
    if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

    const snapshot = await loadLatest(projectId);
    if (!snapshot) return json({ error: 'No continuity state exists for this project yet.' }, 404);

    return json(compact ? compactContinuityContext(snapshot) : snapshot);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId);
  const action = clean(body.action || 'apply_scene');
  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

  const startingRevision = await readProjectRevision(projectId);
  const explicitExpectedRevision = Number.isFinite(Number(body.expectedProjectRevision))
    ? Number(body.expectedProjectRevision)
    : null;

  if (explicitExpectedRevision !== null && explicitExpectedRevision !== startingRevision.revision) {
    return json({
      error: 'The project changed before continuity processing started.',
      code: 'PROJECT_REVISION_CONFLICT',
      expected_revision: explicitExpectedRevision,
      current_revision: startingRevision.revision,
      retryable: true
    }, 409);
  }

  if (action === 'bootstrap') {
    const bible = await resolveBible(projectId, body.productionBible);
    if (!bible) return json({
      error: 'No Production Bible or Story Understanding was found. Run /api/understand or /api/adapt first, or supply productionBible.'
    }, 409);

    const project = await stores().projects.get(`project/${projectId}`, { type: 'json' }) as Record<string, any> | null;
    const storyVersion = clean(body.storyVersion || project?.story_version || bible?.story_version || 'story_unknown');
    const snapshot = bootstrapContinuity({
      projectId,
      storyVersion,
      productionBible: bible as Record<string, any>
    });

    let lease: ProjectMutationLease | null = null;
    try {
      lease = await acquireProjectMutation({
        projectId,
        mutationType: 'continuity-bootstrap',
        expectedRevision: explicitExpectedRevision ?? startingRevision.revision,
        ttlMs: 30000
      });

      await saveSnapshot(snapshot);
      const committed = await commitProjectMutation(lease, {
        story_version: storyVersion,
        action: 'bootstrap'
      });

      return json({
        action: 'bootstrap',
        continuity: snapshot,
        context: compactContinuityContext(snapshot),
        project_revision: committed.revision,
        mutation_id: committed.mutation_id
      }, 201);
    } catch (error) {
      if (lease) await abortProjectMutation(lease).catch(() => false);
      const handled = projectMutationErrorResponse(error);
      if (handled) return json({ ...handled.body, retryable: true }, handled.status);
      throw error;
    }
  }

  if (!['apply_scene', 'check_scene'].includes(action)) {
    return json({ error: 'action must be bootstrap, apply_scene, or check_scene.' }, 400);
  }

  let current = await loadLatest(projectId);
  if (!current) {
    const bible = await resolveBible(projectId, body.productionBible);
    if (!bible) return json({
      error: 'Continuity has not been bootstrapped and no Production Bible is available.'
    }, 409);
    const project = await stores().projects.get(`project/${projectId}`, { type: 'json' }) as Record<string, any> | null;
    current = bootstrapContinuity({
      projectId,
      storyVersion: clean(body.storyVersion || project?.story_version || 'story_unknown'),
      productionBible: bible as Record<string, any>
    });
  }

  const scene = (body.scene || {}) as SceneContinuityInput;
  const result = evaluateAndApplyScene(current, scene, { apply: action === 'apply_scene' });

  if (action === 'apply_scene') {
    let lease: ProjectMutationLease | null = null;
    try {
      lease = await acquireProjectMutation({
        projectId,
        mutationType: 'continuity-scene',
        expectedRevision: explicitExpectedRevision ?? startingRevision.revision,
        ttlMs: 30000
      });

      const latest = await loadLatest(projectId);
      const rebased = latest
        ? evaluateAndApplyScene(latest, scene, { apply: true })
        : result;

      await saveSnapshot(rebased.snapshot);
      const committed = await commitProjectMutation(lease, {
        story_version: rebased.snapshot.story_version,
        scene_id: rebased.scene_id,
        can_render: rebased.can_render,
        warning_count: rebased.warnings.length
      });

      return json({
        action,
        scene_id: rebased.scene_id,
        can_render: rebased.can_render,
        warnings: rebased.warnings,
        continuity: rebased.snapshot,
        context: compactContinuityContext(rebased.snapshot),
        project_revision: committed.revision,
        mutation_id: committed.mutation_id
      }, 201);
    } catch (error) {
      if (lease) await abortProjectMutation(lease).catch(() => false);
      const handled = projectMutationErrorResponse(error);
      if (handled) return json({ ...handled.body, retryable: true }, handled.status);
      throw error;
    }
  }

  return json({
    action,
    scene_id: result.scene_id,
    can_render: result.can_render,
    warnings: result.warnings,
    context: compactContinuityContext(result.snapshot)
  }, 200);
};

export const config = {
  path: '/api/continuity',
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
