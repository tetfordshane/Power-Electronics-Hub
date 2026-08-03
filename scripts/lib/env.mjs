/* Where the scripts that drive a browser expect to find the dev server.

   This was written out nine times as a literal `http://localhost:5173`, which
   is fine until that port belongs to something else — then every browser-based
   check fails at once, in nine places, saying nothing useful about why.

   PS_PORT is read by vite.config.js too. Keep them reading the same variable. */
export const PORT = Number(process.env.PS_PORT) || 5273;
export const BASE = process.env.PS_URL || `http://localhost:${PORT}`;

/* The bench address for one topology, optionally at a stated operating point.
   `over` is a {field: rawString} patch, exactly what the input boxes hold —
   so a browser-driven check can now measure a design other than the defaults
   without typing into seventeen fields. */
import { encodeHash, defaultRaw } from "../../src/urlstate.js";
export const bench = (id, over) =>
  `${BASE}/${over ? encodeHash("bench", id, { ...defaultRaw(id), ...over }) : `#/bench/${id}`}`;

/* The same page, forced to load as a new document.

   Navigating between two addresses that differ only in the hash does not
   reload anything — the router just moves — so the app keeps the state it
   had, and `carryOver` hands the previous topology's edited fields to the
   next one. A walk over every topology then measures a figure that depends
   on the order it was walked in, which is not a property of the app at all.
   A distinct query string makes it a real navigation. */
let visit = 0;
export const benchFresh = (id, over) => {
  const h = over ? encodeHash("bench", id, { ...defaultRaw(id), ...over }) : `#/bench/${id}`;
  return `${BASE}/?v=${++visit}${h}`;
};
