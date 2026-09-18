import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';
import {
  claimTransactionalJob,
  ensureTransactionalJob,
  readTransactionalJob,
  transactionalStateMode,
  transitionTransactionalJob,
  TransactionalStateError
} from './transactional-state.mts';

export type JobKind = 'scene-state' | 'shot-state' | 'story-understanding' | 'adaptation' | 'film-critic' | 'keyframe-generate' | 'reference-profile' | 'scale-noop';
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
  authorization: {
    actor_id: string;
    provider: string;
    subject: string;
    workspace_id: string;
    role: string;
    action: string;
  } | null;
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
  if (production) return { production: true, prefix: '', storageProjectPrefix: 'prod:' };

  const deployId = String(context?.deploy?.id || Netlify.context?.deploy?.id || 'local')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);

  return {
    production: false,
    prefix: 'deploy/' + (deployId || 'local') + '/',
    storageProjectPrefix: 'preview:' + (deployId || 'local') + ':'
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

function logicalProjectId(storageProjectId: string) {
  const prefix = runtimeScope().storageProjectPrefix;
  return storageProjectId.startsWith(prefix)
    ? storageProjectId.slice(prefix.length)
    : null;
}

function jobFromRow(row: Record<string, any> | null): DurableJob | null {
  if (!row) return null;
  const projectId = logicalProjectId(clean(row.project_id, 240));
  if (!projectId) return null;

  const auth = row.auth_context && typeof row.auth_context === 'object'
    ? row.auth_context as Record<string, any>
    : null;

  return {
    id: clean(row.id, 96),
    kind: clean(row.kind, 80) as JobKind,
    project_id: projectId,
    status: clean(row.status, 40) as JobStatus,
    payload_hash: clean(row.payload_hash, 128),
    idempotency_key: clean(row.idempotency_key, 240) || null,
    attempts: Math.max(0, Math.floor(Number(row.attempts) || 0)),
    last_error: clean(row.last_error, 1200) || null,
    result_ref: clean(row.result_ref, 800) || null,
    created_at: clean(row.created_at, 80) || new Date().toISOString(),
    updated_at: clean(row.updated_at, 80) || new Date().toISOString(),
    completed_at: clean(row.completed_at, 80) || null,
    lease_token: clean(row.lease_token, 180) || null,
    lease_expires_at: clean(row.lease_expires_at, 80) || null,
    queue_event_id: clean(row.queue_event_id, 180) || null,
    authorization: auth ? {
      actor_id: clean(auth.actor_id,180),
      provider: clean(auth.provider,120),
      subject: clean(auth.subject,180),
      workspace_id: clean(auth.workspace_id,180),
      role: clean(auth.role,80),
      action: clean(auth.action,80)
    } : null
  };
}

async function mirrorJob(job: DurableJob | null) {
  if (!job) return;
  try {
    const { jobs, scope } = stores();
    await jobs.setJSON(scope.prefix + 'job/' + job.id, job);
  } catch {
    // PostgreSQL is authoritative. Blob job state is only an operational mirror.
  }
}

async function readBlobJob(jobId: string) {
  const { jobs, scope } = stores();
  return jobs.get(scope.prefix + 'job/' + jobId, { type: 'json' }) as Promise<DurableJob | null>;
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
  authorization?: DurableJob['authorization'];
}) {
  const { jobs, payloads, scope } = stores();
  const payloadJson = JSON.stringify(args.payload);
  const payloadHash = await sha256(payloadJson);
  const normalizedKey = clean(args.idempotencyKey, 240);
  const deterministic = normalizedKey
    ? await sha256([args.kind, args.projectId, normalizedKey].join('|'))
    : crypto.randomUUID().replaceAll('-', '');
  const id = 'job_' + deterministic.slice(0, 28);

  // Payload bytes are immutable and staged before the transactional row. If
  // the DB write fails, the only residue is an unreachable orphan payload.
  await payloads.setJSON(scope.prefix + 'payload/' + id, args.payload, { onlyIfNew: true } as any);

  if (transactionalStateMode() === 'postgres') {
    try {
      const ensured = await ensureTransactionalJob({
        id,
        kind: args.kind,
        projectId: args.projectId,
        workspaceId: args.authorization?.workspace_id || null,
        actorUserId: args.authorization?.actor_id || null,
        authContext: args.authorization || null,
        payloadHash,
        idempotencyKey: normalizedKey || null
      });
      const job = jobFromRow(ensured.job);
      if (!job) throw new Error('Transactional durable job returned outside the current deployment scope.');
      await mirrorJob(job);
      await recordJobEvent(job);
      return {
        job,
        created: ensured.created === true,
        conflict: false
      };
    } catch (error) {
      if (error instanceof TransactionalStateError && error.code === 'JOB_IDEMPOTENCY_CONFLICT') {
        const existing = jobFromRow(await readTransactionalJob(id).catch(() => null));
        if (existing) {
          return {
            job: existing,
            created: false,
            conflict: true,
            conflict_reason: 'The same idempotency key was reused with a different payload.'
          };
        }
      }
      throw error;
    }
  }

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
    queue_event_id: null,
    authorization: args.authorization || null
  };

  await jobs.setJSON(key, job, { onlyIfNew: true } as any);
  await recordJobEvent(job);
  return { job, created: true, conflict: false };
}

