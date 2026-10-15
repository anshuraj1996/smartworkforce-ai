const { Op } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const { Policy, PolicyAcknowledgement, User } = require('../models');

const AUTHOR = { model: User, as: 'author', attributes: ['id', 'name'], required: false };

class PolicyRepository extends BaseRepository {
  constructor() {
    super(Policy);
  }

  findForOrg(organizationId, { includeInactive = false, category } = {}) {
    const filter = { organizationId };
    if (!includeInactive) filter.isActive = true;
    if (category) filter.category = category;

    return this.model.findAll({
      where: filter,
      order: [['category', 'ASC'], ['title', 'ASC']],
      include: [AUTHOR]
    });
  }

  findInOrgWithAuthor(id, organizationId) {
    return this.model.findOne({ where: { id, organizationId }, include: [AUTHOR] });
  }

  findActiveInOrg(id, organizationId) {
    return this.model.findOne({ where: { id, organizationId, isActive: true } });
  }
}

class PolicyAcknowledgementRepository extends BaseRepository {
  constructor() {
    super(PolicyAcknowledgement);
  }

  findForUser(userId, policyIds) {
    return this.model.findAll({
      where: { userId, policyId: { [Op.in]: policyIds } },
      attributes: ['policyId', 'version', 'acknowledgedAt']
    });
  }

  findForVersion(policyId, version) {
    return this.model.findAll({
      where: { policyId, version },
      attributes: ['userId', 'acknowledgedAt']
    });
  }

  findForUserVersion(policyId, userId, version) {
    return this.model.findOne({ where: { policyId, userId, version } });
  }

  // Acknowledging twice is a no-op
  async acknowledge(organizationId, policyId, userId, version) {
    const [ack] = await this.model.findOrCreate({
      where: { policyId, userId, version },
      defaults: { organizationId, policyId, userId, version, acknowledgedAt: new Date() }
    });
    return ack;
  }
}

module.exports = { PolicyRepository, PolicyAcknowledgementRepository };
