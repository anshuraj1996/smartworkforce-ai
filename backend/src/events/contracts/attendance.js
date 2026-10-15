const { Joi, id, date, attendanceType } = require('./fields');
const { TOPICS } = require('./topics');

module.exports = [
  {
    type: 'ATTENDANCE_CHECKED_IN',
    version: 1,
    topic: TOPICS.ATTENDANCE,
    key: 'userId',
    producer: 'AttendanceService.checkIn',
    description: 'An employee checked in for the day.',
    schema: Joi.object({
      userId: id().required(),
      attendanceLogId: id().required(),
      date: date().required(),
      attendanceType: attendanceType().required(),
      lateMinutes: Joi.number().integer().min(0).required()
    }),
    example: {
      userId: '6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11',
      attendanceLogId: 'b8a3f0c2-1d4e-4f6a-8b2c-3e5d7f9a1b20',
      date: '2026-09-25',
      attendanceType: 'LATE',
      lateMinutes: 22
    }
  },
  {
    type: 'ATTENDANCE_CHECKED_OUT',
    version: 1,
    topic: TOPICS.ATTENDANCE,
    key: 'userId',
    producer: 'AttendanceService.checkOut',
    description: 'An employee checked out - the day now has a full working-hours record.',
    schema: Joi.object({
      userId: id().required(),
      attendanceLogId: id().required(),
      date: date().required(),
      workingMinutes: Joi.number().integer().min(0).required(),
      earlyLeaveMinutes: Joi.number().integer().min(0).required()
    }),
    example: {
      userId: '6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11',
      attendanceLogId: 'b8a3f0c2-1d4e-4f6a-8b2c-3e5d7f9a1b20',
      date: '2026-09-25',
      workingMinutes: 512,
      earlyLeaveMinutes: 0
    }
  }
];
