jest.mock('../../repositories', () => ({}));

const { AttendanceService } = require('../../services/AttendanceService');
const { ConflictError, ValidationError } = require('../../utils/errors');
const { record, updatingRepo } = require('../helpers');

const build = (shift = { startTime: '00:00:00', endTime: '23:59:59', graceMinutes: 15 }) => {
  const deps = {
    attendanceRepository: updatingRepo({
      findForDay: jest.fn().mockResolvedValue(null),
      findByIdInOrg: jest.fn()
    }),
    shiftRepository: { findDefault: jest.fn().mockResolvedValue(shift) },
    leaveRepository: {},
    userRepository: {},
    organizationRepository: {},
    auditLogRepository: { record: jest.fn() },
    publish: jest.fn()
  };
  return { service: new AttendanceService(deps), deps };
};

describe('AttendanceService.checkIn', () => {
  it('marks a check-in after shift start + grace as LATE (shift times as HH:MM:SS)', async () => {
    const { service, deps } = build();

    const log = await service.checkIn('emp-1', 'org-1');

    expect(log.attendanceType).toBe('LATE');
    expect(log.lateMinutes).toBeGreaterThan(0);
    expect(deps.publish).toHaveBeenCalledWith('ATTENDANCE_CHECKED_IN', 'org-1', expect.objectContaining({ attendanceType: 'LATE', userId: 'emp-1' }));
  });

  it('is PRESENT before the shift starts', async () => {
    const { service } = build({ startTime: '23:59:00', endTime: '23:59:59', graceMinutes: 0 });

    const log = await service.checkIn('emp-1', 'org-1');

    expect(log.attendanceType).toBe('PRESENT');
    expect(log.lateMinutes).toBe(0);
  });

  it('409s on a second check-in', async () => {
    const { service, deps } = build();
    deps.attendanceRepository.findForDay.mockResolvedValue(record({ checkInTime: '09:00:00' }));

    await expect(service.checkIn('emp-1', 'org-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('fills in a day row that already exists without a check-in (e.g. approved WFH)', async () => {
    const { service, deps } = build();
    const existing = record({ id: 'log-1', attendanceType: 'WORK_FROM_HOME', checkInTime: null });
    deps.attendanceRepository.findForDay.mockResolvedValue(existing);

    await service.checkIn('emp-1', 'org-1');

    expect(deps.attendanceRepository.update).toHaveBeenCalledWith(existing, expect.objectContaining({ checkInTime: expect.any(String) }));
    expect(deps.attendanceRepository.create).not.toHaveBeenCalled();
  });
});

describe('AttendanceService.checkOut', () => {
  it('requires a check-in first', async () => {
    const { service, deps } = build();

    await expect(service.checkOut('emp-1', 'org-1')).rejects.toBeInstanceOf(ValidationError);

    // A WFH row with no check-in is still "not checked in"
    deps.attendanceRepository.findForDay.mockResolvedValue(record({ checkInTime: null }));
    await expect(service.checkOut('emp-1', 'org-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('records early-leave minutes against the shift end', async () => {
    const { service, deps } = build();
    deps.attendanceRepository.findForDay.mockResolvedValue(record({
      checkInTime: '00:00:01',
      checkInTimestamp: new Date(Date.now() - 3600e3).toISOString()
    }));

    const log = await service.checkOut('emp-1', 'org-1');

    expect(log.earlyLeaveMinutes).toBeGreaterThan(0);
    expect(log.workingMinutes).toBe(60);
  });
});

describe('AttendanceService.bulkUpdateAttendance', () => {
  it('never moves a record to another user or organization', async () => {
    const { service, deps } = build();
    const existing = record({ id: 'log-1', userId: 'emp-1', organizationId: 'org-1' });
    deps.attendanceRepository.findByIdInOrg.mockResolvedValue(existing);

    await service.bulkUpdateAttendance([{ id: 'log-1', userId: 'emp-9', organizationId: 'org-9', notes: 'fixed' }], 'adm-1', 'org-1');

    expect(deps.attendanceRepository.findByIdInOrg).toHaveBeenCalledWith('log-1', 'org-1');
    expect(deps.attendanceRepository.update).toHaveBeenCalledWith(existing, { notes: 'fixed' });
  });
});
