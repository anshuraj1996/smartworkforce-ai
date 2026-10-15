jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));

const { OrganizationService } = require('../../services/OrganizationService');
const { WfhService } = require('../../services/WfhService');
const { RegularizationService } = require('../../services/RegularizationService');
const { effectiveSettings, settingsSchema, DEFAULT_ORG_SETTINGS } = require('../../config/organizationSettings');
const { runWithTenant, currentTenant, currentOrganizationId } = require('../../utils/tenantContext');
const passThroughCache = require('../../utils/passThroughCache');
const { users, dayFromToday } = require('../helpers');

describe('organization settings', () => {
  it('defaults are the rules every tenant had before (an untouched org behaves as before)', () => {
    expect(effectiveSettings({})).toEqual({ wfhMonthlyQuota: 8, regularizationWindowDays: 30, approvalSlaHours: 24, publicHolidays: [] });
    expect(effectiveSettings(null)).toEqual(effectiveSettings({}));
  });

  it('stored values win; holidays from older string data are normalized and sorted', () => {
    expect(effectiveSettings({ wfhMonthlyQuota: 4, publicHolidays: ['2026-12-25', { date: '2026-10-20', name: 'Diwali' }, { date: 'nope' }] }))
      .toEqual(expect.objectContaining({
        wfhMonthlyQuota: 4,
        publicHolidays: [{ date: '2026-10-20', name: 'Diwali' }, { date: '2026-12-25', name: '' }]
      }));
  });

  it('validation: bounds, date format, no duplicate holiday dates', () => {
    expect(settingsSchema.validate({ wfhMonthlyQuota: 40 }).error).toBeDefined();
    expect(settingsSchema.validate({ approvalSlaHours: 0 }).error).toBeDefined();
    expect(settingsSchema.validate({ publicHolidays: [{ date: '25-12-2026', name: 'x' }] }).error).toBeDefined();
    expect(settingsSchema.validate({ publicHolidays: [{ date: '2026-12-25' }, { date: '2026-12-25' }] }).error).toBeDefined();
    expect(settingsSchema.validate({ wfhMonthlyQuota: 0, publicHolidays: [{ date: '2026-12-25', name: 'Christmas' }] }).error).toBeUndefined();
  });
});

describe('OrganizationService', () => {
  const build = (stored = { defaultShiftStart: '09:00', wfhMonthlyQuota: 8 }) => {
    const org = { id: 'org-1', name: 'Acme', timezone: 'Asia/Kolkata', settings: stored };
    const deps = {
      organizationRepository: {
        findById: jest.fn().mockResolvedValue(org),
        update: jest.fn(async (o, changes) => Object.assign(o, changes))
      },
      auditLogRepository: { record: jest.fn() },
      cache: { ...passThroughCache, cacheDel: jest.fn() }
    };
    return { service: new OrganizationService(deps), deps, org };
  };

  it('returns name, timezone and the effective settings', async () => {
    const { service } = build();
    expect(await service.getSettings('org-1')).toEqual({ name: 'Acme', timezone: 'Asia/Kolkata', ...effectiveSettings({}) });
  });

  it('HR changes the rules: merged into the stored JSON (other keys kept), audited, cache cleared', async () => {
    const { service, deps, org } = build();

    const result = await service.updateSettings(users.hr, { wfhMonthlyQuota: 4, publicHolidays: [{ date: '2026-12-25', name: 'Christmas' }] });

    expect(org.settings).toEqual({ defaultShiftStart: '09:00', wfhMonthlyQuota: 4, publicHolidays: [{ date: '2026-12-25', name: 'Christmas' }] });
    expect(result.wfhMonthlyQuota).toBe(4);
    expect(deps.auditLogRepository.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', entityType: 'ORGANIZATION', actorId: 'hr-1',
      previousValues: expect.objectContaining({ wfhMonthlyQuota: 8 }),
      newValues: expect.objectContaining({ wfhMonthlyQuota: 4 })
    }));
    expect(deps.cache.cacheDel).toHaveBeenCalledWith('org-settings:org-1');
  });

  it('only admins rename the organization or change its timezone; timezones must be real', async () => {
    const { service, org } = build();

    await expect(service.updateSettings(users.hr, { timezone: 'Europe/London' })).rejects.toThrow('Only admins');
    await expect(service.updateSettings(users.admin, { timezone: 'Mars/Olympus' })).rejects.toThrow('Unknown timezone');
    await service.updateSettings(users.admin, { name: '  Acme Corp ', timezone: 'Europe/London' });
    expect(org).toEqual(expect.objectContaining({ name: 'Acme Corp', timezone: 'Europe/London' }));
  });

  it('employees and managers cannot change settings; invalid values are rejected', async () => {
    const { service } = build();
    await expect(service.updateSettings(users.manager, { wfhMonthlyQuota: 2 })).rejects.toThrow('Only HR and admins');
    await expect(service.updateSettings(users.hr, { wfhMonthlyQuota: 99 })).rejects.toThrow('wfhMonthlyQuota');
  });
});

