// Producer conformance: every service that publishes an event is run with realistic data and
// a publish() that goes through the REAL contract (buildEvent). If a service ever sends a
// field the contract doesn't allow, with the wrong type, or forgets one, this fails - instead
// of the event being silently dropped in production by publishEvent's contract check.
jest.mock('../../repositories', () => ({}));
jest.mock('../../services/NotificationService', () => ({}));
jest.mock('../../utils/cache', () => ({ withCache: jest.fn() }));

const { randomUUID } = require('crypto');
const { buildEvent } = require('../../events/contracts');
const { AttendanceService } = require('../../services/AttendanceService');
const { LeaveService } = require('../../services/LeaveService');
const { WfhService } = require('../../services/WfhService');
const { RegularizationService } = require('../../services/RegularizationService');
const { AnnouncementService } = require('../../services/AnnouncementService');
const { PolicyService } = require('../../services/PolicyService');
const { UserService } = require('../../services/UserService');
const { HiringService } = require('../../services/HiringService');
const { createBirthdayJob } = require('../../workers/jobs/birthdayJob');
const { dayFromToday, record, updatingRepo } = require('../helpers');

const ORG = randomUUID();
const employee = { id: randomUUID(), organizationId: ORG, role: 'EMPLOYEE', name: 'Asha', email: 'asha@acme.io', managerId: randomUUID() };
const manager = { id: employee.managerId, organizationId: ORG, role: 'MANAGER', name: 'Ravi', email: 'ravi@acme.io' };
const hr = { id: randomUUID(), organizationId: ORG, role: 'HR', name: 'Meera', email: 'meera@acme.io' };

// publish() that validates against the real contract and remembers what was sent
const contractPublisher = () => {
  const sent = [];
  const publish = jest.fn(async (type, organizationId, data) => {
    sent.push(buildEvent(type, organizationId, data)); // throws on any contract violation
    return true;
  });
  return { publish, sent, types: () => sent.map(e => e.envelope.eventType) };
};

const withIds = (fields) => record({ id: randomUUID(), ...fields });
const idRepo = (extra = {}) => updatingRepo({ create: jest.fn(async (data) => withIds(data)), ...extra });

const common = (publish) => ({
  auditLogRepository: { record: jest.fn() },
  notifier: { notify: jest.fn(), notifyMany: jest.fn() },
  publish
});

