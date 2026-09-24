const { Kafka } = require('kafkajs');
const { validateEvent } = require('./contracts');

// Same "infrastructure is not a source of truth" philosophy as the Redis cache wrapper -
// a Kafka outage (or a malformed event) must never break check-in/leave/WFH/announcement
// flows, since publishing happens after the real DB write already succeeded. publishEvent()
// always resolves, logs on failure, and never throws.

const kafka = new Kafka({
  clientId: 'smartworkforce-backend',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: { retries: 2 }
});

const producer = kafka.producer();
let connected = false;
let connecting = null;

async function ensureConnected() {
  if (connected) return true;
  if (!connecting) {
    connecting = producer.connect()
      .then(() => {
        connected = true;
        console.log('Kafka producer connected');
      })
      .catch((err) => {
        console.error('Kafka producer connection failed, events will be dropped:', err.message);
      })
      .finally(() => {
        connecting = null;
      });
  }
  await connecting;
  return connected;
}

// Kick off the connection at startup rather than waiting for the first publish call.
ensureConnected();

async function publishEvent(topic, payload) {
  try {
    validateEvent(topic, payload);
  } catch (error) {
    console.error('Event contract violation, not publishing:', error.message);
    return false;
  }

  const ok = await ensureConnected();
  if (!ok) return false;

  try {
    await producer.send({
      topic,
      messages: [{ key: payload.organizationId, value: JSON.stringify(payload) }]
    });
    return true;
  } catch (error) {
    console.error(`Failed to publish event to ${topic}:`, error.message);
    return false;
  }
}

module.exports = { publishEvent };
