import type { CanonReference, ShotRenderSpec } from './render-foundation.mts';
import type { KeyframeApproval } from './keyframe-approval-core.mts';
import { referenceAllowedForRender, runtimeRightsEnforcementMode } from './rights-policy.mts';

export type PreparedRendererRequest = {
  provider: 'fal' | 'higgsfield' | 'runway' | 'external';
  model: string;
  request_url: string | null;
  body: Record<string, unknown>;
  reference_map: Array<{
    token: string;
    reference_id: string;
    kind: string;
    uri: string;
  }>;
  notes: string[];
};

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function usableReferences(spec: ShotRenderSpec, mode: 'draft' | 'final') {
  const rightsMode = runtimeRightsEnforcementMode();
  return spec.references.filter((ref) => {
    if (ref.render_usage === 'inspiration-only' || ref.render_usage === 'benchmark-only') return false;
    return referenceAllowedForRender({
      rightsStatus: ref.rights_status,
      approvedByHuman: ref.approved_by_human,
      mode: rightsMode
    });
  });
}

function visualReference(ref: CanonReference) {
  return ['actor-face', 'actor-visual', 'wardrobe', 'location-visual', 'location-layout', 'location-lighting', 'prop-visual', 'style'].includes(ref.kind);
}

function videoReference(ref: CanonReference) {
  return ref.kind === 'performance';
}

function promptFor(spec: ShotRenderSpec, refMap: PreparedRendererRequest['reference_map']) {
  const refs = refMap.length
    ? '\nREFERENCE CONTRACT:\n' + refMap.map((item) =>
        item.token + ' = ' + item.kind + ' reference "' + item.reference_id + '". Preserve its canonical identity/content.'
      ).join('\n')
    : '';

  const lines = [
    'PARABLE SHOT RENDER CONTRACT.',
    'Generate one coherent cinematic shot. Do not rewrite the story or invent new characters/props.',
    '',
    'DRAMATIC BEAT: ' + clean(spec.narrative.beat, 1200),
    'DRAMATIC PURPOSE: ' + clean(spec.narrative.dramatic_purpose, 800),
    'EMOTIONAL INTENT: ' + clean(spec.narrative.emotional_intent, 800),
    '',
    'CAMERA: ' + [
      spec.camera.shot_type,
      spec.camera.lens_mm ? String(spec.camera.lens_mm) + 'mm lens' : '',
      spec.camera.motion,
      spec.camera.height || '',
      spec.camera.axis_rule || ''
    ].filter(Boolean).join(', '),
    '',
    'COMPOSITION: ' + spec.composition.grammar + '. ' + spec.composition.reason,
    'Primary subject anchor: ' + (spec.composition.subject_anchor
      ? 'x=' + spec.composition.subject_anchor.x.toFixed(2) + ', y=' + spec.composition.subject_anchor.y.toFixed(2)
      : 'natural blocking') + '.',
    'Narrative intent: ' + spec.composition.narrative_intent + '.',
    'Preserve safe crop zone for alternate delivery formats.',
    '',
    'LIGHTING: ' + clean(spec.lighting.direction, 700),
    'PERFORMANCE: ' + clean(spec.performance.direction, 900),
    'Performance should remain human, specific and restrained; avoid generic AI melodrama.',
    '',
    'CONTINUITY HARD RULES:',
    ...Object.entries(spec.hard_constraints)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([name]) => '- ' + name.replaceAll('_', ' ')),
    ...spec.negative_constraints.map((item) => '- ' + clean(item, 420)),
    refs
  ].filter(Boolean);

  return lines.join('\n').slice(0, 9000);
}

