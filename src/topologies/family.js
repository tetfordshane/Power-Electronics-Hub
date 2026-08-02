/* One sentence per topology placing it among its relatives. */
/* Which family a converter belongs to, and what it does differently.

   This is what the generic family figure was genuinely good for. That figure
   drew one idealised "bridge" or "buck-boost cell" for a whole group and
   carried a note admitting it was not the circuit above it — useful for
   placing a converter, useless for reading it, and every topology now traces
   its own path instead. The placing survives here as one sentence, which is
   how much of it was ever worth a figure: what this shares with its
   relatives, and the one thing it does differently. */
const FAMILY = {
  buck: "the buck family — a switch chops the input and an LC filter takes the average. Everything below it in this list is a rearrangement of that idea.",
  syncbuck: "the buck family. The catch diode has become a second switch, so the loss is I²R instead of a fixed 0.4 V drop.",
  multiphase: "the buck family, several times over. Identical stages run staggered so their ripple partly cancels before it reaches the capacitor.",
  boost: "the boost family — the inductor is charged from the input, then dumped into a higher output through a rectifier.",
  pfcboost: "the boost family, with the input following a rectified sine instead of a DC rail, so the duty is modulated continuously across the line cycle.",
  totempole: "the boost family, with the diode bridge deleted — one leg switches fast, the other swaps polarity at line frequency.",
  buckboost: "the buck-boost family — the inductor is charged from the input and discharged into the output, with no direct path between them.",
  fsbb: "the buck-boost family, split into a buck leg and a boost leg so only one of them has to switch at a time.",
  cuk: "the buck-boost family, but the energy crosses through a capacitor rather than the inductor's field, which is what makes both ports continuous.",
  sepic: "the buck-boost family, with the inductor split in two and coupled through a series capacitor so the output comes out positive.",
  zeta: "the buck-boost family, rearranged so that the continuous current is the one facing the load.",
  chargepump: "the switched-capacitor family — no magnetics at all, so the ratio is fixed by topology rather than by duty.",
  flyback: "the flyback family — the transformer is really a coupled inductor, storing energy in the on-time and releasing it in the off-time.",
  forward2: "the forward family — the transformer passes power across while the switch is on and stores nothing on purpose, so a separate choke does the storing.",
  pushpull: "the bridge family — the primary is driven alternately in both directions, so the core is used both ways and can be smaller.",
  halfbridge: "the bridge family, with one leg replaced by a capacitor divider, so the winding swings ±V_in/2 and each device blocks only V_in.",
  psfb: "the bridge family, with the two legs phase-shifted rather than switched together — which buys zero-voltage turn-on from the parasitics.",
  llc: "the bridge family, feeding a resonant tank instead of the transformer directly. The tank shapes the current into a sinusoid, so nothing switches hard.",
  dab: "the bridge family, twice — a second identical bridge faces the first, and the phase between them sets both the amount and the direction of power flow.",
  halfwave: "the rectifier family — the simplest member, conducting on alternate half-cycles and wasting the other half.",
  bridgerect: "the rectifier family — four diodes so that both half-cycles reach the load the same way up.",
  ctrect: "the rectifier family, with a centre-tapped winding so only one diode drop sits in the output path instead of two.",
  syncrect: "the rectifier family, with the diodes replaced by MOSFETs — trading a fixed voltage drop for I²R.",
  doubler: "the rectifier family, with the load current split between two chokes that take turns, so each winding carries half.",
  hbridge: "the inverter family — a bridge switched at high frequency and modulated slowly, so its average output traces a sine.",
  vsi3: "the inverter family, three legs of it, driven 120° apart to make a rotating field.",
  npc3: "the inverter family, with each switch split in two and clamped to a midpoint, giving a third output level.",
  classe: "the switched-mode amplifier family — a single switch and a tuned network shaped so the device turns on at zero volts and zero slope.",
  classepp: "the switched-mode amplifier family, two class-E stages in antiphase so their even harmonics cancel in the load.",
  classde: "the switched-mode amplifier family, combining class-D's low device stress with class-E's soft transition.",
  ilpfc: "the boost family, built twice and run half a period out of step so the two ripple currents partly cancel each other.",
  qrflyback: "the flyback family, with the turn-on instant chosen to land at the bottom of the ring the circuit was making anyway.",
};

export { FAMILY };
