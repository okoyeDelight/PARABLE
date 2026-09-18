import { getDeployStore, getStore } from '@netlify/blobs';
import {
  evaluateAndApplyScene,
  upgradeContinuitySnapshot,
  type ContinuitySnapshot,
  type EntityState
} from './_lib/continuity-core.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function store() {
  const production = Netlify.context?.deploy?.context === 'production';
  return production
    ? getStore('parable-continuity', { consistency: 'strong' })
    : getDeployStore('parable-continuity');
}

const clean = (value: unknown, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

const allowed: Record<string, Set<string>> = {
  character: new Set([
    'actor_face_ref',
    'actor_visual_ref',
    'voice_ref',
    'wardrobe_reference_ref',
    'performance_reference_ref'
  ]),
  location: new Set([
    'location_visual_ref',
    'layout_reference_ref',
    'lighting_reference_ref'
  ])
};

function findEntity(snapshot: ContinuitySnapshot, kind: EntityState['kind'], name: string) {
  const wanted = normalize(name);
  return Object.values(snapshot.entities).find((entity) =>
    entity.kind === kind && normalize(entity.name) === wanted
  );
}

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const continuityStore = store();

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

    const raw = await continuityStore.get('project/' + projectId + '/latest', { type: 'json' }) as ContinuitySnapshot | null;
    if (!raw) return json({ error: 'Continuity has not been established for this project.' }, 404);

    const snapshot = upgradeContinuitySnapshot(raw);
    const entities = Object.values(snapshot.entities).map((entity) => ({
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      references: Object.fromEntries(
        Object.entries(entity.facts)
          .filter(([field]) => field.endsWith('_ref'))
          .map(([field, fact]) => [field, { value: fact.value, locked: Boolean(fact.locked), scene_id: fact.scene_id }])
      )
    })).filter((entity) => Object.keys(entity.references).length > 0);

    return json({
      project_id: projectId,
      story_version: snapshot.story_version,
      reference_locks: entities
    });
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const entityKind = clean(body.entityKind, 32) as EntityState['kind'];
  const entityName = clean(body.entityName, 160);
  const refs = body.references && typeof body.references === 'object' ? body.references as Record<string, unknown> : {};
  const approved = body.humanApproved === true;
  const replaceExisting = body.replaceExisting === true;

  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);
  if (!['character', 'location'].includes(entityKind)) return json({ error: 'entityKind must be character or location.' }, 400);
  if (!entityName) return json({ error: 'entityName is required.' }, 400);
  if (!approved) {
    return json({
      error: 'Reference locks require explicit human approval.',
      required_field: 'humanApproved: true'
    }, 400);
  }

  const raw = await continuityStore.get('project/' + projectId + '/latest', { type: 'json' }) as ContinuitySnapshot | null;
  if (!raw) return json({ error: 'Continuity has not been established for this project.' }, 409);

  const snapshot = upgradeContinuitySnapshot(raw);
  const entity = findEntity(snapshot, entityKind, entityName);
  if (!entity) {
    return json({
      error: 'Reference locks can only be attached to an entity already established by the Production Bible or continuity.',
      entity: entityName
    }, 409);
  }

  const accepted = Object.entries(refs)
    .map(([field, value]) => [clean(field, 80), clean(value, 1000)] as const)
    .filter(([field, value]) => allowed[entityKind]?.has(field) && value);

  if (!accepted.length) {
    return json({
      error: 'No supported reference fields were supplied.',
      supported_fields: [...(allowed[entityKind] || [])]
    }, 400);
  }

  const scene = {
    id: 'reference_lock',
    index: snapshot.scene_cursor || 1,
    facts: accepted.map(([field, value]) => ({
      entity: entity.name,
      kind: entityKind,
      field,
      value,
      basis: 'human' as const,
      confidence: 1,
      locked: true,
      transition: replaceExisting,
      note: 'Human-approved production reference lock.'
    }))
  };

  const checked = evaluateAndApplyScene(snapshot, scene, { apply: false });
  const blockers = checked.warnings.filter((warning) => warning.severity === 'blocker');
  if (blockers.length && !replaceExisting) {
    return json({
      error: 'A locked reference already conflicts with this update.',
      blockers,
      hint: 'Set replaceExisting=true only after deliberately approving the replacement.'
    }, 409);
  }

  const applied = evaluateAndApplyScene(snapshot, scene, { apply: true });
  await Promise.all([
    continuityStore.setJSON('project/' + projectId + '/latest', applied.snapshot),
    continuityStore.setJSON(
      'project/' + projectId + '/versions/' + applied.snapshot.story_version + '/latest',
      applied.snapshot
    )
  ]);

  return json({
    project_id: projectId,
    entity: entity.name,
    entity_kind: entityKind,
    references: Object.fromEntries(accepted),
    replaced_existing: replaceExisting,
    locked: true,
    continuity_version: applied.snapshot.schema_version
  }, 201);
};

export const config = {
  path: '/api/reference-locks',
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
