/* Does every topology actually have all of its parts?

   The catalogue is assembled from parallel registries keyed by topology id —
   the topology object itself, SCH, FLOW, FAMILY, the selector's id map. None
   of them can see the others. A topology added to one and forgotten in
   another does not crash: it loses its animation, or its family line, or its
   row stops being clickable, silently, on one page out of thirty-two. That is
   exactly the class of fault this app cannot notice from the inside, and
   check-flow only ever covered the geometry.

   So: assert the shape of the whole registry, once, here.

       node scripts/check-registry.mjs                                      */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOPOS, CATS, FLOW, FAMILY } from "./lib/topos.mjs";
import { FIELDS, SEV } from "../src/fields.js";
import { SELECT, SELECT_ID } from "../src/content/select.js";
import { EXAMPLES } from "../src/content/examples.js";
import { CODES } from "../src/urlstate.js";
import { SIM } from "../src/topologies/sim/pilot.js";
import { NOSIM_REASON, NOSIM_WHY } from "../src/content/nosim.js";
import { defaultSpec } from "./lib/spec.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
/* SCH is JSX, so it cannot be imported here. Its ids are scraped from the one
   file that holds them, in the literal form check-flow also depends on. */
const schSrc = readFileSync(join(root, "src", "schematic", "sch.jsx"), "utf8");
const SCH_IDS = new Set([...schSrc.matchAll(/^\s*(\w+): \(\) => <SV/gm)].map((m) => m[1]));

let fails = 0;
const fail = (id, msg) => { fails++; console.error(`  FAIL  ${id.padEnd(12)} ${msg}`); };

/* ------------------------------------------------------------ identity */
const seen = new Set();
for (const t of TOPOS) {
  if (!t.id) { fail("(none)", "a topology with no id"); continue; }
  if (seen.has(t.id)) fail(t.id, "duplicate id");
  seen.add(t.id);
  if (!t.name) fail(t.id, "no name");
  if (!t.cat) fail(t.id, "no category");
  else if (!CATS.includes(t.cat)) fail(t.id, `category "${t.cat}" is not in CATS`);
}

/* -------------------------------------------------- the other registries */
for (const t of TOPOS) {
  if (!t.sch) fail(t.id, "no sch key");
  else if (!SCH_IDS.has(t.sch)) fail(t.id, `sch "${t.sch}" has no schematic`);

  if (!FAMILY[t.id]) fail(t.id, "no FAMILY line — the 'This is the … family' paragraph vanishes");

  const F = FLOW[t.id];
  if (!F) { fail(t.id, "no FLOW entry — the figure does not animate"); continue; }
  if (!(F.w > 0) || !(F.h > 0)) fail(t.id, "FLOW is missing w/h");
  if (!Array.isArray(F.ph) || !F.ph.length) fail(t.id, "FLOW has no phases");
  else F.ph.forEach((q, k) => {
    if (!q.t) fail(t.id, `phase ${k} has no title`);
    if (!q.n) fail(t.id, `phase ${k} has no note`);
    if (q.f && typeof q.f !== "function") fail(t.id, `phase ${k}: f is not a function`);
    if (q.f) {
      const w = q.f(0.4);
      if (!Array.isArray(w) || w.length !== 2 || !(w[1] >= w[0])) {
        fail(t.id, `phase ${k}: f(D) is not an ordered [u0,u1]`);
      }
    }
    if (q.on && F.sw && q.on.length !== F.sw.length) {
      fail(t.id, `phase ${k}: ${q.on.length} conduction flags for ${F.sw.length} devices`);
    }
    /* `rides` names the probe each drawn path carries, so the two lists have
       to line up. One short and the last path silently falls back to the
       figure's summed current — which is the very thing naming them was for,
       and it would look like it was working. */
    if (q.rides) {
      if (!Array.isArray(q.rides) || q.rides.length !== (q.d || []).length) {
        fail(t.id, `phase ${k}: ${(q.rides || []).length} ride names for `
          + `${(q.d || []).length} drawn paths`);
      } else if (q.rides.some((r) => r !== null && typeof r !== "string")) {
        fail(t.id, `phase ${k}: a ride name is neither a probe name nor null`);
      }
    }
  });
  /* A topology that changes conduction pattern with its operating point
     carries every pattern in `ph` and selects one by name. Three ways that
     goes wrong silently: an index past the end of `ph` (the figure loses a
     phase), a phase in no set at all (drawn by nothing, yet still validated
     geometrically by check-flow, so it looks maintained and is dead), and a
     design that never publishes a key any set answers to (the figure falls
     back to every phase at once, which is how this was found). */
  if (F.phSets) {
    const claimed = new Set();
    for (const [key, ix] of Object.entries(F.phSets)) {
      if (!Array.isArray(ix) || !ix.length) { fail(t.id, `phSets.${key} is empty`); continue; }
      for (const i of ix) {
        if (!Number.isInteger(i) || i < 0 || i >= F.ph.length) {
          fail(t.id, `phSets.${key} names phase ${i}, and there are ${F.ph.length}`);
        } else claimed.add(i);
      }
    }
    for (let i = 0; i < F.ph.length; i++) {
      if (!claimed.has(i)) fail(t.id, `phase ${i} ("${F.ph[i].t}") is in no phSet, so nothing draws it`);
    }
    /* And the design must actually name one of them. */
    let res = null;
    try { res = t.design(defaultSpec(t)); } catch { res = null; }
    if (res && !res.infeasible && !F.phSets[res.mode]) {
      fail(t.id, `design() reports mode "${res.mode}", which is not one of `
        + `${Object.keys(F.phSets).join(", ")}`);
    }
  }
  for (const c of F.capFlow || []) {
    if (!["in", "out"].includes(c.src)) fail(t.id, `capFlow src "${c.src}" is neither "in" nor "out"`);
    if (!c.d) fail(t.id, "capFlow entry with no path");
  }
  if (F.pol && F.pol.length !== 4) fail(t.id, "pol must be [ax, ay, bx, by]");
  if (F.emc) {
    if (!F.emc.loop) fail(t.id, "emc with no loop");
    if (!Array.isArray(F.emc.node) || F.emc.node.length !== 2) fail(t.id, "emc.node must be [x, y]");
  }
}

