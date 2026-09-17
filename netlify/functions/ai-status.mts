const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const groq = Boolean(process.env.GROQ_API_KEY);
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  const preferred = (process.env.PARABLE_AI_PROVIDER || 'auto').toLowerCase();
  const configuredOrder = String(process.env.PARABLE_AI_ORDER || 'gemini,groq')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value === 'gemini' || value === 'groq');
  const order = [...configuredOrder, ...['gemini', 'groq'].filter((value) => !configuredOrder.includes(value))];

  return json({
    story_intelligence: {
      ready: groq || gemini,
      preferred,
      provider_order: order,
      configured_providers: {
        groq,
        gemini
      },
      fallback_available: true,
      version: 'story-intelligence-v4',
      privacy: {
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
