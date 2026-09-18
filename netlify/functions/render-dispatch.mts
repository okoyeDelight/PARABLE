import { prepareRendererRequest } from './_lib/render-adapters.mts';
import { routeRenderSpec } from './_lib/render-router.mts';
import { evaluateProviderSpend } from './_lib/render-commerce.mts';
import { readHiggsfieldCredentials } from './_lib/higgsfield-credentials.mts';
import { evaluateStoredKeyframeGate } from './_lib/keyframe-approval.mts';
import {
  acknowledgeProviderSubmission,
  beginProviderSubmission,
  ensureProviderTransaction,
  failProviderTransaction,
  markProviderSubmissionAmbiguous,
  providerTransactionErrorResponse
} from './_lib/provider-transactions.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';
import { hydrateRenderSpecReferencesWithRights } from './_lib/canon-assets.mts';
import { hydrateKeyframeApprovalAsset } from './_lib/keyframe-assets.mts';
import {
  appendRenderAttemptEvent,
  readRenderAttempt,
  readRenderSpec,
  saveRenderAttempt
} from './_lib/render-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);

async function dispatchFal(attempt: any, spec: any, approvedKeyframe: any = null) {
  const key = Netlify.env.get('FAL_KEY') || '';
  if (!key) {
    return {
      ok: false,
      status: 503,
      error: 'fal renderer is not configured in the deployed PARABLE runtime.',
      code: 'RENDERER_RUNTIME_NOT_CONFIGURED'
    };
  }

  const hydrated = await hydrateRenderSpecReferencesWithRights(spec);
  const hydratedSpec = hydrated.spec;

  const prepared = prepareRendererRequest({
    spec: hydratedSpec,
    provider: attempt.provider,
    model: attempt.model,
    mode: attempt.mode,
    approvedKeyframe
  });

  const transactionState = await ensureProviderTransaction({
    projectId: attempt.project_id,
    operationType: 'video-render',
    operationId: attempt.id,
    provider: attempt.provider,
    model: attempt.model,
    requestBody: prepared.body,
    estimatedCostUsd: attempt.estimated_cost_usd
  });

  const transaction = await beginProviderSubmission(
    transactionState.transaction.id,
    attempt.project_id,
    hydrated.rights_assertions
  );

  if (
    ['acknowledged','processing','settled'].includes(transaction.state) &&
    transaction.provider_request_id
  ) {
    return {
      ok: true,
      request_id: transaction.provider_request_id,
      status_url: transaction.provider_status_url,
      response_url: transaction.provider_response_url,
      queue_position: null,
      latency_ms: 0,
      prepared,
      transaction,
      deduplicated_provider_submission: true
    };
  }

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(String(prepared.request_url), {
      method: 'POST',
      headers: {
        authorization: 'Key ' + key,
        'content-type': 'application/json'
      },
      body: JSON.stringify(prepared.body)
    });
  } catch (error) {
    const detail = clean(error instanceof Error ? error.message : error, 1000) || 'Provider submission connection failed.';
    const ambiguous = await markProviderSubmissionAmbiguous({
      id: transaction.id,
      projectId: attempt.project_id,
      detail
    });
    return {
      ok: false,
      status: 409,
      error: 'The renderer may already have received this paid request. PARABLE locked the transaction instead of retrying automatically.',
      code: 'PROVIDER_SUBMISSION_AMBIGUOUS',
      latency_ms: Date.now() - started,
      transaction: ambiguous
    };
  }

  const body = await response.json().catch(() => ({})) as Record<string, any>;
  const detail = clean(body?.detail || body?.error?.message || body?.message || '', 1000);

  if (!response.ok) {
    if (response.status >= 500) {
      const ambiguous = await markProviderSubmissionAmbiguous({
        id: transaction.id,
        projectId: attempt.project_id,
        detail: detail || ('Provider returned HTTP ' + response.status + ' after submission.')
      });
      return {
        ok: false,
        status: 409,
        error: 'The provider returned an uncertain server response after a paid submission. PARABLE will not auto-retry.',
        code: 'PROVIDER_SUBMISSION_AMBIGUOUS',
        latency_ms: Date.now() - started,
        transaction: ambiguous
      };
    }

    const failed = await failProviderTransaction({
      id: transaction.id,
      projectId: attempt.project_id,
      failureClass: response.status === 429 ? 'rate-limit' : 'provider-rejected',
      failureDetail: detail || ('HTTP ' + response.status)
    });

    return {
      ok: false,
      status: response.status === 429 ? 503 : 422,
      error: detail || 'Renderer submission failed.',
      code: response.status === 429 ? 'RENDERER_RATE_LIMITED' : 'RENDERER_SUBMISSION_FAILED',
      latency_ms: Date.now() - started,
      transaction: failed
    };
  }

  const requestId = clean(body?.request_id, 300);
  if (!requestId) {
    const ambiguous = await markProviderSubmissionAmbiguous({
      id: transaction.id,
      projectId: attempt.project_id,
      detail: 'Provider returned success without a durable request id.'
    });
    return {
      ok: false,
      status: 409,
      error: 'Renderer accepted the request without a durable request id. PARABLE locked the transaction to prevent duplicate spending.',
      code: 'PROVIDER_SUBMISSION_AMBIGUOUS',
      latency_ms: Date.now() - started,
      transaction: ambiguous
    };
  }

  const acknowledged = await acknowledgeProviderSubmission({
    id: transaction.id,
    projectId: attempt.project_id,
    providerRequestId: requestId,
    statusUrl: clean(body?.status_url, 1800) || null,
    responseUrl: clean(body?.response_url, 1800) || null
  });

  return {
    ok: true,
    request_id: requestId,
    status_url: acknowledged.provider_status_url,
    response_url: acknowledged.provider_response_url,
    queue_position: Number.isFinite(Number(body?.queue_position)) ? Number(body.queue_position) : null,
    latency_ms: Date.now() - started,
    prepared,
    transaction: acknowledged,
    deduplicated_provider_submission: false
  };
}


