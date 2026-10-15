const repositories = require('../repositories');
const cache = require('../utils/cache');
const passThroughCache = require('../utils/passThroughCache');
const { CACHE_KEYS, CACHE_TTL, NAMESPACES } = require('../utils/cacheKeys');
const NotificationService = require('./NotificationService');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { ValidationError, ConflictError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { toDateOnly } = require('../utils/dates');

// Used until HR configures leave policies for the organization
const DEFAULT_ALLOCATIONS = {
  ANNUAL: 21,
  SICK: 10,
  PERSONAL: 7,
  MATERNITY: 90,
  PATERNITY: 7
};

const PERIOD_START = {
  '1m': (now) => new Date(now.getFullYear(), now.getMonth(), 1),
  '3m': (now) => new Date(now.getFullYear(), now.getMonth() - 2, 1),
  '6m': (now) => new Date(now.getFullYear(), now.getMonth() - 5, 1),
  '1y': (now) => new Date(now.getFullYear(), 0, 1)
};

class LeaveService {
  constructor({
    leaveRepository, leavePolicyRepository, userRepository, auditLogRepository, notifier, publish,
    analyticsRepository,
    cache = passThroughCache,
    withTransaction = (fn) => fn()
  }) {
    this.leaveRepository = leaveRepository;
    this.analyticsRepository = analyticsRepository;
    this.leavePolicyRepository = leavePolicyRepository;
    this.userRepository = userRepository;
    this.auditLogRepository = auditLogRepository;
    this.notifier = notifier;
    this.publish = publish;
    this.cache = cache;
    this.withTransaction = withTransaction;
  }

  async applyLeave(user, { startDate, endDate, leaveType, reason, isHalfDay = false }) {
    if (!startDate || !endDate || !leaveType || !reason) {
      throw new ValidationError('Missing required fields: startDate, endDate, leaveType, reason');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      throw new ValidationError('Start date cannot be after end date');
    }

    if (start < new Date().setHours(0, 0, 0, 0)) {
      throw new ValidationError('Cannot apply for leave in the past');
    }

    if (await this.leaveRepository.findOverlapping(user.id, startDate, endDate)) {
      throw new ConflictError('Overlapping leave request exists');
    }

    const daysDiff = Math.ceil((end - start) / (1000 * 3600 * 24)) + 1;
    const dayCount = isHalfDay ? 0.5 : daysDiff;

    // Only enforced once HR has configured a leave policy for this type
    const leavePolicy = await this.leavePolicyRepository.findForType(user.organizationId, leaveType, { activeOnly: true });
    if (leavePolicy && !leavePolicy.allowNegativeBalance) {
      // Fresh, not cached - a stale balance must never allow overspending
      const balances = await this.computeLeaveBalance(user.id, user.organizationId, start.getFullYear());
      const balance = balances.find(b => b.leaveType === leaveType);
      if (balance && dayCount > balance.remaining) {
        throw new ValidationError(`Insufficient ${leaveType} leave balance: ${balance.remaining} day(s) remaining, ${dayCount} requested`);
      }
    }

    // Request, audit entry and outbox event commit together
    const leaveRequest = await this.withTransaction(async () => {
      const created = await this.leaveRepository.create({
        organizationId: user.organizationId,
        userId: user.id,
        startDate,
        endDate,
        leaveType,
        reason,
        isHalfDay,
        dayCount,
        status: 'PENDING'
      });

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'LEAVE_APPLY',
        entityType: 'LEAVE_REQUEST',
        entityId: created.id,
        description: `Leave application: ${leaveType} from ${startDate} to ${endDate}`
      });

      await this.publish(EVENT_TYPES.LEAVE_APPLIED, user.organizationId, {
        userId: user.id,
        leaveRequestId: created.id,
        leaveType,
        startDate: toDateOnly(startDate),
        endDate: toDateOnly(endDate),
        dayCount
      });

      return created;
    });

    // After commit: the cache (invalidating earlier could let a reader re-cache the old
    // balance) and the notification (a failed insert inside the transaction would abort it)
    await this.invalidateBalance(user.organizationId, user.id, startDate);

    if (user.managerId) {
      await this.notifier.notify(user.managerId, user.organizationId, {
        category: 'LEAVE',
        title: 'New leave request',
        message: `${user.name} applied for ${leaveType.toLowerCase()} leave from ${startDate} to ${endDate}`,
        link: '/leave'
      });
    }

    return leaveRequest;
  }

  getUserLeaves(userId, organizationId, filters = {}) {
    return this.leaveRepository.findForUser(userId, organizationId, filters);
  }

  // Managers only see their direct reports; HR/Admin see the whole organization
  getPendingLeaves(approver) {
    const managerId = approver.role === 'MANAGER' ? approver.id : null;
    return this.leaveRepository.findPending(approver.organizationId, managerId);
  }

  async approveLeave(leaveId, approver, comments = null) {
    const updated = await this.withTransaction(async () => {
      const leaveRequest = await this.loadForDecision(leaveId, approver);
      const approved = await this.leaveRepository.update(leaveRequest, {
        status: 'APPROVED',
        approvedBy: approver.id,
        approvedAt: new Date(),
        metadata: { ...leaveRequest.metadata, approverComments: comments }
      });
      await this.recordDecision(approved, approver, 'APPROVED');
      return approved;
    });

    await this.afterDecision(updated, 'APPROVED');
    return updated;
  }

  async rejectLeave(leaveId, approver, comments) {
    if (!comments) {
      throw new ValidationError('Comments are required when rejecting a leave request');
    }

    const updated = await this.withTransaction(async () => {
      const leaveRequest = await this.loadForDecision(leaveId, approver);
      const rejected = await this.leaveRepository.update(leaveRequest, {
        status: 'REJECTED',
        approvedBy: approver.id,
        approvedAt: new Date(),
        rejectionReason: comments
      });
      await this.recordDecision(rejected, approver, 'REJECTED');
      return rejected;
    });

    await this.afterDecision(updated, 'REJECTED');
    return updated;
  }

  // Request exists in the approver's org, is pending, and this approver may decide on it.
  // Runs inside the decision's transaction with the row locked (SELECT ... FOR UPDATE), so two
  // approvers clicking at once can't both approve: the second waits, then sees it's decided.
  async loadForDecision(leaveId, approver) {
    const leaveRequest = await this.leaveRepository.findByIdInOrg(leaveId, approver.organizationId, { lock: true });

    if (!leaveRequest) {
      throw new NotFoundError('Leave request not found');
    }

    if (leaveRequest.status !== 'PENDING') {
      throw new ConflictError('Leave request is not in pending status');
    }

    if (leaveRequest.userId === approver.id) {
      throw new ForbiddenError('You cannot approve or reject your own leave request');
    }

    if (approver.role === 'MANAGER') {
      const requester = await this.userRepository.findById(leaveRequest.userId);
      if (!requester || requester.managerId !== approver.id) {
        throw new ForbiddenError('Managers can only act on requests from their direct reports');
      }
    }

    return leaveRequest;
  }

  // Inside the decision's transaction: audit entry + outbox event
  async recordDecision(leaveRequest, approver, decision) {
    const verb = decision === 'APPROVED' ? 'approved' : 'rejected';

    await this.auditLogRepository.record({
      organizationId: leaveRequest.organizationId,
      actorId: approver.id,
      action: decision === 'APPROVED' ? 'LEAVE_APPROVE' : 'LEAVE_REJECT',
      entityType: 'LEAVE_REQUEST',
      entityId: leaveRequest.id,
      description: `Leave request ${verb} by ${approver.id}`
    });

    await this.publish(decision === 'APPROVED' ? EVENT_TYPES.LEAVE_APPROVED : EVENT_TYPES.LEAVE_REJECTED, leaveRequest.organizationId, {
      userId: leaveRequest.userId,
      leaveRequestId: leaveRequest.id,
      leaveType: leaveRequest.leaveType,
      startDate: toDateOnly(leaveRequest.startDate),
      endDate: toDateOnly(leaveRequest.endDate),
      [decision === 'APPROVED' ? 'approvedBy' : 'rejectedBy']: approver.id
    });
  }

  // After commit: refresh the requester's cached balance and tell them
  async afterDecision(leaveRequest, decision) {
    const verb = decision === 'APPROVED' ? 'approved' : 'rejected';

    await this.invalidateBalance(leaveRequest.organizationId, leaveRequest.userId, leaveRequest.startDate);

    await this.notifier.notify(leaveRequest.userId, leaveRequest.organizationId, {
      category: 'LEAVE',
      title: `Leave request ${verb}`,
      message: `Your ${leaveRequest.leaveType.toLowerCase()} leave from ${leaveRequest.startDate} to ${leaveRequest.endDate} was ${verb}`,
      link: '/leave'
    });
  }

  // Org-wide leave statistics. Postgres groups the requests (department x month x status x
  // type, a few dozen rows); this only folds those rows into the chart shapes.
  async getLeaveStatistics(organizationId, period = '1y') {
    const since = (PERIOD_START[period] || PERIOD_START['1y'])(new Date());
    const rows = await this.analyticsRepository.leaveBreakdown({ organizationId, since });

    const stats = {
      totalRequests: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      typeDistribution: {},
      departmentStats: {},
      monthlyPattern: []
    };
    const emptyCounts = () => ({ approved: 0, pending: 0, rejected: 0, cancelled: 0 });
    const monthlyData = {};

    rows.forEach(row => {
      const status = row.status.toLowerCase();
      stats.totalRequests += row.requests;
      if (status !== 'cancelled') stats[status] += row.requests;

      if (row.status === 'APPROVED') {
        stats.typeDistribution[row.leaveType] = (stats.typeDistribution[row.leaveType] || 0) + row.days;
      }

      if (row.department) {
        const dept = stats.departmentStats[row.department] || (stats.departmentStats[row.department] = { total: 0, ...emptyCounts() });
        dept.total += row.requests;
        dept[status] += row.requests;
      }

      (monthlyData[row.month] || (monthlyData[row.month] = emptyCounts()))[status] += row.requests;
    });

    stats.monthlyPattern = Object.entries(monthlyData)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return stats;
  }

  // Allocation rules per leave type: the org's LeavePolicy rows, or DEFAULT_ALLOCATIONS if HR
  // hasn't configured any
  allocationPolicies(configured) {
    return configured.length > 0
      ? configured.map(p => ({
        leaveType: p.leaveType,
        allocated: Number(p.annualAllocation),
        carryForwardMax: Number(p.carryForwardMax),
        allowNegativeBalance: p.allowNegativeBalance
      }))
      : Object.entries(DEFAULT_ALLOCATIONS).map(([leaveType, allocated]) => ({
        leaveType,
        allocated,
        carryForwardMax: 0,
        allowNegativeBalance: false
      }));
  }

  // Organization leave utilization for a year: approved days taken vs days allocated
  // (allocation x active headcount), per leave type. Types without an allocation (e.g. UNPAID)
  // show days taken with no rate. Carry-forward isn't included in the allocation.
  async getLeaveUtilization(organizationId, year = new Date().getFullYear()) {
    const [configured, usedRows, memberIds] = await Promise.all([
      this.leavePolicyRepository.findActiveForOrg(organizationId),
      this.analyticsRepository.approvedLeaveDaysByType({ organizationId, year }),
      this.userRepository.findActiveMemberIds(organizationId)
    ]);
    const headcount = memberIds.length;
    const used = new Map(usedRows.map(r => [r.leaveType, r.days]));
    const allocatedPerEmployee = new Map(this.allocationPolicies(configured).map(p => [p.leaveType, p.allocated]));
    const types = [...new Set([...allocatedPerEmployee.keys(), ...used.keys()])];

    const byType = types.map(leaveType => {
      const allocatedDays = (allocatedPerEmployee.get(leaveType) || 0) * headcount;
      const usedDays = used.get(leaveType) || 0;
      return {
        leaveType,
        allocatedDays,
        usedDays,
        utilizationRate: allocatedDays ? Math.round((usedDays / allocatedDays) * 1000) / 10 : null
      };
    });

    const totalAllocated = byType.reduce((sum, t) => sum + t.allocatedDays, 0);
    const totalUsed = byType.reduce((sum, t) => sum + t.usedDays, 0);
    return {
      year,
      headcount,
      byType,
      totalAllocatedDays: totalAllocated,
      totalUsedDays: totalUsed,
      utilizationRate: totalAllocated ? Math.round((totalUsed / totalAllocated) * 1000) / 10 : null,
      averageDaysPerEmployee: headcount ? Math.round((totalUsed / headcount) * 10) / 10 : 0
    };
  }

  // Leave balance per type for a year: allocation from the org's LeavePolicy rows
  // (or DEFAULT_ALLOCATIONS if HR hasn't configured any), plus carry-forward from last year.
  // Cached for the leave page. Per-user entries are dropped when that user applies or gets a
  // decision; all of an org's entries are dropped (namespace bump) when its leave policies change.
  getLeaveBalance(userId, organizationId, year = new Date().getFullYear()) {
    return this.cache.withVersionedCache(
      NAMESPACES.leavePolicy(organizationId),
      CACHE_KEYS.leaveBalance(organizationId, userId, year),
      CACHE_TTL.leaveBalance,
      () => this.computeLeaveBalance(userId, organizationId, year)
    );
  }

  // A leave in year Y changes Y's balance and, through carry-forward, Y+1's
  async invalidateBalance(organizationId, userId, startDate) {
    const year = Number(toDateOnly(startDate).slice(0, 4));
    await this.cache.cacheDelVersioned(
      NAMESPACES.leavePolicy(organizationId),
      [year, year + 1].map(y => CACHE_KEYS.leaveBalance(organizationId, userId, y))
    );
  }

  async computeLeaveBalance(userId, organizationId, year = new Date().getFullYear()) {
    const configured = await this.leavePolicyRepository.findActiveForOrg(organizationId);
    const policies = this.allocationPolicies(configured);

    const [thisYear, lastYear] = await Promise.all([
      this.sumDaysByType(userId, organizationId, year, ['APPROVED', 'PENDING']),
      this.sumDaysByType(userId, organizationId, year - 1, ['APPROVED'])
    ]);

    return policies.map(policy => {
      const lastYearUnused = Math.max(0, policy.allocated - (lastYear.APPROVED[policy.leaveType] || 0));
      const carried = Math.min(policy.carryForwardMax, lastYearUnused);
      const used = thisYear.APPROVED[policy.leaveType] || 0;
      const pending = thisYear.PENDING[policy.leaveType] || 0;

      return {
        leaveType: policy.leaveType,
        type: policy.leaveType,
        allocated: policy.allocated,
        carried,
        used,
        pending,
        remaining: policy.allocated + carried - used - pending,
        allowNegativeBalance: policy.allowNegativeBalance,
        isConfigured: configured.length > 0
      };
    });
  }

  // { APPROVED: { ANNUAL: 3, ... }, PENDING: { ... } } for leaves starting in the given year
  async sumDaysByType(userId, organizationId, year, statuses) {
    const leaves = await this.leaveRepository.findForYear(userId, organizationId, year, statuses);

    const totals = { APPROVED: {}, PENDING: {} };
    leaves.forEach(leave => {
      const bucket = totals[leave.status];
      bucket[leave.leaveType] = (bucket[leave.leaveType] || 0) + Number(leave.dayCount);
    });

    return totals;
  }
}

module.exports = new LeaveService({
  ...repositories,
  notifier: NotificationService,
  publish: outboxPublish,
  cache,
  withTransaction: dbTransaction
});
module.exports.LeaveService = LeaveService;
module.exports.DEFAULT_ALLOCATIONS = DEFAULT_ALLOCATIONS;
