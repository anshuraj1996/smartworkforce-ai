const { Op } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const { AttendanceLog } = require('../models');

class AttendanceRepository extends BaseRepository {
  constructor() {
    super(AttendanceLog);
  }

  findForDay(userId, date) {
    return this.model.findOne({ where: { userId, date } });
  }

  // One row per user per date - creates it if missing
  async findOrCreateForDay(organizationId, userId, date, defaults = {}) {
    const [log] = await this.model.findOrCreate({
      where: { userId, date },
      defaults: { organizationId, userId, date, attendanceType: 'PRESENT', ...defaults }
    });
    return log;
  }

  // Create the day's row if missing, otherwise switch its type
  async setAttendanceType(organizationId, userId, date, attendanceType) {
    const [log, created] = await this.model.findOrCreate({
      where: { userId, date },
      defaults: { organizationId, userId, date, attendanceType }
    });

    if (!created && log.attendanceType !== attendanceType) {
      await log.update({ attendanceType });
    }

    return log;
  }

  findHistory(userId, organizationId, { startDate, endDate, page, limit }) {
    const filter = { userId, organizationId };
    if (startDate && endDate) {
      filter.date = { [Op.between]: [startDate, endDate] };
    }

    return this.model.findAndCountAll({
      where: filter,
      order: [['date', 'DESC']],
      limit,
      offset: (page - 1) * limit
    });
  }

  findForUserInRange(userId, fromDate, toDate, organizationId = null) {
    const filter = { userId, date: { [Op.between]: [fromDate, toDate] } };
    if (organizationId) filter.organizationId = organizationId;

    return this.model.findAll({ where: filter, order: [['date', 'ASC']] });
  }

  findForUserSince(userId, organizationId, sinceDate) {
    return this.model.findAll({
      where: { userId, organizationId, date: { [Op.gte]: sinceDate } },
      order: [['date', 'ASC']]
    });
  }

  // One query for many users on a single date (avoids an N+1 per team member)
  findForUsersOnDate(userIds, date) {
    return this.model.findAll({ where: { userId: { [Op.in]: userIds }, date } });
  }

  findForUsersSince(userIds, sinceDate, extraFilter = {}) {
    return this.model.findAll({
      where: { userId: { [Op.in]: userIds }, date: { [Op.gte]: sinceDate }, ...extraFilter },
      order: [['date', 'ASC']]
    });
  }

  // Check-in time of day (minutes since midnight) per user since `sinceDate`, for consistency
  // scoring. One query for the whole team. Users with no check-ins map to [].
  async checkInMinutesForUsers(userIds, sinceDate) {
    const byUser = new Map(userIds.map(id => [id, []]));
    if (userIds.length === 0) return byUser;

    const logs = await this.model.findAll({
      where: { userId: { [Op.in]: userIds }, checkInTime: { [Op.ne]: null }, date: { [Op.gte]: sinceDate } },
      attributes: ['userId', 'checkInTime']
    });

    logs.forEach(l => {
      const [h, m] = l.checkInTime.split(':').map(Number);
      byUser.get(l.userId).push(h * 60 + m);
    });
    return byUser;
  }
}

module.exports = AttendanceRepository;
