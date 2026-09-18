export type CanonReferenceKind =
  | 'actor-face'
  | 'actor-visual'
  | 'voice'
  | 'wardrobe'
  | 'performance'
  | 'location-visual'
  | 'location-layout'
  | 'location-lighting'
  | 'prop-visual'
  | 'style';

export type RightsStatus = 'approved' | 'unverified' | 'restricted' | 'revoked';

export type CanonReference = {
  id: string;
  kind: CanonReferenceKind;
  uri: string;
  label: string;
  rights_status: RightsStatus;
  approved_by_human: boolean;
  source: 'continuity-lock' | 'human-upload' | 'generated' | 'external';
  notes?: string;
};

export type VisualCanonEntity = {
  id: string;
  name: string;
  kind: 'character' | 'location' | 'prop';
  locked_facts: Record<string, unknown>;
  references: CanonReference[];
  continuity_notes: string[];
};

export type CompositionGrammar =
  | 'natural'
  | 'rule_of_thirds'
  | 'centered'
  | 'negative_space'
  | 'frame_within_frame'
  | 'golden_spiral'
  | 's_curve'
  | 'v_shape'
  | 'leading_lines'
  | 'balanced_two_shot'
  | 'asymmetric_tension';

export type CompositionPlan = {
  grammar: CompositionGrammar;
  narrative_intent: string;
  primary_subject: string | null;
  secondary_subjects: string[];
  subject_anchor: { x: number; y: number } | null;
  gaze_direction: 'left' | 'right' | 'camera' | 'unknown';
  gaze_room: number;
  negative_space: number;
  symmetry: number;
  foreground_layers: number;
  background_depth: 'shallow' | 'medium' | 'deep';
  frame_within_frame: string | null;
  dominant_lines: string[];
  safe_crop_zone: {
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
  };
  intensity: number;
  reason: string;
};

export type VisualCanon = {
  canon_version: 'parable-visual-canon-v1';
  project_id: string;
  story_version: string;
  characters: VisualCanonEntity[];
  locations: VisualCanonEntity[];
  props: VisualCanonEntity[];
  style: {
    visual_language: string[];
    forbidden_shortcuts: string[];
    color_notes: string[];
    texture_notes: string[];
    cultural_notes: string[];
  };
  composition_policy: {
    default_intensity: number;
    require_narrative_motivation: boolean;
    safe_for_vertical_crop: boolean;
    allowed_grammars: CompositionGrammar[];
  };
  unresolved_rights: Array<{
    entity_id: string;
    reference_id: string;
    reason: string;
  }>;
  created_at: string;
  updated_at: string;
};

export type ShotRenderSpec = {
  render_spec_version: 'parable-shot-render-spec-v1';
  spec_hash: string;
  project_id: string;
  project_revision: number;
  story_version: string;
  scene_id: string;
  shot_id: string;
  narrative: {
    beat: string;
    dramatic_purpose: string;
    emotional_intent: string;
  };
  camera: {
    shot_type: string;
    lens_mm: number | null;
    motion: string;
    height: string | null;
    axis_rule: string | null;
  };
  composition: CompositionPlan;
  lighting: {
    direction: string;
    continuity_requirements: string[];
  };
  performance: {
    direction: string;
    restraint: number;
    forbidden_performance_shortcuts: string[];
  };
  world_state: {
    continuity_before: unknown;
    transitions: unknown;
    continuity_after: unknown;
  };
  references: CanonReference[];
  hard_constraints: Record<string, boolean>;
  negative_constraints: string[];
  output: {
    media_type: 'video';
    duration_seconds: number;
    aspect_ratio: string;
    delivery_resolution: string;
    fps: number;
    audio_strategy: 'separate-stems' | 'native-reference' | 'none';
    first_frame_required: boolean;
  };
  provider_requirements: {
    reference_images: boolean;
    reference_video: boolean;
    native_audio: boolean;
    multi_reference: boolean;
    minimum_reference_slots: number;
  };
  human_review: {
    required_before_final_render: boolean;
    reasons: string[];
  };
  compiled_at: string;
};

