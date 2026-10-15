jest.mock('../../repositories', () => ({}));

const jwt = require('jsonwebtoken');
const { AuthService } = require('../../services/AuthService');
const { UnauthorizedError, ConflictError, ValidationError } = require('../../utils/errors');
const { record, updatingRepo } = require('../helpers');

const account = (passwordOk = true) => record({
  id: 'emp-1',
  organizationId: 'org-1',
  role: 'EMPLOYEE',
  comparePassword: jest.fn().mockResolvedValue(passwordOk)
});

const build = () => {
  const deps = {
    userRepository: updatingRepo({
      findActiveByEmail: jest.fn(),
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn()
    }),
    organizationRepository: updatingRepo({ findActive: jest.fn().mockResolvedValue({ id: 'org-1' }) }),
    auditLogRepository: { record: jest.fn() }
  };
  return { service: new AuthService(deps), deps };
};

describe('AuthService.login', () => {
  it('gives the same 401 for an unknown email and a wrong password', async () => {
    const { service, deps } = build();

    deps.userRepository.findActiveByEmail.mockResolvedValue(null);
    const unknown = await service.login('x@acme.test', 'pw').catch(e => e);

    deps.userRepository.findActiveByEmail.mockResolvedValue(account(false));
    const wrong = await service.login('asha@acme.test', 'pw').catch(e => e);

    expect(unknown).toBeInstanceOf(UnauthorizedError);
    expect(wrong).toBeInstanceOf(UnauthorizedError);
    expect(unknown.message).toBe(wrong.message);
  });

  it('issues a token carrying user, org and role, and writes a LOGIN audit entry', async () => {
    const { service, deps } = build();
    deps.userRepository.findActiveByEmail.mockResolvedValue(account());

    const result = await service.login('asha@acme.test', 'pw', { ipAddress: '10.0.0.5', userAgent: 'jest' });

    expect(jwt.decode(result.token)).toEqual(expect.objectContaining({ userId: 'emp-1', organizationId: 'org-1', role: 'EMPLOYEE' }));
    expect(deps.auditLogRepository.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN', ipAddress: '10.0.0.5', userAgent: 'jest' }));
  });

  it('refuses login when the organization is inactive', async () => {
    const { service, deps } = build();
    deps.userRepository.findActiveByEmail.mockResolvedValue(account());
    deps.organizationRepository.findActive.mockResolvedValue(null);

    await expect(service.login('asha@acme.test', 'pw')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('AuthService other flows', () => {
  it('409s registering an existing email', async () => {
    const { service, deps } = build();
    deps.userRepository.findByEmail.mockResolvedValue({ id: 'someone' });

    await expect(service.register({ organizationName: 'Acme', name: 'A', email: 'a@acme.test', password: 'pw1234' }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('400s a wrong current password', async () => {
    const { service, deps } = build();
    deps.userRepository.findById.mockResolvedValue(account(false));

    await expect(service.changePassword('emp-1', 'old', 'new-password')).rejects.toBeInstanceOf(ValidationError);
    expect(deps.userRepository.update).not.toHaveBeenCalled();
  });
});
