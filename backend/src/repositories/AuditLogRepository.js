const BaseRepository = require('./BaseRepository');
const { AuditLog, User } = require('../models');

class AuditLogRepository extends BaseRepository {
  constructor() {
    super(AuditLog);
  }

  // Fills the fields every audit entry from the web API shares
  record({ organizationId, actorId, action, entityType, entityId, description, severity = 'INFO', source = 'WEB', ...rest }) {
    return this.model.create({
      organizationId,
      actorId,
      action,
      entityType,
      entityId,
      description,
      severity,
      source,
      timestamp: new Date().toISOString(),
      ...rest
    });
  }

  // Newest first, with the actor's name; actorId narrows to one user's own actions
  findRecent(organizationId, { actorId, limit = 20 } = {}) {
    const filter = { organizationId };
    if (actorId) filter.actorId = actorId;

    return this.model.findAll({
      where: filter,
      order: [['timestamp', 'DESC']],
      limit,
      include: [{ model: User, as: 'actor', attributes: ['id', 'name'], required: false }]
    });
  }

  findLogins(actorId, limit = 20) {
    return this.model.findAll({
      where: { actorId, action: 'LOGIN' },
      order: [['timestamp', 'DESC']],
      limit
    });
  }
}

module.exports = AuditLogRepository;
