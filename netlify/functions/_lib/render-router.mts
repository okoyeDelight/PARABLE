import type { ShotRenderSpec } from './render-foundation.mts';

export type RendererProvider = 'fal' | 'runway' | 'external';

export type RendererCapability = {
  provider: RendererProvider;
  model: string;
  configured: boolean;
  supports: {
    text_to_video: boolean;
    image_to_video: boolean;
    reference_video: boolean;
    multi_reference: boolean;
    native_audio: boolean;
    first_frame_conditioning: boolean;
    max_reference_slots: number;
  };
  operating: {
    quality_score: number;
    continuity_score: number;
    reliability_score: number;
    latency_score: number;
    cost_score: number;
  };
  notes: string[];
};

export type RenderRoute = {
  router_version: 'parable-render-router-v1';
  selected: {
    provider: RendererProvider;
    model: string;
  } | null;
  candidates: Array<{
    provider: RendererProvider;
    model: string;
    eligible: boolean;
    score: number;
    rejection_reasons: string[];
    notes: string[];
  }>;
  decision_notes: string[];
  routed_at: string;
};

const clamp = (value: unknown, fallback = 0.5) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

function defaultCapabilities(): RendererCapability[] {
  const falModel = String(Netlify.env.get('FAL_VIDEO_MODEL') || '').trim();
  const runwayModel = String(Netlify.env.get('RUNWAY_VIDEO_MODEL') || '').trim();
  const falAdapterRegistered = new Set([
    'bytedance/seedance-2.0/us/image-to-video',
    'bytedance/seedance-2.0/us/reference-to-video'
  ]).has(falModel);
  const falFirstFrameConditioning = falModel === 'bytedance/seedance-2.0/us/image-to-video';
  const runwayAdapterRegistered = false;

  return [
    {
      provider: 'fal',
      model: falModel || 'unconfigured',
      configured: Boolean(Netlify.env.get('FAL_KEY') && falModel && falAdapterRegistered),
      supports: {
        text_to_video: true,
        image_to_video: true,
        reference_video: true,
        multi_reference: true,
        native_audio: false,
        first_frame_conditioning: falFirstFrameConditioning,
        max_reference_slots: Math.max(1, Math.min(12, Number(Netlify.env.get('FAL_RENDER_REFERENCE_SLOTS') || 6)))
      },
      operating: {
        quality_score: clamp(Netlify.env.get('FAL_RENDER_QUALITY_SCORE'), 0.5),
        continuity_score: clamp(Netlify.env.get('FAL_RENDER_CONTINUITY_SCORE'), 0.5),
        reliability_score: clamp(Netlify.env.get('FAL_RENDER_RELIABILITY_SCORE'), 0.5),
        latency_score: clamp(Netlify.env.get('FAL_RENDER_LATENCY_SCORE'), 0.5),
        cost_score: clamp(Netlify.env.get('FAL_RENDER_COST_SCORE'), 0.5)
      },
      notes: [
        'Model selection is runtime-configured so PARABLE can change fal endpoints without changing ShotRenderSpec.',
        falModel && !falAdapterRegistered
          ? 'This configured fal model has no tested PARABLE adapter yet and is intentionally ineligible.'
          : 'A versioned fal adapter is registered for the configured model.'
      ]
    },
    {
      provider: 'runway',
      model: runwayModel || 'unconfigured',
      configured: Boolean(Netlify.env.get('RUNWAY_API_KEY') && runwayModel && runwayAdapterRegistered),
      supports: {
        text_to_video: true,
        image_to_video: true,
        reference_video: true,
        multi_reference: true,
        native_audio: true,
        first_frame_conditioning: false,
        max_reference_slots: Math.max(1, Math.min(8, Number(Netlify.env.get('RUNWAY_RENDER_REFERENCE_SLOTS') || 3)))
      },
      operating: {
        quality_score: clamp(Netlify.env.get('RUNWAY_RENDER_QUALITY_SCORE'), 0.5),
        continuity_score: clamp(Netlify.env.get('RUNWAY_RENDER_CONTINUITY_SCORE'), 0.5),
        reliability_score: clamp(Netlify.env.get('RUNWAY_RENDER_RELIABILITY_SCORE'), 0.5),
        latency_score: clamp(Netlify.env.get('RUNWAY_RENDER_LATENCY_SCORE'), 0.5),
        cost_score: clamp(Netlify.env.get('RUNWAY_RENDER_COST_SCORE'), 0.5)
      },
      notes: [
        'Runway is an optional renderer. PARABLE must remain functional when this provider is unavailable.',
        'A tested deployed Runway runtime adapter is not registered in Foundation V1, so this route remains ineligible even if credentials are later added.'
      ]
    }
  ];
}

