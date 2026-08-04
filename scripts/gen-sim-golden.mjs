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
    /* A mean that is a millionth of the probe's own swing is zero.

       A capacitor carries no net charge over a period — that is not an
       approximation, it is what "periodic" means — so `iC.mean` is a
       measurement of how converged the run is and not of the circuit. Pinned
       at four significant figures it recorded the dust: changing how Newton
       damps its step moved it from −8.574e-8 to −8.529e-8 while every other
       number, including the whole state vector, stayed identical. Four
       significant figures of a quantity whose true value is zero is four
       significant figures of nothing. */
    const span = Math.abs(v.iMax - v.iMin);
    const mean = Math.abs(v.qTot) < 1e-6 * span ? 0 : sig(v.qTot);
    o.probes[name] = { mean, min: sig(v.iMin), max: sig(v.iMax) };
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
    /* No deadline here, and none in the test that replays this.

       The app gives a knob turn about a second and takes the best state
       reached inside it, which is the right trade for a reader and the wrong
       one for a regression file: how many periods fit in a second depends on
       the machine, so the recorded state would differ between two runs that
       are both correct. Converged to tolerance, the fixed point is a property
       of the circuit and nothing else. Timing is check-sim's business. */
    try { run = runSteady(topo, spec, res, { deadline: 0 }); } catch { continue; }
    if (!(run.residual < 1e-4)) continue;
    out[id][name] = shotOf(run);
    n++;
  }
}

const path = new URL("../test/golden/sim.json", import.meta.url);
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote test/golden/sim.json — ${Object.keys(out).length} circuits, ${n} operating points`);
