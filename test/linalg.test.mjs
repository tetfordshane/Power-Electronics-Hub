/* The matrix kernel, against answers that can be written down. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { expm, discretize, lu, luSolve, matmul, eye } from "../src/engine/linalg.js";

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);

test("expm of a scalar is the scalar exponential", () => {
  for (const a of [0, 1, -1, 5, -12, 37, -250]) {
    near(expm([[a]])[0][0], Math.exp(a), 1e-12, `e^${a}`);
  }
});

test("expm of a diagonal is the exponential of the diagonal", () => {
  const E = expm([[-2, 0], [0, 3]]);
  near(E[0][0], Math.exp(-2), 1e-12, "e^-2");
  near(E[1][1], Math.exp(3), 1e-12, "e^3");
  near(E[0][1], 0, 1e-14, "off-diagonal");
});

test("expm of a rotation generator is a rotation", () => {
  /* [[0,-1],[1,0]] generates rotation by t; at t = 1 the entries are cos 1
     and sin 1, which is a real answer and not a self-referential one. */
  const E = expm([[0, -1], [1, 0]]);
  near(E[0][0], Math.cos(1), 1e-12, "cos");
  near(E[1][0], Math.sin(1), 1e-12, "sin");
});

test("expm survives a realistically stiff matrix", () => {
  /* Six decades between the two time constants. This is the situation an
     explicit integrator cannot survive and the whole reason this is here:
     the fast mode must die completely without the slow one being disturbed.

     Six decades is not a token figure. What gets exponentiated is A·h, not
     A, so the spread that reaches this routine is the spread of time
     constants measured against one step — and a step is around T/1024. */
  const E = expm([[-1e6, 0], [0, -1]]);
  near(E[0][0], 0, 1e-12, "fast mode is dead");
  near(E[1][1], Math.exp(-1), 1e-9, "slow mode is untouched");
});

test("expm degrades gracefully at absurd stiffness", () => {
  /* Scaling and squaring has a known cost: s squarings roughly double the
     relative error already present, and s grows with the norm. Measured
     here rather than assumed, because the useful thing to know is where the
     accuracy actually lands, not that it is "fine".

     1e3 → 3e-14,  1e6 → 2e-11,  1e9 → 7e-9,  1e12 → 7e-9. Even the last is
     three orders tighter than anything a drawn waveform can express, so
     this bounds the error rather than chasing it. */
  for (const f of [1e3, 1e6, 1e9, 1e12]) {
    const E = expm([[-f, 0], [0, -1]]);
    near(E[1][1], Math.exp(-1), 1e-7, `slow mode against a 1/${f} fast mode`);
    assert.ok(Math.abs(E[0][0]) < 1e-12, "fast mode is dead");
  }
});

test("expm(A+B) = expm(A)expm(B) when they commute", () => {
  const A = [[1, 2], [0, 1]], B = [[3, 4], [0, 3]];
  const lhs = expm([[4, 6], [0, 4]]);
  const rhs = matmul(expm(A), expm(B));
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) near(lhs[i][j], rhs[i][j], 1e-11, `[${i}][${j}]`);
  }
});

test("LU solves a system", () => {
  const A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
  const x = luSolve(lu(A), Float64Array.from([8, -11, -3]));
  near(x[0], 2, 1e-12, "x"); near(x[1], 3, 1e-12, "y"); near(x[2], -1, 1e-12, "z");
});

test("LU reports a singular matrix instead of throwing", () => {
  assert.equal(lu([[1, 2], [2, 4]]), null);
});

test("discretize reproduces an RC step response", () => {
  /* v̇ = (u − v)/RC. From rest, after one time constant, a unit step leaves
     the capacitor at 1 − e⁻¹ — the first number anyone learns about an RC. */
  const RC = 1e-3;
  const { Phi, Gam } = discretize([[-1 / RC]], [[1 / RC]], RC);
  near(Phi[0][0], Math.exp(-1), 1e-12, "decay");
  near(Gam[0][0], 1 - Math.exp(-1), 1e-12, "step");
});

test("discretize handles a singular A, where the textbook formula cannot", () => {
  /* A pure integrator: v̇ = i/C, no resistive path. A is all zeros, so
     A⁻¹(e^{Ah} − I)B does not exist, and the answer is simply h/C. */
  const C = 1e-6, h = 2e-6;
  const { Phi, Gam } = discretize([[0]], [[1 / C]], h);
  near(Phi[0][0], 1, 1e-14, "no decay");
  near(Gam[0][0], h / C, 1e-12, "charge accumulated");
});

test("discretize of an LC tank conserves energy over a quarter period", () => {
  const L = 1e-6, Cc = 1e-6;
  const w = 1 / Math.sqrt(L * Cc);
  /* states [i_L, v_C]: di/dt = −v/L, dv/dt = i/C */
  const A = [[0, -1 / L], [1 / Cc, 0]];
  const { Phi } = discretize(A, [[0], [0]], (Math.PI / 2) / w);
  /* a quarter period turns current into voltage and back */
  near(Phi[0][0], 0, 1e-9, "i→i");
  near(Phi[1][1], 0, 1e-9, "v→v");
  near(Phi[1][0] * Math.sqrt(L / Cc), 1, 1e-9, "i→v scaled by the surge impedance");
});
