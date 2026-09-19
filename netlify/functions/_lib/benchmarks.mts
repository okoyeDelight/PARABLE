import type { UnderstandInput } from './understand-ai.mts';

export type BenchmarkId = 'altar' | 'yes' | 'watchman';

export type BenchmarkFixture = {
  id: BenchmarkId;
  label: string;
  input: UnderstandInput;
};

export const BENCHMARK_FIXTURES: Record<BenchmarkId, BenchmarkFixture> = {
  altar: {
    id: 'altar',
    label: 'The Altar',
    input: {
      title: 'The Altar CI',
      sourceText: 'The room fell quiet.\n\nDaniel looked at the empty chair across from him. Outside, rain touched the windows like fingertips. He had prayed for an answer. He had not expected silence. His calling had never frightened him until tonight.',
      setting: 'Awka, Nigeria',
      primaryAudience: 'Global Christian young adults'
    }
  },
  yes: {
    id: 'yes',
    label: 'Before I Said Yes',
    input: {
      title: 'Before I Said Yes CI',
      sourceText: 'Ada held the ring in her palm but did not put it on. Chidi waited beside the old courtyard wall. She loved him, yet the mission letter in her bag asked for two years abroad. "I need one night to pray," Ada said. Chidi nodded, hurt but unwilling to rush her.',
      setting: 'Accra, Ghana',
      primaryAudience: 'Christian young adults'
    }
  },
  watchman: {
    id: 'watchman',
    label: 'The Watchman',
    input: {
      title: 'The Watchman CI',
      sourceText: 'Samuel crossed the university quadrangle after midnight and noticed the chapel door standing open. No service was scheduled. A phone vibrated on the front pew, displaying a message addressed to him: Do not wake the others. Samuel stopped. The generator behind the hostel suddenly went silent.',
      setting: 'University campus, Nigeria',
      primaryAudience: 'Christian students'
    }
  }
};

export function getBenchmarkFixture(value: unknown) {
  const id = String(value || '').toLowerCase() as BenchmarkId;
  return BENCHMARK_FIXTURES[id] || null;
}

function sourceBasis(evidence: string) {
  return { basis: 'explicit', evidence, confidence: 0.9 };
}

