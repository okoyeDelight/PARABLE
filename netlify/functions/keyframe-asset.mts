import { readKeyframeAsset } from './_lib/keyframe-assets.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(id)) return json({ error: 'A valid keyframe asset id is required.' }, 400);

  const asset = await readKeyframeAsset(id);
  if (!asset) return json({ error: 'Keyframe asset was not found.' }, 404);

  return new Response(asset.bytes, {
    status: 200,
    headers: {
      'content-type': String(asset.metadata.media_type || 'image/png'),
      'content-length': String(asset.metadata.byte_length || asset.bytes.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      'etag': '"' + id + '"',
      'x-content-type-options': 'nosniff'
    }
  });
};

export const config = {
  path: '/api/keyframe-asset',
  rateLimit: {
    windowLimit: 6000,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
