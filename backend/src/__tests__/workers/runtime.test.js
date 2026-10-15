const http = require('http');
const { createEventConsumer, backoffDelay } = require('../../workers/runtime/eventConsumer');
const { NonRetryableError } = require('../../workers/runtime/errors');
const { deadLetterTopic, buildDeadLetterMessage, createDeadLetterPublisher } = require('../../workers/runtime/deadLetter');
const { createScheduledJob } = require('../../workers/runtime/scheduler');
const { createHealthServer } = require('../../workers/runtime/healthServer');
const { buildEvent, getDefinition } = require('../../events/contracts');

const ORG = '11111111-1111-4111-8111-111111111111';
const quietLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// A kafkajs consumer stand-in: records listeners/subscriptions, never touches a broker
const fakeKafka = () => {
  const listeners = {};
  const consumer = {
    events: { GROUP_JOIN: 'join', CRASH: 'crash', DISCONNECT: 'disconnect' },
    on: (event, fn) => { listeners[event] = fn; },
    connect: jest.fn(),
    subscribe: jest.fn(),
    run: jest.fn(),
    disconnect: jest.fn()
  };
  return { kafka: { consumer: jest.fn(() => consumer) }, consumer, emit: (e) => listeners[e]() };
};

const message = (envelope, offset = '0') => ({
  topic: 'smartai.announcement.events',
  partition: 0,
  message: { offset, value: Buffer.from(typeof envelope === 'string' ? envelope : JSON.stringify(envelope)) }
});

const announcement = () => buildEvent('ANNOUNCEMENT_CREATED', ORG, getDefinition('ANNOUNCEMENT_CREATED').example).envelope;

