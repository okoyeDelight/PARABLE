import assert from 'node:assert/strict';
import { prepareRendererRequest } from '../netlify/functions/_lib/render-adapters.mts';

const spec: any = {
  project_id: 'proj',
  story_version: 'story',
  scene_id: 'scene',
  shot_id: 'shot',
  spec_hash: 'spec123',
  narrative: { beat: 'Daniel waits in silence.', dramatic_purpose: 'Hold tension.', emotional_intent: 'Restrained fear.' },
  camera: { shot_type: 'medium close-up', lens_mm: 50, motion: 'slow push', height: null, axis_rule: 'preserve-established-axis' },
  composition: {
    grammar: 'negative_space', reason: 'Isolation', subject_anchor: { x: 0.3, y: 0.5 },
    narrative_intent: 'isolation', primary_subject: 'Daniel', secondary_subjects: [],
    gaze_direction: 'left', gaze_room: 0.2, negative_space: 0.6, symmetry: 0.1,
    foreground_layers: 1, background_depth: 'medium', frame_within_frame: null,
    dominant_lines: [], safe_crop_zone: { x_min: 0.1, x_max: 0.9, y_min: 0.1, y_max: 0.9 }, intensity: 0.5
  },
  lighting: { direction: 'single motivated practical', continuity_requirements: [] },
  performance: { direction: 'restrained', restraint: 0.8, forbidden_performance_shortcuts: [] },
  world_state: {},
  references: [],
  inspiration_references: [],
  hard_constraints: { preserve_visual_canon: true },
  negative_constraints: ['No identity drift.'],
  output: { media_type: 'video', duration_seconds: 5, aspect_ratio: '16:9', delivery_resolution: '1080p', fps: 24, audio_strategy: 'separate-stems', first_frame_required: true },
  provider_requirements: { reference_images: false, reference_video: false, native_audio: false, multi_reference: false, minimum_reference_slots: 0 },
  human_review: { required_before_final_render: false, reasons: [] }
};

const approval: any = {
  status: 'approved',
  spec_hash: 'spec123',
  shot_id: 'shot',
  asset: { uri: 'https://example.com/approved-first-frame.jpg' }
};

const finalReq = prepareRendererRequest({
  spec,
  provider: 'higgsfield',
  model: 'bytedance/seedance-2.5/image-to-video',
  mode: 'final',
  approvedKeyframe: approval
});
assert.equal(finalReq.provider, 'higgsfield');
assert.equal(finalReq.body.image_url, approval.asset.uri);
assert.equal(finalReq.body.generate_audio, false);
assert.equal(finalReq.body.output_format, 'mp4');
assert.equal(finalReq.body.duration, 5);

assert.throws(() => prepareRendererRequest({
  spec,
  provider: 'higgsfield',
  model: 'bytedance/seedance-2.5/image-to-video',
  mode: 'final',
  approvedKeyframe: null
}), /approved first-frame/i);

const draftReq = prepareRendererRequest({
  spec,
  provider: 'higgsfield',
  model: 'bytedance/seedance-2.5/reference-to-video',
  mode: 'draft',
  approvedKeyframe: null
});
assert.equal(draftReq.body.resolution, '480p');
assert.equal(draftReq.body.generate_audio, false);

console.log('PARABLE_HIGGSFIELD_ADAPTER_SMOKE_PASS');
