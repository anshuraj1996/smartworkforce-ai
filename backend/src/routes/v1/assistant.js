const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const assistantController = require('../../controllers/assistantController');
const { authenticate } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validation');

// Every question is a paid model call (often several, with tool rounds), so each signed-in
// user gets their own budget on top of the global per-IP limit
const perUserLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.ASSISTANT_RATE_LIMIT_PER_10_MIN, 10) || 20,
  keyGenerator: (req) => `assistant:${req.user.id}`,
  message: { success: false, message: 'Too many assistant questions - please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/status', authenticate, assistantController.status);
router.post('/chat', authenticate, perUserLimit, validate(schemas.assistantChat), assistantController.chat);

module.exports = router;
