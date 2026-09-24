# SmartWorkforce AI – Intelligent Attendance & Leave Analytics Platform

## 📌 Project Overview

SmartWorkforce AI is an **enterprise-grade workforce management system** designed to handle attendance, leave management, and intelligent analytics with AI-readiness from day one. The project is intentionally designed at a **senior-engineer level**, focusing on scalability, clean architecture, and future AI extensibility.

---

## 🎯 Current Status: **Phase-1 + Phase-1.5 COMPLETED ✅**

**Phase-1 Completion Date:** March 6, 2026
**Phase-1.5 Completion Date:** July 10, 2026
**Status:** Running against a real PostgreSQL database, with WFH, Notifications, Announcements, full Team/Profile management, real TOTP 2FA, and a rebuilt Analytics module added on top of Phase-1

---

## 🎉 Phase-1 Achievement Summary

### ✅ **What We Built**

Phase-1 successfully delivered a **production-ready workforce management platform** with:

- ✅ **Complete Multi-Tenant Architecture**
- ✅ **Real-Time Attendance Tracking**
- ✅ **Advanced Leave Management System**
- ✅ **AI-Powered Analytics & Insights**
- ✅ **Role-Based Access Control (RBAC)**
- ✅ **Event-Driven Architecture**
- ✅ **Comprehensive Audit Logging**
- ✅ **Employee Registration System (HR/Admin)**
- ✅ **Modern Angular Dashboard with Material Design**
- ✅ **RESTful APIs with PostgreSQL Database**

### ✅ **Phase-1.5 Additions (July 2026)**

Built on top of Phase-1, once the platform was actually running end-to-end against a real database:

- ✅ **Work From Home (WFH)** — apply/approve/reject, monthly quota, auto-syncs to the attendance calendar
- ✅ **Monthly Attendance Calendar** — color-coded present/late/absent/WFH/leave/holiday/weekend view
- ✅ **Real Notification System** — in-app bell with categories, read/unread state, wired into leave/WFH/announcement events
- ✅ **Announcements + Birthday/New-Joiner Feed** — HR/Admin-managed announcements plus real birthday and new-hire detection
- ✅ **Full Team Management API** — search, org hierarchy, department/role breakdowns, bulk operations, CSV export
- ✅ **Full Profile/Account Management API** — avatar, preferences, certifications, login history, account-deletion requests
- ✅ **Real Two-Factor Authentication** — RFC 6238 TOTP, compatible with Google Authenticator/Authy (no third-party dependency)
- ✅ **Rebuilt Analytics Module** — dashboard, AI insights, attendance/leave trends, anomaly detection, system health — all computed from real data, no placeholder numbers

---

## 🧱 Tech Stack

### Frontend
- **Framework:** Angular 17+ (Standalone Components)
- **UI Library:** Angular Material + Tailwind CSS
- **State Management:** RxJS with BehaviorSubject pattern
- **Charts:** Chart.js / ECharts ready
- **HTTP:** Angular HttpClient with Interceptors
- **Routing:** Role-based route guards

### Backend
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **ORM:** Sequelize (PostgreSQL)
- **Authentication:** JWT (JSON Web Tokens)
- **Validation:** Joi
- **Password Hashing:** bcrypt
- **Event System:** Custom Event Bus (Kafka-ready architecture)

### Database
- **Primary:** PostgreSQL 13+
- **Schema:** Time-series optimized
- **Features:** Multi-tenant isolation, indexed queries, JSONB for metadata
- **Tools:** Sequelize migrations

### DevOps & Tools
- **Version Control:** Git
- **Package Manager:** npm
- **Development:** Nodemon (backend), Angular CLI (frontend)
- **Testing:** Jest (backend), Jasmine/Karma (frontend)

---

## 📊 Phase-1 Feature Breakdown

### 🔐 **1. Authentication & Authorization**

#### **Implemented Features:**
- ✅ JWT-based authentication system (real bcrypt password verification — no bypass)
- ✅ Login/Logout functionality
- ✅ Token refresh mechanism
- ✅ Token lifetime: **2 hours** (`JWT_EXPIRES_IN` in `.env`)
- ✅ Password hashing with bcrypt (12 rounds)
- ✅ Role-based access control (EMPLOYEE, MANAGER, HR, ADMIN)
- ✅ Real two-factor authentication (TOTP, RFC 6238) — see Section 11
- ✅ Protected routes with AuthGuard
- ✅ HTTP interceptor for automatic token injection

#### **API Endpoints:**
```
POST /api/v1/auth/login          - User login
POST /api/v1/auth/logout         - User logout
POST /api/v1/auth/refresh        - Refresh token
GET  /api/v1/auth/me             - Get current user
```

#### **Roles & Permissions:**
| Role | Permissions |
|------|-------------|
| **EMPLOYEE** | View own attendance, apply leave, view own analytics |
| **MANAGER** | + View team attendance, approve/reject team leave |
| **HR** | + Register employees, manage all users, view org stats |
| **ADMIN** | + Full system access, create admins, system config |

---