/* -------------------------------------------------------------- inputs */
for (const t of TOPOS) {
  if (!Array.isArray(t.fields) || !t.fields.length) { fail(t.id, "no fields"); continue; }
  for (const k of t.fields) if (!FIELDS[k]) fail(t.id, `field "${k}" is not in FIELDS`);
  for (const k of Object.keys(t.defs || {})) {
    if (!t.fields.includes(k)) fail(t.id, `defs override "${k}", which it does not display`);
  }
}

/* ------------------------------------------------------------ the maths */
for (const t of TOPOS) {
  if (!t.design) { fail(t.id, "no design()"); continue; }
  let res;
  try { res = t.design(defaultSpec(t)); }
  catch (e) { fail(t.id, `design() threw at its own defaults: ${e.message}`); continue; }
  if (!res) { fail(t.id, "design() returned nothing"); continue; }
  if (res.infeasible) { fail(t.id, "design() calls its own defaults infeasible"); continue; }
  if (!res.hi || !res.hi.length) fail(t.id, "no headline figures");
  if (!res.groups || !res.groups.length) fail(t.id, "no result groups");
  /* The loss array feeds both the loss bar and the whole efficiency map. A
     topology without one loses both features on its page alone. */
  if (!res.loss || !res.loss.length) fail(t.id, "no loss array — the loss bar and heat map both vanish");
  else res.loss.forEach((l, i) => {
    if (typeof l[0] !== "string" || !l[0]) fail(t.id, `loss ${i} has no label`);
    if (!Number.isFinite(l[1])) fail(t.id, `loss ${i} ("${l[0]}") is ${l[1]}, not a number`);
    else if (l[1] < 0) fail(t.id, `loss ${i} ("${l[0]}") is negative`);
    /* A loss may name the device it heats, which is what lets hovering the
       bar light that part up on the schematic. The name has to be one the
       figure actually draws — a typo would simply highlight nothing, in
       silence, on one topology out of thirty-two. */
    if (l[3] !== undefined) {
      const marks = new Set(((FLOW[t.id] || {}).sw || []).map((q) => q[2]));
      for (const d of Array.isArray(l[3]) ? l[3] : [l[3]]) {
        if (!marks.has(d)) {
          fail(t.id, `loss "${l[0]}" points at device "${d}", which the figure does not draw`
            + (marks.size ? ` (has ${[...marks].join(", ")})` : " (no devices at all)"));
        }
      }
    }
  });
  /* Warnings carry a severity from a closed set. An unrecognised tier falls
     back to `check` in the renderer, so a typo would silently downgrade a
     stop to an advisory — visible nowhere except on the page it matters on. */
  for (const w of res.warn || []) {
    if (!w || typeof w !== "object") { fail(t.id, `warn "${w}" is not a {s, m} entry`); continue; }
    if (!SEV.includes(w.s)) fail(t.id, `warn severity "${w.s}" is not one of ${SEV.join(", ")}`);
    if (typeof w.m !== "string" || !w.m.trim()) fail(t.id, `warn with severity "${w.s}" has no message`);
  }
  /* Nothing on the panel may read as an unfilled blank or a nonsense value —
     this is the walk the README asks a human to do by eye. */
  for (const g of res.groups) {
    for (const r of g.rows || []) {
      if (r[1] === undefined || r[1] === null) fail(t.id, `"${r[0]}" has no value`);
      if (typeof r[1] === "string" && /NaN|Infinity|undefined/.test(r[1])) {
        fail(t.id, `"${r[0]}" prints ${r[1]}`);
      }
    }
  }
}

