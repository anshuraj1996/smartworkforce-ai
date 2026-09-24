const express = require('express');
const router = express.Router();
const os = require('os');
const { Op } = require('sequelize');
const { User, AttendanceLog, LeaveRequest, WfhRequest, Organization, AiInsight, sequelize } = require('../../models');
const { authenticate, authorize } = require('../../middleware/auth');
const AttendanceService = require('../../services/AttendanceService');
const LeaveService = require('../../services/LeaveService');
const AnalyticsService = require('../../services/AnalyticsService');
const { consistencyScore, checkInMinutesSince, todayStr, daysAgoStr } = require('../../utils/attendanceMetrics');
const { getMetrics } = require('../../middleware/metrics');
const { withCache } = require('../../utils/cache');

const IS_MANAGER_UP = ['MANAGER', 'HR', 'ADMIN'];
const IS_HR_UP = ['HR', 'ADMIN'];

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

function periodToDays(period) {
  return PERIOD_DAYS[period] || 30;
}

async function orgMemberIds(organizationId, managerScopeUser) {
  const whereClause = { organizationId, isActive: true };
  if (managerScopeUser?.role === 'MANAGER') whereClause.managerId = managerScopeUser.id;
  const users = await User.findAll({ where: whereClause, attributes: ['id'] });
  return users.map(u => u.id);
}

// ============================================================================
// Dashboard
// ============================================================================

async function computeDashboardData(user) {
  const today = todayStr();

  if (user.role === 'EMPLOYEE') {
    const [todayLog, pendingLeaves] = await Promise.all([
      AttendanceLog.findOne({ where: { userId: user.id, date: today } }),
      LeaveRequest.count({ where: { userId: user.id, status: 'PENDING' } })
    ]);

    return {
      totalEmployees: 0,
      presentToday: todayLog && ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes(todayLog.attendanceType) ? 1 : 0,
      lateToday: todayLog?.attendanceType === 'LATE' ? 1 : 0,
      absentToday: 0,
      pendingLeaves,
      attendanceRate: 0
    };
  }

  const memberIds = await orgMemberIds(user.organizationId, user);
  const [logs, pendingLeaves] = await Promise.all([
    AttendanceLog.findAll({ where: { userId: { [Op.in]: memberIds }, date: today } }),
    LeaveRequest.count({
      where: user.role === 'MANAGER'
        ? { userId: { [Op.in]: memberIds }, status: 'PENDING' }
        : { organizationId: user.organizationId, status: 'PENDING' }
    })
  ]);

  const presentToday = logs.filter(l => ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes(l.attendanceType)).length;
  const lateToday = logs.filter(l => l.attendanceType === 'LATE').length;

  const data = {
    totalEmployees: memberIds.length,
    presentToday,
    lateToday,
    absentToday: memberIds.length - presentToday,
    pendingLeaves,
    attendanceRate: memberIds.length ? Math.round((presentToday / memberIds.length) * 100 * 10) / 10 : 0
  };

  if (IS_HR_UP.includes(user.role)) {
    const dbPing = await pingDatabase();
    data.systemHealth = dbPing.ok ? 100 : 0;
  }

  return data;
}

// Dashboard is polled on an interval by the frontend - cache it briefly per user so a
// burst of polls (or a busy team dashboard) doesn't re-run these queries every few seconds.
// A short TTL bounds staleness instead of wiring cache invalidation into every write path
// that could touch these numbers (check-in, leave apply/approve, WFH apply/approve, ...).
const DASHBOARD_CACHE_TTL_SECONDS = 20;

async function getDashboardData(req, res) {
  try {
    const cacheKey = `dashboard:${req.user.organizationId}:${req.user.role}:${req.user.id}`;
    const data = await withCache(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, () => computeDashboardData(req.user));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to get dashboard data' });
  }
}

/**
 * @route   GET /api/v1/analytics/dashboard
 * @desc    Role-scoped dashboard overview - real counts, not the old hardcoded 125/118 stub
 * @access  Private
 */
router.get('/dashboard', authenticate, getDashboardData);

// Same data as /dashboard - kept as a separate path because the frontend polls this one
// on an interval and the plain one on initial load.
router.get('/live/dashboard', authenticate, getDashboardData);

/**
 * @route   GET /api/v1/analytics/live/online-users
 * @desc    Proxy for "online now" - there's no session tracking, so this approximates
 *          it from recent login activity instead of inventing a number.
 * @access  Private
 */
