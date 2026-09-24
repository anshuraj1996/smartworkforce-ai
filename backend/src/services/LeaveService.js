const { LeaveRequest, User, AuditLog, Organization } = require('../models');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const NotificationService = require('./NotificationService');
const { publishEvent } = require('../events/kafka');
const { TOPICS } = require('../events/contracts');

class LeaveService {
  // Apply for leave
  static async applyLeave(userId, organizationId, leaveData) {
    try {
      const { startDate, endDate, leaveType, reason, isHalfDay = false } = leaveData;

      // Validate dates
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (start > end) {
        throw new Error('Start date cannot be after end date');
      }

      if (start < new Date().setHours(0, 0, 0, 0)) {
        throw new Error('Cannot apply for leave in the past');
      }

      // Check for overlapping leave requests
      const existingLeave = await LeaveRequest.findOne({
        where: {
          userId,
          status: { [Op.in]: ['PENDING', 'APPROVED'] },
          [Op.or]: [
            {
              startDate: { [Op.lte]: endDate },
              endDate: { [Op.gte]: startDate }
            }
          ]
        }
      });

      if (existingLeave) {
        throw new Error('Overlapping leave request exists');
      }

      // Calculate number of days
      const timeDiff = end.getTime() - start.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;
      const dayCount = isHalfDay ? 0.5 : daysDiff;

      // Create leave request
      const leaveRequest = await LeaveRequest.create({
        organizationId,
        userId,
        startDate: startDate,
        endDate: endDate,
        leaveType,
        reason,
        isHalfDay,
        dayCount,
        status: 'PENDING'
      });

      // Create audit log
      await AuditLog.create({
        organizationId,
        actorId: userId,
        action: 'LEAVE_APPLY',
        entityType: 'LEAVE_REQUEST',
        entityId: leaveRequest.id,
        description: `Leave application: ${leaveType} from ${startDate} to ${endDate}`,
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      await publishEvent(TOPICS.LEAVE, {
        eventType: 'APPLIED',
        organizationId,
        userId,
        leaveRequestId: leaveRequest.id,
        leaveType,
        startDate,
        endDate,
        dayCount,
        occurredAt: new Date().toISOString()
      });

      return leaveRequest;

    } catch (error) {
      console.error('Apply leave error:', error);
      throw new Error(error.message || 'Failed to apply for leave');
    }
  }

  // Get user leave requests
  static async getUserLeaves(userId, filters = {}, organizationId = null) {
    try {
      const whereClause = { userId };
      if (organizationId) {
        whereClause.organizationId = organizationId;
      }

      if (filters.status) {
        whereClause.status = filters.status;
      }
      
      if (filters.startDate && filters.endDate) {
        whereClause.startDate = { [Op.gte]: filters.startDate };
        whereClause.endDate = { [Op.lte]: filters.endDate };
      }

      const leaves = await LeaveRequest.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'employeeId']
        }, {
          model: User,
          as: 'approver',
          attributes: ['id', 'name', 'email'],
          required: false
        }]
      });

      return leaves;

    } catch (error) {
      console.error('Get user leaves error:', error);
      throw new Error('Failed to get leave requests');
    }
  }

  // Approve leave request
  static async approveLeave(leaveId, approvedBy, organizationId, comments = null) {
    try {
      const leaveRequest = await LeaveRequest.findOne({ where: { id: leaveId, organizationId } });

      if (!leaveRequest) {
        throw new Error('Leave request not found');
      }

      if (leaveRequest.status !== 'PENDING') {
        throw new Error('Leave request is not in pending status');
      }

      const updatedLeave = await leaveRequest.update({
        status: 'APPROVED',
        approvedBy,
        approvedAt: new Date(),
        metadata: { ...leaveRequest.metadata, approverComments: comments }
      });

      // Create audit log
      await AuditLog.create({
        organizationId: leaveRequest.organizationId,
        actorId: approvedBy,
        action: 'LEAVE_APPROVE',
        entityType: 'LEAVE_REQUEST',
        entityId: leaveId,
        description: `Leave request approved by ${approvedBy}`,
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      await NotificationService.notify(leaveRequest.userId, leaveRequest.organizationId, {
        category: 'LEAVE',
        title: 'Leave request approved',
        message: `Your ${leaveRequest.leaveType.toLowerCase()} leave from ${leaveRequest.startDate} to ${leaveRequest.endDate} was approved`,
        link: '/leave'
      });

      await publishEvent(TOPICS.LEAVE, {
        eventType: 'APPROVED',
        organizationId: leaveRequest.organizationId,
        userId: leaveRequest.userId,
        leaveRequestId: leaveRequest.id,
        leaveType: leaveRequest.leaveType,
        startDate: leaveRequest.startDate,
        endDate: leaveRequest.endDate,
        approvedBy,
        occurredAt: new Date().toISOString()
      });

      return updatedLeave;

    } catch (error) {
      console.error('Approve leave error:', error);
      throw new Error(error.message || 'Failed to approve leave');
    }
  }

  // Reject leave request
  static async rejectLeave(leaveId, rejectedBy, organizationId, comments) {
    try {
      const leaveRequest = await LeaveRequest.findOne({ where: { id: leaveId, organizationId } });

      if (!leaveRequest) {
        throw new Error('Leave request not found');
      }

      if (leaveRequest.status !== 'PENDING') {
        throw new Error('Leave request is not in pending status');
      }

      const updatedLeave = await leaveRequest.update({
        status: 'REJECTED',
        approvedBy: rejectedBy,
        approvedAt: new Date(),
        rejectionReason: comments
      });

      // Create audit log
      await AuditLog.create({
        organizationId: leaveRequest.organizationId,
        actorId: rejectedBy,
        action: 'LEAVE_REJECT',
        entityType: 'LEAVE_REQUEST',
        entityId: leaveId,
        description: `Leave request rejected by ${rejectedBy}`,
        timestamp: new Date().toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      await NotificationService.notify(leaveRequest.userId, leaveRequest.organizationId, {
        category: 'LEAVE',
        title: 'Leave request rejected',
        message: `Your ${leaveRequest.leaveType.toLowerCase()} leave from ${leaveRequest.startDate} to ${leaveRequest.endDate} was rejected`,
        link: '/leave'
      });

      await publishEvent(TOPICS.LEAVE, {
        eventType: 'REJECTED',
        organizationId: leaveRequest.organizationId,
        userId: leaveRequest.userId,
        leaveRequestId: leaveRequest.id,
        leaveType: leaveRequest.leaveType,
        startDate: leaveRequest.startDate,
        endDate: leaveRequest.endDate,
        rejectedBy,
        occurredAt: new Date().toISOString()
      });

      return updatedLeave;

    } catch (error) {
      console.error('Reject leave error:', error);
      throw new Error(error.message || 'Failed to reject leave');
    }
  }

  // Get pending leaves (for managers/HR)
  static async getPendingLeaves(organizationId, managerId = null) {
    try {
      const whereClause = { organizationId, status: 'PENDING' };

      // Build include options
      const includeOptions = [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'employeeId', 'department'],
        required: true
      }];

      // If managerId is provided, filter by users under that manager
      if (managerId) {
        includeOptions[0].where = { managerId };
      }

      const pendingLeaves = await LeaveRequest.findAll({
        where: whereClause,
        include: includeOptions,
        order: [['createdAt', 'ASC']]
      });

      return pendingLeaves;

    } catch (error) {
      console.error('Get pending leaves error:', error);
      throw new Error('Failed to get pending leaves');
    }
  }

  // Get leave statistics
  static async getLeaveStatistics(organizationId, period = '1y') {
    try {
      const now = new Date();
      let startDate;
      
      switch (period) {
        case '1m':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case '3m':
          startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
          break;
        case '6m':
          startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
          break;
        case '1y':
        default:
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
      }

      const leaves = await LeaveRequest.findAll({
        where: {
          organizationId,
          createdAt: { [Op.gte]: startDate }
        },
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'department']
        }]
      });

      const stats = {
        totalRequests: leaves.length,
        approved: leaves.filter(l => l.status === 'APPROVED').length,
        pending: leaves.filter(l => l.status === 'PENDING').length,
        rejected: leaves.filter(l => l.status === 'REJECTED').length,
        typeDistribution: {},
        departmentStats: {},
        monthlyPattern: []
      };

      // Calculate type distribution
      leaves.forEach(leave => {
        if (leave.status === 'APPROVED') {
          stats.typeDistribution[leave.leaveType] =
            (stats.typeDistribution[leave.leaveType] || 0) + Number(leave.dayCount);
        }

        // Department stats
        if (leave.user && leave.user.department) {
          const dept = leave.user.department;
          if (!stats.departmentStats[dept]) {
            stats.departmentStats[dept] = { total: 0, approved: 0, pending: 0, rejected: 0 };
          }
          stats.departmentStats[dept].total += 1;
          stats.departmentStats[dept][leave.status.toLowerCase()] += 1;
        }
      });

      // Calculate monthly pattern
      const monthlyData = {};
      leaves.forEach(leave => {
        const month = new Date(leave.createdAt).toISOString().slice(0, 7); // YYYY-MM
        if (!monthlyData[month]) {
          monthlyData[month] = { approved: 0, pending: 0, rejected: 0 };
        }
        monthlyData[month][leave.status.toLowerCase()] += 1;
      });

      stats.monthlyPattern = Object.entries(monthlyData).map(([month, data]) => ({
        month,
        ...data
      })).sort((a, b) => a.month.localeCompare(b.month));

      return stats;

    } catch (error) {
      console.error('Get leave statistics error:', error);
      throw new Error('Failed to get leave statistics');
    }
  }

  // Get leave balance (placeholder - would need leave policy implementation)
  static async getLeaveBalance(userId, organizationId) {
    try {
      // This is a simplified version. In a real system, you'd have:
      // - Leave policies per organization
      // - Yearly allocations per leave type
      // - Carry-over rules
      // - Leave accrual logic

      const currentYear = new Date().getFullYear();
      const startOfYear = new Date(currentYear, 0, 1);
      const endOfYear = new Date(currentYear, 11, 31);

      const approvedLeaves = await LeaveRequest.findAll({
        where: {
          userId,
          organizationId,
          status: 'APPROVED',
          startDate: { [Op.between]: [startOfYear, endOfYear] }
        }
      });

      // Calculate used days by type
      const usedDays = {};
      approvedLeaves.forEach(leave => {
        usedDays[leave.leaveType] = (usedDays[leave.leaveType] || 0) + Number(leave.dayCount);
      });

      // Standard allocations (would come from organization policies)
      const standardAllocations = {
        'ANNUAL': 21,
        'SICK': 10,
        'CASUAL': 7,
        'MATERNITY': 90,
        'PATERNITY': 7
      };

      const leaveBalance = Object.entries(standardAllocations).map(([type, allocated]) => ({
        leaveType: type,
        allocated,
        used: usedDays[type] || 0,
        remaining: allocated - (usedDays[type] || 0)
      }));

      return leaveBalance;

    } catch (error) {
      console.error('Get leave balance error:', error);
      throw new Error('Failed to get leave balance');
    }
  }
}

module.exports = LeaveService;