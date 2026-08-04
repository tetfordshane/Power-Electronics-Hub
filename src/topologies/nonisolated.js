import { G, R, R2, esrOhm, infeasible, swPeriod, W, warns } from "../fields.js";
import { clamp, eng, pct, f2, f3 } from "../format.js";

/* ===================== topologies — non-isolated ===================== */
const TA = [
{
  id: "buck", name: "Buck", cat: "Non-isolated DC–DC", sch: "buck",
  tag: "Step down. The reference converter — everything else is a variation on it.",
  chips: ["step-down", "continuous i_out", "M = D"],
  what: "The switch chops V_in into a square wave at the SW node, and the LC filter passes its average — so the output is the input scaled by the fraction of time the switch is closed, and D is the whole conversion ratio. Because the inductor is between the switch node and the load, output current never stops flowing: the capacitor only has to absorb the inductor's ripple, not the whole load pulse. That is why buck outputs are quiet and their capacitors are small, and why almost every point-of-load rail in a computer is a buck. What it cannot do is raise the voltage, or reverse it, or isolate anything — and its input current is the pulsating one, so the input capacitor is the part people forget.",
  eqs: [
    { e: "M = V_out / V_in = D", n: "ideal CCM; add diode and R_DS drops for the real duty" },
    { e: "L = V_out·(1 − D) / (f_sw·ΔI_L)", n: "ripple is worst at V_in max" },
    { e: "C_out = ΔI_L / (8·f_sw·ΔV)", n: "charge term only; add ΔV_ESR = ΔI_L·ESR" },
    { e: "I_Cin(rms) = I_out·√(D(1 − D))", n: "peaks at D = 0.5 — size the input cap here" },
    { e: "I_out(crit) = ΔI_L / 2", n: "below this the converter drops into DCM" },
  ],
  pros: ["Simplest topology, smallest part count", "Continuous output current → small C_out, low ripple", "Well-behaved control-to-output response, no RHP zero"],
  cons: ["Pulsating input current → needs real input capacitance", "No isolation, no polarity inversion", "High-side gate drive needs a bootstrap or isolated supply"],
  use: ["Point-of-load rails", "Battery→logic conversion", "Pre-regulators"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "coss", "qrr", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => Vo / (v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    if (Dx >= 1) return infeasible("A buck can only step down, and reaching " + eng(Vo, "V")
      + " from " + eng(s.vinMin, "V") + " at " + pct(s.eff) + " efficiency would need a duty of "
      + f2(Dx) + ". Lower V_out, raise V_in min, or use a boost or buck-boost stage.");
    const dI = s.r * Io, L = Vo * (1 - Dm) / (fs * dI);
    const dIn = Vo * (1 - Dn) / (fs * L);
    /* L is sized so the ripple hits its target at V_in max, which is also
       where the ripple — and therefore the core's peak flux — is worst.  */
    const Ipk = Io + dI / 2, ILr = Math.sqrt(Io * Io + dIn * dIn / 12);
    const Co = dI / (8 * fs * s.dvout * 1e-3), dVe = dI * s.esr * 1e-3;
    const Ihs = Math.sqrt(Dn * (Io * Io + dIn * dIn / 12));
    const Pc = Ihs * Ihs * s.rds * 1e-3;
    const Pcr = 0.5 * s.vinNom * Io * s.tsw * 1e-9 * fs;
    /* Two losses that hide in the switch rather than in the part that causes
       them. C_oss is the switch's own output capacitance, charged to V_in
       every cycle and then short-circuited by its own channel at turn-on;
       Q_rr is the charge the catch diode has to sweep out before it can
       block, which the switch pulls through itself against the full rail.
       Neither warms the diode much, and both scale with f_sw — which is why
       raising f_sw to shrink the inductor stops paying at some point. */
    const Poss = 0.5 * s.coss * 1e-12 * s.vinNom * s.vinNom * fs;
    const Prr = s.qrr * 1e-9 * s.vinNom * fs;
    const Psw = Pcr + Poss;
    const Pd = s.vf * Io * (1 - Dn), Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Psw + Prr + Pd + Pl, eta = Vo * Io / (Vo * Io + Pt);
    const fLC = 1 / (2 * Math.PI * Math.sqrt(L * Co));
    return {
      /* The components the simulator builds its circuit from, in SI.
         Published rather than re-derived so the running converter and the
         numbers printed beside it cannot be different converters. */
      sim: { L: L, C: Co },
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["output cap", eng(Co, "F")]],
      /* The fourth element names the device on the schematic this mechanism
         heats, so hovering the bar lights the part up. Reverse recovery
         points at Q1 rather than the diode, which is what the formula beside
         it has always said and what the drawing can now show. Mechanisms with
         no device mark — the inductor, the capacitor — simply omit it. */
      loss: [["Q1 conduction", Pc, "I_rms²·R_DS(on), hot", "Q1"],
        ["Q1 switching", Psw, "½·V_in·I_L·(t_r+t_f)·f_sw + ½·C_oss·V_in²·f_sw", "Q1"],
        ["Diode reverse recovery", Prr, "Q_rr·V_in·f_sw — dissipated in Q1, not the diode", "Q1"],
        ["Diode", Pd, "V_F·I_out·(1−D)", "D1"], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      /* The capacitor sees the inductor ripple and nothing else — output
         current is continuous. C_out was sized at V_in max, where the ripple
         is worst, so the pane's ripple at nominal input is the smaller
         number, which is the honest one to show beside the nominal duty. */
      wave: { sat: s.lsag / 100, D: Dn, dI: dIn, iavg: Io , vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: warns(
        W("check", Dx > 0.85 && "D reaches " + f3(Dx) + " at V_in min — check the controller's max duty and t_on."),
        W("check", Dm < 0.05 && "D falls to " + f3(Dm) + " at V_in max — t_on may be shorter than the minimum on-time."),
        /* The DCM warning is shared now — Results derives it from the same
           test the cycle model draws from, for every topology at once. */
      ),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("t_on at V_in max", eng(Dm / fs, "s"), "minimum on-time limit"),
          R("Inductor ripple ΔI_L", eng(dIn, "A"), pct(dIn / Io) + " of I_out at nominal"),
          R("I_L peak (worst case) / rms", eng(Ipk, "A") + " · " + eng(ILr, "A"),
            "peak taken at V_in max, where ripple is largest — size the core here"),
          R("DCM boundary", eng(dI / 2, "A")),
        ]),
        G("Passives", [
          R("L", eng(L, "H"), "sized at V_in max"),
          R("C_out (charge)", eng(Co, "F"), "for ΔV = " + s.dvout + " mV"),
          R("ΔV from ESR", eng(dVe, "V"), dVe > s.dvout * 1e-3 ? "ESR dominates — lower it" : "within budget"),
          R("C_in rms current", eng(Io * Math.sqrt(Dn * (1 - Dn)), "A"), "at nominal duty"),
          R("LC corner", eng(fLC, "Hz")),
        ]),
        G("Stresses", [
          R("Switch / diode V", eng(s.vinMax, "V"), "derate ≥ 1.3× for ringing"),
          R("Q1 rms current", eng(Ihs, "A")),
          R("Diode average current", eng(Io * (1 - Dn), "A")),
        ]),
        G("Loss budget (nominal)", [
          R("Q1 conduction", eng(Pc, "W")),
          R("Q1 switching", eng(Psw, "W"), "crossover " + eng(Pcr, "W") + " + C_oss " + eng(Poss, "W")),
          R("Diode reverse recovery", eng(Prr, "W"),
            s.qrr > 0 ? "set Q_rr to 0 for a Schottky or SiC diode" : "zero — a Schottky has no stored charge"),
          R("Diode", eng(Pd, "W"), "replace with a FET if this dominates"),
          R("Inductor DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
        G("Control", [
          R("Suggested f_c", eng(fs / 10, "Hz"), "f_sw/10 is a safe ceiling"),
          R("Modulator gain", f2(s.vinNom) + " V/V", "voltage mode, V_ramp = 1 V"),
          R("Plant", "double pole at " + eng(fLC, "Hz"), "plus the C_out ESR zero"),
        ]),
      ],
    };
  },
},
{
  id: "syncbuck", name: "Synchronous buck", cat: "Non-isolated DC–DC", sch: "syncbuck",
  tag: "A buck with the catch diode replaced by a FET. The default for anything above a few amps.",
  chips: ["step-down", "high current", "bidirectional"],
  what: "Swapping the diode for a low-side FET turns a fixed 0.4 V drop into I·R_DS(on). Below roughly 5 V output that is the single biggest efficiency lever. The penalty is a shoot-through risk, so dead time and gate drive matter.",
  eqs: [
    { e: "M = D", n: "same as the buck; forced-PWM holds this into light load" },
    { e: "P_LS = I_rms²·R_DS + V_F·I_out·2·t_dead·f_sw", n: "body diode conducts during the dead time" },
    { e: "P_gate = Q_g·V_drive·f_sw", n: "per FET — matters above ~1 MHz" },
    { e: "P_sw ≈ ½·V_in·I_out·(t_r + t_f)·f_sw + ½·C_oss·V_in^2·f_sw", n: "only the high-side FET hard-switches; the C_oss term is the charge dumped into the SW node each turn-on" },
  ],
  pros: ["Much lower conduction loss at low V_out", "Inherently bidirectional — works as a boost in reverse", "Forced PWM gives a fixed frequency at any load"],
  cons: ["Shoot-through risk; dead time must be right", "Reverse inductor current at light load costs efficiency unless you allow DCM", "Two gate drives"],
  use: ["CPU / FPGA core rails", "48 V→12 V intermediate bus", "Battery chargers"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "qg", "vg", "coss", "td", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => Vo / (v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    if (Dx >= 1) return infeasible("A buck can only step down, and reaching " + eng(Vo, "V")
      + " from " + eng(s.vinMin, "V") + " at " + pct(s.eff) + " efficiency would need a duty of "
      + f2(Dx) + ". Lower V_out, raise V_in min, or use a four-switch buck-boost.");
    const dI = s.r * Io, L = Vo * (1 - Dm) / (fs * dI);
    const dIn = Vo * (1 - Dn) / (fs * L);
    const Ipk = Io + dI / 2, ILr = Math.sqrt(Io * Io + dIn * dIn / 12);
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    const Ihs = Math.sqrt(Dn * (Io * Io + dIn * dIn / 12));
    const Ils = Math.sqrt((1 - Dn) * (Io * Io + dIn * dIn / 12));
    const Pc = Ihs * Ihs * s.rds * 1e-3, Pls = Ils * Ils * s.rds * 1e-3;
    const Pcr = 0.5 * s.vinNom * Io * s.tsw * 1e-9 * fs;
    const Poss = 0.5 * s.coss * 1e-12 * s.vinNom * s.vinNom * fs;
    const Psw = Pcr + Poss;
    /* What conducts across the dead time is the low-side FET's BODY diode,
       which drops something like 0.8 V — not the 0.45 V of the Schottky the
       V_F field defaults to. Taking the lower of the two keeps the field
       meaningful: leave it at a Schottky value and you are modelling one
       fitted in parallel, which is exactly what that part is for and is the
       only way the drop comes down. */
    const Vbody = Math.min(s.vf, 0.8);
    const Pdt = Vbody * Io * 2 * s.td * 1e-9 * fs, Pg = 2 * s.qg * 1e-9 * s.vg * fs;
    const Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Pls + Psw + Pdt + Pg + Pl, eta = Vo * Io / (Vo * Io + Pt);
    return {
      /* The components the simulator builds its circuit from, in SI.
         Published rather than re-derived so the running converter and the
         numbers printed beside it cannot be different converters. */
      sim: { L: L, C: Co },
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["est. efficiency", pct(eta)]],
      loss: [["HS conduction", Pc, "I_HS(rms)²·R_DS(on)", "Q_HS"],
        ["HS switching", Psw, "½·V_in·I_L·(t_r+t_f)·f_sw + ½·C_oss·V_in²·f_sw", "Q_HS"],
        ["LS conduction", Pls, "I_LS(rms)²·R_DS(on)", "Q_LS"],
        /* The body diode is inside the low-side FET, so it heats that part. */
        ["Body diode", Pdt, "2·V_body·I_out·t_dead·f_sw at " + f2(Vbody) + " V", "Q_LS"],
        ["Gate drive", Pg, "2·Q_g·V_gate·f_sw", ["Q_HS", "Q_LS"]], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      wave: { rect: "sync", sat: s.lsag / 100, D: Dn, dI: dIn, iavg: Io , vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: warns(
        W("check", Ils * Ils * s.rds * 1e-3 > Pc * 2.2 && "The low-side FET carries most of the conduction loss — consider a larger LS device or an asymmetric pair."),
        /* Reversing current is what a synchronous buck is FOR at light load.
           It is worth saying and it asks nothing of the reader. */
        W("note", dIn / 2 > Io && "Inductor ripple exceeds the DC current: current reverses each cycle. Fine for forced PWM, wasteful at light load."),
      ),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("ΔI_L", eng(dIn, "A"), pct(dIn / Io) + " of I_out"),
          R("I_L peak / rms", eng(Ipk, "A") + " · " + eng(ILr, "A")),
          R("HS / LS rms current", eng(Ihs, "A") + " · " + eng(Ils, "A")),
        ]),
        G("Passives", [
          R("L", eng(L, "H")), R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng(dI * s.esr * 1e-3, "V")),
          R("C_in rms current", eng(Io * Math.sqrt(Dn * (1 - Dn)), "A")),
        ]),
        G("Loss budget (nominal)", [
          R("HS conduction / switching", eng(Pc, "W") + " · " + eng(Psw, "W")),
          R("— of which C_oss", eng(Poss, "W"), "½·C_oss·V_in²·f_sw, lost at every HS turn-on"),
          R("LS conduction", eng(Pls, "W"), "hard-switching loss ≈ 0"),
          R("Body diode (dead time)", eng(Pdt, "W"), "2 × " + s.td + " ns per cycle"),
          R("Gate drive (both)", eng(Pg, "W"), "at V_gate = " + s.vg + " V"),
          R("Inductor DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
        G("Design notes", [
          R("SW node dV/dt", s.tsw > 0 ? eng(s.vinNom / (s.tsw * 1e-9), "V/s") : "—", "drives EMI and Miller turn-on"),
          R("Bootstrap cap", eng(s.qg * 1e-9 / 0.1, "F") + " min", "for 100 mV droop, use 10–100×"),
        ]),
      ],
    };
  },
},
{
  id: "multiphase", name: "Multiphase / interleaved buck", cat: "Non-isolated DC–DC", sch: "multiphase",
  tag: "N buck stages sharing one output, clocked 360°/N apart. Ripple cancels, heat spreads.",
  chips: ["high current", "ripple cancellation", "N phases"],
  what: "Interleaving splits the current N ways and shifts the ripple so it partly cancels at the output. Input rms current drops sharply — frequently the primary motivation for interleaving — and the effective output ripple frequency becomes N·f_sw, so the same transient response needs less capacitance.",
  eqs: [
    { e: "M = D", n: "each phase is an ordinary buck" },
    { e: "K_cancel = (m + 1 − N·D)·(N·D − m) / ((1 − D)·N·D)", n: "m = floor(N·D); ripple multiplier vs one phase" },
    { e: "ΔI_out = ΔI_phase · K_cancel", n: "zero at D = m/N — the sweet spots" },
    { e: "f_ripple = N · f_sw", n: "output cap sees the interleaved frequency" },
  ],
  pros: ["Current and loss split across devices and copper", "Dramatically lower input and output ripple", "Faster transient response per unit of output capacitance"],
  cons: ["N× the parts, gate drives and current sensing", "Needs current sharing between phases", "Layout symmetry becomes critical"],
  use: ["CPU/GPU core rails (hundreds of amps)", "48 V→12 V converters", "High-current chargers"],
  fields: ["vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "nph", "rds", "dcr", "tsw", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, N = Math.max(1, Math.round(s.nph));
    const Dn = Vo / (s.vinNom * s.eff), Dm = Vo / (s.vinMax * s.eff);
    if (Dn >= 1) return infeasible("Each phase is a buck, so it can only step down. Reaching "
      + eng(Vo, "V") + " from " + eng(s.vinNom, "V") + " would need a duty of " + f2(Dn) + ".");
    const Iph = Io / N, dI = s.r * Iph;
    const L = Vo * (1 - Dm) / (fs * dI);
    const dIn = Vo * (1 - Dn) / (fs * L);
    const m = Math.floor(N * Dn);
    /* Kcancel is only defined for 0 < D < 1; outside that the converter is
       not operating and the expression changes sign rather than blowing up
       visibly, so pin it to the no-benefit value and let the warn explain. */
    const K = Dn > 0 && Dn < 1
      ? ((m + 1 - N * Dn) * (N * Dn - m)) / ((1 - Dn) * N * Dn)
      : 1;
    const dIo = dIn * K;
    const Co = dIo / (8 * N * fs * s.dvout * 1e-3);
    const Iph_rms = Math.sqrt(Iph * Iph + dIn * dIn / 12);
    const Pc = N * Dn * Iph_rms * Iph_rms * s.rds * 1e-3;
    const Psw = N * 0.5 * s.vinNom * Iph * s.tsw * 1e-9 * fs;
    const Pl = N * Iph_rms * Iph_rms * s.dcr * 1e-3;
    return {
      hi: [["per-phase current", eng(Iph, "A")], ["ripple cancellation", "×" + f2(K)], ["output ripple f", eng(N * fs, "Hz")]],
      /* The figure draws three phases whatever N is, so the marks name those
         six devices. Only the high-side devices switch hard — the low-side
         turns on into a node the body diode has already pulled down — so the
         switching term lights three parts and the conduction term six. */
      loss: [["Conduction", Pc, "N·D·I_phase(rms)²·R_DS(on)",
          ["Q1H", "Q1L", "Q2H", "Q2L", "Q3H", "Q3L"]],
        ["Switching", Psw, "N·½·V_in·I_ph·(t_r+t_f)·f_sw", ["Q1H", "Q2H", "Q3H"]],
        ["Inductor DCR", Pl, "N·I_phase(rms)²·DCR"]],
      /* One phase is plotted; the capacitor sees all N. Handing the model the
         phase count rather than the cancelled ripple means the pane derives
         the cancellation from the waveforms themselves — so if K above is
         ever wrong, the two disagree visibly instead of agreeing quietly. */
      wave: { rect: "sync", sat: s.lsag / 100, D: Dn, dI: dIn, iavg: Iph, vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, n: N } },
      /* Per-phase inductance and the phase count: the circuit builds N cells
         from them. The count is here rather than read from the spec so the
         simulation and the printed numbers cannot describe different
         converters — the design rounds it, and this is what it rounded to. */
      sim: { L, C: Co, nph: N },
      warn: warns(
        /* Dn ≥ 1 cannot reach here — infeasible() returned above. */
        /* This one invalidates a number printed above it, which is more than
           a footnote: the reader is being told not to trust a result. */
        W("check", K < 0.05 && "You are sitting almost exactly on a cancellation null (D ≈ m/N) — real output ripple will be set by ESR and mismatch, not by this number."),
      ),
      groups: [
        G("Per phase", [
          R("Phases", String(N)), R("Duty (nom)", f3(Dn)),
          R("DC current per phase", eng(Iph, "A")),
          R("ΔI per phase", eng(dIn, "A")),
          R("Peak per phase", eng(Iph + dIn / 2, "A")),
          R("L per phase", eng(L, "H")),
        ]),
        G("Output", [
          R("Cancellation factor", f3(K), "1.0 = no benefit, 0 = perfect"),
          R("Net output ripple", eng(dIo, "A"), "into C_out"),
          R("Ripple frequency", eng(N * fs, "Hz")),
          R("C_out (charge)", eng(Co, "F")),
          R("Cancellation null duties",
            N > 1 ? Array.from({ length: N - 1 }, (_, i) => f2((i + 1) / N)).join(" · ") : "none",
            N > 1 ? "ripple → 0 at D = m/N, m = 1…N−1" : "a single phase has nothing to cancel against"),
        ]),
        G("Loss budget", [
          R("Total conduction (HS)", eng(Pc, "W")), R("Total switching", eng(Psw, "W")),
          R("Total DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pc + Psw + Pl, "W") + " → " + pct(Vo * Io / (Vo * Io + Pc + Psw + Pl))),
        ]),
      ],
    };
  },
},
{
  id: "boost", name: "Boost", cat: "Non-isolated DC–DC", sch: "boost",
  tag: "Step up. Continuous input current, pulsating output — and a right-half-plane zero.",
  chips: ["step-up", "RHP zero", "no inrush protection"],
  what: "The switch shorts the inductor to ground, building current in it; when the switch opens, that current has nowhere to go but through the diode into the output, and it will drag the output above the input to keep flowing. An inductor's current cannot change instantly, and this is the most direct demonstration of it. Because the inductor faces the input, input current is smooth and continuous — which is why boost stages make good power-factor front ends, where drawing a clean sinusoid is the whole point. The costs are on the far side: the output is fed in pulses so the capacitor works hard, the duty runs away as the ratio climbs, and there is no way to disconnect the load, because V_in always reaches the output through the diode even with the switch off.",
  eqs: [
    { e: "M = 1 / (1 − D)", n: "so D = 1 − V_in/V_out" },
    { e: "I_L = I_out / (1 − D)", n: "input current, not output current — size the inductor for it" },
    { e: "L = V_in·D / (f_sw·ΔI_L)", n: "ripple worst near D = 0.5" },
    { e: "C_out = I_out·D / (f_sw·ΔV)", n: "charge term; ESR term is I_pk·ESR" },
    { e: "f_RHPZ = (1 − D)²·R_load / (2π·L)", n: "cross over below f_RHPZ/5 or the loop fights you" },
  ],
  pros: ["Continuous, low-ripple input current", "Ground-referenced switch — trivial gate drive", "Only one magnetic component"],
  cons: ["RHP zero forces a slow loop", "No output disconnect or short-circuit protection", "Output cap carries large rms ripple"],
  use: ["Battery→higher rail", "LED drivers", "PFC front ends", "Photovoltaic MPPT"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "coss", "qrr", "lsag"],
  defs: { vinMin: 9, vinNom: 12, vinMax: 16, vout: 24, iout: 3, fsw: 300, r: 0.35 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => 1 - (v * s.eff) / Vo;
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    /* A boost only steps up. Below that the duty goes negative, and every
       number built on it follows: √D is NaN, so the loss bar and the whole
       efficiency map go blank rather than wrong, which is harder to diagnose
       than a sentence saying what happened. */
    if (Dn <= 0) return infeasible("A boost can only step up, and " + eng(Vo, "V")
      + " is at or below the nominal input of " + eng(s.vinNom, "V") + " once " + pct(s.eff)
      + " efficiency is allowed for. Raise V_out, lower V_in nom, or use a buck-boost — "
      + "that one covers inputs above and below the output.");
    const IL = Io / (1 - Dn), ILx = Io / (1 - Dx);
    /* ΔI_L ∝ V_in·D = V_in·(1 − η·V_in/V_out), which is maximised at
       D = 0.5 — i.e. V_in = V_out/2η — not at either end of the input
       range. Size L against whichever point in range is actually worst. */
    const vsProd = (v) => v * du(v);
    const vHalf = Vo / (2 * s.eff);
    const inRange = vHalf > s.vinMin && vHalf < s.vinMax;
    const vWorst = [s.vinMin, s.vinMax, ...(inRange ? [vHalf] : [])]
      .reduce((a, b) => (vsProd(b) > vsProd(a) ? b : a));
    const dI = s.r * ILx, L = vsProd(vWorst) / (fs * dI);
    const dIn = vsProd(s.vinNom) / (fs * L);
    const Ipk = ILx + dI / 2;
    const ILr = Math.sqrt(IL * IL + dIn * dIn / 12);
    const Co = Io * Dx / (fs * s.dvout * 1e-3);
    /* i_C = −I_out while the switch is on, and (i_L − I_out) while the
       diode conducts. Integrating both intervals closes to the form below;
       the second term is the inductor-ripple contribution.              */
    const Icr = Math.sqrt(Io * Io * Dn / (1 - Dn) + (1 - Dn) * dIn * dIn / 12);
    const Iq = Math.sqrt(Dn) * ILr;
    const Pc = Iq * Iq * s.rds * 1e-3;
    const Pcr = 0.5 * Vo * IL * s.tsw * 1e-9 * fs;
    /* The switch turns on into a conducting boost diode, so it pulls that
       diode's stored charge through itself against the full output rail
       before the diode can block. In continuous conduction this is often the
       largest single switching term, and it is the reason a CCM boost that
       matters gets a SiC or GaN diode with no stored charge at all. */
    const Poss = 0.5 * s.coss * 1e-12 * Vo * Vo * fs;
    const Prr = s.qrr * 1e-9 * Vo * fs;
    const Psw = Pcr + Poss;
    const Pd = s.vf * Io, Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Psw + Prr + Pd + Pl, eta = Vo * Io / (Vo * Io + Pt);
    const Rld = Vo / Io, frhp = (1 - Dx) * (1 - Dx) * Rld / (2 * Math.PI * L);
    return {
      /* The components the simulator builds its circuit from, in SI.
         Published rather than re-derived so the running converter and the
         numbers printed beside it cannot be different converters. */
      sim: { L: L, C: Co },
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["RHP zero", eng(frhp, "Hz")]],
      loss: [["Switch conduction", Pc, "I_rms²·R_DS(on), hot", "Q1"],
        ["Switch switching", Psw, "½·V_out·I_L·(t_r+t_f)·f_sw + ½·C_oss·V_out²·f_sw", "Q1"],
        /* Swept through the switch, so it heats Q1 and not D1. */
        ["Diode reverse recovery", Prr, "Q_rr·V_out·f_sw — often the largest term in CCM", "Q1"],
        ["Diode", Pd, "V_F·I_out", "D1"], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      /* Pulse-fed output: while the switch is on the diode is blocking and the
         capacitor alone holds the rail up, then takes the whole inductor
         current at turn-off — peak first, decaying to the valley. That step is
         why a boost output cap is an order of magnitude larger than a buck's
         for the same ripple, and the pane is where you can see it. */
      wave: { sat: s.lsag / 100, D: Dn, dI: dIn, iavg: IL , vlabel: "v_SW", vhi: "V_out", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          i0: IL + dIn / 2, i1: IL - dIn / 2 } },
      warn: warns(
        W("check", Dx > 0.8 && "D = " + f3(Dx) + " at V_in min. Conduction loss and the RHP zero both degrade rapidly beyond about 0.8 — consider two stages or a transformer-based topology."),
        /* Not a margin: over part of the stated input range this converter
           does not regulate at all, and no component choice fixes it. */
        W("stop", s.vinMax > Vo && "V_in max exceeds V_out. A boost cannot regulate down; the output will follow the input through the diode."),
      ),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Inductor DC current (nom)", eng(IL, "A"), "= I_out/(1−D)"),
          R("Inductor DC current (worst)", eng(ILx, "A"), "at V_in min"),
          R("ΔI_L", eng(dIn, "A")),
          R("I_L peak", eng(Ipk, "A"), "saturation limit"),
        ]),
        G("Passives", [
          R("L", eng(L, "H"), "sized at V_in = " + eng(vWorst, "V") + " (D = " + f3(du(vWorst)) + ")"
            + (inRange ? ", the D = 0.5 worst case inside your range" : ", the worst case in your range")),
          R("C_out (charge)", eng(Co, "F"), "for ΔV = " + s.dvout + " mV"),
          R("ΔV from ESR", eng(Ipk * s.esr * 1e-3, "V"), "usually dominant"),
          R("C_out rms current", eng(Icr, "A"), "≈ I_out·√(D/(1−D)) — this is what kills electrolytics"),
        ]),
        G("Stresses", [
          R("Switch / diode V", eng(Vo, "V"), "plus ringing — derate ≥ 1.3×"),
          R("Switch rms current", eng(Iq, "A")),
          R("Diode average current", eng(Io, "A")),
        ]),
        G("Loss budget (nominal)", [
          R("Switch conduction / switching", eng(Pc, "W") + " · " + eng(Psw, "W")),
          R("Diode reverse recovery", eng(Prr, "W"),
            s.qrr > 0 ? "swept through the switch at V_out — a SiC diode removes it entirely" : "zero — Schottky or SiC, no stored charge"),
          R("Diode", eng(Pd, "W")), R("Inductor DCR", eng(Pl, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
        G("Control", [
          R("RHP zero (worst case)", eng(frhp, "Hz"), "at V_in min, full load"),
          R("Max sensible f_c", eng(frhp / 5, "Hz"), "and ≤ f_sw/10"),
          R("Plant", "pole at " + eng(1 / (2 * Math.PI * (Rld / 2) * Co), "Hz"), "current mode, single pole at 2/(R_load·C_out)"),
        ]),
      ],
    };
  },
},
{
  id: "buckboost", name: "Inverting buck-boost", cat: "Non-isolated DC–DC", sch: "buckboost",
  tag: "Step up or down, with the output inverted. Both ports pulsate.",
  chips: ["inverting", "step up/down", "RHP zero"],
  what: "One switch, one inductor, one diode: the switch charges the inductor from the input, and when it opens the inductor discharges into the output — but connected the other way round, so the output comes out negative. Nothing but the inductor connects input to output, which is what lets the ratio be anything at all, above or below one. The price is paid on both sides: neither the input nor the output current is continuous, so both ports need real capacitance, and every device stands off V_in plus the magnitude of V_out rather than either one alone. It is still the most compact way to make a negative rail, and it is the cell the Ćuk, SEPIC and flyback are all rearrangements of.",
  eqs: [
    { e: "M = −D / (1 − D)", n: "D = |V_out| / (V_in + |V_out|)" },
    { e: "I_L = I_out / (1 − D)", n: "the inductor carries input and output current" },
    { e: "V_switch = V_diode = V_in + |V_out|", n: "the defining penalty of this topology" },
    { e: "f_RHPZ = (1 − D)²·R_load / (2π·D·L)", n: "worse than the boost by a factor of D" },
  ],
  pros: ["Negative rail from one switch and one inductor", "Wide conversion range around unity", "Ground-referenced switch if you drive it high-side-free"],
  cons: ["Both ports pulsate → caps at both ends", "V_in + |V_out| device stress", "RHP zero in CCM"],
  use: ["Bias rails for op-amps and LCDs", "Negative gate-drive supplies", "Small industrial supplies"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "esr", "rds", "vf", "dcr", "tsw", "lsag"],
  defs: { vinMin: 9, vinNom: 12, vinMax: 16, vout: 12, iout: 2, fsw: 300, r: 0.35 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = Math.abs(s.vout), Io = s.iout;
    const du = (v) => Vo / (Vo + v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    const IL = Io / (1 - Dn), ILx = Io / (1 - Dx);
    /* ΔI = V_in·D/(L·f), and with D = V_out/(V_out + V_in·η) that product
       grows with V_in — the duty falls more slowly than the voltage rises. So
       the ripple is worst at V_in max, not at the V_in min corner where the
       DC current is worst. Those are different corners and this sized at the
       wrong one; ΔI is what L is for. */
    const dI = s.r * ILx, L = s.vinMax * Dm / (fs * dI);
    const dIn = s.vinNom * Dn / (fs * L);
    const Co = Io * Dx / (fs * s.dvout * 1e-3);
    const ILr = Math.sqrt(IL * IL + dIn * dIn / 12);
    const Iq = Math.sqrt(Dn) * ILr, Vst = s.vinMax + Vo;
    const Pc = Iq * Iq * s.rds * 1e-3, Psw = 0.5 * Vst * IL * s.tsw * 1e-9 * fs;
    const Pd = s.vf * Io, Pl = ILr * ILr * s.dcr * 1e-3;
    const Pt = Pc + Psw + Pd + Pl;
    const Rl = Vo / Io, frhp = (1 - Dx) * (1 - Dx) * Rl / (2 * Math.PI * Dx * L);
    return {
      /* The components the simulator builds its circuit from, in SI.
         Published rather than re-derived so the running converter and the
         numbers printed beside it cannot be different converters. */
      sim: { L: L, C: Co },
      hi: [["duty (nom)", f3(Dn)], ["inductor", eng(L, "H")], ["device stress", eng(Vst, "V")]],
      loss: [["Switch conduction", Pc, "I_rms²·R_DS(on)", "Q1"],
        ["Switching", Psw, "½·(V_in+V_out)·I_L·(t_r+t_f)·f_sw", "Q1"],
        ["Diode", Pd, "V_F·I_out", "D1"], ["Inductor DCR", Pl, "I_rms²·DCR"]],
      wave: { sat: s.lsag / 100, D: Dn, dI: dIn, iavg: IL , vlabel: "v_A", vhi: "V_in",
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          i0: IL + dIn / 2, i1: IL - dIn / 2 } },
      warn: warns(W("check", Dx > 0.8 && "D = " + f3(Dx) + " at V_in min — the inductor current is " + eng(ILx, "A") + " for only " + eng(Io, "A") + " of output.")),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Inductor DC current", eng(IL, "A") + " (nom), " + eng(ILx, "A") + " (worst)"),
          R("ΔI_L", eng(dIn, "A")), R("I_L peak", eng(ILx + dI / 2, "A")),
        ]),
        G("Passives", [
          R("L", eng(L, "H")), R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng((ILx + dI / 2) * s.esr * 1e-3, "V")),
          R("C_in rms", eng(Io * Math.sqrt(Dn / (1 - Dn)), "A"), "both caps see pulsed current"),
        ]),
        G("Stresses", [
          R("Switch and diode V", eng(Vst, "V"), "V_in max + |V_out|"),
          R("Switch rms", eng(Iq, "A")), R("Diode average", eng(Io, "A")),
        ]),
        G("Loss and control", [
          R("Total loss", eng(Pt, "W")),
          R("Estimated efficiency", pct(Vo * Io / (Vo * Io + Pt))),
          R("RHP zero", eng(frhp, "Hz"), "cross over below " + eng(frhp / 5, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "fsbb", name: "Four-switch buck-boost", cat: "Non-isolated DC–DC", sch: "fsbb",
  tag: "Non-inverting step up/down that stays efficient when V_in ≈ V_out.",
  chips: ["non-inverting", "wide input", "bidirectional"],
  what: "A buck leg and a boost leg share one inductor. When V_in is comfortably above V_out it runs as a pure buck (boost leg static); below, as a pure boost. Only the narrow band around V_in ≈ V_out needs blended operation, and that band is where the design work is.",
  eqs: [
    { e: "buck mode: M = D_1", n: "Q3 off, Q4 on continuously" },
    { e: "boost mode: M = 1/(1 − D_3)", n: "Q1 on, Q2 off continuously" },
    { e: "buck-boost mode: M = D_1/(1 − D_3)", n: "used only in the transition band" },
    { e: "V_switch = max(V_in, V_out)", n: "not the sum — the big win over the inverting version" },
  ],
  pros: ["Devices only see the larger of the two rails", "High efficiency at V_in ≈ V_out (both legs mostly static)", "Bidirectional; ideal for battery systems"],
  cons: ["Four switches, four drives", "Mode transitions need careful hysteresis or they chatter", "Control is more complex than any single-mode converter"],
  use: ["USB-PD and battery chargers", "48 V systems with wide input", "Supercapacitor interfaces"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "rds", "dcr", "tsw", "lsag"],
  defs: { vinMin: 9, vinNom: 12, vinMax: 16, vout: 15, iout: 5, fsw: 300, r: 0.35 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const Db = Vo / (s.vinMax * s.eff);
    /* Where the whole input range sits above the output, the boost leg never
       runs and this duty comes out negative. That is not an error — it is a
       four-switch converter being used as a plain buck, which is a perfectly
       ordinary way to end up. Taken literally, though, it printed a negative
       inductance, a negative output capacitor and a NaN rms current, so it is
       clamped and the boost-only rows say they are unused instead. */
    const DboRaw = 1 - (s.vinMin * s.eff) / Vo;
    const boosts = DboRaw > 0;
    const Dbo = Math.max(DboRaw, 0);
    /* Which leg switches at the nominal input. Measured against V_out/η, the
       same corner the two duties above are, so the mode shown and the duty
       drawn can never come from different sides of the boundary. */
    const mode = s.vinNom * s.eff > Vo ? "buck" : "boost";
    const ILb = Io, ILbo = Io / (1 - Dbo);
    const ILmax = Math.max(ILb, ILbo);
    const dI = s.r * ILmax;
    const Lb = Vo * (1 - Db) / (fs * dI);
    const Lbo = boosts ? s.vinMin * Dbo / (fs * dI) : 0;
    const L = Math.max(Lb, Lbo);
    /* Boost mode sets the output capacitor because the load is carried by the
       cap alone during each on-time. With no boost mode the output current is
       continuous and only the inductor ripple has to be absorbed — the buck
       charge term, an order of magnitude smaller. */
    const Co = boosts ? Io * Dbo / (fs * s.dvout * 1e-3)
      : dI / (8 * fs * s.dvout * 1e-3);
    /* Buck-leg rms is worst at the HIGHEST buck duty, which occurs at the
       lowest input where the buck leg still runs — not at V_in max.     */
    const vBuckLo = Math.max(s.vinMin, Vo);
    const DbMax = Math.min(Vo / (vBuckLo * s.eff), 1);
    const IrmsBuck = Io * Math.sqrt(DbMax);
    const IrmsBoost = ILbo * Math.sqrt(Dbo);
    /* Loss budget: in either mode two switches conduct and two are static,
       so the inductor current passes through one R_DS(on) each way.     */
    const ILr = Math.sqrt(ILmax * ILmax + dI * dI / 12);
    const Pcond = 2 * ILr * ILr * s.rds * 1e-3;
    const Pdcr = ILr * ILr * s.dcr * 1e-3;
    const Psw = 0.5 * Math.max(s.vinMax, Vo) * ILmax * s.tsw * 1e-9 * fs;
    const Pt = Pcond + Pdcr + Psw, eta = Vo * Io / (Vo * Io + Pt);
    /* The figure follows whichever leg is switching at nominal input, so the
       duty and the inductor current are the operating mode's own — and so is
       the output capacitor's job. In buck mode the output inductor feeds the
       load continuously; in boost mode the far leg's rectifier delivers in
       pulses and the capacitor covers the on-time alone. Same hardware, two
       entirely different ripple mechanisms — which is exactly the thing that
       catches people out at the handover. */
    /* The same efficiency allowance the tabulated duties carry. Without it the
       figure was drawn from a duty a few points away from the one printed
       above it, which is exactly the kind of quiet disagreement the shared
       cycle model exists to prevent. */
    const Dw = mode === "buck" ? Vo / (s.vinNom * s.eff) : 1 - (s.vinNom * s.eff) / Vo;
    const ILw = mode === "buck" ? Io : Io / (1 - Dw);
    const capW = mode === "buck"
      ? { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs }
      : { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
        i0: ILw + dI / 2, i1: ILw - dI / 2 };
    return {
      hi: [["mode at V_in nom", mode], ["inductor", eng(L, "H")], ["est. efficiency", pct(eta)]],
      /* Which half of the hardware is actually switching. The figure carries
         both conduction patterns and picks by this; without it the drawing
         showed the buck pair working while the numbers described the boost. */
      mode,
      loss: [["Switch conduction", Pcond, "2·I_L(rms)²·R_DS(on) — one device per leg",
          ["Q1", "Q2", "Q3", "Q4"]],
        ["Switching", Psw, "½·max(V_in,V_out)·I_L·(t_r+t_f)·f_sw", ["Q1", "Q2", "Q3", "Q4"]],
        ["Inductor DCR", Pdcr, "I_L(rms)²·DCR"]],
      wave: { rect: "sync", sat: s.lsag / 100, D: Dw, dI, iavg: ILw,
        vlabel: "v_SW", vhi: "V_in", cap: capW },
      sim: { L, C: Co },
      warn: warns(W("check", Math.abs(s.vinNom - Vo) / Vo < 0.1 && "V_in nom is inside the transition band. Plan the buck↔boost handover explicitly — this is where most designs oscillate.")),
      groups: [
        G("Modes", [
          R("Buck duty at V_in max", f3(Db)),
          R("Boost duty at V_in min", boosts ? f3(Dbo) : "—",
            boosts ? "" : "the whole input range sits above V_out, so the boost leg never switches"),
          R("Transition band", eng(Vo * 0.9, "V") + " – " + eng(Vo * 1.1, "V"), "±10 % is a typical hysteresis window"),
          R("Mode at V_in nom", mode),
        ]),
        G("Passives", [
          R("L (buck-limited)", eng(Lb, "H")),
          R("L (boost-limited)", boosts ? eng(Lbo, "H") : "—", boosts ? "" : "boost leg unused"),
          R("L to use", eng(L, "H"), boosts ? "the larger of the two" : "the buck limit, the only one in play"),
          R("I_L in boost at V_in min", boosts ? eng(ILbo, "A") : "—"),
          R("C_out (charge)", eng(Co, "F"),
            boosts ? "boost mode dominates" : "buck ripple only — ΔI_L/(8·f_sw·ΔV)"),
        ]),
        G("Stresses", [
          R("Device voltage", eng(Math.max(s.vinMax, Vo), "V"), "max of the two rails, not the sum"),
          R("Peak I_L", eng(ILmax + dI / 2, "A"), "worst case across the range"),
          R("Q1/Q2 rms (buck)", eng(IrmsBuck, "A"), "at D = " + f3(DbMax) + ", the highest buck duty"),
          R("Q3/Q4 rms (boost)", boosts ? eng(IrmsBoost, "A") : "—",
            boosts ? "at V_in min" : "Q3 stays off and Q4 stays on — they carry I_L but never switch"),
        ]),
        G("Loss budget (worst case)", [
          R("Switch conduction", eng(Pcond, "W"), "two devices in the current path"),
          R("Switching", eng(Psw, "W")),
          R("Inductor DCR", eng(Pdcr, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta)),
        ]),
      ],
    };
  },
},
{
  id: "cuk", name: "Ćuk", cat: "Non-isolated DC–DC", sch: "cuk",
  tag: "Inverting step up/down with continuous current at both ports. Energy moves through a capacitor.",
  chips: ["inverting", "low ripple both ports", "capacitive transfer"],
  what: "The dual of the buck-boost: energy crosses the converter in a capacitor's electric field rather than in an inductor's magnetic one, and inductors sit at both ports so that neither the input nor the output current ever stops. That makes it the quietest of the non-isolated family at both terminals at once, which no other single-switch topology manages. The output is inverted, like the buck-boost it is derived from. The coupling capacitor sees the full load current and is the part that fails, and coupling the two inductors on one core lets the ripple be steered almost entirely into one winding — tune it right and the output ripple nearly disappears.",
  eqs: [
    { e: "M = −D / (1 − D)", n: "same ratio as the buck-boost" },
    { e: "V_C1 = V_in + |V_out|", n: "the transfer cap holds the sum — and must handle it" },
    { e: "ΔI_L1 = ΔI_L2 = V_in·D / (L·f_sw)", n: "both windings see V_in during t_on" },
    { e: "I_C1(rms) = √(D·I_out² + (1 − D)·I_in²)", n: "the transfer cap is the reliability limit" },
  ],
  pros: ["Continuous current at both ports — small filters", "Ripple steering possible with coupled inductors", "Single switch"],
  cons: ["Transfer cap carries the full load current in rms terms", "Inverting output", "Fourth-order dynamics: harder to compensate"],
  use: ["Low-noise inverting rails", "Sensor and instrumentation supplies", "Some LED drivers"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "vf", "rds", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = Math.abs(s.vout), Io = s.iout;
    const du = (v) => Vo / (Vo + v * s.eff);
    const Dn = du(s.vinNom), Dx = du(s.vinMin);
    const Iin = Io * Dn / (1 - Dn);
    const dI = s.r * Math.max(Iin, Io);
    /* Both windings stand across V_in during t_on, so ΔI = V_in·D/(L·f). With
       D = V_out/(V_out + V_in·η) that product is V_in·V_out/(V_out + V_in·η),
       which RISES with V_in even though the duty falls — the duty shrinks more
       slowly than the voltage grows. So the ripple is worst at V_in max, the
       same corner the buck sizes at, and sizing at nominal left it over budget
       across the top of the input range. */
    const Dm = du(s.vinMax);
    const L1 = s.vinMax * Dm / (fs * dI), L2 = L1;
    const Vc1 = s.vinMax + Vo;
    const Ic1 = Math.sqrt(Dn * Io * Io + (1 - Dn) * Iin * Iin);
    const C1 = Io * Dn / (fs * 0.05 * Vc1);
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    /* Switch and diode both carry (I_in + I_out): the switch for D, the
       diode for (1 − D). That sum is what makes the Ćuk lossy at extremes. */
    const Isum = Iin + Io;
    const Iq = Isum * Math.sqrt(Dn);
    const Pc = Iq * Iq * s.rds * 1e-3;
    const Pd = s.vf * Isum * (1 - Dn);
    const Pt = Pc + Pd, eta = Vo * Io / (Vo * Io + Pt);
    return {
      /* The components the simulator builds its circuit from, in SI.
         Published rather than re-derived so the running converter and the
         numbers printed beside it cannot be different converters. */
      sim: { L: L1, L2: L2, C: Co, Cc: C1 },
      hi: [["duty (nom)", f3(Dn)], ["L1 = L2", eng(L1, "H")], ["C1 rms current", eng(Ic1, "A")]],
      loss: [["Switch conduction", Pc, "((I_in+I_out)·√D)²·R_DS(on)", "Q1"],
        ["Diode", Pd, "V_F·(I_in+I_out)·(1−D)", "D1"]],
      /* The pane plots L1, the input inductor — but the capacitor faces L2.
         Both windings see V_in during t_on so their ripples are equal, and L2
         carries I_out rather than I_in, so the capacitor's own current is
         handed over explicitly. Driving it from the plotted trace would draw
         the input winding's DC level onto the output ripple. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Iin, vlabel: "v_SW", vhi: "V_in+|V_out|", vinv: true,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, iavg: Io, dI } },
      warn: warns(W("check", Ic1 > 2 && "C1 carries " + eng(Ic1, "A") + " rms — use film or several ceramics in parallel, never a single electrolytic.")),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom", f3(Dx) + " · " + f3(Dn)),
          R("Input DC current", eng(Iin, "A")),
          R("ΔI in each inductor", eng(dI, "A")),
        ]),
        G("Passives", [
          R("L1 (input)", eng(L1, "H")), R("L2 (output)", eng(L2, "H")),
          R("C1 voltage", eng(Vc1, "V"), "V_in max + |V_out|"),
          R("C1 rms current", eng(Ic1, "A")),
          R("C1 for 5 % ripple", eng(C1, "F")),
          R("C_out", eng(Co, "F"), "small — output current is continuous"),
        ]),
        G("Stresses", [
          R("Switch and diode V", eng(Vc1, "V")),
          R("Switch rms current", eng(Iq, "A"), "carries I_in + I_out during t_on"),
          R("Diode average current", eng(Isum * (1 - Dn), "A")),
        ]),
        G("Loss budget (nominal)", [
          R("Switch conduction", eng(Pc, "W")),
          R("Diode", eng(Pd, "W"), "replace with a FET if this dominates"),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta), "conduction terms only"),
        ]),
      ],
    };
  },
},
{
  id: "sepic", name: "SEPIC", cat: "Non-isolated DC–DC", sch: "sepic",
  tag: "Non-inverting step up/down with a DC-blocking cap. The go-to when V_in crosses V_out.",
  chips: ["non-inverting", "step up/down", "input isolation at DC"],
  what: "A boost stage followed by a capacitor-coupled buck-boost, which buys one thing the boost cannot offer: the series capacitor blocks DC, so a shorted output no longer drags the input down through the diode. That is why SEPICs turn up wherever the input can be above or below the output and the load cannot be trusted — battery inputs especially, where the cell sags past the output during a discharge. The coupling capacitor carries the full load current, so its rms rating matters more than its value. Both inductors can share a core, and when they do the ripple is set by the coupled inductance rather than by either winding alone.",
  eqs: [
    { e: "M = D / (1 − D)", n: "D = (V_out + V_F)/(V_in + V_out + V_F)" },
    { e: "V_Cs = V_in", n: "the coupling cap sits at the input voltage" },
    { e: "I_Cs(rms) = I_out·√((V_out + V_F)/V_in)", n: "worst at V_in min — this sizes C_s" },
    { e: "V_switch = V_in + V_out", n: "same penalty as the buck-boost" },
    { e: "I_L1 = I_out·D/(1 − D),  I_L2 = I_out", n: "L1 carries input current, L2 output current" },
  ],
  pros: ["Non-inverting, wide range around unity", "DC blocking gives short-circuit tolerance", "Coupled inductors cut part count"],
  cons: ["Large rms current in C_s", "V_in + V_out device stress", "Fourth-order plant with an RHP zero"],
  use: ["Automotive 12 V rails (crank to load-dump)", "Li-ion → 3.3 V/5 V", "LED drivers with wide input"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "vf", "rds", "esr", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, Vf = s.vf;
    const du = (v) => (Vo + Vf) / (v + Vo + Vf);
    const Dn = du(s.vinNom), Dx = du(s.vinMin), Dm = du(s.vinMax);
    const IL1 = Io * Dx / (1 - Dx);
    const dI = s.r * (IL1 + Io);
    /* ΔI here is the ripple of the SUM of the two winding currents — that is
       what the switch carries, what the diode carries, and what the capacitor
       pane integrates. During t_on both inductors stand across V_in (the
       coupling cap holds V_in, so L2 sees it too), so each one ripples by
       V_in·D/(f·L) and the sum ripples by twice that. Sizing L from the
       single-winding law left every winding rippling by the full ΔI and the
       sum by 2·ΔI — half the inductance the printed ripple asks for. */
    const L = 2 * s.vinMin * Dx / (fs * dI);
    const Ics = Io * Math.sqrt((Vo + Vf) / s.vinMin);
    const Cs = Io * Dx / (fs * 0.05 * s.vinMin);
    const Co = Io * Dx / (fs * s.dvout * 1e-3);
    const Vst = s.vinMax + Vo + Vf;
    /* dI is already the ripple of the SUMMED (L1 + L2) current, so the
       switch peak is the sum of the two DC currents plus half of it.    */
    const Ipk = IL1 + Io + dI / 2;
    const Isum = IL1 + Io;
    const Iq = Isum * Math.sqrt(Dx);
    const Pc = Iq * Iq * s.rds * 1e-3;
    const Pd = Vf * Io;
    const Pt = Pc + Pd, eta = Vo * Io / (Vo * Io + Pt);
    return {
      /* The components the simulator builds its circuit from, in SI.
         Published rather than re-derived so the running converter and the
         numbers printed beside it cannot be different converters. */
      sim: { L: L, L2: L, C: Co, Cc: Cs },
      hi: [["duty (nom)", f3(Dn)], ["L1 = L2", eng(L, "H")], ["C_s rms", eng(Ics, "A")]],
      loss: [["Switch conduction", Pc, "((I_L1+I_L2)·√D)²·R_DS(on), at V_in min", "Q1"],
        ["Diode", Pd, "V_F·I_out", "D1"]],
      /* The output diode carries both winding currents, and only while the
         switch is off — so the output is pulse-fed exactly as a boost's is.
         Their sum averages I_out/(1−D) over that interval, which is what
         closes the charge balance. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Io * Dn / (1 - Dn), vlabel: "v_SW", vhi: "V_in+V_out", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          i0: Io / (1 - Dn) + dI / 2, i1: Io / (1 - Dn) - dI / 2 } },
      warn: warns(
        /* An economic observation about the topology, not a fault in the
           design: at this stress the part count starts to favour a flyback. */
        W("note", Vst > 60 && "Device stress is " + eng(Vst, "V") + ". Above ~60 V a SEPIC starts to look expensive next to a flyback."),
        W("check", Ics > 3 && "C_s rms is " + eng(Ics, "A") + " — plan on several ceramics or a film cap."),
      ),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom / max", f3(Dx) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("I_L1 (input, worst)", eng(IL1, "A")), R("I_L2 (output)", eng(Io, "A")),
          R("Switch peak current", eng(Ipk, "A"), "I_L1 + I_L2 + ΔI/2"),
        ]),
        G("Passives", [
          R("L1 = L2 (uncoupled)", eng(L, "H"),
            "each winding then ripples by " + eng(dI / 2, "A") + "; the switch and diode see the sum, " + eng(dI, "A")),
          R("C_s voltage", eng(s.vinMax, "V"), "rate ≥ V_in max, derate ceramics for DC bias"),
          R("C_s rms current", eng(Ics, "A")),
          R("C_s for 5 % ripple", eng(Cs, "F")),
          R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng(Ipk * s.esr * 1e-3, "V")),
        ]),
        G("Stresses", [
          R("Switch / diode V", eng(Vst, "V"), "V_in max + V_out + V_F"),
          R("Switch rms current", eng(Iq, "A"), "carries I_L1 + I_L2 during t_on"),
          R("Diode average current", eng(Io, "A")),
        ]),
        G("Loss budget (V_in min)", [
          R("Switch conduction", eng(Pc, "W")),
          R("Diode", eng(Pd, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(eta), "conduction terms only"),
        ]),
      ],
    };
  },
},
{
  id: "zeta", name: "Zeta", cat: "Non-isolated DC–DC", sch: "zeta",
  tag: "The SEPIC's mirror image: non-inverting, with the quiet port on the output side.",
  chips: ["non-inverting", "low output ripple", "high-side switch"],
  what: "The same parts as a SEPIC, rearranged so the inductor faces the load rather than the source. That single change moves the pulsating current from the output to the input: output current is continuous and output ripple is low, which is what you want when the load is a sensitive rail. It buys that at the input, which now needs the capacitance the SEPIC needed at its output, and at the gate driver, because the switch is now high-side and needs a floating or bootstrapped supply. Like the SEPIC it can step up or down and its coupling capacitor blocks DC, so it keeps the same tolerance for a shorted output.",
  eqs: [
    { e: "M = D / (1 − D)", n: "identical ratio to the SEPIC" },
    { e: "V_C1 = V_in", n: "series cap holds the input voltage" },
    { e: "ΔI_L2 = V_out·(1 − D)/(L2·f_sw)", n: "output side behaves like a buck" },
    { e: "V_switch = V_in + V_out", n: "" },
  ],
  pros: ["Low output ripple — good for noise-sensitive loads", "Non-inverting", "No RHP zero in the output-side path"],
  cons: ["Pulsating input current needs a good input filter", "High-side switch drive", "Same C1 rms burden as the SEPIC"],
  use: ["Precision analog rails from a varying input", "LED drivers where flicker matters"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "r", "dvout", "eff", "vf", "rds", "lsag"],
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const du = (v) => (Vo + s.vf) / (v + Vo + s.vf);
    const Dn = du(s.vinNom), Dx = du(s.vinMin);
    const IL1 = Io * Dx / (1 - Dx);
    const dI = s.r * Io;
    const L2 = Vo * (1 - Dn) / (fs * dI);
    const L1 = s.vinMin * Dx / (fs * s.r * Math.max(IL1, 0.1));
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    /* The switch carries both inductor currents while it is on; the diode
       carries them both while it is off. */
    const Isum = IL1 + Io;
    const Pq = Isum * Isum * Dx * s.rds * 1e-3;
    const Pd = s.vf * Isum * (1 - Dx);
    return {
      /* The components the simulator builds its circuit from, in SI.
         Published rather than re-derived so the running converter and the
         numbers printed beside it cannot be different converters. */
      sim: { L: L1, L2: L2, C: Co, Cc: Io * Dx / (fs * 0.05 * s.vinMin) },
      hi: [["duty (nom)", f3(Dn)], ["L2 (output)", eng(L2, "H")], ["C_out", eng(Co, "F")]],
      loss: [["Switch conduction", Pq, "(I_L1+I_L2)²·D·R_DS(on)", "Q1"],
        ["Diode", Pd, "V_F·(I_L1+I_L2)·(1−D)", "D1"]],
      /* The Zeta's output inductor faces the load, so the plotted current is
         already the one the capacitor sees — which is the whole reason this
         topology's output is quieter than the SEPIC's. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Io , vlabel: "v_SW", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: warns(
        W("check", Dx > 0.8 && "D = " + f3(Dx) + " at V_in min, so the switch carries " + eng(Isum, "A")
          + " for most of the period. Conduction loss climbs steeply past here."),
        W("note", s.vinMax + Vo > 60 && "Device stress is " + eng(s.vinMax + Vo, "V") + " — V_in max plus V_out, the same penalty the SEPIC pays."),
      ),
      groups: [
        G("Operating point", [
          R("D at V_in min / nom", f3(Dx) + " · " + f3(Dn)),
          R("I_L1 (input inductor)", eng(IL1, "A")), R("I_L2 (output inductor)", eng(Io, "A")),
        ]),
        G("Passives", [
          R("L1", eng(L1, "H")), R("L2", eng(L2, "H")),
          R("C1 voltage / rms", eng(s.vinMax, "V") + " · " + eng(Io * Math.sqrt((Vo + s.vf) / s.vinMin), "A")),
          R("C_out (charge)", eng(Co, "F"), "small — continuous output current"),
          R("Input cap rms", eng(Io * Math.sqrt(Dn / (1 - Dn)), "A"), "input pulsates"),
        ]),
        G("Stresses", [R("Switch / diode V", eng(s.vinMax + Vo, "V"))]),
        G("Loss budget (V_in min)", [
          R("Switch conduction", eng(Pq, "W")),
          R("Diode", eng(Pd, "W"), "replace with a FET if this dominates"),
          R("Total / efficiency", eng(Pq + Pd, "W") + " → " + pct(Vo * Io / (Vo * Io + Pq + Pd)),
            "conduction terms only"),
        ]),
      ],
    };
  },
},
{
  id: "chargepump", name: "Charge pump (Dickson)", cat: "Non-isolated DC–DC", sch: "chargepump",
  tag: "Switched capacitors, no magnetics. Fixed ratios, excellent at small power.",
  chips: ["no inductor", "fixed ratio", "integrable"],
  what: "A converter with no inductor at all. Capacitors are charged from the input, then physically reconnected so they stack on top of it, and their charge is handed along to the output — a bucket chain rather than a flywheel. Because there is nothing magnetic, the whole thing fits on a chip. The catch is that every time two capacitors at different voltages are connected together, some energy is lost no matter how good the switches are; that unavoidable loss behaves exactly like a resistance in series with the output, and it is what both droops the voltage under load and sets the efficiency. The ratio is also fixed by how the capacitors are wired, so regulating away from it costs efficiency directly.",
  eqs: [
    { e: "V_out(ideal) = (N + 1)·(V_in − V_F)", n: "N pump stages means N+1 diodes in the charge path; use FETs to kill the V_F term entirely" },
    { e: "R_SSL = N / (f_sw·C_fly)", n: "slow-switching limit — a real resistance set by charge transfer, not by any resistor" },
    { e: "R_FSL ≈ 2·(2N + 1)·R_DS(on)", n: "fast-switching limit — the on-resistance the charge has to flow through" },
    { e: "R_out = √(R_SSL^2 + R_FSL^2)", n: "the two limits combine in quadrature" },
    { e: "ΔV_out = I_out / (f_sw·C_out)", n: "ripple at the pump frequency" },
    { e: "η_max = V_out / ((N + 1)·V_in)", n: "efficiency collapses away from the ideal ratio — a charge pump cannot regulate for free" },
  ],
  pros: ["No magnetics — tiny, cheap, EMI-quiet", "Trivially integrated", "Very good light-load efficiency"],
  cons: ["Fixed ratio; regulation costs efficiency directly", "Output impedance rises fast at low f_sw or small C", "Poor at high current"],
  use: ["LCD and EEPROM bias", "Gate-drive bootstraps", "48 V→12 V unregulated 'DC transformers'"],
  fields: ["vinNom", "iout", "fsw", "nstg", "cfly", "vf", "rds", "dvout"],
  design(s) {
    const fs = s.fsw * 1e3, N = Math.max(1, Math.round(s.nstg)), Cf = s.cfly * 1e-6;
    /* An N-stage Dickson puts N+1 rectifiers in the charge path, so every
       one of them takes a V_F bite out of the ideal (N+1)·V_in.         */
    const Vi = (N + 1) * (s.vinNom - s.vf);
    const Videal = (N + 1) * s.vinNom;
    const Rssl = N / (Cf * fs);
    const Rfsl = 2 * (2 * N + 1) * s.rds * 1e-3;
    const Ro = Math.sqrt(Rssl * Rssl + Rfsl * Rfsl);
    const Vl = Vi - s.iout * Ro;
    const Cout = s.iout / (fs * s.dvout * 1e-3);
    const eta = Vl > 0 ? Vl / Videal : 0;
    /* The two limits add in QUADRATURE, which is what R_out above says and
       what the droop is actually measured from. Listing I²·R_SSL and I²·R_FSL
       as separate bar segments adds them linearly instead, overstating the
       total by up to 41 % — and the efficiency map reads the bar, so the error
       propagated off this page. The honest split of the real loss I²·R_out is
       by each limit's share of R_out², which is the identity that defines it. */
    const Pr = s.iout * s.iout * Ro;
    const Pssl = Ro > 0 ? Pr * (Rssl * Rssl) / (Ro * Ro) : 0;
    const Pfsl = Ro > 0 ? Pr * (Rfsl * Rfsl) / (Ro * Ro) : 0;
    return {
      hi: [["ideal V_out", eng(Vi, "V")], ["loaded V_out", eng(Math.max(Vl, 0), "V")], ["R_out", eng(Ro, "Ω")]],
      pout: Math.max(Vl, 0) * s.iout,
      loss: [["Charge redistribution", Pssl, "the R_SSL share of I_out²·R_out — set by f_sw·C"],
        ["Switch resistance", Pfsl, "the R_FSL share of I_out²·R_out"],
        /* The first two heat the flying capacitors and the switches, neither
           of which the pump's figure marks — only its rectifiers are drawn. */
        ["Rectifiers", (N + 1) * s.vf * s.iout, "(N+1)·V_F·I_out — zero with synchronous FETs",
          ["D1", "D2", "D3"]]],
      warn: warns(
        W("stop", Vl <= 0 && "R_out is large enough that the pump collapses under this load — it cannot deliver "
          + eng(s.iout, "A") + " at all. Raise f_sw or C_pump, or accept far less current."),
        W("check", Vl > 0 && Vl < Vi * 0.8 && "Output droops more than 20 % under load — raise f_sw or C_pump, or drop a stage."),
        /* Which limit you are in is a fact about the pump, and the useful
           half of it is that the obvious lever has stopped working. */
        W("note", Rfsl > Rssl * 2 && "R_DS(on) dominates R_out: you are in the fast-switching limit, so raising f_sw will not help. Use bigger switches."),
      ),
      groups: [
        G("Output", [
          R("Stages", String(N), N + 1 + " rectifiers in the charge path"),
          R("Ideal output", eng(Vi, "V"), "(N+1)·(V_in − V_F)"),
          R("Equivalent R_out", eng(Ro, "Ω")),
          R("— slow-switching (charge)", eng(Rssl, "Ω"), "N/(f_sw·C_fly) — falls as f_sw rises"),
          R("— fast-switching (R_DS)", eng(Rfsl, "Ω"), "2·(2N+1)·R_DS(on) — a floor f_sw cannot beat"),
          R("Loaded output", eng(Math.max(Vl, 0), "V"), "at " + eng(s.iout, "A")),
          R("Droop", eng(s.iout * Ro, "V")),
        ]),
        G("Components", [
          R("Pump caps", eng(Cf, "F") + " × " + N),
          R("C_out for ripple", eng(Cout, "F")),
          R("Pump cap rms current", eng(s.iout / Math.sqrt(2), "A"), "roughly, per cap"),
        ]),
        G("Efficiency", [
          R("Best-case η", pct(eta), "= V_out / ((N+1)·V_in)"),
          R("Loss in R_out", eng(Pr, "W"), "I_out²·R_out — the droop, dissipated"),
          R("— charge-redistribution share", eng(Pssl, "W"), "irreducible at this f_sw·C"),
          R("— switch-resistance share", eng(Pfsl, "W"), "the share bigger switches would remove"),
          R("Diode loss (if diodes)", eng((N + 1) * s.vf * s.iout, "W"), "use synchronous FETs to remove"),
        ]),
      ],
    };
  },
},
];

export { TA };
