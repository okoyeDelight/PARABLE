import type { CanonReference, ShotRenderSpec } from './render-foundation.mts';

export type KeyframeGenerationPlan = {
  generation_plan_version: 'parable-keyframe-generation-plan-v1';
  model: string;
  prompt: string;
  input_references: Array<{
    type: 'image_url';
    image_url: { url: string };
  }>;
  reference_ids: string[];
  inspiration_notes: string[];
  aspect_ratio: string;
  n: 1;
};

const clean = (value: unknown, max = 1200) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const safeHttpUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || ''));
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
};

function productionReference(ref: CanonReference) {
  return (
    ref.approved_by_human === true &&
    ref.rights_status === 'approved' &&
    ref.render_usage !== 'inspiration-only' &&
    ref.render_usage !== 'benchmark-only' &&
    safeHttpUrl(ref.uri)
  );
}

function referencePriority(ref: CanonReference) {
  const priority: Record<string, number> = {
    'actor-face': 100,
    'actor-visual': 95,
    'wardrobe': 80,
    'location-visual': 70,
    'location-layout': 65,
    'prop-visual': 60,
    'location-lighting': 55,
    'style': 30
  };
  return priority[ref.kind] || 10;
}

export function selectKeyframeGenerationReferences(spec: ShotRenderSpec, limit = 6) {
  return [...(spec.references || [])]
    .filter(productionReference)
    .sort((a, b) => referencePriority(b) - referencePriority(a))
    .slice(0, Math.max(0, Math.min(8, limit)));
}

export function keyframeInspirationNotes(spec: ShotRenderSpec) {
  return (spec.inspiration_references || [])
    .filter((ref) =>
      ref.render_usage === 'inspiration-only' || ref.render_usage === 'benchmark-only'
    )
    .slice(0, 8)
    .map((ref) => {
      const source = clean(
        [ref.source_title, ref.source_creator].filter(Boolean).join(' · '),
        260
      );
      const note = clean(ref.notes, 500);
      return [source, note].filter(Boolean).join(': ');
    })
    .filter(Boolean);
}

