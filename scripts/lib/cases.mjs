/* The operating points every topology is pinned at.

   One of them is the design a reader actually opens on. The others are the
   corners where closed-form design equations go wrong quietly: light load,
   where continuous conduction stops being true; the low-line corner, where
   duty runs up against its ceiling; and a high switching frequency, where
   every f_sw term in the loss budget has to move the right way.

   A case only applies where the topology has the field it moves, and the
   name records which — a corner that silently failed to apply would other-
   wise be recorded as a passing case that measures nothing. */
import { defaultSpec, has } from "./spec.mjs";
import { FIELDS } from "../../src/fields.js";

/* The field carrying the load, in the order we would rather move it. */
const LOAD = ["iout", "idc", "pout"];
const loadKey = (t) => LOAD.find((k) => has(t, k));

export function casesFor(topo) {
  const out = [{ name: "defaults", spec: defaultSpec(topo) }];

  const lk = loadKey(topo);
  if (lk) {
    const base = defaultSpec(topo)[lk];
    out.push({ name: `light load (${lk} = 10 %)`, spec: defaultSpec(topo, { [lk]: base * 0.1 }) });
  }

  if (has(topo, "fsw")) {
    const base = defaultSpec(topo).fsw;
    const hi = Math.min(base * 4, FIELDS.fsw.mx);
    if (hi > base * 1.5) out.push({ name: "high f_sw (×4)", spec: defaultSpec(topo, { fsw: hi }) });
  }

  /* The low-line corner. vinNom pulled down to vinMin is where a buck's duty
     peaks and a boost's stops being reachable; the same idea on the AC side. */
  if (has(topo, "vinMin") && has(topo, "vinNom")) {
    const d = defaultSpec(topo);
    out.push({ name: "low line (V_in nom = V_in min)", spec: defaultSpec(topo, { vinNom: d.vinMin }) });
  } else if (has(topo, "vacMin") && has(topo, "vacIn")) {
    const d = defaultSpec(topo);
    out.push({ name: "low line (V_ac in = V_ac min)", spec: defaultSpec(topo, { vacIn: d.vacMin }) });
  }

  return out;
}
