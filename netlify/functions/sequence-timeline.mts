import { getDeployStore, getStore } from '@netlify/blobs';
import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  readProjectRevision,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import {
  readAuthoritativeProjectState,
  stageProjectArtifact
} from './_lib/project-artifacts.mts';
import {
  buildSequenceTimeline,
  type SequenceTimeline
} from './_lib/sequence-timeline.mts';
import type { SceneSpatialPlan } from './_lib/spatial-continuity.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';
import { transactionalStateMode } from './_lib/transactional-state.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1200) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  const make = (name: string) => production
    ? getStore(name, { consistency: 'strong' })
    : getDeployStore(name);
  return {
    adaptations: make('parable-adaptations')
  };
}

function timelineKey(storyVersion: string, sceneId: string) {
  return 'sequence:timeline:' + storyVersion + ':' + sceneId;
}

function sceneShots(adaptation: Record<string, any> | null, sceneId: string) {
  const bible = adaptation?.production_bible || {};
  const all = Array.isArray(adaptation?.shot_plan)
    ? adaptation!.shot_plan
    : Array.isArray(bible?.shot_plan)
      ? bible.shot_plan
      : [];

  const tagged = all.filter((shot: any) => clean(shot?.scene_id || shot?.sceneId, 96));
  return tagged.length
    ? all.filter((shot: any) => clean(shot?.scene_id || shot?.sceneId, 96) === sceneId)
    : all;
}

async function loadInputs(projectId: string, storyVersion: string, sceneId: string) {
  const authoritativeAdaptation = await readAuthoritativeProjectState<Record<string, any>>(
    projectId,
    'adaptation:latest'
  );
  let adaptation = authoritativeAdaptation?.value || null;

  if (!adaptation && transactionalStateMode() !== 'postgres') {
    adaptation = await stores().adaptations.get(
      'project/' + projectId + '/versions/' + storyVersion,
      { type: 'json' }
    ) as Record<string, any> | null;
  }

  if (!adaptation || adaptation.story_version !== storyVersion) {
    throw Object.assign(new Error(
      transactionalStateMode() === 'postgres'
        ? 'Authoritative adaptation for this story version is missing.'
        : 'Adaptation for this story version is missing.'
    ), { code: 'AUTHORITATIVE_ADAPTATION_REQUIRED', status: 409 });
  }

  const shots = sceneShots(adaptation, sceneId);
  if (!shots.length) {
    throw Object.assign(new Error('No shots exist for this scene in the authoritative adaptation.'), {
      code: 'SEQUENCE_SHOT_PLAN_REQUIRED',
      status: 409
    });
  }

  const spatial = await readAuthoritativeProjectState<SceneSpatialPlan>(
    projectId,
    'spatial-plan:' + storyVersion + ':' + sceneId
  );

  const accepted: Record<string, { ref: string; value: Record<string, any> } | null> = {};
  const handoffs: Record<string, { ref: string; value: Record<string, any> } | null> = {};

  await Promise.all(shots.map(async (shot: any, index: number) => {
    const shotId = clean(shot?.id || ('shot_' + (index + 1)), 96);
    if (!shotId || !safeId(shotId)) return;

    const [acceptedState, handoffState] = await Promise.all([
      readAuthoritativeProjectState<Record<string, any>>(
        projectId,
        'render:accepted:' + storyVersion + ':' + sceneId + ':' + shotId
      ),
      readAuthoritativeProjectState<Record<string, any>>(
        projectId,
        'render:handoff:' + storyVersion + ':' + sceneId + ':' + shotId
      )
    ]);

    accepted[shotId] = acceptedState
      ? { ref: acceptedState.ref, value: acceptedState.value }
      : null;
    handoffs[shotId] = handoffState
      ? { ref: handoffState.ref, value: handoffState.value }
      : null;
  }));

  return {
    adaptation,
    adaptationRef: authoritativeAdaptation?.ref || null,
    shots,
    spatial,
    accepted,
    handoffs
  };
}

