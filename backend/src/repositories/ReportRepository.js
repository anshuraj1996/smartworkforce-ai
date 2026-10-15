const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// workforce_reports (migration 005). Raw SQL like the other migration-owned tables.
// Lists never include `content` (the CSV) - only the download does.

const SUMMARY_COLUMNS = `
  id, report_type AS "reportType", period_start::text AS "periodStart", period_end::text AS "periodEnd",
  scope_manager_id AS "scopeManagerId", requested_by AS "requestedBy", status, summary,
  row_count AS "rowCount", error, created_at AS "createdAt", completed_at AS "completedAt"`;

class ReportRepository {
  // Returns false when a scheduled report for that org/type/period already exists
  // (partial unique index) - so a re-run of the monthly job doesn't queue it twice
  async create({ id, organizationId, reportType, periodStart, periodEnd, scopeManagerId = null, requestedBy = null }) {
    const [rows] = await sequelize.query(`
      INSERT INTO workforce_reports (id, organization_id, report_type, period_start, period_end, scope_manager_id, requested_by)
      VALUES (:id, :organizationId, :reportType, :periodStart, :periodEnd, :scopeManagerId, :requestedBy)
      ON CONFLICT DO NOTHING
      RETURNING id`,
    { replacements: { id, organizationId, reportType, periodStart, periodEnd, scopeManagerId, requestedBy } });
    return rows.length > 0;
  }

  // Locked: two deliveries of the same event can't generate the report concurrently
  async findForGeneration(id) {
    const [row] = await sequelize.query(`
      SELECT id, organization_id AS "organizationId", report_type AS "reportType",
             period_start::text AS "periodStart", period_end::text AS "periodEnd",
             scope_manager_id AS "scopeManagerId", requested_by AS "requestedBy", status
      FROM workforce_reports WHERE id = :id
      FOR UPDATE`, { replacements: { id }, type: QueryTypes.SELECT });
    return row || null;
  }

  async markReady(id, { summary, rowCount, content }) {
    await sequelize.query(`
      UPDATE workforce_reports
      SET status = 'READY', summary = :summary, row_count = :rowCount, content = :content,
          error = NULL, completed_at = now()
      WHERE id = :id`,
    { replacements: { id, summary: JSON.stringify(summary), rowCount, content } });
  }

  async markFailed(id, error) {
    await sequelize.query(`
      UPDATE workforce_reports SET status = 'FAILED', error = :error, completed_at = now() WHERE id = :id`,
    { replacements: { id, error: String(error).slice(0, 1000) } });
  }

  // Newest first. requestedBy/scopeManagerId narrow it for managers (their own + their team's).
  list({ organizationId, scopeManagerId, limit = 50 }) {
    return sequelize.query(`
      SELECT ${SUMMARY_COLUMNS}
      FROM workforce_reports
      WHERE organization_id = :organizationId
        ${scopeManagerId ? 'AND scope_manager_id = :scopeManagerId' : ''}
      ORDER BY created_at DESC
      LIMIT :limit`,
    { replacements: { organizationId, scopeManagerId, limit }, type: QueryTypes.SELECT });
  }

  async findInOrg(id, organizationId, { withContent = false } = {}) {
    const [row] = await sequelize.query(`
      SELECT ${SUMMARY_COLUMNS}${withContent ? ', content' : ''}
      FROM workforce_reports
      WHERE id = :id AND organization_id = :organizationId`,
    { replacements: { id, organizationId }, type: QueryTypes.SELECT });
    return row || null;
  }
}

module.exports = ReportRepository;
