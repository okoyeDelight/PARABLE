import { getDeployStore, getStore } from '@netlify/blobs';
import { readAuthoritativeProjectState } from './_lib/project-artifacts.mts';
import {
  bootstrapContinuity,
  buildRenderContinuityContract,
  compactContinuityContext,
  evaluateAndApplyScene,
  upgradeContinuitySnapshot,
  type ContinuitySnapshot
} from './_lib/continuity-core.mts';
import { runContinuityExtraction } from './_lib/continuity-ai.mts';
import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  readProjectRevision,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

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
    sceneStates: make('parable-scene-states'),
    adaptations: make('parable-adaptations'),
    understandings: make('parable-understandings'),
    projects: make('parable-projects')
  };
}

const clean = (value: unknown, max = 120000) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const oneLine = (value: unknown, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

async function adaptationForVersion(projectId: string, storyVersion?: string | null) {
  const s = stores();
  const authoritative = await readAuthoritativeProjectState<Record<string, any>>(projectId, 'adaptation:latest');
  if (authoritative?.value && (!storyVersion || authoritative.value.story_version === storyVersion)) {
    return authoritative.value;
  }

  if (storyVersion) {
    const versioned = await s.adaptations.get(
      'project/' + projectId + '/versions/' + storyVersion,
      { type: 'json' }
    ) as Record<string, any> | null;
    if (versioned) return versioned;
  }

  return s.adaptations.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>;
}

async function productionBibleForVersion(projectId: string, storyVersion: string) {
  const s = stores();
  const [adaptation, understanding] = await Promise.all([
    adaptationForVersion(projectId, storyVersion),
    s.understandings.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>
  ]);

  if (adaptation?.story_version === storyVersion && adaptation?.production_bible) {
    return adaptation.production_bible;
  }

  if (understanding?.story_version === storyVersion) {
    return understanding?.understanding || understanding;
  }

  return null;
}

function screenplayText(adaptation: Record<string, any> | null) {
  const screenplay = adaptation?.screenplay || adaptation?.production_bible?.screenplay || null;
  if (!screenplay) return null;
  const heading = oneLine(screenplay.heading, 240);
  const beats = Array.isArray(screenplay.beats) ? screenplay.beats : [];
  const text = beats.map((beat: any) => {
    const speaker = oneLine(beat?.speaker, 120);
    const body = clean(beat?.text, 1800);
    if (!body) return '';
    return speaker ? speaker + ': ' + body : body;
  }).filter(Boolean).join('\n');
  return { heading, text };
}

async function loadOrBootstrap(projectId: string, storyVersion: string, bodyBible?: unknown) {
  const s = stores();
  const versionKey = 'project/' + projectId + '/versions/' + storyVersion + '/latest';
  const [versionSnapshot, latestSnapshot] = await Promise.all([
    s.continuity.get(versionKey, { type: 'json' }) as Promise<ContinuitySnapshot | null>,
    s.continuity.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<ContinuitySnapshot | null>
  ]);

  if (versionSnapshot) return upgradeContinuitySnapshot(versionSnapshot);
  if (latestSnapshot?.story_version === storyVersion) return upgradeContinuitySnapshot(latestSnapshot);

  const bible = bodyBible && typeof bodyBible === 'object'
    ? bodyBible as Record<string, any>
    : await productionBibleForVersion(projectId, storyVersion);
  if (!bible) return null;

  return bootstrapContinuity({
    projectId,
    storyVersion,
    productionBible: bible
  });
}

async function saveContinuity(snapshot: ContinuitySnapshot) {
  const s = stores();
  await Promise.all([
    s.continuity.setJSON('project/' + snapshot.project_id + '/latest', snapshot),
    s.continuity.setJSON('project/' + snapshot.project_id + '/versions/' + snapshot.story_version + '/latest', snapshot)
  ]);
}

export default async (request: Request) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = oneLine(url.searchParams.get('projectId'), 96);
    const storyVersion = oneLine(url.searchParams.get('storyVersion'), 96);
    const sceneId = oneLine(url.searchParams.get('sceneId'), 96);

    if (!projectId || !sceneId || !safeId(projectId) || !safeId(sceneId)) {
      return json({ error: 'A valid projectId and sceneId are required.' }, 400);
    }

    try {
      await authorizeProject(request, projectId, 'project:read');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }

    const key = storyVersion && safeId(storyVersion)
      ? 'project/' + projectId + '/' + storyVersion + '/' + sceneId
      : 'project/' + projectId + '/latest/' + sceneId;

    const value = await stores().sceneStates.get(key, { type: 'json' }) as Record<string, any> | null;
    if (!value) return json({ error: 'Scene continuity state was not found.' }, 404);
    return json(value);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = oneLine(body.projectId, 96);
  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

  try {
    await authorizeProject(request, projectId, 'project:edit');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  const s = stores();
  const startingRevision = await readProjectRevision(projectId);
  const explicitExpectedRevision = Number.isFinite(Number(body.expectedProjectRevision))
    ? Number(body.expectedProjectRevision)
    : null;

  if (explicitExpectedRevision !== null && explicitExpectedRevision !== startingRevision.revision) {
    return json({
      error: 'The project changed before scene continuity started.',
      code: 'PROJECT_REVISION_CONFLICT',
      expected_revision: explicitExpectedRevision,
      current_revision: startingRevision.revision,
      retryable: true
    }, 409);
  }

  const project = await s.projects.get('project/' + projectId, {
    type: 'json',
    consistency: 'strong'
  } as any) as Record<string, any> | null;

  const requestedStoryVersion = oneLine(body.storyVersion, 96);
  const latestAdaptation = await adaptationForVersion(projectId, requestedStoryVersion || null);

  const storyVersion = oneLine(
    requestedStoryVersion || project?.story_version || latestAdaptation?.story_version || 'story_unknown',
    96
  );
  if (!safeId(storyVersion)) return json({ error: 'Invalid storyVersion.' }, 400);

  const adaptation = latestAdaptation?.story_version === storyVersion
    ? latestAdaptation
    : await adaptationForVersion(projectId, storyVersion);

  const suppliedScene = body.scene && typeof body.scene === 'object' ? body.scene : {};
  const adapted = screenplayText(adaptation);

  const sceneIndex = Math.max(1, Math.floor(Number(suppliedScene.index || body.sceneIndex || 1) || 1));
  const sceneId = oneLine(suppliedScene.id || body.sceneId || ('scene_' + sceneIndex), 96);
  if (!safeId(sceneId)) return json({ error: 'Invalid sceneId.' }, 400);

  const heading = oneLine(suppliedScene.heading || body.heading || adapted?.heading || '', 240);
  const sceneText = clean(suppliedScene.text || body.sceneText || adapted?.text || '', 120000);
  if (sceneText.length < 10) {
    return json({
      error: 'No usable scene text was supplied and PARABLE could not derive one from the latest adaptation.'
    }, 400);
  }

  const mode = oneLine(body.mode || 'apply', 20).toLowerCase();
  if (!['apply', 'check'].includes(mode)) return json({ error: 'mode must be apply or check.' }, 400);

  const continuity = await loadOrBootstrap(projectId, storyVersion, body.productionBible);
  if (!continuity) {
    return json({
      error: 'PARABLE could not bootstrap continuity. Run Story Understanding / Adaptation first or supply productionBible.'
    }, 409);
  }

  const extraction = await runContinuityExtraction({
    projectId,
    storyVersion,
    sceneId,
    sceneIndex,
    heading,
    sceneText,
    continuity
  });

  let lease: ProjectMutationLease | null = null;
  let continuityBefore = upgradeContinuitySnapshot(continuity);

  if (mode === 'apply') {
    try {
      lease = await acquireProjectMutation({
        projectId,
        mutationType: 'scene-continuity',
        expectedRevision: explicitExpectedRevision ?? startingRevision.revision,
        ttlMs: 30000
      });

      const [versionLatest, globalLatest] = await Promise.all([
        s.continuity.get(
          'project/' + projectId + '/versions/' + storyVersion + '/latest',
          { type: 'json', consistency: 'strong' } as any
        ) as Promise<ContinuitySnapshot | null>,
        s.continuity.get('project/' + projectId + '/latest', {
          type: 'json',
          consistency: 'strong'
        } as any) as Promise<ContinuitySnapshot | null>
      ]);
      const latest = versionLatest || (globalLatest?.story_version === storyVersion ? globalLatest : null);
      if (latest) continuityBefore = upgradeContinuitySnapshot(latest);
    } catch (error) {
      const handled = projectMutationErrorResponse(error);
      if (handled) {
        return json({
          ...handled.body,
          retryable: true,
          scene_id: sceneId
        }, handled.status);
      }
      throw error;
    }
  }

  const evaluated = evaluateAndApplyScene(continuityBefore, extraction.scene, { apply: mode === 'apply' });
  const snapshot = evaluated.snapshot;
  const renderContract = buildRenderContinuityContract(snapshot, sceneId);

  const result = {
    id: 'scene_state_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    project_id: projectId,
    story_version: storyVersion,
    scene_id: sceneId,
    scene_index: sceneIndex,
    heading,
    source: body.sceneText || suppliedScene.text ? 'submitted-scene' : 'latest-adaptation',
    mode,
    extractor: extraction.engine,
    extracted_scene_state: extraction.scene,
    render_notes: extraction.render_notes,
    uncertainties: extraction.uncertainties,
    warnings: evaluated.warnings,
    can_render: evaluated.can_render,
    requires_human_review: extraction.engine.mode !== 'model' || extraction.uncertainties.length > 0,
    continuity_before_snapshot: continuityBefore,
    continuity_after_snapshot: snapshot,
    continuity_context: compactContinuityContext(snapshot),
    render_contract: renderContract,
    created_at: new Date().toISOString()
  };

  if (mode === 'apply') {
    try {
      await Promise.all([
        saveContinuity(snapshot),
        s.sceneStates.setJSON('project/' + projectId + '/' + storyVersion + '/' + sceneId, result),
        s.sceneStates.setJSON('project/' + projectId + '/latest/' + sceneId, result)
      ]);

      const latestProject = await s.projects.get('project/' + projectId, {
        type: 'json',
        consistency: 'strong'
      } as any) as Record<string, any> | null;

      if (latestProject) {
        await s.projects.setJSON('project/' + projectId, {
          ...latestProject,
          continuity_version: snapshot.schema_version,
          continuity_scene_cursor: snapshot.scene_cursor,
          continuity_last_scene_id: snapshot.last_scene_id,
          continuity_last_shot_id: snapshot.last_shot_id,
          continuity_warning_count: snapshot.warnings.length,
          status: evaluated.can_render ? 'continuity_ready' : 'continuity_review',
          progress: Math.max(Number(latestProject.progress || 0), evaluated.can_render ? 54 : 50),
          updated_at: new Date().toISOString()
        });
      }

      if (!lease) throw new Error('Scene continuity mutation lease was not acquired.');
      const committed = await commitProjectMutation(lease, {
        story_version: storyVersion,
        scene_id: sceneId,
        scene_index: sceneIndex,
        can_render: evaluated.can_render,
        warning_count: evaluated.warnings.length
      });
      (result as any).project_revision = committed.revision;
      (result as any).mutation_id = committed.mutation_id;
    } catch (error) {
      if (lease) await abortProjectMutation(lease).catch(() => false);
      const handled = projectMutationErrorResponse(error);
      if (handled) return json({ ...handled.body, retryable: true }, handled.status);
      throw error;
    }
  }

  return json(result, mode === 'apply' ? 201 : 200);
};

export const config = {
  path: '/api/scene-state',
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
