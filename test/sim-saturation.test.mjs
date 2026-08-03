/* A core that softens as the current rises.

   The model is the one cycle.js already uses — L(i) = L₀/(1 + κ(i/I_ref)²)
   with κ = s/(1−s) — so the two cannot describe different magnetics. What
   they do with it differs, and the difference is the point:

   cycle.js BENDS a ramp whose endpoints are already decided. It preserves ΔI
   exactly and restores the mean, so the figure shows the shape of a
   saturating ramp against a ripple the design equations chose.

   The simulator has no endpoints to preserve. It is handed an inductance
   that falls with current and integrates whatever follows, so a softening
   core gives a bigger ripple — which is what actually happens, and what the
   ideal design equation cannot tell you. A part quoted at "−20 % at 12 A"
   really does ripple more than its nameplate inductance predicts.

   So these do not test that the two agree. They test that the simulator
   moves the right way, by the right amount, for the right reason. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPOS } from "../scripts/lib/topos.mjs";
import { defaultSpec } from "../scripts/lib/spec.mjs";
import { runSteady, rippleOf } from "../src/engine/run.js";
import { buildCycle } from "../src/cycle.js";

const topoOf = (id) => TOPOS.find((t) => t.id === id);
const PILOTS = ["buck", "syncbuck", "boost", "buckboost", "flyback", "cuk", "sepic", "zeta"];

const at = (id, lsag) => {
  const topo = topoOf(id);
  const spec = defaultSpec(topo, { lsag });
  const res = topo.design(spec);
  return { topo, spec, res, run: runSteady(topo, spec, res) };
};

for (const id of PILOTS) {
  test(`${id} — a softening core widens the ripple, monotonically`, () => {
    let last = 0;
    for (const lsag of [0, 20, 40, 60]) {
      const { run } = at(id, lsag);
      assert.ok(run, `${id} did not run at ${lsag} %`);
      assert.ok(run.residual < 1e-4, `${id} at ${lsag} % did not converge (${run.residual})`);
      const dI = rippleOf(run.views.iL);
      assert.ok(dI > last * 1.0001,
        `${id}: ΔI at ${lsag} % roll-off is ${dI.toFixed(4)} A, no more than the ${last.toFixed(4)} A before it`);
      last = dI;
    }
  });
}

test("no roll-off leaves the ramp exactly where it was", () => {
  /* Turning the feature off must cost nothing: with lsag = 0 there are no
     saturating windings at all, the bucketing never engages, and the answer
     is the linear one. */
  const a = at("buck", 0);
  assert.ok(a.run.residual < 1e-9, "the linear case should converge hard");
  const L = a.res.sim.L, f = a.spec.fsw * 1e3, D = a.res.wave.D;
  const Vo = a.run.views.vout.qTot, Vf = a.spec.vf;
  const want = (Vo + Vf) * (1 - D) / (L * f);
  assert.ok(Math.abs(rippleOf(a.run.views.iL) - want) / want < 0.03,
    "with no roll-off the ripple is still the constant-inductance one");
});

test("the ripple grows by as much as the inductance falls", () => {
  /* The check that this is the stated model rather than merely a monotone
     one. Over the ramp the winding sees inductances between L(valley) and
     L(peak); the ripple has to grow by roughly the ratio of the nominal
     inductance to the average of those, and be bracketed by the two extremes
     it would have at each end. */
  const { spec, res, run } = at("buck", 40);
  const s = Math.min(spec.lsag / 100, 0.8), kap = s / (1 - s);
  const ipk = Math.abs(res.wave.iavg) + Math.abs(res.wave.dI) / 2;
  const Lof = (i) => res.sim.L / (1 + kap * (i / ipk) ** 2);

  const lo = run.views.iL.iMin, hi = run.views.iL.iMax;
  const dIlin = rippleOf(at("buck", 0).run.views.iL);
  const dISat = rippleOf(run.views.iL);

  /* Ripple scales as 1/L, so the saturated ripple must sit between what the
     softest and stiffest inductance along the ramp would each give. */
  const fastest = dIlin * (res.sim.L / Lof(hi));
  const slowest = dIlin * (res.sim.L / Lof(lo));
  assert.ok(dISat > slowest * 0.95 && dISat < fastest * 1.05,
    `ΔI ${dISat.toFixed(3)} A is outside the ${slowest.toFixed(3)}–${fastest.toFixed(3)} A `
    + "the inductance range allows");
});

test("the simulator and the closed form disagree, and in the documented direction", () => {
  /* cycle.js holds ΔI fixed and bends the shape; the simulator lets the
     ripple grow. Asserting the disagreement keeps it a known difference
     rather than something that quietly gets "fixed" one day by making the
     simulator preserve a ripple it has no reason to preserve. */
  const { res, run } = at("buck", 40);
  const closed = buildCycle(res.wave, null);
  const dIclosed = closed.iMax - closed.iMin;
  const dISim = rippleOf(run.views.iL);
  assert.ok(dISim > dIclosed * 1.2,
    `the simulator should show a wider ripple than the closed form holds fixed: `
    + `${dISim.toFixed(3)} A against ${dIclosed.toFixed(3)} A`);
});

test("the ramp is concave: it climbs fastest where the core is softest", () => {
  /* The visible signature of saturation. On the rising edge the inductance
     falls as the current grows, so di/dt increases along the ramp — the
     second half is steeper than the first. A straight ramp would have them
     equal. */
  const { res, run } = at("buck", 60);
  const D = res.wave.D;
  const iAt = run.views.iL.at;
  const a = iAt(0.02 * D), b = iAt(0.5 * D), c = iAt(0.98 * D);
  const first = b - a, second = c - b;
  assert.ok(second > first * 1.05,
    `the rising ramp should steepen: ${first.toFixed(4)} A then ${second.toFixed(4)} A`);
});