describe('services use the organization\'s own settings', () => {
  const settings = (overrides) => ({ get: jest.fn(async () => ({ ...effectiveSettings({}), ...overrides })) });

  it('WFH quota per organization', async () => {
    const organizationSettings = settings({ wfhMonthlyQuota: 2 });
    const service = new WfhService({
      wfhRepository: {
        findOverlapping: jest.fn().mockResolvedValue(null),
        findApprovedWithin: jest.fn().mockResolvedValue([{ isHalfDay: false, startDate: '2026-01-05', endDate: '2026-01-06' }])
      },
      leaveRepository: { findOverlapping: jest.fn().mockResolvedValue(null) },
      attendanceRepository: {}, userRepository: {}, auditLogRepository: {}, notifier: {}, publish: jest.fn(),
      organizationSettings
    });

    expect(await service.getMonthlyQuotaUsage('emp-1', 'org-1', 1, 2026)).toEqual({ used: 2, quota: 2, remaining: 0 });
    expect(organizationSettings.get).toHaveBeenCalledWith('org-1');
    await expect(service.applyWfh(users.employee, { startDate: dayFromToday(3), endDate: dayFromToday(3), reason: 'Plumber visit at home' }))
      .rejects.toThrow('monthly WFH quota (2/2 days already used)');
  });

  it('regularization window per organization', async () => {
    const service = new RegularizationService({
      regularizationRepository: { findPendingForDay: jest.fn().mockResolvedValue(null) },
      attendanceRepository: {}, leaveRepository: {}, shiftRepository: {}, userRepository: {}, auditLogRepository: {},
      notifier: {}, publish: jest.fn(),
      organizationSettings: settings({ regularizationWindowDays: 7 })
    });

    await expect(service.applyRegularization(users.employee, {
      date: dayFromToday(-10), requestType: 'MARK_PRESENT', requestedCheckIn: '09:00', requestedCheckOut: '18:00',
      reason: 'Forgot to check in that day'
    })).rejects.toThrow('last 7 days');
  });

  it('without a settings provider, services keep the old defaults', () => {
    expect(DEFAULT_ORG_SETTINGS.wfhMonthlyQuota).toBe(8);
    expect(DEFAULT_ORG_SETTINGS.regularizationWindowDays).toBe(30);
  });
});

describe('tenant context', () => {
  it('is visible to everything called inside the unit of work - and only there', async () => {
    const deepCall = async () => { await new Promise(r => setTimeout(r, 1)); return currentOrganizationId(); };

    const inside = await runWithTenant({ organizationId: 'org-1', userId: 'u1', role: 'HR' }, deepCall);

    expect(inside).toBe('org-1');
    expect(currentTenant()).toBeNull();
  });

  it('concurrent requests never see each other\'s tenant', async () => {
    const work = (org) => runWithTenant({ organizationId: org }, async () => {
      await new Promise(r => setTimeout(r, Math.random() * 5));
      return currentOrganizationId();
    });

    expect(await Promise.all(['a', 'b', 'c', 'd'].map(work))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('cannot be changed by the code running inside it', async () => {
    await runWithTenant({ organizationId: 'org-1' }, async () => {
      try { currentTenant().organizationId = 'org-2'; } catch (e) { /* strict mode throws */ }
      expect(currentOrganizationId()).toBe('org-1');
    });
  });
});
