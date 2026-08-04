/* The fixed point does not move unless someone meant it to.

   Every change to the engine that is supposed to be a refactor — a cheaper
   Jacobian, a different cache key, a reordered step — is a change to how the
   limit cycle is found and must not be a change to where it is. This replays
   `test/golden/sim.json` and says so.

   When it fails, the question is which: a bug, or an improvement that moves
   the answer? Read the diff, decide, and if it is intended regenerate with
   `node scripts/gen-sim-golden.mjs` in the same commit. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOPOS } from "../src/topologies/index.js";
import { SIM } from "../src/topologies/sim/pilot.js";
import { runSteady } from "../src/engine/run.js";
import { casesFor } from "../scripts/lib/cases.mjs";
import { shotOf } from "../scripts/gen-sim-golden.mjs";

const golden = JSON.parse(readFileSync(new URL("./golden/sim.json", import.meta.url), "utf8"));

/* Four significant figures were already applied on both sides, so this is an
   equality test on rounded numbers rather than a tolerance dressed up as one. */
function same(a, b, path) {
  if (Array.isArray(b)) {
    assert.equal(Array.isArray(a), true, `${path} should be an array`);
    assert.equal(a.length, b.length, `${path} length differs`);
    b.forEach((v, i) => same(a[i], v, `${path}[${i}]`));
    return;
  }
  if (b && typeof b === "object") {
    for (const k of Object.keys(b)) same(a ? a[k] : undefined, b[k], `${path}.${k}`);
    return;
  }
  assert.equal(a, b, `${path} moved`);
}

for (const id of Object.keys(golden)) {
  const topo = TOPOS.find((t) => t.id === id);
  test(`${id} — settles where it settled before`, () => {
    assert.ok(topo, `${id} is in the golden file but not in the catalogue`);
    assert.ok(SIM[id], `${id} is in the golden file but no longer has a circuit`);
    const cases = new Map(casesFor(topo).map((c) => [c.name, c.spec]));
    for (const [name, want] of Object.entries(golden[id])) {
      const spec = cases.get(name);
      assert.ok(spec, `${id}: the operating point "${name}" no longer exists`);
      const res = topo.design(spec);
      /* Deadline off, matching gen-sim-golden: a wall clock would make the
         recorded state depend on how fast the machine ran. */
      const run = runSteady(topo, spec, res, { deadline: 0 });
      same(shotOf(run), want, `${id} [${name}]`);
    }
  });
}

test("every simulated circuit is recorded", () => {
  for (const id of Object.keys(SIM)) {
    assert.ok(golden[id], `${id} has a circuit but no golden entry — `
      + "run `node scripts/gen-sim-golden.mjs`");
  }
});
