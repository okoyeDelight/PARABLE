import { getDeployStore } from '@netlify/blobs';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  if (Netlify.context?.deploy?.context !== 'deploy-preview') {
    return json({ error: 'Not found' }, 404);
  }

  const store = getDeployStore('parable-projects');
  const started = Date.now();
  const ids = ['proj_the_altar', 'proj_before_i_said_yes', 'proj_the_watchman'];
  const rows = await Promise.all(
    ids.map((id) => store.get('project/' + id, { type: 'json' }))
  );

  return json({
    ok: true,
    probe: 'read-tier-v1',
    resolved: rows.filter(Boolean).length,
    storage_latency_ms: Date.now() - started,
    deploy_context: 'deploy-preview'
  });
};

export const config = {
  path: '/api/scale-probe',
  rateLimit: {
    windowLimit: 20000,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
