// Wiring: the loop, the hand, saving.
(function (MOTE) {
  'use strict';

  const SIM_DT = 1 / 30;    // physics step, in sim-seconds
  const TIME_SCALE = 1.5;   // sim-seconds per real second at 1×
  const MAX_STEPS = 6;      // per frame, so a slow device slows down instead of stalling

  const canvas = document.getElementById('sky');
  const game = new MOTE.Game();
  const renderer = new MOTE.Renderer(canvas);
  const ui = new MOTE.UI(game, renderer);
  ui.timeScale = TIME_SCALE;
  MOTE.game = game; // handy from the console

  const intro = document.getElementById('intro');
  if (game.state.seenIntro) intro.classList.add('hidden');
  document.getElementById('begin').addEventListener('click', () => {
    intro.classList.add('hidden');
    game.state.seenIntro = true;
    game.save();
  });

  // The hand: hold to gather, right-click / Shift / Scatter mode to push away.
  let pointer = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer = { px: e.clientX, py: e.clientY, sign: e.button === 2 || e.shiftKey || ui.scatter ? -1 : 1 };
  });
  canvas.addEventListener('pointermove', (e) => { if (pointer) { pointer.px = e.clientX; pointer.py = e.clientY; } });
  const release = () => { pointer = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    renderer.cam.zoom = Math.min(5, Math.max(0.35, renderer.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
  }, { passive: false });
  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now(), simAcc = 0, tickAcc = 0, uiAcc = 0, saveAcc = 0;
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    const sim = game.sim;

    if (pointer) {
      const w = renderer.toWorld(pointer.px, pointer.py);
      sim.hand = { x: w.x, y: w.y, sign: pointer.sign };
    } else {
      sim.hand = null;
    }

    simAcc += real * TIME_SCALE * game.state.speed;
    let steps = 0;
    while (simAcc >= SIM_DT && steps < MAX_STEPS) {
      sim.step(SIM_DT);
      simAcc -= SIM_DT; tickAcc += SIM_DT; steps++;
    }
    if (steps === MAX_STEPS) simAcc = 0;

    for (const ev of sim.events) renderer.flash(ev);
    sim.events.length = 0;

    if (tickAcc >= 0.25) { game.tick(tickAcc); tickAcc = 0; }
    renderer.draw(sim, game.metrics, sim.hand, real);

    uiAcc += real;
    if (uiAcc > 0.2) { ui.update(); uiAcc = 0; }
    saveAcc += real;
    if (saveAcc > 15) { game.save(); saveAcc = 0; }
    requestAnimationFrame(frame);
  }

  game.tick(0);
  ui.update();
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });
  window.addEventListener('pagehide', () => game.save());
})(window.MOTE);