function falSeedance2Reference(spec: ShotRenderSpec, model: string, mode: 'draft' | 'final'): PreparedRendererRequest {
  const references = usableReferences(spec, mode);
  const imageRefs = references.filter(visualReference).slice(0, 9);
  const videoRefs = references.filter(videoReference).slice(0, 3);

  const reference_map: PreparedRendererRequest['reference_map'] = [
    ...imageRefs.map((ref, index) => ({
      token: '@Image' + (index + 1),
      reference_id: ref.id,
      kind: ref.kind,
      uri: ref.uri
    })),
    ...videoRefs.map((ref, index) => ({
      token: '@Video' + (index + 1),
      reference_id: ref.id,
      kind: ref.kind,
      uri: ref.uri
    }))
  ];

  const allowedRatios = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
  const duration = Math.max(4, Math.min(15, Math.round(spec.output.duration_seconds)));
  const ratio = allowedRatios.has(spec.output.aspect_ratio) ? spec.output.aspect_ratio : '16:9';

  const body: Record<string, unknown> = {
    prompt: promptFor(spec, reference_map),
    image_urls: imageRefs.map((ref) => ref.uri),
    video_urls: videoRefs.map((ref) => ref.uri),
    resolution: mode === 'draft' ? '480p' : '720p',
    duration: String(duration),
    aspect_ratio: ratio,
    generate_audio: false,
    bitrate_mode: mode === 'draft' ? 'standard' : 'high',
    end_user_id: spec.project_id
  };

  if (!imageRefs.length) delete body.image_urls;
  if (!videoRefs.length) delete body.video_urls;

  return {
    provider: 'fal',
    model,
    request_url: 'https://queue.fal.run/' + model,
    body,
    reference_map,
    notes: [
      'Adapter: fal Seedance 2 reference-to-video schema.',
      'PARABLE keeps dialogue/music/foley as separate stems, so native audio generation is disabled.',
      'Final mode only sends references whose rights are approved; revoked/restricted references are never sent.'
    ]
  };
}


function falSeedance2ImageToVideo(
  spec: ShotRenderSpec,
  model: string,
  mode: 'draft' | 'final',
  approvedKeyframe: KeyframeApproval | null
): PreparedRendererRequest {
  if (!approvedKeyframe || approvedKeyframe.status !== 'approved') {
    throw new Error('Seedance image-to-video requires an approved first-frame asset.');
  }

  if (approvedKeyframe.spec_hash !== spec.spec_hash) {
    throw new Error('The approved first frame belongs to a different ShotRenderSpec.');
  }

  const allowedRatios = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
  const duration = Math.max(4, Math.min(15, Math.round(spec.output.duration_seconds)));
  const ratio = allowedRatios.has(spec.output.aspect_ratio) ? spec.output.aspect_ratio : '16:9';

  const reference_map: PreparedRendererRequest['reference_map'] = [{
    token: 'START_FRAME',
    reference_id: 'approved-keyframe:' + approvedKeyframe.shot_id,
    kind: 'approved-first-frame',
    uri: approvedKeyframe.asset.uri
  }];

  const motionPrompt = [
    'PARABLE APPROVED-FIRST-FRAME MOTION CONTRACT.',
    'The supplied image is the exact human-approved starting visual state for this shot.',
    'Animate from it without redesigning the character, wardrobe, props, location, lighting direction or composition.',
    '',
    'DRAMATIC BEAT: ' + clean(spec.narrative.beat, 1200),
    'DRAMATIC PURPOSE: ' + clean(spec.narrative.dramatic_purpose, 800),
    'EMOTIONAL INTENT: ' + clean(spec.narrative.emotional_intent, 800),
    '',
    'CAMERA MOTION: ' + clean(spec.camera.motion || 'locked', 320),
    'SHOT TYPE: ' + clean(spec.camera.shot_type, 180),
    'PERFORMANCE: ' + clean(spec.performance.direction, 900),
    'LIGHTING: preserve the approved first-frame lighting direction and motivated sources.',
    '',
    'MOTION RULES:',
    '- Begin from the approved first frame.',
    '- Preserve face identity, body proportions, wardrobe and visible injuries.',
    '- Preserve prop ownership/location unless the scripted transition explicitly changes it.',
    '- Preserve screen direction and spatial geography.',
    '- Keep performance restrained and specific; do not add generic melodramatic gestures.',
    '- Do not invent people, text, signage, props or environmental events.',
    '- Do not cosmetically beautify or Westernize culturally grounded details.'
  ].join('\n').slice(0, 9000);

  return {
    provider: 'fal',
    model,
    request_url: 'https://queue.fal.run/' + model,
    body: {
      prompt: motionPrompt,
      image_url: approvedKeyframe.asset.uri,
      resolution: mode === 'draft' ? '480p' : '720p',
      duration: String(duration),
      aspect_ratio: ratio,
      generate_audio: false,
      bitrate_mode: mode === 'draft' ? 'standard' : 'high',
      end_user_id: spec.project_id
    },
    reference_map,
    notes: [
      'Adapter: fal Seedance 2 image-to-video schema.',
      'The approved keyframe is sent as image_url, so the motion model starts from the human-approved visual state.',
      'PARABLE keeps dialogue/music/foley as separate stems; native audio generation is disabled.',
      'Any later ShotRenderSpec change invalidates this approval before dispatch.'
    ]
  };
}


