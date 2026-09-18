import { processDurableJob } from './_lib/job-processor.mts';
import { readDurableJob, type JobKind } from './_lib/job-store.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async (request: Request) => {
  if (request.method !== 'POST') return;

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const jobId = clean(body.jobId, 96);
  const kind = clean(body.kind, 40) as JobKind;
  if (!jobId || !kind) return;

  const job = await readDurableJob(jobId);
  if (!job || job.kind !== kind || !job.authorization) {
    return new Response(JSON.stringify({ error: 'Durable job was not found or did not match the requested kind.' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  try {
    const access = await authorizeProject(
      request,
      job.project_id,
      job.authorization.action as any
    );
    if (!access.actor.internal) {
      return new Response(JSON.stringify({ error: 'Background worker dispatch requires trusted internal authorization.' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
  } catch (error) {
    const handled = securityErrorResponse(error);
    return new Response(JSON.stringify(handled?.body || { error: 'Background worker authorization failed.' }), {
      status: handled?.status || 403,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  for (let attempt = 1; attempt <= 6; attempt++) {
    const outcome = await processDurableJob({
      jobId,
      kind,
      attempt,
      executionId: 'background-' + jobId + '-' + attempt
    });

    if (outcome.status === 'completed' || outcome.status === 'terminal') return;

    if (outcome.status === 'busy') {
      await sleep(1500);
      continue;
    }

    if (outcome.status === 'retry') {
      await sleep(Math.min(outcome.delay_ms, 120000));
    }
  }
};
