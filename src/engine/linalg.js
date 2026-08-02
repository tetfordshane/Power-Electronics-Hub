/* Small dense linear algebra, and the matrix exponential.

   Everything here works on arrays of arrays, because the systems are tiny —
   a converter with four energy-storage elements and three extra branch
   currents is a 7×7 solve. Nothing about this needs a library, and having no
   dependency means the check scripts run it in plain node.

   The matrix exponential is the whole reason the simulator can be honest
   about stiffness. A switching converter modelled with real device
   resistances has time constants spanning nine decades — nanoseconds across
   an off-state resistance, milliseconds across the output filter — and any
   explicit integrator either takes nanosecond steps for a millisecond of
   simulation or goes unstable. Between two switching events the circuit is
   linear and time-invariant with a constant input, so its solution is not an
   approximation at all: x(t+h) = e^{Ah}x(t) + ∫e^{Aτ}B dτ·u. Compute those
   two matrices once per configuration and the step is a matrix-vector
   product, exact at any h, stable at any stiffness. */

export const zeros = (r, c) => Array.from({ length: r }, () => new Float64Array(c));

export function eye(n) {
  const M = zeros(n, n);
  for (let i = 0; i < n; i++) M[i][i] = 1;
  return M;
}

export function matmul(A, B) {
  const n = A.length, m = B.length, p = B[0] ? B[0].length : 0;
  const C = zeros(n, p);
  for (let i = 0; i < n; i++) {
    const Ai = A[i], Ci = C[i];
    for (let k = 0; k < m; k++) {
      const a = Ai[k];
      if (a === 0) continue;
      const Bk = B[k];
      for (let j = 0; j < p; j++) Ci[j] += a * Bk[j];
    }
  }
  return C;
}

export function matvec(A, x) {
  const n = A.length, m = x.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const Ai = A[i];
    let s = 0;
    for (let j = 0; j < m; j++) s += Ai[j] * x[j];
    y[i] = s;
  }
  return y;
}

export const normInf = (A) => {
  let best = 0;
  for (const row of A) {
    let s = 0;
    for (const v of row) s += Math.abs(v);
    if (s > best) best = s;
  }
  return best;
};

/* ---------------------------------------------------------------- LU ---- */
/* Partial pivoting. Returns null for a singular matrix rather than throwing:
   the caller (a conduction-state search) can legitimately propose a
   configuration that has no solution, and wants to try another. */
export function lu(Ain) {
  const n = Ain.length;
  const A = Ain.map((r) => Float64Array.from(r));
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i][k]);
      if (v > best) { best = v; p = i; }
    }
    if (best < 1e-300) return null;
    if (p !== k) {
      const t = A[p]; A[p] = A[k]; A[k] = t;
      const q = piv[p]; piv[p] = piv[k]; piv[k] = q;
    }
    const akk = A[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / akk;
      A[i][k] = f;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) A[i][j] -= f * A[k][j];
    }
  }
  return { A, piv, n };
}

export function luSolve(F, b) {
  const { A, piv, n } = F;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[piv[i]];
    for (let j = 0; j < i; j++) s -= A[i][j] * y[j];
    y[i] = s;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * y[j];
    y[i] = s / A[i][i];
  }
  return y;
}

/* --------------------------------------------------- matrix exponential -- */
/* Scaling and squaring, Higham's 2005 arrangement.

   The idea is old — e^M = (e^{M/2^s})^{2^s}, with a rational approximation
   in the middle — but the arrangement matters more than it looks. A low
   order approximant forces a large s, and every squaring roughly doubles the
   relative error already present, so a 6th-order Padé on a matrix with a
   nine-decade spread needs thirty-odd squarings and loses most of its
   accuracy on the way back up. That is not academic here: the norm is set by
   the fastest device time constant and the answer that matters is carried by
   the slowest state. The 13th-order approximant with these thresholds keeps
   s small enough that the result stays at machine precision. */
const THETA = [
  [3, 1.495585217958292e-2],
  [5, 2.539398330063230e-1],
  [7, 9.504178996162932e-1],
  [9, 2.097847961257068e0],
];
const PADE = {
  3: [120, 60, 12, 1],
  5: [30240, 15120, 3360, 420, 30, 1],
  7: [17297280, 8648640, 1995840, 277200, 25200, 1512, 56, 1],
  9: [17643225600, 8821612800, 2075673600, 302702400, 30270240, 2162160, 110880, 3960, 90, 1],
  13: [64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800,
    129060195264000, 10559470521600, 670442572800, 33522128640, 1323241920,
    40840800, 960960, 16380, 182, 1],
};
const THETA13 = 5.371920351148152;

