// Event contracts: the single source of truth for what goes on Kafka.
//
// Each definition names an event type + version, its topic, which data field is the
// partition key, and a Joi schema for `data`. Producers call buildEvent(), which wraps the
// data in the standard envelope (./envelope.js) and rejects anything that doesn't match -
// so a producer bug fails in tests/logs instead of putting a malformed message on a topic.
//
// Versioning rules (see EVENTS.md):
// - Adding an OPTIONAL field is non-breaking: same version.
// - Removing/renaming a field, changing a type, or making a field required is breaking:
//   add a new definition with version + 1 and keep the old one here, so consumers can still
//   validate messages already on the topic. Producers always emit the latest version.
const { envelopeSchema, buildEnvelope } = require('./envelope');
const { TOPICS } = require('./topics');

const DEFINITIONS = [
  ...require('./attendance'),
  ...require('./leave'),
  ...require('./wfh'),
  ...require('./regularization'),
  ...require('./organization'),
  ...require('./hiring'),
  ...require('./report')
];

const versionKey = (type, version) => `${type}@${version}`;
const byTypeAndVersion = new Map(DEFINITIONS.map(d => [versionKey(d.type, d.version), d]));

// Latest version per event type - what producers emit
const latest = new Map();
DEFINITIONS.forEach(d => {
  if (!latest.has(d.type) || latest.get(d.type).version < d.version) {
    latest.set(d.type, d);
  }
});

// EVENT_TYPES.WFH_APPROVED === 'WFH_APPROVED' - use these instead of string literals
const EVENT_TYPES = Object.freeze(Object.fromEntries([...latest.keys()].map(type => [type, type])));

class EventContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EventContractError';
  }
}

function getDefinition(type, version) {
  const definition = version === undefined ? latest.get(type) : byTypeAndVersion.get(versionKey(type, version));
  if (!definition) {
    throw new EventContractError(`No event contract for ${type}${version === undefined ? '' : ` v${version}`}`);
  }
  return definition;
}

function validateData(definition, data) {
  // convert:false - the producer must send exactly the declared types (no "2" for 2)
  const { error, value } = definition.schema.validate(data, { abortEarly: false, convert: false });
  if (error) {
    throw new EventContractError(`${definition.type} v${definition.version}: ${error.details.map(d => d.message).join('; ')}`);
  }
  return value;
}

// Producer side: validate and wrap. Returns what to send: { topic, key, headers, envelope }.
function buildEvent(type, organizationId, data, options) {
  const definition = getDefinition(type);
  const envelope = buildEnvelope(definition, organizationId, validateData(definition, data), options);

  const { error } = envelopeSchema.validate(envelope);
  if (error) {
    throw new EventContractError(`${type} envelope: ${error.message}`);
  }

  return {
    topic: definition.topic,
    // Same key -> same partition -> ordered per key (e.g. all of one employee's attendance)
    key: String(data[definition.key] || organizationId),
    // Lets consumers route/filter without parsing the body
    headers: {
      'event-type': envelope.eventType,
      'event-version': String(envelope.eventVersion),
      'event-id': envelope.eventId
    },
    envelope
  };
}

// Consumer side: validate an incoming envelope against the version it declares.
// Consumers should still ignore unknown fields (forward compatibility), so this is for
// tests, tooling and strict consumers rather than a gate every consumer must pass.
function validateEnvelope(envelope) {
  const { error } = envelopeSchema.validate(envelope, { allowUnknown: true });
  if (error) {
    throw new EventContractError(`Invalid envelope: ${error.message}`);
  }
  validateData(getDefinition(envelope.eventType, envelope.eventVersion), envelope.data);
  return envelope;
}

module.exports = {
  TOPICS,
  EVENT_TYPES,
  DEFINITIONS,
  EventContractError,
  getDefinition,
  buildEvent,
  validateEnvelope
};
