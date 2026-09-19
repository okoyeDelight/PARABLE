export type HiggsfieldRuntimeState =
  | 'queued'
  | 'rendering'
  | 'succeeded'
  | 'failed'
  | 'moderated'
  | 'unknown';

const clean = (value: unknown, max = 1800) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalizeHiggsfieldResponse(body: any) {
  const providerStatus = clean(body?.status, 80).toLowerCase();
  const requestId = clean(body?.request_id || body?.requestId || body?.id, 320);
  const statusUrl = clean(body?.status_url, 1800);
  const assetUri = clean(
    body?.video?.url ||
    body?.data?.video?.url ||
    body?.output?.video?.url ||
    body?.jobs?.[0]?.results?.raw?.url ||
    body?.jobs?.[0]?.result?.url,
    1800
  );

  let state: HiggsfieldRuntimeState = 'unknown';
  if (providerStatus === 'queued') state = 'queued';
  else if (providerStatus === 'in_progress' || providerStatus === 'processing') state = 'rendering';
  else if (providerStatus === 'completed') state = assetUri ? 'succeeded' : 'unknown';
  else if (providerStatus === 'nsfw' || providerStatus === 'moderated') state = 'moderated';
  else if (providerStatus === 'failed' || providerStatus === 'canceled' || providerStatus === 'cancelled') state = 'failed';

  return {
    state,
    provider_status: providerStatus,
    request_id: requestId || null,
    status_url: statusUrl || (requestId
      ? 'https://api.higgsfield.ai/requests/' + encodeURIComponent(requestId) + '/status'
      : null),
    asset_uri: assetUri || null,
    seed: body?.seed ?? null
  };
}