### 👥 **2. User Management**

#### **Implemented Features:**
- ✅ Employee registration system (HR/Admin only)
- ✅ User profile management (see Section 11 for the full self-service API)
- ✅ Organizational hierarchy tree (Manager-Employee relationships)
- ✅ Department-based organization, with per-department breakdowns
- ✅ Employee activation/deactivation
- ✅ Bulk user operations: update, deactivate, department transfer, manager reassignment (HR/Admin)
- ✅ Search/filter/paginate team members
- ✅ Role-scoped `/stats` and `/analytics` — personal for Employees, team for Managers, org-wide for HR/Admin
- ✅ CSV export (personal data for Employees, full team export for Manager/HR/Admin)
- ✅ Per-member attendance/leave history

#### **API Endpoints:**
```
POST   /api/v1/users/register              - Register new employee (HR/Admin)
POST   /api/v1/users                       - Create team member (alias of /register)
GET    /api/v1/users                       - Get all users (HR/Admin)
GET    /api/v1/users/search                - Search/filter/paginate (Manager+)
GET    /api/v1/users/:id                   - Get user by ID
PUT    /api/v1/users/:id                   - Update user (HR/Admin)
DELETE /api/v1/users/:id                   - Deactivate user (Admin)
PATCH  /api/v1/users/:id/activate           - Activate user (Admin)
PATCH  /api/v1/users/:id/deactivate         - Deactivate user (Admin)
GET    /api/v1/users/stats                 - Role-scoped stats (own/team/org)
GET    /api/v1/users/analytics             - Team analytics (Manager+)
GET    /api/v1/users/stats/departments     - Per-department stats (HR/Admin)
GET    /api/v1/users/departments           - List distinct departments
GET    /api/v1/users/hierarchy             - Full org reporting tree (Manager+)
GET    /api/v1/users/hierarchy/:managerId  - Reporting tree rooted at one manager
GET    /api/v1/users/manager/:managerId/reports - Direct reports
GET    /api/v1/users/department/:department - Members of a department
GET    /api/v1/users/activity              - Role-scoped activity feed (own/org)
GET    /api/v1/users/export                - Role-scoped CSV export (own/team)
POST   /api/v1/users/export                - Export selected members (Manager+)
POST   /api/v1/users/bulk-update            - Bulk update (HR/Admin)
POST   /api/v1/users/bulk-deactivate        - Bulk deactivate (Admin)
POST   /api/v1/users/bulk-transfer          - Bulk department transfer (HR/Admin)
POST   /api/v1/users/bulk-assign-manager    - Bulk manager reassignment (HR/Admin)
GET    /api/v1/users/:userId/attendance     - A user's attendance history (self/Manager+)
GET    /api/v1/users/:userId/leaves         - A user's leave history (self/Manager+)
```

#### **User Registration Flow:**
1. HR/Admin navigates to Team Management
2. Clicks "Add Member" button
3. Fills comprehensive registration form:
   - Personal Info (Name, Email, Employee ID, Join Date)
   - Work Info (Department, Designation, Role, Manager)
   - Security (Password, Confirm Password)
4. Backend validates and creates user
5. Audit log created automatically
6. New employee visible in team list

---

### ⏰ **3. Attendance Management**

#### **Implemented Features:**
- ✅ Real-time check-in/check-out system
- ✅ Automatic late arrival detection
- ✅ Grace period handling (15 minutes default)
- ✅ Working hours calculation
- ✅ Early leave detection
- ✅ Attendance history with pagination
- ✅ Monthly/yearly attendance statistics
- ✅ Team attendance view (Manager+)
- ✅ Bulk attendance updates (Admin)
- ✅ Location tracking support
- ✅ Inferred checkout for missed check-outs
- ✅ Monthly calendar view — present/late/absent/WFH/leave/holiday/weekend per day

#### **API Endpoints:**
```
POST /api/v1/attendance/check-in       - Employee check-in
POST /api/v1/attendance/check-out      - Employee check-out
GET  /api/v1/attendance/today          - Today's attendance status
GET  /api/v1/attendance/me             - My attendance records
GET  /api/v1/attendance/history        - Paginated history
GET  /api/v1/attendance/stats          - Monthly statistics
GET  /api/v1/attendance/calendar       - Monthly calendar view
GET  /api/v1/attendance/team           - Team attendance (Manager+)
POST /api/v1/attendance/bulk-update    - Bulk update (Admin)
```

#### **Attendance Flow:**
1. Employee clicks "Check In" on dashboard
2. System captures timestamp and location
3. Backend compares with shift timing (9:00 AM default)
4. Calculates late minutes if beyond grace period
5. Stores in `attendance_logs` table
6. Real-time status updates on dashboard
7. At day end, employee clicks "Check Out"
8. System calculates working hours
9. Background job auto-checks out missed checkouts

#### **Shift Management:**
- Default shift: 9:00 AM - 6:00 PM
- Grace period: 15 minutes
- Configurable per organization
- Multi-shift support ready

---

### 🏖️ **4. Leave Management**

