(() => {
  const film = document.querySelector('#filmFrame');
  const stage = document.querySelector('#filmStage');
  const play = document.querySelector('#filmPlay');
  const phase = document.querySelector('#filmPhase');
  const counter = document.querySelector('#filmCounter');
  const progress = document.querySelector('#filmProgressBar');
  const canvas = document.querySelector('#filmFx');
  if (!film || !stage || !play || !phase || !counter || !progress) return;

  document.documentElement.classList.add('parable-mobile-safe');
  if (canvas) {
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.display = 'none';
  }

  const scenes = [...stage.querySelectorAll('.film-scene')];
  const labels = ['Write','Understand','Shape the world','Direct','Cut','Bring it to screen'];
  const sceneMs = 2200;
  let index = 0;
  let playing = true;
  let timer = null;
  let visible = true;
  let userPaused = false;

  const style = document.createElement('style');
  style.id = 'parable-mobile-safe-style';
  style.textContent = `
    .film-fx{display:none!important}
    @media(max-width:720px){
      html.parable-mobile-safe .page-grain{display:none!important}
      html.parable-mobile-safe .film-aura{filter:none!important;opacity:.34!important}
      html.parable-mobile-safe .hero-film,
      html.parable-mobile-safe .film-stage{contain:layout paint style!important}
      html.parable-mobile-safe .film-vignette{opacity:.42!important}
      html.parable-mobile-safe .film-scene:not(.is-active),
      html.parable-mobile-safe .film-scene:not(.is-active) *{animation:none!important;transition:none!important}
      html.parable-mobile-safe .film-scene:not(.is-active){visibility:hidden!important;pointer-events:none!important}
      html.parable-mobile-safe .film-scene.is-active{visibility:visible!important}
      html.parable-mobile-safe .cut-film-grain,
      html.parable-mobile-safe .final-atmosphere::before,
      html.parable-mobile-safe .scene-covers::after{display:none!important}
      html.parable-mobile-safe .statement-section,
      html.parable-mobile-safe .production-section{content-visibility:auto;contain-intrinsic-size:900px}
      html.parable-mobile-safe .mobile-demo-pointer{position:absolute;z-index:95;width:17px;height:22px;left:0;top:0;opacity:0;pointer-events:none;transform:translate3d(-30px,-30px,0);transition:transform .42s cubic-bezier(.22,.82,.24,1),opacity .14s ease;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
      html.parable-mobile-safe .mobile-demo-pointer.is-visible{opacity:.9}
      html.parable-mobile-safe .mobile-demo-pointer svg{width:100%;height:100%;display:block}
      html.parable-mobile-safe .mobile-click-ring{position:absolute;left:2px;top:2px;width:7px;height:7px;border:1px solid rgba(255,255,255,.72);border-radius:50%;opacity:0}
      html.parable-mobile-safe .mobile-demo-pointer.is-clicking .mobile-click-ring{animation:mobileClickRing .34s ease-out}
      @keyframes mobileClickRing{0%{opacity:.9;transform:scale(.25)}100%{opacity:0;transform:scale(3)}}
    }
  `;
  document.head.appendChild(style);

  const cursor = document.createElement('div');
  cursor.className = 'mobile-demo-pointer';
  cursor.setAttribute('aria-hidden','true');
  cursor.innerHTML = `<svg viewBox="0 0 24 30"><path d="M2.2 2.2 2.5 24l5.4-5.2 3.4 8.5 4.2-1.8-3.5-8.2 7.5-.2Z" fill="#fff" stroke="#090a0d" stroke-width="1.25" stroke-linejoin="round"/></svg><span class="mobile-click-ring"></span>`;
  stage.appendChild(cursor);

  const moveCursor = (x,y,click=false) => {
    const r = stage.getBoundingClientRect();
    const t = `translate3d(${Math.round(r.width*x/100)}px,${Math.round(r.height*y/100)}px,0)`;
    cursor.style.transform = t;
    cursor.classList.add('is-visible');
    if (click) {
      setTimeout(()=>cursor.classList.add('is-clicking'),260);
      setTimeout(()=>cursor.classList.remove('is-clicking'),560);
    }
  };

  const cursorCue = (i) => {
    cursor.classList.remove('is-visible','is-clicking');
    const cues = [[67,25,true],[58,31,true],[51,50,true],[79,48,true],[51,77,true],[50,80,true]];
    const cue = cues[i];
    if (!cue) return;
    setTimeout(()=>moveCursor(cue[0],cue[1],cue[2]),360);
  };

  const showScene = (next) => {
    index = (next + scenes.length) % scenes.length;
    scenes.forEach((scene,i) => {
      const active = i === index;
      scene.classList.toggle('is-active',active);
      scene.classList.toggle('is-before',i < index);
      scene.classList.toggle('is-after',i > index);
      scene.setAttribute('aria-hidden',active?'false':'true');
    });
    film.dataset.scene = String(index + 1);
    phase.textContent = labels[index];
    counter.textContent = `${String(index+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}`;
    progress.style.transform = `scaleX(${(index+1)/scenes.length})`;
    cursorCue(index);
  };

  const schedule = () => {
    clearTimeout(timer);
    if (!playing || !visible || document.hidden) return;
    timer = setTimeout(() => { showScene(index + 1); schedule(); }, sceneMs);
  };

  const setPlaying = (value, fromUser=false) => {
    playing = value;
    if (fromUser) userPaused = !value;
    film.classList.toggle('paused',!playing);
    play.setAttribute('aria-pressed',String(playing));
    if (!playing) {
      clearTimeout(timer);
      cursor.classList.remove('is-visible');
    } else {
      cursorCue(index);
      schedule();
    }
  };

  play.addEventListener('click',()=>setPlaying(!playing,true));

  const io = new IntersectionObserver(([entry])=>{
    visible = !!entry?.isIntersecting;
    if (!visible) {
      clearTimeout(timer);
      cursor.classList.remove('is-visible');
    } else if (!userPaused) {
      playing = true;
      film.classList.remove('paused');
      schedule();
      cursorCue(index);
    }
  },{threshold:.08});
  io.observe(film);

  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) clearTimeout(timer);
    else if (playing && visible) schedule();
  });

  showScene(0);
  schedule();

  window.ParableHeroFilm = {
    setStories(stories=[]){
      ['#heroCoverA','#heroCoverB','#heroCoverC'].forEach((selector,i)=>{
        const title = document.querySelector(selector)?.querySelector('b');
        if (title && stories[i]) title.textContent = stories[i].title;
      });
      const sceneTitle = document.querySelector('#sceneStoryTitle');
      if (sceneTitle && stories[0]) sceneTitle.textContent = stories[0].title;
    },
    destroy(){ clearTimeout(timer); io.disconnect(); }
  };
})();