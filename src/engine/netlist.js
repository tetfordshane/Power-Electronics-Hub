/* What a topology hands the simulator: a circuit, not a waveform.

   This is the honest replacement for the per-phase conduction bitmaps in
   FLOW. Those say "during this phase, Q1 is on and D1 is off" — a claim
   authored by hand, correct until an operating point moves and nobody
   re-derives it. A netlist says what is connected to what, and which device
   conducts becomes something the solver works out from the circuit.

   Branch types:
     V   independent voltage source          value = volts
     I   independent current source          value = amps, n[0] → n[1]
     R   resistor                            value = ohms
     L   inductor        state: its current  value = henries, optional esr
     C   capacitor       state: its voltage  value = farads, optional esr
     SW  commanded switch                    ron / roff, gate names a schedule
     D   diode                               ron / roff / vf
     XF  ideal transformer                   ratio = N_primary : N_secondary

   `n` lists the nodes a branch touches, primary pair first. Node "0" or
   "gnd" is the reference. Nodes are named, not numbered, because a netlist
   is read far more often than it is written.

   Series resistance is expanded into its own branch and its own internal
   node rather than folded into a state equation. It costs one unknown and
   buys the thing that folding it away loses: the capacitor's terminal
   voltage and its internal voltage become separately visible, so ESR ripple
   appears on the output because the model has an ESR, not because someone
   added ΔI·ESR to the answer afterwards. */

export const GROUND = new Set(["0", "gnd", "GND", ""]);

const need = (b, k) => {
  if (b[k] === undefined || b[k] === null) throw new Error(`branch ${b.id}: no ${k}`);
  return b[k];
};

/* Expand series parasitics into real branches, so the compiler below only
   ever sees ideal elements.

   `isolated` names the reference node of each galvanically separate section —
   a transformer secondary that has its own ground. Each one gets an explicit
   1 GΩ tie to the reference, because the alternative is a matrix that is
   singular for a reason nothing in the netlist admits to. A real supply has
   this too: the Y-capacitor and the leakage that make an isolated secondary's
   potential defined rather than floating. Stating it costs one word and one
   branch; leaving it out used to cost an afternoon. */
export function expand(branches, opts = {}) {
  const out = [];
  for (const b of branches) {
    if ((b.type === "L" || b.type === "C") && b.esr > 0) {
      const mid = `${b.id}$int`;
      out.push({ ...b, esr: 0, n: [b.n[0], mid] });
      out.push({ id: `${b.id}$esr`, type: "R", n: [mid, b.n[1]], value: b.esr });
    } else {
      out.push(b);
    }
  }
  for (const nm of opts.isolated || []) {
    if (GROUND.has(nm)) continue;
    out.push({ id: `${nm}$ref`, type: "R", n: [nm, "0"], value: 1e9 });
  }
  return out;
}

/* Which branch types put anything into Y at their own nodes.

   An inductor does not: it is stamped as a current source of its own state
   (mna.js), so it contributes to Mx and nothing to Y. A node attached to
   nothing but inductors therefore has an all-zero row, and the matrix is
   singular — which surfaces as `compile()` returning null and, until this
   check existed, as a TypeError reading `.A` of it, several files away and
   naming nothing. A current source is the same story. */
const FEEDS_Y = new Set(["R", "SW", "D", "V", "C", "XF"]);

/* The checks that are about the shape of the circuit rather than the values
   in it. Run on the EXPANDED netlist: an inductor carrying an ESR becomes an
   inductor plus a resistor, and judging the raw list would report a node as
   inductor-only when the expansion is about to give it a resistor.

   These are deliberately not exhaustive. A structural test cannot prove a
   matrix non-singular in general — that is what the all-off compile in
   makeSolver does, exactly and at the cost of one LU. What these buy is a
   message that names the node, for the handful of mistakes that are actually
   made when writing a netlist by hand. */
