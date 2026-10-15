const repositories = require('../repositories');
const NotificationService = require('./NotificationService');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');

const { IS_HR_UP } = require('../config/constants');

class HiringService {
  constructor({ jobOpeningRepository, referralRepository, userRepository, auditLogRepository, notifier, publish, withTransaction = (fn) => fn() }) {
    this.jobOpeningRepository = jobOpeningRepository;
    this.referralRepository = referralRepository;
    this.userRepository = userRepository;
    this.auditLogRepository = auditLogRepository;
    this.notifier = notifier;
    this.publish = publish;
    this.withTransaction = withTransaction;
  }

  // Employees only see OPEN jobs; HR/Admin see everything plus per-job referral counts
  async listJobs(user, filters = {}) {
    const isHr = IS_HR_UP.includes(user.role);
    const jobs = await this.jobOpeningRepository.findForOrg(user.organizationId, {
      status: isHr ? filters.status : 'OPEN',
      department: filters.department
    });

    if (!isHr || jobs.length === 0) {
      return jobs;
    }

    const counts = await this.referralRepository.countByJobAndStatus(jobs.map(j => j.id));

    return jobs.map(job => {
      const rows = counts.filter(c => c.jobOpeningId === job.id);
      return {
        ...job.toJSON(),
        referralCount: rows.reduce((sum, r) => sum + Number(r.count), 0),
        referralsByStatus: Object.fromEntries(rows.map(r => [r.status, Number(r.count)]))
      };
    });
  }

  async createJob(user, data) {
    // Record, audit entry and outbox event commit together
    return this.withTransaction(async () => {
      const job = await this.jobOpeningRepository.create({
        ...data,
        organizationId: user.organizationId,
        createdBy: user.id,
        status: 'OPEN'
      });

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'CREATE',
        entityType: 'JOB_OPENING',
        entityId: job.id,
        description: `Job opening "${job.title}" posted`
      });

      // Telling every employee about it is done asynchronously by the notification worker
      await this.publish(EVENT_TYPES.JOB_OPENING_POSTED, user.organizationId, {
        jobOpeningId: job.id,
        title: job.title,
        department: job.department || null,
        employmentType: job.employmentType,
        openings: job.openings,
        postedBy: user.id
      });

      return job;
    });
  }

  async updateJob(jobId, user, data) {
    const job = await this.jobOpeningRepository.findByIdInOrg(jobId, user.organizationId);

    if (!job) {
      throw new NotFoundError('Job opening not found');
    }

    const previousValues = job.toJSON();
    const updated = await this.jobOpeningRepository.update(job, data);

    await this.auditLogRepository.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'UPDATE',
      entityType: 'JOB_OPENING',
      entityId: job.id,
      previousValues,
      newValues: updated.toJSON(),
      description: previousValues.status !== updated.status
        ? `Job opening "${updated.title}" moved to ${updated.status}`
        : `Job opening "${updated.title}" updated`
    });

    return updated;
  }

  async referCandidate(jobId, user, data) {
    const job = await this.jobOpeningRepository.findByIdInOrg(jobId, user.organizationId);

    if (!job) {
      throw new NotFoundError('Job opening not found');
    }

    if (job.status !== 'OPEN') {
      throw new ValidationError('This position is not accepting referrals right now');
    }

    const candidateEmail = data.candidateEmail.trim().toLowerCase();

    if (candidateEmail === String(user.email).toLowerCase()) {
      throw new ValidationError('You cannot refer yourself');
    }

    if (await this.userRepository.findByEmailInOrg(candidateEmail, user.organizationId)) {
      throw new ConflictError('This person already works here');
    }

    if (await this.referralRepository.findForJobAndEmail(jobId, candidateEmail)) {
      throw new ConflictError('This candidate has already been referred for this position');
    }

    const referral = await this.referralRepository.create({
      ...data,
      candidateEmail,
      organizationId: user.organizationId,
      jobOpeningId: jobId,
      referredBy: user.id,
      status: 'SUBMITTED'
    });

    await this.auditLogRepository.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'CREATE',
      entityType: 'REFERRAL',
      entityId: referral.id,
      description: `${referral.candidateName} referred for "${job.title}"`
    });

    const hrUsers = await this.userRepository.findActiveByRoles(user.organizationId, IS_HR_UP);

    await this.notifier.notifyMany(hrUsers.map(u => u.id), user.organizationId, {
      category: 'HR',
      title: 'New referral',
      message: `${user.name} referred ${referral.candidateName} for ${job.title}`,
      link: '/hiring',
      metadata: { referralId: referral.id, jobOpeningId: job.id }
    });

    return referral;
  }

  getMyReferrals(user) {
    return this.referralRepository.findByReferrer(user.id, user.organizationId);
  }

  listReferrals(user, filters = {}) {
    return this.referralRepository.findForOrg(user.organizationId, filters);
  }

  async updateReferralStatus(referralId, user, { status, statusNote = null }) {
    const referral = await this.referralRepository.findInOrgWithJob(referralId, user.organizationId);

    if (!referral) {
      throw new NotFoundError('Referral not found');
    }

    if (!this.referralRepository.canMoveTo(referral.status, status)) {
      throw new ConflictError(`Cannot move a referral from ${referral.status} to ${status}`);
    }

    const previousStatus = referral.status;
    const updated = await this.referralRepository.update(referral, {
      status,
      statusNote,
      statusUpdatedBy: user.id,
      statusUpdatedAt: new Date()
    });

    await this.auditLogRepository.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'UPDATE',
      entityType: 'REFERRAL',
      entityId: referral.id,
      previousValues: { status: previousStatus },
      newValues: { status, statusNote },
      description: `Referral of ${referral.candidateName} moved ${previousStatus} -> ${status}`
    });

    await this.notifier.notify(referral.referredBy, user.organizationId, {
      category: 'HR',
      title: 'Referral update',
      message: `${referral.candidateName} (${referral.jobOpening.title}) is now ${status.toLowerCase()}`,
      link: '/hiring',
      metadata: { referralId: referral.id }
    });

    // Close the opening automatically once every position has been filled
    if (status === 'HIRED') {
      const hiredCount = await this.referralRepository.countHired(referral.jobOpeningId);
      if (hiredCount >= referral.jobOpening.openings && referral.jobOpening.status !== 'CLOSED') {
        await this.updateJob(referral.jobOpeningId, user, { status: 'CLOSED' });
      }
    }

    return updated;
  }

  async withdrawReferral(referralId, user) {
    const referral = await this.referralRepository.findOwned(referralId, user.id, user.organizationId);

    if (!referral) {
      throw new NotFoundError('Referral not found');
    }

    if (!this.referralRepository.canMoveTo(referral.status, 'WITHDRAWN')) {
      throw new ConflictError(`A ${referral.status.toLowerCase()} referral can no longer be withdrawn`);
    }

    return this.referralRepository.update(referral, {
      status: 'WITHDRAWN',
      statusUpdatedBy: user.id,
      statusUpdatedAt: new Date()
    });
  }
}

module.exports = new HiringService({
  ...repositories,
  notifier: NotificationService,
  publish: outboxPublish,
  withTransaction: dbTransaction
});
module.exports.HiringService = HiringService;
