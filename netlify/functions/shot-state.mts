import { getDeployStore, getStore } from '@netlify/blobs';
import {
  buildRenderContinuityContract,
  compactContinuityContext,
  evaluateAndApplyScene,
  upgradeContinuitySnapshot,
  type ContinuitySnapshot
} from './_lib/continuity-core.mts';
import { runContinuityExtraction } from './_lib/continuity-ai.mts';
import { readAuthoritativeProjectState } from './_lib/project-artifacts.mts';
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
    sceneStates: make('parable-scene-states'),
    shotStates: make('parable-shot-states'),
    adaptations: make('parable-adaptations'),
    directions: make('parable-directions')
  };
}

const clean = (value: unknown, max = 4000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

function shotPlan(adaptation: Record<string, any> | null) {
  const bible = adaptation?.production_bible || {};
  return Array.isArray(adaptation?.shot_plan)
    ? adaptation.shot_plan
    : Array.isArray(bible?.shot_plan)
      ? bible.shot_plan
      : [];
}

async function getDirection(projectId: string, storyVersion: string, shotId: string) {
  return stores().directions.get(
    'project/' + projectId + '/' + storyVersion + '/' + shotId,
    { type: 'json' }
  ) as Promise<Record<string, any> | null>;
}

function shotText(shot: Record<string, any>, direction: Record<string, any> | null) {
  const parts = [
    clean(shot?.beat, 1400),
    clean(direction?.blocking || shot?.blocking, 700),
    clean(direction?.performance || shot?.performance, 700),
    clean(direction?.motion || shot?.motion, 300),
    clean(direction?.lighting || shot?.lighting, 300),
    clean(shot?.continuity_notes, 700)
  ].filter(Boolean);
  return parts.join('. ');
}

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const s = stores();

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
    const sceneId = clean(url.searchParams.get('sceneId'), 96);
    const shotId = clean(url.searchParams.get('shotId'), 96);

    if (![projectId, storyVersion, sceneId, shotId].every((value) => value && safeId(value))) {
      return json({ error: 'Valid projectId, storyVersion, sceneId and shotId are required.' }, 400);
    }

    try {
      await authorizeProject(request, projectId, 'project:read');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }

    const value = await s.shotStates.get(
      'project/' + projectId + '/' + storyVersion + '/' + sceneId + '/' + shotId,
      { type: 'json' }
    ) as Record<string, any> | null;

    if (!value) return json({ error: 'Shot continuity state was not found.' }, 404);
    return json(value);
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const sceneId = clean(body.sceneId, 96);
  const shotId = clean(body.shotId, 96);

  if (![projectId, storyVersion, sceneId, shotId].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion, sceneId and shotId are required.' }, 400);
  }

  try {
    await authorizeProject(request, projectId, 'project:edit');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  const startingRevision = await readProjectRevision(projectId);
  const explicitExpectedRevision = Number.isFinite(Number(body.expectedProjectRevision))
    ? Number(body.expectedProjectRevision)
    : null;

  if (explicitExpectedRevision !== null && explicitExpectedRevision !== startingRevision.revision) {
    return json({
      error: 'The project changed before shot continuity started.',
      code: 'PROJECT_REVISION_CONFLICT',
      expected_revision: explicitExpectedRevision,
      current_revision: startingRevision.revision,
      retryable: true
    }, 409);
  }

  const [sceneState, authoritativeAdaptation, cachedVersionAdaptation, direction] = await Promise.all([
    s.sceneStates.get('project/' + projectId + '/' + storyVersion + '/' + sceneId, { type: 'json' }) as Promise<Record<string, any> | null>,
    readAuthoritativeProjectState<Record<string, any>>(projectId, 'adaptation:latest'),
    s.adaptations.get('project/' + projectId + '/versions/' + storyVersion, { type: 'json' }) as Promise<Record<string, any> | null>,
    getDirection(projectId, storyVersion, shotId)
  ]);

  const adaptation = authoritativeAdaptation?.value?.story_version === storyVersion
    ? authoritativeAdaptation.value
    : cachedVersionAdaptation;

  if (!sceneState) {
    return json({
      error: 'The scene must pass through /api/scene-state before per-shot continuity can be built.'
    }, 409);
  }

  const shots = shotPlan(adaptation);
  const shotIndex = shots.findIndex((shot: any) => String(shot?.id || '') === shotId);
  if (shotIndex < 0) return json({ error: 'shotId was not found in the latest shot plan.' }, 404);

  const shot = shots[shotIndex] as Record<string, any>;
  let continuityBefore: ContinuitySnapshot | null = null;
  let previousShotId: string | null = null;

  if (shotIndex === 0) {
    continuityBefore = sceneState.continuity_before_snapshot as ContinuitySnapshot | null;
  } else {
    previousShotId = String(shots[shotIndex - 1]?.id || '');
    const previous = await s.shotStates.get(
      'project/' + projectId + '/' + storyVersion + '/' + sceneId + '/' + previousShotId,
      { type: 'json' }
    ) as Record<string, any> | null;

    if (!previous?.continuity_after_snapshot) {
      return json({
        error: 'Shot continuity must be processed in order.',
        required_previous_shot: previousShotId,
        requested_shot: shotId
      }, 409);
    }
    continuityBefore = previous.continuity_after_snapshot as ContinuitySnapshot;
  }

  if (!continuityBefore) {
    return json({
      error: 'The scene checkpoint does not contain a pre-scene continuity snapshot. Re-run /api/scene-state on the current V3 build.'
    }, 409);
  }

  continuityBefore = upgradeContinuitySnapshot(continuityBefore);
  const text = clean(body.shotText, 6000) || shotText(shot, direction);
  if (text.length < 8) return json({ error: 'No usable shot text was found.' }, 400);

  const extraction = await runContinuityExtraction({
    projectId,
    storyVersion,
    sceneId,
    sceneIndex: Number(sceneState.scene_index || 1),
    shotId,
    heading: clean(sceneState.heading, 240),
    sceneText: text,
    continuity: continuityBefore
  });

  let lease: ProjectMutationLease | null = null;
  try {
    lease = await acquireProjectMutation({
      projectId,
      mutationType: 'shot-continuity',
      expectedRevision: explicitExpectedRevision ?? startingRevision.revision,
      ttlMs: 30000
    });
  } catch (error) {
    const handled = projectMutationErrorResponse(error);
    if (handled) {
      return json({
        ...handled.body,
        retryable: true,
        scene_id: sceneId,
        shot_id: shotId
      }, handled.status);
    }
    throw error;
  }

  const beforeContract = buildRenderContinuityContract(continuityBefore, sceneId, shotId);
  const evaluated = evaluateAndApplyScene(continuityBefore, extraction.scene, { apply: true });
  const continuityAfter = evaluated.snapshot;
  const afterContract = buildRenderContinuityContract(continuityAfter, sceneId, shotId);

  const result = {
    id: 'shot_state_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    project_id: projectId,
    story_version: storyVersion,
    scene_id: sceneId,
    shot_id: shotId,
    shot_index: shotIndex + 1,
    previous_shot_id: previousShotId,
    shot,
    direction_override: direction,
    source_text: text,
    extractor: extraction.engine,
    extracted_shot_state: extraction.scene,
    render_notes: extraction.render_notes,
    uncertainties: extraction.uncertainties,
    warnings: evaluated.warnings,
    can_render: evaluated.can_render,
    requires_human_review: extraction.engine.mode !== 'model' || extraction.uncertainties.length > 0,
    continuity_before_snapshot: continuityBefore,
    continuity_after_snapshot: continuityAfter,
    continuity_before: compactContinuityContext(continuityBefore),
    continuity_after: compactContinuityContext(continuityAfter),
    render_contract_before: beforeContract,
    render_contract_after: afterContract,
    created_at: new Date().toISOString()
  };

  try {
    await s.shotStates.setJSON(
      'project/' + projectId + '/' + storyVersion + '/' + sceneId + '/' + shotId,
      result
    );

    if (!lease) throw new Error('Shot continuity mutation lease was not acquired.');
    const committed = await commitProjectMutation(lease, {
      story_version: storyVersion,
      scene_id: sceneId,
      shot_id: shotId,
      shot_index: shotIndex + 1,
      can_render: evaluated.can_render,
      warning_count: evaluated.warnings.length
    });

    (result as any).project_revision = committed.revision;
    (result as any).mutation_id = committed.mutation_id;
    return json(result, 201);
  } catch (error) {
    if (lease) await abortProjectMutation(lease).catch(() => false);
    const handled = projectMutationErrorResponse(error);
    if (handled) return json({ ...handled.body, retryable: true }, handled.status);
    throw error;
  }
};

export const config = {
  path: '/api/shot-state',
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
