import { getContext } from '@netlify/functions';
import {
  claimJobProcessing,
  completeJob,
  failJob,
  markJobRetrying,
  readDurableJob,
  readJobPayload,
  type JobKind
} from './job-store.mts';
import {
  signInternalAuthorization,
  type ProjectAction,
  type SecurityActor
} from './security.mts';

export type ProcessOutcome =
  | { status: 'completed'; result?: unknown }
  | { status: 'busy' }
  | { status: 'retry'; message: string; delay_ms: number }
  | { status: 'terminal'; message: string };

const clean = (value: unknown, max = 1200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function origin() {
  try {
    const context = getContext();
    const deployId = context.deploy?.id;
    const siteName = context.site?.name;
    if (deployId && siteName) return ('https://' + deployId + '--' + siteName + '.netlify.app').replace(/\/$/, '');
    if (context.site?.url) return context.site.url.replace(/\/$/, '');
  } catch {}

  const value =
    Netlify.env.get('DEPLOY_URL') ||
    Netlify.env.get('DEPLOY_PRIME_URL') ||
    Netlify.env.get('URL') ||
    Netlify.env.get('PARABLE_PUBLIC_URL') ||
    '';
  return value.replace(/\/$/, '');
}

function routeFor(kind: JobKind) {
  if (kind === 'scene-state') return '/api/scene-state';
  if (kind === 'shot-state') return '/api/shot-state';
  if (kind === 'story-understanding') return '/api/understand';
  if (kind === 'film-critic') return '/api/director-critic';
  if (kind === 'adaptation') return '/api/adapt';
  if (kind === 'keyframe-generate') return '/api/keyframe-generate';
  if (kind === 'reference-profile') return '/api/reference-profile';
  return null;
}

export async function processDurableJob(args: {
  jobId: string;
  kind: JobKind;
  attempt: number;
  executionId?: string | null;
}): Promise<ProcessOutcome> {
  const { jobId, kind } = args;
  const attempt = Math.max(1, Math.floor(Number(args.attempt) || 1));

  const existing = await readDurableJob(jobId);
  if (!existing) return { status: 'terminal', message: 'Durable job record was not found.' };
  if (existing.status === 'succeeded') return { status: 'completed' };

  if (
    existing.status === 'processing' &&
    existing.lease_expires_at &&
    Date.parse(existing.lease_expires_at) > Date.now()
  ) {
    return { status: 'busy' };
  }

  const payload = await readJobPayload(jobId);
  if (!payload) {
    await failJob(jobId, 'Job payload was not found.');
    return { status: 'terminal', message: 'Job payload was not found.' };
  }

  const leaseToken = 'lease_' + crypto.randomUUID().replaceAll('-', '');
  const claim = await claimJobProcessing(jobId, attempt, leaseToken);
  const claimed = claim.job;

  if (!claim.claimed || !claimed || claimed.lease_token !== leaseToken) {
    if (
      claim.reason === 'capacity-global' ||
      claim.reason === 'capacity-project' ||
      claim.reason === 'admission-busy'
    ) {
      return {
        status: 'retry',
        message: 'PARABLE worker admission is temporarily deferred (' + claim.reason + ').',
        delay_ms: Math.max(250, claim.retry_after_ms || 1500)
      };
    }
    return { status: 'busy' };
  }

  if (kind === 'scale-noop') {
    const result = {
      ok: true,
      probe: 'durable-queue-v1',
      execution_id: args.executionId || null,
      attempt,
      completed_at: new Date().toISOString()
    };
    await completeJob(jobId, result, leaseToken);
    return { status: 'completed', result };
  }

  const path = routeFor(kind);
  if (!path) {
    const message = 'Unsupported durable job kind.';
    await failJob(jobId, message, leaseToken);
    return { status: 'terminal', message };
  }

  const base = origin();
  if (!base) {
    const message = 'No deployment origin is available for internal pipeline execution.';
    await failJob(jobId, message, leaseToken);
    return { status: 'terminal', message };
  }

  if (!claimed.authorization) {
    const message = 'Durable job has no trusted authorization context.';
    await failJob(jobId, message, leaseToken);
    return { status: 'terminal', message };
  }

  const actor: SecurityActor = {
    actor_id: claimed.authorization.actor_id,
    provider: claimed.authorization.provider,
    subject: claimed.authorization.subject,
    email: null,
    display_name: null,
    auth_mode: 'internal',
    internal: true
  };

  let internalAuth: string;
  try {
    internalAuth = await signInternalAuthorization({
      actor,
      projectId: claimed.project_id,
      action: claimed.authorization.action as ProjectAction,
      ttlSeconds: 300
    });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 1000) || 'Internal authorization signing failed.';
    await failJob(jobId, message, leaseToken);
    return { status: 'terminal', message };
  }

  let response: Response;
  try {
    response = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-parable-workload': 'durable-pipeline',
        'x-parable-job-id': jobId,
        'x-parable-internal-auth': internalAuth
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 1000) || 'Internal pipeline request failed.';
    await markJobRetrying(jobId, message, attempt, leaseToken);
    return {
      status: 'retry',
      message,
      delay_ms: Math.min(120000, 3000 * Math.pow(2, Math.max(0, attempt - 1)))
    };
  }

  const text = await response.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}

  if (response.ok) {
    await completeJob(jobId, body, leaseToken);
    return { status: 'completed', result: body };
  }

  const message = clean(
    typeof body === 'object' ? body?.error || body?.detail || JSON.stringify(body) : body,
    1200
  ) || ('HTTP ' + response.status);

  if (response.status === 429 || response.status >= 500) {
    await markJobRetrying(jobId, message, attempt, leaseToken);
    return {
      status: 'retry',
      message,
      delay_ms: Math.min(180000, 5000 * Math.pow(2, Math.max(0, attempt - 1)))
    };
  }

  if (
    response.status === 409 &&
    (
      body?.code === 'PROJECT_REVISION_CONFLICT' ||
      body?.code === 'PROJECT_MUTATION_BUSY' ||
      (
        kind === 'shot-state' &&
        /previous|processed in order|scene must pass|pre-scene/i.test(message)
      )
    )
  ) {
    const hintedDelay = Number(body?.retry_after_ms || 0);
    const delayMs = hintedDelay > 0
      ? Math.min(60000, Math.max(500, hintedDelay))
      : Math.min(60000, 2500 * Math.pow(2, Math.max(0, attempt - 1)));

    await markJobRetrying(jobId, message, attempt, leaseToken);
    return {
      status: 'retry',
      message,
      delay_ms: delayMs
    };
  }

  await failJob(jobId, message, leaseToken);
  return { status: 'terminal', message };
}
