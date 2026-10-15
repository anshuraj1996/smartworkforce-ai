const AnnouncementService = require('../services/AnnouncementService');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');
const { API_VERSION } = require('../config/constants');

const announcementController = {
  list: asyncHandler(async (req, res) => {
    const announcements = await AnnouncementService.list(req.user.organizationId);
    res.json({ success: true, data: announcements, version: API_VERSION });
  }),

  getFeed: asyncHandler(async (req, res) => {
    const feed = await AnnouncementService.getFeed(req.user.organizationId);
    res.json({ success: true, data: feed, version: API_VERSION });
  }),

  create: asyncHandler(async (req, res) => {
    const { title, body, category, isPinned, expiresAt } = req.body;
    if (!title || !body) {
      throw new ValidationError('Missing required fields: title, body');
    }

    const announcement = await AnnouncementService.create(req.user, { title, body, category, isPinned, expiresAt });
    res.status(201).json({ success: true, message: 'Announcement posted', data: announcement, version: API_VERSION });
  }),

  remove: asyncHandler(async (req, res) => {
    await AnnouncementService.remove(req.params.id, req.user.organizationId);
    res.json({ success: true, message: 'Announcement deleted', version: API_VERSION });
  })
};

module.exports = announcementController;