async function buildCurrent(
  projectId: string,
  storyVersion: string,
  sceneId: string,
  existing?: SequenceTimeline | null
) {
  const input = await loadInputs(projectId, storyVersion, sceneId);
  const timeline = await buildSequenceTimeline({
    projectId,
    storyVersion,
    sceneId,
    shots: input.shots,
    adaptationRef: input.adaptationRef,
    spatialPlan: input.spatial?.value
      ? {
          hash: input.spatial.value.spatial_plan_hash,
          axisCritical: input.spatial.value.axis_critical,
          approvalStatus: input.spatial.value.approval?.status || null
        }
      : null,
    accepted: input.accepted,
    handoffs: input.handoffs,
    existing: existing || null
  });

  return { timeline, input };
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

    const existing = await readAuthoritativeProjectState<SequenceTimeline>(
      projectId,
      timelineKey(storyVersion, sceneId)
    );

    try {
      const { timeline } = await buildCurrent(
        projectId,
        storyVersion,
        sceneId,
        existing?.value || null
      );
      return json({
        timeline,
        authoritative_ref: existing?.ref || null,
        authoritative_revision: existing?.revision ?? null,
        lock_is_current:
          existing?.value?.lock?.status === 'locked' &&
          existing.value.timeline_hash === timeline.timeline_hash
      });
    } catch (error: any) {
      if (Number.isFinite(Number(error?.status))) {
        return json({ error: error.message, code: error.code || 'SEQUENCE_TIMELINE_FAILED' }, Number(error.status));
      }
      throw error;
    }
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const sceneId = clean(body.sceneId, 96);
  const action = clean(body.action || 'preview', 40);

  if (![projectId, storyVersion, sceneId].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion and sceneId are required.' }, 400);
  }
  if (!['preview','lock'].includes(action)) {
    return json({ error: 'action must be preview or lock.' }, 400);
  }

  try {
    await authorizeProject(request, projectId, action === 'lock' ? 'project:read' : 'render:plan');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  const initialHead = await readProjectRevision(projectId);

  const existing = await readAuthoritativeProjectState<SequenceTimeline>(
    projectId,
    timelineKey(storyVersion, sceneId)
  );

  let built;
  try {
    built = await buildCurrent(projectId, storyVersion, sceneId, existing?.value || null);
  } catch (error: any) {
    if (Number.isFinite(Number(error?.status))) {
      return json({ error: error.message, code: error.code || 'SEQUENCE_TIMELINE_FAILED' }, Number(error.status));
    }
    throw error;
  }

  if (action === 'preview') {
    return json({
      timeline: built.timeline,
      authoritative_ref: existing?.ref || null,
      lock_is_current:
        existing?.value?.lock?.status === 'locked' &&
        existing.value.timeline_hash === built.timeline.timeline_hash
    });
  }

  if (body.humanApproved !== true) {
    return json({
      error: 'Locking an edit sequence requires humanApproved: true.',
      code: 'HUMAN_SEQUENCE_LOCK_REQUIRED'
    }, 400);
  }

  const expectedHash = clean(body.timelineHash, 96);
  if (expectedHash && expectedHash !== built.timeline.timeline_hash) {
    return json({
      error: 'The sequence changed after it was reviewed.',
      code: 'SEQUENCE_TIMELINE_STALE',
      current_timeline_hash: built.timeline.timeline_hash
    }, 409);
  }

  if (built.timeline.readiness.blockers.length) {
    return json({
      error: 'The sequence cannot be locked while required shots/handoffs are missing or stale.',
      code: 'SEQUENCE_NOT_READY',
      blockers: built.timeline.readiness.blockers,
      manual_exceptions: built.timeline.readiness.manual_exceptions
    }, 409);
  }

  const note = clean(body.note, 1400) || null;
  const hasManualExceptions = built.timeline.readiness.manual_exceptions.length > 0;
  if (hasManualExceptions && body.acceptManualExceptions !== true) {
    return json({
      error: 'One or more shots entered the sequence through a human motion-QA override.',
      code: 'SEQUENCE_MANUAL_EXCEPTIONS_CONFIRMATION_REQUIRED',
      required_field: 'acceptManualExceptions',
      manual_exceptions: built.timeline.readiness.manual_exceptions
    }, 400);
  }
  if (hasManualExceptions && !note) {
    return json({
      error: 'A reviewer note is required when locking a sequence containing manual QA exceptions.',
      code: 'SEQUENCE_EXCEPTION_NOTE_REQUIRED'
    }, 400);
  }

  let access;
  try {
    access = await authorizeProject(
      request,
      projectId,
      hasManualExceptions ? 'review:override' : 'review:approve'
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
      mutationType: 'lock-sequence-timeline',
      expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
        ? Number(body.expectedProjectRevision)
        : initialHead.revision,
      ttlMs: 30000
    });

    const locked: SequenceTimeline = {
      ...built.timeline,
      lock: {
        status: 'locked',
        approved_by_actor_id: access.actor.actor_id,
        approved_at: new Date().toISOString(),
        reviewer_note: note,
        manual_exceptions_accepted: hasManualExceptions
      }
    };

    const ref = await stageProjectArtifact({
      projectId,
      mutationId: lease.mutation_id,
      kind: 'sequence-timeline',
      artifactId: storyVersion + ':' + sceneId + ':' + locked.timeline_hash,
      value: locked
    });

    const committed = await commitProjectMutation(
      lease,
      {
        story_version: storyVersion,
        scene_id: sceneId,
        timeline_hash: locked.timeline_hash,
        shot_count: locked.shot_count,
        manual_exception_count: locked.readiness.manual_exceptions.length,
        reviewer_note: note
      },
      {
        [timelineKey(storyVersion, sceneId)]: ref
      }
    );

    return json({
      timeline: locked,
      project_revision: committed.revision,
      mutation_id: committed.mutation_id,
      authoritative_ref: ref,
      note: 'Only the exact accepted render artifacts listed in this locked manifest are eligible for sequence assembly.'
    }, 201);
  } catch (error) {
    if (lease) await abortProjectMutation(lease).catch(() => false);
    const handled = projectMutationErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }
};

export const config = {
  path: '/api/sequence-timeline',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip','domain']
  }
};
