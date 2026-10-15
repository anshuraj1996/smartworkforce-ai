const repositories = require('../repositories');
const cache = require('../utils/cache');
const passThroughCache = require('../utils/passThroughCache');
const { NAMESPACES } = require('../utils/cacheKeys');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { LEAVE_TYPES } = require('../config/constants');

// Fields whose change means employees must read the policy again
const VERSIONED_FIELDS = ['title', 'content', 'effectiveDate'];

class PolicyService {
  constructor({
    policyRepository,
    policyAcknowledgementRepository,
    leavePolicyRepository,
    userRepository,
    auditLogRepository,
    publish,
    cache = passThroughCache,
    withTransaction = (fn) => fn()
  }) {
    this.policyRepository = policyRepository;
    this.policyAcknowledgementRepository = policyAcknowledgementRepository;
    this.leavePolicyRepository = leavePolicyRepository;
    this.userRepository = userRepository;
    this.auditLogRepository = auditLogRepository;
    this.publish = publish;
    this.withTransaction = withTransaction;
    this.cache = cache;
  }

  // Policies, each flagged with whether this user has acknowledged its current version
  async listPolicies(user, filters = {}) {
    const policies = await this.policyRepository.findForOrg(user.organizationId, filters);
    const acks = await this.policyAcknowledgementRepository.findForUser(user.id, policies.map(p => p.id));

    return policies.map(policy => {
      const ack = acks.find(a => a.policyId === policy.id && a.version === policy.version);
      return { ...policy.toJSON(), acknowledged: !!ack, acknowledgedAt: ack ? ack.acknowledgedAt : null };
    });
  }

  async getPolicy(policyId, user) {
    const policy = await this.policyRepository.findInOrgWithAuthor(policyId, user.organizationId);

    if (!policy) {
      throw new NotFoundError('Policy not found');
    }

    const ack = await this.policyAcknowledgementRepository.findForUserVersion(policyId, user.id, policy.version);
    return { ...policy.toJSON(), acknowledged: !!ack, acknowledgedAt: ack ? ack.acknowledgedAt : null };
  }

