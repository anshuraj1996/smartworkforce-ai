const { Joi, id, date, time, attendanceType } = require('./fields');
const { TOPICS } = require('./topics');

const requestFields = {
  userId: id().required(),
  regularizationRequestId: id().required(),
  date: date().required()
};

const example = {
  userId: '6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11',
  regularizationRequestId: '4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c',
  date: '2026-09-23'
};

module.exports = [
  {
    type: 'REGULARIZATION_REQUESTED',
    version: 1,
    topic: TOPICS.REGULARIZATION,
    key: 'userId',
    producer: 'RegularizationService.applyRegularization',
    description: 'An employee asked to correct a past attendance day.',
    schema: Joi.object({
      ...requestFields,
      requestType: Joi.string().valid('MISSED_CHECK_IN', 'MISSED_CHECK_OUT', 'WRONG_TIME', 'MARK_PRESENT').required()
    }),
    example: { ...example, requestType: 'MISSED_CHECK_OUT' }
  },
  {
    type: 'REGULARIZATION_APPROVED',
    version: 1,
    topic: TOPICS.REGULARIZATION,
    key: 'userId',
    producer: 'RegularizationService.approveRegularization',
    description: 'A correction was approved and the attendance log for that day was rewritten. Carries the corrected values so attendance consumers can update without re-reading the database.',
    schema: Joi.object({
      ...requestFields,
      approvedBy: id().required(),
      attendanceLogId: id().required(),
      checkInTime: time().required(),
      checkOutTime: time().allow(null).required(),
      attendanceType: attendanceType().required(),
      workingMinutes: Joi.number().integer().min(0).allow(null).required(),
      lateMinutes: Joi.number().integer().min(0).required()
    }),
    example: {
      ...example,
      approvedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      attendanceLogId: 'b8a3f0c2-1d4e-4f6a-8b2c-3e5d7f9a1b20',
      checkInTime: '09:40:00',
      checkOutTime: '18:10:00',
      attendanceType: 'LATE',
      workingMinutes: 510,
      lateMinutes: 40
    }
  },
  {
    type: 'REGULARIZATION_REJECTED',
    version: 1,
    topic: TOPICS.REGULARIZATION,
    key: 'userId',
    producer: 'RegularizationService.rejectRegularization',
    description: 'A correction request was rejected; attendance is unchanged.',
    schema: Joi.object({ ...requestFields, rejectedBy: id().required() }),
    example: { ...example, rejectedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }
  },
  {
    type: 'REGULARIZATION_CANCELLED',
    version: 1,
    topic: TOPICS.REGULARIZATION,
    key: 'userId',
    producer: 'RegularizationService.cancelRegularization',
    description: 'The employee withdrew their own pending correction request.',
    schema: Joi.object(requestFields),
    example
  }
];
