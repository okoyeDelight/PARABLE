const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const production = Netlify.context?.deploy?.context === 'production';
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const groq = Boolean(process.env.GROQ_API_KEY);
  const benchmarkEnabled = !production && process.env.PARABLE_ENABLE_BENCHMARK_LANE === 'true';

  return json({
    ai_runtime: {
      version: 'parable-ai-v8',
      provider_agnostic: true,
      health_endpoint: '/api/ai-health',
      benchmark_endpoint: benchmarkEnabled ? '/api/ai-benchmark' : null,
      secrets_exposed_to_client: false
    },
    story_understanding: {
      ready: openrouter || groq,
      version: 'story-understanding-v2',
      configured_providers: { openrouter, groq },
      lanes: {
        protected: {
          default_for_user_manuscripts: true,
          policy: 'OpenRouter requests require structured outputs, no provider data collection and zero-data-retention routing. If no compatible endpoint exists, PARABLE falls back locally rather than weakening privacy.',
          model_router: process.env.PARABLE_PROTECTED_UNDERSTAND_MODEL || 'openrouter/free'
        },
        benchmark: {
          enabled: benchmarkEnabled,
          synthetic_only: true,
          policy: 'Deploy-preview CI fixtures may use the dynamic free router without protected-manuscript routing constraints. Arbitrary manuscript text cannot enter this lane through /api/ai-benchmark.',
          model_router: 'openrouter/free'
        }
      },
      fallback_available: true
    },
    film_critic: {
      ready: openrouter,
      version: 'film-quality-critic-v3',
      protected_by_default: true,
      benchmark_lane_enabled: benchmarkEnabled,
      fallback_available: true
    },
    environment: {
      deploy_context: Netlify.context?.deploy?.context || 'unknown',
      production,
      benchmark_enabled: benchmarkEnabled
    }
  });
};

export const config = {
  path: '/api/ai-status',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
