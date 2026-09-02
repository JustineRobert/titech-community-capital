// ============================================================================
// backend/middleware/auth.js
// TITech Community Capital
// Enterprise Authentication & Authorization Middleware
// Production Grade
//
// Architecture:
//   Bootstrap / Configuration
//        ↓
//   Auth configuration resolution
//        ↓
//   JWT verification
//        ↓
//   Identity normalization
//        ↓
//   Authentication
//        ↓
//   Authorization / Tenant enforcement
//
// Design goals:
//   - No module-load-time secret validation
//   - Configuration-first JWT resolution
//   - Dependency-injection friendly
//   - Backward-compatible middleware exports
//   - Strict JWT algorithm enforcement
//   - Issuer / audience validation when configured
//   - Multi-tenant safety
//   - Safe authentication errors
//   - No token/secret leakage in logs
//   - Defensive claim normalization
//   - Production-safe authorization helpers
// ============================================================================

'use strict';

const jwt = require('jsonwebtoken');

// ============================================================================
// CONSTANTS
// ============================================================================

const COMPONENT = 'middleware/auth';
const SERVICE_NAME = 'titech-community-capital-backend';

const DEFAULT_ALGORITHM = 'HS256';

const SUPPORTED_ALGORITHMS = Object.freeze([
  'HS256',
  'HS384',
  'HS512',
]);

const AUTH_SCHEME = 'Bearer';

const MAX_TOKEN_LENGTH = 8192;
const MAX_TENANT_ID_LENGTH = 128;

const CODE = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  TOKEN_MISSING: 'TOKEN_MISSING',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',

  TENANT_REQUIRED: 'TENANT_REQUIRED',
  TENANT_DENIED: 'TENANT_DENIED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',

  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',

  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  AUTH_CONFIGURATION_INVALID:
    'AUTH_CONFIGURATION_INVALID',
});

// ============================================================================
// RUNTIME CONFIGURATION STATE
// ============================================================================
//
// IMPORTANT:
//
// This module deliberately does NOT validate JWT secrets while being required.
//
// Routes may safely do:
//
//     require('../middleware/auth')
//
// before bootstrap has finished constructing its runtime context.
//
// The bootstrap/application composition root may explicitly bind configuration
// using:
//
//     configureAuth(context)
//
// or construct isolated middleware with:
//
//     createAuthMiddleware(context)
//
// ============================================================================

let configuredAuth = null;

// ============================================================================
// SAFE HELPERS
// ============================================================================

function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function normalizeString(value, fallback = null) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function normalizeId(value) {
  return normalizeString(value, null);
}

function normalizeRole(value) {
  const normalized =
    normalizeString(value, null);

  return normalized
    ? normalized.toLowerCase()
    : null;
}

function normalizeRoles(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map(normalizeRole)
        .filter(Boolean)
    ),
  ];
}

function normalizePermissions(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map(value =>
          normalizeString(value, null)
        )
        .filter(Boolean)
    ),
  ];
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function safeHeaderValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value).trim() || null;
}

function getRequestId(req) {
  return (
    req?.requestId ??
    req?.context?.requestId ??
    null
  );
}

function getCorrelationId(req) {
  return (
    req?.correlationId ??
    req?.context?.correlationId ??
    null
  );
}

// ============================================================================
// SAFE AUTH ERROR RESPONSE
// ============================================================================

function sendAuthError(
  res,
  status,
  code,
  message,
  req
) {
  if (
    res?.headersSent
  ) {
    return false;
  }

  res.status(status).json({
    success: false,
    code,
    message,
    requestId:
      getRequestId(req),
    correlationId:
      getCorrelationId(req),
  });

  return true;
}

// ============================================================================
// LOGGER RESOLUTION
// ============================================================================
//
// Never log:
//   - JWT tokens
//   - Authorization headers
//   - secrets
//   - decoded JWT payloads
//   - cookies
//
// The logger is optional so this middleware remains load-safe during bootstrap.
// ============================================================================

