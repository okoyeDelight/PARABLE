import {
  acknowledgeProviderSubmission,
  beginProviderSubmission,
  ensureProviderTransaction,
  failProviderTransaction,
  markProviderSubmissionAmbiguous,
  settleProviderTransaction
} from './_lib/provider-transactions.mts';
import {
  acquireProviderGuard,
  releaseProviderGuard,
  type ProviderGuardLease
} from './_lib/provider-resilience.mts';
import {
  ingestTrustedMotionFrame,
  signedMotionFrameUrl
} from './_lib/motion-frame-assets.mts';
import { readRenderAttempt, readRenderSpec } from './_lib/render-store.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

const clean=(value:unknown,max=1800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const safeId=(value:string)=>/^[a-zA-Z0-9_-]{1,180}$/.test(value);
const sleep=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));

const MODEL='fal-ai/ffmpeg-api/extract-frame';
const COST_PER_VIDEO_SECOND_USD=0.0002;

function falQueueUrl(requestId:string,suffix:'status'|'response'){
  return 'https://queue.fal.run/'+MODEL+'/requests/'+encodeURIComponent(requestId)+'/'+suffix;
}

function resultImageUrl(body:any){
  const data=body?.data&&typeof body.data==='object'?body.data:body;
  const images=Array.isArray(data?.images)?data.images:[];
  return clean(images?.[0]?.url,1800);
}

