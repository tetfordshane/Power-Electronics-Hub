import { CE_IM, CE_PH } from "./resonant.js";

/* Per-topology animation geometry: the conducting paths, the phase windows,
   the EMC loop, the polarity marks, the capacitor branches.

   Paths are rectilinear M/H/V/L polylines traced onto the schematic's own
   coordinates; scripts/check-flow.mjs checks that they land on it. */
/* ===================== current-flow animation data =====================
   Each phase traces the conducting loop over the schematic, drawn in the
   direction the current actually flows. `f(D)` is the slice of the cycle
   the phase occupies, used to shade the matching part of the waveform.  */
const FLOW = {
  classepp: { w: 660, h: 300, iShape: (u) => Math.abs(1 + CE_IM * Math.sin(2 * Math.PI * u + CE_PH)) / 2.862,
    ilabel: "i_out",
    sw: [[250, 105, "Q1", 0], [250, 195, "Q2", 180]],
    emc: { loop: "M 250 60 H 310 V 240 H 250 Z", node: [250, 60] },
    ph: [
    { on: [1,0], t: "Q1 conducting", f: () => [0, 0.5], n: "The upper stage pulls its drain to zero while the lower drain rings up. The two halves are identical circuits running exactly half a cycle apart.",
      d: ["M 40 150 H 70 V 60 H 250 V 150 H 282"], dim: ["M 310 240 V 150"] },
    { on: [0,1], t: "Q2 conducting", f: () => [0.5, 1], n: "Roles swap. Because the two drain waveforms are antiphase, their even harmonics cancel in the differential load — that cancellation is the principal reason for the configuration.",
      d: ["M 40 150 H 70 V 240 H 250 V 150 H 282"], dim: ["M 310 60 V 150"] },
  ]},
  classde: { w: 620, h: 270, iShape: (u) => Math.abs(Math.sin(2 * Math.PI * u)),
    ilabel: "i_tank",
    sw: [[200, 92, "Q1", 0], [200, 182, "Q2", 0]],
    emc: { loop: "M 200 50 H 265 V 225 H 200 Z", node: [200, 137] },
    ph: [
    { on: [1,0], t: "Q1 on", f: () => [0, 0.46], n: "The high-side device connects the tank to the supply. Because the turn-on happened at zero volts during the preceding dead time, the transition cost nothing.",
      d: ["M 40 50 H 200 V 137 H 520 V 225 H 200"] },
    { on: [0,0], t: "Dead time — ZVS", f: () => [0.46, 0.54], n: "Both devices are off. Tank current alone charges one shunt capacitance and discharges the other, walking the switch node across to the opposite rail before the next device turns on.",
      d: ["M 265 50 V 225"], dim: ["M 200 137 H 520 V 225 H 200"] },
    { on: [0,1], t: "Q2 on", f: () => [0.54, 1], n: "The low-side device takes over and tank current reverses. Each device only ever blocks the supply rail — the principal advantage over single-ended class E, where the device blocks 3.56 times the supply.",
      d: ["M 200 225 V 137 H 520 V 225"] },
  ]},
  buck: { w: 660, h: 250, sw: [[170, 70, "Q1", -90], [215, 135, "D1"]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [241, 88, 301, 88],              /* L, between the switch node and the output */
    /* Both capacitors, drawn top-plate downwards — the direction current
       flows INTO them. C_in is the interesting one on a buck: the source
       supplies a steady average while the switch demands the whole inductor
       current for D of the period and none of it for the rest, and C_in makes
       up the entire difference. Watching it slam back and forth is the
       shortest route to why input capacitors are chosen by ripple current. */
    capFlow: [{ d: "M 380 70 V 200", src: "out" }, { d: "M 88 70 V 200", src: "in" }],
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The switch connects the input to the inductor. With V_in − V_out across it the current ramps up, and the difference between that current and the load current charges C_out.",
      d: ["M 40 70 H 480 V 200 H 40"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "The inductor cannot sustain a discontinuity in its current, so it pulls the switch node below ground until D1 conducts. Current now circulates through the diode and decays at a rate set by V_out/L.",
      d: ["M 215 200 V 70 H 480 V 200 H 215"] },
  ]},
  boost: { w: 660, h: 250, sw: [[230, 145, "Q1", 0], [288, 70, "D1"]],
    emc: { loop: "M 230 70 H 390 V 200 H 230 Z", node: [230, 70] },
    pol: [116, 88, 176, 88],              /* L, fed from the input */
    capFlow: [{ d: "M 390 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The switch shorts the inductor to ground. Current ramps up storing energy, and the output is supplied entirely by C_out — which is why boost output ripple is so much worse than buck.",
      d: ["M 40 70 H 230 V 200 H 40"], dim: ["M 390 70 H 480 V 200 H 390"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "The inductor flies above the input, forward-biasing D1 and transferring its current to the output. This is also why load steps momentarily go the wrong way — the right-half-plane zero.",
      d: ["M 40 70 H 480 V 200 H 40"] },
  ]},
  buckboost: { w: 660, h: 250, sw: [[170, 70, "Q1", -90], [290, 70, "D1"]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [197, 98, 197, 158],              /* L, from the switch node down to the return */
    capFlow: [{ d: "M 400 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The full input voltage sits across the inductor and current ramps up. Nothing reaches the output during this interval — the load lives on C_out.",
      d: ["M 40 70 H 215 V 200 H 40"], dim: ["M 400 70 H 480 V 200 H 400"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "The inductor reverses its terminal voltage to keep current flowing, pulling the output node below ground through D1. That polarity inversion is inherent, not a wiring choice.",
      d: ["M 215 70 V 200 H 480 V 70 H 215"] },
  ]},
  flyback: { w: 700, h: 275, sw: [[250, 185, "Q1", 0], [327, 60, "D1"]],
    flux: "mag",
    emc: { loop: "M 90 55 H 250 V 235 H 90 Z", node: [250, 144] },
    capFlow: [{ d: "M 450 60 V 215", src: "out" }],
    ph: [
    /* `rides` names the current each drawn path carries. A flyback conducts
       on one side at a time, so this is the same answer the summed device
       trace already gives — which is exactly why it is declared here: it is
       the one topology where the two routes can be compared. */
    { on: [1,0], t: "Q1 on — store", f: (D) => [0, D], n: "Primary current ramps and energy accumulates in the gap. The secondary diode is reverse-biased, so no power crosses the barrier yet; the output is held up by C_out alone.",
      d: ["M 40 55 H 250 V 235 H 40"], rides: ["iQ"], dim: ["M 450 60 H 600 V 215 H 450"] },
    { on: [0,1], t: "Q1 off — release", f: (D) => [D, 1], n: "The winding voltages reverse, D1 conducts and the stored energy transfers to the output. The primary now sees V_in plus the reflected V_R — the quantity that sets the primary device rating.",
      d: ["M 274 80 V 60 H 600 V 215 H 274 V 144"], rides: ["iD"] },
  ]},
  pfcboost: { w: 780, h: 280, sw: [[360, 155, "Q1", 0], [425, 105, "D"]],
    /* One switching period taken at the crest of the line cycle, where the
       inductor current and its ripple are both largest. */
    iShape: (u, D) => 0.62 + 0.38 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    ilabel: "i_L",
    emc: { loop: "M 360 105 H 560 V 195 H 360 Z", node: [360, 105] },
    ph: [
    { on: [1,0], t: "Q1 on", f: (D) => [0, D], n: "The boost switch shorts the inductor across the rectified line. Current rises, following the reference the current loop derives from |v_ac| — this interval is where the sinusoidal input current is shaped.",
      d: ["M 130 105 H 360 V 195 H 130"], dim: ["M 560 105 H 660 V 195 H 560"] },
    { on: [0,1], t: "Q1 off", f: (D) => [D, 1], n: "Inductor current transfers to D_b and charges the bulk capacitor. The duty varies continuously across the line cycle: near the zero crossing it approaches 1, near the peak it is smallest.",
      d: ["M 130 105 H 660 V 195 H 130"] },
  ]},
  halfwave: { w: 620, h: 230, iShape: (u) => (u < 0.16 ? 0.08 + Math.sin(Math.PI * u / 0.16) : 0.1),
    ilabel: "i_D",
    sw: [[170, 60, "D1"]],
    emc: { loop: "M 130 60 H 300 V 190 H 130 Z", node: [210, 60] },
    ph: [
    { on: [1], t: "Peak of the positive half", f: () => [0, 0.16], n: "The diode only conducts while the source exceeds the capacitor voltage — a narrow window near the peak. All the charge the load will draw for the entire cycle is delivered in this brief spike.",
      d: ["M 80 104 V 60 H 420 V 190 H 80 V 136"] },
    { on: [0], t: "The rest of the cycle", f: () => [0.16, 1], n: "The diode is reverse-biased and the capacitor alone supplies the load, sagging linearly. Ripple here is at the line frequency, not twice it, so the capacitor must be twice as large as a bridge would need.",
      d: ["M 300 60 H 420 V 190 H 300"] },
  ]},
  bridgerect: { w: 620, h: 250, iShape: (u) => 0.06 + Math.pow(Math.abs(Math.sin(2 * Math.PI * u)), 5),
    ilabel: "i_D",
    sw: [[210, 78, "D1"], [210, 153, "D2"], [310, 108, "D3"], [310, 183, "D4"]],
    emc: { loop: "M 210 55 H 400 V 205 H 210 Z", node: [310, 55] },
    ph: [
    { on: [1,0,0,1], t: "Positive half-cycle", f: () => [0, 0.5], n: "D1 and D4 conduct as a diagonal pair: current leaves the source, climbs to the positive rail, passes through the load, and returns through the opposite leg.",
      d: ["M 100 114 V 100 H 210 V 55 H 490 V 205 H 310 V 160 H 100 V 146"] },
    { on: [0,1,1,0], t: "Negative half-cycle", f: () => [0.5, 1], n: "The source reverses and the other diagonal takes over. Note what does not change: current through the load still flows top to bottom. That is precisely what the bridge arrangement achieves.",
      d: ["M 100 146 V 160 H 310 V 55 H 490 V 205 H 210 V 100 H 100 V 114"] },
  ]},
  ctrect: { w: 680, h: 270, sw: [[300, 60, "D1"], [300, 140, "D2"]],
    flux: "vs",
    emc: { loop: "M 214 60 H 340 V 140 H 214 Z", node: [340, 100] },
    /* Above the choke, not below it: the V_rect node label sits directly under
       the left-hand terminal. Set here the two marks flank the L_f label —
       and clear of the feed wire at x 340 and the coil crest at y 91, which
       the dashes now climb; an opaque disc any closer notches them. */
    pol: [352, 76, 406, 76],                /* L_f, the output choke */
    capFlow: [{ d: "M 470 100 V 220", src: "out" }],
    ph: [
    { on: [1,0], t: "Upper half conducts", f: (D) => [0, D], n: "The top half-winding drives D1 while the lower diode blocks. Current returns through the centre tap, so only one forward drop sits in the output path.",
      d: ["M 214 60 H 340 V 100 H 560 V 220 H 240 V 100 H 214"] },
    /* The freewheel intervals. These used to be left uncovered, and the phase
       lookup filled the gap by holding whichever phase had started last — so
       one diode stayed lit through an interval in which both conduct. It was
       invisible while the choke was drawn as a single ramp; with the current
       falling twice per period it sits right next to the trace that shows it.
       Both windings are undriven here and the choke's current splits between
       the two rectifiers, which is exactly why each one averages I_out/2
       regardless of duty. */
    { on: [1,1], t: "Freewheel", f: (D) => [D, 0.5], n: "The secondary is undriven and the choke sustains its own current, which splits between both rectifiers. This is the interval that makes each diode average I_out/2 whatever the duty, and it is when the output ripple falls.",
      d: ["M 340 100 H 560 V 220 H 240 V 100 H 340"], dim: ["M 214 60 H 340", "M 214 140 H 340"] },
    { on: [0,1], t: "Lower half conducts", f: (D) => [0.5, 0.5 + D], n: "The transformer reverses and the bottom half-winding takes over through D2. Each half-winding works only half the time — which is why this secondary needs roughly twice the copper of a bridge.",
      d: ["M 214 140 H 340 V 100 H 560 V 220 H 240 V 100 H 214"] },
    { on: [1,1], t: "Freewheel", f: (D) => [0.5 + D, 1], n: "The second freewheel interval, identical to the first. Two power pulses and two freewheels per switching period is why the output ripple sits at 2·f_sw and the filter is smaller than the switch timing alone suggests.",
      d: ["M 340 100 H 560 V 220 H 240 V 100 H 340"], dim: ["M 214 60 H 340", "M 214 140 H 340"] },
  ]},
  doubler: { w: 700, h: 300, sw: [[250, 170, "D1"], [290, 230, "D2"]],
    flux: "static",
    emc: { loop: "M 214 80 H 250 V 260 H 290 V 200 H 214 Z", node: [250, 80] },
    pol: [316, 98, 376, 98],              /* L1, the winding the pane plots */
    capFlow: [{ d: "M 530 140 V 260", src: "out" }],
    ph: [
    { on: [0,1], t: "Winding positive", f: (D) => [0, D], n: "D2 clamps the lower terminal to the return, so L1 sees the winding voltage and charges while L2 freewheels. Both inductors feed the output continuously.",
      d: ["M 214 80 H 470 V 140 H 595 V 260 H 290 V 200 H 214 V 160", "M 290 200 H 470 V 140"] },
    { on: [1,0], t: "Winding negative", f: (D) => [0.5, 0.5 + D], n: "The roles swap: D1 clamps and L2 charges. Each inductor carries only half the load current, and their ripples partly cancel at the output node.",
      d: ["M 214 160 V 200 H 470 V 140 H 595 V 260 H 250 V 80 H 214", "M 250 80 H 470 V 140"] },
  ]},
  classe: { w: 660, h: 250, iShape: (u) => Math.abs(1 + CE_IM * Math.sin(2 * Math.PI * u + CE_PH)) / 2.862,
    ilabel: "i_sw",
    sw: [[230, 130, "Q1", 0]],
    emc: { loop: "M 230 60 H 310 V 205 H 230 Z", node: [230, 60] },
    ph: [
    { on: [1], t: "Switch on", f: () => [0, 0.5], n: "The drain is held at zero volts. The choke current ramps up and the tank current flows through the switch — but the device turned on at zero voltage, so nothing was dissipated in the transition.",
      d: ["M 40 60 H 230 V 205 H 430"], dim: ["M 230 60 H 590 V 205 H 430"] },
    { on: [0], t: "Switch off", f: () => [0.5, 1], n: "Choke and tank current now flow into C_sh, and the drain rings up to 3.56 times the supply and back. The tuning makes it arrive at exactly zero, with zero slope, as the switch closes again.",
      d: ["M 40 60 H 310 V 205 H 430"], dim: ["M 310 60 H 590 V 205 H 430"] },
  ]},

  /* ---- extended coverage --------------------------------------------
     The lens used to exist on only twelve of the thirty pages, which made
     it look broken rather than absent. These add the families where the
     current path is the whole lesson: a synchronous buck (where the point
     is that a FET replaces the diode), the coupled-cap converters, and
     the bridge-fed isolated stages.                                    */
  /* ---- traced from each topology's own schematic, so the operation figure
     is the circuit shown above it rather than a generic family stand-in --- */
  syncrect: { w: 680, h: 280, sw: [[330, 60, "SR1", -90], [330, 140, "SR2", -90]],
    flux: "vs",
    /* Two conduction intervals per period, one per rectifier, with the
       choke ramp on top — the shape a synchronous rectifier actually sees. */
    iShape: (u) => { const t = u < 0.5 ? u : u - 0.5; return t < 0.34 ? 0.66 + t : 0.55; },
    ilabel: "i_SR",
    emc: { loop: "M 214 60 H 350 V 140 H 214 Z", node: [350, 100] },
    ph: [
    { on: [1,0], t: "SR1 conducting", f: () => [0, 0.5], n: "The upper half of the winding drives the load through SR1's channel. A FET conducting in the third quadrant drops I·R_DS(on) instead of a fixed V_F, which below about 12 V out is worth more than anything on the primary side.",
      d: ["M 214 100 H 575 V 230 H 350 V 60 H 214"] },
    { on: [0,1], t: "SR2 conducting", f: () => [0.5, 1], n: "The winding reverses and SR2 takes over. Both devices must be off before the other turns on: overlap shorts the winding, and gate timing that is late instead lets the body diode conduct and throws the advantage away.",
      d: ["M 214 100 H 575 V 230 H 350 V 140 H 214"] },
  ]},
  totempole: { w: 720, h: 280,
    iShape: (u, D) => 0.62 + 0.38 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    ilabel: "i_L",
    sw: [[300, 100, "Q1", 0], [300, 190, "Q2", 0], [420, 100, "Q3", 0], [420, 190, "Q4", 0]],
    emc: { loop: "M 300 50 H 640 V 240 H 300 Z", node: [300, 145] },
    ph: [
    { on: [0,1,0,1], t: "Q2 on — charge", f: (D) => [0, D], n: "The fast leg's low-side device shorts the boost inductor across the line and its current ramps. The slow leg is doing nothing but pointing the mains at the right rail — it changes state once per line half-cycle, not once per switching period.",
      d: ["M 45 110 H 300 V 240 H 420 V 145 H 380 V 205 H 45"] },
    { on: [1,0,0,1], t: "Q1 on — transfer", f: (D) => [D, 1], n: "The inductor current commutates into the high-side device and charges the bulk capacitor. There are no bridge diodes anywhere in this path, which is the whole point — and why the device needs to have essentially no reverse recovery.",
      d: ["M 45 110 H 300 V 50 H 640 V 240 H 420 V 145 H 380 V 205 H 45"] },
  ]},
  zeta: { w: 700, h: 250, sw: [[170, 70, "Q1", -90], [340, 135, "D1"]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [366, 88, 426, 88],              /* L2, the output winding the pane plots */
    capFlow: [{ d: "M 490 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Switch on", f: (D) => [0, D], n: "The high-side switch connects the input to both the coupling capacitor and L1. C1 delivers its charge onward to L2 and the load, and L1 magnetises from the input.",
      d: ["M 40 70 H 600 V 200 H 40", "M 215 70 V 200"] },
    { on: [0,1], t: "Switch off", f: (D) => [D, 1], n: "D1 picks up both inductor currents. L2 faces the load directly, so output current stays continuous and the output ripple is small — the property that separates a Zeta from a SEPIC.",
      d: ["M 340 200 V 70 H 600 V 200 H 340", "M 215 200 V 70 H 325"] },
  ]},
  fsbb: { w: 700, h: 250,
    sw: [[170, 70, "Q1", -90], [215, 145, "Q2", 0], [330, 145, "Q3", 0], [400, 70, "Q4", -90]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [241, 88, 301, 88],              /* L, between the two half bridges */
    capFlow: [{ d: "M 500 70 V 200", src: "out" }],
    ph: [
    { on: [1,0,0,1], t: "Q1 on (buck mode)", f: (D) => [0, D], n: "In buck mode the boost leg is static: Q4 stays on, Q3 stays off, and the converter is an ordinary buck. The input feeds the inductor through Q1 and the current ramps up.",
      d: ["M 40 70 H 600 V 200 H 40"], dim: ["M 330 70 V 200"] },
    { on: [0,1,0,1], t: "Q2 on (buck mode)", f: (D) => [D, 1], n: "Q2 takes over as the synchronous freewheel path. Because both devices only ever block the larger of the two rails — never their sum — this topology stays efficient right through V_in ≈ V_out, where an inverting buck-boost is at its worst.",
      d: ["M 215 200 V 70 H 600 V 200 H 215"], dim: ["M 330 70 V 200"] },
    /* Boost mode: the other half of the same hardware. Which pair the figure
       draws is chosen by phSets below, from the mode the design landed in —
       the page used to draw these two buck phases beside a boost-mode
       waveform, lighting the devices that were standing still. */
    { on: [1,0,1,0], t: "Q3 on (boost mode)", f: (D) => [0, D], n: "In boost mode the buck leg is static: Q1 stays on, Q2 stays off, and the input feeds the inductor continuously. Q3 shorts the far end to ground and the current ramps up, storing energy — the output is carried by the capacitor alone through this interval.",
      d: ["M 40 70 H 330 V 200 H 40"], dim: ["M 215 70 V 200"] },
    { on: [1,0,0,1], t: "Q4 on (boost mode)", f: (D) => [D, 1], n: "Q3 opens and the inductor's current has nowhere to go but through Q4 into the output, at whatever voltage the capacitor has reached. That is the boost: the same current, delivered at a higher voltage than the input, for a shorter part of the period.",
      d: ["M 40 70 H 600 V 200 H 40"], dim: ["M 215 70 V 200"] },
  ],
  /* Two conduction patterns, one drawing. `mode` on the design result says
     which the operating point produced. */
  phSets: { buck: [0, 1], boost: [2, 3] }},
  multiphase: { w: 700, h: 270,
    sw: [[170, 75, "Q1H", 0], [170, 165, "Q1L", 0], [270, 90, "Q2H", 0], [270, 180, "Q2L", 0],
         [370, 105, "Q3H", 0], [370, 195, "Q3L", 0]],
    emc: { loop: "M 70 55 H 170 V 235 H 70 Z", node: [170, 120] },
    capFlow: [{ d: "M 560 150 V 235", src: "out" }],
    ph: [
    { on: [1,0,0,1,0,1], t: "Phase 1 driving", f: () => [0, 1/3], n: "Only one leg is drawing from the input at a time. The other two freewheel through their low-side devices, so the input capacitor sees a much smaller and much higher-frequency ripple than a single buck of the same total current would demand.",
      d: ["M 30 55 H 170 V 120 H 520 V 150 H 640 V 235 H 30"],
      dim: ["M 270 235 V 135 H 520", "M 370 235 V 150 H 520"] },
    { on: [0,1,1,0,0,1], t: "Phase 2 driving", f: () => [1/3, 2/3], n: "The clock hands over 360°/N later. Each inductor carries only I_out/N, and their ripples land out of phase, so what reaches the output capacitor is a fraction of any one phase's ripple.",
      d: ["M 30 55 H 270 V 135 H 520 V 150 H 640 V 235 H 30"],
      dim: ["M 170 235 V 120 H 520", "M 370 235 V 150 H 520"] },
    { on: [0,1,0,1,1,0], t: "Phase 3 driving", f: () => [2/3, 1], n: "The third leg takes its turn. The output sees ripple at N·f_sw, which is why the same transient response needs less capacitance than a single-phase design.",
      d: ["M 30 55 H 370 V 150 H 640 V 235 H 30"],
      dim: ["M 170 235 V 120 H 520", "M 270 235 V 135 H 520"] },
  ]},

  syncbuck: { w: 660, h: 250, sw: [[170, 70, "Q_HS", -90], [215, 145, "Q_LS", 0]],
    emc: { loop: "M 88 70 H 215 V 200 H 88 Z", node: [215, 70] },
    pol: [241, 88, 301, 88],              /* L, between the switch node and the output */
    capFlow: [{ d: "M 380 70 V 200", src: "out" }, { d: "M 88 70 V 200", src: "in" }],
    ph: [
    { on: [1,0], t: "High side on", f: (D) => [0, D], n: "Identical to a plain buck: the input feeds the inductor and its current ramps up. The low-side FET is held off, and the dead time before this instant was covered by its body diode.",
      d: ["M 40 70 H 480 V 200 H 40"] },
    { on: [0,1], t: "Low side on", f: (D) => [D, 1], n: "This is the whole point of the topology. Instead of a diode dropping a fixed 0.4 V, a FET channel carries the same current at I·R_DS(on) — which at low output voltages is the single largest efficiency lever available.",
      d: ["M 215 200 V 70 H 480 V 200 H 215"] },
  ]},
  sepic: { w: 700, h: 250, sw: [[160, 145, "Q1", 0], [343, 70, "D1"]],
    emc: { loop: "M 70 70 H 160 V 200 H 70 Z", node: [160, 70] },
    pol: [76, 88, 136, 88],              /* L1, the input winding the pane plots */
    capFlow: [{ d: "M 460 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Switch on", f: (D) => [0, D], n: "Both inductors charge: L1 straight from the input, L2 from the coupling capacitor, which is why C_s carries the full load current in rms terms. The diode is reverse biased and the output runs on C_out alone.",
      d: ["M 40 70 H 160 V 200 H 40", "M 160 70 H 280 V 200 H 160"], dim: ["M 385 70 H 600 V 200 H 385"] },
    { on: [0,1], t: "Switch off", f: (D) => [D, 1], n: "Both inductor currents commutate into the diode and feed the output together. Because C_s blocks DC, a short on the output cannot drag the input down — the advantage a boost does not have.",
      d: ["M 40 70 H 600 V 200 H 40", "M 280 200 V 70"] },
  ]},
  cuk: { w: 700, h: 250, sw: [[160, 145, "Q1", 0], [280, 135, "D1"]],
    emc: { loop: "M 70 70 H 160 V 200 H 70 Z", node: [160, 70] },
    pol: [76, 88, 136, 88],              /* L1, the input winding the pane plots */
    capFlow: [{ d: "M 430 70 V 200", src: "out" }],
    ph: [
    { on: [1,0], t: "Switch on", f: (D) => [0, D], n: "The transfer capacitor discharges through the switch into the output side. Energy crosses this converter through C1's electric field rather than through a magnetic field — which is exactly why C1 sees the full load current and is the reliability limit.",
      d: ["M 40 70 H 160 V 200 H 40", "M 160 70 H 600 V 200 H 160"] },
    { on: [0,1], t: "Switch off", f: (D) => [D, 1], n: "The diode takes over and C1 recharges from the input inductor. Both inductors keep conducting throughout, so the input and output currents are continuous — the property that makes a Ćuk quiet at both ports.",
      d: ["M 40 70 H 280 V 200 H 40", "M 280 70 H 600 V 200 H 280"] },
  ]},
  halfbridge: { w: 780, h: 295, sw: [[230, 102, "Q1", 0], [230, 192, "Q2", 0], [465, 80, "D1"], [465, 205, "D2"]],
    flux: "vs",
    emc: { loop: "M 110 45 H 230 V 250 H 110 Z", node: [230, 147] },
    pol: [536, 158, 596, 158],              /* L, the output choke */
    capFlow: [{ d: "M 650 140 V 255", src: "out" }],
    ph: [
    { on: [1,0,1,0], t: "Q1 on", f: (D) => [0, D], n: "The primary sees +V_in/2, because the capacitor divider holds the return at half the bus. That halving is the reason each device blocks only V_in, against 2·V_in for a push-pull.",
      d: ["M 110 45 H 230 V 147 H 290 V 105 H 340", "M 340 169 H 320 V 200 H 110 V 45",
          "M 364 105 V 80 H 500 V 140 H 740 V 255 H 400 V 138"],
      rides: ["iQ", "iQ", "iD1"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [D, 0.5], n: "Neither switch conducts. The primary is undriven and the output inductor freewheels through both rectifiers at once — this interval is what the series blocking capacitor uses to keep the volt-seconds balanced.",
      d: ["M 500 140 H 740 V 255 H 400 V 138"], rides: ["iL"],
      dim: ["M 110 45 H 230 V 147 H 290 V 105 H 340"] },
    { on: [0,1,0,1], t: "Q2 on", f: (D) => [0.5, 0.5 + D], n: "The primary reverses and sees −V_in/2. Driving the core in both quadrants is what makes the transformer small compared with a single-ended forward of the same power.",
      d: ["M 340 105 H 290 V 147 H 230 V 250 H 110 V 147",
          "M 364 171 V 205 H 500 V 140 H 740 V 255 H 400 V 138"],
      rides: ["iQ2", "iD2"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [0.5 + D, 1], n: "The second freewheel interval. Note the output ripple frequency is twice the switching frequency, so the filter is smaller than the switch timing alone would suggest.",
      d: ["M 500 140 H 740 V 255 H 400 V 138"], rides: ["iL"],
      dim: ["M 110 45 H 230 V 147 H 290 V 105 H 340"] },
  ]},
  chargepump: { w: 700, h: 250, iShape: (u) => (u < 0.5 ? 0.25 + 0.75 * Math.exp(-12 * u) : 0.25 + 0.75 * Math.exp(-12 * (u - 0.5))),
    ilabel: "i_pump",
    sw: [[103, 70, "D1"], [230, 70, "D2"], [365, 70, "D3"]],
    emc: { loop: "M 55 70 H 300 V 178 H 55 Z", node: [165, 70] },
    ph: [
    { on: [1,0,1], t: "Clock low — charge", f: () => [0, 0.5], n: "C1 is connected across the input and charges through D1, while D3 hands the previous stage's charge on to the output. Charge moves as a spike whose size is set by how far the capacitor voltages have drifted apart, not by any resistor.",
      d: ["M 40 70 H 165 V 178", "M 300 70 H 600 V 200 H 480"] },
    { on: [0,1,0], t: "Clock high — pump", f: () => [0.5, 1], n: "C1's bottom plate is lifted to the input, so its top plate now sits a full V_in above it and pours charge through D2 into C2. That redistribution is lossy no matter how good the switches are — it is what the equivalent R_out is really describing.",
      d: ["M 165 70 H 300 V 178"], dim: ["M 420 70 H 600 V 200 H 480"] },
  ]},

  ilpfc: { w: 780, h: 320,
    sw: [[360, 147, "Q1", 0], [360, 220, "Q2", 0], [425, 105, "D1"], [425, 160, "D2"]],
    emc: { loop: "M 260 105 H 470 V 195 H 260 Z", node: [360, 105] },
    pol: [266, 123, 326, 123],              /* L1, the plotted leg */
    ph: [
    { on: [1,0,0,1], t: "Leg 1 charging", f: (D) => [0, D], n: "Q1 shorts L1 to the return, so L1 charges. At the same moment leg 2 is doing the opposite — D2 is delivering L2's stored current to the bus. One leg always rises while the other falls, and that is the whole idea: their ripple currents point opposite ways and much of what the filter would have seen cancels before it gets there.",
      d: ["M 130 105 H 360 V 195 H 130", "M 260 160 H 470 V 105 H 700 V 195 H 660"] },
    { on: [0,1,1,0], t: "Leg 2 charging", f: (D) => [D, 1], n: "Half a period later the roles swap: Q2 charges L2 while D1 hands L1's current to the bus. Notice the bus capacitor is being fed twice per switching period instead of once, and by pulses half the size — so the ripple current it has to swallow is far smaller than a single stage of the same power would demand.",
      d: ["M 130 195 H 360 V 160 H 260", "M 260 105 H 470 V 105 H 700 V 195 H 660"] },
  ]},

  qrflyback: { w: 700, h: 285, sw: [[250, 205, "Q1", 0], [365, 60, "D1"]],
    flux: "mag",
    emc: { loop: "M 90 55 H 250 V 235 H 90 Z", node: [250, 165] },
    capFlow: [{ d: "M 450 60 V 215", src: "out" }],
    ph: [
    { on: [1,0], t: "Q1 on — storing", f: (D) => [0, D], n: "The switch connects the primary across the input and current ramps up, filling the core with energy. Nothing reaches the output during this interval — the secondary diode is reverse biased, and the load is living entirely off the output capacitor.",
      d: ["M 40 55 H 250 V 235 H 40"], dim: ["M 450 60 H 600 V 215 H 450"] },
    { on: [0,1], t: "Q1 off — delivering", f: (D) => [D, Math.min(D + 0.42, 0.86)], n: "The switch opens and the stored energy has to go somewhere, so it comes out of the secondary through D1 into the output capacitor and the load. The primary current has stopped dead; the current you can see moving now is the secondary's, decaying as the core empties.",
      d: ["M 274 60 H 620 V 215 H 274"], dim: ["M 40 55 H 250 V 235 H 40"] },
    { on: [0,0], t: "Ringing — waiting for the valley", f: (D) => [Math.min(D + 0.42, 0.86), 1], n: "The core is empty and the diode has stopped. Now the primary inductance and the switch's own capacitance are left alone together, and they ring — the drain voltage swings up and down of its own accord. An ordinary flyback would ignore this and turn on wherever its clock landed, often near the top of the swing, throwing away the energy stored on the switch as heat. This one waits for the bottom, and turns on there. That wait is why the frequency changes with load, and it is the only difference between this converter and a plain flyback.",
      d: ["M 205 235 V 165 H 250"], dim: ["M 40 55 H 250", "M 274 60 H 620 V 215 H 274"] },
  ]},

  /* ---- the bridge family, each on its own circuit ----

     These eight used to share one generic drawing of "a bridge", with a note
     admitting the picture was not the schematic above it. That is the right
     apology for the wrong thing: the whole point of a phase-shifted bridge is
     what happens in the interval a plain bridge does not have, and a figure
     that cannot draw the interval cannot make the point. Each one now traces
     its own conducting path over its own circuit. */

  forward2: { w: 720, h: 305,
    /* Store, reset, idle — the triangle the phase notes narrate: magnetise
       for D, give the same volt-seconds back through the clamp diodes for
       the next D, then sit at zero. A supplied shape, like iShape: it
       claims the timing and the symmetry, not an amplitude. */
    flux: { shape: (u, D) => (u < D ? u / D : u < 2 * D ? 2 - u / D : 0) },
    sw: [[210, 75, "Q1", 0], [210, 205, "Q2", 0], [140, 192, "D_a"], [175, 109, "D_b"],
      [337, 80, "D3"], [400, 165, "D4"]],
    emc: { loop: "M 80 40 H 210 V 275 H 80 Z", node: [210, 110] },
    pol: [431, 98, 491, 98],                /* L, the output choke */
    capFlow: [{ d: "M 550 80 V 250", src: "out" }],
    ph: [
    /* Primary and secondary conduct at the same instant here and carry
       different currents — the reflected load plus the magnetising ramp on one
       side, the choke's own current on the other. `rides` is what stops one
       number moving both sets of dashes. */
    { on: [1,1,0,0,1,0], t: "Both switches on", f: (D) => [0, D], n: "Both switches close together, so the primary sees the full input and the transformer passes power across straight away — nothing is stored on purpose, which is the difference between this and a flyback. On the secondary D3 hands that power to the choke, and the choke feeds the load continuously.",
      d: ["M 40 40 H 210 V 275 H 40", "M 234 110 V 80 H 640 V 250 H 234 V 174"],
      rides: ["iQ", "iD3"] },
    { on: [0,0,1,1,0,1], t: "Core reset", f: (D) => [D, Math.min(2 * D, 0.98)], n: "The switches open and the magnetising current has nowhere to go but through the two clamp diodes, which return it to the input — the core is being wound back to where it started. That reset takes as long as the on-time did, which is exactly why the duty of a forward converter has to stay below 0.5: run longer and the core never finishes resetting, and it walks into saturation a little further every cycle.",
      d: ["M 210 174 H 175 V 40 H 40", "M 40 275 H 140 V 110 H 210",
          "M 400 250 V 80 H 640 V 250 H 400"],
      rides: ["iDb", "iDa", "iD4"] },
    { on: [0,0,0,0,0,1], t: "Idle", f: (D) => [Math.min(2 * D, 0.98), 1], n: "The core is fully reset and the primary is doing nothing at all. The output does not notice: the choke is still pushing current through D4 into the load, which is what makes this output quiet compared with a flyback's.",
      d: ["M 400 250 V 80 H 640 V 250 H 400"],
      rides: ["iD4"],
      dim: ["M 40 40 H 210 V 275 H 40"] },
  ]},

  pushpull: { w: 740, h: 300, flux: "vs",
    sw: [[230, 240, "Q1", 0], [270, 240, "Q2", 0], [435, 70, "D1"], [435, 190, "D2"]],
    emc: { loop: "M 95 40 H 230 V 275 H 95 Z", node: [300, 70] },
    /* Above the choke: below it the B disc sat 6 px off the secondary return
       and notched the conducting dashes with its opaque fill. */
    pol: [506, 106, 566, 106],              /* L, the output choke */
    capFlow: [{ d: "M 620 130 V 250", src: "out" }],
    ph: [
    { on: [1,0,1,0], t: "Q1 on", f: (D) => [0, D], n: "Q1 pulls one half of the primary down, so that half sees the whole input voltage and the core is driven one way. D1 carries the resulting secondary current into the choke.",
      d: ["M 50 40 H 150 V 130 H 300 V 70 H 230 V 275 H 50",
          "M 324 70 H 470 V 130 H 700 V 250 H 560 V 138 H 324"],
      rides: ["iQ", "iD1"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [D, 0.5], n: "Neither switch conducts, so the primary is undriven. The choke keeps its current going by sharing it between both rectifiers at once, and the load never sees the gap.",
      d: ["M 470 130 H 700 V 250 H 560 V 138"],
      rides: ["iL"],
      dim: ["M 150 130 H 300 V 70 H 230"] },
    { on: [0,1,0,1], t: "Q2 on", f: (D) => [0.5, 0.5 + D], n: "Q2 drives the other half of the primary, and the core is pushed back the other way. Using the core in both directions is what makes a push-pull transformer roughly half the size of a forward's for the same power — but it only works if the two halves are matched, because any imbalance leaves a DC component that walks the core toward saturation.",
      d: ["M 50 40 H 150 V 130 H 300 V 190 H 270 V 275 H 50",
          "M 324 190 H 470 V 130 H 700 V 250 H 560 V 138 H 324"],
      rides: ["iQ2", "iD2"] },
    { on: [0,0,1,1], t: "Both off", f: (D) => [0.5 + D, 1], n: "The second freewheel. Because power arrived twice in one switching period, the output ripple sits at twice the switching frequency — so the filter is smaller than the switch timing alone would suggest.",
      d: ["M 470 130 H 700 V 250 H 560 V 138"],
      rides: ["iL"],
      dim: ["M 150 130 H 300 V 190 H 270"] },
  ]},

  psfb: { w: 800, h: 300, flux: "vs",
    sw: [[170, 105, "Q1", 0], [170, 195, "Q2", 0], [300, 105, "Q3", 0], [300, 195, "Q4", 0],
      [552, 95, "D1"], [552, 215, "D2"]],
    emc: { loop: "M 90 45 H 300 V 255 H 90 Z", node: [300, 150] },
    pol: [616, 168, 676, 168],              /* L_o, the output choke */
    capFlow: [{ d: "M 710 150 V 265", src: "out" }],
    ph: [
    { on: [1,0,0,1,1,0], t: "Q1 + Q4 driving", f: (D) => [0, D], n: "One switch from each leg is on, and they are diagonally opposite, so the primary sees the full input. This is the interval that actually delivers power, and its length is set by how far apart the two legs are switched — the phase shift — rather than by any switch's own duty.",
      /* Every primary path rides `ipri` — L_r, both conducting switches and
         the winding are one series chain, so it is literally one current —
         while the secondary rides its own rectifier. The distinction matters
         most in the freewheel intervals below, where the primary keeps
         circulating and the secondary is doing something else entirely. */
      d: ["M 40 45 H 170 V 150 H 200 V 200 H 410 V 184 H 430",
          "M 430 120 H 398 V 150 H 300 V 255 H 40",
          "M 454 120 V 95 H 585 V 150 H 770 V 265 H 490 V 153"],
      rides: ["ipri", "ipri", "iD1"] },
    { on: [0,0,0,1,1,0], t: "ZVS transition", f: (D) => [D, Math.min(D + 0.04, 0.49)], n: "Q1 opens and, for a few tens of nanoseconds, nothing is driving the primary — but the current in L_r keeps flowing and has to go somewhere, so it drains the charge off the switch that is about to turn on. By the time that switch is told to close, the voltage across it has already fallen to zero, so it closes for free. This tiny interval is the entire reason to build a phase-shifted bridge instead of an ordinary one.",
      d: ["M 430 120 H 398 V 150 H 300 V 255 H 40",
          "M 585 150 H 770 V 265 H 490 V 153"],
      rides: ["ipri", "iL"],
      dim: ["M 40 45 H 170 V 150"] },
    { on: [0,1,0,1,1,1], t: "Freewheel", f: (D) => [Math.min(D + 0.04, 0.49), 0.5], n: "Both conducting switches are now on the same side of the bridge, which short-circuits the primary. Current keeps circulating around that loop — costing conduction loss while delivering nothing — and the output choke freewheels through both rectifiers. Circulating current during this interval is the price the topology pays for its soft switching.",
      d: ["M 430 184 H 410 V 200 H 180 V 150 H 170 V 45 H 300 V 150 H 398 V 120 H 430",
          "M 585 150 H 770 V 265 H 490 V 153"],
      rides: ["ipri", "iL"] },
    { on: [0,1,1,0,0,1], t: "Q3 + Q2 driving", f: (D) => [0.5, 0.5 + D], n: "The other diagonal takes over and the primary voltage reverses, so the core is used in both directions. Two power pulses per switching period means the output filter sees twice the switching frequency.",
      d: ["M 40 45 H 300 V 150 H 398 V 120 H 430",
          "M 430 184 H 410 V 200 H 180 V 150 H 170 V 255 H 40",
          "M 454 186 V 215 H 585 V 150 H 770 V 265 H 490 V 153"],
      rides: ["ipri", "ipri", "iD2"] },
    { on: [0,1,0,0,0,1], t: "ZVS transition", f: (D) => [0.5 + D, Math.min(0.5 + D + 0.04, 0.99)], n: "The mirror image of the first transition. This is the leg that loses zero-voltage switching first as the load falls, because it relies on energy stored in L_r alone — with less current there is less energy, and below some load it simply cannot swing the node in time.",
      d: ["M 430 184 H 410 V 200 H 180 V 150 H 170 V 255 H 40",
          "M 300 150 H 398 V 120 H 430",
          "M 585 150 H 770 V 265 H 490 V 153"],
      rides: ["ipri", "ipri", "iL"],
      dim: ["M 40 45 H 300 V 150"] },
    { on: [1,0,1,0,1,1], t: "Freewheel", f: (D) => [Math.min(0.5 + D + 0.04, 0.99), 1], n: "The second circulating interval, this time around the upper rail. Notice the primary current does not stop between pulses the way a forward converter's does — it keeps going round, which is what keeps the switches soft but also what makes light load inefficient.",
      d: ["M 430 184 H 410 V 200 H 180 V 150 H 170 V 45 H 300 V 150 H 398 V 120 H 430",
          "M 585 150 H 770 V 265 H 490 V 153"],
      rides: ["ipri", "iL"] },
  ]},

  llc: { w: 780, h: 290, flux: "static",
    ilabel: "i_tank",
    /* The tank current is a sinusoid, not a ramp — that is the whole point of
       a resonant converter, and the reason its edges are quiet. */
    iShape: (u) => Math.abs(Math.sin(2 * Math.PI * u)),
    sw: [[230, 103, "Q1", 0], [230, 193, "Q2", 0], [522, 92, "D1"], [522, 212, "D2"]],
    emc: { loop: "M 90 45 H 230 V 250 H 90 Z", node: [230, 148] },
    ph: [
    { on: [1,0,1,0], t: "Q1 on", f: () => [0, 0.46], n: "Q1 connects the tank to the input. Because L_r and C_r resonate, the current does not ramp like an inductor's — it swells and falls as a half sine, which is why this converter is so much quieter than a hard-switched one. D1 delivers the secondary half-cycle.",
      d: ["M 40 45 H 230 V 148 H 366 V 118 H 400", "M 400 182 V 250 H 40",
          "M 424 118 V 92 H 555 V 150 H 740 V 255 H 460 V 151"] },
    { on: [0,0,0,0], t: "Dead time", f: () => [0.46, 0.5], n: "Both switches are off. The magnetising current keeps circulating and swings the half-bridge node across to the other rail, so the switch about to turn on finds zero volts across it. The converter gets this for free at every load, which is why an LLC keeps its efficiency down to very light load.",
      d: ["M 230 148 H 366 V 118 H 400", "M 400 182 V 250 H 230"],
      dim: ["M 555 150 H 740 V 255 H 460 V 151"] },
    { on: [0,1,0,1], t: "Q2 on", f: () => [0.5, 0.96], n: "Q2 pulls the tank to the return rail and the current reverses through the same half sine. D2 takes the secondary half-cycle. Both rectifiers turn off at a natural current zero, so they make no reverse-recovery noise at all.",
      d: ["M 400 118 H 366 V 148 H 230 V 250 H 400 V 182",
          "M 424 184 V 212 H 555 V 150 H 740 V 255 H 460 V 151"] },
    { on: [0,0,0,0], t: "Dead time", f: () => [0.96, 1], n: "The mirror transition. Output is controlled by changing the switching frequency, not the duty: move away from resonance and the tank's impedance rises, so less power gets through.",
      d: ["M 400 118 H 366 V 148 H 230", "M 400 182 V 250 H 230"],
      dim: ["M 555 150 H 740 V 255 H 460 V 151"] },
  ]},

  dab: { w: 820, h: 290, flux: "static",
    ilabel: "i_L(tank)",
    /* A trapezoid whose corners move with the phase shift: steep while the two
       bridges oppose each other, shallow while they agree. */
    iShape: (u, D) => {
      const d = Math.min(Math.max(D, 0.02), 0.48);
      const t = u < 0.5 ? u : u - 0.5;
      return Math.abs(t < d ? -1 + (2 * t) / d : 1 - 0.35 * (t - d) / (0.5 - d));
    },
    sw: [[150, 103, "S1", 0], [150, 193, "S2", 0], [270, 103, "S3", 0], [270, 193, "S4", 0],
      [560, 103, "S5", 0], [560, 193, "S6", 0], [680, 103, "S7", 0], [680, 193, "S8", 0]],
    emc: { loop: "M 85 45 H 270 V 250 H 85 Z", node: [270, 148] },
    ph: [
    { on: [1,0,0,1,0,1,1,0], t: "Bridges opposed", f: (D) => [0, Math.min(Math.max(D, 0.02), 0.48)], n: "Both bridges drive the inductor, but in opposite directions, so it sees the sum of the two voltages and its current slews hard. This is the interval that actually moves power, and the phase between the bridges decides how long it lasts — which is the only control this converter has.",
      d: ["M 40 45 H 150 V 148 H 180 V 200 H 410 V 182 H 430",
          "M 430 118 H 348 V 148 H 270 V 250 H 40",
          "M 454 118 V 148 H 560 V 45 H 790", "M 790 250 H 680 V 148 H 660 V 210 H 454 V 182"] },
    { on: [1,0,0,1,1,0,0,1], t: "Bridges aligned", f: (D) => [Math.min(Math.max(D, 0.02), 0.48), 0.5], n: "The far bridge switches, so both now push the same way and the inductor sees only the difference between them. The current stops slewing and drifts instead. Power still flows, but this interval is mostly circulating current — which is why a DAB is designed with the two voltages matched through the turns ratio.",
      d: ["M 40 45 H 150 V 148 H 180 V 200 H 410 V 182 H 430",
          "M 430 118 H 348 V 148 H 270 V 250 H 40",
          "M 454 118 V 148 H 560 V 250 H 790", "M 790 45 H 680 V 148 H 660 V 210 H 454 V 182"] },
    { on: [0,1,1,0,1,0,0,1], t: "Opposed, reversed", f: (D) => [0.5, Math.min(0.5 + Math.max(D, 0.02), 0.98)], n: "The near bridge flips and the whole picture reverses. The transformer is used symmetrically in both directions, so its core never accumulates flux — and there is no duty to balance, because both bridges run at a fixed half.",
      d: ["M 40 45 H 270 V 148 H 348 V 118 H 430",
          "M 430 182 H 410 V 200 H 180 V 148 H 150 V 250 H 40",
          "M 454 118 V 148 H 560 V 250 H 790", "M 790 45 H 680 V 148 H 660 V 210 H 454 V 182"] },
    { on: [0,1,1,0,0,1,1,0], t: "Aligned, reversed", f: (D) => [Math.min(0.5 + Math.max(D, 0.02), 0.98), 1], n: "The mirror of the second interval. Reverse the sign of the phase shift and every arrow here turns round — the same hardware sends power the other way with no reconfiguration, which is the reason to build one.",
      d: ["M 40 45 H 270 V 148 H 348 V 118 H 430",
          "M 430 182 H 410 V 200 H 180 V 148 H 150 V 250 H 40",
          "M 454 118 V 148 H 560 V 45 H 790", "M 790 250 H 680 V 148 H 660 V 210 H 454 V 182"] },
  ]},

  hbridge: { w: 760, h: 280,
    ilabel: "i_Lf",
    /* One switching period taken at the crest of the output sine, where the
       duty is widest — the same device the PFC pages use for a line cycle. */
    iShape: (u, D) => 0.6 + 0.4 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    sw: [[200, 75, "Q1", 0], [200, 165, "Q2", 0], [320, 130, "Q3", 0], [320, 220, "Q4", 0]],
    emc: { loop: "M 95 50 H 320 V 240 H 95 Z", node: [200, 120] },
    pol: [426, 138, 486, 138],              /* L_f, the output filter choke */
    capFlow: [{ d: "M 95 50 V 240", src: "out" }],
    ph: [
    { on: [1,0,0,1], t: "Driving the load", f: (D) => [0, D], n: "One diagonal is on and the full DC link appears across the filter, pushing current out into the load. This is a single switching period taken near the crest of the output sine, where the on-time is at its longest; as the sine falls back toward its zero crossing the same interval shrinks, and at the crossing it all but vanishes.",
      d: ["M 40 50 H 200 V 120 H 620 V 175 H 320 V 240 H 40"] },
    { on: [1,0,1,0], t: "Freewheeling", f: (D) => [D, 1], n: "Both upper switches are on, so both ends of the filter sit at the same potential and the load sees zero volts rather than the reverse rail. The choke current keeps circulating round that loop. Switching this way — unipolar — means the filter sees a step of V_dc at twice the switching frequency instead of 2·V_dc, which is why the filter is so much smaller than a bipolar scheme needs.",
      d: ["M 200 120 H 620 V 175 H 320 V 50 H 200"] },
  ]},

  vsi3: { w: 760, h: 290,
    ilabel: "i_a",
    iShape: (u, D) => 0.62 + 0.38 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    sw: [[220, 85, "A+", 0], [220, 175, "A−", 0], [320, 105, "B+", 0], [320, 195, "B−", 0],
      [420, 125, "C+", 0], [420, 215, "C−", 0]],
    emc: { loop: "M 95 50 H 420 V 250 H 95 Z", node: [220, 130] },
    capFlow: [{ d: "M 95 50 V 250", src: "out" }],
    ph: [
    { on: [1,0,0,1,0,1], t: "Active vector", f: (D) => [0, D], n: "Phase A is tied to the positive rail while B and C are tied to the negative one, so current flows out of A and returns through the other two windings. Only eight switch combinations exist in total, and six of them look like this one — the motor is steered by choosing which, and for how long.",
      d: ["M 40 50 H 220 V 130 H 545", "M 545 150 H 320 V 250 H 40"] },
    { on: [1,0,1,0,1,0], t: "Zero vector", f: (D) => [D, 1], n: "All three phases are shorted to the same rail. The motor sees no voltage at all, but its own inductance keeps the current circulating around the three upper switches, so torque does not collapse. Sliding time between the active vectors and this one is how the average output voltage is set.",
      d: ["M 220 130 H 545", "M 545 150 H 320 V 50 H 220"] },
  ]},

  npc3: { w: 700, h: 300,
    ilabel: "i_ph",
    iShape: (u, D) => 0.64 + 0.36 * (u < D ? u / Math.max(D, 0.02) : (1 - u) / Math.max(1 - D, 0.02)),
    sw: [[300, 82, "S1", 0], [300, 132, "S2", 0], [300, 188, "S3", 0], [300, 236, "S4", 0],
      [225, 107, "D1"], [225, 213, "D2"]],
    emc: { loop: "M 100 50 H 300 V 250 H 100 Z", node: [300, 160] },
    ph: [
    { on: [1,1,0,0,0,0], t: "P state", f: (D) => [0, D], n: "The two upper devices are on together and the output sits at the positive rail. Notice that it takes two devices in series to do the job of one — and that is the trade: each of them only ever has to block half the DC link, so you can build a 1500 V converter out of 900 V parts.",
      d: ["M 40 50 H 300 V 160 H 470"] },
    { on: [0,1,0,0,1,0], t: "O state — clamped to the midpoint", f: (D) => [D, 1], n: "S1 opens and the output does not fall to the negative rail — it stops at the midpoint between the two link capacitors, held there through the clamp diode. That third level is the entire point: the output steps by half the link instead of all of it, so the voltage jump is half as large, the harmonics it makes are far smaller and the filter shrinks accordingly. The price is keeping that midpoint balanced, because every O interval moves charge into or out of one capacitor and not the other.",
      d: ["M 100 150 H 150 V 107 H 300 V 160 H 470"],
      dim: ["M 40 50 H 300"] },
  ]},
};

export { FLOW };
