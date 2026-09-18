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

type RpcResult<T> = T;

const clean = (value: unknown, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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

async function runtimeSigningSecret() {
  const dedicated = String(Netlify.env.get('PARABLE_STATE_RPC_SECRET') || '').trim();
  if (dedicated) return dedicated;

  const scope = runtimeScope();
  if (!scope.production) {
    const source = String(Netlify.env.get('OPENROUTER_API_KEY') || '').trim();
    if (source) {
      // Preview-only bootstrap: derive an independent HMAC key from an already
      // secret server credential. The source secret and derived value never
      // leave the server or appear in API responses/logs.
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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

function providerErrorCode(body: any, status: number) {
  const text = [
    body?.message,
    body?.details,
    body?.hint,
    body?.code
  ].filter(Boolean).join(' ');

  if (/PROJECT_REVISION_CONFLICT/i.test(text)) return 'PROJECT_REVISION_CONFLICT';
  if (/PROVIDER_TRANSACTION_REQUEST_CONFLICT/i.test(text)) return 'PROVIDER_TRANSACTION_REQUEST_CONFLICT';
  if (/PROVIDER_TRANSACTION_STATE_CONFLICT/i.test(text)) return 'PROVIDER_TRANSACTION_STATE_CONFLICT';
  if (/RUNTIME_REPLAY_REJECTED/i.test(text)) return 'RUNTIME_REPLAY_REJECTED';
  if (/RUNTIME_SIGNATURE|RUNTIME_REQUEST_EXPIRED/i.test(text)) return 'RUNTIME_AUTH_REJECTED';
  if (status === 429) return 'TRANSACTIONAL_STATE_RATE_LIMITED';
  if (status >= 500) return 'TRANSACTIONAL_STATE_UPSTREAM_FAILED';
  return 'TRANSACTIONAL_STATE_RPC_REJECTED';
}

async function rpc<T>(action: string, payload: Record<string, unknown>): Promise<RpcResult<T>> {
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
        'x-parable-state-engine': 'postgres-v1'
      },
      body: JSON.stringify({
        p_action: action,
        p_timestamp_ms: timestamp,
        p_nonce: nonce,
        p_payload_text: payloadText,
        p_signature: signature
      })
    });
  } catch (error) {
    throw new TransactionalStateError(
      'TRANSACTIONAL_STATE_NETWORK_FAILED',
      'PARABLE could not reach the transactional state service.',
      503,
      true,
      clean(error instanceof Error ? error.message : error, 800)
    );
  }

  const body = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const code = providerErrorCode(body, response.status);
    const message = clean(body?.message || body?.error || 'Transactional state request failed.', 1200);
    throw new TransactionalStateError(
      code,
      message,
      code === 'PROJECT_REVISION_CONFLICT' || code === 'PROVIDER_TRANSACTION_STATE_CONFLICT' ? 409 : response.status,
      response.status >= 500 || response.status === 429,
      body
    );
  }

  return body as T;
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

export async function transactionalStateHealth() {
  return rpc<Record<string, unknown>>('health', {});
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
  failureClass?: string | null;
  failureDetail?: string | null;
  actualCostUsd?: number | null;
}) {
  return rpc<Record<string, any>>('transition_provider_transaction', {
    project_id: storageProjectId(args.projectId),
    id: args.id,
    from_states: args.fromStates,
    to_state: args.toState,
    provider_request_id: args.providerRequestId || null,
    failure_class: args.failureClass || null,
    failure_detail: args.failureDetail || null,
    actual_cost_usd: args.actualCostUsd ?? null
  });
}

export async function transactionalRequestFingerprint(value: unknown) {
  return sha256Hex(JSON.stringify(value));
}


export async function bootstrapDerivedPreviewStateSecret(token: string) {
  const scope = runtimeScope();
  if (scope.production || scope.deploy_context !== 'deploy-preview') {
    throw new TransactionalStateError(
      'STATE_BOOTSTRAP_PREVIEW_ONLY',
      'Runtime secret bootstrap is restricted to deploy previews.',
      404,
      false
    );
  }

  const bootstrapToken = clean(token, 240);
  if (!bootstrapToken) {
    throw new TransactionalStateError(
      'STATE_BOOTSTRAP_TOKEN_MISSING',
      'No one-time transactional-state bootstrap token is configured.',
      503,
      false
    );
  }

  const url = String(Netlify.env.get('PARABLE_SUPABASE_URL') || '').replace(/\/$/, '');
  const key = String(Netlify.env.get('PARABLE_SUPABASE_PUBLISHABLE_KEY') || '').trim();
  const secret = await runtimeSigningSecret();

  if (!url || !key || !secret) {
    throw new TransactionalStateError(
      'STATE_BOOTSTRAP_NOT_CONFIGURED',
      'The preview cannot derive and register its transactional-state signing key.',
      503,
      false
    );
  }

  let response: Response;
  try {
    response = await fetch(url + '/rest/v1/rpc/parable_runtime_bootstrap', {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: 'Bearer ' + key,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        p_token: bootstrapToken,
        p_secret: secret
      })
    });
  } catch (error) {
    throw new TransactionalStateError(
      'STATE_BOOTSTRAP_NETWORK_FAILED',
      'PARABLE could not reach the one-time database bootstrap endpoint.',
      503,
      true,
      clean(error instanceof Error ? error.message : error, 800)
    );
  }

  const body = await response.json().catch(() => null) as any;
  if (!response.ok || body?.ok !== true) {
    throw new TransactionalStateError(
      'STATE_BOOTSTRAP_REJECTED',
      clean(body?.message || body?.error || 'The one-time database bootstrap was rejected.', 1000),
      response.status || 503,
      false,
      body
    );
  }

  return {
    ok: true,
    bootstrap_consumed: body?.bootstrap_consumed === true,
    key_id: clean(body?.key_id, 120) || null,
    deploy_context: scope.deploy_context,
    secret_exposed: false
  };
}
