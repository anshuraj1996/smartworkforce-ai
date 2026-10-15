const RegularizationService = require('../services/RegularizationService');
const asyncHandler = require('../middleware/asyncHandler');
const { API_VERSION } = require('../config/constants');

const regularizationController = {
  apply: asyncHandler(async (req, res) => {
    const request = await RegularizationService.applyRegularization(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Regularization request submitted successfully',
      data: request,
      version: API_VERSION
    });
  }),

  getMine: asyncHandler(async (req, res) => {
    const requests = await RegularizationService.getUserRequests(req.user, { status: req.query.status });
    res.json({ success: true, data: requests, version: API_VERSION });
  }),

  getPending: asyncHandler(async (req, res) => {
    const requests = await RegularizationService.getPendingRequests(req.user);
    res.json({ success: true, data: requests, version: API_VERSION });
  }),

  approve: asyncHandler(async (req, res) => {
    const approved = await RegularizationService.approveRegularization(req.params.id, req.user);
    res.json({ success: true, message: 'Regularization approved - attendance updated', data: approved, version: API_VERSION });
  }),

  reject: asyncHandler(async (req, res) => {
    const rejected = await RegularizationService.rejectRegularization(req.params.id, req.user, req.body.rejectionReason);
    res.json({ success: true, message: 'Regularization request rejected', data: rejected, version: API_VERSION });
  }),

  cancel: asyncHandler(async (req, res) => {
    const cancelled = await RegularizationService.cancelRegularization(req.params.id, req.user);
    res.json({ success: true, message: 'Regularization request cancelled', data: cancelled, version: API_VERSION });
  })
};

module.exports = regularizationController;
