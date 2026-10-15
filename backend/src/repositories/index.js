const cache = require('../utils/cache');
const { CACHE_KEYS } = require('../utils/cacheKeys');

// Shared repository instances. Services receive these through their constructor so tests
// can swap in fakes; application code imports the singletons from here.
const WfhRepository = require('./WfhRepository');
const LeaveRepository = require('./LeaveRepository');
const AttendanceRepository = require('./AttendanceRepository');
const UserRepository = require('./UserRepository');
const AuditLogRepository = require('./AuditLogRepository');
const RegularizationRepository = require('./RegularizationRepository');
const ProcessedEventRepository = require('./ProcessedEventRepository');
const OutboxRepository = require('./OutboxRepository');
const AnalyticsRepository = require('./AnalyticsRepository');
const KpiRepository = require('./KpiRepository');
const ReportRepository = require('./ReportRepository');
const { PolicyRepository, PolicyAcknowledgementRepository } = require('./PolicyRepository');
const { JobOpeningRepository, ReferralRepository } = require('./HiringRepository');
const {
  HealthRepository,
  OrganizationRepository,
  ShiftRepository,
  LeavePolicyRepository,
  NotificationRepository,
  AnnouncementRepository,
  CertificationRepository,
  AiInsightRepository
} = require('./SimpleRepositories');

module.exports = {
  wfhRepository: new WfhRepository(),
  leaveRepository: new LeaveRepository(),
  attendanceRepository: new AttendanceRepository(),
  userRepository: new UserRepository({
    onChange: (userIds) => cache.cacheDel(userIds.map(CACHE_KEYS.authContext))
  }),
  auditLogRepository: new AuditLogRepository(),
  regularizationRepository: new RegularizationRepository(),
  policyRepository: new PolicyRepository(),
  policyAcknowledgementRepository: new PolicyAcknowledgementRepository(),
  jobOpeningRepository: new JobOpeningRepository(),
  referralRepository: new ReferralRepository(),
  organizationRepository: new OrganizationRepository(),
  shiftRepository: new ShiftRepository(),
  leavePolicyRepository: new LeavePolicyRepository(),
  notificationRepository: new NotificationRepository(),
  announcementRepository: new AnnouncementRepository(),
  certificationRepository: new CertificationRepository(),
  aiInsightRepository: new AiInsightRepository(),
  healthRepository: new HealthRepository(),
  processedEventRepository: new ProcessedEventRepository(),
  outboxRepository: new OutboxRepository(),
  analyticsRepository: new AnalyticsRepository(),
  kpiRepository: new KpiRepository(),
  reportRepository: new ReportRepository()
};
