import { inspectMotion, type MotionFrameEvidence } from './_lib/motion-inspector-ai.mts';
import { evaluateRenderQA, type RenderQAInput } from './_lib/render-foundation.mts';
import {
  appendRenderAttemptEvent,
  readRenderAttempt,
  readRenderSpec,
  saveMotionInspection,
  saveRenderQA
} from './_lib/render-store.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store'
  }
});

const clean=(value:unknown,max=1800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const safeId=(value:string)=>/^[a-zA-Z0-9_-]{1,180}$/.test(value);
const safeHttpUrl=(value:string)=>{
  try{
    const url=new URL(value);
    return ['http:','https:'].includes(url.protocol);
  }catch{
    return false;
  }
};

function qaEvidence(report:Record<string,any>):RenderQAInput {
  return {
    identity: report.scores?.identity,
    wardrobe: report.scores?.wardrobe,
    prop_continuity: report.scores?.prop_continuity,
    spatial_continuity: Math.min(
      report.scores?.spatial_continuity ?? 1,
      report.scores?.camera_axis ?? 1
    ),
    composition: report.scores?.composition,
    motion: Math.min(
      report.scores?.motion ?? 1,
      report.scores?.temporal_artifacts ?? 1
    ),
    lighting: report.scores?.lighting,
    technical: report.scores?.technical,
    cultural_grounding: report.scores?.cultural_grounding,
    performance_intent: report.scores?.performance_intent,
    detected_violations: [
      ...(Array.isArray(report.blockers)?report.blockers:[]),
      ...(report.scores?.first_frame_fidelity!==undefined&&report.scores.first_frame_fidelity<0.88
        ?['Rendered motion did not preserve the approved first-frame canon.']
        :[])
    ]
  };
}

export default async(request:Request)=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);

  const body=await request.json().catch(()=>({})) as Record<string,any>;
  const attemptId=clean(body.attemptId,180);
  if(!attemptId||!safeId(attemptId))return json({error:'A valid attemptId is required.'},400);

  const attempt=await readRenderAttempt(attemptId);
  if(!attempt)return json({error:'Render attempt was not found.'},404);

  let access;
  try{
    access=await authorizeProject(request,attempt.project_id,'render:spend');
  }catch(error){
    const handled=securityErrorResponse(error);
    if(handled)return json(handled.body,handled.status);
    throw error;
  }

  if(!access.actor.internal){
    return json({
      error:'Automated motion evidence may only be submitted by a trusted PARABLE frame-extraction worker.',
      code:'TRUSTED_MOTION_EVIDENCE_REQUIRED'
    },403);
  }

  if(attempt.status!=='succeeded'){
    return json({
      error:'Motion inspection requires a completed render attempt that has not already been accepted/rejected.',
      current_status:attempt.status
    },409);
  }

  if(!attempt.asset_uri||!safeHttpUrl(attempt.asset_uri)){
    return json({
      error:'The completed render attempt has no valid video asset URI.',
      code:'RENDER_ASSET_REQUIRED'
    },409);
  }

  const spec=await readRenderSpec({
    projectId:attempt.project_id,
    storyVersion:attempt.story_version,
    sceneId:attempt.scene_id,
    shotId:attempt.shot_id,
    specHash:attempt.spec_hash
  });
  if(!spec)return json({error:'The exact ShotRenderSpec for this attempt was not found.'},404);

  const frames=(Array.isArray(body.frames)?body.frames:[]).slice(0,10).flatMap((row:any)=>{
    const uri=clean(row?.uri,1800);
    const timestamp=Number(row?.timestampSeconds ?? row?.timestamp_seconds);
    const sha256=clean(row?.sha256,64).toLowerCase();
    const role=['first','sample','handoff'].includes(row?.role)?row.role:'sample';
    if(!uri||!safeHttpUrl(uri)||!Number.isFinite(timestamp))return[];
    return [{
      uri,
      timestamp_seconds:timestamp,
      sha256:/^[a-f0-9]{64}$/.test(sha256)?sha256:null,
      role
    } satisfies MotionFrameEvidence];
  });

  const report=await inspectMotion({
    attempt,
    spec,
    frames,
    approvedFirstFrameUri:attempt.keyframe_asset_uri||null
  });
  const inspectionRef=await saveMotionInspection(report);

  const evaluated=evaluateRenderQA(attempt.id,qaEvidence(report));
  const criticalNotAssessable=new Set([
    'identity',
    'spatial_continuity',
    'camera_axis',
    'technical',
    'first_frame_fidelity'
  ]);
  const missingCritical=(report.not_assessable||[]).filter((metric)=>criticalNotAssessable.has(metric));

  const qa:any={
    ...evaluated,
    evidence_source:'trusted-motion-inspector',
    motion_inspection_id:report.id,
    motion_inspection_ref:inspectionRef,
    motion_sample_set_hash:report.sample_set_hash,
    inspected_asset_uri:report.asset_uri,
    inspected_spec_hash:report.spec_hash,
    reviewer_actor_id:null
  };

  if(report.decision==='REJECT')qa.decision='REJECT';
  else if(report.decision==='REPAIR')qa.decision='REPAIR';
  else if(report.decision==='INSPECTOR_UNAVAILABLE'||missingCritical.length){
    qa.decision='HUMAN_REVIEW';
    qa.warnings=[
      ...(Array.isArray(qa.warnings)?qa.warnings:[]),
      ...(missingCritical.length
        ?['Critical motion QA dimensions were not assessable: '+missingCritical.join(', ')+'.']
        :['Automated motion inspection was unavailable.'])
    ];
  }

  const qaRef=await saveRenderQA(qa,attempt);
  await appendRenderAttemptEvent(attempt,'motion-inspected',{
    motion_inspection_id:report.id,
    motion_inspection_ref:inspectionRef,
    qa_ref:qaRef,
    motion_decision:report.decision,
    qa_decision:qa.decision,
    sample_set_hash:report.sample_set_hash,
    frame_count:report.frame_count
  });

  return json({
    report,
    qa,
    storage_ref:inspectionRef,
    qa_ref:qaRef,
    automatic_timeline_acceptance_eligible:
      report.decision==='CLEAR_FOR_QA'&&qa.decision==='PASS',
    note:
      report.decision==='CLEAR_FOR_QA'&&qa.decision==='PASS'
        ?'Temporal evidence cleared automated QA. A separate acceptance action is still required before this shot enters the authoritative timeline.'
        :'This render cannot enter the authoritative timeline automatically. Repair or explicit human review is required.'
  },201);
};

export const config={
  path:'/api/render-motion-inspect',
  rateLimit:{
    windowLimit:120,
    windowSize:60,
    aggregateBy:['ip','domain']
  }
};
