const { Op } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const { WfhRequest, User } = require('../models');

const ACTIVE_STATUSES = ['PENDING', 'APPROVED'];

class WfhRepository extends BaseRepository {
  constructor() {
    super(WfhRequest);
  }

  // Any pending/approved request touching [startDate, endDate]
  findOverlapping(userId, startDate, endDate) {
    return this.model.findOne({
      where: {
        userId,
        status: { [Op.in]: ACTIVE_STATUSES },
        startDate: { [Op.lte]: endDate },
        endDate: { [Op.gte]: startDate }
      }
    });
  }

  findForUser(userId, organizationId, { status } = {}) {
    const where = { userId, organizationId };
    if (status) where.status = status;

    return this.model.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'approver',
        attributes: ['id', 'name', 'email'],
        required: false
      }]
    });
  }

  // managerId narrows to that manager's direct reports
  findPending(organizationId, managerId = null) {
    const userInclude = {
      model: User,
      as: 'user',
      attributes: ['id', 'name', 'email', 'employeeId', 'department'],
      required: true
    };

    if (managerId) {
      userInclude.where = { managerId };
    }

    return this.model.findAll({
      where: { organizationId, status: 'PENDING' },
      include: [userInclude],
      order: [['createdAt', 'ASC']]
    });
  }

  countPendingForUsers(userIds) {
    return this.model.count({ where: { userId: { [Op.in]: userIds }, status: 'PENDING' } });
  }

  findApprovedWithin(userId, organizationId, fromDate, toDate) {
    return this.model.findAll({
      where: {
        userId,
        organizationId,
        status: 'APPROVED',
        startDate: { [Op.gte]: fromDate },
        endDate: { [Op.lte]: toDate }
      }
    });
  }
}

module.exports = WfhRepository;
