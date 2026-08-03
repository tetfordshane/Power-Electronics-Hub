import React from "react";
import { Mx, Mixed } from "../tex.jsx";
import { isDCM } from "../cycle.js";
import { swPeriod, SEV, W, warns } from "../fields.js";
import { Wave, LineChart } from "./Wave.jsx";
import { LossBar } from "./LossBar.jsx";
import { Spark } from "./Spark.jsx";
import { eng, f2 } from "../format.js";

/* How each tier presents itself, in one place.

   `stop` is the red the whole page reserves for "this will not work".
   `check` keeps the copper the warnings have always used — it is the tier
   almost every existing warning belongs to. `note` borrows the neutral cyan
   the spectrum card already uses for a standing fact.

   `measured` is not here: it belongs to the simulator, is emitted below
   rather than by a design function, and the README is explicit that it is
   not the warning red. */
const SEVR = {
  stop: { cls: "warn stop", tag: "stop" },
  check: { cls: "warn", tag: "check" },
  note: { cls: "note", tag: "note" },
};

/* The shapes worth seeing without leaving the numbers.

   Each entry is the same polyline the waveform pane plots, at the size of a
   word, with the one figure that names it. Built from the CycleView the
   figure uses, so a topology gets whichever of these its own cycle actually
   has — a converter with no output-capacitor model simply shows two. */
function glanceRows(cyc, wv) {
  const rows = [];
  if (cyc.pts && cyc.pts.length > 1) {
    rows.push({
      k: (wv && wv.ilabel) || "i_L", col: "#E0A458", pts: cyc.pts,
      v: eng(cyc.iValley, "A") + " → " + eng(cyc.iPeak, "A"),
      /* The one thing the shape says that the numbers above it do not. */
      note: cyc.mode === "dcm" ? "reaches zero" : "continuous",
      label: "Inductor current over one switching cycle, from "
        + eng(cyc.iValley, "A") + " to " + eng(cyc.iPeak, "A")
        + (cyc.mode === "dcm" ? ", falling to zero before the period ends" : ""),
    });
  }
  if (cyc.cap && cyc.cap.iC && cyc.cap.vTot) {
    rows.push({
      k: "ΔV_out", col: "#5AD1DE",
      pts: cyc.cap.iC.map((p, i) => ({ u: p.u, v: cyc.cap.vTot[i] })),
      v: eng(cyc.cap.vPP, "V") + " p-p", note: "ripple on V_out",
      label: "Output ripple voltage over one cycle, "
        + eng(cyc.cap.vPP, "V") + " peak to peak",
    });
  }
  if (cyc.inCap && cyc.inCap.pts && cyc.inCap.pts.length > 1) {
    rows.push({
      k: "i_Cin", col: "#A88BF0", pts: cyc.inCap.pts,
      v: eng(cyc.inCap.ipk, "A") + " peak", note: "input cap current",
      label: "Input capacitor current over one cycle, peaking at "
        + eng(cyc.inCap.ipk, "A"),
    });
  }
  return rows;
}

function Results({ res, spec, hideWave, sim, cyc, hot, onHot }) {
  if (!res) return <p>This topology has no calculator yet — the equations and trade-offs below still apply.</p>;
  if (res.error) {
    return (
      <div className="warn stop">
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
        <div className="warn stop">
          <b>This operating point is outside the topology.</b> There is nothing to size, because
          no set of components produces this conversion ratio. The reason is below.
        </div>
      ) : null}
      {allBlank || negative ? (
        <div className="warn stop">
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
      {/* The shape of the cycle, beside the numbers that describe it. A
          reader scanning the results for "does the current reach zero" had to
          stop reading and study the full pane below to find out. */}
      {cyc ? (() => {
        const rows = glanceRows(cyc, res.wave);
        if (!rows.length) return null;
        return (
          <div className="sparks">
            {rows.map((r) => (
              <div className="sprow" key={r.k}>
                <span className="eyebrow"><Mx t={r.k} /></span>
                <Spark pts={r.pts} col={r.col} label={r.label} />
                <b><Mx t={r.v} /></b>
                <em><Mx t={r.note} /></em>
              </div>
            ))}
          </div>
        );
      })() : null}
      {/* One list, one renderer, so a tier cannot come to be styled two ways.
          The DCM warning is said once here, for every topology, from the same
          test the drawing uses — a converter in discontinuous conduction is
          not described by any of the ratios above it, and thirty design
          functions each remembering to mention that is thirty chances to
          forget.

          Sorted by tier, because a stop underneath two notes is a stop the
          reader finds last. Within a tier the author's order survives. */}
      {(() => {
        const all = warns(
          W("check", isDCM(res.wave) && "At this load the current falls to zero before the "
            + "period ends — discontinuous conduction. The conversion ratio, the ripple and the C_out "
            + "sizing above all assume it never does, so treat them as upper bounds here: the real "
            + "output voltage rises above them as the load falls further."),
          ...(res.warn || [])
        );
        return all
          .map((w, i) => ({ w, i }))
          .sort((a, b) => (SEV.indexOf(a.w.s) - SEV.indexOf(b.w.s)) || (a.i - b.i))
          .map(({ w, i }) => {
            const t = SEVR[w.s] || SEVR.check;
            return <div className={t.cls} key={i}><b>{t.tag} ·</b> <Mx t={w.m} /></div>;
          });
      })()}
      {/* What the simulation found, which the design equations cannot find
          out about themselves.

          C_out is sized from the IDEAL ripple current. The real one is
          larger — the catch diode's forward drop steepens the discharge, and
          a core that softens under load widens the ramp further — so a
          capacitor chosen for 30 mV can deliver 37. The equation above is
          not wrong; it is answering a question about an ideal inductor, and
          this is the same question asked of the circuit. */}
      {sim && sim.over ? (
        <div className="warn measured">
          <b>measured ·</b>{" "}
          <Mx t={"Simulated at " + eng(sim.charge, "V") + " peak-to-peak from the charge alone, "
            + "against the " + eng(sim.budget, "V") + " C_out was sized for — " + f2(sim.ratio)
            + "× the budget. The sizing formula uses the ideal ripple current; the circuit's is "
            + (Number.isFinite(sim.dIideal) && sim.dIideal > 0
              ? eng(sim.dI, "A") + " against an ideal " + eng(sim.dIideal, "A") + ", "
              : "larger, ")
            + "because the rectifier's forward drop steepens the discharge and the core softens "
            + "as it loads. Raise C_out, lower the ripple, or accept the larger figure."} />
        </div>
      ) : null}
      <LossBar items={res.loss} hot={hot} onHot={onHot} />
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
