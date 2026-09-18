import {
  bootstrapTransactionalProjectState,
  claimTransactionalJob,
  commitTransactionalProjectMutation,
  ensureTransactionalJob,
  readTransactionalProjectState,
  revokeTransactionalRights,
  transactionalRequestFingerprint,
  transactionalStateMode,
  transitionTransactionalJob,
  upsertTransactionalRights,
  TransactionalStateError
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

    const first = await commitTransactionalProjectMutation({
      projectId,
      expectedRevision: 0,
      eventId: 'evt_first_' + token,
      mutationType: 'self-test',
      metadata: { writer: 'first' },
      statePatch: { winner: 'artifact-first' }
    });

    let staleWriterRejected = false;
    try {
      await commitTransactionalProjectMutation({
        projectId,
        expectedRevision: 0,
        eventId: 'evt_stale_' + token,
        mutationType: 'self-test',
        metadata: { writer: 'stale' },
        statePatch: { winner: 'artifact-stale' }
      });
    } catch (error) {
      staleWriterRejected =
        error instanceof TransactionalStateError &&
        error.code === 'PROJECT_REVISION_CONFLICT';
    }

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

    const submitting = await beginProviderSubmission(ensured.transaction.id, projectId);

    let duplicateSubmissionBlocked = false;
    try {
      await beginProviderSubmission(ensured.transaction.id, projectId);
    } catch (error) {
      duplicateSubmissionBlocked =
        error instanceof ProviderTransactionError &&
        error.code === 'PROVIDER_SUBMISSION_AMBIGUOUS';
    }

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

    // Rights are versioned in PostgreSQL and revalidated when a paid provider
    // submission is claimed.
    const assetHash = await transactionalRequestFingerprint('rights:' + token);
    const rights = await upsertTransactionalRights({
      projectId,
      assetSha256: assetHash,
      rights: {
        status: 'approved',
        basis: 'generated',
        rights_holder: 'PARABLE synthetic self-test',
        likeness_permission: true,
        voice_permission: true,
        ai_generation_permission: true,
        commercial_use: false,
        territories: ['self-test'],
        expires_at: null,
        evidence_sha256: null,
        evidence_note: 'Synthetic deploy-preview rights probe.',
        declared_by_actor_id: 'usr_preview_owner',
        declared_at: new Date().toISOString()
      }
    });

    const rightsAttempt = await ensureProviderTransaction({
      projectId,
      operationType: 'rights-probe-render',
      operationId: 'rights_attempt_' + token,
      provider: 'probe-provider',
      model: 'probe-model',
      requestBody: { prompt: 'rights-probe', token },
      estimatedCostUsd: 0.01
    });

    await revokeTransactionalRights({
      projectId,
      assetSha256: assetHash,
      actorId: 'usr_preview_owner',
      reason: 'Synthetic revocation before submission.'
    });

    let revokedRightsBlockedSpend = false;
    try {
      await beginProviderSubmission(
        rightsAttempt.transaction.id,
        projectId,
        [{
          asset_sha256: assetHash,
          rights_revision: Number(rights.rights_revision || 1),
          require_likeness: true,
          require_voice: false,
          require_commercial: false
        }]
      );
    } catch (error) {
      revokedRightsBlockedSpend =
        error instanceof TransactionalStateError &&
        error.code === 'RIGHTS_ASSERTION_FAILED';
    }

    // Durable worker ownership is atomic in PostgreSQL.
    const jobId = 'job_probe_' + token;
    const payloadHash = await transactionalRequestFingerprint({ token, kind: 'scale-noop' });
    const job = await ensureTransactionalJob({
      id: jobId,
      kind: 'scale-noop',
      projectId,
      workspaceId: 'ws_probe',
      actorUserId: 'usr_preview_owner',
      authContext: {
        actor_id: 'usr_preview_owner',
        provider: 'parable-preview',
        subject: 'preview-owner',
        workspace_id: 'ws_probe',
        role: 'owner',
        action: 'project:edit'
      },
      payloadHash,
      idempotencyKey: 'probe-' + token
    });

    const leaseA = 'lease_a_' + token;
    const leaseB = 'lease_b_' + token;
    const claimA = await claimTransactionalJob({
      id: jobId,
      leaseToken: leaseA,
      attempt: 1,
      leaseMs: 30000
    });
    const claimB = await claimTransactionalJob({
      id: jobId,
      leaseToken: leaseB,
      attempt: 1,
      leaseMs: 30000
    });

    let staleLeaseRejected = false;
    try {
      await transitionTransactionalJob({
        id: jobId,
        toStatus: 'succeeded',
        leaseToken: leaseB,
        resultRef: 'synthetic://wrong-worker'
      });
    } catch (error) {
      staleLeaseRejected =
        error instanceof TransactionalStateError &&
        error.code === 'JOB_LEASE_MISMATCH';
    }

    const completed = await transitionTransactionalJob({
      id: jobId,
      toStatus: 'succeeded',
      leaseToken: leaseA,
      resultRef: 'synthetic://self-test'
    });

    const ok =
      first.revision === 1 &&
      staleWriterRejected &&
      Number(head.revision) === 1 &&
      submitting.state === 'submitting' &&
      duplicateSubmissionBlocked &&
      ambiguous?.state === 'ambiguous' &&
      ambiguousRetryBlocked &&
      revokedRightsBlockedSpend &&
      job.created === true &&
      claimA.claimed === true &&
      claimB.claimed === false &&
      staleLeaseRejected &&
      completed?.status === 'succeeded';

    return json({
      ok,
      probe_version: 'transactional-state-self-test-v2',
      project_revision: {
        first_commit: first.revision,
        stale_writer_rejected: staleWriterRejected,
        final_revision: head.revision
      },
      provider_spend_guard: {
        first_submission_claimed: submitting.state === 'submitting',
        duplicate_submission_blocked: duplicateSubmissionBlocked,
        ambiguous_state_persisted: ambiguous?.state === 'ambiguous',
        automatic_retry_blocked: ambiguousRetryBlocked
      },
      rights_guard: {
        rights_revision: rights.rights_revision,
        revoked_rights_blocked_paid_submission: revokedRightsBlockedSpend
      },
      durable_job_guard: {
        created: job.created,
        first_worker_claimed: claimA.claimed,
        second_worker_blocked: claimB.claimed === false,
        stale_worker_completion_rejected: staleLeaseRejected,
        final_status: completed?.status || null
      }
    }, ok ? 200 : 500);
  } catch (error) {
    return json({
      ok: false,
      probe_version: 'transactional-state-self-test-v2',
      error: error instanceof Error ? error.message : String(error),
      code: error instanceof TransactionalStateError ? error.code : null
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
