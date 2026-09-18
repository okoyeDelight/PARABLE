import assert from 'node:assert/strict';
import {
  buildVisualCanon,
  buildKeyframePlan,
  compileShotRenderSpec,
  evaluateRenderQA
} from '../netlify/functions/_lib/render-foundation.mts';
import { prepareRendererRequest } from '../netlify/functions/_lib/render-adapters.mts';
import { evaluateKeyframeGate } from '../netlify/functions/_lib/keyframe-approval-core.mts';
import { routeRenderSpec } from '../netlify/functions/_lib/render-router.mts';
import { buildKeyframeGenerationPlan } from '../netlify/functions/_lib/keyframe-generation-core.mts';
import { validateMotionEvidence } from '../netlify/functions/_lib/motion-inspector-ai.mts';
import {
  defaultRenderBudgetPolicy,
  evaluateRenderBudget,
  normalizeRenderBudgetPolicy,
  summarizeRenderBudget
} from '../netlify/functions/_lib/render-budget-core.mts';

const continuity = {
  entities: {
    character_daniel: {
      id: 'character_daniel',
      name: 'Daniel',
      kind: 'character',
      facts: {
        actor_face_ref: {
          value: 'https://example.com/daniel-face.jpg',
          locked: true,
          basis: 'human',
          note: 'Approved casting reference.'
        },
        clothing: {
          value: 'cream shirt',
          locked: false,
          basis: 'explicit'
        }
      }
    },
    location_family_house: {
      id: 'location_family_house',
      name: 'Family House',
      kind: 'location',
      facts: {
        location_visual_ref: {
          value: 'https://example.com/family-house.jpg',
          locked: true,
          basis: 'human'
        }
      }
    }
  }
};

const canon = buildVisualCanon({
  projectId: 'project_smoke',
  storyVersion: 'story_smoke',
  productionBible: {
    characters: [{ name: 'Daniel' }],
    locations: [{ name: 'Family House' }]
  },
  continuity
});

assert.equal(canon.characters.length, 1);
assert.equal(canon.locations.length, 1);
assert.equal(canon.characters[0].references.length, 1);

for (const entity of [...canon.characters, ...canon.locations]) {
  for (const reference of entity.references) {
    reference.rights_status = 'approved';
    reference.approved_by_human = true;
    reference.asset_sha256 = reference.id.padEnd(64, 'a').slice(0, 64).replace(/[^a-f0-9]/g, 'a');
    reference.immutable_asset_uri = 'parable://canon/' + reference.asset_sha256;
    reference.rights_provenance = {
      status: 'approved',
      basis: 'generated',
      rights_holder: 'PARABLE smoke test',
      likeness_permission: true,
      voice_permission: true,
      ai_generation_permission: true,
      commercial_use: true,
      territories: ['global'],
      expires_at: null,
      evidence_sha256: null,
      declared_by_actor_id: 'usr_smoke',
      declared_at: '2026-09-18T00:00:00.000Z',
      revoked_at: null
    };
  }
}
canon.unresolved_rights = [];

canon.characters[0].references.push({
  id: 'ref_christian_film_inspiration',
  kind: 'actor-visual',
  uri: 'https://example.com/christian-film-character.jpg',
  label: 'Christian film casting inspiration',
  rights_status: 'unverified',
  approved_by_human: true,
  source: 'external',
  render_usage: 'inspiration-only',
  origin: 'official-media',
  source_title: 'Reference Film',
  source_creator: 'Christian Film Studio',
  source_url: 'https://example.com/official-film-page',
  notes: 'Study restrained performance and grounded Nigerian Christian-film production tone; do not reproduce the actor.'
});

