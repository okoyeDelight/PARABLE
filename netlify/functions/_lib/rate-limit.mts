import { getDeployStore, getStore } from '@netlify/blobs';

function rateStore() {
  const isProduction = Netlify.context?.deploy?.context === 'production';
  return isProduction
    ? getStore('parable-rate-limits', { consistency: 'strong' })
    : getDeployStore('parable-rate-limits');
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientFingerprint(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = request.headers.get('x-nf-client-connection-ip') || forwarded || 'unknown-client';
  const agent = request.headers.get('user-agent') || 'unknown-agent';
  return `${ip}|${agent.slice(0, 160)}`;
}

export async function checkRateLimit(request: Request, action: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const fingerprint = await hash(clientFingerprint(request));
  const key = `${action}/${bucket}/${fingerprint.slice(0, 32)}`;
  const store = rateStore();
  const existing = await store.get(key, { type: 'json' }).catch(() => null) as { count?: number } | null;
  const count = Number(existing?.count || 0);
  const resetAt = (bucket + 1) * windowMs;

  if (count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      reset_at: new Date(resetAt).toISOString(),
      retry_after_seconds: Math.max(1, Math.ceil((resetAt - now) / 1000))
    };
  }

  await store.setJSON(key, { count: count + 1, updated_at: new Date(now).toISOString() });
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - count - 1),
    reset_at: new Date(resetAt).toISOString(),
    retry_after_seconds: 0
  };
}
