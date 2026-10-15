jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { forecastWeekly, MIN_TRAINING_WEEKS } = require('../../ml/leaveDemandForecast');
const { ForecastService } = require('../../services/ForecastService');
const passThroughCache = require('../../utils/passThroughCache');
const { addDays, todayStr } = require('../../utils/dates');
const { users } = require('../helpers');

const WEEK = 7 * 864e5;

function noise(seed) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

// Leave days per employee per week: base 0.15, a summer bump and a big late-December peak
function seasonalRate(t) {
  const d = new Date(t);
  const doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5;
  const summer = Math.exp(-(((doy - 200) / 20) ** 2));
  const december = Math.exp(-(((doy - 355) / 10) ** 2)) + Math.exp(-(((doy + 10) / 10) ** 2));
  return 0.15 + 0.35 * summer + 0.5 * december;
}

function weeklySeries({ start, weeks, seed = 11, jitter = 0.04 }) {
  const g = noise(seed);
  return Array.from({ length: weeks }, (_, i) => {
    const t = start + i * WEEK;
    return { week: new Date(t).toISOString().slice(0, 10), value: Math.max(0, seasonalRate(t) + jitter * g()) };
  });
}

describe('forecastWeekly', () => {
  it('learns the seasonal pattern: the Christmas weeks forecast far above October, and it beats the historical mean', () => {
    // 2 years of Mondays from 2024-01-01; hold out Oct-Dec 2025
    const all = weeklySeries({ start: Date.UTC(2024, 0, 1), weeks: 104 });
    const cut = all.findIndex(p => p.week >= '2025-10-06');
    const train = all.slice(0, cut);
    const holdout = all.slice(cut, cut + 13);

    const result = forecastWeekly(train, holdout.map(p => p.week));

    expect(result.model.backtest.improvementVsMeanPct).toBeGreaterThan(30);
    const value = (week) => result.predictions.find(p => p.week === week).value;
    const christmas = result.predictions.find(p => p.week >= '2025-12-15').week;
    expect(value(christmas)).toBeGreaterThan(2 * value(holdout[0].week));
    const mae = result.predictions.reduce((s, p, i) => s + Math.abs(p.value - holdout[i].value), 0) / holdout.length;
    expect(mae).toBeLessThan(0.1);
  });

  it(`needs ${MIN_TRAINING_WEEKS} weeks of history`, () => {
    const short = weeklySeries({ start: Date.UTC(2025, 0, 6), weeks: MIN_TRAINING_WEEKS - 1 });
    expect(forecastWeekly(short, ['2025-08-04'])).toBeNull();
  });

  it('never forecasts negative leave', () => {
    const flat = weeklySeries({ start: Date.UTC(2024, 0, 1), weeks: 60, jitter: 0 }).map(p => ({ ...p, value: 0 }));
    const [p] = forecastWeekly(flat, ['2025-03-03']).predictions;
    expect(p.value).toBeGreaterThanOrEqual(0);
    expect(p.low).toBeGreaterThanOrEqual(0);
  });
});

