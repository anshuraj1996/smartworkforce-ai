// Shared fixtures for service unit tests

// YYYY-MM-DD `days` from today, in local time
const dayFromToday = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const users = {
  employee: { id: 'emp-1', organizationId: 'org-1', role: 'EMPLOYEE', name: 'Asha', email: 'asha@acme.test', managerId: 'mgr-1' },
  manager: { id: 'mgr-1', organizationId: 'org-1', role: 'MANAGER', name: 'Ravi', email: 'ravi@acme.test' },
  otherManager: { id: 'mgr-2', organizationId: 'org-1', role: 'MANAGER', name: 'Kiran', email: 'kiran@acme.test' },
  hr: { id: 'hr-1', organizationId: 'org-1', role: 'HR', name: 'Meera', email: 'meera@acme.test' },
  admin: { id: 'adm-1', organizationId: 'org-1', role: 'ADMIN', name: 'Dev', email: 'dev@acme.test' }
};

// A stand-in for a Sequelize instance: plain fields plus toJSON()
const record = (fields) => ({ ...fields, toJSON() { const { toJSON, ...rest } = this; return rest; } });

// Repository fake whose update() merges changes into the instance like Sequelize does
const updatingRepo = (extra = {}) => ({
  update: jest.fn(async (instance, changes) => Object.assign(instance, changes)),
  create: jest.fn(async (data) => record({ id: 'new-id', ...data })),
  ...extra
});

module.exports = { dayFromToday, users, record, updatingRepo };
