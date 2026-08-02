/* One way in, whether or not a topology has a circuit yet.

   `engineFor` always returns something that answers the questions the
   drawings ask — the same questions buildCycle has always answered. A
   topology with a netlist gets its current from the simulator; one without
   gets exactly what it got before. That is the point of the seam: converting
   the catalogue is a long job, and nothing should be degraded while it
   happens.

   What the simulator currently supplies is the CURRENT — the plotted trace
   and the conducting-path trace that drives the dashes, arrows and polarity
   marks. The capacitor panes, the switch-node levels and the flux integral
   still come from the closed-form model, which has its own assertions
   (check-cap, check-ripple) and no reason to be disturbed yet. Where the two
   describe the same thing they must not disagree, so both are taken from one
   place: the simulated current, or neither. */
import { buildCycle, buildCap, lookups } from "../cycle.js";
import { FLOW } from "../topologies/index.js";
import { runSteady, hasSim } from "./run.js";

/* Everything a spec change can alter, as one string — so the engine reruns
   when the operating point moves and not when React re-renders. */
export const engineKey = (topo, spec) => {
  if (!topo || !spec) return "none";
  const ks = Object.keys(spec).sort();
  return topo.id + "|" + ks.map((k) => k + "=" + spec[k]).join(",");
};

/* The conducting current, from the devices themselves.

   Only one path conducts at a time, so the magnitudes add to the current
   actually flowing through the circuit at that instant — the primary while
   the switch is on, the secondary once the rectifier takes over. This is
   what the dashes ride, and taking it from the devices means it cannot
   disagree with which device the figure is showing as conducting. */
function flowTrace(run) {
  const names = Object.keys(run.traces).filter((n) => /^i[QD]/.test(n));
  if (!names.length) return null;
  const us = run.u_grid;
  const n = us.length;
  const out = new Array(n).fill(0);
  for (const nm of names) {
    const tr = run.traces[nm];
    for (let k = 0; k < n; k++) out[k] += Math.abs(tr[k]);
  }

  /* Clip the turn-on spike out of the CONDUCTION story.

     A switch closing onto its own output capacitance passes an enormous
     current for C_oss·R_DS(on) — a picosecond or so, kiloamps, and entirely
     real: it is where the ½C_oss·V² goes. But it is displacement current
     emptying a capacitor, not the current flowing round the power loop, and
     letting it into this trace wrecks everything downstream that is scaled
     by a peak. The dashes are drawn at |i|/i_peak, so a 1,500 A spike
     against a 3 A ripple makes the whole conducting path invisible; the
     simplification tolerance is a fraction of the range, so the same spike
     discards the ripple as noise; and the live readout reports kiloamps
     flowing through a converter carrying ten.

     So: a time-weighted quantile, not a maximum. Anything above it is held
     at it. The spike is still in the probe traces, where it belongs and
     where the loss figures can see it — this is only about what the flow
     animation is scaled against. */
  const order = out.map((v, k) => [v, k]).sort((a, b) => a[0] - b[0]);
  let acc = 0, cap = out[0];
  const total = us[n - 1] - us[0] || 1;
  for (const [v, k] of order) {
    const w = (k > 0 ? us[k] - us[k - 1] : 0) + (k < n - 1 ? us[k + 1] - us[k] : 0);
    acc += w / 2;
    cap = v;
    if (acc / total > 0.995) break;
  }
  return out.map((v) => Math.min(v, cap));
}

/* Thin a sampled trace down to the points that carry its shape.

   The solver takes very short steps just after a switching edge, because
   that is where the fast transients live, and most of those samples land on
   top of each other once the transient has passed — sixteen hundred points
   to draw a triangle with two corners in it. Douglas–Peucker keeps whatever
   is needed to stay within a tolerance of the original and discards the
   rest, so the corners and the ringing survive and the redundancy does not.

   The tolerance is a thousandth of the trace's own range, which is far finer
   than the plot can express: this is removing points that were drawn on top
   of one another, not smoothing anything. */