function resolveLogger(context = null) {
  const candidate =
    context?.logger ??
    context?.servicesContext?.logger ??
    context?.serviceContext?.logger ??
    null;

  if (
    candidate &&
    (
      typeof candidate.warn ===
        'function' ||
      typeof candidate.error ===
        'function' ||
      typeof candidate.debug ===
        'function'
    )
  ) {
    return candidate;
  }

  return console;
}

function logAuthFailure(
  req,
  context,
  error,
  event = 'authentication.failed'
) {
  const logger =
    resolveLogger(context);

  const payload = {
    component: COMPONENT,
    service: SERVICE_NAME,
    event,
    requestId:
      getRequestId(req),
    correlationId:
      getCorrelationId(req),
    errorName:
      error?.name ||
      undefined,
    errorCode:
      error?.code ||
      undefined,
  };

  // Development diagnostics only.
  //
  // Intentionally excludes:
  //   error.message
  //   token
  //   req.headers.authorization
  //   decoded JWT payload
  //
  if (
    typeof logger.debug ===
    'function'
  ) {
    logger.debug(payload);
  }
}

// ============================================================================
// CONFIGURATION RESOLUTION
// ============================================================================

function extractConfiguration(
  source
) {
  if (!source) {
    return null;
  }

  /*
   * Direct configuration object.
   */
  if (
    source.jwt &&
    typeof source.jwt === 'object'
  ) {
    return source;
  }

  /*
   * Bootstrap context.
   */
  if (
    source.configuration &&
    source.configuration.jwt
  ) {
    return source.configuration;
  }

  /*
   * Generic config context.
   */
  if (
    source.config &&
    source.config.jwt
  ) {
    return source.config;
  }

  /*
   * Services context may expose config.
   */
  if (
    source.servicesContext?.config?.jwt
  ) {
    return source.servicesContext.config;
  }

  if (
    source.serviceContext?.config?.jwt
  ) {
    return source.serviceContext.config;
  }

  return null;
}

function validateAuthConfiguration(
  configuration
) {
  if (
    !configuration ||
    typeof configuration !==
      'object'
  ) {
    throw new Error(
      'TITech authentication configuration is unavailable.'
    );
  }

  const jwtConfig =
    configuration.jwt;

  if (
    !jwtConfig ||
    typeof jwtConfig !==
      'object'
  ) {
    throw new Error(
      'TITech JWT configuration is unavailable.'
    );
  }

  const accessSecret =
    normalizeString(
      jwtConfig.accessSecret ??
      jwtConfig.ACCESS_TOKEN_SECRET ??
      jwtConfig.accessTokenSecret ??
      null,
      null
    );

  /*
   * Production correctness:
   *
   * The access secret must be sufficiently strong.
   *
   * We intentionally do not log its value.
   */
  if (
    !accessSecret ||
    accessSecret.length < 32
  ) {
    throw new Error(
      'TITech JWT access secret is not configured correctly.'
    );
  }

  const algorithm =
    normalizeString(
      jwtConfig.algorithm ??
      DEFAULT_ALGORITHM,
      DEFAULT_ALGORITHM
    ).toUpperCase();

  if (
    !SUPPORTED_ALGORITHMS.includes(
      algorithm
    )
  ) {
    throw new Error(
      `Unsupported TITech JWT algorithm "${algorithm}".`
    );
  }

  const issuer =
    normalizeString(
      jwtConfig.issuer,
      null
    );

  const audience =
    normalizeString(
      jwtConfig.audience,
      null
    );

  const accessExpiresIn =
    normalizeString(
      jwtConfig.accessExpiresIn,
      null
    );

  return Object.freeze({
    accessSecret,

    algorithm,

    issuer,

    audience,

    accessExpiresIn,
  });
}

// ============================================================================
// LEGACY CONFIGURATION COMPATIBILITY
// ============================================================================
//
// This is intentionally a FALLBACK, not the primary configuration authority.
//
// Primary:
//   resolved bootstrap/configuration object
//
// Compatibility:
//   process.env.ACCESS_TOKEN_SECRET
//   process.env.JWT_SECRET
//
// This fallback prevents older standalone scripts/tests from breaking while
// keeping the application architecture configuration-first.
// ============================================================================

