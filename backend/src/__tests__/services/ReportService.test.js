jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { ReportService, pivotLeaveRows } = require('../../services/ReportService');
const { users, dayFromToday } = require('../helpers');

const quiet = { error: jest.fn(), info: jest.fn() };

const build = (overrides = {}) => {
  const log = [];
  const deps = {
    reportRepository: {
      create: jest.fn(async () => { log.push('INSERT report'); return true; }),
      findInOrg: jest.fn(async (id) => ({ id, status: 'PENDING' })),
      findForGeneration: jest.fn(),
      markReady: jest.fn(),
      markFailed: jest.fn(),
      list: jest.fn().mockResolvedValue([])
    },
    analyticsRepository: {
      attendanceSummaryRows: jest.fn().mockResolvedValue([
        { employeeId: 'E1', name: 'Asha', department: 'Eng', workingDays: 20, daysPresent: 18, daysLate: 2, daysWfh: 3, leaveDays: 2, overtimeHours: 4.5 },
        { employeeId: 'E2', name: 'Ravi', department: 'Eng', workingDays: 20, daysPresent: 15, daysLate: 0, daysWfh: 0, leaveDays: 0, overtimeHours: 0 }
      ]),
      leaveSummaryRows: jest.fn().mockResolvedValue([])
    },
    organizationRepository: { findAllActive: jest.fn().mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]) },
    userRepository: { findActiveByRoles: jest.fn().mockResolvedValue([{ id: 'hr-1' }, { id: 'adm-1' }]) },
    attendanceService: { getDefaultShift: jest.fn().mockResolvedValue({ workingDays: [1, 2, 3, 4, 5] }) },
    notifier: { notify: jest.fn(), notifyMany: jest.fn() },
    publish: jest.fn(async () => { log.push('INSERT outbox_event'); }),
    withTransaction: jest.fn(async (fn) => { log.push('BEGIN'); const r = await fn(); log.push('COMMIT'); return r; }),
    newId: () => 'report-1',
    now: () => new Date(2026, 9, 8, 2, 0), // 2026-10-08 02:00 local
    logger: quiet
  };
  Object.entries(overrides).forEach(([k, v]) => { deps[k] = { ...deps[k], ...v }; });
  return { service: new ReportService(deps), deps, log };
};

describe('ReportService.requestReport', () => {
  const valid = { reportType: 'attendance-summary', from: dayFromToday(-30), to: dayFromToday(-1) };

  it('stores the PENDING report and its REPORT_REQUESTED event in one transaction', async () => {
    const { service, deps, log } = build();

    await service.requestReport(users.hr, valid);

    expect(log).toEqual(['BEGIN', 'INSERT report', 'INSERT outbox_event', 'COMMIT']);
    expect(deps.reportRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'report-1', organizationId: 'org-1', scopeManagerId: null, requestedBy: 'hr-1'
    }));
    expect(deps.publish).toHaveBeenCalledWith('REPORT_REQUESTED', 'org-1', {
      reportId: 'report-1', reportType: 'attendance-summary', periodStart: valid.from, periodEnd: valid.to, requestedBy: 'hr-1'
    });
  });

  it('scopes a manager\'s report to their own team', async () => {
    const { service, deps } = build();

    await service.requestReport(users.manager, valid);

    expect(deps.reportRepository.create).toHaveBeenCalledWith(expect.objectContaining({ scopeManagerId: 'mgr-1' }));
  });

  it('rejects unknown types, reversed or future ranges, and ranges over a year', async () => {
    const { service, deps } = build();

    await expect(service.requestReport(users.hr, { ...valid, reportType: 'salaries' })).rejects.toThrow('reportType must be one of');
    await expect(service.requestReport(users.hr, { ...valid, from: valid.to, to: valid.from })).rejects.toThrow('from must be on or before to');
    await expect(service.requestReport(users.hr, { ...valid, to: dayFromToday(3) })).rejects.toThrow('up to today');
    await expect(service.requestReport(users.hr, { ...valid, from: dayFromToday(-400) })).rejects.toThrow('at most 366 days');
    expect(deps.reportRepository.create).not.toHaveBeenCalled();
  });
});