const spec = await compileShotRenderSpec({
  projectRevision: 12,
  canon,
  renderPackage: {
    project_id: 'project_smoke',
    story_version: 'story_smoke',
    scene_id: 'scene_4',
    shot_id: 'shot_2',
    shot: {
      beat: 'Daniel stands alone after everyone leaves the room. The empty chair dominates the silence.',
      purpose: 'Make the absence physically felt.',
      performance: 'He holds himself together; no crying.',
      blocking: 'Daniel remains still near the edge of the room.',
      shot_type: 'medium-wide',
      lens_mm: 50,
      motion: 'very slow push-in',
      lighting: 'soft window light from camera left',
      duration_seconds: 7
    },
    continuity_before: { clothing: 'cream shirt', prop: 'keys on table' },
    shot_transitions: null,
    continuity_after: { clothing: 'cream shirt', prop: 'keys on table' },
    hard_constraints: {
      preserve_identity: true,
      preserve_wardrobe: true,
      preserve_prop_ownership: true
    },
    can_render: true,
    human_review_recommended: false
  }
});

assert.equal(spec.composition.grammar, 'negative_space');
assert.equal(spec.composition.narrative_intent, 'isolation');
assert.equal(spec.output.audio_strategy, 'separate-stems');
assert.equal(spec.references.length, 2);
assert.equal(spec.inspiration_references?.length, 1);
assert.equal(spec.human_review.required_before_final_render, false);

const generationPlan = buildKeyframeGenerationPlan({
  spec,
  model: 'google/gemini-3.1-flash-image'
});
assert.equal(generationPlan.input_references.length, 2);
assert.equal(generationPlan.reference_ids.includes('ref_christian_film_inspiration'), false);
assert.equal(generationPlan.inspiration_notes.length, 1);
assert.match(generationPlan.prompt, /do not reproduce a recognizable actor/i);

const handoffSpec:any = {
  ...spec,
  world_state: {
    ...spec.world_state,
    previous_accepted_handoff: {
      handoff_version: 'parable-shot-handoff-v1',
      shot_id: 'shot_1',
      handoff_frame: {
        uri: 'https://example.com/immutable-handoff.jpg',
        timestamp_seconds: 6.9,
        sha256: 'b'.repeat(64)
      }
    }
  },
  hard_constraints: {
    ...spec.hard_constraints,
    match_previous_accepted_handoff: true
  }
};

const handoffGenerationPlan = buildKeyframeGenerationPlan({
  spec: handoffSpec,
  model: 'google/gemini-3.1-flash-image'
});
assert.equal(handoffGenerationPlan.input_references[0]?.image_url?.url, 'https://example.com/immutable-handoff.jpg');
assert.equal(handoffGenerationPlan.reference_ids[0], 'sequence-handoff:shot_1');
assert.match(handoffGenerationPlan.prompt, /previous accepted shot handoff/i);

const keyframe = buildKeyframePlan(spec);
assert.equal(keyframe.first_frame.composition.grammar, 'negative_space');
assert.equal(keyframe.final_motion_render_blocked_until_approved, true);
assert.ok(keyframe.acceptance_checklist.length >= 6);