function resolveLegacyEnvironmentConfiguration() {
  const accessSecret =
    normalizeString(
      process.env.ACCESS_TOKEN_SECRET ??
      process.env.JWT_SECRET ??
      null,
      null
    );

  if (!accessSecret) {
    return null;
  }

  const algorithm =
    normalizeString(
      process.env.JWT_ALGORITHM ??
      DEFAULT_ALGORITHM,
      DEFAULT_ALGORITHM
    ).toUpperCase();

  const issuer =
    normalizeString(
      process.env.JWT_ISSUER,
      null
    );

  const audience =
    normalizeString(
      process.env.JWT_AUDIENCE,
      null
    );

  return validateAuthConfiguration({
    jwt: {
      accessSecret,
      algorithm,
      issuer,
      audience,
    },
  });
}

function resolveAuthConfiguration(
  context = null
) {
  /*
   * Explicitly configured runtime state.
   */
  if (configuredAuth) {
    return configuredAuth;
  }

  /*
   * Explicit context/configuration.
   */
  const configuration =
    extractConfiguration(
      context
    );

  if (configuration) {
    return validateAuthConfiguration(
      configuration
    );
  }

  /*
   * Compatibility fallback.
   *
   * We only evaluate environment variables here, lazily.
   *
   * This means require('../middleware/auth') can never crash the application
   * during route module loading merely because configuration has not yet been
   * bound.
   */
  const legacy =
    resolveLegacyEnvironmentConfiguration();

  if (legacy) {
    return legacy;
  }

  throw Object.assign(
    new Error(
      'TITech authentication configuration is unavailable. Configure bootstrap configuration before handling authenticated requests.'
    ),
    {
      code:
        CODE.AUTH_CONFIGURATION_INVALID,
    }
  );
}

// ============================================================================
// CONFIGURATION BINDING
// ============================================================================

function configureAuth(
  context
) {
  const configuration =
    extractConfiguration(
      context
    );

  if (!configuration) {
    throw Object.assign(
      new Error(
        'Cannot configure TITech authentication: resolved application configuration is unavailable.'
      ),
      {
        code:
          CODE.AUTH_CONFIGURATION_INVALID,
      }
    );
  }

  const resolved =
    validateAuthConfiguration(
      configuration
    );

  /*
   * Copy only the required immutable authentication values.
   *
   * The full configuration object is intentionally not retained.
   */
  configuredAuth =
    Object.freeze({
      ...resolved,
    });

  return getAuthConfiguration();
}

function clearAuthConfiguration() {
  configuredAuth = null;
}

function getAuthConfiguration() {
  if (!configuredAuth) {
    return null;
  }

  return Object.freeze({
    ...configuredAuth,
  });
}

// ============================================================================
// FACTORY
// ============================================================================
//
// Recommended dependency-injection API.
//
// Example:
//
// const {
//   createAuthMiddleware,
// } = require('../middleware/auth');
//
// const authenticate = createAuthMiddleware(
//   bootstrapContext
// );
//
// router.get(
//   '/protected',
//   authenticate,
//   controller
// );
//
// ============================================================================

function createAuthMiddleware(
  context = null
) {
  const authConfiguration =
    resolveAuthConfiguration(
      context
    );

  return async function
    authenticateWithConfiguration(
      req,
      res,
      next
    ) {
    return authenticateRequest(
      req,
      res,
      next,
      authConfiguration
    );
  };
}

// ============================================================================
// TOKEN EXTRACTION
// ============================================================================

