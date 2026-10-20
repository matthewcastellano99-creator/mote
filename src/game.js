// The game around the physics: levels, goals, winning, evaporating, the archive.
(function (MOTE) {
  'use strict';

  const SAVE_KEY = 'mote.save.v2';

  const GOAL_TEXT = {
    mass: (g) => `Grow to ${g.target} M`,
    disk: (g) => `Hold ${g.target} M of gas in orbit for ${g.hold}s`,
    stars: (g) => `Ignite ${g.target} star cluster${g.target > 1 ? 's' : ''}`,
    shred: (g) => `Tear apart ${g.target} clump${g.target > 1 ? 's' : ''} or star${g.target > 1 ? 's' : ''} with tides`,
    galaxy: (g) => `Grow a spiral galaxy and hold it for ${g.hold}s`,
  };

  function newSeed() { return (Math.random() * 2 ** 31) >>> 0; }
  MOTE.goalText = (g) => GOAL_TEXT[g.type](g);

  function freshSave() {
    return { level: 1, best: 1, seed: newSeed(), archive: [], seenIntro: false, timeScale: 1 };
  }

  class Game {
    constructor() {
      this.save = this.load() || freshSave();
      this.listeners = [];
      // idle → briefing → playing ⇄ paused → complete (→ admiring) | failed
      this.status = 'idle';
    }

    on(fn) { this.listeners.push(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }

    // Build the current level. A retry keeps its constants; `reroll` draws new ones.
    setup(aspect, reroll) {
      if (reroll) this.save.seed = newSeed();
      this.level = MOTE.generateLevel(this.save.level, this.save.seed, aspect);
      this.sim = new MOTE.Sim(this.level);
      this.goals = this.level.goals.map((g) => ({ ...g, value: 0, held: 0, done: false, text: GOAL_TEXT[g.type](g) }));
      this.metrics = MOTE.measure(this.sim);
      this.recent = []; // the last ten seconds of spiral measurements
      this.haloAnnounced = false;
      this.status = 'briefing';
      this.persist();
      this.emit('setup', this.level);
    }

    reroll() { this.save.seed = newSeed(); }

    play() { if (this.status === 'briefing' || this.status === 'paused') this.status = 'playing'; }
    pause() { if (this.status === 'playing') { this.status = 'paused'; this.emit('paused'); } }
    // After winning, the galaxy keeps evolving for as long as the player cares to watch.
    admire() { if (this.status === 'complete') { this.status = 'admiring'; this.emit('admiring'); } }
    get running() { return this.status === 'playing' || this.status === 'admiring'; }

    // Called a few times per second of simulated time.
    tick(dt) {
      if (!this.running) return;
      const sim = this.sim, m = this.metrics = MOTE.measure(sim);
      this.recent.push({ t: sim.time, spiral: m.spiral });
      while (this.recent.length && this.recent[0].t < sim.time - 10) this.recent.shift();
      if (this.status === 'admiring') return; // won already: just keep watching
      if (m.halo >= 0.5 && !this.haloAnnounced) { this.haloAnnounced = true; this.emit('halo'); }
      for (const g of this.goals) {
        if (g.type === 'mass') g.value = sim.bh.m;
        else if (g.type === 'disk') g.value = Math.round(m.orbitingMass);
        else if (g.type === 'stars') g.value = sim.stats.starsFormed;
        else if (g.type === 'galaxy') g.value = Math.round(m.spiral.score * 100);
        else if (g.type === 'shred') g.value = sim.stats.shredded;
        if (g.done) continue;
        if (g.hold) {
          // Orbits wobble in and out of the count, so hold goals track a smoothed
          // value, and the timer drains back down rather than resetting.
          g.smooth = (g.smooth || 0) + (g.value - (g.smooth || 0)) * Math.min(1, dt / 1.5);
          g.value = Math.round(g.smooth);
          g.held = g.value >= g.target ? g.held + dt : Math.max(0, g.held - dt);
          if (g.held >= g.hold) g.done = true;
        } else if (g.value >= g.target) {
          g.done = true;
        }
        if (g.done) this.emit('goal', g);
      }
      if (sim.evaporated) {
        this.status = 'failed';
        this.emit('failed');
      } else if (this.goals.every((g) => g.done)) {
        this.status = 'complete';
        this.emit('complete');
      }
    }

    // The galaxy as it stands, judged by its best spiral of the last ten seconds, so a
    // momentary dip in the arms doesn't rename it.
    finalMetrics() {
      const best = this.recent.reduce((a, b) => (b.spiral.score > a.spiral.score ? b : a), { spiral: this.metrics.spiral });
      return { ...this.metrics, spiral: best.spiral };
    }

    // Record the finished level in the archive and move on.
    advance(snapshot) {
      const s = this.save, k = this.level.constants, fm = this.finalMetrics();
      s.archive.unshift({
        level: this.level.number,
        name: MOTE.classify(this.sim, fm),
        arms: fm.spiral.m, pitch: Math.round(fm.spiral.pitch),
        img: snapshot,
        mass: Math.round(this.sim.bh.m),
        time: Math.round(this.sim.time),
        stars: fm.stars,
        constants: { G: k.G, c: k.c, T: k.T, eta: k.eta },
        when: Date.now(),
      });
      if (s.archive.length > 40) s.archive.length = 40;
      s.level += 1;
      s.best = Math.max(s.best, s.level);
      s.seed = newSeed();
      this.persist();
    }

    persist() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) {
        // Storage may be full or blocked; the game plays on without saving.
      }
    }

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        return raw ? Object.assign(freshSave(), JSON.parse(raw)) : null;
      } catch (e) {
        return null;
      }
    }

    reset() {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ }
      this.save = freshSave();
      this.save.seenIntro = true;
    }
  }

  MOTE.Game = Game;
})(typeof window !== 'undefined' ? window.MOTE : globalThis.MOTE);
