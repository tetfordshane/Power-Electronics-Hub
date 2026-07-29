/* Look at a cursor hand-off while the animation is actually running.

   The scrub control pauses the clock, and the edge dissolve is deliberately
   only active while playing — parked, every marker must stay visible or
   stepping through the phases would show a figure with no cursor in it. So a
   scrubbed filmstrip cannot show the dissolve at all. This captures a burst
   of live frames instead, records the cursor rake alongside each one, and
   then picks out the frames that straddle a hand-off.

   Usage: node scripts/handoff-filmstrip.mjs [topologyId]                   */
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const id = process.argv[2] || "buck";
const dir = new URL("../.anim/", import.meta.url);
mkdirSync(dir, { recursive: true });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 });
await page.goto(`http://localhost:5173/#/bench/${id}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1400));

/* half speed, so the dissolve spans enough frames to be seen */
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")]
    .find((x) => /Speed 0.5 times/i.test(x.getAttribute("aria-label") || ""));
  if (b) b.click();
});

const waveHandle = () => page.evaluateHandle(() => [...document.querySelectorAll("svg")]
  .find((s) => /244$/.test(s.getAttribute("viewBox") || "")) || null);

const read = () => page.evaluate(() => [...document.querySelectorAll("svg path")]
  .filter((p) => /^M [\d.]+ 18 V 168$/.test(p.getAttribute("d") || ""))
  .map((p) => [+p.getAttribute("d").match(/^M ([\d.]+)/)[1],
    +(p.parentElement.style.opacity || 1)]));

const el = (await waveHandle()).asElement();
if (!el) { console.log("no wave figure on this topology"); await browser.close(); process.exit(1); }

const frames = [];
for (let i = 0; i < 110; i++) {
  const curs = await read();
  const img = await el.screenshot({ encoding: "base64" });
  frames.push({ curs, img });
}
console.log(`captured ${frames.length} live frames`);

/* a hand-off is where the leftmost marker steps back by most of a period */
let w = -1;
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1].curs[0], b = frames[i].curs[0];
  if (a && b && b[0] - a[0] < -50) { w = i; break; }
}
if (w < 0) { console.log("no hand-off inside the capture window — try again"); await browser.close(); process.exit(1); }
console.log(`hand-off at captured frame ${w}`);

const pick = [];
for (let k = w - 4; k <= w + 3; k++) if (frames[k]) pick.push({ k, ...frames[k] });

const rows = pick.map((s) => {
  const rake = s.curs.map((c) => `${c[0].toFixed(0)}@${c[1].toFixed(2)}`).join("  ");
  const presence = s.curs.reduce((a, c) => a + c[1], 0).toFixed(2);
  const mark = s.k === w ? ' <b style="color:#6FD39B">← hand-off</b>' : "";
  return `<figure><figcaption>${rake}<br><span style="color:#5C6E82">presence ${presence}</span>${mark}</figcaption>
    <img src="data:image/png;base64,${s.img}"></figure>`;
}).join("\n");
const html = `<body style="margin:0;background:#0C1017;font:10.5px ui-monospace,monospace;color:#8DA0B4">
<div style="display:flex;flex-direction:column">${rows}</div>
<style>figure{margin:0;display:flex;align-items:center;gap:8px;border-top:1px solid #1B2430}
figcaption{width:190px;flex:none;line-height:1.5}img{display:block;height:200px}</style></body>`;
const htmlFile = new URL(`handoff-${id}.html`, dir);
writeFileSync(htmlFile, html);

const p2 = await browser.newPage();
await p2.setViewport({ width: 760, height: 400, deviceScaleFactor: 1 });
await p2.goto(htmlFile.href, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 500));
const out = new URL(`handoff-${id}.png`, dir);
await p2.screenshot({ path: fileURLToPath(out), fullPage: true });
console.log("wrote", fileURLToPath(out));
await browser.close();
