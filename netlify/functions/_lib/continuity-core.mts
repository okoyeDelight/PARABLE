export type Basis = 'explicit' | 'inferred' | 'creative-adaptation' | 'human';

export type ContinuityFact = {
  value: unknown;
  scene_id: string;
  shot_id?: string | null;
  basis: Basis;
  confidence: number;
  locked?: boolean;
  note?: string;
};

export type EntityState = {
  id: string;
  name: string;
  kind: 'character' | 'location' | 'prop' | 'wardrobe' | 'relationship' | 'world';
  facts: Record<string, ContinuityFact>;
  history: Array<{
    scene_id: string;
    shot_id?: string | null;
    field: string;
    previous: unknown;
    next: unknown;
    basis: Basis;
    confidence: number;
    transition: boolean;
    at: string;
  }>;
};

export type SpatialRelation = {
  subject: string;
  subject_kind: EntityState['kind'];
  relation:
    | 'left_of'
    | 'right_of'
    | 'in_front_of'
    | 'behind'
    | 'inside'
    | 'outside'
    | 'near'
    | 'facing'
    | 'screen_left'
    | 'screen_right'
    | 'foreground'
    | 'background';
  target: string;
  target_kind: EntityState['kind'];
  scene_id: string;
  shot_id?: string | null;
  confidence: number;
  transition: boolean;
};

export type PropOwnership = {
  prop_id: string;
  prop_name: string;
  holder_id?: string | null;
  holder_name?: string | null;
  location?: string | null;
  state?: string | null;
  scene_id: string;
  shot_id?: string | null;
  confidence: number;
};

export type RoomAnchor = {
  id: string;
  label: string;
  kind: 'door' | 'window' | 'furniture' | 'altar' | 'entry' | 'exit' | 'landmark' | 'other';
  locked: boolean;
  scene_id: string;
  shot_id?: string | null;
  confidence: number;
};

export type RoomTopologyRelation = {
  subject: string;
  relation:
    | 'left_of'
    | 'right_of'
    | 'in_front_of'
    | 'behind'
    | 'near'
    | 'against'
    | 'inside'
    | 'outside'
    | 'faces'
    | 'between'
    | 'at';
  target: string;
  scene_id: string;
  shot_id?: string | null;
  confidence: number;
  transition: boolean;
  locked: boolean;
};

export type RoomTopology = {
  location_id: string;
  location_name: string;
  anchors: Record<string, RoomAnchor>;
  relations: RoomTopologyRelation[];
  established_scene_id: string;
  updated_at: string;
};

export type CameraAxisState = {
  id: string;
  scene_id: string;
  location_id: string | null;
  subject_a: string;
  subject_b: string;
  established_shot_id: string | null;
  established_camera_side: 'side_a' | 'side_b' | 'on_axis' | 'neutral' | 'unknown';
  last_camera_side: 'side_a' | 'side_b' | 'on_axis' | 'neutral' | 'unknown';
  subject_a_screen_side: 'left' | 'right' | 'center' | 'unknown';
  subject_b_screen_side: 'left' | 'right' | 'center' | 'unknown';
  last_shot_id: string | null;
  bridge_shot_seen: boolean;
  last_cross_reason: string | null;
};

export type ContinuityWarning = {
  code:
    | 'LOCKED_FACT_CONFLICT'
    | 'UNEXPLAINED_CHANGE'
    | 'KNOWLEDGE_LEAK'
    | 'TIMELINE_REGRESSION'
    | 'MISSING_ENTITY'
    | 'PROP_OWNERSHIP_CONFLICT'
    | 'SCREEN_DIRECTION_BREAK'
    | 'SPATIAL_CONFLICT'
    | 'ROOM_TOPOLOGY_CONFLICT'
    | 'CAMERA_AXIS_CROSS'
    | 'EYELINE_DIRECTION_BREAK';
  severity: 'info' | 'warning' | 'blocker';
  scene_id: string;
  shot_id?: string | null;
  entity_id?: string;
  field?: string;
  message: string;
  previous?: unknown;
  incoming?: unknown;
};

export type ContinuitySnapshot = {
  schema_version: 'continuity-v4';
  project_id: string;
  story_version: string;
  scene_cursor: number;
  last_scene_id: string | null;
  last_shot_id: string | null;
  entities: Record<string, EntityState>;
  character_knowledge: Record<string, string[]>;
  timeline: {
    order: string[];
    current_label: string | null;
  };
  spatial_graph: SpatialRelation[];
  prop_ownership: Record<string, PropOwnership>;
  room_topology: Record<string, RoomTopology>;
  camera_axes: Record<string, CameraAxisState>;
  open_threads: string[];
  theology_flags: string[];
  warnings: ContinuityWarning[];
  updated_at: string;
};

export type SceneFactInput = {
  entity?: string;
  entity_id?: string;
  kind?: EntityState['kind'];
  field: string;
  value: unknown;
  basis?: Basis;
  confidence?: number;
  transition?: boolean;
  locked?: boolean;
  note?: string;
};

