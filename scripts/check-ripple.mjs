/* Does every topology hand the capacitor pane a spec that makes sense?

   check-cap.mjs proves the MODEL is right by importing it directly. It cannot
   say anything about the thirty design functions that feed it — whether each
   one named the right family, the right rectifier current, the right number of
   interleaved phases. Those thirty specs are hand-derived from thirty
   different circuits, and a wrong one produces a perfectly smooth, perfectly
   plausible ripple trace that happens to belong to a different converter.

   The thing that catches all of them at once is charge balance. Over one
   period a capacitor must take in exactly the charge it gives back, and that
   is not something a wrong spec satisfies by accident: get the family wrong
   and the load current is subtracted over the wrong interval, get the
   rectifier current wrong and its average is not the load, get the phase
   count wrong and the sum is not the output. The model repairs the imbalance
   so the trace still closes — and records how large the repair was, as
   data-qerr. A spec that needed no repair is a spec that was consistent.

   So: walk every topology, and for each pane that exists check that it needed
   no correction, that the drawn ripple is a real positive number no larger
   than the ΔV the design sized C_out for, and that the trace closes on
   itself. Then check that the topologies WITHOUT a pane are the four known
   ones, so a pane cannot quietly disappear.

   Usage: node scripts/check-ripple.mjs        (needs the dev server up)     */
import puppeteer from "puppeteer";
import { bench } from "./lib/env.mjs";
import { readFileSync } from "fs";

/* Which topologies are expected to have a waveform figure but NO capacitor
   pane, and why. Everything not listed here must have one.

   Every design that publishes a `wave` spec still gets a capacitor pane —
   that has not changed and is what this file mostly exists to police. What
   changed is that the fourteen topologies which publish no `wave` at all now
   draw a BARE pane instead of nothing: their current comes from a shape the
   FLOW entry supplies, scaled to its own peak, because a resonant tank or a
   rectifier conduction pulse is not a ramp any design equation produced.

   A bare pane cannot carry a capacitor, and should not pretend to:

     - a shape has no amps behind it, so there is no charge to integrate;
     - the ones that DO have an output capacitor ripple at a frequency this
       figure does not cover. A boost PFC's bulk cap ripples at twice the
       LINE frequency, hundreds of switching periods wide; drawing it on a
       switching-period axis would be a different waveform entirely.

   So the list is exactly the bare-mode set. If a topology here ever gains a
   real `wave` spec, it must gain a `cap` spec with it and come off this list. */
const NO_PANE = [
  "chargepump", "llc", "dab", "pfcboost", "ilpfc", "totempole", "hbridge", "vsi3", "npc3",
  "halfwave", "bridgerect", "syncrect", "classe", "classepp", "classde",
];

const src = readFileSync(new URL("../src/PowerStage.jsx", import.meta.url), "utf8");
const ids = [...src.matchAll(/^\s*id: "([a-z0-9]+)", name: "/gm)].map((x) => x[1]);

let fails = 0;
const bad = (id, what) => { console.log(`  FAIL  ${id.padEnd(12)} ${what}`); fails++; };

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100 });

const rows = [];
for (const id of ids) {
  await page.goto(bench(id), { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 600));
  const got = await page.evaluate(() => {
    const w = document.querySelector('[data-fig="wave"]');
    if (!w) return { wave: false };
    const vc = w.querySelector('path[data-trace="vc"]');
    const ic = w.querySelector('path[data-trace="ic"]');
    /* the ΔV the design was sized for, straight off the input box */
    const dv = document.getElementById("f_dvout");
    return {
      wave: true, pane: !!vc,
      qerr: Number(w.getAttribute("data-qerr")),
      vpp: Number(w.getAttribute("data-vpp")),
      cappp: Number(w.getAttribute("data-cappp")),
      icrms: Number(w.getAttribute("data-icrms")),
      cval: Number(w.getAttribute("data-cval")),
      dvout: dv ? Number(dv.value) : null,
      dvc: vc ? vc.getAttribute("d") : null,
      dic: ic ? ic.getAttribute("d") : null,
    };
  });

  if (!got.wave) continue;                     /* no waveform figure at all */
  const expect = !NO_PANE.includes(id);
  if (got.pane !== expect) {
    bad(id, expect ? "expected a capacitor pane and found none"
      : "has a capacitor pane, but its output filter is double-pulse");
    continue;
  }
  if (!got.pane) { rows.push([id, "—", "no pane, as intended"]); continue; }

  /* 1. the spec balanced on its own */
  if (!(got.qerr < 1e-9)) bad(id, `charge did not balance: qErr = ${got.qerr.toExponential(2)}`);
  /* 2. the ripple is a real, positive, finite number */
  if (!(got.vpp > 0) || !Number.isFinite(got.vpp)) bad(id, `ripple is ${got.vpp}`);
  if (!(got.cappp > 0) || got.cappp > got.vpp * 1.0000001) {
    bad(id, `charge term ${got.cappp} is not a share of the total ${got.vpp}`);
  }
  if (!(got.icrms > 0)) bad(id, `I_C(rms) is ${got.icrms}`);
  /* 3. the CHARGE term is no larger than the budget C_out was sized against.
        Every one of these designs sizes C_out from the charge alone and then
        prints the ESR contribution as a separate line — deliberately, because
        the two are fixed by different properties of the same part. So the
        total ripple legitimately exceeds the budget once ESR is real; the
        charge term is what must not. Several designs also size C at a
        worst-case input corner and draw the nominal point, so the drawn value
        is often legitimately smaller. */
  if (got.dvout !== null) {
    const budget = got.dvout * 1e-3;
    if (got.cappp > budget * 1.05) {
      bad(id, `charge ripple ${(got.cappp * 1e3).toFixed(2)} mV exceeds the ${got.dvout} mV budget C_out was sized for`);
    }
  }
  /* 4. no NaN reached the drawing, and the trace closes on itself */
  for (const [k, d] of [["v_C", got.dvc], ["i_C", got.dic]]) {
    if (/NaN|Infinity|undefined/.test(d)) { bad(id, `${k} path contains ${d.match(/NaN|Infinity|undefined/)[0]}`); continue; }
    const n = d.match(/-?[\d.]+(?:e[-+]?\d+)?/g).map(Number);
    if (Math.abs(n[1] - n[n.length - 1]) > 0.05) {
      bad(id, `${k} does not close on itself: starts at y ${n[1]}, ends at y ${n[n.length - 1]}`);
    }
  }
  rows.push([id, (got.vpp * 1e3).toFixed(3) + " mV",
    `${((1 - got.cappp / got.vpp) * 100).toFixed(0)} % ESR · I_C(rms) ${(got.icrms * 1e3).toFixed(0)} mA · C ${(got.cval * 1e6).toFixed(1)} µF`]);
}

console.log("\ndrawn output ripple, per topology");
for (const [id, v, note] of rows) console.log(`  ${id.padEnd(12)} ${v.padStart(11)}   ${note}`);
console.log(`\n${rows.length} figures checked — ${fails === 0
  ? "every capacitor spec balanced its own charge" : fails + " FAILING"}`);
await browser.close();
process.exit(fails ? 1 : 0);
