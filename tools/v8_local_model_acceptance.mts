import assert from 'node:assert/strict';
import {
  BENCHMARK_FIXTURES,
  buildBenchmarkAdaptation,
  type BenchmarkFixture
} from '../netlify/functions/_lib/benchmarks.mts';
import {
  assessCriticBenchmark,
  assessStoryBenchmark
} from '../netlify/functions/_lib/benchmark-quality.mts';

const MODEL = process.env.PARABLE_LOCAL_BENCHMARK_MODEL ||
  'qwen3:4b-instruct-2507-q4_K_M';
const BASE = String(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

const str = () => ({ type: 'string' });
const obj = (properties: Record<string, any>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});

const STORY_SCHEMA = obj({
  story_bible: obj({
    premise: str(),
    logline: str(),
    genre: str(),
    tone: str(),
    core_conflict: str(),
    stakes: str(),
    emotional_turn: str()
  }),
  characters: {
    type: 'array',
    minItems: 1,
    maxItems: 4,
    items: obj({
      name: str(),
      role: str(),
      desire: str(),
      fear: str(),
      knowledge_state: str()
    })
  },
  themes: {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    items: obj({ name: str(), meaning: str() })
  },
  scenes: {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    items: obj({
      id: str(),
      objective: str(),
      obstacle: str(),
      turn: str(),
      emotional_state: str()
    })
  },
  review: obj({
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    uncertainties: { type: 'array', maxItems: 4, items: str() }
  })
});

const CRITIC_SCHEMA = obj({
  summary: str(),
  readiness: {
    type: 'string',
    enum: ['hold', 'revise', 'ready-for-previsualization']
  },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  priorities: {
    type: 'array',
    minItems: 1,
    maxItems: 2,
    items: obj({
      area: str(),
      issue: str(),
      why_it_matters: str(),
      action: str(),
      affected_shot_ids: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: str()
      }
    })
  },
  continuity_risks: { type: 'array', maxItems: 1, items: str() },
  fidelity_risks: { type: 'array', maxItems: 1, items: str() },
  human_questions: { type: 'array', maxItems: 1, items: str() }
});

function clean(value: unknown, max = 900) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sourceHas(source: string, value: string) {
  const normalize = (input: string) => input
    .toLowerCase()
    .replace(/[“”‘’]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  const needle = normalize(value);
  return needle.length > 0 && normalize(source).includes(needle);
}

function sanitizeStory(value: any, fixture: BenchmarkFixture) {
  const source = fixture.input.sourceText;
  const characters = (Array.isArray(value?.characters) ? value.characters : [])
    .slice(0, 4)
    .map((item: any) => ({
      name: clean(item?.name, 100),
      role: clean(item?.role, 160),
      desire: clean(item?.desire, 320),
      fear: clean(item?.fear, 320),
      knowledge_state: clean(item?.knowledge_state, 360)
    }))
    .filter((item: any) => item.name && sourceHas(source, item.name));

  const themes = (Array.isArray(value?.themes) ? value.themes : [])
    .slice(0, 3)
    .map((item: any) => ({
      name: clean(item?.name, 160),
      meaning: clean(item?.meaning, 420)
    }))
    .filter((item: any) => item.name);

  const scenes = (Array.isArray(value?.scenes) ? value.scenes : [])
    .slice(0, 3)
    .map((item: any, index: number) => ({
      id: clean(item?.id, 70) || 'scene_' + (index + 1),
      objective: clean(item?.objective, 420),
      obstacle: clean(item?.obstacle, 420),
      turn: clean(item?.turn, 420),
      emotional_state: clean(item?.emotional_state, 300)
    }))
    .filter((item: any) => item.objective || item.turn);

  const bible = value?.story_bible || {};
  return {
    story_bible: {
      premise: clean(bible?.premise, 600),
      logline: clean(bible?.logline, 520),
      genre: clean(bible?.genre, 120),
      tone: clean(bible?.tone, 180),
      core_conflict: clean(bible?.core_conflict, 520),
      stakes: clean(bible?.stakes, 520),
      emotional_turn: clean(bible?.emotional_turn, 520)
    },
    characters,
    themes,
    scenes,
    review: {
      confidence: Math.max(0, Math.min(1, Number(value?.review?.confidence) || 0)),
      uncertainties: (Array.isArray(value?.review?.uncertainties) ? value.review.uncertainties : [])
        .slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean)
    }
  };
}

function sanitizeCritic(value: any, adaptation: any) {
  const validIds = new Set(
    (adaptation?.shot_plan || []).map((shot: any) => clean(shot?.id, 80)).filter(Boolean)
  );
  const priorities = (Array.isArray(value?.priorities) ? value.priorities : [])
    .slice(0, 4)
    .map((item: any) => ({
      area: clean(item?.area, 80) || 'story',
      issue: clean(item?.issue, 450),
      why_it_matters: clean(item?.why_it_matters, 520),
      action: clean(item?.action, 520),
      affected_shot_ids: (Array.isArray(item?.affected_shot_ids) ? item.affected_shot_ids : [])
        .map((v: unknown) => clean(v, 80))
        .filter((id: string) => validIds.has(id))
        .slice(0, 6)
    }))
    .filter((item: any) => item.issue && item.action);

  return {
    summary: clean(value?.summary, 700),
    readiness: ['hold', 'revise', 'ready-for-previsualization'].includes(value?.readiness)
      ? value.readiness : 'revise',
    confidence: Math.max(0, Math.min(1, Number(value?.confidence) || 0)),
    priorities,
    continuity_risks: (Array.isArray(value?.continuity_risks) ? value.continuity_risks : [])
      .slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean),
    fidelity_risks: (Array.isArray(value?.fidelity_risks) ? value.fidelity_risks : [])
      .slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean),
    human_questions: (Array.isArray(value?.human_questions) ? value.human_questions : [])
      .slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean)
  };
}

