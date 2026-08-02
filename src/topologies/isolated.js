import { G, R, R2, esrOhm, infeasible, swPeriod } from "../fields.js";
import { clamp, eng, pct, f2, f3 } from "../format.js";

/* ===================== topologies — isolated ===================== */
const TB = [
{
  id: "flyback", name: "Flyback", cat: "Isolated DC–DC", sch: "flyback",
  tag: "One magnetic component, one switch, any number of isolated outputs. Cheap and everywhere.",
  chips: ["isolated", "≤ 150 W", "coupled inductor"],
  what: "The 'transformer' is really a gapped coupled inductor: it stores energy in t_on and dumps it in t_off. That is why it needs a gap and why leakage inductance — energy that never crosses to the secondary — has to be caught by a clamp. Multiple secondaries track each other well because they all discharge the same field.",
  eqs: [
    { e: "V_out = V_in·D / (N·(1 − D)),  N = N_p/N_s", n: "CCM; in DCM the output also depends on load" },
    { e: "V_R = N·(V_out + V_F)", n: "reflected voltage — the quantity that sets the primary device rating" },
    { e: "V_DS = V_in(max) + V_R + spike", n: "leave 20–30 % headroom for the leakage spike" },
    { e: "L_p = (V_in·D)²·(2 − K_rp) / (2·f_sw·P_in·K_rp)", n: "K_rp = 1 gives the CCM/DCM boundary" },
    { e: "P_clamp = ½·L_lk·I_pk²·f_sw·V_cl/(V_cl − V_R)", n: "RCD clamp dissipation — size R from it" },
  ],
  pros: ["Cheapest isolated topology: one switch, one magnetic", "Multiple isolated outputs almost free", "Very wide input range (universal mains)"],
  cons: ["Large rms currents; output cap works hard", "Leakage energy must be dissipated or recovered", "RHP zero in CCM makes the loop slow"],
  use: ["Phone and laptop adapters", "Auxiliary/bias supplies", "Isolated industrial rails"],
  fields: ["vinMin", "vinMax", "vout", "iout", "fsw", "dmax", "krp", "vf", "dvout", "esr", "eff", "llk", "vclamp", "rds", "lsag"],
  defs: { vinMin: 120, vinMax: 375, vout: 19, iout: 3.5, fsw: 65, dvout: 200, vf: 0.5, esr: 20, eff: 0.87 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, D = s.dmax, K = Math.min(Math.max(s.krp, 0.05), 1);
    const Po = Vo * Io, Pin = Po / s.eff;
    const Nt = s.vinMin * D / ((1 - D) * (Vo + s.vf));
    const Vr = Nt * (Vo + s.vf);
    const Vds = s.vinMax + Vr;
    const Lp = (s.vinMin * D) * (s.vinMin * D) * (2 - K) / (2 * fs * Pin * K);
    const Ipk = 2 * Pin / (s.vinMin * D * (2 - K));
    const Iv = Ipk * (1 - K);
    const sq = Ipk * Ipk + Ipk * Iv + Iv * Iv;
    const Iprms = Math.sqrt(D * sq / 3);
    const Isrms = Nt * Math.sqrt((1 - D) * sq / 3);
    const Ispk = Nt * Ipk;
    /* The secondary ramp AT THE LEVEL THAT DELIVERS THE LOAD. I_pk above is
       derived from input power, so it carries the 1/η allowance — right for
       rectifier stress, wrong for the output capacitor, whose job is defined
       by charge balance against I_out and nothing else. These are the same two
       numbers the capacitor pane is drawn from, written once so the printed
       rms and the drawn trace cannot describe different currents. */
    const Is0 = 2 * Io / ((1 - D) * (2 - K));
    const Is1 = 2 * Io * (1 - K) / ((1 - D) * (2 - K));
    const IsLoad = Math.sqrt((1 - D) * (Is0 * Is0 + Is0 * Is1 + Is1 * Is1) / 3);
    const Ico = Math.sqrt(Math.max(IsLoad * IsLoad - Io * Io, 0));
    const Co = Io * D / (fs * s.dvout * 1e-3);
    const dVe = Ispk * s.esr * 1e-3;
    const Vdr = Vo + s.vinMax / Nt;
    const Pcl = 0.5 * s.llk * 1e-6 * Ipk * Ipk * fs * s.vclamp / Math.max(s.vclamp - Vr, 1);
    const Rcl = s.vclamp * s.vclamp / Math.max(Pcl, 1e-6);
    const frhp = (1 - D) * (1 - D) * (Vo / Io) / (2 * Math.PI * D * (Lp / (Nt * Nt)));
    const Pq = Iprms * Iprms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Pesr = Ico * Ico * s.esr * 1e-3;
    return {
      hi: [["turns ratio N_p:N_s", f2(Nt) + " : 1"], ["primary L_p", eng(Lp, "H")], ["V_DS stress", eng(Vds, "V")]],
      loss: [["Primary conduction", Pq, "I_pri(rms)²·R_DS(on)"],
        ["Clamp (leakage)", Pcl, "½·L_lk·I_pk²·f_sw, scaled by the clamp ratio"],
        ["Output rectifier", Pdo, "V_F·I_out"],
        ["Output cap ESR", Pesr, "I_C(rms)²·ESR"]],
      /* The plotted trace is the PRIMARY current, which stops dead at
         turn-off. The capacitor is on the other side of the transformer: it
         sees the reflected secondary current, N·I_pk decaying to N·I_v, and
         only during the off-time. So the two panes are genuinely different
         currents on the same figure, and neither is derivable from the other
         without the turns ratio. */
      wave: { sat: s.lsag / 100, D, dI: Ipk - Iv, iavg: (Ipk + Iv) / 2, pulse: true, ilabel: "i_pri",
        vlabel: "v_DS", vhi: "V_in+V_R", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs,
          /* The secondary's peak and valley, at the level that delivers
             exactly I_out. I_spk = N·I_pk above is derived from INPUT power,
             so it carries the efficiency allowance — the right thing for
             rectifier stress, and the wrong thing here. Whatever the
             converter loses, the charge arriving at the output node still has
             to equal the charge the load removes, or the rail would walk away
             cycle after cycle. So the flux ramp sets the shape, I_v/I_pk =
             1 − K, and the load sets the level. */
          i0: Is0, i1: Is1 } },
      warn: [
        s.vclamp < Vr * 1.2 && "Clamp voltage is too close to V_R (" + eng(Vr, "V") + ") — clamp loss runs away. Use V_clamp ≈ 1.3–1.5·V_R.",
        Vds > 600 && "V_DS reaches " + eng(Vds, "V") + " before the leakage spike. That is 900 V+ silicon territory; lower N or use active clamp.",
        K >= 0.99 && "K_rp = 1 is the DCM boundary: peak currents are at their highest here. Lower K_rp for CCM if rms current is the problem.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_p/N_s", f2(Nt)),
          R("Reflected voltage V_R", eng(Vr, "V")),
          R("Primary inductance L_p", eng(Lp, "H")),
          R("I_pk / I_valley", eng(Ipk, "A") + " · " + eng(Iv, "A")),
          R("Primary rms", eng(Iprms, "A"), "sets primary wire gauge"),
          R("Secondary rms / peak", eng(Isrms, "A") + " · " + eng(Ispk, "A")),
          R("Stored energy", eng(0.5 * Lp * Ipk * Ipk, "J"), "sets the core size and gap"),
        ]),
        G("Semiconductors", [
          R("V_DS (before spike)", eng(Vds, "V"), "choose ≥ 1.25× this"),
          R("Primary rms current", eng(Iprms, "A")),
          R("Output diode V_R", eng(Vdr, "V"), "V_out + V_in(max)/N"),
          R("Output diode I_avg", eng(Io, "A")),
        ]),
        G("Clamp and snubber", [
          R("Leakage energy per cycle", eng(0.5 * s.llk * 1e-6 * Ipk * Ipk, "J")),
          R("Clamp dissipation", eng(Pcl, "W"), "at V_clamp = " + s.vclamp + " V"),
          R("Clamp resistor", eng(Rcl, "Ω")),
          R("Clamp cap (5 % ripple)", eng(s.vclamp / (Rcl * fs * 0.05 * s.vclamp), "F")),
        ]),
        G("Output side", [
          R("C_out (charge)", eng(Co, "F")),
          R("ΔV from ESR", eng(dVe, "V"), dVe > 2 * s.dvout * 1e-3 ? "ESR dominates — parallel more caps or add an LC post-filter" : "acceptable"),
          R("C_out rms current", eng(Ico, "A"), "the usual failure point"),
          R("RHP zero", eng(frhp, "Hz"), "cross over below " + eng(frhp / 5, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "qrflyback", name: "Quasi-resonant flyback", cat: "Isolated DC–DC", sch: "qrflyback",
  tag: "A flyback that waits for the ringing to reach a trough before switching on again.",
  chips: ["isolated", "valley switching", "variable frequency"],
  what: "When a flyback finishes delivering its energy, the transformer and the switch's own capacitance are left ringing together — an ordinary flyback ignores this and turns on whenever the clock says, often at the top of the ring, dumping whatever charge is on the switch as heat. A quasi-resonant one watches instead, and waits for the ring to reach a trough before turning on. The voltage it switches at is then as low as that ring ever goes, so the loss and the noise both fall sharply. The consequence is that the converter can no longer keep a fixed frequency — it must wait for a trough, and the troughs move with load and line. Nearly every efficient mains adapter works this way.",
  eqs: [
    { e: "f_ring = 1/(2π√(L_p·C_res))", n: "the transformer's primary inductance ringing against the switch's own capacitance" },
    { e: "first valley at t = ½·f_ring", n: "half a ring period after the secondary current reaches zero" },
    { e: "V_switch(valley) = V_in − V_R", n: "against V_in + V_R at the peak — the difference is what is saved" },
    { e: "P_cap = ½·C_res·V_sw²·f_sw", n: "what a hard-switched flyback burns in the switch at every turn-on" },
    { e: "T = t_on + t_dis + k/(2·f_ring)", n: "the period is a sum of intervals, not a setting — so the frequency drifts with load" },
  ],
  pros: ["Turn-on loss and switching noise both fall sharply", "The parasitic ring becomes part of the design rather than something to snub", "Cheap: needs no extra power components at all"],
  cons: ["Frequency varies with load and line, so the EMI filter must cover a range", "Valley hopping near a boundary can make audible noise", "Needs a controller that can sense the ring"],
  use: ["Phone and laptop adapters", "Standby and bias supplies", "Anywhere efficiency standards bite at light load"],
  fields: ["vinMin", "vinMax", "vout", "iout", "fsw", "dmax", "krp", "vf", "dvout", "esr", "eff", "coss", "llk", "rds"],
  defs: { vinMin: 120, vinMax: 375, vout: 19, iout: 3.5, fsw: 65, dvout: 200, vf: 0.5, esr: 20, eff: 0.87, coss: 150, dmax: 0.45 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, D = s.dmax, K = Math.min(Math.max(s.krp, 0.05), 1);
    const Po = Vo * Io, Pin = Po / s.eff;
    const Nt = s.vinMin * D / ((1 - D) * (Vo + s.vf));
    const Vr = Nt * (Vo + s.vf);
    const Lp = (s.vinMin * D) * (s.vinMin * D) * (2 - K) / (2 * fs * Pin * K);
    const Ipk = 2 * Pin / (s.vinMin * D * (2 - K));
    const Iv = Ipk * (1 - K);
    const Cres = s.coss * 1e-12;
    /* The ring the switch node makes once the secondary has finished. */
    const fRing = 1 / (2 * Math.PI * Math.sqrt(Lp * Cres));
    const tValley = 1 / (2 * fRing);
    /* Peak and valley of that ring, about V_in. A hard-switched flyback turns
       on somewhere between them; a quasi-resonant one waits for the bottom. */
    const Vpeak = s.vinMax + Vr;
    const Vvalley = Math.max(s.vinMax - Vr, 0);
    const Phard = 0.5 * Cres * Vpeak * Vpeak * fs;
    const Psoft = 0.5 * Cres * Vvalley * Vvalley * fs;
    const saved = Phard - Psoft;
    const sq = Ipk * Ipk + Ipk * Iv + Iv * Iv;
    const Iprms = Math.sqrt(D * sq / 3);
    const Is0 = 2 * Io / ((1 - D) * (2 - K));
    const Is1 = 2 * Io * (1 - K) / ((1 - D) * (2 - K));
    const IsLoad = Math.sqrt((1 - D) * (Is0 * Is0 + Is0 * Is1 + Is1 * Is1) / 3);
    const Ico = Math.sqrt(Math.max(IsLoad * IsLoad - Io * Io, 0));
    const Co = Io * D / (fs * s.dvout * 1e-3);
    const Pq = Iprms * Iprms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Pesr = Ico * Ico * s.esr * 1e-3;
    const Pt = Pq + Pdo + Pesr + Psoft;
    return {
      hi: [["ring frequency", eng(fRing, "Hz")], ["turn-on saved", eng(saved, "W")],
        ["switch V at the valley", eng(Vvalley, "V")]],
      loss: [["Primary conduction", Pq, "I_pri(rms)²·R_DS(on)"],
        ["Turn-on at the valley", Psoft, "½·C_res·V_valley²·f_sw — what is left after waiting"],
        ["Output rectifier", Pdo, "V_F·I_out"],
        ["Output cap ESR", Pesr, "I_C(rms)²·ESR"]],
      warn: [
        Vvalley <= 0 && "The ring reaches all the way down to zero volts at V_in max, so the switch can turn on at true zero. This is the ideal case and needs V_R ≥ V_in — check the turns ratio is really giving you that.",
        saved < 0.02 * Po && "Waiting for the valley saves only " + eng(saved, "W") + " here. At this C_oss and frequency a fixed-frequency flyback is simpler and just as efficient.",
        tValley > 0.3 / fs && "One half ring is " + eng(tValley, "s") + ", which is a large fraction of the period at " + s.fsw + " kHz. The frequency will move a long way with load.",
      ].filter(Boolean),
      groups: [
        G("The ring", [
          R("Ring frequency", eng(fRing, "Hz"), "L_p against C_res"),
          R("Time to the first valley", eng(tValley, "s"), "half a ring period after the secondary empties"),
          R("Switch voltage at the peak", eng(Vpeak, "V"), "where a fixed-frequency flyback would turn on"),
          R("Switch voltage at the valley", eng(Vvalley, "V"), "where this one waits for"),
        ]),
        G("What waiting buys", [
          R("Turn-on loss, hard switched", eng(Phard, "W")),
          R("Turn-on loss, at the valley", eng(Psoft, "W")),
          R("Saved", eng(saved, "W"), pct(saved / Math.max(Po, 1e-9)) + " of the output"),
          R("C_res assumed", eng(Cres, "F"), "the switch's own output capacitance plus winding capacitance"),
        ]),
        G("Transformer and output", [
          R("Turns ratio N_p/N_s", f2(Nt)),
          R("Primary inductance L_p", eng(Lp, "H")),
          R("Primary peak / rms current", eng(Ipk, "A") + " · " + eng(Iprms, "A")),
          R("Reflected voltage V_R", eng(Vr, "V")),
          R("C_out (charge)", eng(Co, "F")),
          R("C_out rms current", eng(Ico, "A")),
        ]),
        G("Loss budget", [
          R("Primary conduction", eng(Pq, "W")),
          R("Turn-on at the valley", eng(Psoft, "W")),
          R("Output rectifier", eng(Pdo, "W")),
          R("Total / efficiency", eng(Pt, "W") + " → " + pct(Po / (Po + Pt))),
        ]),
      ],
      /* Same pulse-shaped primary as a plain flyback — the difference is in
         WHEN the next pulse starts, not in the shape of this one. */
      wave: { D, dI: Ipk - Iv, iavg: (Ipk + Iv) / 2, pulse: true, ilabel: "i_pri",
        vlabel: "v_DS", vhi: "V_in+V_R", vinv: true,
        cap: { kind: "boost", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs, i0: Is0, i1: Is1 } },
    };
  },
},
{
  id: "forward2", name: "Two-switch forward", cat: "Isolated DC–DC", sch: "forward2",
  tag: "Transformer-coupled buck. Switches clamp to V_in, so no snubber is needed.",
  chips: ["isolated", "100–500 W", "D < 0.5"],
  what: "Unlike a flyback, the forward transformer transfers power while the switch is on and stores nothing on purpose — an output inductor does the storage. The two clamp diodes return magnetising energy to the input and hold both FETs at V_in, which is why this topology is so robust.",
  eqs: [
    { e: "V_out = n·V_in·D,  n = N_s/N_p", n: "D limited to < 0.5 for core reset" },
    { e: "L = V_out·(1 − D)/(f_sw·ΔI_L)", n: "output filter behaves exactly like a buck" },
    { e: "V_DS = V_in(max)", n: "clamped by D_a/D_b — the whole point" },
    { e: "I_pri = n·I_out + I_mag", n: "magnetising current adds nothing useful; the numbers below carry the reflected term only, so add I_mag = V_in·D/(L_m·f_sw) once you have picked a core" },
  ],
  pros: ["Devices clamped to V_in — 500 V FETs run off 400 V bus", "Low output ripple (inductor + buck-style filter)", "No dissipative snubber needed"],
  cons: ["Duty limited below 0.5 → poor transformer utilisation", "Two switches with one high-side drive", "Needs an output inductor"],
  use: ["Telecom bricks", "Industrial 200–500 W supplies", "Server auxiliary rails"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "eff", "rds", "tsw"],
  defs: { vinMin: 330, vinNom: 390, vinMax: 420, vout: 12, iout: 25, fsw: 150, dvout: 100, dmax: 0.45 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const n = (Vo + s.vf) / (s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (n * s.vinNom), Dm = (Vo + s.vf) / (n * s.vinMax);
    const dI = s.r * Io, L = Vo * (1 - Dm) / (fs * dI);
    const Co = dI / (8 * fs * s.dvout * 1e-3);
    const Ipri = n * Io;
    const Iprms = Ipri * Math.sqrt(Dn);
    /* Two FETs sit in series in the primary path, so the reflected current
       passes through two channels rather than one. */
    const Pq = 2 * Iprms * Iprms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Psw = 2 * 0.5 * s.vinNom * Ipri * s.tsw * 1e-9 * fs;
    return {
      hi: [["turns ratio N_s:N_p", f3(n)], ["output L", eng(L, "H")], ["D at V_in nom", f3(Dn)]],
      loss: [["Primary conduction", Pq, "2·I_pri(rms)²·R_DS(on) — two devices in series"],
        ["Primary switching", Psw, "2·½·V_in·I_pri·(t_r+t_f)·f_sw"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* An output inductor sits between the rectifier and the load, so output
         current is continuous and the capacitor takes the ripple alone — a
         buck filter behind a transformer, which is what a forward is. One
         power pulse per switching period, so C_out is sized at f_sw and the
         pane draws one ripple per drawn period to match. */
      wave: { D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in",
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        s.dmax >= 0.5 && "D_max must stay below 0.5 with a 1:1 reset — the core will not reset in time.",
        Dm < 0.1 && "Duty falls to " + f3(Dm) + " at V_in max; check the controller's minimum on-time and the transformer's utilisation.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_s/N_p", f3(n), "= 1/" + f2(1 / n)),
          R("D at V_in min / nom / max", f3(s.dmax) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Primary current (flat top)", eng(Ipri, "A"), "reflected load only — magnetising current not included"),
          R("Primary rms", eng(Iprms, "A"), "add I_mag once L_m is known"),
          R("Secondary rms", eng(Io * Math.sqrt(Dn), "A")),
          R("Reset time needed", eng(Dn / fs, "s"), "equal to t_on — this is what forces D < 0.5"),
        ]),
        G("Output filter", [
          R("L", eng(L, "H"), "sized at V_in max"),
          R("ΔI_L", eng(dI, "A")),
          R("C_out (charge)", eng(Co, "F")),
          R("LC corner", eng(1 / (2 * Math.PI * Math.sqrt(L * Co)), "Hz")),
        ]),
        G("Stresses", [
          R("Q1 / Q2 V_DS", eng(s.vinMax, "V"), "hard clamped — no derating games"),
          R("Forward diode V_R", eng(n * s.vinMax, "V")),
          R("Freewheel diode I_avg", eng(Io * (1 - Dn), "A")),
        ]),
      ],
    };
  },
},
{
  id: "pushpull", name: "Push-pull", cat: "Isolated DC–DC", sch: "pushpull",
  tag: "Two ground-referenced switches drive a centre-tapped primary. Simple drive, 2·V_in stress.",
  chips: ["isolated", "low V_in", "flux walking"],
  what: "Both switches sit on the ground rail, so no high-side drive is needed — ideal for low-voltage inputs like 12 V or 24 V. The transformer is driven in both quadrants, so it is used efficiently, but any asymmetry between the two half-cycles walks the flux toward saturation.",
  eqs: [
    { e: "V_out = 2·n·V_in·D", n: "D is per switch, ≤ 0.45" },
    { e: "V_DS = 2·V_in + leakage spike", n: "the reason this is a low-voltage topology" },
    { e: "L = V_out·(1 − 2D)/(2·f_sw·ΔI_L)", n: "the filter sees twice the switching frequency" },
    { e: "flux walking → use peak current mode", n: "or a DC blocking cap in series with the primary" },
  ],
  pros: ["Both gate drives ground-referenced", "Transformer driven in both quadrants — small core", "Output ripple at 2·f_sw"],
  cons: ["2·V_in switch stress plus spike", "Flux imbalance can saturate the core", "Centre-tapped primary wastes copper"],
  use: ["12/24/48 V isolated bricks", "Inverter front ends", "Automotive DC–DC"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "eff", "rds", "tsw"],
  defs: { vinMin: 20, vinNom: 24, vinMax: 32, vout: 48, iout: 6, fsw: 100, dvout: 150, dmax: 0.42 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const n = (Vo + s.vf) / (2 * s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (2 * n * s.vinNom), Dm = (Vo + s.vf) / (2 * n * s.vinMax);
    const dI = s.r * Io;
    const L = Vo * (1 - 2 * Dm) / (2 * fs * dI);
    const Co = dI / (8 * 2 * fs * s.dvout * 1e-3);
    /* The current in the half of the primary that is conducting. Reflected
       from the output through one half-winding, so it is n·I_out — not twice
       that. This was named for the sum of both halves and then divided by two
       at every use, which came out right and read wrong. */
    const Ipri = n * Io;
    /* Each switch carries I_pri for its own duty D, so the pair
       dissipates 2·(I_pri·√D)²·R_DS. */
    const Iqrms = Ipri * Math.sqrt(Dn);
    const Pq = 2 * Iqrms * Iqrms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Psw = 2 * 0.5 * (2 * s.vinNom) * Ipri * s.tsw * 1e-9 * fs;
    return {
      hi: [["turns ratio N_s:N_p", f3(n)], ["output L", eng(L, "H")], ["V_DS stress", eng(2 * s.vinMax, "V")]],
      loss: [["Primary conduction", Pq, "2·I_Q(rms)²·R_DS(on)"],
        ["Primary switching", Psw, "hard switched against 2·V_in"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* DOUBLE-PULSE OUTPUT FILTERS. A push-pull, half-bridge, phase-shifted
         bridge or centre-tapped rectifier delivers TWO power pulses per
         switching period, so its choke ramps up over D·T and back down over
         (½ − D)·T, twice. This used to be drawn as one ramp per period, rising
         over D and falling over the whole of (1 − D): peak, valley and ΔI were
         right — which is why the sizing numbers beside it were right — but the
         falling ramp was stretched, so the TIME proportions were wrong, and a
         capacitor pane is a charge integral over exactly those proportions.

         `pulses: 2` builds one sub-interval and tiles it, so the on-fraction
         within each half-period is 2·D and both the ripple frequency and the
         charge integral come out right. `vbi` makes the primary pane bipolar,
         which it genuinely is — the winding sees +V_in, nothing, −V_in,
         nothing. Its mean is zero by symmetry, and that is not a decoration:
         a mean that is NOT zero is flux walking, which is what the warning
         below this line is about. */
      wave: { D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in",
        pulses: 2, vbi: true,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        s.dmax > 0.48 && "D per switch must stay below 0.5 or both switches conduct at once and short the primary.",
        2 * s.vinMax > 200 && "2·V_in max = " + eng(2 * s.vinMax, "V") + " before the spike. Consider a half-bridge instead.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_s/N_p (per half)", f3(n)),
          /* V_in min first, matching every other topology's duty row: duty is
             largest where the input is lowest, so this reads high to low. */
          R("D per switch at V_in min / nom / max", f3(s.dmax) + " · " + f3(Dn) + " · " + f3(Dm)),
          R("Primary current when on", eng(Ipri, "A")),
          R("Switch rms current", eng(Iqrms, "A")),
        ]),
        G("Output filter", [
          R("L", eng(L, "H"), "ripple at 2·f_sw = " + eng(2 * fs, "Hz")),
          R("C_out (charge)", eng(Co, "F")),
          R("Rectifier V_R", eng(2 * n * s.vinMax, "V"), "centre-tapped secondary"),
        ]),
        G("Stresses and cautions", [
          R("V_DS", eng(2 * s.vinMax, "V"), "plus leakage spike — snubber required"),
          R("Flux balancing", "peak current mode", "or add a series DC blocking cap"),
        ]),
      ],
    };
  },
},
{
  id: "halfbridge", name: "Half-bridge", cat: "Isolated DC–DC", sch: "halfbridge",
  tag: "Two switches across the bus, primary between the midpoints. Devices see only V_in.",
  chips: ["isolated", "200 W–1 kW", "off-line"],
  what: "The capacitor divider gives a return at V_in/2, so the primary swings ±V_in/2 and each switch blocks only V_in. That halves the voltage rating compared with a push-pull, which is why almost every off-line supply above 200 W starts here or at the full bridge.",
  eqs: [
    { e: "V_out = n·V_in·D", n: "D per switch ≤ 0.45; the winding sees V_in/2" },
    { e: "V_DS = V_in", n: "no doubling — 500 V devices work off a 390 V bus" },
    { e: "L = V_out·(1 − 2D)/(2·f_sw·ΔI_L)", n: "filter sees 2·f_sw" },
    { e: "C_blk balances the volt-seconds", n: "kills flux walking automatically" },
  ],
  pros: ["Switch stress equals V_in", "Series blocking cap prevents flux walking", "Good transformer utilisation"],
  cons: ["Primary current is twice the full bridge for the same power", "High-side drive required", "Divider caps carry large ripple current"],
  use: ["Off-line 200 W–1 kW supplies", "Welding and industrial supplies", "LLC precursor"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "eff", "rds", "tsw", "lsag"],
  defs: { vinMin: 330, vinNom: 390, vinMax: 420, vout: 48, iout: 12, fsw: 100, dvout: 150, dmax: 0.45 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout;
    const n = (Vo + s.vf) / (s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (n * s.vinNom), Dm = (Vo + s.vf) / (n * s.vinMax);
    const dI = s.r * Io;
    const L = Vo * (1 - 2 * Dm) / (2 * fs * dI);
    const Co = dI / (8 * 2 * fs * s.dvout * 1e-3);
    const Ipri = n * Io;
    /* Both switches conduct D each, so the primary rms over a full period
       is I_pri·√(2D). Each divider cap sees roughly half of that.       */
    const Iqrms = Ipri * Math.sqrt(Dn);
    const Iprms = Ipri * Math.sqrt(2 * Dn);
    const Icdiv = Iprms / 2;
    const Pq = 2 * Iqrms * Iqrms * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    const Psw = 2 * 0.5 * s.vinNom * Ipri * s.tsw * 1e-9 * fs;
    return {
      hi: [["turns ratio N_s:N_p", f3(n)], ["output L", eng(L, "H")], ["V_DS stress", eng(s.vinMax, "V")]],
      loss: [["Primary conduction", Pq, "2·I_Q(rms)²·R_DS(on)"],
        ["Primary switching", Psw, "hard switched against V_in"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* Two power pulses per period and a bipolar primary — see the note on
         the push-pull. The series blocking capacitor exists precisely because
         the mean this pane draws has to be zero. */
      wave: { sat: s.lsag / 100, D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in/2",
        pulses: 2, vbi: true,
        cap: { kind: "buck", C: Co, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        s.dmax >= 0.5 && "D per switch must stay below 0.5, or both switches conduct at once and short the bus.",
      ].filter(Boolean),
      groups: [
        G("Transformer", [
          R("Turns ratio N_s/N_p", f3(n)),
          R("D per switch (nom)", f3(Dn)),
          R("Primary current when on", eng(Ipri, "A")),
          R("Primary rms (full period)", eng(Iprms, "A"), "I_pri·√(2D) — both half-cycles"),
          R("Switch rms (each)", eng(Iqrms, "A"), "I_pri·√D — one half-cycle each"),
        ]),
        G("Bridge capacitors", [
          R("Divider cap rms current", eng(Icdiv, "A"), "each cap carries half the primary rms"),
          R("Blocking cap", "film, ≥ 0.1 µF", "sized so V_C ripple ≪ V_in/2"),
        ]),
        G("Output filter", [
          R("L", eng(L, "H")), R("C_out (charge)", eng(Co, "F")),
          R("Rectifier V_R", eng(n * s.vinMax, "V")),
          R("Ripple frequency", eng(2 * fs, "Hz")),
        ]),
      ],
    };
  },
},
{
  id: "psfb", name: "Phase-shifted full bridge", cat: "Isolated DC–DC", sch: "psfb",
  tag: "Full bridge where phase, not duty, sets the output — and the parasitics give you ZVS for free.",
  chips: ["isolated", "0.5–5 kW", "ZVS"],
  what: "A full bridge where nothing is throttled by duty at all — both halves run flat out at an even fifty-fifty. What is varied is the timing of one half against the other. When the two are aligned they fight each other and the transformer sees nothing; slide them apart and the transformer is driven for the overlap. That is the control. The bonus is what happens in the gaps: the leakage inductance of the transformer, normally a nuisance, keeps pushing current and uses it to discharge the switch that is about to turn on, so it closes with no voltage across it and costs nothing to close. The catch is that this depends on there being enough current to do the discharging, so at light load one leg loses the effect and starts switching hard.",
  eqs: [
    { e: "V_out = 2·n·V_in·D_eff", n: "D_eff = phase shift / 180°" },
    { e: "ΔD = 4·L_r·n·I_out·f_sw / V_in", n: "duty lost while the primary current reverses" },
    { e: "½·L_r·I_pri² ≥ (4/3)·C_oss·V_in²", n: "lagging-leg ZVS; the 4/3 lumps device C_oss with transformer winding capacitance" },
    { e: "t_dead ≈ 2·C_oss·V_in / I_pri", n: "or a quarter of the L_r–C_oss resonant period" },
  ],
  pros: ["ZVS on all four switches over most of the load range", "Fixed frequency — easy filtering and control", "Scales well to kilowatts"],
  cons: ["Lagging leg loses ZVS at light load", "Duty loss and secondary ringing need attention", "Four switches plus a current-sensing scheme"],
  use: ["Server and telecom rectifiers", "EV on-board chargers", "Industrial 1–5 kW supplies"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fsw", "dmax", "r", "dvout", "vf", "lr", "coss", "rds"],
  defs: { vinMin: 350, vinNom: 400, vinMax: 420, vout: 48, iout: 40, fsw: 100, dvout: 150, dmax: 0.45, lr: 12, coss: 400 },
  design(s) {
    const fs = s.fsw * 1e3, Vo = s.vout, Io = s.iout, Lr = s.lr * 1e-6, Co_ss = s.coss * 1e-12;
    const n = (Vo + s.vf) / (2 * s.vinMin * s.dmax);
    const Dn = (Vo + s.vf) / (2 * n * s.vinNom);
    const dD = 4 * Lr * n * Io * fs / s.vinNom;
    const Ipri = n * Io;
    const dI = s.r * Io;
    /* Size the choke where its ripple is worst, which is V_in max — the same
       corner the buck, the forward, the push-pull and the half-bridge all use.
       Two things push that way at once here: the duty needed falls as the
       input rises, and the duty LOST while the primary current reverses has
       to come off as well, because the choke only sees what actually reaches
       it. Sizing at nominal duty and ignoring the loss it had already
       computed left L undersized on both counts. */
    const Dm = (Vo + s.vf) / (2 * n * s.vinMax);
    const dDm = 4 * Lr * n * Io * fs / s.vinMax;
    const Deff = Math.max(Dm - dDm, 0.01);
    const L = Vo * (1 - 2 * Deff) / (2 * fs * dI);
    const Cout = dI / (8 * 2 * fs * s.dvout * 1e-3);
    const Izvs = s.vinNom * Math.sqrt((8 / 3) * Co_ss / Lr);
    const td = 2 * Co_ss * s.vinNom / Math.max(Ipri, 1e-6);
    const zvsLoad = Izvs / n;
    /* In a PSFB the primary current keeps circulating through two devices
       for the whole period, including the freewheel intervals — that
       circulating conduction is the topology's characteristic loss. */
    const Pq = 2 * Ipri * Ipri * s.rds * 1e-3;
    const Pdo = s.vf * Io;
    return {
      hi: [["turns ratio", f3(n)], ["duty loss", pct(dD)], ["ZVS above", eng(zvsLoad, "A")]],
      loss: [["Primary conduction", Pq, "2·I_pri²·R_DS(on), circulating all period"],
        ["Output rectifiers", Pdo, "V_F·I_out"]],
      /* Two power pulses per period and a bipolar primary — see the note on
         the push-pull. The duty loss above is a separate effect: it shortens
         the pulses without changing how many there are. */
      wave: { D: Dn, dI, iavg: Io , vlabel: "v_pri", vhi: "V_in",
        pulses: 2, vbi: true,
        cap: { kind: "buck", C: Cout, esr: esrOhm(s), Vdc: Vo, Io, fsw: fs } },
      warn: [
        dD > 0.15 && "Duty loss is " + pct(dD) + " — that is a lot of transformer you are not using. Reduce L_r or the turns ratio.",
        zvsLoad > Io * 0.5 && "The lagging leg only achieves ZVS above " + eng(zvsLoad, "A") + " of output. Add magnetising current, a saturable inductor, or accept hard switching at light load.",
      ].filter(Boolean),
      groups: [
        G("Transformer and duty", [
          R("Turns ratio N_s/N_p", f3(n)),
          R("Effective duty at V_in nom", f3(Dn)),
          R("Duty loss ΔD", f3(dD), pct(dD) + " of the half period"),
          R("Effective duty at V_in max", f3(Deff), "after duty loss — the corner the choke is sized at"),
          R("Primary current", eng(Ipri, "A")),
        ]),
        G("Soft switching", [
          R("Resonant inductance L_r", eng(Lr, "H"), "leakage plus any added series L"),
          R("Primary current for ZVS", eng(Izvs, "A")),
          R("Equivalent output current", eng(zvsLoad, "A"), "below this the lagging leg hard-switches"),
          R("Dead time (lagging leg)", eng(td, "s")),
          R("L_r–C_oss resonance", eng(1 / (2 * Math.PI * Math.sqrt(Lr * 2 * Co_ss)), "Hz")),
        ]),
        G("Output filter", [
          R("L_o", eng(L, "H"), "sized at V_in max including duty loss, where the ripple is worst"),
          R("C_out (charge)", eng(Cout, "F")),
          R("Ripple frequency", eng(2 * fs, "Hz")),
          R("Rectifier V_R", eng(2 * n * s.vinMax, "V"), "add a clamp for the ringing"),
        ]),
      ],
    };
  },
},
{
  id: "llc", name: "LLC resonant half-bridge", cat: "Isolated DC–DC", sch: "llc",
  tag: "Frequency-controlled resonant tank. ZVS everywhere, ZCS on the rectifiers, very quiet.",
  chips: ["isolated", "resonant", "ZVS + ZCS"],
  what: "An inductor and a capacitor tuned together — a tank — sit between the switches and the transformer. A tank passes current most easily at one particular frequency and resists it either side, so moving the switching frequency up or down changes how much power gets through. That is the control here: frequency, not duty. The reward is that the tank rounds every edge into a sinusoid, so the switches turn on with no voltage across them and the output rectifiers turn off with no current in them — almost nothing is dissipated in the act of switching, and there is very little noise. The cost is that a frequency-controlled converter is harder to filter and harder to compensate than a fixed-frequency one.",
  eqs: [
    { e: "f_r = 1/(2π√(L_r·C_r))", n: "series resonance — the design centre" },
    { e: "M = 1/√[(1 + 1/L_n − 1/(L_n·f_n²))² + Q²(f_n − 1/f_n)²]", n: "first-harmonic gain, f_n = f_sw/f_r" },
    { e: "Q = √(L_r/C_r)/R_ac,  R_ac = (8/π²)·n²·R_load", n: "load enters as Q; higher load = lower peak gain" },
    { e: "n = V_in(nom)/(2·V_out)", n: "unity gain at f_r for a half-bridge" },
    { e: "I_m(pk) = n·V_out/(4·f_sw·L_m)", n: "this current is what charges C_oss for ZVS" },
  ],
  pros: ["ZVS from full load to no load; ZCS on the secondary diodes", "Very low EMI — no hard edges", "Excellent efficiency at the resonant point"],
  cons: ["Variable frequency complicates filtering and control", "Gain collapses if you fall below the peak-gain frequency", "Needs an integrated-magnetics transformer or a real L_r"],
  use: ["Server and LED PSUs downstream of PFC", "EV chargers", "TV and monitor supplies"],
  fields: ["vinMin", "vinNom", "vinMax", "vout", "iout", "fr", "ln", "qf", "vf", "coss", "td", "rds"],
  defs: { vinMin: 330, vinNom: 390, vinMax: 410, vout: 12, iout: 20, fr: 100, ln: 5, qf: 0.4, coss: 300, td: 200 },
  design(s) {
    const fr = s.fr * 1e3, Vo = s.vout, Io = s.iout, Ln = s.ln, Qd = s.qf;
    const n = s.vinNom / (2 * (Vo + s.vf));
    const Rac = (8 / (Math.PI * Math.PI)) * n * n * (Vo / Io);
    const Cr = 1 / (2 * Math.PI * fr * Qd * Rac);
    const Lr = 1 / (Math.pow(2 * Math.PI * fr, 2) * Cr);
    const Lm = Ln * Lr;
    const M = (fn, Q) => 1 / Math.sqrt(Math.pow(1 + 1 / Ln - 1 / (Ln * fn * fn), 2) + Q * Q * Math.pow(fn - 1 / fn, 2));
    const Mmax = s.vinNom / s.vinMin, Mmin = s.vinNom / s.vinMax;
    /* The gain curve rises from zero, peaks BELOW f_n = 1, then falls away
       monotonically. Only the falling side is inductive; the rising side is
       capacitive, where the LLC loses ZVS and destroys itself. Locate the
       peak first, then solve on the inductive branch only — a naive upward
       sweep from f_n = 0.3 returns the capacitive solution.              */
    const FN_LO = 0.2, FN_HI = 4;
    let fPeak = 1, peak = 0;
    for (let f = FN_LO; f <= FN_HI; f += 0.001) {
      const m = M(f, Qd);
      if (m > peak) { peak = m; fPeak = f; }
    }
    const solveFn = (target) => {
      if (!(target > 0) || target > peak) return null;   // gain unreachable
      if (M(FN_HI, Qd) > target) return null;            // never falls that far
      let lo = fPeak, hi = FN_HI;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (M(mid, Qd) >= target) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const fnLo = solveFn(Mmax), fnHi = solveFn(Mmin);
    const Impk = n * (Vo + s.vf) / (4 * fr * Lm);
    const tdmin = 2 * s.coss * 1e-12 * s.vinNom / Math.max(Impk, 1e-9);
    const Icr = Math.sqrt(Math.pow(Math.PI * Io / (2 * Math.sqrt(2) * n), 2) + Math.pow(Impk / Math.sqrt(2), 2));
    const Vcr = s.vinNom / 2 + Icr * Math.sqrt(2) / (2 * Math.PI * fr * Cr);
    const xTop = 2;
    const QS = [0.2, 0.35, 0.5, 0.8, 1.2];
    /* The scale has to clear the tallest curve actually drawn, not just the
       design one — otherwise the lightest-load curve is clipped flat across
       the top of the frame and reads as a plotting error. */
    let curveMax = Math.max(peak, Mmax);
    QS.forEach((q) => { for (let f = 0.35; f <= xTop; f += 0.02) curveMax = Math.max(curveMax, M(f, q)); });
    const yTop = Math.max(2.2, Math.ceil(curveMax * 1.08 * 5) / 5);
    const series = QS.map((q, i) => {
      const pts = []; for (let f = 0.35; f <= xTop; f += 0.02) pts.push([f, Math.min(M(f, q), yTop)]);
      return { pts, c: ["#2E5A66", "#3C7C87", "#4AA0AC", "#5AD1DE", "#294A54"][i], o: 0.75, label: "Q=" + q };
    });
    const opPts = []; for (let f = 0.35; f <= xTop; f += 0.02) opPts.push([f, Math.min(M(f, Qd), yTop)]);
    series.push({ pts: opPts, c: "#E0A458", w: 2.4, label: "Q=" + Qd + " ←" });
    return {
      hi: [["turns ratio", f2(n) + " : 1"], ["L_r and C_r", eng(Lr, "H") + " · " + eng(Cr, "F")], ["L_m", eng(Lm, "H")]],
      loss: [["Primary conduction", Icr * Icr * s.rds * 1e-3, "I_Cr(rms)²·R_DS(on) — one device conducts at a time"],
        ["Output rectifiers", s.vf * Io, "V_F·I_out; ZCS means no reverse-recovery term"]],
      chart: {
        title: "Tank gain vs normalised frequency",
        series, xmin: 0.35, xmax: xTop, ymin: 0, ymax: yTop, xlab: "f_n = f_sw / f_r", ylab: "gain M",
        marks: [
          { y: Mmax, t: "M needed at V_in min", c: "#6FD39B" },
          { y: Mmin, t: "M at V_in max", c: "#F0796C" },
        ],
        vmarks: [{ x: fPeak, t: "peak gain — do not go left of this", c: "#F0796C" }],
      },
      warn: [
        fnLo === null && "The tank cannot produce the gain of " + f2(Mmax) + " that V_in min demands — its peak is only "
          + f2(peak) + ". Lower Q (lighter design load), lower L_n, or narrow the input range.",
        fnLo !== null && peak < Mmax * 1.1 && "Peak gain (" + f2(peak) + ") barely covers the " + f2(Mmax)
          + " you need at V_in min. Lower Q or L_n, or accept a narrower hold-up window.",
        fnLo !== null && fnLo < fPeak * 1.1 && "The low-line point (f_n = " + f2(fnLo) + ") sits close to the peak-gain frequency at "
          + f2(fPeak) + ". Any further down is capacitive, and losing ZVS there is how LLC converters fail.",
        fnHi === null && "The tank never falls to the gain of " + f2(Mmin) + " that V_in max needs within f_n ≤ " + FN_HI
          + " — the converter will not regulate at high line without burst mode.",
      ].filter(Boolean),
      groups: [
        G("Tank", [
          R("Turns ratio n", f2(n), "unity gain at f_r"),
          R("R_ac at full load", eng(Rac, "Ω")),
          R("C_r", eng(Cr, "F"), "film, high dV/dt rating"),
          R("L_r", eng(Lr, "H"), "leakage or a discrete inductor"),
          R("L_m", eng(Lm, "H"), "L_n = " + f2(Ln)),
          R("Peak gain at design Q", f2(peak), "at f_n = " + f2(fPeak)),
        ]),
        G("Operating range", [
          R("Gain needed at V_in min", f2(Mmax)),
          R("Gain needed at V_in max", f2(Mmin)),
          R("Peak-gain frequency", eng(fPeak * fr, "Hz"), "the capacitive boundary — never operate below it"),
          R("f_sw at V_in min", fnLo === null ? "unreachable" : eng(fnLo * fr, "Hz"),
            fnLo === null ? "the tank cannot make this much gain" : "on the inductive branch, f_n = " + f2(fnLo)),
          R("f_sw at V_in max", fnHi === null ? "unreachable" : eng(fnHi * fr, "Hz"),
            fnHi === null ? "gain never falls far enough" : "f_n = " + f2(fnHi)),
          R("Frequency span", fnLo && fnHi ? f2(fnHi / fnLo) + " : 1" : "—"),
        ]),
        G("Currents and ZVS", [
          R("Magnetising peak current", eng(Impk, "A")),
          R("Resonant cap rms current", eng(Icr, "A")),
          R("C_r peak voltage", eng(Vcr, "V"), "rate the film cap for this"),
          R("Minimum dead time", eng(tdmin, "s"), "to fully swing the half-bridge node"),
          R("Rectifier V_R", eng(2 * (Vo + s.vf), "V"), "×2 for centre-tapped"),
        ]),
      ],
    };
  },
},
{
  id: "dab", name: "Dual active bridge", cat: "Isolated DC–DC", sch: "dab",
  tag: "Two bridges, one transformer, power set by phase. Bidirectional by nature.",
  chips: ["isolated", "bidirectional", "phase-shift control"],
  what: "Two switching bridges face each other across a transformer, each making its own square wave, with an inductor between them. Whichever bridge leads in timing pushes power to the other — exactly like two people pushing a swing slightly out of step, where whoever pushes first does the work. The size of that timing offset sets how much power crosses, and its sign sets which way. Nothing has to be reconfigured to run the converter backwards: shift the phase the other way and the power reverses, which is why this is the standard choice wherever a battery has to both charge and discharge.",
  eqs: [
    { e: "P = n·V1·V2·d·(1 − d)/(2·f_sw·L)", n: "d = φ/180°, single-phase-shift modulation" },
    { e: "P_max at d = 0.5", n: "but rms current is awful there — design for d ≈ 0.2–0.35" },
    { e: "L = n·V1·V2·d(1 − d)/(2·f_sw·P)", n: "solve for L at the rated operating point" },
    { e: "ZVS needs n·V2 ≈ V1", n: "the range narrows fast when the ratio drifts" },
  ],
  pros: ["Truly bidirectional with one control variable", "Soft switching over a useful range", "Galvanic isolation with symmetric structure"],
  cons: ["Eight switches", "ZVS range collapses when V1 ≠ n·V2", "Large circulating current at low load"],
  use: ["EV on-board chargers with V2G", "Battery energy storage interfaces", "Solid-state transformers"],
  fields: ["vinNom", "v2", "pout", "fsw", "phi", "ncell", "coss", "rds", "rdsS", "tsw"],
  defs: { vinNom: 400, v2: 48, pout: 3300, fsw: 100, phi: 40, ncell: 8, rds: 25, rdsS: 1.5, tsw: 50 },
  design(s) {
    const fs = s.fsw * 1e3, V1 = s.vinNom, V2 = s.v2, n = s.ncell;
    const d = s.phi / 180;
    const L = n * V1 * V2 * d * (1 - d) / (2 * fs * s.pout);
    const Pmax = n * V1 * V2 * 0.25 / (2 * fs * L);
    const I1 = s.pout / V1, I2 = s.pout / V2;
    const ratio = n * V2 / V1;
    /* Tank current is piecewise linear over the half period. Its two corner
       values are the currents present at each bridge's switching instant —
       which is exactly what has to charge C_oss for ZVS.                 */
    const i0 = (V1 / (4 * fs * L)) * (1 - ratio + 2 * d * ratio);   // at the side-1 transition
    const id = (V1 / (4 * fs * L)) * (2 * d + ratio - 1);           // at the side-2 transition
    const Ipk = Math.max(Math.abs(i0), Math.abs(id));
    /* Over a half period the tank current is two straight runs, and
       ∫(a + (b−a)t)²dt = (a² + ab + b²)/3 on each. The half-wave symmetry
       i(t + T/2) = −i(t) is what fixes the endpoints: the phase-shift
       interval starts at −i0 and ends at +id, so it CROSSES ZERO and its
       cross-term is negative; the remainder runs from id up to i0 with both
       endpoints the same sign, so its cross-term is positive. These were the
       wrong way round, which put the sign-changing run's cancellation on the
       run that never changes sign and read about 20 % low — understating the
       copper and both bridges' conduction loss with it. */
    const Irms = Math.sqrt((d * (i0 * i0 - i0 * id + id * id)
      + (1 - d) * (id * id + id * i0 + i0 * i0)) / 3);
    const Ereq = (4 / 3) * s.coss * 1e-12 * V1 * V1;
    const E1 = 0.5 * L * i0 * i0, E2 = 0.5 * L * id * id;
    /* Each bridge carries the tank current referred to its own side, through
       its own devices — the LV bridge sees n times the current and is built
       from correspondingly lower-R_DS(on) parts. */
    const Pb1 = 2 * Irms * Irms * s.rds * 1e-3;
    const Pb2 = 2 * Math.pow(Irms * n, 2) * s.rdsS * 1e-3;
    const Poff = (E1 < Ereq ? 0.5 * V1 * Math.abs(i0) * s.tsw * 1e-9 * fs : 0)
      + (E2 < Ereq ? 0.5 * V1 * Math.abs(id) * s.tsw * 1e-9 * fs : 0);
    return {
      hi: [["series inductance", eng(L, "H")], ["peak tank current", eng(Ipk, "A")], ["voltage match n·V2 : V1", f2(ratio)]],
      loss: [["Bridge 1 conduction", Pb1, "2·I_tank(rms)²·R_DS(on), HV side"],
        ["Bridge 2 conduction", Pb2, "n·I_tank through the LV side's own R_DS(on)"],
        ["Turn-off (hard side)", Poff, "only the bridge that lost ZVS"]],
      warn: [
        Math.abs(ratio - 1) > 0.15 && "n·V2/V1 = " + f2(ratio) + ". Away from 1.0 the ZVS range shrinks quickly — retune the turns ratio or use an extended modulation scheme.",
        d > 0.45 && "You are operating close to the power limit (d = " + f2(d) + "). Circulating current and turn-off loss are near their worst here.",
        E1 < Ereq && "Side 1 loses ZVS at this operating point: the tank stores " + eng(E1, "J")
          + " at the transition but needs " + eng(Ereq, "J") + " to swing C_oss. Raise the phase shift, lower L, or use lower-C_oss devices.",
        E2 < Ereq && "Side 2 loses ZVS: " + eng(E2, "J") + " available against " + eng(Ereq, "J") + " required.",
      ].filter(Boolean),
      groups: [
        G("Power transfer", [
          R("Phase shift", s.phi + "° (d = " + f2(d) + ")", "maximum power transfer at 90°"),
          R("Series inductance L", eng(L, "H"), "leakage plus external"),
          R("Rated power", eng(s.pout, "W")),
          R("Maximum power (d = 0.5)", eng(Pmax, "W")),
          R("Primary / secondary DC current", eng(I1, "A") + " · " + eng(I2, "A")),
        ]),
        G("Tank current", [
          R("Peak tank current", eng(Ipk, "A"), "sizes the transformer and the turn-off loss"),
          R("Tank rms current", eng(Irms, "A"), "sizes the copper"),
          R("Current at side-1 switching", eng(Math.abs(i0), "A")),
          R("Current at side-2 switching", eng(Math.abs(id), "A")),
          R("Circulating penalty", f2(Irms / (s.pout / V1)) + "×", "tank rms ÷ side-1 DC current; 1.0 would be ideal"),
        ]),
        G("Soft switching", [
          R("Energy needed per transition", eng(Ereq, "J"), "(4/3)·C_oss·V1²"),
          R("Energy available, side 1", eng(E1, "J"), E1 >= Ereq ? "ZVS" : "hard switching"),
          R("Energy available, side 2", eng(E2, "J"), E2 >= Ereq ? "ZVS" : "hard switching"),
        ]),
        G("Design guidance", [
          R("Turns ratio n", f2(n)), R("Voltage match n·V2/V1", f2(ratio), "aim for 1.00"),
          R("Device blocking V (side 1)", eng(V1, "V")),
          R("Device blocking V (side 2)", eng(V2, "V")),
          R("Transformer volt-seconds", eng(V1 / (2 * fs), "V·s"), "sets the core area"),
        ]),
        G("Loss budget", [
          R("Bridge 1 conduction (HV)", eng(Pb1, "W"), "four devices, two in the path at a time"),
          R("Bridge 2 conduction (LV)", eng(Pb2, "W"), "carries n× the current at " + s.rdsS + " mΩ"),
          R("Turn-off, hard side", eng(Poff, "W"), Poff > 0 ? "one bridge is outside ZVS here" : "both bridges are within ZVS"),
          R("Total / efficiency", eng(Pb1 + Pb2 + Poff, "W") + " → "
            + pct(s.pout / (s.pout + Pb1 + Pb2 + Poff)), "conduction and turn-off only"),
        ]),
      ],
    };
  },
},
];

export { TB };
