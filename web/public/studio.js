const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const form=$('#goldenForm');
const analyzeBtn=$('#analyzeBtn');
const emptyState=$('#emptyState');
const resultState=$('#resultState');
const toast=$('#studioToast');
let currentProjectId=null;
let currentResult=null;
let currentCritic=null;
let currentProjectRevision=null;
let activeShot=null;
let directionTimer=null;
const PENDING_PRODUCTION_JOB='parable.pending.production.v1';

const escapeHtml=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const showToast=(message)=>{if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),2200)};
const ensureOption=(select,value)=>{if(!select||value===undefined||value===null)return;if(![...select.options].some(o=>o.value===String(value))){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);select.append(option)}};

async function loadAiStatus(){
  try{
    const response=await fetch('/api/ai-status',{cache:'no-store'});
    if(!response.ok)return;
    const body=await response.json();
    const status=body.story_understanding||body.story_intelligence||{};
    const configured=status.configured_providers||{};
    const provider=configured.openrouter?'OpenRouter':configured.groq?'Groq':configured.gemini?'Gemini':null;
    $('#engineDot')?.classList.toggle('is-fallback',!status.ready);
    $('#navEngineLabel').textContent=status.ready?`${provider||'Model'} Story Intelligence ready`:'Story Intelligence fallback ready';
  }catch{
    $('#engineDot')?.classList.add('is-fallback');
    $('#navEngineLabel').textContent='Story Intelligence available';
  }
}

