/* Number formatting. Shared by everything that prints a quantity.

   Kept free of React so the check scripts can import it. */
/* ---------------------------- numbers ---------------------------- */
function eng(v, unit) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (v === 0) return "0 " + (unit || "");
  const neg = v < 0; v = Math.abs(v);
  const U = [[1e9,"G"],[1e6,"M"],[1e3,"k"],[1,""],[1e-3,"m"],[1e-6,"µ"],[1e-9,"n"],[1e-12,"p"]];
  let m = 1e-12, p = "p";
  for (const [mm, pp] of U) if (v >= mm) { m = mm; p = pp; break; }
  const x = v / m;
  const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  return (neg ? "−" : "") + s + " " + p + (unit || "");
}
/* Axis ticks get eng() with the trailing zeros trimmed: "2 µs / 4 µs", not
   "2.00 µs / 4.00 µs". A tick row is the ruler, not the measurement — the
   captions that state a measured value keep the full eng(). */
const engAx = (v, unit) =>
  eng(v, unit).replace(/(\d)\.0+ /, "$1 ").replace(/(\.\d*[1-9])0+ /, "$1 ");
const pct = (x) => (isFinite(x) ? (100 * x).toFixed(1) + " %" : "—");
const f2 = (x) => (isFinite(x) ? x.toFixed(2) : "—");
const f3 = (x) => (isFinite(x) ? x.toFixed(3) : "—");
const clamp = (x, lo, hi) => (isFinite(x) ? Math.min(Math.max(x, lo), hi) : lo);

export { eng, engAx, pct, f2, f3, clamp };
