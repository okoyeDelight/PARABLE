import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';
import {
  ensureTransactionalProviderTransaction,
  readTransactionalProviderTransaction,
  transitionTransactionalProviderTransaction,
  transactionalStateMode,
  transactionalRequestFingerprint,
  TransactionalStateError
} from './transactional-state.mts';

export type ProviderTransactionState =
  | 'planned'
  | 'submitting'
  | 'acknowledged'
  | 'processing'
  | 'settled'
  | 'failed'
  | 'ambiguous'
  | 'cancelled';

export type ProviderTransaction = {
  transaction_version: 'parable-provider-transaction-v1';
  id: string;
  project_id: string;
  operation_type: string;
  operation_id: string;
  provider: string;
  model: string;
  request_hash: string;
  state: ProviderTransactionState;
  provider_request_id: string | null;
  provider_status_url: string | null;
  provider_response_url: string | null;
  submission_started_at: string | null;
  acknowledged_at: string | null;
  settled_at: string | null;
  ambiguous_at: string | null;
  failed_at: string | null;
  failure_class: string | null;
  failure_detail: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  submission_attempts: number;
  created_at: string;
  updated_at: string;
};

export class ProviderTransactionError extends Error {
  code: string;
  transaction: ProviderTransaction | null;
  constructor(code: string, message: string, transaction: ProviderTransaction | null = null) {
    super(message);
    this.name = 'ProviderTransactionError';
    this.code = code;
    this.transaction = transaction;
  }
}

function runtimeScope() {
  let context: any = null;
  try { context = getContext(); } catch {}
  const deployContext = context?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  const production = deployContext === 'production';
  const deployId = String(context?.deploy?.id || Netlify.context?.deploy?.id || 'local')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);
  return {
    production,
    prefix: production ? '' : 'deploy/' + (deployId || 'local') + '/'
  };
}

function store() {
  const scope = runtimeScope();
  return {
    scope,
    transactions: getStore(
      scope.production ? 'parable-provider-transactions' : 'parable-provider-transactions-sandbox',
      { consistency: 'strong' }
    )
  };
}

const clean = (value: unknown, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const money = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) / 1_000_000 : null;
};

export async function sha256Text(value: string) {
  return transactionalRequestFingerprint(value);
}

function key(id: string) {
  const { scope } = store();
  return scope.prefix + 'transaction/' + id;
}

async function readBlobWithMetadata(id: string) {
  return store().transactions.getWithMetadata(key(id), { type: 'json' }) as Promise<{
    data: ProviderTransaction;
    etag: string;
    metadata: Record<string, unknown>;
  } | null>;
}

async function readBlobTransaction(id: string) {
  const current = await readBlobWithMetadata(id);
  return current?.data || null;
}

function normalizeRemoteTransaction(row: Record<string, any> | null, logicalProjectId: string): ProviderTransaction | null {
  if (!row) return null;
  return {
    transaction_version: 'parable-provider-transaction-v1',
    id: clean(row.id, 180),
    project_id: logicalProjectId,
    operation_type: clean(row.operation_type, 80),
    operation_id: clean(row.operation_id, 180),
    provider: clean(row.provider, 80),
    model: clean(row.model, 240),
    request_hash: clean(row.request_hash, 64),
    state: clean(row.state, 40) as ProviderTransactionState,
    provider_request_id: clean(row.provider_request_id, 400) || null,
    provider_status_url: clean(row.provider_status_url, 1800) || null,
    provider_response_url: clean(row.provider_response_url, 1800) || null,
    submission_started_at: clean(row.submission_started_at, 80) || null,
    acknowledged_at: clean(row.acknowledged_at, 80) || null,
    settled_at: clean(row.settled_at, 80) || null,
    ambiguous_at: clean(row.ambiguous_at, 80) || null,
    failed_at: clean(row.failed_at, 80) || null,
    failure_class: clean(row.failure_class, 120) || null,
    failure_detail: clean(row.failure_detail, 1200) || null,
    estimated_cost_usd: money(row.estimated_cost_usd),
    actual_cost_usd: money(row.actual_cost_usd),
    submission_attempts: Math.max(0, Math.floor(Number(row.submission_attempts) || 0)),
    created_at: clean(row.created_at, 80) || new Date().toISOString(),
    updated_at: clean(row.updated_at, 80) || new Date().toISOString()
  };
}

