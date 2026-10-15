// Importing the real modules would open Kafka/Redis/Postgres connections - the service under
// test gets fakes through its constructor instead, so these are stubbed out entirely.
jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { WfhService, MONTHLY_WFH_QUOTA } = require('../../services/WfhService');
const { ValidationError, ConflictError, NotFoundError, ForbiddenError } = require('../../utils/errors');

// YYYY-MM-DD `days` from today, in local time
const dayFromToday = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const employee = { id: 'emp-1', organizationId: 'org-1', role: 'EMPLOYEE', name: 'Asha', managerId: 'mgr-1' };
const manager = { id: 'mgr-1', organizationId: 'org-1', role: 'MANAGER', name: 'Ravi' };
const otherManager = { id: 'mgr-2', organizationId: 'org-1', role: 'MANAGER', name: 'Kiran' };
const hr = { id: 'hr-1', organizationId: 'org-1', role: 'HR', name: 'Meera' };

const pendingRequest = (overrides = {}) => ({
  id: 'wfh-1',
  organizationId: 'org-1',
  userId: 'emp-1',
  startDate: dayFromToday(1),
  endDate: dayFromToday(3),
  isHalfDay: false,
  status: 'PENDING',
  ...overrides
});

const build = () => {
  const deps = {
    wfhRepository: {
      findOverlapping: jest.fn().mockResolvedValue(null),
      findApprovedWithin: jest.fn().mockResolvedValue([]),
      findForUser: jest.fn().mockResolvedValue([]),
      findPending: jest.fn().mockResolvedValue([]),
      findByIdInOrg: jest.fn(),
      create: jest.fn(async (data) => ({ id: 'wfh-new', ...data })),
      update: jest.fn(async (instance, changes) => ({ ...instance, ...changes }))
    },
    leaveRepository: { findOverlapping: jest.fn().mockResolvedValue(null) },
    attendanceRepository: { setAttendanceType: jest.fn().mockResolvedValue({}) },
    userRepository: { findById: jest.fn().mockResolvedValue({ id: 'emp-1', managerId: 'mgr-1' }) },
    auditLogRepository: { record: jest.fn().mockResolvedValue({}) },
    notifier: { notify: jest.fn().mockResolvedValue({}) },
    publish: jest.fn().mockResolvedValue(true)
  };
  return { service: new WfhService(deps), deps };
};

describe('WfhService.applyWfh', () => {
  const body = () => ({ startDate: dayFromToday(1), endDate: dayFromToday(2), reason: 'Plumber visit' });

  it('creates the request, audits it, notifies the manager and publishes APPLIED', async () => {
    const { service, deps } = build();

    const result = await service.applyWfh(employee, body());

    expect(result.status).toBe('PENDING');
    expect(deps.wfhRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'emp-1', organizationId: 'org-1', status: 'PENDING'
    }));
    expect(deps.auditLogRepository.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'WFH_REQUEST', action: 'CREATE' }));
    expect(deps.notifier.notify).toHaveBeenCalledWith('mgr-1', 'org-1', expect.objectContaining({ link: '/wfh' }));
    expect(deps.publish).toHaveBeenCalledWith('WFH_APPLIED', 'org-1', expect.objectContaining({ wfhRequestId: 'wfh-new', isHalfDay: false }));
  });

  it('skips the manager notification when the employee has no manager', async () => {
    const { service, deps } = build();

    await service.applyWfh({ ...employee, managerId: null }, body());

    expect(deps.notifier.notify).not.toHaveBeenCalled();
  });

  it('rejects a past date', async () => {
    const { service, deps } = build();

    await expect(service.applyWfh(employee, { ...body(), startDate: dayFromToday(-2), endDate: dayFromToday(-1) }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(deps.wfhRepository.create).not.toHaveBeenCalled();
  });

  it('rejects start after end', async () => {
    const { service } = build();

    await expect(service.applyWfh(employee, { ...body(), startDate: dayFromToday(3), endDate: dayFromToday(1) }))
      .rejects.toThrow('Start date cannot be after end date');
  });

  it('rejects an overlapping WFH request with 409', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findOverlapping.mockResolvedValue(pendingRequest());

    const error = await service.applyWfh(employee, body()).catch(e => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.statusCode).toBe(409);
  });

  it('rejects dates that overlap a leave request', async () => {
    const { service, deps } = build();
    deps.leaveRepository.findOverlapping.mockResolvedValue({ id: 'leave-1' });

    await expect(service.applyWfh(employee, body())).rejects.toThrow('overlap an existing leave request');
  });

  it('rejects a request that would exceed the monthly quota', async () => {
    const { service, deps } = build();
    // Already used the full quota as one approved single-day request per day
    const used = Array.from({ length: MONTHLY_WFH_QUOTA }, () => ({ isHalfDay: false, startDate: '2026-01-01', endDate: '2026-01-01' }));
    deps.wfhRepository.findApprovedWithin.mockResolvedValue(used);

    await expect(service.applyWfh(employee, body())).rejects.toThrow('exceed the monthly WFH quota');
  });
});

