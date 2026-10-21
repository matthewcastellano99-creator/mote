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
    { key: 'tau', sym: 'τ', name: 'Stellar lifetime', eq: 't = τ·(M / 1.75)<sup>−2.5</sup>', fmt: (v) => `${Math.round(v)} s` },
    { key: 'vHalo', sym: 'v<sub>h</sub>', name: 'Dark-halo circular speed', eq: 'v<sub>h</sub> ∝ M<sup>1/4</sup> (the M–σ relation)', fmt: (v) => v.toFixed(1) },
    { key: 'arms', sym: 'm', name: 'Arms the disk favours', eq: 'm ∝ M<sub>halo</sub> / M<sub>disk</sub> (swing amplification)', fmt: (v) => String(v) },
  ];

  // What those constants add up to, for this level.
  const DERIVED = [
    { sym: 'r<sub>s</sub>', name: 'Your starting event horizon', value: (k) => (2 * k.G * k.M0 / (k.c * k.c)).toFixed(1) },
    { sym: 'M<sub>J</sub>', name: 'Jeans mass: heavier clumps collapse into stars', value: (k) => `${Math.round(k.MJ)} M` },
    { sym: 't<sub>ev</sub>', name: 'Time until you evaporate if you never eat', value: (k) => `${Math.round(k.tEvap)} s` },
    { sym: 'M<sub>halo</sub>', name: 'Your mass when the dark halo gathers and the galaxy begins', value: (k) => `${Math.round(2.5 * k.M0)}–${Math.round(Math.min(3.2 * k.M0, k.Mcap))} M` },
    { sym: 'M<sub>max</sub>', name: 'Your largest mass: past it, what falls in is blown back out', value: (k) => `${Math.round(k.Mcap)} M` },
    { sym: 'd<sub>R</sub>', name: 'Roche limit: tides tear apart what comes closer', value: () => '2.44·R·(M/m)<sup>1/3</sup>' },
    { sym: '1 s', name: (k) => `Cosmic time per second: the arms here turn once every ${Math.round(k.tGal)} s, the Milky Way's once every ~230 million years (Myr)`, value: (k) => myr(k) },
  ];
  // The years one second of play stands for, as "5.3 Myr".
  const myr = (k) => `${(k.yearsPerSec / 1e6).toFixed(1)} Myr`;
  const UNIVERSE_AGE = 13.8e9;

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
      this.toastCount = {};
      this.onLayout = () => {};
      this.onTimeChange = () => {};
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
      // While admiring a finished galaxy, the Pause button becomes Next level.
      $('#pause').addEventListener('click', () => (this.game.status === 'admiring' ? this.nextLevel() : this.game.pause()));
      $('#archive-btn').addEventListener('click', () => {
        this.game.pause();
        this.renderArchive();
        $('#archive').showModal();
      });
      $('#archive').addEventListener('close', () => { if (this.game.status === 'paused') this.brief(true); });
      $('#consts-toggle').addEventListener('click', () => $('#consts').classList.toggle('open'));
      const slider = $('#time-scale');
      slider.addEventListener('input', () => this.setTimeScale(posToTime(+slider.value), false));
      slider.addEventListener('change', () => this.game.persist());
      // Let go of a drag: settle onto the detent, and give the arrow keys back to steering.
      slider.addEventListener('pointerup', () => {
        slider.value = timeToPos(this.game.save.timeScale);
        slider.blur();
      });
      // From the keyboard, the slider steps through the same stops as [ and ]; a raw
      // step of the log scale is too small to leave the 1× detent.
      slider.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowUp: 1, PageUp: 1, ArrowLeft: -1, ArrowDown: -1, PageDown: -1 }[e.key];
        if (dir) this.nudgeTime(dir);
        else if (e.key === 'Home') this.setTimeScale(TIME_MIN, true);
        else if (e.key === 'End') this.setTimeScale(TIME_MAX, true);
        else return;
        e.preventDefault();
      });
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
      const g = this.game;
      if (reroll) g.reroll();
      // Lay out this level's goal cards first, so the box is shaped for the space it gets.
      const draft = MOTE.generateLevel(g.save.level, g.save.seed, this.renderer.aspect());
      this.goalCards(draft.goals.map((goal) => ({ text: MOTE.goalText(goal) })));
      this.onLayout();
      g.setup(this.renderer.aspect(), false);
      this.renderer.clear();
    }

    goalCards(goals) {
      $('#goal-list').innerHTML = goals.map((goal, i) => `<li class="goal" data-i="${i}">
          <div class="top"><span>${goal.text}</span><span class="val"></span></div>
          <div class="bar"><i></i></div></li>`).join('');
    }

    setTimeScale(v, persist) {
      v = Number(v);
      if (!Number.isFinite(v) || v <= 0) v = 1; // a missing or corrupt saved value
      v = Math.min(TIME_MAX, Math.max(TIME_MIN, v));
      this.game.save.timeScale = v;
      const slider = $('#time-scale'), label = $('#time-reset');
      if (posToTime(+slider.value) !== v) slider.value = timeToPos(v);
      label.textContent = fmtTime(v);
      label.classList.toggle('slow', v < 1);
      label.classList.toggle('fast', v > 1);
      slider.setAttribute('aria-valuetext', `${fmtTime(v).slice(0, -1)} times normal speed`);
      this.lagFor = 0;
      this.onTimeChange(v);
      if (persist) this.game.persist();
    }

    // [ and ] step through the stops on either side of the current speed.
    nudgeTime(dir) {
      const v = this.game.save.timeScale;
      const next = dir > 0 ? TIME_STOPS.find((s) => s > v + 1e-6) : [...TIME_STOPS].reverse().find((s) => s < v - 1e-6);
      if (next !== undefined) this.setTimeScale(next, true);
    }

    // Say so when a device can't keep up with fast-forward, once it has fallen
    // behind for a whole second (not while it is still spinning up).
    showPace(pace, dt) {
      const want = this.game.save.timeScale;
      this.lagFor = want > 1 && pace < want * 0.85 ? (this.lagFor || 0) + dt : 0;
      const lagging = this.lagFor >= 1;
      const phone = window.matchMedia('(max-width: 720px)').matches;
      $('#time-pace').hidden = !lagging || phone;
      $('#time-pace').textContent = lagging ? `This device is keeping up at ${pace.toFixed(1)}×` : '';
      $('#time-label').textContent = lagging && phone ? `Time ${pace.toFixed(1)}×` : 'Time';
    }

    launch() {
      $('#briefing').close();
      this.game.play();
    }

    onEvent(type, data) {
      if (type === 'setup') {
        this.toastCount = {};
        this.olderThanUniverse = false;
        $('#pause').textContent = 'Pause';
        $('#pause').classList.remove('primary');
        this.fillLevel();
        this.brief(false);
      }
      if (type === 'admiring') {
        $('#pause').textContent = 'Next level';
        $('#pause').classList.add('primary');
        this.toast('Your galaxy keeps evolving. <b>Speed up time</b> to watch it wind up.', 'good');
      }
      if (type === 'halo') this.toast('<b>A dark halo gathers.</b> The gas begins to wheel around you.', 'good');
      if (type === 'paused') this.brief(true);
      if (type === 'goal') this.toast(`Goal complete: <b>${data.text}</b>`, 'good');
      if (type === 'complete') this.showComplete();
      if (type === 'failed') this.showFailed();
    }

    // Sim events become toasts: the first few of each kind in a level (a galaxy lights
    // hundreds of clusters), and never more than one of a kind every couple of seconds.
    simEvent(ev) {
      const LIMIT = { ignite: 3, supernova: 2, shred: 4, swallow: 3, wind: 1 };
      const seen = (this.toastCount[ev.type] || 0);
      const now = performance.now();
      if (seen >= (LIMIT[ev.type] || 0) || now - (this.lastToast[ev.type] || 0) < 2500) return;
      this.toastCount[ev.type] = seen + 1;
      this.lastToast[ev.type] = now;
      const text = {
        ignite: ['A clump passed the Jeans mass. <b>A star cluster ignites.</b>', ''],
        supernova: ['<b>Supernova.</b> A massive star returns its gas.', ''],
        shred: [ev.star ? '<b>Tidal disruption.</b> You tore a star apart.' : 'Tides <b>shredded a clump.</b>', 'bad'],
        swallow: ['<b>Star swallowed</b> whole.', 'bad'],
        wind: ['<b>You are full.</b> What falls in now is blown back out as a wind.', ''],
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
          <span class="about">${typeof d.name === 'function' ? d.name(k) : d.name}</span></div>`).join('');
      $('#const-list').innerHTML = `<dl class="kv">${CONSTANTS.map((c) =>
        `<dt>${c.sym}</dt><dd title="${c.name}">${c.fmt(k[c.key])}</dd>`).join('')}
        <div class="sep"></div>
        <dt class="derived">M<sub>J</sub></dt><dd class="derived" title="Jeans mass">${Math.round(k.MJ)} M</dd>
        <dt class="derived">1 s</dt><dd class="derived" title="Cosmic time per second of play">${myr(k)}</dd></dl>`;
      this.goalCards(g.goals);
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
      const [age, unit] = MOTE.formatYears(g.years);
      $('#age').textContent = age;
      $('#age-unit').textContent = unit;
      if (g.years > UNIVERSE_AGE && !this.olderThanUniverse) {
        this.olderThanUniverse = true;
        this.toast('Your galaxy is now <b>older than our universe</b>: 13.8 billion years.', 'good');
      }
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
        if (goal.type === 'galaxy' && !goal.done) {
          // Before the halo gathers there is nothing to measure: show the way there.
          const wake = 2.5 * k.M0;
          if (!g.metrics || g.metrics.halo < 0.5) {
            text = `halo at ${Math.round(wake)} M · ${Math.round(bh.m)}`;
            frac = Math.min(1, bh.m / wake) * 0.5;
          } else {
            text = `arms ${goal.value} / ${goal.target}`;
            frac = 0.5 + 0.5 * Math.min(1, goal.value / goal.target);
          }
        }
        if (goal.hold && goal.held > 0 && !goal.done) {
          text += ` · ${Math.floor(goal.held)}/${goal.hold}s`;
          frac = goal.held / goal.hold;
        }
        if (goal.done) { text = 'done'; frac = 1; }
        el.querySelector('.val').textContent = text;
        el.querySelector('i').style.width = `${Math.round(frac * 100)}%`;
      });
    }

    // Keep the galaxy as it looks right now, and move on.
    nextLevel() {
      const g = this.game;
      g.advance(this.renderer.snapshot(g.sim));
      this.onSetup(false);
    }

    showComplete() {
      const g = this.game, sim = g.sim, fm = g.finalMetrics(), sp = fm.spiral;
      const img = this.renderer.snapshot(sim);
      const name = MOTE.classify(sim, fm);
      $('#result-img').src = img;
      $('#result-title').textContent = `Level ${g.level.number}: ${name}`;
      const took = `${MOTE.yearsText(g.years)} (${Math.round(sim.time)} s of play)`;
      $('#result-text').textContent = sp.score > 0
        ? `In ${took} you grew to ${Math.round(sim.bh.m)} M and built a galaxy around yourself: ${sp.m} arm${sp.m === 1 ? '' : 's'} winding out at a ${Math.round(sp.pitch)}° pitch, ${fm.stars.toLocaleString()} stars from ${sim.stats.starsFormed} clusters.`
        : `You shaped a ${name.toLowerCase()} in ${took}, at ${Math.round(sim.bh.m)} M.`;
      $('#result-text').textContent += ' Young galaxies keep winding up: keep watching, and the archive keeps it as it looks when you move on.';
      this.actions([
        ['Keep watching', '', () => g.admire()],
        ['Next level', 'primary', () => this.nextLevel()],
      ]);
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
        el.innerHTML = '<p class="empty">Nothing yet. Finish a level and the galaxy you built is kept here.</p>';
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
        const arms = p.arms ? `${p.arms} arm${p.arms === 1 ? '' : 's'} · ${p.pitch}° pitch · ` : '';
        // Plates from before cosmic time was kept show their seconds of play instead.
        const age = p.years ? MOTE.yearsText(p.years) : `${p.time} s`;
        meta.textContent = `${arms}${p.mass} M · ${p.stars.toLocaleString()}★\nage ${age}\nG ${c.G.toFixed(1)} · c ${c.c.toFixed(0)} · T ${Math.round(c.T * MOTE.KELVIN)} K · η ${Math.round(c.eta * 100)}%`;
        meta.style.whiteSpace = 'pre-line';
        cap.appendChild(meta);
        fig.append(img, cap);
        el.appendChild(fig);
      }
    }
  }

  MOTE.UI = UI;
})(window.MOTE);