export function structure(net, opts = {}) {
  const refs = new Set([...(opts.isolated || [])]);
  const isRef = (nm) => GROUND.has(nm) || refs.has(nm);

  if (!net.some((b) => b.n.some((nm) => GROUND.has(nm)))) {
    throw new Error("netlist: nothing is connected to ground");
  }

  const deg = new Map(), feeds = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const b of net) {
    for (const nm of b.n) {
      if (GROUND.has(nm)) continue;
      bump(deg, nm);
      if (FEEDS_Y.has(b.type)) bump(feeds, nm);
    }
  }
  for (const [nm, d] of deg) {
    if (d < 2) throw new Error(`netlist: node "${nm}" is a dead end — only one branch reaches it`);
  }
  for (const nm of deg.keys()) {
    if (!feeds.has(nm)) {
      throw new Error(`netlist: node "${nm}" is attached only to inductors or current sources, `
        + "so its row of the conductance matrix is empty and the circuit has no solution. "
        + "Give it a resistor, a capacitor, or a path to a source.");
    }
  }

  /* Galvanic islands. A transformer couples magnetically, so it joins nothing
     here: its primary and its secondary are separate sections on purpose, and
     that is exactly the case a reader gets wrong. */
  const parent = new Map();
  const find = (a) => {
    if (!parent.has(a)) parent.set(a, a);
    while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); }
    return a;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const key = (nm) => (GROUND.has(nm) ? "0" : nm);
  for (const b of net) {
    if (b.type === "XF") continue;
    for (let i = 1; i < b.n.length; i++) union(key(b.n[0]), key(b.n[i]));
  }
  const islands = new Map();
  for (const b of net) for (const nm of b.n) {
    const r = find(key(nm));
    if (!islands.has(r)) islands.set(r, new Set());
    islands.get(r).add(nm);
  }
  for (const members of islands.values()) {
    if ([...members].some(isRef)) continue;
    const all = [...members].sort();
    /* Suggest a node the author actually wrote. Expansion invents `$int`
       nodes for series parasitics, and telling someone to declare one of
       those sends them looking for a name that is not in their netlist. */
    const suggest = all.find((nm) => !nm.includes("$")) || all[0];
    throw new Error(`netlist: nodes {${all.join(", ")}} form a section with no reference — `
      + "nothing fixes their potential, so the matrix is singular. Tie one to ground, "
      + `or if the section really is isolated, declare it: isolated: ["${suggest}"]`);
  }
  return net;
}

export function validate(branches) {
  const seen = new Set();
  for (const b of branches) {
    if (!b.id) throw new Error("a branch with no id");
    if (seen.has(b.id)) throw new Error(`duplicate branch id ${b.id}`);
    seen.add(b.id);
    if (!Array.isArray(b.n) || b.n.length < 2) throw new Error(`branch ${b.id}: needs two nodes`);
    switch (b.type) {
      case "V": case "I": case "R": need(b, "value"); break;
      case "L": case "C":
        if (!(need(b, "value") > 0)) throw new Error(`branch ${b.id}: value must be positive`);
        /* A saturating winding needs both halves of the claim: how much
           inductance is lost, and the current it is lost at. One without the
           other describes nothing. */
        if (b.sat !== undefined && b.sat !== 0) {
          if (b.type !== "L") throw new Error(`branch ${b.id}: only an inductor saturates`);
          if (!(b.sat > 0 && b.sat < 1)) throw new Error(`branch ${b.id}: sat must be between 0 and 1`);
          if (!(b.iref > 0)) throw new Error(`branch ${b.id}: sat needs a reference current`);
        }
        break;
      case "SW": case "D":
        if (!(b.ron > 0)) throw new Error(`branch ${b.id}: needs a positive ron`);
        if (!(b.roff > b.ron)) throw new Error(`branch ${b.id}: roff must exceed ron`);
        break;
      case "XF": {
        if (b.n.length !== 4) throw new Error(`branch ${b.id}: a transformer needs four nodes`);
        if (!(b.ratio > 0)) throw new Error(`branch ${b.id}: needs a positive ratio`);
        if (b.n[0] === b.n[1]) throw new Error(`branch ${b.id}: primary terminals are the same node`);
        if (b.n[2] === b.n[3]) throw new Error(`branch ${b.id}: secondary terminals are the same node`);
        if (b.n[0] === b.n[2] && b.n[1] === b.n[3]) {
          throw new Error(`branch ${b.id}: primary and secondary are the same pair of nodes`);
        }
        /* The dot convention, in words, next to the wiring that implements it.
           A flyback secondary is anti-phase and a forward secondary is not —
           that single fact is the whole difference between the two converters,
           and it is expressed here only as the ORDER of two node names. Wired
           the wrong way round a flyback still converges, still regulates, and
           reads about 20 % high; nothing downstream notices. Saying which was
           meant lets check-sim compare the claim against the winding currents
           the solver produced. */
        if (b.phase !== "aiding" && b.phase !== "opposing") {
          throw new Error(`branch ${b.id}: a transformer must declare phase: "aiding" or `
            + '"opposing" — which way the secondary is wound relative to the primary');
        }
        break;
      }
      default: throw new Error(`branch ${b.id}: unknown type ${b.type}`);
    }
    if (b.type === "R" && !(b.value > 0)) throw new Error(`branch ${b.id}: resistance must be positive`);
  }
  compositions(branches);
  return branches;
}