function requiredVisualReferences(spec: ShotRenderSpec) {
  return spec.references.filter((reference) =>
    ['actor-face', 'actor-visual', 'wardrobe', 'location-visual', 'location-layout', 'prop-visual'].includes(reference.kind)
  ).length;
}

function eligibility(spec: ShotRenderSpec, capability: RendererCapability) {
  const rejection_reasons: string[] = [];
  if (!capability.configured) rejection_reasons.push('Provider/model is not configured in the deployed PARABLE runtime.');

  if (spec.output.first_frame_required && !capability.supports.first_frame_conditioning) {
    rejection_reasons.push('Final motion requires exact approved-first-frame conditioning, but this route cannot accept a starting frame.');
  }

  if (spec.provider_requirements.reference_images && !capability.supports.image_to_video) {
    rejection_reasons.push('Shot requires visual conditioning but this route lacks image-to-video/reference support.');
  }

  if (spec.provider_requirements.reference_video && !capability.supports.reference_video && !capability.supports.first_frame_conditioning) {
    rejection_reasons.push('Shot requires performance/video reference support.');
  }

  if (
    spec.provider_requirements.multi_reference &&
    !capability.supports.multi_reference &&
    !capability.supports.first_frame_conditioning
  ) {
    rejection_reasons.push('Shot requires more than one canonical reference and no approved-first-frame synthesis path is available.');
  }

  const refs = requiredVisualReferences(spec);
  if (!capability.supports.first_frame_conditioning && refs > capability.supports.max_reference_slots) {
    rejection_reasons.push(
      'Shot needs ' + refs + ' visual references but route supports ' + capability.supports.max_reference_slots + '.'
    );
  }

  if (spec.provider_requirements.native_audio && !capability.supports.native_audio) {
    rejection_reasons.push('Shot requires native audio generation.');
  }

  return rejection_reasons;
}

export function routeRenderSpec(
  spec: ShotRenderSpec,
  overrides: RendererCapability[] = []
): RenderRoute {
  const profiles = overrides.length ? overrides : defaultCapabilities();
  const candidates = profiles.map((capability) => {
    const rejection_reasons = eligibility(spec, capability);
    const operating = capability.operating;

    // Identity/continuity matter more than raw speed for PARABLE.
    const score =
      operating.quality_score * 0.28 +
      operating.continuity_score * 0.34 +
      operating.reliability_score * 0.18 +
      operating.cost_score * 0.12 +
      operating.latency_score * 0.08;

    return {
      provider: capability.provider,
      model: capability.model,
      eligible: rejection_reasons.length === 0,
      score: Math.round(score * 1000) / 1000,
      rejection_reasons,
      notes: capability.notes
    };
  }).sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.score - a.score;
  });

  const selected = candidates.find((candidate) => candidate.eligible) || null;

  return {
    router_version: 'parable-render-router-v1',
    selected: selected ? { provider: selected.provider, model: selected.model } : null,
    candidates,
    decision_notes: selected
      ? [
          'The selected route satisfied the ShotRenderSpec capability requirements.',
          'PARABLE weights continuity and identity preservation above latency.',
          'Provider selection is replaceable; the ShotRenderSpec remains provider-neutral.'
        ]
      : [
          'No configured renderer currently satisfies this shot.',
          'PARABLE will not silently weaken continuity constraints just to produce a clip.',
          'Configure a compatible renderer or deliberately revise the shot/reference plan.'
        ],
    routed_at: new Date().toISOString()
  };
}
