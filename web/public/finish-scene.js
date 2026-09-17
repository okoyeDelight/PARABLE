(() => {
  const scene = document.querySelector('.scene-finish');
  const mosaic = scene?.querySelector('.finish-mosaic');
  const copy = scene?.querySelector('.finish-copy');
  if (!scene || !mosaic || !copy || scene.dataset.premiumFinish === '1') return;
  scene.dataset.premiumFinish = '1';

  const cloneVisual = (selector, className) => {
    const source = document.querySelector(selector);
    if (!source) return null;
    const clone = source.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.className = className;
    clone.setAttribute('aria-hidden', 'true');
    return clone;
  };

  mosaic.innerHTML = `
    <div class="final-frame final-frame-manuscript"></div>
    <div class="final-frame final-frame-director"></div>
    <div class="final-frame final-frame-before"></div>
    <div class="final-frame final-frame-watchman"></div>
    <div class="final-frame final-frame-main"></div>
    <div class="final-atmosphere" aria-hidden="true"></div>`;

  const manuscript = cloneVisual('.scene-write .write-document', 'final-clone final-manuscript-clone');
  const director = cloneVisual('.scene-direct .director-preview', 'final-clone final-director-clone');
  const before = cloneVisual('.scene-covers .cover-before .cover-art', 'final-clone final-cover-clone');
  const watchman = cloneVisual('.scene-covers .cover-watchman .cover-art', 'final-clone final-cover-clone');
  const main = cloneVisual('.scene-edit .cut-shot-altar', 'final-clone final-main-clone');

  const slots = [
    ['.final-frame-manuscript', manuscript],
    ['.final-frame-director', director],
    ['.final-frame-before', before],
    ['.final-frame-watchman', watchman],
    ['.final-frame-main', main]
  ];
  slots.forEach(([selector, node]) => {
    if (node) scene.querySelector(selector)?.appendChild(node);
  });

  copy.innerHTML = `
    <span class="mini-mark finish-mark"></span>
    <p class="final-kicker">PARABLE · STORY → SCREEN</p>
    <h3>Stories made visible.</h3>
    <p class="final-subline">From the first line to the final frame.</p>`;

  const style = document.createElement('style');
  style.id = 'parable-premium-finish-scene';
  style.textContent = `
    .film-stage-contained .scene-finish{
      overflow:hidden!important;
      background:
        radial-gradient(ellipse 52% 50% at 50% 46%,rgba(62,77,178,.17),transparent 68%),
        radial-gradient(ellipse 30% 35% at 70% 42%,rgba(118,68,198,.08),transparent 72%),
        linear-gradient(180deg,#08090d 0%,#050609 100%)!important;
    }

    .film-stage-contained .scene-finish .finish-mosaic{
      position:absolute!important;inset:0!important;perspective:1400px!important;
      transform-style:preserve-3d!important;overflow:hidden!important;
    }

    .film-stage-contained .scene-finish .final-frame{
      position:absolute!important;overflow:hidden!important;border-radius:15px!important;
      border:1px solid rgba(255,255,255,.095)!important;background:#08090c!important;
      box-shadow:0 24px 64px rgba(0,0,0,.50)!important;opacity:0;
      transform-origin:50% 50%;backface-visibility:hidden;
    }

    .film-stage-contained .scene-finish .final-frame-main{
      left:50%!important;top:49%!important;width:44%!important;height:58%!important;
      transform:translate(-50%,-50%) translateZ(76px) scale(.94)!important;z-index:6!important;
      border-color:rgba(124,155,255,.22)!important;
      box-shadow:0 34px 88px rgba(0,0,0,.62),0 0 34px rgba(70,95,255,.12)!important;
    }
    .film-stage-contained .scene-finish .final-frame-director{
      left:7.5%!important;top:16%!important;width:27%!important;height:35%!important;
      transform:rotateY(10deg) rotateZ(-2deg) translateZ(-28px)!important;z-index:3!important;
    }
    .film-stage-contained .scene-finish .final-frame-before{
      right:8%!important;top:13%!important;width:20%!important;height:39%!important;
      transform:rotateY(-10deg) rotateZ(2deg) translateZ(-34px)!important;z-index:2!important;
    }
    .film-stage-contained .scene-finish .final-frame-watchman{
      right:9%!important;bottom:9%!important;width:24%!important;height:31%!important;
      transform:rotateY(-9deg) rotateZ(-2deg) translateZ(-40px)!important;z-index:2!important;
    }
    .film-stage-contained .scene-finish .final-frame-manuscript{
      left:9%!important;bottom:9%!important;width:24%!important;height:31%!important;
      transform:rotateY(8deg) rotateZ(2deg) translateZ(-38px)!important;z-index:2!important;
    }

    .film-stage-contained .scene-finish .final-clone{
      position:absolute!important;inset:0!important;width:100%!important;height:100%!important;
      transform:none!important;margin:0!important;max-width:none!important;max-height:none!important;
    }
    .film-stage-contained .scene-finish .final-main-clone{transform:scale(1.035)!important;transform-origin:52% 50%!important;}
    .film-stage-contained .scene-finish .final-director-clone{border:0!important;border-radius:0!important;}
    .film-stage-contained .scene-finish .final-manuscript-clone{padding:8% 9%!important;background:#0d1016!important;overflow:hidden!important;}
    .film-stage-contained .scene-finish .final-manuscript-clone .micro-label{font-size:5px!important;margin-bottom:9px!important;}
    .film-stage-contained .scene-finish .final-manuscript-clone h3{font-size:13px!important;margin:0 0 9px!important;}
    .film-stage-contained .scene-finish .final-manuscript-clone .writing-line{font-size:6px!important;line-height:1.45!important;margin:0 0 5px!important;opacity:.66!important;transform:none!important;}
    .film-stage-contained .scene-finish .final-manuscript-clone .writing-line.lead{font-size:7px!important;opacity:.92!important;}
    .film-stage-contained .scene-finish .final-manuscript-clone .writing-caret{display:none!important;}

    .film-stage-contained .scene-finish .final-cover-clone{border-radius:0!important;}
    .film-stage-contained .scene-finish .final-director-clone .focus-box{opacity:.42!important;}
    .film-stage-contained .scene-finish .final-director-clone .shot-caption{transform:scale(.78);transform-origin:left bottom;}

    .film-stage-contained .scene-finish .final-atmosphere{
      position:absolute;inset:0;z-index:7;pointer-events:none;
      background:
        radial-gradient(ellipse 38% 44% at 50% 50%,transparent 10%,rgba(4,5,8,.10) 64%,rgba(4,5,8,.48) 100%),
        linear-gradient(180deg,rgba(7,8,11,.06),rgba(7,8,11,.22));
    }
    .film-stage-contained .scene-finish .final-atmosphere::before{
      content:'';position:absolute;width:42%;height:160%;left:-24%;top:-30%;
      background:linear-gradient(96deg,transparent 30%,rgba(255,255,255,.035) 48%,rgba(125,166,255,.025) 54%,transparent 72%);
      transform:rotate(8deg);filter:blur(5px);mix-blend-mode:screen;
    }

    .film-stage-contained .scene-finish .finish-copy{
      z-index:12!important;left:50%!important;top:50%!important;width:62%!important;
      transform:translate(-50%,-50%)!important;text-align:center!important;
      text-shadow:0 8px 28px rgba(0,0,0,.72)!important;pointer-events:none;
    }
    .film-stage-contained .scene-finish .finish-mark{width:29px!important;height:29px!important;border-radius:8px!important;margin:0 auto 11px!important;opacity:.92;}
    .film-stage-contained .scene-finish .final-kicker{
      margin:0 0 10px!important;font-size:6px!important;letter-spacing:.18em!important;
      color:rgba(211,217,233,.58)!important;
    }
    .film-stage-contained .scene-finish .finish-copy h3{
      margin:0!important;font-size:clamp(38px,5.3vw,72px)!important;line-height:.90!important;
      letter-spacing:-.06em!important;color:#fff!important;text-wrap:balance;
    }
    .film-stage-contained .scene-finish .final-subline{
      margin:13px 0 0!important;font-size:9px!important;color:rgba(221,224,233,.72)!important;
    }

    .scene-finish.is-active .final-frame-main{animation:parableFinalMainIn 1.45s cubic-bezier(.16,1,.3,1) both;}
    .scene-finish.is-active .final-frame-director{animation:parableFinalSideIn .78s .06s cubic-bezier(.16,1,.3,1) both;}
    .scene-finish.is-active .final-frame-before{animation:parableFinalSideIn .78s .14s cubic-bezier(.16,1,.3,1) both;}
    .scene-finish.is-active .final-frame-watchman{animation:parableFinalSideIn .78s .21s cubic-bezier(.16,1,.3,1) both;}
    .scene-finish.is-active .final-frame-manuscript{animation:parableFinalSideIn .78s .28s cubic-bezier(.16,1,.3,1) both;}
    .scene-finish.is-active .finish-copy{animation:parableFinalCopyIn .8s .48s cubic-bezier(.16,1,.3,1) both;}
    .scene-finish.is-active .final-main-clone{animation:parableFinalCamera 2s ease-out both;}
    .scene-finish.is-active .final-atmosphere::before{animation:parableFinalLightPass 2s ease-out both;}

    @keyframes parableFinalMainIn{
      0%{opacity:0;translate:0 16px;filter:blur(8px);}
      48%{opacity:.74;filter:blur(0);}
      100%{opacity:.92;translate:0 0;filter:blur(0);}
    }
    @keyframes parableFinalSideIn{
      0%{opacity:0;scale:.93;filter:blur(7px);}
      100%{opacity:.48;scale:1;filter:blur(0);}
    }
    @keyframes parableFinalCopyIn{
      0%{opacity:0;translate:0 12px;filter:blur(6px);}
      100%{opacity:1;translate:0 0;filter:blur(0);}
    }
    @keyframes parableFinalCamera{from{transform:scale(1.015)!important;}to{transform:scale(1.075)!important;}}
    @keyframes parableFinalLightPass{from{transform:rotate(8deg) translateX(-18%);opacity:0;}45%{opacity:.75;}to{transform:rotate(8deg) translateX(320%);opacity:0;}}

    @media(prefers-reduced-motion:reduce){
      .scene-finish .final-frame,.scene-finish .finish-copy,.scene-finish .final-main-clone,.scene-finish .final-atmosphere::before{animation:none!important;opacity:1!important;filter:none!important;}
      .scene-finish .final-frame:not(.final-frame-main){opacity:.46!important;}
    }
  `;
  document.head.appendChild(style);
})();