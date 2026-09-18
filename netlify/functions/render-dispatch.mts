import { prepareRendererRequest } from './_lib/render-adapters.mts';
import { routeRenderSpec } from './_lib/render-router.mts';
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

async function dispatchFal(attempt: any, spec: any) {
  const key = Netlify.env.get('FAL_KEY') || '';
  if (!key) {
    return {
      ok: false,
      status: 503,
      error: 'fal renderer is not configured in the deployed PARABLE runtime.',
      code: 'RENDERER_RUNTIME_NOT_CONFIGURED'
    };
  }

  const prepared = prepareRendererRequest({
    spec,
    provider: attempt.provider,
    model: attempt.model,
    mode: attempt.mode
  });

  const started = Date.now();
  const response = await fetch(String(prepared.request_url), {
    method: 'POST',
    headers: {
      authorization: 'Key ' + key,
      'content-type': 'application/json'
    },
    body: JSON.stringify(prepared.body)
  });

  const body = await response.json().catch(() => ({})) as Record<string, any>;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status >= 500 || response.status === 429 ? 503 : 422,
      error: clean(body?.detail || body?.error?.message || body?.message || 'Renderer submission failed.', 1000),
      code: response.status === 429 ? 'RENDERER_RATE_LIMITED' : 'RENDERER_SUBMISSION_FAILED',
      latency_ms: Date.now() - started,
      provider_detail: body
    };
  }

  const requestId = clean(body?.request_id, 300);
  if (!requestId) {
    return {
      ok: false,
      status: 502,
      error: 'Renderer accepted the request but did not return a request id.',
      code: 'RENDERER_BAD_RESPONSE',
      latency_ms: Date.now() - started
    };
  }

  return {
    ok: true,
    request_id: requestId,
    status_url: clean(body?.status_url, 1800) || null,
    response_url: clean(body?.response_url, 1800) || null,
    queue_position: Number.isFinite(Number(body?.queue_position)) ? Number(body.queue_position) : null,
    latency_ms: Date.now() - started,
    prepared
  };
}

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const attemptId = clean(body.attemptId, 160);
  if (!attemptId || !safeId(attemptId)) return json({ error: 'A valid attemptId is required.' }, 400);

  const attempt = await readRenderAttempt(attemptId);
  if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);
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

  const route = routeRenderSpec(spec);
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

  let dispatched: any;
  if (attempt.provider === 'fal') {
    dispatched = await dispatchFal(attempt, spec);
  } else {
    dispatched = {
      ok: false,
      status: 501,
      error: 'The deployed runtime adapter for this renderer is not implemented yet.',
      code: 'RENDERER_ADAPTER_NOT_IMPLEMENTED'
    };
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
      retryable: dispatched.status === 503,
      route
    }, dispatched.status);
  }

  const updated = {
    ...attempt,
    status: 'queued' as const,
    provider_request_id: dispatched.request_id,
    latency_ms: dispatched.latency_ms,
    updated_at: new Date().toISOString()
  };

  await saveRenderAttempt(updated);
  await appendRenderAttemptEvent(updated, 'dispatched', {
    request_id: dispatched.request_id,
    queue_position: dispatched.queue_position,
    reference_map: dispatched.prepared.reference_map,
    adapter_notes: dispatched.prepared.notes
  });

  return json({
    attempt: updated,
    route,
    queue_position: dispatched.queue_position,
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
