const API='/api';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const dialog=$('#storyDialog');
const form=$('#storyForm');
const toast=$('#toast');
const rail=$('#productionRail');
let projects=[];

const escapeHtml=(v='')=>String(v).replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','\"':'&quot;'}[c]));
const palettes=[
  ['linear-gradient(145deg,#4d5cff,#181b62 58%,#080b24)','rgba(81,100,255,.68)'],
  ['linear-gradient(145deg,#f16d9b,#55223f 58%,#1c0b17)','rgba(241,109,155,.52)'],
  ['linear-gradient(145deg,#5db9d4,#1c4f63 58%,#071c25)','rgba(93,185,212,.5)'],
  ['linear-gradient(145deg,#d9a963,#66431d 58%,#211508)','rgba(217,169,99,.5)']
];
const paletteFor=(text='')=>palettes[[...text].reduce((n,c)=>n+c.charCodeAt(0),0)%palettes.length];
const showToast=(message)=>{if(!toast)return;toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),2400)};

function openDialog(){dialog?.showModal();setTimeout(()=>form?.elements?.title?.focus(),120)}
function closeDialog(){dialog?.close()}
function scrollToStudio(){document.querySelector('#productions')?.scrollIntoView({behavior:'smooth',block:'start'})}

function renderProductions(list){
  if(!rail)return;
  if(!list.length){rail.innerHTML='<div class="loading-card">No productions yet. Start your first story.</div>';return}
  rail.innerHTML=list.map(p=>{const [bg,glow]=paletteFor(p.title);return `<button class="production-card" type="button" data-id="${escapeHtml(p.id)}"><div class="production-art" style="--card-bg:${bg};--card-glow:${glow}"><b>${escapeHtml(p.title)}</b></div><div class="production-body"><small>${escapeHtml((p.status||'draft').replaceAll('_',' ').toUpperCase())}</small><p>${escapeHtml(p.logline||'A story waiting for its first creative analysis.')}</p></div></button>`}).join('');
  $$('.production-card',rail).forEach(card=>card.addEventListener('click',()=>showToast('The immersive story opening comes in Stage 4.')));
}

async function loadProjects(){
  try{
    const r=await fetch(`${API}/projects`);if(!r.ok)throw new Error('Could not load productions');
    projects=await r.json();
    renderProductions(projects);
    window.ParableHeroFilm?.setStories(projects);
  }catch(err){if(rail)rail.innerHTML=`<div class="loading-card">${escapeHtml(err.message)}. Refresh to retry.</div>`}
}

['#newStoryBtn','#heroStart','#statementStart','#mobileNewStory'].forEach(id=>$(id)?.addEventListener('click',openDialog));
$('#closeDialog')?.addEventListener('click',closeDialog);
$('#cancelDialog')?.addEventListener('click',closeDialog);
$('#studioJump')?.addEventListener('click',scrollToStudio);
$('#heroStudio')?.addEventListener('click',()=>document.querySelector('#heroFilm')?.scrollIntoView({behavior:'smooth',block:'center'}));

const menu=$('#mobileMenu');
const menuBtn=$('#menuBtn');
menuBtn?.addEventListener('click',()=>{const open=menu?.hasAttribute('hidden');if(open)menu?.removeAttribute('hidden');else menu?.setAttribute('hidden','');menuBtn.setAttribute('aria-expanded',String(open))});
$$('[data-jump]',menu||document).forEach(btn=>btn.addEventListener('click',()=>{document.querySelector(btn.dataset.jump)?.scrollIntoView({behavior:'smooth'});menu?.setAttribute('hidden','');menuBtn?.setAttribute('aria-expanded','false')}));

document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(dialog?.open)dialog.close();if(menu&&!menu.hasAttribute('hidden')){menu.setAttribute('hidden','');menuBtn?.setAttribute('aria-expanded','false')}}});

form?.addEventListener('submit',async e=>{
  e.preventDefault();
  const submit=$('.dialog-submit',form);const original=submit?.innerHTML||'Create production';if(submit){submit.disabled=true;submit.textContent='Creating…'}
  const data=Object.fromEntries(new FormData(form).entries());
  try{
    const r=await fetch(`${API}/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not create production');
    form.reset();dialog?.close();await loadProjects();showToast('Production created. It is now part of PARABLE.');
  }catch(err){showToast(err.message)}finally{if(submit){submit.disabled=false;submit.innerHTML=original}}
});

loadProjects();