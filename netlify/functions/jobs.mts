import {
  createDurableJob,
  failJob,
  markJobQueued,
  readDurableJob,
  type JobKind
} from './_lib/job-store.mts';
import { dispatchDurableJob } from './_lib/job-dispatcher.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const supported = new Set<JobKind>(['scene-state', 'shot-state', 'story-understanding', 'adaptation', 'film-critic', 'keyframe-generate', 'scale-noop']);

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const kind = clean(body.kind, 40) as JobKind;
  const payload = body.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {};
  const projectId = clean(payload.projectId || body.projectId, 96);
  const idempotencyKey = clean(request.headers.get('idempotency-key') || body.idempotencyKey, 240);

  if (!supported.has(kind)) {
    return json({ error: 'Unsupported job kind.' }, 400);
  }
  if (kind === 'scale-noop' && Netlify.context?.deploy?.context !== 'deploy-preview') {
    return json({ error: 'scale-noop is available only on Deploy Previews.' }, 404);
  }
  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required inside payload.' }, 400);

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (payloadBytes > 450_000) {
    return json({
      error: 'Job payload is too large.',
      max_bytes: 450000,
      hint: 'Store large source assets separately and submit references instead.'
    }, 413);
  }

  const created = await createDurableJob({
    kind,
    projectId,
    payload,
    idempotencyKey: idempotencyKey || null
  });

  if (created.conflict) {
    return json({
      error: created.conflict_reason,
      job: created.job
    }, 409);
  }

  const shouldDispatch = created.created || created.job.status === 'failed';
  let dispatchBackend: 'async-workloads' | 'netlify-background' | null = null;
  let degradedFromPrimary = false;

  if (shouldDispatch) {
    try {
      const dispatched = await dispatchDurableJob(created.job.id, kind);
      dispatchBackend = dispatched.backend;
      degradedFromPrimary = Boolean(dispatched.primary_error);
      await markJobQueued(created.job.id, dispatched.event_id);
    } catch (error) {
      await failJob(created.job.id, error);
      return json({
        error: 'PARABLE could not start this production job.',
        job_id: created.job.id,
        retryable: true,
        detail: clean(error instanceof Error ? error.message : error, 600)
      }, 503);
    }
  }

  const current = await readDurableJob(created.job.id) || created.job;
  return json({
    job: current,
    accepted: true,
    deduplicated: !created.created,
    dispatch_backend: dispatchBackend,
    degraded_from_primary_queue: degradedFromPrimary,
    poll: '/api/job-status?id=' + current.id
  }, created.created ? 202 : 200);
};

export const config = {
  path: '/api/jobs',
  rateLimit: {
    windowLimit: 1500,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
