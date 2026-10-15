jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { createWithTransaction, currentTransaction, namespace } = require('../../database/transaction');
const { createOutboxPublisher } = require('../../events/outbox');
const { createOutboxRelay, backoffSeconds } = require('../../workers/runtime/outboxRelay');
const { EventContractError, getDefinition } = require('../../events/contracts');
const { LeaveService } = require('../../services/LeaveService');
const { WfhService } = require('../../services/WfhService');
const { users, dayFromToday, record } = require('../helpers');

const ORG = '11111111-1111-4111-8111-111111111111';
const quietLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// Stand-in for sequelize.transaction(fn): opens a CLS context holding a fake transaction,
// like Sequelize does, so currentTransaction() works inside fn
const fakeSequelize = () => {
  let n = 0;
  const sequelize = {
    opened: [],
    transaction: jest.fn((fn) => namespace.run(async () => {
      const tx = { id: `tx-${++n}` };
      sequelize.opened.push(tx.id);
      namespace.set('transaction', tx);
      return fn();
    }))
  };
  return sequelize;
};

describe('ambient transactions (database/transaction.js)', () => {
  it('makes the transaction visible to everything called inside, and nothing outside', async () => {
    const withTransaction = createWithTransaction(fakeSequelize());
    const deepRepositoryCall = async () => currentTransaction();

    const inside = await withTransaction(() => deepRepositoryCall());

    expect(inside).toEqual({ id: 'tx-1' });
    expect(currentTransaction()).toBeNull();
  });

  it('joins an outer transaction instead of opening a second one on another connection', async () => {
    const sequelize = fakeSequelize();
    const withTransaction = createWithTransaction(sequelize);

    const ids = await withTransaction(async () => {
      const outer = currentTransaction().id;
      const inner = await withTransaction(async () => currentTransaction().id);
      return [outer, inner];
    });

    expect(ids).toEqual(['tx-1', 'tx-1']);
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps concurrent requests in separate transactions', async () => {
    const withTransaction = createWithTransaction(fakeSequelize());
    const pause = () => new Promise(resolve => setTimeout(resolve, 5));

    const [a, b] = await Promise.all([
      withTransaction(async () => { await pause(); return currentTransaction().id; }),
      withTransaction(async () => { await pause(); return currentTransaction().id; })
    ]);

    expect(a).not.toBe(b);
  });
});

describe('outbox publisher (events/outbox.js)', () => {
  it('stores the validated envelope, topic, key and headers instead of sending to Kafka', async () => {
    const outboxRepository = { add: jest.fn() };
    const publish = createOutboxPublisher({ outboxRepository });
    const data = getDefinition('WFH_APPROVED').example;

    expect(await publish('WFH_APPROVED', ORG, data)).toBe(true);

    const row = outboxRepository.add.mock.calls[0][0];
    expect(row).toEqual(expect.objectContaining({
      eventType: 'WFH_APPROVED',
      topic: 'smartai.wfh.events',
      key: data.userId,
      headers: expect.objectContaining({ 'event-type': 'WFH_APPROVED' })
    }));
    expect(row.envelope).toEqual(expect.objectContaining({ eventId: row.eventId, organizationId: ORG, data }));
  });

  it('keeps a caller-supplied eventId (deterministic ids dedupe re-publishes)', async () => {
    const outboxRepository = { add: jest.fn() };
    const id = '5f0d7a8e-3f1c-5e6a-9d2b-7c4e1f0a9b63';

    await createOutboxPublisher({ outboxRepository })('EMPLOYEE_BIRTHDAY', ORG, getDefinition('EMPLOYEE_BIRTHDAY').example, { eventId: id });

    expect(outboxRepository.add.mock.calls[0][0].eventId).toBe(id);
  });

  it('throws on a contract violation - so the caller\'s transaction rolls back', async () => {
    const outboxRepository = { add: jest.fn() };

    await expect(createOutboxPublisher({ outboxRepository })('WFH_APPROVED', ORG, { userId: 'nope' }))
      .rejects.toBeInstanceOf(EventContractError);
    expect(outboxRepository.add).not.toHaveBeenCalled();
  });
});

