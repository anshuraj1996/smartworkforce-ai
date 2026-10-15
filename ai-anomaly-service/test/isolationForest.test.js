const test = require('node:test');
const assert = require('node:assert/strict');
const { fitIsolationForest, averagePathLength, hashSeed } = require('../lib/isolationForest');
const { createSynth } = require('./synthetic');

test('c(n) matches the paper', () => {
  assert.equal(averagePathLength(1), 0);
  assert.equal(averagePathLength(2), 1);
  assert.ok(Math.abs(averagePathLength(256) - 10.244) < 0.01);
});

test('an obvious outlier scores high and most trees agree; an inlier scores ~0.5 or below', () => {
  const { gauss } = createSynth(1);
  const data = Array.from({ length: 100 }, () => [gauss(0, 1), gauss(0, 1)]);
  const forest = fitIsolationForest([...data, [8, 8]], { seed: 3 });

  const outlier = forest.score([8, 8]);
  const inlier = forest.score([0, 0]);
  assert.ok(outlier.score > 0.7, `outlier ${outlier.score}`);
  assert.ok(outlier.agreement > 0.9);
  assert.ok(inlier.score < 0.55, `inlier ${inlier.score}`);
});

test('same data + seed = same forest (re-scoring a day is reproducible)', () => {
  const data = Array.from({ length: 50 }, (_, i) => [i % 7, (i * 13) % 11]);
  const a = fitIsolationForest(data, { seed: hashSeed('user-1:2026-10-08') }).score([3, 30]);
  const b = fitIsolationForest(data, { seed: hashSeed('user-1:2026-10-08') }).score([3, 30]);
  assert.deepEqual(a, b);
});

test('identical points cannot be split and do not crash', () => {
  const forest = fitIsolationForest([[1, 1], [1, 1], [1, 1]]);
  assert.ok(Number.isFinite(forest.score([1, 1]).score));
});
