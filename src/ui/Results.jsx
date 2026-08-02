import React from "react";
import { Mx, Mixed } from "../tex.jsx";
import { isDCM } from "../cycle.js";
import { swPeriod } from "../fields.js";
import { Wave, LineChart } from "./Wave.jsx";
import { LossBar } from "./LossBar.jsx";

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

export { Results };
