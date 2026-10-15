const { Kafka } = require('kafkajs');

// KAFKA_BROKER may list several brokers ("kafka-0:9092,kafka-1:9092") so a client can
// bootstrap from any of them when one is down.
function brokersFromEnv() {
  return (process.env.KAFKA_BROKER || 'localhost:9092').split(',').map(b => b.trim()).filter(Boolean);
}

function createKafka(clientId, options = {}) {
  return new Kafka({
    clientId,
    brokers: brokersFromEnv(),
    retry: { retries: 2 },
    ...options
  });
}

module.exports = { createKafka, brokersFromEnv };
