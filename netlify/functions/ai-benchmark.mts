import { benchmarkLaneEnabled, runStoryUnderstanding } from './_lib/understand-ai.mts';
import { buildBenchmarkAdaptation, getBenchmarkFixture } from './_lib/benchmarks.mts';
import { compactCriticPayload, runFilmCritic } from './_lib/critic-ai.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!benchmarkLaneEnabled()) return json({ error: 'Benchmark lane is not available in this environment.' }, 404);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const fixture = getBenchmarkFixture(body.fixture);
  const stage = String(body.stage || 'story').toLowerCase();
  if (!fixture) return json({ error: 'Unknown benchmark fixture. Use altar, yes, or watchman.' }, 400);
  if (!['story', 'critic'].includes(stage)) return json({ error: 'Benchmark stage must be story or critic.' }, 400);

  if (stage === 'story') {
    const result = await runStoryUnderstanding(fixture.input, { lane: 'benchmark' });
    return json({
      benchmark: { fixture: fixture.id, label: fixture.label, stage: 'story-understanding', synthetic_only: true },
      passed: result.engine.mode === 'model' && Boolean(result.data),
      engine: result.engine,
      result: result.data
    });
  }

  const adaptation = buildBenchmarkAdaptation(fixture);
  const project = {
    title: fixture.input.title,
    source_text: fixture.input.sourceText,
    setting: fixture.input.setting,
    primary_audience: fixture.input.primaryAudience
  };
  const payload = compactCriticPayload(project, adaptation);
  const result = await runFilmCritic(payload, adaptation, { lane: 'benchmark' });
  return json({
    benchmark: { fixture: fixture.id, label: fixture.label, stage: 'film-critic', synthetic_only: true },
    passed: result.engine.mode === 'model' && Boolean(result.data),
    engine: result.engine,
    result: result.data
  });
};

export const config = {
  path: '/api/ai-benchmark',
  rateLimit: { windowLimit: 24, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
