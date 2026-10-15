const repositories = require('../repositories');
const AttendanceService = require('./AttendanceService');
const LeaveService = require('./LeaveService');
const { todayStr, daysAgoStr } = require('../utils/dates');
const { ROLES, IS_HR_UP } = require('../config/constants');
const { defaultSettingsProvider } = require('../config/organizationSettings');
const {
  memberScope, percent, round2, periodToDays, STANDARD_WORKDAY_MINUTES, DEFAULT_WORKING_DAYS
} = require('./analyticsScope');

const MAX_LIFECYCLE_MONTHS = 36;

const round1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const scopeName = (user) => (IS_HR_UP.includes(user.role) ? 'organization' : user.role === ROLES.MANAGER ? 'team' : 'self');

// The last `months` calendar months, oldest first, as YYYY-MM
function lastMonths(months, now = new Date()) {
  const list = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return list;
}

// Workforce metrics computed by SQL aggregation (AnalyticsRepository): work mode / WFH,
// approval turnaround, overtime, employee lifecycle, leave utilization and an employee's own
// summary. Everything is role-scoped through memberScope(): HR/Admin see the organization,
// managers their direct reports, employees themselves.
class WorkforceMetricsService {
  constructor({ analyticsRepository, userRepository, attendanceService, leaveService, organizationSettings = defaultSettingsProvider, now = () => new Date() }) {
    this.organizationSettings = organizationSettings;
    this.analyticsRepository = analyticsRepository;
    this.userRepository = userRepository;
    this.attendanceService = attendanceService;
    this.leaveService = leaveService;
    this.now = now;
  }

  async workingDaysFor(organizationId) {
    const shift = await this.attendanceService.getDefaultShift(organizationId);
    return shift && Array.isArray(shift.workingDays) && shift.workingDays.length ? shift.workingDays : DEFAULT_WORKING_DAYS;
  }

  periodRange(period) {
    return { from: daysAgoStr(periodToDays(period) - 1), to: todayStr() };
  }

  // ---- Employee: my own numbers ----

  async getMySummary(user, { period = '30d' } = {}) {
    const { from, to } = this.periodRange(period);
    const base = { organizationId: user.organizationId, userId: user.id, since: from, until: to };
    const workingDays = await this.workingDaysFor(user.organizationId);

    const [attendance, days, balances] = await Promise.all([
      this.analyticsRepository.personalAttendance({ ...base, standardMinutes: STANDARD_WORKDAY_MINUTES }),
      this.analyticsRepository.workingAndLeaveDays({ ...base, workingDays }),
      this.leaveService.getLeaveBalance(user.id, user.organizationId)
    ]);

    // Days the employee was expected in: working days minus approved leave
    const expectedDays = Math.max(days.workingDays - days.leaveDays, 0);

    return {
      period: { from, to },
      workingDays: days.workingDays,
      leaveDays: days.leaveDays,
      daysPresent: attendance.present,
      daysLate: attendance.late,
      daysWfh: attendance.wfh,
      halfDays: attendance.halfDay,
      daysAbsent: attendance.absent,
      attendanceRate: Math.min(100, percent(attendance.present, expectedDays)),
      punctualityRate: percent(attendance.present - attendance.late, attendance.present),
      wfhRate: percent(attendance.wfh, attendance.present),
      avgWorkingHours: round2(attendance.avgWorkingMinutes / 60),
      overtimeHours: round2(attendance.overtimeMinutes / 60),
      avgLateMinutes: attendance.late ? Math.round(attendance.lateMinutes / attendance.late) : 0,
      leaveBalance: balances.map(b => ({
        leaveType: b.leaveType, allocated: b.allocated, carried: b.carried, used: b.used, pending: b.pending, remaining: b.remaining
      }))
    };
  }

  // ---- Work mode / WFH ----