/* ------------------------------------------------------------ selector */
/* Every row is a converter — the table carries no header row, its column
   headings live in the markup. */
const rowNames = new Set(SELECT.map((r) => r[0]));
for (const name of Object.keys(SELECT_ID)) {
  if (!rowNames.has(name)) fail(SELECT_ID[name], `SELECT_ID names "${name}", which is not a selector row`);
  if (!seen.has(SELECT_ID[name])) fail(SELECT_ID[name], `SELECT_ID "${name}" points at no topology`);
}
let unlinked = 0;
for (const name of rowNames) if (!SELECT_ID[name]) unlinked++;
if (unlinked) console.log(`  note: ${unlinked} selector rows are not clickable through to a bench page`);

/* ------------------------------------------------------------ examples */
/* Checked in both directions. A category with no worked example renders an
   empty space where the card should be, and an example under a misspelled
   category key renders nowhere at all — neither one throws, and neither is
   visible from any single file. */
let exCount = 0;
for (const cat of CATS) {
  const list = EXAMPLES[cat];
  if (!Array.isArray(list) || !list.length) { fail(cat, "no worked example for this category"); continue; }
  list.forEach((x, i) => {
    const where = `${cat} example ${i}`;
    if (!x.t) fail(where, "no title");
    if (!x.n) fail(where, "no explanation");
    const go = x.go || {};
    const t = TOPOS.find((q) => q.id === go.tid);
    if (!t) { fail(where, `go.tid "${go.tid}" is no topology`); return; }
    exCount++;
    for (const [k, v] of Object.entries(go.over || {})) {
      /* Raw strings, because that is what the bench's inputs hold — an
         example that loaded numbers would bypass the one parse-and-clamp
         path every typed entry goes through. */
      if (typeof v !== "string") { fail(where, `over.${k} is ${typeof v}, not a raw string`); continue; }
      if (!FIELDS[k]) { fail(where, `over.${k} is not a field`); continue; }
      if (!t.fields.includes(k)) { fail(where, `over.${k} is not displayed by ${t.id}`); continue; }
      const n = parseFloat(v);
      if (!Number.isFinite(n)) fail(where, `over.${k} = "${v}" is not a number`);
      else if (n < FIELDS[k].mn || n > FIELDS[k].mx) {
        fail(where, `over.${k} = ${v} is outside ${FIELDS[k].mn}…${FIELDS[k].mx}`);
      }
    }
  });
}
for (const cat of Object.keys(EXAMPLES)) {
  if (!CATS.includes(cat)) fail(cat, "EXAMPLES has a category that is not in CATS");
}

/* --------------------------------------------------------- URL codes */
/* A field with no code silently drops out of every shared link; two fields
   with the same code silently overwrite each other. Neither throws, and
   neither is visible without opening a saved URL. */
