import { getDeployStore, getStore } from '@netlify/blobs';
import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import {
  readAuthoritativeProjectState,
  stageProjectArtifact
} from './_lib/project-artifacts.mts';
import {
  buildSceneSpatialPlan,
  type CameraAxisSide,
  type SceneSpatialPlan
} from './_lib/spatial-continuity.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';
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
    adaptations: make('parable-adaptations'),
    sceneStates: make('parable-scene-states'),
    shotStates: make('parable-shot-states')
  };
}

const clean = (value: unknown, max = 800) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

function stateKey(storyVersion: string, sceneId: string) {
  return 'spatial-plan:' + storyVersion + ':' + sceneId;
}

function sanitizeOverrides(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, any> : {};
  const axisSubjects = Array.isArray(input.axis_subjects)
    ? input.axis_subjects.slice(0, 2).map((x: unknown) => clean(x, 180)).filter(Boolean)
    : [];

  const shotSides: Record<string, CameraAxisSide> = {};
  if (input.shot_sides && typeof input.shot_sides === 'object') {
    for (const [shotId, side] of Object.entries(input.shot_sides)) {
      if (!safeId(shotId)) continue;
      if (['A','B','on-axis','unknown'].includes(String(side))) {
        shotSides[shotId] = String(side) as CameraAxisSide;
      }
    }
  }

  const allowCrossings = Array.isArray(input.allow_crossings)
    ? input.allow_crossings.slice(0, 80).map((x: unknown) => clean(x, 96)).filter((x: string) => safeId(x))
    : [];

  return {
    axis_subjects: axisSubjects,
    shot_sides: shotSides,
    allow_crossings: allowCrossings
  };
}

async function sourceFor(projectId: string, storyVersion: string, sceneId: string) {
  const s = stores();
  const [authoritativeAdaptation, cachedAdaptation, authoritativeScene] = await Promise.all([
    readAuthoritativeProjectState<Record<string, any>>(projectId, 'adaptation:latest'),
    s.adaptations.get('project/' + projectId + '/versions/' + storyVersion, { type: 'json' }) as Promise<Record<string, any> | null>,
    readAuthoritativeProjectState<Record<string, any>>(
      projectId,
      'scene-state:' + storyVersion + ':' + sceneId
    )
  ]);

  const adaptation = authoritativeAdaptation?.value?.story_version === storyVersion
    ? authoritativeAdaptation.value
    : cachedAdaptation;

  const shots = Array.isArray(adaptation?.shot_plan)
    ? adaptation.shot_plan
    : Array.isArray(adaptation?.production_bible?.shot_plan)
      ? adaptation.production_bible.shot_plan
      : [];

  const cachedScene = await s.sceneStates.get(
    'project/' + projectId + '/' + storyVersion + '/' + sceneId,
    { type: 'json' }
  ) as Record<string, any> | null;
  const sceneState = authoritativeScene?.value || (
    transactionalStateMode() === 'postgres' ? null : cachedScene
  );

  if (!sceneState) {
    throw Object.assign(new Error(
      transactionalStateMode() === 'postgres'
        ? 'Authoritative scene continuity is missing; cached Blob state cannot authorize a spatial plan.'
        : 'Scene continuity must be processed before spatial planning.'
    ), {
      code: transactionalStateMode() === 'postgres'
        ? 'AUTHORITATIVE_SCENE_CONTINUITY_REQUIRED'
        : 'SCENE_CONTINUITY_REQUIRED',
      status: 409
    });
  }

  const sceneContract = sceneState.render_contract || sceneState.continuity_context || null;

  const shotStates: Record<string, Record<string, any> | null> = {};
  await Promise.all(shots.map(async (shot: any) => {
    const shotId = clean(shot?.id, 96);
    if (!shotId || !safeId(shotId)) return;
    const authoritative = await readAuthoritativeProjectState<Record<string, any>>(
      projectId,
      'shot-state:' + storyVersion + ':' + sceneId + ':' + shotId
    );
    if (authoritative?.value) {
      shotStates[shotId] = authoritative.value;
      return;
    }
    if (transactionalStateMode() !== 'postgres') {
      shotStates[shotId] = await s.shotStates.get(
        'project/' + projectId + '/' + storyVersion + '/' + sceneId + '/' + shotId,
        { type: 'json' }
      ) as Record<string, any> | null;
    } else {
      shotStates[shotId] = null;
    }
  }));

  return {
    shots,
    sceneState,
    sceneContract,
    shotStates
  };
}