async function mirror(transaction: ProviderTransaction | null) {
  if (!transaction) return;
  try {
    await store().transactions.setJSON(key(transaction.id), transaction);
  } catch {
    // PostgreSQL is authoritative; Blob is only the immutable/operational mirror.
  }
}

export async function readProviderTransaction(id: string, projectId?: string | null) {
  if (transactionalStateMode() === 'postgres' && projectId) {
    const remote = normalizeRemoteTransaction(
      await readTransactionalProviderTransaction({ projectId, id }),
      projectId
    );
    await mirror(remote);
    return remote;
  }
  return readBlobTransaction(id);
}

export async function ensureProviderTransaction(args: {
  projectId: string;
  operationType: string;
  operationId: string;
  provider: string;
  model: string;
  requestBody: unknown;
  estimatedCostUsd?: number | null;
}) {
  const requestHash = await transactionalRequestFingerprint(args.requestBody);
  const deterministic = await transactionalRequestFingerprint([
    args.projectId,
    args.operationType,
    args.operationId,
    args.provider,
    args.model
  ].join('|'));
  const id = 'ptx_' + deterministic.slice(0, 40);

  if (transactionalStateMode() === 'postgres') {
    try {
      const remote = normalizeRemoteTransaction(
        await ensureTransactionalProviderTransaction({
          projectId: args.projectId,
          id,
          operationType: clean(args.operationType, 80),
          operationId: clean(args.operationId, 180),
          provider: clean(args.provider, 80),
          model: clean(args.model, 240),
          requestHash,
          estimatedCostUsd: money(args.estimatedCostUsd)
        }),
        args.projectId
      );
      if (!remote) throw new Error('Transactional provider state returned no record.');
      await mirror(remote);
      return { transaction: remote, created: remote.submission_attempts === 0 && remote.state === 'planned' };
    } catch (error) {
      if (error instanceof TransactionalStateError && error.code === 'PROVIDER_TRANSACTION_REQUEST_CONFLICT') {
        throw new ProviderTransactionError(
          'PROVIDER_TRANSACTION_REQUEST_CONFLICT',
          'The same provider operation id was reused with a different immutable request.',
          null
        );
      }
      throw error;
    }
  }

  const existing = await readBlobTransaction(id);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ProviderTransactionError(
        'PROVIDER_TRANSACTION_REQUEST_CONFLICT',
        'The same provider operation id was reused with a different request body.',
        existing
      );
    }
    return { transaction: existing, created: false };
  }

  const now = new Date().toISOString();
  const transaction: ProviderTransaction = {
    transaction_version: 'parable-provider-transaction-v1',
    id,
    project_id: args.projectId,
    operation_type: clean(args.operationType, 80),
    operation_id: clean(args.operationId, 180),
    provider: clean(args.provider, 80),
    model: clean(args.model, 240),
    request_hash: requestHash,
    state: 'planned',
    provider_request_id: null,
    provider_status_url: null,
    provider_response_url: null,
    submission_started_at: null,
    acknowledged_at: null,
    settled_at: null,
    ambiguous_at: null,
    failed_at: null,
    failure_class: null,
    failure_detail: null,
    estimated_cost_usd: money(args.estimatedCostUsd),
    actual_cost_usd: null,
    submission_attempts: 0,
    created_at: now,
    updated_at: now
  };

  await store().transactions.setJSON(key(id), transaction, { onlyIfNew: true } as any);
  return {
    transaction: (await readBlobTransaction(id)) || transaction,
    created: true
  };
}

