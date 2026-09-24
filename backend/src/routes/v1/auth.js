const express = require('express');
const router = express.Router();
const AuthService = require('../../services/AuthService');
const { validate, schemas } = require('../../middleware/validation');
const { authenticate } = require('../../middleware/auth');

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user and return JWT token
 * @access  Public
 * @version 1.0.0
 */
router.post('/login', validate(schemas.login), async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await AuthService.login(email, password);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: result.user,
                token: result.token,
                organization: result.organization
            },
            version: '1.0.0'
        });
    } catch (error) {
        // AuthService.login throws on bad credentials/inactive account - that's a 401, not a server error
        console.error('Login error:', error);
        res.status(401).json({
            success: false,
            message: error.message || 'Invalid credentials',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user (invalidate token)
 * @access  Private
 * @version 1.0.0
 */
router.post('/logout', authenticate, async (req, res) => {
    try {
        // In a production app, you might want to blacklist the token
        // For now, we'll just return success as the client will remove the token
        res.json({
            success: true,
            message: 'Logout successful',
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            version: '1.0.0'
        });
    }
});

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current authenticated user profile
 * @access  Private
 * @version 1.0.0
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await AuthService.getUserProfile(req.user.id);
        
        if (user) {
            res.json({
                success: true,
                data: user,
                version: '1.0.0'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'User not found',
                version: '1.0.0'
            });
        }
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh JWT token
 * @access  Private
 * @version 1.0.0
 */
router.post('/refresh', authenticate, async (req, res) => {
    try {
        const newToken = await AuthService.refreshToken(req.user.id);
        
        res.json({
            success: true,
            data: { token: newToken },
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change user password
 * @access  Private
 * @version 1.0.0
 */
router.post('/change-password', authenticate, validate(schemas.changePassword), async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        await AuthService.changePassword(req.user.id, currentPassword, newPassword);

        res.json({
            success: true,
            message: 'Password changed successfully',
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Password change failed',
            version: '1.0.0'
        });
    }
});

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new organization and admin user
 * @access  Public
 * @version 1.0.0
 */
router.post('/register', validate(schemas.register), async (req, res) => {
    try {
        const { organizationName, name, email, password, timezone } = req.body;
        
        const result = await AuthService.register({
            organizationName,
            name,
            email,
            password,
            timezone
        });

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            data: {
                user: result.user,
                organization: result.organization,
                token: result.token
            },
            version: '1.0.0'
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Registration failed',
            version: '1.0.0'
        });
    }
});

module.exports = router;
