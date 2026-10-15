// One topic per domain. Partition counts match docker-compose's kafka-topics-init.
const TOPICS = {
  ATTENDANCE: 'smartai.attendance.events',
  LEAVE: 'smartai.leave.events',
  WFH: 'smartai.wfh.events',
  REGULARIZATION: 'smartai.regularization.events',
  ANNOUNCEMENT: 'smartai.announcement.events',
  POLICY: 'smartai.policy.events',
  EMPLOYEE: 'smartai.employee.events',
  HIRING: 'smartai.hiring.events',
  REPORT: 'smartai.report.events'
};

module.exports = { TOPICS };
