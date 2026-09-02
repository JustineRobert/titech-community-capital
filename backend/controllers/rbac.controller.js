const rbac = require('../services/rbacService');
const logger = require('../utils/logger') || console;

exports.createPermission = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, error: { code: 'INVALID', message: 'name required' } });
    await rbac.createPermission(name, description);
    return res.status(201).json({ success: true });
  } catch (err) {
    logger.error('createPermission error', { err: err.message });
    return res.status(500).json({ success: false, error: { code: 'ERROR', message: err.message } });
  }
};

exports.createRole = async (req, res) => {
  try {
    const { name, permissions, tenantId } = req.body;
    if (!name) return res.status(400).json({ success: false, error: { code: 'INVALID', message: 'name required' } });
    await rbac.createRole(name, permissions || [], tenantId || null);
    return res.status(201).json({ success: true });
  } catch (err) {
    logger.error('createRole error', { err: err.message });
    return res.status(500).json({ success: false, error: { code: 'ERROR', message: err.message } });
  }
};

exports.assignRole = async (req, res) => {
  try {
    const { userId, roleName, tenantId } = req.body;
    if (!userId || !roleName) return res.status(400).json({ success: false, error: { code: 'INVALID', message: 'userId and roleName required' } });
    await rbac.assignRoleToUser(userId, roleName, tenantId || null);
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('assignRole error', { err: err.message });
    return res.status(500).json({ success: false, error: { code: 'ERROR', message: err.message } });
  }
};
