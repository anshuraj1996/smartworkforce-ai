const repositories = require('../repositories');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const { NotFoundError } = require('../utils/errors');
const { daysAgoStr } = require('../utils/dates');

const NEW_JOINER_WINDOW_DAYS = 7;

class AnnouncementService {
  constructor({ announcementRepository, userRepository, publish, withTransaction = (fn) => fn() }) {
    this.announcementRepository = announcementRepository;
    this.userRepository = userRepository;
    this.publish = publish;
    this.withTransaction = withTransaction;
  }

  async create(author, { title, body, category = 'GENERAL', isPinned = false, expiresAt = null }) {
    // Announcement and outbox event commit together
    return this.withTransaction(async () => {
      const announcement = await this.announcementRepository.create({
        organizationId: author.organizationId,
        createdBy: author.id,
        title,
        body,
        category,
        isPinned,
        expiresAt
      });

      // Notifying every employee is done asynchronously by the notification worker
      await this.publish(EVENT_TYPES.ANNOUNCEMENT_CREATED, author.organizationId, {
        announcementId: announcement.id,
        title,
        category,
        isPinned: Boolean(isPinned),
        createdBy: author.id
      });

      return announcement;
    });
  }

  list(organizationId) {
    return this.announcementRepository.findActive(organizationId);
  }

  async remove(announcementId, organizationId) {
    const deleted = await this.announcementRepository.deleteInOrg(announcementId, organizationId);

    if (!deleted) {
      throw new NotFoundError('Announcement not found');
    }

    return { deleted: true };
  }

  // Anyone in the org whose birthday (month + day) is today
  async getTodaysBirthdays(organizationId) {
    const users = await this.userRepository.findWithBirthdays(organizationId);
    const today = new Date();

    return users.filter(user => {
      const dob = new Date(user.dateOfBirth);
      return dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate();
    });
  }

  // Employees who joined within the last week, for the "welcome to the team" feed item
  getRecentJoiners(organizationId, windowDays = NEW_JOINER_WINDOW_DAYS) {
    return this.userRepository.findJoinedSince(organizationId, daysAgoStr(windowDays));
  }

  // Combined dashboard feed: announcements + birthdays + new joiners, pinned first
  async getFeed(organizationId) {
    const [announcements, birthdays, newJoiners] = await Promise.all([
      this.list(organizationId),
      this.getTodaysBirthdays(organizationId),
      this.getRecentJoiners(organizationId)
    ]);

    const feed = [
      ...announcements.map(a => ({
        type: 'ANNOUNCEMENT',
        id: a.id,
        title: a.title,
        body: a.body,
        category: a.category,
        isPinned: a.isPinned,
        timestamp: a.createdAt
      })),
      ...birthdays.map(u => ({
        type: 'BIRTHDAY',
        id: u.id,
        title: `${u.name}'s birthday today`,
        body: `Wish ${u.name} from ${u.department || 'the team'} a happy birthday!`,
        timestamp: new Date()
      })),
      ...newJoiners.map(u => ({
        type: 'NEW_JOINER',
        id: u.id,
        title: `Welcome to the team, ${u.name}!`,
        body: `${u.name} joined ${u.department ? `the ${u.department} team` : 'the company'} on ${u.hireDate}`,
        timestamp: u.hireDate
      }))
    ];

    feed.sort((a, b) => (a.isPinned === b.isPinned ? 0 : a.isPinned ? -1 : 1));

    return feed;
  }
}

module.exports = new AnnouncementService({
  announcementRepository: repositories.announcementRepository,
  userRepository: repositories.userRepository,
  publish: outboxPublish,
  withTransaction: dbTransaction
});
module.exports.AnnouncementService = AnnouncementService;
