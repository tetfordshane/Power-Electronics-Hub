/* Modified nodal analysis: a netlist plus a conduction state, compiled into
   the linear system that configuration obeys.

   The method is standard and the reason for choosing it is not. Each
   switching configuration of a converter is a linear circuit, so it has an
   exact state-space form ẋ = Ax + Bu — but writing those matrices by hand
   for every configuration of every topology means well over a hundred
   hand-derived matrix pairs with nothing to check them against, which is the
   parallel-registry problem again in a place where a sign error looks like
   physics. Deriving them from the connectivity means the circuit is the
   single source of truth, and the netlist is small enough to read.

   How the states enter:
     an inductor is replaced by a current source of its own state current
     a capacitor is replaced by a voltage source of its own state voltage

   That substitution turns the dynamic circuit into a resistive one for the
   instant being solved. Solving it gives every node voltage and branch
   current, and from those the state derivatives: the voltage across an
   inductor is what drives di/dt, the current through a capacitor is what
   drives dv/dt.

   States never appear or disappear. An open switch is a large resistance
   rather than a removed branch, so the system keeps its dimension and its
   invertibility no matter which devices are conducting — a circuit that
   would be disconnected in the ideal limit is merely very stiff here, which
   is exactly the case the exact discretisation in linalg.js handles. */
import { zeros, lu, luSolve } from "./linalg.js";
import { GROUND, indexOf } from "./netlist.js";

/* Conduction state: a map of branch id → boolean, for SW and D branches.
   The resistance a device presents, given that state. */
const resistOf = (b, on) => (on ? b.ron : b.roff);

/* Compile one configuration.

   Returns the matrices plus the machinery to read any node voltage or branch
   current back out, because the animation needs volts on nodes and amps
   through devices — the two things the old model never had. */
