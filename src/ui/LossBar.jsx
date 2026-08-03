import React from "react";
import { Mx, Mixed } from "../tex.jsx";
import { eng, pct } from "../format.js";

/* stacked bar showing where the watts actually go */
const LCOL = ["#E0A458", "#5AD1DE", "#F0796C", "#6FD39B", "#A88BF0", "#8DA0B4"];

/* A loss may name the device it heats. Normalise to an array so a mechanism
   shared by two parts — gate drive across both FETs of a synchronous pair —
   is the same shape as one that heats a single device. */
const devsOf = (it) => (it[3] === undefined ? [] : Array.isArray(it[3]) ? it[3] : [it[3]]);

/* `onHot` lifts the highlight to App, because the bar and the schematic live
   in different cards. Null means nothing is singled out.

   The isolation is the point: the bar answers "where do the watts go" and
   the figure answers "which part is that", and a reader had to hold the two
   together from memory. */
function LossBar({ items, onHot, hot, was }) {
  const list = (items || []).filter((x) => isFinite(x[1]) && x[1] > 0);
  const tot = list.reduce((a, b) => a + b[1], 0);
  if (!(tot > 0)) return null;
  /* The pinned design's watts, by mechanism label. Matching on the label is
     safe here because both sides came out of the same design function — this
     only ever runs when the pinned topology is the current one. */
  const before = new Map((was || []).map((x) => [x[0], x[1]]));
  const wasTot = (was || []).reduce((a, b) => a + (isFinite(b[1]) && b[1] > 0 ? b[1] : 0), 0);
  const dOf = (label, now) => {
    if (!before.has(label)) return null;
    const d = now - before.get(label);
    return Math.abs(d) < 1e-9 ? null : (d > 0 ? "+" : "−") + eng(Math.abs(d), "W");
  };
  /* Colour is keyed off position in the FILTERED list, so the bar and its
     legend agree; anything comparing indices has to use the same list. */
  const isHot = (i) => hot != null && hot.i === i;
  const dim = hot != null;
  const enter = (i, it) => () => onHot && onHot({ i, devs: devsOf(it) });
  const leave = () => onHot && onHot(null);
  return (
    <div style={{ marginBottom: 16 }}>
      <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
        Loss breakdown · {eng(tot, "W")} total
        {wasTot > 0 && Math.abs(tot - wasTot) > 1e-9 ? (
          <em className="ldelta"> · was {eng(wasTot, "W")}
            {" ("}{tot > wasTot ? "+" : "−"}{eng(Math.abs(tot - wasTot), "W")}{")"}</em>
        ) : null}
      </span>
      <div className="lbar" role="img" aria-label={"Loss breakdown, " + eng(tot, "W")
        + " total: " + list.map((it) => it[0] + " " + pct(it[1] / tot)).join(", ")}>
        {list.map((it, i) => (
          <div key={i} className={"lseg" + (dim && !isHot(i) ? " dim" : "")}
            style={{ width: (100 * it[1] / tot) + "%", background: LCOL[i % 6] }}
            onMouseEnter={enter(i, it)} onMouseLeave={leave} />
        ))}
      </div>
      <div className="lleg">
        {list.map((it, i) => {
          const devs = devsOf(it);
          return (
            <span key={i} className={"lit" + (isHot(i) ? " hot" : "") + (dim && !isHot(i) ? " dim" : "")}
              tabIndex={0}
              aria-label={it[0] + ", " + eng(it[1], "W") + ", " + pct(it[1] / tot) + " of the total"
                + (devs.length ? " — highlights " + devs.join(" and ") + " on the circuit" : "")}
              onMouseEnter={enter(i, it)} onMouseLeave={leave}
              onFocus={enter(i, it)} onBlur={leave}>
              <i style={{ background: LCOL[i % 6] }} />
              <b><Mx t={it[0]} /></b> {eng(it[1], "W")} · {pct(it[1] / tot)}
              {dOf(it[0], it[1]) ? <span className="ldelta">{dOf(it[0], it[1])}</span> : null}
              {it[2] ? <em><Mx t={it[2]} /></em> : null}
            </span>
          );
        })}
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
