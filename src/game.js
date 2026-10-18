// The game around the physics: levels, goals, winning, evaporating, the archive.
(function (MOTE) {
  'use strict';

  const SAVE_KEY = 'mote.save.v2';

  const GOAL_TEXT = {
    mass: (g) => `Grow to ${g.target} M`,
    disk: (g) => `Hold ${g.target} M of gas in orbit for ${g.hold}s`,
    stars: (g) => `Ignite ${g.target} star${g.target > 1 ? 's' : ''}`,
    orbitStars: (g) => `Keep ${g.target} star${g.target > 1 ? 's' : ''} orbiting you for ${g.hold}s`,
    shred: (g) => `Tear apart ${g.target} clump${g.target > 1 ? 's' : ''} or star${g.target > 1 ? 's' : ''} with tides`,
  };

  function newSeed() { return (Math.random() * 2 ** 31) >>> 0; }

  function freshSave() {
    return { level: 1, best: 1, seed: newSeed(), archive: [], seenIntro: false };
  }

  class Game {
    constructor() {
      this.save = this.load() || freshSave();
      this.listeners = [];
      this.status = 'idle'; // idle → briefing → playing ⇄ paused → complete | failed
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
      this.status = 'briefing';
      this.persist();
      this.emit('setup', this.level);
    }

    play() { if (this.status === 'briefing' || this.status === 'paused') this.status = 'playing'; }
    pause() { if (this.status === 'playing') { this.status = 'paused'; this.emit('paused'); } }

    // Called a few times per second of simulated time.
    tick(dt) {
      if (this.status !== 'playing') return;
      const sim = this.sim, m = this.metrics = MOTE.measure(sim);
      for (const g of this.goals) {
        if (g.type === 'mass') g.value = sim.bh.m;
        else if (g.type === 'disk') g.value = Math.round(m.orbitingMass);
        else if (g.type === 'stars') g.value = sim.stats.starsFormed;
        else if (g.type === 'orbitStars') g.value = m.orbitingStars;
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

    // Record the finished level in the archive and move on.
    advance(snapshot) {
      const s = this.save, k = this.level.constants;
      s.archive.unshift({
        level: this.level.number,
        name: MOTE.classify(this.sim, this.metrics),
        img: snapshot,
        mass: Math.round(this.sim.bh.m),
        time: Math.round(this.sim.time),
        stars: this.sim.stats.starsFormed,
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
