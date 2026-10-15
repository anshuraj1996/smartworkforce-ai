const { Joi, id, date } = require('./fields');
const { TOPICS } = require('./topics');

const wfhFields = {
  userId: id().required(),
  wfhRequestId: id().required(),
  startDate: date().required(),
  endDate: date().required()
};

const example = {
  userId: '6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11',
  wfhRequestId: '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b',
  startDate: '2026-09-29',
  endDate: '2026-09-29'
};

module.exports = [
  {
    type: 'WFH_APPLIED',
    version: 1,
    topic: TOPICS.WFH,
    key: 'userId',
    producer: 'WfhService.applyWfh',
    description: 'An employee requested work from home; the request is PENDING.',
    schema: Joi.object({ ...wfhFields, isHalfDay: Joi.boolean().required() }),
    example: { ...example, isHalfDay: false }
  },
  {
    type: 'WFH_APPROVED',
    version: 1,
    topic: TOPICS.WFH,
    key: 'userId',
    producer: 'WfhService.approveWfh',
    description: 'A WFH request was approved; the covered days are now WORK_FROM_HOME on the attendance log.',
    schema: Joi.object({ ...wfhFields, approvedBy: id().required() }),
    example: { ...example, approvedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }
  },
  {
    type: 'WFH_REJECTED',
    version: 1,
    topic: TOPICS.WFH,
    key: 'userId',
    producer: 'WfhService.rejectWfh',
    description: 'A WFH request was rejected.',
    schema: Joi.object({ ...wfhFields, rejectedBy: id().required() }),
    example: { ...example, rejectedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }
  }
];
