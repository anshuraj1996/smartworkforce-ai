const AuthService = require('../services/AuthService');
const asyncHandler = require('../middleware/asyncHandler');
const { API_VERSION } = require('../config/constants');

const authController = {
  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: { user: result.user, token: result.token, organization: result.organization },
      version: API_VERSION
    });
  }),

  // Tokens are stateless; the client discards its token
  logout: (req, res) => {
    res.json({ success: true, message: 'Logout successful', version: API_VERSION });
  },

  me: asyncHandler(async (req, res) => {
    const user = await AuthService.getUserProfile(req.user.id);
    res.json({ success: true, data: user, version: API_VERSION });
  }),

  refresh: asyncHandler(async (req, res) => {
    const token = await AuthService.refreshToken(req.user.id);
    res.json({ success: true, data: { token }, version: API_VERSION });
  }),

  changePassword: asyncHandler(async (req, res) => {
    await AuthService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true, message: 'Password changed successfully', version: API_VERSION });
  }),

  register: asyncHandler(async (req, res) => {
    const { organizationName, name, email, password, timezone } = req.body;
    const result = await AuthService.register({ organizationName, name, email, password, timezone });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: { user: result.user, organization: result.organization, token: result.token },
      version: API_VERSION
    });
  })
};

module.exports = authController;
