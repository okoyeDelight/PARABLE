import { getContext } from '@netlify/functions';

const clean = (value: unknown, max = 2000) => String(value ?? '').trim().slice(0, max);

function runtime() {
  let context: any = null;
  try { context = getContext(); } catch {}
  const deployContext = context?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  const production = deployContext === 'production';

  const deployId = clean(context?.deploy?.id || Netlify.context?.deploy?.id, 120);
  const siteName = clean(context?.site?.name || Netlify.context?.site?.name, 160);
  // Signed media must resolve against the exact immutable deploy. In a Deploy
  // Preview, context.site.url can point at production; using it would make a
  // valid preview asset URL land on the production SPA instead of this deploy's
  // private media function/store.
  const exactDeployOrigin = deployId && siteName
    ? 'https://' + deployId + '--' + siteName + '.netlify.app'
    : '';

  const origin = (
    exactDeployOrigin ||
    context?.deploy?.url ||
    Netlify.env.get('DEPLOY_URL') ||
    Netlify.env.get('DEPLOY_PRIME_URL') ||
    context?.site?.url ||
    Netlify.env.get('URL') ||
    ''
  ).replace(/\/$/, '');

  return { production, origin };
}

function signingSecret() {
  const dedicated = clean(Netlify.env.get('PARABLE_MEDIA_SIGNING_SECRET'), 5000);
  if (dedicated) return { secret: dedicated, dedicated: true };

  const scope = runtime();
  if (!scope.production) {
    const seed = clean(Netlify.env.get('OPENROUTER_API_KEY') || Netlify.env.get('FAL_KEY'), 5000);
    if (seed) return { secret: 'parable-media-preview-v1|' + seed, dedicated: false };
  }

  return { secret: '', dedicated: false };
}

async function hmac(input: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2,'0')).join('');
}

export function mediaSigningHealth() {
  const state = signingSecret();
  return {
    configured: Boolean(state.secret),
    dedicated_secret: state.dedicated,
    production_ready: Boolean(state.secret && state.dedicated)
  };
}

export async function createSignedMediaUrl(args: {
  route: string;
  assetId: string;
  projectId: string;
  purpose: string;
  ttlSeconds?: number;
  origin?: string;
}) {
  const state = signingSecret();
  if (!state.secret) throw new Error('PARABLE media signing is not configured.');

  const runtimeOrigin = runtime().origin;
  const requestedOrigin = clean(args.origin, 2000).replace(/\/$/, '');
  const origin = /^https?:\/\//i.test(requestedOrigin) ? requestedOrigin : runtimeOrigin;
  if (!origin) throw new Error('PARABLE deployment origin is unavailable for signed media URLs.');

  const exp = Math.floor(Date.now()/1000) + Math.max(60, Math.min(3600, Math.floor(args.ttlSeconds || 900)));
  const purpose = clean(args.purpose, 80);
  const canonical = [args.assetId, args.projectId, purpose, exp].join('|');
  const sig = await hmac(canonical, state.secret);

  const url = new URL(args.route, origin);
  url.searchParams.set('id', args.assetId);
  url.searchParams.set('projectId', args.projectId);
  url.searchParams.set('purpose', purpose);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return url.toString();
}

export async function verifySignedMediaRequest(args: {
  assetId: string;
  projectId: string;
  purpose: string;
  exp: string;
  sig: string;
}) {
  const state = signingSecret();
  if (!state.secret) return false;

  const exp = Number(args.exp);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now()/1000) || exp > Math.floor(Date.now()/1000) + 3700) {
    return false;
  }

  const canonical = [args.assetId, args.projectId, clean(args.purpose,80), Math.floor(exp)].join('|');
  const expected = await hmac(canonical, state.secret);
  const supplied = clean(args.sig, 128).toLowerCase();

  if (expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}
