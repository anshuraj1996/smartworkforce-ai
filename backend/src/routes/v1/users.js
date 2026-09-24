const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, AuditLog, Certification, AttendanceLog, LeaveRequest, WfhRequest } = require('../../models');
const { authenticate, authorize, authorizeResourceAccess } = require('../../middleware/auth');
const AuthService = require('../../services/AuthService');
const AttendanceService = require('../../services/AttendanceService');
const LeaveService = require('../../services/LeaveService');
const totp = require('../../utils/totp');
const { consistencyScore, checkInMinutesSince, todayStr, daysAgoStr } = require('../../utils/attendanceMetrics');
const { withCache } = require('../../utils/cache');

const IS_MANAGER_UP = ['MANAGER', 'HR', 'ADMIN'];
const IS_HR_UP = ['HR', 'ADMIN'];

// A small curated real reference list, same spirit as the departments/skills dropdowns
// already in the profile form - not fetched from anywhere because there's nothing to fetch from.
const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Australia/Sydney', 'UTC'
];

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' }
];

async function createUser(req, res) {
  try {
    const { name, email, employeeId, password, role, department, designation, managerId, joinDate } = req.body;

    if (!name || !email || !employeeId || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, employeeId, and password are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    const existingUser = await User.findOne({ where: { organizationId: req.user.organizationId, email: email.toLowerCase() } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email already exists' });
    }

    const existingEmployeeId = await User.findOne({ where: { organizationId: req.user.organizationId, employeeId } });
    if (existingEmployeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID already exists' });
    }

    const allowedRoles = ['EMPLOYEE', 'MANAGER', 'HR'];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Allowed roles: EMPLOYEE, MANAGER, HR' });
    }

    if (role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Only administrators can create admin accounts' });
    }

    const newUser = await User.create({
      organizationId: req.user.organizationId,
      name,
      email: email.toLowerCase(),
      employeeId,
      password,
      role: role || 'EMPLOYEE',
      department: department || '',
      designation: designation || '',
      managerId: managerId || null,
      isActive: true,
      hireDate: joinDate || new Date()
    });

    await AuditLog.create({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      action: 'CREATE',
      entityType: 'USER',
      entityId: newUser.id,
      description: `New user created: ${name} (${email})`,
      timestamp: new Date().toISOString(),
      source: 'WEB',
      severity: 'INFO'
    });

    res.status(201).json({ success: true, message: 'Employee registered successfully', data: newUser.toJSON() });

  } catch (error) {
    console.error('User registration error:', error);
    res.status(500).json({ success: false, message: 'Failed to register employee', error: error.message });
  }
}

/**
 * @route   POST /api/v1/users/register
 * @desc    Register new employee (HR/Admin only)
 * @access  Private (HR, ADMIN)
 */
router.post('/register', authenticate, authorize('HR', 'ADMIN'), createUser);

/**
 * @route   POST /api/v1/users
 * @desc    Create team member (alias of /register used by the Team UI)
 * @access  Private (HR, ADMIN)
 */
router.post('/', authenticate, authorize('HR', 'ADMIN'), createUser);

// ============================================================================
// Team - search, stats, hierarchy, departments
// ============================================================================

/**
 * @route   GET /api/v1/users/search
 * @desc    Search/filter/paginate team members
 * @access  Private (Manager, HR, Admin)
 */
router.get('/search', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const { search, department, role, status, managerId, page = 1, limit = 20, sortBy = 'name', sortOrder = 'asc' } = req.query;

    const whereClause = { organizationId: req.user.organizationId };
    if (department) whereClause.department = department;
    if (role) whereClause.role = role;
    if (status === 'Active') whereClause.isActive = true;
    if (status === 'Inactive') whereClause.isActive = false;
    if (managerId) whereClause.managerId = managerId;
    if (req.user.role === 'MANAGER') whereClause.managerId = req.user.id;
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { department: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      attributes: { exclude: ['password'] },
      order: [[sortBy, sortOrder.toUpperCase()]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    res.json({
      success: true,
      data: { members: rows, total: count, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(count / parseInt(limit)) }
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ success: false, message: 'Failed to search users' });
  }
});

/**
 * @route   GET /api/v1/users/departments
 * @desc    List distinct departments in the organization
 * @access  Private
 */
router.get('/departments', authenticate, async (req, res) => {
  try {
    const rows = await User.findAll({
      where: { organizationId: req.user.organizationId, department: { [Op.ne]: null } },
      attributes: ['department'],
      group: ['department']
    });

    res.json({ success: true, data: rows.map(r => r.department).filter(Boolean) });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ success: false, message: 'Failed to get departments' });
  }
});

