import { getContext } from '@netlify/functions';

export type TransactionalStateMode = 'blobs' | 'postgres';

export class TransactionalStateError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  detail: unknown;

  constructor(
    code: string,
    message: string,
    status = 503,
    retryable = true,
    detail: unknown = null
  ) {
    super(message);
    this.name = 'TransactionalStateError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

const clean = (value: unknown, max = 1000) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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
    deploy_context: deployContext,
    deploy_id: deployId || 'local'
  };
}

export function transactionalStateMode(): TransactionalStateMode {
  return String(Netlify.env.get('PARABLE_STATE_ENGINE') || 'blobs').trim().toLowerCase() === 'postgres'
    ? 'postgres'
    : 'blobs';
}

function previewDerivedSecretAvailable() {
  const scope = runtimeScope();
  return !scope.production && Boolean(String(Netlify.env.get('OPENROUTER_API_KEY') || '').trim());
}

export function transactionalStateConfigured() {
  return Boolean(
    String(Netlify.env.get('PARABLE_SUPABASE_URL') || '').trim() &&
    String(Netlify.env.get('PARABLE_SUPABASE_PUBLISHABLE_KEY') || '').trim() &&
    (
      String(Netlify.env.get('PARABLE_STATE_RPC_SECRET') || '').trim() ||
      previewDerivedSecretAvailable()
    )
  );
}

