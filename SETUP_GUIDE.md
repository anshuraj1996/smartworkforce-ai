# 🚀 SmartWorkforce AI - Setup Guide

## 📋 Prerequisites

Before running the application, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **PostgreSQL** (v13 or higher) - [Download here](https://www.postgresql.org/download/)
- **Git** (optional, for version control)

## 🏗️ Project Structure

```
smartworkforce-ai/
├── backend/                 # Node.js Express API
│   ├── src/
│   │   ├── models/         # Sequelize database models
│   │   ├── services/       # Business logic layer
│   │   ├── middleware/     # Authentication & validation
│   │   ├── events/         # Event-driven architecture
│   │   └── database/       # Migrations & seeds
│   └── package.json
├── frontend/               # Angular 17 Application
│   ├── src/app/
│   │   ├── core/          # Services & guards (separated files)
│   │   ├── features/      # Feature modules (HTML, TS, CSS separated)
│   │   └── shared/        # Shared components
│   ├── tailwind.config.js # Tailwind CSS configuration
│   └── package.json
├── README.md
└── SETUP_GUIDE.md
```

## 🔧 Backend Setup

### 1. Navigate to Backend Directory
```bash
cd backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your database credentials
# Example configuration:
DATABASE_URL=postgresql://username:password@localhost:5432/smartworkforce
DB_SCHEMA=smartai          # required - the Postgres schema for this app's tables
JWT_SECRET=your-super-secret-jwt-key-here
PORT=3000
NODE_ENV=development
```

### 4. Setup Database

The schema is created by the app itself - the Sequelize models create the tables, then the
versioned SQL migrations in `src/database/migrations/` add indexes and the migration-owned
tables (outbox, KPIs, reports). Both commands are safe to run again: they only add what's missing.
On a brand-new database they also create the `DB_SCHEMA` schema - that needs the CREATE
privilege on the database; on a shared server where the app user doesn't have it, have the
DBA run `CREATE SCHEMA smartai` once.

```bash
# Create the DB_SCHEMA schema if it's missing, create/upgrade all tables + apply migrations,
# and add demo data if the database is empty
npm run db:init

# ...or the same without demo data (this is what the k8s db-sync Job runs)
npm run db:sync
```

`database/schema.sql` is a **generated snapshot** of the resulting schema, for reading only -
do not run it. After a model or migration change, refresh it with `npm run db:schema` and
commit it together with the change.

### 5. Start Backend Server
```bash
npm run dev
```

The backend API will be running on **http://localhost:3000**

## 🎨 Frontend Setup

### 1. Navigate to Frontend Directory
```bash
cd frontend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
ng serve
# or
npm start
```

The frontend application will be running on **http://localhost:4200**

## 🔑 Demo Accounts

Once the application is running, you can use these pre-seeded demo accounts:

| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| **Admin** | admin@techcorp.com | admin123456 | Full system access |
| **Manager** | manager@techcorp.com | manager123456 | Team management |
| **Employee** | alice@techcorp.com | employee123 | Basic user access |

## 🎯 Key Features Demonstrated

### ✅ Backend Features
- **Multi-tenant Architecture** - Organization-level data isolation
- **Event-Driven Design** - Internal event bus for scalability
- **Enterprise Security** - JWT auth, rate limiting, CORS protection
- **AI Analytics Foundation** - Statistical pattern detection
- **Audit Logging** - Complete action tracking for compliance
- **Time-Series Optimized** - PostgreSQL schema for attendance data

### ✅ Frontend Features
- **Modern Angular 17** - Standalone components with separate HTML/TS/CSS files
- **Tailwind CSS Integration** - Beautiful, responsive design system
- **Material Design** - Professional UI components
- **Role-Based Routing** - Authentication guards and permissions
- **Real-Time Updates** - Live dashboard with time updates
- **Responsive Design** - Mobile-first approach

## 🏃‍♂️ Quick Start Commands

### Start Both Services
```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend  
cd frontend && ng serve
```

### Access the Application
1. Open your browser to **http://localhost:4200**
2. Click on any demo account button to login instantly
3. Explore the dashboard, attendance, and other features

### API Endpoints (v1.0.0)
The backend now supports proper API versioning:

#### New Versioned Endpoints:
- `POST /api/v1/auth/login` - User authentication
- `GET /api/v1/auth/me` - Get user profile
- `POST /api/v1/attendance/check-in` - Check in attendance
- `GET /api/v1/attendance/today` - Get today's attendance
- `GET /api/v1/analytics/dashboard` - Dashboard stats
- `GET /api/v1/health` - API health check
- `GET /api/v1/docs` - API documentation

#### Legacy Endpoints
The unversioned `/api/auth/*`, `/api/attendance/*` and `/api/users/profile` routes have been removed - use the `/api/v1` equivalents above.

## 🛠️ Development Workflow

### File Organization
Each Angular component now has separate files:
```
login/
├── login.component.html     # Template
├── login.component.scss     # Styles
└── login.component.ts       # Component logic
```

### Adding New Features
1. Backend: Add to `src/services/` for business logic
2. Frontend: Create feature modules in `src/app/features/`
3. Use the established patterns for consistency

## 📊 Architecture Highlights

### Backend Architecture
- **Clean Separation**: Models, Services, Controllers
- **Event-Driven**: Internal event bus ready for Kafka
- **Security First**: Input validation, rate limiting, audit logs
- **Database Optimized**: Indexes for query performance

### Frontend Architecture
- **Component Separation**: HTML, CSS, TypeScript in separate files
- **Service Layer**: Centralized API communication
- **State Management**: Ready for NgRx if needed
- **Design System**: Custom Tailwind configuration

## 🚨 Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Ensure PostgreSQL is running
   - Check credentials in `.env` file
   - Create the database if it doesn't exist

2. **Port Already in Use**
   - Backend: Change `PORT` in `.env`
   - Frontend: Use `ng serve --port 4201`

3. **Dependencies Not Found**
   - Run `npm install` in both directories
   - Clear node_modules and reinstall if needed

## 🎉 What's Next?

This foundation is ready for:
- **Phase 2**: Kafka integration, ML models, advanced analytics
- **Mobile App**: React Native or Flutter integration
- **Microservices**: Split into domain-specific services
- **Real-Time**: WebSocket integration for live updates

## 📞 Support

For development questions or issues:
1. Check the console logs (F12 in browser)
2. Review the API responses in Network tab
3. Verify database connectivity and data

---

**🎯 This is an enterprise-grade foundation - not just a CRUD app!**

The architecture demonstrates senior-level patterns including multi-tenancy, event-driven design, AI-readiness, and production security considerations.