import React from "react";
import { nk } from "../schematic/parts.jsx";

/* The marks drawn over a schematic while it animates: which device is
   conducting, which way the winding is polarised, and the phase note that
   changes underneath them. */
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

const Chevron = (m, i, flip, cls) => (
  <path key={"cv" + i} className={"carrow" + (cls ? " " + cls : "")}
    opacity={m.o === undefined ? 1 : m.o.toFixed(3)}
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

export { isDiode, Swap, Chevron, DevMark, PolMark };