function higgsfieldSeedance25ImageToVideo(
  spec: ShotRenderSpec,
  model: string,
  mode: 'draft' | 'final',
  approvedKeyframe: KeyframeApproval | null
): PreparedRendererRequest {
  if (!approvedKeyframe || approvedKeyframe.status !== 'approved') {
    throw new Error('Higgsfield Seedance 2.5 image-to-video requires an approved first-frame asset.');
  }
  if (approvedKeyframe.spec_hash !== spec.spec_hash) {
    throw new Error('The approved first frame belongs to a different ShotRenderSpec.');
  }

  const duration = Math.max(4, Math.min(30, Math.round(spec.output.duration_seconds)));
  const reference_map: PreparedRendererRequest['reference_map'] = [{
    token: 'START_FRAME',
    reference_id: 'approved-keyframe:' + approvedKeyframe.shot_id,
    kind: 'approved-first-frame',
    uri: approvedKeyframe.asset.uri
  }];

  const body: Record<string, unknown> = {
    prompt: [
      'PARABLE APPROVED-FIRST-FRAME MOTION CONTRACT.',
      'Animate from the supplied human-approved start frame without redesigning identity, wardrobe, props, set geography, lighting direction or composition.',
      '',
      'DRAMATIC BEAT: ' + clean(spec.narrative.beat, 1200),
      'DRAMATIC PURPOSE: ' + clean(spec.narrative.dramatic_purpose, 800),
      'EMOTIONAL INTENT: ' + clean(spec.narrative.emotional_intent, 800),
      'CAMERA MOTION: ' + clean(spec.camera.motion || 'locked', 320),
      'SHOT TYPE: ' + clean(spec.camera.shot_type, 180),
      'PERFORMANCE: ' + clean(spec.performance.direction, 900),
      '',
      'MOTION RULES:',
      '- The supplied image is the exact approved first frame.',
      '- Preserve face identity, body proportions, wardrobe, visible injuries and props.',
      '- Preserve screen direction, room geography and motivated lighting.',
      '- Do not invent people, text, signage, props or environmental events.',
      '- Keep performance human, specific and restrained.'
    ].join('\n').slice(0, 9000),
    duration,
    image_url: approvedKeyframe.asset.uri,
    resolution: mode === 'draft' ? '480p' : '720p',
    generate_audio: false,
    output_format: 'mp4'
  };

  return {
    provider: 'higgsfield',
    model,
    request_url: 'https://api.higgsfield.ai/' + model,
    body,
    reference_map,
    notes: [
      'Adapter: Higgsfield Seedance 2.5 image-to-video via the official server-side SDK.',
      'The exact human-approved keyframe is the required image_url start frame.',
      'Native audio is disabled because PARABLE owns dialogue, ambience, foley and music as separate stems.',
      'Billable submission remains blocked unless the project has a server-authoritative paid entitlement and global/provider spend gates are enabled.'
    ]
  };
}

