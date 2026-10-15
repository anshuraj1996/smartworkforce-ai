// Outbox relay: moves committed events from outbox_events to Kafka.
//
// Each pass, in one database transaction:
//   1. claim the next pending rows in insert order (FOR UPDATE SKIP LOCKED)
//   2. send them to Kafka in one batch
//   3. mark them PUBLISHED - or, if Kafka is unavailable, push them back with a growing delay
//      (no attempt limit: they wait as long as Kafka is down). Errors retrying can't fix
//      (kafkajs marks them non-retriable, e.g. message too large) mark the rows FAILED.
//
// Guarantees and limits:
// - At-least-once: a crash after Kafka accepted the batch but before the commit re-sends it.
//   Consumers dedupe by eventId (processed_events), so that's harmless.
// - Order: rows go out in insert order. Two relay replicas are safe (SKIP LOCKED - no row is
//   sent twice concurrently) but can interleave batches, so run one replica if strict
//   per-key ordering across batches matters (the default worker deployment runs 1).
const MAX_BACKOFF_SECONDS = 60;
const SUMMARY_REFRESH_MS = 10000;

const backoffSeconds = (attempts) => Math.min(2 ** attempts, MAX_BACKOFF_SECONDS);

const defaultSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function createOutboxRelay({
  outboxRepository,
  producer,
  withTransaction,
  batchSize = 100,
  pollIntervalMs = 500,
  logger = console,
  sleep = defaultSleep
}) {
  const stats = {
    published: 0, batches: 0, retriedRows: 0, failedRows: 0, lastPublishedAt: null, lastError: null,
    pending: null, oldestPendingSeconds: null, failed: null
  };
  let running = false;
  let loopDone = null;
  let lastSummaryAt = 0;

  // One pass; returns how many rows it claimed (exposed for tests)
  async function relayOnce() {
    return withTransaction(async () => {
      const rows = await outboxRepository.claimPending(batchSize);
      if (rows.length === 0) return 0;

      const ids = rows.map(r => r.id);

      // One entry per topic, rows kept in id order inside each
      const byTopic = new Map();
      for (const row of rows) {
        if (!byTopic.has(row.topic)) byTopic.set(row.topic, []);
        byTopic.get(row.topic).push({
          key: row.message_key,
          value: JSON.stringify(row.envelope),
          headers: row.headers
        });
      }

      try {
        await producer.sendBatch({ topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })) });
        await outboxRepository.markPublished(ids);
        stats.published += rows.length;
        stats.batches += 1;
        stats.lastPublishedAt = new Date().toISOString();
      } catch (error) {
        stats.lastError = error.message;
        if (error.retriable === false) {
          await outboxRepository.markFailed(ids, error.message);
          stats.failedRows += rows.length;
          logger.error(`[outbox-relay] ${rows.length} event(s) marked FAILED (not retriable): ${error.message}`);
        } else {
          const delay = backoffSeconds(Math.max(...rows.map(r => r.attempts)) + 1);
          await outboxRepository.markRetry(ids, error.message, delay);
          stats.retriedRows += rows.length;
          logger.warn(`[outbox-relay] Kafka unavailable (${error.message}) - ${rows.length} event(s) retry in ${delay}s`);
        }
      }
      return rows.length;
    });
  }

  async function refreshSummary() {
    if (Date.now() - lastSummaryAt < SUMMARY_REFRESH_MS) return;
    lastSummaryAt = Date.now();
    const summary = await outboxRepository.pendingSummary();
    stats.pending = summary.pending;
    stats.oldestPendingSeconds = summary.oldest_pending_seconds;
    stats.failed = summary.failed;
  }

  async function loop() {
    let databaseBackoff = pollIntervalMs;
    while (running) {
      try {
        const claimed = await relayOnce();
        await refreshSummary();
        databaseBackoff = pollIntervalMs;
        // A full batch means there's a backlog - keep going without waiting
        if (claimed < batchSize) await sleep(pollIntervalMs);
      } catch (error) {
        // Database trouble (Kafka errors are handled inside relayOnce)
        stats.lastError = error.message;
        logger.error(`[outbox-relay] Pass failed: ${error.message}`);
        await sleep(databaseBackoff);
        databaseBackoff = Math.min(databaseBackoff * 2, MAX_BACKOFF_SECONDS * 1000);
      }
    }
  }

  async function start() {
    await producer.connect();
    running = true;
    loopDone = loop();
    logger.info(`[outbox-relay] Publishing outbox_events every ${pollIntervalMs}ms (batch ${batchSize})`);
  }

  // Finishes the current pass, then stops
  async function stop() {
    running = false;
    if (loopDone) await loopDone;
    await producer.disconnect();
  }

  return {
    name: 'outbox-relay',
    start,
    stop,
    relayOnce,
    isReady: () => running,
    getStats: () => ({ ...stats, running })
  };
}

module.exports = { createOutboxRelay, backoffSeconds };
