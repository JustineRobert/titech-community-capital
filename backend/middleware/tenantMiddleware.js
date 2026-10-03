import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import tenantService, { normalizeTenantId } from '../services/tenantService.js';
import logger from '../utils/logger.js';

const CONTEXT_HEADERS = Object.freeze({
  TENANT_ID: 'x-tenant-id',
  REQUEST_ID: 'x-request-id',
  CORRELATION_ID: 'x-correlation-id',
});

function createRequestId() { return crypto.randomUUID(); }
function createCorrelationId() { return crypto.randomUUID(); }

function extractBearerToken(authorization) {
  if (!authorization || typeof authorization !== 'string') return null;
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  return scheme === 'Bearer' && token ? token : null;
}

function sendJsonError(res, statusCode, code, message, requestId, correlationId) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message },
    requestId,
    correlationId,
    timestamp: new Date().toISOString(),
  });
}

function getJwtConfiguration() {
  const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET;
  if (!secret) return null;
  return {
    secret,
    algorithms: [String(process.env.JWT_ALGORITHM || 'HS256')],
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined,
  };
}

function verifyToken(token) {
  const configuration = getJwtConfiguration();
  if (!configuration) {
    const error = new Error('Authentication is not configured.');
    error.code = 'AUTH_CONFIGURATION_INVALID';
    error.statusCode = 503;
    throw error;
  }
  return jwt.verify(token, configuration.secret, {
    algorithms: configuration.algorithms,
    ...(configuration.issuer ? { issuer: configuration.issuer } : {}),
    ...(configuration.audience ? { audience: configuration.audience } : {}),
  });
}

async function resolveTenant(req) {
  const headerTenantId = normalizeTenantId(req.get(CONTEXT_HEADERS.TENANT_ID));
  const claimTenantId = normalizeTenantId(
    req.auth?.tenantId || req.user?.tenantId || req.auth?.tenant || req.user?.tenant,
  );

  if (headerTenantId && claimTenantId && headerTenantId !== claimTenantId) {
    const error = new Error('Tenant context does not match the authenticated identity.');
    error.code = 'TENANT_MISMATCH';
    error.statusCode = 403;
    throw error;
  }

  const effectiveTenantId = headerTenantId || claimTenantId;
  if (!effectiveTenantId) {
    const error = new Error('Tenant context is required.');
    error.code = 'TENANT_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const tenant = await tenantService.requireActiveTenant({ tenantId: effectiveTenantId });
  req.tenant = tenant;
  req.tenantId = tenant.tenantId;
  req.tenantKey = tenant.tenantId;
  req.institutionId = tenant.institutionId || req.auth?.institutionId || req.user?.institutionId || null;
}

async function tenantMiddleware(req, res, next) {
  const requestId = req.get(CONTEXT_HEADERS.REQUEST_ID) || req.requestId || createRequestId();
  const correlationId = req.get(CONTEXT_HEADERS.CORRELATION_ID) || req.correlationId || requestId;
  req.requestId = requestId;
  req.correlationId = correlationId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Correlation-Id', correlationId);

  try {
    if (!req.auth && !req.user) {
      const token = extractBearerToken(req.get('authorization'));
      if (!token) return sendJsonError(res, 401, 'AUTH_REQUIRED', 'Authentication is required.', requestId, correlationId);
      const claims = verifyToken(token);
      req.auth = claims;
      req.user = claims;
    }

    await resolveTenant(req);
    return next();
  } catch (error) {
    const statusCode = Number(error?.statusCode) || (error?.code === 'TENANT_NOT_FOUND' ? 404 : 403);
    logger.warn?.('Tenant middleware rejected request.', {
      error: error?.code || error?.message || 'TENANT_MIDDLEWARE_ERROR',
      requestId,
      correlationId,
    });
    return sendJsonError(res, statusCode, error?.code || 'TENANT_CONTEXT_INVALID', error?.message || 'Tenant context could not be established.', requestId, correlationId);
  }
}

tenantMiddleware.requireTenant = tenantMiddleware;
tenantMiddleware.tenantAuthorization = tenantMiddleware;
tenantMiddleware.tenantMiddleware = tenantMiddleware;

export { tenantMiddleware };
export default tenantMiddleware;