export type SceneKnowledgeInput = {
  character: string;
  learns?: string[];
  forgets?: string[];
};

export type SceneKnowledgeRequirement = {
  character: string;
  fact: string;
  evidence?: string;
};

export type PropTransferInput = {
  prop: string;
  from?: string;
  to?: string;
  location?: string;
  state?: string;
  confidence?: number;
  transition?: boolean;
  evidence?: string;
};

export type SpatialRelationInput = {
  subject: string;
  subject_kind?: EntityState['kind'];
  relation: SpatialRelation['relation'];
  target: string;
  target_kind?: EntityState['kind'];
  confidence?: number;
  transition?: boolean;
};

export type RoomTopologyInput = {
  location: string;
  anchors?: Array<{
    label: string;
    kind?: RoomAnchor['kind'];
    locked?: boolean;
    confidence?: number;
  }>;
  relations?: Array<{
    subject: string;
    relation: RoomTopologyRelation['relation'];
    target: string;
    confidence?: number;
    transition?: boolean;
    locked?: boolean;
  }>;
};

export type CameraAxisInput = {
  axis_id?: string;
  location?: string;
  subject_a: string;
  subject_b: string;
  camera_side?: CameraAxisState['last_camera_side'];
  subject_a_screen_side?: CameraAxisState['subject_a_screen_side'];
  subject_b_screen_side?: CameraAxisState['subject_b_screen_side'];
  bridge_shot?: boolean;
  intentional_cross?: boolean;
  reset_axis?: boolean;
  reason?: string;
};

export type SceneContinuityInput = {
  id?: string;
  index?: number;
  shot_id?: string;
  time_label?: string;
  facts?: SceneFactInput[];
  knowledge?: SceneKnowledgeInput[];
  knowledge_requirements?: SceneKnowledgeRequirement[];
  prop_transfers?: PropTransferInput[];
  spatial_relations?: SpatialRelationInput[];
  room_topology?: RoomTopologyInput;
  camera_axes?: CameraAxisInput[];
  open_threads_add?: string[];
  open_threads_resolve?: string[];
  theology_flags?: string[];
};

