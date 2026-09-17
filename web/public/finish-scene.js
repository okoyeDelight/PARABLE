(() => {
  const mobile = matchMedia('(max-width:720px)').matches;
  const root = document.documentElement;
  if (mobile) {
    root.classList.add('parable-mobile-perf');
    const style = document.createElement('style');
    style.id = 'parable-mobile-emergency-perf';
    style.textContent = `
      @media(max-width:720px){
        .parable-mobile-perf .page-grain,
        .parable-mobile-perf .film-aura,
        .parable-mobile-perf .film-fx{display:none!important}
        .parable-mobile-perf .film-topbar,
        .parable-mobile-perf .film-bottom,
        .parable-mobile-perf .film-play,
        .parable-mobile-perf .shot-caption{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
        .parable-mobile-perf .film-scene:not(.is-active),
        .parable-mobile-perf .film-scene:not(.is-active) *{animation:none!important;transition:none!important}
        .parable-mobile-perf .scene-covers .cover-glow{display:none!important}
        .parable-mobile-perf .hero-film{box-shadow:0 0 0 1px rgba(59,89,255,.1),0 14px 40px rgba(0,0,0,.42)!important}
        .parable-mobile-perf .statement-section,
        .parable-mobile-perf .production-section{content-visibility:auto;contain-intrinsic-size:900px}
      }
    `;
    document.head.appendChild(style);
    return;
  }

  // Desktop keeps the richer cursor demo, but load it only after the page settles.
  const loadCursor = () => {
    if (document.querySelector('script[src="/cursor-pass.js"]')) return;
    const s = document.createElement('script');
    s.src = '/cursor-pass.js';
    s.async = true;
    document.body.appendChild(s);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(loadCursor,{timeout:1200});
  else setTimeout(loadCursor,900);
})();