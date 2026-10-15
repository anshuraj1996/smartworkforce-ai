const { Op } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const { LeaveRequest, User } = require('../models');

const ACTIVE_STATUSES = ['PENDING', 'APPROVED'];

class LeaveRepository extends BaseRepository {
  constructor() {
    super(LeaveRequest);
  }

  // Any pending/approved leave touching [startDate, endDate]
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

  findApprovedCovering(userId, date) {
    return this.model.findOne({
      where: {
        userId,
        status: 'APPROVED',
        startDate: { [Op.lte]: date },
        endDate: { [Op.gte]: date }
      }
    });
  }

  findApprovedOverlappingRange(userId, fromDate, toDate) {
    return this.model.findAll({
      where: {
        userId,
        status: 'APPROVED',
        startDate: { [Op.lte]: toDate },
        endDate: { [Op.gte]: fromDate }
      }
    });
  }

  findForUser(userId, organizationId, { status, startDate, endDate } = {}) {
    const filter = { userId, organizationId };
    if (status) filter.status = status;
    if (startDate && endDate) {
      filter.startDate = { [Op.gte]: startDate };
      filter.endDate = { [Op.lte]: endDate };
    }

    return this.model.findAll({
      where: filter,
      order: [['createdAt', 'DESC']],
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'employeeId'] },
        { model: User, as: 'approver', attributes: ['id', 'name', 'email'], required: false }
      ]
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

  // Leaves starting in `year` with one of `statuses`
  findForYear(userId, organizationId, year, statuses) {
    return this.model.findAll({
      where: {
        userId,
        organizationId,
        status: { [Op.in]: statuses },
        startDate: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] }
      },
      attributes: ['leaveType', 'dayCount', 'status']
    });
  }

  countPendingForUser(userId) {
    return this.model.count({ where: { userId, status: 'PENDING' } });
  }

  countPendingForUsers(userIds) {
    return this.model.count({ where: { userId: { [Op.in]: userIds }, status: 'PENDING' } });
  }

  countPendingForOrg(organizationId) {
    return this.model.count({ where: { organizationId, status: 'PENDING' } });
  }

  countOnLeave(userIds, date) {
    return this.model.count({
      where: {
        userId: { [Op.in]: userIds },
        status: 'APPROVED',
        startDate: { [Op.lte]: date },
        endDate: { [Op.gte]: date }
      }
    });
  }
}

module.exports = LeaveRepository;
