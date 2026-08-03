import React from "react";
import { Mx, Mixed } from "../tex.jsx";
import { isDCM } from "../cycle.js";
import { swPeriod, SEV, W, warns } from "../fields.js";
import { Wave, LineChart } from "./Wave.jsx";
import { LossBar } from "./LossBar.jsx";
import { Spark } from "./Spark.jsx";
import { eng, f2, pct } from "../format.js";
import { readEta, outPower } from "./HeatCard.jsx";

/* What can honestly be said about two designs of DIFFERENT topologies.

   Result rows are pre-formatted strings and their labels only line up within
   one topology, so a row-by-row diff across topologies would be inventing
   correspondences that do not exist. Three things are genuinely comparable
   because they are real numbers in a shared unit: the watts lost, the
   efficiency, and how many warnings are not merely notes. Read through the
   same helpers the design-space map uses, so "efficiency" means one thing on
   this page. */
function summarise(res, spec) {
  if (!res || res.error || res.infeasible) return null;
  /* outPower ignores its first argument — it reads the result and the spec. */
  const m = readEta(res, outPower(null, spec, res));
  const loss = (res.loss || []).reduce((a, b) => a + (isFinite(b[1]) && b[1] > 0 ? b[1] : 0), 0);
  return {
    loss: loss > 0 ? loss : (m ? m.loss : null),
    eta: m ? m.eta : null,
    flags: (res.warn || []).filter((w) => w && w.s !== "note").length,
  };
}

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

function Results({ res, spec, hideWave, sim, cyc, hot, onHot, tid, pin, onPin, onUnpin }) {
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
  /* A pin of the SAME topology can be compared row by row, because both sides
     came out of the same design function and the labels line up by
     construction. A pin of a different one gets the summary only. */
  const sameTopo = !!(pin && pin.tid === tid);
  const pinHi = sameTopo ? (pin.res.hi || []) : [];
  const pinRow = (gi, ri) => {
    const g = sameTopo ? (pin.res.groups || [])[gi] : null;
    const r = g && (g.rows || [])[ri];
    return r ? r[1] : null;
  };
  const now = pin ? summarise(res, spec) : null;
  const then = pin ? summarise(pin.res, pin.spec) : null;
  /* Null when nothing moved. Saying "no change" against every figure the
     instant a design is pinned is noise standing where a signal will be. */
  const delta = (a, b, unit) => {
    if (a == null || b == null) return null;
    const d = a - b;
    if (Math.abs(d) < Math.abs(b) * 1e-6) return null;
    return (d > 0 ? "+" : "−") + eng(Math.abs(d), unit);
  };
  return (
    <div>
      {/* Pin a design and the panel starts answering "compared with what".
          The comparison is against a SNAPSHOT — the numbers as they were when
          it was pinned — so editing the bench moves one side and not the
          other, which is the whole point. */}
      <div className="pinbar">
        {pin ? (
          <>
            <span className="pinwhat">
              vs <b>{pin.name}</b>
              {sameTopo ? "" : " · different topology, so only the totals compare"}
            </span>
            {now && then ? (
              <span className="pinsum">
                {then.loss != null ? <span>{eng(then.loss, "W")} lost
                  {delta(now.loss, then.loss, "W") ? <em> ({delta(now.loss, then.loss, "W")})</em> : null}
                </span> : null}
                {then.eta != null ? <span>η {pct(then.eta)}
                  {now.eta != null && pct(now.eta) !== pct(then.eta)
                    ? <em> (now {pct(now.eta)})</em> : null}
                </span> : null}
                <span>{then.flags} to check{now.flags !== then.flags ? <em> (now {now.flags})</em> : null}</span>
              </span>
            ) : null}
            {pin.link ? <a className="pinlink" href={pin.link}>link to it</a> : null}
            <button className="ritem pinbtn" onClick={onUnpin}>Unpin</button>
          </>
        ) : (
          <button className="ritem pinbtn" onClick={onPin}
            disabled={!!res.infeasible}>Pin this design to compare</button>
        )}
      </div>
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
        {hi.map(([k, v], i) => {
          const was = pinHi[i] && pinHi[i][0] === k ? pinHi[i][1] : null;
          return (
            <div className={"stat" + (was != null && was !== v ? " moved" : "")} key={i}>
              <span className="eyebrow"><Mx t={k} /></span>
              <div className={"big " + ["cu", "cy", "gn"][i % 3]}>{v}</div>
              {was != null && was !== v ? <div className="waspin">was {was}</div> : null}
            </div>
          );
        })}
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
      {/* The loss bar is where the comparison is most honest, because its
          numbers are real watts rather than formatted strings. */}
      <LossBar items={res.loss} hot={hot} onHot={onHot}
        was={sameTopo ? pin.res.loss : null} />
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
              {g.rows.map((r, j) => {
                /* String comparison, not a numeric one: these values are
                   already formatted, and re-parsing them to invent a delta
                   would be a second, quieter model of what they mean. */
                const was = sameTopo ? pinRow(i, j) : null;
                const moved = was != null && was !== r[1];
                return (
                  <tr key={j} className={moved ? "moved" : undefined}>
                    {/* The note belongs under the LABEL, left-aligned. Hanging it
                        right-aligned under the value left every row ragged and
                        made the numbers impossible to scan down. */}
                    <td className="k">
                      <Mx t={r[0]} />
                      {r[2] ? <div className="n"><Mx t={r[2]} /></div> : null}
                    </td>
                    <td className="v"><Mx t={r[1]} /></td>
                    {sameTopo ? (
                      <td className="wasv">{moved ? <Mx t={was} /> : <span className="same">·</span>}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody></table>
          </div>
        ))}
      </div>
    </div>
  );
}

export { Results };
