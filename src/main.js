// Wiring: the loop and the controls.
(function (MOTE) {
  'use strict';

  const SIM_DT = 1 / 60;   // longest physics step, in sim-seconds
  const MAX_STEPS = 12;    // per frame at 5×; 3 at 1×, so a slow device slows down instead of stalling
  const VMAX = 60;         // top steering speed

  const canvas = document.getElementById('sky');
  const game = new MOTE.Game();
  const renderer = new MOTE.Renderer(canvas);
  const ui = new MOTE.UI(game, renderer);
  MOTE.game = game; MOTE.renderer = renderer; // handy from the console

  // Fit the arena between the HUD above and the goals below; on wide screens the
  // constants, time and buttons get a column of their own on the right.
  function fitInsets() {
    const phone = window.innerWidth < 720;
    const top = Math.ceil(document.getElementById('hud').getBoundingClientRect().bottom) + 10;
    const bottom = Math.ceil(window.innerHeight - document.getElementById('goals').getBoundingClientRect().top) + 10;
    renderer.insets = phone ? { top, right: 12, bottom, left: 12 } : { top, right: 240, bottom, left: 24 };
  }
  ui.onLayout = fitInsets;
  ui.onTimeChange = (v) => { pace = v; };
  if (document.fonts) document.fonts.ready.then(fitInsets); // the HUD grows once its fonts arrive
  renderer.aspect = () => {
    const i = renderer.insets;
    return (renderer.w - i.left - i.right) / Math.max(1, renderer.h - i.top - i.bottom);
  };
  fitInsets();

  const intro = document.getElementById('intro');
  if (game.save.seenIntro) {
    intro.classList.add('hidden');
    ui.onSetup(false);
  }
  document.getElementById('begin').addEventListener('click', () => {
    intro.classList.add('hidden');
    game.save.seenIntro = true;
    ui.onSetup(false);
  });

  // ---- Controls: hold to steer toward a point, or WASD / arrows, Space to brake ----
  const keys = new Set();
  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'brake',
  };
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.code === 'BracketLeft') ui.nudgeTime(-1);
    if (e.code === 'BracketRight') ui.nudgeTime(1);
    if (e.code === 'KeyP' || e.code === 'Escape') game.pause();
    // While the time slider has keyboard focus, the arrow keys belong to it.
    if (e.target.id === 'time-scale' && e.code.startsWith('Arrow')) return;
    if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
  window.addEventListener('blur', () => keys.clear());

  let pointer = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer = { px: e.clientX, py: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => { if (pointer) { pointer.px = e.clientX; pointer.py = e.clientY; } });
  const release = () => { pointer = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Turn input into a desired velocity; the sim limits how hard you can thrust toward it.
  function steer(sim) {
    let dx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    let dy = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
    if (dx || dy) {
      const d = Math.hypot(dx, dy);
      return { control: { vx: dx / d * VMAX, vy: dy / d * VMAX }, aim: null };
    }
    if (pointer) {
      const t = renderer.toWorld(pointer.px, pointer.py);
      dx = t.x - sim.bh.x; dy = t.y - sim.bh.y;
      const d = Math.hypot(dx, dy) || 1, speed = VMAX * Math.min(1, d / 60);
      return { control: { vx: dx / d * speed, vy: dy / d * speed }, aim: t };
    }
    if (keys.has('brake')) return { control: { vx: 0, vy: 0 }, aim: null };
    return { control: null, aim: null };
  }

  window.addEventListener('resize', () => {
    fitInsets();
    renderer.resize();
    if (game.sim) renderer.draw(game.sim, 0, null);
  });

  let last = performance.now(), tickAcc = 0, tickReal = 0, uiAcc = 0, pace = game.save.timeScale || 1;
  function frame(now) {
    const wall = (now - last) / 1000;
    const real = Math.min(0.1, wall); // a long stall shouldn't become one giant leap
    last = now;
    const sim = game.sim;
    if (sim && game.status === 'playing') {
      const { control, aim } = steer(sim);
      sim.control = control;
      // Fast-forward takes more full-size steps per frame; slow motion takes one
      // smaller step every frame, so it stays smooth (and only gets more accurate).
      const want = real * game.save.timeScale;
      let advanced = 0;
      if (want > 0) {
        const budget = Math.min(MAX_STEPS, Math.ceil(3 * Math.max(1, game.save.timeScale)));
        const n = Math.max(1, Math.min(budget, Math.ceil(want / SIM_DT - 1e-9)));
        const dt = Math.min(SIM_DT, want / n);
        for (let k = 0; k < n; k++) sim.step(dt);
        advanced = n * dt;
      }
      // Pace is judged against the true wall clock, so a struggling device is told the truth.
      if (wall > 0) pace += (advanced / wall - pace) * Math.min(1, wall * 2);
      tickAcc += advanced; tickReal += real;
      for (const ev of sim.events) { renderer.flash(ev); ui.simEvent(ev); }
      sim.events.length = 0;
      // Goals update every quarter second of sim time, and at least every quarter
      // second of real time so the HUD stays live in deep slow motion.
      if (tickAcc > 0 && (tickAcc >= 0.25 || tickReal >= 0.25)) { game.tick(tickAcc); tickAcc = 0; tickReal = 0; }
      renderer.draw(sim, advanced, aim); // flashes run on sim time too
      uiAcc += real;
      if (uiAcc > 0.15) { ui.update(); ui.showPace(pace, uiAcc); uiAcc = 0; }
    } else if (sim && game.status === 'briefing') {
      renderer.draw(sim, 0, null); // the untouched box behind the briefing card
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });
})(window.MOTE);
