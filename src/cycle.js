/* One description of a switching cycle, shared by everything that draws it.

   The waveform pane and the animated schematic used to carry independent
   implementations of the same current: `Wave` built a path inline and
   reconstructed the instantaneous value with its own formula, while
   `FlowCard` ran a separate 240-point quadrature. They disagreed. A flyback's
   primary current stops dead at turn-off — the waveform drew that correctly
   and the schematic's flow did not, so the dashes kept moving through an
   interval in which no primary current exists. Duty was clamped in one place
   and not the other, so the shaded band could sit on the wrong slope.

   So: one function, one shape, no second opinion.

   Everything is flattened into a single polyline `pts` at build time. A
   straight interval contributes two points and a curved one contributes
   several, which means every consumer downstream reads a polyline and needs
   no special case for saturation, for discontinuous conduction, or for the
   topologies that supply their own current shape. Trapezoidal integration of
   a straight segment is exact, so the charge integral — and the capacitor
   voltage built on top of it — stay exact wherever the current is piecewise
   linear, which is everywhere except a saturating ramp.

   Pure: no JSX, no React, no DOM. `scripts/check-cap.mjs` imports it
   directly rather than scraping the app.                                  */

const num = (x, fb) => (Number.isFinite(x) ? x : fb);
const clamp = (x, lo, hi) => (Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : lo);

/* Duty is clamped once, here, and everyone uses the result. A duty of 0 or 1
   is not a converter, and a trace drawn from an unclamped duty against a band
   drawn from a clamped one is just a bug waiting for an extreme input. */
export const DUTY_MIN = 0.03, DUTY_MAX = 0.97;

/* how many points a bent interval is split into — see `sat` below */
const BEND = 6;

/* Repeat a one-sub-interval shape across the drawn period.

   A push-pull, half-bridge, phase-shifted bridge or centre-tapped rectifier
   delivers TWO power pulses per switching period, so its output choke ramps up
   and back down twice. The shape of each is identical, so it is built once —
   through all the same machinery as any other cycle, so discontinuous
   conduction and core saturation come along for free — and then tiled.

   The seam is emitted once where the shape is periodic, which is the normal
   case: a ramp starts and ends at the valley, a pulse and a discontinuous
   cycle both start and end at zero. Where it is not, both values are kept and
   the vertical edge between them is real rather than an artefact. */
const tilePulses = (one, P) => {
  if (P <= 1 || one.length < 2) return one;
  const closed = Math.abs(one[0].i - one[one.length - 1].i) < 1e-12;
  const out = [];
  for (let k = 0; k < P; k++) {
    for (let j = 0; j < one.length; j++) {
      if (k > 0 && j === 0 && closed) continue;
      out.push({ u: (k + one[j].u) / P, i: one[j].i });
    }
  }
  return out;
};

/* Everything buildCycle actually reads, as one string.

   `wave` is rebuilt by design() on every render, so its object identity is
   useless as a memo dependency and callers listed the individual fields
   instead. That list then silently fell behind: adding the saturation input
   left it out, so turning the roll-off up and down changed the spec and
   redrew nothing. Deriving the key here means a new input can only be added
   in one place, and the caches cannot disagree with the function they cache. */
export const cycleKey = (wv, iShape) => {
  const w = wv || {}, c = w.cap || {};
  return [w.D, w.dI, w.iavg, w.pulse, w.pulses, w.vbi, w.rect, w.sat,
    c.kind, c.C, c.esr, c.Vdc, c.Io, c.iavg, c.dI, c.n, c.sub, c.i0, c.i1, c.fsw,
    iShape ? "s" : ""].join("|");
};

/* ---- lookups over a polyline ----

   Module scope, because the capacitor's current is a polyline in exactly the
   same sense the inductor's is and wants exactly the same three questions
   asked of it: what is the value here, how steep is it, and how much charge
   has passed. Anything that animates from a current reads it through this.

   Segments of zero width are the vertical edges; they are skipped when
   scanning, so a lookup at an edge returns the value arriving at it. */
