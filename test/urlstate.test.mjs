/* The address bar is now the only place a design exists between one visit and
   the next, so the encoder has to be exactly reversible and the decoder has to
   survive whatever a URL arrives carrying. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPOS } from "../src/topologies/index.js";
import { FIELDS, order } from "../src/fields.js";
import { defaultRaw, encodeHash, decodeHash, CODES, VERSION } from "../src/urlstate.js";
import { defaultSpec } from "../scripts/lib/spec.mjs";

/* What App does with a raw map: parse, fall back, clamp, order. Duplicated
   here deliberately — if App's sanitiser and this drift apart, the test that
   says a link reproduces a design should fail. */
function specOf(raw) {
  const o = {};
  for (const [k, v] of Object.entries(raw)) {
    const F = FIELDS[k];
    const n = parseFloat(v);
    const base = Number.isFinite(n) ? n : (F ? F.d : 0);
    o[k] = F && F.mn !== undefined ? Math.min(Math.max(base, F.mn), F.mx) : base;
  }
  return order(o);
}

test("a design at its defaults produces the short link", () => {
  for (const t of TOPOS) {
    const h = encodeHash("bench", t.id, defaultRaw(t.id));
    assert.equal(h, "#/bench/" + t.id, `${t.id} should not carry a payload`);
  }
});

test("every topology round-trips an edited design exactly", () => {
  for (const t of TOPOS) {
    const raw = { ...defaultRaw(t.id) };
    /* Edit every field, so nothing can be quietly dropped. */
    for (const k of Object.keys(raw)) {
      const F = FIELDS[k];
      const bumped = Math.min(Math.max(parseFloat(raw[k]) * 1.1 + 0.01, F.mn), F.mx);
      raw[k] = String(+bumped.toPrecision(6));
    }
    const back = decodeHash(encodeHash("bench", t.id, raw));
    assert.equal(back.tab, "bench");
    assert.equal(back.tid, t.id);
    const rebuilt = { ...defaultRaw(t.id), ...(back.over || {}) };
    assert.deepEqual(rebuilt, raw, `${t.id} did not round-trip`);
    /* And the thing that actually matters: the same numbers come out. */
    assert.deepEqual(specOf(rebuilt), specOf(raw));
  }
});

test("a decoded default link rebuilds the default spec", () => {
  for (const t of TOPOS) {
    const back = decodeHash("#/bench/" + t.id);
    const rebuilt = { ...defaultRaw(t.id), ...(back.over || {}) };
    assert.deepEqual(specOf(rebuilt), defaultSpec(t),
      `${t.id} default link does not match defaultSpec`);
  }
});

test("only the edited fields travel", () => {
  const h = encodeHash("bench", "buck", { ...defaultRaw("buck"), vout: "1.2", iout: "20" });
  assert.equal(h, "#/bench/buck/" + VERSION + "/" + CODES.iout + "=20," + CODES.vout + "=1.2");
  assert.deepEqual(decodeHash(h).over, { iout: "20", vout: "1.2" });
});

test("the same design is always the same URL", () => {
  /* Same values, different insertion order — the encoder sorts, so the link
     for a given design is stable and two people describing the same design
     produce the same URL. */
  const a = encodeHash("bench", "buck", { ...defaultRaw("buck"), vout: "1.2", iout: "20" });
  const b = encodeHash("bench", "buck", { ...defaultRaw("buck"), iout: "20", vout: "1.2" });
  assert.equal(a, b, "key order must not change the link");
  assert.equal(a, "#/bench/buck/" + VERSION + "/io=20,vo=1.2");
});

test("non-bench tabs carry no payload", () => {
  assert.equal(encodeHash("cheat", "buck", { ...defaultRaw("buck"), vout: "9" }), "#/cheat");
  assert.equal(encodeHash("select", "buck", { ...defaultRaw("buck"), vout: "9" }), "#/select");
});

test("old two-segment links still work", () => {
  assert.deepEqual(decodeHash("#/bench/boost"), { tab: "bench", tid: "boost" });
  assert.deepEqual(decodeHash("#/cheat"), { tab: "cheat", tid: undefined });
});

test("anything unrecognised is dropped, never guessed at", () => {
  const cases = [
    ["#/bench/buck/9/vo=1.2", "a version this build does not know"],
    ["#/bench/buck/1/zz=1.2", "a code that names no field"],
    ["#/bench/buck/1/", "an empty payload"],
    ["#/bench/buck/1/=5", "a value with no code"],
    ["#/bench/buck/1/vo=", "a code with no value"],
    ["#/bench/buck/1/%E0%A4%A", "a malformed percent escape"],
    ["#/bench/nosuchtopo/1/vo=1.2", "a topology that does not exist"],
    ["#/nosuchtab/buck", "a tab that does not exist"],
    ["", "an empty hash"],
    ["#", "a bare hash"],
  ];
  for (const [h, why] of cases) {
    const out = decodeHash(h);          /* must not throw */
    assert.ok(!out.over || Object.keys(out.over).length === 0
      || h.includes("vo=1.2") === false, why);
  }
  assert.equal(decodeHash("#/bench/buck/9/vo=1.2").over, undefined);
  assert.equal(decodeHash("#/bench/buck/1/zz=1.2").over, undefined);
  assert.equal(decodeHash("#/nosuchtab/buck").tab, undefined);
  assert.equal(decodeHash("#/bench/nosuchtopo/1/vo=1.2").tid, undefined);
});

test("values a reader can actually type survive the trip", () => {
  /* Exponent form, a bare decimal point, and a trailing zero the input box
     keeps but a number would lose. */
  for (const v of ["1e3", ".5", "3.30", "0.0001", "12"]) {
    const h = encodeHash("bench", "buck", { ...defaultRaw("buck"), vout: v });
    assert.equal(decodeHash(h).over.vout, v, `"${v}" did not survive`);
  }
});

test("every field has a code and no two share one", () => {
  const seen = new Set();
  for (const k of Object.keys(FIELDS)) {
    assert.ok(CODES[k], `${k} has no URL code`);
    assert.ok(!seen.has(CODES[k]), `code "${CODES[k]}" is used twice`);
    seen.add(CODES[k]);
  }
});
