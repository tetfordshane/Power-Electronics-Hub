import { G, R, R2, esrOhm, infeasible, swPeriod, W, warns } from "../fields.js";
import { clamp, eng, pct, f2, f3 } from "../format.js";

/* ================= topologies — rectification ================= */
const TD = [
{
  id: "halfwave", name: "Half-wave rectifier", cat: "Rectification", sch: "halfwave",
  tag: "One diode and a reservoir capacitor — the simplest rectifier, and the clearest demonstration of crest factor.",
  chips: ["one diode", "high ripple", "DC in the transformer"],
  what: "The capacitor charges near the peak of each cycle and is left to discharge through the load for the rest of it. The diode therefore conducts in a narrow spike carrying many times the DC current — why half-wave supplies run hot transformers and struggle to meet emissions limits. It also draws unidirectional current, so any transformer feeding one carries a DC flux offset.",
  eqs: [
    { e: "V_pk = √2·V_ac − V_F", n: "peak of the rectified waveform" },
    { e: "ΔV = I_dc/(f_line·C)", n: "the cap discharges for a whole period, not half" },
    { e: "θ_c = arccos(1 − ΔV/V_pk)", n: "conduction angle — the parameter that governs peak and rms current" },
    { e: "I_pk = 4π·I_dc/θ_c", n: "triangular charging pulse, one per cycle" },
    { e: "PIV = 2·V_pk", n: "the diode sees the source peak plus the charged capacitor" },
  ],
  pros: ["One diode", "Trivial to build", "Adequate for low-current bias supplies"],
  cons: ["Ripple at f_line, so the reservoir capacitor must be correspondingly large", "Crest factors of 5–15 heat the transformer", "DC magnetising current saturates the transformer"],
  use: ["Low-current bias rails", "Cheap appliance timers", "Instructional circuits"],
  fields: ["vacIn", "fline", "idc", "cbulk", "vf"],
  defs: { vacIn: 230, idc: 0.2, cbulk: 470, vf: 0.9 },
  design(s) {
    const C = s.cbulk * 1e-6, f = s.fline, Idc = s.idc;
    const Vpk = Math.SQRT2 * s.vacIn - s.vf;
    const dV = Idc / (f * C);
    const Vdc = Vpk - dV / 2;
    /* θ_c = arccos(1 − ΔV/V_pk) is only real for 0 < ΔV/V_pk ≤ 1. Outside
       that the capacitor never recharges within a cycle and the model has
       nothing to say, so clamp and let the warning explain.             */
    const rat = clamp(dV / Vpk, 1e-6, 0.999);
    const th = Math.acos(1 - rat);
    const Ipk = (4 * Math.PI * Idc) / th;
    const Irms = Ipk * Math.sqrt(th / (6 * Math.PI));
    const Ic = Math.sqrt(Math.max(Irms * Irms - Idc * Idc, 0));
    const PF = (Vdc * Idc) / (s.vacIn * Irms);
    return {
      hi: [["DC output", eng(Vdc, "V")], ["ripple p-p", eng(dV, "V")], ["diode peak", eng(Ipk, "A")]],
      loss: [["Diode conduction", s.vf * Idc, "V_F·I_dc", "D1"]],
      /* This array is why the tiers exist. It used to run a physical
         impossibility, a model that no longer applies, a roughness caveat, a
         stress figure and an unconditional footnote through one red box, in
         the order they happened to be written. */
      warn: warns(
        W("stop", Vpk <= 0 && "V_F is larger than the peak of the AC input — no current can flow at all. Lower the diode drop or raise V_ac."),
        /* Everything below this line on the page is computed by a model that
           does not describe what was entered. That is a stop. */
        W("stop", Vpk > 0 && dV >= Vpk && "The capacitor fully discharges between peaks: this is not a DC rail, and the conduction-angle model below does not apply. Increase C_bulk or reduce the load."),
        W("check", Vpk > 0 && dV <= Vpk && dV > 0.3 * Vpk && "Ripple is " + pct(dV / Vpk) + " of the peak. The conduction-angle model gets rough past ~30 %, and the rail is barely DC."),
        W("check", Ipk / Idc > 12 && "Crest factor is " + f2(Ipk / Idc) + ". The transformer and diode see currents an order of magnitude above the DC draw."),
        W("note", "A half-wave rectifier draws unidirectional current. Any transformer ahead of it needs a gap or a much larger core to survive the DC flux."),
      ),
      groups: [
        G("Output", [
          R("Peak rectified voltage", eng(Vpk, "V")),
          R("Ripple ΔV p-p", eng(dV, "V"), "at f_line = " + s.fline + " Hz"),
          R("Mean DC output", eng(Vdc, "V")),
          R("Ripple as % of V_pk", pct(dV / Vpk)),
        ]),
        G("Diode and source currents", [
          R("Conduction angle θ_c", f2(th * 180 / Math.PI) + "°", "of each full cycle"),
          R("Peak diode current", eng(Ipk, "A")),
          R("Diode / line rms current", eng(Irms, "A")),
          R("Crest factor I_pk/I_dc", f2(Ipk / Idc)),
          R("Diode PIV", eng(2 * Vpk, "V"), "derate to 2× this"),
        ]),
        G("Losses and quality", [
          R("Diode conduction loss", eng(s.vf * Idc, "W")),
          R("Capacitor rms ripple current", eng(Ic, "A"), "sizes the cap, not capacitance"),
          R("Power factor", f2(PF), "displacement is fine; distortion is not"),
        ]),
      ],
    };
  },
},
{
  id: "bridgerect", name: "Full-bridge rectifier", cat: "Rectification", sch: "bridgerect",
  tag: "Four diodes, both half-cycles, twice the ripple frequency. The classic mains front end.",
  chips: ["four diodes", "2·f_line ripple", "no PFC"],
  what: "Using both half-cycles halves the ripple for a given capacitor and removes the DC component from the transformer. Two diode drops now sit in the path. The current still flows in narrow spikes near the peak, which is why anything above 75 W needs a PFC stage in front of it to meet harmonic limits.",
  eqs: [
    { e: "V_pk = √2·V_ac − 2·V_F", n: "two diodes conduct in series each half-cycle" },
    { e: "ΔV = I_dc/(2·f_line·C)", n: "twice the ripple frequency, half the ripple" },
    { e: "I_pk = 2π·I_dc/θ_c", n: "two charging pulses per cycle now" },
    { e: "PIV = V_pk", n: "half the half-wave requirement" },
    { e: "PF = P_dc/(V_ac·I_rms)", n: "typically 0.5–0.7 — distortion, not phase" },
  ],
  pros: ["No DC in the transformer", "Ripple at 2·f_line", "Diodes only block the peak, not twice it"],
  cons: ["Two diode drops — poor at low output voltages", "Power factor around 0.6 and high harmonics", "Uncontrolled inrush at switch-on"],
  use: ["Every non-PFC mains supply", "Motor drive front ends", "Secondary of an isolated converter"],
  fields: ["vacIn", "fline", "idc", "cbulk", "vf"],
  defs: { vacIn: 230, idc: 1, cbulk: 470, vf: 0.9 },
  design(s) {
    const C = s.cbulk * 1e-6, f = s.fline, Idc = s.idc;
    const Vpk = Math.SQRT2 * s.vacIn - 2 * s.vf;
    const dV = Idc / (2 * f * C);
    const Vdc = Vpk - dV / 2;
    const rat = clamp(dV / Vpk, 1e-6, 0.999);
    const th = Math.acos(1 - rat);
    const Ipk = (2 * Math.PI * Idc) / th;
    const Irms = Ipk * Math.sqrt(th / (3 * Math.PI));
    const Ic = Math.sqrt(Math.max(Irms * Irms - Idc * Idc, 0));
    const PF = (Vdc * Idc) / (s.vacIn * Irms);
    const Pd = 2 * s.vf * Idc;
    return {
      hi: [["DC output", eng(Vdc, "V")], ["ripple p-p", eng(dV, "V")], ["power factor", f2(PF)]],
      /* All four, because over a whole line cycle every diode carries a
         half-cycle — the "two in series" is per half-cycle, not per part. */
      loss: [["Diode conduction", Pd, "2·V_F·I_dc — two diodes in series each half-cycle",
        ["D1", "D2", "D3", "D4"]]],
      warn: warns(
        W("check", PF < 0.7 && "Power factor is " + f2(PF) + " with badly distorted line current. Above 75 W this will not pass IEC 61000-3-2 — put a PFC stage in front."),
        W("check", Ipk / Idc > 8 && "Crest factor " + f2(Ipk / Idc) + ": the bridge and the source both see " + eng(Ipk, "A") + " peaks. Size the diode's I_FSM accordingly."),
        W("note", "Inrush at switch-on is limited only by line and ESR impedance. Budget an NTC or a relay-bypassed resistor."),
      ),
      groups: [
        G("Output", [
          R("Peak rectified voltage", eng(Vpk, "V")),
          R("Ripple ΔV p-p", eng(dV, "V"), "at 2·f_line = " + eng(2 * f, "Hz")),
          R("Mean DC output", eng(Vdc, "V")),
          R("C for 5 % ripple", eng(Idc / (2 * f * 0.05 * Vpk), "F"), "if you want to do better"),
        ]),
        G("Currents", [
          R("Conduction angle θ_c", f2(th * 180 / Math.PI) + "°"),
          R("Peak diode current", eng(Ipk, "A")),
          R("Line rms current", eng(Irms, "A")),
          R("Crest factor", f2(Ipk / Idc)),
          R("Capacitor rms ripple", eng(Ic, "A")),
        ]),
        G("Devices and quality", [
          R("Diode PIV", eng(Vpk, "V"), "use 600 V for 230 V mains"),
          R("Bridge conduction loss", eng(Pd, "W"), "two drops in the path"),
          R("Diode average (each)", eng(Idc / 2, "A")),
          R("Power factor", f2(PF)),
          R("Apparent power drawn", eng(s.vacIn * Irms, "VA")),
        ]),
      ],
    };
  },
},
{
  id: "ctrect", name: "Centre-tapped rectifier", cat: "Rectification", sch: "ctrect",
  tag: "Two diodes, one drop in the path. The standard secondary for low-voltage outputs.",
  chips: ["secondary side", "one V_F", "choke input"],
  what: "A centre-tapped secondary lets each half-winding supply one half-cycle through a single diode, so only one forward drop sits in the output path instead of two. That matters enormously at 3.3 or 5 V. The cost is transformer utilisation: each half-winding works only half the time, so the secondary needs about twice the copper of a bridge.",
  eqs: [
    { e: "V_out = 2·D·(V_sec − V_F)", n: "two pulses per period, each of width D·T — so D is measured against the whole period and stays under 0.5" },
    { e: "L_f = (V_sec − V_F − V_out)·D/(f_sw·ΔI)", n: "filter choke from the ripple you allow" },
    { e: "PIV = 2·V_sec", n: "the idle diode sees both half-windings in series" },
    { e: "I_D(avg) = I_out/2", n: "independent of duty — the freewheel period splits evenly" },
    { e: "output ripple sits at 2·f_sw", n: "two power pulses per switching cycle" },
  ],
  pros: ["Only one diode drop in the output path", "Two devices instead of four", "Both rectifiers share a common ground — easy to drive if synchronous"],
  cons: ["Needs twice the secondary copper", "Diodes block twice the winding voltage", "Centre tap must be accurately placed or the halves imbalance"],
  use: ["Low-voltage secondaries of forward and push-pull converters", "Linear supply secondaries", "Anywhere V_F costs real efficiency"],
  fields: ["vsec", "dnom", "iout", "fsw", "r", "vf", "esr", "dvout", "lsag"],
  defs: { vsec: 12, dnom: 0.4, iout: 20, fsw: 150, r: 0.3, vf: 0.45, esr: 3, dvout: 30 },
  design(s) {
    const fs = s.fsw * 1e3, D = s.dnom, Io = s.iout;
    /* Each of the two pulses can occupy at most half the period. Past that
       the halves would overlap and short the secondary — and arithmetically
       V_out climbs above the winding that feeds it, so the choke's volt-second
       balance inverts and L comes out negative. The warning said so while the
       table went on printing negative henries beside it. */
    if (D >= 0.5) return infeasible("Each half-cycle can occupy at most half the period, so D must stay "
      + "below 0.5 — at " + f2(D) + " the two rectifiers would conduct together and short the secondary. "
      + "Lower the duty, or raise V_sec if you were reaching for more output voltage.");
    /* Two power pulses per period, each of width D·T, so the choke's input
       averages 2·D·(V_sec − V_F) and not D·(V_sec − V_F).

       This page carried the factor-of-two error until the double-pulse timing
       was drawn honestly, and the error was findable because three of its own
       formulas disagreed with the fourth. L_f = (V_sec − V_F − V_out)·D/(f·ΔI)
       puts the rise over D·T; I_D(rms) = I_out·√(D + (1 − 2D)/4) and
       I_D(avg) = I_out/2 both split the freewheel over (1 − 2D); and the
       warning below says D must stay under 0.5. All four only agree if D is
       one pulse measured against the WHOLE period — which is the same
       convention the push-pull, half-bridge and phase-shifted bridge use, and
       under it volt-second balance on the choke gives
       (V_sec − V_F − V_out)·D = V_out·(½ − D), i.e. V_out = 2·D·(V_sec − V_F).
       V_out was the odd one out, so V_out is what moved. */
    const Vo = 2 * D * (s.vsec - s.vf);
    const dI = s.r * Io;
    const L = (s.vsec - s.vf - Vo) * D / (fs * dI);
    const Ipk = Io + dI / 2;
    const Idrms = Io * Math.sqrt(D + (1 - 2 * D) / 4);
    const Co = dI / (8 * 2 * fs * s.dvout * 1e-3);
    const Pd = s.vf * Io;
    const Pesr = dI * dI / 12 * s.esr * 1e-3;
    return {
      /* The components the circuit is built from, in SI. There is no primary
         on this page, so the netlist synthesises one at V_sec — see pilot.js. */
      sim: { L, C: Co },
      hi: [["output voltage", eng(Vo, "V")], ["filter choke", eng(L, "H")], ["rectifier loss", eng(Pd, "W")]],
      /* Two pulses per period and a diode drop, so V_out is 2·D·(V_sec − V_F)
         and not the D·V_sec the generic estimate assumes from a duty and a
         winding voltage. The efficiency map divides by this, and was reading
         roughly half the real output power for every point on the surface. */
      pout: Vo * Io,
      loss: [["Rectifiers", Pd, "V_F·I_out — one diode drop in the path at a time", ["D1", "D2"]],
        ["Output cap ESR", Pesr, "(ΔI²/12)·ESR"]],
      /* Two power pulses per period — but NOT bipolar. This node is behind
         the rectifiers, so both half-cycles arrive positive and its mean is
         2·D × V_sec rather than zero. The primary that feeds it is the bipolar
         one; that pane lives on the push-pull and bridge pages. */
      wave: { sat: s.lsag / 100, D: D, dI: dI, iavg: Io, vlabel: "v_rect", vhi: "V_sec", ilabel: "i_Lf",
        pulses: 2,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: warns(
        W("check", D > 0.46 && "D = " + f2(D) + " leaves almost no margin below the 0.5 ceiling. Real drives need dead time between the halves, so keep a few points in hand."),
        W("note", Pd > 0.05 * Vo * Io && "Rectifier loss is " + pct(Pd / (Vo * Io)) + " of the output. At this current a synchronous rectifier is justified."),
      ),
      groups: [
        G("Operating point", [
          R("Output voltage", eng(Vo, "V")),
          R("Required V_sec for " + eng(Vo, "V"), eng(Vo / (2 * D) + s.vf, "V")),
          R("Duty of each pulse", f2(D), "of the whole period — two pulses, so ≤ 0.5"),
          R("Ripple frequency", eng(2 * fs, "Hz")),
        ]),
        G("Filter", [
          R("L_f", eng(L, "H"), "for ΔI = " + pct(s.r)),
          R("ΔI_L", eng(dI, "A")),
          R("I_L peak", eng(Ipk, "A")),
          R("C_out (charge term)", eng(Co, "F"), "for ΔV = " + s.dvout + " mV"),
          R("ΔV from ESR", eng(dI * s.esr * 1e-3, "V")),
        ]),
        G("Rectifiers", [
          R("PIV per diode", eng(2 * s.vsec, "V"), "derate ≥ 1.5× for leakage ringing"),
          R("Average current each", eng(Io / 2, "A")),
          R("RMS current each", eng(Idrms, "A")),
          R("Total conduction loss", eng(Pd, "W"), "one drop, not two"),
          R("Output cap ESR loss", eng(Pesr, "W")),
        ]),
      ],
    };
  },
},
{
  id: "syncrect", name: "Synchronous rectifier", cat: "Rectification", sch: "syncrect",
  tag: "Replace the diode with a MOSFET and the loss stops being a fixed voltage drop.",
  chips: ["MOSFET rectifier", "low V_out", "drive matters"],
  what: "A diode dissipates V_F·I regardless of device selection. A MOSFET dissipates I²·R_DS, which at low current is far less — and the crossover between them is the whole design question. Below the break-even current the FET wins by a wide margin; the practical limits are body-diode conduction during dead time, gate charge at high frequency, and reverse conduction in discontinuous operation.",
  eqs: [
    { e: "P_diode = V_F·I_out", n: "a fixed drop, independent of device quality" },
    { e: "P_sync = 2·I_rms²·R_DS(on)", n: "two rectifiers sharing the output current" },
    { e: "I_breakeven = V_F/R_DS(on)", n: "above this a single FET beats a single diode" },
    { e: "P_body = 2·V_F·I_out·t_dead·f_sw", n: "the body diode still conducts across each transition" },
    { e: "P_gate = 2·Q_g·V_gate·f_sw", n: "dissipated in the driver every cycle" },
  ],
  pros: ["Cuts rectification loss several-fold at low output voltage", "Loss falls with current, so light-load efficiency improves", "Enables reverse power flow if you want it"],
  cons: ["Gate drive and timing must be right or you get shoot-through", "Reverse conduction in DCM dumps energy back", "Gate charge sets a frequency ceiling"],
  use: ["Every 12 V and below output above a few amps", "Server and telecom rectifiers", "Anywhere the secondary loss dominates"],
  fields: ["vout", "iout", "fsw", "dnom", "r", "dvout", "vf", "rds", "qg", "vg", "td"],
  defs: { vout: 5, iout: 30, fsw: 150, dnom: 0.4, r: 0.3, dvout: 20, vf: 0.45, rds: 3, qg: 30, vg: 10, td: 60 },
  design(s) {
    const fs = s.fsw * 1e3, Io = s.iout, D = s.dnom, Rd = s.rds * 1e-3;
    const Irms = Io * Math.sqrt(D + (1 - 2 * D) / 4);
    const Pdio = s.vf * Io;
    const Pcond = 2 * Irms * Irms * Rd;
    const Pbody = 2 * s.vf * Io * s.td * 1e-9 * fs;
    const Pgate = 2 * s.qg * 1e-9 * s.vg * fs;
    const Psync = Pcond + Pbody + Pgate;
    const Ibe = s.vf / Rd;
    const Po = s.vout * Io;
    /* The output filter this page used to leave implicit.

       It is the same centre-tapped secondary the rectifier page next door
       describes, so the same volt-second balance applies: two pulses of width
       D against the whole period, V_out = 2·D·(V_sec − drop). The only
       difference is what the drop IS — a channel resistance rather than a
       fixed forward voltage, which is the entire subject of the page. Turning
       that round gives the winding voltage the design implies, and from it a
       choke and a capacitor.

       Without these the page had loss numbers and no converter: no ΔI, no
       ripple, and nothing for the figure below to be a figure OF. */
    const Vsec = s.vout / (2 * D) + Io * Rd;
    const dI = s.r * Io;
    const Lf = (Vsec - Io * Rd - s.vout) * D / (fs * dI);
    const Co = dI / (8 * 2 * fs * s.dvout * 1e-3);
    return {
      /* The components the circuit is built from, in SI. There is no primary
         on this page either, so the netlist synthesises one at V_sec. */
      sim: { L: Lf, C: Co, Vsec },
      hi: [["diode loss", eng(Pdio, "W")], ["synchronous loss", eng(Psync, "W")], ["efficiency gained", pct((Pdio - Psync) / Po)]],
      loss: [["Channel conduction", Pcond, "2·I_rms²·R_DS(on)", ["SR1", "SR2"]],
        /* The body diode is inside the same two parts, which is the point:
           the dead time heats the device it was meant to protect. */
        ["Body diode (dead time)", Pbody, "2·V_F·I_out·t_dead·f_sw", ["SR1", "SR2"]],
        ["Gate drive", Pgate, "2·Q_g·V_gate·f_sw", ["SR1", "SR2"]]],
      warn: warns(
        W("check", Psync > Pdio && "At this current the FET is losing to the diode. R_DS(on) of " + s.rds + " mΩ breaks even at " + eng(Ibe, "A") + " — either parallel devices or keep the Schottky."),
        W("check", Pgate > 0.25 * Psync && "Gate drive is " + pct(Pgate / Psync) + " of the total. At " + s.fsw + " kHz a lower-Q_g device beats a lower-R_DS one."),
        W("check", Pbody > 0.2 * Psync && "Body-diode conduction is " + pct(Pbody / Psync) + " of the loss. Tighten the dead time — " + s.td + " ns is costing " + eng(Pbody, "W") + "."),
      ),
      groups: [
        G("The comparison", [
          R("Schottky loss V_F·I_out", eng(Pdio, "W")),
          R("Synchronous total", eng(Psync, "W")),
          R("Power saved", eng(Pdio - Psync, "W")),
          R("Efficiency delta", pct((Pdio - Psync) / Po), "on a " + eng(Po, "W") + " output"),
          R("Break-even current", eng(Ibe, "A"), "one FET vs one diode"),
        ]),
        G("Where the synchronous watts go", [
          R("Channel conduction", eng(Pcond, "W"), "I_rms = " + eng(Irms, "A") + " each"),
          R("Body diode in dead time", eng(Pbody, "W"), s.td + " ns × 2 per cycle"),
          R("Gate drive", eng(Pgate, "W")),
          R("Equivalent drop per rectifier", eng(Irms * Rd, "V"), "against " + s.vf + " V for the diode"),
        ]),
        G("The secondary it rectifies", [
          R("Winding voltage V_sec needed", eng(Vsec, "V"), "for " + eng(s.vout, "V") + " at D = " + f2(D)),
          R("Filter choke L_f", eng(Lf, "H"), "for ΔI = " + pct(s.r)),
          R("ΔI_L", eng(dI, "A")),
          R("C_out (charge term)", eng(Co, "F"), "for ΔV = " + s.dvout + " mV"),
          R("Ripple frequency", eng(2 * fs, "Hz"), "two power pulses per switching period"),
        ]),
        G("Getting the drive right", [
          R("Self-driven", "free, poor timing", "windings drive the gates; fails at high duty"),
          R("Control-driven", "best timing", "needs a level shift and accurate dead time"),
          R("Sensing SR controller", "robust", "watches V_DS; standard for flyback and LLC"),
          R("DCM hazard", "reverse conduction", "turn off on zero crossing, not on the clock"),
        ]),
      ],
      /* Two power pulses per period, and the node behind the rectifiers is
         positive in both — the same choke-input filter the centre-tapped
         rectifier page draws, because it is the same secondary. What differs
         is only what stands in the return leg. */
      wave: { D, dI, iavg: Io, vlabel: "v_tap", vhi: "V_sec", ilabel: "i_Lf",
        pulses: 2,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: s.vout, Io, fsw: fs } },
    };
  },
},
{
  id: "doubler", name: "Current doubler rectifier", cat: "Rectification", sch: "doubler",
  tag: "One secondary winding, two inductors, each carrying half the output current.",
  chips: ["high current", "ripple cancellation", "single winding"],
  what: "Two inductors feed the output in antiphase from a single secondary winding. Each carries only half the load current, their ripples partly cancel at the output, and the winding sees the full duty rather than half — so the transformer is used better than a centre-tapped design. It is the standard secondary for high-current, low-voltage converters.",
  eqs: [
    { e: "V_out = D·(V_sec − V_F)", n: "each inductor is effectively a buck stage, behind one rectifier drop" },
    { e: "I_L1 = I_L2 = I_out/2", n: "the defining property of the topology" },
    { e: "L = (V_sec − V_F − V_out)·D/(f_sw·ΔI_L)", n: "sized per inductor, for half the current" },
    { e: "K(D) = |1 − 2D|/(1 − D)", n: "ripple cancellation factor at the output node" },
    { e: "I_D(avg) = I_out/2", n: "each rectifier, same as centre-tapped" },
  ],
  pros: ["Single secondary winding — best transformer utilisation", "Two smaller inductors instead of one large one", "Output ripple partly cancels and sits at 2·f_sw"],
  cons: ["Two inductors to wind and place", "Current sharing depends on matched inductors", "Marginal benefit below about 10 A"],
  use: ["High-current low-voltage secondaries", "Phase-shifted full-bridge outputs", "Server VRM front ends"],
  fields: ["vsec", "dnom", "iout", "fsw", "r", "vf", "dcr", "dvout", "lsag"],
  defs: { vsec: 14, dnom: 0.35, iout: 60, fsw: 200, r: 0.4, vf: 0.45, dvout: 30 },
  design(s) {
    const fs = s.fsw * 1e3, D = s.dnom, Io = s.iout;
    /* One rectifier drop sits in the output path at every instant — the one
       clamping the far end of the winding — exactly as it does on the
       centre-tapped page, which writes V_out = 2·D·(V_sec − V_F). This page
       said V_out = D·V_sec and then charged V_F·I_out to the loss budget
       beside it, which is the same drop counted once and ignored once. At a
       5 V rail it is nine per cent of the output. */
    const Vo = D * (s.vsec - s.vf);
    const IL = Io / 2;
    const dI = s.r * IL;
    const L = (s.vsec - s.vf - Vo) * D / (fs * dI);
    /* K(D) = |1−2D|/(1−D) is the published cancellation factor, and it is
       genuinely 0 at D = 0.5 — but only D < 0.5 is physical here, since
       each polarity can occupy at most half the period.                  */
    const physical = D < 0.5;
    const K = physical ? Math.abs(1 - 2 * D) / (1 - D) : NaN;
    const dIo = dI * K;
    const Co = dIo / (8 * 2 * fs * s.dvout * 1e-3);
    const Ipk = IL + dI / 2;
    const Pd = s.vf * Io;
    /* Two windings each carrying half the load, all of the time — this is a
       60 A output, so it is not a footnote. It is also what stops the two
       chokes from sharing badly: the current in one against the other is
       opposed by nothing else at all, which is precisely the caution in the
       cons list, and with no resistance at all the split is not merely
       delicate but undetermined. */
    const Pcu = 2 * IL * IL * s.dcr * 1e-3;
    return {
      /* The components the circuit is built from, in SI. There is no primary
         on this page, so the netlist synthesises one at V_sec — see pilot.js. */
      sim: { L, C: Co },
      /* V_out here is D·V_sec, a RESULT — the reader typed a winding voltage
         and a duty. The efficiency map divides by output power, and left to
         guess from the input fields it had no output voltage to guess with, so
         the whole surface was computed against the wrong denominator. The
         centre-tapped rectifier next door publishes this for the same reason. */
      pout: Vo * Io,
      hi: [["output voltage", eng(Vo, "V")], ["each inductor", eng(L, "H")], ["current per inductor", eng(IL, "A")]],
      loss: [["Rectifiers", Pd, "V_F·I_out", ["D1", "D2"]],
        ["Inductor windings", Pcu, "2·(I_out/2)²·DCR — both carry half the load all the time"]],
      /* One inductor is plotted; the capacitor sees both, half a period apart.
         Handing the model the phase count rather than the cancelled ripple
         means the pane derives K from the two waveforms — so the drawn ripple
         is a consequence of the interleaving rather than a restatement of the
         published factor above it. */
      wave: { sat: s.lsag / 100, D: D, dI: dI, iavg: IL, vlabel: "v_sec", vhi: "V_sec", ilabel: "i_L1",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, n: 2 } },
      warn: warns(
        W("stop", D > 0.5 && "D = " + f2(D) + " is above 0.5, which is not physical for a current doubler — each polarity can occupy at most half the period."),
        W("note", Math.abs(D - 0.5) < 0.06 && "Duty is close to 0.5, where the two ripples cancel almost perfectly. Excellent for the output cap, but leaves no headroom for line regulation."),
        /* Winding resistance is the ONLY thing opposing an imbalance between
           the two chokes — the output holds their sum, nothing holds their
           difference. At zero it is not merely delicate, it is undetermined,
           and the figure draws one of infinitely many splits without any way
           to say so. */
        W("check", s.dcr < 0.05 && "With DCR at " + s.dcr + " mΩ nothing opposes an imbalance between the two chokes: the output fixes their sum and nothing fixes their difference. Give the windings their real resistance — the sharing the figure draws is arbitrary otherwise."),
      ),
      groups: [
        G("Operating point", [
          R("Output voltage", eng(Vo, "V")),
          R("Required V_sec", eng(Vo / D + s.vf, "V"), "for the target output, drop included"),
          R("Duty D", f2(D)),
          R("Output ripple frequency", eng(2 * fs, "Hz")),
        ]),
        G("Inductors", [
          R("L each", eng(L, "H")),
          R("DC current each", eng(IL, "A"), "half the load"),
          R("ΔI per inductor", eng(dI, "A")),
          R("Peak current each", eng(Ipk, "A")),
          R("Cancellation factor K(D)", f2(K), "|1−2D|/(1−D); 1.0 = no benefit"),
          R("Net output ripple", eng(dIo, "A"), "after cancellation"),
          R("Winding loss (both)", eng(Pcu, "W"), "at " + s.dcr + " mΩ each — and it is what makes the two chokes share"),
        ]),
        G("Rectifiers and cap", [
          R("PIV", eng(s.vsec, "V"), "half the centre-tapped requirement"),
          R("Average current each", eng(Io / 2, "A")),
          R("Peak current each", eng(Io, "A"), "carries the full load during power transfer"),
          R("Rectifier loss", eng(Pd, "W")),
          R("C_out (charge term)", K > 1e-3 ? eng(Co, "F") : "≈ 0",
            K > 1e-3 ? "small, thanks to cancellation"
              : "the charge term vanishes at perfect cancellation — ESR and inductor mismatch set the real ripple here"),
        ]),
      ],
    };
  },
},
];

export { TD };
