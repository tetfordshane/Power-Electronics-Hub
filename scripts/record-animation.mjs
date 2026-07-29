/* Record the operation figure frame by frame and measure its continuity.

   The browser tabs available for interactive inspection are backgrounded, so
   requestAnimationFrame is suspended in them and the animation simply does
   not advance. A headless Chromium we drive ourselves does composite and does
   run rAF, so this is the only way to observe the motion rather than reason
   about it.

   Usage:  node scripts/record-animation.mjs [topologyId] [seconds]        */
import puppeteer from "puppeteer";
import { writeFileSync, mkdirSync } from "fs";

const id = process.argv[2] || "buck";
const secs = Number(process.argv[3] || 13);
const pageUrl = `http://localhost:5173/#/bench/${id}`;

const browser = await puppeteer.launch({ headless: true, args: ["--window-size=1600,1000"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto(pageUrl, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));

/* confirm rAF is actually running before trusting anything else */
const alive = await page.evaluate(async () => {
  const t0 = performance.now();
  let n = 0;
  await new Promise((res) => {
    const step = () => { n++; performance.now() - t0 < 500 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  });
  return { frames: n, visibility: document.visibilityState };
});
console.log(`rAF check: ${alive.frames} frames in 500 ms, document ${alive.visibility}`);
if (alive.frames < 10) { console.log("rAF not running — cannot measure"); await browser.close(); process.exit(1); }

const samples = await page.evaluate(async (secs) => {
  const out = [];
  const t0 = performance.now();
  await new Promise((res) => {
    const step = () => {
      /* every marker of the cursor rake, with the opacity of its group, so
         the hand-off at a period boundary can be measured the same way the
         arrow belt is */
      const curs = [...document.querySelectorAll("svg path")]
        .filter((p) => /^M [\d.]+ 18 V 168$/.test(p.getAttribute("d") || ""))
        .map((p) => [+p.getAttribute("d").match(/^M ([\d.]+)/)[1],
          +(p.parentElement.style.opacity || 1)]);
      const cur = document.querySelector(".flowp");
      const arrows = [...document.querySelectorAll(".carrow")].map((a) => {
        const m = (a.getAttribute("transform") || "").match(/translate\(([-\d.]+),([-\d.]+)\)/);
        return m ? [+m[1], +m[2], +(a.getAttribute("opacity") || 1)] : null;
      }).filter(Boolean);
      out.push({
        t: +(performance.now() - t0).toFixed(2),
        mx: curs.length ? curs[0][0] : null,
        curs,
        dash: cur ? parseFloat(cur.style.strokeDashoffset || "0") : null,
        fade: curs.length ? Math.max(...curs.map((c) => c[1])) : null,
        na: arrows.length,
        arrows,
        ph: [...document.querySelectorAll(".devr,.devg")].map((g)=>g.classList.contains("on")?1:0).join(""),
      });
      if (performance.now() - t0 < secs * 1000) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  return out;
}, secs);

mkdirSync(new URL("../.anim", import.meta.url), { recursive: true });
writeFileSync(new URL("../.anim/frames.json", import.meta.url), JSON.stringify(samples));

console.log(`captured ${samples.length} frames over ${secs}s (~${(samples.length/secs).toFixed(0)} fps)`);
console.log("run: node scripts/analyse-frames.mjs");

await browser.close();
