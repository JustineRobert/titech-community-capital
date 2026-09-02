function enforceTenant(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'Unauthorized' } });
  // prefer tenantId in params or body
  const tenantFromReq = req.params.tenantId || req.body.tenantId || req.query.tenantId;
  if (tenantFromReq && tenantFromReq.toString() !== String(user.tenantId)) {
    return res.status(403).json({ success: false, error: { code: 'TENANT_MISMATCH', message: 'Access across tenants forbidden' } });
  }
  next();
}

module.exports = enforceTenant;
