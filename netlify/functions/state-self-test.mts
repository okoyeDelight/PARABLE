import {
  bootstrapTransactionalProjectState,
  commitTransactionalProjectMutation,
  readTransactionalProjectState,
  transactionalStateMode
} from './_lib/transactional-state.mts';
import {
  beginProviderSubmission,
  ensureProviderTransaction,
  markProviderSubmissionAmbiguous,
  ProviderTransactionError
} from './_lib/provider-transactions.mts';

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
  if (transactionalStateMode() !== 'postgres') {
    return json({ ok: false, error: 'PostgreSQL transactional state is not active.' }, 503);
  }

  const token = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const projectId = 'tx_probe_' + token;

  try {
    await bootstrapTransactionalProjectState({
      projectId,
      revision: 0,
      stateRefs: {}
    });

    const mutations = await Promise.allSettled([
      commitTransactionalProjectMutation({
        projectId,
        expectedRevision: 0,
        eventId: 'evt_a_' + token,
        mutationType: 'chaos-probe',
        metadata: { writer: 'a' },
        statePatch: { winner: 'artifact-a' }
      }),
      commitTransactionalProjectMutation({
        projectId,
        expectedRevision: 0,
        eventId: 'evt_b_' + token,
        mutationType: 'chaos-probe',
        metadata: { writer: 'b' },
        statePatch: { winner: 'artifact-b' }
      })
    ]);

    const fulfilled = mutations.filter((item) => item.status === 'fulfilled').length;
    const rejected = mutations.filter((item) => item.status === 'rejected').length;
    const head = await readTransactionalProjectState(projectId);

    const ensured = await ensureProviderTransaction({
      projectId,
      operationType: 'probe-render',
      operationId: 'attempt_' + token,
      provider: 'probe-provider',
      model: 'probe-model',
      requestBody: { prompt: 'probe', token },
      estimatedCostUsd: 0.01
    });

    const providerRace = await Promise.allSettled([
      beginProviderSubmission(ensured.transaction.id, projectId),
      beginProviderSubmission(ensured.transaction.id, projectId)
    ]);

    const providerFulfilled = providerRace.filter((item) => item.status === 'fulfilled').length;
    const providerRejected = providerRace.filter((item) => item.status === 'rejected').length;

    const ambiguous = await markProviderSubmissionAmbiguous({
      id: ensured.transaction.id,
      projectId,
      detail: 'Synthetic ambiguous provider response.'
    });

    let ambiguousRetryBlocked = false;
    try {
      await beginProviderSubmission(ensured.transaction.id, projectId);
    } catch (error) {
      ambiguousRetryBlocked =
        error instanceof ProviderTransactionError &&
        error.code === 'PROVIDER_SUBMISSION_AMBIGUOUS';
    }

    const ok =
      fulfilled === 1 &&
      rejected === 1 &&
      Number(head.revision) === 1 &&
      providerFulfilled === 1 &&
      providerRejected === 1 &&
      ambiguous?.state === 'ambiguous' &&
      ambiguousRetryBlocked;

    return json({
      ok,
      probe_version: 'transactional-state-self-test-v1',
      project_revision_race: {
        one_writer_committed: fulfilled === 1,
        stale_writer_rejected: rejected === 1,
        final_revision: head.revision
      },
      provider_double_spend_race: {
        one_submission_claimed: providerFulfilled === 1,
        duplicate_claim_rejected: providerRejected === 1,
        ambiguous_state_persisted: ambiguous?.state === 'ambiguous',
        automatic_retry_blocked: ambiguousRetryBlocked
      }
    }, ok ? 200 : 500);
  } catch (error) {
    return json({
      ok: false,
      probe_version: 'transactional-state-self-test-v1',
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
};

export const config = {
  path: '/api/state-self-test',
  rateLimit: {
    windowLimit: 8,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
