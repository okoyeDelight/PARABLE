import { getDeployStore, getStore } from '@netlify/blobs';

export type AILane = 'protected' | 'benchmark';
export type AIStage = 'story-understanding' | 'film-critic';

type HealthEvent = {
  stage: AIStage;
  lane: AILane;
  provider: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
};

type Aggregate = {
  stage: AIStage;
  lane: AILane;
  provider: string;
  model: string;
  requests: number;
  successes: number;
  failures: number;
  avg_latency_ms: number;
  last_latency_ms: number;
  last_ok: boolean;
  last_error: string;
  last_seen_at: string;
};

type Snapshot = {
  version: 'ai-health-v1';
  updated_at: string;
  aggregates: Record<string, Aggregate>;
  recent: Array<HealthEvent & { at: string; error_class: string }>;
};

function healthStore() {
  const production = Netlify.context?.deploy?.context === 'production';
  return production
    ? getStore('parable-ai-health', { consistency: 'strong' })
    : getDeployStore('parable-ai-health');
}

const clean = (value: unknown, max = 600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function classifyAIError(error: unknown) {
  const text = clean(error instanceof Error ? error.message : error, 500).toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('abort') || text.includes('timeout')) return 'timeout';
  if (text.includes('429') || text.includes('rate limit')) return 'rate-limit';
  if (text.includes('data policy') || text.includes('zdr') || text.includes('privacy')) return 'privacy-policy';
  if (text.includes('unavailable') || text.includes('no endpoints')) return 'unavailable';
  if (text.includes('json') || text.includes('schema') || text.includes('parse')) return 'schema';
  if (text.includes('401') || text.includes('403') || text.includes('auth')) return 'auth';
  if (/\b5\d\d\b/.test(text)) return 'upstream-5xx';
  return 'other';
}

export async function recordAIHealth(event: HealthEvent) {
  try {
    const store = healthStore();
    const current = await store.get('router-health-v1', { type: 'json' }) as Snapshot | null;
    const now = new Date().toISOString();
    const snapshot: Snapshot = current?.version === 'ai-health-v1'
      ? current
      : { version: 'ai-health-v1', updated_at: now, aggregates: {}, recent: [] };

    const provider = clean(event.provider, 80) || 'unknown';
    const model = clean(event.model, 180) || 'unknown';
    const key = `${event.stage}:${event.lane}:${provider}:${model}`;
    const previous = snapshot.aggregates[key];
    const requests = (previous?.requests || 0) + 1;
    const latency = Math.max(0, Math.round(Number(event.latency_ms) || 0));
    const previousTotal = (previous?.avg_latency_ms || 0) * (previous?.requests || 0);
    const error = event.ok ? '' : clean(event.error, 500);

    snapshot.aggregates[key] = {
      stage: event.stage,
      lane: event.lane,
      provider,
      model,
      requests,
      successes: (previous?.successes || 0) + (event.ok ? 1 : 0),
      failures: (previous?.failures || 0) + (event.ok ? 0 : 1),
      avg_latency_ms: Math.round((previousTotal + latency) / requests),
      last_latency_ms: latency,
      last_ok: event.ok,
      last_error: error,
      last_seen_at: now
    };

    snapshot.recent = [
      {
        stage: event.stage,
        lane: event.lane,
        provider,
        model,
        ok: event.ok,
        latency_ms: latency,
        error,
        error_class: classifyAIError(error),
        at: now
      },
      ...(snapshot.recent || [])
    ].slice(0, 40);
    snapshot.updated_at = now;
    await store.setJSON('router-health-v1', snapshot);
  } catch {
    // Health telemetry must never break the creative workflow.
  }
}

export async function readAIHealth() {
  try {
    const value = await healthStore().get('router-health-v1', { type: 'json' }) as Snapshot | null;
    return value || { version: 'ai-health-v1', updated_at: null, aggregates: {}, recent: [] };
  } catch {
    return { version: 'ai-health-v1', updated_at: null, aggregates: {}, recent: [] };
  }
}
