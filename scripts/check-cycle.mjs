/* Assertions on the shared cycle model.

   `src/cycle.js` is a plain module with no React and no DOM, so it can be
   imported and checked directly rather than scraped out of a running page.
   These are the properties the drawing depends on being true — if any fails,
   the figure is lying about something.

   Usage: node scripts/check-cycle.mjs                                     */
import { buildCycle } from "../src/cycle.js";

let fails = 0;
const near = (a, b, tol, what) => {
  const ok = Math.abs(a - b) <= tol;
  if (!ok) { console.log(`  FAIL  ${what}: ${a} vs ${b} (tol ${tol})`); fails++; }
  return ok;
};
const mean = (M) => M.qTot;                       /* ∫i du over one period */
const sect = (t) => console.log("\n" + t);

/* ---- continuous conduction, no saturation: the textbook triangle ---- */
sect("CCM, no saturation");
{
  const M = buildCycle({ D: 0.3, dI: 3, iavg: 10 });
  near(mean(M), 10, 1e-12, "mean current equals I_avg");
  near(M.iPeak, 11.5, 1e-12, "peak = I_avg + ΔI/2");
  near(M.iValley, 8.5, 1e-12, "valley = I_avg − ΔI/2");
  near(M.iAt(0.3), 11.5, 1e-12, "peak lands at u = D");
  near(M.iAt(0), M.iAt(1), 1e-12, "closes on itself (loop seam)");
  near(M.pts.length, 3, 0, "three points — a straight triangle");
}

/* ---- saturation bends the interior but must not move the endpoints ---- */
sect("saturation");
for (const sat of [0.2, 0.5, 0.8]) {
  const M = buildCycle({ D: 0.3, dI: 3, iavg: 10, sat });
  near(mean(M), 10, 1e-9, `sat=${sat}: mean is exactly I_avg`);
  near(M.iPeak - M.iValley, 3, 1e-9, `sat=${sat}: ripple ΔI is exactly preserved`);
  near(M.iPeak, M.iMax, 1e-9, `sat=${sat}: peak tick equals the drawn maximum`);
  near(M.iValley, M.iMin, 1e-9, `sat=${sat}: valley tick equals the drawn minimum`);
  if (!(M.iPeak > 11.5)) { console.log(`  FAIL sat=${sat}: peak should float up`); fails++; }
  else console.log(`  ok    sat=${sat}: peak floats to ${M.iPeak.toFixed(3)} A (linear estimate 11.500)`);
  near(M.iAt(0), M.iAt(1), 1e-9, `sat=${sat}: closes on itself`);
  /* the whole point: the rising ramp must sit BELOW the straight line, i.e.
     it starts shallow and steepens toward the peak */
  const half = M.iAt(0.15), straight = 8.5 + (11.5 - 8.5) * 0.5;
  if (!(half < straight - 1e-6)) {
    console.log(`  FAIL  sat=${sat}: ramp is not bent (mid ${half} vs straight ${straight})`);
    fails++;
  } else {
    console.log(`  ok    sat=${sat}: midpoint of the rise sits ${(straight - half).toFixed(3)} A below the straight line`);
  }
}
{
  const M0 = buildCycle({ D: 0.3, dI: 3, iavg: 10, sat: 0 });
  const Mt = buildCycle({ D: 0.3, dI: 3, iavg: 10, sat: 1e-9 });
  near(Mt.iAt(0.15), M0.iAt(0.15), 1e-6, "sat→0 collapses to the straight line");
}

/* ---- discontinuous conduction ---- */
sect("DCM");
{
  /* I_avg below ΔI/2 — the classic light-load case */
  const M = buildCycle({ D: 0.3, dI: 3, iavg: 1 });
  if (M.mode !== "dcm") { console.log("  FAIL  mode should be dcm"); fails++; }
  near(mean(M), 1, 1e-12, "mean current still equals I_avg");
  near(M.iValley, 0, 1e-12, "valley is zero");
  near(M.iPeak, Math.sqrt(2 * 1 * 3), 1e-12, "peak = √(2·I_avg·ΔI)");
  const S = buildCycle({ D: 0.3, dI: 3, iavg: 1, sat: 0.3 });
  near(mean(S), 1, 1e-9, "DCM + saturation: mean is still I_avg");
  near(S.iMin, 0, 1e-12, "DCM + saturation: still sits exactly at zero");
  near(M.iAt(0.99), 0, 1e-12, "sits at zero late in the period");
  near(M.iAt(0), M.iAt(1), 1e-12, "closes on itself");
}
{
  /* at the boundary the two models must agree, or sweeping the load shows a
     step where none exists */
  const eps = 1e-9;
  const A = buildCycle({ D: 0.3, dI: 3, iavg: 1.5 + eps });    /* CCM side */
  const B = buildCycle({ D: 0.3, dI: 3, iavg: 1.5 - eps });    /* DCM side */
  near(A.iPeak, B.iPeak, 1e-4, "peak is continuous across the DCM boundary");
  near(A.iValley, B.iValley, 1e-4, "valley is continuous across the boundary");
  for (const u of [0.1, 0.3, 0.6, 0.9]) {
    near(A.iAt(u), B.iAt(u), 1e-4, `i(${u}) is continuous across the boundary`);
  }
}
{
  const M = buildCycle({ D: 0.3, dI: 3, iavg: 1, rect: "sync" });
  if (M.mode !== "ccm") { console.log("  FAIL  synchronous rectifier must not go DCM"); fails++; }
  else console.log("  ok    a synchronous rectifier stays continuous (current reverses instead)");
  if (!(M.iValley < 0)) { console.log("  FAIL  sync valley should go negative"); fails++; }
  else console.log(`  ok    sync valley reverses to ${M.iValley.toFixed(2)} A`);
}

/* ---- pulse topologies: trace and flow are different quantities ---- */
sect("pulse (flyback)");
{
  const M = buildCycle({ D: 0.4, dI: 2, iavg: 3, pulse: true });
  near(M.iAt(0.7), 0, 1e-12, "plotted primary current is zero after turn-off");
  near(M.iValley, 2, 1e-12, "valley tick reads the turn-on value, not zero");
  near(M.iPeak, 4, 1e-12, "peak tick reads the turn-off value");
  if (!(M.flowAt(0.7) > 0)) {
    console.log("  FAIL  flow current must be non-zero while the secondary conducts");
    fails++;
  } else {
    console.log(`  ok    flow current is ${M.flowAt(0.7).toFixed(2)} A during the off-time (secondary conducting)`);
  }
}

console.log(`\n${fails === 0 ? "all cycle-model assertions hold" : fails + " FAILING"}`);
process.exit(fails ? 1 : 0);
