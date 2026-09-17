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

const escapeHtml=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const showToast=(message)=>{if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),2200)};

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
  $('#engineBadge').textContent=data.engine.version;
}

function renderScreenplay(data){
  $('#sceneHeading').textContent=data.screenplay.heading;
  $('#screenplayBeats').innerHTML=data.screenplay.beats.map(beat=>{
    if(beat.type==='dialogue') return `<div class="beat dialogue"><b>${escapeHtml(beat.speaker)}</b><span>${escapeHtml(beat.text)}</span></div>`;
    return `<p class="beat">${escapeHtml(beat.text)}</p>`;
  }).join('');
}

function selectShot(shot){
  activeShot=shot;
  $$('.shot-item').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.shot===shot.id));
  $('#previewShotId').textContent=shot.id.replace('_',' ').toUpperCase()+` · ${shot.shot_size.toUpperCase()}`;
  $('#previewBeat').textContent=shot.beat;
  $('#lensControl').value=String(shot.lens_mm);
  const motion=$('#motionControl');if([...motion.options].some(o=>o.value===shot.motion))motion.value=shot.motion;
  const light=$('#lightControl');if([...light.options].some(o=>o.value===shot.lighting))light.value=shot.lighting;
  $('#performanceText').textContent=shot.performance;
  $('#shotPreview').dataset.lens=String(shot.lens_mm);
}

function renderDirect(data){
  $('#projectBadge').textContent=currentProjectId?`PROJECT · ${currentProjectId.slice(-6).toUpperCase()}`:'LIVE PROJECT';
  $('#shotBrowser').innerHTML=data.shot_plan.map((shot,index)=>`<button type="button" class="shot-item${index===1?' is-active':''}" data-shot="${escapeHtml(shot.id)}"><small>${escapeHtml(shot.id.replace('_',' ').toUpperCase())}</small><b>${escapeHtml(shot.shot_size)}</b></button>`).join('');
  $$('.shot-item').forEach(btn=>btn.addEventListener('click',()=>{
    const shot=data.shot_plan.find(s=>s.id===btn.dataset.shot);if(shot)selectShot(shot);
  }));
  selectShot(data.shot_plan[1]||data.shot_plan[0]);
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
    $('#formNote').textContent='This result came from the story currently in the editor. Change the text and run it again to verify the output changes.';
    showToast('Story Intelligence complete.');
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
  if(activeShot)activeShot={...activeShot,lens_mm:Number(e.target.value)};
});
$('#motionControl')?.addEventListener('change',e=>{if(activeShot)activeShot={...activeShot,motion:e.target.value};showToast(`Motion: ${e.target.value}`)});
$('#lightControl')?.addEventListener('change',e=>{if(activeShot)activeShot={...activeShot,lighting:e.target.value};showToast(`Light: ${e.target.value}`)});
