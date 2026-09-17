const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const groq = Boolean(process.env.GROQ_API_KEY);
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  const preferred = (process.env.PARABLE_AI_PROVIDER || 'auto').toLowerCase();
  const allowedProviders = ['openrouter', 'groq', 'gemini'];
  const configuredOrder = String(process.env.PARABLE_AI_ORDER || 'openrouter,groq,gemini')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
    .filter((value) => allowedProviders.includes(value));
  const order = [...configuredOrder, ...allowedProviders.filter((value) => !configuredOrder.includes(value))];

  return json({
    story_intelligence: {
      ready: openrouter || groq || gemini,
      preferred,
      provider_order: order,
      configured_providers: {
        openrouter,
        groq,
        gemini
      },
      provider_models: {
        openrouter: process.env.PARABLE_OPENROUTER_MODEL || 'openrouter/free',
        groq: process.env.PARABLE_GROQ_MODEL || 'openai/gpt-oss-120b',
        gemini: process.env.PARABLE_GEMINI_MODEL || 'gemini-3.8-flash'
      },
      fallback_available: true,
      version: 'story-intelligence-v5',
      privacy: {
        openrouter_data_collection_denied: true,
        gemini_store_disabled: true,
        secrets_exposed_to_client: false
      }
    }
  });
};

export const config = {
  path: '/api/ai-status',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
