// Per-employee risk scores from attendance signals (inputs: AnalyticsRepository.riskInputs).
//
// Two scores, 0-100, each a weighted sum of factors scaled to 0..1 on FIXED, documented
// scales (not percentiles within the org), so a score means the same in a 5-person team and a
// 500-person company, and every point can be explained:
//
//   attendanceRisk  unplanned absence, Bradford Factor, lateness, recent deterioration,
//                   check-in inconsistency, recent anomaly alerts (ai-anomaly-service)
//   burnoutRisk     sustained overtime, long stretch without any leave
//
// These are prompts for a supportive conversation, not a judgment of performance - they only
// see attendance data, and the factors say exactly what drove them.

const MIN_EXPECTED_DAYS = 20; // fewer expected days in the 90-day window -> no score

// Linear ramp: value at `from` -> 0, at `to` -> 1, clamped
const ramp = (value, from, to) => Math.min(1, Math.max(0, (value - from) / (to - from)));

// Bradford Factor B = S^2 x D (S = separate absence spells, D = days, over 52 weeks).
// Commonly used HR trigger points: 125 (concern), 450 (review), 650 (serious).
const BRADFORD_BANDS = [[0, 0], [125, 0.4], [450, 0.75], [650, 1]];
function bradfordScale(b) {
  for (let i = 1; i < BRADFORD_BANDS.length; i += 1) {
    const [x1, y1] = BRADFORD_BANDS[i];
    const [x0, y0] = BRADFORD_BANDS[i - 1];
    if (b <= x1) return y0 + ((b - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}
const bradfordBand = (b) => (b >= 650 ? 'serious (650+)' : b >= 450 ? 'review (450+)' : b >= 125 ? 'concern (125+)' : 'below 125');

const pct = (n) => Math.round(n * 100);
const round1 = (n) => Math.round(n * 10) / 10;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

// Factor definitions: weight within its score, how the raw value is scaled, and its sentence
const ATTENDANCE_FACTORS = [
  {
    key: 'absence', label: 'Unplanned absence', weight: 0.25,
    value: (r) => r.absent90 / r.expected90,
    scale: (v) => ramp(v, 0, 0.1), // 10% of expected days absent = full weight
    text: (r) => `absent ${r.absent90} of ${r.expected90} expected days in the last 90 days`
  },
  {
    key: 'bradford', label: 'Bradford Factor', weight: 0.25,
    value: (r) => r.bradfordSpells ** 2 * r.bradfordDays,
    scale: bradfordScale,
    text: (r, v) => `Bradford Factor ${v} - ${r.bradfordSpells} separate absences, ${r.bradfordDays} days in 12 months (${bradfordBand(v)})`
  },
  {
    key: 'lateness', label: 'Late arrivals', weight: 0.15,
    value: (r) => (r.present90 ? r.late90 / r.present90 : 0),
    scale: (v) => ramp(v, 0, 0.3),
    text: (r) => `late on ${r.late90} of ${r.present90} days worked (avg ${Math.round(r.avgLateMinutes)} min)`
  },
  {
    key: 'deterioration', label: 'Recent change', weight: 0.15,
    // absence + lateness rate, last 30 days minus the 60 days before (needs enough of both)
    value: (r) => (r.expected30 >= 10 && r.expectedPrior >= 15 ? r.issues30 / r.expected30 - r.issuesPrior / r.expectedPrior : 0),
    scale: (v) => ramp(v, 0, 0.2),
    text: (r) => `absent or late on ${pct(r.issues30 / r.expected30)}% of days in the last 30 days, ${pct(r.issuesPrior / r.expectedPrior)}% before`
  },
  {
    key: 'inconsistency', label: 'Irregular check-in', weight: 0.1,
    value: (r) => r.checkInSdMinutes,
    scale: (v) => ramp(v, 10, 60), // under 10 minutes of spread is normal
    text: (r) => `check-in time varies by about ±${Math.round(r.checkInSdMinutes)} min`
  },
  {
    key: 'anomalies', label: 'Unusual-attendance alerts', weight: 0.1,
    value: (r) => r.recentAnomalies,
    scale: (v) => ramp(v, 0, 3),
    text: (r) => `${r.recentAnomalies} unusual-attendance alert${r.recentAnomalies === 1 ? '' : 's'} in the last 30 days`
  }
];

const BURNOUT_FACTORS = [
  {
    key: 'overtime', label: 'Sustained overtime', weight: 0.65,
    value: (r) => r.overtimeMinutes56 / 60 / 8, // hours per week, last 8 weeks
    scale: (v) => ramp(v, 2, 10),
    text: (r, v) => `${round1(v)} h overtime per week over the last 8 weeks`
  },
  {
    key: 'noLeave', label: 'No time off', weight: 0.35,
    value: (r, today) => daysBetween(r.lastLeaveEnded || r.trackedFrom, today),
    scale: (v) => ramp(v, 90, 240),
    text: (r, v) => (r.lastLeaveEnded ? `no leave for ${v} days` : `no leave taken since tracking began ${v} days ago`)
  }
];

function scoreGroup(factors, row, today) {
  const details = factors.map(f => {
    const raw = f.value(row, today);
    const value = Number.isFinite(raw) ? raw : 0;
    const scaled = f.scale(value);
    return {
      key: f.key,
      label: f.label,
      value: round1(value),
      scaled: Math.round(scaled * 100) / 100,
      points: Math.round(scaled * f.weight * 100), // contribution to the 0-100 score
      text: f.text(row, Math.round(value))
    };
  });
  const score = Math.min(100, details.reduce((s, d) => s + d.points, 0));
  return { score, factors: details };
}

const level = (score) => (score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low');

/**
 * row: one riskInputs row; today: 'YYYY-MM-DD'.
 * Returns the scores with a level and the top reasons (factors worth >= 5 points).
 */
function scoreEmployee(row, today) {
  const base = { userId: row.userId, name: row.name, department: row.department, managerId: row.managerId };
  if (row.expected90 < MIN_EXPECTED_DAYS) {
    return { ...base, status: 'insufficient_data', expectedDays: row.expected90, attendanceRisk: null, burnoutRisk: null };
  }

  const attendance = scoreGroup(ATTENDANCE_FACTORS, row, today);
  const burnout = scoreGroup(BURNOUT_FACTORS, row, today);
  const top = (factors) => factors.filter(f => f.points >= 5).sort((a, b) => b.points - a.points).slice(0, 3).map(f => f.text);

  return {
    ...base,
    status: 'ok',
    attendanceRisk: { score: attendance.score, level: level(attendance.score), reasons: top(attendance.factors), factors: attendance.factors },
    burnoutRisk: { score: burnout.score, level: level(burnout.score), reasons: top(burnout.factors), factors: burnout.factors }
  };
}

const METHODOLOGY = {
  note: 'Scores are prompts for a supportive conversation, not a judgment of performance. They use attendance data only.',
  levels: 'high >= 60, medium >= 35, low < 35',
  attendanceRisk: ATTENDANCE_FACTORS.map(f => `${f.label} (${Math.round(f.weight * 100)}%)`).join(', '),
  burnoutRisk: BURNOUT_FACTORS.map(f => `${f.label} (${Math.round(f.weight * 100)}%)`).join(', '),
  minimumExpectedDays: MIN_EXPECTED_DAYS
};

module.exports = { scoreEmployee, bradfordScale, level, METHODOLOGY, MIN_EXPECTED_DAYS };