const slug = (value: string) => value
  .normalize('NFKD')
  .replace(/[^a-zA-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase()
  .slice(0, 72) || 'entity';

const normalizeFact = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase()
  .replace(/[“”‘’]/g, '"')
  .replace(/[^a-z0-9"']+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const clampConfidence = (value: unknown, fallback = 0.8) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

const statefulFields = new Set([
  'appearance', 'face', 'hair', 'clothing', 'wardrobe', 'emotional_state', 'emotion',
  'position', 'location', 'injury', 'injuries', 'prop_state', 'relationship_state',
  'time', 'time_of_day', 'weather', 'lighting_state', 'screen_side', 'stance', 'posture'
]);

const identityFields = new Set([
  'identity', 'appearance', 'face', 'skin_tone', 'hair', 'age', 'body', 'height',
  'voice', 'accent', 'actor_identity', 'actor_face_ref', 'voice_ref'
]);

const oppositeRelation: Partial<Record<SpatialRelation['relation'], SpatialRelation['relation']>> = {
  left_of: 'right_of',
  right_of: 'left_of',
  in_front_of: 'behind',
  behind: 'in_front_of',
  inside: 'outside',
  outside: 'inside',
  screen_left: 'screen_right',
  screen_right: 'screen_left',
  foreground: 'background',
  background: 'foreground'
};

function entityId(kind: EntityState['kind'], name: string, explicit?: string) {
  return explicit && /^[a-zA-Z0-9_-]{1,96}$/.test(explicit)
    ? explicit
    : `${kind}_${slug(name)}`;
}

export function resolveEntityId(snapshot: ContinuitySnapshot, kind: EntityState['kind'], name: string) {
  const wanted = normalizeFact(name);
  const existing = Object.values(snapshot.entities).find((entity) =>
    entity.kind === kind && normalizeFact(entity.name) === wanted
  );
  return existing?.id || entityId(kind, name);
}

function ensureEntity(
  snapshot: ContinuitySnapshot,
  kind: EntityState['kind'],
  name: string,
  explicit?: string
) {
  const resolved = explicit || resolveEntityId(snapshot, kind, name);
  const id = entityId(kind, name, resolved);
  if (!snapshot.entities[id]) snapshot.entities[id] = { id, name, kind, facts: {}, history: [] };
  return snapshot.entities[id];
}

export function upgradeContinuitySnapshot(input: any): ContinuitySnapshot {
  const snapshot = structuredClone(input || {}) as ContinuitySnapshot;
  snapshot.schema_version = 'continuity-v4';
  snapshot.entities = snapshot.entities || {};
  snapshot.character_knowledge = snapshot.character_knowledge || {};
  snapshot.timeline = snapshot.timeline || { order: [], current_label: null };
  snapshot.timeline.order = Array.isArray(snapshot.timeline.order) ? snapshot.timeline.order : [];
  snapshot.last_scene_id = snapshot.last_scene_id || null;
  snapshot.last_shot_id = snapshot.last_shot_id || null;
  snapshot.scene_cursor = Number(snapshot.scene_cursor || 0);
  snapshot.spatial_graph = Array.isArray(snapshot.spatial_graph) ? snapshot.spatial_graph : [];
  snapshot.prop_ownership = snapshot.prop_ownership || {};
  snapshot.room_topology = snapshot.room_topology || {};
  snapshot.camera_axes = snapshot.camera_axes || {};
  snapshot.open_threads = Array.isArray(snapshot.open_threads) ? snapshot.open_threads : [];
  snapshot.theology_flags = Array.isArray(snapshot.theology_flags) ? snapshot.theology_flags : [];
  snapshot.warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  snapshot.updated_at = snapshot.updated_at || new Date().toISOString();
  for (const entity of Object.values(snapshot.entities)) {
    entity.facts = entity.facts || {};
    entity.history = Array.isArray(entity.history) ? entity.history : [];
  }
  return snapshot;
}

function primitiveFactsFromCharacter(character: Record<string, any>): SceneFactInput[] {
  const fields = [
    'role', 'desire', 'fear', 'wound', 'belief', 'arc', 'knowledge_state',
    'identity', 'appearance', 'face', 'skin_tone', 'hair', 'age', 'body',
    'height', 'voice', 'accent', 'actor_identity', 'actor_face_ref', 'voice_ref',
    'clothing', 'wardrobe'
  ];
  return fields
    .filter((field) => character[field] !== undefined && character[field] !== null && character[field] !== '')
    .map((field) => ({
      entity: String(character.name || 'Unnamed character'),
      kind: 'character' as const,
      field,
      value: character[field],
      basis: (character.source_basis?.basis || 'inferred') as Basis,
      confidence: clampConfidence(character.source_basis?.confidence, 0.65),
      locked: field === 'role' || (identityFields.has(field) && character.source_basis?.basis === 'explicit')
    }));
}

export function bootstrapContinuity(args: {
  projectId: string;
  storyVersion: string;
  productionBible?: Record<string, any> | null;
}): ContinuitySnapshot {
  const now = new Date().toISOString();
  const snapshot: ContinuitySnapshot = {
    schema_version: 'continuity-v4',
    project_id: args.projectId,
    story_version: args.storyVersion || 'story_unknown',
    scene_cursor: 0,
    last_scene_id: null,
    last_shot_id: null,
    entities: {},
    character_knowledge: {},
    timeline: { order: [], current_label: null },
    spatial_graph: [],
    prop_ownership: {},
    room_topology: {},
    camera_axes: {},
    open_threads: [],
    theology_flags: [],
    warnings: [],
    updated_at: now
  };

  const bible = args.productionBible || {};
  const characters = Array.isArray(bible.characters) ? bible.characters : [];
  const locations = Array.isArray(bible.locations) ? bible.locations : [];
  const continuityLedger = Array.isArray(bible.continuity_ledger) ? bible.continuity_ledger : [];
  const spiritual = bible.spiritual_context || {};

  for (const character of characters) {
    const name = String(character?.name || '').trim();
    if (!name) continue;
    const entity = ensureEntity(snapshot, 'character', name);
    snapshot.character_knowledge[entity.id] = [];
    for (const fact of primitiveFactsFromCharacter(character)) {
      entity.facts[fact.field] = {
        value: fact.value,
        scene_id: 'bible',
        shot_id: null,
        basis: fact.basis || 'inferred',
        confidence: clampConfidence(fact.confidence, 0.65),
        locked: fact.locked
      };
    }
  }

  for (const location of locations) {
    const name = String(location?.name || location?.heading || '').trim();
    if (!name) continue;
    const entity = ensureEntity(snapshot, 'location', name);
    for (const [field, value] of Object.entries(location)) {
      if (field === 'name' || value === undefined || value === null || typeof value === 'object') continue;
      entity.facts[field] = {
        value,
        scene_id: 'bible',
        shot_id: null,
        basis: 'inferred',
        confidence: 0.6
      };
    }
  }

  for (const row of continuityLedger) {
    const name = String(row?.entity || '').trim();
    const fact = String(row?.fact || '').trim();
    if (!name || !fact) continue;
    const entity = ensureEntity(snapshot, 'character', name);
    const key = `ledger_${Object.keys(entity.facts).filter((k) => k.startsWith('ledger_')).length + 1}`;
    entity.facts[key] = {
      value: fact,
      scene_id: 'bible',
      shot_id: null,
      basis: (row?.source_basis?.basis || 'explicit') as Basis,
      confidence: clampConfidence(row?.source_basis?.confidence, 0.8)
    };
  }

  snapshot.theology_flags = [...new Set(
    Array.isArray(spiritual.theology_review_flags)
      ? spiritual.theology_review_flags.map((x: unknown) => String(x).trim()).filter(Boolean)
      : []
  )];

  return snapshot;
}

function knowledgeContains(known: string[], required: string) {
  const wanted = normalizeFact(required);
  if (!wanted) return true;
  return known.some((item) => {
    const have = normalizeFact(item);
    return have === wanted || have.includes(wanted) || wanted.includes(have);
  });
}

function applySpatialRelations(
  snapshot: ContinuitySnapshot,
  scene: SceneContinuityInput,
  warnings: ContinuityWarning[],
  apply: boolean
) {
  const sceneId = String(scene.id || 'scene_unknown');
  const shotId = scene.shot_id || null;

  for (const input of Array.isArray(scene.spatial_relations) ? scene.spatial_relations : []) {
    const subject = String(input?.subject || '').trim();
    const target = String(input?.target || '').trim();
    const relation = input?.relation;
    if (!subject || !target || !relation) continue;

    const subjectKind = input.subject_kind || 'character';
    const targetKind = input.target_kind || 'world';
    ensureEntity(snapshot, subjectKind, subject);
    ensureEntity(snapshot, targetKind, target);

    const previous = [...snapshot.spatial_graph].reverse().find((row) =>
      normalizeFact(row.subject) === normalizeFact(subject) &&
      normalizeFact(row.target) === normalizeFact(target)
    );

    if (previous && oppositeRelation[previous.relation] === relation && !input.transition) {
      warnings.push({
        code: ['screen_left', 'screen_right'].includes(relation) ? 'SCREEN_DIRECTION_BREAK' : 'SPATIAL_CONFLICT',
        severity: ['screen_left', 'screen_right'].includes(relation) ? 'blocker' : 'warning',
        scene_id: sceneId,
        shot_id: shotId,
        message: `${subject} changed from ${previous.relation} to ${relation} relative to ${target} without an explicit movement transition.`,
        previous: previous.relation,
        incoming: relation
      });
    }

    if (apply) {
      snapshot.spatial_graph.push({
        subject,
        subject_kind: subjectKind,
        relation,
        target,
        target_kind: targetKind,
        scene_id: sceneId,
        shot_id: shotId,
        confidence: clampConfidence(input.confidence, 0.75),
        transition: Boolean(input.transition)
      });
      snapshot.spatial_graph = snapshot.spatial_graph.slice(-250);
    }
  }
}

function topologyAnchorId(locationId: string, label: string) {
  return locationId + ':anchor:' + slug(label);
}

function axisIdFor(sceneId: string, input: CameraAxisInput) {
  const explicit = String(input.axis_id || '').trim();
  if (/^[a-zA-Z0-9_.:-]{1,120}$/.test(explicit)) return explicit;

  const pair = [slug(String(input.subject_a || 'a')), slug(String(input.subject_b || 'b'))]
    .sort()
    .join('__');
  return 'axis_' + slug(sceneId) + '__' + pair;
}

function applyRoomTopology(
  snapshot: ContinuitySnapshot,
  scene: SceneContinuityInput,
  warnings: ContinuityWarning[],
  apply: boolean
) {
  const input = scene.room_topology;
  if (!input) return;

  const sceneId = String(scene.id || 'scene_unknown');
  const shotId = scene.shot_id || null;
  const locationName = String(input.location || '').trim();
  if (!locationName) return;

  const location = ensureEntity(snapshot, 'location', locationName);
  const existing = snapshot.room_topology[location.id] || {
    location_id: location.id,
    location_name: location.name,
    anchors: {},
    relations: [],
    established_scene_id: sceneId,
    updated_at: new Date().toISOString()
  } satisfies RoomTopology;

  for (const anchorInput of Array.isArray(input.anchors) ? input.anchors : []) {
    const label = String(anchorInput?.label || '').trim();
    if (!label) continue;
    const id = topologyAnchorId(location.id, label);
    const previous = existing.anchors[id];
    const kind = anchorInput.kind || previous?.kind || 'other';
    const locked = Boolean(anchorInput.locked ?? previous?.locked ?? false);

    if (previous && previous.kind !== kind && previous.locked) {
      warnings.push({
        code: 'ROOM_TOPOLOGY_CONFLICT',
        severity: 'blocker',
        scene_id: sceneId,
        shot_id: shotId,
        entity_id: location.id,
        field: 'room_anchor',
        message: `${label} changed from a locked ${previous.kind} anchor to ${kind} without rebuilding the room topology.`,
        previous: previous.kind,
        incoming: kind
      });
    }

    if (apply) {
      existing.anchors[id] = {
        id,
        label,
        kind,
        locked,
        scene_id: sceneId,
        shot_id: shotId,
        confidence: clampConfidence(anchorInput.confidence, previous?.confidence ?? 0.78)
      };
    }
  }

  const topologyOpposites: Partial<Record<RoomTopologyRelation['relation'], RoomTopologyRelation['relation']>> = {
    left_of: 'right_of',
    right_of: 'left_of',
    in_front_of: 'behind',
    behind: 'in_front_of',
    inside: 'outside',
    outside: 'inside'
  };

  for (const relationInput of Array.isArray(input.relations) ? input.relations : []) {
    const subject = String(relationInput?.subject || '').trim();
    const target = String(relationInput?.target || '').trim();
    const relation = relationInput?.relation;
    if (!subject || !target || !relation) continue;

    const previous = [...existing.relations].reverse().find((row) =>
      normalizeFact(row.subject) === normalizeFact(subject) &&
      normalizeFact(row.target) === normalizeFact(target)
    );

    const reversed = previous && topologyOpposites[previous.relation] === relation;
    if (reversed && !relationInput.transition) {
      warnings.push({
        code: 'ROOM_TOPOLOGY_CONFLICT',
        severity: previous.locked || relationInput.locked ? 'blocker' : 'warning',
        scene_id: sceneId,
        shot_id: shotId,
        entity_id: location.id,
        field: 'room_topology',
        message: `${subject} changed from ${previous.relation} to ${relation} relative to ${target} without an explicit physical movement or set change.`,
        previous: previous.relation,
        incoming: relation
      });
    }

    if (apply) {
      existing.relations.push({
        subject,
        relation,
        target,
        scene_id: sceneId,
        shot_id: shotId,
        confidence: clampConfidence(relationInput.confidence, 0.78),
        transition: Boolean(relationInput.transition),
        locked: Boolean(relationInput.locked ?? previous?.locked ?? false)
      });
      existing.relations = existing.relations.slice(-160);
    }
  }

  if (apply) {
    existing.updated_at = new Date().toISOString();
    snapshot.room_topology[location.id] = existing;
  }
}

function applyCameraAxes(
  snapshot: ContinuitySnapshot,
  scene: SceneContinuityInput,
  warnings: ContinuityWarning[],
  apply: boolean
) {
  const sceneId = String(scene.id || 'scene_unknown');
  const shotId = scene.shot_id || null;

  for (const input of Array.isArray(scene.camera_axes) ? scene.camera_axes : []) {
    const subjectA = String(input?.subject_a || '').trim();
    const subjectB = String(input?.subject_b || '').trim();
    if (!subjectA || !subjectB) continue;

    ensureEntity(snapshot, 'character', subjectA);
    ensureEntity(snapshot, 'character', subjectB);

    const id = axisIdFor(sceneId, input);
    const locationName = String(input.location || '').trim();
    const location = locationName ? ensureEntity(snapshot, 'location', locationName) : null;
    const previous = snapshot.camera_axes[id];

    const cameraSide = input.camera_side || 'unknown';
    const sideA = input.subject_a_screen_side || 'unknown';
    const sideB = input.subject_b_screen_side || 'unknown';
    const bridge = Boolean(input.bridge_shot) || cameraSide === 'neutral' || cameraSide === 'on_axis';
    const deliberate = Boolean(input.intentional_cross || input.reset_axis);
    const previousHardSide = previous?.last_camera_side;
    const oppositeCameraSide =
      (previousHardSide === 'side_a' && cameraSide === 'side_b') ||
      (previousHardSide === 'side_b' && cameraSide === 'side_a');

    const bridgeAllowsCross = Boolean(previous?.bridge_shot_seen || bridge);
    if (previous && oppositeCameraSide && !deliberate && !bridgeAllowsCross) {
      warnings.push({
        code: 'CAMERA_AXIS_CROSS',
        severity: 'blocker',
        scene_id: sceneId,
        shot_id: shotId,
        field: 'camera_axis',
        message: `Camera coverage crossed the established 180-degree axis between ${subjectA} and ${subjectB} without an intentional cross, neutral bridge, or axis reset.`,
        previous: previous.last_camera_side,
        incoming: cameraSide
      });
    }

    const screenFlip =
      previous &&
      previous.subject_a_screen_side !== 'unknown' &&
      previous.subject_b_screen_side !== 'unknown' &&
      sideA !== 'unknown' &&
      sideB !== 'unknown' &&
      previous.subject_a_screen_side !== sideA &&
      previous.subject_b_screen_side !== sideB;

    if (screenFlip && !deliberate && !bridgeAllowsCross && !oppositeCameraSide) {
      warnings.push({
        code: 'EYELINE_DIRECTION_BREAK',
        severity: 'blocker',
        scene_id: sceneId,
        shot_id: shotId,
        field: 'screen_direction',
        message: `${subjectA} and ${subjectB} swapped established screen sides without a justified camera-axis transition.`,
        previous: {
          subject_a: previous.subject_a_screen_side,
          subject_b: previous.subject_b_screen_side
        },
        incoming: {
          subject_a: sideA,
          subject_b: sideB
        }
      });
    }

    if (!apply) continue;

    const nextHardSide =
      cameraSide === 'side_a' || cameraSide === 'side_b'
        ? cameraSide
        : previous?.last_camera_side || cameraSide;

    snapshot.camera_axes[id] = {
      id,
      scene_id: sceneId,
      location_id: location?.id || previous?.location_id || null,
      subject_a: subjectA,
      subject_b: subjectB,
      established_shot_id:
        input.reset_axis || !previous
          ? shotId
          : previous.established_shot_id,
      established_camera_side:
        input.reset_axis || !previous
          ? cameraSide
          : previous.established_camera_side,
      last_camera_side: nextHardSide,
      subject_a_screen_side:
        sideA !== 'unknown' ? sideA : previous?.subject_a_screen_side || 'unknown',
      subject_b_screen_side:
        sideB !== 'unknown' ? sideB : previous?.subject_b_screen_side || 'unknown',
      last_shot_id: shotId,
      bridge_shot_seen: bridge
        ? true
        : deliberate || oppositeCameraSide
          ? false
          : Boolean(previous?.bridge_shot_seen),
      last_cross_reason:
        deliberate
          ? String(input.reason || (input.reset_axis ? 'axis reset' : 'intentional cross')).trim() || null
          : previous?.last_cross_reason || null
    };
  }
}

function applyPropTransfers(
  snapshot: ContinuitySnapshot,
  scene: SceneContinuityInput,
  warnings: ContinuityWarning[],
  apply: boolean
) {
  const sceneId = String(scene.id || 'scene_unknown');
  const shotId = scene.shot_id || null;

  for (const input of Array.isArray(scene.prop_transfers) ? scene.prop_transfers : []) {
    const propName = String(input?.prop || '').trim();
    if (!propName) continue;

    const prop = ensureEntity(snapshot, 'prop', propName);
    const current = snapshot.prop_ownership[prop.id];
    const from = String(input?.from || '').trim();
    const to = String(input?.to || '').trim();
    const location = String(input?.location || '').trim();
    const transition = Boolean(input?.transition);

    if (
      current?.holder_name &&
      from &&
      normalizeFact(current.holder_name) !== normalizeFact(from) &&
      !transition
    ) {
      warnings.push({
        code: 'PROP_OWNERSHIP_CONFLICT',
        severity: 'blocker',
        scene_id: sceneId,
        shot_id: shotId,
        entity_id: prop.id,
        field: 'holder',
        message: `${propName} is established with ${current.holder_name}, but this update says it comes from ${from} without a transfer.`,
        previous: current.holder_name,
        incoming: from
      });
    }

    if (!apply) continue;

    let holderId: string | null = current?.holder_id || null;
    let holderName: string | null = current?.holder_name || null;

    if (to) {
      const holder = ensureEntity(snapshot, 'character', to);
      holderId = holder.id;
      holderName = holder.name;
    } else if (location || from) {
      holderId = null;
      holderName = null;
    }

    snapshot.prop_ownership[prop.id] = {
      prop_id: prop.id,
      prop_name: prop.name,
      holder_id: holderId,
      holder_name: holderName,
      location: location || current?.location || null,
      state: String(input?.state || '').trim() || current?.state || null,
      scene_id: sceneId,
      shot_id: shotId,
      confidence: clampConfidence(input?.confidence, 0.8)
    };

    prop.facts.owner = {
      value: holderName || null,
      scene_id: sceneId,
      shot_id: shotId,
      basis: 'explicit',
      confidence: clampConfidence(input?.confidence, 0.8)
    };
    if (location) {
      prop.facts.location = {
        value: location,
        scene_id: sceneId,
        shot_id: shotId,
        basis: 'explicit',
        confidence: clampConfidence(input?.confidence, 0.8)
      };
    }
    if (input?.state) {
      prop.facts.prop_state = {
        value: input.state,
        scene_id: sceneId,
        shot_id: shotId,
        basis: 'explicit',
        confidence: clampConfidence(input?.confidence, 0.8)
      };
    }
  }
}

export function evaluateAndApplyScene(
  current: ContinuitySnapshot,
  scene: SceneContinuityInput,
  options: { apply: boolean } = { apply: true }
) {
  const snapshot = upgradeContinuitySnapshot(current);
  const sceneId = String(scene.id || `scene_${Number(scene.index || snapshot.scene_cursor + 1)}`);
  const shotId = scene.shot_id || null;
  const warnings: ContinuityWarning[] = [];

  const requestedIndex = Number(scene.index || snapshot.scene_cursor + 1);
  if (requestedIndex < snapshot.scene_cursor) {
    warnings.push({
      code: 'TIMELINE_REGRESSION',
      severity: 'warning',
      scene_id: sceneId,
      shot_id: shotId,
      message: `Scene index ${requestedIndex} is behind the current continuity cursor ${snapshot.scene_cursor}.`
    });
  }

  for (const requirement of Array.isArray(scene.knowledge_requirements) ? scene.knowledge_requirements : []) {
    const name = String(requirement?.character || '').trim();
    const fact = String(requirement?.fact || '').trim();
    if (!name || !fact) continue;
    const characterId = resolveEntityId(snapshot, 'character', name);
    const known = snapshot.character_knowledge[characterId] || [];
    if (!knowledgeContains(known, fact)) {
      warnings.push({
        code: 'KNOWLEDGE_LEAK',
        severity: 'blocker',
        scene_id: sceneId,
        shot_id: shotId,
        entity_id: characterId,
        field: 'knowledge',
        message: `${name} acts as if they know "${fact}" before continuity records them learning it.`,
        previous: known,
        incoming: fact
      });
    }
  }

  for (const input of Array.isArray(scene.facts) ? scene.facts : []) {
    const field = String(input?.field || '').trim();
    const name = String(input?.entity || '').trim();
    const kind = input?.kind || 'character';
    if (!field || (!name && !input?.entity_id)) {
      warnings.push({
        code: 'MISSING_ENTITY',
        severity: 'warning',
        scene_id: sceneId,
        shot_id: shotId,
        message: 'A continuity fact was skipped because its entity or field was missing.'
      });
      continue;
    }

    const fallbackName = name || String(input.entity_id);
    const entity = ensureEntity(snapshot, kind, fallbackName, input.entity_id);
    const previous = entity.facts[field];
    const transition = Boolean(input.transition);
    const basis = input.basis || 'explicit';
    const confidence = clampConfidence(input.confidence);
    const autoLockIdentity = !previous
      && kind === 'character'
      && identityFields.has(field)
      && ['explicit', 'human'].includes(basis)
      && confidence >= 0.75;

    if (previous && !same(previous.value, input.value)) {
      if (previous.locked && !transition) {
        warnings.push({
          code: 'LOCKED_FACT_CONFLICT',
          severity: 'blocker',
          scene_id: sceneId,
          shot_id: shotId,
          entity_id: entity.id,
          field,
          message: `${entity.name}'s locked ${field} conflicts with established continuity.`,
          previous: previous.value,
          incoming: input.value
        });
      } else if (statefulFields.has(field) && !transition) {
        warnings.push({
          code: 'UNEXPLAINED_CHANGE',
          severity: 'warning',
          scene_id: sceneId,
          shot_id: shotId,
          entity_id: entity.id,
          field,
          message: `${entity.name}'s ${field} changed without an explicit transition.`,
          previous: previous.value,
          incoming: input.value
        });
      }
    }

    if (options.apply) {
      entity.history.push({
        scene_id: sceneId,
        shot_id: shotId,
        field,
        previous: previous?.value,
        next: input.value,
        basis,
        confidence,
        transition,
        at: new Date().toISOString()
      });
      entity.facts[field] = {
        value: input.value,
        scene_id: sceneId,
        shot_id: shotId,
        basis,
        confidence,
        locked: Boolean(input.locked ?? previous?.locked ?? autoLockIdentity),
        note: input.note
      };
    }
  }

  applyPropTransfers(snapshot, { ...scene, id: sceneId }, warnings, options.apply);
  applySpatialRelations(snapshot, { ...scene, id: sceneId }, warnings, options.apply);
  applyRoomTopology(snapshot, { ...scene, id: sceneId }, warnings, options.apply);
  applyCameraAxes(snapshot, { ...scene, id: sceneId }, warnings, options.apply);

  for (const row of Array.isArray(scene.knowledge) ? scene.knowledge : []) {
    const name = String(row?.character || '').trim();
    if (!name) continue;
    const entity = ensureEntity(snapshot, 'character', name);
    const known = new Set(snapshot.character_knowledge[entity.id] || []);
    for (const item of Array.isArray(row.learns) ? row.learns : []) known.add(String(item));
    for (const item of Array.isArray(row.forgets) ? row.forgets : []) known.delete(String(item));
    if (options.apply) snapshot.character_knowledge[entity.id] = [...known];
  }

  if (options.apply) {
    for (const item of Array.isArray(scene.open_threads_add) ? scene.open_threads_add : []) {
      const value = String(item).trim();
      if (value && !snapshot.open_threads.includes(value)) snapshot.open_threads.push(value);
    }
    if (Array.isArray(scene.open_threads_resolve)) {
      const resolved = new Set(scene.open_threads_resolve.map((x) => String(x).trim()));
      snapshot.open_threads = snapshot.open_threads.filter((x) => !resolved.has(x));
    }
    for (const flag of Array.isArray(scene.theology_flags) ? scene.theology_flags : []) {
      const value = String(flag).trim();
      if (value && !snapshot.theology_flags.includes(value)) snapshot.theology_flags.push(value);
    }

    if (scene.time_label) {
      const label = String(scene.time_label).trim();
      snapshot.timeline.current_label = label || snapshot.timeline.current_label;
    }
    if (!snapshot.timeline.order.includes(sceneId)) snapshot.timeline.order.push(sceneId);
    snapshot.scene_cursor = Math.max(snapshot.scene_cursor, requestedIndex);
    snapshot.last_scene_id = sceneId;
    snapshot.last_shot_id = shotId || snapshot.last_shot_id;
    snapshot.updated_at = new Date().toISOString();
    snapshot.warnings = [...snapshot.warnings.slice(-180), ...warnings].slice(-250);
  }

  return {
    snapshot,
    scene_id: sceneId,
    shot_id: shotId,
    warnings,
    can_render: !warnings.some((warning) => warning.severity === 'blocker')
  };
}

export function compactContinuityContext(snapshotInput: ContinuitySnapshot) {
  const snapshot = upgradeContinuitySnapshot(snapshotInput);
  const entities = Object.values(snapshot.entities).map((entity) => ({
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    facts: Object.fromEntries(Object.entries(entity.facts).map(([field, fact]) => [field, fact.value]))
  }));

  return {
    project_id: snapshot.project_id,
    story_version: snapshot.story_version,
    scene_cursor: snapshot.scene_cursor,
    last_scene_id: snapshot.last_scene_id,
    last_shot_id: snapshot.last_shot_id,
    timeline: snapshot.timeline,
    entities,
    character_knowledge: snapshot.character_knowledge,
    prop_ownership: snapshot.prop_ownership,
    spatial_graph: snapshot.spatial_graph.slice(-80),
    room_topology: snapshot.room_topology,
    camera_axes: snapshot.camera_axes,
    open_threads: snapshot.open_threads,
    theology_flags: snapshot.theology_flags
  };
}

export function buildRenderContinuityContract(
  snapshotInput: ContinuitySnapshot,
  sceneId?: string | null,
  shotId?: string | null
) {
  const snapshot = upgradeContinuitySnapshot(snapshotInput);
  const characterStates = Object.values(snapshot.entities)
    .filter((entity) => entity.kind === 'character')
    .map((entity) => {
      const facts = Object.fromEntries(Object.entries(entity.facts).map(([field, fact]) => [field, fact.value]));
      const locked = Object.fromEntries(Object.entries(entity.facts)
        .filter(([, fact]) => fact.locked)
        .map(([field, fact]) => [field, fact.value]));
      return {
        id: entity.id,
        name: entity.name,
        locked_identity: locked,
        current_state: facts,
        knowledge: snapshot.character_knowledge[entity.id] || []
      };
    });

  const props = Object.values(snapshot.entities)
    .filter((entity) => entity.kind === 'prop')
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      ownership: snapshot.prop_ownership[entity.id] || null,
      state: Object.fromEntries(Object.entries(entity.facts).map(([field, fact]) => [field, fact.value]))
    }));

  const locations = Object.values(snapshot.entities)
    .filter((entity) => entity.kind === 'location')
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      state: Object.fromEntries(Object.entries(entity.facts).map(([field, fact]) => [field, fact.value]))
    }));

  const relationships = Object.values(snapshot.entities)
    .filter((entity) => entity.kind === 'relationship')
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      state: Object.fromEntries(Object.entries(entity.facts).map(([field, fact]) => [field, fact.value]))
    }));

  const relevantWarnings = snapshot.warnings.filter((warning) =>
    (!sceneId || warning.scene_id === sceneId) &&
    (!shotId || !warning.shot_id || warning.shot_id === shotId)
  );
  const blockers = relevantWarnings.filter((warning) => warning.severity === 'blocker');
  const spatial = snapshot.spatial_graph.filter((row) =>
    (!sceneId || row.scene_id === sceneId) &&
    (!shotId || !row.shot_id || row.shot_id === shotId)
  );

  return {
    contract_version: 'render-continuity-v3',
    project_id: snapshot.project_id,
    story_version: snapshot.story_version,
    scene_id: sceneId || snapshot.last_scene_id,
    shot_id: shotId || null,
    scene_cursor: snapshot.scene_cursor,
    timeline: snapshot.timeline,
    characters: characterStates,
    props,
    prop_ownership: snapshot.prop_ownership,
    locations,
    relationships,
    spatial_graph: spatial.length ? spatial : snapshot.spatial_graph.slice(-50),
    room_topology: snapshot.room_topology,
    camera_axes: Object.fromEntries(
      Object.entries(snapshot.camera_axes).filter(([, axis]) => !sceneId || axis.scene_id === sceneId)
    ),
    open_threads: snapshot.open_threads,
    theology_flags: snapshot.theology_flags,
    continuity_warnings: relevantWarnings,
    hard_blockers: blockers,
    hard_rules: [
      'Do not alter locked character identity facts or approved reference IDs.',
      'Do not change wardrobe, injuries, props, location or emotional state unless the story contains an explicit transition.',
      'Do not let a character react to information they have not learned.',
      'Preserve prop holder, prop location and prop state until an explicit transfer or movement occurs.',
      'Preserve screen side, facing and established geography unless an explicit movement transition justifies the change.',
      'Preserve locked room anchors and physical topology unless the scene explicitly moves or rebuilds them.',
      'Do not cross an established camera axis unless an intentional cross, neutral bridge shot or explicit axis reset is recorded.'
    ],
    can_render: blockers.length === 0
  };
}