async function mutateBlob(
  id: string,
  allowedStates: ProviderTransactionState[],
  updater: (current: ProviderTransaction) => ProviderTransaction
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readBlobWithMetadata(id);
    if (!current) throw new ProviderTransactionError('PROVIDER_TRANSACTION_NOT_FOUND', 'Provider transaction was not found.');

    if (!allowedStates.includes(current.data.state)) {
      throw new ProviderTransactionError(
        'PROVIDER_TRANSACTION_STATE_CONFLICT',
        'Provider transaction is already in state ' + current.data.state + '.',
        current.data
      );
    }

    const next = updater(current.data);
    const write = await store().transactions.setJSON(key(id), next, { onlyIfMatch: current.etag } as any);
    if ((write as any)?.modified === false) continue;

    const claimed = await readBlobTransaction(id);
    if (claimed?.updated_at === next.updated_at && claimed?.state === next.state) return claimed;
  }

  const latest = await readBlobTransaction(id);
  throw new ProviderTransactionError(
    'PROVIDER_TRANSACTION_CONCURRENT_CHANGE',
    'Provider transaction changed repeatedly while PARABLE was committing it.',
    latest
  );
}

async function transition(args: {
  id: string;
  projectId: string;
  fromStates: ProviderTransactionState[];
  toState: ProviderTransactionState;
  providerRequestId?: string | null;
  statusUrl?: string | null;
  responseUrl?: string | null;
  failureClass?: string | null;
  failureDetail?: string | null;
  actualCostUsd?: number | null;
  rightsAssertions?: Array<Record<string, unknown>>;
}) {
  if (transactionalStateMode() === 'postgres') {
    try {
      const remote = normalizeRemoteTransaction(
        await transitionTransactionalProviderTransaction({
          projectId: args.projectId,
          id: args.id,
          fromStates: args.fromStates,
          toState: args.toState,
          providerRequestId: args.providerRequestId,
          statusUrl: args.statusUrl,
          responseUrl: args.responseUrl,
          failureClass: args.failureClass,
          failureDetail: args.failureDetail,
          actualCostUsd: money(args.actualCostUsd),
          rightsAssertions: args.rightsAssertions || []
        }),
        args.projectId
      );
      if (!remote) throw new Error('Transactional provider transition returned no record.');
      await mirror(remote);
      return remote;
    } catch (error) {
      if (error instanceof TransactionalStateError && error.code === 'PROVIDER_TRANSACTION_STATE_CONFLICT') {
        const current = await readProviderTransaction(args.id, args.projectId).catch(() => null);
        throw new ProviderTransactionError(
          'PROVIDER_TRANSACTION_STATE_CONFLICT',
          'Provider transaction state changed before this transition could commit.',
          current
        );
      }
      throw error;
    }
  }

  return mutateBlob(args.id, args.fromStates, (current) => {
    const now = new Date().toISOString();
    return {
      ...current,
      state: args.toState,
      provider_request_id: clean(args.providerRequestId, 400) || current.provider_request_id,
      provider_status_url: clean(args.statusUrl, 1800) || current.provider_status_url,
      provider_response_url: clean(args.responseUrl, 1800) || current.provider_response_url,
      failure_class: clean(args.failureClass, 120) || current.failure_class,
      failure_detail: clean(args.failureDetail, 1200) || current.failure_detail,
      actual_cost_usd: money(args.actualCostUsd) ?? current.actual_cost_usd,
      submission_started_at: args.toState === 'submitting'
        ? current.submission_started_at || now
        : current.submission_started_at,
      acknowledged_at: args.toState === 'acknowledged'
        ? current.acknowledged_at || now
        : current.acknowledged_at,
      settled_at: args.toState === 'settled' ? current.settled_at || now : current.settled_at,
      ambiguous_at: args.toState === 'ambiguous' ? current.ambiguous_at || now : current.ambiguous_at,
      failed_at: args.toState === 'failed' ? current.failed_at || now : current.failed_at,
      submission_attempts: current.submission_attempts + (args.toState === 'submitting' ? 1 : 0),
      updated_at: now
    };
  });
}

