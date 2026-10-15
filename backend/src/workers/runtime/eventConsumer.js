const { validateEnvelope } = require('../../events/contracts');
const { NonRetryableError } = require('./errors');
const { runWithTenant } = require('../../utils/tenantContext');

// A Kafka consumer that dispatches contract-validated events to one handler per eventType.
//
//   createEventConsumer({
//     kafka, name: 'notification-worker', groupId: 'notification-consumer-group',
//     topics: [TOPICS.ANNOUNCEMENT], handlers: { ANNOUNCEMENT_CREATED: async (event) => { ... } },
//     deadLetter,                 // from deadLetter.js
//     dedupe: processedEvents,    // { isProcessed, markProcessed } or null
//   })
//
// Delivery guarantees:
// - Ordering: one message at a time per partition, so one employee's events stay in order.
// - At-least-once: eachMessage only resolves after the message is handled or dead-lettered,
//   and kafkajs commits the offset only after that. A crash in between means redelivery.
// - Idempotency: with `dedupe`, an eventId this consumer group already handled is skipped,
//   so redelivery doesn't run a handler twice. (Turn it off for handlers that are naturally
//   idempotent and cheap, to save a database write per event.)
// - Retries: a failing handler gets `retry.attempts` tries with exponential backoff + jitter
//   (for transient problems - DB restart, network blip). Retrying blocks only this partition.
// - Dead letters: after the last attempt, on NonRetryableError, or for an invalid message,
//   the message goes to "<topic>.dlq" and the consumer moves on.
const DEFAULT_RETRY = { attempts: 3, initialDelayMs: 200, maxDelayMs: 5000 };

const defaultSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function backoffDelay(attempt, { initialDelayMs, maxDelayMs }, random = Math.random) {
  const exponential = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return Math.round(exponential * (0.8 + random() * 0.4)); // ±20% jitter so replicas don't retry in lockstep
}

function createEventConsumer({
  kafka,
  name,
  groupId,
  topics,
  handlers,
  deadLetter,
  dedupe = null,
  retry = {},
  logger = console,
  sleep = defaultSleep,
  random = Math.random
}) {
  if (typeof deadLetter !== 'function') {
    throw new Error(`[${name}] a deadLetter publisher is required - failed messages must not be dropped`);
  }

  const retryPolicy = { ...DEFAULT_RETRY, ...retry };
  const consumer = kafka.consumer({ groupId });
  const stats = {
    processed: 0, failed: 0, retries: 0, deadLettered: 0, duplicates: 0, invalid: 0, ignored: 0, lastEventAt: null
  };
  let ready = false;
  let started = false;

  const log = (level, message) => logger[level](`[${name}] ${message}`);

  consumer.on(consumer.events.GROUP_JOIN, () => { ready = true; });
  consumer.on(consumer.events.CRASH, () => { ready = false; });
  consumer.on(consumer.events.DISCONNECT, () => { ready = false; });

  async function sendToDeadLetter(context, reason, error, attempts) {
    await deadLetter({ ...context, reason, error, attempts });
    stats.deadLettered += 1;
    log('warn', `Dead-lettered ${context.topic}[${context.partition}]@${context.message.offset} (${reason}): ${error.message}`);
  }

  // Exposed separately so it can be unit-tested without Kafka
  async function handleMessage(context) {
    const { message } = context;

    let envelope;
    try {
      envelope = validateEnvelope(JSON.parse(message.value.toString()));
    } catch (error) {
      // A malformed message will never succeed - retrying is pointless
      stats.invalid += 1;
      await sendToDeadLetter(context, 'INVALID_MESSAGE', error, 0);
      return;
    }

    const handler = handlers[envelope.eventType];
    if (!handler) {
      // Other event types share these topics - not this worker's concern
      stats.ignored += 1;
      return;
    }

    // If this check fails (database down) the error propagates: no commit, Kafka redelivers
    if (dedupe && await dedupe.isProcessed(groupId, envelope.eventId)) {
      stats.duplicates += 1;
      return;
    }

    for (let attempt = 1; attempt <= retryPolicy.attempts; attempt += 1) {
      try {
        // Handlers run with the event's organization as the ambient tenant
        await runWithTenant({ organizationId: envelope.organizationId }, () => handler(envelope));
        break;
      } catch (error) {
        const lastAttempt = attempt === retryPolicy.attempts;
        if (error instanceof NonRetryableError || lastAttempt) {
          stats.failed += 1;
          await sendToDeadLetter(context, error instanceof NonRetryableError ? 'NON_RETRYABLE' : 'RETRIES_EXHAUSTED', error, attempt);
          return;
        }
        stats.retries += 1;
        const delay = backoffDelay(attempt, retryPolicy, random);
        log('warn', `${envelope.eventType} ${envelope.eventId} attempt ${attempt} failed (${error.message}), retrying in ${delay}ms`);
        await sleep(delay);
      }
    }

    stats.processed += 1;
    stats.lastEventAt = new Date().toISOString();

    if (dedupe) {
      try {
        await dedupe.markProcessed(groupId, envelope.eventId, envelope.eventType);
      } catch (error) {
        // The work is done; worst case a redelivery repeats it (handlers stay duplicate-safe)
        log('warn', `Could not record ${envelope.eventId} as processed: ${error.message}`);
      }
    }
  }

  async function start() {
    await consumer.connect();
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }
    await consumer.run({ eachMessage: handleMessage });
    started = true;
    log('info', `Consuming ${topics.join(', ')} as group ${groupId}`);
  }

  async function stop() {
    ready = false;
    if (started) {
      await consumer.disconnect();
      log('info', 'Consumer disconnected');
    }
  }

  return {
    name,
    groupId,
    start,
    stop,
    handleMessage,
    isReady: () => ready,
    getStats: () => ({ ...stats, ready })
  };
}

module.exports = { createEventConsumer, backoffDelay, DEFAULT_RETRY };
