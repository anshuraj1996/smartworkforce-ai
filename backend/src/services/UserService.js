const repositories = require('../repositories');
const AttendanceService = require('./AttendanceService');
const { publish: outboxPublish } = require('../events/outbox');
const { withTransaction: dbTransaction } = require('../database/config');
const { EVENT_TYPES } = require('../events/contracts');
const totp = require('../utils/totp');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_TTL, NAMESPACES } = require('../utils/cacheKeys');
const { consistencyScore, isPresent } = require('../utils/attendanceMetrics');
const { todayStr, daysAgoStr, toDateOnly } = require('../utils/dates');
const { ROLES, IS_MANAGER_UP } = require('../config/constants');
const { ValidationError, ConflictError, NotFoundError, ForbiddenError } = require('../utils/errors');


// Roles HR can hand out. ADMIN can only be granted by an ADMIN.
const HR_ASSIGNABLE_ROLES = [ROLES.EMPLOYEE, ROLES.MANAGER, ROLES.HR];
const ALL_ROLES = Object.values(ROLES);

// The only fields bulk-update may touch - never role/organization/password/isActive
const BULK_UPDATABLE_FIELDS = ['department', 'designation', 'managerId'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A small curated reference list - nothing to fetch it from
const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Australia/Sydney', 'UTC'
];

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' }
];

const toTree = (nodes, rootId) => {
  const byManager = {};
  nodes.forEach(u => {
    const key = u.managerId || 'root';
    if (!byManager[key]) byManager[key] = [];
    byManager[key].push(u);
  });

  const build = (managerId) => (byManager[managerId] || []).map(u => ({
    id: u.id,
    name: u.name,
    role: u.role,
    designation: u.designation,
    children: build(u.id)
  }));

  return build(rootId);
};