/**
 * @route   GET /api/v1/users/hierarchy
 * @desc    Full organization reporting tree
 * @access  Private (Manager, HR, Admin)
 */
router.get('/hierarchy', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const users = await User.findAll({
      where: { organizationId: req.user.organizationId, isActive: true },
      attributes: ['id', 'name', 'role', 'designation', 'managerId']
    });

    const byManager = {};
    users.forEach(u => {
      const key = u.managerId || 'root';
      if (!byManager[key]) byManager[key] = [];
      byManager[key].push(u);
    });

    const buildTree = (managerId) => (byManager[managerId] || []).map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      designation: u.designation,
      children: buildTree(u.id)
    }));

    res.json({ success: true, data: buildTree('root') });
  } catch (error) {
    console.error('Get hierarchy error:', error);
    res.status(500).json({ success: false, message: 'Failed to get hierarchy' });
  }
});

/**
 * @route   GET /api/v1/users/hierarchy/:managerId
 * @desc    Reporting tree rooted at one manager
 * @access  Private (Manager, HR, Admin)
 */
router.get('/hierarchy/:managerId', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const root = await User.findOne({
      where: { id: req.params.managerId, organizationId: req.user.organizationId },
      attributes: ['id', 'name', 'role', 'designation']
    });

    if (!root) {
      return res.status(404).json({ success: false, message: 'Manager not found' });
    }

    const users = await User.findAll({
      where: { organizationId: req.user.organizationId, isActive: true },
      attributes: ['id', 'name', 'role', 'designation', 'managerId']
    });

    const byManager = {};
    users.forEach(u => {
      const key = u.managerId || 'root';
      if (!byManager[key]) byManager[key] = [];
      byManager[key].push(u);
    });

    const buildTree = (managerId) => (byManager[managerId] || []).map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      designation: u.designation,
      children: buildTree(u.id)
    }));

    res.json({ success: true, data: { id: root.id, name: root.name, role: root.role, designation: root.designation, children: buildTree(root.id) } });
  } catch (error) {
    console.error('Get manager hierarchy error:', error);
    res.status(500).json({ success: false, message: 'Failed to get manager hierarchy' });
  }
});

/**
 * @route   GET /api/v1/users/manager/:managerId/reports
 * @desc    Direct reports of a manager
 * @access  Private
 */
router.get('/manager/:managerId/reports', authenticate, async (req, res) => {
  try {
    const reports = await User.findAll({
      where: { organizationId: req.user.organizationId, managerId: req.params.managerId },
      attributes: { exclude: ['password'] }
    });
    res.json({ success: true, data: reports });
  } catch (error) {
    console.error('Get direct reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to get direct reports' });
  }
});

/**
 * @route   GET /api/v1/users/department/:department
 * @desc    Members of a department
 * @access  Private (Manager, HR, Admin)
 */
router.get('/department/:department', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const members = await User.findAll({
      where: { organizationId: req.user.organizationId, department: req.params.department },
      attributes: { exclude: ['password'] }
    });
    res.json({ success: true, data: members });
  } catch (error) {
    console.error('Get department members error:', error);
    res.status(500).json({ success: false, message: 'Failed to get department members' });
  }
});

// ============================================================================
// Stats / activity / export - same URL, different scope depending on the caller's role
// ============================================================================

/**
 * @route   GET /api/v1/users/stats
 * @desc    Own stats (Employee) or team/org stats (Manager/HR/Admin)
 * @access  Private
 */
