export type KeyframeApprovalChecks = {
  identity: boolean;
  wardrobe_and_injuries: boolean;
  props: boolean;
  spatial_geography: boolean;
  composition: boolean;
  lighting: boolean;
  cultural_grounding: boolean;
  unwanted_text_or_artifacts: boolean;
};

export type KeyframeApproval = {
  approval_version: 'parable-keyframe-approval-v1';
  status: 'approved' | 'revoked';
  project_id: string;
  story_version: string;
  scene_id: string;
  shot_id: string;
  spec_hash: string;
  keyframe_plan_hash: string;
  asset: {
    uri: string;
    source: 'generated' | 'uploaded' | 'external';
    provider: string | null;
    model: string | null;
    content_sha256: string | null;
    immutable_binding: boolean;
  };
  checks: KeyframeApprovalChecks;
  reviewer: {
    human_approved: true;
    note: string | null;
  };
  visual_inspection: {
    inspection_id: string | null;
    decision: string | null;
    overridden_by_human: boolean;
  };
  approved_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};

export type KeyframeGateDecision = {
  allowed: boolean;
  code:
    | 'OK'
    | 'KEYFRAME_APPROVAL_REQUIRED'
    | 'KEYFRAME_APPROVAL_REVOKED'
    | 'KEYFRAME_SPEC_MISMATCH'
    | 'KEYFRAME_ASSET_NOT_IMMUTABLY_BOUND'
    | 'KEYFRAME_CHECKS_INCOMPLETE';
  message: string;
  approval: KeyframeApproval | null;
};

const sha256Pattern = /^[a-f0-9]{64}$/i;

export function allKeyframeChecksPassed(checks: KeyframeApprovalChecks) {
  return Object.values(checks).every(Boolean);
}

export function normalizeKeyframeChecks(input: Record<string, unknown> | null | undefined): KeyframeApprovalChecks {
  const value = input || {};
  return {
    identity: value.identity === true,
    wardrobe_and_injuries: value.wardrobe_and_injuries === true,
    props: value.props === true,
    spatial_geography: value.spatial_geography === true,
    composition: value.composition === true,
    lighting: value.lighting === true,
    cultural_grounding: value.cultural_grounding === true,
    unwanted_text_or_artifacts: value.unwanted_text_or_artifacts === true
  };
}

export function validContentSha256(value: unknown) {
  return sha256Pattern.test(String(value || '').trim());
}

export function evaluateKeyframeGate(
  approval: KeyframeApproval | null,
  expectedSpecHash: string
): KeyframeGateDecision {
  if (!approval) {
    return {
      allowed: false,
      code: 'KEYFRAME_APPROVAL_REQUIRED',
      message: 'Final motion is blocked until a human approves a first-frame asset for this exact shot specification.',
      approval: null
    };
  }

  if (approval.status !== 'approved') {
    return {
      allowed: false,
      code: 'KEYFRAME_APPROVAL_REVOKED',
      message: 'The previously approved first frame was revoked. Approve a new first frame before final motion.',
      approval
    };
  }

  if (approval.spec_hash !== expectedSpecHash) {
    return {
      allowed: false,
      code: 'KEYFRAME_SPEC_MISMATCH',
      message: 'The shot changed after first-frame approval. The old approval cannot authorize a different ShotRenderSpec.',
      approval
    };
  }

  if (!approval.asset.immutable_binding && !validContentSha256(approval.asset.content_sha256)) {
    return {
      allowed: false,
      code: 'KEYFRAME_ASSET_NOT_IMMUTABLY_BOUND',
      message: 'The approved image is not immutably bound. Provide a content SHA-256 or explicitly bind an immutable generated/uploaded asset.',
      approval
    };
  }

  if (!allKeyframeChecksPassed(approval.checks)) {
    return {
      allowed: false,
      code: 'KEYFRAME_CHECKS_INCOMPLETE',
      message: 'The first frame has not passed every required human canon check.',
      approval
    };
  }

  return {
    allowed: true,
    code: 'OK',
    message: 'The exact first frame and shot specification are human-approved for final motion.',
    approval
  };
}