describe('outbox relay (workers/runtime/outboxRelay.js)', () => {
  const row = (id, topic, extra = {}) => ({
    id, topic, event_id: `e-${id}`, event_type: 'X', message_key: `k-${id}`,
    envelope: { eventId: `e-${id}` }, headers: { 'event-id': `e-${id}` }, attempts: 0, ...extra
  });

  const build = (rows, { sendBatch = jest.fn().mockResolvedValue() } = {}) => {
    const outboxRepository = {
      claimPending: jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
      markPublished: jest.fn(),
      markRetry: jest.fn(),
      markFailed: jest.fn(),
      pendingSummary: jest.fn().mockResolvedValue({ pending: 0, oldest_pending_seconds: 0, failed: 0 })
    };
    const producer = { connect: jest.fn(), disconnect: jest.fn(), sendBatch };
    const transactions = [];
    const withTransaction = jest.fn(async (fn) => { transactions.push('tx'); return fn(); });
    // Real (macrotask) yield so the loop test can't spin forever, but no actual waiting
    const sleep = jest.fn(() => new Promise(resolve => setImmediate(resolve)));
    const relay = createOutboxRelay({ outboxRepository, producer, withTransaction, batchSize: 10, logger: quietLogger, sleep });
    return { relay, outboxRepository, producer, withTransaction };
  };

  it('publishes claimed rows in one batch, grouped by topic and kept in insert order, then marks them published', async () => {
    const { relay, outboxRepository, producer, withTransaction } = build([row(1, 'a'), row(2, 'b'), row(3, 'a')]);

    expect(await relay.relayOnce()).toBe(3);

    expect(withTransaction).toHaveBeenCalledTimes(1); // claim + send + mark in one transaction (locks held)
    expect(outboxRepository.claimPending).toHaveBeenCalledWith(10);
    expect(producer.sendBatch).toHaveBeenCalledWith({
      topicMessages: [
        { topic: 'a', messages: [expect.objectContaining({ key: 'k-1', value: JSON.stringify({ eventId: 'e-1' }) }), expect.objectContaining({ key: 'k-3' })] },
        { topic: 'b', messages: [expect.objectContaining({ key: 'k-2', headers: { 'event-id': 'e-2' } })] }
      ]
    });
    expect(outboxRepository.markPublished).toHaveBeenCalledWith([1, 2, 3]);
    expect(relay.getStats()).toEqual(expect.objectContaining({ published: 3, batches: 1 }));
  });

  it('does nothing when the outbox is empty', async () => {
    const { relay, producer } = build([]);

    expect(await relay.relayOnce()).toBe(0);
    expect(producer.sendBatch).not.toHaveBeenCalled();
  });

  it('retries later with growing backoff while Kafka is unavailable - never gives up', async () => {
    const kafkaDown = Object.assign(new Error('Connection error: ECONNREFUSED'), { retriable: true });
    const { relay, outboxRepository } = build([row(1, 'a', { attempts: 4 }), row(2, 'a', { attempts: 1 })], {
      sendBatch: jest.fn().mockRejectedValue(kafkaDown)
    });

    await relay.relayOnce();

    expect(outboxRepository.markRetry).toHaveBeenCalledWith([1, 2], 'Connection error: ECONNREFUSED', 32); // 2^(4+1)
    expect(outboxRepository.markPublished).not.toHaveBeenCalled();
    expect(outboxRepository.markFailed).not.toHaveBeenCalled();
  });

  it('marks rows FAILED only for errors retrying cannot fix', async () => {
    const tooLarge = Object.assign(new Error('Message size too large'), { retriable: false });
    const { relay, outboxRepository } = build([row(1, 'a')], { sendBatch: jest.fn().mockRejectedValue(tooLarge) });

    await relay.relayOnce();

    expect(outboxRepository.markFailed).toHaveBeenCalledWith([1], 'Message size too large');
    expect(relay.getStats().failedRows).toBe(1);
  });

  it('caps the backoff at 60s', () => {
    expect([0, 1, 5, 6, 20].map(backoffSeconds)).toEqual([1, 2, 32, 60, 60]);
  });

  it('runs until stopped, survives a database error, and disconnects its producer', async () => {
    const { relay, outboxRepository, producer } = build([]);
    outboxRepository.claimPending.mockReset()
      .mockRejectedValueOnce(new Error('db restarting'))
      .mockResolvedValue([]);

    await relay.start();
    await new Promise(resolve => setTimeout(resolve, 20));
    await relay.stop();

    expect(producer.connect).toHaveBeenCalled();
    expect(outboxRepository.claimPending.mock.calls.length).toBeGreaterThan(1);
    expect(relay.getStats().lastError).toBe('db restarting');
    expect(producer.disconnect).toHaveBeenCalled();
  });
});

