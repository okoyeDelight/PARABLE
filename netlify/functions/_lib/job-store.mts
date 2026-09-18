import { getDeployStore, getStore } from '@netlify/blobs';

export type JobKind = 'scene-state' | 'shot-state' | 'story-understanding' | 'adaptation';
export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

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
};

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  const make = (name: string) => production
    ? getStore(name, { consistency: 'strong' })
    : getDeployStore(name);
  return {
    jobs: make('parable-jobs'),
    payloads: make('parable-job-payloads'),
    results: make('parable-job-results')
  };
}

const clean = (value: unknown, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createDurableJob(args: {
  kind: JobKind;
  projectId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
}) {
  const { jobs, payloads } = stores();
  const payloadJson = JSON.stringify(args.payload);
  const payloadHash = await sha256(payloadJson);
  const normalizedKey = clean(args.idempotencyKey, 240);
  const deterministic = normalizedKey
    ? await sha256([args.kind, args.projectId, normalizedKey].join('|'))
    : crypto.randomUUID().replaceAll('-', '');
  const id = 'job_' + deterministic.slice(0, 28);
  const key = 'job/' + id;
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
    completed_at: null
  };

  await Promise.all([
    payloads.setJSON('payload/' + id, args.payload),
    jobs.setJSON(key, job)
  ]);
  return { job, created: true, conflict: false };
}

export async function readDurableJob(jobId: string) {
  return stores().jobs.get('job/' + jobId, { type: 'json' }) as Promise<DurableJob | null>;
}

export async function readJobPayload(jobId: string) {
  return stores().payloads.get('payload/' + jobId, { type: 'json' }) as Promise<Record<string, any> | null>;
}

export async function markJobProcessing(jobId: string, attempts: number) {
  const { jobs } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const next: DurableJob = {
    ...current,
    status: 'processing',
    attempts: Math.max(current.attempts, attempts),
    updated_at: new Date().toISOString()
  };
  await jobs.setJSON('job/' + jobId, next);
  return next;
}

export async function completeJob(jobId: string, result: unknown) {
  const { jobs, results } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const resultRef = 'result/' + jobId;
  const now = new Date().toISOString();
  await results.setJSON(resultRef, result);
  const next: DurableJob = {
    ...current,
    status: 'succeeded',
    result_ref: resultRef,
    last_error: null,
    updated_at: now,
    completed_at: now
  };
  await jobs.setJSON('job/' + jobId, next);
  return next;
}

export async function failJob(jobId: string, error: unknown) {
  const { jobs } = stores();
  const current = await readDurableJob(jobId);
  if (!current) return null;
  const now = new Date().toISOString();
  const next: DurableJob = {
    ...current,
    status: 'failed',
    last_error: clean(error instanceof Error ? error.message : error, 1200),
    updated_at: now,
    completed_at: now
  };
  await jobs.setJSON('job/' + jobId, next);
  return next;
}

export async function readJobResult(job: DurableJob) {
  if (!job.result_ref) return null;
  return stores().results.get(job.result_ref, { type: 'json' });
}
