/* The MNA compiler, against state equations that can be written down.

   If these are wrong, everything above them is wrong in a way that looks
   like physics — a converter that runs, settles, and lies. So each case here
   is a circuit whose ẋ = Ax + Bu is textbook, checked entry by entry. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, readAt } from "../src/engine/mna.js";
import { expand, validate } from "../src/engine/netlist.js";

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);

const build = (branches, cond = {}) => compile(expand(validate(branches)), cond);

test("RC: v̇ = (u − v)/RC", () => {
  const R = 1000, C = 1e-6;
  const m = build([
    { id: "V1", type: "V", n: ["in", "0"], value: 5 },
    { id: "R1", type: "R", n: ["in", "out"], value: R },
    { id: "C1", type: "C", n: ["out", "0"], value: C },
  ]);
  near(m.A[0][0], -1 / (R * C), 1e-12, "pole");
  near(m.B[0][0], 1 / (R * C), 1e-12, "input gain");
});

test("RL: i̇ = (u − iR)/L", () => {
  const R = 2, L = 1e-3;
  const m = build([
    { id: "V1", type: "V", n: ["in", "0"], value: 12 },
    { id: "R1", type: "R", n: ["in", "out"], value: R },
    { id: "L1", type: "L", n: ["out", "0"], value: L },
  ]);
  near(m.A[0][0], -R / L, 1e-12, "pole");
  near(m.B[0][0], 1 / L, 1e-12, "input gain");
});

test("series LC: the undamped resonance is where it should be", () => {
  const L = 1e-6, C = 1e-6;
  const m = build([
    { id: "V1", type: "V", n: ["in", "0"], value: 0 },
    { id: "L1", type: "L", n: ["in", "mid"], value: L },
    { id: "C1", type: "C", n: ["mid", "0"], value: C },
  ]);
  /* states [i_L, v_C]: di/dt = (v_in − v_C)/L, dv/dt = i/C */
  near(m.A[0][1], -1 / L, 1e-12, "∂i̇/∂v");
  near(m.A[1][0], 1 / C, 1e-12, "∂v̇/∂i");
  near(m.A[0][0], 0, 1e-12, "no damping on i");
  near(m.A[1][1], 0, 1e-12, "no damping on v");
});

test("a buck with the switch on charges the inductor from the input", () => {
  const L = 1.7e-6, C = 25e-6, Rl = 0.33, ron = 8e-3;
  const net = [
    { id: "Vin", type: "V", n: ["in", "0"], value: 12 },
    { id: "Q1", type: "SW", n: ["in", "sw"], ron, roff: 1e7 },
    { id: "D1", type: "D", n: ["0", "sw"], ron: 5e-3, roff: 1e7, vf: 0.45 },
    { id: "L1", type: "L", n: ["sw", "out"], value: L },
    { id: "C1", type: "C", n: ["out", "0"], value: C },
    { id: "Rload", type: "R", n: ["out", "0"], value: Rl },
  ];
  const on = build(net, { Q1: true, D1: false });
  /* di/dt = (v_sw − v_out)/L, and with the switch closed v_sw ≈ v_in − i·ron.
     So ∂i̇/∂i ≈ −ron/L (plus a whisker through the off diode). */
  near(on.A[0][0], -ron / L, 2e-3, "∂i̇/∂i is the on-resistance");
  near(on.A[0][1], -1 / L, 1e-6, "∂i̇/∂v_out");
  near(on.B[0][0], 1 / L, 1e-3, "∂i̇/∂v_in");
  /* dv/dt = (i − v/R)/C */
  near(on.A[1][0], 1 / C, 1e-9, "∂v̇/∂i");
  near(on.A[1][1], -1 / (Rl * C), 1e-6, "∂v̇/∂v is the load");

  /* With the switch open and the diode conducting, the input no longer
     reaches the inductor at all — that entry must collapse. */
  const off = build(net, { Q1: false, D1: true });
  assert.ok(Math.abs(off.B[0][0]) < 1e-3 * Math.abs(on.B[0][0]),
    `input still drives di/dt when the switch is open: ${off.B[0][0]} vs ${on.B[0][0]}`);
  near(off.A[0][1], -1 / L, 1e-6, "∂i̇/∂v_out is unchanged by commutation");
});

