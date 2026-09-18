import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';

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
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2,'0')).join('');
}

function key(id: string) {
  const { scope } = store();
  return scope.prefix + 'transaction/' + id;
}

async function readWithMetadata(id: string) {
  return store().transactions.getWithMetadata(key(id), { type: 'json' }) as Promise<{
    data: ProviderTransaction;
    etag: string;
    metadata: Record<string, unknown>;
  } | null>;
}

export async function readProviderTransaction(id: string) {
  const current = await readWithMetadata(id);
  return current?.data || null;
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
  const requestHash = await sha256Text(JSON.stringify(args.requestBody));
  const deterministic = await sha256Text([
    args.projectId,
    args.operationType,
    args.operationId,
    args.provider,
    args.model
  ].join('|'));
  const id = 'ptx_' + deterministic.slice(0, 40);

  const existing = await readProviderTransaction(id);
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
    transaction: (await readProviderTransaction(id)) || transaction,
    created: true
  };
}

async function mutate(
  id: string,
  allowedStates: ProviderTransactionState[],
  updater: (current: ProviderTransaction) => ProviderTransaction
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readWithMetadata(id);
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

    const claimed = await readProviderTransaction(id);
    if (claimed?.updated_at === next.updated_at && claimed?.state === next.state) return claimed;
  }

  const latest = await readProviderTransaction(id);
  throw new ProviderTransactionError(
    'PROVIDER_TRANSACTION_CONCURRENT_CHANGE',
    'Provider transaction changed repeatedly while PARABLE was committing it.',
    latest
  );
}

export async function beginProviderSubmission(id: string) {
  const existing = await readProviderTransaction(id);
  if (!existing) throw new ProviderTransactionError('PROVIDER_TRANSACTION_NOT_FOUND', 'Provider transaction was not found.');

  if (['acknowledged','processing','settled'].includes(existing.state)) return existing;
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

  return mutate(id, ['planned'], (current) => {
    const now = new Date().toISOString();
    return {
      ...current,
      state: 'submitting',
      submission_started_at: now,
      submission_attempts: current.submission_attempts + 1,
      updated_at: now
    };
  });
}

export async function acknowledgeProviderSubmission(args: {
  id: string;
  providerRequestId: string;
  statusUrl?: string | null;
  responseUrl?: string | null;
}) {
  return mutate(args.id, ['submitting','acknowledged'], (current) => {
    const now = new Date().toISOString();
    return {
      ...current,
      state: 'acknowledged',
      provider_request_id: clean(args.providerRequestId, 400),
      provider_status_url: clean(args.statusUrl, 1800) || current.provider_status_url,
      provider_response_url: clean(args.responseUrl, 1800) || current.provider_response_url,
      acknowledged_at: current.acknowledged_at || now,
      failure_class: null,
      failure_detail: null,
      updated_at: now
    };
  });
}

export async function markProviderProcessing(id: string) {
  const existing = await readProviderTransaction(id);
  if (!existing) return null;
  if (existing.state === 'processing') return existing;
  if (existing.state === 'settled') return existing;
  return mutate(id, ['acknowledged'], (current) => ({
    ...current,
    state: 'processing',
    updated_at: new Date().toISOString()
  }));
}

export async function settleProviderTransaction(args: {
  id: string;
  actualCostUsd?: number | null;
}) {
  const existing = await readProviderTransaction(args.id);
  if (!existing) return null;
  if (existing.state === 'settled') return existing;
  return mutate(args.id, ['acknowledged','processing'], (current) => {
    const now = new Date().toISOString();
    return {
      ...current,
      state: 'settled',
      actual_cost_usd: money(args.actualCostUsd) ?? current.actual_cost_usd,
      settled_at: now,
      updated_at: now
    };
  });
}

export async function failProviderTransaction(args: {
  id: string;
  failureClass: string;
  failureDetail: string;
  actualCostUsd?: number | null;
}) {
  const existing = await readProviderTransaction(args.id);
  if (!existing) return null;
  if (['failed','settled','ambiguous','cancelled'].includes(existing.state)) return existing;
  return mutate(args.id, ['planned','submitting','acknowledged','processing'], (current) => {
    const now = new Date().toISOString();
    return {
      ...current,
      state: 'failed',
      failure_class: clean(args.failureClass, 120),
      failure_detail: clean(args.failureDetail, 1200),
      actual_cost_usd: money(args.actualCostUsd) ?? current.actual_cost_usd,
      failed_at: now,
      updated_at: now
    };
  });
}

export async function markProviderSubmissionAmbiguous(args: {
  id: string;
  detail: string;
}) {
  const existing = await readProviderTransaction(args.id);
  if (!existing) return null;
  if (existing.state === 'ambiguous') return existing;
  if (existing.state === 'settled') return existing;

  return mutate(args.id, ['submitting','acknowledged'], (current) => {
    const now = new Date().toISOString();
    return {
      ...current,
      state: 'ambiguous',
      failure_class: 'ambiguous-submission',
      failure_detail: clean(args.detail, 1200),
      ambiguous_at: now,
      updated_at: now
    };
  });
}

export function providerTransactionErrorResponse(error: unknown) {
  if (!(error instanceof ProviderTransactionError)) return null;
  return {
    status: error.code === 'PROVIDER_SUBMISSION_AMBIGUOUS' ? 409 : 409,
    body: {
      error: error.message,
      code: error.code,
      transaction: error.transaction
    }
  };
}
