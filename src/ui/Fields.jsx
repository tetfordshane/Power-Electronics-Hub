import React from "react";
import { Mx } from "../tex.jsx";
import { FIELDS } from "../fields.js";
import { eng } from "../format.js";
import { TOPOS } from "../topologies/index.js";

function mkRaw(id) {
  const t = TOPOS.find((x) => x.id === id) || TOPOS[0];
  const o = {};
  (t.fields || []).forEach((k) => {
    const dv = (t.defs && t.defs[k] !== undefined) ? t.defs[k] : FIELDS[k].d;
    o[k] = String(dv);
  });
  return o;
}

function Fields({ topo, raw, spec, set }) {
  return (
    <div className="fields">
      {(topo.fields || []).map((k) => {
        const F = FIELDS[k];
        if (!F) return null;
        const txt = raw[k];
        const num = parseFloat(txt);
        /* Flag anything the sanitiser had to rewrite, so the reader can see
           that the number in the box is not the number being used. Comparing
           against the value design() actually received catches the range
           clamp and the ORDERED clamp with one test, and cannot fall out of
           step with either the way a re-implemented range check did. */
        const used = spec ? spec[k] : undefined;
        const moved = Number.isFinite(num) && Number.isFinite(used)
          && Math.abs(num - used) > Math.max(Math.abs(used), 1) * 1e-9;
        const bad = txt !== "" && txt !== undefined && (!isFinite(num) || moved);
        const why = !isFinite(num) ? "Not a number — the design uses the default."
          : (F.mn !== undefined && (num < F.mn || num > F.mx))
            ? "Outside the usable range " + F.mn + " to " + F.mx + " — the design uses the nearest valid value."
            : "Out of order with the other limits — the design uses " + eng(used, F.u === "V" ? "V" : "") + ".";
        return (
          <div className="fld" key={k}>
            <label htmlFor={"f_" + k}>
              <Mx t={F.l} />{F.u ? <span className="u"> {F.u}</span> : null}
            </label>
            <input id={"f_" + k} type="number" inputMode="decimal" step={F.s || "any"}
              min={F.mn} max={F.mx} className={bad ? "bad" : ""}
              aria-invalid={bad || undefined}
              title={bad ? why : undefined}
              value={txt ?? ""} onChange={(e) => set(k, e.target.value)} />
          </div>
        );
      })}
    </div>
  );
}

export { mkRaw, Fields };
