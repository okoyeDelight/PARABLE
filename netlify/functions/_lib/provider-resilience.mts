import {
  acquireTransactionalProviderGuard,
  readTransactionalProviderGuardStatus,
  releaseTransactionalProviderGuard,
  transactionalStateMode
} from './transactional-state.mts';

export type ProviderGuardLease = {
  provider_key: string;
  lease_id: string;
  operation_id: string | null;
  backend: 'postgres' | 'compatibility';
};

export class ProviderGuardError extends Error {
  code: string;
  reason: string;
  retry_after_ms: number;
  provider_key: string;

  constructor(args: {
    code: string;
    reason: string;
    retryAfterMs?: number;
    providerKey: string;
  }) {
    super(args.reason);
    this.name = 'ProviderGuardError';
    this.code = args.code;
    this.reason = args.reason;
    this.retry_after_ms = Math.max(0, Math.floor(Number(args.retryAfterMs) || 0));
    this.provider_key = args.providerKey;
  }
}

const clean = (value: unknown, max = 500) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function classifyProviderFailure(error: unknown) {
  const text = clean(error instanceof Error ? error.message : error, 1000).toLowerCase();
  if (!text) return 'unknown';
  if (
    text.includes('free-models-per-day') ||
    text.includes('quota exceeded') ||
    text.includes('insufficient credit') ||
    text.includes('insufficient balance') ||
    text.includes('billing')
  ) return 'quota';
  if (text.includes('429') || text.includes('rate limit') || text.includes('too many requests')) return 'rate-limit';
  if (
    text.includes('401') ||
    text.includes('403') ||
    text.includes('invalid api key') ||
    text.includes('unauthorized') ||
    text.includes('forbidden')
  ) return 'auth';
  if (text.includes('timeout') || text.includes('abort')) return 'timeout';
  if (text.includes('no endpoints') || text.includes('unavailable')) return 'provider-unavailable';
  if (/\b5\d\d\b/.test(text)) return 'upstream-5xx';
  if (text.includes('json') || text.includes('schema') || text.includes('empty response')) return 'invalid-response';
  return 'other';
}

function providerKey(service: string, provider: string, model: string) {
  const normalized = [service, provider, model]
    .map((part) => clean(part, 180).replace(/[^a-zA-Z0-9_.:/-]/g, '-'))
    .join(':')
    .slice(0, 240);
  return normalized || 'unknown:unknown:unknown';
}

function defaultMaxActive(service: string, provider: string) {
  const envKey = service === 'render'
    ? 'PARABLE_RENDER_PROVIDER_MAX_ACTIVE'
    : provider === 'groq'
      ? 'PARABLE_GROQ_MAX_ACTIVE'
      : 'PARABLE_OPENROUTER_MAX_ACTIVE';

  const fallback = service === 'render' ? 6 : provider === 'groq' ? 16 : 24;
  return Math.max(
    1,
    Math.min(500, Math.floor(Number(Netlify.env.get(envKey)) || fallback))
  );
}

export async function acquireProviderGuard(args: {
  service: 'ai' | 'render' | 'render-status';
  provider: string;
  model: string;
  operationId?: string | null;
  maxActive?: number | null;
  leaseMs?: number | null;
}) {
  const key = providerKey(args.service, args.provider, args.model);
  const leaseId = 'pguard_' + crypto.randomUUID().replaceAll('-', '');

  if (transactionalStateMode() !== 'postgres') {
    return {
      provider_key: key,
      lease_id: leaseId,
      operation_id: clean(args.operationId, 220) || null,
      backend: 'compatibility'
    } as ProviderGuardLease;
  }

  const result = await acquireTransactionalProviderGuard({
    providerKey: key,
    leaseId,
    operationId: args.operationId,
    maxActive: args.maxActive ?? defaultMaxActive(args.service, args.provider),
    leaseMs: args.leaseMs ?? (args.service === 'render' ? 60000 : 45000)
  });

  if (!result?.acquired) {
    const reason = clean(result?.reason, 120) || 'provider-guard-rejected';
    const code =
      reason === 'provider-capacity'
        ? 'PROVIDER_CAPACITY'
        : reason === 'circuit-open' || reason === 'circuit-half-open'
          ? 'PROVIDER_CIRCUIT_OPEN'
          : 'PROVIDER_GUARD_BUSY';

    throw new ProviderGuardError({
      code,
      reason,
      retryAfterMs: Number(result?.retry_after_ms) || 500,
      providerKey: key
    });
  }

  return {
    provider_key: key,
    lease_id: leaseId,
    operation_id: clean(args.operationId, 220) || null,
    backend: 'postgres'
  } as ProviderGuardLease;
}

function cooldownFor(errorClass: string) {
  if (errorClass === 'quota') return 15 * 60 * 1000;
  if (errorClass === 'auth') return 10 * 60 * 1000;
  if (errorClass === 'rate-limit') return 60 * 1000;
  if (errorClass === 'provider-unavailable') return 45 * 1000;
  if (errorClass === 'upstream-5xx') return 30 * 1000;
  if (errorClass === 'timeout') return 20 * 1000;
  return 15 * 1000;
}

export async function releaseProviderGuard(
  lease: ProviderGuardLease | null | undefined,
  args: {
    outcome: 'success' | 'failure' | 'neutral';
    error?: unknown;
    errorClass?: string | null;
    cooldownMs?: number | null;
  }
) {
  if (!lease || lease.backend !== 'postgres') {
    return { released: Boolean(lease), state: 'compatibility' };
  }

  const errorClass = args.errorClass || (args.outcome === 'failure' ? classifyProviderFailure(args.error) : '');
  return releaseTransactionalProviderGuard({
    leaseId: lease.lease_id,
    outcome: args.outcome,
    errorClass: errorClass || null,
    errorDetail: args.outcome === 'failure'
      ? clean(args.error instanceof Error ? args.error.message : args.error, 800)
      : null,
    cooldownMs: args.cooldownMs ?? cooldownFor(errorClass)
  });
}

export async function readProviderGuardStatus(args: {
  service: 'ai' | 'render' | 'render-status';
  provider: string;
  model: string;
}) {
  const key = providerKey(args.service, args.provider, args.model);
  if (transactionalStateMode() !== 'postgres') {
    return { exists: false, state: 'compatibility', active: 0, provider_key: key };
  }

  const status = await readTransactionalProviderGuardStatus(key);
  return { ...status, provider_key: key };
}
