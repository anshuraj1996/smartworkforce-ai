// Kafka producers - used only by the worker process now. The API never talks to Kafka: services
// write events to the outbox_events table (events/outbox.js) inside their transaction, and the
// outbox relay worker publishes them. So the API runs with Kafka down, and no event is lost.
//
// Idempotent producer: if a send's acknowledgement is lost and the client retries, the broker
// recognises the duplicate (producer id + sequence number) and writes it only once. Requires
// acks=all (kafkajs's default) and at most one in-flight request per connection.
//
// kafkajs logs "Limiting retries for the idempotent producer may invalidate EoS guarantees"
// because the client retries a send only a few times (kafkaClient.js). That's deliberate: the
// outbox relay retries failed batches itself, forever, with backoff - so a short client-level
// retry just hands control back to the relay loop sooner.
function createIdempotentProducer(kafka) {
  return kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
}

module.exports = { createIdempotentProducer };
