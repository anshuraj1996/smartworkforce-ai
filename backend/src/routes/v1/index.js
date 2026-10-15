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
const regularizationRoutes = require('./regularization');
const policyRoutes = require('./policies');
const hiringRoutes = require('./hiring');
const assistantRoutes = require('./assistant');
const organizationRoutes = require('./organization');

// API v1 routes
router.use('/auth', authRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/assistant', assistantRoutes);
router.use('/organization', organizationRoutes);
router.use('/users', userRoutes);
router.use('/wfh', wfhRoutes);
router.use('/notifications', notificationRoutes);
router.use('/announcements', announcementRoutes);
router.use('/regularization', regularizationRoutes);
router.use('/policies', policyRoutes);
router.use('/hiring', hiringRoutes);

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
                'POST /api/v1/leave/:id/reject': 'Reject leave request',
                'GET /api/v1/leave/balances': 'Leave balance per type from leave policies'
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
            },
            regularization: {
                'POST /api/v1/regularization/apply': 'Request an attendance correction',
                'GET /api/v1/regularization/me': 'Get own regularization requests',
                'GET /api/v1/regularization/pending': 'Get pending regularization requests (Manager/HR/Admin)',
                'POST /api/v1/regularization/:id/approve': 'Approve and apply a regularization',
                'POST /api/v1/regularization/:id/reject': 'Reject a regularization',
                'POST /api/v1/regularization/:id/cancel': 'Cancel own pending regularization'
            },
            policies: {
                'GET /api/v1/policies': 'List policies with own acknowledgement status',
                'GET /api/v1/policies/:id': 'Get a policy',
                'POST /api/v1/policies': 'Publish a policy (HR/Admin)',
                'PUT /api/v1/policies/:id': 'Update a policy - content changes bump the version (HR/Admin)',
                'DELETE /api/v1/policies/:id': 'Archive a policy (HR/Admin)',
                'POST /api/v1/policies/:id/acknowledge': 'Acknowledge the current version',
                'GET /api/v1/policies/:id/acknowledgements': 'Acknowledgement compliance (HR/Admin)',
                'GET /api/v1/policies/leave': 'Leave allocations per leave type',
                'PUT /api/v1/policies/leave/:leaveType': 'Set a leave allocation (HR/Admin)'
            },
            hiring: {
                'GET /api/v1/hiring/jobs': 'List job openings',
                'POST /api/v1/hiring/jobs': 'Post a job opening (HR/Admin)',
                'PATCH /api/v1/hiring/jobs/:id': 'Update a job opening / change status (HR/Admin)',
                'POST /api/v1/hiring/jobs/:id/referrals': 'Refer a candidate',
                'GET /api/v1/hiring/referrals/me': 'Get own referrals',
                'GET /api/v1/hiring/referrals': 'List all referrals (HR/Admin)',
                'PATCH /api/v1/hiring/referrals/:id/status': 'Move a referral through the pipeline (HR/Admin)',
                'POST /api/v1/hiring/referrals/:id/withdraw': 'Withdraw own referral'
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