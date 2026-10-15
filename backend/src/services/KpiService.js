const repositories = require('../repositories');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { localDateIn, safeTimezone, addDays, eachDate, todayStr } = require('../utils/dates');
const { ValidationError } = require('../utils/errors');
const { percent, round2, STANDARD_WORKDAY_MINUTES } = require('./analyticsScope');

const GRANULARITIES = ['day', 'week', 'month'];
const DEFAULT_RANGE_DAYS = 90;
const MAX_RANGE_DAYS = 731;
// Events only trigger recomputes for recent days - older history changes rarely, and a
// leave approved for a 3-month sabbatical shouldn't queue 90 recomputes per event
const MAX_EVENT_RANGE_DAYS = 62;
const TIMEZONE_TTL_MS = 10 * 60 * 1000;
const RETRY_FAILED_AFTER_SECONDS = 60;

const round1 = (n) => Math.round(n * 10) / 10;

// The KPI engine: keeps daily_kpis (one row per org, day and department) up to date and
// serves long-range KPI series from it.
//
// Pipeline:  service write -> outbox -> Kafka -> kpi-aggregator worker (enqueueForEvent:
// "this org-day changed") -> kpi_refresh_queue -> kpi-refresh worker (refreshQueued:
// recompute each queued org-day from the source tables) -> daily_kpis -> GET /analytics/kpis.
// A nightly job re-queues recent days, which finalizes "absent" once a day is over and
// heals anything an outage missed.
//
// Recompute, don't increment: a day's row is always rebuilt from the source tables, so a
// duplicated, reordered or lost event can never leave a counter wrong - the worst case is a
// recompute that happens later (or twice).
class KpiService {
  constructor({
    kpiRepository,
    organizationRepository,
    withTransaction = (fn) => fn(),
    standardMinutes = STANDARD_WORKDAY_MINUTES,
    logger = console,
    now = () => new Date()
  }) {
    this.kpiRepository = kpiRepository;
    this.organizationRepository = organizationRepository;
    this.withTransaction = withTransaction;
    this.standardMinutes = standardMinutes;
    this.logger = logger;
    this.now = now;
    this.timezones = new Map(); // organizationId -> { timezone, at }
  }

  // Org timezone, memoized briefly - the aggregator handles every check-in
  async timezoneOf(organizationId) {
    const cached = this.timezones.get(organizationId);
    if (cached && this.now() - cached.at < TIMEZONE_TTL_MS) return cached.timezone;

    const org = await this.organizationRepository.findById(organizationId);
    const timezone = safeTimezone(org && org.timezone);
    this.timezones.set(organizationId, { timezone, at: this.now() });
    return timezone;
  }

  // Which of the org's local days an event changes (pure; exported for tests):
  //  - the day it happened (requests created / decided, headcount for a new joiner)
  //  - the attendance day it is about (check-in/out, regularization)
  //  - every day of an approved leave/WFH (on-leave and WFH counts)
  // limited to [today - MAX_EVENT_RANGE_DAYS, today] - future days are computed as they come.
  datesForEvent(event, timezone) {
    const today = localDateIn(timezone, this.now());
    const data = event.data || {};
    const dates = new Set([localDateIn(timezone, new Date(event.occurredAt))]);

    switch (event.eventType) {
      case EVENT_TYPES.ATTENDANCE_CHECKED_IN:
      case EVENT_TYPES.ATTENDANCE_CHECKED_OUT:
      case EVENT_TYPES.REGULARIZATION_APPROVED:
        dates.add(data.date);
        break;
      case EVENT_TYPES.LEAVE_APPROVED:
      case EVENT_TYPES.WFH_APPROVED: {
        const from = data.startDate > addDays(today, -MAX_EVENT_RANGE_DAYS) ? data.startDate : addDays(today, -MAX_EVENT_RANGE_DAYS);
        const to = data.endDate < today ? data.endDate : today;
        eachDate(from, to).forEach(d => dates.add(d));
        break;
      }
      default:
        break;
    }

    const oldest = addDays(today, -MAX_EVENT_RANGE_DAYS);
    return [...dates].filter(d => d && d <= today && d >= oldest).sort();
  }

  async enqueueForEvent(event) {
    const timezone = await this.timezoneOf(event.organizationId);
    const dates = this.datesForEvent(event, timezone);
    await this.kpiRepository.enqueue(dates.map(date => ({ organizationId: event.organizationId, date })));
    return dates;
  }

  // Nightly: re-queue the last `days` local days (not today) of every active org
  async enqueueRecent({ days = 2 } = {}) {
    const orgs = await this.organizationRepository.findAllActive();
    const items = [];
    orgs.forEach(org => {
      const today = localDateIn(org.timezone, this.now());
      for (let i = 1; i <= days; i += 1) items.push({ organizationId: org.id, date: addDays(today, -i) });
    });
    await this.kpiRepository.enqueue(items);
    return { queued: items.length };
  }

