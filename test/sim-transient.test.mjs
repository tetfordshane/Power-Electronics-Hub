/* A converter disturbed, and what it does next.

   The claim being tested is that this is one continuous physical story
   rather than two pictures shown in sequence: the state the converter was
   in is the state it starts the transient from, and the state it ends the
   transient in is the steady state it would have reached anyway. If those
   two ends do not meet, the settle in between is decoration.

   Everything here is deterministic — same inputs, same trajectory — which is
   what lets the figure be scrubbed back and forth across a transient instead
   of only played forwards. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPOS } from "../scripts/lib/topos.mjs";
import { defaultSpec } from "../scripts/lib/spec.mjs";
import { runSteady, runTransient } from "../src/engine/run.js";
import { isPerturbation } from "../src/engine/transient.js";

const topoOf = (id) => TOPOS.find((t) => t.id === id);
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

/* A load step holds the converter and changes what it is feeding. The design
   is deliberately NOT recomputed: a real inductor does not change value
   because the load did, and design() re-sizing it would describe a different
   converter rather than a disturbed one. */
function loadStep(id, k) {
  const topo = topoOf(id);
  const spec = defaultSpec(topo);
  const res = topo.design(spec);
  const before = runSteady(topo, spec, res);
  const stepped = { ...spec, iout: spec.iout * k };
  return { topo, spec, res, before, stepped, tr: runTransient(topo, stepped, res, before) };
}

test("a load step is a perturbation; re-sizing the inductor is not", () => {
  const topo = topoOf("buck");
  const spec = defaultSpec(topo);
  const res = topo.design(spec);
  const before = runSteady(topo, spec, res);

  /* Same components, different load — the circuit was disturbed. */
  assert.ok(runTransient(topo, { ...spec, iout: spec.iout * 2 }, res, before),
    "a load step should produce a transient");

  /* design() re-sizes L and C_out with the load, so asking it for a new
     design at the new load gives a different converter. Animating a settle
     between two different converters would be inventing an event. */
  const other = topo.design({ ...spec, iout: spec.iout * 2 });
  assert.notEqual(other.sim.L, res.sim.L, "this test assumes design() re-sizes L with load");
  assert.equal(runTransient(topo, { ...spec, iout: spec.iout * 2 }, other, before), null,
    "a different inductor is a different converter, not a disturbed one");
});

test("isPerturbation looks at the energy storage, not the sources", () => {
  const a = [
    { id: "V1", type: "V", n: ["in", "0"], value: 12 },
    { id: "L1", type: "L", n: ["a", "b"], value: 1e-6 },
    { id: "R1", type: "R", n: ["b", "0"], value: 1 },
  ];
  assert.ok(isPerturbation(a, a.map((b) => (b.id === "V1" ? { ...b, value: 18 } : b))),
    "a different input voltage is the same converter");
  assert.ok(isPerturbation(a, a.map((b) => (b.id === "R1" ? { ...b, value: 2 } : b))),
    "a different load is the same converter");
  assert.ok(!isPerturbation(a, a.map((b) => (b.id === "L1" ? { ...b, value: 2e-6 } : b))),
    "a different inductor is not");
});

for (const [id, k] of [["buck", 2], ["buck", 0.5], ["boost", 2], ["syncbuck", 2]]) {
  test(`${id} — a ${k}× load step settles, and settles where it should`, () => {
    const { topo, res, stepped, tr } = loadStep(id, k);
    assert.ok(tr, `${id} produced no transient`);
    assert.ok(tr.settled < tr.periods + 1, "never settled within its budget");

    /* The end of the transient must be the steady state of the new
       operating point, reached independently by the shooting solver from a
       completely different starting guess. Two routes, one answer — and if
       they disagree, the settle went somewhere the physics does not. */
    const after = runSteady(topo, stepped, res);
    const endV = tr.env[tr.env.length - 1].vMean;
    assert.ok(rel(endV, after.views.vout.qTot) < 0.02,
      `${id} settled at ${endV.toFixed(4)} V, but its steady state is ${after.views.vout.qTot.toFixed(4)} V`);

    /* And the state itself, not only what it looks like. */
    for (let i = 0; i < tr.xEnd.length; i++) {
      const scale = Math.max(Math.abs(after.x[i]), 1e-3);
      assert.ok(Math.abs(tr.xEnd[i] - after.x[i]) / scale < 0.05,
        `${id} state ${i} ended at ${tr.xEnd[i]} against a steady ${after.x[i]}`);
    }
  });
}

