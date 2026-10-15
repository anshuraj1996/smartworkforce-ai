const { Op, fn, col, where, literal } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const { User, Certification } = require('../models');

const NO_PASSWORD = { exclude: ['password'] };

// Columns the team search may sort by - never pass a client-supplied column straight to ORDER BY
const SORTABLE_COLUMNS = ['name', 'email', 'department', 'role', 'designation', 'hireDate', 'createdAt'];

class UserRepository extends BaseRepository {
  // onChange(userIds) runs after any user row is written - used to drop cached auth contexts
  // so a role change or deactivation applies on the very next request
  constructor({ onChange = async () => {} } = {}) {
    super(User);
    this.onChange = onChange;
  }

  async update(instance, changes, options = {}) {
    const updated = await super.update(instance, changes, options);
    await this.onChange([instance.id]);
    return updated;
  }

  findActiveById(id) {
    return this.model.findOne({ where: { id, isActive: true } });
  }

  findActiveByEmail(email) {
    return this.model.findOne({ where: { email: email.toLowerCase(), isActive: true } });
  }

  findByEmail(email) {
    return this.model.findOne({ where: { email: email.toLowerCase() } });
  }

  // Case-insensitive exact match without LIKE wildcards (an email may contain _ or %)
  findByEmailInOrg(email, organizationId) {
    return this.model.findOne({
      where: {
        organizationId,
        [Op.and]: [where(fn('LOWER', col('email')), email.toLowerCase())]
      }
    });
  }

  findByEmployeeIdInOrg(employeeId, organizationId) {
    return this.model.findOne({ where: { organizationId, employeeId } });
  }

  findInOrg(id, organizationId, options = {}) {
    return this.model.findOne({ where: { id, organizationId }, attributes: NO_PASSWORD, ...options });
  }

  findInOrgWithManager(id, organizationId) {
    return this.model.findOne({
      where: { id, organizationId },
      attributes: NO_PASSWORD,
      include: [{ model: User, as: 'manager', attributes: ['id', 'name', 'email'] }]
    });
  }

  findWithCertifications(id) {
    return this.model.findByPk(id, { include: [{ model: Certification, as: 'certifications' }] });
  }

  findActiveInOrg(organizationId, attributes = ['id']) {
    return this.model.findAll({
      where: { organizationId, isActive: true },
      attributes
    });
  }

  // Active members, optionally only a manager's direct reports
  findActiveMembers(organizationId, { managerId = null, attributes, limit } = {}) {
    const filter = { organizationId, isActive: true };
    if (managerId) filter.managerId = managerId;

    return this.model.findAll({ where: filter, attributes, limit });
  }

  async findActiveMemberIds(organizationId, managerId = null) {
    const members = await this.findActiveMembers(organizationId, { managerId, attributes: ['id'] });
    return members.map(m => m.id);
  }

  findByIds(ids, organizationId, attributes) {
    return this.model.findAll({
      where: { id: { [Op.in]: ids }, organizationId },
      attributes: attributes || NO_PASSWORD
    });
  }

  findActiveByRoles(organizationId, roles) {
    return this.model.findAll({
      where: { organizationId, isActive: true, role: { [Op.in]: roles } },
      attributes: ['id']
    });
  }

  findDirectReports(organizationId, managerId) {
    return this.model.findAll({ where: { organizationId, managerId }, attributes: NO_PASSWORD });
  }

  findByDepartment(organizationId, department) {
    return this.model.findAll({ where: { organizationId, department }, attributes: NO_PASSWORD });
  }

  findForOrg(organizationId, { role, department, isActive } = {}) {
    const filter = { organizationId };
    if (role) filter.role = role;
    if (department) filter.department = department;
    if (isActive !== undefined) filter.isActive = isActive;

    return this.model.findAll({ where: filter, attributes: NO_PASSWORD, order: [['createdAt', 'DESC']] });
  }

  async search(organizationId, { search, department, role, isActive, managerId, page, limit, sortBy, sortOrder }) {
    const filter = { organizationId };
    if (department) filter.department = department;
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive;
    if (managerId) filter.managerId = managerId;
    if (search) {
      filter[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { department: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const column = SORTABLE_COLUMNS.includes(sortBy) ? sortBy : 'name';
    const direction = String(sortOrder).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    return this.model.findAndCountAll({
      where: filter,
      attributes: NO_PASSWORD,
      order: [[column, direction]],
      limit,
      offset: (page - 1) * limit
    });
  }

  async findDistinctDepartments(organizationId) {
    const rows = await this.model.findAll({
      where: { organizationId, department: { [Op.ne]: null } },
      attributes: ['department'],
      group: ['department']
    });
    return rows.map(r => r.department).filter(Boolean);
  }

  findHierarchyNodes(organizationId) {
    return this.model.findAll({
      where: { organizationId, isActive: true },
      attributes: ['id', 'name', 'role', 'designation', 'managerId']
    });
  }

  findWithBirthdays(organizationId) {
    return this.model.findAll({
      where: { organizationId, isActive: true, dateOfBirth: { [Op.not]: null } },
      attributes: ['id', 'name', 'department', 'dateOfBirth']
    });
  }

  findJoinedSince(organizationId, sinceDate) {
    return this.model.findAll({
      where: { organizationId, isActive: true, hireDate: { [Op.gte]: sinceDate } },
      attributes: ['id', 'name', 'department', 'hireDate'],
      order: [['hireDate', 'DESC']]
    });
  }

  countLoggedInSince(organizationId, since) {
    return this.model.count({ where: { organizationId, lastLogin: { [Op.gte]: since } } });
  }

  // Returns the number of rows updated; always scoped to the organization
  // Deactivates the still-active ones and stamps metadata.deactivatedAt (lifecycle analytics),
  // in one UPDATE. Already-inactive users keep their original deactivation time.
  async deactivateMany(ids, organizationId) {
    const [updatedCount] = await this.model.update(
      {
        isActive: false,
        metadata: literal("COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('deactivatedAt', now())")
      },
      { where: { id: { [Op.in]: ids }, organizationId, isActive: true } }
    );
    if (updatedCount > 0) await this.onChange(ids);
    return updatedCount;
  }

  async updateMany(ids, organizationId, changes) {
    const [updatedCount] = await this.model.update(changes, {
      where: { id: { [Op.in]: ids }, organizationId }
    });
    if (updatedCount > 0) await this.onChange(ids);
    return updatedCount;
  }
}

module.exports = UserRepository;