export type RenderAttemptStatus =
  | 'planned'
  | 'queued'
  | 'rendering'
  | 'succeeded'
  | 'failed'
  | 'accepted'
  | 'rejected'
  | 'superseded';

export type RenderAttempt = {
  attempt_version: 'parable-render-attempt-v1';
  id: string;
  project_id: string;
  story_version: string;
  scene_id: string;
  shot_id: string;
  spec_hash: string;
  provider: string;
  model: string;
  status: RenderAttemptStatus;
  mode: 'draft' | 'final';
  keyframe_approval_ref: string | null;
  keyframe_asset_uri: string | null;
  keyframe_plan_hash: string | null;
  provider_request_id: string | null;
  asset_uri: string | null;
  poster_uri: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  latency_ms: number | null;
  failure_class: string | null;
  failure_detail: string | null;
  created_at: string;
  updated_at: string;
};

export type RenderQAMetric =
  | 'identity'
  | 'wardrobe'
  | 'prop_continuity'
  | 'spatial_continuity'
  | 'composition'
  | 'motion'
  | 'lighting'
  | 'technical'
  | 'audio_sync'
  | 'cultural_grounding'
  | 'performance_intent';

export type RenderQAInput = Partial<Record<RenderQAMetric, number>> & {
  detected_violations?: string[];
  reviewer_notes?: string[];
};

export type RenderQAReport = {
  qa_version: 'parable-render-qa-v1';
  attempt_id: string;
  decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW' | 'REJECT';
  overall_score: number;
  scores: Partial<Record<RenderQAMetric, number>>;
  blockers: string[];
  warnings: string[];
  repair_plan: Array<{
    target: string;
    action: 'reframe' | 'edit-video' | 'regenerate-segment' | 'regenerate-shot' | 'audio-only' | 'human-review';
    reason: string;
  }>;
  evaluated_at: string;
};

const clamp01 = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

const clean = (value: unknown, max = 900) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const stableObject = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableObject(value[key])])
  );
};

export async function stableHash(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(stableObject(value)));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function refKindFromField(field: string): CanonReferenceKind | null {
  const map: Record<string, CanonReferenceKind> = {
    actor_face_ref: 'actor-face',
    actor_visual_ref: 'actor-visual',
    voice_ref: 'voice',
    wardrobe_reference_ref: 'wardrobe',
    performance_reference_ref: 'performance',
    location_visual_ref: 'location-visual',
    layout_reference_ref: 'location-layout',
    lighting_reference_ref: 'location-lighting',
    prop_visual_ref: 'prop-visual'
  };
  return map[field] || null;
}

function referencesFromFacts(entity: any): CanonReference[] {
  const refs: CanonReference[] = [];
  for (const [field, fact] of Object.entries(entity?.facts || {}) as Array<[string, any]>) {
    const kind = refKindFromField(field);
    const uri = clean(fact?.value, 1600);
    if (!kind || !uri) continue;
    refs.push({
      id: 'ref_' + entity.id + '_' + field,
      kind,
      uri,
      label: entity.name + ' · ' + field.replaceAll('_', ' '),
      rights_status: 'unverified',
      approved_by_human: Boolean(fact?.locked && fact?.basis === 'human'),
      source: 'continuity-lock',
      notes: fact?.note ? clean(fact.note, 500) : undefined
    });
  }
  return refs;
}