function extractToken(req) {
  if (!req) {
    return null;
  }

  const headers =
    req.headers || {};

  const authHeader =
    headers.authorization ??
    headers.Authorization ??
    null;

  if (
    typeof authHeader ===
      'string'
  ) {
    const trimmed =
      authHeader.trim();

    const separatorIndex =
      trimmed.indexOf(' ');

    if (
      separatorIndex > 0
    ) {
      const scheme =
        trimmed
          .slice(
            0,
            separatorIndex
          )
          .trim();

      const credentials =
        trimmed
          .slice(
            separatorIndex + 1
          )
          .trim();

      if (
        scheme.toLowerCase() ===
          AUTH_SCHEME.toLowerCase() &&
        credentials
      ) {
        return credentials;
      }
    }
  }

  /*
   * Legacy compatibility.
   */
  const xAuthToken =
    safeHeaderValue(
      headers['x-auth-token']
    );

  if (xAuthToken) {
    return xAuthToken;
  }

  /*
   * Optional cookie support when a compatible access token cookie has been
   * explicitly parsed by cookie-parser.
   *
   * This does NOT change the default requirement: Authorization remains the
   * preferred transport.
   */
  const cookieToken =
    safeHeaderValue(
      req.cookies?.accessToken ??
      req.cookies?.access_token ??
      null
    );

  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

// ============================================================================
// TOKEN VALIDATION
// ============================================================================

function validateTokenShape(
  token
) {
  if (
    typeof token !==
    'string'
  ) {
    return false;
  }

  const normalized =
    token.trim();

  if (
    !normalized ||
    normalized.length >
      MAX_TOKEN_LENGTH
  ) {
    return false;
  }

  /*
   * JWT compact serialization should contain exactly three segments.
   */
  const parts =
    normalized.split('.');

  return (
    parts.length === 3 &&
    parts.every(
      part =>
        part.length > 0
    )
  );
}

// ============================================================================
// TOKEN VERIFICATION
// ============================================================================

function verifyJwtToken(
  token,
  context = null
) {
  const authConfiguration =
    resolveAuthConfiguration(
      context
    );

  if (
    !validateTokenShape(
      token
    )
  ) {
    throw Object.assign(
      new Error(
        'Invalid JWT structure.'
      ),
      {
        code:
          CODE.TOKEN_INVALID,
      }
    );
  }

  const verifyOptions = {
    algorithms: [
      authConfiguration.algorithm,
    ],
  };

  if (
    authConfiguration.issuer
  ) {
    verifyOptions.issuer =
      authConfiguration.issuer;
  }

  if (
    authConfiguration.audience
  ) {
    verifyOptions.audience =
      authConfiguration.audience;
  }

  return jwt.verify(
    token,
    authConfiguration.accessSecret,
    verifyOptions
  );
}

// ============================================================================
// USER NORMALIZATION
// ============================================================================

function normalizeUser(
  decoded
) {
  if (
    !decoded ||
    typeof decoded !==
      'object'
  ) {
    return null;
  }

  const source =
    decoded.user &&
    typeof decoded.user ===
      'object'
      ? decoded.user
      : decoded;

  const id =
    normalizeId(
      source.id ??
      source._id ??
      decoded.sub ??
      null
    );

  if (!id) {
    return null;
  }

  const roles =
    normalizeRoles(
      source.roles
    );

  const role =
    normalizeRole(
      source.role
    );

  if (
    role &&
    !roles.includes(role)
  ) {
    roles.push(role);
  }

  const permissions =
    normalizePermissions(
      source.permissions
    );

  const tenantId =
    normalizeId(
      source.tenantId ??
      decoded.tenantId ??
      null
    );

  return {
    id,
    _id: id,

    email:
      normalizeString(
        source.email ??
        null,
        null
      ),

    role,

    roles,

    permissions,

    tenantId,

    isVerified:
      normalizeBoolean(
        source.isVerified
      ),

    isActive:
      normalizeBoolean(
        source.isActive
      ),
  };
}

// ============================================================================
// AUTH CONTEXT
// ============================================================================

function buildAuthContext(
  req,
  decoded,
  user,
  token
) {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    roles: user.roles,
    tenantId: user.tenantId,
    permissions:
      user.permissions,

    authenticated: true,

    requestId:
      getRequestId(req),

    correlationId:
      getCorrelationId(req),

    tokenType:
      AUTH_SCHEME,

    /*
     * Token itself is deliberately NOT exposed through req.auth.
     */
    tokenPresent:
      Boolean(token),

    jwt: {
      subject:
        normalizeId(
          decoded?.sub ??
          user.id
        ),

      issuer:
        normalizeString(
          decoded?.iss,
          null
        ),

      audience:
        decoded?.aud ??
        null,

      tokenId:
        normalizeString(
          decoded?.jti,
          null
        ),
    },
  };
}