describe('ForecastService.getLeaveForecast', () => {
  const today = todayStr();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const thisMonday = addDays(today, -((dow + 6) % 7));
  const firstWeek = addDays(thisMonday, 7);

  // 104 weeks of history ending last week: 20 people, rate from the seasonal curve
  const historyRows = weeklySeries({ start: Date.parse(`${addDays(thisMonday, -7 * 104)}T00:00:00Z`), weeks: 104, jitter: 0.02 })
    .map(p => ({ week: p.week, approved: Math.round(p.value * 20 * 2) / 2, pending: 0, headcount: 20 }));

  const build = ({ history = historyRows, booked = {}, usage, policies } = {}) => {
    const deps = {
      analyticsRepository: {
        weeklyLeave: jest.fn(async ({ since }) => {
          if (since < thisMonday) return history;
          return Array.from({ length: 26 }, (_, i) => {
            const week = addDays(firstWeek, 7 * i);
            return { week, approved: (booked[i] || {}).approved || 0, pending: (booked[i] || {}).pending || 0, headcount: 20 };
          });
        }),
        activeHeadcount: jest.fn().mockResolvedValue(20),
        leaveTypeMix: jest.fn().mockResolvedValue([{ leaveType: 'ANNUAL', days: 75 }, { leaveType: 'SICK', days: 25 }]),
        leaveUsedByUserAndType: jest.fn().mockResolvedValue(usage || [
          { userId: 'u1', leaveType: 'ANNUAL', days: 5 },
          { userId: 'u2', leaveType: 'ANNUAL', days: 20 },
          { userId: 'u3', leaveType: null, days: 0 }
        ])
      },
      userRepository: { findActiveMemberIds: jest.fn().mockResolvedValue(['u1', 'u2']) },
      attendanceService: { getDefaultShift: jest.fn().mockResolvedValue(null) },
      leaveService: { allocationPolicies: () => policies || [{ leaveType: 'ANNUAL', allocated: 21, carryForwardMax: 5 }] },
      leavePolicyRepository: { findActiveForOrg: jest.fn().mockResolvedValue([]) },
      cache: passThroughCache
    };
    return { service: new ForecastService(deps), deps };
  };

  it('forecasts whole weeks from next Monday, scaled to today\'s headcount, with a range', async () => {
    const { service } = build();

    const result = await service.getLeaveForecast(users.hr, { weeks: 8 });

    expect(result.status).toBe('ok');
    expect(result.weeks).toHaveLength(8);
    expect(result.weeks[0].weekStart).toBe(firstWeek);
    result.weeks.forEach(w => {
      expect(w.expectedDays).toBeGreaterThanOrEqual(0);
      expect(w.range.low).toBeLessThanOrEqual(w.expectedDays + 1e-9);
      expect(w.range.high).toBeGreaterThanOrEqual(w.expectedDays - 1e-9);
    });
    expect(result.model.backtest).not.toBeNull();
    expect(result.byType).toEqual([
      expect.objectContaining({ leaveType: 'ANNUAL', share: 75 }),
      expect.objectContaining({ leaveType: 'SICK', share: 25 })
    ]);
  });

  it('approved leave is a floor; a heavily booked week is a spike with the reason', async () => {
    const { service } = build({ booked: { 1: { approved: 40, pending: 3 } } });

    const result = await service.getLeaveForecast(users.hr, { weeks: 4 });
    const week = result.weeks[1];

    expect(week.expectedDays).toBeGreaterThanOrEqual(40);
    expect(week.bookedDays).toBe(40);
    expect(week.pendingDays).toBe(3);
    expect(week.likelyNewRequests).toBe(Math.max(0, Math.round((week.expectedDays - 43) * 10) / 10));
    expect(week.spike).toBe(true);
    expect(week.reasons).toContain('40 leave days already approved');
    expect(result.summary.spikeWeeks).toBeGreaterThanOrEqual(1);
  });

  it('year end: unused balance above the carry-forward limit is counted as expiring', async () => {
    const { service } = build();

    const { yearEnd } = await service.getLeaveForecast(users.hr, { weeks: 4 });

    // ANNUAL 21 per person, carry 5: u1 used 5 -> 11 expire; u2 used 20 -> 0; u3 used 0 -> 16
    expect(yearEnd).toEqual(expect.objectContaining({ days: 27, employees: 2, byType: { ANNUAL: 27 } }));
  });

  it('a manager gets their team\'s bookings with organization-wide patterns', async () => {
    const { service, deps } = build();

    const result = await service.getLeaveForecast(users.manager, { weeks: 4, department: 'Sales' });

    expect(result.scope).toBe('team');
    const [historyCall, futureCall] = deps.analyticsRepository.weeklyLeave.mock.calls.map(c => c[0]);
    expect(historyCall.memberIds).toBeUndefined();
    expect(historyCall.department).toBeNull();
    expect(futureCall.memberIds).toEqual(['u1', 'u2']);
    expect(result.note).toMatch(/your team/);
  });

  it('with too little history: bookings only, flagged; weeks before leave was tracked are ignored', async () => {
    const empty = historyRows.map((r, i) => (i < 90 ? { ...r, approved: 0 } : r)); // only the last 14 weeks have leave
    const { service } = build({ history: empty, booked: { 0: { approved: 6, pending: 0 } } });

    const result = await service.getLeaveForecast(users.hr, { weeks: 4 });

    expect(result.status).toBe('insufficient_history');
    expect(result.history.usableWeeks).toBe(14);
    expect(result.weeks[0]).toEqual(expect.objectContaining({ expectedDays: 6, range: null }));
  });

  it('validates the horizon and blocks employees', () => {
    const { service } = build();
    expect(() => service.getLeaveForecast(users.hr, { weeks: 52 })).toThrow('weeks must be 4-26');
    expect(() => service.getLeaveForecast(users.employee, {})).toThrow('managers and HR');
  });
});