describe('producers emit contract-valid events', () => {
  it('attendance: check-in and check-out', async () => {
    const { publish, types } = contractPublisher();
    let log = null;
    const service = new AttendanceService({
      ...common(publish),
      attendanceRepository: idRepo({
        findForDay: jest.fn(async () => log),
        create: jest.fn(async (data) => (log = withIds(data)))
      }),
      shiftRepository: { findDefault: jest.fn().mockResolvedValue({ startTime: '00:00:00', endTime: '23:59:59', graceMinutes: 15 }) }
    });

    await service.checkIn(employee.id, ORG);
    log.checkInTimestamp = new Date(Date.now() - 3600e3).toISOString();
    await service.checkOut(employee.id, ORG);

    expect(types()).toEqual(['ATTENDANCE_CHECKED_IN', 'ATTENDANCE_CHECKED_OUT']);
  });

  it('leave: applied, approved, rejected', async () => {
    const { publish, types } = contractPublisher();
    const pending = () => withIds({ organizationId: ORG, userId: employee.id, leaveType: 'ANNUAL', startDate: dayFromToday(5), endDate: dayFromToday(6), status: 'PENDING', metadata: {} });
    const leaveRepository = idRepo({ findOverlapping: jest.fn(), findByIdInOrg: jest.fn(async () => pending()), findForYear: jest.fn().mockResolvedValue([]) });
    const service = new LeaveService({
      ...common(publish),
      leaveRepository,
      leavePolicyRepository: { findForType: jest.fn(), findActiveForOrg: jest.fn().mockResolvedValue([]) },
      userRepository: { findById: jest.fn().mockResolvedValue({ id: employee.id, managerId: manager.id }) }
    });

    await service.applyLeave(employee, { startDate: dayFromToday(5), endDate: dayFromToday(6), leaveType: 'ANNUAL', reason: 'Family function' });
    await service.approveLeave(randomUUID(), manager);
    await service.rejectLeave(randomUUID(), manager, 'Team is short that week');

    expect(types()).toEqual(['LEAVE_APPLIED', 'LEAVE_APPROVED', 'LEAVE_REJECTED']);
  });

  it('wfh: applied (with Joi-parsed Date inputs), approved, rejected', async () => {
    const { publish, types, sent } = contractPublisher();
    const pending = () => withIds({ organizationId: ORG, userId: employee.id, startDate: dayFromToday(2), endDate: dayFromToday(2), isHalfDay: false, status: 'PENDING' });
    const service = new WfhService({
      ...common(publish),
      wfhRepository: idRepo({ findOverlapping: jest.fn(), findApprovedWithin: jest.fn().mockResolvedValue([]), findByIdInOrg: jest.fn(async () => pending()) }),
      leaveRepository: { findOverlapping: jest.fn() },
      attendanceRepository: { setAttendanceType: jest.fn() },
      userRepository: { findById: jest.fn().mockResolvedValue({ id: employee.id, managerId: manager.id }) }
    });

    // The WFH route's Joi schema turns "YYYY-MM-DD" into a Date (UTC midnight)
    const day = dayFromToday(2);
    await service.applyWfh(employee, { startDate: new Date(day), endDate: new Date(day), reason: 'Plumber visit' });
    await service.approveWfh(randomUUID(), manager);
    await service.rejectWfh(randomUUID(), manager, 'Offsite');

    expect(types()).toEqual(['WFH_APPLIED', 'WFH_APPROVED', 'WFH_REJECTED']);
    expect(sent[0].envelope.data.startDate).toBe(day);
  });

  it('regularization: requested, approved, rejected, cancelled', async () => {
    const { publish, types } = contractPublisher();
    const pending = () => withIds({ organizationId: ORG, userId: employee.id, date: dayFromToday(-2), status: 'PENDING', requestedCheckIn: '09:40:00', requestedCheckOut: '18:10:00' });
    const service = new RegularizationService({
      ...common(publish),
      regularizationRepository: idRepo({
        findPendingForDay: jest.fn(),
        findByIdInOrg: jest.fn(async () => pending()),
        findOwned: jest.fn(async () => pending())
      }),
      attendanceRepository: idRepo({
        findForDay: jest.fn(),
        findOrCreateForDay: jest.fn(async () => withIds({ attendanceType: 'ABSENT', checkInTime: null, checkOutTime: null, metadata: {} }))
      }),
      leaveRepository: { findApprovedCovering: jest.fn() },
      shiftRepository: { findDefault: jest.fn().mockResolvedValue({ startTime: '09:00:00', endTime: '18:00:00', graceMinutes: 15 }) },
      userRepository: { findById: jest.fn().mockResolvedValue({ id: employee.id, managerId: manager.id }) }
    });

    await service.applyRegularization(employee, { date: dayFromToday(-2), requestType: 'MARK_PRESENT', requestedCheckIn: '09:40', requestedCheckOut: '18:10', reason: 'Forgot to punch' });
    await service.approveRegularization(randomUUID(), manager);
    await service.rejectRegularization(randomUUID(), manager, 'No evidence');
    await service.cancelRegularization(randomUUID(), employee);

    expect(types()).toEqual(['REGULARIZATION_REQUESTED', 'REGULARIZATION_APPROVED', 'REGULARIZATION_REJECTED', 'REGULARIZATION_CANCELLED']);
  });

  it('announcement: created', async () => {
    const { publish, types } = contractPublisher();
    const service = new AnnouncementService({
      ...common(publish),
      announcementRepository: idRepo(),
      userRepository: { findActiveInOrg: jest.fn().mockResolvedValue([]) }
    });

    await service.create(hr, { title: 'Office closed Friday', body: 'Diwali' });

    expect(types()).toEqual(['ANNOUNCEMENT_CREATED']);
  });

  it('policy: published, updated, archived', async () => {
    const { publish, types, sent } = contractPublisher();
    const existing = () => withIds({ organizationId: ORG, title: 'WFH rules', content: 'Max 8 days', category: 'WFH', effectiveDate: '2026-10-01', version: 1, isActive: true, requiresAcknowledgement: true });
    const service = new PolicyService({
      ...common(publish),
      policyRepository: idRepo({ findByIdInOrg: jest.fn(async () => existing()) }),
      policyAcknowledgementRepository: {},
      leavePolicyRepository: {},
      userRepository: { findActiveInOrg: jest.fn().mockResolvedValue([]) }
    });

    await service.createPolicy(hr, { title: 'WFH rules', category: 'WFH', content: 'Max 8 days', effectiveDate: '2026-10-01', requiresAcknowledgement: true });
    await service.updatePolicy(randomUUID(), hr, { content: 'Max 6 days' });
    await service.archivePolicy(randomUUID(), hr);

    expect(types()).toEqual(['POLICY_PUBLISHED', 'POLICY_UPDATED', 'POLICY_ARCHIVED']);
    expect(sent[1].envelope.data).toEqual(expect.objectContaining({ policyVersion: 2, previousPolicyVersion: 1, contentChanged: true }));
  });

  it('employee: joined', async () => {
    const { publish, types } = contractPublisher();
    const service = new UserService({
      ...common(publish),
      userRepository: idRepo({ findByEmailInOrg: jest.fn(), findByEmployeeIdInOrg: jest.fn(), findInOrg: jest.fn().mockResolvedValue({ id: manager.id }) }),
      attendanceRepository: {}, leaveRepository: {}, wfhRepository: {}, certificationRepository: {}, attendanceService: {}, cache: {}
    });

    await service.createUser(hr, { name: 'Neha', email: 'neha@acme.io', employeeId: 'E100', password: 'secret123', managerId: manager.id, department: 'Engineering' });
    await service.createUser(hr, { name: 'Omar', email: 'omar@acme.io', employeeId: 'E101', password: 'secret123', joinDate: '2026-10-01' });

    expect(types()).toEqual(['EMPLOYEE_JOINED', 'EMPLOYEE_JOINED']);
  });

  it('hiring: job opening posted', async () => {
    const { publish, types } = contractPublisher();
    const service = new HiringService({
      ...common(publish),
      jobOpeningRepository: idRepo(),
      referralRepository: {},
      userRepository: {}
    });

    await service.createJob(hr, { title: 'Backend Engineer', description: 'Node + Postgres', employmentType: 'FULL_TIME', openings: 2 });

    expect(types()).toEqual(['JOB_OPENING_POSTED']);
  });

  it('worker birthday job: employee birthday', async () => {
    const { publish, types, sent } = contractPublisher();
    const run = createBirthdayJob({
      organizationRepository: { findAllActive: jest.fn().mockResolvedValue([{ id: ORG, timezone: 'Asia/Kolkata' }]) },
      userRepository: { findWithBirthdays: jest.fn().mockResolvedValue([{ id: employee.id, dateOfBirth: '1994-10-08' }]) },
      claim: jest.fn().mockResolvedValue(true),
      release: jest.fn(),
      publish,
      eventType: 'EMPLOYEE_BIRTHDAY',
      now: () => new Date('2026-10-08T06:00:00Z')
    });

    await run();

    expect(types()).toEqual(['EMPLOYEE_BIRTHDAY']);
    expect(sent[0].envelope.data).toEqual({ userId: employee.id, date: '2026-10-08' });
  });
});
