const { Joi, id, date, leaveType } = require('./fields');
const { TOPICS } = require('./topics');

const leaveFields = {
  userId: id().required(),
  leaveRequestId: id().required(),
  leaveType: leaveType().required(),
  startDate: date().required(),
  endDate: date().required()
};

const example = {
  userId: '6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11',
  leaveRequestId: '2d7e9f10-4b3a-4c5d-8e6f-7a8b9c0d1e2f',
  leaveType: 'ANNUAL',
  startDate: '2026-10-06',
  endDate: '2026-10-07'
};

module.exports = [
  {
    type: 'LEAVE_APPLIED',
    version: 1,
    topic: TOPICS.LEAVE,
    key: 'userId',
    producer: 'LeaveService.applyLeave',
    description: 'An employee applied for leave; the request is PENDING.',
    schema: Joi.object({ ...leaveFields, dayCount: Joi.number().min(0.5).required() }),
    example: { ...example, dayCount: 2 }
  },
  {
    type: 'LEAVE_APPROVED',
    version: 1,
    topic: TOPICS.LEAVE,
    key: 'userId',
    producer: 'LeaveService.approveLeave',
    description: 'A manager/HR approved a leave request.',
    schema: Joi.object({ ...leaveFields, approvedBy: id().required() }),
    example: { ...example, approvedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }
  },
  {
    type: 'LEAVE_REJECTED',
    version: 1,
    topic: TOPICS.LEAVE,
    key: 'userId',
    producer: 'LeaveService.rejectLeave',
    description: 'A manager/HR rejected a leave request.',
    schema: Joi.object({ ...leaveFields, rejectedBy: id().required() }),
    example: { ...example, rejectedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }
  }
];
