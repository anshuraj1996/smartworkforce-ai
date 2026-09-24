const express = require('express');
const router = express.Router();
const WfhService = require('../../services/WfhService');
const { authenticate } = require('../../middleware/auth');
const { validate, validateUUID, schemas } = require('../../middleware/validation');

/**
 * @route   POST /api/v1/wfh/apply
 * @desc    Request work from home (full or half day)
 * @access  Private
 * @version 1.0.0
 */
router.post('/apply', authenticate, validate(schemas.createWfhRequest), async (req, res) => {
    try {
        const wfhRequest = await WfhService.applyWfh(req.user.id, req.user.organizationId, req.body);

        res.status(201).json({
            success: true,
            message: 'WFH request submitted successfully',
            data: wfhRequest,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Apply WFH error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to submit WFH request',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/wfh/me
 * @desc    Get current user's WFH requests
 * @access  Private
 * @version 1.0.0
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const { status } = req.query;
        const requests = await WfhService.getUserWfhRequests(req.user.id, { status }, req.user.organizationId);

        res.json({
            success: true,
            data: requests,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get WFH requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get WFH requests',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/wfh/quota
 * @desc    Get the current user's WFH quota usage for a given month
 * @access  Private
 * @version 1.0.0
 */
router.get('/quota', authenticate, async (req, res) => {
    try {
        const now = new Date();
        const month = req.query.month ? parseInt(req.query.month) : now.getMonth() + 1;
        const year = req.query.year ? parseInt(req.query.year) : now.getFullYear();

        const quota = await WfhService.getMonthlyQuotaUsage(req.user.id, req.user.organizationId, month, year);

        res.json({
            success: true,
            data: quota,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get WFH quota error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get WFH quota',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/wfh/pending
 * @desc    Get pending WFH requests (Manager/HR/Admin)
 * @access  Private
 * @version 1.0.0
 */
router.get('/pending', authenticate, async (req, res) => {
    try {
        if (!['MANAGER', 'HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to view pending WFH requests',
                version: '1.0.0'
            });
        }

        const managerId = req.user.role === 'MANAGER' ? req.user.id : null;
        const pendingRequests = await WfhService.getPendingWfhRequests(req.user.organizationId, managerId);

        res.json({
            success: true,
            data: pendingRequests,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get pending WFH requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get pending WFH requests',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/wfh/:id/approve
 * @desc    Approve a WFH request
 * @access  Private (Manager/HR/Admin)
 * @version 1.0.0
 */
router.post('/:id/approve', authenticate, validateUUID('id'), async (req, res) => {
    try {
        if (!['MANAGER', 'HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to approve WFH requests',
                version: '1.0.0'
            });
        }

        const approved = await WfhService.approveWfh(req.params.id, req.user.id, req.user.organizationId);

        res.json({
            success: true,
            message: 'WFH request approved successfully',
            data: approved,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Approve WFH error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to approve WFH request',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/wfh/:id/reject
 * @desc    Reject a WFH request
 * @access  Private (Manager/HR/Admin)
 * @version 1.0.0
 */
router.post('/:id/reject', authenticate, validateUUID('id'), async (req, res) => {
    try {
        if (!['MANAGER', 'HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to reject WFH requests',
                version: '1.0.0'
            });
        }

        const { rejectionReason } = req.body;
        if (!rejectionReason) {
            return res.status(400).json({
                success: false,
                message: 'A rejection reason is required',
                version: '1.0.0'
            });
        }

        const rejected = await WfhService.rejectWfh(req.params.id, req.user.id, req.user.organizationId, rejectionReason);

        res.json({
            success: true,
            message: 'WFH request rejected',
            data: rejected,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Reject WFH error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to reject WFH request',
            version: '1.0.0'
        });
    }
});

module.exports = router;
