// Notification fan-out, moved out of the request path: posting an announcement, policy or
// job used to insert one notification per employee inside the HTTP request. Now the request
// only publishes the event and these handlers do the fan-out from the worker.
//
// Events carry ids only (see events/contracts), so names/titles are looked up here.
// eventId is kept in each notification's metadata so Phase 2C can dedupe redeliveries.
function createNotificationHandlers({ userRepository, policyRepository, notifier, logger = console }) {
  const everyoneIn = async (organizationId, excludeUserId = null) =>
    (await userRepository.findActiveInOrg(organizationId))
      .map(u => u.id)
      .filter(id => id !== excludeUserId);

  async function notifyPolicyAudience(event, policyId, title) {
    const policy = await policyRepository.findByIdInOrg(policyId, event.organizationId);
    if (!policy) {
      logger.warn(`[notification-worker] Policy ${policyId} not found, skipping ${event.eventType}`);
      return;
    }
    if (!policy.requiresAcknowledgement || !policy.isActive) return;

    await notifier.notifyMany(await everyoneIn(event.organizationId), event.organizationId, {
      category: 'HR',
      title,
      message: `Please read and acknowledge "${policy.title}" (v${policy.version})`,
      link: '/policies',
      metadata: { policyId: policy.id, version: policy.version, eventId: event.eventId }
    });
  }

  return {
    async ANNOUNCEMENT_CREATED(event) {
      const { announcementId, title } = event.data;
      await notifier.notifyMany(await everyoneIn(event.organizationId), event.organizationId, {
        category: 'ANNOUNCEMENT',
        title: 'New announcement',
        message: title,
        link: '/announcements',
        metadata: { announcementId, eventId: event.eventId }
      });
    },

    async POLICY_PUBLISHED(event) {
      await notifyPolicyAudience(event, event.data.policyId, 'New policy published');
    },

    // Only a content change (new version) needs everyone to re-acknowledge
    async POLICY_UPDATED(event) {
      if (!event.data.contentChanged || !event.data.isActive) return;
      await notifyPolicyAudience(event, event.data.policyId, 'Policy updated');
    },

    async JOB_OPENING_POSTED(event) {
      const { jobOpeningId, title, department, postedBy } = event.data;
      await notifier.notifyMany(await everyoneIn(event.organizationId, postedBy), event.organizationId, {
        category: 'HR',
        title: 'New job opening',
        message: `We're hiring: ${title}${department ? ` (${department})` : ''}. Know someone? Refer them!`,
        link: '/hiring',
        metadata: { jobOpeningId, eventId: event.eventId }
      });
    },

    // Let the new hire's manager know their team grew
    async EMPLOYEE_JOINED(event) {
      const { userId, managerId } = event.data;
      if (!managerId) return;

      const newHire = await userRepository.findById(userId);
      if (!newHire) return;

      await notifier.notify(managerId, event.organizationId, {
        category: 'HR',
        title: 'New team member',
        message: `${newHire.name} has joined your team`,
        link: '/team',
        metadata: { userId, eventId: event.eventId }
      });
    },

    // Birthday wishes to the employee, plus a heads-up to their manager and teammates
    async EMPLOYEE_BIRTHDAY(event) {
      const employee = await userRepository.findById(event.data.userId);
      if (!employee || !employee.isActive) return;

      await notifier.notify(employee.id, event.organizationId, {
        category: 'HR',
        title: 'Happy birthday! 🎂',
        message: `Wishing you a wonderful birthday, ${employee.name}!`,
        link: '/dashboard',
        metadata: { eventId: event.eventId }
      });

      if (!employee.managerId) return;

      const teammates = await userRepository.findActiveMembers(event.organizationId, {
        managerId: employee.managerId,
        attributes: ['id']
      });
      const recipients = [employee.managerId, ...teammates.map(t => t.id)].filter(id => id !== employee.id);

      await notifier.notifyMany([...new Set(recipients)], event.organizationId, {
        category: 'HR',
        title: 'Team birthday',
        message: `It's ${employee.name}'s birthday today - send your wishes!`,
        link: '/dashboard',
        metadata: { userId: employee.id, eventId: event.eventId }
      });
    }
  };
}

module.exports = { createNotificationHandlers };
