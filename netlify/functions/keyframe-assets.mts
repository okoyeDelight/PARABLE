import {
  readKeyframeAsset,
  saveKeyframeAsset,
  signedKeyframeAssetUrl
} from './_lib/keyframe-assets.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store'
  }
});

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,180}$/.test(value);

export default async (request: Request) => {
  if (!['GET','POST'].includes(request.method)) return json({ error:'Method not allowed' },405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'),96);
    const hash = clean(url.searchParams.get('id'),64).toLowerCase();

    if (!projectId || !safeId(projectId) || !/^[a-f0-9]{64}$/.test(hash)) {
      return json({ error:'A valid projectId and asset id are required.' },400);
    }

    try {
      await authorizeProject(request,projectId,'project:read');
      const asset = await readKeyframeAsset(projectId,hash);
      if (!asset) return json({ error:'Keyframe asset was not found.' },404);
      return json({
        metadata:asset.metadata,
        preview_url:await signedKeyframeAssetUrl({
          projectId,
          hash,
          purpose:'preview',
          ttlSeconds:900
        })
      });
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body,handled.status);
      throw error;
    }
  }

  const body = await request.json().catch(()=>({})) as Record<string,any>;
  const projectId = clean(body.projectId,96);
  const storyVersion = clean(body.storyVersion,96);
  const sceneId = clean(body.sceneId,96);
  const shotId = clean(body.shotId,96);
  const mediaType = clean(body.mediaType || 'image/png',80);
  const base64 = String(body.base64 || '');

  if (![projectId,storyVersion,sceneId,shotId].every(value=>value&&safeId(value))) {
    return json({ error:'Valid projectId, storyVersion, sceneId and shotId are required.' },400);
  }
  if (!base64) return json({ error:'base64 image data is required.' },400);
  if (base64.length > 12_000_000) {
    return json({
      error:'This keyframe upload is too large for the JSON upload lane.',
      code:'KEYFRAME_UPLOAD_TOO_LARGE'
    },413);
  }

  try {
    await authorizeProject(request,projectId,'project:edit');

    const asset = await saveKeyframeAsset({
      base64,
      mediaType,
      projectId,
      storyVersion,
      sceneId,
      shotId,
      model:'human-upload',
      provider:'human',
      generationId:'upload_' + crypto.randomUUID().replaceAll('-',''),
      actualCostUsd:0
    });

    return json({
      metadata:asset,
      asset_uri:'parable://keyframe/' + asset.sha256,
      preview_url:await signedKeyframeAssetUrl({
        projectId,
        hash:asset.sha256,
        purpose:'preview',
        ttlSeconds:900
      }),
      immutable_binding:true
    },201);
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body,handled.status);
    return json({ error:error instanceof Error ? error.message : 'Keyframe upload failed.' },400);
  }
};

export const config = {
  path:'/api/keyframe-assets',
  rateLimit:{
    windowLimit:60,
    windowSize:60,
    aggregateBy:['ip','domain']
  }
};
