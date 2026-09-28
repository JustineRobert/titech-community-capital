/**
 * Minimal compatibility middleware. The canonical audit writer remains in
 * backend/modules/audit. This middleware records only when an explicit audit
 * service adapter is supplied and never mutates financial state.
 */
const auditService = require('./audit.service.js');
module.exports = function auditMiddleware(options = {}) {
  return async function titechAuditMiddleware(req, res, next) {
    res.on('finish', () => {
      if (options.disabled === true || typeof auditService.createAuditLog !== 'function') return;
      const tenantId = req.tenantId || req.context?.tenantId || req.user?.tenantId;
      if (!tenantId) return;
      void auditService.createAuditLog({
        tenantId: String(tenantId),
        action: `HTTP.${String(req.method || 'UNKNOWN')}.${String(req.route?.path || req.path || 'unknown')}`.slice(0, 250),
        actorId: req.user?.id || req.user?._id || null,
        requestId: req.requestId || null,
        correlationId: req.correlationId || null,
        data: { statusCode: res.statusCode },
      }).catch(() => undefined);
    });
    next();
  };
};
