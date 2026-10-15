const repositories = require('../repositories');
const cache = require('../utils/cache');
const passThroughCache = require('../utils/passThroughCache');
const { CACHE_KEYS, CACHE_TTL, NAMESPACES } = require('../utils/cacheKeys');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { ConflictError, NotFoundError, ValidationError } = require('../utils/errors');
const { todayStr, monthRange, toLocalDateString, timeToSeconds, nowTimeString } = require('../utils/dates');

class AttendanceService {
  constructor({
    attendanceRepository,
    shiftRepository,
    leaveRepository,
    userRepository,
    organizationRepository,
    auditLogRepository,
    publish,
    cache = passThroughCache,
    withTransaction = (fn) => fn()
  }) {
    this.attendanceRepository = attendanceRepository;
    this.shiftRepository = shiftRepository;
    this.leaveRepository = leaveRepository;
    this.userRepository = userRepository;
    this.organizationRepository = organizationRepository;
    this.auditLogRepository = auditLogRepository;
    this.publish = publish;
    this.cache = cache;
    this.withTransaction = withTransaction;
  }

  // Read on every check-in and check-out; shifts change rarely (no API edits them yet), so a
  // 10-minute TTL is the whole invalidation story. Cached as a plain object.
  getDefaultShift(organizationId) {
    return this.cache.withCache(CACHE_KEYS.defaultShift(organizationId), CACHE_TTL.defaultShift, async () => {
      const shift = await this.shiftRepository.findDefault(organizationId);
      return shift && typeof shift.toJSON === 'function' ? shift.toJSON() : shift;
    });
  }

  async checkIn(userId, organizationId, metadata = {}) {
    const today = todayStr();
    const existing = await this.attendanceRepository.findForDay(userId, today);

    if (existing && existing.checkInTime) {
      throw new ConflictError('Already checked in today');
    }

    const now = new Date();
    const timeString = nowTimeString();

    let attendanceType = 'PRESENT';
    let lateMinutes = 0;

    const shift = await this.getDefaultShift(organizationId);
    if (shift) {
      const shiftStart = timeToSeconds(shift.startTime);
      const checkInTime = timeToSeconds(timeString);
      const graceTime = shiftStart + (shift.graceMinutes || 0) * 60;

      if (checkInTime > graceTime) {
        attendanceType = 'LATE';
        lateMinutes = Math.round((checkInTime - shiftStart) / 60);
      }
    }

    const checkInFields = {
      checkInTime: timeString,
      checkInTimestamp: now.toISOString(),
      attendanceType,
      lateMinutes,
      location: metadata.location || null,
      notes: metadata.notes || ''
    };

    // Attendance row, audit entry and outbox event commit together
    return this.withTransaction(async () => {
      // A row can already exist without a check-in (e.g. created by an approved WFH request)
      const record = existing
        ? await this.attendanceRepository.update(existing, checkInFields)
        : await this.attendanceRepository.create({
          organizationId,
          userId,
          date: today,
          checkOutTime: null,
          checkOutTimestamp: null,
          isInferredCheckout: false,
          workingMinutes: null,
          earlyLeaveMinutes: 0,
          ...checkInFields
        });

      await this.auditLogRepository.record({
        organizationId,
        actorId: userId,
        action: 'CHECK_IN',
        entityType: 'ATTENDANCE_LOG',
        entityId: record.id,
        description: `User checked in at ${timeString}`,
        severity: lateMinutes > 0 ? 'WARNING' : 'INFO'
      });

      await this.publish(EVENT_TYPES.ATTENDANCE_CHECKED_IN, organizationId, {
        userId,
        attendanceLogId: record.id,
        date: today,
        attendanceType,
        lateMinutes
      });

      return record;
    });
  }

  async checkOut(userId, organizationId, metadata = {}) {
    const today = todayStr();
    const record = await this.attendanceRepository.findForDay(userId, today);

    if (!record || !record.checkInTime) {
      throw new ValidationError('No check-in record found for today');
    }

    if (record.checkOutTime) {
      throw new ConflictError('Already checked out today');
    }

    const now = new Date();
    const timeString = nowTimeString();
    const workingMinutes = Math.round((now - new Date(record.checkInTimestamp)) / (1000 * 60));

    let earlyLeaveMinutes = 0;
    const shift = await this.getDefaultShift(organizationId);
    if (shift) {
      const shiftEnd = timeToSeconds(shift.endTime);
      const checkOutTime = timeToSeconds(timeString);

      if (checkOutTime < shiftEnd) {
        earlyLeaveMinutes = Math.round((shiftEnd - checkOutTime) / 60);
      }
    }

    // Attendance row, audit entry and outbox event commit together
    return this.withTransaction(async () => {
      const updated = await this.attendanceRepository.update(record, {
        checkOutTime: timeString,
        checkOutTimestamp: now.toISOString(),
        workingMinutes,
        earlyLeaveMinutes,
        notes: metadata.notes || record.notes
      });

      await this.auditLogRepository.record({
        organizationId,
        actorId: userId,
        action: 'CHECK_OUT',
        entityType: 'ATTENDANCE_LOG',
        entityId: record.id,
        description: `User checked out at ${timeString}. Working time: ${workingMinutes} minutes`
      });

      await this.publish(EVENT_TYPES.ATTENDANCE_CHECKED_OUT, organizationId, {
        userId,
        attendanceLogId: record.id,
        date: today,
        workingMinutes,
        earlyLeaveMinutes
      });

      return updated;
    });
  }

  async getTodayAttendance(userId) {
    return (await this.attendanceRepository.findForDay(userId, todayStr())) || null;
  }

