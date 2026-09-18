import { getDeployStore, getStore } from '@netlify/blobs';
import { buildRenderContinuityContract, upgradeContinuitySnapshot, type ContinuitySnapshot } from './_lib/continuity-core.mts';
import { readAuthoritativeProjectState } from './_lib/project-artifacts.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';
import { signedMotionFrameUrl } from './_lib/motion-frame-assets.mts';
import {
  buildSceneSpatialPlan,
  spatialContractForShot,
  type SceneSpatialPlan
} from './_lib/spatial-continuity.mts';
import { transactionalStateMode } from './_lib/transactional-state.mts';

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

function shotContinuityBreak(shot: Record<string, any>) {
  if (shot?.continuity_break === true || shot?.sequence_reset === true) return true;
  const text = [
    shot?.beat,
    shot?.purpose,
    shot?.dramatic_purpose,
    shot?.blocking,
    shot?.continuity_notes,
    shot?.transition
  ].map((value) => clean(value, 500).toLowerCase()).join(' ');

  return /\b(cutaway|insert shot|time jump|later that|earlier that|meanwhile|elsewhere|new location|montage|flashback|flash forward|dream sequence)\b/.test(text);
}

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

  try {
    await authorizeProject(request, projectId, 'project:read');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  const s = stores();
  const authoritativeAdaptation = await readAuthoritativeProjectState<Record<string, any>>(projectId, 'adaptation:latest');
  const [latestContinuity, cachedLatestAdaptation] = await Promise.all([
    s.continuity.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<ContinuitySnapshot | null>,
    s.adaptations.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>
  ]);

  let adaptation = authoritativeAdaptation?.value || cachedLatestAdaptation;
  const resolvedStoryVersion = storyVersion || adaptation?.story_version || latestContinuity?.story_version || 'story_unknown';

  if (adaptation?.story_version && adaptation.story_version !== resolvedStoryVersion) {
    adaptation = await s.adaptations.get(
      'project/' + projectId + '/versions/' + resolvedStoryVersion,
      { type: 'json' }
    ) as Record<string, any> | null;
  }

  const [authoritativeContinuity, versionContinuity] = await Promise.all([
    readAuthoritativeProjectState<ContinuitySnapshot>(
      projectId,
      'continuity:' + resolvedStoryVersion + ':latest'
    ),
    s.continuity.get(
      'project/' + projectId + '/versions/' + resolvedStoryVersion + '/latest',
      { type: 'json' }
    ) as Promise<ContinuitySnapshot | null>
  ]);

  // PostgreSQL is the authority after a scene mutation commits. Blob continuity
  // is only a cache/archive and can legitimately lag for a few moments.
  const rawContinuity = authoritativeContinuity?.value || versionContinuity || (
    transactionalStateMode() !== 'postgres' && latestContinuity?.story_version === resolvedStoryVersion
      ? latestContinuity
      : null
  );

  if (!rawContinuity) {
    return json({
      error: 'Continuity has not been established for this story version. Run /api/scene-state first.',
      story_version: resolvedStoryVersion
    }, 409);
  }

  const continuity = upgradeContinuitySnapshot(rawContinuity);
  const resolvedSceneId = sceneId || continuity.last_scene_id || '';
  if (!resolvedSceneId) return json({ error: 'No scene has passed through Continuity Brain.' }, 409);

  const [authoritativeSceneState, cachedSceneState] = await Promise.all([
    readAuthoritativeProjectState<Record<string, any>>(
      projectId,
      'scene-state:' + resolvedStoryVersion + ':' + resolvedSceneId
    ),
    s.sceneStates.get(
      'project/' + projectId + '/' + resolvedStoryVersion + '/' + resolvedSceneId,
      { type: 'json' }
    ) as Promise<Record<string, any> | null>
  ]);
  const sceneState = authoritativeSceneState?.value || (
    transactionalStateMode() === 'postgres' ? null : cachedSceneState
  );

  if (!sceneState) {
    return json({
      error: transactionalStateMode() === 'postgres'
        ? 'Authoritative scene continuity is missing; cached Blob state cannot authorize rendering.'
        : 'This scene has not been checked by PARABLE Continuity Brain.',
      code: transactionalStateMode() === 'postgres'
        ? 'AUTHORITATIVE_SCENE_STATE_REQUIRED'
        : 'SCENE_CONTINUITY_REQUIRED',
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

  let sceneContract = sceneState?.render_contract || null;
  if (!sceneContract) {
    if (continuity.last_scene_id !== resolvedSceneId) {
      return json({
        error: 'This older scene does not contain a stored as-of continuity contract. Re-run /api/scene-state for this scene before rendering so future state cannot leak backwards.',
        code: 'SCENE_AS_OF_STATE_REQUIRED',
        scene_id: resolvedSceneId,
        continuity_last_scene_id: continuity.last_scene_id
      }, 409);
    }
    sceneContract = buildRenderContinuityContract(continuity, resolvedSceneId);
  }

  const sceneBlockers = [
    ...(Array.isArray(sceneState?.warnings) ? sceneState.warnings : []),
    ...(Array.isArray(sceneContract?.hard_blockers) ? sceneContract.hard_blockers : [])
  ].filter((warning: any) => warning?.severity === 'blocker');

  const shotStateById: Record<string, Record<string, any> | null> = {};
  await Promise.all(plan.map(async (shot: any) => {
    const id = clean(shot?.id, 96);
    if (!id || !safeId(id)) return;
    const authoritative = await readAuthoritativeProjectState<Record<string, any>>(
      projectId,
      'shot-state:' + resolvedStoryVersion + ':' + resolvedSceneId + ':' + id
    );
    if (authoritative?.value) {
      shotStateById[id] = authoritative.value;
      return;
    }
    if (transactionalStateMode() !== 'postgres') {
      shotStateById[id] = await s.shotStates.get(
        'project/' + projectId + '/' + resolvedStoryVersion + '/' + resolvedSceneId + '/' + id,
        { type: 'json' }
      ) as Record<string, any> | null;
    } else {
      shotStateById[id] = null;
    }
  }));

  const authoritativeSpatial = await readAuthoritativeProjectState<SceneSpatialPlan>(
    projectId,
    'spatial-plan:' + resolvedStoryVersion + ':' + resolvedSceneId
  );
  const spatialPlan = await buildSceneSpatialPlan({
    projectId,
    storyVersion: resolvedStoryVersion,
    sceneId: resolvedSceneId,
    shots: plan,
    continuityContract: sceneContract,
    shotStates: shotStateById,
    existing: authoritativeSpatial?.value || null
  });

  const packages = await Promise.all(filteredShots.map(async (shot: any) => {
    const id = String(shot?.id || '');
    const direction = directionByShot[id] || null;
    const planIndex = plan.findIndex((candidate: any) => String(candidate?.id || '') === id);
    const previousShot = planIndex > 0 ? plan[planIndex - 1] : null;
    const previousShotId = previousShot ? String(previousShot?.id || '') : '';
    const continuityBreak = shotContinuityBreak(shot);
    const previousHandoffState = previousShotId && !continuityBreak
      ? await readAuthoritativeProjectState<Record<string, any>>(
          projectId,
          'render:handoff:' + resolvedStoryVersion + ':' + resolvedSceneId + ':' + previousShotId
        )
      : null;
    const previousHandoff = previousHandoffState?.value || null;
    let resolvedPreviousHandoff = previousHandoff;
    const handoffHash = clean(resolvedPreviousHandoff?.handoff_frame?.sha256, 64).toLowerCase();
    if (previousHandoff && /^[a-f0-9]{64}$/.test(handoffHash)) {
      resolvedPreviousHandoff = {
        ...previousHandoff,
        handoff_frame: {
          ...previousHandoff.handoff_frame,
          uri: await signedMotionFrameUrl({
            projectId,
            hash: handoffHash,
            purpose: 'sequence-handoff',
            ttlSeconds: 1800
          })
        }
      };
    }
    const shotState = id ? (shotStateById[id] || null) : null;

    const spatial = spatialContractForShot(spatialPlan, id);
    const spatialApprovalRequired = Boolean(spatial?.axis_critical && spatial?.approval_status !== 'approved');
    const spatialWarnings = [
      ...(spatial?.blockers || []).map((message: string) => ({
        severity: 'blocker',
        code: 'SPATIAL_PLAN_BLOCKED',
        message
      })),
      ...(spatialApprovalRequired ? [{
        severity: 'blocker',
        code: 'SPATIAL_PLAN_APPROVAL_REQUIRED',
        message: 'This multi-character scene has an established camera axis that has not been human-approved.'
      }] : [])
    ];

    const sequenceWarnings = [
      ...(previousShotId && !continuityBreak && !previousHandoff ? [{
        severity: 'blocker',
        code: 'PREVIOUS_RENDER_HANDOFF_REQUIRED',
        message:
          'Shot ' + id + ' continues directly from ' + previousShotId +
          ', but the previous shot has not been accepted into the authoritative sequence yet.'
      }] : []),
      ...(previousShotId && !continuityBreak && previousHandoff && !resolvedPreviousHandoff?.handoff_frame ? [{
        severity: 'blocker',
        code: 'PREVIOUS_HANDOFF_FRAME_REQUIRED',
        message:
          'The previous accepted shot has no trusted final-frame handoff evidence. ' +
          'Automatic pixel-continuity rendering is blocked until it is re-inspected or this shot is explicitly marked as a continuity break.'
      }] : [])
    ];

    const shotBlockers = [
      ...sceneBlockers,
      ...(Array.isArray(shotState?.warnings) ? shotState.warnings : []),
      ...spatialWarnings,
      ...sequenceWarnings
    ].filter((warning: any) => warning?.severity === 'blocker');

    const checked = Boolean(shotState);
    const continuityBefore = shotState?.render_contract_before || sceneContract;
    const continuityAfter = shotState?.render_contract_after || sceneContract;

    return {
      render_package_version: 'parable-render-handoff-v3',
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
      spatial_continuity: spatial,
      previous_accepted_handoff: resolvedPreviousHandoff,
      sequence_handoff: {
        previous_shot_id: previousShotId || null,
        continuity_break: continuityBreak,
        status: continuityBreak || !previousShotId
          ? 'not-required'
          : resolvedPreviousHandoff?.handoff_frame
            ? 'ready'
            : previousHandoff
              ? 'missing-trusted-frame'
              : 'awaiting-previous-acceptance',
        authoritative_ref: previousHandoffState?.ref || null
      },
      hard_constraints: {
        preserve_identity: true,
        preserve_wardrobe: true,
        preserve_injuries: true,
        preserve_prop_ownership: true,
        preserve_prop_location: true,
        preserve_screen_geography: true,
        preserve_camera_axis: true,
        preserve_room_topology: true,
        preserve_character_knowledge: true,
        match_previous_accepted_handoff:
          Boolean(previousShotId && !continuityBreak && resolvedPreviousHandoff?.handoff_frame),
        no_unmarked_state_changes: true
      },
      can_render: checked && Boolean(sceneState?.can_render) && Boolean(shotState?.can_render) && shotBlockers.length === 0,
      blockers: shotBlockers,
      human_review_recommended: Boolean(
        sceneState?.requires_human_review ||
        shotState?.requires_human_review ||
        spatialApprovalRequired ||
        (spatial?.overridden_blockers || []).length ||
        (previousShotId && !continuityBreak && !resolvedPreviousHandoff?.handoff_frame)
      )
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
    spatial_plan: {
      spatial_plan_hash: spatialPlan.spatial_plan_hash,
      axis_critical: spatialPlan.axis_critical,
      approval_status: spatialPlan.approval.status,
      authoritative_ref: authoritativeSpatial?.ref || null,
      blocker_count: spatialPlan.blockers.length
    },
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
