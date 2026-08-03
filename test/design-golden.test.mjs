/* Every design() against its recorded output, at four operating points each.

   These are deterministic closed forms, so the tolerance is there for float
   and engine differences and nothing else — a real change of a millivolt will
   fail, which is the point. If a diff here is intended, read it, then
   regenerate with `node scripts/gen-golden.mjs` in the same commit.

   Beyond the comparison, the invariants: nothing infinite, nothing negative
   where negative is meaningless, and nothing that would print as a blank on
   the panel. Those hold whether or not the golden file is up to date. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOPOS } from "../scripts/lib/topos.mjs";
import { casesFor } from "../scripts/lib/cases.mjs";

const golden = JSON.parse(readFileSync(new URL("./golden/design.json", import.meta.url), "utf8"));

const REL = 1e-9;
const close = (a, b) => {
  if (typeof a !== "number" || typeof b !== "number") return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-30);
  return Math.abs(a - b) / scale <= REL;
};

/* Walk two recorded shapes together and report the first place they part. */
function same(a, b, path = "") {
  if (Array.isArray(a) || Array.isArray(b)) {
    assert.ok(Array.isArray(a) && Array.isArray(b), `${path}: one is an array, the other is not`);
    assert.equal(a.length, b.length, `${path}: ${a.length} entries, expected ${b.length}`);
    a.forEach((x, i) => same(x, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) same(a[k], b[k], path ? `${path}.${k}` : k);
    return;
  }
  if (typeof a === "number" && typeof b === "number") {
    assert.ok(close(a, b), `${path}: ${a} is not ${b}`);
    return;
  }
  assert.equal(a, b, `${path} differs`);
}

/* Same reduction gen-golden.mjs records, so the two cannot drift. */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? +v.toPrecision(12) : v);
function shot(res) {
  if (!res) return null;
  const warnOf = (r) => (r.warn || []).map((w) => [w.s, w.m]);
  if (res.infeasible) return { infeasible: true, warn: warnOf(res) };
  const o = {
    hi: (res.hi || []).map(([k, v]) => [k, v]),
    loss: (res.loss || []).map(([k, w, f]) => [k, num(w), f || ""]),
    warn: warnOf(res),
    groups: (res.groups || []).map((g) => ({
      t: g.t, rows: (g.rows || []).map((r) => [r[0], r[1], r[2] || ""]),
    })),
  };
  if (res.pout !== undefined) o.pout = num(res.pout);
  if (res.wave) {
    const w = res.wave;
    o.wave = {};
    for (const k of ["D", "dI", "iavg", "sat", "vhi", "vlabel", "pulses", "vbi", "rect", "ilabel"]) {
      if (w[k] !== undefined) o.wave[k] = num(w[k]);
    }
    if (w.cap) {
      o.wave.cap = {};
      for (const k of ["kind", "C", "esr", "Vdc", "Io", "fsw", "n", "i0", "i1", "iavg", "dI"]) {
        if (w.cap[k] !== undefined) o.wave.cap[k] = num(w.cap[k]);
      }
    }
  }
  return o;
}

for (const topo of TOPOS) {
  if (!topo.design) continue;
  for (const c of casesFor(topo)) {
    test(`${topo.id} — ${c.name}`, () => {
      const res = topo.design(c.spec);
      const want = golden[topo.id] && golden[topo.id][c.name];
      assert.ok(want !== undefined,
        `no recorded output for ${topo.id} / ${c.name} — run node scripts/gen-golden.mjs`);
      same(shot(res), want);

      if (!res || res.infeasible) return;
      /* Invariants that hold regardless of what was recorded. */
      for (const [label, w] of res.loss || []) {
        assert.ok(Number.isFinite(w), `loss "${label}" is ${w}`);
        assert.ok(w >= 0, `loss "${label}" is negative (${w})`);
      }
      for (const g of res.groups || []) {
        for (const r of g.rows || []) {
          assert.ok(r[1] !== undefined && r[1] !== null, `row "${r[0]}" has no value`);
          assert.ok(!/NaN|Infinity|undefined/.test(String(r[1])),
            `row "${r[0]}" prints ${r[1]}`);
        }
      }
    });
  }
}
