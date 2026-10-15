// Ridge regression (L2-regularized least squares), closed form, dependency-free.
//
// Features are standardized (so one lambda treats them all alike) and the intercept is not
// penalized: fit on centered data, then intercept = mean(y) - sum(beta * mean(x)).
//   beta = (X'X + lambda * I)^-1 X'y        on standardized, centered X and centered y
// Small problems only (tens of features) - solved by Gaussian elimination with partial pivoting.

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    if (Math.abs(p) < 1e-12) continue; // singular direction: lambda > 0 prevents this in practice
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/**
 * X: rows of numeric features (no intercept column), y: targets.
 * Returns { predict(row), coefficients, intercept }.
 */
function fitRidge(X, y, { lambda = 1 } = {}) {
  const n = X.length;
  const k = X[0].length;
  const mean = Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  // Constant columns (e.g. a weekday never seen in training) get scale 1 -> standardized to 0
  const scale = mean.map((m, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - m) ** 2, 0) / n) || 1);
  const yMean = y.reduce((s, v) => s + v, 0) / n;

  const Z = X.map(r => r.map((v, j) => (v - mean[j]) / scale[j]));
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => {
    let s = i === j ? lambda : 0;
    for (const row of Z) s += row[i] * row[j];
    return s;
  }));
  const b = Array.from({ length: k }, (_, i) => Z.reduce((s, row, r) => s + row[i] * (y[r] - yMean), 0));
  const beta = solve(A, b);

  const coefficients = beta.map((bj, j) => bj / scale[j]); // back to the original feature units
  const intercept = yMean - coefficients.reduce((s, c, j) => s + c * mean[j], 0);

  return {
    coefficients,
    intercept,
    predict: (row) => intercept + row.reduce((s, v, j) => s + v * coefficients[j], 0)
  };
}

module.exports = { fitRidge, solve };
