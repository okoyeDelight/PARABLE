import assert from 'node:assert/strict';
import { BENCHMARK_FIXTURES, buildBenchmarkAdaptation } from '../netlify/functions/_lib/benchmarks.mts';
import { assessCriticBenchmark, assessStoryBenchmark } from '../netlify/functions/_lib/benchmark-quality.mts';

const goodStories:any = {
  altar: {
    story_bible:{premise:'Daniel faces an empty chair and the silence after prayer as fear around his calling grows.',core_conflict:'Daniel must sit with unanswered prayer, silence and fear around his calling.',logline:'',genre:'drama',tone:'restrained',stakes:'calling',emotional_turn:'silence'},
    characters:[{name:'Daniel',role:'lead',desire:'an answer',fear:'his calling',knowledge_state:'He only knows there is silence.'}],
    themes:[{name:'Faith in silence',meaning:'Waiting without inventing an answer.'}],
    scenes:[{id:'scene_1',objective:'Daniel seeks an answer.',obstacle:'The room remains silent.',turn:'The silence makes his calling frightening.',emotional_state:'uncertain'}],
    review:{confidence:.9,uncertainties:['The answer is unknown.']}
  },
  yes: {
    story_bible:{premise:'Ada weighs the ring and Chidi against a two-year mission abroad and asks for one night to pray.',core_conflict:'Ada must choose how to hold love, the ring and the mission without rushing the decision.',logline:'',genre:'drama',tone:'tender',stakes:'relationship and mission',emotional_turn:'she asks for time'},
    characters:[{name:'Ada',role:'lead',desire:'discernment',fear:'a rushed choice',knowledge_state:'She has the mission letter.'},{name:'Chidi',role:'partner',desire:'her yes',fear:'losing her',knowledge_state:'He waits.'}],
    themes:[{name:'Discernment',meaning:'Prayer and time before a life-changing decision.'}],
    scenes:[{id:'scene_1',objective:'Ada seeks time to pray.',obstacle:'The ring and mission compete for her future.',turn:'Chidi agrees to wait.',emotional_state:'tender uncertainty'}],
    review:{confidence:.9,uncertainties:['Her final decision is unknown.']}
  },
  watchman: {
    story_bible:{premise:'Samuel finds an open chapel, a phone message on the front pew and a generator that suddenly goes silent.',core_conflict:'Samuel must interpret a personal warning amid the chapel, phone and sudden generator silence without knowing who sent it.',logline:'',genre:'mystery',tone:'tense',stakes:'unknown danger',emotional_turn:'the generator stops'},
    characters:[{name:'Samuel',role:'lead',desire:'understand the message',fear:'the unknown',knowledge_state:'He only knows the message is addressed to him.'}],
    themes:[{name:'Watchfulness',meaning:'Attention under uncertainty without inventing the source.'}],
    scenes:[{id:'scene_1',objective:'Samuel understands the open chapel and message.',obstacle:'The phone warning gives no source.',turn:'The generator goes silent.',emotional_state:'alert'}],
    review:{confidence:.9,uncertainties:['The sender is unknown.']}
  }
};

for (const [id, story] of Object.entries(goodStories)) {
  const fixture=(BENCHMARK_FIXTURES as any)[id];
  const gate=assessStoryBenchmark(fixture, story as any);
  assert.equal(gate.passed,true, id + ' known-good story should pass: ' + JSON.stringify(gate));
}

const hallucinated={...goodStories.watchman,story_bible:{...goodStories.watchman.story_bible,core_conflict:'A demon is stalking Samuel near the chapel.'}};
const hallucinatedGate=assessStoryBenchmark(BENCHMARK_FIXTURES.watchman,hallucinated);
assert.equal(hallucinatedGate.passed,false);
assert.ok(hallucinatedGate.blockers.includes('ambiguity-preserved'));

for (const id of ['altar','yes','watchman'] as const) {
  const fixture=BENCHMARK_FIXTURES[id];
  const adaptation=buildBenchmarkAdaptation(fixture);
  const first=adaptation.shot_plan[0];
  const anchor=id==='altar'
    ? 'empty chair, prayer and silence'
    : id==='yes'
      ? 'ring, mission abroad and prayer'
      : 'chapel, phone message and generator silence';
  const critic={
    summary:'The production choices around '+anchor+' need tighter visual emphasis and continuity.',
    readiness:'revise',
    confidence:.9,
    priorities:[{
      area:'fidelity',
      issue:'The shot may underplay '+anchor+'.',
      why_it_matters:'Those details carry the specific dramatic turn in this fixture.',
      action:'Make the source-grounded object and emotional beat legible without adding new events.',
      affected_shot_ids:[first.id]
    }],
    continuity_risks:[],fidelity_risks:[],human_questions:[]
  };
  const gate=assessCriticBenchmark(fixture,adaptation,critic);
  assert.equal(gate.passed,true,id+' known-good critic should pass: '+JSON.stringify(gate));
}

const adaptation=buildBenchmarkAdaptation(BENCHMARK_FIXTURES.altar);
const genericCritic={
  summary:'The scene could be better.',
  readiness:'revise',
  confidence:.5,
  priorities:[{area:'story',issue:'Improve it',why_it_matters:'Quality',action:'Make it better',affected_shot_ids:[]}],
  continuity_risks:[],fidelity_risks:[],human_questions:[]
};
const genericGate=assessCriticBenchmark(BENCHMARK_FIXTURES.altar,adaptation,genericCritic);
assert.equal(genericGate.passed,false);

console.log(JSON.stringify({
  ok:true,
  quality_gate:'parable-benchmark-quality-v1',
  story_fixture_count:3,
  critic_fixture_count:3,
  hallucination_rejection:true,
  generic_critic_rejection:true
},null,2));
