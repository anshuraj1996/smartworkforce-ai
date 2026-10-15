const repositories = require('../repositories');
const cache = require('../utils/cache');
const { CACHE_KEYS, CACHE_TTL } = require('../utils/cacheKeys');
const { withTransaction: dbTransaction } = require('../database/config');
const { safeTimezone } = require('../utils/dates');
const { ROLES, IS_HR_UP } = require('../config/constants');
const { ValidationError, ForbiddenError, NotFoundError } = require('../utils/errors');
const { settingsSchema, effectiveSettings } = require('../config/organizationSettings');

// Organization (tenant) profile and settings: name, timezone, and the per-tenant rules in
// config/organizationSettings.js. Everyone in the organization can read them (employees see
// their WFH quota and holidays); HR/Admin change the rules; only Admin renames the organization
// or changes its timezone (it shifts every date calculation).
class OrganizationService {
  constructor({ organizationRepository, auditLogRepository, cache: cacheClient, withTransaction = (fn) => fn() }) {
    this.organizationRepository = organizationRepository;
    this.auditLogRepository = auditLogRepository;
    this.cache = cacheClient;
    this.withTransaction = withTransaction;
  }

  // Effective settings for one organization - what services use. Cached; cleared on update.
  getSettings(organizationId) {
    return this.cache.withCache(CACHE_KEYS.orgSettings(organizationId), CACHE_TTL.orgSettings, async () => {
      const org = await this.organizationRepository.findById(organizationId);
      if (!org) throw new NotFoundError('Organization not found');
      return { name: org.name, timezone: org.timezone, ...effectiveSettings(org.settings) };
    });
  }

  async updateSettings(user, changes = {}) {
    if (!IS_HR_UP.includes(user.role)) throw new ForbiddenError('Only HR and admins can change organization settings');
    const { name, timezone, ...rules } = changes;
    if ((name !== undefined || timezone !== undefined) && user.role !== ROLES.ADMIN) {
      throw new ForbiddenError('Only admins can change the organization name or timezone');
    }

    const { error, value } = settingsSchema.validate(rules, { abortEarly: false, stripUnknown: true });
    if (error) throw new ValidationError(error.details.map(d => d.message).join('; '));
    if (timezone !== undefined && safeTimezone(timezone) !== timezone) {
      throw new ValidationError(`Unknown timezone "${timezone}" - use an IANA name such as Asia/Kolkata`);
    }
    if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)) {
      throw new ValidationError('name must be 2-100 characters');
    }

    await this.withTransaction(async () => {
      const org = await this.organizationRepository.findById(user.organizationId);
      if (!org) throw new NotFoundError('Organization not found');

      const previous = { name: org.name, timezone: org.timezone, ...effectiveSettings(org.settings) };
      const update = {
        // merge: keys this API doesn't manage stay as they are
        settings: { ...(org.settings || {}), ...value }
      };
      if (name !== undefined) update.name = name.trim();
      if (timezone !== undefined) update.timezone = timezone;
      await this.organizationRepository.update(org, update);

      await this.auditLogRepository.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'UPDATE',
        entityType: 'ORGANIZATION',
        entityId: user.organizationId,
        description: `Organization settings updated: ${Object.keys({ ...value, ...(name !== undefined ? { name } : {}), ...(timezone !== undefined ? { timezone } : {}) }).join(', ')}`,
        previousValues: previous,
        newValues: { ...value, ...(name !== undefined ? { name: update.name } : {}), ...(timezone !== undefined ? { timezone } : {}) }
      });
    });

    await this.cache.cacheDel(CACHE_KEYS.orgSettings(user.organizationId));
    return this.getSettings(user.organizationId);
  }
}

const organizationService = new OrganizationService({ ...repositories, cache, withTransaction: dbTransaction });

module.exports = organizationService;
module.exports.OrganizationService = OrganizationService;
// What other services take as `organizationSettings`: get(organizationId) -> effective settings
module.exports.settingsProvider = { get: (organizationId) => organizationService.getSettings(organizationId) };
