const RBAC_SERVICE_PATH = '../services/rbacService.js';
function checkPermission(permission) {
  return async function(req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'Unauthorized' } });
      const { roleHasPermission } = await import(RBAC_SERVICE_PATH);
      const ok = await roleHasPermission(req.user.role, permission);
      if (!ok) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
module.exports = checkPermission;
