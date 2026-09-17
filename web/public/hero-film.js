(() => {
  const film = document.querySelector('#filmFrame');
  if (!film || window.__parableVideoFirst) return;
  window.__parableVideoFirst = true;

  const VIDEO_SRC = '/media/parable-hero.mp4';
  const POSTER_SRC = '/media/parable-hero-poster.svg';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  film.classList.add('parable-video-first');
  film.innerHTML = `
    <div class="parable-hero-media">
      <img class="parable-hero-poster" src="${POSTER_SRC}" alt="" decoding="async" />
      <video class="parable-hero-video" muted playsinline loop preload="none" poster="${POSTER_SRC}" aria-label="PARABLE story-to-screen product film"></video>
      <div class="parable-video-status"><span></span> PARABLE product film</div>
      <button class="parable-video-toggle" type="button" aria-label="Pause PARABLE product film" aria-pressed="true"><span class="pause">Ⅱ</span><span class="play">▶</span></button>
    </div>`;

  const media = film.querySelector('.parable-hero-media');
  const video = film.querySelector('.parable-hero-video');
  const poster = film.querySelector('.parable-hero-poster');
  const toggle = film.querySelector('.parable-video-toggle');
  let loaded = false;
  let visible = false;
  let userPaused = false;

  const style = document.createElement('style');
  style.id = 'parable-video-first-style';
  style.textContent = `
    .hero-film.parable-video-first{
      position:relative!important;overflow:hidden!important;padding:0!important;
      background:#07080b!important;aspect-ratio:1.5!important;min-height:0!important;height:auto!important;
      border:1px solid rgba(92,111,255,.38)!important;border-radius:22px!important;
      box-shadow:0 20px 70px rgba(0,0,0,.52),0 0 34px rgba(72,90,255,.12)!important;
      contain:layout paint style!important;
    }
    .parable-hero-media{position:absolute;inset:0;background:#07080b;overflow:hidden}
    .parable-hero-video,.parable-hero-poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
    .parable-hero-video{opacity:0;transition:opacity .28s ease;background:#07080b}
    .parable-hero-video.is-ready{opacity:1}
    .parable-hero-poster{opacity:1;transition:opacity .28s ease}
    .parable-hero-poster.is-hidden{opacity:0;pointer-events:none}
    .parable-video-status{position:absolute;z-index:3;left:18px;top:16px;display:flex;align-items:center;gap:7px;font:500 11px/1.2 'DM Sans',system-ui,sans-serif;color:rgba(244,246,251,.76);text-shadow:0 2px 8px rgba(0,0,0,.55)}
    .parable-video-status span{width:8px;height:8px;border-radius:50%;background:#70e5b4;box-shadow:0 0 12px rgba(112,229,180,.58)}
    .parable-video-toggle{position:absolute;z-index:4;right:18px;top:50%;transform:translateY(-50%);width:54px;height:54px;border-radius:50%;border:1px solid rgba(255,255,255,.20);background:rgba(10,12,17,.66);color:#fff;display:grid;place-items:center;font:500 18px/1 system-ui;box-shadow:0 12px 30px rgba(0,0,0,.34);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
    .parable-video-toggle .play{display:none;font-size:14px;margin-left:2px}.parable-video-toggle.is-paused .pause{display:none}.parable-video-toggle.is-paused .play{display:inline}
    @media(max-width:720px){
      .hero-film.parable-video-first{aspect-ratio:1.5!important;border-radius:17px!important;box-shadow:0 14px 42px rgba(0,0,0,.48),0 0 18px rgba(72,90,255,.10)!important}
      .parable-video-status{left:13px;top:12px;font-size:9px}.parable-video-status span{width:7px;height:7px}
      .parable-video-toggle{right:13px;width:48px;height:48px;backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(10,12,17,.82)}
    }
  `;
  document.head.appendChild(style);

  const setPausedUI = (paused) => {
    toggle.classList.toggle('is-paused', paused);
    toggle.setAttribute('aria-pressed', String(!paused));
    toggle.setAttribute('aria-label', paused ? 'Play PARABLE product film' : 'Pause PARABLE product film');
  };

  const ensureLoaded = () => {
    if (loaded) return;
    loaded = true;
    video.src = VIDEO_SRC;
    video.load();
  };

  const tryPlay = async () => {
    if (reduced || userPaused || !visible) return;
    ensureLoaded();
    try { await video.play(); setPausedUI(false); } catch (_) { setPausedUI(true); }
  };

  video.addEventListener('canplay', () => {
    video.classList.add('is-ready');
    poster.classList.add('is-hidden');
    tryPlay();
  }, {once:false});
  video.addEventListener('error', () => {
    video.classList.remove('is-ready');
    poster.classList.remove('is-hidden');
    setPausedUI(true);
  });

  toggle.addEventListener('click', () => {
    ensureLoaded();
    if (video.paused) {
      userPaused = false;
      tryPlay();
    } else {
      userPaused = true;
      video.pause();
      setPausedUI(true);
    }
  });

  const io = new IntersectionObserver(([entry]) => {
    if (!entry) return;
    visible = entry.isIntersecting;
    if (entry.isIntersecting) {
      ensureLoaded();
      tryPlay();
    } else {
      video.pause();
      setPausedUI(true);
    }
  }, {rootMargin:'320px 0px 320px 0px',threshold:.08});
  io.observe(film);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { video.pause(); setPausedUI(true); }
    else if (visible) tryPlay();
  });

  if (reduced) setPausedUI(true);

  window.ParableHeroFilm = {
    setStories(){},
    destroy(){ io.disconnect(); video.pause(); }
  };
})();