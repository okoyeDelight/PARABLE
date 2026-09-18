import { stableHash } from './render-foundation.mts';

export type SpatialNodeKind =
  | 'character'
  | 'prop'
  | 'location'
  | 'zone'
  | 'furniture'
  | 'portal'
  | 'world';

export type SpatialEdgeRelation =
  | 'left_of'
  | 'right_of'
  | 'in_front_of'
  | 'behind'
  | 'inside'
  | 'outside'
  | 'near'
  | 'facing'
  | 'foreground'
  | 'background';

export type CameraAxisSide = 'A' | 'B' | 'on-axis' | 'unknown';

export type SceneSpatialPlan = {
  spatial_plan_version: 'parable-spatial-plan-v1';
  spatial_plan_hash: string;
  project_id: string;
  story_version: string;
  scene_id: string;
  axis_critical: boolean;
  approval: {
    status: 'not-required' | 'pending' | 'approved';
    approved_by_actor_id: string | null;
    approved_at: string | null;
    reviewer_note: string | null;
    override_blockers: boolean;
  };
  room_topology: {
    nodes: Array<{
      id: string;
      label: string;
      kind: SpatialNodeKind;
    }>;
    edges: Array<{
      subject: string;
      relation: SpatialEdgeRelation;
      target: string;
      confidence: number;
      source: 'continuity';
    }>;
  };
  axis: {
    axis_id: string | null;
    subject_a: string | null;
    subject_b: string | null;
    established_shot_id: string | null;
    default_camera_side: CameraAxisSide;
    must_preserve: boolean;
  };
  shots: Array<{
    shot_id: string;
    mentioned_characters: string[];
    axis_side: CameraAxisSide;
    axis_action: 'not-applicable' | 'establish' | 'preserve' | 'cross';
    explicit_crossing: boolean;
    reestablishes_geography: boolean;
    screen_positions: Record<string, 'left' | 'right' | 'center' | 'unknown'>;
    hard_constraints: string[];
    warnings: Array<{
      code: 'AXIS_CROSS_REQUIRES_REESTABLISHMENT' | 'SCREEN_SIDE_FLIP' | 'SPATIAL_EVIDENCE_WEAK';
      severity: 'info' | 'warning' | 'blocker';
      message: string;
    }>;
  }>;
  blockers: string[];
  warnings: string[];
  source: {
    shot_count: number;
    continuity_relation_count: number;
    known_character_count: number;
  };
  created_at: string;
};

type BuildInput = {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shots: Array<Record<string, any>>;
  continuityContract?: Record<string, any> | null;
  shotStates?: Record<string, Record<string, any> | null>;
  existing?: SceneSpatialPlan | null;
  overrides?: {
    axis_subjects?: string[];
    shot_sides?: Record<string, CameraAxisSide>;
    allow_crossings?: string[];
  } | null;
};

const clean = (value: unknown, max = 800) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const norm = (value: unknown) => clean(value, 220)
  .toLocaleLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function slug(value: string) {
  return norm(value).replace(/\s+/g, '_').slice(0, 72) || 'unknown';
}

function uniq<T>(items: T[]) {
  return [...new Set(items)];
}

function shotText(shot: Record<string, any>) {
  return [
    shot?.beat,
    shot?.purpose,
    shot?.dramatic_purpose,
    shot?.blocking,
    shot?.performance,
    shot?.continuity_notes,
    shot?.motion,
    shot?.shot_size,
    shot?.shot_type
  ].map((value) => clean(value, 1000)).filter(Boolean).join(' ');
}

function knownCharacters(contract: Record<string, any> | null | undefined) {
  const rows = Array.isArray(contract?.characters) ? contract.characters : [];
  return rows
    .map((row: any) => ({
      id: clean(row?.id, 120),
      name: clean(row?.name, 180)
    }))
    .filter((row: any) => row.id && row.name);
}

