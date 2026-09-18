import {
  appendRenderAttemptEvent,
  readRenderAttempt,
  saveRenderAttempt
} from './_lib/render-store.mts';
import {
  failProviderTransaction,
  markProviderProcessing,
  settleProviderTransaction
} from './_lib/provider-transactions.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra
  }
});

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);

function falUrls(model: string, requestId: string) {
  const base = 'https://queue.fal.run/' + model + '/requests/' + encodeURIComponent(requestId);
  return {
    status: base + '/status',
    response: base + '/response'
  };
}

async function pollFal(attempt: any) {
  const key = Netlify.env.get('FAL_KEY') || '';
  if (!key) {
    return {
      ok: false,
      status: 503,
      error: 'fal renderer is not configured in the deployed PARABLE runtime.',
      retryable: true
    };
  }

  if (!attempt.provider_request_id) {
    return { ok: false, status: 409, error: 'Attempt has no provider request id.', retryable: false };
  }

  const urls = falUrls(attempt.model, attempt.provider_request_id);
  const statusResponse = await fetch(urls.status, {
    headers: { authorization: 'Key ' + key }
  });

  const statusBody = await statusResponse.json().catch(() => ({})) as Record<string, any>;
  if (!statusResponse.ok) {
    return {
      ok: false,
      status: statusResponse.status >= 500 || statusResponse.status === 429 ? 503 : statusResponse.status,
      error: clean(statusBody?.detail || statusBody?.error?.message || statusBody?.message || 'Could not read renderer status.', 1000),
      retryable: statusResponse.status >= 500 || statusResponse.status === 429
    };
  }

  const providerStatus = clean(statusBody?.status, 80).toUpperCase();

  if (providerStatus === 'IN_QUEUE') {
    return {
      ok: true,
      state: 'queued',
      provider_status: providerStatus,
      queue_position: Number.isFinite(Number(statusBody?.queue_position)) ? Number(statusBody.queue_position) : null
    };
  }

  if (providerStatus === 'IN_PROGRESS') {
    return {
      ok: true,
      state: 'rendering',
      provider_status: providerStatus,
      queue_position: null
    };
  }

  if (providerStatus !== 'COMPLETED') {
    return {
      ok: false,
      status: 502,
      error: 'Unknown renderer queue status: ' + (providerStatus || 'empty'),
      retryable: true
    };
  }

  const resultResponse = await fetch(urls.response, {
    headers: { authorization: 'Key ' + key }
  });
  const resultBody = await resultResponse.json().catch(() => ({})) as Record<string, any>;

  if (!resultResponse.ok) {
    return {
      ok: false,
      status: resultResponse.status >= 500 || resultResponse.status === 429 ? 503 : resultResponse.status,
      error: clean(resultBody?.detail || resultBody?.error?.message || resultBody?.message || 'Renderer completed but its result could not be retrieved.', 1000),
      retryable: resultResponse.status >= 500 || resultResponse.status === 429
    };
  }

  const data = resultBody?.data && typeof resultBody.data === 'object' ? resultBody.data : resultBody;
  const assetUri = clean(data?.video?.url || data?.output?.video?.url || data?.url, 1800);
  if (!assetUri) {
    return {
      ok: false,
      status: 502,
      error: 'Renderer completed but returned no video asset URL.',
      retryable: false,
      provider_result: resultBody
    };
  }

  return {
    ok: true,
    state: 'succeeded',
    provider_status: providerStatus,
    asset_uri: assetUri,
    seed: data?.seed ?? null,
    provider_result: resultBody
  };
}


