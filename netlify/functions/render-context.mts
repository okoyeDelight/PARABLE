import { getDeployStore, getStore } from '@netlify/blobs';
import { buildRenderContinuityContract, type ContinuitySnapshot } from './_lib/continuity-core.mts';

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
    directions: make('parable-directions'),
    adaptations: make('parable-adaptations')
  };
}

const clean = (value: unknown, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

async function directionsFor(projectId: string, storyVersion: string) {
  const directions = stores().directions;
  const prefix = 'project/' + projectId + '/' + storyVersion + '/';
  const { blobs } = await directions.list({ prefix });
  const items = await Promise.all(
    blobs.slice(0, 200).map(({ key }) => directions.get(key, { type: 'json' }) as Promise<Record<string, any> | null>)
  );
  return items.filter(Boolean) as Record<string, any>[];
}

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const projectId = clean(url.searchParams.get('projectId'), 96);
  const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
  const sceneId = clean(url.searchParams.get('sceneId'), 96);
  const shotId = clean(url.searchParams.get('shotId'), 96);

  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);
  if (storyVersion && !safeId(storyVersion)) return json({ error: 'Invalid storyVersion.' }, 400);
  if (sceneId && !safeId(sceneId)) return json({ error: 'Invalid sceneId.' }, 400);
  if (shotId && !safeId(shotId)) return json({ error: 'Invalid shotId.' }, 400);

  const s = stores();
  const [continuity, adaptation] = await Promise.all([
    s.continuity.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<ContinuitySnapshot | null>,
    s.adaptations.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>
  ]);

  if (!continuity) {
    return json({
      error: 'Continuity has not been established for this project. Run /api/scene-state first.'
    }, 409);
  }

  const resolvedStoryVersion = storyVersion || continuity.story_version || adaptation?.story_version || 'story_unknown';
  const resolvedSceneId = sceneId || continuity.last_scene_id || '';
  if (!resolvedSceneId) {
    return json({
      error: 'No scene has passed through the Continuity Brain yet.'
    }, 409);
  }

  const sceneState = await s.sceneStates.get(
    'project/' + projectId + '/' + resolvedStoryVersion + '/' + resolvedSceneId,
    { type: 'json' }
  ) as Record<string, any> | null;

  if (!sceneState) {
    return json({
      error: 'This scene has not been checked by PARABLE Continuity Brain.',
      project_id: projectId,
      story_version: resolvedStoryVersion,
      scene_id: resolvedSceneId,
      can_render: false
    }, 409);
  }

  const continuityContract = buildRenderContinuityContract(continuity, resolvedSceneId);
  const directions = await directionsFor(projectId, resolvedStoryVersion);
  const directionByShot = Object.fromEntries(directions.map((item) => [String(item.shot_id || ''), item]));

  const productionBible = adaptation?.production_bible || {};
  const shotPlan = Array.isArray(adaptation?.shot_plan)
    ? adaptation.shot_plan
    : Array.isArray(productionBible?.shot_plan)
      ? productionBible.shot_plan
      : [];

  const filteredShots = shotId
    ? shotPlan.filter((shot: any) => String(shot?.id || '') === shotId)
    : shotPlan;

  if (shotId && filteredShots.length === 0) {
    return json({ error: 'The requested shotId does not exist in the latest adaptation.' }, 404);
  }

  const sceneBlockers = [
    ...(Array.isArray(sceneState?.warnings) ? sceneState.warnings : []),
    ...(Array.isArray(continuityContract?.hard_blockers) ? continuityContract.hard_blockers : [])
  ].filter((warning: any, index: number, all: any[]) =>
    warning?.severity === 'blocker' &&
    all.findIndex((other) =>
      other?.code === warning?.code &&
      other?.entity_id === warning?.entity_id &&
      other?.field === warning?.field &&
      other?.scene_id === warning?.scene_id
    ) === index
  );

  const packages = filteredShots.map((shot: any) => {
    const id = String(shot?.id || '');
    const direction = directionByShot[id] || null;
    return {
      render_package_version: 'parable-render-handoff-v1',
      project_id: projectId,
      story_version: resolvedStoryVersion,
      scene_id: resolvedSceneId,
      shot_id: id || null,
      shot: {
        ...shot,
        ...(direction ? {
          lens_mm: direction.lens_mm ?? shot?.lens_mm,
          motion: direction.motion || shot?.motion,
          lighting: direction.lighting || shot?.lighting,
          performance: direction.performance || shot?.performance,
          blocking: direction.blocking || shot?.blocking
        } : {})
      },
      continuity: continuityContract,
      scene_render_notes: sceneState?.render_notes || {},
      scene_uncertainties: sceneState?.uncertainties || [],
      hard_constraints: {
        preserve_identity: true,
        preserve_wardrobe: true,
        preserve_injuries: true,
        preserve_props: true,
        preserve_screen_geography: true,
        preserve_character_knowledge: true,
        no_unmarked_state_changes: true
      },
      can_render: sceneBlockers.length === 0 && Boolean(sceneState?.can_render),
      blockers: sceneBlockers,
      human_review_recommended: Boolean(sceneState?.requires_human_review)
    };
  });

  const noShotPlan = packages.length === 0;
  const canRender = !noShotPlan && packages.every((item) => item.can_render);

  return json({
    project_id: projectId,
    story_version: resolvedStoryVersion,
    scene_id: resolvedSceneId,
    continuity_gate: sceneBlockers.length ? 'blocked' : 'passed',
    can_render: canRender,
    human_review_recommended: Boolean(sceneState?.requires_human_review),
    blockers: sceneBlockers,
    package_count: packages.length,
    packages,
    note: noShotPlan
      ? 'Continuity is ready, but no shot plan exists in the latest adaptation yet.'
      : 'These packages are the renderer boundary. A video/image renderer should consume them instead of regenerating scene state from scratch.'
  });
};

export const config = {
  path: '/api/render-context',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