test("the diode's forward drop appears as a real offset, not as a fudge", () => {
  const L = 1.7e-6, vf = 0.45;
  const m = build([
    { id: "Vin", type: "V", n: ["in", "0"], value: 12 },
    { id: "Q1", type: "SW", n: ["in", "sw"], ron: 8e-3, roff: 1e7 },
    { id: "D1", type: "D", n: ["0", "sw"], ron: 1e-4, roff: 1e7, vf },
    { id: "L1", type: "L", n: ["sw", "out"], value: L },
    { id: "C1", type: "C", n: ["out", "0"], value: 25e-6 },
    { id: "Rload", type: "R", n: ["out", "0"], value: 0.33 },
  ], { Q1: false, D1: true });
  /* Freewheeling, the switch node sits a diode drop below ground, so with
     v_out = 0 and i = 0 the inductor sees −v_f: the affine column. */
  const x = Float64Array.from([0, 0]);
  const u = Float64Array.from([0]);
  const di = m.A[0][0] * x[0] + m.A[0][1] * x[1] + m.B[0][0] * u[0] + m.B[0][1];
  near(di, -vf / L, 1e-3, "di/dt at rest is −v_f/L");
});

test("an ideal transformer scales voltage up and current down", () => {
  /* 4:1 step-down. Drive the primary through a resistor, load the secondary,
     and check the reflected impedance is r²·R_load. */
  const r = 4, RL = 10;
  const m = build([
    { id: "Vin", type: "V", n: ["p0", "0"], value: 1 },
    { id: "Rs", type: "R", n: ["p0", "p1"], value: 1e-6 },
    { id: "XF1", type: "XF", n: ["p1", "0", "s0", "0"], ratio: r },
    { id: "Rload", type: "R", n: ["s0", "0"], value: RL },
    { id: "Lm", type: "L", n: ["p1", "0"], value: 1e3 },
  ], {});
  const iprim = m.probeBranch("XF1");
  const x = Float64Array.from([0]), u = Float64Array.from([1]);
  const ip = readAt(iprim, x, u);
  /* v_p = 1 V across a reflected r²·R = 160 Ω */
  near(Math.abs(ip), 1 / (r * r * RL), 1e-3, "primary current sees r²·R_load");
  const vsec = m.probeNode("s0");
  near(readAt(vsec, x, u), 1 / r, 1e-3, "secondary voltage is stepped down by r");
});

test("probes read node voltages and branch currents consistently", () => {
  const m = build([
    { id: "V1", type: "V", n: ["in", "0"], value: 10 },
    { id: "R1", type: "R", n: ["in", "mid"], value: 100 },
    { id: "R2", type: "R", n: ["mid", "0"], value: 100 },
  ]);
  const x = new Float64Array(0), u = Float64Array.from([10]);
  near(readAt(m.probeNode("mid"), x, u), 5, 1e-12, "a divider halves it");
  near(readAt(m.probeBranch("R1"), x, u), 0.05, 1e-12, "and passes 50 mA");
});

test("capacitor ESR is in the circuit, not added to the answer afterwards", () => {
  /* The output node must sit above the capacitor's internal voltage by
     i·ESR — the ripple contribution that closed-form design adds by hand. */
  const esr = 0.05;
  const m = build([
    { id: "I1", type: "I", n: ["0", "out"], value: 2 },
    { id: "C1", type: "C", n: ["out", "0"], value: 1e-3, esr },
  ]);
  const x = Float64Array.from([3]);        /* 3 V on the capacitor itself */
  const u = Float64Array.from([2]);        /* 2 A pushed into the node */
  near(readAt(m.probeNode("out"), x, u), 3 + 2 * esr, 1e-9, "terminal = internal + i·ESR");
});
