const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache'
  }
});

const env = (key: string) => {
  try {
    return Netlify.env.get(key) || '';
  } catch {
    return '';
  }
};

const clean = (value: unknown, max = 512) =>
  String(value ?? '').replace(/[\r\n\t]/g, '').trim().slice(0, max);

export default async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const deploy = (Netlify.context as any)?.deploy || {};
  const deployId = clean(deploy.id || env('DEPLOY_ID') || env('BUILD_ID'), 160);
  const commitRef = clean(
    env('COMMIT_REF') ||
    env('HEAD') ||
    env('GITHUB_SHA') ||
    deploy.commit_ref ||
    deploy.commitRef,
    160
  ).toLowerCase();
  const deployContext = clean(deploy.context || env('CONTEXT') || 'unknown', 80);
  const siteName = clean(env('SITE_NAME') || 'parable-studio', 160);
  const deployUrl = clean(deploy.url || env('DEPLOY_URL'), 1200);

  let immutableUrl = '';
  if (deployId && siteName) {
    immutableUrl = `https://${deployId}--${siteName}.netlify.app`;
  } else if (deployUrl && /\.netlify\.app(?:\/|$)/i.test(deployUrl)) {
    immutableUrl = deployUrl.replace(/\/$/, '');
  }

  const complete = Boolean(deployId && commitRef && immutableUrl);

  return json({
    identity_version: 'parable-deploy-identity-v1',
    ok: complete,
    deploy_id: deployId || null,
    commit_ref: commitRef || null,
    deploy_context: deployContext,
    site_name: siteName || null,
    immutable_url: immutableUrl || null,
    moving_alias_trusted: false,
    verification_contract: {
      commit_must_match_requesting_ci_sha: true,
      immutable_deploy_id_required: true,
      immutable_endpoint_recheck_required: true
    }
  }, complete ? 200 : 503);
};

export const config = {
  path: '/api/deploy-identity',
  rateLimit: {
    windowLimit: 240,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
