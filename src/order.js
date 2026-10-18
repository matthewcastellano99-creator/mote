// Measuring order: how concentrated the mass is, and how coherently it turns.
(function (MOTE) {
  'use strict';

  const GRID = 24;
  const { STAR, HOLE, BODY } = MOTE.KIND;

  function entropy(sim, cx, cy, span) {
    const cells = new Float64Array(GRID * GRID);
    let total = 0;
    for (let i = 0; i < sim.n; i++) {
      const gx = Math.floor(((sim.x[i] - cx) / span + 0.5) * GRID);
      const gy = Math.floor(((sim.y[i] - cy) / span + 0.5) * GRID);
      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
      cells[gy * GRID + gx] += sim.m[i];
      total += sim.m[i];
    }
    let h = 0;
    for (let k = 0; k < cells.length; k++) {
      if (cells[k] <= 0) continue;
      const p = cells[k] / total;
      h -= p * Math.log(p);
    }
    return h;
  }

  function measure(sim, baseline) {
    const n = sim.n;
    let mass = 0, cx = 0, cy = 0, vx = 0, vy = 0;
    let stars = 0, holes = 0, bodies = 0, biggest = 0;
    for (let i = 0; i < n; i++) {
      const m = sim.m[i];
      mass += m; cx += m * sim.x[i]; cy += m * sim.y[i];
      vx += m * sim.vx[i]; vy += m * sim.vy[i];
      const k = sim.kind[i];
      if (k === STAR) stars++; else if (k === HOLE) holes++; else if (k === BODY) bodies++;
      if (m > biggest) biggest = m;
    }
    if (mass === 0) {
      return { mass, cx: 0, cy: 0, extent: MOTE.WORLD_R, concentration: 0, coherence: 0, richness: 0, order: 0, stars, holes, bodies, biggest, entropy: 0 };
    }
    cx /= mass; cy /= mass; vx /= mass; vy /= mass;

    // Coherence: |sum of angular momenta| / sum of |angular momenta|.
    let lSum = 0, lAbs = 0;
    for (let i = 0; i < n; i++) {
      const dx = sim.x[i] - cx, dy = sim.y[i] - cy;
      const l = sim.m[i] * (dx * (sim.vy[i] - vy) - dy * (sim.vx[i] - vx));
      lSum += l; lAbs += Math.abs(l);
    }
    const coherence = lAbs > 1e-9 ? Math.abs(lSum) / lAbs : 0;

    // Radius holding 90% of the mass: how big the structure is, for the camera.
    const dist = [];
    for (let i = 0; i < n; i++) dist.push([Math.hypot(sim.x[i] - cx, sim.y[i] - cy), sim.m[i]]);
    dist.sort((a, b) => a[0] - b[0]);
    let acc = 0, extent = MOTE.WORLD_R;
    for (const [d, m] of dist) { acc += m; if (acc >= mass * 0.9) { extent = d; break; } }
    const spin = Math.sign(lSum) || 1;

    const h = entropy(sim, cx, cy, MOTE.WORLD_R * 2.2);
    const h0 = baseline || h || 1;
    const concentration = Math.max(0, Math.min(1, (h0 - h) / h0));

    // A lone dead blob is concentrated but not ordered; motion gives it life,
    // and a universe that has swallowed itself has lost its richness.
    const richness = Math.min(1, Math.log(1 + n) / Math.log(1 + 500));
    const order = (0.5 * concentration + 0.5 * coherence) * richness * richness;
    return { mass, cx, cy, extent, concentration, coherence, richness, order, spin, stars, holes, bodies, biggest, entropy: h };
  }

  // Name the structure the physics has made.
  function classify(m) {
    const ordered = m.coherence > 0.55;
    if (m.holes >= 1 && m.stars >= 150) return ordered ? 'Spiral Galaxy' : 'Elliptical Galaxy';
    if (m.holes >= 1) return ordered ? 'Quasar Disk' : 'Lonely Singularity';
    if (m.stars >= 150) return ordered ? 'Stellar Disk' : 'Globular Cluster';
    if (m.stars >= 30) return ordered ? 'Stellar Pinwheel' : 'Open Cluster';
    if (m.stars >= 1) return 'Stellar Nursery';
    if (m.bodies >= 6) return ordered ? 'Accretion Disk' : 'Clumpy Nebula';
    if (m.bodies >= 1) return 'Coalescing Nebula';
    return 'Diffuse Nebula';
  }

  MOTE.measure = measure;
  MOTE.classify = classify;
})(typeof window !== 'undefined' ? window.MOTE : globalThis.MOTE);
