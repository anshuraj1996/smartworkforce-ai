const AttendanceService = require('../services/AttendanceService');
const asyncHandler = require('../middleware/asyncHandler');
const { API_VERSION, ROLES } = require('../config/constants');

const toInt = (value, fallback) => (value ? parseInt(value, 10) : fallback);

const history = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const result = await AttendanceService.getAttendanceHistory(req.user.id, req.user.organizationId, {
    startDate,
    endDate,
    page: toInt(req.query.page, 1),
    limit: toInt(req.query.limit, 30)
  });

  res.json({ success: true, data: result, version: API_VERSION });
});

const attendanceController = {
  checkIn: asyncHandler(async (req, res) => {
    const record = await AttendanceService.checkIn(req.user.id, req.user.organizationId, req.body);
    res.json({ success: true, message: 'Checked in successfully', data: record, version: API_VERSION });
  }),

  checkOut: asyncHandler(async (req, res) => {
    const record = await AttendanceService.checkOut(req.user.id, req.user.organizationId, req.body);
    res.json({ success: true, message: 'Checked out successfully', data: record, version: API_VERSION });
  }),

  // /me and /history are the same query
  getMine: history,
  getHistory: history,

  getToday: asyncHandler(async (req, res) => {
    const record = await AttendanceService.getTodayAttendance(req.user.id);
    res.json({ success: true, data: record, version: API_VERSION });
  }),

  getStats: asyncHandler(async (req, res) => {
    const stats = await AttendanceService.getAttendanceStats(req.user.id, toInt(req.query.month, null), toInt(req.query.year, null));
    res.json({ success: true, data: stats, version: API_VERSION });
  }),

  getTeam: asyncHandler(async (req, res) => {
    const { date } = req.query;
    const managerId = req.user.role === ROLES.MANAGER ? req.user.id : null;
    const result = await AttendanceService.getTeamAttendance(req.user.organizationId, date, managerId);

    res.json({ success: true, data: result, version: API_VERSION });
  }),

  getCalendar: asyncHandler(async (req, res) => {
    const now = new Date();
    const calendar = await AttendanceService.getMonthlyCalendar(
      req.user.id,
      req.user.organizationId,
      toInt(req.query.month, now.getMonth() + 1),
      toInt(req.query.year, now.getFullYear())
    );

    res.json({ success: true, data: calendar, version: API_VERSION });
  }),

  bulkUpdate: asyncHandler(async (req, res) => {
    const result = await AttendanceService.bulkUpdateAttendance(req.body.updates, req.user.id, req.user.organizationId);
    res.json({ success: true, data: result, version: API_VERSION });
  })
};

module.exports = attendanceController;
