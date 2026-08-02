import { G, R, R2, esrOhm, infeasible, swPeriod } from "../fields.js";
import { clamp, eng, pct, f2, f3 } from "../format.js";

/* ============ topologies — resonant switching amplifiers (class E) ============ */
/* Optimum single-ended class E, 50 % duty, high-Q load: the two constants that
   fall out of the ZVS + zero-slope conditions at turn-on.                      */
const CE_IM = Math.sqrt(1 + (Math.PI * Math.PI) / 4);   /* tank/DC current ratio, 1.8621 */
const CE_PH = -Math.atan(2 / Math.PI);                  /* phase, −32.48°               */
const ceV = (th) => (th < Math.PI ? 0
  : (th - Math.PI) - CE_IM * (Math.cos(th + CE_PH) - Math.cos(Math.PI + CE_PH)));
/* normalised drain voltage v_ds/V_dc, optionally phase-shifted */
const ceWave = (shiftDeg = 0) => {
  let sum = 0;
  for (let d = 0; d < 360; d += 3) sum += ceV((d * Math.PI) / 180);
  const mean = sum / (360 / 3);
  const pts = [];
  for (let d = 0; d <= 360; d += 3) {
    const dd = (((d - shiftDeg) % 360) + 360) % 360;
    pts.push([d, ceV((dd * Math.PI) / 180) / mean]);
  }
  return pts;
};
/* normalised switch current i_sw/I_dc */
const ceCur = () => {
  const pts = [];
  for (let d = 0; d <= 360; d += 3) {
    const th = (d * Math.PI) / 180;
    pts.push([d, th < Math.PI ? Math.max(1 + CE_IM * Math.sin(th + CE_PH), 0) : 0]);
  }
  return pts;
};

