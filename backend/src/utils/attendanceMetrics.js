// Attendance-consistency proxy used wherever the frontend expects a "productivity"-style
// score - there's no task/performance-review system to source a real one from, so this is
// derived from real check-in time variance instead of being fabricated.
function consistencyScore(checkInMinutesList) {
  if (!checkInMinutesList.length) return 0;
  const mean = checkInMinutesList.reduce((a, b) => a + b, 0) / checkInMinutesList.length;
  const variance = checkInMinutesList.reduce((a, b) => a + (b - mean) ** 2, 0) / checkInMinutesList.length;
  const stdDev = Math.sqrt(variance);
  return Math.max(0, Math.round(100 - stdDev));
}

// Attendance types that count as "at work" for a given day
const PRESENT_TYPES = ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'];

const isPresent = (log) => !!log && PRESENT_TYPES.includes(log.attendanceType);

module.exports = { consistencyScore, PRESENT_TYPES, isPresent };
