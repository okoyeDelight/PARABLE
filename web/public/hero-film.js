(() => {
  const film = document.querySelector('#filmFrame');
  const stage = document.querySelector('#filmStage');
  const progress = document.querySelector('#filmProgressBar');
  const phase = document.querySelector('#filmPhase');
  const counter = document.querySelector('#filmCounter');
  const play = document.querySelector('#filmPlay');
  const canvas = document.querySelector('#filmFx');
  if (!film || !stage || !progress || !phase || !counter || !play || !canvas) return;

  const scenes = [...stage.querySelectorAll('.film-scene')];
  const labels = ['Write', 'Understand', 'Shape the world', 'Direct', 'Cut', 'Bring it to screen'];
  const DURATION = 12000;
  const sceneDuration = DURATION / scenes.length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let playing = !reduced;
  let startedAt = performance.now();
  let pausedAt = 0;
  let frameId = 0;
  let activeIndex = -1;
  let pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const ctx = canvas.getContext('2d', { alpha: true });
  let particles = [];
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resizeCanvas() {
    const r = film.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.floor(r.width));
    height = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = Array.from({ length: width < 700 ? 22 : 42 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.45 + Math.random() * 1.15,
      a: 0.06 + Math.random() * 0.22,
      s: 0.08 + Math.random() * 0.24,
      o: Math.random() * Math.PI * 2,
      blue: i % 4 !== 0
    }));
  }

  function paintFx(t) {
    ctx.clearRect(0, 0, width, height);
    const g = ctx.createRadialGradient(
      width * (0.55 + pointer.x * 0.04),
      height * (0.45 + pointer.y * 0.03),
      0,
      width * 0.52,
      height * 0.48,
      Math.max(width, height) * 0.68
    );
    g.addColorStop(0, 'rgba(68,93,255,.10)');
    g.addColorStop(.42, 'rgba(75,50,200,.035)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    particles.forEach((p, i) => {
      const x = p.x + Math.sin(t * p.s * .001 + p.o) * 11 + pointer.x * (i % 5) * .5;
      const y = (p.y + t * p.s * .015) % (height + 30) - 15;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.blue ? `rgba(133,158,255,${p.a})` : `rgba(255,255,255,${p.a * .7})`;
      ctx.fill();
    });
  }

  function setScene(index, localProgress = 0) {
    if (index !== activeIndex) {
      activeIndex = index;
      scenes.forEach((scene, i) => {
        scene.classList.toggle('is-active', i === index);
        scene.classList.toggle('is-before', i < index);
        scene.classList.toggle('is-after', i > index);
        scene.setAttribute('aria-hidden', String(i !== index));
      });
      phase.textContent = labels[index];
      counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
      film.dataset.scene = String(index + 1);
    }
    film.style.setProperty('--scene-progress', String(localProgress));
  }

  function tick(now) {
    pointer.x += (pointer.tx - pointer.x) * .055;
    pointer.y += (pointer.ty - pointer.y) * .055;
    film.style.setProperty('--pointer-x', pointer.x.toFixed(3));
    film.style.setProperty('--pointer-y', pointer.y.toFixed(3));
    paintFx(now);

    if (playing) {
      const elapsed = (now - startedAt) % DURATION;
      const index = Math.min(scenes.length - 1, Math.floor(elapsed / sceneDuration));
      const local = (elapsed % sceneDuration) / sceneDuration;
      setScene(index, local);
      progress.style.transform = `scaleX(${elapsed / DURATION})`;
    }
    frameId = requestAnimationFrame(tick);
  }

  function pauseFilm() {
    if (!playing) return;
    playing = false;
    pausedAt = performance.now();
    film.classList.add('paused');
    play.setAttribute('aria-pressed', 'false');
  }

  function playFilm() {
    if (playing) return;
    const now = performance.now();
    startedAt += now - pausedAt;
    playing = true;
    film.classList.remove('paused');
    play.setAttribute('aria-pressed', 'true');
  }

  play.addEventListener('click', () => playing ? pauseFilm() : playFilm());

  film.addEventListener('pointermove', e => {
    if (innerWidth < 720) return;
    const r = film.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - .5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - .5) * 2;
  });
  film.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; });

  const observer = new IntersectionObserver(([entry]) => {
    if (!entry) return;
    if (!entry.isIntersecting && playing) pauseFilm();
    if (entry.isIntersecting && !playing && film.dataset.userPaused !== '1' && !reduced) playFilm();
  }, { threshold: .12 });
  observer.observe(film);

  play.addEventListener('click', () => {
    film.dataset.userPaused = playing ? '0' : '1';
  });

  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(film);
  resizeCanvas();
  setScene(0, 0);
  if (reduced) {
    playing = false;
    film.classList.add('paused');
    play.setAttribute('aria-pressed', 'false');
  }
  frameId = requestAnimationFrame(tick);

  window.ParableHeroFilm = {
    setStories(stories = []) {
      const targets = ['#heroCoverA', '#heroCoverB', '#heroCoverC'];
      targets.forEach((selector, index) => {
        const el = document.querySelector(selector);
        if (!el || !stories[index]) return;
        const title = el.querySelector('b');
        if (title) title.textContent = stories[index].title;
      });
      const sceneTitle = document.querySelector('#sceneStoryTitle');
      if (sceneTitle && stories[0]) sceneTitle.textContent = stories[0].title;
    },
    destroy() {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      ro.disconnect();
    }
  };
})();