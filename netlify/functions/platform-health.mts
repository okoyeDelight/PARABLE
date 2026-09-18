import { getContext } from '@netlify/functions';
import { readJobHealth } from './_lib/job-store.mts';
import { getDeployStore, getStore } from '@netlify/blobs';

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

  const healthy = storageOk;
  return json({
    ok: healthy,
    runtime: 'parable-scale-foundation-v1',
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
      durable_job_health: jobHealth
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
      project_concurrency_guard: 'strong-cas-revision-leases',
      project_revision_endpoint: '/api/project-revision',
      transactional_hot_state: 'optimistic-cas-active-postgres-schema-prepared'
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
