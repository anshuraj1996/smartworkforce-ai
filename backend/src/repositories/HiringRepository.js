const { Op, fn, col } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const { JobOpening, Referral, User } = require('../models');

class JobOpeningRepository extends BaseRepository {
  constructor() {
    super(JobOpening);
  }

  findForOrg(organizationId, { status, department } = {}) {
    const filter = { organizationId };
    if (status) filter.status = status;
    if (department) filter.department = department;

    return this.model.findAll({
      where: filter,
      order: [['status', 'ASC'], ['createdAt', 'DESC']]
    });
  }
}

class ReferralRepository extends BaseRepository {
  constructor() {
    super(Referral);
  }

  // Pipeline rules live on the model (Referral.TRANSITIONS)
  canMoveTo(fromStatus, toStatus) {
    return (this.model.TRANSITIONS[fromStatus] || []).includes(toStatus);
  }

  findForJobAndEmail(jobOpeningId, candidateEmail) {
    return this.model.findOne({ where: { jobOpeningId, candidateEmail } });
  }

  // [{ jobOpeningId, status, count }] for the given jobs
  countByJobAndStatus(jobOpeningIds) {
    return this.model.findAll({
      where: { jobOpeningId: { [Op.in]: jobOpeningIds } },
      attributes: ['jobOpeningId', 'status', [fn('COUNT', col('id')), 'count']],
      group: ['jobOpeningId', 'status'],
      raw: true
    });
  }

  countHired(jobOpeningId) {
    return this.model.count({ where: { jobOpeningId, status: 'HIRED' } });
  }

  findByReferrer(referredBy, organizationId) {
    return this.model.findAll({
      where: { referredBy, organizationId },
      order: [['createdAt', 'DESC']],
      include: [{
        model: JobOpening,
        as: 'jobOpening',
        attributes: ['id', 'title', 'department', 'status', 'referralBonus']
      }]
    });
  }

  findForOrg(organizationId, { jobOpeningId, status } = {}) {
    const filter = { organizationId };
    if (jobOpeningId) filter.jobOpeningId = jobOpeningId;
    if (status) filter.status = status;

    return this.model.findAll({
      where: filter,
      order: [['createdAt', 'DESC']],
      include: [
        { model: JobOpening, as: 'jobOpening', attributes: ['id', 'title', 'department', 'status'] },
        { model: User, as: 'referrer', attributes: ['id', 'name', 'email', 'department'] }
      ]
    });
  }

  findInOrgWithJob(id, organizationId) {
    return this.model.findOne({
      where: { id, organizationId },
      include: [{ model: JobOpening, as: 'jobOpening' }]
    });
  }

  findOwned(id, referredBy, organizationId) {
    return this.model.findOne({ where: { id, referredBy, organizationId } });
  }
}

module.exports = { JobOpeningRepository, ReferralRepository };