async function chat(args: {
  system: string;
  user: string;
  schema: Record<string, any>;
  maxTokens: number;
}) {
  const started = Date.now();
  const response = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(240000),
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      keep_alive: '30m',
      format: args.schema,
      options: {
        temperature: 0,
        num_predict: args.maxTokens,
        num_ctx: 8192
      },
      messages: [
        { role: 'system', content: args.system },
        {
          role: 'user',
          content: args.user + '\n\nReturn ONLY the JSON object required by the response schema.'
        }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new Error('Ollama ' + response.status + ': ' + JSON.stringify(body).slice(0, 900));
  }
  const raw = String(body?.message?.content || '').trim();
  if (!raw) throw new Error('Ollama returned an empty model response.');
  let parsed: Record<string, any>;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    throw new Error('Local model returned invalid JSON: ' + raw.slice(0, 900));
  }
  return {
    parsed,
    latency_ms: Date.now() - started,
    eval_count: Number(body?.eval_count || 0),
    prompt_eval_count: Number(body?.prompt_eval_count || 0)
  };
}

const storySystem = [
  'You are PARABLE Story Understanding.',
  'Understand the supplied story without rewriting it.',
  'Never invent character names, Scripture, motives, answers, outcomes or events.',
  'Preserve ambiguity.',
  'Only use character names literally present in the manuscript.',
  'Make the core conflict concrete and specific to the actual story details.',
  'Scene objectives, obstacles and turns must come only from the manuscript.'
].join(' ');

const criticSystem = [
  'You are PARABLE Film Quality Critic.',
  'Diagnose story-to-screen choices; do not praise by default and do not rewrite the story.',
  'Never invent facts, characters, Scripture or events.',
  'Every priority must cite at least one affected_shot_id from the supplied shot plan.',
  'Make priorities fixture-specific by naming the concrete objects, actions or emotional beats they concern.',
  'Be concise: use 1-2 priorities only; keep each issue, why_it_matters and action to one short sentence.',
  'Use at most one short continuity risk, one short fidelity risk and one short human question.',
  'Do not narrate the whole scene. Give only high-leverage, actionable production notes.'
].join(' ');

const report: any = {
  acceptance_version: 'parable-v8-zero-key-real-model-v1',
  model: MODEL,
  runtime: 'ollama-local-ci',
  real_model_inference: true,
  provider_quota_dependency: false,
  stories: [],
  critics: []
};

for (const fixture of Object.values(BENCHMARK_FIXTURES)) {
  console.log('\n[PARABLE V8] Story fixture:', fixture.id);
  const response = await chat({
    system: storySystem,
    user: JSON.stringify({
      title: fixture.input.title,
      setting: fixture.input.setting,
      audience: fixture.input.primaryAudience,
      manuscript: fixture.input.sourceText
    }),
    schema: STORY_SCHEMA,
    maxTokens: 760
  });
  const story = sanitizeStory(response.parsed, fixture);
  const gate = assessStoryBenchmark(fixture, story);
  console.log(JSON.stringify({
    fixture: fixture.id,
    provider: 'ollama-local-ci',
    model: MODEL,
    latency_ms: response.latency_ms,
    quality_score: gate.score,
    quality_passed: gate.passed,
    blockers: gate.blockers
  }));
  assert.equal(
    gate.passed,
    true,
    fixture.id + ' Story Understanding failed quality gate: ' + JSON.stringify(gate)
  );
  report.stories.push({
    fixture: fixture.id,
    score: gate.score,
    passed: gate.passed,
    latency_ms: response.latency_ms
  });
}

for (const fixture of Object.values(BENCHMARK_FIXTURES)) {
  console.log('\n[PARABLE V8] Film Critic fixture:', fixture.id);
  const adaptation = buildBenchmarkAdaptation(fixture);
  const response = await chat({
    system: criticSystem,
    user: JSON.stringify({
      title: fixture.input.title,
      manuscript: fixture.input.sourceText,
      shot_plan: adaptation.shot_plan,
      screenplay: adaptation.screenplay
    }),
    schema: CRITIC_SCHEMA,
    maxTokens: 1000
  });
  const critic = sanitizeCritic(response.parsed, adaptation);
  const gate = assessCriticBenchmark(fixture, adaptation, critic);
  console.log(JSON.stringify({
    fixture: fixture.id,
    provider: 'ollama-local-ci',
    model: MODEL,
    latency_ms: response.latency_ms,
    quality_score: gate.score,
    quality_passed: gate.passed,
    blockers: gate.blockers
  }));
  assert.equal(
    gate.passed,
    true,
    fixture.id + ' Film Critic failed quality gate: ' + JSON.stringify(gate)
  );
  report.critics.push({
    fixture: fixture.id,
    score: gate.score,
    passed: gate.passed,
    latency_ms: response.latency_ms
  });
}

assert.equal(report.stories.length, 3);
assert.equal(report.critics.length, 3);
assert.ok(report.stories.every((row: any) => row.passed));
assert.ok(report.critics.every((row: any) => row.passed));

console.log('\nPARABLE_V8_ZERO_KEY_ACCEPTANCE_PASS');
console.log(JSON.stringify(report, null, 2));
