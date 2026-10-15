const { Joi, id, date, role, policyCategory } = require('./fields');
const { TOPICS } = require('./topics');

// Organization-wide events: announcements, policies and employee lifecycle

module.exports = [
  {
    type: 'ANNOUNCEMENT_CREATED',
    version: 1,
    topic: TOPICS.ANNOUNCEMENT,
    key: 'announcementId',
    producer: 'AnnouncementService.create',
    description: 'HR/Admin posted an announcement to the whole organization.',
    schema: Joi.object({
      announcementId: id().required(),
      title: Joi.string().max(255).required(),
      category: Joi.string().valid('GENERAL', 'POLICY', 'FESTIVAL', 'ACHIEVEMENT').required(),
      isPinned: Joi.boolean().required(),
      createdBy: id().required()
    }),
    example: {
      announcementId: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
      title: 'Office closed on Friday',
      category: 'GENERAL',
      isPinned: true,
      createdBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    }
  },
  {
    type: 'POLICY_PUBLISHED',
    version: 1,
    topic: TOPICS.POLICY,
    key: 'policyId',
    producer: 'PolicyService.createPolicy',
    description: 'A new company policy was published (version 1).',
    schema: Joi.object({
      policyId: id().required(),
      category: policyCategory().required(),
      policyVersion: Joi.number().integer().min(1).required(),
      effectiveDate: date().required(),
      requiresAcknowledgement: Joi.boolean().required(),
      publishedBy: id().required()
    }),
    example: {
      policyId: '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e',
      category: 'WFH',
      policyVersion: 1,
      effectiveDate: '2026-10-01',
      requiresAcknowledgement: true,
      publishedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    }
  },
  {
    type: 'POLICY_UPDATED',
    version: 1,
    topic: TOPICS.POLICY,
    key: 'policyId',
    producer: 'PolicyService.updatePolicy',
    description: 'A policy was edited. contentChanged=true means a new policyVersion that employees must acknowledge again.',
    schema: Joi.object({
      policyId: id().required(),
      policyVersion: Joi.number().integer().min(1).required(),
      previousPolicyVersion: Joi.number().integer().min(1).required(),
      contentChanged: Joi.boolean().required(),
      isActive: Joi.boolean().required(),
      updatedBy: id().required()
    }),
    example: {
      policyId: '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e',
      policyVersion: 2,
      previousPolicyVersion: 1,
      contentChanged: true,
      isActive: true,
      updatedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    }
  },
  {
    type: 'POLICY_ARCHIVED',
    version: 1,
    topic: TOPICS.POLICY,
    key: 'policyId',
    producer: 'PolicyService.archivePolicy',
    description: 'A policy was archived and is no longer shown to employees.',
    schema: Joi.object({
      policyId: id().required(),
      archivedBy: id().required()
    }),
    example: {
      policyId: '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e',
      archivedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    }
  },
  {
    type: 'EMPLOYEE_JOINED',
    version: 1,
    topic: TOPICS.EMPLOYEE,
    key: 'userId',
    producer: 'UserService.createUser',
    description: 'HR/Admin added a new employee to the organization.',
    schema: Joi.object({
      userId: id().required(),
      role: role().required(),
      department: Joi.string().max(100).allow('', null).required(),
      managerId: id().allow(null).required(),
      hireDate: date().required(),
      createdBy: id().required()
    }),
    example: {
      userId: '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      role: 'EMPLOYEE',
      department: 'Engineering',
      managerId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      hireDate: '2026-09-25',
      createdBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    }
  },
  {
    type: 'EMPLOYEE_BIRTHDAY',
    version: 1,
    topic: TOPICS.EMPLOYEE,
    key: 'userId',
    producer: 'workers/jobs/birthdayJob.js (hourly, once per org per local day)',
    description: "It's an employee's birthday today. Emitted once per employee per day by a scheduled worker.",
    schema: Joi.object({
      userId: id().required(),
      date: date().required()
    }),
    example: {
      userId: '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      date: '2026-09-25'
    }
  }
];
