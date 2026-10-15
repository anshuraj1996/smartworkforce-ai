-- migrate:no-transaction
--
-- Indexes for the queries the repositories actually run (see repositories/*.js).
-- CONCURRENTLY builds without blocking writes, but can't run in a transaction - hence the
-- header. Each index is dropped first so a failed run (which leaves an INVALID index behind)
-- can simply be re-run.

-- Pending approvals: "pending requests in my organization, oldest first"
-- (LeaveRepository/WfhRepository/RegularizationRepository.findPending). Partial: only the few
-- PENDING rows are indexed, not years of history, so it stays tiny.
DROP INDEX CONCURRENTLY IF EXISTS idx_leave_requests_pending_org;
CREATE INDEX CONCURRENTLY idx_leave_requests_pending_org
  ON leave_requests (organization_id, created_at) WHERE status = 'PENDING';

DROP INDEX CONCURRENTLY IF EXISTS idx_wfh_requests_pending_org;
CREATE INDEX CONCURRENTLY idx_wfh_requests_pending_org
  ON wfh_requests (organization_id, created_at) WHERE status = 'PENDING';

DROP INDEX CONCURRENTLY IF EXISTS idx_regularization_requests_pending_org;
CREATE INDEX CONCURRENTLY idx_regularization_requests_pending_org
  ON regularization_requests (organization_id, created_at) WHERE status = 'PENDING';

-- Overlap checks on every leave/WFH application: active (PENDING/APPROVED) rows only
-- (findOverlapping, countOnLeave, findApprovedCovering)
DROP INDEX CONCURRENTLY IF EXISTS idx_leave_requests_active_range;
CREATE INDEX CONCURRENTLY idx_leave_requests_active_range
  ON leave_requests (user_id, start_date, end_date) WHERE status IN ('PENDING', 'APPROVED');

DROP INDEX CONCURRENTLY IF EXISTS idx_wfh_requests_active_range;
CREATE INDEX CONCURRENTLY idx_wfh_requests_active_range
  ON wfh_requests (user_id, start_date, end_date) WHERE status IN ('PENDING', 'APPROVED');

-- "One pending regularization per employee per day" was only checked in code, so two
-- concurrent submissions could both pass. A partial UNIQUE index makes the database enforce
-- it. (Fails to build if duplicates already exist - delete them and re-run.)
DROP INDEX CONCURRENTLY IF EXISTS uq_regularization_requests_pending_day;
CREATE UNIQUE INDEX CONCURRENTLY uq_regularization_requests_pending_day
  ON regularization_requests (user_id, date) WHERE status = 'PENDING';

-- Team/organization member lists filter active users by org and often by manager
-- (UserRepository.findActiveMembers / findActiveInOrg - used by dashboards, team views,
-- notification fan-out). Leading organization_id also serves org-only lookups.
DROP INDEX CONCURRENTLY IF EXISTS idx_users_active_org_manager;
CREATE INDEX CONCURRENTLY idx_users_active_org_manager
  ON users (organization_id, manager_id) WHERE is_active;

-- Case-insensitive email lookup within an org (UserRepository.findByEmailInOrg uses LOWER(email))
DROP INDEX CONCURRENTLY IF EXISTS idx_users_org_lower_email;
CREATE INDEX CONCURRENTLY idx_users_org_lower_email
  ON users (organization_id, lower(email));

-- Bell-icon badge: count of unread notifications, polled constantly. Partial index holds
-- only unread rows, so the count is an index-only scan over a handful of entries.
DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_unread_user;
CREATE INDEX CONCURRENTLY idx_notifications_unread_user
  ON notifications (user_id) WHERE is_read = false;

-- Login history page: a user's LOGIN audit entries, newest first
DROP INDEX CONCURRENTLY IF EXISTS idx_audit_logs_logins;
CREATE INDEX CONCURRENTLY idx_audit_logs_logins
  ON audit_logs (actor_id, "timestamp" DESC) WHERE action = 'LOGIN';

-- Insight history for an org/team, newest first (AiInsightRepository.findHistory)
DROP INDEX CONCURRENTLY IF EXISTS idx_ai_insights_org_generated;
CREATE INDEX CONCURRENTLY idx_ai_insights_org_generated
  ON ai_insights (organization_id, generated_at DESC);

-- Refresh planner statistics so the new indexes are considered right away
ANALYZE leave_requests;
ANALYZE wfh_requests;
ANALYZE regularization_requests;
ANALYZE users;
ANALYZE notifications;
ANALYZE audit_logs;
ANALYZE ai_insights;
