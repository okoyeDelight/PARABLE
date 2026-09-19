import {
  createDurableJob,
  readDurableJob,
  readJobResult
} from './_lib/job-store.mts';
import { recoverStalledJobs } from './_lib/job-recovery.mts';
import {
  authenticateRequest,
  createProjectAccess
} from './_lib/security.mts';
import { transactionalStateMode } from './_lib/transactional-state.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (Netlify.context?.deploy?.context !== 'deploy-preview') return json({ error: 'Not found' }, 404);
  if (transactionalStateMode() !== 'postgres') {
    return json({ ok: false, error: 'PostgreSQL transactional state is not active.' }, 503);
  }

  const token = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const projectId = 'recovery_probe_' + token;
  const actor = await authenticateRequest(request);
  const access = await createProjectAccess(projectId, actor, 'ws_recovery_probe');

  const authorization = {
    actor_id: actor.actor_id,
    provider: actor.provider,
    subject: actor.subject,
    workspace_id: access.workspace_id,
    role: 'owner',
    action: 'render:plan'
  };

  const created = await createDurableJob({
    kind: 'scale-noop',
    projectId,
    payload: {
      projectId,
      token,
      intentionally_undispatched: true
    },
    idempotencyKey: 'recovery-self-test-' + token,
    authorization
  });

  if (created.conflict) {
    return json({
      ok: false,
      probe_version: 'job-recovery-self-test-v1',
      stage: 'create',
      error: created.conflict_reason
    }, 500);
  }

  // The job is deliberately left queued with no initial dispatch. The recovery
  // path must discover it, dispatch it exactly through the normal worker path,
  // and preserve the same durable job id.
  const recovery = await recoverStalledJobs({
    limit: 50,
    minAgeMs: 0
  });

  for (let attempt = 1; attempt <= 50; attempt++) {
    const job = await readDurableJob(created.job.id);

    if (job?.status === 'succeeded') {
      return json({
        ok: true,
        probe_version: 'job-recovery-self-test-v1',
        same_job_id: job.id === created.job.id,
        recovered_batch_claimed: recovery.claimed,
        recovered_batch_size: recovery.recovered,
        recovery_dispatches: recovery.dispatched,
        recovery_failures: recovery.failed,
        polls: attempt,
        job,
        result: await readJobResult(job)
      });
    }

    if (job?.status === 'failed') {
      return json({
        ok: false,
        probe_version: 'job-recovery-self-test-v1',
        stage: 'execution',
        recovery,
        job
      }, 500);
    }

    await sleep(250);
  }

  return json({
    ok: false,
    probe_version: 'job-recovery-self-test-v1',
    stage: 'timeout',
    recovery,
    job: await readDurableJob(created.job.id)
  }, 504);
};

export const config = {
  path: '/api/job-recovery-self-test',
  rateLimit: {
    windowLimit: 6,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
