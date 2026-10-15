const express = require('express');
const router = express.Router();
const hiringController = require('../../controllers/hiringController');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate, validateUUID, schemas } = require('../../middleware/validation');
const { IS_HR_UP } = require('../../config/constants');

// GET   /api/v1/hiring/jobs                    - Job openings (employees: OPEN only; HR: all + referral counts)
router.get('/jobs', authenticate, hiringController.listJobs);

// POST  /api/v1/hiring/jobs                    - Post a job opening (HR/Admin)
router.post('/jobs', authenticate, authorize(...IS_HR_UP), validate(schemas.createJobOpening), hiringController.createJob);

// PATCH /api/v1/hiring/jobs/:id                - Update details or OPEN/ON_HOLD/CLOSED (HR/Admin)
router.patch('/jobs/:id', authenticate, authorize(...IS_HR_UP), validateUUID('id'), validate(schemas.updateJobOpening), hiringController.updateJob);

// POST  /api/v1/hiring/jobs/:id/referrals      - Refer a candidate for an open position
router.post('/jobs/:id/referrals', authenticate, validateUUID('id'), validate(schemas.createReferral), hiringController.refer);

// GET   /api/v1/hiring/referrals/me            - Own referrals
router.get('/referrals/me', authenticate, hiringController.getMyReferrals);

// GET   /api/v1/hiring/referrals               - All referrals (?jobOpeningId&status) (HR/Admin)
router.get('/referrals', authenticate, authorize(...IS_HR_UP), hiringController.listReferrals);

// PATCH /api/v1/hiring/referrals/:id/status    - Move through the pipeline (HR/Admin)
router.patch('/referrals/:id/status', authenticate, authorize(...IS_HR_UP), validateUUID('id'), validate(schemas.updateReferralStatus), hiringController.updateReferralStatus);

// POST  /api/v1/hiring/referrals/:id/withdraw  - Withdraw own referral
router.post('/referrals/:id/withdraw', authenticate, validateUUID('id'), hiringController.withdrawReferral);

module.exports = router;
