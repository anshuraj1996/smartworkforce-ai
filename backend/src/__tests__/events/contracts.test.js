const fs = require('fs');
const path = require('path');
const {
  DEFINITIONS, TOPICS, EVENT_TYPES, EventContractError, getDefinition, buildEvent, validateEnvelope
} = require('../../events/contracts');
const { render, OUTPUT } = require('../../../scripts/generate-event-catalog');

const ORG = '11111111-1111-4111-8111-111111111111';

describe('event contract definitions', () => {
  it.each(DEFINITIONS.map(d => [`${d.type} v${d.version}`, d]))('%s is well-formed and its example validates', (_label, d) => {
    expect(d.type).toMatch(/^[A-Z]+(_[A-Z]+)+$/);
    expect(Object.values(TOPICS)).toContain(d.topic);
    expect(Number.isInteger(d.version) && d.version >= 1).toBe(true);
    expect(Object.keys(d.schema.describe().keys)).toContain(d.key);
    expect(d.description).toBeTruthy();
    expect(d.producer).toBeTruthy();
    expect(() => buildEvent(d.type, ORG, d.example)).not.toThrow();
  });

  it('has no duplicate type@version', () => {
    const keys = DEFINITIONS.map(d => `${d.type}@${d.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every event named in the phase-2 roadmap', () => {
    const roadmap = [
      'ATTENDANCE_CHECKED_IN', 'ATTENDANCE_CHECKED_OUT', 'LEAVE_APPLIED', 'LEAVE_APPROVED', 'LEAVE_REJECTED',
      'WFH_APPLIED', 'WFH_APPROVED', 'EMPLOYEE_JOINED', 'EMPLOYEE_BIRTHDAY', 'ANNOUNCEMENT_CREATED',
      'REGULARIZATION_REQUESTED', 'REGULARIZATION_APPROVED', 'POLICY_UPDATED'
    ];
    roadmap.forEach(type => expect(EVENT_TYPES[type]).toBe(type));
  });

  // No orphaned contracts: every event type is published somewhere
  it('has a publish call site for every event in services/ or workers/', () => {
    const readAll = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return readAll(full);
      return entry.name.endsWith('.js') ? [fs.readFileSync(full, 'utf8')] : [];
    });
    const source = [
      ...readAll(path.join(__dirname, '..', '..', 'services')),
      ...readAll(path.join(__dirname, '..', '..', 'workers'))
    ].join('\n');

    const missing = Object.keys(EVENT_TYPES).filter(type => !source.includes(`EVENT_TYPES.${type}`));
    expect(missing).toEqual([]);
  });
});

describe('buildEvent', () => {
  const data = getDefinition('WFH_APPROVED').example;

  it('wraps data in a complete envelope with key and headers', () => {
    const event = buildEvent(EVENT_TYPES.WFH_APPROVED, ORG, data);

    expect(event.topic).toBe(TOPICS.WFH);
    expect(event.key).toBe(data.userId);
    expect(event.envelope).toEqual(expect.objectContaining({
      eventType: 'WFH_APPROVED',
      eventVersion: 1,
      envelopeVersion: 1,
      source: 'smartworkforce-backend',
      organizationId: ORG,
      data
    }));
    expect(event.envelope.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(event.envelope.occurredAt).toString()).not.toBe('Invalid Date');
    expect(event.headers).toEqual({ 'event-type': 'WFH_APPROVED', 'event-version': '1', 'event-id': event.envelope.eventId });
  });

  it('gives every event a unique id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => buildEvent('WFH_APPROVED', ORG, data).envelope.eventId));
    expect(ids.size).toBe(50);
  });

  it.each([
    ['an unknown field (catches producer typos)', { ...data, approvdBy: data.approvedBy }, 'not allowed'],
    ['a missing required field', { ...data, approvedBy: undefined }, 'approvedBy'],
    ['a wrong type, even if coercible ("2" for 2)', { ...getDefinition('LEAVE_APPLIED').example, dayCount: '2' }, 'dayCount'],
    ['a non-uuid id', { ...data, userId: 'emp-1' }, 'userId'],
    ['a full timestamp where a date is expected', { ...data, startDate: '2026-09-29T00:00:00.000Z' }, 'startDate']
  ])('rejects %s', (_label, bad, message) => {
    const type = bad.dayCount ? 'LEAVE_APPLIED' : 'WFH_APPROVED';
    expect(() => buildEvent(type, ORG, bad)).toThrow(EventContractError);
    expect(() => buildEvent(type, ORG, bad)).toThrow(message);
  });

  it('rejects unknown event types and a missing organization', () => {
    expect(() => buildEvent('WFH_TELEPORTED', ORG, data)).toThrow('No event contract');
    expect(() => buildEvent('WFH_APPROVED', undefined, data)).toThrow('organizationId');
  });
});

describe('validateEnvelope (consumer side)', () => {
  it('round-trips a produced envelope through JSON', () => {
    const { envelope } = buildEvent('ATTENDANCE_CHECKED_OUT', ORG, getDefinition('ATTENDANCE_CHECKED_OUT').example);
    expect(() => validateEnvelope(JSON.parse(JSON.stringify(envelope)))).not.toThrow();
  });

  it('tolerates envelope fields it does not know yet (forward compatibility)', () => {
    const { envelope } = buildEvent('ATTENDANCE_CHECKED_OUT', ORG, getDefinition('ATTENDANCE_CHECKED_OUT').example);
    expect(() => validateEnvelope({ ...envelope, traceId: 'abc' })).not.toThrow();
  });

  it('rejects a version no contract exists for', () => {
    const { envelope } = buildEvent('ATTENDANCE_CHECKED_OUT', ORG, getDefinition('ATTENDANCE_CHECKED_OUT').example);
    expect(() => validateEnvelope({ ...envelope, eventVersion: 99 })).toThrow('No event contract for ATTENDANCE_CHECKED_OUT v99');
  });
});

describe('EVENTS.md', () => {
  it('is up to date with the contracts (run `npm run events:catalog` if this fails)', () => {
    expect(fs.readFileSync(OUTPUT, 'utf8')).toBe(render());
  });
});
