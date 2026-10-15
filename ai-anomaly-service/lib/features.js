// Attendance rows -> feature vectors, plus the robust statistics used to explain a flag.

// Order = vector order. `floor` = smallest spread taken seriously, so a very regular employee
// (MAD ~ 0) isn't flagged for a 3-minute difference.
const FEATURES = [
  { key: 'checkInMinutes', kind: 'time', floor: 15 },
  { key: 'checkOutMinutes', kind: 'time', floor: 15 },
  { key: 'workingMinutes', kind: 'duration', floor: 30 },
  { key: 'lateMinutes', kind: 'minutes', floor: 10 },
  { key: 'wfh', kind: 'flag' }
];

// "09:05" / "09:05:30" -> minutes since midnight
function toMinutes(time) {
  if (!time) return null;
  const [h, m, s = 0] = String(time).split(':').map(Number);
  if ([h, m, s].some(Number.isNaN)) return null;
  return h * 60 + m + s / 60;
}

// One completed attendance day (check-in AND check-out) -> { date, values }, else null
function dayFeatures(row) {
  const checkIn = toMinutes(row.check_in_time);
  const checkOut = toMinutes(row.check_out_time);
  if (checkIn === null || checkOut === null) return null;

  const working = row.working_minutes !== null && row.working_minutes !== undefined
    ? Number(row.working_minutes)
    : checkOut - checkIn;
  if (!(working >= 0)) return null; // overnight/clock errors: not a usable day

  return {
    date: String(row.date).slice(0, 10),
    values: [checkIn, checkOut, working, Number(row.late_minutes) || 0, row.attendance_type === 'WORK_FROM_HOME' ? 1 : 0]
  };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Median absolute deviation (robust spread: a few outliers in the history don't inflate it)
function mad(values, med = median(values)) {
  return median(values.map(v => Math.abs(v - med)));
}

// Robust z-score of one value against a history column. 1.4826 * MAD estimates the standard
// deviation for normal data, so the scale matches an ordinary z-score.
function robustZ(value, column, floor) {
  const med = median(column);
  const spread = Math.max(1.4826 * mad(column, med), floor);
  return { z: (value - med) / spread, typical: med };
}

const hhmm = (minutes) => {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const hours = (minutes) => `${Math.round((minutes / 60) * 10) / 10} h`;

function describe(feature, value, typical) {
  switch (feature.key) {
    case 'checkInMinutes': return `checked in at ${hhmm(value)} (usually ${hhmm(typical)})`;
    case 'checkOutMinutes': return `checked out at ${hhmm(value)} (usually ${hhmm(typical)})`;
    case 'workingMinutes': return `worked ${hours(value)} (usually ${hours(typical)})`;
    case 'lateMinutes': return `was ${Math.round(value)} min late (usually ${Math.round(typical)} min)`;
    default: return value ? 'worked from home (usually from the office)' : 'worked from the office (usually from home)';
  }
}

// How far each feature of `values` is from this employee's normal, most unusual first.
// Flags (WFH) use the history's share p: z = |x - p| / sqrt(p(1-p) + 0.01) - a WFH day for
// someone who is almost never remote stands out; for a 50/50 hybrid worker it doesn't.
function deviations(history, values) {
  return FEATURES.map((feature, i) => {
    const column = history.map(v => v[i]);
    let z;
    let typical;
    if (feature.kind === 'flag') {
      const p = column.reduce((s, v) => s + v, 0) / column.length;
      z = Math.abs(values[i] - p) / Math.sqrt(p * (1 - p) + 0.01);
      typical = p >= 0.5 ? 1 : 0;
      // Only "unusual" when the day goes against the habit
      if (values[i] === typical) z = 0;
    } else {
      ({ z, typical } = robustZ(values[i], column, feature.floor));
      z = Math.abs(z);
    }
    return {
      feature: feature.key,
      value: Math.round(values[i] * 10) / 10,
      typical: Math.round(typical * 10) / 10,
      deviation: Math.round(z * 100) / 100,
      text: describe(feature, values[i], typical)
    };
  }).sort((a, b) => b.deviation - a.deviation);
}

module.exports = { FEATURES, toMinutes, dayFeatures, median, mad, robustZ, deviations };
