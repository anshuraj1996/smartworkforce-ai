-- migrate:no-transaction
--
-- Every index slows every INSERT/UPDATE on its table. These either duplicate a composite index
-- that starts with the same column(s), or index a low-variety column (status, severity, role...)
-- that the planner wouldn't use on its own. audit_logs is written on almost every request and
-- carried 12 indexes.
--
-- Names are Sequelize's defaults (<table>_<columns>). The matching definitions were removed
-- from the models so sequelize.sync() won't recreate them.

-- audit_logs: covered by (organization_id, timestamp), (actor_id, timestamp),
-- (action, timestamp), (entity_type, entity_id, timestamp); severity/source never filtered alone
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_organization_id;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_actor_id;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_action;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_entity_type;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_timestamp;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_severity;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_source;

-- leave_requests / wfh_requests: user_id covered by (user_id, start_date, end_date);
-- status replaced by the partial indexes in 001
DROP INDEX CONCURRENTLY IF EXISTS leave_requests_user_id;
DROP INDEX CONCURRENTLY IF EXISTS leave_requests_status;
DROP INDEX CONCURRENTLY IF EXISTS wfh_requests_user_id;
DROP INDEX CONCURRENTLY IF EXISTS wfh_requests_status;

-- regularization_requests: user_id covered by (user_id, date); status replaced by 001
DROP INDEX CONCURRENTLY IF EXISTS regularization_requests_user_id;
DROP INDEX CONCURRENTLY IF EXISTS regularization_requests_status;

-- notifications: (user_id, is_read) replaced by the smaller partial unread index in 001
DROP INDEX CONCURRENTLY IF EXISTS notifications_user_id_is_read;

-- attendance_logs: (user_id, date, attendance_type) is covered by the UNIQUE (user_id, date);
-- attendance_type alone has 5 values
DROP INDEX CONCURRENTLY IF EXISTS attendance_logs_user_id_date_attendance_type;
DROP INDEX CONCURRENTLY IF EXISTS attendance_logs_attendance_type;

-- ai_insights: low-variety flags never filtered alone
DROP INDEX CONCURRENTLY IF EXISTS ai_insights_severity;
DROP INDEX CONCURRENTLY IF EXISTS ai_insights_is_actionable;

-- users: role has 4 values; org-scoped role lookups use idx_users_active_org_manager
DROP INDEX CONCURRENTLY IF EXISTS users_role;
