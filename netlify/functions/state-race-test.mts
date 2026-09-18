import {
  bootstrapTransactionalProjectState,
  commitTransactionalProjectMutation,
  readTransactionalProjectState,
  transactionalStateMode,
  TransactionalStateError
} from './_lib/transactional-state.mts';
import {
  beginProviderSubmission,
  ensureProviderTransaction,
  readProviderTransaction,
  ProviderTransactionError
} from './_lib/provider-transactions.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 120) => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,max);

function projectId(probe: string) {
  return 'race_' + probe;
}

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (Netlify.context?.deploy?.context !== 'deploy-preview') return json({ error: 'Not found' }, 404);
  if (transactionalStateMode() !== 'postgres') return json({ error: 'PostgreSQL state is not active.' },503);

  const url = new URL(request.url);
  const mode = clean(url.searchParams.get('mode'),40);
  const probe = clean(url.searchParams.get('probe'),48);
  const writer = clean(url.searchParams.get('writer'),16);

  if (!/^[a-zA-Z0-9_-]{8,48}$/.test(probe)) {
    return json({ error: 'A valid synthetic probe id is required.' },400);
  }

  const pid = projectId(probe);

  try {
    if (mode === 'init') {
      const head = await bootstrapTransactionalProjectState({
        projectId: pid,
        revision: 0,
        stateRefs: {}
      });

      const provider = await ensureProviderTransaction({
        projectId: pid,
        operationType: 'race-probe-render',
        operationId: 'provider_' + probe,
        provider: 'probe-provider',
        model: 'probe-model',
        requestBody: { probe, kind: 'race' },
        estimatedCostUsd: 0.01
      });

      return json({
        ok: true,
        probe,
        project_revision: head.revision,
        provider_transaction_id: provider.transaction.id
      });
    }

    if (mode === 'project-claim') {
      if (!/^[ab]$/.test(writer)) return json({ error: 'writer must be a or b.' },400);
      try {
        const committed = await commitTransactionalProjectMutation({
          projectId: pid,
          expectedRevision: 0,
          eventId: 'race_evt_' + probe + '_' + writer,
          mutationType: 'parallel-race-probe',
          metadata: { writer },
          statePatch: { winner: writer }
        });
        return json({ ok:true,writer,committed:true,revision:committed.revision });
      } catch (error) {
        if (error instanceof TransactionalStateError && error.code === 'PROJECT_REVISION_CONFLICT') {
          return json({ ok:true,writer,committed:false,code:error.code },409);
        }
        throw error;
      }
    }

    if (mode === 'provider-claim') {
      if (!/^[ab]$/.test(writer)) return json({ error: 'writer must be a or b.' },400);
      const ensured = await ensureProviderTransaction({
        projectId: pid,
        operationType: 'race-probe-render',
        operationId: 'provider_' + probe,
        provider: 'probe-provider',
        model: 'probe-model',
        requestBody: { probe, kind: 'race' },
        estimatedCostUsd: 0.01
      });

      try {
        const transaction = await beginProviderSubmission(ensured.transaction.id,pid);
        return json({ ok:true,writer,claimed:true,state:transaction.state });
      } catch (error) {
        if (
          error instanceof ProviderTransactionError &&
          (
            error.code === 'PROVIDER_SUBMISSION_AMBIGUOUS' ||
            error.code === 'PROVIDER_TRANSACTION_STATE_CONFLICT'
          )
        ) {
          return json({ ok:true,writer,claimed:false,code:error.code },409);
        }
        throw error;
      }
    }

    if (mode === 'read') {
      const head = await readTransactionalProjectState(pid);
      const ensured = await ensureProviderTransaction({
        projectId: pid,
        operationType: 'race-probe-render',
        operationId: 'provider_' + probe,
        provider: 'probe-provider',
        model: 'probe-model',
        requestBody: { probe, kind: 'race' },
        estimatedCostUsd: 0.01
      });
      const transaction = await readProviderTransaction(ensured.transaction.id,pid);

      return json({
        ok:true,
        project_revision:head.revision,
        project_winner:head.state_refs?.winner || null,
        provider_state:transaction?.state || null,
        provider_submission_attempts:transaction?.submission_attempts || 0
      });
    }

    return json({ error: 'Unsupported synthetic race mode.' },400);
  } catch (error) {
    return json({
      ok:false,
      error:error instanceof Error ? error.message : String(error),
      code:error instanceof TransactionalStateError
        ? error.code
        : error instanceof ProviderTransactionError
          ? error.code
          : null
    },500);
  }
};

export const config = {
  path: '/api/state-race-test',
  rateLimit: {
    windowLimit: 40,
    windowSize: 60,
    aggregateBy: ['ip','domain']
  }
};
