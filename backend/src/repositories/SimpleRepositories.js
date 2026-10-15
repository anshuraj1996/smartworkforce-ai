const { Op } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const {
  Organization, Shift, LeavePolicy, Notification, Announcement, Certification, AiInsight, User, sequelize
} = require('../models');

// Repositories that are only a few queries each, kept together to avoid a file per 20 lines

class OrganizationRepository extends BaseRepository {
  constructor() {
    super(Organization);
  }

  findActive(id) {
    return this.model.findOne({ where: { id, isActive: true } });
  }

  findAllActive() {
    return this.model.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'timezone'] });
  }
}

class ShiftRepository extends BaseRepository {
  constructor() {
    super(Shift);
  }

  findDefault(organizationId) {
    return this.model.findOne({ where: { organizationId, isDefault: true, isActive: true } });
  }
}

class LeavePolicyRepository extends BaseRepository {
  constructor() {
    super(LeavePolicy);
  }

  findForOrg(organizationId) {
    return this.model.findAll({ where: { organizationId }, order: [['leaveType', 'ASC']] });
  }

  findActiveForOrg(organizationId) {
    return this.model.findAll({ where: { organizationId, isActive: true } });
  }

  findForType(organizationId, leaveType, { activeOnly = false } = {}) {
    const filter = { organizationId, leaveType };
    if (activeOnly) filter.isActive = true;
    return this.model.findOne({ where: filter });
  }
}

class NotificationRepository extends BaseRepository {
  constructor() {
    super(Notification);
  }

  // ON CONFLICT DO NOTHING: a redelivered event can't create a second notification for the
  // same user (unique index on user_id + metadata->>'eventId', migration 003)
  bulkCreate(rows) {
    return this.model.bulkCreate(rows, { ignoreDuplicates: true });
  }

  findForUser(userId, { category, unreadOnly, page, limit }) {
    const filter = { userId };
    if (category) filter.category = category;
    if (unreadOnly) filter.isRead = false;

    return this.model.findAndCountAll({
      where: filter,
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit
    });
  }

  findOwned(id, userId) {
    return this.model.findOne({ where: { id, userId } });
  }

  countUnread(userId) {
    return this.model.count({ where: { userId, isRead: false } });
  }

  async markAllRead(userId) {
    const [updatedCount] = await this.model.update(
      { isRead: true, readAt: new Date() },
      { where: { userId, isRead: false } }
    );
    return updatedCount;
  }
}

class AnnouncementRepository extends BaseRepository {
  constructor() {
    super(Announcement);
  }

  // Not expired, pinned first
  findActive(organizationId) {
    return this.model.findAll({
      where: {
        organizationId,
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }]
      },
      order: [['isPinned', 'DESC'], ['createdAt', 'DESC']],
      include: [{ model: User, as: 'author', attributes: ['id', 'name'] }]
    });
  }

  deleteInOrg(id, organizationId) {
    return this.model.destroy({ where: { id, organizationId } });
  }
}

class CertificationRepository extends BaseRepository {
  constructor() {
    super(Certification);
  }

  findOwned(id, userId) {
    return this.model.findOne({ where: { id, userId } });
  }

  deleteOwned(id, userId) {
    return this.model.destroy({ where: { id, userId } });
  }
}

class AiInsightRepository extends BaseRepository {
  constructor() {
    super(AiInsight);
  }

  // userIds: undefined = whole organization
  findHistory(organizationId, userIds, limit = 50) {
    const filter = { organizationId };
    if (userIds) filter.userId = { [Op.in]: userIds };

    return this.model.findAll({
      where: filter,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['generatedAt', 'DESC']],
      limit
    });
  }
}

// Database liveness/pool numbers for the admin system-health view
class HealthRepository {
  async ping() {
    const start = Date.now();
    try {
      await sequelize.query('SELECT 1');
      return { ok: true, ms: Date.now() - start };
    } catch {
      return { ok: false, ms: Date.now() - start };
    }
  }

  connectionCount() {
    const pool = sequelize.connectionManager.pool;
    return pool ? pool.using.length + pool.available.length : 1;
  }
}

module.exports = {
  HealthRepository,
  OrganizationRepository,
  ShiftRepository,
  LeavePolicyRepository,
  NotificationRepository,
  AnnouncementRepository,
  CertificationRepository,
  AiInsightRepository
};
