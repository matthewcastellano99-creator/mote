// Wiring: the loop and the controls.
(function (MOTE) {
  'use strict';

  const SIM_DT = 1 / 60;   // physics step, in sim-seconds
  const MAX_STEPS = 3;     // per frame, so a slow device slows down instead of stalling
  const VMAX = 60;         // top steering speed

  const canvas = document.getElementById('sky');
  const game = new MOTE.Game();
  const renderer = new MOTE.Renderer(canvas);
  const ui = new MOTE.UI(game, renderer);
  MOTE.game = game; MOTE.renderer = renderer; // handy from the console

  // Leave room for the HUD bands around the arena.
  function fitInsets() {
    const phone = window.innerWidth < 720;
    renderer.insets = phone
      ? { top: 112, right: 12, bottom: 150, left: 12 }
      : { top: 108, right: 240, bottom: 120, left: 24 };
  }
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
    if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
    if (e.code === 'KeyP' || e.code === 'Escape') game.pause();
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

  let last = performance.now(), simAcc = 0, tickAcc = 0, uiAcc = 0;
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    const sim = game.sim;
    if (sim && game.status === 'playing') {
      const { control, aim } = steer(sim);
      sim.control = control;
      simAcc += real;
      let steps = 0;
      while (simAcc >= SIM_DT && steps < MAX_STEPS) {
        sim.step(SIM_DT);
        simAcc -= SIM_DT; tickAcc += SIM_DT; steps++;
      }
      if (steps === MAX_STEPS) simAcc = 0;
      for (const ev of sim.events) { renderer.flash(ev); ui.simEvent(ev); }
      sim.events.length = 0;
      if (tickAcc >= 0.25) { game.tick(tickAcc); tickAcc = 0; }
      renderer.draw(sim, real, aim);
      uiAcc += real;
      if (uiAcc > 0.15) { ui.update(); uiAcc = 0; }
    } else if (sim && game.status === 'briefing') {
      renderer.draw(sim, 0, null); // the untouched box behind the briefing card
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });
})(window.MOTE);