export async function readDurableJob(jobId: string) {
  if (transactionalStateMode() === 'postgres') {
    const job = jobFromRow(await readTransactionalJob(jobId));
    await mirrorJob(job);
    return job;
  }
  return readBlobJob(jobId);
}

export async function readJobPayload(jobId: string) {
  const { payloads, scope } = stores();
  return payloads.get(scope.prefix + 'payload/' + jobId, { type: 'json' }) as Promise<Record<string, any> | null>;
}

export async function markJobQueued(jobId: string, eventId?: string | null) {
  if (transactionalStateMode() === 'postgres') {
    const row = await transitionTransactionalJob({
      id: jobId,
      toStatus: 'queued',
      queueEventId: clean(eventId,180) || null
    });
    const job = jobFromRow(row);
    await mirrorJob(job);
    if (job) await recordJobEvent(job);
    return job;
  }

  const { jobs, scope } = stores();
  const current = await readBlobJob(jobId);
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
  if (transactionalStateMode() === 'postgres') {
    if (!leaseToken) throw new Error('PostgreSQL durable jobs require an explicit lease token.');
    const claimed = await claimTransactionalJob({
      id: jobId,
      leaseToken,
      attempt: attempts,
      leaseMs
    });
    const job = jobFromRow(claimed?.job || null);
    await mirrorJob(job);
    if (job && claimed?.claimed) await recordJobEvent(job);
    return job;
  }

  const { jobs, scope } = stores();
  const current = await readBlobJob(jobId);
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

export async function markJobRetrying(
  jobId: string,
  error: unknown,
  attempts: number,
  leaseToken?: string | null
) {
  if (transactionalStateMode() === 'postgres') {
    const row = await transitionTransactionalJob({
      id: jobId,
      toStatus: 'retrying',
      leaseToken,
      attempt: attempts,
      lastError: clean(error instanceof Error ? error.message : error,1200)
    });
    const job = jobFromRow(row);
    await mirrorJob(job);
    if (job) await recordJobEvent(job);
    return job;
  }

  const { jobs, scope } = stores();
  const current = await readBlobJob(jobId);
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

export async function completeJob(jobId: string, result: unknown, leaseToken?: string | null) {
  const { jobs, results, scope } = stores();
  const resultRef = scope.prefix + 'result/' + jobId;

  // Large/structured results stay in Blobs. The DB transition publishes only
  // the immutable reference after the payload exists.
  await results.setJSON(resultRef, result);

  if (transactionalStateMode() === 'postgres') {
    const row = await transitionTransactionalJob({
      id: jobId,
      toStatus: 'succeeded',
      leaseToken,
      resultRef
    });
    const job = jobFromRow(row);
    await mirrorJob(job);
    if (job) await recordJobEvent(job);
    return job;
  }

  const current = await readBlobJob(jobId);
  if (!current) return null;
  const now = new Date().toISOString();
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

export async function failJob(jobId: string, error: unknown, leaseToken?: string | null) {
  if (transactionalStateMode() === 'postgres') {
    const row = await transitionTransactionalJob({
      id: jobId,
      toStatus: 'failed',
      leaseToken,
      lastError: clean(error instanceof Error ? error.message : error,1200)
    });
    const job = jobFromRow(row);
    await mirrorJob(job);
    if (job) await recordJobEvent(job);
    return job;
  }

  const { jobs, scope } = stores();
  const current = await readBlobJob(jobId);
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
      authoritative_state: transactionalStateMode() === 'postgres' ? 'postgres' : 'blobs',
      jobs_observed: current.length,
      status_counts,
      kind_counts,
      jobs_with_retries: retries,
      recent_failures: current.filter((row) => row.status === 'failed').slice(0, 20)
    };
  } catch {
    return {
      window: 'approximately last 2 UTC hours',
      authoritative_state: transactionalStateMode() === 'postgres' ? 'postgres' : 'blobs',
      jobs_observed: 0,
      status_counts: {},
      kind_counts: {},
      jobs_with_retries: 0,
      recent_failures: []
    };
  }
}
