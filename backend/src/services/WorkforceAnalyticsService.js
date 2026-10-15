const os = require('os');
const repositories = require('../repositories');
const AnalyticsService = require('./AnalyticsService');
const AttendanceService = require('./AttendanceService');
const LeaveService = require('./LeaveService');
const { getMetrics } = require('../middleware/metrics');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_TTL, NAMESPACES } = require('../utils/cacheKeys');
const { consistencyScore, isPresent } = require('../utils/attendanceMetrics');
const { memberScope, periodToDays, STANDARD_WORKDAY_MINUTES } = require('./analyticsScope');
const { todayStr, daysAgoStr } = require('../utils/dates');
const { ROLES, IS_HR_UP } = require('../config/constants');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

const ONLINE_WINDOW_MS = 15 * 60000;

const severityFor = (score) => (score < 50 ? 'high' : score < 75 ? 'medium' : 'low');

const INSIGHT_KINDS = [
  { key: 'late', type: 'late_arrival_pattern', title: 'Late Arrival Pattern', actionable: (s) => s < 75 },
  { key: 'behavior', type: 'behavior_pattern', title: 'Work Behavior Pattern', actionable: () => false },
  { key: 'anomaly', type: 'anomaly_detection', title: 'Attendance Stability', actionable: (s) => s < 50 }
];

const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
};

// Role-scoped dashboards, reports and team/department comparisons built from attendance,
// leave and WFH data. Managers are always limited to their own direct reports.
class WorkforceAnalyticsService {
  constructor({
    userRepository,
    attendanceRepository,
    leaveRepository,
    wfhRepository,
    aiInsightRepository,
    healthRepository,
    analyticsRepository,
    insights,
    attendanceService,
    leaveService,
    getMetrics,
    cache
  }) {
    this.userRepository = userRepository;
    this.attendanceRepository = attendanceRepository;
    this.leaveRepository = leaveRepository;
    this.wfhRepository = wfhRepository;
    this.aiInsightRepository = aiInsightRepository;
    this.healthRepository = healthRepository;
    this.analyticsRepository = analyticsRepository;
    this.insights = insights;
    this.attendanceService = attendanceService;
    this.leaveService = leaveService;
    this.getMetrics = getMetrics;
    this.cache = cache;
  }

  // Member ids the user may see analytics for: a manager's direct reports, else the whole org
  scopedMemberIds(user) {
    return this.userRepository.findActiveMemberIds(user.organizationId, user.role === ROLES.MANAGER ? user.id : null);
  }

  // Scope for SQL aggregates: null = whole org (HR/Admin), else the member ids
  analyticsScope(user, period) {
    return memberScope(user, this.userRepository).then(memberIds => ({
      organizationId: user.organizationId,
      memberIds,
      since: daysAgoStr(periodToDays(period))
    }));
  }

  // A manager may only look at themselves/their own team; HR/Admin at anyone in the org
  assertCanViewTeam(user, teamManagerId) {
    if (user.role === ROLES.MANAGER && teamManagerId !== user.id) {
      throw new ForbiddenError('Managers can only view their own team');
    }
  }

  async assertCanViewUser(user, targetUserId) {
    const target = await this.userRepository.findInOrg(targetUserId, user.organizationId);
    if (!target) {
      throw new NotFoundError('User not found');
    }
    if (user.role === ROLES.MANAGER && target.managerId !== user.id && target.id !== user.id) {
      throw new ForbiddenError('Managers can only view their direct reports');
    }
    return target;
  }

  // ---- Dashboard ----

  getDashboard(user) {
    // Polled by every open dashboard. Cleared org-wide by the cache-invalidation worker on
    // attendance/leave/WFH/employee events; the short TTL caps staleness if that's down.
    return this.cache.withVersionedCache(
      NAMESPACES.workforce(user.organizationId),
      CACHE_KEYS.dashboard(user.organizationId, user.role, user.id),
      CACHE_TTL.dashboard,
      () => this.computeDashboard(user)
    );
  }

