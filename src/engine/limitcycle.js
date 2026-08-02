/* Run the circuit until it repeats, then describe the period it settled into.

   Steady state here is not asserted, it is reached: integrate period after
   period until the state at the end of one matches the state at the start,
   and whatever shape that converged period has is the answer. Charge balance
   on every capacitor, volt-second balance on every inductor, the exact
   division between continuous and discontinuous conduction — none of those
   are imposed, they are what convergence means.

   That also settles the question the animation cares about most. The old
   model looped seamlessly because its closed forms were constructed to
   balance; this one loops seamlessly because the converter it is simulating
   does, and the residual after convergence says by how much.

   What comes out is deliberately the same shape buildCycle returns, so every
   drawing surface — the waveform panes, the flow dashes, the polarity marks,
   the capacitor branches, the fields and EMC lenses — reads it unchanged. */
import { makeSolver } from "./solver.js";
import { lookups } from "../cycle.js";
import { lu, luSolve } from "./linalg.js";

const SAMPLES = 240;

/* Positions to sample the converged period at: an even rake, plus every gate
   edge, plus wherever a device changed state — so a commutation lands on a
   sample instead of being averaged across one. */
function grid(edges, events) {
  const s = new Set();
  for (let i = 0; i <= SAMPLES; i++) s.add(i / SAMPLES);
  for (const e of edges) { s.add(e); s.add(Math.min(e + 1e-6, 1)); }
  for (const e of events) { s.add(Math.max(e - 1e-6, 0)); s.add(e); s.add(Math.min(e + 1e-6, 1)); }
  return [...s].filter((u) => u >= 0 && u <= 1).sort((a, b) => a - b);
}

/* The graded sub-steps taken immediately after a gate edge, as fractions of
   a normal step.

   A switch closing onto its own output capacitance discharges it through the
   channel resistance, and that takes C_oss·R_DS(on) — picoseconds, against a
   step of nanoseconds. The energy is right either way, because each step is
   exact; what is wrong is the picture. Sampled on the ordinary grid, the
   spike is one lone point at fifteen hundred amps with nothing either side
   of it, and integrating that trapezoidally spreads a picosecond of current
   across a nanosecond of period — which lands in the charge balance as an
   error far larger than the charge involved.

   So the first few steps after an edge are tiny and grow geometrically. It
   costs about ten extra steps per edge and it resolves the transient that is
   actually there instead of aliasing it. */
const GRADE = [1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3];

/* Integrate one period from x, calling back at each sub-step. */
export function runPeriod(S, x, u, mod, cond, nSteps, onStep) {
  const edges = [...mod.edges, 1].sort((a, b) => a - b);
  let xs = x, cs = cond, t = 0, ei = 0;
  const h0 = 1 / nSteps;
  let guard = 0;
  let grade = -1;                     /* index into GRADE, -1 = full steps */
  const maxSteps = nSteps * 4 + 64 + edges.length * (GRADE.length + 2);
  while (t < 1 - 1e-12 && guard++ < maxSteps) {
    while (ei < edges.length && edges[ei] <= t + 1e-12) { ei++; grade = 0; }
    const nextEdge = ei < edges.length ? edges[ei] : 1;
    let h = h0;
    if (grade >= 0 && grade < GRADE.length) { h = h0 * GRADE[grade]; grade++; }
    else grade = -1;
    h = Math.min(h, nextEdge - t, 1 - t);
    if (h <= 1e-15) { t = nextEdge; continue; }
    const gates = mod.at(t + h * 0.5);
    const r = S.advance(xs, u, { ...cs, ...gates }, h);
    xs = r.x; cs = r.cond;
    t += h;
    if (onStep) onStep(t, xs, cs);
  }
  return { x: xs, cond: cs };
}

/* Converge to the limit cycle, from whatever state we are handed.

   Iterating the period map until it stops moving is the obvious method and
   it is far too slow to be useful: how fast a converter settles is set by
   its output time constant, and a boost with a 220 µF capacitor into 8 Ω
   takes a couple of thousand switching periods to forget where it started.
   That is real physics — it is precisely what the transient view exists to
   show — but it is a poor way to answer "what does the steady cycle look
   like", which is the question being asked here.

   So: shooting. The map from the state at the start of a period to the
   state at the end of it is smooth and very nearly linear in the
   neighbourhood of the fixed point, so its Jacobian can be measured with a
   handful of extra period runs and Newton's method jumps straight to the
   state that repeats. Thousands of periods become a dozen. The answer is
   the same answer — a state whose period map returns it — and the residual
   still says how well it holds.

   Newton is not trusted blindly. A step that makes the residual worse means
   the map was not smooth there, which happens when the step crosses a change
   in the conduction pattern; that step is discarded and plain iteration
   carries on, which always converges even when it converges slowly. */
