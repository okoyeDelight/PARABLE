import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import {
  BENCHMARK_FIXTURES,
  buildBenchmarkAdaptation,
  type BenchmarkFixture
} from '../netlify/functions/_lib/benchmarks.mts';
import {
  assessStoryBenchmark,
  assessCriticBenchmark
} from '../netlify/functions/_lib/benchmark-quality.mts';

const model = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
const base = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';

const clean = (value: unknown, max = 1200) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const norm = (value: string) =>
  value.toLowerCase().replace(/[“”‘’]/g, '"').replace(/\s+/g, ' ').trim();

function sourceHas(source: string, value: string) {
  const needle = norm(value);
  return Boolean(needle) && norm(source).includes(needle);
}

function parseJson(raw: unknown) {
  let text = String(raw ?? '').trim()
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/i, '')
    .trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  if (!text) throw new Error('local model returned empty JSON');
  return JSON.parse(text);
}

async function chat(system: string, user: string, maxTokens: number) {
  const response = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: 'json',
      keep_alive: '20m',
      options: {
        temperature: 0.05,
        num_predict: maxTokens,
        seed: 42
      },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user + '\n/no_think' }
      ]
    }),
    signal: AbortSignal.timeout(180000)
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(body?.error || 'Ollama HTTP ' + response.status);
  return parseJson(body?.message?.content);
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

  return {
    story_bible: {
      premise: clean(value?.story_bible?.premise, 600),
      logline: clean(value?.story_bible?.logline, 520),
      genre: clean(value?.story_bible?.genre, 120),
      tone: clean(value?.story_bible?.tone, 180),
      core_conflict: clean(value?.story_bible?.core_conflict, 520),
      stakes: clean(value?.story_bible?.stakes, 520),
      emotional_turn: clean(value?.story_bible?.emotional_turn, 520)
    },
    characters,
    themes: (Array.isArray(value?.themes) ? value.themes : []).slice(0, 3).map((item: any) => ({
      name: clean(item?.name, 160),
      meaning: clean(item?.meaning, 420)
    })).filter((item: any) => item.name),
    scenes: (Array.isArray(value?.scenes) ? value.scenes : []).slice(0, 3).map((item: any, index: number) => ({
      id: clean(item?.id, 70) || 'scene_' + (index + 1),
      objective: clean(item?.objective, 420),
      obstacle: clean(item?.obstacle, 420),
      turn: clean(item?.turn, 420),
      emotional_state: clean(item?.emotional_state, 300)
    })).filter((item: any) => item.objective || item.turn),
    review: {
      confidence: Math.max(0, Math.min(1, Number(value?.review?.confidence) || 0)),
      uncertainties: (Array.isArray(value?.review?.uncertainties) ? value.review.uncertainties : [])
        .slice(0, 4).map((item: unknown) => clean(item, 420)).filter(Boolean)
    }
  };
}

function sanitizeCritic(value: any, adaptation: any) {
  const validIds = new Set(
    (Array.isArray(adaptation?.shot_plan) ? adaptation.shot_plan : [])
      .map((shot: any) => clean(shot?.id, 80))
      .filter(Boolean)
  );
  return {
    summary: clean(value?.summary, 700),
    readiness: ['hold','revise','ready-for-previsualization'].includes(value?.readiness)
      ? value.readiness
      : 'revise',
    confidence: Math.max(0, Math.min(1, Number(value?.confidence) || 0)),
    priorities: (Array.isArray(value?.priorities) ? value.priorities : [])
      .slice(0, 4)
      .map((item: any) => ({
        area: clean(item?.area, 80) || 'story',
        issue: clean(item?.issue, 450),
        why_it_matters: clean(item?.why_it_matters, 520),
        action: clean(item?.action, 520),
        affected_shot_ids: (Array.isArray(item?.affected_shot_ids) ? item.affected_shot_ids : [])
          .map((id: unknown) => clean(id, 80))
          .filter((id: string) => validIds.has(id))
          .slice(0, 6)
      }))
      .filter((item: any) => item.issue && item.action),
    continuity_risks: (Array.isArray(value?.continuity_risks) ? value.continuity_risks : [])
      .slice(0, 4).map((item: unknown) => clean(item, 420)).filter(Boolean),
    fidelity_risks: (Array.isArray(value?.fidelity_risks) ? value.fidelity_risks : [])
      .slice(0, 4).map((item: unknown) => clean(item, 420)).filter(Boolean),
    human_questions: (Array.isArray(value?.human_questions) ? value.human_questions : [])
      .slice(0, 4).map((item: unknown) => clean(item, 420)).filter(Boolean)
  };
}

