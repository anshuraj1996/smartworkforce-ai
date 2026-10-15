const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// daily_kpis + kpi_refresh_queue (migration 005). Raw SQL: the recompute is one
// INSERT ... SELECT over several CTEs, and the queue needs FOR UPDATE SKIP LOCKED.
// Every query joins the ambient transaction (database/transaction.js).

const KPI_COLUMNS = [
  'headcount', 'present', 'late', 'wfh', 'half_day', 'on_leave', 'absent',
  'working_minutes', 'worked_days', 'overtime_minutes', 'late_minutes',
  'leave_requested', 'wfh_requested', 'requests_decided', 'decision_minutes'
];

const GRAINS = ['day', 'week', 'month'];

class KpiRepository {
  // Rebuild one organization-day from the source tables: delete its rows, insert fresh ones.
  // Run inside a transaction, so readers see the old rows or the new ones, never neither.
  //  - headcount: active employees hired by that day (today's headcount; history isn't kept)
  //  - absent: on working days only, whoever is neither present nor on leave
  //  - requests/decisions: by creation/decision time in the org's timezone
  async recomputeDay({ organizationId, date, timezone, standardMinutes }) {
    const replacements = { organizationId, day: date, tz: timezone, standardMinutes };

    await sequelize.query(
      'DELETE FROM daily_kpis WHERE organization_id = :organizationId AND kpi_date = :day',
      { replacements }
    );

    await sequelize.query(`
      WITH bounds AS (
        -- the org's local day as an instant range, so created_at/approved_at use their indexes
        SELECT (CAST(:day AS date)::timestamp AT TIME ZONE :tz) AS lo,
               ((CAST(:day AS date) + 1)::timestamp AT TIME ZONE :tz) AS hi
      ),
      settings AS (
        SELECT EXTRACT(DOW FROM CAST(:day AS date))::int = ANY (COALESCE(
          (SELECT working_days FROM shifts
            WHERE organization_id = :organizationId AND is_default AND is_active
            ORDER BY created_at LIMIT 1),
          ARRAY[1, 2, 3, 4, 5]
        )) AS working
      ),
      members AS (
        SELECT u.id, COALESCE(NULLIF(u.department, ''), 'Unassigned') AS department
        FROM users u
        WHERE u.organization_id = :organizationId AND u.is_active
          AND COALESCE(u.hire_date, (u.created_at AT TIME ZONE :tz)::date) <= CAST(:day AS date)
      ),
      heads AS (
        SELECT department, count(*)::int AS headcount FROM members GROUP BY department
      ),
      att AS (
        SELECT m.department,
               count(*) FILTER (WHERE a.attendance_type <> 'ABSENT')::int AS present,
               count(*) FILTER (WHERE a.attendance_type = 'LATE')::int AS late,
               count(*) FILTER (WHERE a.attendance_type = 'WORK_FROM_HOME')::int AS wfh,
               count(*) FILTER (WHERE a.attendance_type = 'HALF_DAY')::int AS half_day,
               COALESCE(sum(a.working_minutes), 0) AS working_minutes,
               count(*) FILTER (WHERE a.working_minutes > 0)::int AS worked_days,
               COALESCE(sum(GREATEST(a.working_minutes - :standardMinutes, 0)), 0) AS overtime_minutes,
               COALESCE(sum(a.late_minutes), 0) AS late_minutes
        FROM attendance_logs a
        JOIN members m ON m.id = a.user_id
        WHERE a.organization_id = :organizationId AND a.date = CAST(:day AS date)
        GROUP BY m.department
      ),
      lv AS (
        SELECT m.department, count(DISTINCT l.user_id)::int AS on_leave
        FROM leave_requests l
        JOIN members m ON m.id = l.user_id
        WHERE l.organization_id = :organizationId AND l.status = 'APPROVED'
          AND CAST(:day AS date) BETWEEN l.start_date AND l.end_date
        GROUP BY m.department
      ),
      requests AS (
        -- status::text: each table's status is a different enum type, UNION can't mix them
        SELECT 'LEAVE' AS kind, user_id, status::text AS status, created_at, approved_at FROM leave_requests
         WHERE organization_id = :organizationId
           AND (created_at >= (SELECT lo FROM bounds) OR approved_at >= (SELECT lo FROM bounds))
        UNION ALL
        SELECT 'WFH', user_id, status::text, created_at, approved_at FROM wfh_requests
         WHERE organization_id = :organizationId
           AND (created_at >= (SELECT lo FROM bounds) OR approved_at >= (SELECT lo FROM bounds))
        UNION ALL
        SELECT 'REGULARIZATION', user_id, status::text, created_at, approved_at FROM regularization_requests
         WHERE organization_id = :organizationId
           AND (created_at >= (SELECT lo FROM bounds) OR approved_at >= (SELECT lo FROM bounds))
      ),
      req AS (
        SELECT m.department,
               count(*) FILTER (WHERE r.kind = 'LEAVE' AND r.created_at >= b.lo AND r.created_at < b.hi)::int AS leave_requested,
               count(*) FILTER (WHERE r.kind = 'WFH' AND r.created_at >= b.lo AND r.created_at < b.hi)::int AS wfh_requested,
               count(*) FILTER (WHERE r.status IN ('APPROVED', 'REJECTED')
                                  AND r.approved_at >= b.lo AND r.approved_at < b.hi)::int AS requests_decided,
               COALESCE(sum(EXTRACT(EPOCH FROM r.approved_at - r.created_at) / 60)
                 FILTER (WHERE r.status IN ('APPROVED', 'REJECTED')
                           AND r.approved_at >= b.lo AND r.approved_at < b.hi), 0)::bigint AS decision_minutes
        FROM requests r
        JOIN members m ON m.id = r.user_id
        CROSS JOIN bounds b
        GROUP BY m.department
      )
      INSERT INTO daily_kpis (
        organization_id, kpi_date, department, is_working_day, ${KPI_COLUMNS.join(', ')}, computed_at
      )
      SELECT :organizationId, CAST(:day AS date), h.department, s.working,
             h.headcount,
             COALESCE(att.present, 0), COALESCE(att.late, 0), COALESCE(att.wfh, 0), COALESCE(att.half_day, 0),
             COALESCE(lv.on_leave, 0),
             CASE WHEN s.working
                  THEN GREATEST(h.headcount - COALESCE(att.present, 0) - COALESCE(lv.on_leave, 0), 0)
                  ELSE 0 END,
             COALESCE(att.working_minutes, 0), COALESCE(att.worked_days, 0),
             COALESCE(att.overtime_minutes, 0), COALESCE(att.late_minutes, 0),
             COALESCE(req.leave_requested, 0), COALESCE(req.wfh_requested, 0),
             COALESCE(req.requests_decided, 0), COALESCE(req.decision_minutes, 0),
             now()
      FROM heads h
      CROSS JOIN settings s
      LEFT JOIN att ON att.department = h.department
      LEFT JOIN lv ON lv.department = h.department
      LEFT JOIN req ON req.department = h.department`,
    { replacements });
  }

