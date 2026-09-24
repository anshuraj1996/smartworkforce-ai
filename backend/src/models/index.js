const { sequelize } = require('../database/config');

// Import all models
const Organization = require('./Organization');
const User = require('./User');
const Shift = require('./Shift');
const AttendanceLog = require('./AttendanceLog');
const LeaveRequest = require('./LeaveRequest');
const AiInsight = require('./AiInsight');
const AuditLog = require('./AuditLog');
const WfhRequest = require('./WfhRequest');
const Notification = require('./Notification');
const Announcement = require('./Announcement');
const Certification = require('./Certification');

// Define associations
const defineAssociations = () => {
  // Organization associations
  Organization.hasMany(User, {
    foreignKey: 'organizationId',
    as: 'users',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(Shift, {
    foreignKey: 'organizationId',
    as: 'shifts',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(AttendanceLog, {
    foreignKey: 'organizationId',
    as: 'attendanceLogs',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(LeaveRequest, {
    foreignKey: 'organizationId',
    as: 'leaveRequests',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(AiInsight, {
    foreignKey: 'organizationId',
    as: 'aiInsights',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(AuditLog, {
    foreignKey: 'organizationId',
    as: 'auditLogs',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(WfhRequest, {
    foreignKey: 'organizationId',
    as: 'wfhRequests',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(Notification, {
    foreignKey: 'organizationId',
    as: 'notifications',
    onDelete: 'CASCADE'
  });

  Organization.hasMany(Announcement, {
    foreignKey: 'organizationId',
    as: 'announcements',
    onDelete: 'CASCADE'
  });

  // User associations
  User.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  // Self-referencing association for manager
  User.belongsTo(User, {
    foreignKey: 'managerId',
    as: 'manager'
  });

  User.hasMany(User, {
    foreignKey: 'managerId',
    as: 'subordinates'
  });

  User.hasMany(AttendanceLog, {
    foreignKey: 'userId',
    as: 'attendanceLogs',
    onDelete: 'CASCADE'
  });

  User.hasMany(LeaveRequest, {
    foreignKey: 'userId',
    as: 'leaveRequests',
    onDelete: 'CASCADE'
  });

  User.hasMany(LeaveRequest, {
    foreignKey: 'approvedBy',
    as: 'approvedLeaveRequests'
  });

  User.hasMany(AiInsight, {
    foreignKey: 'userId',
    as: 'aiInsights',
    onDelete: 'CASCADE'
  });

  User.hasMany(AiInsight, {
    foreignKey: 'actionTakenBy',
    as: 'actionTakenInsights'
  });

  User.hasMany(AuditLog, {
    foreignKey: 'actorId',
    as: 'auditLogs'
  });

  User.hasMany(WfhRequest, {
    foreignKey: 'userId',
    as: 'wfhRequests',
    onDelete: 'CASCADE'
  });

  User.hasMany(WfhRequest, {
    foreignKey: 'approvedBy',
    as: 'approvedWfhRequests'
  });

  User.hasMany(Notification, {
    foreignKey: 'userId',
    as: 'notifications',
    onDelete: 'CASCADE'
  });

  User.hasMany(Announcement, {
    foreignKey: 'createdBy',
    as: 'announcements'
  });

  User.hasMany(Certification, {
    foreignKey: 'userId',
    as: 'certifications',
    onDelete: 'CASCADE'
  });

  // Shift associations
  Shift.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  // AttendanceLog associations
  AttendanceLog.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  AttendanceLog.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });

  // LeaveRequest associations
  LeaveRequest.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  LeaveRequest.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });

  LeaveRequest.belongsTo(User, {
    foreignKey: 'approvedBy',
    as: 'approver'
  });

  // AiInsight associations
  AiInsight.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  AiInsight.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });

  AiInsight.belongsTo(User, {
    foreignKey: 'actionTakenBy',
    as: 'actionTaker'
  });

  // AuditLog associations
  AuditLog.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  AuditLog.belongsTo(User, {
    foreignKey: 'actorId',
    as: 'actor'
  });

  // WfhRequest associations
  WfhRequest.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  WfhRequest.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });

  WfhRequest.belongsTo(User, {
    foreignKey: 'approvedBy',
    as: 'approver'
  });

  // Notification associations
  Notification.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  Notification.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });

  // Announcement associations
  Announcement.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  Announcement.belongsTo(User, {
    foreignKey: 'createdBy',
    as: 'author'
  });

  // Certification associations
  Certification.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });
};

// Initialize associations
defineAssociations();

// Export all models and sequelize instance
module.exports = {
  sequelize,
  Organization,
  User,
  Shift,
  AttendanceLog,
  LeaveRequest,
  AiInsight,
  AuditLog,
  WfhRequest,
  Notification,
  Announcement,
  Certification,

  // Helper function to sync all models
  syncDatabase: async (options = {}) => {
    try {
      await sequelize.authenticate();
      console.log('Database connection established successfully.');
      
      if (options.force) {
        console.log('Dropping and recreating all tables...');
        await sequelize.sync({ force: true });
      } else if (options.alter) {
        console.log('Altering tables to match models...');
        await sequelize.sync({ alter: true });
      } else {
        console.log('Syncing database models...');
        await sequelize.sync();
      }
      
      console.log('Database sync completed successfully.');
    } catch (error) {
      console.error('Unable to connect to the database:', error);
      throw error;
    }
  },

  // Helper function to close database connection
  closeDatabase: async () => {
    await sequelize.close();
    console.log('Database connection closed.');
  }
};