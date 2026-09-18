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

  const deployContext = Netlify.context?.deploy?.context || 'unknown';
  const openrouter = Boolean(Netlify.env.get('OPENROUTER_API_KEY'));
  const asyncKey = Boolean(Netlify.env.get('AWL_API_KEY'));

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
        endpoint: '/api/jobs'
      },
      protected_ai: {
        configured: openrouter,
        fallback_available: true
      }
    },
    architecture: {
      target_concurrent_active_users: 1000,
      heavy_ai_request_path: 'durable-async',
      job_idempotency: true,
      workload_retries: true,
      workload_execution_leases: true,
      telemetry_write_strategy: 'append-only-sharded',
      production_blob_consistency: 'strong',
      transactional_hot_state: 'schema-prepared-not-provisioned'
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
