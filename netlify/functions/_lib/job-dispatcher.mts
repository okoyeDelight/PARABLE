import { getContext } from '@netlify/functions';
import { AsyncWorkloadsClient } from '@netlify/async-workloads';
import { readDurableJob, type DurableJob, type JobKind } from './job-store.mts';
import {
  signInternalAuthorization,
  type ProjectAction,
  type SecurityActor
} from './security.mts';

export type DispatchResult = {
  backend: 'async-workloads' | 'netlify-background';
  event_id: string | null;
  primary_error: string | null;
};

const clean = (value: unknown, max = 800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function origin() {
  try {
    const context = getContext();
    const deployId = context.deploy?.id;
    const siteName = context.site?.name;
    if (deployId && siteName) return ('https://' + deployId + '--' + siteName + '.netlify.app').replace(/\/$/, '');
    if (context.site?.url) return context.site.url.replace(/\/$/, '');
  } catch {}

  const value =
    Netlify.env.get('DEPLOY_URL') ||
    Netlify.env.get('DEPLOY_PRIME_URL') ||
    Netlify.env.get('URL') ||
    '';
  return value.replace(/\/$/, '');
}

async function dispatchBackground(
  jobId: string,
  kind: JobKind,
  primaryError: string | null,
  knownJob?: DurableJob | null
): Promise<DispatchResult> {
  const base = origin();
  if (!base) throw new Error('No deployment origin is available for the background queue fallback.');

  const job = knownJob || await readDurableJob(jobId);
  if (!job?.authorization) throw new Error('Durable job has no trusted authorization context.');

  const actor: SecurityActor = {
    actor_id: job.authorization.actor_id,
    provider: job.authorization.provider,
    subject: job.authorization.subject,
    email: null,
    display_name: null,
    auth_mode: 'internal',
    internal: true
  };

  const internalAuth = await signInternalAuthorization({
    actor,
    projectId: job.project_id,
    action: job.authorization.action as ProjectAction,
    ttlSeconds: 300
  });

  const response = await fetch(base + '/.netlify/functions/pipeline-background', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-parable-dispatch': 'background-fallback',
      'x-parable-internal-auth': internalAuth
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

export async function dispatchDurableJob(
  jobId: string,
  kind: JobKind,
  knownJob?: DurableJob | null
): Promise<DispatchResult> {
  let primaryError: string | null = null;
  const defaultMode = Netlify.context?.deploy?.context === 'deploy-preview' ? 'background' : 'auto';
  const mode = clean(Netlify.env.get('PARABLE_QUEUE_MODE') || defaultMode, 40).toLowerCase();

  if (mode === 'background') {
    return dispatchBackground(
      jobId,
      kind,
      'Async Workloads is bypassed by PARABLE_QUEUE_MODE=background.',
      knownJob
    );
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

  return dispatchBackground(jobId, kind, primaryError, knownJob);
}
