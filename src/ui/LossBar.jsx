import React from "react";
import { Mx, Mixed } from "../tex.jsx";
import { eng, pct } from "../format.js";

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

export { LCOL, LossBar };
