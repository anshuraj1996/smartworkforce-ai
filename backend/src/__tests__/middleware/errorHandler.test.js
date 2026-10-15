const errorHandler = require('../../middleware/errorHandler');
const asyncHandler = require('../../middleware/asyncHandler');
const { NotFoundError, ForbiddenError, ConflictError } = require('../../utils/errors');

const fakeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const req = { method: 'GET', originalUrl: '/api/v1/test' };

describe('errorHandler', () => {
  it.each([
    [new NotFoundError('WFH request not found'), 404],
    [new ForbiddenError(), 403],
    [new ConflictError('Already exists'), 409]
  ])('maps %s to its own status', (error, status) => {
    const res = fakeRes();

    errorHandler(error, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: error.message }));
  });

  it('maps Sequelize validation errors to 400 with the model messages', () => {
    const res = fakeRes();
    const error = { name: 'SequelizeValidationError', errors: [{ message: 'reason is too short' }] };

    errorHandler(error, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'reason is too short' }));
  });

  it('hides unexpected error details in production', () => {
    const res = fakeRes();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    jest.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(new Error('connection refused at 10.2.5.143'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Internal server error' }));
    process.env.NODE_ENV = original;
    console.error.mockRestore();
  });
});

describe('asyncHandler', () => {
  it('forwards a rejected promise to next()', async () => {
    const next = jest.fn();
    const error = new NotFoundError();

    await asyncHandler(async () => { throw error; })(req, fakeRes(), next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
