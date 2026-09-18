import { benchmarkLaneEnabled } from './_lib/understand-ai.mts';
import { buildBenchmarkAdaptation, getBenchmarkFixture } from './_lib/benchmarks.mts';
import { runFreeCriticBenchmark, runFreeStoryBenchmark } from './_lib/benchmark-free-router.mts';
import { assessCriticBenchmark, assessStoryBenchmark } from './_lib/benchmark-quality.mts';

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

  try {
    if (stage === 'story') {
      const result = await runFreeStoryBenchmark(fixture);
      const qualityGate = assessStoryBenchmark(fixture, result.data);
      return json({
        benchmark: { fixture: fixture.id, label: fixture.label, stage: 'story-understanding', synthetic_only: true },
        passed: result.engine.mode === 'model' && qualityGate.passed,
        engine: result.engine,
        quality_gate: qualityGate,
        result: result.data
      });
    }

    const adaptation = buildBenchmarkAdaptation(fixture);
    const result = await runFreeCriticBenchmark(fixture, adaptation);
    const qualityGate = assessCriticBenchmark(fixture, adaptation, result.data);
    return json({
      benchmark: { fixture: fixture.id, label: fixture.label, stage: 'film-critic', synthetic_only: true },
      passed: result.engine.mode === 'model' && qualityGate.passed,
      engine: result.engine,
      quality_gate: qualityGate,
      result: result.data
    });
  } catch (error) {
    return json({
      benchmark: { fixture: fixture.id, label: fixture.label, stage, synthetic_only: true },
      passed: false,
      engine: { provider: 'local', model: 'benchmark-failed', mode: 'deterministic-fallback', privacy_lane: 'local', privacy_mode: 'local-only' },
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const config = {
  path: '/api/ai-benchmark',
  rateLimit: { windowLimit: 24, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
