/* Stress the run splitter against every long literal in the app and report
   anything that throws, hangs, or produces a malformed run. */
import { readFileSync } from "fs";

const src = readFileSync(new URL("../src/tex.jsx", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/export function/g, "function")
  .replace(/export const/g, "const")
  .replace(/\/\* -+ components[\s\S]*$/, "\nexport { toLatex, splitRuns };");
const { splitRuns } = await import(
  "data:text/javascript;base64," + Buffer.from(src).toString("base64"));

const ps = readFileSync(new URL("../src/PowerStage.jsx", import.meta.url), "utf8");
const QUOTED = new RegExp('"((?:[^"\\\\]|\\\\.){4,400})"', "g");
const strs = new Set();
for (const m of ps.matchAll(QUOTED)) strs.add(m[1]);

let bad = 0;
for (const s of strs) {
  try {
    const t0 = Date.now();
    const runs = splitRuns(s);
    if (Date.now() - t0 > 200) { console.log("SLOW:", s.slice(0, 80)); bad++; }
    for (const r of runs) {
      if (typeof r.text !== "string") {
        console.log("BAD RUN:", JSON.stringify(r), "| in:", s.slice(0, 70)); bad++;
      }
    }
  } catch (e) {
    console.log("THROW:", e.message, "\n   on:", s.slice(0, 110));
    bad++;
    if (bad > 8) break;
  }
}
console.log(`checked ${strs.size} strings, ${bad} problems`);