export function storageProjectId(projectId: string) {
  const scope = runtimeScope();
  return scope.production
    ? 'prod:' + projectId
    : 'preview:' + scope.deploy_id + ':' + projectId;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function runtimeSigningSecret() {
  const dedicated = String(Netlify.env.get('PARABLE_STATE_RPC_SECRET') || '').trim();
  if (dedicated) return dedicated;

  const scope = runtimeScope();
  if (!scope.production) {
    const source = String(Netlify.env.get('OPENROUTER_API_KEY') || '').trim();
    if (source) {
      return sha256Hex('PARABLE_STATE_RPC_V1|' + source);
    }
  }

  return '';
}

async function credentials() {
  const url = String(Netlify.env.get('PARABLE_SUPABASE_URL') || '').replace(/\/$/, '');
  const key = String(Netlify.env.get('PARABLE_SUPABASE_PUBLISHABLE_KEY') || '').trim();
  const secret = await runtimeSigningSecret();

  if (!url || !key || !secret) {
    throw new TransactionalStateError(
      'TRANSACTIONAL_STATE_NOT_CONFIGURED',
      'PARABLE transactional state is selected but its signed PostgreSQL bridge is not fully configured.',
      503,
      false
    );
  }

  return { url, key, secret };
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function providerErrorCode(action: string, body: any, status: number) {
  const text = [
    body?.message,
    body?.details,
    body?.hint,
    body?.code
  ].filter(Boolean).join(' ');

  if (/PROJECT_REVISION_CONFLICT/i.test(text)) return 'PROJECT_REVISION_CONFLICT';
  if (/PROVIDER_TRANSACTION_REQUEST_CONFLICT/i.test(text)) return 'PROVIDER_TRANSACTION_REQUEST_CONFLICT';
  if (/PROVIDER_TRANSACTION_STATE_CONFLICT/i.test(text)) return 'PROVIDER_TRANSACTION_STATE_CONFLICT';
  if (/RIGHTS_ASSERTION_FAILED/i.test(text)) return 'RIGHTS_ASSERTION_FAILED';
  if (/RIGHTS_RESTORE_REQUIRES_EXPLICIT_WORKFLOW/i.test(text)) return 'RIGHTS_RESTORE_REQUIRES_EXPLICIT_WORKFLOW';
  if (/JOB_IDEMPOTENCY_CONFLICT/i.test(text)) return 'JOB_IDEMPOTENCY_CONFLICT';
  if (/JOB_LEASE_MISMATCH/i.test(text)) return 'JOB_LEASE_MISMATCH';
  if (/JOB_NOT_PROCESSING/i.test(text)) return 'JOB_NOT_PROCESSING';
  if (/RUNTIME_REPLAY_REJECTED/i.test(text)) return 'RUNTIME_REPLAY_REJECTED';
  if (/RUNTIME_SIGNATURE|RUNTIME_REQUEST_EXPIRED/i.test(text)) return 'RUNTIME_AUTH_REJECTED';

  // PostgREST can normalize SQLSTATE 40001 into a generic serialization error
  // and hide our custom message. Recover the semantic conflict from the signed
  // RPC action so callers can still fail closed for the correct reason.
  if (String(body?.code || '') === '40001') {
    if (action === 'commit_project_mutation') return 'PROJECT_REVISION_CONFLICT';
    if (action === 'ensure_provider_transaction') return 'PROVIDER_TRANSACTION_REQUEST_CONFLICT';
    if (action === 'transition_provider_transaction') return 'PROVIDER_TRANSACTION_STATE_CONFLICT';
    if (action === 'ensure_job') return 'JOB_IDEMPOTENCY_CONFLICT';
    if (action === 'transition_job') return 'JOB_STATE_CONFLICT';
  }

  if (/lock timeout|statement timeout|canceling statement/i.test(text)) return 'TRANSACTIONAL_STATE_CONTENTION_TIMEOUT';
  if (status === 429) return 'TRANSACTIONAL_STATE_RATE_LIMITED';
  if (status >= 500) return 'TRANSACTIONAL_STATE_UPSTREAM_FAILED';
  return 'TRANSACTIONAL_STATE_RPC_REJECTED';
}

async function rpc<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { url, key, secret } = await credentials();
  const timestamp = Date.now();
  const nonce = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const payloadText = JSON.stringify(payload);
  const message = [action, String(timestamp), nonce, payloadText].join('\n');
  const signature = await hmacHex(secret, message);

  let response: Response;
  try {
    response = await fetch(url + '/rest/v1/rpc/parable_runtime_rpc', {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: 'Bearer ' + key,
        'content-type': 'application/json',
        accept: 'application/json',
        'x-parable-state-engine': 'postgres-v5'
      },
      body: JSON.stringify({
        p_action: action,
        p_timestamp_ms: timestamp,
        p_nonce: nonce,
        p_payload_text: payloadText,
        p_signature: signature
      }),
      signal: AbortSignal.timeout(9000)
    });
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(error.name + ' ' + error.message);
    throw new TransactionalStateError(
      timeout ? 'TRANSACTIONAL_STATE_TIMEOUT' : 'TRANSACTIONAL_STATE_NETWORK_FAILED',
      timeout
        ? 'PARABLE transactional state exceeded its fail-fast request deadline.'
        : 'PARABLE could not reach the transactional state service.',
      503,
      true,
      clean(error instanceof Error ? error.message : error, 800)
    );
  }

  const body = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const code = providerErrorCode(action, body, response.status);
    const message = clean(body?.message || body?.error || 'Transactional state request failed.', 1200);
    const conflictCodes = new Set([
      'PROJECT_REVISION_CONFLICT',
      'PROVIDER_TRANSACTION_STATE_CONFLICT',
      'PROVIDER_TRANSACTION_REQUEST_CONFLICT',
      'JOB_IDEMPOTENCY_CONFLICT',
      'JOB_LEASE_MISMATCH',
      'JOB_NOT_PROCESSING',
      'JOB_STATE_CONFLICT',
      'RIGHTS_ASSERTION_FAILED',
      'RIGHTS_RESTORE_REQUIRES_EXPLICIT_WORKFLOW'
    ]);

    throw new TransactionalStateError(
      code,
      message,
      conflictCodes.has(code) ? 409 : response.status,
      response.status >= 500 || response.status === 429,
      body
    );
  }

  return body as T;
}

export async function transactionalStateHealth() {
  return rpc<Record<string, unknown>>('health', {});
}

export async function readTransactionalProjectState(projectId: string) {
  return rpc<{
    exists: boolean;
    project_id: string;
    revision: number;
    state_refs: Record<string, string>;
    updated_at?: string | null;
  }>('read_project_state', {
    project_id: storageProjectId(projectId)
  });
}

export async function bootstrapTransactionalProjectState(args: {
  projectId: string;
  revision: number;
  stateRefs: Record<string, string>;
}) {
  return rpc<{
    exists: boolean;
    project_id: string;
    revision: number;
    state_refs: Record<string, string>;
  }>('bootstrap_project_state', {
    project_id: storageProjectId(args.projectId),
    revision: Math.max(0, Math.floor(Number(args.revision) || 0)),
    state_refs: args.stateRefs || {}
  });
}

