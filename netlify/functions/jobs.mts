import { AsyncWorkloadsClient } from '@netlify/async-workloads';
import {
  createDurableJob,
  failJob,
  readDurableJob,
  readJobResult,
  type JobKind
} from './_lib/job-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const supported = new Set<JobKind>(['scene-state', 'shot-state']);

export default async (request: Request) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const jobId = clean(url.searchParams.get('id'), 96);
    if (!jobId || !safeId(jobId)) return json({ error: 'A valid job id is required.' }, 400);

    const job = await readDurableJob(jobId);
    if (!job) return json({ error: 'Job not found.' }, 404);

    const includeResult = url.searchParams.get('result') !== '0';
    const result = includeResult && job.status === 'succeeded' ? await readJobResult(job) : null;
    return json({ job, result });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const kind = clean(body.kind, 40) as JobKind;
  const payload = body.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {};
  const projectId = clean(payload.projectId || body.projectId, 96);
  const idempotencyKey = clean(request.headers.get('idempotency-key') || body.idempotencyKey, 240);

  if (!supported.has(kind)) {
    return json({ error: 'kind must be scene-state or shot-state.' }, 400);
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
  if (shouldDispatch) {
    try {
      const client = new AsyncWorkloadsClient();
      await client.send('parable.continuity.process', {
        data: {
          jobId: created.job.id,
          kind
        }
      });
    } catch (error) {
      await failJob(created.job.id, error);
      return json({
        error: 'The durable workload could not be queued.',
        job_id: created.job.id,
        detail: clean(error instanceof Error ? error.message : error, 600)
      }, 503);
    }
  }

  const current = await readDurableJob(created.job.id) || created.job;
  return json({
    job: current,
    accepted: true,
    deduplicated: !created.created,
    poll: '/api/jobs?id=' + current.id
  }, created.created ? 202 : 200);
};

export const config = {
  path: '/api/jobs',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
