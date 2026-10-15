const express = require('express');
const router = express.Router();
const leaveController = require('../../controllers/leaveController');
const { authenticate, authorize } = require('../../middleware/auth');
const { validateUUID } = require('../../middleware/validation');
const { IS_MANAGER_UP, IS_HR_UP } = require('../../config/constants');

// POST /api/v1/leave/apply          - Apply for leave
router.post('/apply', authenticate, leaveController.apply);

// GET  /api/v1/leave/me             - Own leave requests (?status&startDate&endDate)
router.get('/me', authenticate, leaveController.getMine);

// GET  /api/v1/leave/pending        - Pending requests (managers: direct reports only)
router.get('/pending', authenticate, authorize(...IS_MANAGER_UP), leaveController.getPending);

// POST /api/v1/leave/:id/approve    - Approve (body: comments)
router.post('/:id/approve', authenticate, authorize(...IS_MANAGER_UP), validateUUID('id'), leaveController.approve);

// POST /api/v1/leave/:id/reject     - Reject (body: comments, required)
router.post('/:id/reject', authenticate, authorize(...IS_MANAGER_UP), validateUUID('id'), leaveController.reject);

// GET  /api/v1/leave/balances       - Own balance per leave type (?year)
router.get('/balances', authenticate, leaveController.getBalances);

// GET  /api/v1/leave/statistics     - Organization leave statistics (?period=1m|3m|6m|1y)
router.get('/statistics', authenticate, authorize(...IS_HR_UP), leaveController.getStatistics);

module.exports = router;
