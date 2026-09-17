(() => {
  const mobile = matchMedia('(max-width:720px)').matches;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const constrained = mobile || !!conn?.saveData || ['slow-2g','2g','3g'].includes(conn?.effectiveType);

  if (constrained) {
    document.documentElement.classList.add('parable-mobile-perf');
    const perf = document.createElement('style');
    perf.id = 'parable-runtime-performance';
    perf.textContent = `
      .parable-mobile-perf .page-grain,
      .parable-mobile-perf .film-aura,
      .parable-mobile-perf .film-fx{display:none!important}
      .parable-mobile-perf .film-topbar,
      .parable-mobile-perf .film-bottom,
      .parable-mobile-perf .film-play,
      .parable-mobile-perf .shot-caption,
      .parable-mobile-perf .demo-ui-action,
      .parable-mobile-perf .demo-intel-inspector,
      .parable-mobile-perf .demo-lens-menu,
      .parable-mobile-perf .demo-world-chip,
      .parable-mobile-perf .demo-cut-toast{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      .parable-mobile-perf .hero-film{box-shadow:0 0 0 1px rgba(59,89,255,.1),0 18px 54px rgba(0,0,0,.48)!important}
      .parable-mobile-perf .film-scene:not(.is-active),
      .parable-mobile-perf .film-scene:not(.is-active) *{animation-play-state:paused!important}
      .parable-mobile-perf .statement-section,
      .parable-mobile-perf .production-section{content-visibility:auto;contain-intrinsic-size:900px}
      .parable-mobile-perf .scene-covers .cover-glow,
      .parable-mobile-perf .cut-film-grain{display:none!important}
      .parable-mobile-perf .director-preview,
      .parable-mobile-perf .preview-frame{will-change:auto!important}
    `;
    document.head.appendChild(perf);

    const canvas = document.querySelector('#filmFx');
    if (canvas) {
      canvas.style.display = 'none';
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  const loadOnce = (src, id) => {
    if (document.getElementById(id) || document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    document.body.appendChild(script);
  };

  const buildFinish = () => {
    const scene = document.querySelector('.scene-finish');
    const mosaic = scene?.querySelector('.finish-mosaic');
    const copy = scene?.querySelector('.finish-copy');
    if (!scene || !mosaic || !copy || scene.dataset.fastFinish === '1') return;
    scene.dataset.fastFinish = '1';

    mosaic.innerHTML = `
      <div class="finish-lite fl-manuscript"><span>MANUSCRIPT</span></div>
      <div class="finish-lite fl-director"><span>DIRECT</span></div>
      <div class="finish-lite fl-before"><span>BEFORE I SAID YES</span></div>
      <div class="finish-lite fl-watchman"><span>THE WATCHMAN</span></div>
      <div class="finish-lite fl-main"><i></i><span>THE ALTAR · FINAL CUT</span></div>`;
    copy.innerHTML = `<span class="mini-mark finish-mark"></span><p class="finish-lite-kicker">PARABLE · STORY → SCREEN</p><h3>Stories made visible.</h3><p>From the first line to the final frame.</p>`;

    const style = document.createElement('style');
    style.id = 'parable-fast-finish';
    style.textContent = `
      .scene-finish{background:radial-gradient(ellipse at 50% 48%,rgba(65,79,180,.18),transparent 60%),#06070a!important}
      .scene-finish .finish-mosaic{position:absolute;inset:0;perspective:1100px;overflow:hidden}
      .finish-lite{position:absolute;border:1px solid rgba(255,255,255,.1);border-radius:13px;overflow:hidden;box-shadow:0 20px 52px rgba(0,0,0,.44);opacity:.44;background:#0b0d12}
      .finish-lite span{position:absolute;left:10px;bottom:9px;font-size:5px;letter-spacing:.12em;color:rgba(255,255,255,.58);z-index:2}
      .fl-main{left:50%;top:49%;width:43%;height:58%;transform:translate(-50%,-50%);z-index:5;opacity:.9;background:linear-gradient(112deg,#070a0f 0%,#172033 48%,#080a0e 100%);box-shadow:0 30px 78px rgba(0,0,0,.58),0 0 28px rgba(76,102,255,.12)}
      .fl-main:before{content:'';position:absolute;right:11%;top:7%;width:25%;height:58%;border:1px solid rgba(208,221,255,.15);background:linear-gradient(155deg,#77849e,#27334a 40%,#0a0f18)}
      .fl-main:after{content:'';position:absolute;left:52%;bottom:5%;width:14%;height:58%;border-radius:46% 46% 8% 8%;background:linear-gradient(95deg,#040506,#111621 55%,#06080d)}
      .fl-main i{position:absolute;left:17%;bottom:16%;width:28%;height:18%;background:linear-gradient(180deg,#463625,#1a120c 62%,#0c0906);box-shadow:0 14px 30px rgba(0,0,0,.55)}
      .fl-director{left:8%;top:16%;width:25%;height:34%;transform:rotate(-2deg);background:linear-gradient(135deg,#0a0d14,#1a2337 58%,#080a0e)}
      .fl-director:after{content:'';position:absolute;width:34%;height:78%;left:43%;bottom:-5%;border-radius:45% 45% 8% 8%;background:linear-gradient(100deg,#050608,#252c3d 58%,#090b10)}
      .fl-before{right:8%;top:14%;width:20%;height:37%;transform:rotate(2deg);background:linear-gradient(145deg,#6c354f,#2b1725 55%,#0b090d)}
      .fl-watchman{right:9%;bottom:10%;width:23%;height:29%;transform:rotate(-2deg);background:linear-gradient(145deg,#173344,#0d1b26 56%,#06090d)}
      .fl-manuscript{left:9%;bottom:10%;width:23%;height:29%;transform:rotate(2deg);background:linear-gradient(145deg,#151820,#0a0c11)}
      .fl-manuscript:before{content:'Chapter seven\A\A The room fell quiet.\A Daniel looked at the empty chair.';white-space:pre;position:absolute;left:12%;top:15%;font-size:6px;line-height:1.55;color:rgba(235,237,243,.55)}
      .scene-finish .finish-copy{z-index:10!important;width:62%!important;text-shadow:0 7px 28px rgba(0,0,0,.72)!important}
      .finish-lite-kicker{font-size:6px!important;letter-spacing:.17em!important;color:rgba(216,221,235,.55)!important;margin:0 0 9px!important}
      .scene-finish.is-active .finish-lite{animation:finishLiteIn .68s cubic-bezier(.16,1,.3,1) both}
      .scene-finish.is-active .fl-main{animation-delay:.12s}
      .scene-finish.is-active .fl-before{animation-delay:.08s}.scene-finish.is-active .fl-watchman{animation-delay:.16s}.scene-finish.is-active .fl-manuscript{animation-delay:.2s}
      @keyframes finishLiteIn{from{opacity:0;filter:blur(5px);translate:0 8px}to{filter:none;translate:0 0}}
    `;
    document.head.appendChild(style);
  };

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, constrained ? 420 : 120));
    idle(() => loadOnce('/cursor-pass.js','parable-lazy-cursor'), {timeout: constrained ? 900 : 400});
    setTimeout(buildFinish, constrained ? 4200 : 900);
  }));

  if (constrained) {
    const hero = document.querySelector('#heroFilm');
    const play = document.querySelector('#filmPlay');
    if (hero && play && 'IntersectionObserver' in window) {
      let autoPaused = false;
      const io = new IntersectionObserver(([entry]) => {
        const film = document.querySelector('#filmFrame');
        if (!film) return;
        if (!entry.isIntersecting && !film.classList.contains('paused')) { play.click(); autoPaused = true; }
        else if (entry.isIntersecting && autoPaused && film.classList.contains('paused')) { play.click(); autoPaused = false; }
      }, {rootMargin:'160px 0px 160px 0px',threshold:.01});
      io.observe(hero);
    }
  }
})();
