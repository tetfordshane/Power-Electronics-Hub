/* The input registry and the small helpers every design function uses.

   No JSX: the check scripts and the golden tests import this directly. */
/* --------------------------- input registry ---------------------------
   mn / mx are hard clamps applied in App before any design() sees the
   number, so a stray 0 or a negative can never propagate as Infinity or
   NaN into a result table. They are also fed to the <input> element so
   the browser's own validation agrees with ours.                       */
const FIELDS = {
  vacIn: { l: "V_ac in", u: "Vrms", d: 230, mn: 1, mx: 1000, help: "The mains voltage feeding the rectifier, quoted as rms — 230 V in most of the world, 120 V in North America. Everything downstream is sized from its peak, which is √2 times this." },
  idc: { l: "I_dc load", u: "A", d: 1, mn: 1e-3, mx: 1e4, help: "The steady current the load draws from the rectified rail. It sets the bulk capacitor's ripple and the conduction loss in every device on the way." },
  cbulk: { l: "C_bulk", u: "µF", d: 470, mn: 0.1, mx: 1e6, help: "The reservoir capacitor after the rectifier. It carries the load through the gaps between mains peaks, so raising it flattens the ripple and lengthens the conduction angle — which is why bigger is not free: the charging pulses get taller and narrower." },
  vsec: { l: "V_sec (square)", u: "V", d: 12, mn: 0.1, mx: 1e4, help: "The transformer secondary voltage, as a square wave amplitude. It is what the rectifier sees, so it fixes the output before the diode drop is taken off." },
  dnom: { l: "duty D", u: "", d: 0.4, s: 0.01, mn: 0.01, mx: 0.99, help: "Duty cycle: the fraction of each switching period the main switch conducts. For most converters this alone sets the conversion ratio." },
  ql: { l: "loaded Q", u: "", d: 6, s: 0.5, mn: 0.1, mx: 100, help: "Loaded quality factor of the resonant tank — how sharply it is tuned once the load is connected. Low Q means a gentle, broad gain curve; high Q means a peaky one that regulates over a narrow frequency range." },
  vg: { l: "V_gate", u: "V", d: 10, mn: 1, mx: 30, help: "Gate drive voltage. It multiplies the gate charge to give the driver's own dissipation, and it is the number the gate rating has to tolerate." },
  vinMin: { l: "V_in min", u: "V", d: 9, mn: 0.1, mx: 2000, help: "The lowest input voltage the converter must still work at. This is usually the corner that decides the worst-case duty and the peak current — a design that only works at nominal is not a design." },
  vinNom: { l: "V_in nom", u: "V", d: 12, mn: 0.1, mx: 2000, help: "The input voltage the converter spends most of its life at. Efficiency and thermals are judged here." },
  vinMax: { l: "V_in max", u: "V", d: 16, mn: 0.1, mx: 2000, help: "The highest input voltage the converter must survive. It sets device voltage ratings, and for a buck it is also where the ripple is worst." },
  vout: { l: "V_out", u: "V", d: 3.3, mn: 0.05, mx: 2000, help: "The output voltage being regulated." },
  iout: { l: "I_out", u: "A", d: 10, mn: 1e-3, mx: 1e4, help: "The full-load output current. Almost every conduction loss scales with its square, so this is the number that decides how hot things get." },
  fsw: { l: "f_sw", u: "kHz", d: 500, mn: 0.1, mx: 1e5, help: "Switching frequency. Raising it shrinks the inductor and capacitor — both scale roughly as 1/f_sw — and raises every switching loss in direct proportion. That trade is the central choice in a power supply." },
  /* Ripple ratio. The ceiling has to sit above 2, or discontinuous
     conduction is unreachable: ΔI is proportional to I_out here, so the
     boundary I_out = ΔI/2 lands at ΔI/I ≈ 2 and the tool's own DCM warning
     could never fire. */
  r: { l: "ripple ΔI/I", u: "", d: 0.3, s: 0.05, mn: 0.01, mx: 3, help: "How much the inductor current is allowed to swing, as a fraction of the average. Around 0.3 is the usual compromise: smaller means a bigger inductor, larger means more rms current and more core loss. Above 2 the current reaches zero and the converter falls into discontinuous conduction." },
  dvout: { l: "ΔV_out p-p", u: "mV", d: 30, mn: 0.1, mx: 1e5, help: "The output ripple budget, peak to peak. It sizes the output capacitor — and once the capacitor is large enough, its ESR rather than its capacitance is what you are fighting." },
  eff: { l: "target η", u: "", d: 0.9, s: 0.01, mn: 0.1, mx: 1, help: "The efficiency you expect, used to work out how much input power is needed for the requested output. It is a target, not a result: the loss budget below computes the efficiency the parts actually give." },
  esr: { l: "C_out ESR", u: "mΩ", d: 3, mn: 0, mx: 1e4, help: "The output capacitor's equivalent series resistance. The ripple current flows through it and produces ΔI·ESR of extra output ripple on top of the charge term — which is why a low-ESR part often beats a larger one." },
  /* How much inductance is left at the peak. Datasheets quote exactly this
     ("−20 % at 12 A"), and it is what bends the current ramp away from the
     textbook triangle: 0 draws the ideal straight ramp. */
  lsag: { l: "L roll-off at I_pk", u: "%", d: 20, s: 5, mn: 0, mx: 80, help: "How much inductance is left at the peak current, as a percentage lost. Datasheets quote exactly this. It bends the current ramp upward near the peak instead of leaving it a straight line; zero draws the textbook triangle." },
  rds: { l: "R_DS(on) hot", u: "mΩ", d: 8, mn: 0, mx: 1e5, help: "The switch's on-resistance, hot. Take it from the datasheet at the junction temperature you expect, not at 25 °C — it typically rises by half again or more, and using the cold number understates conduction loss badly." },
  /* The low-voltage side of a two-sided converter. A 48 V bridge carrying n
     times the primary current is not built from the same part as the 400 V
     one facing it, and charging both to the same R_DS(on) made the secondary
     term n² times the primary — with the default turns ratio, 64× — which
     swamped every other line in the loss budget. */
  rdsS: { l: "R_DS(on) LV side", u: "mΩ", d: 1.5, s: 0.1, mn: 0, mx: 1e5, help: "On-resistance of the low-voltage-side switches. A 48 V side carrying several times the primary current is not built from the same part as the high-voltage side, so it gets its own number." },
  vf: { l: "diode V_F", u: "V", d: 0.45, mn: 0, mx: 10, help: "The rectifier's forward voltage drop. It costs V_F times the current it carries for as long as it conducts, which is why low-drop Schottkys dominate low-voltage outputs and why synchronous rectification replaces them entirely below a few volts." },
  /* Reverse recovery. The charge a pn diode has to sweep out before it can
     block, dumped through the device that is turning on — so it appears as
     Q_rr·V·f_sw whether or not the diode itself gets warm. It is the single
     reason CCM boost PFC front ends moved to SiC, and it was missing from
     every loss budget here. Zero is the honest default for a Schottky or a
     wide-bandgap device, which genuinely have none. */
  qrr: { l: "diode Q_rr", u: "nC", d: 0, s: 5, mn: 0, mx: 1e6, help: "Reverse recovery charge — the charge a silicon pn diode must sweep out before it can block. It is dumped through the switch that is turning on, against the full rail, so it heats the switch rather than the diode. Zero is the honest value for a Schottky or a wide-bandgap device, which genuinely have none." },
  dcr: { l: "L DCR", u: "mΩ", d: 4, mn: 0, mx: 1e4, help: "The inductor winding's DC resistance. Straightforward I²R loss, and usually the largest single loss in a well-designed low-voltage converter." },
  tsw: { l: "t_r + t_f", u: "ns", d: 20, mn: 0, mx: 1e5, help: "Rise plus fall time of the switching transition. Voltage and current overlap during it, so this multiplied by the rail, the current and the frequency is the crossover loss." },
  qg: { l: "Q_g per FET", u: "nC", d: 15, mn: 0, mx: 1e4, help: "Total gate charge per switch. Times the drive voltage and the frequency, it is the power the driver burns — independent of load, so it is what sets the floor on light-load efficiency." },
  nph: { l: "phases N", u: "", d: 3, s: 1, mn: 1, mx: 24, help: "How many identical power stages run in parallel, clocked evenly apart. Ripple partly cancels at the output and the input rms current drops sharply, which is usually the real reason to interleave." },
  dmax: { l: "D_max", u: "", d: 0.45, s: 0.01, mn: 0.05, mx: 0.9, help: "The largest duty the controller is allowed to command. It exists to guarantee the transformer resets, or the bootstrap refreshes, before the next cycle." },
  krp: { l: "K_rp = ΔI/I_pk", u: "", d: 0.6, s: 0.05, mn: 0.05, mx: 1, help: "Ripple factor for the primary current: the swing divided by the peak. Below 1 the current never reaches zero, so the converter stays in continuous conduction; at 1 it sits exactly on the boundary." },
  pout: { l: "P_out", u: "W", d: 65, mn: 0.1, mx: 1e6, help: "Output power. Where the output voltage is a result rather than a specification, this is what the design is scaled from." },
  vbus: { l: "V_bus", u: "V", d: 390, mn: 10, mx: 2000, help: "The regulated DC bus voltage the PFC stage holds, and the input the downstream converter sees. It has to stay above the peak of the highest input line or the boost stage loses control." },
  vacMin: { l: "V_ac min", u: "Vrms", d: 85, mn: 1, mx: 1000, help: "The lowest mains voltage the supply must work at. This is the corner that sizes the input current, and therefore most of the copper." },
  vacMax: { l: "V_ac max", u: "Vrms", d: 265, mn: 1, mx: 1000, help: "The highest mains voltage the supply must survive. It sets the voltage ratings." },
  fline: { l: "f_line", u: "Hz", d: 50, mn: 1, mx: 1000, help: "Mains frequency — 50 or 60 Hz. The rectified bus ripples at twice this, hundreds of switching periods wide, which is why that ripple never appears on a switching-period figure." },
  thold: { l: "hold-up", u: "ms", d: 20, mn: 0.1, mx: 1e4, help: "How long the output must stay in regulation after the mains disappears. It is what really sizes the bulk capacitor, usually far above what ripple alone would ask for." },
  vbusMin: { l: "V_bus min", u: "V", d: 320, mn: 10, mx: 2000, help: "How far the bus is allowed to sag during hold-up before regulation is lost. The energy available is proportional to the gap between the squares of the bus voltage and this, so a small extra droop buys a lot of capacitor." },
  fr: { l: "f_r", u: "kHz", d: 100, mn: 0.1, mx: 1e5, help: "The tank's resonant frequency. Running above it keeps the tank inductive, which is what allows the switches to turn on at zero volts; running below it is the capacitive region, where they do not, and where converters are destroyed." },
  ln: { l: "L_n = L_m/L_r", u: "", d: 5, s: 0.5, mn: 1.1, mx: 50, help: "Ratio of magnetising to resonant inductance. Small values give a strong peak gain and a wide regulation range at the cost of circulating current; large values are efficient but cannot boost much." },
  qf: { l: "Q at full load", u: "", d: 0.4, s: 0.05, mn: 0.05, mx: 5, help: "The tank's quality factor at full load. It sets how much gain is available — the peak gain falls as the load gets heavier, so the full-load curve is the one that has to reach the required ratio." },
  vdc: { l: "V_dc link", u: "V", d: 400, mn: 1, mx: 5000, help: "The DC link voltage feeding the inverter. The peak output the bridge can synthesise is bounded by it." },
  vac: { l: "V_ac out", u: "Vrms", d: 230, mn: 1, mx: 2000, help: "The rms AC output voltage being produced." },
  fo: { l: "f_out", u: "Hz", d: 50, mn: 0.1, mx: 5000, help: "The output frequency being synthesised, well below the switching frequency." },
  v2: { l: "V2", u: "V", d: 48, mn: 0.1, mx: 2000, help: "The voltage on the second port of a bidirectional converter — the side power can flow either way to." },
  phi: { l: "phase shift φ", u: "°", d: 45, mn: 1, mx: 89, help: "Phase shift between the two bridges, in degrees. It is the control handle in a dual active bridge: how much the two square waves are offset decides how much power crosses, and which way." },
  lr: { l: "L_r", u: "µH", d: 20, mn: 0.01, mx: 1e5, help: "The series inductance power is transferred through. Together with the phase shift it sets the transferred power, so a smaller value moves more power at a given angle and leaves less margin for control." },
  nstg: { l: "stages N", u: "", d: 3, s: 1, mn: 1, mx: 20, help: "How many pump stages are cascaded. Each one adds another multiple of the input to the output, and another set of losses." },
  cfly: { l: "C_pump", u: "µF", d: 1, mn: 1e-3, mx: 1e4, help: "The flying capacitor that ferries charge between stages. Its size and the switching frequency together set the effective output resistance of the pump." },
  ncell: { l: "turns ratio n", u: "", d: 4, s: 0.5, mn: 0.05, mx: 200, help: "Turns ratio between primary and secondary. It trades voltage against current: a high ratio eases the secondary rectifier and raises the primary's peak current and the switch's voltage stress." },
  td: { l: "dead time", u: "ns", d: 100, mn: 0, mx: 1e5, help: "Dead time — the gap where both switches in a leg are commanded off, so they can never conduct together. It is also the interval a resonant transition has to complete in if the turn-on is to be at zero volts, so too short destroys parts and too long wastes it in the body diode." },
  coss: { l: "C_oss (eff)", u: "pF", d: 300, mn: 1, mx: 1e6, help: "The switch's own output capacitance. It is charged to the rail every cycle and then short-circuited by the channel at turn-on, costing ½·C_oss·V²·f_sw — and it is also what a soft-switching converter resonates against to reach zero volts before turning on." },
  llk: { l: "L_leak", u: "µH", d: 3, mn: 0.001, mx: 1e4, help: "Leakage inductance: the part of the transformer that does not couple. Its stored energy has nowhere to go when the switch opens, so it rings against the device capacitance and has to be clamped or snubbed." },
  vclamp: { l: "clamp V", u: "V", d: 130, mn: 1, mx: 5000, help: "The voltage the clamp holds the leakage spike to. Lower is kinder to the switch and burns more in the clamp." },
};
/* Fields that only mean anything in order.

   Every entry above carries its own mn/mx, and a range check on one number
   cannot see the other two: a minimum input above the maximum input is inside
   both ranges and still nonsense. Left alone it reached the design functions,
   where it divided by (V_bus² − V_bus(min)²) of zero and handed back an
   infinite bulk capacitor, or picked a boost duty from the wrong corner and
   printed negative farads. Rather than teach thirty design functions to
   re-check the same thing, the order is restored once, here, beside the
   ranges — so design() keeps its promise that inputs arrive usable.

   Later members are raised to meet earlier ones, so the value the reader most
   recently lowered stays put and the ones that no longer fit move visibly:
   `Fields` marks every number the sanitiser had to rewrite, by either rule. */
