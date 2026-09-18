import {
  acquireProjectMutation,
  commitProjectMutation,
  readProjectRevision,
  ProjectMutationBusy,
  ProjectRevisionConflict
} from './_lib/project-concurrency.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (Netlify.context?.deploy?.context !== 'deploy-preview') return json({ error: 'Not found' }, 404);

  const projectId = 'concurrency_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const initial = await readProjectRevision(projectId);

  const first = await acquireProjectMutation({
    projectId,
    mutationType: 'self-test-first',
    expectedRevision: initial.revision,
    ttlMs: 15000
  });

  let busyProtected = false;
  try {
    await acquireProjectMutation({
      projectId,
      mutationType: 'self-test-overlap',
      expectedRevision: initial.revision,
      ttlMs: 15000
    });
  } catch (error) {
    busyProtected = error instanceof ProjectMutationBusy;
  }

  const firstCommit = await commitProjectMutation(first, { self_test: true, step: 1 });

  let staleRevisionRejected = false;
  try {
    await acquireProjectMutation({
      projectId,
      mutationType: 'self-test-stale',
      expectedRevision: initial.revision,
      ttlMs: 15000
    });
  } catch (error) {
    staleRevisionRejected = error instanceof ProjectRevisionConflict;
  }

  const second = await acquireProjectMutation({
    projectId,
    mutationType: 'self-test-second',
    expectedRevision: firstCommit.revision,
    ttlMs: 15000
  });
  const secondCommit = await commitProjectMutation(second, { self_test: true, step: 2 });
  const finalState = await readProjectRevision(projectId);

  const ok =
    initial.revision === 0 &&
    busyProtected &&
    staleRevisionRejected &&
    firstCommit.revision === 1 &&
    secondCommit.revision === 2 &&
    finalState.revision === 2 &&
    finalState.active_lease === null;

  return json({
    ok,
    probe_version: 'project-concurrency-v1',
    project_id: projectId,
    overlapping_mutation_blocked: busyProtected,
    stale_revision_rejected: staleRevisionRejected,
    revisions: {
      initial: initial.revision,
      after_first: firstCommit.revision,
      after_second: secondCommit.revision,
      final: finalState.revision
    }
  }, ok ? 200 : 500);
};

export const config = {
  path: '/api/concurrency-self-test',
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
