(() => {
  const stage = document.querySelector('#filmStage');
  if (!stage) return;

  /*
    The hero scenes were authored against the wide inner film stage, not the
    outer card. Keep that design space fixed and scale the WHOLE composition
    like object-fit: contain. This prevents mobile media-query reflow from
    changing the composition and then clipping it a second time.
  */
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

      /* Restore the original cinematic composition INSIDE the logical artboard.
         Mobile should scale the scene, not redesign/crop the scene. */
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
      .film-stage-contained .write-margin{
        display:flex!important;
        padding:43px 18px!important;
      }
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

      .film-stage-contained .hero-cover{width:190px!important;height:270px!important;padding:0!important;border-radius:17px!important;}

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
    Scene 03 premium stage.
    The covers are treated like objects on a photographed set, not cards in a
    carousel: shallow arc, one clear hero, restrained side depth, one moving
    edge light, and a slow camera drift across the group.
  */
  const coverStyle = document.createElement('style');
  coverStyle.id = 'parable-premium-cover-stage';
  coverStyle.textContent = `
    .film-stage-contained .scene-covers{
      background:
        radial-gradient(ellipse 46% 46% at 50% 50%,rgba(72,83,255,.15),transparent 64%),
        radial-gradient(ellipse 32% 36% at 63% 48%,rgba(111,70,221,.09),transparent 72%),
        linear-gradient(180deg,#08090d 0%,#050609 100%)!important;
    }

    .film-stage-contained .scene-covers .cover-space{
      position:absolute!important;
      inset:0!important;
      perspective:1450px!important;
      perspective-origin:50% 46%!important;
      transform-style:preserve-3d!important;
      transform:none!important;
      isolation:isolate;
    }

    .film-stage-contained .scene-covers .cover-space::before{
      content:'';
      position:absolute;
      left:16%;right:16%;top:18%;bottom:15%;
      border-radius:50%;
      background:
        radial-gradient(ellipse at 50% 48%,rgba(72,93,255,.20),rgba(80,54,185,.09) 34%,transparent 69%);
      filter:blur(34px);
      opacity:.82;
      pointer-events:none;
      z-index:0;
    }

    .film-stage-contained .scene-covers .cover-space::after{
      content:'';
      position:absolute;
      left:24%;right:24%;bottom:10%;height:42px;
      border-radius:50%;
      background:radial-gradient(ellipse,rgba(27,31,55,.55),rgba(5,6,10,0) 72%);
      filter:blur(9px);
      transform:scaleX(1.25);
      opacity:.78;
      pointer-events:none;
      z-index:0;
    }

    .film-stage-contained .scene-covers .cover-glow{
      opacity:.20!important;
      filter:blur(72px)!important;
    }

    .film-stage-contained .scene-covers .hero-cover{
      top:48%!important;
      margin:0!important;
      transform-style:preserve-3d!important;
      backface-visibility:hidden;
      transition:filter .65s cubic-bezier(.22,1,.36,1),box-shadow .65s cubic-bezier(.22,1,.36,1)!important;
      will-change:transform,translate,filter;
    }

    .film-stage-contained .scene-covers .cover-center{
      left:50%!important;
      top:46.5%!important;
      z-index:6!important;
      transform:translate(-50%,-50%) translateZ(96px) scale(1.07)!important;
      filter:saturate(.98) brightness(1.02) contrast(1.02)!important;
      box-shadow:
        0 42px 90px rgba(0,0,0,.58),
        0 0 0 1px rgba(172,196,255,.12),
        0 0 32px rgba(83,107,255,.16)!important;
      translate:0 -3px;
      animation:parableHeroCoverFloat 4.8s ease-in-out 1.05s infinite alternate!important;
    }

    .film-stage-contained .scene-covers .cover-left{
      left:27.5%!important;
      top:49%!important;
      z-index:3!important;
      transform:translate(-50%,-50%) translateZ(-42px) rotateY(14deg) rotateZ(-3deg) scale(.83)!important;
      filter:saturate(.77) brightness(.67) contrast(.96)!important;
      box-shadow:0 30px 62px rgba(0,0,0,.46)!important;
      translate:0 3px;
      animation:parableSideCoverLeftFloat 5.6s ease-in-out 1.15s infinite alternate!important;
    }

    .film-stage-contained .scene-covers .cover-right{
      left:72.5%!important;
      top:49%!important;
      z-index:3!important;
      transform:translate(-50%,-50%) translateZ(-42px) rotateY(-14deg) rotateZ(3deg) scale(.83)!important;
      filter:saturate(.77) brightness(.67) contrast(.96)!important;
      box-shadow:0 30px 62px rgba(0,0,0,.46)!important;
      translate:0 3px;
      animation:parableSideCoverRightFloat 5.3s ease-in-out 1.2s infinite alternate!important;
    }

    /* Only the focal cover gets the bright Framer-like perimeter comet. */
    .film-stage-contained .scene-covers.is-active .cover-left::before,
    .film-stage-contained .scene-covers.is-active .cover-right::before{
      opacity:.10!important;
      filter:drop-shadow(0 0 2px rgba(155,190,255,.28)) drop-shadow(0 0 7px rgba(87,111,255,.10))!important;
    }
    .film-stage-contained .scene-covers.is-active .cover-center::before{
      opacity:1!important;
      filter:drop-shadow(0 0 2px rgba(220,239,255,.98)) drop-shadow(0 0 8px rgba(112,189,255,.68)) drop-shadow(0 0 18px rgba(83,102,255,.25))!important;
    }

    /* One calm glass reflection instead of multiple competing effects. */
    .film-stage-contained .scene-covers .hero-cover::after{
      opacity:.16!important;
    }
    .film-stage-contained .scene-covers .cover-center::after{
      opacity:.34!important;
    }

    .film-stage-contained .scene-covers .cover-copy{
      padding:18px 17px 17px!important;
      background:linear-gradient(180deg,transparent 0%,rgba(3,4,7,.12) 18%,rgba(3,4,7,.78) 59%,rgba(3,4,7,.96) 100%)!important;
    }
    .film-stage-contained .scene-covers .cover-copy small{
      margin-bottom:38px!important;
      opacity:.72;
    }
    .film-stage-contained .scene-covers .cover-copy b{
      letter-spacing:-.045em!important;
      text-wrap:balance;
    }

    /* Atmospheric lens pass: deliberately slow and almost invisible. */
    .film-stage-contained .scene-covers::after{
      content:'';
      position:absolute;
      width:38%;height:150%;
      left:-18%;top:-25%;
      background:linear-gradient(96deg,transparent 25%,rgba(154,189,255,.025) 42%,rgba(255,255,255,.055) 49%,rgba(122,162,255,.025) 56%,transparent 72%);
      filter:blur(5px);
      transform:rotate(9deg) translateX(-35%);
      mix-blend-mode:screen;
      pointer-events:none;
      z-index:8;
    }
    .film-stage-contained .scene-covers.is-active::after{
      animation:parableCoverLensPass 4.8s cubic-bezier(.22,.61,.36,1) infinite;
    }

    @keyframes parableHeroCoverFloat{
      from{translate:0 -3px;}
      to{translate:0 4px;}
    }
    @keyframes parableSideCoverLeftFloat{
      from{translate:0 3px;}
      to{translate:-3px -2px;}
    }
    @keyframes parableSideCoverRightFloat{
      from{translate:0 3px;}
      to{translate:3px -1px;}
    }
    @keyframes parableCoverLensPass{
      0%,54%{transform:rotate(9deg) translateX(-42%);opacity:0;}
      66%{opacity:.72;}
      100%{transform:rotate(9deg) translateX(360%);opacity:0;}
    }

    @media(max-width:720px){
      .film-stage-contained .scene-covers .cover-left{left:28.5%!important;transform:translate(-50%,-50%) translateZ(-36px) rotateY(11deg) rotateZ(-2.4deg) scale(.84)!important;}
      .film-stage-contained .scene-covers .cover-right{left:71.5%!important;transform:translate(-50%,-50%) translateZ(-36px) rotateY(-11deg) rotateZ(2.4deg) scale(.84)!important;}
      .film-stage-contained .scene-covers .cover-center{transform:translate(-50%,-50%) translateZ(82px) scale(1.055)!important;}
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