export function buildVisualCanon(args: {
  projectId: string;
  storyVersion: string;
  productionBible?: Record<string, any> | null;
  continuity?: Record<string, any> | null;
  existing?: VisualCanon | null;
}) {
  const now = new Date().toISOString();
  const bible = args.productionBible || {};
  const continuity = args.continuity || {};
  const entities = Object.values(continuity.entities || {}) as any[];

  const toCanon = (kind: 'character' | 'location' | 'prop') =>
    entities
      .filter((entity) => entity?.kind === kind)
      .map((entity) => ({
        id: entity.id,
        name: clean(entity.name, 180),
        kind,
        locked_facts: Object.fromEntries(
          Object.entries(entity.facts || {})
            .filter(([, fact]: any) => Boolean(fact?.locked))
            .map(([field, fact]: any) => [field, fact?.value])
        ),
        references: referencesFromFacts(entity),
        continuity_notes: []
      }));

  const characters = toCanon('character');
  const locations = toCanon('location');
  const props = toCanon('prop');

  const knownCharacterNames = new Set(characters.map((item) => item.name.toLowerCase()));
  for (const row of Array.isArray(bible.characters) ? bible.characters : []) {
    const name = clean(row?.name, 180);
    if (!name || knownCharacterNames.has(name.toLowerCase())) continue;
    characters.push({
      id: 'character_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name,
      kind: 'character',
      locked_facts: {},
      references: [],
      continuity_notes: ['Character exists in the Production Bible but does not yet have a locked visual identity.']
    });
  }

  const knownLocationNames = new Set(locations.map((item) => item.name.toLowerCase()));
  for (const row of Array.isArray(bible.locations) ? bible.locations : []) {
    const name = clean(row?.name || row?.heading, 180);
    if (!name || knownLocationNames.has(name.toLowerCase())) continue;
    locations.push({
      id: 'location_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name,
      kind: 'location',
      locked_facts: {},
      references: [],
      continuity_notes: ['Location exists in the Production Bible but does not yet have approved visual references.']
    });
  }

  const existingEntities = new Map(
    [...(args.existing?.characters || []), ...(args.existing?.locations || []), ...(args.existing?.props || [])]
      .map((entity) => [entity.id, entity])
  );

  for (const entity of [...characters, ...locations, ...props]) {
    const previous = existingEntities.get(entity.id);
    if (!previous) continue;

    const previousRefs = new Map((previous.references || []).map((ref) => [ref.id, ref]));
    entity.references = entity.references.map((ref) => {
      const prior = previousRefs.get(ref.id);
      if (!prior) return ref;
      return {
        ...ref,
        rights_status: prior.rights_status,
        approved_by_human: prior.approved_by_human || ref.approved_by_human,
        source: prior.source || ref.source,
        notes: prior.notes || ref.notes
      };
    });

    const currentIds = new Set(entity.references.map((ref) => ref.id));
    for (const prior of previous.references || []) {
      if (!currentIds.has(prior.id)) entity.references.push(prior);
    }

    entity.continuity_notes = [...new Set([
      ...(previous.continuity_notes || []),
      ...(entity.continuity_notes || [])
    ])];
  }

  const unresolved_rights = [...characters, ...locations, ...props].flatMap((entity) =>
    entity.references
      .filter((ref) => ref.rights_status !== 'approved')
      .map((ref) => ({
        entity_id: entity.id,
        reference_id: ref.id,
        reason: ref.approved_by_human
          ? 'Reference is human-approved for continuity but likeness/media rights have not been separately verified.'
          : 'Reference has not been human-approved and rights are unverified.'
      }))
  );

  const canon: VisualCanon = {
    canon_version: 'parable-visual-canon-v1',
    project_id: args.projectId,
    story_version: args.storyVersion,
    characters,
    locations,
    props,
    style: args.existing?.style || {
      visual_language: ['cinematic realism', 'human-scale camera placement', 'motivated lighting', 'culturally grounded production design'],
      forbidden_shortcuts: ['generic Western substitution', 'beauty-filter skin homogenization', 'unmotivated lens flares', 'AI glamour lighting'],
      color_notes: [],
      texture_notes: [],
      cultural_notes: []
    },
    composition_policy: args.existing?.composition_policy || {
      default_intensity: 0.35,
      require_narrative_motivation: true,
      safe_for_vertical_crop: true,
      allowed_grammars: [
        'natural',
        'rule_of_thirds',
        'centered',
        'negative_space',
        'frame_within_frame',
        'golden_spiral',
        's_curve',
        'v_shape',
        'leading_lines',
        'balanced_two_shot',
        'asymmetric_tension'
      ]
    },
    unresolved_rights,
    created_at: args.existing?.created_at || now,
    updated_at: now
  };

  return canon;
}

