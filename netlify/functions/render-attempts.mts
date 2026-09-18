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
import { evaluateProposedRenderAttempt } from './_lib/render-budget.mts';
import { evaluateStoredKeyframeGate } from './_lib/keyframe-approval.mts';
import type { RenderAttempt, RenderAttemptStatus } from './_lib/render-foundation.mts';
import {
  authorizeProject,
  securityErrorResponse
} from './_lib/security.mts';
import {
  appendRenderAttemptEvent,
  listShotAttempts,
  readLatestRenderQA,
  readLatestMotionInspection,
  readRenderAttempt,
  readRenderSpec,
  saveRenderAttempt
} from './_lib/render-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000000) / 1000000 : null;
};

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function transitionAllowed(current: RenderAttemptStatus, next: RenderAttemptStatus) {
  const map: Record<RenderAttemptStatus, RenderAttemptStatus[]> = {
    planned: ['queued', 'rendering', 'failed', 'rejected'],
    queued: ['rendering', 'succeeded', 'failed', 'rejected'],
    rendering: ['succeeded', 'failed', 'rejected'],
    succeeded: ['accepted', 'rejected', 'superseded'],
    failed: ['superseded'],
    accepted: ['superseded'],
    rejected: ['superseded'],
    superseded: []
  };
  return map[current]?.includes(next) || current === next;
}

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const attemptId = clean(url.searchParams.get('attemptId'), 160);

    if (attemptId) {
      if (!safeId(attemptId)) return json({ error: 'Invalid attemptId.' }, 400);
      const attempt = await readRenderAttempt(attemptId);
      if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);
      try {
        await authorizeProject(request, attempt.project_id, 'project:read');
      } catch (error) {
        const handled = securityErrorResponse(error);
        if (handled) return json(handled.body, handled.status);
        throw error;
      }
      const qa = await readLatestRenderQA(attemptId);
      return json({ attempt, qa });
    }

    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
    const sceneId = clean(url.searchParams.get('sceneId'), 96);
    const shotId = clean(url.searchParams.get('shotId'), 96);

    if (![projectId, storyVersion, sceneId, shotId].every((value) => value && safeId(value))) {
      return json({ error: 'Provide attemptId or valid projectId, storyVersion, sceneId and shotId.' }, 400);
    }

    try {
      await authorizeProject(request, projectId, 'project:read');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }

    const events = await listShotAttempts({ projectId, storyVersion, sceneId, shotId, limit: 100 });
    return json({ project_id: projectId, story_version: storyVersion, scene_id: sceneId, shot_id: shotId, events });
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const action = clean(body.action || 'create', 40);

  if (action === 'create') {
    const projectId = clean(body.projectId, 96);
    const storyVersion = clean(body.storyVersion, 96);
    const sceneId = clean(body.sceneId, 96);
    const shotId = clean(body.shotId, 96);
    const specHash = clean(body.specHash, 96);
    const provider = clean(body.provider, 80);
    const model = clean(body.model, 180);
    const mode: 'draft' | 'final' = body.draft === true ? 'draft' : 'final';
    const estimatedCostUsd = money(body.estimatedCostUsd);
    const idempotencyKey = clean(request.headers.get('idempotency-key') || body.idempotencyKey, 240);

    if (![projectId, storyVersion, sceneId, shotId].every((value) => value && safeId(value))) {
      return json({ error: 'Valid projectId, storyVersion, sceneId and shotId are required.' }, 400);
    }
    if (!provider || !model) return json({ error: 'provider and model are required.' }, 400);

    try {
      await authorizeProject(request, projectId, 'render:plan');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }

    const spec = await readRenderSpec({
      projectId,
      storyVersion,
      sceneId,
      shotId,
      specHash: specHash || null
    });
    if (!spec) return json({ error: 'A compiled ShotRenderSpec is required before creating a render attempt.' }, 409);

    if (spec.human_review.required_before_final_render && mode === 'final') {
      return json({
        error: 'This render specification requires human review before a final render attempt.',
        code: 'HUMAN_REVIEW_REQUIRED',
        reasons: spec.human_review.reasons,
        hint: 'Use draft=true for visual development, or resolve the review/rights issues first.'
      }, 409);
    }

    const keyframeGate = mode === 'final'
      ? await evaluateStoredKeyframeGate({
          projectId,
          sceneId,
          shotId,
          specHash: spec.spec_hash
        })
      : null;

    if (keyframeGate && !keyframeGate.allowed) {
      return json({
        error: keyframeGate.message,
        code: keyframeGate.code,
        final_motion_gate: 'blocked',
        keyframe_approval: keyframeGate.approval
      }, 409);
    }

    let attemptId = 'render_' + crypto.randomUUID().replaceAll('-', '');
    if (idempotencyKey) {
      const deterministic = await sha256Text([
        projectId,
        storyVersion,
        sceneId,
        shotId,
        spec.spec_hash,
        mode,
        provider,
        model,
        idempotencyKey
      ].join('|'));
      attemptId = 'render_' + deterministic.slice(0, 40);

      const existing = await readRenderAttempt(attemptId);
      if (existing) {
        const sameRequest =
          existing.project_id === projectId &&
          existing.story_version === storyVersion &&
          existing.scene_id === sceneId &&
          existing.shot_id === shotId &&
          existing.spec_hash === spec.spec_hash &&
          existing.mode === mode &&
          existing.provider === provider &&
          existing.model === model;

        if (!sameRequest) {
          return json({
            error: 'The same render idempotency key was reused for a different attempt.',
            code: 'RENDER_IDEMPOTENCY_CONFLICT'
          }, 409);
        }

        return json({
          ...existing,
          deduplicated: true
        }, 200);
      }
    }

    let lease: ProjectMutationLease | null = null;
    try {
      lease = await acquireProjectMutation({
        projectId,
        mutationType: 'create-render-attempt',
        expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
          ? Number(body.expectedProjectRevision)
          : null,
        ttlMs: 30000
      });

      const budget = await evaluateProposedRenderAttempt({
        projectId,
        storyVersion,
        shotId,
        mode,
        estimatedCostUsd,
        humanApproved: body.costApprovedByHuman === true
      });

      if (!budget.allowed) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: budget.message,
          code: budget.code,
          requires_human_approval: budget.requires_human_approval,
          budget
        }, 409);
      }

      const now = new Date().toISOString();
      const attempt: RenderAttempt = {
        attempt_version: 'parable-render-attempt-v1',
        id: attemptId,
        project_id: projectId,
        story_version: storyVersion,
        scene_id: sceneId,
        shot_id: shotId,
        spec_hash: spec.spec_hash,
        provider,
        model,
        status: 'planned',
        mode,
        keyframe_approval_ref: keyframeGate?.authoritative_ref || null,
        keyframe_asset_uri: keyframeGate?.approval?.asset?.uri || null,
        keyframe_plan_hash: keyframeGate?.approval?.keyframe_plan_hash || null,
        provider_transaction_id: null,
        provider_request_id: null,
        asset_uri: null,
        poster_uri: null,
        estimated_cost_usd: estimatedCostUsd,
        actual_cost_usd: null,
        latency_ms: null,
        failure_class: null,
        failure_detail: null,
        created_at: now,
        updated_at: now
      };

      await saveRenderAttempt(attempt);
      await appendRenderAttemptEvent(attempt, 'created', {
        draft: mode === 'draft',
        idempotency_key_present: Boolean(idempotencyKey),
        budget_projected: budget.projected,
        keyframe_approval_ref: keyframeGate?.authoritative_ref || null,
        keyframe_plan_hash: keyframeGate?.approval?.keyframe_plan_hash || null
      });

      const committed = await commitProjectMutation(lease, {
        scene_id: sceneId,
        shot_id: shotId,
        attempt_id: attempt.id,
        render_mode: mode,
        provider,
        model,
        estimated_cost_usd: estimatedCostUsd,
        projected_shot_attempts: budget.projected.shot_attempts,
        projected_project_cost_usd: budget.projected.project_cost_usd,
        keyframe_approval_ref: keyframeGate?.authoritative_ref || null,
        keyframe_plan_hash: keyframeGate?.approval?.keyframe_plan_hash || null
      });

      return json({
        ...attempt,
        project_revision: committed.revision,
        mutation_id: committed.mutation_id,
        budget,
        deduplicated: false
      }, 201);
    } catch (error) {
      if (lease) await abortProjectMutation(lease).catch(() => false);
      const handled = projectMutationErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }
  }
  const attemptId = clean(body.attemptId, 160);
  if (!attemptId || !safeId(attemptId)) return json({ error: 'A valid attemptId is required.' }, 400);

  const attempt = await readRenderAttempt(attemptId);
  if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);

  const providerStateAction = ['queued','provider_started','result','failure'].includes(action);
  const reviewAction = ['accept','reject','supersede'].includes(action);
  const explicitReviewOverride = reviewAction && body.humanApproved === true;
  try {
    const access = await authorizeProject(
      request,
      attempt.project_id,
      providerStateAction
        ? 'render:spend'
        : reviewAction
          ? (explicitReviewOverride ? 'review:override' : 'review:approve')
          : 'render:plan'
    );
    if (providerStateAction && !access.actor.internal) {
      return json({
        error: 'Provider lifecycle state can only be changed by a trusted PARABLE worker.',
        code: 'INTERNAL_PROVIDER_STATE_REQUIRED'
      }, 403);
    }
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  let nextStatus: RenderAttemptStatus | null = null;
  if (action === 'queued') nextStatus = 'queued';
  if (action === 'provider_started') nextStatus = 'rendering';
  if (action === 'result') nextStatus = 'succeeded';
  if (action === 'failure') nextStatus = 'failed';
  if (action === 'reject') nextStatus = 'rejected';
  if (action === 'supersede') nextStatus = 'superseded';
  if (action === 'accept') nextStatus = 'accepted';

  if (!nextStatus) return json({ error: 'Unsupported render-attempt action.' }, 400);
  if (!transitionAllowed(attempt.status, nextStatus)) {
    return json({
      error: 'Invalid render-attempt state transition.',
      current_status: attempt.status,
      requested_status: nextStatus
    }, 409);
  }

  if (action === 'accept') {
    const [qa, motionInspection, exactSpec] = await Promise.all([
      readLatestRenderQA(attempt.id),
      readLatestMotionInspection(attempt.id),
      readRenderSpec({
        projectId: attempt.project_id,
        storyVersion: attempt.story_version,
        sceneId: attempt.scene_id,
        shotId: attempt.shot_id,
        specHash: attempt.spec_hash
      })
    ]);
    const humanOverride = body.humanApproved === true;
    const reviewerNote = clean(body.note, 1000);

    const motionBound = Boolean(
      motionInspection &&
      motionInspection.attempt_id === attempt.id &&
      motionInspection.asset_uri === attempt.asset_uri &&
      motionInspection.spec_hash === attempt.spec_hash
    );
    const qaBoundToMotion = Boolean(
      qa &&
      (qa as any).evidence_source === 'trusted-motion-inspector' &&
      (qa as any).motion_inspection_id === motionInspection?.id &&
      (qa as any).inspected_asset_uri === attempt.asset_uri &&
      (qa as any).inspected_spec_hash === attempt.spec_hash
    );
    const finalAutoEligible =
      attempt.mode !== 'final' ||
      (
        motionBound &&
        qaBoundToMotion &&
        motionInspection?.decision === 'CLEAR_FOR_QA' &&
        qa?.decision === 'PASS'
      );

    if (!finalAutoEligible && !humanOverride) {
      return json({
        error: attempt.mode === 'final'
          ? 'Final motion must pass a bound full-motion Visual Inspector report before automatic timeline acceptance.'
          : 'Only a QA PASS can be accepted automatically.',
        code: attempt.mode === 'final' ? 'MOTION_QA_PASS_REQUIRED' : 'QA_PASS_REQUIRED',
        current_qa_decision: qa?.decision || null,
        current_motion_decision: motionInspection?.decision || null,
        motion_report_bound_to_asset: motionBound,
        qa_bound_to_motion_report: qaBoundToMotion,
        hint: 'Repair/re-inspect the shot, or use humanApproved=true with a reviewer note for an explicit authorized override.'
      }, 409);
    }

    if (humanOverride && !reviewerNote) {
      return json({
        error: 'A reviewer note is required for an explicit render acceptance override.',
        code: 'RENDER_OVERRIDE_NOTE_REQUIRED'
      }, 400);
    }

    const finalManualReviewOverride = attempt.mode === 'final' && humanOverride && !finalAutoEligible;
    if (finalManualReviewOverride && body.motionReviewConfirmed !== true) {
      return json({
        error: 'A final-motion override requires explicit confirmation that the reviewer watched the completed video, not only the first frame or QA summary.',
        code: 'FULL_MOTION_REVIEW_CONFIRMATION_REQUIRED',
        required_field: 'motionReviewConfirmed'
      }, 400);
    }

    const knownMotionDefects = Boolean(
      motionInspection &&
      ['REPAIR','REJECT'].includes(String(motionInspection.decision || ''))
    ) || Boolean(qa && ['REPAIR','REJECT'].includes(String(qa.decision || '')));

    if (finalManualReviewOverride && knownMotionDefects && body.acceptKnownDefects !== true) {
      return json({
        error: 'The motion inspector/QA recorded known defects. Acceptance requires an explicit acknowledgement of those defects.',
        code: 'KNOWN_MOTION_DEFECTS_ACKNOWLEDGEMENT_REQUIRED',
        required_field: 'acceptKnownDefects',
        motion_decision: motionInspection?.decision || null,
        qa_decision: qa?.decision || null,
        blockers: motionInspection?.blockers || qa?.blockers || []
      }, 400);
    }

    let lease: ProjectMutationLease | null = null;
    try {
      lease = await acquireProjectMutation({
        projectId: attempt.project_id,
        mutationType: 'accept-render',
        expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
          ? Number(body.expectedProjectRevision)
          : null,
        ttlMs: 30000
      });

      const accepted = {
        ...attempt,
        status: 'accepted' as const,
        updated_at: new Date().toISOString()
      };

      const acceptedRef = await stageProjectArtifact({
        projectId: attempt.project_id,
        mutationId: lease.mutation_id,
        kind: 'accepted-render',
        artifactId: attempt.story_version + ':' + attempt.scene_id + ':' + attempt.shot_id,
        value: {
          attempt: accepted,
          qa,
          motion_inspection: motionInspection || null,
          accepted_by_human_override: humanOverride && !finalAutoEligible,
          full_motion_review_confirmed: finalManualReviewOverride ? true : null,
          known_motion_defects_acknowledged: finalManualReviewOverride && knownMotionDefects ? true : null,
          reviewer_note: reviewerNote || null
        }
      });

      const handoffSample = motionInspection?.handoff_sample || null;
      const handoff = {
        handoff_version: 'parable-shot-handoff-v1',
        project_id: attempt.project_id,
        story_version: attempt.story_version,
        scene_id: attempt.scene_id,
        shot_id: attempt.shot_id,
        attempt_id: attempt.id,
        spec_hash: attempt.spec_hash,
        accepted_asset_uri: attempt.asset_uri,
        accepted_by_human_override: humanOverride && !finalAutoEligible,
        motion_inspection_id: motionInspection?.id || null,
        motion_sample_set_hash: motionInspection?.sample_set_hash || null,
        handoff_frame: handoffSample ? {
          uri: handoffSample.uri,
          timestamp_seconds: handoffSample.timestamp_seconds,
          sha256: handoffSample.sha256 || null
        } : null,
        continuity_after: exactSpec?.world_state?.continuity_after || null,
        camera_axis_after:
          (exactSpec?.world_state?.continuity_after as any)?.camera_axes ||
          (exactSpec?.world_state?.continuity_before as any)?.camera_axes ||
          null,
        room_topology_after:
          (exactSpec?.world_state?.continuity_after as any)?.room_topology ||
          (exactSpec?.world_state?.continuity_before as any)?.room_topology ||
          null,
        composition: exactSpec?.composition || null,
        camera: exactSpec?.camera || null,
        accepted_at: new Date().toISOString()
      };

      const handoffRef = await stageProjectArtifact({
        projectId: attempt.project_id,
        mutationId: lease.mutation_id,
        kind: 'render-handoff',
        artifactId: attempt.story_version + ':' + attempt.scene_id + ':' + attempt.shot_id,
        value: handoff
      });

      const acceptedStateKey =
        'render:accepted:' + attempt.story_version + ':' + attempt.scene_id + ':' + attempt.shot_id;
      const handoffStateKey =
        'render:handoff:' + attempt.story_version + ':' + attempt.scene_id + ':' + attempt.shot_id;

      const committed = await commitProjectMutation(
        lease,
        {
          story_version: attempt.story_version,
          scene_id: attempt.scene_id,
          shot_id: attempt.shot_id,
          attempt_id: attempt.id,
          provider: attempt.provider,
          model: attempt.model,
          qa_decision: qa?.decision || null,
          motion_decision: motionInspection?.decision || null,
          motion_inspection_id: motionInspection?.id || null,
          motion_sample_set_hash: motionInspection?.sample_set_hash || null,
          handoff_frame_sha256: handoffSample?.sha256 || null,
          human_override: humanOverride && !finalAutoEligible,
          full_motion_review_confirmed: finalManualReviewOverride ? true : null,
          known_motion_defects_acknowledged: finalManualReviewOverride && knownMotionDefects ? true : null,
          reviewer_note: reviewerNote || null
        },
        {
          [acceptedStateKey]: acceptedRef,
          [handoffStateKey]: handoffRef
        }
      );

      await saveRenderAttempt(accepted);
      await appendRenderAttemptEvent(accepted, 'accepted', {
        project_revision: committed.revision,
        authoritative_ref: acceptedRef,
        handoff_ref: handoffRef,
        human_override: humanOverride && !finalAutoEligible,
        full_motion_review_confirmed: finalManualReviewOverride ? true : null,
        known_motion_defects_acknowledged: finalManualReviewOverride && knownMotionDefects ? true : null,
        reviewer_note: reviewerNote || null,
        motion_inspection_id: motionInspection?.id || null
      });

      return json({
        attempt: accepted,
        qa,
        motion_inspection: motionInspection || null,
        project_revision: committed.revision,
        mutation_id: committed.mutation_id,
        authoritative_ref: acceptedRef,
        handoff_ref: handoffRef,
        handoff
      });
    } catch (error) {
      if (lease) await abortProjectMutation(lease).catch(() => false);
      const handled = projectMutationErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }
  }

  if (action === 'supersede' && attempt.status === 'accepted') {
    const acceptedStateKey =
      'render:accepted:' + attempt.story_version + ':' + attempt.scene_id + ':' + attempt.shot_id;
    const handoffStateKey =
      'render:handoff:' + attempt.story_version + ':' + attempt.scene_id + ':' + attempt.shot_id;
    const authoritative = await readAuthoritativeProjectState<Record<string, any>>(
      attempt.project_id,
      acceptedStateKey
    );

    if (authoritative?.value?.attempt?.id === attempt.id) {
      let lease: ProjectMutationLease | null = null;
      try {
        lease = await acquireProjectMutation({
          projectId: attempt.project_id,
          mutationType: 'supersede-accepted-render',
          expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
            ? Number(body.expectedProjectRevision)
            : null,
          ttlMs: 30000
        });

        const superseded: RenderAttempt = {
          ...attempt,
          status: 'superseded',
          updated_at: new Date().toISOString()
        };

        const committed = await commitProjectMutation(
          lease,
          {
            story_version: attempt.story_version,
            scene_id: attempt.scene_id,
            shot_id: attempt.shot_id,
            attempt_id: attempt.id,
            reviewer_note: clean(body.note, 500) || null,
            removed_authoritative_acceptance: true
          },
          {
            [acceptedStateKey]: null,
            [handoffStateKey]: null,
            ['sequence:timeline:' + attempt.story_version + ':' + attempt.scene_id]: null
          }
        );

        await saveRenderAttempt(superseded);
        await appendRenderAttemptEvent(superseded, 'superseded', {
          project_revision: committed.revision,
          reviewer_note: clean(body.note, 500) || null,
          authoritative_acceptance_removed: true,
          timeline_invalidated: true
        });

        return json({
          ...superseded,
          project_revision: committed.revision,
          mutation_id: committed.mutation_id,
          authoritative_acceptance_removed: true,
          timeline_invalidated: true
        });
      } catch (error) {
        if (lease) await abortProjectMutation(lease).catch(() => false);
        const handled = projectMutationErrorResponse(error);
        if (handled) return json(handled.body, handled.status);
        throw error;
      }
    }
  }

  const updated: RenderAttempt = {
    ...attempt,
    status: nextStatus,
    provider_request_id: action === 'provider_started'
      ? clean(body.providerRequestId, 300) || attempt.provider_request_id
      : attempt.provider_request_id,
    asset_uri: action === 'result'
      ? clean(body.assetUri, 1800) || attempt.asset_uri
      : attempt.asset_uri,
    poster_uri: action === 'result'
      ? clean(body.posterUri, 1800) || attempt.poster_uri
      : attempt.poster_uri,
    actual_cost_usd: action === 'result' || action === 'failure'
      ? money(body.actualCostUsd) ?? attempt.actual_cost_usd
      : attempt.actual_cost_usd,
    latency_ms: action === 'result' || action === 'failure'
      ? (Number.isFinite(Number(body.latencyMs)) ? Math.max(0, Math.round(Number(body.latencyMs))) : attempt.latency_ms)
      : attempt.latency_ms,
    failure_class: action === 'failure' ? clean(body.failureClass, 120) || 'other' : attempt.failure_class,
    failure_detail: action === 'failure' ? clean(body.failureDetail, 1200) || 'Renderer reported failure.' : attempt.failure_detail,
    updated_at: new Date().toISOString()
  };

  if (action === 'result' && !updated.asset_uri) {
    return json({ error: 'assetUri is required when recording a successful render result.' }, 400);
  }

  await saveRenderAttempt(updated);
  await appendRenderAttemptEvent(updated, action, {
    reviewer_note: clean(body.note, 500) || null
  });

  return json(updated);
};

export const config = {
  path: '/api/render-attempts',
  rateLimit: {
    windowLimit: 240,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
