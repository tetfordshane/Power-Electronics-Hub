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
   ever sees ideal elements. */
export function expand(branches) {
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
  return out;
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
      case "XF":
        if (b.n.length !== 4) throw new Error(`branch ${b.id}: a transformer needs four nodes`);
        if (!(b.ratio > 0)) throw new Error(`branch ${b.id}: needs a positive ratio`);
        break;
      default: throw new Error(`branch ${b.id}: unknown type ${b.type}`);
    }
    if (b.type === "R" && !(b.value > 0)) throw new Error(`branch ${b.id}: resistance must be positive`);
  }
  return branches;
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
