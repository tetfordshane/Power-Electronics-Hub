/* The input registry and the small helpers every design function uses.

   No JSX: the check scripts and the golden tests import this directly. */
/* --------------------------- input registry ---------------------------
   mn / mx are hard clamps applied in App before any design() sees the
   number, so a stray 0 or a negative can never propagate as Infinity or
   NaN into a result table. They are also fed to the <input> element so
   the browser's own validation agrees with ours.                       */
const FIELDS = {
  vacIn: { l: "V_ac in", u: "Vrms", d: 230, mn: 1, mx: 1000 },
  idc: { l: "I_dc load", u: "A", d: 1, mn: 1e-3, mx: 1e4 },
  cbulk: { l: "C_bulk", u: "µF", d: 470, mn: 0.1, mx: 1e6 },
  vsec: { l: "V_sec (square)", u: "V", d: 12, mn: 0.1, mx: 1e4 },
  dnom: { l: "duty D", u: "", d: 0.4, s: 0.01, mn: 0.01, mx: 0.99 },
  ql: { l: "loaded Q", u: "", d: 6, s: 0.5, mn: 0.1, mx: 100 },
  vg: { l: "V_gate", u: "V", d: 10, mn: 1, mx: 30 },
  vinMin: { l: "V_in min", u: "V", d: 9, mn: 0.1, mx: 2000 },
  vinNom: { l: "V_in nom", u: "V", d: 12, mn: 0.1, mx: 2000 },
  vinMax: { l: "V_in max", u: "V", d: 16, mn: 0.1, mx: 2000 },
  vout: { l: "V_out", u: "V", d: 3.3, mn: 0.05, mx: 2000 },
  iout: { l: "I_out", u: "A", d: 10, mn: 1e-3, mx: 1e4 },
  fsw: { l: "f_sw", u: "kHz", d: 500, mn: 0.1, mx: 1e5 },
  /* Ripple ratio. The ceiling has to sit above 2, or discontinuous
     conduction is unreachable: ΔI is proportional to I_out here, so the
     boundary I_out = ΔI/2 lands at ΔI/I ≈ 2 and the tool's own DCM warning
     could never fire. */
  r: { l: "ripple ΔI/I", u: "", d: 0.3, s: 0.05, mn: 0.01, mx: 3 },
  dvout: { l: "ΔV_out p-p", u: "mV", d: 30, mn: 0.1, mx: 1e5 },
  eff: { l: "target η", u: "", d: 0.9, s: 0.01, mn: 0.1, mx: 1 },
  esr: { l: "C_out ESR", u: "mΩ", d: 3, mn: 0, mx: 1e4 },
  /* How much inductance is left at the peak. Datasheets quote exactly this
     ("−20 % at 12 A"), and it is what bends the current ramp away from the
     textbook triangle: 0 draws the ideal straight ramp. */
  lsag: { l: "L roll-off at I_pk", u: "%", d: 20, s: 5, mn: 0, mx: 80 },
  rds: { l: "R_DS(on) hot", u: "mΩ", d: 8, mn: 0, mx: 1e5 },
  /* The low-voltage side of a two-sided converter. A 48 V bridge carrying n
     times the primary current is not built from the same part as the 400 V
     one facing it, and charging both to the same R_DS(on) made the secondary
     term n² times the primary — with the default turns ratio, 64× — which
     swamped every other line in the loss budget. */
  rdsS: { l: "R_DS(on) LV side", u: "mΩ", d: 1.5, s: 0.1, mn: 0, mx: 1e5 },
  vf: { l: "diode V_F", u: "V", d: 0.45, mn: 0, mx: 10 },
  /* Reverse recovery. The charge a pn diode has to sweep out before it can
     block, dumped through the device that is turning on — so it appears as
     Q_rr·V·f_sw whether or not the diode itself gets warm. It is the single
     reason CCM boost PFC front ends moved to SiC, and it was missing from
     every loss budget here. Zero is the honest default for a Schottky or a
     wide-bandgap device, which genuinely have none. */
  qrr: { l: "diode Q_rr", u: "nC", d: 0, s: 5, mn: 0, mx: 1e6 },
  dcr: { l: "L DCR", u: "mΩ", d: 4, mn: 0, mx: 1e4 },
  tsw: { l: "t_r + t_f", u: "ns", d: 20, mn: 0, mx: 1e5 },
  qg: { l: "Q_g per FET", u: "nC", d: 15, mn: 0, mx: 1e4 },
  nph: { l: "phases N", u: "", d: 3, s: 1, mn: 1, mx: 24 },
  dmax: { l: "D_max", u: "", d: 0.45, s: 0.01, mn: 0.05, mx: 0.9 },
  krp: { l: "K_rp = ΔI/I_pk", u: "", d: 0.6, s: 0.05, mn: 0.05, mx: 1 },
  pout: { l: "P_out", u: "W", d: 65, mn: 0.1, mx: 1e6 },
  vbus: { l: "V_bus", u: "V", d: 390, mn: 10, mx: 2000 },
  vacMin: { l: "V_ac min", u: "Vrms", d: 85, mn: 1, mx: 1000 },
  vacMax: { l: "V_ac max", u: "Vrms", d: 265, mn: 1, mx: 1000 },
  fline: { l: "f_line", u: "Hz", d: 50, mn: 1, mx: 1000 },
  thold: { l: "hold-up", u: "ms", d: 20, mn: 0.1, mx: 1e4 },
  vbusMin: { l: "V_bus min", u: "V", d: 320, mn: 10, mx: 2000 },
  fr: { l: "f_r", u: "kHz", d: 100, mn: 0.1, mx: 1e5 },
  ln: { l: "L_n = L_m/L_r", u: "", d: 5, s: 0.5, mn: 1.1, mx: 50 },
  qf: { l: "Q at full load", u: "", d: 0.4, s: 0.05, mn: 0.05, mx: 5 },
  vdc: { l: "V_dc link", u: "V", d: 400, mn: 1, mx: 5000 },
  vac: { l: "V_ac out", u: "Vrms", d: 230, mn: 1, mx: 2000 },
  fo: { l: "f_out", u: "Hz", d: 50, mn: 0.1, mx: 5000 },
  v2: { l: "V2", u: "V", d: 48, mn: 0.1, mx: 2000 },
  phi: { l: "phase shift φ", u: "°", d: 45, mn: 1, mx: 89 },
  lr: { l: "L_r", u: "µH", d: 20, mn: 0.01, mx: 1e5 },
  nstg: { l: "stages N", u: "", d: 3, s: 1, mn: 1, mx: 20 },
  cfly: { l: "C_pump", u: "µF", d: 1, mn: 1e-3, mx: 1e4 },
  ncell: { l: "turns ratio n", u: "", d: 4, s: 0.5, mn: 0.05, mx: 200 },
  td: { l: "dead time", u: "ns", d: 100, mn: 0, mx: 1e5 },
  coss: { l: "C_oss (eff)", u: "pF", d: 300, mn: 1, mx: 1e6 },
  llk: { l: "L_leak", u: "µH", d: 3, mn: 0.001, mx: 1e4 },
  vclamp: { l: "clamp V", u: "V", d: 130, mn: 1, mx: 5000 },
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
/* A conversion ratio the topology cannot reach is a design error, not a set
   of numbers. Returning this says so, instead of printing a duty above 1
   and a negative inductance as though they meant something. */
const infeasible = (msg) => ({ hi: [], warn: [msg], groups: [], infeasible: true });
/* alias, for design functions that need R as a resistance */
const R2 = R;

export { FIELDS, ORDERED, order, swPeriod, G, R, R2, esrOhm, infeasible };
