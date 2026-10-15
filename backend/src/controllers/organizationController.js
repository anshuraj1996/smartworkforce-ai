const OrganizationService = require('../services/OrganizationService');
const asyncHandler = require('../middleware/asyncHandler');

const organizationController = {
  getSettings: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await OrganizationService.getSettings(req.user.organizationId) });
  }),

  updateSettings: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await OrganizationService.updateSettings(req.user, req.body || {}) });
  })
};

module.exports = organizationController;