const storySystem = [
  'You are PARABLE Story Understanding running inside a CI acceptance test.',
  'Understand the supplied story without rewriting it.',
  'Never invent character names, Scripture, motives, answers, or events.',
  'Preserve unresolved ambiguity.',
  'Return JSON only.',
  'Required shape:',
  '{"story_bible":{"premise":"","logline":"","genre":"","tone":"","core_conflict":"","stakes":"","emotional_turn":""},"characters":[{"name":"","role":"","desire":"","fear":"","knowledge_state":""}],"themes":[{"name":"","meaning":""}],"scenes":[{"id":"scene_1","objective":"","obstacle":"","turn":"","emotional_state":""}],"review":{"confidence":0.0,"uncertainties":[]}}'
].join(' ');

const criticSystem = [
  'You are PARABLE Film Quality Critic running inside a CI acceptance test.',
  'Diagnose story-to-screen choices. Do not praise by default and do not rewrite the story.',
  'Never invent facts, characters, Scripture, or off-screen events.',
  'Every affected_shot_ids value must come from the supplied shot plan.',
  'At least one priority must cite a supplied shot id.',
  'Make the diagnosis specific to concrete source details, with issue, why_it_matters, and action.',
  'Return JSON only.',
  'Required shape:',
  '{"summary":"","readiness":"hold|revise|ready-for-previsualization","confidence":0.0,"priorities":[{"area":"","issue":"","why_it_matters":"","action":"","affected_shot_ids":["shot_1"]}],"continuity_risks":[],"fidelity_risks":[],"human_questions":[]}'
].join(' ');

const ids = ['altar','yes','watchman'] as const;
const storyOutputs: Record<string, any> = {};
const storyGates: Record<string, any> = {};
const criticGates: Record<string, any> = {};

for (const id of ids) {
  const fixture = BENCHMARK_FIXTURES[id];
  const raw = await chat(
    storySystem,
    JSON.stringify({
      title: fixture.input.title,
      setting: fixture.input.setting,
      audience: fixture.input.primaryAudience,
      manuscript: fixture.input.sourceText
    }),
    650
  );
  const story = sanitizeStory(raw, fixture);
  const gate = assessStoryBenchmark(fixture, story);
  storyOutputs[id] = story;
  storyGates[id] = gate;
  console.log(id + '/story', JSON.stringify({
    model,
    score: gate.score,
    passed: gate.passed,
    blockers: gate.blockers,
    premise: story.story_bible.premise,
    core_conflict: story.story_bible.core_conflict
  }));
  assert.equal(gate.passed, true, id + ' Story Understanding quality gate failed: ' + JSON.stringify(gate));
}

const conflicts = new Set(
  ids.map((id) => norm(storyOutputs[id]?.story_bible?.core_conflict || ''))
);
assert.ok(conflicts.size >= 2, 'local real model collapsed three fixtures into the same core conflict');

for (const id of ids) {
  const fixture = BENCHMARK_FIXTURES[id];
  const adaptation = buildBenchmarkAdaptation(fixture);
  const raw = await chat(
    criticSystem,
    JSON.stringify({
      title: fixture.input.title,
      manuscript: fixture.input.sourceText,
      shot_plan: adaptation.shot_plan,
      screenplay: adaptation.screenplay
    }),
    600
  );
  const critic = sanitizeCritic(raw, adaptation);
  const gate = assessCriticBenchmark(fixture, adaptation, critic);
  criticGates[id] = gate;
  console.log(id + '/critic', JSON.stringify({
    model,
    score: gate.score,
    passed: gate.passed,
    blockers: gate.blockers,
    readiness: critic.readiness,
    summary: critic.summary
  }));
  assert.equal(gate.passed, true, id + ' Film Critic quality gate failed: ' + JSON.stringify(gate));
}

const summary = [
  '## PARABLE AI V8 local real-model acceptance PASSED ✅',
  '',
  '- Model: \`' + model + '\`',
  '- Inference: Ollama on the GitHub-hosted runner; no deterministic fixture answers',
  '- Story Understanding: 3/3 fixture-specific gates passed',
  '- Film Critic: 3/3 fixture-specific gates passed',
  '- Exact Netlify deploy was verified before this fallback lane ran',
  '- This lane exists specifically so OpenRouter quota or a broken remote credential cannot falsely block or falsely pass V8 quality.',
  '',
  'Story scores: ' + ids.map((id) => id + '=' + storyGates[id].score).join(', '),
  'Critic scores: ' + ids.map((id) => id + '=' + criticGates[id].score).join(', ')
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}
console.log(summary);
