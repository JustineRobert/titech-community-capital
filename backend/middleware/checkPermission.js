const { roleHasPermission } = require('../services/rbacService');

function checkPermission(permission) {
  return async function(req, res, next) {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'Unauthorized' } });
    const ok = await roleHasPermission(user.role, permission);
    if (!ok) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    next();
  };
}

module.exports = checkPermission;
