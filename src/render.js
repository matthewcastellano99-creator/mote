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

  // Cluster stars span ~0.6–10 motes' worth of mass (a Salpeter IMF). Light ones burn
  // red-gold all level long; the massive few burn blue and die within seconds, so blue
  // marks where stars are being born: in the arms.
  const STAR_TINTS = [
    { below: 1, fill: 'rgba(255, 170, 120, 0.7)', dot: 1.1 },
    { below: 2, fill: 'rgba(255, 214, 160, 0.85)', dot: 1.35 },
    { below: 4, fill: 'rgba(255, 246, 232, 0.95)', dot: 1.6 },
    { below: Infinity, fill: 'rgba(185, 212, 255, 1)', dot: 2 },
  ];
  const BLUE = [150, 190, 255];

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

  // The galaxy's light: a map of how many motes and stars sit where, blurred over a few
  // particle spacings and tone-mapped, so arms read as luminous bands the way they do in a
  // telescope image rather than as a few more dots. Stars glow warm, gas glows blue. Each
  // particle counts once whatever its mass, so a heavy clump doesn't outshine an arm.
  const GLOW_CELL = 2.5, GLOW_R = 2; // world units per glow pixel; blur radius in pixels
  class Glow {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.ref = 0;
    }

    update(sim) {
      const gw = Math.max(8, Math.ceil(sim.W / GLOW_CELL)), gh = Math.max(8, Math.ceil(sim.H / GLOW_CELL)), N = gw * gh;
      if (this.canvas.width !== gw || this.canvas.height !== gh) {
        this.canvas.width = gw; this.canvas.height = gh;
        this.img = this.ctx.createImageData(gw, gh);
        this.star = new Float32Array(N); this.gas = new Float32Array(N); this.tmp = new Float32Array(N);
      }
      const star = this.star, gas = this.gas, hw = sim.W / 2, hh = sim.H / 2;
      star.fill(0); gas.fill(0);
      for (let i = 0; i < sim.n; i++) {
        const cx = Math.floor((sim.x[i] + hw) / GLOW_CELL), cy = Math.floor((sim.y[i] + hh) / GLOW_CELL);
        if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
        if (sim.kind[i] === STAR) star[cy * gw + cx]++; else gas[cy * gw + cx]++;
      }
      this.blur(star, gw, gh); this.blur(gas, gw, gh);
      // Tone-map against a slowly tracked reference: the density the average particle sits
      // in, so the empty outskirts don't drag it down. Arms land on the bright shoulder of
      // the curve and the space between them on its dark toe.
      let s1 = 0, s2 = 0;
      for (let c = 0; c < N; c++) { const v = star[c] + gas[c]; s1 += v; s2 += v * v; }
      const ref = s1 > 0 ? s2 / s1 : 1;
      this.ref = this.ref ? this.ref + (ref - this.ref) * 0.1 : ref;
      const d = this.img.data, inv = 1.3 / this.ref;
      const tone = (v) => { const t = 1 - Math.exp(-Math.max(0, v) * inv); return t * t; };
      for (let c = 0, p = 0; c < N; c++, p += 4) {
        const a = tone(star[c]), b = tone(1.5 * gas[c]);
        d[p] = 255 * Math.min(1, a + 0.4 * b);
        d[p + 1] = 255 * Math.min(1, 0.88 * a + 0.62 * b);
        d[p + 2] = 255 * Math.min(1, 0.74 * a + b);
        d[p + 3] = 255;
      }
      this.ctx.putImageData(this.img, 0, 0);
    }

    // Three passes of a (2R+1)-wide running box along x then y: close to a Gaussian, with
    // soft tails, at a cost that doesn't depend on R. (Running sums can leave tiny
    // negative residues, which tone() clamps.)
    blur(a, w, h) {
      const t = this.tmp, R = GLOW_R, n = 2 * R + 1;
      for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < h; y++) {
          const o = y * w;
          let acc = 0;
          for (let x = 0; x < R; x++) acc += a[o + x];
          for (let x = 0; x < w; x++) {
            if (x + R < w) acc += a[o + x + R];
            t[o + x] = acc / n;
            if (x >= R) acc -= a[o + x - R];
          }
        }
        for (let x = 0; x < w; x++) {
          let acc = 0;
          for (let y = 0; y < R; y++) acc += t[y * w + x];
          for (let y = 0; y < h; y++) {
            if (y + R < h) acc += t[(y + R) * w + x];
            a[y * w + x] = acc / n;
            if (y >= R) acc -= t[(y - R) * w + x];
          }
        }
      }
    }
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
      const size = { ignite: 22, supernova: 40, shred: 30, swallow: 26, wind: 50, evaporate: 90 }[ev.type] || 20;
      this.flashes.push({ x: ev.x, y: ev.y, t: 0, life: ev.type === 'ignite' ? 1 : 1.8, size, type: ev.type });
    }

    draw(sim, dt, aim) {
      const ctx = this.ctx, w = this.w, h = this.h;
      this.layout(sim);
      const s = this.s, ox = this.ox, oy = this.oy;
      const bh = sim.bh, k = sim.k, GM = k.G * bh.m, gal = sim.gal;
      const vh2 = gal ? gal.vh * gal.vh * gal.on : 0, rc2 = gal ? gal.rc * gal.rc : 1;

      ctx.globalCompositeOperation = 'source-over';
      // Trails cover the same stretch of sim time at any speed: short at 5×, long in
      // slow motion (about 0.3 per frame at 1× and 60 fps). Once a galaxy has formed they
      // shorten, so stars streaking along their orbits don't blur its arms.
      const on = gal ? gal.on : 0, tau = 0.047 * (1 - 0.6 * on);
      const fade = dt > 0 ? Math.min(0.9, Math.max(0.12, 1 - Math.exp(-dt / tau))) : 0.3;
      ctx.fillStyle = `rgba(4, 5, 12, ${fade})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // The glow layer, refreshed every other frame. Drawn at the fade's own strength, so
      // with the trail fade it settles to the same brightness at any time speed.
      if (!this.glow) this.glow = new Glow();
      if (dt > 0 && (this.glowTick = !this.glowTick)) this.glow.update(sim);
      if (this.glow.img) {
        ctx.globalAlpha = Math.min(1, (0.2 + 0.8 * on) * fade);
        ctx.drawImage(this.glow.canvas, ox - sim.W / 2 * s, oy - sim.H / 2 * s, sim.W * s, sim.H * s);
        ctx.globalAlpha = 1;
      }

      // Dust, batched by its orbit around you.
      const paths = DUST_COLORS.map(() => new Path2D());
      const bodies = [], stars = [];
      const dot = Math.max(1, 1.1 * Math.sqrt(s));
      for (let i = 0; i < sim.n; i++) {
        const kind = sim.kind[i];
        if (kind === STAR) { stars.push(i); continue; }
        if (kind === BODY) { bodies.push(i); continue; }
        const dx = sim.x[i] - bh.x, dy = sim.y[i] - bh.y;
        const dvx = sim.vx[i] - bh.vx, dvy = sim.vy[i] - bh.vy;
        const r = Math.hypot(dx, dy) + 1e-6, v2 = dvx * dvx + dvy * dvy;
        let b = 0;
        const vc2 = GM / Math.sqrt(r * r + 4) + vh2 * r * r / (r * r + rc2);
        if (v2 < 2 * vc2) {
          // Brighter the closer it is to a circular orbit (the hole's pull plus the halo's).
          const vt = Math.abs(dx * dvy - dy * dvx) / r, vr = Math.abs(dx * dvx + dy * dvy) / r;
          const vc = Math.sqrt(vc2);
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
      // The galaxy's bulge: old stars and the halo's core, a soft glow once it gathers.
      if (gal && gal.on > 0.05) {
        const g = Math.max(20, gal.rc * s * 1.3), bx = ox + bh.x * s, by = oy + bh.y * s;
        ctx.globalAlpha = 0.2 * gal.on;
        ctx.drawImage(glowSprite([255, 214, 170]), bx - g, by - g, g * 2, g * 2);
        ctx.globalAlpha = 1;
      }

      // Stars: one batch of dots per tint, with a small glow on the massive blue ones.
      const starPaths = STAR_TINTS.map(() => new Path2D());
      // Dots grow with the zoom, so a galaxy reads the same on a phone and a wide screen.
      const sq = Math.max(0.7, 0.7 * s), mote = k.mote || 1;
      ctx.globalAlpha = 0.55;
      for (const i of stars) {
        const m = sim.m[i];
        const x = ox + sim.x[i] * s, y = oy + sim.y[i] * s;
        let t = 0;
        while (m / mote >= STAR_TINTS[t].below) t++;
        const d = STAR_TINTS[t].dot * sq;
        starPaths[t].rect(x - d / 2, y - d / 2, d, d);
        if (m / mote >= 3.5) {
          const g = (5 + (m / mote) * 1.2) * sq * (1 + 0.08 * Math.sin(now * 3 + i));
          ctx.drawImage(glowSprite(BLUE), x - g / 2, y - g / 2, g, g);
        }
      }
      ctx.globalAlpha = 1;
      starPaths.forEach((p, t) => { ctx.fillStyle = STAR_TINTS[t].fill; ctx.fill(p); });

      this.drawHole(sim, now);

      for (let f = this.flashes.length - 1; f >= 0; f--) {
        const fl = this.flashes[f];
        fl.t += dt;
        if (fl.t > fl.life) { this.flashes.splice(f, 1); continue; }
        const p = fl.t / fl.life;
        const rgb = { ignite: '255, 220, 160', supernova: '180, 220, 255', shred: '255, 140, 170', swallow: '255, 180, 110', wind: '190, 170, 255', evaporate: '200, 230, 255' }[fl.type] || '255, 255, 255';
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
