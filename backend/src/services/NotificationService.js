const { Notification, User } = require('../models');
const { cacheGet, cacheSet, cacheDel } = require('../utils/cache');

const UNREAD_COUNT_TTL_SECONDS = 30;
const unreadCountKey = (userId) => `notif:unread:${userId}`;

class NotificationService {
  // Create a single notification
  static async notify(userId, organizationId, { category, title, message, link = null, metadata = {} }) {
    try {
      const created = await Notification.create({
        organizationId,
        userId,
        category,
        title,
        message,
        link,
        metadata
      });
      await cacheDel(unreadCountKey(userId));
      return created;
    } catch (error) {
      console.error('Create notification error:', error);
      // A notification failing to save shouldn't take down the calling flow (leave approval, etc.)
      return null;
    }
  }

  // Send the same notification to a batch of users (e.g. everyone in an org for an announcement)
  static async notifyMany(userIds, organizationId, { category, title, message, link = null, metadata = {} }) {
    if (!userIds || userIds.length === 0) {
      return [];
    }

    try {
      const rows = userIds.map(userId => ({
        organizationId,
        userId,
        category,
        title,
        message,
        link,
        metadata
      }));

      const created = await Notification.bulkCreate(rows);
      await Promise.all(userIds.map(userId => cacheDel(unreadCountKey(userId))));
      return created;
    } catch (error) {
      console.error('Bulk notification error:', error);
      return [];
    }
  }

  static async getForUser(userId, filters = {}) {
    try {
      const { category, unreadOnly, page = 1, limit = 20 } = filters;
      const whereClause = { userId };

      if (category) {
        whereClause.category = category;
      }

      if (unreadOnly) {
        whereClause.isRead = false;
      }

      const { count, rows } = await Notification.findAndCountAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });

      return {
        data: rows,
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      };
    } catch (error) {
      console.error('Get notifications error:', error);
      throw new Error('Failed to get notifications');
    }
  }

  // Polled frequently for the bell-icon badge, so this one is worth caching -
  // short TTL plus explicit invalidation whenever a notification is created or read.
  static async getUnreadCount(userId) {
    try {
      const cached = await cacheGet(unreadCountKey(userId));
      if (cached !== null) {
        return cached;
      }

      const count = await Notification.count({ where: { userId, isRead: false } });
      await cacheSet(unreadCountKey(userId), count, UNREAD_COUNT_TTL_SECONDS);
      return count;
    } catch (error) {
      console.error('Get unread count error:', error);
      throw new Error('Failed to get unread notification count');
    }
  }

  static async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOne({ where: { id: notificationId, userId } });

      if (!notification) {
        throw new Error('Notification not found');
      }

      const updated = await notification.markAsRead();
      await cacheDel(unreadCountKey(userId));
      return updated;
    } catch (error) {
      console.error('Mark notification read error:', error);
      throw new Error(error.message || 'Failed to update notification');
    }
  }

  static async markAllAsRead(userId) {
    try {
      const [updatedCount] = await Notification.update(
        { isRead: true, readAt: new Date() },
        { where: { userId, isRead: false } }
      );

      await cacheDel(unreadCountKey(userId));
      return { updatedCount };
    } catch (error) {
      console.error('Mark all notifications read error:', error);
      throw new Error('Failed to update notifications');
    }
  }
}

module.exports = NotificationService;
