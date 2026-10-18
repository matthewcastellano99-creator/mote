// Drawing the cosmos: dust tinted by how ordered its motion is, glowing stars,
// hungry holes, and light trails that let structure show through the chaos.
(function (MOTE) {
  'use strict';

  const { DUST, BODY, STAR, HOLE } = MOTE.KIND;
  const BUCKETS = 6;

  // Chaotic motion reads violet and dim; settled orbits read cyan and bright.
  const DUST_COLORS = Array.from({ length: BUCKETS }, (_, b) => {
    const t = b / (BUCKETS - 1);
    const hue = 268 - t * 80, sat = 35 + t * 45, light = 52 + t * 22, alpha = 0.35 + t * 0.5;
    return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
  });

  // Small stars burn red and long; heavy ones burn blue and briefly.
  function starColor(m) {
    if (m < 1.5) return [255, 130, 90];
    if (m < 4) return [255, 196, 125];
    if (m < 10) return [255, 244, 225];
    return [160, 200, 255];
  }

  const spriteCache = new Map();
  function glowSprite(rgb) {
    const key = rgb.join(',');
    if (spriteCache.has(key)) return spriteCache.get(key);
    const size = 128, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${key}, 0.9)`);
    grad.addColorStop(0.1, `rgba(${key}, 0.55)`);
    grad.addColorStop(0.3, `rgba(${key}, 0.12)`);
    grad.addColorStop(1, `rgba(${key}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    spriteCache.set(key, c);
    return c;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, zoom: 1, fit: 1 }; // zoom is the player's, fit follows the structure
      this.flashes = [];
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
      this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.fillStyle = '#04050c';
      this.ctx.fillRect(0, 0, this.w, this.h);
    }

    scale() { return (Math.min(this.w, this.h) / (2 * MOTE.WORLD_R * 1.15)) * this.cam.zoom * this.cam.fit; }

    toWorld(px, py) {
      const s = this.scale();
      return { x: (px - this.w / 2) / s + this.cam.x, y: (py - this.h / 2) / s + this.cam.y };
    }

    flash(ev) {
      if (this.flashes.length > 60) return;
      const size = ev.type === 'supernova' ? 12 + ev.m * 2.2
        : ev.type === 'singularity' ? 45 : 8 + Math.sqrt(ev.m) * 2.5;
      this.flashes.push({ x: ev.x, y: ev.y, t: 0, life: ev.type === 'ignite' ? 1 : 2.2, size, type: ev.type });
    }

    draw(sim, metrics, hand, dt) {
      const ctx = this.ctx, w = this.w, h = this.h;
      if (metrics && metrics.mass > 0) {
        const k = 1 - Math.exp(-dt * 1.5);
        this.cam.x += (metrics.cx - this.cam.x) * k;
        this.cam.y += (metrics.cy - this.cam.y) * k;
        const fit = Math.max(0.8, Math.min(3, (MOTE.WORLD_R * 0.85) / Math.max(20, metrics.extent)));
        this.cam.fit += (fit - this.cam.fit) * (1 - Math.exp(-dt * 0.5));
      }
      const s = this.scale(), ox = w / 2 - this.cam.x * s, oy = h / 2 - this.cam.y * s;
      const cx = metrics ? metrics.cx : 0, cy = metrics ? metrics.cy : 0;
      const spin = metrics ? metrics.spin : 1;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(4, 5, 12, 0.24)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Dust, batched by how circular (ordered) each mote's motion is.
      const paths = DUST_COLORS.map(() => new Path2D());
      const bodies = [], stars = [], holes = [];
      const dot = Math.max(1, 1.4 * Math.sqrt(s));
      for (let i = 0; i < sim.n; i++) {
        const kind = sim.kind[i];
        if (kind === STAR) { stars.push(i); continue; }
        if (kind === HOLE) { holes.push(i); continue; }
        if (kind === BODY) { bodies.push(i); continue; }
        const dx = sim.x[i] - cx, dy = sim.y[i] - cy;
        const r = Math.hypot(dx, dy) + 1e-6, v = Math.hypot(sim.vx[i], sim.vy[i]) + 1e-6;
        const circ = spin * (dx * sim.vy[i] - dy * sim.vx[i]) / (r * v);
        const b = Math.max(0, Math.min(BUCKETS - 1, Math.floor(circ * BUCKETS)));
        paths[b].rect(ox + sim.x[i] * s - dot / 2, oy + sim.y[i] * s - dot / 2, dot, dot);
      }
      paths.forEach((p, b) => { ctx.fillStyle = DUST_COLORS[b]; ctx.fill(p); });

      ctx.fillStyle = 'rgba(255, 196, 140, 0.75)';
      for (const i of bodies) {
        const r = Math.max(1.2, sim.r[i] * s);
        ctx.beginPath();
        ctx.arc(ox + sim.x[i] * s, oy + sim.y[i] * s, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const now = performance.now() / 1000;
      const glowScale = Math.sqrt(this.cam.zoom * this.cam.fit * Math.min(this.w, this.h) / 800);
      ctx.globalAlpha = 0.75;
      const cores = new Path2D();
      for (const i of stars) {
        const m = sim.m[i];
        const size = (4 + Math.sqrt(m) * 3.2) * glowScale;
        const x = ox + sim.x[i] * s, y = oy + sim.y[i] * s;
        if (x < -size || y < -size || x > w + size || y > h + size) continue;
        ctx.drawImage(glowSprite(starColor(m)), x - size / 2, y - size / 2, size, size);
        if (m >= 4) cores.rect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fill(cores);

      for (const i of holes) {
        const x = ox + sim.x[i] * s, y = oy + sim.y[i] * s;
        const r = Math.max(3, sim.r[i] * s * 1.6);
        ctx.drawImage(glowSprite([255, 150, 60]), x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 210, 150, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, r * 1.15, 0, Math.PI * 2); ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
      }

      for (let f = this.flashes.length - 1; f >= 0; f--) {
        const fl = this.flashes[f];
        fl.t += dt;
        if (fl.t > fl.life) { this.flashes.splice(f, 1); continue; }
        const p = fl.t / fl.life;
        const rgb = fl.type === 'ignite' ? '255, 220, 160' : fl.type === 'singularity' ? '255, 150, 80' : '180, 220, 255';
        ctx.strokeStyle = `rgba(${rgb}, ${0.35 * (1 - p) * (1 - p)})`;
        ctx.lineWidth = 1.2 * (1 - p) + 0.4;
        ctx.beginPath();
        ctx.arc(ox + fl.x * s, oy + fl.y * s, fl.size * s * Math.sqrt(p), 0, Math.PI * 2);
        ctx.stroke();
      }

      if (hand) {
        const x = ox + hand.x * s, y = oy + hand.y * s;
        ctx.strokeStyle = hand.sign > 0 ? 'rgba(140, 230, 255, 0.35)' : 'rgba(255, 140, 180, 0.35)';
        ctx.lineWidth = 1;
        const pr = 18 + 4 * Math.sin(now * 6);
        ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    snapshot() {
      // A centred 4:3 crop of whatever is on screen.
      const out = document.createElement('canvas');
      out.width = 320; out.height = 240;
      const A = out.width / out.height, cw = this.canvas.width, ch = this.canvas.height;
      const sw = cw / ch > A ? ch * A : cw, sh = sw / A;
      out.getContext('2d').drawImage(this.canvas, (cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.82);
    }
  }

  MOTE.Renderer = Renderer;
})(window.MOTE);