function mentionedCharacters(text: string, characters: Array<{ id: string; name: string }>) {
  const haystack = ' ' + norm(text) + ' ';
  return characters.filter((character) => {
    const needle = norm(character.name);
    return needle && haystack.includes(' ' + needle + ' ');
  });
}

const CROSS_RE = /\b(cross(?:es|ed|ing)?\s+(?:the\s+)?(?:axis|line)|cross(?:es|ed|ing)?\s+behind|orbit(?:s|ed|ing)?|arc(?:s|ed|ing)?\s+around|move(?:s|d|ing)?\s+around|switch(?:es|ed|ing)?\s+sides?|180\s*degree)\b/i;
const REESTABLISH_RE = /\b(wide|master|two[- ]shot|re[- ]?establish|establishing|on[- ]axis|neutral\s+angle)\b/i;

function latestScreenPositions(contract: Record<string, any> | null | undefined) {
  const out: Record<string, 'left' | 'right' | 'center' | 'unknown'> = {};
  const graph = Array.isArray(contract?.spatial_graph)
    ? contract.spatial_graph
    : Array.isArray(contract?.spatial_relations)
      ? contract.spatial_relations
      : [];

  for (const row of graph) {
    const subject = clean(row?.subject, 180);
    if (!subject) continue;
    if (row?.relation === 'screen_left') out[norm(subject)] = 'left';
    if (row?.relation === 'screen_right') out[norm(subject)] = 'right';
  }
  return out;
}

function roomTopology(contract: Record<string, any> | null | undefined) {
  const nodes = new Map<string, { id: string; label: string; kind: SpatialNodeKind }>();
  const edges: SceneSpatialPlan['room_topology']['edges'] = [];

  const addNode = (label: string, kind: SpatialNodeKind) => {
    const key = norm(label);
    if (!key) return;
    if (!nodes.has(key)) nodes.set(key, { id: kind + '_' + slug(label), label: clean(label, 180), kind });
  };

  const characters = Array.isArray(contract?.characters) ? contract.characters : [];
  const props = Array.isArray(contract?.props) ? contract.props : [];
  const locations = Array.isArray(contract?.locations) ? contract.locations : [];
  for (const row of characters) addNode(row?.name, 'character');
  for (const row of props) addNode(row?.name, 'prop');
  for (const row of locations) addNode(row?.name, 'location');

  const graph = Array.isArray(contract?.spatial_graph) ? contract.spatial_graph : [];
  const allowed = new Set<SpatialEdgeRelation>([
    'left_of','right_of','in_front_of','behind','inside','outside','near','facing','foreground','background'
  ]);

  for (const row of graph.slice(-120)) {
    const subject = clean(row?.subject, 180);
    const target = clean(row?.target, 180);
    const relation = clean(row?.relation, 80) as SpatialEdgeRelation;
    if (!subject || !target || !allowed.has(relation)) continue;
    addNode(subject, (row?.subject_kind || 'world') as SpatialNodeKind);
    addNode(target, (row?.target_kind || 'world') as SpatialNodeKind);
    edges.push({
      subject,
      relation,
      target,
      confidence: Math.max(0, Math.min(1, Number(row?.confidence) || 0.5)),
      source: 'continuity'
    });
  }

  return {
    nodes: [...nodes.values()].slice(0, 120),
    edges: edges.slice(-180)
  };
}