async function computeUserOrTeamStats(user) {
  if (user.role === 'EMPLOYEE') {
    const [attendanceStats, pendingLeaves] = await Promise.all([
      AttendanceService.getAttendanceStats(user.id),
      LeaveRequest.count({ where: { userId: user.id, status: 'PENDING' } })
    ]);

    return {
      attendanceRate: attendanceStats.attendancePercentage,
      averageWorkingHours: attendanceStats.averageWorkingHours,
      pendingLeaves
    };
  }

  const whereClause = { organizationId: user.organizationId, isActive: true };
  if (user.role === 'MANAGER') whereClause.managerId = user.id;

  const members = await User.findAll({ where: whereClause, attributes: ['id', 'department', 'hireDate'] });
  const memberIds = members.map(m => m.id);
  const today = todayStr();
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [todayLogs, onLeaveToday, pendingApprovals] = await Promise.all([
    AttendanceLog.findAll({ where: { userId: { [Op.in]: memberIds }, date: today } }),
    LeaveRequest.count({ where: { userId: { [Op.in]: memberIds }, status: 'APPROVED', startDate: { [Op.lte]: today }, endDate: { [Op.gte]: today } } }),
    Promise.all([
      LeaveRequest.count({ where: { userId: { [Op.in]: memberIds }, status: 'PENDING' } }),
      WfhRequest.count({ where: { userId: { [Op.in]: memberIds }, status: 'PENDING' } })
    ]).then(([a, b]) => a + b)
  ]);

  const departmentBreakdown = {};
  members.forEach(m => { departmentBreakdown[m.department || 'Unassigned'] = (departmentBreakdown[m.department || 'Unassigned'] || 0) + 1; });

  const presentToday = todayLogs.filter(l => ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes(l.attendanceType)).length;

  return {
    totalMembers: members.length,
    activeMembers: members.length,
    presentToday,
    onLeave: onLeaveToday,
    avgAttendance: members.length ? Math.round((presentToday / members.length) * 100) : 0,
    departmentBreakdown,
    newHires: members.filter(m => m.hireDate && new Date(m.hireDate) >= thirtyDaysAgo).length,
    pendingApprovals,
    teamSize: members.length,
    directReports: user.role === 'MANAGER' ? members.length : undefined
  };
}

// Same bounded-staleness reasoning as the dashboard cache - this feeds Team/Profile
// stat cards that get polled/re-rendered often but don't need second-level freshness.
const STATS_CACHE_TTL_SECONDS = 20;

router.get('/stats', authenticate, async (req, res) => {
  try {
    const cacheKey = `userstats:${req.user.organizationId}:${req.user.role}:${req.user.id}`;
    const data = await withCache(cacheKey, STATS_CACHE_TTL_SECONDS, () => computeUserOrTeamStats(req.user));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to get stats' });
  }
});

/**
 * @route   GET /api/v1/users/analytics
 * @desc    Team analytics (attendance rate, department/role distribution, recent activity)
 * @access  Private (Manager, HR, Admin)
 */