// ============================================================================
// AUTHENTICATION REQUEST
// ============================================================================

async function authenticateRequest(
  req,
  res,
  next,
  authConfiguration,
  context = null
) {
  try {
    if (!authConfiguration) {
      throw Object.assign(
        new Error(
          'TITech authentication configuration is unavailable.'
        ),
        {
          code:
            CODE.AUTH_CONFIGURATION_INVALID,
        }
      );
    }

    const token =
      extractToken(req);

    if (!token) {
      return sendAuthError(
        res,
        401,
        CODE.TOKEN_MISSING,
        'Authentication token required.',
        req
      );
    }

    const decoded =
      verifyJwtToken(
        token,
        {
          configuration: {
            jwt:
              authConfiguration,
          },
        }
      );

    const user =
      normalizeUser(
        decoded
      );

    if (!user) {
      return sendAuthError(
        res,
        401,
        CODE.TOKEN_INVALID,
        'Unable to identify the authenticated user.',
        req
      );
    }

    /*
     * Reject tokens without a valid subject identity.
     */
    if (!user.id) {
      return sendAuthError(
        res,
        401,
        CODE.TOKEN_INVALID,
        'Invalid authentication identity.',
        req
      );
    }

    /*
     * Populate canonical request authentication state.
     */
    req.user = user;

    req.jwt = decoded;

    /*
     * Preserve compatibility for code that currently reads req.token.
     *
     * This remains request-scoped only.
     */
    req.token = token;

    req.auth =
      buildAuthContext(
        req,
        decoded,
        user,
        token
      );

    /*
     * Canonical tenant identity comes from the authenticated token.
     *
     * Header context remains separately available as requestedTenantId.
     */
    const requestedTenantId =
      normalizeTenantId(
        req.headers?.[
          'x-tenant-id'
        ]
      );

    req.requestedTenantId =
      requestedTenantId;

    if (
      user.tenantId
    ) {
      req.authenticatedTenantId =
        user.tenantId;
    }

    /*
     * Do not blindly overwrite req.tenantId if an earlier request-context
     * middleware already populated it.
     *
     * Prefer authenticated tenant identity once authentication succeeds.
     */
    if (
      user.tenantId
    ) {
      req.tenantId =
        user.tenantId;
    }

    return next();
  } catch (error) {
    logAuthFailure(
      req,
      context,
      error,
      'authentication.failed'
    );

    if (
      error?.name ===
      'TokenExpiredError'
    ) {
      return sendAuthError(
        res,
        401,
        CODE.TOKEN_EXPIRED,
        'Access token expired.',
        req
      );
    }

    if (
      error?.name ===
      'NotBeforeError'
    ) {
      return sendAuthError(
        res,
        401,
        CODE.TOKEN_INVALID,
        'Authentication token is not yet valid.',
        req
      );
    }

    if (
      error?.code ===
      CODE.AUTH_CONFIGURATION_INVALID
    ) {
      /*
       * Configuration failures are server-side faults.
       *
       * Never expose configuration details.
       */
      return sendAuthError(
        res,
        500,
        CODE.AUTH_CONFIGURATION_INVALID,
        'Authentication service is not correctly configured.',
        req
      );
    }

    return sendAuthError(
      res,
      401,
      CODE.TOKEN_INVALID,
      'Invalid authentication token.',
      req
    );
  }
}

// ============================================================================
// AUTHENTICATION
// ============================================================================
//
// Backward-compatible public middleware.
//
// Configuration is resolved lazily, so requiring this module cannot crash
// route startup because JWT configuration has not yet been bound.
//
// ============================================================================

async function authenticate(
  req,
  res,
  next
) {
  try {
    const authConfiguration =
      resolveAuthConfiguration();

    return authenticateRequest(
      req,
      res,
      next,
      authConfiguration
    );
  } catch (error) {
    logAuthFailure(
      req,
      null,
      error,
      'authentication.configuration.failed'
    );

    return sendAuthError(
      res,
      500,
      CODE.AUTH_CONFIGURATION_INVALID,
      'Authentication service is not correctly configured.',
      req
    );
  }
}

