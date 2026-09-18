export function composeHiggsfieldCredentials(args: {
  combined?: string | null;
  keyId?: string | null;
  keySecret?: string | null;
}) {
  const combined = String(args.combined || '').trim();
  if (combined && combined.includes(':')) return combined;

  const keyId = String(args.keyId || '').trim();
  const keySecret = String(args.keySecret || '').trim();
  if (keyId && keySecret) return keyId + ':' + keySecret;

  return '';
}

export function readHiggsfieldCredentials() {
  return composeHiggsfieldCredentials({
    combined: Netlify.env.get('HF_CREDENTIALS'),
    keyId: Netlify.env.get('HF_API_KEY_ID'),
    keySecret: Netlify.env.get('HF_API_KEY_SECRET')
  });
}
