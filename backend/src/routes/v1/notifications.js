const express = require('express');
const router = express.Router();
const notificationController = require('../../controllers/notificationController');
const { authenticate } = require('../../middleware/auth');
const { validateUUID } = require('../../middleware/validation');

// GET  /api/v1/notifications/me            - Own notifications (?category&unreadOnly&page&limit)
router.get('/me', authenticate, notificationController.getMine);

// GET  /api/v1/notifications/unread-count  - Badge count for the bell icon
router.get('/unread-count', authenticate, notificationController.getUnreadCount);

// POST /api/v1/notifications/:id/read      - Mark one as read
router.post('/:id/read', authenticate, validateUUID('id'), notificationController.markRead);

// POST /api/v1/notifications/read-all      - Mark all as read
router.post('/read-all', authenticate, notificationController.markAllRead);

module.exports = router;
