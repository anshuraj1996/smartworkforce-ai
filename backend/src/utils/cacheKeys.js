// Cache key convention:  <prefix><area>:<tenant/owner id>:<qualifiers>[:v<namespace version>]
//
//   smartai:dashboard:<orgId>:<role>:<userId>:v12
//   smartai:leave-balance:<orgId>:<userId>:2026:v3
//
// - The organization id comes right after the area, so no key can ever be shared between
//   tenants, and everything for one org is easy to find with SCAN in a debugging session.
// - Keys in a namespace (NAMESPACES below) get ":v<n>" appended by withVersionedCache();
//   bumping the namespace invalidates all of them at once.
// - Every key has a TTL - nothing is cached forever, so a missed invalidation self-heals.

// Seconds
const CACHE_TTL = {
  dashboard: 20,
  teamAttendance: 20,
  userStats: 20,
  unreadCount: 30,
  authContext: 60,
  leaveBalance: 600,
  defaultShift: 600,
  // Model retrained at most hourly; booked leave changes clear it sooner (workforce namespace)
  attendanceForecast: 3600,
  // Daily inputs; attendance/leave events clear it sooner (workforce namespace)
  riskOverview: 1800,
  // Cleared by OrganizationService.updateSettings
  orgSettings: 600
};

const CACHE_KEYS = {
  dashboard: (orgId, role, userId) => `dashboard:${orgId}:${role}:${userId}`,
  teamAttendance: (orgId, managerId, date) => `team-attendance:${orgId}:${managerId || 'all'}:${date}`,
  userStats: (orgId, role, userId) => `user-stats:${orgId}:${role}:${userId}`,
  unreadCount: (userId) => `notif-unread:${userId}`,
  authContext: (userId) => `auth:${userId}`,
  leaveBalance: (orgId, userId, year) => `leave-balance:${orgId}:${userId}:${year}`,
  defaultShift: (orgId) => `default-shift:${orgId}`,
  attendanceForecast: (orgId, scope, horizon, date) => `forecast:attendance:${orgId}:${scope}:${horizon}:${date}`,
  leaveForecast: (orgId, scope, weeks, date) => `forecast:leave:${orgId}:${scope}:${weeks}:${date}`,
  riskOverview: (orgId, scope, date) => `risk:${orgId}:${scope}:${date}`,
  orgSettings: (orgId) => `org-settings:${orgId}`
};

// Groups of keys invalidated together by bumpNamespace()
const NAMESPACES = {
  // Org-wide live views (dashboard, team attendance, user/team stats). Bumped by the
  // cache-invalidation worker on attendance/leave/WFH/regularization/employee events.
  workforce: (orgId) => `workforce:${orgId}`,
  // Every leave balance in an org depends on its leave policies
  leavePolicy: (orgId) => `leave-policy:${orgId}`
};

module.exports = { CACHE_TTL, CACHE_KEYS, NAMESPACES };
