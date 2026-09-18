export function composeHiggsfieldCredentials(args: {
  combined?: string | null;
  keyId?: string | null;
  keySecret?: string | null;
}) {
  const combined = String(args.combined || '').trim();
  if (combined && combined.includes(':')) return combined;

  const keyId = String(args.keyId || '').trim();
  const keySecret = String(args.keySecret || '').trim();

  // Some Higgsfield credential UIs hand the caller one opaque credential string.
  // If the value already has KEY_ID:KEY_SECRET shape, accept it as-is even when
  // the user stored it under HF_API_KEY_SECRET. We never split, print or expose it.
  if (!keyId && keySecret.includes(':')) return keySecret;

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
