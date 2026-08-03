/* Translation smoke test.
   Pulls every literal string the typesetter will ever be handed out of the
   topology data and pushes it through the parser, reporting anything that
   falls back to plain text — or that parses but should never have been maths
   in the first place. Run after editing tex.jsx or adding formulas:
       node scripts/check-tex.mjs                                          */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TOPOS } from "./lib/topos.mjs";
import { casesFor } from "./lib/cases.mjs";

const src = readFileSync(new URL("../src/tex.jsx", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/export function/g, "function")
  .replace(/export const/g, "const")
  .replace(/\/\* -+ components[\s\S]*$/, "\nexport { toLatex, splitRuns, isProseWord };");
const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const { toLatex, splitRuns, isProseWord } = mod;

/* Every source file that can hold a string the typesetter will see.

   This used to read one file, because there was one file. Walking the tree
   instead means a new topology module is covered the day it is added rather
   than the day someone remembers to list it here — the failure that silently
   drops coverage is the one worth designing out. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sources = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(f)) sources.push(p);
  }
})(join(root, "src"));
const ps = sources.map((p) => readFileSync(p, "utf8")).join("\n");

const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';
const BARE = '"(?:[^"\\\\]|\\\\.)*"';
/* A prose value longer than a line is written as a concatenation, and matching
   one quoted literal after the key checked the opening clause of a paragraph
   and silently ignored the rest — which is exactly where the symbols are, a
   sentence being far more likely to reach for C_bulk or R_DS(on) after it has
   got going. So the value is matched as the whole `"…" + "…" + "…"` run and
   every segment of it is scanned. */
const RUN = BARE + "(?:\\s*\\+\\s*" + BARE + ")*";
/* The keys whose values are prose or formulas the typesetter will see. These
   render through <Sub>/<Eq>, which are <Mx>, which is KaTeX — so a stray
   formula in a sentence falls back to plain text exactly the way a bad
   equation does, and used to do it unwatched. `what` and the three trade-off
   lists carry symbols routinely (M = D, i_out, R_DS(on)).

   `e` was anchored to a preceding `{`, which fitted the cheat sheet's rows and
   nothing else: an `e` written after a title on the line above was invisible
   to this gate. It is a word-boundary match like every other key now. */
const KEYS = ["e", "n", "t", "l", "what", "tag", "fam", "help"];
/* Array-valued prose fields: grab the literal, then every string inside it. */
const ARRAYS = ["chips", "pros", "cons", "use"];
const strs = new Set();
const addRun = (run) => {
  for (const q of run.matchAll(new RegExp(QUOTED, "g"))) strs.add(q[1]);
};
for (const key of KEYS) {
  for (const m of ps.matchAll(new RegExp("\\b" + key + ":\\s*(" + RUN + ")", "g"))) addRun(m[1]);
}
for (const call of ["R2?", "G"]) {
  for (const m of ps.matchAll(new RegExp(call + "\\(\\s*(" + RUN + ")", "g"))) addRun(m[1]);
}
/* Warnings hid from both halves of this gate. The prose sits behind a
   condition — W("note", Vst > 60 && "Device stress is " + …) — so the pattern
   above, which reads the first literal after the paren, saw only the severity.
   And the runtime pass below cannot reach it either: a warning guarded by
   `Vst > 60` fires on a corner, and no corner in the matrix puts a SEPIC
   there. So the whole call is walked and every literal in it taken.

   The severity is what identifies the call: the schematic draws with its own
   W(), whose argument is a path string, and matching on the bare name would
   drag several hundred "M 40 70 H 150" through the typesetter. */
for (const m of ps.matchAll(/\bW\(\s*"(?:stop|check|note)"\s*,/g)) {
  let i = m.index + m[0].length, depth = 1, str = false, esc = false;
  const from = i;
  for (; i < ps.length && depth > 0; i++) {
    const c = ps[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  addRun(ps.slice(from, i));
}
for (const key of ARRAYS) {
  for (const m of ps.matchAll(new RegExp("\\b" + key + ":\\s*\\[([^\\]]*)\\]", "g"))) {
    for (const q of m[1].matchAll(new RegExp(QUOTED, "g"))) strs.add(q[1]);
  }
}
/* Objects whose VALUES are prose keyed by topology id, rather than prose on a
   named field. FAMILY is one line per converter and every line of it goes
   through the typesetter, so it needs watching for the same reason `what`
   does — they carry symbols (±V_in/2, I²R, 120°) as a matter of course. */
for (const key of ["FAMILY"]) {
  const m = ps.match(new RegExp("const " + key + " = \\{([\\s\\S]*?)\\n\\};"));
  if (m) for (const q of m[1].matchAll(new RegExp(QUOTED, "g"))) strs.add(q[1]);
}

/* And the strings no literal scan can reach: the ones design() builds at run
   time. A row label assembled from a template — "C_out ≥ " + eng(c) — is
   typeset exactly like a written one, and until now nothing checked it.

   Over the same operating points the golden file records, not just the
   defaults: the corners are where the conditional prose lives, and a row that
   only appears at light load was being generated by nobody. */
let ran = 0, topos = 0;
const runtime = new Set();
for (const topo of TOPOS) {
  if (!topo.design) continue;
  topos++;
  for (const c of casesFor(topo)) {
    let res;
    try { res = topo.design(c.spec); } catch { continue; }
    ran++;
    const add = (s) => { if (typeof s === "string" && s.trim()) runtime.add(s); };
    for (const [k, v] of res.hi || []) { add(k); add(v); }
    /* Warnings are {s, m} now. The string branch is belt-and-braces: if the
       shape ever changes again, prose must not silently fall out of this gate
       the way it did when `e:` was anchored to a brace. */
    for (const w of res.warn || []) add(typeof w === "string" ? w : w && w.m);
    for (const l of res.loss || []) { add(l[0]); add(l[2]); }
    for (const g of res.groups || []) {
      add(g.t);
      for (const r of g.rows || []) { add(r[0]); add(r[1]); add(r[2]); }
    }
  }
}
for (const s of runtime) strs.add(s);

/* There are two ways a run can be wrong, and only the first was ever watched.

   A run that does not parse falls back to plain text: ugly, but legible, and
   `toLatex` returning null says so plainly. A run that swallowed a word is the
   opposite — it parses perfectly, because "V a SEPIC" is a valid product of
   three symbols, and nothing in the parse hints that two of them were English.
   What gives it away is the rendering: the word spaces come back as \, at
   3/18 em, so "Above ~60 V a SEPIC" sets as "Above ∼60VaSEPIC". So the gate
   asks the second question too — does this run contain a token that is prose?
   — using the splitter's own rule, so the two cannot drift apart. */
const fails = [];       /* run did not parse */
const swallowed = [];   /* run parsed, but had prose in it */
for (const s of strs) {
  for (const r of splitRuns(s)) {
    if (r.t !== "m" || !r.text) continue;
    if (toLatex(r.text) === null) { fails.push([s, r.text]); continue; }
    const words = r.text.split(/\s+/).filter((w) => w && isProseWord(w));
    if (words.length) swallowed.push([s, r.text, words]);
  }
}
console.log(`strings checked: ${strs.size}   (${runtime.size} of them built by design(), over ${ran} operating points on ${topos} topologies)`);
console.log(`failing math runs: ${fails.length}`);
const seen = new Set();
for (const [s, r] of fails) {
  if (seen.has(r)) continue;
  seen.add(r);
  console.log(`  <${r}>\n     in: ${s.slice(0, 100)}`);
}
console.log(`math runs that swallowed prose: ${swallowed.length}`);
const seenW = new Set();
for (const [s, r, words] of swallowed) {
  if (seenW.has(r)) continue;
  seenW.add(r);
  console.log(`  <${r}>  swallowed ${words.map((w) => JSON.stringify(w)).join(", ")}\n     in: ${s.slice(0, 100)}`);
}
process.exit(fails.length || swallowed.length ? 1 : 0);