export async function commitTransactionalProjectMutation(args: {
  projectId: string;
  expectedRevision: number;
  eventId: string;
  mutationType: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  statePatch?: Record<string, string | null>;
}) {
  return rpc<{
    project_id: string;
    revision: number;
    state_refs: Record<string, string>;
    event_id: string;
  }>('commit_project_mutation', {
    project_id: storageProjectId(args.projectId),
    expected_revision: Math.max(0, Math.floor(Number(args.expectedRevision) || 0)),
    event_id: args.eventId,
    mutation_type: clean(args.mutationType, 80) || 'mutation',
    actor_user_id: clean(args.actorUserId, 180) || null,
    metadata: args.metadata || {},
    state_patch: args.statePatch || {}
  });
}

export async function ensureTransactionalProviderTransaction(args: {
  projectId: string;
  id: string;
  operationType: string;
  operationId: string;
  provider: string;
  model: string;
  requestHash: string;
  estimatedCostUsd?: number | null;
}) {
  return rpc<Record<string, any>>('ensure_provider_transaction', {
    project_id: storageProjectId(args.projectId),
    id: args.id,
    operation_type: args.operationType,
    operation_id: args.operationId,
    provider: args.provider,
    model: args.model,
    request_hash: args.requestHash,
    estimated_cost_usd: args.estimatedCostUsd ?? null
  });
}

export async function readTransactionalProviderTransaction(args: {
  projectId: string;
  id: string;
}) {
  return rpc<Record<string, any> | null>('read_provider_transaction', {
    project_id: storageProjectId(args.projectId),
    id: args.id
  });
}

export async function transitionTransactionalProviderTransaction(args: {
  projectId: string;
  id: string;
  fromStates: string[];
  toState: string;
  providerRequestId?: string | null;
  statusUrl?: string | null;
  responseUrl?: string | null;
  failureClass?: string | null;
  failureDetail?: string | null;
  actualCostUsd?: number | null;
  rightsAssertions?: Array<Record<string, unknown>>;
}) {
  return rpc<Record<string, any>>('transition_provider_transaction', {
    project_id: storageProjectId(args.projectId),
    id: args.id,
    from_states: args.fromStates,
    to_state: args.toState,
    provider_request_id: args.providerRequestId || null,
    provider_status_url: args.statusUrl || null,
    provider_response_url: args.responseUrl || null,
    failure_class: args.failureClass || null,
    failure_detail: args.failureDetail || null,
    actual_cost_usd: args.actualCostUsd ?? null,
    rights_assertions: args.rightsAssertions || []
  });
}

export async function readTransactionalRights(args: {
  projectId: string;
  assetSha256: string;
}) {
  return rpc<Record<string, any> | null>('read_rights', {
    project_id: storageProjectId(args.projectId),
    asset_sha256: args.assetSha256
  });
}

export async function upsertTransactionalRights(args: {
  projectId: string;
  assetSha256: string;
  rights: Record<string, any>;
}) {
  return rpc<Record<string, any>>('upsert_rights', {
    project_id: storageProjectId(args.projectId),
    asset_sha256: args.assetSha256,
    ...args.rights
  });
}

export async function revokeTransactionalRights(args: {
  projectId: string;
  assetSha256: string;
  actorId: string;
  reason: string;
}) {
  return rpc<Record<string, any> | null>('revoke_rights', {
    project_id: storageProjectId(args.projectId),
    asset_sha256: args.assetSha256,
    actor_id: args.actorId,
    reason: args.reason
  });
}

export async function ensureTransactionalJob(args: {
  id: string;
  kind: string;
  projectId: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  authContext?: Record<string, unknown> | null;
  payloadHash: string;
  idempotencyKey?: string | null;
}) {
  return rpc<{
    job: Record<string, any>;
    created: boolean;
    conflict: boolean;
  }>('ensure_job', {
    id: args.id,
    kind: args.kind,
    project_id: storageProjectId(args.projectId),
    workspace_id: args.workspaceId || null,
    actor_user_id: args.actorUserId || null,
    auth_context: args.authContext || null,
    payload_hash: args.payloadHash,
    idempotency_key: args.idempotencyKey || null
  });
}

export async function readTransactionalJob(id: string) {
  return rpc<Record<string, any> | null>('read_job', { id });
}

