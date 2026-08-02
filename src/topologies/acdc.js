import { G, R, R2, esrOhm, infeasible, swPeriod } from "../fields.js";
import { clamp, eng, pct, f2, f3 } from "../format.js";

/* ================= topologies — AC–DC and DC–AC ================= */
const TC = [
{
  id: "pfcboost", name: "CCM boost PFC", cat: "AC–DC / PFC", sch: "pfcboost",
  tag: "The standard mains front end: bridge, boost, and a current loop that shapes i_in into a sine.",
  chips: ["PFC", "universal input", "390 V bus"],
  what: "A boost stage running from rectified mains with an inner current loop that forces the inductor current to follow |v_ac|. The outer voltage loop must be slow — below about 20 Hz — or it will distort the current reference and wreck the power factor. All the single-phase energy imbalance ends up as 2·f_line ripple on the bulk cap.",
  eqs: [
    { e: "V_bus > √2·V_ac(max)", n: "typically 390 V for universal input" },
    { e: "L = V_bus / (4·f_sw·ΔI)", n: "worst-case ripple occurs at v_in = V_bus/2" },
    { e: "C_bulk = 2·P_out·t_hold / (V_bus² − V_min²)", n: "hold-up almost always sets the bulk cap" },
    { e: "ΔV(2f)_pp = P_out / (2π·f_line·C·V_bus)", n: "the bus ripples at twice the line frequency, because single-phase power arrives in humps at 2·f_line. This is the full peak-to-peak swing; the amplitude either side of the mean is half of it" },
    { e: "I_C(rms) = P_out / (√2·V_bus)", n: "low-frequency cap ripple current" },
    { e: "I_sw(rms) = I_pk·√(1/2 − 4√2·V_ac/(3π·V_bus))", n: "the second term comes from ∫sin³ over the line half-cycle — the switch stops conducting near the line peak" },
  ],
  pros: ["Meets IEC 61000-3-2 with PF > 0.99 and low THD", "Well-understood, huge controller ecosystem", "Gives downstream converters a stable 390 V bus"],
  cons: ["Bridge diodes cost 1–2 % efficiency", "Bulk cap is large and lifetime-limited", "Voltage loop must be slow, so transients are poor"],
  use: ["Anything above 75 W on mains", "Server and telecom rectifiers", "LED and appliance supplies"],
  fields: ["vacMin", "vacMax", "fline", "pout", "vbus", "fsw", "r", "thold", "vbusMin", "eff", "vf", "rds", "coss", "qrr"],
  defs: { pout: 300, fsw: 65, r: 0.35, eff: 0.94, vf: 0.9, rds: 100, coss: 120, qrr: 80 },
  design(s) {
    const fs = s.fsw * 1e3, Po = s.pout, Vb = s.vbus;
    const Iin = Po / (s.eff * s.vacMin), Ipk = Math.SQRT2 * Iin;
    const dI = s.r * Ipk;
    const L = Vb / (4 * fs * dI);
    /* Hold-up energy is what the bus gives up between V_bus and V_bus(min).
       With no gap between them there is no energy to give and the capacitor
       needed is unbounded — so say that, rather than printing infinite farads. */
    if (s.vbusMin >= Vb * 0.999) return infeasible("Hold-up needs the bus to be allowed to sag: "
      + "V_bus(min) is " + eng(s.vbusMin, "V") + " against a bus of " + eng(Vb, "V") + ", so there is no "
      + "stored energy to ride through with and no finite capacitor is enough. Lower V_bus min — "
      + "the downstream converter's own input range is what sets it.");
    const C = 2 * Po * s.thold * 1e-3 / (Vb * Vb - s.vbusMin * s.vbusMin);
    /* Single-phase power pulsates: p(t) = P·(1 − cos 2ω_line·t). The bus
       capacitor absorbs that whole cosine, so i_C = −P·cos(2ω_line·t)/V_bus
       and integrating gives a ripple of AMPLITUDE P/(4π·f_line·C·V_bus).
       Peak-to-peak is twice that — which is the number quoted here and the
       one the loop has to reject. This was the amplitude labelled p-p, so
       the "± about the mean" line beside it came out half its true size. */
    const Vpp = Po / (2 * Math.PI * s.fline * C * Vb);
    const Iclf = Po / (Math.SQRT2 * Vb);
    const Id = Po / Vb;
    /* I_sw,rms² = (1/π)∫ I_pk²sin²θ·(1 − √2·V_ac·sinθ/V_bus) dθ.
       ∫sin² gives the 1/2; ∫sin³ = 4/3 gives the second term. The I_in,rms
       form I_in²(1 − 8√2·V_ac/(3π·V_bus)) is the SAME expression — I_pk² =
       2·I_in² turns one into the other exactly — so it is not more or less
       prone to a negative radicand. The radicand only goes negative above
       V_ac ≈ 0.83·V_bus, which √2·V_ac < V_bus already rules out; the clamp
       is there so a half-finished set of inputs cannot produce NaN.       */
    const rad = 0.5 - (4 * Math.SQRT2 * s.vacMin) / (3 * Math.PI * Vb);
    const Isw = Ipk * Math.sqrt(Math.max(rad, 0));
    const Pbr = 2 * s.vf * (2 * Ipk / Math.PI);
    const dImax = Vb / (4 * fs * L);
    const Psw = Isw * Isw * s.rds * 1e-3;
    const Pbd = s.vf * Id;
    /* Reverse recovery is the reason this topology moved to SiC. Running in
       continuous conduction, the switch turns on into a boost diode that is
       still conducting the full inductor current, and drags that diode's
       stored charge through itself against the 390 V bus — every cycle, all
       through the line half-cycle. A silicon ultrafast diode with a few
       hundred nC here can cost more than the bridge does. */
    const Prr = s.qrr * 1e-9 * Vb * fs;
    const Poss = 0.5 * s.coss * 1e-12 * Vb * Vb * fs;
    return {
      hi: [["boost inductor", eng(L, "H")], ["bulk cap", eng(C, "F")], ["peak line current", eng(Ipk, "A")]],
      loss: [["Bridge diodes", Pbr, "2·V_F·I_in(avg) — deleted by a totem-pole"],
        ["Boost switch conduction", Psw, "I_sw(rms)²·R_DS(on)"],
        ["Boost diode reverse recovery", Prr, "Q_rr·V_bus·f_sw — why CCM PFC went SiC"],
        ["Switch C_oss", Poss, "½·C_oss·V_bus²·f_sw, dumped at every turn-on"],
        ["Boost diode", Pbd, "V_F·I_out(avg)"]],
      warn: [
        Vb < Math.SQRT2 * s.vacMax * 1.05 && "V_bus must sit comfortably above √2·V_ac(max) = " + eng(Math.SQRT2 * s.vacMax, "V") + " or the boost loses control at the line peak.",
        Vpp > 20 && "Bus ripple is " + eng(Vpp, "V") + " peak-to-peak. Keep the voltage loop below ~20 Hz so this does not distort the current reference.",
      ].filter(Boolean),
      groups: [
        G("Line side", [
          R("Input rms current at V_ac min", eng(Iin, "A")),
          R("Peak line current", eng(Ipk, "A")),
          R("HF ripple ΔI (worst)", eng(dImax, "A"), "at v_in = V_bus/2"),
          R("Inductor peak current", eng(Ipk + dImax / 2, "A"), "saturation rating"),
          R("Bridge diode loss", eng(Pbr, "W"), "removed entirely by a totem-pole"),
        ]),
        G("Magnetics and bulk cap", [
          R("L_boost", eng(L, "H")),
          R("C_bulk for hold-up", eng(C, "F"), s.thold + " ms down to " + s.vbusMin + " V"),
          R("Bus ripple (2·f_line)", eng(Vpp, "V") + " p-p", "± " + eng(Vpp / 2, "V") + " about the mean"),
          R("Bulk cap rms current", eng(Iclf, "A"), "plus HF component"),
        ]),
        G("Semiconductors", [
          R("Switch / diode blocking V", eng(Vb, "V"), "use 600 V devices"),
          R("Switch rms current", eng(Isw, "A")),
          R("Boost diode average", eng(Id, "A")),
          R("Reverse-recovery loss", eng(Prr, "W"),
            s.qrr > 0 ? "at Q_rr = " + s.qrr + " nC; a SiC diode takes this to zero" : "zero — SiC or GaN, no stored charge"),
          R("Switch C_oss loss", eng(Poss, "W"), "½·C_oss·V_bus²·f_sw"),
        ]),
        G("Control", [
          R("Current loop bandwidth", eng(fs / 10, "Hz")),
          R("Voltage loop bandwidth", "10 – 20 Hz", "must reject 2·f_line"),
          R("Notch at", eng(2 * s.fline, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "ilpfc", name: "Interleaved boost PFC", cat: "AC–DC / PFC", sch: "ilpfc",
  tag: "Two boost stages half a period apart. The ripple they make partly cancels before it reaches anything.",
  chips: ["PFC", "ripple cancellation", "≥ 300 W"],
  what: "The same boost front end as before, built twice and run half a switching period apart from a shared bridge and a shared capacitor. Because one leg is charging while the other is discharging, the ripple currents they produce are always pushing opposite ways and much of the ripple cancels before it reaches either capacitor — so the input filter and the bulk capacitor both get an easier job than the switching frequency alone would suggest. The current also splits between the two legs, so each carries half and the copper losses fall by more than half. What it costs is a duplicate leg and a controller that can keep the two halves sharing evenly.",
  eqs: [
    { e: "each leg carries I_in/2", n: "so conduction loss falls by about half for the same total current" },
    { e: "input ripple frequency = 2·f_sw", n: "two legs, staggered — the ripple the filter sees arrives twice as often and is correspondingly smaller" },
    { e: "K(D) = |1 − 2·D| / (1 − D)", n: "the ripple cancellation factor for two legs; it reaches zero at D = 0.5, where the two ripples are exact opposites" },
    { e: "L = V_bus / (4·f_sw·ΔI)", n: "each leg is sized exactly as a single boost PFC's inductor would be" },
    { e: "C_bulk = 2·P_out·t_hold / (V_bus² − V_min²)", n: "unchanged — hold-up is a line-frequency problem and interleaving does not help it" },
  ],
  pros: ["Ripple cancellation shrinks the input filter and the bulk cap ripple current", "Current shares between two legs, so conduction loss and heat both halve", "Ripple arrives at 2·f_sw, so the EMI filter corner can be higher"],
  cons: ["Twice the switches, inductors and gate drives", "The two legs must share current, or one does all the work", "No benefit at all to hold-up, which is what usually sizes the bulk cap"],
  use: ["Server and telecom rectifiers above 300 W", "EV chargers", "Anywhere the EMI filter has become the biggest part"],
  fields: ["vacMin", "vacMax", "fline", "pout", "vbus", "fsw", "r", "thold", "vbusMin", "eff", "vf", "rds", "coss", "qrr"],
  defs: { pout: 1000, fsw: 65, r: 0.35, eff: 0.95, vf: 0.9, rds: 60, coss: 120, qrr: 80 },
  design(s) {
    const fs = s.fsw * 1e3, Po = s.pout, Vb = s.vbus;
    const Iin = Po / (s.eff * s.vacMin), Ipk = Math.SQRT2 * Iin;
    /* Each leg carries half the line current — that is the whole point. */
    const Iph = Ipk / 2;
    const dI = s.r * Iph;
    const L = Vb / (4 * fs * dI);
    if (s.vbusMin >= Vb * 0.999) return infeasible("Hold-up needs the bus to be allowed to sag: "
      + "V_bus(min) is " + eng(s.vbusMin, "V") + " against a bus of " + eng(Vb, "V") + ", so there is no "
      + "stored energy to ride through with and no finite capacitor is enough. Lower V_bus min.");
    const C = 2 * Po * s.thold * 1e-3 / (Vb * Vb - s.vbusMin * s.vbusMin);
    const Vpp = Po / (2 * Math.PI * s.fline * C * Vb);
    /* Cancellation between two legs, from the general interleaving factor —
       the same expression the multiphase buck uses, because it is the same
       question. The two-phase shortcut |1−2D|/(1−D) is only right below
       D = 0.5, and a boost PFC at the line peak sits well above it: at the
       default 85 V input the duty there is about 0.69, where the shortcut
       claims interleaving makes the ripple WORSE by a quarter. It does not. */
    const Dpk = clamp(1 - (Math.SQRT2 * s.vacMin) / Vb, 0.02, 0.98);
    const mK = Math.floor(2 * Dpk);
    const K = ((mK + 1 - 2 * Dpk) * (2 * Dpk - mK)) / ((1 - Dpk) * 2 * Dpk);
    const dIn = dI * K;
    const Iclf = Po / (Math.SQRT2 * Vb);
    const Id = Po / Vb;
    const rad = 0.5 - (4 * Math.SQRT2 * s.vacMin) / (3 * Math.PI * Vb);
    const Isw = Iph * Math.sqrt(Math.max(rad, 0)) * Math.SQRT2;
    const Pbr = 2 * s.vf * (2 * Ipk / Math.PI);
    /* Two legs, each with its own switch and diode. */
    const Psw = 2 * Isw * Isw * s.rds * 1e-3;
    const Pbd = s.vf * Id;
    const Prr = 2 * s.qrr * 1e-9 * Vb * fs;
    const Poss = 2 * 0.5 * s.coss * 1e-12 * Vb * Vb * fs;
    const Pt = Pbr + Psw + Pbd + Prr + Poss;
    return {
      hi: [["per-leg inductor", eng(L, "H")], ["ripple cancellation", "×" + f2(K)], ["input ripple f", eng(2 * fs, "Hz")]],
      loss: [["Bridge diodes", Pbr, "2·V_F·I_in(avg) — a totem-pole deletes these"],
        ["Switch conduction (both legs)", Psw, "2·I_sw(rms)²·R_DS(on)"],
        ["Boost diodes reverse recovery", Prr, "2·Q_rr·V_bus·f_sw"],
        ["Switch C_oss (both legs)", Poss, "2·½·C_oss·V_bus²·f_sw"],
        ["Boost diodes", Pbd, "V_F·I_out(avg)"]],
      warn: [
        Vb < Math.SQRT2 * s.vacMax * 1.05 && "V_bus must sit comfortably above √2·V_ac(max) = " + eng(Math.SQRT2 * s.vacMax, "V") + " or the boost loses control at the line peak.",
        K < 0.15 && "At the line peak the duty is " + f2(Dpk) + ", almost exactly where the two ripples cancel completely. Real cancellation will be set by how well the two inductors match, not by this number.",
        Po < 300 && "Below about 300 W the second leg usually costs more than the filter it saves. A single boost stage is the cheaper answer.",
      ].filter(Boolean),
      groups: [
        G("Line side", [
          R("Input rms current at V_ac min", eng(Iin, "A")),
          R("Peak line current", eng(Ipk, "A"), "shared between two legs"),
          R("Per-leg peak current", eng(Iph, "A"), "each inductor and switch sees half"),
          R("Duty at the line peak", f2(Dpk)),
          R("Bridge diode loss", eng(Pbr, "W")),
        ]),
        G("Ripple and cancellation", [
          R("Per-leg ripple ΔI", eng(dI, "A")),
          R("Ripple after cancellation", eng(dIn, "A"), "×" + f2(K) + " at the line peak"),
          R("Input ripple frequency", eng(2 * fs, "Hz"), "twice f_sw — the filter corner can rise with it"),
          R("L per leg", eng(L, "H")),
        ]),
        G("Bulk cap", [
          R("C_bulk for hold-up", eng(C, "F"), s.thold + " ms down to " + s.vbusMin + " V"),
          R("Bus ripple (2·f_line)", eng(Vpp, "V") + " p-p", "± " + eng(Vpp / 2, "V") + " about the mean"),
          R("Bulk cap rms current", eng(Iclf, "A"), "the line-frequency part; interleaving does not touch it"),
        ]),
        G("Loss budget", [
          R("Bridge diodes", eng(Pbr, "W")),
          R("Switch conduction", eng(Psw, "W"), "both legs together"),
          R("Reverse recovery", eng(Prr, "W"), s.qrr > 0 ? "two diodes; SiC removes it" : "zero — SiC or GaN"),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(Po / (Po + Pt))),
        ]),
      ],
      /* One leg's inductor current, over one switching period at the crest of
         the line cycle. No capacitor pane, for the same reason the single-
         stage PFC has none: the bulk capacitor here rides a 2·f_line swell
         hundreds of switching periods wide, and the little charge that moves
         within one period is not what sizes it or what the reader should be
         looking at. Drawing one would be a different waveform wearing this
         one's axis. The cancellation is visible where it belongs — in the
         schematic, where one leg charges as the other discharges. */
      wave: { D: Dpk, dI, iavg: Iph, vlabel: "v_SW", vhi: "V_bus", vinv: true, ilabel: "i_L1" },
    };
  },
},
{
  id: "totempole", name: "Totem-pole bridgeless PFC", cat: "AC–DC / PFC", sch: "totempole",
  tag: "Same boost, minus the bridge. Only practical since wide-bandgap devices arrived.",
  chips: ["PFC", "GaN / SiC", "99 % class"],
  what: "An ordinary mains front end rectifies with four diodes first and boosts afterwards, so the current pays two diode drops on its way through — a couple of percent of the output, permanently. This arrangement deletes the bridge: one pair of switches runs fast and does the boosting, while the other pair simply swaps over at mains frequency to handle whichever way round the line happens to be. The reason it took so long to become practical is that the fast pair must hand over to each other through their own internal body diodes, and a silicon body diode is slow to stop conducting — fast enough switching and it shorts the bus. Wide-bandgap devices removed that obstacle, and this became the way to reach 99 %.",
  eqs: [
    { e: "same L and C as the CCM boost PFC", n: "the power stage maths does not change" },
    { e: "P_saved = 2·V_F·I_in(avg)", n: "the two bridge diodes you deleted" },
    { e: "line-frequency leg: I²R only", n: "switching loss there is negligible" },
    { e: "watch the polarity crossover", n: "current spikes at the zero crossing are a common failure mode" },
  ],
  pros: ["One or two fewer diode drops — 98.5–99 % is achievable", "Fewer thermal interfaces", "Same control structure as a normal boost PFC"],
  cons: ["Needs GaN/SiC or CrM operation", "Zero-crossing control is demanding", "Common-mode noise is worse than a bridged design"],
  use: ["Server and hyperscale rectifiers", "EV chargers", "High-efficiency industrial supplies"],
  fields: ["vacMin", "vacMax", "fline", "pout", "vbus", "fsw", "r", "thold", "vbusMin", "eff", "vf", "rds"],
  defs: { pout: 1500, fsw: 100, r: 0.35, eff: 0.98, vf: 0.9, rds: 50 },
  design(s) {
    const fs = s.fsw * 1e3, Po = s.pout, Vb = s.vbus;
    const Iin = Po / (s.eff * s.vacMin), Ipk = Math.SQRT2 * Iin;
    const dI = s.r * Ipk, L = Vb / (4 * fs * dI);
    const C = 2 * Po * s.thold * 1e-3 / (Vb * Vb - s.vbusMin * s.vbusMin);
    const Pbr = 2 * s.vf * (2 * Ipk / Math.PI);
    /* Only ONE device of the line-frequency leg conducts per half cycle,
       and it carries the full input current — so the conduction loss is
       I_in²·R_DS, not twice that.                                        */
    const Plf = Iin * Iin * s.rds * 1e-3;
    return {
      hi: [["boost inductor", eng(L, "H")], ["bulk cap", eng(C, "F")], ["bridge loss removed", eng(Pbr, "W")]],
      loss: [["Fast-leg conduction", Iin * Iin * s.rds * 1e-3, "I_in(rms)²·R_DS(on)"],
        ["Line-frequency leg", Plf, "one device conducts per half cycle"]],
      warn: ["This topology requires zero-reverse-recovery devices (GaN or SiC) in CCM. Silicon superjunction devices will not survive the first line cycle."],
      groups: [
        G("Power stage", [
          R("Input rms current", eng(Iin, "A")), R("Peak line current", eng(Ipk, "A")),
          R("L_boost", eng(L, "H")), R("C_bulk", eng(C, "F")),
          R("HF leg blocking voltage", eng(Vb, "V")),
        ]),
        G("Efficiency accounting", [
          R("Diode loss avoided", eng(Pbr, "W"), "vs a bridged boost PFC"),
          R("Line-frequency leg conduction", eng(Plf, "W"), "one device conducts per half cycle, at R_DS(on) = " + s.rds + " mΩ"),
          R("Net gain", eng(Pbr - Plf, "W")),
          R("Equivalent efficiency gain", pct((Pbr - Plf) / Po)),
        ]),
        G("Watch list", [
          R("Zero crossing", "current spike risk", "blank or soft-start the duty around it"),
          R("Common-mode noise", "worse than bridged", "the whole output moves at line frequency"),
          R("Body diode", "must not conduct in CCM", "GaN has no body diode — that is the point"),
        ]),
      ],
    };
  },
},
{
  id: "hbridge", name: "H-bridge inverter", cat: "DC–AC inversion", sch: "hbridge",
  tag: "Single-phase DC to AC. Unipolar PWM doubles the effective filter frequency for free.",
  chips: ["single-phase", "unipolar PWM", "LC filter"],
  what: "Two legs modulated out of phase produce three output levels, so the filter sees 2·f_sw and a smaller voltage step. That single choice — unipolar rather than bipolar switching — typically halves the filter inductor and cuts the ripple current by four.",
  eqs: [
    { e: "v_out(pk) = m·V_dc", n: "m ≤ 1 for linear modulation" },
    { e: "ΔI = V_dc/(8·f_sw·L_f)", n: "unipolar PWM: the output switches between 0 and ±V_dc at an effective 2·f_sw, and the worst case is at |v_out| = V_dc/2 — bipolar switching would give V_dc/(4·f_sw·L_f), twice as much" },
    { e: "f_res = 1/(2π√(L_f·C_f)),  10·f_out < f_res < f_sw/10", n: "filter placement rule" },
    { e: "C_dc = P_out/(2π·f_out·V_dc·ΔV_dc(p-p))", n: "single-phase power arrives in humps at twice the output frequency, and the link capacitor absorbs all of it; ΔV_dc here is the full peak-to-peak swing" },
  ],
  pros: ["Three output levels with only four switches", "Filter sees 2·f_sw", "Simple, well-understood control"],
  cons: ["DC link must absorb 2·f_out ripple power", "Dead time distorts the output near the zero crossing", "Common-mode voltage jumps unless you use a special modulation"],
  use: ["Solar string and micro-inverters", "UPS output stages", "Motor drives for single-phase machines"],
  fields: ["vdc", "vac", "fo", "fsw", "pout", "r", "td", "rds", "tsw"],
  defs: { vdc: 400, vac: 230, fo: 50, fsw: 20, pout: 3000, r: 0.2, td: 500 },
  design(s) {
    const fs = s.fsw * 1e3, Vdc = s.vdc, Vac = s.vac;
    const m = Math.SQRT2 * Vac / Vdc;
    const Io = s.pout / Vac, Ipk = Math.SQRT2 * Io;
    const dI = s.r * Ipk;
    /* Unipolar (3-level) PWM: the terminal voltage steps between 0 and
       ±V_dc at an effective 2·f_sw, and the worst case sits at half
       modulation. That is V_dc/(8·f_sw·L) — half the bipolar result, and
       the whole reason to choose unipolar switching.                    */
    const Lf = Vdc / (8 * fs * dI);
    const fres = fs / 10;
    const Cf = 1 / (Lf * Math.pow(2 * Math.PI * fres, 2));
    const Iq = 2 * Math.PI * s.fo * Cf * Vac;
    /* Sized for 5 % PEAK-TO-PEAK ripple on the link at 2·f_out.

       Single-phase output power pulsates at 2·f_out, so the link current is
       P·cos(2ω_o·t)/V_dc and integrating gives a ripple of amplitude
       P/(4π·f_out·C·V_dc) — peak-to-peak, twice that. Solving the p-p form
       for C leaves 2π·f_out in the denominator, not 4π: the extra factor of
       two was sizing the link for the amplitude while the row beside it
       promised peak-to-peak, so the built converter rippled twice as far as
       the 5 % it claimed. Same slip the PFC bulk cap had. */
    const dVpp = 0.05 * Vdc;
    const Cdc = s.pout / (2 * Math.PI * s.fo * Vdc * dVpp);
    const Vdt = s.td * 1e-9 * fs * Vdc;
    return {
      hi: [["modulation index", f3(m)], ["filter inductor", eng(Lf, "H")], ["filter cap", eng(Cf, "F")]],
      loss: [["Conduction", 2 * Io * Io * s.rds * 1e-3, "2·I_out(rms)²·R_DS(on) — two devices in the path"],
        ["Switching", 4 * (2 / Math.PI) * Ipk * Vdc * s.tsw * 1e-9 * fs / 2,
          "four devices, averaged over the output sine"],
        ["Dead-time distortion", Vdt * Io, "energy the output never receives"]],
      warn: [
        m > 1 && "m = " + f2(m) + " exceeds 1: the bridge cannot make " + Vac + " V rms from " + Vdc + " V DC without overmodulation. Raise V_dc above " + eng(Math.SQRT2 * Vac, "V") + ".",
        Iq > 0.05 * Io && "Filter cap draws " + eng(Iq, "A") + " of reactive current, over 5 % of rated. Shrink C_f and raise L_f.",
      ].filter(Boolean),
      groups: [
        G("Modulation", [
          R("Modulation index m", f3(m)),
          R("Minimum V_dc", eng(Math.SQRT2 * Vac / 0.95, "V"), "for 5 % margin"),
          R("Output current rms / peak", eng(Io, "A") + " · " + eng(Ipk, "A")),
          R("Effective filter frequency", eng(2 * fs, "Hz"), "unipolar PWM"),
        ]),
        G("Output filter", [
          R("L_f", eng(Lf, "H"), "for " + pct(s.r) + " ripple, unipolar PWM"),
          R("Ripple current ΔI", eng(dI, "A"), "worst case, at |v_out| = V_dc/2"),
          R("C_f", eng(Cf, "F"), "resonance at " + eng(fres, "Hz")),
          R("Reactive current in C_f", eng(Iq, "A"), pct(Iq / Io) + " of rated"),
        ]),
        G("DC link and dead time", [
          R("C_dc for 5 % ripple", eng(Cdc, "F"), eng(dVpp, "V") + " p-p at 2·f_out = " + eng(2 * s.fo, "Hz")),
          R("DC link rms ripple current", eng(s.pout / (Math.SQRT2 * Vdc), "A")),
          R("Dead-time voltage error", eng(Vdt, "V"), "distorts the output near zero crossing"),
          R("Device blocking voltage", eng(Vdc, "V")),
        ]),
      ],
    };
  },
},
{
  id: "vsi3", name: "Three-phase two-level VSI", cat: "DC–AC inversion", sch: "vsi3",
  tag: "Six switches, three legs. The workhorse of motor drives and grid inverters.",
  chips: ["three-phase", "SVPWM", "motor drive"],
  what: "Three switching legs off one DC supply, one per motor phase, each producing a sine a third of a cycle behind the last — which is what makes a rotating field. The interesting trick is in the modulation. Each leg can be offset by the same amount without changing any voltage BETWEEN phases, and the motor only ever sees the differences, so that offset is free to use. Adding a deliberate third-harmonic offset lets each leg swing further before it runs out of supply, and buys 15.5 % more output from the same DC link than the obvious sine modulation. It costs a few lines of code and no hardware at all, which is why essentially every drive does it.",
  eqs: [
    { e: "SPWM: V_LL(rms) = 0.612·m·V_dc", n: "linear range m ≤ 1" },
    { e: "SVPWM: V_LL(rms) = 0.707·m·V_dc", n: "15.5 % more, same hardware" },
    { e: "V_dc ≥ √2·V_LL for SVPWM", n: "the practical sizing rule" },
    { e: "ΔV_deadtime = t_d·f_sw·V_dc", n: "per phase; compensate it in software" },
  ],
  pros: ["Minimum device count for three phases", "Mature modulation and control (FOC, DTC)", "No DC-link low-frequency ripple with balanced loads"],
  cons: ["Devices block the full V_dc", "dv/dt reflections stress motor insulation", "Common-mode current through motor bearings"],
  use: ["Industrial motor drives", "Grid-tied solar and storage inverters", "Traction inverters"],
  fields: ["vdc", "vac", "fo", "fsw", "pout", "td", "rds", "tsw"],
  defs: { vdc: 650, vac: 400, fo: 50, fsw: 8, pout: 15000, td: 2000 },
  design(s) {
    const fs = s.fsw * 1e3, Vdc = s.vdc;
    const mS = s.vac / (0.612 * Vdc), mV = s.vac / (0.707 * Vdc);
    const Iph = s.pout / (Math.sqrt(3) * s.vac), Ipk = Math.SQRT2 * Iph;
    const Icdc = Iph * Math.sqrt(2 * Math.min(mV, 1) * (Math.sqrt(3) / (4 * Math.PI) + (Math.sqrt(3) / Math.PI - 9 * Math.min(mV, 1) / 16)));
    const Vdt = s.td * 1e-9 * fs * Vdc;
    const Mratio = fs / s.fo;
    return {
      hi: [["m (SVPWM)", f3(mV)], ["phase current", eng(Iph, "A")], ["DC link ripple", eng(Icdc, "A")]],
      loss: [["Conduction", 6 * 0.5 * Iph * Iph * s.rds * 1e-3, "six devices, each conducting half the time"],
        ["Switching", 6 * (2 / Math.PI) * Ipk * Vdc * s.tsw * 1e-9 * fs / 2,
          "six devices, averaged over the output sine"]],
      warn: [
        mV > 1 && "SVPWM needs m = " + f2(mV) + " — beyond the linear range. Minimum V_dc for " + s.vac + " V is " + eng(s.vac / 0.707, "V") + ".",
        Mratio < 15 && "f_sw/f_out = " + f2(Mratio) + ". Below ~15 use synchronous modulation or the low-order harmonics become significant.",
      ].filter(Boolean),
      groups: [
        G("Modulation", [
          R("m required, sine PWM", f3(mS)),
          R("m required, SVPWM", f3(mV)),
          R("Minimum V_dc (SVPWM)", eng(s.vac / 0.707, "V")),
          R("Minimum V_dc (SPWM)", eng(s.vac / 0.612, "V")),
          R("Frequency ratio f_sw/f_out", f2(Mratio)),
        ]),
        G("Currents", [
          R("Phase current rms / peak", eng(Iph, "A") + " · " + eng(Ipk, "A")),
          R("Device rms current", eng(Iph / Math.SQRT2, "A"), "roughly, per switch"),
          R("DC link cap rms current", eng(Icdc, "A"), "assumes unity power factor"),
        ]),
        G("Practical limits", [
          R("Device blocking voltage", eng(Vdc, "V"), "use 1200 V for a 650 V link"),
          R("Dead-time voltage error", eng(Vdt, "V"), "per phase, per cycle"),
          R("Fundamental output limit", eng(0.707 * Vdc, "V"), "line-to-line rms, SVPWM"),
        ]),
      ],
    };
  },
},
{
  id: "npc3", name: "Three-level NPC / T-type", cat: "DC–AC inversion", sch: "npc3",
  tag: "Clamp the midpoint and every device sees half the bus. Three levels, far less filtering.",
  chips: ["three-level", "medium voltage", "low THD"],
  what: "An ordinary inverter can only connect its output to the top of the supply or the bottom, so every step it takes is the full supply voltage. Split the supply with two capacitors and you have a third point available — the middle — and a clamp diode lets the output stop there on the way past. Now each step is only half as large. Halving the step halves the unwanted frequencies it creates and halves the voltage each device has to withstand, so the output filter shrinks and cheaper devices will do. The price is twice the device count, and the need to watch that middle point: every visit to it moves charge into one capacitor and out of the other, so it drifts unless the control actively balances it.",
  eqs: [
    { e: "V_device = V_dc/2", n: "the central benefit: 650 V parts on a 1200 V bus" },
    { e: "same V_LL as a two-level for a given V_dc", n: "the gain is quality, not amplitude" },
    { e: "ΔV_step = V_dc/2", n: "half the dv/dt into the load" },
    { e: "NP ripple at 3·f_out", n: "size the split caps for it and balance actively" },
  ],
  pros: ["Half the device voltage — cheaper, faster silicon", "Much lower output THD and dv/dt", "Higher efficiency at high switching frequency"],
  cons: ["Twice the devices (plus clamp diodes)", "Neutral-point balancing is mandatory", "Uneven loss distribution between inner and outer devices"],
  use: ["Solar inverters above 1 kV", "Medium-voltage drives", "Grid-tied storage"],
  fields: ["vdc", "vac", "fo", "fsw", "pout", "rds", "tsw"],
  defs: { vdc: 800, vac: 400, fo: 50, fsw: 16, pout: 30000 },
  design(s) {
    const fs = s.fsw * 1e3, Vdc = s.vdc;
    const mV = s.vac / (0.707 * Vdc);
    const Iph = s.pout / (Math.sqrt(3) * s.vac), Ipk = Math.SQRT2 * Iph;
    const Cnp = Ipk / (2 * Math.PI * 3 * s.fo * (0.02 * Vdc / 2));
    return {
      hi: [["device blocking V", eng(Vdc / 2, "V")], ["m (SVPWM)", f3(mV)], ["phase current", eng(Iph, "A")]],
      loss: [["Conduction", 12 * 0.5 * Iph * Iph * s.rds * 1e-3, "twelve devices share the phase current"],
        ["Switching", 12 * (2 / Math.PI) * Ipk * (Vdc / 2) * s.tsw * 1e-9 * fs / 2,
          "each transition only steps half the link — the point of the topology"]],
      warn: [mV > 1 && "m = " + f2(mV) + " is beyond the linear range; raise V_dc above " + eng(s.vac / 0.707, "V") + "."].filter(Boolean),
      groups: [
        G("Voltage structure", [
          R("Bus voltage", eng(Vdc, "V")),
          R("Device blocking voltage", eng(Vdc / 2, "V"), "vs " + eng(Vdc, "V") + " for a two-level"),
          R("Output levels", "+V_dc/2, 0, −V_dc/2"),
          R("Voltage step", eng(Vdc / 2, "V"), "half the dv/dt into the load"),
          R("m required (SVPWM)", f3(mV)),
        ]),
        G("Neutral point", [
          R("NP ripple frequency", eng(3 * s.fo, "Hz")),
          R("Split cap for 2 % NP ripple", eng(Cnp, "F") + " each"),
          R("Balancing", "redundant vector selection", "or a dedicated NP current controller"),
        ]),
        G("Currents and loss", [
          R("Phase current rms / peak", eng(Iph, "A") + " · " + eng(Ipk, "A")),
          R("Inner vs outer devices", "uneven", "inner devices conduct longer at high m"),
          R("Effective output frequency", eng(2 * fs, "Hz"), "as seen by the filter"),
        ]),
      ],
    };
  },
},
];

export { TC };