router.get('/live/online-users', authenticate, async (req, res) => {
  try {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60000);
    const count = await User.count({ where: { organizationId: req.user.organizationId, lastLogin: { [Op.gte]: fifteenMinAgo } } });
    res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({ success: false, message: 'Failed to get online users' });
  }
});

// ============================================================================
// AI Insights - computed live from real attendance data (nothing is pre-stored)
// ============================================================================

async function buildInsightsForUsers(users, organizationId) {
  const insights = [];

  for (const user of users) {
    const [late, behavior, anomaly] = await Promise.all([
      AnalyticsService.generateLateArrivalInsight(user.id, organizationId),
      AnalyticsService.generateBehaviorPatternInsight(user.id, organizationId),
      AnalyticsService.generateAnomalyDetection(user.id, organizationId)
    ]);

    if (late) {
      insights.push({
        id: `${user.id}-late-arrival`,
        userId: user.id,
        userName: user.name,
        insightType: 'late_arrival_pattern',
        score: late.score,
        title: 'Late Arrival Pattern',
        explanation: late.metadata.explanation,
        severity: late.score < 50 ? 'high' : late.score < 75 ? 'medium' : 'low',
        actionable: late.score < 75,
        trend: 'stable',
        metadata: late.metadata,
        generatedAt: new Date()
      });
    }
    if (behavior) {
      insights.push({
        id: `${user.id}-behavior-pattern`,
        userId: user.id,
        userName: user.name,
        insightType: 'behavior_pattern',
        score: behavior.score,
        title: 'Work Behavior Pattern',
        explanation: behavior.metadata.explanation,
        severity: behavior.score < 50 ? 'high' : behavior.score < 75 ? 'medium' : 'low',
        actionable: false,
        trend: 'stable',
        metadata: behavior.metadata,
        generatedAt: new Date()
      });
    }
    if (anomaly) {
      insights.push({
        id: `${user.id}-anomaly-detection`,
        userId: user.id,
        userName: user.name,
        insightType: 'anomaly_detection',
        score: anomaly.score,
        title: 'Attendance Stability',
        explanation: anomaly.metadata.explanation,
        severity: anomaly.score < 50 ? 'high' : anomaly.score < 75 ? 'medium' : 'low',
        actionable: anomaly.score < 50,
        trend: 'stable',
        metadata: anomaly.metadata,
        generatedAt: new Date()
      });
    }
  }

  return insights;
}

router.get('/ai-insights/me', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    const insights = await buildInsightsForUsers([user], req.user.organizationId);
    res.json({ success: true, data: insights });
  } catch (error) {
    console.error('Get my AI insights error:', error);
    res.status(500).json({ success: false, message: 'Failed to get insights' });
  }
});

router.get('/ai-insights/team', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const whereClause = { organizationId: req.user.organizationId, isActive: true };
    if (req.user.role === 'MANAGER') whereClause.managerId = req.user.id;
    const users = await User.findAll({ where: whereClause, limit: 15 });
    const insights = await buildInsightsForUsers(users, req.user.organizationId);
    res.json({ success: true, data: insights });
  } catch (error) {
    console.error('Get team AI insights error:', error);
    res.status(500).json({ success: false, message: 'Failed to get insights' });
  }
});

router.get('/ai-insights/organization', authenticate, authorize(...IS_HR_UP), async (req, res) => {
  try {
    const users = await User.findAll({ where: { organizationId: req.user.organizationId, isActive: true }, limit: 25 });
    const insights = await buildInsightsForUsers(users, req.user.organizationId);
    res.json({ success: true, data: insights });
  } catch (error) {
    console.error('Get organization AI insights error:', error);
    res.status(500).json({ success: false, message: 'Failed to get insights' });
  }
});

// Persisted insights generated asynchronously by the standalone ai-anomaly-service
// (consumes attendance events off Kafka) - a durable history, unlike the on-demand
// insights above which are recomputed fresh on every request.
router.get('/ai-insights/history', authenticate, async (req, res) => {
  try {
    const whereClause = { organizationId: req.user.organizationId };

    if (req.user.role === 'EMPLOYEE') {
      whereClause.userId = req.user.id;
    } else if (req.user.role === 'MANAGER') {
      const memberIds = await orgMemberIds(req.user.organizationId, req.user);
      whereClause.userId = { [Op.in]: memberIds };
    }
    // HR/ADMIN see the whole organization's history.

    const insights = await AiInsight.findAll({
      where: whereClause,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['generatedAt', 'DESC']],
      limit: 50
    });

    res.json({ success: true, data: insights });
  } catch (error) {
    console.error('Get insight history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get insight history' });
  }
});