const addScaled = (T, S, c) => {
  for (let i = 0; i < T.length; i++) for (let j = 0; j < T.length; j++) T[i][j] += c * S[i][j];
};

export function expm(M) {
  const n = M.length;
  if (n === 0) return [];
  const nrm = normInf(M);
  if (!Number.isFinite(nrm)) throw new Error("expm: matrix is not finite");
  if (nrm === 0) return eye(n);

  let A = M.map((r) => Float64Array.from(r));
  let s = 0;
  let m = 13;
  for (const [order, theta] of THETA) {
    if (nrm <= theta) { m = order; break; }
  }
  if (m === 13 && nrm > THETA13) {
    s = Math.ceil(Math.log2(nrm / THETA13));
    const f = Math.pow(2, -s);
    A = A.map((r) => Float64Array.from(r, (v) => v * f));
  }

  const b = PADE[m];
  const A2 = matmul(A, A);
  let U, V;
  if (m === 13) {
    const A4 = matmul(A2, A2), A6 = matmul(A2, A4);
    const W1 = zeros(n, n);
    addScaled(W1, A6, b[13]); addScaled(W1, A4, b[11]); addScaled(W1, A2, b[9]);
    const W = matmul(A6, W1);
    addScaled(W, A6, b[7]); addScaled(W, A4, b[5]); addScaled(W, A2, b[3]);
    for (let i = 0; i < n; i++) W[i][i] += b[1];
    U = matmul(A, W);
    const Z1 = zeros(n, n);
    addScaled(Z1, A6, b[12]); addScaled(Z1, A4, b[10]); addScaled(Z1, A2, b[8]);
    V = matmul(A6, Z1);
    addScaled(V, A6, b[6]); addScaled(V, A4, b[4]); addScaled(V, A2, b[2]);
    for (let i = 0; i < n; i++) V[i][i] += b[0];
  } else {
    /* odd terms into U, even into V, sharing the powers of A² */
    const Uin = zeros(n, n);
    V = zeros(n, n);
    let P = eye(n);
    for (let k = 0; k <= m; k += 2) {
      addScaled(Uin, P, b[k + 1]);
      addScaled(V, P, b[k]);
      if (k + 2 <= m) P = matmul(P, A2);
    }
    U = matmul(A, Uin);
  }

  /* R = (V − U)⁻¹(V + U) */
  const num = zeros(n, n), den = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { num[i][j] = V[i][j] + U[i][j]; den[i][j] = V[i][j] - U[i][j]; }
  }
  const F = lu(den);
  if (!F) throw new Error("expm: Padé denominator is singular");
  let R = zeros(n, n);
  for (let j = 0; j < n; j++) {
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) col[i] = num[i][j];
    const x = luSolve(F, col);
    for (let i = 0; i < n; i++) R[i][j] = x[i];
  }
  for (let k = 0; k < s; k++) R = matmul(R, R);
  return R;
}

/* Exact discretisation of ẋ = Ax + Bu over a step h, for constant u.

   The trick avoids inverting A — which is essential here, because A is
   routinely singular (a capacitor with no DC path across it, an inductor in
   a loop of ideal sources) and the textbook A⁻¹(e^{Ah} − I)B would then be
   undefined for a system that is perfectly well behaved. Exponentiating the
   augmented block matrix [[A, B], [0, 0]] gives both Φ and Γ in its top row
   with no inverse anywhere. */
export function discretize(A, B, h) {
  const n = A.length;
  const m = B[0] ? B[0].length : 0;
  const big = zeros(n + m, n + m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) big[i][j] = A[i][j] * h;
    for (let j = 0; j < m; j++) big[i][n + j] = B[i][j] * h;
  }
  const E = expm(big);
  const Phi = zeros(n, n), Gam = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Phi[i][j] = E[i][j];
    for (let j = 0; j < m; j++) Gam[i][j] = E[i][n + j];
  }
  return { Phi, Gam };
}
