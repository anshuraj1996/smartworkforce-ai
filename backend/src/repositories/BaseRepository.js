// Thin wrapper around a Sequelize model. Repositories are the only layer that talks to the ORM,
// so services can be unit-tested with a plain object in place of the repository, and query
// details (includes, ordering, indexes to hit) live in one place per table.
class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  findById(id, options = {}) {
    return this.model.findByPk(id, options);
  }

  findOne(where, options = {}) {
    return this.model.findOne({ where, ...options });
  }

  findAll(where = {}, options = {}) {
    return this.model.findAll({ where, ...options });
  }

  count(where = {}) {
    return this.model.count({ where });
  }

  create(data, options = {}) {
    return this.model.create(data, options);
  }

  update(instance, changes, options = {}) {
    return instance.update(changes, options);
  }

  // Lookups that must never cross organizations go through this
  findByIdInOrg(id, organizationId, options = {}) {
    return this.model.findOne({ where: { id, organizationId }, ...options });
  }
}

module.exports = BaseRepository;