function inferComposition(shot: Record<string, any>, canon: VisualCanon): CompositionPlan {
  const beat = clean(shot?.beat || shot?.purpose || shot?.dramatic_purpose, 1000).toLowerCase();
  const performance = clean(shot?.performance, 800).toLowerCase();
  const blocking = clean(shot?.blocking, 800).toLowerCase();
  const combined = [beat, performance, blocking].join(' ');
  const subject = clean(shot?.subject || shot?.character || '', 180) || null;

  let grammar: CompositionGrammar = 'natural';
  let intent = 'clarity';
  let reason = 'Use restrained natural composition because the shot does not establish a stronger compositional motivation.';
  let anchor: { x: number; y: number } | null = { x: 0.42, y: 0.5 };
  let negativeSpace = 0.2;
  let symmetry = 0.25;
  let intensity = canon.composition_policy.default_intensity;
  let frameWithinFrame: string | null = null;

  if (/alone|isolat|empty|absence|waiting|distance|lonely|abandon/.test(combined)) {
    grammar = 'negative_space';
    intent = 'isolation';
    anchor = { x: 0.3, y: 0.52 };
    negativeSpace = 0.62;
    symmetry = 0.08;
    intensity = 0.58;
    reason = 'The dramatic beat emphasizes isolation or absence, so visual emptiness carries narrative meaning.';
  } else if (/authority|resolve|decision|conviction|confront|ritual|prayer|altar|declar/.test(combined)) {
    grammar = 'centered';
    intent = 'authority';
    anchor = { x: 0.5, y: 0.48 };
    negativeSpace = 0.18;
    symmetry = 0.78;
    intensity = 0.56;
    reason = 'The moment carries authority, conviction or ritual weight, so a deliberate centered frame reinforces control.';
  } else if (/door|window|corridor|watch|observe|secret|trapped|confined/.test(combined)) {
    grammar = 'frame_within_frame';
    intent = /watch|observe|secret/.test(combined) ? 'observation' : 'confinement';
    frameWithinFrame = /window/.test(combined) ? 'window' : /door/.test(combined) ? 'doorway' : 'architecture';
    anchor = { x: 0.38, y: 0.5 };
    negativeSpace = 0.34;
    symmetry = 0.28;
    intensity = 0.6;
    reason = 'Architecture can reinforce the scene’s sense of observation, separation or confinement.';
  } else if (/two-shot|together|reconcile|embrace|conversation|dialogue|exchange/.test(combined)) {
    grammar = 'balanced_two_shot';
    intent = 'relationship';
    anchor = { x: 0.5, y: 0.5 };
    negativeSpace = 0.16;
    symmetry = 0.55;
    intensity = 0.38;
    reason = 'The dramatic information is relational, so the composition should preserve readable visual balance between performers.';
  } else if (/uneasy|threat|unstable|fear|danger|conflict|argument|chaos/.test(combined)) {
    grammar = 'asymmetric_tension';
    intent = 'tension';
    anchor = { x: 0.68, y: 0.48 };
    negativeSpace = 0.42;
    symmetry = 0.08;
    intensity = 0.62;
    reason = 'Asymmetry supports the instability and tension already present in the dramatic beat.';
  } else if (/reveal|discover|notice|realize|finds|sees/.test(combined)) {
    grammar = 'golden_spiral';
    intent = 'progressive reveal';
    anchor = { x: 0.62, y: 0.44 };
    negativeSpace = 0.28;
    symmetry = 0.22;
    intensity = 0.5;
    reason = 'The shot contains a reveal, so the frame should guide attention progressively rather than present every element equally.';
  }

  const allowed = new Set(canon.composition_policy.allowed_grammars);
  if (!allowed.has(grammar)) grammar = 'natural';

  return {
    grammar,
    narrative_intent: intent,
    primary_subject: subject,
    secondary_subjects: [],
    subject_anchor: anchor,
    gaze_direction: 'unknown',
    gaze_room: 0.22,
    negative_space: clamp01(negativeSpace),
    symmetry: clamp01(symmetry),
    foreground_layers: /foreground|depth|layer/.test(combined) ? 2 : 1,
    background_depth: /close[- ]?up|portrait/.test(clean(shot?.shot_type, 120).toLowerCase()) ? 'shallow' : 'medium',
    frame_within_frame: frameWithinFrame,
    dominant_lines: grammar === 'leading_lines' ? ['environment → subject'] : [],
    safe_crop_zone: { x_min: 0.18, x_max: 0.82, y_min: 0.08, y_max: 0.92 },
    intensity: clamp01(intensity, 0.35),
    reason
  };
}

