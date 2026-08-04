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
import { lu, luSolve, matmul, matvec } from "./linalg.js";

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

/* Integrate one period from x, calling back at each sub-step.

   With `want`, it also returns the period map's own derivative: P such that
   the period takes x to P·x + g, for the conduction sequence this run walked.
   That is exactly the Jacobian shooting needs, and it comes out of the step
   matrices the solver already had rather than out of nx more period runs. */
export function runPeriod(S, x, u, mod, cond, nSteps, onStep, want) {
  const edges = [...mod.edges, 1].sort((a, b) => a - b);
  let xs = x, cs = cond, t = 0, ei = 0;
  const h0 = 1 / nSteps;
  let guard = 0;
  let grade = -1;                     /* index into GRADE, -1 = full steps */
  const maxSteps = nSteps * 4 + 64 + edges.length * (GRADE.length + 2);
  let P = null, g = null;
  while (t < 1 - 1e-12 && guard++ < maxSteps) {
    while (ei < edges.length && edges[ei] <= t + 1e-12) { ei++; grade = 0; }
    const nextEdge = ei < edges.length ? edges[ei] : 1;
    let h = h0;
    if (grade >= 0 && grade < GRADE.length) { h = h0 * GRADE[grade]; grade++; }
    else grade = -1;
    h = Math.min(h, nextEdge - t, 1 - t);
    if (h <= 1e-15) { t = nextEdge; continue; }
    const gates = mod.at(t + h * 0.5);
    const r = S.advance(xs, u, { ...cs, ...gates }, h, want);
    xs = r.x; cs = r.cond;
    if (want && r.P) {
      if (!P) { P = r.P; g = r.g; }
      else {
        P = matmul(r.P, P);
        const ng = matvec(r.P, g);
        for (let i = 0; i < ng.length; i++) ng[i] += r.g[i];
        g = ng;
      }
    }
    t += h;
    if (onStep) onStep(t, xs, cs);
  }
  return { x: xs, cond: cs, P, g };
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
  nSteps = 512, maxPeriods = 4000, tol = 1e-7, shoot = true, deadline = 0,
} = {}) {
  /* A wall clock, because a period budget is not one.

     How long a circuit takes per period depends on its size, and this engine
     now accepts circuits whose size is set by an input — a multiphase buck
     runs from one leg to twenty-four. Four thousand periods is a fraction of
     a second on a buck and most of a minute on a converter with fifty states,
     and the reader turning the knob experiences the second one as a hang.

     Missing the deadline is not an error. It returns the best state found so
     far, with its real residual, and the adapter decides: below 1e-4 the
     figure is simulated, above it the page says so and draws the closed form.
     That is the same judgement it already makes about a circuit that did not
     converge for any other reason. */
  const until = deadline > 0 ? Date.now() + deadline : 0;
  const outOfTime = () => until > 0 && Date.now() > until;
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
  const step = (from, want) => {
    const r = runPeriod(S, from, u, mod, cond, nSteps, null, want);
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
  /* A piecewise-linear element puts a floor under the residual.

     A saturating winding is modelled as a stack of linear buckets, so the
     period map has a small step at every boundary and the fixed point can
     sit astride one — the iteration then oscillates between two states a
     bucket apart and the residual stops falling. That is not a failure to
     converge, it is convergence to the resolution the model has, and
     grinding out four thousand periods to discover it wastes a second and a
     half. Stop when it stops improving, and report the best state found. */
  let best = x, bestRes = Infinity, stale = 0, lastJ = null, lam = 0;
  for (let outer = 0; outer < maxPeriods; outer++) {
    const base = x;
    /* Ask for the derivative only when we do not already have a usable one.

       Near the fixed point the conduction sequence stops changing, so the
       period map is very nearly the same linear map from one iteration to the
       next and the previous Jacobian still points the right way. Reusing it
       is the classic Shamanskii economy, and it is safe for the same reason
       Newton is safe here: a step that fails to improve the residual is
       thrown away — and that is also the signal to measure a fresh one, since
       a rejected step is precisely what a stale Jacobian produces. */
    const mapped = step(base, shoot && nx > 0 && !lastJ);
    if (mapped.P) lastJ = mapped.P;
    noteScale(mapped.x);
    residual = resid(mapped.x, base);
    if (residual < bestRes * 0.9) { bestRes = residual; best = mapped.x; stale = 0; }
    else if (++stale > 40) { x = best; residual = bestRes; break; }
    if (residual < tol) { x = mapped.x; cond = mapped.cond; break; }
    if (outOfTime()) {
      if (bestRes < residual) { x = best; residual = bestRes; }
      else { x = mapped.x; cond = mapped.cond; }
      break;
    }

    let advanced = false;
    if (shoot && nx > 0 && shots < 24) {
      /* J[i][j] = ∂P_i/∂x_j, composed from the step matrices the run just
         used. Two things it is worth being precise about.

         It is the derivative holding the switching instants FIXED — an event
         time moves with x, and the term that accounts for that (the saltation
         matrix) is not here. So this is first-order correct near the fixed
         point and approximate where a commutation is about to move, which is
         exactly the case Newton is already defended against below: a step
         that does not improve the residual is discarded and plain iteration
         carries on.

         And it costs one period run rather than nx of them. That is what
         removes the old nx ≤ 12 ceiling: the price of shooting no longer
         grows with the number of states, so an interleaved buck with
         forty-nine of them is as reachable as a boost with two. */
      const J = lastJ;
      if (J) {
        const rhs = new Float64Array(nx);
        for (let i = 0; i < nx; i++) rhs[i] = mapped.x[i] - base[i];
        let scaleJ = 0;
        for (let i = 0; i < nx; i++) {
          let s = 0;
          for (let j = 0; j < nx; j++) s += Math.abs((i === j ? 1 : 0) - J[i][j]);
          scaleJ = Math.max(scaleJ, s);
        }

        /* Solve (I − J)Δ = P(x) − x, damped by λ on the diagonal.

           Some converters have a mode with almost nothing restoring it, and a
           multiphase buck is the clearest: the SUM of its phase currents is
           held by the output, but the DIFFERENCE between them is opposed only
           by winding resistance. That is not a defect in the model, it is why
           real interleaved converters need active current sharing — and it
           makes (I − J) near-singular along that direction, so the undamped
           step is enormous there and lands nowhere useful.

           λ trades the exact step for a shorter one that is still right in
           every well-conditioned direction. Zero first, because where the map
           is affine and well conditioned — which is most of the catalogue —
           it jumps straight to the fixed point and nothing here costs
           anything. */
        /* λ is carried between iterations rather than searched within one.
           A ladder tried inside a single iteration costs a period run per
           rung and, on a circuit where every rung is refused, burns the
           period budget several times faster than plain iteration would have
           — which is how a first attempt at this stopped a SEPIC converging
           at light load. Damped Newton pays for at most one extra run per
           iteration, exactly as the undamped version did: raise λ when a step
           is refused, lower it when one lands. */
        const M = [];
        for (let i = 0; i < nx; i++) {
          const row = new Float64Array(nx);
          for (let j = 0; j < nx; j++) {
            row[j] = (i === j ? 1 : 0) - J[i][j] + (i === j ? lam * scaleJ : 0);
          }
          M.push(row);
        }
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
              lam = lam > 1e-9 ? lam / 8 : 0;
              if (residual < tol) break;
            } else {
              lam = lam > 0 ? Math.min(lam * 8, 1e-1) : 1e-7;
            }
          }
        }
      }
    }
    /* Newton declined or made things worse — walk, and throw the Jacobian
       away so the next iteration measures a fresh one. A rejected step means
       the map is no longer the map this J describes. */
    if (!advanced) { x = mapped.x; cond = mapped.cond; lastJ = null; }
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