const lookups = (P) => {
  const seg = (t) => {
    for (let k = 0; k < P.length - 1; k++) {
      if (P[k + 1].u <= P[k].u) continue;
      if (t <= P[k + 1].u) return k;
    }
    return P.length - 2;
  };
  const at = (u) => {
    const t = clamp(u, 0, 1);
    const k = seg(t), a = P[k], b = P[k + 1];
    if (b.u <= a.u) return b.i;
    return a.i + (b.i - a.i) * ((t - a.u) / (b.u - a.u));
  };
  /* di/du, in amps per period — multiply by f_sw for amps per second */
  const slope = (u) => {
    const k = seg(clamp(u, 0, 1)), a = P[k], b = P[k + 1];
    return b.u <= a.u ? 0 : (b.i - a.i) / (b.u - a.u);
  };
  /* running charge. Exact on straight segments, which is all of them
     unless the ramp is bent by saturation. */
  const qc = [0];
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1];
    qc.push(qc[k] + (b.u > a.u ? ((a.i + b.i) / 2) * (b.u - a.u) : 0));
  }
  const qAt = (u) => {
    const t = clamp(u, 0, 1);
    const k = seg(t), a = P[k];
    return qc[k] + ((a.i + at(t)) / 2) * Math.max(t - a.u, 0);
  };
  return { at, slope, qAt, qTot: qc[qc.length - 1] };
};

/* Is this spec running discontinuously?

   Exported because the page has to SAY so, not only draw it. The CCM ratio,
   the ripple formula and the capacitor sizing printed above the figure all
   stop holding once the current hits zero and rests there, and for a long
   time only the buck admitted it — every other converter redrew itself as a
   discontinuous triangle with the continuous-conduction equations stated as
   fact beside it. One definition, used by buildCycle for the shape and by the
   app for the sentence, so the two cannot disagree.

   A current shape supplied by the topology, a pulse waveform and a
   synchronous rectifier are all excluded: the first two are not ramps, and a
   synchronous rectifier genuinely pulls its current negative rather than
   sitting at zero. */
export const isDCM = (wv, iShape) => {
  const w = wv || {};
  const iavg = num(w.iavg, 0.5), dI = num(w.dI, 1);
  return !iShape && !w.pulse && w.rect !== "sync" && dI > 1e-12 && iavg > 0
    && iavg < dI / 2 - 1e-12;
};

/* The current that actually charges the capacitor, and the voltage it makes.

   This is the pane that explains output ripple, and it is built from the same
   polyline as everything else so it cannot drift from the inductor current
   drawn above it. Two families:

     buck-like   the output inductor feeds the node continuously, so
                 i_C = i_L − I_out and there is no discontinuity;
     boost-like  the output is fed in pulses. The capacitor alone supplies the
                 load while the switch is on (i_C = −I_out), then the
                 rectifier dumps into it. Hence the step at each commutation,
                 and hence why boost ripple is so much worse than buck.

   `n` sums interleaved phases; `sub` tiles topologies that deliver more than
   one pulse per switching period — a centre-tapped rectifier and a half
   bridge both ripple at 2·f_sw, which is exactly why their filters are
   smaller than the switch timing alone suggests. */