function allCanonReferences(canon: VisualCanon) {
  return [...canon.characters, ...canon.locations, ...canon.props].flatMap((entity) => entity.references);
}

export async function compileShotRenderSpec(args: {
  renderPackage: Record<string, any>;
  canon: VisualCanon;
  projectRevision: number;
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  fps?: number;
}) {
  const pkg = args.renderPackage || {};
  const shot = pkg.shot || {};
  const references = allCanonReferences(args.canon).filter((ref) => ref.approved_by_human);
  const rightsIssues = references.filter((ref) => ref.rights_status !== 'approved');

  const dramaticPurpose = clean(shot?.purpose || shot?.dramatic_purpose || shot?.beat, 1000);
  const emotionalIntent = clean(shot?.performance || pkg?.shot_render_notes?.emotional_continuity?.join(' '), 1000);
  const composition = inferComposition(shot, args.canon);

  const draft = {
    render_spec_version: 'parable-shot-render-spec-v1' as const,
    project_id: clean(pkg.project_id, 96),
    project_revision: Math.max(0, Math.floor(args.projectRevision || 0)),
    story_version: clean(pkg.story_version, 96),
    scene_id: clean(pkg.scene_id, 96),
    shot_id: clean(pkg.shot_id, 96),
    narrative: {
      beat: clean(shot?.beat, 1400),
      dramatic_purpose: dramaticPurpose,
      emotional_intent: emotionalIntent
    },
    camera: {
      shot_type: clean(shot?.shot_type || shot?.size || 'unspecified', 160),
      lens_mm: Number.isFinite(Number(shot?.lens_mm)) ? Number(shot.lens_mm) : null,
      motion: clean(shot?.motion || 'locked', 320),
      height: clean(shot?.camera_height, 160) || null,
      axis_rule: clean(shot?.axis_rule, 220) || null
    },
    composition,
    lighting: {
      direction: clean(shot?.lighting || 'preserve established motivated lighting', 600),
      continuity_requirements: [
        'Preserve established key-light direction across adjacent coverage.',
        'Do not introduce unmotivated beauty lighting that changes the scene’s emotional truth.'
      ]
    },
    performance: {
      direction: clean(shot?.performance || 'natural, restrained performance', 900),
      restraint: /cry|scream|shout|panic/.test(emotionalIntent.toLowerCase()) ? 0.45 : 0.72,
      forbidden_performance_shortcuts: [
        'Do not replace subtle emotion with exaggerated crying unless explicitly directed.',
        'Do not add smiles, tears, gestures or eye-lines that contradict the dramatic beat.'
      ]
    },
    world_state: {
      continuity_before: pkg.continuity_before || null,
      transitions: pkg.shot_transitions || null,
      continuity_after: pkg.continuity_after || null
    },
    references,
    hard_constraints: {
      ...(pkg.hard_constraints || {}),
      preserve_visual_canon: true,
      preserve_approved_reference_identity: true,
      preserve_composition_intent: true
    },
    negative_constraints: [
      'No identity drift.',
      'No unexplained wardrobe change.',
      'No unexplained prop teleportation.',
      'No invented extra characters.',
      'No generic cultural substitution.',
      'No unmotivated screen-direction reversal.',
      'No text mutation on established signage or props when visible.'
    ],
    output: {
      media_type: 'video' as const,
      duration_seconds: Math.max(1, Math.min(20, Number(args.durationSeconds || shot?.duration_seconds || 6))),
      aspect_ratio: clean(args.aspectRatio || shot?.aspect_ratio || '16:9', 20),
      delivery_resolution: clean(args.resolution || '1080p', 30),
      fps: Math.max(12, Math.min(60, Math.round(Number(args.fps || 24)))),
      audio_strategy: 'separate-stems' as const,
      first_frame_required: true
    },
    provider_requirements: {
      reference_images: references.some((ref) => ['actor-face', 'actor-visual', 'wardrobe', 'location-visual', 'prop-visual'].includes(ref.kind)),
      reference_video: references.some((ref) => ref.kind === 'performance'),
      native_audio: false,
      multi_reference: references.length > 1,
      minimum_reference_slots: Math.min(6, references.length)
    },
    human_review: {
      required_before_final_render: rightsIssues.length > 0 || Boolean(pkg.human_review_recommended),
      reasons: [
        ...(rightsIssues.length ? ['One or more approved continuity references still have unverified likeness/media rights.'] : []),
        ...(pkg.human_review_recommended ? ['The Continuity Brain recommended human review for this shot.'] : [])
      ]
    },
    compiled_at: new Date().toISOString()
  };

  const spec_hash = await stableHash(draft);
  return { ...draft, spec_hash } as ShotRenderSpec;
}

