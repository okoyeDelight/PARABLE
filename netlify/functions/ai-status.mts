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
  const openrouterModels = String(
    process.env.PARABLE_OPENROUTER_MODELS ||
    process.env.PARABLE_OPENROUTER_MODEL ||
    'openai/gpt-oss-20b:free,google/gemma-4-26b-a4b-it:free'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 2);

  return json({
    story_intelligence: {
      ready: openrouter || groq,
      provider_order: ['openrouter', 'groq'],
      configured_providers: { openrouter, groq },
      configured_but_not_active_in_v7: { gemini },
      provider_models: {
        openrouter: openrouterModels,
        groq: process.env.PARABLE_GROQ_MODEL || 'openai/gpt-oss-120b'
      },
      fallback_available: true,
      version: 'story-intelligence-v7.1',
      privacy: {
        openrouter_no_training_routing_requested: true,
        openrouter_note: 'Free development routing still depends on provider availability and privacy-compatible endpoints. Confidential manuscripts require a stronger launch privacy tier.',
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
