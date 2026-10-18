// The physics of one level: a sealed box of dust obeying real equations with this
// level's constants, and you, a black hole, steering through it.
// Plain script so it also runs in Node.
(function (MOTE) {
  'use strict';

  const DUST = 0, BODY = 1, STAR = 2;
  const BODY_MASS = 4;     // a clump heavier than this is a body
  const SHRED_MASS = 8;    // bodies and stars this heavy can be torn apart by tides
  const EPS2 = 4;          // gravitational softening, squared
  const THETA2 = 0.7 * 0.7; // Barnes–Hut opening angle, squared
  const MAX_DEPTH = 24;
  const CELL = 6;          // collision grid cell size

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function radiusFor(m, kind) {
    return (kind === STAR ? 1.1 : 0.9) * Math.cbrt(m);
  }

  class Sim {
    constructor(level) {
      this.k = level.constants;
      this.W = level.W; this.H = level.H;
      this.alloc(level.count);
      this.time = 0;
      this.events = [];
      this.stats = { eaten: 0, starsFormed: 0, supernovae: 0, shredded: 0 };
      this.control = null; // { vx, vy } desired velocity, or null to coast
      this.evaporated = false;
      const start = level.start || { x: 0, y: 0 };
      this.bh = { x: start.x, y: start.y, vx: 0, vy: 0, ax: 0, ay: 0, m: this.k.M0, mdot: 0, lum: 0, net: 0, eddington: 0 };
      this.seed(level.seed);
    }

    alloc(cap) {
      this.cap = cap;
      this.n = 0;
      this.x = new Float64Array(cap); this.y = new Float64Array(cap);
      this.vx = new Float64Array(cap); this.vy = new Float64Array(cap);
      this.ax = new Float64Array(cap); this.ay = new Float64Array(cap);
      this.m = new Float64Array(cap); this.r = new Float64Array(cap);
      this.age = new Float64Array(cap);
      this.kind = new Uint8Array(cap);
      this.dead = new Uint8Array(cap);
      this.next = new Int32Array(cap);
      this.allocTree(cap * 4 + 64);
    }

    allocTree(size) {
      this.tCap = size;
      this.tCx = new Float64Array(size); this.tCy = new Float64Array(size);
      this.tHalf = new Float64Array(size);
      this.tMass = new Float64Array(size);
      this.tMx = new Float64Array(size); this.tMy = new Float64Array(size);
      this.tChild = new Int32Array(size);
      this.tBody = new Int32Array(size);
      this.stack = new Int32Array(size);
    }

    // Event horizon: r_s = 2GM / c².
    horizon() { return 2 * this.k.G * this.bh.m / (this.k.c * this.k.c); }

    // Roche limit for a fluid body of mass m and radius r: d = 2.44 · r · (M / m)^(1/3).
    roche(m, r) { return 2.44 * r * Math.cbrt(this.bh.m / m); }

    // A box of gas at temperature T: thermal motion plus turbulent eddies.
    seed(seed) {
      const rand = rng(seed);
      const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
      const hw = this.W / 2 - 2, hh = this.H / 2 - 2;
      const eddies = [];
      const nEddies = 6 + Math.floor(rand() * 6);
      for (let k = 0; k < nEddies; k++) {
        eddies.push({
          x: (rand() - 0.5) * this.W * 0.9, y: (rand() - 0.5) * this.H * 0.9,
          s: (rand() < 0.5 ? -1 : 1) * (3 + rand() * 5),
          w: 35 + rand() * 70,
        });
      }
      const sigma = this.k.sigma / Math.SQRT2;
      for (let i = 0; i < this.cap; i++) {
        let x, y;
        do { x = (rand() * 2 - 1) * hw; y = (rand() * 2 - 1) * hh; }
        while ((x - this.bh.x) ** 2 + (y - this.bh.y) ** 2 < 50 * 50);
        let vx = gauss() * sigma, vy = gauss() * sigma;
        for (const e of eddies) {
          const dx = x - e.x, dy = y - e.y;
          const f = e.s * Math.exp(-(dx * dx + dy * dy) / (2 * e.w * e.w));
          vx += -dy / e.w * f; vy += dx / e.w * f;
        }
        const m = 0.6 + rand() * 0.8;
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
        this.m[i] = m; this.kind[i] = DUST; this.r[i] = radiusFor(m, DUST); this.age[i] = 0;
      }
      this.n = this.cap;
    }

    // ---- Gravity: Barnes–Hut for the dust, direct sums for the black hole ----

    buildTree() {
      const n = this.n;
      if (this.tCap < n * 4 + 64) this.allocTree(n * 6 + 64);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = this.x[i], y = this.y[i];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      this.tCount = 0;
      const half = Math.max(maxX - minX, maxY - minY) / 2 + 1;
      this.newNode((minX + maxX) / 2, (minY + maxY) / 2, half);
      for (let i = 0; i < n; i++) this.insert(i);
      for (let k = 0; k < this.tCount; k++) {
        const mass = this.tMass[k];
        if (mass > 0) { this.tMx[k] /= mass; this.tMy[k] /= mass; }
      }
    }

    newNode(cx, cy, half) {
      if (this.tCount + 4 >= this.tCap) this.growTree();
      const k = this.tCount++;
      this.tCx[k] = cx; this.tCy[k] = cy; this.tHalf[k] = half;
      this.tMass[k] = 0; this.tMx[k] = 0; this.tMy[k] = 0;
      this.tChild[k] = -1; this.tBody[k] = -1;
      return k;
    }

    growTree() {
      const keep = ['tCx', 'tCy', 'tHalf', 'tMass', 'tMx', 'tMy', 'tChild', 'tBody'];
      const saved = keep.map((key) => this[key]);
      this.allocTree(this.tCap * 2);
      keep.forEach((key, idx) => this[key].set(saved[idx]));
    }

    quadrant(node, x, y) {
      return this.tChild[node] + (x >= this.tCx[node] ? 1 : 0) + (y >= this.tCy[node] ? 2 : 0);
    }

    insert(i) {
      const x = this.x[i], y = this.y[i], m = this.m[i];
      let node = 0, depth = 0;
      for (;;) {
        this.tMass[node] += m; this.tMx[node] += m * x; this.tMy[node] += m * y;
        if (this.tChild[node] === -1) {
          if (this.tBody[node] === -1) { this.tBody[node] = i; return; }
          if (depth >= MAX_DEPTH) return; // coincident: aggregate in place
          const j = this.tBody[node];
          this.tBody[node] = -1;
          const h = this.tHalf[node] / 2, cx = this.tCx[node], cy = this.tCy[node];
          const first = this.newNode(cx - h, cy - h, h);
          this.newNode(cx + h, cy - h, h);
          this.newNode(cx - h, cy + h, h);
          this.newNode(cx + h, cy + h, h);
          this.tChild[node] = first;
          const q = this.quadrant(node, this.x[j], this.y[j]);
          const mj = this.m[j];
          this.tMass[q] = mj; this.tMx[q] = mj * this.x[j]; this.tMy[q] = mj * this.y[j];
          this.tBody[q] = j;
        }
        node = this.quadrant(node, x, y);
        depth++;
      }
    }

    // F = G·m₁m₂ / r², softened.
    gravity() {
      const G = this.k.G, n = this.n, stack = this.stack, bh = this.bh;
      const GM = G * bh.m;
      let bax = 0, bay = 0;
      for (let i = 0; i < n; i++) {
        const xi = this.x[i], yi = this.y[i];
        let ax = 0, ay = 0, sp = 0;
        stack[sp++] = 0;
        while (sp > 0) {
          const k = stack[--sp];
          const mass = this.tMass[k];
          if (mass === 0) continue;
          const dx = this.tMx[k] - xi, dy = this.tMy[k] - yi;
          const d2 = dx * dx + dy * dy;
          const leaf = this.tChild[k] === -1;
          if (leaf && this.tBody[k] === i) continue;
          const size = this.tHalf[k] * 2;
          if (leaf || size * size < THETA2 * d2) {
            const inv = 1 / Math.sqrt(d2 + EPS2);
            const f = G * mass * inv * inv * inv;
            ax += f * dx; ay += f * dy;
          } else {
            const c = this.tChild[k];
            stack[sp++] = c; stack[sp++] = c + 1; stack[sp++] = c + 2; stack[sp++] = c + 3;
          }
        }
        // The black hole pulls on everything, and everything pulls back on it.
        const dx = bh.x - xi, dy = bh.y - yi;
        const inv = 1 / Math.sqrt(dx * dx + dy * dy + EPS2), inv3 = inv * inv * inv;
        ax += GM * inv3 * dx; ay += GM * inv3 * dy;
        bax -= G * this.m[i] * inv3 * dx; bay -= G * this.m[i] * inv3 * dy;
        this.ax[i] = ax; this.ay[i] = ay;
      }
      bh.ax = bax; bh.ay = bay;
    }

    // ---- Everything that isn't gravity ----

    forces() {
      const k = this.k, n = this.n, bh = this.bh;
      // Gas drag on everything not yet a star: dv/dt = −γv.
      if (k.gamma > 0) {
        for (let i = 0; i < n; i++) {
          if (this.kind[i] === STAR) continue;
          this.ax[i] -= k.gamma * this.vx[i]; this.ay[i] -= k.gamma * this.vy[i];
        }
      }
      // Starlight pushes gas away: L ∝ M^3.5, pressure ∝ L / r², weaker on bigger clumps.
      for (let s = 0; s < n; s++) {
        if (this.kind[s] !== STAR) continue;
        const lum = Math.min(20000, k.kappa * 1200 * Math.pow(this.m[s] / 100, 3.5));
        this.push(this.x[s], this.y[s], lum, 25, 120);
      }
      // Accretion shines: L = η·Ṁc². Against the Eddington luminosity L_Edd = λM, its
      // radiation pressure on gas is (L / L_Edd) times your gravity: past 1, you blow
      // your own food away.
      bh.eddington = bh.lum / (k.lambda * bh.m);
      if (bh.eddington > 0.02) {
        const rs = this.horizon();
        this.push(bh.x, bh.y, bh.eddington * k.G * bh.m, 4 * rs * rs + 4, 220);
      }
      // Thrust: steer toward the desired velocity, with a force that doesn't grow
      // as fast as your mass, so heavier means more sluggish (a = F / M).
      const c = this.control;
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

    push(sx, sy, lum, soft, range) {
      const range2 = range * range;
      for (let i = 0; i < this.n; i++) {
        if (this.kind[i] === STAR) continue;
        const dx = this.x[i] - sx, dy = this.y[i] - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 > range2) continue;
        const inv = 1 / Math.sqrt(d2 + soft);
        const f = lum * inv * inv * inv / Math.cbrt(this.m[i]);
        this.ax[i] += f * dx; this.ay[i] += f * dy;
      }
    }

    // Move everything and bounce off the walls. (c sets the horizon and the light
    // of accretion here; it isn't enforced as a speed limit, only a numerical cap.)
    integrate(dt) {
      const k = this.k, vmax = 400, c2 = vmax * vmax, hw = this.W / 2, hh = this.H / 2;
      const ew = 0.5 + 0.5 * k.e;
      for (let i = 0; i < this.n; i++) {
        let vx = this.vx[i] + this.ax[i] * dt, vy = this.vy[i] + this.ay[i] * dt;
        const v2 = vx * vx + vy * vy;
        if (v2 > c2) { const s = vmax / Math.sqrt(v2); vx *= s; vy *= s; }
        let x = this.x[i] + vx * dt, y = this.y[i] + vy * dt;
        const r = this.r[i];
        if (x < -hw + r) { x = -hw + r; vx = Math.abs(vx) * ew; }
        else if (x > hw - r) { x = hw - r; vx = -Math.abs(vx) * ew; }
        if (y < -hh + r) { y = -hh + r; vy = Math.abs(vy) * ew; }
        else if (y > hh - r) { y = hh - r; vy = -Math.abs(vy) * ew; }
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      }
      const bh = this.bh, rs = Math.max(2, this.horizon());
      bh.vx += bh.ax * dt; bh.vy += bh.ay * dt;
      const v2 = bh.vx * bh.vx + bh.vy * bh.vy;
      if (v2 > c2) { const s = vmax / Math.sqrt(v2); bh.vx *= s; bh.vy *= s; }
      bh.x += bh.vx * dt; bh.y += bh.vy * dt;
      if (bh.x < -hw + rs) { bh.x = -hw + rs; bh.vx = Math.abs(bh.vx) * ew; }
      else if (bh.x > hw - rs) { bh.x = hw - rs; bh.vx = -Math.abs(bh.vx) * ew; }
      if (bh.y < -hh + rs) { bh.y = -hh + rs; bh.vy = Math.abs(bh.vy) * ew; }
      else if (bh.y > hh - rs) { bh.y = hh - rs; bh.vy = -Math.abs(bh.vy) * ew; }
    }

    // ---- Collisions: slow encounters stick, fast ones bounce with restitution e ----

    collide() {
      const n = this.n;
      if (n < 2) return;
      const hw = this.W / 2, hh = this.H / 2;
      const cols = Math.floor(this.W / CELL) + 1, rows = Math.floor(this.H / CELL) + 1;
      const cells = cols * rows;
      if (!this.head || this.head.length < cells) this.head = new Int32Array(cells);
      const head = this.head, next = this.next;
      head.fill(-1, 0, cells);
      const cellX = (i) => Math.min(cols - 1, Math.max(0, Math.floor((this.x[i] + hw) / CELL)));
      const cellY = (i) => Math.min(rows - 1, Math.max(0, Math.floor((this.y[i] + hh) / CELL)));
      const big = [];
      for (let i = 0; i < n; i++) {
        this.dead[i] = 0;
        if (this.kind[i] === STAR) continue; // stars are collisionless
        if (this.r[i] > CELL / 2) { big.push(i); continue; }
        const c = cellY(i) * cols + cellX(i);
        next[i] = head[c]; head[c] = i;
      }
      let merged = false;
      for (let i = 0; i < n; i++) {
        if (this.dead[i] || this.kind[i] === STAR || this.r[i] > CELL / 2) continue;
        const cx = cellX(i), cy = cellY(i);
        for (let oy = -1; oy <= 1; oy++) {
          const yy = cy + oy;
          if (yy < 0 || yy >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = cx + ox;
            if (xx < 0 || xx >= cols) continue;
            for (let j = head[yy * cols + xx]; j !== -1; j = next[j]) {
              if (j <= i || this.dead[j] || this.dead[i]) continue;
              if (this.interact(i, j)) merged = true;
            }
          }
        }
      }
      for (const i of big) {
        if (this.dead[i]) continue;
        for (let j = 0; j < n; j++) {
          if (j === i || this.dead[j] || this.dead[i] || this.kind[j] === STAR) continue;
          if (this.interact(i, j)) merged = true;
        }
      }
      if (merged) this.compact();
    }

    interact(i, j) {
      const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
      const reach = this.r[i] + this.r[j];
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) return false;
      const rvx = this.vx[j] - this.vx[i], rvy = this.vy[j] - this.vy[i];
      const vesc2 = 2 * this.k.G * (this.m[i] + this.m[j]) / Math.max(reach, 0.5);
      const stick = this.k.stick;
      if (rvx * rvx + rvy * rvy < vesc2 + stick * stick) { this.merge(i, j); return true; }
      // Too fast to stick: an inelastic bounce, v′ = −e·v along the line of centres.
      const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
      const invI = 1 / this.m[i], invJ = 1 / this.m[j];
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const jimp = -(1 + this.k.e) * vn / (invI + invJ);
        this.vx[i] -= jimp * invI * nx; this.vy[i] -= jimp * invI * ny;
        this.vx[j] += jimp * invJ * nx; this.vy[j] += jimp * invJ * ny;
      }
      const s = (reach - d) / (invI + invJ);
      this.x[i] -= nx * s * invI; this.y[i] -= ny * s * invI;
      this.x[j] += nx * s * invJ; this.y[j] += ny * s * invJ;
      return false;
    }

    merge(i, j) {
      const keep = this.m[j] > this.m[i] ? j : i, gone = keep === i ? j : i;
      const ma = this.m[keep], mb = this.m[gone], m = ma + mb;
      this.x[keep] = (this.x[keep] * ma + this.x[gone] * mb) / m;
      this.y[keep] = (this.y[keep] * ma + this.y[gone] * mb) / m;
      this.vx[keep] = (this.vx[keep] * ma + this.vx[gone] * mb) / m;
      this.vy[keep] = (this.vy[keep] * ma + this.vy[gone] * mb) / m;
      this.m[keep] = m;
      if (this.kind[keep] === DUST && m >= BODY_MASS) this.kind[keep] = BODY;
      this.r[keep] = radiusFor(m, this.kind[keep]);
      this.dead[gone] = 1;
    }

    // ---- The black hole's own physics ----

    // Anything crossing the horizon is gone. Momentum is conserved; a fraction η
    // of the rest mass is radiated away instead of added, as L = η·Ṁc².
    feed(dt) {
      const bh = this.bh, rs = this.horizon(), eta = this.k.eta;
      let inflow = 0, ate = false;
      for (let i = 0; i < this.n; i++) {
        // Stars are compact: they fall in only when their centre crosses the horizon.
        const reach = this.kind[i] === STAR ? rs : rs + this.r[i];
        const dx = this.x[i] - bh.x, dy = this.y[i] - bh.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        const m = this.m[i], M = bh.m;
        bh.vx = (bh.vx * M + this.vx[i] * m) / (M + m);
        bh.vy = (bh.vy * M + this.vy[i] * m) / (M + m);
        bh.m += m * (1 - eta);
        inflow += m;
        this.stats.eaten++;
        if (this.kind[i] === STAR) this.events.push({ type: 'swallow', x: this.x[i], y: this.y[i], m });
        this.dead[i] = 1; ate = true;
      }
      if (ate) this.compact();
      bh.mdot += (inflow / dt - bh.mdot) * Math.min(1, dt / 0.8);
      bh.lum = eta * bh.mdot * this.k.c * this.k.c;
      return inflow * (1 - eta);
    }

    // Inside the Roche limit, tides beat a body's own gravity and stretch it apart.
    tides() {
      const bh = this.bh, rs = this.horizon(), n = this.n;
      for (let i = 0; i < n; i++) {
        const m = this.m[i];
        if (this.kind[i] === DUST || m < SHRED_MASS) continue;
        const roche = this.roche(m, this.r[i]);
        if (roche <= rs + this.r[i]) continue; // too big a hole: swallowed whole instead
        const dx = this.x[i] - bh.x, dy = this.y[i] - bh.y;
        if (dx * dx + dy * dy < roche * roche) this.shred(i, dx, dy);
      }
    }

    shred(i, dx, dy) {
      const m = this.m[i], x = this.x[i], y = this.y[i], vx = this.vx[i], vy = this.vy[i];
      const d = Math.hypot(dx, dy) || 1, rx = dx / d, ry = dy / d;
      const count = Math.max(2, Math.min(Math.round(m), this.cap - this.n + 1));
      const span = this.r[i] * 3;
      this.events.push({ type: 'shred', x, y, m, star: this.kind[i] === STAR });
      this.stats.shredded++;
      for (let k = 0; k < count; k++) {
        const j = k === 0 ? i : this.n++;
        const t = (k / (count - 1)) * 2 - 1; // spaghetti: strung out along the radial line
        const side = (Math.random() - 0.5) * this.r[i];
        this.x[j] = x + rx * t * span - ry * side; this.y[j] = y + ry * t * span + rx * side;
        this.vx[j] = vx + rx * t * 6; this.vy[j] = vy + ry * t * 6;
        this.m[j] = m / count; this.kind[j] = DUST; this.age[j] = 0;
        this.r[j] = radiusFor(this.m[j], DUST); this.dead[j] = 0;
      }
    }

    // Hawking radiation: dM/dt = −ħc⁴ / (15360·π·G²·M²), folded into one constant.
    hawking(dt) {
      const bh = this.bh;
      const loss = this.k.kH / (bh.m * bh.m) * dt;
      bh.m -= loss;
      if (bh.m < this.k.Mfail && !this.evaporated) {
        this.evaporated = true;
        this.events.push({ type: 'evaporate', x: bh.x, y: bh.y, m: bh.m });
      }
      return loss;
    }

    // ---- Stars: Jeans collapse, a lifetime of t ∝ M^−2.5, then a supernova ----

    evolve(dt) {
      const k = this.k, n = this.n;
      for (let i = 0; i < n; i++) {
        const kind = this.kind[i], m = this.m[i];
        if (kind === BODY && m >= k.MJ) {
          this.kind[i] = STAR; this.r[i] = radiusFor(m, STAR); this.age[i] = 0;
          this.stats.starsFormed++;
          this.events.push({ type: 'ignite', x: this.x[i], y: this.y[i], m });
        } else if (kind === STAR) {
          this.age[i] += dt;
          if (this.age[i] > k.tau * Math.pow(m / 100, -2.5)) this.supernova(i);
        }
      }
    }

    supernova(i) {
      const m = this.m[i], x = this.x[i], y = this.y[i], vx = this.vx[i], vy = this.vy[i];
      const count = Math.max(6, Math.min(Math.round(m), this.cap - this.n + 1, 160));
      this.events.push({ type: 'supernova', x, y, m });
      this.stats.supernovae++;
      for (let k = 0; k < count; k++) {
        const j = k === 0 ? i : this.n++;
        const a = (k / count) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 14 + Math.random() * 10, d = this.r[i] + Math.random() * 2;
        this.x[j] = x + Math.cos(a) * d; this.y[j] = y + Math.sin(a) * d;
        this.vx[j] = vx + Math.cos(a) * sp; this.vy[j] = vy + Math.sin(a) * sp;
        this.m[j] = m / count; this.kind[j] = DUST; this.age[j] = 0;
        this.r[j] = radiusFor(this.m[j], DUST); this.dead[j] = 0;
      }
    }

    compact() {
      let w = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.dead[i]) continue;
        if (w !== i) {
          this.x[w] = this.x[i]; this.y[w] = this.y[i];
          this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
          this.m[w] = this.m[i]; this.r[w] = this.r[i];
          this.kind[w] = this.kind[i]; this.age[w] = this.age[i];
        }
        this.dead[w] = 0;
        w++;
      }
      this.n = w;
    }

    step(dt) {
      if (this.evaporated) return;
      const bh = this.bh;
      if (this.n > 0) { this.buildTree(); this.gravity(); } else { bh.ax = 0; bh.ay = 0; }
      this.forces();
      this.integrate(dt);
      this.collide();
      const gained = this.feed(dt);
      this.tides();
      this.evolve(dt);
      const lost = this.hawking(dt);
      bh.net += ((gained - lost) / dt - bh.net) * Math.min(1, dt / 1.5);
      this.time += dt;
    }
  }

  MOTE.Sim = Sim;
  MOTE.rng = rng;
  MOTE.KIND = { DUST, BODY, STAR };
})(typeof window !== 'undefined' ? (window.MOTE = window.MOTE || {}) : (globalThis.MOTE = globalThis.MOTE || {}));