  // ---- Refresh queue ----

  // Idempotent: re-requesting a queued day just bumps requested_at. If the refresh worker
  // holds that row right now, this waits for it, then inserts afresh - so a change that
  // lands mid-recompute still gets its own recompute.
  async enqueue(items) {
    if (!items.length) return;
    const values = items.map((_, i) => `(:org${i}, CAST(:day${i} AS date))`).join(', ');
    const replacements = {};
    items.forEach(({ organizationId, date }, i) => {
      replacements[`org${i}`] = organizationId;
      replacements[`day${i}`] = date;
    });
    await sequelize.query(
      `INSERT INTO kpi_refresh_queue (organization_id, kpi_date) VALUES ${values}
       ON CONFLICT (organization_id, kpi_date) DO UPDATE SET requested_at = now()`,
      { replacements }
    );
  }

  // Oldest queued org-day, locked for this transaction. SKIP LOCKED lets several refresh
  // workers share the queue without waiting on (or double-computing) the same day.
  // organizationExists = false: the org was deleted - the caller just drops the row.
  async claimNext() {
    const [row] = await sequelize.query(`
      SELECT q.organization_id AS "organizationId", q.kpi_date::text AS date, o.timezone,
             (o.id IS NOT NULL) AS "organizationExists"
      FROM kpi_refresh_queue q
      LEFT JOIN organizations o ON o.id = q.organization_id
      WHERE q.requested_at <= now()
      ORDER BY q.requested_at
      LIMIT 1
      FOR UPDATE OF q SKIP LOCKED`, { type: QueryTypes.SELECT });
    return row || null;
  }

