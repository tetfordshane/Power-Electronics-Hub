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
];
const strs = new Set();
for (const re of patterns) for (const m of ps.matchAll(re)) strs.add(m[1]);

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
