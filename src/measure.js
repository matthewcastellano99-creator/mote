// Measuring the structure around the black hole: what orbits you, whether it has spiral
// arms, and what to call it.
(function (MOTE) {
  'use strict';

  const { STAR, BODY } = MOTE.KIND;

  // Spiral arms, measured the way astronomers measure them in galaxy images: a
  // log-spiral Fourier transform (Kalnajs 1975; Considère & Athanassoula 1988),
  //   A(m, p) = Σ w·exp(−i(m·θ + p·ln r)) / Σ w,   w = √mass,
  // over matter around the hole. A logarithmic spiral with m arms at pitch i peaks at
  // p = m / tan i. A bar or an oval peaks at p = 0, so a spiral must be clearly stronger
  // at its own winding than unwound; the disk must rotate coherently, its pitch lie
  // between 5° and 50°, and it needs ≥ 600 points. The score is the noise-corrected
  // amplitude of the best (m, p), m = 2..8: ≥ 0.12 is a spiral you can see, ≥ 0.3 a
  // strong one. Rings must fit inside the box, so walls can't fake arms.
  const NR = 64, M_MAX = 8, P_MAX = 60, P_STEP = 0.5, NP = Math.round(2 * P_MAX / P_STEP) + 1;
  const MIN_POINTS = 600;
  const re = new Float64Array((M_MAX + 1) * NR), im = new Float64Array((M_MAX + 1) * NR);
  const cosT = new Float64Array(NP * NR), sinT = new Float64Array(NP * NR);
  function spiral(sim) {
    const bh = sim.bh, rIn = 12;
    const wall = Math.min(sim.W / 2 - Math.abs(bh.x), sim.H / 2 - Math.abs(bh.y));
    const rOut = Math.min(Math.min(sim.W, sim.H) * 0.48, wall);
    const none = { score: 0, m: 0, pitch: 0, strength: 0, inDisk: 0 };
    if (rOut < rIn * 3) return none;
    const u0 = Math.log(rIn), du = (Math.log(rOut) - u0) / NR;
    re.fill(0); im.fill(0);
    let W = 0, W2 = 0, lSum = 0, lAbs = 0, inDisk = 0;
    for (let i = 0; i < sim.n; i++) {
      const dx = sim.x[i] - bh.x, dy = sim.y[i] - bh.y, r = Math.hypot(dx, dy);
      if (r < rIn || r > rOut) continue;
      const m = sim.m[i];
      const l = m * (dx * (sim.vy[i] - bh.vy) - dy * (sim.vx[i] - bh.vx));
      lSum += l; lAbs += Math.abs(l); inDisk++;
      const w = Math.sqrt(m); // √m: heavy clumps don't fake arms
      W += w; W2 += w * w;
      const k = Math.min(NR - 1, Math.floor((Math.log(r) - u0) / du));
      const c1 = dx / r, s1 = dy / r;
      let c = 1, s = 0; // e^{-imθ}, by repeated multiplication
      for (let mm = 1; mm <= M_MAX; mm++) {
        const cn = c * c1 + s * s1; s = s * c1 - c * s1; c = cn;
        re[mm * NR + k] += w * c; im[mm * NR + k] += w * s;
      }
    }
    const coherence = lAbs > 0 ? Math.abs(lSum) / lAbs : 0;
    if (coherence <= 0.6 || inDisk < MIN_POINTS) return { ...none, inDisk };
    for (let j = 0; j < NP; j++) {
      const p = -P_MAX + j * P_STEP;
      for (let k = 0; k < NR; k++) { const ph = -p * (u0 + (k + 0.5) * du); cosT[j * NR + k] = Math.cos(ph); sinT[j * NR + k] = Math.sin(ph); }
    }
    const noise2 = W2 / (W * W), j0 = Math.round(P_MAX / P_STEP);
    const amp2 = (mm, j) => {
      let ar = 0, ai = 0;
      const o = mm * NR, t = j * NR;
      for (let k = 0; k < NR; k++) {
        const r0 = re[o + k], i0 = im[o + k], cp = cosT[t + k], sp = sinT[t + k];
        ar += r0 * cp - i0 * sp; ai += r0 * sp + i0 * cp;
      }
      return (ar * ar + ai * ai) / (W * W);
    };
    let best = { ...none, inDisk };
    // From two arms up: a one-armed (m = 1) pattern is a lopsided disk, which a young
    // galaxy shows while it settles around a moving hole, not the spiral we're after.
    for (let mm = 2; mm <= M_MAX; mm++) {
      const bar2 = amp2(mm, j0);
      for (let j = 0; j < NP; j++) {
        const p = -P_MAX + j * P_STEP;
        if (Math.abs(p) < 0.5) continue;
        const a2 = amp2(mm, j);
        if (a2 < 2 * bar2) continue;
        const pitch = Math.atan(mm / Math.abs(p)) * 180 / Math.PI;
        if (pitch < 5 || pitch > 50) continue;
        const strength = Math.sqrt(Math.max(0, a2 - 6 * noise2));
        if (strength > best.score) best = { score: strength, m: mm, pitch, strength, inDisk };
      }
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
  function hubbleType(pitch) { return pitch < 13 ? 'Sa' : pitch < 20 ? 'Sb' : pitch < 28 ? 'Sc' : 'Sd'; }
  const ARMS = ['', 'Lopsided', 'Two-Armed', 'Three-Armed', 'Four-Armed', 'Five-Armed', 'Six-Armed', 'Seven-Armed', 'Eight-Armed'];

  // Name the structure you built, for the archive.
  function classify(sim, m) {
    const s = m.spiral;
    if (s && s.score >= 0.12) {
      const arms = s.score < 0.16 ? 'Flocculent Spiral'
        : s.m === 2 && s.score >= 0.3 ? 'Grand-Design Spiral' : `${ARMS[s.m]} Spiral`;
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
