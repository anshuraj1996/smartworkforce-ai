// The batch insight path (one query for many users) must give exactly the same results as
// the per-user path it replaced (three queries per user).
jest.mock('../../repositories', () => ({}));
jest.mock('../../utils/cache', () => ({ withCache: jest.fn() }));
jest.mock('../../services/NotificationService', () => ({}));

const { AnalyticsService } = require('../../services/AnalyticsService');
const { WorkforceAnalyticsService } = require('../../services/WorkforceAnalyticsService');
const { daysAgoStr } = require('../../utils/dates');

// 80 days of history per user with a few unusual days, so every insight has enough data
function history(userId, variant) {
  return Array.from({ length: 80 }, (_, i) => {
    const late = (i + variant) % 4 === 0;
    const longDay = (i + variant) % 13 === 0;
    return {
      userId,
      date: daysAgoStr(80 - i),
      checkInTime: late ? '09:35:00' : '08:55:00',
      checkOutTime: longDay ? '22:30:00' : '17:30:00'
    };
  });
}

// u3 has only its last 5 days: enough for the lateness insight, too few for behaviour (10) or anomaly (20)
const DATA = { u1: history('u1', 0), u2: history('u2', 1), u3: history('u3', 2).slice(-5) };

// Fake repository answering both the per-user and the batch query from the same data
const fakeAttendanceRepository = () => ({
  findForUserSince: jest.fn(async (userId, orgId, since) => (DATA[userId] || []).filter(r => r.date >= since)),
  findForUsersSince: jest.fn(async (userIds, since) => userIds.flatMap(id => (DATA[id] || []).filter(r => r.date >= since)))
});

describe('AnalyticsService.generateForUsers', () => {
  it('matches the per-user generators exactly, using a single query', async () => {
    const repo = fakeAttendanceRepository();
    const service = new AnalyticsService({ attendanceRepository: repo });
    const userIds = ['u1', 'u2', 'u3'];

    const batch = await service.generateForUsers(userIds, 'org-1');

    expect(repo.findForUsersSince).toHaveBeenCalledTimes(1);
    expect(repo.findForUsersSince).toHaveBeenCalledWith(userIds, daysAgoStr(90), { organizationId: 'org-1' });

    for (const id of userIds) {
      expect(batch.get(id)).toEqual({
        late: await service.generateLateArrivalInsight(id, 'org-1'),
        behavior: await service.generateBehaviorPatternInsight(id, 'org-1'),
        anomaly: await service.generateAnomalyDetection(id, 'org-1')
      });
    }
    // Sanity: the data really produces insights for the full-history users, and none for u3
    expect(batch.get('u1').anomaly).not.toBeNull();
    expect(batch.get('u3')).toEqual({ late: expect.anything(), behavior: null, anomaly: null });
  });

  it('returns an empty map without querying for no users', async () => {
    const repo = fakeAttendanceRepository();
    const result = await new AnalyticsService({ attendanceRepository: repo }).generateForUsers([], 'org-1');

    expect(result.size).toBe(0);
    expect(repo.findForUsersSince).not.toHaveBeenCalled();
  });
});

describe('WorkforceAnalyticsService query counts', () => {
  const build = () => {
    const attendanceRepository = {
      ...fakeAttendanceRepository(),
      checkInMinutesForUsers: jest.fn(async (ids) => new Map(ids.map(id => [id, [535, 540, 545]])))
    };
    const insights = new AnalyticsService({ attendanceRepository });
    const service = new WorkforceAnalyticsService({
      userRepository: {
        findActiveMembers: jest.fn().mockResolvedValue([{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }, { id: 'u3', name: 'C' }])
      },
      attendanceRepository,
      insights,
      cache: {}
    });
    return { service, attendanceRepository };
  };

  it('builds team performance metrics with one check-in query for the whole team', async () => {
    const { service, attendanceRepository } = build();

    const metrics = await service.buildPerformanceMetrics(['u1', 'u2', 'u3']);

    expect(attendanceRepository.checkInMinutesForUsers).toHaveBeenCalledTimes(1);
    expect(metrics.productivityScore).toBe(96);
  });

  it('lists organization anomalies with one attendance query instead of one per employee', async () => {
    const { service, attendanceRepository } = build();

    const anomalies = await service.getOrganizationAnomalies({ organizationId: 'org-1', role: 'HR' });

    expect(attendanceRepository.findForUsersSince).toHaveBeenCalledTimes(1);
    expect(attendanceRepository.findForUserSince).not.toHaveBeenCalled();
    expect(anomalies.map(a => a.userId)).toEqual(expect.arrayContaining(['u1', 'u2']));
  });
});