function setStep(step){
  $$('.workflow-step').forEach(btn=>{
    btn.classList.toggle('is-active',btn.dataset.step===step);
    const order=['write','understand','adapt','direct','review'];
    if(currentResult){
      const activeIndex=order.indexOf(step);const i=order.indexOf(btn.dataset.step);
      btn.classList.toggle('is-ready',i<=activeIndex);
    }
  });
  $$('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==step);
}

function renderIntelligence(data){
  const intel=data.story_intelligence;
  $('#charactersList').innerHTML=`<div class="chip-list">${intel.characters.map(c=>`<span class="chip">${escapeHtml(c.name)}</span>`).join('')}</div>`;
  $('#themesList').innerHTML=`<div class="chip-list">${intel.themes.map(t=>`<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>`;
  $('#conflictText').textContent=intel.conflict;
  $('#worldText').textContent=intel.setting;
  $('#emotionalTurn').textContent=intel.emotional_turn;

  const engine=data.engine||{};
  const isModel=engine.mode==='model';
  $('#engineBadge').textContent=isModel?`${engine.provider} · ${engine.model}`:'structured fallback';
  $('#modelMeta').textContent=isModel?`${String(engine.provider).toUpperCase()} / ${engine.model}`:'Local deterministic engine';
  $('#versionMeta').textContent=`${engine.version||'unknown'} · ${data.story_version||'unversioned'}`;
  $('#navEngineLabel').textContent=isModel?'Story Intelligence model live':'Story Intelligence fallback active';
  $('#engineDot')?.classList.toggle('is-fallback',!isModel);

  const review=data.review||data.production_bible?.review||{};
  const confidence=Math.round((Number(review.confidence)||0)*100);
  $('#confidenceText').textContent=`${confidence}% confidence`;
  const flags=[...(review.uncertainties||[]),...(review.fidelity_warnings||[]),...(review.human_review_flags||[])].filter(Boolean).slice(0,3);
  $('#reviewFlags').textContent=flags.length?flags.join(' · '):'No major review flags in this pass.';
}

function renderScreenplay(data){
  $('#sceneHeading').textContent=data.screenplay.heading;
  $('#screenplayBeats').innerHTML=(data.screenplay.beats||[]).map(beat=>{
    if(beat.type==='dialogue') return `<div class="beat dialogue"><b>${escapeHtml(beat.speaker||'CHARACTER')}</b><span>${escapeHtml(beat.text)}</span></div>`;
    return `<p class="beat">${escapeHtml(beat.text)}</p>`;
  }).join('');
}

function selectShot(shot){
  activeShot=shot;
  $$('.shot-item').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.shot===shot.id));
  $('#previewShotId').textContent=shot.id.replace('_',' ').toUpperCase()+` · ${String(shot.shot_size||'shot').toUpperCase()}`;
  $('#previewBeat').textContent=shot.beat;
  const lens=$('#lensControl');ensureOption(lens,shot.lens_mm);lens.value=String(shot.lens_mm||50);
  const motion=$('#motionControl');ensureOption(motion,shot.motion);motion.value=shot.motion||'Locked';
  const light=$('#lightControl');ensureOption(light,shot.lighting);light.value=shot.lighting||'Natural environment';
  $('#performanceText').textContent=shot.performance||'Keep the performance truthful to the beat.';
  $('#shotPreview').dataset.lens=String(shot.lens_mm||50);
  $('#directionSaveState').textContent='Director choices are versioned with this story.';
}

function renderDirect(data){
  $('#projectBadge').textContent=currentProjectId?`PROJECT · ${currentProjectId.slice(-6).toUpperCase()}`:'LIVE PROJECT';
  const shots=data.shot_plan||[];
  $('#shotBrowser').innerHTML=shots.map((shot,index)=>`<button type="button" class="shot-item${index===1?' is-active':''}" data-shot="${escapeHtml(shot.id)}"><small>${escapeHtml(shot.id.replace('_',' ').toUpperCase())}</small><b>${escapeHtml(shot.shot_size)}</b></button>`).join('');
  $$('.shot-item').forEach(btn=>btn.addEventListener('click',()=>{
    const shot=shots.find(s=>s.id===btn.dataset.shot);if(shot)selectShot(shot);
  }));
  if(shots.length)selectShot(shots[1]||shots[0]);
}

function resetCritic(){
  currentCritic=null;
  if($('#criticIntro'))$('#criticIntro').hidden=false;
  if($('#criticResult'))$('#criticResult').hidden=true;
  if($('#criticEngineBadge'))$('#criticEngineBadge').textContent='not run';
}

function listMarkup(items,emptyText){
  const values=(items||[]).filter(Boolean);
  if(!values.length)return `<p>${escapeHtml(emptyText)}</p>`;
  return `<ul>${values.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderCritic(result){
  currentCritic=result;
  const review=result.review||{};
  const engine=result.engine||{};
  $('#criticIntro').hidden=true;
  $('#criticResult').hidden=false;
  $('#criticEngineBadge').textContent=engine.mode==='model'?`${engine.provider} · ${engine.model}`:'local structural critic';
  $('#criticSummary').textContent=review.summary||'No summary returned.';
  $('#criticReadiness').textContent=String(review.readiness||'revise').replaceAll('-',' ');
  $('#criticConfidence').textContent=`${Math.round((Number(review.confidence)||0)*100)}% confidence`;
  $('#criticStrongChoice').textContent=review.strongest_choice?.choice||'No strongest choice identified.';
  $('#criticStrongWhy').textContent=review.strongest_choice?.why_it_works||'Human review required.';

  const priorities=review.priorities||[];
  $('#criticPriorityCount').textContent=`${priorities.length} ${priorities.length===1?'priority':'priorities'}`;
  $('#criticPriorities').innerHTML=priorities.length?priorities.map(item=>`<article class="critic-priority"><span class="area">${escapeHtml(item.area||'review')}</span><div><strong>${escapeHtml(item.issue||'Review this choice')}</strong><p>${escapeHtml(item.why_it_matters||'')}</p><em>${escapeHtml(item.action||'')}</em></div></article>`).join(''):'<p>No high-leverage change was returned in this pass.</p>';

  $('#criticContinuity').innerHTML=listMarkup(review.continuity_risks,'No continuity risk was identified in this pass.');
  $('#criticFidelity').innerHTML=listMarkup(review.fidelity_risks,'No source-fidelity risk was identified in this pass.');
  $('#criticQuestions').innerHTML=listMarkup(review.human_questions,'No unresolved human question was returned.');
  $('#criticState').textContent=engine.mode==='model'
    ?`Model-backed review saved to ${result.story_version}. Nothing is rewritten until you choose to change it.`
    :`Structural fallback review saved to ${result.story_version}. A model critic was unavailable for this pass.`;
  setStep('review');
}

function renderResult(data){
  currentResult=data;
  if(Number.isFinite(Number(data?.project_revision))) currentProjectRevision=Number(data.project_revision);
  emptyState.hidden=true;
  resultState.hidden=false;
  resetCritic();
  renderIntelligence(data);
  renderScreenplay(data);
  renderDirect(data);
  setStep('understand');
}

async function createProject(payload){
  const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,audienceScope:'global',storyPeriod:'present'})});
  const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not create production');
  return body;
}

function rememberPendingProduction(jobId,projectId){
  try{localStorage.setItem(PENDING_PRODUCTION_JOB,JSON.stringify({jobId,projectId,at:Date.now()}));}catch{}
}
function clearPendingProduction(){
  try{localStorage.removeItem(PENDING_PRODUCTION_JOB);}catch{}
}
function readPendingProduction(){
  try{
    const value=JSON.parse(localStorage.getItem(PENDING_PRODUCTION_JOB)||'null');
    if(!value?.jobId||!value?.projectId)return null;
    if(Date.now()-Number(value.at||0)>24*60*60*1000){clearPendingProduction();return null;}
    return value;
  }catch{return null;}
}

async function stableIdempotencyKey(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,48);
}

