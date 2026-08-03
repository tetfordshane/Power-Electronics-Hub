/* What happens between two steady states.

   A knob change is a physical event, not a re-target. The converter that was
   running does not vanish and reappear at the new operating point: its
   inductor is carrying a current and its capacitor is holding a charge, and
   those are what it starts the next period from. Handing the new parameters
   to the old state and integrating forward is the whole idea, and everything
   interesting — the undershoot when the load steps up, the several hundred
   periods a boost takes to recover, the fact that the recovery is slow
   because the output capacitor is large — falls out of it.

   Two resolutions, deliberately:

   The settle is integrated coarsely. It can run for a thousand periods and
   nobody is reading a single one of them; what is wanted is the envelope,
   and a shorter step resolves that perfectly well while keeping the whole
   computation inside a knob turn.

   The periods actually DISPLAYED are re-solved at full resolution from their
   own recorded state. So the figure never shows a coarse waveform: it shows
   the same quality of trace as steady state, at a moment picked out of the
   settle. That split is what makes this affordable — a thousand periods of
   envelope costs one pass, and only the two dozen the reader will see are
   computed properly. */
import { converge, sample, traceView, runPeriod } from "./limitcycle.js";

/* How many periods the figure can step through. Log-spaced, so the fast
   opening of a transient gets most of them and the long tail gets a few —
   which is where the interesting part is, and how a settling curve is read
   anyway. */
const DISPLAY_MAX = 16;

function displaySchedule(n) {
  if (n <= DISPLAY_MAX) return Array.from({ length: n }, (_, i) => i);
  const out = new Set([0]);
  for (let k = 1; k < DISPLAY_MAX; k++) {
    const t = k / (DISPLAY_MAX - 1);
    out.add(Math.min(n - 1, Math.round((Math.pow(n, t) - 1) / (n - 1) * (n - 1))));
  }
  out.add(n - 1);
  return [...out].sort((a, b) => a - b);
}

/* Integrate the settle, recording one summary per period.

   `probe` names the trace the envelope is drawn from — the plotted current —
   and `vprobe` the output voltage. Both are read at every sub-step, which is
   cheap next to the step itself. */
export function settle(S, x0, u, mod, opts = {}) {
  const {
    nSteps = 128, maxPeriods = 1200, tol = 1e-6,
    iProbe = "iL", vProbe = "vout", probes = {},
  } = opts;

  const iSpec = probes[iProbe], vSpec = probes[vProbe];
  let x = x0;
  let cond = S.settle(mod.at(0), x, u);
  const states = [x];
  const env = [];
  const scale = new Float64Array(S.nx).fill(1);
  let settled = -1;

  for (let p = 0; p < maxPeriods; p++) {
    let iMin = Infinity, iMax = -Infinity, vSum = 0, vN = 0, vMin = Infinity, vMax = -Infinity;
    const before = x;
    const r = runPeriod(S, x, u, mod, cond, nSteps, (t, xs, cs) => {
      if (iSpec) {
        const v = S.read(iSpec.kind, iSpec.id, cs, xs, u);
        if (v < iMin) iMin = v;
        if (v > iMax) iMax = v;
      }
      if (vSpec) {
        const v = S.read(vSpec.kind, vSpec.id, cs, xs, u);
        vSum += v; vN++;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
    });
    x = r.x; cond = r.cond;
    states.push(x);
    env.push({
      iMin: iMin === Infinity ? 0 : iMin,
      iMax: iMax === -Infinity ? 0 : iMax,
      vMean: vN ? vSum / vN : 0,
      vMin: vMin === Infinity ? 0 : vMin,
      vMax: vMax === -Infinity ? 0 : vMax,
    });

    let num = 0;
    for (let i = 0; i < S.nx; i++) {
      scale[i] = Math.max(scale[i], Math.abs(x[i]));
      const d = (x[i] - before[i]) / Math.max(scale[i], 1e-9);
      num += d * d;
    }
    if (Math.sqrt(num / Math.max(S.nx, 1)) < tol) { settled = p + 1; break; }
  }

  return { states, env, periods: env.length, settled: settled > 0 ? settled : env.length };
}

/* Is this actually a perturbation of the same converter?

   Only where the energy-storage elements are unchanged. Turning the load
   down perturbs a running circuit; changing the switching frequency re-sizes
   the inductor and the capacitor, which is not something that happens to a
   converter — it is a different converter, and animating a "settle" between
   two of them would be inventing an event that has no physical meaning. */
export function isPerturbation(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i];
    if (p.id !== q.id || p.type !== q.type) return false;
    if (p.type === "L" || p.type === "C" || p.type === "XF") {
      const va = p.type === "XF" ? p.ratio : p.value;
      const vb = q.type === "XF" ? q.ratio : q.value;
      if (!(Math.abs(va - vb) <= Math.abs(vb) * 1e-12)) return false;
    }
  }
  return true;
}

/* Re-solve one period from a recorded state, at full resolution, and dress
   it as the same cycle view every drawing surface reads. */
export function periodAt(S, x, u, mod, circuit, nSteps) {
  const sam = sample(S, x, u, mod, { nSteps, probes: circuit.probes });
  const views = {};
  for (const name of Object.keys(circuit.probes)) {
    views[name] = traceView(sam.u, sam.traces[name]);
  }
  let idle = 0;
  for (let k = 1; k < sam.u.length; k++) {
    let any = false;
    for (const id of S.ids) if (sam.condAt[k][id]) { any = true; break; }
    if (!any) idle += sam.u[k] - sam.u[k - 1];
  }
  return {
    u_grid: sam.u, events: sam.events, traces: sam.traces, views,
    condAt: sam.condAt, idle, plot: circuit.plot,
  };
}

export { displaySchedule, converge };