describe('services: write + event commit together, side effects only after commit', () => {
  // A fake transaction that records when it starts/ends, so call order can be checked
  const recorder = () => {
    const log = [];
    const withTransaction = jest.fn(async (fn) => {
      log.push('BEGIN');
      try {
        const result = await fn();
        log.push('COMMIT');
        return result;
      } catch (error) {
        log.push('ROLLBACK');
        throw error;
      }
    });
    return { log, withTransaction };
  };

  const leaveService = (log, withTransaction, publish) => new LeaveService({
    leaveRepository: {
      findOverlapping: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (d) => { log.push('INSERT leave_request'); return { id: 'leave-1', ...d }; }),
      findForYear: jest.fn().mockResolvedValue([])
    },
    leavePolicyRepository: { findForType: jest.fn() },
    userRepository: {},
    auditLogRepository: { record: jest.fn(async () => log.push('INSERT audit_log')) },
    notifier: { notify: jest.fn(async () => log.push('notify manager')) },
    publish,
    withTransaction
  });

  const application = { startDate: dayFromToday(5), endDate: dayFromToday(5), leaveType: 'ANNUAL', reason: 'Family function' };

  it('applying for leave: request, audit and outbox event in one transaction; the notification after commit', async () => {
    const { log, withTransaction } = recorder();
    const publish = jest.fn(async () => log.push('INSERT outbox_event'));

    await leaveService(log, withTransaction, publish).applyLeave(users.employee, application);

    expect(log).toEqual(['BEGIN', 'INSERT leave_request', 'INSERT audit_log', 'INSERT outbox_event', 'COMMIT', 'notify manager']);
  });

  it('if the event cannot be written, nothing is committed and nobody is notified', async () => {
    const { log, withTransaction } = recorder();
    const publish = jest.fn().mockRejectedValue(new Error('outbox insert failed'));

    await expect(leaveService(log, withTransaction, publish).applyLeave(users.employee, application)).rejects.toThrow('outbox insert failed');

    expect(log).toEqual(['BEGIN', 'INSERT leave_request', 'INSERT audit_log', 'ROLLBACK']);
  });

  it('a WFH approval locks the request row and marks attendance inside the same transaction', async () => {
    const { log, withTransaction } = recorder();
    const pending = { id: 'wfh-1', organizationId: 'org-1', userId: 'emp-1', startDate: dayFromToday(1), endDate: dayFromToday(1), isHalfDay: false, status: 'PENDING' };
    const wfhRepository = {
      findByIdInOrg: jest.fn(async () => { log.push('SELECT ... FOR UPDATE'); return pending; }),
      update: jest.fn(async (i, c) => { log.push('UPDATE wfh_request'); return { ...i, ...c }; })
    };
    const service = new WfhService({
      wfhRepository,
      leaveRepository: {},
      attendanceRepository: { setAttendanceType: jest.fn(async () => log.push('UPSERT attendance_log')) },
      userRepository: { findById: jest.fn().mockResolvedValue({ id: 'emp-1', managerId: 'mgr-1' }) },
      auditLogRepository: { record: jest.fn(async () => log.push('INSERT audit_log')) },
      notifier: { notify: jest.fn(async () => log.push('notify employee')) },
      publish: jest.fn(async () => log.push('INSERT outbox_event')),
      withTransaction
    });

    await service.approveWfh('wfh-1', users.manager);

    expect(wfhRepository.findByIdInOrg).toHaveBeenCalledWith('wfh-1', 'org-1', { lock: true });
    expect(log).toEqual(['BEGIN', 'SELECT ... FOR UPDATE', 'UPDATE wfh_request', 'UPSERT attendance_log', 'INSERT audit_log', 'INSERT outbox_event', 'COMMIT', 'notify employee']);
  });

  it('a second approver of the same request gets a 409 after the first commits', async () => {
    const { withTransaction } = recorder();
    const decided = { id: 'wfh-1', organizationId: 'org-1', userId: 'emp-1', status: 'APPROVED' };
    const service = new WfhService({
      wfhRepository: { findByIdInOrg: jest.fn().mockResolvedValue(decided), update: jest.fn() },
      leaveRepository: {}, attendanceRepository: {}, userRepository: {}, auditLogRepository: {},
      notifier: { notify: jest.fn() }, publish: jest.fn(), withTransaction
    });

    await expect(service.approveWfh('wfh-1', users.hr)).rejects.toThrow('WFH request is not pending');
  });
});