// ============================================================================
// OPTIONAL AUTH
// ============================================================================
//
// Optional authentication never rejects an unauthenticated request.
//
// Invalid/expired tokens are treated as anonymous access.
//
// This is appropriate for public endpoints that can optionally personalize
// responses for authenticated users.
// ============================================================================

async function optionalAuth(
  req,
  res,
  next
) {
  try {
    const token =
      extractToken(req);

    if (!token) {
      return next();
    }

    const decoded =
      verifyJwtToken(
        token
      );

    const user =
      normalizeUser(
        decoded
      );

    if (!user) {
      return next();
    }

    req.token = token;
    req.jwt = decoded;
    req.user = user;

    req.auth =
      buildAuthContext(
        req,
        decoded,
        user,
        token
      );

    const requestedTenantId =
      normalizeTenantId(
        req.headers?.[
          'x-tenant-id'
        ]
      );

    req.requestedTenantId =
      requestedTenantId;

    if (
      user.tenantId
    ) {
      req.tenantId =
        user.tenantId;

      req.authenticatedTenantId =
        user.tenantId;
    }

    return next();
  } catch (error) {
    /*
     * Optional authentication intentionally suppresses authentication
     * failures. Never expose whether a supplied token was structurally valid
     * to anonymous callers.
     */
    return next();
  }
}

// ============================================================================
// ROLE NORMALIZATION
// ============================================================================

function normalizeAllowedRoles(
  allowedRoles
) {
  return [
    ...new Set(
      allowedRoles
        .flatMap(
          role =>
            Array.isArray(role)
              ? role
              : [role]
        )
        .map(
          normalizeRole
        )
        .filter(Boolean)
    ),
  ];
}

// ============================================================================
// ROLE AUTHORIZATION
// ============================================================================

function requireRole(
  ...allowedRoles
) {
  const roles =
    normalizeAllowedRoles(
      allowedRoles
    );

  return (
    req,
    res,
    next
  ) => {
    if (
      !req.user
    ) {
      return sendAuthError(
        res,
        401,
        CODE.AUTH_REQUIRED,
        'Authentication required.',
        req
      );
    }

    if (
      roles.length === 0
    ) {
      return sendAuthError(
        res,
        403,
        CODE.INSUFFICIENT_ROLE,
        'No authorized role is configured for this resource.',
        req
      );
    }

    const userRoles =
      [
        req.user.role,
        ...(req.user.roles || []),
      ]
        .map(
          normalizeRole
        )
        .filter(Boolean);

    const allowed =
      userRoles.some(
        role =>
          roles.includes(
            role
          )
      );

    if (!allowed) {
      return sendAuthError(
        res,
        403,
        CODE.INSUFFICIENT_ROLE,
        'Insufficient role permissions.',
        req
      );
    }

    return next();
  };
}

// ============================================================================
// PERMISSION NORMALIZATION
// ============================================================================

function normalizePermission(
  value
) {
  return normalizeString(
    value,
    null
  );
}

// ============================================================================
// PERMISSION AUTHORIZATION
// ============================================================================

function requirePermission(
  ...permissions
) {
  const requiredPermissions =
    [
      ...new Set(
        permissions
          .flatMap(
            permission =>
              Array.isArray(
                permission
              )
                ? permission
                : [permission]
          )
          .map(
            normalizePermission
          )
          .filter(Boolean)
      ),
    ];

  return (
    req,
    res,
    next
  ) => {
    if (
      !req.user
    ) {
      return sendAuthError(
        res,
        401,
        CODE.AUTH_REQUIRED,
        'Authentication required.',
        req
      );
    }

    if (
      requiredPermissions.length ===
      0
    ) {
      return sendAuthError(
        res,
        403,
        CODE.INSUFFICIENT_PERMISSION,
        'No required permission is configured for this resource.',
        req
      );
    }

    const userPermissions =
      new Set(
        normalizePermissions(
          req.user.permissions
        )
      );

    const authorized =
      requiredPermissions.every(
        permission =>
          userPermissions.has(
            permission
          )
      );

    if (!authorized) {
      return sendAuthError(
        res,
        403,
        CODE.INSUFFICIENT_PERMISSION,
        'Permission denied.',
        req
      );
    }

    return next();
  };
}

