const { Announcement, User } = require('../models');
const { Op } = require('sequelize');
const NotificationService = require('./NotificationService');
const { publishEvent } = require('../events/kafka');
const { TOPICS } = require('../events/contracts');

const NEW_JOINER_WINDOW_DAYS = 7;

class AnnouncementService {
  static async create(createdBy, organizationId, data) {
    try {
      const { title, body, category = 'GENERAL', isPinned = false, expiresAt = null } = data;

      const announcement = await Announcement.create({
        organizationId,
        createdBy,
        title,
        body,
        category,
        isPinned,
        expiresAt
      });

      const orgUsers = await User.findAll({
        where: { organizationId, isActive: true },
        attributes: ['id']
      });

      await NotificationService.notifyMany(
        orgUsers.map(u => u.id),
        organizationId,
        {
          category: 'ANNOUNCEMENT',
          title: 'New announcement',
          message: title,
          link: '/announcements'
        }
      );

      await publishEvent(TOPICS.ANNOUNCEMENT, {
        eventType: 'CREATED',
        organizationId,
        announcementId: announcement.id,
        title,
        category,
        createdBy,
        occurredAt: new Date().toISOString()
      });

      return announcement;
    } catch (error) {
      console.error('Create announcement error:', error);
      throw new Error(error.message || 'Failed to create announcement');
    }
  }

  static async list(organizationId) {
    try {
      const announcements = await Announcement.findAll({
        where: {
          organizationId,
          [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }]
        },
        order: [['isPinned', 'DESC'], ['createdAt', 'DESC']],
        include: [{
          model: User,
          as: 'author',
          attributes: ['id', 'name']
        }]
      });

      return announcements;
    } catch (error) {
      console.error('List announcements error:', error);
      throw new Error('Failed to get announcements');
    }
  }

  static async remove(announcementId, organizationId) {
    try {
      const deleted = await Announcement.destroy({ where: { id: announcementId, organizationId } });

      if (!deleted) {
        throw new Error('Announcement not found');
      }

      return { deleted: true };
    } catch (error) {
      console.error('Delete announcement error:', error);
      throw new Error(error.message || 'Failed to delete announcement');
    }
  }

  // Anyone in the org whose birthday (month + day) is today
  static async getTodaysBirthdays(organizationId) {
    try {
      const usersWithBirthday = await User.findAll({
        where: { organizationId, isActive: true, dateOfBirth: { [Op.not]: null } },
        attributes: ['id', 'name', 'department', 'dateOfBirth']
      });

      const today = new Date();

      return usersWithBirthday.filter(user => {
        const dob = new Date(user.dateOfBirth);
        return dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate();
      });
    } catch (error) {
      console.error('Get birthdays error:', error);
      throw new Error('Failed to get today\'s birthdays');
    }
  }

  // Employees who joined within the last week, for the "welcome to the team" feed item
  static async getRecentJoiners(organizationId, windowDays = NEW_JOINER_WINDOW_DAYS) {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - windowDays);
      const cutoffStr = cutoff.toISOString().split('T')[0];

      return await User.findAll({
        where: {
          organizationId,
          isActive: true,
          hireDate: { [Op.gte]: cutoffStr }
        },
        attributes: ['id', 'name', 'department', 'hireDate'],
        order: [['hireDate', 'DESC']]
      });
    } catch (error) {
      console.error('Get recent joiners error:', error);
      throw new Error('Failed to get recently joined employees');
    }
  }

  // Combined dashboard feed: announcements + birthdays + new joiners, newest first
  static async getFeed(organizationId) {
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

module.exports = AnnouncementService;