describe('WfhService.approveWfh', () => {
  it('lets a manager approve a direct report and marks every covered day as WFH', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findByIdInOrg.mockResolvedValue(pendingRequest());

    const result = await service.approveWfh('wfh-1', manager);

    expect(result).toEqual(expect.objectContaining({ status: 'APPROVED', approvedBy: 'mgr-1' }));
    expect(deps.attendanceRepository.setAttendanceType).toHaveBeenCalledTimes(3);
    expect(deps.attendanceRepository.setAttendanceType).toHaveBeenCalledWith('org-1', 'emp-1', dayFromToday(1), 'WORK_FROM_HOME');
    expect(deps.notifier.notify).toHaveBeenCalledWith('emp-1', 'org-1', expect.objectContaining({ title: 'WFH request approved' }));
    expect(deps.publish).toHaveBeenCalledWith('WFH_APPROVED', 'org-1', expect.objectContaining({ approvedBy: 'mgr-1' }));
  });

  it('looks the request up scoped to the approver organization', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findByIdInOrg.mockResolvedValue(null);

    await expect(service.approveWfh('wfh-1', { ...hr, organizationId: 'org-2' })).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.wfhRepository.findByIdInOrg).toHaveBeenCalledWith('wfh-1', 'org-2', { lock: true });
  });

  it('refuses a request that is no longer pending', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findByIdInOrg.mockResolvedValue(pendingRequest({ status: 'APPROVED' }));

    await expect(service.approveWfh('wfh-1', hr)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses self-approval, even for HR', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findByIdInOrg.mockResolvedValue(pendingRequest({ userId: 'hr-1' }));

    await expect(service.approveWfh('wfh-1', hr)).rejects.toBeInstanceOf(ForbiddenError);
    expect(deps.wfhRepository.update).not.toHaveBeenCalled();
  });

  it("refuses a manager acting on someone else's report", async () => {
    const { service, deps } = build();
    deps.wfhRepository.findByIdInOrg.mockResolvedValue(pendingRequest());

    await expect(service.approveWfh('wfh-1', otherManager)).rejects.toThrow('direct reports');
  });

  it('lets HR approve anyone in the organization without the direct-report check', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findByIdInOrg.mockResolvedValue(pendingRequest());

    await service.approveWfh('wfh-1', hr);

    expect(deps.userRepository.findById).not.toHaveBeenCalled();
  });
});

describe('WfhService.rejectWfh', () => {
  it('requires a rejection reason', async () => {
    const { service } = build();

    await expect(service.rejectWfh('wfh-1', hr, '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('records the reason, does not touch attendance, and publishes REJECTED', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findByIdInOrg.mockResolvedValue(pendingRequest());

    const result = await service.rejectWfh('wfh-1', hr, 'Team offsite that week');

    expect(result).toEqual(expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Team offsite that week' }));
    expect(deps.attendanceRepository.setAttendanceType).not.toHaveBeenCalled();
    expect(deps.publish).toHaveBeenCalledWith('WFH_REJECTED', 'org-1', expect.objectContaining({ rejectedBy: 'hr-1' }));
  });
});

describe('WfhService queries', () => {
  it('scopes pending requests to direct reports for managers only', async () => {
    const { service, deps } = build();

    await service.getPendingWfhRequests(manager);
    await service.getPendingWfhRequests(hr);

    expect(deps.wfhRepository.findPending).toHaveBeenNthCalledWith(1, 'org-1', 'mgr-1');
    expect(deps.wfhRepository.findPending).toHaveBeenNthCalledWith(2, 'org-1', null);
  });

  it('counts half days as 0.5 in the monthly quota', async () => {
    const { service, deps } = build();
    deps.wfhRepository.findApprovedWithin.mockResolvedValue([
      { isHalfDay: true, startDate: '2026-03-02', endDate: '2026-03-02' },
      { isHalfDay: false, startDate: '2026-03-10', endDate: '2026-03-12' }
    ]);

    const quota = await service.getMonthlyQuotaUsage('emp-1', 'org-1', 3, 2026);

    expect(quota).toEqual({ used: 3.5, quota: MONTHLY_WFH_QUOTA, remaining: MONTHLY_WFH_QUOTA - 3.5 });
    expect(deps.wfhRepository.findApprovedWithin).toHaveBeenCalledWith('emp-1', 'org-1', '2026-03-01', '2026-03-31');
  });
});