#### **Implemented Features:**
- ✅ Leave application system
- ✅ Multiple leave types (Annual, Sick, Casual, Maternity, Paternity)
- ✅ Leave approval workflow
- ✅ Leave rejection with comments
- ✅ Overlap detection
- ✅ Leave balance tracking
- ✅ Leave history
- ✅ Pending leave requests (Manager/HR)
- ✅ Leave statistics & analytics
- ✅ Half-day leave support
- ✅ Past date validation

#### **API Endpoints:**
```
POST /api/v1/leave/apply           - Apply for leave
GET  /api/v1/leave/me              - My leave requests
GET  /api/v1/leave/pending         - Pending approvals (Manager+)
POST /api/v1/leave/:id/approve     - Approve leave (Manager+)
POST /api/v1/leave/:id/reject      - Reject leave (Manager+)
GET  /api/v1/leave/statistics      - Leave stats (HR/Admin)
```

#### **Leave Types:**
```javascript
ANNUAL, SICK, PERSONAL, MATERNITY, PATERNITY,
EMERGENCY, UNPAID, COMPENSATORY, BEREAVEMENT
```
Note: there's no leave-policy/allocation system yet, so there are no per-type day
allocations to enforce — `dayCount` is just the requested span.

#### **Leave Approval Flow:**
```
Employee applies leave
      ↓
Overlap check
      ↓
Creates leave request (PENDING)
      ↓
Notification to Manager
      ↓
Manager reviews
      ↓
Approves/Rejects with comments
      ↓
Employee notification
      ↓
Audit log created
```

---

### 📊 **5. AI Analytics & Insights**

#### **Implemented Features:**
- ✅ Late arrival pattern detection
- ✅ Behavioral pattern analysis
- ✅ Anomaly detection (Statistical)
- ✅ Working hours analysis
- ✅ Weekday productivity patterns
- ✅ Consistency scoring
- ✅ Explainable AI insights
- ✅ Dashboard with real-time charts
- ✅ Trend analysis
- ✅ Predictive indicators

#### **AI Algorithms:**

**1. Late Arrival Detection:**
- Rule-based + time difference calculation
- Grace period consideration
- Late percentage calculation
- Average late minutes tracking

**2. Behavioral Pattern Detection:**
- Last 60 days analysis
- Weekday-based patterns
- Most productive day identification
- Consistency score (0-100)

**3. Anomaly Detection:**
- Last 90 days analysis
- Moving average calculation
- Z-score deviation
- Outlier identification
- Stability score