function higgsfieldSeedance25ReferenceToVideo(
  spec: ShotRenderSpec,
  model: string,
  mode: 'draft' | 'final'
): PreparedRendererRequest {
  if (mode === 'final') {
    throw new Error('Final Higgsfield motion must use the image-to-video adapter bound to the exact approved first frame.');
  }

  const references = usableReferences(spec, mode);
  const imageRefs = references.filter(visualReference).slice(0, 24);
  const videoRefs = references.filter(videoReference).slice(0, 6);
  const reference_map: PreparedRendererRequest['reference_map'] = [
    ...imageRefs.map((ref, index) => ({
      token: '@Image' + (index + 1),
      reference_id: ref.id,
      kind: ref.kind,
      uri: ref.uri
    })),
    ...videoRefs.map((ref, index) => ({
      token: '@Video' + (index + 1),
      reference_id: ref.id,
      kind: ref.kind,
      uri: ref.uri
    }))
  ];

  const allowedRatios = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
  const ratio = allowedRatios.has(spec.output.aspect_ratio) ? spec.output.aspect_ratio : '16:9';
  const body: Record<string, unknown> = {
    prompt: promptFor(spec, reference_map),
    duration: Math.max(4, Math.min(30, Math.round(spec.output.duration_seconds))),
    resolution: '480p',
    aspect_ratio: ratio,
    output_format: 'mp4',
    generate_audio: false,
    image_urls: imageRefs.map((ref) => ref.uri),
    video_urls: videoRefs.map((ref) => ref.uri)
  };
  if (!imageRefs.length) delete body.image_urls;
  if (!videoRefs.length) delete body.video_urls;

  return {
    provider: 'higgsfield',
    model,
    request_url: 'https://api.higgsfield.ai/' + model,
    body,
    reference_map,
    notes: [
      'Adapter: Higgsfield Seedance 2.5 reference-to-video for draft motion exploration.',
      'Production references are rights-filtered before they reach the provider.',
      'Native audio is disabled so PARABLE can keep dialogue/voice/music rights and timing independent.',
      'This draft adapter is not allowed to substitute for the final approved-first-frame gate.'
    ]
  };
}

export function prepareRendererRequest(args: {
  spec: ShotRenderSpec;
  provider: string;
  model: string;
  mode: 'draft' | 'final';
  approvedKeyframe?: KeyframeApproval | null;
}): PreparedRendererRequest {
  const provider = clean(args.provider, 80).toLowerCase();
  const model = clean(args.model, 240);

  if (provider === 'fal') {
    if (model === 'bytedance/seedance-2.0/us/image-to-video') {
      return falSeedance2ImageToVideo(args.spec, model, args.mode, args.approvedKeyframe || null);
    }

    if (model === 'bytedance/seedance-2.0/us/reference-to-video') {
      return falSeedance2Reference(args.spec, model, args.mode);
    }

    throw new Error(
      'No versioned PARABLE adapter is registered for fal model "' + model + '". ' +
      'Add and test a model-specific adapter rather than guessing its input schema.'
    );
  }

  if (provider === 'higgsfield') {
    if (model === 'bytedance/seedance-2.5/image-to-video') {
      return higgsfieldSeedance25ImageToVideo(args.spec, model, args.mode, args.approvedKeyframe || null);
    }
    if (model === 'bytedance/seedance-2.5/reference-to-video') {
      return higgsfieldSeedance25ReferenceToVideo(args.spec, model, args.mode);
    }
    throw new Error(
      'No versioned PARABLE adapter is registered for Higgsfield model "' + model + '". ' +
      'Use a documented model-specific adapter rather than guessing provider fields.'
    );
  }

  if (provider === 'runway') {
    throw new Error(
      'Runway is available to the PARABLE development workflow, but a deployed runtime API adapter is not configured yet. ' +
      'Do not translate ShotRenderSpec by guessing provider-specific fields.'
    );
  }

  throw new Error('No deployed renderer adapter is registered for provider "' + provider + '".');
}
