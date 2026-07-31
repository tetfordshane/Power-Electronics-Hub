/* Flow-overlay geometry checks — no browser, no dev server.
 *
 * The animated overlay draws hand-authored polylines over a schematic whose
 * inductors are drawn by helpers. Nothing ties the two together at author
 * time, which is how four topologies shipped with the current stopping dead
 * at an inductor terminal while the phase note said it was continuous, and
 * how two opaque polarity discs sat close enough to a conducting path to
 * notch it. This script derives both sides from the same sources the app
 * uses — the FLOW/SCH literals in src/PowerStage.jsx, and the real geometry
 * code in src/flowgeo.js — and asserts:
 *
 *   1. every coil is spliced (dashes routed over its arcs) in at least one
 *      phase, unless it is on the reviewed never-animated list;
 *   2. the pol-marked inductor — the one whose current the waveform plots,
 *      continuous by definition — is spliced in EVERY phase that draws a
 *      conducting path;
 *   3. the specific regressions this pass fixed stay fixed (buckboost,
 *      classe, doubler, psfb);
 *   4. no opaque polarity disc sits within 11 px of any conducting, dim or
 *      capacitor path (8 px disc radius + max dash half-width + margin);
 *   5. coilSplice output preserves endpoints, emits M/L only, adds exactly
 *      the arc length it should, and still measures monotonically;
 *   6. every FLOW w/h matches its schematic's viewBox, and the overlay
 *      inset in styles.js matches the schematic's border + padding.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { polySegs, polyPoints, coilSplice, coilsOnSegment, distToPath }
  from "../src/flowgeo.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, "src", "PowerStage.jsx"), "utf8");
const css = readFileSync(join(root, "src", "styles.js"), "utf8");

let fails = 0;
const fail = (msg) => { fails++; console.error("  FAIL  " + msg); };

/* ---------------- slice a brace-balanced block out of the source -------- */
function balanced(text, open, close, from) {
  let depth = 0, i = from;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(from, i + 1);
  }
  throw new Error("unbalanced block at " + from);
}

/* ---------------- the schematics: viewBox + coil registry --------------- */
/* The same expansion the app performs at draw time: Lh/Lv record themselves,
 * and Xf/XfCT are built from Lv with these exact placements (PowerStage.jsx
 * defines them once; a change there must be mirrored here or check 5's
 * length identity starts failing, which is the alarm working). */
const coilH = (x, y, n = 4, r = 9, b = 1) =>
  ({ axis: "h", y, x0: x, x1: x + 2 * n * r, r, n, bulge: b });
const coilV = (x, y, n = 4, r = 9, bulge = 1) =>
  ({ axis: "v", x, y0: y, y1: y + 2 * n * r, r, n, bulge });

const SCH_META = {};
{
  const schStart = src.indexOf("const SCH = {");
  const schBlock = balanced(src, "{", "}", src.indexOf("{", schStart));
  /* <SV> defaults w=660 h=240 (see the SV component); either may be omitted */
  const entryRe = /(\w+): \(\) => <SV( w=\{(\d+)\})?( h=\{(\d+)\})?>/g;
  let m;
  const entries = [];
  while ((m = entryRe.exec(schBlock)) !== null) {
    entries.push({ id: m[1], w: m[3] ? +m[3] : 660, h: m[5] ? +m[5] : 240, at: m.index });
  }
  entries.forEach((e, i) => {
    const body = schBlock.slice(e.at, i + 1 < entries.length ? entries[i + 1].at : undefined);
    const coils = [];
    for (const c of body.matchAll(/\{Lh\(([\d\s.,-]+)\)\}/g)) coils.push(coilH(...c[1].split(",").map(Number)));
    for (const c of body.matchAll(/\{Lv\(([\d\s.,-]+)\)\}/g)) coils.push(coilV(...c[1].split(",").map(Number)));
    /* Transformer windings are exempt from the every-coil-animated rule:
       the paths deliberately stop at winding terminals on the isolated
       side, and which windings a path DOES traverse (a push-pull primary
       half) is asserted through the splice like any other coil. */
    for (const c of body.matchAll(/\{Xf\(([\d\s.,-]+)\)\}/g)) {
      const [x, y, h = 64] = c[1].split(",").map(Number);
      coils.push({ ...coilV(x, y, 4, h / 8, -1), xf: true },
        { ...coilV(x + 24, y, 4, h / 8, 1), xf: true });
    }
    for (const c of body.matchAll(/\{XfCT\(([\d\s.,-]+)\)\}/g)) {
      const [x, y, h = 80] = c[1].split(",").map(Number);
      coils.push({ ...coilV(x, y, 4, h / 8, -1), xf: true },
        { ...coilV(x + 24, y, 2, h / 8, 1), xf: true },
        { ...coilV(x + 24, y + h / 2, 2, h / 8, 1), xf: true });
    }
    SCH_META[e.id] = { w: e.w, h: e.h, coils };
  });
}

