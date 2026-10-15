jest.mock('../../repositories', () => ({}));
jest.mock('../../services/AttendanceService', () => ({}));
jest.mock('../../utils/cache', () => ({ withCache: jest.fn() }));

const { UserService } = require('../../services/UserService');
const { ValidationError, ForbiddenError, ConflictError } = require('../../utils/errors');
const { users, record, updatingRepo } = require('../helpers');

const build = () => {
  const deps = {
    userRepository: updatingRepo({
      findInOrg: jest.fn(),
      findByEmailInOrg: jest.fn().mockResolvedValue(null),
      findByEmployeeIdInOrg: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(async (ids) => ids.length),
      deactivateMany: jest.fn(async (ids) => ids.length),
      search: jest.fn().mockResolvedValue({ count: 0, rows: [] })
    }),
    auditLogRepository: { record: jest.fn() },
    attendanceRepository: {},
    leaveRepository: {},
    wfhRepository: {},
    certificationRepository: {},
    attendanceService: {},
    cache: { withCache: jest.fn() },
    publish: jest.fn()
  };
  return { service: new UserService(deps), deps };
};

describe('UserService.bulkUpdate (privilege escalation guard)', () => {
  it('drops role, organizationId, password and isActive from the update', async () => {
    const { service, deps } = build();

    await service.bulkUpdate(users.hr, ['u1', 'u2'], {
      department: 'Finance',
      role: 'ADMIN',
      organizationId: 'org-evil',
      password: 'hacked',
      isActive: false
    });

    expect(deps.userRepository.updateMany).toHaveBeenCalledWith(['u1', 'u2'], 'org-1', { department: 'Finance' });
  });

  it('rejects an update with no allowed fields', async () => {
    const { service, deps } = build();

    await expect(service.bulkUpdate(users.hr, ['u1'], { role: 'ADMIN' })).rejects.toBeInstanceOf(ValidationError);
    expect(deps.userRepository.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a manager from another organization', async () => {
    const { service, deps } = build();
    deps.userRepository.findInOrg.mockResolvedValue(null);

    await expect(service.bulkAssignManager(users.hr, ['u1'], 'foreign-mgr')).rejects.toThrow('Manager not found in this organization');
  });

  it('never lets an admin bulk-deactivate themselves', async () => {
    const { service, deps } = build();

    await service.bulkDeactivate(users.admin, ['u1', 'adm-1']);

    expect(deps.userRepository.deactivateMany).toHaveBeenCalledWith(['u1'], 'org-1');
  });
});

describe('UserService.updateUser', () => {
  it('stops HR from granting the ADMIN role', async () => {
    const { service, deps } = build();
    deps.userRepository.findInOrg.mockResolvedValue(record({ id: 'u1', role: 'EMPLOYEE', name: 'Sam' }));

    await expect(service.updateUser(users.hr, 'u1', { role: 'ADMIN' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(deps.userRepository.update).not.toHaveBeenCalled();
  });

  it('lets an ADMIN grant ADMIN and audits it as a ROLE_CHANGE', async () => {
    const { service, deps } = build();
    deps.userRepository.findInOrg.mockResolvedValue(record({ id: 'u1', role: 'EMPLOYEE', name: 'Sam' }));

    await service.updateUser(users.admin, 'u1', { role: 'ADMIN' });

    expect(deps.auditLogRepository.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_CHANGE' }));
  });

  it('stops HR from editing an admin account and a user managing themselves', async () => {
    const { service, deps } = build();

    deps.userRepository.findInOrg.mockResolvedValue(record({ id: 'adm-2', role: 'ADMIN', name: 'Root' }));
    await expect(service.updateUser(users.hr, 'adm-2', { name: 'x' })).rejects.toThrow('Only administrators can update admin accounts');

    deps.userRepository.findInOrg.mockResolvedValue(record({ id: 'u1', role: 'EMPLOYEE', name: 'Sam' }));
    await expect(service.updateUser(users.hr, 'u1', { managerId: 'u1' })).rejects.toThrow('cannot be their own manager');
  });

  it('refuses to deactivate your own account', async () => {
    const { service } = build();

    await expect(service.setActive(users.admin, 'adm-1', false)).rejects.toThrow('cannot deactivate your own account');
  });
});

describe('UserService.createUser', () => {
  const body = { name: 'Neha', email: 'neha@acme.test', employeeId: 'E100', password: 'secret123' };

  it('rejects the ADMIN role and duplicate emails', async () => {
    const { service, deps } = build();

    await expect(service.createUser(users.hr, { ...body, role: 'ADMIN' })).rejects.toBeInstanceOf(ValidationError);

    deps.userRepository.findByEmailInOrg.mockResolvedValue({ id: 'existing' });
    await expect(service.createUser(users.hr, body)).rejects.toBeInstanceOf(ConflictError);
  });

  it('creates an EMPLOYEE by default with a lower-cased email', async () => {
    const { service, deps } = build();

    await service.createUser(users.hr, { ...body, email: 'Neha@Acme.Test' });

    expect(deps.userRepository.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'EMPLOYEE', email: 'neha@acme.test', organizationId: 'org-1' }));
  });
});

describe('UserService.searchMembers', () => {
  it('forces managers onto their own direct reports', async () => {
    const { service, deps } = build();

    await service.searchMembers(users.manager, { managerId: 'mgr-2' });

    expect(deps.userRepository.search).toHaveBeenCalledWith('org-1', expect.objectContaining({ managerId: 'mgr-1' }));
  });
});
