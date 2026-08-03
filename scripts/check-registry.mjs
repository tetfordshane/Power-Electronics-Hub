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
  });
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

console.log(`check-registry: ${TOPOS.length} topologies, ${SCH_IDS.size} schematics, ` +
  `${Object.keys(FLOW).length} flow entries, ${Object.keys(FAMILY).length} family lines, ` +
  `${exCount} worked examples`);
console.log(fails ? `check-registry: ${fails} problems` : "check-registry: all clear");
process.exit(fails ? 1 : 0);
