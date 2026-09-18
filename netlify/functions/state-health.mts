import {
  transactionalStateConfigured,
  transactionalStateHealth,
  transactionalStateMode,
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
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const mode = transactionalStateMode();
  if (mode !== 'postgres') {
    return json({
      ok: true,
      mode,
      transactional: false,
      note: 'Blob CAS mode is active. PostgreSQL hot state is not authoritative in this runtime.'
    });
  }

  if (!transactionalStateConfigured()) {
    return json({
      ok: false,
      mode,
      transactional: true,
      code: 'TRANSACTIONAL_STATE_NOT_CONFIGURED'
    }, 503);
  }

  try {
    const upstream = await transactionalStateHealth();
    return json({
      ok: true,
      mode,
      transactional: true,
      upstream
    });
  } catch (error) {
    if (error instanceof TransactionalStateError) {
      return json({
        ok: false,
        mode,
        transactional: true,
        code: error.code,
        error: error.message,
        retryable: error.retryable
      }, error.status);
    }
    throw error;
  }
};

export const config = {
  path: '/api/state-health',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
