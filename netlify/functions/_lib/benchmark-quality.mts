import type { BenchmarkFixture, BenchmarkId } from './benchmarks.mts';

export type BenchmarkQualityGate = {
  version: 'parable-benchmark-quality-v1';
  stage: 'story' | 'critic';
  fixture: BenchmarkId;
  passed: boolean;
  score: number;
  checks: Array<{
    id: string;
    passed: boolean;
    weight: number;
    detail: string;
  }>;
  blockers: string[];
};

const norm = (value: unknown) => String(value ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9\s-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const allText = (value: unknown) => {
  const out: string[] = [];
  const visit = (node: any) => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(value);
  return norm(out.join(' '));
};

const SPECS: Record<BenchmarkId, {
  requiredNames: string[];
  anchorGroups: string[][];
  forbiddenClaims: string[];
}> = {
  altar: {
    requiredNames: ['Daniel'],
    anchorGroups: [
      ['empty chair', 'chair'],
      ['silence', 'quiet', 'unanswered', 'answer'],
      ['prayer', 'prayed'],
      ['calling', 'frightened', 'fear']
    ],
    forbiddenClaims: [
      'god answered him',
      'the answer was yes',
      'the answer was no',
      'someone sat in the chair'
    ]
  },
  yes: {
    requiredNames: ['Ada', 'Chidi'],
    anchorGroups: [
      ['ring', 'engagement', 'marriage'],
      ['mission', 'abroad', 'two years'],
      ['pray', 'prayer', 'one night'],
      ['wait', 'time', 'decision', 'choice']
    ],
    forbiddenClaims: [
      'ada accepted the proposal',
      'ada rejected the proposal',
      'ada put on the ring',
      'chidi left her'
    ]
  },
  watchman: {
    requiredNames: ['Samuel'],
    anchorGroups: [
      ['chapel', 'open door', 'door'],
      ['phone', 'message', 'front pew', 'pew'],
      ['do not wake the others', 'wake the others'],
      ['generator', 'went silent', 'silence']
    ],
    forbiddenClaims: [
      'a demon',
      'the killer',
      'the attacker',
      'samuel entered the chapel',
      'samuel picked up the phone'
    ]
  }
};

function groupHit(text: string, group: string[]) {
  return group.some((term) => text.includes(norm(term)));
}

function score(checks: BenchmarkQualityGate['checks']) {
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  return total > 0 ? Math.round((earned / total) * 1000) / 1000 : 0;
}

export function assessStoryBenchmark(
  fixture: BenchmarkFixture,
  result: Record<string, any>
): BenchmarkQualityGate {
  const spec = SPECS[fixture.id];
  const text = allText(result);
  const names = (Array.isArray(result?.characters) ? result.characters : [])
    .map((row: any) => norm(row?.name))
    .filter(Boolean);

  const requiredNames = spec.requiredNames.map(norm);
  const missingNames = requiredNames.filter((name) => !names.includes(name));
  const anchorHits = spec.anchorGroups.filter((group) => groupHit(text, group)).length;
  const forbiddenHits = spec.forbiddenClaims.filter((claim) => text.includes(norm(claim)));
  const scenes = Array.isArray(result?.scenes) ? result.scenes : [];
  const themes = Array.isArray(result?.themes) ? result.themes : [];
  const bible = result?.story_bible || {};
  const core = norm(bible?.core_conflict);
  const premise = norm(bible?.premise);
  const coreAnchorHits = spec.anchorGroups.filter((group) => groupHit(core + ' ' + premise, group)).length;

  const checks: BenchmarkQualityGate['checks'] = [
    {
      id: 'required-characters-grounded',
      passed: missingNames.length === 0,
      weight: 3,
      detail: missingNames.length ? 'Missing source characters: ' + missingNames.join(', ') : 'All required source characters are grounded.'
    },
    {
      id: 'story-anchor-coverage',
      passed: anchorHits >= Math.min(3, spec.anchorGroups.length),
      weight: 3,
      detail: `${anchorHits}/${spec.anchorGroups.length} fixture-specific source anchors are represented.`
    },
    {
      id: 'core-conflict-specificity',
      passed: Boolean(core) && coreAnchorHits >= 2,
      weight: 2,
      detail: `${coreAnchorHits} fixture anchors are present in the premise/core conflict.`
    },
    {
      id: 'scene-understanding-present',
      passed: scenes.length > 0 && scenes.some((scene: any) =>
        norm(scene?.objective).length >= 8 &&
        (norm(scene?.obstacle).length >= 8 || norm(scene?.turn).length >= 8)
      ),
      weight: 2,
      detail: scenes.length ? 'At least one scene contains objective plus obstacle/turn reasoning.' : 'No usable scene reasoning.'
    },
    {
      id: 'theme-understanding-present',
      passed: themes.length > 0 && themes.some((theme: any) => norm(theme?.meaning).length >= 12),
      weight: 1,
      detail: themes.length ? 'Theme interpretation is present.' : 'No theme interpretation.'
    },
    {
      id: 'ambiguity-preserved',
      passed: forbiddenHits.length === 0,
      weight: 3,
      detail: forbiddenHits.length ? 'Invented/resolved claims detected: ' + forbiddenHits.join('; ') : 'No fixture-specific invented resolution detected.'
    }
  ];

  const finalScore = score(checks);
  const critical = checks.filter((check) =>
    ['required-characters-grounded','story-anchor-coverage','ambiguity-preserved'].includes(check.id)
  );
  const blockers = checks.filter((check) => !check.passed).map((check) => check.id);

  return {
    version: 'parable-benchmark-quality-v1',
    stage: 'story',
    fixture: fixture.id,
    passed: critical.every((check) => check.passed) && finalScore >= 0.82,
    score: finalScore,
    checks,
    blockers
  };
}

export function assessCriticBenchmark(
  fixture: BenchmarkFixture,
  adaptation: Record<string, any>,
  result: Record<string, any>
): BenchmarkQualityGate {
  const spec = SPECS[fixture.id];
  const priorities = Array.isArray(result?.priorities) ? result.priorities : [];
  const validIds = new Set(
    (Array.isArray(adaptation?.shot_plan) ? adaptation.shot_plan : [])
      .map((shot: any) => String(shot?.id || '').trim())
      .filter(Boolean)
  );
  const text = allText(result);
  const anchorHits = spec.anchorGroups.filter((group) => groupHit(text, group)).length;
  const cited = priorities.flatMap((priority: any) =>
    Array.isArray(priority?.affected_shot_ids) ? priority.affected_shot_ids : []
  );
  const invalidIds = cited.filter((id: string) => !validIds.has(id));
  const actionable = priorities.filter((priority: any) =>
    norm(priority?.issue).length >= 12 &&
    norm(priority?.why_it_matters).length >= 12 &&
    norm(priority?.action).length >= 12
  );

  const checks: BenchmarkQualityGate['checks'] = [
    {
      id: 'critic-summary-present',
      passed: norm(result?.summary).length >= 24,
      weight: 2,
      detail: 'Critic summary must contain a substantive diagnosis.'
    },
    {
      id: 'critic-priorities-actionable',
      passed: actionable.length >= 1,
      weight: 3,
      detail: `${actionable.length}/${priorities.length} priorities contain issue, consequence and action.`
    },
    {
      id: 'critic-shot-grounding',
      passed: cited.length >= 1 && invalidIds.length === 0,
      weight: 3,
      detail: cited.length
        ? (invalidIds.length ? 'Invalid shot ids: ' + invalidIds.join(', ') : 'Critic references only supplied shot ids.')
        : 'Critic did not bind any priority to a supplied shot.'
    },
    {
      id: 'critic-fixture-specificity',
      passed: anchorHits >= 2,
      weight: 3,
      detail: `${anchorHits}/${spec.anchorGroups.length} fixture-specific anchors appear in the diagnosis.`
    },
    {
      id: 'critic-readiness-valid',
      passed: ['hold','revise','ready-for-previsualization'].includes(String(result?.readiness || '')),
      weight: 1,
      detail: 'Critic readiness uses the production contract.'
    }
  ];

  const finalScore = score(checks);
  const critical = checks.filter((check) =>
    ['critic-priorities-actionable','critic-shot-grounding','critic-fixture-specificity'].includes(check.id)
  );
  const blockers = checks.filter((check) => !check.passed).map((check) => check.id);

  return {
    version: 'parable-benchmark-quality-v1',
    stage: 'critic',
    fixture: fixture.id,
    passed: critical.every((check) => check.passed) && finalScore >= 0.82,
    score: finalScore,
    checks,
    blockers
  };
}