// ============================================================================
// TENANT NORMALIZATION
// ============================================================================

function normalizeTenantId(
  value
) {
  const tenantId =
    normalizeString(
      value,
      null
    );

  if (
    !tenantId ||
    tenantId.length >
      MAX_TENANT_ID_LENGTH
  ) {
    return null;
  }

  return tenantId;
}

// ============================================================================
// REQUIRE TENANT
// ============================================================================
//
// This middleware validates that a tenant context was supplied.
//
// It does NOT establish authorization.
//
// Authorization is established later by enforceTenantAccess().
// ============================================================================

function requireTenant(
  req,
  res,
  next
) {
  const tenantId =
    normalizeTenantId(
      req.headers?.[
        'x-tenant-id'
      ]
    );

  if (!tenantId) {
    return sendAuthError(
      res,
      400,
      CODE.TENANT_REQUIRED,
      'Tenant ID required.',
      req
    );
  }

  /*
   * Preserve both the requested tenant and the existing canonical field.
   *
   * requestTenantId is explicitly untrusted until enforceTenantAccess()
   * succeeds.
   */
  req.requestedTenantId =
    tenantId;

  return next();
}

// ============================================================================
// TENANT ACCESS CONTROL
// ============================================================================
//
// Security rule:
//
//   JWT tenant claim = authoritative tenant identity.
//
//   x-tenant-id = requested context only.
//
// A caller cannot switch tenant merely by changing the header.
// ============================================================================

function enforceTenantAccess(
  req,
  res,
  next
) {
  if (
    !req.user ||
    !normalizeTenantId(
      req.user.tenantId
    )
  ) {
    return sendAuthError(
      res,
      403,
      CODE.TENANT_DENIED,
      'Tenant access denied.',
      req
    );
  }

  const authenticatedTenant =
    normalizeTenantId(
      req.user.tenantId
    );

  const requestedTenant =
    normalizeTenantId(
      req.requestedTenantId ??
      req.headers?.[
        'x-tenant-id'
      ]
    );

  /*
   * If a request explicitly specifies a tenant, it MUST match the tenant
   * encoded in the authenticated identity.
   */
  if (
    requestedTenant &&
    requestedTenant !==
      authenticatedTenant
  ) {
    return sendAuthError(
      res,
      403,
      CODE.TENANT_MISMATCH,
      'Tenant mismatch detected.',
      req
    );
  }

  /*
   * Canonical tenant context becomes the authenticated tenant only after the
   * authorization check passes.
   */
  req.tenantId =
    authenticatedTenant;

  req.authenticatedTenantId =
    authenticatedTenant;

  if (req.auth) {
    req.auth.tenantId =
      authenticatedTenant;
  }

  return next();
}

// ============================================================================
// ACCOUNT STATUS CHECK
// ============================================================================

function requireActiveUser(
  req,
  res,
  next
) {
  if (
    req.user &&
    req.user.isActive === false
  ) {
    return sendAuthError(
      res,
      403,
      CODE.ACCOUNT_DISABLED,
      'Account is disabled.',
      req
    );
  }

  return next();
}

// ============================================================================
// VERIFIED USER
// ============================================================================
//
// Optional helper for routes that require identity verification.
//
// ============================================================================

function requireVerifiedUser(
  req,
  res,
  next
) {
  if (
    !req.user
  ) {
    return sendAuthError(
      res,
      401,
      CODE.AUTH_REQUIRED,
      'Authentication required.',
      req
    );
  }

  if (
    req.user.isVerified !== true
  ) {
    return sendAuthError(
      res,
      403,
      'ACCOUNT_NOT_VERIFIED',
      'Account verification is required.',
      req
    );
  }

  return next();
}

// ============================================================================
// COMMON ROLE SHORTCUTS
// ============================================================================

const isAdmin =
  requireRole(
    'admin'
  );

