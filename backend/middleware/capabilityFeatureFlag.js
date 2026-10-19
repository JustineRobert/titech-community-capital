/** Server-side feature gates. These are additional to authentication, RBAC,
 * tenant isolation, licensing and domain validation; they never replace them. */
export function capabilityEnabled(name, env = process.env) {
  return String(env[name] || '').trim().toLowerCase() === 'true';
}

export function requireCapabilityFlag(name) {
  const requiredName = String(name || '').trim();
  if (!requiredName) throw new TypeError('A capability flag name is required.');
  return (req, res, next) => {
    if (!capabilityEnabled(requiredName)) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'CAPABILITY_DISABLED',
          message: 'This capability is disabled until its configuration and required readiness approvals are complete.',
          capability: requiredName,
        },
        requestId: req.requestId || null,
        correlationId: req.correlationId || req.requestId || null,
      });
    }
    return next();
  };
}