  async getAttendanceHistory(userId, organizationId, { startDate, endDate, page = 1, limit = 30 } = {}) {
    const { count, rows } = await this.attendanceRepository.findHistory(userId, organizationId, { startDate, endDate, page, limit });

    return {
      data: rows,
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit)
    };
  }

  // Each member's attendance for one date (managers: direct reports only). Polled by every
  // manager/HR dashboard; lives in the org's "workforce" cache namespace, which the
  // cache-invalidation worker clears on attendance/leave/WFH events.
  getTeamAttendance(organizationId, date = null, managerId = null) {
    const targetDate = date || todayStr();
    return this.cache.withVersionedCache(
      NAMESPACES.workforce(organizationId),
      CACHE_KEYS.teamAttendance(organizationId, managerId, targetDate),
      CACHE_TTL.teamAttendance,
      () => this.computeTeamAttendance(organizationId, targetDate, managerId)
    );
  }

  async computeTeamAttendance(organizationId, targetDate, managerId) {
    const users = await this.userRepository.findActiveMembers(organizationId, {
      managerId,
      attributes: ['id', 'name', 'email', 'employeeId', 'department']
    });

    const records = await this.attendanceRepository.findForUsersOnDate(users.map(u => u.id), targetDate);
    const byUserId = new Map(records.map(a => [a.userId, a]));

    return users.map(user => ({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        employeeId: user.employeeId,
        department: user.department
      },
      attendance: byUserId.get(user.id) || null
    }));
  }

  async getAttendanceStats(userId, month = null, year = null) {
    const now = new Date();
    const { start, end } = monthRange(year || now.getFullYear(), month || now.getMonth() + 1);
    const logs = await this.attendanceRepository.findForUserInRange(userId, start, end);

    const stats = {
      totalDays: logs.length,
      presentDays: logs.filter(log => log.attendanceType === 'PRESENT').length,
      lateDays: logs.filter(log => log.attendanceType === 'LATE').length,
      halfDays: logs.filter(log => log.attendanceType === 'HALF_DAY').length,
      totalLateMinutes: logs.reduce((sum, log) => sum + (log.lateMinutes || 0), 0),
      totalWorkingMinutes: logs.reduce((sum, log) => sum + (log.workingMinutes || 0), 0),
      averageWorkingHours: 0,
      attendancePercentage: 0
    };

    if (stats.totalDays > 0) {
      stats.averageWorkingHours = Math.round((stats.totalWorkingMinutes / stats.totalDays) / 60 * 100) / 100;
      stats.attendancePercentage = Math.round((stats.presentDays / stats.totalDays) * 100);
    }

    return stats;
  }

  // Admin corrections. Records outside the admin's organization are skipped, never touched.
  async bulkUpdateAttendance(updates, updatedBy, organizationId) {
    if (!Array.isArray(updates)) {
      throw new ValidationError('Updates array is required');
    }

    const updatedRecords = [];

    for (const update of updates) {
      // organizationId/userId in the payload are ignored - a record can't be moved between orgs/users
      const { id, organizationId: _org, userId: _user, ...changes } = update;
      const record = await this.attendanceRepository.findByIdInOrg(id, organizationId);

      if (record) {
        const previousValues = record.toJSON();
        updatedRecords.push(await this.attendanceRepository.update(record, changes));

        await this.auditLogRepository.record({
          organizationId,
          actorId: updatedBy,
          action: 'UPDATE',
          entityType: 'ATTENDANCE_LOG',
          entityId: id,
          previousValues,
          newValues: changes,
          description: 'Bulk attendance update by admin'
        });
      }
    }

    return {
      message: `Successfully updated ${updatedRecords.length} attendance records`,
      updatedRecords
    };
  }

  // Day-by-day status for the monthly calendar view: present/late/absent/half day/wfh/leave/holiday/weekend
  async getMonthlyCalendar(userId, organizationId, month, year) {
    const { start, end } = monthRange(year, month);

    const [logs, approvedLeaves, organization] = await Promise.all([
      this.attendanceRepository.findForUserInRange(userId, start, end),
      this.leaveRepository.findApprovedOverlappingRange(userId, start, end),
      this.organizationRepository.findById(organizationId)
    ]);

    const attendanceByDate = {};
    logs.forEach(log => { attendanceByDate[log.date] = log; });

    const holidays = (organization?.settings?.publicHolidays || []).map(h => (typeof h === 'string' ? h : h.date));
    const today = todayStr();
    const days = [];

    for (let d = new Date(year, month - 1, 1); d <= new Date(year, month, 0); d.setDate(d.getDate() + 1)) {
      const dateStr = toLocalDateString(d);
      const dayOfWeek = d.getDay();
      let status = 'UPCOMING';
      let detail = null;

      const attendance = attendanceByDate[dateStr];
      const leave = approvedLeaves.find(l => dateStr >= l.startDate && dateStr <= l.endDate);

      if (attendance) {
        status = attendance.attendanceType;
        detail = attendance;
      } else if (leave) {
        status = 'LEAVE';
        detail = leave;
      } else if (holidays.includes(dateStr)) {
        status = 'HOLIDAY';
      } else if (dayOfWeek === 0 || dayOfWeek === 6) {
        status = 'WEEKEND';
      } else if (dateStr < today) {
        status = 'ABSENT';
      }

      days.push({ date: dateStr, dayOfWeek, status, detail });
    }

    return { month, year, days };
  }
}

module.exports = new AttendanceService({
  ...repositories,
  publish: outboxPublish,
  cache,
  withTransaction: dbTransaction
});
module.exports.AttendanceService = AttendanceService;
