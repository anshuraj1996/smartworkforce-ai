const express = require('express');
const router = express.Router();
const announcementController = require('../../controllers/announcementController');
const { authenticate, authorize } = require('../../middleware/auth');
const { validateUUID } = require('../../middleware/validation');
const { IS_HR_UP } = require('../../config/constants');

// GET    /api/v1/announcements        - Active announcements
router.get('/', authenticate, announcementController.list);

// GET    /api/v1/announcements/feed   - Announcements + today's birthdays + new joiners
router.get('/feed', authenticate, announcementController.getFeed);

// POST   /api/v1/announcements        - Post an announcement (HR/Admin)
router.post('/', authenticate, authorize(...IS_HR_UP), announcementController.create);

// DELETE /api/v1/announcements/:id    - Remove an announcement (HR/Admin)
router.delete('/:id', authenticate, authorize(...IS_HR_UP), validateUUID('id'), announcementController.remove);

module.exports = router;
