# SmartWorkforce AI

Workforce management platform for attendance, leave, and WFH tracking, with analytics computed from real attendance/leave data rather than mocked numbers. Multi-tenant, role-based (Employee / Manager / HR / Admin), event-driven.

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | Angular 17 (standalone components), Angular Material, Tailwind CSS |
| Backend | Node.js, Express, Sequelize (PostgreSQL) |
| Auth | JWT, bcrypt, RFC 6238 TOTP for 2FA |
| Database | PostgreSQL, schema-isolated multi-tenancy |
| Events | Internal event bus (Kafka-ready) |

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 13+
- Angular CLI 17+

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Edit .env: DATABASE_URL, DB_SCHEMA, JWT_SECRET, JWT_EXPIRES_IN
npm run db:init
npm run dev
```

### Frontend
```bash
cd frontend
npm install
ng serve
```

Frontend: `http://localhost:4200` · Backend: `http://localhost:3000`

### Demo accounts (seeded by `npm run db:init`)
| Role | Email | Password |
|---|---|---|
| Admin | admin@smartworkforce.ai | admin123 |
| HR | hr@smartworkforce.ai | hr123456 |
| Manager | manager@smartworkforce.ai | manager123 |
| Employee | john@smartworkforce.ai | emp123 |

## Architecture

- **Multi-tenancy** — all tables scoped by `organization_id`; the app's own tables additionally live in a dedicated `smartai` Postgres schema (set via `DB_SCHEMA`) rather than assuming ownership of the whole database, since the shared server also hosts an unrelated schema for another system.
- **Event-driven** — actions (check-in, leave approval, WFH approval, announcements) publish to an internal event bus consumed by audit-logging and analytics handlers. Structured to swap in Kafka without changing call sites — see `backend/src/events/kafka.js` and the [`k8s/`](k8s/) manifests for the in-progress Kafka/Kubernetes deployment work.
- **Analytics** — dashboard/insight numbers are computed from real `attendance_logs`/`leave_requests` data. Where the frontend expects a metric with no real backing data source (e.g. a task-completion rate — there's no task system), the API returns `0`/marked as untracked instead of fabricating a number.
- **Audit logging** — every mutating action is recorded with actor, entity, timestamp, and severity, feeding the same event bus.

## API Reference

Full endpoint list per area lives in the route files under `backend/src/routes/v1/`. While the backend is running, `GET /api/v1/docs` returns a live, machine-generated summary of mounted routes.

| Area | Routes |
|---|---|
| Auth | `backend/src/routes/v1/auth.js` |
| Users / Team / Profile | `backend/src/routes/v1/users.js` |
| Attendance | `backend/src/routes/v1/attendance.js` |
| Leave | `backend/src/routes/v1/leave.js` |
| Analytics | `backend/src/routes/v1/analytics.js` |
| WFH | `backend/src/routes/v1/wfh.js` |
| Notifications | `backend/src/routes/v1/notifications.js` |
| Announcements | `backend/src/routes/v1/announcements.js` |

## Project Structure

```
smartworkforce-ai/
├── backend/
│   └── src/
│       ├── database/       # Sequelize config, migrations, seed data
│       ├── models/         # Organization, User, AttendanceLog, LeaveRequest, ...
│       ├── services/       # Business logic per domain
│       ├── routes/v1/      # Versioned REST routes
│       ├── middleware/     # Auth, validation, request metrics
│       ├── events/         # Event bus, Kafka producer, handlers
│       └── app.js          # Express entry point
├── frontend/
│   └── src/app/
│       ├── core/            # Guards, interceptors, shared services
│       └── features/        # Dashboard, attendance, leave, analytics, team, ...
├── ai-anomaly-service/       # Standalone Kafka-consuming anomaly-detection service
├── k8s/                      # Kubernetes manifests (Deployments, Kustomize, Helm chart, monitoring)
├── database/schema.sql
└── docker-compose.yml
```

## Database

11 tables (`organizations`, `users`, `shifts`, `attendance_logs`, `leave_requests`, `ai_insights`, `audit_logs`, `wfh_requests`, `notifications`, `announcements`, `certifications`), time-series-indexed on `(user_id, date)` for attendance, `(status, created_at)` for leave. See `database/schema.sql` for the full definition.

## Roadmap

- Kafka as the real event bus (event contracts and producer already in place, see `backend/src/events/kafka.js`; consumer-side anomaly service already exists in `ai-anomaly-service/`)
- Kubernetes deployment hardening (in progress — see `k8s/`)
- ML-based anomaly detection, replacing the current statistical approach
- Redis caching layer for hot read paths

## License

MIT
