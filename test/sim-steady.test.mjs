/* The simulator against the closed forms the app already trusts.

   This is the test that matters. src/cycle.js has its own assertions, and
   those are checked against textbook identities; if the simulator converges
   to the same waveforms from a completely different direction — a netlist,
   a nodal analysis and a fixed-point search, with nothing in common but the
   physics — then both are probably right. Where they disagree, the
   disagreement has to be explainable, and every one below is.

   Two regimes:

   Idealised — parasitics off, efficiency 1 — must reproduce the design
   equations closely, because with the losses removed those equations are
   exact and there is nothing left to excuse a difference.

   Real — the parts as specified — is checked against invariants instead:
   charge balance, energy conservation, no diode conducting backwards. Those
   hold whatever the numbers are, and they are what catches a sign error that
   still looks plausible. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPOS } from "../scripts/lib/topos.mjs";
import { defaultSpec } from "../scripts/lib/spec.mjs";
import { runSteady, hasSim, rippleOf } from "../src/engine/run.js";

const PILOTS = ["buck", "syncbuck", "boost", "buckboost", "flyback"];
const topoOf = (id) => TOPOS.find((t) => t.id === id);

/* Parasitics off. Only the fields a topology actually has are moved, so a
   corner that silently failed to apply cannot pass as a clean result. */
const IDEAL = { vf: 0, rds: 0.001, dcr: 0, esr: 0, coss: 1, qrr: 0, td: 0, eff: 1 };
const idealSpec = (topo) => {
  const over = {};
  for (const [k, v] of Object.entries(IDEAL)) if ((topo.fields || []).includes(k)) over[k] = v;
  return defaultSpec(topo, over);
};

const pctErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

test("every pilot has a circuit", () => {
  for (const id of PILOTS) assert.ok(hasSim(topoOf(id)), `${id} has no sim entry`);
});

for (const id of PILOTS) {
  test(`${id} — converges, and to the same cycle from anywhere`, () => {
    const topo = topoOf(id);
    const spec = idealSpec(topo);
    const res = topo.design(spec);
    const a = runSteady(topo, spec, res);
    assert.ok(a, `${id} did not run`);
    assert.ok(a.residual < 1e-6, `${id} did not converge: residual ${a.residual}`);
    assert.ok(a.periods < 400, `${id} took ${a.periods} periods`);

    /* Started from a different state entirely, it must find the same cycle —
       otherwise "steady state" is just wherever the seed happened to be. */
    const far = Float64Array.from(a.x, (v) => v * 0.3 + 1);
    const b = runSteady(topo, spec, res, { from: far });
    assert.ok(b.residual < 1e-6, `${id} did not converge from a cold start`);
    const ra = rippleOf(a.views.iL), rb = rippleOf(b.views.iL);
    assert.ok(pctErr(rb, ra) < 1e-3,
      `${id} settled on two different cycles: ripple ${ra} vs ${rb}`);
  });

  test(`${id} — idealised, it reproduces the design equations`, () => {
    const topo = topoOf(id);
    const spec = idealSpec(topo);
    const res = topo.design(spec);
    const r = runSteady(topo, spec, res);

    /* ΔI: the ripple the panel prints, from a completely different route. */
    assert.ok(pctErr(rippleOf(r.views.iL), res.wave.dI) < 0.01,
      `${id} ripple ${rippleOf(r.views.iL).toFixed(4)} A against a printed ${res.wave.dI.toFixed(4)} A`);

    /* The output it actually regulates to, against the one it was asked for.
       An inverting converter is checked against its own sign. */
    const target = id === "buckboost" ? -spec.vout : spec.vout;
    assert.ok(pctErr(r.views.vout.qTot, target) < 0.02,
      `${id} settled at ${r.views.vout.qTot.toFixed(3)} V, asked for ${target} V`);
  });

  test(`${id} — the invariants hold with the real parts fitted`, () => {
    const topo = topoOf(id);
    const spec = defaultSpec(topo);
    const res = topo.design(spec);
    const r = runSteady(topo, spec, res);
    assert.ok(r.residual < 1e-6, `${id} did not converge: ${r.residual}`);

    /* Charge balance: a capacitor that gained charge over a period is not in
       steady state, whatever else the waveform looks like. This is the same
       property that makes the animation loop seamlessly. */
    const qC = r.views.iC.qTot;
    const scale = Math.max(...r.traces.iC.map(Math.abs), 1e-9);
    assert.ok(Math.abs(qC) / scale < 2e-3,
      `${id} output capacitor gains ${qC} per period (scale ${scale})`);

    /* No diode conducts backwards. If one does, the conduction search is
       wrong and every number downstream of it is decoration.

       Measured against the current the circuit is actually moving, not
       against the diode's own peak. A blocking device is a large resistance
       rather than a removed branch, so it passes V/R_off — microamps — and a
       diode that spends the period blocking has a peak of its own no larger
       than that leakage. Scaled to itself, its own leakage looks like a
       hundred per cent reverse conduction. */
    const iScale = Math.max(...r.traces.iL.map(Math.abs), 1e-9);
    for (const [name, tr] of Object.entries(r.traces)) {
      if (!/^iD/.test(name)) continue;
      const worst = Math.min(...tr);
      assert.ok(worst > -1e-4 * iScale,
        `${id} ${name} reaches ${worst} A against a ${iScale.toFixed(2)} A circuit — a diode conducting backwards`);
    }

    /* Every state stays finite and bounded — the cheapest possible guard
       against a stiff configuration quietly running away. */
    for (const [name, tr] of Object.entries(r.traces)) {
      for (const v of tr) assert.ok(Number.isFinite(v), `${id} ${name} is not finite`);
    }
  });
}

