/* Discontinuous conduction, arrived at rather than declared.

   In the closed-form model, isDCM() is a test the app applies to a spec, and
   buildCycle then draws a different shape because it was told to. Nothing in
   the simulator knows the term. A diode stops conducting when its own current
   reaches zero; if that happens before the period ends, the inductor current
   sits at zero and the converter is in DCM — and the only way to find out is
   to look at what it did.

   So these check that the two agree. They are independent statements about
   the same physics, and where they part company the boundary is the thing
   worth arguing about, not the label. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPOS } from "../scripts/lib/topos.mjs";
import { defaultSpec } from "../scripts/lib/spec.mjs";
import { runSteady, rippleOf } from "../src/engine/run.js";
import { isDCM } from "../src/cycle.js";

const topoOf = (id) => TOPOS.find((t) => t.id === id);

/* Discontinuous conduction, as the solver knows it: a stretch of the period
   during which no device conducts at all, because the rectifier's current
   reached zero and the next turn-on has not arrived.

   Deliberately not "the current sits flat at zero". Once the rectifier
   opens, the inductor faces the switch node's own capacitance and the pair
   rings — the most recognisable feature of a discontinuous waveform, and the
   thing a flatness test would mistake for continuous conduction. */
const isIdle = (r) => r.idle > 0.02;

/* The ripple ratio, not the load, is what reaches DCM here.

   design() re-sizes the inductor for whatever load it is given, holding
   ΔI/I_out at the requested ratio, so turning the load down alone keeps the
   converter exactly as continuous as it was. The boundary sits at ΔI = 2·I_out
   — which is why FIELDS.r is allowed above 2 at all, and the comment there
   says so. */
const CCM = 0.3, DCM = 2.8;

test("buck — a big enough ripple drives it into discontinuous conduction, and the model agrees", () => {
  const topo = topoOf("buck");
  const ccm = defaultSpec(topo, { r: CCM });
  const dcm = defaultSpec(topo, { r: DCM });

  const rc = runSteady(topo, ccm, topo.design(ccm));
  const rd = runSteady(topo, dcm, topo.design(dcm));

  assert.ok(!isIdle(rc), `at ΔI/I = 0.3 every part of the period should be conducting (idle ${(rc.idle * 100).toFixed(1)} %)`);
  assert.ok(isIdle(rd), `at ΔI/I = 2.8 there should be an idle interval (idle ${(rd.idle * 100).toFixed(1)} %)`);
  /* The catch diode cannot carry current backwards, so what little negative
     excursion there is belongs to the ring, not to conduction. */
  assert.ok(Math.min(...rd.traces.iL) > -0.05 * Math.max(...rd.traces.iL),
    "a diode-rectified buck should only dip below zero by the ringing");

  /* And the closed-form test, applied to the same operating points, says the
     same thing. Two definitions, one answer. */
  assert.equal(isDCM(topo.design(ccm).wave), false, "isDCM disagrees at ΔI/I = 0.3");
  assert.equal(isDCM(topo.design(dcm).wave), true, "isDCM disagrees at ΔI/I = 2.8");
});

test("buck — the boundary the simulator finds is the boundary the model predicts", () => {
  /* Walk the ripple ratio up until the simulated current first rests at zero,
     and separately until isDCM flips. They are computed from entirely
     different things and should land close together.

     They do not land exactly together, and the gap is physics rather than
     error: the closed form drops the inductor at V_out/L during the off-time,
     while the real circuit drops it at (V_out + V_F)/L, so the valley reaches
     zero a little sooner than the ideal equation expects. The simulator
     entering DCM slightly before the model predicts is the diode drop being
     accounted for. */
  const topo = topoOf("buck");
  let simEdge = null, modelEdge = null;
  for (let k = 10; k <= 30; k++) {
    const r = k / 10;
    const spec = defaultSpec(topo, { r });
    const res = topo.design(spec);
    if (modelEdge === null && isDCM(res.wave)) modelEdge = r;
    if (simEdge === null && isIdle(runSteady(topo, spec, res))) simEdge = r;
    if (simEdge !== null && modelEdge !== null) break;
  }
  assert.ok(simEdge !== null, "the simulator never entered DCM");
  assert.ok(modelEdge !== null, "isDCM never fired");
  assert.ok(simEdge <= modelEdge + 1e-9,
    `the simulator entered DCM at ΔI/I = ${simEdge} but the model claims ${modelEdge} — the diode drop should make it earlier, not later`);
  const rel = Math.abs(simEdge - modelEdge) / modelEdge;
  assert.ok(rel < 0.25,
    `the DCM boundary is at ΔI/I = ${simEdge} simulated against ${modelEdge} predicted (${(rel * 100).toFixed(0)} %)`);
});

test("buck — nothing jumps as it crosses into DCM", () => {
  /* The reason to care: the figure has to stay continuous through the
     boundary. Adjacent operating points either side of it must produce
     waveforms that differ by a little, not by a redrawing. */
  const topo = topoOf("buck");
  let prev = null, worst = 0;
  for (let k = 16; k <= 30; k++) {
    const spec = defaultSpec(topo, { r: k / 10 });
    const r = runSteady(topo, spec, topo.design(spec));
    const pk = Math.max(...r.traces.iL);
    if (prev !== null) worst = Math.max(worst, Math.abs(pk - prev) / Math.max(prev, 1e-9));
    prev = pk;
  }
  assert.ok(worst < 0.15, `the peak current jumps by ${(worst * 100).toFixed(0)} % between adjacent operating points`);
});

test("syncbuck — a synchronous rectifier reverses instead of stopping", () => {
  /* The distinction the closed-form model already makes in words, made here
     by the circuit alone: with a driven low-side switch there is no diode to
     block the return path, so past the boundary the current goes negative
     rather than resting at zero. Same operating point as the buck above,
     opposite behaviour, and neither was authored anywhere. */
  const topo = topoOf("syncbuck");
  const spec = defaultSpec(topo, { r: DCM });
  const r = runSteady(topo, spec, topo.design(spec));
  const lo = Math.min(...r.traces.iL);
  assert.ok(lo < -0.05 * Math.max(...r.traces.iL),
    `the current should run backwards, but its minimum is ${lo.toFixed(4)} A`);
  /* And because it runs backwards, something is always conducting: the idle
     interval a diode-rectified converter opens up never appears. The buck
     above, at this very operating point, idles for a tenth of its period. */
  assert.ok(r.idle < 0.05,
    `a synchronous rectifier should keep conducting, but it idles for ${(r.idle * 100).toFixed(1)} % of the period`);
});

test("flyback — it stays in the mode its own design intends", () => {
  const topo = topoOf("flyback");
  const spec = defaultSpec(topo);
  const r = runSteady(topo, spec, topo.design(spec));
  /* K_rp below 1 is a request for continuous conduction: the valley is meant
     to sit above zero. */
  assert.ok(spec.krp < 1, "this test assumes a continuous-conduction design");
  assert.ok(!isIdle(r),
    `K_rp < 1 asks for continuous conduction, but it idles for ${(r.idle * 100).toFixed(1)} % of the period`);
});