export async function claimTransactionalJob(args: {
  id: string;
  leaseToken: string;
  attempt: number;
  leaseMs: number;
  maxGlobalActive?: number | null;
  maxProjectActive?: number | null;
}) {
  return rpc<{
    claimed: boolean;
    job: Record<string, any>;
    reason?: string;
    retry_after_ms?: number;
    active?: number;
    limit?: number;
  }>('claim_job', {
    id: args.id,
    lease_token: args.leaseToken,
    attempt: Math.max(1, Math.floor(args.attempt || 1)),
    lease_ms: Math.max(5000, Math.min(300000, Math.floor(args.leaseMs || 120000))),
    max_global_active: Math.max(1, Math.min(2000, Math.floor(Number(args.maxGlobalActive) || 250))),
    max_project_active: Math.max(1, Math.min(100, Math.floor(Number(args.maxProjectActive) || 8)))
  });
}

export async function readTransactionalJobCapacity() {
  return rpc<{
    active_processing: number;
    queued: number;
    retrying: number;
    failed: number;
    succeeded: number;
    at: string;
  }>('job_capacity', {
    scope_project_id: storageProjectId('_capacity_')
  });
}

export async function claimRecoverableTransactionalJobs(args: {
  recoveryToken: string;
  limit?: number | null;
  minAgeMs?: number | null;
}) {
  return rpc<{
    claimed: boolean;
    scope?: string;
    reason?: string;
    jobs: Array<{
      id: string;
      kind: string;
      project_id: string;
      status: string;
      attempts: number;
    }>;
  }>('claim_recoverable_jobs', {
    scope_project_id: storageProjectId('_recovery_'),
    recovery_token: clean(args.recoveryToken, 180),
    limit: Math.max(1, Math.min(100, Math.floor(Number(args.limit) || 25))),
    min_age_ms: Math.max(
      0,
      Math.min(
        3600000,
        Math.floor(args.minAgeMs === null || args.minAgeMs === undefined ? 30000 : Number(args.minAgeMs))
      )
    )
  });
}

export async function transitionTransactionalJob(args: {
  id: string;
  toStatus: 'queued' | 'retrying' | 'succeeded' | 'failed' | 'cancelled';
  leaseToken?: string | null;
  attempt?: number | null;
  lastError?: string | null;
  resultRef?: string | null;
  queueEventId?: string | null;
}) {
  return rpc<Record<string, any> | null>('transition_job', {
    id: args.id,
    to_status: args.toStatus,
    lease_token: args.leaseToken || null,
    attempt: args.attempt ?? null,
    last_error: clean(args.lastError, 1200) || null,
    result_ref: args.resultRef || null,
    queue_event_id: args.queueEventId || null
  });
}

export function providerGuardScopeKey() {
  const scope = runtimeScope();
  return scope.production ? 'prod' : 'preview:' + scope.deploy_id;
}

export async function acquireTransactionalProviderGuard(args: {
  providerKey: string;
  leaseId: string;
  operationId?: string | null;
  maxActive?: number | null;
  leaseMs?: number | null;
}) {
  return rpc<{
    acquired: boolean;
    reason: string;
    lease_id?: string;
    retry_after_ms?: number;
    active?: number;
    limit?: number;
    state?: string;
    open_until?: string | null;
    error_class?: string | null;
  }>('provider_guard_acquire', {
    scope_key: providerGuardScopeKey(),
    provider_key: clean(args.providerKey, 240),
    lease_id: clean(args.leaseId, 180),
    operation_id: clean(args.operationId, 220) || null,
    max_active: Math.max(1, Math.min(500, Math.floor(Number(args.maxActive) || 20))),
    lease_ms: Math.max(5000, Math.min(300000, Math.floor(Number(args.leaseMs) || 45000)))
  });
}

export async function releaseTransactionalProviderGuard(args: {
  leaseId: string;
  outcome: 'success' | 'failure' | 'neutral';
  errorClass?: string | null;
  errorDetail?: string | null;
  cooldownMs?: number | null;
}) {
  return rpc<Record<string, any>>('provider_guard_release', {
    lease_id: clean(args.leaseId, 180),
    outcome: args.outcome,
    error_class: clean(args.errorClass, 120) || null,
    error_detail: clean(args.errorDetail, 800) || null,
    cooldown_ms: Math.max(1000, Math.min(3600000, Math.floor(Number(args.cooldownMs) || 60000)))
  });
}

export async function readTransactionalProviderGuardStatus(providerKey: string) {
  return rpc<Record<string, any>>('provider_guard_status', {
    scope_key: providerGuardScopeKey(),
    provider_key: clean(providerKey, 240)
  });
}

export async function transactionalRequestFingerprint(value: unknown) {
  return sha256Hex(JSON.stringify(value));
}
