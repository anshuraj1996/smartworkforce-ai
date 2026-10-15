const { fitIsolationForest } = require('./isolationForest');
const { deviations, median, mad } = require('./features');

const DAY_DEFAULTS = {
  minHistory: 20,     // completed days needed before a personal model is trusted
  // Expected share of unusual days. The threshold is the (1 - contamination) quantile of the
  // forest's scores on this employee's own history (as scikit-learn's `contamination`): with
  // 20-90 days of history, scores bunch together, so one global cut-off can't fit everyone.
  contamination: 0.02,
  minScore: 0.5,      // never flag below this, whatever the history (0.5 = "average" point)
  minDeviation: 2.5,  // ...and at least one feature this many robust SDs from normal
  trees: 100,
  fullConfidenceAt: 60 // history size at which sample size stops limiting confidence
};

const SHIFT_DEFAULTS = {
  recentDays: 10,     // the window compared against everything before it
  minBaseline: 20,
  minZ: 3,            // statistical significance for time/duration shifts
  minMinutes: 30,     // ...and practical significance (a 10-minute drift isn't news)
  minWfhZ: 2.5,
  minWfhChange: 0.3   // 30 percentage points
};

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

// Linear-interpolated quantile, q in [0, 1]
function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation, |error| < 1.5e-7)
function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Is this completed day unusual FOR THIS EMPLOYEE?
 *   history: earlier days' feature vectors (the model never sees the day it scores)
 *   day:     { date, values }
 * A day is flagged only when the forest scores it high AND a concrete feature explains why -
 * a high score with nothing nameable behind it is usually noise from a small history.
 * Returns null (normal / not enough history) or the finding.
 */
function detectDayAnomaly({ history, day, seed, options = {} }) {
  const o = { ...DAY_DEFAULTS, ...options };
  if (history.length < o.minHistory) return null;

  // Fit on the history PLUS the day being judged - Isolation Forest's own setting (it isolates
  // anomalies that are in the data). Splits are drawn within the data's range, so a day outside
  // the history's range could otherwise be isolated no faster than the history's extremes.
  const forest = fitIsolationForest([...history, day.values], { trees: o.trees, seed });
  const threshold = Math.max(o.minScore, quantile(history.map(v => forest.score(v).score), 1 - o.contamination));
  const { score, agreement } = forest.score(day.values);
  const reasons = deviations(history, day.values).filter(r => r.deviation >= o.minDeviation);
  if (score <= threshold || reasons.length === 0) return null;

  // Model-derived: how unanimous the trees are, discounted while the history is short
  const confidence = Math.round(100 * agreement * Math.min(1, history.length / o.fullConfidenceAt));

  return {
    date: day.date,
    anomalyScore: round(score),
    threshold: round(threshold),
    confidence,
    // how far past this employee's own threshold the day is
    severity: score - threshold >= 0.1 ? 'HIGH' : score - threshold >= 0.05 ? 'MEDIUM' : 'LOW',
    sampleSize: history.length,
    trees: forest.trees,
    reasons: reasons.slice(0, 3)
  };
}

/**
 * Has the employee's pattern changed recently (not one odd day, but a sustained shift)?
 * Compares the last `recentDays` completed days with the baseline before them:
 *  - check-in time and hours worked: difference in medians, tested against its standard error
 *    (|z| >= minZ) and at least minMinutes in absolute terms
 *  - WFH share: two-proportion z-test (|z| >= minWfhZ) and a change of >= minWfhChange
 * `days` must be in date order. Confidence = 1 - two-sided p-value of the strongest shift.
 */
function detectPatternShift({ days, options = {} }) {
  const o = { ...SHIFT_DEFAULTS, ...options };
  if (days.length < o.recentDays + o.minBaseline) return null;

  const recent = days.slice(-o.recentDays);
  const baseline = days.slice(0, -o.recentDays);
  const col = (set, i) => set.map(d => d.values[i]);
  const shifts = [];

  [{ i: 0, feature: 'checkInMinutes', floor: 15 }, { i: 2, feature: 'workingMinutes', floor: 30 }].forEach(({ i, feature, floor }) => {
    const base = col(baseline, i);
    const from = median(base);
    const to = median(col(recent, i));
    // Test statistic for a difference in medians: the standard error of a sample median is
    // ~1.2533 * sigma / sqrt(n); sigma estimated robustly from the baseline (1.4826 * MAD)
    const sigma = Math.max(1.4826 * mad(base, from), floor);
    const z = (to - from) / (1.2533 * sigma * Math.sqrt(1 / recent.length + 1 / baseline.length));
    if (Math.abs(z) >= o.minZ && Math.abs(to - from) >= o.minMinutes) {
      shifts.push({ feature, from: round(from, 1), to: round(to, 1), z: round(z, 2), text: shiftText(feature, from, to) });
    }
  });

  const pBase = col(baseline, 4).reduce((s, v) => s + v, 0) / baseline.length;
  const pRecent = col(recent, 4).reduce((s, v) => s + v, 0) / recent.length;
  const pooled = (pBase * baseline.length + pRecent * recent.length) / days.length;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / baseline.length + 1 / recent.length));
  if (se > 0) {
    const z = (pRecent - pBase) / se;
    if (Math.abs(z) >= o.minWfhZ && Math.abs(pRecent - pBase) >= o.minWfhChange) {
      shifts.push({
        feature: 'wfhShare', from: round(pBase, 2), to: round(pRecent, 2), z: round(z, 2),
        text: `works from home ${Math.round(pRecent * 100)}% of days lately (was ${Math.round(pBase * 100)}%)`
      });
    }
  }

  if (shifts.length === 0) return null;
  const strongest = Math.max(...shifts.map(s => Math.abs(s.z)));
  const pValue = 2 * (1 - normalCdf(strongest));

  return {
    windowStart: recent[0].date,
    windowEnd: recent[recent.length - 1].date,
    recentDays: recent.length,
    baselineDays: baseline.length,
    shifts,
    confidence: Math.min(99, Math.round((1 - pValue) * 100)),
    severity: strongest >= 5 ? 'HIGH' : strongest >= 4 ? 'MEDIUM' : 'LOW'
  };
}

function shiftText(feature, from, to) {
  const hhmm = (m) => `${String(Math.floor(Math.round(m) / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  return feature === 'checkInMinutes'
    ? `checks in around ${hhmm(to)} lately (was ${hhmm(from)})`
    : `works about ${round(to / 60, 1)} h a day lately (was ${round(from / 60, 1)} h)`;
}

module.exports = { detectDayAnomaly, detectPatternShift, normalCdf, quantile, DAY_DEFAULTS, SHIFT_DEFAULTS };
