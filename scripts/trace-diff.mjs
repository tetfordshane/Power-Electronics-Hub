/* Compare two trace snapshots numerically.

   String equality is the wrong test: rounding a coordinate to three decimals
   changes every path string while moving nothing by as much as a thousandth
   of a pixel. What matters is whether the drawn geometry moved, so parse the
   numbers out and compare them with a tolerance — and separately report when
   the number of points changes, because that means the SHAPE changed rather
   than its precision.

   Usage: node scripts/trace-diff.mjs before.json after.json [tolerance]    */
import { readFileSync } from "fs";

const [a, b, tolArg] = process.argv.slice(2);
const TOL = Number(tolArg || 0.01);
const A = JSON.parse(readFileSync(a, "utf8"));
const B = JSON.parse(readFileSync(b, "utf8"));

const nums = (d) => (d || "").match(/-?[\d.]+/g)?.map(Number) || [];

let same = 0;
const moved = [], reshaped = [], other = [];
for (const id of Object.keys(A)) {
  if (!A[id] && !B[id]) continue;
  if (!A[id] || !B[id]) { other.push([id, "waveform appeared or vanished"]); continue; }
  let ok = true;
  for (const k of ["v", "i", "ic", "vc"]) {
    /* A pane that exists in neither snapshot is not a difference. A pane that
       appears in one is reported as such rather than as a shape change, since
       "the capacitor pane arrived" and "the current changed shape" want very
       different reactions from the reader. */
    if (!A[id][k] && !B[id][k]) continue;
    if (!A[id][k] || !B[id][k]) {
      other.push([id, `${k} pane ${A[id][k] ? "vanished" : "appeared"}`]); ok = false; continue;
    }
    const x = nums(A[id][k]), y = nums(B[id][k]);
    if (x.length !== y.length) { reshaped.push([id, k, x.length, y.length]); ok = false; continue; }
    let worst = 0;
    for (let j = 0; j < x.length; j++) worst = Math.max(worst, Math.abs(x[j] - y[j]));
    if (worst > TOL) { moved.push([id, k, worst]); ok = false; }
  }
  if (A[id].viewBox !== B[id].viewBox) { other.push([id, `viewBox ${A[id].viewBox} -> ${B[id].viewBox}`]); ok = false; }
  if (A[id].ticks !== B[id].ticks) { other.push([id, "tick labels changed"]); ok = false; }
  if (ok) same++;
}

console.log(`unchanged within ${TOL}px: ${same}`);
if (reshaped.length) {
  console.log(`\nSHAPE CHANGED (different number of points) — ${reshaped.length}:`);
  for (const [id, k, n, m] of reshaped) console.log(`  ${id.padEnd(12)} ${k}: ${n} -> ${m} numbers`);
}
if (moved.length) {
  console.log(`\nGEOMETRY MOVED — ${moved.length}:`);
  for (const [id, k, w] of moved) console.log(`  ${id.padEnd(12)} ${k}: worst ${w.toFixed(3)}px`);
}
if (other.length) {
  console.log(`\nOTHER — ${other.length}:`);
  for (const [id, what] of other) console.log(`  ${id.padEnd(12)} ${what}`);
}
if (!reshaped.length && !moved.length && !other.length) console.log("\nnothing moved");