  async getWorkMode(user, { period = '30d' } = {}) {
    const { from, to } = this.periodRange(period);
    const memberIds = await memberScope(user, this.userRepository);
    const scope = { organizationId: user.organizationId, memberIds };

    const [rows, requests] = await Promise.all([
      this.analyticsRepository.workMode({ ...scope, since: from, until: to }),
      this.analyticsRepository.wfhRequestsByStatus({ ...scope, since: from })
    ]);

    const shape = (r) => ({
      office: r.office,
      wfh: r.wfh,
      halfDay: r.halfDay,
      absent: r.absent,
      // share of attended days worked from home
      wfhRate: percent(r.wfh, r.office + r.wfh + r.halfDay)
    });
    const total = rows.find(r => r.grain === 'total') || { office: 0, wfh: 0, halfDay: 0, absent: 0 };

    return {
      period: { from, to },
      scope: scopeName(user),
      summary: shape(total),
      byDepartment: rows.filter(r => r.grain === 'department').map(r => ({ department: r.department, ...shape(r) })),
      weekly: rows.filter(r => r.grain === 'week').map(r => ({ week: r.week, ...shape(r) })),
      requests: Object.fromEntries(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map(status => {
        const r = requests.find(x => x.status === status);
        return [status.toLowerCase(), { requests: r ? r.requests : 0, days: r ? r.days : 0 }];
      }))
    };
  }

  // ---- Approval turnaround (managers and up) ----

  async getApprovalTurnaround(user, { period = '90d' } = {}) {
    const { from, to } = this.periodRange(period);
    const scope = {
      organizationId: user.organizationId,
      memberIds: await memberScope(user, this.userRepository),
      since: from
    };

    // "Within SLA" uses the organization's own target (settings.approvalSlaHours)
    const { approvalSlaHours: slaHours } = await this.organizationSettings.get(user.organizationId);
    const [rows, byApprover] = await Promise.all([
      this.analyticsRepository.approvalTurnaround({ ...scope, slaHours }),
      this.analyticsRepository.approvalTurnaroundByApprover(scope)
    ]);

    const shape = (r = {}) => ({
      decided: r.decided || 0,
      approved: r.approved || 0,
      rejected: r.rejected || 0,
      approvalRate: percent(r.approved || 0, r.decided || 0),
      avgHours: round1(r.avgHours),
      medianHours: round1(r.medianHours),
      p90Hours: round1(r.p90Hours),
      withinSlaRate: r.decided ? percent(r.withinSla, r.decided) : null,
      pending: r.pending || 0,
      oldestPendingHours: round1(r.oldestPendingHours)
    });

    return {
      period: { from, to },
      scope: scopeName(user),
      slaHours,
      overall: shape(rows.find(r => r.kind === null)),
      byKind: Object.fromEntries(['LEAVE', 'WFH', 'REGULARIZATION'].map(kind => [kind, shape(rows.find(r => r.kind === kind))])),
      byApprover: byApprover.map(a => ({
        approverId: a.approverId,
        approverName: a.approverName,
        decided: a.decided,
        avgHours: round1(a.avgHours),
        medianHours: round1(a.medianHours)
      }))
    };
  }

  // ---- Overtime ----

