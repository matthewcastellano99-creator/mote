# mote

An incremental game about creating order from chaos.

Each cosmos begins as a cloud of a couple of thousand dust motes drifting at random. You can't place anything. You can only choose the **laws of physics** the motes obey, and watch what structure emerges from them: clumps, star clusters, supernova shells, black holes, galaxies. When you like what has formed, **crystallize** it into your archive and begin again from fresh chaos.

## Play

Open `index.html` in a browser. No build step and no dependencies; progress saves to `localStorage`.

- **Laws** (left panel) cost *Order*. Each one is a dial on the physics, not a result.
- **Hold on the sky** to gather nearby dust with your hand. Right-click, Shift, or the *Scatter* toggle pushes it away.
- **Crystallize** freezes the cosmos into the archive and pays *Stardust*, which buys permanent **Constants**.
- Scroll to zoom. The speed button runs the simulation at 1×, 2× or 4×.

## How order is measured

Order is earned continuously from three measurements of the simulation (`src/order.js`):

| Measure | Meaning |
| --- | --- |
| Concentration | How far the mass distribution's entropy has fallen from the starting cloud |
| Coherence | How much of the angular momentum turns the same way (`|ΣL| / Σ|L|`) |
| Richness | How many distinct objects survive; a cosmos swallowed by one body scores low |

`order = (concentration + coherence) / 2 × richness²`, so a lone dead blob scores worse than a spinning disk of stars.

## The laws

| Law | What it does | Unlocks |
| --- | --- | --- |
| Gravity | Strength of N-body attraction | from the start |
| Cohesion | Motes stick at higher relative speeds | 40 Order |
| Dissipation | Damps radial motion so orbits circularise | a body of mass 15 |
| Ignition | Clumps over a mass threshold fragment into star clusters | a body of mass 40 |
| Radiance | Starlight pushes dust away | first star |
| Mortality | Heavy stars die as supernovae, returning dust | 20 stars |
| Collapse | The heaviest stars leave black holes behind | Mortality |
| Vortex | Drives matter toward one shared rotation | second cosmos |
| Dark Halo | An unseen potential that flattens orbits | third cosmos |

## Code

Plain scripts sharing a `window.MOTE` namespace, loaded in order by `index.html`:

- `src/sim.js`: physics: Barnes–Hut gravity, collisions and merging on a spatial grid, ignition, supernovae, the laws. Runs in Node too.
- `src/order.js`: measurements of order and naming the structure.
- `src/game.js`: laws, milestones, the Order/Stardust economy, saving.
- `src/render.js`: canvas drawing.
- `src/ui.js`: panels, dialogs, toasts.
- `src/main.js`: the loop and input.

The simulation runs headless for balancing:

```js
require('./src/sim.js'); require('./src/order.js');
const sim = new MOTE.Sim(2000, 42);
sim.laws.G = 6; sim.laws.starMass = 60;
for (let i = 0; i < 3000; i++) sim.step(1 / 30);
console.log(MOTE.classify(MOTE.measure(sim)));
```
