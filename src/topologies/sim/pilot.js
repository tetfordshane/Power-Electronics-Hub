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



/* ------------------------------------------------ two-switch forward ----- */
/* The other thing a transformer can do. A flyback stores energy in its core
   and hands it over afterwards; a forward passes it straight across while the
   switch is on, and an output choke — a buck's choke, behind a transformer —
   does the storing. Everything below follows from that one difference: the
   secondary is IN PHASE, there is a freewheel diode because the output must be
   fed during the off-time by something, and the core has to be emptied by a
   route of its own because nothing else empties it.

   That route is the two clamp diodes, and they are the reason this netlist has
   a magnetising inductance at all. D_a and D_b conduct for exactly as long as
   the magnetising current takes to fall back to zero, which is an interval the
   figure draws — so the circuit has to have a magnetising current for them to
   carry. See the design function for where its value comes from. */
export const forward2 = (spec, res) => {
  const c = common(spec);
  const n = Math.max(res.sim.n, 1e-4);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      /* Both switches in series with the winding, which is what clamps them:
         neither can ever see more than the rail, because the clamp diodes
         reach the same two nodes. */
      { id: "Q1", type: "SW", n: ["in", "pa"], ron: c.ron, roff: ROFF },
      { id: "Q2", type: "SW", n: ["pb", "0"], ron: c.ron, roff: ROFF },
      /* The reset path, and it returns the energy rather than burning it: the
         magnetising current leaves the far end of the winding, climbs to the
         input rail through D_b, and comes back to the near end from ground
         through D_a. The winding then sees −V_in, which is why the reset takes
         as long as the on-time and why the duty has to stay below a half. */
      { id: "Da", type: "D", n: ["0", "pa"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "Db", type: "D", n: ["pb", "in"], ron: RON_D, roff: ROFF, vf: c.vf },
      /* No switch-node capacitance, and this is the one topology so far where
         leaving it out is right rather than lazy.

         C_oss is in the other netlists because a complementary pair has a dead
         time, and an inductor facing an open circuit across it produces
         whatever voltage the off-state resistance implies. Nothing here is
         complementary: both switches close together and open together, and the
         instant they open the clamp diodes are already the magnetising
         current's path. No interval leaves a winding with nowhere to go.

         Adding one anyway is not free. A capacitor between an ideal switch and
         a 390 V rail is charged through the channel in R_DS·C_oss — which at
         the idealised corner is 10⁻¹⁸ s, five orders of magnitude below the
         finest step the solver takes after an edge. The charge involved is
         femtocoulombs and the trapezoidal rule spreads it into amps, which
         reads as three quarters of a kilowatt arriving from nowhere. That is
         a measurement artefact rather than a converter, and the way not to
         measure it is not to build a time constant nothing can see. */
      { id: "Lm", type: "L", n: ["pa", "pb"], value: res.sim.Lm },
      /* In phase — the whole difference from a flyback. The primary is driven
         and the secondary delivers at the same instant, through the ratio. */
      { id: "XF1", type: "XF", n: ["pa", "pb", "sec", "sgnd"], ratio: 1 / n, phase: "aiding" },
      { id: "D3", type: "D", n: ["sec", "sw"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "D4", type: "D", n: ["sgnd", "sw"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "L1", type: "L", n: ["sw", "out"], value: res.sim.L, esr: c.dcr,
        ...satOf(spec, peakOf(res)) },
      { id: "C1", type: "C", n: ["out", "sgnd"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "sgnd"], value: loadR(spec, res) },
    ],
    /* A real barrier, declared. Nothing on the secondary side touches the
       primary's ground, so its potential is fixed by the leakage and the
       Y-capacitance a real supply has — one 1 GΩ tie stands for both. */
    isolated: ["sgnd"],
    gates: { kind: "combine", parts: [{ kind: "pwm1", sw: "Q1" }, { kind: "pwm1", sw: "Q2" }] },
    seed: { L1: spec.iout, C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "pa" },
      vout: { kind: "node", id: "out" },
      /* Not drawn. It is what lets check-sim ask whether the power going in
         matches the power coming out — the question that catches a circuit
         which converges beautifully to the wrong answer. Named outside the
         /^i[QD]/ family on purpose, so it never joins the conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iD3: { kind: "branch", id: "D3" },
      iD4: { kind: "branch", id: "D4" },
      iDa: { kind: "branch", id: "Da" },
      iDb: { kind: "branch", id: "Db" },
      iC: { kind: "branch", id: "C1" },
    },
    /* The output rectifier and the freewheel diode are the two alternatives
       the choke current takes, so their magnitudes add to it exactly. The
       primary is deliberately not in this sum: it conducts at the same instant
       as D3 and carries a different current, and adding the two would report a
       quantity that flows nowhere. Each drawn path names its own probe
       instead — see `rides` in flow.js. */
    flow: ["iD3", "iD4"],
    /* Which rectifier's timing stands behind the phase claim. D4 conducts in
       whatever interval is left over however the transformer is wound, so it
       is no evidence at all; D3 conducts only while the primary is driven, and
       only if the secondary is in phase. */
    rectifier: "iD3",
    plot: "iL",
  };
};

/* ------------------------------------------------------------ push-pull -- */
/* Four windings on one core, and the element here couples two — so the core is
   composed rather than stamped.

   One winding is the reference: the upper half of the primary. Every other
   winding is the secondary of its own XF whose primary is that same pair, so
   each transformer relates one winding to the reference and the ampere-turns
   add up by themselves — each secondary carries −r times its own primary
   current, and those primary currents all flow in the reference winding. What
   composition can get wrong is agreement, and netlist.validate() holds the
   three branches to describing one core rather than three.

   Which way each half is wound is the part worth reading slowly. The primary
   is ONE winding from pa through the centre tap to pb, so a volt per turn is a
   volt per turn all the way along: v(ct) − v(pa) = v(pb) − v(ct). That is why
   grounding pa puts 2·V_in on the other switch, which is the whole character
   of this topology, and it is why the lower half is written ["pb", "in"] — the
   continuation of the upper half, not a mirror of it. The secondary reads the
   same way round, so Q1 lights D1, which is what the figure above says. */
export const pushpull = (spec, res) => {
  const c = common(spec);
  const n = Math.max(res.sim.n, 1e-4);
  const XF = { type: "XF", n: ["in", "pa"], phase: "aiding" };
  return {
    branches: [
      /* The source feeds the centre tap, so `in` is both the supply node and
         the junction of the two half-primaries. */
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "Q1", type: "SW", n: ["pa", "0"], ron: c.ron, roff: ROFF },
      { id: "Q2", type: "SW", n: ["pb", "0"], ron: c.ron, roff: ROFF },
      { id: "Lm", type: "L", n: ["in", "pa"], value: res.sim.Lm },
      /* The other half of the primary, at the same turns. */
      { ...XF, id: "XFp", n: ["in", "pa", "pb", "in"], ratio: 1 },
      /* The two secondary halves, each n times the half-primary. */
      { ...XF, id: "XFa", n: ["in", "pa", "sa", "sct"], ratio: 1 / n },
      { ...XF, id: "XFb", n: ["in", "pa", "sct", "sb"], ratio: 1 / n },
      { id: "D1", type: "D", n: ["sa", "rect"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "D2", type: "D", n: ["sb", "rect"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "L1", type: "L", n: ["rect", "out"], value: res.sim.L, esr: c.dcr,
        ...satOf(spec, peakOf(res)) },
      { id: "C1", type: "C", n: ["out", "sct"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "sct"], value: loadR(spec, res) },
    ],
    isolated: ["sct"],
    /* Both gates ground-referenced and half a period apart — the reason to
       choose this topology at a low input voltage. Neither is complementary:
       between them the primary is undriven and the choke freewheels through
       both rectifiers at once, which is the interval that makes each diode
       average half the load whatever the duty. */
    gates: { kind: "combine", parts: [
      { kind: "pwm1", sw: "Q1" },
      { kind: "pwm1", sw: "Q2", phase: 0.5 },
    ] },
    seed: { L1: spec.iout, C1: spec.vout },
    probes: {
      iL: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "pa" },
      vout: { kind: "node", id: "out" },
      /* Not drawn — check-sim's power balance reads it, and it is named
         outside the /^i[QD]/ family so it never joins a conduction sum. */
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iQ2: { kind: "branch", id: "Q2" },
      iD1: { kind: "branch", id: "D1" },
      iD2: { kind: "branch", id: "D2" },
      iC: { kind: "branch", id: "C1" },
    },
    /* The two rectifiers are the choke current's alternatives and add to it
       exactly, including across the freewheel where it splits between them.
       The primary is not in the sum: it conducts at the same instant and
       carries a different current. */
    flow: ["iD1", "iD2"],
    /* Named so the phase claim is examined rather than skipped. What it finds
       here is that a push-pull has no idle half for a miswound secondary to
       rectify in — both half-cycles are driven, and reversing the whole
       secondary maps the circuit onto itself. check-sim says so out loud and
       hands the claim to the composition check, which is where the error a
       centre tap can actually make lives. */
    rectifier: "iD1",
    plot: "iL",
  };
};

/* ----------------------------------------------------------- half-bridge */
/* The same centre-tapped secondary as the push-pull, driven from the other
   side of the argument: instead of doubling the voltage each switch blocks in
   order to keep both gates on the ground rail, halve the voltage the winding
   sees in order to keep each switch at the rail. That is what the capacitor
   divider is for, and it is why almost every off-line supply above 200 W
   starts here.

   Two things about the divider are worth knowing before editing it. Two ideal
   capacitors in series across an ideal source is a loop of voltage sources —
   a capacitor is stamped as a voltage source of its own state — so the matrix
   is singular and `compile` returns null. What breaks the loop is the thing
   that breaks it in reality: a film capacitor has series resistance, and once
   it is here the divider's SUM is held at the rail by a fast loop while its
   SPLIT is held by nothing at all, which is exactly true of the real circuit
   and exactly why real dividers carry balancing resistors. The split is seeded
   at half the rail and stays there, because nothing moves it. */
const ESR_FILM = 5e-3;

export const halfbridge = (spec, res) => {
  const c = common(spec);
  const n = Math.max(res.sim.n, 1e-4);
  const XF = { type: "XF", n: ["sw", "pb"], phase: "aiding" };
  const vin = vinOf(spec);
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vin },
      { id: "Ca", type: "C", n: ["in", "mid"], value: res.sim.Cdiv, esr: ESR_FILM },
      { id: "Cb", type: "C", n: ["mid", "0"], value: res.sim.Cdiv, esr: ESR_FILM },
      { id: "Q1", type: "SW", n: ["in", "sw"], ron: c.ron, roff: ROFF },
      { id: "Q2", type: "SW", n: ["sw", "0"], ron: c.ron, roff: ROFF },
      /* In series with the primary, and the reason a half-bridge does not walk
         its flux: any asymmetry between the two half-cycles charges this, and
         the charge opposes the asymmetry. It settles at zero volts, because
         the divider has already done the level shift. */
      { id: "Cblk", type: "C", n: ["mid", "pb"], value: res.sim.Cblk, esr: ESR_FILM },
      { id: "Lm", type: "L", n: ["sw", "pb"], value: res.sim.Lm },
      { ...XF, id: "XFa", n: ["sw", "pb", "sa", "sct"], ratio: 1 / n },
      { ...XF, id: "XFb", n: ["sw", "pb", "sct", "sb"], ratio: 1 / n },
      { id: "D1", type: "D", n: ["sa", "rect"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "D2", type: "D", n: ["sb", "rect"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "L1", type: "L", n: ["rect", "out"], value: res.sim.L, esr: c.dcr,
        ...satOf(spec, peakOf(res)) },
      { id: "C1", type: "C", n: ["out", "sct"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "sct"], value: loadR(spec, res) },
    ],
    isolated: ["sct"],
    gates: { kind: "combine", parts: [
      { kind: "pwm1", sw: "Q1" },
      { kind: "pwm1", sw: "Q2", phase: 0.5 },
    ] },
    /* Half the rail on each divider capacitor: the one state the circuit will
       not find for itself, because nothing in it pushes the split either way. */
    seed: { L1: spec.iout, C1: spec.vout, Ca: vin / 2, Cb: vin / 2 },
    probes: {
      iL: { kind: "branch", id: "L1" },
      vsw: { kind: "node", id: "sw" },
      vout: { kind: "node", id: "out" },
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iQ2: { kind: "branch", id: "Q2" },
      iD1: { kind: "branch", id: "D1" },
      iD2: { kind: "branch", id: "D2" },
      iC: { kind: "branch", id: "C1" },
    },
    flow: ["iD1", "iD2"],
    rectifier: "iD1",
    plot: "iL",
  };
};

