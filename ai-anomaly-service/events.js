// Consumer-side reading of backend events. The contracts live in the backend
// (backend/src/events/contracts, catalogued in backend/src/events/EVENTS.md); this service
// builds from its own Docker context, so it keeps just what it needs to read them.
//
// Two shapes can be on the topic:
//  - envelope v1:  { eventId, eventType: 'ATTENDANCE_CHECKED_OUT', eventVersion, organizationId, data: {...} }
//  - legacy (pre-contract) flat messages: { eventType: 'CHECKED_OUT', organizationId, userId, ... }
// Legacy messages can still be sitting on the topic after a deploy, so both are accepted.

const LEGACY_ATTENDANCE_TYPES = {
  CHECKED_IN: 'ATTENDANCE_CHECKED_IN',
  CHECKED_OUT: 'ATTENDANCE_CHECKED_OUT'
};

// Event types + versions this service knows how to handle
const SUPPORTED = {
  ATTENDANCE_CHECKED_OUT: [1]
};

// Returns { eventId, eventType, eventVersion, organizationId, data } or null if unreadable
function parseEvent(rawValue) {
  let message;
  try {
    message = JSON.parse(rawValue.toString());
  } catch (error) {
    return null;
  }

  if (message && message.eventId && message.data && typeof message.data === 'object') {
    return {
      eventId: message.eventId,
      eventType: message.eventType,
      eventVersion: message.eventVersion,
      organizationId: message.organizationId,
      data: message.data
    };
  }

  if (message && LEGACY_ATTENDANCE_TYPES[message.eventType]) {
    const { eventType, organizationId, occurredAt, ...data } = message;
    return {
      eventId: null,
      eventType: LEGACY_ATTENDANCE_TYPES[eventType],
      eventVersion: 1, // legacy fields are a superset of what v1 needs here
      organizationId,
      data
    };
  }

  return null;
}

// Unknown types are expected (other events on the topic); an unknown *version* of a known
// type means the producer moved ahead of this service and is worth a log line.
function isSupported(event) {
  const versions = SUPPORTED[event.eventType];
  return { known: !!versions, supported: !!versions && versions.includes(event.eventVersion) };
}

module.exports = { parseEvent, isSupported, SUPPORTED };