function buildCap(pts, Dsub, cap, nPulse) {
  const C = num(cap.C, NaN), Io = num(cap.Io, 0);
  const T = 1 / num(cap.fsw, NaN);
  if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(T)) return null;
  const esr = Math.max(num(cap.esr, 0), 0);
  const n = Math.max(1, Math.round(num(cap.n, 1)));
  const sub = Math.max(1, Math.round(num(cap.sub, 1)));
  const P = Math.max(1, Math.round(num(nPulse, 1)));

  /* --- the current into the capacitor, as a polyline --- */
  let iC = [];
  if (cap.kind === "boost") {
    const a = num(cap.i0, 0), b = num(cap.i1, 0);
    /* Built over one sub-interval and tiled, the same way the inductor current
       is, so a pulse-fed output stays in step with a multi-pulse drive. Nothing
       uses that combination today — every double-pulse topology here has a
       continuously-fed output — but a spec that silently ignored `pulses` would
       be a trap for whoever adds one. */
    iC = tilePulses([{ u: 0, i: -Io }, { u: Dsub, i: -Io },
      { u: Dsub, i: a - Io }, { u: 1, i: b - Io }, { u: 1, i: -Io }], P);
  } else {
    /* Usually the plotted winding IS the one feeding the output. Where it is
       not — a Ćuk plots its input inductor while the capacitor sees the
       output one — the spec carries that winding's own average and ripple and
       the ramp is built from those. Reusing the plotted polyline there would
       draw a ripple belonging to a different winding, which is the same class
       of mistake as the flow animation running its own current shape. */
    const own = Number.isFinite(cap.iavg) && Number.isFinite(cap.dI)
      ? tilePulses([{ u: 0, i: cap.iavg - cap.dI / 2 },
        { u: Dsub, i: cap.iavg + cap.dI / 2 },
        { u: 1, i: cap.iavg - cap.dI / 2 }], P)
      : pts;
    /* start from that current, tiled and summed as needed */
    const base = [];
    for (let s = 0; s < sub; s++) {
      for (let k = 0; k < own.length; k++) {
        if (s > 0 && k === 0) continue;              /* don't repeat the seam */
        base.push({ u: (s + own[k].u) / sub, i: own[k].i });
      }
    }
    if (n === 1) {
      iC = base.map((p) => ({ u: p.u, i: p.i - Io }));
    } else {
      /* N interleaved phases. The sum of n copies of a piecewise-linear
         current, each shifted by j/n, is ITSELF piecewise linear: its
         breakpoints are the union of every phase's breakpoints, and between
         two of those every phase is on a straight segment. So evaluating the
         sum exactly there reproduces it exactly, and the charge integral —
         and therefore the ripple built on it — stays exact.

         This was a uniform 240-point sample, which looked identical and left
         a residual charge imbalance of about 1e-3. Small on the drawing, and
         not small at all in a figure whose entire claim is that its charge
         balances: it is indistinguishable from the imbalance a genuinely
         wrong interleaving factor would produce, so it had to go.

         A base with a vertical edge has no single value at that instant and
         keeps the sampled sum. Nothing reaches that today — both interleaved
         topologies draw plain ramps — but a pulse waveform would. */
      const at = (P, u) => {
        const t = ((u % 1) + 1) % 1;
        for (let k = 0; k < P.length - 1; k++) {
          if (P[k + 1].u <= P[k].u) continue;
          if (t <= P[k + 1].u) {
            const A = P[k], B = P[k + 1];
            return A.i + (B.i - A.i) * ((t - A.u) / (B.u - A.u));
          }
        }
        return P[P.length - 1].i;
      };
      const sumAt = (u) => {
        let t = 0;
        for (let j = 0; j < n; j++) t += at(base, u + j / n);
        return t - Io;
      };
      const stepped = base.some((p, k) => k > 0 && p.u <= base[k - 1].u);
      if (stepped) {
        const N = 240;
        for (let k = 0; k <= N; k++) iC.push({ u: k / N, i: sumAt(k / N) });
      } else {
        const us = new Set([0, 1]);
        for (const p of base) {
          for (let j = 0; j < n; j++) us.add(Number(((p.u + j / n) % 1).toFixed(12)));
        }
        for (const u of [...us].sort((a, b) => a - b)) iC.push({ u, i: sumAt(u) });
      }
    }
  }

  /* --- close the loop --- */
  /* Over one period a capacitor must take in exactly as much charge as it
     gives back, or its voltage would walk away cycle after cycle. If the
     design's own ΔI and I_out do not quite balance, the honest correction is
     a constant offset on the current: it preserves the piecewise-linear
     shape AND the steps, where mean-subtracting the voltage instead would
     leave the trace's two ends at different heights and put a visible break
     at the loop seam. qErr says how big that correction had to be. */
  const areaOf = (P) => {
    let a = 0;
    for (let k = 0; k < P.length - 1; k++) {
      if (P[k + 1].u > P[k].u) a += ((P[k].i + P[k + 1].i) / 2) * (P[k + 1].u - P[k].u);
    }
    return a;
  };
  const absArea = (P) => {
    let a = 0;
    for (let k = 0; k < P.length - 1; k++) {
      if (P[k + 1].u > P[k].u) a += ((Math.abs(P[k].i) + Math.abs(P[k + 1].i)) / 2) * (P[k + 1].u - P[k].u);
    }
    return a;
  };
  const q0 = areaOf(iC), scale = absArea(iC);
  const qErr = scale > 1e-15 ? Math.abs(q0) / scale : 0;
  if (Math.abs(q0) > 1e-18) iC = iC.map((p) => ({ u: p.u, i: p.i - q0 }));

  /* --- integrate to voltage --- */
  /* The capacitive part is the charge integral. The ESR part is i_C·ESR,
     which is piecewise LINEAR and steps wherever the current does — so the
     total stays piecewise quadratic and a quadratic Bézier still reproduces
     it exactly. That step is the reason a real ripple waveform has vertical
     edges and its peak does not sit where the textbook parabola says. */
  const kq = T / C;
  const vCap = [0];
  for (let k = 0; k < iC.length - 1; k++) {
    const a = iC[k], b = iC[k + 1];
    vCap.push(vCap[k] + (b.u > a.u ? kq * ((a.i + b.i) / 2) * (b.u - a.u) : 0));
  }
  const vTot = iC.map((p, k) => vCap[k] + p.i * esr);

  /* centre both on the DC level */
  let mv = 0;
  for (let k = 0; k < iC.length - 1; k++) {
    if (iC[k + 1].u > iC[k].u) mv += ((vTot[k] + vTot[k + 1]) / 2) * (iC[k + 1].u - iC[k].u);
  }
  for (let k = 0; k < vTot.length; k++) { vTot[k] -= mv; vCap[k] -= mv; }

  /* --- extrema, including the interior turning point of each parabola --- */
  /* v' = (T/C)·i_C + ESR·di_C/du. The current is linear on each segment, so
     v is quadratic there and turns wherever that derivative vanishes.
     Scanning only the nodes misses those turning points entirely and lets
     the trace clip straight out of its pane.

     With no ESR the turning point is exactly where the current crosses zero,
     which is the non-obvious thing this pane exists to show: output ripple
     peaks where the CAPACITOR current crosses zero, not where the inductor
     current peaks. Add ESR and the turning point moves earlier — which is
     why a measured ripple peak never sits where the textbook parabola says.
     So both are computed: `cross` for the guide lines and the ideal
     underlay, and the true extrema for the scale. */
  const cross = [];
  let vMin = Infinity, vMax = -Infinity;
  for (const v of vTot) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  const vOn = (k, t) => {
    const a = iC[k], b = iC[k + 1], du = (b.u - a.u) * t;
    const it = a.i + (b.i - a.i) * t;
    return { u: a.u + du, i: it, v: vCap[k] + kq * ((a.i + it) / 2) * du + it * esr };
  };
  for (let k = 0; k < iC.length - 1; k++) {
    const a = iC[k], b = iC[k + 1];
    if (b.u <= a.u || a.i === b.i) continue;
    /* where the ideal capacitor turns: i_C = 0 */
    const t0 = -a.i / (b.i - a.i);
    if (t0 > 0 && t0 < 1) cross.push(vOn(k, t0));
    /* where the real trace turns: (T/C)·i_C + ESR·slope = 0 */
    const slope = (b.i - a.i) / (b.u - a.u);
    const t1 = ((-esr * slope) / kq - a.i) / (b.i - a.i);
    if (t1 > 0 && t1 < 1) {
      const p = vOn(k, t1);
      if (p.v < vMin) vMin = p.v;
      if (p.v > vMax) vMax = p.v;
    }
  }

  /* Exact quadratic Bézier controls, one per segment of the current.

     v is quadratic in the segment parameter, so a Bézier reproduces it
     exactly: x is linear, which puts the control abscissa at the midpoint,
     and then v(½) = (v₀ + 2·v_c + v₁)/4 fixes the control value. Sampling the
     parabola instead would need a dozen points per segment to hide the
     faceting and would still miss the turning point — the one place on this
     trace anybody actually reads. A segment of zero width is a step, has no
     interior, and gets a null so the drawing emits a straight line.

     Two sets, because the difference between them IS the ESR: `ctrl` for the
     real trace and `ctrlCap` for the charge-only parabola drawn under it. */
  const ctrl = [], ctrlCap = [];
  for (let k = 0; k < iC.length - 1; k++) {
    const a = iC[k], b = iC[k + 1];
    if (b.u <= a.u) { ctrl.push(null); ctrlCap.push(null); continue; }
    const um = (a.u + b.u) / 2, im = (a.i + b.i) / 2;
    const cm = vCap[k] + kq * ((a.i + im) / 2) * ((b.u - a.u) / 2);
    ctrl.push({ u: um, v: 2 * (cm + im * esr) - (vTot[k] + vTot[k + 1]) / 2 });
    ctrlCap.push({ u: um, v: 2 * cm - (vCap[k] + vCap[k + 1]) / 2 });
  }

  /* The charge-only swing, so the pane can say how much of the ripple is ESR
     rather than leaving the reader to subtract two numbers. The ideal trace
     turns exactly where the current crosses zero, and `cross` already carries
     the value there — at i_C = 0 the ESR term vanishes, so those v's are
     purely capacitive and can be scanned directly. */
  let cMin = Infinity, cMax = -Infinity;
  for (const v of vCap) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; }
  for (const p of cross) { if (p.v < cMin) cMin = p.v; if (p.v > cMax) cMax = p.v; }

  let iCmin = Infinity, iCmax = -Infinity, irms = 0;
  for (const p of iC) { if (p.i < iCmin) iCmin = p.i; if (p.i > iCmax) iCmax = p.i; }
  /* rms over a piecewise-linear current, segment by segment in closed form:
     ∫(a + (b−a)t)² dt = (a² + ab + b²)/3. This is the number a capacitor is
     actually chosen against — its ripple-current rating, not its value. */
  for (let k = 0; k < iC.length - 1; k++) {
    const a = iC[k], b = iC[k + 1];
    if (b.u > a.u) irms += ((a.i * a.i + a.i * b.i + b.i * b.i) / 3) * (b.u - a.u);
  }

  /* What the SCHEMATIC needs to animate this branch.

     `at` is i_C at an instant, for the width and opacity of the marks; `qAt`
     is the charge that has flowed into the capacitor since the start of the
     period, which is what the dashes ride on. That integral is the whole
     trick: it rises while the capacitor is charging and FALLS while it is
     discharging, so a dash offset driven by it reverses of its own accord at
     the zero crossing, with no sign test anywhere in the drawing. It also
     returns to where it started after one period — charge balance, which this
     model has already enforced above — so the animation loops seamlessly for
     the same reason the physics does.

     `qAbs` is the total charge moved in the period, positive and negative
     halves added as magnitudes. Dividing by it normalises the travel, so a
     0.3 A ripple and a 30 A ripple both sweep the dashes a comfortable
     distance rather than one crawling and the other blurring. */
  const CL = lookups(iC);
  const qAbs = absArea(iC);

  return { iC, vCap, vTot, vMin, vMax, vPP: vMax - vMin, qErr, cross, kq, esr, C,
    at: CL.at, qAt: CL.qAt, qAbs,
    ctrl, ctrlCap, capPP: cMax - cMin, iCmin, iCmax, iCrms: Math.sqrt(Math.max(irms, 0)),
    /* The switching frequency, so a caller can state the ripple frequency as a
       number rather than as a multiple of a symbol. n·sub·P·f_sw is what the
       output actually ripples at — interleaved phases, extra capacitor pulses
       and extra power pulses all multiply it — and it is the frequency the loop
       crossover and the capacitor's own impedance curve have to be read at. */
    fsw: num(cap.fsw, NaN), fRipple: num(cap.fsw, NaN) * n * sub * P,
    Vdc: num(cap.Vdc, 0), Io, n, sub, pulses: P,
    kind: cap.kind === "boost" ? "boost" : "buck" };
}

