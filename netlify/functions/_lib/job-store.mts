import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';
import {
  claimTransactionalJob,
  ensureTransactionalJob,
  readTransactionalJob,
  storageProjectId,
  transactionalStateMode,
  transitionTransactionalJob,
  TransactionalStateError
} from './transactional-state.mts';

export type JobKind =
  | 'scene-state'
  | 'shot-state'
  | 'story-understanding'
  | 'adaptation'
  | 'film-critic'
  | 'keyframe-generate'
  | 'reference-profile'
  | 'scale-noop';

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

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

const clean = (value: unknown, max = 500) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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

function jobKey(jobId: string) {
  return stores().scope.prefix + 'job/' + jobId;
}

function payloadKey(jobId: string) {
  return stores().scope.prefix + 'payload/' + jobId;
}

function currentStorageProjectPrefix() {
  return storageProjectId('');
}

function logicalProjectId(storedProjectId: unknown) {
  const stored = clean(storedProjectId, 240);
  const prefix = currentStorageProjectPrefix();
  return stored.startsWith(prefix) ? stored.slice(prefix.length) : null;
}

function normalizeTransactionalJob(row: Record<string, any> | null): DurableJob | null {
  if (!row) return null;
  const logicalProject = logicalProjectId(row.project_id);
  if (!logicalProject) return null;

  const auth = row.auth_context && typeof row.auth_context === 'object'
    ? row.auth_context
    : null;

  return {
    id: clean(row.id, 180),
    kind: clean(row.kind, 80) as JobKind,
    project_id: logicalProject,
    status: clean(row.status, 40) as JobStatus,
    payload_hash: clean(row.payload_hash, 64),
    idempotency_key: clean(row.idempotency_key, 240) || null,
    attempts: Math.max(0, Math.floor(Number(row.attempts) || 0)),
    last_error: clean(row.last_error, 1200) || null,
    result_ref: clean(row.result_ref, 600) || null,
    created_at: clean(row.created_at, 80) || new Date().toISOString(),
    updated_at: clean(row.updated_at, 80) || new Date().toISOString(),
    completed_at: clean(row.completed_at, 80) || null,
    lease_token: clean(row.lease_token, 180) || null,
    lease_expires_at: clean(row.lease_expires_at, 80) || null,
    queue_event_id: clean(row.queue_event_id, 180) || null,
    authorization: auth ? {
      actor_id: clean(auth.actor_id || row.actor_user_id, 180),
      provider: clean(auth.provider, 80),
      subject: clean(auth.subject, 240),
      workspace_id: clean(auth.workspace_id || row.workspace_id, 180),
      role: clean(auth.role, 80),
      action: clean(auth.action, 120)
    } : null
  };
}