async function dispatchHiggsfield(attempt: any, spec: any, approvedKeyframe: any = null) {
  const credentials = readHiggsfieldCredentials();
  if (!credentials) {
    return {
      ok: false,
      status: 503,
      error: 'Higgsfield renderer credentials are not configured in the deployed PARABLE runtime.',
      code: 'RENDERER_RUNTIME_NOT_CONFIGURED'
    };
  }

  const spend = await evaluateProviderSpend({
    projectId: attempt.project_id,
    provider: 'higgsfield',
    estimatedCostUsd: attempt.estimated_cost_usd
  });
  if (!spend.allowed) {
    return {
      ok: false,
      status: spend.status,
      error: spend.message,
      code: spend.code,
      spend
    };
  }

  const hydrated = await hydrateRenderSpecReferencesWithRights(spec);
  const prepared = prepareRendererRequest({
    spec: hydrated.spec,
    provider: 'higgsfield',
    model: attempt.model,
    mode: attempt.mode,
    approvedKeyframe
  });

  const transactionState = await ensureProviderTransaction({
    projectId: attempt.project_id,
    operationType: 'video-render',
    operationId: attempt.id,
    provider: attempt.provider,
    model: attempt.model,
    requestBody: prepared.body,
    estimatedCostUsd: attempt.estimated_cost_usd
  });
  const transaction = await beginProviderSubmission(
    transactionState.transaction.id,
    attempt.project_id,
    hydrated.rights_assertions
  );

  if (
    ['acknowledged','processing','settled'].includes(transaction.state) &&
    transaction.provider_request_id
  ) {
    return {
      ok: true,
      request_id: transaction.provider_request_id,
      status_url: transaction.provider_status_url,
      response_url: transaction.provider_response_url,
      queue_position: null,
      latency_ms: 0,
      prepared,
      transaction,
      deduplicated_provider_submission: true,
      spend
    };
  }

  const started = Date.now();
  try {
    const { createHiggsfieldClient } = await import('@higgsfield/client/v2');
    const client = createHiggsfieldClient({
      credentials,
      timeout: 120000,
      maxRetries: 0,
      pollInterval: 2000,
      maxPollTime: 300000
    });

    const result: any = await client.subscribe(attempt.model, {
      input: prepared.body,
      withPolling: false
    });

    const status = clean(result?.status, 80).toLowerCase();
    if (['failed','canceled','cancelled','nsfw','moderated'].includes(status)) {
      const failed = await failProviderTransaction({
        id: transaction.id,
        projectId: attempt.project_id,
        failureClass: status === 'nsfw' || status === 'moderated' ? 'provider-moderated' : 'provider-rejected',
        failureDetail: 'Higgsfield returned terminal status: ' + status
      });
      return {
        ok: false,
        status: status === 'nsfw' || status === 'moderated' ? 422 : 502,
        error: status === 'nsfw' || status === 'moderated'
          ? 'Higgsfield moderated this generation request.'
          : 'Higgsfield rejected or canceled this generation request.',
        code: status === 'nsfw' || status === 'moderated' ? 'RENDERER_MODERATED' : 'RENDERER_SUBMISSION_FAILED',
        latency_ms: Date.now() - started,
        transaction: failed,
        spend
      };
    }

    const requestId = clean(result?.request_id || result?.id, 300);
    if (!requestId) {
      const ambiguous = await markProviderSubmissionAmbiguous({
        id: transaction.id,
        projectId: attempt.project_id,
        detail: 'Higgsfield SDK returned no durable request id.'
      });
      return {
        ok: false,
        status: 409,
        error: 'Higgsfield submission returned no durable request id. PARABLE locked the transaction to prevent duplicate spend.',
        code: 'PROVIDER_SUBMISSION_AMBIGUOUS',
        latency_ms: Date.now() - started,
        transaction: ambiguous,
        spend
      };
    }

    const acknowledged = await acknowledgeProviderSubmission({
      id: transaction.id,
      projectId: attempt.project_id,
      providerRequestId: requestId,
      statusUrl: clean(result?.status_url, 1800) || ('https://api.higgsfield.ai/requests/' + encodeURIComponent(requestId) + '/status'),
      responseUrl: null
    });

    return {
      ok: true,
      request_id: requestId,
      status_url: acknowledged.provider_status_url,
      response_url: null,
      queue_position: null,
      latency_ms: Date.now() - started,
      prepared,
      transaction: acknowledged,
      deduplicated_provider_submission: false,
      spend
    };
  } catch (error: any) {
    const name = clean(error?.name, 120);
    const detail = clean(error?.message || error, 1000) || 'Higgsfield submission failed.';
    const knownPreSubmission = [
      'AuthenticationError',
      'NotEnoughCreditsError',
      'BadInputError',
      'ValidationError',
      'BrowserNotSupportedError'
    ].includes(name);

    if (knownPreSubmission) {
      const failed = await failProviderTransaction({
        id: transaction.id,
        projectId: attempt.project_id,
        failureClass: name === 'NotEnoughCreditsError' ? 'insufficient-provider-credit' : 'provider-rejected',
        failureDetail: detail
      });
      return {
        ok: false,
        status: name === 'NotEnoughCreditsError' ? 402 : 422,
        error: detail,
        code: name === 'NotEnoughCreditsError' ? 'PROVIDER_CREDITS_REQUIRED' : 'RENDERER_SUBMISSION_FAILED',
        latency_ms: Date.now() - started,
        transaction: failed,
        spend
      };
    }

    const ambiguous = await markProviderSubmissionAmbiguous({
      id: transaction.id,
      projectId: attempt.project_id,
      detail
    });
    return {
      ok: false,
      status: 409,
      error: 'The Higgsfield request may have been received before the connection failed. PARABLE locked the transaction instead of retrying and risking duplicate spend.',
      code: 'PROVIDER_SUBMISSION_AMBIGUOUS',
      latency_ms: Date.now() - started,
      transaction: ambiguous,
      spend
    };
  }
}

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const attemptId = clean(body.attemptId, 160);
  if (!attemptId || !safeId(attemptId)) return json({ error: 'A valid attemptId is required.' }, 400);

  const attempt = await readRenderAttempt(attemptId);
  if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);

  try {
    await authorizeProject(request, attempt.project_id, 'render:spend');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  if (attempt.status !== 'planned') {
    return json({
      error: 'Only planned attempts can be dispatched.',
      current_status: attempt.status
    }, 409);
  }

  const spec = await readRenderSpec({
    projectId: attempt.project_id,
    storyVersion: attempt.story_version,
    sceneId: attempt.scene_id,
    shotId: attempt.shot_id,
    specHash: attempt.spec_hash
  });

  if (!spec) return json({ error: 'The ShotRenderSpec for this attempt was not found.' }, 409);

  if (attempt.mode === 'final' && spec.human_review.required_before_final_render) {
    return json({
      error: 'This final render is blocked pending human review.',
      code: 'HUMAN_REVIEW_REQUIRED',
      reasons: spec.human_review.reasons
    }, 409);
  }

  const keyframeGate = attempt.mode === 'final'
    ? await evaluateStoredKeyframeGate({
        projectId: attempt.project_id,
        sceneId: attempt.scene_id,
        shotId: attempt.shot_id,
        specHash: spec.spec_hash
      })
    : null;

  if (keyframeGate && !keyframeGate.allowed) {
    return json({
      error: keyframeGate.message,
      code: keyframeGate.code,
      final_motion_gate: 'blocked'
    }, 409);
  }

  if (
    attempt.mode === 'final' &&
    (
      !attempt.keyframe_approval_ref ||
      attempt.keyframe_approval_ref !== keyframeGate?.authoritative_ref ||
      attempt.keyframe_asset_uri !== keyframeGate?.approval?.asset?.uri ||
      attempt.keyframe_plan_hash !== keyframeGate?.approval?.keyframe_plan_hash
    )
  ) {
    return json({
      error: 'The approved first frame changed after this render attempt was created. Create a new final attempt so its inputs remain immutable.',
      code: 'KEYFRAME_APPROVAL_CHANGED',
      final_motion_gate: 'blocked'
    }, 409);
  }

  const route = routeRenderSpec(spec, [], attempt.mode);
  if (!route.selected) {
    return json({
      error: 'No deployed renderer currently satisfies this ShotRenderSpec.',
      code: 'NO_RENDERER_ROUTE',
      route
    }, 409);
  }

  if (route.selected.provider !== attempt.provider || route.selected.model !== attempt.model) {
    return json({
      error: 'The attempt provider/model no longer matches the current Render Router decision.',
      code: 'RENDER_ROUTE_CHANGED',
      attempt_route: { provider: attempt.provider, model: attempt.model },
      current_route: route.selected,
      hint: 'Create a new render attempt using the current route instead of mutating this immutable attempt identity.'
    }, 409);
  }

  const hydratedKeyframeApproval = keyframeGate?.approval
    ? await hydrateKeyframeApprovalAsset(attempt.project_id, keyframeGate.approval)
    : null;

  let dispatched: any;
  try {
    if (attempt.provider === 'fal') {
      const spend = await evaluateProviderSpend({
        projectId: attempt.project_id,
        provider: 'fal',
        estimatedCostUsd: attempt.estimated_cost_usd
      });
      if (!spend.allowed) {
        dispatched = {
          ok: false,
          status: spend.status,
          error: spend.message,
          code: spend.code,
          spend
        };
      } else {
        dispatched = await dispatchFal(attempt, spec, hydratedKeyframeApproval);
      }
    } else if (attempt.provider === 'higgsfield') {
      dispatched = await dispatchHiggsfield(attempt, spec, hydratedKeyframeApproval);
    } else {
      dispatched = {
        ok: false,
        status: 501,
        error: 'The deployed runtime adapter for this renderer is not implemented yet.',
        code: 'RENDERER_ADAPTER_NOT_IMPLEMENTED'
      };
    }
  } catch (error) {
    const handled = providerTransactionErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  if (!dispatched.ok) {
    await appendRenderAttemptEvent(attempt, 'dispatch-failed', {
      code: dispatched.code,
      detail: dispatched.error,
      latency_ms: dispatched.latency_ms || null
    }).catch(() => {});

    return json({
      error: dispatched.error,
      code: dispatched.code,
      retryable: dispatched.status === 503 && dispatched.code !== 'PROVIDER_SUBMISSION_AMBIGUOUS',
      route,
      provider_transaction: dispatched.transaction || null,
      spend_gate: dispatched.spend || null
    }, dispatched.status);
  }

  const updated = {
    ...attempt,
    status: 'queued' as const,
    provider_transaction_id: dispatched.transaction?.id || attempt.provider_transaction_id || null,
    provider_request_id: dispatched.request_id,
    latency_ms: dispatched.latency_ms,
    updated_at: new Date().toISOString()
  };

  await saveRenderAttempt(updated);
  await appendRenderAttemptEvent(updated, 'dispatched', {
    request_id: dispatched.request_id,
    queue_position: dispatched.queue_position,
    reference_map: dispatched.prepared.reference_map,
    adapter_notes: dispatched.prepared.notes,
    keyframe_approval_ref: keyframeGate?.authoritative_ref || null,
    keyframe_asset_uri: keyframeGate?.approval?.asset?.uri || null,
    provider_transaction_id: dispatched.transaction?.id || null,
    provider_submission_deduplicated: Boolean(dispatched.deduplicated_provider_submission)
  });

  return json({
    attempt: updated,
    route,
    queue_position: dispatched.queue_position,
    provider_transaction_id: dispatched.transaction?.id || null,
    provider_submission_deduplicated: Boolean(dispatched.deduplicated_provider_submission),
    poll: '/api/render-provider-status?attemptId=' + encodeURIComponent(updated.id),
    note: 'The provider request is queued. PARABLE still decides whether the resulting media is usable after QA.'
  }, 202);
};

export const config = {
  path: '/api/render-dispatch',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