/* ---------------- the FLOW table: paths, discs, dimensions -------------- */
const FLOW_META = {};
{
  const flowStart = src.indexOf("const FLOW = {");
  const flowBlock = balanced(src, "{", "}", src.indexOf("{", flowStart));
  const entryRe = /(\w+): \{ w: (\d+), h: (\d+)/g;
  let m;
  const entries = [];
  while ((m = entryRe.exec(flowBlock)) !== null) {
    entries.push({ id: m[1], w: +m[2], h: +m[3], at: m.index });
  }
  const strings = (block, key) => {
    const at = block.indexOf(key + ": [");
    if (at < 0) return [];
    const arr = balanced(block, "[", "]", block.indexOf("[", at));
    return [...arr.matchAll(/"([^"]+)"/g)].map((s) => s[1]);
  };
  entries.forEach((e, i) => {
    const body = flowBlock.slice(e.at, i + 1 < entries.length ? entries[i + 1].at : undefined);
    const polM = body.match(/pol: \[([\d\s.,-]+)\]/);
    const phAt = body.indexOf("ph: [");
    const phArr = balanced(body, "[", "]", body.indexOf("[", phAt));
    /* phases are the top-level { } blocks of the ph array */
    const phases = [];
    let depth = 0, s0 = -1;
    for (let k = 1; k < phArr.length - 1; k++) {
      const ch = phArr[k];
      if (ch === "{") { if (depth === 0) s0 = k; depth++; }
      else if (ch === "}") { if (--depth === 0) phases.push(phArr.slice(s0, k + 1)); }
    }
    FLOW_META[e.id] = {
      w: e.w, h: e.h,
      pol: polM ? polM[1].split(",").map(Number) : null,
      capFlow: strings(body.slice(0, phAt), "capFlow"),
      ph: phases.map((p) => ({ d: strings(p, "d"), dim: strings(p, "dim") })),
    };
  });
}

const ids = Object.keys(FLOW_META);
console.log(`check-flow: ${ids.length} topologies`);

/* Which coils a spliced path actually climbed: every coil whose interval is
 * fully contained in one of the RAW path's segments — the same containment
 * rule coilSplice itself applies. */
function splicedCoils(rawD, coils) {
  const hit = new Set();
  const pts = polyPoints(rawD);
  for (let i = 1; i < pts.length; i++) {
    for (const c of coilsOnSegment(pts[i - 1], pts[i], coils)) hit.add(c);
  }
  return hit;
}

/* Coils reviewed as legitimately never animated, keyed by topology and the
 * coil's own anchor coordinate. Everything here is either a transformer
 * winding the paths deliberately stop at, a resonant-tank element listed in
 * `dim`, or an interleaved leg the figure animates only one of. Remove an
 * entry when a path is taught to traverse it — check 1 will insist. */
const NEVER = {};
const never = (id, ...anchors) => { NEVER[id] = new Set(anchors.map(String)); };
const anchorOf = (c) => String(c.axis === "h" ? [c.x0, c.y] : [c.x, c.y0]);
/* class-E push-pull: the two tank inductors, drawn dim in every phase —
   resonant elements whose current the figure deliberately does not animate */
never("classepp", "380,60", "380,240");
/* centre-tapped secondaries drawn with bare Lv rather than XfCT (the tap
   layout differs per schematic); like every isolated winding, the paths
   stop at their terminals */
never("pushpull", "324,70", "324,140");
never("halfbridge", "364,105", "364,139");
never("psfb", "454,120", "454,154");
never("llc", "424,118", "424,152");

/* run once leniently to report, then encode the reviewed list below */
const REPORT = process.argv.includes("--report");

/* ---- 6. static dimensions first: everything else assumes alignment ----- */
for (const id of ids) {
  const F = FLOW_META[id], S = SCH_META[id];
  if (!S) { fail(`${id}: FLOW entry with no schematic`); continue; }
  if (F.w !== S.w || F.h !== S.h) {
    fail(`${id}: FLOW ${F.w}x${F.h} != SCH viewBox ${S.w}x${S.h}`);
  }
}
if (!/\.ps \.flowov\{position:absolute; left:9px; right:9px; top:9px; bottom:9px/.test(css)) {
  fail("styles.js: .flowov inset is not 9px on all sides");
}
if (!/\.ps \.sch\{\s*[^}]*border:1px solid[^}]*padding:8px/.test(css)) {
  fail("styles.js: .sch border+padding no longer 1px+8px — realign .flowov");
}

/* ---- per-topology checks ---------------------------------------------- */
for (const id of ids) {
  const F = FLOW_META[id], S = SCH_META[id];
  if (!S) continue;
  const coils = S.coils;
  const everSpliced = new Set();

  F.ph.forEach((p, pi) => {
    for (const raw of [...p.d, ...p.dim]) {
      /* 5. splice invariants, on every path whether or not it hits a coil */
      const spliced = coilSplice(raw, coils);
      const hit = splicedCoils(raw, coils);
      for (const c of hit) everSpliced.add(c);
      if (spliced !== raw) {
        if (!/^M [\d. -]+ L[\d. -]+$/.test(spliced)) {
          fail(`${id} ph${pi}: spliced path is not M/L-only: ${spliced.slice(0, 40)}…`);
        }
        const a = polyPoints(raw), b = polyPoints(spliced);
        const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
        if (!same(a[0], b[0]) || !same(a[a.length - 1], b[b.length - 1])) {
          fail(`${id} ph${pi}: splice moved a path endpoint`);
        }
        /* each spliced coil replaces its chord 2nr with n semicircles,
           inscribed as 8 chords each — 16·r·sin(π/16) per semicircle */
        const arc = 16 * Math.sin(Math.PI / 16);
        const extra = [...hit].reduce((t, c) => t + c.n * c.r * (arc - 2), 0);
        const dl = polySegs(spliced).total - polySegs(raw).total;
        /* 0.2 absolute: the splice writes coordinates to 2 decimals */
        if (Math.abs(dl - extra) > 0.2 + extra * 0.005) {
          fail(`${id} ph${pi}: splice added ${dl.toFixed(2)} of path, expected ≈${extra.toFixed(2)}`);
        }
        let last = -1;
        for (const g of polySegs(spliced).segs) {
          if (g.at <= last) { fail(`${id} ph${pi}: non-monotone measurement after splice`); break; }
          last = g.at;
        }
      }
    }

    /* 4. disc clearance, against the geometry actually drawn */
    if (F.pol) {
      const paths = [...p.d, ...p.dim].map((raw) => polySegs(coilSplice(raw, coils)))
        .concat(F.capFlow.map((d) => polySegs(d)));
      for (const [px, py, tag] of [[F.pol[0], F.pol[1], "A"], [F.pol[2], F.pol[3], "B"]]) {
        for (const g of paths) {
          const dist = distToPath(px, py, g);
          if (dist < 11) {
            fail(`${id} ph${pi}: pol disc ${tag} (${px},${py}) is ${dist.toFixed(1)} px from a drawn path (need 11)`);
          }
        }
      }
    }
  });

  /* 2. the plotted inductor must carry dashes in every conducting phase */
  if (F.pol) {
    const [ax, ay, bx, by] = F.pol;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    let plotted = null, best = Infinity;
    for (const c of coils) {
      const cx = c.axis === "h" ? (c.x0 + c.x1) / 2 : c.x;
      const cy = c.axis === "h" ? c.y : (c.y0 + c.y1) / 2;
      const d = Math.hypot(cx - mx, cy - my);
      if (d < best) { best = d; plotted = c; }
    }
    F.ph.forEach((p, pi) => {
      if (!p.d.length) return;
      const hit = p.d.some((raw) => splicedCoils(raw, coils).has(plotted));
      if (!hit) {
        fail(`${id} ph${pi}: the pol-marked inductor at ${anchorOf(plotted)} carries no dashes this phase`);
      }
    });
  }

  /* 1. every coil animated somewhere, or reviewed as never-animated */
  for (const c of coils) {
    if (everSpliced.has(c) || c.xf) continue;
    if (NEVER[id] && NEVER[id].has(anchorOf(c))) continue;
    if (REPORT) console.log(`  never-spliced  ${id}  ${c.axis} @ ${anchorOf(c)}`);
    else fail(`${id}: coil ${c.axis} @ ${anchorOf(c)} is never traversed by any phase (add a path or review into NEVER)`);
  }
}

/* ---- 3. the four regressions this pass fixed stay fixed ---------------- */
const mustSplice = (id, pi, anchor) => {
  const F = FLOW_META[id], S = SCH_META[id];
  const c = S.coils.find((k) => anchorOf(k) === String(anchor));
  if (!c) return fail(`${id}: no coil at ${anchor}`);
  if (!F.ph[pi].d.some((raw) => splicedCoils(raw, S.coils).has(c))) {
    fail(`${id} ph${pi}: expected the coil at ${anchor} to carry current`);
  }
};
mustSplice("buckboost", 1, [215, 92]);   /* Q1 off: L freewheels through D1 */
mustSplice("classe", 1, [90, 60]);       /* switch off: choke current continues */
mustSplice("doubler", 0, [310, 200]);    /* winding positive: L2 freewheels */
mustSplice("doubler", 1, [310, 80]);     /* winding negative: L1 freewheels */
mustSplice("psfb", 1, [350, 150]);       /* first ZVS transition drives L_r */
mustSplice("psfb", 4, [350, 150]);       /* …and so does its mirror */

if (fails) { console.error(`check-flow: ${fails} failure(s)`); process.exit(1); }
console.log("check-flow: all clear");
