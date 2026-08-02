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
      { id: "XF1", type: "XF", n: ["in", "sw", "0", "sec"], ratio: n },
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
      iQ: { kind: "branch", id: "Q1" },
      iD: { kind: "branch", id: "D1" },
      iC: { kind: "branch", id: "C1" },
    },
    plot: "iL",
  };
};

export const SIM = { buck, syncbuck, boost, buckboost, flyback };
