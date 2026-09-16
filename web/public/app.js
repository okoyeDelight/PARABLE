const API='/api';
const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const featuredStage=$('#featuredStage');
const storyShelf=$('#storyShelf');
const engineRail=$('#engineRail');
const dialog=$('#storyDialog');
const form=$('#storyForm');
const storyView=$('#storyView');
const toast=$('#toast');
let projects=[];

const palettes=[
  {g:'radial-gradient(circle at 73% 24%,#786947 0 9%,transparent 31%),linear-gradient(135deg,#283127 0%,#141914 43%,#55472c 100%)',glow:'rgba(224,194,117,.34)'},
  {g:'radial-gradient(circle at 68% 28%,#624448 0 10%,transparent 33%),linear-gradient(140deg,#232c2b 0%,#111617 46%,#4a2f36 100%)',glow:'rgba(194,111,126,.30)'},
  {g:'radial-gradient(circle at 73% 24%,#465e66 0 8%,transparent 30%),linear-gradient(135deg,#202928 0%,#0d1213 48%,#354a51 100%)',glow:'rgba(115,182,199,.27)'},
  {g:'radial-gradient(circle at 70% 21%,#5f5147 0 8%,transparent 29%),linear-gradient(145deg,#2b2822 0%,#12110f 48%,#4d4438 100%)',glow:'rgba(220,184,131,.27)'},
  {g:'radial-gradient(circle at 72% 25%,#4c5d42 0 9%,transparent 30%),linear-gradient(140deg,#263021 0%,#11150e 47%,#394d2f 100%)',glow:'rgba(159,190,128,.28)'}
];
const artFor=(text='')=>palettes[[...text].reduce((n,c)=>n+c.charCodeAt(0),0)%palettes.length];
const statusLabel=v=>({story_bible:'Story Bible',episode_plan:'Episode Plan',production:'In Production',complete:'Complete',draft:'Early Draft'}[v]||v);
const scopeLabel=p=>p.primary_audience||({global:'Global Christian audience',regional:'Regional audience',local:'Local community'}[p.audience_scope]||'Global audience');
const escapeHtml=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const timeAgo=date=>{const d=Date.now()-new Date(date).getTime(),m=Math.floor(d/60000);if(m<1)return'Just now';if(m<60)return`${m}m ago`;const h=Math.floor(m/60);if(h<24)return`${h}h ago`;const days=Math.floor(h/24);return`${days}d ago`};

function styleVars(p){const a=artFor(p.title);return `--art-gradient:${a.g};--art-glow:${a.glow}`}
function chip(text){return `<span class="chip">${escapeHtml(text)}</span>`}

function renderFeatured(p){
  if(!p){featuredStage.innerHTML='<div class="featured-loading">Start your first production.</div>';return}
  featuredStage.innerHTML=`<article class="featured-card project-trigger" data-id="${escapeHtml(p.id)}" style="${styleVars(p)}">
    <div class="feature-glow"></div><div class="feature-lines"></div>
    <div class="feature-content">
      <div class="feature-status"><i></i><span>${escapeHtml(statusLabel(p.status))} · updated ${timeAgo(p.updated_at)}</span></div>
      <h2>${escapeHtml(p.title)}</h2>
      <p class="feature-logline">${escapeHtml(p.logline||'A story waiting for its first creative analysis.')}</p>
      <div class="feature-chips">${chip(p.setting||'World not grounded')}${chip(scopeLabel(p))}${chip(p.story_period==='present'?'Present day':p.story_period)}</div>
      <div class="feature-actions"><button class="feature-primary" data-open="${escapeHtml(p.id)}">Continue production <span>→</span></button><button class="feature-more">•••</button></div>
    </div>
    <div class="feature-progress"><span>Development</span><div class="ring" style="--p:${Number(p.progress)||0}"><b>${Number(p.progress)||0}%</b></div></div>
  </article>`;
  const card=$('.featured-card');
  card.addEventListener('pointermove',e=>{if(innerWidth<820)return;const r=card.getBoundingClientRect();const x=((e.clientX-r.left)/r.width-.5)*18,y=((e.clientY-r.top)/r.height-.5)*18;card.style.setProperty('--px',`${x}px`);card.style.setProperty('--py',`${y}px`)});
  card.addEventListener('pointerleave',()=>{card.style.setProperty('--px','0px');card.style.setProperty('--py','0px')});
}