async function pollHiggsfield(attempt: any) {
  const credentials = Netlify.env.get('HF_CREDENTIALS') || '';
  if (!credentials) {
    return {
      ok: false,
      status: 503,
      error: 'Higgsfield renderer credentials are not configured in the deployed PARABLE runtime.',
      retryable: true
    };
  }
  if (!attempt.provider_request_id) {
    return { ok: false, status: 409, error: 'Attempt has no provider request id.', retryable: false };
  }

  const url = 'https://api.higgsfield.ai/requests/' + encodeURIComponent(attempt.provider_request_id) + '/status';
  const response = await fetch(url, {
    headers: { authorization: 'Key ' + credentials }
  });
  const body = await response.json().catch(() => ({})) as Record<string, any>;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status >= 500 || response.status === 429 ? 503 : response.status,
      error: clean(body?.detail || body?.error?.message || body?.message || 'Could not read Higgsfield status.', 1000),
      retryable: response.status >= 500 || response.status === 429
    };
  }

  const providerStatus = clean(body?.status, 80).toLowerCase();
  if (providerStatus === 'queued') {
    return { ok: true, state: 'queued', provider_status: providerStatus, queue_position: null };
  }
  if (providerStatus === 'in_progress' || providerStatus === 'processing') {
    return { ok: true, state: 'rendering', provider_status: providerStatus, queue_position: null };
  }
  if (['failed','canceled','cancelled','nsfw','moderated'].includes(providerStatus)) {
    return {
      ok: false,
      status: providerStatus === 'nsfw' || providerStatus === 'moderated' ? 422 : 502,
      error: providerStatus === 'nsfw' || providerStatus === 'moderated'
        ? 'Higgsfield moderated this generation.'
        : 'Higgsfield generation ended with status: ' + providerStatus,
      retryable: false
    };
  }
  if (providerStatus !== 'completed') {
    return {
      ok: false,
      status: 502,
      error: 'Unknown Higgsfield status: ' + (providerStatus || 'empty'),
      retryable: true
    };
  }

  const assetUri = clean(body?.video?.url || body?.data?.video?.url || body?.output?.video?.url, 1800);
  if (!assetUri) {
    return {
      ok: false,
      status: 502,
      error: 'Higgsfield completed but returned no video URL.',
      retryable: false
    };
  }

  return {
    ok: true,
    state: 'succeeded',
    provider_status: providerStatus,
    asset_uri: assetUri,
    seed: body?.seed ?? null,
    provider_result: body
  };
}

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const attemptId = clean(url.searchParams.get('attemptId'), 160);
  if (!attemptId || !safeId(attemptId)) return json({ error: 'A valid attemptId is required.' }, 400);

  const attempt = await readRenderAttempt(attemptId);
  if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);

  try {
    await authorizeProject(request, attempt.project_id, 'project:read');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  if (['succeeded', 'accepted', 'rejected', 'superseded', 'failed'].includes(attempt.status)) {
    return json({
      attempt,
      terminal: true,
      next_action: attempt.status === 'succeeded' ? 'POST /api/render-qa' : null
    });
  }

  let polled: any;
  if (attempt.provider === 'fal') {
    polled = await pollFal(attempt);
  } else if (attempt.provider === 'higgsfield') {
    polled = await pollHiggsfield(attempt);
  } else {
    return json({
      error: 'No provider-status adapter is registered for this renderer.',
      code: 'RENDERER_STATUS_ADAPTER_NOT_IMPLEMENTED'
    }, 501);
  }

  if (!polled.ok) {
    if (attempt.provider_transaction_id && polled.retryable === false) {
      await failProviderTransaction({
        id: attempt.provider_transaction_id,
        projectId: attempt.project_id,
        failureClass: 'provider-status-failed',
        failureDetail: polled.error || 'Provider status/result retrieval failed terminally.'
      }).catch(() => null);
    }

    return json({
      error: polled.error,
      retryable: polled.retryable,
      attempt
    }, polled.status || 502);
  }

  if (polled.state === 'queued' || polled.state === 'rendering') {
    const next = {
      ...attempt,
      status: polled.state,
      updated_at: new Date().toISOString()
    };
    if (next.status !== attempt.status) {
      if (attempt.provider_transaction_id && polled.state === 'rendering') {
        await markProviderProcessing(attempt.provider_transaction_id, attempt.project_id).catch(() => null);
      }
      await saveRenderAttempt(next);
      await appendRenderAttemptEvent(next, 'provider-status', {
        provider_status: polled.provider_status,
        queue_position: polled.queue_position
      });
    }

    const retryAfter = polled.state === 'queued' ? 4 : 3;
    return json({
      attempt: next,
      provider_status: polled.provider_status,
      queue_position: polled.queue_position,
      poll_after_ms: retryAfter * 1000
    }, 200, { 'retry-after': String(retryAfter) });
  }

  const succeeded = {
    ...attempt,
    status: 'succeeded' as const,
    asset_uri: polled.asset_uri,
    failure_class: null,
    failure_detail: null,
    updated_at: new Date().toISOString()
  };

  if (attempt.provider_transaction_id) {
    await settleProviderTransaction({
      id: attempt.provider_transaction_id,
      projectId: attempt.project_id,
      actualCostUsd: attempt.actual_cost_usd
    }).catch(() => null);
  }

  await saveRenderAttempt(succeeded);
  await appendRenderAttemptEvent(succeeded, 'provider-completed', {
    seed: polled.seed,
    asset_uri: polled.asset_uri
  });

  return json({
    attempt: succeeded,
    provider_status: polled.provider_status,
    seed: polled.seed,
    next_action: {
      endpoint: 'POST /api/jobs',
      kind: 'motion-inspect',
      payload: {
        projectId: succeeded.project_id,
        attemptId: succeeded.id
      },
      idempotency_key_hint: 'motion-inspect:' + succeeded.id + ':' + succeeded.spec_hash
    },
    note: 'Media exists, but a final shot cannot enter the film timeline until PARABLE extracts temporal evidence, runs full-motion Visual Inspection, binds QA to this exact asset/spec, and then receives explicit acceptance.'
  });
};

export const config = {
  path: '/api/render-provider-status',
  rateLimit: {
    windowLimit: 30000,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
