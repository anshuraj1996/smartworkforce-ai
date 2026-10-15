const PolicyService = require('../services/PolicyService');
const asyncHandler = require('../middleware/asyncHandler');
const { API_VERSION, IS_HR_UP } = require('../config/constants');

const policyController = {
  getLeavePolicies: asyncHandler(async (req, res) => {
    const leavePolicies = await PolicyService.getLeavePolicies(req.user.organizationId);
    res.json({ success: true, data: leavePolicies, version: API_VERSION });
  }),

  upsertLeavePolicy: asyncHandler(async (req, res) => {
    const leavePolicy = await PolicyService.upsertLeavePolicy(req.user, req.params.leaveType, req.body);
    res.json({ success: true, message: 'Leave policy saved', data: leavePolicy, version: API_VERSION });
  }),

  // includeInactive is only honoured for HR/Admin
  list: asyncHandler(async (req, res) => {
    const policies = await PolicyService.listPolicies(req.user, {
      includeInactive: req.query.includeInactive === 'true' && IS_HR_UP.includes(req.user.role),
      category: req.query.category
    });
    res.json({ success: true, data: policies, version: API_VERSION });
  }),

  create: asyncHandler(async (req, res) => {
    const policy = await PolicyService.createPolicy(req.user, req.body);
    res.status(201).json({ success: true, message: 'Policy published', data: policy, version: API_VERSION });
  }),

  get: asyncHandler(async (req, res) => {
    const policy = await PolicyService.getPolicy(req.params.id, req.user);
    res.json({ success: true, data: policy, version: API_VERSION });
  }),

  update: asyncHandler(async (req, res) => {
    const policy = await PolicyService.updatePolicy(req.params.id, req.user, req.body);
    res.json({ success: true, message: 'Policy updated', data: policy, version: API_VERSION });
  }),

  archive: asyncHandler(async (req, res) => {
    await PolicyService.archivePolicy(req.params.id, req.user);
    res.json({ success: true, message: 'Policy archived', version: API_VERSION });
  }),

  acknowledge: asyncHandler(async (req, res) => {
    const ack = await PolicyService.acknowledgePolicy(req.params.id, req.user);
    res.json({ success: true, message: 'Policy acknowledged', data: ack, version: API_VERSION });
  }),

  getAcknowledgements: asyncHandler(async (req, res) => {
    const status = await PolicyService.getAcknowledgementStatus(req.params.id, req.user);
    res.json({ success: true, data: status, version: API_VERSION });
  })
};

module.exports = policyController;
