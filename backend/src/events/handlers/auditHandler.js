const { AuditLog } = require('../../models');
const { EVENT_TYPES } = require('../EventBus');

class AuditHandler {
  static initialize(eventBus) {
    // Authentication audit events
    eventBus.onEvent(EVENT_TYPES.USER_LOGGED_IN, this.handleUserLogin);
    eventBus.onEvent(EVENT_TYPES.USER_LOGGED_OUT, this.handleUserLogout);
    
    // Attendance audit events
    eventBus.onEvent(EVENT_TYPES.ATTENDANCE_CHECKED_IN, this.handleAttendanceCheckIn);
    eventBus.onEvent(EVENT_TYPES.ATTENDANCE_CHECKED_OUT, this.handleAttendanceCheckOut);
    eventBus.onEvent(EVENT_TYPES.ATTENDANCE_AUTO_CHECKOUT, this.handleAutoCheckout);
    
    // Leave audit events
    eventBus.onEvent(EVENT_TYPES.LEAVE_REQUEST_SUBMITTED, this.handleLeaveSubmitted);
    eventBus.onEvent(EVENT_TYPES.LEAVE_REQUEST_APPROVED, this.handleLeaveApproved);
    eventBus.onEvent(EVENT_TYPES.LEAVE_REQUEST_REJECTED, this.handleLeaveRejected);
    
    // AI audit events
    eventBus.onEvent(EVENT_TYPES.AI_INSIGHT_GENERATED, this.handleAiInsightGenerated);
    
    // System audit events
    eventBus.onEvent(EVENT_TYPES.USER_CREATED, this.handleUserCreated);
    eventBus.onEvent(EVENT_TYPES.USER_UPDATED, this.handleUserUpdated);
    
    console.log('🔍 Audit event handlers initialized');
  }

  static async handleUserLogin(event) {
    const { userId, organizationId, metadata = {} } = event.data;
    
    await AuditLog.logLogin({
      organizationId,
      actorId: userId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      sessionId: metadata.sessionId,
      source: metadata.source || 'WEB'
    });
  }

  static async handleUserLogout(event) {
    const { userId, organizationId, metadata = {} } = event.data;
    
    await AuditLog.logLogout({
      organizationId,
      actorId: userId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      sessionId: metadata.sessionId,
      source: metadata.source || 'WEB'
    });
  }

  static async handleAttendanceCheckIn(event) {
    const { userId, organizationId, attendanceData, metadata = {} } = event.data;
    
    await AuditLog.logAttendance({
      organizationId,
      actorId: userId,
      action: 'check-in',
      entityId: attendanceData.id,
      newValues: {
        checkInTime: attendanceData.checkInTime,
        location: attendanceData.location
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      source: metadata.source || 'WEB'
    });
  }

  static async handleAttendanceCheckOut(event) {
    const { userId, organizationId, attendanceData, metadata = {} } = event.data;
    
    await AuditLog.logAttendance({
      organizationId,
      actorId: userId,
      action: 'check-out',
      entityId: attendanceData.id,
      newValues: {
        checkOutTime: attendanceData.checkOutTime,
        workingMinutes: attendanceData.workingMinutes,
        location: attendanceData.location
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      source: metadata.source || 'WEB'
    });
  }

  static async handleAutoCheckout(event) {
    const { userId, organizationId, attendanceData } = event.data;
    
    await AuditLog.logAction({
      organizationId,
      actorId: null, // System action
      action: 'SYSTEM_AUTO_CHECKOUT',
      entityType: 'ATTENDANCE_LOG',
      entityId: attendanceData.id,
      newValues: {
        checkOutTime: attendanceData.checkOutTime,
        isInferredCheckout: true
      },
      source: 'BACKGROUND_JOB',
      description: 'Automatic checkout performed by system'
    });
  }

  static async handleLeaveSubmitted(event) {
    const { userId, organizationId, leaveData, metadata = {} } = event.data;
    
    await AuditLog.logLeaveAction({
      organizationId,
      actorId: userId,
      leaveAction: 'apply',
      entityId: leaveData.id,
      newValues: {
        startDate: leaveData.startDate,
        endDate: leaveData.endDate,
        leaveType: leaveData.leaveType,
        dayCount: leaveData.dayCount
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      source: metadata.source || 'WEB'
    });
  }

  static async handleLeaveApproved(event) {
    const { userId, organizationId, leaveData, metadata = {} } = event.data;
    
    await AuditLog.logLeaveAction({
      organizationId,
      actorId: metadata.approvedBy,
      leaveAction: 'approve',
      entityId: leaveData.id,
      previousValues: { status: 'PENDING' },
      newValues: { 
        status: 'APPROVED',
        approvedBy: metadata.approvedBy,
        approvedAt: new Date()
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      source: metadata.source || 'WEB'
    });
  }

  static async handleLeaveRejected(event) {
    const { userId, organizationId, leaveData, metadata = {} } = event.data;
    
    await AuditLog.logLeaveAction({
      organizationId,
      actorId: metadata.rejectedBy,
      leaveAction: 'reject',
      entityId: leaveData.id,
      previousValues: { status: 'PENDING' },
      newValues: { 
        status: 'REJECTED',
        rejectionReason: metadata.rejectionReason
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      source: metadata.source || 'WEB'
    });
  }

  static async handleAiInsightGenerated(event) {
    const { userId, organizationId, insightData } = event.data;
    
    await AuditLog.logAction({
      organizationId,
      actorId: null, // System generated
      action: 'AI_INSIGHT_GENERATED',
      entityType: 'AI_INSIGHT',
      entityId: insightData.id,
      newValues: {
        insightType: insightData.insightType,
        score: insightData.score,
        severity: insightData.severity
      },
      source: 'BACKGROUND_JOB',
      description: `AI insight generated: ${insightData.title}`
    });
  }

  static async handleUserCreated(event) {
    const { userId, organizationId, userData, metadata = {} } = event.data;
    
    await AuditLog.logAction({
      organizationId,
      actorId: metadata.createdBy,
      action: 'CREATE',
      entityType: 'USER',
      entityId: userId,
      newValues: {
        name: userData.name,
        email: userData.email,
        role: userData.role,
        department: userData.department
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      source: metadata.source || 'WEB',
      description: `User created: ${userData.email}`
    });
  }

  static async handleUserUpdated(event) {
    const { userId, organizationId, previousData, newData, metadata = {} } = event.data;
    
    await AuditLog.logAction({
      organizationId,
      actorId: metadata.updatedBy,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: userId,
      previousValues: previousData,
      newValues: newData,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      source: metadata.source || 'WEB',
      description: 'User profile updated'
    });
  }
}

module.exports = AuditHandler;