const repositories = require('../repositories');
const { buildEvent } = require('./contracts');

// publish(EVENT_TYPES.WFH_APPROVED, organizationId, { ... }) for services.
//
// Builds and validates the event exactly as before, but instead of sending it to Kafka it
// inserts it into outbox_events. Called inside withTransaction(), the insert commits or rolls
// back together with the business write - no event without the change, no change without
// the event. The outbox relay (worker) does the actual Kafka publishing.
//
// Unlike the old direct publish, this does NOT swallow errors: a contract violation or a
// failed insert rolls back the caller's transaction. Producer contracts are covered by
// __tests__/events/producers.test.js, so a contract error here means a bug, not bad input.
function createOutboxPublisher({ outboxRepository }) {
  return async function publish(eventType, organizationId, data, options = {}) {
    const { topic, key, headers, envelope } = buildEvent(eventType, organizationId, data, options);
    await outboxRepository.add({ eventId: envelope.eventId, eventType, topic, key, envelope, headers });
    return true;
  };
}

const publish = createOutboxPublisher({
  get outboxRepository() { return repositories.outboxRepository; }
});

module.exports = { publish, createOutboxPublisher };
