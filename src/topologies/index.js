import { TA } from "./nonisolated.js";
import { TB } from "./isolated.js";
import { TC } from "./acdc.js";
import { TD } from "./rectification.js";
import { TE } from "./resonant.js";
import { FLOW } from "./flow.js";
import { FAMILY } from "./family.js";

/* Every topology, in rail order.

   The order here is the order they appear in the left rail, and it is not the
   order the category arrays are declared in — rectification reads better
   before the AC-side converters that use it.

   FLOW and FAMILY are keyed by the same ids. Nothing enforces that by
   construction, so scripts/check-registry.mjs asserts it: a topology that
   gains an entry in one registry and not the others loses its animation or
   its family line silently, which is exactly the failure this app cannot
   see from the inside. */
const TOPOS = [...TA, ...TB, ...TD, ...TC, ...TE];
const CATS = ["Non-isolated DC–DC", "Isolated DC–DC", "Rectification", "AC–DC / PFC",
  "DC–AC inversion", "Resonant / class E"];

const byId = (id) => TOPOS.find((t) => t.id === id);

export { TOPOS, CATS, TA, TB, TC, TD, TE, FLOW, FAMILY, byId };
