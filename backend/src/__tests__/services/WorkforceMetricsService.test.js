jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { WorkforceMetricsService, lastMonths } = require('../../services/WorkforceMetricsService');
const { LeaveService } = require('../../services/LeaveService');
const { memberScope } = require('../../services/analyticsScope');
const { toCsv } = require('../../utils/csv');
const { users } = require('../helpers');

const build = (analytics = {}) => {
  const deps = {
    analyticsRepository: {
      workMode: jest.fn().mockResolvedValue([]),
      wfhRequestsByStatus: jest.fn().mockResolvedValue([]),
      approvalTurnaround: jest.fn().mockResolvedValue([]),
      approvalTurnaroundByApprover: jest.fn().mockResolvedValue([]),
      overtime: jest.fn().mockResolvedValue([]),
      topOvertime: jest.fn().mockResolvedValue([]),
      joinersByMonth: jest.fn().mockResolvedValue([]),
      exitsByMonth: jest.fn().mockResolvedValue([]),
      headcountAndTenure: jest.fn().mockResolvedValue([]),
      personalAttendance: jest.fn(),
      workingAndLeaveDays: jest.fn(),
      ...analytics
    },
    userRepository: { findActiveMemberIds: jest.fn().mockResolvedValue(['emp-1', 'emp-2']) },
    attendanceService: { getDefaultShift: jest.fn().mockResolvedValue(null) },
    leaveService: { getLeaveBalance: jest.fn().mockResolvedValue([]), getLeaveUtilization: jest.fn() },
    now: () => new Date(2026, 9, 8)
  };
  return { service: new WorkforceMetricsService(deps), deps };
};

describe('analytics scope', () => {
  it('HR/Admin: whole org (null, filtered by organization in SQL); manager: direct reports; employee: self', async () => {
    const userRepository = { findActiveMemberIds: jest.fn().mockResolvedValue(['emp-1']) };

    expect(await memberScope(users.hr, userRepository)).toBeNull();
    expect(await memberScope(users.admin, userRepository)).toBeNull();
    expect(await memberScope(users.manager, userRepository)).toEqual(['emp-1']);
    expect(userRepository.findActiveMemberIds).toHaveBeenCalledWith('org-1', 'mgr-1');
    expect(await memberScope(users.employee, userRepository)).toEqual(['emp-1']);
  });

  it('every metric query gets the caller\'s scope', async () => {
    const { service, deps } = build();

    await service.getWorkMode(users.employee, { period: '30d' });
    await service.getOvertime(users.manager, { period: '90d' });

    expect(deps.analyticsRepository.workMode).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', memberIds: ['emp-1'] }));
    expect(deps.analyticsRepository.overtime).toHaveBeenCalledWith(expect.objectContaining({ memberIds: ['emp-1', 'emp-2'], standardMinutes: 480 }));
  });
});

