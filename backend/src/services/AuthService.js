const jwt = require('jsonwebtoken');
const repositories = require('../repositories');
const cache = require('../utils/cache');
const passThroughCache = require('../utils/passThroughCache');
const { CACHE_KEYS, CACHE_TTL } = require('../utils/cacheKeys');
const { UnauthorizedError, ConflictError, NotFoundError, ValidationError } = require('../utils/errors');

const jwtSecret = () => process.env.JWT_SECRET || 'your-secret-key';

class AuthService {
  constructor({ userRepository, organizationRepository, auditLogRepository, cache = passThroughCache }) {
    this.userRepository = userRepository;
    this.organizationRepository = organizationRepository;
    this.auditLogRepository = auditLogRepository;
    this.cache = cache;
  }

  // The user + organization behind every authenticated request (was 2 queries per request).
  // Returns { user, organization } or { error } for an inactive user/organization.
  //
  // Only successful lookups are cached, so a deactivated user or org is never served from
  // cache. Any change to a user goes through UserRepository, which clears that user's entry
  // immediately (see repositories/index.js) - role changes and deactivation take effect on
  // the next request, not after the TTL.
  async getAuthContext(userId) {
    const key = CACHE_KEYS.authContext(userId);
    const cached = await this.cache.cacheGet(key);
    if (cached) return cached;

    const user = await this.userRepository.findActiveById(userId);
    if (!user) return { error: 'Invalid or inactive user' };

    const organization = await this.organizationRepository.findActive(user.organizationId);
    if (!organization) return { error: 'Organization is inactive' };

    // toJSON() strips the password and 2FA secret
    const context = { user: user.toJSON(), organization: organization.toJSON() };
    await this.cache.cacheSet(key, context, CACHE_TTL.authContext);
    return context;
  }

  // metadata: { ipAddress, userAgent } for the login audit entry
  async login(email, password, metadata = {}) {
    const user = await this.userRepository.findActiveByEmail(email);

    // Same message for unknown email and wrong password so the endpoint can't be used to
    // discover which emails have accounts
    if (!user || !(await user.comparePassword(password))) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const organization = await this.organizationRepository.findActive(user.organizationId);
    if (!organization) {
      throw new UnauthorizedError('Your organization account is inactive');
    }

    await this.userRepository.update(user, { lastLogin: new Date() });

    // Feeds GET /users/login-history, which reads LOGIN audit entries
    await this.auditLogRepository.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      description: 'User logged in',
      ipAddress: metadata.ipAddress || null,
      userAgent: metadata.userAgent || null
    });

    return {
      user: { ...user.toJSON(), organization },
      token: this.generateToken(user.id, user.organizationId, user.role),
      organization
    };
  }

  // Register a new organization with its first (admin) user
  async register({ organizationName, name, email, password, timezone = 'Asia/Kolkata' }) {
    if (await this.userRepository.findByEmail(email)) {
      throw new ConflictError('User with this email already exists');
    }

    const organization = await this.organizationRepository.create({
      name: organizationName,
      timezone,
      isActive: true
    });

    const user = await this.userRepository.create({
      organizationId: organization.id,
      name,
      email: email.toLowerCase(),
      password,
      role: 'ADMIN',
      employeeId: 'ADMIN001',
      department: 'Administration',
      isActive: true
    });

    return {
      user: user.toJSON(),
      organization,
      token: this.generateToken(user.id, organization.id, user.role)
    };
  }

  async changePassword(userId, currentPassword, newPassword) {
    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current and new password are required');
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (!(await user.comparePassword(currentPassword))) {
      throw new ValidationError('Current password is incorrect');
    }

    await this.userRepository.update(user, { password: newPassword });

    await this.auditLogRepository.record({
      organizationId: user.organizationId,
      actorId: userId,
      action: 'PASSWORD_CHANGE',
      entityType: 'USER',
      entityId: userId,
      description: 'Password changed by user'
    });

    return { message: 'Password changed successfully' };
  }

  async getUserProfile(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const [organization, managerUser] = await Promise.all([
      this.organizationRepository.findById(user.organizationId),
      user.managerId ? this.userRepository.findById(user.managerId) : null
    ]);

    const manager = managerUser
      ? { id: managerUser.id, name: managerUser.name, email: managerUser.email, role: managerUser.role }
      : null;

    return { ...user.toJSON(), organization, manager };
  }

  async refreshToken(userId) {
    const user = await this.userRepository.findActiveById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found or inactive');
    }

    return this.generateToken(user.id, user.organizationId, user.role);
  }

  generateToken(userId, organizationId, role) {
    return jwt.sign(
      { userId, organizationId, role },
      jwtSecret(),
      { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
    );
  }
}

module.exports = new AuthService({
  userRepository: repositories.userRepository,
  organizationRepository: repositories.organizationRepository,
  auditLogRepository: repositories.auditLogRepository,
  cache
});
module.exports.AuthService = AuthService;