#### **Analytics API:**
```
GET  /api/v1/analytics/dashboard              - Role-scoped dashboard overview
GET  /api/v1/analytics/live/dashboard         - Same, for polling
GET  /api/v1/analytics/live/online-users      - Users active in the last 15 min
GET  /api/v1/analytics/ai-insights/me         - My AI insights
GET  /api/v1/analytics/ai-insights/team       - Team AI insights (Manager+)
GET  /api/v1/analytics/ai-insights/organization - Org AI insights (HR/Admin)
GET  /api/v1/analytics/attendance/trends      - Attendance trends (Manager+)
GET  /api/v1/analytics/attendance/departments - Department attendance (Manager+)
GET  /api/v1/analytics/attendance/late-patterns - Late-arrival patterns (Manager+)
GET  /api/v1/analytics/attendance/user/:userId - A user's attendance history
GET  /api/v1/analytics/leave/statistics       - Leave statistics (HR/Admin)
GET  /api/v1/analytics/leave/types-distribution - Leave type breakdown (HR/Admin)
GET  /api/v1/analytics/leave/departments      - Department leave breakdown (HR/Admin)
GET  /api/v1/analytics/performance/overview   - Attendance-derived performance proxy
GET  /api/v1/analytics/performance/team/:teamId
GET  /api/v1/analytics/performance/user/:userId
GET  /api/v1/analytics/anomalies              - Attendance anomalies (Manager+)
GET  /api/v1/analytics/anomalies/organization - Org-wide anomalies (HR/Admin)
GET  /api/v1/analytics/team/:teamId/overview  - Team overview (Manager+)
GET  /api/v1/analytics/manager/dashboard      - Current manager's own team overview
GET  /api/v1/analytics/departments/comparison - Cross-department comparison (Manager+)
GET  /api/v1/analytics/system/health          - Real process/DB health metrics (Admin)
GET  /api/v1/analytics/system/api-usage       - Request counters (Admin)
POST /api/v1/analytics/export                 - CSV export
```
All numbers above are computed from real attendance/leave data. Where the frontend
expects something with no real source (a "productivity score", "engagement level",
"task completion rate" — there's no task/performance-review system), the API returns
`0`/labeled as not tracked rather than inventing a number. `productivityScore` is the
one exception: it's a real, disclosed proxy — a consistency score derived from the
variance in someone's actual check-in times, not a fabricated metric.

#### **Insight Storage:**
All insights stored in `ai_insights` table with:
- Insight type
- Score (0-100)
- Metadata (JSONB)
- Generated timestamp
- Explainability data

---

### 🎨 **6. Frontend Dashboard**

#### **Implemented Pages:**

**1. Dashboard (Home)**
- Today's attendance status
- Quick stats cards
- Recent activities
- Upcoming leaves
- Analytics overview

**2. Attendance Page**
- Check-in/Check-out buttons
- Today's status
- Attendance calendar
- Monthly statistics
- Attendance history table

**3. Leave Management**
- Apply for leave form
- My leave requests
- Leave balance cards
- Leave calendar
- Pending approvals (Manager+)

**4. Analytics Dashboard**
- Attendance trends chart
- Late arrival patterns
- Working hours distribution
- AI insights cards
- Productivity heatmap

**5. Team Management** (Manager/HR/Admin)
- Team member grid/list view
- Filters (Department, Role, Status)
- Member details
- Team attendance view
- Bulk operations
- Add new member button → Registration

**6. Profile Page**
- Personal information
- Work details
- Change password
- Preferences

**7. Employee Registration** (HR/Admin)
- Comprehensive registration form
- 3-section layout
- Real-time validation
- Manager selection
- Department/Role dropdowns

#### **UI Features:**
- ✅ Responsive design (Mobile, Tablet, Desktop)
- ✅ Material Design components
- ✅ Tailwind CSS utility classes
- ✅ Loading states
- ✅ Error handling
- ✅ Success/Error toasts
- ✅ Skeleton loaders
- ✅ Interactive charts
- ✅ Search and filters
- ✅ Pagination
- ✅ Export functionality

---

### 🔔 **7. Event-Driven Architecture**

#### **Event System:**
```javascript
✅ Custom Event Bus
✅ Event handlers
✅ Async event processing
✅ Event logging
✅ Kafka-ready architecture (deferred)
```

#### **Event Types:**
```javascript
ATTENDANCE_CHECKED_IN
ATTENDANCE_CHECKED_OUT  
LEAVE_APPLIED
LEAVE_APPROVED
LEAVE_REJECTED
USER_CREATED
USER_UPDATED
USER_DEACTIVATED
```

#### **Event Flow:**
```
Action occurs (e.g., Check-in)
      ↓
Event published to Event Bus
      ↓
Multiple handlers process event:
  - Analytics Handler (updates metrics)
  - Audit Handler (logs action)
  - Notification Handler (sends alerts)
      ↓
Event stored in audit_logs
```

---

### 📝 **8. Audit Logging**

#### **Audit Features:**
- ✅ All user actions logged
- ✅ Actor tracking (who did it)
- ✅ Entity tracking (what was affected)
- ✅ Timestamp (when)
- ✅ Description (what happened)
- ✅ Severity levels (INFO, WARNING, ERROR)
- ✅ Source tracking (WEB, MOBILE, API)
- ✅ Compliance-ready

#### **Logged Actions:**
```
CHECK_IN, CHECK_OUT
LEAVE_APPLIED, LEAVE_APPROVED, LEAVE_REJECTED
USER_CREATED, USER_UPDATED, USER_DEACTIVATED
BULK_UPDATE, BULK_TRANSFER, BULK_DEACTIVATE
```

#### **Audit Table Schema:**
```sql
audit_logs (
  id, organization_id, actor_id,
  action, entity_type, entity_id,
  description, timestamp,
  source, severity, metadata
)
```

---

### 🗄️ **9. Database Architecture**

#### **Tables Implemented:**

**1. organizations**
```sql
- id, name, domain, timezone
- settings (JSONB), is_active
- created_at, updated_at
```

**2. users**
```sql
- id, organization_id, name, email, employee_id
- password, role, department, designation, phone
- manager_id, is_active, hire_date, date_of_birth
- two_factor_enabled, two_factor_secret
- metadata (JSONB - skills/address/emergency_contact/preferences/avatar_url live here)
- created_at, updated_at
```

**3. shifts**
```sql
- id, organization_id, name
- start_time, end_time, grace_minutes
- is_default, is_active
```

**4. attendance_logs** (Append-Only)
```sql
- id, organization_id, user_id, date
- check_in_time, check_out_time
- attendance_type, is_inferred_checkout
- working_minutes, late_minutes, early_leave_minutes
- location, notes, created_at
```

**5. leave_requests**
```sql
- id, organization_id, user_id
- start_date, end_date, leave_type
- reason, status, is_half_day, half_day_type, day_count
- approved_by, approved_at, rejection_reason
- attachments, metadata (JSONB), created_at
```

**6. ai_insights**
```sql
- id, organization_id, user_id
- insight_type, score, metadata (JSONB)
- generated_at, action_taken_by, action_taken_at
```

**7. audit_logs**
```sql
- id, organization_id, actor_id
- action, entity_type, entity_id
- description, timestamp, source, severity
```

**8. wfh_requests**
```sql
- id, organization_id, user_id
- start_date, end_date, is_half_day, half_day_type
- reason, status, approved_by, approved_at, rejection_reason
```

**9. notifications**
```sql
- id, organization_id, user_id, category
- title, message, link, is_read, read_at
- metadata (JSONB), created_at
```

**10. announcements**
```sql
- id, organization_id, created_by
- title, body, category, is_pinned, expires_at
```

**11. certifications**
```sql
- id, user_id, name, provider
- date_obtained, expiry_date, certificate_url
```

> **Note:** these tables live in a dedicated `smartai` Postgres schema, not a
> standalone database — the shared server also hosts an unrelated `fpstats`
> database/schema for another internal system. Set via `DB_SCHEMA` in `.env`.

#### **Indexes:**
```sql
✅ idx_attendance_user_date ON attendance_logs (user_id, date)
✅ idx_attendance_checkin ON attendance_logs (check_in_time)
✅ idx_leave_status ON leave_requests (status, created_at)
✅ idx_users_org ON users (organization_id, is_active)
✅ idx_audit_org_time ON audit_logs (organization_id, timestamp)
```

#### **Performance Optimizations:**
- ✅ Proper indexing strategy
- ✅ Date range queries optimized
- ✅ Pagination implemented
- ✅ Eager loading for related data
- ✅ Query result caching ready
- ✅ Connection pooling configured

---

### ⚙️ **10. Background Jobs**

#### **Implemented Jobs:**

**1. Auto Checkout Job**
```javascript
Schedule: Daily at shift end (6:00 PM)
Purpose: Auto check-out missed check-outs
Action: Sets inferred_checkout flag
```

**2. Analytics Generation Job**
```javascript
Schedule: Nightly (2:00 AM)
Purpose: Generate AI insights
Actions:
  - Late arrival detection
  - Behavioral patterns
  - Anomaly detection
  - Statistical calculations
```

**3. Leave Balance Update Job** (Placeholder)
```javascript
Schedule: Monthly (1st day)
Purpose: Update annual leave allocations
```

---

### 🏠 **11. Work From Home (WFH)**

#### **Implemented Features:**
- ✅ Apply for WFH (full day or half day)
- ✅ Manager approval workflow
- ✅ Monthly WFH quota (default 8 days/month)
- ✅ Overlap detection against existing WFH/leave requests
- ✅ Approved WFH automatically syncs into the attendance calendar (`WORK_FROM_HOME` status)
- ✅ Real notification sent to the requester's manager, and back to the requester on approval/rejection

#### **API Endpoints:**
```
POST /api/v1/wfh/apply           - Request WFH
GET  /api/v1/wfh/me              - My WFH requests
GET  /api/v1/wfh/quota           - Monthly quota usage
GET  /api/v1/wfh/pending         - Pending requests (Manager+)
POST /api/v1/wfh/:id/approve     - Approve (Manager+)
POST /api/v1/wfh/:id/reject      - Reject (Manager+)
```

---

### 🔔 **12. Notification System**

#### **Implemented Features:**
- ✅ Real in-app notifications (bell icon in the app toolbar), not mocked
- ✅ Categories: ATTENDANCE, LEAVE, WFH, ANNOUNCEMENT, HR, SYSTEM
- ✅ Read/unread state, mark-one/mark-all-read
- ✅ Wired into leave approve/reject, WFH approve/reject, and announcement creation

#### **API Endpoints:**
```
GET  /api/v1/notifications/me            - My notifications
GET  /api/v1/notifications/unread-count  - Unread count (for the badge)
POST /api/v1/notifications/:id/read      - Mark one as read
POST /api/v1/notifications/read-all      - Mark all as read
```

---

### 📣 **13. Announcements & Company Feed**

#### **Implemented Features:**
- ✅ HR/Admin-managed announcements (General/Policy/Festival/Achievement), with pinning
- ✅ Real birthday detection (matches today's date against `users.date_of_birth`)
- ✅ Real new-joiner detection (`users.hire_date` within the last 7 days)
- ✅ Combined feed merges announcements + birthdays + new joiners, newest/pinned first
- ✅ Posting an announcement notifies the whole organization

#### **API Endpoints:**
```
GET    /api/v1/announcements        - List active announcements
GET    /api/v1/announcements/feed   - Combined announcements/birthday/new-joiner feed
POST   /api/v1/announcements        - Post an announcement (HR/Admin)
DELETE /api/v1/announcements/:id    - Delete an announcement (HR/Admin)
```

---

### 👤 **14. Profile & Account Management**

#### **Implemented Features:**
- ✅ Full profile CRUD (phone, department, designation, skills, address, emergency contact)
- ✅ Avatar upload — stored as a data URL on the user record (no S3/file storage is wired up)
- ✅ Password change (reuses the same bcrypt verification as login)
- ✅ Preferences (theme, language, timezone, notification settings, working hours)
- ✅ Certifications (real DB-backed CRUD, with optional document attachment)
- ✅ Login history — derived from the real audit log, not fabricated
- ✅ Static timezone/language reference lists
- ✅ Account-deletion request (logs the request; doesn't auto-delete)

#### **API Endpoints:**
```
GET    /api/v1/users/profile                 - Get own profile
PUT    /api/v1/users/profile                 - Update own profile
POST   /api/v1/users/avatar                  - Upload avatar (data URL)
DELETE /api/v1/users/avatar                  - Remove avatar
POST   /api/v1/users/change-password         - Change password
PUT    /api/v1/users/preferences             - Update preferences
GET    /api/v1/users/login-history           - Own login history
GET    /api/v1/users/timezones               - Static timezone list
GET    /api/v1/users/languages               - Static language list
POST   /api/v1/users/certifications          - Add certification
PUT    /api/v1/users/certifications/:id      - Update certification
DELETE /api/v1/users/certifications/:id      - Delete certification
POST   /api/v1/users/certifications/:id/document - Attach a document
POST   /api/v1/users/delete-request          - Request account deletion
```

---

### 🔐 **15. Real Two-Factor Authentication**

Unlike a typical "demo" 2FA flow, this is a genuine RFC 6238 TOTP implementation built
on Node's `crypto` module — no third-party auth library needed, and it works with real
authenticator apps (Google Authenticator, Authy, etc.).

#### **Implemented Features:**
- ✅ Real random secret generation, base32-encoded for authenticator app compatibility
- ✅ `otpauth://` setup URI (scan or enter manually)
- ✅ Real 6-digit code verification with ±1 time-step clock drift tolerance
- ✅ 2FA flag persisted on the user record; disabling requires a valid code

#### **API Endpoints:**
```
POST /api/v1/users/2fa/enable    - Generate a secret + setup URI
POST /api/v1/users/2fa/verify    - Verify a code (turns 2FA on the first time it succeeds)
POST /api/v1/users/2fa/disable   - Disable (requires a valid code)
```

---

## 🏗️ Project Structure

```
smartworkforce-ai/
├── backend/
│   ├── src/
│   │   ├── database/
│   │   │   ├── config.js              # Sequelize config (schema-scoped, see DB_SCHEMA)
│   │   │   ├── init.js                # DB initialization + seed data
│   │   │   ├── migrate.js             # Migration runner
│   │   │   └── seed.js                # Seed data
│   │   ├── models/
│   │   │   ├── index.js               # Models export + associations
│   │   │   ├── Organization.js
│   │   │   ├── User.js
│   │   │   ├── Shift.js
│   │   │   ├── AttendanceLog.js
│   │   │   ├── LeaveRequest.js
│   │   │   ├── AiInsight.js
│   │   │   ├── AuditLog.js
│   │   │   ├── WfhRequest.js
│   │   │   ├── Notification.js
│   │   │   ├── Announcement.js
│   │   │   └── Certification.js
│   │   ├── services/
│   │   │   ├── AttendanceService.js   # Attendance business logic
│   │   │   ├── LeaveService.js        # Leave business logic
│   │   │   ├── AnalyticsService.js    # AI insight generation (live-computed)
│   │   │   ├── AuthService.js         # Authentication
│   │   │   ├── WfhService.js
│   │   │   ├── NotificationService.js
│   │   │   └── AnnouncementService.js
│   │   ├── routes/v1/
│   │   │   ├── index.js               # Route aggregator
│   │   │   ├── auth.js
│   │   │   ├── users.js               # Team management + Profile self-service
│   │   │   ├── attendance.js
│   │   │   ├── leave.js
│   │   │   ├── analytics.js
│   │   │   ├── wfh.js
│   │   │   ├── notifications.js
│   │   │   └── announcements.js
│   │   ├── middleware/
│   │   │   ├── auth.js                # JWT verification
│   │   │   ├── validation.js          # Request validation
│   │   │   └── metrics.js             # In-memory request counters (system health)
│   │   ├── utils/
│   │   │   ├── totp.js                # RFC 6238 TOTP (real 2FA, no dependency)
│   │   │   └── attendanceMetrics.js   # Shared consistency-score/date helpers
│   │   ├── events/
│   │   │   ├── EventBus.js            # Custom event system
│   │   │   ├── index.js
│   │   │   └── handlers/
│   │   │       ├── analyticsHandler.js
│   │   │       └── auditHandler.js
│   │   └── app.js                     # Express app + server entry point
│   ├── package.json
│   ├── .env.example
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── main.ts                    # Standalone bootstrap (bootstrapApplication)
│   │   ├── app/
│   │   │   ├── app.component.ts       # App shell - toolbar, sidenav, real notification bell
│   │   │   ├── app.routes.ts
│   │   │   ├── core/
│   │   │   │   ├── guards/
│   │   │   │   │   └── auth.guard.ts
│   │   │   │   ├── interceptors/
│   │   │   │   │   └── auth.interceptor.ts
│   │   │   │   ├── models/
│   │   │   │   │   ├── auth.model.ts
│   │   │   │   │   ├── user.model.ts
│   │   │   │   │   ├── attendance.model.ts
│   │   │   │   │   └── leave.model.ts
│   │   │   │   └── services/
│   │   │   │       ├── auth.service.ts
│   │   │   │       └── notification.service.ts
│   │   │   └── features/
│   │   │       ├── auth/
│   │   │       │   ├── login/
│   │   │       │   └── signup/
│   │   │       ├── dashboard/         # Real data - no more mock 125/118
│   │   │       ├── attendance/
│   │   │       ├── leave/
│   │   │       ├── analytics/
│   │   │       ├── team/
│   │   │       ├── profile/
│   │   │       ├── wfh/
│   │   │       ├── calendar/
│   │   │       └── announcements/
│   │   └── environments/
│   │       ├── environment.ts
│   │       └── environment.prod.ts
│   ├── angular.json
│   ├── package.json
│   └── tailwind.config.js
│
├── database/
│   └── schema.sql                     # PostgreSQL schema
│
├── README.md
├── SETUP_GUIDE.md
└── package.json
```

> Note: there's no `app.module.ts`/`server.js` anymore — the frontend bootstraps via
> standalone components (`main.ts` + `bootstrapApplication`), and the backend's entry
> point is `app.js` directly (`server.js` was referenced in `package.json` but never
> existed; `npm start`/`npm run dev` now point at `app.js`).

---

## 🚀 Getting Started

### Prerequisites
```bash
- Node.js v18+ 
- PostgreSQL 13+
- npm 8+
- Angular CLI 17+
```

### 1. Clone Repository
```bash
git clone <repository-url>
cd smartworkforce-ai
```

### 2. Database Setup
```bash
# Create PostgreSQL database
createdb smartworkforce

# Or using psql
psql -U postgres
CREATE DATABASE smartworkforce;
\q
```

### 3. Backend Setup
```bash
cd backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials.
# DB_SCHEMA lets you isolate this app's tables inside a dedicated Postgres schema
# rather than assuming you own the whole database - useful if you're sharing a
# server with another system. JWT_EXPIRES_IN controls token lifetime (default 2h).

# Initialize database with sample data
npm run db:init

# Start development server
npm run dev
```

### 4. Frontend Setup
```bash
cd frontend
npm install

# Start development server
ng serve
```

### 5. Access Application
```
Frontend: http://localhost:4200
Backend API: http://localhost:3000
```

### 6. Login Credentials
```
Admin:
  Email: admin@smartworkforce.ai
  Password: admin123

HR:
  Email: hr@smartworkforce.ai
  Password: hr123456

Manager:
  Email: manager@smartworkforce.ai
  Password: manager123

Employee:
  Email: john@smartworkforce.ai
  Password: emp123
```

---

## 📋 API Documentation

The full, current endpoint list for each area lives with that feature's section above
rather than duplicated here (a second copy is how the old Analytics endpoints below
went stale in the first place):

| Area | Section |
|---|---|
| Auth | [§1 Authentication & Authorization](#-1-authentication--authorization) |
| Users/Team | [§2 User Management](#-2-user-management) |
| Attendance | [§3 Attendance Management](#-3-attendance-management) |
| Leave | [§4 Leave Management](#-4-leave-management) |
| Analytics/AI | [§5 AI Analytics & Insights](#-5-ai-analytics--insights) |
| WFH | [§11 Work From Home](#-11-work-from-home-wfh) |
| Notifications | [§12 Notification System](#-12-notification-system) |
| Announcements | [§13 Announcements & Company Feed](#-13-announcements--company-feed) |
| Profile/Account | [§14 Profile & Account Management](#-14-profile--account-management) |
| 2FA | [§15 Real Two-Factor Authentication](#-15-real-two-factor-authentication) |

You can also hit `GET /api/v1/docs` while the backend is running for a live,
machine-generated summary of the mounted routes.

---

## 🎯 Phase-1 Key Achievements

### ✅ **Enterprise-Level Features**
1. Multi-tenant architecture with organization isolation
2. Role-based access control (4 roles)
3. Complete audit trail for compliance
4. Event-driven architecture for scalability
5. AI-powered analytics with explainability
6. Real-time attendance tracking
7. Comprehensive leave management workflow
8. Employee registration system
9. Team management dashboard
10. RESTful API design

### ✅ **Technical Excellence**
1. Clean architecture (Services, Controllers, Models)
2. Sequelize ORM with migrations
3. JWT authentication with refresh tokens
4. Password security (bcrypt hashing)
5. Input validation (Joi)
6. Error handling middleware
7. HTTP interceptors
8. Route guards
9. Lazy loading modules
10. Responsive UI design

### ✅ **Database Design**
1. Time-series optimized schema
2. Proper indexing strategy
3. Multi-tenant data isolation
4. JSONB for flexible metadata
5. Append-only audit logs
6. Foreign key constraints
7. Cascading deletes configured
8. Connection pooling

### ✅ **Production Ready**
1. Environment configuration (.env)
2. Error logging
3. Security headers
4. CORS configuration
5. Rate limiting ready
6. Database migrations
7. Seed data scripts
8. API versioning (/v1/)

---

## 📊 Phase-1 + Phase-1.5 Metrics

### Development Statistics
```
Total Components: 20+ (frontend features, incl. WFH/Calendar/Announcements)
Total Services: 19+ (backend service classes)
Total API Endpoints: 90+ (auth, users/team/profile, attendance, leave, analytics, wfh, notifications, announcements)
Total Database Tables: 11
Test Coverage: Ready for implementation
```

### Features Delivered
```
✅ Authentication & Authorization: 100% (real bcrypt check, 2h token expiry)
✅ User Management / Team: 100%
✅ Profile & Account Management: 100%
✅ Attendance Tracking (+ monthly calendar): 100%
✅ Leave Management: 100%
✅ Work From Home (WFH): 100%
✅ AI Analytics (real, no placeholder numbers): 100%
✅ Notification System: 100%
✅ Announcements & Company Feed: 100%
✅ Real Two-Factor Authentication (TOTP): 100%
✅ Dashboard UI (wired to real data): 100%
✅ Employee Registration: 100%
✅ Audit Logging: 100%
✅ Event System: 100%
```

---

## 🔮 Phase-2 Roadmap (Upcoming)

### 🚀 **Advanced Features**

#### 1. **Advanced AI & Machine Learning**
- ML-based anomaly detection (TensorFlow.js)
- Predictive analytics (attendance forecasting)
- Sentiment analysis from comments
- Pattern recognition algorithms
- Time-series forecasting
- Automated insights generation

#### 2. **Kafka Integration**
- Replace Event Bus with Apache Kafka
- Real-time event streaming
- Message queue for reliability
- Event sourcing implementation
- CQRS pattern

#### 3. **Advanced Analytics Dashboard**
- Interactive charts (D3.js/ECharts)
- Customizable widgets
- Real-time updates
- Export to PDF/Excel
- Scheduled reports
- Data visualization library

#### 4. **Notification System**
- Email notifications (Nodemailer)
- Push notifications (FCM)
- In-app notifications
- SMS alerts (Twilio integration)
- Notification preferences
- Notification templates

#### 5. **Mobile Application**
- React Native or Flutter app
- Biometric authentication
- QR code check-in
- Offline mode support
- Push notifications
- GPS location tracking

#### 6. **Advanced Reporting**
- Custom report builder
- Scheduled report generation
- PDF/Excel exports
- Graphical reports
- Comparative analytics
- Drill-down capabilities

#### 7. **Performance Optimization**
- Redis caching layer
- Query optimization
- Database sharding
- CDN integration
- Lazy loading
- Code splitting

#### 8. **Advanced Security**
- IP whitelisting
- Session management
- Security audit logs
- Data encryption at rest
- OWASP compliance

#### 9. **Integration Features**
- Slack integration
- Microsoft Teams integration
- Google Calendar sync
- Outlook calendar sync
- Third-party API connectors
- Webhook support

#### 10. **SaaS Features**
- Multi-organization support
- Subscription management
- Billing & invoicing
- Usage tracking
- Plan upgrades/downgrades
- White-label support

---

## 🎓 Learning Outcomes

### Backend Skills Demonstrated
- ✅ RESTful API design
- ✅ Database modeling (PostgreSQL)
- ✅ ORM usage (Sequelize)
- ✅ Authentication (JWT)
- ✅ Authorization (RBAC)
- ✅ Event-driven architecture
- ✅ Service layer pattern
- ✅ Middleware implementation
- ✅ Error handling
- ✅ Validation strategies

### Frontend Skills Demonstrated
- ✅ Angular framework
- ✅ Component architecture
- ✅ RxJS & Observables
- ✅ HTTP interceptors
- ✅ Route guards
- ✅ Form validation
- ✅ State management
- ✅ Material Design
- ✅ Responsive design
- ✅ TypeScript

### Architecture Skills
- ✅ Multi-tenant design
- ✅ Clean architecture
- ✅ Separation of concerns
- ✅ DRY principles
- ✅ SOLID principles
- ✅ Design patterns
- ✅ Scalability planning
- ✅ Security best practices

---

## 🤝 Contributing

This is a learning project demonstrating enterprise-level development practices. Contributions are welcome for Phase-2 features.

---

## 📄 License

MIT License - This is a portfolio/learning project

---

## 👨‍💻 Author

**Smart AI Development Team**

---

## 📞 Support

For questions or issues, please create an issue in the repository.

---

## 🎉 Conclusion

**Phase-1 + Phase-1.5 have delivered a workforce management system, running end-to-end against a real PostgreSQL database, with:**
- Complete attendance, leave, and WFH management (with a monthly calendar view)
- Real notifications and an announcements/birthday/new-joiner feed
- Full team and profile/account management
- Real two-factor authentication (TOTP)
- AI-powered analytics computed from real data, with no placeholder numbers
- Multi-tenant architecture
- Role-based access control
- Modern, responsive UI wired to real APIs (no mock data left in Dashboard/Attendance/Leave)
- Event-driven design
- Comprehensive audit logging

**The foundation is solid, scalable, and ready for Phase-2 advanced features!**

---

**Last Updated:** July 10, 2026
**Version:** 1.5.0 (Phase-1 + Phase-1.5 Complete)
**Status:** ✅ Running against a real PostgreSQL database, verified end-to-end
