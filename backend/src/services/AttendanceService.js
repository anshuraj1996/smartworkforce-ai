const { AttendanceLog, User, Shift, AuditLog, Organization, LeaveRequest } = require('../models');
const { Op } = require('sequelize');
const { publishEvent } = require('../events/kafka');
const { TOPICS } = require('../events/contracts');

class AttendanceService {
  // Check in
  static async checkIn(userId, organizationId, metadata = {}) {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      // Check if already checked in today
      const existingAttendance = await AttendanceLog.findOne({
        where: {
          userId,
          date: today
        }
      });

      if (existingAttendance && existingAttendance.checkInTime) {
        throw new Error('Already checked in today');
      }

      const now = new Date();
      const timeString = now.toTimeString().split(' ')[0]; // HH:MM:SS

      // Get default shift
      const shift = await Shift.findOne({
        where: {
          organizationId,
          isDefault: true,
          isActive: true
        }
      });

      let attendanceType = 'PRESENT';
      let lateMinutes = 0;

      if (shift) {
        // Calculate if late
        const shiftStart = new Date(`1970-01-01T${shift.startTime}:00`);
        const checkInTime = new Date(`1970-01-01T${timeString}`);
        const graceTime = new Date(shiftStart.getTime() + (shift.graceMinutes * 60 * 1000));
        
        if (checkInTime > graceTime) {
          attendanceType = 'LATE';
          lateMinutes = Math.round((checkInTime - shiftStart) / (1000 * 60));
        }
      }

      let attendanceRecord;
      if (existingAttendance) {
        // Update existing record
        await existingAttendance.update({
          checkInTime: timeString,
          checkInTimestamp: now.toISOString(),
          attendanceType,
          lateMinutes,
          location: metadata.location || null,
          notes: metadata.notes || ''
        });
        attendanceRecord = existingAttendance;
      } else {
        // Create new record
        attendanceRecord = await AttendanceLog.create({
          organizationId,
          userId,
          date: today,
          checkInTime: timeString,
          checkInTimestamp: now.toISOString(),
          checkOutTime: null,
          checkOutTimestamp: null,
          attendanceType,
          isInferredCheckout: false,
          workingMinutes: null,
          lateMinutes,
          earlyLeaveMinutes: 0,
          location: metadata.location || null,
          notes: metadata.notes || ''
        });
      }

      // Log audit
      await AuditLog.create({
        organizationId,
        actorId: userId,
        action: 'CHECK_IN',
        entityType: 'ATTENDANCE_LOG',
        entityId: attendanceRecord.id,
        description: `User checked in at ${timeString}`,
        timestamp: now.toISOString(),
        source: 'WEB',
        severity: lateMinutes > 0 ? 'WARNING' : 'INFO'
      });

      await publishEvent(TOPICS.ATTENDANCE, {
        eventType: 'CHECKED_IN',
        organizationId,
        userId,
        attendanceLogId: attendanceRecord.id,
        date: today,
        attendanceType,
        lateMinutes,
        occurredAt: now.toISOString()
      });

      return attendanceRecord;

    } catch (error) {
      console.error('Check-in error:', error);
      throw new Error(error.message || 'Check-in failed');
    }
  }

  // Check out
  static async checkOut(userId, organizationId, metadata = {}) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Find today's attendance record
      const attendanceRecord = await AttendanceLog.findOne({
        where: {
          userId,
          date: today
        }
      });

      if (!attendanceRecord) {
        throw new Error('No check-in record found for today');
      }

      if (attendanceRecord.checkOutTime) {
        throw new Error('Already checked out today');
      }

      const now = new Date();
      const timeString = now.toTimeString().split(' ')[0];

      // Calculate working minutes
      const checkInTime = new Date(attendanceRecord.checkInTimestamp);
      const workingMinutes = Math.round((now - checkInTime) / (1000 * 60));

      // Calculate early leave minutes if applicable
      let earlyLeaveMinutes = 0;
      const shift = await Shift.findOne({
        where: {
          organizationId,
          isDefault: true,
          isActive: true
        }
      });

      if (shift) {
        const shiftEnd = new Date(`1970-01-01T${shift.endTime}:00`);
        const checkOutTime = new Date(`1970-01-01T${timeString}`);
        
        if (checkOutTime < shiftEnd) {
          earlyLeaveMinutes = Math.round((shiftEnd - checkOutTime) / (1000 * 60));
        }
      }

      // Update attendance record
      const updatedRecord = await attendanceRecord.update({
        checkOutTime: timeString,
        checkOutTimestamp: now.toISOString(),
        workingMinutes,
        earlyLeaveMinutes,
        notes: metadata.notes || attendanceRecord.notes
      });

      // Log audit
      await AuditLog.create({
        organizationId,
        actorId: userId,
        action: 'CHECK_OUT',
        entityType: 'ATTENDANCE_LOG',
        entityId: attendanceRecord.id,
        description: `User checked out at ${timeString}. Working time: ${workingMinutes} minutes`,
        timestamp: now.toISOString(),
        source: 'WEB',
        severity: 'INFO'
      });

      await publishEvent(TOPICS.ATTENDANCE, {
        eventType: 'CHECKED_OUT',
        organizationId,
        userId,
        attendanceLogId: attendanceRecord.id,
        date: today,
        workingMinutes,
        earlyLeaveMinutes,
        occurredAt: now.toISOString()
      });

      return updatedRecord;

    } catch (error) {
      console.error('Check-out error:', error);
      throw new Error(error.message || 'Check-out failed');
    }
  }

  // Get today's attendance
  static async getTodayAttendance(userId) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const attendanceRecord = await AttendanceLog.findOne({
        where: {
          userId,
          date: today
        }
      });

      return attendanceRecord || null;

    } catch (error) {
      console.error('Get today attendance error:', error);
      throw new Error('Failed to get today\'s attendance');
    }
  }

  // Get attendance history
  static async getAttendanceHistory(userId, startDate, endDate, page = 1, limit = 30, organizationId = null) {
    try {
      const whereClause = { userId };
      if (organizationId) {
        whereClause.organizationId = organizationId;
      }

      if (startDate && endDate) {
        whereClause.date = {
          [Op.between]: [startDate, endDate]
        };
      }

      const { count, rows } = await AttendanceLog.findAndCountAll({
        where: whereClause,
        order: [['date', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });

      return {
        data: rows,
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      };

    } catch (error) {
      console.error('Get attendance history error:', error);
      throw new Error('Failed to get attendance history');
    }
  }

  // Get team attendance (for managers)
  static async getTeamAttendance(organizationId, date = null, managerId = null) {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      
      // Get users in organization
      const whereClause = { organizationId, isActive: true };
      if (managerId) {
        whereClause.managerId = managerId;
      }

      const users = await User.findAll({
        where: whereClause,
        attributes: ['id', 'name', 'email', 'employeeId', 'department']
      });

      // One query for the whole team's attendance on this date instead of a per-user
      // round trip - the same N+1 pattern that used to live here doesn't scale past a
      // handful of team members, and this runs on every dashboard load/poll.
      const attendanceRecords = await AttendanceLog.findAll({
        where: {
          userId: { [Op.in]: users.map((u) => u.id) },
          date: targetDate
        }
      });
      const attendanceByUserId = new Map(attendanceRecords.map((a) => [a.userId, a]));

      return users.map((user) => ({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          employeeId: user.employeeId,
          department: user.department
        },
        attendance: attendanceByUserId.get(user.id) || null
      }));

    } catch (error) {
      console.error('Get team attendance error:', error);
      throw new Error('Failed to get team attendance');
    }
  }

  // Get attendance statistics
  static async getAttendanceStats(userId, month = null, year = null) {
    try {
      const currentDate = new Date();
      const targetMonth = month || currentDate.getMonth() + 1;
      const targetYear = year || currentDate.getFullYear();

      const startDate = new Date(targetYear, targetMonth - 1, 1);
      const endDate = new Date(targetYear, targetMonth, 0);

      const attendanceLogs = await AttendanceLog.findAll({
        where: {
          userId,
          date: {
            [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
          }
        }
      });

      const stats = {
        totalDays: attendanceLogs.length,
        presentDays: attendanceLogs.filter(log => log.attendanceType === 'PRESENT').length,
        lateDays: attendanceLogs.filter(log => log.attendanceType === 'LATE').length,
        halfDays: attendanceLogs.filter(log => log.attendanceType === 'HALF_DAY').length,
        totalLateMinutes: attendanceLogs.reduce((sum, log) => sum + (log.lateMinutes || 0), 0),
        totalWorkingMinutes: attendanceLogs.reduce((sum, log) => sum + (log.workingMinutes || 0), 0),
        averageWorkingHours: 0,
        attendancePercentage: 0
      };

      if (stats.totalDays > 0) {
        stats.averageWorkingHours = Math.round((stats.totalWorkingMinutes / stats.totalDays) / 60 * 100) / 100;
        stats.attendancePercentage = Math.round((stats.presentDays / stats.totalDays) * 100);
      }

      return stats;

    } catch (error) {
      console.error('Get attendance stats error:', error);
      throw new Error('Failed to get attendance statistics');
    }
  }

  // Bulk update attendance (for admin corrections)
  static async bulkUpdateAttendance(updates, updatedBy, organizationId) {
    try {
      const updatedRecords = [];

      for (const update of updates) {
        const { id, organizationId: _ignored, ...updateData } = update;
        const existingRecord = await AttendanceLog.findOne({ where: { id, organizationId } });

        if (existingRecord) {
          const previousValues = existingRecord.toJSON();
          const updatedRecord = await existingRecord.update(updateData);
          
          // Log audit
          await AuditLog.create({
            organizationId: existingRecord.organizationId,
            actorId: updatedBy,
            action: 'UPDATE',
            entityType: 'ATTENDANCE_LOG',
            entityId: id,
            description: 'Bulk attendance update by admin',
            timestamp: new Date().toISOString(),
            source: 'WEB',
            severity: 'INFO'
          });

          updatedRecords.push(updatedRecord);
        }
      }

      return {
        message: `Successfully updated ${updatedRecords.length} attendance records`,
        updatedRecords
      };

    } catch (error) {
      console.error('Bulk update attendance error:', error);
      throw new Error('Bulk attendance update failed');
    }
  }

  // Local calendar date as YYYY-MM-DD - toISOString() converts to UTC first, which shifts
  // the date backwards a day for any timezone ahead of UTC (e.g. Asia/Kolkata)
  static toLocalDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Day-by-day status for the monthly calendar view: present/late/absent/half day/wfh/leave/holiday/weekend
  static async getMonthlyCalendar(userId, organizationId, month, year) {
    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      const startStr = this.toLocalDateString(startDate);
      const endStr = this.toLocalDateString(endDate);

      const [attendanceLogs, approvedLeaves, organization] = await Promise.all([
        AttendanceLog.findAll({ where: { userId, date: { [Op.between]: [startStr, endStr] } } }),
        LeaveRequest.findAll({
          where: {
            userId,
            status: 'APPROVED',
            startDate: { [Op.lte]: endStr },
            endDate: { [Op.gte]: startStr }
          }
        }),
        Organization.findByPk(organizationId)
      ]);

      const attendanceByDate = {};
      attendanceLogs.forEach(log => { attendanceByDate[log.date] = log; });

      const holidays = (organization?.settings?.publicHolidays || []).map(h => (
        typeof h === 'string' ? h : h.date
      ));

      const today = this.toLocalDateString(new Date());
      const days = [];

      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = this.toLocalDateString(d);
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

    } catch (error) {
      console.error('Get monthly calendar error:', error);
      throw new Error('Failed to build monthly calendar');
    }
  }
}

module.exports = AttendanceService;