/* i(u) over one switching period, u ∈ [0,1].

   `wv` is the topology's own `wave` spec. `iShape` is the optional override a
   FLOW entry can supply for topologies whose current is not a ramp at all
   (resonant class-E, rectifier conduction pulses, charge-pump spikes). */
export function buildCycle(wv, iShape) {
  const w = wv || {};
  const D = clamp(num(w.D, 0.5), DUTY_MIN, DUTY_MAX);
  const pulse = !!w.pulse;
  const iavg = num(w.iavg, 0.5);
  const dI = num(w.dI, 1);

  /* Power pulses per switching period.

     `D` stays what every topology means by it and what everything downstream
     reads — the duty of ONE switch measured against the whole period. What
     changes with P is how much of a SUB-interval that duty occupies: the
     on-time is still D·T, but the interval it lives in is only T/P long, so
     within it the on-fraction is D·P. A half-bridge at D = 0.38 spends 76 % of
     each half-period charging its choke and 24 % discharging it, which is why
     these ramps are so much more lopsided than a buck's.

     Everything below builds the shape for one sub-interval using Dsub and then
     tiles it, so discontinuous conduction, core saturation and the mean
     restoration all work unchanged rather than needing a second version each.
     Clamped, because D·P can exceed 1 if a topology is driven past the duty
     limit its own warnings are already complaining about. */
  const nPulse = Math.max(1, Math.round(num(w.pulses, 1)));
  const Dsub = nPulse > 1 ? clamp(D * nPulse, DUTY_MIN, DUTY_MAX) : D;

  /* A diode cannot carry current backwards, so its valley is clamped at zero.
     A synchronous rectifier can, and at light load genuinely does — clamping
     there would draw a lie the topology's own warning contradicts. */
  const iHi = iavg + dI / 2;
  const iLo = w.rect === "sync" ? iavg - dI / 2 : Math.max(iavg - dI / 2, 0);

  /* Discontinuous conduction. The current reaches zero before the period
     ends and simply stays there, because a diode will not pull it negative.
     The tool has always known when this happens — it prints a warning saying
     so — while continuing to draw the continuous-conduction triangle beside
     the warning, with the valley clamped at zero. That clamp quietly moved
     the mean: the drawn triangle averaged (I_avg + ΔI/2)/2, not I_avg, while
     the tick beside it still claimed I_avg.

     Keeping the two ramp slopes and solving ½·I_pk·(D₁+D₂) = I_avg gives a
     shape that carries the right average and meets the continuous case
     exactly at the boundary, so there is no seam as the load is swept. */
  const dcm = isDCM(w, iShape);
  const kD = dcm ? Math.sqrt((2 * iavg) / dI) : 1;   /* 0 < kD < 1 in DCM */
  const D1 = Dsub * kD, D2 = (1 - Dsub) * kD;

  /* The values the peak/valley ticks will carry. They track the drawing
     through every transformation below, so a label can never describe a
     curve other than the one beside it. */
  let vLo = iLo, vHi = iHi;
  if (dcm) { vLo = 0; vHi = Math.sqrt(2 * iavg * dI); }

  let pts;
  let mode = dcm ? "dcm" : "ccm";
  if (iShape) {
    /* sampled, because the shape is whatever the topology says it is */
    const N = 240;
    pts = [];
    for (let k = 0; k <= N; k++) pts.push({ u: k / N, i: Math.max(iShape(k / N, D), 0) });
  } else if (dcm) {
    pts = [{ u: 0, i: 0 }, { u: D1, i: Math.sqrt(2 * iavg * dI) },
      { u: D1 + D2, i: 0 }, { u: 1, i: 0 }];
  } else if (pulse) {
    /* The switch stops conducting at turn-off and the current in THIS winding
       goes to zero — it does not ramp back down. The duplicated `u` values are
       the vertical edges, and are deliberate. */
    pts = [{ u: 0, i: 0 }, { u: 0, i: iLo }, { u: Dsub, i: iHi }, { u: Dsub, i: 0 }, { u: 1, i: 0 }];
  } else {
    pts = [{ u: 0, i: iLo }, { u: Dsub, i: iHi }, { u: 1, i: iLo }];
  }
  /* One sub-interval built; now fill the drawn period with copies of it. From
     here down, `pts` spans the whole period again and nothing else needs to
     know how many pulses went into it. */
  pts = tilePulses(pts, iShape ? 1 : nPulse);

  /* Core saturation. Real inductance falls as the core is driven, so the
     ramp is not straight — it steepens toward the peak, which is the visible
     departure from the textbook triangle. (The other candidate, the L/R
     exponential, is exact but invisible: at real values the time constant is
     hundreds of microseconds against a period of two, well under 1 %.)

         L(i) = L₀ / (1 + κ·(i/I_pk)²),   κ = s/(1−s)

     so L(0) = L₀ and L(I_pk) = (1−s)·L₀ exactly, with s the roll-off a
     datasheet actually quotes. Then di/du = A·(1 + κ(i/I_pk)²) integrates to

         i(u) = (I_pk/√κ)·tan( φ₀ + (φ₁−φ₀)·t ),   φ(i) = atan(√κ·i/I_pk)

     — the ramp is linear in φ, not in i. No ODE, no root-finding, and as
     κ→0 it collapses back to the straight line. A is fixed per interval by
     that interval's own endpoints, so ΔI is preserved exactly. */
  const sat = clamp(num(w.sat, 0), 0, 0.8);
  const meanOf = (P) => {
    let m = 0;
    for (let k = 0; k < P.length - 1; k++) {
      if (P[k + 1].u > P[k].u) m += ((P[k].i + P[k + 1].i) / 2) * (P[k + 1].u - P[k].u);
    }
    return m;
  };
  if (!iShape && sat > 1e-6) {
    const ref = Math.max(Math.abs(vHi), Math.abs(vLo), 1e-12);
    const kap = sat / (1 - sat), rk = Math.sqrt(kap);
    const phi = (i) => Math.atan((rk * i) / ref);
    const inv = (p) => (ref * Math.tan(p)) / rk;
    const bent = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      if (b.u <= a.u || Math.abs(b.i - a.i) < 1e-15) { bent.push(b); continue; }
      const p0 = phi(a.i), p1 = phi(b.i);
      for (let j = 1; j <= BEND; j++) {
        const t = j / BEND;
        bent.push({ u: a.u + (b.u - a.u) * t, i: j === BEND ? b.i : inv(p0 + (p1 - p0) * t) });
      }
    }
    pts = bent;

    /* A concave ramp encloses less area than the straight one it replaced,
       so bending alone drops the average by up to about a percent — and a
       figure whose drawn mean disagrees with its own "mean" tick is the kind
       of quiet lie this tool exists to avoid. Put the average back where the
       design says it is and let the peak float up to accommodate it, which is
       also the physically right direction: hold the average and the volt-
       seconds against a softening core and the peak DOES rise.

       Continuous conduction rides on a DC level, so shift. Discontinuous
       conduction must keep sitting exactly at zero for part of the period, so
       scale instead — a shift would lift it off the floor. */
    if (!pulse) {
      const m = meanOf(pts);
      if (m > 1e-12 && Number.isFinite(m)) {
        if (dcm) {
          const k = iavg / m;
          pts = pts.map((p) => ({ u: p.u, i: p.i * k }));
          vLo *= k; vHi *= k;
        } else {
          const d = iavg - m;
          pts = pts.map((p) => ({ u: p.u, i: p.i + d }));
          vLo += d; vHi += d;
        }
      }
    }
  }

  /* The current in whatever path is conducting, which is NOT always the
     current being plotted.

     A flyback plots its PRIMARY current, which stops dead at turn-off. But
     the schematic then highlights the secondary loop, and the secondary is
     very much carrying current — the reflected current, decaying at
     V_out/L_s. Driving the flow from the plotted trace freezes the dashes in
     a highlighted loop, which says the opposite of what is happening. Only
     the shape matters here, because the dash rate is normalised by the total,
     so the reflected scaling drops out and this is the familiar two-sided
     triangle: up while the switch conducts, down while the rectifier does. */
  const flowPts = pulse
    ? tilePulses([{ u: 0, i: iLo }, { u: Dsub, i: iHi }, { u: 1, i: iLo }], nPulse)
    : pts;

  const T = lookups(pts);
  const iAt = T.at, slopeAt = T.slope, qAt = T.qAt, qTot = T.qTot;
  const FL = flowPts === pts ? T : lookups(flowPts);

  /* Two different minima, and they are not interchangeable. `iMin` is the
     lowest value the trace reaches — zero for a pulse waveform, which spends
     the off-time at zero. `iValley` is the bottom of the conducting ramp,
     which is what "valley current" means to whoever is choosing a part. For a
     flyback they are 0 and I_v, and labelling the tick with the former would
     be wrong. */
  let iMin = Infinity, iMax = -Infinity;
  for (const p of pts) { if (p.i < iMin) iMin = p.i; if (p.i > iMax) iMax = p.i; }
  const iValley = iShape ? iMin : vLo;
  const iPeak = iShape ? iMax : vHi;

  let flowPk = 0;
  for (const p of flowPts) if (p.i > flowPk) flowPk = p.i;

  /* ---- the INPUT capacitor ----

     The most under-appreciated waveform in a buck, and the reason its input
     cap is so much bigger than a beginner expects. The source delivers a
     smooth average; the switch demands the full inductor current for D of the
     period and nothing at all for the rest. The input capacitor makes up the
     entire difference, so it is the part that actually chops.

     KCL at the input node, with current INTO the capacitor positive — the
     same convention the output capacitor and the i_C pane use:

         I_in = i_sw(u) + i_Cin(u),  so  i_Cin(u) = I_in − i_sw(u)

     which is NEGATIVE while the switch conducts (the capacitor is emptying
     itself into the switch, because the source alone cannot keep up) and
     positive while it does not (the source refills it). Getting this
     backwards draws a capacitor that charges hardest exactly when it is in
     fact being drained, which is the opposite of the lesson.

     It steps by the whole inductor current at both edges, which is why input
     ripple is a step and output ripple is a gentle triangle, and why input
     capacitors are chosen by rms current rather than by capacitance.

     Derived here from the switch current the model already has, so it needs
     no new input and cannot describe a different converter than the one being
     drawn. Only for a series switch fed from the input — the family whose
     `wave` spec carries no `vinv`, since that flag marks the topologies whose
     switch returns to ground and whose input current is the continuous
     inductor current instead. */
  const inCap = (() => {
    if (iShape || w.vinv || w.pulses > 1) return null;
    /* the switch conducts for the on-fraction of each sub-interval */
    const swPts = [];
    for (const p of flowPts) swPts.push({ u: p.u, i: p.u <= Dsub + 1e-12 ? p.i : 0 });
    swPts.push({ u: Dsub, i: 0 }, { u: 1, i: 0 });
    swPts.sort((a, b) => a.u - b.u);
    const SL = lookups(swPts);
    const Iin = SL.qTot;                      /* the smooth part the source supplies */
    const cPts = swPts.map((p) => ({ u: p.u, i: Iin - p.i }));
    const CI = lookups(cPts);
    let pk = 0, abs = 0;
    for (const p of cPts) if (Math.abs(p.i) > pk) pk = Math.abs(p.i);
    for (let k = 0; k < cPts.length - 1; k++) {
      if (cPts[k + 1].u > cPts[k].u) {
        abs += ((Math.abs(cPts[k].i) + Math.abs(cPts[k + 1].i)) / 2) * (cPts[k + 1].u - cPts[k].u);
      }
    }
    return { pts: cPts, at: CI.at, qAt: CI.qAt, qAbs: abs, ipk: pk, iavg: Iin };
  })();

  return { D, mode, pts, iAt, slopeAt, iMin, iMax, iValley, iPeak, qAt, qTot,
    /* the animated schematic drives itself from these, not from the trace */
    flowPts, flowAt: FL.at, qFlowAt: FL.qAt, flowTot: FL.qTot, flowPk,
    /* Dsub, not D: the capacitor's own shape is built per sub-interval and
       tiled, exactly as the inductor current above it was. */
    cap: w.cap ? buildCap(pts, Dsub, w.cap, nPulse) : null, inCap, BEND };
}
