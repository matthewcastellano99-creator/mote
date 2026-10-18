// The game around the physics: laws to unlock, order to earn, cosmoses to crystallize.
(function (MOTE) {
  'use strict';

  const SAVE_KEY = 'mote.save.v1';
  const BASE_PARTICLES = 1800;

  const cost = (base, growth) => (level) => Math.ceil(base * Math.pow(growth, level));

  // Each law is a dial on the physics. `apply` maps its level onto sim.laws.
  const LAWS = [
    {
      id: 'gravity', name: 'Gravity', max: 10, cost: cost(10, 1.6),
      desc: 'Every mote pulls on every other.',
      effect: (l) => `G = ${(1.5 * Math.pow(1.35, l)).toFixed(1)}`,
      unlock: () => true,
      apply: (l, p) => { p.G = 1.5 * Math.pow(1.35, l); },
    },
    {
      id: 'cohesion', name: 'Cohesion', max: 8, cost: cost(30, 1.7),
      desc: 'Motes stick even when they meet a little too fast.',
      effect: (l) => `sticks below ${(0.5 + 0.35 * l).toFixed(2)} speed`,
      unlock: (s) => s.cosmosOrder >= 40, hint: 'Earn 40 Order',
      apply: (l, p) => { p.stick = 0.5 + 0.35 * l; p.capture = 1 + 0.06 * l; },
    },
    {
      id: 'dissipation', name: 'Dissipation', max: 8, cost: cost(60, 1.7),
      desc: 'Collisions bleed off radial motion, so orbits settle into circles.',
      effect: (l) => `damping ${(0.05 * l).toFixed(2)}`,
      unlock: (s, m) => s.peak.biggest >= 15, hint: 'Grow a body of mass 15',
      apply: (l, p) => { p.cooling = 0.05 * l; },
    },
    {
      id: 'ignition', name: 'Ignition', max: 8, cost: cost(80, 1.9),
      desc: 'Bodies heavy enough begin to fuse, and shine.',
      effect: (l) => (l ? `stars at mass ${Math.round(90 * Math.pow(0.82, l - 1))}` : 'no fusion'),
      unlock: (s) => s.peak.biggest >= 40, hint: 'Grow a body of mass 40',
      apply: (l, p) => { p.starMass = l ? 90 * Math.pow(0.82, l - 1) : Infinity; },
    },
    {
      id: 'radiance', name: 'Radiance', max: 8, cost: cost(250, 1.8),
      desc: 'Starlight pushes dust away, carving bubbles and rings.',
      effect: (l) => `pressure ${25 * l}`,
      unlock: (s) => s.peak.stars >= 1, hint: 'Ignite a star',
      apply: (l, p) => { p.radiance = 25 * l; },
    },
    {
      id: 'mortality', name: 'Mortality', max: 6, cost: cost(200, 2),
      desc: 'Stars age and die as supernovae, returning dust to the cloud.',
      effect: (l) => (l ? `heavy stars live ${Math.round(60 * Math.pow(0.8, l - 1))}s` : 'stars are eternal'),
      unlock: (s) => s.peak.stars >= 20, hint: 'Shine 20 stars at once',
      apply: (l, p) => { p.lifespan = l ? 60 * Math.pow(0.8, l - 1) : 0; },
    },
    {
      id: 'collapse', name: 'Collapse', max: 6, cost: cost(800, 2),
      desc: 'Heavy stars die into black holes, which sink, merge and feed. Too hungry, and they devour everything.',
      effect: (l) => (l ? `stars over mass ${(14 * Math.pow(0.85, l - 1)).toFixed(1)}` : 'no singularities'),
      unlock: (s) => (s.laws.mortality || 0) >= 1, hint: 'Give stars mortality',
      apply: (l, p) => { p.holeMass = l ? 14 * Math.pow(0.85, l - 1) : Infinity; },
    },
    {
      id: 'vortex', name: 'Vortex', max: 6, cost: cost(120, 1.8),
      desc: 'A primordial swirl: matter drifts toward one shared rotation.',
      effect: (l) => `${Math.round(15 * l)}% of orbital speed`,
      unlock: (s) => s.cosmos >= 2, hint: 'Crystallize your first cosmos',
      apply: (l, p) => { p.vortex = 0.15 * l; },
    },
    {
      id: 'halo', name: 'Dark Halo', max: 6, cost: cost(500, 1.9),
      desc: 'An unseen mass cradles everything and flattens the orbits.',
      effect: (l) => `halo speed ${2 * l}`,
      unlock: (s) => s.cosmos >= 3, hint: 'Crystallize two cosmoses',
      apply: (l, p) => { p.halo = 2 * l; },
    },
  ];

  // Permanent upgrades bought with Stardust; they survive crystallization.
  const CONSTANTS = [
    {
      id: 'abundance', name: 'Abundance', max: 6, cost: cost(3, 2),
      desc: '+300 motes in every new cosmos.',
    },
    {
      id: 'resonance', name: 'Resonance', max: 25, cost: cost(2, 1.8),
      desc: '×1.25 Order from all sources.',
    },
    {
      id: 'momentum', name: 'Momentum', max: 5, cost: cost(4, 2.2),
      desc: 'Each cosmos begins with +1 Gravity.',
    },
  ];

  const MILESTONES = [
    { id: 'clump', name: 'First Clump', reward: 15, hint: 'Grow a body of mass 10', test: (m) => m.biggest >= 10 },
    { id: 'planetesimal', name: 'Planetesimal', reward: 40, hint: 'Grow a body of mass 40', test: (m) => m.biggest >= 40 },
    { id: 'ignite', name: 'First Light', reward: 250, hint: 'Ignite a star', test: (m) => m.stars >= 1 },
    { id: 'family', name: 'Star Cluster', reward: 700, hint: 'Shine 50 stars at once', test: (m) => m.stars >= 50 },
    { id: 'harmony', name: 'Harmony', reward: 300, hint: 'Coherence 70% with a rich cosmos', test: (m) => m.coherence >= 0.7 && m.richness >= 0.9 },
    { id: 'singularity', name: 'Singularity', reward: 1500, hint: 'Collapse a black hole', test: (m) => m.holes >= 1 },
    { id: 'galaxy', name: 'Galaxy', reward: 4000, hint: '200 stars turning together around a black hole', test: (m) => m.stars >= 200 && m.holes >= 1 && m.coherence >= 0.55 },
  ];

  function freshState() {
    return {
      order: 0, cosmosOrder: 0, lifetimeOrder: 0,
      stardust: 0, cosmos: 1, seed: newSeed(),
      laws: {}, unlocked: { gravity: true },
      constants: {},
      milestones: {},
      peak: { biggest: 0, stars: 0 },
      gallery: [],
      speed: 1,
    };
  }

  function newSeed() { return (Math.random() * 2 ** 31) >>> 0; }

  class Game {
    constructor() {
      this.state = freshState();
      this.metrics = null;
      this.baseline = null;
      this.listeners = [];
      this.load();
      if (!this.sim) this.newCosmos(false);
      this.applyLaws();
    }

    on(fn) { this.listeners.push(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }

    level(id) { return this.state.laws[id] || 0; }
    constant(id) { return this.state.constants[id] || 0; }

    particleCount() { return BASE_PARTICLES + 300 * this.constant('abundance'); }
    resonance() { return Math.pow(1.25, this.constant('resonance')); }

    newCosmos(advance) {
      const s = this.state;
      if (advance) { s.cosmos += 1; s.seed = newSeed(); }
      s.laws = { gravity: this.constant('momentum') };
      s.order = 0; s.cosmosOrder = 0;
      s.milestones = {};
      s.peak = { biggest: 0, stars: 0 };
      this.sim = new MOTE.Sim(this.particleCount(), s.seed);
      this.baseline = MOTE.measure(this.sim).entropy;
      s.baseline = this.baseline;
      this.applyLaws();
    }

    applyLaws() {
      for (const law of LAWS) law.apply(this.level(law.id), this.sim.laws);
    }

    lawCost(law) { return law.cost(this.level(law.id)); }

    buyLaw(id) {
      const law = LAWS.find((l) => l.id === id);
      const lvl = this.level(id);
      if (!this.state.unlocked[id] || lvl >= law.max) return false;
      const c = law.cost(lvl);
      if (this.state.order < c) return false;
      this.state.order -= c;
      this.state.laws[id] = lvl + 1;
      this.applyLaws();
      this.emit('law', law);
      return true;
    }

    constantCost(c) { return c.cost(this.constant(c.id)); }

    buyConstant(id) {
      const c = CONSTANTS.find((k) => k.id === id);
      const lvl = this.constant(id);
      if (lvl >= c.max) return false;
      const price = c.cost(lvl);
      if (this.state.stardust < price) return false;
      this.state.stardust -= price;
      this.state.constants[id] = lvl + 1;
      this.emit('constant', c);
      return true;
    }

    orderRate() {
      const m = this.metrics;
      if (!m) return 0;
      const life = 1 + 0.5 * Math.log2(1 + m.stars) + 0.5 * Math.min(m.holes, 4);
      return (1 + 12 * m.order * life) * this.resonance();
    }

    stardustGain() {
      const s = this.state, m = this.metrics;
      if (!m) return 0;
      const earned = Object.keys(s.milestones).length;
      return Math.floor(Math.sqrt(s.cosmosOrder / 50) * (0.5 + m.order)) + earned;
    }

    canCrystallize() { return this.state.cosmosOrder >= 200; }

    crystallize(snapshot) {
      if (!this.canCrystallize()) return null;
      const s = this.state, m = this.metrics;
      const gain = this.stardustGain();
      const entry = {
        cosmos: s.cosmos, seed: s.seed, name: MOTE.classify(m), img: snapshot,
        order: Math.round(m.order * 100), stars: m.stars, holes: m.holes, stardust: gain,
        when: Date.now(),
      };
      s.gallery.unshift(entry);
      if (s.gallery.length > 40) s.gallery.length = 40;
      s.stardust += gain;
      this.newCosmos(true);
      this.save();
      this.emit('crystallize', entry);
      return entry;
    }

    // Called a few times per second: measure, pay out, check unlocks and milestones.
    tick(dt) {
      const s = this.state;
      this.metrics = MOTE.measure(this.sim, this.baseline);
      const m = this.metrics;
      s.peak.biggest = Math.max(s.peak.biggest, m.biggest);
      s.peak.stars = Math.max(s.peak.stars, m.stars);
      const gain = this.orderRate() * dt;
      s.order += gain; s.cosmosOrder += gain; s.lifetimeOrder += gain;
      for (const ms of MILESTONES) {
        if (s.milestones[ms.id] || !ms.test(m)) continue;
        s.milestones[ms.id] = true;
        const reward = ms.reward * this.resonance();
        s.order += reward; s.cosmosOrder += reward; s.lifetimeOrder += reward;
        this.emit('milestone', { ...ms, reward });
      }
      for (const law of LAWS) {
        if (s.unlocked[law.id] || !law.unlock(s, m)) continue;
        s.unlocked[law.id] = true;
        this.emit('unlock', law);
      }
    }

    nextMilestone() { return MILESTONES.find((ms) => !this.state.milestones[ms.id]) || null; }

    save() {
      try {
        const data = { state: this.state, sim: this.sim.serialize(), baseline: this.baseline };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch (e) {
        // Storage may be full or blocked; the game plays on without saving.
      }
    }

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        this.state = Object.assign(freshState(), data.state);
        this.sim = MOTE.Sim.restore(data.sim);
        this.baseline = data.baseline;
      } catch (e) {
        this.state = freshState();
        this.sim = null;
      }
    }

    reset() {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ }
      this.state = freshState();
      this.newCosmos(false);
    }
  }

  MOTE.Game = Game;
  MOTE.LAWS = LAWS;
  MOTE.CONSTANTS = CONSTANTS;
  MOTE.MILESTONES = MILESTONES;
})(typeof window !== 'undefined' ? window.MOTE : globalThis.MOTE);
