import {
  bootstrapDerivedPreviewStateSecret,
  TransactionalStateError
} from './_lib/transactional-state.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (Netlify.context?.deploy?.context !== 'deploy-preview') {
    return json({ error: 'Not found' }, 404);
  }

  const token = String(Netlify.env.get('PARABLE_STATE_BOOTSTRAP_TOKEN') || '').trim();
  if (!token) {
    return json({
      error: 'The one-time transactional-state bootstrap token is not configured.',
      code: 'STATE_BOOTSTRAP_TOKEN_MISSING'
    }, 503);
  }

  try {
    const result = await bootstrapDerivedPreviewStateSecret(token);
    return json({
      ...result,
      note: 'The one-time token may now be removed. No runtime signing secret was returned.'
    }, 201);
  } catch (error) {
    if (error instanceof TransactionalStateError) {
      return json({
        error: error.message,
        code: error.code,
        retryable: error.retryable
      }, error.status);
    }
    throw error;
  }
};

export const config = {
  path: '/api/state-secret-bootstrap',
  rateLimit: {
    windowLimit: 3,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