  async computeDashboard(user) {
    const today = todayStr();

    if (user.role === ROLES.EMPLOYEE) {
      const [todayLog, pendingLeaves] = await Promise.all([
        this.attendanceRepository.findForDay(user.id, today),
        this.leaveRepository.countPendingForUser(user.id)
      ]);

      return {
        totalEmployees: 0,
        presentToday: isPresent(todayLog) ? 1 : 0,
        lateToday: todayLog?.attendanceType === 'LATE' ? 1 : 0,
        absentToday: 0,
        pendingLeaves,
        attendanceRate: 0
      };
    }

    const memberIds = await this.scopedMemberIds(user);
    const [logs, pendingLeaves] = await Promise.all([
      this.attendanceRepository.findForUsersOnDate(memberIds, today),
      user.role === ROLES.MANAGER
        ? this.leaveRepository.countPendingForUsers(memberIds)
        : this.leaveRepository.countPendingForOrg(user.organizationId)
    ]);

    const presentToday = logs.filter(isPresent).length;

    const data = {
      totalEmployees: memberIds.length,
      presentToday,
      lateToday: logs.filter(l => l.attendanceType === 'LATE').length,
      absentToday: memberIds.length - presentToday,
      pendingLeaves,
      attendanceRate: memberIds.length ? Math.round((presentToday / memberIds.length) * 100 * 10) / 10 : 0
    };

    if (IS_HR_UP.includes(user.role)) {
      data.systemHealth = (await this.healthRepository.ping()).ok ? 100 : 0;
    }

    return data;
  }

  // No session tracking exists - approximated from recent logins instead of inventing a number
  countOnlineUsers(organizationId) {
    return this.userRepository.countLoggedInSince(organizationId, new Date(Date.now() - ONLINE_WINDOW_MS));
  }

  // ---- AI insights (computed live) ----

  // One attendance query for all users (was 3 per user)
  async buildInsights(users, organizationId) {
    const results = [];
    const insightsByUser = await this.insights.generateForUsers(users.map(u => u.id), organizationId);

    for (const user of users) {
      const byKey = insightsByUser.get(user.id) || {};

      INSIGHT_KINDS.forEach(kind => {
        const insight = byKey[kind.key];
        if (!insight) return;

        results.push({
          id: `${user.id}-${kind.type.replace(/_/g, '-')}`,
          userId: user.id,
          userName: user.name,
          insightType: kind.type,
          score: insight.score,
          title: kind.title,
          explanation: insight.metadata.explanation,
          severity: severityFor(insight.score),
          actionable: kind.actionable(insight.score),
          trend: 'stable',
          metadata: insight.metadata,
          generatedAt: new Date()
        });
      });
    }

    return results;
  }

  async getMyInsights(user) {
    const me = await this.userRepository.findById(user.id);
    return this.buildInsights([me], user.organizationId);
  }

  async getTeamInsights(user) {
    const users = await this.userRepository.findActiveMembers(user.organizationId, {
      managerId: user.role === ROLES.MANAGER ? user.id : null,
      limit: 15
    });
    return this.buildInsights(users, user.organizationId);
  }

  async getOrganizationInsights(user) {
    const users = await this.userRepository.findActiveMembers(user.organizationId, { limit: 25 });
    return this.buildInsights(users, user.organizationId);
  }

  // Durable history written by the standalone ai-anomaly-service (Kafka consumer)
  async getInsightHistory(user) {
    let userIds;
    if (user.role === ROLES.EMPLOYEE) {
      userIds = [user.id];
    } else if (user.role === ROLES.MANAGER) {
      userIds = await this.scopedMemberIds(user);
    }
    return this.aiInsightRepository.findHistory(user.organizationId, userIds);
  }

  // ---- Attendance analytics ----

  async departmentsByUser(memberIds, organizationId) {
    const members = await this.userRepository.findByIds(memberIds, organizationId, ['id', 'department']);
    return new Map(members.map(m => [m.id, m.department || 'Unassigned']));
  }

  // Counting happens in Postgres (GROUP BY date / department); a handful of rows come back
  async getAttendanceTrends(user, period) {
    const scope = await this.analyticsScope(user, period);
    const [trends, departments] = await Promise.all([
      this.analyticsRepository.attendanceByDate(scope),
      this.analyticsRepository.attendanceByDepartment(scope)
    ]);

    const departmentBreakdown = {};
    departments.forEach(d => {
      departmentBreakdown[d.department] = {
        attendance: d.total ? Math.round((d.present / d.total) * 100) : 0,
        avgHours: d.present ? Math.round((d.minutes / d.present / 60) * 100) / 100 : 0
      };
    });

    return { trends, departmentBreakdown };
  }

  async getDepartmentAttendance(user, period = '30d') {
    const departments = await this.analyticsRepository.attendanceByDepartment(await this.analyticsScope(user, period));
    return Object.fromEntries(departments.map(d => [
      d.department,
      d.total ? Math.round((d.present / d.total) * 100) : 0
    ]));
  }

  async getLatePatterns(user, period = '90d') {
    return this.analyticsRepository.lateByDate(await this.analyticsScope(user, period));
  }

  async getUserAttendance(user, targetUserId, { startDate, endDate }) {
    await this.assertCanViewUser(user, targetUserId);
    const result = await this.attendanceService.getAttendanceHistory(targetUserId, user.organizationId, {
      startDate, endDate, page: 1, limit: 90
    });
    return result.data;
  }

