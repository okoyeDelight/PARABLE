import { getDeployStore, getStore } from '@netlify/blobs';
import { createSignedMediaUrl } from './media-signing.mts';
import {
  canonicalRenderMediaUri,
  parseCanonicalRenderMediaUri,
  readBoundedResponseBody,
  RenderMediaIngestError,
  validRenderMediaHash,
  validateProviderAssetUrl,
  detectRenderMediaType
} from './render-media-ingest-core.mts';
import type { RenderAttempt } from './render-foundation.mts';

function stores(){
  const production=Netlify.context?.deploy?.context==='production';
  const make=(name:string)=>production
    ?getStore(name,{consistency:'strong'})
    :getDeployStore(name);
  return {
    bytes:make('parable-render-media-assets'),
    metadata:make('parable-render-media-meta'),
    origins:make('parable-render-media-origins')
  };
}

const clean=(value:unknown,max=1800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const safePart=(value:unknown)=>String(value||'').replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,180);

async function sha256Bytes(bytes:Uint8Array){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}

async function sha256Text(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}

function key(projectId:string,hash:string){
  return 'project/'+safePart(projectId)+'/asset/'+hash;
}

function metaKey(projectId:string,hash:string){
  return 'project/'+safePart(projectId)+'/meta/'+hash;
}

function originKey(projectId:string,attemptId:string){
  return 'project/'+safePart(projectId)+'/attempt/'+safePart(attemptId);
}

function maxBytes(){
  const configured=Number(Netlify.env.get('PARABLE_RENDER_CLIP_MAX_BYTES')||96*1024*1024);
  return Number.isFinite(configured)
    ?Math.max(8*1024*1024,Math.min(256*1024*1024,Math.floor(configured)))
    :96*1024*1024;
}

export async function ingestRenderMedia(args:{
  projectId:string;
  attemptId:string;
  sourceUrl:string;
  provider:string;
  providerRequestId?:string|null;
}){
  const previousOrigin=await stores().origins.get(
    originKey(args.projectId,args.attemptId),
    {type:'json'}
  ) as Record<string,any>|null;
  if(previousOrigin?.sha256&&validRenderMediaHash(previousOrigin.sha256)){
    const existingAsset=await readRenderMedia(args.projectId,String(previousOrigin.sha256));
    if(existingAsset){
      return {
        ...existingAsset.metadata,
        sha256:String(previousOrigin.sha256).toLowerCase(),
        media_type:String(existingAsset.metadata.media_type||'video/mp4'),
        byte_length:Number(existingAsset.metadata.byte_length||existingAsset.bytes.size),
        storage:'parable-blobs-v1' as const,
        canonical_uri:canonicalRenderMediaUri(String(previousOrigin.sha256)),
        origin:previousOrigin,
        deduplicated:true
      };
    }
  }

  const sourceUrl=validateProviderAssetUrl(args.sourceUrl);
  let response:Response;
  try{
    response=await fetch(sourceUrl,{
      headers:{accept:'video/mp4,video/webm,video/quicktime,application/octet-stream;q=0.5'},
      redirect:'follow',
      signal:AbortSignal.timeout(45000)
    });
  }catch(error){
    if(error instanceof RenderMediaIngestError)throw error;
    throw new RenderMediaIngestError(
      'RENDER_MEDIA_DOWNLOAD_FAILED',
      'Render media download failed: '+clean(error instanceof Error?error.message:error,900),
      true
    );
  }

  if(!response.ok){
    throw new RenderMediaIngestError(
      'RENDER_MEDIA_DOWNLOAD_FAILED',
      'Render media download returned HTTP '+response.status+'.',
      response.status===408||response.status===429||response.status>=500,
      {http_status:response.status}
    );
  }

  const limit=maxBytes();
  const bytes=await readBoundedResponseBody(response,limit);
  const mediaType=detectRenderMediaType(bytes,response.headers.get('content-type'));
  const hash=await sha256Bytes(bytes);
  const assetKey=key(args.projectId,hash);

  // Content-addressing makes a same-hash race safe: competing writers can only
  // write identical bytes to this key. Netlify Blobs itself is not our lock.
  const existing=await stores().bytes.getMetadata(assetKey);
  if(!existing){
    const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    await stores().bytes.set(assetKey,buffer);
  }

  const metadata={
    media_asset_version:'parable-render-media-asset-v2',
    sha256:hash,
    project_id:args.projectId,
    media_type:mediaType,
    byte_length:bytes.byteLength,
    storage:'parable-blobs-v1' as const,
    canonical_uri:canonicalRenderMediaUri(hash),
    created_at:new Date().toISOString()
  };

  const existingMeta=await stores().metadata.get(metaKey(args.projectId,hash),{type:'json'}) as Record<string,any>|null;
  if(!existingMeta){
    await stores().metadata.setJSON(metaKey(args.projectId,hash),metadata);
  }

  const origin={
    render_media_origin_version:'parable-render-media-origin-v1',
    project_id:args.projectId,
    attempt_id:args.attemptId,
    sha256:hash,
    source_provider:clean(args.provider,80),
    source_provider_request_id:clean(args.providerRequestId,300)||null,
    source_url_hash:await sha256Text(sourceUrl),
    ingested_at:new Date().toISOString()
  };
  await stores().origins.setJSON(originKey(args.projectId,args.attemptId),origin);

  return {
    ...(existingMeta||metadata),
    sha256:hash,
    media_type:mediaType,
    byte_length:bytes.byteLength,
    storage:'parable-blobs-v1' as const,
    canonical_uri:canonicalRenderMediaUri(hash),
    origin
  };
}