function thin(us, vals, tol) {
  const n = us.length;
  if (n < 3) return { us, vals };
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const ua = us[a], va = vals[a], ub = us[b], vb = vals[b];
    const du = ub - ua;
    let worst = -1, at = -1;
    for (let k = a + 1; k < b; k++) {
      const t = du > 1e-15 ? (us[k] - ua) / du : 0;
      const d = Math.abs(vals[k] - (va + (vb - va) * t));
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tol && at > a) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const ou = [], ov = [];
  for (let k = 0; k < n; k++) if (keep[k]) { ou.push(us[k]); ov.push(vals[k]); }
  return { us: ou, vals: ov };
}

function viewFrom(us, vals) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const t = thin(us, vals, Math.max((hi - lo) * 1e-3, 1e-12));
  const pts = t.us.map((u, i) => ({ u, i: t.vals[i] }));
  const L = lookups(pts);
  return { pts, L, lo, hi };
}

/* Overlay the simulated current onto the closed-form cycle view.

   Deliberately an overlay rather than a replacement: everything the
   simulator does not yet compute keeps working exactly as it did, and the
   keys it does compute are the ones the reader is looking at. */
export function simView(base, run) {
  const iL = viewFrom(run.u_grid, run.traces[run.plot] || run.traces.iL);
  const fl = flowTrace(run);
  const flow = fl ? viewFrom(run.u_grid, fl) : iL;
  const flowPk = Math.max(Math.abs(flow.hi), Math.abs(flow.lo));

  /* The capacitor, rebuilt from the current that is actually drawn.

     A buck-family output capacitor sees i_L − I_out, so its pane is a
     restatement of the trace above it — and it was being restated from the
     closed-form ramp while the trace came from the simulator. With a linear
     core the two agreed closely enough that nothing showed; with a
     saturating one they do not, and the figure would have carried a bent
     inductor current above a capacitor ripple computed from a straight one.

     The model is unchanged. It is the same buildCap, with its charge
     balance, its ESR term and its exact quadratics — handed the simulated
     polyline instead of the ideal one. A pulse-fed output still comes from
     the design's own rectifier currents, because the capacitor there is not
     fed by the plotted winding at all. */
  let cap = base.cap;
  if (cap && cap.kind !== "boost" && run.plot === "iL") {
    /* The built capacitor carries the same field names its own spec used —
       C, Io, f_sw, ESR, phases, sub-intervals — and deliberately does not
       carry iavg/dI, which is what makes buildCap read the polyline it is
       given rather than reconstructing a ramp from scalars. */
    try {
      /* The load current has to be the one the winding actually delivers,
         not the one on the nameplate. A capacitor in steady state carries no
         net charge over a period, so i_C = i_L − I_out only balances if
         I_out is the mean of i_L — and the simulated mean sits a little
         below the specified load, because the converter has losses. Handing
         over the nameplate figure instead leaves a DC offset in the
         capacitor current, which buildCap dutifully corrects and confesses
         as a charge error. */
      const rebuilt = buildCap(iL.pts, base.D, { ...cap, Io: iL.L.qTot }, cap.pulses || 1);
      if (rebuilt) cap = rebuilt;
    } catch { /* keep the closed-form capacitor rather than losing the pane */ }
  }

  return {
    ...base,
    cap,
    /* the plotted current */
    pts: iL.pts,
    iAt: iL.L.at,
    slopeAt: iL.L.slope,
    qAt: iL.L.qAt,
    qTot: iL.L.qTot,
    iMin: iL.lo, iMax: iL.hi,
    iValley: iL.lo, iPeak: iL.hi,
    /* the conducting path the schematic animates */
    flowPts: flow.pts,
    flowAt: flow.L.at,
    qFlowAt: flow.L.qAt,
    flowTot: flow.L.qTot,
    flowPk: flowPk > 1e-12 ? flowPk : 1,
    /* what the simulator knows that the closed form never did */
    sim: {
      /* A period lifted out of a transient has no convergence history of its
         own — it was reached by being integrated to, not by being solved
         for. Defaulted rather than left undefined so every consumer can read
         the same shape whichever kind of period it was handed. */
      periods: run.periods === undefined ? 0 : run.periods,
      residual: run.residual === undefined ? 0 : run.residual,
      idle: run.idle,
      events: run.events,
      traces: run.traces,
      u: run.u_grid,
      probe: (name) => run.traces[name] || null,
    },
    /* Discontinuous conduction, from the circuit rather than from a test
       applied to a spec: an interval where nothing conducts. */
    mode: run.idle > 0.02 ? "dcm" : base.mode,
  };
}