/* --------------------------------------------- phase-shifted full bridge */
/* Both legs run flat out at fifty-fifty and nothing is throttled by duty at
   all — what is varied is how far one leg is slid against the other, and the
   overlap between the diagonals is the power interval. So the schedule is two
   complementary legs and one `phase`, and the design's own D is the shift.

   The interesting interval is the one between them, and it is the reason this
   netlist carries parts the other bridges do not. When a diagonal opens, the
   current in L_r keeps flowing and has nowhere to go but the switch-node
   capacitances — it discharges the one that is about to close and charges the
   one that just opened, and the body diode catches the node when it arrives at
   the far rail. The switch then closes across nothing. All four body diodes and
   both node capacitances are here because that sequence is what the figure
   claims happens, and none of it can happen without them: no capacitance and
   the node is an open circuit driven by an inductor, no body diode and it sails
   past the rail to whatever the off-state resistance implies.

   Whether it arrives in time is not authored either. The lagging leg has only
   L_r's own energy to swing with, so at light load it does not make it and
   turns on hard — which is the caution the panel prints, arrived at rather
   than asserted. */
export const psfb = (spec, res) => {
  const c = common(spec);
  const n = Math.max(res.sim.n, 1e-4);
  const vf = Math.min(c.vf, 0.8);
  const D = res.wave && res.wave.D !== undefined ? res.wave.D : 0.5;
  /* Leg A's midpoint IS the winding's far terminal — no series element between
     them — so it is written as one node. The primary is written that terminal
     first, so the power interval (Q1 high, Q4 low: the diagonal the figure
     opens on) drives it positive. */
  const XF = { type: "XF", n: ["a", "pa"], phase: "aiding" };
  return {
    branches: [
      { id: "Vin", type: "V", n: ["in", "0"], value: vinOf(spec) },
      { id: "Q1", type: "SW", n: ["in", "a"], ron: c.ron, roff: ROFF },
      { id: "Q2", type: "SW", n: ["a", "0"], ron: c.ron, roff: ROFF },
      { id: "Q3", type: "SW", n: ["in", "b"], ron: c.ron, roff: ROFF },
      { id: "Q4", type: "SW", n: ["b", "0"], ron: c.ron, roff: ROFF },
      { id: "Db1", type: "D", n: ["a", "in"], ron: RON_D, roff: ROFF, vf },
      { id: "Db2", type: "D", n: ["0", "a"], ron: RON_D, roff: ROFF, vf },
      { id: "Db3", type: "D", n: ["b", "in"], ron: RON_D, roff: ROFF, vf },
      { id: "Db4", type: "D", n: ["0", "b"], ron: RON_D, roff: ROFF, vf },
      { id: "CossA", type: "C", n: ["a", "0"], value: Math.max(c.coss, 1e-12) },
      { id: "CossB", type: "C", n: ["b", "0"], value: Math.max(c.coss, 1e-12) },
      /* Leg A reaches the winding directly; leg B reaches it through L_r,
         which is the leakage plus whatever was added to it on purpose. */
      { id: "Lr", type: "L", n: ["b", "pa"], value: res.sim.Lr },
      { id: "Lm", type: "L", n: ["a", "pa"], value: res.sim.Lm },
      { ...XF, id: "XFa", n: ["a", "pa", "sa", "sct"], ratio: 1 / n },
      { ...XF, id: "XFb", n: ["a", "pa", "sct", "sb"], ratio: 1 / n },
      { id: "D1", type: "D", n: ["sa", "rect"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "D2", type: "D", n: ["sb", "rect"], ron: RON_D, roff: ROFF, vf: c.vf },
      { id: "L1", type: "L", n: ["rect", "out"], value: res.sim.L, esr: c.dcr,
        ...satOf(spec, peakOf(res)) },
      { id: "C1", type: "C", n: ["out", "sct"], value: res.sim.C, esr: c.esr },
      { id: "Rload", type: "R", n: ["out", "sct"], value: loadR(spec, res) },
    ],
    isolated: ["sct"],
    /* Two legs at a flat fifty per cent, one slid along by the design's own
       effective duty. Slide them together and the diagonals never overlap and
       the transformer sees nothing; slide them apart and the overlap is the
       power interval. That is the control, and it is one number here. */
    gates: { kind: "combine", parts: [
      { kind: "complementary", hi: "Q1", lo: "Q2", d: 0.5, td: res.sim.td },
      { kind: "complementary", hi: "Q3", lo: "Q4", d: 0.5, td: res.sim.td, phase: D },
    ] },
    seed: {
      L1: spec.iout, C1: spec.vout, Lr: n * spec.iout,
      CossA: vinOf(spec), CossB: 0,
    },
    probes: {
      iL: { kind: "branch", id: "L1" },
      /* The lagging leg's node — the one whose transition is in question. */
      vsw: { kind: "node", id: "b" },
      vout: { kind: "node", id: "out" },
      iin: { kind: "branch", id: "Vin" },
      iQ: { kind: "branch", id: "Q1" },
      iQ4: { kind: "branch", id: "Q4" },
      iD1: { kind: "branch", id: "D1" },
      iD2: { kind: "branch", id: "D2" },
      iC: { kind: "branch", id: "C1" },
      /* The primary current, which in this converter never stops: it keeps
         circulating through the freewheel intervals, and that is both what
         buys the soft switching and what costs the light-load efficiency.
         Outside the /^i[QD]/ family because it is not an alternative to
         anything — it flows at the same time as the rectifiers. */
      ipri: { kind: "branch", id: "Lr" },
    },
    flow: ["iD1", "iD2"],
    rectifier: "iD1",
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
  buck, syncbuck, boost, buckboost, flyback, forward2, pushpull, halfbridge, psfb,
  cuk, sepic, zeta,
  multiphase, fsbb,
};