  async createPolicy(user, data) {
    // Record, audit entry and outbox event commit together
    return this.withTransaction(async () => {
      const policy = await this.policyRepository.create({
        ...data,
        organizationId: user.organizationId,
        createdBy: user.id,
        version: 1
      });

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'CREATE',
        entityType: 'POLICY',
        entityId: policy.id,
        description: `Policy "${policy.title}" published`
      });

      // Asking employees to acknowledge it is done asynchronously by the notification worker
      await this.publish(EVENT_TYPES.POLICY_PUBLISHED, user.organizationId, {
        policyId: policy.id,
        category: policy.category,
        policyVersion: policy.version,
        effectiveDate: policy.effectiveDate,
        requiresAcknowledgement: Boolean(policy.requiresAcknowledgement),
        publishedBy: user.id
      });

      return policy;
    });
  }

  async updatePolicy(policyId, user, data) {
    // Record, audit entry and outbox event commit together
    return this.withTransaction(async () => {
      const policy = await this.policyRepository.findByIdInOrg(policyId, user.organizationId);

      if (!policy) {
        throw new NotFoundError('Policy not found');
      }

      const previousValues = policy.toJSON();
      const contentChanged = VERSIONED_FIELDS.some(field =>
        data[field] !== undefined && String(data[field]) !== String(policy[field])
      );

      const updated = await this.policyRepository.update(policy, {
        ...data,
        updatedBy: user.id,
        version: contentChanged ? policy.version + 1 : policy.version
      });

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'UPDATE',
        entityType: 'POLICY',
        entityId: policy.id,
        previousValues,
        newValues: updated.toJSON(),
        description: contentChanged
          ? `Policy "${updated.title}" revised to version ${updated.version}`
          : `Policy "${updated.title}" settings updated`
      });

      await this.publish(EVENT_TYPES.POLICY_UPDATED, user.organizationId, {
        policyId: policy.id,
        policyVersion: updated.version,
        previousPolicyVersion: previousValues.version,
        contentChanged,
        isActive: Boolean(updated.isActive),
        updatedBy: user.id
      });

      return updated;
    });
  }

  // Archived rather than deleted so existing acknowledgements stay auditable
  async archivePolicy(policyId, user) {
    // Record, audit entry and outbox event commit together
    return this.withTransaction(async () => {
      const policy = await this.policyRepository.findByIdInOrg(policyId, user.organizationId);

      if (!policy) {
        throw new NotFoundError('Policy not found');
      }

      await this.policyRepository.update(policy, { isActive: false, updatedBy: user.id });

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'UPDATE',
        entityType: 'POLICY',
        entityId: policy.id,
        description: `Policy "${policy.title}" archived`
      });

      await this.publish(EVENT_TYPES.POLICY_ARCHIVED, user.organizationId, {
        policyId: policy.id,
        archivedBy: user.id
      });

      return policy;
    });
  }

  async acknowledgePolicy(policyId, user) {
    const policy = await this.policyRepository.findActiveInOrg(policyId, user.organizationId);

    if (!policy) {
      throw new NotFoundError('Policy not found');
    }

    return this.policyAcknowledgementRepository.acknowledge(user.organizationId, policyId, user.id, policy.version);
  }

  // Who has / hasn't acknowledged the current version (HR compliance view)
  async getAcknowledgementStatus(policyId, user) {
    const policy = await this.policyRepository.findByIdInOrg(policyId, user.organizationId);

    if (!policy) {
      throw new NotFoundError('Policy not found');
    }

    const [employees, acks] = await Promise.all([
      this.userRepository.findActiveInOrg(user.organizationId, ['id', 'name', 'email', 'department']),
      this.policyAcknowledgementRepository.findForVersion(policyId, policy.version)
    ]);

    const ackByUser = new Map(acks.map(a => [a.userId, a.acknowledgedAt]));
    const acknowledged = [];
    const pending = [];

    employees
      .map(emp => emp.toJSON())
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(emp => {
        if (ackByUser.has(emp.id)) {
          acknowledged.push({ ...emp, acknowledgedAt: ackByUser.get(emp.id) });
        } else {
          pending.push(emp);
        }
      });

    return {
      policyId,
      version: policy.version,
      totalEmployees: employees.length,
      acknowledgedCount: acknowledged.length,
      acknowledged,
      pending
    };
  }

  // ---- Leave policies (yearly allocations per leave type) ----

  getLeavePolicies(organizationId) {
    return this.leavePolicyRepository.findForOrg(organizationId);
  }

  async upsertLeavePolicy(user, leaveTypeParam, data) {
    const leaveType = String(leaveTypeParam).toUpperCase();
    if (!LEAVE_TYPES.includes(leaveType)) {
      throw new ValidationError(`Invalid leave type (expected one of: ${LEAVE_TYPES.join(', ')})`);
    }

    const existing = await this.leavePolicyRepository.findForType(user.organizationId, leaveType);
    const previousValues = existing ? existing.toJSON() : null;

    const leavePolicy = existing
      ? await this.leavePolicyRepository.update(existing, data)
      : await this.leavePolicyRepository.create({ ...data, organizationId: user.organizationId, leaveType });

    await this.auditLogRepository.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: existing ? 'UPDATE' : 'CREATE',
      entityType: 'LEAVE_POLICY',
      entityId: leavePolicy.id,
      previousValues,
      newValues: leavePolicy.toJSON(),
      description: `${leaveType} leave allocation set to ${leavePolicy.annualAllocation} days/year`
    });

    // Every cached leave balance in the org was computed from the old allocation
    await this.cache.bumpNamespace(NAMESPACES.leavePolicy(user.organizationId));

    return leavePolicy;
  }
}

module.exports = new PolicyService({
  ...repositories,
  publish: outboxPublish,
  cache,
  withTransaction: dbTransaction
});
module.exports.PolicyService = PolicyService;
