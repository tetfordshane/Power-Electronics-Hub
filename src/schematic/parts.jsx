import React from "react";

/* The primitives every schematic is drawn from, and the registries they fill
   as a side effect of drawing. The fields lens and the flow overlay both read
   those registries, which is what keeps the overlay from drifting away from
   the drawing underneath it. */
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
/* The same idea for capacitors and transformer cores, for the fields lens:
   plate positions and core bars recorded by the helpers that draw them, so
   the field marks cannot sit anywhere the symbol is not. */
const CAPS = {};
let capCapture = null;
const CORES = {};
let coreCapture = null;

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
  if (capCapture) capCapture.push({ axis: "v", x, y0: y1, y1: y2, m });
  return <g key={nk()}>
    {W(`M ${x} ${y1} V ${m - 4}`)}{W(`M ${x - 11} ${m - 4} H ${x + 11}`)}
    {W(`M ${x - 11} ${m + 4} H ${x + 11}`)}{W(`M ${x} ${m + 4} V ${y2}`)}
  </g>;
};
/* capacitor between (x1,y)-(x2,y), plates vertical */
const Ch = (x1, x2, y) => {
  const m = (x1 + x2) / 2;
  if (capCapture) capCapture.push({ axis: "h", y, x0: x1, x1: x2, m });
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
/* transformer core: the two bars, recorded for the fields lens the same way
   the windings are — the flux racetrack must sit where the core is drawn */
const Core = (bx, y0, y1) => {
  if (coreCapture) coreCapture.push({ x: bx + 3, y0, y1 });
  return <g key={nk()}>
    {W(`M ${bx} ${y0} V ${y1}`)}
    {W(`M ${bx + 6} ${y0} V ${y1}`)}
  </g>;
};
/* transformer: primary coil at x, secondary at x+30, core between */
const Xf = (x, y, h = 64, sd = 0) => {
  const n = 4, r = h / (2 * n);
  return <g key={nk()}>
    {Lv(x, y, n, r, -1)}
    {Core(x + 9, y - 4, y + h + 4)}
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
/* `role="img"` with no accessible name is worse than no role at all: it hides
   the drawing's contents from a screen reader and then declines to say what
   was hidden. The 32 schematics are thunks taking no arguments — the name has
   to come from whoever knows which topology is being drawn — so the callers
   clone this element with a `label`, and the fallback covers anything that
   forgets. */
const SV = ({ children, w = 660, h = 240, label }) => (
  <div className="sch"><svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}
    role="img" aria-label={label || "Circuit schematic"}>{children}</svg></div>
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
    {Core(x + 9, y - 4, y + h + 4)}
    {Lv(x + 24, y, 2, r, 1)}{Lv(x + 24, y + h / 2, 2, r, 1)}
    <circle key={nk()} cx={x - 13} cy={y + 4} r={2.6} fill="#E0A458" />
    <circle key={nk()} cx={x + 37} cy={y + 4} r={2.6} fill="#E0A458" />
    <circle key={nk()} cx={x + 37} cy={y + h / 2 + 4} r={2.6} fill="#E0A458" />
  </g>;
};

/* The capture registries are module state, so the component that draws a
   schematic asks for them by name rather than assigning across the module
   boundary. Both halves must run — the finally clause in the caller is what
   stops a thrown draw from leaving the capture pointed at a dead scope. */
const startCapture = (key) => {
  coilCapture = COILS[key] = [];
  capCapture = CAPS[key] = [];
  coreCapture = CORES[key] = [];
};
const endCapture = () => { coilCapture = null; capCapture = null; coreCapture = null; };

export {
  WS, FILL, nk, drawScope, W, Dot, subParts, txWidth, Tx,
  COILS, CAPS, CORES, startCapture, endCapture,
  Lh, HopW, VW, Lv, Cv, Ch, Rv, Rh, Dv, Dh, Q, Core, Xf, Port, Gnd, SV,
  P, N, ISO, Leg, AC, XfCT,
};
