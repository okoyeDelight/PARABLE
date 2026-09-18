import { AsyncWorkloadsClient } from '@netlify/async-workloads';
import type { JobKind } from './job-store.mts';

export type DispatchResult = {
  backend: 'async-workloads' | 'netlify-background';
  event_id: string | null;
  primary_error: string | null;
};

const clean = (value: unknown, max = 800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function origin() {
  const value =
    Netlify.env.get('DEPLOY_URL') ||
    Netlify.env.get('DEPLOY_PRIME_URL') ||
    Netlify.env.get('URL') ||
    '';
  return value.replace(/\/$/, '');
}

async function dispatchBackground(jobId: string, kind: JobKind, primaryError: string | null): Promise<DispatchResult> {
  const base = origin();
  if (!base) throw new Error('No deployment origin is available for the background queue fallback.');

  const response = await fetch(base + '/.netlify/functions/pipeline-background', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-parable-dispatch': 'background-fallback'
    },
    body: JSON.stringify({ jobId, kind })
  });

  if (!response.ok && response.status !== 202) {
    const text = clean(await response.text().catch(() => ''), 600);
    throw new Error('Background queue fallback rejected the job' + (text ? ': ' + text : '.'));
  }

  return {
    backend: 'netlify-background',
    event_id: 'background:' + jobId,
    primary_error: primaryError
  };
}

export async function dispatchDurableJob(jobId: string, kind: JobKind): Promise<DispatchResult> {
  let primaryError: string | null = null;
  const mode = clean(Netlify.env.get('PARABLE_QUEUE_MODE') || 'auto', 40).toLowerCase();

  if (mode === 'background') {
    return dispatchBackground(jobId, kind, 'Async Workloads is bypassed by PARABLE_QUEUE_MODE=background.');
  }

  try {
    const client = new AsyncWorkloadsClient();
    const sent = await client.send('parable.pipeline.process', {
      data: { jobId, kind }
    });

    if (sent?.sendStatus && sent.sendStatus !== 'succeeded') {
      throw new Error('Async Workloads router did not acknowledge the event.');
    }

    return {
      backend: 'async-workloads',
      event_id: sent?.eventId || null,
      primary_error: null
    };
  } catch (error) {
    primaryError = clean(error instanceof Error ? error.message : error, 800) || 'Async Workloads dispatch failed.';
    if (mode === 'async') throw error;
  }

  return dispatchBackground(jobId, kind, primaryError);
}
