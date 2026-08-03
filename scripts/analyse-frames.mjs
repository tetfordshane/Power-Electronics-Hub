/* Analysis pass over a recording made by record-animation.mjs.

   Kept separate so the continuity metrics can be changed without re-running
   the capture, and so the important one is stated properly: tracking a single
   arrow by index is misleading, because the indices rotate as the pattern
   advances and index 0 legitimately teleports by one spacing every time the
   treadmill comes round. What matters visually is whether every arrow on this
   frame is near SOME arrow on the previous one.                            */
import { readFileSync } from "fs";

const raw = JSON.parse(readFileSync(new URL("../.anim/frames.json", import.meta.url), "utf8"));
/* A perturbed recording carries the step time beside the frames; a plain one
   is still just the array it always was. */
const f = Array.isArray(raw) ? raw : raw.frames;
const steppedAt = Array.isArray(raw) ? null : raw.steppedAt;
const stats = (a) => {
  const v = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  return { min: +v[0].toFixed(2), p50: +v[Math.floor(v.length / 2)].toFixed(2), max: +v[v.length - 1].toFixed(2) };
};

console.log(`frames: ${f.length}`);
if (steppedAt > 0) console.log(`load stepped at ${(steppedAt / 1000).toFixed(2)} s — the settle is inside this recording`);

/* arrow count stability */
const counts = {};
f.forEach((s) => { counts[(s.arrows || []).length] = (counts[(s.arrows || []).length] || 0) + 1; });
let flips = 0;
for (let i = 1; i < f.length; i++) {
  if ((f[i].arrows || []).length !== (f[i - 1].arrows || []).length) flips++;
}
console.log("arrow-count distribution:", JSON.stringify(counts), "| count changes:", flips);

/* arrow field continuity */
const field = [];
for (let i = 1; i < f.length; i++) {
  const A = f[i - 1].arrows, B = f[i].arrows;
  if (!A || !B || !A.length || !B.length) continue;
  let worst = 0;
  for (const b of B) {
    let best = Infinity;
    for (const a of A) best = Math.min(best, Math.hypot(b[0] - a[0], b[1] - a[1]));
    worst = Math.max(worst, best);
  }
  field.push([i, worst, A.length === B.length]);
}
const same = field.filter((x) => x[2]);
console.log("arrow field, worst displacement per frame:", JSON.stringify(stats(same.map((x) => x[1]))));
/* An arrow may enter anywhere — a commutation mounts a whole new route, and
   the cross-fade mounts it a little BEFORE the device marks flip — but never
   at an opacity you could see. Same rule the cursor rake is held to below,
   and it is stricter than the old "was it a commutation?" excuse: since the
   overlay cross-fades, even a commutation has no right to pop. */
/* Did a mark APPEAR, or did it merely move?

   Nearest-neighbour distance alone cannot tell those apart, and the faster
   the figure is played the worse it gets: a capacitor chevron rides the
   charge integral and sprints through the zero crossing, so at six times
   speed it covers nine pixels in a frame while the flow arrows cover three.
   Held to a fixed radius it reads as a new mark every time, which buried the
   real signal under hundreds of false ones.

   Counting is what distinguishes them. If the field has no more marks than
   it had, every mark has a partner however far it travelled — nothing
   appeared, whatever the distances say. Only a field that GREW has newcomers
   in it, and only that surplus is judged. That is exactly the rule the
   figure is meant to obey: anything entering has to dissolve in. */
let orphanA = 0, orphanN = 0, grew = 0;
for (let i = 1; i < f.length; i++) {
  const A = f[i - 1].arrows, B = f[i].arrows;
  if (!A || !A.length || !B) continue;
  const surplus = B.length - A.length;
  if (surplus <= 0) continue;
  grew++;
  /* The newcomers are the surplus marks furthest from anything that was
     already there. */
  const scored = B.map((b) => {
    let best = Infinity;
    for (const a of A) best = Math.min(best, Math.hypot(b[0] - a[0], b[1] - a[1]));
    return { b, best };
  }).sort((x, y) => y.best - x.best).slice(0, surplus);
  for (const { b } of scored) {
    orphanN++;
    orphanA = Math.max(orphanA, b[2] === undefined ? 1 : b[2]);
  }
}
console.log(`  (${grew} frames added a mark; only what they added is judged)`);
console.log(`arrows appearing with no near predecessor: ${orphanN}, brightest: ${orphanA.toFixed(3)}`,
  orphanA > 0.12 ? "*** A VISIBLE POP ***" : "(all faint — they dissolve in)");

/* EMC rings: an always-mounted ring whose radius rides the time since its
   switching edge. The envelope is zero at both ends of the ride, so a ring
   that jumps in radius while visible is the emitter misfiring. */
const withRings = f.filter((s) => s.rings && s.rings.length);
if (withRings.length) {
  let worst = 0;
  for (let i = 1; i < withRings.length; i++) {
    const A = withRings[i - 1].rings, B = withRings[i].rings;
    for (let k = 0; k < B.length && k < A.length; k++) {
      const jump = Math.hypot(B[k][0] - A[k][0], B[k][1] - A[k][1]);
      if (jump > 6) worst = Math.max(worst, Math.max(B[k][2], A[k][2]));
    }
  }
  console.log(`emc rings: ${withRings[0].rings.length} emitters, brightest ring at a radius jump: ${worst.toFixed(3)}`,
    worst > 0.12 ? "*** A VISIBLE POP ***" : "(resets happen dark)");
}

/* dash travel actually reaches a whole number of dash periods */
const dmag = stats(f.map((s) => Math.abs(s.dash || 0)));
console.log("dash offset magnitude:", JSON.stringify(dmag),
  "— one period of travel is 240px = 12 whole dash periods");

/* The cursor rake. One marker per drawn period, so a marker leaving the
   right-hand edge is replaced by one entering at the left and there is no
   once-per-loop return to hide. Two things have to hold: no marker may
   appear at an opacity you could see, and the total amount of cursor on the
   plot must never fall away — that was the flaw in dissolving a single
   cursor, which left about three quarters of a second with none at all. */
const rake = f.filter((s) => s.curs && s.curs.length);
if (!rake.length) console.log("no cursor rake in this recording (topology has no waveform pane)");
else {
  let orphan = 0, step = 0, handoffs = 0;
  const presence = [];
  for (let i = 1; i < rake.length; i++) {
    const A = rake[i - 1].curs, B = rake[i].curs;
    presence.push(B.reduce((a, c) => a + c[1], 0));
    if (B[0][0] - A[0][0] < -50) handoffs++;
    for (const b of B) {
      let best = Infinity;
      for (const a of A) best = Math.min(best, Math.abs(b[0] - a[0]));
      if (best > 6) orphan = Math.max(orphan, b[1]); else step = Math.max(step, best);
    }
  }
  console.log(`cursor rake: ${rake[0].curs.length} markers, ${handoffs} hand-offs in the recording`);
  console.log("brightest marker appearing with no predecessor:", orphan.toFixed(3),
    "| worst per-frame step of a tracked marker:", step.toFixed(2) + "px");
  console.log("total cursor presence on the plot:", JSON.stringify(stats(presence)),
    "— a dip toward zero is the plot going cursor-blind");
  const w = presence.findIndex((_, i) => i > 0 && rake[i + 1].curs[0][0] - rake[i].curs[0][0] < -50);
  if (w >= 0) {
    console.log("rake across a hand-off:", rake.slice(Math.max(0, w - 2), w + 4)
      .map((s) => "[" + s.curs.map((c) => `${c[0].toFixed(0)}@${c[1].toFixed(2)}`).join(" ") + "]").join(" "));
  }
}
