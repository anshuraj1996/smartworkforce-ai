const express = require('express');
const router = express.Router();
const LeaveService = require('../../services/LeaveService');
const { authenticate } = require('../../middleware/auth');

/**
 * @route   POST /api/v1/leave/apply
 * @desc    Apply for leave
 * @access  Private
 * @version 1.0.0
 */
router.post('/apply', authenticate, async (req, res) => {
    try {
        const { startDate, endDate, leaveType, reason, isHalfDay } = req.body;
        
        if (!startDate || !endDate || !leaveType || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: startDate, endDate, leaveType, reason',
                version: '1.0.0'
            });
        }

        const leaveRequest = await LeaveService.applyLeave(
            req.user.id, 
            req.user.organizationId, 
            { startDate, endDate, leaveType, reason, isHalfDay }
        );

        res.status(201).json({
            success: true,
            message: 'Leave application submitted successfully',
            data: leaveRequest,
            version: '1.0.0'
        });

    } catch (error) {
        console.error('Apply leave error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to apply for leave',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/leave/me
 * @desc    Get user's leave requests
 * @access  Private
 * @version 1.0.0
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const { status, startDate, endDate } = req.query;
        const filters = { status, startDate, endDate };
        
        const leaves = await LeaveService.getUserLeaves(req.user.id, filters, req.user.organizationId);

        res.json({
            success: true,
            data: leaves,
            version: '1.0.0'
        });

    } catch (error) {
        console.error('Get user leaves error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get leave requests',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/leave/pending
 * @desc    Get pending leave requests (Manager/HR/Admin)
 * @access  Private
 * @version 1.0.0
 */
router.get('/pending', authenticate, async (req, res) => {
    try {
        // Check if user has permission to view pending leaves
        if (!['MANAGER', 'HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to view pending leaves',
                version: '1.0.0'
            });
        }

        const managerId = req.user.role === 'MANAGER' ? req.user.id : null;
        const pendingLeaves = await LeaveService.getPendingLeaves(
            req.user.organizationId, 
            managerId
        );

        res.json({
            success: true,
            data: pendingLeaves,
            version: '1.0.0'
        });

    } catch (error) {
        console.error('Get pending leaves error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get pending leaves',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/leave/:id/approve
 * @desc    Approve leave request
 * @access  Private (Manager/HR/Admin)
 * @version 1.0.0
 */
router.post('/:id/approve', authenticate, async (req, res) => {
    try {
        // Check permissions
        if (!['MANAGER', 'HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to approve leaves',
                version: '1.0.0'
            });
        }

        const { comments } = req.body;
        const approvedLeave = await LeaveService.approveLeave(
            req.params.id,
            req.user.id,
            req.user.organizationId,
            comments
        );

        res.json({
            success: true,
            message: 'Leave request approved successfully',
            data: approvedLeave,
            version: '1.0.0'
        });

    } catch (error) {
        console.error('Approve leave error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to approve leave',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/leave/:id/reject
 * @desc    Reject leave request
 * @access  Private (Manager/HR/Admin)
 * @version 1.0.0
 */
router.post('/:id/reject', authenticate, async (req, res) => {
    try {
        // Check permissions
        if (!['MANAGER', 'HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to reject leaves',
                version: '1.0.0'
            });
        }

        const { comments } = req.body;
        if (!comments) {
            return res.status(400).json({
                success: false,
                message: 'Comments are required when rejecting a leave request',
                version: '1.0.0'
            });
        }

        const rejectedLeave = await LeaveService.rejectLeave(
            req.params.id,
            req.user.id,
            req.user.organizationId,
            comments
        );

        res.json({
            success: true,
            message: 'Leave request rejected',
            data: rejectedLeave,
            version: '1.0.0'
        });

    } catch (error) {
        console.error('Reject leave error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to reject leave',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/leave/statistics
 * @desc    Get leave statistics
 * @access  Private (HR/Admin)
 * @version 1.0.0
 */
router.get('/statistics', authenticate, async (req, res) => {
    try {
        // Check permissions
        if (!['HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to view leave statistics',
                version: '1.0.0'
            });
        }

        const { period = '1y' } = req.query;
        const statistics = await LeaveService.getLeaveStatistics(
            req.user.organizationId, 
            period
        );

        res.json({
            success: true,
            data: statistics,
            version: '1.0.0'
        });

    } catch (error) {
        console.error('Get leave statistics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get leave statistics',
            version: '1.0.0'
        });
    }
});

module.exports = router;
