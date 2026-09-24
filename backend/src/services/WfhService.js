const { WfhRequest, LeaveRequest, AttendanceLog, User, AuditLog } = require('../models');
const { Op } = require('sequelize');
const NotificationService = require('./NotificationService');
const { publishEvent } = require('../events/kafka');
const { TOPICS } = require('../events/contracts');

// Default monthly cap on WFH days per employee. Not org-configurable yet, just a flat rule for now.
const MONTHLY_WFH_QUOTA = 8;

class WfhService {
  static async applyWfh(userId, organizationId, wfhData) {
    try {
      const { startDate, endDate, reason, isHalfDay = false, halfDayType = null } = wfhData;

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start > end) {
        throw new Error('Start date cannot be after end date');
      }

      if (start < new Date().setHours(0, 0, 0, 0)) {
        throw new Error('Cannot request WFH for a past date');
      }

      const overlappingWfh = await WfhRequest.findOne({
        where: {
          userId,
          status: { [Op.in]: ['PENDING', 'APPROVED'] },
          startDate: { [Op.lte]: endDate },
          endDate: { [Op.gte]: startDate }
        }
      });

      if (overlappingWfh) {
        throw new Error('A WFH request already exists for one of these dates');
      }

      const overlappingLeave = await LeaveRequest.findOne({
        where: {
          userId,
          status: { [Op.in]: ['PENDING', 'APPROVED'] },
          startDate: { [Op.lte]: endDate },
          endDate: { [Op.gte]: startDate }
        }
      });

      if (overlappingLeave) {
        throw new Error('Cannot request WFH on dates that overlap an existing leave request');
      }

      const requestedDays = isHalfDay
        ? 0.5
        : Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

      const quota = await this.getMonthlyQuotaUsage(userId, organizationId, start.getMonth() + 1, start.getFullYear());

      if (quota.used + requestedDays > MONTHLY_WFH_QUOTA) {
        throw new Error(`This request would exceed the monthly WFH quota (${quota.used}/${MONTHLY_WFH_QUOTA} days already used)`);
      }

      const wfhRequest = await WfhRequest.create({
        organizationId,
        userId,
        startDate,
        endDate,
        isHalfDay,
        halfDayType,
        reason,
        status: 'PENDING'
      });

      await AuditLog.create({
        organizationId,
        actorId: userId,
        action: 'CREATE',
        entityType: 'WFH_REQUEST',
        entityId: wfhRequest.id,
        description: `WFH requested from ${startDate} to ${endDate}`,
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      const requester = await User.findByPk(userId);
      if (requester && requester.managerId) {
        await NotificationService.notify(requester.managerId, organizationId, {
          category: 'WFH',
          title: 'New WFH request',
          message: `${requester.name} requested WFH from ${startDate} to ${endDate}`,
          link: '/leave/wfh/pending'
        });
      }

      await publishEvent(TOPICS.WFH, {
        eventType: 'APPLIED',
        organizationId,
        userId,
        wfhRequestId: wfhRequest.id,
        startDate,
        endDate,
        occurredAt: new Date().toISOString()
      });

      return wfhRequest;
    } catch (error) {
      console.error('Apply WFH error:', error);
      throw new Error(error.message || 'Failed to submit WFH request');
    }
  }

  static async getUserWfhRequests(userId, filters = {}, organizationId = null) {
    try {
      const whereClause = { userId };
      if (organizationId) {
        whereClause.organizationId = organizationId;
      }

      if (filters.status) {
        whereClause.status = filters.status;
      }

      return await WfhRequest.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
        include: [{
          model: User,
          as: 'approver',
          attributes: ['id', 'name', 'email'],
          required: false
        }]
      });
    } catch (error) {
      console.error('Get user WFH requests error:', error);
      throw new Error('Failed to get WFH requests');
    }
  }

  static async getPendingWfhRequests(organizationId, managerId = null) {
    try {
      const includeOptions = [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'employeeId', 'department'],
        required: true
      }];

      if (managerId) {
        includeOptions[0].where = { managerId };
      }

      return await WfhRequest.findAll({
        where: { organizationId, status: 'PENDING' },
        include: includeOptions,
        order: [['createdAt', 'ASC']]
      });
    } catch (error) {
      console.error('Get pending WFH requests error:', error);
      throw new Error('Failed to get pending WFH requests');
    }
  }

  static async approveWfh(wfhId, approvedBy, organizationId) {
    try {
      const wfhRequest = await WfhRequest.findOne({ where: { id: wfhId, organizationId } });

      if (!wfhRequest) {
        throw new Error('WFH request not found');
      }

      if (!wfhRequest.canBeApproved()) {
        throw new Error('WFH request is not pending');
      }

      const updated = await wfhRequest.update({
        status: 'APPROVED',
        approvedBy,
        approvedAt: new Date()
      });

      // Mark the covered dates as WFH on the attendance log so the calendar view reflects it
      await this.syncAttendanceForApprovedWfh(updated);

      await AuditLog.create({
        organizationId: wfhRequest.organizationId,
        actorId: approvedBy,
        action: 'UPDATE',
        entityType: 'WFH_REQUEST',
        entityId: wfhId,
        description: `WFH request approved by ${approvedBy}`,
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      await NotificationService.notify(wfhRequest.userId, wfhRequest.organizationId, {
        category: 'WFH',
        title: 'WFH request approved',
        message: `Your WFH request from ${wfhRequest.startDate} to ${wfhRequest.endDate} was approved`,
        link: '/leave/wfh'
      });

      await publishEvent(TOPICS.WFH, {
        eventType: 'APPROVED',
        organizationId: wfhRequest.organizationId,
        userId: wfhRequest.userId,
        wfhRequestId: wfhRequest.id,
        startDate: wfhRequest.startDate,
        endDate: wfhRequest.endDate,
        approvedBy,
        occurredAt: new Date().toISOString()
      });

      return updated;
    } catch (error) {
      console.error('Approve WFH error:', error);
      throw new Error(error.message || 'Failed to approve WFH request');
    }
  }

  static async rejectWfh(wfhId, rejectedBy, organizationId, rejectionReason) {
    try {
      const wfhRequest = await WfhRequest.findOne({ where: { id: wfhId, organizationId } });

      if (!wfhRequest) {
        throw new Error('WFH request not found');
      }

      if (!wfhRequest.canBeApproved()) {
        throw new Error('WFH request is not pending');
      }

      const updated = await wfhRequest.update({
        status: 'REJECTED',
        approvedBy: rejectedBy,
        approvedAt: new Date(),
        rejectionReason
      });

      await AuditLog.create({
        organizationId: wfhRequest.organizationId,
        actorId: rejectedBy,
        action: 'UPDATE',
        entityType: 'WFH_REQUEST',
        entityId: wfhId,
        description: `WFH request rejected by ${rejectedBy}`,
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      await NotificationService.notify(wfhRequest.userId, wfhRequest.organizationId, {
        category: 'WFH',
        title: 'WFH request rejected',
        message: `Your WFH request from ${wfhRequest.startDate} to ${wfhRequest.endDate} was rejected`,
        link: '/leave/wfh'
      });

      await publishEvent(TOPICS.WFH, {
        eventType: 'REJECTED',
        organizationId: wfhRequest.organizationId,
        userId: wfhRequest.userId,
        wfhRequestId: wfhRequest.id,
        startDate: wfhRequest.startDate,
        endDate: wfhRequest.endDate,
        rejectedBy,
        occurredAt: new Date().toISOString()
      });

      return updated;
    } catch (error) {
      console.error('Reject WFH error:', error);
      throw new Error(error.message || 'Failed to reject WFH request');
    }
  }

  // Once approved, write/patch attendance rows for each covered day so attendance + calendar reflect WFH
  static async syncAttendanceForApprovedWfh(wfhRequest) {
    const start = new Date(wfhRequest.startDate);
    const end = new Date(wfhRequest.endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = this.toLocalDateString(d);

      const [log] = await AttendanceLog.findOrCreate({
        where: { userId: wfhRequest.userId, date: dateStr },
        defaults: {
          organizationId: wfhRequest.organizationId,
          userId: wfhRequest.userId,
          date: dateStr,
          attendanceType: 'WORK_FROM_HOME'
        }
      });

      if (log.attendanceType !== 'WORK_FROM_HOME') {
        await log.update({ attendanceType: 'WORK_FROM_HOME' });
      }
    }
  }

  // Local calendar date as YYYY-MM-DD - toISOString() would convert to UTC first, which
  // shifts the date backwards a day for any timezone ahead of UTC (e.g. Asia/Kolkata)
  static toLocalDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  static async getMonthlyQuotaUsage(userId, organizationId, month, year) {
    try {
      const startOfMonth = this.toLocalDateString(new Date(year, month - 1, 1));
      const endOfMonth = this.toLocalDateString(new Date(year, month, 0));

      const approvedRequests = await WfhRequest.findAll({
        where: {
          userId,
          organizationId,
          status: 'APPROVED',
          startDate: { [Op.gte]: startOfMonth },
          endDate: { [Op.lte]: endOfMonth }
        }
      });

      const used = approvedRequests.reduce((total, req) => total + req.getDayCount(), 0);

      return { used, quota: MONTHLY_WFH_QUOTA, remaining: Math.max(0, MONTHLY_WFH_QUOTA - used) };
    } catch (error) {
      console.error('Get WFH quota error:', error);
      throw new Error('Failed to get WFH quota usage');
    }
  }
}

module.exports = WfhService;
