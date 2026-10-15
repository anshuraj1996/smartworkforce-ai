const { buildReplayMessage, describe: describeDeadLetter } = require('../../../scripts/dlq');
const { buildEvent, getDefinition } = require('../../events/contracts');

const ORG = '11111111-1111-4111-8111-111111111111';

const deadLetter = (headers) => ({
  key: Buffer.from('user-1'),
  value: Buffer.from(JSON.stringify({ eventType: 'ANNOUNCEMENT_CREATED', eventId: 'abc' })),
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, Buffer.from(v)]))
});

describe('DLQ replay', () => {
  const base = {
    'event-type': 'ANNOUNCEMENT_CREATED',
    'dlq-reason': 'RETRIES_EXHAUSTED',
    'dlq-original-topic': 'smartai.announcement.events',
    'dlq-original-partition': '0',
    'dlq-original-offset': '9',
    'dlq-error': 'db down'
  };

  it('sends the original message back to its original topic without the dlq-* headers', () => {
    const message = deadLetter(base);

    const replay = buildReplayMessage(message, { now: new Date('2026-10-08T12:00:00Z') });

    expect(replay.topic).toBe('smartai.announcement.events');
    expect(replay.message.key).toBe(message.key);
    expect(replay.message.value).toBe(message.value);
    expect(replay.message.headers).toEqual({ 'event-type': 'ANNOUNCEMENT_CREATED', 'dlq-replayed-at': '2026-10-08T12:00:00.000Z' });
  });

  it('skips malformed messages unless asked (they would only bounce back)', () => {
    const invalid = deadLetter({ ...base, 'dlq-reason': 'INVALID_MESSAGE' });

    expect(buildReplayMessage(invalid)).toBeNull();
    expect(buildReplayMessage(invalid, { includeInvalid: true })).not.toBeNull();
  });

  it('skips anything without an original topic', () => {
    expect(buildReplayMessage(deadLetter({ 'dlq-reason': 'RETRIES_EXHAUSTED' }))).toBeNull();
  });

  it('describes a dead letter for listing', () => {
    expect(describeDeadLetter(deadLetter(base))).toContain('RETRIES_EXHAUSTED');
    expect(describeDeadLetter(deadLetter(base))).toContain('error: db down');
  });
});

describe('publishing with a fixed eventId', () => {
  it('uses the given id, so a re-published event is recognisable as the same event', () => {
    const data = getDefinition('EMPLOYEE_BIRTHDAY').example;
    const id = '5f0d7a8e-3f1c-5e6a-9d2b-7c4e1f0a9b63';

    const first = buildEvent('EMPLOYEE_BIRTHDAY', ORG, data, { eventId: id });
    const again = buildEvent('EMPLOYEE_BIRTHDAY', ORG, data, { eventId: id });

    expect(first.envelope.eventId).toBe(id);
    expect(again.envelope.eventId).toBe(id);
    expect(first.headers['event-id']).toBe(id);
  });
});