async function submitDurableJob(kind,payload,idempotencyKey){
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const r=await fetch('/api/jobs',{
        method:'POST',
        headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
        body:JSON.stringify({kind,payload})
      });
      const body=await r.json().catch(()=>({}));
      if(r.ok&&body?.job?.id)return body;
      lastError=new Error(body.error||'PARABLE could not start this production job.');
      if(r.status<500&&r.status!==429)throw lastError;
    }catch(err){
      lastError=err instanceof Error?err:new Error(String(err||'Production request failed.'));
    }
    if(attempt<3){
      $('#formNote').textContent='Connection was interrupted. PARABLE kept the request safe and is retrying…';
      await new Promise(resolve=>setTimeout(resolve,attempt===1?900:2200));
    }
  }
  throw lastError||new Error('PARABLE could not start this production job.');
}

async function waitForJob(jobId,{timeoutMs=180000,onProgress}={}){
  const started=Date.now();
  let delay=700;
  while(Date.now()-started<timeoutMs){
    const r=await fetch('/api/job-status?id='+encodeURIComponent(jobId),{cache:'no-store'});
    const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not read production job');
    const status=body.job?.status||'queued';
    onProgress?.(status,body.job);
    if(status==='succeeded'){
      if(!body.result)throw new Error('Production completed without a result.');
      return body.result;
    }
    if(status==='failed')throw new Error(body.job?.last_error||'Production job failed.');
    const serverDelay=Math.max(500,Math.min(10000,Number(body.poll_after_ms)||delay));
    await new Promise(resolve=>setTimeout(resolve,serverDelay));
    delay=Math.min(5000,Math.round(delay*1.25));
  }
  throw new Error('Production is still processing. You can safely retry; PARABLE will reuse the same job.');
}

async function adaptProject(payload,projectId){
  const jobPayload={...payload,projectId};
  const idempotencyKey=await stableIdempotencyKey(JSON.stringify({
    projectId,
    title:payload.title||'',
    sourceText:payload.sourceText||'',
    setting:payload.setting||'',
    primaryAudience:payload.primaryAudience||''
  }));
  const body=await submitDurableJob('adaptation',jobPayload,idempotencyKey);
  rememberPendingProduction(body.job.id,projectId);
  const result=await waitForJob(body.job.id,{
    onProgress:(status)=>{
      if(status==='queued')$('#formNote').textContent='Production queued safely. PARABLE is preparing Story Intelligence…';
      if(status==='processing')$('#formNote').textContent='Story Intelligence is processing. You can stay on this screen; the work is durable.';
      if(status==='retrying')$('#formNote').textContent='A provider slowed down. PARABLE preserved the job and is retrying safely…';
    }
  });
  clearPendingProduction();
  return result;
}

async function runDirectorCritic(){
  if(!currentProjectId||!currentResult?.story_version){showToast('Analyze the story first.');return;}
  const buttons=[$('#runCriticBtn'),$('#rerunCriticBtn')].filter(Boolean);
  buttons.forEach(button=>button.disabled=true);
  if($('#criticState'))$('#criticState').textContent='Film Quality Critic is queued safely…';
  showToast('Director Critic is reviewing the production.');
  try{
    const payload={projectId:currentProjectId,storyVersion:currentResult.story_version};
    const key=await stableIdempotencyKey('critic|'+currentProjectId+'|'+currentResult.story_version);
    const body=await submitDurableJob('film-critic',payload,key);
    const review=await waitForJob(body.job.id,{
      onProgress:(status)=>{
        if($('#criticState'))$('#criticState').textContent=status==='processing'
          ?'Film Quality Critic is reviewing the current production…'
          :'Film Quality Critic is waiting in the durable production queue…';
      }
    });
    renderCritic(review);
    showToast(review.engine?.mode==='model'?'Model-backed Director Critic complete.':'Structural Director Critic complete.');
  }catch(err){
    showToast(err.message||'Director Critic failed.');
    if($('#criticState'))$('#criticState').textContent=err.message||'Director Critic failed.';
  }finally{
    buttons.forEach(button=>button.disabled=false);
  }
}

