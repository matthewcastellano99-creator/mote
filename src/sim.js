// The physics of a cosmos: N-body gravity (Barnes–Hut), merging on contact,
// and the optional laws the player unlocks. Plain script so it also runs in Node.
(function (MOTE) {
  'use strict';

  const WORLD_R = 260;          // radius of the initial dust cloud
  const ESCAPE_R = WORLD_R * 3; // beyond this, mass is lost to the void
  const EPS2 = 9;               // gravitational softening, squared
  const THETA2 = 0.7 * 0.7;     // Barnes–Hut opening angle, squared
  const MAX_DEPTH = 24;
  const CELL = 6;               // collision grid cell size

  const DUST = 0, BODY = 1, STAR = 2, HOLE = 3;
  const BODY_MASS = 4;          // dust heavier than this is a body

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
    if (kind === STAR) return 1.3 * Math.cbrt(m);
    if (kind === HOLE) return 0.5 * Math.cbrt(m);
    return 0.9 * Math.cbrt(m);
  }

  class Sim {
    constructor(count, seed) {
      this.alloc(count);
      this.seed = seed;
      this.time = 0;
      this.lostMass = 0;
      this.events = [];
      this.laws = {
        G: 1.5, capture: 1, stick: 0.5, cooling: 0, vortex: 0,
        starMass: Infinity, holeMass: Infinity, radiance: 0, halo: 0, lifespan: 0,
      };
      this.hand = null; // {x, y, sign}
      this.bigBang(seed);
    }

    alloc(cap) {
      this.cap = cap;
      this.n = 0;
      this.x = new Float64Array(cap); this.y = new Float64Array(cap);
      this.vx = new Float64Array(cap); this.vy = new Float64Array(cap);
      this.ax = new Float64Array(cap); this.ay = new Float64Array(cap);
      this.m = new Float64Array(cap); this.r = new Float64Array(cap);
      this.kind = new Uint8Array(cap);
      this.age = new Float64Array(cap);
      this.dead = new Uint8Array(cap);
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

    // Chaos with a few hidden eddies, so every seed collapses differently.
    bigBang(seed) {
      const rand = rng(seed);
      const eddies = [];
      const nEddies = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < nEddies; k++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * WORLD_R * 0.8;
        eddies.push({
          x: Math.cos(a) * d, y: Math.sin(a) * d,
          s: (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.9),
          w: 40 + rand() * 90,
        });
      }
      let px = 0, py = 0;
      for (let i = 0; i < this.cap; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * WORLD_R;
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        let vx = (rand() - 0.5) * 5, vy = (rand() - 0.5) * 5;
        for (const e of eddies) {
          const dx = x - e.x, dy = y - e.y;
          const f = e.s * Math.exp(-(dx * dx + dy * dy) / (2 * e.w * e.w));
          vx += -dy / e.w * f; vy += dx / e.w * f;
        }
        const m = 0.6 + rand() * 0.8;
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
        this.m[i] = m; this.kind[i] = DUST; this.r[i] = radiusFor(m, DUST); this.age[i] = 0;
        px += m * vx; py += m * vy;
      }
      this.n = this.cap;
      // Zero net momentum so the cosmos stays on screen.
      let total = 0;
      for (let i = 0; i < this.n; i++) total += this.m[i];
      for (let i = 0; i < this.n; i++) { this.vx[i] -= px / total; this.vy[i] -= py / total; }
    }

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
      const old = this, size = this.tCap * 2;
      const keep = ['tCx', 'tCy', 'tHalf', 'tMass', 'tMx', 'tMy', 'tChild', 'tBody'];
      const saved = keep.map((key) => old[key]);
      this.allocTree(size);
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

    gravity() {
      const G = this.laws.G, n = this.n, stack = this.stack;
      for (let i = 0; i < n; i++) {
        const xi = this.x[i], yi = this.y[i], mi = this.m[i];
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
            // Heavy neighbours get a wider soft core, so close passes by a hole
            // don't fling stars out of the universe on a coarse timestep.
            const soft = leaf ? EPS2 + 0.05 * Math.max(mass, mi) : EPS2;
            const inv = 1 / Math.sqrt(d2 + soft);
            const f = G * mass * inv * inv * inv;
            ax += f * dx; ay += f * dy;
          } else {
            const c = this.tChild[k];
            stack[sp++] = c; stack[sp++] = c + 1; stack[sp++] = c + 2; stack[sp++] = c + 3;
          }
        }
        this.ax[i] = ax; this.ay[i] = ay;
      }
    }

    // Laws beyond gravity: dissipation, vortex, dark halo, radiation, the hand.
    extraForces() {
      const L = this.laws, n = this.n;
      const halo2 = L.halo * L.halo;
      for (let i = 0; i < n; i++) {
        const k = this.kind[i];
        const x = this.x[i], y = this.y[i];
        const r2 = x * x + y * y + 1, r = Math.sqrt(r2);
        if (halo2 > 0) {
          const f = halo2 / (r2 + 2500);
          this.ax[i] -= f * x; this.ay[i] -= f * y;
        }
        if (k >= STAR) continue;
        const rx = x / r, ry = y / r;
        const vr = this.vx[i] * rx + this.vy[i] * ry;
        if (L.cooling > 0) {
          // Dissipation bleeds off radial motion: orbits settle and circularise.
          this.ax[i] -= L.cooling * vr * rx; this.ay[i] -= L.cooling * vr * ry;
        }
        if (L.vortex > 0) {
          // Nudge toward a shared sense of rotation, at the local orbital speed.
          const tx = -ry, ty = rx;
          const vt = this.vx[i] * tx + this.vy[i] * ty;
          const inward = Math.max(0, -(this.ax[i] * rx + this.ay[i] * ry));
          const target = L.vortex * Math.sqrt(inward * r);
          const f = (target - vt) * 0.25 * L.vortex;
          this.ax[i] += f * tx; this.ay[i] += f * ty;
        }
      }
      if (L.radiance > 0) {
        for (let s = 0; s < n; s++) {
          if (this.kind[s] !== STAR || this.m[s] < 6) continue;
          const lum = L.radiance * Math.pow(this.m[s] / 20, 1.5);
          const sx = this.x[s], sy = this.y[s];
          for (let i = 0; i < n; i++) {
            if (this.kind[i] !== DUST) continue;
            const dx = this.x[i] - sx, dy = this.y[i] - sy;
            const d2 = dx * dx + dy * dy;
            if (d2 > 14400) continue;
            const inv = 1 / Math.sqrt(d2 + 25);
            const f = lum * inv * inv * inv;
            this.ax[i] += f * dx; this.ay[i] += f * dy;
          }
        }
      }
      const h = this.hand;
      if (h) {
        const strength = 900 * h.sign;
        for (let i = 0; i < n; i++) {
          if (this.kind[i] >= STAR) continue;
          const dx = h.x - this.x[i], dy = h.y - this.y[i];
          const d2 = dx * dx + dy * dy;
          if (d2 > 14400) continue;
          const f = strength / (d2 + 400) / Math.sqrt(this.m[i]);
          this.ax[i] += f * dx; this.ay[i] += f * dy;
          // A gathering hand also calms what it holds, so matter collects instead of slingshotting.
          if (h.sign > 0) {
            const calm = 1.5 * (1 - d2 / 14400);
            this.ax[i] -= calm * this.vx[i]; this.ay[i] -= calm * this.vy[i];
          }
        }
      }
    }

    collide() {
      const n = this.n, capture = this.laws.capture;
      if (n < 2) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = this.x[i], y = this.y[i];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const cols = Math.floor((maxX - minX) / CELL) + 1;
      const rows = Math.floor((maxY - minY) / CELL) + 1;
      const cells = cols * rows;
      if (!this.head || this.head.length < cells) this.head = new Int32Array(cells * 2);
      if (!this.next || this.next.length < this.cap) this.next = new Int32Array(this.cap);
      const head = this.head, next = this.next;
      head.fill(-1, 0, cells);
      const big = [];
      for (let i = 0; i < n; i++) {
        this.dead[i] = 0;
        if (this.r[i] * capture > CELL / 2) { big.push(i); continue; }
        const c = Math.floor((this.x[i] - minX) / CELL) + Math.floor((this.y[i] - minY) / CELL) * cols;
        next[i] = head[c]; head[c] = i;
      }
      let merged = false;
      // Small against small: neighbouring cells only.
      for (let i = 0; i < n; i++) {
        if (this.dead[i] || this.r[i] * capture > CELL / 2) continue;
        const cx = Math.floor((this.x[i] - minX) / CELL), cy = Math.floor((this.y[i] - minY) / CELL);
        for (let oy = -1; oy <= 1; oy++) {
          const yy = cy + oy;
          if (yy < 0 || yy >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = cx + ox;
            if (xx < 0 || xx >= cols) continue;
            for (let j = head[yy * cols + xx]; j !== -1; j = next[j]) {
              if (j <= i || this.dead[j] || this.dead[i]) continue;
              if (this.touching(i, j, capture)) { this.merge(i, j); merged = true; }
            }
          }
        }
      }
      // Big bodies sweep against everything.
      for (const i of big) {
        if (this.dead[i]) continue;
        for (let j = 0; j < n; j++) {
          if (j === i || this.dead[j] || this.dead[i]) continue;
          if (this.touching(i, j, capture)) { this.merge(i, j); merged = true; }
        }
      }
      if (merged) this.compact();
    }

    touching(i, j, capture) {
      const dx = this.x[i] - this.x[j], dy = this.y[i] - this.y[j];
      const ki = this.kind[i], kj = this.kind[j];
      // Stars are collisionless: they neither collide, accrete, nor fall into holes.
      if (ki === STAR || kj === STAR) return false;
      let reach = (this.r[i] + this.r[j]) * capture;
      if (ki === HOLE || kj === HOLE) reach *= 1.5;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) return false;
      // Stick only if slow enough: under escape speed, plus whatever cohesion adds.
      const dvx = this.vx[i] - this.vx[j], dvy = this.vy[i] - this.vy[j];
      const stick = this.laws.stick;
      const vesc2 = 2 * this.laws.G * (this.m[i] + this.m[j]) / Math.max(reach, 1);
      return dvx * dvx + dvy * dvy < vesc2 + stick * stick;
    }

    merge(i, j) {
      let keep = i, gone = j;
      const kj = this.kind[j], ki = this.kind[i];
      if (kj > ki || (kj === ki && this.m[j] > this.m[i])) { keep = j; gone = i; }
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

    // Clumps ignite, stars age and explode, the heaviest leave holes behind.
    evolve(dt) {
      const L = this.laws;
      const n = this.n;
      let died = false;
      for (let i = 0; i < n; i++) {
        const k = this.kind[i], m = this.m[i];
        if (k === STAR) {
          this.age[i] += dt;
          if (L.lifespan > 0 && this.age[i] > L.lifespan * Math.pow(20 / m, 1.5)) {
            this.supernova(i);
            if (this.dead[i]) died = true;
          }
        } else if (k < STAR && m >= L.starMass) {
          this.ignite(i);
        }
      }
      if (died) this.compact();
    }

    // A collapsing clump fragments into a cluster of stars: many small, a few heavy.
    ignite(i) {
      const M = this.m[i], x = this.x[i], y = this.y[i], vx = this.vx[i], vy = this.vy[i];
      const count = Math.max(1, Math.min(Math.round(M / 3), 48, this.cap - this.n + 1));
      const weights = [];
      let total = 0;
      for (let k = 0; k < count; k++) {
        const w = Math.pow(0.04 + Math.random() * 0.96, -1.35);
        weights.push(w); total += w;
      }
      const spread = 2 + Math.sqrt(M) * 0.6;
      const vOrbit = Math.sqrt(this.laws.G * M / spread) * 0.6;
      for (let k = 0; k < count; k++) {
        const j = k === 0 ? i : this.n++;
        const a = Math.random() * Math.PI * 2, d = spread * Math.sqrt(Math.random());
        const m = M * weights[k] / total;
        this.x[j] = x + Math.cos(a) * d; this.y[j] = y + Math.sin(a) * d;
        this.vx[j] = vx - Math.sin(a) * vOrbit * (d / spread) + (Math.random() - 0.5);
        this.vy[j] = vy + Math.cos(a) * vOrbit * (d / spread) + (Math.random() - 0.5);
        this.m[j] = m; this.kind[j] = STAR; this.age[j] = Math.random() * 5;
        this.r[j] = radiusFor(m, STAR); this.dead[j] = 0;
      }
      this.events.push({ type: 'ignite', x, y, m: M });
    }

    // A dying star returns its mass to the cloud as an expanding shell.
    // Heavy enough, and with Collapse in the laws, its core becomes a hole.
    supernova(i) {
      const m = this.m[i], x = this.x[i], y = this.y[i], vx = this.vx[i], vy = this.vy[i];
      const hole = m >= this.laws.holeMass;
      const shellMass = hole ? m * 0.5 : m;
      const count = Math.min(this.cap - this.n, Math.max(4, Math.floor(shellMass / 0.8)), 120);
      this.events.push({ type: 'supernova', x, y, m });
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 7 + Math.random() * 6;
        const j = this.n++;
        const d = this.r[i] + 1 + Math.random() * 2;
        this.x[j] = x + Math.cos(a) * d; this.y[j] = y + Math.sin(a) * d;
        this.vx[j] = vx + Math.cos(a) * sp; this.vy[j] = vy + Math.sin(a) * sp;
        this.m[j] = shellMass / count; this.kind[j] = DUST; this.age[j] = 0;
        this.r[j] = radiusFor(this.m[j], DUST); this.dead[j] = 0;
      }
      if (hole) {
        this.m[i] = m - shellMass; this.kind[i] = HOLE; this.age[i] = 0;
        this.r[i] = radiusFor(this.m[i], HOLE);
        this.events.push({ type: 'singularity', x, y, m: this.m[i] });
      } else if (count > 0) {
        this.dead[i] = 1;
      } else {
        this.age[i] = 0; // no room for the shell yet; it burns a while longer
      }
    }

    compact() {
      let w = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.dead[i]) continue;
        if (w !== i) {
          this.x[w] = this.x[i]; this.y[w] = this.y[i];
          this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
          this.m[w] = this.m[i]; this.r[w] = this.r[i]; this.kind[w] = this.kind[i];
          this.age[w] = this.age[i];
        }
        this.dead[w] = 0;
        w++;
      }
      this.n = w;
    }

    step(dt) {
      if (this.n === 0) return;
      this.buildTree();
      this.gravity();
      this.extraForces();
      const n = this.n, esc2 = ESCAPE_R * ESCAPE_R;
      let mass = 0, px = 0, py = 0, mx = 0, my = 0;
      for (let i = 0; i < n; i++) {
        this.vx[i] += this.ax[i] * dt; this.vy[i] += this.ay[i] * dt;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
        const m = this.m[i];
        mass += m; px += m * this.vx[i]; py += m * this.vy[i]; mx += m * this.x[i]; my += m * this.y[i];
      }
      // Radiation, vortex and the hand don't conserve momentum, so the cosmos
      // would slowly drift away. Keep its centre of mass at rest at the origin.
      const cx = mx / mass, cy = my / mass, cvx = px / mass, cvy = py / mass;
      let lost = false;
      for (let i = 0; i < n; i++) {
        this.x[i] -= cx; this.y[i] -= cy; this.vx[i] -= cvx; this.vy[i] -= cvy;
        if (this.x[i] * this.x[i] + this.y[i] * this.y[i] > esc2) {
          this.dead[i] = 1; this.lostMass += this.m[i]; lost = true;
        }
      }
      if (lost) this.compact();
      this.collide();
      this.evolve(dt);
      this.time += dt;
    }

    serialize() {
      const n = this.n, round = (v) => Math.round(v * 100) / 100;
      const pack = (arr) => Array.from(arr.subarray(0, n), round);
      return {
        seed: this.seed, time: this.time, lostMass: this.lostMass, cap: this.cap,
        x: pack(this.x), y: pack(this.y), vx: pack(this.vx), vy: pack(this.vy),
        m: pack(this.m), age: pack(this.age), kind: Array.from(this.kind.subarray(0, n)),
      };
    }

    static restore(data) {
      const sim = new Sim(data.cap, data.seed);
      const n = data.m.length;
      sim.x.set(data.x); sim.y.set(data.y); sim.vx.set(data.vx); sim.vy.set(data.vy);
      sim.m.set(data.m); sim.kind.set(data.kind); if (data.age) sim.age.set(data.age);
      for (let i = 0; i < n; i++) sim.r[i] = radiusFor(sim.m[i], sim.kind[i]);
      sim.n = n; sim.time = data.time; sim.lostMass = data.lostMass;
      return sim;
    }
  }

  MOTE.Sim = Sim;
  MOTE.WORLD_R = WORLD_R;
  MOTE.KIND = { DUST, BODY, STAR, HOLE };
})(typeof window !== 'undefined' ? (window.MOTE = window.MOTE || {}) : (globalThis.MOTE = globalThis.MOTE || {}));
