const { AttendanceLog } = require('../models');
const { Op } = require('sequelize');

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

async function checkInMinutesSince(userId, sinceDateStr) {
  const logs = await AttendanceLog.findAll({
    where: { userId, checkInTime: { [Op.ne]: null }, date: { [Op.gte]: sinceDateStr } },
    attributes: ['checkInTime']
  });
  return logs.map(l => {
    const [h, m] = l.checkInTime.split(':').map(Number);
    return h * 60 + m;
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { consistencyScore, checkInMinutesSince, todayStr, daysAgoStr };
