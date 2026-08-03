import React, { useState, useMemo, useEffect, useRef } from "react";
import { eng, f2, clamp } from "../format.js";
import { Mx, Mixed, Sub } from "../tex.jsx";
import { buildCycle, cycleKey } from "../cycle.js";
import { engineFor, engineKey, simView } from "../engine/adapter.js";
import { runTransient } from "../engine/run.js";
import { TransientStrip } from "./TransientStrip.jsx";
import { polySegs, polyPoints, arrowsAt, coilSplice, coilsOnSegment,
  closeLoop, pointInLoop, splitByLoop } from "../flowgeo.js";
import { SCH } from "../schematic/sch.jsx";
import { COILS, CAPS, CORES, startCapture, endCapture, drawScope, nk } from "../schematic/parts.jsx";
import { FLOW, FAMILY } from "../topologies/index.js";
import { swPeriod } from "../fields.js";
import { usePrefersReducedMotion } from "../hooks.js";
import { WAVE_CYCLES, Wave } from "./Wave.jsx";
import { PlayBar } from "./PlayBar.jsx";
import { isDiode, Swap, Chevron, DevMark, PolMark } from "./marks.jsx";

/* the operation card: the conduction path, animated at the real current.
   Dash offset advances with accumulated charge, so the flow speeds up as
   the inductor charges and slows as it discharges.                       */
