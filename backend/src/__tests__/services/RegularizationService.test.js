jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { RegularizationService, REGULARIZATION_WINDOW_DAYS } = require('../../services/RegularizationService');
const { ValidationError, ConflictError, ForbiddenError } = require('../../utils/errors');
const { dayFromToday, users, record, updatingRepo } = require('../helpers');

const build = () => {
  const deps = {
    regularizationRepository: updatingRepo({
      findPendingForDay: jest.fn().mockResolvedValue(null),
      findByIdInOrg: jest.fn()
    }),
    attendanceRepository: updatingRepo({
      findForDay: jest.fn().mockResolvedValue(null),
      findOrCreateForDay: jest.fn()
    }),
    leaveRepository: { findApprovedCovering: jest.fn().mockResolvedValue(null) },
    shiftRepository: { findDefault: jest.fn().mockResolvedValue({ startTime: '09:00:00', endTime: '18:00:00', graceMinutes: 15 }) },
    userRepository: { findById: jest.fn().mockResolvedValue({ id: 'emp-1', managerId: 'mgr-1' }) },
    auditLogRepository: { record: jest.fn() },
    notifier: { notify: jest.fn() },
    publish: jest.fn()
  };
  return { service: new RegularizationService(deps), deps };
};

const markPresent = (overrides = {}) => ({
  date: dayFromToday(-2), requestType: 'MARK_PRESENT', requestedCheckIn: '09:40', requestedCheckOut: '18:10', reason: 'Forgot to punch', ...overrides
});

describe('RegularizationService.applyRegularization', () => {
  it('accepts a valid request and normalizes HH:MM to HH:MM:SS', async () => {
    const { service, deps } = build();

    await service.applyRegularization(users.employee, markPresent());

    expect(deps.regularizationRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      requestedCheckIn: '09:40:00', requestedCheckOut: '18:10:00', status: 'PENDING'
    }));
  });

  it.each([
    ['a future date', markPresent({ date: dayFromToday(1) }), 'future date'],
    ['a date outside the window', markPresent({ date: dayFromToday(-(REGULARIZATION_WINDOW_DAYS + 1)) }), 'last 30 days'],
    ['check-out before check-in', markPresent({ requestedCheckIn: '18:00', requestedCheckOut: '09:00' }), 'after check-in'],
    ['WRONG_TIME without any time', { date: dayFromToday(-1), requestType: 'WRONG_TIME', reason: 'wrong wrong' }, 'check-in and/or check-out']
  ])('rejects %s', async (_label, body, message) => {
    const { service } = build();

    await expect(service.applyRegularization(users.employee, body)).rejects.toThrow(message);
  });

  it('rejects a day already pending or covered by approved leave', async () => {
    const { service, deps } = build();

    deps.regularizationRepository.findPendingForDay.mockResolvedValue({ id: 'r0' });
    await expect(service.applyRegularization(users.employee, markPresent())).rejects.toBeInstanceOf(ConflictError);

    deps.regularizationRepository.findPendingForDay.mockResolvedValue(null);
    deps.leaveRepository.findApprovedCovering.mockResolvedValue({ id: 'leave-1' });
    await expect(service.applyRegularization(users.employee, markPresent())).rejects.toThrow('approved leave');
  });

  it('needs an existing record for WRONG_TIME', async () => {
    const { service } = build();

    await expect(service.applyRegularization(users.employee, { ...markPresent(), requestType: 'WRONG_TIME' }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('RegularizationService.approveRegularization', () => {
  it('rewrites the attendance log, keeps the old values and publishes REGULARIZED', async () => {
    const { service, deps } = build();
    const request = record({ id: 'r1', userId: 'emp-1', date: '2026-09-20', status: 'PENDING', requestedCheckIn: '09:40:00', requestedCheckOut: '18:10:00' });
    const log = record({ id: 'log-1', attendanceType: 'ABSENT', checkInTime: null, checkOutTime: null, metadata: {} });
    deps.regularizationRepository.findByIdInOrg.mockResolvedValue(request);
    deps.attendanceRepository.findOrCreateForDay.mockResolvedValue(log);

    await service.approveRegularization('r1', users.manager);

    expect(log).toEqual(expect.objectContaining({ attendanceType: 'LATE', lateMinutes: 40, workingMinutes: 510, earlyLeaveMinutes: 0 }));
    expect(log.metadata).toEqual({ regularized: true, regularizationRequestId: 'r1' });
    expect(request.previousValues).toEqual(expect.objectContaining({ attendanceType: 'ABSENT', checkInTime: null }));
    expect(deps.publish).toHaveBeenCalledWith('REGULARIZATION_APPROVED', 'org-1', expect.objectContaining({ checkInTime: '09:40:00', lateMinutes: 40, approvedBy: 'mgr-1' }));
  });

  it('keeps a WFH day as WFH', async () => {
    const { service } = build();

    const values = await service.computeAttendance('org-1', '2026-09-20', '09:10:00', '17:30:00', 'WORK_FROM_HOME');

    expect(values).toEqual(expect.objectContaining({ attendanceType: 'WORK_FROM_HOME', earlyLeaveMinutes: 30, workingMinutes: 500 }));
  });

  it('refuses self-approval', async () => {
    const { service, deps } = build();
    deps.regularizationRepository.findByIdInOrg.mockResolvedValue(record({ id: 'r1', userId: 'hr-1', status: 'PENDING' }));

    await expect(service.approveRegularization('r1', users.hr)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
