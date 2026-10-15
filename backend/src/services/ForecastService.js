const repositories = require('../repositories');
const AttendanceService = require('./AttendanceService');
const LeaveService = require('./LeaveService');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_TTL, NAMESPACES } = require('../utils/cacheKeys');
const { forecastRate, MIN_TRAINING_DAYS } = require('../ml/attendanceForecast');
const { forecastWeekly, MIN_TRAINING_WEEKS } = require('../ml/leaveDemandForecast');
const { todayStr, addDays, eachDate } = require('../utils/dates');
const { ROLES, IS_HR_UP } = require('../config/constants');
const { ValidationError, ForbiddenError } = require('../utils/errors');
const { memberScope, DEFAULT_WORKING_DAYS } = require('./analyticsScope');

const HISTORY_DAYS = 365;
// Days above this unplanned-absence rate are treated as holidays / outages, not behaviour
// (there's no holiday calendar yet) and left out of training
const MAX_TRAINING_ABSENCE_RATE = 0.8;
const RISK = { high: 75, elevated: 85 }; // availability % thresholds
// Leave demand
const LEAVE_HISTORY_WEEKS = 104;
const SPIKE_FACTOR = 1.5;    // a week at 1.5x the usual leave load or more...
const SPIKE_MIN_EXTRA = 2;   // ...and at least 2 person-days above it
const YEAR_END_FROM = '12-10'; // weeks starting from 10 Dec can carry use-it-or-lose-it leave
// Only leave people plan and use up - event-driven types (sick, maternity, bereavement...)
// don't create a year-end rush, so their unused days aren't "expiring demand"
const DISCRETIONARY_LEAVE = ['ANNUAL', 'PERSONAL', 'COMPENSATORY'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const round1 = (n) => Math.round(n * 10) / 10;
const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * Attendance forecast: who will be available on each upcoming working day.
 *
 *   available = headcount - booked leave (known) - expected unplanned absence (model)
 *
 * The model (ml/attendanceForecast.js) learns the daily UNPLANNED absence rate - absent /
 * (headcount - on leave) - from up to a year of daily_kpis, so booked leave isn't counted
 * twice. It also forecasts the WFH share of people present. Leave already approved for future
 * days comes straight from leave_requests; pending leave is reported as "might be away too".
 *
 * Scope: HR/Admin - the organization, or one department (its own history and model);
 * managers - their direct reports (too few people for a model of their own, so the
 * organization's rates are applied to the team, with the team's own booked leave).
 */
class ForecastService {
  constructor({
    analyticsRepository, userRepository, attendanceService, leaveService, leavePolicyRepository,
    cache: cacheClient, now = () => new Date()
  }) {
    this.analyticsRepository = analyticsRepository;
    this.userRepository = userRepository;
    this.attendanceService = attendanceService;
    this.leaveService = leaveService;
    this.leavePolicyRepository = leavePolicyRepository;
    this.cache = cacheClient;
    this.now = now;
  }

  getAttendanceForecast(user, { horizonDays = 30, department = null } = {}) {
    if (user.role === ROLES.EMPLOYEE) throw new ForbiddenError('Forecasts are for managers and HR');
    const horizon = Number(horizonDays);
    if (!Number.isInteger(horizon) || horizon < 7 || horizon > 90) throw new ValidationError('horizonDays must be 7-90');
    const dept = IS_HR_UP.includes(user.role) ? department || null : null; // managers: always their team
    const scopeKey = user.role === ROLES.MANAGER ? `team-${user.id}` : `dept-${dept || 'all'}`;

    return this.cache.withVersionedCache(
      NAMESPACES.workforce(user.organizationId),
      CACHE_KEYS.attendanceForecast(user.organizationId, scopeKey, horizon, todayStr()),
      CACHE_TTL.attendanceForecast,
      () => this.computeAttendanceForecast(user, horizon, dept)
    );
  }

  async computeAttendanceForecast(user, horizon, department) {
    const organizationId = user.organizationId;
    const memberIds = user.role === ROLES.MANAGER ? await memberScope(user, this.userRepository) : null;
    const today = todayStr();
    const shift = await this.attendanceService.getDefaultShift(organizationId);
    const workingDays = shift && Array.isArray(shift.workingDays) && shift.workingDays.length ? shift.workingDays : DEFAULT_WORKING_DAYS;
    const futureDates = eachDate(addDays(today, 1), addDays(today, horizon)).filter(d => workingDays.includes(weekdayOf(d)));

    const [history, headcount, booked] = await Promise.all([
      this.analyticsRepository.dailyKpiTotals({ organizationId, department, since: addDays(today, -HISTORY_DAYS), until: addDays(today, -1) }),
      this.analyticsRepository.activeHeadcount({ organizationId, memberIds, department }),
      futureDates.length
        ? this.analyticsRepository.bookedAbsenceByDay({ organizationId, memberIds, department, from: futureDates[0], to: futureDates[futureDates.length - 1] })
        : []
    ]);

    // Training targets
    const absencePoints = [];
    let excludedDays = 0;
    history.forEach(h => {
      const expected = h.headcount - h.onLeave;
      if (expected < 1) return;
      const rate = h.absent / expected;
      if (rate > MAX_TRAINING_ABSENCE_RATE) { excludedDays += 1; return; }
      absencePoints.push({ date: h.date, value: rate });
    });
    const wfhPoints = history.filter(h => h.present > 0).map(h => ({ date: h.date, value: h.wfh / h.present }));

    const absence = forecastRate(absencePoints, futureDates);
    const wfh = forecastRate(wfhPoints, futureDates);
    const bookedByDate = new Map(booked.map(b => [b.date, b]));

    const days = futureDates.map((date, i) => {
      const b = bookedByDate.get(date) || { approvedLeave: 0, pendingLeave: 0, approvedWfh: 0 };
      const base = Math.max(headcount - b.approvedLeave, 0); // expected in, before unplanned absence
      const a = absence && absence.predictions[i];
      const expectedAvailable = a ? base * (1 - a.value) : base;
      const availabilityRate = headcount ? round1((expectedAvailable / headcount) * 100) : 0;
      const w = wfh && wfh.predictions[i];
      return {
        date,
        weekday: WEEKDAYS[weekdayOf(date)],
        headcount,
        plannedLeave: b.approvedLeave,
        pendingLeave: b.pendingLeave,
        approvedWfh: b.approvedWfh,
        expectedUnplannedAbsent: a ? round1(base * a.value) : null,
        expectedAvailable: round1(expectedAvailable),
        // p10-p90 from the model's backtest errors
        availableRange: a ? { low: round1(base * (1 - a.high)), high: round1(base * (1 - a.low)) } : null,
        availabilityRate,
        expectedWfh: w ? round1(Math.max(w.value * expectedAvailable, b.approvedWfh)) : b.approvedWfh,
        risk: availabilityRate < RISK.high ? 'high' : availabilityRate < RISK.elevated ? 'elevated' : 'normal'
      };
    });

    const lowest = days.reduce((min, d) => (min === null || d.availabilityRate < min.availabilityRate ? d : min), null);
    return {
      scope: user.role === ROLES.MANAGER ? 'team' : department ? 'department' : 'organization',
      department,
      horizonDays: horizon,
      generatedAt: this.now().toISOString(),
      // 'insufficient_history': booked leave is still shown, without the model's part
      status: absence ? 'ok' : 'insufficient_history',
      history: { usableDays: absencePoints.length, excludedDays, minimumDays: MIN_TRAINING_DAYS },
      model: {
        absence: absence ? absence.model : null,
        wfhShare: wfh ? wfh.model : null,
        note: user.role === ROLES.MANAGER ? 'Organization-wide absence rates applied to your team, plus your team\'s booked leave' : null
      },
      summary: {
        workingDays: days.length,
        avgAvailabilityRate: days.length ? round1(days.reduce((s, d) => s + d.availabilityRate, 0) / days.length) : null,
        lowestDay: lowest ? { date: lowest.date, availabilityRate: lowest.availabilityRate } : null,
        highRiskDays: days.filter(d => d.risk === 'high').length,
        plannedLeaveDays: days.reduce((s, d) => s + d.plannedLeave, 0)
      },
      days
    };
  }

  // ---- Leave demand ----

  /**
   * Leave demand for the coming weeks: how many leave person-days to expect per week, what's
   * already booked, what is likely still to be requested, and which weeks look like spikes.
   *
   *   expected = max(model, booked)   - approved leave is a floor: it WILL happen
   *
   * The model (ml/leaveDemandForecast.js) learns leave days PER EMPLOYEE per week from up to
   * two years of approved leave, so a growing team doesn't look like rising demand; the rate
   * is scaled back up by today's headcount. Year-end spikes get an extra explanation: leave
   * that expires unused on 31 Dec (remaining balance above the carry-forward limit).
   * Scope as in the attendance forecast: HR - organization or a department; manager - their
   * team, with organization-wide rates and the team's own bookings.
   */
  getLeaveForecast(user, { weeks = 12, department = null } = {}) {
    if (user.role === ROLES.EMPLOYEE) throw new ForbiddenError('Forecasts are for managers and HR');
    const horizon = Number(weeks);
    if (!Number.isInteger(horizon) || horizon < 4 || horizon > 26) throw new ValidationError('weeks must be 4-26');
    const dept = IS_HR_UP.includes(user.role) ? department || null : null;
    const scopeKey = user.role === ROLES.MANAGER ? `team-${user.id}` : `dept-${dept || 'all'}`;

    return this.cache.withVersionedCache(
      NAMESPACES.workforce(user.organizationId),
      CACHE_KEYS.leaveForecast(user.organizationId, scopeKey, horizon, todayStr()),
      CACHE_TTL.attendanceForecast,
      () => this.computeLeaveForecast(user, horizon, dept)
    );
  }

  async computeLeaveForecast(user, horizon, department) {
    const organizationId = user.organizationId;
    const isManager = user.role === ROLES.MANAGER;
    const memberIds = isManager ? await memberScope(user, this.userRepository) : null;
    const shift = await this.attendanceService.getDefaultShift(organizationId);
    const workingDays = shift && Array.isArray(shift.workingDays) && shift.workingDays.length ? shift.workingDays : DEFAULT_WORKING_DAYS;

    const today = todayStr();
    const thisMonday = addDays(today, -((weekdayOf(today) + 6) % 7));
    const firstWeek = addDays(thisMonday, 7); // forecast whole weeks, starting next Monday
    const futureWeeks = Array.from({ length: horizon }, (_, i) => addDays(firstWeek, 7 * i));
    const futureEnd = addDays(futureWeeks[futureWeeks.length - 1], 6);
    const year = Number(today.slice(0, 4));
    const scope = { organizationId, memberIds, department };

    const [historyRows, futureRows, headcount, mix, configured, usage] = await Promise.all([
      // the model learns from the organization (or the department) - a team is too small
      this.analyticsRepository.weeklyLeave({ organizationId, department, since: addDays(thisMonday, -7 * LEAVE_HISTORY_WEEKS), until: addDays(thisMonday, -1), workingDays }),
      this.analyticsRepository.weeklyLeave({ ...scope, since: firstWeek, until: futureEnd, workingDays }),
      this.analyticsRepository.activeHeadcount(scope),
      this.analyticsRepository.leaveTypeMix({ ...scope, since: addDays(today, -365), until: today }),
      this.leavePolicyRepository.findActiveForOrg(organizationId),
      this.analyticsRepository.leaveUsedByUserAndType({ ...scope, year })
    ]);

    // Training data: leave days per employee per week. Leading weeks before the first
    // recorded leave are dropped - that's before leave was tracked here, not "nobody took leave".
    const firstWithLeave = historyRows.findIndex(r => r.approved > 0);
    const points = (firstWithLeave === -1 ? [] : historyRows.slice(firstWithLeave))
      .filter(r => r.headcount > 0)
      .map(r => ({ week: r.week, value: r.approved / r.headcount }));
    const forecast = forecastWeekly(points, futureWeeks);

    // "Usual" week = median rate over the last year, at today's headcount
    const recentRates = points.slice(-52).map(p => p.value).sort((a, b) => a - b);
    const typical = recentRates.length ? recentRates[Math.floor(recentRates.length / 2)] * headcount : 0;
    const expiring = this.expiringBalance(this.leaveService.allocationPolicies(configured), usage);
    const bookedByWeek = new Map(futureRows.map(r => [r.week, r]));

    const weeksOut = futureWeeks.map((week, i) => {
      const booked = bookedByWeek.get(week) || { approved: 0, pending: 0 };
      const p = forecast && forecast.predictions[i];
      const modelDays = p ? p.value * headcount : null;
      const expected = round1(Math.max(modelDays || 0, booked.approved));
      const reasons = [];
      const spike = typical > 0 && expected >= SPIKE_FACTOR * typical && expected - typical >= SPIKE_MIN_EXTRA;
      if (spike) {
        if (booked.approved >= SPIKE_FACTOR * typical) reasons.push(`${booked.approved} leave days already approved`);
        if (modelDays !== null && modelDays >= SPIKE_FACTOR * typical) reasons.push('usually a busy leave week at this time of year');
        if (week.slice(5) >= YEAR_END_FROM && expiring.days > 0) reasons.push(`${expiring.days} unused leave days expire on 31 Dec`);
      }
      return {
        weekStart: week,
        expectedDays: expected,
        range: p ? { low: round1(Math.max(p.low * headcount, booked.approved)), high: round1(Math.max(p.high * headcount, booked.approved)) } : null,
        bookedDays: booked.approved,
        pendingDays: booked.pending,
        likelyNewRequests: round1(Math.max(0, expected - booked.approved - booked.pending)),
        perEmployee: headcount ? Math.round((expected / headcount) * 100) / 100 : 0,
        spike,
        reasons
      };
    });

    const totalMix = mix.reduce((s, m) => s + m.days, 0);
    const totalExpected = round1(weeksOut.reduce((s, w) => s + w.expectedDays, 0));
    const peak = weeksOut.reduce((m, w) => (m === null || w.expectedDays > m.expectedDays ? w : m), null);
    return {
      scope: isManager ? 'team' : department ? 'department' : 'organization',
      department,
      horizonWeeks: horizon,
      generatedAt: this.now().toISOString(),
      status: forecast ? 'ok' : 'insufficient_history',
      history: { usableWeeks: points.length, minimumWeeks: MIN_TRAINING_WEEKS },
      model: forecast ? forecast.model : null,
      note: isManager ? 'Organization-wide leave patterns applied to your team, plus your team\'s bookings' : null,
      headcount,
      summary: {
        expectedLeaveDays: totalExpected,
        bookedDays: round1(weeksOut.reduce((s, w) => s + w.bookedDays, 0)),
        pendingDays: round1(weeksOut.reduce((s, w) => s + w.pendingDays, 0)),
        likelyNewRequests: round1(weeksOut.reduce((s, w) => s + w.likelyNewRequests, 0)),
        typicalWeekDays: round1(typical),
        peakWeek: peak ? { weekStart: peak.weekStart, expectedDays: peak.expectedDays } : null,
        spikeWeeks: weeksOut.filter(w => w.spike).length
      },
      // Expected split of the coming demand by leave type, from the last 12 months' mix
      byType: mix.map(m => ({
        leaveType: m.leaveType,
        share: totalMix ? Math.round((m.days / totalMix) * 1000) / 10 : 0,
        expectedDays: totalMix ? round1((m.days / totalMix) * totalExpected) : 0
      })),
      yearEnd: { year, ...expiring },
      weeks: weeksOut
    };
  }

  // Days that expire unused at year end: per employee and discretionary leave type, what's
  // left after approved + pending leave, beyond what may be carried forward. (Carried-in days
  // from last year aren't counted, so this errs on the low side.)
  expiringBalance(policies, usage) {
    const used = new Map();
    const userIds = new Set();
    usage.forEach(u => {
      userIds.add(u.userId);
      if (u.leaveType) used.set(`${u.userId}:${u.leaveType}`, u.days);
    });

    const byType = {};
    const employees = new Set();
    let days = 0;
    policies.filter(p => DISCRETIONARY_LEAVE.includes(p.leaveType)).forEach(p => {
      userIds.forEach(userId => {
        const left = p.allocated - (used.get(`${userId}:${p.leaveType}`) || 0);
        const lost = Math.max(0, left - p.carryForwardMax);
        if (lost > 0) {
          days += lost;
          byType[p.leaveType] = (byType[p.leaveType] || 0) + lost;
          employees.add(userId);
        }
      });
    });
    return { days: round1(days), employees: employees.size, byType };
  }
}

module.exports = new ForecastService({ ...repositories, attendanceService: AttendanceService, leaveService: LeaveService, cache });
module.exports.ForecastService = ForecastService;
