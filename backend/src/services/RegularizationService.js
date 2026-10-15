const repositories = require('../repositories');
const NotificationService = require('./NotificationService');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { ValidationError, ConflictError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { todayStr, daysAgoStr, timeToMinutes } = require('../utils/dates');

// How far back an employee may ask to correct attendance - default only; each organization
// sets its own (organizationSettings.regularizationWindowDays)
const { DEFAULT_ORG_SETTINGS, defaultSettingsProvider } = require('../config/organizationSettings');
const REGULARIZATION_WINDOW_DAYS = DEFAULT_ORG_SETTINGS.regularizationWindowDays;

const normalizeTime = (time) => (time && time.length === 5 ? `${time}:00` : time);

// Which times each request type has to carry
const hasRequiredTimes = (requestType, checkIn, checkOut) => ({
  MISSED_CHECK_IN: !!checkIn,
  MISSED_CHECK_OUT: !!checkOut,
  MARK_PRESENT: !!(checkIn && checkOut),
  WRONG_TIME: !!(checkIn || checkOut)
}[requestType]);

// An employee's request to correct a past attendance day. Once approved, the AttendanceLog is
// rewritten from the requested times and the old values are kept on the request.
class RegularizationService {
  constructor({
    regularizationRepository,
    attendanceRepository,
    leaveRepository,
    shiftRepository,
    userRepository,
    auditLogRepository,
    notifier,
    publish,
    withTransaction = (fn) => fn(),
    organizationSettings = defaultSettingsProvider
  }) {
    this.regularizationRepository = regularizationRepository;
    this.attendanceRepository = attendanceRepository;
    this.leaveRepository = leaveRepository;
    this.shiftRepository = shiftRepository;
    this.userRepository = userRepository;
    this.auditLogRepository = auditLogRepository;
    this.notifier = notifier;
    this.publish = publish;
    this.withTransaction = withTransaction;
    this.organizationSettings = organizationSettings;
  }

  async applyRegularization(user, data) {
    const { date, requestType, reason } = data;
    const requestedCheckIn = normalizeTime(data.requestedCheckIn) || null;
    const requestedCheckOut = normalizeTime(data.requestedCheckOut) || null;

    if (!hasRequiredTimes(requestType, requestedCheckIn, requestedCheckOut)) {
      throw new ValidationError(requestType === 'WRONG_TIME'
        ? 'Provide the corrected check-in and/or check-out time'
        : 'The time(s) for this request type are required');
    }

    if (date > todayStr()) {
      throw new ValidationError('Cannot regularize a future date');
    }

    const { regularizationWindowDays } = await this.organizationSettings.get(user.organizationId);
    if (date < daysAgoStr(regularizationWindowDays)) {
      throw new ValidationError(`Attendance can only be regularized for the last ${regularizationWindowDays} days`);
    }

    if (await this.regularizationRepository.findPendingForDay(user.id, date)) {
      throw new ConflictError('A regularization request is already pending for this date');
    }

    if (await this.leaveRepository.findApprovedCovering(user.id, date)) {
      throw new ConflictError('This date is covered by an approved leave - cancel the leave instead');
    }

    const log = await this.attendanceRepository.findForDay(user.id, date);

    if (requestType === 'WRONG_TIME' && !log) {
      throw new ValidationError('No attendance record exists for this date - use "Mark present" instead');
    }

    if (requestType === 'MISSED_CHECK_OUT' && !(log && log.checkInTime) && !requestedCheckIn) {
      throw new ValidationError('No check-in found for this date - provide a check-in time as well');
    }

    // The times the attendance record would end up with after approval must make sense together
    const finalCheckIn = requestedCheckIn || (log && log.checkInTime);
    const finalCheckOut = requestedCheckOut || (log && log.checkOutTime);

    if (!finalCheckIn) {
      throw new ValidationError('A check-in time is required');
    }

    if (finalCheckOut && timeToMinutes(finalCheckOut) <= timeToMinutes(finalCheckIn)) {
      throw new ValidationError('Check-out time must be after check-in time');
    }

    // Request, audit entry and outbox event commit together. The partial UNIQUE index on
    // (user_id, date) WHERE PENDING turns a concurrent duplicate into a 409, not a second row.
    const request = await this.withTransaction(async () => {
      const created = await this.regularizationRepository.create({
        organizationId: user.organizationId,
        userId: user.id,
        attendanceLogId: log ? log.id : null,
        date,
        requestType,
        requestedCheckIn,
        requestedCheckOut,
        reason,
        status: 'PENDING'
      });

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'CREATE',
        entityType: 'REGULARIZATION_REQUEST',
        entityId: created.id,
        description: `Attendance regularization requested for ${date} (${requestType})`
      });

      await this.publish(EVENT_TYPES.REGULARIZATION_REQUESTED, user.organizationId, {
        userId: user.id,
        regularizationRequestId: created.id,
        date,
        requestType
      });

      return created;
    });

    // After commit, so a failed notification can't roll the request back
    if (user.managerId) {
      await this.notifier.notify(user.managerId, user.organizationId, {
        category: 'ATTENDANCE',
        title: 'New regularization request',
        message: `${user.name} asked to regularize attendance for ${date}`,
        link: '/regularization'
      });
    }

    return request;
  }

  getUserRequests(user, filters = {}) {
    return this.regularizationRepository.findForUser(user.id, user.organizationId, filters);
  }

  // Managers only see their direct reports; HR/Admin see the whole organization
  getPendingRequests(approver) {
    const managerId = approver.role === 'MANAGER' ? approver.id : null;
    return this.regularizationRepository.findPending(approver.organizationId, managerId);
  }

  // Request exists in the approver's org, is pending, and this approver may decide on it.
  // Runs inside the decision's transaction with the row locked (SELECT ... FOR UPDATE), so two
  // approvers clicking at once can't both decide: the second waits, then sees it's decided.
  async loadForDecision(requestId, approver) {
    const request = await this.regularizationRepository.findByIdInOrg(requestId, approver.organizationId, { lock: true });

    if (!request) {
      throw new NotFoundError('Regularization request not found');
    }

    if (request.status !== 'PENDING') {
      throw new ConflictError('Regularization request is not pending');
    }

    if (request.userId === approver.id) {
      throw new ForbiddenError('You cannot approve or reject your own regularization request');
    }

    if (approver.role === 'MANAGER') {
      const requester = await this.userRepository.findById(request.userId);
      if (!requester || requester.managerId !== approver.id) {
        throw new ForbiddenError('Managers can only act on requests from their direct reports');
      }
    }

    return request;
  }

  async approveRegularization(requestId, approver) {
    const { organizationId } = approver;

    // The corrected attendance row, the request's status, both audit entries and the event
    // commit together - a regularization can't be half-applied
    const { updated, request } = await this.withTransaction(async () => {
      const request = await this.loadForDecision(requestId, approver);

      const log = await this.attendanceRepository.findOrCreateForDay(organizationId, request.userId, request.date);

      const previousValues = {
        checkInTime: log.checkInTime,
        checkOutTime: log.checkOutTime,
        attendanceType: log.attendanceType,
        workingMinutes: log.workingMinutes,
        lateMinutes: log.lateMinutes,
        earlyLeaveMinutes: log.earlyLeaveMinutes
      };

      const newValues = await this.computeAttendance(
        organizationId,
        request.date,
        request.requestedCheckIn || log.checkInTime,
        request.requestedCheckOut || log.checkOutTime,
        log.attendanceType
      );

      await this.attendanceRepository.update(log, {
        ...newValues,
        isInferredCheckout: false,
        metadata: { ...(log.metadata || {}), regularized: true, regularizationRequestId: request.id }
      });

      const updated = await this.regularizationRepository.update(request, {
        status: 'APPROVED',
        approvedBy: approver.id,
        approvedAt: new Date(),
        attendanceLogId: log.id,
        previousValues
      });

      await this.auditLogRepository.record({
        organizationId,
        actorId: approver.id,
        action: 'UPDATE',
        entityType: 'REGULARIZATION_REQUEST',
        entityId: request.id,
        description: `Regularization for ${request.date} approved by ${approver.id}`
      });

      await this.auditLogRepository.record({
        organizationId,
        actorId: approver.id,
        action: 'UPDATE',
        entityType: 'ATTENDANCE_LOG',
        entityId: log.id,
        previousValues,
        newValues,
        description: `Attendance for ${request.date} corrected via regularization`,
        severity: 'WARNING'
      });

      await this.publish(EVENT_TYPES.REGULARIZATION_APPROVED, organizationId, {
        userId: request.userId,
        regularizationRequestId: request.id,
        date: request.date,
        approvedBy: approver.id,
        attendanceLogId: log.id,
        checkInTime: newValues.checkInTime,
        checkOutTime: newValues.checkOutTime,
        attendanceType: newValues.attendanceType,
        workingMinutes: newValues.workingMinutes,
        lateMinutes: newValues.lateMinutes
      });

      return { updated, request };
    });

    await this.notifier.notify(request.userId, organizationId, {
      category: 'ATTENDANCE',
      title: 'Regularization approved',
      message: `Your attendance for ${request.date} has been corrected`,
      link: '/regularization'
    });

    return updated;
  }

  async rejectRegularization(requestId, approver, rejectionReason) {
    if (!rejectionReason) {
      throw new ValidationError('A rejection reason is required');
    }

    const { updated, request } = await this.withTransaction(async () => {
      const request = await this.loadForDecision(requestId, approver);

      const updated = await this.regularizationRepository.update(request, {
        status: 'REJECTED',
        approvedBy: approver.id,
        approvedAt: new Date(),
        rejectionReason
      });

      await this.auditLogRepository.record({
        organizationId: approver.organizationId,
        actorId: approver.id,
        action: 'UPDATE',
        entityType: 'REGULARIZATION_REQUEST',
        entityId: request.id,
        description: `Regularization for ${request.date} rejected by ${approver.id}`
      });

      await this.publish(EVENT_TYPES.REGULARIZATION_REJECTED, approver.organizationId, {
        userId: request.userId,
        regularizationRequestId: request.id,
        date: request.date,
        rejectedBy: approver.id
      });

      return { updated, request };
    });

    await this.notifier.notify(request.userId, approver.organizationId, {
      category: 'ATTENDANCE',
      title: 'Regularization rejected',
      message: `Your regularization request for ${request.date} was rejected`,
      link: '/regularization'
    });

    return updated;
  }

  async cancelRegularization(requestId, user) {
    return this.withTransaction(async () => {
      const request = await this.regularizationRepository.findOwned(requestId, user.id, user.organizationId, { lock: true });

      if (!request) {
        throw new NotFoundError('Regularization request not found');
      }

      if (request.status !== 'PENDING') {
        throw new ConflictError('Only pending requests can be cancelled');
      }

      const cancelled = await this.regularizationRepository.update(request, { status: 'CANCELLED' });

      await this.publish(EVENT_TYPES.REGULARIZATION_CANCELLED, user.organizationId, {
        userId: user.id,
        regularizationRequestId: request.id,
        date: request.date
      });

      return cancelled;
    });
  }

  // Recompute the derived attendance fields for the corrected times against the org's default shift
  async computeAttendance(organizationId, date, checkInTime, checkOutTime, currentType) {
    const shift = await this.shiftRepository.findDefault(organizationId);

    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let workingMinutes = null;

    if (shift && checkInTime) {
      const late = timeToMinutes(checkInTime) - timeToMinutes(shift.startTime);
      if (late > (shift.graceMinutes || 0)) {
        lateMinutes = late;
      }
    }

    if (shift && checkOutTime) {
      earlyLeaveMinutes = Math.max(0, timeToMinutes(shift.endTime) - timeToMinutes(checkOutTime));
    }

    if (checkInTime && checkOutTime) {
      workingMinutes = timeToMinutes(checkOutTime) - timeToMinutes(checkInTime);
    }

    // A corrected WFH day stays WFH; anything else becomes PRESENT or LATE from the new times
    const attendanceType = currentType === 'WORK_FROM_HOME'
      ? 'WORK_FROM_HOME'
      : (lateMinutes > 0 ? 'LATE' : 'PRESENT');

    return {
      checkInTime,
      checkOutTime: checkOutTime || null,
      checkInTimestamp: checkInTime ? new Date(`${date}T${checkInTime}`).toISOString() : null,
      checkOutTimestamp: checkOutTime ? new Date(`${date}T${checkOutTime}`).toISOString() : null,
      attendanceType,
      workingMinutes,
      lateMinutes,
      earlyLeaveMinutes
    };
  }
}

module.exports = new RegularizationService({
  ...repositories,
  notifier: NotificationService,
  publish: outboxPublish,
  withTransaction: dbTransaction,
  organizationSettings: require('./OrganizationService').settingsProvider
});
module.exports.RegularizationService = RegularizationService;
module.exports.REGULARIZATION_WINDOW_DAYS = REGULARIZATION_WINDOW_DAYS;
