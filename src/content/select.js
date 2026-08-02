/* The selector comparison table. SELECT_ID maps a row's name onto a topology
   id, which is what makes the row clickable through to the bench. */
/* ========================== selector table ========================== */
/* Maps a comparison row to the bench page it describes, so the Selector
   can actually select something instead of being a static table. */
const SELECT_ID = {
  "Buck": "buck", "Sync buck": "syncbuck", "Multiphase buck": "multiphase",
  "Boost": "boost", "Buck-boost": "buckboost", "Four-switch BB": "fsbb",
  "Ćuk": "cuk", "SEPIC": "sepic", "Zeta": "zeta", "Charge pump": "chargepump",
  "Flyback": "flyback", "Two-switch forward": "forward2", "Push-pull": "pushpull",
  "Half-bridge": "halfbridge", "Phase-shifted FB": "psfb", "LLC resonant": "llc",
  "Dual active bridge": "dab", "Half-wave rectifier": "halfwave",
  "Full-bridge rectifier": "bridgerect", "Centre-tapped rectifier": "ctrect",
  "Synchronous rectifier": "syncrect", "Current doubler": "doubler",
  "Boost PFC": "pfcboost", "Totem-pole PFC": "totempole",
  "H-bridge inverter": "hbridge", "Three-phase VSI": "vsi3", "Three-level NPC": "npc3",
  "Class E": "classe", "Class E push-pull": "classepp", "Class DE": "classde",
};

const SELECT = [
  ["Buck", "D", "no", "1 W – 1 kW", "V_in", "Simplest. Continuous output current."],
  ["Sync buck", "D", "no", "1 W – 5 kW", "V_in", "Default above ~3 A or below ~5 V out."],
  ["Multiphase buck", "D", "no", "50 W – 10 kW", "V_in", "Ripple cancellation, current sharing."],
  ["Boost", "1/(1−D)", "no", "1 W – 5 kW", "V_out", "RHP zero. No output disconnect."],
  ["Buck-boost", "−D/(1−D)", "no", "1 – 100 W", "V_in+V_out", "Inverting. Both ports pulsate."],
  ["Four-switch BB", "D₁/(1−D₃)", "no", "10 W – 3 kW", "max(V_in,V_out)", "Best choice when V_in crosses V_out."],
  ["Ćuk", "−D/(1−D)", "no", "1 – 200 W", "V_in+V_out", "Continuous both ports; C1 works hard."],
  ["SEPIC", "D/(1−D)", "no", "1 – 150 W", "V_in+V_out", "Non-inverting, DC blocking, wide range."],
  ["Zeta", "D/(1−D)", "no", "1 – 100 W", "V_in+V_out", "Non-inverting with a quiet output."],
  ["Charge pump", "N+1 (fixed)", "no", "< 1 W", "V_in", "No magnetics; fixed ratio only."],
  ["Flyback", "D/(N(1−D))", "yes", "1 – 150 W", "V_in+V_R", "Cheapest isolation, multiple outputs."],
  ["Two-switch forward", "n·D", "yes", "100 – 500 W", "V_in", "Clamped switches, D < 0.5."],
  ["Push-pull", "2n·D", "yes", "50 – 500 W", "2·V_in", "Low V_in, ground-referenced drives."],
  ["Half-bridge", "n·D", "yes", "200 W – 1 kW", "V_in", "Off-line standard."],
  ["Phase-shifted FB", "2n·D_eff", "yes", "0.5 – 5 kW", "V_in", "ZVS, fixed frequency."],
  ["LLC resonant", "M(f_n,L_n,Q)", "yes", "100 W – 5 kW", "V_in", "ZVS+ZCS, variable frequency."],
  ["Dual active bridge", "phase-controlled", "yes", "1 – 100 kW", "V1 / V2", "Bidirectional, symmetric."],
  ["Half-wave rectifier", "≈ √2·V_ac", "no", "< 5 W", "2·V_pk", "One diode. Ripple at f_line, poor crest factor."],
  ["Full-bridge rectifier", "≈ √2·V_ac", "no", "1 W – 3 kW", "V_pk", "Mains front end. PF ≈ 0.6 without PFC."],
  ["Centre-tapped rectifier", "D·V_sec", "—", "10 W – 1 kW", "2·V_sec", "One diode drop; double secondary copper."],
  ["Synchronous rectifier", "D·V_sec", "—", "10 W – 5 kW", "2·V_sec", "I²R instead of V_F. Gate timing governs the result."],
  ["Current doubler", "D·V_sec", "—", "100 W – 3 kW", "V_sec", "Half the current per inductor, one winding."],
  ["Boost PFC", "1/(1−D)", "no", "75 W – 3 kW", "V_bus", "Mains front end, PF > 0.99."],
  ["Totem-pole PFC", "1/(1−D)", "no", "300 W – 10 kW", "V_bus", "Bridgeless; needs GaN/SiC."],
  ["H-bridge inverter", "m·V_dc (peak)", "no", "100 W – 10 kW", "V_dc", "Single-phase DC→AC."],
  ["Three-phase VSI", "V_LL = 0.707·m·V_dc", "no", "1 – 500 kW", "V_dc", "Motor drives, grid inverters. SVPWM."],
  ["Three-level NPC", "V_LL = 0.707·m·V_dc", "no", "10 kW – 10 MW", "V_dc/2", "Half the device stress, low THD."],
  ["Class E", "resonant ZVS", "no", "1 – 500 W", "3.562·V_dc", "One switch, MHz capable, load-sensitive."],
  ["Class E push-pull", "resonant ZVS", "no", "10 W – 2 kW", "3.562·V_dc", "Twice the power, even harmonics cancel."],
  ["Class DE", "resonant ZVS", "no", "50 W – 5 kW", "V_dc", "ZVS without the voltage penalty."],
];

export { SELECT, SELECT_ID };
