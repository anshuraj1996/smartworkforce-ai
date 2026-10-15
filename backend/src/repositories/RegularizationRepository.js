const BaseRepository = require('./BaseRepository');
const { RegularizationRequest, AttendanceLog, User } = require('../models');

class RegularizationRepository extends BaseRepository {
  constructor() {
    super(RegularizationRequest);
  }

  findPendingForDay(userId, date) {
    return this.model.findOne({ where: { userId, date, status: 'PENDING' } });
  }

  findOwned(id, userId, organizationId, options = {}) {
    return this.model.findOne({ where: { id, userId, organizationId }, ...options });
  }

  findForUser(userId, organizationId, { status } = {}) {
    const filter = { userId, organizationId };
    if (status) filter.status = status;

    return this.model.findAll({
      where: filter,
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
      include: [{ model: User, as: 'approver', attributes: ['id', 'name', 'email'], required: false }]
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
      include: [
        userInclude,
        {
          model: AttendanceLog,
          as: 'attendanceLog',
          attributes: ['id', 'checkInTime', 'checkOutTime', 'attendanceType'],
          required: false
        }
      ],
      order: [['createdAt', 'ASC']]
    });
  }
}

module.exports = RegularizationRepository;
