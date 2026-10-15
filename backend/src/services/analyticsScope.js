const { ROLES, IS_HR_UP } = require('../config/constants');

// Whose data a user's analytics cover, as the `memberIds` the analytics repository takes:
//   HR / Admin -> null (the whole organization - filtered by organization_id in SQL, so no
//                 need to ship every employee id to the database)
//   Manager    -> their active direct reports
//   Employee   -> only themselves
async function memberScope(user, userRepository) {
  if (IS_HR_UP.includes(user.role)) return null;
  if (user.role === ROLES.MANAGER) return userRepository.findActiveMemberIds(user.organizationId, user.id);
  return [user.id];
}

// Dashboard period filters (?period=30d)
const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
const periodToDays = (period) => PERIOD_DAYS[period] || 30;

// Overtime = minutes beyond this per day (no per-employee contract hours exist)
const STANDARD_WORKDAY_MINUTES = 480;
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Monday-Friday (Sunday = 0)

const percent = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const round2 = (n) => Math.round(n * 100) / 100;

module.exports = {
  memberScope,
  percent,
  round2,
  PERIOD_DAYS,
  periodToDays,
  STANDARD_WORKDAY_MINUTES,
  DEFAULT_WORKING_DAYS
};