router.get('/analytics', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const whereClause = { organizationId: req.user.organizationId, isActive: true };
    if (req.user.role === 'MANAGER') whereClause.managerId = req.user.id;

    const members = await User.findAll({ where: whereClause, attributes: ['id', 'name', 'department', 'role'] });
    const memberIds = members.map(m => m.id);
    const today = todayStr();

    const [todayLogs, recentAudit] = await Promise.all([
      AttendanceLog.findAll({ where: { userId: { [Op.in]: memberIds }, date: today } }),
      AuditLog.findAll({
        where: { organizationId: req.user.organizationId },
        order: [['timestamp', 'DESC']],
        limit: 15,
        include: [{ model: User, as: 'actor', attributes: ['id', 'name'], required: false }]
      })
    ]);

    const present = todayLogs.filter(l => ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes(l.attendanceType)).length;
    const attendanceRate = members.length ? Math.round((present / members.length) * 100) : 0;

    const departmentDistribution = {};
    const roleDistribution = {};
    members.forEach(m => {
      departmentDistribution[m.department || 'Unassigned'] = (departmentDistribution[m.department || 'Unassigned'] || 0) + 1;
      roleDistribution[m.role] = (roleDistribution[m.role] || 0) + 1;
    });

    const performanceMetrics = await Promise.all(members.slice(0, 20).map(async m => {
      const minutes = await checkInMinutesSince(m.id, daysAgoStr(30));
      return {
        userId: m.id,
        userName: m.name,
        attendanceRate,
        productivityScore: consistencyScore(minutes),
        tasksCompleted: 0, // not tracked - no task system exists
        rating: 0 // not tracked - no performance review system exists
      };
    }));

    res.json({
      success: true,
      data: {
        attendanceRate,
        productivityScore: performanceMetrics.length ? Math.round(performanceMetrics.reduce((s, p) => s + p.productivityScore, 0) / performanceMetrics.length) : 0,
        averageLeaveBalance: 0, // no leave-policy/allocation system exists to compute a real balance from
        departmentDistribution: Object.entries(departmentDistribution).map(([department, count]) => ({ department, count })),
        roleDistribution: Object.entries(roleDistribution).map(([role, count]) => ({ role, count })),
        recentActivity: recentAudit.map(a => ({
          id: a.id,
          userId: a.actorId,
          userName: a.actor?.name || 'System',
          action: a.action,
          timestamp: a.timestamp,
          details: a.description
        })),
        performanceMetrics
      }
    });
  } catch (error) {
    console.error('Get team analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to get team analytics' });
  }
});

/**
 * @route   GET /api/v1/users/stats/departments
 * @desc    Per-department stats breakdown
 * @access  Private (HR, Admin)
 */
router.get('/stats/departments', authenticate, authorize(...IS_HR_UP), async (req, res) => {
  try {
    const members = await User.findAll({ where: { organizationId: req.user.organizationId, isActive: true }, attributes: ['id', 'department'] });
    const today = todayStr();
    const logs = await AttendanceLog.findAll({ where: { userId: { [Op.in]: members.map(m => m.id) }, date: today } });
    const logByUser = {}; logs.forEach(l => { logByUser[l.userId] = l; });

    const byDept = {};
    members.forEach(m => {
      const dept = m.department || 'Unassigned';
      if (!byDept[dept]) byDept[dept] = { totalMembers: 0, presentToday: 0 };
      byDept[dept].totalMembers += 1;
      const log = logByUser[m.id];
      if (log && ['PRESENT', 'LATE', 'WORK_FROM_HOME', 'HALF_DAY'].includes(log.attendanceType)) {
        byDept[dept].presentToday += 1;
      }
    });

    res.json({ success: true, data: byDept });
  } catch (error) {
    console.error('Get department stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to get department stats' });
  }
});

/**
 * @route   GET /api/v1/users/activity
 * @desc    Own recent actions (Employee) or org-wide recent activity (Manager/HR/Admin)
 * @access  Private
 */
router.get('/activity', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const whereClause = { organizationId: req.user.organizationId };
    if (!IS_MANAGER_UP.includes(req.user.role)) whereClause.actorId = req.user.id;

    const logs = await AuditLog.findAll({
      where: whereClause,
      order: [['timestamp', 'DESC']],
      limit,
      include: [{ model: User, as: 'actor', attributes: ['id', 'name'], required: false }]
    });

    res.json({
      success: true,
      data: logs.map(a => ({
        id: a.id,
        userId: a.actorId,
        userName: a.actor?.name || 'System',
        action: a.action,
        description: a.description,
        timestamp: a.timestamp
      }))
    });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ success: false, message: 'Failed to get activity' });
  }
});

/**
 * @route   GET /api/v1/users/export
 * @desc    Own data export (Employee) or team export with filters (Manager/HR/Admin)
 * @access  Private
 */