test("buck — the output actually moves, and in the right direction", () => {
  /* Open loop at a fixed duty, more load means more drop across the switch,
     the winding and the diode — so a heavier load settles lower. The point
     of checking is that the transient is carrying real information rather
     than relaxing back to wherever it started. */
  const up = loadStep("buck", 2);
  const down = loadStep("buck", 0.5);
  const start = up.before.views.vout.qTot;
  const heavier = up.tr.env[up.tr.env.length - 1].vMean;
  const lighter = down.tr.env[down.tr.env.length - 1].vMean;
  assert.ok(heavier < start, `doubling the load should pull the output below ${start.toFixed(3)} V, got ${heavier.toFixed(3)}`);
  assert.ok(lighter > start, `halving the load should let it rise above ${start.toFixed(3)} V, got ${lighter.toFixed(3)}`);
});

test("buck — a load step is the output filter's own ringing, at its own frequency", () => {
  /* The most specific claim this model makes. A step up must dip, because
     the capacitor carries the extra load alone until the inductor current
     catches up — an inductor cannot change its current instantly, and a
     response that slid straight to the new level would be describing one
     that can.

     What follows the dip is not a monotone recovery: the output filter is a
     second-order LC damped by the load, so it overshoots and rings. The
     frequency of that ringing is not free — it is the filter's own damped
     natural frequency, ω_0√(1−ζ²) with ω_0 = 1/√(LC) and ζ set by the load.
     Nothing in the engine was told about any of this; it comes out of two
     energy-storage elements and a resistor. */
  const { topo, spec, res, before, tr } = loadStep("buck", 2);
  const v = tr.env.map((e) => e.vMean);
  const end = v[v.length - 1];
  const dip = Math.min(...v);
  assert.ok(dip < end - 1e-3,
    `no undershoot: the lowest mean was ${dip.toFixed(4)} V against a final ${end.toFixed(4)} V`);

  /* The deviation from the final value must die away. */
  const dev = v.map((x) => Math.abs(x - end));
  const third = Math.floor(dev.length / 3);
  const early = Math.max(...dev.slice(0, third));
  const late = Math.max(...dev.slice(2 * third));
  assert.ok(late < early * 0.1,
    `the ringing does not decay: ${early.toFixed(4)} V early against ${late.toFixed(4)} V late`);

  /* Dip to overshoot is half a damped period. Compare against the filter. */
  const at = v.indexOf(dip);
  let peak = at;
  for (let i = at; i < v.length; i++) if (v[i] > v[peak]) peak = i;
  const halfRing = peak - at;

  const L = res.sim.L, C = res.sim.C;
  const R = spec.vout / (spec.iout * 2);                 /* the stepped load */
  const w0 = 1 / Math.sqrt(L * C);
  const zeta = 1 / (2 * R * Math.sqrt(C / L));           /* parallel-loaded LC */
  assert.ok(zeta < 1, "this test assumes the stepped load leaves it underdamped");
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const halfRingPredicted = Math.PI / wd * (spec.fsw * 1e3);   /* in periods */

  assert.ok(rel(halfRing, halfRingPredicted) < 0.35,
    `dip to overshoot took ${halfRing} periods; √(LC) damped by the load predicts `
    + `${halfRingPredicted.toFixed(1)}`);
  assert.ok(before.views.vout.qTot > dip, "the dip should be below where it started");
});

test("the same step replays identically", () => {
  /* Determinism is what makes the transient scrubbable: stepping back to an
     earlier period has to show what it showed the first time. */
  const a = loadStep("buck", 2);
  const b = loadStep("buck", 2);
  assert.equal(a.tr.periods, b.tr.periods);
  for (let i = 0; i < a.tr.env.length; i++) {
    assert.equal(a.tr.env[i].vMean, b.tr.env[i].vMean, `period ${i} differs on replay`);
  }
  /* and re-solving a displayed period twice gives the same trace */
  const p1 = a.tr.at(3), p2 = a.tr.at(3);
  assert.equal(p1.traces.iL.length, p2.traces.iL.length);
  for (let i = 0; i < p1.traces.iL.length; i++) assert.equal(p1.traces.iL[i], p2.traces.iL[i]);
});

test("displayed periods are full-resolution cycles, in step order", () => {
  const { tr } = loadStep("buck", 2);
  assert.ok(tr.schedule.length >= 3, "too few periods to step through");
  for (let i = 1; i < tr.schedule.length; i++) {
    assert.ok(tr.schedule[i] > tr.schedule[i - 1], "the schedule must advance");
  }
  const first = tr.at(0), last = tr.at(tr.schedule.length - 1);
  for (const p of [first, last]) {
    assert.ok(p.traces.iL.length > 100, "a displayed period should be finely sampled");
    for (const v of p.traces.iL) assert.ok(Number.isFinite(v), "a displayed period is not finite");
  }
  /* The last displayed period is the settled one, so it should match the
     steady figure the reader is left looking at. */
  const { topo, res, stepped } = loadStep("buck", 2);
  const after = runSteady(topo, stepped, res);
  const lastMean = last.views.iL.qTot;
  assert.ok(rel(lastMean, after.views.iL.qTot) < 0.02,
    `the last displayed period averages ${lastMean.toFixed(4)} A against a steady ${after.views.iL.qTot.toFixed(4)} A`);
});