export async function readRenderMedia(projectId:string,hash:string){
  if(!validRenderMediaHash(hash))return null;
  const normalized=hash.toLowerCase();
  const [bytes,metadata]=await Promise.all([
    stores().bytes.get(key(projectId,normalized),{type:'blob'}) as Promise<Blob|null>,
    stores().metadata.get(metaKey(projectId,normalized),{type:'json'}) as Promise<Record<string,any>|null>
  ]);
  if(!bytes||!metadata||metadata.project_id!==projectId)return null;
  return {bytes,metadata};
}

export async function readRenderMediaOrigin(projectId:string,attemptId:string){
  return stores().origins.get(originKey(projectId,attemptId),{type:'json'}) as Promise<Record<string,any>|null>;
}

export async function signedRenderMediaUrl(args:{
  projectId:string;
  hash:string;
  purpose?:string;
  ttlSeconds?:number;
}){
  if(!validRenderMediaHash(args.hash))throw new Error('A valid render media SHA-256 is required.');
  return createSignedMediaUrl({
    route:'/api/render-media-asset',
    assetId:args.hash.toLowerCase(),
    projectId:args.projectId,
    purpose:args.purpose||'render-processing',
    ttlSeconds:args.ttlSeconds||1800
  });
}

export async function resolveRenderMediaUrl(attempt:Pick<
  RenderAttempt,
  'project_id'|'asset_uri'|'asset_sha256'|'asset_storage'
>,purpose='render-processing'){
  const canonicalHash=parseCanonicalRenderMediaUri(attempt.asset_uri);
  const hash=String(attempt.asset_sha256||canonicalHash||'').toLowerCase();

  if(attempt.asset_storage==='parable-blobs-v1'||canonicalHash){
    if(!validRenderMediaHash(hash)){
      throw new Error('Immutable render media is missing its content SHA-256.');
    }
    if(canonicalHash&&canonicalHash!==hash){
      throw new Error('Render media canonical URI does not match its stored SHA-256.');
    }
    const stored=await readRenderMedia(attempt.project_id,hash);
    if(!stored)throw new Error('Immutable PARABLE render media bytes are missing.');
    return signedRenderMediaUrl({
      projectId:attempt.project_id,
      hash,
      purpose,
      ttlSeconds:1800
    });
  }

  // Compatibility for render attempts created before immutable ingestion became
  // mandatory. New provider completions never take this path.
  const legacy=clean(attempt.asset_uri,1800);
  if(/^https:\/\//i.test(legacy))return legacy;
  throw new Error('Completed render has no resolvable PARABLE-owned video asset.');
}
