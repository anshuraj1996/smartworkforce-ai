const WorkforceAnalyticsService = require('../services/WorkforceAnalyticsService');
const WorkforceMetricsService = require('../services/WorkforceMetricsService');
const KpiService = require('../services/KpiService');
const ReportService = require('../services/ReportService');
const ForecastService = require('../services/ForecastService');
const RiskService = require('../services/RiskService');
const asyncHandler = require('../middleware/asyncHandler');
const { sendCsv, sendCsvText } = require('../utils/csv');

// Analytics responses have always been { success, data } without a version field - the
// dashboard/analytics UI reads them as-is.
const ok = (res, data) => res.json({ success: true, data });

const analyticsController = {
  getDashboard: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getDashboard(req.user))),

  getOnlineUsers: asyncHandler(async (req, res) => {
    ok(res, { count: await WorkforceAnalyticsService.countOnlineUsers(req.user.organizationId) });
  }),

  getMyInsights: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getMyInsights(req.user))),
  getTeamInsights: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getTeamInsights(req.user))),
  getOrganizationInsights: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getOrganizationInsights(req.user))),
  getInsightHistory: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getInsightHistory(req.user))),

  getAttendanceTrends: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getAttendanceTrends(req.user, req.query.period));
  }),

  getDepartmentAttendance: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getDepartmentAttendance(req.user, req.query.period || '30d'));
  }),

  getLatePatterns: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getLatePatterns(req.user, req.query.period || '90d'));
  }),

  getUserAttendance: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    ok(res, await WorkforceAnalyticsService.getUserAttendance(req.user, req.params.userId, { startDate, endDate }));
  }),

  getLeaveStatistics: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getLeaveStatistics(req.user.organizationId, req.query.period || '1y'));
  }),

  getLeaveTypeDistribution: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getLeaveTypeDistribution(req.user.organizationId, req.query.period || '1y'));
  }),

  getDepartmentLeave: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getDepartmentLeave(req.user.organizationId, req.query.period || '1y'));
  }),

  getPerformanceOverview: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getPerformanceOverview(req.user))),

  getTeamPerformance: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getTeamPerformance(req.user, req.params.teamId));
  }),

  getUserPerformance: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getUserPerformance(req.user, req.params.userId));
  }),

  getAnomalies: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getAnomalies(req.user))),
  getOrganizationAnomalies: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getOrganizationAnomalies(req.user))),

  getTeamOverview: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getTeamOverview(req.user, req.params.teamId));
  }),

  // The caller's own team
  getManagerDashboard: asyncHandler(async (req, res) => {
    ok(res, await WorkforceAnalyticsService.getTeamOverview(req.user, req.user.id));
  }),

  getDepartmentComparison: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getDepartmentComparison(req.user))),

  getSystemHealth: asyncHandler(async (req, res) => ok(res, await WorkforceAnalyticsService.getSystemHealth(req.user.organizationId))),

  getApiUsage: (req, res) => ok(res, WorkforceAnalyticsService.getApiUsage()),

  export: asyncHandler(async (req, res) => {
    const { type } = req.body;
    const rows = await WorkforceAnalyticsService.getExportRows(req.user, type);
    sendCsv(res, `analytics-${type || 'export'}.csv`, rows);
  }),

  // ---- Workforce metrics ----
  getMySummary: asyncHandler(async (req, res) => ok(res, await WorkforceMetricsService.getMySummary(req.user, req.query))),
  getWorkMode: asyncHandler(async (req, res) => ok(res, await WorkforceMetricsService.getWorkMode(req.user, req.query))),
  getOvertime: asyncHandler(async (req, res) => ok(res, await WorkforceMetricsService.getOvertime(req.user, req.query))),
  getApprovalTurnaround: asyncHandler(async (req, res) => ok(res, await WorkforceMetricsService.getApprovalTurnaround(req.user, req.query))),
  getLifecycle: asyncHandler(async (req, res) => ok(res, await WorkforceMetricsService.getLifecycle(req.user, req.query))),
  getLeaveUtilization: asyncHandler(async (req, res) => ok(res, await WorkforceMetricsService.getLeaveUtilization(req.user, req.query))),

  getKpis: asyncHandler(async (req, res) => ok(res, await KpiService.getKpis(req.user, req.query))),

  getRiskOverview: asyncHandler(async (req, res) => ok(res, await RiskService.getRiskOverview(req.user, req.query))),
  getEmployeeRisk: asyncHandler(async (req, res) => ok(res, await RiskService.getEmployeeRisk(req.user, req.params.userId))),
  getLeaveForecast: asyncHandler(async (req, res) => ok(res, await ForecastService.getLeaveForecast(req.user, req.query))),
  getAttendanceForecast: asyncHandler(async (req, res) => ok(res, await ForecastService.getAttendanceForecast(req.user, req.query))),

  // ---- Reports ----
  requestReport: asyncHandler(async (req, res) => {
    res.status(202).json({ success: true, data: await ReportService.requestReport(req.user, req.body) });
  }),
  listReports: asyncHandler(async (req, res) => ok(res, await ReportService.list(req.user))),
  getReport: asyncHandler(async (req, res) => ok(res, await ReportService.get(req.user, req.params.id))),
  downloadReport: asyncHandler(async (req, res) => {
    const { filename, content } = await ReportService.getDownload(req.user, req.params.id);
    sendCsvText(res, filename, content);
  })
};

module.exports = analyticsController;
