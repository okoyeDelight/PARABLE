import { readKeyframeAsset } from './_lib/keyframe-assets.mts';
import { verifySignedMediaRequest } from './_lib/media-signing.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

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
  const projectId = String(url.searchParams.get('projectId') || '').trim();
  const id = String(url.searchParams.get('id') || '').trim().toLowerCase();
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(projectId) || !/^[a-f0-9]{64}$/.test(id)) {
    return json({ error: 'A valid projectId and keyframe asset id are required.' }, 400);
  }

  const purpose = String(url.searchParams.get('purpose') || '').trim();
  const exp = String(url.searchParams.get('exp') || '').trim();
  const sig = String(url.searchParams.get('sig') || '').trim();

  let allowed = false;
  if (purpose && exp && sig) {
    allowed = await verifySignedMediaRequest({
      assetId: id,
      projectId,
      purpose,
      exp,
      sig
    });
  }

  if (!allowed) {
    try {
      await authorizeProject(request, projectId, 'project:read');
      allowed = true;
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }
  }

  const asset = await readKeyframeAsset(projectId, id);
  if (!asset) return json({ error: 'Keyframe asset was not found.' }, 404);

  return new Response(asset.bytes, {
    status: 200,
    headers: {
      'content-type': String(asset.metadata.media_type || 'image/png'),
      'content-length': String(asset.metadata.byte_length || asset.bytes.byteLength),
      'cache-control': purpose === 'renderer' ? 'private, max-age=900' : 'private, max-age=300',
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
