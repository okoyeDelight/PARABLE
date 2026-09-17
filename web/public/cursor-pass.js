(() => {
  const film = document.querySelector('#filmFrame');
  const stage = document.querySelector('#filmStage');
  if (!film || !stage || window.__parableCursorPass) return;
  window.__parableCursorPass = true;

  const scenes = [...stage.querySelectorAll('.film-scene')];
  if (!scenes.length) return;

  const add = (parent, html) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const node = wrap.firstElementChild;
    parent.appendChild(node);
    return node;
  };

  // Scene-specific controls: they are intentionally small and native to the
  // product-film art direction, so the cursor has real things to operate.
  const write = stage.querySelector('.scene-write');
  const understand = stage.querySelector('.scene-understand');
  const covers = stage.querySelector('.scene-covers');
  const direct = stage.querySelector('.scene-direct');
  const edit = stage.querySelector('.scene-edit');
  const finish = stage.querySelector('.scene-finish');

  if (write && !write.querySelector('.demo-adapt-action')) {
    add(write, `<button class="demo-ui-action demo-adapt-action" type="button"><span>✦</span> Adapt scene</button>`);
  }
  if (understand && !understand.querySelector('.demo-intel-inspector')) {
    add(understand, `<div class="demo-intel-inspector"><small>THEME</small><strong>Surrender</strong><span>Story confidence · 92%</span><i></i></div>`);
  }
  if (covers && !covers.querySelector('.demo-world-chip')) {
    add(covers, `<div class="demo-world-chip"><span>THE ALTAR</span><b>Open world</b><i>↗</i></div>`);
  }
  if (direct && !direct.querySelector('.demo-lens-menu')) {
    add(direct, `<div class="demo-lens-menu"><small>LENS</small><button type="button">35 mm</button><button type="button" class="is-selected">50 mm</button><button type="button">85 mm</button></div>`);
  }
  if (edit && !edit.querySelector('.demo-cut-toast')) {
    add(edit, `<div class="demo-cut-toast"><span>07B</span><b>Reaction selected</b></div>`);
  }
  if (finish && !finish.querySelector('.demo-preview-action')) {
    add(finish, `<button class="demo-ui-action demo-preview-action" type="button"><span>▶</span> Preview film</button>`);
  }

  const cursor = document.createElement('div');
  cursor.className = 'parable-demo-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = `
    <svg viewBox="0 0 24 30" focusable="false" aria-hidden="true">
      <path d="M2.2 2.2 2.5 24l5.4-5.2 3.4 8.5 4.2-1.8-3.5-8.2 7.5-.2Z" fill="#fff" stroke="#090a0d" stroke-width="1.25" stroke-linejoin="round"/>
    </svg>
    <span class="cursor-click-ring"></span>`;
  stage.appendChild(cursor);

  const style = document.createElement('style');
  style.id = 'parable-cursor-film-pass';
  style.textContent = `
    .film-stage-contained{position:absolute!important;}
    .parable-demo-cursor{
      position:absolute;left:0;top:0;z-index:90;width:22px;height:28px;pointer-events:none;
      transform:translate3d(-40px,-40px,0);opacity:0;filter:drop-shadow(0 3px 8px rgba(0,0,0,.62));
      transition:transform var(--cursor-dur,.56s) cubic-bezier(.22,.82,.24,1),opacity .18s ease;
      will-change:transform;
    }
    .parable-demo-cursor svg{display:block;width:100%;height:100%;transform-origin:3px 3px;transition:transform .12s ease;}
    .parable-demo-cursor.is-visible{opacity:1;}
    .parable-demo-cursor.is-pressing svg{transform:scale(.86);}
    .cursor-click-ring{position:absolute;left:1px;top:2px;width:8px;height:8px;border:1px solid rgba(255,255,255,.78);border-radius:50%;opacity:0;transform:translate(-50%,-50%) scale(.35);}
    .parable-demo-cursor.is-clicking .cursor-click-ring{animation:parableCursorRing .42s ease-out both;}

    .demo-ui-action{
      appearance:none;border:1px solid rgba(255,255,255,.12);color:rgba(248,249,252,.92);
      background:rgba(16,19,27,.88);box-shadow:0 10px 30px rgba(0,0,0,.34),inset 0 1px rgba(255,255,255,.04);
      backdrop-filter:blur(14px);border-radius:10px;height:31px;padding:0 11px;font-size:7px;font-weight:600;
      display:flex;align-items:center;gap:6px;letter-spacing:.01em;position:absolute;z-index:22;
      opacity:.72;transform:translateY(2px);transition:opacity .22s ease,transform .28s cubic-bezier(.16,1,.3,1),border-color .22s ease,box-shadow .22s ease;
    }
    .demo-ui-action span{font-size:8px;color:#9eb3ff;}
    .demo-ui-action.demo-hover{opacity:1;transform:translateY(0);border-color:rgba(139,166,255,.38);box-shadow:0 12px 36px rgba(0,0,0,.42),0 0 20px rgba(78,102,255,.12),inset 0 1px rgba(255,255,255,.06);}
    .demo-adapt-action{right:24.5%;top:18%;}
    .scene-write.demo-step-1 .writing-line:nth-of-type(2){
      color:#f5f6fa!important;background:linear-gradient(90deg,rgba(90,111,255,.18),rgba(90,111,255,.04));
      border-radius:4px;box-shadow:inset 2px 0 #718bff;padding-left:7px;margin-left:-7px;transition:all .22s ease;
    }
    .scene-write.demo-clicked .write-margin{filter:brightness(1.17);transition:filter .28s ease;}
    .scene-write.demo-clicked .margin-note{border-color:rgba(93,124,255,.46)!important;box-shadow:0 0 14px rgba(72,101,255,.10)!important;}

    .demo-intel-inspector{
      position:absolute;z-index:25;right:8.5%;top:24%;width:154px;padding:12px 13px 11px;
      border:1px solid rgba(122,151,255,.24);border-radius:12px;background:rgba(11,14,21,.92);backdrop-filter:blur(14px);
      box-shadow:0 16px 42px rgba(0,0,0,.45),0 0 24px rgba(71,94,255,.09);opacity:0;transform:translateY(7px) scale(.96);
      transition:opacity .24s ease,transform .32s cubic-bezier(.16,1,.3,1);
    }
    .demo-intel-inspector small{display:block;font-size:5px;letter-spacing:.15em;color:#70788e;margin-bottom:5px}.demo-intel-inspector strong{display:block;font-size:12px;font-weight:600;color:#f0f2f7;margin-bottom:5px}.demo-intel-inspector span{display:block;font-size:6px;color:#798092}.demo-intel-inspector i{display:block;height:2px;margin-top:10px;border-radius:2px;background:linear-gradient(90deg,#617cff 0 92%,#232733 92% 100%);box-shadow:0 0 8px rgba(96,124,255,.32)}
    .scene-understand.demo-clicked .demo-intel-inspector{opacity:1;transform:none;}
    .scene-understand.demo-step-1 .n2{border-color:rgba(119,148,255,.52)!important;box-shadow:0 16px 40px rgba(0,0,0,.38),0 0 20px rgba(80,104,255,.13)!important;transform:scale(1.035)!important;}

    .demo-world-chip{position:absolute;z-index:28;left:50%;top:73%;transform:translate(-50%,6px);height:34px;min-width:144px;padding:0 11px;border:1px solid rgba(255,255,255,.13);border-radius:10px;background:rgba(11,13,19,.91);box-shadow:0 14px 35px rgba(0,0,0,.48),0 0 24px rgba(74,95,255,.10);display:flex;align-items:center;gap:8px;opacity:0;transition:opacity .24s ease,transform .32s cubic-bezier(.16,1,.3,1);}
    .demo-world-chip span{font-size:5px;color:#757b89;letter-spacing:.12em}.demo-world-chip b{font-size:7px;color:#f2f3f7;margin-left:auto}.demo-world-chip i{font-size:8px;color:#9ab0ff;font-style:normal}.scene-covers.demo-clicked .demo-world-chip{opacity:1;transform:translate(-50%,0)}
    .scene-covers.demo-step-1 .cover-center{filter:saturate(1.05) brightness(1.08) contrast(1.03)!important;box-shadow:0 44px 94px rgba(0,0,0,.62),0 0 0 1px rgba(185,207,255,.20),0 0 54px rgba(81,107,255,.24)!important;}

    .demo-lens-menu{position:absolute;z-index:35;right:4.5%;top:28%;width:120px;padding:8px;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:rgba(9,11,16,.96);backdrop-filter:blur(16px);box-shadow:0 18px 42px rgba(0,0,0,.55),0 0 20px rgba(72,96,255,.08);opacity:0;transform:translateY(6px) scale(.97);transition:opacity .2s ease,transform .28s cubic-bezier(.16,1,.3,1);}
    .demo-lens-menu small{display:block;font-size:5px;letter-spacing:.15em;color:#656b78;padding:3px 5px 7px}.demo-lens-menu button{display:block;width:100%;height:24px;border:0;border-radius:7px;background:transparent;color:#9da3af;font-size:7px;text-align:left;padding:0 7px}.demo-lens-menu button.is-selected{background:#18213e;color:#eaf0ff;box-shadow:inset 0 0 0 1px rgba(97,126,255,.22)}
    .scene-direct.demo-step-1 .demo-lens-menu{opacity:1;transform:none}.scene-direct.demo-clicked .focus-box{transform:scale(.92)!important;border-color:rgba(229,236,255,.78)!important;transition:transform .4s cubic-bezier(.16,1,.3,1),border-color .3s ease}.scene-direct.demo-clicked .director-preview{filter:contrast(1.04) saturate(.94);transition:filter .3s ease}

    .demo-cut-toast{position:absolute;z-index:35;left:49%;bottom:35%;transform:translate(-50%,8px);min-width:118px;height:31px;padding:0 10px;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(12,14,19,.94);box-shadow:0 14px 34px rgba(0,0,0,.46);display:flex;align-items:center;gap:8px;opacity:0;transition:opacity .2s ease,transform .28s cubic-bezier(.16,1,.3,1)}
    .demo-cut-toast span{font-size:5px;color:#7d8493;letter-spacing:.12em}.demo-cut-toast b{font-size:7px;color:#edf0f8}.scene-edit.demo-clicked .demo-cut-toast{opacity:1;transform:translate(-50%,0)}
    .scene-edit.demo-step-1 .clip-b{filter:brightness(1.22)!important;box-shadow:inset 0 0 22px rgba(137,90,165,.18),0 0 12px rgba(135,87,164,.12)!important}.scene-edit.demo-clicked .cut-reaction-monitor{border-color:rgba(202,143,178,.35)!important;transform:scale(1.025);transition:transform .28s cubic-bezier(.16,1,.3,1),border-color .24s ease}

    .demo-preview-action{left:50%;bottom:12%;transform:translate(-50%,4px);opacity:.78}.demo-preview-action.demo-hover{transform:translate(-50%,0)}
    .scene-finish.demo-clicked .finish-mosaic{transform:scale(1.035);filter:brightness(.88);transition:transform .48s cubic-bezier(.16,1,.3,1),filter .35s ease}.scene-finish.demo-clicked .finish-copy{transform:translate(-50%,-50%) scale(1.035)!important;transition:transform .46s cubic-bezier(.16,1,.3,1)}

    .film-scene.demo-impact::after{content:'';position:absolute;inset:0;z-index:70;pointer-events:none;background:rgba(255,255,255,.08);opacity:0;animation:parableEditFlash .18s ease-out both;}
    @keyframes parableCursorRing{0%{opacity:.92;transform:translate(-50%,-50%) scale(.25)}100%{opacity:0;transform:translate(-50%,-50%) scale(3.2)}}
    @keyframes parableEditFlash{0%{opacity:.18}100%{opacity:0}}

    @media(max-width:720px){
      .demo-ui-action,.demo-intel-inspector,.demo-world-chip,.demo-lens-menu,.demo-cut-toast{font-size:7px}
    }
    @media(prefers-reduced-motion:reduce){.parable-demo-cursor{display:none!important}.film-scene.demo-impact::after{display:none!important}}
  `;
  document.head.appendChild(style);

  let timers = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  const clearSceneState = () => {
    scenes.forEach(s => s.classList.remove('demo-step-1','demo-step-2','demo-clicked','demo-impact'));
    stage.querySelectorAll('.demo-hover').forEach(el => el.classList.remove('demo-hover'));
  };

  const moveCursor = (x, y, dur = .52) => {
    const r = stage.getBoundingClientRect();
    cursor.style.setProperty('--cursor-dur', `${dur}s`);
    cursor.style.transform = `translate3d(${Math.round(r.width * x / 100)}px,${Math.round(r.height * y / 100)}px,0)`;
    cursor.classList.add('is-visible');
  };

  const hover = (selector, on = true) => {
    const el = stage.querySelector(selector);
    if (el) el.classList.toggle('demo-hover', on);
  };

  const click = (scene) => {
    cursor.classList.remove('is-clicking');
    void cursor.offsetWidth;
    cursor.classList.add('is-clicking','is-pressing');
    scene?.classList.add('demo-impact');
    later(() => cursor.classList.remove('is-pressing'), 100);
    later(() => scene?.classList.remove('demo-impact'), 220);
  };

  const choreographies = [
    (scene) => {
      moveCursor(31,58,.12);
      later(()=>moveCursor(44,52,.46),180);
      later(()=>scene.classList.add('demo-step-1'),610);
      later(()=>moveCursor(69,24,.42),700);
      later(()=>hover('.demo-adapt-action',true),1040);
      later(()=>{click(scene);scene.classList.add('demo-clicked');},1190);
      later(()=>hover('.demo-adapt-action',false),1600);
    },
    (scene) => {
      moveCursor(31,61,.12);
      later(()=>moveCursor(58,30,.54),220);
      later(()=>scene.classList.add('demo-step-1'),690);
      later(()=>{click(scene);scene.classList.add('demo-clicked');},900);
      later(()=>moveCursor(75,39,.45),1180);
    },
    (scene) => {
      moveCursor(33,67,.12);
      later(()=>moveCursor(50,48,.58),230);
      later(()=>scene.classList.add('demo-step-1'),760);
      later(()=>{click(scene);scene.classList.add('demo-clicked');},980);
      later(()=>moveCursor(58,72,.42),1260);
    },
    (scene) => {
      moveCursor(61,66,.12);
      later(()=>moveCursor(79,48,.50),220);
      later(()=>scene.classList.add('demo-step-1'),660);
      later(()=>moveCursor(84,50,.26),830);
      later(()=>{click(scene);scene.classList.add('demo-clicked');},1030);
      later(()=>moveCursor(48,42,.45),1290);
    },
    (scene) => {
      moveCursor(28,73,.12);
      later(()=>moveCursor(50,78,.54),210);
      later(()=>scene.classList.add('demo-step-1'),700);
      later(()=>{click(scene);scene.classList.add('demo-clicked');},900);
      later(()=>moveCursor(66,78,.38),1150);
      later(()=>click(scene),1510);
    },
    (scene) => {
      moveCursor(61,70,.12);
      later(()=>moveCursor(50,82,.50),220);
      later(()=>hover('.demo-preview-action',true),680);
      later(()=>{click(scene);scene.classList.add('demo-clicked');},930);
      later(()=>moveCursor(68,55,.48),1270);
      later(()=>hover('.demo-preview-action',false),1600);
    }
  ];

  const runForScene = (scene) => {
    clearTimers();
    clearSceneState();
    cursor.classList.remove('is-visible','is-clicking','is-pressing');
    const idx = scenes.indexOf(scene);
    if (idx < 0) return;
    later(() => {
      cursor.classList.add('is-visible');
      choreographies[idx]?.(scene);
    }, 80);
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
      const target = m.target;
      if (target.classList?.contains('film-scene') && target.classList.contains('is-active')) {
        runForScene(target);
        break;
      }
    }
  });
  scenes.forEach(scene => observer.observe(scene,{attributes:true,attributeFilter:['class']}));

  const initial = scenes.find(s => s.classList.contains('is-active'));
  if (initial) runForScene(initial);

  document.querySelector('#filmPlay')?.addEventListener('click',()=>{
    later(()=>{
      if (film.classList.contains('paused')) cursor.classList.remove('is-visible');
      else {
        const active = scenes.find(s => s.classList.contains('is-active'));
        if (active) runForScene(active);
      }
    },20);
  });
})();
