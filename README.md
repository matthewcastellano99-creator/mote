# mote

You are a black hole, born small, in a sealed box of dust.

Fly through the gas and feed: every mote that crosses your event horizon makes you heavier, your horizon wider and your gravity stronger. Each level is a fresh universe with its own randomly drawn physical constants, plugged into real equations. Learn what they do, then use your gravity to bend the dust into structure: disks, star-forming clumps, stars held in orbit around you.

## Play

Open `index.html` in a browser. No build step and no dependencies; your level and archive save to `localStorage`.

- **Steer:** hold the mouse or a finger where you want to go, or use WASD / arrow keys. Space brakes.
- **Time:** the Time slider runs the simulation from 0.1× (slow motion, for threading a Roche limit) to 5× (fast-forward through a collapse). `[` and `]` step through speeds, and the readout resets to 1×. Fast-forward takes more physics steps per frame; slow motion takes smaller ones, so both stay accurate. If a device can't keep up, the control shows the speed it is actually reaching.
- **Pause:** P or Esc. The briefing card shows the level's constants and goals.
- **Archive:** every finished level keeps a snapshot of what you built, with the constants it was built under.

## The physics

Every level draws new values for the constants below. Gameplay-relevant quantities (your starting horizon, the Jeans mass, how long until you evaporate) are drawn first, and the constant behind each one is then solved from its equation, so the numbers on the briefing card are consistent with the formulas.

| Constant | Equation it feeds | What you feel |
| --- | --- | --- |
| G | F = G·m₁m₂ / r² | How hard everything pulls, including you |
| c | r_s = 2GM / c² | Size of your event horizon (and the light of accretion) |
| T | M_J ∝ (T / G)^3/2 | Hotter gas resists collapsing into stars; also sets thermal motion |
| γ | dv/dt = −γv | Gas drag: settles motion, helps clumps form |
| e | v′ = −e·v | Restitution of collisions too fast to stick |
| η | L = η·Ṁc² | Fraction of what you eat that shines instead of adding mass |
| κ | L_Edd = 4πGMc / κ | Past the Eddington limit, your own light blows your food away |
| ħ | dM/dt = −ħc⁴ / 15360πG²M² | Hawking evaporation: small holes shrink fast |
| τ | t = τ·(M / 100)^−2.5 | Stellar lifetimes, ending in supernovae |

Also at work, with no tunable constant: the fluid Roche limit `d = 2.44·R·(M/m)^1/3`, inside which tides tear clumps and stars apart; Jeans collapse, where a clump heavier than M_J ignites as a star; and the photon sphere at 1.5 r_s, drawn as the bright ring around you.

The box is sealed: walls reflect matter with restitution, so nothing escapes. One game simplification: c sets your horizon, accretion luminosity and Hawking rate, but isn't enforced as a speed limit.

## Goals

The first five levels each teach one idea (feeding, disks, star formation, the Eddington limit, tides). After that, levels draw two or three goals at random, with targets that grow over fifteen levels:

- grow to a mass
- hold gas in near-circular orbit around you (tangential speed within 40% of √(GM/r))
- ignite stars
- keep stars orbiting you
- tear clumps or stars apart with tides

Evaporate below a quarter of your starting mass and the level is lost; retry it with the same constants, or roll new ones.

## Code

Plain scripts sharing a `window.MOTE` namespace, loaded in order by `index.html`:

- `src/sim.js`: the physics. Barnes–Hut gravity for the dust, direct sums for the black hole, stick-or-bounce collisions on a grid, accretion, tides, Hawking radiation, Jeans collapse, supernovae, walls. Runs in Node too.
- `src/level.js`: drawing constants and goals for a level.
- `src/measure.js`: what orbits you, and naming the structure.
- `src/game.js`: goals, winning and evaporating, the archive, saving.
- `src/render.js`: canvas drawing.
- `src/ui.js`: HUD, briefing, results, archive.
- `src/main.js`: the loop and controls.

The simulation runs headless for balancing:

```js
require('./src/sim.js'); require('./src/level.js'); require('./src/measure.js');
const level = MOTE.generateLevel(3, 42, 1.6);
const sim = new MOTE.Sim(level);
sim.control = { vx: 30, vy: 0 };            // steer right
for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60);
console.log(sim.bh.m, MOTE.classify(sim, MOTE.measure(sim)));
```

The first version of mote, an incremental game about choosing the laws of a cosmos, is in the git history.
