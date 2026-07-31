/* =====================================================================
   FLOW GEOMETRY — the shape of a conducting path

   Plain module: no React, no DOM, so `scripts/check-flow.mjs` can assert
   against the same code the figures draw with rather than a second
   implementation of it. Same arrangement as cycle.js, for the same reason.

   The flow paths in FLOW are polylines built from M/H/V/L, so the geometry
   is parsed directly rather than measured through the DOM: no layout, no
   ref, and the result can be memoised per phase instead of recomputed a
   frame at a time.
   ===================================================================== */

const clamp = (x, lo, hi) => (isFinite(x) ? Math.min(Math.max(x, lo), hi) : lo);

export function polyPoints(d) {
  const segs = String(d).match(/[MLHV][^MLHV]*/gi) || [];
  const pts = []; let x = 0, y = 0;
  for (const seg of segs) {
    const c = seg[0].toUpperCase();
    const n = seg.slice(1).trim().split(/[\s,]+/).filter((s) => s !== "").map(Number);
    if (c === "M" || c === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) { x = n[i]; y = n[i + 1]; pts.push([x, y]); }
    } else if (c === "H") { for (const v of n) { x = v; pts.push([x, y]); } }
    else if (c === "V") { for (const v of n) { y = v; pts.push([x, y]); } }
  }
  return pts;
}

/* Measure a path once, per phase. */
export function polySegs(d) {
  const pts = polyPoints(d);
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    segs.push({ x: pts[i - 1][0], y: pts[i - 1][1], dx: dx / len, dy: dy / len, len, at: total });
    total += len;
  }
  return { segs, total };
}

/* Place arrowheads along a measured path, advanced by how far the charge has
   travelled. They ride with the dashes rather than sitting still beside
   them: a fixed arrow next to a moving dash reads as a diagram annotation,
   and looks inert the moment anything else on the figure changes.

   A fixed number of arrows, each position taken modulo the path length — a
   treadmill. The earlier version placed them at base + k·step and dropped
   any that ran past the end or landed near a corner, so the count swung
   between six and ten and arrows blinked in and out about four times a
   second. Measured, that flicker was a large part of what made the motion
   feel rough.

   The arrows ride a VIRTUAL belt: a circle whose circumference is the path
   length rounded up to a multiple of the 120-unit spacing, with the path
   laid along the first `total` of it. An arrow on the remainder arc is
   simply not drawn. Two things follow, and both are the point:

     · 120 divides the 240 units of dash travel one switching period adds,
       and it divides the belt circumference, so the travel wrapping at a
       period boundary maps every arrow exactly onto another's slot. The
       old `total/round(total/104)` spacing did not divide 240, and every
       arrow teleported by `240 mod step` at each wrap — measured at up to
       29 px, at full opacity, three times per plot loop; on a path shorter
       than two spacings the lone arrow jumped 120.
     · every arrow's position is continuous in `travel` right up to the
       moment it leaves through the path's end fade, and it re-enters
       through the start fade after its ride across the hidden arc. */
