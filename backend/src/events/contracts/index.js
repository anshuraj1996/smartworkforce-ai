// Event contracts: one entry per Kafka topic, documenting the eventTypes and required
// fields for that topic's payloads. publishEvent() validates against this before sending,
// so a producer bug fails loudly in logs instead of putting a malformed message on the topic.

const TOPICS = {
  ATTENDANCE: 'smartai.attendance.events',
  LEAVE: 'smartai.leave.events',
  WFH: 'smartai.wfh.events',
  ANNOUNCEMENT: 'smartai.announcement.events'
};

const CONTRACTS = {
  [TOPICS.ATTENDANCE]: {
    eventTypes: ['CHECKED_IN', 'CHECKED_OUT'],
    requiredFields: ['eventType', 'organizationId', 'userId', 'attendanceLogId', 'date', 'occurredAt']
  },
  [TOPICS.LEAVE]: {
    eventTypes: ['APPLIED', 'APPROVED', 'REJECTED'],
    requiredFields: ['eventType', 'organizationId', 'userId', 'leaveRequestId', 'leaveType', 'startDate', 'endDate', 'occurredAt']
  },
  [TOPICS.WFH]: {
    eventTypes: ['APPLIED', 'APPROVED', 'REJECTED'],
    requiredFields: ['eventType', 'organizationId', 'userId', 'wfhRequestId', 'startDate', 'endDate', 'occurredAt']
  },
  [TOPICS.ANNOUNCEMENT]: {
    eventTypes: ['CREATED'],
    requiredFields: ['eventType', 'organizationId', 'announcementId', 'title', 'occurredAt']
  }
};

function validateEvent(topic, payload) {
  const contract = CONTRACTS[topic];
  if (!contract) {
    throw new Error(`No event contract defined for topic "${topic}"`);
  }

  if (!contract.eventTypes.includes(payload.eventType)) {
    throw new Error(`"${payload.eventType}" is not a valid eventType for topic "${topic}" (expected one of: ${contract.eventTypes.join(', ')})`);
  }

  const missing = contract.requiredFields.filter(field => payload[field] === undefined || payload[field] === null);
  if (missing.length > 0) {
    throw new Error(`Event for topic "${topic}" is missing required fields: ${missing.join(', ')}`);
  }
}

module.exports = { TOPICS, CONTRACTS, validateEvent };
