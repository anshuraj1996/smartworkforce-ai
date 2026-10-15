jest.mock('../../repositories', () => ({}));

const { KpiService, derive, MAX_EVENT_RANGE_DAYS } = require('../../services/KpiService');
const { createKpiHandlers, createReportHandlers, KPI_EVENTS } = require('../../workers/handlers/kpiHandlers');
const { users } = require('../helpers');

// "Now" is 2026-10-08 10:00 in Kolkata
const NOW = new Date('2026-10-08T04:30:00Z');
const quiet = { error: jest.fn(), info: jest.fn() };

const build = (overrides = {}) => {
  const kpiRepository = {
    enqueue: jest.fn(),
    claimNext: jest.fn().mockResolvedValue(null),
    recomputeDay: jest.fn(),
    dequeue: jest.fn(),
    postpone: jest.fn(),
    series: jest.fn().mockResolvedValue([]),
    lastComputedAt: jest.fn().mockResolvedValue(null),
    queueSummary: jest.fn().mockResolvedValue({ queued: 0, oldestSeconds: 0 }),
    ...overrides.kpiRepository
  };
  const organizationRepository = {
    findById: jest.fn().mockResolvedValue({ id: 'org-1', timezone: 'Asia/Kolkata' }),
    findAllActive: jest.fn().mockResolvedValue([{ id: 'org-1', timezone: 'Asia/Kolkata' }, { id: 'org-2', timezone: 'America/New_York' }]),
    ...overrides.organizationRepository
  };
  const service = new KpiService({ kpiRepository, organizationRepository, logger: quiet, now: () => NOW });
  return { service, kpiRepository, organizationRepository };
};

const event = (eventType, data, occurredAt = '2026-10-08T03:00:00Z') => ({ eventType, organizationId: 'org-1', occurredAt, data });

describe('KpiService.datesForEvent - which org-local days an event changes', () => {
  const { service } = build();

  it('uses the organization\'s calendar day, not UTC', () => {
    // 2026-10-07 20:00 UTC is already 2026-10-08 in Kolkata
    expect(service.datesForEvent(event('LEAVE_APPLIED', {}, '2026-10-07T20:00:00Z'), 'Asia/Kolkata')).toEqual(['2026-10-08']);
    expect(service.datesForEvent(event('LEAVE_APPLIED', {}, '2026-10-07T20:00:00Z'), 'UTC')).toEqual(['2026-10-07']);
  });

  it('adds the attendance day an event is about (e.g. a regularized past day)', () => {
    expect(service.datesForEvent(event('REGULARIZATION_APPROVED', { date: '2026-10-01' }), 'Asia/Kolkata'))
      .toEqual(['2026-10-01', '2026-10-08']);
  });

  it('adds every day of an approved leave up to today - future days are computed when they arrive', () => {
    expect(service.datesForEvent(event('LEAVE_APPROVED', { startDate: '2026-10-06', endDate: '2026-10-12' }), 'Asia/Kolkata'))
      .toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    expect(service.datesForEvent(event('WFH_APPROVED', { startDate: '2026-10-20', endDate: '2026-10-21' }), 'Asia/Kolkata'))
      .toEqual(['2026-10-08']);
  });

  it(`never queues more than ${MAX_EVENT_RANGE_DAYS} days back for one event`, () => {
    const dates = service.datesForEvent(event('LEAVE_APPROVED', { startDate: '2025-01-01', endDate: '2026-10-08' }), 'Asia/Kolkata');
    expect(dates).toHaveLength(MAX_EVENT_RANGE_DAYS + 1);
    expect(dates[0]).toBe('2026-08-07');
  });
});