  // ---- Leave analytics (delegates to LeaveService) ----

  async getLeaveStatistics(organizationId, period = '1y') {
    const [stats, memberIds] = await Promise.all([
      this.leaveService.getLeaveStatistics(organizationId, period),
      this.userRepository.findActiveMemberIds(organizationId)
    ]);
    const approvedDays = Object.values(stats.typeDistribution).reduce((sum, days) => sum + days, 0);
    return {
      totalLeavesTaken: stats.approved,
      // Share of requests approved (kept for the existing chart); days-vs-allocation
      // utilization is GET /analytics/leave/utilization
      leaveUtilizationRate: stats.totalRequests ? Math.round((stats.approved / stats.totalRequests) * 100) : 0,
      averageLeavePerEmployee: memberIds.length ? Math.round((approvedDays / memberIds.length) * 10) / 10 : 0,
      typeDistribution: stats.typeDistribution,
      monthlyPattern: stats.monthlyPattern.map(m => ({ month: m.month, leaves: m.approved }))
    };
  }

  async getLeaveTypeDistribution(organizationId, period = '1y') {
    return (await this.leaveService.getLeaveStatistics(organizationId, period)).typeDistribution;
  }

  async getDepartmentLeave(organizationId, period = '1y') {
    return (await this.leaveService.getLeaveStatistics(organizationId, period)).departmentStats;
  }

  // ---- Performance (attendance-derived proxy - no task/review system exists) ----

  async buildPerformanceMetrics(userIds) {
    const since = daysAgoStr(30);
    // Two queries total, whatever the team size (check-in minutes used to be one query per user)
    const [logs, minutesByUser] = await Promise.all([
      this.attendanceRepository.findForUsersSince(userIds, since),
      this.attendanceRepository.checkInMinutesForUsers(userIds, since)
    ]);
    const minutesLists = userIds.map(id => minutesByUser.get(id) || []);

    const totalMinutes = logs.reduce((sum, l) => sum + (l.workingMinutes || 0), 0);
    const daysWithHours = logs.filter(l => l.workingMinutes).length;
    const overtimeMinutes = logs.reduce((sum, l) => sum + Math.max(0, (l.workingMinutes || 0) - STANDARD_WORKDAY_MINUTES), 0);
    const scores = minutesLists.map(consistencyScore);

    return {
      productivityScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      engagementLevel: 0, // no engagement-survey data source exists
      averageWorkingHours: daysWithHours ? Math.round((totalMinutes / daysWithHours / 60) * 100) / 100 : 0,
      overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
      taskCompletionRate: 0, // no task-tracking system exists
      performanceTrend: 'stable'
    };
  }

  async getPerformanceOverview(user) {
    return this.buildPerformanceMetrics(await this.scopedMemberIds(user));
  }

  async getTeamPerformance(user, teamManagerId) {
    this.assertCanViewTeam(user, teamManagerId);
    return this.buildPerformanceMetrics(await this.userRepository.findActiveMemberIds(user.organizationId, teamManagerId));
  }

  async getUserPerformance(user, targetUserId) {
    await this.assertCanViewUser(user, targetUserId);
    return this.buildPerformanceMetrics([targetUserId]);
  }

  // ---- Anomalies (z-score detector in AnalyticsService) ----

  async getAnomalies(user) {
    const users = await this.userRepository.findActiveMembers(user.organizationId, {
      managerId: user.role === ROLES.MANAGER ? user.id : null,
      limit: 20
    });

    const anomalies = [];
    const insightsByUser = await this.insights.generateForUsers(users.map(m => m.id), user.organizationId);

    for (const member of users) {
      const result = (insightsByUser.get(member.id) || {}).anomaly;
      if (result && result.metadata.anomaly_count > 0) {
        const { avg_work_hours: avg, std_deviation: std } = result.metadata;
        anomalies.push({
          userId: member.id,
          userName: member.name,
          type: 'attendance',
          severity: severityFor(result.score),
          value: avg,
          expectedRange: [avg - std, avg + std],
          date: todayStr(),
          explanation: result.metadata.explanation
        });
      }
    }

    return {
      anomalies,
      summary: {
        total: anomalies.length,
        high: anomalies.filter(a => a.severity === 'high').length,
        medium: anomalies.filter(a => a.severity === 'medium').length,
        low: anomalies.filter(a => a.severity === 'low').length
      }
    };
  }

