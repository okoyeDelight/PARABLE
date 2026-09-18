import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  readProjectRevision,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import {
  readAuthoritativeProjectState,
  stageProjectArtifact
} from './_lib/project-artifacts.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';
import { buildSceneAudioPlan, type SceneAudioPlan } from './_lib/audio-edit-foundation.mts';
import type { SequenceTimeline } from './_lib/sequence-timeline.mts';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
const clean=(value:unknown,max=1200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const safe=(value:string)=>/^[a-zA-Z0-9_-]{1,96}$/.test(value);
const stateKey=(storyVersion:string,sceneId:string)=>'audio:plan:'+storyVersion+':'+sceneId;

async function current(projectId:string,storyVersion:string,sceneId:string,existing?:SceneAudioPlan|null){
  const [adaptation,timeline]=await Promise.all([
    readAuthoritativeProjectState<Record<string,any>>(projectId,'adaptation:latest'),
    readAuthoritativeProjectState<SequenceTimeline>(projectId,'sequence:timeline:'+storyVersion+':'+sceneId)
  ]);
  if(!adaptation?.value||adaptation.value.story_version!==storyVersion){
    throw Object.assign(new Error('The authoritative adaptation for this story version is missing.'),{status:409,code:'ADAPTATION_REQUIRED'});
  }
  if(!timeline?.value||timeline.value.story_version!==storyVersion||timeline.value.scene_id!==sceneId){
    throw Object.assign(new Error('A current sequence timeline is required before audio planning.'),{status:409,code:'SEQUENCE_TIMELINE_REQUIRED'});
  }
  const plan=await buildSceneAudioPlan({
    projectId,storyVersion,sceneId,
    adaptation:adaptation.value,
    timeline:timeline.value,
    existing:existing||null
  });
  return {plan,timeline:timeline.value};
}

export default async(request:Request)=>{
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  const url=new URL(request.url);
  const body=request.method==='POST'?await request.json().catch(()=>({})) as Record<string,any>:{};
  const projectId=clean(request.method==='GET'?url.searchParams.get('projectId'):body.projectId,96);
  const storyVersion=clean(request.method==='GET'?url.searchParams.get('storyVersion'):body.storyVersion,96);
  const sceneId=clean(request.method==='GET'?url.searchParams.get('sceneId'):body.sceneId,96);
  if(![projectId,storyVersion,sceneId].every(v=>v&&safe(v)))return json({error:'Valid projectId, storyVersion and sceneId are required.'},400);

  const action=request.method==='POST'?clean(body.action||'preview',30):'read';
  try{await authorizeProject(request,projectId,action==='lock'?'review:approve':request.method==='POST'?'render:plan':'project:read');}
  catch(error){const handled=securityErrorResponse(error);if(handled)return json(handled.body,handled.status);throw error;}

  const existing=await readAuthoritativeProjectState<SceneAudioPlan>(projectId,stateKey(storyVersion,sceneId));
  let built;
  try{built=await current(projectId,storyVersion,sceneId,existing?.value||null);}
  catch(error:any){if(Number.isFinite(Number(error?.status)))return json({error:error.message,code:error.code},Number(error.status));throw error;}

  if(request.method==='GET'||action==='preview'){
    return json({audio_plan:built.plan,authoritative_ref:existing?.ref||null,lock_is_current:existing?.value?.lock?.status==='locked'&&existing.value.plan_hash===built.plan.plan_hash});
  }
  if(action!=='lock')return json({error:'action must be preview or lock.'},400);
  if(body.humanApproved!==true)return json({error:'Locking the audio plan requires humanApproved: true.',code:'HUMAN_AUDIO_LOCK_REQUIRED'},400);
  if(built.plan.readiness.blockers.length)return json({error:'Audio plan is not ready to lock.',code:'AUDIO_PLAN_BLOCKED',blockers:built.plan.readiness.blockers},409);
  const expectedHash=clean(body.planHash,96);
  if(expectedHash&&expectedHash!==built.plan.plan_hash)return json({error:'Audio plan changed after review.',code:'AUDIO_PLAN_STALE',current_plan_hash:built.plan.plan_hash},409);

  let lease:ProjectMutationLease|null=null;
  try{
    const head=await readProjectRevision(projectId);
    const access=await authorizeProject(request,projectId,'review:approve');
    lease=await acquireProjectMutation({
      projectId,mutationType:'lock-audio-plan',
      expectedRevision:Number.isFinite(Number(body.expectedProjectRevision))?Number(body.expectedProjectRevision):head.revision,
      ttlMs:30000
    });
    const locked:SceneAudioPlan={...built.plan,lock:{
      status:'locked',
      approved_by_actor_id:access.actor.actor_id,
      approved_at:new Date().toISOString(),
      reviewer_note:clean(body.note,1400)||null
    }};
    const ref=await stageProjectArtifact({
      projectId,mutationId:lease.mutation_id,kind:'audio-plan',
      artifactId:storyVersion+':'+sceneId+':'+locked.plan_hash,value:locked
    });
    const committed=await commitProjectMutation(lease,{
      story_version:storyVersion,scene_id:sceneId,audio_plan_hash:locked.plan_hash,cue_count:locked.cues.length
    },{[stateKey(storyVersion,sceneId)]:ref,['final-edit:plan:'+storyVersion+':'+sceneId]:null});
    return json({audio_plan:locked,project_revision:committed.revision,authoritative_ref:ref},201);
  }catch(error){
    if(lease)await abortProjectMutation(lease).catch(()=>false);
    const handled=projectMutationErrorResponse(error);if(handled)return json(handled.body,handled.status);throw error;
  }
};

export const config={path:'/api/audio-plan',rateLimit:{windowLimit:240,windowSize:60,aggregateBy:['ip','domain']}};
