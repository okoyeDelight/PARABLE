const API='/api';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const dialog=$('#storyDialog');
const form=$('#storyForm');
const toast=$('#toast');
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

function renderProductions(list){
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
  }catch(err){rail.innerHTML=`<div class="loading-card">${escapeHtml(err.message)}. Refresh to retry.</div>`}
}

['#newStoryBtn','#heroStart','#statementStart','#mobileNewStory'].forEach(id=>$(id)?.addEventListener('click',openDialog));
$('#closeDialog').addEventListener('click',closeDialog);
$('#cancelDialog').addEventListener('click',closeDialog);
$('#studioJump').addEventListener('click',scrollToStudio);
$('#heroStudio').addEventListener('click',()=>document.querySelector('#heroFilm')?.scrollIntoView({behavior:'smooth',block:'center'}));

const menu=$('#mobileMenu');
const menuBtn=$('#menuBtn');
menuBtn.addEventListener('click',()=>{const open=menu.hasAttribute('hidden');if(open)menu.removeAttribute('hidden');else menu.setAttribute('hidden','');menuBtn.setAttribute('aria-expanded',String(open))});
$$('[data-jump]',menu).forEach(btn=>btn.addEventListener('click',()=>{document.querySelector(btn.dataset.jump)?.scrollIntoView({behavior:'smooth'});menu.setAttribute('hidden','');menuBtn.setAttribute('aria-expanded','false')}));

document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(dialog.open)dialog.close();if(!menu.hasAttribute('hidden')){menu.setAttribute('hidden','');menuBtn.setAttribute('aria-expanded','false')}}});

