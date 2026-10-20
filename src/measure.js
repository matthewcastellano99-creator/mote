// Measuring the structure around the black hole: what orbits you, whether it has spiral
// arms, and what to call it.
(function (MOTE) {
  'use strict';

  const { STAR, BODY } = MOTE.KIND;

  // Spiral arms, about the hole:
  //   1. Is it a rotating disk?  coherence = |ΣL| / Σ|L|
  //   2. Does it have arms?      the m-fold Fourier amplitude (best m in 1..4) of matter in
  //                              log-radius annuli, minus what random scatter would give
  //   3. Are they spirals?       the arm phase must wind steadily with ln r, as a log
  //                              spiral does, at a pitch between 8° and 50° (not a bar,
  //                              ring or blob)
  // score = strength × goodness of that fit; ≥ 0.12 is a spiral you can see, ≥ 0.3 a
  // strong one. Annuli must fit inside the box, and the disk needs ≥ 600 points: a few
  // dozen bright dots can line up by chance.
  const NB = 7, MIN_POINTS = 600, MIN_BIN = 30;
  function spiral(sim) {
    const bh = sim.bh, rIn = 12;
    const wall = Math.min(sim.W / 2 - Math.abs(bh.x), sim.H / 2 - Math.abs(bh.y));
    const rOut = Math.min(Math.min(sim.W, sim.H) * 0.48, wall);
    const none = { score: 0, m: 0, pitch: 0, strength: 0, inDisk: 0 };
    if (rOut < rIn * 3) return none;
    const lnIn = Math.log(rIn), lnOut = Math.log(rOut);
    const bins = Array.from({ length: NB }, () => ({ w: 0, w2: 0, n: 0, re: [0, 0, 0, 0, 0], im: [0, 0, 0, 0, 0] }));
    let lSum = 0, lAbs = 0, inDisk = 0;
    for (let i = 0; i < sim.n; i++) {
      const dx = sim.x[i] - bh.x, dy = sim.y[i] - bh.y, r = Math.hypot(dx, dy);
      if (r < rIn || r > rOut) continue;
      const m = sim.m[i];
      const l = m * (dx * (sim.vy[i] - bh.vy) - dy * (sim.vx[i] - bh.vx));
      lSum += l; lAbs += Math.abs(l); inDisk++;
      const B = bins[Math.min(NB - 1, Math.floor((Math.log(r) - lnIn) / (lnOut - lnIn) * NB))];
      const th = Math.atan2(dy, dx), w = Math.sqrt(m); // √m: heavy clumps don't fake arms
      B.w += w; B.w2 += w * w; B.n++;
      for (let k = 1; k <= 4; k++) { B.re[k] += w * Math.cos(k * th); B.im[k] += w * Math.sin(k * th); }
    }
    const coherence = lAbs > 0 ? Math.abs(lSum) / lAbs : 0;
    if (coherence <= 0.6 || inDisk < MIN_POINTS) return { ...none, inDisk };
    let best = { ...none, inDisk };
    for (let k = 1; k <= 4; k++) {
      const pts = [];
      let sAmp = 0, sN = 0;
      bins.forEach((B, b) => {
        if (B.n < MIN_BIN) return;
        const amp2 = (B.re[k] ** 2 + B.im[k] ** 2) / (B.w * B.w), noise2 = B.w2 / (B.w * B.w);
        const amp = Math.sqrt(Math.max(0, amp2 - noise2));
        pts.push({ lnr: lnIn + (b + 0.5) / NB * (lnOut - lnIn), phase: Math.atan2(B.im[k], B.re[k]) / k, amp, n: B.n });
        sAmp += amp * B.n; sN += B.n;
      });
      if (pts.length < 4) continue;
      const P = 2 * Math.PI / k; // unwrap the pattern angle outward
      for (let j = 1; j < pts.length; j++) {
        while (pts[j].phase - pts[j - 1].phase > P / 2) pts[j].phase -= P;
        while (pts[j].phase - pts[j - 1].phase < -P / 2) pts[j].phase += P;
      }
      let W = 0, X = 0, Y = 0, XX = 0, XY = 0;
      for (const p of pts) { const w = p.amp * p.n; W += w; X += w * p.lnr; Y += w * p.phase; XX += w * p.lnr * p.lnr; XY += w * p.lnr * p.phase; }
      const den = W * XX - X * X;
      if (W <= 0 || Math.abs(den) < 1e-9) continue;
      const a = (W * XY - X * Y) / den, c = (Y - a * X) / W;
      let res = 0;
      for (const p of pts) { const e = p.phase - (a * p.lnr + c); res += p.amp * p.n * e * e; }
      const fit = Math.max(0, 1 - Math.sqrt(res / W) / (P / 4));
      const pitch = Math.atan(1 / Math.max(1e-6, Math.abs(a))) * 180 / Math.PI; // θ = a·ln r
      const strength = sAmp / sN;
      const score = pitch >= 8 && pitch <= 50 ? strength * fit : 0;
      if (score > best.score) best = { score, m: k, pitch, strength, inDisk };
    }
    return best;
  }

  // Orbiting means within the inner arena and close to a circular orbit: tangential speed
  // within 40% of the circular speed v_c, little radial motion, and bound (v < √2·v_c).
  // v_c² = GM/r from the hole, plus the dark halo's v_h²·r²/(r² + r_c²) once it has
  // gathered (galaxy.js). Drifting gas that merely hasn't escaped doesn't count.
  function measure(sim) {
    const bh = sim.bh, GM = sim.k.G * bh.m, g = sim.gal;
    const vh2 = g ? g.vh * g.vh * g.on : 0, rc2 = g ? g.rc * g.rc : 1;
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
      if (r < 1) continue;
      const vc2 = GM / Math.sqrt(r * r + 4) + vh2 * r * r / (r * r + rc2);
      if (v2 >= 2 * vc2) continue;
      const l = dx * dvy - dy * dvx;
      const vt = Math.abs(l) / r, vr = Math.abs(dx * dvx + dy * dvy) / r, vc = Math.sqrt(vc2);
      if (vt < 0.6 * vc || vt > 1.4 * vc || vr > 0.45 * vc) continue;
      if (k === STAR) orbitingStars++; else { orbiting++; orbitingMass += m; }
      lSum += m * l; lAbs += m * Math.abs(l);
    }
    return {
      orbiting, orbitingMass, orbitingStars, stars, bodies, biggest,
      coherence: lAbs > 0 ? Math.abs(lSum) / lAbs : 0,
      spin: Math.sign(lSum) || 1,
      halo: sim.gal ? sim.gal.on : 0,
      spiral: spiral(sim),
    };
  }

  // Hubble's spiral types follow how tightly the arms wind: Sb tight, Sc open, Sd loose.
  function hubbleType(pitch) { return pitch < 26 ? 'Sb' : pitch < 36 ? 'Sc' : 'Sd'; }

  // Name the structure you built, for the archive.
  function classify(sim, m) {
    const s = m.spiral;
    if (s && s.score >= 0.12) {
      const arms = s.score < 0.18 ? 'Flocculent Spiral'
        : s.m === 2 ? (s.score >= 0.3 ? 'Grand-Design Spiral' : 'Two-Armed Spiral')
          : s.m === 3 ? 'Three-Armed Spiral' : s.m === 4 ? 'Four-Armed Spiral' : 'Lopsided Spiral';
      return `${arms} (${hubbleType(s.pitch)})`;
    }
    if (m.halo > 0.5 && m.stars >= 100) return 'Young Disk Galaxy';
    if (m.orbitingStars >= 5 && m.orbitingMass >= 200) return 'Galactic Nucleus';
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
  MOTE.hubbleType = hubbleType;
})(typeof window !== 'undefined' ? window.MOTE : globalThis.MOTE);
