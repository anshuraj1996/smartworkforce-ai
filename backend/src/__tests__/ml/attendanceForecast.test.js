jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { fitRidge } = require('../../ml/ridge');
const { forecastRate, features, MIN_TRAINING_DAYS } = require('../../ml/attendanceForecast');
const { ForecastService } = require('../../services/ForecastService');
const passThroughCache = require('../../utils/passThroughCache');
const { users } = require('../helpers');

// Deterministic noise
function noise(seed) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

// A year of weekdays: 5% base absence, Mondays +3, Fridays +2, winter peak +3, noise
function syntheticYear({ seed = 7, days = 380, start = Date.UTC(2025, 9, 1), flat = false } = {}) {
  const gauss = noise(seed);
  const points = [];
  for (let i = 0; i < days; i += 1) {
    const t = start + i * 864e5;
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5;
    const pattern = flat ? 0 : (dow === 1 ? 0.03 : 0) + (dow === 5 ? 0.02 : 0) + 0.03 * Math.cos((2 * Math.PI * doy) / 365.25);
    points.push({ date: d.toISOString().slice(0, 10), value: Math.max(0, 0.05 + pattern + 0.012 * gauss()) });
  }
  return points;
}

describe('ridge regression', () => {
  it('recovers a linear relationship (tiny lambda) and shrinks coefficients as lambda grows', () => {
    const X = [[0, 1], [1, 0], [2, 1], [3, 0], [4, 1]];
    const y = X.map(([a, b]) => 2 + 3 * a - 1 * b);

    const exact = fitRidge(X, y, { lambda: 1e-9 });
    expect(exact.intercept).toBeCloseTo(2, 6);
    expect(exact.coefficients[0]).toBeCloseTo(3, 6);
    expect(exact.coefficients[1]).toBeCloseTo(-1, 6);

    const shrunk = fitRidge(X, y, { lambda: 100 });
    expect(Math.abs(shrunk.coefficients[0])).toBeLessThan(3);
  });

  it('a constant feature (weekday never seen in training) does not break the fit', () => {
    const model = fitRidge([[1, 0], [2, 0], [3, 0]], [1, 2, 3], { lambda: 0.1 });
    expect(Number.isFinite(model.predict([4, 1]))).toBe(true);
  });
});

describe('forecastRate', () => {
  it('learns weekday + seasonal patterns: beats the historical mean by far, and the weekday baseline', () => {
    const points = syntheticYear();
    const holdout = points.splice(-20);

    const result = forecastRate(points, holdout.map(p => p.date));

    expect(result.model.type).toBe('ridge');
    expect(result.model.backtest.mae.model).toBeLessThan(result.model.backtest.mae.weekdayBaseline);
    expect(result.model.backtest.improvementVsMeanPct).toBeGreaterThan(50);
    // Out-of-sample: error near the noise level, and most actuals inside the p10-p90 band
    const mae = result.predictions.reduce((s, p, i) => s + Math.abs(p.value - holdout[i].value), 0) / holdout.length;
    const inside = result.predictions.filter((p, i) => holdout[i].value >= p.low && holdout[i].value <= p.high).length;
    expect(mae).toBeLessThan(0.015);
    expect(inside).toBeGreaterThanOrEqual(13);
    // Mondays forecast higher than Wednesdays
    const byDay = (dow) => result.predictions.filter(p => new Date(`${p.date}T00:00:00Z`).getUTCDay() === dow).map(p => p.value);
    expect(Math.min(...byDay(1))).toBeGreaterThan(Math.max(...byDay(3)));
  });

  it('with no pattern to learn, the model still never does much worse than the baseline it is checked against', () => {
    const points = syntheticYear({ flat: true, seed: 3 });
    const result = forecastRate(points, ['2026-11-02']);
    expect(result.model.backtest.mae.model).toBeLessThanOrEqual(result.model.backtest.mae.weekdayBaseline);
  });

  it(`needs ${MIN_TRAINING_DAYS} days of history`, () => {
    expect(forecastRate(syntheticYear().slice(0, MIN_TRAINING_DAYS - 1), ['2026-11-02'])).toBeNull();
  });

  it('rates stay within 0..1', () => {
    const points = syntheticYear().map(p => ({ ...p, value: 0.001 }));
    const [p] = forecastRate(points, ['2026-11-02']).predictions;
    expect(p.low).toBeGreaterThanOrEqual(0);
    expect(p.high).toBeLessThanOrEqual(1);
  });

  it('features: weekday one-hot, seasonality, trend in years', () => {
    const row = features('2026-10-05', '2025-10-05'); // a Monday, one year after origin
    expect(row.slice(0, 6)).toEqual([1, 0, 0, 0, 0, 0]);
    expect(row[10]).toBeCloseTo(1, 2);
  });
});