describe('WorkforceMetricsService', () => {
  it('work mode: splits the GROUPING SETS rows and computes the WFH share of attended days', async () => {
    const { service } = build({
      workMode: jest.fn().mockResolvedValue([
        { grain: 'department', department: 'Eng', office: 6, wfh: 3, halfDay: 1, absent: 0 },
        { grain: 'total', department: null, week: null, office: 6, wfh: 3, halfDay: 1, absent: 2 },
        { grain: 'week', week: '2026-10-05', office: 6, wfh: 3, halfDay: 1, absent: 2 }
      ]),
      wfhRequestsByStatus: jest.fn().mockResolvedValue([{ status: 'APPROVED', requests: 2, days: 3 }])
    });

    const result = await service.getWorkMode(users.hr, { period: '30d' });

    expect(result.scope).toBe('organization');
    expect(result.summary).toEqual({ office: 6, wfh: 3, halfDay: 1, absent: 2, wfhRate: 30 });
    expect(result.byDepartment).toEqual([{ department: 'Eng', office: 6, wfh: 3, halfDay: 1, absent: 0, wfhRate: 30 }]);
    expect(result.weekly[0].week).toBe('2026-10-05');
    expect(result.requests.approved).toEqual({ requests: 2, days: 3 });
    expect(result.requests.pending).toEqual({ requests: 0, days: 0 });
  });

  it('approval turnaround: overall from the ROLLUP row, SLA share, and empty kinds as zeros', async () => {
    const { service } = build({
      approvalTurnaround: jest.fn().mockResolvedValue([
        { kind: 'LEAVE', decided: 4, approved: 3, rejected: 1, avgHours: 30.04, medianHours: 20, p90Hours: 70, withinSla: 2, pending: 1, oldestPendingHours: 50.56 },
        { kind: null, decided: 4, approved: 3, rejected: 1, avgHours: 30.04, medianHours: 20, p90Hours: 70, withinSla: 2, pending: 1, oldestPendingHours: 50.56 }
      ])
    });

    const result = await service.getApprovalTurnaround(users.hr, { period: '90d' });

    expect(result.overall).toEqual({
      decided: 4, approved: 3, rejected: 1, approvalRate: 75, avgHours: 30, medianHours: 20, p90Hours: 70,
      withinSlaRate: 50, pending: 1, oldestPendingHours: 50.6
    });
    expect(result.byKind.WFH).toEqual(expect.objectContaining({ decided: 0, avgHours: null, withinSlaRate: null }));
    expect(result.slaHours).toBe(24);
  });

  it('overtime: employees don\'t get a per-person ranking', async () => {
    const { service, deps } = build();

    await service.getOvertime(users.employee, {});

    expect(deps.analyticsRepository.topOvertime).not.toHaveBeenCalled();
  });

  it('lifecycle: walks back from today\'s headcount to each month\'s closing headcount', async () => {
    const { service } = build({
      joinersByMonth: jest.fn().mockResolvedValue([{ month: '2026-09', count: 3 }, { month: '2026-10', count: 1 }]),
      exitsByMonth: jest.fn().mockResolvedValue([{ month: '2026-09', count: 1 }]),
      headcountAndTenure: jest.fn().mockResolvedValue([
        { department: 'Eng', headcount: 8, under1y: 4, from1to3y: 2, from3to5y: 1, over5y: 1 },
        { department: null, headcount: 12, under1y: 5, from1to3y: 4, from3to5y: 2, over5y: 1 }
      ])
    });

    const result = await service.getLifecycle(users.hr, { months: 3 });

    expect(result.months).toEqual([
      { month: '2026-08', joiners: 0, exits: 0, headcount: 9 },
      { month: '2026-09', joiners: 3, exits: 1, headcount: 11 },
      { month: '2026-10', joiners: 1, exits: 0, headcount: 12 }
    ]);
    expect(result.totals).toEqual({ joiners: 4, exits: 1, netChange: 3, attritionRate: 9.4 });
    expect(result.byDepartment).toEqual([{ department: 'Eng', headcount: 8, tenure: { under1y: 4, from1to3y: 2, from3to5y: 1, over5y: 1 } }]);
  });

  it('my summary: attendance rate against working days minus leave, using the org\'s shift days', async () => {
    const { service, deps } = build({
      personalAttendance: jest.fn().mockResolvedValue({
        recorded: 18, present: 17, late: 2, wfh: 4, halfDay: 1, absent: 1, avgWorkingMinutes: 495, overtimeMinutes: 90, lateMinutes: 30
      }),
      workingAndLeaveDays: jest.fn().mockResolvedValue({ workingDays: 22, leaveDays: 2 })
    });
    deps.attendanceService.getDefaultShift.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });

    const result = await service.getMySummary(users.employee, { period: '30d' });

    expect(deps.analyticsRepository.workingAndLeaveDays).toHaveBeenCalledWith(expect.objectContaining({ userId: 'emp-1', workingDays: [1, 2, 3, 4, 5, 6] }));
    expect(result).toEqual(expect.objectContaining({
      attendanceRate: 85, punctualityRate: 88.2, wfhRate: 23.5, avgWorkingHours: 8.25, overtimeHours: 1.5, avgLateMinutes: 15
    }));
  });

  it('lastMonths lists calendar months across a year boundary', () => {
    expect(lastMonths(3, new Date(2026, 1, 15))).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('LeaveService analytics (SQL rows folded into the chart shapes)', () => {
  const build2 = (rows, extra = {}) => new LeaveService({
    leaveRepository: {},
    leavePolicyRepository: { findActiveForOrg: jest.fn().mockResolvedValue([]) },
    userRepository: { findActiveMemberIds: jest.fn().mockResolvedValue(['a', 'b', 'c', 'd']) },
    auditLogRepository: {},
    notifier: {},
    publish: jest.fn(),
    analyticsRepository: { leaveBreakdown: jest.fn().mockResolvedValue(rows), ...extra }
  });

  it('getLeaveStatistics keeps the existing response shape', async () => {
    const stats = await build2([
      { department: 'Eng', month: '2026-09', status: 'APPROVED', leaveType: 'ANNUAL', requests: 2, days: 5 },
      { department: 'Eng', month: '2026-10', status: 'PENDING', leaveType: 'SICK', requests: 1, days: 1 },
      { department: null, month: '2026-10', status: 'CANCELLED', leaveType: 'ANNUAL', requests: 1, days: 2 }
    ]).getLeaveStatistics('org-1', '1y');

    expect(stats).toEqual({
      totalRequests: 4,
      approved: 2,
      pending: 1,
      rejected: 0,
      typeDistribution: { ANNUAL: 5 },
      departmentStats: { Eng: { total: 3, approved: 2, pending: 1, rejected: 0, cancelled: 0 } },
      monthlyPattern: [
        { month: '2026-09', approved: 2, pending: 0, rejected: 0, cancelled: 0 },
        { month: '2026-10', approved: 0, pending: 1, rejected: 0, cancelled: 1 }
      ]
    });
  });

  it('getLeaveUtilization: days taken vs allocation x headcount, unallocated types without a rate', async () => {
    const service = build2([], {
      approvedLeaveDaysByType: jest.fn().mockResolvedValue([{ leaveType: 'ANNUAL', days: 21 }, { leaveType: 'UNPAID', days: 3 }])
    });

    const result = await service.getLeaveUtilization('org-1', 2026);

    expect(result.headcount).toBe(4);
    expect(result.byType.find(t => t.leaveType === 'ANNUAL')).toEqual({ leaveType: 'ANNUAL', allocatedDays: 84, usedDays: 21, utilizationRate: 25 });
    expect(result.byType.find(t => t.leaveType === 'UNPAID')).toEqual({ leaveType: 'UNPAID', allocatedDays: 0, usedDays: 3, utilizationRate: null });
    expect(result.averageDaysPerEmployee).toBe(6);
  });
});

describe('toCsv', () => {
  it('keeps columns whose first value is null and writes dates as ISO', () => {
    expect(toCsv([{ a: null, b: 1, at: new Date('2026-10-08T00:00:00Z'), nested: { x: 1 } }, { a: 'x', b: 2, at: null }]))
      .toBe('a,b,at\n"","1","2026-10-08T00:00:00.000Z"\n"x","2",""');
  });

  it('neutralizes spreadsheet formulas in text (CSV injection) but leaves numbers alone', () => {
    expect(toCsv([{ name: '=HYPERLINK("http://evil")', delta: -5, note: '+1 day', at: '@sum' }]))
      .toBe('name,delta,note,at\n"\'=HYPERLINK(""http://evil"")","-5","\'+1 day","\'@sum"');
  });
});
