require('dotenv').config();
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');
const { parseEvent, isSupported } = require('./events');
const { createAnomalyJob, isTransientError } = require('./lib/anomalyJob');

// Standalone anomaly-detection microservice. Consumes attendance events and, when an employee's
// day is complete (ATTENDANCE_CHECKED_OUT), runs two detectors against that employee's own
// history (lib/detector.js):
//   - Isolation Forest: is today unusual for this person? (check-in/out, hours, lateness, WFH)
//   - pattern shift:    have the last 10 days changed versus before?
// Findings are written to ai_insights (read by the backend's insight history).

// No default: the database is shared and `public` belongs to another product
const SCHEMA = (process.env.DB_SCHEMA || '').trim();
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('[ai-anomaly-service] DB_SCHEMA must be set to the app schema (e.g. smartai)');
  process.exit(1);
}
const ATTENDANCE_TOPIC = 'smartai.attendance.events';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const job = createAnomalyJob({ query: (sql, params) => pool.query(sql, params), schema: SCHEMA });

const kafka = new Kafka({
  clientId: 'ai-anomaly-service',
  // Comma-separated list allowed, e.g. kafka-0:9092,kafka-1:9092,kafka-2:9092
  brokers: (process.env.KAFKA_BROKER || 'localhost:9092').split(',').map(b => b.trim()),
  retry: { retries: 10, initialRetryTime: 1000 }
});
const consumer = kafka.consumer({ groupId: process.env.KAFKA_CONSUMER_GROUP || 'ai-anomaly-service' });

async function handleEvent(event) {
  const { known, supported } = isSupported(event);
  if (!supported) {
    if (known) {
      console.warn(`[ai-anomaly-service] Unsupported ${event.eventType} version ${event.eventVersion}, skipping`);
    }
    return;
  }
  await job.handleCheckOut(event);
}

async function main() {
  await pool.query('SELECT 1');
  console.log('[ai-anomaly-service] Database connection established');

  await consumer.connect();
  await consumer.subscribe({ topic: ATTENDANCE_TOPIC, fromBeginning: false });
  console.log(`[ai-anomaly-service] Subscribed to ${ATTENDANCE_TOPIC}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = parseEvent(message.value);
      if (!event) {
        console.error('[ai-anomaly-service] Received unreadable event, skipping');
        return;
      }

      try {
        await handleEvent(event);
      } catch (error) {
        // Database briefly unreachable: throw, so kafkajs retries the message instead of the
        // day silently going unchecked. Anything else (bad data, a bug) would fail the same way
        // again - log it and move on rather than block this partition.
        if (isTransientError(error)) throw error;
        console.error('[ai-anomaly-service] Error processing event:', error.message);
      }
    }
  });

  console.log('[ai-anomaly-service] Running');
}

async function shutdown() {
  console.log('[ai-anomaly-service] Shutting down...');
  await consumer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error('[ai-anomaly-service] Fatal startup error:', error);
  process.exit(1);
});