const keyframeApproval = {
  approval_version: 'parable-keyframe-approval-v1' as const,
  status: 'approved' as const,
  project_id: spec.project_id,
  story_version: spec.story_version,
  scene_id: spec.scene_id,
  shot_id: spec.shot_id,
  spec_hash: spec.spec_hash,
  keyframe_plan_hash: 'plan_hash_smoke',
  asset: {
    uri: 'https://example.com/approved-first-frame.jpg',
    source: 'generated' as const,
    provider: 'fal',
    model: 'test-image-model',
    content_sha256: 'a'.repeat(64),
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
  reviewer: {
    human_approved: true as const,
    note: 'Smoke-test approval.'
  },
  visual_inspection: {
    inspection_id: 'inspect_smoke',
    decision: 'CLEAR_FOR_HUMAN_REVIEW',
    overridden_by_human: false
  },
  approved_at: '2026-09-18T10:00:00.000Z',
  revoked_at: null,
  revoke_reason: null
};

assert.equal(evaluateKeyframeGate(null, spec.spec_hash).code, 'KEYFRAME_APPROVAL_REQUIRED');
assert.equal(evaluateKeyframeGate(keyframeApproval, spec.spec_hash).allowed, true);
assert.equal(
  evaluateKeyframeGate({ ...keyframeApproval, spec_hash: 'different_spec' }, spec.spec_hash).code,
  'KEYFRAME_SPEC_MISMATCH'
);

assert.throws(() => prepareRendererRequest({
  spec,
  provider: 'fal',
  model: 'bytedance/seedance-2.0/us/image-to-video',
  mode: 'final'
}), /approved first-frame/i);

const prepared = prepareRendererRequest({
  spec,
  provider: 'fal',
  model: 'bytedance/seedance-2.0/us/image-to-video',
  mode: 'final',
  approvedKeyframe: keyframeApproval
});

assert.equal(prepared.provider, 'fal');
assert.equal(prepared.body.generate_audio, false);
assert.equal(prepared.body.image_url, keyframeApproval.asset.uri);
assert.equal(prepared.reference_map[0].kind, 'approved-first-frame');
assert.match(String(prepared.body.prompt), /approved-first-frame/i);

const badRoute = routeRenderSpec(spec, [{
  provider: 'fal',
  model: 'reference-only',
  configured: true,
  supports: {
    text_to_video: true,
    image_to_video: true,
    reference_video: true,
    multi_reference: true,
    native_audio: false,
    first_frame_conditioning: false,
    max_reference_slots: 12
  },
  operating: {
    quality_score: 0.9,
    continuity_score: 0.9,
    reliability_score: 0.9,
    latency_score: 0.9,
    cost_score: 0.9
  },
  notes: []
}]);
assert.equal(badRoute.selected, null);

const goodRoute = routeRenderSpec(spec, [{
  provider: 'fal',
  model: 'bytedance/seedance-2.0/us/image-to-video',
  configured: true,
  supports: {
    text_to_video: false,
    image_to_video: true,
    reference_video: false,
    multi_reference: false,
    native_audio: false,
    first_frame_conditioning: true,
    max_reference_slots: 1
  },
  operating: {
    quality_score: 0.5,
    continuity_score: 0.5,
    reliability_score: 0.5,
    latency_score: 0.5,
    cost_score: 0.5
  },
  notes: []
}]);
assert.equal(goodRoute.selected?.model, 'bytedance/seedance-2.0/us/image-to-video');

const budgetEvents = [
  {
    attempt_id: 'render_a',
    shot_id: 'shot_2',
    scene_id: 'scene_4',
    mode: 'draft',
    estimated_cost_usd: 0.2,
    actual_cost_usd: null,
    at: '2026-09-18T09:00:00.000Z'
  },
  {
    attempt_id: 'render_a',
    shot_id: 'shot_2',
    scene_id: 'scene_4',
    mode: 'draft',
    estimated_cost_usd: 0.2,
    actual_cost_usd: 0.18,
    at: '2026-09-18T09:01:00.000Z'
  },
  {
    attempt_id: 'render_b',
    shot_id: 'shot_2',
    scene_id: 'scene_4',
    mode: 'final',
    estimated_cost_usd: 0.8,
    actual_cost_usd: null,
    at: '2026-09-18T09:02:00.000Z'
  }
];

const budgetSummary = summarizeRenderBudget({
  projectId: 'project_smoke',
  storyVersion: 'story_smoke',
  events: budgetEvents
});
assert.equal(budgetSummary.attempts_observed, 2);
assert.equal(budgetSummary.shots.shot_2.attempts, 2);
assert.equal(budgetSummary.actual_cost_usd, 0.18);
assert.equal(budgetSummary.committed_or_estimated_cost_usd, 0.98);

const budgetPolicy = normalizeRenderBudgetPolicy('project_smoke', {
  ...defaultRenderBudgetPolicy('project_smoke'),
  max_estimated_cost_per_shot_usd: 2,
  max_estimated_cost_per_project_usd: 5,
  approval_required_over_usd: 1
});

const budgetOk = evaluateRenderBudget({
  policy: budgetPolicy,
  summary: budgetSummary,
  shotId: 'shot_2',
  mode: 'draft',
  estimatedCostUsd: 0.4
});
assert.equal(budgetOk.allowed, true);

const approvalRequired = evaluateRenderBudget({
  policy: budgetPolicy,
  summary: budgetSummary,
  shotId: 'shot_2',
  mode: 'final',
  estimatedCostUsd: 1.2
});
assert.equal(approvalRequired.allowed, false);
assert.equal(approvalRequired.code, 'RENDER_SHOT_BUDGET_EXCEEDED');

const missingEstimate = evaluateRenderBudget({
  policy: budgetPolicy,
  summary: budgetSummary,
  shotId: 'shot_3',
  mode: 'draft',
  estimatedCostUsd: null
});
assert.equal(missingEstimate.code, 'RENDER_COST_ESTIMATE_REQUIRED');

const motionAttempt:any = {
  id: 'render_motion_smoke',
  project_id: spec.project_id,
  story_version: spec.story_version,
  scene_id: spec.scene_id,
  shot_id: spec.shot_id,
  spec_hash: spec.spec_hash,
  asset_uri: 'https://example.com/render.mp4',
  keyframe_asset_uri: keyframeApproval.asset.uri,
  mode: 'final',
  status: 'succeeded'
};

const motionEvidence = validateMotionEvidence({
  attempt: motionAttempt,
  spec,
  approvedFirstFrameUri: keyframeApproval.asset.uri,
  frames: [
    { uri: 'https://example.com/frame-0.jpg', timestamp_seconds: 0.05, role: 'first' },
    { uri: 'https://example.com/frame-1.jpg', timestamp_seconds: 3.5, role: 'sample' },
    { uri: 'https://example.com/frame-2.jpg', timestamp_seconds: 6.6, role: 'handoff' }
  ]
});
assert.equal(motionEvidence.valid, true);
assert.ok(motionEvidence.coverage_ratio >= 0.9);

const incompleteMotionEvidence = validateMotionEvidence({
  attempt: motionAttempt,
  spec,
  approvedFirstFrameUri: keyframeApproval.asset.uri,
  frames: [
    { uri: 'https://example.com/frame-a.jpg', timestamp_seconds: 2.5, role: 'sample' },
    { uri: 'https://example.com/frame-b.jpg', timestamp_seconds: 3.5, role: 'sample' }
  ]
});
assert.equal(incompleteMotionEvidence.valid, false);
assert.ok(incompleteMotionEvidence.errors.some((item) => /three trusted temporal samples/i.test(item)));

const pass = evaluateRenderQA('render_pass', {
  identity: 0.96,
  wardrobe: 0.97,
  prop_continuity: 0.95,
  spatial_continuity: 0.94,
  composition: 0.91,
  motion: 0.88,
  lighting: 0.9,
  technical: 0.93,
  cultural_grounding: 0.9,
  performance_intent: 0.92
});
assert.equal(pass.decision, 'PASS');

const repair = evaluateRenderQA('render_repair', {
  identity: 0.94,
  wardrobe: 0.62,
  prop_continuity: 0.91,
  spatial_continuity: 0.9,
  composition: 0.64,
  technical: 0.9,
  cultural_grounding: 0.9,
  performance_intent: 0.91
});
assert.equal(repair.decision, 'REPAIR');
assert.ok(repair.repair_plan.some((item) => item.target === 'wardrobe'));
assert.ok(repair.repair_plan.some((item) => item.target === 'composition'));

console.log(JSON.stringify({
  ok: true,
  canon_version: canon.canon_version,
  render_spec_version: spec.render_spec_version,
  composition: spec.composition.grammar,
  spec_hash: spec.spec_hash.slice(0, 16),
  final_reference_count: prepared.reference_map.length,
  inspiration_reference_count: spec.inspiration_references?.length || 0,
  generation_reference_count: generationPlan.input_references.length,
  sequence_handoff_reference_count: handoffGenerationPlan.input_references.length,
  sequence_handoff_first_reference: handoffGenerationPlan.reference_ids[0],
  keyframe_gate: keyframe.final_motion_render_blocked_until_approved,
  persisted_keyframe_gate: evaluateKeyframeGate(keyframeApproval, spec.spec_hash).code,
  first_frame_route: goodRoute.selected?.model,
  motion_evidence_valid: motionEvidence.valid,
  incomplete_motion_evidence_blocked: !incompleteMotionEvidence.valid,
  budget_attempts_observed: budgetSummary.attempts_observed,
  budget_guard: missingEstimate.code,
  qa_pass: pass.decision,
  qa_repair: repair.decision
}, null, 2));
