const { QueryTypes } = require('sequelize');
const { sequelize } = require('../database/config');
const { ensureSchema } = require('../database/schema');

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
const RegularizationRequest = require('./RegularizationRequest');
const Policy = require('./Policy');
const PolicyAcknowledgement = require('./PolicyAcknowledgement');
const LeavePolicy = require('./LeavePolicy');
const JobOpening = require('./JobOpening');
const Referral = require('./Referral');

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

  // RegularizationRequest associations
  Organization.hasMany(RegularizationRequest, {
    foreignKey: 'organizationId',
    as: 'regularizationRequests',
    onDelete: 'CASCADE'
  });

  User.hasMany(RegularizationRequest, {
    foreignKey: 'userId',
    as: 'regularizationRequests',
    onDelete: 'CASCADE'
  });

  RegularizationRequest.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  RegularizationRequest.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });

  RegularizationRequest.belongsTo(User, {
    foreignKey: 'approvedBy',
    as: 'approver'
  });

  RegularizationRequest.belongsTo(AttendanceLog, {
    foreignKey: 'attendanceLogId',
    as: 'attendanceLog'
  });

  // Policy associations
  Organization.hasMany(Policy, {
    foreignKey: 'organizationId',
    as: 'policies',
    onDelete: 'CASCADE'
  });

  Policy.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  Policy.belongsTo(User, {
    foreignKey: 'createdBy',
    as: 'author'
  });

  Policy.hasMany(PolicyAcknowledgement, {
    foreignKey: 'policyId',
    as: 'acknowledgements',
    onDelete: 'CASCADE'
  });

  PolicyAcknowledgement.belongsTo(Policy, {
    foreignKey: 'policyId',
    as: 'policy'
  });

  PolicyAcknowledgement.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
  });

  User.hasMany(PolicyAcknowledgement, {
    foreignKey: 'userId',
    as: 'policyAcknowledgements',
    onDelete: 'CASCADE'
  });

  // LeavePolicy associations
  Organization.hasMany(LeavePolicy, {
    foreignKey: 'organizationId',
    as: 'leavePolicies',
    onDelete: 'CASCADE'
  });

  LeavePolicy.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  // Hiring associations
  Organization.hasMany(JobOpening, {
    foreignKey: 'organizationId',
    as: 'jobOpenings',
    onDelete: 'CASCADE'
  });

  JobOpening.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization'
  });

  JobOpening.belongsTo(User, {
    foreignKey: 'createdBy',
    as: 'creator'
  });

  JobOpening.hasMany(Referral, {
    foreignKey: 'jobOpeningId',
    as: 'referrals',
    onDelete: 'CASCADE'
  });

  Referral.belongsTo(JobOpening, {
    foreignKey: 'jobOpeningId',
    as: 'jobOpening'
  });

  Referral.belongsTo(User, {
    foreignKey: 'referredBy',
    as: 'referrer'
  });

  User.hasMany(Referral, {
    foreignKey: 'referredBy',
    as: 'referrals'
  });
};

// sequelize.sync() only creates missing tables - it never adds values to a Postgres ENUM that
// already exists, so new values on existing columns are added here before syncing. On a fresh
// database the type doesn't exist yet and sync creates it with every value.
const ENUM_ADDITIONS = [
  {
    table: 'audit_logs',
    column: 'entity_type',
    values: ['REGULARIZATION_REQUEST', 'POLICY', 'LEAVE_POLICY', 'JOB_OPENING', 'REFERRAL']
  }
];

const ensureEnumValues = async () => {
  const schema = sequelize.options.define.schema || 'public';

  for (const { table, column, values } of ENUM_ADDITIONS) {
    const typeName = `enum_${table}_${column}`;
    const [rows] = await sequelize.query(
      'SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = :typeName AND n.nspname = :schema',
      { replacements: { typeName, schema } }
    );

    if (rows.length === 0) continue;

    for (const value of values) {
      await sequelize.query(`ALTER TYPE "${schema}"."${typeName}" ADD VALUE IF NOT EXISTS '${value}'`);
    }
  }
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
  RegularizationRequest,
  Policy,
  PolicyAcknowledgement,
  LeavePolicy,
  JobOpening,
  Referral,

  // Helper function to sync all models
  syncDatabase: async (options = {}) => {
    try {
      await sequelize.authenticate();
      console.log('Database connection established successfully.');

      // A brand-new database has no app schema yet - create it before any table
      const created = await ensureSchema(
        (sql, bind) => sequelize.query(sql, { bind, type: QueryTypes.SELECT }),
        sequelize.options.define.schema
      );
      if (created) console.log(`Created schema "${sequelize.options.define.schema}".`);

      await ensureEnumValues();
      
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