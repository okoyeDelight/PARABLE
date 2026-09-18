import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';

export type JobKind = 'scene-state' | 'shot-state' | 'story-understanding' | 'adaptation' | 'film-critic' | 'keyframe-generate' | 'scale-noop';
export type JobStatus = 'queued' | 'processing' | 'retrying' | 'succeeded' | 'failed';

export type DurableJob = {
  id: string;
  kind: JobKind;
  project_id: string;
  status: JobStatus;
  payload_hash: string;
  idempotency_key: string | null;
  attempts: number;
  last_error: string | null;
  result_ref: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  queue_event_id: string | null;
};

type JobEvent = {
  id: string;
  job_id: string;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  at: string;
  error_class: string | null;
};

function runtimeScope() {
  let context: any = null;
  try { context = getContext(); } catch {}

  const deployContext = context?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  const production = deployContext === 'production';
  if (production) return { production: true, prefix: '' };

  const deployId = String(context?.deploy?.id || Netlify.context?.deploy?.id || 'local')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);

  return {
    production: false,
    prefix: 'deploy/' + (deployId || 'local') + '/'
  };
}

function stores() {
  const scope = runtimeScope();
  const suffix = scope.production ? '' : '-sandbox';
  return {
    scope,
    jobs: getStore('parable-jobs' + suffix, { consistency: 'strong' }),
    payloads: getStore('parable-job-payloads' + suffix, { consistency: 'strong' }),
    results: getStore('parable-job-results' + suffix, { consistency: 'strong' }),
    events: getStore('parable-job-events' + suffix, { consistency: 'strong' })
  };
}

function scopedKey(path: string) {
  return stores().scope.prefix + path;
}

const clean = (value: unknown, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hourPrefix(date: Date) {
  return [
    'events',
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0')
  ].join('/') + '/';
}

function classifyJobError(error: unknown) {
  const value = clean(error instanceof Error ? error.message : error, 500).toLowerCase();
  if (!value) return null;
  if (value.includes('429') || value.includes('rate limit')) return 'rate-limit';
  if (value.includes('timeout') || value.includes('abort')) return 'timeout';
  if (/\b5\d\d\b/.test(value)) return 'upstream-5xx';
  if (value.includes('previous') || value.includes('processed in order')) return 'dependency-wait';
  if (value.includes('privacy') || value.includes('zdr')) return 'privacy-policy';
  return 'other';
}

async function recordJobEvent(job: DurableJob) {
  try {
    const { events, scope } = stores();
    const now = new Date();
    const at = now.toISOString();
    const event: JobEvent = {
      id: 'jobevt_' + crypto.randomUUID().replaceAll('-', ''),
      job_id: job.id,
      kind: job.kind,
      status: job.status,
      attempts: job.attempts,
      at,
      error_class: classifyJobError(job.last_error)
    };
    const key = scope.prefix + hourPrefix(now) + at.replace(/[:.]/g, '-') + '-' + event.id.slice(-12);
    await events.setJSON(key, event);
  } catch {
    // Operational telemetry must never make a production job fail.
  }
}

export async function createDurableJob(args: {
  kind: JobKind;
  projectId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
}) {
  const { jobs, payloads, scope } = stores();
  const payloadJson = JSON.stringify(args.payload);
  const payloadHash = await sha256(payloadJson);
  const normalizedKey = clean(args.idempotencyKey, 240);
  const deterministic = normalizedKey
    ? await sha256([args.kind, args.projectId, normalizedKey].join('|'))
    : crypto.randomUUID().replaceAll('-', '');
  const id = 'job_' + deterministic.slice(0, 28);
  const key = scope.prefix + 'job/' + id;
  const existing = await jobs.get(key, { type: 'json' }) as DurableJob | null;

  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      return {
        job: existing,
        created: false,
        conflict: true,
        conflict_reason: 'The same idempotency key was reused with a different payload.'
      };
    }
    return { job: existing, created: false, conflict: false };
  }

  const now = new Date().toISOString();
  const job: DurableJob = {
    id,
    kind: args.kind,
    project_id: args.projectId,
    status: 'queued',
    payload_hash: payloadHash,
    idempotency_key: normalizedKey || null,
    attempts: 0,
    last_error: null,
    result_ref: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    lease_token: null,
    lease_expires_at: null,
    queue_event_id: null
  };

  await Promise.all([
    payloads.setJSON(scope.prefix + 'payload/' + id, args.payload),
    jobs.setJSON(key, job)
  ]);
  await recordJobEvent(job);
  return { job, created: true, conflict: false };
}

export async function readDurableJob(jobId: string) {
  const { jobs, scope } = stores();
  return jobs.get(scope.prefix + 'job/' + jobId, { type: 'json' }) as Promise<DurableJob | null>;
}

