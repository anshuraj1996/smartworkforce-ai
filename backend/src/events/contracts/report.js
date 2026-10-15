const { Joi, id, date } = require('./fields');
const { TOPICS } = require('./topics');

// Report generation runs in the worker, not the request: the API stores a PENDING report and
// this event (one transaction, via the outbox); the report worker builds the CSV.
const REPORT_TYPES = ['attendance-summary', 'leave-summary'];

module.exports = [
  {
    type: 'REPORT_REQUESTED',
    version: 1,
    topic: TOPICS.REPORT,
    key: 'reportId',
    producer: 'ReportService.requestReport / ReportService.scheduleMonthlyReports',
    description: 'A workforce report was requested (by a manager/HR, or by the monthly schedule). The report worker generates it and notifies the requester.',
    schema: Joi.object({
      reportId: id().required(),
      reportType: Joi.string().valid(...REPORT_TYPES).required(),
      periodStart: date().required(),
      periodEnd: date().required(),
      // null = scheduled (the organization's HR/Admin are notified)
      requestedBy: id().allow(null).required()
    }),
    example: {
      reportId: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      reportType: 'attendance-summary',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      requestedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    }
  }
];

module.exports.REPORT_TYPES = REPORT_TYPES;
