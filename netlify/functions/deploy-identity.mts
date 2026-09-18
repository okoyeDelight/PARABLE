import type { Context } from '@netlify/functions';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache'
  }
});

const clean = (value: unknown, max = 512) =>
  String(value ?? '').replace(/[\r\n\t]/g, '').trim().slice(0, max);

export default async (request: Request, context: Context) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const deployId = clean(context.deploy?.id, 160);
  const deployContext = clean(context.deploy?.context || 'unknown', 80);
  const siteName = clean(Netlify.env.get('SITE_NAME') || 'parable-studio', 160);
  const immutableUrl = deployId && siteName
    ? `https://${deployId}--${siteName}.netlify.app`
    : '';

  return json({
    identity_version: 'parable-runtime-deploy-identity-v2',
    ok: Boolean(deployId && immutableUrl),
    deploy_id: deployId || null,
    deploy_context: deployContext,
    site_name: siteName || null,
    immutable_url: immutableUrl || null,
    commit_ref: null,
    commit_binding_source: '/.parable-deploy.json',
    moving_alias_trusted: false
  }, deployId && immutableUrl ? 200 : 503);
};

export const config = {
  path: '/api/deploy-identity',
  rateLimit: {
    windowLimit: 240,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