async function mirrorJob(job: DurableJob | null) {
  if (!job) return;
  try {
    await stores().jobs.setJSON(jobKey(job.id), job);
  } catch {
    // PostgreSQL is authoritative in transactional mode. Blob job records are
    // compatibility/observability mirrors only.
  }
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

async function mirrorAndRecord(job: DurableJob | null) {
  if (!job) return job;
  await Promise.allSettled([mirrorJob(job), recordJobEvent(job)]);
  return job;
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
  const deterministicBasis = normalizedKey
    ? [args.kind, storageProjectId(args.projectId), normalizedKey].join('|')
    : crypto.randomUUID().replaceAll('-', '');
  const deterministic = normalizedKey ? await sha256(deterministicBasis) : deterministicBasis;
  const id = 'job_' + deterministic.slice(0, 28);

  // Immutable payload first. If the transactional job commit later fails, this
  // is only an orphan blob and cannot be executed without an authoritative job.
  await payloads.setJSON(payloadKey(id), args.payload, { onlyIfNew: true } as any);

  if (transactionalStateMode() === 'postgres') {
    try {
      const state = await ensureTransactionalJob({
        id,
        kind: args.kind,
        projectId: args.projectId,
        workspaceId: args.authorization?.workspace_id || null,
        actorUserId: args.authorization?.actor_id || null,
        authContext: args.authorization || null,
        payloadHash,
        idempotencyKey: normalizedKey || null
      });

      const job = normalizeTransactionalJob(state.job);
      if (!job) {
        throw new Error('Transactional durable-job state resolved outside the current deployment scope.');
      }
      // PostgreSQL already records the authoritative created event. Do not
      // block queue acceptance on duplicate Blob mirrors/telemetry; workers and
      // readers may refresh those mirrors later without affecting correctness.
      return {
        job,
        created: state.created === true,
        conflict: false
      };
    } catch (error) {
      if (
        error instanceof TransactionalStateError &&
        error.code === 'JOB_IDEMPOTENCY_CONFLICT'
      ) {
        const existing = await readDurableJob(id).catch(() => null);
        return {
          job: existing || {
            id,
            kind: args.kind,
            project_id: args.projectId,
            status: 'queued' as const,
            payload_hash: payloadHash,
            idempotency_key: normalizedKey || null,
            attempts: 0,
            last_error: null,
            result_ref: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null,
            lease_token: null,
            lease_expires_at: null,
            queue_event_id: null,
            authorization: args.authorization || null
          },
          created: false,
          conflict: true,
          conflict_reason: 'The same idempotency key was reused with a different payload.'
        };
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
  return { job: (await jobs.get(key, { type: 'json' }) as DurableJob | null) || job, created: true, conflict: false };
}

export async function readDurableJob(jobId: string) {
  if (transactionalStateMode() === 'postgres') {
    const job = normalizeTransactionalJob(await readTransactionalJob(jobId));
    await mirrorJob(job);
    return job;
  }

  const { jobs } = stores();
  return jobs.get(jobKey(jobId), { type: 'json' }) as Promise<DurableJob | null>;
}

export async function readJobPayload(jobId: string) {
  const { payloads } = stores();
  return payloads.get(payloadKey(jobId), { type: 'json' }) as Promise<Record<string, any> | null>;
}

export async function markJobQueued(jobId: string, eventId?: string | null) {
  if (transactionalStateMode() === 'postgres') {
    const current = await readDurableJob(jobId);
    if (!current) return null;

    // The background worker can win the race and claim the job before the
    // dispatcher stores its queue event. Never reset a processing lease.
    if (current.status !== 'queued') return current;

    const next = normalizeTransactionalJob(await transitionTransactionalJob({
      id: jobId,
      toStatus: 'queued',
      queueEventId: clean(eventId, 180) || null
    }));
    return mirrorAndRecord(next);
  }

  const { jobs } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const next: DurableJob = {
    ...current,
    status: 'queued',
    queue_event_id: clean(eventId, 180) || current.queue_event_id || null,
    updated_at: new Date().toISOString()
  };
  await jobs.setJSON(jobKey(jobId), next);
  await recordJobEvent(next);
  return next;
}

export async function claimJobProcessing(
  jobId: string,
  attempts: number,
  leaseToken?: string,
  leaseMs = 120000
) {
  if (transactionalStateMode() === 'postgres') {
    if (!leaseToken) throw new Error('A PostgreSQL durable-job claim requires a lease token.');

    const maxGlobalActive = Math.max(
      1,
      Math.min(2000, Math.floor(Number(Netlify.env.get('PARABLE_JOB_MAX_ACTIVE')) || 250))
    );
    const maxProjectActive = Math.max(
      1,
      Math.min(100, Math.floor(Number(Netlify.env.get('PARABLE_JOB_MAX_PROJECT_ACTIVE')) || 8))
    );

    const claimed = await claimTransactionalJob({
      id: jobId,
      leaseToken,
      attempt: Math.max(1, Math.floor(Number(attempts) || 1)),
      leaseMs,
      maxGlobalActive,
      maxProjectActive
    });

    const job = normalizeTransactionalJob(claimed?.job || null);
    await mirrorJob(job);
    if (claimed?.claimed && job) await recordJobEvent(job);

    return {
      claimed: claimed?.claimed === true,
      job,
      reason: clean(claimed?.reason, 80) || null,
      retry_after_ms: Math.max(0, Math.floor(Number(claimed?.retry_after_ms) || 0)),
      active: Math.max(0, Math.floor(Number(claimed?.active) || 0)),
      limit: Math.max(0, Math.floor(Number(claimed?.limit) || 0)),
      backend: 'postgres' as const
    };
  }

  const { jobs } = stores();
  const current = await readDurableJob(jobId);
  if (!current) {
    return {
      claimed: false,
      job: null,
      reason: 'missing',
      retry_after_ms: 0,
      active: 0,
      limit: 0,
      backend: 'blobs' as const
    };
  }

  const now = new Date();
  const next: DurableJob = {
    ...current,
    status: 'processing',
    attempts: Math.max(current.attempts, attempts),
    completed_at: null,
    lease_token: leaseToken || current.lease_token || null,
    lease_expires_at: leaseToken
      ? new Date(now.getTime() + leaseMs).toISOString()
      : current.lease_expires_at || null,
    updated_at: now.toISOString()
  };
  await jobs.setJSON(jobKey(jobId), next);
  await recordJobEvent(next);

  return {
    claimed: true,
    job: next,
    reason: 'claimed',
    retry_after_ms: 0,
    active: 0,
    limit: 0,
    backend: 'blobs' as const
  };
}

export async function markJobProcessing(
  jobId: string,
  attempts: number,
  leaseToken?: string,
  leaseMs = 120000
) {
  const result = await claimJobProcessing(jobId, attempts, leaseToken, leaseMs);
  return result.claimed ? result.job : null;
}

export async function markJobRetrying(
  jobId: string,
  error: unknown,
  attempts: number,
  leaseToken?: string | null
) {
  if (transactionalStateMode() === 'postgres') {
    const current = await readDurableJob(jobId);
    if (!current) return null;
    if (['succeeded','failed','cancelled'].includes(current.status)) return current;

    const next = normalizeTransactionalJob(await transitionTransactionalJob({
      id: jobId,
      toStatus: 'retrying',
      leaseToken: leaseToken || current.lease_token,
      attempt: Math.max(current.attempts, Math.floor(Number(attempts) || 0)),
      lastError: clean(error instanceof Error ? error.message : error, 1200)
    }));
    return mirrorAndRecord(next);
  }

  const { jobs } = stores();
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
  await jobs.setJSON(jobKey(jobId), next);
  await recordJobEvent(next);
  return next;
}

export async function completeJob(jobId: string, result: unknown, leaseToken?: string | null) {
  const { jobs, results } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  if (current.status === 'succeeded') return current;

  const resultRef = stores().scope.prefix + 'result/' + jobId;
  await results.setJSON(resultRef, result);

  if (transactionalStateMode() === 'postgres') {
    const next = normalizeTransactionalJob(await transitionTransactionalJob({
      id: jobId,
      toStatus: 'succeeded',
      leaseToken: leaseToken || current.lease_token,
      attempt: current.attempts,
      resultRef
    }));
    return mirrorAndRecord(next);
  }

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
  await jobs.setJSON(jobKey(jobId), next);
  await recordJobEvent(next);
  return next;
}

export async function failJob(jobId: string, error: unknown, leaseToken?: string | null) {
  const { jobs } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  if (['succeeded','failed','cancelled'].includes(current.status)) return current;

  if (transactionalStateMode() === 'postgres') {
    const next = normalizeTransactionalJob(await transitionTransactionalJob({
      id: jobId,
      toStatus: 'failed',
      leaseToken: leaseToken || current.lease_token,
      attempt: current.attempts,
      lastError: clean(error instanceof Error ? error.message : error, 1200)
    }));
    return mirrorAndRecord(next);
  }

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
  await jobs.setJSON(jobKey(jobId), next);
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
      authoritative_backend: transactionalStateMode() === 'postgres' ? 'postgres' : 'blobs',
      jobs_observed: current.length,
      status_counts,
      kind_counts,
      jobs_with_retries: retries,
      recent_failures: current.filter((row) => row.status === 'failed').slice(0, 20)
    };
  } catch {
    return {
      window: 'approximately last 2 UTC hours',
      authoritative_backend: transactionalStateMode() === 'postgres' ? 'postgres' : 'blobs',
      jobs_observed: 0,
      status_counts: {},
      kind_counts: {},
      jobs_with_retries: 0,
      recent_failures: []
    };
  }
}
