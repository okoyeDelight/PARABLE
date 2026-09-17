import { readAIHealth } from './_lib/ai-health-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const health = await readAIHealth();
  return json({
    health,
    note: 'Health records contain provider/model status and latency only; manuscript text and secrets are never stored here.'
  });
};

export const config = {
  path: '/api/ai-health',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
