/**
 * Resolve Tenant._id from trusted authentication or populated tenant context.
 * `req.tenantId` may be a public, stable tenant slug after tenant middleware;
 * it must never be used as a Mongo ObjectId unless it is actually 24 hex chars.
 */
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export function isMongoObjectId(value) {
  return OBJECT_ID_PATTERN.test(String(value ?? '').trim());
}

export function resolveCanonicalTenantObjectId(req, { code = 'TENANT_OBJECT_ID_CONTEXT_INVALID' } = {}) {
  const candidates = [
    req?.authenticatedTenantId,
    req?.auth?.tenantId,
    req?.auth?.user?.tenantId,
    req?.user?.tenantId,
    req?.user?.user?.tenantId,
    req?.tenant?._id,
    req?.tenant?.id,
    req?.tenantId,
  ];
  const candidate = candidates.find(isMongoObjectId);
  if (!candidate) {
    const error = new Error('A canonical institution identifier is required for this operation.');
    error.code = code;
    error.statusCode = 403;
    throw error;
  }
  return String(candidate).trim().toLowerCase();
}
