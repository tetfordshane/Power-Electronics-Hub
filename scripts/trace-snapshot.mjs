/* Dump the exact `d` of every waveform trace, for every topology.

   The point is to refactor the drawing without changing the drawing. Run this
   before a change to record a baseline, run it after, and diff. Anything that
   moves is either intended and explainable, or a bug — there is no third
   case, and eyeballing two near-identical sawtooths cannot tell them apart.

   Usage: node scripts/trace-snapshot.mjs [outfile]                        */
import puppeteer from "puppeteer";
import { bench } from "./lib/env.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";

const out = process.argv[2] || ".anim/traces.json";
mkdirSync(new URL("../.anim/", import.meta.url), { recursive: true });

const src = readFileSync(new URL("../src/PowerStage.jsx", import.meta.url), "utf8");
const ids = [...src.matchAll(/^\s*id: "([a-z0-9]+)", name: "/gm)].map((x) => x[1]);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100 });

const snap = {};
for (const id of ids) {
  await page.goto(bench(id), { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 650));
  snap[id] = await page.evaluate(() => {
    const w = document.querySelector('[data-fig="wave"]');
    if (!w) return null;
    /* Each trace carries data-trace naming its pane. Matching on the stroke
       colour worked while there were exactly two traces and no two of them
       shared a hue; it would now silently pick whichever pane happened to be
       drawn first. */
    const grab = (key) => {
      const p = w.querySelector(`path[data-trace="${key}"]`);
      return p ? p.getAttribute("d") : null;
    };
    return {
      viewBox: w.getAttribute("viewBox"),
      v: grab("v"),                             /* switch node */
      i: grab("i"),                             /* inductor current */
      ic: grab("ic"),                           /* capacitor current */
      vc: grab("vc"),                           /* output ripple */
      ticks: [...w.querySelectorAll("text")].map((t) => t.textContent).join(" | "),
    };
  });
}

writeFileSync(fileURLToPath(new URL("../" + out, import.meta.url)), JSON.stringify(snap, null, 1));
const n = Object.values(snap).filter(Boolean).length;
console.log(`wrote ${out} — ${n} topologies with a waveform, ${ids.length - n} without`);
await browser.close();