router.get('/export', authenticate, async (req, res) => {
  try {
    const format = req.query.format || 'csv';

    if (!IS_MANAGER_UP.includes(req.user.role)) {
      return exportOwnData(req, res, format);
    }

    const whereClause = { organizationId: req.user.organizationId };
    if (req.query.department) whereClause.department = req.query.department;
    if (req.query.role) whereClause.role = req.query.role;
    if (req.user.role === 'MANAGER') whereClause.managerId = req.user.id;

    const members = await User.findAll({ where: whereClause, attributes: { exclude: ['password'] } });
    sendCsv(res, 'team-export.csv', members.map(m => m.toJSON()));
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Failed to export data' });
  }
});

router.post('/export', authenticate, authorize(...IS_MANAGER_UP), async (req, res) => {
  try {
    const { userIds } = req.body;
    const members = await User.findAll({
      where: { id: { [Op.in]: userIds || [] }, organizationId: req.user.organizationId },
      attributes: { exclude: ['password'] }
    });
    sendCsv(res, 'selected-members.csv', members.map(m => m.toJSON()));
  } catch (error) {
    console.error('Export selected error:', error);
    res.status(500).json({ success: false, message: 'Failed to export selected members' });
  }
});

async function exportOwnData(req, res, format) {
  const user = await User.findByPk(req.user.id);
  if (format === 'json') {
    return res.json(user.toJSON());
  }
  sendCsv(res, 'my-data.csv', [user.toJSON()]);
}

function sendCsv(res, filename, rows) {
  if (!rows.length) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('');
  }
  const headers = Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object');
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// ============================================================================
// Profile (self-service)
// ============================================================================

/**
 * @route   GET /api/v1/users/profile
 * @desc    Get own profile
 * @access  Private
 */
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { include: [{ model: Certification, as: 'certifications' }] });
    res.json({ success: true, data: user.toJSON() });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

/**
 * @route   GET /api/v1/users/login-history
 * @desc    Own recent login history, derived from the real audit log
 * @access  Private
 */
router.get('/login-history', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const logs = await AuditLog.findAll({
      where: { actorId: req.user.id, action: 'LOGIN' },
      order: [['timestamp', 'DESC']],
      limit
    });

    res.json({
      success: true,
      data: logs.map(l => ({
        ipAddress: l.ipAddress || 'Unknown',
        deviceInfo: l.userAgent || 'Unknown device',
        timestamp: l.timestamp,
        success: true
      }))
    });
  } catch (error) {
    console.error('Get login history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get login history' });
  }
});

/**
 * @route   GET /api/v1/users/timezones
 * @access  Private
 */
router.get('/timezones', authenticate, (req, res) => {
  res.json({ success: true, data: TIMEZONES });
});

/**
 * @route   GET /api/v1/users/languages
 * @access  Private
 */
router.get('/languages', authenticate, (req, res) => {
  res.json({ success: true, data: LANGUAGES });
});

/**
 * @route   GET /api/v1/users
 * @desc    Get all users in organization (HR/Admin only)
 * @access  Private (HR, ADMIN)
 */
router.get('/', authenticate, authorize('HR', 'ADMIN'), async (req, res) => {
  try {
    const { role, department, isActive } = req.query;
    const whereClause = { organizationId: req.user.organizationId };
    if (role) whereClause.role = role;
    if (department) whereClause.department = department;
    if (isActive !== undefined) whereClause.isActive = isActive === 'true';

    const users = await User.findAll({ where: whereClause, attributes: { exclude: ['password'] }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
  }
});

/**
 * @route   GET /api/v1/users/:userId/attendance
 * @desc    A user's attendance history (self, or manager/HR/admin)
 * @access  Private
 */
router.get('/:userId/attendance', authenticate, authorizeResourceAccess, async (req, res) => {
  try {
    const { startDate, endDate, page = 1, limit = 30 } = req.query;
    const result = await AttendanceService.getAttendanceHistory(req.params.userId, startDate, endDate, parseInt(page), parseInt(limit), req.user.organizationId);
    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Get member attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to get attendance history' });
  }
});

/**
 * @route   GET /api/v1/users/:userId/leaves
 * @desc    A user's leave history (self, or manager/HR/admin)
 * @access  Private
 */
router.get('/:userId/leaves', authenticate, authorizeResourceAccess, async (req, res) => {
  try {
    const leaves = await LeaveService.getUserLeaves(req.params.userId, {}, req.user.organizationId);
    res.json({ success: true, data: leaves });
  } catch (error) {
    console.error('Get member leaves error:', error);
    res.status(500).json({ success: false, message: 'Failed to get leave history' });
  }
});

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user by ID
 * @access  Private
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      attributes: { exclude: ['password'] },
      include: [{ model: User, as: 'manager', attributes: ['id', 'name', 'email'] }]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user', error: error.message });
  }
});

