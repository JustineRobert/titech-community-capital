const Role = require('../models/Role');
const Permission = require('../models/Permission');

async function seedRolesPermissions() {
  const roles = [
    { name: 'SUPER_ADMIN', permissions: ['*'] },
    { name: 'SACCO_ADMIN', permissions: ['members:read','members:write','loans:approve','transactions:read'] },
    { name: 'TREASURER', permissions: ['transactions:read','transactions:write'] },
    { name: 'MEMBER', permissions: ['self:read'] },
  ];

  for (const r of roles) {
    await Role.updateOne({ name: r.name }, { $setOnInsert: r }, { upsert: true });
  }
}

async function roleHasPermission(roleName, permission) {
  if (!roleName) return false;
  const role = await Role.findOne({ name: roleName }).lean();
  if (!role) return false;
  if (role.permissions.includes('*')) return true;
  return role.permissions.includes(permission);
}

async function createPermission(name, description = '') {
  const Permission = require('../models/Permission');
  return Permission.updateOne({ name }, { $setOnInsert: { name, description } }, { upsert: true });
}

async function createRole(name, permissions = [], tenantId = null) {
  const Role = require('../models/Role');
  const payload = { name, permissions, tenantId };
  return Role.updateOne({ name, tenantId }, { $set: payload }, { upsert: true });
}

async function assignRoleToUser(userId, roleName, tenantId = null) {
  const User = require('../models/User');
  const role = await Role.findOne({ name: roleName, tenantId }).lean();
  if (!role) throw new Error('Role not found');
  return User.updateOne({ _id: userId }, { $set: { role: roleName, tenantId } });
}

module.exports = { seedRolesPermissions, roleHasPermission, createPermission, createRole, assignRoleToUser };

module.exports = { seedRolesPermissions, roleHasPermission };
