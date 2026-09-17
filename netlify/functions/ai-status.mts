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

  return json({
    story_intelligence: {
      ready: groq || gemini,
      preferred,
      configured_providers: {
        groq,
        gemini
      },
      fallback_available: true,
      version: 'story-intelligence-v2'
    }
  });
};

export const config = { path: '/api/ai-status' };
