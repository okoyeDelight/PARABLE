import { processDurableJob } from './_lib/job-processor.mts';
import type { JobKind } from './_lib/job-store.mts';

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async (request: Request) => {
  if (request.method !== 'POST') return;

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const jobId = clean(body.jobId, 96);
  const kind = clean(body.kind, 40) as JobKind;
  if (!jobId || !kind) return;

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