/* Transformers with more than two windings, composed rather than stamped.

   A centre tap is two windings sharing a core, and a push-pull has four. The
   element here couples exactly two, so the way to say "four windings" is
   several XF branches that all name the SAME winding as their primary: each
   one relates one other winding to that reference, and the ampere-turns come
   out right because each secondary carries −r·i_p of its own primary current
   and those primary currents add in the reference winding. That is composition
   with the least-exercised stamp in mna.js left alone, which is worth a lot.

   What composition can get wrong, and stamping cannot, is agreement. Three
   branches describing one core have to describe the SAME core: the same
   reference winding, written the same way round, wound the same way. One half
   of a centre tap listed with its terminals swapped is a winding that bucks
   its neighbour instead of continuing it — the two halves cancel, the rectifier
   that should be idle conducts alongside the one that should not, and the
   converter still runs and still regulates, to roughly twice the voltage. So
   the group is checked here, where the claim is written, rather than being
   left to be noticed downstream as a number that looks a bit high. */
function compositions(branches) {
  const groups = new Map();
  for (const b of branches) {
    if (b.type !== "XF") continue;
    const k = [...b.n.slice(0, 2)].sort().join(" ");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const [first] = g;
    for (const b of g.slice(1)) {
      if (b.n[0] !== first.n[0] || b.n[1] !== first.n[1]) {
        throw new Error(`branch ${b.id}: shares a winding with ${first.id} but names its `
          + `terminals the other way round (${b.n[0]}, ${b.n[1]} against ${first.n[0]}, `
          + `${first.n[1]}). One winding is one direction — write it the same way in both, `
          + "and swap the secondary if that is what was meant.");
      }
      if (b.phase !== first.phase) {
        throw new Error(`branch ${b.id}: declares phase "${b.phase}" where ${first.id}, on the `
          + `same winding, declares "${first.phase}". Windings on one core are wound one way `
          + "or the other relative to it; a centre tap's two halves are both continuations of "
          + "the same turn direction and share a phase.");
      }
      if (b.n[2] === first.n[2] && b.n[3] === first.n[3]) {
        throw new Error(`branch ${b.id}: couples the same pair of nodes as ${first.id}, so it `
          + "is a second copy of one winding rather than a second winding.");
      }
    }
  }
}

/* An index of everything the compiler and the solver need to agree about:
   which branches carry states, which can switch, and what the nodes are. */
export function indexOf(branches) {
  const nodes = new Map();          /* name → row, ground excluded */
  const addNode = (nm) => {
    if (GROUND.has(nm)) return -1;
    if (!nodes.has(nm)) nodes.set(nm, nodes.size);
    return nodes.get(nm);
  };
  for (const b of branches) for (const nm of b.n) addNode(nm);

  const states = [];                /* {branch, kind: "L"|"C"} in state order */
  const switches = [];              /* SW and D, in conduction-vector order */
  const sources = [];               /* V and I, in input-vector order */
  for (const b of branches) {
    if (b.type === "L") states.push({ b, kind: "L" });
    else if (b.type === "C") states.push({ b, kind: "C" });
    if (b.type === "SW" || b.type === "D") switches.push(b);
    if (b.type === "V" || b.type === "I") sources.push(b);
  }
  return { nodes, states, switches, sources, branches };
}