export function buildKeyframeGenerationPlan(args: {
  spec: ShotRenderSpec;
  model?: string | null;
}): KeyframeGenerationPlan {
  const spec = args.spec;
  const handoffFrame = (spec.world_state?.previous_accepted_handoff as any)?.handoff_frame || null;
  const handoffUri = safeHttpUrl(handoffFrame?.uri) ? String(handoffFrame.uri) : '';
  const refs = selectKeyframeGenerationReferences(spec, handoffUri ? 5 : 6);
  const inspirationNotes = keyframeInspirationNotes(spec);

  const sequenceContract = handoffUri
    ? [
        '',
        'PREVIOUS ACCEPTED SHOT HANDOFF:',
        '- Reference 0 is the trusted final frame of the previous accepted shot.',
        '- This is continuity evidence, not a request to copy camera framing blindly.',
        '- Preserve visible performer pose/action, wardrobe, props, room geography, screen direction and motivated lighting across the cut unless the current shot explicitly changes them.'
      ]
    : [];

  const referenceContract = refs.length
    ? [
        '',
        'APPROVED PRODUCTION REFERENCES:',
        ...refs.map((ref, index) =>
          '- Reference ' + (index + 1) + ': ' + ref.kind + ' — ' + clean(ref.label, 220) +
          '. Preserve the approved production identity/content represented by this reference.'
        )
      ]
    : [
        '',
        'CASTING:',
        '- No licensed actor-identity reference is supplied. Create a distinct, original character identity from the story facts. Do not imitate a recognizable real actor.'
      ];

  const inspirationContract = inspirationNotes.length
    ? [
        '',
        'INSPIRATION NOTES:',
        '- The following notes describe cinematic lessons only. Do not reproduce a recognizable actor, copyrighted frame, logo, exact set, or costume.',
        ...inspirationNotes.map((note) => '- ' + note)
      ]
    : [];

  const prompt = [
    'PARABLE FIRST-FRAME CANON CANDIDATE.',
    'Create one photorealistic cinematic film still that can serve as the exact first frame of a narrative movie shot.',
    'This is production imagery, not poster art, concept art, glamour photography, or a generic AI portrait.',
    '',
    'STORY BEAT: ' + clean(spec.narrative.beat, 1400),
    'DRAMATIC PURPOSE: ' + clean(spec.narrative.dramatic_purpose, 900),
    'EMOTIONAL INTENT: ' + clean(spec.narrative.emotional_intent, 900),
    '',
    'CAMERA:',
    '- Shot type: ' + clean(spec.camera.shot_type, 180),
    '- Lens: ' + (spec.camera.lens_mm ? String(spec.camera.lens_mm) + 'mm' : 'natural cinematic perspective'),
    '- Motion begins only after this still; compose a stable first frame.',
    '',
    'COMPOSITION:',
    '- Grammar: ' + clean(spec.composition.grammar, 120),
    '- Narrative intent: ' + clean(spec.composition.narrative_intent, 320),
    '- Reason: ' + clean(spec.composition.reason, 800),
    spec.composition.subject_anchor
      ? '- Primary subject anchor: x=' + spec.composition.subject_anchor.x.toFixed(2) +
        ', y=' + spec.composition.subject_anchor.y.toFixed(2) + '.'
      : '- Use natural blocking for the primary subject.',
    '- Negative space: ' + spec.composition.negative_space.toFixed(2) + '.',
    '- Symmetry: ' + spec.composition.symmetry.toFixed(2) + '.',
    '- Keep the safe crop zone useful for alternate aspect-ratio deliveries.',
    '',
    'LIGHTING:',
    '- ' + clean(spec.lighting.direction, 800),
    ...spec.lighting.continuity_requirements.map((item) => '- ' + clean(item, 500)),
    '',
    'PERFORMANCE:',
    '- ' + clean(spec.performance.direction, 900),
    '- Restraint: ' + Number(spec.performance.restraint || 0).toFixed(2) + '.',
    '- Human, specific, understated performance. Avoid generic AI melodrama.',
    '',
    'WORLD / CONTINUITY:',
    '- Respect the supplied before-shot world state exactly where visible.',
    '- Preserve established wardrobe, injuries, props, ownership, room geography and screen direction.',
    '- Do not invent extra people, props, signage, text, symbols or environmental events.',
    '- Preserve Nigerian/local cultural details from the story rather than replacing them with generic Western production design.',
    '- Avoid beauty-filter skin, plastic texture, excessive rim light, fake anamorphic flares and over-designed AI lighting.',
    '- Hands, eyes, teeth, jewelry, furniture, architecture and readable text must be physically coherent.',
    ...spec.negative_constraints.map((item) => '- ' + clean(item, 500)),
    ...sequenceContract,
    ...referenceContract,
    ...inspirationContract,
    '',
    'OUTPUT:',
    '- A believable frame from a serious live-action movie.',
    '- No title card, watermark, border, subtitles, UI or production labels.',
    '- One still only.'
  ].filter(Boolean).join('\n').slice(0, 12000);

  return {
    generation_plan_version: 'parable-keyframe-generation-plan-v1',
    model: clean(args.model || 'google/gemini-3.1-flash-image', 240),
    prompt,
    input_references: [
      ...(handoffUri ? [{
        type: 'image_url' as const,
        image_url: { url: handoffUri }
      }] : []),
      ...refs.map((ref) => ({
        type: 'image_url' as const,
        image_url: { url: ref.uri }
      }))
    ],
    reference_ids: [
      ...(handoffUri ? ['sequence-handoff:' + clean((spec.world_state?.previous_accepted_handoff as any)?.shot_id || 'previous-shot', 120)] : []),
      ...refs.map((ref) => ref.id)
    ],
    inspiration_notes: inspirationNotes,
    aspect_ratio: clean(spec.output.aspect_ratio || '16:9', 20),
    n: 1
  };
}
