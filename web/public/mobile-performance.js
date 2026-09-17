(() => {
  const mobile = matchMedia('(max-width: 720px)').matches;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const constrained = mobile || !!conn?.saveData || ['slow-2g','2g','3g'].includes(conn?.effectiveType);
  if (!constrained) return;

  document.documentElement.classList.add('parable-mobile-perf');

  const style = document.createElement('style');
  style.id = 'parable-mobile-performance';
  style.textContent = `
    html.parable-mobile-perf .page-grain,
    html.parable-mobile-perf .film-aura,
    html.parable-mobile-perf .film-fx{display:none!important;}

    html.parable-mobile-perf .film-topbar,
    html.parable-mobile-perf .film-bottom,
    html.parable-mobile-perf .film-play,
    html.parable-mobile-perf .shot-caption,
    html.parable-mobile-perf .demo-ui-action,
    html.parable-mobile-perf .demo-intel-inspector,
    html.parable-mobile-perf .demo-lens-menu,
    html.parable-mobile-perf .demo-world-chip,
    html.parable-mobile-perf .demo-cut-toast{
      backdrop-filter:none!important;
      -webkit-backdrop-filter:none!important;
    }

    html.parable-mobile-perf .hero-film{
      box-shadow:0 0 0 1px rgba(59,89,255,.10),0 18px 56px rgba(0,0,0,.50)!important;
    }

    html.parable-mobile-perf .film-scene:not(.is-active),
    html.parable-mobile-perf .film-scene:not(.is-active) *{
      animation-play-state:paused!important;
    }

    html.parable-mobile-perf .statement-section,
    html.parable-mobile-perf .production-section{
      content-visibility:auto;
      contain-intrinsic-size:900px;
    }

    html.parable-mobile-perf .scene-covers .cover-glow,
    html.parable-mobile-perf .cut-film-grain,
    html.parable-mobile-perf .final-atmosphere::before{
      display:none!important;
    }

    html.parable-mobile-perf .director-preview,
    html.parable-mobile-perf .preview-frame,
    html.parable-mobile-perf .final-frame{
      will-change:auto!important;
    }
  `;
  document.head.appendChild(style);

  const shrinkCanvas = () => {
    const canvas = document.querySelector('#filmFx');
    if (!canvas) return;
    canvas.style.display = 'none';
    canvas.width = 1;
    canvas.height = 1;
  };

  const loadScriptOnce = (src, id) => {
    if (document.getElementById(id) || document.querySelector(`script[src="${src}"]`)) return;
    const s = document.createElement('script');
    s.src = src;
    s.id = id;
    s.async = true;
    document.body.appendChild(s);
  };

  const afterFirstPaint = (fn) => {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  };

  document.addEventListener('DOMContentLoaded', () => {
    shrinkCanvas();
    addEventListener('orientationchange', () => setTimeout(shrinkCanvas, 120), {passive:true});

    afterFirstPaint(() => {
      const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 350));
      idle(() => loadScriptOnce('/cursor-pass.js','parable-lazy-cursor-pass'), {timeout:700});
      setTimeout(() => loadScriptOnce('/finish-scene.js','parable-lazy-finish-scene'), 2600);
    });

    const hero = document.querySelector('#heroFilm');
    const play = document.querySelector('#filmPlay');
    if (hero && play && 'IntersectionObserver' in window) {
      let autoPaused = false;
      const io = new IntersectionObserver(([entry]) => {
        const film = document.querySelector('#filmFrame');
        if (!film) return;
        if (!entry.isIntersecting && !film.classList.contains('paused')) {
          play.click();
          autoPaused = true;
        } else if (entry.isIntersecting && autoPaused && film.classList.contains('paused')) {
          play.click();
          autoPaused = false;
        }
      }, {rootMargin:'180px 0px 180px 0px', threshold:.01});
      io.observe(hero);
    }
  }, {once:true});
})();
