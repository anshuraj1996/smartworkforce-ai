const { Joi, id } = require('./fields');
const { TOPICS } = require('./topics');

module.exports = [
  {
    type: 'JOB_OPENING_POSTED',
    version: 1,
    topic: TOPICS.HIRING,
    key: 'jobOpeningId',
    producer: 'HiringService.createJob',
    description: 'HR posted a job opening. The notification worker tells every employee so they can refer candidates.',
    schema: Joi.object({
      jobOpeningId: id().required(),
      title: Joi.string().max(200).required(),
      department: Joi.string().max(100).allow('', null).required(),
      employmentType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN').required(),
      openings: Joi.number().integer().min(1).required(),
      postedBy: id().required()
    }),
    example: {
      jobOpeningId: '8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a',
      title: 'Backend Engineer',
      department: 'Engineering',
      employmentType: 'FULL_TIME',
      openings: 2,
      postedBy: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    }
  }
];
