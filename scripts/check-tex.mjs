/* Translation smoke test.
   Pulls every literal string the typesetter will ever be handed out of the
   topology data and pushes it through the parser, reporting anything that
   falls back to plain text. Run after editing tex.jsx or adding formulas:
       node scripts/check-tex.mjs                                          */
import { readFileSync } from "fs";

const src = readFileSync(new URL("../src/tex.jsx", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/export function/g, "function")
  .replace(/export const/g, "const")
  .replace(/\/\* -+ components[\s\S]*$/, "\nexport { toLatex, splitRuns };");
const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const { toLatex, splitRuns } = mod;

const ps = readFileSync(new URL("../src/PowerStage.jsx", import.meta.url), "utf8");
const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';
const patterns = [
  new RegExp("\\{\\s*e:\\s*" + QUOTED, "g"),
  new RegExp("\\bn:\\s*" + QUOTED, "g"),
  new RegExp("\\bt:\\s*" + QUOTED, "g"),
  new RegExp("\\bl:\\s*" + QUOTED, "g"),
  new RegExp("R2?\\(\\s*" + QUOTED, "g"),
  new RegExp("G\\(\\s*" + QUOTED, "g"),
  /* The prose fields. These render through <Sub>, which is <Mx>, which is
     KaTeX — so a stray formula in a sentence falls back to plain text exactly
     the way a bad equation does, and used to do it unwatched. `what` and the
     three trade-off lists carry symbols routinely (M = D, i_out, R_DS(on)). */
  new RegExp("\\bwhat:\\s*" + QUOTED, "g"),
  new RegExp("\\btag:\\s*" + QUOTED, "g"),
  new RegExp("\\bfam:\\s*" + QUOTED, "g"),
];
/* Array-valued prose fields: grab the literal, then every string inside it. */
const ARRAYS = ["chips", "pros", "cons", "use"];
const strs = new Set();
for (const re of patterns) for (const m of ps.matchAll(re)) strs.add(m[1]);
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

const fails = [];
for (const s of strs) {
  for (const r of splitRuns(s)) {
    if (r.t === "m" && r.text && toLatex(r.text) === null) fails.push([s, r.text]);
  }
}
console.log(`strings checked: ${strs.size}   failing math runs: ${fails.length}`);
const seen = new Set();
for (const [s, r] of fails) {
  if (seen.has(r)) continue;
  seen.add(r);
  console.log(`  <${r}>\n     in: ${s.slice(0, 100)}`);
}
process.exit(fails.length ? 1 : 0);
