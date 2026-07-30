/* Does the capacitor pane agree with the numbers the design already prints?

   That is the whole claim the feature makes. Each topology's design() sizes
   C_out from a closed form — ΔI/(8·f·C) for a continuously-fed output,
   I_out·D/(f·C) for a pulse-fed one — and prints the result in the Passives
   table. If the drawn ripple disagrees with it, one of the two is wrong and
   the figure is decorating the tables rather than explaining them.

   `src/cycle.js` is a plain module, so this imports it and checks the maths
   directly. No browser, no scraping.

   Usage: node scripts/check-cap.mjs                                        */
import { buildCycle } from "../src/cycle.js";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log(`  ok    ${what}`);
  else { console.log(`  FAIL  ${what}`); fails++; }
  return cond;
};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

/* ---------- buck-like: continuous output current ---------- */
console.log("\nbuck-like — output fed continuously by the inductor");
{
  const fsw = 5e5, Io = 10, dI = 2.7, C = 47e-6;
  const M = buildCycle({ D: 0.306, dI, iavg: Io, fsw,
    cap: { kind: "buck", C, esr: 0, Vdc: 3.3, Io, fsw } });
  const c = M.cap;
  ok(c, "a capacitor model was built");
  ok(rel(c.qErr, 0) < 1e-9, `charge balances over the period (qErr ${c.qErr.toExponential(1)})`);
  ok(Math.abs(c.vTot[0] - c.vTot[c.vTot.length - 1]) < 1e-15,
    "the trace closes on itself — no step at the loop seam");
  /* the closed form the design prints: ΔV = ΔI/(8·f·C) */
  const want = dI / (8 * fsw * C);
  ok(rel(c.vPP, want) < 0.01,
    `ripple ${(c.vPP * 1e3).toFixed(3)} mV matches ΔI/(8·f·C) = ${(want * 1e3).toFixed(3)} mV`);
}

/* ESR must add a step, and the total must exceed the capacitive part alone */
console.log("\nESR");
{
  const fsw = 5e5, Io = 10, dI = 2.7, C = 47e-6, esr = 3e-3;
  const base = buildCycle({ D: 0.306, dI, iavg: Io, fsw,
    cap: { kind: "buck", C, esr: 0, Vdc: 3.3, Io, fsw } }).cap;
  const with_ = buildCycle({ D: 0.306, dI, iavg: Io, fsw,
    cap: { kind: "buck", C, esr, Vdc: 3.3, Io, fsw } }).cap;
  ok(with_.vPP > base.vPP, `ESR raises the ripple: ${(base.vPP * 1e3).toFixed(2)} → ${(with_.vPP * 1e3).toFixed(2)} mV`);
  /* the ESR contribution across the whole swing is ΔI_C·ESR */
  let iLo = Infinity, iHi = -Infinity;
  for (const p of with_.iC) { if (p.i < iLo) iLo = p.i; if (p.i > iHi) iHi = p.i; }
  ok(rel((iHi - iLo) * esr, dI * esr) < 0.02,
    `ESR term spans ΔI·ESR = ${((iHi - iLo) * esr * 1e3).toFixed(3)} mV`);
}

/* ---------- boost-like: output fed in pulses ---------- */
console.log("\nboost-like — capacitor alone supplies the load while the switch is on");
{
  const fsw = 3e5, Io = 3, D = 0.5, C = 100e-6, IL = Io / (1 - D), dIn = 1.5;
  const M = buildCycle({ D, dI: dIn, iavg: IL, fsw,
    cap: { kind: "boost", C, esr: 0, Vdc: 24, Io, fsw,
      i0: IL + dIn / 2, i1: IL - dIn / 2 } });
  const c = M.cap;
  ok(rel(c.qErr, 0) < 1e-9, `charge balances (qErr ${c.qErr.toExponential(1)})`);
  ok(Math.abs(c.vTot[0] - c.vTot[c.vTot.length - 1]) < 1e-15, "closes on itself");
  const want = Io * D / (fsw * C);          /* the form boost's design prints */
  ok(rel(c.vPP, want) < 0.02,
    `ripple ${(c.vPP * 1e3).toFixed(2)} mV matches I_out·D/(f·C) = ${(want * 1e3).toFixed(2)} mV`);
  ok(c.vPP > dIn / (8 * fsw * C) * 3,
    "boost ripple is far worse than the buck form would predict — the point of the pane");
}

/* ---------- sub-cycled and interleaved ---------- */
console.log("\ntwo pulses per switching period (centre-tapped, half bridge)");
{
  const fsw = 1e5, Io = 12, dI = 3, C = 220e-6;
  const one = buildCycle({ D: 0.4, dI, iavg: Io, fsw,
    cap: { kind: "buck", C, esr: 0, Vdc: 12, Io, fsw, sub: 1 } }).cap;
  const two = buildCycle({ D: 0.4, dI, iavg: Io, fsw,
    cap: { kind: "buck", C, esr: 0, Vdc: 12, Io, fsw, sub: 2 } }).cap;
  ok(two.vPP < one.vPP,
    `ripple falls at twice the frequency: ${(one.vPP * 1e3).toFixed(3)} → ${(two.vPP * 1e3).toFixed(3)} mV`);
  /* Exactly half, not a quarter: ΔI is an input here, taken from the design,
     which already sizes the choke for the ripple it wants. Doubling the
     ripple frequency at a GIVEN ΔI halves the charge per pulse and so halves
     the voltage swing. It is the 4× intuition — "double the frequency, and
     ΔI halves too" — that does not apply, because ΔI is not derived here. */
  ok(rel(two.vPP, one.vPP / 2) < 0.02,
    "and falls by exactly half — the same ΔI over half the interval");
}
console.log("\ninterleaved phases");
{
  const fsw = 5e5, Io = 30, C = 100e-6;
  const mk = (n) => buildCycle({ D: 0.306, dI: 3, iavg: Io / n, fsw,
    cap: { kind: "buck", C, esr: 0, Vdc: 1.2, Io, fsw, n } }).cap;
  const a = mk(1), b = mk(3);
  ok(b.vPP < a.vPP, `three phases cancel ripple: ${(a.vPP * 1e3).toFixed(3)} → ${(b.vPP * 1e3).toFixed(3)} mV`);
}

