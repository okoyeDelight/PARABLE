import { getDeployStore, getStore } from '@netlify/blobs';

export type AILane = 'protected' | 'benchmark';
export type AIStage =
  | 'story-understanding'
  | 'story-adaptation'
  | 'film-critic'
  | 'continuity-extraction'
  | 'shot-continuity-extraction'
  | 'keyframe-visual-inspection';

type HealthEvent = {
  stage: AIStage;
  lane: AILane;
  provider: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
};

type StoredEvent = HealthEvent & {
  id: string;
  at: string;
  error_class: string;
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

function healthStore(lane: AILane = 'protected') {
  // Synthetic benchmark telemetry is intentionally global so a long CI run
  // is not split across deploy-scoped stores when the moving Deploy Preview
  // alias advances to a newer commit. Benchmark events never contain
  // manuscript/prompt text. Protected non-production telemetry stays scoped
  // to its deploy so real test manuscripts cannot leak across previews.
  if (lane === 'benchmark') {
    return getStore('parable-ai-health-benchmark', { consistency: 'strong' });
  }

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

function hourPrefix(date: Date) {
  return [
    'events',
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0')
  ].join('/') + '/';
}

export async function recordAIHealth(event: HealthEvent) {
  try {
    const store = healthStore(event.lane);
    const now = new Date();
    const at = now.toISOString();
    const provider = clean(event.provider, 80) || 'unknown';
    const model = clean(event.model, 180) || 'unknown';
    const error = event.ok ? '' : clean(event.error, 500);
    const stored: StoredEvent = {
      id: 'health_' + crypto.randomUUID().replaceAll('-', ''),
      stage: event.stage,
      lane: event.lane,
      provider,
      model,
      ok: Boolean(event.ok),
      latency_ms: Math.max(0, Math.round(Number(event.latency_ms) || 0)),
      error,
      error_class: classifyAIError(error),
      at
    };

    const key = hourPrefix(now) + at.replace(/[:.]/g, '-') + '-' + stored.id.slice(-12);
    await store.setJSON(key, stored);
  } catch {
    // Telemetry is intentionally append-only and must never break creative work.
  }
}

function aggregate(events: StoredEvent[]) {
  const aggregates: Record<string, Aggregate> = {};
  for (const event of events) {
    const key = [event.stage, event.lane, event.provider, event.model].join(':');
    const previous = aggregates[key];
    const requests = (previous?.requests || 0) + 1;
    const totalLatency = (previous?.avg_latency_ms || 0) * (previous?.requests || 0) + event.latency_ms;
    aggregates[key] = {
      stage: event.stage,
      lane: event.lane,
      provider: event.provider,
      model: event.model,
      requests,
      successes: (previous?.successes || 0) + (event.ok ? 1 : 0),
      failures: (previous?.failures || 0) + (event.ok ? 0 : 1),
      avg_latency_ms: Math.round(totalLatency / requests),
      last_latency_ms: event.latency_ms,
      last_ok: event.ok,
      last_error: event.error || '',
      last_seen_at: event.at
    };
  }
  return aggregates;
}

export async function readAIHealth() {
  try {
    const now = new Date();
    const previousHour = new Date(now.getTime() - 60 * 60 * 1000);
    const prefixes = [...new Set([hourPrefix(now), hourPrefix(previousHour)])];
    const rows: StoredEvent[] = [];
    const stores = [healthStore('protected')];
    if (Netlify.context?.deploy?.context === 'deploy-preview') {
      stores.push(healthStore('benchmark'));
    }

    for (const store of stores) {
      for (const prefix of prefixes) {
        const { blobs } = await store.list({ prefix });
        const newest = blobs.slice(-300);
        const values = await Promise.all(
          newest.map(({ key }) => store.get(key, { type: 'json' }) as Promise<StoredEvent | null>)
        );
        rows.push(...values.filter(Boolean) as StoredEvent[]);
      }
    }

    const unique = [...new Map(rows.map((event) => [event.id, event])).values()];
    const recent = unique
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 200);

    return {
      version: 'ai-health-v2',
      updated_at: recent[0]?.at || null,
      window: 'approximately last 2 UTC hours',
      aggregates: aggregate([...recent].reverse()),
      recent: recent.slice(0, 60)
    };
  } catch {
    return {
      version: 'ai-health-v2',
      updated_at: null,
      window: 'approximately last 2 UTC hours',
      aggregates: {},
      recent: []
    };
  }
}
