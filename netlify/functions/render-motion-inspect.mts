import { inspectMotion } from './_lib/motion-inspector-ai.mts';
import { extractMotionFrames } from './_lib/motion-frame-extractor.mts';
import {
  providerTransactionErrorResponse,
  ProviderTransactionError
} from './_lib/provider-transactions.mts';
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

function minAvailable(...values:unknown[]) {
  const present=values.map(Number).filter((value)=>Number.isFinite(value));
  return present.length?Math.min(...present):undefined;
}

function qaEvidence(report:Record<string,any>):RenderQAInput {
  return {
    identity: report.scores?.identity,
    wardrobe: report.scores?.wardrobe,
    prop_continuity: report.scores?.prop_continuity,
    spatial_continuity: minAvailable(
      report.scores?.spatial_continuity,
      report.scores?.camera_axis
    ),
    composition: report.scores?.composition,
    motion: minAvailable(
      report.scores?.motion,
      report.scores?.temporal_artifacts
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

  const jobId=clean(request.headers.get('x-parable-job-id'),180);
  const workload=clean(request.headers.get('x-parable-workload'),80);
  if(!jobId||!safeId(jobId)||workload!=='durable-pipeline'){
    return json({
      error:'Full-motion inspection includes billable frame extraction and must run through PARABLE durable jobs.',
      code:'DURABLE_JOB_REQUIRED',
      next_action:'POST /api/jobs with kind=motion-inspect and an Idempotency-Key.'
    },409);
  }

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

  let extracted;
  try{
    extracted=await extractMotionFrames({attempt,spec});
  }catch(error){
    const handled=providerTransactionErrorResponse(error);
    if(handled){
      return json({
        ...handled.body,
        stage:'motion-frame-extraction',
        automatic_retry_disabled:
          error instanceof ProviderTransactionError &&
          error.code==='PROVIDER_SUBMISSION_AMBIGUOUS'
      },handled.status);
    }

    const message=clean(error instanceof Error?error.message:error,1200)||'Motion-frame extraction failed.';
    return json({
      error:message,
      code:/timeout|deadline|temporar|429|5\d\d/i.test(message)
        ?'MOTION_FRAME_EXTRACTION_RETRYABLE'
        :'MOTION_FRAME_EXTRACTION_FAILED',
      retryable:/timeout|deadline|temporar|429|5\d\d/i.test(message)
    },/timeout|deadline|temporar|429|5\d\d/i.test(message)?503:422);
  }

  const frames=extracted.frameSet.frames;
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
    frame_count:report.frame_count,
    frame_set_provider_transaction_id:extracted.frameSet.provider_transaction_id,
    frame_set_provider_request_id:extracted.frameSet.provider_request_id,
    frame_extraction_deduplicated:extracted.deduplicated
  });

  return json({
    report,
    qa,
    frame_set:{
      frame_set_version:extracted.frameSet.frame_set_version,
      provider:'fal',
      endpoint:extracted.frameSet.endpoint,
      provider_transaction_id:extracted.frameSet.provider_transaction_id,
      provider_request_id:extracted.frameSet.provider_request_id,
      frame_count:extracted.frameSet.frames.length,
      deduplicated:extracted.deduplicated
    },
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