function axisSubjects(
  shots: Array<Record<string, any>>,
  characters: Array<{ id: string; name: string }>,
  overrideSubjects?: string[]
) {
  const override = (overrideSubjects || [])
    .map((value) => characters.find((character) =>
      character.id === value || norm(character.name) === norm(value)
    ))
    .filter(Boolean) as Array<{ id: string; name: string }>;
  if (override.length >= 2) return override.slice(0, 2);

  const counts = new Map<string, { character: { id: string; name: string }; count: number }>();
  for (const shot of shots) {
    for (const character of mentionedCharacters(shotText(shot), characters)) {
      const current = counts.get(character.id) || { character, count: 0 };
      current.count += 1;
      counts.set(character.id, current);
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.character.name.localeCompare(b.character.name))
    .slice(0, 2)
    .map((row) => row.character);
}

export async function buildSceneSpatialPlan(input: BuildInput): Promise<SceneSpatialPlan> {
  const characters = knownCharacters(input.continuityContract);
  const pair = axisSubjects(input.shots, characters, input.overrides?.axis_subjects);
  const axisCritical = pair.length >= 2;
  const initialScreenPositions = latestScreenPositions(input.continuityContract);
  const allowCrossings = new Set((input.overrides?.allow_crossings || []).map(String));
  const shotSides = input.overrides?.shot_sides || {};

  const pairNames = pair.map((row) => row.name);
  const defaultSide: CameraAxisSide = input.existing?.axis?.default_camera_side || 'A';
  let establishedShotId: string | null = input.existing?.axis?.established_shot_id || null;
  let activeSide: CameraAxisSide = defaultSide;
  const sceneWarnings: string[] = [];
  const blockers: string[] = [];
  const priorPositions: Record<string, 'left' | 'right' | 'center' | 'unknown'> = { ...initialScreenPositions };

  const plannedShots: SceneSpatialPlan['shots'] = [];

  for (let index = 0; index < input.shots.length; index++) {
    const shot = input.shots[index] || {};
    const shotId = clean(shot?.id || ('shot_' + (index + 1)), 96);
    const text = shotText(shot);
    const mentioned = mentionedCharacters(text, characters);
    const explicitCrossing = CROSS_RE.test(text);
    const reestablishes = REESTABLISH_RE.test(text);
    const warnings: SceneSpatialPlan['shots'][number]['warnings'] = [];

    let action: SceneSpatialPlan['shots'][number]['axis_action'] = 'not-applicable';
    let side: CameraAxisSide = shotSides[shotId] || activeSide;

    if (axisCritical && mentioned.some((row) => pair.some((item) => item.id === row.id))) {
      if (!establishedShotId) {
        establishedShotId = shotId;
        action = 'establish';
      } else if (explicitCrossing || (side !== 'unknown' && activeSide !== 'unknown' && side !== activeSide)) {
        action = 'cross';
      } else {
        action = 'preserve';
      }

      if (action === 'cross') {
        const allowed = allowCrossings.has(shotId);
        if (!allowed && !reestablishes) {
          const message = 'Shot ' + shotId + ' crosses the established camera axis without a neutral/wide re-establishing view or an approved crossing.';
          warnings.push({
            code: 'AXIS_CROSS_REQUIRES_REESTABLISHMENT',
            severity: 'blocker',
            message
          });
          blockers.push(message);
        } else if (!reestablishes) {
          warnings.push({
            code: 'AXIS_CROSS_REQUIRES_REESTABLISHMENT',
            severity: 'warning',
            message: 'Shot ' + shotId + ' uses a human-approved axis crossing; preserve geography carefully and re-establish immediately afterward.'
          });
        }
        if (side === activeSide || side === 'unknown') {
          side = activeSide === 'A' ? 'B' : activeSide === 'B' ? 'A' : 'unknown';
        }
        if (side !== 'unknown') activeSide = side;
      } else if (side !== 'unknown') {
        activeSide = side;
      }
    }

    const positions: Record<string, 'left' | 'right' | 'center' | 'unknown'> = {};
    for (const character of mentioned) {
      const key = norm(character.name);
      let position = priorPositions[key] || 'unknown';
      const lower = norm(text);
      const escaped = norm(character.name).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
      if (escaped) {
        if (new RegExp('\\b' + escaped + '\\b.{0,60}\\bscreen left\\b').test(lower)) position = 'left';
        if (new RegExp('\\b' + escaped + '\\b.{0,60}\\bscreen right\\b').test(lower)) position = 'right';
      }

      const prior = priorPositions[key];
      if (
        prior &&
        prior !== 'unknown' &&
        position !== 'unknown' &&
        prior !== position &&
        !explicitCrossing &&
        !/move|cross|walk|step|turn|switch/i.test(text)
      ) {
        const message = character.name + ' flips from screen ' + prior + ' to screen ' + position + ' without an explicit blocking transition.';
        warnings.push({ code: 'SCREEN_SIDE_FLIP', severity: 'blocker', message });
        blockers.push(message);
      }

      positions[character.name] = position;
      if (position !== 'unknown') priorPositions[key] = position;
    }

    if (axisCritical && action !== 'not-applicable' && mentioned.length < 2) {
      warnings.push({
        code: 'SPATIAL_EVIDENCE_WEAK',
        severity: 'info',
        message: 'Only one axis subject is explicit in this shot text; preserve the established eyeline and screen direction from surrounding coverage.'
      });
    }

    plannedShots.push({
      shot_id: shotId,
      mentioned_characters: mentioned.map((row) => row.name),
      axis_side: side,
      axis_action: action,
      explicit_crossing: explicitCrossing,
      reestablishes_geography: reestablishes,
      screen_positions: positions,
      hard_constraints: axisCritical && action !== 'not-applicable'
        ? [
            'Keep the camera on the established side of the subject axis unless this shot is an approved crossing.',
            'Preserve established screen-left/screen-right placement and eyelines across the cut.',
            'Do not teleport performers, props, doors or furniture between coverage angles.',
            'If the camera crosses the axis, make the crossing visually legible or re-establish geography before reverse coverage.'
          ]
        : [
            'Preserve room topology, performer placement and prop geography established by continuity.'
          ],
      warnings
    });
  }

  const topology = roomTopology(input.continuityContract);
  const approvalStatus: SceneSpatialPlan['approval']['status'] = axisCritical
    ? input.existing?.approval?.status === 'approved' &&
      input.existing?.spatial_plan_hash
        ? 'approved'
        : 'pending'
    : 'not-required';

  if (axisCritical && !pairNames.length) {
    sceneWarnings.push('This scene appears relational, but PARABLE could not establish the axis subjects from grounded character evidence.');
  }

  const unsigned = {
    spatial_plan_version: 'parable-spatial-plan-v1' as const,
    project_id: input.projectId,
    story_version: input.storyVersion,
    scene_id: input.sceneId,
    axis_critical: axisCritical,
    room_topology: topology,
    axis: {
      axis_id: axisCritical ? 'axis_' + slug(pairNames.join('_')) : null,
      subject_a: pairNames[0] || null,
      subject_b: pairNames[1] || null,
      established_shot_id: establishedShotId,
      default_camera_side: defaultSide,
      must_preserve: axisCritical
    },
    shots: plannedShots,
    blockers: uniq(blockers),
    warnings: uniq(sceneWarnings),
    source: {
      shot_count: input.shots.length,
      continuity_relation_count: topology.edges.length,
      known_character_count: characters.length
    }
  };

  const hash = await stableHash(unsigned);
  const previousStillMatches = input.existing?.spatial_plan_hash === hash;

  return {
    ...unsigned,
    spatial_plan_hash: hash,
    approval: previousStillMatches
      ? input.existing!.approval
      : {
          status: axisCritical ? 'pending' : 'not-required',
          approved_by_actor_id: null,
          approved_at: null,
          reviewer_note: null,
          override_blockers: false
        },
    created_at: new Date().toISOString()
  };
}

export function spatialContractForShot(plan: SceneSpatialPlan | null | undefined, shotId: string) {
  if (!plan) return null;
  const shot = plan.shots.find((row) => row.shot_id === shotId) || null;
  if (!shot) return null;

  const blockers = shot.warnings
    .filter((warning) => warning.severity === 'blocker')
    .map((warning) => warning.message);

  return {
    spatial_plan_hash: plan.spatial_plan_hash,
    axis_critical: plan.axis_critical,
    approval_status: plan.approval.status,
    axis: plan.axis,
    shot,
    room_topology: plan.room_topology,
    blockers,
    can_render:
      blockers.length === 0 &&
      (!plan.axis_critical || plan.approval.status === 'approved')
  };
}
