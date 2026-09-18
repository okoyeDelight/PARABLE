import { recordAIHealth } from './ai-health-store.mts';
import type { BenchmarkFixture } from './benchmarks.mts';

const clean = (value: unknown, max = 1200) => String(value ?? '').trim().slice(0, max);
const clamp = (value: unknown) => Math.max(0, Math.min(1, Number(value) || 0));
const normalize = (value: string) => value.toLowerCase().replace(/[“”‘’]/g, '"').replace(/\s+/g, ' ').trim();

const str = (maxLength = 600) => ({ type: 'string', maxLength });
const obj = (properties: Record<string, any>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

const STORY_SCHEMA = obj({
  story_bible: obj({
    premise: str(520), logline: str(480), genre: str(100), tone: str(160),
    core_conflict: str(480), stakes: str(480), emotional_turn: str(480)
  }),
  characters: {
    type: 'array', minItems: 1, maxItems: 4,
    items: obj({ name: str(90), role: str(140), desire: str(280), fear: str(280), knowledge_state: str(320) })
  },
  themes: {
    type: 'array', minItems: 1, maxItems: 3,
    items: obj({ name: str(140), meaning: str(320) })
  },
  scenes: {
    type: 'array', minItems: 1, maxItems: 3,
    items: obj({ id: str(60), objective: str(320), obstacle: str(320), turn: str(360), emotional_state: str(240) })
  },
  review: obj({
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    uncertainties: { type: 'array', maxItems: 4, items: str(320) }
  })
});

const CRITIC_SCHEMA = obj({
  summary: str(620),
  readiness: { type: 'string', enum: ['hold', 'revise', 'ready-for-previsualization'] },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  priorities: {
    type: 'array', minItems: 1, maxItems: 4,
    items: obj({
      area: str(80), issue: str(380), why_it_matters: str(420), action: str(440),
      affected_shot_ids: { type: 'array', maxItems: 6, items: str(70) }
    })
  },
  continuity_risks: { type: 'array', maxItems: 4, items: str(320) },
  fidelity_risks: { type: 'array', maxItems: 4, items: str(320) },
  human_questions: { type: 'array', maxItems: 4, items: str(320) }
});

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function parseJson(raw: unknown) {
  let value = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('\n')
      : '';
  value = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first >= 0 && last > first) value = value.slice(first, last + 1);
  if (!value) throw new Error('empty JSON response');
  return JSON.parse(value) as Record<string, any>;
}

function sourceHas(source: string, value: string) {
  const needle = normalize(value);
  return needle.length > 0 && normalize(source).includes(needle);
}

function sanitizeStory(value: any, fixture: BenchmarkFixture) {
  const source = fixture.input.sourceText;
  const rawCharacters = Array.isArray(value?.characters) ? value.characters : [];
  const characters = rawCharacters.slice(0, 4).map((item: any) => ({
    name: clean(item?.name, 100), role: clean(item?.role, 160), desire: clean(item?.desire, 320),
    fear: clean(item?.fear, 320), knowledge_state: clean(item?.knowledge_state, 360)
  })).filter((item: any) => item.name && sourceHas(source, item.name));
  const themes = (Array.isArray(value?.themes) ? value.themes : []).slice(0, 3).map((item: any) => ({
    name: clean(item?.name, 160), meaning: clean(item?.meaning, 420)
  })).filter((item: any) => item.name);
  const scenes = (Array.isArray(value?.scenes) ? value.scenes : []).slice(0, 3).map((item: any, index: number) => ({
    id: clean(item?.id, 70) || `scene_${index + 1}`,
    objective: clean(item?.objective, 420), obstacle: clean(item?.obstacle, 420),
    turn: clean(item?.turn, 420), emotional_state: clean(item?.emotional_state, 300)
  })).filter((item: any) => item.objective || item.turn);
  const bible = value?.story_bible || {};
  const result = {
    story_bible: {
      premise: clean(bible?.premise, 600), logline: clean(bible?.logline, 520), genre: clean(bible?.genre, 120),
      tone: clean(bible?.tone, 180), core_conflict: clean(bible?.core_conflict, 520), stakes: clean(bible?.stakes, 520),
      emotional_turn: clean(bible?.emotional_turn, 520)
    },
    characters, themes, scenes,
    review: {
      confidence: clamp(value?.review?.confidence),
      uncertainties: (Array.isArray(value?.review?.uncertainties) ? value.review.uncertainties : []).slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean)
    }
  };
  if (!result.story_bible.premise || !result.story_bible.core_conflict) throw new Error('structured free-router output did not contain premise/core conflict');
  if (!characters.length) throw new Error('structured free-router output contained no source-grounded characters');
  if (!themes.length || !scenes.length) throw new Error('structured free-router output did not contain themes/scenes');
  return result;
}

