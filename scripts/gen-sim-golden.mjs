/* Record what each simulated circuit settles to.

   `design.json` pins the design equations. This pins the SOLVER: the state
   the limit cycle converges to, and the handful of scalars read off it. The
   two are independent on purpose — one is arithmetic a person could do on
   paper, the other is a fixed point found by shooting.

   It exists for the changes that are supposed to alter nothing. Replacing the
   Jacobian, reordering a cache, tightening a tolerance: every one of those is
   a rewrite of how the fixed point is reached, and none of them may move
   where it is. A different route to the same fixed point must land on the
   same fixed point, and four significant figures is far tighter than any
   drawn waveform can express while still being loose enough that a change of
   summation order does not cry wolf.

   Regenerate deliberately, and read the diff:

       node scripts/gen-sim-golden.mjs                                     */
import { writeFileSync } from "node:fs";
import { TOPOS } from "../src/topologies/index.js";
import { SIM } from "../src/topologies/sim/pilot.js";
import { runSteady } from "../src/engine/run.js";
import { casesFor } from "./lib/cases.mjs";

/* Four figures. Enough to catch a real movement in the answer, loose enough
   that a reassociated floating-point sum does not read as one. */
const sig = (v) => (Number.isFinite(v) ? +v.toPrecision(4) : null);

export function shotOf(run) {
  const o = {
    periods: run.periods,
    idle: sig(run.idle),
    /* The converged state itself — the thing every other number is read off,
       and the most sensitive record of where the fixed point sits. */
    x: [...run.x].map(sig),
    probes: {},
  };
  for (const [name, v] of Object.entries(run.views)) {
    o.probes[name] = { mean: sig(v.qTot), min: sig(v.iMin), max: sig(v.iMax) };
  }
  return o;
}

const out = {};
let n = 0;
for (const id of Object.keys(SIM)) {
  const topo = TOPOS.find((t) => t.id === id);
  if (!topo) continue;
  out[id] = {};
  for (const { name, spec } of casesFor(topo)) {
    let res;
    try { res = topo.design(spec); } catch { continue; }
    if (!res || res.infeasible || !res.sim || !res.wave) continue;
    let run;
    try { run = runSteady(topo, spec, res); } catch { continue; }
    if (!(run.residual < 1e-4)) continue;
    out[id][name] = shotOf(run);
    n++;
  }
}

const path = new URL("../test/golden/sim.json", import.meta.url);
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote test/golden/sim.json — ${Object.keys(out).length} circuits, ${n} operating points`);
