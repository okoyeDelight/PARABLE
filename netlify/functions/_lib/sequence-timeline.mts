import { stableHash } from './render-foundation.mts';

export type SequenceTimelineEntry = {
  order: number;
  shot_id: string;
  continuity_break_before: boolean;
  accepted_ref: string;
  handoff_ref: string | null;
  attempt_id: string;
  asset_uri: string;
  spec_hash: string;
  provider: string;
  model: string;
  accepted_by_human_override: boolean;
  full_motion_review_confirmed: boolean;
  known_motion_defects_acknowledged: boolean;
  qa_decision: string | null;
  motion_decision: string | null;
  motion_inspection_id: string | null;
  motion_sample_set_hash: string | null;
  handoff_frame_sha256: string | null;
};

export type SequenceTimeline = {
  timeline_version: 'parable-sequence-timeline-v1';
  timeline_hash: string;
  project_id: string;
  story_version: string;
  scene_id: string;
  adaptation_ref: string | null;
  spatial_plan_hash: string | null;
  shot_count: number;
  entries: SequenceTimelineEntry[];
  readiness: {
    ready_to_lock: boolean;
    blockers: string[];
    manual_exceptions: string[];
  };
  lock: {
    status: 'draft' | 'locked';
    approved_by_actor_id: string | null;
    approved_at: string | null;
    reviewer_note: string | null;
    manual_exceptions_accepted: boolean;
  };
  built_at: string;
};