export function evaluateRenderQA(attemptId: string, input: RenderQAInput): RenderQAReport {
  const metricKeys: RenderQAMetric[] = [
    'identity',
    'wardrobe',
    'prop_continuity',
    'spatial_continuity',
    'composition',
    'motion',
    'lighting',
    'technical',
    'audio_sync',
    'cultural_grounding',
    'performance_intent'
  ];

  const scores: Partial<Record<RenderQAMetric, number>> = {};
  for (const key of metricKeys) {
    if (input[key] !== undefined) scores[key] = clamp01(input[key], 0);
  }

  const values = Object.values(scores);
  const overall = values.length
    ? values.reduce((sum, value) => sum + Number(value), 0) / values.length
    : 0;

  const blockers: string[] = [];
  const warnings: string[] = [];
  const repair_plan: RenderQAReport['repair_plan'] = [];

  const hard = (key: RenderQAMetric, threshold: number, label: string, action: RenderQAReport['repair_plan'][number]['action']) => {
    const value = scores[key];
    if (value === undefined) return;
    if (value < threshold) {
      blockers.push(label + ' score ' + value.toFixed(2) + ' is below the hard threshold ' + threshold.toFixed(2) + '.');
      repair_plan.push({ target: key, action, reason: blockers[blockers.length - 1] });
    }
  };

  hard('identity', 0.82, 'Identity continuity', 'regenerate-shot');
  hard('wardrobe', 0.80, 'Wardrobe continuity', 'edit-video');
  hard('prop_continuity', 0.78, 'Prop continuity', 'edit-video');
  hard('spatial_continuity', 0.76, 'Spatial continuity', 'regenerate-segment');
  hard('technical', 0.72, 'Technical quality', 'regenerate-segment');

  if (scores.composition !== undefined && scores.composition < 0.7) {
    warnings.push('Composition is weaker than the compiled narrative intent.');
    repair_plan.push({ target: 'composition', action: 'reframe', reason: warnings[warnings.length - 1] });
  }

  if (scores.performance_intent !== undefined && scores.performance_intent < 0.68) {
    warnings.push('Performance does not sufficiently express the intended dramatic beat.');
    repair_plan.push({ target: 'performance_intent', action: 'human-review', reason: warnings[warnings.length - 1] });
  }

  for (const violation of input.detected_violations || []) {
    const value = clean(violation, 500);
    if (value) blockers.push(value);
  }

  let decision: RenderQAReport['decision'] = 'PASS';
  if (!values.length) decision = 'HUMAN_REVIEW';
  else if (blockers.length >= 3 || (scores.identity !== undefined && scores.identity < 0.55)) decision = 'REJECT';
  else if (blockers.length || warnings.length) decision = 'REPAIR';
  else if (overall < 0.8) decision = 'HUMAN_REVIEW';

  if (decision === 'HUMAN_REVIEW' && !repair_plan.length) {
    repair_plan.push({
      target: 'shot',
      action: 'human-review',
      reason: values.length ? 'Automated evidence is not strong enough for automatic acceptance.' : 'No measured QA evidence was supplied.'
    });
  }

  return {
    qa_version: 'parable-render-qa-v1',
    attempt_id: attemptId,
    decision,
    overall_score: Math.round(overall * 1000) / 1000,
    scores,
    blockers,
    warnings,
    repair_plan,
    evaluated_at: new Date().toISOString()
  };
}