/* One engine per operating point, shared by everyone who asks for it.

   Running a converter to steady state costs tens of milliseconds — nothing
   per knob turn, but the figure and the results panel both want the answer
   and neither should pay for it twice. The key has to carry the COMPONENTS
   as well as the inputs: a load stepped to 2× and a load edited to 2× arrive
   with identical specs and completely different inductors, because editing
   the load re-sizes the magnetics and stepping it does not. */
const CACHE = new Map();
const CACHE_MAX = 8;

const cacheKey = (topo, spec, res) => engineKey(topo, spec)
  + "|" + (res && res.sim ? `${res.sim.L}:${res.sim.C}:${res.sim.n || ""}` : "");

export function engineFor(topo, spec, res) {
  const F = FLOW[topo && topo.id];
  const wv = res && res.wave ? res.wave : null;
  const closed = () => buildCycle(wv, F && F.iShape);

  if (!hasSim(topo) || !res || res.infeasible || !res.sim || !wv) {
    return { kind: "closed", cycle: closed, run: null };
  }
  const ck = cacheKey(topo, spec, res);
  const hit = CACHE.get(ck);
  if (hit) return hit;
  let run = null;
  try { run = runSteady(topo, spec, res); } catch { run = null; }
  /* A circuit that did not converge is not a better answer than a closed
     form that did. Falling back silently is right here: the reader is owed a
     figure, and the honest signal is the absent "simulated" mark rather than
     an empty pane. */
  /* 1e-4 is a hundredth of a per cent of change from one period to the next,
     which is far below anything a drawn waveform can express. The looser
     bound exists because a saturating winding is piecewise linear, so its
     residual bottoms out at the width of a bucket rather than at zero. */
  if (!run || !(run.residual < 1e-4)) {
    return { kind: "closed", cycle: closed, run: null };
  }
  /* The cycle is built once and kept: several surfaces read it per frame,
     and rebuilding a view is wasted work even though it is cheap. */
  let view = null;
  const engine = {
    kind: "sim", run,
    cycle: () => (view || (view = simView(closed(), run))),
  };
  CACHE.set(ck, engine);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return engine;
}

/* What the simulation can tell the results panel that the design equations
   cannot tell themselves.

   Right now that is one thing, and it is worth saying plainly: whether the
   output capacitor actually meets the ripple budget it was sized against.
   The sizing formula uses the ideal ripple current; the real one is larger,
   by the catch diode's drop steepening the discharge and by a core that
   softens as it loads. A part chosen for 30 mV can deliver 37. */
export function simFacts(topo, spec, res) {
  const e = engineFor(topo, spec, res);
  if (e.kind !== "sim") return null;
  const M = e.cycle();
  const cap = M.cap;
  if (!cap || !Number.isFinite(cap.capPP) || !Number.isFinite(spec.dvout)) return null;
  const budget = spec.dvout * 1e-3;
  return {
    charge: cap.capPP,        /* ripple from the charge alone */
    total: cap.vPP,           /* and with this capacitor's ESR */
    budget,
    over: cap.capPP > budget * 1.05,
    ratio: budget > 0 ? cap.capPP / budget : NaN,
    dI: M.iMax - M.iMin,
    dIideal: Number.isFinite(res.wave && res.wave.dI) ? res.wave.dI : NaN,
  };
}
