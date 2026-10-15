const { randomUUID } = require('crypto');
const repositories = require('../repositories');
const AttendanceService = require('./AttendanceService');
const NotificationService = require('./NotificationService');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { REPORT_TYPES } = require('../events/contracts/report');
const { toCsv } = require('../utils/csv');
const { todayStr, eachDate, monthRange } = require('../utils/dates');
const { ROLES, IS_HR_UP, LEAVE_TYPES } = require('../config/constants');
const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const { percent, round2, STANDARD_WORKDAY_MINUTES, DEFAULT_WORKING_DAYS } = require('./analyticsScope');

const MAX_REPORT_DAYS = 366;

const REPORT_LABELS = {
  'attendance-summary': 'Attendance summary',
  'leave-summary': 'Leave summary'
};

// Database connectivity problems are worth a retry (the consumer retries, then dead-letters);
// anything else is a deterministic failure, recorded on the report instead
const isTransient = (error) => /^Sequelize(Connection|ConnectionRefused|HostNotFound|HostNotReachable|ConnectionTimedOut|ConnectionAcquireTimeout)/.test(error.name || '');

// Persisted workforce reports.
//
//   POST /analytics/reports  -> report row (PENDING) + REPORT_REQUESTED event, one transaction
//   report worker            -> generate(): SQL aggregation -> CSV -> READY, notify requester
//   GET  .../:id/download    -> the stored CSV
//
// Generating in the worker keeps a year-long, whole-organization report out of the request
// path, and storing the result means it can be downloaded again without recomputing.
// Managers' reports cover only their direct reports; HR/Admin's the whole organization.
class ReportService {
  constructor({
    reportRepository,
    analyticsRepository,
    organizationRepository,
    userRepository,
    attendanceService,
    notifier,
    publish,
    withTransaction = (fn) => fn(),
    newId = randomUUID,
    now = () => new Date(),
    logger = console
  }) {
    this.reportRepository = reportRepository;
    this.analyticsRepository = analyticsRepository;
    this.organizationRepository = organizationRepository;
    this.userRepository = userRepository;
    this.attendanceService = attendanceService;
    this.notifier = notifier;
    this.publish = publish;
    this.withTransaction = withTransaction;
    this.newId = newId;
    this.now = now;
    this.logger = logger;
  }

  scopeFor(user) {
    return user.role === ROLES.MANAGER ? user.id : null;
  }

  // ---- Requesting ----

  async requestReport(user, { reportType, from, to }) {
    if (!REPORT_TYPES.includes(reportType)) {
      throw new ValidationError(`reportType must be one of ${REPORT_TYPES.join(', ')}`);
    }
    if (from > to) throw new ValidationError('from must be on or before to');
    if (to > todayStr()) throw new ValidationError('A report can only cover days up to today');
    if (eachDate(from, to).length > MAX_REPORT_DAYS) throw new ValidationError(`A report can cover at most ${MAX_REPORT_DAYS} days`);

    const id = this.newId();
    const report = {
      id,
      organizationId: user.organizationId,
      reportType,
      periodStart: from,
      periodEnd: to,
      scopeManagerId: this.scopeFor(user),
      requestedBy: user.id
    };

    // Row and event commit together: no report stuck PENDING without an event, no event
    // for a report that doesn't exist
    await this.withTransaction(async () => {
      await this.reportRepository.create(report);
      await this.publish(EVENT_TYPES.REPORT_REQUESTED, user.organizationId, {
        reportId: id, reportType, periodStart: from, periodEnd: to, requestedBy: user.id
      });
    });

    return this.reportRepository.findInOrg(id, user.organizationId);
  }

  // Monthly schedule: last month's attendance summary for every active organization.
  // Idempotent - the unique index on scheduled reports makes a re-run (restart, second
  // replica, catch-up on startup) a no-op for org-months that already have one.
  async scheduleMonthlyReports() {
    const now = this.now();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const { start, end } = monthRange(lastMonth.getFullYear(), lastMonth.getMonth() + 1);
    const reportType = 'attendance-summary';

    const orgs = await this.organizationRepository.findAllActive();
    let queued = 0;
    for (const org of orgs) {
      const id = this.newId();
      const created = await this.withTransaction(async () => {
        const inserted = await this.reportRepository.create({
          id, organizationId: org.id, reportType, periodStart: start, periodEnd: end
        });
        if (inserted) {
          await this.publish(EVENT_TYPES.REPORT_REQUESTED, org.id, {
            reportId: id, reportType, periodStart: start, periodEnd: end, requestedBy: null
          });
        }
        return inserted;
      });
      if (created) queued += 1;
    }
    return { period: `${start}..${end}`, organizations: orgs.length, queued };
  }

  // ---- Generating (report worker) ----

  // Safe to call more than once for the same report: the row is locked while generating and
  // only a PENDING report is generated - a redelivered event finds it READY and does nothing.
  async generate(reportId) {
    let result;
    try {
      result = await this.withTransaction(async () => {
        const report = await this.reportRepository.findForGeneration(reportId);
        if (!report || report.status !== 'PENDING') return { skipped: true, report };

        const { rows, summary } = await this.buildRows(report);
        await this.reportRepository.markReady(report.id, { summary, rowCount: rows.length, content: toCsv(rows) });
        return { report, summary, rowCount: rows.length };
      });
    } catch (error) {
      if (isTransient(error)) throw error; // let the consumer retry
      this.logger.error(`[reports] ${reportId} failed: ${error.message}`);
      await this.reportRepository.markFailed(reportId, error.message);
      return { failed: true, error: error.message };
    }

    if (!result.skipped) await this.notifyReady(result.report, result.rowCount);
    return result;
  }

