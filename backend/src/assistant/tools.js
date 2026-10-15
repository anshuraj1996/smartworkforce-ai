const { ROLES } = require('../config/constants');
const { memberScope } = require('../services/analyticsScope');
const { todayStr } = require('../utils/dates');

// The assistant's tools - the ONLY way it can reach workforce data. It never sees SQL or the
// database: each tool calls an existing, already role-scoped service method as the signed-in
// user, so it can never see more than that user could see in the app. Every tool also declares
// the minimum role it needs - tools above the user's role aren't even offered to the model, and
// the handler checks again before running (defence in depth).
//
// Results are compacted (only the fields an answer needs) to keep tokens - and cost - down.

const PERIODS = ['7d', '30d', '90d', '1y'];
const DATE = { type: 'string', description: 'A date as YYYY-MM-DD' };
const RANK = { [ROLES.EMPLOYEE]: 0, [ROLES.MANAGER]: 1, [ROLES.HR]: 2, [ROLES.ADMIN]: 3 };
const MAX_RESULT_CHARS = 12000;

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const schema = (properties = {}, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false
});
const periodProp = { period: { type: 'string', enum: PERIODS, description: 'Look-back window: 7d, 30d, 90d or 1y' } };

class ToolInputError extends Error {}

/**
 * services: { leaveService, workforceMetricsService, workforceAnalyticsService, attendanceService,
 *             forecastService, riskService, analyticsRepository, userRepository }
 */
