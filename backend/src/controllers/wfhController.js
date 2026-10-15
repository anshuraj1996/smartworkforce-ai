const WfhService = require('../services/WfhService');
const asyncHandler = require('../middleware/asyncHandler');

const API_VERSION = '1.0.0';

// Controllers only translate HTTP <-> service calls. Validation and auth run before them as
// middleware, business rules live in the service, and errors bubble to middleware/errorHandler.
const wfhController = {
  apply: asyncHandler(async (req, res) => {
    const wfhRequest = await WfhService.applyWfh(req.user, req.body);

    res.status(201).json({
      success: true,
      message: 'WFH request submitted successfully',
      data: wfhRequest,
      version: API_VERSION
    });
  }),

  getMine: asyncHandler(async (req, res) => {
    const requests = await WfhService.getUserWfhRequests(req.user, { status: req.query.status });

    res.json({ success: true, data: requests, version: API_VERSION });
  }),

  getQuota: asyncHandler(async (req, res) => {
    const now = new Date();
    const month = req.query.month ? parseInt(req.query.month, 10) : now.getMonth() + 1;
    const year = req.query.year ? parseInt(req.query.year, 10) : now.getFullYear();

    const quota = await WfhService.getMonthlyQuotaUsage(req.user.id, req.user.organizationId, month, year);

    res.json({ success: true, data: quota, version: API_VERSION });
  }),

  getPending: asyncHandler(async (req, res) => {
    const requests = await WfhService.getPendingWfhRequests(req.user);

    res.json({ success: true, data: requests, version: API_VERSION });
  }),

  approve: asyncHandler(async (req, res) => {
    const approved = await WfhService.approveWfh(req.params.id, req.user);

    res.json({
      success: true,
      message: 'WFH request approved successfully',
      data: approved,
      version: API_VERSION
    });
  }),

  reject: asyncHandler(async (req, res) => {
    const rejected = await WfhService.rejectWfh(req.params.id, req.user, req.body.rejectionReason);

    res.json({
      success: true,
      message: 'WFH request rejected',
      data: rejected,
      version: API_VERSION
    });
  })
};

module.exports = wfhController;
