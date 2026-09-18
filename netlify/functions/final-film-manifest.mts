import { readAuthoritativeProjectState } from './_lib/project-artifacts.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';
import {
  buildFinalFilmManifest,
  type AudioAssetBinding,
  type FinalEditPlan,
  type SceneAudioPlan
} from './_lib/audio-edit-foundation.mts';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v:unknown,m=1200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,m);
const safe=(v:string)=>/^[a-zA-Z0-9_-]{1,96}$/.test(v);

export default async(request:Request)=>{
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  const url=new URL(request.url);
  const body=request.method==='POST'?await request.json().catch(()=>({})) as Record<string,any>:{};
  const projectId=clean(request.method==='GET'?url.searchParams.get('projectId'):body.projectId,96);
  const storyVersion=clean(request.method==='GET'?url.searchParams.get('storyVersion'):body.storyVersion,96);
  const sceneId=clean(request.method==='GET'?url.searchParams.get('sceneId'):body.sceneId,96);
  if(![projectId,storyVersion,sceneId].every(v=>v&&safe(v)))return json({error:'Valid projectId, storyVersion and sceneId are required.'},400);
  try{await authorizeProject(request,projectId,request.method==='POST'?'render:plan':'project:read');}
  catch(error){const handled=securityErrorResponse(error);if(handled)return json(handled.body,handled.status);throw error;}

  const [edit,audio]=await Promise.all([
    readAuthoritativeProjectState<FinalEditPlan>(projectId,'final-edit:plan:'+storyVersion+':'+sceneId),
    readAuthoritativeProjectState<SceneAudioPlan>(projectId,'audio:plan:'+storyVersion+':'+sceneId)
  ]);
  if(!edit?.value)return json({error:'A locked final edit plan is required.',code:'FINAL_EDIT_REQUIRED'},409);
  if(!audio?.value)return json({error:'A locked audio plan is required.',code:'AUDIO_PLAN_REQUIRED'},409);

  const supplied=request.method==='POST'&&Array.isArray(body.audioAssets)?body.audioAssets:[];
  const assets:AudioAssetBinding[]=supplied.map((asset:any)=>({
    cue_id:clean(asset?.cueId||asset?.cue_id,120),
    asset_uri:clean(asset?.assetUri||asset?.asset_uri,1800),
    content_sha256:clean(asset?.contentSha256||asset?.content_sha256,64)||null,
    duration_seconds:Number.isFinite(Number(asset?.durationSeconds||asset?.duration_seconds))?Number(asset?.durationSeconds||asset?.duration_seconds):null,
    rights_confirmed:asset?.rightsConfirmed===true||asset?.rights_confirmed===true
  })).filter((asset:any)=>asset.cue_id&&asset.asset_uri);

  const manifest=await buildFinalFilmManifest({editPlan:edit.value,audioPlan:audio.value,audioAssets:assets});
  return json({
    manifest,
    assembly_contract:{
      command:'python3 tools/assemble_final_film.py manifest.json final.mp4',
      output:'H.264/AAC MP4 with faststart',
      immutable_bindings:['edit_hash','timeline_hash','attempt_id','spec_hash'],
      final_render_must_never_bypass_first_frame_approval:true
    }
  });
};

export const config={path:'/api/final-film-manifest',rateLimit:{windowLimit:240,windowSize:60,aggregateBy:['ip','domain']}};
