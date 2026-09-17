(() => {
  const stage = document.querySelector('#filmStage');
  if (!stage) return;

  const ARTBOARD_W = 1000;
  const ARTBOARD_H = 475;

  stage.classList.add('film-stage-contained');

  const style = document.createElement('style');
  style.id = 'parable-film-contain-fix';
  style.textContent = `
    .film-stage-contained{--film-fit:1;overflow:hidden!important;}

    @media(max-width:720px){
      .film-stage-contained .film-scene{
        inset:auto!important;
        left:50%!important;
        top:50%!important;
        width:${ARTBOARD_W}px!important;
        height:${ARTBOARD_H}px!important;
        transform-origin:50% 50%!important;
        transform:translate(-50%,-50%) scale(var(--film-fit))!important;
      }
      .film-stage-contained .film-scene.is-active,
      .film-stage-contained .film-scene.is-before,
      .film-stage-contained .film-scene.is-after{
        transform:translate(-50%,-50%) scale(var(--film-fit))!important;
      }

      .film-stage-contained .write-shell{
        inset:5.8% 5.2%!important;
        grid-template-columns:58px minmax(0,1fr) 205px!important;
      }
      .film-stage-contained .write-sidebar{padding-top:24px!important;gap:19px!important;}
      .film-stage-contained .write-sidebar span{width:17px!important;height:17px!important;}
      .film-stage-contained .write-document{padding:44px 8% 38px!important;}
      .film-stage-contained .write-document h3{font-size:25px!important;}
      .film-stage-contained .writing-line{font-size:13px!important;}
      .film-stage-contained .writing-line.lead{font-size:16px!important;}
      .film-stage-contained .write-margin{display:flex!important;padding:43px 18px!important;}
      .film-stage-contained .scene-float-label{
        bottom:5.3%!important;
        font-size:9px!important;
        max-width:none!important;
        white-space:nowrap!important;
      }

      .film-stage-contained .intelligence-orbit{
        left:8%!important;top:9%!important;bottom:9%!important;width:58%!important;
        transform:translate(calc(var(--pointer-x)*7px),calc(var(--pointer-y)*7px))!important;
      }
      .film-stage-contained .orbit-c{width:480px!important;height:480px!important;}
      .film-stage-contained .intel-node{min-width:124px!important;padding:11px 12px!important;}
      .film-stage-contained .intelligence-copy{
        right:6.5%!important;top:50%!important;bottom:auto!important;width:31%!important;
        transform:translateY(-50%)!important;text-align:left!important;
      }
      .film-stage-contained .intelligence-copy h3{font-size:clamp(25px,3vw,44px)!important;}
      .film-stage-contained .intelligence-copy p{display:block!important;}

      .film-stage-contained .director-layout{
        inset:6%!important;
        grid-template-columns:minmax(0,1fr) 270px!important;
      }
      .film-stage-contained .director-controls{
        position:relative!important;
        left:auto!important;right:auto!important;bottom:auto!important;
        display:block!important;
        padding:25px 20px!important;
        border:0!important;border-left:1px solid rgba(255,255,255,.07)!important;
        border-radius:0!important;
        background:#0d0f14!important;
        backdrop-filter:none!important;
      }
      .film-stage-contained .director-controls>p{display:block!important;font-size:7px!important;margin:0 0 18px!important;}
      .film-stage-contained .director-controls>div{padding:11px 0!important;border-bottom:1px solid rgba(255,255,255,.06)!important;}
      .film-stage-contained .director-controls span{font-size:6px!important;}
      .film-stage-contained .director-controls b{font-size:10px!important;}
      .film-stage-contained .director-controls blockquote{display:block!important;margin:22px 0 0!important;}
      .film-stage-contained .scene-direct .actor-silhouette{
        width:220px!important;height:330px!important;left:38%!important;bottom:-20px!important;
      }
      .film-stage-contained .scene-direct .focus-box{
        left:37%!important;top:18%!important;width:205px!important;height:225px!important;
      }
      .film-stage-contained .scene-direct .shot-caption{left:22px!important;bottom:20px!important;}

      .film-stage-contained .edit-preview{
        left:5%!important;right:5%!important;top:7%!important;height:51%!important;
        grid-template-columns:1.15fr .8fr .75fr!important;
      }
      .film-stage-contained .pf-c{display:block!important;}
      .film-stage-contained .edit-timeline{left:5%!important;right:5%!important;bottom:7%!important;height:27%!important;}
      .film-stage-contained .edit-copy{left:7%!important;top:8%!important;}

      .film-stage-contained .fc-a{width:260px!important;height:155px!important;left:8%!important;top:18%!important;}
      .film-stage-contained .fc-b{width:250px!important;height:165px!important;right:8%!important;top:15%!important;}
      .film-stage-contained .fc-c{width:290px!important;height:180px!important;left:12%!important;bottom:12%!important;}
      .film-stage-contained .fc-d{width:260px!important;height:165px!important;right:10%!important;bottom:11%!important;}
      .film-stage-contained .fc-e{width:235px!important;height:320px!important;}
      .film-stage-contained .finish-copy{width:min(520px,70%)!important;max-width:none!important;}
      .film-stage-contained .finish-copy h3{font-size:clamp(34px,5vw,70px)!important;}
    }
  `;
  document.head.appendChild(style);

  /*
    Scene 03 final compositor.
    This deliberately resets every legacy cover transform/entrance rule and
    places the three posters on one fixed cinematic plane. The mobile viewport
    scales the entire artboard, so this composition is identical on phone and
    desktop instead of being re-laid-out by breakpoint CSS.
  */
  const coverStyle = document.createElement('style');
  coverStyle.id = 'parable-premium-cover-stage';
  coverStyle.textContent = `
    .film-stage-contained .scene-covers{
      background:
        radial-gradient(ellipse 50% 60% at 50% 48%,rgba(58,76,255,.18),transparent 61%),
        radial-gradient(ellipse 34% 42% at 63% 45%,rgba(117,67,220,.10),transparent 72%),
        linear-gradient(180deg,#08090d 0%,#050609 100%)!important;
    }

    .film-stage-contained .scene-covers .cover-space{
      position:absolute!important;
      inset:0!important;
      transform:none!important;
      perspective:1600px!important;
      perspective-origin:50% 47%!important;
      transform-style:preserve-3d!important;
      isolation:isolate!important;
    }

    .film-stage-contained .scene-covers .cover-space::before{
      content:'';
      position:absolute;
      left:14%;right:14%;top:16%;bottom:10%;
      border-radius:50%;
      background:
        radial-gradient(ellipse at 50% 48%,rgba(85,101,255,.20),rgba(72,58,171,.08) 38%,transparent 70%);
      filter:blur(30px);
      opacity:.92;
      pointer-events:none;
      z-index:0;
    }

    .film-stage-contained .scene-covers .cover-space::after{
      content:'';
      position:absolute;
      left:13%;right:13%;bottom:5%;height:46px;
      border-radius:50%;
      background:radial-gradient(ellipse,rgba(24,28,50,.60),rgba(5,6,10,0) 73%);
      filter:blur(10px);
      opacity:.82;
      pointer-events:none;
      z-index:0;
    }

    .film-stage-contained .scene-covers .cover-glow{
      opacity:.17!important;
      filter:blur(76px)!important;
    }

    /* Hard reset: legacy .hero-cover opacity/coverArrive can no longer affect this shot. */
    .film-stage-contained .scene-covers .hero-cover,
    .film-stage-contained .scene-covers.is-active .hero-cover{
      opacity:1!important;
      animation:none!important;
      margin:0!important;
      padding:0!important;
      backface-visibility:hidden!important;
      transform-style:preserve-3d!important;
      transform-origin:50% 50%!important;
      will-change:translate,filter!important;
      transition:none!important;
    }

    /* One horizontal cinematic plane — no stacking. */
    .film-stage-contained .scene-covers .cover-left{
      left:25%!important;
      top:50%!important;
      width:210px!important;
      height:298px!important;
      z-index:3!important;
      transform:translate(-50%,-50%) translateZ(-36px) rotateY(8deg) rotateZ(-2deg)!important;
      translate:0 2px;
      filter:saturate(.82) brightness(.73) contrast(.98)!important;
      box-shadow:0 28px 62px rgba(0,0,0,.48)!important;
      animation:parableSideLeftDrift 5.8s ease-in-out infinite alternate!important;
    }

    .film-stage-contained .scene-covers .cover-center{
      left:50%!important;
      top:49%!important;
      width:270px!important;
      height:382px!important;
      z-index:7!important;
      transform:translate(-50%,-50%) translateZ(92px)!important;
      translate:0 -2px;
      filter:saturate(.98) brightness(1.02) contrast(1.03)!important;
      box-shadow:
        0 44px 94px rgba(0,0,0,.60),
        0 0 0 1px rgba(175,199,255,.13),
        0 0 40px rgba(74,98,255,.16)!important;
      animation:parableHeroDrift 5.1s ease-in-out infinite alternate!important;
    }

    .film-stage-contained .scene-covers .cover-right{
      left:75%!important;
      top:50%!important;
      width:210px!important;
      height:298px!important;
      z-index:3!important;
      transform:translate(-50%,-50%) translateZ(-36px) rotateY(-8deg) rotateZ(2deg)!important;
      translate:0 2px;
      filter:saturate(.82) brightness(.73) contrast(.98)!important;
      box-shadow:0 28px 62px rgba(0,0,0,.48)!important;
      animation:parableSideRightDrift 5.5s ease-in-out infinite alternate!important;
    }

    /* Active focus hierarchy: only the hero poster gets the bright perimeter comet. */
    .film-stage-contained .scene-covers.is-active .cover-left::before,
    .film-stage-contained .scene-covers.is-active .cover-right::before{
      opacity:.08!important;
      animation:parableFramerTrace 5.2s linear infinite!important;
      filter:drop-shadow(0 0 2px rgba(154,190,255,.22)) drop-shadow(0 0 7px rgba(78,99,255,.08))!important;
    }
    .film-stage-contained .scene-covers.is-active .cover-center::before{
      opacity:1!important;
      animation:parableFramerTrace 3.65s linear infinite!important;
      filter:drop-shadow(0 0 2px rgba(224,241,255,.98)) drop-shadow(0 0 8px rgba(119,193,255,.72)) drop-shadow(0 0 20px rgba(78,98,255,.28))!important;
    }

    .film-stage-contained .scene-covers .hero-cover::after{opacity:.13!important;}
    .film-stage-contained .scene-covers .cover-center::after{opacity:.32!important;}

    .film-stage-contained .scene-covers .cover-copy{
      padding:20px 18px 18px!important;
      background:linear-gradient(180deg,transparent 0%,rgba(3,4,7,.10) 18%,rgba(3,4,7,.80) 59%,rgba(3,4,7,.97) 100%)!important;
    }
    .film-stage-contained .scene-covers .cover-copy small{
      margin-bottom:44px!important;
      opacity:.72!important;
    }
    .film-stage-contained .scene-covers .cover-center .cover-copy b{
      font-size:30px!important;
      line-height:.91!important;
    }
    .film-stage-contained .scene-covers .cover-left .cover-copy b,
    .film-stage-contained .scene-covers .cover-right .cover-copy b{
      font-size:22px!important;
      line-height:.92!important;
    }

    .film-stage-contained .scene-covers .scene-float-label{
      bottom:3.6%!important;
      z-index:12!important;
      color:rgba(205,211,226,.56)!important;
    }

    .film-stage-contained .scene-covers::after{
      content:'';
      position:absolute;
      width:35%;height:150%;
      left:-22%;top:-25%;
      background:linear-gradient(96deg,transparent 25%,rgba(154,189,255,.02) 42%,rgba(255,255,255,.055) 49%,rgba(122,162,255,.02) 56%,transparent 72%);
      filter:blur(5px);
      transform:rotate(9deg) translateX(-35%);
      mix-blend-mode:screen;
      pointer-events:none;
      z-index:9;
    }
    .film-stage-contained .scene-covers.is-active::after{
      animation:parableCoverLensPass 5.1s cubic-bezier(.22,.61,.36,1) infinite;
    }

    @keyframes parableHeroDrift{
      from{translate:0 -2px;}
      to{translate:0 4px;}
    }
    @keyframes parableSideLeftDrift{
      from{translate:0 2px;}
      to{translate:-3px -2px;}
    }
    @keyframes parableSideRightDrift{
      from{translate:0 2px;}
      to{translate:3px -2px;}
    }
    @keyframes parableCoverLensPass{
      0%,56%{transform:rotate(9deg) translateX(-45%);opacity:0;}
      69%{opacity:.68;}
      100%{transform:rotate(9deg) translateX(390%);opacity:0;}
    }

    @media(prefers-reduced-motion:reduce){
      .film-stage-contained .scene-covers .hero-cover,
      .film-stage-contained .scene-covers::after{animation:none!important;}
    }
  `;
  document.head.appendChild(coverStyle);

  function fitFilmArtboard(){
    if (window.innerWidth > 720) {
      stage.style.removeProperty('--film-fit');
      return;
    }
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const safeX = 8;
    const safeY = 8;
    const fit = Math.min(
      Math.max(0.01, (r.width - safeX * 2) / ARTBOARD_W),
      Math.max(0.01, (r.height - safeY * 2) / ARTBOARD_H)
    );
    stage.style.setProperty('--film-fit', fit.toFixed(4));
  }

  const ro = new ResizeObserver(fitFilmArtboard);
  ro.observe(stage);
  window.addEventListener('orientationchange', fitFilmArtboard, {passive:true});
  fitFilmArtboard();

  window.ParableFilmFit = {
    refresh: fitFilmArtboard,
    destroy(){ ro.disconnect(); window.removeEventListener('orientationchange', fitFilmArtboard); }
  };
})();