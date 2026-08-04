/* Put the pieces together: a topology and an operating point in, a converged
   switching period out.

   This is the seam the rest of the app sees. Everything below it — the
   netlist, the MNA compilation, the event-located stepping, the convergence
   loop — is machinery; what comes back is one period, sampled, in the same
   shape the closed-form model has always produced. */
import { makeSolver, converge, sample, traceView } from "./limitcycle.js";
import { pwm1, pwmComplementary, passive, combine, shift } from "./modulator.js";
import { SIM } from "../topologies/sim/pilot.js";
import { settle, isPerturbation, periodAt, displaySchedule } from "./transient.js";

/* Build the gate schedule a circuit asked for, in period-normalised time.

   `d` on a part overrides the duty the design published. Most converters run
   every commanded switch from one duty and inherit it; a four-switch
   buck-boost does not — its buck leg and its boost leg carry different ones,
   and passing the same D to both describes a converter that does not exist.

   `phase` starts a part later in the period, which is what interleaving is. */
function modulatorFor(g, D, period) {
  if (!g || g.kind === "passive") return passive;
  const d = g.d !== undefined ? g.d : D;
  let m;
  if (g.kind === "pwm1") m = pwm1(g.sw, d);
  else if (g.kind === "complementary") m = pwmComplementary(g.hi, g.lo, d, (g.td || 0) / period);
  else if (g.kind === "combine") m = combine(...g.parts.map((p) => modulatorFor(p, d, period)));
  else throw new Error("unknown gate schedule " + g.kind);
  return g.phase ? shift(m, g.phase) : m;
}

export function hasSim(topo) {
  return !!SIM[topo.id];
}

/* Place a circuit's seed values into the state vector by branch name, so a
   netlist never has to know what order the states ended up in. */
function seedState(S, seed) {
  const x = new Float64Array(S.nx);
  if (!seed) return x;
  for (const [id, v] of Object.entries(seed)) {
    const k = S.stateIndex.get(id);
    if (k !== undefined && Number.isFinite(v)) x[k] = v;
  }
  return x;
}

/* Run a topology to steady state.

   `from` optionally seeds the state vector, which is what makes a knob
   change a perturbation of a running converter rather than a fresh start. */
export function prepare(topo, spec, res) {
  const make = SIM[topo.id];
  if (!make || !res || res.infeasible || !res.sim) return null;
  const circuit = make(spec, res);
  const period = 1 / (spec.fsw * 1e3);
  const S = makeSolver(circuit.branches, { period, isolated: circuit.isolated });
  const D = res.wave && res.wave.D !== undefined ? res.wave.D : 0.5;
  const mod = modulatorFor(circuit.gates, D, period);
  return { S, circuit, period, D, mod, u: S.inputs({}) };
}

export function runSteady(topo, spec, res, opts = {}) {
  const P = prepare(topo, spec, res);
  if (!P) return null;
  const { S, circuit, period, D, mod, u } = P;

  /* Where to start integrating from.

     A converter started from a cold zero state has to charge its output
     capacitor through its own control loop before it reaches the operating
     point, and for a boost that is thousands of switching periods — real
     physics, and exactly what the transient view is for, but a waste of time
     when all that is wanted is the steady cycle. Seeding the states at the
     design's own operating point lands within a few periods of the answer,
     and convergence still decides what the answer is. */
  const x0 = opts.from && opts.from.length === S.nx
    ? opts.from
    : seedState(S, circuit.seed);
  const conv = converge(S, x0, u, mod, {
    nSteps: opts.nSteps || 512,
    maxPeriods: opts.maxPeriods || 4000,
    tol: opts.tol || 1e-7,
    /* What a knob turn can afford. A circuit too large to solve inside it
       reports the best it reached and the page draws the closed form,
       which is a slower answer refused rather than a wrong one given. */
    deadline: opts.deadline !== undefined ? opts.deadline : 900,
  });

  const sam = sample(S, conv.x, u, mod, { nSteps: opts.nSteps || 512, probes: circuit.probes });

  const views = {};
  for (const name of Object.keys(circuit.probes)) {
    views[name] = traceView(sam.u, sam.traces[name]);
  }
  /* How much of the period no device conducts at all.

     This is discontinuous conduction, stated the way the solver actually
     knows it: the rectifier's current reached zero, it stopped conducting,
     and the next switch turn-on has not arrived yet. Measuring it from the
     current waveform instead — looking for a flat stretch at zero — gets the
     answer wrong for a good reason, because a real converter in DCM does not
     sit flat. Once the rectifier opens, the inductor is left facing the
     switch node's own capacitance and the two ring together. That ringing is
     the most recognisable thing about a discontinuous waveform, and a test
     that expects a straight line would call it continuous conduction. */
  let idle = 0;
  for (let k = 1; k < sam.u.length; k++) {
    const c = sam.condAt[k];
    let any = false;
    for (const id of S.ids) if (c[id]) { any = true; break; }
    if (!any) idle += sam.u[k] - sam.u[k - 1];
  }

  return {
    solver: S, circuit, mod, u, period, D,
    x: conv.x, periods: conv.periods, residual: conv.residual,
    u_grid: sam.u, events: sam.events, traces: sam.traces, views,
    condAt: sam.condAt, idle,
    plot: circuit.plot,
  };
}

