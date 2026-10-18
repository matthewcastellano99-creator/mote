// Drawing a level: the sealed box, dust tinted by whether it orbits you, clumps that
// brighten toward ignition, stars, and the black hole with its rings and glare.
(function (MOTE) {
  'use strict';

  const { DUST, BODY, STAR } = MOTE.KIND;

  // Free gas reads violet and dim; gas bound to you brightens toward cyan as its
  // orbit circularises.
  const DUST_COLORS = [
    'hsla(262, 30%, 58%, 0.45)',
    'hsla(220, 45%, 62%, 0.55)',
    'hsla(205, 60%, 66%, 0.65)',
    'hsla(192, 75%, 70%, 0.8)',
    'hsla(182, 90%, 76%, 0.95)',
  ];

  function starColor(m) {
    if (m < 70) return [255, 150, 100];
    if (m < 120) return [255, 205, 140];
    if (m < 200) return [255, 244, 228];
    return [165, 200, 255];
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
    grad.addColorStop(0.15, `rgba(${key}, 0.5)`);
    grad.addColorStop(0.4, `rgba(${key}, 0.12)`);
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
      this.insets = { top: 80, right: 16, bottom: 100, left: 16 };
      this.flashes = [];
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
      this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
      this.dpr = dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.clear();
    }

    clear() {
      this.ctx.fillStyle = '#04050c';
      this.ctx.fillRect(0, 0, this.w, this.h);
    }

    // Fit the arena into the space left between the HUD bands.
    layout(sim) {
      const { top, right, bottom, left } = this.insets;
      const aw = Math.max(50, this.w - left - right), ah = Math.max(50, this.h - top - bottom);
      this.s = Math.min(aw / sim.W, ah / sim.H);
      this.ox = left + aw / 2; this.oy = top + ah / 2;
    }

    toWorld(px, py) { return { x: (px - this.ox) / this.s, y: (py - this.oy) / this.s }; }

    flash(ev) {
      if (this.flashes.length > 40) return;
      const size = { ignite: 22, supernova: 70, shred: 30, swallow: 26, evaporate: 90 }[ev.type] || 20;
      this.flashes.push({ x: ev.x, y: ev.y, t: 0, life: ev.type === 'ignite' ? 1 : 1.8, size, type: ev.type });
    }

    draw(sim, dt, aim) {
      const ctx = this.ctx, w = this.w, h = this.h;
      this.layout(sim);
      const s = this.s, ox = this.ox, oy = this.oy;
      const bh = sim.bh, k = sim.k, GM = k.G * bh.m;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(4, 5, 12, 0.3)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Dust, batched by its orbit around you.
      const paths = DUST_COLORS.map(() => new Path2D());
      const bodies = [], stars = [];
      const dot = Math.max(1, 1.3 * Math.sqrt(s));
      for (let i = 0; i < sim.n; i++) {
        const kind = sim.kind[i];
        if (kind === STAR) { stars.push(i); continue; }
        if (kind === BODY) { bodies.push(i); continue; }
        const dx = sim.x[i] - bh.x, dy = sim.y[i] - bh.y;
        const dvx = sim.vx[i] - bh.vx, dvy = sim.vy[i] - bh.vy;
        const r = Math.hypot(dx, dy) + 1e-6, v2 = dvx * dvx + dvy * dvy;
        let b = 0;
        if (v2 / 2 < GM / Math.sqrt(r * r + 4)) {
          // Brighter the closer it is to a circular orbit at √(GM/r).
          const vt = Math.abs(dx * dvy - dy * dvx) / r, vr = Math.abs(dx * dvx + dy * dvy) / r;
          const vc = Math.sqrt(GM / r);
          const off = Math.abs(vt - vc) / vc + vr / vc;
          b = off < 0.45 ? 4 : off < 0.8 ? 3 : off < 1.3 ? 2 : 1;
        }
        paths[b].rect(ox + sim.x[i] * s - dot / 2, oy + sim.y[i] * s - dot / 2, dot, dot);
      }
      paths.forEach((p, b) => { ctx.fillStyle = DUST_COLORS[b]; ctx.fill(p); });

      // Clumps warm up as they approach the Jeans mass.
      for (const i of bodies) {
        const t = Math.min(1, sim.m[i] / k.MJ);
        const x = ox + sim.x[i] * s, y = oy + sim.y[i] * s, r = Math.max(1.3, sim.r[i] * s);
        if (t > 0.5) {
          const g = r * (3 + 5 * t);
          ctx.globalAlpha = (t - 0.5) * 1.6;
          ctx.drawImage(glowSprite([255, 170, 100]), x - g, y - g, g * 2, g * 2);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = `hsla(${22 + 18 * t}, ${45 + 50 * t}%, ${42 + 32 * t}%, ${0.6 + 0.4 * t})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      const now = performance.now() / 1000;
      for (const i of stars) {
        const m = sim.m[i];
        const x = ox + sim.x[i] * s, y = oy + sim.y[i] * s;
        const size = (14 + Math.sqrt(m) * 2.2) * Math.sqrt(s) * (1 + 0.06 * Math.sin(now * 3 + i));
        ctx.drawImage(glowSprite(starColor(m)), x - size / 2, y - size / 2, size, size);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.4, sim.r[i] * s * 0.5), 0, Math.PI * 2); ctx.fill();
      }

      this.drawHole(sim, now);

      for (let f = this.flashes.length - 1; f >= 0; f--) {
        const fl = this.flashes[f];
        fl.t += dt;
        if (fl.t > fl.life) { this.flashes.splice(f, 1); continue; }
        const p = fl.t / fl.life;
        const rgb = { ignite: '255, 220, 160', supernova: '180, 220, 255', shred: '255, 140, 170', swallow: '255, 180, 110', evaporate: '200, 230, 255' }[fl.type] || '255, 255, 255';
        ctx.strokeStyle = `rgba(${rgb}, ${0.55 * (1 - p) * (1 - p)})`;
        ctx.lineWidth = 1.5 * (1 - p) + 0.5;
        ctx.beginPath();
        ctx.arc(ox + fl.x * s, oy + fl.y * s, fl.size * s * Math.sqrt(p), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
      if (aim) {
        const bx = ox + bh.x * s, by = oy + bh.y * s;
        ctx.strokeStyle = 'rgba(160, 220, 255, 0.18)';
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ox + aim.x * s, oy + aim.y * s); ctx.stroke();
        ctx.setLineDash([]);
      }
      // The walls of the box.
      ctx.strokeStyle = 'rgba(150, 160, 230, 0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox - sim.W / 2 * s, oy - sim.H / 2 * s, sim.W * s, sim.H * s);
    }

    drawHole(sim, now) {
      const ctx = this.ctx, s = this.s, bh = sim.bh, k = sim.k;
      const x = this.ox + bh.x * s, y = this.oy + bh.y * s;
      const rs = sim.horizon(), R = Math.max(2.5, rs * s);

      // Accretion glare grows with the Eddington ratio.
      if (bh.eddington > 0.01) {
        const g = R * (3 + 4 * Math.min(2.5, bh.eddington));
        ctx.globalAlpha = Math.min(1, 0.25 + bh.eddington * 0.6);
        ctx.drawImage(glowSprite([255, 170, 90]), x - g, y - g, g * 2, g * 2);
        ctx.globalAlpha = 1;
      }
      // Hawking radiation: a small hole is hot, and glows blue-white as it evaporates.
      const hot = Math.min(1, Math.max(0, Math.pow(k.M0 / bh.m, 2) - 0.25));
      if (hot > 0) {
        const g = R * 7 * (0.8 + 0.2 * Math.sin(now * 9));
        ctx.globalAlpha = hot * 0.7;
        ctx.drawImage(glowSprite([190, 220, 255]), x - g, y - g, g * 2, g * 2);
        ctx.globalAlpha = 1;
      }

      ctx.globalCompositeOperation = 'source-over';
      // Roche limit for a typical new star: inside it, tides tear stars apart.
      const rStar = 1.1 * Math.cbrt(k.MJ);
      const roche = 2.44 * rStar * Math.cbrt(bh.m / k.MJ) * s;
      if (roche > R + 2) {
        ctx.strokeStyle = 'rgba(255, 140, 170, 0.22)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(x, y, roche, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      // Photon sphere at 1.5 r_s, where light itself orbits.
      ctx.strokeStyle = 'rgba(255, 214, 170, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, Math.max(R + 1.5, R * 1.5), 0, Math.PI * 2); ctx.stroke();
      if (bh.thrusting) {
        ctx.strokeStyle = 'rgba(140, 220, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, R * 1.5 + 4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
    }

    // The arena as it looks right now, scaled to a 320px-wide thumbnail.
    snapshot(sim) {
      this.layout(sim);
      const d = this.dpr, sw = sim.W * this.s * d, sh = sim.H * this.s * d;
      const sx = (this.ox - sim.W / 2 * this.s) * d, sy = (this.oy - sim.H / 2 * this.s) * d;
      const out = document.createElement('canvas');
      out.width = 320; out.height = Math.round(320 * sh / sw);
      out.getContext('2d').drawImage(this.canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.82);
    }
  }

  MOTE.Renderer = Renderer;
})(window.MOTE);
