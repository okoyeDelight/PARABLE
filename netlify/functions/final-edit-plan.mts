import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  readProjectRevision,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import { readAuthoritativeProjectState, stageProjectArtifact } from './_lib/project-artifacts.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';
import {
  buildFinalEditPlan,
  type FinalEditPlan,
  type SceneAudioPlan
} from './_lib/audio-edit-foundation.mts';
import type { SequenceTimeline } from './_lib/sequence-timeline.mts';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v:unknown,m=1200)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,m);
const safe=(v:string)=>/^[a-zA-Z0-9_-]{1,96}$/.test(v);
const key=(story:string,scene:string)=>'final-edit:plan:'+story+':'+scene;

async function build(projectId:string,storyVersion:string,sceneId:string,existing?:FinalEditPlan|null){
  const [adaptation,timeline,audio]=await Promise.all([
    readAuthoritativeProjectState<Record<string,any>>(projectId,'adaptation:latest'),
    readAuthoritativeProjectState<SequenceTimeline>(projectId,'sequence:timeline:'+storyVersion+':'+sceneId),
    readAuthoritativeProjectState<SceneAudioPlan>(projectId,'audio:plan:'+storyVersion+':'+sceneId)
  ]);
  if(!adaptation?.value||adaptation.value.story_version!==storyVersion)throw Object.assign(new Error('Authoritative adaptation is missing.'),{status:409,code:'ADAPTATION_REQUIRED'});
  if(!timeline?.value)throw Object.assign(new Error('Locked visual sequence is required.'),{status:409,code:'SEQUENCE_REQUIRED'});
  if(!audio?.value)throw Object.assign(new Error('Locked audio plan is required.'),{status:409,code:'AUDIO_PLAN_REQUIRED'});
  return buildFinalEditPlan({projectId,storyVersion,sceneId,adaptation:adaptation.value,timeline:timeline.value,audioPlan:audio.value,existing:existing||null});
}

export default async(request:Request)=>{
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  const url=new URL(request.url);const body=request.method==='POST'?await request.json().catch(()=>({})) as Record<string,any>:{};
  const projectId=clean(request.method==='GET'?url.searchParams.get('projectId'):body.projectId,96);
  const storyVersion=clean(request.method==='GET'?url.searchParams.get('storyVersion'):body.storyVersion,96);
  const sceneId=clean(request.method==='GET'?url.searchParams.get('sceneId'):body.sceneId,96);
  if(![projectId,storyVersion,sceneId].every(v=>v&&safe(v)))return json({error:'Valid projectId, storyVersion and sceneId are required.'},400);
  const action=request.method==='POST'?clean(body.action||'preview',30):'read';
  try{await authorizeProject(request,projectId,action==='lock'?'review:approve':request.method==='POST'?'render:plan':'project:read');}
  catch(error){const handled=securityErrorResponse(error);if(handled)return json(handled.body,handled.status);throw error;}

  const existing=await readAuthoritativeProjectState<FinalEditPlan>(projectId,key(storyVersion,sceneId));
  let plan:FinalEditPlan;
  try{plan=await build(projectId,storyVersion,sceneId,existing?.value||null);}
  catch(error:any){if(Number.isFinite(Number(error?.status)))return json({error:error.message,code:error.code},Number(error.status));throw error;}
  if(request.method==='GET'||action==='preview')return json({edit_plan:plan,authoritative_ref:existing?.ref||null,lock_is_current:existing?.value?.lock?.status==='locked'&&existing.value.edit_hash===plan.edit_hash});
  if(action!=='lock')return json({error:'action must be preview or lock.'},400);
  if(body.humanApproved!==true)return json({error:'Locking final edit requires humanApproved: true.',code:'HUMAN_EDIT_LOCK_REQUIRED'},400);
  if(plan.readiness.blockers.length)return json({error:'Final edit is not ready to lock.',code:'FINAL_EDIT_BLOCKED',blockers:plan.readiness.blockers,warnings:plan.readiness.warnings},409);
  const expectedHash=clean(body.editHash,96);
  if(expectedHash&&expectedHash!==plan.edit_hash)return json({error:'Final edit changed after review.',code:'FINAL_EDIT_STALE',current_edit_hash:plan.edit_hash},409);

  let lease:ProjectMutationLease|null=null;
  try{
    const head=await readProjectRevision(projectId);
    const access=await authorizeProject(request,projectId,'review:approve');
    lease=await acquireProjectMutation({projectId,mutationType:'lock-final-edit',expectedRevision:Number.isFinite(Number(body.expectedProjectRevision))?Number(body.expectedProjectRevision):head.revision,ttlMs:30000});
    const locked:FinalEditPlan={...plan,lock:{status:'locked',approved_by_actor_id:access.actor.actor_id,approved_at:new Date().toISOString(),reviewer_note:clean(body.note,1400)||null}};
    const ref=await stageProjectArtifact({projectId,mutationId:lease.mutation_id,kind:'final-edit-plan',artifactId:storyVersion+':'+sceneId+':'+locked.edit_hash,value:locked});
    const committed=await commitProjectMutation(lease,{story_version:storyVersion,scene_id:sceneId,edit_hash:locked.edit_hash,clip_count:locked.clips.length},{[key(storyVersion,sceneId)]:ref});
    return json({edit_plan:locked,project_revision:committed.revision,authoritative_ref:ref},201);
  }catch(error){
    if(lease)await abortProjectMutation(lease).catch(()=>false);
    const handled=projectMutationErrorResponse(error);if(handled)return json(handled.body,handled.status);throw error;
  }
};

export const config={path:'/api/final-edit-plan',rateLimit:{windowLimit:240,windowSize:60,aggregateBy:['ip','domain']}};