for (const k of Object.keys(FIELDS)) {
  if (!CODES[k]) fail(k, "field has no URL code, so it cannot be shared in a link");
}
for (const k of Object.keys(CODES)) {
  if (!FIELDS[k]) fail(k, "CODES names a field that does not exist");
}
const byCode = new Map();
for (const [k, c] of Object.entries(CODES)) {
  if (byCode.has(c)) fail(k, `URL code "${c}" is already used by ${byCode.get(c)}`);
  byCode.set(c, k);
  /* A code that reads as another field's name is a trap for anyone editing a
     URL by hand. */
  if (FIELDS[c] && c !== k) fail(k, `URL code "${c}" is also the name of another field`);
}

/* ------------------------------------------------ simulated or explained */
/* Exactly one of the two, for every topology. A converter with neither has a
   figure whose provenance the page never states; one with both is claiming to
   be solved and apologising for not being, which cannot both be true. The
   counts print because they are the conversion backlog: every capability the
   engine grows should move topologies from the right column to the left. */
const byReason = new Map();
for (const t of TOPOS) {
  const sim = !!SIM[t.id], why = NOSIM_REASON[t.id];
  if (sim && why) fail(t.id, "is simulated AND carries a closed-form reason");
  if (!sim && !why) {
    fail(t.id, "is neither simulated nor given a reason — see src/content/nosim.js");
  }
  if (why && !NOSIM_WHY[why]) fail(t.id, `closed-form reason "${why}" has no explanation`);
  if (!sim && why) byReason.set(why, (byReason.get(why) || 0) + 1);
}
for (const key of Object.keys(NOSIM_WHY)) {
  if (!byReason.has(key)) {
    console.log(`  note: no topology is waiting on "${key}" any more — that capability is done`);
  }
}

/* `iShape` OVERRIDES a design's own current, so the two must not coexist.
   buildCycle takes the supplied shape in preference to the wave's ramp, which
   is right while the shape is all a bare-mode topology has — and silently
   wrong the moment that topology grows a `wave`. The design then computes a
   duty, a ripple and a capacitor, the panel prints them, and the figure draws
   a hand-authored curve that answers to none of them. It was live on the
   synchronous rectifier for exactly as long as it took to notice. */
for (const t of TOPOS) {
  const F = FLOW[t.id];
  if (!F || !F.iShape) continue;
  let res;
  try { res = t.design(defaultSpec(t)); } catch { continue; }
  if (res && !res.infeasible && res.wave) {
    fail(t.id, "has both an iShape and a design wave — the supplied shape wins, "
      + "so the figure would ignore every number the panel prints. Drop the iShape.");
  }
}

/* A `rides` name has to be a probe the circuit actually publishes.
   Misspell one and `viewOf` returns nothing, the path quietly falls back to
   the figure's summed current, and the dashes move at a rate that belongs to
   another branch — which looks exactly like a path that was never given a
   probe at all. The count check above cannot see this; only the netlist can. */
for (const t of TOPOS) {
  const F = FLOW[t.id], make = SIM[t.id];
  if (!F || !make || !Array.isArray(F.ph)) continue;
  let probes;
  try {
    const res = t.design(defaultSpec(t));
    if (!res || res.infeasible || !res.sim) continue;
    probes = make(defaultSpec(t), res).probes || {};
  } catch { continue; }
  F.ph.forEach((q, k) => {
    for (const r of q.rides || []) {
      if (r && !probes[r]) fail(t.id, `phase ${k} rides "${r}", which the circuit does not probe`);
    }
  });
}

console.log(`check-registry: ${TOPOS.length} topologies, ${SCH_IDS.size} schematics, ` +
  `${Object.keys(FLOW).length} flow entries, ${Object.keys(FAMILY).length} family lines, ` +
  `${exCount} worked examples`);
const simmed = TOPOS.filter((t) => SIM[t.id]).length;
console.log(`check-registry: ${simmed} simulated, ${TOPOS.length - simmed} closed-form `
  + `(${[...byReason].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(", ")})`);
console.log(fails ? `check-registry: ${fails} problems` : "check-registry: all clear");
process.exit(fails ? 1 : 0);