function sanitizeCritic(value: any, adaptation: any) {
  const ids = new Set((adaptation?.shot_plan || []).map((s: any) => clean(s?.id, 80)).filter(Boolean));
  const priorities = (Array.isArray(value?.priorities) ? value.priorities : []).slice(0, 4).map((item: any) => ({
    area: clean(item?.area, 80) || 'story', issue: clean(item?.issue, 450), why_it_matters: clean(item?.why_it_matters, 520),
    action: clean(item?.action, 520),
    affected_shot_ids: (Array.isArray(item?.affected_shot_ids) ? item.affected_shot_ids : []).map((v: unknown) => clean(v, 80)).filter((id: string) => ids.has(id)).slice(0, 6)
  })).filter((item: any) => item.issue && item.action);
  const result = {
    summary: clean(value?.summary, 700),
    readiness: ['hold', 'revise', 'ready-for-previsualization'].includes(value?.readiness) ? value.readiness : 'revise',
    confidence: clamp(value?.confidence), priorities,
    continuity_risks: (Array.isArray(value?.continuity_risks) ? value.continuity_risks : []).slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean),
    fidelity_risks: (Array.isArray(value?.fidelity_risks) ? value.fidelity_risks : []).slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean),
    human_questions: (Array.isArray(value?.human_questions) ? value.human_questions : []).slice(0, 4).map((v: unknown) => clean(v, 420)).filter(Boolean)
  };
  if (!result.summary || !priorities.length) throw new Error('structured critic output was incomplete');
  return result;
}

async function openRouterFree(
  messages: Array<{ role: string; content: string }>,
  stage: 'story-understanding' | 'film-critic',
  schema: Record<string, any>,
  schemaName: string
) {
  const apiKey = Netlify.env.get('OPENROUTER_API_KEY') || '';
  if (!apiKey) throw new Error('OpenRouter credential is not configured on this Deploy Preview.');
  const errors: string[] = [];

  // The free router's concrete backing model changes over time. Do not pin a free
  // slug here. Instead require native structured-output support and let OpenRouter
  // choose among the currently healthy free endpoints on every attempt.
  // Keep every serverless benchmark invocation below the platform deadline.
  // Provider retries happen at the workflow level too, so two bounded model
  // attempts are safer than letting one Lambda sit idle until the edge returns
  // a 502/504 without a usable diagnostic.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const timeout = timeoutSignal(8500);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: timeout.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'HTTP-Referer': Netlify.env.get('PARABLE_PUBLIC_URL') || 'https://parable-studio.netlify.app',
          'X-OpenRouter-Title': 'PARABLE Synthetic Benchmark'
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          temperature: 0.1,
          max_tokens: stage === 'story-understanding' ? 1200 : 1000,
          messages,
          response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
          provider: { require_parameters: true, allow_fallbacks: true, sort: { by: 'throughput', partition: 'none' } }
        })
      });
      const body = await response.json().catch(() => ({})) as any;
      if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
      const parsed = parseJson(body?.choices?.[0]?.message?.content);
      const model = String(body?.model || 'openrouter/free');
      await recordAIHealth({ stage, lane: 'benchmark', provider: 'openrouter', model, ok: true, latency_ms: Date.now() - started });
      return { parsed, model, finish_reason: body?.choices?.[0]?.finish_reason || null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`attempt ${attempt}: ${reason}`);
      await recordAIHealth({ stage, lane: 'benchmark', provider: 'openrouter', model: 'openrouter/free', ok: false, latency_ms: Date.now() - started, error: reason });
    } finally {
      timeout.cancel();
    }
  }
  throw new Error(errors.join(' | ').slice(0, 1600));
}

export async function runFreeStoryBenchmark(fixture: BenchmarkFixture) {
  const system = `You are PARABLE Story Understanding. This is a synthetic CI fixture, not a private user manuscript. Understand the supplied story without rewriting it. Never invent character names, Scripture, motives or events. Preserve ambiguity. Return only the requested structured data. Only use names literally present in the manuscript.`;
  const user = JSON.stringify({ title: fixture.input.title, setting: fixture.input.setting, audience: fixture.input.primaryAudience, manuscript: fixture.input.sourceText });
  const response = await openRouterFree([{ role: 'system', content: system }, { role: 'user', content: user }], 'story-understanding', STORY_SCHEMA, 'parable_benchmark_story');
  return {
    data: sanitizeStory(response.parsed, fixture),
    engine: { provider: 'openrouter', model: response.model, mode: 'model', version: 'free-benchmark-router-v3', privacy_mode: 'benchmark-free-routing-synthetic-only', privacy_lane: 'benchmark', finish_reason: response.finish_reason }
  };
}

export async function runFreeCriticBenchmark(fixture: BenchmarkFixture, adaptation: any) {
  const system = `You are PARABLE Film Quality Critic. This is a synthetic CI fixture. Diagnose story-to-screen choices; do not praise by default and do not rewrite the story. Never invent facts, characters or Scripture. affected_shot_ids may only use IDs present in the supplied shot plan. Give 1-4 high-leverage priorities and return only the requested structured data.`;
  const payload = { title: fixture.input.title, manuscript: fixture.input.sourceText, shot_plan: adaptation?.shot_plan || [], screenplay: adaptation?.screenplay || null };
  const response = await openRouterFree([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }], 'film-critic', CRITIC_SCHEMA, 'parable_benchmark_critic');
  return {
    data: sanitizeCritic(response.parsed, adaptation),
    engine: { provider: 'openrouter', model: response.model, mode: 'model', version: 'free-benchmark-critic-v3', privacy_mode: 'benchmark-free-routing-synthetic-only', privacy_lane: 'benchmark', finish_reason: response.finish_reason }
  };
}
