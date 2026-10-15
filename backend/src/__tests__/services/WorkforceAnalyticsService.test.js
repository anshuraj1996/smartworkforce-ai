jest.mock('../../repositories', () => ({}));
jest.mock('../../services/AnalyticsService', () => ({}));
jest.mock('../../services/AttendanceService', () => ({}));
jest.mock('../../services/LeaveService', () => ({}));
jest.mock('../../utils/cache', () => ({ withCache: jest.fn() }));

const { WorkforceAnalyticsService } = require('../../services/WorkforceAnalyticsService');
const { ForbiddenError, NotFoundError } = require('../../utils/errors');
const { users, record } = require('../helpers');

const build = () => {
  const deps = {
    userRepository: {
      findActiveMemberIds: jest.fn().mockResolvedValue(['emp-1', 'emp-2']),
      findInOrg: jest.fn()
    },
    attendanceRepository: {
      findForUsersOnDate: jest.fn().mockResolvedValue([record({ userId: 'emp-1', attendanceType: 'PRESENT' })]),
      findForUsersSince: jest.fn().mockResolvedValue([]),
      checkInMinutesForUsers: jest.fn(async (ids) => new Map(ids.map(id => [id, []])))
    },
    leaveRepository: { countPendingForUsers: jest.fn().mockResolvedValue(1) },
    wfhRepository: { countPendingForUsers: jest.fn().mockResolvedValue(2) },
    aiInsightRepository: {},
    healthRepository: {},
    insights: {},
    attendanceService: { getAttendanceHistory: jest.fn().mockResolvedValue({ data: [] }) },
    leaveService: {},
    getMetrics: jest.fn(),
    cache: { withCache: jest.fn() }
  };
  return { service: new WorkforceAnalyticsService(deps), deps };
};

describe('WorkforceAnalyticsService access scoping', () => {
  it("stops a manager from viewing another manager's team", async () => {
    const { service } = build();

    await expect(service.getTeamOverview(users.manager, 'mgr-2')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.getTeamPerformance(users.manager, 'mgr-2')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a manager see their own team and HR see any team', async () => {
    const { service } = build();

    const own = await service.getTeamOverview(users.manager, 'mgr-1');
    await expect(service.getTeamOverview(users.hr, 'mgr-2')).resolves.toBeDefined();

    expect(own).toEqual(expect.objectContaining({ teamSize: 2, activeToday: 1, teamAttendance: 50, pendingApprovals: 3 }));
  });

  it('limits per-user analytics to direct reports for managers', async () => {
    const { service, deps } = build();

    deps.userRepository.findInOrg.mockResolvedValue({ id: 'emp-9', managerId: 'mgr-2' });
    await expect(service.getUserAttendance(users.manager, 'emp-9', {})).rejects.toBeInstanceOf(ForbiddenError);

    deps.userRepository.findInOrg.mockResolvedValue(null);
    await expect(service.getUserPerformance(users.hr, 'ghost')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exports only the employee\'s own attendance for an EMPLOYEE', async () => {
    const { service, deps } = build();

    await service.getExportRows(users.employee, 'dashboard');

    expect(deps.userRepository.findActiveMemberIds).not.toHaveBeenCalled();
    expect(deps.attendanceRepository.findForUsersOnDate).toHaveBeenCalledWith(['emp-1'], expect.any(String));
  });

  it('scopes manager member lists to direct reports', async () => {
    const { service, deps } = build();

    await service.scopedMemberIds(users.manager);
    await service.scopedMemberIds(users.hr);

    expect(deps.userRepository.findActiveMemberIds).toHaveBeenNthCalledWith(1, 'org-1', 'mgr-1');
    expect(deps.userRepository.findActiveMemberIds).toHaveBeenNthCalledWith(2, 'org-1', null);
  });
});
