const express = require('express');
const router = express.Router();
const attendanceController = require('../../controllers/attendanceController');
const { authenticate, authorize } = require('../../middleware/auth');
const { IS_MANAGER_UP, ROLES } = require('../../config/constants');

// POST /api/v1/attendance/check-in     - Check in for today
router.post('/check-in', authenticate, attendanceController.checkIn);

// POST /api/v1/attendance/check-out    - Check out for today
router.post('/check-out', authenticate, attendanceController.checkOut);

// GET  /api/v1/attendance/me           - Own attendance records (?startDate&endDate&page&limit)
router.get('/me', authenticate, attendanceController.getMine);

// GET  /api/v1/attendance/today        - Own attendance for today
router.get('/today', authenticate, attendanceController.getToday);

// GET  /api/v1/attendance/history      - Own attendance history (same as /me)
router.get('/history', authenticate, attendanceController.getHistory);

// GET  /api/v1/attendance/stats        - Own monthly statistics (?month&year)
router.get('/stats', authenticate, attendanceController.getStats);

// GET  /api/v1/attendance/team         - Team attendance for a date (managers: direct reports)
router.get('/team', authenticate, authorize(...IS_MANAGER_UP), attendanceController.getTeam);

// GET  /api/v1/attendance/calendar     - Monthly calendar view (?month&year)
router.get('/calendar', authenticate, attendanceController.getCalendar);

// POST /api/v1/attendance/bulk-update  - Admin corrections (body: updates[])
router.post('/bulk-update', authenticate, authorize(ROLES.ADMIN), attendanceController.bulkUpdate);

module.exports = router;
