jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { LeaveService, DEFAULT_ALLOCATIONS } = require('../../services/LeaveService');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../../utils/errors');
const { dayFromToday, users, updatingRepo } = require('../helpers');

const pendingLeave = (overrides = {}) => ({
  id: 'leave-1',
  organizationId: 'org-1',
  userId: 'emp-1',
  leaveType: 'ANNUAL',
  startDate: dayFromToday(5),
  endDate: dayFromToday(6),
  status: 'PENDING',
  metadata: {},
  ...overrides
});

const build = () => {
  const deps = {
    leaveRepository: updatingRepo({
      findOverlapping: jest.fn().mockResolvedValue(null),
      findByIdInOrg: jest.fn(),
      findForYear: jest.fn().mockResolvedValue([])
    }),
    leavePolicyRepository: {
      findForType: jest.fn().mockResolvedValue(null),
      findActiveForOrg: jest.fn().mockResolvedValue([])
    },
    userRepository: { findById: jest.fn().mockResolvedValue({ id: 'emp-1', managerId: 'mgr-1' }) },
    auditLogRepository: { record: jest.fn() },
    notifier: { notify: jest.fn() },
    publish: jest.fn()
  };
  return { service: new LeaveService(deps), deps };
};

const application = (overrides = {}) => ({
  startDate: dayFromToday(5), endDate: dayFromToday(6), leaveType: 'ANNUAL', reason: 'Family function', ...overrides
});

describe('LeaveService.applyLeave', () => {
  it('creates a 2-day request and notifies the manager', async () => {
    const { service, deps } = build();

    const leave = await service.applyLeave(users.employee, application());

    expect(leave.dayCount).toBe(2);
    expect(deps.notifier.notify).toHaveBeenCalledWith('mgr-1', 'org-1', expect.objectContaining({ title: 'New leave request' }));
  });

  it('rejects missing fields and overlapping requests', async () => {
    const { service, deps } = build();

    await expect(service.applyLeave(users.employee, { reason: 'x' })).rejects.toBeInstanceOf(ValidationError);

    deps.leaveRepository.findOverlapping.mockResolvedValue(pendingLeave());
    await expect(service.applyLeave(users.employee, application())).rejects.toBeInstanceOf(ConflictError);
  });

  it('blocks a request larger than the configured balance', async () => {
    const { service, deps } = build();
    const policy = { leaveType: 'ANNUAL', annualAllocation: '2', carryForwardMax: '0', allowNegativeBalance: false, isActive: true };
    deps.leavePolicyRepository.findForType.mockResolvedValue(policy);
    deps.leavePolicyRepository.findActiveForOrg.mockResolvedValue([policy]);
    deps.leaveRepository.findForYear.mockResolvedValue([{ leaveType: 'ANNUAL', dayCount: '1', status: 'APPROVED' }]);

    await expect(service.applyLeave(users.employee, application())).rejects.toThrow('Insufficient ANNUAL leave balance: 1 day(s) remaining, 2 requested');
  });

  it('does not enforce a balance when HR has not configured a policy', async () => {
    const { service } = build();

    await expect(service.applyLeave(users.employee, application({ endDate: dayFromToday(40) }))).resolves.toBeDefined();
  });
});

describe('LeaveService approval rules', () => {
  it('refuses self-approval and non-direct-report approval', async () => {
    const { service, deps } = build();

    deps.leaveRepository.findByIdInOrg.mockResolvedValue(pendingLeave({ userId: 'hr-1' }));
    await expect(service.approveLeave('leave-1', users.hr)).rejects.toBeInstanceOf(ForbiddenError);

    deps.leaveRepository.findByIdInOrg.mockResolvedValue(pendingLeave());
    await expect(service.approveLeave('leave-1', users.otherManager)).rejects.toThrow('direct reports');
  });

  it('approves for the direct manager and publishes APPROVED', async () => {
    const { service, deps } = build();
    deps.leaveRepository.findByIdInOrg.mockResolvedValue(pendingLeave());

    const leave = await service.approveLeave('leave-1', users.manager, 'Enjoy');

    expect(leave.status).toBe('APPROVED');
    expect(leave.metadata.approverComments).toBe('Enjoy');
    expect(deps.publish).toHaveBeenCalledWith('LEAVE_APPROVED', 'org-1', expect.objectContaining({ leaveRequestId: 'leave-1', approvedBy: 'mgr-1' }));
  });

  it('404s outside the organization and requires comments to reject', async () => {
    const { service, deps } = build();
    deps.leaveRepository.findByIdInOrg.mockResolvedValue(null);

    await expect(service.approveLeave('leave-1', users.hr)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.rejectLeave('leave-1', users.hr, '')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('LeaveService.getLeaveBalance', () => {
  it('falls back to the default allocations', async () => {
    const { service } = build();

    const balances = await service.getLeaveBalance('emp-1', 'org-1', 2026);

    expect(balances.map(b => b.leaveType)).toEqual(Object.keys(DEFAULT_ALLOCATIONS));
    expect(balances.every(b => b.isConfigured === false)).toBe(true);
  });

  it('adds capped carry-forward and subtracts used + pending', async () => {
    const { service, deps } = build();
    deps.leavePolicyRepository.findActiveForOrg.mockResolvedValue([
      { leaveType: 'ANNUAL', annualAllocation: '18.0', carryForwardMax: '5.0', allowNegativeBalance: false }
    ]);
    deps.leaveRepository.findForYear.mockImplementation(async (u, o, year) => (year === 2026
      ? [{ leaveType: 'ANNUAL', dayCount: '3', status: 'APPROVED' }, { leaveType: 'ANNUAL', dayCount: '2', status: 'PENDING' }]
      : [{ leaveType: 'ANNUAL', dayCount: '10', status: 'APPROVED' }]));

    const [annual] = await service.getLeaveBalance('emp-1', 'org-1', 2026);

    // 18 allocated + min(5, 18 - 10) carried - 3 used - 2 pending
    expect(annual).toEqual(expect.objectContaining({ allocated: 18, carried: 5, used: 3, pending: 2, remaining: 18 }));
  });
});
