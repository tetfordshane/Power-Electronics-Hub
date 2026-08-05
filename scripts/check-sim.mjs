/* Does every simulated topology simulate the converter it claims to be?

   The existing sim tests are a hand-kept registry: `sim-steady.test.mjs`
   names eight topologies and what each one's ΔI refers to, and a conversion
   that nobody adds to that list is checked by nothing at all. This walks
   `SIM` itself, so a netlist cannot enter the app without being asked these
   questions, and it asks them at every operating point `casesFor` pins rather
   than only at the defaults.

   What it is really for is the failure that has cost every hour lost to this
   engine so far, which is NOT a crash. A miswired netlist converges. It
   settles, it regulates, and it reports a plausible wrong number — a flyback
   secondary wired in phase is a forward converter and reads about 20 % high;
   a switch returned to the wrong node produces a converter that solves in
   seven periods to a residual of 4e-10 and delivers zero volts. Every
   invariant the suite had passes on that last one: charge balance holds
   trivially at zero, no diode conducts backwards at zero, everything is
   finite at zero.

   So the questions here are deliberately not invariants. They are: does power
   arrive, does it arrive where the design said it would, and does it leave in
   the amount that went in.

       node scripts/check-sim.mjs                                          */
import { TOPOS } from "../src/topologies/index.js";
import { SIM } from "../src/topologies/sim/pilot.js";
import { runSteady } from "../src/engine/run.js";
import { casesFor } from "./lib/cases.mjs";
import { defaultSpec, has } from "./lib/spec.mjs";

let fails = 0;
const fail = (id, msg) => { fails++; console.error(`  FAIL  ${id.padEnd(12)} ${msg}`); };
const notes = [];

/* The corner every closed-form comparison is made at. Parasitics are what
   make a real circuit disagree with the equation that sized it, so a test
   that wants to compare the two has to turn them off — and apply only the
   fields the topology actually has, or a corner that silently failed to apply
   would be recorded as a passing case that measured nothing.

   Mirrors IDEAL in test/sim-steady.test.mjs. */
const IDEAL = { vf: 0, rds: 0.001, dcr: 0, esr: 0, coss: 1, qrr: 0, td: 0, eff: 1, lsag: 0 };
const idealise = (topo, spec) => {
  const o = { ...spec };
  for (const [k, v] of Object.entries(IDEAL)) if (has(topo, k)) o[k] = v;
  return o;
};

/* The mean of a probe view over the period. `qTot` is exactly that. */
const meanOf = (v) => (v && Number.isFinite(v.qTot) ? v.qTot : NaN);

/* Generous on purpose. A wall clock in a gate is machine-dependent, so this
   is set to catch a catastrophic regression rather than to police the
   milliseconds: the slowest thing here today is a SEPIC at low line, measured
   at 601 ms, because five states means seven full period runs per Newton
   iteration and its Jacobian is taken by finite differences. When the period
   map's Jacobian is accumulated from the step matrices instead — which are
   already computed — this drops by most of an order of magnitude and the
   bound comes down with it. */
const BUDGET_MS = 1200;

