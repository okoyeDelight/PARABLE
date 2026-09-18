import {
  createDurableJob,
  failJob,
  type JobKind
} from './_lib/job-store.mts';
import { transactionalStateMode } from './_lib/transactional-state.mts';
import { dispatchDurableJob } from './_lib/job-dispatcher.mts';
import {
  authorizeProject,
  securityErrorResponse,
  type ProjectAction
} from './_lib/security.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const supported = new Set<JobKind>(['scene-state', 'shot-state', 'story-understanding', 'adaptation', 'film-critic', 'keyframe-generate', 'reference-profile', 'motion-inspect', 'motion-evidence-extract', 'scale-noop']);

function actionFor(kind: JobKind): ProjectAction {
  if (kind === 'keyframe-generate' || kind === 'motion-inspect' || kind === 'motion-evidence-extract') return 'render:spend';
  if (kind === 'film-critic' || kind === 'scale-noop') return 'render:plan';
  return 'project:edit';
}

function publicJob(job: any) {
  if (!job) return job;
  const { authorization, ...safe } = job;
  return safe;
}

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

  let access;
  try {
    access = await authorizeProject(request, projectId, actionFor(kind));
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

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
    idempotencyKey: idempotencyKey || null,
    authorization: {
      actor_id: access.actor.actor_id,
      provider: access.actor.provider,
      subject: access.actor.subject,
      workspace_id: access.workspace_id,
      role: access.role,
      action: access.action
    }
  });

  if (created.conflict) {
    return json({
      error: created.conflict_reason,
      job: publicJob(created.job)
    }, 409);
  }

  // A terminal failed job is never implicitly resurrected. A deliberate retry
  // uses a new idempotency key/operation so paid or stateful work cannot repeat
  // accidentally.
  const shouldDispatch = created.created;
  let dispatchBackend: 'async-workloads' | 'netlify-background' | null = null;
  let degradedFromPrimary = false;

  if (shouldDispatch) {
    try {
      // The freshly committed row already contains the trusted authorization
      // context, so dispatch does not need to re-read PostgreSQL before
      // acknowledging this request.
      const dispatched = await dispatchDurableJob(created.job.id, kind, created.job);
      dispatchBackend = dispatched.backend;
      degradedFromPrimary = Boolean(dispatched.primary_error);

      // queue_event_id is observability metadata, not correctness state. The
      // authoritative row is already durably queued before dispatch starts.
      // Avoid another synchronous DB round trip on the user acceptance path.
    } catch (error) {
      if (transactionalStateMode() === 'postgres') {
        // In transactional mode the job stays queued. The recovery coordinator
        // will redispatch it, so a transient router outage cannot lose work.
        return json({
          job: publicJob(created.job),
          accepted: true,
          deduplicated: false,
          dispatch_backend: null,
          degraded_from_primary_queue: true,
          dispatch_pending_recovery: true,
          retryable: true,
          detail: clean(error instanceof Error ? error.message : error, 600),
          poll: '/api/job-status?id=' + created.job.id
        }, 202);
      }

      // Compatibility mode has no authoritative recovery sweeper, so keep the
      // older fail-closed behavior until PostgreSQL is active there.
      await failJob(created.job.id, error);
      return json({
        error: 'PARABLE could not start this production job.',
        job_id: created.job.id,
        retryable: true,
        detail: clean(error instanceof Error ? error.message : error, 600)
      }, 503);
    }
  }

  return json({
    job: publicJob(created.job),
    accepted: true,
    deduplicated: !created.created,
    dispatch_backend: dispatchBackend,
    degraded_from_primary_queue: degradedFromPrimary,
    dispatch_pending_recovery: false,
    poll: '/api/job-status?id=' + created.job.id
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
