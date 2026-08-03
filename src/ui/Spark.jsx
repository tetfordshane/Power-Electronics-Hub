import React from "react";

/* One cycle, at a glance.

   The design output is a column of numbers, and a number cannot show you that
   the current touches zero before the period ends, or that the ripple is a
   parabola rather than a triangle, or that the input capacitor's current is a
   pulse train and not a wave. The waveform pane below can show all of that,
   but it is a full instrument — three cycles, real axes, reference lines —
   and a reader scanning the results for the shape of the thing has to stop
   reading and start studying.

   So: the same polylines the pane draws, at the size of a word. No axes, no
   ticks, no legend. These are not plots to read values off; they are the
   shape of the quantity named beside them, and every one of them comes from
   the same CycleView the figure and the pane use, so it cannot disagree with
   either.

   Deliberately NOT wrapped in `.sch` — that class paints the 22px dotted
   grid, which at this size is a texture rather than a grid and fights the
   trace it sits behind.                                                    */

const W = 118, H = 30, PAD = 3;

/* Accepts either of the two point shapes the cycle model emits: the current
   polylines carry `i`, the voltage series carry `v`. */
const yOf = (p) => (p.v !== undefined ? p.v : p.i);

function Spark({ pts, col = "#E0A458", label, title }) {
  if (!pts || pts.length < 2) return null;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const y = yOf(p);
    if (!Number.isFinite(y)) continue;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  /* A flat trace has no range to scale to. Give it one, so it draws as a line
     through the middle rather than dividing by zero into the top edge. */
  if (hi - lo < 1e-12) { hi = lo + 1; lo -= 1; }

  const X = (u) => PAD + u * (W - 2 * PAD);
  const Y = (y) => H - PAD - ((y - lo) / (hi - lo)) * (H - 2 * PAD);

  let d = "";
  for (const p of pts) {
    const y = yOf(p);
    if (!Number.isFinite(y)) continue;
    d += (d ? " L " : "M ") + X(p.u).toFixed(1) + " " + Y(y).toFixed(1);
  }

  /* The zero line is drawn only when the trace crosses it — that is the whole
     point of showing it. A ripple sitting entirely above zero gets no rule,
     because a rule at the bottom of the box says nothing a reader needs. */
  const showZero = lo < 0 && hi > 0;

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H}
      role="img" aria-label={label}>
      {title ? <title>{title}</title> : null}
      {showZero ? (
        <path d={`M ${PAD} ${Y(0).toFixed(1)} H ${(W - PAD).toFixed(1)}`}
          stroke="#2C3D50" strokeWidth={1} fill="none" />
      ) : null}
      <path d={d} stroke={col} strokeWidth={1.5} fill="none"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export { Spark };
