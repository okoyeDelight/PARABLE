import { getContext } from '@netlify/functions';
import { readJobHealth } from './_lib/job-store.mts';
import { getDeployStore, getStore } from '@netlify/blobs';
import {
  readTransactionalJobCapacity,
  transactionalStateConfigured,
  transactionalStateHealth,
  transactionalStateMode
} from './_lib/transactional-state.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function probeStore() {
  const production = Netlify.context?.deploy?.context === 'production';
  return production
    ? getStore('parable-projects', { consistency: 'strong' })
    : getDeployStore('parable-projects');
}

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const started = Date.now();
  let storageOk = false;
  let storageLatency = 0;

  try {
    const t = Date.now();
    await probeStore().list({ prefix: 'system/' });
    storageLatency = Date.now() - t;
    storageOk = true;
  } catch {
    storageOk = false;
  }

  let runtimeContext: any = null;
  try { runtimeContext = getContext(); } catch {}

  const deployContext = runtimeContext?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  const openrouter = Boolean(Netlify.env.get('OPENROUTER_API_KEY'));
  const asyncKey = Boolean(Netlify.env.get('AWL_API_KEY'));
  const queueMode = Netlify.env.get('PARABLE_QUEUE_MODE') || (deployContext === 'deploy-preview' ? 'background' : 'auto');
  const jobHealth = await readJobHealth();

  const stateMode = transactionalStateMode();
  let transactionalStateOk = stateMode !== 'postgres';
  let transactionalStateLatency = 0;
  let transactionalStateError: string | null = null;
  let transactionalStateUpstream: Record<string, unknown> | null = null;
  let jobCapacity: Record<string, unknown> | null = null;

  if (stateMode === 'postgres') {
    const t = Date.now();
    try {
      transactionalStateUpstream = await transactionalStateHealth();
      transactionalStateOk = transactionalStateUpstream?.ok === true;
      if (transactionalStateOk) {
        jobCapacity = await readTransactionalJobCapacity().catch(() => null);
      }
    } catch (error) {
      transactionalStateOk = false;
      transactionalStateError = error instanceof Error ? error.message : String(error);
    } finally {
      transactionalStateLatency = Date.now() - t;
    }
  }

  const healthy = storageOk && transactionalStateOk;
  return json({
    ok: healthy,
    runtime: 'parable-scale-foundation-v4',
    deploy_context: deployContext,
    checks: {
      blob_state_layer: {
        ok: storageOk,
        latency_ms: storageLatency
      },
      durable_workloads: {
        extension_installed: true,
        api_key_visible_to_runtime: asyncKey,
        queue_mode: queueMode,
        primary_backend: 'async-workloads',
        fallback_backend: 'netlify-background',
        fallback_enabled: queueMode !== 'async',
        endpoint: '/api/jobs'
      },
      protected_ai: {
        configured: openrouter,
        fallback_available: true
      },
      durable_job_health: jobHealth,
      worker_capacity: {
        authority: stateMode === 'postgres' ? 'postgres' : 'blob-compatibility',
        configured_global_limit: Math.max(1, Math.min(2000, Math.floor(Number(Netlify.env.get('PARABLE_JOB_MAX_ACTIVE')) || 250))),
        configured_project_limit: Math.max(1, Math.min(100, Math.floor(Number(Netlify.env.get('PARABLE_JOB_MAX_PROJECT_ACTIVE')) || 8))),
        snapshot: jobCapacity
      },
      transactional_state: {
        mode: stateMode,
        configured: transactionalStateConfigured(),
        ok: transactionalStateOk,
        latency_ms: transactionalStateLatency,
        error: transactionalStateError,
        upstream: transactionalStateUpstream
      }
    },
    architecture: {
      target_concurrent_active_users: 1000,
      heavy_ai_request_path: 'redundant-durable-async',
      queue_backend_abstraction: true,
      single_queue_dependency: false,
      job_idempotency: true,
      workload_retries: true,
      workload_execution_leases: true,
      telemetry_write_strategy: 'append-only-sharded',
      production_blob_consistency: 'strong',
      project_concurrency_guard: stateMode === 'postgres'
        ? 'postgres-row-lock-plus-expected-revision-cas'
        : 'strong-blob-cas-revision-leases',
      project_revision_endpoint: '/api/project-revision',
      transactional_hot_state: stateMode === 'postgres'
        ? 'postgres-authoritative-cas'
        : 'blob-cas-compatibility-mode',
      immutable_state_archive: 'netlify-blobs',
      split_brain_write_fallback: false,
      state_adapter_version: 'transactional-state-v3',
      rights_authority: stateMode === 'postgres' ? 'postgres-versioned' : 'blob-compatibility',
      durable_job_lease_authority: stateMode === 'postgres' ? 'postgres-row-locks' : 'blob-cas-compatibility',
      overload_strategy: stateMode === 'postgres' ? 'durable-queue-plus-postgres-admission-control' : 'durable-queue-only',
      per_project_worker_fairness: stateMode === 'postgres'
    },
    deployment: {
      commit_ref: Netlify.env.get('COMMIT_REF') || null,
      deploy_id: runtimeContext?.deploy?.id || Netlify.env.get('DEPLOY_ID') || null,
      deploy_url: runtimeContext?.site?.url || Netlify.env.get('DEPLOY_PRIME_URL') || null,
      immutable_url: runtimeContext?.deploy?.id && runtimeContext?.site?.name
        ? 'https://' + runtimeContext.deploy.id + '--' + runtimeContext.site.name + '.netlify.app'
        : Netlify.env.get('DEPLOY_URL') || Netlify.env.get('DEPLOY_PRIME_URL') || null,
      published: runtimeContext?.deploy?.published ?? null,
      site_name: runtimeContext?.site?.name || null,
      region: runtimeContext?.server?.region || null
    },
    measured_at: new Date().toISOString(),
    response_ms: Date.now() - started
  }, healthy ? 200 : 503);
};

export const config = {
  path: '/api/platform-health',
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
