import React, { useMemo } from "react";
import { eng, engAx, pct, f2, f3, clamp } from "../format.js";
import { Mx, Sub } from "../tex.jsx";
import { buildCycle, cycleKey, isDCM } from "../cycle.js";
import { nk, drawScope, txWidth, subParts, Tx } from "../schematic/parts.jsx";

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
    period = null, vhi = "high" } = props;
  /* One shared description of the cycle, so this pane and the animated
     schematic can never draw different currents. See src/cycle.js.

     `iShape` is threaded through so a topology whose current is not a ramp
     at all — a resonant tank, a rectifier's conduction pulse — can be plotted
     from the same closure that drives its animation. Without it this pane
     could only draw designs that publish a `wave` spec, which is why a third
     of the topologies had a moving figure and no waveform under it. */
  /* The cycle this pane plots.

     A caller that has already resolved one hands it over; that is how the
     animated card and this pane stay the same converter. FlowCard now
     resolves a simulated cycle where a topology has a circuit, and building
     a second one here from the spec would draw the ideal triangle underneath
     a schematic animating the real current — the two disagreeing about the
     same converter, which is the fault the shared cycle model exists to
     prevent. Without a supplied model, nothing has changed. */
  const own = useMemo(() => buildCycle(props, props.iShape),
    [cycleKey(props, props.iShape)]);
  const M = props.model || own;
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
  const vbi = !!props.vbi;
  const vSpan = vbi ? [-1, 1] : [0, 1];
  /* The node, as the list of flat intervals it actually sits at — built by
     the cycle model, because the animated schematic reads the same list (a
     transformer's core flux is this node's volt-second integral) and the two
     drawings must not be able to disagree. One list covers the classic
     one-pulse node, the rectified two-pulse node behind a centre tap, and
     the bipolar primary whose zero mean is what keeps the core from
     walking; the pictures and the reasoning live with the list, in cycle.js. */
  const vFlats = M.flats || [];
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
  /* Normally the current pane scales itself to the cycle it is drawing.

     While a transient is playing that is exactly wrong: every period would
     rescale to its own peak, so a current climbing to meet a doubled load
     would appear not to move at all — the axis would grow underneath it and
     the waveform would sit still. `spanI` freezes the axis across the whole
     settle, which is what makes the climb visible. */
  const iCeil = props.spanI ? props.spanI[1] : Math.max(M.iMax * 1.18, 1e-9);
  const iFloor = props.spanI ? props.spanI[0] : Math.min(M.iMin * 1.18, 0);
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

export { WAVE_CYCLES, paneAt, layoutLabels, layoutLabelsX, axisFmt, Wave, LineChart };
