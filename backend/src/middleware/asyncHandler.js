// Wraps an async controller so a rejected promise reaches the error handler via next(err)
// instead of every controller needing its own try/catch.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