const ORDERED = [
  ["vinMin", "vinNom", "vinMax"],
  ["vacMin", "vacMax"],
  ["vbusMin", "vbus"],
];
const order = (o) => {
  for (const grp of ORDERED) {
    const have = grp.filter((k) => Number.isFinite(o[k]));
    for (let i = 1; i < have.length; i++) {
      if (o[have[i]] < o[have[i - 1]]) o[have[i]] = o[have[i - 1]];
    }
  }
  return o;
};
/* The switching period in seconds, so a waveform can carry real time rather
   than an anonymous "T". Both routes to a `Wave` read it from here: the
   animated card and the plain results panel drew the same figure with two
   different x-axes for a while, because only one of them knew the frequency. */
const swPeriod = (spec) => (spec && spec.fsw > 0 ? 1 / (spec.fsw * 1e3) : null);
const G = (t, rows) => ({ t, rows });
const R = (k, v, n) => [k, v, n || ""];
/* ESR in ohms from the mΩ field, and zero where a topology does not offer
   one. A design that has no ESR input still gets a ripple pane; it just gets
   the charge term alone, which is what its own C_out formula assumes. */
const esrOhm = (s) => (Number(s.esr) > 0 ? s.esr * 1e-3 : 0);
/* ------------------------------------------------------------- warnings */
/* Three tiers, and the difference between them is what the reader should DO.

     stop  — this will not work. A physical impossibility, a device that will
             not survive, a model that does not apply to what was entered.
     check — this probably works, but a decision was made for you and you
             should confirm it. Controller limits, margins, stresses near a
             practical edge.
     note  — a true and useful fact about this topology at this operating
             point that asks nothing of you.

   A fourth, `measured`, belongs to the simulator and is emitted by the
   results panel rather than by a design function — it reports what the
   circuit did, not what is wrong, and the README is explicit that it is not
   the warning red.

   They used to be one flat array of strings, so a hard impossibility and an
   unconditional footnote arrived in the same red box at the same weight. The
   half-wave rectifier had three different severities in one array, in the
   order they happened to be written.

   `W` drops a warning whose message is falsy, which is what makes the
   `cond && "…"` idiom keep working; `warns` drops the holes.               */
const SEV = ["stop", "check", "note"];
const W = (s, m) => (m ? { s, m } : null);
const warns = (...ws) => ws.filter(Boolean);
/* A conversion ratio the topology cannot reach is a design error, not a set
   of numbers. Returning this says so, instead of printing a duty above 1
   and a negative inductance as though they meant something. */
const infeasible = (msg) => ({ hi: [], warn: [W("stop", msg)], groups: [], infeasible: true });
/* alias, for design functions that need R as a resistance */
const R2 = R;

export { FIELDS, ORDERED, order, swPeriod, G, R, R2, esrOhm, infeasible, SEV, W, warns };
