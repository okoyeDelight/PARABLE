import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';
import { createSignedMediaUrl } from './media-signing.mts';

function runtimeScope() {
  let context:any=null;
  try{context=getContext();}catch{}
  const deployContext=context?.deploy?.context||Netlify.context?.deploy?.context||'unknown';
  const production=deployContext==='production';
  const deployId=String(context?.deploy?.id||Netlify.context?.deploy?.id||'local')
    .replace(/[^a-zA-Z0-9_-]/g,'')
    .slice(0,96);
  return {
    production,
    prefix:production?'':'deploy/'+(deployId||'local')+'/'
  };
}

function stores(){
  const scope=runtimeScope();
  return {
    scope,
    bytes:getStore(scope.production?'parable-motion-frame-assets':'parable-motion-frame-assets-sandbox',{consistency:'strong'}),
    metadata:getStore(scope.production?'parable-motion-frame-meta':'parable-motion-frame-meta-sandbox',{consistency:'strong'})
  };
}

const clean=(value:unknown,max=1800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);

async function sha256Bytes(bytes:Uint8Array){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}

function key(projectId:string,hash:string){
  return stores().scope.prefix+'project/'+projectId+'/asset/'+hash;
}

function metaKey(projectId:string,hash:string){
  return stores().scope.prefix+'project/'+projectId+'/meta/'+hash;
}

export async function ingestTrustedMotionFrame(args:{
  projectId:string;
  attemptId:string;
  sourceUrl:string;
  sourceProvider:string;
  sourceRequestId?:string|null;
  role:'first'|'sample'|'handoff';
  timestampSeconds:number;
}){
  let response:Response;
  try{
    response=await fetch(args.sourceUrl,{
      headers:{accept:'image/png,image/jpeg,image/webp,*/*;q=0.1'},
      signal:AbortSignal.timeout(15000)
    });
  }catch(error){
    throw new Error('Trusted frame download failed: '+clean(error instanceof Error?error.message:error,700));
  }

  if(!response.ok)throw new Error('Trusted frame download returned HTTP '+response.status+'.');

  const length=Number(response.headers.get('content-length')||0);
  if(length>15*1024*1024)throw new Error('Extracted frame exceeds the 15 MB evidence-asset limit.');

  const mediaType=clean(response.headers.get('content-type'),120).split(';')[0].toLowerCase();
  if(!['image/png','image/jpeg','image/webp'].includes(mediaType)){
    throw new Error('Extracted frame has an unsupported media type.');
  }

  const buffer=await response.arrayBuffer();
  if(!buffer.byteLength||buffer.byteLength>15*1024*1024){
    throw new Error('Extracted frame is empty or exceeds the 15 MB evidence-asset limit.');
  }

  const bytes=new Uint8Array(buffer);
  const hash=await sha256Bytes(bytes);
  const assetKey=key(args.projectId,hash);
  const existing=await stores().bytes.getMetadata(assetKey);
  if(!existing){
    await stores().bytes.set(assetKey,buffer,{onlyIfNew:true} as any);
  }

  const metadata={
    frame_asset_version:'parable-motion-frame-asset-v1',
    sha256:hash,
    project_id:args.projectId,
    attempt_id:args.attemptId,
    media_type:mediaType,
    byte_length:buffer.byteLength,
    role:args.role,
    timestamp_seconds:Math.max(0,Number(args.timestampSeconds)||0),
    source_provider:clean(args.sourceProvider,80),
    source_request_id:clean(args.sourceRequestId,300)||null,
    created_at:new Date().toISOString()
  };
  await stores().metadata.setJSON(metaKey(args.projectId,hash),metadata);

  return metadata;
}

export async function readMotionFrameAsset(projectId:string,hash:string){
  if(!/^[a-f0-9]{64}$/i.test(hash))return null;
  const [bytes,metadata]=await Promise.all([
    stores().bytes.get(key(projectId,hash),{type:'arrayBuffer'}) as Promise<ArrayBuffer|null>,
    stores().metadata.get(metaKey(projectId,hash),{type:'json'}) as Promise<Record<string,any>|null>
  ]);
  if(!bytes||!metadata)return null;
  return {bytes,metadata};
}

export async function signedMotionFrameUrl(args:{
  projectId:string;
  hash:string;
  purpose?:string;
  ttlSeconds?:number;
}){
  return createSignedMediaUrl({
    route:'/api/motion-frame-asset',
    assetId:args.hash,
    projectId:args.projectId,
    purpose:args.purpose||'motion-inspector',
    ttlSeconds:args.ttlSeconds||1800
  });
}
