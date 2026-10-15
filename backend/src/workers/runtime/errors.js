// Thrown by a handler when retrying cannot help (e.g. the referenced record was deleted, or
// the data is wrong rather than a dependency being down). Skips the retries and goes
// straight to the dead-letter topic.
class NonRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

module.exports = { NonRetryableError };