describe('createEventConsumer', () => {
  const build = (handlers, options = {}) => {
    const fake = fakeKafka();
    const deadLetter = jest.fn().mockResolvedValue();
    const sleep = jest.fn().mockResolvedValue();
    const worker = createEventConsumer({
      kafka: fake.kafka, name: 'test-worker', groupId: 'test-group', topics: ['a', 'b'],
      handlers, deadLetter, sleep, random: () => 0.5, logger: quietLogger, ...options
    });
    return { worker, deadLetter, sleep, ...fake };
  };

  it('refuses to start without a dead-letter publisher (failures must never be dropped)', () => {
    expect(() => createEventConsumer({ kafka: fakeKafka().kafka, name: 'x', groupId: 'g', topics: [], handlers: {}, logger: quietLogger }))
      .toThrow('deadLetter publisher is required');
  });

  it('dispatches a valid envelope to the handler for its eventType', async () => {
    const handler = jest.fn();
    const { worker, deadLetter } = build({ ANNOUNCEMENT_CREATED: handler });
    const envelope = announcement();

    await worker.handleMessage(message(envelope));

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ eventId: envelope.eventId, organizationId: ORG, data: envelope.data }));
    expect(deadLetter).not.toHaveBeenCalled();
    expect(worker.getStats()).toEqual(expect.objectContaining({ processed: 1, failed: 0, retries: 0 }));
  });

  it('ignores event types it has no handler for', async () => {
    const { worker, deadLetter } = build({});

    await worker.handleMessage(message(announcement()));

    expect(worker.getStats()).toEqual(expect.objectContaining({ ignored: 1, processed: 0 }));
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it('dead-letters unparseable and contract-invalid messages straight away, without retrying', async () => {
    const handler = jest.fn();
    const { worker, deadLetter, sleep } = build({ ANNOUNCEMENT_CREATED: handler });

    await worker.handleMessage(message('not json'));
    await worker.handleMessage(message({ ...announcement(), data: { title: 'missing fields' } }));
    await worker.handleMessage(message({ eventType: 'CREATED', organizationId: ORG })); // legacy flat message

    expect(handler).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledTimes(3);
    expect(deadLetter).toHaveBeenCalledWith(expect.objectContaining({ reason: 'INVALID_MESSAGE', attempts: 0, topic: 'smartai.announcement.events' }));
    expect(worker.getStats()).toEqual(expect.objectContaining({ invalid: 3, deadLettered: 3 }));
  });

  it('retries a transient failure with exponential backoff, then succeeds', async () => {
    const handler = jest.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce();
    const { worker, deadLetter, sleep } = build({ ANNOUNCEMENT_CREATED: handler });

    await worker.handleMessage(message(announcement()));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(c => c[0])).toEqual([200, 400]); // jitter fixed at 1.0x
    expect(deadLetter).not.toHaveBeenCalled();
    expect(worker.getStats()).toEqual(expect.objectContaining({ processed: 1, retries: 2, failed: 0 }));
  });

  it('dead-letters after the last attempt fails', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('db down'));
    const { worker, deadLetter } = build({ ANNOUNCEMENT_CREATED: handler });

    await worker.handleMessage(message(announcement(), '42'));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(deadLetter).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'RETRIES_EXHAUSTED',
      attempts: 3,
      error: expect.objectContaining({ message: 'db down' }),
      message: expect.objectContaining({ offset: '42' })
    }));
    expect(worker.getStats()).toEqual(expect.objectContaining({ failed: 1, deadLettered: 1, processed: 0 }));
  });

  it('skips retries for a NonRetryableError', async () => {
    const handler = jest.fn().mockRejectedValue(new NonRetryableError('policy was deleted'));
    const { worker, deadLetter, sleep } = build({ ANNOUNCEMENT_CREATED: handler });

    await worker.handleMessage(message(announcement()));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledWith(expect.objectContaining({ reason: 'NON_RETRYABLE', attempts: 1 }));
  });

  it('lets a failed dead-letter write propagate, so the offset is not committed and Kafka redelivers', async () => {
    const { worker, deadLetter } = build({ ANNOUNCEMENT_CREATED: jest.fn().mockRejectedValue(new Error('db down')) });
    deadLetter.mockRejectedValue(new Error('kafka down'));

    await expect(worker.handleMessage(message(announcement()))).rejects.toThrow('kafka down');
  });

  describe('idempotency (dedupe by eventId)', () => {
    const dedupeStore = () => {
      const seen = new Set();
      return {
        isProcessed: jest.fn(async (group, id) => seen.has(`${group}:${id}`)),
        markProcessed: jest.fn(async (group, id) => { seen.add(`${group}:${id}`); })
      };
    };

    it('runs the handler once for a redelivered event', async () => {
      const handler = jest.fn();
      const dedupe = dedupeStore();
      const { worker } = build({ ANNOUNCEMENT_CREATED: handler }, { dedupe });
      const envelope = announcement();

      await worker.handleMessage(message(envelope, '1'));
      await worker.handleMessage(message(envelope, '1')); // redelivery after a rebalance

      expect(handler).toHaveBeenCalledTimes(1);
      expect(dedupe.markProcessed).toHaveBeenCalledWith('test-group', envelope.eventId, 'ANNOUNCEMENT_CREATED');
      expect(worker.getStats()).toEqual(expect.objectContaining({ processed: 1, duplicates: 1 }));
    });

    it('does not mark a dead-lettered event as processed, so a later replay runs it', async () => {
      const handler = jest.fn().mockRejectedValueOnce(new NonRetryableError('bad')).mockResolvedValueOnce();
      const { worker } = build({ ANNOUNCEMENT_CREATED: handler }, { dedupe: dedupeStore() });
      const envelope = announcement();

      await worker.handleMessage(message(envelope));
      await worker.handleMessage(message(envelope)); // replayed from the DLQ after the fix

      expect(handler).toHaveBeenCalledTimes(2);
      expect(worker.getStats().processed).toBe(1);
    });

    it('propagates a dedupe-check failure (database down) so the message is redelivered', async () => {
      const handler = jest.fn();
      const { worker } = build({ ANNOUNCEMENT_CREATED: handler }, {
        dedupe: { isProcessed: jest.fn().mockRejectedValue(new Error('db down')), markProcessed: jest.fn() }
      });

      await expect(worker.handleMessage(message(announcement()))).rejects.toThrow('db down');
      expect(handler).not.toHaveBeenCalled();
    });

    it('still counts the event as processed if recording it fails (handlers are duplicate-safe)', async () => {
      const { worker } = build({ ANNOUNCEMENT_CREATED: jest.fn() }, {
        dedupe: { isProcessed: jest.fn().mockResolvedValue(false), markProcessed: jest.fn().mockRejectedValue(new Error('db blip')) }
      });

      await expect(worker.handleMessage(message(announcement()))).resolves.toBeUndefined();
      expect(worker.getStats().processed).toBe(1);
    });
  });

  it('subscribes to every topic with its own group and tracks readiness from group membership', async () => {
    const { worker, kafka, consumer, emit } = build({});

    await worker.start();

    expect(kafka.consumer).toHaveBeenCalledWith({ groupId: 'test-group' });
    expect(consumer.subscribe).toHaveBeenCalledWith({ topic: 'a', fromBeginning: false });
    expect(consumer.subscribe).toHaveBeenCalledWith({ topic: 'b', fromBeginning: false });
    expect(worker.isReady()).toBe(false);

    emit('join');
    expect(worker.isReady()).toBe(true);
    emit('crash');
    expect(worker.isReady()).toBe(false);

    await worker.stop();
    expect(consumer.disconnect).toHaveBeenCalled();
  });
});

