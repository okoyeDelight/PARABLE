import { getDeployStore, getStore } from '@netlify/blobs';
import { createSignedMediaUrl } from './media-signing.mts';

function stores(){
  const production=Netlify.context?.deploy?.context==='production';
  const make=(name:string)=>production
    ?getStore(name,{consistency:'strong'})
    :getDeployStore(name);
  return {
    bytes:make('parable-render-media-assets'),
    metadata:make('parable-render-media-meta')
  };
}

const clean=(value:unknown,max=1800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);

async function sha256Bytes(bytes:Uint8Array){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}

function key(projectId:string,hash:string){
  return 'project/'+projectId+'/asset/'+hash;
}

function metaKey(projectId:string,hash:string){
  return 'project/'+projectId+'/meta/'+hash;
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
  let response:Response;
  try{
    response=await fetch(args.sourceUrl,{
      headers:{accept:'video/mp4,video/webm,video/quicktime,*/*;q=0.1'},
      signal:AbortSignal.timeout(30000)
    });
  }catch(error){
    throw new Error('Render media download failed: '+clean(error instanceof Error?error.message:error,900));
  }

  if(!response.ok)throw new Error('Render media download returned HTTP '+response.status+'.');

  const limit=maxBytes();
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>limit){
    throw Object.assign(
      new Error('Rendered clip exceeds the configured immutable-ingestion limit.'),
      {code:'RENDER_MEDIA_TOO_LARGE',byte_length:declared,max_bytes:limit}
    );
  }

  const contentType=clean(response.headers.get('content-type'),120).split(';')[0].toLowerCase();
  const allowed=['video/mp4','video/webm','video/quicktime','application/octet-stream'];
  if(!allowed.includes(contentType)){
    throw new Error('Rendered clip returned unsupported media type '+(contentType||'unknown')+'.');
  }

  const blob=await response.blob();
  if(!blob.size||blob.size>limit){
    throw Object.assign(
      new Error('Rendered clip is empty or exceeds the configured immutable-ingestion limit.'),
      {code:'RENDER_MEDIA_TOO_LARGE',byte_length:blob.size,max_bytes:limit}
    );
  }

  const arrayBuffer=await blob.arrayBuffer();
  const hash=await sha256Bytes(new Uint8Array(arrayBuffer));
  const assetKey=key(args.projectId,hash);
  const existing=await stores().bytes.getMetadata(assetKey);
  if(!existing){
    await stores().bytes.set(assetKey,blob,{onlyIfNew:true} as any);
  }

  const metadata={
    media_asset_version:'parable-render-media-asset-v1',
    sha256:hash,
    project_id:args.projectId,
    attempt_id:args.attemptId,
    media_type:contentType==='application/octet-stream'?'video/mp4':contentType,
    byte_length:blob.size,
    source_provider:clean(args.provider,80),
    source_provider_request_id:clean(args.providerRequestId,300)||null,
    source_url_hash:await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(args.sourceUrl)
    ).then((digest)=>[...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('')),
    created_at:new Date().toISOString()
  };

  await stores().metadata.setJSON(metaKey(args.projectId,hash),metadata);
  return metadata;
}

export async function readRenderMedia(projectId:string,hash:string){
  if(!/^[a-f0-9]{64}$/i.test(hash))return null;
  const [bytes,metadata]=await Promise.all([
    stores().bytes.get(key(projectId,hash),{type:'blob'}) as Promise<Blob|null>,
    stores().metadata.get(metaKey(projectId,hash),{type:'json'}) as Promise<Record<string,any>|null>
  ]);
  if(!bytes||!metadata)return null;
  return {bytes,metadata};
}

export async function signedRenderMediaUrl(args:{
  projectId:string;
  hash:string;
  purpose?:string;
  ttlSeconds?:number;
}){
  return createSignedMediaUrl({
    route:'/api/render-media-asset',
    assetId:args.hash,
    projectId:args.projectId,
    purpose:args.purpose||'render-processing',
    ttlSeconds:args.ttlSeconds||1800
  });
}