const countBy = (items, keyFn) => {
  const counts = {};
  items.forEach(item => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
};

class UserService {
  constructor({
    userRepository,
    attendanceRepository,
    leaveRepository,
    wfhRepository,
    auditLogRepository,
    certificationRepository,
    attendanceService,
    cache,
    publish,
    withTransaction = (fn) => fn()
  }) {
    this.userRepository = userRepository;
    this.attendanceRepository = attendanceRepository;
    this.leaveRepository = leaveRepository;
    this.wfhRepository = wfhRepository;
    this.auditLogRepository = auditLogRepository;
    this.certificationRepository = certificationRepository;
    this.attendanceService = attendanceService;
    this.cache = cache;
    this.publish = publish;
    this.withTransaction = withTransaction;
  }

  getTimezones() {
    return TIMEZONES;
  }

  getLanguages() {
    return LANGUAGES;
  }

  // A manager being assigned must exist in the same organization
  async assertManagerInOrg(managerId, organizationId) {
    if (!managerId) return;
    if (!(await this.userRepository.findInOrg(managerId, organizationId))) {
      throw new ValidationError('Manager not found in this organization');
    }
  }

  assertCanAssignRole(actor, role) {
    if (!ALL_ROLES.includes(role)) {
      throw new ValidationError(`Invalid role. Allowed roles: ${ALL_ROLES.join(', ')}`);
    }
    if (role === ROLES.ADMIN && actor.role !== ROLES.ADMIN) {
      throw new ForbiddenError('Only administrators can grant the ADMIN role');
    }
  }

  // ---- Create / team queries ----

  async createUser(actor, { name, email, employeeId, password, role, department, designation, managerId, joinDate }) {
    if (!name || !email || !employeeId || !password) {
      throw new ValidationError('Name, email, employeeId, and password are required');
    }

    if (!EMAIL_PATTERN.test(email)) {
      throw new ValidationError('Invalid email format');
    }

    if (role && !HR_ASSIGNABLE_ROLES.includes(role)) {
      throw new ValidationError(`Invalid role. Allowed roles: ${HR_ASSIGNABLE_ROLES.join(', ')}`);
    }

    if (await this.userRepository.findByEmailInOrg(email, actor.organizationId)) {
      throw new ConflictError('User with this email already exists');
    }

    if (await this.userRepository.findByEmployeeIdInOrg(employeeId, actor.organizationId)) {
      throw new ConflictError('Employee ID already exists');
    }

    await this.assertManagerInOrg(managerId, actor.organizationId);

    // User, audit entry and outbox event commit together
    return this.withTransaction(async () => {
      const newUser = await this.userRepository.create({
        organizationId: actor.organizationId,
        name,
        email: email.toLowerCase(),
        employeeId,
        password,
        role: role || ROLES.EMPLOYEE,
        department: department || '',
        designation: designation || '',
        managerId: managerId || null,
        isActive: true,
        hireDate: joinDate ? toDateOnly(joinDate) : todayStr()
      });

      await this.auditLogRepository.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'CREATE',
        entityType: 'USER',
        entityId: newUser.id,
        description: `New user created: ${name} (${email})`
      });

      await this.publish(EVENT_TYPES.EMPLOYEE_JOINED, actor.organizationId, {
        userId: newUser.id,
        role: newUser.role,
        department: newUser.department || null,
        managerId: newUser.managerId || null,
        hireDate: toDateOnly(newUser.hireDate),
        createdBy: actor.id
      });

      return newUser.toJSON();
    });
  }

  // Managers are always limited to their own direct reports
  async searchMembers(actor, { search, department, role, status, managerId, page = 1, limit = 20, sortBy = 'name', sortOrder = 'asc' }) {
    const isActive = status === 'Active' ? true : status === 'Inactive' ? false : undefined;

    const { count, rows } = await this.userRepository.search(actor.organizationId, {
      search,
      department,
      role,
      isActive,
      managerId: actor.role === ROLES.MANAGER ? actor.id : managerId,
      page,
      limit,
      sortBy,
      sortOrder
    });

    return { members: rows, total: count, page, limit, totalPages: Math.ceil(count / limit) };
  }

  getDepartments(organizationId) {
    return this.userRepository.findDistinctDepartments(organizationId);
  }

  async getHierarchy(organizationId) {
    return toTree(await this.userRepository.findHierarchyNodes(organizationId), 'root');
  }

  async getManagerHierarchy(organizationId, managerId) {
    const root = await this.userRepository.findInOrg(managerId, organizationId, {
      attributes: ['id', 'name', 'role', 'designation']
    });

    if (!root) {
      throw new NotFoundError('Manager not found');
    }

    const nodes = await this.userRepository.findHierarchyNodes(organizationId);
    return { id: root.id, name: root.name, role: root.role, designation: root.designation, children: toTree(nodes, root.id) };
  }

  getDirectReports(organizationId, managerId) {
    return this.userRepository.findDirectReports(organizationId, managerId);
  }

  getDepartmentMembers(organizationId, department) {
    return this.userRepository.findByDepartment(organizationId, department);
  }

  listUsers(organizationId, { role, department, isActive }) {
    return this.userRepository.findForOrg(organizationId, {
      role,
      department,
      isActive: isActive === undefined ? undefined : isActive === 'true'
    });
  }

  async getUser(id, organizationId) {
    const user = await this.userRepository.findInOrgWithManager(id, organizationId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  // ---- Stats / analytics / activity ----

  // Own stats (Employee) or team/org stats (Manager/HR/Admin), briefly cached per user
  getStats(user) {
    return this.cache.withVersionedCache(
      NAMESPACES.workforce(user.organizationId),
      CACHE_KEYS.userStats(user.organizationId, user.role, user.id),
      CACHE_TTL.userStats,
      () => this.computeStats(user)
    );
  }

  async computeStats(user) {
    if (user.role === ROLES.EMPLOYEE) {
      const [attendanceStats, pendingLeaves] = await Promise.all([
        this.attendanceService.getAttendanceStats(user.id),
        this.leaveRepository.countPendingForUser(user.id)
      ]);

      return {
        attendanceRate: attendanceStats.attendancePercentage,
        averageWorkingHours: attendanceStats.averageWorkingHours,
        pendingLeaves
      };
    }

    const members = await this.userRepository.findActiveMembers(user.organizationId, {
      managerId: user.role === ROLES.MANAGER ? user.id : null,
      attributes: ['id', 'department', 'hireDate']
    });
    const memberIds = members.map(m => m.id);
    const today = todayStr();
    const thirtyDaysAgo = new Date(daysAgoStr(30));

    const [todayLogs, onLeaveToday, pendingLeaves, pendingWfh] = await Promise.all([
      this.attendanceRepository.findForUsersOnDate(memberIds, today),
      this.leaveRepository.countOnLeave(memberIds, today),
      this.leaveRepository.countPendingForUsers(memberIds),
      this.wfhRepository.countPendingForUsers(memberIds)
    ]);

    const presentToday = todayLogs.filter(isPresent).length;

    return {
      totalMembers: members.length,
      activeMembers: members.length,
      presentToday,
      onLeave: onLeaveToday,
      avgAttendance: members.length ? Math.round((presentToday / members.length) * 100) : 0,
      departmentBreakdown: countBy(members, m => m.department || 'Unassigned'),
      newHires: members.filter(m => m.hireDate && new Date(m.hireDate) >= thirtyDaysAgo).length,
      pendingApprovals: pendingLeaves + pendingWfh,
      teamSize: members.length,
      directReports: user.role === ROLES.MANAGER ? members.length : undefined
    };
  }

  async getTeamAnalytics(user) {
    const members = await this.userRepository.findActiveMembers(user.organizationId, {
      managerId: user.role === ROLES.MANAGER ? user.id : null,
      attributes: ['id', 'name', 'department', 'role']
    });
    const memberIds = members.map(m => m.id);

    const [todayLogs, recentAudit] = await Promise.all([
      this.attendanceRepository.findForUsersOnDate(memberIds, todayStr()),
      this.auditLogRepository.findRecent(user.organizationId, { limit: 15 })
    ]);

    const present = todayLogs.filter(isPresent).length;
    const attendanceRate = members.length ? Math.round((present / members.length) * 100) : 0;

    const topMembers = members.slice(0, 20);
    const minutesByUser = await this.attendanceRepository.checkInMinutesForUsers(topMembers.map(m => m.id), daysAgoStr(30));

    const performanceMetrics = topMembers.map(m => ({
      userId: m.id,
      userName: m.name,
      attendanceRate,
      productivityScore: consistencyScore(minutesByUser.get(m.id) || []),
      tasksCompleted: 0, // not tracked - no task system exists
      rating: 0 // not tracked - no performance review system exists
    }));

    const departments = countBy(members, m => m.department || 'Unassigned');
    const roles = countBy(members, m => m.role);

    return {
      attendanceRate,
      productivityScore: performanceMetrics.length
        ? Math.round(performanceMetrics.reduce((s, p) => s + p.productivityScore, 0) / performanceMetrics.length)
        : 0,
      averageLeaveBalance: 0, // needs a per-member balance aggregation that isn't built yet
      departmentDistribution: Object.entries(departments).map(([department, count]) => ({ department, count })),
      roleDistribution: Object.entries(roles).map(([role, count]) => ({ role, count })),
      recentActivity: recentAudit.map(a => ({
        id: a.id,
        userId: a.actorId,
        userName: a.actor?.name || 'System',
        action: a.action,
        timestamp: a.timestamp,
        details: a.description
      })),
      performanceMetrics
    };
  }

  async getDepartmentStats(organizationId) {
    const members = await this.userRepository.findActiveInOrg(organizationId, ['id', 'department']);
    const logs = await this.attendanceRepository.findForUsersOnDate(members.map(m => m.id), todayStr());
    const logByUser = new Map(logs.map(l => [l.userId, l]));

    const byDept = {};
    members.forEach(m => {
      const dept = m.department || 'Unassigned';
      if (!byDept[dept]) byDept[dept] = { totalMembers: 0, presentToday: 0 };
      byDept[dept].totalMembers += 1;
      if (isPresent(logByUser.get(m.id))) byDept[dept].presentToday += 1;
    });

    return byDept;
  }

  // Own recent actions (Employee) or org-wide recent activity (Manager/HR/Admin)
  async getActivity(user, limit = 20) {
    const logs = await this.auditLogRepository.findRecent(user.organizationId, {
      actorId: IS_MANAGER_UP.includes(user.role) ? undefined : user.id,
      limit
    });

    return logs.map(a => ({
      id: a.id,
      userId: a.actorId,
      userName: a.actor?.name || 'System',
      action: a.action,
      description: a.description,
      timestamp: a.timestamp
    }));
  }

  // ---- Export (rows only - the controller formats them) ----

  async getOwnExportRow(userId) {
    const user = await this.userRepository.findById(userId);
    return user.toJSON();
  }

  async getTeamExportRows(actor, { department, role }) {
    const members = await this.userRepository.findForOrg(actor.organizationId, { department, role });
    return members
      .filter(m => actor.role !== ROLES.MANAGER || m.managerId === actor.id)
      .map(m => m.toJSON());
  }

  async getSelectedExportRows(actor, userIds = []) {
    const members = await this.userRepository.findByIds(userIds, actor.organizationId);
    return members
      .filter(m => actor.role !== ROLES.MANAGER || m.managerId === actor.id)
      .map(m => m.toJSON());
  }

  // ---- Profile (self-service) ----

  async getProfile(userId) {
    const user = await this.userRepository.findWithCertifications(userId);
    return user.toJSON();
  }

  async getLoginHistory(userId, limit = 20) {
    const logs = await this.auditLogRepository.findLogins(userId, limit);
    return logs.map(l => ({
      ipAddress: l.ipAddress || 'Unknown',
      deviceInfo: l.userAgent || 'Unknown device',
      timestamp: l.timestamp,
      success: true
    }));
  }

  async updateProfile(userId, { name, phone, department, designation, skills, address, emergencyContact }) {
    const user = await this.userRepository.findById(userId);

    const changes = {};
    if (name) changes.name = name;
    if (phone !== undefined) changes.phone = phone;
    if (department !== undefined) changes.department = department;
    if (designation !== undefined) changes.designation = designation;

    const metadata = { ...user.metadata };
    if (skills !== undefined) metadata.skills = skills;
    if (address !== undefined) metadata.address = address;
    if (emergencyContact !== undefined) metadata.emergencyContact = emergencyContact;
    changes.metadata = metadata;

    await this.userRepository.update(user, changes);
    return user.toJSON();
  }

  async updatePreferences(userId, preferences) {
    const user = await this.userRepository.findById(userId);
    const metadata = { ...user.metadata, preferences: { ...user.metadata?.preferences, ...preferences } };
    await this.userRepository.update(user, { metadata });
    return metadata.preferences;
  }

  async setAvatar(userId, dataUrl) {
    if (!dataUrl) {
      throw new ValidationError('dataUrl is required');
    }

    const user = await this.userRepository.findById(userId);
    await this.userRepository.update(user, { metadata: { ...user.metadata, avatarUrl: dataUrl } });
    return dataUrl;
  }

  async removeAvatar(userId) {
    const user = await this.userRepository.findById(userId);
    const metadata = { ...user.metadata };
    delete metadata.avatarUrl;
    await this.userRepository.update(user, { metadata });
  }

  async requestAccountDeletion(user, reason) {
    await this.auditLogRepository.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: user.id,
      description: `Account deletion requested: ${reason || 'no reason given'}`,
      severity: 'WARNING'
    });
  }

  // ---- Certifications ----

  addCertification(userId, { name, provider, dateObtained, expiryDate }) {
    if (!name || !provider || !dateObtained) {
      throw new ValidationError('name, provider, and dateObtained are required');
    }
    return this.certificationRepository.create({ userId, name, provider, dateObtained, expiryDate });
  }

  async updateCertification(userId, certificationId, { name, provider, dateObtained, expiryDate }) {
    const cert = await this.certificationRepository.findOwned(certificationId, userId);
    if (!cert) {
      throw new NotFoundError('Certification not found');
    }
    return this.certificationRepository.update(cert, { name, provider, dateObtained, expiryDate });
  }

  async attachCertificationDocument(userId, certificationId, dataUrl) {
    const cert = await this.certificationRepository.findOwned(certificationId, userId);
    if (!cert) {
      throw new NotFoundError('Certification not found');
    }
    return this.certificationRepository.update(cert, { certificateUrl: dataUrl });
  }

  async deleteCertification(userId, certificationId) {
    if (!(await this.certificationRepository.deleteOwned(certificationId, userId))) {
      throw new NotFoundError('Certification not found');
    }
  }

  // ---- Two-factor authentication (RFC 6238 TOTP) ----

  async startTwoFactorSetup(userId) {
    const user = await this.userRepository.findById(userId);
    const secret = totp.generateSecret();
    await this.userRepository.update(user, { twoFactorSecret: secret });

    return { secret: totp.toBase32(secret), authUri: totp.buildAuthUri(secret, user.email) };
  }

  // First successful verification turns 2FA on
  async verifyTwoFactor(userId, code) {
    const user = await this.userRepository.findById(userId);

    if (!user.twoFactorSecret) {
      throw new ValidationError('2FA setup has not been started');
    }

    if (!totp.verifyTotp(user.twoFactorSecret, code)) {
      throw new ValidationError('Invalid code');
    }

    if (!user.twoFactorEnabled) {
      await this.userRepository.update(user, { twoFactorEnabled: true });
    }
  }

  async disableTwoFactor(userId, code) {
    const user = await this.userRepository.findById(userId);

    if (user.twoFactorEnabled && !totp.verifyTotp(user.twoFactorSecret, code)) {
      throw new ValidationError('A valid code is required to disable 2FA');
    }

    await this.userRepository.update(user, { twoFactorEnabled: false, twoFactorSecret: null });
  }

  // ---- Admin / HR user management ----

  async updateUser(actor, userId, { name, email, role, department, managerId, isActive }) {
    const user = await this.userRepository.findInOrg(userId, actor.organizationId, { attributes: undefined });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role === ROLES.ADMIN && actor.role !== ROLES.ADMIN) {
      throw new ForbiddenError('Only administrators can update admin accounts');
    }

    if (role) {
      this.assertCanAssignRole(actor, role);
    }

    if (managerId === userId) {
      throw new ValidationError('A user cannot be their own manager');
    }

    await this.assertManagerInOrg(managerId, actor.organizationId);

    const changes = {};
    if (name) changes.name = name;
    if (email) changes.email = email.toLowerCase();
    if (role) changes.role = role;
    if (department) changes.department = department;
    if (managerId !== undefined) changes.managerId = managerId;
    if (isActive !== undefined) changes.isActive = isActive;

    const previousRole = user.role;
    await this.userRepository.update(user, changes);

    await this.auditLogRepository.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: role && role !== previousRole ? 'ROLE_CHANGE' : 'UPDATE',
      entityType: 'USER',
      entityId: user.id,
      description: `User updated: ${user.name}`
    });

    return user.toJSON();
  }

  async setActive(actor, userId, isActive) {
    if (!isActive && userId === actor.id) {
      throw new ValidationError('You cannot deactivate your own account');
    }

    const user = await this.userRepository.findInOrg(userId, actor.organizationId, { attributes: undefined });
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // When someone left feeds lifecycle analytics (exits per month). Kept in metadata: only
    // stamped on the active -> inactive transition, cleared on reactivation.
    const metadata = { ...(user.metadata || {}) };
    if (isActive) {
      delete metadata.deactivatedAt;
    } else if (user.isActive) {
      metadata.deactivatedAt = new Date().toISOString();
    }
    await this.userRepository.update(user, { isActive, metadata });

    await this.auditLogRepository.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'UPDATE',
      entityType: 'USER',
      entityId: user.id,
      description: `User ${isActive ? 'activated' : 'deactivated'}: ${user.name}`,
      severity: isActive ? 'INFO' : 'WARNING'
    });
  }

  // Only BULK_UPDATABLE_FIELDS are applied; anything else in `updates` is ignored
  async bulkUpdate(actor, userIds = [], updates = {}) {
    const changes = Object.fromEntries(
      Object.entries(updates || {}).filter(([field]) => BULK_UPDATABLE_FIELDS.includes(field))
    );

    if (Object.keys(changes).length === 0) {
      throw new ValidationError(`Nothing to update - allowed fields: ${BULK_UPDATABLE_FIELDS.join(', ')}`);
    }

    await this.assertManagerInOrg(changes.managerId, actor.organizationId);
    return this.userRepository.updateMany(userIds, actor.organizationId, changes);
  }

  async bulkDeactivate(actor, userIds = []) {
    const ids = userIds.filter(id => id !== actor.id);
    return this.userRepository.deactivateMany(ids, actor.organizationId);
  }

  bulkTransfer(actor, userIds = [], department) {
    if (!department) {
      throw new ValidationError('department is required');
    }
    return this.userRepository.updateMany(userIds, actor.organizationId, { department });
  }

  async bulkAssignManager(actor, userIds = [], managerId) {
    await this.assertManagerInOrg(managerId, actor.organizationId);
    const ids = userIds.filter(id => id !== managerId);
    return this.userRepository.updateMany(ids, actor.organizationId, { managerId });
  }
}

module.exports = new UserService({
  ...repositories,
  attendanceService: AttendanceService,
  cache,
  publish: outboxPublish,
  withTransaction: dbTransaction
});
module.exports.UserService = UserService;