/* ---------- the pane's own claim: ΔQ / C is the ripple ---------- */
console.log("\nΔQ / C equals the drawn ripple");
{
  const fsw = 5e5, Io = 10, dI = 2.7, C = 47e-6;
  const c = buildCycle({ D: 0.306, dI, iavg: Io, fsw,
    cap: { kind: "buck", C, esr: 0, Vdc: 3.3, Io, fsw } }).cap;
  /* the positive lobe of i_C, in coulombs */
  let q = 0;
  for (let k = 0; k < c.iC.length - 1; k++) {
    const a = c.iC[k], b = c.iC[k + 1];
    if (b.u <= a.u) continue;
    const du = (b.u - a.u) / fsw;
    if (a.i >= 0 && b.i >= 0) q += ((a.i + b.i) / 2) * du;
    else if (a.i >= 0 || b.i >= 0) {
      const t = a.i / (a.i - b.i);                 /* zero crossing */
      q += (a.i >= 0 ? (a.i / 2) * t : (b.i / 2) * (1 - t)) * du;
    }
  }
  ok(rel(q / C, c.vPP) < 0.01,
    `ΔQ/C = ${((q / C) * 1e3).toFixed(4)} mV against a drawn ripple of ${(c.vPP * 1e3).toFixed(4)} mV`);
}

/* ---------- the Bézier controls the pane draws with ---------- */
/* The ripple trace is drawn as one quadratic per segment. If the control
   points are even slightly off, the drawn peak is not the computed peak — and
   the peak is the only number on that pane anyone reads. So evaluate the
   Bézier and compare it against the closed-form voltage at the same instant,
   at several t per segment rather than only the midpoint the control was
   derived from. */
console.log("\nthe drawn curve is the computed curve");
{
  const fsw = 5e5, Io = 10, dI = 2.7, C = 47e-6;
  for (const esr of [0, 4e-3]) {
    const c = buildCycle({ D: 0.306, dI, iavg: Io, fsw,
      cap: { kind: "buck", C, esr, Vdc: 3.3, Io, fsw } }).cap;
    let worst = 0, curved = 0;
    for (let k = 0; k < c.iC.length - 1; k++) {
      const a = c.iC[k], b = c.iC[k + 1];
      if (b.u <= a.u) { ok(c.ctrl[k] === null, "a step segment carries no control point"); continue; }
      curved++;
      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        /* the Bézier, evaluated */
        const B = (1 - t) * (1 - t) * c.vTot[k] + 2 * t * (1 - t) * c.ctrl[k].v
          + t * t * c.vTot[k + 1];
        /* the closed form: charge integral plus the resistive term */
        const it = a.i + (b.i - a.i) * t, du = (b.u - a.u) * t;
        const V = c.vCap[k] + c.kq * ((a.i + it) / 2) * du + it * esr;
        worst = Math.max(worst, Math.abs(B - V));
      }
    }
    ok(curved > 0, `${curved} curved segments to check at ESR ${esr * 1e3} mΩ`);
    ok(worst < 1e-15, `Bézier matches the closed form to ${worst.toExponential(1)} V`);
  }
}

/* The charge-only swing must be the whole ripple when there is no ESR, and
   strictly less than it once there is — that split is what the pane claims. */
console.log("\nhow much of the ripple is ESR");
{
  const fsw = 5e5, Io = 10, dI = 2.7, C = 47e-6;
  const mk = (esr) => buildCycle({ D: 0.306, dI, iavg: Io, fsw,
    cap: { kind: "buck", C, esr, Vdc: 3.3, Io, fsw } }).cap;
  const a = mk(0), b = mk(4e-3);
  ok(rel(a.capPP, a.vPP) < 1e-12, "with no ESR the charge term is the entire ripple");
  ok(b.capPP < b.vPP && rel(b.capPP, a.capPP) < 1e-12,
    `ESR adds ${((b.vPP - b.capPP) * 1e3).toFixed(2)} mV on top of an unchanged ${(b.capPP * 1e3).toFixed(2)} mV charge term`);
  /* rms ripple current: for a triangle about zero it is ΔI/√12 */
  ok(rel(a.iCrms, dI / Math.sqrt(12)) < 0.01,
    `I_C(rms) = ${(a.iCrms * 1e3).toFixed(1)} mA matches ΔI/√12 = ${((dI / Math.sqrt(12)) * 1e3).toFixed(1)} mA`);
}

console.log(`\n${fails === 0 ? "the capacitor model agrees with the printed design" : fails + " FAILING"}`);
process.exit(fails ? 1 : 0);
