const express = require('express');
const router = express.Router();
const wfhController = require('../../controllers/wfhController');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate, validateUUID, schemas } = require('../../middleware/validation');

const IS_MANAGER_UP = ['MANAGER', 'HR', 'ADMIN'];

// POST /api/v1/wfh/apply           - Request work from home (full or half day)
router.post('/apply', authenticate, validate(schemas.createWfhRequest), wfhController.apply);

// GET  /api/v1/wfh/me              - Current user's WFH requests (?status=)
router.get('/me', authenticate, wfhController.getMine);

// GET  /api/v1/wfh/quota           - Current user's WFH quota usage (?month=&year=)
router.get('/quota', authenticate, wfhController.getQuota);

// GET  /api/v1/wfh/pending         - Pending requests (managers: direct reports only)
router.get('/pending', authenticate, authorize(...IS_MANAGER_UP), wfhController.getPending);

// POST /api/v1/wfh/:id/approve     - Approve a WFH request
router.post('/:id/approve', authenticate, authorize(...IS_MANAGER_UP), validateUUID('id'), wfhController.approve);

// POST /api/v1/wfh/:id/reject      - Reject a WFH request (body: rejectionReason)
router.post('/:id/reject', authenticate, authorize(...IS_MANAGER_UP), validateUUID('id'), wfhController.reject);

module.exports = router;
