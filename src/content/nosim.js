/* Why this figure is drawn from equations rather than solved as a circuit.

   Twenty-four of the thirty-two are. The reader has no way to know that from
   the page unless the page says so: the "simulated" badge is present on eight
   and absent on the rest, and an absence explains nothing — it reads exactly
   like a feature that is broken, or one nobody noticed was missing.

   So each of them names its reason, and the reasons are a closed set of seven
   because they are the capabilities the engine does not have yet. That makes
   this file the conversion backlog as well as the copy: when the line-scale
   envelope lands, eight entries leave at once and check-registry prints a
   smaller number. A reason that no topology claims any more is a capability
   that is finished.

   What each entry must NOT do is apologise. A closed-form figure is not a
   degraded one — it is what the whole app was before there was a solver at
   all, it is drawn from the same equations the panel beside it prints, and
   for most of these topologies it is the more useful of the two. The note
   says what the model does guarantee, then what it cannot show. */

/* The capability each converter is waiting on. The key is the whole of the
   claim; the prose lives once, below, so twenty-four pages cannot drift into
   twenty-four slightly different explanations of the same gap. */
export const NOSIM_REASON = {
  /* The operating point moves across a 20 ms line cycle, so one switching
     period describes a single instant of it. */
  halfwave: "line", bridgerect: "line", pfcboost: "line", ilpfc: "line",
  totempole: "line", hbridge: "line", vsi3: "line", npc3: "line",

  /* Centre-tapped or multi-winding magnetics: more than the two coupled
     windings the transformer element models today. */
  forward2: "windings", pushpull: "windings", halfbridge: "windings",
  psfb: "windings", ctrect: "windings", syncrect: "windings", doubler: "windings",

  /* Legs that switch at an offset from one another rather than together.
     Multiphase left this list when the modulator learned to shift a schedule;
     the dual active bridge still waits on an inter-bridge phase shift. */
  dab: "phase",

  /* The switching frequency is an output of the design, not an input to it. */
  llc: "period", classe: "period", classepp: "period", classde: "period",

  /* Turn-on is triggered by the circuit's own state rather than by a clock. */
  qrflyback: "gating",

  /* No inductor anywhere: the state is capacitor voltages and every switch
     closure is a charge redistribution. */
  chargepump: "nomagnetics",
};

/* One explanation per capability. `t` is the phrase the badge carries; `n` is
   what the closed form still stands behind, which is the half a reader
   actually needs. */
export const NOSIM_WHY = {
  line: {
    t: "closed form · line cycle",
    n: "This converter's operating point travels across a whole mains cycle, so a single "
      + "switching period is one instant of it rather than the answer. The figure draws that "
      + "instant — the crest, where the stresses are worst — and the equations beside it "
      + "integrate the full cycle, which is where the numbers come from.",
  },
  windings: {
    t: "closed form · magnetics",
    n: "The transformer here has a centre tap or more windings than the circuit model "
      + "couples. The design equations handle it exactly; what the drawing cannot yet do is "
      + "work out the conduction pattern for itself, so the phases below are authored.",
  },
  phase: {
    t: "closed form · interleaved",
    n: "The legs switch at an offset from one another, and the modulator drives every "
      + "commanded switch from one schedule. The ripple cancellation the equations report is "
      + "real; the figure shows the legs in their authored order rather than solving them.",
  },
  period: {
    t: "closed form · frequency is an output",
    n: "The switching frequency here is something the design solves for rather than "
      + "something you set, and the engine is clocked by the frequency you set. The "
      + "characteristic plotted beside the figure is the exact relationship it solves.",
  },
  gating: {
    t: "closed form · self-timed",
    n: "This converter decides its own turn-on instant from the ringing on the switch node, "
      + "so the schedule is not known before the circuit is solved. The equations place the "
      + "valley exactly; the figure shows the intervals rather than discovering them.",
  },
  nomagnetics: {
    t: "closed form · switched capacitor",
    n: "There is no inductor in this converter at all: every switch closure moves charge "
      + "between capacitors. The output resistance the panel reports is the honest summary "
      + "of that, and it is what a designer actually sizes against.",
  },
};