  // One-off fill of history (npm run kpi:backfill): queue the last `days` days, today included
  async backfill({ organizationId = null, days = DEFAULT_RANGE_DAYS } = {}) {
    const orgs = (await this.organizationRepository.findAllActive()).filter(o => !organizationId || o.id === organizationId);
    const items = [];
    orgs.forEach(org => {
      const today = localDateIn(org.timezone, this.now());
      eachDate(addDays(today, -(days - 1)), today).forEach(date => items.push({ organizationId: org.id, date }));
    });
    // In chunks - one INSERT per org-year would be a very long statement
    for (let i = 0; i < items.length; i += 500) {
      await this.kpiRepository.enqueue(items.slice(i, i + 500));
    }
    return { organizations: orgs.length, queued: items.length };
  }

  // Drain up to `limit` queued org-days. Each is its own short transaction (claim with SKIP
  // LOCKED -> recompute -> dequeue), so one bad day can't roll back or block the others:
  // it's pushed back RETRY_FAILED_AFTER_SECONDS and retried by a later run.
  async refreshQueued({ limit = 200 } = {}) {
    let refreshed = 0;
    let failed = 0;

    for (let i = 0; i < limit; i += 1) {
      let item = null;
      try {
        const done = await this.withTransaction(async () => {
          item = await this.kpiRepository.claimNext();
          if (!item) return false;
          if (item.organizationExists) {
            await this.kpiRepository.recomputeDay({
              organizationId: item.organizationId,
              date: item.date,
              timezone: safeTimezone(item.timezone),
              standardMinutes: this.standardMinutes
            });
          }
          await this.kpiRepository.dequeue(item);
          return true;
        });
        if (!done) break;
        refreshed += 1;
      } catch (error) {
        if (!item) throw error; // couldn't even claim (database down) - this run is over
        failed += 1;
        this.logger.error(`[kpi] recompute ${item.organizationId} ${item.date} failed: ${error.message}`);
        try {
          await this.kpiRepository.postpone(item, RETRY_FAILED_AFTER_SECONDS);
        } catch {
          break; // can't even push it back - stop rather than re-claim it in a loop
        }
      }
    }

    return { refreshed, failed };
  }

  // ---- Reads (HR / Admin) ----

  async getKpis(user, { from, to, granularity = 'day', department = null } = {}) {
    const end = to || todayStr();
    const start = from || addDays(end, -(DEFAULT_RANGE_DAYS - 1));
    if (start > end) throw new ValidationError('from must be on or before to');
    if (eachDate(start, end).length > MAX_RANGE_DAYS) throw new ValidationError(`Range is limited to ${MAX_RANGE_DAYS} days`);
    if (!GRANULARITIES.includes(granularity)) throw new ValidationError(`granularity must be one of ${GRANULARITIES.join(', ')}`);

    const base = { organizationId: user.organizationId, from: start, to: end, department };
    const [periods, departments, lastComputedAt, queue] = await Promise.all([
      this.kpiRepository.series({ ...base, grain: granularity }),
      this.kpiRepository.series({ ...base, groupBy: 'department' }),
      this.kpiRepository.lastComputedAt(user.organizationId),
      this.kpiRepository.queueSummary()
    ]);

    return {
      from: start,
      to: end,
      granularity,
      department,
      // periods are disjoint, so their sums are the range totals
      totals: derive(sumRows(periods)),
      series: periods.map(r => ({ period: r.key, ...derive(r) })),
      byDepartment: departments.map(r => ({ department: r.key, ...derive(r) })),
      // how fresh the numbers are: today's row moves as events arrive; a queued day is pending
      freshness: { lastComputedAt, queuedDays: queue.queued, oldestQueuedSeconds: queue.oldestSeconds }
    };
  }
}

function sumRows(rows) {
  const total = {};
  rows.forEach(r => Object.entries(r).forEach(([k, v]) => {
    if (typeof v === 'number') total[k] = (total[k] || 0) + v;
  }));
  return total;
}

// Raw sums -> the rates a dashboard shows
function derive(r) {
  const n = (k) => r[k] || 0;
  const expected = n('headcountWd') - n('onLeaveWd'); // person-days employees were expected in
  return {
    days: n('days'),
    workingDays: n('workingDays'),
    avgHeadcount: n('days') ? round1(n('headcount') / n('days')) : 0,
    present: n('present'),
    late: n('late'),
    wfh: n('wfh'),
    halfDay: n('halfDay'),
    onLeave: n('onLeave'),
    absent: n('absent'),
    attendanceRate: Math.min(100, percent(n('presentWd'), expected)),
    absenceRate: percent(n('absent'), expected),
    lateRate: percent(n('late'), n('present')),
    wfhRate: percent(n('wfh'), n('present')),
    avgWorkingHours: n('workedDays') ? round2(n('workingMinutes') / n('workedDays') / 60) : 0,
    overtimeHours: round2(n('overtimeMinutes') / 60),
    leaveRequested: n('leaveRequested'),
    wfhRequested: n('wfhRequested'),
    requestsDecided: n('requestsDecided'),
    avgDecisionHours: n('requestsDecided') ? round1(n('decisionMinutes') / n('requestsDecided') / 60) : null
  };
}

module.exports = new KpiService({ ...repositories, withTransaction: dbTransaction });
module.exports.KpiService = KpiService;
module.exports.derive = derive;
module.exports.MAX_EVENT_RANGE_DAYS = MAX_EVENT_RANGE_DAYS;