function createAssistantTools(services) {
  const s = services;

  const tools = [
    {
      name: 'get_my_leave_balance',
      minRole: ROLES.EMPLOYEE,
      description: "The signed-in user's own leave balance for the current year, per leave type: allocated, carried forward, used, pending, remaining days.",
      input_schema: schema(),
      run: async (user) => (await s.leaveService.getLeaveBalance(user.id, user.organizationId)).map(b => ({
        leaveType: b.leaveType, allocated: b.allocated, carried: b.carried, used: b.used, pending: b.pending, remaining: b.remaining
      }))
    },
    {
      name: 'get_my_attendance_summary',
      minRole: ROLES.EMPLOYEE,
      description: "The signed-in user's own attendance over a period: attendance rate, punctuality, WFH share, average hours, overtime, late days.",
      input_schema: schema(periodProp),
      run: async (user, { period }) => {
        const { leaveBalance, ...summary } = await s.workforceMetricsService.getMySummary(user, { period });
        return summary;
      }
    },
    {
      name: 'get_team_attendance_today',
      minRole: ROLES.MANAGER,
      description: "Who is present, late, working from home or not checked in today. Managers: their direct reports; HR/Admin: the whole organization.",
      input_schema: schema(),
      run: async (user) => {
        const rows = await s.attendanceService.getTeamAttendance(user.organizationId, null, user.role === ROLES.MANAGER ? user.id : null);
        const status = (a) => (a ? a.attendanceType : 'NOT_CHECKED_IN');
        const counts = {};
        rows.forEach(r => { counts[status(r.attendance)] = (counts[status(r.attendance)] || 0) + 1; });
        return {
          date: todayStr(),
          headcount: rows.length,
          counts,
          people: rows.slice(0, 100).map(r => ({
            name: r.user.name, department: r.user.department, status: status(r.attendance),
            checkIn: r.attendance ? r.attendance.checkInTime : null
          }))
        };
      }
    },
    {
      name: 'get_leave_calendar',
      minRole: ROLES.MANAGER,
      description: 'Who is on leave (approved) or has requested leave (pending) between two dates, with names, leave type and dates. Use for questions like "who is off next week".',
      input_schema: schema({ from: DATE, to: DATE }),
      run: async (user, { from, to }) => {
        if (!isDate(from) || !isDate(to) || from > to) throw new ToolInputError('from/to must be valid YYYY-MM-DD dates with from <= to');
        if (Date.parse(to) - Date.parse(from) > 120 * 864e5) throw new ToolInputError('the range can be at most 120 days');
        const memberIds = await memberScope(user, s.userRepository);
        const rows = await s.analyticsRepository.leaveCalendar({ organizationId: user.organizationId, memberIds, from, to });
        return { from, to, entries: rows };
      }
    },
    {
      name: 'get_pending_approvals',
      minRole: ROLES.MANAGER,
      description: 'Leave and WFH requests waiting for a decision that the signed-in user can approve.',
      input_schema: schema(),
      run: async (user) => {
        const [leaves, wfh] = await Promise.all([s.leaveService.getPendingLeaves(user), s.wfhService.getPendingWfhRequests(user)]);
        const brief = (r, kind) => ({
          kind, employee: r.user ? r.user.name : null, startDate: r.startDate, endDate: r.endDate,
          leaveType: r.leaveType || null, submitted: r.createdAt
        });
        return { leave: leaves.slice(0, 50).map(r => brief(r, 'LEAVE')), wfh: wfh.slice(0, 50).map(r => brief(r, 'WFH')) };
      }
    },
    {
      name: 'get_work_mode_summary',
      minRole: ROLES.EMPLOYEE,
      description: 'Office vs work-from-home vs half-day split over a period, overall and per department. Scoped to the user (employee), their team (manager) or the organization (HR).',
      input_schema: schema(periodProp),
      run: async (user, { period }) => {
        const r = await s.workforceMetricsService.getWorkMode(user, { period });
        return { period: r.period, scope: r.scope, summary: r.summary, byDepartment: r.byDepartment, wfhRequests: r.requests };
      }
    },
    {
      name: 'get_approval_turnaround',
      minRole: ROLES.MANAGER,
      description: 'How quickly leave, WFH and regularization requests get decided: median and 90th-percentile hours, share within the SLA, current backlog.',
      input_schema: schema(periodProp),
      run: async (user, { period }) => {
        const r = await s.workforceMetricsService.getApprovalTurnaround(user, { period });
        return { period: r.period, scope: r.scope, slaHours: r.slaHours, overall: r.overall, byKind: r.byKind };
      }
    },
    {
      name: 'get_department_comparison',
      minRole: ROLES.MANAGER,
      description: "Today's attendance and an attendance-consistency score per department.",
      input_schema: schema(),
      run: (user) => s.workforceAnalyticsService.getDepartmentComparison(user)
    },
    {
      name: 'get_attendance_forecast',
      minRole: ROLES.MANAGER,
      description: 'Forecast of how many people will be available on each upcoming working day (booked leave plus predicted unplanned absence), with risk days.',
      input_schema: schema({ horizon_days: { type: 'integer', enum: [7, 14, 30, 60], description: 'How many days ahead' } }),
      run: async (user, { horizon_days: horizonDays }) => {
        const f = await s.forecastService.getAttendanceForecast(user, { horizonDays });
        return {
          status: f.status, scope: f.scope, summary: f.summary,
          days: f.days.map(d => ({ date: d.date, weekday: d.weekday, available: d.expectedAvailable, of: d.headcount, rate: d.availabilityRate, bookedLeave: d.plannedLeave, pendingLeave: d.pendingLeave, risk: d.risk }))
        };
      }
    },
    {
      name: 'get_leave_forecast',
      minRole: ROLES.MANAGER,
      description: 'Forecast of leave demand per week for the coming weeks: expected leave days, already approved, likely spikes and why, leave expiring at year end.',
      input_schema: schema({ weeks: { type: 'integer', enum: [4, 8, 12, 26], description: 'How many weeks ahead' } }),
      run: async (user, { weeks }) => {
        const f = await s.forecastService.getLeaveForecast(user, { weeks });
        return {
          status: f.status, scope: f.scope, summary: f.summary, yearEnd: f.yearEnd, byType: f.byType,
          weeks: f.weeks.map(w => ({ weekStart: w.weekStart, expected: w.expectedDays, approved: w.bookedDays, pending: w.pendingDays, spike: w.spike, reasons: w.reasons }))
        };
      }
    },
    {
      name: 'get_risk_overview',
      minRole: ROLES.MANAGER,
      description: 'Attendance-risk and burnout-risk scores per employee with the main reasons. Managers: their direct reports; HR: the organization. Scores are prompts for a supportive conversation, not judgments of performance.',
      input_schema: schema(),
      run: async (user) => {
        const r = await s.riskService.getRiskOverview(user, {});
        return {
          note: r.methodology.note, summary: r.summary,
          employees: r.employees.slice(0, 50).map(e => ({
            name: e.name, department: e.department, status: e.status,
            attendanceRisk: e.attendanceRisk, burnoutRisk: e.burnoutRisk
          }))
        };
      }
    },
    {
      name: 'get_leave_statistics',
      minRole: ROLES.HR,
      description: 'Organization-wide leave statistics for the current year: requests by status, days by leave type, per department and per month, plus utilization vs allocation.',
      input_schema: schema(),
      run: async (user) => {
        const [stats, utilization] = await Promise.all([
          s.leaveService.getLeaveStatistics(user.organizationId, '1y'),
          s.leaveService.getLeaveUtilization(user.organizationId)
        ]);
        return { stats, utilization };
      }
    }
  ];

  const rank = (role) => (RANK[role] === undefined ? -1 : RANK[role]);
  const allowedFor = (user) => tools.filter(t => rank(user.role) >= rank(t.minRole));

  return {
    // Tool definitions for the API request - only what this user may use, in a fixed order
    // (a stable tool list keeps the prompt prefix cacheable)
    definitionsFor: (user) => allowedFor(user).map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema, strict: true })),

    // Run one tool call. Returns { content, isError } for the tool_result block.
    async execute(user, name, input) {
      const tool = tools.find(t => t.name === name);
      if (!tool) return { content: `Unknown tool ${name}`, isError: true };
      if (rank(user.role) < rank(tool.minRole)) return { content: 'Not permitted for your role', isError: true };
      if (tool.input_schema.properties.period && !PERIODS.includes(input.period)) {
        return { content: `period must be one of ${PERIODS.join(', ')}`, isError: true };
      }
      try {
        const result = await tool.run(user, input || {});
        let text = JSON.stringify(result);
        if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}... [truncated - ask a narrower question]`;
        return { content: text, isError: false };
      } catch (error) {
        // Permission and validation errors are worth telling the model; anything else stays generic
        const safe = error instanceof ToolInputError || ['ForbiddenError', 'ValidationError', 'NotFoundError'].includes(error.name);
        return { content: safe ? error.message : 'The data could not be loaded right now', isError: true, error };
      }
    },

    names: tools.map(t => t.name)
  };
}

module.exports = { createAssistantTools, ToolInputError };
