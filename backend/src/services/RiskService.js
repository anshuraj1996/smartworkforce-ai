const repositories = require('../repositories');
const AttendanceService = require('./AttendanceService');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_TTL, NAMESPACES } = require('../utils/cacheKeys');
const { todayStr, addDays } = require('../utils/dates');
const { ROLES, IS_HR_UP } = require('../config/constants');
const { ForbiddenError, NotFoundError } = require('../utils/errors');
const { memberScope, STANDARD_WORKDAY_MINUTES, DEFAULT_WORKING_DAYS } = require('./analyticsScope');
const { scoreEmployee, METHODOLOGY } = require('./riskScoring');

const worst = (e) => Math.max(e.attendanceRisk ? e.attendanceRisk.score : -1, e.burnoutRisk ? e.burnoutRisk.score : -1);

// Attendance and burnout risk per employee (scoring rules: riskScoring.js). Sensitive, so:
// HR/Admin see the organization (optionally one department), managers only their direct
// reports, employees nothing.
class RiskService {
  constructor({ analyticsRepository, userRepository, attendanceService, cache: cacheClient }) {
    this.analyticsRepository = analyticsRepository;
    this.userRepository = userRepository;
    this.attendanceService = attendanceService;
    this.cache = cacheClient;
  }

  async inputsFor(user, scope) {
    const shift = await this.attendanceService.getDefaultShift(user.organizationId);
    const workingDays = shift && Array.isArray(shift.workingDays) && shift.workingDays.length ? shift.workingDays : DEFAULT_WORKING_DAYS;
    return this.analyticsRepository.riskInputs({
      organizationId: user.organizationId,
      ...scope,
      today: todayStr(),
      workingDays,
      standardMinutes: STANDARD_WORKDAY_MINUTES
    });
  }

  getRiskOverview(user, { department = null } = {}) {
    if (!IS_HR_UP.includes(user.role) && user.role !== ROLES.MANAGER) throw new ForbiddenError('Risk scores are for managers and HR');
    const dept = IS_HR_UP.includes(user.role) ? department || null : null;
    const scopeKey = user.role === ROLES.MANAGER ? `team-${user.id}` : `dept-${dept || 'all'}`;

    return this.cache.withVersionedCache(
      NAMESPACES.workforce(user.organizationId),
      CACHE_KEYS.riskOverview(user.organizationId, scopeKey, todayStr()),
      CACHE_TTL.riskOverview,
      () => this.computeOverview(user, dept)
    );
  }

  async computeOverview(user, department) {
    const memberIds = user.role === ROLES.MANAGER ? await memberScope(user, this.userRepository) : null;
    const today = todayStr();
    const rows = await this.inputsFor(user, { memberIds, department });
    const employees = rows.map(r => scoreEmployee(r, today));

    // Most at risk first; employees without enough data last
    employees.sort((a, b) => worst(b) - worst(a));
    const scored = employees.filter(e => e.status === 'ok');
    const count = (key, lvl) => scored.filter(e => e[key].level === lvl).length;
    const avg = (key) => (scored.length ? Math.round(scored.reduce((s, e) => s + e[key].score, 0) / scored.length) : null);

    return {
      scope: user.role === ROLES.MANAGER ? 'team' : department ? 'department' : 'organization',
      department,
      asOf: addDays(today, -1),
      summary: {
        employees: employees.length,
        scored: scored.length,
        insufficientData: employees.length - scored.length,
        attendance: { high: count('attendanceRisk', 'high'), medium: count('attendanceRisk', 'medium'), average: avg('attendanceRisk') },
        burnout: { high: count('burnoutRisk', 'high'), medium: count('burnoutRisk', 'medium'), average: avg('burnoutRisk') }
      },
      methodology: METHODOLOGY,
      // the list leaves out the full factor breakdown - that's the per-employee endpoint
      employees: employees.map(({ attendanceRisk, burnoutRisk, ...e }) => ({
        ...e,
        attendanceRisk: attendanceRisk && { score: attendanceRisk.score, level: attendanceRisk.level, reasons: attendanceRisk.reasons },
        burnoutRisk: burnoutRisk && { score: burnoutRisk.score, level: burnoutRisk.level, reasons: burnoutRisk.reasons }
      }))
    };
  }

  // One employee: full factor breakdown + their recent anomaly / pattern-shift insights
  async getEmployeeRisk(user, targetUserId) {
    if (!IS_HR_UP.includes(user.role) && user.role !== ROLES.MANAGER) throw new ForbiddenError('Risk scores are for managers and HR');
    const target = await this.userRepository.findInOrg(targetUserId, user.organizationId);
    if (!target) throw new NotFoundError('User not found');
    if (user.role === ROLES.MANAGER && target.managerId !== user.id) {
      throw new ForbiddenError('Managers can only view their direct reports');
    }

    const today = todayStr();
    const [rows, insights] = await Promise.all([
      this.inputsFor(user, { memberIds: [targetUserId] }),
      this.analyticsRepository.recentInsights({ organizationId: user.organizationId, userId: targetUserId, since: addDays(today, -30) })
    ]);
    if (!rows.length) throw new NotFoundError('No active employee found');

    return { ...scoreEmployee(rows[0], today), asOf: addDays(today, -1), methodology: METHODOLOGY, recentInsights: insights };
  }
}

module.exports = new RiskService({ ...repositories, attendanceService: AttendanceService, cache });
module.exports.RiskService = RiskService;
