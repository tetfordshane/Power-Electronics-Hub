import React, { useState, useEffect } from "react";
import { Mx, Sub } from "../tex.jsx";
import { eng, engAx, clamp, f2 } from "../format.js";
import { Tx, drawScope } from "../schematic/parts.jsx";
import { layoutLabelsX } from "./Wave.jsx";

/* ---- harmonic envelope of a trapezoidal switching waveform ---- */
function Spectrum({ fsw, D, tr, amp }) {
  /* y0 leaves a row above the plot for the unit caption, so the scale can be
     plain numbers instead of hanging its unit off whichever tick had room. */
  const x0 = 54, x1 = 640, y0 = 24, y1 = 166, fmin = 1e4, fmax = 1e8;
  const L = Math.log10(fmax) - Math.log10(fmin);
  const lx = (f) => x0 + ((Math.log10(f) - Math.log10(fmin)) / L) * (x1 - x0);
  const ly = (db) => y1 - (Math.min(Math.max(db, 0), 160) / 160) * (y1 - y0);
  const sinc = (v) => (Math.abs(v) < 1e-9 ? 1 : Math.sin(v) / v);
  const dB = (v) => 20 * Math.log10(Math.max(v, 1e-12) / 1e-6);
  const bars = [];
  let n = 1;
  while (n * fsw <= fmax) {
    const f = n * fsw;
    if (f >= fmin) {
      const c = 2 * amp * D * Math.abs(sinc(n * Math.PI * D)) * Math.abs(sinc(n * Math.PI * tr * fsw));
      bars.push([lx(f), ly(dB(c)), dB(c)]);
    }
    n += n < 60 ? 1 : Math.ceil(n / 30);
  }
  const f1 = fsw / (Math.PI * Math.max(D, 1e-3)), f2 = 1 / (Math.PI * Math.max(tr, 1e-12));
  /* the upper bound the harmonics ride under: flat, then −20, then −40 dB/decade */
  const envAt = (f) => 2 * amp * D
    * Math.min(1, f1 / f) * Math.min(1, f2 / f);
  const envD = (() => {
    let d = "";
    for (let k = 0; k <= 120; k++) {
      const f = fmin * Math.pow(fmax / fmin, k / 120);
      d += (k ? " L " : "M ") + lx(f).toFixed(1) + " " + ly(dB(envAt(f))).toFixed(1);
    }
    return d;
  })();
  /* CISPR 32 class B, conducted, quasi-peak */
  const lim = [[1.5e5, 66], [5e5, 56], [5e6, 56], [5e6, 60], [3e7, 60]];
  const limD = lim.map((q, i) => (i ? "L " : "M ") + lx(q[0]).toFixed(1) + " " + ly(q[1]).toFixed(1)).join(" ");
  const dec = [1e4, 1e5, 1e6, 1e7, 1e8];
  const gl = { stroke: "#22303F", strokeWidth: 1, fill: "none" };

  /* --- annotations, placed so they cannot land on top of each other ---
     The corner markers, the envelope label and the limit label all want
     the same upper-left region. Each is given a preferred anchor, then the
     set is pushed apart vertically and clamped inside the plot.        */
  const anns = [];
  anns.push({ x: clamp(lx(1.1e6), x0 + 4, x1 - 92), y: ly(56) - 8,
    t: "CISPR 32 class B", c: "#F0796C", a: "start" });
  anns.push({ x: x0 + 6, y: clamp(ly(dB(2 * amp * D)) - 9, y0 + 9, y1 - 6),
    t: "envelope", c: "#E0A458", a: "start" });
  [[f1, "1/(πD·T)", "#E0A458"], [f2, "1/(π·t_r)", "#A88BF0"]].forEach((m, i) => {
    if (!(m[0] > fmin && m[0] < fmax)) return;
    /* flip the label to the left of its rule when it would run off the edge */
    const at = lx(m[0]);
    const right = at + 6 + 62 < x1;
    anns.push({ x: right ? at + 6 : at - 6, y: y0 + 11 + i * 13, t: m[1], c: m[2],
      a: right ? "start" : "end", rule: at });
  });
  const ys = layoutLabelsX(anns, 12, y0 + 9, y1 - 4);

  return (
    <div className="sch">
      {/* 700 wide so the last decade label has somewhere to sit. It used to
          be dropped entirely — the plot ends at x = 640 and a centred "100 MHz"
          would have run past a 660 frame, which left the top of the sweep
          unlabelled on the one axis whose whole point is where in frequency
          the noise lands. */}
      <svg viewBox="0 0 700 212" style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label={"Switching-noise envelope: amplitude in dBµV against frequency, with the "
          + "switching fundamental, the edge-rate corner and the roll-off marked"}>
        {drawScope("sp", () => (<>
          {/* The unit, once, above the scale — the same place LineChart puts
              its y caption. It used to ride on the topmost tick as "160 dBµV",
              which made one tick wider than the rest and left a reader
              scanning for the unit if that tick was off screen. */}
          {Tx(x0 - 7, y0 - 12, "dBµV", { c: "#8DA0B4", s: 10.5, a: "start" })}
          {/* Numeric ticks at 9 in the default ink, the same rung of the type
              ladder the waveform panes' scale numbers sit on. */}
          {[0, 40, 80, 120, 160].map((d) => (
            <g key={"h" + d}>
              <path d={`M ${x0} ${ly(d)} H ${x1}`} {...gl} />
              {Tx(x0 - 7, ly(d) + 3.5, String(d), { c: "#8DA0B4", s: 9, a: "end" })}
            </g>
          ))}
          {dec.map((f, i) => (
            <g key={"v" + f}>
              <path d={`M ${lx(f)} ${y0} V ${y1}`} {...gl} />
              {/* the first is pushed right of the y-axis numbers; the last is
                  anchored at its end so it stays inside the frame. engAx, so a
                  decade reads "1 MHz", not "1.00 MHz". */}
              {Tx(lx(f) + (i === 0 ? 2 : 0), y1 + 16, engAx(f, "Hz"),
                { c: "#8DA0B4", s: 9,
                  a: i === 0 ? "start" : i === dec.length - 1 ? "end" : "middle" })}
            </g>
          ))}
          {bars.map((b, i) => (
            <path key={"b" + i} d={`M ${b[0].toFixed(1)} ${y1} V ${b[1].toFixed(1)}`}
              stroke="#5AD1DE" strokeWidth={1.4} opacity={0.75} fill="none" />
          ))}
          <path d={envD} stroke="#E0A458" strokeWidth={1.8} fill="none" opacity={0.95} />
          <path d={limD} stroke="#F0796C" strokeWidth={1.6} fill="none" />
          {anns.map((a, i) => (
            <g key={"a" + i}>
              {a.rule !== undefined ? (
                <path d={`M ${a.rule} ${y0} V ${y1}`} stroke={a.c} strokeWidth={1.2}
                  strokeDasharray="3 3" fill="none" opacity={0.8} />
              ) : null}
              {Tx(a.x, ys[i], a.t, { c: a.c, s: 9.5, a: a.a })}
            </g>
          ))}
          {Tx((x0 + x1) / 2, y1 + 30, "frequency", { c: "#8DA0B4", s: 10.5, a: "middle" })}
        </>))}
      </svg>
    </div>
  );
}

