const { createNotificationHandlers } = require('../../workers/handlers/notificationHandlers');
const { buildEvent, getDefinition } = require('../../events/contracts');

const ORG = '11111111-1111-4111-8111-111111111111';
const quietLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// A real, contract-valid envelope with some data fields overridden
const event = (type, overrides = {}) =>
  buildEvent(type, ORG, { ...getDefinition(type).example, ...overrides }).envelope;

const build = () => {
  const deps = {
    userRepository: {
      findActiveInOrg: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'hr-1' }]),
      findById: jest.fn(),
      findActiveMembers: jest.fn().mockResolvedValue([])
    },
    policyRepository: { findByIdInOrg: jest.fn() },
    notifier: { notify: jest.fn(), notifyMany: jest.fn() }
  };
  return { handlers: createNotificationHandlers({ ...deps, logger: quietLogger }), deps };
};

describe('notification worker handlers', () => {
  it('ANNOUNCEMENT_CREATED notifies everyone in the organization, tagged with the eventId', async () => {
    const { handlers, deps } = build();
    const e = event('ANNOUNCEMENT_CREATED');

    await handlers.ANNOUNCEMENT_CREATED(e);

    expect(deps.userRepository.findActiveInOrg).toHaveBeenCalledWith(ORG);
    expect(deps.notifier.notifyMany).toHaveBeenCalledWith(['u1', 'u2', 'hr-1'], ORG, expect.objectContaining({
      category: 'ANNOUNCEMENT', message: e.data.title, metadata: expect.objectContaining({ eventId: e.eventId })
    }));
  });

  it('JOB_OPENING_POSTED notifies everyone except the poster', async () => {
    const { handlers, deps } = build();
    const poster = '22222222-2222-4222-8222-222222222222';
    deps.userRepository.findActiveInOrg.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: poster }]);

    await handlers.JOB_OPENING_POSTED(event('JOB_OPENING_POSTED', { postedBy: poster }));

    expect(deps.notifier.notifyMany).toHaveBeenCalledWith(['u1', 'u2'], ORG, expect.objectContaining({ title: 'New job opening' }));
  });

  describe('policies', () => {
    const policy = (overrides = {}) => ({ id: 'p1', title: 'WFH rules', version: 2, isActive: true, requiresAcknowledgement: true, ...overrides });

    it('POLICY_PUBLISHED asks everyone to acknowledge, using the policy title', async () => {
      const { handlers, deps } = build();
      deps.policyRepository.findByIdInOrg.mockResolvedValue(policy());

      await handlers.POLICY_PUBLISHED(event('POLICY_PUBLISHED'));

      expect(deps.notifier.notifyMany).toHaveBeenCalledWith(['u1', 'u2', 'hr-1'], ORG, expect.objectContaining({
        title: 'New policy published', message: 'Please read and acknowledge "WFH rules" (v2)'
      }));
    });

    it('POLICY_UPDATED only re-notifies on a content change of an active policy', async () => {
      const { handlers, deps } = build();
      deps.policyRepository.findByIdInOrg.mockResolvedValue(policy());

      await handlers.POLICY_UPDATED(event('POLICY_UPDATED', { contentChanged: false }));
      await handlers.POLICY_UPDATED(event('POLICY_UPDATED', { contentChanged: true, isActive: false }));
      expect(deps.notifier.notifyMany).not.toHaveBeenCalled();

      await handlers.POLICY_UPDATED(event('POLICY_UPDATED', { contentChanged: true }));
      expect(deps.notifier.notifyMany).toHaveBeenCalledWith(expect.any(Array), ORG, expect.objectContaining({ title: 'Policy updated' }));
    });

    it('skips policies that need no acknowledgement or no longer exist', async () => {
      const { handlers, deps } = build();

      deps.policyRepository.findByIdInOrg.mockResolvedValueOnce(policy({ requiresAcknowledgement: false }));
      await handlers.POLICY_PUBLISHED(event('POLICY_PUBLISHED'));
      deps.policyRepository.findByIdInOrg.mockResolvedValueOnce(null);
      await handlers.POLICY_PUBLISHED(event('POLICY_PUBLISHED'));

      expect(deps.notifier.notifyMany).not.toHaveBeenCalled();
    });
  });

  it('EMPLOYEE_JOINED tells the manager, by name', async () => {
    const { handlers, deps } = build();
    const e = event('EMPLOYEE_JOINED');
    deps.userRepository.findById.mockResolvedValue({ id: e.data.userId, name: 'Neha Rao' });

    await handlers.EMPLOYEE_JOINED(e);

    expect(deps.notifier.notify).toHaveBeenCalledWith(e.data.managerId, ORG, expect.objectContaining({ message: 'Neha Rao has joined your team' }));
  });

  it('EMPLOYEE_JOINED without a manager notifies nobody', async () => {
    const { handlers, deps } = build();

    await handlers.EMPLOYEE_JOINED(event('EMPLOYEE_JOINED', { managerId: null }));

    expect(deps.notifier.notify).not.toHaveBeenCalled();
  });

  it('EMPLOYEE_BIRTHDAY wishes the employee and tells their manager + teammates (not themselves)', async () => {
    const { handlers, deps } = build();
    const e = event('EMPLOYEE_BIRTHDAY');
    deps.userRepository.findById.mockResolvedValue({ id: e.data.userId, name: 'Asha', managerId: 'mgr-1', isActive: true });
    deps.userRepository.findActiveMembers.mockResolvedValue([{ id: e.data.userId }, { id: 'mate-1' }, { id: 'mate-2' }]);

    await handlers.EMPLOYEE_BIRTHDAY(e);

    expect(deps.notifier.notify).toHaveBeenCalledWith(e.data.userId, ORG, expect.objectContaining({ title: 'Happy birthday! 🎂' }));
    expect(deps.notifier.notifyMany).toHaveBeenCalledWith(['mgr-1', 'mate-1', 'mate-2'], ORG, expect.objectContaining({ title: 'Team birthday' }));
  });

  it('EMPLOYEE_BIRTHDAY for a deactivated employee does nothing', async () => {
    const { handlers, deps } = build();
    deps.userRepository.findById.mockResolvedValue({ id: 'x', isActive: false });

    await handlers.EMPLOYEE_BIRTHDAY(event('EMPLOYEE_BIRTHDAY'));

    expect(deps.notifier.notify).not.toHaveBeenCalled();
  });
});
