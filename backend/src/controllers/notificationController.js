const NotificationService = require('../services/NotificationService');
const asyncHandler = require('../middleware/asyncHandler');
const { API_VERSION } = require('../config/constants');

const notificationController = {
  getMine: asyncHandler(async (req, res) => {
    const { category, unreadOnly, page, limit } = req.query;
    const result = await NotificationService.getForUser(req.user.id, {
      category,
      unreadOnly: unreadOnly === 'true',
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20
    });
    res.json({ success: true, data: result, version: API_VERSION });
  }),

  getUnreadCount: asyncHandler(async (req, res) => {
    const count = await NotificationService.getUnreadCount(req.user.id);
    res.json({ success: true, data: { count }, version: API_VERSION });
  }),

  markRead: asyncHandler(async (req, res) => {
    const notification = await NotificationService.markAsRead(req.params.id, req.user.id);
    res.json({ success: true, data: notification, version: API_VERSION });
  }),

  markAllRead: asyncHandler(async (req, res) => {
    const result = await NotificationService.markAllAsRead(req.user.id);
    res.json({ success: true, data: result, version: API_VERSION });
  })
};

module.exports = notificationController;
