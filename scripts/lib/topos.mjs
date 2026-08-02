/* The topology catalogue, for the scripts.

   These used to scrape `id: "..."` out of the one big source file with a
   regex. Now that the data is a module the scripts can import, they read the
   real thing: a topology the regex would have missed — because someone put
   the id on its own line, say — can no longer drop silently out of a check
   that reports "all clear" over a catalogue with a hole in it.

   Everything under src/topologies is deliberately JSX-free so this import
   works in plain node, with no build step. Keep it that way. */
export { TOPOS, CATS, FLOW, FAMILY, byId } from "../../src/topologies/index.js";
export { FIELDS, ORDERED, order } from "../../src/fields.js";

import { TOPOS } from "../../src/topologies/index.js";

export const ids = () => TOPOS.map((t) => t.id);
