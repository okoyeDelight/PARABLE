import assert from 'node:assert/strict';
import { evaluateFinalMotionDispatchGate } from '../netlify/functions/_lib/final-motion-dispatch-gate.mts';

const hash = 'a'.repeat(64);
const spec:any = {
  project_id: 'project_lock',
  story_version: 'story_v1',
  scene_id: 'scene_1',
  shot_id: 'shot_1',
  spec_hash: 'spec_hash_locked',
  human_review: { required_before_final_render: false, reasons: [] }
};
const approval:any = {
  approval_version: 'parable-keyframe-approval-v1',
  status: 'approved',
  project_id: spec.project_id,
  story_version: spec.story_version,
  scene_id: spec.scene_id,
  shot_id: spec.shot_id,
  spec_hash: spec.spec_hash,
  keyframe_plan_hash: 'plan_locked',
  asset: {
    uri: 'parable://keyframe/' + hash,
    source: 'generated',
    provider: 'fal',
    model: 'image-model',
    content_sha256: hash,
    immutable_binding: true
  },
  checks: {
    identity: true,
    wardrobe_and_injuries: true,
    props: true,
    spatial_geography: true,
    composition: true,
    lighting: true,
    cultural_grounding: true,
    unwanted_text_or_artifacts: true
  },
  reviewer: { human_approved: true, note: 'approved' },
  visual_inspection: { inspection_id: 'inspect_1', decision: 'CLEAR_FOR_HUMAN_REVIEW', overridden_by_human: false },
  approved_at: '2026-09-19T00:00:00.000Z',
  revoked_at: null,
  revoke_reason: null
};
const attempt:any = {
  mode: 'final',
  project_id: spec.project_id,
  story_version: spec.story_version,
  scene_id: spec.scene_id,
  shot_id: spec.shot_id,
  spec_hash: spec.spec_hash,
  provider: 'higgsfield',
  model: 'bytedance/seedance-2.5/image-to-video',
  keyframe_approval_ref: 'artifact://approval/locked',
  keyframe_asset_uri: approval.asset.uri,
  keyframe_asset_sha256: hash,
  keyframe_plan_hash: approval.keyframe_plan_hash
};
const gate:any = {
  allowed: true,
  code: 'OK',
  message: 'ok',
  approval,
  authoritative_ref: attempt.keyframe_approval_ref
};
const route:any = {
  selected: { provider: attempt.provider, model: attempt.model }
};

const good = evaluateFinalMotionDispatchGate({ attempt, spec, keyframeGate: gate, route });
assert.equal(good.allowed, true);

const blockedCases = [
  ['missing approval', { keyframeGate: { allowed:false, code:'KEYFRAME_APPROVAL_REQUIRED', message:'missing', approval:null, authoritative_ref:null } }, 'KEYFRAME_APPROVAL_REQUIRED'],
  ['revoked approval', { keyframeGate: { ...gate, allowed:false, code:'KEYFRAME_APPROVAL_REVOKED', message:'revoked', approval:{...approval,status:'revoked'} } }, 'KEYFRAME_APPROVAL_REVOKED'],
  ['spec changed', { attempt: { ...attempt, spec_hash:'old_spec' } }, 'RENDER_SPEC_CHANGED'],
  ['scope swap', { keyframeGate: { ...gate, approval:{...approval,shot_id:'shot_other'} } }, 'KEYFRAME_SCOPE_MISMATCH'],
  ['approval ref swap', { attempt: { ...attempt, keyframe_approval_ref:'artifact://approval/other' } }, 'KEYFRAME_APPROVAL_CHANGED'],
  ['asset uri swap', { attempt: { ...attempt, keyframe_asset_uri:'parable://keyframe/' + 'b'.repeat(64) } }, 'KEYFRAME_APPROVAL_CHANGED'],
  ['plan hash swap', { attempt: { ...attempt, keyframe_plan_hash:'different_plan' } }, 'KEYFRAME_APPROVAL_CHANGED'],
  ['asset hash swap', { attempt: { ...attempt, keyframe_asset_sha256:'b'.repeat(64) } }, 'KEYFRAME_ASSET_HASH_MISMATCH'],
  ['missing asset hash', { attempt: { ...attempt, keyframe_asset_sha256:null } }, 'KEYFRAME_ASSET_HASH_MISMATCH'],
  ['noncanonical approved uri', { keyframeGate: { ...gate, approval:{...approval,asset:{...approval.asset,uri:'https://example.com/frame.jpg'}} }, attempt:{...attempt,keyframe_asset_uri:'https://example.com/frame.jpg'} }, 'KEYFRAME_ASSET_HASH_MISMATCH'],
  ['route missing', { route:{selected:null} }, 'NO_RENDERER_ROUTE'],
  ['provider changed', { route:{selected:{provider:'fal',model:attempt.model}} }, 'RENDER_ROUTE_CHANGED'],
  ['model changed', { route:{selected:{provider:attempt.provider,model:'other/model'}} }, 'RENDER_ROUTE_CHANGED'],
  ['human review reopened', { spec:{...spec,human_review:{required_before_final_render:true,reasons:['rights']}} }, 'HUMAN_REVIEW_REQUIRED']
] as const;

let providerCalls = 0;
for (const [name, patch, expectedCode] of blockedCases) {
  const decision = evaluateFinalMotionDispatchGate({
    attempt: (patch as any).attempt || attempt,
    spec: (patch as any).spec || spec,
    keyframeGate: (patch as any).keyframeGate || gate,
    route: (patch as any).route || route
  });
  assert.equal(decision.allowed, false, name);
  assert.equal(decision.code, expectedCode, name);
  if (decision.allowed) providerCalls += 1;
}
assert.equal(providerCalls, 0, 'No denied case may reach a provider');

console.log(JSON.stringify({
  ok: true,
  gate: good.code,
  adversarial_cases_blocked: blockedCases.length,
  provider_calls_from_denied_cases: providerCalls
}, null, 2));
