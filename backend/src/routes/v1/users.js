const express = require('express');
const router = express.Router();
const userController = require('../../controllers/userController');
const { authenticate, authorize, authorizeResourceAccess } = require('../../middleware/auth');
const { IS_MANAGER_UP, IS_HR_UP, ROLES } = require('../../config/constants');

// Order matters: fixed paths must stay above the /:id and /:userId catch-alls.

// ---- Create (HR/Admin) ----
router.post('/register', authenticate, authorize(...IS_HR_UP), userController.create);
router.post('/', authenticate, authorize(...IS_HR_UP), userController.create);   // alias used by the Team UI

// ---- Team: search, hierarchy, departments ----
router.get('/search', authenticate, authorize(...IS_MANAGER_UP), userController.search);
router.get('/departments', authenticate, userController.getDepartments);
router.get('/hierarchy', authenticate, authorize(...IS_MANAGER_UP), userController.getHierarchy);
router.get('/hierarchy/:managerId', authenticate, authorize(...IS_MANAGER_UP), userController.getManagerHierarchy);
router.get('/manager/:managerId/reports', authenticate, userController.getDirectReports);
router.get('/department/:department', authenticate, authorize(...IS_MANAGER_UP), userController.getDepartmentMembers);

// ---- Stats / activity / export (scope depends on the caller's role) ----
router.get('/stats', authenticate, userController.getStats);
router.get('/analytics', authenticate, authorize(...IS_MANAGER_UP), userController.getTeamAnalytics);
router.get('/stats/departments', authenticate, authorize(...IS_HR_UP), userController.getDepartmentStats);
router.get('/activity', authenticate, userController.getActivity);
router.get('/export', authenticate, userController.export);
router.post('/export', authenticate, authorize(...IS_MANAGER_UP), userController.exportSelected);

// ---- Profile (self-service) ----
router.get('/profile', authenticate, userController.getProfile);
router.get('/login-history', authenticate, userController.getLoginHistory);
router.get('/timezones', authenticate, userController.getTimezones);
router.get('/languages', authenticate, userController.getLanguages);

// ---- Directory ----
router.get('/', authenticate, authorize(...IS_HR_UP), userController.list);
router.get('/:userId/attendance', authenticate, authorizeResourceAccess, userController.getMemberAttendance);
router.get('/:userId/leaves', authenticate, authorizeResourceAccess, userController.getMemberLeaves);
router.get('/:id', authenticate, userController.get);

// ---- PUT ----
router.put('/profile', authenticate, userController.updateProfile);
router.put('/preferences', authenticate, userController.updatePreferences);
router.put('/certifications/:id', authenticate, userController.updateCertification);
router.put('/:id', authenticate, authorize(...IS_HR_UP), userController.update);

// ---- PATCH ----
router.patch('/:id/deactivate', authenticate, authorize(ROLES.ADMIN), userController.deactivate);
router.patch('/:id/activate', authenticate, authorize(ROLES.ADMIN), userController.activate);

// ---- POST: profile extras, certifications, 2FA ----
router.post('/avatar', authenticate, userController.uploadAvatar);
router.delete('/avatar', authenticate, userController.removeAvatar);
router.post('/change-password', authenticate, userController.changePassword);
router.post('/certifications', authenticate, userController.addCertification);
router.delete('/certifications/:id', authenticate, userController.deleteCertification);
router.post('/certifications/:certificationId/document', authenticate, userController.uploadCertificationDocument);
router.post('/delete-request', authenticate, userController.requestDeletion);
router.post('/2fa/enable', authenticate, userController.enableTwoFactor);
router.post('/2fa/verify', authenticate, userController.verifyTwoFactor);
router.post('/2fa/disable', authenticate, userController.disableTwoFactor);

// ---- Bulk operations ----
router.post('/bulk-update', authenticate, authorize(...IS_HR_UP), userController.bulkUpdate);
router.post('/bulk-deactivate', authenticate, authorize(ROLES.ADMIN), userController.bulkDeactivate);
router.post('/bulk-transfer', authenticate, authorize(...IS_HR_UP), userController.bulkTransfer);
router.post('/bulk-assign-manager', authenticate, authorize(...IS_HR_UP), userController.bulkAssignManager);

// ---- DELETE /:id - deactivates; must stay after the specific DELETE routes above ----
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), userController.deactivate);

module.exports = router;
