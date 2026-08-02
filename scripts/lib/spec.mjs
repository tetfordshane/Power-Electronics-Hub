/* The spec a topology opens with, built the way the App builds it.

   A script that invents its own defaults is checking a design nobody sees.
   This mirrors mkRaw + the sanitiser in App: per-topology `defs` override the
   field default, everything is clamped to its own mn/mx, and `order()` then
   restores the relations that a per-field range cannot see. */
import { FIELDS, order } from "../../src/fields.js";
import { clamp } from "../../src/format.js";

export function defaultSpec(topo, over = {}) {
  const o = {};
  for (const k of topo.fields || []) {
    const F = FIELDS[k];
    if (!F) continue;
    const dv = topo.defs && topo.defs[k] !== undefined ? topo.defs[k] : F.d;
    o[k] = F.mn !== undefined ? clamp(dv, F.mn, F.mx) : dv;
  }
  for (const [k, v] of Object.entries(over)) {
    const F = FIELDS[k];
    o[k] = F && F.mn !== undefined ? clamp(v, F.mn, F.mx) : v;
  }
  return order(o);
}

/* Whether a topology even has the field a corner case wants to move. */
export const has = (topo, k) => (topo.fields || []).includes(k);
