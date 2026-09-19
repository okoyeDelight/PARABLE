import { readDurableJob, readJobResult } from './_lib/job-store.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders
  }
});

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

function recommendedPollMs(status: string, attempts: number) {
  if (status === 'queued') return 2200;
  if (status === 'processing') return 1600;
  if (status === 'retrying') return Math.min(8000, 3500 + Math.max(0, attempts - 1) * 800);
  return 0;
}

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const jobId = clean(url.searchParams.get('id'), 96);
  if (!jobId || !safeId(jobId)) return json({ error: 'A valid job id is required.' }, 400);

  const job = await readDurableJob(jobId);
  if (!job) return json({ error: 'Job not found.' }, 404);

  try {
    await authorizeProject(request, job.project_id, 'project:read');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  const includeResult = url.searchParams.get('result') !== '0';
  const result = includeResult && job.status === 'succeeded' ? await readJobResult(job) : null;
  const pollAfterMs = recommendedPollMs(job.status, job.attempts);

  const { authorization, ...publicJob } = job;
  return json({
    job: publicJob,
    result,
    poll_after_ms: pollAfterMs
  }, 200, pollAfterMs ? { 'retry-after': String(Math.max(1, Math.ceil(pollAfterMs / 1000))) } : {});
};

export const config = {
  path: '/api/job-status',
  rateLimit: {
    windowLimit: 30000,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