export type KeyframePlan = {
  keyframe_plan_version: 'parable-keyframe-plan-v1';
  project_id: string;
  story_version: string;
  scene_id: string;
  shot_id: string;
  spec_hash: string;
  first_frame: {
    composition: CompositionPlan;
    camera: ShotRenderSpec['camera'];
    lighting: ShotRenderSpec['lighting'];
    performance: ShotRenderSpec['performance'];
    required_references: CanonReference[];
    forbidden_changes: string[];
  };
  anchors: Array<{
    position: number;
    purpose: string;
    continuity_target: string;
  }>;
  acceptance_checklist: string[];
  final_motion_render_blocked_until_approved: boolean;
  created_at: string;
};

export function buildKeyframePlan(spec: ShotRenderSpec): KeyframePlan {
  const approvedRefs = spec.references.filter((ref) =>
    ref.approved_by_human && ref.rights_status !== 'revoked' && ref.rights_status !== 'restricted'
  );

  const acceptance = [
    'Primary character identity matches the approved Visual Canon.',
    'Wardrobe and visible injuries match continuity-before state.',
    'Required props exist in the correct holder/location/state.',
    'Location and cultural production design match the Visual Canon.',
    'Composition expresses "' + spec.composition.narrative_intent + '" using ' + spec.composition.grammar + ' without looking mechanically templated.',
    'Screen direction, gaze and blocking do not contradict established geography.',
    'Lighting direction matches adjacent coverage.',
    'No invented characters, signage, props or generic cultural substitutions appear.'
  ];

  const anchors = [
    {
      position: 0,
      purpose: 'first-frame canon gate',
      continuity_target: 'Match continuity-before and approved Visual Canon before any motion generation.'
    },
    {
      position: 0.5,
      purpose: 'mid-shot stability check',
      continuity_target: 'Identity, props, blocking and composition must remain stable through motion.'
    },
    {
      position: 1,
      purpose: 'handoff frame',
      continuity_target: 'Match continuity-after so the next shot can inherit a trustworthy state.'
    }
  ];

  return {
    keyframe_plan_version: 'parable-keyframe-plan-v1',
    project_id: spec.project_id,
    story_version: spec.story_version,
    scene_id: spec.scene_id,
    shot_id: spec.shot_id,
    spec_hash: spec.spec_hash,
    first_frame: {
      composition: spec.composition,
      camera: spec.camera,
      lighting: spec.lighting,
      performance: spec.performance,
      required_references: approvedRefs,
      forbidden_changes: spec.negative_constraints
    },
    anchors,
    acceptance_checklist: acceptance,
    final_motion_render_blocked_until_approved: true,
    created_at: new Date().toISOString()
  };
}
