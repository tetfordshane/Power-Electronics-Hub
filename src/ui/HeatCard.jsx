import React, { useState, useMemo } from "react";
import { eng, pct, clamp } from "../format.js";
import { FIELDS } from "../fields.js";
import { Tx, drawScope } from "../schematic/parts.jsx";

/* =====================================================================
   Design-space map.

   Every card on this page answers "what happens at the operating point I
   typed in". This one answers the question a designer actually has next:
   how much of the surrounding space is any good, and which way is uphill.

   It re-runs the topology's own design() across a grid of input voltage
   against load — so the map can never drift away from the numbers in the
   panel above, because it is the same code — and colours each cell by
   efficiency or by total loss.

   Colour is a single-hue sequential ramp, light-to-dark inverted for a
   dark surface: near-surface = worst, brightest = best. Both ramps were
   checked with the palette validator against this card's surface
   (#16202C) — monotone lightness, visible step gaps, and the near-surface
   end still clearing 2:1 so no cell disappears into the background.    */
const HM_GOOD = ["#2A5C48", "#2F7057", "#358566", "#3D9B78", "#4EB289", "#69C99F", "#8FDEB8"];
const HM_BAD = ["#684A25", "#815B2F", "#9A6E3B", "#B4854A", "#CB9E5F", "#DFB87E", "#F0D2A6"];
const rampAt = (ramp, t) => ramp[clamp(Math.floor(t * ramp.length), 0, ramp.length - 1)];

/* Which spec keys a topology sweeps. Voltage axis first, load axis second. */
function sweepAxes(topo, spec) {
  const f = new Set(topo.fields || []);
  let vKey = null, vLo = 0, vHi = 0, vLabel = "";
  if (f.has("vinMin") && f.has("vinMax") && spec.vinMax > spec.vinMin) {
    vKey = "vinNom"; vLo = spec.vinMin; vHi = spec.vinMax; vLabel = "input voltage · V";
  } else if (f.has("vacMin") && f.has("vacMax") && spec.vacMax > spec.vacMin) {
    vKey = "vacMin"; vLo = spec.vacMin; vHi = spec.vacMax; vLabel = "line voltage · Vrms";
  } else if (f.has("vacIn")) {
    vKey = "vacIn"; vLo = spec.vacIn * 0.85; vHi = spec.vacIn * 1.15; vLabel = "line voltage · Vrms";
  } else if (f.has("vinNom")) {
    vKey = "vinNom"; vLo = spec.vinNom * 0.8; vHi = spec.vinNom * 1.2; vLabel = "input voltage · V";
  } else if (f.has("vdc")) {
    vKey = "vdc"; vLo = spec.vdc * 0.8; vHi = spec.vdc * 1.2; vLabel = "DC link · V";
  } else if (f.has("vsec")) {
    vKey = "vsec"; vLo = spec.vsec * 0.8; vHi = spec.vsec * 1.2; vLabel = "secondary square · V";
  } else if (f.has("vout")) {
    vKey = "vout"; vLo = spec.vout * 0.6; vHi = spec.vout * 1.6; vLabel = "output voltage · V";
  }
  let lKey = null, lLabel = "";
  if (f.has("iout")) { lKey = "iout"; lLabel = "load · A"; }
  else if (f.has("pout")) { lKey = "pout"; lLabel = "load · W"; }
  else if (f.has("idc")) { lKey = "idc"; lLabel = "load · A"; }
  if (!vKey || !lKey || !(vHi > vLo)) return null;
  return { vKey, vLo, vHi, vLabel, lKey, lFull: spec[lKey], lLabel };
}

/* Pull an efficiency out of whatever the topology reports. Prefers a real
   loss budget; falls back to a stated efficiency in the highlights. */
function readEta(res, pout) {
  if (!res) return null;
  const loss = (res.loss || []).reduce((a, b) => a + (isFinite(b[1]) && b[1] > 0 ? b[1] : 0), 0);
  if (loss > 0 && pout > 0) return { eta: pout / (pout + loss), loss };
  const hi = (res.hi || []).find((h) => /efficiency|η/i.test(h[0]));
  if (hi) {
    const v = parseFloat(String(hi[1]).replace("%", ""));
    if (isFinite(v) && v > 0 && pout > 0) {
      const e = v > 1 ? v / 100 : v;
      return { eta: e, loss: pout * (1 / e - 1) };
    }
  }
  return null;
}