async function extractOne(args:{
  projectId:string;
  attemptId:string;
  videoUrl:string;
  durationSeconds:number;
  frameType:'first'|'middle'|'last';
  jobId:string;
}){
  const key=Netlify.env.get('FAL_KEY')||'';
  if(!key)throw new Error('fal motion-evidence extraction is not configured.');

  const body={
    video_url:args.videoUrl,
    frame_type:args.frameType
  };
  const estimated=Math.round(
    Math.max(1,args.durationSeconds)*COST_PER_VIDEO_SECOND_USD*1_000_000
  )/1_000_000;

  const txState=await ensureProviderTransaction({
    projectId:args.projectId,
    operationType:'motion-frame-extract',
    operationId:args.jobId+':'+args.frameType,
    provider:'fal',
    model:MODEL,
    requestBody:body,
    estimatedCostUsd:estimated
  });

  let guard:ProviderGuardLease|null=null;
  try{
    guard=await acquireProviderGuard({
      service:'render',
      provider:'fal',
      model:MODEL,
      operationId:txState.transaction.id,
      maxActive:Math.max(1,Math.min(24,Number(Netlify.env.get('PARABLE_FRAME_EXTRACT_MAX_ACTIVE'))||9)),
      leaseMs:60000
    });

    let transaction=await beginProviderSubmission(
      txState.transaction.id,
      args.projectId
    );

    let requestId=clean(transaction.provider_request_id,300);
    let statusUrl=clean(transaction.provider_status_url,1800);
    let responseUrl=clean(transaction.provider_response_url,1800);

    if(!requestId){
      let response:Response;
      try{
        response=await fetch('https://queue.fal.run/'+MODEL,{
          method:'POST',
          headers:{
            authorization:'Key '+key,
            'content-type':'application/json'
          },
          body:JSON.stringify(body),
          signal:AbortSignal.timeout(15000)
        });
      }catch(error){
        await markProviderSubmissionAmbiguous({
          id:transaction.id,
          projectId:args.projectId,
          detail:clean(error instanceof Error?error.message:error,1000)||'Frame extraction submission connection failed.'
        });
        throw new Error('Frame extraction submission became ambiguous and was locked against automatic resubmission.');
      }

      const submitted=await response.json().catch(()=>({})) as any;
      const detail=clean(submitted?.detail||submitted?.error?.message||submitted?.message,1000);

      if(!response.ok){
        if(response.status>=500){
          await markProviderSubmissionAmbiguous({
            id:transaction.id,
            projectId:args.projectId,
            detail:detail||('Provider returned HTTP '+response.status+' after frame-extraction submission.')
          });
          throw new Error('Frame extraction provider returned an ambiguous server response; PARABLE refused to resubmit automatically.');
        }

        await failProviderTransaction({
          id:transaction.id,
          projectId:args.projectId,
          failureClass:response.status===429?'rate-limit':'provider-rejected',
          failureDetail:detail||('HTTP '+response.status)
        });
        throw new Error(detail||'Frame extraction provider rejected the request.');
      }

      requestId=clean(submitted?.request_id,300);
      if(!requestId){
        await markProviderSubmissionAmbiguous({
          id:transaction.id,
          projectId:args.projectId,
          detail:'Frame extraction provider returned success without a durable request id.'
        });
        throw new Error('Frame extraction provider returned no durable request id; transaction locked.');
      }

      transaction=await acknowledgeProviderSubmission({
        id:transaction.id,
        projectId:args.projectId,
        providerRequestId:requestId,
        statusUrl:clean(submitted?.status_url,1800)||falQueueUrl(requestId,'status'),
        responseUrl:clean(submitted?.response_url,1800)||falQueueUrl(requestId,'response')
      });
      statusUrl=clean(transaction.provider_status_url,1800)||falQueueUrl(requestId,'status');
      responseUrl=clean(transaction.provider_response_url,1800)||falQueueUrl(requestId,'response');
    }

    statusUrl=statusUrl||falQueueUrl(requestId,'status');
    responseUrl=responseUrl||falQueueUrl(requestId,'response');

    let completed=false;
    for(let poll=0;poll<32;poll++){
      const statusResponse=await fetch(statusUrl,{
        headers:{authorization:'Key '+key},
        signal:AbortSignal.timeout(10000)
      });
      const statusBody=await statusResponse.json().catch(()=>({})) as any;

      if(!statusResponse.ok){
        if(statusResponse.status===429||statusResponse.status>=500){
          await sleep(Math.min(5000,900+poll*150));
          continue;
        }
        await failProviderTransaction({
          id:transaction.id,
          projectId:args.projectId,
          failureClass:'provider-status-failed',
          failureDetail:clean(statusBody?.detail||statusBody?.message||('HTTP '+statusResponse.status),1000)
        });
        throw new Error('Frame extraction provider status failed terminally.');
      }

      const state=clean(statusBody?.status,80).toUpperCase();
      if(state==='COMPLETED'){
        completed=true;
        break;
      }
      if(['FAILED','CANCELLED'].includes(state)){
        await failProviderTransaction({
          id:transaction.id,
          projectId:args.projectId,
          failureClass:'provider-extraction-failed',
          failureDetail:'Frame extraction ended with provider state '+state+'.'
        });
        throw new Error('Frame extraction failed at the provider.');
      }

      await sleep(Math.min(3500,800+poll*100));
    }

    if(!completed){
      // The provider request is already acknowledged. A durable job retry will
      // only resume polling this request; it cannot purchase another extraction.
      throw new Error('Frame extraction is still processing; retry polling the acknowledged provider request.');
    }

    const resultResponse=await fetch(responseUrl,{
      headers:{authorization:'Key '+key},
      signal:AbortSignal.timeout(12000)
    });
    const result=await resultResponse.json().catch(()=>({})) as any;
    if(!resultResponse.ok){
      if(resultResponse.status===429||resultResponse.status>=500){
        throw new Error('Frame extraction completed but result retrieval is temporarily unavailable.');
      }
      await failProviderTransaction({
        id:transaction.id,
        projectId:args.projectId,
        failureClass:'provider-result-failed',
        failureDetail:clean(result?.detail||result?.message||('HTTP '+resultResponse.status),1000)
      });
      throw new Error('Frame extraction result retrieval failed terminally.');
    }

    const sourceUrl=resultImageUrl(result);
    if(!sourceUrl){
      await failProviderTransaction({
        id:transaction.id,
        projectId:args.projectId,
        failureClass:'invalid-response',
        failureDetail:'Frame extraction completed without an image URL.'
      });
      throw new Error('Frame extraction completed without an image.');
    }

    const timestamp=
      args.frameType==='first'
        ?0
        :args.frameType==='middle'
          ?args.durationSeconds/2
          :args.durationSeconds;

    const role=
      args.frameType==='first'
        ?'first' as const
        :args.frameType==='last'
          ?'handoff' as const
          :'sample' as const;

    const asset=await ingestTrustedMotionFrame({
      projectId:args.projectId,
      attemptId:args.attemptId,
      sourceUrl,
      sourceProvider:'fal',
      sourceRequestId:requestId,
      role,
      timestampSeconds:timestamp
    });

    await settleProviderTransaction({
      id:transaction.id,
      projectId:args.projectId
    });

    const uri=await signedMotionFrameUrl({
      projectId:args.projectId,
      hash:asset.sha256,
      purpose:'motion-inspector',
      ttlSeconds:3600
    });

    await releaseProviderGuard(guard,{outcome:'success'}).catch(()=>null);
    guard=null;

    return {
      uri,
      timestamp_seconds:timestamp,
      timestampSeconds:timestamp,
      sha256:asset.sha256,
      role,
      provider_request_id:requestId
    };
  }catch(error){
    if(guard){
      await releaseProviderGuard(guard,{outcome:'failure',error}).catch(()=>null);
      guard=null;
    }
    throw error;
  }
}

