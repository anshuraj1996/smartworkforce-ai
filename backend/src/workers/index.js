// Worker process entry point - runs separately from the HTTP API (same image, different
// command), so expensive/asynchronous work never slows a request and workers scale on
// their own.
//
//   node src/workers/index.js                 # every worker
//   WORKERS=outbox-relay,notification,cache-invalidation node src/workers/index.js
//
// Env: WORKERS (comma list or "all"), WORKER_HEALTH_PORT (default 8081), plus the usual
// DATABASE_URL / REDIS_URL / KAFKA_BROKER.
require('dotenv').config();

const { sequelize } = require('../models');
const { withTransaction } = require('../database/config');
const repositories = require('../repositories');
const NotificationService = require('../services/NotificationService');
const KpiService = require('../services/KpiService');
const ReportService = require('../services/ReportService');
const cache = require('../utils/cache');
const { createIdempotentProducer } = require('../events/kafka');
const { publish: outboxPublish } = require('../events/outbox');
const { createKafka } = require('../events/kafkaClient');
const { TOPICS, EVENT_TYPES } = require('../events/contracts');
const { createEventConsumer } = require('./runtime/eventConsumer');
const { createScheduledJob } = require('./runtime/scheduler');
const { createHealthServer } = require('./runtime/healthServer');
const { createDeadLetterPublisher } = require('./runtime/deadLetter');
const { createOutboxRelay } = require('./runtime/outboxRelay');
const { createNotificationHandlers } = require('./handlers/notificationHandlers');
const { createCacheInvalidationHandlers } = require('./handlers/cacheInvalidationHandlers');
const { createKpiHandlers, createReportHandlers } = require('./handlers/kpiHandlers');
const { createBirthdayJob } = require('./jobs/birthdayJob');

const kafka = createKafka('smartworkforce-workers');

// One producer for every consumer's dead letters (idempotent: a retried DLQ write isn't duplicated)
const dlqProducer = createIdempotentProducer(kafka);

// Handled events older than this can't be redelivered (Kafka's default retention is 7 days)
const PROCESSED_EVENT_RETENTION_DAYS = 14;
// Published outbox rows are only kept for debugging ("was this event sent, and when?")
const PUBLISHED_OUTBOX_RETENTION_DAYS = 3;

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

