/* Record what every design() currently computes, so that changing it becomes
   a deliberate act with a diff rather than a silent one.

   Nothing here asserts a number is RIGHT — that judgement belongs to a human
   reading the panel against the equations beside it. What this pins down is
   that a number does not change without someone meaning it to. Thirty-two
   design functions, several hundred rows between them, and until now the only
   protection was walking the catalogue by eye.

   Regenerate deliberately, and read the diff:
       node scripts/gen-golden.mjs
       git diff test/golden/design.json                                     */
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { TOPOS } from "./lib/topos.mjs";
import { casesFor } from "./lib/cases.mjs";

mkdirSync(new URL("../test/golden/", import.meta.url), { recursive: true });

/* Only the numbers and the strings a reader sees. Functions and the polyline
   arrays inside `wave` are the drawing's business, and trace-snapshot already
   watches those far more precisely than a JSON dump could. */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? +v.toPrecision(12) : v);

function shot(res) {
  if (!res) return null;
  const o = {};
  if (res.infeasible) return { infeasible: true, warn: res.warn || [] };
  o.hi = (res.hi || []).map(([k, v]) => [k, v]);
  o.loss = (res.loss || []).map(([k, w, f]) => [k, num(w), f || ""]);
  o.warn = res.warn || [];
  if (res.pout !== undefined) o.pout = num(res.pout);
  o.groups = (res.groups || []).map((g) => ({
    t: g.t, rows: (g.rows || []).map((r) => [r[0], r[1], r[2] || ""]),
  }));
  /* The wave spec drives both the figure and the capacitor model, so its
     scalars are part of the contract even though the polylines are not. */
  if (res.wave) {
    const w = res.wave;
    o.wave = {};
    for (const k of ["D", "dI", "iavg", "sat", "vhi", "vlabel", "pulses", "vbi", "rect", "ilabel"]) {
      if (w[k] !== undefined) o.wave[k] = num(w[k]);
    }
    if (w.cap) {
      o.wave.cap = {};
      for (const k of ["kind", "C", "esr", "Vdc", "Io", "fsw", "n", "i0", "i1", "iavg", "dI"]) {
        if (w.cap[k] !== undefined) o.wave.cap[k] = num(w.cap[k]);
      }
    }
  }
  return o;
}

const golden = {};
let cases = 0, threw = 0;
for (const topo of TOPOS) {
  if (!topo.design) continue;
  golden[topo.id] = {};
  for (const c of casesFor(topo)) {
    cases++;
    try { golden[topo.id][c.name] = shot(topo.design(c.spec)); }
    catch (e) { threw++; golden[topo.id][c.name] = { threw: e.message }; }
  }
}

const out = fileURLToPath(new URL("../test/golden/design.json", import.meta.url));
writeFileSync(out, JSON.stringify(golden, null, 1));
console.log(`wrote test/golden/design.json — ${Object.keys(golden).length} topologies, ${cases} operating points` +
  (threw ? `, ${threw} of which threw` : ""));
