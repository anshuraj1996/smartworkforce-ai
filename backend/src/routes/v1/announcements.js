const express = require('express');
const router = express.Router();
const AnnouncementService = require('../../services/AnnouncementService');
const { authenticate } = require('../../middleware/auth');
const { validateUUID } = require('../../middleware/validation');

/**
 * @route   GET /api/v1/announcements
 * @desc    List active announcements for the organization
 * @access  Private
 * @version 1.0.0
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const announcements = await AnnouncementService.list(req.user.organizationId);

        res.json({
            success: true,
            data: announcements,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('List announcements error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get announcements',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/announcements/feed
 * @desc    Combined dashboard feed: announcements + today's birthdays + new joiners
 * @access  Private
 * @version 1.0.0
 */
router.get('/feed', authenticate, async (req, res) => {
    try {
        const feed = await AnnouncementService.getFeed(req.user.organizationId);

        res.json({
            success: true,
            data: feed,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Get feed error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get dashboard feed',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/announcements
 * @desc    Create an announcement (HR/Admin)
 * @access  Private (HR/Admin)
 * @version 1.0.0
 */
router.post('/', authenticate, async (req, res) => {
    try {
        if (!['HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to post announcements',
                version: '1.0.0'
            });
        }

        const { title, body, category, isPinned, expiresAt } = req.body;
        if (!title || !body) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: title, body',
                version: '1.0.0'
            });
        }

        const announcement = await AnnouncementService.create(req.user.id, req.user.organizationId, {
            title, body, category, isPinned, expiresAt
        });

        res.status(201).json({
            success: true,
            message: 'Announcement posted',
            data: announcement,
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Create announcement error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to create announcement',
            version: '1.0.0'
        });
    }
});

/**
 * @route   DELETE /api/v1/announcements/:id
 * @desc    Remove an announcement (HR/Admin)
 * @access  Private (HR/Admin)
 * @version 1.0.0
 */
router.delete('/:id', authenticate, validateUUID('id'), async (req, res) => {
    try {
        if (!['HR', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to delete announcements',
                version: '1.0.0'
            });
        }

        await AnnouncementService.remove(req.params.id, req.user.organizationId);

        res.json({
            success: true,
            message: 'Announcement deleted',
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Delete announcement error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to delete announcement',
            version: '1.0.0'
        });
    }
});

module.exports = router;
