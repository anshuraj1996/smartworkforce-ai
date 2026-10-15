// Inspect and replay dead-lettered events.
//
//   npm run dlq -- list   smartai.announcement.events.dlq
//   npm run dlq -- replay smartai.announcement.events.dlq [--dry-run] [--include-invalid]
//
// list   - reads the whole DLQ with a throwaway consumer group; changes nothing.
// replay - republishes each dead letter to its original topic (dlq-original-topic header),
//          minus the dlq-* headers, plus dlq-replayed-at. Uses the fixed consumer group
//          "dlq-replayer", whose committed offsets mean every dead letter is replayed once even
//          if you run this twice; consumers' eventId dedupe makes a repeat harmless anyway.
//          INVALID_MESSAGE dead letters are skipped unless --include-invalid (a malformed message
//          would only bounce straight back).
//
// Exits once the topic has been idle for a few seconds. Fix the cause before replaying!
require('dotenv').config();
const { createKafka } = require('../src/events/kafkaClient');

const IDLE_EXIT_MS = 4000;

const headerValues = (headers = {}) =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v == null ? null : v.toString()]));

// What gets sent back to the original topic, or null to skip
function buildReplayMessage(message, { includeInvalid = false, now = new Date() } = {}) {
  const headers = headerValues(message.headers);
  const originalTopic = headers['dlq-original-topic'];
  if (!originalTopic) return null;
  if (headers['dlq-reason'] === 'INVALID_MESSAGE' && !includeInvalid) return null;

  const cleanHeaders = Object.fromEntries(Object.entries(headers).filter(([k]) => !k.startsWith('dlq-')));
  return {
    topic: originalTopic,
    message: {
      key: message.key,
      value: message.value,
      headers: { ...cleanHeaders, 'dlq-replayed-at': now.toISOString() }
    }
  };
}

function describe(message) {
  const h = headerValues(message.headers);
  let eventType = h['event-type'];
  let eventId = h['event-id'];
  if (!eventType) {
    try {
      const body = JSON.parse(message.value.toString());
      eventType = body.eventType;
      eventId = body.eventId;
    } catch {
      eventType = '(unparseable)';
    }
  }
  return `${h['dlq-failed-at'] || '?'}  ${String(h['dlq-reason']).padEnd(17)} ${eventType} ${eventId || ''}\n` +
    `    from ${h['dlq-original-topic']}[${h['dlq-original-partition']}]@${h['dlq-original-offset']} ` +
    `group=${h['dlq-consumer-group']} attempts=${h['dlq-attempts']}\n    error: ${h['dlq-error']}`;
}

async function consumeUntilIdle(consumer, topic, onMessage) {
  await consumer.subscribe({ topic, fromBeginning: true });
  let idleTimer;
  await new Promise((resolve, reject) => {
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(resolve, IDLE_EXIT_MS);
    };
    resetIdle();
    consumer.run({
      eachMessage: async ({ message }) => {
        resetIdle();
        await onMessage(message);
      }
    }).catch(reject);
  });
  clearTimeout(idleTimer);
}

async function main() {
  const [command, topic] = process.argv.slice(2);
  const dryRun = process.argv.includes('--dry-run');
  const includeInvalid = process.argv.includes('--include-invalid');

  if (!['list', 'replay'].includes(command) || !topic || !topic.endsWith('.dlq')) {
    console.error('Usage: npm run dlq -- <list|replay> <topic>.dlq [--dry-run] [--include-invalid]');
    process.exit(1);
  }

  const kafka = createKafka('smartworkforce-dlq-tool', { logLevel: 1 });
  const groupId = command === 'list' ? `dlq-viewer-${Date.now()}` : 'dlq-replayer';
  const consumer = kafka.consumer({ groupId });
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  await consumer.connect();
  if (command === 'replay' && !dryRun) await producer.connect();

  let seen = 0;
  let replayed = 0;
  let skipped = 0;

  try {
    await consumeUntilIdle(consumer, topic, async (message) => {
      seen += 1;
      if (command === 'list') {
        console.log(describe(message));
        return;
      }

      const replay = buildReplayMessage(message, { includeInvalid });
      if (!replay) {
        skipped += 1;
        return;
      }
      if (!dryRun) {
        await producer.send({ topic: replay.topic, messages: [replay.message] });
      }
      replayed += 1;
      console.log(`${dryRun ? '[dry-run] would replay' : 'replayed'} -> ${replay.topic}: ${describe(message).split('\n')[0]}`);
    });
  } finally {
    await consumer.disconnect();
    await producer.disconnect().catch(() => {});
  }

  console.log(command === 'list'
    ? `\n${seen} dead letter(s) in ${topic}`
    : `\n${replayed} replayed${dryRun ? ' (dry run)' : ''}, ${skipped} skipped, from ${seen} new dead letter(s)`);
}

module.exports = { buildReplayMessage, describe };

if (require.main === module) {
  main().catch((error) => {
    console.error('[dlq] Failed:', error.message);
    process.exit(1);
  });
}
