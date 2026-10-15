const LeaveService = require('../services/LeaveService');
const asyncHandler = require('../middleware/asyncHandler');
const { API_VERSION } = require('../config/constants');

const leaveController = {
  apply: asyncHandler(async (req, res) => {
    const { startDate, endDate, leaveType, reason, isHalfDay } = req.body;
    const leaveRequest = await LeaveService.applyLeave(req.user, { startDate, endDate, leaveType, reason, isHalfDay });

    res.status(201).json({
      success: true,
      message: 'Leave application submitted successfully',
      data: leaveRequest,
      version: API_VERSION
    });
  }),

  getMine: asyncHandler(async (req, res) => {
    const { status, startDate, endDate } = req.query;
    const leaves = await LeaveService.getUserLeaves(req.user.id, req.user.organizationId, { status, startDate, endDate });
    res.json({ success: true, data: leaves, version: API_VERSION });
  }),

  getPending: asyncHandler(async (req, res) => {
    const leaves = await LeaveService.getPendingLeaves(req.user);
    res.json({ success: true, data: leaves, version: API_VERSION });
  }),

  approve: asyncHandler(async (req, res) => {
    const leave = await LeaveService.approveLeave(req.params.id, req.user, req.body.comments);
    res.json({ success: true, message: 'Leave request approved successfully', data: leave, version: API_VERSION });
  }),

  reject: asyncHandler(async (req, res) => {
    const leave = await LeaveService.rejectLeave(req.params.id, req.user, req.body.comments);
    res.json({ success: true, message: 'Leave request rejected', data: leave, version: API_VERSION });
  }),

  getBalances: asyncHandler(async (req, res) => {
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const balances = await LeaveService.getLeaveBalance(req.user.id, req.user.organizationId, year);
    res.json({ success: true, data: balances, version: API_VERSION });
  }),

  getStatistics: asyncHandler(async (req, res) => {
    const statistics = await LeaveService.getLeaveStatistics(req.user.organizationId, req.query.period || '1y');
    res.json({ success: true, data: statistics, version: API_VERSION });
  })
};

module.exports = leaveController;
