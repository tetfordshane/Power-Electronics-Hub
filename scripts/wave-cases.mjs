/* Render the waveform under a set of named input cases, side by side.

   Comparing "ideal" against "saturating" against "discontinuous" is the only
   way to tell whether a shape change is the physics or a bug, and the cases
   have to be driven through the real inputs so the tables and the drawing
   stay coupled. Each case reads its own values back and the strip prints
   them, so a case that silently failed to apply cannot masquerade as a case
   that legitimately looks unchanged.

   Usage: node scripts/wave-cases.mjs                                       */
import puppeteer from "puppeteer";
import { bench } from "./lib/env.mjs";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";

const CASES = [
  ["buck", "ideal — no roll-off", { lsag: 0 }],
  ["buck", "saturating, 20 % roll-off", { lsag: 20 }],
  ["buck", "saturating hard, 60 %", { lsag: 60 }],
  ["buck", "discontinuous — ripple 2.6", { r: 2.6, lsag: 0 }],
  ["buck", "discontinuous + saturating", { r: 2.6, lsag: 40 }],
  ["syncbuck", "synchronous, ripple 2.6 — reverses instead", { r: 2.6, lsag: 0 }],
];

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 2 });

const shots = [];
for (const [id, label, fields] of CASES) {
  await page.goto(bench(id), { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1100));
  const applied = await page.evaluate((f) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      const el = document.getElementById("f_" + k);
      if (!el) { out[k] = "NO SUCH INPUT"; continue; }
      set.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      out[k] = el.value;
    }
    return out;
  }, fields);
  await new Promise((r) => setTimeout(r, 550));
  const read = await page.evaluate(() => {
    const w = document.querySelector('[data-fig="wave"]');
    const t = [...w.querySelectorAll("text")].map((x) => x.textContent);
    return { ticks: t.filter((x) => /peak|mean|valley/.test(x)).join("   ") };
  });
  const el = await page.$('[data-fig="wave"]');
  shots.push({ id, label, applied, read, img: await el.screenshot({ encoding: "base64" }) });
}

const rows = shots.map((s) => `<figure><figcaption><b>${s.id}</b><br>${s.label}
  <br><span style="color:#5C6E82">set ${Object.entries(s.applied).map(([k, v]) => k + "=" + v).join(", ")}</span>
  <br><span style="color:#6FD39B">${s.read.ticks}</span></figcaption>
  <img src="data:image/png;base64,${s.img}"></figure>`).join("");
writeFileSync(fileURLToPath(new URL("../.anim/wavecases.html", import.meta.url)),
  `<body style="margin:0;background:#0C1017;font:11px ui-monospace,monospace;color:#8DA0B4">${rows}
<style>figure{margin:0;display:flex;align-items:center;gap:10px;border-top:1px solid #1B2430}
figcaption{width:210px;flex:none;line-height:1.6}img{display:block;width:600px}</style></body>`);

const p2 = await browser.newPage();
await p2.setViewport({ width: 830, height: 400 });
await p2.goto(new URL("../.anim/wavecases.html", import.meta.url).href, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 450));
await p2.screenshot({ path: fileURLToPath(new URL("../.anim/wavecases.png", import.meta.url)), fullPage: true });
console.log("wrote .anim/wavecases.png");
for (const s of shots) console.log(`  ${s.label.padEnd(42)} ${JSON.stringify(s.applied)}  ${s.read.ticks}`);
await browser.close();