export default async(request:Request)=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);

  const jobId=clean(request.headers.get('x-parable-job-id'),180);
  const workload=clean(request.headers.get('x-parable-workload'),80);
  if(!jobId||!safeId(jobId)||workload!=='durable-pipeline'){
    return json({
      error:'Trusted motion evidence extraction must run through PARABLE durable jobs.',
      code:'DURABLE_JOB_REQUIRED',
      next_action:'POST /api/jobs with kind=motion-evidence-extract and an Idempotency-Key.'
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
      error:'Motion evidence extraction may only be executed by a trusted PARABLE worker.',
      code:'INTERNAL_WORKER_REQUIRED'
    },403);
  }

  if(attempt.status!=='succeeded'){
    return json({
      error:'Trusted frame extraction requires a completed, unaccepted render attempt.',
      current_status:attempt.status
    },409);
  }
  if(!attempt.asset_uri){
    return json({error:'Completed render attempt has no video asset URI.'},409);
  }

  const spec=await readRenderSpec({
    projectId:attempt.project_id,
    storyVersion:attempt.story_version,
    sceneId:attempt.scene_id,
    shotId:attempt.shot_id,
    specHash:attempt.spec_hash
  });
  if(!spec)return json({error:'The exact ShotRenderSpec was not found.'},404);

  const duration=Math.max(1,Math.min(20,Number(spec.output?.duration_seconds)||6));

  try{
    const frames=await Promise.all(
      (['first','middle','last'] as const).map((frameType)=>extractOne({
        projectId:attempt.project_id,
        attemptId:attempt.id,
        videoUrl:attempt.asset_uri!,
        durationSeconds:duration,
        frameType,
        jobId
      }))
    );

    return json({
      evidence_version:'parable-trusted-motion-evidence-v1',
      attempt_id:attempt.id,
      project_id:attempt.project_id,
      spec_hash:attempt.spec_hash,
      video_asset_uri:attempt.asset_uri,
      extraction_provider:'fal',
      extraction_model:MODEL,
      frame_count:frames.length,
      frames,
      estimated_max_extraction_cost_usd:
        Math.round(duration*COST_PER_VIDEO_SECOND_USD*3*1_000_000)/1_000_000,
      next_action:'POST /api/jobs with kind=motion-inspect using these trusted frames.',
      automatic_acceptance:false
    },201);
  }catch(error){
    const message=clean(error instanceof Error?error.message:error,1200)||'Trusted motion evidence extraction failed.';
    const retryable=/still processing|temporarily unavailable|rate limit|capacity|timeout/i.test(message);
    return json({
      error:message,
      code:retryable?'MOTION_EVIDENCE_EXTRACTION_RETRYABLE':'MOTION_EVIDENCE_EXTRACTION_FAILED',
      retryable
    },retryable?503:409);
  }
};

export const config={
  path:'/api/motion-evidence-extract',
  rateLimit:{
    windowLimit:60,
    windowSize:60,
    aggregateBy:['ip','domain']
  }
};