// ============================================================================
// PUT routes
// ============================================================================

/**
 * @route   PUT /api/v1/users/profile
 * @desc    Update own profile
 * @access  Private
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, phone, department, designation, skills, address, emergencyContact } = req.body;
    const user = await User.findByPk(req.user.id);

    const updateData = {};
    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (department !== undefined) updateData.department = department;
    if (designation !== undefined) updateData.designation = designation;

    const metadata = { ...user.metadata };
    if (skills !== undefined) metadata.skills = skills;
    if (address !== undefined) metadata.address = address;
    if (emergencyContact !== undefined) metadata.emergencyContact = emergencyContact;
    updateData.metadata = metadata;

    await user.update(updateData);
    res.json({ success: true, message: 'Profile updated successfully', data: user.toJSON() });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update profile' });
  }
});

/**
 * @route   PUT /api/v1/users/preferences
 * @desc    Update own preferences (theme, language, timezone, notifications, working hours)
 * @access  Private
 */
router.put('/preferences', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    const metadata = { ...user.metadata, preferences: { ...user.metadata?.preferences, ...req.body } };
    await user.update({ metadata });
    res.json({ success: true, message: 'Preferences updated', data: metadata.preferences });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(400).json({ success: false, message: 'Failed to update preferences' });
  }
});

/**
 * @route   PUT /api/v1/users/certifications/:id
 * @access  Private
 */
router.put('/certifications/:id', authenticate, async (req, res) => {
  try {
    const cert = await Certification.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!cert) {
      return res.status(404).json({ success: false, message: 'Certification not found' });
    }

    const { name, provider, dateObtained, expiryDate } = req.body;
    await cert.update({ name, provider, dateObtained, expiryDate });
    res.json({ success: true, data: cert });
  } catch (error) {
    console.error('Update certification error:', error);
    res.status(400).json({ success: false, message: 'Failed to update certification' });
  }
});

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update user (HR/Admin only)
 * @access  Private (HR, ADMIN)
 */
router.put('/:id', authenticate, authorize('HR', 'ADMIN'), async (req, res) => {
  try {
    const { name, email, role, department, managerId, isActive } = req.body;
    const user = await User.findOne({ where: { id: req.params.id, organizationId: req.user.organizationId } });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Only administrators can update admin accounts' });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email.toLowerCase();
    if (role) updateData.role = role;
    if (department) updateData.department = department;
    if (managerId !== undefined) updateData.managerId = managerId;
    if (isActive !== undefined) updateData.isActive = isActive;

    await user.update(updateData);

    await AuditLog.create({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: user.id,
      description: `User updated: ${user.name}`,
      timestamp: new Date().toISOString(),
      source: 'WEB',
      severity: 'INFO'
    });

    res.json({ success: true, message: 'User updated successfully', data: user.toJSON() });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
  }
});

// ============================================================================
// PATCH routes
// ============================================================================

router.patch('/:id/deactivate', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await user.update({ isActive: false });
    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ success: false, message: 'Failed to deactivate user' });
  }
});

router.patch('/:id/activate', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await user.update({ isActive: true });
    res.json({ success: true, message: 'User activated successfully' });
  } catch (error) {
    console.error('Activate user error:', error);
    res.status(500).json({ success: false, message: 'Failed to activate user' });
  }
});

// ============================================================================
// POST routes
// ============================================================================

/**
 * @route   POST /api/v1/users/avatar
 * @access  Private
 */
