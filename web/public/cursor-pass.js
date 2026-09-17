(() => {
  const film = document.querySelector('#filmFrame');
  const stage = document.querySelector('#filmStage');
  if (!film || !stage || window.__parableCursorPass) return;
  window.__parableCursorPass = true;

  const mobile = matchMedia('(max-width: 720px)').matches;
  const saveData = navigator.connection?.saveData === true;
  const lowCore = (navigator.hardwareConcurrency || 8) <= 4;
  const mobilePerf = mobile || saveData || lowCore;

  /* Mobile performance mode: keep the art direction, remove the expensive
     continuously-rendered layers that were making lower-powered phones crawl. */
  if (mobilePerf) {
    document.documentElement.classList.add('parable-mobile-perf');
    const canvas = document.querySelector('#filmFx');
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.width = '1px';
      canvas.style.height = '1px';
      canvas.style.opacity = '0';
      canvas.style.pointerEvents = 'none';
    }
    document.querySelector('.page-grain')?.setAttribute('hidden', '');
  }

  const perfStyle = document.createElement('style');
  perfStyle.id = 'parable-mobile-performance';
  perfStyle.textContent = `
    .parable-mobile-perf .page-grain{display:none!important}
    .parable-mobile-perf .hero-film{contain:layout paint style;box-shadow:0 0 0 1px rgba(59,89,255,.12),0 24px 70px rgba(0,0,0,.52)!important}
    .parable-mobile-perf .film-aura{filter:blur(24px)!important;opacity:.58!important}
    .parable-mobile-perf .film-topbar,.parable-mobile-perf .film-bottom{backdrop-filter:none!important;background:rgba(9,10,14,.96)!important}
    .parable-mobile-perf .scene-shell,.parable-mobile-perf .director-controls,.parable-mobile-perf .demo-ui-action,.parable-mobile-perf .demo-intel-inspector,.parable-mobile-perf .demo-lens-menu{backdrop-filter:none!important}
    .parable-mobile-perf .cut-film-grain{display:none!important}
    .parable-mobile-perf .cover-glow{filter:blur(30px)!important;opacity:.20!important}
    .parable-mobile-perf .film-scene:not(.is-active){visibility:hidden!important;filter:none!important}
    .parable-mobile-perf .finish-card,.parable-mobile-perf .final-frame{box-shadow:0 16px 38px rgba(0,0,0,.44)!important}
    .parable-mobile-perf .production-section,.parable-mobile-perf .statement-section{content-visibility:auto;contain-intrinsic-size:900px}
  `;
  document.head.appendChild(perfStyle);

  const scenes = [...stage.querySelectorAll('.film-scene')];
  const add = (parent, html) => {
    if (!parent) return null;
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const node = wrap.firstElementChild;
    parent.appendChild(node);
    return node;
  };

  const write = stage.querySelector('.scene-write');
  const understand = stage.querySelector('.scene-understand');
  const covers = stage.querySelector('.scene-covers');
  const direct = stage.querySelector('.scene-direct');
  const edit = stage.querySelector('.scene-edit');
  const finish = stage.querySelector('.scene-finish');

  if (write && !write.querySelector('.demo-adapt-action')) add(write, `<button class="demo-ui-action demo-adapt-action" type="button"><span>✦</span> Adapt scene</button>`);
  if (understand && !understand.querySelector('.demo-intel-inspector')) add(understand, `<div class="demo-intel-inspector"><small>THEME</small><strong>Surrender</strong><span>Story confidence · 92%</span><i></i></div>`);
  if (covers && !covers.querySelector('.demo-world-chip')) add(covers, `<div class="demo-world-chip"><span>THE ALTAR</span><b>Open world</b><i>↗</i></div>`);
  if (direct && !direct.querySelector('.demo-lens-menu')) add(direct, `<div class="demo-lens-menu"><small>LENS</small><button>35 mm</button><button class="is-selected">50 mm</button><button>85 mm</button></div>`);
  if (edit && !edit.querySelector('.demo-cut-toast')) add(edit, `<div class="demo-cut-toast"><span>07B</span><b>Reaction selected</b></div>`);
  if (finish && !finish.querySelector('.demo-preview-action')) add(finish, `<button class="demo-ui-action demo-preview-action" type="button"><span>▶</span> Preview film</button>`);

  const cursor = document.createElement('div');
  cursor.className = 'parable-demo-cursor';
  cursor.setAttribute('aria-hidden','true');
  cursor.innerHTML = `<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M2.2 2.2 2.5 24l5.4-5.2 3.4 8.5 4.2-1.8-3.5-8.2 7.5-.2Z" fill="#fff" stroke="#090a0d" stroke-width="1.25" stroke-linejoin="round"/></svg><span class="cursor-click-ring"></span>`;
  stage.appendChild(cursor);

  const style = document.createElement('style');
  style.id = 'parable-cursor-film-pass';
  style.textContent = `
    .parable-demo-cursor{position:absolute;left:0;top:0;z-index:90;width:20px;height:25px;pointer-events:none;transform:translate3d(-40px,-40px,0);opacity:0;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55));transition:transform var(--cursor-dur,.46s) cubic-bezier(.22,.82,.24,1),opacity .15s ease;will-change:transform}
    .parable-demo-cursor svg{display:block;width:100%;height:100%;transform-origin:3px 3px;transition:transform .10s ease}.parable-demo-cursor.is-visible{opacity:1}.parable-demo-cursor.is-pressing svg{transform:scale(.84)}
    .cursor-click-ring{position:absolute;left:1px;top:2px;width:7px;height:7px;border:1px solid rgba(255,255,255,.75);border-radius:50%;opacity:0}.parable-demo-cursor.is-clicking .cursor-click-ring{animation:cursorRing .34s ease-out}
    .demo-ui-action{appearance:none;position:absolute;z-index:24;height:30px;padding:0 10px;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:#11151dcc;color:#f4f5f8;font-size:7px;font-weight:600;display:flex;align-items:center;gap:6px;opacity:.76;transition:opacity .18s ease,transform .20s ease,border-color .18s ease}.demo-ui-action span{color:#9eb3ff}.demo-ui-action.demo-hover{opacity:1;border-color:rgba(139,166,255,.38);transform:translateY(-1px)}
    .demo-adapt-action{right:24.5%;top:18%}.scene-write.demo-step-1 .writing-line:nth-of-type(2){color:#f5f6fa!important;background:linear-gradient(90deg,rgba(90,111,255,.17),rgba(90,111,255,.03));border-radius:4px;box-shadow:inset 2px 0 #718bff;padding-left:7px;margin-left:-7px}.scene-write.demo-clicked .margin-note{border-color:rgba(93,124,255,.42)!important}
    .demo-intel-inspector{position:absolute;z-index:25;right:8.5%;top:24%;width:154px;padding:11px 12px;border:1px solid rgba(122,151,255,.23);border-radius:11px;background:#0b0e15f2;opacity:0;transform:translateY(6px) scale(.97);transition:opacity .18s ease,transform .22s ease}.demo-intel-inspector small{display:block;font-size:5px;letter-spacing:.15em;color:#70788e;margin-bottom:5px}.demo-intel-inspector strong{display:block;font-size:12px;color:#f0f2f7;margin-bottom:5px}.demo-intel-inspector span{display:block;font-size:6px;color:#798092}.demo-intel-inspector i{display:block;height:2px;margin-top:9px;background:linear-gradient(90deg,#617cff 0 92%,#232733 92%)}.scene-understand.demo-clicked .demo-intel-inspector{opacity:1;transform:none}.scene-understand.demo-step-1 .n2{border-color:rgba(119,148,255,.48)!important;transform:scale(1.03)!important}
    .demo-world-chip{position:absolute;z-index:28;left:50%;top:73%;transform:translate(-50%,5px);height:32px;min-width:140px;padding:0 10px;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:#0b0d13f2;display:flex;align-items:center;gap:8px;opacity:0;transition:opacity .18s ease,transform .22s ease}.demo-world-chip span{font-size:5px;color:#757b89;letter-spacing:.12em}.demo-world-chip b{font-size:7px;color:#f2f3f7;margin-left:auto}.demo-world-chip i{font-size:8px;color:#9ab0ff;font-style:normal}.scene-covers.demo-clicked .demo-world-chip{opacity:1;transform:translate(-50%,0)}
    .demo-lens-menu{position:absolute;z-index:35;right:4.5%;top:28%;width:118px;padding:7px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#090b10f5;opacity:0;transform:translateY(5px) scale(.98);transition:opacity .16s ease,transform .20s ease}.demo-lens-menu small{display:block;font-size:5px;letter-spacing:.15em;color:#656b78;padding:3px 5px 6px}.demo-lens-menu button{display:block;width:100%;height:23px;border:0;border-radius:6px;background:transparent;color:#9da3af;font-size:7px;text-align:left;padding:0 7px}.demo-lens-menu button.is-selected{background:#18213e;color:#eaf0ff}.scene-direct.demo-step-1 .demo-lens-menu{opacity:1;transform:none}.scene-direct.demo-clicked .focus-box{transform:scale(.92)!important;border-color:rgba(229,236,255,.78)!important;transition:transform .26s ease}
    .demo-cut-toast{position:absolute;z-index:35;left:49%;bottom:35%;transform:translate(-50%,6px);min-width:116px;height:30px;padding:0 9px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#0c0e13f5;display:flex;align-items:center;gap:8px;opacity:0;transition:opacity .16s ease,transform .20s ease}.demo-cut-toast span{font-size:5px;color:#7d8493}.demo-cut-toast b{font-size:7px;color:#edf0f8}.scene-edit.demo-clicked .demo-cut-toast{opacity:1;transform:translate(-50%,0)}.scene-edit.demo-step-1 .clip-b{filter:brightness(1.18)!important}.scene-edit.demo-clicked .cut-reaction-monitor{border-color:rgba(202,143,178,.32)!important;transform:scale(1.02);transition:transform .20s ease}
    .demo-preview-action{left:50%;bottom:12%;transform:translate(-50%,3px)}.demo-preview-action.demo-hover{transform:translate(-50%,0)}.scene-finish.demo-clicked .finish-mosaic{transform:scale(1.025);transition:transform .30s ease}.scene-finish.demo-clicked .finish-copy{transform:translate(-50%,-50%) scale(1.025)!important;transition:transform .30s ease}
    @keyframes cursorRing{0%{opacity:.9;transform:scale(.35)}100%{opacity:0;transform:scale(2.8)}}
    @media(prefers-reduced-motion:reduce){.parable-demo-cursor{display:none!important}}
  `;
  document.head.appendChild(style);

  let timers=[];
  let visible=true;
  const later=(fn,ms)=>timers.push(setTimeout(()=>{ if(visible) fn(); },ms));
  const clearTimers=()=>{timers.forEach(clearTimeout);timers=[]};
  const clearState=()=>{scenes.forEach(s=>s.classList.remove('demo-step-1','demo-clicked'));stage.querySelectorAll('.demo-hover').forEach(el=>el.classList.remove('demo-hover'))};
  const move=(x,y,d=.42)=>{const r=stage.getBoundingClientRect();cursor.style.setProperty('--cursor-dur',`${d}s`);cursor.style.transform=`translate3d(${Math.round(r.width*x/100)}px,${Math.round(r.height*y/100)}px,0)`;cursor.classList.add('is-visible')};
  const click=(scene)=>{cursor.classList.remove('is-clicking');void cursor.offsetWidth;cursor.classList.add('is-clicking','is-pressing');later(()=>cursor.classList.remove('is-pressing'),85);scene.classList.add('demo-clicked')};
  const hover=(sel,on=true)=>stage.querySelector(sel)?.classList.toggle('demo-hover',on);

  const beats=[
    s=>{move(31,58,.1);later(()=>move(44,52,.38),150);later(()=>s.classList.add('demo-step-1'),500);later(()=>move(69,24,.34),620);later(()=>hover('.demo-adapt-action'),920);later(()=>click(s),1080);later(()=>hover('.demo-adapt-action',false),1450)},
    s=>{move(31,61,.1);later(()=>move(58,30,.42),180);later(()=>s.classList.add('demo-step-1'),560);later(()=>click(s),800);later(()=>move(75,39,.36),1080)},
    s=>{move(33,67,.1);later(()=>move(50,48,.44),180);later(()=>s.classList.add('demo-step-1'),620);later(()=>click(s),850);later(()=>move(58,72,.34),1120)},
    s=>{move(61,66,.1);later(()=>move(79,48,.40),180);later(()=>s.classList.add('demo-step-1'),540);later(()=>move(84,50,.22),720);later(()=>click(s),920);later(()=>move(48,42,.36),1170)},
    s=>{move(28,73,.1);later(()=>move(50,78,.42),180);later(()=>s.classList.add('demo-step-1'),560);later(()=>click(s),790);later(()=>move(66,78,.30),1080)},
    s=>{move(61,70,.1);later(()=>move(50,82,.40),180);later(()=>hover('.demo-preview-action'),560);later(()=>click(s),810);later(()=>move(68,55,.36),1120);later(()=>hover('.demo-preview-action',false),1450)}
  ];

  const run=(scene)=>{clearTimers();clearState();cursor.classList.remove('is-visible','is-clicking','is-pressing');const i=scenes.indexOf(scene);if(i<0||!visible)return;later(()=>beats[i]?.(scene),60)};
  const sceneObserver=new MutationObserver(ms=>{for(const m of ms){const t=m.target;if(t.classList?.contains('film-scene')&&t.classList.contains('is-active')){run(t);break}}});
  scenes.forEach(s=>sceneObserver.observe(s,{attributes:true,attributeFilter:['class']}));

  const visibilityObserver=new IntersectionObserver(([entry])=>{
    visible=!!entry?.isIntersecting;
    if(!visible){clearTimers();cursor.classList.remove('is-visible')}
    else {const active=scenes.find(s=>s.classList.contains('is-active'));if(active)run(active)}
  },{threshold:.08});
  visibilityObserver.observe(film);

  document.addEventListener('visibilitychange',()=>{
    visible=!document.hidden && film.getBoundingClientRect().bottom>0 && film.getBoundingClientRect().top<innerHeight;
    if(!visible){clearTimers();cursor.classList.remove('is-visible')}
  });

  const initial=scenes.find(s=>s.classList.contains('is-active'));
  if(initial) run(initial);
})();