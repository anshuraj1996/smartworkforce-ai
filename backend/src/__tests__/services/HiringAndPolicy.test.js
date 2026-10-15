jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { HiringService } = require('../../services/HiringService');
const { PolicyService } = require('../../services/PolicyService');
const { ValidationError, ConflictError } = require('../../utils/errors');
const { users, record, updatingRepo } = require('../helpers');

// Mirrors Referral.TRANSITIONS
const TRANSITIONS = {
  SUBMITTED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['INTERVIEWING', 'REJECTED', 'WITHDRAWN'],
  INTERVIEWING: ['OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['HIRED', 'REJECTED', 'WITHDRAWN'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: []
};

const buildHiring = () => {
  const deps = {
    jobOpeningRepository: updatingRepo({ findByIdInOrg: jest.fn().mockResolvedValue(record({ id: 'job-1', title: 'Backend Engineer', status: 'OPEN', openings: 1 })) }),
    referralRepository: updatingRepo({
      findForJobAndEmail: jest.fn().mockResolvedValue(null),
      findInOrgWithJob: jest.fn(),
      countHired: jest.fn().mockResolvedValue(1),
      canMoveTo: (from, to) => TRANSITIONS[from].includes(to)
    }),
    userRepository: {
      findByEmailInOrg: jest.fn().mockResolvedValue(null),
      findActiveByRoles: jest.fn().mockResolvedValue([{ id: 'hr-1' }])
    },
    auditLogRepository: { record: jest.fn() },
    notifier: { notify: jest.fn(), notifyMany: jest.fn() },
    publish: jest.fn()
  };
  return { service: new HiringService(deps), deps };
};

describe('HiringService.referCandidate', () => {
  const candidate = { candidateName: 'Ravi Kumar', candidateEmail: ' Ravi@Mail.Test ' };

  it('stores a trimmed, lower-cased email and notifies HR', async () => {
    const { service, deps } = buildHiring();

    await service.referCandidate('job-1', users.employee, candidate);

    expect(deps.referralRepository.create).toHaveBeenCalledWith(expect.objectContaining({ candidateEmail: 'ravi@mail.test', status: 'SUBMITTED' }));
    expect(deps.notifier.notifyMany).toHaveBeenCalledWith(['hr-1'], 'org-1', expect.objectContaining({ title: 'New referral' }));
  });

  it('rejects self-referral, existing employees, duplicates and closed jobs', async () => {
    const { service, deps } = buildHiring();

    await expect(service.referCandidate('job-1', users.employee, { ...candidate, candidateEmail: 'ASHA@acme.test' })).rejects.toThrow('refer yourself');

    deps.userRepository.findByEmailInOrg.mockResolvedValueOnce({ id: 'u9' });
    await expect(service.referCandidate('job-1', users.employee, candidate)).rejects.toThrow('already works here');

    deps.referralRepository.findForJobAndEmail.mockResolvedValueOnce({ id: 'ref-0' });
    await expect(service.referCandidate('job-1', users.employee, candidate)).rejects.toBeInstanceOf(ConflictError);

    deps.jobOpeningRepository.findByIdInOrg.mockResolvedValueOnce(record({ id: 'job-1', status: 'CLOSED' }));
    await expect(service.referCandidate('job-1', users.employee, candidate)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('HiringService.createJob', () => {
  it('publishes JOB_OPENING_POSTED instead of notifying everyone inside the request', async () => {
    const { service, deps } = buildHiring();

    await service.createJob(users.hr, { title: 'Backend Engineer', description: 'Node role', employmentType: 'FULL_TIME', openings: 2 });

    expect(deps.notifier.notifyMany).not.toHaveBeenCalled();
    expect(deps.publish).toHaveBeenCalledWith('JOB_OPENING_POSTED', 'org-1', expect.objectContaining({
      title: 'Backend Engineer', openings: 2, postedBy: 'hr-1', department: null
    }));
  });
});

describe('HiringService.updateReferralStatus', () => {
  const referral = (status) => record({
    id: 'ref-1', status, candidateName: 'Ravi', referredBy: 'emp-1', jobOpeningId: 'job-1',
    jobOpening: { title: 'Backend Engineer', openings: 1, status: 'OPEN' }
  });

  it('refuses to skip pipeline stages', async () => {
    const { service, deps } = buildHiring();
    deps.referralRepository.findInOrgWithJob.mockResolvedValue(referral('SUBMITTED'));

    await expect(service.updateReferralStatus('ref-1', users.hr, { status: 'HIRED' })).rejects.toThrow('Cannot move a referral from SUBMITTED to HIRED');
  });

  it('closes the job once every opening is filled', async () => {
    const { service, deps } = buildHiring();
    deps.referralRepository.findInOrgWithJob.mockResolvedValue(referral('OFFERED'));

    await service.updateReferralStatus('ref-1', users.hr, { status: 'HIRED' });

    expect(deps.jobOpeningRepository.update).toHaveBeenCalledWith(expect.anything(), { status: 'CLOSED' });
    expect(deps.notifier.notify).toHaveBeenCalledWith('emp-1', 'org-1', expect.objectContaining({ title: 'Referral update' }));
  });
});

describe('PolicyService.updatePolicy versioning', () => {
  const buildPolicy = (policy) => {
    const deps = {
      policyRepository: updatingRepo({ findByIdInOrg: jest.fn().mockResolvedValue(policy) }),
      policyAcknowledgementRepository: {},
      leavePolicyRepository: {},
      userRepository: { findActiveInOrg: jest.fn().mockResolvedValue([{ id: 'emp-1' }]) },
      auditLogRepository: { record: jest.fn() },
      publish: jest.fn()
    };
    return { service: new PolicyService(deps), deps };
  };

  const policy = () => record({
    id: 'p1', organizationId: 'org-1', title: 'WFH rules', content: 'Max 8 days a month',
    effectiveDate: '2026-10-01', version: 2, isActive: true, requiresAcknowledgement: true
  });

  // Re-acknowledgement notifications are sent by the notification worker from this event
  it('bumps the version and publishes contentChanged=true when the content changes', async () => {
    const { service, deps } = buildPolicy(policy());

    const updated = await service.updatePolicy('p1', users.hr, { content: 'Max 6 days a month' });

    expect(updated.version).toBe(3);
    expect(deps.publish).toHaveBeenCalledWith('POLICY_UPDATED', 'org-1', expect.objectContaining({
      policyVersion: 3, previousPolicyVersion: 2, contentChanged: true
    }));
  });

  it('keeps the version for settings-only or unchanged edits', async () => {
    const { service, deps } = buildPolicy(policy());

    const updated = await service.updatePolicy('p1', users.hr, { category: 'WFH', effectiveDate: '2026-10-01' });

    expect(updated.version).toBe(2);
    expect(deps.publish).toHaveBeenCalledWith('POLICY_UPDATED', 'org-1', expect.objectContaining({ contentChanged: false }));
  });

  it('rejects an unknown leave type', async () => {
    const { service } = buildPolicy(policy());

    await expect(service.upsertLeavePolicy(users.hr, 'casual', { annualAllocation: 5 })).rejects.toBeInstanceOf(ValidationError);
  });
});
