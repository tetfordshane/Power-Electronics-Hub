/* Walk every topology and check the things that a change to a shared figure
   component can quietly break: console errors, text running outside its own
   viewBox, labels overlapping each other, and the cursor rake having one
   marker per drawn period.

   Usage: node scripts/sweep.mjs                                           */
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100 });

const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.goto("http://localhost:5173/#/bench/buck", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const ids = await page.evaluate(() =>
  [...document.querySelectorAll("nav button, .rail button")]
    .map((b) => b.getAttribute("data-id")).filter(Boolean));
const list = ids.length ? ids : JSON.parse(process.env.TOPO_IDS || "[]");

/* The rail buttons do not carry ids, and TOPOS is assembled from five
   separate arrays, so read the entries out of the source directly. */
const topoIds = list.length ? list : await (async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(new URL("../src/PowerStage.jsx", import.meta.url), "utf8");
  return [...src.matchAll(/^\s*id: "([a-z0-9]+)", name: "/gm)].map((x) => x[1]);
})();

console.log(`sweeping ${topoIds.length} topologies\n`);
let problems = 0;

for (const id of topoIds) {
  errs.length = 0;
  await page.goto(`http://localhost:5173/#/bench/${id}`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 700));
  const r = await page.evaluate(() => {
    const out = { clipped: [], overlaps: 0, rake: null, svgs: 0,
      cards: document.querySelectorAll(".card").length };
    for (const svg of document.querySelectorAll("svg")) {
      const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      if (vb.length !== 4 || !vb[2]) continue;
      out.svgs++;
      const texts = [...svg.querySelectorAll("text")];
      const boxes = [];
      for (const t of texts) {
        let b; try { b = t.getBBox(); } catch { continue; }
        if (!b.width) continue;
        if (b.x < -2 || b.y < -2 || b.x + b.width > vb[2] + 2 || b.y + b.height > vb[3] + 2) {
          out.clipped.push((t.textContent || "").slice(0, 24));
        }
        boxes.push(b);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], c = boxes[j];
          const ox = Math.min(a.x + a.width, c.x + c.width) - Math.max(a.x, c.x);
          const oy = Math.min(a.y + a.height, c.y + c.height) - Math.max(a.y, c.y);
          if (ox > 1.5 && oy > 1.5) out.overlaps++;
        }
      }
    }
    /* Only the topologies with a hand-traced conduction overlay animate, and
       only those pass a playhead to the waveform. The rest render the same
       component as a static reference trace, which correctly has no cursor,
       so asking them for a rake would report a gap that is not one. */
    const wave = document.querySelector('[data-fig="wave"]');
    out.animated = !!document.querySelector(".flowov");
    if (wave && out.animated) {
      out.rake = [...wave.querySelectorAll(".rake path")]
        .map((p) => +p.getAttribute("d").match(/^M ([\d.]+)/)[1]);
    }
    return out;
  });
  const bad = [];
  /* A page that fails to compile renders nothing at all, and every check
     below is vacuously satisfied by an empty document — this reported "all
     clear" across all 30 topologies while the app was a blank screen. Assert
     something was actually drawn before believing any of the rest. */
  if (!r.cards) bad.push("page rendered nothing — no cards (build error?)");
  else if (!r.svgs) bad.push("no figures rendered on the page");
  if (errs.length) bad.push(`${errs.length} console error(s): ${errs[0].slice(0, 90)}`);
  if (r.clipped.length) bad.push(`text outside viewBox: ${r.clipped.slice(0, 3).join(" | ")}`);
  if (r.overlaps) bad.push(`${r.overlaps} overlapping label pair(s)`);
  let rake = r.animated ? "animated, no waveform pane" : "static figure";
  if (r.rake) {
    if (r.rake.length !== 3) bad.push(`cursor rake has ${r.rake.length} markers, expected 3`);
    else {
      /* evenly spaced by exactly one period, or the markers are not the same
         instant in each drawn cycle and the hand-off will not line up */
      const d1 = r.rake[1] - r.rake[0], d2 = r.rake[2] - r.rake[1];
      if (Math.abs(d1 - d2) > 0.2) bad.push(`rake spacing uneven: ${d1.toFixed(2)} vs ${d2.toFixed(2)}`);
      rake = `rake 3 @ ${d1.toFixed(1)}px spacing`;
    }
  }
  if (bad.length) { problems++; console.log(`  ${id.padEnd(12)} ${bad.join("; ")}`); }
  else console.log(`  ${id.padEnd(12)} ok  (${r.svgs} figures, ${rake})`);
}

console.log(`\n${problems === 0 ? "all clear" : problems + " topologies with problems"}`);
await browser.close();
