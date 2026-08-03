/* Worked examples, keyed by the topology category they belong to.

   Every other page on the bench answers "what do these numbers give me". A
   beginner arrives without numbers, and the defaults — which are a sensible
   operating point for the topology, not a job anyone has — do not tell them
   where numbers come from. So each category carries a handful of real jobs:
   what the job is, what it fixes, and which topology it lands on.

   `go` makes the example loadable rather than illustrative. `over` is a patch
   of RAW STRINGS over the target topology's defaults, exactly the shape
   mkRaw() produces, so it goes through the same parse-clamp-order pipeline
   every typed entry does and nothing here can put the bench in a state a
   reader could not have typed.

   The `t`/`e`/`n` keys are the ones check-tex already scans, so the prose and
   the formulas in here are gated with everything else. check-registry holds
   the other end: every category has at least one example, every example
   points at a real topology, and every key in `over` is a field that
   topology actually displays, in range.                                   */

const EXAMPLES = {
  "Non-isolated DC–DC": [
    {
      t: "A 1.2 V core rail from a 12 V board supply",
      e: "V_in = 12 V, V_out = 1.2 V, I_out = 20 A, f_sw = 500 kHz",
      n: "The job most processors give you, and the one that shows why duty cycle is a "
        + "design constraint rather than an output. A tenth of the input means a tenth of the "
        + "period, so at 500 kHz the switch is on for barely 220 ns — near the minimum on-time "
        + "real controllers admit to. Halve f_sw and watch the on-time double while the "
        + "inductor grows: that trade, not a better inductor, is the lever you have.",
      go: { tid: "buck", over: { vinMin: "11", vinNom: "12", vinMax: "13", vout: "1.2",
        iout: "20", fsw: "500" } },
    },
    {
      t: "12 V from a single lithium cell",
      e: "V_in = 3.0–4.2 V, V_out = 12 V, I_out = 1 A",
      n: "A boost with a wide input, which is the case that punishes you for reading only "
        + "the nominal column. The inductor current is the INPUT current, so at 3 V the "
        + "switch carries four times the load current — size everything at V_in min and "
        + "check what the ripple ratio did to the peak while you were at it.",
      go: { tid: "boost", over: { vinMin: "3", vinNom: "3.7", vinMax: "4.2", vout: "12",
        iout: "1", fsw: "600" } },
    },
  ],
  "Isolated DC–DC": [
    {
      t: "A 24 W auxiliary supply off the rectified mains",
      e: "V_in = 120–375 V DC, V_out = 12 V, I_out = 2 A, f_sw = 65 kHz",
      n: "The housekeeping supply inside almost every mains-powered product. A flyback wins "
        + "below roughly 75 W because it needs one magnetic component and one switch, and "
        + "this is the operating point where that is obviously true. The number to look at "
        + "is the switch voltage: V_in max plus the reflected output plus the leakage spike, "
        + "which is what decides whether a 650 V part is enough.",
      go: { tid: "flyback", over: { vinMin: "120", vinMax: "375", vout: "12", iout: "2",
        fsw: "65" } },
    },
    {
      t: "A 480 W half-bridge brick from a 390 V bus",
      e: "V_bus = 390 V, V_out = 12 V, I_out = 40 A, f_sw = 150 kHz",
      n: "Above a couple of hundred watts the flyback's single switch runs out of room and "
        + "the transformer stops being a coupled inductor. Here the core is driven both ways, "
        + "so it carries roughly twice the power for its size — and the price is two switches, "
        + "a real output inductor, and a duty cycle that can never reach one half.",
      go: { tid: "halfbridge", over: { vinMin: "330", vinNom: "390", vinMax: "420",
        vout: "12", iout: "40", fsw: "150" } },
    },
  ],
  "Rectification": [
    {
      t: "The DC bus behind a 230 V mains inlet",
      e: "V_ac = 230 Vrms, f_line = 50 Hz, I_dc = 2 A, C_bulk = 220 µF",
      n: "A deliberately undersized bulk capacitor, because the interesting number here is "
        + "the one people guess wrong. The capacitor is recharged for only a degree or two "
        + "either side of the peak, so its RMS current is several times the DC it delivers "
        + "and the diodes see a tall narrow pulse. Raise C_bulk and watch the ripple fall "
        + "while the crest factor gets worse, not better.",
      go: { tid: "bridgerect", over: { vacIn: "230", fline: "50", idc: "2", cbulk: "220",
        vf: "0.9" } },
    },
    {
      t: "Why a 3.3 V output cannot use diodes",
      e: "V_out = 3.3 V, I_out = 40 A, f_sw = 150 kHz",
      n: "Put a 0.45 V Schottky in the path of 40 A and it dissipates eighteen watts — more "
        + "than a tenth of the output power thrown away in one component, before anything "
        + "else in the converter has been counted. A MOSFET at 3 mΩ turns that into under "
        + "five. This is the whole argument for synchronous rectification, and it is a "
        + "multiplication anyone can do.",
      go: { tid: "syncrect", over: { vout: "3.3", iout: "40", fsw: "150", rds: "3" } },
    },
  ],
  "AC–DC / PFC": [
    {
      t: "The front end of a 600 W desktop supply",
      e: "V_ac = 85–265 Vrms, P_out = 600 W, V_bus = 390 V, f_sw = 65 kHz",
      n: "Universal input, which means every stress in the converter is set at 85 V and "
        + "every voltage rating at 265. Above 75 W the standards require the input current "
        + "to follow the input voltage, so the boost runs its inductor current to a rectified "
        + "sine rather than a constant — the hold-up requirement on C_bus, not the ripple, is "
        + "what sizes that capacitor. Note the warning: 390 V is the conventional bus and it "
        + "is only 4 % above the 375 V peak of a 265 V line, which is exactly as much margin "
        + "as the boost has to keep control at the top of the sine.",
      go: { tid: "pfcboost", over: { vacMin: "85", vacMax: "265", pout: "600", vbus: "390",
        fsw: "65", thold: "20" } },
    },
    {
      t: "Where bridgeless is worth two extra switches",
      e: "V_ac = 85–265 Vrms, P_out = 1500 W, V_bus = 400 V",
      n: "The input bridge in the example above drops two diodes' worth of voltage across "
        + "the whole line current, all the time. At 1.5 kW that is tens of watts spent before "
        + "the converter starts. Totem-pole removes the bridge — and demands devices with no "
        + "reverse recovery to do it, which is the warning on this page and the reason the "
        + "topology waited for GaN and SiC to arrive.",
      go: { tid: "totempole", over: { vacMin: "85", vacMax: "265", pout: "1500", vbus: "400",
        fsw: "65" } },
    },
  ],
  "DC–AC inversion": [
    {
      t: "A 3 kW single-phase grid-tied inverter",
      e: "V_dc = 400 V, V_ac = 230 Vrms, f_o = 50 Hz, f_sw = 20 kHz",
      n: "The DC link has to clear the AC peak with room to modulate, which is why 400 V "
        + "feeds a 230 V output and not 325. Two numbers deserve attention: the modulation "
        + "index, which says how much of that headroom is being used, and the dead time — "
        + "500 ns lost from every 50 µs period is a distortion of the output as well as a "
        + "loss.",
      go: { tid: "hbridge", over: { vdc: "400", vac: "230", fo: "50", fsw: "20",
        pout: "3000", td: "500" } },
    },
    {
      t: "The same power, three phases",
      e: "V_dc = 650 V, V_ac = 400 Vrms, P_out = 3 kW, f_sw = 20 kHz",
      n: "The same power and the same switching frequency as the example above, so the two "
        + "pages can be read against each other — but not the same bus, and that is the first "
        + "lesson. A three-phase 400 V output needs its DC link up near 650 V, because the "
        + "link has to clear the LINE-TO-LINE peak; try 400 V here and the page tells you the "
        + "modulation index has left the linear range. What you buy for it: the power flows "
        + "continuously instead of pulsing at twice the line frequency, so the DC-link "
        + "capacitor stops being sized by a 100 Hz ripple it no longer sees.",
      go: { tid: "vsi3", over: { vdc: "650", vac: "400", pout: "3000", fsw: "20" } },
    },
  ],
  "Resonant / class E": [
    {
      t: "A 13.56 MHz wireless-power transmitter",
      e: "V_dc = 48 V, P_out = 50 W, f_sw = 13.56 MHz, C_oss = 50 pF",
      n: "At thirteen megahertz a hard-switched converter would spend more energy on C_oss "
        + "every cycle than it delivers. Class E does not fight that capacitance — it makes "
        + "it part of the tank, so the switch turns on at zero volts and the loss disappears. "
        + "That only works while the device is smaller than the shunt capacitor the design "
        + "asks for, which is why this example fits a 50 pF GaN part: put the 300 pF silicon "
        + "default back and the page tells you ZVS has become impossible. The bargain is the "
        + "switch voltage, which reaches something like 3.6 times the supply.",
      go: { tid: "classe", over: { vdc: "48", pout: "50", fsw: "13560", ql: "6", coss: "50" } },
    },
    {
      t: "Induction heating at 100 W",
      e: "V_dc = 60 V, P_out = 100 W, f_sw = 500 kHz, Q_L = 10",
      n: "A higher loaded Q than the transmitter above, because here the sine wave matters "
        + "more than the bandwidth. Watch what raising Q_L does: the tank current climbs well "
        + "past the DC input current, so the circulating current — not the throughput — is "
        + "what sizes the inductor, the capacitor and the switch.",
      go: { tid: "classe", over: { vdc: "60", pout: "100", fsw: "500", ql: "10" } },
    },
  ],
};

export { EXAMPLES };
