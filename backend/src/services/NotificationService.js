const repositories = require('../repositories');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_TTL } = require('../utils/cacheKeys');
const { NotFoundError } = require('../utils/errors');

const unreadCountKey = CACHE_KEYS.unreadCount;

class NotificationService {
  constructor({ notificationRepository, cache }) {
    this.notificationRepository = notificationRepository;
    this.cache = cache;
  }

  // A notification failing to save must never take down the calling flow (leave approval, etc.)
  async notify(userId, organizationId, { category, title, message, link = null, metadata = {} }) {
    try {
      // Same duplicate-safe insert as notifyMany
      const [created] = await this.notificationRepository.bulkCreate([{
        organizationId, userId, category, title, message, link, metadata
      }]);
      await this.cache.cacheDel(unreadCountKey(userId));
      return created;
    } catch (error) {
      console.error('Create notification error:', error);
      return null;
    }
  }

  // Same notification to a batch of users (e.g. everyone in an org for an announcement)
  async notifyMany(userIds, organizationId, { category, title, message, link = null, metadata = {} }) {
    if (!userIds || userIds.length === 0) {
      return [];
    }

    try {
      const created = await this.notificationRepository.bulkCreate(userIds.map(userId => ({
        organizationId, userId, category, title, message, link, metadata
      })));
      // One DEL for every recipient's badge count
      await this.cache.cacheDel(userIds.map(unreadCountKey));
      return created;
    } catch (error) {
      console.error('Bulk notification error:', error);
      return [];
    }
  }

  async getForUser(userId, { category, unreadOnly, page = 1, limit = 20 } = {}) {
    const { count, rows } = await this.notificationRepository.findForUser(userId, { category, unreadOnly, page, limit });

    return {
      data: rows,
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit)
    };
  }

  // Polled for the bell-icon badge, so cached briefly and invalidated on create/read
  async getUnreadCount(userId) {
    const cached = await this.cache.cacheGet(unreadCountKey(userId));
    if (cached !== null) {
      return cached;
    }

    const count = await this.notificationRepository.countUnread(userId);
    await this.cache.cacheSet(unreadCountKey(userId), count, CACHE_TTL.unreadCount);
    return count;
  }

  async markAsRead(notificationId, userId) {
    const notification = await this.notificationRepository.findOwned(notificationId, userId);

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    const updated = await notification.markAsRead();
    await this.cache.cacheDel(unreadCountKey(userId));
    return updated;
  }

  async markAllAsRead(userId) {
    const updatedCount = await this.notificationRepository.markAllRead(userId);
    await this.cache.cacheDel(unreadCountKey(userId));
    return { updatedCount };
  }
}

module.exports = new NotificationService({
  notificationRepository: repositories.notificationRepository,
  cache
});
module.exports.NotificationService = NotificationService;
