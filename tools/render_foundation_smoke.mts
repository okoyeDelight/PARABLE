import assert from 'node:assert/strict';
import {
  buildVisualCanon,
  buildKeyframePlan,
  compileShotRenderSpec,
  evaluateRenderQA
} from '../netlify/functions/_lib/render-foundation.mts';
import { prepareRendererRequest } from '../netlify/functions/_lib/render-adapters.mts';
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
  }
}
canon.unresolved_rights = [];

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
assert.equal(spec.human_review.required_before_final_render, false);

const keyframe = buildKeyframePlan(spec);
assert.equal(keyframe.first_frame.composition.grammar, 'negative_space');
assert.equal(keyframe.final_motion_render_blocked_until_approved, true);
assert.ok(keyframe.acceptance_checklist.length >= 6);

const prepared = prepareRendererRequest({
  spec,
  provider: 'fal',
  model: 'bytedance/seedance-2.0/us/reference-to-video',
  mode: 'final'
});

assert.equal(prepared.provider, 'fal');
assert.equal(prepared.body.generate_audio, false);
assert.equal(Array.isArray(prepared.body.image_urls), true);
assert.equal((prepared.body.image_urls as string[]).length, 2);
assert.match(String(prepared.body.prompt), /negative_space/);

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
  keyframe_gate: keyframe.final_motion_render_blocked_until_approved,
  budget_attempts_observed: budgetSummary.attempts_observed,
  budget_guard: missingEstimate.code,
  qa_pass: pass.decision,
  qa_repair: repair.decision
}, null, 2));