function renderShelf(list){
  if(!list.length){storyShelf.innerHTML='<div class="shelf-loading">No productions yet.</div>';return}
  storyShelf.innerHTML=list.map(p=>`<button class="story-card project-trigger" data-id="${escapeHtml(p.id)}" style="${styleVars(p)}">
    <div class="story-art"></div>
    <div class="story-card-content"><span class="story-state">${escapeHtml(statusLabel(p.status))}</span><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.logline||'A story waiting for its first creative analysis.')}</p><div class="story-card-foot"><div class="tiny-progress"><i style="width:${Number(p.progress)||0}%"></i></div><span>${Number(p.progress)||0}%</span></div></div>
  </button>`).join('');
}

function renderEngines(list){engineRail.innerHTML=list.map(e=>`<div class="engine-pill"><strong>${escapeHtml(e.display_name)}</strong><span>${escapeHtml(e.status)}</span></div>`).join('')}

function openStory(p,source){
  const a=artFor(p.title);
  $('#storyViewArt').style.cssText=`--art-gradient:${a.g};--art-glow:${a.glow};background:${a.g}`;
  $('#detailStatus').textContent=statusLabel(p.status);$('#detailUpdated').textContent=`Updated ${timeAgo(p.updated_at)}`;$('#detailTitle').textContent=p.title;$('#detailLogline').textContent=p.logline||'A story waiting for its first creative analysis.';$('#detailSetting').textContent=p.setting||'Not grounded yet';$('#detailAudience').textContent=scopeLabel(p);$('#detailProgress').textContent=`${Number(p.progress)||0}% developed`;$('#detailProgressBar').style.width=`${Number(p.progress)||0}%`;
  const perform=()=>{storyView.classList.add('open');storyView.setAttribute('aria-hidden','false');document.body.style.overflow='hidden'};
  if(document.startViewTransition&&source){source.style.viewTransitionName='story-source';$('#storyViewArt').style.viewTransitionName='story-source';document.startViewTransition(perform).finished.finally(()=>{source.style.viewTransitionName='';$('#storyViewArt').style.viewTransitionName=''})}else perform();
}
function closeStory(){storyView.classList.remove('open');storyView.setAttribute('aria-hidden','true');document.body.style.overflow=''}

function bindProjectTriggers(){
  $$('.project-trigger').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('.feature-more'))return;const p=projects.find(x=>x.id===el.dataset.id);if(p)openStory(p,el)}));
}
function showToast(message){toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),2600)}
function openDialog(){dialog.showModal();setTimeout(()=>form.elements.title?.focus(),320)}

async function load(){
  try{
    const [pr,er]=await Promise.all([fetch(`${API}/projects`),fetch(`${API}/engines`)]);if(!pr.ok)throw new Error('Could not load your productions');projects=await pr.json();const engines=er.ok?await er.json():[];renderFeatured(projects[0]);renderShelf(projects);renderEngines(engines);bindProjectTriggers();
  }catch(err){featuredStage.innerHTML=`<div class="featured-loading">${escapeHtml(err.message)}. Refresh to retry.</div>`;storyShelf.innerHTML=''}
}

$('#newStoryBtn').addEventListener('click',openDialog);$('#mobileNewStory').addEventListener('click',openDialog);$('#closeDialog').addEventListener('click',()=>dialog.close());$('#cancelDialog').addEventListener('click',()=>dialog.close());$('#closeStoryView').addEventListener('click',closeStory);$('.story-view-backdrop').addEventListener('click',closeStory);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&storyView.classList.contains('open'))closeStory()});
$('#searchBtn').addEventListener('click',()=>showToast('Search is coming into the studio next.'));
$('#seeAllBtn').addEventListener('click',()=>storyShelf.scrollIntoView({behavior:'smooth',block:'center'}));
$$('.nav-link,.dock-item').forEach(b=>b.addEventListener('click',()=>showToast(`${b.textContent.trim()} workspace is being built.`)));
$('.round-arrow').addEventListener('click',()=>showToast('Living Context Engine is mapped for the next build stage.'));
$('.detail-primary').addEventListener('click',()=>showToast('Story workspace is next in the production flow.'));

form.addEventListener('submit',async e=>{
  e.preventDefault();const submit=$('[type="submit"]',form);const original=submit.innerHTML;submit.disabled=true;submit.innerHTML='Creating…';const data=Object.fromEntries(new FormData(form).entries());
  try{const r=await fetch(`${API}/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not create production');form.reset();dialog.close();await load();showToast('Production created. Welcome to the studio.')}catch(err){showToast(err.message)}finally{submit.disabled=false;submit.innerHTML=original}
});

const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}}),{threshold:.08});$$('.reveal').forEach(el=>observer.observe(el));
load();