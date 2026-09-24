const express = require('express');
const router = express.Router();
const AttendanceService = require('../../services/AttendanceService');
const { authenticate } = require('../../middleware/auth');
const { withCache } = require('../../utils/cache');

// The dashboard polls this on a timer for every manager/HR/admin session - short TTL
// bounds staleness the same way the dashboard/stats caches do.
const TEAM_ATTENDANCE_CACHE_TTL_SECONDS = 20;

/**
 * @route   POST /api/v1/attendance/check-in
 * @desc    Check in user attendance
 * @access  Private
 * @version 1.0.0
 */
router.post('/check-in', authenticate, async (req, res) => {
    try {
        const record = await AttendanceService.checkIn(req.user.id, req.user.organizationId, req.body);
        res.json({
            success: true,
            message: 'Checked in successfully',
            data: record,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Check-in failed',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/attendance/check-out
 * @desc    Check out user attendance
 * @access  Private
 * @version 1.0.0
 */
router.post('/check-out', authenticate, async (req, res) => {
    try {
        const record = await AttendanceService.checkOut(req.user.id, req.user.organizationId, req.body);
        res.json({
            success: true,
            message: 'Checked out successfully',
            data: record,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Check-out error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Check-out failed',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/attendance/me
 * @desc    Get user attendance records
 * @access  Private
 * @version 1.0.0
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 30, startDate, endDate } = req.query;
        const result = await AttendanceService.getAttendanceHistory(
            req.user.id,
            startDate,
            endDate,
            parseInt(page),
            parseInt(limit),
            req.user.organizationId
        );

        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/attendance/today
 * @desc    Get today's attendance for user
 * @access  Private
 * @version 1.0.0
 */
router.get('/today', authenticate, async (req, res) => {
    try {
        const result = await AttendanceService.getTodayAttendance(req.user.id);
        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get today attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/attendance/history
 * @desc    Get attendance history for user
 * @access  Private
 * @version 1.0.0
 */
router.get('/history', authenticate, async (req, res) => {
    try {
        const { startDate, endDate, page = 1, limit = 30 } = req.query;
        const result = await AttendanceService.getAttendanceHistory(
            req.user.id,
            startDate,
            endDate,
            parseInt(page),
            parseInt(limit),
            req.user.organizationId
        );

        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get attendance history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get attendance history',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/attendance/stats
 * @desc    Get attendance statistics for user
 * @access  Private
 * @version 1.0.0
 */
router.get('/stats', authenticate, async (req, res) => {
    try {
        const { month, year } = req.query;
        const result = await AttendanceService.getAttendanceStats(
            req.user.id,
            month ? parseInt(month) : null,
            year ? parseInt(year) : null
        );
        
        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get attendance stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get attendance statistics',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/attendance/team
 * @desc    Get team attendance (Manager/HR/Admin)
 * @access  Private
 * @version 1.0.0
 */
router.get('/team', authenticate, async (req, res) => {
    try {
        // Check permissions
        if (!['MANAGER', 'HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to view team attendance',
                version: '1.0.0'
            });
        }

        const { date } = req.query;
        const managerId = req.user.role === 'MANAGER' ? req.user.id : null;

        const cacheKey = `team-attendance:${req.user.organizationId}:${managerId || 'all'}:${date || 'today'}`;
        const result = await withCache(cacheKey, TEAM_ATTENDANCE_CACHE_TTL_SECONDS, () =>
            AttendanceService.getTeamAttendance(req.user.organizationId, date, managerId)
        );

        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get team attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get team attendance',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/attendance/calendar
 * @desc    Monthly calendar view (present/absent/leave/wfh/holiday/weekend per day)
 * @access  Private
 * @version 1.0.0
 */
router.get('/calendar', authenticate, async (req, res) => {
    try {
        const now = new Date();
        const month = req.query.month ? parseInt(req.query.month) : now.getMonth() + 1;
        const year = req.query.year ? parseInt(req.query.year) : now.getFullYear();

        const calendar = await AttendanceService.getMonthlyCalendar(
            req.user.id,
            req.user.organizationId,
            month,
            year
        );

        res.json({
            success: true,
            data: calendar,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get monthly calendar error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get monthly calendar',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/attendance/bulk-update
 * @desc    Bulk update attendance records (Admin only)
 * @access  Private
 * @version 1.0.0
 */
router.post('/bulk-update', authenticate, async (req, res) => {
    try {
        // Check permissions
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Only admins can perform bulk updates',
                version: '1.0.0'
            });
        }

        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({
                success: false,
                message: 'Updates array is required',
                version: '1.0.0'
            });
        }

        const result = await AttendanceService.bulkUpdateAttendance(updates, req.user.id, req.user.organizationId);
        
        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Bulk update attendance error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to update attendance records',
            version: '1.0.0'
        });
    }
});

module.exports = router;