router.post('/avatar', authenticate, async (req, res) => {
  try {
    const { dataUrl } = req.body;
    if (!dataUrl) {
      return res.status(400).json({ success: false, message: 'dataUrl is required' });
    }

    const user = await User.findByPk(req.user.id);
    const metadata = { ...user.metadata, avatarUrl: dataUrl };
    await user.update({ metadata });

    res.json({ success: true, avatarUrl: dataUrl });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(400).json({ success: false, message: 'Failed to upload avatar' });
  }
});

/**
 * @route   DELETE /api/v1/users/avatar
 * @access  Private
 */
router.delete('/avatar', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    const metadata = { ...user.metadata };
    delete metadata.avatarUrl;
    await user.update({ metadata });
    res.json({ success: true, message: 'Avatar removed' });
  } catch (error) {
    console.error('Remove avatar error:', error);
    res.status(400).json({ success: false, message: 'Failed to remove avatar' });
  }
});

/**
 * @route   POST /api/v1/users/change-password
 * @access  Private
 */
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await AuthService.changePassword(req.user.id, currentPassword, newPassword);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to change password' });
  }
});

/**
 * @route   POST /api/v1/users/certifications
 * @access  Private
 */
router.post('/certifications', authenticate, async (req, res) => {
  try {
    const { name, provider, dateObtained, expiryDate } = req.body;
    if (!name || !provider || !dateObtained) {
      return res.status(400).json({ success: false, message: 'name, provider, and dateObtained are required' });
    }

    const cert = await Certification.create({ userId: req.user.id, name, provider, dateObtained, expiryDate });
    res.status(201).json({ success: true, data: cert });
  } catch (error) {
    console.error('Add certification error:', error);
    res.status(400).json({ success: false, message: 'Failed to add certification' });
  }
});

/**
 * @route   DELETE /api/v1/users/certifications/:id
 * @access  Private
 */
router.delete('/certifications/:id', authenticate, async (req, res) => {
  try {
    const deleted = await Certification.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Certification not found' });
    res.json({ success: true, message: 'Certification removed' });
  } catch (error) {
    console.error('Delete certification error:', error);
    res.status(400).json({ success: false, message: 'Failed to delete certification' });
  }
});

/**
 * @route   POST /api/v1/users/certifications/:certificationId/document
 * @desc    Attach a document (stored as a data URL - no external file storage is wired up)
 * @access  Private
 */
router.post('/certifications/:certificationId/document', authenticate, async (req, res) => {
  try {
    const cert = await Certification.findOne({ where: { id: req.params.certificationId, userId: req.user.id } });
    if (!cert) return res.status(404).json({ success: false, message: 'Certification not found' });

    const { dataUrl } = req.body;
    await cert.update({ certificateUrl: dataUrl });
    res.json({ success: true, data: cert });
  } catch (error) {
    console.error('Upload certification document error:', error);
    res.status(400).json({ success: false, message: 'Failed to upload document' });
  }
});

/**
 * @route   POST /api/v1/users/delete-request
 * @access  Private
 */
router.post('/delete-request', authenticate, async (req, res) => {
  try {
    await AuditLog.create({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: req.user.id,
      description: `Account deletion requested: ${req.body.reason || 'no reason given'}`,
      timestamp: new Date().toISOString(),
      source: 'WEB',
      severity: 'WARNING'
    });

    res.json({ success: true, message: 'Account deletion request submitted' });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(400).json({ success: false, message: 'Failed to submit deletion request' });
  }
});

/**
 * @route   POST /api/v1/users/2fa/enable
 * @desc    Generate a real TOTP secret (RFC 6238) and return a setup URI for an authenticator app
 * @access  Private
 */
router.post('/2fa/enable', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    const secret = totp.generateSecret();
    await user.update({ twoFactorSecret: secret });

    res.json({
      success: true,
      data: { secret: totp.toBase32(secret), authUri: totp.buildAuthUri(secret, user.email) },
      message: 'Scan the QR/enter the key in your authenticator app, then verify a code to finish enabling 2FA'
    });
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(400).json({ success: false, message: 'Failed to start 2FA setup' });
  }
});

