export type Basis = 'explicit' | 'inferred' | 'creative-adaptation' | 'human';

export type ContinuityFact = {
  value: unknown;
  scene_id: string;
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
    field: string;
    previous: unknown;
    next: unknown;
    basis: Basis;
    confidence: number;
    transition: boolean;
    at: string;
  }>;
};

export type ContinuityWarning = {
  code: 'LOCKED_FACT_CONFLICT' | 'UNEXPLAINED_CHANGE' | 'KNOWLEDGE_LEAK' | 'TIMELINE_REGRESSION' | 'MISSING_ENTITY';
  severity: 'info' | 'warning' | 'blocker';
  scene_id: string;
  entity_id?: string;
  field?: string;
  message: string;
  previous?: unknown;
  incoming?: unknown;
};

export type ContinuitySnapshot = {
  schema_version: 'continuity-v1';
  project_id: string;
  story_version: string;
  scene_cursor: number;
  last_scene_id: string | null;
  entities: Record<string, EntityState>;
  character_knowledge: Record<string, string[]>;
  timeline: {
    order: string[];
    current_label: string | null;
  };
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

export type SceneContinuityInput = {
  id?: string;
  index?: number;
  time_label?: string;
  facts?: SceneFactInput[];
  knowledge?: SceneKnowledgeInput[];
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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const clampConfidence = (value: unknown, fallback = 0.8) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

const statefulFields = new Set([
  'appearance',
  'clothing',
  'wardrobe',
  'emotional_state',
  'emotion',
  'position',
  'location',
  'injury',
  'injuries',
  'prop_state',
  'relationship_state',
  'time',
  'time_of_day'
]);

function entityId(kind: EntityState['kind'], name: string, explicit?: string) {
  return explicit && /^[a-zA-Z0-9_-]{1,96}$/.test(explicit)
    ? explicit
    : `${kind}_${slug(name)}`;
}

function ensureEntity(
  snapshot: ContinuitySnapshot,
  kind: EntityState['kind'],
  name: string,
  explicit?: string
) {
  const id = entityId(kind, name, explicit);
  if (!snapshot.entities[id]) {
    snapshot.entities[id] = { id, name, kind, facts: {}, history: [] };
  }
  return snapshot.entities[id];
}

function primitiveFactsFromCharacter(character: Record<string, any>): SceneFactInput[] {
  const fields = ['role', 'desire', 'fear', 'wound', 'belief', 'arc', 'knowledge_state', 'appearance', 'clothing', 'wardrobe'];
  return fields
    .filter((field) => character[field] !== undefined && character[field] !== null && character[field] !== '')
    .map((field) => ({
      entity: String(character.name || 'Unnamed character'),
      kind: 'character' as const,
      field,
      value: character[field],
      basis: (character.source_basis?.basis || 'inferred') as Basis,
      confidence: clampConfidence(character.source_basis?.confidence, 0.65),
      locked: ['role'].includes(field)
    }));
}

export function bootstrapContinuity(args: {
  projectId: string;
  storyVersion: string;
  productionBible?: Record<string, any> | null;
}): ContinuitySnapshot {
  const now = new Date().toISOString();
  const snapshot: ContinuitySnapshot = {
    schema_version: 'continuity-v1',
    project_id: args.projectId,
    story_version: args.storyVersion || 'story_unknown',
    scene_cursor: 0,
    last_scene_id: null,
    entities: {},
    character_knowledge: {},
    timeline: { order: [], current_label: null },
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

export function evaluateAndApplyScene(
  current: ContinuitySnapshot,
  scene: SceneContinuityInput,
  options: { apply: boolean } = { apply: true }
) {
  const snapshot = structuredClone(current);
  const sceneId = String(scene.id || `scene_${Number(scene.index || snapshot.scene_cursor + 1)}`);
  const warnings: ContinuityWarning[] = [];

  const requestedIndex = Number(scene.index || snapshot.scene_cursor + 1);
  if (requestedIndex < snapshot.scene_cursor) {
    warnings.push({
      code: 'TIMELINE_REGRESSION',
      severity: 'warning',
      scene_id: sceneId,
      message: `Scene index ${requestedIndex} is behind the current continuity cursor ${snapshot.scene_cursor}.`
    });
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
        message: 'A continuity fact was skipped because its entity or field was missing.'
      });
      continue;
    }

    const fallbackName = name || String(input.entity_id);
    const entity = ensureEntity(snapshot, kind, fallbackName, input.entity_id);
    const previous = entity.facts[field];
    const transition = Boolean(input.transition);

    if (previous && !same(previous.value, input.value)) {
      if (previous.locked && !transition) {
        warnings.push({
          code: 'LOCKED_FACT_CONFLICT',
          severity: 'blocker',
          scene_id: sceneId,
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
        field,
        previous: previous?.value,
        next: input.value,
        basis: input.basis || 'explicit',
        confidence: clampConfidence(input.confidence),
        transition,
        at: new Date().toISOString()
      });
      entity.facts[field] = {
        value: input.value,
        scene_id: sceneId,
        basis: input.basis || 'explicit',
        confidence: clampConfidence(input.confidence),
        locked: Boolean(input.locked ?? previous?.locked),
        note: input.note
      };
    }
  }

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
    snapshot.updated_at = new Date().toISOString();
    snapshot.warnings = [...snapshot.warnings.slice(-150), ...warnings].slice(-200);
  }

  return {
    snapshot,
    scene_id: sceneId,
    warnings,
    can_render: !warnings.some((warning) => warning.severity === 'blocker')
  };
}

export function compactContinuityContext(snapshot: ContinuitySnapshot) {
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
    timeline: snapshot.timeline,
    entities,
    character_knowledge: snapshot.character_knowledge,
    open_threads: snapshot.open_threads,
    theology_flags: snapshot.theology_flags
  };
}