describe('ReportService.generate (report worker)', () => {
  const pending = {
    id: 'report-1', organizationId: 'org-1', reportType: 'attendance-summary', periodStart: '2026-09-01',
    periodEnd: '2026-09-30', scopeManagerId: null, requestedBy: 'hr-1', status: 'PENDING'
  };

  it('builds the CSV, stores it READY, then notifies the requester after commit', async () => {
    const { service, deps, log } = build({ reportRepository: { findForGeneration: jest.fn().mockResolvedValue(pending) } });
    deps.notifier.notify.mockImplementation(async () => log.push('notify'));
    deps.reportRepository.markReady.mockImplementation(async () => log.push('UPDATE ready'));

    const result = await service.generate('report-1');

    expect(log).toEqual(['BEGIN', 'UPDATE ready', 'COMMIT', 'notify']);
    const [, stored] = deps.reportRepository.markReady.mock.calls[0];
    expect(stored.rowCount).toBe(2);
    expect(stored.content.split('\n')[0]).toContain('employeeId,name,department');
    expect(stored.content.split('\n')[0]).toContain('attendanceRate');
    expect(stored.summary).toEqual({
      employees: 2, avgAttendanceRate: 87.5, totalLateDays: 2, totalWfhDays: 3, totalLeaveDays: 2, totalOvertimeHours: 4.5
    });
    expect(result.rowCount).toBe(2);
    expect(deps.notifier.notify).toHaveBeenCalledWith('hr-1', 'org-1', expect.objectContaining({ category: 'SYSTEM', metadata: { reportId: 'report-1' } }));
  });

  it('a redelivered event finds the report already READY and does nothing', async () => {
    const { service, deps } = build({ reportRepository: { findForGeneration: jest.fn().mockResolvedValue({ ...pending, status: 'READY' }) } });

    expect(await service.generate('report-1')).toEqual(expect.objectContaining({ skipped: true }));
    expect(deps.reportRepository.markReady).not.toHaveBeenCalled();
    expect(deps.notifier.notify).not.toHaveBeenCalled();
  });

  it('a scheduled report (no requester) notifies the organization\'s HR and admins', async () => {
    const { service, deps } = build({ reportRepository: { findForGeneration: jest.fn().mockResolvedValue({ ...pending, requestedBy: null }) } });

    await service.generate('report-1');

    expect(deps.userRepository.findActiveByRoles).toHaveBeenCalledWith('org-1', ['HR', 'ADMIN']);
    expect(deps.notifier.notifyMany).toHaveBeenCalledWith(['hr-1', 'adm-1'], 'org-1', expect.any(Object));
  });

  it('a deterministic failure is recorded on the report (FAILED), not retried', async () => {
    const { service, deps } = build({
      reportRepository: { findForGeneration: jest.fn().mockResolvedValue(pending) },
      analyticsRepository: { attendanceSummaryRows: jest.fn().mockRejectedValue(new Error('column "x" does not exist')) }
    });

    expect(await service.generate('report-1')).toEqual({ failed: true, error: 'column "x" does not exist' });
    expect(deps.reportRepository.markFailed).toHaveBeenCalledWith('report-1', 'column "x" does not exist');
  });

  it('a database outage is thrown, so the consumer retries (and dead-letters if it persists)', async () => {
    const outage = Object.assign(new Error('connect ECONNREFUSED'), { name: 'SequelizeConnectionRefusedError' });
    const { service, deps } = build({ reportRepository: { findForGeneration: jest.fn().mockRejectedValue(outage) } });

    await expect(service.generate('report-1')).rejects.toThrow('ECONNREFUSED');
    expect(deps.reportRepository.markFailed).not.toHaveBeenCalled();
  });
});

describe('ReportService.scheduleMonthlyReports', () => {
  it('queues last month\'s attendance summary per org, publishing only for newly created reports', async () => {
    const { service, deps } = build({ reportRepository: { create: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) } });

    const result = await service.scheduleMonthlyReports();

    expect(result).toEqual({ period: '2026-09-01..2026-09-30', organizations: 2, queued: 1 });
    expect(deps.reportRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', reportType: 'attendance-summary', periodStart: '2026-09-01', periodEnd: '2026-09-30'
    }));
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(deps.publish.mock.calls[0][2].requestedBy).toBeNull();
  });
});

describe('ReportService reading', () => {
  it('managers only list and open their own team\'s reports', async () => {
    const { service, deps } = build({ reportRepository: { findInOrg: jest.fn().mockResolvedValue({ id: 'r-1', scopeManagerId: null, status: 'READY' }) } });

    await service.list(users.manager);
    expect(deps.reportRepository.list).toHaveBeenCalledWith({ organizationId: 'org-1', scopeManagerId: 'mgr-1' });
    await expect(service.get(users.manager, 'r-1')).rejects.toThrow("own team's reports");
    await expect(service.get(users.hr, 'r-1')).resolves.toEqual(expect.objectContaining({ id: 'r-1' }));
  });

  it('only a READY report can be downloaded', async () => {
    const { service } = build({ reportRepository: { findInOrg: jest.fn().mockResolvedValue({ id: 'r-1', scopeManagerId: null, status: 'PENDING' }) } });

    await expect(service.getDownload(users.hr, 'r-1')).rejects.toThrow('Report is pending, not ready to download');
  });

  it('a report from another organization is not found', async () => {
    const { service } = build({ reportRepository: { findInOrg: jest.fn().mockResolvedValue(null) } });

    await expect(service.get(users.hr, 'r-x')).rejects.toThrow('Report not found');
  });
});

describe('pivotLeaveRows', () => {
  it('one row per employee, a column per leave type taken, same columns on every row', () => {
    const { rows, summary } = pivotLeaveRows([
      { userId: 'u1', employeeId: 'E1', name: 'Asha', department: 'Eng', leaveType: 'SICK', status: 'APPROVED', days: 2 },
      { userId: 'u1', employeeId: 'E1', name: 'Asha', department: 'Eng', leaveType: 'ANNUAL', status: 'APPROVED', days: 3 },
      { userId: 'u1', employeeId: 'E1', name: 'Asha', department: 'Eng', leaveType: 'ANNUAL', status: 'PENDING', days: 1 },
      { userId: 'u2', employeeId: 'E2', name: 'Ravi', department: 'Ops', leaveType: null, status: null, days: 0 }
    ]);

    expect(rows).toEqual([
      { employeeId: 'E1', name: 'Asha', department: 'Eng', ANNUAL: 3, SICK: 2, totalApprovedDays: 5, pendingDays: 1 },
      { employeeId: 'E2', name: 'Ravi', department: 'Ops', ANNUAL: 0, SICK: 0, totalApprovedDays: 0, pendingDays: 0 }
    ]);
    expect(summary).toEqual({ employees: 2, employeesWithLeave: 1, totalApprovedDays: 5, totalPendingDays: 1, byType: { ANNUAL: 3, SICK: 2 } });
  });
});
