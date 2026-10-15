// Dead-letter topics: a message a consumer gave up on is copied to "<topic>.dlq" with its
// original key, value and headers, plus dlq-* headers saying why. The consumer then moves on,
// so one bad message can't block a partition forever - and nothing is lost: scripts/dlq.js
// lists and replays dead letters once the cause is fixed.

const deadLetterTopic = (topic) => `${topic}.dlq`;

// Kafka header values must be strings/Buffers; keep error text bounded
const truncate = (text, max = 500) => (text.length > max ? `${text.slice(0, max)}...` : text);

function buildDeadLetterMessage({ topic, partition, message, consumerGroup, reason, error, attempts, failedAt = new Date() }) {
  return {
    key: message.key,
    value: message.value,
    headers: {
      ...(message.headers || {}),
      'dlq-reason': reason,
      'dlq-error': truncate(String((error && error.message) || error)),
      'dlq-original-topic': topic,
      'dlq-original-partition': String(partition),
      'dlq-original-offset': String(message.offset),
      'dlq-consumer-group': consumerGroup,
      'dlq-attempts': String(attempts),
      'dlq-failed-at': failedAt.toISOString()
    }
  };
}

// Returns deadLetter(details) for createEventConsumer. If the DLQ write itself fails it
// throws, so the consumer does NOT commit the offset and Kafka redelivers the original.
function createDeadLetterPublisher({ producer, consumerGroup }) {
  return async function deadLetter({ topic, partition, message, reason, error, attempts }) {
    await producer.send({
      topic: deadLetterTopic(topic),
      messages: [buildDeadLetterMessage({ topic, partition, message, consumerGroup, reason, error, attempts })]
    });
  };
}

module.exports = { deadLetterTopic, buildDeadLetterMessage, createDeadLetterPublisher };