const TE = [
{
  id: "classe", name: "Class E (single-ended)", cat: "Resonant / class E", sch: "classe",
  tag: "One switch, zero voltage and zero slope at turn-on. Over 95 % at megahertz.",
  chips: ["ZVS + ZdVS", "one switch", "MHz capable"],
  what: "A radio-frequency amplifier built from a single switch instead of a linear device — the switch is either fully on or fully off, so in principle it dissipates nothing. The difficulty is the instant of turning on: if there is still voltage across the switch, whatever charge is sitting on it gets dumped as heat. Class E solves that by tuning the capacitor across the switch and the tank in series with it so the voltage coasts back down to zero, and flattens out there, exactly as the switch closes. There is then nothing left to dump. Two prices: the switch has to withstand about 3.56 times the supply voltage, and the tuning is only right at one frequency and one load.",
  eqs: [
    { e: "R = 0.5768·V_dc²/P_out", n: "the load the tank must present, before the Q correction" },
    { e: "C_sh = 0.1836/(ω·R)", n: "shunt capacitance, C_oss included — not added to it" },
    { e: "L_2 = Q_L·R/ω,  C_2 = 1/(ω·R·(Q_L − 1.1525))", n: "the series tank is deliberately detuned above resonance" },
    { e: "V_DS(pk) = 3.562·V_dc", n: "the defining cost of the topology" },
    { e: "I_SW(pk) = 2.862·I_dc", n: "rms is 1.538·I_dc" },
  ],
  pros: ["Only one switch and one gate drive, ground referenced", "Transition loss is identically zero rather than merely small", "Device C_oss is absorbed into the design"],
  cons: ["3.56× voltage stress demands a high-voltage device", "Optimal at exactly one load — detuning breaks ZVS", "Needs an RF choke and careful layout"],
  use: ["Induction heating and plasma drivers", "Wireless power transmitters", "RF power amplifiers and DC–DC resonant front ends"],
  fields: ["vdc", "pout", "fsw", "ql", "coss", "rds", "eff"],
  defs: { vdc: 48, pout: 100, fsw: 1000, ql: 6, coss: 300, rds: 30, eff: 0.92 },
  design(s) {
    const f = s.fsw * 1e3, w = 2 * Math.PI * f, Q = s.ql;
    const qc = 1.0000086 - 0.414395 / Q - 0.577501 / (Q * Q) + 0.205967 / (Q * Q * Q);
    const R = 0.576801 * (s.vdc * s.vdc / s.pout) * qc;
    const cc = 0.99866 + 0.91424 / Q - 1.03175 / (Q * Q);
    const Csh = (1 / (w * R * 5.44658)) * cc;
    const Lch = 6.9348 * R / f;
    const L2 = Q * R / w;
    const C2 = Q > 1.16 ? 1 / (w * R * (Q - 1.1525)) : NaN;
    const Idc = s.pout / (s.eff * s.vdc);
    const Vpk = 3.562 * s.vdc, Ipk = 2.862 * Idc, Irms = 1.5384 * Idc;
    const Pc = Irms * Irms * s.rds * 1e-3;
    const Coss = s.coss * 1e-12;
    const fmax = 0.18359 / (2 * Math.PI * R * Coss);
    const Itank = CE_IM * Idc;
    const Vc2 = isFinite(C2) ? Itank / (w * C2) : NaN;
    return {
      hi: [["load resistance", eng(R, "Ω")], ["shunt C", eng(Csh, "F")], ["peak V_DS", eng(Vpk, "V")]],
      loss: [["Switch conduction", Pc, "I_SW(rms)²·R_DS(on); ZVS makes the switching term ≈ 0"],
        ["C_oss shortfall", Coss > Csh ? 0.5 * (Coss - Csh) * s.vdc * s.vdc * f : 0,
          "charge the tuning cannot absorb is dumped at turn-on"]],
      chart: {
        title: "Drain voltage and switch current over one RF cycle",
        series: [
          { pts: ceWave(0), c: "#5AD1DE", label: "v_DS / V_dc" },
          { pts: ceCur(), c: "#E0A458", label: "i_SW / I_dc" },
        ],
        xmin: 0, xmax: 360, ymin: 0, ymax: 4, xlab: "ωt  (degrees)", ylab: "normalised",
        marks: [{ y: 3.562, t: "peak = 3.562·V_dc", c: "#F0796C" }],
      },
      warn: [
        Coss > Csh && "Device C_oss (" + eng(Coss, "F") + ") already exceeds the " + eng(Csh, "F") + " the design calls for. ZVS is impossible here — go below " + eng(fmax, "Hz") + ", raise the power, or find a lower-C_oss device.",
        Q < 3 && "Loaded Q of " + f2(Q) + " is low. The design equations assume a near-sinusoidal load current; below about 3 the harmonics make the real waveform diverge from this model.",
        Vpk > 0.8 * 4 * s.vdc && "Plan for a device rated well above " + eng(Vpk, "V") + " — component tolerance and load variation push the peak higher still.",
      ].filter(Boolean),
      groups: [
        G("Tank and load", [
          R2("Load resistance R", eng(R, "Ω"), "transform the real load to this"),
          R2("Shunt capacitance C_sh", eng(Csh, "F"), "includes C_oss of " + eng(Coss, "F")),
          R2("External shunt to add", eng(Math.max(Csh - Coss, 0), "F")),
          R2("Series L_2", eng(L2, "H")),
          R2("Series C_2", isFinite(C2) ? eng(C2, "F") : "—", "Q_L must exceed 1.15"),
          R2("RF choke L_chk", "≥ " + eng(Lch, "H"), "or design a finite-choke variant"),
        ]),
        G("Device stresses", [
          R2("Peak drain voltage", eng(Vpk, "V"), "3.562 × supply"),
          R2("DC input current", eng(Idc, "A")),
          R2("Peak switch current", eng(Ipk, "A")),
          R2("RMS switch current", eng(Irms, "A")),
          R2("Conduction loss", eng(Pc, "W"), "at R_DS(on) = " + s.rds + " mΩ"),
          R2("Peak tank current", eng(Itank, "A")),
        ]),
        G("Frequency limits", [
          R2("Operating frequency", eng(f, "Hz")),
          R2("Max f for ZVS with this C_oss", eng(fmax, "Hz")),
          R2("Headroom", f2(fmax / f) + "×", fmax > f ? "workable" : "over the limit"),
          R2("Peak voltage across C_2", isFinite(Vc2) ? eng(Vc2, "V") : "—", "the tank cap is the stressed part"),
        ]),
      ],
    };
  },
},
{
  id: "classepp", name: "Class E push-pull", cat: "Resonant / class E", sch: "classepp",
  tag: "Two class-E stages in antiphase. Twice the power, cancelled even harmonics.",
  chips: ["differential", "2× power", "clean spectrum"],
  what: "Two class-E amplifiers built as mirror images, driven exactly half a cycle apart, with the load connected between them. Because each half is doing the opposite of the other at every instant, the distortion products they share cancel in the load rather than reaching it, and the current each draws from the supply peaks when the other's is low — so the supply sees a far steadier draw. The pair also delivers twice the power for the same device stress. It only works if the halves match: any imbalance between them stops cancelling and shows up as distortion and as one device working harder than the other.",
  eqs: [
    { e: "each half designed for P_out/2", n: "the standard class-E equations, applied twice" },
    { e: "R_load = 2·R_half", n: "the differential load is the series pair" },
    { e: "V_DS(pk) = 3.562·V_dc", n: "unchanged — this buys power, not headroom" },
    { e: "even harmonics cancel", n: "the differential connection rejects them" },
    { e: "supply ripple at 2·f", n: "the two choke currents interleave" },
  ],
  pros: ["Twice the output for the same device voltage rating", "Even harmonics cancel — much less filtering", "Input current ripple halves and doubles in frequency"],
  cons: ["Two devices, two drives, and they must match", "Needs a differential load or a balun", "Asymmetry shows up directly as distortion"],
  use: ["Higher-power induction heating", "Wireless power and plasma generation", "RF transmitters where spectral purity matters"],
  fields: ["vdc", "pout", "fsw", "ql", "coss", "rds", "eff"],
  defs: { vdc: 48, pout: 400, fsw: 1000, ql: 6, coss: 300, rds: 30, eff: 0.92 },
  design(s) {
    const f = s.fsw * 1e3, w = 2 * Math.PI * f, Q = s.ql, Ph = s.pout / 2;
    const qc = 1.0000086 - 0.414395 / Q - 0.577501 / (Q * Q) + 0.205967 / (Q * Q * Q);
    const R = 0.576801 * (s.vdc * s.vdc / Ph) * qc;
    const cc = 0.99866 + 0.91424 / Q - 1.03175 / (Q * Q);
    const Csh = (1 / (w * R * 5.44658)) * cc;
    const L2 = Q * R / w;
    const C2 = Q > 1.16 ? 1 / (w * R * (Q - 1.1525)) : NaN;
    const Lch = 6.9348 * R / f;
    const Idc = s.pout / (s.eff * s.vdc), Ih = Idc / 2;
    const Vpk = 3.562 * s.vdc, Ipk = 2.862 * Ih, Irms = 1.5384 * Ih;
    const Pc = 2 * Irms * Irms * s.rds * 1e-3;
    const Coss = s.coss * 1e-12;
    const fmax = 0.18359 / (2 * Math.PI * R * Coss);
    return {
      hi: [["load (differential)", eng(2 * R, "Ω")], ["shunt C per side", eng(Csh, "F")], ["peak V_DS", eng(Vpk, "V")]],
      loss: [["Switch conduction", Pc, "2·I_SW(rms)²·R_DS(on), both halves"],
        ["C_oss shortfall", Coss > Csh ? 2 * 0.5 * (Coss - Csh) * s.vdc * s.vdc * f : 0,
          "per side, when C_oss exceeds the tuning"]],
      chart: {
        title: "Drain voltage of both halves over one RF cycle",
        series: [
          { pts: ceWave(0), c: "#5AD1DE", label: "Q1" },
          { pts: ceWave(180), c: "#A88BF0", label: "Q2" },
        ],
        xmin: 0, xmax: 360, ymin: 0, ymax: 4, xlab: "ωt  (degrees)", ylab: "v_DS / V_dc",
        marks: [{ y: 3.562, t: "peak = 3.562·V_dc", c: "#F0796C" }],
      },
      warn: [
        Coss > Csh && "C_oss of " + eng(Coss, "F") + " exceeds the " + eng(Csh, "F") + " each half needs. Below " + eng(fmax, "Hz") + " this design closes; above it, it does not.",
        Q < 3 && "Loaded Q of " + f2(Q) + " is below the range where the sinusoidal-load assumption holds.",
        "Match the two halves closely. A few percent of asymmetry in L_2 or C_2 puts even harmonics straight into the load and unbalances the device stresses.",
      ].filter(Boolean),
      groups: [
        G("Per half", [
          R2("Power per stage", eng(Ph, "W")),
          R2("R per half", eng(R, "Ω")),
          R2("Differential load", eng(2 * R, "Ω"), "what the pair drives"),
          R2("C_sh per side", eng(Csh, "F")),
          R2("L_2 per side", eng(L2, "H")),
          R2("C_2 per side", isFinite(C2) ? eng(C2, "F") : "—"),
          R2("RF choke each", "≥ " + eng(Lch, "H")),
        ]),
        G("Device stresses", [
          R2("Peak drain voltage", eng(Vpk, "V"), "same as single-ended"),
          R2("DC input current, total", eng(Idc, "A")),
          R2("Peak switch current each", eng(Ipk, "A")),
          R2("RMS switch current each", eng(Irms, "A")),
          R2("Conduction loss, both", eng(Pc, "W")),
        ]),
        G("What the pairing buys", [
          R2("Output vs single-ended", "2× for the same V_DS"),
          R2("Even harmonics", "cancelled at the load"),
          R2("Supply ripple frequency", eng(2 * f, "Hz")),
          R2("Max f for ZVS", eng(fmax, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "classde", name: "Class DE (combined ZVS)", cat: "Resonant / class E", sch: "classde",
  tag: "A class-D half-bridge switched with class-E transitions. ZVS at one times the supply.",
  chips: ["ZVS", "V_dc stress only", "dead-time tuned"],
  what: "A compromise between the two switched amplifier styles that takes the best of each. Two switches in a stack take turns, as in class D, so neither ever has to stand off more than the supply rail — against the 3.56 times a class E device sees. But instead of handing straight over, each is turned off slightly early, leaving a short gap where neither conducts. During that gap the tank current is left to drag the shared node across to the other rail on its own, so the switch about to close finds no voltage across it and closes for free. Same soft transition as class E, at a quarter of the device stress.",
  eqs: [
    { e: "D = 0.5 − f_sw·t_dead", n: "duty and dead time are one design variable, not two" },
    { e: "V_1 = (2·V_dc/π)·sin(π·D)", n: "fundamental driving the tank" },
    { e: "R = V_1²/(2·P_out)", n: "load the tank must present at resonance" },
    { e: "C_s = I_pk·t_dead/(2·V_dc)", n: "the node capacitance the transition can actually move" },
    { e: "V_DS = V_dc", n: "against 3.562·V_dc for single-ended class E" },
  ],
  pros: ["Device stress is the supply rail, not 3.56× it", "ZVS like class E without the voltage penalty", "Both devices share the same tank — good utilisation"],
  cons: ["Needs a high-side drive", "ZVS only holds over a limited load range", "Dead time must track frequency and load"],
  use: ["High-frequency DC–DC and wireless power", "Induction heating above a few hundred watts", "Anywhere class E's voltage stress is unaffordable"],
  fields: ["vdc", "pout", "fsw", "ql", "coss", "td", "rds"],
  defs: { vdc: 400, pout: 500, fsw: 500, ql: 5, coss: 200, td: 60 },
  design(s) {
    const f = s.fsw * 1e3, w = 2 * Math.PI * f;
    const td = s.td * 1e-9, Coss = s.coss * 1e-12;
    /* D = 0.5 − f·t_dead can go to zero or negative when the dead time
       swallows the whole half-period. Clamp so the tank maths stays finite
       and let the warning below say the design is not realisable.       */
    const Draw = 0.5 - f * td;
    const D = clamp(Draw, 1e-3, 0.5);
    const V1 = (2 * s.vdc / Math.PI) * Math.sin(Math.PI * D);
    const R = V1 * V1 / (2 * s.pout);
    const Ipk = V1 / R;
    const Cs = Ipk * td / (2 * s.vdc);
    const L = s.ql * R / w, C = 1 / (w * w * L);
    const tdMin = (2 * Coss * s.vdc) / Ipk;
    const Irms = Ipk / Math.SQRT2;
    const VAe = 3.562 * 2.862;
    return {
      hi: [["duty per device", f3(D)], ["load resistance", eng(R, "Ω")], ["device blocking V", eng(s.vdc, "V")]],
      loss: [["Switch conduction", 2 * Irms * Irms * D * s.rds * 1e-3, "2·I_rms²·D·R_DS(on)"],
        ["Lost ZVS", tdMin > td ? 2 * 0.5 * Coss * s.vdc * s.vdc * f : 0,
          "C_oss dumped at turn-on when the dead time is too short"]],
      warn: [
        Draw <= 0 && "A " + s.td + " ns dead time at " + s.fsw + " kHz consumes the entire half-period: there is no on-time left and this operating point does not exist. The numbers below are clamped to a nominal duty and mean nothing until you shorten the dead time or lower the frequency.",
        Draw > 0 && Draw <= 0.02 && "Dead time of " + s.td + " ns at " + s.fsw + " kHz leaves essentially no on-time. Shorten the dead time or drop the frequency.",
        Coss > Cs && "C_oss (" + eng(Coss, "F") + ") is larger than the " + eng(Cs, "F") + " this dead time can move. Increase t_dead to at least " + f2(tdMin * 1e9) + " ns or the node will not reach the rail before turn-on.",
        tdMin > td && "Required transition time is " + f2(tdMin * 1e9) + " ns against the " + s.td + " ns allowed — the bridge is switching hard.",
      ].filter(Boolean),
      groups: [
        G("Modulation", [
          R2("Duty per device D", f3(D), "0.5 minus the dead-time fraction"),
          R2("Dead time", s.td + " ns", "each transition"),
          R2("Fundamental V_1", eng(V1, "V"), "amplitude across the tank"),
          R2("Load resistance R", eng(R, "Ω"), "at resonance"),
        ]),
        G("Resonant tank", [
          R2("L_r", eng(L, "H"), "at Q = " + s.ql),
          R2("C_r", eng(C, "F")),
          R2("Characteristic impedance", eng(Math.sqrt(L / C), "Ω")),
          R2("Peak tank current", eng(Ipk, "A")),
          R2("RMS tank current", eng(Irms, "A")),
        ]),
        G("Zero-voltage switching", [
          R2("Charge to move per transition", eng(2 * Coss * s.vdc, "C")),
          R2("C_s the dead time can move", eng(Cs, "F")),
          R2("Minimum dead time for ZVS", f2(tdMin * 1e9) + " ns"),
          R2("Margin", f2(td / Math.max(tdMin, 1e-12)) + "×", td > tdMin ? "ZVS holds" : "hard switching"),
        ]),
        G("Against single-ended class E", [
          R2("Device voltage", eng(s.vdc, "V"), "vs " + eng(3.562 * s.vdc, "V") + " for class E"),
          R2("Class E device V·I product", f2(VAe) + "× P/V·I", "3.562 × 2.862"),
          R2("Devices needed", "2", "against 1, plus a high-side drive"),
          R2("Practical frequency ceiling", "set by t_dead", "class E scales further at low power"),
        ]),
      ],
    };
  },
},
];

export { TE, CE_IM, CE_PH, ceV, ceWave, ceCur };
