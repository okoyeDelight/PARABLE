import {
  asyncWorkloadFn,
  ErrorDoNotRetry,
  ErrorRetryAfterDelay,
  type AsyncWorkloadConfig,
  type AsyncWorkloadEvent
} from '@netlify/async-workloads';
import { processDurableJob } from './_lib/job-processor.mts';
import type { JobKind } from './_lib/job-store.mts';

type PipelineEvent = AsyncWorkloadEvent & {
  eventData: {
    jobId: string;
    kind: JobKind;
  };
};

const clean = (value: unknown, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export default asyncWorkloadFn<PipelineEvent>(async (event) => {
  const jobId = clean(event.eventData?.jobId, 96);
  const kind = clean(event.eventData?.kind, 40) as JobKind;

  if (!jobId || !kind) throw new ErrorDoNotRetry('Invalid PARABLE pipeline workload event.');

  const outcome = await processDurableJob({
    jobId,
    kind,
    attempt: Number(event.attempt || 0) + 1,
    executionId: event.eventId || null
  });

  if (outcome.status === 'completed' || outcome.status === 'busy') return;

  if (outcome.status === 'retry') {
    throw new ErrorRetryAfterDelay({
      message: outcome.message,
      retryDelay: outcome.delay_ms
    });
  }

  throw new ErrorDoNotRetry(outcome.message);
});

export const asyncWorkloadConfig: AsyncWorkloadConfig<PipelineEvent> = {
  events: ['parable.pipeline.process', 'parable.continuity.process'],
  maxRetries: 6,
  backoffSchedule: (attempt) => {
    const seconds = Math.min(300, 5 * Math.pow(3, attempt));
    return seconds + ' seconds';
  }
};
