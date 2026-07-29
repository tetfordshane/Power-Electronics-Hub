/* Assemble a filmstrip across the loop wrap so the transition can be looked
   at rather than reasoned about. The animation is paused and the scrub
   control is driven to exact positions, which makes the frames deterministic
   and repeatable — a free-running capture cannot be aimed at the wrap, and
   the interactive browser tabs never advance the animation at all because
   rAF is suspended while they are backgrounded.

   Usage: node scripts/wrap-filmstrip.mjs [topologyId] [what] [span]
          what = wave | circuit | both
          span = fraction of the loop either side of the wrap (default .014) */
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const id = process.argv[2] || "buck";
const what = process.argv[3] || "wave";
const span = Number(process.argv[4] || 0.014);
const dir = new URL("../.anim/", import.meta.url);
mkdirSync(dir, { recursive: true });

/* eight positions straddling p = 0, snapped to the scrub control's own step
   so the values asked for are the values applied */
const STEP = 0.002;
const snap = (v) => Math.round(v / STEP) * STEP;
const POS = [];
for (let k = 4; k >= 1; k--) POS.push(snap(1 - (span * k) / 4));
for (let k = 0; k <= 3; k++) POS.push(snap((span * k) / 4));

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 2 });
await page.goto(`http://localhost:5173/#/bench/${id}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1400));

/* Pause first: while it is running the clock overwrites the scrub value
   between setting it and taking the shot. */
const paused = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")]
    .find((x) => /^(pause|play)$/i.test((x.getAttribute("aria-label") || "").trim()));
  if (!b) return "no play/pause button found";
  if (/pause/i.test(b.getAttribute("aria-label"))) { b.click(); return "clicked pause"; }
  return "already paused";
});
console.log(paused);

const pick = (kind) => page.evaluateHandle((k) => {
  if (k === "wave") {
    return [...document.querySelectorAll("svg")]
      .find((s) => /244$/.test(s.getAttribute("viewBox") || "")) || null;
  }
  return document.querySelector(".flowwrap") || document.querySelector(".flowov");
}, kind);

const kinds = what === "both" ? ["circuit", "wave"] : [what];
const shots = [];
for (const pos of POS) {
  const applied = await page.evaluate((v) => {
    const r = document.querySelector(".scrub input[type=range]");
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(r, String(v));
    r.dispatchEvent(new Event("input", { bubbles: true }));
    r.dispatchEvent(new Event("change", { bubbles: true }));
    return parseFloat(r.value);
  }, pos);
  await new Promise((r) => setTimeout(r, 240));
  const imgs = [];
  for (const k of kinds) {
    const el = (await pick(k)).asElement();
    if (!el) { console.log(`could not find the ${k} element`); continue; }
    imgs.push(await el.screenshot({ encoding: "base64" }));
  }
  shots.push({ pos: applied, imgs });
}

const rows = shots.map((s) => {
  const mark = Math.abs(s.pos) < 1e-9 ? '<b style="color:#6FD39B"> &larr; wrap</b>' : "";
  return `<figure><figcaption>p = ${s.pos.toFixed(3)}${mark}</figcaption>
    ${s.imgs.map((b) => `<img src="data:image/png;base64,${b}">`).join("")}</figure>`;
}).join("\n");
const stripHtml = `<body style="margin:0;background:#0C1017;font:11px ui-monospace,monospace;color:#8DA0B4">
<div style="display:flex;flex-direction:column">${rows}</div>
<style>figure{margin:0;display:flex;align-items:center;gap:6px;border-top:1px solid #1B2430}
figcaption{width:112px;text-align:right;flex:none}
img{display:block;height:${what === "both" ? 148 : 208}px}</style></body>`;
const stripFile = new URL(`strip-${id}-${what}.html`, dir);
writeFileSync(stripFile, stripHtml);

const p2 = await browser.newPage();
await p2.setViewport({ width: 1180, height: 400, deviceScaleFactor: 1 });
await p2.goto(stripFile.href, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 500));
const out = new URL(`wrap-${id}-${what}.png`, dir);
await p2.screenshot({ path: fileURLToPath(out), fullPage: true });
console.log("wrote", fileURLToPath(out));
await browser.close();