describe('ForecastService', () => {
  const today = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);

  const build = ({ history = syntheticYear({ start: Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()), days: 360 }), headcount = 20, booked = [] } = {}) => {
    // history as daily_kpis totals: 20 people, rate -> absent count
    const rows = history.map(p => ({ date: p.date, headcount: 20, onLeave: 2, absent: Math.round(p.value * 18), present: 18 - Math.round(p.value * 18), wfh: 3 }));
    const deps = {
      analyticsRepository: {
        dailyKpiTotals: jest.fn().mockResolvedValue(rows),
        activeHeadcount: jest.fn().mockResolvedValue(headcount),
        bookedAbsenceByDay: jest.fn().mockImplementation(async ({ from }) => booked.map((b, i) => ({ date: ymd(new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5)), ...b })))
      },
      userRepository: { findActiveMemberIds: jest.fn().mockResolvedValue(['e1', 'e2', 'e3']) },
      attendanceService: { getDefaultShift: jest.fn().mockResolvedValue({ workingDays: [0, 1, 2, 3, 4, 5, 6] }) },
      cache: passThroughCache
    };
    return { service: new ForecastService(deps), deps };
  };

  it('availability = headcount - booked leave - predicted unplanned absence, with a range and risk level', async () => {
    const { service } = build({ booked: [{ approvedLeave: 6, pendingLeave: 1, approvedWfh: 2 }] });

    const result = await service.getAttendanceForecast(users.hr, { horizonDays: 7 });

    expect(result.status).toBe('ok');
    expect(result.scope).toBe('organization');
    const [first] = result.days;
    expect(first.plannedLeave).toBe(6);
    expect(first.pendingLeave).toBe(1);
    // base 14 expected in, minus a few % unplanned
    expect(first.expectedAvailable).toBeLessThan(14);
    expect(first.expectedAvailable).toBeGreaterThan(12);
    expect(first.availableRange.low).toBeLessThanOrEqual(first.expectedAvailable);
    expect(first.availableRange.high).toBeGreaterThanOrEqual(first.expectedAvailable);
    expect(first.availabilityRate).toBeLessThan(75); // 6 of 20 on leave
    expect(first.risk).toBe('high');
    expect(result.summary.highRiskDays).toBeGreaterThanOrEqual(1);
    expect(result.model.absence.backtest).not.toBeNull();
  });

  it('a manager gets their team: the team\'s headcount and booked leave, organization-wide rates', async () => {
    const { service, deps } = build({ headcount: 3 });

    const result = await service.getAttendanceForecast(users.manager, { horizonDays: 14, department: 'Sales' });

    expect(result.scope).toBe('team');
    expect(result.department).toBeNull(); // a manager can't pick another department
    expect(deps.analyticsRepository.dailyKpiTotals).toHaveBeenCalledWith(expect.objectContaining({ department: null }));
    expect(deps.analyticsRepository.activeHeadcount).toHaveBeenCalledWith(expect.objectContaining({ memberIds: ['e1', 'e2', 'e3'] }));
    expect(result.model.note).toMatch(/your team/);
  });

  it('HR can forecast one department from its own history', async () => {
    const { service, deps } = build();

    const result = await service.getAttendanceForecast(users.hr, { horizonDays: 7, department: 'Eng' });

    expect(result.scope).toBe('department');
    expect(deps.analyticsRepository.dailyKpiTotals).toHaveBeenCalledWith(expect.objectContaining({ department: 'Eng' }));
  });

  it('without enough history it still shows booked leave, flagged insufficient_history', async () => {
    const { service } = build({ history: [], booked: [{ approvedLeave: 2, pendingLeave: 0, approvedWfh: 0 }] });

    const result = await service.getAttendanceForecast(users.hr, { horizonDays: 7 });

    expect(result.status).toBe('insufficient_history');
    expect(result.days[0]).toEqual(expect.objectContaining({ plannedLeave: 2, expectedAvailable: 18, expectedUnplannedAbsent: null, availableRange: null }));
  });

  it('holiday-like days (almost everyone absent) are left out of training', async () => {
    const history = syntheticYear({ start: Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()), days: 360 });
    history[10] = { ...history[10], value: 1 };
    const { service } = build({ history });

    const result = await service.getAttendanceForecast(users.hr, { horizonDays: 7 });

    expect(result.history.excludedDays).toBe(1);
  });

  it('employees cannot use it, and the horizon is bounded', async () => {
    const { service } = build();
    expect(() => service.getAttendanceForecast(users.employee, {})).toThrow('managers and HR');
    expect(() => service.getAttendanceForecast(users.hr, { horizonDays: 365 })).toThrow('horizonDays must be 7-90');
  });
});