describe('backoffDelay', () => {
  it('doubles per attempt, is capped, and jitters within 20%', () => {
    const policy = { initialDelayMs: 200, maxDelayMs: 1000 };
    expect([1, 2, 3, 4, 5].map(a => backoffDelay(a, policy, () => 0.5))).toEqual([200, 400, 800, 1000, 1000]);
    expect(backoffDelay(1, policy, () => 0)).toBe(160);
    expect(backoffDelay(1, policy, () => 1)).toBe(240);
  });
});

describe('dead-letter messages', () => {
  it('keep the original key, value and headers and add why/where it failed', () => {
    const original = { key: Buffer.from('user-1'), value: Buffer.from('{"x":1}'), offset: '7', headers: { 'event-type': 'ANNOUNCEMENT_CREATED' } };

    const dlq = buildDeadLetterMessage({
      topic: 'smartai.announcement.events',
      partition: 2,
      message: original,
      consumerGroup: 'notification-consumer-group',
      reason: 'RETRIES_EXHAUSTED',
      error: new Error('x'.repeat(600)),
      attempts: 3,
      failedAt: new Date('2026-10-08T10:00:00Z')
    });

    expect(deadLetterTopic('smartai.announcement.events')).toBe('smartai.announcement.events.dlq');
    expect(dlq.key).toBe(original.key);
    expect(dlq.value).toBe(original.value);
    expect(dlq.headers).toEqual(expect.objectContaining({
      'event-type': 'ANNOUNCEMENT_CREATED',
      'dlq-reason': 'RETRIES_EXHAUSTED',
      'dlq-original-topic': 'smartai.announcement.events',
      'dlq-original-partition': '2',
      'dlq-original-offset': '7',
      'dlq-consumer-group': 'notification-consumer-group',
      'dlq-attempts': '3',
      'dlq-failed-at': '2026-10-08T10:00:00.000Z'
    }));
    expect(dlq.headers['dlq-error'].length).toBe(503); // truncated to 500 + "..."
  });

  it('are sent to "<topic>.dlq" by the publisher', async () => {
    const producer = { send: jest.fn().mockResolvedValue() };
    const deadLetter = createDeadLetterPublisher({ producer, consumerGroup: 'g' });

    await deadLetter({ topic: 't', partition: 0, message: { key: null, value: Buffer.from('v'), offset: '1' }, reason: 'INVALID_MESSAGE', error: new Error('bad'), attempts: 0 });

    expect(producer.send).toHaveBeenCalledWith({
      topic: 't.dlq',
      messages: [expect.objectContaining({ headers: expect.objectContaining({ 'dlq-reason': 'INVALID_MESSAGE' }) })]
    });
  });
});

describe('createScheduledJob', () => {
  it('rejects an invalid cron expression', () => {
    expect(() => createScheduledJob({ name: 'x', schedule: 'every day', run: jest.fn(), logger: quietLogger })).toThrow('Invalid cron schedule');
  });

  it('skips a tick that overlaps a run still in progress', async () => {
    let finish;
    const run = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const job = createScheduledJob({ name: 'slow', schedule: '* * * * *', run, logger: quietLogger });

    const first = job.runOnce();
    await job.runOnce();
    finish('done');
    await first;

    expect(run).toHaveBeenCalledTimes(1);
    expect(job.getStats()).toEqual(expect.objectContaining({ runs: 1, skippedOverlaps: 1, lastResult: 'done' }));
  });

  it('records a failed run instead of throwing', async () => {
    const job = createScheduledJob({ name: 'boom', schedule: '* * * * *', run: jest.fn().mockRejectedValue(new Error('nope')), logger: quietLogger });

    await expect(job.runOnce()).resolves.toBeNull();
    expect(job.getStats().failures).toBe(1);
  });
});

describe('createHealthServer', () => {
  const get = (port, path) => new Promise((resolve) => {
    http.get({ port, path }, (res) => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
  });

  it('is live immediately and ready only when every component is ready', async () => {
    let ready = false;
    const components = [
      { name: 'consumer', isReady: () => ready, getStats: () => ({ processed: 3 }) },
      { name: 'job', isReady: () => true, getStats: () => ({ runs: 1 }) }
    ];
    const health = createHealthServer({ port: 0, components, logger: quietLogger });
    await health.start();
    const { port } = health.server.address();

    expect((await get(port, '/livez')).status).toBe(200);
    expect(await get(port, '/readyz')).toEqual({ status: 503, body: { ready: false, notReady: ['consumer'] } });

    ready = true;
    expect((await get(port, '/readyz')).status).toBe(200);
    expect((await get(port, '/stats')).body).toEqual({ consumer: { processed: 3 }, job: { runs: 1 } });

    await health.stop();
  });
});