// Every worker this process knows how to run
const WORKERS = {
  // Publishes events committed to outbox_events (by the API and by jobs below) to Kafka
  'outbox-relay': () => createOutboxRelay({
    outboxRepository: repositories.outboxRepository,
    producer: createIdempotentProducer(kafka),
    withTransaction,
    batchSize: Number(process.env.OUTBOX_BATCH_SIZE) || 100,
    pollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 500
  }),

  notification: () => createEventConsumer({
    kafka,
    name: 'notification-worker',
    groupId: 'notification-consumer-group',
    topics: [TOPICS.ANNOUNCEMENT, TOPICS.POLICY, TOPICS.HIRING, TOPICS.EMPLOYEE],
    deadLetter: createDeadLetterPublisher({ producer: dlqProducer, consumerGroup: 'notification-consumer-group' }),
    // Sending a notification twice is user-visible, so redeliveries are deduped by eventId
    dedupe: repositories.processedEventRepository,
    handlers: createNotificationHandlers({
      userRepository: repositories.userRepository,
      policyRepository: repositories.policyRepository,
      notifier: NotificationService
    })
  }),

  // Separate consumer group, so it gets its own copy of every event (doesn't compete with
  // the notification worker) and can be scaled/restarted independently
  'cache-invalidation': () => createEventConsumer({
    kafka,
    name: 'cache-invalidation-worker',
    groupId: 'cache-invalidation-consumer-group',
    topics: [TOPICS.ATTENDANCE, TOPICS.LEAVE, TOPICS.WFH, TOPICS.REGULARIZATION, TOPICS.EMPLOYEE],
    deadLetter: createDeadLetterPublisher({ producer: dlqProducer, consumerGroup: 'cache-invalidation-consumer-group' }),
    // No dedupe: bumping a namespace twice is harmless, and this runs on every check-in -
    // a database write per event would cost more than the duplicate it prevents
    dedupe: null,
    handlers: createCacheInvalidationHandlers({ cache })
  }),

  // Keeps processed_events small: daily at 03:15
  'processed-events-cleanup': () => createScheduledJob({
    name: 'processed-events-cleanup',
    schedule: '15 3 * * *',
    runOnStart: false,
    run: async () => ({
      deleted: await repositories.processedEventRepository.deleteProcessedBefore(daysAgo(PROCESSED_EVENT_RETENTION_DAYS))
    })
  }),

  // Keeps outbox_events small: daily at 03:30. Only PUBLISHED rows - pending/failed stay.
  'outbox-cleanup': () => createScheduledJob({
    name: 'outbox-cleanup',
    schedule: '30 3 * * *',
    runOnStart: false,
    run: async () => ({
      deleted: await repositories.outboxRepository.deletePublishedBefore(daysAgo(PUBLISHED_OUTBOX_RETENTION_DAYS))
    })
  }),

  // ---- Analytics (2D) ----

  // KPI pipeline, step 1: events -> "recompute this org-day" rows in kpi_refresh_queue.
  // No dedupe: queueing a day twice is harmless (it's an upsert).
  'kpi-aggregator': () => createEventConsumer({
    kafka,
    name: 'kpi-aggregator',
    groupId: 'kpi-consumer-group',
    topics: [TOPICS.ATTENDANCE, TOPICS.LEAVE, TOPICS.WFH, TOPICS.REGULARIZATION, TOPICS.EMPLOYEE],
    deadLetter: createDeadLetterPublisher({ producer: dlqProducer, consumerGroup: 'kpi-consumer-group' }),
    dedupe: null,
    handlers: createKpiHandlers({ kpiService: KpiService })
  }),

  // KPI pipeline, step 2: drain the queue every 30s - a morning's check-ins become one
  // recompute per org-day instead of one per check-in
  'kpi-refresh': () => createScheduledJob({
    name: 'kpi-refresh',
    schedule: '*/30 * * * * *',
    run: () => KpiService.refreshQueued({ limit: Number(process.env.KPI_REFRESH_BATCH) || 200 })
  }),

  // Daily at 00:30: re-queue the last 2 days of every org. Finalizes yesterday (absent =
  // nobody checked in) and repairs anything missed while Kafka or a worker was down.
  'kpi-nightly': () => createScheduledJob({
    name: 'kpi-nightly',
    schedule: '30 0 * * *',
    run: () => KpiService.enqueueRecent({ days: 2 })
  }),

  // Generates requested reports. Deduped, and generate() itself skips non-PENDING reports.
  'report-generator': () => createEventConsumer({
    kafka,
    name: 'report-generator',
    groupId: 'report-consumer-group',
    topics: [TOPICS.REPORT],
    deadLetter: createDeadLetterPublisher({ producer: dlqProducer, consumerGroup: 'report-consumer-group' }),
    dedupe: repositories.processedEventRepository,
    handlers: createReportHandlers({ reportService: ReportService })
  }),

  // 1st of the month at 02:00: last month's attendance summary for every org. Also runs on
  // startup as a catch-up - the unique index on scheduled reports makes repeats a no-op.
  'monthly-reports': () => createScheduledJob({
    name: 'monthly-reports',
    schedule: '0 2 1 * *',
    run: () => ReportService.scheduleMonthlyReports()
  }),

  birthday: () => createScheduledJob({
    name: 'birthday-job',
    schedule: '5 * * * *', // hourly at :05 - each org is handled once its local day starts
    run: createBirthdayJob({
      organizationRepository: repositories.organizationRepository,
      userRepository: repositories.userRepository,
      claim: cache.setIfAbsent,
      release: cache.cacheDel,
      // Through the outbox like everything else: a Kafka outage can't lose a birthday
      publish: outboxPublish,
      eventType: EVENT_TYPES.EMPLOYEE_BIRTHDAY
    })
  })
};

function selectedWorkers() {
  const requested = (process.env.WORKERS || 'all').split(',').map(w => w.trim()).filter(Boolean);
  const names = requested.includes('all') ? Object.keys(WORKERS) : requested;

  const unknown = names.filter(n => !WORKERS[n]);
  if (unknown.length) {
    throw new Error(`Unknown worker(s): ${unknown.join(', ')} - available: ${Object.keys(WORKERS).join(', ')}`);
  }
  return names;
}

async function main() {
  const names = selectedWorkers();

  await sequelize.authenticate();
  console.info('[workers] Database connection established');

  // Not awaited: workers run (uncached, birthday claims without a lock) even if Redis is down
  cache.connectCache();

  // Needed before any consumer starts - a consumer that can't dead-letter must not run
  await dlqProducer.connect();

  const components = names.map(name => WORKERS[name]());
  const health = createHealthServer({ port: Number(process.env.WORKER_HEALTH_PORT) || 8081, components });
  await health.start();

  for (const component of components) {
    await component.start();
  }
  console.info(`[workers] Running: ${names.join(', ')}`);

  // Kubernetes sends SIGTERM on rollout/scale-down: stop taking new work, let in-flight
  // messages finish (consumer.disconnect waits for them), then close connections.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[workers] ${signal} received, shutting down`);

    const forceExit = setTimeout(() => process.exit(1), 25000);
    forceExit.unref();

    for (const component of components) {
      await component.stop().catch(err => console.error(`[workers] ${component.name} stop failed:`, err.message));
    }
    await health.stop().catch(() => {});
    await Promise.all([
      dlqProducer.disconnect().catch(() => {}),
      cache.closeCache()
    ]);
    await sequelize.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[workers] Fatal startup error:', error);
  process.exit(1);
});
