import { readRenderMedia } from './_lib/render-media-assets.mts';
import { verifySignedMediaRequest } from './_lib/media-signing.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

const clean=(value:unknown,max=1800)=>String(value??'').trim().slice(0,max);

export default async(request:Request)=>{
  if(request.method!=='GET')return json({error:'Method not allowed'},405);

  const url=new URL(request.url);
  const projectId=clean(url.searchParams.get('projectId'),96);
  const id=clean(url.searchParams.get('id'),64).toLowerCase();
  if(!/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)||!/^[a-f0-9]{64}$/.test(id)){
    return json({error:'A valid projectId and render media id are required.'},400);
  }

  const purpose=clean(url.searchParams.get('purpose'),80);
  const exp=clean(url.searchParams.get('exp'),32);
  const sig=clean(url.searchParams.get('sig'),128);

  let allowed=false;
  if(purpose&&exp&&sig){
    allowed=await verifySignedMediaRequest({assetId:id,projectId,purpose,exp,sig});
  }

  if(!allowed){
    try{
      await authorizeProject(request,projectId,'project:read');
      allowed=true;
    }catch(error){
      const handled=securityErrorResponse(error);
      if(handled)return json(handled.body,handled.status);
      throw error;
    }
  }

  const asset=await readRenderMedia(projectId,id);
  if(!asset)return json({error:'Render media asset was not found.'},404);

  return new Response(asset.bytes,{
    status:200,
    headers:{
      'content-type':String(asset.metadata.media_type||'video/mp4'),
      'content-length':String(asset.metadata.byte_length||asset.bytes.size),
      'cache-control':'private, max-age=900',
      'etag':'"'+id+'"',
      'x-content-type-options':'nosniff',
      'accept-ranges':'none'
    }
  });
};

export const config={
  path:'/api/render-media-asset',
  rateLimit:{
    windowLimit:6000,
    windowSize:60,
    aggregateBy:['ip','domain']
  }
};