function SpecCard({ topo, spec, res }) {
  const fsw = (spec.fsw || 0) * 1e3;
  const amp0 = spec.vbus || spec.vdc || spec.vinNom || spec.vinMax || spec.vsec || spec.vout || 12;
  const tr0 = spec.tsw || 20;
  /* null means "follow the bench"; a number means the user has taken
     control of this field and edits on the bench must not overwrite it. */
  const [amp, setAmp] = useState(null);
  const [tr, setTr] = useState(null);
  useEffect(() => { setAmp(null); setTr(null); }, [topo.id]);
  if (!(fsw > 0)) return null;
  const ampTxt = amp === null ? String(amp0) : amp;
  const trTxt = tr === null ? String(tr0) : tr;
  const ampN = parseFloat(ampTxt), trN = parseFloat(trTxt);
  const A = Number.isFinite(ampN) && ampN > 0 ? ampN : amp0;
  const T = Number.isFinite(trN) && trN > 0 ? trN : tr0;
  const D = res && res.wave && isFinite(res.wave.D) ? clamp(res.wave.D, 0.02, 0.98) : 0.5;
  const generic = !(res && res.wave && isFinite(res.wave.D));
  const f1 = fsw / (Math.PI * D), fEdge = 1 / (Math.PI * T * 1e-9);
  return (
    <div className="card">
      <h3 className="eyebrow">Spectrum · where the switching energy lands</h3>
      <div className="fields" style={{ marginBottom: 12 }}>
        <div className="fld">
          <label htmlFor="sp_a">switch-node step<span className="u"> V</span></label>
          <input id="sp_a" type="number" step="any" min="0.1" value={ampTxt}
            onChange={(e) => setAmp(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="sp_t">edge rate <Mx t="t_r" /><span className="u"> ns</span></label>
          <input id="sp_t" type="number" step="any" min="0.1" value={trTxt}
            onChange={(e) => setTr(e.target.value)} />
        </div>
        {/* The one field on the page that cannot be typed into, and the only
            explanation of why was a title= — invisible to a keyboard and to a
            screen reader alike. It gets the same popover every field in the
            specification panel already has. */}
        <div className="fld">
          <label htmlFor="sp_d">duty at the switch node</label>
          <input id="sp_d" type="number" readOnly aria-readonly="true" value={D.toFixed(3)}
            aria-describedby="sp_d_help" />
          <div className="fhelp" id="sp_d_help" role="tooltip">
            {generic
              ? "This topology publishes no switching waveform, so a 0.5 duty is assumed."
              : "Read from the design above rather than entered — change the operating point and it follows."}
          </div>
        </div>
      </div>
      {generic ? (
        <div className="note"><b>note ·</b> This topology does not publish a switching waveform,
          so the spectrum below assumes a 50 % duty. The corner set by the edge rate is unaffected;
          the first corner is not.</div>
      ) : null}
      <Spectrum fsw={fsw} D={D} tr={T * 1e-9} amp={A} />
      <div className="grid3" style={{ marginTop: 12 }}>
        <div className="stat"><span className="eyebrow">first corner</span>
          <div className="big cu">{eng(f1, "Hz")}</div></div>
        <div className="stat"><span className="eyebrow">edge corner</span>
          <div className="big vi">{eng(fEdge, "Hz")}</div></div>
        <div className="stat"><span className="eyebrow">rolls off</span>
          <div className="big cy">−40 dB/dec</div></div>
      </div>
      <p className="flownote">
        The envelope is flat to the first corner, falls at 20 dB/decade to the second, then at 40 dB/decade.
        Only the edge rate sets that second corner, which is why slowing the gate drive is the most direct
        lever on high-frequency content — and why it trades directly against switching loss.
        Slew this edge twice as slowly and everything above <Sub t={eng(fEdge, "Hz")} /> drops by 6 dB.
      </p>
      <p className="flownote" style={{ color: "var(--faint)" }}>
        This is the source spectrum of an ideal trapezoid at the switch node, not a measured emission.
        Real conducted levels depend on the filter, the coupling path and the LISN; the class B line is drawn
        for scale only.
      </p>
    </div>
  );
}

export { Spectrum, SpecCard };