  async dequeue({ organizationId, date }) {
    await sequelize.query(
      'DELETE FROM kpi_refresh_queue WHERE organization_id = :organizationId AND kpi_date = :date',
      { replacements: { organizationId, date } }
    );
  }

  // A failed recompute goes to the back of the queue (with a delay) instead of blocking it
  async postpone({ organizationId, date }, seconds) {
    await sequelize.query(
      `UPDATE kpi_refresh_queue SET requested_at = now() + make_interval(secs => :seconds)
       WHERE organization_id = :organizationId AND kpi_date = :date`,
      { replacements: { organizationId, date, seconds } }
    );
  }

  async queueSummary() {
    const [row] = await sequelize.query(`
      SELECT count(*)::int AS queued,
             COALESCE(EXTRACT(EPOCH FROM now() - min(requested_at)), 0)::int AS "oldestSeconds"
      FROM kpi_refresh_queue`, { type: QueryTypes.SELECT });
    return row;
  }

  // ---- Reads ----

  // KPI sums per period (day/week/month) or per department over [from, to].
  // "*_wd" columns only count working days - they are the denominators for rates.
  series({ organizationId, from, to, grain = 'day', groupBy = 'period', department = null }) {
    if (!GRAINS.includes(grain)) throw new Error(`Unknown grain ${grain}`);
    const key = groupBy === 'department'
      ? 'department'
      : `to_char(date_trunc('${grain}', kpi_date), 'YYYY-MM-DD')`;

    return sequelize.query(`
      SELECT ${key} AS key,
             count(DISTINCT kpi_date)::int AS days,
             count(DISTINCT kpi_date) FILTER (WHERE is_working_day)::int AS "workingDays",
             COALESCE(sum(headcount) FILTER (WHERE is_working_day), 0)::int AS "headcountWd",
             COALESCE(sum(on_leave) FILTER (WHERE is_working_day), 0)::int AS "onLeaveWd",
             COALESCE(sum(present) FILTER (WHERE is_working_day), 0)::int AS "presentWd",
             ${KPI_COLUMNS.map(c => `COALESCE(sum(${c}), 0)::float8 AS "${c.replace(/_(\w)/g, (_, ch) => ch.toUpperCase())}"`).join(',\n             ')}
      FROM daily_kpis
      WHERE organization_id = :organizationId AND kpi_date BETWEEN :from AND :to
        ${department ? 'AND department = :department' : ''}
      GROUP BY 1
      ORDER BY 1`,
    { replacements: { organizationId, from, to, department }, type: QueryTypes.SELECT });
  }

  async lastComputedAt(organizationId) {
    const [row] = await sequelize.query(
      'SELECT max(computed_at) AS at FROM daily_kpis WHERE organization_id = :organizationId',
      { replacements: { organizationId }, type: QueryTypes.SELECT }
    );
    return row ? row.at : null;
  }
}

module.exports = KpiRepository;
module.exports.KPI_COLUMNS = KPI_COLUMNS;
module.exports.GRAINS = GRAINS;
