// Measuring the structure around the black hole: what orbits you, and what it looks like.
(function (MOTE) {
  'use strict';

  const { STAR, BODY } = MOTE.KIND;

  // Orbiting means bound to you (negative orbital energy), within the inner arena,
  // and close to a circular orbit: tangential speed within 40% of √(GM/r), and
  // little radial motion. Drifting gas that merely hasn't escaped doesn't count.
  function measure(sim) {
    const bh = sim.bh, GM = sim.k.G * bh.m;
    const reach = Math.min(sim.W, sim.H) * 0.45;
    let orbiting = 0, orbitingMass = 0, orbitingStars = 0, stars = 0, bodies = 0, biggest = 0;
    let lSum = 0, lAbs = 0;
    for (let i = 0; i < sim.n; i++) {
      const k = sim.kind[i], m = sim.m[i];
      if (k === STAR) stars++;
      else if (k === BODY) { bodies++; if (m > biggest) biggest = m; }
      const dx = sim.x[i] - bh.x, dy = sim.y[i] - bh.y;
      const dvx = sim.vx[i] - bh.vx, dvy = sim.vy[i] - bh.vy;
      const r = Math.hypot(dx, dy), v2 = dvx * dvx + dvy * dvy;
      if (r > reach) continue;
      const energy = v2 / 2 - GM / Math.sqrt(r * r + 4);
      if (energy >= 0 || r < 1) continue;
      const l = dx * dvy - dy * dvx;
      const vt = Math.abs(l) / r, vr = Math.abs(dx * dvx + dy * dvy) / r, vc = Math.sqrt(GM / r);
      if (vt < 0.6 * vc || vt > 1.4 * vc || vr > 0.45 * vc) continue;
      if (k === STAR) orbitingStars++; else { orbiting++; orbitingMass += m; }
      lSum += m * l; lAbs += m * Math.abs(l);
    }
    return {
      orbiting, orbitingMass, orbitingStars, stars, bodies, biggest,
      coherence: lAbs > 0 ? Math.abs(lSum) / lAbs : 0,
      spin: Math.sign(lSum) || 1,
    };
  }

  // Name the structure you built, for the archive.
  function classify(sim, m) {
    if (m.orbitingStars >= 5 && m.orbitingMass >= 200) return 'Galactic Nucleus';
    if (m.orbitingStars >= 3) return 'Nuclear Star Cluster';
    if (sim.bh.lum > 4000) return 'Quasar';
    if (m.orbitingMass >= 250 && m.coherence > 0.8) return 'Accretion Disk';
    if (m.stars >= 4) return 'Stellar Nursery';
    if (m.orbitingMass >= 100) return 'Ringed Hole';
    if (m.stars >= 1) return 'Lone Star System';
    if (m.bodies >= 10) return 'Clumpy Nebula';
    return 'Dust Cloud';
  }

  MOTE.measure = measure;
  MOTE.classify = classify;
})(typeof window !== 'undefined' ? window.MOTE : globalThis.MOTE);
