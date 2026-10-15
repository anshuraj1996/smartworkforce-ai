// Consumer-driven contract check across services: what the backend produces must be readable
// by ai-anomaly-service's parser, and the legacy (pre-contract) messages still on the topic
// after a deploy must keep working too.
const { buildEvent, getDefinition } = require('../../events/contracts');
const { parseEvent, isSupported } = require('../../../../ai-anomaly-service/events');

const ORG = '11111111-1111-4111-8111-111111111111';
const asKafkaValue = (obj) => Buffer.from(JSON.stringify(obj));

describe('ai-anomaly-service reads backend events', () => {
  it('parses a current ATTENDANCE_CHECKED_OUT envelope and supports it', () => {
    const { envelope } = buildEvent('ATTENDANCE_CHECKED_OUT', ORG, getDefinition('ATTENDANCE_CHECKED_OUT').example);

    const event = parseEvent(asKafkaValue(envelope));

    expect(event).toEqual(expect.objectContaining({
      eventId: envelope.eventId,
      eventType: 'ATTENDANCE_CHECKED_OUT',
      eventVersion: 1,
      organizationId: ORG
    }));
    expect(event.data.userId).toBe(envelope.data.userId);
    expect(isSupported(event)).toEqual({ known: true, supported: true });
  });

  it('still reads a legacy flat CHECKED_OUT message', () => {
    const legacy = { eventType: 'CHECKED_OUT', organizationId: ORG, userId: 'u-1', attendanceLogId: 'l-1', date: '2026-09-24', workingMinutes: 480, occurredAt: '2026-09-24T18:00:00Z' };

    const event = parseEvent(asKafkaValue(legacy));

    expect(event).toEqual(expect.objectContaining({ eventType: 'ATTENDANCE_CHECKED_OUT', organizationId: ORG, eventId: null }));
    expect(event.data).toEqual(expect.objectContaining({ userId: 'u-1', workingMinutes: 480 }));
    expect(event.data.eventType).toBeUndefined();
  });

  it('ignores other attendance events and flags an unsupported version', () => {
    const checkIn = parseEvent(asKafkaValue(buildEvent('ATTENDANCE_CHECKED_IN', ORG, getDefinition('ATTENDANCE_CHECKED_IN').example).envelope));
    expect(isSupported(checkIn)).toEqual({ known: false, supported: false });

    const future = { ...buildEvent('ATTENDANCE_CHECKED_OUT', ORG, getDefinition('ATTENDANCE_CHECKED_OUT').example).envelope, eventVersion: 2 };
    expect(isSupported(parseEvent(asKafkaValue(future)))).toEqual({ known: true, supported: false });
  });

  it('returns null for garbage instead of throwing', () => {
    expect(parseEvent(Buffer.from('not json'))).toBeNull();
    expect(parseEvent(asKafkaValue({ hello: 'world' }))).toBeNull();
  });
});
