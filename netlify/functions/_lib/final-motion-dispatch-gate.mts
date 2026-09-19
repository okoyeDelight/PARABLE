import { validContentSha256, type KeyframeApproval, type KeyframeGateDecision } from './keyframe-approval-core.mts';

export type FinalMotionGateAttempt = {
  mode: 'draft' | 'final';
  project_id: string;
  story_version: string;
  scene_id: string;
  shot_id: string;
  spec_hash: string;
  provider: string;
  model: string;
  keyframe_approval_ref: string | null;
  keyframe_asset_uri: string | null;
  keyframe_asset_sha256?: string | null;
  keyframe_plan_hash: string | null;
};

export type FinalMotionGateSpec = {
  project_id: string;
  story_version: string;
  scene_id: string;
  shot_id: string;
  spec_hash: string;
  human_review: {
    required_before_final_render: boolean;
    reasons?: string[];
  };
};

export type FinalMotionGateRoute = {
  selected: {
    provider: string;
    model: string;
  } | null;
};

export type StoredKeyframeGate = KeyframeGateDecision & {
  authoritative_ref?: string | null;
};

export type FinalMotionDispatchDecision = {
  allowed: boolean;
  code:
    | 'OK'
    | 'HUMAN_REVIEW_REQUIRED'
    | 'RENDER_SPEC_CHANGED'
    | 'KEYFRAME_APPROVAL_REQUIRED'
    | 'KEYFRAME_APPROVAL_REVOKED'
    | 'KEYFRAME_SPEC_MISMATCH'
    | 'KEYFRAME_ASSET_NOT_IMMUTABLY_BOUND'
    | 'KEYFRAME_CHECKS_INCOMPLETE'
    | 'KEYFRAME_SCOPE_MISMATCH'
    | 'KEYFRAME_APPROVAL_CHANGED'
    | 'KEYFRAME_ASSET_HASH_MISMATCH'
    | 'NO_RENDERER_ROUTE'
    | 'RENDER_ROUTE_CHANGED';
  message: string;
};

const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

function scopedApprovalMatches(
  approval: KeyframeApproval,
  attempt: FinalMotionGateAttempt,
  spec: FinalMotionGateSpec
) {
  return (
    same(approval.project_id, attempt.project_id) &&
    same(approval.story_version, attempt.story_version) &&
    same(approval.scene_id, attempt.scene_id) &&
    same(approval.shot_id, attempt.shot_id) &&
    same(approval.project_id, spec.project_id) &&
    same(approval.story_version, spec.story_version) &&
    same(approval.scene_id, spec.scene_id) &&
    same(approval.shot_id, spec.shot_id)
  );
}

/**
 * Pure, fail-closed gate evaluated immediately before any final-motion provider
 * call. The caller must not contact a renderer unless this returns allowed=true.
 */
export function evaluateFinalMotionDispatchGate(args: {
  attempt: FinalMotionGateAttempt;
  spec: FinalMotionGateSpec;
  keyframeGate: StoredKeyframeGate | null;
  route: FinalMotionGateRoute;
}): FinalMotionDispatchDecision {
  const { attempt, spec, keyframeGate, route } = args;

  if (attempt.mode !== 'final') {
    return {
      allowed: true,
      code: 'OK',
      message: 'Draft motion does not consume the human-approved final-motion gate.'
    };
  }

  if (spec.human_review?.required_before_final_render) {
    return {
      allowed: false,
      code: 'HUMAN_REVIEW_REQUIRED',
      message: 'This final render remains blocked by unresolved human-review requirements.'
    };
  }

  if (!same(attempt.spec_hash, spec.spec_hash)) {
    return {
      allowed: false,
      code: 'RENDER_SPEC_CHANGED',
      message: 'The immutable render attempt no longer matches the current ShotRenderSpec.'
    };
  }

  if (!keyframeGate || !keyframeGate.allowed || !keyframeGate.approval) {
    return {
      allowed: false,
      code: (keyframeGate?.code || 'KEYFRAME_APPROVAL_REQUIRED') as FinalMotionDispatchDecision['code'],
      message: keyframeGate?.message || 'Final motion requires a current human-approved first frame.'
    };
  }

  const approval = keyframeGate.approval;
  if (!scopedApprovalMatches(approval, attempt, spec)) {
    return {
      allowed: false,
      code: 'KEYFRAME_SCOPE_MISMATCH',
      message: 'The approved first frame belongs to a different project, story, scene, or shot.'
    };
  }

  if (
    !keyframeGate.authoritative_ref ||
    !attempt.keyframe_approval_ref ||
    !same(attempt.keyframe_approval_ref, keyframeGate.authoritative_ref) ||
    !attempt.keyframe_asset_uri ||
    !same(attempt.keyframe_asset_uri, approval.asset.uri) ||
    !attempt.keyframe_plan_hash ||
    !same(attempt.keyframe_plan_hash, approval.keyframe_plan_hash)
  ) {
    return {
      allowed: false,
      code: 'KEYFRAME_APPROVAL_CHANGED',
      message: 'The authoritative first-frame approval changed after this final render attempt was created. Create a new attempt.'
    };
  }

  const approvedHash = String(approval.asset.content_sha256 || '').toLowerCase();
  const attemptHash = String(attempt.keyframe_asset_sha256 || '').toLowerCase();
  if (
    !approval.asset.immutable_binding ||
    !validContentSha256(approvedHash) ||
    !validContentSha256(attemptHash) ||
    approvedHash !== attemptHash ||
    approval.asset.uri !== 'parable://keyframe/' + approvedHash
  ) {
    return {
      allowed: false,
      code: 'KEYFRAME_ASSET_HASH_MISMATCH',
      message: 'The final-motion attempt is not cryptographically bound to the exact approved PARABLE keyframe bytes.'
    };
  }

  if (!route.selected) {
    return {
      allowed: false,
      code: 'NO_RENDERER_ROUTE',
      message: 'No deployed renderer currently satisfies this final ShotRenderSpec.'
    };
  }

  if (
    !same(route.selected.provider, attempt.provider) ||
    !same(route.selected.model, attempt.model)
  ) {
    return {
      allowed: false,
      code: 'RENDER_ROUTE_CHANGED',
      message: 'The immutable final attempt no longer matches the current provider/model route.'
    };
  }

  return {
    allowed: true,
    code: 'OK',
    message: 'Exact spec, human approval, immutable keyframe bytes and renderer route are locked for final motion.'
  };
}