for (const id of Object.keys(SIM)) {
  const topo = TOPOS.find((t) => t.id === id);
  if (!topo) { fail(id, "SIM names a topology that does not exist"); continue; }

  /* ---- the hand-kept registry must not fall behind the engine ---- */
  if (!has(topo, "fsw")) {
    fail(id, "is in SIM but has no f_sw field, so run.js cannot form a period");
  }

  for (const { name, spec: raw } of casesFor(topo)) {
    const where = `[${name}]`;
    let res;
    try { res = topo.design(raw); } catch (e) { fail(id, `${where} design() threw: ${e.message}`); continue; }
    if (!res || res.infeasible) continue;      /* nothing to simulate, and that is fine */
    if (!res.sim) { fail(id, `${where} publishes no res.sim, so the engine cannot bind values`); continue; }
    if (!res.wave) { fail(id, `${where} publishes no res.wave, so the adapter falls back to closed form`); continue; }

    /* ---- 1. it runs at all, and says why when it does not ---- */
    let run = null, t0 = Date.now();
    try {
      run = runSteady(topo, raw, res);
    } catch (e) {
      fail(id, `${where} ${e.message}`);
      continue;
    }
    const ms = Date.now() - t0;

    /* ---- 2. it converged ---- *
       The page's own operating point must solve: that is the figure a reader
       opens on, and a topology that cannot manage it does not belong in SIM.
       The corners are allowed to give up, because some of them are genuinely
       harder than a knob turn can afford — a twenty-four-phase converter's
       current-sharing mode settles slowly no matter how it is solved — and
       giving up there is answered by the closed form and a page that says so.
       It is reported, so a corner quietly falling out is still visible. */
    if (!(run.residual < 1e-4)) {
      if (name === "defaults") {
        fail(id, `${where} residual ${run.residual.toExponential(2)} — the page's own `
          + "operating point must solve");
      } else {
        notes.push(`${id} [${name}] did not converge (residual `
          + `${run.residual.toExponential(2)}) — this corner draws the closed form`);
      }
      continue;
    }
    if (ms > BUDGET_MS) {
      fail(id, `${where} took ${ms} ms, past the ${BUDGET_MS} ms a knob turn can afford`);
    }

    /* ---- 3. the probe contract ---- */
    for (const need of ["vout", "iC"]) {
      if (!run.views[need]) fail(id, `${where} declares no "${need}" probe, which the sim tests require`);
    }
    if (!run.views[run.plot]) fail(id, `${where} plot names "${run.plot}", which is not a probe`);
    for (const [nm, v] of Object.entries(run.views)) {
      if (!v || !v.pts || !v.pts.length) fail(id, `${where} probe "${nm}" produced nothing`);
    }
    for (const [nm, tr] of Object.entries(run.traces)) {
      if (![...tr].every(Number.isFinite)) fail(id, `${where} probe "${nm}" carries a non-finite value`);
    }

    /* ---- 4. IT ACTUALLY CONVERTS ---- *
       The check the invariants could not make. A converter that delivers
       nothing satisfies every balance in the suite, because zero is balanced. */
    const vout = meanOf(run.views.vout);
    if (!Number.isFinite(vout)) { fail(id, `${where} has no mean output voltage`); continue; }
    const target = Number.isFinite(raw.vout) ? raw.vout : null;
    if (target !== null && Math.abs(vout) < 0.1 * Math.abs(target)) {
      fail(id, `${where} delivers ${vout.toFixed(3)} V against a design output of ${target} V — `
        + "the circuit converged, but it is not converting");
    }
  }

  /* ---- 5. at the idealised corner, it agrees with the design that sized it ---- *
     The design function is the independent second opinion here, and a strong
     one: it chose the duty to reach a particular output. A circuit wired
     differently — a flyback secondary in phase, a switch returned to the
     wrong node — runs at that same duty and lands somewhere else. No
     hand-written textbook formula to drift out of date, because the formula
     already exists, in the design. */
  const rawI = idealise(topo, defaultSpec(topo));
  let resI = null;
  try { resI = topo.design(rawI); } catch { resI = null; }
  if (resI && !resI.infeasible && resI.sim && resI.wave) {
    let runI = null;
    try { runI = runSteady(topo, rawI, resI); } catch (e) { fail(id, `[ideal] ${e.message}`); }
    if (runI && runI.residual < 1e-4) {
      const vout = meanOf(runI.views.vout);
      const target = Number.isFinite(rawI.vout) ? rawI.vout : null;
      if (target !== null && Math.abs(Math.abs(vout) - Math.abs(target)) > 0.05 * Math.abs(target)) {
        fail(id, `[ideal] delivers ${vout.toFixed(3)} V where the design says ${target} V — `
          + "with the parasitics off these must agree, so the circuit is not the one "
          + "the equations describe");
      }

      /* ---- 6. power balance ---- *
         With the parasitics off, what goes in comes out. This catches the
         faults a voltage check can miss: a source feeding a path that should
         not exist, or an output held up by something other than the
         converter. */
      const iin = meanOf(runI.views.iin);
      const vin = rawI.vinNom !== undefined ? rawI.vinNom : rawI.vinMin;
      if (Number.isFinite(iin) && Number.isFinite(vin) && Number.isFinite(vout)) {
        const pin = Math.abs(vin * iin);
        const pout = Math.abs(vout) * Math.abs(vout) / loadOhms(topo, rawI, resI);
        if (pin > 1e-6 && Math.abs(pin - pout) > 0.08 * pin) {
          fail(id, `[ideal] ${pin.toFixed(2)} W in against ${pout.toFixed(2)} W out — `
            + "idealised, these must match; energy is arriving or leaving somewhere unmodelled");
        }
      }

      /* ---- 7. the dot convention is what the netlist says it is ---- *
         A transformer's phase is expressed only as the ORDER of two node
         names, and getting it wrong yields a different converter that still
         works. So the claim is checked against the currents: an anti-phase
         secondary rectifies during the primary's OFF time, an in-phase one
         while the primary is being driven.

         This needs a period with two distinguishable halves, and only a
         single-ended converter has one — the primary is driven for D and idle
         for the rest, and a secondary wired the wrong way round rectifies in
         the other interval. A bipolar drive has no such asymmetry: a
         push-pull's two half-cycles are mirror images, so reversing its whole
         secondary maps the circuit onto itself and there is no error left to
         detect. What can still go wrong on those — one winding of a composed
         centre tap disagreeing with its neighbours — is caught structurally,
         in netlist.validate(), where the claim is written.

         `rectifier` names the probe whose timing is the evidence. It defaults
         to `iD`, which is what a converter with one rectifier calls it; a
         forward converter has two and only the forward one is evidence, since
         the freewheel diode conducts in whichever interval is left over
         whichever way the transformer is wound. */
      const circuit = SIM[id](rawI, resI);
      const xf = (circuit.branches || []).filter((b) => b.type === "XF");
      const rect = circuit.rectifier || "iD";
      const drive = (circuit.branches || []).filter((b) => b.type === "SW").map((b) => b.id);
      if (xf.length && drive.length && runI.views[rect] && runI.condAt) {
        const win = driveWindow(runI, drive);
        if (!win.single) {
          notes.push(`${id} drives its primary in ${win.runs} separate intervals, so the `
            + "period has no idle half to rectify in — its phase is held by the composition "
            + "check rather than by conduction timing");
        } else {
          const share = onShare(runI, drive, rect);
          if (Number.isFinite(share)) {
            const want = xf[0].phase;
            if (want === "opposing" && share > 0.15) {
              fail(id, `[ideal] XF declares phase "opposing" but ${(share * 100).toFixed(0)} % of `
                + `${rect}'s charge flows while the primary is driven — that is a forward converter`);
            }
            if (want === "aiding" && share < 0.85) {
              fail(id, `[ideal] XF declares phase "aiding" but only ${(share * 100).toFixed(0)} % `
                + `of ${rect}'s charge flows while the primary is driven`);
            }
          }
        }
      }
    }
  }
}

