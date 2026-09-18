import {
  asyncWorkloadFn,
  ErrorDoNotRetry,
  ErrorRetryAfterDelay,
  type AsyncWorkloadConfig,
  type AsyncWorkloadEvent
} from '@netlify/async-workloads';
import {
  completeJob,
  failJob,
  markJobProcessing,
  markJobRetrying,
  readDurableJob,
  readJobPayload
} from './_lib/job-store.mts';

type ContinuityEvent = AsyncWorkloadEvent & {
  eventData: {
    jobId: string;
    kind: 'scene-state' | 'shot-state' | 'story-understanding' | 'adaptation' | 'film-critic';
  };
};

const clean = (value: unknown, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function origin() {
  const value =
    Netlify.env.get('DEPLOY_PRIME_URL') ||
    Netlify.env.get('URL') ||
    Netlify.env.get('PARABLE_PUBLIC_URL') ||
    '';
  return value.replace(/\/$/, '');
}

export default asyncWorkloadFn<ContinuityEvent>(async (event) => {
  const jobId = clean(event.eventData?.jobId, 96);
  const kind = clean(event.eventData?.kind, 40);

  if (!jobId || !['scene-state', 'shot-state', 'story-understanding', 'adaptation', 'film-critic'].includes(kind)) {
    throw new ErrorDoNotRetry('Invalid PARABLE continuity workload event.');
  }

  const existing = await readDurableJob(jobId);
  if (!existing) throw new ErrorDoNotRetry('Durable job record was not found.');
  if (existing.status === 'succeeded') return;

  const payload = await readJobPayload(jobId);
  if (!payload) {
    await failJob(jobId, 'Job payload was not found.');
    throw new ErrorDoNotRetry('Job payload was not found.');
  }

  await markJobProcessing(jobId, Number(event.attempt || 0) + 1);

  const base = origin();
  if (!base) {
    await failJob(jobId, 'No deployment origin is available for internal workload execution.');
    throw new ErrorDoNotRetry('No deployment origin is available.');
  }

  const path = kind === 'scene-state'
    ? '/api/scene-state'
    : kind === 'shot-state'
      ? '/api/shot-state'
      : kind === 'story-understanding'
        ? '/api/understand'
        : kind === 'film-critic'
          ? '/api/director-critic'
          : '/api/adapt';
  let response: Response;

  try {
    response = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-parable-workload': 'continuity',
        'x-parable-job-id': jobId
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 1000);
    await markJobRetrying(jobId, message, Number(event.attempt || 0) + 1);
    throw new ErrorRetryAfterDelay({
      message: 'Internal pipeline call failed: ' + message,
      retryDelay: Math.min(120000, 3000 * Math.pow(2, Number(event.attempt || 0)))
    });
  }

  const text = await response.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}

  if (response.ok) {
    await completeJob(jobId, body);
    return;
  }

  const message = clean(
    typeof body === 'object' ? body?.error || body?.detail || JSON.stringify(body) : body,
    1200
  ) || ('HTTP ' + response.status);

  if (response.status === 429 || response.status >= 500) {
    await markJobRetrying(jobId, message, Number(event.attempt || 0) + 1);
    throw new ErrorRetryAfterDelay({
      message,
      retryDelay: Math.min(180000, 5000 * Math.pow(2, Number(event.attempt || 0)))
    });
  }

  if (
    response.status === 409 &&
    kind === 'shot-state' &&
    /previous|processed in order|scene must pass|pre-scene/i.test(message)
  ) {
    await markJobRetrying(jobId, message, Number(event.attempt || 0) + 1);
    throw new ErrorRetryAfterDelay({
      message,
      retryDelay: Math.min(60000, 2500 * Math.pow(2, Number(event.attempt || 0)))
    });
  }

  await failJob(jobId, message);
  throw new ErrorDoNotRetry(message);
});

export const asyncWorkloadConfig: AsyncWorkloadConfig<ContinuityEvent> = {
  events: ['parable.pipeline.process', 'parable.continuity.process'],
  maxRetries: 6,
  backoffSchedule: (attempt) => {
    const seconds = Math.min(300, 5 * Math.pow(3, attempt));
    return seconds + ' seconds';
  }
};
