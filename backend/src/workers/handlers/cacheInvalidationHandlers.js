const { NAMESPACES } = require('../../utils/cacheKeys');

// Event-driven cache invalidation for the org-wide live views (dashboard, team attendance,
// user/team stats). These are built from many employees' data, so instead of deleting keys
// one by one, any event that changes "who is in / out / on leave / on WFH" bumps the org's
// "workforce" namespace - every cached view for that org becomes stale in one O(1) INCR.
//
// If this worker or Kafka is down, nothing breaks: those keys still expire on their short TTL.

// Event types that move the numbers on dashboards and team views
const WORKFORCE_EVENTS = [
  'ATTENDANCE_CHECKED_IN',
  'ATTENDANCE_CHECKED_OUT',
  'LEAVE_APPLIED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'WFH_APPLIED',
  'WFH_APPROVED',
  'WFH_REJECTED',
  'REGULARIZATION_APPROVED',
  'EMPLOYEE_JOINED'
];

function createCacheInvalidationHandlers({ cache }) {
  const bumpWorkforce = (event) => cache.bumpNamespace(NAMESPACES.workforce(event.organizationId));
  return Object.fromEntries(WORKFORCE_EVENTS.map(type => [type, bumpWorkforce]));
}

module.exports = { createCacheInvalidationHandlers, WORKFORCE_EVENTS };