  async buildRows(report) {
    const shift = await this.attendanceService.getDefaultShift(report.organizationId);
    const workingDays = shift && Array.isArray(shift.workingDays) && shift.workingDays.length ? shift.workingDays : DEFAULT_WORKING_DAYS;
    const params = {
      organizationId: report.organizationId,
      managerId: report.scopeManagerId,
      since: report.periodStart,
      until: report.periodEnd
    };

    if (report.reportType === 'attendance-summary') {
      const rows = (await this.analyticsRepository.attendanceSummaryRows({
        ...params, workingDays, standardMinutes: STANDARD_WORKDAY_MINUTES
      })).map(r => ({
        ...r,
        attendanceRate: Math.min(100, percent(r.daysPresent, Math.max(r.workingDays - r.leaveDays, 0)))
      }));

      const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
      return {
        rows,
        summary: {
          employees: rows.length,
          avgAttendanceRate: rows.length ? Math.round((sum('attendanceRate') / rows.length) * 10) / 10 : 0,
          totalLateDays: sum('daysLate'),
          totalWfhDays: sum('daysWfh'),
          totalLeaveDays: sum('leaveDays'),
          totalOvertimeHours: round2(sum('overtimeHours'))
        }
      };
    }

    if (report.reportType === 'leave-summary') {
      return pivotLeaveRows(await this.analyticsRepository.leaveSummaryRows(params));
    }

    throw new Error(`Unknown report type ${report.reportType}`);
  }

  async notifyReady(report, rowCount) {
    const label = REPORT_LABELS[report.reportType] || report.reportType;
    const message = {
      category: 'SYSTEM',
      title: `${label} ready`,
      message: `${label} for ${report.periodStart} to ${report.periodEnd} is ready to download (${rowCount} employees).`,
      link: '/analytics',
      metadata: { reportId: report.id }
    };

    if (report.requestedBy) {
      await this.notifier.notify(report.requestedBy, report.organizationId, message);
    } else {
      const hr = await this.userRepository.findActiveByRoles(report.organizationId, IS_HR_UP);
      await this.notifier.notifyMany(hr.map(u => u.id), report.organizationId, message);
    }
  }

  // ---- Reading ----

  list(user) {
    return this.reportRepository.list({ organizationId: user.organizationId, scopeManagerId: this.scopeFor(user) });
  }

  async get(user, id, options = {}) {
    const report = await this.reportRepository.findInOrg(id, user.organizationId, options);
    if (!report) throw new NotFoundError('Report not found');
    // Managers only see reports scoped to their own team
    if (user.role === ROLES.MANAGER && report.scopeManagerId !== user.id) {
      throw new ForbiddenError('Managers can only view their own team\'s reports');
    }
    return report;
  }

  async getDownload(user, id) {
    const report = await this.get(user, id, { withContent: true });
    if (report.status !== 'READY') throw new ConflictError(`Report is ${report.status.toLowerCase()}, not ready to download`);
    return {
      filename: `${report.reportType}_${report.periodStart}_${report.periodEnd}.csv`,
      content: report.content
    };
  }
}

// employee x type x status rows -> one row per employee with a column per leave type.
// Every row gets every column (CSV headers come from the first row).
function pivotLeaveRows(raw) {
  const typesPresent = new Set(raw.filter(r => r.leaveType).map(r => r.leaveType));
  const types = LEAVE_TYPES.filter(t => typesPresent.has(t));
  const byUser = new Map();

  raw.forEach(r => {
    if (!byUser.has(r.userId)) {
      const row = { employeeId: r.employeeId, name: r.name, department: r.department };
      types.forEach(t => { row[t] = 0; });
      row.totalApprovedDays = 0;
      row.pendingDays = 0;
      byUser.set(r.userId, row);
    }
    const row = byUser.get(r.userId);
    if (!r.leaveType) return;
    if (r.status === 'APPROVED') {
      row[r.leaveType] += r.days;
      row.totalApprovedDays += r.days;
    } else if (r.status === 'PENDING') {
      row.pendingDays += r.days;
    }
  });

  const rows = [...byUser.values()];
  const byType = Object.fromEntries(types.map(t => [t, rows.reduce((s, r) => s + r[t], 0)]));
  return {
    rows,
    summary: {
      employees: rows.length,
      employeesWithLeave: rows.filter(r => r.totalApprovedDays > 0).length,
      totalApprovedDays: rows.reduce((s, r) => s + r.totalApprovedDays, 0),
      totalPendingDays: rows.reduce((s, r) => s + r.pendingDays, 0),
      byType
    }
  };
}

module.exports = new ReportService({
  ...repositories,
  attendanceService: AttendanceService,
  notifier: NotificationService,
  publish: outboxPublish,
  withTransaction: dbTransaction
});
module.exports.ReportService = ReportService;
module.exports.pivotLeaveRows = pivotLeaveRows;
