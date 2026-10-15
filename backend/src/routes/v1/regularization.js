const express = require('express');
const router = express.Router();
const regularizationController = require('../../controllers/regularizationController');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate, validateUUID, schemas } = require('../../middleware/validation');
const { IS_MANAGER_UP } = require('../../config/constants');

// POST /api/v1/regularization/apply         - Request a correction for a past attendance day
router.post('/apply', authenticate, validate(schemas.createRegularizationRequest), regularizationController.apply);

// GET  /api/v1/regularization/me            - Own requests (?status)
router.get('/me', authenticate, regularizationController.getMine);

// GET  /api/v1/regularization/pending       - Pending requests (managers: direct reports only)
router.get('/pending', authenticate, authorize(...IS_MANAGER_UP), regularizationController.getPending);

// POST /api/v1/regularization/:id/approve   - Approve and rewrite the attendance record
router.post('/:id/approve', authenticate, authorize(...IS_MANAGER_UP), validateUUID('id'), regularizationController.approve);

// POST /api/v1/regularization/:id/reject    - Reject (body: rejectionReason)
router.post('/:id/reject', authenticate, authorize(...IS_MANAGER_UP), validateUUID('id'), regularizationController.reject);

// POST /api/v1/regularization/:id/cancel    - Cancel own pending request
router.post('/:id/cancel', authenticate, validateUUID('id'), regularizationController.cancel);

module.exports = router;
