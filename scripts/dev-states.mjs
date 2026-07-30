/* Show every device mark in both states, side by side, for a few topologies.
   A switch and a diode look right or wrong relative to each other, and only
   when you can see conducting and blocking at the same time.

   Usage: node scripts/dev-states.mjs [id,id,...]                          */
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const ids = (process.argv[2] || "buck,syncbuck,halfbridge").split(",");
const dir = new URL("../.anim/", import.meta.url);
mkdirSync(dir, { recursive: true });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 2 });

const rows = [];
for (const id of ids) {
  await page.goto(`http://localhost:5173/#/bench/${id}`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1300));
  /* step through the named phases rather than scrubbing, so each shot lands
     squarely inside a phase instead of near a commutation */
  const n = await page.evaluate(() => document.querySelectorAll(".flowctl button, .ctl button").length);
  const phases = await page.evaluate(() => {
    const bar = document.querySelector(".flowwrap") ? document : null;
    if (!bar) return [];
    return [...document.querySelectorAll("button")]
      .filter((b) => /^(Q\d|D\d|SR\d|Both|Dead|Upper|Lower|Winding|Idle)/i.test(b.textContent.trim()))
      .map((b) => b.textContent.trim());
  });
  for (const t of phases.slice(0, 3)) {
    await page.evaluate((t) => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t);
      if (b) b.click();
    }, t);
    await new Promise((r) => setTimeout(r, 380));
    const el = await page.$(".flowwrap");
    if (!el) continue;
    rows.push({ id, t, img: await el.screenshot({ encoding: "base64" }) });
  }
  void n;
}

const html = `<body style="margin:0;background:#0C1017;font:11px ui-monospace,monospace;color:#8DA0B4">
<div style="display:flex;flex-direction:column">${rows.map((r) =>
  `<figure><figcaption>${r.id}<br><b style="color:#6FD39B">${r.t}</b></figcaption>
   <img src="data:image/png;base64,${r.img}"></figure>`).join("")}</div>
<style>figure{margin:0;display:flex;align-items:center;gap:8px;border-top:1px solid #1B2430}
figcaption{width:110px;flex:none;line-height:1.6}img{display:block;height:260px}</style></body>`;
const f = new URL("devstates.html", dir);
writeFileSync(f, html);
const p2 = await browser.newPage();
await p2.setViewport({ width: 820, height: 400 });
await p2.goto(f.href, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 400));
const out = new URL("devstates.png", dir);
await p2.screenshot({ path: fileURLToPath(out), fullPage: true });
console.log("wrote", fileURLToPath(out), `(${rows.length} frames)`);
await browser.close();