form.addEventListener('submit',async e=>{
  e.preventDefault();
  const submit=$('.dialog-submit',form);const original=submit.innerHTML;submit.disabled=true;submit.textContent='Creating…';
  const data=Object.fromEntries(new FormData(form).entries());
  try{
    const r=await fetch(`${API}/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const body=await r.json();if(!r.ok)throw new Error(body.error||'Could not create production');
    form.reset();dialog.close();await loadProjects();showToast('Production created. It is now part of PARABLE.');
  }catch(err){showToast(err.message)}finally{submit.disabled=false;submit.innerHTML=original}
});

const nav=$('#siteNav');
let lastY=0;
window.addEventListener('scroll',()=>{
  const y=window.scrollY;
  nav.style.opacity=y>lastY&&y>180?'.18':'1';
  nav.style.transition='opacity .3s ease';
  lastY=y;
},{passive:true});

/* Stage 1 premium pass / Scene 05 — CUT.
   This is deterministic, browser-rendered footage rather than paid generated
   video: one hero take, two supporting shots, real editorial hierarchy, and
   a timeline whose motion visually syncs with the shot. */
function upgradeCutScene(){
  const scene=$('.scene-edit');
  const preview=$('.edit-preview',scene);
  const timeline=$('.edit-timeline',scene);
  if(!scene||!preview||!timeline||scene.dataset.premiumCut==='1')return;
  scene.dataset.premiumCut='1';

  preview.innerHTML=`
    <div class="preview-frame pf-a cut-main-monitor">
      <div class="cut-shot cut-shot-altar">
        <div class="cut-room"></div>
        <div class="cut-window"></div>
        <div class="cut-light-beam"></div>
        <div class="cut-back-wall"></div>
        <div class="cut-altar-table"></div>
        <div class="cut-candle cut-candle-a"></div>
        <div class="cut-candle cut-candle-b"></div>
        <div class="cut-person"></div>
        <div class="cut-dust cut-dust-a"></div>
        <div class="cut-dust cut-dust-b"></div>
        <div class="cut-dust cut-dust-c"></div>
        <div class="cut-film-grain"></div>
        <div class="cut-grade"></div>
        <div class="cut-monitor-meta"><small>SCENE 07 · TAKE 04</small><b>THE ALTAR</b></div>
        <div class="cut-timecode">00:00:07:18</div>
      </div>
    </div>
    <div class="preview-frame pf-b cut-support-monitor cut-reaction-monitor">
      <div class="reaction-bg"></div>
      <div class="reaction-face"></div>
      <div class="reaction-rim"></div>
      <div class="support-meta"><small>07B</small><b>REACTION</b></div>
    </div>
    <div class="preview-frame pf-c cut-support-monitor cut-world-monitor">
      <div class="world-window"></div>
      <div class="world-rain"></div>
      <div class="world-corridor"></div>
      <div class="support-meta"><small>07C</small><b>WORLD</b></div>
    </div>
    <div class="edit-playhead"></div>`;

  const videoTrack=$('.video-track',timeline);
  if(videoTrack){
    videoTrack.innerHTML=`
      <i class="clip-a"><span>07A · PUSH IN</span></i>
      <i class="clip-b"><span>07B · REACTION</span></i>
      <i class="clip-c"><span>07C · WORLD</span></i>`;
  }

  const style=document.createElement('style');
  style.id='parable-premium-cut-scene';
  style.textContent=`
    .film-stage-contained .scene-edit{
      background:
        radial-gradient(ellipse 48% 46% at 48% 28%,rgba(61,75,150,.10),transparent 72%),
        #07080b!important;
    }
    .film-stage-contained .scene-edit .edit-preview{
      left:5%!important;right:5%!important;top:7%!important;height:54%!important;
      display:grid!important;grid-template-columns:1.56fr .72fr .72fr!important;
      gap:10px!important;
    }
    .film-stage-contained .scene-edit .preview-frame{
      min-width:0!important;overflow:hidden!important;border-radius:14px!important;
      border:1px solid rgba(255,255,255,.09)!important;background:#080a0e!important;
      box-shadow:0 20px 52px rgba(0,0,0,.42)!important;
    }
    .film-stage-contained .scene-edit .cut-main-monitor{
      border-color:rgba(121,153,255,.20)!important;
      box-shadow:0 22px 60px rgba(0,0,0,.50),0 0 28px rgba(70,92,255,.08)!important;
    }
    .cut-shot{position:absolute;inset:0;overflow:hidden;background:#090b0f;transform-origin:52% 50%;}
    .scene-edit.is-active .cut-shot-altar{animation:parableCutCameraPush 2s cubic-bezier(.24,.68,.31,1) both;}
    .cut-room{position:absolute;inset:-4%;background:
      linear-gradient(180deg,rgba(9,13,19,.08),rgba(2,3,5,.68)),
      radial-gradient(ellipse at 67% 30%,rgba(188,208,255,.17),transparent 26%),
      linear-gradient(108deg,#080b10 0%,#111824 48%,#07090d 100%);}
    .cut-back-wall{position:absolute;left:0;right:0;bottom:0;height:51%;background:
      linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px),
      linear-gradient(180deg,#090b0e,#050608);background-size:25% 100%,100% 100%;}
    .cut-window{position:absolute;right:10%;top:5%;width:25%;height:61%;border:1px solid rgba(213,225,255,.16);background:
      linear-gradient(90deg,transparent 48%,rgba(255,255,255,.12) 49%,rgba(255,255,255,.12) 51%,transparent 52%),
      linear-gradient(180deg,transparent 48%,rgba(255,255,255,.10) 49%,rgba(255,255,255,.10) 51%,transparent 52%),
      linear-gradient(155deg,#7e8aa7 0%,#27334a 38%,#0a0f18 100%);box-shadow:0 0 45px rgba(155,182,255,.12);}
    .cut-light-beam{position:absolute;right:-5%;top:-8%;width:60%;height:120%;background:linear-gradient(107deg,transparent 16%,rgba(193,211,255,.05) 36%,rgba(223,232,255,.16) 49%,rgba(170,193,255,.07) 57%,transparent 76%);filter:blur(8px);transform:rotate(-8deg);opacity:.48;}
    .scene-edit.is-active .cut-light-beam{animation:parableCutLightMove 2s ease-in-out both;}
    .cut-altar-table{position:absolute;left:17%;bottom:17%;width:28%;height:19%;border-radius:3px;background:linear-gradient(180deg,#463625 0%,#1b130d 60%,#0c0906 100%);box-shadow:0 18px 34px rgba(0,0,0,.58),0 -2px 12px rgba(255,186,107,.05);}
    .cut-candle{position:absolute;bottom:36%;width:3px;height:17%;background:linear-gradient(#e7dac1,#75664f);box-shadow:0 0 7px rgba(255,210,145,.18);}
    .cut-candle::before{content:'';position:absolute;left:50%;top:-9px;width:9px;height:15px;transform:translateX(-50%);border-radius:55% 45% 60% 40%;background:radial-gradient(circle at 50% 65%,#fff6c9 0%,#ffc86b 34%,#ff7444 65%,transparent 73%);filter:drop-shadow(0 0 7px rgba(255,163,84,.58));}
    .cut-candle-a{left:23%}.cut-candle-b{left:38%;height:13%;}
    .scene-edit.is-active .cut-candle::before{animation:parableCutFlame .34s ease-in-out infinite alternate;}
    .cut-person{position:absolute;left:52%;bottom:5%;width:14%;height:58%;border-radius:45% 45% 10% 10%;background:linear-gradient(95deg,#040506 0%,#111621 55%,#06080d 100%);box-shadow:0 0 40px rgba(76,100,180,.10);}
    .cut-person::before{content:'';position:absolute;left:50%;top:-15%;width:62%;aspect-ratio:1;border-radius:50%;transform:translateX(-50%);background:radial-gradient(circle at 58% 38%,#252a32 0%,#11151c 48%,#050609 100%);box-shadow:8px 0 22px rgba(170,192,255,.07);}
    .cut-dust{position:absolute;width:2px;height:2px;border-radius:50%;background:rgba(222,228,255,.68);box-shadow:0 0 6px rgba(175,194,255,.38);opacity:.2;}
    .cut-dust-a{left:58%;top:33%}.cut-dust-b{left:72%;top:51%}.cut-dust-c{left:43%;top:27%}
    .scene-edit.is-active .cut-dust{animation:parableCutDust 1.9s ease-in-out infinite;}
    .scene-edit.is-active .cut-dust-b{animation-delay:-.6s}.scene-edit.is-active .cut-dust-c{animation-delay:-1.2s}
    .cut-film-grain{position:absolute;inset:-20%;opacity:.055;mix-blend-mode:soft-light;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitchTiles'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
    .scene-edit.is-active .cut-film-grain{animation:parableCutGrain .22s steps(2,end) infinite;}
    .cut-grade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,32,64,.05),rgba(5,6,9,.16)),radial-gradient(circle at 50% 48%,transparent 38%,rgba(0,0,0,.42) 100%);}
    .cut-monitor-meta{position:absolute;left:12px;bottom:10px;z-index:5;text-shadow:0 3px 10px rgba(0,0,0,.8)}
    .cut-monitor-meta small{display:block;font-size:5px;letter-spacing:.13em;color:rgba(223,227,237,.50);margin-bottom:3px}.cut-monitor-meta b{font-size:9px;font-weight:600;color:rgba(250,250,250,.90);letter-spacing:.02em}
    .cut-timecode{position:absolute;right:10px;bottom:10px;z-index:5;font-size:5px;letter-spacing:.08em;color:rgba(232,235,242,.56);font-variant-numeric:tabular-nums;}
    .cut-support-monitor{position:relative;background:#090a0e!important;}
    .reaction-bg{position:absolute;inset:-5%;background:radial-gradient(circle at 66% 35%,rgba(200,159,145,.20),transparent 25%),linear-gradient(135deg,#171114,#2e1c22 46%,#08090c 100%);}
    .reaction-face{position:absolute;width:48%;height:82%;left:32%;bottom:-7%;border-radius:50% 48% 42% 44%;background:radial-gradient(circle at 67% 31%,#5d4a49 0%,#2c2225 34%,#110f13 61%,#050608 100%);box-shadow:18px -8px 38px rgba(225,174,158,.08);transform:rotate(-3deg);}
    .reaction-face::before{content:'';position:absolute;right:18%;top:35%;width:9%;height:3%;border-radius:50%;background:rgba(235,221,216,.30);box-shadow:0 0 6px rgba(255,215,200,.12);}
    .reaction-rim{position:absolute;right:7%;top:-8%;width:38%;height:120%;background:linear-gradient(100deg,transparent,rgba(255,194,170,.12),transparent);filter:blur(8px);transform:rotate(-8deg);}
    .scene-edit.is-active .reaction-face{animation:parableReactionPush 2s cubic-bezier(.24,.68,.31,1) both;}
    .world-window{position:absolute;left:0;right:0;top:0;height:55%;background:linear-gradient(180deg,#1b2b39,#0a1119 70%,#06090c);}
    .world-window::after{content:'';position:absolute;left:10%;right:10%;top:12%;bottom:7%;border:1px solid rgba(157,190,220,.14);background:linear-gradient(90deg,transparent 49%,rgba(176,205,230,.10) 50%,transparent 51%);}
    .world-corridor{position:absolute;left:0;right:0;bottom:0;height:50%;background:linear-gradient(112deg,#060709 0%,#111721 49%,#050608 100%);clip-path:polygon(0 25%,100% 0,100% 100%,0 100%);}
    .world-rain{position:absolute;inset:0;background:repeating-linear-gradient(104deg,transparent 0 11px,rgba(179,215,235,.08) 12px,transparent 13px 22px);transform:translateY(-20%);}
    .scene-edit.is-active .world-rain{animation:parableRain 1.15s linear infinite;}
    .support-meta{position:absolute;left:9px;bottom:8px;z-index:5;text-shadow:0 2px 8px #000}.support-meta small{display:block;font-size:5px;color:rgba(255,255,255,.42);letter-spacing:.12em}.support-meta b{font-size:7px;color:rgba(255,255,255,.78);font-weight:600;}
    .film-stage-contained .scene-edit .edit-timeline{left:5%!important;right:5%!important;bottom:7%!important;height:26%!important;border-radius:14px!important;background:linear-gradient(180deg,#0f1116,#0a0c10)!important;box-shadow:0 18px 42px rgba(0,0,0,.28)!important;}
    .film-stage-contained .scene-edit .video-track{height:35px!important;gap:5px!important;}
    .film-stage-contained .scene-edit .video-track i{position:relative!important;overflow:hidden!important;border-radius:6px!important;display:flex!important;align-items:center!important;padding:0 7px!important;font-style:normal!important;}
    .film-stage-contained .scene-edit .video-track i span{font-size:5px!important;letter-spacing:.06em;color:rgba(226,231,248,.64);white-space:nowrap;}
    .film-stage-contained .scene-edit .clip-a{background:linear-gradient(90deg,#14204c,#1c2b61)!important;border-color:#4058ad!important;box-shadow:inset 0 0 18px rgba(91,116,255,.08);}
    .film-stage-contained .scene-edit .clip-b{background:linear-gradient(90deg,#261820,#402636)!important;border-color:#714b66!important;}
    .film-stage-contained .scene-edit .clip-c{background:linear-gradient(90deg,#102328,#163940)!important;border-color:#356f78!important;}
    .film-stage-contained .scene-edit .edit-playhead{z-index:9!important;top:0!important;bottom:0!important;width:1px!important;background:rgba(255,255,255,.88)!important;box-shadow:0 0 8px rgba(255,255,255,.55),0 0 14px rgba(102,133,255,.28)!important;}
    .scene-edit.is-active .edit-playhead{animation:parablePremiumPlayhead 2s linear both!important;}
    .scene-edit.is-active .clip-a{animation:parableActiveClip 2s ease-in-out both;}
    .film-stage-contained .scene-edit .edit-copy{left:7%!important;top:8%!important;z-index:10!important;text-shadow:0 2px 10px rgba(0,0,0,.7);}
    .film-stage-contained .scene-edit .edit-copy span{color:rgba(207,216,237,.48)!important}.film-stage-contained .scene-edit .edit-copy strong{color:rgba(255,255,255,.91)!important;}

    @keyframes parableCutCameraPush{from{transform:scale(1.015) translate3d(0,0,0)}to{transform:scale(1.075) translate3d(-.8%,-.6%,0)}}
    @keyframes parableCutLightMove{from{transform:rotate(-9deg) translateX(-3%);opacity:.30}to{transform:rotate(-6deg) translateX(5%);opacity:.58}}
    @keyframes parableCutFlame{from{transform:translateX(-50%) scale(.88) rotate(-2deg)}to{transform:translateX(-50%) scale(1.07) rotate(2deg)}}
    @keyframes parableCutDust{0%,100%{transform:translateY(7px);opacity:.12}55%{transform:translateY(-12px);opacity:.56}}
    @keyframes parableCutGrain{0%{transform:translate(0,0)}25%{transform:translate(2%,-1%)}50%{transform:translate(-1%,2%)}75%{transform:translate(1%,1%)}100%{transform:translate(-2%,-1%)}}
    @keyframes parableReactionPush{from{transform:rotate(-3deg) scale(1)}to{transform:rotate(-2deg) scale(1.06) translateX(-2%)}}
    @keyframes parableRain{from{transform:translateY(-18%)}to{transform:translateY(16%)}}
    @keyframes parablePremiumPlayhead{from{left:6%}to{left:94%}}
    @keyframes parableActiveClip{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18);box-shadow:inset 0 0 22px rgba(95,121,255,.16),0 0 10px rgba(83,105,255,.10)}}

    @media(prefers-reduced-motion:reduce){
      .scene-edit .cut-shot-altar,.scene-edit .cut-light-beam,.scene-edit .cut-candle::before,.scene-edit .cut-dust,.scene-edit .cut-film-grain,.scene-edit .reaction-face,.scene-edit .world-rain,.scene-edit .edit-playhead,.scene-edit .clip-a{animation:none!important;}
    }
  `;
  document.head.appendChild(style);
}

upgradeCutScene();
loadProjects();