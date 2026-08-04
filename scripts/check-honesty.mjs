/* Does every mark that moves still have something computed moving it?

   The honesty ladder is the app's central promise about its own figures: a
   mark varies with time only where a model computed the variation, and
   everything else gets a fixed faint presence that claims nothing. That
   promise was kept by hand until it was not — the EMC rings were sized by a
   conduction current while the note beside them described a dv/dt, because a
   current was the only quantity the drawing could reach.

   `src/ui/drivers.js` names the path behind each moving mark. This resolves
   those paths against a real solved cycle and fails when one has stopped
   arriving: a probe renamed, a view dropped at the adapter boundary, an
   events array that quietly emptied. Any of those turns a driven mark back
   into a decorative one, and none of them would throw.

   What it does NOT prove is that the drawing reads the path it declares —
   that would take parsing JSX, and the declaration would still be the thing
   under test. It proves the ground is there to stand on.

       node scripts/check-honesty.mjs                                      */
import { TOPOS } from "../src/topologies/index.js";
import { SIM } from "../src/topologies/sim/pilot.js";
import { engineFor } from "../src/engine/adapter.js";
import { DRIVERS } from "../src/ui/drivers.js";
import { defaultSpec } from "./lib/spec.mjs";

let fails = 0;
const fail = (what, msg) => { fails++; console.error(`  FAIL  ${what.padEnd(16)} ${msg}`); };

/* "sim.views.vsw" walks the view; "sim.slopeAt:vsw" calls slopeAt("vsw", u).
   Only those two shapes, because a driver that needs a third is a driver
   nobody will be able to check next year. */
function resolve(view, path) {
  const [walk, arg] = path.split(":");
  let node = view;
  for (const key of walk.split(".")) {
    if (node === null || node === undefined) return undefined;
    node = node[key];
  }
  if (arg === undefined) return node;
  if (typeof node !== "function") return undefined;
  /* Sampled somewhere unremarkable — the question is whether it answers at
     all, not what it answers. */
  return node(arg, 0.37);
}

/* One solved circuit is enough: the paths are a property of the engine's
   output shape, not of any particular converter. Buck is the plainest. */
const topo = TOPOS.find((t) => t.id === "buck");
const spec = defaultSpec(topo);
const res = topo.design(spec);
const engine = engineFor(topo, spec, res);

if (!engine || engine.kind !== "sim") {
  fail("buck", "did not simulate, so no driver can be checked at all");
} else {
  const view = engine.cycle();
  let driven = 0, presence = 0;
  for (const [mark, path] of Object.entries(DRIVERS)) {
    if (path === null) { presence++; continue; }
    driven++;
    const got = resolve(view, path);
    if (got === undefined || got === null) {
      fail(mark, `declares "${path}", which does not resolve on a solved cycle`);
      continue;
    }
    if (typeof got === "number" && !Number.isFinite(got)) {
      fail(mark, `declares "${path}", which resolved to ${got}`);
      continue;
    }
    if (Array.isArray(got) && got.length === 0) {
      fail(mark, `declares "${path}", which resolved to an empty list — `
        + "the mark would be timed by nothing");
    }
  }
  console.log(`check-honesty: ${driven} marks driven by a computed quantity, `
    + `${presence} claiming presence only`);
}

/* And the boundary itself. These are what the lenses reach through, and each
   one has been dropped or renamed at least once in this engine's life. */
if (engine && engine.kind === "sim") {
  const v = engine.cycle();
  for (const key of ["views", "events", "traces", "slopeAt"]) {
    if (!v.sim || v.sim[key] === undefined) {
      fail("adapter", `simView no longer forwards "${key}" — the lenses read it`);
    }
  }
  if (v.sim && v.sim.views && !v.sim.views.vsw) {
    fail("adapter", "no vsw view: the switch-node voltage is what the EMC lens is about");
  }
}

const simCount = Object.keys(SIM).length;
console.log(fails ? `check-honesty: ${fails} problems`
  : `check-honesty: all clear (${simCount} circuits can supply drivers)`);
process.exit(fails ? 1 : 0);