  async getOvertime(user, { period = '90d' } = {}) {
    const { from, to } = this.periodRange(period);
    const scope = {
      organizationId: user.organizationId,
      memberIds: await memberScope(user, this.userRepository),
      since: from,
      standardMinutes: STANDARD_WORKDAY_MINUTES
    };

    const [rows, top] = await Promise.all([
      this.analyticsRepository.overtime(scope),
      // Per-person ranking is for managers/HR; an employee's scope is only themselves anyway
      user.role === ROLES.EMPLOYEE ? [] : this.analyticsRepository.topOvertime(scope)
    ]);

    const shape = (r) => ({
      overtimeHours: round2(r.overtimeMinutes / 60),
      overtimeDays: r.overtimeDays,
      employeesWithOvertime: r.employeesWithOvertime,
      workedDays: r.workedDays,
      // how often a worked day runs over
      overtimeDayRate: percent(r.overtimeDays, r.workedDays),
      avgOvertimeHoursPerOvertimeDay: r.overtimeDays ? round2(r.overtimeMinutes / r.overtimeDays / 60) : 0
    });
    const empty = { overtimeMinutes: 0, overtimeDays: 0, employeesWithOvertime: 0, workedDays: 0 };

    return {
      period: { from, to },
      scope: scopeName(user),
      standardHours: STANDARD_WORKDAY_MINUTES / 60,
      summary: shape(rows.find(r => r.grain === 'total') || empty),
      weekly: rows.filter(r => r.grain === 'week').map(r => ({ week: r.week, ...shape(r) })),
      byDepartment: rows.filter(r => r.grain === 'department').map(r => ({ department: r.department, ...shape(r) })),
      topEmployees: top.map(t => ({
        userId: t.userId, name: t.name, department: t.department,
        overtimeHours: round2(t.overtimeMinutes / 60), overtimeDays: t.overtimeDays
      }))
    };
  }

  // ---- Employee lifecycle (HR) ----

  async getLifecycle(user, { months = 12 } = {}) {
    const count = Math.min(Math.max(Number(months) || 12, 1), MAX_LIFECYCLE_MONTHS);
    const monthList = lastMonths(count, this.now());
    const since = `${monthList[0]}-01`;
    const organizationId = user.organizationId;

    const [joiners, exits, heads] = await Promise.all([
      this.analyticsRepository.joinersByMonth({ organizationId, since }),
      this.analyticsRepository.exitsByMonth({ organizationId, since }),
      this.analyticsRepository.headcountAndTenure({ organizationId })
    ]);

    const joined = new Map(joiners.map(j => [j.month, j.count]));
    const left = new Map(exits.map(e => [e.month, e.count]));
    const total = heads.find(h => h.department === null) || { headcount: 0, under1y: 0, from1to3y: 0, from3to5y: 0, over5y: 0 };

    // Walk back from today's headcount: a month's closing headcount is the next month's
    // closing headcount minus that next month's joiners plus its exits
    let closing = total.headcount;
    const series = [];
    for (let i = monthList.length - 1; i >= 0; i -= 1) {
      const month = monthList[i];
      const j = joined.get(month) || 0;
      const e = left.get(month) || 0;
      series.unshift({ month, joiners: j, exits: e, headcount: closing });
      closing = closing - j + e;
    }

    const totalJoiners = series.reduce((s, m) => s + m.joiners, 0);
    const totalExits = series.reduce((s, m) => s + m.exits, 0);
    const avgHeadcount = series.reduce((s, m) => s + m.headcount, 0) / series.length;
    const tenure = (h) => ({ under1y: h.under1y, from1to3y: h.from1to3y, from3to5y: h.from3to5y, over5y: h.over5y });

    return {
      months: series,
      headcount: total.headcount,
      totals: {
        joiners: totalJoiners,
        exits: totalExits,
        netChange: totalJoiners - totalExits,
        // exits as a share of the average headcount over the window
        attritionRate: avgHeadcount ? percent(totalExits, avgHeadcount) : 0
      },
      tenure: tenure(total),
      byDepartment: heads.filter(h => h.department !== null).map(h => ({
        department: h.department, headcount: h.headcount, tenure: tenure(h)
      }))
    };
  }

  // ---- Leave utilization (HR) ----

  getLeaveUtilization(user, { year } = {}) {
    return this.leaveService.getLeaveUtilization(user.organizationId, Number(year) || this.now().getFullYear());
  }
}

module.exports = new WorkforceMetricsService({
  ...repositories,
  attendanceService: AttendanceService,
  leaveService: LeaveService,
  organizationSettings: require('./OrganizationService').settingsProvider
});
module.exports.WorkforceMetricsService = WorkforceMetricsService;
module.exports.lastMonths = lastMonths;