const clean = (value: unknown, max = 1200) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function sequenceContinuityBreak(shot: Record<string, any>) {
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

export async function buildSequenceTimeline(args: {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shots: Array<Record<string, any>>;
  adaptationRef?: string | null;
  spatialPlan?: {
    hash: string | null;
    axisCritical: boolean;
    approvalStatus: string | null;
  } | null;
  accepted: Record<string, { ref: string; value: Record<string, any> } | null>;
  handoffs: Record<string, { ref: string; value: Record<string, any> } | null>;
  existing?: SequenceTimeline | null;
}) {
  const blockers: string[] = [];
  const manualExceptions: string[] = [];
  if (args.spatialPlan?.axisCritical && args.spatialPlan.approvalStatus !== 'approved') {
    blockers.push('The current camera-axis spatial plan is not human-approved.');
  }
  const ids = args.shots.map((shot, index) => clean(shot?.id || ('shot_' + (index + 1)), 96));
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) blockers.push('Shot plan contains duplicate shot ids: ' + [...new Set(duplicateIds)].join(', ') + '.');
  if (!ids.length) blockers.push('Sequence has no shots.');

  const entries: SequenceTimelineEntry[] = [];

  for (let index = 0; index < args.shots.length; index++) {
    const shot = args.shots[index] || {};
    const shotId = ids[index];
    const acceptedState = args.accepted[shotId];
    const handoffState = args.handoffs[shotId];
    const accepted = acceptedState?.value || null;
    const attempt = accepted?.attempt || null;
    const motion = accepted?.motion_inspection || null;

    if (!acceptedState || !attempt) {
      blockers.push('Shot ' + shotId + ' has no authoritative accepted render.');
      continue;
    }

    if (
      attempt.project_id !== args.projectId ||
      attempt.story_version !== args.storyVersion ||
      attempt.scene_id !== args.sceneId ||
      attempt.shot_id !== shotId
    ) {
      blockers.push('Shot ' + shotId + ' accepted render is bound to a different project/story/scene/shot.');
      continue;
    }

    if (attempt.status !== 'accepted') blockers.push('Shot ' + shotId + ' authoritative render is not in accepted state.');
    if (attempt.mode !== 'final') blockers.push('Shot ' + shotId + ' uses a draft render; only final renders may enter a locked sequence.');
    if (!clean(attempt.asset_uri, 1800)) blockers.push('Shot ' + shotId + ' accepted render has no media asset URI.');
    if (!clean(attempt.spec_hash, 96)) blockers.push('Shot ' + shotId + ' accepted render has no immutable spec hash.');

    const humanOverride = accepted?.accepted_by_human_override === true;
    const fullMotionReview = accepted?.full_motion_review_confirmed === true;
    const knownDefectsAccepted = accepted?.known_motion_defects_acknowledged === true;

    if (humanOverride) {
      if (!fullMotionReview) {
        blockers.push('Shot ' + shotId + ' was accepted by override without a recorded full-motion review confirmation.');
      } else {
        manualExceptions.push(
          'Shot ' + shotId + ' entered acceptance through a human full-motion override' +
          (knownDefectsAccepted ? ' with known defects explicitly acknowledged.' : '.')
        );
      }
    } else {
      if (!motion) blockers.push('Shot ' + shotId + ' has no bound full-motion inspection.');
      if (motion && motion.attempt_id !== attempt.id) blockers.push('Shot ' + shotId + ' motion inspection belongs to another attempt.');
      if (motion && motion.asset_uri !== attempt.asset_uri) blockers.push('Shot ' + shotId + ' motion inspection is bound to a different video asset.');
      if (motion && motion.spec_hash !== attempt.spec_hash) blockers.push('Shot ' + shotId + ' motion inspection is bound to a different render spec.');
      if (motion && motion.decision !== 'CLEAR_FOR_QA') blockers.push('Shot ' + shotId + ' motion inspection did not clear automated QA.');
      if (accepted?.qa?.decision !== 'PASS') blockers.push('Shot ' + shotId + ' did not receive a QA PASS.');
    }

    const nextShot = args.shots[index + 1] || null;
    const needsHandoff = Boolean(nextShot && !sequenceContinuityBreak(nextShot));
    const handoff = handoffState?.value || null;

    if (needsHandoff) {
      if (!handoff) {
        blockers.push('Shot ' + shotId + ' needs a trusted handoff frame for the continuous next shot.');
      } else {
        if (handoff.attempt_id !== attempt.id) blockers.push('Shot ' + shotId + ' handoff belongs to another render attempt.');
        if (handoff.spec_hash !== attempt.spec_hash) blockers.push('Shot ' + shotId + ' handoff belongs to another render spec.');
        if (!/^[a-f0-9]{64}$/i.test(clean(handoff?.handoff_frame?.sha256, 64))) {
          blockers.push('Shot ' + shotId + ' continuous handoff is missing an immutable final-frame hash.');
        }
      }
    }

    entries.push({
      order: index + 1,
      shot_id: shotId,
      continuity_break_before: sequenceContinuityBreak(shot),
      accepted_ref: acceptedState.ref,
      handoff_ref: handoffState?.ref || null,
      attempt_id: clean(attempt.id, 180),
      asset_uri: clean(attempt.asset_uri, 1800),
      spec_hash: clean(attempt.spec_hash, 96),
      provider: clean(attempt.provider, 80),
      model: clean(attempt.model, 240),
      accepted_by_human_override: humanOverride,
      full_motion_review_confirmed: fullMotionReview,
      known_motion_defects_acknowledged: knownDefectsAccepted,
      qa_decision: clean(accepted?.qa?.decision, 40) || null,
      motion_decision: clean(motion?.decision, 60) || null,
      motion_inspection_id: clean(motion?.id, 180) || null,
      motion_sample_set_hash: clean(motion?.sample_set_hash, 96) || null,
      handoff_frame_sha256: clean(handoff?.handoff_frame?.sha256, 64) || null
    });
  }

  const unsigned = {
    timeline_version: 'parable-sequence-timeline-v1' as const,
    project_id: args.projectId,
    story_version: args.storyVersion,
    scene_id: args.sceneId,
    adaptation_ref: args.adaptationRef || null,
    spatial_plan_hash: args.spatialPlan?.hash || null,
    spatial_plan_approval_status: args.spatialPlan?.approvalStatus || null,
    shot_count: args.shots.length,
    entries,
    readiness: {
      ready_to_lock: blockers.length === 0,
      blockers: [...new Set(blockers)],
      manual_exceptions: [...new Set(manualExceptions)]
    }
  };

  const timelineHash = await stableHash(unsigned);
  const sameAsExisting = args.existing?.timeline_hash === timelineHash;

  return {
    ...unsigned,
    timeline_hash: timelineHash,
    lock: sameAsExisting && args.existing?.lock?.status === 'locked'
      ? args.existing.lock
      : {
          status: 'draft' as const,
          approved_by_actor_id: null,
          approved_at: null,
          reviewer_note: null,
          manual_exceptions_accepted: false
        },
    built_at: new Date().toISOString()
  } satisfies SequenceTimeline;
}
