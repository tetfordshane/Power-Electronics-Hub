/* What drives each mark that varies with time.

   The honesty ladder says a mark may move only if a computed quantity moves
   it, and anything uncomputed gets fixed faint presence instead. That rule
   lived entirely in prose and in the discipline of whoever was editing, which
   held right up until it did not: the EMC lens's rings were described as the
   common-mode current stray capacitance injects into earth — C_par·dv/dt —
   and were sized by a conduction current, for as long as a current was the
   only quantity that reached the drawing.

   So each such mark names the path its value comes from, and
   `scripts/check-honesty.mjs` resolves those paths against a real solved run.
   What that catches is the failure that actually happened: a quantity the
   lenses depend on quietly ceasing to arrive — a probe renamed, a view
   dropped at the adapter boundary, an events array that stopped being
   populated. It cannot prove the drawing code reads the path it declares;
   only that the path is there to be read, and that nothing has silently
   removed the ground a claim stands on.

   `sim.` paths are relative to a CycleView's `sim` block. A mark whose driver
   is `null` is claiming presence only, which is the ladder's other rung and
   needs no evidence beyond saying so. */
export const DRIVERS = {
  /* EMC lens */
  emcRingSize: "sim.slopeAt:vsw",   /* dv/dt at the edge — the injection itself */
  emcEdgeTimes: "sim.events",       /* when devices actually commutated */
  emcNodeSwing: "sim.views.vsw",    /* the node's own potential, live */
  emcLoopHeat: "sim.slopeAt:vsw",   /* the loop flares with the same rate */

  /* Fields lens — the coil that carries the plotted winding is the one
     quantity this lens has always computed honestly. */
  fieldPolCoil: "iAt",

  /* Deliberately presence-only. Named here so the list is the whole set of
     time-varying marks rather than the flattering half of it. */
  fieldOtherCoils: null,            /* per-branch currents not yet routed to coils */
  fieldStaticCore: null,            /* no flux model for a tank or a bare transformer */
  fieldUnmodelledCap: null,         /* not joined to a capFlow branch */
};