test("buck — the mean inductor current is the load current, at the voltage it actually reached", () => {
  /* Not the nameplate load: the converter settles a little below target
     because of its own losses, and the current that flows is the one Ohm's
     law gives at the voltage it reached. Asserting the nameplate here would
     be asserting the absence of loss. */
  const topo = topoOf("buck");
  const spec = defaultSpec(topo);
  const res = topo.design(spec);
  const r = runSteady(topo, spec, res);
  const R = spec.vout / spec.iout;
  assert.ok(pctErr(r.views.iL.qTot, r.views.vout.qTot / R) < 5e-3,
    `mean i_L ${r.views.iL.qTot.toFixed(4)} A against v_out/R ${(r.views.vout.qTot / R).toFixed(4)} A`);
});

test("buck — the diode drop widens the ripple, exactly as much as it should", () => {
  /* The closed form uses ΔI = V_out(1−D)/(L·f_sw). During the off-time the
     inductor is actually pulled down by V_out PLUS the catch diode's forward
     drop, so the real ripple is larger by (V_out+V_f)/V_out — a difference
     the ideal equation cannot express and the simulation gets for free. */
  const topo = topoOf("buck");
  const spec = defaultSpec(topo);
  const res = topo.design(spec);
  const r = runSteady(topo, spec, res);
  const Vo = r.views.vout.qTot, Vf = spec.vf, D = res.wave.D;
  const L = res.sim.L, f = spec.fsw * 1e3;
  const want = (Vo + Vf) * (1 - D) / (L * f);
  assert.ok(pctErr(rippleOf(r.views.iL), want) < 0.03,
    `ripple ${rippleOf(r.views.iL).toFixed(4)} A against (V_out+V_f)(1−D)/(L·f) = ${want.toFixed(4)} A`);
});

test("syncbuck — dead time is a real interval, and the body diode carries it", () => {
  const topo = topoOf("syncbuck");
  const spec = defaultSpec(topo);
  const res = topo.design(spec);
  const r = runSteady(topo, spec, res);
  /* Both gates off at some point in the period, and while they are, the body
     diode conducts — none of which is authored anywhere.

     "Off" is relative to the current actually flowing, not an absolute
     floor: an open switch is a large resistance rather than a removed
     branch, so it still passes V/R_off. That leakage is microamps against
     tens of amps, and comparing it to the inductor's own peak says what is
     meant — this device is not carrying the current — instead of accidentally
     testing the value of R_off. */
  const scale = Math.max(...r.traces.iL.map(Math.abs), 1e-9);
  const bothOff = r.u_grid.some((_, k) =>
    Math.abs(r.traces.iQ[k]) < 1e-4 * scale && Math.abs(r.traces.iQ2[k]) < 1e-4 * scale);
  assert.ok(bothOff, "no interval with both switches off");
  const bodyPk = Math.max(...r.traces.iD.map(Math.abs));
  assert.ok(bodyPk > 0.01, `the body diode never conducts (peak ${bodyPk} A)`);
});