function FlowCard({ topo, res, spec }) {
  const period = swPeriod(spec);
  const F = FLOW[topo.id];
  const reduce = usePrefersReducedMotion();
  const [p, setP] = useState(0);
  const [play, setPlay] = useState(true);
  const [spd, setSpd] = useState(1);
  const [lens, setLens] = useState("i");
  /* The load the converter is actually feeding, as a multiple of the
     specified one. Not an input: editing I_out asks design() to re-size the
     inductor for a different load, which is a different converter. Stepping
     it keeps every component and changes what the converter is feeding —
     which is the experiment worth running, and the one a bench supply gets
     put through on its first day. */
  const [loadK, setLoadK] = useState(1);
  const [tr, setTr] = useState(null);       /* the settle in progress */
  const [ti, setTi] = useState(0);          /* which of its periods is drawn */
  const [trPlay, setTrPlay] = useState(false);
  const [trOut, setTrOut] = useState(false); /* dissolving away */
  const lastRun = useRef(null);

  /* `u` runs 0→1 across the whole plotted waveform, not across one period.
     The switching phase is derived from it, so the marker and the circuit
     can never disagree: one clock, one wrap point, at the right-hand edge
     of the plot rather than a third of the way along it. */
  useEffect(() => { setP(0); pRef.current = 0; setLens("i"); }, [topo.id]);
  useEffect(() => { if (reduce) setPlay(false); }, [reduce]);
  /* One period of a settle per drawn period, advanced ON the phase wrap.

     Stepping the transient on its own timer looked simpler and was wrong:
     the index changed in the middle of a drawn cycle, so the dash travel and
     the arrow belt jumped by a whole period's worth wherever the change
     happened to land. Measured, that was arrows appearing at 0.92 opacity
     and moving 15 px in a frame — the pop this figure exists not to have.

     Tying it to the wrap costs a faster clock: a dozen periods at the steady
     rate would take most of a minute. Six times is the compromise — about
     0.6 s a period, which is a couple of seconds of settle and still some
     thirty-five frames per period on a 60 Hz display. Faster looked better
     on paper and was a blur: at twenty-two times there are ten frames in a
     period, and the dashes travel further between frames than the eye can
     follow. The compression is honest either way — the event really is
     microseconds wide, and the strip beside it carries the true time. */
  const pRef = useRef(0);
  const RUSH = 6;
  useEffect(() => {
    if (!play || !F) return undefined;
    let raf, last = 0;
    const step = (now) => {
      if (last) {
        const dt = Math.min((now - last) / 1000, 0.1);
        const rate = 0.28 * spd / WAVE_CYCLES * (tr && trPlay ? RUSH : 1);
        /* The frame is the single writer of the phase.

           Advancing it inside a setP updater and stepping the transient from
           there put a side effect in a state updater: React is free to run
           those twice, and the phase and the period index could land in
           different renders — one frame drawn with the new phase and the old
           cycle, which is a whole period's worth of dash travel in a single
           frame. Both are now derived here and set together. */
        const prev = pRef.current;
        const nv = (prev + dt * rate) % 1;
        pRef.current = nv;
        setP(nv);
        if (tr && trPlay && Math.floor(nv * WAVE_CYCLES) !== Math.floor(prev * WAVE_CYCLES)) {
          setTi((k) => {
            if (k + 1 >= tr.schedule.length) { setTrPlay(false); return k; }
            return k + 1;
          });
        }
      }
      last = now; raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [play, spd, F, topo.id, tr, trPlay]);

  /* The schematic underneath never changes while the animation runs, so it
     is built once per topology and kept out of the per-frame path. The draw
     is also when the inductors record themselves into COILS — the flow
     overlay routes its dashes over those windings, and taking the extents
     from the drawing itself is what keeps the two from drifting apart. */
  const sch = useMemo(
    () => drawScope("sc", () => {
      if (!SCH[topo.sch]) return null;
      startCapture(topo.sch);
      try {
        return React.cloneElement(SCH[topo.sch](), { label: topo.name + " schematic" });
      } finally { endCapture(); }
    }),
    [topo.sch, topo.name]
  );
  const wv = res && res.wave ? res.wave : null;
  /* Where a topology has no design-derived waveform but does supply its own
     current shape, plot that instead of leaving the figure with nothing under
     it. A shape cannot carry amps or a duty, so the pane it gets is a bare
     one — the current alone, scaled to its own peak. Fourteen topologies had
     a moving schematic and no waveform at all before this. */
  const bare = !wv && F.iShape
    ? { bare: true, iShape: F.iShape, D: F.bareD || 0.5, ilabel: F.ilabel || "i" }
    : null;

  /* The cycle every surface in this card reads — not a second implementation
     of it. The flow used to run its own 240-point quadrature over its own
     idea of the current shape, which is how the dashes came to keep flowing
     through a flyback's off-time, when no primary current exists.

     Where a topology has a circuit, this is a simulated switching period —
     converged from the netlist, with the conduction pattern worked out by
     the solver rather than authored. Where it does not, it is exactly the
     closed-form cycle it always was. Both answer the same questions, so
     nothing below here needs to know which it got.

     Keyed on the operating point, not on the wave object, whose identity
     changes on every render — running a converter to steady state sixty
     times a second would be a poor use of the frame. */
  /* The load step changes the sources the circuit sees and nothing else: the
     design result is passed through untouched, so L and C_out stay exactly
     as sized and only the load resistance moves. */
  const effSpec = useMemo(
    () => (loadK === 1 || !spec || !spec.iout ? spec : { ...spec, iout: spec.iout * loadK }),
    [spec, loadK]
  );
  const engine = useMemo(
    () => (F ? engineFor(topo, effSpec, res) : null),
    [F, topo.id, engineKey(topo, effSpec), cycleKey(wv, F && F.iShape)]
  );
  const steady = useMemo(() => (engine ? engine.cycle() : null), [engine]);
  /* While a settle is playing, the figure draws a period out of it — a
     full-resolution cycle re-solved from the state the converter was
     actually in at that moment, not an interpolation between two steady
     states. Everything downstream reads it the same way. */
  const M = useMemo(() => {
    if (!tr || !steady) return steady;
    try { return simView(steady, tr.at(ti)); } catch { return steady; }
  }, [tr, ti, steady]);

  /* One axis for the whole settle, taken from the envelope rather than from
     whichever period is on screen. Padded the same way the per-cycle axis
     is, so nothing changes visually when the strip retires and the pane goes
     back to scaling itself. */
  const trSpan = useMemo(() => {
    if (!tr || !tr.env.length) return null;
    let lo = Infinity, hi = -Infinity;
    for (const e of tr.env) { if (e.iMin < lo) lo = e.iMin; if (e.iMax > hi) hi = e.iMax; }
    return [Math.min(lo * 1.18, 0), Math.max(hi * 1.18, 1e-9)];
  }, [tr]);

  /* Remember the converged state, so the next step starts from where this
     converter actually is rather than from a fresh solve. */
  useEffect(() => {
    if (engine && engine.run) lastRun.current = engine.run;
  }, [engine]);

  /* Reset the experiment when the topology or the design underneath changes:
     a settle recorded for one converter says nothing about another. */
  useEffect(() => { setLoadK(1); setTr(null); setTrPlay(false); setTrOut(false); }, [topo.id]);

  /* Play the settle through once, then let it dissolve and leave the steady
     figure behind. Reduced motion skips straight to the end — the same thing
     the strip would have arrived at, without the journey. */
  /* Reduced motion, or a paused figure: there is no wrap coming to advance
     on, so resolve straight to the settled cycle. */
  useEffect(() => {
    if (!tr || !trPlay) return undefined;
    if (reduce || !play) { setTi(tr.schedule.length - 1); setTrPlay(false); }
    return undefined;
  }, [tr, trPlay, reduce, play]);

  /* Once it has settled and been looked at, retire the strip. */
  useEffect(() => {
    if (!tr || trPlay || trOut) return undefined;
    if (ti < tr.schedule.length - 1) return undefined;
    const a = setTimeout(() => setTrOut(true), 1400);
    const b = setTimeout(() => { setTr(null); setTrOut(false); }, 1900);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [tr, trPlay, trOut, ti]);

  const stepLoad = (k) => {
    if (k === loadK) return;
    const from = lastRun.current;
    setTrOut(false);
    const next = from ? runTransient(topo, { ...spec, iout: spec.iout * k }, res, from) : null;
    setLoadK(k);
    if (next) { setTr(next); setTi(0); setTrPlay(true); }
    else { setTr(null); setTrPlay(false); }
  };

  if (!F || !M) return null;
  const D = M.D;
  /* p sweeps the whole plot; tPer is the position inside the current
     switching period, which is what every circuit-state calculation wants. */
  const tPer = (p * WAVE_CYCLES) % 1;
  /* The overlay animates the CONDUCTING path, so it reads the flow current,
     which for a pulse topology is not the plotted trace. See cycle.js. */
  const iNow = M.flowAt(tPer);
  /* Peak drives stroke weight and opacity, so it must never be zero — an
     idle topology would divide the whole overlay away. */
  const iPk = M.flowPk > 1e-9 ? M.flowPk : 1;
  /* Travel, not position within a period.

     240 units is one period of charge, and in steady state the wrap is
     invisible by construction — the arrow spacing divides it, so every mark
     lands in another's slot. Across a settle it is not, because consecutive
     drawn periods carry different shapes: resetting to zero at each seam
     moves the whole belt. Accumulating the periods already shown keeps the
     dashes travelling forwards through the transient, and reduces to exactly
     the old expression when there is no transient to accumulate. */
  const flowOff = -((tr ? ti : 0) + M.qFlowAt(tPer) / (M.flowTot || 1)) * 240;

  /* Phase lookup. Some topologies define windows that do not tile the
     cycle (a rectifier conducts for a slice and idles for the rest), so
     falling outside every window has to resolve to the last phase that
     started rather than sticking on whatever was previously showing. */
  const bounds = F.ph.map((q, k) =>
    (q.f ? q.f(D) : [k / F.ph.length, (k + 1) / F.ph.length]));
  let idx = 0;
  for (let k = 0; k < bounds.length; k++) {
    if (tPer >= bounds[k][0] && tPer < bounds[k][1]) { idx = k; break; }
    if (tPer >= bounds[k][0]) idx = k;
  }
  const ph = F.ph[idx];
  const band = ph.f ? ph.f(D) : null;
  /* Stepping to a phase parks the marker in the middle of that phase in the
     FIRST drawn period, so the highlighted band and the marker agree. */
  const jump = (k) => {
    const b = F.ph[k].f ? F.ph[k].f(D) : [0, 1];
    const at = ((b[0] + b[1]) / 2) / WAVE_CYCLES;
    setPlay(false); setP(at); pRef.current = at;
  };
  const rising = M.flowAt(Math.min(tPer + 0.01, 0.999)) > iNow;

  /* Inductor polarity, from the slope of the trace the reader can see.

     Only where the topology has a real `wave` spec: without one buildCycle
     falls back to a placeholder triangle, and marking a placeholder's polarity
     would be asserting something about the circuit that nothing computed.
     Where the current genuinely sits still — the dead interval of a
     discontinuous cycle — v_L is zero and neither terminal is positive, so the
     pair fades rather than picking a side. */
  const slope = wv ? M.slopeAt(tPer) : 0;
  const pol = F.pol && wv
    ? { plus: slope > 0 ? 1 : 0,
      live: Math.abs(slope) < (M.iPeak - M.iValley) * 0.02 ? 0.2 : 1 }
    : null;

  const devs = (F.sw || []).map((q, j) => ({
    label: q[2], on: ph.on ? !!ph.on[j] : false, diode: isDiode(q[2]),
  }));
  /* Every phase's drawable geometry at once: the authored polylines spliced
     through the windings they cross (coilSplice — so the dashes climb the
     coils instead of sliding under them on the chord), then measured. All
     phases together rather than the active one, because a commutation needs
     two phases' geometry in the same frame to cross-fade between them. */
  const phGeo = useMemo(() => {
    const coils = COILS[topo.sch] || [];
    return F.ph.map((q) => {
      const d = (q.d || []).map((s) => coilSplice(s, coils));
      /* Which windings this phase's routes actually climb — the fields lens
         lights a coil's field only where the figure itself claims a current.
         Conducting and dim routes are kept apart: a coil on the conducting
         path carries the modelled flow current, but a coil on a dim branch
         (an idle interleaved leg, a resonant tank) carries a current nothing
         here computed — it gets presence, not a waveform. */
      const scan = (list) => {
        const hit = new Set();
        for (const raw of list || []) {
          const pts = polyPoints(raw);
          for (let i = 1; i < pts.length; i++) {
            for (const c of coilsOnSegment(pts[i - 1], pts[i], coils)) {
              hit.add(coils.indexOf(c));
            }
          }
        }
        return hit;
      };
      return {
        d,
        dim: (q.dim || []).map((s) => coilSplice(s, coils)),
        geo: d.map(polySegs),
        hitD: scan(q.d), hitM: scan(q.dim),
      };
    });
  }, [F, topo.sch]);

  /* ---- fields-lens geometry, from the registries the schematic filled ----

     Positions only — everything an ellipse or a stroke needs that does not
     change with time. Sits after the `sch` memo on purpose: the registries
     are populated as a side effect of that draw. */
  const fieldGeo = useMemo(() => {
    const coils = COILS[topo.sch] || [];
    const caps = CAPS[topo.sch] || [];
    const cores = CORES[topo.sch] || [];
    /* the pol-marked coil is the one whose current the waveform plots */
    let polCoil = -1;
    if (F.pol) {
      const mx = (F.pol[0] + F.pol[2]) / 2, my = (F.pol[1] + F.pol[3]) / 2;
      let best = Infinity;
      coils.forEach((c, ci) => {
        const cx = c.axis === "h" ? (c.x0 + c.x1) / 2 : c.x;
        const cy = c.axis === "h" ? c.y : (c.y0 + c.y1) / 2;
        const d = Math.hypot(cx - mx, cy - my);
        if (d < best) { best = d; polCoil = ci; }
      });
    }
    const coilG = coils.map((c) => {
      const h = c.axis === "h";
      const cx = h ? (c.x0 + c.x1) / 2 : c.x;
      const cy = h ? c.y : (c.y0 + c.y1) / 2;
      const half = h ? (c.x1 - c.x0) / 2 : (c.y1 - c.y0) / 2;
      const e1 = h ? { rx: half + 4, ry: c.r + 4 } : { rx: c.r + 4, ry: half + 4 };
      const e2 = h ? { rx: half + 11, ry: c.r + 9 } : { rx: c.r + 9, ry: half + 11 };
      /* one chevron on each ellipse, on opposite crests, so the pair reads
         as circulation; both flip together when the current reverses */
      const ch = h
        ? [{ x: cx, y: cy - e1.ry, a: 0 }, { x: cx, y: cy + e2.ry, a: 180 }]
        : [{ x: cx + e1.rx, y: cy, a: 90 }, { x: cx - e2.rx, y: cy, a: 270 }];
      return { cx, cy, e1, e2, ch };
    });
    /* Capacitors: three field strokes in the plate gap. A cap joined to a
       capFlow branch is a modelled one — its field breathes on the charge
       integral, and its + plate is the plate that branch's path meets
       first (the rail side, for every in/out cap drawn). The rest get
       presence at a fixed faint opacity and no direction: their bias
       polarity is exactly the subtle thing nothing here computed. */
    const capG = caps.map((cp) => {
      const v = cp.axis === "v";
      const px = v ? cp.x : cp.m, py = v ? cp.m : cp.y;
      const strokes = [-6, 0, 6].map((o) => (v
        ? `M ${px + o} ${py - 2.5} V ${py + 2.5}`
        : `M ${px - 2.5} ${py + o} H ${px + 2.5}`));
      let flow = -1, dir = 1;
      (F.capFlow || []).forEach((g, j) => {
        const pts = polyPoints(g.d);
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const on = v
            ? Math.abs(a[0] - px) < 1e-6 && Math.abs(b[0] - px) < 1e-6
              && py >= Math.min(a[1], b[1]) - 1e-6 && py <= Math.max(a[1], b[1]) + 1e-6
            : Math.abs(a[1] - py) < 1e-6 && Math.abs(b[1] - py) < 1e-6
              && px >= Math.min(a[0], b[0]) - 1e-6 && px <= Math.max(a[0], b[0]) + 1e-6;
          if (on) { flow = j; dir = (v ? b[1] - a[1] : b[0] - a[0]) > 0 ? 1 : -1; return; }
        }
      });
      const a = v ? (dir > 0 ? 90 : 270) : (dir > 0 ? 0 : 180);
      return { strokes, ch: { x: px, y: py, a }, flow };
    });
    /* Transformer cores: a flux racetrack around the bars. */
    const coreG = cores.map((c) => ({
      cx: c.x, cy: (c.y0 + c.y1) / 2, rx: 7, ry: (c.y1 - c.y0) / 2 + 9,
    }));
    return { coilG, capG, coreG, polCoil };
  }, [F, topo.sch]);

  /* ---- EMC-lens geometry: every phase route, cut at the hot loop ----

     The cut runs on the RAW polylines and each piece is spliced afterwards,
     so a winding sitting on the loop boundary stays one piece instead of a
     hot/cold zigzag one chord at a time. `s0` is where the piece starts in
     its parent's arc length: adding it to the parent's dash offset keeps
     the dash train continuous across the cut. */
  const emcGeo = useMemo(() => {
    if (!F.emc) return null;
    const coils = COILS[topo.sch] || [];
    const loop = closeLoop(F.emc.loop);
    return {
      loop,
      ph: F.ph.map((q) => (q.d || []).map((raw) => {
        let s0 = 0;
        return splitByLoop(raw, loop).map((p) => {
          const d = coilSplice(p.d, coils);
          const geo = polySegs(d);
          const piece = { d, geo, s0, inside: p.inside };
          s0 += geo.total;
          return piece;
        });
      })),
    };
  }, [F, topo.sch]);

  /* ---- commutation cross-fade ----

     A phase change used to swap every path's `d` in a single frame, so at
     each commutation whole branches teleported — the one remaining pop in a
     figure where everything else dissolves. Instead, inside a short window
     around each phase boundary, both phases render at once: the outgoing
     route fades down as the incoming one fades up.

     The window is clamped to a fraction of the adjacent phases' widths so
     the psfb's 4 %-wide ZVS slivers are not all fade, and the opacities are
     computed here, per frame, never CSS-transitioned — the same rule as the
     rest of the overlay (see styles.js), and it means scrubbing shows the
     fade deterministically instead of only while playing. */
  const starts = bounds.map((b) => b[0]);
  const phaseAt = (t) => {
    t = ((t % 1) + 1) % 1;
    let ix = 0;
    for (let k = 0; k < bounds.length; k++) {
      if (t >= bounds[k][0] && t < bounds[k][1]) { ix = k; break; }
      if (t >= bounds[k][0]) ix = k;
    }
    return ix;
  };
  /* Nearest boundary, cyclically, so the wrap at t = 0 fades like any other. */
  let nearK = 0, nearD = Infinity;
  for (let k = 0; k < starts.length; k++) {
    let dd = tPer - starts[k];
    dd -= Math.round(dd);
    if (Math.abs(dd) < Math.abs(nearD)) { nearD = dd; nearK = k; }
  }
  const inIdx = phaseAt(starts[nearK] + 1e-4);
  const outIdx = phaseAt(starts[nearK] - 1e-4);
  const wOf = (k) => Math.max(bounds[k][1] - bounds[k][0], 1e-3);
  /* The dissolve is a duration, not a fraction of a cycle.

     Written as a flat 0.02 of a period it keeps its width in PHASE and loses
     it in time the moment the clock speeds up: at 2× it halves, and while a
     settle plays it is six times shorter still — twelve milliseconds, under
     one frame on a 60 Hz display. The layer then mounts fully lit between
     one frame and the next, which measured as arrows appearing at 0.84
     opacity, and every one of them coincided with a route mounting. Scaling
     by the rate keeps the fade the same number of milliseconds however fast
     the figure is being played. */
  const rateMul = spd * (tr && trPlay ? RUSH : 1);
  const fw = Math.min(0.02 * rateMul, 0.4 * Math.min(wOf(inIdx), wOf(outIdx)));
  /* 0 = outgoing phase fully present, 1 = incoming fully arrived. Cubic
     ease-in-out, not smoothstep: the narrowest windows span only three or
     four frames at 1×, so the first rendered sample can land a third of the
     way in — a curve that is still nearly flat there keeps a mounting layer
     under sight (measured ≤ 0.1) however the frames quantise it. */
  let blend = 1;
  if (outIdx !== inIdx && Math.abs(nearD) < fw / 2) {
    const u = (nearD + fw / 2) / fw;
    blend = u < 0.5 ? 4 * u * u * u : 1 - 4 * (1 - u) * (1 - u) * (1 - u);
  }
  const fading = blend < 1;

  /* The frame's draw lists. Keys carry the phase index, so a commutation
     mounts the incoming routes and unmounts the outgoing ones instead of
     morphing a persistent element's `d`. Shared copper must not dip: a
     branch present in both phases renders once, fully opaque, on the
     incoming side. */
  const flows = [];   /* { d, segs, o, key, k, j } — k/j locate the phase route,
                         which is how the EMC lens finds its cut pieces */
  const dims = [];
  if (!fading) {
    phGeo[idx].d.forEach((d, j) =>
      flows.push({ d, segs: phGeo[idx].geo[j], o: 1, key: "f" + idx + "_" + j, k: idx, j }));
    phGeo[idx].dim.forEach((d, j) =>
      dims.push({ d, o: 1, key: "m" + idx + "_" + j }));
  } else {
    const inD = new Set(phGeo[inIdx].d), inM = new Set(phGeo[inIdx].dim);
    const outD = new Set(phGeo[outIdx].d), outM = new Set(phGeo[outIdx].dim);
    phGeo[outIdx].d.forEach((d, j) => {
      if (!inD.has(d)) flows.push({ d, segs: phGeo[outIdx].geo[j], o: 1 - blend, key: "f" + outIdx + "_" + j, k: outIdx, j });
    });
    phGeo[inIdx].d.forEach((d, j) =>
      flows.push({ d, segs: phGeo[inIdx].geo[j], o: outD.has(d) ? 1 : blend, key: "f" + inIdx + "_" + j, k: inIdx, j }));
    phGeo[outIdx].dim.forEach((d, j) => {
      if (!inM.has(d)) dims.push({ d, o: 1 - blend, key: "m" + outIdx + "_" + j });
    });
    phGeo[inIdx].dim.forEach((d, j) =>
      dims.push({ d, o: outM.has(d) ? 1 : blend, key: "m" + inIdx + "_" + j }));
  }
  /* Brightness rides |i|: a synchronous rectifier running backwards at light
     load is carrying real current, and dimming it for its sign would say
     otherwise. Direction is the dashes' and arrows' job. */
  const mag = Math.min(Math.abs(iNow) / iPk, 1);
  /* A discontinuous cycle's rest interval should visibly rest — the dashes
     hold at a floor rather than vanishing, and everything is continuous in
     t, so nothing ever appears at a visible opacity. */
  const flowLive = 0.30 + 0.70 * mag;
  const arrows = flows.map((fl) => arrowsAt(fl.segs, -flowOff, 120, rateMul));

  /* ---- the capacitor branches ----

     The one current a reader cannot get at any other way. Everywhere else the
     figure animates a path that is either conducting or not; a capacitor is
     always connected and its current changes SIGN partway through the period,
     which is exactly the thing the switching path can never show.

     Each branch is drawn in the direction positive current flows INTO the
     capacitor, and its dashes ride on the charge integral, so:

       charging     q rises, dashes and arrows run along the drawn direction
       discharging  q falls, they run backwards, into the circuit

     No sign test decides that — the integral does it, and it is the same
     integral the i_C pane is drawn from, so the direction on the schematic
     and the side of zero on the plot cannot disagree. The reversal lands
     exactly on the zero crossing, where the marks are at their faintest, so
     it dissolves rather than flipping.

     `src` picks which capacitor: "out" is the output filter cap from the
     design's own `cap` spec, "in" the input cap the model derives from the
     switch current. Fixed geometry, drawn in every phase — a branch that
     appeared and vanished at commutation would pop, and the capacitor is
     doing something interesting in every phase anyway. */
  const capGeo = useMemo(() => (F.capFlow || []).map((g) => polySegs(g.d)), [F.capFlow]);
  const capFlows = (F.capFlow || []).map((g, j) => {
    const src = g.src === "in" ? M.inCap : M.cap;
    if (!src || !capGeo[j] || !capGeo[j].total) return null;
    const i = src.at(tPer);
    const pk = g.src === "in"
      ? (src.ipk > 1e-12 ? src.ipk : 1)
      : Math.max(Math.abs(src.iCmin), Math.abs(src.iCmax), 1e-12);
    /* Accumulated across a settle, for the same reason the conducting path
       is: the capacitor's own charge integral restarts every period, and its
       shape changes from one displayed period to the next, so resetting at
       each seam slides the whole dash train. */
    const off = -((tr ? ti : 0) + src.qAt(tPer) / (src.qAbs || 1)) * 240;
    const mag = Math.min(Math.abs(i) / pk, 1);
    return {
      i, mag, off, geo: capGeo[j], label: g.src === "in" ? "C_in" : "C_out",
      /* Continuous in t, so nothing ever appears at a visible opacity: a
         mark at the zero crossing is invisible, which is also the instant
         the direction reverses. */
      o: 0.12 + 0.88 * mag,
      arrows: arrowsAt(capGeo[j], -off, 120, rateMul),
      /* the arrowhead points the way it is actually travelling */
      flip: i < 0,
    };
  }).filter(Boolean);

  /* ---- fields lens: the per-frame drives ----

     Every number here is continuous in t, and every one of them comes from
     something the model computed — the honesty ladder. A coil conducting in
     the rendered phase breathes on the flow current; the pol-marked coil
     breathes on the plotted current, which is continuous through freewheel
     and honestly signed; a coil on a dim branch gets presence at a fixed
     faint level, because its current is real but uncomputed. */
  let fieldLive = null;
  if (lens === "fld") {
    const inPh = phGeo[fading ? inIdx : idx], outPh = fading ? phGeo[outIdx] : null;
    const cross = (setName, ci) => {
      const a = inPh[setName].has(ci) ? 1 : 0;
      if (!fading) return a;
      const b = outPh[setName].has(ci) ? 1 : 0;
      return a && b ? 1 : Math.max(a * blend, b * (1 - blend));
    };
    const iNorm = Math.max(Math.abs(M.iPeak), Math.abs(M.iValley), 1e-9);
    fieldLive = {
      coils: fieldGeo.coilG.map((_, ci) => {
        if (ci === fieldGeo.polCoil) {
          const i = M.iAt(tPer);
          return { m: Math.min(Math.abs(i) / iNorm, 1), live: 1, still: 0, flip: i < 0 };
        }
        return { m: mag, live: cross("hitD", ci), still: cross("hitM", ci), flip: false };
      }),
      caps: fieldGeo.capG.map((cg) => {
        const g = cg.flow >= 0 ? F.capFlow[cg.flow] : null;
        const src = g ? (g.src === "in" ? M.inCap : M.cap) : null;
        if (!src) return { o: 0.2, ch: 0 };
        const s = src.qAt(tPer) / (src.qAbs || 1);
        return { o: clamp(0.4 + 1.1 * s, 0.15, 0.75), ch: 1 };
      }),
      /* the flux drive, per the FLOW entry's own claim */
      flux: (() => {
        const fx = F.flux;
        if (!fx) return null;
        if (fx === "mag") return { phi: iNow / iPk, signed: false };
        if (fx === "vs" && M.fluxAt) return { phi: M.fluxAt(tPer), signed: true };
        if (fx.shape) return { phi: fx.shape(tPer, D), signed: false };
        return { phi: null };                       /* static: presence alone */
      })(),
    };
  }

  /* ---- EMC lens: edges are events ----

     The loop radiates hardest at the switching instants — the phase-window
     starts — and how hard depends on the current being commutated there.
     Both quantities are read from the model, so a DCM edge that switches at
     zero current is honestly quiet, and everything is a pure function of
     tPer: scrubbing shows the same pulse the loop played. */
  let emcLive = null;
  if (lens === "emc" && F.emc && emcGeo) {
    const S = starts.map((s) => {
      const t = ((s - 0.005) % 1 + 1) % 1;
      return Math.min(Math.abs(M.flowAt(t)) / iPk, 1);
    });
    let heat = 0;
    starts.forEach((s, k) => {
      let dk = tPer - s;
      dk -= Math.round(dk);
      heat += S[k] * Math.exp(-(dk / 0.012) * (dk / 0.012));
    });
    heat = Math.min(heat, 1);
    /* one ring per switching edge, always mounted; radius and opacity are
       functions of the time since that edge, zero at both ends of the ride */
    const RING_W = 0.12;
    const rings = starts.map((s, k) => {
      const age = ((tPer - s) % 1 + 1) % 1;
      const x = age / RING_W;
      if (x >= 1) return { r: 10, o: 0 };
      return { r: 10 + 55 * x, o: S[k] * 0.8 * 6.75 * x * (1 - x) * (1 - x) };
    });
    emcLive = { heat, rings };
  }

  return (
    <div className="card">
      <h3 className="eyebrow">
        How it works · current path and inductor polarity, at the real rate
      </h3>
      {FAMILY[topo.id] ? (
        <p className="fam">
          This is <Sub t={FAMILY[topo.id]} />
          {/* Which model drew this. A reader is owed the difference between a
              waveform the equations imply and one a circuit produced, and
              the figures that are simulated look different for reasons —
              a diode drop steepening the discharge, a ring after the
              rectifier opens — that are only meaningful if you know they
              were not drawn on purpose. */}
          {/* The badge describes the STEADY solve, not whichever period the
              figure happens to be drawing — a period lifted out of a
              transient was integrated to rather than solved for, and has no
              convergence figures of its own to report. */}
          {engine && engine.kind === "sim" && steady && steady.sim ? (
            <span className="simmark" title={
              `Simulated: the circuit was solved and run to steady state — `
              + `${steady.sim.periods} switching periods, residual `
              + `${steady.sim.residual.toExponential(1)}. Conduction is worked out `
              + `from the circuit, not scripted.`
            }>simulated</span>
          ) : null}
        </p>
      ) : null}
      <PlayBar
        play={play} onPlay={() => setPlay(!play)}
        spd={spd} onSpd={(v) => { setSpd(v); setPlay(true); }}
        phases={F.ph.map((q) => q.t)} phase={play ? -1 : idx} onPhase={jump}
        pos={p} onPos={(v) => { setPlay(false); setP(v); pRef.current = v; }}
        extra={
          <>
            <span className="sp" />
            <button className={lens === "i" ? "on" : ""} onClick={() => setLens("i")}
              aria-pressed={lens === "i"}>current path</button>
            <button className={lens === "emc" ? "on" : ""} onClick={() => setLens("emc")}
              aria-pressed={lens === "emc"}
              title="Show the hot loop, the switched current inside it, and the swinging node">
              EMC hot spots
            </button>
            <button className={lens === "fld" ? "on" : ""} onClick={() => setLens("fld")}
              aria-pressed={lens === "fld"}
              title="Show each component's field — magnetic around the inductors, electric in the capacitors, flux in the cores">
              fields
            </button>
            {/* Only where there is a circuit to disturb. A closed-form cycle
                has no state to carry across a step, so offering the control
                would promise something the model cannot do. */}
            {engine && engine.kind === "sim" && spec && spec.iout ? (
              <span className="stepbar">
                <span className="lbl">step the load</span>
                {[[0.5, "½×"], [1, "1×"], [2, "2×"]].map(([k, t]) => (
                  <button key={t} className={"stepbtn" + (loadK === k ? " on" : "")}
                    aria-pressed={loadK === k}
                    onClick={() => stepLoad(k)}
                    title={k === 1
                      ? "Back to the specified load"
                      : `Suddenly change the load to ${t} the specified current, keeping every `
                        + `component as designed, and watch the converter recover`}>
                    {t}
                  </button>
                ))}
              </span>
            ) : null}
            {wv ? (
              <span className="ird">
                <Mx t={wv.ilabel || "i_L"} /> = <b>{eng(iNow, "A")}</b>
                <em className={rising ? "up" : "dn"}>{rising ? "▲ rising" : "▼ falling"}</em>
              </span>
            ) : null}
          </>
        }
      />
      <div className="flowwrap fig">
        {sch}
        <svg className="flowov" viewBox={`0 0 ${F.w} ${F.h}`} aria-hidden="true">
          {lens === "emc" && F.emc && emcLive ? (
            <g className="emclive">
              {dims.map((m) => <path key={m.key} d={m.d} className="flowdim"
                style={{ opacity: (0.4 * m.o).toFixed(3) }} />)}
              {/* the conducting routes, cut at the loop: copper inside runs
                  red-hot, copper outside recedes but keeps moving */}
              {flows.map((fl) => emcGeo.ph[fl.k][fl.j].map((pc, pi) => (
                <React.Fragment key={fl.key + "_p" + pi}>
                  {pc.inside ? (
                    <path d={pc.d} className="flowglow hotseg"
                      style={{ opacity: ((0.10 + 0.16 * mag) * fl.o).toFixed(3),
                        strokeWidth: 5 + 7 * mag }} />
                  ) : null}
                  <path d={pc.d} className={pc.inside ? "flowp hotseg" : "flowp"}
                    style={{
                      opacity: (flowLive * fl.o * (pc.inside ? 0.6 + 0.4 * emcLive.heat : 0.4)).toFixed(3),
                      strokeDashoffset: flowOff + pc.s0,
                      strokeWidth: 1.7 + 2.2 * mag,
                    }} />
                </React.Fragment>
              )))}
              {arrows.map((set, j) => (
                <g key={"ar" + flows[j].key}
                  style={{ opacity: ((0.55 + 0.45 * mag) * flowLive * flows[j].o).toFixed(3) }}>
                  {set.map((m, i) => Chevron(m, i, false,
                    pointInLoop(m.x, m.y, emcGeo.loop, 10) ? "hot" : ""))}
                </g>
              ))}
              {/* the loop itself flares at each switching edge, sized by the
                  current being commutated there — a DCM edge is honestly quiet */}
              <path d={F.emc.loop} className="emcloop"
                style={{ opacity: (0.30 + 0.65 * emcLive.heat).toFixed(3) }} />
              <circle cx={F.emc.node[0]} cy={F.emc.node[1]} r={20} className="emcn2"
                style={{ opacity: (0.10 + 0.35 * emcLive.heat).toFixed(3) }} />
              <circle cx={F.emc.node[0]} cy={F.emc.node[1]} r={10} className="emcn" />
              {/* one ring per switching edge — the common-mode injection the
                  swinging node commits at that instant, rippling outward */}
              {emcLive.rings.map((r, k) => (
                <circle key={"rg" + k} cx={F.emc.node[0]} cy={F.emc.node[1]}
                  r={r.r.toFixed(1)} className="emcring"
                  style={{ opacity: r.o.toFixed(3) }} />
              ))}
            </g>
          ) : (
            <>
              {dims.map((m) => <path key={m.key} d={m.d} className="flowdim"
                style={{ opacity: (0.4 * m.o).toFixed(3) }} />)}
              {flows.map((fl) => <path key={"g" + fl.key} d={fl.d} className="flowglow"
                style={{ opacity: ((0.07 + 0.09 * mag) * fl.o).toFixed(3),
                  strokeWidth: 5 + 6 * mag }} />)}
              {flows.map((fl) => <path key={fl.key} d={fl.d} className="flowp"
                style={{ opacity: (flowLive * fl.o).toFixed(3),
                  strokeDashoffset: flowOff, strokeWidth: 1.7 + 2.2 * mag }} />)}
              {/* which way the charge is going — travelling with it */}
              {arrows.map((set, j) => (
                <g key={"ar" + flows[j].key}
                  style={{ opacity: ((0.55 + 0.45 * mag) * flowLive * flows[j].o).toFixed(3) }}>
                  {set.map((m, i) => Chevron(m, i))}
                </g>
              ))}
              {/* The capacitor branches, in their own colour — the same violet
                  the i_C pane is drawn in, so the schematic and the plot share
                  one vocabulary. Drawn after the conducting path so they read
                  as a separate current rather than part of the loop. */}
              {drawScope("cf", () => capFlows.map((c, j) => (
                <g key={"cf" + j} className="capfl" style={{ opacity: c.o.toFixed(3) }}>
                  <path d={F.capFlow[j].d} className="capglow"
                    style={{ strokeWidth: 4 + 5 * c.mag }} />
                  <path d={F.capFlow[j].d} className="capp"
                    style={{ strokeDashoffset: c.off, strokeWidth: 1.4 + 1.8 * c.mag }} />
                  {c.arrows.map((m, i) => Chevron(m, i, c.flip))}
                </g>
              )))}
              {/* ---- the fields lens, over the running current ----

                  The fields are meaningless without the current that makes
                  them, so this lens adds to the overlay instead of replacing
                  it. Green loops: each inductor's magnetic field, breathing
                  with the current the figure claims in that branch. Cyan
                  strokes: the electric field between capacitor plates. Copper
                  racetrack: the core flux. Fixed geometry, opacity only. */}
              {lens === "fld" && fieldLive ? drawScope("mf", () => (
                <g className="fldlay">
                  {fieldGeo.coilG.map((c, ci) => {
                    const fv = fieldLive.coils[ci];
                    const eo = Math.max(fv.live * (0.06 + 0.80 * fv.m), fv.still * 0.14);
                    const co = fv.live * (0.10 + 0.85 * fv.m);
                    return (
                      <g key={nk()}>
                        <ellipse cx={c.cx} cy={c.cy} rx={c.e1.rx} ry={c.e1.ry}
                          className="mfl" style={{ opacity: eo.toFixed(3),
                            strokeWidth: 1 + 0.8 * fv.m * fv.live }} />
                        <ellipse cx={c.cx} cy={c.cy} rx={c.e2.rx} ry={c.e2.ry}
                          className="mfl" style={{ opacity: (eo * 0.6).toFixed(3) }} />
                        <g style={{ opacity: co.toFixed(3) }}>
                          {c.ch.map((m, i) => Chevron(m, i, fv.flip, "mfa"))}
                        </g>
                      </g>
                    );
                  })}
                  {fieldGeo.capG.map((cg, ci) => {
                    const fv = fieldLive.caps[ci];
                    return (
                      <g key={nk()} style={{ opacity: fv.o.toFixed(3) }}>
                        {cg.strokes.map((d, i) => <path key={i} d={d} className="efl" />)}
                        {fv.ch ? Chevron(cg.ch, 0, false, "efa") : null}
                      </g>
                    );
                  })}
                  {fieldGeo.coreG.map((c) => {
                    const fx = fieldLive.flux || { phi: null };
                    const m = fx.phi === null ? 0 : Math.min(Math.abs(fx.phi), 1);
                    const o = fx.phi === null ? 0.18 : 0.10 + 0.72 * m;
                    return (
                      <g key={nk()}>
                        <ellipse cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry}
                          className="cxf" style={{ opacity: o.toFixed(3) }} />
                        {fx.phi !== null ? (
                          <g style={{ opacity: (0.15 + 0.80 * m).toFixed(3) }}>
                            {Chevron({ x: c.cx, y: c.cy - c.ry, a: 0 }, 0, fx.phi < 0, "cxa")}
                            {Chevron({ x: c.cx, y: c.cy + c.ry, a: 180 }, 1, fx.phi < 0, "cxa")}
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              )) : null}
              {/* and which way the inductor is being driven */}
              {pol ? (
                <g style={{ opacity: pol.live }}>
                  {drawScope("pl", () => [
                    PolMark(F.pol[0], F.pol[1], pol.plus),
                    PolMark(F.pol[2], F.pol[3], 1 - pol.plus),
                  ])}
                </g>
              ) : null}
            </>
          )}
          {drawScope("db", () => (F.sw || []).map((q, j) =>
            DevMark(q[0], q[1], q[2], ph.on ? !!ph.on[j] : false, q[3])))}
        </svg>
      </div>
      {devs.length ? (
        <div className="devleg">
          {/* The two states read differently and wrap to different heights, so
              they are stacked too — otherwise a device changing state reflows
              the legend and shifts the figure below it. */}
          {devs.map((d, j) => (
            <span key={j} className={d.on ? "lit" : "blk"}>
              <i /><b>{d.label}</b>
              <Swap active={d.on ? 0 : 1} items={d.diode
                ? ["forward biased — it conducts because the circuit forces it to",
                  "reverse biased — it blocks, no one told it to"]
                : ["commanded on by the gate driver", "commanded off by the gate driver"]} />
            </span>
          ))}
          {/* One row in the legend rather than a paragraph of its own: the
              marks use the same vocabulary as the device rings above them, so
              they belong in the same list. */}
          {pol ? (
            <span className="pol"><i /><b>+ −</b>
              <Sub t="the inductor's own voltage, v_L = L·di/dt — the terminal the current enters is the positive one while the current rises" />
            </span>
          ) : null}
          {/* The capacitor branches get a line of their own, because their
              arrows mean something different from the ones on the conducting
              path: those show where current goes, these show which way it has
              turned. */}
          {capFlows.length ? (
            <span className="cap"><i /><b><Sub t={capFlows.map((c) => c.label).join(" · ")} /></b>
              <Swap active={capFlows[0].i >= 0 ? 0 : 1} items={[
                "the capacitor is charging — current runs into it, and its voltage is rising",
                "the capacitor is discharging — the arrows have turned, and it is now supplying the circuit",
              ]} />
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Every phase's note, stacked — so the box holds the tallest of them
          and the waveform below it stays exactly where it is as the cycle
          runs. See Swap. */}
      <p className="flownote">
        <Swap
          items={[...F.ph.map((q, j) => <Sub key={j} t={q.n} />),
            <Sub key="emc" t="Red marks the loop carrying switched current: its enclosed area sets the magnetic field it radiates, so minimising it is the first layout job. The copper inside it runs hot, and the loop flares at each switching edge, sized by the current being commutated there. Violet marks the node that swings the full rail every cycle — the ring it emits at each edge is the common-mode current it injects through stray capacitance to earth. Keep its copper no larger than the current requires." />,
            <Sub key="fld" t="Green loops are each inductor's magnetic field — the converter's magnetic energy store, breathing with the current the figure claims in that branch and collapsing where it rests. Cyan strokes are the electric field between capacitor plates, the dual store; on the modelled capacitors it swells as charge arrives. The copper racetrack is the transformer's core flux — the magnetising current on a flyback, the volt-second integral on a bridge, alternating sign so the core cannot walk. The faint static fields claim presence, not a waveform: nothing computed stands behind more." />]}
          active={lens === "emc" ? F.ph.length : lens === "fld" ? F.ph.length + 1 : idx} />
      </p>
      {wv || bare ? (
        <div style={{ marginTop: 12 }}>
          {/* The same cycle the schematic above is animating — handed over
              rather than rebuilt, so the trace and the dashes cannot end up
              describing different converters. */}
          <Wave {...(wv || bare)} model={wv ? M : null} band={band} playhead={p}
            flowOffset={flowOff} fadeEdges={play} period={period}
            spanI={trSpan} />
          {tr ? (
            <div className={trOut ? "out" : ""}>
              <TransientStrip tr={tr} index={ti} playing={trPlay}
                onIndex={(k) => { setTrPlay(false); setTi(k); }}
                label={`load stepped to ${loadK === 0.5 ? "½×" : loadK + "×"}`} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { FlowCard };
