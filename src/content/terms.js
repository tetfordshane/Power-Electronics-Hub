/* The glossary. Each entry is [name, pattern, definition]; a topology page
   shows the entries whose pattern matches its own prose, so nothing is
   maintained per topology. Keep the patterns tight. */
/* ============================ the glossary ============================

   Every page here uses words that are ordinary to a power engineer and opaque
   to everyone else — ZVS, CCM, flux walking, dead time. Spelling each one out
   wherever it appears would bury the prose; leaving them undefined assumes
   the reader already knows, which is exactly the assumption this tool should
   not make.

   So: a term list, and a footer under each topology that shows the definitions
   of the terms THAT PAGE actually uses. The list is scanned out of the page's
   own prose, so nothing has to be maintained per topology and prose written
   later gets its definitions for free. Order follows the list below rather
   than the text, so the reader meets the general idea before the special
   case (continuous conduction before discontinuous, ZVS before ZCS).

   `re` is matched case-insensitively against the page's prose. Keep the
   patterns tight — a term that matches too eagerly puts a definition on a
   page that never discussed it, which is worse than leaving it out. */
const TERMS = [
  /* The foundations first. These carry most of their weight on the pages a
     newcomer is likeliest to open cold — a four-switch buck-boost page
     matched nothing at all until they were added. */
  ["inductor", /\binductor|\bchoke\b|\bL_?[a-z0-9]?\b/, "a coil that resists any change in the current through it. Interrupt it and it will hold that current going by whatever voltage it takes — which is what every switching converter here is exploiting."],
  ["capacitor", /\bcapacitor|\bC_(out|in|bulk|dc)\b/, "stores charge and resists changes in voltage. It is what holds the output steady between the moments the converter actually delivers energy."],
  ["conversion ratio", /conversion ratio|\bM = |step[- ]down|step[- ]up/, "the output voltage divided by the input, written M. What a topology can and cannot reach is the first thing that decides whether it suits a job."],
  ["rectifier", /\brectif|\bdiode\b/, "a component that passes current one way only. It is what stops the output feeding back into the converter when the switch opens."],
  ["freewheel", /freewheel/, "the interval after the switch opens, where the inductor's current keeps circulating through a diode or a second switch instead of stopping."],
  ["turns ratio", /turns ratio|\bN_p|\bn : 1|\btransformer\b/, "how many times more wire is wound on one side of a transformer than the other. It sets both the voltage the secondary makes and the current the primary has to carry."],
  ["bidirectional", /bidirectional|reverse power|\bV2G\b/, "able to pass power both ways with no change of wiring — needed wherever a battery must both charge and discharge."],
  ["gate drive", /gate driv|gate charge|\bQ_g\b|drives?\b.*switch|four drives/, "the circuit that charges and discharges a switch's control terminal. It costs energy every cycle, which is one of the things that limits how fast a converter can switch."],
  ["duty cycle", /\bduty\b|\bD_\d\b/, "the fraction of each switching period the main switch spends on. Nearly every conversion ratio here is written in terms of it, as D."],
  ["switching period", /\bswitching period\b|\bf_sw\b/, "one complete open-and-close of the switch, T = 1/f_sw. Everything in these figures repeats once per period."],
  ["continuous conduction (CCM)", /\bCCM\b|\bcontinuous conduction\b/, "the inductor current never reaches zero. The textbook conversion ratios all assume this."],
  ["discontinuous conduction (DCM)", /\bDCM\b|\bdiscontinuous\b/, "at light load the current hits zero and rests there for part of the period. The CCM ratios stop holding, and the output voltage rises above what they predict."],
  ["ripple", /\bripple\b/, "the small back-and-forth on top of a steady value — how far the inductor current swings each cycle, or how far the output voltage moves."],
  ["ESR", /\bESR\b/, "equivalent series resistance: the small resistance in series inside a real capacitor. Output ripple is partly charge and partly this, and buying more capacitance only helps the first part."],
  ["volt-second balance", /volt-second/, "over one period an inductor must gain exactly as much flux as it loses, or its current would climb without limit. It is what pins the conversion ratio to the duty."],
  ["magnetising current", /\bmagnetis/, "the current that magnetises a transformer's core rather than crossing to the secondary. It does no useful work but has to be dealt with."],
  ["flux walking", /flux walk|walks the core|walking the core|walk the core/, "a transformer driven slightly harder one way than the other accumulates flux cycle after cycle, until the core saturates. Bridges and push-pulls have to guard against it."],
  ["dead time", /\bdead time\b|t_dead/, "a deliberate gap where both switches in a leg are off, so they can never be on together and short the supply."],
  ["ZVS", /\bZVS\b|zero[- ]voltage/, "zero-voltage switching: the voltage across a switch is brought to zero before it turns on, so the turn-on costs almost nothing."],
  ["ZCS", /\bZCS\b|zero[- ]current/, "zero-current switching: the current has already fallen to zero when the device turns off, so there is nothing to interrupt."],
  ["synchronous rectifier", /\bsynchronous rect|\bsync(hronous)? (buck|rectif)/, "a MOSFET used in place of a diode. It drops I·R instead of a fixed voltage, which wins at low output voltages."],
  ["reverse recovery", /reverse[- ]recover|Q_rr/, "a silicon diode stores charge while conducting and must sweep it out before it can block. That charge is dragged through the switch turning on, and it is dissipated there."],
  ["body diode", /body diode/, "the diode built into every MOSFET by its construction. It conducts during dead time whether you want it to or not."],
  ["RHP zero", /RHP|right[- ]half[- ]plane/, "a right-half-plane zero: the output initially moves the WRONG way when the duty changes. It cannot be compensated away, only crossed over below."],
  ["resonant tank", /\btank\b|\bresonan/, "an inductor and capacitor tuned together. Current in a tank swells and falls as a sinusoid instead of ramping, which is what makes resonant converters quiet."],
  ["power factor (PFC)", /\bPFC\b|power factor/, "how closely the current drawn from the mains follows the voltage in shape and phase. Regulations require it above about 75 W."],
  ["interleaving", /interleav/, "running several identical stages staggered in time, so their ripple currents partly cancel before reaching the capacitor."],
  ["hard switching", /hard[- ]switch/, "turning a device on or off while it is carrying current and standing off voltage at the same time. The overlap is dissipated in the device."],
];

/* The terms a given page actually uses, in list order. */
const termsFor = (text) => TERMS.filter(([, re]) => re.test(text));

export { TERMS, termsFor };
