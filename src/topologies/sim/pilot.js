/* Circuits for the topologies the simulator drives.

   A `sim` entry is a function of (spec, res) returning the netlist, the gate
   schedule and the probes worth reading. Component values come from the
   design result wherever the design computes them — the inductance the panel
   prints IS the inductance the simulation runs, so the figure and the
   numbers beside it cannot describe different converters.

   Everything is in SI. Time is normalised to the period everywhere in the
   engine, so the modulator's dead time is a fraction, converted once here.

   Resistances for open devices: 1e7 Ω is high enough that the leakage is
   invisible at any current these circuits carry, and low enough to keep the
   fastest time constant within reach of the step size. It is not a fudge
   factor for accuracy — the exact discretisation is exact at any stiffness —
   it is a bound on how much stiffness the step-size choice has to span. */

const ROFF = 1e7;
const RON_D = 2e-3;

/* Load resistance from the operating point the design was sized at. */
const loadR = (spec, res) => {
  const vo = res && res.pout && spec.iout ? res.pout / spec.iout : spec.vout;
  const io = spec.iout || (res && res.pout && vo ? res.pout / vo : 1);
  return Math.max(vo / Math.max(io, 1e-9), 1e-6);
};

/* The input the converter actually runs at. Most pilots quote a nominal;
   a flyback is specified across a line range and sized at its low corner,
   which is where its duty means what the design says it means. */
const vinOf = (spec) => (spec.vinNom !== undefined ? spec.vinNom
  : spec.vinMin !== undefined ? spec.vinMin : spec.vout);

/* How a winding is specified to saturate: the roll-off a datasheet quotes,
   and the current it is quoted at. cycle.js clamps the roll-off to 0.8, so
   the same ceiling holds here — past that the model stops being a bend in
   the ramp and starts being a different component.

   The reference current is the design's own peak, which is the current the
   datasheet figure would have been read at. */
const satOf = (spec, ipk) => (
  spec.lsag > 0 && ipk > 0
    ? { sat: Math.min(spec.lsag / 100, 0.8), iref: ipk }
    : {}
);

/* The peak the winding actually reaches, from the design's own ripple. */
const peakOf = (res) => {
  const w = res && res.wave;
  if (!w || !Number.isFinite(w.iavg) || !Number.isFinite(w.dI)) return 0;
  return Math.abs(w.iavg) + Math.abs(w.dI) / 2;
};

const common = (spec) => ({
  ron: Math.max((spec.rds || 8) * 1e-3, 1e-6),
  ronS: Math.max((spec.rdsS !== undefined ? spec.rdsS : spec.rds || 8) * 1e-3, 1e-6),
  vf: spec.vf !== undefined ? spec.vf : 0.45,
  dcr: Math.max((spec.dcr || 0) * 1e-3, 0),
  esr: Math.max((spec.esr || 0) * 1e-3, 0),
  coss: Math.max((spec.coss || 0) * 1e-12, 0),
  td: Math.max((spec.td || 0) * 1e-9, 0),
});