/* The load the design is actually driving, in ohms. */
function loadOhms(topo, spec, res) {
  if (Number.isFinite(res.pout) && res.pout > 0 && spec.vout) return (spec.vout * spec.vout) / res.pout;
  if (spec.vout && spec.iout) return Math.abs(spec.vout) / spec.iout;
  return NaN;
}

/* The fraction of a probe's absolute charge that flows while any of the named
   commanded switches is conducting. */
function onShare(run, swIds, probe) {
  const tr = run.traces[probe], us = run.u_grid;
  if (!tr || !us || !run.condAt) return NaN;
  let on = 0, all = 0;
  for (let k = 1; k < us.length; k++) {
    const du = us[k] - us[k - 1];
    if (!(du > 0)) continue;
    /* condAt is per sample, and limitcycle evaluates each probe under the
       state actually in force there — so the current and the conduction
       state at index k describe the same instant. */
    const mag = Math.abs(tr[k]) * du;
    all += mag;
    const c = run.condAt[k];
    if (c && swIds.some((s) => c[s])) on += mag;
  }
  return all > 0 ? on / all : NaN;
}

/* How the commanded switches divide the period: one driven interval, or
   several. A single-ended converter gives one run of "something is on"; a
   bridge or a push-pull gives two, half a period apart, and a leg held
   permanently closed gives one that covers everything. Only the first case
   leaves an idle interval for a miswound secondary to rectify in. */
function driveWindow(run, swIds) {
  const us = run.u_grid, cs = run.condAt;
  const on = us.map((_, k) => swIds.some((s) => cs[k] && cs[k][s]));
  let runs = 0;
  for (let k = 0; k < on.length; k++) if (on[k] && !on[k - 1]) runs++;
  /* The period wraps, so a run that starts at u = 0 continues one that ended
     at u = 1 rather than being a second interval. */
  if (runs > 1 && on[0] && on[on.length - 1]) runs--;
  let width = 0;
  for (let k = 1; k < us.length; k++) if (on[k]) width += us[k] - us[k - 1];
  return { runs, width, single: runs === 1 && width < 0.95 };
}

const simCount = Object.keys(SIM).length;
console.log(`check-sim: ${simCount} simulated topologies, `
  + `${TOPOS.length - simCount} closed-form`);
for (const n of notes) console.log(`  note: ${n}`);
console.log(fails ? `check-sim: ${fails} problems` : "check-sim: all clear");
process.exit(fails ? 1 : 0);
