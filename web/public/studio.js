const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const form=$('#goldenForm');
const analyzeBtn=$('#analyzeBtn');
const emptyState=$('#emptyState');
const resultState=$('#resultState');
const toast=$('#studioToast');
let currentProjectId=null;
let currentResult=null;
let activeShot=null;
let directionTimer=null;

const escapeHtml=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const showToast=(message)=>{if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),2200)};
const ensureOption=(select,value)=>{if(!select||value===undefined||value===null)return;if(![...select.options].some(o=>o.value===String(value))){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);select.append(option)}};

async function loadAiStatus(){
  try{
    const response=await fetch('/api/ai-status',{cache:'no-store'});
    if(!response.ok)return;
    const body=await response.json();
    const status=body.story_intelligence||{};
    const configured=status.configured_providers||{};
    const provider=configured.groq?'Groq':configured.gemini?'Gemini':null;
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
    const order=['write','understand','adapt','direct'];
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

function renderResult(data){
  currentResult=data;
  emptyState.hidden=true;
  resultState.hidden=false;
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

async function adaptProject(payload,projectId){
  const r=await fetch('/api/adapt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,projectId})});
  const body=await r.json();if(!r.ok)throw new Error(body.error||'Story Intelligence could not complete this pass');
  return body;
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
    blocking:activeShot.blocking||''
  };
  try{
    const r=await fetch('/api/direction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not save this directing choice');
    $('#directionSaveState').textContent='Saved to this story version.';
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

$('#lensControl')?.addEventListener('change',e=>{
  $('#shotPreview').dataset.lens=e.target.value;
  if(activeShot){activeShot.lens_mm=Number(e.target.value);scheduleDirectionSave();}
});
$('#motionControl')?.addEventListener('change',e=>{if(activeShot){activeShot.motion=e.target.value;scheduleDirectionSave();}showToast(`Motion: ${e.target.value}`)});
$('#lightControl')?.addEventListener('change',e=>{if(activeShot){activeShot.lighting=e.target.value;scheduleDirectionSave();}showToast(`Light: ${e.target.value}`)});

loadAiStatus();
