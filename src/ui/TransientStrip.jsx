import React from "react";
import { eng } from "../format.js";
import { nk, drawScope, Tx } from "../schematic/parts.jsx";

/* The settle, end to end, on one axis.

   A switching period is microseconds and a recovery is milliseconds, so the
   two cannot share an axis: the figure above shows one period in detail and
   this shows a thousand of them at once. The cursor is the link — it marks
   which period the figure is drawing, and dragging it moves the figure
   through the transient.

   Two things are plotted. The band is the inductor current's excursion each
   period, minimum to maximum, which is what shows the current climbing to
   meet a new load. The line is the mean output voltage per period, which is
   what shows the dip and the ringing that follows it. Both are per-period
   summaries rather than samples: at this scale a switching ripple would be a
   solid block of ink and would say nothing.

   The x axis is the period index, spaced by the display schedule rather than
   linearly — early periods are where the interesting part is, and a settle
   that takes a thousand periods spends nine hundred of them nearly still. */

const W = 700, H = 96, PAD_L = 62, PAD_R = 14, TOP = 16, BOT = 20;

export function TransientStrip({ tr, index, onIndex, playing, label }) {
  if (!tr || !tr.env.length) return null;
  const env = tr.env;
  const n = env.length;

  /* Ranges. The voltage band is padded so a small ripple does not fill the
     pane and read as a catastrophe. */
  let vLo = Infinity, vHi = -Infinity, iLo = Infinity, iHi = -Infinity;
  for (const e of env) {
    if (e.vMean < vLo) vLo = e.vMean;
    if (e.vMean > vHi) vHi = e.vMean;
    if (e.iMin < iLo) iLo = e.iMin;
    if (e.iMax > iHi) iHi = e.iMax;
  }
  const vPad = Math.max((vHi - vLo) * 0.18, Math.abs(vHi) * 1e-3, 1e-9);
  vLo -= vPad; vHi += vPad;
  const iPad = Math.max((iHi - iLo) * 0.12, 1e-9);
  iLo -= iPad; iHi += iPad;

  /* Period index → x. Compressed the same way the schedule is, so the
     cursor moves evenly as the figure steps and the early detail is legible.
     A linear axis would crush the entire interesting part into the first
     pixel of a thousand-period settle. */
  const warp = (p) => Math.log1p(p) / Math.log1p(Math.max(n - 1, 1));
  const X = (p) => PAD_L + warp(p) * (W - PAD_L - PAD_R);
  const YV = (v) => TOP + (1 - (v - vLo) / (vHi - vLo || 1)) * (H - TOP - BOT);
  const YI = (i) => TOP + (1 - (i - iLo) / (iHi - iLo || 1)) * (H - TOP - BOT);

  const band = [];
  for (let p = 0; p < n; p++) band.push(`${p ? "L" : "M"} ${X(p).toFixed(1)} ${YI(env[p].iMax).toFixed(1)}`);
  for (let p = n - 1; p >= 0; p--) band.push(`L ${X(p).toFixed(1)} ${YI(env[p].iMin).toFixed(1)}`);
  const bandD = band.join(" ") + " Z";
  const vD = env.map((e, p) => `${p ? "L" : "M"} ${X(p).toFixed(1)} ${YV(e.vMean).toFixed(1)}`).join(" ");

  const at = tr.schedule[Math.max(0, Math.min(tr.schedule.length - 1, index))];
  const cx = X(at);
  const settledX = X(Math.min(tr.settled, n - 1));

  /* Dragging anywhere on the strip moves the cursor to the nearest displayed
     period — the schedule is what the figure can actually show, so snapping
     to it means the cursor never points at a period the figure is not
     drawing. */
  const pick = (ev) => {
    if (!onIndex) return;
    const box = ev.currentTarget.getBoundingClientRect();
    const t = (ev.clientX - box.left) / box.width;
    const px = PAD_L + t * (W - PAD_L - PAD_R);
    let best = 0, bd = Infinity;
    for (let k = 0; k < tr.schedule.length; k++) {
      const d = Math.abs(X(tr.schedule[k]) - px);
      if (d < bd) { bd = d; best = k; }
    }
    onIndex(best);
  };

  return drawScope("tsp", () => (
    <div className="tstrip">
      <div className="tshead">
        <span className="tstitle">{label}</span>
        <span className="tsfacts">
          <b>{tr.settled}</b> periods to settle · <b>{eng(tr.settled * tr.period, "s")}</b>
          {" · period "}<b>{at + 1}</b> of {n}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`Settling response: ${tr.settled} switching periods, `
          + `output from ${eng(env[0].vMean, "V")} to ${eng(env[n - 1].vMean, "V")}`}
        onMouseDown={pick} onMouseMove={(e) => e.buttons === 1 && pick(e)}
        style={{ cursor: "ew-resize", display: "block" }}>
        {/* where it ends up, so the dip has something to be measured against */}
        <path key={nk()} className="tsref" d={`M ${PAD_L} ${YV(env[n - 1].vMean).toFixed(1)} H ${W - PAD_R}`} />
        <path key={nk()} className="tsband" d={bandD} />
        <path key={nk()} className="tsv" d={vD} />
        {tr.settled < n ? (
          <path key={nk()} className="tssettled" d={`M ${settledX.toFixed(1)} ${TOP} V ${H - BOT}`} />
        ) : null}
        <path key={nk()} className="tscur" d={`M ${cx.toFixed(1)} ${TOP - 4} V ${H - BOT + 4}`} />
        <circle key={nk()} className="tscurdot" cx={cx.toFixed(1)} cy={YV(env[at].vMean).toFixed(1)} r={3.4} />
        {Tx(PAD_L - 8, YV(env[n - 1].vMean) + 3.5, eng(env[n - 1].vMean, "V"), { a: "end", c: "#5AD1DE", s: 10 })}
        {Tx(PAD_L - 8, YI(iHi) + 10, eng(iHi, "A"), { a: "end", c: "#6FD39B", s: 10 })}
        {Tx(PAD_L, H - 6, "step", { c: "#5C6E82", s: 9.5 })}
        {Tx(W - PAD_R, H - 6, `${n} periods`, { a: "end", c: "#5C6E82", s: 9.5 })}
      </svg>
      <input type="range" className="tsscrub" min={0} max={tr.schedule.length - 1} step={1}
        value={index} aria-label="Period within the settling response"
        onChange={(e) => onIndex && onIndex(+e.target.value)} />
      <p className="flownote tsnote">
        The figure above is drawing period <b>{at + 1}</b>. Drag to move through the
        settle{playing ? " — or wait, it is playing through" : ""}.
      </p>
    </div>
  ));
}
