/* Stepping the circuit, and deciding which devices conduct.

   This is where discontinuous conduction stops being a thing the app is told
   and becomes a thing it discovers. Nothing here knows what a buck is. A
   diode conducts when the circuit forward-biases it and stops when its own
   current reaches zero, and if that happens halfway through the off-time
   then the inductor current sits at zero for the rest of the period — which
   is DCM, arrived at rather than declared.

   Two ideas carry the whole file:

   1. Between events the circuit is linear and time-invariant, so the step is
      exact: x ← Φx + Γu, with Φ and Γ from the matrix exponential. Not a
      small-step approximation that gets better as h shrinks — the same
      answer at any h. Configurations are compiled and cached the first time
      they are visited, and there are only a handful.

   2. A device changing state is an event, located in time rather than
      rounded to the nearest step. Stepping over a zero crossing and
      correcting afterwards is what puts a kink in a waveform and a spike in
      a loss figure; bisecting to find it keeps the current continuous
      through the commutation, which is the thing the animation is judged on. */
import { compile, readAt } from "./mna.js";
import { discretize, matvec } from "./linalg.js";
import { expand, validate } from "./netlist.js";

const KEY = (cond, ids) => ids.map((id) => (cond[id] ? "1" : "0")).join("");

/* `period` puts the whole engine on the same clock as the drawings.

   Everything that reads a cycle — the waveform panes, the flow dashes, the
   phase windows — measures position as u ∈ [0,1) across one switching
   period, and asks for slopes in amps per period. The state equations come
   out of the netlist in SI, per second. Scaling A and B by the period once,
   here, means every step size, every gate edge and every event time in this
   engine is a fraction of a period, and no caller has to remember which
   clock it is holding. Getting this wrong does not fail loudly: a step of
   1/512 is read as a fraction of a second, the inductor charges for two
   milliseconds, and the converter appears to explode. */
