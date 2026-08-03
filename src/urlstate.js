/* What the address bar carries, and how to read it back.

   The hash used to be `#/bench/buck` and nothing else, so a converter could
   be linked but a DESIGN could not: seventeen fields of work lived only in
   the tab it was typed into, and "here is the problem I am looking at" meant
   a screenshot.

   The format is `#/<tab>/<tid>/<version>/<payload>`, and the version segment
   is why it can change later. Old two-segment links still read correctly
   because the extra segments are simply absent; old READERS survive a new
   link because they destructure the first two segments and ignore the rest.
   An unknown version drops the payload rather than guessing at it.

   Two decisions worth keeping:

   Only the DIFFERENCE from the topology's defaults is encoded, using exactly
   the predicate `carryOver` already uses for "the reader edited this" — so a
   design at its defaults still produces the short, shareable two-segment
   link, and the payload never carries seventeen fields to say nothing.

   The values are RAW STRINGS, not parsed numbers. They round-trip the input
   boxes byte-for-byte, and every value entering the app still goes through
   the one parse-clamp-order path in App, so a hand-edited URL cannot reach a
   state the reader could not have typed.                                  */
import { FIELDS } from "./fields.js";
import { TOPOS } from "./topologies/index.js";

export const VERSION = "1";
export const TABS = ["bench", "cheat", "select"];

/* A short code per field, because `#/bench/buck/1/vinNom=12,vout=3.3,iout=20`
   is most of a tweet before it has said anything. These are permanent: a code
   that changes silently invalidates every link anyone has saved. check-registry
   holds them to a bijection with FIELDS. */
export const CODES = {
  vacIn: "vai", idc: "idc", cbulk: "cb", vsec: "vs", dnom: "dn", ql: "ql", vg: "vg",
  vinMin: "vi1", vinNom: "vin", vinMax: "vi2", vout: "vo", iout: "io", fsw: "f",
  r: "r", dvout: "dvo", eff: "eff", esr: "esr", lsag: "lsg", rds: "rds", rdsS: "rd2",
  vf: "vf", qrr: "qrr", dcr: "dcr", tsw: "tsw", qg: "qg", nph: "nph", dmax: "dmx",
  krp: "krp", pout: "po", vbus: "vb", vacMin: "va1", vacMax: "va2", fline: "fl",
  thold: "th", vbusMin: "vb1", fr: "fr", ln: "ln", qf: "qf", vdc: "vdc", vac: "vac",
  fo: "fo", v2: "v2", phi: "phi", lr: "lr", nstg: "nst", cfly: "cfy", ncell: "ncl",
  td: "td", coss: "cos", llk: "llk", vclamp: "vcl",
};
const BY_CODE = Object.fromEntries(Object.entries(CODES).map(([k, c]) => [c, k]));

/* The raw-string defaults for a topology: what the input boxes hold before
   anyone touches them. Lives here rather than in the UI because the encoder,
   the scripts and the tests all need it, and two implementations of "what is
   the default" is exactly the drift this app keeps designing out. */
export function defaultRaw(tid) {
  const t = TOPOS.find((q) => q.id === tid);
  const o = {};
  if (!t) return o;
  for (const k of t.fields || []) {
    if (!FIELDS[k]) continue;
    const dv = t.defs && t.defs[k] !== undefined ? t.defs[k] : FIELDS[k].d;
    o[k] = String(dv);
  }
  return o;
}

/* The fields the reader actually changed, as {key: rawString}. */
export function diffFromDefaults(tid, raw) {
  const def = defaultRaw(tid);
  const out = {};
  for (const k of Object.keys(def)) {
    if (raw && raw[k] !== undefined && raw[k] !== def[k]) out[k] = raw[k];
  }
  return out;
}

export function encodeHash(tab, tid, raw) {
  const base = "#/" + tab + (tab === "bench" ? "/" + tid : "");
  if (tab !== "bench") return base;
  const diff = diffFromDefaults(tid, raw);
  const parts = Object.keys(diff)
    .filter((k) => CODES[k])
    .sort()                      /* stable, so the same design is the same URL */
    .map((k) => CODES[k] + "=" + encodeURIComponent(diff[k]));
  return parts.length ? base + "/" + VERSION + "/" + parts.join(",") : base;
}

/* Tolerant by design. Anything unrecognised is dropped rather than guessed
   at, and the caller is left with a valid state it can render. */
export function decodeHash(hash) {
  const h = String(hash || "").replace(/^#\/?/, "");
  if (!h) return {};
  const seg = h.split("/");
  const tab = TABS.includes(seg[0]) ? seg[0] : undefined;
  const tid = seg[1] && TOPOS.some((t) => t.id === seg[1]) ? seg[1] : undefined;
  const out = { tab, tid };
  if (!tid || seg[2] !== VERSION || !seg[3]) return out;
  const over = {};
  for (const pair of seg.slice(3).join("/").split(",")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const key = BY_CODE[pair.slice(0, eq)];
    if (!key) continue;
    let v;
    try { v = decodeURIComponent(pair.slice(eq + 1)); } catch { continue; }
    /* Left as a string and left unclamped: App sanitises every value it is
       given, and doing it twice in two places is how the two come to
       disagree. */
    if (v !== "") over[key] = v;
  }
  if (Object.keys(over).length) out.over = over;
  return out;
}
