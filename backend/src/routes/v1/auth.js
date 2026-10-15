const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { authenticate } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validation');

// POST /api/v1/auth/login            - Authenticate and return a JWT
router.post('/login', validate(schemas.login), authController.login);

// POST /api/v1/auth/logout           - Stateless; client discards the token
router.post('/logout', authenticate, authController.logout);

// GET  /api/v1/auth/me               - Current user's profile
router.get('/me', authenticate, authController.me);

// POST /api/v1/auth/refresh          - Issue a fresh JWT
router.post('/refresh', authenticate, authController.refresh);

// POST /api/v1/auth/change-password  - Change own password
router.post('/change-password', authenticate, validate(schemas.changePassword), authController.changePassword);

// POST /api/v1/auth/register         - Register a new organization and its admin user
router.post('/register', validate(schemas.register), authController.register);

module.exports = router;