// ============================================================================
// Attendance analytics
// ============================================================================

/**
 * @route   GET /api/v1/analytics/attendance/trends
 * @access  Private (Manager, HR, Admin)
 */
router.get('/attendance/trends', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const days = periodToDays(req.query.period);
    const memberIds = await orgMemberIds(req.user.organizationId, req.user);
    const logs = await AttendanceLog.findAll({
      where: { userId: { [Op.in]: memberIds }, date: { [Op.gte]: daysAgoStr(days) } },
      order: [['date', 'ASC']]
    });

    const byDate = {};
    logs.forEach(l => {
      if (!byDate[l.date]) byDate[l.date] = { date: l.date, present: 0, late: 0, absent: 0 };
      if (l.attendanceType === 'LATE') byDate[l.date].late += 1;
      else if (l.attendanceType === 'ABSENT') byDate[l.date].absent += 1;
      else byDate[l.date].present += 1;
    });

    const departmentBreakdown = {};
    const members = await User.findAll({ where: { id: { [Op.in]: memberIds } }, attributes: ['id', 'department'] });
    const deptByUser = {}; members.forEach(m => { deptByUser[m.id] = m.department || 'Unassigned'; });

    logs.forEach(l => {
      const dept = deptByUser[l.userId] || 'Unassigned';
      if (!departmentBreakdown[dept]) departmentBreakdown[dept] = { present: 0, total: 0, minutes: 0 };
      departmentBreakdown[dept].total += 1;
      if (l.attendanceType !== 'ABSENT') departmentBreakdown[dept].present += 1;
      if (l.workingMinutes) departmentBreakdown[dept].minutes += l.workingMinutes;
    });

    const departmentBreakdownFormatted = {};
    Object.entries(departmentBreakdown).forEach(([dept, d]) => {
      departmentBreakdownFormatted[dept] = {
        attendance: d.total ? Math.round((d.present / d.total) * 100) : 0,
        avgHours: d.present ? Math.round((d.minutes / d.present / 60) * 100) / 100 : 0
      };
    });

    res.json({
      success: true,
      data: { trends: Object.values(byDate), departmentBreakdown: departmentBreakdownFormatted }
    });
  } catch (error) {
    console.error('Get attendance trends error:', error);
    res.status(500).json({ success: false, message: 'Failed to get attendance trends' });
  }
});

router.get('/attendance/departments', authenticate, authorize(...IS_MANAGER_UP), async (req, res, next) => {
  req.query.period = req.query.period || '30d';
  try {
    const memberIds = await orgMemberIds(req.user.organizationId, req.user);
    const days = periodToDays(req.query.period);
    const logs = await AttendanceLog.findAll({ where: { userId: { [Op.in]: memberIds }, date: { [Op.gte]: daysAgoStr(days) } } });
    const members = await User.findAll({ where: { id: { [Op.in]: memberIds } }, attributes: ['id', 'department'] });
    const deptByUser = {}; members.forEach(m => { deptByUser[m.id] = m.department || 'Unassigned'; });

    const byDept = {};
    logs.forEach(l => {
      const dept = deptByUser[l.userId] || 'Unassigned';
      if (!byDept[dept]) byDept[dept] = { total: 0, present: 0 };
      byDept[dept].total += 1;
      if (l.attendanceType !== 'ABSENT') byDept[dept].present += 1;
    });

    const result = {};
    Object.entries(byDept).forEach(([dept, d]) => { result[dept] = d.total ? Math.round((d.present / d.total) * 100) : 0; });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get department attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to get department attendance' });
  }
});

