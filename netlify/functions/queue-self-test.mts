import {
  createDurableJob,
  markJobQueued,
  readDurableJob,
  readJobResult
} from './_lib/job-store.mts';
import { dispatchDurableJob } from './_lib/job-dispatcher.mts';

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

  const token = crypto.randomUUID().replaceAll('-', '');
  const created = await createDurableJob({
    kind: 'scale-noop',
    projectId: 'scale_probe',
    payload: { projectId: 'scale_probe', token },
    idempotencyKey: 'queue-self-test-' + token
  });

  if (created.conflict) return json({ ok: false, stage: 'create', error: created.conflict_reason }, 500);

  let dispatched;
  try {
    dispatched = await dispatchDurableJob(created.job.id, 'scale-noop');
    await markJobQueued(created.job.id, dispatched.event_id);
  } catch (error) {
    return json({
      ok: false,
      stage: 'dispatch',
      error: error instanceof Error ? error.message : String(error)
    }, 503);
  }

  for (let attempt = 1; attempt <= 40; attempt++) {
    const job = await readDurableJob(created.job.id);
    if (job?.status === 'succeeded') {
      const duplicate = await createDurableJob({
        kind: 'scale-noop',
        projectId: 'scale_probe',
        payload: { projectId: 'scale_probe', token },
        idempotencyKey: 'queue-self-test-' + token
      });

      const conflict = await createDurableJob({
        kind: 'scale-noop',
        projectId: 'scale_probe',
        payload: { projectId: 'scale_probe', token: token + '-conflict' },
        idempotencyKey: 'queue-self-test-' + token
      });

      const idempotencyOk =
        duplicate.created === false &&
        duplicate.conflict === false &&
        duplicate.job.id === job.id &&
        conflict.created === false &&
        conflict.conflict === true;

      return json({
        ok: idempotencyOk,
        probe_version: 'queue-self-test-v2',
        backend: dispatched.backend,
        degraded_from_primary: Boolean(dispatched.primary_error),
        job,
        result: await readJobResult(job),
        idempotency: {
          duplicate_reused_job: duplicate.job.id === job.id && duplicate.created === false && duplicate.conflict === false,
          conflicting_replay_rejected: conflict.conflict === true
        },
        polls: attempt
      }, idempotencyOk ? 200 : 500);
    }
    if (job?.status === 'failed') {
      return json({
        ok: false,
        stage: 'execution',
        backend: dispatched.backend,
        job
      }, 500);
    }
    await sleep(250);
  }

  return json({
    ok: false,
    stage: 'timeout',
    backend: dispatched.backend,
    job: await readDurableJob(created.job.id)
  }, 504);
};

export const config = {
  path: '/api/queue-self-test',
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