  async getOrganizationAnomalies(user) {
    const users = await this.userRepository.findActiveMembers(user.organizationId, { limit: 30 });
    const anomalies = [];
    const insightsByUser = await this.insights.generateForUsers(users.map(m => m.id), user.organizationId);

    for (const member of users) {
      const result = (insightsByUser.get(member.id) || {}).anomaly;
      if (result && result.metadata.anomaly_count > 0) {
        anomalies.push({ userId: member.id, userName: member.name, score: result.score, ...result.metadata });
      }
    }

    return anomalies;
  }

  // ---- Team / department comparison ----

  async getTeamOverview(user, teamManagerId) {
    this.assertCanViewTeam(user, teamManagerId);

    const memberIds = await this.userRepository.findActiveMemberIds(user.organizationId, teamManagerId);
    const [logs, pendingLeaves, pendingWfh, perf] = await Promise.all([
      this.attendanceRepository.findForUsersOnDate(memberIds, todayStr()),
      this.leaveRepository.countPendingForUsers(memberIds),
      this.wfhRepository.countPendingForUsers(memberIds),
      this.buildPerformanceMetrics(memberIds)
    ]);

    const present = logs.filter(isPresent).length;

    return {
      teamSize: memberIds.length,
      activeToday: present,
      teamAttendance: memberIds.length ? Math.round((present / memberIds.length) * 100) : 0,
      teamProductivity: perf.productivityScore,
      directReports: memberIds.length,
      pendingApprovals: pendingLeaves + pendingWfh,
      teamInsights: []
    };
  }

  async getDepartmentComparison(user) {
    const memberIds = await this.scopedMemberIds(user);
    const [deptByUser, logs] = await Promise.all([
      this.departmentsByUser(memberIds, user.organizationId),
      this.attendanceRepository.findForUsersOnDate(memberIds, todayStr())
    ]);
    const logByUser = new Map(logs.map(l => [l.userId, l]));

    const byDept = {};
    deptByUser.forEach((dept, userId) => {
      if (!byDept[dept]) byDept[dept] = { memberIds: [], present: 0 };
      byDept[dept].memberIds.push(userId);
      if (isPresent(logByUser.get(userId))) byDept[dept].present += 1;
    });

    return Promise.all(Object.entries(byDept).map(async ([department, d]) => {
      const perf = await this.buildPerformanceMetrics(d.memberIds);
      return {
        department,
        attendance: d.memberIds.length ? Math.round((d.present / d.memberIds.length) * 100) : 0,
        performance: perf.productivityScore,
        productivity: perf.productivityScore,
        employeeCount: d.memberIds.length
      };
    }));
  }

  // ---- System health (Admin) - real process/DB metrics ----

  async getSystemHealth(organizationId) {
    const dbPing = await this.healthRepository.ping();
    const metrics = this.getMetrics();
    const memory = process.memoryUsage();

    let overallStatus = 'healthy';
    if (!dbPing.ok || metrics.errorRate > 10) overallStatus = 'critical';
    else if (dbPing.ms > 200 || metrics.errorRate > 2) overallStatus = 'warning';

    return {
      systemUptime: formatUptime(process.uptime()),
      responseTime: dbPing.ms,
      activeUsers: await this.countOnlineUsers(organizationId),
      databaseConnections: this.healthRepository.connectionCount(),
      memoryUsage: Math.round((memory.heapUsed / memory.heapTotal) * 100),
      cpuUsage: Math.round((os.loadavg()[0] / os.cpus().length) * 100),
      apiCallsToday: metrics.requestsToday,
      errorRate: metrics.errorRate,
      overallStatus,
      apiUptime: metrics.totalRequests ? Math.round((1 - metrics.errorRequests / metrics.totalRequests) * 10000) / 100 : 100,
      databaseHealth: dbPing.ok ? Math.max(0, 100 - dbPing.ms) : 0,
      // Redis hit/miss/error counters for this process (null in tests without a real cache)
      cache: typeof this.cache.getStats === 'function' ? this.cache.getStats() : null
    };
  }

  getApiUsage() {
    return this.getMetrics();
  }

  // Rows for the CSV export. Employees only ever get their own record.
  async getExportRows(user, type) {
    if (type !== 'dashboard') {
      return [];
    }

    const memberIds = user.role === ROLES.EMPLOYEE ? [user.id] : await this.scopedMemberIds(user);
    const logs = await this.attendanceRepository.findForUsersOnDate(memberIds, todayStr());
    return logs.map(l => l.toJSON());
  }
}

module.exports = new WorkforceAnalyticsService({
  ...repositories,
  insights: AnalyticsService,
  attendanceService: AttendanceService,
  leaveService: LeaveService,
  getMetrics,
  cache
});
module.exports.WorkforceAnalyticsService = WorkforceAnalyticsService;