export default async (request: Request) => {
  if (!['GET','POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
    const sceneId = clean(url.searchParams.get('sceneId'), 96);

    if (![projectId, storyVersion, sceneId].every((value) => value && safeId(value))) {
      return json({ error: 'Valid projectId, storyVersion and sceneId are required.' }, 400);
    }

    try {
      await authorizeProject(request, projectId, 'project:read');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }

    const current = await readAuthoritativeProjectState<SceneSpatialPlan>(
      projectId,
      stateKey(storyVersion, sceneId)
    );

    if (!current) {
      return json({
        error: 'No spatial plan has been committed for this scene.',
        code: 'SPATIAL_PLAN_REQUIRED',
        next_action: 'POST /api/spatial-plan with action=build.'
      }, 404);
    }

    return json({
      ...current.value,
      project_revision: current.revision,
      authoritative_ref: current.ref
    });
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const sceneId = clean(body.sceneId, 96);
  const action = clean(body.action || 'build', 40);

  if (![projectId, storyVersion, sceneId].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion and sceneId are required.' }, 400);
  }
  if (!['build','approve','rebuild'].includes(action)) {
    return json({ error: 'Unsupported spatial-plan action.' }, 400);
  }

  let access;
  try {
    access = await authorizeProject(
      request,
      projectId,
      action === 'approve' ? 'review:approve' : 'render:plan'
    );
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  let lease: ProjectMutationLease | null = null;
  try {
    lease = await acquireProjectMutation({
      projectId,
      mutationType: 'spatial-plan:' + action,
      expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
        ? Number(body.expectedProjectRevision)
        : null,
      ttlMs: 30000
    });

    const existingState = await readAuthoritativeProjectState<SceneSpatialPlan>(
      projectId,
      stateKey(storyVersion, sceneId)
    );
    const source = await sourceFor(projectId, storyVersion, sceneId);
    const overrides = sanitizeOverrides(body.overrides);

    let plan = await buildSceneSpatialPlan({
      projectId,
      storyVersion,
      sceneId,
      shots: source.shots,
      continuityContract: source.sceneContract,
      shotStates: source.shotStates,
      existing: existingState?.value || null,
      overrides
    });

    if (action === 'approve') {
      if (body.humanApproved !== true) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'Spatial-plan approval requires humanApproved: true.',
          code: 'HUMAN_SPATIAL_APPROVAL_REQUIRED'
        }, 400);
      }

      const expectedHash = clean(body.spatialPlanHash, 96);
      if (expectedHash && expectedHash !== plan.spatial_plan_hash) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'The spatial plan changed since it was reviewed.',
          code: 'SPATIAL_PLAN_STALE',
          current_spatial_plan_hash: plan.spatial_plan_hash
        }, 409);
      }

      const reviewerNote = clean(body.note, 1200) || null;
      const overrideBlockers = body.overrideBlockers === true;

      if (plan.blockers.length && !overrideBlockers) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'The spatial plan contains camera-axis/geography blockers.',
          code: 'SPATIAL_BLOCKERS_PRESENT',
          blockers: plan.blockers,
          hint: 'Fix the plan, or set overrideBlockers=true with a reviewer note after deliberate human review.'
        }, 409);
      }

      if (overrideBlockers && !reviewerNote) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'A reviewer note is required when overriding spatial blockers.',
          code: 'SPATIAL_OVERRIDE_NOTE_REQUIRED'
        }, 400);
      }

      plan = {
        ...plan,
        approval: {
          status: 'approved',
          approved_by_actor_id: access.actor.actor_id,
          approved_at: new Date().toISOString(),
          reviewer_note: reviewerNote,
          override_blockers: overrideBlockers
        }
      };
    }

    const ref = await stageProjectArtifact({
      projectId,
      mutationId: lease.mutation_id,
      kind: 'spatial-plan',
      artifactId: storyVersion + ':' + sceneId,
      value: plan
    });

    const committed = await commitProjectMutation(
      lease,
      {
        story_version: storyVersion,
        scene_id: sceneId,
        action,
        spatial_plan_hash: plan.spatial_plan_hash,
        axis_critical: plan.axis_critical,
        axis_subject_a: plan.axis.subject_a,
        axis_subject_b: plan.axis.subject_b,
        blocker_count: plan.blockers.length,
        approval_status: plan.approval.status,
        override_blockers: plan.approval.override_blockers
      },
      {
        [stateKey(storyVersion, sceneId)]: ref
      }
    );

    return json({
      ...plan,
      project_revision: committed.revision,
      mutation_id: committed.mutation_id,
      authoritative_ref: ref,
      note: plan.axis_critical
        ? plan.approval.status === 'approved'
          ? 'The camera-axis/room-topology plan is locked for final shot compilation.'
          : 'This scene has a two-subject camera axis and must be human-approved before final compilation.'
        : 'No two-subject camera axis was detected; room topology constraints still apply.'
    }, action === 'approve' ? 200 : 201);
  } catch (error: any) {
    if (lease) await abortProjectMutation(lease).catch(() => false);
    const handled = projectMutationErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    if (Number.isFinite(Number(error?.status))) {
      return json({ error: error.message, code: error.code || 'SPATIAL_PLAN_FAILED' }, Number(error.status));
    }
    throw error;
  }
};

export const config = {
  path: '/api/spatial-plan',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip','domain']
  }
};
