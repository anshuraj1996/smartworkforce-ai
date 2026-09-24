const express = require('express');
const router = express.Router();

// Import v1 route modules
const authRoutes = require('./auth');
const attendanceRoutes = require('./attendance');
const leaveRoutes = require('./leave');
const analyticsRoutes = require('./analytics');
const userRoutes = require('./users');
const wfhRoutes = require('./wfh');
const notificationRoutes = require('./notifications');
const announcementRoutes = require('./announcements');

// API v1 routes
router.use('/auth', authRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/users', userRoutes);
router.use('/wfh', wfhRoutes);
router.use('/notifications', notificationRoutes);
router.use('/announcements', announcementRoutes);

// Health check for v1 API
router.get('/health', (req, res) => {
    res.json({
        version: '1.0.0',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API documentation endpoint
router.get('/docs', (req, res) => {
    res.json({
        version: '1.0.0',
        title: 'SmartWorkforce AI API',
        description: 'Enterprise workforce management system API',
        endpoints: {
            auth: {
                'POST /api/v1/auth/login': 'User authentication',
                'POST /api/v1/auth/logout': 'User logout',
                'GET /api/v1/auth/me': 'Get current user profile'
            },
            attendance: {
                'POST /api/v1/attendance/check-in': 'Check in attendance',
                'POST /api/v1/attendance/check-out': 'Check out attendance',
                'GET /api/v1/attendance/me': 'Get user attendance records',
                'GET /api/v1/attendance/today': 'Get today\'s attendance',
                'GET /api/v1/attendance/calendar': 'Monthly calendar view'
            },
            leave: {
                'POST /api/v1/leave/apply': 'Apply for leave',
                'GET /api/v1/leave/me': 'Get user leave requests',
                'POST /api/v1/leave/:id/approve': 'Approve leave request',
                'POST /api/v1/leave/:id/reject': 'Reject leave request'
            },
            analytics: {
                'GET /api/v1/analytics/dashboard': 'Dashboard analytics',
                'GET /api/v1/analytics/attendance': 'Attendance analytics',
                'GET /api/v1/analytics/team': 'Team analytics'
            },
            users: {
                'GET /api/v1/users/profile': 'Get user profile',
                'PUT /api/v1/users/profile': 'Update user profile',
                'GET /api/v1/users/team': 'Get team members'
            },
            wfh: {
                'POST /api/v1/wfh/apply': 'Request work from home',
                'GET /api/v1/wfh/me': 'Get own WFH requests',
                'GET /api/v1/wfh/quota': 'Get monthly WFH quota usage',
                'POST /api/v1/wfh/:id/approve': 'Approve WFH request',
                'POST /api/v1/wfh/:id/reject': 'Reject WFH request'
            },
            notifications: {
                'GET /api/v1/notifications/me': 'Get own notifications',
                'GET /api/v1/notifications/unread-count': 'Get unread notification count',
                'POST /api/v1/notifications/:id/read': 'Mark notification as read',
                'POST /api/v1/notifications/read-all': 'Mark all notifications as read'
            },
            announcements: {
                'GET /api/v1/announcements': 'List announcements',
                'GET /api/v1/announcements/feed': 'Combined announcements/birthday/new-joiner feed',
                'POST /api/v1/announcements': 'Post an announcement (HR/Admin)',
                'DELETE /api/v1/announcements/:id': 'Delete an announcement (HR/Admin)'
            }
        },
        features: [
            'Multi-tenant architecture',
            'Event-driven design',
            'Real-time analytics',
            'AI-powered insights',
            'Comprehensive audit logging'
        ]
    });
});

module.exports = router;