export function buildBenchmarkAdaptation(fixture: BenchmarkFixture) {
  const source = fixture.input.sourceText;
  const distinctPlans: Record<BenchmarkId, any[]> = {
    altar: [
      { id: 'shot_1', beat: 'The room falls quiet around Daniel.', shot_size: 'Wide', lens_mm: 35, motion: 'Locked', blocking: 'Daniel remains separated from the empty chair.', lighting: 'Rain-muted window light', performance: 'Stillness; do not indicate an answer.', purpose: 'Make absence and silence physical.', continuity_notes: 'Preserve chair position and rain direction.', source_basis: sourceBasis('The room fell quiet.') },
      { id: 'shot_2', beat: 'Daniel studies the empty chair.', shot_size: 'Medium close', lens_mm: 65, motion: 'Imperceptible push', blocking: 'Chair remains across his eyeline.', lighting: 'Soft side light from window', performance: 'Hold the thought before looking away.', purpose: 'Move from environmental silence into private fear.', continuity_notes: 'Maintain eyeline to the chair.', source_basis: sourceBasis('Daniel looked at the empty chair across from him.') },
      { id: 'shot_3', beat: 'The unanswered prayer lands.', shot_size: 'Close-up', lens_mm: 85, motion: 'Locked', blocking: 'No new movement.', lighting: 'Low-contrast face with window edge', performance: 'Restrain emotion; one delayed breath.', purpose: 'Let uncertainty remain unresolved.', continuity_notes: 'Match emotional intensity from shot 2.', source_basis: sourceBasis('He had prayed for an answer. He had not expected silence.') }
    ],
    yes: [
      { id: 'shot_1', beat: 'Ada holds the ring without wearing it.', shot_size: 'Insert to medium', lens_mm: 50, motion: 'Slow lateral drift', blocking: 'Ring stays visible between Ada and Chidi.', lighting: 'Warm courtyard daylight', performance: 'Ada does not close her fist around the ring.', purpose: 'Externalize commitment without deciding it for her.', continuity_notes: 'Track ring hand and courtyard axis.', source_basis: sourceBasis('Ada held the ring in her palm but did not put it on.') },
      { id: 'shot_2', beat: 'Chidi waits while the mission letter remains hidden.', shot_size: 'Two-shot', lens_mm: 40, motion: 'Locked', blocking: 'Keep physical distance between them.', lighting: 'Natural wall bounce', performance: 'Chidi waits; no pressure in his posture.', purpose: 'Hold love and calling in the same frame.', continuity_notes: 'Preserve bag position and distance.', source_basis: sourceBasis('Chidi waited beside the old courtyard wall.') },
      { id: 'shot_3', beat: 'Ada asks for one night to pray.', shot_size: 'Medium close', lens_mm: 75, motion: 'Gentle push', blocking: 'Ada keeps ring visible but lowered.', lighting: 'Softening late-day key', performance: 'Say the line as a boundary, not rejection.', purpose: 'Make the turn a request for time rather than melodrama.', continuity_notes: 'Match ring and bag positions.', source_basis: sourceBasis('"I need one night to pray," Ada said.') }
    ],
    watchman: [
      { id: 'shot_1', beat: 'Samuel crosses the quadrangle after midnight.', shot_size: 'Wide tracking', lens_mm: 28, motion: 'Measured follow', blocking: 'Samuel crosses open space toward chapel.', lighting: 'Sparse practical pools', performance: 'Alert but not yet afraid.', purpose: 'Establish vulnerable geography before the anomaly.', continuity_notes: 'Preserve travel direction toward chapel.', source_basis: sourceBasis('Samuel crossed the university quadrangle after midnight.') },
      { id: 'shot_2', beat: 'The chapel door is already open.', shot_size: 'Long-lens observation', lens_mm: 100, motion: 'Locked', blocking: 'Samuel stops outside frame edge before entering.', lighting: 'Dark doorway with thin interior practical', performance: 'Pause before approaching.', purpose: 'Turn an ordinary campus into a question.', continuity_notes: 'Keep chapel orientation consistent.', source_basis: sourceBasis('noticed the chapel door standing open.') },
      { id: 'shot_3', beat: 'The phone message addresses Samuel.', shot_size: 'Insert', lens_mm: 65, motion: 'Controlled handheld', blocking: 'Phone remains on front pew.', lighting: 'Phone glow only accents the text.', performance: 'Samuel reads without touching immediately.', purpose: 'Shift threat from environment to personal knowledge.', continuity_notes: 'Phone stays on same pew and screen direction.', source_basis: sourceBasis('Do not wake the others.') },
      { id: 'shot_4', beat: 'The generator dies.', shot_size: 'Close reaction', lens_mm: 85, motion: 'Locked', blocking: 'Samuel remains still as sound drops away.', lighting: 'Existing practicals fall darker after generator silence.', performance: 'React first through listening, not a large facial beat.', purpose: 'Use sound loss as the final escalation.', continuity_notes: 'Match Samuel position from phone insert.', source_basis: sourceBasis('The generator behind the hostel suddenly went silent.') }
    ]
  };

  const shots = distinctPlans[fixture.id];
  return {
    title: fixture.input.title,
    engine: { provider: 'benchmark-fixture', model: 'synthetic-package', mode: 'fixture', version: 'benchmark-v1' },
    production_bible: {
      story_bible: { premise: source.slice(0, 260), core_conflict: 'Synthetic benchmark package; critic must reason from the supplied manuscript.' },
      characters: [],
      scenes: []
    },
    screenplay: {
      heading: `BENCHMARK - ${fixture.input.setting}`,
      beats: [{ type: 'action', speaker: '', text: source, source_basis: sourceBasis(source.slice(0, 220)) }]
    },
    shot_plan: shots,
    continuity_ledger: shots.map((shot) => ({ entity: shot.id, fact: shot.continuity_notes, source_basis: shot.source_basis })),
    review: { confidence: 1, uncertainties: [], fidelity_warnings: [], human_review_flags: [] }
  };
}