const isSuperAdmin =
  requireRole(
    'super_admin'
  );

const isGroupAdmin =
  requireRole(
    'admin',
    'group_admin'
  );

const isAuditor =
  requireRole(
    'auditor'
  );

// ============================================================================
// FINANCIAL-SAFETY SHORTCUT
// ============================================================================
//
// Authentication alone does NOT authorize financial operations.
//
// Financial routes should additionally enforce:
//   - tenant access
//   - appropriate permission
//   - idempotency
//   - transaction boundary
//   - ledger authorization
//
// This helper only combines identity requirements that belong in middleware.
// ============================================================================

function requireAuthenticatedTenant(
  req,
  res,
  next
) {
  if (!req.user) {
    return sendAuthError(
      res,
      401,
      CODE.AUTH_REQUIRED,
      'Authentication required.',
      req
    );
  }

  return enforceTenantAccess(
    req,
    res,
    next
  );
}

// ============================================================================
// DI-FRIENDLY MIDDLEWARE BUNDLE
// ============================================================================
//
// Useful for route composition:
//
// const auth = createAuthMiddleware(context);
// router.post('/...', auth, requireActiveUser, ...);
//
// ============================================================================

function createAuthBundle(
  context = null
) {
  const authenticateMiddleware =
    createAuthMiddleware(
      context
    );

  return Object.freeze({
    authenticate:
      authenticateMiddleware,

    optionalAuth,

    requireRole,

    requirePermission,

    requireTenant,

    enforceTenantAccess,

    requireAuthenticatedTenant,

    requireActiveUser,

    requireVerifiedUser,

    isAdmin,

    isSuperAdmin,

    isGroupAdmin,

    isAuditor,
  });
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

function getAuthDiagnostics(
  context = null
) {
  try {
    const authConfiguration =
      resolveAuthConfiguration(
        context
      );

    return Object.freeze({
      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      configured:
        true,

      algorithm:
        authConfiguration.algorithm,

      issuerConfigured:
        Boolean(
          authConfiguration.issuer
        ),

      audienceConfigured:
        Boolean(
          authConfiguration.audience
        ),

      accessSecretConfigured:
        true,

      /*
       * Never return the secret itself.
       */
      accessSecretLength:
        authConfiguration
          .accessSecret
          .length,
    });
  } catch {
    return Object.freeze({
      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      configured:
        false,

      algorithm:
        null,

      issuerConfigured:
        false,

      audienceConfigured:
        false,

      accessSecretConfigured:
        false,

      accessSecretLength:
        0,
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // --------------------------------------------------------------------------
  // Canonical authentication
  // --------------------------------------------------------------------------

  authenticate,

  /*
   * Legacy compatibility alias.
   */
  verifyToken:
    authenticate,

  optionalAuth,

  createAuthMiddleware,

  createAuthBundle,

  // --------------------------------------------------------------------------
  // Configuration lifecycle
  // --------------------------------------------------------------------------

  configureAuth,

  clearAuthConfiguration,

  getAuthConfiguration,

  getAuthDiagnostics,

  // --------------------------------------------------------------------------
  // Token utilities
  // --------------------------------------------------------------------------

  extractToken,

  verifyJwtToken,

  /*
   * Legacy-compatible name.
   */
  verifyTokenPayload:
    verifyJwtToken,

  validateTokenShape,

  normalizeUser,

  // --------------------------------------------------------------------------
  // Authorization
  // --------------------------------------------------------------------------

  requireRole,

  requirePermission,

  requireTenant,

  enforceTenantAccess,

  requireAuthenticatedTenant,

  requireActiveUser,

  requireVerifiedUser,

  // --------------------------------------------------------------------------
  // Role shortcuts
  // --------------------------------------------------------------------------

  isAdmin,

  isSuperAdmin,

  isGroupAdmin,

  isAuditor,

  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  CODE: Object.freeze({
    ...CODE,
  }),

  COMPONENT,

  SERVICE_NAME,

  SUPPORTED_ALGORITHMS: Object.freeze([
    ...SUPPORTED_ALGORITHMS,
  ]),
};