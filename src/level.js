// Levels: a fresh set of physical constants, a box sized to the screen, and goals.
(function (MOTE) {
  'use strict';

  const AREA = 640 * 400; // every arena has the same area, shaped to the screen
  const M0 = 60;          // starting mass of the black hole, in mote masses
  const JEANS = 8000;     // M_J = JEANS · (T / G)^(3/2), in mote masses
  const KELVIN = 40;      // display scale for temperature: 5–35 K, like a molecular cloud
  // Resolution: motes per unit of mass. The box holds the same mass at any resolution, so
  // the physics is unchanged; there are just more, lighter motes to trace finer structure.
  const RESOLUTION = (typeof globalThis !== 'undefined' && globalThis.MOTE_RES) || 3; // MOTE_RES: for testing

  // Every level ends the same way: a spiral galaxy around you, held for a while.
  // Its target is the arm-strength score (measure.js) × 100: 15 is clearly visible.
  const galaxy = (d) => ({ type: 'galaxy', target: 15 + Math.round(5 * d), hold: 10 + Math.round(5 * d) });

  // The first levels teach one idea each on the way there; after that, goals are drawn
  // at random.
  const TUTORIAL = [
    {
      goals: [{ type: 'mass', target: 200 }],
      tip: 'Hawking radiation is evaporating you: feed. At about three times your starting mass a dark halo gathers around you, the gas starts to wheel, and arms appear. Settle near the middle of the box so the galaxy has room, and fast-forward with the Time slider while it winds up.',
    },
    {
      goals: [{ type: 'disk', target: 100, hold: 6 }],
      tip: 'Matter that falls in at an angle misses and orbits. Sweep through the gas so it wraps around you: that disk is the galaxy to come.',
    },
    {
      goals: [{ type: 'stars', target: 3 }],
      tip: 'A clump heavier than the Jeans mass collapses into a cluster of stars. In a galaxy the gas piles up in the arms, so that is where new, blue stars are born.',
    },
    {
      goals: [{ type: 'mass', target: 300 }],
      tip: 'Feeding fast makes you shine, and past the Eddington limit that light blows away nearby gas. Pace yourself.',
    },
    {
      goals: [{ type: 'shred', target: 1 }],
      tip: 'Inside the Roche limit (the dashed ring) tides tear clumps and stars apart. Shred one, but leave the rest to build your galaxy.',
    },
  ];

  function arena(aspect) {
    const a = Math.min(2, Math.max(0.5, aspect || 1.6));
    const W = Math.sqrt(AREA * a);
    return { W: Math.round(W), H: Math.round(AREA / W) };
  }

  function randomGoals(r, d) {
    const pool = [
      () => ({ type: 'mass', target: Math.round(M0 * (4 + 8 * d + 2 * r()) / 10) * 10 }),
      () => ({ type: 'disk', target: Math.round((100 + 200 * d) / 10) * 10, hold: 8 + Math.round(6 * d) }),
      () => ({ type: 'stars', target: 2 + Math.round(2 * d + 3 * d * r()) }),
      () => ({ type: 'shred', target: 1 + Math.round(2 * d) }),
    ];
    const count = d > 0.6 ? 2 : 1;
    const picks = [];
    while (picks.length < count) {
      const k = Math.floor(r() * pool.length);
      if (!picks.includes(k)) picks.push(k);
    }
    return picks.map((k) => pool[k]());
  }

  function generate(number, seed, aspect) {
    const r = MOTE.rng((seed ^ Math.imul(number, 2654435761)) >>> 0);
    const d = Math.min(1, (number - 1) / 14); // difficulty, 0 → 1 over fifteen levels
    const between = (a, b) => a + (b - a) * r();

    // Draw what matters for play, then solve the real equation for the constant behind it.
    const G = between(4, 9);
    const rs0 = between(2.5, 4.5);                    // starting horizon
    const c = Math.sqrt(2 * G * M0 / rs0);            // from r_s = 2GM / c²
    const MJ = between(45, 110 + 120 * d);            // Jeans mass
    const T = G * Math.pow(MJ / JEANS, 2 / 3);        // from M_J ∝ (T / G)^(3/2)
    const tEvap = number <= 2 ? 120 : between(80 - 20 * d, 130 - 40 * d);
    const kH = Math.pow(M0, 3) / (3 * tEvap);         // from t = M³ / 3k
    const eta = between(0.057, 0.42);                 // Schwarzschild to maximally spinning
    const tSal = between(10, 22);                     // fastest e-folding of your mass
    const lambda = eta * c * c / tSal;                // L_Edd = λM, from t = ηc² / λ
    const constants = {
      G, c, T, MJ, M0, tEvap, kH,
      hbar: kH * 15360 * Math.PI * G * G / Math.pow(c, 4),
      sigma: 4 * Math.sqrt(T),                        // thermal speed ∝ √T
      gamma: between(0, 0.25),
      e: between(0.15, 0.9),
      stick: between(2, 5),
      eta, tSal, lambda,
      opacity: 4 * Math.PI * G * c / lambda,          // from L_Edd = 4πGMc / κ
      tau: between(120, 360),
      kappa: between(0.5, 1.6),
      thrust: 90,
      Mfail: M0 * 0.25,
      mote: 1 / RESOLUTION,                           // mean mass of one mote
    };
    // You begin near an edge: the cloud collapses toward the middle without you.
    const box = arena(aspect);
    const side = r() < 0.5 ? -1 : 1, along = (r() - 0.5) * 0.7;
    const start = box.W >= box.H
      ? { x: side * box.W * 0.4, y: along * box.H }
      : { x: along * box.W, y: side * box.H * 0.4 };
    const tutorial = TUTORIAL[number - 1];
    const goals = [...(tutorial ? tutorial.goals : randomGoals(r, d)), galaxy(d)];
    return {
      number, seed, ...box, start,
      count: Math.round((1700 + 500 * d + 200 * r()) * RESOLUTION),
      constants,
      goals: goals.map((g) => ({ ...g })),
      tip: tutorial ? tutorial.tip : null,
    };
  }

  MOTE.generateLevel = generate;
  MOTE.KELVIN = KELVIN;
})(typeof window !== 'undefined' ? window.MOTE : globalThis.MOTE);