/* ------------------------------------------------------------------ buck */
export const buck = (spec, res) => {
  const c = common(spec);
  const L = res.sim.L, C = res.sim.C;
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "Q1", type: "SW", n: ["in", "sw"], ron: c.ron, roff: ROFF },
      { id: "D1", type: "D", n: ["0", "sw"], ron: RON_D, roff: ROFF, vf: c.vf },
      /* The switch node's own capacitance.

         Without it the node is an open circuit during dead time, and an
         inductor forced into an open circuit produces whatever voltage the
         off-state resistance implies — tens of kilovolts, and a body diode
         reading megaamps. C_oss is what really absorbs that current, and
         once it is here the dead-time transition becomes what it physically
         is: the node resonating from one rail toward the other. That is the
         mechanism behind zero-voltage switching, so the model needs it to be
         able to show ZVS at all. */
      { id: "Coss", type: "C", n: ["sw", "0"], value: Math.max(c.coss, 1e-12) },
      { id: "L1", type: "L", n: ["sw", "out"], value: L, esr: c.dcr, ...satOf(spec, peakOf(res)) },
      { id: "C1", type: "C", n: ["out", "0"], value: C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "pwm1", sw: "Q1" },
    seed: { L1: spec.iout, C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

/* -------------------------------------------------------- synchronous buck */
/* The pilot that earns its place: a real dead time, a body diode across the
   low side, and a current that genuinely reverses at light load because
   nothing stops it. */
export const syncbuck = (spec, res) => {
  const c = common(spec);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "Q1", type: "SW", n: ["in", "sw"], ron: c.ron, roff: ROFF },
      { id: "Q2", type: "SW", n: ["sw", "0"], ron: c.ronS, roff: ROFF },
      /* Both body diodes, not just the low-side one.

         A MOSFET has one whichever way up it is fitted, and the high-side
         diode is the one that matters exactly when the converter is most
         interesting: at light load the inductor current runs backwards, and
         at the dead time after the low-side switch opens that reversed
         current has to climb back to the input rail. With only the low-side
         diode modelled it has no path at all, so it pins at zero for the
         width of the dead time — a converter that appears to fall into
         discontinuous conduction when what it is really doing is returning
         energy to the source. */
      { id: "Dbody", type: "D", n: ["0", "sw"], ron: RON_D, roff: ROFF, vf: Math.min(c.vf, 0.8) },
      { id: "Dbody1", type: "D", n: ["sw", "in"], ron: RON_D, roff: ROFF, vf: Math.min(c.vf, 0.8) },
      /* The switch node's own capacitance.

         Without it the node is an open circuit during dead time, and an
         inductor forced into an open circuit produces whatever voltage the
         off-state resistance implies — tens of kilovolts, and a body diode
         reading megaamps. C_oss is what really absorbs that current, and
         once it is here the dead-time transition becomes what it physically
         is: the node resonating from one rail toward the other. That is the
         mechanism behind zero-voltage switching, so the model needs it to be
         able to show ZVS at all. */
      { id: "Coss", type: "C", n: ["sw", "0"], value: Math.max(2 * c.coss, 1e-12) },
      { id: "L1", type: "L", n: ["sw", "out"], value: res.sim.L, esr: c.dcr, ...satOf(spec, peakOf(res)) },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "complementary", hi: "Q1", lo: "Q2", td: c.td },
    seed: { L1: spec.iout, C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iQ2: { kind: "branch", id: "Q2" },
      iD: { kind: "branch", id: "Dbody" },
      iD1: { kind: "branch", id: "Dbody1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

/* ----------------------------------------------------------------- boost */
export const boost = (spec, res) => {
  const c = common(spec);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "L1", type: "L", n: ["in", "sw"], value: res.sim.L, esr: c.dcr, ...satOf(spec, peakOf(res)) },
      { id: "Q1", type: "SW", n: ["sw", "0"], ron: c.ron, roff: ROFF },
      { id: "D1", type: "D", n: ["sw", "out"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "pwm1", sw: "Q1" },
    seed: { L1: spec.iout / Math.max(1 - (res.wave ? res.wave.D : 0.5), 0.05), C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

/* ------------------------------------------------- inverting buck-boost */
export const buckboost = (spec, res) => {
  const c = common(spec);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "Q1", type: "SW", n: ["in", "sw"], ron: c.ron, roff: ROFF },
      { id: "L1", type: "L", n: ["sw", "0"], value: res.sim.L, esr: c.dcr, ...satOf(spec, peakOf(res)) },
      /* output is negative, so the rectifier points from the output node
         back into the switch node */
      { id: "D1", type: "D", n: ["out", "sw"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "pwm1", sw: "Q1" },
    seed: { L1: spec.iout / Math.max(1 - (res.wave ? res.wave.D : 0.5), 0.05), C1: -spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

/* --------------------------------------------------------------- flyback */
/* Magnetising inductance in parallel with an ideal transformer — the standard
   model, and the reason to use the standard one is that it fails loudly when
   miswired. Every departure from it here was a bug, not a simplification. */
export const flyback = (spec, res) => {
  const c = common(spec);
  const n = Math.max(res.sim.n || spec.ncell || 4, 0.05);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      /* No leakage inductance here, deliberately.

         Leakage without a clamp is not a simplification, it is a different
         and impossible circuit: at turn-off its current has no path at all,
         so the model asks what voltage appears across an open switch and the
         answer runs away. Real flybacks answer that question with an RCD or
         active clamp, and `vclamp` is already an input waiting for one. The
         leakage spike and its ringing arrive together with that clamp, as
         their own piece of work — drawing the ring is the point of it. */
      { id: "Lm", type: "L", n: ["in", "sw"], value: res.sim.L, esr: c.dcr, ...satOf(spec, peakOf(res)) },
      /* The secondary is anti-phase — n2/n3 swapped — and that is the whole
         difference between a flyback and a forward converter. In phase, the
         rectifier conducts while the switch is on and the transformer
         delivers straight through; anti-phase, it blocks during the on-time
         and the core hands its stored energy over during the off-time, which
         is what a flyback does. Wired the wrong way it still converges, still
         regulates, and reads about 20 % high: a plausible answer from the
         wrong circuit. */
      { id: "XF1", type: "XF", n: ["in", "sw", "0", "sec"], ratio: n, phase: "opposing" },
      { id: "Q1", type: "SW", n: ["sw", "0"], ron: c.ron, roff: ROFF },
      { id: "D1", type: "D", n: ["sec", "out"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "pwm1", sw: "Q1" },
    seed: { Lm: spec.iout / Math.max(n, 0.05), C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "Lm" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};



/* ------------------------------------------- the coupled-capacitor family */
/* SEPIC, Ćuk and Zeta are the same five parts in three arrangements, and the
   arrangement is the whole lesson: where the series capacitor sits decides
   which port pulsates and which sign the output takes. Wiring them as
   circuits rather than as three sets of equations is what makes that visible
   — the same components, moved.

   Each has two windings and a capacitor that carries the full load current
   between them, so the states are i_L1, i_L2, v_Cc, v_Cout and the switch
   node's own capacitance. */

/* Ćuk: inverting, and quiet at both ports because a winding faces each. */
export const cuk = (spec, res) => {
  const c = common(spec);
  const ipk = peakOf(res);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "L1", type: "L", n: ["in", "sw"], value: res.sim.L, esr: c.dcr, ...satOf(spec, ipk) },
      { id: "Q1", type: "SW", n: ["sw", "0"], ron: c.ron, roff: ROFF },
      { id: "Coss", type: "C", n: ["sw", "0"], value: Math.max(c.coss, 1e-12) },
      /* The coupling capacitor is the whole converter: energy crosses it in
         an electric field rather than in a core, which is what makes this
         the dual of the buck-boost rather than a variation on it. */
      { id: "Cc", type: "C", n: ["sw", "mid"], value: res.sim.Cc, esr: c.esr },
      /* Anode at the capacitor's far side, cathode at ground. During the
         off-time the input winding charges the coupling capacitor, and that
         current has to return to the source — it does so out of this node,
         through the diode, to ground. Pointed the other way the converter
         still runs and settles on a positive rail, which a Ćuk does not
         have. */
      { id: "D1", type: "D", n: ["mid", "0"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "L2", type: "L", n: ["mid", "out"], value: res.sim.L2, esr: c.dcr, ...satOf(spec, ipk) },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "pwm1", sw: "Q1" },
    seed: { L1: spec.iout, L2: -spec.iout, Cc: spec.vinNom + spec.vout, C1: -spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      iL2: { kind: "branch", id: "L2" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

/* SEPIC: the series capacitor blocks DC, so a shorted output cannot drag the
   input down through the rectifier — which is the reason to choose it. */
export const sepic = (spec, res) => {
  const c = common(spec);
  const ipk = peakOf(res);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "L1", type: "L", n: ["in", "sw"], value: res.sim.L, esr: c.dcr, ...satOf(spec, ipk) },
      { id: "Q1", type: "SW", n: ["sw", "0"], ron: c.ron, roff: ROFF },
      { id: "Coss", type: "C", n: ["sw", "0"], value: Math.max(c.coss, 1e-12) },
      { id: "Cc", type: "C", n: ["sw", "mid"], value: res.sim.Cc, esr: c.esr },
      /* The second winding returns to ground rather than to the output, and
         that single difference is what turns a Ćuk's inverted rail the right
         way up. */
      { id: "L2", type: "L", n: ["mid", "0"], value: res.sim.L2, esr: c.dcr, ...satOf(spec, ipk) },
      { id: "D1", type: "D", n: ["mid", "out"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "pwm1", sw: "Q1" },
    seed: { L1: spec.iout, L2: spec.iout, Cc: spec.vinNom, C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      iL2: { kind: "branch", id: "L2" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

/* Zeta: a SEPIC turned around, so the winding faces the load and the output
   current is continuous. The switch moves to the high side with it. */
export const zeta = (spec, res) => {
  const c = common(spec);
  const ipk = peakOf(res);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "Q1", type: "SW", n: ["in", "sw"], ron: c.ron, roff: ROFF },
      { id: "Coss", type: "C", n: ["sw", "0"], value: Math.max(c.coss, 1e-12) },
      { id: "L1", type: "L", n: ["sw", "0"], value: res.sim.L, esr: c.dcr, ...satOf(spec, ipk) },
      { id: "D1", type: "D", n: ["0", "mid"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "Cc", type: "C", n: ["sw", "mid"], value: res.sim.Cc, esr: c.esr },
      { id: "L2", type: "L", n: ["mid", "out"], value: res.sim.L2, esr: c.dcr, ...satOf(spec, ipk) },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: { kind: "pwm1", sw: "Q1" },
    seed: { L1: spec.iout, L2: spec.iout, Cc: spec.vinNom, C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L2" },
      iL1: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

/* ---------------------------------------------------- multiphase buck ---- */
/* N synchronous buck cells across one output capacitor, each started a
   further 1/N of a period along.

   The interleaving is the entire converter. Three cells a third of a period
   apart draw from the input in turn, so the ripple they hand the capacitors
   partly cancels — at a duty of exactly m/N it cancels completely, which is
   the null the design warns about. None of that is authored here: the cells
   are identical and the offsets are the only thing that distinguishes them,
   so whatever cancellation appears is what the circuit does.

   This is also the first netlist whose size is set by an input. At the field's
   maximum of 24 phases the state vector is 49 long, which the old
   finite-difference Jacobian would have refused to shoot at. */
export const multiphase = (spec, res) => {
  const c = common(spec);
  const N = Math.max(1, Math.round(res.sim.nph || 1));
  const branches = [
    { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
    { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
    { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
  ];
  const parts = [], probes = {
    vout: { kind: "node", id: "out" },
    iin: { kind: "branch", id: "Vin" },
    iC: { kind: "branch", id: "C1" },
  };
  /* The design sizes L for ONE phase's ripple, so every cell carries the same
     inductance and the same share of the load. */
  const ipk = peakOf(res);
  for (let k = 1; k <= N; k++) {
    const sw = `sw${k}`;
    branches.push(
      { id: `Q${k}H`, type: "SW", n: ["in", sw], ron: c.ron, roff: ROFF },
      { id: `Q${k}L`, type: "SW", n: [sw, "0"], ron: c.ron, roff: ROFF },
      { id: `Coss${k}`, type: "C", n: [sw, "0"], value: Math.max(c.coss, 1e-12) },
      { id: `L${k}`, type: "L", n: [sw, "out"], value: res.sim.L, esr: c.dcr,
        ...satOf(spec, ipk) },
    );
    parts.push({ kind: "complementary", hi: `Q${k}H`, lo: `Q${k}L`, td: c.td,
      phase: (k - 1) / N });
    /* Phase 1 is the one the figure plots; the rest are named so the
       cancellation can be measured rather than asserted. */
    probes[k === 1 ? "iL" : `iL${k}`] = { kind: "branch", id: `L${k}` };
  }
  probes.vsw = { kind: "node", id: "sw1" };
  probes.iQ = { kind: "branch", id: "Q1H" };

  /* Seed each phase where it actually is, not where the average is.

     Interleaved phases are at different points of their own ramp at t = 0,
     so seeding them all at the mean current is not a neutral guess — it is a
     deliberate excitation of the one mode this converter cannot damp. The sum
     of the phase currents is held by the output, but the DIFFERENCE between
     them is opposed by nothing except winding resistance, which is why real
     interleaved converters need active current sharing and why the solver
     was spending five hundred periods watching an imbalance decay that need
     never have existed.

     Placed on its own ramp instead, the whole thing converges in a dozen. */
  const D = Math.min(Math.max((res.wave && res.wave.D) || 0.5, 1e-3), 0.999);
  const iavg = (res.wave && res.wave.iavg) || spec.iout / N;
  const dI = (res.wave && res.wave.dI) || 0;
  const rampAt = (p) => (p < D
    ? iavg - dI / 2 + (dI / D) * p
    : iavg + dI / 2 - (dI / (1 - D)) * (p - D));
  const seed = { C1: spec.vout };
  for (let k = 1; k <= N; k++) {
    /* shift(m, ph) makes a part see its own time as u − ph, so at u = 0
       phase k sits at 1 − (k−1)/N of its own cycle. */
    seed[`L${k}`] = rampAt((((1 - (k - 1) / N) % 1) + 1) % 1);
  }
  return {
    branches, gates: { kind: "combine", parts }, seed, probes, plot: "iL",
    /* The figure plots phase 1; the capacitor is fed by all N. */
    capFromPlot: false,
  };
};

/* ------------------------------------------------ four-switch buck-boost -- */
/* One inductor between two half bridges, and which pair switches depends on
   where the input sits relative to the output.

   The netlist is the same in both modes because the HARDWARE is the same in
   both modes — that is the entire idea of the topology. Only the schedule
   differs: below V_out the input leg chops and the output leg is a wire;
   above it the input leg is a wire and the output leg chops. Expressing that
   needs a part to carry its own duty rather than inherit the design's, which
   is what `d` on a gate spec is for: a switch held on is `d: 1`, one held off
   is `d: 0`, and neither is a special case in the modulator.

   Both devices only ever block the larger of the two rails, never their sum,
   which is why this converter stays efficient through V_in ≈ V_out where an
   inverting buck-boost is at its worst. */
export const fsbb = (spec, res) => {
  const c = common(spec);
  const boost = res.mode === "boost";
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "Q1", type: "SW", n: ["in", "a"], ron: c.ron, roff: ROFF },
      { id: "Q2", type: "SW", n: ["a", "0"], ron: c.ron, roff: ROFF },
      { id: "CossA", type: "C", n: ["a", "0"], value: Math.max(c.coss, 1e-12) },
      { id: "L1", type: "L", n: ["a", "b"], value: res.sim.L, esr: c.dcr,
        ...satOf(spec, peakOf(res)) },
      { id: "Q3", type: "SW", n: ["b", "0"], ron: c.ron, roff: ROFF },
      { id: "Q4", type: "SW", n: ["b", "out"], ron: c.ron, roff: ROFF },
      { id: "CossB", type: "C", n: ["b", "0"], value: Math.max(c.coss, 1e-12) },
      { id: "C1", type: "C", n: ["out", "0"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "0"], value: loadR(spec, res) },
    ],
    gates: boost
      /* Input leg is a wire; the output leg chops. Q3 shorts the far end of
         the inductor to ground for D, then Q4 delivers into the output. */
      ? { kind: "combine", parts: [
        { kind: "pwm1", sw: "Q1", d: 1 },
        { kind: "pwm1", sw: "Q2", d: 0 },
        { kind: "complementary", hi: "Q3", lo: "Q4", td: c.td },
      ] }
      /* Output leg is a wire; the input leg chops, and it is a plain buck. */
      : { kind: "combine", parts: [
        { kind: "complementary", hi: "Q1", lo: "Q2", td: c.td },
        { kind: "pwm1", sw: "Q3", d: 0 },
        { kind: "pwm1", sw: "Q4", d: 1 },
      ] },
    seed: { L1: (res.wave && res.wave.iavg) || spec.iout, C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      /* The node that is actually swinging, which is a different one in each
         mode — the static leg's node sits at a rail. */
      vsw: { kind: "node", id: boost ? "b" : "a" },
      vout: { kind: "node", id: "out" },
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: boost ? "Q3" : "Q1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

export const SIM = {
  buck, syncbuck, boost, buckboost, flyback, cuk, sepic, zeta,
  multiphase, fsbb,
};
