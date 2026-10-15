const { EVENT_TYPES } = require('../../events/contracts');

// Events that change a day's KPIs. Each handler only queues "recompute this org-day"
// (KpiService.enqueueForEvent) - cheap, and idempotent, so a redelivered event just queues
// the same day again. The kpi-refresh worker does the recomputing.
const KPI_EVENTS = [
  EVENT_TYPES.ATTENDANCE_CHECKED_IN,
  EVENT_TYPES.ATTENDANCE_CHECKED_OUT,
  EVENT_TYPES.LEAVE_APPLIED,
  EVENT_TYPES.LEAVE_APPROVED,
  EVENT_TYPES.LEAVE_REJECTED,
  EVENT_TYPES.WFH_APPLIED,
  EVENT_TYPES.WFH_APPROVED,
  EVENT_TYPES.WFH_REJECTED,
  EVENT_TYPES.REGULARIZATION_APPROVED,
  EVENT_TYPES.REGULARIZATION_REJECTED,
  EVENT_TYPES.EMPLOYEE_JOINED
];

function createKpiHandlers({ kpiService }) {
  return Object.fromEntries(KPI_EVENTS.map(type => [type, (event) => kpiService.enqueueForEvent(event)]));
}

// The report worker: build the requested report (ReportService.generate is idempotent)
function createReportHandlers({ reportService }) {
  return {
    [EVENT_TYPES.REPORT_REQUESTED]: (event) => reportService.generate(event.data.reportId)
  };
}

module.exports = { createKpiHandlers, createReportHandlers, KPI_EVENTS };