router.get('/attendance/late-patterns', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const days = periodToDays(req.query.period || '90d');
    const memberIds = await orgMemberIds(req.user.organizationId, req.user);
    const logs = await AttendanceLog.findAll({
      where: { userId: { [Op.in]: memberIds }, attendanceType: 'LATE', date: { [Op.gte]: daysAgoStr(days) } }
    });

    const byDate = {};
    logs.forEach(l => {
      if (!byDate[l.date]) byDate[l.date] = { date: l.date, count: 0, totalLateMinutes: 0 };
      byDate[l.date].count += 1;
      byDate[l.date].totalLateMinutes += l.lateMinutes || 0;
    });

    res.json({
      success: true,
      data: Object.values(byDate).map(d => ({ date: d.date, count: d.count, avgLateMinutes: Math.round(d.totalLateMinutes / d.count) }))
    });
  } catch (error) {
    console.error('Get late patterns error:', error);
    res.status(500).json({ success: false, message: 'Failed to get late patterns' });
  }
});

router.get('/attendance/user/:userId', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const targetUser = await User.findOne({ where: { id: req.params.userId, organizationId: req.user.organizationId } });
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await AttendanceService.getAttendanceHistory(req.params.userId, req.query.startDate, req.query.endDate, 1, 90, req.user.organizationId);
    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Get user attendance history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get attendance history' });
  }
});

// ============================================================================
// Leave analytics - delegate to LeaveService rather than duplicate the logic
// ============================================================================

router.get('/leave/statistics', authenticate, authorize(...IS_HR_UP), async (req, res) => {
  try {
    const stats = await LeaveService.getLeaveStatistics(req.user.organizationId, req.query.period || '1y');
    res.json({
      success: true,
      data: {
        totalLeavesTaken: stats.approved,
        leaveUtilizationRate: stats.totalRequests ? Math.round((stats.approved / stats.totalRequests) * 100) : 0,
        averageLeavePerEmployee: 0, // needs a headcount-normalized calc we don't have wired here yet
        typeDistribution: stats.typeDistribution,
        monthlyPattern: stats.monthlyPattern.map(m => ({ month: m.month, leaves: m.approved }))
      }
    });
  } catch (error) {
    console.error('Get leave statistics error:', error);
    res.status(500).json({ success: false, message: 'Failed to get leave statistics' });
  }
});

router.get('/leave/types-distribution', authenticate, authorize(...IS_HR_UP), async (req, res) => {
  try {
    const stats = await LeaveService.getLeaveStatistics(req.user.organizationId, req.query.period || '1y');
    res.json({ success: true, data: stats.typeDistribution });
  } catch (error) {
    console.error('Get leave type distribution error:', error);
    res.status(500).json({ success: false, message: 'Failed to get leave type distribution' });
  }
});

router.get('/leave/departments', authenticate, authorize(...IS_HR_UP), async (req, res) => {
  try {
    const stats = await LeaveService.getLeaveStatistics(req.user.organizationId, req.query.period || '1y');
    res.json({ success: true, data: stats.departmentStats });
  } catch (error) {
    console.error('Get department leave error:', error);
    res.status(500).json({ success: false, message: 'Failed to get department leave' });
  }
});

// ============================================================================
// Performance (attendance-derived proxy - no task/review system exists to source a real
// productivity/engagement score from)
// ============================================================================

async function buildPerformanceMetrics(userIds) {
  const [attendanceLogs, minutesLists] = await Promise.all([
    AttendanceLog.findAll({ where: { userId: { [Op.in]: userIds }, date: { [Op.gte]: daysAgoStr(30) } } }),
    Promise.all(userIds.map(id => checkInMinutesSince(id, daysAgoStr(30))))
  ]);

  const totalMinutes = attendanceLogs.reduce((sum, l) => sum + (l.workingMinutes || 0), 0);
  const daysWithHours = attendanceLogs.filter(l => l.workingMinutes).length;
  const averageWorkingHours = daysWithHours ? Math.round((totalMinutes / daysWithHours / 60) * 100) / 100 : 0;

  const scores = minutesLists.map(consistencyScore);
  const productivityScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  const overtimeMinutes = attendanceLogs.reduce((sum, l) => sum + Math.max(0, (l.workingMinutes || 0) - 480), 0);

  return {
    productivityScore,
    engagementLevel: 0, // no engagement-survey data source exists
    averageWorkingHours,
    overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
    taskCompletionRate: 0, // no task-tracking system exists
    performanceTrend: 'stable'
  };
}

router.get('/performance/overview', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const memberIds = await orgMemberIds(req.user.organizationId, req.user);
    res.json({ success: true, data: await buildPerformanceMetrics(memberIds) });
  } catch (error) {
    console.error('Get performance overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to get performance overview' });
  }
});

