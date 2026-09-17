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

      .film-stage-contained .hero-cover{width:190px!important;height:270px!important;padding:20px!important;border-radius:17px!important;}
      .film-stage-contained .hero-cover b{font-size:25px!important;}
      .film-stage-contained .cover-center{left:50%!important;top:47%!important;}
      .film-stage-contained .cover-left{left:31%!important;top:50%!important;}
      .film-stage-contained .cover-right{left:69%!important;top:50%!important;}

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