// Synthetic employees for tests: realistic normal days plus injected anomalies
const { createRng } = require('../lib/isolationForest');

function createSynth(seed) {
  const rng = createRng(seed);
  const gauss = (m, s) => {
    const u = 1 - rng();
    const v = rng();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  // values: [checkIn, checkOut, working, late, wfh] in minutes / 0-1
  const normalDay = (p) => {
    const ci = gauss(p.ci, p.ciSd);
    const wm = gauss(p.wm, p.wmSd);
    return [ci, ci + wm, wm, Math.max(0, ci - 555), rng() < p.wfh ? 1 : 0];
  };
  const employee = () => ({ ci: gauss(540, 20), ciSd: 5 + rng() * 15, wm: gauss(510, 20), wmSd: 15 + rng() * 25, wfh: 0.03 });
  return { rng, gauss, normalDay, employee };
}

module.exports = { createSynth };
