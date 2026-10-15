const express = require('express');
const router = express.Router();
const organizationController = require('../../controllers/organizationController');
const { authenticate, authorize } = require('../../middleware/auth');
const { IS_HR_UP } = require('../../config/constants');

// GET /api/v1/organization/settings - everyone in the organization (quota, holidays, timezone)
// PUT /api/v1/organization/settings - HR/Admin; name and timezone: Admin only (checked in the service)
router.get('/settings', authenticate, organizationController.getSettings);
router.put('/settings', authenticate, authorize(...IS_HR_UP), organizationController.updateSettings);

module.exports = router;
