const API='/api';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const dialog=$('#storyDialog');
const form=$('#storyForm');
const toast=$('#toast');
const film=$('#filmFrame');
const filmPlay=$('#filmPlay');
const rail=$('#productionRail');
let projects=[];

const escapeHtml=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const palettes=[
  ['linear-gradient(145deg,#4d5cff,#181b62 58%,#080b24)','rgba(81,100,255,.68)'],
  ['linear-gradient(145deg,#f16d9b,#55223f 58%,#1c0b17)','rgba(241,109,155,.52)'],
  ['linear-gradient(145deg,#5db9d4,#1c4f63 58%,#071c25)','rgba(93,185,212,.5)'],
  ['linear-gradient(145deg,#d9a963,#66431d 58%,#211508)','rgba(217,169,99,.5)']
];
const paletteFor=(text='')=>palettes[[...text].reduce((n,c)=>n+c.charCodeAt(0),0)%palettes.length];
const showToast=(message)=>{toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),2600)};

function openDialog(){dialog.showModal();setTimeout(()=>form.elements.title?.focus(),180)}
function closeDialog(){dialog.close()}
function scrollToStudio(){document.querySelector('#productions')?.scrollIntoView({behavior:'smooth',block:'start'})}

function renderFilmCovers(list){
  const els=[$('#filmCover1'),$('#filmCover2'),$('#filmCover3')];
  els.forEach((el,i)=>{const p=list[i];if(!el||!p)return;const b=$('b',el);if(b)b.textContent=p.title});
}

function renderProductions(list){
  if(!list.length){rail.innerHTML='<div class="loading-card">No productions yet. Start your first story.</div>';return}
  rail.innerHTML=list.map(p=>{const [bg,glow]=paletteFor(p.title);return `<button class="production-card" type="button" data-id="${escapeHtml(p.id)}"><div class="production-art" style="--card-bg:${bg};--card-glow:${glow}"><b>${escapeHtml(p.title)}</b></div><div class="production-body"><small>${escapeHtml((p.status||'draft').replaceAll('_',' ').toUpperCase())}</small><p>${escapeHtml(p.logline||'A story waiting for its first creative analysis.')}</p></div></button>`}).join('');
  $$('.production-card',rail).forEach(card=>card.addEventListener('click',()=>showToast('Stage 4 will open this cover into its immersive story world.')));
}

async function loadProjects(){
  try{
    const r=await fetch(`${API}/projects`);if(!r.ok)throw new Error('Could not load productions');projects=await r.json();renderFilmCovers(projects);renderProductions(projects)
  }catch(err){rail.innerHTML=`<div class="loading-card">${escapeHtml(err.message)}. Refresh to retry.</div>`}
}

filmPlay.addEventListener('click',()=>{const paused=film.classList.toggle('paused');filmPlay.setAttribute('aria-pressed',String(!paused))});

['#newStoryBtn','#heroStart','#statementStart','#mobileNewStory'].forEach(id=>$(id)?.addEventListener('click',openDialog));
$('#closeDialog').addEventListener('click',closeDialog);$('#cancelDialog').addEventListener('click',closeDialog);
$('#studioJump').addEventListener('click',scrollToStudio);$('#heroStudio').addEventListener('click',scrollToStudio);

const menu=$('#mobileMenu');const menuBtn=$('#menuBtn');
menuBtn.addEventListener('click',()=>{const open=menu.hasAttribute('hidden');if(open)menu.removeAttribute('hidden');else menu.setAttribute('hidden','');menuBtn.setAttribute('aria-expanded',String(open))});
$$('[data-jump]',menu).forEach(btn=>btn.addEventListener('click',()=>{document.querySelector(btn.dataset.jump)?.scrollIntoView({behavior:'smooth'});menu.setAttribute('hidden','');menuBtn.setAttribute('aria-expanded','false')}));

document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(dialog.open)dialog.close();if(!menu.hasAttribute('hidden')){menu.setAttribute('hidden','');menuBtn.setAttribute('aria-expanded','false')}}});

form.addEventListener('submit',async e=>{
  e.preventDefault();const submit=$('.dialog-submit',form);const original=submit.innerHTML;submit.disabled=true;submit.textContent='Creating…';
  const data=Object.fromEntries(new FormData(form).entries());
  try{
    const r=await fetch(`${API}/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not create production');form.reset();dialog.close();await loadProjects();showToast('Production created. It is now part of PARABLE.')
  }catch(err){showToast(err.message)}finally{submit.disabled=false;submit.innerHTML=original}
});

const nav=$('#siteNav');let lastY=0;window.addEventListener('scroll',()=>{const y=window.scrollY;nav.style.opacity=y>lastY&&y>180?'.2':'1';nav.style.transition='opacity .3s ease';lastY=y},{passive:true});

loadProjects();