/* Perturb a running converter and watch it settle.

   `from` is the state a previous run left the circuit in. The new parameters
   are applied to it rather than to a fresh start, which is the difference
   between simulating an event and simulating two unrelated operating points.

   Returns null where the change is not a perturbation at all — a different
   inductor is a different converter, not a converter that has been disturbed
   — and null where it settles immediately, because a transient nobody can
   see is not one worth drawing. */
export function runTransient(topo, spec, res, fromRun, opts = {}) {
  const P = prepare(topo, spec, res);
  if (!P || !fromRun || !fromRun.x) return null;
  const { S, circuit, period, D, mod, u } = P;
  if (S.nx !== fromRun.x.length) return null;
  if (!isPerturbation(fromRun.circuit.branches, circuit.branches)) return null;

  /* The settle budget, measured rather than guessed.

     A boost recovering from a load step takes about 1,160 periods to come
     within 1e-5 of its new operating point — its output time constant is
     R·C and there is no way around that. At 96 sub-steps a period that
     costs under 100 ms, which is inside a knob turn; the tighter 1e-6 runs
     past 1,200 periods and lands in the same place to four figures. The
     step count only has to resolve the envelope, because every period the
     reader actually sees is re-solved at full resolution afterwards. */
  const st = settle(S, fromRun.x, u, mod, {
    nSteps: opts.nSteps || 96,
    maxPeriods: opts.maxPeriods || 4000,
    tol: opts.tol || 1e-5,
    probes: circuit.probes,
    iProbe: circuit.plot || "iL",
    vProbe: "vout",
  });

  /* Nothing to show: the operating point barely moved, or it was already
     there. Falling through to a plain steady run is the honest response. */
  const swing = st.env.reduce((m, e) => Math.max(m, Math.abs(e.vMean - st.env[st.env.length - 1].vMean)), 0);
  const ref = Math.max(Math.abs(st.env[st.env.length - 1].vMean), 1e-9);
  if (st.periods < 3 || swing / ref < 2e-3) return null;

  const schedule = displaySchedule(st.periods);
  const cache = new Map();
  return {
    kind: "transient",
    periods: st.periods, settled: st.settled, env: st.env, schedule,
    period, D, solver: S, circuit, mod, u,
    xEnd: st.states[st.states.length - 1],
    /* One full-resolution period, re-solved from its own recorded state and
       memoised — the reader steps back and forth across a settle, and
       re-solving the same period each time it is revisited would make
       scrubbing feel like work. */
    at(i) {
      const k = Math.max(0, Math.min(schedule.length - 1, i | 0));
      if (!cache.has(k)) {
        cache.set(k, periodAt(S, st.states[schedule[k]], u, mod, circuit, opts.viewSteps || 512));
      }
      return cache.get(k);
    },
  };
}

/* Mean of a trace over the period, by the same trapezoidal rule the charge
   integral uses — so "the average current" means one thing here. */
export function meanOf(view) {
  return view.qTot;
}

/* Peak-to-peak, which for an inductor current is ΔI. */
export function rippleOf(view) {
  return view.iMax - view.iMin;
}
