jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { scoreEmployee, bradfordScale, level, MIN_EXPECTED_DAYS } = require('../../services/riskScoring');
const { RiskService } = require('../../services/RiskService');
const passThroughCache = require('../../utils/passThroughCache');
const { users } = require('../helpers');

const TODAY = '2026-10-15';
// A steady employee: 60 expected days, all present on time, a holiday 40 days ago, no overtime
const steady = (over = {}) => ({
  userId: 'u1', name: 'Asha', department: 'Eng', managerId: 'mgr-1', trackedFrom: '2026-04-01',
  expected90: 60, absent90: 0, present90: 60, late90: 0, avgLateMinutes: 0,
  expected30: 21, issues30: 0, expectedPrior: 39, issuesPrior: 0,
  checkInSdMinutes: 6, workedDays56: 40, overtimeMinutes56: 0,
  bradfordSpells: 0, bradfordDays: 0, lastLeaveEnded: '2026-09-05', recentAnomalies: 0,
  ...over
});

describe('riskScoring', () => {
  it('a steady employee scores low on both, with nothing to explain', () => {
    const r = scoreEmployee(steady(), TODAY);
    expect(r.status).toBe('ok');
    expect(r.attendanceRisk).toEqual(expect.objectContaining({ score: 0, level: 'low', reasons: [] }));
    expect(r.burnoutRisk.level).toBe('low');
  });

  it('frequent short absences: the Bradford Factor dominates, explained with its HR band', () => {
    // 8 one-day absences in a year: B = 8^2 x 8 = 512 -> "review" band
    const r = scoreEmployee(steady({ absent90: 4, bradfordSpells: 8, bradfordDays: 8, late90: 6, avgLateMinutes: 25 }), TODAY);
    const bradford = r.attendanceRisk.factors.find(f => f.key === 'bradford');
    expect(bradford.value).toBe(512);
    expect(bradford.text).toMatch(/Bradford Factor 512 - 8 separate absences, 8 days in 12 months \(review \(450\+\)\)/);
    expect(r.attendanceRisk.reasons[0]).toMatch(/Bradford/);
    expect(r.attendanceRisk.level).toBe('medium');
  });

  it('one long absence weighs far less than many short ones with the same days (the point of Bradford)', () => {
    const oneLong = scoreEmployee(steady({ bradfordSpells: 1, bradfordDays: 10 }), TODAY).attendanceRisk.factors.find(f => f.key === 'bradford');
    const manyShort = scoreEmployee(steady({ bradfordSpells: 10, bradfordDays: 10 }), TODAY).attendanceRisk.factors.find(f => f.key === 'bradford');
    expect(oneLong.value).toBe(10);
    expect(manyShort.value).toBe(1000);
    expect(manyShort.points).toBeGreaterThan(oneLong.points * 10);
  });

  it('recent deterioration only counts with enough days in both windows', () => {
    const worse = scoreEmployee(steady({ issues30: 6, issuesPrior: 1 }), TODAY).attendanceRisk.factors.find(f => f.key === 'deterioration');
    expect(worse.points).toBe(15); // 28.6% now vs 2.6% before -> full weight
    expect(worse.text).toBe('absent or late on 29% of days in the last 30 days, 3% before');
    const thin = scoreEmployee(steady({ expected30: 5, issues30: 5 }), TODAY).attendanceRisk.factors.find(f => f.key === 'deterioration');
    expect(thin.points).toBe(0);
  });

  it('burnout: sustained overtime and a long stretch without leave', () => {
    const r = scoreEmployee(steady({ overtimeMinutes56: 8 * 9 * 60, lastLeaveEnded: null, trackedFrom: '2026-01-01' }), TODAY);
    expect(r.burnoutRisk.level).toBe('high');
    expect(r.burnoutRisk.reasons).toEqual([
      '9 h overtime per week over the last 8 weeks',
      'no leave taken since tracking began 287 days ago'
    ]);
  });

  it(`no score below ${MIN_EXPECTED_DAYS} expected days`, () => {
    expect(scoreEmployee(steady({ expected90: MIN_EXPECTED_DAYS - 1 }), TODAY)).toEqual(expect.objectContaining({
      status: 'insufficient_data', attendanceRisk: null, burnoutRisk: null
    }));
  });

  it('scales: Bradford bands and levels', () => {
    expect(bradfordScale(0)).toBe(0);
    expect(bradfordScale(125)).toBeCloseTo(0.4);
    expect(bradfordScale(650)).toBe(1);
    expect(bradfordScale(5000)).toBe(1);
    expect([level(60), level(35), level(34)]).toEqual(['high', 'medium', 'low']);
  });
});

describe('RiskService', () => {
  const build = (rows = [steady(), steady({ userId: 'u2', name: 'Ravi', bradfordSpells: 12, bradfordDays: 14, absent90: 9, present90: 51, late90: 15 }), steady({ userId: 'u3', name: 'New', expected90: 5 })]) => {
    const deps = {
      analyticsRepository: {
        riskInputs: jest.fn().mockResolvedValue(rows),
        recentInsights: jest.fn().mockResolvedValue([{ insightType: 'ATTENDANCE_ANOMALY', title: 'Unusual attendance on 2026-10-10' }])
      },
      userRepository: {
        findActiveMemberIds: jest.fn().mockResolvedValue(['u1', 'u2']),
        findInOrg: jest.fn(async (id) => ({ id, managerId: id === 'u9' ? 'mgr-2' : 'mgr-1' }))
      },
      attendanceService: { getDefaultShift: jest.fn().mockResolvedValue(null) },
      cache: passThroughCache
    };
    return { service: new RiskService(deps), deps };
  };

  it('overview: most at risk first, unscored last, summary counts, no factor dump in the list', async () => {
    const { service } = build();

    const result = await service.getRiskOverview(users.hr, {});

    expect(result.employees.map(e => e.name)).toEqual(['Ravi', 'Asha', 'New']);
    expect(result.summary).toEqual(expect.objectContaining({ employees: 3, scored: 2, insufficientData: 1 }));
    expect(result.summary.attendance.high).toBe(1);
    expect(result.employees[0].attendanceRisk.factors).toBeUndefined();
    expect(result.methodology.note).toMatch(/supportive conversation/);
  });

  it('managers are scoped to their direct reports; HR can pick a department', async () => {
    const { service, deps } = build();

    await service.getRiskOverview(users.manager, { department: 'Sales' });
    expect(deps.analyticsRepository.riskInputs).toHaveBeenLastCalledWith(expect.objectContaining({ memberIds: ['u1', 'u2'], department: null }));

    await service.getRiskOverview(users.hr, { department: 'Sales' });
    expect(deps.analyticsRepository.riskInputs).toHaveBeenLastCalledWith(expect.objectContaining({ memberIds: null, department: 'Sales' }));
  });

  it('employee detail: full factors plus recent anomaly insights; managers only for their reports', async () => {
    const { service } = build([steady()]);

    const detail = await service.getEmployeeRisk(users.manager, 'u1');
    expect(detail.attendanceRisk.factors).toHaveLength(6);
    expect(detail.recentInsights[0].title).toMatch(/Unusual attendance/);

    await expect(service.getEmployeeRisk(users.manager, 'u9')).rejects.toThrow('direct reports');
  });

  it('employees cannot see risk scores', () => {
    const { service } = build();
    expect(() => service.getRiskOverview(users.employee)).toThrow('managers and HR');
  });
});
