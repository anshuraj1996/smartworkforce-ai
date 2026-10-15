const repositories = require('../repositories');
const NotificationService = require('./NotificationService');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { ValidationError, ConflictError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { toLocalDateString, toDateOnly, monthRange } = require('../utils/dates');
const { DEFAULT_ORG_SETTINGS, defaultSettingsProvider } = require('../config/organizationSettings');

// Default monthly cap on WFH days per employee. Not org-configurable yet, just a flat rule for now.
// Default only - each organization sets its own (organizationSettings.wfhMonthlyQuota)
const MONTHLY_WFH_QUOTA = DEFAULT_ORG_SETTINGS.wfhMonthlyQuota;

const dayCount = (request) => {
  if (request.isHalfDay) return 0.5;
  const diff = new Date(request.endDate) - new Date(request.startDate);
  return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
};

// Business rules for work-from-home requests. All data access goes through the injected
// repositories, notifications through `notifier`, and domain events through `publish`,
// so the rules can be unit-tested without a database, Redis or Kafka.
class WfhService {
  constructor({
    wfhRepository,
    leaveRepository,
    attendanceRepository,
    userRepository,
    auditLogRepository,
    notifier,
    publish,
    withTransaction = (fn) => fn(),
    organizationSettings = defaultSettingsProvider
  }) {
    this.wfhRepository = wfhRepository;
    this.leaveRepository = leaveRepository;
    this.attendanceRepository = attendanceRepository;
    this.userRepository = userRepository;
    this.auditLogRepository = auditLogRepository;
    this.notifier = notifier;
    this.publish = publish;
    this.withTransaction = withTransaction;
    this.organizationSettings = organizationSettings;
  }

  async applyWfh(user, { startDate, endDate, reason, isHalfDay = false, halfDayType = null }) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      throw new ValidationError('Start date cannot be after end date');
    }

    if (start < new Date().setHours(0, 0, 0, 0)) {
      throw new ValidationError('Cannot request WFH for a past date');
    }

    if (await this.wfhRepository.findOverlapping(user.id, startDate, endDate)) {
      throw new ConflictError('A WFH request already exists for one of these dates');
    }

    if (await this.leaveRepository.findOverlapping(user.id, startDate, endDate)) {
      throw new ConflictError('Cannot request WFH on dates that overlap an existing leave request');
    }

    const requestedDays = dayCount({ isHalfDay, startDate, endDate });
    const quota = await this.getMonthlyQuotaUsage(user.id, user.organizationId, start.getMonth() + 1, start.getFullYear());

    if (quota.used + requestedDays > quota.quota) {
      throw new ValidationError(`This request would exceed the monthly WFH quota (${quota.used}/${quota.quota} days already used)`);
    }

    // Request, audit entry and outbox event commit together
    const wfhRequest = await this.withTransaction(async () => {
      const created = await this.wfhRepository.create({
        organizationId: user.organizationId,
        userId: user.id,
        startDate,
        endDate,
        isHalfDay,
        halfDayType,
        reason,
        status: 'PENDING'
      });

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'CREATE',
        entityType: 'WFH_REQUEST',
        entityId: created.id,
        description: `WFH requested from ${startDate} to ${endDate}`
      });

      await this.publish(EVENT_TYPES.WFH_APPLIED, user.organizationId, {
        userId: user.id,
        wfhRequestId: created.id,
        startDate: toDateOnly(startDate),
        endDate: toDateOnly(endDate),
        isHalfDay
      });

      return created;
    });

    // After commit, so a failed notification can't roll the request back
    if (user.managerId) {
      await this.notifier.notify(user.managerId, user.organizationId, {
        category: 'WFH',
        title: 'New WFH request',
        message: `${user.name} requested WFH from ${startDate} to ${endDate}`,
        link: '/wfh'
      });
    }

    return wfhRequest;
  }

  getUserWfhRequests(user, filters = {}) {
    return this.wfhRepository.findForUser(user.id, user.organizationId, filters);
  }

  // Managers only see their direct reports; HR/Admin see the whole organization
  getPendingWfhRequests(approver) {
    const managerId = approver.role === 'MANAGER' ? approver.id : null;
    return this.wfhRepository.findPending(approver.organizationId, managerId);
  }

  async approveWfh(wfhId, approver) {
    // Status change, attendance rows, audit entry and event commit together - an approval can't
    // end up half-applied (approved but some days not marked WFH)
    const updated = await this.withTransaction(async () => {
      const wfhRequest = await this.loadForDecision(wfhId, approver);
      const approved = await this.wfhRepository.update(wfhRequest, {
        status: 'APPROVED',
        approvedBy: approver.id,
        approvedAt: new Date()
      });

      // Mark the covered dates as WFH on the attendance log so the calendar view reflects it
      await this.syncAttendanceForApprovedWfh(approved);

      await this.recordDecision(approved, approver, 'APPROVED');
      return approved;
    });

    await this.notifyDecision(updated, 'APPROVED');
    return updated;
  }

  async rejectWfh(wfhId, approver, rejectionReason) {
    if (!rejectionReason) {
      throw new ValidationError('A rejection reason is required');
    }

    const updated = await this.withTransaction(async () => {
      const wfhRequest = await this.loadForDecision(wfhId, approver);
      const rejected = await this.wfhRepository.update(wfhRequest, {
        status: 'REJECTED',
        approvedBy: approver.id,
        approvedAt: new Date(),
        rejectionReason
      });
      await this.recordDecision(rejected, approver, 'REJECTED');
      return rejected;
    });

    await this.notifyDecision(updated, 'REJECTED');
    return updated;
  }

  // Request exists in the approver's org, is pending, and this approver may decide on it.
  // Runs inside the decision's transaction with the row locked (SELECT ... FOR UPDATE), so two
  // approvers clicking at once can't both decide: the second waits, then sees it's decided.
  async loadForDecision(wfhId, approver) {
    const wfhRequest = await this.wfhRepository.findByIdInOrg(wfhId, approver.organizationId, { lock: true });

    if (!wfhRequest) {
      throw new NotFoundError('WFH request not found');
    }

    if (wfhRequest.status !== 'PENDING') {
      throw new ConflictError('WFH request is not pending');
    }

    if (wfhRequest.userId === approver.id) {
      throw new ForbiddenError('You cannot approve or reject your own WFH request');
    }

    if (approver.role === 'MANAGER') {
      const requester = await this.userRepository.findById(wfhRequest.userId);
      if (!requester || requester.managerId !== approver.id) {
        throw new ForbiddenError('Managers can only act on requests from their direct reports');
      }
    }

    return wfhRequest;
  }

  // Inside the decision's transaction: audit entry + outbox event
  async recordDecision(wfhRequest, approver, decision) {
    const verb = decision === 'APPROVED' ? 'approved' : 'rejected';

    await this.auditLogRepository.record({
      organizationId: wfhRequest.organizationId,
      actorId: approver.id,
      action: 'UPDATE',
      entityType: 'WFH_REQUEST',
      entityId: wfhRequest.id,
      description: `WFH request ${verb} by ${approver.id}`
    });

    await this.publish(decision === 'APPROVED' ? EVENT_TYPES.WFH_APPROVED : EVENT_TYPES.WFH_REJECTED, wfhRequest.organizationId, {
      userId: wfhRequest.userId,
      wfhRequestId: wfhRequest.id,
      startDate: toDateOnly(wfhRequest.startDate),
      endDate: toDateOnly(wfhRequest.endDate),
      [decision === 'APPROVED' ? 'approvedBy' : 'rejectedBy']: approver.id
    });
  }

  // After commit: tell the requester
  async notifyDecision(wfhRequest, decision) {
    const verb = decision === 'APPROVED' ? 'approved' : 'rejected';
    await this.notifier.notify(wfhRequest.userId, wfhRequest.organizationId, {
      category: 'WFH',
      title: `WFH request ${verb}`,
      message: `Your WFH request from ${wfhRequest.startDate} to ${wfhRequest.endDate} was ${verb}`,
      link: '/wfh'
    });
  }

  // Once approved, write/patch attendance rows for each covered day so attendance + calendar reflect WFH
  async syncAttendanceForApprovedWfh(wfhRequest) {
    const start = new Date(wfhRequest.startDate);
    const end = new Date(wfhRequest.endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      await this.attendanceRepository.setAttendanceType(
        wfhRequest.organizationId,
        wfhRequest.userId,
        toLocalDateString(d),
        'WORK_FROM_HOME'
      );
    }
  }

  async getMonthlyQuotaUsage(userId, organizationId, month, year) {
    const { start, end } = monthRange(year, month);
    const [approved, settings] = await Promise.all([
      this.wfhRepository.findApprovedWithin(userId, organizationId, start, end),
      this.organizationSettings.get(organizationId)
    ]);
    const used = approved.reduce((total, req) => total + dayCount(req), 0);
    const quota = settings.wfhMonthlyQuota;

    return { used, quota, remaining: Math.max(0, quota - used) };
  }
}

module.exports = new WfhService({
  ...repositories,
  notifier: NotificationService,
  publish: outboxPublish,
  withTransaction: dbTransaction,
  organizationSettings: require('./OrganizationService').settingsProvider
});
module.exports.WfhService = WfhService;
module.exports.MONTHLY_WFH_QUOTA = MONTHLY_WFH_QUOTA;