export function makeSolver(branches, { maxConfigs = 8192, period = 1 } = {}) {
  const net = expand(validate(branches));
  const scaleTime = (m) => {
    if (period === 1) return m;
    for (let i = 0; i < m.A.length; i++) {
      for (let j = 0; j < m.A[i].length; j++) m.A[i][j] *= period;
      for (let j = 0; j < m.B[i].length; j++) m.B[i][j] *= period;
    }
    return m;
  };
  const switches = net.filter((b) => b.type === "SW" || b.type === "D");
  const diodes = net.filter((b) => b.type === "D");
  const ids = switches.map((b) => b.id);
  const byId = new Map(net.map((b) => [b.id, b]));

  /* Where each energy-storage branch sits in the state vector, in the same
     order indexOf() assigns — needed before any configuration exists, to
     read a winding's own current out of a state. */
  const stateIndexOf = new Map();
  {
    let i = 0;
    for (const b of net) if (b.type === "L" || b.type === "C") stateIndexOf.set(b.id, i++);
  }

  /* Saturating cores.

     A real inductor loses inductance as its current rises, and a datasheet
     quotes that as a roll-off at the peak. The model is the one cycle.js
     already uses, so the two cannot describe different magnetics:

         L(i) = L₀ / (1 + κ(i/I_ref)²),   κ = s/(1−s)

     which gives L(0) = L₀ and L(I_ref) = (1−s)·L₀ exactly.

     Everything above this file assumes each configuration is linear, and a
     current-dependent inductance is not. So it is made piecewise linear: the
     winding current is bucketed, each bucket takes the inductance at its own
     level, and the pair (conduction state, bucket) is what identifies a
     configuration. Crossing a bucket boundary is then just another
     configuration change, handled by the machinery already here.

     Buckets are spaced by the square root of current, so they are close
     together where L is moving fastest — near the peak — rather than evenly
     spread across a range whose lower half barely bends at all. */
  const satL = net.filter((b) => b.type === "L" && b.sat > 0 && b.iref > 0);
  const NB = 600;
  const bucketOf = (b, i) => {
    const t = Math.min(Math.abs(i) / b.iref, 1.6) / 1.6;
    return Math.round(Math.sqrt(t) * NB);
  };
  const bucketL = (b, k) => {
    const t = ((k / NB) ** 2) * 1.6;
    const kap = b.sat / (1 - b.sat);
    return b.value / (1 + kap * t * t);
  };

  const cache = new Map();
  const configFor = (cond, x) => {
    let k = KEY(cond, ids);
    let lmap;
    if (satL.length && x) {
      lmap = {};
      let tag = "|";
      for (const b of satL) {
        const j = stateIndexOf.get(b.id);
        const bk = bucketOf(b, j === undefined ? 0 : x[j]);
        lmap[b.id] = bucketL(b, bk);
        tag += bk + ".";
      }
      k += tag;
    }
    let c = cache.get(k);
    if (!c) {
      if (cache.size > maxConfigs) cache.clear();
      const m = scaleTime(compile(net, cond, lmap));
      if (!m) throw new Error("solver: this conduction state has no solution");
      c = { m, steps: new Map(), probes: new Map() };
      cache.set(k, c);
    }
    return c;
  };
  /* Φ and Γ are per (configuration, step size). A run uses one or two step
     sizes, so this stays tiny; an event bisection asks for odd ones and they
     are computed on the spot. */
  const stepFor = (c, h) => {
    const k = h.toExponential(12);
    let s = c.steps.get(k);
    if (!s) { s = discretize(c.m.A, c.m.B, h); c.steps.set(k, s); }
    return s;
  };
  const probe = (c, kind, id) => {
    const k = kind + ":" + id;
    let p = c.probes.get(k);
    if (p === undefined) {
      p = kind === "node" ? c.m.probeNode(id)
        : kind === "across" ? c.m.probeAcross(id) : c.m.probeBranch(id);
      c.probes.set(k, p);
    }
    return p;
  };

  const m0 = scaleTime(compile(net, Object.fromEntries(ids.map((id) => [id, false]))));
  const nx = m0.nx, nu = m0.nu;

  /* The input vector, with the trailing 1 the affine terms ride on. */
  const inputs = (values) => {
    const u = new Float64Array(nu + 1);
    m0.idx.sources.forEach((b, i) => { u[i] = values[b.id] !== undefined ? values[b.id] : b.value; });
    u[nu] = 1;
    return u;
  };

  /* ------------------------------------------------ conduction consistency */
  /* Given the commanded gates and a starting guess, find a diode state that
     is self-consistent: nothing conducting backwards, nothing blocking a
     forward bias. This is the fixed point of "assume, solve, correct". */
  function settle(cond, x, u) {
    const c0 = { ...cond };
    for (let iter = 0; iter < 12; iter++) {
      const c = configFor(c0, x);
      let changed = false;
      for (const d of diodes) {
        if (c0[d.id]) {
          /* conducting: does its current still flow the right way? */
          const i = readAt(probe(c, "branch", d.id), x, u);
          if (i < -1e-12) { c0[d.id] = false; changed = true; }
        } else {
          /* blocking: is it forward-biased past its own drop? */
          const v = readAt(probe(c, "across", d.id), x, u);
          if (v > (d.vf || 0) + 1e-12) { c0[d.id] = true; changed = true; }
        }
      }
      if (!changed) return c0;
    }
    /* No fixed point — chattering between two states, which happens right at
       a crossing. Keep the last one; the event search below lands on it. */
    return c0;
  }

  /* How far a diode is from changing state, as a signed quantity that is
     positive while the current state remains valid. Zero is the event. */
  function margin(c, d, cond, x, u) {
    return cond[d.id]
      ? readAt(probe(c, "branch", d.id), x, u)
      : (d.vf || 0) - readAt(probe(c, "across", d.id), x, u);
  }

  /* --------------------------------------------------------------- stepping */
  /* Advance by h under fixed gates, splitting the step at the first diode
     event if one occurs inside it. Returns the new state and the conduction
     state in force at the end. */
  function advance(x, u, cond, h) {
    let t = 0, xs = x, cs = settle(cond, xs, u);
    let guard = 0;
    while (t < h - 1e-18 && guard++ < 16) {
      const c = configFor(cs, xs);
      const rest = h - t;
      const { Phi, Gam } = stepFor(c, rest);
      const xn = matvec(Phi, xs);
      const g = matvec(Gam, u);
      for (let i = 0; i < nx; i++) xn[i] += g[i];

      /* Did any diode's margin change sign across this step? */
      let hit = null, hitAt = rest;
      for (const d of diodes) {
        const m0v = margin(c, d, cs, xs, u);
        const m1v = margin(c, d, cs, xn, u);
        if (m0v > 0 && m1v < 0) {
          /* bisect for the crossing — the configuration is fixed across the
             interval, so this is a smooth scalar root, not a search */
          let lo = 0, hi = rest;
          for (let k = 0; k < 40 && hi - lo > 1e-18; k++) {
            const mid = 0.5 * (lo + hi);
            const s = stepFor(c, mid);
            const xm = matvec(s.Phi, xs);
            const gm = matvec(s.Gam, u);
            for (let i = 0; i < nx; i++) xm[i] += gm[i];
            if (margin(c, d, cs, xm, u) > 0) lo = mid; else hi = mid;
          }
          if (hi < hitAt) { hitAt = hi; hit = d; }
        }
      }

      if (!hit) { xs = xn; t = h; break; }
      const s = stepFor(c, hitAt);
      const xm = matvec(s.Phi, xs);
      const gm = matvec(s.Gam, u);
      for (let i = 0; i < nx; i++) xm[i] += gm[i];
      xs = xm;
      t += hitAt;
      cs = settle({ ...cs, [hit.id]: !cs[hit.id] }, xs, u);
    }
    return { x: xs, cond: cs };
  }

  return {
    nx, nu, net, ids, diodes,
    stateIndex: m0.stateOf,
    inputs,
    settle,
    advance,
    configFor,
    /* Read anything, at any state, under a given conduction state. */
    read(kind, id, cond, x, u) {
      return readAt(probe(configFor(cond, x), kind, id), x, u);
    },
    branch: (id) => byId.get(id),
  };
}
