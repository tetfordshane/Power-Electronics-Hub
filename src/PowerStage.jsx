import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";

/* =====================================================================
   POWER STAGE — interactive designer + cheat sheet
   ===================================================================== */

import { CSS } from "./styles.js";
import { Eq, Mx, Sub, Mixed } from "./tex.jsx";
import { buildCycle, cycleKey, isDCM } from "./cycle.js";
import { polySegs, arrowsAt, coilSplice } from "./flowgeo.js";

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

/* Reads the OS motion preference and keeps listening, so toggling it in
   system settings takes effect without a reload. */
function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = (e) => setReduce(e.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return reduce;
}

/* Maths typesetting lives in tex.jsx: it parses the linear notation used
   throughout the topology data and hands real LaTeX to KaTeX.          */

/* ------------------------ schematic primitives ------------------------ */
const WS = { stroke:"#8296AB", strokeWidth:1.7, fill:"none", strokeLinecap:"round", strokeLinejoin:"round" };
const FILL = "#8296AB";
/* ---------------------------------------------------------------------
   Element keys.

   Every figure re-runs its draw functions on each animation frame. When
   the keys changed from frame to frame, React could not match the old
   nodes to the new ones, so it tore the whole SVG down and rebuilt it
   sixty times a second. Two things followed: the CSS transitions on
   .hot/.cold and .lever never fired (a freshly mounted element has no
   previous value to animate from, so state changes snapped instead of
   easing), and the constant DOM churn is what made the loop feel jerky.

   drawScope gives each drawing surface its own key namespace, restarting
   at zero. Because a surface issues the same calls in the same order every
   frame, each element keeps its key for the life of the figure and React
   can diff instead of remount.                                          */
let _k = 0, _kp = "k";
const nk = () => _kp + (_k++);
const drawScope = (prefix, fn) => {
  const pp = _kp, pv = _k;
  _kp = prefix; _k = 0;
  try { return fn(); } finally { _kp = pp; _k = pv; }
};

const W  = (d) => <path key={nk()} d={d} style={WS} />;
const Dot = (x, y) => <circle key={nk()} cx={x} cy={y} r={3} fill={FILL} />;
/* SVG cannot host KaTeX, so labels inside figures are set here instead:
   the "X_sub" notation is split into a baseline run and a real <tspan>
   subscript, which is the difference between "V_out" and V₍ₒᵤₜ₎ on a
   drawing that is meant to look like a schematic, not like source code. */
const SUBTX = /([A-Za-zΑ-Ωα-ωΔµ]+)_([A-Za-z0-9]+(?:\([a-z]+\))?)/g;
const subParts = (t) => {
  const s = String(t);
  if (s.indexOf("_") < 0) return s;
  const out = []; let last = 0, m;
  SUBTX.lastIndex = 0;
  while ((m = SUBTX.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1]);
    out.push({ sub: m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
};
/* How wide a label will actually be, in the mono face the figures use.

   Counting characters overestimates anything with a subscript by nearly half
   — "v_SW" is four characters and about two and a half glyph widths — which
   was enough to push the unit set beside it clear off into the plot. The mono
   advance is 0.6 em, and subParts already knows which runs are subscript. */
const txWidth = (t, s = 11.5) => {
  const parts = subParts(t);
  const adv = s * 0.6;
  if (typeof parts === "string") return parts.length * adv;
  let w = 0;
  for (const p of parts) w += typeof p === "string" ? p.length * adv : p.sub.length * adv * 0.72;
  return w;
};
const Tx = (x, y, t, o = {}) => {
  const parts = subParts(t);
  const size = o.s || 11.5;
  return (
    <text key={nk()} x={x} y={y} fill={o.c || "#8DA0B4"} fontSize={size}
      fontFamily='"JetBrains Mono Variable","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace'
      textAnchor={o.a || "start"} fontWeight={o.b ? 600 : 400}
      style={{ fontVariantNumeric: "tabular-nums" }}>
      {typeof parts === "string" ? parts : parts.map((p, i) => (
        typeof p === "string"
          ? <React.Fragment key={i}>{p}</React.Fragment>
          : <tspan key={i} fontSize={size * 0.72} dy={size * 0.22}
              >{p.sub}<tspan dy={-size * 0.22} fontSize={size}>{"​"}</tspan></tspan>
      ))}
    </text>
  );
};

/* ---------------------------------------------------------------------
   The coil registry.

   The flow overlay needs to know where every winding sits so it can route
   its dashes over the arcs instead of under them (see coilSplice in
   flowgeo.js). Listing those extents by hand in FLOW would be a second
   copy of the schematic that drifts; instead the inductor helpers record
   themselves while the schematic draws. FlowCard opens the capture around
   its one SCH call, so the registry is exactly what is on screen —
   transformer windings included, which is right: a path that genuinely
   traverses a winding end-to-end (a push-pull primary half) should climb
   through it, and one that stops at a winding terminal (every isolated
   secondary) never satisfies the splice's full-containment rule anyway. */
const COILS = {};
let coilCapture = null;

/* inductor: horizontal (n arcs of radius r) */
const Lh = (x, y, n = 4, r = 9, b = 1) => {
  if (coilCapture) coilCapture.push({ axis: "h", y, x0: x, x1: x + 2 * n * r, r, n, bulge: b });
  let d = `M ${x} ${y}`;
  for (let i = 0; i < n; i++) d += ` a ${r} ${r} 0 0 ${b > 0 ? 1 : 0} ${2 * r} 0`;
  return <path key={nk()} d={d} style={WS} />;
};
/* horizontal wire x1->x2 with crossover hops at the given x positions */
const HopW = (x1, x2, y, hops = []) => {
  let d = `M ${x1} ${y}`;
  [...hops].sort((a, b) => a - b).forEach((h) => { d += ` H ${h - 6} a 6 6 0 0 1 12 0`; });
  return <path key={nk()} d={d + ` H ${x2}`} style={WS} />;
};
/* vertical wire y1->y2 with crossover hops at the given y positions */
const VW = (x, y1, y2, hops = []) => {
  const dn = y2 > y1;
  let d = `M ${x} ${y1}`;
  [...hops].sort((a, b) => (dn ? a - b : b - a)).forEach((h) => {
    d += ` V ${dn ? h - 6 : h + 6} a 6 6 0 0 1 0 ${dn ? 12 : -12}`;
  });
  return <path key={nk()} d={d + ` V ${y2}`} style={WS} />;
};
/* inductor: vertical. bulge=+1 right, -1 left */
const Lv = (x, y, n = 4, r = 9, bulge = 1) => {
  if (coilCapture) coilCapture.push({ axis: "v", x, y0: y, y1: y + 2 * n * r, r, n, bulge });
  let d = `M ${x} ${y}`;
  for (let i = 0; i < n; i++) d += ` a ${r} ${r} 0 0 ${bulge > 0 ? 1 : 0} 0 ${2 * r}`;
  return <path key={nk()} d={d} style={WS} />;
};
/* capacitor between (x,y1)-(x,y2), plates horizontal */
const Cv = (x, y1, y2) => {
  const m = (y1 + y2) / 2;
  return <g key={nk()}>
    {W(`M ${x} ${y1} V ${m - 4}`)}{W(`M ${x - 11} ${m - 4} H ${x + 11}`)}
    {W(`M ${x - 11} ${m + 4} H ${x + 11}`)}{W(`M ${x} ${m + 4} V ${y2}`)}
  </g>;
};
/* capacitor between (x1,y)-(x2,y), plates vertical */
const Ch = (x1, x2, y) => {
  const m = (x1 + x2) / 2;
  return <g key={nk()}>
    {W(`M ${x1} ${y} H ${m - 4}`)}{W(`M ${m - 4} ${y - 11} V ${y + 11}`)}
    {W(`M ${m + 4} ${y - 11} V ${y + 11}`)}{W(`M ${m + 4} ${y} H ${x2}`)}
  </g>;
};
/* resistor between (x,y1)-(x,y2) */
const Rv = (x, y1, y2) => {
  const m = (y1 + y2) / 2;
  return <g key={nk()}>
    {W(`M ${x} ${y1} V ${m - 15}`)}
    <rect key={nk()} x={x - 8} y={m - 15} width={16} height={30} rx={1.5} style={WS} />
    {W(`M ${x} ${m + 15} V ${y2}`)}
  </g>;
};
const Rh = (x1, x2, y) => {
  const m = (x1 + x2) / 2;
  return <g key={nk()}>
    {W(`M ${x1} ${y} H ${m - 15}`)}
    <rect key={nk()} x={m - 15} y={y - 8} width={30} height={16} rx={1.5} style={WS} />
    {W(`M ${m + 15} ${y} H ${x2}`)}
  </g>;
};
/* diode: current flows y1 -> y2 (vertical) */
const Dv = (x, y1, y2) => {
  const m = (y1 + y2) / 2, s = y2 < y1 ? -1 : 1;
  return <g key={nk()}>
    {W(`M ${x} ${y1} V ${m - 5 * s}`)}
    <path key={nk()} d={`M ${x - 8} ${m - 5 * s} L ${x + 8} ${m - 5 * s} L ${x} ${m + 5 * s} Z`} fill={FILL} />
    {W(`M ${x - 9} ${m + 5 * s} H ${x + 9}`)}
    {W(`M ${x} ${m + 5 * s} V ${y2}`)}
  </g>;
};
/* diode: current flows x1 -> x2 (horizontal) */
const Dh = (x1, x2, y) => {
  const m = (x1 + x2) / 2, s = x2 < x1 ? -1 : 1;
  return <g key={nk()}>
    {W(`M ${x1} ${y} H ${m - 5 * s}`)}
    <path key={nk()} d={`M ${m - 5 * s} ${y - 8} L ${m - 5 * s} ${y + 8} L ${m + 5 * s} ${y} Z`} fill={FILL} />
    {W(`M ${m + 5 * s} ${y - 9} V ${y + 9}`)}
    {W(`M ${m + 5 * s} ${y} H ${x2}`)}
  </g>;
};
/* n-channel MOSFET. rot 0 = drain up / source down, gate to the left */
const Q = (x, y, rot = 0, lead = 20) => (
  <g key={nk()} transform={`translate(${x},${y}) rotate(${rot})`}>
    {W(`M 0 ${-lead} V -9 M -5 -9 H 0`)}
    {W(`M 0 ${lead} V 9 M -5 9 H 0`)}
    {W(`M -5 -13 V -5 M -5 -2.5 V 2.5 M -5 5 V 13`)}
    {W(`M -10 -14 V 14`)}
    {W(`M -10 0 H -22`)}
    {W(`M -5 0 H 0 M 0 -9 V 9`)}
    <path key={nk()} d="M -5 0 L 0.5 -3.6 L 0.5 3.6 Z" fill={FILL} />
  </g>
);
/* transformer: primary coil at x, secondary at x+30, core between */
const Xf = (x, y, h = 64, sd = 0) => {
  const n = 4, r = h / (2 * n);
  return <g key={nk()}>
    {Lv(x, y, n, r, -1)}
    {W(`M ${x + 9} ${y - 4} V ${y + h + 4}`)}
    {W(`M ${x + 15} ${y - 4} V ${y + h + 4}`)}
    {Lv(x + 24, y, n, r, 1)}
    <circle key={nk()} cx={x - 13} cy={y + 4} r={2.6} fill="#E0A458" />
    <circle key={nk()} cx={x + 37} cy={sd ? y + h - 4 : y + 4} r={2.6} fill="#E0A458" />
  </g>;
};
/* port terminal */
const Port = (x, y, t, side = "l") => (
  <g key={nk()}>
    <circle key={nk()} cx={x} cy={y} r={3.6} style={{ ...WS, fill: "#121A24" }} />
    {Tx(side === "l" ? x - 8 : x + 8, y + 4, t, { a: side === "l" ? "end" : "start", c: "#E4ECF4", b: 1 })}
  </g>
);
const Gnd = (x, y) => (
  <g key={nk()}>
    {W(`M ${x} ${y} V ${y + 7}`)}{W(`M ${x - 10} ${y + 7} H ${x + 10}`)}
    {W(`M ${x - 6} ${y + 11} H ${x + 6}`)}{W(`M ${x - 2.5} ${y + 15} H ${x + 2.5}`)}
  </g>
);
const SV = ({ children, w = 660, h = 240 }) => (
  <div className="sch"><svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}
    role="img">{children}</svg></div>
);

/* ------------------------------ schematics ------------------------------ */
const P = (x, y, t, o = {}) => Tx(x, y, t, { c: "#C0894B", ...o });
const N = (x, y, t, o = {}) => Tx(x, y, t, { c: "#5AD1DE", ...o });
const ISO = (x, y1, y2) => (
  <path key={nk()} d={`M ${x} ${y1} V ${y2}`} stroke="#E0A458" strokeWidth={1.2}
    strokeDasharray="4 6" opacity=".5" fill="none" />
);
/* half-bridge leg: two devices between yT and yB with the midpoint at mid */
const Leg = (x, yT, yB, mid, la, lb) => {
  const a = mid - 45, b = mid + 45;
  return <g key={nk()}>
    {W(`M ${x} ${yT} V ${a - 20}`)}{Q(x, a, 0, 20)}{W(`M ${x} ${a + 20} V ${b - 20}`)}
    {Q(x, b, 0, 20)}{W(`M ${x} ${b + 20} V ${yB}`)}
    {P(x + 10, a - 2, la)}{P(x + 10, b - 2, lb)}
  </g>;
};

/* AC source */
const AC = (x, y, r = 16) => (
  <g key={nk()}>
    <circle key={nk()} cx={x} cy={y} r={r} style={WS} />
    {W(`M ${x - 9} ${y} q 4.5 -7.5 9 0 q 4.5 7.5 9 0`)}
  </g>
);
/* centre-tapped transformer: primary at x, two secondary halves at x+24 */
const XfCT = (x, y, h = 80) => {
  const r = h / 8;
  return <g key={nk()}>
    {Lv(x, y, 4, r, -1)}
    {W(`M ${x + 9} ${y - 4} V ${y + h + 4}`)}{W(`M ${x + 15} ${y - 4} V ${y + h + 4}`)}
    {Lv(x + 24, y, 2, r, 1)}{Lv(x + 24, y + h / 2, 2, r, 1)}
    <circle key={nk()} cx={x - 13} cy={y + 4} r={2.6} fill="#E0A458" />
    <circle key={nk()} cx={x + 37} cy={y + 4} r={2.6} fill="#E0A458" />
    <circle key={nk()} cx={x + 37} cy={y + h / 2 + 4} r={2.6} fill="#E0A458" />
  </g>;
};

const SCH = {
halfwave: () => <SV w={620} h={230}>
  {AC(80, 120)}{P(80, 172, "v_ac", { a: "middle" })}
  {W("M 80 104 V 60 H 130")}{W("M 80 136 V 190 H 460")}
  {Dh(130, 210, 60)}{P(158, 48, "D1")}
  {W("M 210 60 H 520")}{Dot(300, 60)}{Dot(420, 60)}{N(262, 48, "V_dc")}
  {Cv(300, 60, 190)}{P(314, 130, "C")}
  {Rv(420, 60, 190)}{P(434, 130, "R_L")}
  {Dot(300, 190)}{Gnd(350, 190)}{Dot(350, 190)}
  {Port(520, 60, "V_out", "r")}
</SV>,

bridgerect: () => <SV w={620} h={250}>
  {AC(100, 130)}{P(100, 182, "v_ac", { a: "middle" })}
  {W("M 100 114 V 100 H 210")}
  {W("M 100 146 V 160")}{HopW(100, 310, 160, [210])}
  {Dv(210, 100, 55)}{P(220, 78, "D1")}
  {Dv(210, 205, 100)}{P(220, 176, "D2")}
  {Dv(310, 160, 55)}{P(320, 100, "D3")}
  {Dv(310, 205, 160)}{P(320, 190, "D4")}
  {W("M 210 55 H 560")}{Dot(310, 55)}{Dot(400, 55)}{Dot(490, 55)}{N(348, 44, "V_dc")}
  {W("M 210 205 H 490")}{Dot(310, 205)}{Dot(400, 205)}
  {Cv(400, 55, 205)}{P(414, 138, "C")}
  {Rv(490, 55, 205)}{P(504, 138, "R_L")}
  {Gnd(355, 205)}{Dot(355, 205)}
  {Port(560, 55, "V_out", "r")}
</SV>,

ctrect: () => <SV w={680} h={270}>
  {Port(55, 60, "a")}{W("M 55 60 H 190")}
  {Port(55, 140, "b")}{W("M 55 140 H 190")}
  {XfCT(190, 60, 80)}{ISO(207, 28, 245)}{P(150, 46, "n : 1 : 1", { a: "middle", s: 10.5 })}
  {W("M 214 60 H 260")}{Dh(260, 340, 60)}{P(286, 48, "D1")}
  {W("M 214 140 H 260")}{Dh(260, 340, 140)}{P(286, 128, "D2")}
  {W("M 340 60 V 140")}{Dot(340, 100)}{N(348, 116, "V_rect")}
  {W("M 214 100 H 240")}{VW(240, 100, 220, [140])}{W("M 240 220 H 560")}
  {Lh(340, 100)}{P(364, 80, "L_f")}
  {W("M 412 100 H 620")}{Dot(470, 100)}{Dot(560, 100)}
  {Cv(470, 100, 220)}{P(484, 166, "C_out")}
  {Rv(560, 100, 220)}{P(574, 166, "R_L")}
  {Dot(470, 220)}{Gnd(400, 220)}{Dot(400, 220)}
  {Port(620, 100, "V_out", "r")}
</SV>,

syncrect: () => <SV w={680} h={280}>
  {Port(55, 60, "a")}{W("M 55 60 H 190")}
  {Port(55, 140, "b")}{W("M 55 140 H 190")}
  {XfCT(190, 60, 80)}{ISO(207, 28, 252)}
  {W("M 214 60 H 310")}{Q(330, 60, -90, 20)}{P(300, 38, "SR1")}
  {W("M 214 140 H 310")}{Q(330, 140, -90, 20)}{P(300, 190, "SR2")}
  {VW(350, 60, 140, [100])}{W("M 350 140 V 230")}
  {W("M 214 100 H 400")}{Dot(214, 100)}{N(232, 92, "tap")}
  {Lh(400, 100)}{P(424, 84, "L_f")}
  {W("M 472 100 H 620")}{Dot(510, 100)}{Dot(575, 100)}
  {Cv(510, 100, 230)}{P(524, 172, "C_out")}
  {Rv(575, 100, 230)}{P(589, 172, "R_L")}
  {W("M 350 230 H 575")}{Dot(510, 230)}{Gnd(440, 230)}{Dot(440, 230)}
  {Port(620, 100, "V_out", "r")}
</SV>,

doubler: () => <SV w={700} h={300}>
  {Port(55, 80, "a")}{W("M 55 80 H 190")}
  {Port(55, 160, "b")}{W("M 55 160 H 190")}
  {Xf(190, 80, 80, 0)}{ISO(207, 46, 272)}
  {W("M 214 80 H 310")}{Dot(250, 80)}
  {Lh(310, 80)}{P(334, 64, "L1")}{W("M 382 80 H 470")}
  {W("M 214 160 V 200")}{HopW(214, 310, 200, [250])}{Dot(290, 200)}
  {Lh(310, 200)}{P(334, 226, "L2")}{W("M 382 200 H 470")}
  {Dv(250, 260, 80)}{P(258, 172, "D1")}
  {Dv(290, 260, 200)}{P(298, 240, "D2")}
  {W("M 470 80 V 200")}{Dot(470, 140)}{W("M 470 140 H 640")}
  {Dot(530, 140)}{Dot(595, 140)}
  {Cv(530, 140, 260)}{P(544, 208, "C_out")}
  {Rv(595, 140, 260)}{P(609, 208, "R_L")}
  {W("M 250 260 H 595")}{Dot(290, 260)}{Dot(530, 260)}{Gnd(400, 260)}{Dot(400, 260)}
  {Port(640, 140, "V_out", "r")}
</SV>,

classe: () => <SV w={660} h={250}>
  {Port(40, 60, "V_dc")}{W("M 40 60 H 90")}
  {Lh(90, 60)}{P(112, 44, "L_chk")}
  {W("M 162 60 H 400")}{Dot(230, 60)}{Dot(310, 60)}
  {W("M 230 60 V 105")}{Q(230, 130, 0, 25)}{P(248, 126, "Q1")}{W("M 230 155 V 205")}
  {N(240, 50, "v_ds")}
  {Cv(310, 60, 205)}{P(324, 138, "C_sh")}
  {Lh(400, 60)}{P(424, 44, "L_2")}
  {Ch(472, 540, 60)}{P(496, 44, "C_2")}
  {W("M 540 60 H 590")}{Rv(590, 60, 205)}{P(604, 138, "R_L")}
  {W("M 230 205 H 590")}{Dot(310, 205)}{Gnd(430, 205)}{Dot(430, 205)}
</SV>,

classepp: () => <SV w={660} h={300}>
  {Port(40, 150, "V_dc")}{W("M 40 150 H 70")}{W("M 70 60 V 240")}{Dot(70, 150)}
  {Lh(70, 60)}{P(94, 44, "L_chk")}
  {Lh(70, 240)}{P(94, 270, "L_chk")}
  {W("M 142 60 H 380")}{Dot(250, 60)}{Dot(310, 60)}
  {W("M 142 240 H 380")}{Dot(250, 240)}{Dot(310, 240)}
  {W("M 250 60 V 80")}{Q(250, 105, 0, 25)}{P(268, 102, "Q1")}{W("M 250 130 V 150")}
  {W("M 250 240 V 220")}{Q(250, 195, 180, 25)}{P(268, 202, "Q2")}{W("M 250 170 V 150")}
  {W("M 250 150 H 310")}{Dot(250, 150)}{Dot(310, 150)}{Gnd(282, 150)}
  {Cv(310, 60, 150)}{P(324, 108, "C_1")}
  {Cv(310, 150, 240)}{P(324, 198, "C_1")}
  {Lh(380, 60)}{P(404, 44, "L_2")}{Ch(452, 520, 60)}{P(476, 44, "C_2")}
  {Lh(380, 240)}{P(404, 270, "L_2")}{Ch(452, 520, 240)}{P(476, 270, "C_2")}
  {W("M 520 60 H 570")}{W("M 520 240 H 570")}
  {Rv(570, 60, 240)}{P(584, 145, "R_L")}
</SV>,

classde: () => <SV w={620} h={270}>
  {Port(40, 50, "V_dc")}{W("M 40 50 H 265")}{Dot(200, 50)}{Dot(265, 50)}
  {Cv(120, 50, 225)}{P(134, 142, "C_dc")}
  {Leg(200, 50, 225, 137, "Q1", "Q2")}
  {W("M 200 137 H 330")}{Dot(265, 137)}{N(214, 129, "sw")}
  {Cv(265, 50, 137)}{P(279, 98, "C_s")}
  {Cv(265, 137, 225)}{P(279, 188, "C_s")}
  {Lh(330, 137)}{P(354, 121, "L_r")}
  {Ch(402, 470, 137)}{P(426, 121, "C_r")}
  {W("M 470 137 H 520")}{Rv(520, 137, 225)}{P(534, 188, "R_ac")}
  {W("M 200 225 H 520")}{Dot(265, 225)}{Gnd(370, 225)}{Dot(370, 225)}
</SV>,

buck: () => <SV h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 150")}{Cv(88, 70, 200)}{P(102, 139, "C_in")}
  {Q(170, 70, -90)}{P(158, 40, "Q1")}
  {W("M 190 70 H 235")}{Dot(215, 70)}{N(204, 58, "SW")}
  {Dv(215, 200, 70)}{P(228, 139, "D1")}
  {Lh(235, 70)}{P(258, 48, "L")}
  {W("M 307 70 H 500")}{Dot(380, 70)}{Cv(380, 70, 200)}{P(394, 139, "C_out")}
  {Rv(480, 70, 200)}{P(494, 139, "R_L")}{N(430, 56, "V_out")}
  {W("M 40 200 H 480")}{Gnd(300, 200)}
</SV>,

syncbuck: () => <SV h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 150")}{Cv(88, 70, 200)}{P(102, 139, "C_in")}
  {Q(170, 70, -90)}{P(152, 40, "Q_HS")}
  {W("M 190 70 H 235")}{Dot(215, 70)}{N(200, 58, "SW")}
  {W("M 215 70 V 120")}{Q(215, 145, 0, 25)}{P(230, 116, "Q_LS")}{W("M 215 170 V 200")}
  {Lh(235, 70)}{P(258, 48, "L")}
  {W("M 307 70 H 500")}{Dot(380, 70)}{Cv(380, 70, 200)}{P(394, 139, "C_out")}
  {Rv(480, 70, 200)}{P(494, 139, "R_L")}{N(430, 56, "V_out")}
  {W("M 40 200 H 480")}{Gnd(300, 200)}
  {Tx(110, 232, "body diode conducts only during the dead time", { c: "#5C6E82", s: 10.5 })}
</SV>,

multiphase: () => <SV w={700} h={270}>
  {Port(30, 55, "V_in")}{W("M 30 55 H 370")}{Cv(70, 55, 235)}{P(84, 152, "C_in")}
  {Leg(170, 55, 235, 120, "Q1H", "Q1L")}
  {Leg(270, 55, 235, 135, "Q2H", "Q2L")}
  {Leg(370, 55, 235, 150, "Q3H", "Q3L")}
  {HopW(170, 410, 120, [270, 370])}{Lh(410, 120)}{W("M 482 120 H 520")}
  {HopW(270, 410, 135, [370])}{Lh(410, 135)}{W("M 482 135 H 520")}
  {W("M 370 150 H 410")}{Lh(410, 150)}{W("M 482 150 H 520")}
  {P(430, 104, "L1 / L2 / L3")}
  {W("M 520 120 V 150")}{Dot(520, 135)}{W("M 520 150 H 640")}
  {Cv(560, 150, 235)}{P(574, 200, "C_out")}{Rv(640, 150, 235)}{P(654, 200, "R_L")}
  {W("M 30 235 H 640")}{Gnd(460, 235)}{N(560, 138, "V_out")}
  {Tx(110, 262, "phases interleaved by 360°/N — ripple cancels at the output", { c: "#5C6E82", s: 10.5 })}
</SV>,

boost: () => <SV h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 110")}{Cv(80, 70, 200)}{P(94, 139, "C_in")}
  {Lh(110, 70)}{P(134, 48, "L")}
  {W("M 182 70 H 245")}{Dot(230, 70)}{N(214, 58, "SW")}
  {W("M 230 70 V 120")}{Q(230, 145, 0, 25)}{P(245, 116, "Q1")}{W("M 230 170 V 200")}
  {Dh(245, 330, 70)}{P(278, 56, "D1")}
  {W("M 330 70 H 500")}{Dot(390, 70)}{Cv(390, 70, 200)}{P(404, 139, "C_out")}
  {Rv(480, 70, 200)}{P(494, 139, "R_L")}{N(430, 56, "V_out")}
  {W("M 40 200 H 480")}{Gnd(320, 200)}
</SV>,

buckboost: () => <SV h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 150")}{Cv(88, 70, 200)}{P(102, 139, "C_in")}
  {Q(170, 70, -90)}{P(158, 40, "Q1")}
  {W("M 190 70 H 250")}{Dot(215, 70)}{N(200, 58, "SW")}
  {W("M 215 70 V 92")}{Lv(215, 92, 4, 9, 1)}{P(232, 132, "L")}{W("M 215 164 V 200")}
  {Dh(330, 250, 70)}{P(278, 56, "D1")}
  {W("M 330 70 H 500")}{Dot(400, 70)}{Cv(400, 70, 200)}{P(414, 139, "C_out")}
  {Rv(480, 70, 200)}{P(494, 139, "R_L")}{N(412, 56, "−V_out")}
  {W("M 40 200 H 480")}{Gnd(310, 200)}
  {Tx(110, 232, "output is negative with respect to the input return", { c: "#5C6E82", s: 10.5 })}
</SV>,

fsbb: () => <SV w={700} h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 150")}{Cv(88, 70, 200)}{P(102, 139, "C_in")}
  {Q(170, 70, -90)}{P(160, 40, "Q1")}
  {W("M 190 70 H 235")}{Dot(215, 70)}{N(196, 58, "SW1")}
  {W("M 215 70 V 120")}{Q(215, 145, 0, 25)}{P(230, 116, "Q2")}{W("M 215 170 V 200")}
  {Lh(235, 70)}{P(258, 48, "L")}
  {W("M 307 70 H 350")}{Dot(330, 70)}{N(312, 58, "SW2")}
  {W("M 330 70 V 120")}{Q(330, 145, 0, 25)}{P(345, 116, "Q3")}{W("M 330 170 V 200")}
  {Q(400, 70, -90)}{P(390, 40, "Q4")}
  {W("M 420 70 H 620")}{Dot(500, 70)}{Cv(500, 70, 200)}{P(514, 139, "C_out")}
  {Rv(600, 70, 200)}{P(614, 139, "R_L")}{N(548, 56, "V_out")}
  {W("M 40 200 H 600")}{Gnd(280, 200)}
  {Tx(110, 232, "buck mode: Q3 off, Q4 on · boost mode: Q1 on, Q2 off", { c: "#5C6E82", s: 10.5 })}
</SV>,

cuk: () => <SV w={700} h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 70")}{Lh(70, 70)}{P(96, 48, "L1")}
  {W("M 142 70 H 175")}{Dot(160, 70)}
  {W("M 160 70 V 120")}{Q(160, 145, 0, 25)}{P(175, 116, "Q1")}{W("M 160 170 V 200")}
  {Ch(175, 265, 70)}{P(206, 52, "C1")}
  {W("M 265 70 H 300")}{Dot(280, 70)}
  {Dv(280, 70, 200)}{P(293, 139, "D1")}
  {Lh(300, 70)}{P(326, 48, "L2")}
  {W("M 372 70 H 620")}{Dot(430, 70)}{Cv(430, 70, 200)}{P(444, 139, "C_out")}
  {Rv(600, 70, 200)}{P(614, 139, "R_L")}{N(520, 56, "−V_out")}
  {W("M 40 200 H 600")}{Gnd(360, 200)}
  {Tx(110, 232, "continuous current at both ports · C1 carries the energy transfer", { c: "#5C6E82", s: 10.5 })}
</SV>,

sepic: () => <SV w={700} h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 70")}{Lh(70, 70)}{P(96, 48, "L1")}
  {W("M 142 70 H 175")}{Dot(160, 70)}
  {W("M 160 70 V 120")}{Q(160, 145, 0, 25)}{P(175, 116, "Q1")}{W("M 160 170 V 200")}
  {Ch(175, 265, 70)}{P(206, 52, "C_s")}
  {W("M 265 70 H 300")}{Dot(280, 70)}
  {W("M 280 70 V 92")}{Lv(280, 92, 4, 9, -1)}{P(294, 132, "L2")}{W("M 280 164 V 200")}
  {Dh(300, 385, 70)}{P(332, 56, "D1")}
  {W("M 385 70 H 620")}{Dot(460, 70)}{Cv(460, 70, 200)}{P(474, 139, "C_out")}
  {Rv(600, 70, 200)}{P(614, 139, "R_L")}{N(520, 56, "V_out")}
  {W("M 40 200 H 600")}{Gnd(370, 200)}
  {Tx(110, 232, "non-inverting step up/down · C_s blocks DC, L1+L2 may share one core", { c: "#5C6E82", s: 10.5 })}
</SV>,

zeta: () => <SV w={700} h={250}>
  {Port(40, 70, "V_in")}{W("M 40 70 H 150")}{Cv(88, 70, 200)}{P(102, 139, "C_in")}
  {Q(170, 70, -90)}{P(158, 40, "Q1")}
  {W("M 190 70 H 235")}{Dot(215, 70)}
  {W("M 215 70 V 92")}{Lv(215, 92, 4, 9, 1)}{P(232, 132, "L1")}{W("M 215 164 V 200")}
  {Ch(235, 325, 70)}{P(266, 52, "C1")}
  {W("M 325 70 H 360")}{Dot(340, 70)}
  {Dv(340, 200, 70)}{P(353, 139, "D1")}
  {Lh(360, 70)}{P(386, 48, "L2")}
  {W("M 432 70 H 620")}{Dot(490, 70)}{Cv(490, 70, 200)}{P(504, 139, "C_out")}
  {Rv(600, 70, 200)}{P(614, 139, "R_L")}{N(530, 56, "V_out")}
  {W("M 40 200 H 600")}{Gnd(410, 200)}
  {Tx(110, 232, "non-inverting, low output ripple, pulsating input current", { c: "#5C6E82", s: 10.5 })}
</SV>,

chargepump: () => <SV w={700} h={250}>
  {Port(40, 70, "V_in")}{Dh(55, 150, 70)}{P(90, 56, "D1")}
  {W("M 150 70 H 175")}{Dot(165, 70)}{N(150, 56, "n1")}
  {W("M 165 70 V 90")}{Cv(165, 90, 150)}{P(180, 124, "C1")}{W("M 165 150 V 178")}
  {Port(165, 185, "φ1", "r")}
  {Dh(175, 285, 70)}{P(215, 56, "D2")}
  {W("M 285 70 H 310")}{Dot(300, 70)}{N(285, 56, "n2")}
  {W("M 300 70 V 90")}{Cv(300, 90, 150)}{P(315, 124, "C2")}{W("M 300 150 V 178")}
  {Port(300, 185, "φ2", "r")}
  {Dh(310, 420, 70)}{P(350, 56, "D3")}
  {W("M 420 70 H 620")}{Dot(480, 70)}{Cv(480, 70, 200)}{P(494, 139, "C_out")}
  {Rv(600, 70, 200)}{P(614, 139, "R_L")}{N(530, 56, "V_out")}
  {W("M 420 200 H 600")}{Gnd(520, 200)}
  {Tx(110, 232, "no magnetics · φ1/φ2 are antiphase clocks at f_sw", { c: "#5C6E82", s: 10.5 })}
</SV>,

flyback: () => <SV w={700} h={275}>
  {Port(40, 55, "V_in")}{W("M 40 55 H 250")}{Cv(90, 55, 235)}{P(104, 149, "C_in")}
  {W("M 250 55 V 80")}{Xf(250, 80, 64, 1)}{P(248, 44, "T1", { a: "middle" })}
  {N(292, 62, "N_p : N_s")}
  {W("M 250 144 V 160")}{Q(250, 185, 0, 25)}{P(265, 156, "Q1")}{W("M 250 210 V 235")}
  {W("M 40 235 H 250")}{Gnd(150, 235)}
  {ISO(262, 30, 258)}
  {W("M 274 80 V 60")}{Dh(274, 380, 60)}{P(320, 46, "D1")}
  {W("M 380 60 H 620")}{Dot(450, 60)}{Cv(450, 60, 215)}{P(464, 142, "C_out")}
  {Rv(600, 60, 215)}{P(614, 142, "R_L")}{N(520, 46, "V_out")}
  {W("M 274 144 V 215 H 600")}{Gnd(370, 215)}
  {Tx(110, 266, "energy is stored in the gapped core during t_on and released during t_off", { c: "#5C6E82", s: 10.5 })}
</SV>,

forward2: () => <SV w={720} h={305}>
  {Port(40, 40, "V_in")}{W("M 40 40 H 210")}{Cv(80, 40, 275)}{P(94, 162, "C_in")}
  {W("M 210 40 V 55")}{Q(210, 75, 0, 20)}{P(225, 68, "Q1")}{W("M 210 95 V 110")}
  {Xf(210, 110, 64, 0)}{P(208, 100, "T1", { a: "middle" })}
  {W("M 210 174 V 183")}{Q(210, 205, 0, 22)}{P(225, 198, "Q2")}{W("M 210 227 V 275")}
  {W("M 40 275 H 210")}{Gnd(120, 275)}
  {W("M 210 178 H 175")}{Dv(175, 178, 40)}{P(150, 62, "D_b")}{Dot(175, 40)}
  {HopW(140, 210, 110, [175])}{Dv(140, 275, 110)}{P(112, 210, "D_a")}{Dot(140, 275)}
  {ISO(224, 25, 290)}
  {W("M 234 110 V 80 H 300")}{Dh(300, 375, 80)}{P(330, 66, "D3")}
  {W("M 375 80 H 425")}{Dot(400, 80)}
  {Dv(400, 250, 80)}{P(412, 172, "D4")}
  {Lh(425, 80)}{P(450, 58, "L")}
  {W("M 497 80 H 640")}{Dot(550, 80)}{Cv(550, 80, 250)}{P(564, 172, "C_out")}
  {Rv(640, 80, 250)}{P(654, 172, "R_L")}{N(590, 66, "V_out")}
  {W("M 234 174 V 250 H 640")}{Gnd(470, 250)}
  {Tx(110, 296, "D_a / D_b reset the core and clamp both switches to V_in — hence D < 0.5", { c: "#5C6E82", s: 10.5 })}
</SV>,

pushpull: () => <SV w={740} h={300}>
  {Port(50, 40, "V_in")}{W("M 50 40 H 150")}{Cv(95, 40, 275)}{P(109, 162, "C_in")}
  {W("M 150 40 V 130")}{HopW(150, 300, 130, [230])}
  {Lv(300, 70, 3, 8.3, -1)}{Lv(300, 140, 3, 8.3, -1)}{W("M 300 120 V 140")}{Dot(300, 130)}
  {W("M 309 60 V 200")}{W("M 315 60 V 200")}
  {Lv(324, 70, 3, 8.3, 1)}{Lv(324, 140, 3, 8.3, 1)}{W("M 324 120 V 140")}{Dot(324, 130)}
  {P(298, 52, "T1", { a: "middle" })}
  {W("M 300 70 H 230")}{W("M 230 70 V 220")}{Q(230, 240, 0, 20)}{P(190, 244, "Q1")}{W("M 230 260 V 275")}
  {W("M 300 190 H 270")}{W("M 270 190 V 220")}{Q(270, 240, 0, 20)}{P(285, 244, "Q2")}{W("M 270 260 V 275")}
  {W("M 50 275 H 270")}{Gnd(160, 275)}
  {ISO(312, 25, 290)}
  {W("M 324 70 H 400")}{Dh(400, 470, 70)}{P(428, 56, "D1")}
  {W("M 324 190 H 400")}{Dh(400, 470, 190)}{P(428, 176, "D2")}
  {W("M 470 70 V 130")}{W("M 470 190 V 130")}{Dot(470, 130)}
  {W("M 470 130 H 500")}{Lh(500, 130)}{P(524, 108, "L")}
  {W("M 572 130 H 700")}{Dot(620, 130)}{Cv(620, 130, 250)}{P(634, 195, "C_out")}
  {Rv(700, 130, 250)}{P(660, 116, "R_L")}
  {HopW(324, 560, 138, [470])}{W("M 560 138 V 250")}{W("M 560 250 H 700")}{Gnd(600, 250)}
  {Tx(110, 292, "watch flux walking: peak-current mode or a DC blocking cap keeps the core centred", { c: "#5C6E82", s: 10.5 })}
</SV>,

halfbridge: () => <SV w={780} h={295}>
  {Port(40, 45, "V_in")}{W("M 40 45 H 230")}{W("M 40 250 H 400")}
  {Cv(110, 45, 147)}{P(124, 92, "C_a")}{Cv(110, 147, 250)}{P(124, 232, "C_b")}{Dot(110, 147)}
  {Leg(230, 45, 250, 147, "Q1", "Q2")}
  {W("M 230 147 H 290")}{W("M 290 147 V 105 H 340")}
  {W("M 110 147 V 200")}{Ch(110, 175, 200)}{P(132, 192, "C_blk")}
  {HopW(175, 320, 200, [230])}{W("M 320 200 V 169 H 340")}
  {Xf(340, 105, 64, 0)}{P(338, 95, "T1", { a: "middle" })}
  {ISO(352, 30, 280)}
  {Lv(364, 105, 2, 8, 1)}{Lv(364, 139, 2, 8, 1)}{W("M 364 137 V 139")}{Dot(364, 138)}
  {W("M 364 105 V 80 H 430")}{Dh(430, 500, 80)}{P(456, 66, "D1")}
  {W("M 364 171 V 205 H 430")}{Dh(430, 500, 205)}{P(456, 191, "D2")}
  {W("M 500 80 V 140")}{W("M 500 205 V 140")}{Dot(500, 140)}
  {W("M 500 140 H 530")}{Lh(530, 140)}{P(554, 118, "L")}
  {W("M 602 140 H 740")}{Dot(650, 140)}{Cv(650, 140, 255)}{P(664, 202, "C_out")}
  {Rv(740, 140, 255)}{P(694, 126, "R_L")}
  {W("M 364 138 H 400")}{VW(400, 138, 255, [205])}{W("M 400 255 H 740")}{Gnd(560, 255)}
  {Tx(110, 288, "switches see only V_in — the winding swings ±V_in/2", { c: "#5C6E82", s: 10.5 })}
</SV>,

psfb: () => <SV w={800} h={300}>
  {Port(40, 45, "V_in")}{W("M 40 45 H 300")}{W("M 40 255 H 300")}{Cv(90, 45, 255)}{P(104, 155, "C_in")}
  {Leg(170, 45, 255, 150, "Q1", "Q2")}{Leg(300, 45, 255, 150, "Q3", "Q4")}
  {W("M 300 150 H 350")}{Lh(350, 150, 3, 8)}{P(360, 130, "L_r")}
  {W("M 398 150 V 120 H 430")}
  {W("M 170 150 H 200")}{W("M 200 150 V 200")}{HopW(200, 410, 200, [300])}
  {W("M 410 200 V 184 H 430")}
  {Xf(430, 120, 64, 0)}{P(428, 108, "T1", { a: "middle" })}
  {ISO(442, 30, 285)}
  {Lv(454, 120, 2, 8, 1)}{Lv(454, 154, 2, 8, 1)}{W("M 454 152 V 154")}{Dot(454, 153)}
  {W("M 454 120 V 95 H 520")}{Dh(520, 585, 95)}{P(544, 81, "D1")}
  {W("M 454 186 V 215 H 520")}{Dh(520, 585, 215)}{P(544, 201, "D2")}
  {W("M 585 95 V 150")}{W("M 585 215 V 150")}{Dot(585, 150)}
  {W("M 585 150 H 610")}{Lh(610, 150)}{P(634, 128, "L_o")}
  {W("M 682 150 H 770")}{Dot(710, 150)}{Cv(710, 150, 265)}{P(724, 212, "C_out")}
  {Rv(770, 150, 265)}{P(730, 136, "R_L")}
  {W("M 454 153 H 490")}{VW(490, 153, 265, [215])}{W("M 490 265 H 770")}{Gnd(620, 265)}
  {Tx(110, 292, "phase shift between the two legs sets the duty; L_r + C_oss give ZVS turn-on", { c: "#5C6E82", s: 10.5 })}
</SV>,

llc: () => <SV w={780} h={290}>
  {Port(40, 45, "V_in")}{W("M 40 45 H 230")}{W("M 40 250 H 400")}{Cv(90, 45, 250)}{P(104, 152, "C_in")}
  {Leg(230, 45, 250, 148, "Q1", "Q2")}
  {W("M 230 148 H 260")}{Lh(260, 148, 3, 8)}{P(270, 128, "L_r")}
  {Ch(308, 366, 148)}{P(324, 132, "C_r")}
  {W("M 366 148 V 118 H 400")}
  {Xf(400, 118, 64, 0)}{P(398, 106, "T1", { a: "middle" })}{P(372, 178, "L_m")}
  {W("M 400 182 V 250")}
  {ISO(412, 30, 275)}
  {Lv(424, 118, 2, 8, 1)}{Lv(424, 152, 2, 8, 1)}{W("M 424 150 V 152")}{Dot(424, 151)}
  {W("M 424 118 V 92 H 490")}{Dh(490, 555, 92)}{P(514, 78, "D1")}
  {W("M 424 184 V 212 H 490")}{Dh(490, 555, 212)}{P(514, 198, "D2")}
  {W("M 555 92 V 150")}{W("M 555 212 V 150")}{Dot(555, 150)}
  {W("M 555 150 H 740")}{Dot(640, 150)}{Cv(640, 150, 255)}{P(654, 208, "C_out")}
  {Rv(740, 150, 255)}{P(690, 136, "R_L")}
  {W("M 424 151 H 460")}{VW(460, 151, 255, [212])}{W("M 460 255 H 740")}{Gnd(560, 255)}
  {Gnd(400, 250)}
  {Tx(110, 282, "frequency-controlled · L_m is the magnetising inductance, part of the tank", { c: "#5C6E82", s: 10.5 })}
</SV>,

dab: () => <SV w={820} h={290}>
  {Port(40, 45, "V1")}{W("M 40 45 H 270")}{W("M 40 250 H 270")}{Cv(85, 45, 250)}
  {Leg(150, 45, 250, 148, "S1", "S2")}{Leg(270, 45, 250, 148, "S3", "S4")}
  {W("M 270 148 H 300")}{Lh(300, 148, 3, 8)}{P(310, 128, "L_r")}
  {W("M 348 148 V 118 H 430")}
  {W("M 150 148 H 180")}{W("M 180 148 V 200")}{HopW(180, 410, 200, [270])}
  {W("M 410 200 V 182 H 430")}
  {Xf(430, 118, 64, 0)}{P(428, 106, "T1", { a: "middle" })}
  {ISO(442, 30, 275)}
  {W("M 454 118 V 148 H 560")}
  {W("M 454 182 V 210")}{HopW(454, 660, 210, [560])}{W("M 660 210 V 148 H 680")}
  {Leg(560, 45, 250, 148, "S5", "S6")}{Leg(680, 45, 250, 148, "S7", "S8")}
  {W("M 560 45 H 790")}{W("M 560 250 H 790")}{Cv(750, 45, 250)}
  {Port(790, 45, "V2", "r")}{Gnd(660, 250)}
  {Tx(110, 282, "power flows toward the lagging bridge — reverse the phase shift to reverse the flow", { c: "#5C6E82", s: 10.5 })}
</SV>,

pfcboost: () => <SV w={780} h={280}>
  {Port(45, 150, "L")}{W("M 45 150 H 130")}
  {Port(45, 230, "N")}{W("M 45 230 H 210")}{VW(210, 230, 150, [195])}{W("M 210 150 H 190")}
  {Dv(130, 195, 150)}{Dv(130, 150, 105)}{Dv(190, 195, 150)}{Dv(190, 150, 105)}
  {W("M 130 105 H 260")}{Dot(190, 105)}{P(150, 96, "bridge")}
  {W("M 130 195 H 660")}{Dot(190, 195)}
  {Lh(260, 105)}{P(286, 84, "L_boost")}
  {W("M 332 105 H 380")}{Dot(360, 105)}
  {W("M 360 105 V 130")}{Q(360, 155, 0, 25)}{P(375, 126, "Q1")}{W("M 360 180 V 195")}
  {Dh(380, 470, 105)}{P(412, 92, "D_b")}
  {W("M 470 105 H 700")}{Dot(560, 105)}{Cv(560, 105, 195)}{P(574, 158, "C_bulk")}
  {Rv(660, 105, 195)}{P(674, 158, "R_L")}{N(600, 92, "V_bus ≈ 390 V")}
  {Gnd(300, 195)}
  {Tx(110, 268, "current loop shapes i_L to follow |v_ac|; the slow voltage loop holds V_bus", { c: "#5C6E82", s: 10.5 })}
</SV>,

/* Two boost stages sharing one bridge and one bulk capacitor, switched half a
   period apart. Drawn as the plain PFC with a second leg beneath it, because
   the point of the topology is that the second leg is a COPY — nothing about
   it is different except when it runs. */
ilpfc: () => <SV w={780} h={320}>
  {Port(45, 150, "L")}{W("M 45 150 H 130")}
  {Port(45, 250, "N")}{W("M 45 250 H 210")}{VW(210, 250, 150, [195])}{W("M 210 150 H 190")}
  {Dv(130, 195, 150)}{Dv(130, 150, 105)}{Dv(190, 195, 150)}{Dv(190, 150, 105)}
  {W("M 130 105 H 260")}{Dot(190, 105)}{P(150, 96, "bridge")}
  {W("M 130 195 H 660")}{Dot(190, 195)}
  {W("M 260 105 V 160")}{Dot(260, 105)}
  {Lh(260, 105)}{P(286, 84, "L1")}
  {W("M 332 105 H 380")}{Dot(360, 105)}
  {W("M 360 105 V 122")}{Q(360, 147, 0, 25)}{P(375, 118, "Q1")}{W("M 360 172 V 195")}
  {Dh(380, 470, 105)}{P(412, 92, "D1")}
  {Lh(260, 160)}{P(286, 182, "L2")}
  {W("M 332 160 H 380")}{Dot(360, 160)}
  {W("M 360 160 V 172")}
  {Dh(380, 470, 160)}{P(412, 147, "D2")}
  {W("M 470 160 V 105")}{Dot(470, 105)}
  {W("M 260 160 V 105")}
  {W("M 470 105 H 700")}{Dot(560, 105)}{Cv(560, 105, 195)}{P(574, 158, "C_bulk")}
  {Rv(660, 105, 195)}{P(674, 158, "R_L")}{N(600, 92, "V_bus")}
  {Q(360, 220, 0, 25)}{P(375, 216, "Q2")}{W("M 360 195 V 195")}{W("M 360 245 V 195")}
  {Gnd(300, 195)}
  {Tx(110, 308, "the two legs run half a period apart, so their ripple currents partly cancel", { c: "#5C6E82", s: 10.5 })}
</SV>,

/* A flyback that waits for the ringing to reach a trough before turning on
   again. Same parts as a plain flyback plus the resonance that was always
   there — the drain capacitance and the primary inductance — now used
   deliberately instead of being snubbed away. */
qrflyback: () => <SV w={700} h={285}>
  {Port(40, 55, "V_in")}{W("M 40 55 H 250")}{Cv(90, 55, 235)}{P(104, 149, "C_in")}
  {Xf(250, 55, 100, 1)}{P(248, 45, "T1", { a: "middle" })}
  {ISO(264, 25, 250)}
  {W("M 250 155 V 185")}{Q(250, 205, 0, 20)}{P(266, 200, "Q1")}{W("M 250 225 V 235")}
  {W("M 40 235 H 250")}{Gnd(150, 235)}
  {Cv(205, 165, 235)}{P(160, 200, "C_res")}{W("M 205 165 V 165")}{Dot(250, 165)}
  {W("M 205 165 H 250")}{Dot(205, 235)}
  {W("M 274 60 H 330")}{Dh(330, 400, 60)}{P(356, 46, "D1")}
  {W("M 400 60 H 620")}{Dot(450, 60)}{Cv(450, 60, 215)}{P(464, 142, "C_out")}
  {Rv(620, 60, 215)}{P(634, 142, "R_L")}{N(520, 46, "V_out")}
  {W("M 274 155 V 215 H 620")}{Gnd(380, 215)}
  {Port(620, 60, "V_out", "r")}
  {Tx(110, 273, "C_res is the drain capacitance, used on purpose: turn on at the bottom of the ring", { c: "#5C6E82", s: 10.5 })}
</SV>,

totempole: () => <SV w={720} h={280}>
  {Port(45, 110, "L")}{W("M 45 110 H 120")}{Lh(120, 110)}{P(146, 90, "L_boost")}
  {W("M 192 110 V 145")}{W("M 192 145 H 300")}
  {Port(45, 205, "N")}{HopW(45, 380, 205, [300])}{W("M 380 205 V 145 H 420")}
  {Leg(300, 50, 240, 145, "Q1 (HF)", "Q2 (HF)")}
  {Leg(420, 50, 240, 145, "Q3 (LF)", "Q4 (LF)")}
  {W("M 300 50 H 640")}{W("M 300 240 H 640")}{Dot(420, 50)}{Dot(420, 240)}
  {Cv(560, 50, 240)}{P(574, 150, "C_bulk")}{Rv(640, 50, 240)}{P(654, 150, "R_L")}
  {N(500, 40, "V_bus")}{Gnd(490, 240)}
  {Tx(110, 268, "no bridge diodes — needs zero-reverse-recovery devices (GaN / SiC) in CCM", { c: "#5C6E82", s: 10.5 })}
</SV>,

hbridge: () => <SV w={760} h={280}>
  {Port(40, 50, "V_dc")}{W("M 40 50 H 320")}{W("M 40 240 H 320")}{Cv(95, 50, 240)}{P(109, 150, "C_dc")}
  {Leg(200, 50, 240, 120, "Q1", "Q2")}
  {Leg(320, 50, 240, 175, "Q3", "Q4")}
  {HopW(200, 420, 120, [320])}{Lh(420, 120)}{P(444, 100, "L_f")}
  {W("M 492 120 H 620")}
  {W("M 320 175 H 420")}{Lh(420, 175)}{W("M 492 175 H 620")}
  {Cv(560, 120, 175)}{P(574, 152, "C_f")}{Dot(560, 120)}{Dot(560, 175)}
  {Rv(620, 120, 175)}{P(634, 152, "load")}
  {N(600, 108, "v_ac")}
  {Tx(110, 268, "unipolar PWM: the two legs switch out of phase, so the filter sees 2·f_sw", { c: "#5C6E82", s: 10.5 })}
</SV>,

vsi3: () => <SV w={760} h={290}>
  {Port(40, 50, "V_dc")}{W("M 40 50 H 420")}{W("M 40 250 H 420")}{Cv(95, 50, 250)}{P(109, 155, "C_dc")}
  {Leg(220, 50, 250, 130, "A+", "A−")}
  {Leg(320, 50, 250, 150, "B+", "B−")}
  {Leg(420, 50, 250, 170, "C+", "C−")}
  {HopW(220, 545, 130, [320, 420])}{N(500, 122, "a")}
  {HopW(320, 545, 150, [420])}{N(500, 142, "b")}
  {W("M 420 170 H 545")}{N(500, 162, "c")}
  <circle key="mtr" cx={610} cy={150} r={46} style={WS} />
  {Tx(610, 156, "M", { a: "middle", s: 20, c: "#8296AB" })}
  {Tx(110, 282, "six devices, two levels · SVPWM reaches V_LL = 0.707·m·V_dc", { c: "#5C6E82", s: 10.5 })}
</SV>,

npc3: () => <SV w={700} h={300}>
  {Port(40, 50, "V_dc+")}{W("M 40 50 H 300")}{W("M 40 250 H 300")}
  {Cv(100, 50, 150)}{P(114, 96, "C1")}{Cv(100, 150, 250)}{P(114, 196, "C2")}
  {W("M 100 150 H 150")}{Dot(100, 150)}{N(60, 146, "NP")}
  {W("M 150 107 V 213")}{Dot(150, 150)}
  {W("M 300 50 V 68")}{Q(300, 82, 0, 14)}{P(316, 78, "S1")}
  {W("M 300 96 V 118")}{Dot(300, 107)}
  {Q(300, 132, 0, 14)}{P(316, 128, "S2")}
  {W("M 300 146 V 174")}{Dot(300, 160)}
  {Q(300, 188, 0, 14)}{P(316, 184, "S3")}
  {W("M 300 202 V 222")}{Dot(300, 213)}
  {Q(300, 236, 0, 14)}{P(316, 232, "S4")}{W("M 300 250 V 250")}
  {Dh(150, 300, 107)}{P(222, 96, "D1")}
  {Dh(300, 150, 213)}{P(222, 232, "D2")}
  {W("M 300 160 H 470")}{Port(470, 160, "phase", "r")}
  {Tx(110, 288, "each device blocks only V_dc/2 · three output levels: +V_dc/2, 0, −V_dc/2", { c: "#5C6E82", s: 10.5 })}
</SV>,
};

/* ------------------------------ plots ------------------------------ */
/* ---------------------------------------------------------------------
   Label placement.

   Every plot here puts its labels at the point they describe, which is
   right until two of them want the same spot — and then they print on top
   of one another. Two cases were guaranteed rather than unlucky: in the
   class-E chart both series end at exactly (628, 162), and the spectrum
   drew the "160" tick and the "dBµV" caption at identical coordinates.

   Given the y each label would like, this returns a y each label can
   actually have: sorted, pushed apart by at least minGap, and kept inside
   [lo, hi]. Order is preserved, so a label never crosses its neighbour. */
function layoutLabels(want, minGap, lo, hi) {
  const n = want.length;
  if (!n) return [];
  const idx = want.map((y, i) => i).sort((a, b) => want[a] - want[b]);
  const y = idx.map((i) => clamp(want[i], lo, hi));
  for (let i = 1; i < n; i++) if (y[i] - y[i - 1] < minGap) y[i] = y[i - 1] + minGap;
  /* if the stack overran the bottom, walk it back up */
  for (let i = n - 1; i >= 0; i--) {
    if (y[i] > hi) y[i] = hi - (n - 1 - i) * minGap;
    if (i > 0 && y[i] - y[i - 1] < minGap) y[i - 1] = y[i] - minGap;
  }
  for (let i = 0; i < n; i++) if (y[i] < lo) y[i] = lo + i * minGap;
  const out = new Array(n);
  idx.forEach((orig, k) => { out[orig] = y[k]; });
  return out;
}

/* Same idea, but only labels that actually share horizontal space are
   pushed apart. Separating everything regardless of x is worse than doing
   nothing: it moves a label away from the thing it names for the sake of a
   neighbour it was never going to touch — which is how the spectrum's
   "envelope" caption ended up sitting on the envelope curve. */
function layoutLabelsX(items, minGap, lo, hi) {
  const span = (it) => {
    const w = (it.t ? String(it.t).length : 0) * (it.cw || 5.4);
    const a = it.a === "end" ? it.x - w : it.a === "middle" ? it.x - w / 2 : it.x;
    return [a - 3, a + w + 3];
  };
  const boxes = items.map(span);
  /* union-find over horizontal overlap, so a chain of overlapping labels
     is laid out as one column */
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (boxes[i][0] < boxes[j][1] && boxes[j][0] < boxes[i][1]) parent[find(i)] = find(j);
    }
  }
  const out = items.map((it) => it.y);
  const groups = new Map();
  items.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  groups.forEach((members) => {
    if (members.length < 2) { out[members[0]] = clamp(items[members[0]].y, lo, hi); return; }
    const ys = layoutLabels(members.map((i) => items[i].y), minGap, lo, hi);
    members.forEach((i, k) => { out[i] = ys[k]; });
  });
  return out;
}

/* CYCLES must stay a whole number. The playhead sweeps the full plot width
   and the schematic completes one switching period per drawn cycle, so a
   fractional count would leave the figure mid-period when the marker wraps
   — which is what made the animation look like it restarted early. */
const WAVE_CYCLES = 3;

/* ---------------------------------------------------------------------
   The figure is a stack of panes over one shared time axis.

   It used to be two panes with their coordinates written into the drawing
   code — `top = 92, bot = 168`, a `yI` that only the current knew about, and
   two hand-built path strings. Adding a third pane meant re-deriving every
   number in the function, and the capacitor panes need two.

   So a pane is now data: a name, a unit, a colour, a height, the value range
   its own axis covers, and its trace as a polyline in cycle-relative time.
   One layout pass stacks them; one drawing pass draws them. Everything that
   was special about the voltage pane — that its two levels are named rather
   than numbered — is expressed as a span of [0,1] with named ticks, so it
   goes through the same code as the rest.

   Panes are drawn in layers rather than pane by pane: all the gridlines,
   then all the reference lines, then all the traces, then all the scales.
   A trace must sit over its neighbour's furniture, not under it.        */
const PX0 = 96, PX1 = 640;   /* the plotting column; left margin holds "peak 11.4 A" */
const PANE_TOP = 20;         /* where the first pane's top rule sits */
const PANE_GAP = 30;         /* clear space between panes — the titles live in it */

/* Read a value off a pane's trace at phase u.

   The ripple pane's segments carry a Bézier control point, so this follows
   the drawn curve rather than a chord across it. At the ripple peak — the one
   place on that pane worth putting a marker — a chord is visibly low. */
function paneAt(pts, u) {
  const t = clamp(u, 0, 1);
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    if (b.u <= a.u) continue;
    if (t <= b.u) {
      const s = (t - a.u) / (b.u - a.u);
      return b.q ? (1 - s) * (1 - s) * a.v + 2 * s * (1 - s) * b.q.v + s * s * b.v
        : a.v + (b.v - a.v) * s;
    }
  }
  return pts[pts.length - 1].v;
}

function Wave(props) {
  /* Both fallbacks are SYMBOLS, because every label beside them is one. They
     used to be the words "voltage" and "current", so a spec that forgot a
     label changed the figure's register rather than just its wording — a
     column of i_L, i_C, v_C with a plain "current" among them. */
  const { vlabel = "v_node", ilabel = "i_L", cycles = WAVE_CYCLES,
    band = null, playhead = null, flowOffset = null, fadeEdges = false,
    period = null, vhi = "high", vinv = false } = props;
  /* One shared description of the cycle, so this pane and the animated
     schematic can never draw different currents. See src/cycle.js.

     `iShape` is threaded through so a topology whose current is not a ramp
     at all — a resonant tank, a rectifier's conduction pulse — can be plotted
     from the same closure that drives its animation. Without it this pane
     could only draw designs that publish a `wave` spec, which is why a third
     of the topologies had a moving figure and no waveform under it. */
  const M = useMemo(() => buildCycle(props, props.iShape),
    [cycleKey(props, props.iShape)]);
  const D = M.D, iavg = props.iavg;
  const x0 = PX0, x1 = PX1, per = (x1 - x0) / cycles;
  const C = M.cap;

  /* ---------------- the panes, in the order they stack ---------------- */
  const panes = [];

  /* Which way round the switch node sits.

     Where the switch is in series with the input — buck, forward, bridge —
     the node is pulled UP to the rail while the device conducts. Where the
     switch returns to ground — boost, flyback, SEPIC, Ćuk — it is pulled
     DOWN to zero while conducting, and flies up to the reflected rail when
     it turns off. Drawing every topology the first way had the trace upside
     down on the second group.

     The pane's scale is [0,1] and the ticks are named, because most of these
     topologies know what the node swings between by name and not by value. */
  const lOn = vinv ? 0 : 1, lOff = vinv ? 1 : 0;
  /* The node, as a list of the flat intervals it actually sits at.

     One list covers three quite different pictures, which is why it is a list
     and not a formula:

       one pulse per period   the classic switch node — a rail for D, the other
                              rail for the rest. What this pane always drew.
       two pulses, unipolar   a rectified node behind a centre tap: two positive
                              pulses of width D with freewheel between them, so
                              its mean is 2·D × swing rather than D × swing.
       two pulses, bipolar    a transformer primary driven by a bridge. It sees
                              +V, then nothing, then −V, then nothing. Its mean
                              is zero by symmetry — and it had better be, or the
                              core walks into saturation a little further every
                              cycle. That is what the blocking capacitor in a
                              half-bridge and the flux-walking warning on a
                              push-pull are both about.

     Deriving the trace, the mean and the volt-second lobes from this one list
     means those three cases share a code path instead of having three. */
  const vPulses = Math.max(1, Math.round(props.pulses || 1));
  const vbi = !!props.vbi;
  const vSpan = vbi ? [-1, 1] : [0, 1];
  const vFlats = [];
  if (vPulses === 1) {
    vFlats.push({ u0: 0, u1: D, v: lOn }, { u0: D, u1: 1, v: lOff });
  } else {
    for (let k = 0; k < vPulses; k++) {
      /* alternate polarity on a bipolar drive; every pulse positive otherwise */
      const lvl = vbi && k % 2 ? -1 : 1;
      const a = k / vPulses, b = Math.min(a + D, (k + 1) / vPulses);
      vFlats.push({ u0: a, u1: b, v: lvl }, { u0: b, u1: (k + 1) / vPulses, v: 0 });
    }
  }
  /* Volt-second balance, drawn rather than asserted.

     The inductor tied to this node cannot support a mean voltage: whatever it
     gains while the node sits at one rail it must give back while the node
     sits at the other, or its current would climb without limit. So the mean
     of the node is pinned by the duty alone — mean = D·on + (1−D)·off — and
     the two areas between the trace and that mean are equal for any D at all:

         (1−D)·|on − off|·D    above,     D·|on − off|·(1−D)   below.

     Identically the same expression. That is the whole of volt-second balance,
     and it needs no rail voltages to state — which is why it can be drawn on
     every topology here, including the ones whose node swings between two
     levels the design only knows by name.

     It is also why the mean sits at level D and not halfway: the shaded
     rectangles are the same AREA, not the same shape. A short tall lobe
     balances a long shallow one, and reading that off the figure is the
     intuition the equation M = D is standing on.

     Which is exactly why none of it is drawn in DISCONTINUOUS conduction. Once
     the current reaches zero the diode stops conducting and the node stops
     being a two-level square: it sits at the output for the rest of the
     period, a third level this pane does not draw. Volt-seconds still balance
     over the two conducting intervals, but they no longer balance about D ×
     swing, and M = D fails — which is the single most important thing about
     DCM. Shading two lobes and calling them equal would assert the opposite,
     on the one operating point where it is false. */
  const vsOK = M.mode !== "dcm";
  /* The mean is the list's own weighted average, so it cannot disagree with the
     trace drawn from the same list. */
  let vRef = 0;
  for (const f of vFlats) vRef += f.v * (f.u1 - f.u0);
  /* Exactly `cycles` whole periods, and not one edge more. The leading point is
     the level the trace ARRIVES at u = 0 with — the last interval's — so the
     opening vertical edge is drawn; without it the trace would begin already at
     the rail it is about to jump to. */
  const vPts = [{ u: 0, v: vFlats[vFlats.length - 1].v }];
  for (const f of vFlats) vPts.push({ u: f.u0, v: f.v }, { u: f.u1, v: f.v });
  /* A bipolar node's mean is zero, which is the same place as its zero rail, so
     the tick says both rather than stacking two labels on one line. */
  const vTicks = vbi
    ? [[1, vhi], [0, vsOK ? "0 · mean" : "0"], [-1, "−" + vhi]]
    : vsOK ? [[1, vhi], [vRef, "mean"], [0, "0"]] : [[1, vhi], [0, "0"]];
  /* A topology that supplies its own current shape usually has no honest
     two-level switch node to draw: a class-E drain rings, an LLC's node is
     swung by the tank, a rectifier's input is a sine. Drawing a square wave
     there would be inventing a waveform, so bare mode plots the current
     alone and says nothing it cannot support. */
  if (!props.bare) panes.push({
    /* Pane units read "<unit>" alone, or "<unit> · <what the sign means>"
       where the reader needs a convention to make sense of the trace. Nothing
       else goes in this slot: it is a unit, not a subtitle. */
    key: "v", name: vlabel, unit: "volts", c: "#5AD1DE",
    h: vbi ? 54 : 42, span: vSpan, inset: 8, axUp: 2, rules: [0, 1],
    pts: vPts,
    ref: vRef,
    lobes: vsOK ? vFlats : null,
    dash: vsOK ? [{ v: vRef, da: "3 4" }] : [],
    ticks: vTicks,
    fmt: null, dot: { c: "#5AD1DE", r: 3.2 },
  });

  /* Two-sided, because a synchronous rectifier's current genuinely reverses
     at light load and a zero-based scale drops that half of the waveform
     through the floor and across the time axis. Where the current never goes
     negative — every diode-rectified topology — iFloor is 0 and this is the
     same mapping as before, to the bit.

     The current comes from the shared model as a polyline, so whatever shape
     it describes — a plain ramp, a pulse that stops at turn-off, a ramp bent
     by core saturation, a discontinuous cycle that sits at zero — is drawn
     without the drawing knowing which of those it is. */
  const iCeil = Math.max(M.iMax * 1.18, 1e-9);
  const iFloor = Math.min(M.iMin * 1.18, 0);
  /* A supplied shape is a SHAPE: its height is whatever the closure happened
     to return, and printing that as amps would be inventing a measurement.
     So bare mode scales in multiples of the peak and says so, which is
     exactly what the shape does support — when the current is largest,
     when it reverses, and how long it rests at zero. */
  const iMean = M.qTot;
  panes.push({
    key: "i", name: ilabel, unit: props.bare ? "relative to peak" : "amps", c: "#E0A458",
    h: 76, span: [iFloor, iCeil], inset: 0, axUp: -4, rules: [1],
    pts: M.pts.map((p) => ({ u: p.u, v: p.i })),
    flow: flowOffset !== null,
    /* Where the current reverses, the zero crossing is the whole point — it
       is the moment the freewheel FET starts pulling current back into the
       input rather than delivering it. */
    dash: props.bare
      ? [{ v: iMean, da: "3 4" }]
      : [{ v: iavg, da: "3 4" }].concat(iFloor < 0 ? [{ v: 0, da: "2 3", lab: "0" }] : []),
    ticks: props.bare
      ? [[M.iPeak, "peak"], [iMean, "mean"]]
      : [[M.iPeak, "peak"], [iavg, "mean"], [M.iValley, "valley"]],
    fmt: props.bare
      ? (v) => (M.iPeak > 1e-12 ? f2(v / M.iPeak) : "0") + "×"
      : (v) => eng(v, "A"),
    dot: { c: "#E3A85C", r: 3.6 },
  });

  /* ---- the capacitor: what the output actually sees ----
     Only drawn where the design supplied a capacitor to model. The two panes
     go together — the ripple turns where the current crosses zero, and
     showing either alone throws away the argument. */
  if (C) {
    const iSpan = Math.max(C.iCmax - C.iCmin, 1e-12) * 0.16;
    panes.push({
      /* The sign convention belongs in the header, once. On the ticks it read
         "out of C −1.33 A", which is sixteen characters of right-aligned mono
         in an 88-pixel margin — it ran off the left edge of the figure. */
      /* Named for the output capacitor specifically: the schematic above
         this pane often draws a C_in as well, and a bare "i_C" left the
         reader to guess which one the trace belongs to. */
      key: "ic", name: "i_Cout", unit: "amps · + into C_out", c: "#A88BF0",
      h: 60, span: [C.iCmin - iSpan, C.iCmax + iSpan], inset: 0, axUp: -4, rules: [1],
      pts: C.iC.map((p) => ({ u: p.u, v: p.i })),
      dash: [{ v: 0, da: "2 3", lab: "0" }],
      ticks: [[C.iCmax, "peak"], [C.iCmin, "valley"]],
      fmt: (v) => eng(v, "A"), dot: { c: "#B49BF3", r: 3.4 },
    });
    const vPad = Math.max(C.vPP, 1e-12) * 0.22;
    /* The ripple, as one quadratic per segment of the current. The control
       points come from the model, which owns the algebra; see cycle.js. */
    const ripple = C.vTot.map((v, k) => ({
      u: C.iC[k].u, v, q: k > 0 && C.ctrl[k - 1] ? C.ctrl[k - 1] : null,
    }));
    panes.push({
      key: "vc", name: "v_Cout", unit: "volts · about V_out", c: "#F0796C",
      h: 60, span: [C.vMin - vPad, C.vMax + vPad], inset: 0, axUp: -4, rules: [1],
      pts: ripple,
      /* The charge-only parabola, under the real trace. The gap between them
         is the ESR term, which is the reason a measured ripple peak never
         sits where the textbook parabola says it should. `underLab` names it
         on the plot itself — a dashed curve with no name reads as an error
         band, and nothing below the figure explains a line on it. */
      under: C.esr > 0 ? C.vCap.map((v, k) => ({
        u: C.iC[k].u, v, q: k > 0 && C.ctrlCap[k - 1] ? C.ctrlCap[k - 1] : null,
      })) : null,
      underLab: "without ESR",
      dash: [{ v: 0, da: "2 3", lab: "V_out" }],
      ticks: [[C.vMax, "peak"], [C.vMin, "valley"]],
      fmt: (v) => eng(v, "V"), dot: { c: "#F58E82", r: 3.4 },
    });
  }

  /* ---------------- layout: stack them, then give each its scale ------- */
  let yc = PANE_TOP;
  for (const p of panes) {
    p.y0 = yc; p.y1 = yc + p.h; yc = p.y1 + PANE_GAP;
    const [lo, hi] = p.span, hy = p.y0 + (p.inset || 0);
    const den = hi - lo || 1;
    p.y = (v) => p.y1 - ((v - lo) / den) * (p.y1 - hy);
  }
  const bot = panes[panes.length - 1].y1;
  const HEIGHT = bot + 76;

  /* Tile a pane's trace across the drawn periods. Straight segments and
     curved ones go through the same loop, so no pane needs its own builder. */
  const tile = (pts, y) => {
    let d = `M ${x0} ${+y(pts[0].v).toFixed(2)}`;
    for (let c = 0; c < cycles; c++) {
      const a = x0 + c * per;
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k], px = +(a + p.u * per).toFixed(3), py = +y(p.v).toFixed(2);
        d += p.q
          ? ` Q ${+(a + p.q.u * per).toFixed(3)} ${+y(p.q.v).toFixed(2)} ${px} ${py}`
          : ` L ${px} ${py}`;
      }
    }
    return d;
  };

  /* The marker is drawn inside this SVG rather than as a positioned element
     over it. Sharing the coordinate system is the only way it can be
     guaranteed to sit exactly on the edge it is pointing at. */
  const uPhase = playhead === null ? 0 : (playhead * cycles) % 1;
  /* One marker per drawn period, each at the same phase within its own
     period. The plot holds a whole number of identical periods, so all of
     those positions denote the same instant, and the rake can hand off at
     the frame edge the way the current arrows do.

     A single cursor crossing the whole plot was the one thing here that was
     not periodic, so it had to travel back at the wrap. Measured, that was
     the last thing making the loop feel unlike the rest of the motion:
     every other discontinuity — the shaded band moving to the other side of
     the commutation, the flow dashes restarting — happens at all three
     period boundaries, so the eye reads them as the rhythm rather than as a
     seam. The cursor's return happened once a loop, and dissolving it to
     hide the jump left roughly three quarters of a second with no cursor on
     the plot at all. Now every period boundary looks like every other one,
     which is what "uniform as it loops" has to mean. */
  const CFADE = 0.16;
  const cursors = playhead === null ? [] : Array.from({ length: cycles }, (_, c) => {
    const s = c + uPhase;                       /* periods from the left edge */
    const e = clamp(Math.min(s, cycles - s) / CFADE, 0, 1);
    return { x: x0 + s * per, o: fadeEdges ? e * e * (3 - 2 * e) : 1 };
  });
  const gl = { stroke: "#22303F", strokeWidth: 1, fill: "none" };
  /* Every pane's scale labels get collision layout. The series name sits at
     the peak and the mean value at the mean; at low ripple those are only a
     few pixels apart.

     13 px, not 10: these labels carry rendered subscripts, whose descenders
     make the real bounding box noticeably taller than the font size. */
  for (const p of panes) {
    p.tickY = layoutLabels(p.ticks.map(([v]) => p.y(v) + 3.5), 13, p.y0 - 2, p.y1 + 4);
    p.d = tile(p.pts, p.y);
    p.dUnder = p.under ? tile(p.under, p.y) : null;
    /* The right gutter — the dashed references' names, and the ESR-free
       underlay's — through the same collision pass as the left scale. At low
       ripple "V_out" and "without ESR" want the same few pixels. */
    const gut = (p.dash || []).filter((r) => r.lab)
      .map((r) => ({ y: p.y(r.v) + 3.5, lab: r.lab, c: "#5C6E82", s: 9, o: 1 }));
    if (p.dUnder && p.underLab) {
      gut.push({
        y: p.y(p.under[p.under.length - 1].v) + 3.5,
        /* The curve's own colour at the curve's own weight, so the name
           reads as belonging to the dashed line and not the solid trace. */
        lab: p.underLab, c: p.c, s: 8.5, o: 0.55,
      });
    }
    const gy = layoutLabels(gut.map((g) => g.y), 11, p.y0 - 2, p.y1 + 4);
    p.gutter = gut.map((g, i) => ({ ...g, y: gy[i] }));
  }
  /* Where the ripple turns, and why. The capacitor's voltage peaks where its
     CURRENT crosses zero — not where the inductor current peaks — so join the
     two panes at each crossing and let the figure make the argument. */
  const cx = C && panes.length === 4
    ? C.cross.map((p) => ({ u: p.u, yi: panes[2].y(0), yv: panes[3].y(p.v) }))
    : [];
  /* Zero is "0" on either ruler — "0 s" dresses the origin up as a reading. */
  const tUnit = period
    ? (v) => (v ? engAx(v * period, "s") : "0")
    : (v) => (v ? v + "T" : "0");

  /* What this figure knows and the tables do not say out loud.

     Conduction mode is the one that matters most and was the hardest to see:
     the design panel warns about DCM in a sentence among other sentences,
     while every ratio printed beside it silently assumes continuous
     conduction. Saying it here, next to the shape it changes, is the point.

     The rest are numbers a designer needs and would otherwise have to derive:
     ripple as a fraction of the mean rather than as an absolute; the ripple
     CURRENT the output capacitor has to be rated for, which kills more
     capacitors than the voltage rating does; and how much of the output
     ripple is ESR rather than charge, because those two are fixed by
     different properties of the same part and only one of them improves when
     you buy more capacitance. */
  const facts = [];
  const dISpan = M.iPeak - M.iValley;
  if (props.bare) {
    /* What a shape alone can honestly say. How long the current rests at
       zero is the one that earns its place: it is the difference between a
       rectifier that conducts for most of the cycle and one that conducts in
       a narrow spike, and it is visible in the drawing but hard to eyeball. */
    let idle = 0;
    for (let k = 0; k < 240; k++) if (M.iAt(k / 240) <= M.iPeak * 0.02) idle++;
    facts.push({ k: "shape", v: "supplied by the topology", note: true });
    facts.push({ k: "mean", v: f2(M.qTot / Math.max(M.iPeak, 1e-12)) + "× peak" });
    if (idle > 4) facts.push({ k: "at rest", v: pct(idle / 240) + " of the period" });
  } else {
  facts.push(M.mode === "dcm"
    ? { k: "conduction", v: "discontinuous", note: true }
    : M.iValley < 0
      ? { k: "conduction", v: "reverses each cycle", note: true }
      : { k: "conduction", v: "continuous" });
  if (iavg > 0 && Number.isFinite(dISpan)) {
    facts.push({ k: "ripple", v: pct(dISpan / iavg) + " of mean" });
  }
  /* On a bipolar drive the number is always zero, and saying "balanced about
     0.000 × swing" wastes the one line available to say why that matters. */
  facts.push(!vsOK
    ? { k: "volt-seconds", v: "M ≠ D — third node level not drawn" }
    : vbi
      ? { k: "volt-seconds", v: "mean zero — the core cannot walk" }
      : { k: "volt-seconds", v: "balanced about " + f3(vRef) + " × swing" });
  }
  if (props.sat > 0) {
    facts.push({ k: "core softening", v: pct(props.sat) + " roll-off at peak" });
  }
  if (C) {
    facts.push({ k: "ΔV_out", v: eng(C.vPP, "V") + " p-p" });
    if (C.esr > 0 && C.vPP > 0) {
      facts.push({ k: "of which ESR", v: pct(1 - C.capPP / C.vPP) });
    }
    facts.push({ k: "C_out must carry", v: eng(C.iCrms, "A") + " rms" });
    /* As a frequency, not as a multiple of a symbol: this is the number the
       capacitor's impedance curve and the loop crossover are read at. */
    if (C.n * C.sub > 1 && Number.isFinite(C.fRipple)) {
      facts.push({ k: "output ripples at", v: eng(C.fRipple, "Hz") });
    }
  }
  /* data-fig names this surface for the measurement scripts, and data-trace
     names each trace within it. They used to find the traces by stroke colour
     and the cursor by matching the exact `d` of its path — so the figure could
     not gain a pane without silently breaking every one of them.

     data-qerr is the model's own confession. A capacitor's charge must balance
     over a period; where a topology hands over a spec that does not balance —
     the wrong family, a rectifier current that does not average to the load,
     an interleaving factor that is not there — the model corrects it and
     records how big the correction was. It is the one number that catches
     every way the wiring between a design and this pane can be wrong, so
     scripts/check-ripple.mjs asserts on it for all 32 topologies rather than
     trusting thirty-two hand-derived specs to be right. */
  return (
    <div>
    {/* 700 wide, not 660. The plotting area still ends at PX1 = 640 and no
        trace coordinate moves; the extra 40 is right-hand margin for the
        reference-line labels, which are drawn at x1 + 4 and ran to about 661
        — a whisker outside the old frame, so "V_out" was clipped by the
        viewport edge on every capacitor pane. */}
    <div className="sch"><svg data-fig="wave" viewBox={`0 0 700 ${HEIGHT}`}
      data-qerr={C ? C.qErr.toExponential(3) : null}
      data-vpp={C ? C.vPP.toExponential(6) : null}
      data-cappp={C ? C.capPP.toExponential(6) : null}
      data-icrms={C ? C.iCrms.toExponential(6) : null}
      data-cval={C ? C.C.toExponential(6) : null}
      style={{ width: "100%", height: "auto", display: "block" }}>
      {drawScope("wv", () => (<>
        {band ? Array.from({ length: cycles }, (_, c) => {
          const ba = x0 + (c + band[0]) * per, bb = x0 + (c + band[1]) * per;
          if (ba >= x1) return null;
          return <rect key={"bd" + c} x={ba} y={18} width={Math.max(Math.min(bb, x1) - ba, 0)}
            height={bot - 18} fill="#6FD39B" opacity=".08" />;
        }) : null}
        {/* Pane titles — what quantity, in what unit — on one line above the
            pane, name then unit.

            The unit used to sit on a second line INSIDE the pane, at y0 + 10,
            which is exactly where a scale label for a value near the top of
            the pane lands. With two panes and generous headroom they missed
            each other; with four they did not, and "amps" ended up underneath
            "peak 11.4 A". Above the pane there is nothing to collide with, and
            the whole left margin is left to the scale. */}
        {panes.map((p) => (
          <g key={"ti" + p.key}>
            {Tx(6, p.y0 - 6, p.name, { c: p.c, s: 10.5, b: 1 })}
            {/* Half a pixel down: an 8.5 pt run sharing a 10.5 pt baseline
                sits visibly high in this mono face. */}
            {Tx(6 + txWidth(p.name, 10.5) + 6, p.y0 - 5.5, p.unit, { c: "#5C6E82", s: 8.5 })}
          </g>
        ))}
        {/* horizontal rules: each pane says which of its own edges it wants */}
        {panes.map((p) => p.rules.map((f, i) => (
          <path key={"gr" + p.key + i} d={`M ${x0} ${f ? p.y1 : p.y0} H ${x1}`} {...gl} />
        )))}
        {/* The volt-second lobes. Same fill and same opacity on both, because
            the claim being made is that their AREAS are equal — give them two
            colours and the eye compares the colours instead. */}
        {panes.map((p) => (p.lobes || []).map((lb, i) => Array.from({ length: cycles }, (_, c) => {
          const xa = x0 + (c + lb.u0) * per, xb = Math.min(x0 + (c + lb.u1) * per, x1);
          const ya = p.y(lb.v), yr = p.y(p.ref);
          if (xb <= xa) return null;
          return <rect key={"vs" + p.key + i + "_" + c} x={+xa.toFixed(2)}
            y={+Math.min(ya, yr).toFixed(2)} width={+(xb - xa).toFixed(2)}
            height={+Math.abs(yr - ya).toFixed(2)} fill={p.c} opacity={0.13} />;
        })))}
        {/* reference levels — the mean, and zero wherever the trace crosses it.
            Their names draw with the gutter block below, which lays the whole
            right margin out together instead of label by label. */}
        {panes.map((p) => (p.dash || []).map((r, i) => (
          <path key={"dl" + p.key + i} d={`M ${x0} ${+p.y(r.v).toFixed(2)} H ${x1}`}
            stroke="#3E5266" strokeWidth={1} strokeDasharray={r.da} fill="none" />
        )))}
        {/* the axis rules themselves, one subpath per pane */}
        <path d={panes.map((p) => `M ${x0} ${p.y0 + p.axUp} V ${p.y1}`).join(" ")}
          stroke="#3E5266" strokeWidth={1} fill="none" />
        {/* the crossing guides, before the traces so they read as furniture */}
        {cx.map((k, i) => Array.from({ length: cycles }, (_, c) => {
          const px = +(x0 + (c + k.u) * per).toFixed(2);
          return (
            <g key={"cx" + i + "_" + c}>
              <path d={`M ${px} ${+k.yi.toFixed(2)} V ${+k.yv.toFixed(2)}`} stroke="#5C6E82"
                strokeWidth={1} strokeDasharray="1 3" fill="none" opacity={0.75} />
              <circle cx={px} cy={+k.yi.toFixed(2)} r={2.1} fill="#A88BF0" />
              <circle cx={px} cy={+k.yv.toFixed(2)} r={2.1} fill="#F0796C" />
            </g>
          );
        }))}
        {/* the traces. An underlay goes first — it is what the trace over it
            would have been without the resistance in series. */}
        {panes.map((p) => (p.dUnder ? (
          <path key={"un" + p.key} d={p.dUnder} stroke={p.c} strokeWidth={1.1} fill="none"
            strokeDasharray="4 4" opacity={0.5} />
        ) : null))}
        {panes.map((p) => (
          <path key={"tr" + p.key} data-trace={p.key} d={p.d} stroke={p.c} strokeWidth={1.8}
            fill="none" strokeLinejoin="round" />
        ))}
        {/* the right gutter, collision-laid-out per pane above */}
        {panes.map((p) => (p.gutter || []).map((g, i) => (
          <g key={"gu" + p.key + i} opacity={g.o}>
            {Tx(x1 + 3, g.y, g.lab, { c: g.c, s: g.s })}
          </g>
        )))}
        {/* The same charge-driven dashes that run round the circuit, laid
            along the current trace. The schematic's flow accelerates and
            eases with the instantaneous current; without this the trace
            beside it appeared to run at a flat, unrelated speed. Both are
            driven by one offset, so they move together. */}
        {panes.map((p) => (p.flow ? (
          <path key={"fl" + p.key} className="wflow" d={p.d}
            style={{ strokeDashoffset: flowOffset }} />
        ) : null))}
        {/* the scales: the numbers a designer sizes parts against, each said
            in words as well as figures. A pane with no numeric scale — the
            switch node, whose rails are named — gets the words alone. */}
        {panes.map((p) => p.ticks.map(([v, lab], i) => (
          <g key={"tk" + p.key + i}>
            {p.fmt ? <path d={`M ${x0 - 5} ${+(p.tickY[i] - 3.5).toFixed(2)} H ${x0}`} {...gl} /> : null}
            {/* One space and 9 px, not two spaces and 9.5. "valley  −1.33 A"
                set the old way measures about 86 px into an 88 px margin,
                which is not margin enough for a three-digit milliamp value.  */}
            {Tx(x0 - 8, p.tickY[i], p.fmt ? lab + " " + p.fmt(v) : lab,
              { a: "end", c: p.fmt ? "#8DA0B4" : "#5C6E82", s: p.fmt ? 9 : 9.5 })}
          </g>
        )))}
        {/* time axis: one tick per drawn period, plus the on-time bracket */}
        <path d={`M ${x0} ${bot} V ${bot + 6}`} {...gl} />
        {Array.from({ length: cycles + 1 }, (_, c) => (
          <g key={"tk" + c}>
            <path d={`M ${x0 + c * per} ${bot} V ${bot + 6}`} {...gl} />
            {Tx(x0 + c * per, bot + 18, tUnit(c), { a: "middle", c: "#5C6E82", s: 9.5 })}
          </g>
        ))}
        {/* The on-time bracket gets its own row beneath the tick labels. Set
            beside the bracket it collided with the first tick whenever the
            duty ran long. */}
        {/* Not drawn in bare mode: where the shape came from a closure there
            is no duty behind it, and a bracket labelled D·T would be naming
            a quantity this figure never used. */}
        {props.bare ? null : (
          <>
            <path d={`M ${x0} ${bot + 30} H ${x0 + per * D}`} stroke="#6FD39B" strokeWidth={1.4} fill="none" />
            <path d={`M ${x0} ${bot + 27} V ${bot + 33} M ${x0 + per * D} ${bot + 27} V ${bot + 33}`}
              stroke="#6FD39B" strokeWidth={1.4} fill="none" />
            {Tx(x0 + per * D / 2, bot + 45, "on-time · D·T = " + f3(D) + "·T",
              { a: "middle", c: "#6FD39B", s: 9.5 })}
          </>
        )}
        {/* Name the period either way. With real seconds on the ticks the
            caption used to drop to the bare word "time", which left the T in
            "on-time D·T" just above it undefined on exactly the pages that
            had the number to define it with. */}
        {Tx((x0 + x1) / 2, bot + 62, period
          ? "time · T = 1/f_sw = " + eng(period, "s")
          : "time · T = 1/f_sw",
          { a: "middle", c: "#8DA0B4", s: 10.5 })}
        {/* One dot per pane, all at the same instant — which is the point of
            stacking the panes in the first place. Each is read off its own
            pane's trace, so a dot cannot drift from the curve under it. */}
        {cursors.map((m, c) => (
          <g key={"cu" + c} className="rake" style={{ opacity: m.o.toFixed(3) }}>
            <path d={`M ${m.x.toFixed(2)} 18 V ${bot}`} stroke="#E6EDF5" strokeWidth={1.1}
              fill="none" opacity={0.6} />
            {panes.map((p) => (
              <circle key={p.key} cx={m.x.toFixed(2)} cy={+p.y(paneAt(p.pts, uPhase)).toFixed(2)}
                r={p.dot.r} fill={p.dot.c} />
            ))}
          </g>
        ))}
      </>))}
    </svg></div>
    {/* The facts sit outside the plotting surface, not on it. On it they would
        be competing with the traces for the same 660 × 424 of attention; below
        it they are a caption, which is what they are. */}
    <div className="wfacts">
      {facts.map((f, i) => (
        <span key={i} className={f.note ? "note" : ""}>
          <i><Sub t={f.k} /></i><b>{f.v}</b>
        </span>
      ))}
    </div>
    </div>
  );
}

/* One number of decimals for a whole axis, chosen from the ticks themselves.

   Deciding per label — two decimals below ten, none above — put "0.00, 3.00,
   6.00, 9.00, 12" on a single axis, which reads as four measurements and a
   round number rather than as one evenly spaced scale. An axis is one scale
   and gets one format: the fewest decimals that write every tick on it
   exactly, and failing that (a span that does not divide into anything tidy)
   the fewest that keep the labels distinct. */
const axisFmt = (vals) => {
  const exact = (dp) => vals.every((v) =>
    Math.abs(parseFloat(v.toFixed(dp)) - v) <= Math.abs(v) * 1e-9 + 1e-12);
  for (let dp = 0; dp <= 2; dp++) if (exact(dp)) return (v) => v.toFixed(dp);
  for (let dp = 1; dp <= 3; dp++) {
    if (new Set(vals.map((v) => v.toFixed(dp))).size === vals.length) {
      return (v) => v.toFixed(dp);
    }
  }
  return (v) => v.toFixed(3);
};

function LineChart({ series, xmin, xmax, ymin, ymax, xlab, ylab, marks = [], vmarks = [] }) {
  /* The plot stops well short of the frame so end-of-curve labels have
     somewhere to live without running off the right-hand edge. */
  const x0 = 54, x1 = 556, y0 = 176, y1 = 34;
  /* A degenerate range would make every coordinate Infinity and wipe the
     plot out silently, so fall back to a unit span. */
  const xs = xmax - xmin || 1, yspan = ymax - ymin || 1;
  const X = (v) => x0 + ((v - xmin) / xs) * (x1 - x0);
  const Y = (v) => y0 - ((v - ymin) / yspan) * (y0 - y1);
  const gl = { stroke: "#1D2938", strokeWidth: 1, fill: "none" };
  const xt = [], yt = [];
  for (let i = 0; i <= 4; i++) { xt.push(xmin + (i * xs) / 4); yt.push(ymin + (i * yspan) / 4); }
  const xf = axisFmt(xt), yf = axisFmt(yt);
  const live = (series || []).filter((s) => s && s.pts && s.pts.length);

  /* Every label wants to sit at the right-hand end of its own curve, and
     several curves converge there — six LLC gain curves land within three
     pixels of one another, and the two class-E traces end at exactly the
     same point. Collect all of them, plus the horizontal marks, and lay the
     whole column out in one pass. Off-scale marks are pinned to the edge
     and flagged rather than drawn outside the frame, where they vanish. */
  /* Series labels live in the gutter to the right of the plot; mark labels
     sit inside it, against the right edge. They are two separate columns,
     so each gets its own layout pass — sharing one would over-constrain
     both and push labels away from the thing they name for no reason. */
  const sLabs = [], mLabs = [];
  live.forEach((s) => {
    if (!s.label) return;
    const last = s.pts[s.pts.length - 1];
    sLabs.push({ want: Y(last[1]) - 5, x: X(last[0]) + 7, t: s.label, c: s.c, a: "start" });
  });
  (marks || []).forEach((m) => {
    const off = m.y > ymax ? " (above scale)" : m.y < ymin ? " (below scale)" : "";
    mLabs.push({ want: Y(clamp(m.y, ymin, ymax)) - 5, x: x1 - 5,
      t: m.t + off, c: m.c || "#6FD39B", a: "end",
      rule: clamp(m.y, ymin, ymax), off: !!off });
  });
  const sy = layoutLabels(sLabs.map((l) => l.want), 15, y1 + 2, y0 - 2);
  const my = layoutLabels(mLabs.map((l) => l.want), 15, y1 + 2, y0 - 2);
  const labs = [...mLabs.map((l, i) => ({ ...l, y: my[i] })),
    ...sLabs.map((l, i) => ({ ...l, y: sy[i], kind: "s" }))];

  return (
    <div className="sch"><svg viewBox="0 0 660 218" style={{ width: "100%", height: "auto", display: "block" }}>
      {drawScope("lc", () => (<>
        {/* the y-axis caption sits above the plot, clear of the top tick.
            One type scale across every plotting surface: captions 10.5,
            word labels 9.5, numeric ticks 9 — the same ladder the waveform
            panes use, so the figures read as one instrument. */}
        {Tx(x0 - 7, y1 - 13, ylab, { a: "start", c: "#8DA0B4", s: 10.5 })}
        {xt.map((v, i) => <path key={"gx" + i} d={`M ${X(v)} ${y0} V ${y1}`} {...gl} />)}
        {yt.map((v, i) => <path key={"gy" + i} d={`M ${x0} ${Y(v)} H ${x1}`} {...gl} />)}
        {(vmarks || []).map((m, i) => (
          m.x > xmin && m.x < xmax ? (
            <g key={"vm" + i}>
              <path d={`M ${X(m.x)} ${y0} V ${y1}`} stroke={m.c || "#F0796C"} strokeWidth={1.1}
                strokeDasharray="4 4" fill="none" opacity={0.85} />
              {Tx(X(m.x) + 4, y0 - 6, m.t, { a: "start", c: m.c || "#F0796C", s: 9.5 })}
            </g>
          ) : null
        ))}
        {labs.map((l, i) => (l.rule !== undefined ? (
          <path key={"mr" + i} d={`M ${x0} ${Y(l.rule)} H ${x1}`} stroke={l.c}
            strokeWidth={1.1} strokeDasharray="4 4" fill="none" opacity={l.off ? 0.45 : 1} />
        ) : null))}
        {live.map((s, i) => (
          <path key={"s" + i} d={s.pts.map((p, j) => `${j ? "L" : "M"} ${X(p[0])} ${Y(p[1])}`).join(" ")}
            stroke={s.c} strokeWidth={s.w || 1.6} fill="none" opacity={s.o || 1} strokeLinejoin="round" />
        ))}
        {labs.map((l, i) => (
          <g key={"lb" + i}>
            {/* a leader line, because a nudged label no longer touches its curve */}
            {l.kind === "s" && Math.abs(l.y - l.want) > 3 ? (
              <path d={`M ${l.x - 4} ${l.want + 2} L ${l.x - 1} ${l.y - 3}`}
                stroke={l.c} strokeWidth={0.9} fill="none" opacity={0.55} />
            ) : null}
            {Tx(l.x, l.y, l.t, { a: l.a || "start", c: l.c, s: 9.5 })}
          </g>
        ))}
        {xt.map((v, i) => Tx(X(v), y0 + 16, xf(v), { a: "middle", c: "#8DA0B4", s: 9 }))}
        {yt.map((v, i) => Tx(x0 - 7, Y(v) + 3.5, yf(v), { a: "end", c: "#8DA0B4", s: 9 }))}
        {Tx((x0 + x1) / 2, y0 + 33, xlab, { a: "middle", c: "#8DA0B4", s: 10.5 })}
      </>))}
    </svg></div>
  );
}

/* --------------------------- input registry ---------------------------
   mn / mx are hard clamps applied in App before any design() sees the
   number, so a stray 0 or a negative can never propagate as Infinity or
   NaN into a result table. They are also fed to the <input> element so
   the browser's own validation agrees with ours.                       */
const FIELDS = {
  vacIn: { l: "V_ac in", u: "Vrms", d: 230, mn: 1, mx: 1000 },
  idc: { l: "I_dc load", u: "A", d: 1, mn: 1e-3, mx: 1e4 },
  cbulk: { l: "C_bulk", u: "µF", d: 470, mn: 0.1, mx: 1e6 },
  vsec: { l: "V_sec (square)", u: "V", d: 12, mn: 0.1, mx: 1e4 },
  dnom: { l: "duty D", u: "", d: 0.4, s: 0.01, mn: 0.01, mx: 0.99 },
  ql: { l: "loaded Q", u: "", d: 6, s: 0.5, mn: 0.1, mx: 100 },
  vg: { l: "V_gate", u: "V", d: 10, mn: 1, mx: 30 },
  vinMin: { l: "V_in min", u: "V", d: 9, mn: 0.1, mx: 2000 },
  vinNom: { l: "V_in nom", u: "V", d: 12, mn: 0.1, mx: 2000 },
  vinMax: { l: "V_in max", u: "V", d: 16, mn: 0.1, mx: 2000 },
  vout: { l: "V_out", u: "V", d: 3.3, mn: 0.05, mx: 2000 },
  iout: { l: "I_out", u: "A", d: 10, mn: 1e-3, mx: 1e4 },
  fsw: { l: "f_sw", u: "kHz", d: 500, mn: 0.1, mx: 1e5 },
  /* Ripple ratio. The ceiling has to sit above 2, or discontinuous
     conduction is unreachable: ΔI is proportional to I_out here, so the
     boundary I_out = ΔI/2 lands at ΔI/I ≈ 2 and the tool's own DCM warning
     could never fire. */
  r: { l: "ripple ΔI/I", u: "", d: 0.3, s: 0.05, mn: 0.01, mx: 3 },
  dvout: { l: "ΔV_out p-p", u: "mV", d: 30, mn: 0.1, mx: 1e5 },
  eff: { l: "target η", u: "", d: 0.9, s: 0.01, mn: 0.1, mx: 1 },
  esr: { l: "C_out ESR", u: "mΩ", d: 3, mn: 0, mx: 1e4 },
  /* How much inductance is left at the peak. Datasheets quote exactly this
     ("−20 % at 12 A"), and it is what bends the current ramp away from the
     textbook triangle: 0 draws the ideal straight ramp. */
  lsag: { l: "L roll-off at I_pk", u: "%", d: 20, s: 5, mn: 0, mx: 80 },
  rds: { l: "R_DS(on) hot", u: "mΩ", d: 8, mn: 0, mx: 1e5 },
  /* The low-voltage side of a two-sided converter. A 48 V bridge carrying n
     times the primary current is not built from the same part as the 400 V
     one facing it, and charging both to the same R_DS(on) made the secondary
     term n² times the primary — with the default turns ratio, 64× — which
     swamped every other line in the loss budget. */
  rdsS: { l: "R_DS(on) LV side", u: "mΩ", d: 1.5, s: 0.1, mn: 0, mx: 1e5 },
  vf: { l: "diode V_F", u: "V", d: 0.45, mn: 0, mx: 10 },
  /* Reverse recovery. The charge a pn diode has to sweep out before it can
     block, dumped through the device that is turning on — so it appears as
     Q_rr·V·f_sw whether or not the diode itself gets warm. It is the single
     reason CCM boost PFC front ends moved to SiC, and it was missing from
     every loss budget here. Zero is the honest default for a Schottky or a
     wide-bandgap device, which genuinely have none. */
  qrr: { l: "diode Q_rr", u: "nC", d: 0, s: 5, mn: 0, mx: 1e6 },
  dcr: { l: "L DCR", u: "mΩ", d: 4, mn: 0, mx: 1e4 },
  tsw: { l: "t_r + t_f", u: "ns", d: 20, mn: 0, mx: 1e5 },
  qg: { l: "Q_g per FET", u: "nC", d: 15, mn: 0, mx: 1e4 },
  nph: { l: "phases N", u: "", d: 3, s: 1, mn: 1, mx: 24 },
  dmax: { l: "D_max", u: "", d: 0.45, s: 0.01, mn: 0.05, mx: 0.9 },
  krp: { l: "K_rp = ΔI/I_pk", u: "", d: 0.6, s: 0.05, mn: 0.05, mx: 1 },
  pout: { l: "P_out", u: "W", d: 65, mn: 0.1, mx: 1e6 },
  vbus: { l: "V_bus", u: "V", d: 390, mn: 10, mx: 2000 },
  vacMin: { l: "V_ac min", u: "Vrms", d: 85, mn: 1, mx: 1000 },
  vacMax: { l: "V_ac max", u: "Vrms", d: 265, mn: 1, mx: 1000 },
  fline: { l: "f_line", u: "Hz", d: 50, mn: 1, mx: 1000 },
  thold: { l: "hold-up", u: "ms", d: 20, mn: 0.1, mx: 1e4 },
  vbusMin: { l: "V_bus min", u: "V", d: 320, mn: 10, mx: 2000 },
  fr: { l: "f_r", u: "kHz", d: 100, mn: 0.1, mx: 1e5 },
  ln: { l: "L_n = L_m/L_r", u: "", d: 5, s: 0.5, mn: 1.1, mx: 50 },
  qf: { l: "Q at full load", u: "", d: 0.4, s: 0.05, mn: 0.05, mx: 5 },
  vdc: { l: "V_dc link", u: "V", d: 400, mn: 1, mx: 5000 },
  vac: { l: "V_ac out", u: "Vrms", d: 230, mn: 1, mx: 2000 },
  fo: { l: "f_out", u: "Hz", d: 50, mn: 0.1, mx: 5000 },
  v2: { l: "V2", u: "V", d: 48, mn: 0.1, mx: 2000 },
  phi: { l: "phase shift φ", u: "°", d: 45, mn: 1, mx: 89 },
  lr: { l: "L_r", u: "µH", d: 20, mn: 0.01, mx: 1e5 },
  nstg: { l: "stages N", u: "", d: 3, s: 1, mn: 1, mx: 20 },
  cfly: { l: "C_pump", u: "µF", d: 1, mn: 1e-3, mx: 1e4 },
  ncell: { l: "turns ratio n", u: "", d: 4, s: 0.5, mn: 0.05, mx: 200 },
  td: { l: "dead time", u: "ns", d: 100, mn: 0, mx: 1e5 },
  coss: { l: "C_oss (eff)", u: "pF", d: 300, mn: 1, mx: 1e6 },
  llk: { l: "L_leak", u: "µH", d: 3, mn: 0.001, mx: 1e4 },
  vclamp: { l: "clamp V", u: "V", d: 130, mn: 1, mx: 5000 },
};
/* Fields that only mean anything in order.

   Every entry above carries its own mn/mx, and a range check on one number
   cannot see the other two: a minimum input above the maximum input is inside
   both ranges and still nonsense. Left alone it reached the design functions,
   where it divided by (V_bus² − V_bus(min)²) of zero and handed back an
   infinite bulk capacitor, or picked a boost duty from the wrong corner and
   printed negative farads. Rather than teach thirty design functions to
   re-check the same thing, the order is restored once, here, beside the
   ranges — so design() keeps its promise that inputs arrive usable.

   Later members are raised to meet earlier ones, so the value the reader most
   recently lowered stays put and the ones that no longer fit move visibly:
   `Fields` marks every number the sanitiser had to rewrite, by either rule. */
const ORDERED = [
  ["vinMin", "vinNom", "vinMax"],
  ["vacMin", "vacMax"],
  ["vbusMin", "vbus"],
];
const order = (o) => {
  for (const grp of ORDERED) {
    const have = grp.filter((k) => Number.isFinite(o[k]));
    for (let i = 1; i < have.length; i++) {
      if (o[have[i]] < o[have[i - 1]]) o[have[i]] = o[have[i - 1]];
    }
  }
  return o;
};
/* The switching period in seconds, so a waveform can carry real time rather
   than an anonymous "T". Both routes to a `Wave` read it from here: the
   animated card and the plain results panel drew the same figure with two
   different x-axes for a while, because only one of them knew the frequency. */
const swPeriod = (spec) => (spec && spec.fsw > 0 ? 1 / (spec.fsw * 1e3) : null);
const G = (t, rows) => ({ t, rows });
const R = (k, v, n) => [k, v, n || ""];
/* ESR in ohms from the mΩ field, and zero where a topology does not offer
   one. A design that has no ESR input still gets a ripple pane; it just gets
   the charge term alone, which is what its own C_out formula assumes. */
const esrOhm = (s) => (Number(s.esr) > 0 ? s.esr * 1e-3 : 0);
/* A conversion ratio the topology cannot reach is a design error, not a set
   of numbers. Returning this says so, instead of printing a duty above 1
   and a negative inductance as though they meant something. */
const infeasible = (msg) => ({ hi: [], warn: [msg], groups: [], infeasible: true });
/* alias, for design functions that need R as a resistance */
const R2 = R;

/* ===================== topologies — non-isolated ===================== */
const TA = [
{
  id: "buck", name: "Buck", cat: "Non-isolated DC–DC", sch: "buck",
  tag: "Step down. The reference converter — everything else is a variation on it.",
  chips: ["step-down", "continuous i_out", "M = D"],
  what: "The switch chops V_in into a square wave at the SW node; the LC filter passes its average. Output current is continuous, so the output cap only has to swallow the inductor ripple — which is why buck outputs are quiet and buck output caps are small.",
  eqs: [
    { e: "M = V_out / V_in = D", n: "ideal CCM; add diode and R_DS drops for the real duty" },
    { e: "L = V_out·(1 − D) / (f_sw·ΔI_L)", n: "ripple is worst at V_in max" },
    { e: "C_out = ΔI_L / (8·f_sw·ΔV)", n: "charge term only; add ΔV_ESR = ΔI_L·ESR" },
    { e: "I_Cin(rms) = I_out·√(D(1 − D))", n: "peaks at D = 0.5 — size the input cap here" },
    { e: "I_out(crit) = ΔI_L / 2", n: "below this the converter drops into DCM" },
  ],
  pros: ["Simplest topology, smallest part count", "Continuous output current → small C_out, low ripple", "Well-behaved control-to-output response, no RHP zero"],
  cons: ["Pulsating input current → needs real input capacitance", "No isolation, no polarity inversion", "High-side gate drive needs a bootstrap or isolated supply"],
  use: ["Point-of-load rails", "Battery→logic conversion", "Pre-regulators"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "coss", "qrr", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => Vo / (v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    if (Dx >= 1) return infeasible("A buck can only step down, and reaching " + eng(Vo, "V")
      + " from " + eng(s.vinMin, "V") + " at " + pct(s.eff) + " efficiency would need a duty of "
      + f2(Dx) + ". Lower V_out, raise V_in min, or use a boost or buck-boost stage.");
    const dI = s.r * Io, L = Vo * (1 - Dm) / (fs * dI);
    const dIn = Vo * (1 - Dn) / (fs * L);
    /* L is sized so the ripple hits its target at V_in max, which is also
       where the ripple — and therefore the core's peak flux — is worst.  */
    const Ipk = Io + dI / 2, ILr = Math.sqrt(Io * Io + dIn * dIn / 12);
    const Co = dI / (8 * fs * s.dvout * 1e-3), dVe = dI * s.esr * 1e-3;
    const Ihs = Math.sqrt(Dn * (Io * Io + dIn * dIn / 12));
    const Pc = Ihs * Ihs * s.rds * 1e-3;
    const Pcr = 0.5 * s.vinNom * Io * s.tsw * 1e-9 * fs;
    /* Two losses that hide in the switch rather than in the part that causes
       them. C_oss is the switch's own output capacitance, charged to V_in
       every cycle and then short-circuited by its own channel at turn-on;
       Q_rr is the charge the catch diode has to sweep out before it can
       block, which the switch pulls through itself against the full rail.
       Neither warms the diode much, and both scale with f_sw — which is why
       raising f_sw to shrink the inductor stops paying at some point. */
    const Poss = 0.5 * s.coss * 1e-12 * s.vinNom * s.vinNom * fs;
    const Prr = s.qrr * 1e-9 * s.vinNom * fs;
    const Psw = Pcr + Poss;
    const Pd = s.vf * Io * (1 - Dn), Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Psw + Prr + Pd + Pl, eta = Vo * Io / (Vo * Io + Pt);
    const fLC = 1 / (2 * Math.PI * Math.sqrt(L * Co));
    return {
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["output cap", eng(Co, "F")]],
      loss: [["Q1 conduction", Pc, "I_rms²·R_DS(on), hot"],
        ["Q1 switching", Psw, "½·V_in·I_L·(t_r+t_f)·f_sw + ½·C_oss·V_in²·f_sw"],
        ["Diode reverse recovery", Prr, "Q_rr·V_in·f_sw — dissipated in Q1, not the diode"],
        ["Diode", Pd, "V_F·I_out·(1−D)"], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      /* The capacitor sees the inductor ripple and nothing else — output
         current is continuous. C_out was sized at V_in max, where the ripple
         is worst, so the pane's ripple at nominal input is the smaller
         number, which is the honest one to show beside the nominal duty. */
      wave: { sat: s.lsag / 100, D: Dn, dI: dIn, iavg: Io , vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        Dx > 0.85 && "D reaches " + f3(Dx) + " at V_in min — check the controller's max duty and t_on.",
        Dm < 0.05 && "D falls to " + f3(Dm) + " at V_in max — t_on may be shorter than the minimum on-time.",
        /* The DCM warning is shared now — Results derives it from the same
           test the cycle model draws from, for every topology at once. */
      ].filter(Boolean),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("t_on at V_in max", eng(Dm / fs, "s"), "minimum on-time limit"),
          R("Inductor ripple ΔI_L", eng(dIn, "A"), pct(dIn / Io) + " of I_out at nominal"),
          R("I_L peak (worst case) / rms", eng(Ipk, "A") + " · " + eng(ILr, "A"),
            "peak taken at V_in max, where ripple is largest — size the core here"),
          R("DCM boundary", eng(dI / 2, "A")),
        ]),
        G("Passives", [
          R("L", eng(L, "H"), "sized at V_in max"),
          R("C_out (charge)", eng(Co, "F"), "for ΔV = " + s.dvout + " mV"),
          R("ΔV from ESR", eng(dVe, "V"), dVe > s.dvout * 1e-3 ? "ESR dominates — lower it" : "within budget"),
          R("C_in rms current", eng(Io * Math.sqrt(Dn * (1 - Dn)), "A"), "at nominal duty"),
          R("LC corner", eng(fLC, "Hz")),
        ]),
        G("Stresses", [
          R("Switch / diode V", eng(s.vinMax, "V"), "derate ≥ 1.3× for ringing"),
          R("Q1 rms current", eng(Ihs, "A")),
          R("Diode average current", eng(Io * (1 - Dn), "A")),
        ]),
        G("Loss budget (nominal)", [
          R("Q1 conduction", eng(Pc, "W")),
          R("Q1 switching", eng(Psw, "W"), "crossover " + eng(Pcr, "W") + " + C_oss " + eng(Poss, "W")),
          R("Diode reverse recovery", eng(Prr, "W"),
            s.qrr > 0 ? "set Q_rr to 0 for a Schottky or SiC diode" : "zero — a Schottky has no stored charge"),
          R("Diode", eng(Pd, "W"), "replace with a FET if this dominates"),
          R("Inductor DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
        G("Control", [
          R("Suggested f_c", eng(fs / 10, "Hz"), "f_sw/10 is a safe ceiling"),
          R("Modulator gain", f2(s.vinNom) + " V/V", "voltage mode, V_ramp = 1 V"),
          R("Plant", "double pole at " + eng(fLC, "Hz"), "plus the C_out ESR zero"),
        ]),
      ],
    };
  },
},
{
  id: "syncbuck", name: "Synchronous buck", cat: "Non-isolated DC–DC", sch: "syncbuck",
  tag: "A buck with the catch diode replaced by a FET. The default for anything above a few amps.",
  chips: ["step-down", "high current", "bidirectional"],
  what: "Swapping the diode for a low-side FET turns a fixed 0.4 V drop into I·R_DS(on). Below roughly 5 V output that is the single biggest efficiency lever. The penalty is a shoot-through risk, so dead time and gate drive matter.",
  eqs: [
    { e: "M = D", n: "same as the buck; forced-PWM holds this into light load" },
    { e: "P_LS = I_rms²·R_DS + V_F·I_out·2·t_dead·f_sw", n: "body diode conducts during the dead time" },
    { e: "P_gate = Q_g·V_drive·f_sw", n: "per FET — matters above ~1 MHz" },
    { e: "P_sw ≈ ½·V_in·I_out·(t_r + t_f)·f_sw + ½·C_oss·V_in^2·f_sw", n: "only the high-side FET hard-switches; the C_oss term is the charge dumped into the SW node each turn-on" },
  ],
  pros: ["Much lower conduction loss at low V_out", "Inherently bidirectional — works as a boost in reverse", "Forced PWM gives a fixed frequency at any load"],
  cons: ["Shoot-through risk; dead time must be right", "Reverse inductor current at light load costs efficiency unless you allow DCM", "Two gate drives"],
  use: ["CPU / FPGA core rails", "48 V→12 V intermediate bus", "Battery chargers"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "qg", "vg", "coss", "td", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => Vo / (v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    if (Dx >= 1) return infeasible("A buck can only step down, and reaching " + eng(Vo, "V")
      + " from " + eng(s.vinMin, "V") + " at " + pct(s.eff) + " efficiency would need a duty of "
      + f2(Dx) + ". Lower V_out, raise V_in min, or use a four-switch buck-boost.");
    const dI = s.r * Io, L = Vo * (1 - Dm) / (fs * dI);
    const dIn = Vo * (1 - Dn) / (fs * L);
    const Ipk = Io + dI / 2, ILr = Math.sqrt(Io * Io + dIn * dIn / 12);
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    const Ihs = Math.sqrt(Dn * (Io * Io + dIn * dIn / 12));
    const Ils = Math.sqrt((1 - Dn) * (Io * Io + dIn * dIn / 12));
    const Pc = Ihs * Ihs * s.rds * 1e-3, Pls = Ils * Ils * s.rds * 1e-3;
    const Pcr = 0.5 * s.vinNom * Io * s.tsw * 1e-9 * fs;
    const Poss = 0.5 * s.coss * 1e-12 * s.vinNom * s.vinNom * fs;
    const Psw = Pcr + Poss;
    /* What conducts across the dead time is the low-side FET's BODY diode,
       which drops something like 0.8 V — not the 0.45 V of the Schottky the
       V_F field defaults to. Taking the lower of the two keeps the field
       meaningful: leave it at a Schottky value and you are modelling one
       fitted in parallel, which is exactly what that part is for and is the
       only way the drop comes down. */
    const Vbody = Math.min(s.vf, 0.8);
    const Pdt = Vbody * Io * 2 * s.td * 1e-9 * fs, Pg = 2 * s.qg * 1e-9 * s.vg * fs;
    const Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Pls + Psw + Pdt + Pg + Pl, eta = Vo * Io / (Vo * Io + Pt);
    return {
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["est. efficiency", pct(eta)]],
      loss: [["HS conduction", Pc, "I_HS(rms)²·R_DS(on)"], ["HS switching", Psw, "½·V_in·I_L·(t_r+t_f)·f_sw + ½·C_oss·V_in²·f_sw"],
        ["LS conduction", Pls, "I_LS(rms)²·R_DS(on)"],
        ["Body diode", Pdt, "2·V_body·I_out·t_dead·f_sw at " + f2(Vbody) + " V"],
        ["Gate drive", Pg, "2·Q_g·V_gate·f_sw"], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      wave: { rect: "sync", sat: s.lsag / 100, D: Dn, dI: dIn, iavg: Io , vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        Ils * Ils * s.rds * 1e-3 > Pc * 2.2 && "The low-side FET carries most of the conduction loss — consider a larger LS device or an asymmetric pair.",
        dIn / 2 > Io && "Inductor ripple exceeds the DC current: current reverses each cycle. Fine for forced PWM, wasteful at light load.",
      ].filter(Boolean),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("ΔI_L", eng(dIn, "A"), pct(dIn / Io) + " of I_out"),
          R("I_L peak / rms", eng(Ipk, "A") + " · " + eng(ILr, "A")),
          R("HS / LS rms current", eng(Ihs, "A") + " · " + eng(Ils, "A")),
        ]),
        G("Passives", [
          R("L", eng(L, "H")), R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng(dI * s.esr * 1e-3, "V")),
          R("C_in rms current", eng(Io * Math.sqrt(Dn * (1 - Dn)), "A")),
        ]),
        G("Loss budget (nominal)", [
          R("HS conduction / switching", eng(Pc, "W") + " · " + eng(Psw, "W")),
          R("— of which C_oss", eng(Poss, "W"), "½·C_oss·V_in²·f_sw, lost at every HS turn-on"),
          R("LS conduction", eng(Pls, "W"), "hard-switching loss ≈ 0"),
          R("Body diode (dead time)", eng(Pdt, "W"), "2 × " + s.td + " ns per cycle"),
          R("Gate drive (both)", eng(Pg, "W"), "at V_gate = " + s.vg + " V"),
          R("Inductor DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
        G("Design notes", [
          R("SW node dV/dt", s.tsw > 0 ? eng(s.vinNom / (s.tsw * 1e-9), "V/s") : "—", "drives EMI and Miller turn-on"),
          R("Bootstrap cap", eng(s.qg * 1e-9 / 0.1, "F") + " min", "for 100 mV droop, use 10–100×"),
        ]),
      ],
    };
  },
},
{
  id: "multiphase", name: "Multiphase / interleaved buck", cat: "Non-isolated DC–DC", sch: "multiphase",
  tag: "N buck stages sharing one output, clocked 360°/N apart. Ripple cancels, heat spreads.",
  chips: ["high current", "ripple cancellation", "N phases"],
  what: "Interleaving splits the current N ways and shifts the ripple so it partly cancels at the output. Input rms current drops sharply — frequently the primary motivation for interleaving — and the effective output ripple frequency becomes N·f_sw, so the same transient response needs less capacitance.",
  eqs: [
    { e: "M = D", n: "each phase is an ordinary buck" },
    { e: "K_cancel = (m + 1 − N·D)·(N·D − m) / ((1 − D)·N·D)", n: "m = floor(N·D); ripple multiplier vs one phase" },
    { e: "ΔI_out = ΔI_phase · K_cancel", n: "zero at D = m/N — the sweet spots" },
    { e: "f_ripple = N · f_sw", n: "output cap sees the interleaved frequency" },
  ],
  pros: ["Current and loss split across devices and copper", "Dramatically lower input and output ripple", "Faster transient response per unit of output capacitance"],
  cons: ["N× the parts, gate drives and current sensing", "Needs current sharing between phases", "Layout symmetry becomes critical"],
  use: ["CPU/GPU core rails (hundreds of amps)", "48 V→12 V converters", "High-current chargers"],
  fields: ["vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "nph", "rds", "dcr", "tsw", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, N = Math.max(1, Math.round(s.nph));
    const Dn = Vo / (s.vinNom * s.eff), Dm = Vo / (s.vinMax * s.eff);
    if (Dn >= 1) return infeasible("Each phase is a buck, so it can only step down. Reaching "
      + eng(Vo, "V") + " from " + eng(s.vinNom, "V") + " would need a duty of " + f2(Dn) + ".");
    const Iph = Io / N, dI = s.r * Iph;
    const L = Vo * (1 - Dm) / (fs * dI);
    const dIn = Vo * (1 - Dn) / (fs * L);
    const m = Math.floor(N * Dn);
    /* Kcancel is only defined for 0 < D < 1; outside that the converter is
       not operating and the expression changes sign rather than blowing up
       visibly, so pin it to the no-benefit value and let the warn explain. */
    const K = Dn > 0 && Dn < 1
      ? ((m + 1 - N * Dn) * (N * Dn - m)) / ((1 - Dn) * N * Dn)
      : 1;
    const dIo = dIn * K;
    const Co = dIo / (8 * N * fs * s.dvout * 1e-3);
    const Iph_rms = Math.sqrt(Iph * Iph + dIn * dIn / 12);
    const Pc = N * Dn * Iph_rms * Iph_rms * s.rds * 1e-3;
    const Psw = N * 0.5 * s.vinNom * Iph * s.tsw * 1e-9 * fs;
    const Pl = N * Iph_rms * Iph_rms * s.dcr * 1e-3;
    return {
      hi: [["per-phase current", eng(Iph, "A")], ["ripple cancellation", "×" + f2(K)], ["output ripple f", eng(N * fs, "Hz")]],
      loss: [["Conduction", Pc, "N·D·I_phase(rms)²·R_DS(on)"], ["Switching", Psw, "N·½·V_in·I_ph·(t_r+t_f)·f_sw"],
        ["Inductor DCR", Pl, "N·I_phase(rms)²·DCR"]],
      /* One phase is plotted; the capacitor sees all N. Handing the model the
         phase count rather than the cancelled ripple means the pane derives
         the cancellation from the waveforms themselves — so if K above is
         ever wrong, the two disagree visibly instead of agreeing quietly. */
      wave: { rect: "sync", sat: s.lsag / 100, D: Dn, dI: dIn, iavg: Iph, vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, n: N } },
      warn: [
        /* Dn ≥ 1 cannot reach here — infeasible() returned above. */
        K < 0.05 && "You are sitting almost exactly on a cancellation null (D ≈ m/N) — real output ripple will be set by ESR and mismatch, not by this number.",
      ].filter(Boolean),
      groups: [
        G("Per phase", [
          R("Phases", String(N)), R("Duty (nom)", f3(Dn)),
          R("DC current per phase", eng(Iph, "A")),
          R("ΔI per phase", eng(dIn, "A")),
          R("Peak per phase", eng(Iph + dIn / 2, "A")),
          R("L per phase", eng(L, "H")),
        ]),
        G("Output", [
          R("Cancellation factor", f3(K), "1.0 = no benefit, 0 = perfect"),
          R("Net output ripple", eng(dIo, "A"), "into C_out"),
          R("Ripple frequency", eng(N * fs, "Hz")),
          R("C_out (charge)", eng(Co, "F")),
          R("Cancellation null duties",
            N > 1 ? Array.from({ length: N - 1 }, (_, i) => f2((i + 1) / N)).join(" · ") : "none",
            N > 1 ? "ripple → 0 at D = m/N, m = 1…N−1" : "a single phase has nothing to cancel against"),
        ]),
        G("Loss budget", [
          R("Total conduction (HS)", eng(Pc, "W")), R("Total switching", eng(Psw, "W")),
          R("Total DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pc + Psw + Pl, "W") + " → " + pct(Vo * Io / (Vo * Io + Pc + Psw + Pl))),
        ]),
      ],
    };
  },
},
{
  id: "boost", name: "Boost", cat: "Non-isolated DC–DC", sch: "boost",
  tag: "Step up. Continuous input current, pulsating output — and a right-half-plane zero.",
  chips: ["step-up", "RHP zero", "no inrush protection"],
  what: "The inductor sits at the input, so input current is smooth and boost stages make good PFC front ends. The output is fed in pulses, so C_out works hard. There is no path to disconnect the load: V_in always reaches the output through the diode.",
  eqs: [
    { e: "M = 1 / (1 − D)", n: "so D = 1 − V_in/V_out" },
    { e: "I_L = I_out / (1 − D)", n: "input current, not output current — size the inductor for it" },
    { e: "L = V_in·D / (f_sw·ΔI_L)", n: "ripple worst near D = 0.5" },
    { e: "C_out = I_out·D / (f_sw·ΔV)", n: "charge term; ESR term is I_pk·ESR" },
    { e: "f_RHPZ = (1 − D)²·R_load / (2π·L)", n: "cross over below f_RHPZ/5 or the loop fights you" },
  ],
  pros: ["Continuous, low-ripple input current", "Ground-referenced switch — trivial gate drive", "Only one magnetic component"],
  cons: ["RHP zero forces a slow loop", "No output disconnect or short-circuit protection", "Output cap carries large rms ripple"],
  use: ["Battery→higher rail", "LED drivers", "PFC front ends", "Photovoltaic MPPT"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "coss", "qrr", "lsag"],
  defs: { vinMin: 9, vinNom: 12, vinMax: 16, vout: 24, iout: 3, fsw: 300, r: 0.35 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => 1 - (v * s.eff) / Vo;
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    /* A boost only steps up. Below that the duty goes negative, and every
       number built on it follows: √D is NaN, so the loss bar and the whole
       efficiency map go blank rather than wrong, which is harder to diagnose
       than a sentence saying what happened. */
    if (Dn <= 0) return infeasible("A boost can only step up, and " + eng(Vo, "V")
      + " is at or below the nominal input of " + eng(s.vinNom, "V") + " once " + pct(s.eff)
      + " efficiency is allowed for. Raise V_out, lower V_in nom, or use a buck-boost — "
      + "that one covers inputs above and below the output.");
    const IL = Io / (1 - Dn), ILx = Io / (1 - Dx);
    /* ΔI_L ∝ V_in·D = V_in·(1 − η·V_in/V_out), which is maximised at
       D = 0.5 — i.e. V_in = V_out/2η — not at either end of the input
       range. Size L against whichever point in range is actually worst. */
    const vsProd = (v) => v * du(v);
    const vHalf = Vo / (2 * s.eff);
    const inRange = vHalf > s.vinMin && vHalf < s.vinMax;
    const vWorst = [s.vinMin, s.vinMax, ...(inRange ? [vHalf] : [])]
      .reduce((a, b) => (vsProd(b) > vsProd(a) ? b : a));
    const dI = s.r * ILx, L = vsProd(vWorst) / (fs * dI);
    const dIn = vsProd(s.vinNom) / (fs * L);
    const Ipk = ILx + dI / 2;
    const ILr = Math.sqrt(IL * IL + dIn * dIn / 12);
    const Co = Io * Dx / (fs * s.dvout * 1e-3);
    /* i_C = −I_out while the switch is on, and (i_L − I_out) while the
       diode conducts. Integrating both intervals closes to the form below;
       the second term is the inductor-ripple contribution.              */
    const Icr = Math.sqrt(Io * Io * Dn / (1 - Dn) + (1 - Dn) * dIn * dIn / 12);
    const Iq = Math.sqrt(Dn) * ILr;
    const Pc = Iq * Iq * s.rds * 1e-3;
    const Pcr = 0.5 * Vo * IL * s.tsw * 1e-9 * fs;
    /* The switch turns on into a conducting boost diode, so it pulls that
       diode's stored charge through itself against the full output rail
       before the diode can block. In continuous conduction this is often the
       largest single switching term, and it is the reason a CCM boost that
       matters gets a SiC or GaN diode with no stored charge at all. */
    const Poss = 0.5 * s.coss * 1e-12 * Vo * Vo * fs;
    const Prr = s.qrr * 1e-9 * Vo * fs;
    const Psw = Pcr + Poss;
    const Pd = s.vf * Io, Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Psw + Prr + Pd + Pl, eta = Vo * Io / (Vo * Io + Pt);
    const Rld = Vo / Io, frhp = (1 - Dx) * (1 - Dx) * Rld / (2 * Math.PI * L);
    return {
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["RHP zero", eng(frhp, "Hz")]],
      loss: [["Switch conduction", Pc, "I_rms²·R_DS(on), hot"],
        ["Switch switching", Psw, "½·V_out·I_L·(t_r+t_f)·f_sw + ½·C_oss·V_out²·f_sw"],
        ["Diode reverse recovery", Prr, "Q_rr·V_out·f_sw — often the largest term in CCM"],
        ["Diode", Pd, "V_F·I_out"], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      /* Pulse-fed output: while the switch is on the diode is blocking and the
         capacitor alone holds the rail up, then takes the whole inductor
         current at turn-off — peak first, decaying to the valley. That step is
         why a boost output cap is an order of magnitude larger than a buck's
         for the same ripple, and the pane is where you can see it. */
      wave: { sat: s.lsag / 100, D: Dn, dI: dIn, iavg: IL , vlabel: "v_SW", vhi: "V_out", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          i0: IL + dIn / 2, i1: IL - dIn / 2 } },
      warn: [
        Dx > 0.8 && "D = " + f3(Dx) + " at V_in min. Conduction loss and the RHP zero both degrade rapidly beyond about 0.8 — consider two stages or a transformer-based topology.",
        s.vinMax > Vo && "V_in max exceeds V_out. A boost cannot regulate down; the output will follow the input through the diode.",
      ].filter(Boolean),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Inductor DC current (nom)", eng(IL, "A"), "= I_out/(1−D)"),
          R("Inductor DC current (worst)", eng(ILx, "A"), "at V_in min"),
          R("ΔI_L", eng(dIn, "A")),
          R("I_L peak", eng(Ipk, "A"), "saturation limit"),
        ]),
        G("Passives", [
          R("L", eng(L, "H"), "sized at V_in = " + eng(vWorst, "V") + " (D = " + f3(du(vWorst)) + ")"
            + (inRange ? ", the D = 0.5 worst case inside your range" : ", the worst case in your range")),
          R("C_out (charge)", eng(Co, "F"), "for ΔV = " + s.dvout + " mV"),
          R("ΔV from ESR", eng(Ipk * s.esr * 1e-3, "V"), "usually dominant"),
          R("C_out rms current", eng(Icr, "A"), "≈ I_out·√(D/(1−D)) — this is what kills electrolytics"),
        ]),
        G("Stresses", [
          R("Switch / diode V", eng(Vo, "V"), "plus ringing — derate ≥ 1.3×"),
          R("Switch rms current", eng(Iq, "A")),
          R("Diode average current", eng(Io, "A")),
        ]),
        G("Loss budget (nominal)", [
          R("Switch conduction / switching", eng(Pc, "W") + " · " + eng(Psw, "W")),
          R("Diode reverse recovery", eng(Prr, "W"),
            s.qrr > 0 ? "swept through the switch at V_out — a SiC diode removes it entirely" : "zero — Schottky or SiC, no stored charge"),
          R("Diode", eng(Pd, "W")), R("Inductor DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
        G("Control", [
          R("RHP zero (worst case)", eng(frhp, "Hz"), "at V_in min, full load"),
          R("Max sensible f_c", eng(frhp / 5, "Hz"), "and ≤ f_sw/10"),
          R("Plant", "pole at " + eng(1 / (2 * Math.PI * (Rld / 2) * Co), "Hz"), "current mode, single pole at 2/(R_load·C_out)"),
        ]),
      ],
    };
  },
},
{
  id: "buckboost", name: "Inverting buck-boost", cat: "Non-isolated DC–DC", sch: "buckboost",
  tag: "Step up or down, with the output inverted. Both ports pulsate.",
  chips: ["inverting", "step up/down", "RHP zero"],
  what: "One switch, one inductor, one diode — the most compact way to make a negative rail. The cost is that both input and output currents are discontinuous, and every device sees V_in + |V_out|.",
  eqs: [
    { e: "M = −D / (1 − D)", n: "D = |V_out| / (V_in + |V_out|)" },
    { e: "I_L = I_out / (1 − D)", n: "the inductor carries input and output current" },
    { e: "V_switch = V_diode = V_in + |V_out|", n: "the defining penalty of this topology" },
    { e: "f_RHPZ = (1 − D)²·R_load / (2π·D·L)", n: "worse than the boost by a factor of D" },
  ],
  pros: ["Negative rail from one switch and one inductor", "Wide conversion range around unity", "Ground-referenced switch if you drive it high-side-free"],
  cons: ["Both ports pulsate → caps at both ends", "V_in + |V_out| device stress", "RHP zero in CCM"],
  use: ["Bias rails for op-amps and LCDs", "Negative gate-drive supplies", "Small industrial supplies"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "lsag"],
  defs: { vinMin: 9, vinNom: 12, vinMax: 16, vout: 12, iout: 2, fsw: 300, r: 0.35 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = Math.abs(s.vout), Io = s.iout;
    const du = (v) => Vo / (Vo + v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    const IL = Io / (1 - Dn), ILx = Io / (1 - Dx);
    /* ΔI = V_in·D/(L·f), and with D = V_out/(V_out + V_in·η) that product
       grows with V_in — the duty falls more slowly than the voltage rises. So
       the ripple is worst at V_in max, not at the V_in min corner where the
       DC current is worst. Those are different corners and this sized at the
       wrong one; ΔI is what L is for. */
    const dI = s.r * ILx, L = s.vinMax * Dm / (fs * dI);
    const dIn = s.vinNom * Dn / (fs * L);
    const Co = Io * Dx / (fs * s.dvout * 1e-3);
    const ILr = Math.sqrt(IL * IL + dIn * dIn / 12);
    const Iq = Math.sqrt(Dn) * ILr, Vst = s.vinMax + Vo;
    const Pc = Iq * Iq * s.rds * 1e-3, Psw = 0.5 * Vst * IL * s.tsw * 1e-9 * fs;
    const Pd = s.vf * Io, Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Psw + Pd + Pl;
    const Rl = Vo / Io, frhp = (1 - Dx) * (1 - Dx) * Rl / (2 * Math.PI * Dx * L);
    return {
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["device stress", eng(Vst, "V")]],
      loss: [["Switch conduction", Pc, "I_rms²·R_DS(on)"],
        ["Switching", Psw, "½·(V_in+V_out)·I_L·(t_r+t_f)·f_sw"],
        ["Diode", Pd, "V_F·I_out"], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      wave: { sat: s.lsag / 100, D: Dn, dI: dIn, iavg: IL , vlabel: "v_A", vhi: "V_in",
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          i0: IL + dIn / 2, i1: IL - dIn / 2 } },
      warn: [Dx > 0.8 && "D = " + f3(Dx) + " at V_in min — the inductor current is " + eng(ILx, "A") + " for only " + eng(Io, "A") + " of output."].filter(Boolean),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Inductor DC current", eng(IL, "A") + " (nom), " + eng(ILx, "A") + " (worst)"),
          R("ΔI_L", eng(dIn, "A")), R("I_L peak", eng(ILx + dI / 2, "A")),
        ]),
        G("Passives", [
          R("L", eng(L, "H")), R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng((ILx + dI / 2) * s.esr * 1e-3, "V")),
          R("C_in rms", eng(Io * Math.sqrt(Dn / (1 - Dn)), "A"), "both caps see pulsed current"),
        ]),
        G("Stresses", [
          R("Switch and diode V", eng(Vst, "V"), "V_in max + |V_out|"),
          R("Switch rms", eng(Iq, "A")), R("Diode average", eng(Io, "A")),
        ]),
        G("Loss and control", [
          R("Total loss", eng(Pt, "W")),
          R("Estimated efficiency", pct(Vo * Io / (Vo * Io + Pt))),
          R("RHP zero", eng(frhp, "Hz"), "cross over below " + eng(frhp / 5, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "fsbb", name: "Four-switch buck-boost", cat: "Non-isolated DC–DC", sch: "fsbb",
  tag: "Non-inverting step up/down that stays efficient when V_in ≈ V_out.",
  chips: ["non-inverting", "wide input", "bidirectional"],
  what: "A buck leg and a boost leg share one inductor. When V_in is comfortably above V_out it runs as a pure buck (boost leg static); below, as a pure boost. Only the narrow band around V_in ≈ V_out needs blended operation, and that band is where the design work is.",
  eqs: [
    { e: "buck mode: M = D_1", n: "Q3 off, Q4 on continuously" },
    { e: "boost mode: M = 1/(1 − D_3)", n: "Q1 on, Q2 off continuously" },
    { e: "buck-boost mode: M = D_1/(1 − D_3)", n: "used only in the transition band" },
    { e: "V_switch = max(V_in, V_out)", n: "not the sum — the big win over the inverting version" },
  ],
  pros: ["Devices only see the larger of the two rails", "High efficiency at V_in ≈ V_out (both legs mostly static)", "Bidirectional; ideal for battery systems"],
  cons: ["Four switches, four drives", "Mode transitions need careful hysteresis or they chatter", "Control is more complex than any single-mode converter"],
  use: ["USB-PD and battery chargers", "48 V systems with wide input", "Supercapacitor interfaces"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "rds", "dcr", "tsw", "lsag"],
  defs: { vinMin: 9, vinNom: 12, vinMax: 16, vout: 15, iout: 5, fsw: 300, r: 0.35 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const Db = Vo / (s.vinMax * s.eff);
    /* Where the whole input range sits above the output, the boost leg never
       runs and this duty comes out negative. That is not an error — it is a
       four-switch converter being used as a plain buck, which is a perfectly
       ordinary way to end up. Taken literally, though, it printed a negative
       inductance, a negative output capacitor and a NaN rms current, so it is
       clamped and the boost-only rows say they are unused instead. */
    const DboRaw = 1 - (s.vinMin * s.eff) / Vo;
    const boosts = DboRaw > 0;
    const Dbo = Math.max(DboRaw, 0);
    /* Which leg switches at the nominal input. Measured against V_out/η, the
       same corner the two duties above are, so the mode shown and the duty
       drawn can never come from different sides of the boundary. */
    const mode = s.vinNom * s.eff > Vo ? "buck" : "boost";
    const ILb = Io, ILbo = Io / (1 - Dbo);
    const ILmax = Math.max(ILb, ILbo);
    const dI = s.r * ILmax;
    const Lb = Vo * (1 - Db) / (fs * dI);
    const Lbo = boosts ? s.vinMin * Dbo / (fs * dI) : 0;
    const L = Math.max(Lb, Lbo);
    /* Boost mode sets the output capacitor because the load is carried by the
       cap alone during each on-time. With no boost mode the output current is
       continuous and only the inductor ripple has to be absorbed — the buck
       charge term, an order of magnitude smaller. */
    const Co = boosts ? Io * Dbo / (fs * s.dvout * 1e-3)
      : dI / (8 * fs * s.dvout * 1e-3);
    /* Buck-leg rms is worst at the HIGHEST buck duty, which occurs at the
       lowest input where the buck leg still runs — not at V_in max.     */
    const vBuckLo = Math.max(s.vinMin, Vo);
    const DbMax = Math.min(Vo / (vBuckLo * s.eff), 1);
    const IrmsBuck = Io * Math.sqrt(DbMax);
    const IrmsBoost = ILbo * Math.sqrt(Dbo);
    /* Loss budget: in either mode two switches conduct and two are static,
       so the inductor current passes through one R_DS(on) each way.     */
    const ILr = Math.sqrt(ILmax * ILmax + dI * dI / 12);
    const Pcond = 2 * ILr * ILr * s.rds * 1e-3;
    const Pdcr = ILr * ILr * s.dcr * 1e-3;
    const Psw = 0.5 * Math.max(s.vinMax, Vo) * ILmax * s.tsw * 1e-9 * fs;
    const Pt = Pcond + Pdcr + Psw, eta = Vo * Io / (Vo * Io + Pt);
    /* The figure follows whichever leg is switching at nominal input, so the
       duty and the inductor current are the operating mode's own — and so is
       the output capacitor's job. In buck mode the output inductor feeds the
       load continuously; in boost mode the far leg's rectifier delivers in
       pulses and the capacitor covers the on-time alone. Same hardware, two
       entirely different ripple mechanisms — which is exactly the thing that
       catches people out at the handover. */
    /* The same efficiency allowance the tabulated duties carry. Without it the
       figure was drawn from a duty a few points away from the one printed
       above it, which is exactly the kind of quiet disagreement the shared
       cycle model exists to prevent. */
    const Dw = mode === "buck" ? Vo / (s.vinNom * s.eff) : 1 - (s.vinNom * s.eff) / Vo;
    const ILw = mode === "buck" ? Io : Io / (1 - Dw);
    const capW = mode === "buck"
      ? { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs }
      : { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
        i0: ILw + dI / 2, i1: ILw - dI / 2 };
    return {
      hi: [["mode at V_in nom", mode], ["inductor", eng(L, "H")], ["est. efficiency", pct(eta)]],
      loss: [["Switch conduction", Pcond, "2·I_L(rms)²·R_DS(on) — one device per leg"],
        ["Switching", Psw, "½·max(V_in,V_out)·I_L·(t_r+t_f)·f_sw"],
        ["Inductor DCR", Pdcr, "I_L(rms)²·DCR"]],
      wave: { rect: "sync", sat: s.lsag / 100, D: Dw, dI, iavg: ILw,
        vlabel: "v_SW", vhi: "V_in", cap: capW },
      warn: [Math.abs(s.vinNom - Vo) / Vo < 0.1 && "V_in nom is inside the transition band. Plan the buck↔boost handover explicitly — this is where most designs oscillate."].filter(Boolean),
      groups: [
        G("Modes", [
          R("Buck duty at V_in max", f3(Db)),
          R("Boost duty at V_in min", boosts ? f3(Dbo) : "—",
            boosts ? "" : "the whole input range sits above V_out, so the boost leg never switches"),
          R("Transition band", eng(Vo * 0.9, "V") + " – " + eng(Vo * 1.1, "V"), "±10 % is a typical hysteresis window"),
          R("Mode at V_in nom", mode),
        ]),
        G("Passives", [
          R("L (buck-limited)", eng(Lb, "H")),
          R("L (boost-limited)", boosts ? eng(Lbo, "H") : "—", boosts ? "" : "boost leg unused"),
          R("L to use", eng(L, "H"), boosts ? "the larger of the two" : "the buck limit, the only one in play"),
          R("I_L in boost at V_in min", boosts ? eng(ILbo, "A") : "—"),
          R("C_out (charge)", eng(Co, "F"),
            boosts ? "boost mode dominates" : "buck ripple only — ΔI_L/(8·f_sw·ΔV)"),
        ]),
        G("Stresses", [
          R("Device voltage", eng(Math.max(s.vinMax, Vo), "V"), "max of the two rails, not the sum"),
          R("Peak I_L", eng(ILmax + dI / 2, "A"), "worst case across the range"),
          R("Q1/Q2 rms (buck)", eng(IrmsBuck, "A"), "at D = " + f3(DbMax) + ", the highest buck duty"),
          R("Q3/Q4 rms (boost)", boosts ? eng(IrmsBoost, "A") : "—",
            boosts ? "at V_in min" : "Q3 stays off and Q4 stays on — they carry I_L but never switch"),
        ]),
        G("Loss budget (worst case)", [
          R("Switch conduction", eng(Pcond, "W"), "two devices in the current path"),
          R("Switching", eng(Psw, "W")),
          R("Inductor DCR", eng(Pdcr, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
      ],
    };
  },
},
{
  id: "cuk", name: "Ćuk", cat: "Non-isolated DC–DC", sch: "cuk",
  tag: "Inverting step up/down with continuous current at both ports. Energy moves through a capacitor.",
  chips: ["inverting", "low ripple both ports", "capacitive transfer"],
  what: "The dual of the buck-boost: energy is transferred by C1 rather than by the inductor's stored field, and inductors sit at both ports so both currents are continuous. Coupling L1 and L2 on one core can steer ripple almost entirely into one winding.",
  eqs: [
    { e: "M = −D / (1 − D)", n: "same ratio as the buck-boost" },
    { e: "V_C1 = V_in + |V_out|", n: "the transfer cap holds the sum — and must handle it" },
    { e: "ΔI_L1 = ΔI_L2 = V_in·D / (L·f_sw)", n: "both windings see V_in during t_on" },
    { e: "I_C1(rms) = √(D·I_out² + (1 − D)·I_in²)", n: "the transfer cap is the reliability limit" },
  ],
  pros: ["Continuous current at both ports — small filters", "Ripple steering possible with coupled inductors", "Single switch"],
  cons: ["Transfer cap carries the full load current in rms terms", "Inverting output", "Fourth-order dynamics: harder to compensate"],
  use: ["Low-noise inverting rails", "Sensor and instrumentation supplies", "Some LED drivers"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "vf", "rds", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = Math.abs(s.vout), Io = s.iout;
    const du = (v) => Vo / (Vo + v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin);
    const Iin = Io * Dn / (1 - Dn);
    const dI = s.r * Math.max(Iin, Io);
    /* Both windings stand across V_in during t_on, so ΔI = V_in·D/(L·f). With
       D = V_out/(V_out + V_in·η) that product is V_in·V_out/(V_out + V_in·η),
       which RISES with V_in even though the duty falls — the duty shrinks more
       slowly than the voltage grows. So the ripple is worst at V_in max, the
       same corner the buck sizes at, and sizing at nominal left it over budget
       across the top of the input range. */
    const Dm = du(s.vinMax);
    const L1 = s.vinMax * Dm / (fs * dI), L2 = L1;
    const Vc1 = s.vinMax + Vo;
    const Ic1 = Math.sqrt(Dn * Io * Io + (1 - Dn) * Iin * Iin);
    const C1 = Io * Dn / (fs * 0.05 * Vc1);
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    /* Switch and diode both carry (I_in + I_out): the switch for D, the
       diode for (1 − D). That sum is what makes the Ćuk lossy at extremes. */
    const Isum = Iin + Io;
    const Iq = Isum * Math.sqrt(Dn);
    const Pc = Iq * Iq * s.rds * 1e-3;
    const Pd = s.vf * Isum * (1 - Dn);
    const Pt = Pc + Pd, eta = Vo * Io / (Vo * Io + Pt);
    return {
      hi: [["duty (nom)", f3(Dn)], ["L1 = L2", eng(L1, "H")], ["C1 rms current", eng(Ic1, "A")]],
      loss: [["Switch conduction", Pc, "((I_in+I_out)·√D)²·R_DS(on)"],
        ["Diode", Pd, "V_F·(I_in+I_out)·(1−D)"]],
      /* The pane plots L1, the input inductor — but the capacitor faces L2.
         Both windings see V_in during t_on so their ripples are equal, and L2
         carries I_out rather than I_in, so the capacitor's own current is
         handed over explicitly. Driving it from the plotted trace would draw
         the input winding's DC level onto the output ripple. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Iin, vlabel: "v_SW", vhi: "V_in+|V_out|", vinv: true,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, iavg: Io, dI } },
      warn: [Ic1 > 2 && "C1 carries " + eng(Ic1, "A") + " rms — use film or several ceramics in parallel, never a single electrolytic."].filter(Boolean),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom", f3(Dx) + " · " + f3(Dn)),
          R("Input DC current", eng(Iin, "A")),
          R("ΔI in each inductor", eng(dI, "A")),
        ]),
        G("Passives", [
          R("L1 (input)", eng(L1, "H")), R("L2 (output)", eng(L2, "H")),
          R("C1 voltage", eng(Vc1, "V"), "V_in max + |V_out|"),
          R("C1 rms current", eng(Ic1, "A")),
          R("C1 for 5 % ripple", eng(C1, "F")),
          R("C_out", eng(Co, "F"), "small — output current is continuous"),
        ]),
        G("Stresses", [
          R("Switch and diode V", eng(Vc1, "V")),
          R("Switch rms current", eng(Iq, "A"), "carries I_in + I_out during t_on"),
          R("Diode average current", eng(Isum * (1 - Dn), "A")),
        ]),
        G("Loss budget (nominal)", [
          R("Switch conduction", eng(Pc, "W")),
          R("Diode", eng(Pd, "W"), "replace with a FET if this dominates"),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta), "conduction terms only"),
        ]),
      ],
    };
  },
},
{
  id: "sepic", name: "SEPIC", cat: "Non-isolated DC–DC", sch: "sepic",
  tag: "Non-inverting step up/down with a DC-blocking cap. The go-to when V_in crosses V_out.",
  chips: ["non-inverting", "step up/down", "input isolation at DC"],
  what: "A boost stage followed by a capacitor-coupled buck-boost. The series cap blocks DC, so a shorted output does not drag the input down — a real advantage over the boost. Both inductors can share a core; when they do, ΔI depends on the coupled inductance.",
  eqs: [
    { e: "M = D / (1 − D)", n: "D = (V_out + V_F)/(V_in + V_out + V_F)" },
    { e: "V_Cs = V_in", n: "the coupling cap sits at the input voltage" },
    { e: "I_Cs(rms) = I_out·√((V_out + V_F)/V_in)", n: "worst at V_in min — this sizes C_s" },
    { e: "V_switch = V_in + V_out", n: "same penalty as the buck-boost" },
    { e: "I_L1 = I_out·D/(1 − D),  I_L2 = I_out", n: "L1 carries input current, L2 output current" },
  ],
  pros: ["Non-inverting, wide range around unity", "DC blocking gives short-circuit tolerance", "Coupled inductors cut part count"],
  cons: ["Large rms current in C_s", "V_in + V_out device stress", "Fourth-order plant with an RHP zero"],
  use: ["Automotive 12 V rails (crank to load-dump)", "Li-ion → 3.3 V/5 V", "LED drivers with wide input"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "vf", "rds", "esr", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, Vf = s.vf;
    const du = (v) => (Vo + Vf) / (v + Vo + Vf);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    const IL1 = Io * Dx / (1 - Dx);
    const dI = s.r * (IL1 + Io);
    /* ΔI here is the ripple of the SUM of the two winding currents — that is
       what the switch carries, what the diode carries, and what the capacitor
       pane integrates. During t_on both inductors stand across V_in (the
       coupling cap holds V_in, so L2 sees it too), so each one ripples by
       V_in·D/(f·L) and the sum ripples by twice that. Sizing L from the
       single-winding law left every winding rippling by the full ΔI and the
       sum by 2·ΔI — half the inductance the printed ripple asks for. */
    const L = 2 * s.vinMin * Dx / (fs * dI);
    const Ics = Io * Math.sqrt((Vo + Vf) / s.vinMin);
    const Cs = Io * Dx / (fs * 0.05 * s.vinMin);
    const Co = Io * Dx / (fs * s.dvout * 1e-3);
    const Vst = s.vinMax + Vo + Vf;
    /* dI is already the ripple of the SUMMED (L1 + L2) current, so the
       switch peak is the sum of the two DC currents plus half of it.    */
    const Ipk = IL1 + Io + dI / 2;
    const Isum = IL1 + Io;
    const Iq = Isum * Math.sqrt(Dx);
    const Pc = Iq * Iq * s.rds * 1e-3;
    const Pd = Vf * Io;
    const Pt = Pc + Pd, eta = Vo * Io / (Vo * Io + Pt);
    return {
      hi: [["duty (nom)", f3(Dn)], ["L1 = L2", eng(L, "H")], ["C_s rms", eng(Ics, "A")]],
      loss: [["Switch conduction", Pc, "((I_L1+I_L2)·√D)²·R_DS(on), at V_in min"],
        ["Diode", Pd, "V_F·I_out"]],
      /* The output diode carries both winding currents, and only while the
         switch is off — so the output is pulse-fed exactly as a boost's is.
         Their sum averages I_out/(1−D) over that interval, which is what
         closes the charge balance. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Io * Dn / (1 - Dn), vlabel: "v_SW", vhi: "V_in+V_out", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          i0: Io / (1 - Dn) + dI / 2, i1: Io / (1 - Dn) - dI / 2 } },
      warn: [
        Vst > 60 && "Device stress is " + eng(Vst, "V") + ". Above ~60 V a SEPIC starts to look expensive next to a flyback.",
        Ics > 3 && "C_s rms is " + eng(Ics, "A") + " — plan on several ceramics or a film cap.",
      ].filter(Boolean),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("I_L1 (input, worst)", eng(IL1, "A")), R("I_L2 (output)", eng(Io, "A")),
          R("Switch peak current", eng(Ipk, "A"), "I_L1 + I_L2 + ΔI/2"),
        ]),
        G("Passives", [
          R("L1 = L2 (uncoupled)", eng(L, "H"),
            "each winding then ripples by " + eng(dI / 2, "A") + "; the switch and diode see the sum, " + eng(dI, "A")),
          R("C_s voltage", eng(s.vinMax, "V"), "rate ≥ V_in max, derate ceramics for DC bias"),
          R("C_s rms current", eng(Ics, "A")),
          R("C_s for 5 % ripple", eng(Cs, "F")),
          R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng(Ipk * s.esr * 1e-3, "V")),
        ]),
        G("Stresses", [
          R("Switch / diode V", eng(Vst, "V"), "V_in max + V_out + V_F"),
          R("Switch rms current", eng(Iq, "A"), "carries I_L1 + I_L2 during t_on"),
          R("Diode average current", eng(Io, "A")),
        ]),
        G("Loss budget (V_in min)", [
          R("Switch conduction", eng(Pc, "W")),
          R("Diode", eng(Pd, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta), "conduction terms only"),
        ]),
      ],
    };
  },
},
{
  id: "zeta", name: "Zeta", cat: "Non-isolated DC–DC", sch: "zeta",
  tag: "The SEPIC's mirror image: non-inverting, with the quiet port on the output side.",
  chips: ["non-inverting", "low output ripple", "high-side switch"],
  what: "Same parts as a SEPIC, rearranged so the output inductor faces the load. That makes output current continuous and output ripple low, at the price of pulsating input current and a high-side switch that needs a floating drive.",
  eqs: [
    { e: "M = D / (1 − D)", n: "identical ratio to the SEPIC" },
    { e: "V_C1 = V_in", n: "series cap holds the input voltage" },
    { e: "ΔI_L2 = V_out·(1 − D)/(L2·f_sw)", n: "output side behaves like a buck" },
    { e: "V_switch = V_in + V_out", n: "" },
  ],
  pros: ["Low output ripple — good for noise-sensitive loads", "Non-inverting", "No RHP zero in the output-side path"],
  cons: ["Pulsating input current needs a good input filter", "High-side switch drive", "Same C1 rms burden as the SEPIC"],
  use: ["Precision analog rails from a varying input", "LED drivers where flicker matters"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "vf", "rds", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => (Vo + s.vf) / (v + Vo + s.vf);
    const Dn = du(s.vinNom), Dx = du(s.vinMin);
    const IL1 = Io * Dx / (1 - Dx);
    const dI = s.r * Io;
    const L2 = Vo * (1 - Dn) / (fs * dI);
    const L1 = s.vinMin * Dx / (fs * s.r * Math.max(IL1, 0.1));
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    /* The switch carries both inductor currents while it is on; the diode
       carries them both while it is off. */
    const Isum = IL1 + Io;
    const Pq = Isum * Isum * Dx * s.rds * 1e-3;
    const Pd = s.vf * Isum * (1 - Dx);
    return {
      hi: [["duty (nom)", f3(Dn)], ["L2 (output)", eng(L2, "H")], ["C_out", eng(Co, "F")]],
      loss: [["Switch conduction", Pq, "(I_L1+I_L2)²·D·R_DS(on)"],
        ["Diode", Pd, "V_F·(I_L1+I_L2)·(1−D)"]],
      /* The Zeta's output inductor faces the load, so the plotted current is
         already the one the capacitor sees — which is the whole reason this
         topology's output is quieter than the SEPIC's. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Io , vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        Dx > 0.8 && "D = " + f3(Dx) + " at V_in min, so the switch carries " + eng(Isum, "A")
          + " for most of the period. Conduction loss climbs steeply past here.",
        s.vinMax + Vo > 60 && "Device stress is " + eng(s.vinMax + Vo, "V") + " — V_in max plus V_out, the same penalty the SEPIC pays.",
      ].filter(Boolean),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom", f3(Dx) + " · " + f3(Dn)),
          R("I_L1 (input inductor)", eng(IL1, "A")), R("I_L2 (output inductor)", eng(Io, "A")),
        ]),
        G("Passives", [
          R("L1", eng(L1, "H")), R("L2", eng(L2, "H")),
          R("C1 voltage / rms", eng(s.vinMax, "V") + " · " + eng(Io * Math.sqrt((Vo + s.vf) / s.vinMin), "A")),
          R("C_out (charge)", eng(Co, "F"), "small — continuous output current"),
          R("Input cap rms", eng(Io * Math.sqrt(Dn / (1 - Dn)), "A"), "input pulsates"),
        ]),
        G("Stresses", [R("Switch / diode V", eng(s.vinMax + Vo, "V"))]),
        G("Loss budget (V_in min)", [
          R("Switch conduction", eng(Pq, "W")),
          R("Diode", eng(Pd, "W"), "replace with a FET if this dominates"),
          R("Total / efficiency", eng(Pq + Pd, "W") + " → " + pct(Vo * Io / (Vo * Io + Pq + Pd)),
            "conduction terms only"),
        ]),
      ],
    };
  },
},
{
  id: "chargepump", name: "Charge pump (Dickson)", cat: "Non-isolated DC–DC", sch: "chargepump",
  tag: "Switched capacitors, no magnetics. Fixed ratios, excellent at small power.",
  chips: ["no inductor", "fixed ratio", "integrable"],
  what: "A converter with no inductor at all. Capacitors are charged from the input, then physically reconnected so they stack on top of it, and their charge is handed along to the output — a bucket chain rather than a flywheel. Because there is nothing magnetic, the whole thing fits on a chip. The catch is that every time two capacitors at different voltages are connected together, some energy is lost no matter how good the switches are; that unavoidable loss behaves exactly like a resistance in series with the output, and it is what both droops the voltage under load and sets the efficiency. The ratio is also fixed by how the capacitors are wired, so regulating away from it costs efficiency directly.",
  eqs: [
    { e: "V_out(ideal) = (N + 1)·(V_in − V_F)", n: "N pump stages means N+1 diodes in the charge path; use FETs to kill the V_F term entirely" },
    { e: "R_SSL = N / (f_sw·C_fly)", n: "slow-switching limit — a real resistance set by charge transfer, not by any resistor" },
    { e: "R_FSL ≈ 2·(2N + 1)·R_DS(on)", n: "fast-switching limit — the on-resistance the charge has to flow through" },
    { e: "R_out = √(R_SSL^2 + R_FSL^2)", n: "the two limits combine in quadrature" },
    { e: "ΔV_out = I_out / (f_sw·C_out)", n: "ripple at the pump frequency" },
    { e: "η_max = V_out / ((N + 1)·V_in)", n: "efficiency collapses away from the ideal ratio — a charge pump cannot regulate for free" },
  ],
  pros: ["No magnetics — tiny, cheap, EMI-quiet", "Trivially integrated", "Very good light-load efficiency"],
  cons: ["Fixed ratio; regulation costs efficiency directly", "Output impedance rises fast at low f_sw or small C", "Poor at high current"],
  use: ["LCD and EEPROM bias", "Gate-drive bootstraps", "48 V→12 V unregulated 'DC transformers'"],
  fields: ["vinNom", "iout", "fsw", "nstg", "cfly", "vf", "rds", "dvout"],
  design(s) {
    const fs = s.fsw * 1e3, N = Math.max(1, Math.round(s.nstg)), Cf = s.cfly * 1e-6;
    /* An N-stage Dickson puts N+1 rectifiers in the charge path, so every
       one of them takes a V_F bite out of the ideal (N+1)·V_in.         */
    const Vi = (N + 1) * (s.vinNom - s.vf);
    const Videal = (N + 1) * s.vinNom;
    const Rssl = N / (Cf * fs);
    const Rfsl = 2 * (2 * N + 1) * s.rds * 1e-3;
    const Ro = Math.sqrt(Rssl * Rssl + Rfsl * Rfsl);
    const Vl = Vi - s.iout * Ro;
    const Cout = s.iout / (fs * s.dvout * 1e-3);
    const eta = Vl > 0 ? Vl / Videal : 0;
    /* The two limits add in QUADRATURE, which is what R_out above says and
       what the droop is actually measured from. Listing I²·R_SSL and I²·R_FSL
       as separate bar segments adds them linearly instead, overstating the
       total by up to 41 % — and the efficiency map reads the bar, so the error
       propagated off this page. The honest split of the real loss I²·R_out is
       by each limit's share of R_out², which is the identity that defines it. */
    const Pr = s.iout * s.iout * Ro;
    const Pssl = Ro > 0 ? Pr * (Rssl * Rssl) / (Ro * Ro) : 0;
    const Pfsl = Ro > 0 ? Pr * (Rfsl * Rfsl) / (Ro * Ro) : 0;
    return {
      hi: [["ideal V_out", eng(Vi, "V")], ["loaded V_out", eng(Math.max(Vl, 0), "V")], ["R_out", eng(Ro, "Ω")]],
      pout: Math.max(Vl, 0) * s.iout,
      loss: [["Charge redistribution", Pssl, "the R_SSL share of I_out²·R_out — set by f_sw·C"],
        ["Switch resistance", Pfsl, "the R_FSL share of I_out²·R_out"],
        ["Rectifiers", (N + 1) * s.vf * s.iout, "(N+1)·V_F·I_out — zero with synchronous FETs"]],
      warn: [
        Vl <= 0 && "R_out is large enough that the pump collapses under this load — it cannot deliver "
          + eng(s.iout, "A") + " at all. Raise f_sw or C_pump, or accept far less current.",
        Vl > 0 && Vl < Vi * 0.8 && "Output droops more than 20 % under load — raise f_sw or C_pump, or drop a stage.",
        Rfsl > Rssl * 2 && "R_DS(on) dominates R_out: you are in the fast-switching limit, so raising f_sw will not help. Use bigger switches.",
      ].filter(Boolean),
      groups: [
        G("Output", [
          R("Stages", String(N), N + 1 + " rectifiers in the charge path"),
          R("Ideal output", eng(Vi, "V"), "(N+1)·(V_in − V_F)"),
          R("Equivalent R_out", eng(Ro, "Ω")),
          R("— slow-switching (charge)", eng(Rssl, "Ω"), "N/(f_sw·C_fly) — falls as f_sw rises"),
          R("— fast-switching (R_DS)", eng(Rfsl, "Ω"), "2·(2N+1)·R_DS(on) — a floor f_sw cannot beat"),
          R("Loaded output", eng(Math.max(Vl, 0), "V"), "at " + eng(s.iout, "A")),
          R("Droop", eng(s.iout * Ro, "V")),
        ]),
        G("Components", [
          R("Pump caps", eng(Cf, "F") + " × " + N),
          R("C_out for ripple", eng(Cout, "F")),
          R("Pump cap rms current", eng(s.iout / Math.sqrt(2), "A"), "roughly, per cap"),
        ]),
        G("Efficiency", [
          R("Best-case η", pct(eta), "= V_out / ((N+1)·V_in)"),
          R("Loss in R_out", eng(Pr, "W"), "I_out²·R_out — the droop, dissipated"),
          R("— charge-redistribution share", eng(Pssl, "W"), "irreducible at this f_sw·C"),
          R("— switch-resistance share", eng(Pfsl, "W"), "the share bigger switches would remove"),
          R("Diode loss (if diodes)", eng((N + 1) * s.vf * s.iout, "W"), "use synchronous FETs to remove"),
        ]),
      ],
    };
  },
},
];

/* ===================== topologies — isolated ===================== */
const TB = [
{
  id: "flyback", name: "Flyback", cat: "Isolated DC–DC", sch: "flyback",
  tag: "One magnetic component, one switch, any number of isolated outputs. Cheap and everywhere.",
  chips: ["isolated", "≤ 150 W", "coupled inductor"],
  what: "The 'transformer' is really a gapped coupled inductor: it stores energy in t_on and dumps it in t_off. That is why it needs a gap and why leakage inductance — energy that never crosses to the secondary — has to be caught by a clamp. Multiple secondaries track each other well because they all discharge the same field.",
  eqs: [
    { e: "V_out = V_in·D / (N·(1 − D)),  N = N_p/N_s", n: "CCM; in DCM the output also depends on load" },
    { e: "V_R = N·(V_out + V_F)", n: "reflected voltage — the quantity that sets the primary device rating" },
    { e: "V_DS = V_in(max) + V_R + spike", n: "leave 20–30 % headroom for the leakage spike" },
    { e: "L_p = (V_in·D)²·(2 − K_rp) / (2·f_sw·P_in·K_rp)", n: "K_rp = 1 gives the CCM/DCM boundary" },
    { e: "P_clamp = ½·L_lk·I_pk²·f_sw·V_cl/(V_cl − V_R)", n: "RCD clamp dissipation — size R from it" },
  ],
  pros: ["Cheapest isolated topology: one switch, one magnetic", "Multiple isolated outputs almost free", "Very wide input range (universal mains)"],
  cons: ["Large rms currents; output cap works hard", "Leakage energy must be dissipated or recovered", "RHP zero in CCM makes the loop slow"],
  use: ["Phone and laptop adapters", "Auxiliary/bias supplies", "Isolated industrial rails"],
  fields: ["vinMin", "vinMax", "vout", "iout", "fsw", "dmax", "krp", "vf", "dvout", "esr", "eff", "llk", "vclamp", "rds", "lsag"],
  defs: { vinMin: 120, vinMax: 375, vout: 19, iout: 3.5, fsw: 65, dvout: 200, vf: 0.5, esr: 20, eff: 0.87 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, D = s.dmax, K = Math.min(Math.max(s.krp, 0.05), 1);
    const Po = Vo * Io, Pin = Po / s.eff;
    const Nt = s.vinMin * D / ((1 - D) * (Vo + s.vf));
    const Vr = Nt * (Vo + s.vf);
    const Vds = s.vinMax + Vr;
    const Lp = (s.vinMin * D) * (s.vinMin * D) * (2 - K) / (2 * fs * Pin * K);
    const Ipk = 2 * Pin / (s.vinMin * D * (2 - K));
    const Iv = Ipk * (1 - K);
    const sq = Ipk * Ipk + Ipk * Iv + Iv * Iv;
    const Iprms = Math.sqrt(D * sq / 3);
    const Isrms = Nt * Math.sqrt((1 - D) * sq / 3);
    const Ispk = Nt * Ipk;
    /* The secondary ramp AT THE LEVEL THAT DELIVERS THE LOAD. I_pk above is
       derived from input power, so it carries the 1/η allowance — right for
       rectifier stress, wrong for the output capacitor, whose job is defined
       by charge balance against I_out and nothing else. These are the same two
       numbers the capacitor pane is drawn from, written once so the printed
       rms and the drawn trace cannot describe different currents. */
    const Is0 = 2 * Io / ((1 - D) * (2 - K));
    const Is1 = 2 * Io * (1 - K) / ((1 - D) * (2 - K));
    const IsLoad = Math.sqrt((1 - D) * (Is0 * Is0 + Is0 * Is1 + Is1 * Is1) / 3);
    const Ico = Math.sqrt(Math.max(IsLoad * IsLoad - Io * Io, 0));
    const Co = Io * D / (fs * s.dvout * 1e-3);
    const dVe = Ispk * s.esr * 1e-3;
    const Vdr = Vo + s.vinMax / Nt;
    const Pcl = 0.5 * s.llk * 1e-6 * Ipk * Ipk * fs * s.vclamp / Math.max(s.vclamp - Vr, 1);
    const Rcl = s.vclamp * s.vclamp / Math.max(Pcl, 1e-6);
    const frhp = (1 - D) * (1 - D) * (Vo / Io) / (2 * Math.PI * D * (Lp / (Nt * Nt)));
    const Pq = Iprms * Iprms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Pesr = Ico * Ico * s.esr * 1e-3;
    return {
      hi: [["turns ratio N_p:N_s", f2(Nt) + " : 1"], ["primary L_p", eng(Lp, "H")], ["V_DS stress", eng(Vds, "V")]],
      loss: [["Primary conduction", Pq, "I_pri(rms)²·R_DS(on)"],
        ["Clamp (leakage)", Pcl, "½·L_lk·I_pk²·f_sw, scaled by the clamp ratio"],
        ["Output rectifier", Pdo, "V_F·I_out"],
        ["Output cap ESR", Pesr, "I_C(rms)²·ESR"]],
      /* The plotted trace is the PRIMARY current, which stops dead at
         turn-off. The capacitor is on the other side of the transformer: it
         sees the reflected secondary current, N·I_pk decaying to N·I_v, and
         only during the off-time. So the two panes are genuinely different
         currents on the same figure, and neither is derivable from the other
         without the turns ratio. */
      wave: { sat: s.lsag / 100, D, dI: Ipk - Iv, iavg: (Ipk + Iv) / 2, pulse: true, ilabel: "i_pri",
        vlabel: "v_DS", vhi: "V_in+V_R", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          /* The secondary's peak and valley, at the level that delivers
             exactly I_out. I_spk = N·I_pk above is derived from INPUT power,
             so it carries the efficiency allowance — the right thing for
             rectifier stress, and the wrong thing here. Whatever the
             converter loses, the charge arriving at the output node still has
             to equal the charge the load removes, or the rail would walk away
             cycle after cycle. So the flux ramp sets the shape, I_v/I_pk =
             1 − K, and the load sets the level. */
          i0: Is0, i1: Is1 } },
      warn: [
        s.vclamp < Vr * 1.2 && "Clamp voltage is too close to V_R (" + eng(Vr, "V") + ") — clamp loss runs away. Use V_clamp ≈ 1.3–1.5·V_R.",
        Vds > 600 && "V_DS reaches " + eng(Vds, "V") + " before the leakage spike. That is 900 V+ silicon territory; lower N or use active clamp.",
        K >= 0.99 && "K_rp = 1 is the DCM boundary: peak currents are at their highest here. Lower K_rp for CCM if rms current is the problem.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_p/N_s", f2(Nt)),
          R("Reflected voltage V_R", eng(Vr, "V")),
          R("Primary inductance L_p", eng(Lp, "H")),
          R("I_pk / I_valley", eng(Ipk, "A") + " · " + eng(Iv, "A")),
          R("Primary rms", eng(Iprms, "A"), "sets primary wire gauge"),
          R("Secondary rms / peak", eng(Isrms, "A") + " · " + eng(Ispk, "A")),
          R("Stored energy", eng(0.5 * Lp * Ipk * Ipk, "J"), "sets the core size and gap"),
        ]),
        G("Semiconductors", [
          R("V_DS (before spike)", eng(Vds, "V"), "choose ≥ 1.25× this"),
          R("Primary rms current", eng(Iprms, "A")),
          R("Output diode V_R", eng(Vdr, "V"), "V_out + V_in(max)/N"),
          R("Output diode I_avg", eng(Io, "A")),
        ]),
        G("Clamp and snubber", [
          R("Leakage energy per cycle", eng(0.5 * s.llk * 1e-6 * Ipk * Ipk, "J")),
          R("Clamp dissipation", eng(Pcl, "W"), "at V_clamp = " + s.vclamp + " V"),
          R("Clamp resistor", eng(Rcl, "Ω")),
          R("Clamp cap (5 % ripple)", eng(s.vclamp / (Rcl * fs * 0.05 * s.vclamp), "F")),
        ]),
        G("Output side", [
          R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng(dVe, "V"), dVe > 2 * s.dvout * 1e-3 ? "ESR dominates — parallel more caps or add an LC post-filter" : "acceptable"),
          R("C_out rms current", eng(Ico, "A"), "the usual failure point"),
          R("RHP zero", eng(frhp, "Hz"), "cross over below " + eng(frhp / 5, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "qrflyback", name: "Quasi-resonant flyback", cat: "Isolated DC–DC", sch: "qrflyback",
  tag: "A flyback that waits for the ringing to reach a trough before switching on again.",
  chips: ["isolated", "valley switching", "variable frequency"],
  what: "When a flyback finishes delivering its energy, the transformer and the switch's own capacitance are left ringing together — an ordinary flyback ignores this and turns on whenever the clock says, often at the top of the ring, dumping whatever charge is on the switch as heat. A quasi-resonant one watches instead, and waits for the ring to reach a trough before turning on. The voltage it switches at is then as low as that ring ever goes, so the loss and the noise both fall sharply. The consequence is that the converter can no longer keep a fixed frequency — it must wait for a trough, and the troughs move with load and line. Nearly every efficient mains adapter works this way.",
  eqs: [
    { e: "f_ring = 1/(2π√(L_p·C_res))", n: "the transformer's primary inductance ringing against the switch's own capacitance" },
    { e: "first valley at t = ½·f_ring", n: "half a ring period after the secondary current reaches zero" },
    { e: "V_switch(valley) = V_in − V_R", n: "against V_in + V_R at the peak — the difference is what is saved" },
    { e: "P_cap = ½·C_res·V_sw²·f_sw", n: "what a hard-switched flyback burns in the switch at every turn-on" },
    { e: "T = t_on + t_dis + k/(2·f_ring)", n: "the period is a sum of intervals, not a setting — so the frequency drifts with load" },
  ],
  pros: ["Turn-on loss and switching noise both fall sharply", "The parasitic ring becomes part of the design rather than something to snub", "Cheap: needs no extra power components at all"],
  cons: ["Frequency varies with load and line, so the EMI filter must cover a range", "Valley hopping near a boundary can make audible noise", "Needs a controller that can sense the ring"],
  use: ["Phone and laptop adapters", "Standby and bias supplies", "Anywhere efficiency standards bite at light load"],
  fields: ["vinMin", "vinMax", "vout", "iout", "fsw", "dmax", "krp", "vf", "dvout", "esr", "eff", "coss", "llk", "rds"],
  defs: { vinMin: 120, vinMax: 375, vout: 19, iout: 3.5, fsw: 65, dvout: 200, vf: 0.5, esr: 20, eff: 0.87, coss: 150, dmax: 0.45 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, D = s.dmax, K = Math.min(Math.max(s.krp, 0.05), 1);
    const Po = Vo * Io, Pin = Po / s.eff;
    const Nt = s.vinMin * D / ((1 - D) * (Vo + s.vf));
    const Vr = Nt * (Vo + s.vf);
    const Lp = (s.vinMin * D) * (s.vinMin * D) * (2 - K) / (2 * fs * Pin * K);
    const Ipk = 2 * Pin / (s.vinMin * D * (2 - K));
    const Iv = Ipk * (1 - K);
    const Cres = s.coss * 1e-12;
    /* The ring the switch node makes once the secondary has finished. */
    const fRing = 1 / (2 * Math.PI * Math.sqrt(Lp * Cres));
    const tValley = 1 / (2 * fRing);
    /* Peak and valley of that ring, about V_in. A hard-switched flyback turns
       on somewhere between them; a quasi-resonant one waits for the bottom. */
    const Vpeak = s.vinMax + Vr;
    const Vvalley = Math.max(s.vinMax - Vr, 0);
    const Phard = 0.5 * Cres * Vpeak * Vpeak * fs;
    const Psoft = 0.5 * Cres * Vvalley * Vvalley * fs;
    const saved = Phard - Psoft;
    const sq = Ipk * Ipk + Ipk * Iv + Iv * Iv;
    const Iprms = Math.sqrt(D * sq / 3);
    const Is0 = 2 * Io / ((1 - D) * (2 - K));
    const Is1 = 2 * Io * (1 - K) / ((1 - D) * (2 - K));
    const IsLoad = Math.sqrt((1 - D) * (Is0 * Is0 + Is0 * Is1 + Is1 * Is1) / 3);
    const Ico = Math.sqrt(Math.max(IsLoad * IsLoad - Io * Io, 0));
    const Co = Io * D / (fs * s.dvout * 1e-3);
    const Pq = Iprms * Iprms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Pesr = Ico * Ico * s.esr * 1e-3;
    const Pt = Pq + Pdo + Pesr + Psoft;
    return {
      hi: [["ring frequency", eng(fRing, "Hz")], ["turn-on saved", eng(saved, "W")],
        ["switch V at the valley", eng(Vvalley, "V")]],
      loss: [["Primary conduction", Pq, "I_pri(rms)²·R_DS(on)"],
        ["Turn-on at the valley", Psoft, "½·C_res·V_valley²·f_sw — what is left after waiting"],
        ["Output rectifier", Pdo, "V_F·I_out"],
        ["Output cap ESR", Pesr, "I_C(rms)²·ESR"]],
      warn: [
        Vvalley <= 0 && "The ring reaches all the way down to zero volts at V_in max, so the switch can turn on at true zero. This is the ideal case and needs V_R ≥ V_in — check the turns ratio is really giving you that.",
        saved < 0.02 * Po && "Waiting for the valley saves only " + eng(saved, "W") + " here. At this C_oss and frequency a fixed-frequency flyback is simpler and just as efficient.",
        tValley > 0.3 / fs && "One half ring is " + eng(tValley, "s") + ", which is a large fraction of the period at " + s.fsw + " kHz. The frequency will move a long way with load.",
      ].filter(Boolean),
      groups: [
        G("The ring", [
          R("Ring frequency", eng(fRing, "Hz"), "L_p against C_res"),
          R("Time to the first valley", eng(tValley, "s"), "half a ring period after the secondary empties"),
          R("Switch voltage at the peak", eng(Vpeak, "V"), "where a fixed-frequency flyback would turn on"),
          R("Switch voltage at the valley", eng(Vvalley, "V"), "where this one waits for"),
        ]),
        G("What waiting buys", [
          R("Turn-on loss, hard switched", eng(Phard, "W")),
          R("Turn-on loss, at the valley", eng(Psoft, "W")),
          R("Saved", eng(saved, "W"), pct(saved / Math.max(Po, 1e-9)) + " of the output"),
          R("C_res assumed", eng(Cres, "F"), "the switch's own output capacitance plus winding capacitance"),
        ]),
        G("Transformer and output", [
          R("Turns ratio N_p/N_s", f2(Nt)),
          R("Primary inductance L_p", eng(Lp, "H")),
          R("Primary peak / rms current", eng(Ipk, "A") + " · " + eng(Iprms, "A")),
          R("Reflected voltage V_R", eng(Vr, "V")),
          R("C_out (charge)", eng(Co, "F")),
          R("C_out rms current", eng(Ico, "A")),
        ]),
        G("Loss budget", [
          R("Primary conduction", eng(Pq, "W")),
          R("Turn-on at the valley", eng(Psoft, "W")),
          R("Output rectifier", eng(Pdo, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(Po / (Po + Pt))),
        ]),
      ],
      /* Same pulse-shaped primary as a plain flyback — the difference is in
         WHEN the next pulse starts, not in the shape of this one. */
      wave: { D, dI: Ipk - Iv, iavg: (Ipk + Iv) / 2, pulse: true, ilabel: "i_pri",
        vlabel: "v_DS", vhi: "V_in+V_R", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, i0: Is0, i1: Is1 } },
    };
  },
},
{
  id: "forward2", name: "Two-switch forward", cat: "Isolated DC–DC", sch: "forward2",
  tag: "Transformer-coupled buck. Switches clamp to V_in, so no snubber is needed.",
  chips: ["isolated", "100–500 W", "D < 0.5"],
  what: "Unlike a flyback, the forward transformer transfers power while the switch is on and stores nothing on purpose — an output inductor does the storage. The two clamp diodes return magnetising energy to the input and hold both FETs at V_in, which is why this topology is so robust.",
  eqs: [
    { e: "V_out = n·V_in·D,  n = N_s/N_p", n: "D limited to < 0.5 for core reset" },
    { e: "L = V_out·(1 − D)/(f_sw·ΔI_L)", n: "output filter behaves exactly like a buck" },
    { e: "V_DS = V_in(max)", n: "clamped by D_a/D_b — the whole point" },
    { e: "I_pri = n·I_out + I_mag", n: "magnetising current adds nothing useful; the numbers below carry the reflected term only, so add I_mag = V_in·D/(L_m·f_sw) once you have picked a core" },
  ],
  pros: ["Devices clamped to V_in — 500 V FETs run off 400 V bus", "Low output ripple (inductor + buck-style filter)", "No dissipative snubber needed"],
  cons: ["Duty limited below 0.5 → poor transformer utilisation", "Two switches with one high-side drive", "Needs an output inductor"],
  use: ["Telecom bricks", "Industrial 200–500 W supplies", "Server auxiliary rails"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "eff", "rds", "tsw"],
  defs: { vinMin: 330, vinNom: 390, vinMax: 420, vout: 12, iout: 25, fsw: 150, dvout: 100, dmax: 0.45 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const n = (Vo + s.vf) / (s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (n * s.vinNom), Dm = (Vo + s.vf) / (n * s.vinMax);
    const dI = s.r * Io, L = Vo * (1 - Dm) / (fs * dI);
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    const Ipri = n * Io;
    const Iprms = Ipri * Math.sqrt(Dn);
    /* Two FETs sit in series in the primary path, so the reflected current
       passes through two channels rather than one. */
    const Pq = 2 * Iprms * Iprms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Psw = 2 * 0.5 * s.vinNom * Ipri * s.tsw * 1e-9 * fs;
    return {
      hi: [["turns ratio N_s:N_p", f3(n)], ["output L", eng(L, "H")], ["D at V_in nom", f3(Dn)]],
      loss: [["Primary conduction", Pq, "2·I_pri(rms)²·R_DS(on) — two devices in series"],
        ["Primary switching", Psw, "2·½·V_in·I_pri·(t_r+t_f)·f_sw"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* An output inductor sits between the rectifier and the load, so output
         current is continuous and the capacitor takes the ripple alone — a
         buck filter behind a transformer, which is what a forward is. One
         power pulse per switching period, so C_out is sized at f_sw and the
         pane draws one ripple per drawn period to match. */
      wave: { D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        s.dmax >= 0.5 && "D_max must stay below 0.5 with a 1:1 reset — the core will not reset in time.",
        Dm < 0.1 && "Duty falls to " + f3(Dm) + " at V_in max; check the controller's minimum on-time and the transformer's utilisation.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_s/N_p", f3(n), "= 1/" + f2(1 / n)),
          R("D at V_in min / nom / max", f3(s.dmax) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Primary current (flat top)", eng(Ipri, "A"), "reflected load only — magnetising current not included"),
          R("Primary rms", eng(Iprms, "A"), "add I_mag once L_m is known"),
          R("Secondary rms", eng(Io * Math.sqrt(Dn), "A")),
          R("Reset time needed", eng(Dn / fs, "s"), "equal to t_on — this is what forces D < 0.5"),
        ]),
        G("Output filter", [
          R("L", eng(L, "H"), "sized at V_in max"),
          R("ΔI_L", eng(dI, "A")),
          R("C_out (charge)", eng(Co, "F")),
          R("LC corner", eng(1 / (2 * Math.PI * Math.sqrt(L * Co)), "Hz")),
        ]),
        G("Stresses", [
          R("Q1 / Q2 V_DS", eng(s.vinMax, "V"), "hard clamped — no derating games"),
          R("Forward diode V_R", eng(n * s.vinMax, "V")),
          R("Freewheel diode I_avg", eng(Io * (1 - Dn), "A")),
        ]),
      ],
    };
  },
},
{
  id: "pushpull", name: "Push-pull", cat: "Isolated DC–DC", sch: "pushpull",
  tag: "Two ground-referenced switches drive a centre-tapped primary. Simple drive, 2·V_in stress.",
  chips: ["isolated", "low V_in", "flux walking"],
  what: "Both switches sit on the ground rail, so no high-side drive is needed — ideal for low-voltage inputs like 12 V or 24 V. The transformer is driven in both quadrants, so it is used efficiently, but any asymmetry between the two half-cycles walks the flux toward saturation.",
  eqs: [
    { e: "V_out = 2·n·V_in·D", n: "D is per switch, ≤ 0.45" },
    { e: "V_DS = 2·V_in + leakage spike", n: "the reason this is a low-voltage topology" },
    { e: "L = V_out·(1 − 2D)/(2·f_sw·ΔI_L)", n: "the filter sees twice the switching frequency" },
    { e: "flux walking → use peak current mode", n: "or a DC blocking cap in series with the primary" },
  ],
  pros: ["Both gate drives ground-referenced", "Transformer driven in both quadrants — small core", "Output ripple at 2·f_sw"],
  cons: ["2·V_in switch stress plus spike", "Flux imbalance can saturate the core", "Centre-tapped primary wastes copper"],
  use: ["12/24/48 V isolated bricks", "Inverter front ends", "Automotive DC–DC"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "eff", "rds", "tsw"],
  defs: { vinMin: 20, vinNom: 24, vinMax: 32, vout: 48, iout: 6, fsw: 100, dvout: 150, dmax: 0.42 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const n = (Vo + s.vf) / (2 * s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (2 * n * s.vinNom), Dm = (Vo + s.vf) / (2 * n * s.vinMax);
    const dI = s.r * Io;
    const L = Vo * (1 - 2 * Dm) / (2 * fs * dI);
    const Co = dI / (8 * 2 * fs * s.dvout * 1e-3);
    /* The current in the half of the primary that is conducting. Reflected
       from the output through one half-winding, so it is n·I_out — not twice
       that. This was named for the sum of both halves and then divided by two
       at every use, which came out right and read wrong. */
    const Ipri = n * Io;
    /* Each switch carries I_pri for its own duty D, so the pair
       dissipates 2·(I_pri·√D)²·R_DS. */
    const Iqrms = Ipri * Math.sqrt(Dn);
    const Pq = 2 * Iqrms * Iqrms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Psw = 2 * 0.5 * (2 * s.vinNom) * Ipri * s.tsw * 1e-9 * fs;
    return {
      hi: [["turns ratio N_s:N_p", f3(n)], ["output L", eng(L, "H")], ["V_DS stress", eng(2 * s.vinMax, "V")]],
      loss: [["Primary conduction", Pq, "2·I_Q(rms)²·R_DS(on)"],
        ["Primary switching", Psw, "hard switched against 2·V_in"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* DOUBLE-PULSE OUTPUT FILTERS. A push-pull, half-bridge, phase-shifted
         bridge or centre-tapped rectifier delivers TWO power pulses per
         switching period, so its choke ramps up over D·T and back down over
         (½ − D)·T, twice. This used to be drawn as one ramp per period, rising
         over D and falling over the whole of (1 − D): peak, valley and ΔI were
         right — which is why the sizing numbers beside it were right — but the
         falling ramp was stretched, so the TIME proportions were wrong, and a
         capacitor pane is a charge integral over exactly those proportions.

         `pulses: 2` builds one sub-interval and tiles it, so the on-fraction
         within each half-period is 2·D and both the ripple frequency and the
         charge integral come out right. `vbi` makes the primary pane bipolar,
         which it genuinely is — the winding sees +V_in, nothing, −V_in,
         nothing. Its mean is zero by symmetry, and that is not a decoration:
         a mean that is NOT zero is flux walking, which is what the warning
         below this line is about. */
      wave: { D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in",
        pulses: 2, vbi: true,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        s.dmax > 0.48 && "D per switch must stay below 0.5 or both switches conduct at once and short the primary.",
        2 * s.vinMax > 200 && "2·V_in max = " + eng(2 * s.vinMax, "V") + " before the spike. Consider a half-bridge instead.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_s/N_p (per half)", f3(n)),
          /* V_in min first, matching every other topology's duty row: duty is
             largest where the input is lowest, so this reads high to low. */
          R("D per switch at V_in min / nom / max", f3(s.dmax) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Primary current when on", eng(Ipri, "A")),
          R("Switch rms current", eng(Iqrms, "A")),
        ]),
        G("Output filter", [
          R("L", eng(L, "H"), "ripple at 2·f_sw = " + eng(2 * fs, "Hz")),
          R("C_out (charge)", eng(Co, "F")),
          R("Rectifier V_R", eng(2 * n * s.vinMax, "V"), "centre-tapped secondary"),
        ]),
        G("Stresses and cautions", [
          R("V_DS", eng(2 * s.vinMax, "V"), "plus leakage spike — snubber required"),
          R("Flux balancing", "peak current mode", "or add a series DC blocking cap"),
        ]),
      ],
    };
  },
},
{
  id: "halfbridge", name: "Half-bridge", cat: "Isolated DC–DC", sch: "halfbridge",
  tag: "Two switches across the bus, primary between the midpoints. Devices see only V_in.",
  chips: ["isolated", "200 W–1 kW", "off-line"],
  what: "The capacitor divider gives a return at V_in/2, so the primary swings ±V_in/2 and each switch blocks only V_in. That halves the voltage rating compared with a push-pull, which is why almost every off-line supply above 200 W starts here or at the full bridge.",
  eqs: [
    { e: "V_out = n·V_in·D", n: "D per switch ≤ 0.45; the winding sees V_in/2" },
    { e: "V_DS = V_in", n: "no doubling — 500 V devices work off a 390 V bus" },
    { e: "L = V_out·(1 − 2D)/(2·f_sw·ΔI_L)", n: "filter sees 2·f_sw" },
    { e: "C_blk balances the volt-seconds", n: "kills flux walking automatically" },
  ],
  pros: ["Switch stress equals V_in", "Series blocking cap prevents flux walking", "Good transformer utilisation"],
  cons: ["Primary current is twice the full bridge for the same power", "High-side drive required", "Divider caps carry large ripple current"],
  use: ["Off-line 200 W–1 kW supplies", "Welding and industrial supplies", "LLC precursor"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "eff", "rds", "tsw", "lsag"],
  defs: { vinMin: 330, vinNom: 390, vinMax: 420, vout: 48, iout: 12, fsw: 100, dvout: 150, dmax: 0.45 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const n = (Vo + s.vf) / (s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (n * s.vinNom), Dm = (Vo + s.vf) / (n * s.vinMax);
    const dI = s.r * Io;
    const L = Vo * (1 - 2 * Dm) / (2 * fs * dI);
    const Co = dI / (8 * 2 * fs * s.dvout * 1e-3);
    const Ipri = n * Io;
    /* Both switches conduct D each, so the primary rms over a full period
       is I_pri·√(2D). Each divider cap sees roughly half of that.       */
    const Iqrms = Ipri * Math.sqrt(Dn);
    const Iprms = Ipri * Math.sqrt(2 * Dn);
    const Icdiv = Iprms / 2;
    const Pq = 2 * Iqrms * Iqrms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Psw = 2 * 0.5 * s.vinNom * Ipri * s.tsw * 1e-9 * fs;
    return {
      hi: [["turns ratio N_s:N_p", f3(n)], ["output L", eng(L, "H")], ["V_DS stress", eng(s.vinMax, "V")]],
      loss: [["Primary conduction", Pq, "2·I_Q(rms)²·R_DS(on)"],
        ["Primary switching", Psw, "hard switched against V_in"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* Two power pulses per period and a bipolar primary — see the note on
         the push-pull. The series blocking capacitor exists precisely because
         the mean this pane draws has to be zero. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in/2",
        pulses: 2, vbi: true,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        s.dmax >= 0.5 && "D per switch must stay below 0.5, or both switches conduct at once and short the bus.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_s/N_p", f3(n)),
          R("D per switch (nom)", f3(Dn)),
          R("Primary current when on", eng(Ipri, "A")),
          R("Primary rms (full period)", eng(Iprms, "A"), "I_pri·√(2D) — both half-cycles"),
          R("Switch rms (each)", eng(Iqrms, "A"), "I_pri·√D — one half-cycle each"),
        ]),
        G("Bridge capacitors", [
          R("Divider cap rms current", eng(Icdiv, "A"), "each cap carries half the primary rms"),
          R("Blocking cap", "film, ≥ 0.1 µF", "sized so V_C ripple ≪ V_in/2"),
        ]),
        G("Output filter", [
          R("L", eng(L, "H")), R("C_out (charge)", eng(Co, "F")),
          R("Rectifier V_R", eng(n * s.vinMax, "V")),
          R("Ripple frequency", eng(2 * fs, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "psfb", name: "Phase-shifted full bridge", cat: "Isolated DC–DC", sch: "psfb",
  tag: "Full bridge where phase, not duty, sets the output — and the parasitics give you ZVS for free.",
  chips: ["isolated", "0.5–5 kW", "ZVS"],
  what: "A full bridge where nothing is throttled by duty at all — both halves run flat out at an even fifty-fifty. What is varied is the timing of one half against the other. When the two are aligned they fight each other and the transformer sees nothing; slide them apart and the transformer is driven for the overlap. That is the control. The bonus is what happens in the gaps: the leakage inductance of the transformer, normally a nuisance, keeps pushing current and uses it to discharge the switch that is about to turn on, so it closes with no voltage across it and costs nothing to close. The catch is that this depends on there being enough current to do the discharging, so at light load one leg loses the effect and starts switching hard.",
  eqs: [
    { e: "V_out = 2·n·V_in·D_eff", n: "D_eff = phase shift / 180°" },
    { e: "ΔD = 4·L_r·n·I_out·f_sw / V_in", n: "duty lost while the primary current reverses" },
    { e: "½·L_r·I_pri² ≥ (4/3)·C_oss·V_in²", n: "lagging-leg ZVS; the 4/3 lumps device C_oss with transformer winding capacitance" },
    { e: "t_dead ≈ 2·C_oss·V_in / I_pri", n: "or a quarter of the L_r–C_oss resonant period" },
  ],
  pros: ["ZVS on all four switches over most of the load range", "Fixed frequency — easy filtering and control", "Scales well to kilowatts"],
  cons: ["Lagging leg loses ZVS at light load", "Duty loss and secondary ringing need attention", "Four switches plus a current-sensing scheme"],
  use: ["Server and telecom rectifiers", "EV on-board chargers", "Industrial 1–5 kW supplies"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "lr", "coss", "rds"],
  defs: { vinMin: 350, vinNom: 400, vinMax: 420, vout: 48, iout: 40, fsw: 100, dvout: 150, dmax: 0.45, lr: 12, coss: 400 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, Lr = s.lr * 1e-6, Co_ss = s.coss * 1e-12;
    const n = (Vo + s.vf) / (2 * s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (2 * n * s.vinNom);
    const dD = 4 * Lr * n * Io * fs / s.vinNom;
    const Ipri = n * Io;
    const dI = s.r * Io;
    /* Size the choke where its ripple is worst, which is V_in max — the same
       corner the buck, the forward, the push-pull and the half-bridge all use.
       Two things push that way at once here: the duty needed falls as the
       input rises, and the duty LOST while the primary current reverses has
       to come off as well, because the choke only sees what actually reaches
       it. Sizing at nominal duty and ignoring the loss it had already
       computed left L undersized on both counts. */
    const Dm = (Vo + s.vf) / (2 * n * s.vinMax);
    const dDm = 4 * Lr * n * Io * fs / s.vinMax;
    const Deff = Math.max(Dm - dDm, 0.01);
    const L = Vo * (1 - 2 * Deff) / (2 * fs * dI);
    const Cout = dI / (8 * 2 * fs * s.dvout * 1e-3);
    const Izvs = s.vinNom * Math.sqrt((8 / 3) * Co_ss / Lr);
    const td = 2 * Co_ss * s.vinNom / Math.max(Ipri, 1e-6);
    const zvsLoad = Izvs / n;
    /* In a PSFB the primary current keeps circulating through two devices
       for the whole period, including the freewheel intervals — that
       circulating conduction is the topology's characteristic loss. */
    const Pq = 2 * Ipri * Ipri * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    return {
      hi: [["turns ratio", f3(n)], ["duty loss", pct(dD)], ["ZVS above", eng(zvsLoad, "A")]],
      loss: [["Primary conduction", Pq, "2·I_pri²·R_DS(on), circulating all period"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* Two power pulses per period and a bipolar primary — see the note on
         the push-pull. The duty loss above is a separate effect: it shortens
         the pulses without changing how many there are. */
      wave: { D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in",
        pulses: 2, vbi: true,
        cap: { kind: "buck", C: Cout, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        dD > 0.15 && "Duty loss is " + pct(dD) + " — that is a lot of transformer you are not using. Reduce L_r or the turns ratio.",
        zvsLoad > Io * 0.5 && "The lagging leg only achieves ZVS above " + eng(zvsLoad, "A") + " of output. Add magnetising current, a saturable inductor, or accept hard switching at light load.",
      ].filter(Boolean),
      groups: [
        G("Transformer and duty", [
          R("Turns ratio N_s/N_p", f3(n)),
          R("Effective duty at V_in nom", f3(Dn)),
          R("Duty loss ΔD", f3(dD), pct(dD) + " of the half period"),
          R("Effective duty at V_in max", f3(Deff), "after duty loss — the corner the choke is sized at"),
          R("Primary current", eng(Ipri, "A")),
        ]),
        G("Soft switching", [
          R("Resonant inductance L_r", eng(Lr, "H"), "leakage plus any added series L"),
          R("Primary current for ZVS", eng(Izvs, "A")),
          R("Equivalent output current", eng(zvsLoad, "A"), "below this the lagging leg hard-switches"),
          R("Dead time (lagging leg)", eng(td, "s")),
          R("L_r–C_oss resonance", eng(1 / (2 * Math.PI * Math.sqrt(Lr * 2 * Co_ss)), "Hz")),
        ]),
        G("Output filter", [
          R("L_o", eng(L, "H"), "sized at V_in max including duty loss, where the ripple is worst"),
          R("C_out (charge)", eng(Cout, "F")),
          R("Ripple frequency", eng(2 * fs, "Hz")),
          R("Rectifier V_R", eng(2 * n * s.vinMax, "V"), "add a clamp for the ringing"),
        ]),
      ],
    };
  },
},
{
  id: "llc", name: "LLC resonant half-bridge", cat: "Isolated DC–DC", sch: "llc",
  tag: "Frequency-controlled resonant tank. ZVS everywhere, ZCS on the rectifiers, very quiet.",
  chips: ["isolated", "resonant", "ZVS + ZCS"],
  what: "An inductor and a capacitor tuned together — a tank — sit between the switches and the transformer. A tank passes current most easily at one particular frequency and resists it either side, so moving the switching frequency up or down changes how much power gets through. That is the control here: frequency, not duty. The reward is that the tank rounds every edge into a sinusoid, so the switches turn on with no voltage across them and the output rectifiers turn off with no current in them — almost nothing is dissipated in the act of switching, and there is very little noise. The cost is that a frequency-controlled converter is harder to filter and harder to compensate than a fixed-frequency one.",
  eqs: [
    { e: "f_r = 1/(2π√(L_r·C_r))", n: "series resonance — the design centre" },
    { e: "M = 1/√[(1 + 1/L_n − 1/(L_n·f_n²))² + Q²(f_n − 1/f_n)²]", n: "first-harmonic gain, f_n = f_sw/f_r" },
    { e: "Q = √(L_r/C_r)/R_ac,  R_ac = (8/π²)·n²·R_load", n: "load enters as Q; higher load = lower peak gain" },
    { e: "n = V_in(nom)/(2·V_out)", n: "unity gain at f_r for a half-bridge" },
    { e: "I_m(pk) = n·V_out/(4·f_sw·L_m)", n: "this current is what charges C_oss for ZVS" },
  ],
  pros: ["ZVS from full load to no load; ZCS on the secondary diodes", "Very low EMI — no hard edges", "Excellent efficiency at the resonant point"],
  cons: ["Variable frequency complicates filtering and control", "Gain collapses if you fall below the peak-gain frequency", "Needs an integrated-magnetics transformer or a real L_r"],
  use: ["Server and LED PSUs downstream of PFC", "EV chargers", "TV and monitor supplies"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fr", "ln", "qf", "vf", "coss", "td", "rds"],
  defs: { vinMin: 330, vinNom: 390, vinMax: 410, vout: 12, iout: 20, fr: 100, ln: 5, qf: 0.4, coss: 300, td: 200 },
  design(s) {
    const fr = s.fr * 1e3, Vo = s.vout, Io = s.iout, Ln = s.ln, Qd = s.qf;
    const n = s.vinNom / (2 * (Vo + s.vf));
    const Rac = (8 / (Math.PI * Math.PI)) * n * n * (Vo / Io);
    const Cr = 1 / (2 * Math.PI * fr * Qd * Rac);
    const Lr = 1 / (Math.pow(2 * Math.PI * fr, 2) * Cr);
    const Lm = Ln * Lr;
    const M = (fn, Q) => 1 / Math.sqrt(Math.pow(1 + 1 / Ln - 1 / (Ln * fn * fn), 2) + Q * Q * Math.pow(fn - 1 / fn, 2));
    const Mmax = s.vinNom / s.vinMin, Mmin = s.vinNom / s.vinMax;
    /* The gain curve rises from zero, peaks BELOW f_n = 1, then falls away
       monotonically. Only the falling side is inductive; the rising side is
       capacitive, where the LLC loses ZVS and destroys itself. Locate the
       peak first, then solve on the inductive branch only — a naive upward
       sweep from f_n = 0.3 returns the capacitive solution.              */
    const FN_LO = 0.2, FN_HI = 4;
    let fPeak = 1, peak = 0;
    for (let f = FN_LO; f <= FN_HI; f += 0.001) {
      const m = M(f, Qd);
      if (m > peak) { peak = m; fPeak = f; }
    }
    const solveFn = (target) => {
      if (!(target > 0) || target > peak) return null;   // gain unreachable
      if (M(FN_HI, Qd) > target) return null;            // never falls that far
      let lo = fPeak, hi = FN_HI;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (M(mid, Qd) >= target) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const fnLo = solveFn(Mmax), fnHi = solveFn(Mmin);
    const Impk = n * (Vo + s.vf) / (4 * fr * Lm);
    const tdmin = 2 * s.coss * 1e-12 * s.vinNom / Math.max(Impk, 1e-9);
    const Icr = Math.sqrt(Math.pow(Math.PI * Io / (2 * Math.sqrt(2) * n), 2) + Math.pow(Impk / Math.sqrt(2), 2));
    const Vcr = s.vinNom / 2 + Icr * Math.sqrt(2) / (2 * Math.PI * fr * Cr);
    const xTop = 2;
    const QS = [0.2, 0.35, 0.5, 0.8, 1.2];
    /* The scale has to clear the tallest curve actually drawn, not just the
       design one — otherwise the lightest-load curve is clipped flat across
       the top of the frame and reads as a plotting error. */
    let curveMax = Math.max(peak, Mmax);
    QS.forEach((q) => { for (let f = 0.35; f <= xTop; f += 0.02) curveMax = Math.max(curveMax, M(f, q)); });
    const yTop = Math.max(2.2, Math.ceil(curveMax * 1.08 * 5) / 5);
    const series = QS.map((q, i) => {
      const pts = []; for (let f = 0.35; f <= xTop; f += 0.02) pts.push([f, Math.min(M(f, q), yTop)]);
      return { pts, c: ["#2E5A66", "#3C7C87", "#4AA0AC", "#5AD1DE", "#294A54"][i], o: 0.75, label: "Q=" + q };
    });
    const opPts = []; for (let f = 0.35; f <= xTop; f += 0.02) opPts.push([f, Math.min(M(f, Qd), yTop)]);
    series.push({ pts: opPts, c: "#E0A458", w: 2.4, label: "Q=" + Qd + " ←" });
    return {
      hi: [["turns ratio", f2(n) + " : 1"], ["L_r and C_r", eng(Lr, "H") + " · " + eng(Cr, "F")], ["L_m", eng(Lm, "H")]],
      loss: [["Primary conduction", Icr * Icr * s.rds * 1e-3, "I_Cr(rms)²·R_DS(on) — one device conducts at a time"],
        ["Output rectifiers", s.vf * Io, "V_F·I_out; ZCS means no reverse-recovery term"]],
      chart: {
        title: "Tank gain vs normalised frequency",
        series, xmin: 0.35, xmax: xTop, ymin: 0, ymax: yTop, xlab: "f_n = f_sw / f_r", ylab: "gain M",
        marks: [
          { y: Mmax, t: "M needed at V_in min", c: "#6FD39B" },
          { y: Mmin, t: "M at V_in max", c: "#F0796C" },
        ],
        vmarks: [{ x: fPeak, t: "peak gain — do not go left of this", c: "#F0796C" }],
      },
      warn: [
        fnLo === null && "The tank cannot produce the gain of " + f2(Mmax) + " that V_in min demands — its peak is only "
          + f2(peak) + ". Lower Q (lighter design load), lower L_n, or narrow the input range.",
        fnLo !== null && peak < Mmax * 1.1 && "Peak gain (" + f2(peak) + ") barely covers the " + f2(Mmax)
          + " you need at V_in min. Lower Q or L_n, or accept a narrower hold-up window.",
        fnLo !== null && fnLo < fPeak * 1.1 && "The low-line point (f_n = " + f2(fnLo) + ") sits close to the peak-gain frequency at "
          + f2(fPeak) + ". Any further down is capacitive, and losing ZVS there is how LLC converters fail.",
        fnHi === null && "The tank never falls to the gain of " + f2(Mmin) + " that V_in max needs within f_n ≤ " + FN_HI
          + " — the converter will not regulate at high line without burst mode.",
      ].filter(Boolean),
      groups: [
        G("Tank", [
          R("Turns ratio n", f2(n), "unity gain at f_r"),
          R("R_ac at full load", eng(Rac, "Ω")),
          R("C_r", eng(Cr, "F"), "film, high dV/dt rating"),
          R("L_r", eng(Lr, "H"), "leakage or a discrete inductor"),
          R("L_m", eng(Lm, "H"), "L_n = " + f2(Ln)),
          R("Peak gain at design Q", f2(peak), "at f_n = " + f2(fPeak)),
        ]),
        G("Operating range", [
          R("Gain needed at V_in min", f2(Mmax)),
          R("Gain needed at V_in max", f2(Mmin)),
          R("Peak-gain frequency", eng(fPeak * fr, "Hz"), "the capacitive boundary — never operate below it"),
          R("f_sw at V_in min", fnLo === null ? "unreachable" : eng(fnLo * fr, "Hz"),
            fnLo === null ? "the tank cannot make this much gain" : "on the inductive branch, f_n = " + f2(fnLo)),
          R("f_sw at V_in max", fnHi === null ? "unreachable" : eng(fnHi * fr, "Hz"),
            fnHi === null ? "gain never falls far enough" : "f_n = " + f2(fnHi)),
          R("Frequency span", fnLo && fnHi ? f2(fnHi / fnLo) + " : 1" : "—"),
        ]),
        G("Currents and ZVS", [
          R("Magnetising peak current", eng(Impk, "A")),
          R("Resonant cap rms current", eng(Icr, "A")),
          R("C_r peak voltage", eng(Vcr, "V"), "rate the film cap for this"),
          R("Minimum dead time", eng(tdmin, "s"), "to fully swing the half-bridge node"),
          R("Rectifier V_R", eng(2 * (Vo + s.vf), "V"), "×2 for centre-tapped"),
        ]),
      ],
    };
  },
},
{
  id: "dab", name: "Dual active bridge", cat: "Isolated DC–DC", sch: "dab",
  tag: "Two bridges, one transformer, power set by phase. Bidirectional by nature.",
  chips: ["isolated", "bidirectional", "phase-shift control"],
  what: "Two switching bridges face each other across a transformer, each making its own square wave, with an inductor between them. Whichever bridge leads in timing pushes power to the other — exactly like two people pushing a swing slightly out of step, where whoever pushes first does the work. The size of that timing offset sets how much power crosses, and its sign sets which way. Nothing has to be reconfigured to run the converter backwards: shift the phase the other way and the power reverses, which is why this is the standard choice wherever a battery has to both charge and discharge.",
  eqs: [
    { e: "P = n·V1·V2·d·(1 − d)/(2·f_sw·L)", n: "d = φ/180°, single-phase-shift modulation" },
    { e: "P_max at d = 0.5", n: "but rms current is awful there — design for d ≈ 0.2–0.35" },
    { e: "L = n·V1·V2·d(1 − d)/(2·f_sw·P)", n: "solve for L at the rated operating point" },
    { e: "ZVS needs n·V2 ≈ V1", n: "the range narrows fast when the ratio drifts" },
  ],
  pros: ["Truly bidirectional with one control variable", "Soft switching over a useful range", "Galvanic isolation with symmetric structure"],
  cons: ["Eight switches", "ZVS range collapses when V1 ≠ n·V2", "Large circulating current at low load"],
  use: ["EV on-board chargers with V2G", "Battery energy storage interfaces", "Solid-state transformers"],
  fields: ["vinNom", "v2", "pout", "fsw", "phi", "ncell", "coss", "rds", "rdsS", "tsw"],
  defs: { vinNom: 400, v2: 48, pout: 3300, fsw: 100, phi: 40, ncell: 8, rds: 25, rdsS: 1.5, tsw: 50 },
  design(s) {
    const fs = s.fsw * 1e3, V1 = s.vinNom, V2 = s.v2, n = s.ncell;
    const d = s.phi / 180;
    const L = n * V1 * V2 * d * (1 - d) / (2 * fs * s.pout);
    const Pmax = n * V1 * V2 * 0.25 / (2 * fs * L);
    const I1 = s.pout / V1, I2 = s.pout / V2;
    const ratio = n * V2 / V1;
    /* Tank current is piecewise linear over the half period. Its two corner
       values are the currents present at each bridge's switching instant —
       which is exactly what has to charge C_oss for ZVS.                 */
    const i0 = (V1 / (4 * fs * L)) * (1 - ratio + 2 * d * ratio);   // at the side-1 transition
    const id = (V1 / (4 * fs * L)) * (2 * d + ratio - 1);           // at the side-2 transition
    const Ipk = Math.max(Math.abs(i0), Math.abs(id));
    /* Over a half period the tank current is two straight runs, and
       ∫(a + (b−a)t)²dt = (a² + ab + b²)/3 on each. The half-wave symmetry
       i(t + T/2) = −i(t) is what fixes the endpoints: the phase-shift
       interval starts at −i0 and ends at +id, so it CROSSES ZERO and its
       cross-term is negative; the remainder runs from id up to i0 with both
       endpoints the same sign, so its cross-term is positive. These were the
       wrong way round, which put the sign-changing run's cancellation on the
       run that never changes sign and read about 20 % low — understating the
       copper and both bridges' conduction loss with it. */
    const Irms = Math.sqrt((d * (i0 * i0 - i0 * id + id * id)
      + (1 - d) * (id * id + id * i0 + i0 * i0)) / 3);
    const Ereq = (4 / 3) * s.coss * 1e-12 * V1 * V1;
    const E1 = 0.5 * L * i0 * i0, E2 = 0.5 * L * id * id;
    /* Each bridge carries the tank current referred to its own side, through
       its own devices — the LV bridge sees n times the current and is built
       from correspondingly lower-R_DS(on) parts. */
    const Pb1 = 2 * Irms * Irms * s.rds * 1e-3;
    const Pb2 = 2 * Math.pow(Irms * n, 2) * s.rdsS * 1e-3;
    const Poff = (E1 < Ereq ? 0.5 * V1 * Math.abs(i0) * s.tsw * 1e-9 * fs : 0)
      + (E2 < Ereq ? 0.5 * V1 * Math.abs(id) * s.tsw * 1e-9 * fs : 0);
    return {
      hi: [["series inductance", eng(L, "H")], ["peak tank current", eng(Ipk, "A")], ["voltage match n·V2 : V1", f2(ratio)]],
      loss: [["Bridge 1 conduction", Pb1, "2·I_tank(rms)²·R_DS(on), HV side"],
        ["Bridge 2 conduction", Pb2, "n·I_tank through the LV side's own R_DS(on)"],
        ["Turn-off (hard side)", Poff, "only the bridge that lost ZVS"]],
      warn: [
        Math.abs(ratio - 1) > 0.15 && "n·V2/V1 = " + f2(ratio) + ". Away from 1.0 the ZVS range shrinks quickly — retune the turns ratio or use an extended modulation scheme.",
        d > 0.45 && "You are operating close to the power limit (d = " + f2(d) + "). Circulating current and turn-off loss are near their worst here.",
        E1 < Ereq && "Side 1 loses ZVS at this operating point: the tank stores " + eng(E1, "J")
          + " at the transition but needs " + eng(Ereq, "J") + " to swing C_oss. Raise the phase shift, lower L, or use lower-C_oss devices.",
        E2 < Ereq && "Side 2 loses ZVS: " + eng(E2, "J") + " available against " + eng(Ereq, "J") + " required.",
      ].filter(Boolean),
      groups: [
        G("Power transfer", [
          R("Phase shift", s.phi + "° (d = " + f2(d) + ")", "maximum power transfer at 90°"),
          R("Series inductance L", eng(L, "H"), "leakage plus external"),
          R("Rated power", eng(s.pout, "W")),
          R("Maximum power (d = 0.5)", eng(Pmax, "W")),
          R("Primary / secondary DC current", eng(I1, "A") + " · " + eng(I2, "A")),
        ]),
        G("Tank current", [
          R("Peak tank current", eng(Ipk, "A"), "sizes the transformer and the turn-off loss"),
          R("Tank rms current", eng(Irms, "A"), "sizes the copper"),
          R("Current at side-1 switching", eng(Math.abs(i0), "A")),
          R("Current at side-2 switching", eng(Math.abs(id), "A")),
          R("Circulating penalty", f2(Irms / (s.pout / V1)) + "×", "tank rms ÷ side-1 DC current; 1.0 would be ideal"),
        ]),
        G("Soft switching", [
          R("Energy needed per transition", eng(Ereq, "J"), "(4/3)·C_oss·V1²"),
          R("Energy available, side 1", eng(E1, "J"), E1 >= Ereq ? "ZVS" : "hard switching"),
          R("Energy available, side 2", eng(E2, "J"), E2 >= Ereq ? "ZVS" : "hard switching"),
        ]),
        G("Design guidance", [
          R("Turns ratio n", f2(n)), R("Voltage match n·V2/V1", f2(ratio), "aim for 1.00"),
          R("Device blocking V (side 1)", eng(V1, "V")),
          R("Device blocking V (side 2)", eng(V2, "V")),
          R("Transformer volt-seconds", eng(V1 / (2 * fs), "V·s"), "sets the core area"),
        ]),
        G("Loss budget", [
          R("Bridge 1 conduction (HV)", eng(Pb1, "W"), "four devices, two in the path at a time"),
          R("Bridge 2 conduction (LV)", eng(Pb2, "W"), "carries n× the current at " + s.rdsS + " mΩ"),
          R("Turn-off, hard side", eng(Poff, "W"), Poff > 0 ? "one bridge is outside ZVS here" : "both bridges are within ZVS"),
          R("Total / efficiency", eng(Pb1 + Pb2 + Poff, "W") + " → "
            + pct(s.pout / (s.pout + Pb1 + Pb2 + Poff)), "conduction and turn-off only"),
        ]),
      ],
    };
  },
},
];

/* ================= topologies — AC–DC and DC–AC ================= */
const TC = [
{
  id: "pfcboost", name: "CCM boost PFC", cat: "AC–DC / PFC", sch: "pfcboost",
  tag: "The standard mains front end: bridge, boost, and a current loop that shapes i_in into a sine.",
  chips: ["PFC", "universal input", "390 V bus"],
  what: "A boost stage running from rectified mains with an inner current loop that forces the inductor current to follow |v_ac|. The outer voltage loop must be slow — below about 20 Hz — or it will distort the current reference and wreck the power factor. All the single-phase energy imbalance ends up as 2·f_line ripple on the bulk cap.",
  eqs: [
    { e: "V_bus > √2·V_ac(max)", n: "typically 390 V for universal input" },
    { e: "L = V_bus / (4·f_sw·ΔI)", n: "worst-case ripple occurs at v_in = V_bus/2" },
    { e: "C_bulk = 2·P_out·t_hold / (V_bus² − V_min²)", n: "hold-up almost always sets the bulk cap" },
    { e: "ΔV(2f)_pp = P_out / (2π·f_line·C·V_bus)", n: "the bus ripples at twice the line frequency, because single-phase power arrives in humps at 2·f_line. This is the full peak-to-peak swing; the amplitude either side of the mean is half of it" },
    { e: "I_C(rms) = P_out / (√2·V_bus)", n: "low-frequency cap ripple current" },
    { e: "I_sw(rms) = I_pk·√(1/2 − 4√2·V_ac/(3π·V_bus))", n: "the second term comes from ∫sin³ over the line half-cycle — the switch stops conducting near the line peak" },
  ],
  pros: ["Meets IEC 61000-3-2 with PF > 0.99 and low THD", "Well-understood, huge controller ecosystem", "Gives downstream converters a stable 390 V bus"],
  cons: ["Bridge diodes cost 1–2 % efficiency", "Bulk cap is large and lifetime-limited", "Voltage loop must be slow, so transients are poor"],
  use: ["Anything above 75 W on mains", "Server and telecom rectifiers", "LED and appliance supplies"],
  fields: ["vacMin", "vacMax", "fline", "pout", "vbus", "fsw", "r", "thold", "vbusMin", "eff", "vf", "rds", "coss", "qrr"],
  defs: { pout: 300, fsw: 65, r: 0.35, eff: 0.94, vf: 0.9, rds: 100, coss: 120, qrr: 80 },
  design(s) {
    const fs = s.fsw * 1e3, Po = s.pout, Vb = s.vbus;
    const Iin = Po / (s.eff * s.vacMin), Ipk = Math.SQRT2 * Iin;
    const dI = s.r * Ipk;
    const L = Vb / (4 * fs * dI);
    /* Hold-up energy is what the bus gives up between V_bus and V_bus(min).
       With no gap between them there is no energy to give and the capacitor
       needed is unbounded — so say that, rather than printing infinite farads. */
    if (s.vbusMin >= Vb * 0.999) return infeasible("Hold-up needs the bus to be allowed to sag: "
      + "V_bus(min) is " + eng(s.vbusMin, "V") + " against a bus of " + eng(Vb, "V") + ", so there is no "
      + "stored energy to ride through with and no finite capacitor is enough. Lower V_bus min — "
      + "the downstream converter's own input range is what sets it.");
    const C = 2 * Po * s.thold * 1e-3 / (Vb * Vb - s.vbusMin * s.vbusMin);
    /* Single-phase power pulsates: p(t) = P·(1 − cos 2ω_line·t). The bus
       capacitor absorbs that whole cosine, so i_C = −P·cos(2ω_line·t)/V_bus
       and integrating gives a ripple of AMPLITUDE P/(4π·f_line·C·V_bus).
       Peak-to-peak is twice that — which is the number quoted here and the
       one the loop has to reject. This was the amplitude labelled p-p, so
       the "± about the mean" line beside it came out half its true size. */
    const Vpp = Po / (2 * Math.PI * s.fline * C * Vb);
    const Iclf = Po / (Math.SQRT2 * Vb);
    const Id = Po / Vb;
    /* I_sw,rms² = (1/π)∫ I_pk²sin²θ·(1 − √2·V_ac·sinθ/V_bus) dθ.
       ∫sin² gives the 1/2; ∫sin³ = 4/3 gives the second term. The I_in,rms
       form I_in²(1 − 8√2·V_ac/(3π·V_bus)) is the SAME expression — I_pk² =
       2·I_in² turns one into the other exactly — so it is not more or less
       prone to a negative radicand. The radicand only goes negative above
       V_ac ≈ 0.83·V_bus, which √2·V_ac < V_bus already rules out; the clamp
       is there so a half-finished set of inputs cannot produce NaN.       */
    const rad = 0.5 - (4 * Math.SQRT2 * s.vacMin) / (3 * Math.PI * Vb);
    const Isw = Ipk * Math.sqrt(Math.max(rad, 0));
    const Pbr = 2 * s.vf * (2 * Ipk / Math.PI);
    const dImax = Vb / (4 * fs * L);
    const Psw = Isw * Isw * s.rds * 1e-3;
    const Pbd = s.vf * Id;
    /* Reverse recovery is the reason this topology moved to SiC. Running in
       continuous conduction, the switch turns on into a boost diode that is
       still conducting the full inductor current, and drags that diode's
       stored charge through itself against the 390 V bus — every cycle, all
       through the line half-cycle. A silicon ultrafast diode with a few
       hundred nC here can cost more than the bridge does. */
    const Prr = s.qrr * 1e-9 * Vb * fs;
    const Poss = 0.5 * s.coss * 1e-12 * Vb * Vb * fs;
    return {
      hi: [["boost inductor", eng(L, "H")], ["bulk cap", eng(C, "F")], ["peak line current", eng(Ipk, "A")]],
      loss: [["Bridge diodes", Pbr, "2·V_F·I_in(avg) — deleted by a totem-pole"],
        ["Boost switch conduction", Psw, "I_sw(rms)²·R_DS(on)"],
        ["Boost diode reverse recovery", Prr, "Q_rr·V_bus·f_sw — why CCM PFC went SiC"],
        ["Switch C_oss", Poss, "½·C_oss·V_bus²·f_sw, dumped at every turn-on"],
        ["Boost diode", Pbd, "V_F·I_out(avg)"]],
      warn: [
        Vb < Math.SQRT2 * s.vacMax * 1.05 && "V_bus must sit comfortably above √2·V_ac(max) = " + eng(Math.SQRT2 * s.vacMax, "V") + " or the boost loses control at the line peak.",
        Vpp > 20 && "Bus ripple is " + eng(Vpp, "V") + " peak-to-peak. Keep the voltage loop below ~20 Hz so this does not distort the current reference.",
      ].filter(Boolean),
      groups: [
        G("Line side", [
          R("Input rms current at V_ac min", eng(Iin, "A")),
          R("Peak line current", eng(Ipk, "A")),
          R("HF ripple ΔI (worst)", eng(dImax, "A"), "at v_in = V_bus/2"),
          R("Inductor peak current", eng(Ipk + dImax / 2, "A"), "saturation rating"),
          R("Bridge diode loss", eng(Pbr, "W"), "removed entirely by a totem-pole"),
        ]),
        G("Magnetics and bulk cap", [
          R("L_boost", eng(L, "H")),
          R("C_bulk for hold-up", eng(C, "F"), s.thold + " ms down to " + s.vbusMin + " V"),
          R("Bus ripple (2·f_line)", eng(Vpp, "V") + " p-p", "± " + eng(Vpp / 2, "V") + " about the mean"),
          R("Bulk cap rms current", eng(Iclf, "A"), "plus HF component"),
        ]),
        G("Semiconductors", [
          R("Switch / diode blocking V", eng(Vb, "V"), "use 600 V devices"),
          R("Switch rms current", eng(Isw, "A")),
          R("Boost diode average", eng(Id, "A")),
          R("Reverse-recovery loss", eng(Prr, "W"),
            s.qrr > 0 ? "at Q_rr = " + s.qrr + " nC; a SiC diode takes this to zero" : "zero — SiC or GaN, no stored charge"),
          R("Switch C_oss loss", eng(Poss, "W"), "½·C_oss·V_bus²·f_sw"),
        ]),
        G("Control", [
          R("Current loop bandwidth", eng(fs / 10, "Hz")),
          R("Voltage loop bandwidth", "10 – 20 Hz", "must reject 2·f_line"),
          R("Notch at", eng(2 * s.fline, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "ilpfc", name: "Interleaved boost PFC", cat: "AC–DC / PFC", sch: "ilpfc",
  tag: "Two boost stages half a period apart. The ripple they make partly cancels before it reaches anything.",
  chips: ["PFC", "ripple cancellation", "≥ 300 W"],
  what: "The same boost front end as before, built twice and run half a switching period apart from a shared bridge and a shared capacitor. Because one leg is charging while the other is discharging, the ripple currents they produce are always pushing opposite ways and much of the ripple cancels before it reaches either capacitor — so the input filter and the bulk capacitor both get an easier job than the switching frequency alone would suggest. The current also splits between the two legs, so each carries half and the copper losses fall by more than half. What it costs is a duplicate leg and a controller that can keep the two halves sharing evenly.",
  eqs: [
    { e: "each leg carries I_in/2", n: "so conduction loss falls by about half for the same total current" },
    { e: "input ripple frequency = 2·f_sw", n: "two legs, staggered — the ripple the filter sees arrives twice as often and is correspondingly smaller" },
    { e: "K(D) = |1 − 2·D| / (1 − D)", n: "the ripple cancellation factor for two legs; it reaches zero at D = 0.5, where the two ripples are exact opposites" },
    { e: "L = V_bus / (4·f_sw·ΔI)", n: "each leg is sized exactly as a single boost PFC's inductor would be" },
    { e: "C_bulk = 2·P_out·t_hold / (V_bus² − V_min²)", n: "unchanged — hold-up is a line-frequency problem and interleaving does not help it" },
  ],
  pros: ["Ripple cancellation shrinks the input filter and the bulk cap ripple current", "Current shares between two legs, so conduction loss and heat both halve", "Ripple arrives at 2·f_sw, so the EMI filter corner can be higher"],
  cons: ["Twice the switches, inductors and gate drives", "The two legs must share current, or one does all the work", "No benefit at all to hold-up, which is what usually sizes the bulk cap"],
  use: ["Server and telecom rectifiers above 300 W", "EV chargers", "Anywhere the EMI filter has become the biggest part"],
  fields: ["vacMin", "vacMax", "fline", "pout", "vbus", "fsw", "r", "thold", "vbusMin", "eff", "vf", "rds", "coss", "qrr"],
  defs: { pout: 1000, fsw: 65, r: 0.35, eff: 0.95, vf: 0.9, rds: 60, coss: 120, qrr: 80 },
  design(s) {
    const fs = s.fsw * 1e3, Po = s.pout, Vb = s.vbus;
    const Iin = Po / (s.eff * s.vacMin), Ipk = Math.SQRT2 * Iin;
    /* Each leg carries half the line current — that is the whole point. */
    const Iph = Ipk / 2;
    const dI = s.r * Iph;
    const L = Vb / (4 * fs * dI);
    if (s.vbusMin >= Vb * 0.999) return infeasible("Hold-up needs the bus to be allowed to sag: "
      + "V_bus(min) is " + eng(s.vbusMin, "V") + " against a bus of " + eng(Vb, "V") + ", so there is no "
      + "stored energy to ride through with and no finite capacitor is enough. Lower V_bus min.");
    const C = 2 * Po * s.thold * 1e-3 / (Vb * Vb - s.vbusMin * s.vbusMin);
    const Vpp = Po / (2 * Math.PI * s.fline * C * Vb);
    /* Cancellation between two legs, from the general interleaving factor —
       the same expression the multiphase buck uses, because it is the same
       question. The two-phase shortcut |1−2D|/(1−D) is only right below
       D = 0.5, and a boost PFC at the line peak sits well above it: at the
       default 85 V input the duty there is about 0.69, where the shortcut
       claims interleaving makes the ripple WORSE by a quarter. It does not. */
    const Dpk = clamp(1 - (Math.SQRT2 * s.vacMin) / Vb, 0.02, 0.98);
    const mK = Math.floor(2 * Dpk);
    const K = ((mK + 1 - 2 * Dpk) * (2 * Dpk - mK)) / ((1 - Dpk) * 2 * Dpk);
    const dIn = dI * K;
    const Iclf = Po / (Math.SQRT2 * Vb);
    const Id = Po / Vb;
    const rad = 0.5 - (4 * Math.SQRT2 * s.vacMin) / (3 * Math.PI * Vb);
    const Isw = Iph * Math.sqrt(Math.max(rad, 0)) * Math.SQRT2;
    const Pbr = 2 * s.vf * (2 * Ipk / Math.PI);
    /* Two legs, each with its own switch and diode. */
    const Psw = 2 * Isw * Isw * s.rds * 1e-3;
    const Pbd = s.vf * Id;
    const Prr = 2 * s.qrr * 1e-9 * Vb * fs;
    const Poss = 2 * 0.5 * s.coss * 1e-12 * Vb * Vb * fs;
    const Pt = Pbr + Psw + Pbd + Prr + Poss;
    return {
      hi: [["per-leg inductor", eng(L, "H")], ["ripple cancellation", "×" + f2(K)], ["input ripple f", eng(2 * fs, "Hz")]],
      loss: [["Bridge diodes", Pbr, "2·V_F·I_in(avg) — a totem-pole deletes these"],
        ["Switch conduction (both legs)", Psw, "2·I_sw(rms)²·R_DS(on)"],
        ["Boost diodes reverse recovery", Prr, "2·Q_rr·V_bus·f_sw"],
        ["Switch C_oss (both legs)", Poss, "2·½·C_oss·V_bus²·f_sw"],
        ["Boost diodes", Pbd, "V_F·I_out(avg)"]],
      warn: [
        Vb < Math.SQRT2 * s.vacMax * 1.05 && "V_bus must sit comfortably above √2·V_ac(max) = " + eng(Math.SQRT2 * s.vacMax, "V") + " or the boost loses control at the line peak.",
        K < 0.15 && "At the line peak the duty is " + f2(Dpk) + ", almost exactly where the two ripples cancel completely. Real cancellation will be set by how well the two inductors match, not by this number.",
        Po < 300 && "Below about 300 W the second leg usually costs more than the filter it saves. A single boost stage is the cheaper answer.",
      ].filter(Boolean),
      groups: [
        G("Line side", [
          R("Input rms current at V_ac min", eng(Iin, "A")),
          R("Peak line current", eng(Ipk, "A"), "shared between two legs"),
          R("Per-leg peak current", eng(Iph, "A"), "each inductor and switch sees half"),
          R("Duty at the line peak", f2(Dpk)),
          R("Bridge diode loss", eng(Pbr, "W")),
        ]),
        G("Ripple and cancellation", [
          R("Per-leg ripple ΔI", eng(dI, "A")),
          R("Ripple after cancellation", eng(dIn, "A"), "×" + f2(K) + " at the line peak"),
          R("Input ripple frequency", eng(2 * fs, "Hz"), "twice f_sw — the filter corner can rise with it"),
          R("L per leg", eng(L, "H")),
        ]),
        G("Bulk cap", [
          R("C_bulk for hold-up", eng(C, "F"), s.thold + " ms down to " + s.vbusMin + " V"),
          R("Bus ripple (2·f_line)", eng(Vpp, "V") + " p-p", "± " + eng(Vpp / 2, "V") + " about the mean"),
          R("Bulk cap rms current", eng(Iclf, "A"), "the line-frequency part; interleaving does not touch it"),
        ]),
        G("Loss budget", [
          R("Bridge diodes", eng(Pbr, "W")),
          R("Switch conduction", eng(Psw, "W"), "both legs together"),
          R("Reverse recovery", eng(Prr, "W"), s.qrr > 0 ? "two diodes; SiC removes it" : "zero — SiC or GaN"),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(Po / (Po + Pt))),
        ]),
      ],
      /* One leg's inductor current, over one switching period at the crest of
         the line cycle. No capacitor pane, for the same reason the single-
         stage PFC has none: the bulk capacitor here rides a 2·f_line swell
         hundreds of switching periods wide, and the little charge that moves
         within one period is not what sizes it or what the reader should be
         looking at. Drawing one would be a different waveform wearing this
         one's axis. The cancellation is visible where it belongs — in the
         schematic, where one leg charges as the other discharges. */
      wave: { D: Dpk, dI, iavg: Iph, vlabel: "v_SW", vhi: "V_bus", vinv: true, ilabel: "i_L1" },
    };
  },
},
{
  id: "totempole", name: "Totem-pole bridgeless PFC", cat: "AC–DC / PFC", sch: "totempole",
  tag: "Same boost, minus the bridge. Only practical since wide-bandgap devices arrived.",
  chips: ["PFC", "GaN / SiC", "99 % class"],
  what: "An ordinary mains front end rectifies with four diodes first and boosts afterwards, so the current pays two diode drops on its way through — a couple of percent of the output, permanently. This arrangement deletes the bridge: one pair of switches runs fast and does the boosting, while the other pair simply swaps over at mains frequency to handle whichever way round the line happens to be. The reason it took so long to become practical is that the fast pair must hand over to each other through their own internal body diodes, and a silicon body diode is slow to stop conducting — fast enough switching and it shorts the bus. Wide-bandgap devices removed that obstacle, and this became the way to reach 99 %.",
  eqs: [
    { e: "same L and C as the CCM boost PFC", n: "the power stage maths does not change" },
    { e: "P_saved = 2·V_F·I_in(avg)", n: "the two bridge diodes you deleted" },
    { e: "line-frequency leg: I²R only", n: "switching loss there is negligible" },
    { e: "watch the polarity crossover", n: "current spikes at the zero crossing are a common failure mode" },
  ],
  pros: ["One or two fewer diode drops — 98.5–99 % is achievable", "Fewer thermal interfaces", "Same control structure as a normal boost PFC"],
  cons: ["Needs GaN/SiC or CrM operation", "Zero-crossing control is demanding", "Common-mode noise is worse than a bridged design"],
  use: ["Server and hyperscale rectifiers", "EV chargers", "High-efficiency industrial supplies"],
  fields: ["vacMin", "vacMax", "fline", "pout", "vbus", "fsw", "r", "thold", "vbusMin", "eff", "vf", "rds"],
  defs: { pout: 1500, fsw: 100, r: 0.35, eff: 0.98, vf: 0.9, rds: 50 },
  design(s) {
    const fs = s.fsw * 1e3, Po = s.pout, Vb = s.vbus;
    const Iin = Po / (s.eff * s.vacMin), Ipk = Math.SQRT2 * Iin;
    const dI = s.r * Ipk, L = Vb / (4 * fs * dI);
    const C = 2 * Po * s.thold * 1e-3 / (Vb * Vb - s.vbusMin * s.vbusMin);
    const Pbr = 2 * s.vf * (2 * Ipk / Math.PI);
    /* Only ONE device of the line-frequency leg conducts per half cycle,
       and it carries the full input current — so the conduction loss is
       I_in²·R_DS, not twice that.                                        */
    const Plf = Iin * Iin * s.rds * 1e-3;
    return {
      hi: [["boost inductor", eng(L, "H")], ["bulk cap", eng(C, "F")], ["bridge loss removed", eng(Pbr, "W")]],
      loss: [["Fast-leg conduction", Iin * Iin * s.rds * 1e-3, "I_in(rms)²·R_DS(on)"],
        ["Line-frequency leg", Plf, "one device conducts per half cycle"]],
      warn: ["This topology requires zero-reverse-recovery devices (GaN or SiC) in CCM. Silicon superjunction devices will not survive the first line cycle."],
      groups: [
        G("Power stage", [
          R("Input rms current", eng(Iin, "A")), R("Peak line current", eng(Ipk, "A")),
          R("L_boost", eng(L, "H")), R("C_bulk", eng(C, "F")),
          R("HF leg blocking voltage", eng(Vb, "V")),
        ]),
        G("Efficiency accounting", [
          R("Diode loss avoided", eng(Pbr, "W"), "vs a bridged boost PFC"),
          R("Line-frequency leg conduction", eng(Plf, "W"), "one device conducts per half cycle, at R_DS(on) = " + s.rds + " mΩ"),
          R("Net gain", eng(Pbr - Plf, "W")),
          R("Equivalent efficiency gain", pct((Pbr - Plf) / Po)),
        ]),
        G("Watch list", [
          R("Zero crossing", "current spike risk", "blank or soft-start the duty around it"),
          R("Common-mode noise", "worse than bridged", "the whole output moves at line frequency"),
          R("Body diode", "must not conduct in CCM", "GaN has no body diode — that is the point"),
        ]),
      ],
    };
  },
},
{
  id: "hbridge", name: "H-bridge inverter", cat: "DC–AC inversion", sch: "hbridge",
  tag: "Single-phase DC to AC. Unipolar PWM doubles the effective filter frequency for free.",
  chips: ["single-phase", "unipolar PWM", "LC filter"],
  what: "Two legs modulated out of phase produce three output levels, so the filter sees 2·f_sw and a smaller voltage step. That single choice — unipolar rather than bipolar switching — typically halves the filter inductor and cuts the ripple current by four.",
  eqs: [
    { e: "v_out(pk) = m·V_dc", n: "m ≤ 1 for linear modulation" },
    { e: "ΔI = V_dc/(8·f_sw·L_f)", n: "unipolar PWM: the output switches between 0 and ±V_dc at an effective 2·f_sw, and the worst case is at |v_out| = V_dc/2 — bipolar switching would give V_dc/(4·f_sw·L_f), twice as much" },
    { e: "f_res = 1/(2π√(L_f·C_f)),  10·f_out < f_res < f_sw/10", n: "filter placement rule" },
    { e: "C_dc = P_out/(2π·f_out·V_dc·ΔV_dc(p-p))", n: "single-phase power arrives in humps at twice the output frequency, and the link capacitor absorbs all of it; ΔV_dc here is the full peak-to-peak swing" },
  ],
  pros: ["Three output levels with only four switches", "Filter sees 2·f_sw", "Simple, well-understood control"],
  cons: ["DC link must absorb 2·f_out ripple power", "Dead time distorts the output near the zero crossing", "Common-mode voltage jumps unless you use a special modulation"],
  use: ["Solar string and micro-inverters", "UPS output stages", "Motor drives for single-phase machines"],
  fields: ["vdc", "vac", "fo", "fsw", "pout", "r", "td", "rds", "tsw"],
  defs: { vdc: 400, vac: 230, fo: 50, fsw: 20, pout: 3000, r: 0.2, td: 500 },
  design(s) {
    const fs = s.fsw * 1e3, Vdc = s.vdc, Vac = s.vac;
    const m = Math.SQRT2 * Vac / Vdc;
    const Io = s.pout / Vac, Ipk = Math.SQRT2 * Io;
    const dI = s.r * Ipk;
    /* Unipolar (3-level) PWM: the terminal voltage steps between 0 and
       ±V_dc at an effective 2·f_sw, and the worst case sits at half
       modulation. That is V_dc/(8·f_sw·L) — half the bipolar result, and
       the whole reason to choose unipolar switching.                    */
    const Lf = Vdc / (8 * fs * dI);
    const fres = fs / 10;
    const Cf = 1 / (Lf * Math.pow(2 * Math.PI * fres, 2));
    const Iq = 2 * Math.PI * s.fo * Cf * Vac;
    /* Sized for 5 % PEAK-TO-PEAK ripple on the link at 2·f_out.

       Single-phase output power pulsates at 2·f_out, so the link current is
       P·cos(2ω_o·t)/V_dc and integrating gives a ripple of amplitude
       P/(4π·f_out·C·V_dc) — peak-to-peak, twice that. Solving the p-p form
       for C leaves 2π·f_out in the denominator, not 4π: the extra factor of
       two was sizing the link for the amplitude while the row beside it
       promised peak-to-peak, so the built converter rippled twice as far as
       the 5 % it claimed. Same slip the PFC bulk cap had. */
    const dVpp = 0.05 * Vdc;
    const Cdc = s.pout / (2 * Math.PI * s.fo * Vdc * dVpp);
    const Vdt = s.td * 1e-9 * fs * Vdc;
    return {
      hi: [["modulation index", f3(m)], ["filter inductor", eng(Lf, "H")], ["filter cap", eng(Cf, "F")]],
      loss: [["Conduction", 2 * Io * Io * s.rds * 1e-3, "2·I_out(rms)²·R_DS(on) — two devices in the path"],
        ["Switching", 4 * (2 / Math.PI) * Ipk * Vdc * s.tsw * 1e-9 * fs / 2,
          "four devices, averaged over the output sine"],
        ["Dead-time distortion", Vdt * Io, "energy the output never receives"]],
      warn: [
        m > 1 && "m = " + f2(m) + " exceeds 1: the bridge cannot make " + Vac + " V rms from " + Vdc + " V DC without overmodulation. Raise V_dc above " + eng(Math.SQRT2 * Vac, "V") + ".",
        Iq > 0.05 * Io && "Filter cap draws " + eng(Iq, "A") + " of reactive current, over 5 % of rated. Shrink C_f and raise L_f.",
      ].filter(Boolean),
      groups: [
        G("Modulation", [
          R("Modulation index m", f3(m)),
          R("Minimum V_dc", eng(Math.SQRT2 * Vac / 0.95, "V"), "for 5 % margin"),
          R("Output current rms / peak", eng(Io, "A") + " · " + eng(Ipk, "A")),
          R("Effective filter frequency", eng(2 * fs, "Hz"), "unipolar PWM"),
        ]),
        G("Output filter", [
          R("L_f", eng(Lf, "H"), "for " + pct(s.r) + " ripple, unipolar PWM"),
          R("Ripple current ΔI", eng(dI, "A"), "worst case, at |v_out| = V_dc/2"),
          R("C_f", eng(Cf, "F"), "resonance at " + eng(fres, "Hz")),
          R("Reactive current in C_f", eng(Iq, "A"), pct(Iq / Io) + " of rated"),
        ]),
        G("DC link and dead time", [
          R("C_dc for 5 % ripple", eng(Cdc, "F"), eng(dVpp, "V") + " p-p at 2·f_out = " + eng(2 * s.fo, "Hz")),
          R("DC link rms ripple current", eng(s.pout / (Math.SQRT2 * Vdc), "A")),
          R("Dead-time voltage error", eng(Vdt, "V"), "distorts the output near zero crossing"),
          R("Device blocking voltage", eng(Vdc, "V")),
        ]),
      ],
    };
  },
},
{
  id: "vsi3", name: "Three-phase two-level VSI", cat: "DC–AC inversion", sch: "vsi3",
  tag: "Six switches, three legs. The workhorse of motor drives and grid inverters.",
  chips: ["three-phase", "SVPWM", "motor drive"],
  what: "Three switching legs off one DC supply, one per motor phase, each producing a sine a third of a cycle behind the last — which is what makes a rotating field. The interesting trick is in the modulation. Each leg can be offset by the same amount without changing any voltage BETWEEN phases, and the motor only ever sees the differences, so that offset is free to use. Adding a deliberate third-harmonic offset lets each leg swing further before it runs out of supply, and buys 15.5 % more output from the same DC link than the obvious sine modulation. It costs a few lines of code and no hardware at all, which is why essentially every drive does it.",
  eqs: [
    { e: "SPWM: V_LL(rms) = 0.612·m·V_dc", n: "linear range m ≤ 1" },
    { e: "SVPWM: V_LL(rms) = 0.707·m·V_dc", n: "15.5 % more, same hardware" },
    { e: "V_dc ≥ √2·V_LL for SVPWM", n: "the practical sizing rule" },
    { e: "ΔV_deadtime = t_d·f_sw·V_dc", n: "per phase; compensate it in software" },
  ],
  pros: ["Minimum device count for three phases", "Mature modulation and control (FOC, DTC)", "No DC-link low-frequency ripple with balanced loads"],
  cons: ["Devices block the full V_dc", "dv/dt reflections stress motor insulation", "Common-mode current through motor bearings"],
  use: ["Industrial motor drives", "Grid-tied solar and storage inverters", "Traction inverters"],
  fields: ["vdc", "vac", "fo", "fsw", "pout", "td", "rds", "tsw"],
  defs: { vdc: 650, vac: 400, fo: 50, fsw: 8, pout: 15000, td: 2000 },
  design(s) {
    const fs = s.fsw * 1e3, Vdc = s.vdc;
    const mS = s.vac / (0.612 * Vdc), mV = s.vac / (0.707 * Vdc);
    const Iph = s.pout / (Math.sqrt(3) * s.vac), Ipk = Math.SQRT2 * Iph;
    const Icdc = Iph * Math.sqrt(2 * Math.min(mV, 1) * (Math.sqrt(3) / (4 * Math.PI) + (Math.sqrt(3) / Math.PI - 9 * Math.min(mV, 1) / 16)));
    const Vdt = s.td * 1e-9 * fs * Vdc;
    const Mratio = fs / s.fo;
    return {
      hi: [["m (SVPWM)", f3(mV)], ["phase current", eng(Iph, "A")], ["DC link ripple", eng(Icdc, "A")]],
      loss: [["Conduction", 6 * 0.5 * Iph * Iph * s.rds * 1e-3, "six devices, each conducting half the time"],
        ["Switching", 6 * (2 / Math.PI) * Ipk * Vdc * s.tsw * 1e-9 * fs / 2,
          "six devices, averaged over the output sine"]],
      warn: [
        mV > 1 && "SVPWM needs m = " + f2(mV) + " — beyond the linear range. Minimum V_dc for " + s.vac + " V is " + eng(s.vac / 0.707, "V") + ".",
        Mratio < 15 && "f_sw/f_out = " + f2(Mratio) + ". Below ~15 use synchronous modulation or the low-order harmonics become significant.",
      ].filter(Boolean),
      groups: [
        G("Modulation", [
          R("m required, sine PWM", f3(mS)),
          R("m required, SVPWM", f3(mV)),
          R("Minimum V_dc (SVPWM)", eng(s.vac / 0.707, "V")),
          R("Minimum V_dc (SPWM)", eng(s.vac / 0.612, "V")),
          R("Frequency ratio f_sw/f_out", f2(Mratio)),
        ]),
        G("Currents", [
          R("Phase current rms / peak", eng(Iph, "A") + " · " + eng(Ipk, "A")),
          R("Device rms current", eng(Iph / Math.SQRT2, "A"), "roughly, per switch"),
          R("DC link cap rms current", eng(Icdc, "A"), "assumes unity power factor"),
        ]),
        G("Practical limits", [
          R("Device blocking voltage", eng(Vdc, "V"), "use 1200 V for a 650 V link"),
          R("Dead-time voltage error", eng(Vdt, "V"), "per phase, per cycle"),
          R("Fundamental output limit", eng(0.707 * Vdc, "V"), "line-to-line rms, SVPWM"),
        ]),
      ],
    };
  },
},
{
  id: "npc3", name: "Three-level NPC / T-type", cat: "DC–AC inversion", sch: "npc3",
  tag: "Clamp the midpoint and every device sees half the bus. Three levels, far less filtering.",
  chips: ["three-level", "medium voltage", "low THD"],
  what: "An ordinary inverter can only connect its output to the top of the supply or the bottom, so every step it takes is the full supply voltage. Split the supply with two capacitors and you have a third point available — the middle — and a clamp diode lets the output stop there on the way past. Now each step is only half as large. Halving the step halves the unwanted frequencies it creates and halves the voltage each device has to withstand, so the output filter shrinks and cheaper devices will do. The price is twice the device count, and the need to watch that middle point: every visit to it moves charge into one capacitor and out of the other, so it drifts unless the control actively balances it.",
  eqs: [
    { e: "V_device = V_dc/2", n: "the central benefit: 650 V parts on a 1200 V bus" },
    { e: "same V_LL as a two-level for a given V_dc", n: "the gain is quality, not amplitude" },
    { e: "ΔV_step = V_dc/2", n: "half the dv/dt into the load" },
    { e: "NP ripple at 3·f_out", n: "size the split caps for it and balance actively" },
  ],
  pros: ["Half the device voltage — cheaper, faster silicon", "Much lower output THD and dv/dt", "Higher efficiency at high switching frequency"],
  cons: ["Twice the devices (plus clamp diodes)", "Neutral-point balancing is mandatory", "Uneven loss distribution between inner and outer devices"],
  use: ["Solar inverters above 1 kV", "Medium-voltage drives", "Grid-tied storage"],
  fields: ["vdc", "vac", "fo", "fsw", "pout", "rds", "tsw"],
  defs: { vdc: 800, vac: 400, fo: 50, fsw: 16, pout: 30000 },
  design(s) {
    const fs = s.fsw * 1e3, Vdc = s.vdc;
    const mV = s.vac / (0.707 * Vdc);
    const Iph = s.pout / (Math.sqrt(3) * s.vac), Ipk = Math.SQRT2 * Iph;
    const Cnp = Ipk / (2 * Math.PI * 3 * s.fo * (0.02 * Vdc / 2));
    return {
      hi: [["device blocking V", eng(Vdc / 2, "V")], ["m (SVPWM)", f3(mV)], ["phase current", eng(Iph, "A")]],
      loss: [["Conduction", 12 * 0.5 * Iph * Iph * s.rds * 1e-3, "twelve devices share the phase current"],
        ["Switching", 12 * (2 / Math.PI) * Ipk * (Vdc / 2) * s.tsw * 1e-9 * fs / 2,
          "each transition only steps half the link — the point of the topology"]],
      warn: [mV > 1 && "m = " + f2(mV) + " is beyond the linear range; raise V_dc above " + eng(s.vac / 0.707, "V") + "."].filter(Boolean),
      groups: [
        G("Voltage structure", [
          R("Bus voltage", eng(Vdc, "V")),
          R("Device blocking voltage", eng(Vdc / 2, "V"), "vs " + eng(Vdc, "V") + " for a two-level"),
          R("Output levels", "+V_dc/2, 0, −V_dc/2"),
          R("Voltage step", eng(Vdc / 2, "V"), "half the dv/dt into the load"),
          R("m required (SVPWM)", f3(mV)),
        ]),
        G("Neutral point", [
          R("NP ripple frequency", eng(3 * s.fo, "Hz")),
          R("Split cap for 2 % NP ripple", eng(Cnp, "F") + " each"),
          R("Balancing", "redundant vector selection", "or a dedicated NP current controller"),
        ]),
        G("Currents and loss", [
          R("Phase current rms / peak", eng(Iph, "A") + " · " + eng(Ipk, "A")),
          R("Inner vs outer devices", "uneven", "inner devices conduct longer at high m"),
          R("Effective output frequency", eng(2 * fs, "Hz"), "as seen by the filter"),
        ]),
      ],
    };
  },
},
];

/* ================= topologies — rectification ================= */
const TD = [
{
  id: "halfwave", name: "Half-wave rectifier", cat: "Rectification", sch: "halfwave",
  tag: "One diode and a reservoir capacitor — the simplest rectifier, and the clearest demonstration of crest factor.",
  chips: ["one diode", "high ripple", "DC in the transformer"],
  what: "The capacitor charges near the peak of each cycle and is left to discharge through the load for the rest of it. The diode therefore conducts in a narrow spike carrying many times the DC current — why half-wave supplies run hot transformers and struggle to meet emissions limits. It also draws unidirectional current, so any transformer feeding one carries a DC flux offset.",
  eqs: [
    { e: "V_pk = √2·V_ac − V_F", n: "peak of the rectified waveform" },
    { e: "ΔV = I_dc/(f_line·C)", n: "the cap discharges for a whole period, not half" },
    { e: "θ_c = arccos(1 − ΔV/V_pk)", n: "conduction angle — the parameter that governs peak and rms current" },
    { e: "I_pk = 4π·I_dc/θ_c", n: "triangular charging pulse, one per cycle" },
    { e: "PIV = 2·V_pk", n: "the diode sees the source peak plus the charged capacitor" },
  ],
  pros: ["One diode", "Trivial to build", "Adequate for low-current bias supplies"],
  cons: ["Ripple at f_line, so the reservoir capacitor must be correspondingly large", "Crest factors of 5–15 heat the transformer", "DC magnetising current saturates the transformer"],
  use: ["Low-current bias rails", "Cheap appliance timers", "Instructional circuits"],
  fields: ["vacIn", "fline", "idc", "cbulk", "vf"],
  defs: { vacIn: 230, idc: 0.2, cbulk: 470, vf: 0.9 },
  design(s) {
    const C = s.cbulk * 1e-6, f = s.fline, Idc = s.idc;
    const Vpk = Math.SQRT2 * s.vacIn - s.vf;
    const dV = Idc / (f * C);
    const Vdc = Vpk - dV / 2;
    /* θ_c = arccos(1 − ΔV/V_pk) is only real for 0 < ΔV/V_pk ≤ 1. Outside
       that the capacitor never recharges within a cycle and the model has
       nothing to say, so clamp and let the warning explain.             */
    const rat = clamp(dV / Vpk, 1e-6, 0.999);
    const th = Math.acos(1 - rat);
    const Ipk = (4 * Math.PI * Idc) / th;
    const Irms = Ipk * Math.sqrt(th / (6 * Math.PI));
    const Ic = Math.sqrt(Math.max(Irms * Irms - Idc * Idc, 0));
    const PF = (Vdc * Idc) / (s.vacIn * Irms);
    return {
      hi: [["DC output", eng(Vdc, "V")], ["ripple p-p", eng(dV, "V")], ["diode peak", eng(Ipk, "A")]],
      loss: [["Diode conduction", s.vf * Idc, "V_F·I_dc"]],
      warn: [
        Vpk <= 0 && "V_F is larger than the peak of the AC input — no current can flow at all. Lower the diode drop or raise V_ac.",
        Vpk > 0 && dV >= Vpk && "The capacitor fully discharges between peaks: this is not a DC rail, and the conduction-angle model below does not apply. Increase C_bulk or reduce the load.",
        Vpk > 0 && dV <= Vpk && dV > 0.3 * Vpk && "Ripple is " + pct(dV / Vpk) + " of the peak. The conduction-angle model gets rough past ~30 %, and the rail is barely DC.",
        Ipk / Idc > 12 && "Crest factor is " + f2(Ipk / Idc) + ". The transformer and diode see currents an order of magnitude above the DC draw.",
        "A half-wave rectifier draws unidirectional current. Any transformer ahead of it needs a gap or a much larger core to survive the DC flux.",
      ].filter(Boolean),
      groups: [
        G("Output", [
          R("Peak rectified voltage", eng(Vpk, "V")),
          R("Ripple ΔV p-p", eng(dV, "V"), "at f_line = " + s.fline + " Hz"),
          R("Mean DC output", eng(Vdc, "V")),
          R("Ripple as % of V_pk", pct(dV / Vpk)),
        ]),
        G("Diode and source currents", [
          R("Conduction angle θ_c", f2(th * 180 / Math.PI) + "°", "of each full cycle"),
          R("Peak diode current", eng(Ipk, "A")),
          R("Diode / line rms current", eng(Irms, "A")),
          R("Crest factor I_pk/I_dc", f2(Ipk / Idc)),
          R("Diode PIV", eng(2 * Vpk, "V"), "derate to 2× this"),
        ]),
        G("Losses and quality", [
          R("Diode conduction loss", eng(s.vf * Idc, "W")),
          R("Capacitor rms ripple current", eng(Ic, "A"), "sizes the cap, not capacitance"),
          R("Power factor", f2(PF), "displacement is fine; distortion is not"),
        ]),
      ],
    };
  },
},
{
  id: "bridgerect", name: "Full-bridge rectifier", cat: "Rectification", sch: "bridgerect",
  tag: "Four diodes, both half-cycles, twice the ripple frequency. The classic mains front end.",
  chips: ["four diodes", "2·f_line ripple", "no PFC"],
  what: "Using both half-cycles halves the ripple for a given capacitor and removes the DC component from the transformer. Two diode drops now sit in the path. The current still flows in narrow spikes near the peak, which is why anything above 75 W needs a PFC stage in front of it to meet harmonic limits.",
  eqs: [
    { e: "V_pk = √2·V_ac − 2·V_F", n: "two diodes conduct in series each half-cycle" },
    { e: "ΔV = I_dc/(2·f_line·C)", n: "twice the ripple frequency, half the ripple" },
    { e: "I_pk = 2π·I_dc/θ_c", n: "two charging pulses per cycle now" },
    { e: "PIV = V_pk", n: "half the half-wave requirement" },
    { e: "PF = P_dc/(V_ac·I_rms)", n: "typically 0.5–0.7 — distortion, not phase" },
  ],
  pros: ["No DC in the transformer", "Ripple at 2·f_line", "Diodes only block the peak, not twice it"],
  cons: ["Two diode drops — poor at low output voltages", "Power factor around 0.6 and high harmonics", "Uncontrolled inrush at switch-on"],
  use: ["Every non-PFC mains supply", "Motor drive front ends", "Secondary of an isolated converter"],
  fields: ["vacIn", "fline", "idc", "cbulk", "vf"],
  defs: { vacIn: 230, idc: 1, cbulk: 470, vf: 0.9 },
  design(s) {
    const C = s.cbulk * 1e-6, f = s.fline, Idc = s.idc;
    const Vpk = Math.SQRT2 * s.vacIn - 2 * s.vf;
    const dV = Idc / (2 * f * C);
    const Vdc = Vpk - dV / 2;
    const rat = clamp(dV / Vpk, 1e-6, 0.999);
    const th = Math.acos(1 - rat);
    const Ipk = (2 * Math.PI * Idc) / th;
    const Irms = Ipk * Math.sqrt(th / (3 * Math.PI));
    const Ic = Math.sqrt(Math.max(Irms * Irms - Idc * Idc, 0));
    const PF = (Vdc * Idc) / (s.vacIn * Irms);
    const Pd = 2 * s.vf * Idc;
    return {
      hi: [["DC output", eng(Vdc, "V")], ["ripple p-p", eng(dV, "V")], ["power factor", f2(PF)]],
      loss: [["Diode conduction", Pd, "2·V_F·I_dc — two diodes in series each half-cycle"]],
      warn: [
        PF < 0.7 && "Power factor is " + f2(PF) + " with badly distorted line current. Above 75 W this will not pass IEC 61000-3-2 — put a PFC stage in front.",
        Ipk / Idc > 8 && "Crest factor " + f2(Ipk / Idc) + ": the bridge and the source both see " + eng(Ipk, "A") + " peaks. Size the diode's I_FSM accordingly.",
        "Inrush at switch-on is limited only by line and ESR impedance. Budget an NTC or a relay-bypassed resistor.",
      ].filter(Boolean),
      groups: [
        G("Output", [
          R("Peak rectified voltage", eng(Vpk, "V")),
          R("Ripple ΔV p-p", eng(dV, "V"), "at 2·f_line = " + eng(2 * f, "Hz")),
          R("Mean DC output", eng(Vdc, "V")),
          R("C for 5 % ripple", eng(Idc / (2 * f * 0.05 * Vpk), "F"), "if you want to do better"),
        ]),
        G("Currents", [
          R("Conduction angle θ_c", f2(th * 180 / Math.PI) + "°"),
          R("Peak diode current", eng(Ipk, "A")),
          R("Line rms current", eng(Irms, "A")),
          R("Crest factor", f2(Ipk / Idc)),
          R("Capacitor rms ripple", eng(Ic, "A")),
        ]),
        G("Devices and quality", [
          R("Diode PIV", eng(Vpk, "V"), "use 600 V for 230 V mains"),
          R("Bridge conduction loss", eng(Pd, "W"), "two drops in the path"),
          R("Diode average (each)", eng(Idc / 2, "A")),
          R("Power factor", f2(PF)),
          R("Apparent power drawn", eng(s.vacIn * Irms, "VA")),
        ]),
      ],
    };
  },
},
{
  id: "ctrect", name: "Centre-tapped rectifier", cat: "Rectification", sch: "ctrect",
  tag: "Two diodes, one drop in the path. The standard secondary for low-voltage outputs.",
  chips: ["secondary side", "one V_F", "choke input"],
  what: "A centre-tapped secondary lets each half-winding supply one half-cycle through a single diode, so only one forward drop sits in the output path instead of two. That matters enormously at 3.3 or 5 V. The cost is transformer utilisation: each half-winding works only half the time, so the secondary needs about twice the copper of a bridge.",
  eqs: [
    { e: "V_out = 2·D·(V_sec − V_F)", n: "two pulses per period, each of width D·T — so D is measured against the whole period and stays under 0.5" },
    { e: "L_f = (V_sec − V_F − V_out)·D/(f_sw·ΔI)", n: "filter choke from the ripple you allow" },
    { e: "PIV = 2·V_sec", n: "the idle diode sees both half-windings in series" },
    { e: "I_D(avg) = I_out/2", n: "independent of duty — the freewheel period splits evenly" },
    { e: "output ripple sits at 2·f_sw", n: "two power pulses per switching cycle" },
  ],
  pros: ["Only one diode drop in the output path", "Two devices instead of four", "Both rectifiers share a common ground — easy to drive if synchronous"],
  cons: ["Needs twice the secondary copper", "Diodes block twice the winding voltage", "Centre tap must be accurately placed or the halves imbalance"],
  use: ["Low-voltage secondaries of forward and push-pull converters", "Linear supply secondaries", "Anywhere V_F costs real efficiency"],
  fields: ["vsec", "dnom", "iout", "fsw", "r", "vf", "esr", "dvout", "lsag"],
  defs: { vsec: 12, dnom: 0.4, iout: 20, fsw: 150, r: 0.3, vf: 0.45, esr: 3, dvout: 30 },
  design(s) {
    const fs = s.fsw * 1e3, D = s.dnom, Io = s.iout;
    /* Each of the two pulses can occupy at most half the period. Past that
       the halves would overlap and short the secondary — and arithmetically
       V_out climbs above the winding that feeds it, so the choke's volt-second
       balance inverts and L comes out negative. The warning said so while the
       table went on printing negative henries beside it. */
    if (D >= 0.5) return infeasible("Each half-cycle can occupy at most half the period, so D must stay "
      + "below 0.5 — at " + f2(D) + " the two rectifiers would conduct together and short the secondary. "
      + "Lower the duty, or raise V_sec if you were reaching for more output voltage.");
    /* Two power pulses per period, each of width D·T, so the choke's input
       averages 2·D·(V_sec − V_F) and not D·(V_sec − V_F).

       This page carried the factor-of-two error until the double-pulse timing
       was drawn honestly, and the error was findable because three of its own
       formulas disagreed with the fourth. L_f = (V_sec − V_F − V_out)·D/(f·ΔI)
       puts the rise over D·T; I_D(rms) = I_out·√(D + (1 − 2D)/4) and
       I_D(avg) = I_out/2 both split the freewheel over (1 − 2D); and the
       warning below says D must stay under 0.5. All four only agree if D is
       one pulse measured against the WHOLE period — which is the same
       convention the push-pull, half-bridge and phase-shifted bridge use, and
       under it volt-second balance on the choke gives
       (V_sec − V_F − V_out)·D = V_out·(½ − D), i.e. V_out = 2·D·(V_sec − V_F).
       V_out was the odd one out, so V_out is what moved. */
    const Vo = 2 * D * (s.vsec - s.vf);
    const dI = s.r * Io;
    const L = (s.vsec - s.vf - Vo) * D / (fs * dI);
    const Ipk = Io + dI / 2;
    const Idrms = Io * Math.sqrt(D + (1 - 2 * D) / 4);
    const Co = dI / (8 * 2 * fs * s.dvout * 1e-3);
    const Pd = s.vf * Io;
    const Pesr = dI * dI / 12 * s.esr * 1e-3;
    return {
      hi: [["output voltage", eng(Vo, "V")], ["filter choke", eng(L, "H")], ["rectifier loss", eng(Pd, "W")]],
      /* Two pulses per period and a diode drop, so V_out is 2·D·(V_sec − V_F)
         and not the D·V_sec the generic estimate assumes from a duty and a
         winding voltage. The efficiency map divides by this, and was reading
         roughly half the real output power for every point on the surface. */
      pout: Vo * Io,
      loss: [["Rectifiers", Pd, "V_F·I_out — one diode drop in the path at a time"],
        ["Output cap ESR", Pesr, "(ΔI²/12)·ESR"]],
      /* Two power pulses per period — but NOT bipolar. This node is behind
         the rectifiers, so both half-cycles arrive positive and its mean is
         2·D × V_sec rather than zero. The primary that feeds it is the bipolar
         one; that pane lives on the push-pull and bridge pages. */
      wave: { sat: s.lsag / 100, D: D, dI: dI, iavg: Io, vlabel: "v_rect", vhi: "V_sec", ilabel: "i_Lf",
        pulses: 2,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        D > 0.46 && "D = " + f2(D) + " leaves almost no margin below the 0.5 ceiling. Real drives need dead time between the halves, so keep a few points in hand.",
        Pd > 0.05 * Vo * Io && "Rectifier loss is " + pct(Pd / (Vo * Io)) + " of the output. At this current a synchronous rectifier is justified.",
      ].filter(Boolean),
      groups: [
        G("Operating point", [
          R("Output voltage", eng(Vo, "V")),
          R("Required V_sec for " + eng(Vo, "V"), eng(Vo / (2 * D) + s.vf, "V")),
          R("Duty of each pulse", f2(D), "of the whole period — two pulses, so ≤ 0.5"),
          R("Ripple frequency", eng(2 * fs, "Hz")),
        ]),
        G("Filter", [
          R("L_f", eng(L, "H"), "for ΔI = " + pct(s.r)),
          R("ΔI_L", eng(dI, "A")),
          R("I_L peak", eng(Ipk, "A")),
          R("C_out (charge term)", eng(Co, "F"), "for ΔV = " + s.dvout + " mV"),
          R("ΔV from ESR", eng(dI * s.esr * 1e-3, "V")),
        ]),
        G("Rectifiers", [
          R("PIV per diode", eng(2 * s.vsec, "V"), "derate ≥ 1.5× for leakage ringing"),
          R("Average current each", eng(Io / 2, "A")),
          R("RMS current each", eng(Idrms, "A")),
          R("Total conduction loss", eng(Pd, "W"), "one drop, not two"),
          R("Output cap ESR loss", eng(Pesr, "W")),
        ]),
      ],
    };
  },
},
{
  id: "syncrect", name: "Synchronous rectifier", cat: "Rectification", sch: "syncrect",
  tag: "Replace the diode with a MOSFET and the loss stops being a fixed voltage drop.",
  chips: ["MOSFET rectifier", "low V_out", "drive matters"],
  what: "A diode dissipates V_F·I regardless of device selection. A MOSFET dissipates I²·R_DS, which at low current is far less — and the crossover between them is the whole design question. Below the break-even current the FET wins by a wide margin; the practical limits are body-diode conduction during dead time, gate charge at high frequency, and reverse conduction in discontinuous operation.",
  eqs: [
    { e: "P_diode = V_F·I_out", n: "a fixed drop, independent of device quality" },
    { e: "P_sync = 2·I_rms²·R_DS(on)", n: "two rectifiers sharing the output current" },
    { e: "I_breakeven = V_F/R_DS(on)", n: "above this a single FET beats a single diode" },
    { e: "P_body = 2·V_F·I_out·t_dead·f_sw", n: "the body diode still conducts across each transition" },
    { e: "P_gate = 2·Q_g·V_gate·f_sw", n: "dissipated in the driver every cycle" },
  ],
  pros: ["Cuts rectification loss several-fold at low output voltage", "Loss falls with current, so light-load efficiency improves", "Enables reverse power flow if you want it"],
  cons: ["Gate drive and timing must be right or you get shoot-through", "Reverse conduction in DCM dumps energy back", "Gate charge sets a frequency ceiling"],
  use: ["Every 12 V and below output above a few amps", "Server and telecom rectifiers", "Anywhere the secondary loss dominates"],
  fields: ["vout", "iout", "fsw", "dnom", "vf", "rds", "qg", "vg", "td"],
  defs: { vout: 5, iout: 30, fsw: 150, dnom: 0.4, vf: 0.45, rds: 3, qg: 30, vg: 10, td: 60 },
  design(s) {
    const fs = s.fsw * 1e3, Io = s.iout, D = s.dnom, Rd = s.rds * 1e-3;
    const Irms = Io * Math.sqrt(D + (1 - 2 * D) / 4);
    const Pdio = s.vf * Io;
    const Pcond = 2 * Irms * Irms * Rd;
    const Pbody = 2 * s.vf * Io * s.td * 1e-9 * fs;
    const Pgate = 2 * s.qg * 1e-9 * s.vg * fs;
    const Psync = Pcond + Pbody + Pgate;
    const Ibe = s.vf / Rd;
    const Po = s.vout * Io;
    return {
      hi: [["diode loss", eng(Pdio, "W")], ["synchronous loss", eng(Psync, "W")], ["efficiency gained", pct((Pdio - Psync) / Po)]],
      loss: [["Channel conduction", Pcond, "2·I_rms²·R_DS(on)"],
        ["Body diode (dead time)", Pbody, "2·V_F·I_out·t_dead·f_sw"],
        ["Gate drive", Pgate, "2·Q_g·V_gate·f_sw"]],
      warn: [
        Psync > Pdio && "At this current the FET is losing to the diode. R_DS(on) of " + s.rds + " mΩ breaks even at " + eng(Ibe, "A") + " — either parallel devices or keep the Schottky.",
        Pgate > 0.25 * Psync && "Gate drive is " + pct(Pgate / Psync) + " of the total. At " + s.fsw + " kHz a lower-Q_g device beats a lower-R_DS one.",
        Pbody > 0.2 * Psync && "Body-diode conduction is " + pct(Pbody / Psync) + " of the loss. Tighten the dead time — " + s.td + " ns is costing " + eng(Pbody, "W") + ".",
      ].filter(Boolean),
      groups: [
        G("The comparison", [
          R("Schottky loss V_F·I_out", eng(Pdio, "W")),
          R("Synchronous total", eng(Psync, "W")),
          R("Power saved", eng(Pdio - Psync, "W")),
          R("Efficiency delta", pct((Pdio - Psync) / Po), "on a " + eng(Po, "W") + " output"),
          R("Break-even current", eng(Ibe, "A"), "one FET vs one diode"),
        ]),
        G("Where the synchronous watts go", [
          R("Channel conduction", eng(Pcond, "W"), "I_rms = " + eng(Irms, "A") + " each"),
          R("Body diode in dead time", eng(Pbody, "W"), s.td + " ns × 2 per cycle"),
          R("Gate drive", eng(Pgate, "W")),
          R("Equivalent drop per rectifier", eng(Irms * Rd, "V"), "against " + s.vf + " V for the diode"),
        ]),
        G("Getting the drive right", [
          R("Self-driven", "free, poor timing", "windings drive the gates; fails at high duty"),
          R("Control-driven", "best timing", "needs a level shift and accurate dead time"),
          R("Sensing SR controller", "robust", "watches V_DS; standard for flyback and LLC"),
          R("DCM hazard", "reverse conduction", "turn off on zero crossing, not on the clock"),
        ]),
      ],
    };
  },
},
{
  id: "doubler", name: "Current doubler rectifier", cat: "Rectification", sch: "doubler",
  tag: "One secondary winding, two inductors, each carrying half the output current.",
  chips: ["high current", "ripple cancellation", "single winding"],
  what: "Two inductors feed the output in antiphase from a single secondary winding. Each carries only half the load current, their ripples partly cancel at the output, and the winding sees the full duty rather than half — so the transformer is used better than a centre-tapped design. It is the standard secondary for high-current, low-voltage converters.",
  eqs: [
    { e: "V_out = D·V_sec", n: "each inductor is effectively a buck stage" },
    { e: "I_L1 = I_L2 = I_out/2", n: "the defining property of the topology" },
    { e: "L = (V_sec − V_out)·D/(f_sw·ΔI_L)", n: "sized per inductor, for half the current" },
    { e: "K(D) = |1 − 2D|/(1 − D)", n: "ripple cancellation factor at the output node" },
    { e: "I_D(avg) = I_out/2", n: "each rectifier, same as centre-tapped" },
  ],
  pros: ["Single secondary winding — best transformer utilisation", "Two smaller inductors instead of one large one", "Output ripple partly cancels and sits at 2·f_sw"],
  cons: ["Two inductors to wind and place", "Current sharing depends on matched inductors", "Marginal benefit below about 10 A"],
  use: ["High-current low-voltage secondaries", "Phase-shifted full-bridge outputs", "Server VRM front ends"],
  fields: ["vsec", "dnom", "iout", "fsw", "r", "vf", "dvout", "lsag"],
  defs: { vsec: 14, dnom: 0.35, iout: 60, fsw: 200, r: 0.4, vf: 0.45, dvout: 30 },
  design(s) {
    const fs = s.fsw * 1e3, D = s.dnom, Io = s.iout;
    const Vo = D * s.vsec;
    const IL = Io / 2;
    const dI = s.r * IL;
    const L = (s.vsec - Vo) * D / (fs * dI);
    /* K(D) = |1−2D|/(1−D) is the published cancellation factor, and it is
       genuinely 0 at D = 0.5 — but only D < 0.5 is physical here, since
       each polarity can occupy at most half the period.                  */
    const physical = D < 0.5;
    const K = physical ? Math.abs(1 - 2 * D) / (1 - D) : NaN;
    const dIo = dI * K;
    const Co = dIo / (8 * 2 * fs * s.dvout * 1e-3);
    const Ipk = IL + dI / 2;
    const Pd = s.vf * Io;
    return {
      hi: [["output voltage", eng(Vo, "V")], ["each inductor", eng(L, "H")], ["current per inductor", eng(IL, "A")]],
      loss: [["Rectifiers", Pd, "V_F·I_out"]],
      /* One inductor is plotted; the capacitor sees both, half a period apart.
         Handing the model the phase count rather than the cancelled ripple
         means the pane derives K from the two waveforms — so the drawn ripple
         is a consequence of the interleaving rather than a restatement of the
         published factor above it. */
      wave: { sat: s.lsag / 100, D: D, dI: dI, iavg: IL, vlabel: "v_sec", vhi: "V_sec", ilabel: "i_L1",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, n: 2 } },
      warn: [
        D > 0.5 && "D = " + f2(D) + " is above 0.5, which is not physical for a current doubler — each polarity can occupy at most half the period.",
        Math.abs(D - 0.5) < 0.06 && "Duty is close to 0.5, where the two ripples cancel almost perfectly. Excellent for the output cap, but leaves no headroom for line regulation.",
      ].filter(Boolean),
      groups: [
        G("Operating point", [
          R("Output voltage", eng(Vo, "V")),
          R("Required V_sec", eng(Vo / D, "V"), "for the target output"),
          R("Duty D", f2(D)),
          R("Output ripple frequency", eng(2 * fs, "Hz")),
        ]),
        G("Inductors", [
          R("L each", eng(L, "H")),
          R("DC current each", eng(IL, "A"), "half the load"),
          R("ΔI per inductor", eng(dI, "A")),
          R("Peak current each", eng(Ipk, "A")),
          R("Cancellation factor K(D)", f2(K), "|1−2D|/(1−D); 1.0 = no benefit"),
          R("Net output ripple", eng(dIo, "A"), "after cancellation"),
        ]),
        G("Rectifiers and cap", [
          R("PIV", eng(s.vsec, "V"), "half the centre-tapped requirement"),
          R("Average current each", eng(Io / 2, "A")),
          R("Peak current each", eng(Io, "A"), "carries the full load during power transfer"),
          R("Rectifier loss", eng(Pd, "W")),
          R("C_out (charge term)", K > 1e-3 ? eng(Co, "F") : "≈ 0",
            K > 1e-3 ? "small, thanks to cancellation"
              : "the charge term vanishes at perfect cancellation — ESR and inductor mismatch set the real ripple here"),
        ]),
      ],
    };
  },
},
];

/* ============ topologies — resonant switching amplifiers (class E) ============ */
/* Optimum single-ended class E, 50 % duty, high-Q load: the two constants that
   fall out of the ZVS + zero-slope conditions at turn-on.                      */
const CE_IM = Math.sqrt(1 + (Math.PI * Math.PI) / 4);   /* tank/DC current ratio, 1.8621 */
const CE_PH = -Math.atan(2 / Math.PI);                  /* phase, −32.48°               */
const ceV = (th) => (th < Math.PI ? 0
  : (th - Math.PI) - CE_IM * (Math.cos(th + CE_PH) - Math.cos(Math.PI + CE_PH)));
/* normalised drain voltage v_ds/V_dc, optionally phase-shifted */
const ceWave = (shiftDeg = 0) => {
  let sum = 0;
  for (let d = 0; d < 360; d += 3) sum += ceV((d * Math.PI) / 180);
  const mean = sum / (360 / 3);
  const pts = [];
  for (let d = 0; d <= 360; d += 3) {
    const dd = (((d - shiftDeg) % 360) + 360) % 360;
    pts.push([d, ceV((dd * Math.PI) / 180) / mean]);
  }
  return pts;
};
/* normalised switch current i_sw/I_dc */
const ceCur = () => {
  const pts = [];
  for (let d = 0; d <= 360; d += 3) {
    const th = (d * Math.PI) / 180;
    pts.push([d, th < Math.PI ? Math.max(1 + CE_IM * Math.sin(th + CE_PH), 0) : 0]);
  }
  return pts;
};

const TE = [
{
  id: "classe", name: "Class E (single-ended)", cat: "Resonant / class E", sch: "classe",
  tag: "One switch, zero voltage and zero slope at turn-on. Over 95 % at megahertz.",
  chips: ["ZVS + ZdVS", "one switch", "MHz capable"],
  what: "A radio-frequency amplifier built from a single switch instead of a linear device — the switch is either fully on or fully off, so in principle it dissipates nothing. The difficulty is the instant of turning on: if there is still voltage across the switch, whatever charge is sitting on it gets dumped as heat. Class E solves that by tuning the capacitor across the switch and the tank in series with it so the voltage coasts back down to zero, and flattens out there, exactly as the switch closes. There is then nothing left to dump. Two prices: the switch has to withstand about 3.56 times the supply voltage, and the tuning is only right at one frequency and one load.",
  eqs: [
    { e: "R = 0.5768·V_dc²/P_out", n: "the load the tank must present, before the Q correction" },
    { e: "C_sh = 0.1836/(ω·R)", n: "shunt capacitance, C_oss included — not added to it" },
    { e: "L_2 = Q_L·R/ω,  C_2 = 1/(ω·R·(Q_L − 1.1525))", n: "the series tank is deliberately detuned above resonance" },
    { e: "V_DS(pk) = 3.562·V_dc", n: "the defining cost of the topology" },
    { e: "I_SW(pk) = 2.862·I_dc", n: "rms is 1.538·I_dc" },
  ],
  pros: ["Only one switch and one gate drive, ground referenced", "Transition loss is identically zero rather than merely small", "Device C_oss is absorbed into the design"],
  cons: ["3.56× voltage stress demands a high-voltage device", "Optimal at exactly one load — detuning breaks ZVS", "Needs an RF choke and careful layout"],
  use: ["Induction heating and plasma drivers", "Wireless power transmitters", "RF power amplifiers and DC–DC resonant front ends"],
  fields: ["vdc", "pout", "fsw", "ql", "coss", "rds", "eff"],
  defs: { vdc: 48, pout: 100, fsw: 1000, ql: 6, coss: 300, rds: 30, eff: 0.92 },
  design(s) {
    const f = s.fsw * 1e3, w = 2 * Math.PI * f, Q = s.ql;
    const qc = 1.0000086 - 0.414395 / Q - 0.577501 / (Q * Q) + 0.205967 / (Q * Q * Q);
    const R = 0.576801 * (s.vdc * s.vdc / s.pout) * qc;
    const cc = 0.99866 + 0.91424 / Q - 1.03175 / (Q * Q);
    const Csh = (1 / (w * R * 5.44658)) * cc;
    const Lch = 6.9348 * R / f;
    const L2 = Q * R / w;
    const C2 = Q > 1.16 ? 1 / (w * R * (Q - 1.1525)) : NaN;
    const Idc = s.pout / (s.eff * s.vdc);
    const Vpk = 3.562 * s.vdc, Ipk = 2.862 * Idc, Irms = 1.5384 * Idc;
    const Pc = Irms * Irms * s.rds * 1e-3;
    const Coss = s.coss * 1e-12;
    const fmax = 0.18359 / (2 * Math.PI * R * Coss);
    const Itank = CE_IM * Idc;
    const Vc2 = isFinite(C2) ? Itank / (w * C2) : NaN;
    return {
      hi: [["load resistance", eng(R, "Ω")], ["shunt C", eng(Csh, "F")], ["peak V_DS", eng(Vpk, "V")]],
      loss: [["Switch conduction", Pc, "I_SW(rms)²·R_DS(on); ZVS makes the switching term ≈ 0"],
        ["C_oss shortfall", Coss > Csh ? 0.5 * (Coss - Csh) * s.vdc * s.vdc * f : 0,
          "charge the tuning cannot absorb is dumped at turn-on"]],
      chart: {
        title: "Drain voltage and switch current over one RF cycle",
        series: [
          { pts: ceWave(0), c: "#5AD1DE", label: "v_DS / V_dc" },
          { pts: ceCur(), c: "#E0A458", label: "i_SW / I_dc" },
        ],
        xmin: 0, xmax: 360, ymin: 0, ymax: 4, xlab: "ωt  (degrees)", ylab: "normalised",
        marks: [{ y: 3.562, t: "peak = 3.562·V_dc", c: "#F0796C" }],
      },
      warn: [
        Coss > Csh && "Device C_oss (" + eng(Coss, "F") + ") already exceeds the " + eng(Csh, "F") + " the design calls for. ZVS is impossible here — go below " + eng(fmax, "Hz") + ", raise the power, or find a lower-C_oss device.",
        Q < 3 && "Loaded Q of " + f2(Q) + " is low. The design equations assume a near-sinusoidal load current; below about 3 the harmonics make the real waveform diverge from this model.",
        Vpk > 0.8 * 4 * s.vdc && "Plan for a device rated well above " + eng(Vpk, "V") + " — component tolerance and load variation push the peak higher still.",
      ].filter(Boolean),
      groups: [
        G("Tank and load", [
          R2("Load resistance R", eng(R, "Ω"), "transform the real load to this"),
          R2("Shunt capacitance C_sh", eng(Csh, "F"), "includes C_oss of " + eng(Coss, "F")),
          R2("External shunt to add", eng(Math.max(Csh - Coss, 0), "F")),
          R2("Series L_2", eng(L2, "H")),
          R2("Series C_2", isFinite(C2) ? eng(C2, "F") : "—", "Q_L must exceed 1.15"),
          R2("RF choke L_chk", "≥ " + eng(Lch, "H"), "or design a finite-choke variant"),
        ]),
        G("Device stresses", [
          R2("Peak drain voltage", eng(Vpk, "V"), "3.562 × supply"),
          R2("DC input current", eng(Idc, "A")),
          R2("Peak switch current", eng(Ipk, "A")),
          R2("RMS switch current", eng(Irms, "A")),
          R2("Conduction loss", eng(Pc, "W"), "at R_DS(on) = " + s.rds + " mΩ"),
          R2("Peak tank current", eng(Itank, "A")),
        ]),
        G("Frequency limits", [
          R2("Operating frequency", eng(f, "Hz")),
          R2("Max f for ZVS with this C_oss", eng(fmax, "Hz")),
          R2("Headroom", f2(fmax / f) + "×", fmax > f ? "workable" : "over the limit"),
          R2("Peak voltage across C_2", isFinite(Vc2) ? eng(Vc2, "V") : "—", "the tank cap is the stressed part"),
        ]),
      ],
    };
  },
},
{
  id: "classepp", name: "Class E push-pull", cat: "Resonant / class E", sch: "classepp",
  tag: "Two class-E stages in antiphase. Twice the power, cancelled even harmonics.",
  chips: ["differential", "2× power", "clean spectrum"],
  what: "Two class-E amplifiers built as mirror images, driven exactly half a cycle apart, with the load connected between them. Because each half is doing the opposite of the other at every instant, the distortion products they share cancel in the load rather than reaching it, and the current each draws from the supply peaks when the other's is low — so the supply sees a far steadier draw. The pair also delivers twice the power for the same device stress. It only works if the halves match: any imbalance between them stops cancelling and shows up as distortion and as one device working harder than the other.",
  eqs: [
    { e: "each half designed for P_out/2", n: "the standard class-E equations, applied twice" },
    { e: "R_load = 2·R_half", n: "the differential load is the series pair" },
    { e: "V_DS(pk) = 3.562·V_dc", n: "unchanged — this buys power, not headroom" },
    { e: "even harmonics cancel", n: "the differential connection rejects them" },
    { e: "supply ripple at 2·f", n: "the two choke currents interleave" },
  ],
  pros: ["Twice the output for the same device voltage rating", "Even harmonics cancel — much less filtering", "Input current ripple halves and doubles in frequency"],
  cons: ["Two devices, two drives, and they must match", "Needs a differential load or a balun", "Asymmetry shows up directly as distortion"],
  use: ["Higher-power induction heating", "Wireless power and plasma generation", "RF transmitters where spectral purity matters"],
  fields: ["vdc", "pout", "fsw", "ql", "coss", "rds", "eff"],
  defs: { vdc: 48, pout: 400, fsw: 1000, ql: 6, coss: 300, rds: 30, eff: 0.92 },
  design(s) {
    const f = s.fsw * 1e3, w = 2 * Math.PI * f, Q = s.ql, Ph = s.pout / 2;
    const qc = 1.0000086 - 0.414395 / Q - 0.577501 / (Q * Q) + 0.205967 / (Q * Q * Q);
    const R = 0.576801 * (s.vdc * s.vdc / Ph) * qc;
    const cc = 0.99866 + 0.91424 / Q - 1.03175 / (Q * Q);
    const Csh = (1 / (w * R * 5.44658)) * cc;
    const L2 = Q * R / w;
    const C2 = Q > 1.16 ? 1 / (w * R * (Q - 1.1525)) : NaN;
    const Lch = 6.9348 * R / f;
    const Idc = s.pout / (s.eff * s.vdc), Ih = Idc / 2;
    const Vpk = 3.562 * s.vdc, Ipk = 2.862 * Ih, Irms = 1.5384 * Ih;
    const Pc = 2 * Irms * Irms * s.rds * 1e-3;
    const Coss = s.coss * 1e-12;
    const fmax = 0.18359 / (2 * Math.PI * R * Coss);
    return {
      hi: [["load (differential)", eng(2 * R, "Ω")], ["shunt C per side", eng(Csh, "F")], ["peak V_DS", eng(Vpk, "V")]],
      loss: [["Switch conduction", Pc, "2·I_SW(rms)²·R_DS(on), both halves"],
        ["C_oss shortfall", Coss > Csh ? 2 * 0.5 * (Coss - Csh) * s.vdc * s.vdc * f : 0,
          "per side, when C_oss exceeds the tuning"]],
      chart: {
        title: "Drain voltage of both halves over one RF cycle",
        series: [
          { pts: ceWave(0), c: "#5AD1DE", label: "Q1" },
          { pts: ceWave(180), c: "#A88BF0", label: "Q2" },
        ],
        xmin: 0, xmax: 360, ymin: 0, ymax: 4, xlab: "ωt  (degrees)", ylab: "v_DS / V_dc",
        marks: [{ y: 3.562, t: "peak = 3.562·V_dc", c: "#F0796C" }],
      },
      warn: [
        Coss > Csh && "C_oss of " + eng(Coss, "F") + " exceeds the " + eng(Csh, "F") + " each half needs. Below " + eng(fmax, "Hz") + " this design closes; above it, it does not.",
        Q < 3 && "Loaded Q of " + f2(Q) + " is below the range where the sinusoidal-load assumption holds.",
        "Match the two halves closely. A few percent of asymmetry in L_2 or C_2 puts even harmonics straight into the load and unbalances the device stresses.",
      ].filter(Boolean),
      groups: [
        G("Per half", [
          R2("Power per stage", eng(Ph, "W")),
          R2("R per half", eng(R, "Ω")),
          R2("Differential load", eng(2 * R, "Ω"), "what the pair drives"),
          R2("C_sh per side", eng(Csh, "F")),
          R2("L_2 per side", eng(L2, "H")),
          R2("C_2 per side", isFinite(C2) ? eng(C2, "F") : "—"),
          R2("RF choke each", "≥ " + eng(Lch, "H")),
        ]),
        G("Device stresses", [
          R2("Peak drain voltage", eng(Vpk, "V"), "same as single-ended"),
          R2("DC input current, total", eng(Idc, "A")),
          R2("Peak switch current each", eng(Ipk, "A")),
          R2("RMS switch current each", eng(Irms, "A")),
          R2("Conduction loss, both", eng(Pc, "W")),
        ]),
        G("What the pairing buys", [
          R2("Output vs single-ended", "2× for the same V_DS"),
          R2("Even harmonics", "cancelled at the load"),
          R2("Supply ripple frequency", eng(2 * f, "Hz")),
          R2("Max f for ZVS", eng(fmax, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "classde", name: "Class DE (combined ZVS)", cat: "Resonant / class E", sch: "classde",
  tag: "A class-D half-bridge switched with class-E transitions. ZVS at one times the supply.",
  chips: ["ZVS", "V_dc stress only", "dead-time tuned"],
  what: "A compromise between the two switched amplifier styles that takes the best of each. Two switches in a stack take turns, as in class D, so neither ever has to stand off more than the supply rail — against the 3.56 times a class E device sees. But instead of handing straight over, each is turned off slightly early, leaving a short gap where neither conducts. During that gap the tank current is left to drag the shared node across to the other rail on its own, so the switch about to close finds no voltage across it and closes for free. Same soft transition as class E, at a quarter of the device stress.",
  eqs: [
    { e: "D = 0.5 − f_sw·t_dead", n: "duty and dead time are one design variable, not two" },
    { e: "V_1 = (2·V_dc/π)·sin(π·D)", n: "fundamental driving the tank" },
    { e: "R = V_1²/(2·P_out)", n: "load the tank must present at resonance" },
    { e: "C_s = I_pk·t_dead/(2·V_dc)", n: "the node capacitance the transition can actually move" },
    { e: "V_DS = V_dc", n: "against 3.562·V_dc for single-ended class E" },
  ],
  pros: ["Device stress is the supply rail, not 3.56× it", "ZVS like class E without the voltage penalty", "Both devices share the same tank — good utilisation"],
  cons: ["Needs a high-side drive", "ZVS only holds over a limited load range", "Dead time must track frequency and load"],
  use: ["High-frequency DC–DC and wireless power", "Induction heating above a few hundred watts", "Anywhere class E's voltage stress is unaffordable"],
  fields: ["vdc", "pout", "fsw", "ql", "coss", "td", "rds"],
  defs: { vdc: 400, pout: 500, fsw: 500, ql: 5, coss: 200, td: 60 },
  design(s) {
    const f = s.fsw * 1e3, w = 2 * Math.PI * f;
    const td = s.td * 1e-9, Coss = s.coss * 1e-12;
    /* D = 0.5 − f·t_dead can go to zero or negative when the dead time
       swallows the whole half-period. Clamp so the tank maths stays finite
       and let the warning below say the design is not realisable.       */
    const Draw = 0.5 - f * td;
    const D = clamp(Draw, 1e-3, 0.5);
    const V1 = (2 * s.vdc / Math.PI) * Math.sin(Math.PI * D);
    const R = V1 * V1 / (2 * s.pout);
    const Ipk = V1 / R;
    const Cs = Ipk * td / (2 * s.vdc);
    const L = s.ql * R / w, C = 1 / (w * w * L);
    const tdMin = (2 * Coss * s.vdc) / Ipk;
    const Irms = Ipk / Math.SQRT2;
    const VAe = 3.562 * 2.862;
    return {
      hi: [["duty per device", f3(D)], ["load resistance", eng(R, "Ω")], ["device blocking V", eng(s.vdc, "V")]],
      loss: [["Switch conduction", 2 * Irms * Irms * D * s.rds * 1e-3, "2·I_rms²·D·R_DS(on)"],
        ["Lost ZVS", tdMin > td ? 2 * 0.5 * Coss * s.vdc * s.vdc * f : 0,
          "C_oss dumped at turn-on when the dead time is too short"]],
      warn: [
        Draw <= 0 && "A " + s.td + " ns dead time at " + s.fsw + " kHz consumes the entire half-period: there is no on-time left and this operating point does not exist. The numbers below are clamped to a nominal duty and mean nothing until you shorten the dead time or lower the frequency.",
        Draw > 0 && Draw <= 0.02 && "Dead time of " + s.td + " ns at " + s.fsw + " kHz leaves essentially no on-time. Shorten the dead time or drop the frequency.",
        Coss > Cs && "C_oss (" + eng(Coss, "F") + ") is larger than the " + eng(Cs, "F") + " this dead time can move. Increase t_dead to at least " + f2(tdMin * 1e9) + " ns or the node will not reach the rail before turn-on.",
        tdMin > td && "Required transition time is " + f2(tdMin * 1e9) + " ns against the " + s.td + " ns allowed — the bridge is switching hard.",
      ].filter(Boolean),
      groups: [
        G("Modulation", [
          R2("Duty per device D", f3(D), "0.5 minus the dead-time fraction"),
          R2("Dead time", s.td + " ns", "each transition"),
          R2("Fundamental V_1", eng(V1, "V"), "amplitude across the tank"),
          R2("Load resistance R", eng(R, "Ω"), "at resonance"),
        ]),
        G("Resonant tank", [
          R2("L_r", eng(L, "H"), "at Q = " + s.ql),
          R2("C_r", eng(C, "F")),
          R2("Characteristic impedance", eng(Math.sqrt(L / C), "Ω")),
          R2("Peak tank current", eng(Ipk, "A")),
          R2("RMS tank current", eng(Irms, "A")),
        ]),
        G("Zero-voltage switching", [
          R2("Charge to move per transition", eng(2 * Coss * s.vdc, "C")),
          R2("C_s the dead time can move", eng(Cs, "F")),
          R2("Minimum dead time for ZVS", f2(tdMin * 1e9) + " ns"),
          R2("Margin", f2(td / Math.max(tdMin, 1e-12)) + "×", td > tdMin ? "ZVS holds" : "hard switching"),
        ]),
        G("Against single-ended class E", [
          R2("Device voltage", eng(s.vdc, "V"), "vs " + eng(3.562 * s.vdc, "V") + " for class E"),
          R2("Class E device V·I product", f2(VAe) + "× P/V·I", "3.562 × 2.862"),
          R2("Devices needed", "2", "against 1, plus a high-side drive"),
          R2("Practical frequency ceiling", "set by t_dead", "class E scales further at low power"),
        ]),
      ],
    };
  },
},
];

const TOPOS = [...TA, ...TB, ...TD, ...TC, ...TE];
const CATS = ["Non-isolated DC–DC", "Isolated DC–DC", "Rectification", "AC–DC / PFC",
  "DC–AC inversion", "Resonant / class E"];

/* ============================ cheat sheet ============================ */
const SHEETS = [
{ cat: "Wide bandgap", title: "Driving SiC and GaN", rows: [
  { e: "CMTI ≥ 100 kV/µs for SiC and GaN", n: "50 kV/µs is enough for silicon. Pick a driver whose CMTI beats your actual dv/dt by at least 20 % — below that, common-mode transients corrupt the drive signal itself.", src: "onsemi AND9949" },
  { e: "active Miller clamp, or −3 to −5 V off bias", n: "Above a few volts per nanosecond, C_gd pushes the gate back up through R_g(off). A clamp sinks that current in a low-impedance path that bypasses the gate resistor entirely.", src: "Navitas AN021 · ST AN5583" },
  { e: "do not over-do negative bias on GaN", n: "There is no body diode, so reverse conduction happens at V_GS − V_th. Every extra volt of negative bias adds directly to third-quadrant loss during dead time.", src: "GaN Systems GN001" },
  { e: "clamp the bootstrap supply on GaN", n: "The switch node swings below ground during dead time, over-charging C_boot. Without a clamp near 5.75 V you exceed the gate rating on a part with almost no margin.", src: "EPC / Iron Device SMA6533" },
  { e: "P_driver = Q_g·V_drive·f_sw", n: "Independent of load power — budget it thermally per channel before you pick the package.", src: "" },
  { e: "measure V_GS at the device, Kelvin, hot", n: "Probing at the controller pin hides exactly the ringing that destroys parts.", src: "" },
]},
{ cat: "Magnetics", title: "Litz wire, done properly", rows: [
  { e: "strand diameter < δ, often by 4× or more", n: "A strand comparable to the skin depth buys almost nothing. The published design method targets a factor of several below it.", src: "Sullivan & Zhang, APEC 2014" },
  { e: "n₁(max) = 4·(δ/d_s)²  strands per bunching step", n: "With d_s = δ/4 that is 64 strands in a single twisting operation — beyond it you need a second stage or the bundle stops behaving.", src: "Sullivan & Zhang, APEC 2014" },
  { e: "bundle skin effect starts at ~2δ diameter", n: "The bundle as a whole behaves like a solid conductor once it gets large, no matter how fine the strands are.", src: "Sullivan & Zhang, APEC 2014" },
  { e: "twist ≤ 5 strands per stage", n: "Groups of five or fewer have no centre strand. A group of seven has one that is shielded by the others and carries almost nothing.", src: "Sullivan & Zhang, APEC 2014" },
  { e: "δ_eff = δ/√F_p", n: "Litz porosity: insulation displaces copper, so the effective skin depth degrades with packing factor. Finer strands cut AC resistance but raise DC resistance — there is an optimum.", src: "Sullivan, IEEE TPEL 1999" },
  { e: "first-cut window fill ≤ 25–30 % copper", n: "A realistic starting point for a litz-wound component, insulation and bobbin included.", src: "Sullivan & Zhang, APEC 2014" },
  { e: "interleave, then interleave again", n: "Splitting the primary around the secondary roughly halves the effective layer count and cuts proximity loss about fourfold per split.", src: "Erickson & Maksimović, ch. 12" },
]},
{ cat: "Magnetics", title: "Core loss you can trust", rows: [
  { e: "plain Steinmetz is for sinusoids only", n: "P_v = k·f^α·B^β assumes sinusoidal excitation. Your converter produces triangular or trapezoidal flux, and the error is not small.", src: "" },
  { e: "use iGSE for PWM flux", n: "P_v = (1/T)∫ k_i·|dB/dt|^α·(ΔB)^(β−α) dt, with k_i derived from the same k, α, β. This is the accepted state of the art among methods that need only Steinmetz parameters.", src: "Venkatachalam & Sullivan, COMPEL 2002" },
  { e: "neither captures DC bias", n: "A choke with a large DC component needs bias-dependent parameters or measured data. Do not trust a datasheet curve taken at zero bias.", src: "ETH Zürich PMSRC" },
  { e: "design against the hot curve", n: "B_sat falls roughly 20 % from 25 °C to 100 °C in power ferrite, and core loss curves shift with temperature in both directions depending on the material.", src: "" },
]},
{ cat: "Capacitors", title: "What MLCCs actually give you", rows: [
  { e: "a 10 µF 6.3 V X5R at 5 V can be under 4 µF", n: "Losses of 35–65 % under DC bias are routine for Class-II ceramics. Always check the effective value at the working voltage in the vendor simulator, never the printed number.", src: "Murata SimSurfing · KEMET K-SIM" },
  { e: "derate Class II to 50–70 % of rated voltage", n: "3.3 V rail → 6.3 V part; 5 V → 10 V; 12 V → 25 V. Across a switch node, halve it again.", src: "" },
  { e: "capacitance density trades against derating", n: "A 10 µF 0805 X7R holds more capacitance at 5 V than a 10 µF 0402 X5R. The smaller part is not the same component.", src: "" },
  { e: "DC bias accelerates ageing 5–10×", n: "Observed loss rates of 15–20 % per decade-hour under bias. Reflow above the Curie point resets the clock, which is why bench measurements on a fresh board mislead.", src: "osengr.org MLCC study" },
  { e: "Class II ceramics sing", n: "Modern coil whine is usually the capacitors, not the inductor. Smaller packages are less microphonic; soft-termination parts help.", src: "" },
  { e: "never use Class II for timing", n: "Bias, ageing, tempco and microphonics all stack. Use C0G/NP0 anywhere the value matters.", src: "" },
  { e: "electrolytic life: L = L₀·2^((T₀−T)/10)", n: "A 5000 h/105 °C part gives roughly 10 000 h at 95 °C and 20 000 h at 85 °C. The ripple-current rating is a thermal limit, not an electrical one.", src: "Nippon Chemi-Con · XP Power" },
]},
{ cat: "Snubbers", title: "Snubber design by measurement", rows: [
  { e: "1. measure f₀ · 2. add C · 3. measure f₁", n: "The two-measurement method: with a known added capacitance the frequency shift gives you both parasitics, no guessing.", src: "Nexperia AN11160" },
  { e: "add C until f halves → C_par = C_add/3", n: "The quick field version of the same thing. Then L_par = 1/((2πf₀)²·C_par).", src: "In Compliance / DigiKey" },
  { e: "R_snub = √(L_par/C_par), C_snub ≈ 3–4·C_par", n: "R equal to the characteristic impedance is the critically damped choice; anywhere from Z₀ to 2·Z₀ is usable.", src: "" },
  { e: "budget 25–60 mW and check it", n: "P = C_snub·V²·f_sw. Snubbers become hot spots faster than anyone expects, and the resistor is usually an 0603.", src: "Biricha / Shirsavar" },
  { e: "place it at the node with its own return via", n: "A snubber on the end of a long trace is an inductor with a resistor in series. It provides no damping.", src: "" },
]},
{ cat: "Layout", title: "The hot loop, precisely", rows: [
  { e: "buck: C_in → HS → LS → back to C_in", n: "This is the only loop carrying fully switched current, from zero to I_pk and back every cycle. It radiates in proportion to its area. Everything else is second order.", src: "ADI AN-139" },
  { e: "boost: switch → diode → C_out", n: "The critical loop moves to the output side. Get this wrong and the input filter cannot save you.", src: "ADI AN-139" },
  { e: "four-switch buck-boost has two hot loops", n: "Input side and output side, and both need minimising — a common cause of designs that pass at one V_in and fail at another.", src: "TI SLVAFJ3" },
  { e: "input cap negative terminal at the LS source", n: "Positive terminal at the HS drain. A via inside the hot loop adds about a nanohenry, which is volts of overshoot at 10 A/ns.", src: "TI SLVAFJ3" },
  { e: "unbroken ground plane directly beneath", n: "The image current cancels loop inductance only if the return path is unobstructed. Never route signals through it.", src: "TI SNVA638A, after Ott" },
  { e: "keep switch-node copper small", n: "It needs enough area for current and not one square millimetre more. Extra copper is a dv/dt antenna.", src: "TI SLVAFJ3" },
]},
{ cat: "Control", title: "Loop design, more precisely", rows: [
  { e: "peak current mode has a double pole at f_sw/2", n: "The sampling effect, not a parasitic. It sets the real bandwidth ceiling; inner-loop bandwidth lands around f_sw/6 to 2f_sw/3.", src: "Ridley, current-mode model" },
  { e: "keep the current-loop Q between 0.5 and 1", n: "Too little slope compensation peaks and goes subharmonic past D = 0.5; too much turns the converter back into voltage mode with extra phase lag.", src: "Ridley · TI How2Power" },
  { e: "optimal S_e equals the inductor downslope", n: "S_e ≥ 0.5·S_f is the stability minimum. Matching the downslope gives deadbeat response — one cycle to correct a perturbation.", src: "Ridley" },
  { e: "sense the output at the output capacitor", n: "Not after a second filter stage. Otherwise the loop faithfully regulates a node the load never sees.", src: "Würth DC/DC design handbook" },
  { e: "compensation components at the FB pin", n: "The error-amplifier summing node is the highest-impedance point in the converter and the easiest to inject noise into.", src: "TI SSZTAL0" },
]},
{ cat: "Numbers", title: "PFC and rectifier practice", rows: [
  { e: "PFC voltage loop 10–20 Hz, current loop kHz", n: "1 % of second-harmonic ripple on the error amplifier output produces roughly 0.5 % third-harmonic distortion in the line current.", src: "UC3854 application note" },
  { e: "CCM PFC inductor ripple 20–40 % of I_in(avg)", n: "A practical starting band before core loss or switch rms current starts to dominate.", src: "Infineon DN 2013-01" },
  { e: "≈ 100 W of PFC output per amp of diode rating", n: "First-pass sizing for the boost rectifier; add a surge-bypass diode for inrush.", src: "Infineon design guide" },
  { e: "CCM totem-pole demands zero Q_rr", n: "At each zero crossing the fast leg's duty jumps between 0 and 100 %. A silicon body diode cannot survive that commutation — this is why the topology waited for GaN and SiC.", src: "TI TIDUE54B · Infineon CoolGaN" },
  { e: "capacitor-input rectifiers: use Schade's curves", n: "Closed-form hand equations for peak repetitive diode current systematically under-predict. The 1943 curves against ωRC and source resistance remain the reference.", src: "Schade, Proc. IRE 1943" },
]},
{ cat: "Numbers", title: "Failure modes worth designing against", rows: [
  { e: "flux walking in push-pull and full bridge", n: "Any volt-second asymmetry marches the core toward one rail until it saturates. Peak current-mode control corrects it cycle by cycle; a DC-blocking capacitor helps.", src: "Pressman, Switching Power Supply Design" },
  { e: "PSFB lagging leg loses ZVS at light load", n: "The leading leg has output-inductor energy available; the lagging leg has only leakage. ½·L_r·I² ≥ (4/3)·C_oss·V_in² is the condition to check.", src: "Sabaté et al. · Rohm app note" },
  { e: "LLC below resonance is capacitive and fatal", n: "Cross into the capacitive region and the switches turn on into a charged node. Stay right of the peak-gain curve at every operating point, including start-up and short circuit.", src: "Huang, TI Power Supply Seminar" },
  { e: "DAB beyond 90° phase shift is unstable", n: "Power peaks at 90°; past it the derivative reverses sign and circulating current climbs while output power falls.", src: "Barlik et al. 2013 · De Doncker 1991" },
  { e: "check SOA, not the DC current rating", n: "The headline I_D is a bonding-wire number. Repetitive and single-pulse SOA is what actually limits a real design.", src: "" },
]},
{ cat: "Fundamentals", title: "The two balance laws", rows: [
  { e: "∫ v_L dt = 0 over one cycle", n: "Inductor volt-second balance in steady state. Every conversion ratio in this app comes from writing this for the on and off intervals." },
  { e: "∫ i_C dt = 0 over one cycle", n: "Capacitor charge balance. Use it to find average currents in transfer caps and to size ripple." },
  { e: "CCM ↔ DCM boundary: I_out = ΔI_L/2", n: "In DCM the ratio depends on load, the RHP zero disappears and the plant becomes first order." },
  { e: "ripple ratio r = ΔI_L/I_L ≈ 0.3", n: "0.2–0.4 is the practical optimum: smaller means a big inductor, larger means high peak current and core loss." },
  { e: "P = ½·L·I_pk²·f_sw", n: "Power a flyback or DCM converter can move. If the number is short, you need more L·I², i.e. a bigger core." },
]},
{ cat: "Fundamentals", title: "Choosing f_sw", rows: [
  { e: "size ∝ 1/f_sw,  loss ∝ f_sw", n: "The central trade-off. Magnetics and caps shrink; switching, gate and core losses grow." },
  { e: "avoid 455 kHz; take care from 150 kHz to 30 MHz", n: "455 kHz is the AM intermediate frequency, and the CISPR conducted range starts at 150 kHz — a 100 kHz fundamental keeps the first harmonic below it." },
  { e: "Si: ≤ 500 kHz · SiC: 100 k–500 kHz · GaN: 500 kHz–5 MHz", n: "Rough comfort zones for hard-switched hundreds of watts." },
  { e: "t_on(min) = D_min/f_sw", n: "Check against the controller's minimum on-time — this kills more high-V_in designs than anything else." },
]},
{ cat: "Magnetics", title: "Inductor design", rows: [
  { e: "L = V·Δt/ΔI", n: "Everything starts here: applied volt-seconds over the ripple you allow." },
  { e: "N = L·I_pk/(B_max·A_e)", n: "Turns for a given peak flux. Keep B_max at 0.7–0.8·B_sat hot." },
  { e: "l_gap = µ₀·N²·A_e/L", n: "Gap length for a gapped ferrite; ignores fringing, which typically adds 10–20 % to the effective A_e." },
  { e: "A_p = A_e·A_w = L·I_pk·I_rms/(K_u·J·B_max)", n: "Area product — picks the core size before you know the core. K_u ≈ 0.4, J ≈ 4–5 A/mm²." },
  { e: "E = ½·L·I²", n: "Stored energy. A gap is just a place to store it outside the ferrite." },
  { e: "P_core = k·f^α·B^β  (Steinmetz)", n: "α ≈ 1.3–1.6, β ≈ 2.3–2.7 for power ferrite. Use B_pk, not B_pk-pk, and check the datasheet curve at your temperature." },
  { e: "δ = 66/√f  mm (copper, 20 °C)", n: "Skin depth. 100 kHz → 0.21 mm, so wire thicker than ~0.4 mm diameter is wasted; use litz or foil." },
]},
{ cat: "Magnetics", title: "Core materials", rows: [
  { e: "MnZn ferrite: B_sat ≈ 390 mT hot", n: "Grades N87 and 3C95 are the usual starting points. Default for 20 kHz–1 MHz. Low loss, hard saturation — needs a discrete gap." },
  { e: "Powder iron: B_sat ≈ 1.0–1.5 T", n: "Cheap, soft saturation, high core loss. Fine for line filters, poor above ~100 kHz." },
  { e: "Sendust / Kool Mµ: B_sat ≈ 1 T", n: "Distributed gap, soft roll-off, good DC bias behaviour. The usual PFC choke material." },
  { e: "MPP: B_sat ≈ 0.75 T", n: "Lowest loss of the powder cores, most expensive. Filter and output chokes." },
  { e: "Nanocrystalline: B_sat ≈ 1.2 T, µ_r huge", n: "Common-mode chokes and high-frequency transformers." },
  { e: "derate B_sat by ~20 % at 100 °C", n: "Always design against the hot curve, not the 25 °C one." },
]},
{ cat: "Magnetics", title: "Transformer design", rows: [
  { e: "N_p = V_in·D/(f_sw·ΔB·A_e)", n: "Primary turns from volt-seconds. For a two-quadrant drive use ΔB ≈ 0.2–0.3 T, for a flyback use B_pk." },
  { e: "flyback: gap set by energy, not by ΔB", n: "The flyback transformer is a coupled inductor, not a true transformer. Size the gap so B_pk at I_pk stays below saturation." },
  { e: "L_leak ≈ 1–3 % of L_p", n: "Interleaving primary and secondary halves cuts it roughly fourfold." },
  { e: "F_r = R_ac/R_dc (Dowell)", n: "Layer count drives AC resistance far more than wire gauge. Interleave, then interleave again." },
  { e: "safety: 3 layers of tape or triple-insulated wire", n: "Reinforced insulation for mains isolation; creepage typically 6.4 mm across the barrier." },
]},
{ cat: "Capacitors", title: "Ripple and selection", rows: [
  { e: "ΔV = ΔQ/C + ESR·ΔI + ESL·di/dt", n: "Three terms. Above a few hundred kilohertz the middle one usually wins; during a load step the third one does." },
  { e: "MLCC X7R loses 50–80 % of its capacitance at rated V_dc", n: "A 10 µF 25 V X7R at 12 V may be 4 µF. Always check the DC bias curve — this is the most frequently overlooked derating in power design." },
  { e: "C_hold = 2·P·t/(V1² − V2²)", n: "Hold-up sizing for bulk caps." },
  { e: "electrolytic life doubles per 10 °C cooler", n: "Ripple current heats the core; the rms rating is a thermal limit, not an electrical one." },
  { e: "class-II ceramics are piezoelectric", n: "Audible singing on a rail with ripple in the 1–10 kHz band; use two smaller caps or film." },
  { e: "polymer / hybrid: low ESR, no dry-out", n: "Good replacement for electrolytics up to ~100 V." },
]},
{ cat: "Semiconductors", title: "MOSFET loss", rows: [
  { e: "P_cond = I_rms²·R_DS(on) at T_j", n: "R_DS(on) rises 1.3–1.7× from 25 °C to 100 °C in silicon. Always use the hot number." },
  { e: "P_sw ≈ ½·V_ds·I_d·(t_r + t_f)·f_sw", n: "Only for hard-switched transitions. Add Q_oss·V·f and Q_rr·V·f." },
  { e: "P_gate = Q_g·V_drive·f_sw", n: "Dissipated in the driver and R_g, not in the FET channel." },
  { e: "FOM = R_DS(on)·Q_g", n: "The single best figure for comparing devices at a given voltage class." },
  { e: "P_body = V_F·I·t_dead·f_sw·2", n: "Body-diode conduction during dead time; also where Q_rr comes from." },
  { e: "check SOA, not just I_D(max)", n: "The DC current rating is a bonding-wire number. Repetitive and single-pulse SOA is what actually limits you." },
]},
{ cat: "Semiconductors", title: "Which device technology", rows: [
  { e: "Si MOSFET < 250 V", n: "Cheap, fast, excellent R_DS(on)·A. The default below 100 V." },
  { e: "Superjunction 500–900 V", n: "Off-line workhorse. Nonlinear C_oss and slow body diode — avoid hard-commutating it." },
  { e: "IGBT 600 V–6.5 kV, < ~20 kHz", n: "Current-density king at high voltage and low frequency; tail current dominates switching loss." },
  { e: "SiC MOSFET 650 V–1.7 kV", n: "Replaces IGBTs when frequency or efficiency matters. Needs careful gate drive (often −3 to −5 V off)." },
  { e: "GaN HEMT 100–650 V", n: "Lowest Q_oss and zero reverse recovery; enables MHz operation and totem-pole PFC. Tight gate margins, no avalanche." },
  { e: "Schottky vs SiC diode", n: "Schottky below 200 V for zero recovery; SiC above for the same benefit." },
]},
{ cat: "Thermal", title: "Getting heat out", rows: [
  { e: "T_j = T_a + P·(R_θjc + R_θcs + R_θsa)", n: "The whole thermal design in one line. Solve for allowed P at the worst-case T_a." },
  { e: "1 oz copper pour: R_θ ≈ 50 °C/W at 1 cm²", n: "Falls to about 30 °C/W at 6 cm², then flattens. More copper past that buys little." },
  { e: "thermal via: ≈ 100 °C/W each", n: "Use arrays of 0.3 mm vias under the pad; an array of twenty provides a genuine thermal path." },
  { e: "Z_θ(t) for pulses", n: "Short overloads ride the transient impedance curve; a 10 ms pulse may see a tenth of the steady-state R_θ." },
  { e: "derate to T_j ≤ 110–125 °C", n: "Leaves margin for R_DS(on) tempco runaway and improves lifetime." },
]},
{ cat: "Control", title: "Loop shaping", rows: [
  { e: "f_c ≤ f_sw/10", n: "Sampling makes anything faster unreliable; f_sw/20 is the safe default for voltage mode." },
  { e: "phase margin 45–60°, gain margin > 10 dB", n: "Below 45° gives ringing overshoot; above 60° is sluggish." },
  { e: "voltage mode: double pole at 1/(2π√LC)", n: "Needs a Type III compensator to add the two zeros back." },
  { e: "peak current mode: single pole at 1/(2π·R·C)", n: "The inductor pole disappears, so a Type II compensator is enough." },
  { e: "slope comp S_e ≥ 0.5·S_f for D > 0.5", n: "S_f = (V_out/L)·R_i. Without it, alternate-cycle instability at high duty." },
  { e: "RHP zero: boost, buck-boost, flyback (CCM)", n: "Cross over below f_RHPZ/5. Nothing in the compensator can fix it — only lower L or DCM can." },
  { e: "ESR zero at 1/(2π·ESR·C)", n: "All-ceramic outputs push it far out, which is why they often need more compensation, not less." },
]},
{ cat: "Control", title: "Current sensing", rows: [
  { e: "shunt: accurate, lossy", n: "P = I²R. Kelvin-connect it and keep the sense pair tight and away from the switch node." },
  { e: "inductor DCR sense: lossless, drifts", n: "R·C must match L/DCR; copper drifts +0.39 %/°C, so accuracy is ±20 % unless compensated." },
  { e: "R_DS(on) sense: free, very inaccurate", n: "Fine for cycle-by-cycle limiting, not for current sharing." },
  { e: "current transformer: isolated, no DC", n: "Needs a reset winding or volt-second balance; standard on bridge primaries." },
  { e: "Hall / fluxgate: isolated, DC-capable", n: "Slow (tens of kHz) and expensive; used for output and grid current." },
]},
{ cat: "Snubbers", title: "Damping the ringing", rows: [
  { e: "1. measure f_ring with the probe at the node", n: "2. add C_test until f drops by half → C_par = C_test/3. 3. L_par = 1/((2πf)²·C_par)." },
  { e: "R_snub = √(L_par/C_par)", n: "Critical damping. C_snub ≈ 3–4× C_par." },
  { e: "P_snub = C_snub·V²·f_sw", n: "Check this before you pick the package — RC snubbers reach significant dissipation quickly." },
  { e: "RCD clamp: V_clamp ≈ 1.3–1.5·V_R", n: "Flyback. Lower is lossier, higher risks exceeding V_DS. R = V_clamp²/P_clamp." },
  { e: "ferrite bead on the diode/gate", n: "Cheapest fix for high-frequency ringing when a full snubber is overkill." },
  { e: "TVS for load dump / surge, not for ringing", n: "Repetitive clamping will overheat a TVS. It is a survival device, not a snubber." },
]},
{ cat: "Snubbers", title: "Gate drive", rows: [
  { e: "R_g controls dv/dt and EMI", n: "Split turn-on/turn-off resistors: slow on to tame recovery, fast off to cut loss." },
  { e: "C_boot ≥ Q_total/ΔV_boot", n: "Use 10–100× the minimum. Refresh needs a minimum off-time every cycle." },
  { e: "Miller clamp or −2 to −5 V off bias", n: "Above a few V/ns, C_gd re-turns-on the low-side device. This is a frequent cause of otherwise unexplained shoot-through." },
  { e: "t_dead > t_off(max) + propagation skew", n: "Then subtract as much as you dare — dead time is pure body-diode loss." },
  { e: "keep the gate loop area tiny", n: "The driver's return must go straight to the Kelvin source pin, never through the power path." },
  { e: "isolated drives: CMTI ≥ 100 kV/µs for SiC/GaN", n: "Below that, common-mode transients corrupt the drive signal." },
]},
{ cat: "Layout", title: "Layout rules that actually matter", rows: [
  { e: "minimise the hot loop area first", n: "Buck: C_in → HS → LS → back to C_in. Boost: switch → diode → C_out. Everything else is secondary." },
  { e: "put the input cap on the same layer as the FETs", n: "A via in the hot loop adds ~1 nH; that is volts of overshoot at 10 A/ns." },
  { e: "unbroken ground plane directly beneath", n: "The image current cancels the loop inductance. Never route signals through it." },
  { e: "keep the switch node copper small", n: "It only needs enough area for current — extra copper is a dv/dt antenna." },
  { e: "single-point connection for analog ground", n: "Feedback divider and compensation return to the IC ground pin, not the power ground." },
  { e: "route feedback away from the switch node and inductor", n: "Or shield it with ground. Injected noise on FB looks like a load transient to the loop." },
]},
{ cat: "Layout", title: "EMI", rows: [
  { e: "DM noise ∝ input ripple current", n: "Fixed with X caps and a DM choke, or by interleaving." },
  { e: "CM noise ∝ dv/dt × parasitic C to earth", n: "Dominated by the switch node and the transformer's interwinding capacitance." },
  { e: "Y-cap limited by leakage current", n: "Typically ≤ 4.7 nF total for 250 V AC class II. Add a transformer shield instead of more Y." },
  { e: "CM choke: L_cm 1–10 mH", n: "Place the resonance with the Y caps below 150 kHz." },
  { e: "spread spectrum yields 6–10 dB", n: "It reshapes the measurement, not the energy. It should not be used to compensate for a poor layout." },
  { e: "CISPR 32 class B: 66→56 dBµV, 150–500 kHz", n: "Class A is 13 dB looser. Pick the class before choosing f_sw." },
]},
{ cat: "Numbers", title: "Constants and rules of thumb", rows: [
  { e: "µ₀ = 4π×10⁻⁷ H/m", n: "ρ_Cu = 1.72×10⁻⁸ Ω·m at 20 °C, +0.39 %/°C." },
  { e: "1 oz copper = 35 µm", n: "Roughly 0.5 mΩ per square. External trace: 1 mm width ≈ 3 A for a 20 °C rise." },
  { e: "current density J = 4–6 A/mm²", n: "Wire in a wound component with reasonable airflow." },
  { e: "derate V: 80 % of rating", n: "MOSFET V_DS, cap voltage, diode V_R. For MLCCs across a switch node, use 50 %." },
  { e: "1 nH per mm of trace", n: "A 10 mm loop at 10 A/ns produces 100 V of overshoot. This is the mechanism behind most switch-node overshoot." },
  { e: "efficiency → loss: 95 % efficient at 100 W out = 5.3 W dissipated", n: "P_loss = P_out·(1/η − 1). Always convert to watts before designing the thermals; percentages obscure the magnitude." },
]},
];

/* ========================== selector table ========================== */
/* Maps a comparison row to the bench page it describes, so the Selector
   can actually select something instead of being a static table. */
const SELECT_ID = {
  "Buck": "buck", "Sync buck": "syncbuck", "Multiphase buck": "multiphase",
  "Boost": "boost", "Buck-boost": "buckboost", "Four-switch BB": "fsbb",
  "Ćuk": "cuk", "SEPIC": "sepic", "Zeta": "zeta", "Charge pump": "chargepump",
  "Flyback": "flyback", "Two-switch forward": "forward2", "Push-pull": "pushpull",
  "Half-bridge": "halfbridge", "Phase-shifted FB": "psfb", "LLC resonant": "llc",
  "Dual active bridge": "dab", "Half-wave rectifier": "halfwave",
  "Full-bridge rectifier": "bridgerect", "Centre-tapped rectifier": "ctrect",
  "Synchronous rectifier": "syncrect", "Current doubler": "doubler",
  "Boost PFC": "pfcboost", "Totem-pole PFC": "totempole",
  "H-bridge inverter": "hbridge", "Three-phase VSI": "vsi3", "Three-level NPC": "npc3",
  "Class E": "classe", "Class E push-pull": "classepp", "Class DE": "classde",
};

const SELECT = [
  ["Buck", "D", "no", "1 W – 1 kW", "V_in", "Simplest. Continuous output current."],
  ["Sync buck", "D", "no", "1 W – 5 kW", "V_in", "Default above ~3 A or below ~5 V out."],
  ["Multiphase buck", "D", "no", "50 W – 10 kW", "V_in", "Ripple cancellation, current sharing."],
  ["Boost", "1/(1−D)", "no", "1 W – 5 kW", "V_out", "RHP zero. No output disconnect."],
  ["Buck-boost", "−D/(1−D)", "no", "1 – 100 W", "V_in+V_out", "Inverting. Both ports pulsate."],
  ["Four-switch BB", "D₁/(1−D₃)", "no", "10 W – 3 kW", "max(V_in,V_out)", "Best choice when V_in crosses V_out."],
  ["Ćuk", "−D/(1−D)", "no", "1 – 200 W", "V_in+V_out", "Continuous both ports; C1 works hard."],
  ["SEPIC", "D/(1−D)", "no", "1 – 150 W", "V_in+V_out", "Non-inverting, DC blocking, wide range."],
  ["Zeta", "D/(1−D)", "no", "1 – 100 W", "V_in+V_out", "Non-inverting with a quiet output."],
  ["Charge pump", "N+1 (fixed)", "no", "< 1 W", "V_in", "No magnetics; fixed ratio only."],
  ["Flyback", "D/(N(1−D))", "yes", "1 – 150 W", "V_in+V_R", "Cheapest isolation, multiple outputs."],
  ["Two-switch forward", "n·D", "yes", "100 – 500 W", "V_in", "Clamped switches, D < 0.5."],
  ["Push-pull", "2n·D", "yes", "50 – 500 W", "2·V_in", "Low V_in, ground-referenced drives."],
  ["Half-bridge", "n·D", "yes", "200 W – 1 kW", "V_in", "Off-line standard."],
  ["Phase-shifted FB", "2n·D_eff", "yes", "0.5 – 5 kW", "V_in", "ZVS, fixed frequency."],
  ["LLC resonant", "M(f_n,L_n,Q)", "yes", "100 W – 5 kW", "V_in", "ZVS+ZCS, variable frequency."],
  ["Dual active bridge", "phase-controlled", "yes", "1 – 100 kW", "V1 / V2", "Bidirectional, symmetric."],
  ["Half-wave rectifier", "≈ √2·V_ac", "no", "< 5 W", "2·V_pk", "One diode. Ripple at f_line, poor crest factor."],
  ["Full-bridge rectifier", "≈ √2·V_ac", "no", "1 W – 3 kW", "V_pk", "Mains front end. PF ≈ 0.6 without PFC."],
  ["Centre-tapped rectifier", "D·V_sec", "—", "10 W – 1 kW", "2·V_sec", "One diode drop; double secondary copper."],
  ["Synchronous rectifier", "D·V_sec", "—", "10 W – 5 kW", "2·V_sec", "I²R instead of V_F. Gate timing governs the result."],
  ["Current doubler", "D·V_sec", "—", "100 W – 3 kW", "V_sec", "Half the current per inductor, one winding."],
  ["Boost PFC", "1/(1−D)", "no", "75 W – 3 kW", "V_bus", "Mains front end, PF > 0.99."],
  ["Totem-pole PFC", "1/(1−D)", "no", "300 W – 10 kW", "V_bus", "Bridgeless; needs GaN/SiC."],
  ["H-bridge inverter", "m·V_dc (peak)", "no", "100 W – 10 kW", "V_dc", "Single-phase DC→AC."],
  ["Three-phase VSI", "V_LL = 0.707·m·V_dc", "no", "1 – 500 kW", "V_dc", "Motor drives, grid inverters. SVPWM."],
  ["Three-level NPC", "V_LL = 0.707·m·V_dc", "no", "10 kW – 10 MW", "V_dc/2", "Half the device stress, low THD."],
  ["Class E", "resonant ZVS", "no", "1 – 500 W", "3.562·V_dc", "One switch, MHz capable, load-sensitive."],
  ["Class E push-pull", "resonant ZVS", "no", "10 W – 2 kW", "3.562·V_dc", "Twice the power, even harmonics cancel."],
  ["Class DE", "resonant ZVS", "no", "50 W – 5 kW", "V_dc", "ZVS without the voltage penalty."],
];





/* One transport bar, shared by the static figure and the current-flow card,
   so the same controls look and behave the same on every topology. */
function PlayBar({ play, onPlay, spd, onSpd, phases, phase, onPhase, extra, pos, onPos }) {
  return (
    <>
      <div className="ctl" role="group" aria-label="Animation controls">
        <button className={play ? "on" : ""} onClick={onPlay} aria-pressed={play}
          aria-label={play ? "Pause animation" : "Play animation"}>
          <span aria-hidden="true">{play ? "❚❚" : "▶"}</span> {play ? "pause" : "play"}
        </button>
        {[0.5, 1, 2].map((v) => (
          <button key={v} className={spd === v && play ? "on" : ""} onClick={() => onSpd(v)}
            aria-pressed={spd === v && play} aria-label={"Speed " + v + " times"}>{v}×</button>
        ))}
        <span className="sp" />
        {phases.map((name, k) => (
          <button key={k} className={phase === k ? "on" : ""} onClick={() => onPhase(k)} aria-pressed={phase === k}>
            {name}
          </button>
        ))}
        {extra}
      </div>
      {/* Scrub. Stepping between named phases lands you in the middle of one;
          this walks the whole cycle so a transition can be inspected at the
          instant it happens. */}
      {onPos ? (
        <div className="scrub">
          <span>scrub</span>
          <input type="range" min="0" max="1" step="0.002" value={pos}
            aria-label="Scrub through the switching cycle"
            onChange={(e) => onPos(parseFloat(e.target.value))} />
        </div>
      ) : null}
    </>
  );
}

/* ============================== the app ============================== */
function mkRaw(id) {
  const t = TOPOS.find((x) => x.id === id) || TOPOS[0];
  const o = {};
  (t.fields || []).forEach((k) => {
    const dv = (t.defs && t.defs[k] !== undefined) ? t.defs[k] : FIELDS[k].d;
    o[k] = String(dv);
  });
  return o;
}

function Fields({ topo, raw, spec, set }) {
  return (
    <div className="fields">
      {(topo.fields || []).map((k) => {
        const F = FIELDS[k];
        if (!F) return null;
        const txt = raw[k];
        const num = parseFloat(txt);
        /* Flag anything the sanitiser had to rewrite, so the reader can see
           that the number in the box is not the number being used. Comparing
           against the value design() actually received catches the range
           clamp and the ORDERED clamp with one test, and cannot fall out of
           step with either the way a re-implemented range check did. */
        const used = spec ? spec[k] : undefined;
        const moved = Number.isFinite(num) && Number.isFinite(used)
          && Math.abs(num - used) > Math.max(Math.abs(used), 1) * 1e-9;
        const bad = txt !== "" && txt !== undefined && (!isFinite(num) || moved);
        const why = !isFinite(num) ? "Not a number — the design uses the default."
          : (F.mn !== undefined && (num < F.mn || num > F.mx))
            ? "Outside the usable range " + F.mn + " to " + F.mx + " — the design uses the nearest valid value."
            : "Out of order with the other limits — the design uses " + eng(used, F.u === "V" ? "V" : "") + ".";
        return (
          <div className="fld" key={k}>
            <label htmlFor={"f_" + k}>
              <Mx t={F.l} />{F.u ? <span className="u"> {F.u}</span> : null}
            </label>
            <input id={"f_" + k} type="number" inputMode="decimal" step={F.s || "any"}
              min={F.mn} max={F.mx} className={bad ? "bad" : ""}
              aria-invalid={bad || undefined}
              title={bad ? why : undefined}
              value={txt ?? ""} onChange={(e) => set(k, e.target.value)} />
          </div>
        );
      })}
    </div>
  );
}

function Results({ res, spec, hideWave }) {
  if (!res) return <p>This topology has no calculator yet — the equations and trade-offs below still apply.</p>;
  if (res.error) {
    return (
      <div className="warn">
        <b>The design equations failed for these inputs.</b> This is a bug rather than a bad
        entry: <span className="mono">{res.error}</span>. Try stepping the numbers back toward the
        defaults, and the rest of the page is unaffected.
      </div>
    );
  }
  /* A result made entirely of em-dashes, or one carrying negative component
     values, means the operating point is outside what the topology can do.
     Either used to render as a confident-looking table. */
  const hi = res.hi || [];
  const allBlank = hi.length > 0 && hi.every(([, v]) => String(v).trim() === "—");
  const negative = hi.some(([, v]) => /^−/.test(String(v).trim()));
  return (
    <div>
      {res.infeasible ? (
        <div className="warn">
          <b>This operating point is outside the topology.</b> There is nothing to size, because
          no set of components produces this conversion ratio. The reason is below.
        </div>
      ) : null}
      {allBlank || negative ? (
        <div className="warn">
          <b>No usable numbers at this operating point.</b> The inputs are self-consistent enough
          to run, but the result is not physical — usually a conversion ratio this topology cannot
          reach. Check the warnings below and the voltages you entered.
        </div>
      ) : null}
      <div className="grid3" style={{ marginBottom: 14 }}>
        {hi.map(([k, v], i) => (
          <div className="stat" key={i}>
            <span className="eyebrow"><Mx t={k} /></span>
            <div className={"big " + ["cu", "cy", "gn"][i % 3]}>{v}</div>
          </div>
        ))}
      </div>
      {/* Said once, for every topology, from the same test the drawing uses.
          A converter that has fallen into discontinuous conduction is not
          described by any of the ratios above it, and thirty design functions
          each remembering to mention that is thirty chances to forget. */}
      {isDCM(res.wave) ? (
        <div className="warn"><b>check ·</b> <Mx t={"At this load the current falls to zero before the "
          + "period ends — discontinuous conduction. The conversion ratio, the ripple and the C_out "
          + "sizing above all assume it never does, so treat them as upper bounds here: the real "
          + "output voltage rises above them as the load falls further."} /></div>
      ) : null}
      {(res.warn || []).map((w, i) => (
        <div className="warn" key={i}><b>check ·</b> <Mx t={w} /></div>
      ))}
      <LossBar items={res.loss} />
      {res.wave && !hideWave ? <div style={{ margin: "14px 0" }}>
        <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
          Idealised waveforms · one cycle, drawn three times
        </span>
        {/* The same real-time axis the animated figure draws. Without the
            period this pane fell back to "0 / 1T / 2T / 3T" while an
            identical plot on an animated page showed microseconds — two
            different x-axes for the same figure, decided by which route
            happened to render it. */}
        <Wave {...res.wave} period={swPeriod(spec)} />
      </div> : null}
      {res.chart ? <div style={{ margin: "14px 0" }}>
        <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
          {res.chart.title || "Characteristic"}
        </span>
        <LineChart {...res.chart} />
      </div> : null}
      <div className="grid2">
        {res.groups.map((g, i) => (
          <div key={i}>
            <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>{g.t}</span>
            <table><tbody>
              {g.rows.map((r, j) => (
                <tr key={j}>
                  {/* The note belongs under the LABEL, left-aligned. Hanging it
                      right-aligned under the value left every row ragged and
                      made the numbers impossible to scan down. */}
                  <td className="k">
                    <Mx t={r[0]} />
                    {r[2] ? <div className="n"><Mx t={r[2]} /></div> : null}
                  </td>
                  <td className="v"><Mx t={r[1]} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================ the glossary ============================

   Every page here uses words that are ordinary to a power engineer and opaque
   to everyone else — ZVS, CCM, flux walking, dead time. Spelling each one out
   wherever it appears would bury the prose; leaving them undefined assumes
   the reader already knows, which is exactly the assumption this tool should
   not make.

   So: a term list, and a footer under each topology that shows the definitions
   of the terms THAT PAGE actually uses. The list is scanned out of the page's
   own prose, so nothing has to be maintained per topology and prose written
   later gets its definitions for free. Order follows the list below rather
   than the text, so the reader meets the general idea before the special
   case (continuous conduction before discontinuous, ZVS before ZCS).

   `re` is matched case-insensitively against the page's prose. Keep the
   patterns tight — a term that matches too eagerly puts a definition on a
   page that never discussed it, which is worse than leaving it out. */
const TERMS = [
  /* The foundations first. These carry most of their weight on the pages a
     newcomer is likeliest to open cold — a four-switch buck-boost page
     matched nothing at all until they were added. */
  ["inductor", /\binductor|\bchoke\b|\bL_?[a-z0-9]?\b/, "a coil that resists any change in the current through it. Interrupt it and it will hold that current going by whatever voltage it takes — which is what every switching converter here is exploiting."],
  ["capacitor", /\bcapacitor|\bC_(out|in|bulk|dc)\b/, "stores charge and resists changes in voltage. It is what holds the output steady between the moments the converter actually delivers energy."],
  ["conversion ratio", /conversion ratio|\bM = |step[- ]down|step[- ]up/, "the output voltage divided by the input, written M. What a topology can and cannot reach is the first thing that decides whether it suits a job."],
  ["rectifier", /\brectif|\bdiode\b/, "a component that passes current one way only. It is what stops the output feeding back into the converter when the switch opens."],
  ["freewheel", /freewheel/, "the interval after the switch opens, where the inductor's current keeps circulating through a diode or a second switch instead of stopping."],
  ["turns ratio", /turns ratio|\bN_p|\bn : 1|\btransformer\b/, "how many times more wire is wound on one side of a transformer than the other. It sets both the voltage the secondary makes and the current the primary has to carry."],
  ["bidirectional", /bidirectional|reverse power|\bV2G\b/, "able to pass power both ways with no change of wiring — needed wherever a battery must both charge and discharge."],
  ["gate drive", /gate driv|gate charge|\bQ_g\b|drives?\b.*switch|four drives/, "the circuit that charges and discharges a switch's control terminal. It costs energy every cycle, which is one of the things that limits how fast a converter can switch."],
  ["duty cycle", /\bduty\b|\bD_\d\b/, "the fraction of each switching period the main switch spends on. Nearly every conversion ratio here is written in terms of it, as D."],
  ["switching period", /\bswitching period\b|\bf_sw\b/, "one complete open-and-close of the switch, T = 1/f_sw. Everything in these figures repeats once per period."],
  ["continuous conduction (CCM)", /\bCCM\b|\bcontinuous conduction\b/, "the inductor current never reaches zero. The textbook conversion ratios all assume this."],
  ["discontinuous conduction (DCM)", /\bDCM\b|\bdiscontinuous\b/, "at light load the current hits zero and rests there for part of the period. The CCM ratios stop holding, and the output voltage rises above what they predict."],
  ["ripple", /\bripple\b/, "the small back-and-forth on top of a steady value — how far the inductor current swings each cycle, or how far the output voltage moves."],
  ["ESR", /\bESR\b/, "equivalent series resistance: the small resistance in series inside a real capacitor. Output ripple is partly charge and partly this, and buying more capacitance only helps the first part."],
  ["volt-second balance", /volt-second/, "over one period an inductor must gain exactly as much flux as it loses, or its current would climb without limit. It is what pins the conversion ratio to the duty."],
  ["magnetising current", /\bmagnetis/, "the current that magnetises a transformer's core rather than crossing to the secondary. It does no useful work but has to be dealt with."],
  ["flux walking", /flux walk|walks the core|walking the core|walk the core/, "a transformer driven slightly harder one way than the other accumulates flux cycle after cycle, until the core saturates. Bridges and push-pulls have to guard against it."],
  ["dead time", /\bdead time\b|t_dead/, "a deliberate gap where both switches in a leg are off, so they can never be on together and short the supply."],
  ["ZVS", /\bZVS\b|zero[- ]voltage/, "zero-voltage switching: the voltage across a switch is brought to zero before it turns on, so the turn-on costs almost nothing."],
  ["ZCS", /\bZCS\b|zero[- ]current/, "zero-current switching: the current has already fallen to zero when the device turns off, so there is nothing to interrupt."],
  ["synchronous rectifier", /\bsynchronous rect|\bsync(hronous)? (buck|rectif)/, "a MOSFET used in place of a diode. It drops I·R instead of a fixed voltage, which wins at low output voltages."],
  ["reverse recovery", /reverse[- ]recover|Q_rr/, "a silicon diode stores charge while conducting and must sweep it out before it can block. That charge is dragged through the switch turning on, and it is dissipated there."],
  ["body diode", /body diode/, "the diode built into every MOSFET by its construction. It conducts during dead time whether you want it to or not."],
  ["RHP zero", /RHP|right[- ]half[- ]plane/, "a right-half-plane zero: the output initially moves the WRONG way when the duty changes. It cannot be compensated away, only crossed over below."],
  ["resonant tank", /\btank\b|\bresonan/, "an inductor and capacitor tuned together. Current in a tank swells and falls as a sinusoid instead of ramping, which is what makes resonant converters quiet."],
  ["power factor (PFC)", /\bPFC\b|power factor/, "how closely the current drawn from the mains follows the voltage in shape and phase. Regulations require it above about 75 W."],
  ["interleaving", /interleav/, "running several identical stages staggered in time, so their ripple currents partly cancel before reaching the capacitor."],
  ["hard switching", /hard[- ]switch/, "turning a device on or off while it is carrying current and standing off voltage at the same time. The overlap is dissipated in the device."],
];

/* The terms a given page actually uses, in list order. */
const termsFor = (text) => TERMS.filter(([, re]) => re.test(text));

/* Which family a converter belongs to, and what it does differently.

   This is what the generic family figure was genuinely good for. That figure
   drew one idealised "bridge" or "buck-boost cell" for a whole group and
   carried a note admitting it was not the circuit above it — useful for
   placing a converter, useless for reading it, and every topology now traces
   its own path instead. The placing survives here as one sentence, which is
   how much of it was ever worth a figure: what this shares with its
   relatives, and the one thing it does differently. */
const FAMILY = {
  buck: "the buck family — a switch chops the input and an LC filter takes the average. Everything below it in this list is a rearrangement of that idea.",
  syncbuck: "the buck family. The catch diode has become a second switch, so the loss is I²R instead of a fixed 0.4 V drop.",
  multiphase: "the buck family, several times over. Identical stages run staggered so their ripple partly cancels before it reaches the capacitor.",
  boost: "the boost family — the inductor is charged from the input, then dumped into a higher output through a rectifier.",
  pfcboost: "the boost family, with the input following a rectified sine instead of a DC rail, so the duty is modulated continuously across the line cycle.",
  totempole: "the boost family, with the diode bridge deleted — one leg switches fast, the other swaps polarity at line frequency.",
  buckboost: "the buck-boost family — the inductor is charged from the input and discharged into the output, with no direct path between them.",
  fsbb: "the buck-boost family, split into a buck leg and a boost leg so only one of them has to switch at a time.",
  cuk: "the buck-boost family, but the energy crosses through a capacitor rather than the inductor's field, which is what makes both ports continuous.",
  sepic: "the buck-boost family, with the inductor split in two and coupled through a series capacitor so the output comes out positive.",
  zeta: "the buck-boost family, rearranged so that the continuous current is the one facing the load.",
  chargepump: "the switched-capacitor family — no magnetics at all, so the ratio is fixed by topology rather than by duty.",
  flyback: "the flyback family — the transformer is really a coupled inductor, storing energy in the on-time and releasing it in the off-time.",
  forward2: "the forward family — the transformer passes power across while the switch is on and stores nothing on purpose, so a separate choke does the storing.",
  pushpull: "the bridge family — the primary is driven alternately in both directions, so the core is used both ways and can be smaller.",
  halfbridge: "the bridge family, with one leg replaced by a capacitor divider, so the winding swings ±V_in/2 and each device blocks only V_in.",
  psfb: "the bridge family, with the two legs phase-shifted rather than switched together — which buys zero-voltage turn-on from the parasitics.",
  llc: "the bridge family, feeding a resonant tank instead of the transformer directly. The tank shapes the current into a sinusoid, so nothing switches hard.",
  dab: "the bridge family, twice — a second identical bridge faces the first, and the phase between them sets both the amount and the direction of power flow.",
  halfwave: "the rectifier family — the simplest member, conducting on alternate half-cycles and wasting the other half.",
  bridgerect: "the rectifier family — four diodes so that both half-cycles reach the load the same way up.",
  ctrect: "the rectifier family, with a centre-tapped winding so only one diode drop sits in the output path instead of two.",
  syncrect: "the rectifier family, with the diodes replaced by MOSFETs — trading a fixed voltage drop for I²R.",
  doubler: "the rectifier family, with the load current split between two chokes that take turns, so each winding carries half.",
  hbridge: "the inverter family — a bridge switched at high frequency and modulated slowly, so its average output traces a sine.",
  vsi3: "the inverter family, three legs of it, driven 120° apart to make a rotating field.",
  npc3: "the inverter family, with each switch split in two and clamped to a midpoint, giving a third output level.",
  classe: "the switched-mode amplifier family — a single switch and a tuned network shaped so the device turns on at zero volts and zero slope.",
  classepp: "the switched-mode amplifier family, two class-E stages in antiphase so their even harmonics cancel in the load.",
  classde: "the switched-mode amplifier family, combining class-D's low device stress with class-E's soft transition.",
  ilpfc: "the boost family, built twice and run half a period out of step so the two ripple currents partly cancel each other.",
  qrflyback: "the flyback family, with the turn-on instant chosen to land at the bottom of the ring the circuit was making anyway.",
};

/* ===================== current-flow animation data =====================
   Each phase traces the conducting loop over the schematic, drawn in the
   direction the current actually flows. `f(D)` is the slice of the cycle
   the phase occupies, used to shade the matching part of the waveform.  */
const FLOW = {
  classepp: { w: 660, h: 300, iShape: (u) => Math.abs(1 + CE_IM * Math.sin(2 * Math.PI * u + CE_PH)) / 2.862,
    ilabel: "i_out",
    sw: [[250, 105, "Q1", 0], [250, 195, "Q2", 180]],
    emc: { loop: "M 250 60 H 310 V 240 H 250 Z", node: [250, 60] },
    ph: [
    { on: [1,0], t: "Q1 conducting", f: () => [0, 0.5], n: "The upper stage pulls its drain to zero while the lower drain rings up. The two halves are identical circuits running exactly half a cycle apart.",
      d: ["M 40 150 H 70 V 60 H 250 V 150 H 282"], dim: ["M 310 240 V 150"] },
    { on: [0,1], t: "Q2 conducting", f: () => [0.5, 1], n: "Roles swap. Because the two drain waveforms are antiphase, their even harmonics cancel in the differential load — that cancellation is the principal reason for the configuration.",
      d: ["M 40 150 H 70 V 240 H 250 V 150 H 282"], dim: ["M 310 60 V 150"] },
  ]},
  classde: { w: 620, h: 270, iShape: (u) => Math.abs(Math.sin(2 * Math.PI * u)),
    ilabel: "i_tank",
    sw: [[200, 92, "Q1", 0], [200, 182, "Q2", 0]],
    emc: { loop: "M 200 50 H 265 V 225 H 200 Z", node: [200, 137] },
    ph: [
    { on: [1,0], t: "Q1 on", f: () => [0, 0.46], n: "The high-side device connects the tank to the supply. Because the turn-on happened at zero volts during the preceding dead time, the transition cost nothing.",
      d: ["M 40 50 H 200 V 137 H 520 V 225 H 200"] },
    { on: [0,0], t: "Dead time — ZVS", f: () => [0.46, 0.54], n: "Both devices are off. Tank current alone charges one shunt capacitance and discharges the other, walking the switch node across to the opposite rail before the next device turns on.",
      d: ["M 265 50 V 225"], dim: ["M 200 137 H 520 V 225 H 200"] },
    { on: [0,1], t: "Q2 on", f: () => [0.54, 1], n: "The low-side device takes over and tank current reverses. Each device only ever blocks the supply rail — the principal advantage over single-ended class E, where the device blocks 3.56 times the supply.",
      d: ["M 200 225 V 137 H 520 V 225"] },
  ]},
  buck: { w: 660, h: 250, sw: [[170, 70, "Q1", -90], [215, 135, "D1"]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [241, 88, 301, 88],              /* L, between the switch node and the output */
    /* Both capacitors, drawn top-plate downwards — the direction current
       flows INTO them. C_in is the interesting one on a buck: the source
       supplies a steady average while the switch demands the whole inductor
       current for D of the period and none of it for the rest, and C_in makes
       up the entire difference. Watching it slam back and forth is the
       shortest route to why input capacitors are chosen by ripple current. */
    capFlow: [{ d: "M 380 70 V 200", src: "out" }, { d: "M 88 70 V 200", src: "in" }],
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The switch connects the input to the inductor. With V_in − V_out across it the current ramps up, and the difference between that current and the load current charges C_out.",
      d: ["M 40 70 H 480 V 200 H 40"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "The inductor cannot sustain a discontinuity in its current, so it pulls the switch node below ground until D1 conducts. Current now circulates through the diode and decays at a rate set by V_out/L.",
      d: ["M 215 200 V 70 H 480 V 200 H 215"] },
  ]},
  boost: { w: 660, h: 250, sw: [[230, 145, "Q1", 0], [288, 70, "D1"]],
    emc: { loop: "M 230 70 H 390 V 200 H 230 Z", node: [230, 70] },
    pol: [116, 88, 176, 88],              /* L, fed from the input */
    capFlow: [{ d: "M 390 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The switch shorts the inductor to ground. Current ramps up storing energy, and the output is supplied entirely by C_out — which is why boost output ripple is so much worse than buck.",
      d: ["M 40 70 H 230 V 200 H 40"], dim: ["M 390 70 H 480 V 200 H 390"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "The inductor flies above the input, forward-biasing D1 and transferring its current to the output. This is also why load steps momentarily go the wrong way — the right-half-plane zero.",
      d: ["M 40 70 H 480 V 200 H 40"] },
  ]},
  buckboost: { w: 660, h: 250, sw: [[170, 70, "Q1", -90], [290, 70, "D1"]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [197, 98, 197, 158],              /* L, from the switch node down to the return */
    capFlow: [{ d: "M 400 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The full input voltage sits across the inductor and current ramps up. Nothing reaches the output during this interval — the load lives on C_out.",
      d: ["M 40 70 H 215 V 200 H 40"], dim: ["M 400 70 H 480 V 200 H 400"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "The inductor reverses its terminal voltage to keep current flowing, pulling the output node below ground through D1. That polarity inversion is inherent, not a wiring choice.",
      d: ["M 215 70 V 200 H 480 V 70 H 215"] },
  ]},
  flyback: { w: 700, h: 275, sw: [[250, 185, "Q1", 0], [327, 60, "D1"]],
    emc: { loop: "M 90 55 H 250 V 235 H 90 Z", node: [250, 144] },
    capFlow: [{ d: "M 450 60 V 215", src: "out" }],
    ph: [
    { on: [1,0], t: "Q1 on — store", f: (D) => [0, D], n: "Primary current ramps and energy accumulates in the gap. The secondary diode is reverse-biased, so no power crosses the barrier yet; the output is held up by C_out alone.",
      d: ["M 40 55 H 250 V 235 H 40"], dim: ["M 450 60 H 600 V 215 H 450"] },
    { on: [0,1], t: "Q1 off — release", f: (D) => [D, 1], n: "The winding voltages reverse, D1 conducts and the stored energy transfers to the output. The primary now sees V_in plus the reflected V_R — the quantity that sets the primary device rating.",
      d: ["M 274 80 V 60 H 600 V 215 H 274 V 144"] },
  ]},
  pfcboost: { w: 780, h: 280, sw: [[360, 155, "Q1", 0], [425, 105, "D"]],
    /* One switching period taken at the crest of the line cycle, where the
       inductor current and its ripple are both largest. */
    iShape: (u, D) => 0.62 + 0.38 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    ilabel: "i_L",
    emc: { loop: "M 360 105 H 560 V 195 H 360 Z", node: [360, 105] },
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The boost switch shorts the inductor across the rectified line. Current rises, following the reference the current loop derives from |v_ac| — this interval is where the sinusoidal input current is shaped.",
      d: ["M 130 105 H 360 V 195 H 130"], dim: ["M 560 105 H 660 V 195 H 560"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "Inductor current transfers to D_b and charges the bulk capacitor. The duty varies continuously across the line cycle: near the zero crossing it approaches 1, near the peak it is smallest.",
      d: ["M 130 105 H 660 V 195 H 130"] },
  ]},
  halfwave: { w: 620, h: 230, iShape: (u) => (u < 0.16 ? 0.08 + Math.sin(Math.PI * u / 0.16) : 0.1),
    ilabel: "i_D",
    sw: [[170, 60, "D1"]],
    emc: { loop: "M 130 60 H 300 V 190 H 130 Z", node: [210, 60] },
    ph: [
    { on: [1], t: "Peak of the positive half", f: () => [0, 0.16], n: "The diode only conducts while the source exceeds the capacitor voltage — a narrow window near the peak. All the charge the load will draw for the entire cycle is delivered in this brief spike.",
      d: ["M 80 104 V 60 H 420 V 190 H 80 V 136"] },
    { on: [0], t: "The rest of the cycle", f: () => [0.16, 1], n: "The diode is reverse-biased and the capacitor alone supplies the load, sagging linearly. Ripple here is at the line frequency, not twice it, so the capacitor must be twice as large as a bridge would need.",
      d: ["M 300 60 H 420 V 190 H 300"] },
  ]},
  bridgerect: { w: 620, h: 250, iShape: (u) => 0.06 + Math.pow(Math.abs(Math.sin(2 * Math.PI * u)), 5),
    ilabel: "i_D",
    sw: [[210, 78, "D1"], [210, 153, "D2"], [310, 108, "D3"], [310, 183, "D4"]],
    emc: { loop: "M 210 55 H 400 V 205 H 210 Z", node: [310, 55] },
    ph: [
    { on: [1,0,0,1], t: "Positive half-cycle", f: () => [0, 0.5], n: "D1 and D4 conduct as a diagonal pair: current leaves the source, climbs to the positive rail, passes through the load, and returns through the opposite leg.",
      d: ["M 100 114 V 100 H 210 V 55 H 490 V 205 H 310 V 160 H 100 V 146"] },
    { on: [0,1,1,0], t: "Negative half-cycle", f: () => [0.5, 1], n: "The source reverses and the other diagonal takes over. Note what does not change: current through the load still flows top to bottom. That is precisely what the bridge arrangement achieves.",
      d: ["M 100 146 V 160 H 310 V 55 H 490 V 205 H 210 V 100 H 100 V 114"] },
  ]},
  ctrect: { w: 680, h: 270, sw: [[300, 60, "D1"], [300, 140, "D2"]],
    emc: { loop: "M 214 60 H 340 V 140 H 214 Z", node: [340, 100] },
    /* Above the choke, not below it: the V_rect node label sits directly under
       the left-hand terminal. Set here the two marks flank the L_f label —
       and clear of the feed wire at x 340 and the coil crest at y 91, which
       the dashes now climb; an opaque disc any closer notches them. */
    pol: [352, 76, 406, 76],                /* L_f, the output choke */
    capFlow: [{ d: "M 470 100 V 220", src: "out" }],
    ph: [
    { on: [1,0], t: "Upper half conducts", f: (D) => [0, D], n: "The top half-winding drives D1 while the lower diode blocks. Current returns through the centre tap, so only one forward drop sits in the output path.",
      d: ["M 214 60 H 340 V 100 H 560 V 220 H 240 V 100 H 214"] },
    /* The freewheel intervals. These used to be left uncovered, and the phase
       lookup filled the gap by holding whichever phase had started last — so
       one diode stayed lit through an interval in which both conduct. It was
       invisible while the choke was drawn as a single ramp; with the current
       falling twice per period it sits right next to the trace that shows it.
       Both windings are undriven here and the choke's current splits between
       the two rectifiers, which is exactly why each one averages I_out/2
       regardless of duty. */
    { on: [1,1], t: "Freewheel", f: (D) => [D, 0.5], n: "The secondary is undriven and the choke sustains its own current, which splits between both rectifiers. This is the interval that makes each diode average I_out/2 whatever the duty, and it is when the output ripple falls.",
      d: ["M 340 100 H 560 V 220 H 240 V 100 H 340"], dim: ["M 214 60 H 340", "M 214 140 H 340"] },
    { on: [0,1], t: "Lower half conducts", f: (D) => [0.5, 0.5 + D], n: "The transformer reverses and the bottom half-winding takes over through D2. Each half-winding works only half the time — which is why this secondary needs roughly twice the copper of a bridge.",
      d: ["M 214 140 H 340 V 100 H 560 V 220 H 240 V 100 H 214"] },
    { on: [1,1], t: "Freewheel", f: (D) => [0.5 + D, 1], n: "The second freewheel interval, identical to the first. Two power pulses and two freewheels per switching period is why the output ripple sits at 2·f_sw and the filter is smaller than the switch timing alone suggests.",
      d: ["M 340 100 H 560 V 220 H 240 V 100 H 340"], dim: ["M 214 60 H 340", "M 214 140 H 340"] },
  ]},
  doubler: { w: 700, h: 300, sw: [[250, 170, "D1"], [290, 230, "D2"]],
    emc: { loop: "M 214 80 H 250 V 260 H 290 V 200 H 214 Z", node: [250, 80] },
    pol: [316, 98, 376, 98],              /* L1, the winding the pane plots */
    capFlow: [{ d: "M 530 140 V 260", src: "out" }],
    ph: [
    { on: [0,1], t: "Winding positive", f: (D) => [0, D], n: "D2 clamps the lower terminal to the return, so L1 sees the winding voltage and charges while L2 freewheels. Both inductors feed the output continuously.",
      d: ["M 214 80 H 470 V 140 H 595 V 260 H 290 V 200 H 214 V 160", "M 290 200 H 470 V 140"] },
    { on: [1,0], t: "Winding negative", f: (D) => [0.5, 0.5 + D], n: "The roles swap: D1 clamps and L2 charges. Each inductor carries only half the load current, and their ripples partly cancel at the output node.",
      d: ["M 214 160 V 200 H 470 V 140 H 595 V 260 H 250 V 80 H 214", "M 250 80 H 470 V 140"] },
  ]},
  classe: { w: 660, h: 250, iShape: (u) => Math.abs(1 + CE_IM * Math.sin(2 * Math.PI * u + CE_PH)) / 2.862,
    ilabel: "i_sw",
    sw: [[230, 130, "Q1", 0]],
    emc: { loop: "M 230 60 H 310 V 205 H 230 Z", node: [230, 60] },
    ph: [
    { on: [1], t: "Switch on", f: () => [0, 0.5], n: "The drain is held at zero volts. The choke current ramps up and the tank current flows through the switch — but the device turned on at zero voltage, so nothing was dissipated in the transition.",
      d: ["M 40 60 H 230 V 205 H 430"], dim: ["M 230 60 H 590 V 205 H 430"] },
    { on: [0], t: "Switch off", f: () => [0.5, 1], n: "Choke and tank current now flow into C_sh, and the drain rings up to 3.56 times the supply and back. The tuning makes it arrive at exactly zero, with zero slope, as the switch closes again.",
      d: ["M 40 60 H 310 V 205 H 430"], dim: ["M 310 60 H 590 V 205 H 430"] },
  ]},

  /* ---- extended coverage --------------------------------------------
     The lens used to exist on only twelve of the thirty pages, which made
     it look broken rather than absent. These add the families where the
     current path is the whole lesson: a synchronous buck (where the point
     is that a FET replaces the diode), the coupled-cap converters, and
     the bridge-fed isolated stages.                                    */
  /* ---- traced from each topology's own schematic, so the operation figure
     is the circuit shown above it rather than a generic family stand-in --- */
  syncrect: { w: 680, h: 280, sw: [[330, 60, "SR1", -90], [330, 140, "SR2", -90]],
    /* Two conduction intervals per period, one per rectifier, with the
       choke ramp on top — the shape a synchronous rectifier actually sees. */
    iShape: (u) => { const t = u < 0.5 ? u : u - 0.5; return t < 0.34 ? 0.66 + t : 0.55; },
    ilabel: "i_SR",
    emc: { loop: "M 214 60 H 350 V 140 H 214 Z", node: [350, 100] },
    ph: [
    { on: [1,0], t: "SR1 conducting", f: () => [0, 0.5], n: "The upper half of the winding drives the load through SR1's channel. A FET conducting in the third quadrant drops I·R_DS(on) instead of a fixed V_F, which below about 12 V out is worth more than anything on the primary side.",
      d: ["M 214 100 H 575 V 230 H 350 V 60 H 214"] },
    { on: [0,1], t: "SR2 conducting", f: () => [0.5, 1], n: "The winding reverses and SR2 takes over. Both devices must be off before the other turns on: overlap shorts the winding, and gate timing that is late instead lets the body diode conduct and throws the advantage away.",
      d: ["M 214 100 H 575 V 230 H 350 V 140 H 214"] },
  ]},
  totempole: { w: 720, h: 280,
    iShape: (u, D) => 0.62 + 0.38 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    ilabel: "i_L",
    sw: [[300, 100, "Q1", 0], [300, 190, "Q2", 0], [420, 100, "Q3", 0], [420, 190, "Q4", 0]],
    emc: { loop: "M 300 50 H 640 V 240 H 300 Z", node: [300, 145] },
    ph: [
    { on: [0,1,0,1], t: "Q2 on — charge", f: (D) => [0, D], n: "The fast leg's low-side device shorts the boost inductor across the line and its current ramps. The slow leg is doing nothing but pointing the mains at the right rail — it changes state once per line half-cycle, not once per switching period.",
      d: ["M 45 110 H 300 V 240 H 420 V 145 H 380 V 205 H 45"] },
    { on: [1,0,0,1], t: "Q1 on — transfer", f: (D) => [D, 1], n: "The inductor current commutates into the high-side device and charges the bulk capacitor. There are no bridge diodes anywhere in this path, which is the whole point — and why the device needs to have essentially no reverse recovery.",
      d: ["M 45 110 H 300 V 50 H 640 V 240 H 420 V 145 H 380 V 205 H 45"] },
  ]},
  zeta: { w: 700, h: 250, sw: [[170, 70, "Q1", -90], [340, 135, "D1"]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [366, 88, 426, 88],              /* L2, the output winding the pane plots */
    capFlow: [{ d: "M 490 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Switch on", f: (D) => [0, D], n: "The high-side switch connects the input to both the coupling capacitor and L1. C1 delivers its charge onward to L2 and the load, and L1 magnetises from the input.",
      d: ["M 40 70 H 600 V 200 H 40", "M 215 70 V 200"] },
    { on: [0,1], t: "Switch off", f: (D) => [D, 1], n: "D1 picks up both inductor currents. L2 faces the load directly, so output current stays continuous and the output ripple is small — the property that separates a Zeta from a SEPIC.",
      d: ["M 340 200 V 70 H 600 V 200 H 340", "M 215 200 V 70 H 325"] },
  ]},
  fsbb: { w: 700, h: 250,
    sw: [[170, 70, "Q1", -90], [215, 145, "Q2", 0], [330, 145, "Q3", 0], [400, 70, "Q4", -90]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [241, 88, 301, 88],              /* L, between the two half bridges */
    capFlow: [{ d: "M 500 70 V 200", src: "out" }],
    ph: [
    { on: [1,0,0,1], t: "Q1 on (buck mode)", f: (D) => [0, D], n: "In buck mode the boost leg is static: Q4 stays on, Q3 stays off, and the converter is an ordinary buck. The input feeds the inductor through Q1 and the current ramps up.",
      d: ["M 40 70 H 600 V 200 H 40"], dim: ["M 330 70 V 200"] },
    { on: [0,1,0,1], t: "Q2 on (buck mode)", f: (D) => [D, 1], n: "Q2 takes over as the synchronous freewheel path. Because both devices only ever block the larger of the two rails — never their sum — this topology stays efficient right through V_in ≈ V_out, where an inverting buck-boost is at its worst.",
      d: ["M 215 200 V 70 H 600 V 200 H 215"], dim: ["M 330 70 V 200"] },
  ]},
  multiphase: { w: 700, h: 270,
    sw: [[170, 75, "Q1H", 0], [170, 165, "Q1L", 0], [270, 90, "Q2H", 0], [270, 180, "Q2L", 0],
         [370, 105, "Q3H", 0], [370, 195, "Q3L", 0]],
    emc: { loop: "M 70 55 H 170 V 235 H 70 Z", node: [170, 120] },
    capFlow: [{ d: "M 560 150 V 235", src: "out" }],
    ph: [
    { on: [1,0,0,1,0,1], t: "Phase 1 driving", f: () => [0, 1/3], n: "Only one leg is drawing from the input at a time. The other two freewheel through their low-side devices, so the input capacitor sees a much smaller and much higher-frequency ripple than a single buck of the same total current would demand.",
      d: ["M 30 55 H 170 V 120 H 520 V 150 H 640 V 235 H 30"],
      dim: ["M 270 235 V 135 H 520", "M 370 235 V 150 H 520"] },
    { on: [0,1,1,0,0,1], t: "Phase 2 driving", f: () => [1/3, 2/3], n: "The clock hands over 360°/N later. Each inductor carries only I_out/N, and their ripples land out of phase, so what reaches the output capacitor is a fraction of any one phase's ripple.",
      d: ["M 30 55 H 270 V 135 H 520 V 150 H 640 V 235 H 30"],
      dim: ["M 170 235 V 120 H 520", "M 370 235 V 150 H 520"] },
    { on: [0,1,0,1,1,0], t: "Phase 3 driving", f: () => [2/3, 1], n: "The third leg takes its turn. The output sees ripple at N·f_sw, which is why the same transient response needs less capacitance than a single-phase design.",
      d: ["M 30 55 H 370 V 150 H 640 V 235 H 30"],
      dim: ["M 170 235 V 120 H 520", "M 270 235 V 135 H 520"] },
  ]},

  syncbuck: { w: 660, h: 250, sw: [[170, 70, "Q_HS", -90], [215, 145, "Q_LS", 0]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [241, 88, 301, 88],              /* L, between the switch node and the output */
    capFlow: [{ d: "M 380 70 V 200", src: "out" }, { d: "M 88 70 V 200", src: "in" }],
    ph: [
    { on: [1,0], t: "High side on", f: (D) => [0, D], n: "Identical to a plain buck: the input feeds the inductor and its current ramps up. The low-side FET is held off, and the dead time before this instant was covered by its body diode.",
      d: ["M 40 70 H 480 V 200 H 40"] },
    { on: [0,1], t: "Low side on", f: (D) => [D, 1], n: "This is the whole point of the topology. Instead of a diode dropping a fixed 0.4 V, a FET channel carries the same current at I·R_DS(on) — which at low output voltages is the single largest efficiency lever available.",
      d: ["M 215 200 V 70 H 480 V 200 H 215"] },
  ]},
  sepic: { w: 700, h: 250, sw: [[160, 145, "Q1", 0], [343, 70, "D1"]],
    emc: { loop: "M 70 70 H 160 V 200 H 70 Z", node: [160, 70] },
    pol: [76, 88, 136, 88],              /* L1, the input winding the pane plots */
    capFlow: [{ d: "M 460 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Switch on", f: (D) => [0, D], n: "Both inductors charge: L1 straight from the input, L2 from the coupling capacitor, which is why C_s carries the full load current in rms terms. The diode is reverse biased and the output runs on C_out alone.",
      d: ["M 40 70 H 160 V 200 H 40", "M 160 70 H 280 V 200 H 160"], dim: ["M 385 70 H 600 V 200 H 385"] },
    { on: [0,1], t: "Switch off", f: (D) => [D, 1], n: "Both inductor currents commutate into the diode and feed the output together. Because C_s blocks DC, a short on the output cannot drag the input down — the advantage a boost does not have.",
      d: ["M 40 70 H 600 V 200 H 40", "M 280 200 V 70"] },
  ]},
  cuk: { w: 700, h: 250, sw: [[160, 145, "Q1", 0], [280, 135, "D1"]],
    emc: { loop: "M 70 70 H 160 V 200 H 70 Z", node: [160, 70] },
    pol: [76, 88, 136, 88],              /* L1, the input winding the pane plots */
    capFlow: [{ d: "M 430 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Switch on", f: (D) => [0, D], n: "The transfer capacitor discharges through the switch into the output side. Energy crosses this converter through C1's electric field rather than through a magnetic field — which is exactly why C1 sees the full load current and is the reliability limit.",
      d: ["M 40 70 H 160 V 200 H 40", "M 160 70 H 600 V 200 H 160"] },
    { on: [0,1], t: "Switch off", f: (D) => [D, 1], n: "The diode takes over and C1 recharges from the input inductor. Both inductors keep conducting throughout, so the input and output currents are continuous — the property that makes a Ćuk quiet at both ports.",
      d: ["M 40 70 H 280 V 200 H 40", "M 280 70 H 600 V 200 H 280"] },
  ]},
  halfbridge: { w: 780, h: 295, sw: [[230, 102, "Q1", 0], [230, 192, "Q2", 0], [465, 80, "D1"], [465, 205, "D2"]],
    emc: { loop: "M 110 45 H 230 V 250 H 110 Z", node: [230, 147] },
    pol: [536, 158, 596, 158],              /* L, the output choke */
    capFlow: [{ d: "M 650 140 V 255", src: "out" }],
    ph: [
    { on: [1,0,1,0], t: "Q1 on", f: (D) => [0, D], n: "The primary sees +V_in/2, because the capacitor divider holds the return at half the bus. That halving is the reason each device blocks only V_in, against 2·V_in for a push-pull.",
      d: ["M 110 45 H 230 V 147 H 290 V 105 H 340", "M 340 169 H 320 V 200 H 110 V 45",
          "M 364 105 V 80 H 500 V 140 H 740 V 255 H 400 V 138"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [D, 0.5], n: "Neither switch conducts. The primary is undriven and the output inductor freewheels through both rectifiers at once — this interval is what the series blocking capacitor uses to keep the volt-seconds balanced.",
      d: ["M 500 140 H 740 V 255 H 400 V 138"], dim: ["M 110 45 H 230 V 147 H 290 V 105 H 340"] },
    { on: [0,1,0,1], t: "Q2 on", f: (D) => [0.5, 0.5 + D], n: "The primary reverses and sees −V_in/2. Driving the core in both quadrants is what makes the transformer small compared with a single-ended forward of the same power.",
      d: ["M 340 105 H 290 V 147 H 230 V 250 H 110 V 147",
          "M 364 171 V 205 H 500 V 140 H 740 V 255 H 400 V 138"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [0.5 + D, 1], n: "The second freewheel interval. Note the output ripple frequency is twice the switching frequency, so the filter is smaller than the switch timing alone would suggest.",
      d: ["M 500 140 H 740 V 255 H 400 V 138"], dim: ["M 110 45 H 230 V 147 H 290 V 105 H 340"] },
  ]},
  chargepump: { w: 700, h: 250, iShape: (u) => (u < 0.5 ? 0.25 + 0.75 * Math.exp(-12 * u) : 0.25 + 0.75 * Math.exp(-12 * (u - 0.5))),
    ilabel: "i_pump",
    sw: [[103, 70, "D1"], [230, 70, "D2"], [365, 70, "D3"]],
    emc: { loop: "M 55 70 H 300 V 178 H 55 Z", node: [165, 70] },
    ph: [
    { on: [1,0,1], t: "Clock low — charge", f: () => [0, 0.5], n: "C1 is connected across the input and charges through D1, while D3 hands the previous stage's charge on to the output. Charge moves as a spike whose size is set by how far the capacitor voltages have drifted apart, not by any resistor.",
      d: ["M 40 70 H 165 V 178", "M 300 70 H 600 V 200 H 480"] },
    { on: [0,1,0], t: "Clock high — pump", f: () => [0.5, 1], n: "C1's bottom plate is lifted to the input, so its top plate now sits a full V_in above it and pours charge through D2 into C2. That redistribution is lossy no matter how good the switches are — it is what the equivalent R_out is really describing.",
      d: ["M 165 70 H 300 V 178"], dim: ["M 420 70 H 600 V 200 H 480"] },
  ]},

  ilpfc: { w: 780, h: 320,
    sw: [[360, 147, "Q1", 0], [360, 220, "Q2", 0], [425, 105, "D1"], [425, 160, "D2"]],
    emc: { loop: "M 260 105 H 470 V 195 H 260 Z", node: [360, 105] },
    pol: [266, 123, 326, 123],              /* L1, the plotted leg */
    ph: [
    { on: [1,0,0,1], t: "Leg 1 charging", f: (D) => [0, D], n: "Q1 shorts L1 to the return, so L1 charges. At the same moment leg 2 is doing the opposite — D2 is delivering L2's stored current to the bus. One leg always rises while the other falls, and that is the whole idea: their ripple currents point opposite ways and much of what the filter would have seen cancels before it gets there.",
      d: ["M 130 105 H 360 V 195 H 130", "M 260 160 H 470 V 105 H 700 V 195 H 660"] },
    { on: [0,1,1,0], t: "Leg 2 charging", f: (D) => [D, 1], n: "Half a period later the roles swap: Q2 charges L2 while D1 hands L1's current to the bus. Notice the bus capacitor is being fed twice per switching period instead of once, and by pulses half the size — so the ripple current it has to swallow is far smaller than a single stage of the same power would demand.",
      d: ["M 130 195 H 360 V 160 H 260", "M 260 105 H 470 V 105 H 700 V 195 H 660"] },
  ]},

  qrflyback: { w: 700, h: 285, sw: [[250, 205, "Q1", 0], [365, 60, "D1"]],
    emc: { loop: "M 90 55 H 250 V 235 H 90 Z", node: [250, 165] },
    capFlow: [{ d: "M 450 60 V 215", src: "out" }],
    ph: [
    { on: [1,0], t: "Q1 on — storing", f: (D) => [0, D], n: "The switch connects the primary across the input and current ramps up, filling the core with energy. Nothing reaches the output during this interval — the secondary diode is reverse biased, and the load is living entirely off the output capacitor.",
      d: ["M 40 55 H 250 V 235 H 40"], dim: ["M 450 60 H 600 V 215 H 450"] },
    { on: [0,1], t: "Q1 off — delivering", f: (D) => [D, Math.min(D + 0.42, 0.86)], n: "The switch opens and the stored energy has to go somewhere, so it comes out of the secondary through D1 into the output capacitor and the load. The primary current has stopped dead; the current you can see moving now is the secondary's, decaying as the core empties.",
      d: ["M 274 60 H 620 V 215 H 274"], dim: ["M 40 55 H 250 V 235 H 40"] },
    { on: [0,0], t: "Ringing — waiting for the valley", f: (D) => [Math.min(D + 0.42, 0.86), 1], n: "The core is empty and the diode has stopped. Now the primary inductance and the switch's own capacitance are left alone together, and they ring — the drain voltage swings up and down of its own accord. An ordinary flyback would ignore this and turn on wherever its clock landed, often near the top of the swing, throwing away the energy stored on the switch as heat. This one waits for the bottom, and turns on there. That wait is why the frequency changes with load, and it is the only difference between this converter and a plain flyback.",
      d: ["M 205 235 V 165 H 250"], dim: ["M 40 55 H 250", "M 274 60 H 620 V 215 H 274"] },
  ]},

  /* ---- the bridge family, each on its own circuit ----

     These eight used to share one generic drawing of "a bridge", with a note
     admitting the picture was not the schematic above it. That is the right
     apology for the wrong thing: the whole point of a phase-shifted bridge is
     what happens in the interval a plain bridge does not have, and a figure
     that cannot draw the interval cannot make the point. Each one now traces
     its own conducting path over its own circuit. */

  forward2: { w: 720, h: 305,
    sw: [[210, 75, "Q1", 0], [210, 205, "Q2", 0], [140, 192, "D_a"], [175, 109, "D_b"],
      [337, 80, "D3"], [400, 165, "D4"]],
    emc: { loop: "M 80 40 H 210 V 275 H 80 Z", node: [210, 110] },
    pol: [431, 98, 491, 98],                /* L, the output choke */
    capFlow: [{ d: "M 550 80 V 250", src: "out" }],
    ph: [
    { on: [1,1,0,0,1,0], t: "Both switches on", f: (D) => [0, D], n: "Both switches close together, so the primary sees the full input and the transformer passes power across straight away — nothing is stored on purpose, which is the difference between this and a flyback. On the secondary D3 hands that power to the choke, and the choke feeds the load continuously.",
      d: ["M 40 40 H 210 V 275 H 40", "M 234 110 V 80 H 640 V 250 H 234 V 174"] },
    { on: [0,0,1,1,0,1], t: "Core reset", f: (D) => [D, Math.min(2 * D, 0.98)], n: "The switches open and the magnetising current has nowhere to go but through the two clamp diodes, which return it to the input — the core is being wound back to where it started. That reset takes as long as the on-time did, which is exactly why the duty of a forward converter has to stay below 0.5: run longer and the core never finishes resetting, and it walks into saturation a little further every cycle.",
      d: ["M 210 174 H 175 V 40 H 40", "M 40 275 H 140 V 110 H 210",
          "M 400 250 V 80 H 640 V 250 H 400"] },
    { on: [0,0,0,0,0,1], t: "Idle", f: (D) => [Math.min(2 * D, 0.98), 1], n: "The core is fully reset and the primary is doing nothing at all. The output does not notice: the choke is still pushing current through D4 into the load, which is what makes this output quiet compared with a flyback's.",
      d: ["M 400 250 V 80 H 640 V 250 H 400"],
      dim: ["M 40 40 H 210 V 275 H 40"] },
  ]},

  pushpull: { w: 740, h: 300,
    sw: [[230, 240, "Q1", 0], [270, 240, "Q2", 0], [435, 70, "D1"], [435, 190, "D2"]],
    emc: { loop: "M 95 40 H 230 V 275 H 95 Z", node: [300, 70] },
    /* Above the choke: below it the B disc sat 6 px off the secondary return
       and notched the conducting dashes with its opaque fill. */
    pol: [506, 106, 566, 106],              /* L, the output choke */
    capFlow: [{ d: "M 620 130 V 250", src: "out" }],
    ph: [
    { on: [1,0,1,0], t: "Q1 on", f: (D) => [0, D], n: "Q1 pulls one half of the primary down, so that half sees the whole input voltage and the core is driven one way. D1 carries the resulting secondary current into the choke.",
      d: ["M 50 40 H 150 V 130 H 300 V 70 H 230 V 275 H 50",
          "M 324 70 H 470 V 130 H 700 V 250 H 560 V 138 H 324"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [D, 0.5], n: "Neither switch conducts, so the primary is undriven. The choke keeps its current going by sharing it between both rectifiers at once, and the load never sees the gap.",
      d: ["M 470 130 H 700 V 250 H 560 V 138"],
      dim: ["M 150 130 H 300 V 70 H 230"] },
    { on: [0,1,0,1], t: "Q2 on", f: (D) => [0.5, 0.5 + D], n: "Q2 drives the other half of the primary, and the core is pushed back the other way. Using the core in both directions is what makes a push-pull transformer roughly half the size of a forward's for the same power — but it only works if the two halves are matched, because any imbalance leaves a DC component that walks the core toward saturation.",
      d: ["M 50 40 H 150 V 130 H 300 V 190 H 270 V 275 H 50",
          "M 324 190 H 470 V 130 H 700 V 250 H 560 V 138 H 324"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [0.5 + D, 1], n: "The second freewheel. Because power arrived twice in one switching period, the output ripple sits at twice the switching frequency — so the filter is smaller than the switch timing alone would suggest.",
      d: ["M 470 130 H 700 V 250 H 560 V 138"],
      dim: ["M 150 130 H 300 V 190 H 270"] },
  ]},

  psfb: { w: 800, h: 300,
    sw: [[170, 105, "Q1", 0], [170, 195, "Q2", 0], [300, 105, "Q3", 0], [300, 195, "Q4", 0],
      [552, 95, "D1"], [552, 215, "D2"]],
    emc: { loop: "M 90 45 H 300 V 255 H 90 Z", node: [300, 150] },
    pol: [616, 168, 676, 168],              /* L_o, the output choke */
    capFlow: [{ d: "M 710 150 V 265", src: "out" }],
    ph: [
    { on: [1,0,0,1,1,0], t: "Q1 + Q4 driving", f: (D) => [0, D], n: "One switch from each leg is on, and they are diagonally opposite, so the primary sees the full input. This is the interval that actually delivers power, and its length is set by how far apart the two legs are switched — the phase shift — rather than by any switch's own duty.",
      d: ["M 40 45 H 170 V 150 H 200 V 200 H 410 V 184 H 430",
          "M 430 120 H 398 V 150 H 300 V 255 H 40",
          "M 454 120 V 95 H 585 V 150 H 770 V 265 H 490 V 153"] },
    { on: [0,0,0,1,1,0], t: "ZVS transition", f: (D) => [D, Math.min(D + 0.04, 0.49)], n: "Q1 opens and, for a few tens of nanoseconds, nothing is driving the primary — but the current in L_r keeps flowing and has to go somewhere, so it drains the charge off the switch that is about to turn on. By the time that switch is told to close, the voltage across it has already fallen to zero, so it closes for free. This tiny interval is the entire reason to build a phase-shifted bridge instead of an ordinary one.",
      d: ["M 430 120 H 398 V 150 H 300 V 255 H 40",
          "M 585 150 H 770 V 265 H 490 V 153"],
      dim: ["M 40 45 H 170 V 150"] },
    { on: [0,1,0,1,1,1], t: "Freewheel", f: (D) => [Math.min(D + 0.04, 0.49), 0.5], n: "Both conducting switches are now on the same side of the bridge, which short-circuits the primary. Current keeps circulating around that loop — costing conduction loss while delivering nothing — and the output choke freewheels through both rectifiers. Circulating current during this interval is the price the topology pays for its soft switching.",
      d: ["M 430 184 H 410 V 200 H 180 V 150 H 170 V 45 H 300 V 150 H 398 V 120 H 430",
          "M 585 150 H 770 V 265 H 490 V 153"] },
    { on: [0,1,1,0,0,1], t: "Q3 + Q2 driving", f: (D) => [0.5, 0.5 + D], n: "The other diagonal takes over and the primary voltage reverses, so the core is used in both directions. Two power pulses per switching period means the output filter sees twice the switching frequency.",
      d: ["M 40 45 H 300 V 150 H 398 V 120 H 430",
          "M 430 184 H 410 V 200 H 180 V 150 H 170 V 255 H 40",
          "M 454 186 V 215 H 585 V 150 H 770 V 265 H 490 V 153"] },
    { on: [0,1,0,0,0,1], t: "ZVS transition", f: (D) => [0.5 + D, Math.min(0.5 + D + 0.04, 0.99)], n: "The mirror image of the first transition. This is the leg that loses zero-voltage switching first as the load falls, because it relies on energy stored in L_r alone — with less current there is less energy, and below some load it simply cannot swing the node in time.",
      d: ["M 430 184 H 410 V 200 H 180 V 150 H 170 V 255 H 40",
          "M 300 150 H 398 V 120 H 430",
          "M 585 150 H 770 V 265 H 490 V 153"],
      dim: ["M 40 45 H 300 V 150"] },
    { on: [1,0,1,0,1,1], t: "Freewheel", f: (D) => [Math.min(0.5 + D + 0.04, 0.99), 1], n: "The second circulating interval, this time around the upper rail. Notice the primary current does not stop between pulses the way a forward converter's does — it keeps going round, which is what keeps the switches soft but also what makes light load inefficient.",
      d: ["M 430 184 H 410 V 200 H 180 V 150 H 170 V 45 H 300 V 150 H 398 V 120 H 430",
          "M 585 150 H 770 V 265 H 490 V 153"] },
  ]},

  llc: { w: 780, h: 290,
    ilabel: "i_tank",
    /* The tank current is a sinusoid, not a ramp — that is the whole point of
       a resonant converter, and the reason its edges are quiet. */
    iShape: (u) => Math.abs(Math.sin(2 * Math.PI * u)),
    sw: [[230, 103, "Q1", 0], [230, 193, "Q2", 0], [522, 92, "D1"], [522, 212, "D2"]],
    emc: { loop: "M 90 45 H 230 V 250 H 90 Z", node: [230, 148] },
    ph: [
    { on: [1,0,1,0], t: "Q1 on", f: () => [0, 0.46], n: "Q1 connects the tank to the input. Because L_r and C_r resonate, the current does not ramp like an inductor's — it swells and falls as a half sine, which is why this converter is so much quieter than a hard-switched one. D1 delivers the secondary half-cycle.",
      d: ["M 40 45 H 230 V 148 H 366 V 118 H 400", "M 400 182 V 250 H 40",
          "M 424 118 V 92 H 555 V 150 H 740 V 255 H 460 V 151"] },
    { on: [0,0,0,0], t: "Dead time", f: () => [0.46, 0.5], n: "Both switches are off. The magnetising current keeps circulating and swings the half-bridge node across to the other rail, so the switch about to turn on finds zero volts across it. The converter gets this for free at every load, which is why an LLC keeps its efficiency down to very light load.",
      d: ["M 230 148 H 366 V 118 H 400", "M 400 182 V 250 H 230"],
      dim: ["M 555 150 H 740 V 255 H 460 V 151"] },
    { on: [0,1,0,1], t: "Q2 on", f: () => [0.5, 0.96], n: "Q2 pulls the tank to the return rail and the current reverses through the same half sine. D2 takes the secondary half-cycle. Both rectifiers turn off at a natural current zero, so they make no reverse-recovery noise at all.",
      d: ["M 400 118 H 366 V 148 H 230 V 250 H 400 V 182",
          "M 424 184 V 212 H 555 V 150 H 740 V 255 H 460 V 151"] },
    { on: [0,0,0,0], t: "Dead time", f: () => [0.96, 1], n: "The mirror transition. Output is controlled by changing the switching frequency, not the duty: move away from resonance and the tank's impedance rises, so less power gets through.",
      d: ["M 400 118 H 366 V 148 H 230", "M 400 182 V 250 H 230"],
      dim: ["M 555 150 H 740 V 255 H 460 V 151"] },
  ]},

  dab: { w: 820, h: 290,
    ilabel: "i_L(tank)",
    /* A trapezoid whose corners move with the phase shift: steep while the two
       bridges oppose each other, shallow while they agree. */
    iShape: (u, D) => {
      const d = Math.min(Math.max(D, 0.02), 0.48);
      const t = u < 0.5 ? u : u - 0.5;
      return Math.abs(t < d ? -1 + (2 * t) / d : 1 - 0.35 * (t - d) / (0.5 - d));
    },
    sw: [[150, 103, "S1", 0], [150, 193, "S2", 0], [270, 103, "S3", 0], [270, 193, "S4", 0],
      [560, 103, "S5", 0], [560, 193, "S6", 0], [680, 103, "S7", 0], [680, 193, "S8", 0]],
    emc: { loop: "M 85 45 H 270 V 250 H 85 Z", node: [270, 148] },
    ph: [
    { on: [1,0,0,1,0,1,1,0], t: "Bridges opposed", f: (D) => [0, Math.min(Math.max(D, 0.02), 0.48)], n: "Both bridges drive the inductor, but in opposite directions, so it sees the sum of the two voltages and its current slews hard. This is the interval that actually moves power, and the phase between the bridges decides how long it lasts — which is the only control this converter has.",
      d: ["M 40 45 H 150 V 148 H 180 V 200 H 410 V 182 H 430",
          "M 430 118 H 348 V 148 H 270 V 250 H 40",
          "M 454 118 V 148 H 560 V 45 H 790", "M 790 250 H 680 V 148 H 660 V 210 H 454 V 182"] },
    { on: [1,0,0,1,1,0,0,1], t: "Bridges aligned", f: (D) => [Math.min(Math.max(D, 0.02), 0.48), 0.5], n: "The far bridge switches, so both now push the same way and the inductor sees only the difference between them. The current stops slewing and drifts instead. Power still flows, but this interval is mostly circulating current — which is why a DAB is designed with the two voltages matched through the turns ratio.",
      d: ["M 40 45 H 150 V 148 H 180 V 200 H 410 V 182 H 430",
          "M 430 118 H 348 V 148 H 270 V 250 H 40",
          "M 454 118 V 148 H 560 V 250 H 790", "M 790 45 H 680 V 148 H 660 V 210 H 454 V 182"] },
    { on: [0,1,1,0,1,0,0,1], t: "Opposed, reversed", f: (D) => [0.5, Math.min(0.5 + Math.max(D, 0.02), 0.98)], n: "The near bridge flips and the whole picture reverses. The transformer is used symmetrically in both directions, so its core never accumulates flux — and there is no duty to balance, because both bridges run at a fixed half.",
      d: ["M 40 45 H 270 V 148 H 348 V 118 H 430",
          "M 430 182 H 410 V 200 H 180 V 148 H 150 V 250 H 40",
          "M 454 118 V 148 H 560 V 250 H 790", "M 790 45 H 680 V 148 H 660 V 210 H 454 V 182"] },
    { on: [0,1,1,0,0,1,1,0], t: "Aligned, reversed", f: (D) => [Math.min(0.5 + Math.max(D, 0.02), 0.98), 1], n: "The mirror of the second interval. Reverse the sign of the phase shift and every arrow here turns round — the same hardware sends power the other way with no reconfiguration, which is the reason to build one.",
      d: ["M 40 45 H 270 V 148 H 348 V 118 H 430",
          "M 430 182 H 410 V 200 H 180 V 148 H 150 V 250 H 40",
          "M 454 118 V 148 H 560 V 45 H 790", "M 790 250 H 680 V 148 H 660 V 210 H 454 V 182"] },
  ]},

  hbridge: { w: 760, h: 280,
    ilabel: "i_Lf",
    /* One switching period taken at the crest of the output sine, where the
       duty is widest — the same device the PFC pages use for a line cycle. */
    iShape: (u, D) => 0.6 + 0.4 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    sw: [[200, 75, "Q1", 0], [200, 165, "Q2", 0], [320, 130, "Q3", 0], [320, 220, "Q4", 0]],
    emc: { loop: "M 95 50 H 320 V 240 H 95 Z", node: [200, 120] },
    pol: [426, 138, 486, 138],              /* L_f, the output filter choke */
    capFlow: [{ d: "M 95 50 V 240", src: "out" }],
    ph: [
    { on: [1,0,0,1], t: "Driving the load", f: (D) => [0, D], n: "One diagonal is on and the full DC link appears across the filter, pushing current out into the load. This is a single switching period taken near the crest of the output sine, where the on-time is at its longest; as the sine falls back toward its zero crossing the same interval shrinks, and at the crossing it all but vanishes.",
      d: ["M 40 50 H 200 V 120 H 620 V 175 H 320 V 240 H 40"] },
    { on: [1,0,1,0], t: "Freewheeling", f: (D) => [D, 1], n: "Both upper switches are on, so both ends of the filter sit at the same potential and the load sees zero volts rather than the reverse rail. The choke current keeps circulating round that loop. Switching this way — unipolar — means the filter sees a step of V_dc at twice the switching frequency instead of 2·V_dc, which is why the filter is so much smaller than a bipolar scheme needs.",
      d: ["M 200 120 H 620 V 175 H 320 V 50 H 200"] },
  ]},

  vsi3: { w: 760, h: 290,
    ilabel: "i_a",
    iShape: (u, D) => 0.62 + 0.38 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    sw: [[220, 85, "A+", 0], [220, 175, "A−", 0], [320, 105, "B+", 0], [320, 195, "B−", 0],
      [420, 125, "C+", 0], [420, 215, "C−", 0]],
    emc: { loop: "M 95 50 H 420 V 250 H 95 Z", node: [220, 130] },
    capFlow: [{ d: "M 95 50 V 250", src: "out" }],
    ph: [
    { on: [1,0,0,1,0,1], t: "Active vector", f: (D) => [0, D], n: "Phase A is tied to the positive rail while B and C are tied to the negative one, so current flows out of A and returns through the other two windings. Only eight switch combinations exist in total, and six of them look like this one — the motor is steered by choosing which, and for how long.",
      d: ["M 40 50 H 220 V 130 H 545", "M 545 150 H 320 V 250 H 40"] },
    { on: [1,0,1,0,1,0], t: "Zero vector", f: (D) => [D, 1], n: "All three phases are shorted to the same rail. The motor sees no voltage at all, but its own inductance keeps the current circulating around the three upper switches, so torque does not collapse. Sliding time between the active vectors and this one is how the average output voltage is set.",
      d: ["M 220 130 H 545", "M 545 150 H 320 V 50 H 220"] },
  ]},

  npc3: { w: 700, h: 300,
    ilabel: "i_ph",
    iShape: (u, D) => 0.64 + 0.36 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    sw: [[300, 82, "S1", 0], [300, 132, "S2", 0], [300, 188, "S3", 0], [300, 236, "S4", 0],
      [225, 107, "D1"], [225, 213, "D2"]],
    emc: { loop: "M 100 50 H 300 V 250 H 100 Z", node: [300, 160] },
    ph: [
    { on: [1,1,0,0,0,0], t: "P state", f: (D) => [0, D], n: "The two upper devices are on together and the output sits at the positive rail. Notice that it takes two devices in series to do the job of one — and that is the trade: each of them only ever has to block half the DC link, so you can build a 1500 V converter out of 900 V parts.",
      d: ["M 40 50 H 300 V 160 H 470"] },
    { on: [0,1,0,0,1,0], t: "O state — clamped to the midpoint", f: (D) => [D, 1], n: "S1 opens and the output does not fall to the negative rail — it stops at the midpoint between the two link capacitors, held there through the clamp diode. That third level is the entire point: the output steps by half the link instead of all of it, so the voltage jump is half as large, the harmonics it makes are far smaller and the filter shrinks accordingly. The price is keeping that midpoint balanced, because every O interval moves charge into or out of one capacitor and not the other.",
      d: ["M 100 150 H 150 V 107 H 300 V 160 H 470"],
      dim: ["M 40 50 H 300"] },
  ]},
};

/* stacked bar showing where the watts actually go */
const LCOL = ["#E0A458", "#5AD1DE", "#F0796C", "#6FD39B", "#A88BF0", "#8DA0B4"];
function LossBar({ items }) {
  const list = (items || []).filter((x) => isFinite(x[1]) && x[1] > 0);
  const tot = list.reduce((a, b) => a + b[1], 0);
  if (!(tot > 0)) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
        Loss breakdown · {eng(tot, "W")} total
      </span>
      <div className="lbar">
        {list.map((it, i) => (
          <div key={i} className="lseg" style={{ width: (100 * it[1] / tot) + "%", background: LCOL[i % 6] }} />
        ))}
      </div>
      <div className="lleg">
        {list.map((it, i) => (
          <span key={i} className="lit">
            <i style={{ background: LCOL[i % 6] }} />
            <b><Mx t={it[0]} /></b> {eng(it[1], "W")} · {pct(it[1] / tot)}
            {it[2] ? <em><Mx t={it[2]} /></em> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Device badges.

   A switch and a diode are not the same kind of thing, and the figure has
   to say so. A switch is COMMANDED: something else decides, and its lever
   swings shut. A diode is a valve that decides for itself, purely from the
   voltage across it — nothing drives it.

   Previously both were the same glyph recoloured, which is why a diode
   read as "a switch that happens to be on". They now have deliberately
   different vocabularies: the switch keeps its moving lever, the diode
   gets a valve that fills and passes visible current when forward biased,
   and empties behind a barrier when it is holding voltage off. Each also
   states its condition in words — "closed"/"open" against "conducting"/
   "blocking" — because those are different physical situations.        */
/* SR1/SR2 are synchronous-rectifier FETs: they have gates and a driver
   decides what they do, so they are switches, not diodes. */
const isDiode = (label) => /^D/.test(String(label));

/* A ring AROUND the device, never a panel on top of it.

   Boxed badges had to be positioned somewhere, and on a dense schematic
   every position was wrong: offset, and the device name appeared twice;
   centred, and the box buried the very symbol it was describing. On a
   four-diode bridge they simply collided.

   A ring encircles the symbol instead, so it can never obscure it and
   needs no knowledge of the device's orientation. The two device kinds
   keep distinct vocabularies: a switch is COMMANDED, and its ring is solid
   with a filled core when it is driven on; a diode RESPONDS, so its ring is
   drawn as a valve gate — open with current flowing through when forward
   biased, closed with a barrier across it when blocking. The words live in
   the legend under the figure, where words belong. */
/* ---------------------------------------------------------------------
   Direction arrows along a conducting path.

   Moving dashes imply direction only while they are moving; paused, or on
   the very first paint, the figure says nothing about which way the charge
   is going. These chevrons say it statically.

   The geometry itself — the M/H/V/L parser, the per-phase measurement, the
   arrowhead treadmill and the coil splice — lives in flowgeo.js, a plain
   module with no React in it, so check-flow.mjs can assert against the same
   code the figures draw with. */

/* `flip` turns the head through 180° for a branch whose current has reversed.
   Only the capacitor branches use it: a conducting path carries current one
   way by definition, but a capacitor's current changes sign inside the period
   and an arrowhead still pointing the old way would contradict the dashes
   underneath it. The flip lands on the zero crossing, where the whole group
   is transparent, so it is never seen happening. */
/* Text that changes as the animation runs, without moving anything under it.

   Every alternative is rendered into the SAME grid cell and all but one made
   invisible, so the box is permanently as tall as its tallest option. The
   phase notes are two lines for one interval and four for the next, and
   letting the box resize meant the waveform below it jumped up and down twice
   a cycle — the figure you are trying to read moving because of the caption
   beside it. Reserving a fixed number of lines instead would either waste
   space or clip, and the right number differs per topology; this measures.

   The hidden copies are `visibility: hidden`, not `display: none`, because
   only the former still contributes its height. They are hidden from the
   accessibility tree too, so a screen reader gets the live one alone. */
const Swap = ({ items, active, className }) => (
  <span className={"swap" + (className ? " " + className : "")}>
    {items.map((t, i) => (
      <span key={i} className={i === active ? "" : "off"}
        aria-hidden={i === active ? undefined : "true"}>{t}</span>
    ))}
  </span>
);

const Chevron = (m, i, flip) => (
  <path key={"cv" + i} className="carrow" opacity={m.o === undefined ? 1 : m.o.toFixed(3)}
    d="M -4.5 -4.5 L 3 0 L -4.5 4.5"
    transform={`translate(${m.x.toFixed(1)},${m.y.toFixed(1)}) rotate(${(m.a + (flip ? 180 : 0)).toFixed(1)})`} />
);

/* The two device kinds are marked in the terms that actually distinguish
   them, rather than in two shades of the same badge.

   A switch has a GATE, and something outside the power circuit decides what
   that gate does. So a switch is marked on its gate lead: lit and driven, or
   dark and idle. Nothing is drawn across the device itself — that was the
   mark that read as "crossed out" rather than "open".

   A diode has no gate. Nothing commands it; it responds to the voltage
   across it. It keeps the ring, and the bar across it when it is blocking,
   which reads as the barrier it is holding up against reverse voltage. */
const DevMark = (x, y, label, on, rot) => {
  if (isDiode(label)) {
    const r = 12;
    /* The bar is drawn in both states and faded, not added and removed. A
       mounting element cannot run a CSS transition, so a conditional bar
       snapped in rather than appearing. */
    return (
      <g key={nk()} className={"devr" + (on ? " on" : "") + " di"}>
        <circle className="halo" cx={x} cy={y} r={r + 3} />
        <circle className="ring" cx={x} cy={y} r={r} />
        <path className="bar" opacity={on ? 0 : 1}
          d={`M ${x - 6.5} ${y - 6.5} L ${x + 6.5} ${y + 6.5}`} />
      </g>
    );
  }
  /* The MOSFET primitive draws itself inside a rotate(rot) group, so the same
     transform relocates any of its own features here. */
  const a = ((rot || 0) * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const at = (px, py) => [x + px * ca - py * sa, y + px * sa + py * ca];
  const [ix, iy] = at(-10, 0);
  const [ox, oy] = at(-23, 0);
  /* The channel, at local x = −5, running the length of the device. A
     translucent disc centred on the FET used to be the conducting mark, but
     the glyph is a tall, left-heavy 22×40 shape and a circle cuts straight
     through its channel, its gate plate and both power leads. It works on a
     diode only because a diode body is nearly round.

     Marking the channel says what the symbol is already there to say. An
     enhancement MOSFET is drawn with a BROKEN channel line precisely because
     there is no channel until the gate makes one, so this is one path whose
     dashes reproduce the symbol's own three segments when off and close into
     a single conducting bar when on. Drawn over a dark casing, or at 3 px of
     green it merges with the flow dashes running past it. */
  const [c1x, c1y] = at(-5, -13), [c2x, c2y] = at(-5, 13);
  const chan = `M ${c1x.toFixed(1)} ${c1y.toFixed(1)} L ${c2x.toFixed(1)} ${c2y.toFixed(1)}`;
  return (
    <g key={nk()} className={"devg" + (on ? " on" : "")}>
      <path className="chanbg" d={chan} />
      <path className="chan" d={chan} />
      {/* The drive pip sits on the gate TERMINAL, well outside the device
          body, so the commanded state carries at a glance without anything
          being drawn over the symbol. */}
      <circle className="gglow" cx={ox.toFixed(1)} cy={oy.toFixed(1)} r={7.5} />
      <path className="glead" d={`M ${ox.toFixed(1)} ${oy.toFixed(1)} L ${ix.toFixed(1)} ${iy.toFixed(1)}`} />
      <circle className="gdot" cx={ox.toFixed(1)} cy={oy.toFixed(1)} r={2.8} />
    </g>
  );
};

/* ---------------------------------------------------------------------
   Which way the inductor is being driven, right now.

   v_L = L·di/dt. The terminal the current ENTERS is the positive one while the
   current is rising and the negative one while it is falling — and that is the
   whole reason the trace is a triangle rather than a line. The marks flip at
   the commutation, the slope changes sign at the same instant, and both are
   read off the one cycle model, so they cannot disagree with each other or
   with the waveform beside them.

   Note that this depends on di/dt and not on i, so it stays correct where a
   synchronous rectifier's current runs backwards at light load — the sign of
   the current changes and the polarity marks do not.

   Both strokes of the plus are always drawn and only the vertical one's
   opacity changes, which makes the flip a cross-fade: a plus losing its
   upright IS a minus. Swapping one path's `d` for another cannot be
   transitioned at all, and at sixty frames a second an instant substitution
   reads as a glitch rather than as a commutation. */
const PolMark = (x, y, plus) => (
  <g key={nk()} className="polm">
    <circle cx={x} cy={y} r={8} />
    <path d={`M ${x - 3.6} ${y} H ${x + 3.6}`} />
    <path d={`M ${x} ${y - 3.6} V ${y + 3.6}`} style={{ opacity: plus }} />
  </g>
);

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
        <span className="eyebrow">Design space · how the operating point behaves when it moves</span>
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

  return (
    <div className="card">
      <span className="eyebrow">Design space · how the operating point behaves when it moves</span>
      <div className="ctl" style={{ margin: "0 0 12px" }} role="group" aria-label="Map quantity">
        <button className={mode === "eta" ? "on" : ""} onClick={() => setMode("eta")}
          aria-pressed={mode === "eta"}>efficiency</button>
        <button className={mode === "loss" ? "on" : ""} onClick={() => setMode("loss")}
          aria-pressed={mode === "loss"}>total loss</button>
      </div>
      <div className="hmwrap">
        <div className="sch">
          <svg viewBox="0 0 660 200" style={{ width: "100%", height: "auto", display: "block" }} role="img"
            onMouseLeave={() => setHover(null)}>
            {drawScope("hm", () => (<>
              <g className="hmgrid">
                {grid.cells.map((c) => (
                  <rect key={c.j * grid.NX + c.i} className="hmcell"
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
        {hover ? (
          <div className="hmtip" style={{
            left: `calc(${((x0 + hover.i * cw + cw / 2) / 660) * 100}% + ${hover.i > grid.NX / 2 ? -170 : 12}px)`,
            top: `${((y0 + hover.j * ch) / 200) * 100}%`,
          }}>
            <div><b>{hover.val === null ? "no solution" : fmt(hover.val)}</b></div>
            <em>
              {eng(hover.v, "")} in · {eng(hover.load, "")} load
              {hover.eta !== null && mode === "loss" ? " · η " + pct(hover.eta) : ""}
              {hover.loss !== null && mode === "eta" ? " · " + eng(hover.loss, "W") + " lost" : ""}
              {hover.warn ? " · " + hover.warn + " warning" + (hover.warn > 1 ? "s" : "") : ""}
            </em>
          </div>
        ) : null}
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

/* ---- harmonic envelope of a trapezoidal switching waveform ---- */
function Spectrum({ fsw, D, tr, amp }) {
  /* y0 leaves a row above the plot for the unit caption, so the scale can be
     plain numbers instead of hanging its unit off whichever tick had room. */
  const x0 = 54, x1 = 640, y0 = 24, y1 = 166, fmin = 1e4, fmax = 1e8;
  const L = Math.log10(fmax) - Math.log10(fmin);
  const lx = (f) => x0 + ((Math.log10(f) - Math.log10(fmin)) / L) * (x1 - x0);
  const ly = (db) => y1 - (Math.min(Math.max(db, 0), 160) / 160) * (y1 - y0);
  const sinc = (v) => (Math.abs(v) < 1e-9 ? 1 : Math.sin(v) / v);
  const dB = (v) => 20 * Math.log10(Math.max(v, 1e-12) / 1e-6);
  const bars = [];
  let n = 1;
  while (n * fsw <= fmax) {
    const f = n * fsw;
    if (f >= fmin) {
      const c = 2 * amp * D * Math.abs(sinc(n * Math.PI * D)) * Math.abs(sinc(n * Math.PI * tr * fsw));
      bars.push([lx(f), ly(dB(c)), dB(c)]);
    }
    n += n < 60 ? 1 : Math.ceil(n / 30);
  }
  const f1 = fsw / (Math.PI * Math.max(D, 1e-3)), f2 = 1 / (Math.PI * Math.max(tr, 1e-12));
  /* the upper bound the harmonics ride under: flat, then −20, then −40 dB/decade */
  const envAt = (f) => 2 * amp * D
    * Math.min(1, f1 / f) * Math.min(1, f2 / f);
  const envD = (() => {
    let d = "";
    for (let k = 0; k <= 120; k++) {
      const f = fmin * Math.pow(fmax / fmin, k / 120);
      d += (k ? " L " : "M ") + lx(f).toFixed(1) + " " + ly(dB(envAt(f))).toFixed(1);
    }
    return d;
  })();
  /* CISPR 32 class B, conducted, quasi-peak */
  const lim = [[1.5e5, 66], [5e5, 56], [5e6, 56], [5e6, 60], [3e7, 60]];
  const limD = lim.map((q, i) => (i ? "L " : "M ") + lx(q[0]).toFixed(1) + " " + ly(q[1]).toFixed(1)).join(" ");
  const dec = [1e4, 1e5, 1e6, 1e7, 1e8];
  const gl = { stroke: "#22303F", strokeWidth: 1, fill: "none" };

  /* --- annotations, placed so they cannot land on top of each other ---
     The corner markers, the envelope label and the limit label all want
     the same upper-left region. Each is given a preferred anchor, then the
     set is pushed apart vertically and clamped inside the plot.        */
  const anns = [];
  anns.push({ x: clamp(lx(1.1e6), x0 + 4, x1 - 92), y: ly(56) - 8,
    t: "CISPR 32 class B", c: "#F0796C", a: "start" });
  anns.push({ x: x0 + 6, y: clamp(ly(dB(2 * amp * D)) - 9, y0 + 9, y1 - 6),
    t: "envelope", c: "#E0A458", a: "start" });
  [[f1, "1/(πD·T)", "#E0A458"], [f2, "1/(π·t_r)", "#A88BF0"]].forEach((m, i) => {
    if (!(m[0] > fmin && m[0] < fmax)) return;
    /* flip the label to the left of its rule when it would run off the edge */
    const at = lx(m[0]);
    const right = at + 6 + 62 < x1;
    anns.push({ x: right ? at + 6 : at - 6, y: y0 + 11 + i * 13, t: m[1], c: m[2],
      a: right ? "start" : "end", rule: at });
  });
  const ys = layoutLabelsX(anns, 12, y0 + 9, y1 - 4);

  return (
    <div className="sch">
      {/* 700 wide so the last decade label has somewhere to sit. It used to
          be dropped entirely — the plot ends at x = 640 and a centred "100 MHz"
          would have run past a 660 frame, which left the top of the sweep
          unlabelled on the one axis whose whole point is where in frequency
          the noise lands. */}
      <svg viewBox="0 0 700 212" style={{ width: "100%", height: "auto", display: "block" }} role="img">
        {drawScope("sp", () => (<>
          {/* The unit, once, above the scale — the same place LineChart puts
              its y caption. It used to ride on the topmost tick as "160 dBµV",
              which made one tick wider than the rest and left a reader
              scanning for the unit if that tick was off screen. */}
          {Tx(x0 - 7, y0 - 12, "dBµV", { c: "#8DA0B4", s: 10.5, a: "start" })}
          {/* Numeric ticks at 9 in the default ink, the same rung of the type
              ladder the waveform panes' scale numbers sit on. */}
          {[0, 40, 80, 120, 160].map((d) => (
            <g key={"h" + d}>
              <path d={`M ${x0} ${ly(d)} H ${x1}`} {...gl} />
              {Tx(x0 - 7, ly(d) + 3.5, String(d), { c: "#8DA0B4", s: 9, a: "end" })}
            </g>
          ))}
          {dec.map((f, i) => (
            <g key={"v" + f}>
              <path d={`M ${lx(f)} ${y0} V ${y1}`} {...gl} />
              {/* the first is pushed right of the y-axis numbers; the last is
                  anchored at its end so it stays inside the frame. engAx, so a
                  decade reads "1 MHz", not "1.00 MHz". */}
              {Tx(lx(f) + (i === 0 ? 2 : 0), y1 + 16, engAx(f, "Hz"),
                { c: "#8DA0B4", s: 9,
                  a: i === 0 ? "start" : i === dec.length - 1 ? "end" : "middle" })}
            </g>
          ))}
          {bars.map((b, i) => (
            <path key={"b" + i} d={`M ${b[0].toFixed(1)} ${y1} V ${b[1].toFixed(1)}`}
              stroke="#5AD1DE" strokeWidth={1.4} opacity={0.75} fill="none" />
          ))}
          <path d={envD} stroke="#E0A458" strokeWidth={1.8} fill="none" opacity={0.95} />
          <path d={limD} stroke="#F0796C" strokeWidth={1.6} fill="none" />
          {anns.map((a, i) => (
            <g key={"a" + i}>
              {a.rule !== undefined ? (
                <path d={`M ${a.rule} ${y0} V ${y1}`} stroke={a.c} strokeWidth={1.2}
                  strokeDasharray="3 3" fill="none" opacity={0.8} />
              ) : null}
              {Tx(a.x, ys[i], a.t, { c: a.c, s: 9.5, a: a.a })}
            </g>
          ))}
          {Tx((x0 + x1) / 2, y1 + 30, "frequency", { c: "#8DA0B4", s: 10.5, a: "middle" })}
        </>))}
      </svg>
    </div>
  );
}

function SpecCard({ topo, spec, res }) {
  const fsw = (spec.fsw || 0) * 1e3;
  const amp0 = spec.vbus || spec.vdc || spec.vinNom || spec.vinMax || spec.vsec || spec.vout || 12;
  const tr0 = spec.tsw || 20;
  /* null means "follow the bench"; a number means the user has taken
     control of this field and edits on the bench must not overwrite it. */
  const [amp, setAmp] = useState(null);
  const [tr, setTr] = useState(null);
  useEffect(() => { setAmp(null); setTr(null); }, [topo.id]);
  if (!(fsw > 0)) return null;
  const ampTxt = amp === null ? String(amp0) : amp;
  const trTxt = tr === null ? String(tr0) : tr;
  const ampN = parseFloat(ampTxt), trN = parseFloat(trTxt);
  const A = Number.isFinite(ampN) && ampN > 0 ? ampN : amp0;
  const T = Number.isFinite(trN) && trN > 0 ? trN : tr0;
  const D = res && res.wave && isFinite(res.wave.D) ? clamp(res.wave.D, 0.02, 0.98) : 0.5;
  const generic = !(res && res.wave && isFinite(res.wave.D));
  const f1 = fsw / (Math.PI * D), fEdge = 1 / (Math.PI * T * 1e-9);
  return (
    <div className="card">
      <span className="eyebrow">Spectrum · where the switching energy lands</span>
      <div className="fields" style={{ marginBottom: 12 }}>
        <div className="fld">
          <label htmlFor="sp_a">switch-node step<span className="u"> V</span></label>
          <input id="sp_a" type="number" step="any" min="0.1" value={ampTxt}
            onChange={(e) => setAmp(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="sp_t">edge rate <Mx t="t_r" /><span className="u"> ns</span></label>
          <input id="sp_t" type="number" step="any" min="0.1" value={trTxt}
            onChange={(e) => setTr(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="sp_d">duty at the switch node</label>
          <input id="sp_d" type="number" readOnly value={D.toFixed(3)}
            title={generic
              ? "This topology publishes no switching waveform, so a 0.5 duty is assumed."
              : "Taken from the design above."} />
        </div>
      </div>
      {generic ? (
        <div className="note"><b>note ·</b> This topology does not publish a switching waveform,
          so the spectrum below assumes a 50 % duty. The corner set by the edge rate is unaffected;
          the first corner is not.</div>
      ) : null}
      <Spectrum fsw={fsw} D={D} tr={T * 1e-9} amp={A} />
      <div className="grid3" style={{ marginTop: 12 }}>
        <div className="stat"><span className="eyebrow">first corner</span>
          <div className="big cu">{eng(f1, "Hz")}</div></div>
        <div className="stat"><span className="eyebrow">edge corner</span>
          <div className="big vi">{eng(fEdge, "Hz")}</div></div>
        <div className="stat"><span className="eyebrow">rolls off</span>
          <div className="big cy">−40 dB/dec</div></div>
      </div>
      <p className="flownote">
        The envelope is flat to the first corner, falls at 20 dB/decade to the second, then at 40 dB/decade.
        Only the edge rate sets that second corner, which is why slowing the gate drive is the most direct
        lever on high-frequency content — and why it trades directly against switching loss.
        Slew this edge twice as slowly and everything above <Sub t={eng(fEdge, "Hz")} /> drops by 6 dB.
      </p>
      <p className="flownote" style={{ color: "var(--faint)" }}>
        This is the source spectrum of an ideal trapezoid at the switch node, not a measured emission.
        Real conducted levels depend on the filter, the coupling path and the LISN; the class B line is drawn
        for scale only.
      </p>
    </div>
  );
}

/* the operation card: the conduction path, animated at the real current.
   Dash offset advances with accumulated charge, so the flow speeds up as
   the inductor charges and slows as it discharges.                       */
function FlowCard({ topo, res, spec }) {
  const period = swPeriod(spec);
  const F = FLOW[topo.id];
  const reduce = usePrefersReducedMotion();
  const [p, setP] = useState(0);
  const [play, setPlay] = useState(true);
  const [spd, setSpd] = useState(1);
  const [lens, setLens] = useState("i");

  /* `u` runs 0→1 across the whole plotted waveform, not across one period.
     The switching phase is derived from it, so the marker and the circuit
     can never disagree: one clock, one wrap point, at the right-hand edge
     of the plot rather than a third of the way along it. */
  useEffect(() => { setP(0); setLens("i"); }, [topo.id]);
  useEffect(() => { if (reduce) setPlay(false); }, [reduce]);
  useEffect(() => {
    if (!play || !F) return undefined;
    let raf, last = 0;
    const step = (now) => {
      if (last) {
        const dt = Math.min((now - last) / 1000, 0.1);
        setP((v) => (v + dt * 0.28 * spd / WAVE_CYCLES) % 1);
      }
      last = now; raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [play, spd, F, topo.id]);

  /* The schematic underneath never changes while the animation runs, so it
     is built once per topology and kept out of the per-frame path. The draw
     is also when the inductors record themselves into COILS — the flow
     overlay routes its dashes over those windings, and taking the extents
     from the drawing itself is what keeps the two from drifting apart. */
  const sch = useMemo(
    () => drawScope("sc", () => {
      if (!SCH[topo.sch]) return null;
      coilCapture = COILS[topo.sch] = [];
      try { return SCH[topo.sch](); } finally { coilCapture = null; }
    }),
    [topo.sch]
  );
  const wv = res && res.wave ? res.wave : null;
  /* Where a topology has no design-derived waveform but does supply its own
     current shape, plot that instead of leaving the figure with nothing under
     it. A shape cannot carry amps or a duty, so the pane it gets is a bare
     one — the current alone, scaled to its own peak. Fourteen topologies had
     a moving schematic and no waveform at all before this. */
  const bare = !wv && F.iShape
    ? { bare: true, iShape: F.iShape, D: F.bareD || 0.5, ilabel: F.ilabel || "i" }
    : null;

  /* The same cycle the waveform pane draws — not a second implementation of
     it. The flow used to run its own 240-point quadrature over its own idea
     of the current shape, which is how the dashes came to keep flowing
     through a flyback's off-time, when no primary current exists. */
  const M = useMemo(
    () => (F ? buildCycle(wv, F.iShape) : null),
    [F, cycleKey(wv, F && F.iShape)]
  );

  if (!F || !M) return null;
  const D = M.D;
  /* p sweeps the whole plot; tPer is the position inside the current
     switching period, which is what every circuit-state calculation wants. */
  const tPer = (p * WAVE_CYCLES) % 1;
  /* The overlay animates the CONDUCTING path, so it reads the flow current,
     which for a pulse topology is not the plotted trace. See cycle.js. */
  const iNow = M.flowAt(tPer);
  /* Peak drives stroke weight and opacity, so it must never be zero — an
     idle topology would divide the whole overlay away. */
  const iPk = M.flowPk > 1e-9 ? M.flowPk : 1;
  const flowOff = -(M.qFlowAt(tPer) / (M.flowTot || 1)) * 240;

  /* Phase lookup. Some topologies define windows that do not tile the
     cycle (a rectifier conducts for a slice and idles for the rest), so
     falling outside every window has to resolve to the last phase that
     started rather than sticking on whatever was previously showing. */
  const bounds = F.ph.map((q, k) =>
    (q.f ? q.f(D) : [k / F.ph.length, (k + 1) / F.ph.length]));
  let idx = 0;
  for (let k = 0; k < bounds.length; k++) {
    if (tPer >= bounds[k][0] && tPer < bounds[k][1]) { idx = k; break; }
    if (tPer >= bounds[k][0]) idx = k;
  }
  const ph = F.ph[idx];
  const band = ph.f ? ph.f(D) : null;
  /* Stepping to a phase parks the marker in the middle of that phase in the
     FIRST drawn period, so the highlighted band and the marker agree. */
  const jump = (k) => {
    const b = F.ph[k].f ? F.ph[k].f(D) : [0, 1];
    setPlay(false); setP(((b[0] + b[1]) / 2) / WAVE_CYCLES);
  };
  const rising = M.flowAt(Math.min(tPer + 0.01, 0.999)) > iNow;

  /* Inductor polarity, from the slope of the trace the reader can see.

     Only where the topology has a real `wave` spec: without one buildCycle
     falls back to a placeholder triangle, and marking a placeholder's polarity
     would be asserting something about the circuit that nothing computed.
     Where the current genuinely sits still — the dead interval of a
     discontinuous cycle — v_L is zero and neither terminal is positive, so the
     pair fades rather than picking a side. */
  const slope = wv ? M.slopeAt(tPer) : 0;
  const pol = F.pol && wv
    ? { plus: slope > 0 ? 1 : 0,
      live: Math.abs(slope) < (M.iPeak - M.iValley) * 0.02 ? 0.2 : 1 }
    : null;

  const devs = (F.sw || []).map((q, j) => ({
    label: q[2], on: ph.on ? !!ph.on[j] : false, diode: isDiode(q[2]),
  }));
  /* Every phase's drawable geometry at once: the authored polylines spliced
     through the windings they cross (coilSplice — so the dashes climb the
     coils instead of sliding under them on the chord), then measured. All
     phases together rather than the active one, because a commutation needs
     two phases' geometry in the same frame to cross-fade between them. */
  const phGeo = useMemo(() => {
    const coils = COILS[topo.sch] || [];
    return F.ph.map((q) => {
      const d = (q.d || []).map((s) => coilSplice(s, coils));
      return {
        d,
        dim: (q.dim || []).map((s) => coilSplice(s, coils)),
        geo: d.map(polySegs),
      };
    });
  }, [F, topo.sch]);

  /* ---- commutation cross-fade ----

     A phase change used to swap every path's `d` in a single frame, so at
     each commutation whole branches teleported — the one remaining pop in a
     figure where everything else dissolves. Instead, inside a short window
     around each phase boundary, both phases render at once: the outgoing
     route fades down as the incoming one fades up.

     The window is clamped to a fraction of the adjacent phases' widths so
     the psfb's 4 %-wide ZVS slivers are not all fade, and the opacities are
     computed here, per frame, never CSS-transitioned — the same rule as the
     rest of the overlay (see styles.js), and it means scrubbing shows the
     fade deterministically instead of only while playing. */
  const starts = bounds.map((b) => b[0]);
  const phaseAt = (t) => {
    t = ((t % 1) + 1) % 1;
    let ix = 0;
    for (let k = 0; k < bounds.length; k++) {
      if (t >= bounds[k][0] && t < bounds[k][1]) { ix = k; break; }
      if (t >= bounds[k][0]) ix = k;
    }
    return ix;
  };
  /* Nearest boundary, cyclically, so the wrap at t = 0 fades like any other. */
  let nearK = 0, nearD = Infinity;
  for (let k = 0; k < starts.length; k++) {
    let dd = tPer - starts[k];
    dd -= Math.round(dd);
    if (Math.abs(dd) < Math.abs(nearD)) { nearD = dd; nearK = k; }
  }
  const inIdx = phaseAt(starts[nearK] + 1e-4);
  const outIdx = phaseAt(starts[nearK] - 1e-4);
  const wOf = (k) => Math.max(bounds[k][1] - bounds[k][0], 1e-3);
  const fw = Math.min(0.02, 0.4 * Math.min(wOf(inIdx), wOf(outIdx)));
  /* 0 = outgoing phase fully present, 1 = incoming fully arrived. Cubic
     ease-in-out, not smoothstep: the narrowest windows span only three or
     four frames at 1×, so the first rendered sample can land a third of the
     way in — a curve that is still nearly flat there keeps a mounting layer
     under sight (measured ≤ 0.1) however the frames quantise it. */
  let blend = 1;
  if (outIdx !== inIdx && Math.abs(nearD) < fw / 2) {
    const u = (nearD + fw / 2) / fw;
    blend = u < 0.5 ? 4 * u * u * u : 1 - 4 * (1 - u) * (1 - u) * (1 - u);
  }
  const fading = blend < 1;

  /* The frame's draw lists. Keys carry the phase index, so a commutation
     mounts the incoming routes and unmounts the outgoing ones instead of
     morphing a persistent element's `d`. Shared copper must not dip: a
     branch present in both phases renders once, fully opaque, on the
     incoming side. */
  const flows = [];   /* { d, segs, o, key } */
  const dims = [];
  if (!fading) {
    phGeo[idx].d.forEach((d, j) =>
      flows.push({ d, segs: phGeo[idx].geo[j], o: 1, key: "f" + idx + "_" + j }));
    phGeo[idx].dim.forEach((d, j) =>
      dims.push({ d, o: 1, key: "m" + idx + "_" + j }));
  } else {
    const inD = new Set(phGeo[inIdx].d), inM = new Set(phGeo[inIdx].dim);
    const outD = new Set(phGeo[outIdx].d), outM = new Set(phGeo[outIdx].dim);
    phGeo[outIdx].d.forEach((d, j) => {
      if (!inD.has(d)) flows.push({ d, segs: phGeo[outIdx].geo[j], o: 1 - blend, key: "f" + outIdx + "_" + j });
    });
    phGeo[inIdx].d.forEach((d, j) =>
      flows.push({ d, segs: phGeo[inIdx].geo[j], o: outD.has(d) ? 1 : blend, key: "f" + inIdx + "_" + j }));
    phGeo[outIdx].dim.forEach((d, j) => {
      if (!inM.has(d)) dims.push({ d, o: 1 - blend, key: "m" + outIdx + "_" + j });
    });
    phGeo[inIdx].dim.forEach((d, j) =>
      dims.push({ d, o: outM.has(d) ? 1 : blend, key: "m" + inIdx + "_" + j }));
  }
  /* Brightness rides |i|: a synchronous rectifier running backwards at light
     load is carrying real current, and dimming it for its sign would say
     otherwise. Direction is the dashes' and arrows' job. */
  const mag = Math.min(Math.abs(iNow) / iPk, 1);
  /* A discontinuous cycle's rest interval should visibly rest — the dashes
     hold at a floor rather than vanishing, and everything is continuous in
     t, so nothing ever appears at a visible opacity. */
  const flowLive = 0.30 + 0.70 * mag;
  const arrows = flows.map((fl) => arrowsAt(fl.segs, -flowOff));

  /* ---- the capacitor branches ----

     The one current a reader cannot get at any other way. Everywhere else the
     figure animates a path that is either conducting or not; a capacitor is
     always connected and its current changes SIGN partway through the period,
     which is exactly the thing the switching path can never show.

     Each branch is drawn in the direction positive current flows INTO the
     capacitor, and its dashes ride on the charge integral, so:

       charging     q rises, dashes and arrows run along the drawn direction
       discharging  q falls, they run backwards, into the circuit

     No sign test decides that — the integral does it, and it is the same
     integral the i_C pane is drawn from, so the direction on the schematic
     and the side of zero on the plot cannot disagree. The reversal lands
     exactly on the zero crossing, where the marks are at their faintest, so
     it dissolves rather than flipping.

     `src` picks which capacitor: "out" is the output filter cap from the
     design's own `cap` spec, "in" the input cap the model derives from the
     switch current. Fixed geometry, drawn in every phase — a branch that
     appeared and vanished at commutation would pop, and the capacitor is
     doing something interesting in every phase anyway. */
  const capGeo = useMemo(() => (F.capFlow || []).map((g) => polySegs(g.d)), [F.capFlow]);
  const capFlows = (F.capFlow || []).map((g, j) => {
    const src = g.src === "in" ? M.inCap : M.cap;
    if (!src || !capGeo[j] || !capGeo[j].total) return null;
    const i = src.at(tPer);
    const pk = g.src === "in"
      ? (src.ipk > 1e-12 ? src.ipk : 1)
      : Math.max(Math.abs(src.iCmin), Math.abs(src.iCmax), 1e-12);
    const off = -(src.qAt(tPer) / (src.qAbs || 1)) * 240;
    const mag = Math.min(Math.abs(i) / pk, 1);
    return {
      i, mag, off, geo: capGeo[j], label: g.src === "in" ? "C_in" : "C_out",
      /* Continuous in t, so nothing ever appears at a visible opacity: a
         mark at the zero crossing is invisible, which is also the instant
         the direction reverses. */
      o: 0.12 + 0.88 * mag,
      arrows: arrowsAt(capGeo[j], -off),
      /* the arrowhead points the way it is actually travelling */
      flip: i < 0,
    };
  }).filter(Boolean);

  return (
    <div className="card">
      <span className="eyebrow">
        How it works · current path and inductor polarity, at the real rate
      </span>
      {FAMILY[topo.id] ? (
        <p className="fam">This is <Sub t={FAMILY[topo.id]} /></p>
      ) : null}
      <PlayBar
        play={play} onPlay={() => setPlay(!play)}
        spd={spd} onSpd={(v) => { setSpd(v); setPlay(true); }}
        phases={F.ph.map((q) => q.t)} phase={play ? -1 : idx} onPhase={jump}
        pos={p} onPos={(v) => { setPlay(false); setP(v); }}
        extra={
          <>
            <span className="sp" />
            <button className={lens === "i" ? "on" : ""} onClick={() => setLens("i")}
              aria-pressed={lens === "i"}>current path</button>
            <button className={lens === "emc" ? "on" : ""} onClick={() => setLens("emc")}
              aria-pressed={lens === "emc"} disabled={!F.emc}
              title={F.emc ? "Show the hot loop and the swinging node" : "No EMC overlay drawn for this topology yet"}>
              EMC hot spots
            </button>
            {wv ? (
              <span className="ird">
                <Mx t={wv.ilabel || "i_L"} /> = <b>{eng(iNow, "A")}</b>
                <em className={rising ? "up" : "dn"}>{rising ? "▲ rising" : "▼ falling"}</em>
              </span>
            ) : null}
          </>
        }
      />
      <div className="flowwrap fig">
        {sch}
        <svg className="flowov" viewBox={`0 0 ${F.w} ${F.h}`} aria-hidden="true">
          {lens === "emc" && F.emc ? (
            <g>
              <path d={F.emc.loop} className="emcloop" />
              <circle cx={F.emc.node[0]} cy={F.emc.node[1]} r={20} className="emcn2" />
              <circle cx={F.emc.node[0]} cy={F.emc.node[1]} r={10} className="emcn" />
            </g>
          ) : (
            <>
              {dims.map((m) => <path key={m.key} d={m.d} className="flowdim"
                style={{ opacity: (0.4 * m.o).toFixed(3) }} />)}
              {flows.map((fl) => <path key={"g" + fl.key} d={fl.d} className="flowglow"
                style={{ opacity: ((0.07 + 0.09 * mag) * fl.o).toFixed(3),
                  strokeWidth: 5 + 6 * mag }} />)}
              {flows.map((fl) => <path key={fl.key} d={fl.d} className="flowp"
                style={{ opacity: (flowLive * fl.o).toFixed(3),
                  strokeDashoffset: flowOff, strokeWidth: 1.7 + 2.2 * mag }} />)}
              {/* which way the charge is going — travelling with it */}
              {arrows.map((set, j) => (
                <g key={"ar" + flows[j].key}
                  style={{ opacity: ((0.55 + 0.45 * mag) * flowLive * flows[j].o).toFixed(3) }}>
                  {set.map((m, i) => Chevron(m, i))}
                </g>
              ))}
              {/* The capacitor branches, in their own colour — the same violet
                  the i_C pane is drawn in, so the schematic and the plot share
                  one vocabulary. Drawn after the conducting path so they read
                  as a separate current rather than part of the loop. */}
              {drawScope("cf", () => capFlows.map((c, j) => (
                <g key={"cf" + j} className="capfl" style={{ opacity: c.o.toFixed(3) }}>
                  <path d={F.capFlow[j].d} className="capglow"
                    style={{ strokeWidth: 4 + 5 * c.mag }} />
                  <path d={F.capFlow[j].d} className="capp"
                    style={{ strokeDashoffset: c.off, strokeWidth: 1.4 + 1.8 * c.mag }} />
                  {c.arrows.map((m, i) => Chevron(m, i, c.flip))}
                </g>
              )))}
              {/* and which way the inductor is being driven */}
              {pol ? (
                <g style={{ opacity: pol.live }}>
                  {drawScope("pl", () => [
                    PolMark(F.pol[0], F.pol[1], pol.plus),
                    PolMark(F.pol[2], F.pol[3], 1 - pol.plus),
                  ])}
                </g>
              ) : null}
            </>
          )}
          {drawScope("db", () => (F.sw || []).map((q, j) =>
            DevMark(q[0], q[1], q[2], ph.on ? !!ph.on[j] : false, q[3])))}
        </svg>
      </div>
      {devs.length ? (
        <div className="devleg">
          {/* The two states read differently and wrap to different heights, so
              they are stacked too — otherwise a device changing state reflows
              the legend and shifts the figure below it. */}
          {devs.map((d, j) => (
            <span key={j} className={d.on ? "lit" : "blk"}>
              <i /><b>{d.label}</b>
              <Swap active={d.on ? 0 : 1} items={d.diode
                ? ["forward biased — it conducts because the circuit forces it to",
                  "reverse biased — it blocks, no one told it to"]
                : ["commanded on by the gate driver", "commanded off by the gate driver"]} />
            </span>
          ))}
          {/* One row in the legend rather than a paragraph of its own: the
              marks use the same vocabulary as the device rings above them, so
              they belong in the same list. */}
          {pol ? (
            <span className="pol"><i /><b>+ −</b>
              <Sub t="the inductor's own voltage, v_L = L·di/dt — the terminal the current enters is the positive one while the current rises" />
            </span>
          ) : null}
          {/* The capacitor branches get a line of their own, because their
              arrows mean something different from the ones on the conducting
              path: those show where current goes, these show which way it has
              turned. */}
          {capFlows.length ? (
            <span className="cap"><i /><b>{capFlows.map((c) => c.label).join(" · ")}</b>
              <Swap active={capFlows[0].i >= 0 ? 0 : 1} items={[
                "the capacitor is charging — current runs into it, and its voltage is rising",
                "the capacitor is discharging — the arrows have turned, and it is now supplying the circuit",
              ]} />
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Every phase's note, stacked — so the box holds the tallest of them
          and the waveform below it stays exactly where it is as the cycle
          runs. See Swap. */}
      <p className="flownote">
        <Swap
          items={[...F.ph.map((q, j) => <Sub key={j} t={q.n} />),
            <Sub key="emc" t="Red marks the loop carrying switched current: its enclosed area sets the magnetic field it radiates, so minimising it is the first layout job. Violet marks the node that swings the full rail every cycle — the dominant source of common-mode current through stray capacitance to earth. Keep its copper no larger than the current requires." />]}
          active={lens === "emc" ? F.ph.length : idx} />
      </p>
      {wv || bare ? (
        <div style={{ marginTop: 12 }}>
          <Wave {...(wv || bare)} band={band} playhead={p} flowOffset={flowOff} fadeEdges={play}
            period={period} />
        </div>
      ) : null}
    </div>
  );
}

const TABS = [["bench", "Bench"], ["cheat", "Cheat sheet"], ["select", "Selector"]];

/* Move the entered values from one topology to another. Only what the user
   actually changed travels: a switching frequency or an output current
   means the same thing on the next page and re-typing it is pure friction,
   but each topology's own defaults exist because its sensible operating
   point differs, so an untouched field takes the new page's default rather
   than dragging a 3.3 V buck output onto a boost that cannot produce it. */
function carryOver(fromId, toId, prev) {
  const fromDefaults = mkRaw(fromId);
  const next = mkRaw(toId);
  Object.keys(next).forEach((k) => {
    const edited = prev[k] !== undefined && fromDefaults[k] !== undefined
      && prev[k] !== fromDefaults[k];
    if (edited) next[k] = prev[k];
  });
  return next;
}

/* The tab and the topology live in the URL hash, so the back button works,
   a reload lands where you left off, and a specific converter can be sent
   to someone as a link. */
function readHash() {
  if (typeof window === "undefined") return {};
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h) return {};
  const [tab, tid] = h.split("/");
  return {
    tab: ["bench", "cheat", "select"].includes(tab) ? tab : undefined,
    tid: tid && TOPOS.some((t) => t.id === tid) ? tid : undefined,
  };
}

/* The words this page used, defined. Scanned out of the page's own prose, so
   there is nothing per-topology to keep in step: write a new interval note
   that mentions dead time and the definition appears by itself. */
function TermCard({ topo }) {
  const F = FLOW[topo.id];
  /* Everything the reader can see on the page, including the equations and
     their footnotes — those carry most of the vocabulary a beginner trips
     over ("ideal CCM", "the real duty", "drops into DCM"), and leaving them
     out gave the buck page two definitions when it wanted five. */
  const text = [topo.tag, topo.what, (topo.chips || []).join(" "),
    (topo.pros || []).join(" "), (topo.cons || []).join(" "), (topo.use || []).join(" "),
    (topo.eqs || []).map((e) => e.e + " " + (e.n || "")).join(" "),
    FAMILY[topo.id] || "", (F && F.ph ? F.ph.map((q) => q.n).join(" ") : "")].join(" ");
  const hits = termsFor(text);
  if (!hits.length) return null;
  return (
    <div className="card">
      <span className="eyebrow">Terms used on this page</span>
      <dl className="terms">
        {hits.map(([name, , def]) => (
          <div key={name}>
            <dt><Sub t={name} /></dt>
            <dd><Sub t={def} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function App() {
  const start = readHash();
  const [tab, setTab] = useState(start.tab || "bench");
  const [tid, setTid] = useState(start.tid || "buck");
  const [q, setQ] = useState("");
  const [sq, setSq] = useState("");
  const [raw, setRaw] = useState(() => mkRaw(start.tid || "buck"));
  const [scat, setScat] = useState("All");
  const tabRefs = useRef([]);

  useEffect(() => {
    const want = "#/" + tab + (tab === "bench" ? "/" + tid : "");
    if (window.location.hash !== want) window.history.replaceState(null, "", want);
  }, [tab, tid]);
  /* A hash change — the back button, a pasted link, an in-page jump — moves
     to a different topology without reloading, so the inputs have to be
     rebuilt for it. Setting tid alone left the panel showing the previous
     topology's values, and blanks wherever the two field lists differed. */
  useEffect(() => {
    const on = () => {
      const h = readHash();
      if (h.tab) setTab(h.tab);
      if (h.tid) setTid((prevId) => {
        if (h.tid !== prevId) setRaw((prev) => carryOver(prevId, h.tid, prev));
        return h.tid;
      });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const topo = TOPOS.find((t) => t.id === tid) || TOPOS[0];

  /* Sanitise once, here, so no design() ever has to defend itself. Anything
     unparseable falls back to the field default; anything out of range is
     clamped to the nearest usable value; anything out of ORDER with its
     siblings is pushed back into order. The field itself shows the user that
     their entry was rewritten (see Fields). */
  const spec = useMemo(() => {
    const o = {};
    Object.entries(raw).forEach(([k, v]) => {
      const F = FIELDS[k];
      const n = parseFloat(v);
      const base = isFinite(n) ? n : (F ? F.d : 0);
      o[k] = F && F.mn !== undefined ? clamp(base, F.mn, F.mx) : base;
    });
    return order(o);
  }, [raw]);

  /* A thrown exception and a design that simply yields no numbers are
     different failures and get different messages — the old code caught
     everything and reported "enter a full set of numbers", which was both
     wrong and unhelpful when the real cause was a bug. */
  const res = useMemo(() => {
    if (!topo.design) return null;
    try { return topo.design(spec); } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }, [topo, spec]);

  const pick = useCallback((id) => {
    setRaw((prev) => carryOver(tid, id, prev));
    setTid(id);
    setTab("bench");
  }, [tid]);
  const set = (k, v) => setRaw((r) => ({ ...r, [k]: v }));

  /* Fold diacritics so "cuk" finds "Ćuk" — otherwise the entry is
     unreachable by typing, because nobody reaches for Ć. */
  const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(q.trim());
  const hits = TOPOS.filter((t) =>
    !needle || fold(t.name + " " + t.cat + " " + t.tag + " " + t.chips.join(" ")).includes(needle));
  const sheetNeedle = fold(sq.trim());
  const sheetCats = ["All", ...Array.from(new Set(SHEETS.map((s) => s.cat)))];
  const sheets = SHEETS.filter((s) => (scat === "All" || s.cat === scat)
    && (!sheetNeedle || fold(s.title + " " + s.cat + " "
      + s.rows.map((r) => r.e + " " + (r.n || "")).join(" ")).includes(sheetNeedle)));

  return (
    <div className="ps">
      <style>{CSS}</style>
      <div className="hdr">
        <div className="brand">
          <h1>POWER<b>·</b>STAGE</h1>
          <span>interactive designer and reference · {TOPOS.length} topologies</span>
        </div>
        <div className="tabs" role="tablist" aria-label="Sections">
          {TABS.map(([k, l], i) => (
            <button key={k} id={"tab-" + k} role="tab" ref={(el) => { tabRefs.current[i] = el; }}
              aria-selected={tab === k} aria-controls={"panel-" + k} tabIndex={tab === k ? 0 : -1}
              className={"tab" + (tab === k ? " on" : "")}
              onKeyDown={(e) => {
                const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const n = (i + d + TABS.length) % TABS.length;
                setTab(TABS[n][0]);
                if (tabRefs.current[n]) tabRefs.current[n].focus();
              }}
              onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "bench" && (
        <div className="wrap" id="panel-bench" role="tabpanel" aria-labelledby="tab-bench"><div className="layout">
          <nav className="rail" aria-label="Topologies">
            <div className="railsearch">
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Filter topologies…" aria-label="Filter topologies" />
              {q ? <button className="railclear" onClick={() => setQ("")} aria-label="Clear filter">×</button> : null}
            </div>
            {q ? (
              <span className="railcount" role="status" aria-live="polite">
                {hits.length} of {TOPOS.length} topologies
              </span>
            ) : null}
            {CATS.map((c) => {
              const list = hits.filter((t) => t.cat === c);
              if (!list.length) return null;
              return (
                <div className="rgrp" key={c}>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>{c}</span>
                  {list.map((t) => (
                    <button key={t.id} className={"ritem" + (t.id === tid ? " on" : "")}
                      aria-current={t.id === tid ? "true" : undefined}
                      onClick={() => pick(t.id)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              );
            })}
            {!hits.length && (
              <div className="rgrp">
                <p style={{ fontSize: "var(--t-fine)", margin: "4px 0 10px" }}>
                  Nothing matches “{q}”.
                </p>
                <button className="ritem" onClick={() => setQ("")}>Clear the filter</button>
              </div>
            )}
          </nav>

          <main>
            <div className="card">
              <span className="eyebrow">{topo.cat}</span>
              <h2>{topo.name}</h2>
              <p style={{ marginBottom: 2 }}><Sub t={topo.tag} /></p>
              <div className="chips" style={{ marginBottom: 14 }}>
                {topo.chips.map((c, i) => <span key={i} className={"chip " + ["cu", "cy", "vi"][i % 3]}>{c}</span>)}
              </div>
              {/* The same schematic, twice, was the single most confusing thing
                  on the page. Where a topology has a traced conduction path,
                  the card below draws this exact circuit again — with devices
                  that light up, current that moves and polarity marks that
                  flip — and a reader scrolling past two identical drawings
                  reasonably assumes they are two different circuits and starts
                  looking for the difference. So the static copy only appears
                  where nothing better follows it. */}
              {!FLOW[topo.id] && SCH[topo.sch] ? SCH[topo.sch]() : null}
              <p style={{ margin: "14px 0 0" }}><Sub t={topo.what} /></p>
            </div>

            {/* Every topology traces its own circuit now, so there is one
                branch here where there used to be two. The generic family
                figure it replaced came with a note admitting the drawing was
                not the schematic above it; what that figure was genuinely
                good at — placing a converter in its family — survives as the
                `fam` line inside the card. */}
            <FlowCard topo={topo} res={res} spec={spec} />

            <div className="card">
              <span className="eyebrow">Specification</span>
              <Fields topo={topo} raw={raw} spec={spec} set={set} />
            </div>

            <div className="card">
              <span className="eyebrow">Design output</span>
              <Results res={res} spec={spec} hideWave={!!FLOW[topo.id]} />
            </div>

            <HeatCard topo={topo} spec={spec} />

            <SpecCard topo={topo} spec={spec} res={res} />

            <div className="card">
              <span className="eyebrow">Governing equations</span>
              {topo.eqs.map((e, i) => <Eq key={i} e={e.e} n={e.n} />)}
            </div>

            <div className="card">
              <span className="eyebrow">Trade-offs</span>
              <div className="grid3">
                <div><h3 style={{ color: "#6FD39B" }}>Strengths</h3><ul>{topo.pros.map((x, i) => <li key={i}><Sub t={x} /></li>)}</ul></div>
                <div><h3 style={{ color: "#F0796C" }}>Costs</h3><ul>{topo.cons.map((x, i) => <li key={i}><Sub t={x} /></li>)}</ul></div>
                <div><h3 style={{ color: "#E0A458" }}>Found in</h3><ul>{topo.use.map((x, i) => <li key={i}><Sub t={x} /></li>)}</ul></div>
              </div>
            </div>

            <TermCard topo={topo} /></main>
        </div></div>
      )}

      {tab === "cheat" && (
        <div className="wrap" id="panel-cheat" role="tabpanel" aria-labelledby="tab-cheat">
          <div className="railsearch" style={{ maxWidth: 340, marginBottom: 14 }}>
            <input className="sheetsearch" value={sq} onChange={(e) => setSq(e.target.value)}
              placeholder="Search the cheat sheet…" aria-label="Search the cheat sheet" />
            {sq ? <button className="railclear" onClick={() => setSq("")} aria-label="Clear search">×</button> : null}
          </div>
          <div className="flt">
            {sheetCats.map((c) => (
              <button key={c} className={scat === c ? "on" : ""} onClick={() => setScat(c)}
                aria-pressed={scat === c}>{c}</button>
            ))}
          </div>
          {sq || scat !== "All" ? (
            <p role="status" aria-live="polite" style={{ fontSize: "var(--t-fine)", marginTop: -6 }}>
              {sheets.length} of {SHEETS.length} sections
            </p>
          ) : null}
          <div className="grid2">
            {sheets.map((s, i) => (
              <div className="card" key={i}>
                <span className="eyebrow">{s.cat}</span>
                <h3 style={{ marginBottom: 12 }}>{s.title}</h3>
                {s.rows.map((r, j) => <Eq key={j} e={r.e} n={r.n} src={r.src} />)}
              </div>
            ))}
          </div>
          {!sheets.length ? (
            <div className="card"><p>Nothing matches “{sq}”. <button className="ritem"
              style={{ display: "inline", width: "auto", padding: "2px 6px" }}
              onClick={() => { setSq(""); setScat("All"); }}>Clear the search</button></p></div>
          ) : null}
        </div>
      )}

      {tab === "select" && (
        <div className="wrap" id="panel-select" role="tabpanel" aria-labelledby="tab-select">
          <div className="card">
            <span className="eyebrow">Pick a topology</span>
            <h3>Five questions, in this order</h3>
            <ul style={{ marginBottom: 14 }}>
              <li><b style={{ color: "#E4ECF4" }}>Do you need isolation?</b> Safety, ground loops or a large potential difference — if yes, everything in the isolated column, and the answer is usually a flyback below 150 W and a bridge above it.</li>
              <li><b style={{ color: "#E4ECF4" }}>Does V_in cross V_out?</b> If it does, you need a buck-boost family member: four-switch for efficiency, SEPIC for simplicity, Ćuk or Zeta if the ripple has to sit on a particular port.</li>
              <li><b style={{ color: "#E4ECF4" }}>How much power?</b> Above roughly 500 W, single-switch topologies stop making sense — move to bridges. Above 1 kW, start asking about soft switching.</li>
              <li><b style={{ color: "#E4ECF4" }}>What is the real constraint?</b> Efficiency, height, cost, EMI, transient response. Each points toward a different solution, and they rarely coincide.</li>
              <li><b style={{ color: "#E4ECF4" }}>How will you rectify?</b> A separate decision from the primary topology, and often the bigger lever. Below about 12 V out, the diode drop costs more than anything you will win on the primary side — go synchronous, and use a current doubler once the output current passes roughly 20 A.</li>
            </ul>
            <p style={{ fontSize: "var(--t-fine)", color: "var(--faint)" }}>
              Every row below that maps to a converter on the bench is clickable — it opens that
              design with your current numbers already filled in.
            </p>
            <div className="scrollx">
              <table>
                <thead><tr>
                  <th>Topology</th><th>Conversion</th><th>Isolated</th><th>Typical power</th>
                  <th>Switch stress</th><th>Character</th>
                </tr></thead>
                <tbody>
                  {SELECT.map((r, i) => {
                    const id = SELECT_ID[r[0]];
                    const go = id ? () => pick(id) : null;
                    return (
                      <tr key={i} onClick={go || undefined}
                        tabIndex={go ? 0 : undefined}
                        role={go ? "link" : undefined}
                        onKeyDown={go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } } : undefined}
                        title={go ? "Open " + r[0] + " on the bench" : undefined}
                        style={go ? { cursor: "pointer" } : undefined}>
                        <td style={{ color: go ? "var(--cy)" : "var(--txt)" }}>{r[0]}</td>
                        <td><Mx t={r[1]} /></td>
                        <td className="n" style={{ color: r[2] === "yes" ? "#6FD39B" : "#5C6E82" }}>{r[2]}</td>
                        <td className="n">{r[3]}</td>
                        <td className="v" style={{ fontSize: "var(--t-fine)" }}><Mx t={r[4]} /></td>
                        <td className="n"><Sub t={r[5]} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <p className="foot">
        Every number here is a first-pass estimate from idealised models — enough to choose parts and sanity-check a datasheet,
        not a substitute for simulation and a prototype. Loss figures ignore layout parasitics, core loss and temperature rise.
      </p>
    </div>
  );
}
