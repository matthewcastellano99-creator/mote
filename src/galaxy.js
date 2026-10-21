// The galaxy layer: every level ends as a spiral galaxy centred on the player's hole,
// built from thousands of small stars plus gas, so the arms are traced by many points
// instead of a few giant clumps, and with mass conserved. Loaded after sim.js and
// level.js, it extends their Sim and generateLevel in place (it began as a drop-in
// experiment, which is why it wraps rather than edits them).
//
// Early play is sim.js as written: dust self-gravitates (Barnes–Hut), slow collisions stick
// into clumps, the hole feeds (Eddington-limited light pushes gas), tides shred inside
// the Roche limit, and a clump past the Jeans mass ignites. What this layer changes:
//
//  (1) Embedded clusters. An igniting clump fragments ENTIRELY into ~M/1.5 collisionless
//      star particles (masses in motes; Salpeter IMF, 0.6..10, rescaled so mass and
//      momentum are exactly the clump's), with a little velocity dispersion. In the
//      galaxy the clump was a cloud complex sheared along its orbit, so the cluster is
//      laid out as a short arc of that orbit. Lifetimes keep t = tau·(m/m_unit)^-2.5
//      with the mass unit retuned to cluster stars (m_unit = 1.75 motes): massive
//      members live seconds to tens of seconds and go supernova (the base supernova,
//      returning gas), 1.5-mote stars outlive the level. Young massive stars therefore
//      sit where clusters are born: in the arms.
//  (2) The galaxy (density-wave mechanism of the earlier prototype, retuned). Once the
//      hole has fed to 2.5–3.2 M0 a cored dark halo centred on it switches on (circular
//      speed ∝ M^1/4 from M–σ, size ∝ M^1/2), gas settles toward circular orbits in the
//      disk's spin sense, and a rigidly rotating logarithmic spiral potential (m arms and
//      pitch from level constants and the hole's mass) organises gas and stars: 3–6
//      arms, wound tightly at 10–18° (the potential's pitch; the arms you see wind a
//      little tighter still). The halo core is (1 − 1/m)·R_CR so the whole disk lies
//      between the Lindblad resonances.
//      Inside the disk the Jeans mass drops with surface density (M_J ∝ Σ^-1/2), so gas
//      piled into the arms makes many modest clusters, not a few giants.
//  (3) Mass is conserved. Nothing is deleted except what the hole eats. The hole stops
//      growing at M_cap (chosen per level so the η radiated on the way stays ≲ 5% of the
//      box, and so the horizon stays ≲ 15); anything crossing the horizon beyond that is
//      blown back out as gas (an accretion-disk wind), not radiated. sim.js's own
//      leaks are closed too: arrays grow instead of overflowing on spawns.
//  (4) Resolution. The box holds the same mass at any resolution (level.js), so with
//      three motes per unit of mass every piece that splits off (cluster stars, supernova
//      shells, tidal debris, the wind) comes in three times as many, lighter pieces:
//      ~4500 points trace the arms.
//  (5) Speed. Barnes–Hut is rebuilt as a bucketed quadtree walked once per leaf (far
//      field as a local Taylor expansion), refreshed every 3 steps for gas and every 6
//      for stars; the hole's pull stays exact every step.
//
// Departures from reality, on purpose: the dark halo and the spiral potential are
// imposed, not self-consistent; gas AND stars feel a "settling" friction toward circular
// orbits with their own angular momentum, balanced by Langevin thermostats that hold
// Toomre Q ≈ 1.2 (cold, so the arms stay crisp) — a stand-in for dissipation, feedback and
// disk heating; star particles are softened at 30 (they are a collisionless fluid, not
// stars), so clusters dissolve instead of staying bound; stars beyond corotation are still
// settled gently, so the disk keeps a clean edge instead of shedding them; and once the
// galaxy has formed, an unsteered hole is held at rest by dynamical friction and drifts
// slowly to the middle of the box, so the walls don't clip its galaxy.
(function (MOTE) {
  'use strict';

  const { DUST, BODY, STAR } = MOTE.KIND;
  const P = MOTE.Sim.prototype;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const radiusFor = (m, kind) => (kind === STAR ? 1.1 : 0.9) * Math.cbrt(m);
  // The disk reaches four scale lengths out, or as far as the box allows.
  const diskEdge = (h, W, H) => Math.min(4 * h, Math.min(W, H) * 0.44);
  // A galactic year: the Milky Way's spiral pattern turns once in about 230 million
  // years (Ω_p ≈ 25–28 km/s/kpc), and the Sun, close to corotation, orbits in about the
  // same time.
  const GALACTIC_YEAR = 230e6;
  // The galaxy's character, chosen by sweeping these against the spiral-arm score and how
  // much of the disk stays put when the player sits still: 3–6 arms (from the halo-to-disk
  // mass ratio), arms wound at 10–18°, strong arm forcing, a cold disk, gentle settling
  // beyond corotation and the galaxy's edge, and a slow drift to the middle of the box.
  const T = {
    armDiv: 3, armMin: 3, armMax: 6, armLo: 0.26, armHi: 0.36,
    pitchOpen: 0, pitchLo: 10, pitchHi: 18,
    Qgas: 1.2, Qstar: 1.2, sigStar: 1.2, sigGasF: 0.8,
    outerStar: 0.35, outerLen: 60, center: 0.03,
  };

  // ================================================================ level constants
  const generate = MOTE.generateLevel;
  MOTE.generateLevel = function (number, seed, aspect) {
    const level = generate(number, seed, aspect);
    const k = level.constants;
    // A separate random stream, so the level's other draws are unchanged.
    const r = MOTE.rng((seed * 7919 + number * 104729 + 17) >>> 0);
    const between = (a, b) => a + (b - a) * r();
    // Stars and clusters.
    const mote = k.mote || 1;         // star particles scale with the motes they form from
    k.mStar = 1.5 * mote;             // mean mass of a cluster star
    k.imf = [0.6 * mote, 10 * mote, 2.35]; // Salpeter IMF: m_min, m_max, slope
    k.mUnit = 1.75 * mote;            // lifetime t = tau·(m/m_unit)^-2.5 for cluster stars
    k.sigmaCl = between(2, 3.5);      // birth velocity dispersion of a cluster
    k.epsStar = 30;                   // softening seen by star particles (~ their spacing)
    k.arcLen = 3;                     // cluster birth arc half-length, in units of sqrt(M)
    k.rTaper = 20;                    // the spiral fades inside max(rTaper, fTaper·r_core)
    k.fTaper = 0.5;
    k.fJmin = 0.2;                    // disk Jeans mass M_J·(Σ_box/Σ)^1/2, clamped to
    k.fJmax = 0.5;                    //   [fJmin, fJmax]·M_J (the disk is colder and denser)
    k.gEvery = 3;                     // steps between Barnes–Hut refreshes
    k.theta = 0.8;                    // Barnes–Hut opening angle
    k.leaf = 10;                      // particles per tree leaf
    // The hole stops growing at M_cap: no further than its horizon can reach into the
    // disk, and no further than radiating η of what it ate costs ~4.5% of the box.
    const rs0 = 2 * k.G * k.M0 / (k.c * k.c);
    const boxMass = level.count * mote;
    k.Mcap = clamp(Math.min(k.M0 * 15 / rs0, k.M0 + 0.045 * boxMass * (1 - k.eta) / k.eta), 3.5 * k.M0, 6 * k.M0);
    // Mass goals beyond M_cap would be unreachable: they now ask for most of M_cap.
    for (const goal of level.goals) if (goal.type === 'mass') goal.target = Math.min(goal.target, Math.floor(0.95 * k.Mcap / 10) * 10);
    // Galaxy.
    k.vHalo = between(22, 30);        // halo circular speed when the hole is 3·M0
    k.hDisk = 50;                     // disk scale length when the hole is 3·M0
    k.armF = between(T.armLo, T.armHi); // spiral force / axisymmetric force
    // Swing amplification sets the arm count: m grows with the halo-to-disk mass ratio.
    const Mhalo = k.vHalo * k.vHalo * 3 * k.hDisk / k.G, Mdisk = 0.6 * boxMass;
    k.arms = clamp(Math.round(Mhalo / (T.armDiv * Mdisk)), T.armMin, T.armMax);
    // Corotation near the disk's edge, and a halo core r_c = (1 − 1/m)·R_CR: inside it the
    // rotation is nearly solid-body at Ω_c = Ω_p/(1 − 1/m), so ν = m(Ω − Ω_p)/κ ≈ 1/2 and
    // the whole disk sits between the Lindblad resonances (|ν| < 1): the forced response
    // is a smooth log spiral from the nucleus to the edge, with no ring at an ILR.
    k.fCR = between(0.92, 1.08);      // corotation radius / disk radius
    // Cosmic time. The galaxy is a scale model of the Milky Way: its arms turn once every
    // 2π·R_CR / v_h (when it forms, at 3·M0), and that turn is this universe's galactic
    // year, so it sets how many years each second of play stands for.
    k.tGal = 2 * Math.PI * k.fCR * diskEdge(k.hDisk, level.W, level.H) / k.vHalo;
    k.yearsPerSec = GALACTIC_YEAR / k.tGal;
    k.pitchOff = between(-7, 7);      // pitch-angle offset from the disk's self-gravity (deg)
    k.cCore = 1 - 1 / k.arms;         // r_core / R_CR
    k.fCav = 1.2;                     // the hole's feedback keeps gas out of fCav·r_s + 2
    k.sigmaGas = T.sigGasF * k.sigma; // thermal floor on the random speed of disk gas
    k.Qgas = T.Qgas;                  // Toomre Q that feedback-driven turbulence maintains
    k.nuDisk = 0.2;                   // gas settling rate once the disk has formed (1/s)
    k.nuStar = 0.1;                   // dynamical friction of stars against the disk (1/s)
    k.starJ = 1;                      // stars settle toward their birth angular momentum
    k.Qstar = T.Qstar;                // Toomre Q the stellar disk is held at
    k.sigmaStar = T.sigStar;          // floor on the stars' random speed
    return level;
  };

  // ================================================================ storage
  // Extra per-particle arrays: gx, gy = cached self-gravity; rt = the radius whose
  // circular angular momentum a gas parcel carries (set when the galaxy catches it).
  const F64 = ['x', 'y', 'vx', 'vy', 'ax', 'ay', 'm', 'r', 'age', 'gx', 'gy', 'rt'];
  function grow(sim, cap) {
    for (const key of F64) { const a = new Float64Array(cap); if (sim[key]) a.set(sim[key].subarray(0, Math.min(cap, sim[key].length))); sim[key] = a; }
    for (const [key, T] of [['kind', Uint8Array], ['dead', Uint8Array], ['next', Int32Array]]) {
      const a = new T(cap); a.set(sim[key].subarray(0, Math.min(cap, sim[key].length))); sim[key] = a;
    }
    sim.cap = cap;
  }
  function room(sim, extra) { if (sim.n + extra > sim.cap) grow(sim, Math.ceil((sim.n + extra) * 1.3)); }
  P.allocTree = function () {}; // sim.js's tree is replaced below

  const seed = P.seed;
  P.seed = function (s) {
    seed.call(this, s);
    grow(this, Math.round(this.cap * 1.3));
    this._rand = MOTE.rng((s * 2654435761 + 977) >>> 0);
  };

  P.compact = function () {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i]) continue;
      if (w !== i) {
        this.x[w] = this.x[i]; this.y[w] = this.y[i];
        this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
        this.m[w] = this.m[i]; this.r[w] = this.r[i];
        this.kind[w] = this.kind[i]; this.age[w] = this.age[i];
        this.gx[w] = this.gx[i]; this.gy[w] = this.gy[i]; this.rt[w] = this.rt[i];
      }
      this.dead[w] = 0;
      w++;
    }
    this.n = w;
  };

  // New particles split off particle i inherit its cached field and orbit.
  function inherit(sim, i, from) {
    for (let j = from; j < sim.n; j++) { sim.gx[j] = sim.gx[i]; sim.gy[j] = sim.gy[i]; sim.rt[j] = sim.rt[i]; }
  }
  const shred = P.shred;
  P.shred = function (i, dx, dy) { room(this, Math.round(this.m[i] / (this.k.mote || 1)) + 4); const n0 = this.n; shred.call(this, i, dx, dy); inherit(this, i, n0); };
  const supernova = P.supernova;
  P.supernova = function (i) { room(this, Math.round(170 / (this.k.mote || 1))); const n0 = this.n; supernova.call(this, i); inherit(this, i, n0); };

  // ================================================================ gravity
  // Barnes–Hut on a bucketed quadtree (leaves of <= k.leaf particles), built by in-place
  // partitioning. Each leaf walks the tree once: accepted cells are summed as a local
  // Taylor expansion (field + tidal tensor) about the leaf, the rest directly.
  function treeAlloc(cap, nodes) {
    return {
      N: nodes, idx: new Int32Array(cap),
      cx: new Float64Array(nodes), cy: new Float64Array(nodes), h: new Float64Array(nodes),
      m: new Float64Array(nodes), mx: new Float64Array(nodes), my: new Float64Array(nodes),
      s: new Int32Array(nodes), e: new Int32Array(nodes), c: new Int32Array(nodes),
      count: 0, stack: new Int32Array(8192), mode: new Uint8Array(8192), near: new Int32Array(cap), nearS: new Int32Array(cap),
    };
  }
  function treeGrow(T) {
    const N = T.N * 2;
    for (const key of ['cx', 'cy', 'h', 'm', 'mx', 'my']) { const a = new Float64Array(N); a.set(T[key]); T[key] = a; }
    for (const key of ['s', 'e', 'c']) { const a = new Int32Array(N); a.set(T[key]); T[key] = a; }
    T.N = N;
  }
  function buildTree(sim) {
    const n = sim.n, X = sim.x, Y = sim.y, M = sim.m;
    let T = sim._T;
    if (!T || T.idx.length < n) T = sim._T = treeAlloc(sim.cap, Math.max(1024, sim.cap));
    const idx = T.idx;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      idx[i] = i; const x = X[i], y = Y[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    T.count = 1; T.cx[0] = (x0 + x1) / 2; T.cy[0] = (y0 + y1) / 2;
    T.h[0] = Math.max(x1 - x0, y1 - y0) / 2 + 1e-3; T.s[0] = 0; T.e[0] = n; T.c[0] = -1;
    const st = T.stack; let sp = 0; st[sp++] = 0;
    while (sp > 0) {
      const k = st[--sp], s = T.s[k], e = T.e[k];
      if (e - s <= sim.k.leaf || T.h[k] < 0.05) { T.c[k] = -1; continue; }
      const cx = T.cx[k], cy = T.cy[k], h2 = T.h[k] / 2;
      let a = s, b = e - 1;
      while (a <= b) { if (Y[idx[a]] < cy) a++; else { const t = idx[a]; idx[a] = idx[b]; idx[b] = t; b--; } }
      const mid = a;
      a = s; b = mid - 1;
      while (a <= b) { if (X[idx[a]] < cx) a++; else { const t = idx[a]; idx[a] = idx[b]; idx[b] = t; b--; } }
      const q1 = a;
      a = mid; b = e - 1;
      while (a <= b) { if (X[idx[a]] < cx) a++; else { const t = idx[a]; idx[a] = idx[b]; idx[b] = t; b--; } }
      const q3 = a;
      if (T.count + 4 > T.N) treeGrow(T);
      const f = T.count; T.count += 4; T.c[k] = f;
      T.s[f] = s; T.e[f] = q1; T.s[f + 1] = q1; T.e[f + 1] = mid;
      T.s[f + 2] = mid; T.e[f + 2] = q3; T.s[f + 3] = q3; T.e[f + 3] = e;
      for (let q = 0; q < 4; q++) {
        const ch = f + q;
        T.cx[ch] = cx + ((q & 1) ? h2 : -h2); T.cy[ch] = cy + ((q & 2) ? h2 : -h2); T.h[ch] = h2; T.c[ch] = -1;
        if (T.e[ch] > T.s[ch]) st[sp++] = ch;
      }
    }
    for (let k = T.count - 1; k >= 0; k--) { // children always come after their parent
      let m = 0, mx = 0, my = 0;
      if (T.c[k] === -1) {
        for (let p = T.s[k]; p < T.e[k]; p++) { const i = idx[p], mi = M[i]; m += mi; mx += mi * X[i]; my += mi * Y[i]; }
      } else {
        for (let ch = T.c[k]; ch < T.c[k] + 4; ch++) { const mc = T.m[ch]; m += mc; mx += mc * T.mx[ch]; my += mc * T.my[ch]; }
      }
      T.m[k] = m;
      if (m > 0) { T.mx[k] = mx / m; T.my[k] = my / m; } else { T.mx[k] = T.cx[k]; T.my[k] = T.cy[k]; }
    }
  }
  // Each leaf walks the tree once. Gas targets (softening 2, as in sim.js) open
  // cells by size/distance < θ; star targets, softened at epsStar, use the softened
  // distance √(d² + ε²), so for them nearby small cells are taken whole. A cell accepted
  // for one kind keeps being opened for the other.
  const GAS_T = 1, STAR_T = 2;
  function selfGravity(sim) {
    buildTree(sim);
    // Star targets (smooth, softened field) are refreshed on every other pass.
    const starsToo = sim._gStars = !sim._gStars || !sim._gPass;
    sim._gPass = !sim._gPass;
    const T = sim._T, idx = T.idx, st = T.stack, md = T.mode, nearG = T.near, nearS = T.nearS;
    const TC = T.c, TS = T.s, TE = T.e, TM = T.m, TMX = T.mx, TMY = T.my, TH = T.h, TCX = T.cx, TCY = T.cy, count = T.count;
    const X = sim.x, Y = sim.y, M = sim.m, kind = sim.kind, GX = sim.gx, GY = sim.gy;
    const G = sim.k.G, th2 = sim.k.theta * sim.k.theta, eps2 = 4, epsS2 = sim.k.epsStar * sim.k.epsStar;
    for (let L = 0; L < count; L++) {
      if (TC[L] !== -1) continue;
      const s0 = TS[L], e0 = TE[L];
      if (e0 <= s0) continue;
      let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity, want = 0;
      for (let p = s0; p < e0; p++) {
        const i = idx[p], x = X[i], y = Y[i];
        if (kind[i] === STAR) { if (!starsToo) continue; want |= STAR_T; } else want |= GAS_T;
        if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
      }
      const qx = (gx0 + gx1) / 2, qy = (gy0 + gy1) / 2, lx = TCX[L], ly = TCY[L];
      let a0x = 0, a0y = 0, jxx = 0, jxy = 0, jyy = 0, b0x = 0, b0y = 0, kxx = 0, kxy = 0, kyy = 0;
      let ng = 0, ns = 0, sp = 0;
      st[sp] = 0; md[sp++] = want;
      while (sp > 0) {
        const k = st[--sp], mode = md[sp], m = TM[k];
        if (m === 0) continue;
        const mx = TMX[k], my = TMY[k], h = TH[k];
        const dx = mx < gx0 ? gx0 - mx : mx > gx1 ? mx - gx1 : 0;
        const dy = my < gy0 ? gy0 - my : my > gy1 ? my - gy1 : 0;
        let rest = mode;
        if (!(Math.abs(lx - TCX[k]) < h && Math.abs(ly - TCY[k]) < h)) { // not L or an ancestor
          const d2 = dx * dx + dy * dy, size2 = 4 * h * h, ux = mx - qx, uy = my - qy, u2 = ux * ux + uy * uy;
          if ((mode & GAS_T) && size2 < th2 * d2) {
            const r2 = u2 + eps2, inv = 1 / Math.sqrt(r2), i3 = m * inv * inv * inv, i5 = 3 * i3 / r2;
            a0x += i3 * ux; a0y += i3 * uy; jxx += i5 * ux * ux - i3; jyy += i5 * uy * uy - i3; jxy += i5 * ux * uy;
            rest &= ~GAS_T;
          }
          if ((mode & STAR_T) && size2 < th2 * (d2 + epsS2)) {
            const r2 = u2 + epsS2, inv = 1 / Math.sqrt(r2), i3 = m * inv * inv * inv, i5 = 3 * i3 / r2;
            b0x += i3 * ux; b0y += i3 * uy; kxx += i5 * ux * ux - i3; kyy += i5 * uy * uy - i3; kxy += i5 * ux * uy;
            rest &= ~STAR_T;
          }
        }
        if (rest === 0) continue;
        if (TC[k] === -1) {
          if (rest & GAS_T) for (let p = TS[k]; p < TE[k]; p++) nearG[ng++] = idx[p];
          if (rest & STAR_T) for (let p = TS[k]; p < TE[k]; p++) nearS[ns++] = idx[p];
        } else {
          const f = TC[k];
          st[sp] = f; md[sp++] = rest; st[sp] = f + 1; md[sp++] = rest;
          st[sp] = f + 2; md[sp++] = rest; st[sp] = f + 3; md[sp++] = rest;
        }
      }
      if (want === 0) continue;
      for (let p = s0; p < e0; p++) {
        const i = idx[p], xi = X[i], yi = Y[i], ox = xi - qx, oy = yi - qy;
        const star = kind[i] === STAR;
        if (star && !starsToo) continue;
        const near = star ? nearS : nearG, nn = star ? ns : ng, e2 = star ? epsS2 : eps2;
        let ax = star ? b0x + kxx * ox + kxy * oy : a0x + jxx * ox + jxy * oy;
        let ay = star ? b0y + kxy * ox + kyy * oy : a0y + jxy * ox + jyy * oy;
        for (let q = 0; q < nn; q++) {
          const j = near[q];
          if (j === i) continue;
          const dx = X[j] - xi, dy = Y[j] - yi, inv = 1 / Math.sqrt(dx * dx + dy * dy + e2);
          const f = M[j] * inv * inv * inv;
          ax += f * dx; ay += f * dy;
        }
        GX[i] = G * ax; GY[i] = G * ay;
      }
    }
  }

  P.buildTree = function () {
    this._gdue = !(this._gtick > 0) || !this.gx;
    this._gtick = this._gdue ? this.k.gEvery - 1 : this._gtick - 1;
  };
  // F = G·m₁m₂ / r², softened: the matter's own field (refreshed every gEvery steps) plus
  // the black hole, exact every step, with the hole pulled back by everything.
  P.gravity = function () {
    if (this._gdue) selfGravity(this);
    const G = this.k.G, n = this.n, bh = this.bh, GM = G * bh.m, X = this.x, Y = this.y;
    const GX = this.gx, GY = this.gy, AX = this.ax, AY = this.ay, M = this.m;
    let bax = 0, bay = 0;
    for (let i = 0; i < n; i++) {
      const dx = bh.x - X[i], dy = bh.y - Y[i];
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 4), inv3 = inv * inv * inv;
      AX[i] = GX[i] + GM * inv3 * dx; AY[i] = GY[i] + GM * inv3 * dy;
      bax -= M[i] * inv3 * dx; bay -= M[i] * inv3 * dy;
    }
    bh.ax = G * bax; bh.ay = G * bay;
  };

  // ================================================================ stars
  // Jeans collapse makes an embedded cluster: the whole clump fragments into stars.
  const masses = [];
  function igniteCluster(sim, i) {
    const k = sim.k, rand = sim._rand || Math.random, Mc = sim.m[i];
    const N = Math.max(1, Math.round(Mc / k.mStar));
    room(sim, N);
    const [lo, hi, alpha] = k.imf, a1 = Math.pow(lo, 1 - alpha), b1 = Math.pow(hi, 1 - alpha);
    let sum = 0;
    for (let j = 0; j < N; j++) { const m = Math.pow(a1 + rand() * (b1 - a1), 1 / (1 - alpha)); masses[j] = m; sum += m; }
    const x0 = sim.x[i], y0 = sim.y[i], vx0 = sim.vx[i], vy0 = sim.vy[i], gx = sim.gx[i], gy = sim.gy[i], rt = sim.rt[i];
    const Rc = Math.max(2, 2 * sim.r[i]), sig = k.sigmaCl, g = sim.gal, bh = sim.bh;
    // In the galaxy the clump was a cloud complex sheared along its orbit: the cluster is
    // born as an arc of that orbit (each star moving along it), which shear then stretches.
    const ex = x0 - bh.x, ey = y0 - bh.y, er = Math.hypot(ex, ey) || 1;
    const arc = g && g.on > 0.5 ? Math.min(0.6, k.arcLen * Math.sqrt(Mc) / er) : 0;
    const ids = [];
    let mx = 0, my = 0, px = 0, py = 0;
    for (let j = 0; j < N; j++) {
      const id = j === 0 ? i : sim.n++;
      const m = masses[j] * Mc / sum;
      const g1 = Math.sqrt(-2 * Math.log(1 - rand())), g2 = 2 * Math.PI * rand();
      let dx, dy, dvx = sig * g1 * Math.cos(g2), dvy = sig * g1 * Math.sin(g2);
      if (arc > 0) {
        const phi = arc * (2 * rand() - 1), c = Math.cos(phi), s = Math.sin(phi);
        const f = 1 + Rc * (rand() + rand() - 1) / er;
        dx = (ex * c - ey * s) * f - ex; dy = (ex * s + ey * c) * f - ey;
        const ux = vx0 - bh.vx, uy = vy0 - bh.vy;
        dvx += ux * c - uy * s - ux; dvy += ux * s + uy * c - uy;
      } else {
        const rr = Rc * Math.sqrt(rand()), a = 2 * Math.PI * rand();
        dx = rr * Math.cos(a); dy = rr * Math.sin(a);
      }
      sim.x[id] = dx; sim.y[id] = dy; sim.vx[id] = dvx; sim.vy[id] = dvy;
      sim.m[id] = m; sim.kind[id] = STAR; sim.r[id] = radiusFor(m, STAR); sim.age[id] = 0; sim.dead[id] = 0;
      sim.gx[id] = gx; sim.gy[id] = gy; sim.rt[id] = rt;
      mx += m * dx; my += m * dy; px += m * dvx; py += m * dvy;
      ids.push(id);
    }
    // Centre of mass and momentum are those of the clump.
    mx /= Mc; my /= Mc; px /= Mc; py /= Mc;
    for (const id of ids) { sim.x[id] += x0 - mx; sim.y[id] += y0 - my; sim.vx[id] += vx0 - px; sim.vy[id] += vy0 - py; }
    sim.stats.starsFormed++;
    sim.events.push({ type: 'ignite', x: x0, y: y0, m: Mc, cluster: N });
  }

  // The Jeans mass falls with density, M_J ∝ T^3/2 ρ^-1/2: in the galaxy, where the
  // surface density Σ(r) is well above the box's mean, clumps collapse at
  // M_J·(Σ_box/Σ)^1/2, so the disk makes many modest clusters instead of a few giants.
  function jeansMass(sim, i) {
    const g = sim.gal, k = sim.k, prof = sim._sigma;
    if (!g || g.on <= 0 || !prof) return k.MJ;
    const r = Math.hypot(sim.x[i] - sim.bh.x, sim.y[i] - sim.bh.y);
    if (r > g.R) return k.MJ; // still falling in: the box's Jeans mass
    const b = Math.min(prof.length - 1, Math.floor(r / sim._sigDr));
    const f = clamp(Math.sqrt(sim._sigmaBox / Math.max(1e-9, prof[b])), k.fJmin, k.fJmax);
    return k.MJ * (1 - g.on + g.on * f);
  }

  // Stellar evolution: clusters at the Jeans mass; lifetimes t = tau·(m/m_unit)^-2.5.
  P.evolve = function (dt) {
    const k = this.k, n = this.n, life = k.tau, unit = k.mUnit, tick = (this._evTick = ((this._evTick || 0) + 1) & 7);
    for (let i = 0; i < n; i++) {
      const kind = this.kind[i];
      if (kind === BODY && this.m[i] >= k.fJmin * k.MJ && this.m[i] >= jeansMass(this, i)) igniteCluster(this, i);
      else if (kind === STAR) {
        this.age[i] += dt;
        // (checked every 8th step per star: lifetimes are seconds or longer)
        if ((i & 7) === tick && this.age[i] > life * Math.pow(this.m[i] / unit, -2.5)) this.supernova(i);
      }
    }
  };

  // ================================================================ the hole
  // Growth stops at M_cap. What crosses the horizon past that is blown back out as gas
  // (an accretion-disk wind) instead of radiated, so no mass is lost beyond η of what
  // the hole actually keeps.
  const feed = P.feed;
  P.feed = function (dt) {
    const bh = this.bh, k = this.k;
    const gained = feed.call(this, dt);
    const over = bh.m - k.Mcap;
    if (over <= 0) return gained;
    bh.m = k.Mcap;
    blowOut(this, over / (1 - k.eta));
    return gained - over;
  };
  function blowOut(sim, mass) {
    const count = Math.max(1, Math.round(mass / (1.2 * (sim.k.mote || 1)))), mp = mass / count, bh = sim.bh, g = sim.gal;
    const rand = sim._rand || Math.random, rs = sim.horizon(), spin = g && g.spin ? g.spin : 1;
    room(sim, count);
    for (let c = 0; c < count; c++) {
      const j = sim.n++, a = 2 * Math.PI * rand(), d = 2.5 * rs + 4 + 4 * rand();
      const v = Math.sqrt(sim.k.G * bh.m / d), out = 0.4 * v;
      sim.x[j] = bh.x + d * Math.cos(a); sim.y[j] = bh.y + d * Math.sin(a);
      sim.vx[j] = bh.vx + Math.cos(a) * out - spin * Math.sin(a) * v;
      sim.vy[j] = bh.vy + Math.sin(a) * out + spin * Math.cos(a) * v;
      sim.m[j] = mp; sim.kind[j] = DUST; sim.r[j] = radiusFor(mp, DUST); sim.age[j] = 0; sim.dead[j] = 0;
      sim.gx[j] = 0; sim.gy[j] = 0; sim.rt[j] = 0;
    }
    if (!(sim.time - sim._windT < 1)) { sim._windT = sim.time; sim.events.push({ type: 'wind', x: bh.x, y: bh.y, m: mass }); }
  }

  // ================================================================ galaxy
  function update(sim, dt) {
    const k = sim.k, bh = sim.bh;
    const g = sim.gal || (sim.gal = { on: 0, amp: 0, spin: 0, L: 0, coh: 0, phase: 0, nu: 0.8 });
    const mu = bh.m / (3 * k.M0);
    g.on = Math.max(g.on, smooth(2.5 * k.M0, Math.min(3.2 * k.M0, k.Mcap), bh.m));
    g.vh = k.vHalo * Math.pow(mu, 0.25);                                   // M–σ
    g.h = k.hDisk * Math.sqrt(mu);                                         // ∝ GM/σ²
    g.R = diskEdge(g.h, sim.W, sim.H);
    g.Rcr = k.fCR * g.R;
    g.omegaP = g.vh / g.Rcr;
    g.rc = k.cCore * g.Rcr;
    // Shear at corotation sets the pitch, tan i ≈ (2/7)·√(4 − 2Γ)/Γ with Γ = −dlnΩ/dlnr
    // (Michikoshi & Kokubo 2014); the disk's own weight opens or closes it by a few
    // degrees (pitchOff), and heavier holes wind their arms tighter (Seigar et al. 2008).
    // The arms we see wind a little tighter than the potential that drives them.
    const x2 = g.Rcr * g.Rcr, fH = g.vh * g.vh * x2 / (x2 + g.rc * g.rc), fK = k.G * bh.m / g.Rcr;
    const Gam = 1 - 0.5 * (fH * 2 * g.rc * g.rc / (x2 + g.rc * g.rc) - fK) / (fH + fK);
    g.pitch = clamp(Math.atan((2 / 7) * Math.sqrt(4 - 2 * Gam) / Gam) / DEG + T.pitchOpen + k.pitchOff - 16 * Math.log10(mu), T.pitchLo, T.pitchHi);
    if (g.spin) g.phase += g.spin * g.omegaP * dt;
    g.nu = 0.8 - (0.8 - k.nuDisk) * g.amp;
    g.rcav = k.fCav * sim.horizon() + 2;
    g.amp += (g.on * smooth(0.5, 0.85, g.coh) - g.amp) * Math.min(1, dt / 15);
  }

  // A radius drawn from an exponential disk of scale h.
  function diskRadius(sim, g) {
    const rand = sim._rand || Math.random, h = g.h, r0 = Math.max(10, 1.25 * g.rcav);
    for (let t = 0; t < 8; t++) {
      const r = -h * Math.log((1 - rand()) * (1 - rand()));
      if (r >= r0 && r <= g.R) return r;
    }
    return r0 + (g.R - r0) * rand();
  }

  const NB = 32;
  // Slow, pattern-scale quantities, refreshed with the gravity tree: the radial mass
  // profile, the galaxy's bulk velocity and spin, Toomre-regulated turbulence, a table
  // of the circular speed, and the spiral's force (folded into the cached field gx, gy).
  function galaxyRefresh(sim) {
    const g = sim.gal, k = sim.k, bh = sim.bh, n = sim.n, G = k.G, GM = G * bh.m;
    const vh2 = g.vh * g.vh * g.on, rc2 = g.rc * g.rc, R = g.R;
    const X = sim.x, Y = sim.y, VX = sim.vx, VY = sim.vy, M = sim.m;
    const dr = R * 1.3 / NB;
    const menc = sim._menc || (sim._menc = new Float64Array(NB + 2));
    menc.fill(0);
    let Mg = 0, Px = 0, Py = 0, Lx = 0, Lab = 0;
    for (let i = 0; i < n; i++) {
      const dx = X[i] - bh.x, dy = Y[i] - bh.y, r = Math.sqrt(dx * dx + dy * dy);
      menc[Math.min(NB, Math.floor(r / dr))] += M[i];
      if (r < R) {
        Mg += M[i]; Px += M[i] * VX[i]; Py += M[i] * VY[i];
        const l = M[i] * (dx * (VY[i] - bh.vy) - dy * (VX[i] - bh.vx));
        Lx += l; Lab += Math.abs(l);
      }
    }
    for (let b = 1; b <= NB; b++) menc[b] += menc[b - 1];
    menc[NB + 1] = menc[NB];
    g.Vx = Mg > 0 ? Px / Mg : 0; g.Vy = Mg > 0 ? Py / Mg : 0;
    g.coh = Lab > 0 ? Math.abs(Lx) / Lab : 0;
    g.L += (Lx - g.L) * 0.06;
    if (!g.spin || g.amp < 0.3) g.spin = g.L >= 0 ? 1 : -1;
    // Self-regulated turbulence: σ(r) = Q·πGΣ/κ (never below the thermal floor).
    const sig = sim._sigQ || (sim._sigQ = new Float64Array(NB + 1));
    const sigS = sim._sigS || (sim._sigS = new Float64Array(NB + 1));
    const prof = sim._sigma || (sim._sigma = new Float64Array(NB + 1));
    const vct = sim._vc || (sim._vc = new Float64Array(NB + 2));
    sim._sigmaBox = menc[NB] / (sim.W * sim.H);
    const vcAt2 = (r, b) => vh2 * r * r / (r * r + rc2) + GM * r * r / ((r * r + 4) * Math.sqrt(r * r + 4)) + G * menc[b] / Math.max(r, 1);
    for (let b = 0; b <= NB + 1; b++) vct[b] = Math.sqrt(vcAt2(b * dr, Math.max(0, b - 1)));
    for (let b = 0; b <= NB; b++) {
      const r1 = b * dr, r2 = (b + 1) * dr, rm = (b + 0.5) * dr;
      const Sigma = (menc[b] - (b ? menc[b - 1] : 0)) / (Math.PI * (r2 * r2 - r1 * r1));
      prof[b] = Sigma;
      const v2a = Math.max(1e-6, vct[b] * vct[b]), v2b = vct[b + 1] * vct[b + 1];
      const v2m = 0.5 * (v2a + v2b), dlnv = 0.5 * Math.log(v2b / v2a) / Math.log(r2 / Math.max(r1, 0.5 * dr));
      const kappa = Math.sqrt(Math.max(0.1, 2 * (1 + dlnv)) * v2m) / rm;
      sig[b] = Math.min(k.Qgas * Math.PI * G * Sigma / kappa, 0.3 * Math.sqrt(v2m));
      sigS[b] = Math.max(k.sigmaStar, Math.min(k.Qstar * 3.36 * G * Sigma / kappa, 0.3 * Math.sqrt(v2m)));
    }
    sim._sigDr = dr;
    // Rigidly rotating logarithmic spiral: Φ₁ = −A·env(r)·cos ψ,
    // ψ = m(θ − Ω_p t) + (m / tan i)·ln(r / R_CR), trailing.
    const m = k.arms, tanI = Math.tan(g.pitch * DEG), wind = g.spin * m / tanI;
    const A = g.amp * k.armF * vh2 * tanI / m; // radial spiral force = armF · v²/r
    if (!(A > 0)) return;
    const rIn = Math.max(k.rTaper, k.fTaper * g.rc), rIn4 = rIn ** 4, Rout = 1.2 * R, rMax2 = (1.6 * R) ** 2;
    const lnRcr = Math.log(g.Rcr), GX = sim.gx, GY = sim.gy, AX = sim.ax, AY = sim.ay, stars = sim._gStars;
    for (let i = 0; i < n; i++) {
      const dx = X[i] - bh.x, dy = Y[i] - bh.y, r2 = dx * dx + dy * dy;
      if (r2 > rMax2 || r2 < 1 || (!stars && sim.kind[i] === STAR)) continue;
      const r = Math.sqrt(r2), q2 = r2 / (Rout * Rout), q4 = q2 * q2;
      const env = r2 * r2 / (r2 * r2 + rIn4) / (1 + q4 * q4);
      const psi = m * (Math.atan2(dy, dx) - g.phase) + wind * (Math.log(r) - lnRcr);
      const sn = Math.sin(psi) * A * env / r;
      const ar = -sn * wind, at = -sn * m;
      const fx = (ar * dx - at * dy) / r, fy = (ar * dy + at * dx) / r;
      GX[i] += fx; GY[i] += fy; AX[i] += fx; AY[i] += fy;
    }
  }

  // Every step: the halo's pull (exact) and settling toward circular orbits.
  function galaxyForces(sim) {
    const g = sim.gal;
    if (!g || g.on <= 0) return;
    if (sim._gdue || !sim._vc) galaxyRefresh(sim);
    const k = sim.k, bh = sim.bh, n = sim.n, G = k.G;
    const vh2 = g.vh * g.vh * g.on, rc2 = g.rc * g.rc, R = g.R, Rh = 1.6 * R;
    const aRh = vh2 * Rh / (Rh * Rh + rc2);
    const X = sim.x, Y = sim.y, VX = sim.vx, VY = sim.vy, M = sim.m, AX = sim.ax, AY = sim.ay, kind = sim.kind, RT = sim.rt;
    const vct = sim._vc, dr = sim._sigDr, idr = 1 / dr, top = NB + 1;
    const vcAt = (r) => { const f = r * idr, b = f | 0; return b >= top ? vct[top] * Math.sqrt(top * dr / r) : vct[b] + (vct[b + 1] - vct[b]) * (f - b); };
    const spin = g.spin, nu = g.nu, nuStar = 0.5 * (1 - g.amp) + k.nuStar, rcav = g.rcav, Vx = g.Vx, Vy = g.Vy;
    if (!sim._sx || sim._sx.length < sim.cap) { sim._sx = new Float64Array(sim.cap); sim._sy = new Float64Array(sim.cap); sim._sw = new Float64Array(sim.cap); }
    const sx = sim._sx, sy = sim._sy, sw = sim._sw, rCo0 = 0.7 * g.Rcr, rCo1 = 0.95 * g.Rcr;
    let Fx = 0, Fy = 0, Hx = 0, Hy = 0, Ms = 0;
    for (let i = 0; i < n; i++) {
      const dx = X[i] - bh.x, dy = Y[i] - bh.y;
      const r2 = dx * dx + dy * dy, r = Math.sqrt(r2) + 1e-6, mi = M[i];
      // Halo: cored isothermal sphere (flat rotation curve), truncated at Rh.
      const aH = (r < Rh ? vh2 / (r2 + rc2) : aRh * Rh * Rh / (r2 * r));
      let ax = -aH * dx, ay = -aH * dy;
      Hx += mi * ax; Hy += mi * ay;
      // Settling toward circular orbits (relative to the galaxy's bulk motion).
      const w = r < R ? g.on : g.on * Math.exp(-(r - R) / T.outerLen);
      sw[i] = 0;
      if (w > 0.01) {
        const dvx = VX[i] - Vx, dvy = VY[i] - Vy;
        const vr = (dx * dvx + dy * dvy) / r, vt = (dx * dvy - dy * dvx) / r;
        let ar = 0, at;
        if (kind[i] !== STAR) {
          // Each gas parcel keeps the angular momentum it brought in from the
          // protogalaxy (an exponential disk), so it settles at its own radius.
          let rt = RT[i];
          if (!(rt > 0)) { rt = diskRadius(sim, g); RT[i] = rt; }
          ar = -nu * vr; at = nu * (spin * rt * vcAt(rt) / r - vt);
          // Gas drag acts in the disk's own frame (settling), not the box's.
          ax += w * k.gamma * VX[i]; ay += w * k.gamma * VY[i];
          // Feedback from the hole keeps a small nuclear cavity open.
          if (r < rcav) {
            const v = vcAt(r), qq = r / rcav, p = 2 * v * v / r * (1 - qq * qq) / r;
            ax += p * dx; ay += p * dy;
          }
        } else {
          // Stars keep (on average) the angular momentum they were born with, so the
          // dissipative settling does not let the arms' torque drain them inward.
          const rt = k.starJ && RT[i] > 0 ? RT[i] : r;
          // Near corotation stars barely move against the pattern: full friction there
          // would sink them into the arm's potential minimum, so by 0.95·R_CR it eases to a
          // gentle fraction, enough to keep outer stars from drifting off the disk.
          const fo = T.outerStar;
          const fc = r < rCo0 ? 1 : r > rCo1 ? fo : fo + (1 - fo) * (rCo1 - r) / (rCo1 - rCo0);
          ar = -nuStar * fc * vr; at = nuStar * fc * (spin * rt * vcAt(rt) / r - vt);
        }
        sx[i] = w * (ar * dx - at * dy) / r; sy[i] = w * (ar * dy + at * dx) / r; sw[i] = w;
        Fx += mi * sx[i]; Fy += mi * sy[i]; Ms += mi * w;
      }
      AX[i] += ax; AY[i] += ay;
    }
    // Settling only moves momentum around inside the galaxy; its bulk motion is damped
    // in the frame of its massive halo.
    const fx = (Ms > 0 ? Fx / Ms : 0) + nu * Vx, fy = (Ms > 0 ? Fy / Ms : 0) + nu * Vy;
    for (let i = 0; i < n; i++) {
      const w = sw[i];
      if (w === 0) continue;
      AX[i] += sx[i] - w * fx; AY[i] += sy[i] - w * fy;
    }
    // The halo's pull on the matter pulls back on hole + halo.
    const Mh = g.on * g.vh * g.vh * R / G;
    bh.ax -= Hx / (bh.m + Mh); bh.ay -= Hy / (bh.m + Mh);
  }

  // Thermostats (Langevin kicks balancing the settling): gas keeps a random speed of at
  // least σ_gas, and turbulence holding Toomre Q ≈ Q_gas; stars are held at Q ≈ Q_star,
  // the self-regulated state of a real disk (heated by its arms and clouds, cooled by
  // forming new stars from cold gas). Warm enough not to fragment, cold enough to answer
  // the spiral potential.
  function thermalize(sim, dt) {
    const g = sim.gal, sig = sim._sigQ, sigS = sim._sigS;
    if (!g || g.on <= 0 || !sig) return;
    const k = sim.k, bh = sim.bh, R2 = g.R * g.R, c2 = g.rcav * g.rcav, rand = sim._rand || Math.random;
    const f = Math.sqrt(2 * g.nu * dt * g.on) * 1.732, floor = k.sigmaGas, nb = sig.length - 1, idr = 1 / sim._sigDr;
    const fS = Math.sqrt(2 * (0.5 * (1 - g.amp) + k.nuStar) * dt * g.on) * 1.732, rCo0 = 0.7 * g.Rcr, rCo1 = 0.95 * g.Rcr;
    for (let i = 0; i < sim.n; i++) {
      const dx = sim.x[i] - bh.x, dy = sim.y[i] - bh.y, d2 = dx * dx + dy * dy;
      if (d2 > R2 || d2 < c2) continue;
      const r = Math.sqrt(d2), b = Math.min(nb, Math.floor(r * idr));
      let s;
      if (sim.kind[i] === STAR) {
        if (r > rCo1) continue;
        s = fS * sigS[b] * (r < rCo0 ? 1 : Math.sqrt((rCo1 - r) / (rCo1 - rCo0)));
      } else s = f * Math.max(floor, sig[b]);
      sim.vx[i] += s * (2 * rand() - 1); sim.vy[i] += s * (2 * rand() - 1); // uniform, unit variance
    }
  }

  const step = P.step;
  P.step = function (dt) { update(this, dt); thermalize(this, dt); step.call(this, dt); };

  // sim.js's forces(), unchanged except that stars too faint to push gas
  // (L ≤ 2, i.e. every cluster star) skip the luminosity calculation: a pure speed-up.
  function baseForces(sim) {
    const k = sim.k, n = sim.n, bh = sim.bh;
    if (k.gamma > 0) {
      for (let i = 0; i < n; i++) {
        if (sim.kind[i] === STAR) continue;
        sim.ax[i] -= k.gamma * sim.vx[i]; sim.ay[i] -= k.gamma * sim.vy[i];
      }
    }
    const mBright = 100 * Math.pow(2 / (k.kappa * 1200), 1 / 3.5);
    for (let s = 0; s < n; s++) {
      if (sim.kind[s] !== STAR || sim.m[s] <= mBright) continue;
      const lum = Math.min(20000, k.kappa * 1200 * Math.pow(sim.m[s] / 100, 3.5));
      sim.push(sim.x[s], sim.y[s], lum, 25, 120);
    }
    bh.eddington = bh.lum / (k.lambda * bh.m);
    if (bh.eddington > 0.02) {
      const rs = sim.horizon();
      sim.push(bh.x, bh.y, bh.eddington * k.G * bh.m, 4 * rs * rs + 4, 220);
    }
    const c = sim.control;
    bh.thrusting = false;
    if (c) {
      const aMax = k.thrust * Math.sqrt(k.M0 / bh.m);
      let ax = (c.vx - bh.vx) * 5, ay = (c.vy - bh.vy) * 5;
      const a = Math.hypot(ax, ay);
      if (a > aMax) { ax *= aMax / a; ay *= aMax / a; }
      bh.ax += ax; bh.ay += ay;
      bh.thrusting = a > 1;
    }
  }
  P.forces = function () {
    // The hole sits in its massive halo: the matter tugs on hole + halo together.
    const g = this.gal;
    if (g && g.on > 0) {
      const Mh = g.on * g.vh * g.vh * g.R / this.k.G, f = this.bh.m / (this.bh.m + Mh);
      this.bh.ax *= f; this.bh.ay *= f;
    }
    baseForces(this);
    galaxyForces(this);
    // Dynamical friction: once its halo has gathered, the hole anchors a galaxy far heavier
    // than itself. Left unsteered, it coasts to rest instead of wandering off into a wall
    // and dragging its galaxy with it, and drifts slowly to the middle of the box so the
    // walls don't clip the galaxy. (Steering still works: thrust is applied above.)
    if (g && g.on > 0 && !this.control) {
      const nu = 0.6 * g.on, kc = T.center * g.on;
      this.bh.ax -= nu * this.bh.vx + kc * this.bh.x; this.bh.ay -= nu * this.bh.vy + kc * this.bh.y;
    }
  };
})(typeof window !== 'undefined' ? window.MOTE : globalThis.MOTE);