async function persistDirection(){
  if(!currentProjectId||!currentResult?.story_version||!activeShot)return;
  $('#directionSaveState').textContent='Saving direction…';
  const payload={
    projectId:currentProjectId,
    storyVersion:currentResult.story_version,
    shotId:activeShot.id,
    lens_mm:Number(activeShot.lens_mm||50),
    motion:activeShot.motion||'',
    lighting:activeShot.lighting||'',
    performance:activeShot.performance||'',
    blocking:activeShot.blocking||'',
    ...(Number.isFinite(Number(currentProjectRevision))?{expectedProjectRevision:Number(currentProjectRevision)}:{})
  };
  try{
    const r=await fetch('/api/direction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const body=await r.json();
    if(!r.ok){
      if(r.status===409&&(body.code==='PROJECT_REVISION_CONFLICT'||body.code==='PROJECT_MUTATION_BUSY')){
        try{
          const latest=await fetch('/api/project-revision?projectId='+encodeURIComponent(currentProjectId),{cache:'no-store'}).then(x=>x.json());
          if(Number.isFinite(Number(latest?.revision)))currentProjectRevision=Number(latest.revision);
        }catch{}
        throw new Error('This project changed elsewhere while you were directing. PARABLE protected the newer version instead of overwriting it.');
      }
      throw new Error(body.error||'Could not save this directing choice');
    }
    if(Number.isFinite(Number(body.project_revision)))currentProjectRevision=Number(body.project_revision);
    $('#directionSaveState').textContent='Saved safely to project revision '+(currentProjectRevision??'—')+'.';
  }catch(err){
    $('#directionSaveState').textContent='Not saved — retry by changing the control again.';
    showToast(err.message||'Direction save failed.');
  }
}

function scheduleDirectionSave(){
  clearTimeout(directionTimer);
  directionTimer=setTimeout(persistDirection,420);
}

form?.addEventListener('submit',async e=>{
  e.preventDefault();
  const payload=Object.fromEntries(new FormData(form).entries());
  analyzeBtn.disabled=true;
  analyzeBtn.querySelector('span').textContent=currentProjectId?'Re-analyzing…':'Creating production…';
  $('#formNote').textContent='PARABLE is reading the actual manuscript and building the production structure.';
  try{
    if(!currentProjectId){
      const project=await createProject(payload);currentProjectId=project.id;
      analyzeBtn.querySelector('span').textContent='Understanding story…';
    }
    const result=await adaptProject(payload,currentProjectId);
    renderResult(result);
    const model=result.engine?.mode==='model';
    $('#formNote').textContent=model
      ?`Model-backed Story Intelligence completed with ${result.engine.provider}. The source and this analysis were versioned together.`
      :'Structured fallback completed. The production is real and versioned, but deeper model reasoning is waiting for a provider key.';
    showToast(model?'Story Intelligence model pass complete.':'Structured Story Intelligence complete.');
  }catch(err){
    $('#formNote').textContent=err.message;showToast(err.message);
  }finally{
    analyzeBtn.disabled=false;analyzeBtn.querySelector('span').textContent='Analyze story';
  }
});

$$('.workflow-step').forEach(btn=>btn.addEventListener('click',()=>{
  const step=btn.dataset.step;
  if(step==='write'){$('.story-pane')?.scrollIntoView({behavior:'smooth',block:'start'});return}
  if(!currentResult){showToast('Analyze the story first.');return}
  setStep(step);
}));

$('#copyScreenplay')?.addEventListener('click',async()=>{
  if(!currentResult)return;
  const text=[currentResult.screenplay.heading,...currentResult.screenplay.beats.map(b=>b.type==='dialogue'?`${b.speaker}\n${b.text}`:b.text)].join('\n\n');
  try{await navigator.clipboard.writeText(text);showToast('Screenplay copied.')}catch{showToast('Copy is not available in this browser.')}
});

$('#runCriticBtn')?.addEventListener('click',runDirectorCritic);
$('#rerunCriticBtn')?.addEventListener('click',runDirectorCritic);

$('#lensControl')?.addEventListener('change',e=>{
  $('#shotPreview').dataset.lens=e.target.value;
  if(activeShot){activeShot.lens_mm=Number(e.target.value);scheduleDirectionSave();}
});
$('#motionControl')?.addEventListener('change',e=>{if(activeShot){activeShot.motion=e.target.value;scheduleDirectionSave();}showToast(`Motion: ${e.target.value}`)});
$('#lightControl')?.addEventListener('change',e=>{if(activeShot){activeShot.lighting=e.target.value;scheduleDirectionSave();}showToast(`Light: ${e.target.value}`)});

async function resumePendingProduction(){
  const pending=readPendingProduction();
  if(!pending)return;
  currentProjectId=pending.projectId;
  $('#formNote').textContent='Restoring your in-progress production…';
  try{
    const result=await waitForJob(pending.jobId,{
      timeoutMs:180000,
      onProgress:(status)=>{
        $('#formNote').textContent=status==='retrying'
          ?'Production is being retried safely after an upstream delay…'
          :'Restoring durable production work…';
      }
    });
    clearPendingProduction();
    renderResult(result);
    $('#formNote').textContent='Your production was restored from the durable job queue.';
    showToast('Production restored.');
  }catch(err){
    if(String(err?.message||'').includes('still processing'))return;
    clearPendingProduction();
    $('#formNote').textContent=err.message||'Could not restore the previous production job.';
  }
}

loadAiStatus();
resumePendingProduction();