router.get('/performance/team/:teamId', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const members = await User.findAll({ where: { organizationId: req.user.organizationId, managerId: req.params.teamId }, attributes: ['id'] });
    res.json({ success: true, data: await buildPerformanceMetrics(members.map(m => m.id)) });
  } catch (error) {
    console.error('Get team performance error:', error);
    res.status(500).json({ success: false, message: 'Failed to get team performance' });
  }
});

router.get('/performance/user/:userId', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const targetUser = await User.findOne({ where: { id: req.params.userId, organizationId: req.user.organizationId } });
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: await buildPerformanceMetrics([req.params.userId]) });
  } catch (error) {
    console.error('Get user performance error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user performance' });
  }
});

// ============================================================================
// Anomalies - reuses AnalyticsService's real z-score based detector
// ============================================================================

router.get('/anomalies', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const whereClause = { organizationId: req.user.organizationId, isActive: true };
    if (req.user.role === 'MANAGER') whereClause.managerId = req.user.id;
    const users = await User.findAll({ where: whereClause, limit: 20 });

    const anomalies = [];
    for (const user of users) {
      const result = await AnalyticsService.generateAnomalyDetection(user.id, req.user.organizationId);
      if (result && result.metadata.anomaly_count > 0) {
        anomalies.push({
          userId: user.id,
          userName: user.name,
          type: 'attendance',
          severity: result.score < 50 ? 'high' : result.score < 75 ? 'medium' : 'low',
          value: result.metadata.avg_work_hours,
          expectedRange: [result.metadata.avg_work_hours - result.metadata.std_deviation, result.metadata.avg_work_hours + result.metadata.std_deviation],
          date: new Date().toISOString().split('T')[0],
          explanation: result.metadata.explanation
        });
      }
    }

    const summary = {
      total: anomalies.length,
      high: anomalies.filter(a => a.severity === 'high').length,
      medium: anomalies.filter(a => a.severity === 'medium').length,
      low: anomalies.filter(a => a.severity === 'low').length
    };

    res.json({ success: true, data: { anomalies, summary } });
  } catch (error) {
    console.error('Get anomalies error:', error);
    res.status(500).json({ success: false, message: 'Failed to get anomalies' });
  }
});

router.get('/anomalies/organization', authenticate, authorize(...IS_HR_UP), async (req, res) => {
  try {
    const users = await User.findAll({ where: { organizationId: req.user.organizationId, isActive: true }, limit: 30 });
    const anomalies = [];
    for (const user of users) {
      const result = await AnalyticsService.generateAnomalyDetection(user.id, req.user.organizationId);
      if (result && result.metadata.anomaly_count > 0) {
        anomalies.push({ userId: user.id, userName: user.name, score: result.score, ...result.metadata });
      }
    }
    res.json({ success: true, data: anomalies });
  } catch (error) {
    console.error('Get organization anomalies error:', error);
    res.status(500).json({ success: false, message: 'Failed to get organization anomalies' });
  }
});

// ============================================================================
// Team / department comparison
// ============================================================================

async function getTeamOverview(req, res, teamId) {
  try {
    const members = await User.findAll({ where: { organizationId: req.user.organizationId, managerId: teamId, isActive: true } });
    const memberIds = members.map(m => m.id);
    const today = todayStr();

    const [logs, pendingLeaves, pendingWfh] = await Promise.all([
      AttendanceLog.findAll({ where: { userId: { [Op.in]: memberIds }, date: today } }),
      LeaveRequest.count({ where: { userId: { [Op.in]: memberIds }, status: 'PENDING' } }),
      WfhRequest.count({ where: { userId: { [Op.in]: memberIds }, status: 'PENDING' } })
    ]);

    const present = logs.filter(l => ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes(l.attendanceType)).length;
    const perf = await buildPerformanceMetrics(memberIds);

    res.json({
      success: true,
      data: {
        teamSize: members.length,
        activeToday: present,
        teamAttendance: members.length ? Math.round((present / members.length) * 100) : 0,
        teamProductivity: perf.productivityScore,
        directReports: members.length,
        pendingApprovals: pendingLeaves + pendingWfh,
        teamInsights: []
      }
    });
  } catch (error) {
    console.error('Get team overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to get team overview' });
  }
}

router.get('/team/:teamId/overview', authenticate, authorize(...IS_MANAGER_UP), (req, res) => getTeamOverview(req, res, req.params.teamId));