export async function readJobPayload(jobId: string) {
  const { payloads, scope } = stores();
  return payloads.get(scope.prefix + 'payload/' + jobId, { type: 'json' }) as Promise<Record<string, any> | null>;
}

export async function markJobQueued(jobId: string, eventId?: string | null) {
  const { jobs, scope } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const next: DurableJob = {
    ...current,
    status: 'queued',
    queue_event_id: clean(eventId, 180) || current.queue_event_id || null,
    updated_at: new Date().toISOString()
  };
  await jobs.setJSON(scope.prefix + 'job/' + jobId, next);
  await recordJobEvent(next);
  return next;
}

export async function markJobProcessing(jobId: string, attempts: number, leaseToken?: string, leaseMs = 120000) {
  const { jobs, scope } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const now = new Date();
  const next: DurableJob = {
    ...current,
    status: 'processing',
    attempts: Math.max(current.attempts, attempts),
    completed_at: null,
    lease_token: leaseToken || current.lease_token || null,
    lease_expires_at: leaseToken ? new Date(now.getTime() + leaseMs).toISOString() : current.lease_expires_at || null,
    updated_at: now.toISOString()
  };
  await jobs.setJSON(scope.prefix + 'job/' + jobId, next);
  await recordJobEvent(next);
  return next;
}

export async function markJobRetrying(jobId: string, error: unknown, attempts: number) {
  const { jobs, scope } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const next: DurableJob = {
    ...current,
    status: 'retrying',
    attempts: Math.max(current.attempts, attempts),
    last_error: clean(error instanceof Error ? error.message : error, 1200),
    completed_at: null,
    lease_token: null,
    lease_expires_at: null,
    updated_at: new Date().toISOString()
  };
  await jobs.setJSON(scope.prefix + 'job/' + jobId, next);
  await recordJobEvent(next);
  return next;
}

export async function completeJob(jobId: string, result: unknown) {
  const { jobs, results, scope } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const resultRef = scope.prefix + 'result/' + jobId;
  const now = new Date().toISOString();
  await results.setJSON(resultRef, result);
  const next: DurableJob = {
    ...current,
    status: 'succeeded',
    result_ref: resultRef,
    last_error: null,
    updated_at: now,
    completed_at: now,
    lease_token: null,
    lease_expires_at: null
  };
  await jobs.setJSON(scope.prefix + 'job/' + jobId, next);
  await recordJobEvent(next);
  return next;
}

export async function failJob(jobId: string, error: unknown) {
  const { jobs, scope } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const now = new Date().toISOString();
  const next: DurableJob = {
    ...current,
    status: 'failed',
    last_error: clean(error instanceof Error ? error.message : error, 1200),
    updated_at: now,
    completed_at: now,
    lease_token: null,
    lease_expires_at: null
  };
  await jobs.setJSON(scope.prefix + 'job/' + jobId, next);
  await recordJobEvent(next);
  return next;
}

export async function readJobResult(job: DurableJob) {
  if (!job.result_ref) return null;
  return stores().results.get(job.result_ref, { type: 'json' });
}

export async function readJobHealth() {
  try {
    const { events, scope } = stores();
    const now = new Date();
    const previousHour = new Date(now.getTime() - 60 * 60 * 1000);
    const prefixes = [...new Set([
      scope.prefix + hourPrefix(now),
      scope.prefix + hourPrefix(previousHour)
    ])];
    const rows: JobEvent[] = [];

    for (const prefix of prefixes) {
      const { blobs } = await events.list({ prefix });
      const newest = blobs.slice(-500);
      const values = await Promise.all(
        newest.map(({ key }) => events.get(key, { type: 'json' }) as Promise<JobEvent | null>)
      );
      rows.push(...values.filter(Boolean) as JobEvent[]);
    }

    const recent = rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
    const latestByJob = new Map<string, JobEvent>();
    for (const row of recent) {
      if (!latestByJob.has(row.job_id)) latestByJob.set(row.job_id, row);
    }

    const current = [...latestByJob.values()];
    const status_counts: Record<string, number> = {};
    const kind_counts: Record<string, number> = {};
    let retries = 0;
    for (const row of current) {
      status_counts[row.status] = (status_counts[row.status] || 0) + 1;
      kind_counts[row.kind] = (kind_counts[row.kind] || 0) + 1;
      if (row.status === 'retrying' || row.attempts > 1) retries += 1;
    }

    return {
      window: 'approximately last 2 UTC hours',
      storage_scope: scope.production ? 'production' : scope.prefix,
      jobs_observed: current.length,
      status_counts,
      kind_counts,
      jobs_with_retries: retries,
      recent_failures: current.filter((row) => row.status === 'failed').slice(0, 20)
    };
  } catch {
    return {
      window: 'approximately last 2 UTC hours',
      jobs_observed: 0,
      status_counts: {},
      kind_counts: {},
      jobs_with_retries: 0,
      recent_failures: []
    };
  }
}