describe('KpiService pipeline', () => {
  it('an event queues its org-days (looking up the org timezone once, then memoized)', async () => {
    const { service, kpiRepository, organizationRepository } = build();

    await service.enqueueForEvent(event('ATTENDANCE_CHECKED_IN', { date: '2026-10-08' }));
    await service.enqueueForEvent(event('ATTENDANCE_CHECKED_OUT', { date: '2026-10-08' }));

    expect(kpiRepository.enqueue).toHaveBeenCalledWith([{ organizationId: 'org-1', date: '2026-10-08' }]);
    expect(organizationRepository.findById).toHaveBeenCalledTimes(1);
  });

  it('refreshQueued recomputes each claimed day in its own transaction, then dequeues it', async () => {
    const items = [
      { organizationId: 'org-1', date: '2026-10-07', timezone: 'Asia/Kolkata', organizationExists: true },
      { organizationId: 'org-1', date: '2026-10-08', timezone: 'Not/AZone', organizationExists: true }
    ];
    const { service, kpiRepository } = build({
      kpiRepository: { claimNext: jest.fn().mockResolvedValueOnce(items[0]).mockResolvedValueOnce(items[1]).mockResolvedValue(null) }
    });
    const transactions = [];
    service.withTransaction = async (fn) => { transactions.push('tx'); return fn(); };

    expect(await service.refreshQueued({ limit: 10 })).toEqual({ refreshed: 2, failed: 0 });
    expect(transactions).toHaveLength(3); // two days + the empty claim that ends the run
    expect(kpiRepository.recomputeDay).toHaveBeenNthCalledWith(1, expect.objectContaining({ date: '2026-10-07', timezone: 'Asia/Kolkata', standardMinutes: 480 }));
    expect(kpiRepository.recomputeDay).toHaveBeenNthCalledWith(2, expect.objectContaining({ timezone: 'UTC' })); // bad setting -> UTC
    expect(kpiRepository.dequeue).toHaveBeenCalledTimes(2);
  });

  it('a failing day is pushed back and the rest of the queue still gets processed', async () => {
    const bad = { organizationId: 'org-1', date: '2026-10-07', organizationExists: true };
    const good = { organizationId: 'org-1', date: '2026-10-08', organizationExists: true };
    const { service, kpiRepository } = build({
      kpiRepository: {
        claimNext: jest.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good).mockResolvedValue(null),
        recomputeDay: jest.fn().mockRejectedValueOnce(new Error('division by zero')).mockResolvedValue()
      }
    });

    expect(await service.refreshQueued()).toEqual({ refreshed: 1, failed: 1 });
    expect(kpiRepository.postpone).toHaveBeenCalledWith(bad, 60);
    expect(kpiRepository.dequeue).toHaveBeenCalledWith(good);
  });

  it('rows for a deleted organization are dropped without a recompute', async () => {
    const orphan = { organizationId: 'gone', date: '2026-10-08', organizationExists: false };
    const { service, kpiRepository } = build({ kpiRepository: { claimNext: jest.fn().mockResolvedValueOnce(orphan).mockResolvedValue(null) } });

    await service.refreshQueued();

    expect(kpiRepository.recomputeDay).not.toHaveBeenCalled();
    expect(kpiRepository.dequeue).toHaveBeenCalledWith(orphan);
  });

  it('if even the claim fails (database down) the run stops with the error', async () => {
    const { service } = build({ kpiRepository: { claimNext: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } });

    await expect(service.refreshQueued()).rejects.toThrow('ECONNREFUSED');
  });

  it('nightly: re-queues the last 2 finished days of every org, in each org\'s own calendar', async () => {
    const { service, kpiRepository } = build();

    await service.enqueueRecent({ days: 2 });

    expect(kpiRepository.enqueue).toHaveBeenCalledWith([
      { organizationId: 'org-1', date: '2026-10-07' }, { organizationId: 'org-1', date: '2026-10-06' },
      // 04:30 UTC is already 00:30 on the 8th in New York too
      { organizationId: 'org-2', date: '2026-10-07' }, { organizationId: 'org-2', date: '2026-10-06' }
    ]);
  });

  it('backfill queues history in chunks', async () => {
    const { service, kpiRepository } = build();

    const result = await service.backfill({ organizationId: 'org-1', days: 600 });

    expect(result).toEqual({ organizations: 1, queued: 600 });
    expect(kpiRepository.enqueue).toHaveBeenCalledTimes(2);
    expect(kpiRepository.enqueue.mock.calls[0][0]).toHaveLength(500);
    expect(kpiRepository.enqueue.mock.calls[1][0].slice(-1)).toEqual([{ organizationId: 'org-1', date: '2026-10-08' }]);
  });
});

describe('KpiService.getKpis', () => {
  it('validates the range and granularity', async () => {
    const { service } = build();

    await expect(service.getKpis(users.hr, { from: '2026-10-08', to: '2026-10-01' })).rejects.toThrow('from must be on or before to');
    await expect(service.getKpis(users.hr, { from: '2020-01-01', to: '2026-10-01' })).rejects.toThrow('Range is limited to 731 days');
    await expect(service.getKpis(users.hr, { granularity: 'hour' })).rejects.toThrow('granularity must be one of');
  });

  it('turns raw sums into rates, with totals summed over the (disjoint) periods', async () => {
    const day = (key, present) => ({
      key, days: 1, workingDays: 1, headcountWd: 10, onLeaveWd: 2, presentWd: present, headcount: 10,
      present, late: 2, wfh: 1, halfDay: 0, onLeave: 2, absent: 8 - present, workingMinutes: present * 480,
      workedDays: present, overtimeMinutes: 60, lateMinutes: 30, leaveRequested: 1, wfhRequested: 0,
      requestsDecided: 2, decisionMinutes: 240
    });
    const { service, kpiRepository } = build({
      kpiRepository: { series: jest.fn().mockImplementation(({ groupBy }) => (groupBy === 'department' ? [] : [day('2026-10-06', 8), day('2026-10-07', 6)])) }
    });

    const result = await service.getKpis(users.hr, { from: '2026-10-06', to: '2026-10-07' });

    expect(kpiRepository.series).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', grain: 'day' }));
    expect(result.series.map(s => [s.period, s.attendanceRate, s.absenceRate])).toEqual([['2026-10-06', 100, 0], ['2026-10-07', 75, 25]]);
    expect(result.totals).toEqual(expect.objectContaining({
      days: 2, avgHeadcount: 10, attendanceRate: 87.5, avgWorkingHours: 8, overtimeHours: 2, avgDecisionHours: 2
    }));
  });

  it('derive() never divides by zero', () => {
    expect(derive({})).toEqual(expect.objectContaining({ attendanceRate: 0, avgWorkingHours: 0, avgDecisionHours: null, avgHeadcount: 0 }));
  });
});

describe('KPI / report worker handlers', () => {
  it('every KPI-relevant event just queues its days', async () => {
    const kpiService = { enqueueForEvent: jest.fn() };
    const handlers = createKpiHandlers({ kpiService });

    expect(Object.keys(handlers).sort()).toEqual([...KPI_EVENTS].sort());
    await handlers.LEAVE_APPROVED({ eventType: 'LEAVE_APPROVED' });
    expect(kpiService.enqueueForEvent).toHaveBeenCalledWith({ eventType: 'LEAVE_APPROVED' });
    expect(handlers.ANNOUNCEMENT_CREATED).toBeUndefined();
  });

  it('REPORT_REQUESTED generates that report', async () => {
    const reportService = { generate: jest.fn() };

    await createReportHandlers({ reportService }).REPORT_REQUESTED({ data: { reportId: 'r-1' } });

    expect(reportService.generate).toHaveBeenCalledWith('r-1');
  });
});