router.get('/manager/dashboard', authenticate, authorize('MANAGER', 'HR', 'ADMIN'), (req, res) => getTeamOverview(req, res, req.user.id));

router.get('/departments/comparison', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const memberIds = await orgMemberIds(req.user.organizationId, req.user);
    const members = await User.findAll({ where: { id: { [Op.in]: memberIds } }, attributes: ['id', 'department'] });
    const today = todayStr();
    const logs = await AttendanceLog.findAll({ where: { userId: { [Op.in]: memberIds }, date: today } });
    const logByUser = {}; logs.forEach(l => { logByUser[l.userId] = l; });

    const byDept = {};
    members.forEach(m => {
      const dept = m.department || 'Unassigned';
      if (!byDept[dept]) byDept[dept] = { employeeCount: 0, present: 0 };
      byDept[dept].employeeCount += 1;
      const log = logByUser[m.id];
      if (log && ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes(log.attendanceType)) byDept[dept].present += 1;
    });

    const result = await Promise.all(Object.entries(byDept).map(async ([department, d]) => {
      const deptMemberIds = members.filter(m => (m.department || 'Unassigned') === department).map(m => m.id);
      const perf = await buildPerformanceMetrics(deptMemberIds);
      return {
        department,
        attendance: d.employeeCount ? Math.round((d.present / d.employeeCount) * 100) : 0,
        performance: perf.productivityScore,
        productivity: perf.productivityScore,
        employeeCount: d.employeeCount
      };
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get department comparison error:', error);
    res.status(500).json({ success: false, message: 'Failed to get department comparison' });
  }
});

// ============================================================================
// System health (Admin only) - real process/DB metrics, no invented numbers
// ============================================================================

async function pingDatabase() {
  const start = Date.now();
  try {
    await sequelize.query('SELECT 1');
    return { ok: true, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

router.get('/system/health', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const dbPing = await pingDatabase();
    const metrics = getMetrics();
    const memory = process.memoryUsage();
    const pool = sequelize.connectionManager.pool;

    const apiUptime = metrics.totalRequests ? Math.round((1 - metrics.errorRequests / metrics.totalRequests) * 10000) / 100 : 100;
    const databaseHealth = dbPing.ok ? Math.max(0, 100 - dbPing.ms) : 0;

    let overallStatus = 'healthy';
    if (!dbPing.ok || metrics.errorRate > 10) overallStatus = 'critical';
    else if (dbPing.ms > 200 || metrics.errorRate > 2) overallStatus = 'warning';

    res.json({
      success: true,
      data: {
        systemUptime: formatUptime(process.uptime()),
        responseTime: dbPing.ms,
        activeUsers: await User.count({ where: { organizationId: req.user.organizationId, lastLogin: { [Op.gte]: new Date(Date.now() - 15 * 60000) } } }),
        databaseConnections: pool ? pool.using.length + pool.available.length : 1,
        memoryUsage: Math.round((memory.heapUsed / memory.heapTotal) * 100),
        cpuUsage: Math.round((os.loadavg()[0] / os.cpus().length) * 100),
        apiCallsToday: metrics.requestsToday,
        errorRate: metrics.errorRate,
        overallStatus,
        apiUptime,
        databaseHealth
      }
    });
  } catch (error) {
    console.error('Get system health error:', error);
    res.status(500).json({ success: false, message: 'Failed to get system health' });
  }
});

router.get('/system/api-usage', authenticate, authorize('ADMIN'), (req, res) => {
  res.json({ success: true, data: getMetrics() });
});

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

// ============================================================================
// Export
// ============================================================================

router.post('/export', authenticate, async (req, res) => {
  try {
    const { type, filters } = req.body;
    let data;

    if (type === 'dashboard') {
      const memberIds = await orgMemberIds(req.user.organizationId, req.user);
      const today = todayStr();
      const logs = await AttendanceLog.findAll({ where: { userId: { [Op.in]: memberIds }, date: today } });
      data = logs.map(l => l.toJSON());
    } else {
      data = [];
    }

    const headers = data.length ? Object.keys(data[0]).filter(k => typeof data[0][k] !== 'object') : [];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...data.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${type || 'export'}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to export analytics' });
  }
});

router.get('/export/:reportId', authenticate, (req, res) => {
  // Reports aren't persisted anywhere yet - nothing real to look up by ID.
  res.status(404).json({ success: false, message: 'Report not found' });
});

module.exports = router;
