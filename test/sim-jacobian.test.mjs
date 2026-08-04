/* The period map's derivative, composed rather than measured.

   Shooting needs ∂P/∂x. It used to be taken by finite differences — one extra
   period run per state — which is why the number of states was capped at
   twelve. It is now composed from the Φ of each sub-step, which the solver
   already computed in order to take the step at all.

   Two things have to be true for that to be a refactor rather than a new
   approximation. The composed matrix must equal the measured one, which is
   what the first test says. And removing the cap must actually let a circuit
   with many states converge, which is what the second says. Where the fixed
   point ends up is pinned separately, by test/golden/sim.json. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPOS } from "../src/topologies/index.js";
import { prepare, runSteady } from "../src/engine/run.js";
import { runPeriod, converge } from "../src/engine/limitcycle.js";
import { makeSolver } from "../src/engine/solver.js";
import { defaultSpec } from "../scripts/lib/spec.mjs";

const byId = (id) => TOPOS.find((t) => t.id === id);

for (const id of ["buck", "sepic"]) {
  test(`${id} — the composed Jacobian is the one finite differences measure`, () => {
    const topo = byId(id);
    const spec = defaultSpec(topo);
    const res = topo.design(spec);
    const run = runSteady(topo, spec, res);
    const { S, mod, u } = prepare(topo, spec, res);
    const x = run.x, nx = S.nx;
    const cond = S.settle(mod.at(0), x, u);

    const got = runPeriod(S, x, u, mod, cond, 512, null, true);
    assert.ok(got.P, "the run returned no Jacobian");
    assert.equal(got.P.length, nx);

    /* The same quantity the old code measured, at the same point. */
    const base = got.x;
    for (let j = 0; j < nx; j++) {
      const d = Math.max(Math.abs(x[j]) * 1e-6, 1e-9);
      const xp = Float64Array.from(x);
      xp[j] += d;
      const rp = runPeriod(S, xp, u, mod, cond, 512);
      const fd = [];
      for (let i = 0; i < nx; i++) fd.push((rp.x[i] - base[i]) / d);

      /* Compared against the size of the COLUMN, not of each entry.

         A one-sided difference over a step of 1e-6·|x| carries an error
         somewhere around the square root of machine epsilon relative to the
         column it lives in — so an entry a decade below the column's largest
         is already at the noise floor, and holding it to a relative
         tolerance of its own would be asking finite differences to be more
         accurate than they are. That is the whole reason to stop using them:
         the composed matrix is exact for this conduction sequence, and this
         test is the loose one. */
      const colMax = Math.max(...fd.map(Math.abs), 1e-12);
      /* The noise floor, derived rather than tuned. A one-sided difference
         subtracts two numbers of size |x| and divides by a step of 1e-6·|x|,
         so double-precision rounding of about 1e-16·|x| arrives in the
         derivative as roughly 1e-10 — regardless of how small the true entry
         is. Below that, finite differences are measuring their own rounding,
         and SEPIC has a column where they do exactly that. */
      const tol = Math.max(0.02 * colMax, 2e-9);
      for (let i = 0; i < nx; i++) {
        assert.ok(Math.abs(fd[i] - got.P[i][j]) <= tol,
          `∂P_${i}/∂x_${j}: composed ${got.P[i][j]}, measured ${fd[i]}, `
          + `column scale ${colMax.toExponential(2)}`);
      }
    }

    /* And it is a real derivative, not an identity that happens to fit: the
       map must actually move the state. */
    let offDiagonal = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nx; j++) {
      if (i !== j) offDiagonal += Math.abs(got.P[i][j]);
    }
    assert.ok(offDiagonal > 1e-6, "the Jacobian has no coupling between states at all");
  });
}

test("a circuit with far more than twelve states still converges", () => {
  /* An LC ladder: twenty states, which the old nx ≤ 12 gate would have
     refused to shoot at, leaving it to plain iteration. Driven by a switch so
     it has a period to have a limit cycle over. */
  const N = 10;
  const branches = [
    { id: "Vin", type: "V", n: ["in", "0"], value: 12 },
    { id: "Q1", type: "SW", n: ["in", "n0"], ron: 5e-3, roff: 1e7 },
    { id: "Rq", type: "R", n: ["n0", "0"], value: 1e5 },
  ];
  for (let k = 0; k < N; k++) {
    branches.push({ id: `L${k}`, type: "L", n: [`n${k}`, `n${k + 1}`], value: 1e-5, esr: 0.05 });
    branches.push({ id: `C${k}`, type: "C", n: [`n${k + 1}`, "0"], value: 1e-6, esr: 0.01 });
  }
  branches.push({ id: "Rload", type: "R", n: [`n${N}`, "0"], value: 10 });

  const S = makeSolver(branches, { period: 1 / 100e3 });
  assert.ok(S.nx >= 20, `expected 20+ states, got ${S.nx}`);
  const mod = { edges: [0, 0.5], at: (uu) => ({ Q1: uu < 0.5 }) };
  const u = S.inputs({});
  const x0 = new Float64Array(S.nx);
  const conv = converge(S, x0, u, mod, { nSteps: 128, maxPeriods: 400, tol: 1e-7 });
  assert.ok(conv.residual < 1e-6,
    `a ${S.nx}-state ladder did not converge: residual ${conv.residual}`);
  assert.ok(conv.shots > 0, "shooting never engaged, so the cap is still effectively there");
  assert.ok([...conv.x].every(Number.isFinite), "the converged state is not finite");
});
