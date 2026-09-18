import {
  completeJob,
  failJob,
  markJobProcessing,
  markJobRetrying,
  readDurableJob,
  readJobPayload,
  type JobKind
} from './job-store.mts';

export type ProcessOutcome =
  | { status: 'completed'; result?: unknown }
  | { status: 'busy' }
  | { status: 'retry'; message: string; delay_ms: number }
  | { status: 'terminal'; message: string };

const clean = (value: unknown, max = 1200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function origin() {
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
  await markJobProcessing(jobId, attempt, leaseToken);

  // Netlify Blobs is last-write-wins. Let competing claims settle, then keep
  // only the execution whose lease token survived the strong-consistency read.
  await new Promise((resolve) => setTimeout(resolve, 80));
  const claimed = await readDurableJob(jobId);
  if (!claimed || claimed.lease_token !== leaseToken) return { status: 'busy' };

  if (kind === 'scale-noop') {
    const result = {
      ok: true,
      probe: 'durable-queue-v1',
      execution_id: args.executionId || null,
      attempt,
      completed_at: new Date().toISOString()
    };
    await completeJob(jobId, result);
    return { status: 'completed', result };
  }

  const path = routeFor(kind);
  if (!path) {
    const message = 'Unsupported durable job kind.';
    await failJob(jobId, message);
    return { status: 'terminal', message };
  }

  const base = origin();
  if (!base) {
    const message = 'No deployment origin is available for internal pipeline execution.';
    await failJob(jobId, message);
    return { status: 'terminal', message };
  }

  let response: Response;
  try {
    response = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-parable-workload': 'durable-pipeline',
        'x-parable-job-id': jobId
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 1000) || 'Internal pipeline request failed.';
    await markJobRetrying(jobId, message, attempt);
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
    await completeJob(jobId, body);
    return { status: 'completed', result: body };
  }

  const message = clean(
    typeof body === 'object' ? body?.error || body?.detail || JSON.stringify(body) : body,
    1200
  ) || ('HTTP ' + response.status);

  if (response.status === 429 || response.status >= 500) {
    await markJobRetrying(jobId, message, attempt);
    return {
      status: 'retry',
      message,
      delay_ms: Math.min(180000, 5000 * Math.pow(2, Math.max(0, attempt - 1)))
    };
  }

  if (
    response.status === 409 &&
    kind === 'shot-state' &&
    /previous|processed in order|scene must pass|pre-scene/i.test(message)
  ) {
    await markJobRetrying(jobId, message, attempt);
    return {
      status: 'retry',
      message,
      delay_ms: Math.min(60000, 2500 * Math.pow(2, Math.max(0, attempt - 1)))
    };
  }

  await failJob(jobId, message);
  return { status: 'terminal', message };
}