export function converge(S, x0, u, mod, {
  nSteps = 512, maxPeriods = 4000, tol = 1e-7, shoot = true,
} = {}) {
  const nx = S.nx;
  const scale = new Float64Array(nx).fill(1);
  const noteScale = (x) => {
    for (let i = 0; i < nx; i++) scale[i] = Math.max(scale[i], Math.abs(x[i]));
  };
  const resid = (a, b) => {
    let s = 0;
    for (let i = 0; i < nx; i++) {
      const d = (a[i] - b[i]) / Math.max(scale[i], 1e-9);
      s += d * d;
    }
    return Math.sqrt(s / Math.max(nx, 1));
  };

  let x = x0, cond = S.settle(mod.at(0), x, u);
  let periods = 0, residual = Infinity;
  const step = (from) => {
    const r = runPeriod(S, from, u, mod, cond, nSteps);
    periods++;
    return r;
  };

  /* A few plain periods first: they cost little and they let the conduction
     pattern find itself before any derivative is measured across it. */
  for (let p = 0; p < 3; p++) {
    const before = x;
    const r = step(x);
    x = r.x; cond = r.cond;
    noteScale(x);
    residual = resid(x, before);
    if (residual < tol) return { x, cond, periods, residual, shots: 0 };
  }

  let shots = 0;
  for (let outer = 0; outer < maxPeriods; outer++) {
    const base = x;
    const mapped = step(base);
    noteScale(mapped.x);
    residual = resid(mapped.x, base);
    if (residual < tol) { x = mapped.x; cond = mapped.cond; break; }

    let advanced = false;
    if (shoot && nx > 0 && nx <= 12 && shots < 24) {
      /* J[i][j] = ∂P_i/∂x_j, by one extra period run per state. */
      const J = [];
      let ok = true;
      for (let j = 0; j < nx && ok; j++) {
        const d = Math.max(Math.abs(scale[j]) * 1e-6, 1e-9);
        const xp = Float64Array.from(base);
        xp[j] += d;
        const rp = step(xp);
        const col = new Float64Array(nx);
        for (let i = 0; i < nx; i++) {
          col[i] = (rp.x[i] - mapped.x[i]) / d;
          if (!Number.isFinite(col[i])) ok = false;
        }
        J.push(col);
      }
      if (ok) {
        /* Solve (I − J)Δ = P(x) − x, with J held column-wise above. */
        const M = [];
        for (let i = 0; i < nx; i++) {
          const row = new Float64Array(nx);
          for (let j = 0; j < nx; j++) row[j] = (i === j ? 1 : 0) - J[j][i];
          M.push(row);
        }
        const rhs = new Float64Array(nx);
        for (let i = 0; i < nx; i++) rhs[i] = mapped.x[i] - base[i];
        const F = lu(M);
        if (F) {
          const dx = luSolve(F, rhs);
          const cand = Float64Array.from(base);
          let finite = true;
          for (let i = 0; i < nx; i++) {
            cand[i] += dx[i];
            if (!Number.isFinite(cand[i])) finite = false;
          }
          if (finite) {
            const after = step(cand);
            const rr = resid(after.x, cand);
            if (rr < residual) {
              x = cand; cond = after.cond; residual = rr; advanced = true; shots++;
              if (residual < tol) break;
            }
          }
        }
      }
    }
    /* Newton declined or made things worse — walk. */
    if (!advanced) { x = mapped.x; cond = mapped.cond; }
    if (periods > maxPeriods) break;
  }
  return { x, cond, periods, residual, shots };
}

/* Sample one converged period into polylines and probe traces.

   Every probe is evaluated at a recorded step, under the conduction state
   that was actually in force there. Nothing is interpolated across a
   commutation, and that is not a refinement — it is the difference between a
   trace and nonsense. A state interpolated halfway through a diode turning
   on, then read as though the diode were already conducting, describes a
   switch node sitting at six volts with a conducting diode across it: the
   arithmetic duly reports several thousand amps through a device that is
   carrying almost none. The trajectory is continuous; the reading of it is
   not, so the reading happens only where the model is self-consistent.

   The recorded points are the output. A commutation leaves two of them at
   the same instant with different states, which is a vertical edge — the
   shape lookups() already expects, being how the closed-form model has
   always drawn an instantaneous transfer of current. */
export function sample(S, x0, u, mod, spec) {
  const { nSteps = 512, probes = {} } = spec || {};
  const events = [];
  const us = [];
  const states = [];
  const conds = [];
  let prevCond = null;

  const cond0 = S.settle(mod.at(0), x0, u);
  us.push(0); states.push(x0); conds.push(cond0);
  prevCond = cond0;

  runPeriod(S, x0, u, mod, cond0, nSteps, (t, x, c) => {
    const uu = Math.min(t, 1);
    for (const id of S.ids) {
      if (!!prevCond[id] !== !!c[id]) { events.push(uu); break; }
    }
    /* One record per step, each holding a state and the conduction pattern
       that state was reached under. Never a state paired with a neighbour's
       pattern: that mismatch is what reports thousands of amps through a
       diode at the instant it stops conducting. */
    us.push(uu); states.push(x); conds.push(c);
    prevCond = c;
  });

  const out = { u: us, events, traces: {}, states, condAt: conds };
  for (const [name, p] of Object.entries(probes)) {
    out.traces[name] = us.map((_, k) => S.read(p.kind, p.id, conds[k], states[k], u));
  }
  return out;
}

/* Turn a sampled trace into the {at, slope, qAt, qTot} surface the drawings
   already speak, plus the polyline they plot. */
export function traceView(us, vals) {
  const pts = us.map((u, i) => ({ u, i: vals[i] }));
  const L = lookups(pts);
  let iMin = Infinity, iMax = -Infinity;
  for (const v of vals) { if (v < iMin) iMin = v; if (v > iMax) iMax = v; }
  return { pts, at: L.at, slope: L.slope, qAt: L.qAt, qTot: L.qTot, iMin, iMax };
}

export { makeSolver };