export async function beginProviderSubmission(
  id: string,
  projectId: string,
  rightsAssertions: Array<Record<string, unknown>> = []
) {
  const existing = await readProviderTransaction(id, projectId);
  if (!existing) throw new ProviderTransactionError('PROVIDER_TRANSACTION_NOT_FOUND', 'Provider transaction was not found.');

  if (['acknowledged','processing','settled'].includes(existing.state)) return existing;
  if (existing.state === 'submitting') {
    throw new ProviderTransactionError(
      'PROVIDER_SUBMISSION_AMBIGUOUS',
      'This paid submission is already claimed by another execution. PARABLE will not submit it again automatically.',
      existing
    );
  }
  if (existing.state === 'ambiguous') {
    throw new ProviderTransactionError(
      'PROVIDER_SUBMISSION_AMBIGUOUS',
      'A previous paid submission may already have reached the provider. PARABLE will not retry automatically.',
      existing
    );
  }
  if (existing.state === 'failed' || existing.state === 'cancelled') {
    throw new ProviderTransactionError(
      'PROVIDER_TRANSACTION_TERMINAL',
      'This provider transaction is terminal. Create a deliberate new operation id for another paid attempt.',
      existing
    );
  }

  return transition({
    id,
    projectId,
    fromStates: ['planned'],
    toState: 'submitting',
    rightsAssertions
  });
}

export async function acknowledgeProviderSubmission(args: {
  id: string;
  projectId: string;
  providerRequestId: string;
  statusUrl?: string | null;
  responseUrl?: string | null;
}) {
  const updated = await transition({
    id: args.id,
    projectId: args.projectId,
    fromStates: ['submitting','acknowledged'],
    toState: 'acknowledged',
    providerRequestId: args.providerRequestId,
    statusUrl: args.statusUrl,
    responseUrl: args.responseUrl
  });

  return updated;
}

export async function markProviderProcessing(id: string, projectId: string) {
  const existing = await readProviderTransaction(id, projectId);
  if (!existing) return null;
  if (existing.state === 'processing' || existing.state === 'settled') return existing;
  return transition({ id, projectId, fromStates: ['acknowledged'], toState: 'processing' });
}

export async function settleProviderTransaction(args: {
  id: string;
  projectId: string;
  actualCostUsd?: number | null;
}) {
  const existing = await readProviderTransaction(args.id, args.projectId);
  if (!existing) return null;
  if (existing.state === 'settled') return existing;
  return transition({
    id: args.id,
    projectId: args.projectId,
    fromStates: ['acknowledged','processing'],
    toState: 'settled',
    actualCostUsd: args.actualCostUsd
  });
}

export async function failProviderTransaction(args: {
  id: string;
  projectId: string;
  failureClass: string;
  failureDetail: string;
  actualCostUsd?: number | null;
}) {
  const existing = await readProviderTransaction(args.id, args.projectId);
  if (!existing) return null;
  if (['failed','settled','ambiguous','cancelled'].includes(existing.state)) return existing;
  return transition({
    id: args.id,
    projectId: args.projectId,
    fromStates: ['planned','submitting','acknowledged','processing'],
    toState: 'failed',
    failureClass: args.failureClass,
    failureDetail: args.failureDetail,
    actualCostUsd: args.actualCostUsd
  });
}

export async function markProviderSubmissionAmbiguous(args: {
  id: string;
  projectId: string;
  detail: string;
}) {
  const existing = await readProviderTransaction(args.id, args.projectId);
  if (!existing) return null;
  if (existing.state === 'ambiguous' || existing.state === 'settled') return existing;

  return transition({
    id: args.id,
    projectId: args.projectId,
    fromStates: ['submitting','acknowledged'],
    toState: 'ambiguous',
    failureClass: 'ambiguous-submission',
    failureDetail: args.detail
  });
}

export function providerTransactionErrorResponse(error: unknown) {
  if (error instanceof ProviderTransactionError) {
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
        transaction: error.transaction
      }
    };
  }

  if (error instanceof TransactionalStateError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        state_backend: 'postgres'
      }
    };
  }

  return null;
}
