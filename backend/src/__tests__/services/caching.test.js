// How services use the cache: auth context, leave balances, default shift, team views,
// and the invalidation paths that keep them correct. Runs the real cache module on a fake Redis.
jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { fakeCache } = require('../fakeRedis');
const { AuthService } = require('../../services/AuthService');
const { LeaveService } = require('../../services/LeaveService');
const { PolicyService } = require('../../services/PolicyService');
const { AttendanceService } = require('../../services/AttendanceService');
const UserRepository = require('../../repositories/UserRepository');
const { createCacheInvalidationHandlers, WORKFORCE_EVENTS } = require('../../workers/handlers/cacheInvalidationHandlers');
const { CACHE_KEYS } = require('../../utils/cacheKeys');
const { users, record, dayFromToday } = require('../helpers');

describe('AuthService.getAuthContext (2 queries per request -> cached)', () => {
  const build = async () => {
    const { cache, client } = await fakeCache();
    const deps = {
      userRepository: { findActiveById: jest.fn().mockResolvedValue(record({ id: 'emp-1', organizationId: 'org-1', role: 'EMPLOYEE' })) },
      organizationRepository: { findActive: jest.fn().mockResolvedValue(record({ id: 'org-1', name: 'Acme' })) },
      auditLogRepository: {},
      cache
    };
    return { service: new AuthService(deps), deps, cache, client };
  };

  it('loads once, then serves from cache', async () => {
    const { service, deps } = await build();

    const first = await service.getAuthContext('emp-1');
    const second = await service.getAuthContext('emp-1');

    expect(second).toEqual(first);
    expect(first).toEqual({ user: expect.objectContaining({ id: 'emp-1', role: 'EMPLOYEE' }), organization: expect.objectContaining({ name: 'Acme' }) });
    expect(deps.userRepository.findActiveById).toHaveBeenCalledTimes(1);
  });

  it('never caches an inactive user or organization, so reactivation works immediately', async () => {
    const { service, deps, client } = await build();
    deps.userRepository.findActiveById.mockResolvedValueOnce(null);
    expect(await service.getAuthContext('emp-1')).toEqual({ error: 'Invalid or inactive user' });

    deps.organizationRepository.findActive.mockResolvedValueOnce(null);
    expect(await service.getAuthContext('emp-1')).toEqual({ error: 'Organization is inactive' });

    expect(client.store.size).toBe(0);
  });

  it('a user write through UserRepository drops that cached context (role change / deactivation applies next request)', async () => {
    const { service, deps, cache } = await build();
    const repo = new UserRepository({ onChange: (ids) => cache.cacheDel(ids.map(CACHE_KEYS.authContext)) });

    await service.getAuthContext('emp-1');
    await repo.update({ id: 'emp-1', update: jest.fn().mockResolvedValue({}) }, { role: 'MANAGER' });
    await service.getAuthContext('emp-1');

    expect(deps.userRepository.findActiveById).toHaveBeenCalledTimes(2);
  });

  it('bulk user updates drop every affected context, and only when rows changed', async () => {
    const onChange = jest.fn();
    const repo = new UserRepository({ onChange });

    jest.spyOn(repo.model, 'update').mockResolvedValueOnce([2]).mockResolvedValueOnce([0]);
    await repo.updateMany(['u1', 'u2'], 'org-1', { department: 'QA' });
    await repo.updateMany(['u3'], 'org-1', { department: 'QA' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['u1', 'u2']);
  });
});

describe('LeaveService balance caching', () => {
  const build = async () => {
    const { cache, client } = await fakeCache();
    const deps = {
      leaveRepository: {
        findOverlapping: jest.fn().mockResolvedValue(null),
        findForYear: jest.fn().mockResolvedValue([]),
        findByIdInOrg: jest.fn(),
        create: jest.fn(async (data) => ({ id: 'leave-1', ...data })),
        update: jest.fn(async (i, c) => Object.assign(i, c))
      },
      leavePolicyRepository: { findForType: jest.fn(), findActiveForOrg: jest.fn().mockResolvedValue([]) },
      userRepository: { findById: jest.fn().mockResolvedValue({ managerId: 'mgr-1' }) },
      auditLogRepository: { record: jest.fn() },
      notifier: { notify: jest.fn() },
      publish: jest.fn(),
      cache
    };
    return { service: new LeaveService(deps), deps, cache, client };
  };

  it('caches the balance and drops it when the user applies for leave in that year', async () => {
    const { service, deps } = await build();
    const year = Number(dayFromToday(5).slice(0, 4));

    await service.getLeaveBalance('emp-1', 'org-1', year);
    await service.getLeaveBalance('emp-1', 'org-1', year);
    const queriesWhileCached = deps.leaveRepository.findForYear.mock.calls.length;

    await service.applyLeave(users.employee, { startDate: dayFromToday(5), endDate: dayFromToday(5), leaveType: 'ANNUAL', reason: 'Family function' });
    deps.leaveRepository.findForYear.mockClear();
    await service.getLeaveBalance('emp-1', 'org-1', year);

    expect(queriesWhileCached).toBe(2); // one compute = this year + last year
    expect(deps.leaveRepository.findForYear).toHaveBeenCalled(); // recomputed after applying
  });

  it('checks the balance against fresh data when applying, never the cache', async () => {
    const { service, deps, cache } = await build();
    const policy = { leaveType: 'ANNUAL', annualAllocation: '2', carryForwardMax: '0', allowNegativeBalance: false };
    deps.leavePolicyRepository.findForType.mockResolvedValue(policy);
    deps.leavePolicyRepository.findActiveForOrg.mockResolvedValue([policy]);
    const year = Number(dayFromToday(5).slice(0, 4));

    // Cache a balance showing 2 days left, then the data changes underneath (2 days already used)
    await service.getLeaveBalance('emp-1', 'org-1', year);
    deps.leaveRepository.findForYear.mockResolvedValue([{ leaveType: 'ANNUAL', dayCount: '2', status: 'APPROVED' }]);
    expect((await service.getLeaveBalance('emp-1', 'org-1', year))[0].remaining).toBe(2); // stale, from cache
    expect(cache.getStats().hits).toBeGreaterThan(0);

    await expect(service.applyLeave(users.employee, { startDate: dayFromToday(5), endDate: dayFromToday(5), leaveType: 'ANNUAL', reason: 'Family function' }))
      .rejects.toThrow('Insufficient ANNUAL leave balance: 0 day(s) remaining');
  });

  it('a manager decision drops the requester\'s balance for that year and the next (carry-forward)', async () => {
    const { service, deps, client } = await build();
    const start = dayFromToday(5);
    const year = Number(start.slice(0, 4));
    deps.leaveRepository.findByIdInOrg.mockResolvedValue({ id: 'leave-1', organizationId: 'org-1', userId: 'emp-1', leaveType: 'ANNUAL', startDate: start, endDate: start, status: 'PENDING', metadata: {} });

    await service.getLeaveBalance('emp-1', 'org-1', year);
    await service.getLeaveBalance('emp-1', 'org-1', year + 1);
    expect(client.store.size).toBe(2);

    await service.approveLeave('leave-1', users.manager);

    expect([...client.store.keys()].filter(k => k.includes('leave-balance'))).toEqual([]);
  });

  it('changing a leave policy invalidates every balance in that org', async () => {
    const { cache } = await fakeCache();
    const policyService = new PolicyService({
      policyRepository: {}, policyAcknowledgementRepository: {}, userRepository: {},
      leavePolicyRepository: { findForType: jest.fn().mockResolvedValue(null), create: jest.fn(async (d) => record({ id: 'lp-1', ...d })) },
      auditLogRepository: { record: jest.fn() },
      publish: jest.fn(),
      cache
    });

    await policyService.upsertLeavePolicy(users.hr, 'annual', { annualAllocation: 12 });

    expect(await cache.namespaceVersion('leave-policy:org-1')).toBe(1);
    expect(await cache.namespaceVersion('leave-policy:org-2')).toBe(0);
  });
});

describe('AttendanceService caching', () => {
  const build = async () => {
    const { cache } = await fakeCache();
    const deps = {
      attendanceRepository: {
        findForDay: jest.fn().mockResolvedValue(null),
        create: jest.fn(async (d) => record({ id: 'log-1', ...d })),
        update: jest.fn(async (i, c) => Object.assign(i, c)),
        findForUsersOnDate: jest.fn().mockResolvedValue([])
      },
      shiftRepository: { findDefault: jest.fn().mockResolvedValue(record({ startTime: '09:00:00', endTime: '18:00:00', graceMinutes: 15 })) },
      userRepository: { findActiveMembers: jest.fn().mockResolvedValue([{ id: 'emp-1', name: 'Asha' }]) },
      auditLogRepository: { record: jest.fn() },
      publish: jest.fn(),
      cache
    };
    return { service: new AttendanceService(deps), deps, cache };
  };

  it('reads the default shift from the database once, not on every check-in', async () => {
    const { service, deps } = await build();

    await service.checkIn('emp-1', 'org-1');
    await service.getDefaultShift('org-1');
    await service.getDefaultShift('org-1');

    expect(deps.shiftRepository.findDefault).toHaveBeenCalledTimes(1);
  });

  it('team attendance is cached until the org workforce namespace is bumped by the worker', async () => {
    const { service, deps, cache } = await build();
    const bump = createCacheInvalidationHandlers({ cache });

    await service.getTeamAttendance('org-1', '2026-10-08');
    await service.getTeamAttendance('org-1', '2026-10-08');
    expect(deps.attendanceRepository.findForUsersOnDate).toHaveBeenCalledTimes(1);

    await bump.ATTENDANCE_CHECKED_IN({ eventType: 'ATTENDANCE_CHECKED_IN', organizationId: 'org-1', data: {} });
    await service.getTeamAttendance('org-1', '2026-10-08');
    expect(deps.attendanceRepository.findForUsersOnDate).toHaveBeenCalledTimes(2);
  });
});

describe('cache-invalidation worker handlers', () => {
  it('bump only the event\'s own organization', async () => {
    const { cache } = await fakeCache();
    const handlers = createCacheInvalidationHandlers({ cache });

    for (const type of WORKFORCE_EVENTS) {
      await handlers[type]({ eventType: type, organizationId: 'org-1', data: {} });
    }

    expect(await cache.namespaceVersion('workforce:org-1')).toBe(WORKFORCE_EVENTS.length);
    expect(await cache.namespaceVersion('workforce:org-2')).toBe(0);
  });

  it('ignore events that do not change workforce views', () => {
    const handlers = createCacheInvalidationHandlers({ cache: {} });

    expect(handlers.ANNOUNCEMENT_CREATED).toBeUndefined();
    expect(handlers.REGULARIZATION_REQUESTED).toBeUndefined();
  });
});