export function compile(branches, cond) {
  const idx = indexOf(branches);
  const { nodes, states, sources } = idx;
  const N = nodes.size;
  const nx = states.length;
  const nu = sources.length;

  /* Extra unknowns: one current per branch that fixes a voltage. */
  const extras = [];
  for (const b of branches) {
    if (b.type === "V") extras.push({ b, kind: "V" });
    else if (b.type === "C") extras.push({ b, kind: "C" });
    else if (b.type === "XF") extras.push({ b, kind: "XF" });
  }
  const ne = extras.length;
  const n = N + ne;
  const row = (nm) => (GROUND.has(nm) ? -1 : nodes.get(nm));

  /* Y z = Mx·x + Mu·u,  z = [node voltages ; extra branch currents] */
  const Y = zeros(n, n);
  const Mx = zeros(n, nx);
  const Mu = zeros(n, nu);

  const stamp = (a, b, g) => {
    if (a >= 0) Y[a][a] += g;
    if (b >= 0) Y[b][b] += g;
    if (a >= 0 && b >= 0) { Y[a][b] -= g; Y[b][a] -= g; }
  };
  /* A current of `c` units leaving node a and entering node b. */
  const inject = (M, a, b, col, c) => {
    if (a >= 0) M[a][col] -= c;
    if (b >= 0) M[b][col] += c;
  };

  let xi = 0, ui = 0, ei = 0;
  const stateOf = new Map(), extraOf = new Map(), inputOf = new Map();
  for (const s of states) stateOf.set(s.b.id, xi++);
  for (const s of sources) inputOf.set(s.id, ui++);
  for (const e of extras) extraOf.set(e.b.id, N + ei++);

  for (const b of branches) {
    const a = row(b.n[0]), c = row(b.n[1]);
    switch (b.type) {
      case "R": stamp(a, c, 1 / b.value); break;

      /* A conducting device is its on-resistance; a blocking one is its off-
         resistance. Any forward drop is an affine term, handled below. */
      case "SW": case "D": stamp(a, c, 1 / resistOf(b, !!cond[b.id])); break;

      case "L": {
        /* current source of the state current, flowing n0 → n1 */
        inject(Mx, a, c, stateOf.get(b.id), 1);
        break;
      }

      case "C": {
        /* voltage source of the state voltage: v(n0) − v(n1) = x */
        const k = extraOf.get(b.id);
        if (a >= 0) { Y[a][k] += 1; Y[k][a] += 1; }
        if (c >= 0) { Y[c][k] -= 1; Y[k][c] -= 1; }
        Mx[k][stateOf.get(b.id)] += 1;
        break;
      }

      case "V": {
        const k = extraOf.get(b.id);
        if (a >= 0) { Y[a][k] += 1; Y[k][a] += 1; }
        if (c >= 0) { Y[c][k] -= 1; Y[k][c] -= 1; }
        Mu[k][inputOf.get(b.id)] += 1;
        break;
      }

      case "I": inject(Mu, a, c, inputOf.get(b.id), 1); break;

      case "XF": {
        /* Ideal transformer, primary (n0,n1), secondary (n2,n3), ratio r.
             v_p = r · v_s        and       i_s = −r · i_p
           The unknown is the primary current i_p, flowing into n0. */
        const r = b.ratio;
        const p0 = row(b.n[0]), p1 = row(b.n[1]);
        const s0 = row(b.n[2]), s1 = row(b.n[3]);
        const k = extraOf.get(b.id);
        /* KCL: i_p through the primary, −r·i_p through the secondary */
        if (p0 >= 0) Y[p0][k] += 1;
        if (p1 >= 0) Y[p1][k] -= 1;
        if (s0 >= 0) Y[s0][k] -= r;
        if (s1 >= 0) Y[s1][k] += r;
        /* constraint: (v_p0 − v_p1) − r(v_s0 − v_s1) = 0 */
        if (p0 >= 0) Y[k][p0] += 1;
        if (p1 >= 0) Y[k][p1] -= 1;
        if (s0 >= 0) Y[k][s0] -= r;
        if (s1 >= 0) Y[k][s1] += r;
        break;
      }
      default: break;
    }
  }

  /* Forward drops of conducting diodes: constants, so they need a column of
     their own in the input vector. One extra input, always 1, carries every
     affine term — a cleaner arrangement than pretending they are sources. */
  const Maff = zeros(n, 1);
  for (const b of branches) {
    if ((b.type === "D" || b.type === "SW") && cond[b.id] && b.vf) {
      const a = row(b.n[0]), c = row(b.n[1]);
      /* i = (v_a − v_b − v_f)/r_on. The conductance is already stamped; what
         is left is the constant −v_f/r_on, a current of that size leaving the
         anode — so as an injection it is positive at the anode and negative
         at the cathode. Backwards, this puts the drop on the wrong side of
         the device and a freewheeling switch node floats a diode ABOVE
         ground instead of below it. */
      const k = b.vf / b.ron;
      if (a >= 0) Maff[a][0] += k;
      if (c >= 0) Maff[c][0] -= k;
    }
  }

  const F = lu(Y);
  if (!F) return null;

  /* z = Y⁻¹(Mx x + Mu u + Maff). Solve once per column to get the response
     to each state and each input separately; superposition does the rest. */
  const solveCols = (M) => {
    const cols = M[0] ? M[0].length : 0;
    const Z = [];
    for (let j = 0; j < cols; j++) {
      const rhs = new Float64Array(n);
      for (let i = 0; i < n; i++) rhs[i] = M[i][j];
      Z.push(luSolve(F, rhs));
    }
    return Z;                       /* Z[j][i] = z_i in response to column j */
  };
  const Zx = solveCols(Mx), Zu = solveCols(Mu), Za = solveCols(Maff);

  /* State derivatives, read off those responses. */
  const A = zeros(nx, nx), B = zeros(nx, nu + 1);
  states.forEach((s, i) => {
    const b = s.b;
    const a = row(b.n[0]), c = row(b.n[1]);
    if (s.kind === "L") {
      /* di/dt = (v_a − v_b)/L */
      const gain = 1 / b.value;
      for (let j = 0; j < nx; j++) {
        A[i][j] = gain * ((a >= 0 ? Zx[j][a] : 0) - (c >= 0 ? Zx[j][c] : 0));
      }
      for (let j = 0; j < nu; j++) {
        B[i][j] = gain * ((a >= 0 ? Zu[j][a] : 0) - (c >= 0 ? Zu[j][c] : 0));
      }
      B[i][nu] = gain * ((a >= 0 ? Za[0][a] : 0) - (c >= 0 ? Za[0][c] : 0));
    } else {
      /* dv/dt = i_C/C, and i_C is one of the extra unknowns */
      const k = extraOf.get(b.id);
      const gain = 1 / b.value;
      for (let j = 0; j < nx; j++) A[i][j] = gain * Zx[j][k];
      for (let j = 0; j < nu; j++) B[i][j] = gain * Zu[j][k];
      B[i][nu] = gain * Za[0][k];
    }
  });

  /* Readouts. Any node voltage and any branch current, as a linear function
     of (x, u, 1) — this is what gives the animation real volts and real
     per-device amps instead of levels and hand-authored flags. */
  const probeNode = (nm) => {
    const r = row(nm);
    const cx = new Float64Array(nx), cu = new Float64Array(nu + 1);
    if (r >= 0) {
      for (let j = 0; j < nx; j++) cx[j] = Zx[j][r];
      for (let j = 0; j < nu; j++) cu[j] = Zu[j][r];
      cu[nu] = Za[0][r];
    }
    return { cx, cu };
  };
  const probeBranch = (id) => {
    const b = branches.find((q) => q.id === id);
    if (!b) return null;
    const cx = new Float64Array(nx), cu = new Float64Array(nu + 1);
    if (b.type === "L") { cx[stateOf.get(id)] = 1; return { cx, cu }; }
    if (b.type === "C" || b.type === "V" || b.type === "XF") {
      const k = extraOf.get(id);
      for (let j = 0; j < nx; j++) cx[j] = Zx[j][k];
      for (let j = 0; j < nu; j++) cu[j] = Zu[j][k];
      cu[nu] = Za[0][k];
      return { cx, cu };
    }
    /* resistive branch: i = (v_a − v_b − vf)/r */
    const a = row(b.n[0]), c = row(b.n[1]);
    const r = b.type === "R" ? b.value : resistOf(b, !!cond[b.id]);
    const g = 1 / r;
    for (let j = 0; j < nx; j++) cx[j] = g * ((a >= 0 ? Zx[j][a] : 0) - (c >= 0 ? Zx[j][c] : 0));
    for (let j = 0; j < nu; j++) cu[j] = g * ((a >= 0 ? Zu[j][a] : 0) - (c >= 0 ? Zu[j][c] : 0));
    cu[nu] = g * ((a >= 0 ? Za[0][a] : 0) - (c >= 0 ? Za[0][c] : 0));
    if (cond[b.id] && b.vf) cu[nu] -= g * b.vf;
    return { cx, cu };
  };
  /* Voltage across a branch, which is what tells a blocking diode whether it
     should be conducting. */
  const probeAcross = (id) => {
    const b = branches.find((q) => q.id === id);
    if (!b) return null;
    const a = row(b.n[0]), c = row(b.n[1]);
    const cx = new Float64Array(nx), cu = new Float64Array(nu + 1);
    for (let j = 0; j < nx; j++) cx[j] = (a >= 0 ? Zx[j][a] : 0) - (c >= 0 ? Zx[j][c] : 0);
    for (let j = 0; j < nu; j++) cu[j] = (a >= 0 ? Zu[j][a] : 0) - (c >= 0 ? Zu[j][c] : 0);
    cu[nu] = (a >= 0 ? Za[0][a] : 0) - (c >= 0 ? Za[0][c] : 0);
    return { cx, cu };
  };

  return { A, B, nx, nu, idx, probeNode, probeBranch, probeAcross, stateOf, inputOf };
}

/* Evaluate a probe at a state and input.

   `u` carries a trailing 1 in its last slot, which is what the affine column
   multiplies — diode forward drops and anything else constant. Build it with
   the solver's inputs(), which appends that 1, and this stays a plain dot
   product. Passing a `u` without it silently reads one slot past the end and
   every probe returns NaN. */
export const readAt = (p, x, u) => {
  let s = 0;
  for (let i = 0; i < p.cx.length; i++) s += p.cx[i] * x[i];
  for (let i = 0; i < p.cu.length; i++) s += p.cu[i] * (u[i] !== undefined ? u[i] : (i === p.cu.length - 1 ? 1 : 0));
  return s;
};
