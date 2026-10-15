const UserService = require('../services/UserService');
const AuthService = require('../services/AuthService');
const AttendanceService = require('../services/AttendanceService');
const LeaveService = require('../services/LeaveService');
const asyncHandler = require('../middleware/asyncHandler');
const { sendCsv } = require('../utils/csv');
const { IS_MANAGER_UP } = require('../config/constants');

// Response shapes here predate the { data, version } convention and the Team/Profile UI reads
// them as-is (e.g. top-level avatarUrl / updatedCount), so they're kept unchanged.
const toInt = (value, fallback) => (value ? parseInt(value, 10) : fallback);

const bulkResult = (res, updatedCount, message) =>
  res.json({ success: true, updatedCount, failedIds: [], message });

const userController = {
  // ---- Create / team ----

  create: asyncHandler(async (req, res) => {
    const user = await UserService.createUser(req.user, req.body);
    res.status(201).json({ success: true, message: 'Employee registered successfully', data: user });
  }),

  search: asyncHandler(async (req, res) => {
    const data = await UserService.searchMembers(req.user, {
      ...req.query,
      page: toInt(req.query.page, 1),
      limit: toInt(req.query.limit, 20)
    });
    res.json({ success: true, data });
  }),

  getDepartments: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getDepartments(req.user.organizationId) });
  }),

  getHierarchy: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getHierarchy(req.user.organizationId) });
  }),

  getManagerHierarchy: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getManagerHierarchy(req.user.organizationId, req.params.managerId) });
  }),

  getDirectReports: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getDirectReports(req.user.organizationId, req.params.managerId) });
  }),

  getDepartmentMembers: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getDepartmentMembers(req.user.organizationId, req.params.department) });
  }),

  // ---- Stats / analytics / activity ----

  getStats: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getStats(req.user) });
  }),

  getTeamAnalytics: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getTeamAnalytics(req.user) });
  }),

  getDepartmentStats: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getDepartmentStats(req.user.organizationId) });
  }),

  getActivity: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getActivity(req.user, toInt(req.query.limit, 20)) });
  }),

  // ---- Export ----

  // Own data (Employee) or filtered team export (Manager/HR/Admin)
  export: asyncHandler(async (req, res) => {
    if (!IS_MANAGER_UP.includes(req.user.role)) {
      const row = await UserService.getOwnExportRow(req.user.id);
      return req.query.format === 'json' ? res.json(row) : sendCsv(res, 'my-data.csv', [row]);
    }

    const rows = await UserService.getTeamExportRows(req.user, { department: req.query.department, role: req.query.role });
    sendCsv(res, 'team-export.csv', rows);
  }),

  exportSelected: asyncHandler(async (req, res) => {
    sendCsv(res, 'selected-members.csv', await UserService.getSelectedExportRows(req.user, req.body.userIds));
  }),

  // ---- Profile (self-service) ----

  getProfile: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getProfile(req.user.id) });
  }),

  getLoginHistory: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getLoginHistory(req.user.id, toInt(req.query.limit, 20)) });
  }),

  getTimezones: (req, res) => res.json({ success: true, data: UserService.getTimezones() }),

  getLanguages: (req, res) => res.json({ success: true, data: UserService.getLanguages() }),

  updateProfile: asyncHandler(async (req, res) => {
    const user = await UserService.updateProfile(req.user.id, req.body);
    res.json({ success: true, message: 'Profile updated successfully', data: user });
  }),

  updatePreferences: asyncHandler(async (req, res) => {
    const preferences = await UserService.updatePreferences(req.user.id, req.body);
    res.json({ success: true, message: 'Preferences updated', data: preferences });
  }),

  uploadAvatar: asyncHandler(async (req, res) => {
    const avatarUrl = await UserService.setAvatar(req.user.id, req.body.dataUrl);
    res.json({ success: true, avatarUrl });
  }),

  removeAvatar: asyncHandler(async (req, res) => {
    await UserService.removeAvatar(req.user.id);
    res.json({ success: true, message: 'Avatar removed' });
  }),

  changePassword: asyncHandler(async (req, res) => {
    await AuthService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true, message: 'Password changed successfully' });
  }),

  requestDeletion: asyncHandler(async (req, res) => {
    await UserService.requestAccountDeletion(req.user, req.body.reason);
    res.json({ success: true, message: 'Account deletion request submitted' });
  }),

  // ---- Certifications ----

  addCertification: asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await UserService.addCertification(req.user.id, req.body) });
  }),

  updateCertification: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.updateCertification(req.user.id, req.params.id, req.body) });
  }),

  deleteCertification: asyncHandler(async (req, res) => {
    await UserService.deleteCertification(req.user.id, req.params.id);
    res.json({ success: true, message: 'Certification removed' });
  }),

  uploadCertificationDocument: asyncHandler(async (req, res) => {
    const cert = await UserService.attachCertificationDocument(req.user.id, req.params.certificationId, req.body.dataUrl);
    res.json({ success: true, data: cert });
  }),

  // ---- 2FA ----

  enableTwoFactor: asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await UserService.startTwoFactorSetup(req.user.id),
      message: 'Scan the QR/enter the key in your authenticator app, then verify a code to finish enabling 2FA'
    });
  }),

  verifyTwoFactor: asyncHandler(async (req, res) => {
    await UserService.verifyTwoFactor(req.user.id, req.body.code);
    res.json({ success: true, message: '2FA verified' });
  }),

  disableTwoFactor: asyncHandler(async (req, res) => {
    await UserService.disableTwoFactor(req.user.id, req.body.code);
    res.json({ success: true, message: '2FA disabled' });
  }),

  // ---- Directory / admin ----

  list: asyncHandler(async (req, res) => {
    const { role, department, isActive } = req.query;
    res.json({ success: true, data: await UserService.listUsers(req.user.organizationId, { role, department, isActive }) });
  }),

  get: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await UserService.getUser(req.params.id, req.user.organizationId) });
  }),

  getMemberAttendance: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    const result = await AttendanceService.getAttendanceHistory(req.params.userId, req.user.organizationId, {
      startDate,
      endDate,
      page: toInt(req.query.page, 1),
      limit: toInt(req.query.limit, 30)
    });
    res.json({ success: true, data: result.data });
  }),

  getMemberLeaves: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await LeaveService.getUserLeaves(req.params.userId, req.user.organizationId) });
  }),

  update: asyncHandler(async (req, res) => {
    const user = await UserService.updateUser(req.user, req.params.id, req.body);
    res.json({ success: true, message: 'User updated successfully', data: user });
  }),

  activate: asyncHandler(async (req, res) => {
    await UserService.setActive(req.user, req.params.id, true);
    res.json({ success: true, message: 'User activated successfully' });
  }),

  deactivate: asyncHandler(async (req, res) => {
    await UserService.setActive(req.user, req.params.id, false);
    res.json({ success: true, message: 'User deactivated successfully' });
  }),

  // ---- Bulk ----

  bulkUpdate: asyncHandler(async (req, res) => {
    const count = await UserService.bulkUpdate(req.user, req.body.userIds, req.body.updates);
    bulkResult(res, count, `Updated ${count} member(s)`);
  }),

  bulkDeactivate: asyncHandler(async (req, res) => {
    const count = await UserService.bulkDeactivate(req.user, req.body.userIds);
    bulkResult(res, count, `Deactivated ${count} member(s)`);
  }),

  bulkTransfer: asyncHandler(async (req, res) => {
    const count = await UserService.bulkTransfer(req.user, req.body.userIds, req.body.department);
    bulkResult(res, count, `Transferred ${count} member(s) to ${req.body.department}`);
  }),

  bulkAssignManager: asyncHandler(async (req, res) => {
    const count = await UserService.bulkAssignManager(req.user, req.body.userIds, req.body.managerId);
    bulkResult(res, count, `Reassigned ${count} member(s)`);
  })
};

module.exports = userController;
