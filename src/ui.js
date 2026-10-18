// The panels around the arena: HUD, constants, goals, briefings, results, archive.
(function (MOTE) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  function sci(v) {
    const e = Math.floor(Math.log10(v));
    return `${(v / Math.pow(10, e)).toFixed(1)}×10<sup>${e}</sup>`;
  }

  // Each constant this level rolled, and the real equation it feeds.
  const CONSTANTS = [
    { key: 'G', sym: 'G', name: 'Gravitational constant', eq: 'F = G·m₁m₂ / r²', fmt: (v) => v.toFixed(2) },
    { key: 'c', sym: 'c', name: 'Speed of light', eq: 'r<sub>s</sub> = 2GM / c²', fmt: (v) => v.toFixed(1) },
    { key: 'T', sym: 'T', name: 'Gas temperature', eq: 'M<sub>J</sub> ∝ (T / G)<sup>3/2</sup>', fmt: (v) => `${Math.round(v * MOTE.KELVIN)} K` },
    { key: 'gamma', sym: 'γ', name: 'Gas drag', eq: 'dv/dt = −γv', fmt: (v) => v.toFixed(2) },
    { key: 'e', sym: 'e', name: 'Coefficient of restitution', eq: 'v′ = −e·v', fmt: (v) => v.toFixed(2) },
    { key: 'eta', sym: 'η', name: 'Radiative efficiency', eq: 'L = η·Ṁc²', fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'opacity', sym: 'κ', name: 'Opacity', eq: 'L<sub>Edd</sub> = 4πGMc / κ', fmt: (v) => v.toFixed(2) },
    { key: 'hbar', sym: 'ħ', name: 'Planck constant', eq: 'dM/dt = −ħc⁴ / 15360πG²M²', fmt: sci },
    { key: 'tau', sym: 'τ', name: 'Stellar lifetime at 100 M', eq: 't = τ·(M / 100)<sup>−2.5</sup>', fmt: (v) => `${Math.round(v)} s` },
  ];

  // What those constants add up to, for this level.
  const DERIVED = [
    { sym: 'r<sub>s</sub>', name: 'Your starting event horizon', value: (k) => (2 * k.G * k.M0 / (k.c * k.c)).toFixed(1) },
    { sym: 'M<sub>J</sub>', name: 'Jeans mass: heavier clumps collapse into stars', value: (k) => `${Math.round(k.MJ)} M` },
    { sym: 't<sub>ev</sub>', name: 'Time until you evaporate if you never eat', value: (k) => `${Math.round(k.tEvap)} s` },
    { sym: 'd<sub>R</sub>', name: 'Roche limit: tides tear apart what comes closer', value: () => '2.44·R·(M/m)<sup>1/3</sup>' },
  ];

  // Time runs from 0.1× to 5× on a logarithmic slider, with a detent at 1×.
  const TIME_MIN = 0.1, TIME_MAX = 5, TIME_RES = 1000;
  const TIME_STOPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5]; // for [ and ]
  const TIME_SPAN = Math.log(TIME_MAX / TIME_MIN);
  const timeToPos = (v) => Math.round(Math.log(v / TIME_MIN) / TIME_SPAN * TIME_RES);
  function posToTime(p) {
    const v = TIME_MIN * Math.exp(p / TIME_RES * TIME_SPAN);
    if (Math.abs(Math.log(v)) < 0.07) return 1;
    return v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
  }
  const fmtTime = (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)}×`;

  class UI {
    constructor(game, renderer) {
      this.game = game;
      this.renderer = renderer;
      this.lastToast = {};
      this.onLayout = () => {};
      this.bind();
      this.setTimeScale(game.save.timeScale || 1, false);
      game.on((type, data) => this.onEvent(type, data));
    }

    bind() {
      document.querySelectorAll('[data-close]').forEach((b) =>
        b.addEventListener('click', () => b.closest('dialog').close()));
      // Esc on the briefing resumes instead of leaving the game in limbo.
      $('#briefing').addEventListener('cancel', (e) => { e.preventDefault(); this.launch(); });
      $('#result').addEventListener('cancel', (e) => e.preventDefault());
      $('#brief-go').addEventListener('click', () => this.launch());
      $('#brief-restart').addEventListener('click', () => this.onSetup(false));
      $('#brief-new').addEventListener('click', () => this.onSetup(true));
      $('#pause').addEventListener('click', () => this.game.pause());
      $('#archive-btn').addEventListener('click', () => {
        this.game.pause();
        this.renderArchive();
        $('#archive').showModal();
      });
      $('#archive').addEventListener('close', () => { if (this.game.status === 'paused') this.brief(true); });
      $('#consts-toggle').addEventListener('click', () => $('#consts').classList.toggle('open'));
      const slider = $('#time-scale');
      slider.addEventListener('input', () => this.setTimeScale(posToTime(+slider.value), false));
      slider.addEventListener('change', () => {
        slider.value = timeToPos(this.game.save.timeScale); // settle onto the detent
        this.game.persist();
      });
      // Let go of the slider and the arrow keys go back to steering.
      slider.addEventListener('pointerup', () => slider.blur());
      $('#time-reset').addEventListener('click', () => this.setTimeScale(1, true));
      $('#reset').addEventListener('click', () => $('#confirm-reset').showModal());
      $('#reset-go').addEventListener('click', () => {
        this.game.reset();
        this.setTimeScale(1, false);
        $('#confirm-reset').close();
        $('#archive').close();
        this.onSetup(false);
      });
    }

    // Main asks the UI to (re)build a level; the arena takes the screen's shape.
    onSetup(reroll) {
      this.game.setup(this.renderer.aspect(), reroll);
      this.onLayout();
      this.renderer.clear();
    }

    setTimeScale(v, persist) {
      v = Math.min(TIME_MAX, Math.max(TIME_MIN, v));
      this.game.save.timeScale = v;
      const slider = $('#time-scale'), label = $('#time-reset');
      if (posToTime(+slider.value) !== v) slider.value = timeToPos(v);
      label.textContent = fmtTime(v);
      label.classList.toggle('slow', v < 1);
      label.classList.toggle('fast', v > 1);
      slider.setAttribute('aria-valuetext', `${fmtTime(v).slice(0, -1)} times normal speed`);
      if (persist) this.game.persist();
    }

    // [ and ] step through the stops on either side of the current speed.
    nudgeTime(dir) {
      const v = this.game.save.timeScale;
      const next = dir > 0 ? TIME_STOPS.find((s) => s > v + 1e-6) : [...TIME_STOPS].reverse().find((s) => s < v - 1e-6);
      if (next !== undefined) this.setTimeScale(next, true);
    }

    // Say so when a device can't keep up with fast-forward.
    showPace(pace) {
      const el = $('#time-pace'), want = this.game.save.timeScale;
      const lagging = want > 1 && pace < want * 0.85;
      el.hidden = !lagging;
      if (lagging) el.textContent = `This device is keeping up at ${pace.toFixed(1)}×`;
    }

    launch() {
      $('#briefing').close();
      this.game.play();
    }

    onEvent(type, data) {
      if (type === 'setup') { this.fillLevel(); this.brief(false); }
      if (type === 'paused') this.brief(true);
      if (type === 'goal') this.toast(`Goal complete: <b>${data.text}</b>`, 'good');
      if (type === 'complete') this.showComplete();
      if (type === 'failed') this.showFailed();
    }

    // Sim events become toasts, at most one of each kind every couple of seconds.
    simEvent(ev) {
      const now = performance.now();
      if (now - (this.lastToast[ev.type] || 0) < 2500) return;
      this.lastToast[ev.type] = now;
      const text = {
        ignite: ['A clump passed the Jeans mass. <b>A star ignites.</b>', ''],
        supernova: ['<b>Supernova.</b> A star returns its gas to the box.', ''],
        shred: [ev.star ? '<b>Tidal disruption.</b> You tore a star apart.' : 'Tides <b>shredded a clump.</b>', 'bad'],
        swallow: ['<b>Star swallowed</b> whole.', 'bad'],
      }[ev.type];
      if (text) this.toast(text[0], text[1]);
    }

    toast(html, cls = '') {
      const el = document.createElement('div');
      el.className = `toast ${cls}`;
      el.innerHTML = html;
      $('#toasts').appendChild(el);
      setTimeout(() => el.remove(), 3700);
      const all = $('#toasts').children;
      if (all.length > 3) all[0].remove();
    }

    fillLevel() {
      const g = this.game, k = g.level.constants;
      $('#level-name').textContent = `Level ${g.level.number}`;
      $('#brief-level').textContent = g.level.number;
      $('#brief-tip').textContent = g.level.tip || '';
      $('#brief-goals').innerHTML = g.goals.map((goal) => `<li>${goal.text}</li>`).join('');
      $('#brief-consts').innerHTML = CONSTANTS.map((c) => `<div>
          <span class="sym">${c.sym}</span><span class="val">${c.fmt(k[c.key])}</span>
          <span class="about">${c.name}<span>${c.eq}</span></span></div>`).join('')
        + DERIVED.map((d) => `<div class="derived">
          <span class="sym">${d.sym}</span><span class="val">${d.value(k)}</span>
          <span class="about">${d.name}</span></div>`).join('');
      $('#const-list').innerHTML = `<dl class="kv">${CONSTANTS.map((c) =>
        `<dt>${c.sym}</dt><dd title="${c.name}">${c.fmt(k[c.key])}</dd>`).join('')}
        <div class="sep"></div>
        <dt class="derived">M<sub>J</sub></dt><dd class="derived" title="Jeans mass">${Math.round(k.MJ)} M</dd></dl>`;
      $('#goal-list').innerHTML = g.goals.map((goal, i) => `<li class="goal" data-i="${i}">
          <div class="top"><span>${goal.text}</span><span class="val"></span></div>
          <div class="bar"><i></i></div></li>`).join('');
      this.update();
    }

    brief(paused) {
      $('#brief-eyebrow').textContent = paused ? 'Paused · Level' : 'Level';
      $('#brief-go').textContent = paused ? 'Resume' : 'Launch';
      const dlg = $('#briefing');
      if (!dlg.open) dlg.showModal();
      dlg.scrollTop = 0;
      $('#brief-go').focus({ preventScroll: true });
    }

    update() {
      const g = this.game, sim = g.sim;
      if (!sim) return;
      const bh = sim.bh, k = sim.k;
      $('#mass').textContent = Math.round(bh.m);
      $('.mass').classList.toggle('danger', bh.m < k.M0 * 0.6 && bh.net < 0);
      const net = $('#net');
      net.textContent = `${bh.net >= 0 ? '+' : '−'}${Math.abs(bh.net).toFixed(1)} M/s${bh.net < 0 ? ' · evaporating' : ''}`;
      net.className = bh.net >= 0.05 ? 'gain' : bh.net < 0 ? 'loss' : '';
      $('#horizon').innerHTML = `r<sub>s</sub> ${sim.horizon().toFixed(1)}`;
      const edd = $('#edd');
      edd.innerHTML = `L/L<sub>Edd</sub> ${bh.eddington.toFixed(2)}`;
      edd.classList.toggle('hot', bh.eddington > 1);
      if (g.metrics) $('#structure').textContent = MOTE.classify(sim, g.metrics);
      g.goals.forEach((goal, i) => {
        const el = document.querySelector(`#goal-list [data-i="${i}"]`);
        if (!el) return;
        el.classList.toggle('done', goal.done);
        const value = goal.type === 'mass' ? Math.round(goal.value) : goal.value;
        let text = `${value} / ${goal.target}`;
        let frac = Math.min(1, goal.value / goal.target);
        if (goal.hold && goal.held > 0 && !goal.done) {
          text += ` · ${Math.floor(goal.held)}/${goal.hold}s`;
          frac = goal.held / goal.hold;
        }
        if (goal.done) { text = 'done'; frac = 1; }
        el.querySelector('.val').textContent = text;
        el.querySelector('i').style.width = `${Math.round(frac * 100)}%`;
      });
    }

    showComplete() {
      const g = this.game, sim = g.sim;
      const img = this.renderer.snapshot(sim);
      const name = MOTE.classify(sim, g.metrics);
      $('#result-img').src = img;
      $('#result-title').textContent = `Level ${g.level.number} complete`;
      $('#result-text').textContent = `You shaped a ${name.toLowerCase()} in ${Math.round(sim.time)}s, at ${Math.round(sim.bh.m)} M, with ${sim.stats.starsFormed} star${sim.stats.starsFormed === 1 ? '' : 's'} ignited along the way. It's in your archive.`;
      this.actions([['Next level', 'primary', () => { g.advance(img); this.onSetup(false); }]]);
      $('#result').showModal();
    }

    showFailed() {
      $('#result-img').src = '';
      $('#result-title').textContent = 'Evaporated';
      $('#result-text').innerHTML = 'Hawking radiation took the last of you: dM/dt = −ħc⁴ / 15360πG²M². The smaller a black hole is, the faster it radiates, so feed early and keep feeding until you are out of danger.';
      this.actions([
        ['New constants', '', () => this.onSetup(true)],
        ['Try again', 'primary', () => this.onSetup(false)],
      ]);
      $('#result').showModal();
    }

    actions(list) {
      const row = $('#result-actions');
      row.innerHTML = '';
      for (const [label, cls, fn] of list) {
        const b = document.createElement('button');
        b.textContent = label;
        if (cls) b.className = cls;
        b.addEventListener('click', () => { $('#result').close(); fn(); });
        row.appendChild(b);
      }
    }

    renderArchive() {
      const s = this.game.save;
      $('#best').textContent = `reached level ${s.best}`;
      const el = $('#gallery');
      if (!s.archive.length) {
        el.innerHTML = '<p class="empty">Nothing yet. Finish a level and the structure you built is kept here.</p>';
        return;
      }
      el.innerHTML = '';
      for (const p of s.archive) {
        const fig = document.createElement('figure');
        fig.className = 'plate';
        const img = document.createElement('img');
        img.src = p.img; img.alt = p.name;
        const cap = document.createElement('figcaption');
        cap.textContent = `Level ${p.level} · ${p.name}`;
        const meta = document.createElement('span');
        const c = p.constants;
        meta.textContent = `${p.mass} M · ${p.stars}★ · ${p.time}s\nG ${c.G.toFixed(1)} · c ${c.c.toFixed(0)} · T ${Math.round(c.T * MOTE.KELVIN)} K · η ${Math.round(c.eta * 100)}%`;
        meta.style.whiteSpace = 'pre-line';
        cap.appendChild(meta);
        fig.append(img, cap);
        el.appendChild(fig);
      }
    }
  }

  MOTE.UI = UI;
})(window.MOTE);