/**
 * @route   POST /api/v1/users/2fa/verify
 * @desc    Verify a TOTP code and, if this is the first successful check, turn 2FA on
 * @access  Private
 */
router.post('/2fa/verify', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: '2FA setup has not been started' });
    }

    const isValid = totp.verifyTotp(user.twoFactorSecret, req.body.code);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    if (!user.twoFactorEnabled) {
      await user.update({ twoFactorEnabled: true });
    }

    res.json({ success: true, message: '2FA verified' });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(400).json({ success: false, message: 'Failed to verify code' });
  }
});

/**
 * @route   POST /api/v1/users/2fa/disable
 * @access  Private
 */
router.post('/2fa/disable', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (user.twoFactorEnabled && !totp.verifyTotp(user.twoFactorSecret, req.body.code)) {
      return res.status(400).json({ success: false, message: 'A valid code is required to disable 2FA' });
    }

    await user.update({ twoFactorEnabled: false, twoFactorSecret: null });
    res.json({ success: true, message: '2FA disabled' });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(400).json({ success: false, message: 'Failed to disable 2FA' });
  }
});

// ============================================================================
// Bulk operations (Manager/HR/Admin)
// ============================================================================

router.post('/bulk-update', authenticate, authorize('HR', 'ADMIN'), async (req, res) => {
  try {
    const { userIds, updates } = req.body;
    const [updatedCount] = await User.update(updates, { where: { id: { [Op.in]: userIds || [] }, organizationId: req.user.organizationId } });
    res.json({ success: true, updatedCount, failedIds: [], message: `Updated ${updatedCount} member(s)` });
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(400).json({ success: false, updatedCount: 0, failedIds: req.body.userIds || [], message: 'Bulk update failed' });
  }
});

router.post('/bulk-deactivate', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { userIds } = req.body;
    const [updatedCount] = await User.update({ isActive: false }, { where: { id: { [Op.in]: userIds || [] }, organizationId: req.user.organizationId } });
    res.json({ success: true, updatedCount, failedIds: [], message: `Deactivated ${updatedCount} member(s)` });
  } catch (error) {
    console.error('Bulk deactivate error:', error);
    res.status(400).json({ success: false, updatedCount: 0, failedIds: req.body.userIds || [], message: 'Bulk deactivate failed' });
  }
});

router.post('/bulk-transfer', authenticate, authorize('HR', 'ADMIN'), async (req, res) => {
  try {
    const { userIds, department } = req.body;
    const [updatedCount] = await User.update({ department }, { where: { id: { [Op.in]: userIds || [] }, organizationId: req.user.organizationId } });
    res.json({ success: true, updatedCount, failedIds: [], message: `Transferred ${updatedCount} member(s) to ${department}` });
  } catch (error) {
    console.error('Bulk transfer error:', error);
    res.status(400).json({ success: false, updatedCount: 0, failedIds: req.body.userIds || [], message: 'Bulk transfer failed' });
  }
});

router.post('/bulk-assign-manager', authenticate, authorize('HR', 'ADMIN'), async (req, res) => {
  try {
    const { userIds, managerId } = req.body;
    const [updatedCount] = await User.update({ managerId }, { where: { id: { [Op.in]: userIds || [] }, organizationId: req.user.organizationId } });
    res.json({ success: true, updatedCount, failedIds: [], message: `Reassigned ${updatedCount} member(s)` });
  } catch (error) {
    console.error('Bulk assign manager error:', error);
    res.status(400).json({ success: false, updatedCount: 0, failedIds: req.body.userIds || [], message: 'Bulk manager assignment failed' });
  }
});

// ============================================================================
// DELETE /:id (generic, must stay after specific DELETE routes above)
// ============================================================================

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Deactivate user (Admin only)
 * @access  Private (ADMIN)
 */
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await user.update({ isActive: false });

    await AuditLog.create({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: user.id,
      description: `User deactivated: ${user.name}`,
      timestamp: new Date().toISOString(),
      source: 'WEB',
      severity: 'WARNING'
    });

    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ success: false, message: 'Failed to deactivate user', error: error.message });
  }
});

module.exports = router;
