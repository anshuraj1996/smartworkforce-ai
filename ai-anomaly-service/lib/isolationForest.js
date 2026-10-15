// Isolation Forest (Liu, Ting & Zhou, 2008), dependency-free.
//
// Idea: anomalies are "few and different", so random axis-aligned splits isolate them in far
// fewer steps than normal points. Build many random trees on subsamples; a point's anomaly
// score comes from its average path length (depth at which it ends up alone):
//
//   score(x) = 2 ^ ( -E[h(x)] / c(psi) )      ~1 = anomaly, ~0.5 or below = normal
//
// where c(n) is the average path length of an unsuccessful search in a binary search tree of
// n points (normalizes for sample size).
//
// Seeded: the same data + seed always builds the same forest, so a re-scored day (redelivered
// event) gets exactly the same result.

const EULER_MASCHERONI = 0.5772156649;

// mulberry32 - small, fast, good-enough PRNG for sampling and split choice
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a: a stable 32-bit seed from a string (e.g. "userId:date")
function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// c(n): average path length of an unsuccessful BST search over n points
function averagePathLength(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER_MASCHERONI) - (2 * (n - 1)) / n;
}

function buildTree(points, depth, maxDepth, rng) {
  if (depth >= maxDepth || points.length <= 1) return { size: points.length };

  // Only features that still vary inside this node can split it
  const candidates = [];
  for (let f = 0; f < points[0].length; f += 1) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p[f] < min) min = p[f];
      if (p[f] > max) max = p[f];
    }
    if (max > min) candidates.push({ feature: f, min, max });
  }
  if (candidates.length === 0) return { size: points.length }; // identical points

  const { feature, min, max } = candidates[Math.floor(rng() * candidates.length)];
  const split = min + rng() * (max - min);
  const left = [];
  const right = [];
  for (const p of points) (p[feature] < split ? left : right).push(p);

  return {
    feature,
    split,
    left: buildTree(left, depth + 1, maxDepth, rng),
    right: buildTree(right, depth + 1, maxDepth, rng)
  };
}

// Depth at which x lands; a leaf holding several points adds c(size) for the unbuilt subtree
function pathLength(x, node, depth = 0) {
  if (node.size !== undefined) return depth + averagePathLength(node.size);
  return pathLength(x, x[node.feature] < node.split ? node.left : node.right, depth + 1);
}

// Random subsample of k items without replacement (partial Fisher-Yates)
function subsample(data, k, rng) {
  const idx = data.map((_, i) => i);
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k).map(i => data[i]);
}

/**
 * Fit a forest on numeric vectors (all the same length).
 *   trees      number of trees (100 is the paper's default; scores stabilize well before)
 *   sampleSize subsample per tree, psi (256 in the paper; capped at the data size)
 *   seed       PRNG seed
 * Returns { score(x) -> { score, agreement } }. `agreement` is the share of trees in which x is
 * isolated faster than an average point - how unanimous the forest is (used for confidence).
 */
function fitIsolationForest(data, { trees = 100, sampleSize = 256, seed = 1 } = {}) {
  if (!Array.isArray(data) || data.length < 2) throw new Error('Isolation Forest needs at least 2 points');

  const rng = createRng(seed);
  const psi = Math.min(sampleSize, data.length);
  const maxDepth = Math.ceil(Math.log2(psi));
  const forest = [];
  for (let t = 0; t < trees; t += 1) {
    forest.push(buildTree(subsample(data, psi, rng), 0, maxDepth, rng));
  }
  const expected = averagePathLength(psi);

  return {
    trees,
    sampleSize: psi,
    score(x) {
      let total = 0;
      let shorter = 0;
      for (const tree of forest) {
        const h = pathLength(x, tree);
        total += h;
        if (h < expected) shorter += 1;
      }
      return { score: 2 ** (-(total / forest.length) / expected), agreement: shorter / forest.length };
    }
  };
}

module.exports = { fitIsolationForest, averagePathLength, createRng, hashSeed };