function outPower(topo, spec, res) {
  /* a design may know its own output power better than the inputs do —
     a charge pump's output voltage is a result, not a specification */
  if (res && isFinite(res.pout) && res.pout > 0) return res.pout;
  if (spec.pout) return spec.pout;
  if (spec.vout && spec.iout) return Math.abs(spec.vout) * spec.iout;
  /* rectifier secondaries state a square-wave amplitude and a duty rather
     than an output voltage */
  if (spec.vsec && spec.dnom && spec.iout) return spec.vsec * spec.dnom * spec.iout;
  if (spec.vacIn && spec.idc) return spec.vacIn * Math.SQRT2 * spec.idc;
  return 0;
}

function HeatCard({ topo, spec }) {
  const [mode, setMode] = useState("eta");
  const [hover, setHover] = useState(null);
  /* The keyboard's own cursor over the grid, as {i,j}, or null when the map
     is not being explored by key. It is deliberately separate from `hover`:
     the two pointers can be in different places, and a mouse that leaves
     should not take the keyboard's position with it. */
  const [kb, setKb] = useState(null);
  const axes = useMemo(() => sweepAxes(topo, spec), [topo, spec]);

  const grid = useMemo(() => {
    if (!axes || !topo.design) return null;
    const NX = 22, NY = 14, cells = [];
    let lo = Infinity, hi = -Infinity, any = false;
    for (let j = 0; j < NY; j++) {
      /* load from 10 % to 105 % of the design point, bottom row heaviest */
      const lf = 0.1 + (0.95 * (NY - 1 - j)) / (NY - 1);
      for (let i = 0; i < NX; i++) {
        const v = axes.vLo + ((axes.vHi - axes.vLo) * i) / (NX - 1);
        const s = { ...spec, [axes.vKey]: v, [axes.lKey]: axes.lFull * lf };
        let r = null;
        try { r = topo.design(s); } catch (e) { r = null; }
        const po = outPower(topo, s, r);
        const m = readEta(r, po);
        const val = m ? (mode === "eta" ? m.eta : m.loss) : null;
        const ok = m && isFinite(val) && val > 0 && (mode !== "eta" || val <= 1);
        if (ok) { any = true; lo = Math.min(lo, val); hi = Math.max(hi, val); }
        cells.push({ i, j, v, load: axes.lFull * lf, val: ok ? val : null,
          eta: m ? m.eta : null, loss: m ? m.loss : null,
          warn: r && r.warn && r.warn.length ? r.warn.length : 0 });
      }
    }
    if (!any) return null;
    if (hi - lo < 1e-9) { hi = lo * 1.0001 + 1e-9; }
    return { cells, NX, NY, lo, hi };
  }, [axes, topo, spec, mode]);

  /* The card is always present, even when it cannot draw. An absent
     feature that simply vanishes is indistinguishable from a broken one —
     which is exactly how the EMC lens used to behave on 18 of 30 pages. */
  if (!axes || !grid) {
    return (
      <div className="card">
        <h3 className="eyebrow">Design space · how the operating point behaves when it moves</h3>
        <p style={{ marginBottom: 0 }}>
          {!axes
            ? "This topology does not expose an input-voltage range and a load together, so there is no two-dimensional space to sweep."
            : "This topology has no loss model yet, so there is nothing to colour the map with. The equations and stresses below are unaffected — only the efficiency surface is missing."}
        </p>
      </div>
    );
  }

  const x0 = 60, x1 = 620, y0 = 26, y1 = 168;
  const cw = (x1 - x0) / grid.NX, ch = (y1 - y0) / grid.NY;
  /* efficiency: high is good. loss: high is bad, so invert the ramp so
     "bright" always means "the direction you want to move". */
  const ramp = mode === "eta" ? HM_GOOD : HM_BAD;
  const colorOf = (val) => {
    if (val === null) return "#1A2430";
    const t = (val - grid.lo) / (grid.hi - grid.lo);
    return rampAt(ramp, mode === "eta" ? t : 1 - t);
  };
  const fmt = (v) => (mode === "eta" ? pct(v) : eng(v, "W"));

  /* mark where the panel above is actually sitting */
  const opX = x0 + ((clamp(spec[axes.vKey], axes.vLo, axes.vHi) - axes.vLo)
    / (axes.vHi - axes.vLo)) * (x1 - x0);
  const opY = y0 + ch * 0.5;                      /* full load = top-ish row */
  const opRow = grid.NY - 1 - Math.round(((1 - 0.1) / 0.95) * (grid.NY - 1));
  const opYc = y0 + (clamp(opRow, 0, grid.NY - 1) + 0.5) * ch;

  /* 308 cells, and every one of them was reachable only by pointing at it.
     Making each a tab stop would be 308 stops to cross one card, so the map
     takes a single stop and the arrows move one cursor inside it — the same
     bargain a spreadsheet makes. */
  const cellAt = (i, j) => grid.cells[j * grid.NX + i];
  const kbCell = kb ? cellAt(kb.i, kb.j) : null;
  /* The mouse wins while it is over the map: it is the more recent intent,
     and the tooltip can only be in one place. */
  const shown = hover || kbCell;
  /* Entering the map lands on the design the panel above describes, rather
     than in a corner — the reader starts where they already are and moves
     out from it. */
  const startCell = {
    i: clamp(Math.round((opX - x0) / cw - 0.5), 0, grid.NX - 1),
    j: clamp(opRow, 0, grid.NY - 1),
  };
  /* Spoken, not drawn, so it carries the units the tooltip gets from the axis
     captions beside it — "12 V in, 9.8 A load" rather than a pair of bare
     numbers a listener has no way to place. */
  const vUnit = (axes.vLabel.split(" · ")[1] || "").trim();
  const lUnit = (axes.lLabel.split(" · ")[1] || "").trim();
  const describe = (c) =>
    (c.val === null ? "no solution" : fmt(c.val))
    + " at " + eng(c.v, vUnit).trim() + " in, " + eng(c.load, lUnit).trim() + " load"
    + (c.warn ? ", " + c.warn + " warning" + (c.warn > 1 ? "s" : "") : "");
  const onKey = (e) => {
    if (e.key === "Escape") { setKb(null); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    if (!kb) { setKb(startCell); return; }
    let { i, j } = kb;
    if (e.key === "ArrowLeft") i -= 1;
    else if (e.key === "ArrowRight") i += 1;
    else if (e.key === "ArrowUp") j -= 1;
    else if (e.key === "ArrowDown") j += 1;
    else if (e.key === "Home") i = 0;
    else i = grid.NX - 1;
    setKb({ i: clamp(i, 0, grid.NX - 1), j: clamp(j, 0, grid.NY - 1) });
  };

  return (
    <div className="card">
      <h3 className="eyebrow">Design space · how the operating point behaves when it moves</h3>
      <div className="ctl" style={{ margin: "0 0 12px" }} role="group" aria-label="Map quantity">
        <button className={mode === "eta" ? "on" : ""} onClick={() => setMode("eta")}
          aria-pressed={mode === "eta"}>efficiency</button>
        <button className={mode === "loss" ? "on" : ""} onClick={() => setMode("loss")}
          aria-pressed={mode === "loss"}>total loss</button>
      </div>
      <div className="hmwrap">
        <div className="sch">
          <svg viewBox="0 0 660 200" style={{ width: "100%", height: "auto", display: "block" }} role="img"
            aria-label={(mode === "eta" ? "Efficiency" : "Total loss") + " across "
              + axes.vLabel.replace(/ · .*$/, "") + " and " + axes.lLabel.replace(/ · .*$/, "")
              + ", " + grid.NX + " by " + grid.NY + " cells."
              + " Arrow keys explore the map, Escape leaves it."}
            tabIndex={0} onKeyDown={onKey} onBlur={() => setKb(null)}
            onMouseLeave={() => setHover(null)}>
            {drawScope("hm", () => (<>
              <g className="hmgrid">
                {grid.cells.map((c) => (
                  <rect key={c.j * grid.NX + c.i}
                    className={"hmcell" + (kb && kb.i === c.i && kb.j === c.j ? " kb" : "")}
                    x={x0 + c.i * cw} y={y0 + c.j * ch}
                    width={cw + 0.6} height={ch + 0.6}
                    fill={colorOf(c.val)}
                    onMouseEnter={() => setHover(c)}
                    style={{ cursor: "crosshair" }} />
                ))}
              </g>
              {/* the point the panel above describes */}
              <circle className="hmop" cx={opX} cy={opYc} r={5.5} />
              <circle className="hmop2" cx={opX} cy={opYc} r={5.5} />
              {Tx(clamp(opX, x0 + 4, x1 - 76), opYc - 11, "your design",
                { c: "#E6EDF5", s: 9.5, a: "start" })}
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                <g key={"xt" + i}>
                  {Tx(x0 + t * (x1 - x0), y1 + 15,
                    eng(axes.vLo + t * (axes.vHi - axes.vLo), ""), { c: "#5C6E82", s: 9.5, a: "middle" })}
                </g>
              ))}
              {[1, 0.55, 0.1].map((lf, i) => (
                <g key={"yt" + i}>
                  {Tx(x0 - 8, y0 + ((1 - (lf - 0.1) / 0.95) * (y1 - y0)) + 3.5,
                    eng(axes.lFull * lf, ""), { c: "#5C6E82", s: 9.5, a: "end" })}
                </g>
              ))}
              {Tx((x0 + x1) / 2, 196, axes.vLabel, { c: "#8DA0B4", s: 10.5, a: "middle" })}
              {Tx(x0 - 8, y0 - 10, axes.lLabel, { c: "#8DA0B4", s: 10.5, a: "start" })}
            </>))}
          </svg>
        </div>
        {shown ? (
          <div className="hmtip" style={{
            left: `calc(${((x0 + shown.i * cw + cw / 2) / 660) * 100}% + ${shown.i > grid.NX / 2 ? -170 : 12}px)`,
            top: `${((y0 + shown.j * ch) / 200) * 100}%`,
          }}>
            <div><b>{shown.val === null ? "no solution" : fmt(shown.val)}</b></div>
            <em>
              {eng(shown.v, "")} in · {eng(shown.load, "")} load
              {shown.eta !== null && mode === "loss" ? " · η " + pct(shown.eta) : ""}
              {shown.loss !== null && mode === "eta" ? " · " + eng(shown.loss, "W") + " lost" : ""}
              {shown.warn ? " · " + shown.warn + " warning" + (shown.warn > 1 ? "s" : "") : ""}
            </em>
          </div>
        ) : null}
        {/* Only the keyboard cursor is announced. Putting the live region on
            the tooltip itself would have every mouse traverse read out 308
            cells, which is not a reading of the map so much as a denial of
            service on it. */}
        <div className="vh" role="status" aria-live="polite">
          {kbCell ? describe(kbCell) : ""}
        </div>
      </div>
      <div className="hmscale">
        <span>{fmt(mode === "eta" ? grid.lo : grid.hi)}</span>
        <div className="hmbar" style={{
          background: "linear-gradient(90deg," + (mode === "eta" ? ramp : [...ramp].reverse()).join(",") + ")",
        }} />
        <span>{fmt(mode === "eta" ? grid.hi : grid.lo)}</span>
        <span style={{ fontFamily: "var(--ui)", marginLeft: 4 }}>
          brighter is better in both views
        </span>
      </div>
      <p className="flownote">
        Each cell re-runs this topology's own design equations at that input voltage and load, so
        the map and the panel above can never disagree. Read the gradient, not the absolute number:
        it shows you which way efficiency improves as the operating point drifts, and where the
        design falls off a cliff. Cells with no fill are operating points this topology cannot reach.
      </p>
    </div>
  );
}

export { sweepAxes, readEta, outPower, HeatCard };
