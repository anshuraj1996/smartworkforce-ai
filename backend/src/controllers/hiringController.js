const HiringService = require('../services/HiringService');
const asyncHandler = require('../middleware/asyncHandler');
const { API_VERSION } = require('../config/constants');

const hiringController = {
  listJobs: asyncHandler(async (req, res) => {
    const jobs = await HiringService.listJobs(req.user, { status: req.query.status, department: req.query.department });
    res.json({ success: true, data: jobs, version: API_VERSION });
  }),

  createJob: asyncHandler(async (req, res) => {
    const job = await HiringService.createJob(req.user, req.body);
    res.status(201).json({ success: true, message: 'Job opening posted', data: job, version: API_VERSION });
  }),

  updateJob: asyncHandler(async (req, res) => {
    const job = await HiringService.updateJob(req.params.id, req.user, req.body);
    res.json({ success: true, message: 'Job opening updated', data: job, version: API_VERSION });
  }),

  refer: asyncHandler(async (req, res) => {
    const referral = await HiringService.referCandidate(req.params.id, req.user, req.body);
    res.status(201).json({ success: true, message: 'Referral submitted - thank you!', data: referral, version: API_VERSION });
  }),

  getMyReferrals: asyncHandler(async (req, res) => {
    const referrals = await HiringService.getMyReferrals(req.user);
    res.json({ success: true, data: referrals, version: API_VERSION });
  }),

  listReferrals: asyncHandler(async (req, res) => {
    const referrals = await HiringService.listReferrals(req.user, {
      jobOpeningId: req.query.jobOpeningId,
      status: req.query.status
    });
    res.json({ success: true, data: referrals, version: API_VERSION });
  }),

  updateReferralStatus: asyncHandler(async (req, res) => {
    const referral = await HiringService.updateReferralStatus(req.params.id, req.user, req.body);
    res.json({ success: true, message: 'Referral updated', data: referral, version: API_VERSION });
  }),

  withdrawReferral: asyncHandler(async (req, res) => {
    const referral = await HiringService.withdrawReferral(req.params.id, req.user);
    res.json({ success: true, message: 'Referral withdrawn', data: referral, version: API_VERSION });
  })
};

module.exports = hiringController;
