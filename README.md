# mote

You are a black hole, born small, in a sealed box of dust.

Fly through the gas and feed: every mote that crosses your event horizon makes you heavier, your horizon wider and your gravity stronger. Each level is a fresh universe with its own randomly drawn physical constants, plugged into real equations. Grow to about three times your starting mass and a dark halo gathers around you; the gas starts to wheel, star clusters ignite, and every level ends the same way: **a spiral galaxy, centred on you**, different every time.

## Play

Open `index.html` in a browser. No build step and no dependencies; your level and archive save to `localStorage`.

- **Steer:** hold the mouse or a finger where you want to go, or use WASD / arrow keys. Space brakes. Once your galaxy has formed, an unsteered hole coasts to rest at its centre.
- **Time:** the Time slider runs the simulation from 0.1× (slow motion, for threading a Roche limit) to 5× (fast-forward while a galaxy winds up). `[` and `]` step through speeds, and the readout resets to 1×. Fast-forward takes more physics steps per frame; slow motion takes smaller ones, so both stay accurate. If a device can't keep up, the control shows the speed it is actually reaching.
- **Pause:** P or Esc. The briefing card shows the level's constants and goals.
- **Finishing a level:** choose *Keep watching* to let the galaxy mature (young galaxies keep winding up), then *Next level*. The archive keeps it as it looks when you move on, named by its arms and Hubble type, with the constants it was built under.

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
| τ | t = τ·(M / 1.75)^−2.5 | Stellar lifetimes: massive stars die within seconds as supernovae |
| v_h | v_h ∝ M^1/4 (the M–σ relation) | The dark halo's circular speed, which grows with you |
| m | m ∝ M_halo / M_disk (swing amplification) | How many arms the disk favours |

Also at work, with no tunable constant: the fluid Roche limit `d = 2.44·R·(M/m)^1/3`, inside which tides tear clumps and stars apart; Jeans collapse, where a clump heavier than M_J fragments into a cluster of stars with a Salpeter mass spread; and the photon sphere at 1.5 r_s, drawn as the bright ring around you.

The box is sealed: walls reflect matter with restitution, so nothing escapes. One game simplification: c sets your horizon, accretion luminosity and Hawking rate, but isn't enforced as a speed limit.

### How the galaxy forms

`src/galaxy.js` adds the galaxy on top of the box. Once you have fed to 2.5–3.2× your starting mass:

- **A dark halo** centred on you gives a flat rotation curve (a cored isothermal profile); its speed follows the M–σ relation and its size your sphere of influence.
- **Gas settles** toward circular orbits in the disk's own sense of rotation, while thermostats hold the disk at Toomre Q ≈ 1.5, warm enough not to shatter into clumps and cold enough to respond to arms.
- **A density wave** (Lin–Shu): a rigidly rotating logarithmic spiral potential with m arms switches on as the disk becomes coherent. Its pitch comes from the shear at corotation, and heavier holes wind their arms tighter, as observed. Gas piles into the arms, where the Jeans mass drops with surface density, so new clusters (and their short-lived blue stars) light the arms up.
- **Mass is conserved.** Nothing is deleted except what you eat. Past your maximum mass, what falls in is blown back out as an accretion-disk wind.

Where it departs from reality, on purpose: the halo and the spiral potential are imposed rather than self-consistent; stars as well as gas feel a gentle settling toward circular orbits; star particles are softened so clusters dissolve into the disk; and an unsteered hole is held at rest by dynamical friction against its galaxy.

The arms are measured, not assumed: `measure.js` finds the strongest m-fold pattern (m = 1–4) in log-radius rings around you, subtracts what random scatter would give, and checks that its phase winds like a logarithmic spiral at a pitch of 8°–50°. That score drives the galaxy goal and the name in the archive (Sb tight, Sc open, Sd loose).

## Goals

Every level ends with **Grow a spiral galaxy and hold it**. The first five levels each teach one idea on the way (feeding, orbiting gas, star clusters, the Eddington limit, tides). After that, levels draw one or two more goals at random, and all targets grow over fifteen levels:

- grow to a mass (never beyond your maximum)
- hold gas in near-circular orbit around you
- ignite star clusters
- tear clumps or stars apart with tides

Evaporate below a quarter of your starting mass and the level is lost; retry it with the same constants, or roll new ones.

## Code

Plain scripts sharing a `window.MOTE` namespace, loaded in order by `index.html`:

- `src/sim.js`: the box. Barnes–Hut gravity for the dust, direct sums for the black hole, stick-or-bounce collisions on a grid, accretion, tides, Hawking radiation, Jeans collapse, supernovae, walls. Runs in Node too.
- `src/level.js`: drawing constants and goals for a level.
- `src/galaxy.js`: the galaxy layer described above; it extends `Sim` and `generateLevel` in place, and replaces the gravity tree with a faster bucketed one.
- `src/measure.js`: what orbits you, the spiral-arm score, and naming the structure.
- `src/game.js`: goals, winning and evaporating, the archive, saving.
- `src/render.js`: canvas drawing.
- `src/ui.js`: HUD, briefing, results, archive.
- `src/main.js`: the loop and controls.

The simulation runs headless for balancing:

```js
for (const f of ['sim', 'level', 'galaxy', 'measure']) require(`./src/${f}.js`);
const level = MOTE.generateLevel(3, 42, 1.6);
const sim = new MOTE.Sim(level);
sim.control = { vx: 30, vy: 0 };            // steer right
for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60);
console.log(sim.bh.m, MOTE.classify(sim, MOTE.measure(sim)));
```

The first version of mote, an incremental game about choosing the laws of a cosmos, is in the git history.
