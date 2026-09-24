const express = require('express');
const router = express.Router();
const NotificationService = require('../../services/NotificationService');
const { authenticate } = require('../../middleware/auth');
const { validateUUID } = require('../../middleware/validation');

/**
 * @route   GET /api/v1/notifications/me
 * @desc    Get current user's notifications
 * @access  Private
 * @version 1.0.0
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const { category, unreadOnly, page = 1, limit = 20 } = req.query;
        const result = await NotificationService.getForUser(req.user.id, {
            category,
            unreadOnly: unreadOnly === 'true',
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get notifications',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/notifications/unread-count
 * @desc    Get count of unread notifications for the badge on the bell icon
 * @access  Private
 * @version 1.0.0
 */
router.get('/unread-count', authenticate, async (req, res) => {
    try {
        const count = await NotificationService.getUnreadCount(req.user.id);

        res.json({
            success: true,
            data: { count },
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get unread notification count',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/notifications/:id/read
 * @desc    Mark a single notification as read
 * @access  Private
 * @version 1.0.0
 */
router.post('/:id/read', authenticate, validateUUID('id'), async (req, res) => {
    try {
        const notification = await NotificationService.markAsRead(req.params.id, req.user.id);

        res.json({
            success: true,
            data: notification,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to update notification',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/notifications/read-all
 * @desc    Mark all of the current user's notifications as read
 * @access  Private
 * @version 1.0.0
 */
router.post('/read-all', authenticate, async (req, res) => {
    try {
        const result = await NotificationService.markAllAsRead(req.user.id);

        res.json({
            success: true,
            data: result,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Mark all notifications read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notifications',
            version: '1.0.0'
        });
    }
});

module.exports = router;
