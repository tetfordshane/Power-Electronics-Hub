/* What the gate driver commands, as a function of position in the period.

   This is the half of device state that genuinely is authored, and it should
   be: a controller decides when to turn a switch on. The other half — which
   diode conducts, and when a synchronous rectifier's current reverses — is
   the circuit's business and is worked out in solver.js.

   Dead time is a real interval here, not a constant folded into a phase
   window. Both switches in a leg are commanded off across it, and what
   happens during it (body-diode conduction, or a resonant transition that
   reaches zero volts first) falls out of the circuit rather than being
   asserted. That distinction is most of the difference between a drawing of
   a converter and a model of one.

   A schedule returns, for a position u ∈ [0,1) in the period:
     gates  { branchId: boolean }
     edges  the u values where anything changes, so the solver can land on
            them exactly instead of stepping over them */

/* One switch, on for the first D of the period. */
export function pwm1(id, D) {
  const d = Math.min(Math.max(D, 0), 1);
  return {
    edges: [0, d],
    at: (u) => ({ [id]: u < d }),
  };
}

/* A complementary pair with dead time on both transitions.

   `td` is in the same units as u — a fraction of the period — because that
   is what the rest of the engine works in. The caller converts from seconds
   once, where the period is known. */
export function pwmComplementary(hi, lo, D, td) {
  const d = Math.min(Math.max(D, 0), 1);
  const t = Math.max(0, Math.min(td, d / 2, (1 - d) / 2));
  /* high on [0, d−t), dead, low on [d+t, 1−t), dead */
  const e = [0, Math.max(0, d - t), d + t, Math.max(d + t, 1 - t)];
  return {
    edges: [...new Set(e)].sort((a, b) => a - b),
    at: (u) => {
      const hiOn = u < d - t;
      const loOn = u >= d + t && u < 1 - t;
      return { [hi]: hiOn, [lo]: loOn };
    },
  };
}

/* Several schedules at once — a bridge, or a converter with a synchronous
   rectifier on the far side of a transformer. */
export function combine(...mods) {
  const edges = [...new Set(mods.flatMap((m) => m.edges))].sort((a, b) => a - b);
  return {
    edges,
    at: (u) => Object.assign({}, ...mods.map((m) => m.at(u))),
  };
}

/* No commanded switches at all — a diode rectifier. */
export const passive = { edges: [0], at: () => ({}) };
