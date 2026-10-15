const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// Read-only aggregate queries for analytics. The database does the counting (GROUP BY,
// FILTER, GROUPING SETS, percentiles) and returns a handful of rows, instead of the service
// loading every attendance/leave row into Node and counting in JavaScript.
//
// Scope: `memberIds` null = the whole organization; an array = only those employees (a
// manager's direct reports, or one employee). An empty array short-circuits to "no rows".
// Every query is also filtered by organization_id - tenant isolation doesn't depend on the
// member list being right.

// Same bucket name everywhere, so departments line up across charts
const DEPARTMENT = (alias) => `COALESCE(NULLIF(${alias}.department, ''), 'Unassigned')`;

const scopeTo = (alias, memberIds) => (memberIds ? `AND ${alias}.user_id IN (:memberIds)` : '');
const noMembers = (memberIds) => Array.isArray(memberIds) && memberIds.length === 0;

// All requests that need an approval, as one row set (turnaround is measured across all three).
// status::text - each table's status is its own enum type, and UNION can't mix enum types.
const APPROVAL_REQUESTS = `
  SELECT 'LEAVE' AS kind, user_id, status::text AS status, created_at, approved_at, approved_by
    FROM leave_requests WHERE organization_id = :organizationId
  UNION ALL
  SELECT 'WFH', user_id, status::text, created_at, approved_at, approved_by
    FROM wfh_requests WHERE organization_id = :organizationId
  UNION ALL
  SELECT 'REGULARIZATION', user_id, status::text, created_at, approved_at, approved_by
    FROM regularization_requests WHERE organization_id = :organizationId`;

class AnalyticsRepository {
  select(sql, replacements) {
    return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  }

  // ---- Attendance ----

