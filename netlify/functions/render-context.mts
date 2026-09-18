import { getDeployStore, getStore } from '@netlify/blobs';
import { buildRenderContinuityContract, upgradeContinuitySnapshot, type ContinuitySnapshot } from './_lib/continuity-core.mts';

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
    shotStates: make('parable-shot-states'),
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
  const [rawContinuity, adaptation] = await Promise.all([
    s.continuity.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<ContinuitySnapshot | null>,
    s.adaptations.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>
  ]);

  if (!rawContinuity) {
    return json({ error: 'Continuity has not been established. Run /api/scene-state first.' }, 409);
  }

  const continuity = upgradeContinuitySnapshot(rawContinuity);
  const resolvedStoryVersion = storyVersion || continuity.story_version || adaptation?.story_version || 'story_unknown';
  const resolvedSceneId = sceneId || continuity.last_scene_id || '';
  if (!resolvedSceneId) return json({ error: 'No scene has passed through Continuity Brain.' }, 409);

  const sceneState = await s.sceneStates.get(
    'project/' + projectId + '/' + resolvedStoryVersion + '/' + resolvedSceneId,
    { type: 'json' }
  ) as Record<string, any> | null;

  if (!sceneState) {
    return json({
      error: 'This scene has not been checked by PARABLE Continuity Brain.',
      can_render: false
    }, 409);
  }

  const directions = await directionsFor(projectId, resolvedStoryVersion);
  const directionByShot = Object.fromEntries(directions.map((item) => [String(item.shot_id || ''), item]));
  const bible = adaptation?.production_bible || {};
  const plan = Array.isArray(adaptation?.shot_plan)
    ? adaptation.shot_plan
    : Array.isArray(bible?.shot_plan)
      ? bible.shot_plan
      : [];

  const filteredShots = shotId
    ? plan.filter((shot: any) => String(shot?.id || '') === shotId)
    : plan;

  if (shotId && !filteredShots.length) return json({ error: 'shotId does not exist in the latest shot plan.' }, 404);

  const sceneContract = buildRenderContinuityContract(continuity, resolvedSceneId);
  const sceneBlockers = [
    ...(Array.isArray(sceneState?.warnings) ? sceneState.warnings : []),
    ...(Array.isArray(sceneContract?.hard_blockers) ? sceneContract.hard_blockers : [])
  ].filter((warning: any) => warning?.severity === 'blocker');

  const packages = await Promise.all(filteredShots.map(async (shot: any) => {
    const id = String(shot?.id || '');
    const direction = directionByShot[id] || null;
    const shotState = id
      ? await s.shotStates.get(
          'project/' + projectId + '/' + resolvedStoryVersion + '/' + resolvedSceneId + '/' + id,
          { type: 'json' }
        ) as Record<string, any> | null
      : null;

    const shotBlockers = [
      ...sceneBlockers,
      ...(Array.isArray(shotState?.warnings) ? shotState.warnings : [])
    ].filter((warning: any) => warning?.severity === 'blocker');

    const checked = Boolean(shotState);
    const continuityBefore = shotState?.render_contract_before || sceneContract;
    const continuityAfter = shotState?.render_contract_after || sceneContract;

    return {
      render_package_version: 'parable-render-handoff-v2',
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
      shot_continuity_status: checked ? 'checked' : 'unchecked',
      continuity_before: continuityBefore,
      continuity_after: continuityAfter,
      shot_transitions: shotState?.extracted_shot_state || null,
      scene_render_notes: sceneState?.render_notes || {},
      shot_render_notes: shotState?.render_notes || {},
      hard_constraints: {
        preserve_identity: true,
        preserve_wardrobe: true,
        preserve_injuries: true,
        preserve_prop_ownership: true,
        preserve_prop_location: true,
        preserve_screen_geography: true,
        preserve_character_knowledge: true,
        no_unmarked_state_changes: true
      },
      can_render: checked && Boolean(sceneState?.can_render) && Boolean(shotState?.can_render) && shotBlockers.length === 0,
      blockers: shotBlockers,
      human_review_recommended: Boolean(sceneState?.requires_human_review || shotState?.requires_human_review)
    };
  }));

  const uncheckedShots = packages.filter((item) => item.shot_continuity_status === 'unchecked').map((item) => item.shot_id);
  const noShotPlan = packages.length === 0;
  const canRender = !noShotPlan && packages.every((item) => item.can_render);

  return json({
    project_id: projectId,
    story_version: resolvedStoryVersion,
    scene_id: resolvedSceneId,
    continuity_gate: sceneBlockers.length ? 'blocked' : uncheckedShots.length ? 'awaiting-shot-continuity' : 'passed',
    can_render: canRender,
    blockers: sceneBlockers,
    unchecked_shots: uncheckedShots,
    package_count: packages.length,
    packages,
    note: noShotPlan
      ? 'Continuity is ready, but no shot plan exists.'
      : uncheckedShots.length
        ? 'Run /api/shot-state in shot order for each unchecked shot before rendering.'
        : 'Every package now carries pre-shot state, in-shot transitions and post-shot state.'
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