export function arrowsAt({ segs, total }, travel, spacing = 120) {
  if (!total || !segs.length) return [];
  const n = Math.max(1, Math.ceil(total / spacing));
  const C = n * spacing;
  const base = ((travel % C) + C) % C;
  const out = [];
  /* A conducting path has two ends, so on a moving belt of arrows one has to
     enter at the start whenever one leaves at the finish. Appearing at full
     strength, that entry is a pop — measured at roughly a hundred pixels,
     several times a second, and it was the last thing making the motion feel
     unsteady. Each arrow instead dissolves over the first and last stretch of
     its path, so it arrives and departs rather than blinking. */
  const FADE = 26;
  for (let k = 0; k < n; k++) {
    const s = (base + k * spacing) % C;
    if (s > total) continue;
    let seg = segs[segs.length - 1];
    for (const g of segs) { if (s >= g.at && s <= g.at + g.len) { seg = g; break; } }
    const t = clamp(s - seg.at, 0, seg.len);
    const edge = clamp(Math.min(s, total - s) / FADE, 0, 1);
    out.push({
      x: seg.x + seg.dx * t, y: seg.y + seg.dy * t,
      a: Math.atan2(seg.dy, seg.dx) * 180 / Math.PI,
      o: edge * edge * (3 - 2 * edge),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------
   Running the current THROUGH the winding.

   An inductor is the only symbol in the schematic that leaves the wire it
   sits on: `Lh`/`Lv` draw semicircular arcs bulging off to one side, while
   every other part — resistor, capacitor, diode, MOSFET — is centred on the
   straight run. A flow path drawn straight through an inductor therefore
   passes UNDER its coils along the chord, and what a reader sees is a green
   train that arrives at the winding, skips it, and picks up again on the far
   side. The current is continuous; the drawing says it isn't.

   So the coils are spliced into the polyline. `coilSplice` takes a FLOW path
   and the inductors the schematic actually drew (see the COILS registry in
   PowerStage.jsx — recorded by `Lh`/`Lv` themselves, so it cannot drift out
   of step with the drawing) and replaces the straight run across a coil with
   the coil's own arcs, sampled as short L segments.

   Sampled, not arced, deliberately: polyPoints/polySegs/arrowsAt parse
   M/L/H/V only, and teaching them elliptical arcs would mean arc-length
   integration in the frame path for a curve that is 0.17 px from its own
   chords at eight samples. Everything downstream is unaffected by the path
   getting longer — the dash offset rides the charge integral and wraps
   modulo, and arrow spacing is derived from the measured total.

   The splice fires only where a coil is EXACTLY colinear with a segment and
   FULLY contained in it. That is what keeps it honest: a path that
   deliberately stops at a winding terminal (every isolated secondary) is
   left alone, and a path that stops at a SERIES inductor's terminal is a
   bug, which check-flow.mjs reports rather than this quietly papering over.
   ------------------------------------------------------------------- */
const EPS = 1e-6;
/* Eight chords per semicircle: 0.17 px of sag at the r = 9 the schematics
   use, well under a stroke width. */
const CHORDS = 8;

/* A coil's own points, from its first terminal to its last. */
export function coilPoints(c) {
  const pts = [];
  const s = c.bulge > 0 ? 1 : -1;
  const h = c.axis === "h";
  /* Both helpers emit n semicircles of radius r. For a horizontal coil each
     one starts at the leftmost point of its circle (θ = π); for a vertical
     one at the topmost (θ = −π/2). A sweep flag of 1 runs clockwise on
     screen, which carries the horizontal coil up and the vertical one right
     — the +1 bulge in both cases. */
  const th0 = h ? Math.PI : -Math.PI / 2;
  for (let i = 0; i < c.n; i++) {
    const cx = h ? c.x0 + c.r + 2 * c.r * i : c.x;
    const cy = h ? c.y : c.y0 + c.r + 2 * c.r * i;
    for (let k = i === 0 ? 0 : 1; k <= CHORDS; k++) {
      const th = th0 + s * Math.PI * (k / CHORDS);
      pts.push([cx + c.r * Math.cos(th), cy + c.r * Math.sin(th)]);
    }
  }
  return pts;
}

/* Which coils a straight segment runs the whole length of. Exported so the
   check can ask the same question about the paths that were NOT spliced. */
export function coilsOnSegment(a, b, coils) {
  const horiz = Math.abs(a[1] - b[1]) < EPS && Math.abs(a[0] - b[0]) > EPS;
  const vert = Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) > EPS;
  if (!horiz && !vert) return [];
  const out = [];
  for (const c of coils) {
    if (horiz && c.axis === "h" && Math.abs(c.y - a[1]) < EPS) {
      const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
      if (c.x0 >= lo - EPS && c.x1 <= hi + EPS) out.push(c);
    } else if (vert && c.axis === "v" && Math.abs(c.x - a[0]) < EPS) {
      const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
      if (c.y0 >= lo - EPS && c.y1 <= hi + EPS) out.push(c);
    }
  }
  return out;
}

const r2 = (v) => {
  const n = Math.round(v * 100) / 100;
  return Object.is(n, -0) ? "0" : String(n);
};

export function coilSplice(d, coils) {
  if (!coils || !coils.length) return d;
  const pts = polyPoints(d);
  if (pts.length < 2) return d;
  const out = [pts[0]];
  let touched = false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const hits = coilsOnSegment(a, b, coils);
    if (!hits.length) { out.push(b); continue; }
    const horiz = Math.abs(a[1] - b[1]) < EPS;
    /* Walk them in the order the current meets them, not in registry order:
       a segment may cross two coils, and emitting the far one first would
       fold the path back on itself. */
    const mid = (c) => (horiz ? c.x0 + c.x1 : c.y0 + c.y1) / 2;
    const fwd = horiz ? b[0] > a[0] : b[1] > a[1];
    hits.sort((p, q) => (fwd ? mid(p) - mid(q) : mid(q) - mid(p)));
    for (const c of hits) {
      const cp = coilPoints(c);
      if (!fwd) cp.reverse();
      /* The straight lead-in to the terminal, then the winding itself. A
         zero-length lead-in (the segment starting on the terminal) is
         dropped by polySegs, so it costs nothing to always emit it. */
      for (const q of cp) out.push(q);
    }
    out.push(b);
    touched = true;
  }
  if (!touched) return d;
  return `M ${r2(out[0][0])} ${r2(out[0][1])} L`
    + out.slice(1).map((q) => ` ${r2(q[0])} ${r2(q[1])}`).join("");
}

/* Distance from a point to a measured path — what the polarity-disc
   clearance check is written in terms of. */
export function distToPath(px, py, { segs }) {
  let best = Infinity;
  for (const g of segs) {
    const t = clamp((px - g.x) * g.dx + (py - g.y) * g.dy, 0, g.len);
    best = Math.min(best, Math.hypot(px - (g.x + g.dx * t), py - (g.y + g.dy * t)));
  }
  return best;
}