  // Per day: present (on time / WFH / half day), late, absent
  async attendanceByDate({ organizationId, memberIds = null, since }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT a.date::text AS date,
             count(*) FILTER (WHERE a.attendance_type NOT IN ('LATE', 'ABSENT'))::int AS present,
             count(*) FILTER (WHERE a.attendance_type = 'LATE')::int AS late,
             count(*) FILTER (WHERE a.attendance_type = 'ABSENT')::int AS absent
      FROM attendance_logs a
      WHERE a.organization_id = :organizationId AND a.date >= :since ${scopeTo('a', memberIds)}
      GROUP BY a.date
      ORDER BY a.date`, { organizationId, memberIds, since });
  }

  // Per department: logged days, days present, and minutes worked on those days
  async attendanceByDepartment({ organizationId, memberIds = null, since }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT ${DEPARTMENT('u')} AS department,
             count(*)::int AS total,
             count(*) FILTER (WHERE a.attendance_type <> 'ABSENT')::int AS present,
             COALESCE(sum(a.working_minutes) FILTER (WHERE a.attendance_type <> 'ABSENT'), 0)::float8 AS minutes
      FROM attendance_logs a
      JOIN users u ON u.id = a.user_id
      WHERE a.organization_id = :organizationId AND a.date >= :since ${scopeTo('a', memberIds)}
      GROUP BY 1
      ORDER BY 1`, { organizationId, memberIds, since });
  }

  async lateByDate({ organizationId, memberIds = null, since }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT a.date::text AS date,
             count(*)::int AS count,
             round(avg(COALESCE(a.late_minutes, 0)))::int AS "avgLateMinutes"
      FROM attendance_logs a
      WHERE a.organization_id = :organizationId AND a.date >= :since
        AND a.attendance_type = 'LATE' ${scopeTo('a', memberIds)}
      GROUP BY a.date
      ORDER BY a.date`, { organizationId, memberIds, since });
  }

  // Work mode (office / WFH / half day / absent) three ways in ONE scan with GROUPING SETS:
  // per department, per week, and the overall total. `grain` says which a row is.
  async workMode({ organizationId, memberIds = null, since, until }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT CASE WHEN GROUPING(x.department) = 0 THEN 'department'
                  WHEN GROUPING(x.week) = 0 THEN 'week'
                  ELSE 'total' END AS grain,
             x.department, x.week,
             count(*) FILTER (WHERE x.attendance_type IN ('PRESENT', 'LATE'))::int AS office,
             count(*) FILTER (WHERE x.attendance_type = 'WORK_FROM_HOME')::int AS wfh,
             count(*) FILTER (WHERE x.attendance_type = 'HALF_DAY')::int AS "halfDay",
             count(*) FILTER (WHERE x.attendance_type = 'ABSENT')::int AS absent
      FROM (
        SELECT a.attendance_type, ${DEPARTMENT('u')} AS department,
               to_char(date_trunc('week', a.date), 'YYYY-MM-DD') AS week
        FROM attendance_logs a
        JOIN users u ON u.id = a.user_id
        WHERE a.organization_id = :organizationId AND a.date BETWEEN :since AND :until ${scopeTo('a', memberIds)}
      ) x
      GROUP BY GROUPING SETS ((x.department), (x.week), ())
      ORDER BY grain, x.department, x.week`, { organizationId, memberIds, since, until });
  }

  // WFH requests created in the period, by status (calendar days requested)
  async wfhRequestsByStatus({ organizationId, memberIds = null, since }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT w.status,
             count(*)::int AS requests,
             COALESCE(sum((w.end_date - w.start_date + 1) * CASE WHEN w.is_half_day THEN 0.5 ELSE 1 END), 0)::float8 AS days
      FROM wfh_requests w
      WHERE w.organization_id = :organizationId AND w.created_at >= :since ${scopeTo('w', memberIds)}
      GROUP BY w.status`, { organizationId, memberIds, since });
  }

  // Overtime = minutes beyond the standard day. Per week, per department and in total
  // (GROUPING SETS again), only counting days with a recorded working time.
  async overtime({ organizationId, memberIds = null, since, standardMinutes }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT CASE WHEN GROUPING(x.department) = 0 THEN 'department'
                  WHEN GROUPING(x.week) = 0 THEN 'week'
                  ELSE 'total' END AS grain,
             x.department, x.week,
             COALESCE(sum(GREATEST(x.working_minutes - :standardMinutes, 0)), 0)::float8 AS "overtimeMinutes",
             count(*) FILTER (WHERE x.working_minutes > :standardMinutes)::int AS "overtimeDays",
             count(DISTINCT x.user_id) FILTER (WHERE x.working_minutes > :standardMinutes)::int AS "employeesWithOvertime",
             count(*)::int AS "workedDays",
             COALESCE(sum(x.working_minutes), 0)::float8 AS "workingMinutes"
      FROM (
        SELECT a.user_id, a.working_minutes, ${DEPARTMENT('u')} AS department,
               to_char(date_trunc('week', a.date), 'YYYY-MM-DD') AS week
        FROM attendance_logs a
        JOIN users u ON u.id = a.user_id
        WHERE a.organization_id = :organizationId AND a.date >= :since
          AND a.working_minutes > 0 ${scopeTo('a', memberIds)}
      ) x
      GROUP BY GROUPING SETS ((x.department), (x.week), ())
      ORDER BY grain, x.department, x.week`, { organizationId, memberIds, since, standardMinutes });
  }

  async topOvertime({ organizationId, memberIds = null, since, standardMinutes, limit = 10 }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT a.user_id AS "userId", u.name, ${DEPARTMENT('u')} AS department,
             sum(GREATEST(a.working_minutes - :standardMinutes, 0))::float8 AS "overtimeMinutes",
             count(*) FILTER (WHERE a.working_minutes > :standardMinutes)::int AS "overtimeDays"
      FROM attendance_logs a
      JOIN users u ON u.id = a.user_id
      WHERE a.organization_id = :organizationId AND a.date >= :since
        AND a.working_minutes > 0 ${scopeTo('a', memberIds)}
      GROUP BY a.user_id, u.name, u.department
      HAVING sum(GREATEST(a.working_minutes - :standardMinutes, 0)) > 0
      ORDER BY 4 DESC
      LIMIT :limit`, { organizationId, memberIds, since, standardMinutes, limit });
  }

  // ---- Leave ----

  // Leave requests created since `since`, counted by department x month x status x type.
  // A few dozen rows that the service folds into every leave chart.
  leaveBreakdown({ organizationId, since }) {
    return this.select(`
      SELECT NULLIF(u.department, '') AS department,
             to_char(l.created_at, 'YYYY-MM') AS month,
             l.status, l.leave_type AS "leaveType",
             count(*)::int AS requests,
             COALESCE(sum(l.day_count), 0)::float8 AS days
      FROM leave_requests l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.organization_id = :organizationId AND l.created_at >= :since
      GROUP BY 1, 2, 3, 4`, { organizationId, since });
  }

  // Approved days per leave type for leaves starting in the year (same rule as balances)
  approvedLeaveDaysByType({ organizationId, year }) {
    return this.select(`
      SELECT l.leave_type AS "leaveType", COALESCE(sum(l.day_count), 0)::float8 AS days
      FROM leave_requests l
      WHERE l.organization_id = :organizationId AND l.status = 'APPROVED'
        AND l.start_date >= make_date(:year, 1, 1) AND l.start_date < make_date(:year + 1, 1, 1)
      GROUP BY 1`, { organizationId, year });
  }

  // ---- Approvals ----

  // How fast requests get decided, per kind and overall (ROLLUP -> kind NULL is the total):
  // average, median, p90, share decided within the SLA, plus the open backlog.
  // A request counts once decided (APPROVED/REJECTED; approved_at is the decision time for both).
  async approvalTurnaround({ organizationId, memberIds = null, since, slaHours }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      WITH requests AS (${APPROVAL_REQUESTS}),
      scoped AS (
        SELECT r.*,
               EXTRACT(EPOCH FROM r.approved_at - r.created_at) / 3600.0 AS hours,
               (r.status IN ('APPROVED', 'REJECTED') AND r.approved_at IS NOT NULL AND r.created_at >= :since) AS decided
        FROM requests r
        WHERE (r.created_at >= :since OR r.status = 'PENDING') ${scopeTo('r', memberIds)}
      )
      SELECT kind,
             count(*) FILTER (WHERE decided)::int AS decided,
             count(*) FILTER (WHERE decided AND status = 'APPROVED')::int AS approved,
             count(*) FILTER (WHERE decided AND status = 'REJECTED')::int AS rejected,
             avg(hours) FILTER (WHERE decided)::float8 AS "avgHours",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) FILTER (WHERE decided) AS "medianHours",
             percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) FILTER (WHERE decided) AS "p90Hours",
             count(*) FILTER (WHERE decided AND hours <= :slaHours)::int AS "withinSla",
             count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
             (max(EXTRACT(EPOCH FROM now() - created_at)) FILTER (WHERE status = 'PENDING') / 3600.0)::float8 AS "oldestPendingHours"
      FROM scoped
      GROUP BY ROLLUP (kind)
      ORDER BY kind NULLS LAST`, { organizationId, memberIds, since, slaHours });
  }

  async approvalTurnaroundByApprover({ organizationId, memberIds = null, since, limit = 20 }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      WITH requests AS (${APPROVAL_REQUESTS})
      SELECT r.approved_by AS "approverId", u.name AS "approverName",
             count(*)::int AS decided,
             avg(EXTRACT(EPOCH FROM r.approved_at - r.created_at) / 3600.0)::float8 AS "avgHours",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM r.approved_at - r.created_at) / 3600.0) AS "medianHours"
      FROM requests r
      LEFT JOIN users u ON u.id = r.approved_by
      WHERE r.status IN ('APPROVED', 'REJECTED') AND r.approved_at IS NOT NULL
        AND r.created_at >= :since ${scopeTo('r', memberIds)}
      GROUP BY r.approved_by, u.name
      ORDER BY decided DESC
      LIMIT :limit`, { organizationId, memberIds, since, limit });
  }

  // ---- Employee lifecycle ----

  // Joiners per month (hire date, else account creation)
  joinersByMonth({ organizationId, since }) {
    return this.select(`
      SELECT to_char(date_trunc('month', COALESCE(hire_date, created_at::date)), 'YYYY-MM') AS month,
             count(*)::int AS count
      FROM users
      WHERE organization_id = :organizationId AND COALESCE(hire_date, created_at::date) >= :since
      GROUP BY 1`, { organizationId, since });
  }

  // Exits per month: deactivation time recorded in metadata (UserService), else updated_at
  // for accounts deactivated before that was recorded
  exitsByMonth({ organizationId, since }) {
    return this.select(`
      SELECT to_char(date_trunc('month', x.left_at), 'YYYY-MM') AS month, count(*)::int AS count
      FROM (
        SELECT COALESCE((metadata->>'deactivatedAt')::timestamptz, updated_at) AS left_at
        FROM users
        WHERE organization_id = :organizationId AND NOT is_active
      ) x
      WHERE x.left_at >= :since
      GROUP BY 1`, { organizationId, since });
  }

  // Active headcount and tenure buckets per department; ROLLUP adds the org total (department NULL)
  headcountAndTenure({ organizationId }) {
    return this.select(`
      SELECT x.department,
             count(*)::int AS headcount,
             count(*) FILTER (WHERE x.tenure < interval '1 year')::int AS "under1y",
             count(*) FILTER (WHERE x.tenure >= interval '1 year' AND x.tenure < interval '3 years')::int AS "from1to3y",
             count(*) FILTER (WHERE x.tenure >= interval '3 years' AND x.tenure < interval '5 years')::int AS "from3to5y",
             count(*) FILTER (WHERE x.tenure >= interval '5 years')::int AS "over5y"
      FROM (
        SELECT ${DEPARTMENT('u')} AS department,
               age(current_date, COALESCE(u.hire_date, u.created_at::date)) AS tenure
        FROM users u
        WHERE u.organization_id = :organizationId AND u.is_active
      ) x
      GROUP BY ROLLUP (x.department)
      ORDER BY x.department NULLS LAST`, { organizationId });
  }

  // ---- One employee ----

  async personalAttendance({ organizationId, userId, since, until, standardMinutes }) {
    const [row] = await this.select(`
      SELECT count(*)::int AS recorded,
             count(*) FILTER (WHERE attendance_type <> 'ABSENT')::int AS present,
             count(*) FILTER (WHERE attendance_type = 'LATE')::int AS late,
             count(*) FILTER (WHERE attendance_type = 'WORK_FROM_HOME')::int AS wfh,
             count(*) FILTER (WHERE attendance_type = 'HALF_DAY')::int AS "halfDay",
             count(*) FILTER (WHERE attendance_type = 'ABSENT')::int AS absent,
             COALESCE(avg(working_minutes) FILTER (WHERE working_minutes > 0), 0)::float8 AS "avgWorkingMinutes",
             COALESCE(sum(GREATEST(working_minutes - :standardMinutes, 0)), 0)::float8 AS "overtimeMinutes",
             COALESCE(sum(late_minutes), 0)::int AS "lateMinutes"
      FROM attendance_logs
      WHERE organization_id = :organizationId AND user_id = :userId AND date BETWEEN :since AND :until`,
    { organizationId, userId, since, until, standardMinutes });
    return row;
  }

  // Working days (per the shift's weekdays, Sunday = 0) in [since, until], and how many of
  // them the employee was on approved leave
  async workingAndLeaveDays({ organizationId, userId, since, until, workingDays }) {
    const [row] = await this.select(`
      WITH days AS (
        SELECT d::date AS day
        FROM generate_series(CAST(:since AS date), CAST(:until AS date), interval '1 day') d
        WHERE EXTRACT(DOW FROM d)::int IN (:workingDays)
      )
      SELECT (SELECT count(*) FROM days)::int AS "workingDays",
             (SELECT count(DISTINCT days.day)
                FROM days
                JOIN leave_requests l ON days.day BETWEEN l.start_date AND l.end_date
               WHERE l.organization_id = :organizationId AND l.user_id = :userId AND l.status = 'APPROVED')::int AS "leaveDays"`,
    { organizationId, userId, since, until, workingDays });
    return row;
  }

  // ---- Forecasting inputs ----

  // Daily organization (or one department) totals from the KPI store, working days only -
  // the training data for the attendance forecast
  dailyKpiTotals({ organizationId, department = null, since, until }) {
    return this.select(`
      SELECT kpi_date::text AS date,
             sum(headcount)::int AS headcount, sum(on_leave)::int AS "onLeave", sum(absent)::int AS absent,
             sum(present)::int AS present, sum(wfh)::int AS wfh
      FROM daily_kpis
      WHERE organization_id = :organizationId AND kpi_date BETWEEN :since AND :until AND is_working_day
        ${department ? 'AND department = :department' : ''}
      GROUP BY kpi_date
      ORDER BY kpi_date`, { organizationId, department, since, until });
  }

  // Active employees in scope: a member list (manager's team), a department, or the org
  async activeHeadcount({ organizationId, memberIds = null, department = null }) {
    if (noMembers(memberIds)) return 0;
    const [row] = await this.select(`
      SELECT count(*)::int AS n FROM users u
      WHERE u.organization_id = :organizationId AND u.is_active
        ${memberIds ? 'AND u.id IN (:memberIds)' : ''}
        ${department ? `AND ${DEPARTMENT('u')} = :department` : ''}`, { organizationId, memberIds, department });
    return row.n;
  }

  // Per future day: people with approved / pending leave covering it, and approved WFH
  // (distinct active employees in scope). Known in advance - the forecast's planned part.
  async bookedAbsenceByDay({ organizationId, memberIds = null, department = null, from, to }) {
    if (noMembers(memberIds)) return [];
    const scope = `
        u.organization_id = :organizationId AND u.is_active
        ${memberIds ? 'AND u.id IN (:memberIds)' : ''}
        ${department ? `AND ${DEPARTMENT('u')} = :department` : ''}`;
    return this.select(`
      WITH days AS (
        SELECT d::date AS day FROM generate_series(CAST(:from AS date), CAST(:to AS date), interval '1 day') d
      ),
      leave AS (
        SELECT l.user_id, l.start_date, l.end_date, l.status::text AS status
        FROM leave_requests l JOIN users u ON u.id = l.user_id
        WHERE l.organization_id = :organizationId AND l.status IN ('APPROVED', 'PENDING')
          AND l.end_date >= CAST(:from AS date) AND l.start_date <= CAST(:to AS date) AND ${scope}
      ),
      wfh AS (
        SELECT w.user_id, w.start_date, w.end_date
        FROM wfh_requests w JOIN users u ON u.id = w.user_id
        WHERE w.organization_id = :organizationId AND w.status = 'APPROVED'
          AND w.end_date >= CAST(:from AS date) AND w.start_date <= CAST(:to AS date) AND ${scope}
      )
      SELECT days.day::text AS date,
             (SELECT count(DISTINCT user_id) FROM leave WHERE status = 'APPROVED' AND days.day BETWEEN start_date AND end_date)::int AS "approvedLeave",
             (SELECT count(DISTINCT user_id) FROM leave WHERE status = 'PENDING' AND days.day BETWEEN start_date AND end_date)::int AS "pendingLeave",
             (SELECT count(DISTINCT user_id) FROM wfh WHERE days.day BETWEEN start_date AND end_date)::int AS "approvedWfh"
      FROM days
      ORDER BY days.day`, { organizationId, memberIds, department, from, to });
  }

  // Leave person-days per week (Monday-start) over working days, approved and pending
  // separately (half days count 0.5), plus the week's headcount: employees hired by the
  // week's end and not yet gone at its start. History and the booked future in one query.
  async weeklyLeave({ organizationId, memberIds = null, department = null, since, until, workingDays }) {
    if (noMembers(memberIds)) return [];
    const scope = `
        ${memberIds ? 'AND u.id IN (:memberIds)' : ''}
        ${department ? `AND ${DEPARTMENT('u')} = :department` : ''}`;
    return this.select(`
      WITH days AS (
        SELECT d::date AS day FROM generate_series(CAST(:since AS date), CAST(:until AS date), interval '1 day') d
        WHERE EXTRACT(DOW FROM d)::int IN (:workingDays)
      ),
      weeks AS (
        SELECT DISTINCT date_trunc('week', day)::date AS week FROM days
      ),
      leave_days AS (
        SELECT date_trunc('week', days.day)::date AS week, l.status::text AS status,
               sum(CASE WHEN l.is_half_day THEN 0.5 ELSE 1 END) AS days
        FROM leave_requests l
        JOIN users u ON u.id = l.user_id
        JOIN days ON days.day BETWEEN l.start_date AND l.end_date
        WHERE l.organization_id = :organizationId AND l.status IN ('APPROVED', 'PENDING') ${scope}
        GROUP BY 1, 2
      ),
      staff AS (
        SELECT COALESCE(u.hire_date, u.created_at::date) AS joined,
               CASE WHEN u.is_active THEN NULL
                    ELSE COALESCE((u.metadata->>'deactivatedAt')::date, u.updated_at::date) END AS left_on
        FROM users u
        WHERE u.organization_id = :organizationId ${scope}
      )
      SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
             COALESCE((SELECT days FROM leave_days ld WHERE ld.week = w.week AND ld.status = 'APPROVED'), 0)::float8 AS approved,
             COALESCE((SELECT days FROM leave_days ld WHERE ld.week = w.week AND ld.status = 'PENDING'), 0)::float8 AS pending,
             (SELECT count(*) FROM staff
               WHERE staff.joined <= w.week + 6 AND (staff.left_on IS NULL OR staff.left_on > w.week))::int AS headcount
      FROM weeks w
      ORDER BY w.week`, { organizationId, memberIds, department, since, until, workingDays });
  }

  // Approved person-days per leave type over a period - the expected mix of leave types
  leaveTypeMix({ organizationId, memberIds = null, department = null, since, until }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT l.leave_type AS "leaveType", COALESCE(sum(l.day_count), 0)::float8 AS days
      FROM leave_requests l JOIN users u ON u.id = l.user_id
      WHERE l.organization_id = :organizationId AND l.status = 'APPROVED'
        AND l.start_date BETWEEN :since AND :until
        ${memberIds ? 'AND u.id IN (:memberIds)' : ''}
        ${department ? `AND ${DEPARTMENT('u')} = :department` : ''}
      GROUP BY 1
      ORDER BY 2 DESC`, { organizationId, memberIds, department, since, until });
  }

  // Per active employee and leave type: approved + pending days for leaves starting in the
  // year (the balance rule) - for "how much leave expires unused at year end"
  leaveUsedByUserAndType({ organizationId, memberIds = null, department = null, year }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT u.id AS "userId", l.leave_type AS "leaveType",
             COALESCE(sum(l.day_count), 0)::float8 AS days
      FROM users u
      LEFT JOIN leave_requests l
        ON l.user_id = u.id AND l.organization_id = :organizationId AND l.status IN ('APPROVED', 'PENDING')
       AND l.start_date >= make_date(:year, 1, 1) AND l.start_date < make_date(:year + 1, 1, 1)
      WHERE u.organization_id = :organizationId AND u.is_active
        ${memberIds ? 'AND u.id IN (:memberIds)' : ''}
        ${department ? `AND ${DEPARTMENT('u')} = :department` : ''}
      GROUP BY u.id, l.leave_type`, { organizationId, memberIds, department, year });
  }

  // ---- Risk scoring inputs (one row per active employee in scope) ----
  //
  // Windows end yesterday (today is incomplete). An employee's windows start no earlier than
  // their hire date or their own first attendance record - days before they used attendance
  // here must not count as absence.
  //   expected   working days in the last 90 days, minus approved leave
  //   absent     expected days with no attendance (or an ABSENT log), plus unplanned leave
  //              (SICK / EMERGENCY / UNPAID) - the absence the Bradford Factor is about
  //   spells     separate runs of consecutive absent working days over 365 days (Bradford S)
  //   recent vs prior: absence + late rate in the last 30 vs the 60 days before
  async riskInputs({ organizationId, memberIds = null, department = null, today, workingDays, standardMinutes }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      WITH members AS (
        SELECT u.id, u.name, ${DEPARTMENT('u')} AS department, u.manager_id,
               -- From the employee's OWN first attendance record: accounts that never use
               -- attendance (admins, HR) have no days and aren't scored, instead of looking
               -- absent every day
               GREATEST(COALESCE(u.hire_date, u.created_at::date),
                        COALESCE((SELECT min(a.date) FROM attendance_logs a
                                  WHERE a.organization_id = :organizationId AND a.user_id = u.id), CAST(:today AS date)),
                        CAST(:today AS date) - 365) AS tracked_from
        FROM users u
        WHERE u.organization_id = :organizationId AND u.is_active
          ${memberIds ? 'AND u.id IN (:memberIds)' : ''}
          ${department ? `AND ${DEPARTMENT('u')} = :department` : ''}
      ),
      days AS (
        SELECT d::date AS day FROM generate_series(CAST(:today AS date) - 365, CAST(:today AS date) - 1, interval '1 day') d
        WHERE EXTRACT(DOW FROM d)::int IN (:workingDays)
      ),
      member_days AS (
        SELECT m.id, d.day,
               a.attendance_type::text AS att,
               a.working_minutes, a.late_minutes, a.check_in_time,
               lv.leave_type
        FROM members m
        JOIN days d ON d.day >= m.tracked_from
        LEFT JOIN attendance_logs a ON a.user_id = m.id AND a.organization_id = :organizationId AND a.date = d.day
        LEFT JOIN LATERAL (
          SELECT l.leave_type::text AS leave_type FROM leave_requests l
          WHERE l.user_id = m.id AND l.organization_id = :organizationId AND l.status = 'APPROVED'
            AND d.day BETWEEN l.start_date AND l.end_date
          ORDER BY (l.leave_type IN ('SICK', 'EMERGENCY', 'UNPAID')) DESC
          LIMIT 1
        ) lv ON true
      ),
      flagged AS (
        SELECT md.*,
               (md.leave_type IS NOT NULL AND md.leave_type NOT IN ('SICK', 'EMERGENCY', 'UNPAID')) AS planned_leave,
               ((md.att IS NULL OR md.att = 'ABSENT') AND (md.leave_type IS NULL OR md.leave_type IN ('SICK', 'EMERGENCY', 'UNPAID'))) AS absent,
               (md.att IS NOT NULL AND md.att <> 'ABSENT') AS present
        FROM member_days md
      ),
      islands AS (
        SELECT id, day, absent,
               row_number() OVER (PARTITION BY id ORDER BY day)
             - row_number() OVER (PARTITION BY id, absent ORDER BY day) AS grp
        FROM flagged
      ),
      bradford AS (
        SELECT id, count(DISTINCT grp) FILTER (WHERE absent)::int AS spells, count(*) FILTER (WHERE absent)::int AS days
        FROM islands GROUP BY id
      ),
      windows AS (
        SELECT f.id,
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 90 AND NOT f.planned_leave)::int AS expected90,
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 90 AND f.absent)::int AS absent90,
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 90 AND f.present)::int AS present90,
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 90 AND f.att = 'LATE')::int AS late90,
               COALESCE(avg(f.late_minutes) FILTER (WHERE f.day >= CAST(:today AS date) - 90 AND f.att = 'LATE'), 0)::float8 AS "avgLateMinutes",
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 30 AND NOT f.planned_leave)::int AS expected30,
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 30 AND (f.absent OR f.att = 'LATE'))::int AS issues30,
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 90 AND f.day < CAST(:today AS date) - 30 AND NOT f.planned_leave)::int AS "expectedPrior",
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 90 AND f.day < CAST(:today AS date) - 30 AND (f.absent OR f.att = 'LATE'))::int AS "issuesPrior",
               COALESCE(stddev_pop(EXTRACT(EPOCH FROM f.check_in_time) / 60) FILTER (WHERE f.day >= CAST(:today AS date) - 90), 0)::float8 AS "checkInSdMinutes",
               count(*) FILTER (WHERE f.day >= CAST(:today AS date) - 56 AND f.working_minutes > 0)::int AS "workedDays56",
               COALESCE(sum(GREATEST(f.working_minutes - :standardMinutes, 0)) FILTER (WHERE f.day >= CAST(:today AS date) - 56), 0)::float8 AS "overtimeMinutes56"
        FROM flagged f GROUP BY f.id
      )
      SELECT m.id AS "userId", m.name, m.department, m.manager_id AS "managerId", m.tracked_from::text AS "trackedFrom",
             COALESCE(w.expected90, 0) AS "expected90", COALESCE(w.absent90, 0) AS "absent90",
             COALESCE(w.present90, 0) AS "present90", COALESCE(w.late90, 0) AS "late90", COALESCE(w."avgLateMinutes", 0) AS "avgLateMinutes",
             COALESCE(w.expected30, 0) AS "expected30", COALESCE(w.issues30, 0) AS "issues30",
             COALESCE(w."expectedPrior", 0) AS "expectedPrior", COALESCE(w."issuesPrior", 0) AS "issuesPrior",
             COALESCE(w."checkInSdMinutes", 0) AS "checkInSdMinutes",
             COALESCE(w."workedDays56", 0) AS "workedDays56", COALESCE(w."overtimeMinutes56", 0) AS "overtimeMinutes56",
             COALESCE(b.spells, 0) AS "bradfordSpells", COALESCE(b.days, 0) AS "bradfordDays",
             (SELECT max(l.end_date)::text FROM leave_requests l
               WHERE l.user_id = m.id AND l.organization_id = :organizationId AND l.status = 'APPROVED'
                 AND l.end_date < CAST(:today AS date)) AS "lastLeaveEnded",
             (SELECT count(*) FROM ai_insights i
               WHERE i.user_id = m.id AND i.organization_id = :organizationId
                 AND i.insight_type IN ('ATTENDANCE_ANOMALY', 'BEHAVIORAL_PATTERN')
                 AND i.generated_at >= CAST(:today AS date) - 30)::int AS "recentAnomalies"
      FROM members m
      LEFT JOIN windows w ON w.id = m.id
      LEFT JOIN bradford b ON b.id = m.id
      ORDER BY m.name`, { organizationId, memberIds, department, today, workingDays, standardMinutes });
  }

  // The latest anomaly / pattern-shift insights (ai-anomaly-service) for one employee
  recentInsights({ organizationId, userId, since }) {
    return this.select(`
      SELECT insight_type AS "insightType", title, description, severity::text AS severity,
             score::float8 AS score, confidence::float8 AS confidence, generated_at AS "generatedAt"
      FROM ai_insights
      WHERE organization_id = :organizationId AND user_id = :userId AND generated_at >= :since
      ORDER BY generated_at DESC
      LIMIT 10`, { organizationId, userId, since });
  }

  // Approved and pending leave overlapping [from, to], with names - "who's off next week".
  // Scoped like everything else (manager: direct reports; HR: org, optionally a department).
  async leaveCalendar({ organizationId, memberIds = null, department = null, from, to, limit = 100 }) {
    if (noMembers(memberIds)) return [];
    return this.select(`
      SELECT u.name, ${DEPARTMENT('u')} AS department, l.leave_type AS "leaveType", l.status::text AS status,
             l.start_date::text AS "startDate", l.end_date::text AS "endDate", l.day_count::float8 AS days, l.is_half_day AS "halfDay"
      FROM leave_requests l
      JOIN users u ON u.id = l.user_id
      WHERE l.organization_id = :organizationId AND u.is_active
        AND l.status IN ('APPROVED', 'PENDING')
        AND l.start_date <= :to AND l.end_date >= :from
        ${memberIds ? 'AND u.id IN (:memberIds)' : ''}
        ${department ? `AND ${DEPARTMENT('u')} = :department` : ''}
      ORDER BY l.start_date, u.name
      LIMIT :limit`, { organizationId, memberIds, department, from, to, limit });
  }

  // ---- Report rows (one per employee) ----

  attendanceSummaryRows({ organizationId, managerId = null, since, until, workingDays, standardMinutes }) {
    return this.select(`
      WITH members AS (
        SELECT u.id, u.employee_id, u.name, ${DEPARTMENT('u')} AS department, u.designation
        FROM users u
        WHERE u.organization_id = :organizationId AND u.is_active
          ${managerId ? 'AND u.manager_id = :managerId' : ''}
      ),
      days AS (
        SELECT d::date AS day
        FROM generate_series(CAST(:since AS date), CAST(:until AS date), interval '1 day') d
        WHERE EXTRACT(DOW FROM d)::int IN (:workingDays)
      ),
      att AS (
        SELECT a.user_id,
               count(*) FILTER (WHERE a.attendance_type <> 'ABSENT')::int AS present,
               count(*) FILTER (WHERE a.attendance_type = 'LATE')::int AS late,
               count(*) FILTER (WHERE a.attendance_type = 'WORK_FROM_HOME')::int AS wfh,
               count(*) FILTER (WHERE a.attendance_type = 'HALF_DAY')::int AS half_day,
               avg(a.working_minutes) FILTER (WHERE a.working_minutes > 0) AS avg_minutes,
               COALESCE(sum(GREATEST(a.working_minutes - :standardMinutes, 0)), 0) AS overtime_minutes,
               COALESCE(sum(a.late_minutes), 0) AS late_minutes
        FROM attendance_logs a
        JOIN members m ON m.id = a.user_id
        WHERE a.organization_id = :organizationId AND a.date BETWEEN :since AND :until
        GROUP BY a.user_id
      ),
      lv AS (
        SELECT l.user_id, count(DISTINCT days.day)::int AS leave_days
        FROM leave_requests l
        JOIN members m ON m.id = l.user_id
        JOIN days ON days.day BETWEEN l.start_date AND l.end_date
        WHERE l.organization_id = :organizationId AND l.status = 'APPROVED'
        GROUP BY l.user_id
      )
      SELECT m.employee_id AS "employeeId", m.name, m.department, m.designation,
             (SELECT count(*) FROM days)::int AS "workingDays",
             COALESCE(att.present, 0) AS "daysPresent",
             COALESCE(att.late, 0) AS "daysLate",
             COALESCE(att.wfh, 0) AS "daysWfh",
             COALESCE(att.half_day, 0) AS "halfDays",
             COALESCE(lv.leave_days, 0) AS "leaveDays",
             round(COALESCE(att.avg_minutes, 0) / 60.0, 2)::float8 AS "avgHours",
             round(COALESCE(att.overtime_minutes, 0) / 60.0, 2)::float8 AS "overtimeHours",
             COALESCE(att.late_minutes, 0)::int AS "lateMinutes"
      FROM members m
      LEFT JOIN att ON att.user_id = m.id
      LEFT JOIN lv ON lv.user_id = m.id
      ORDER BY m.department, m.name`,
    { organizationId, managerId, since, until, workingDays, standardMinutes });
  }

  // Leaves starting in the period, per employee x type x status (LEFT JOIN: employees with
  // no leave still get a row, with leaveType NULL)
  leaveSummaryRows({ organizationId, managerId = null, since, until }) {
    return this.select(`
      SELECT u.id AS "userId", u.employee_id AS "employeeId", u.name, ${DEPARTMENT('u')} AS department,
             l.leave_type AS "leaveType", l.status,
             count(l.id)::int AS requests,
             COALESCE(sum(l.day_count), 0)::float8 AS days
      FROM users u
      LEFT JOIN leave_requests l
        ON l.user_id = u.id AND l.organization_id = :organizationId
       AND l.status IN ('APPROVED', 'PENDING')
       AND l.start_date BETWEEN :since AND :until
      WHERE u.organization_id = :organizationId AND u.is_active
        ${managerId ? 'AND u.manager_id = :managerId' : ''}
      GROUP BY u.id, u.employee_id, u.name, u.department, l.leave_type, l.status
      ORDER BY 4, 3`, { organizationId, managerId, since, until });
  }
}

module.exports = AnalyticsRepository;
