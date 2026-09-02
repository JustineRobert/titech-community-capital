'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Context Utility
 * ============================================================================
 *
 * File:
 *   backend/utils/admin/adminContext.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical request / administrator execution-context utility for TITech
 * Community Capital.
 *
 * The context provides a consistent, immutable-at-the-boundary representation
 * of:
 *
 *   - authenticated administrator / actor
 *   - tenant
 *   - request ID
 *   - correlation ID
 *   - trace ID
 *   - client / device information
 *   - source IP
 *   - user agent
 *   - authorization metadata
 *   - locale / timezone
 *   - service metadata
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * - Built on Node.js AsyncLocalStorage.
 * - Designed for Express, services, repositories, queues and jobs.
 * - Does NOT replace authentication.
 * - Does NOT replace RBAC/permission checks.
 * - Does NOT trust client-supplied tenant IDs over authenticated context.
 * - Supports explicit fail-closed tenant assertions.
 * - Prevents sensitive credentials from being stored in context.
 * - Provides safe logging/audit serialization.
 * - Supports nested execution scopes.
 *
 * Tenant security rule
 * ----------------------------------------------------------------------------
 * The TITech SaaS architecture requires tenant enforcement on every
 * tenant-scoped query. The administrator context therefore treats tenantId
 * as security-sensitive context and exposes explicit assertion helpers.
 *
 * Correlation rule
 * ----------------------------------------------------------------------------
 * Every administrative operation should have a correlation ID so audit,
 * logging, asynchronous jobs and downstream service calls can be tied to one
 * operation.
 *
 * ============================================================================
 */

const crypto = require('node:crypto');
const {
  AsyncLocalStorage,
} = require('node:async_hooks');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const UTILITY_NAME =
  'AdminContext';

const UTILITY_VERSION =
  '2026.1';

const APP_NAME =
  'TITech Community Capital';

/**
 * ============================================================================
 * CONTEXT KEYS
 * ============================================================================
 */

const CONTEXT_SYMBOL =
  Symbol('TITechAdminContext');

/**
 * ============================================================================
 * SENSITIVE KEY PATTERNS
 * ============================================================================
 *
 * Context must never become a secret container.
 * ============================================================================
 */

const SENSITIVE_KEY_PATTERNS =
  Object.freeze([
    /password/i,
    /passwd/i,
    /secret/i,
    /token/i,
    /authorization/i,
    /cookie/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /refresh/i,
    /access.?token/i,
    /otp/i,
    /pin/i,
    /cvv/i,
    /card.?number/i,
    /connection.?string/i,
    /database.?url/i,
    /mongo.?uri/i,
    /redis.?url/i,
    /client.?secret/i,
  ]);

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class AdminContextError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_CONTEXT_ERROR',

      statusCode =
        500,

      details =
        null,

      cause =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminContextError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.details =
      details;

    this.cause =
      cause;
  }
}

/**
 * ============================================================================
 * ASYNC LOCAL STORAGE
 * ============================================================================
 */

const storage =
  new AsyncLocalStorage();

/**
 * ============================================================================
 * GENERIC HELPERS
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return normalized ||
    fallback;
}

function normalizeId(
  value,
  fieldName,
) {
  const normalized =
    normalizeString(value);

  if (
    normalized === null
  ) {
    return null;
  }

  if (
    normalized.length > 200
  ) {
    throw new AdminContextError(
      `${fieldName} exceeds the maximum supported length.`,
      {
        code:
          'CONTEXT_VALUE_TOO_LONG',
      },
    );
  }

  return normalized;
}

function normalizeRole(
  value,
) {
  return normalizeString(
    value,
  )?.toLowerCase();
}

function normalizeRoles(
  value,
) {
  const values =
    Array.isArray(value)
      ? value
      : value
        ? String(value).split(',')
        : [];

  return [
    ...new Set(
      values
        .map(
          (role) =>
            normalizeRole(
              role,
            ),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizePermissionSet(
  value,
) {
  const values =
    Array.isArray(value)
      ? value
      : value
        ? String(value).split(',')
        : [];

  return new Set(
    values
      .map(
        (permission) =>
          normalizeString(
            permission,
          ),
      )
      .filter(Boolean),
  );
}

function generateId() {
  return crypto.randomUUID();
}

function isObject(
  value,
) {
  return Boolean(
    value &&
      typeof value ===
        'object' &&
      !Array.isArray(value),
  );
}

/**
 * ============================================================================
 * SAFE CLONING / REDACTION
 * ============================================================================
 */

function isSensitiveKey(
  key,
) {
  return SENSITIVE_KEY_PATTERNS.some(
    (pattern) =>
      pattern.test(
        String(key),
      ),
  );
}

function redact(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      (item) =>
        redact(item),
    );
  }

  if (
    typeof value !==
    'object'
  ) {
    return value;
  }

  const result =
    {};

  for (
    const [
      key,
      child,
    ] of Object.entries(
      value,
    )
  ) {
    if (
      isSensitiveKey(key)
    ) {
      result[key] =
        '[REDACTED]';

      continue;
    }

    result[key] =
      redact(child);
  }

  return result;
}

function cloneSafe(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof structuredClone ===
    'function'
  ) {
    try {
      return structuredClone(
        value,
      );
    } catch {
      // Continue with JSON fallback.
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(
        value,
      ),
    );
  } catch {
    return null;
  }
}

/**
 * ============================================================================
 * DEEP IMMUTABILITY
 * ============================================================================
 *
 * Context objects should not be mutated after entry into an execution scope.
 * ============================================================================
 */

function deepFreeze(
  value,
) {
  if (
    value === null ||
    typeof value !==
      'object'
  ) {
    return value;
  }

  if (
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child of
    Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(
    value,
  );
}

/**
 * ============================================================================
 * CONTEXT NORMALIZATION
 * ============================================================================
 */

function normalizeContext(
  input = {},
  parent = null,
) {
  if (
    !isObject(input)
  ) {
    throw new AdminContextError(
      'Admin context must be an object.',
      {
        code:
          'INVALID_ADMIN_CONTEXT',
      },
    );
  }

  const source =
    {
      ...(isObject(parent)
        ? parent
        : {}),
      ...input,
    };

  /**
   * Tenant is intentionally taken from explicit trusted context.
   *
   * Controllers/middleware should derive tenantId from authenticated JWT/session
   * context, not blindly from req.body.
   */
  const tenantId =
    normalizeId(
      source.tenantId,
      'tenantId',
    );

  const actorId =
    normalizeId(
      source.actorId ||
        source.userId ||
        source.adminId,
      'actorId',
    );

  const requestId =
    normalizeId(
      source.requestId,
      'requestId',
    ) ||
    generateId();

  const correlationId =
    normalizeId(
      source.correlationId,
      'correlationId',
    ) ||
    requestId;

  const traceId =
    normalizeId(
      source.traceId,
      'traceId',
    );

  const spanId =
    normalizeId(
      source.spanId,
      'spanId',
    );

  const role =
    normalizeRole(
      source.role ||
        source.actorRole,
    );

  const roles =
    normalizeRoles(
      source.roles ||
        source.actorRoles,
    );

  const permissions =
    normalizePermissionSet(
      source.permissions,
    );

  const now =
    new Date();

  const context = {
    contextVersion:
      UTILITY_VERSION,

    contextId:
      source.contextId ||
      generateId(),

    application:
      APP_NAME,

    utility:
      UTILITY_NAME,

    utilityVersion:
      UTILITY_VERSION,

    tenantId,

    actorId,

    userId:
      actorId,

    adminId:
      normalizeId(
        source.adminId,
        'adminId',
      ),

    actor: {
      id:
        actorId,

      role:

        role ||
        null,

      roles,

      type:
        normalizeString(
          source.actorType,
        ) ||
        'administrator',
    },

    authorization: {
      roles: [
        ...roles,
      ],

      permissions: [
        ...permissions,
      ],
    },

    requestId,

    correlationId,

    traceId,

    spanId,

    parentCorrelationId:
      normalizeId(
        source.parentCorrelationId,
        'parentCorrelationId',
      ),

    source: {
      ip:
        normalizeString(
          source.ip ||
            source.ipAddress,
        ),

      userAgent:
        normalizeString(
          source.userAgent,
        ),

      deviceId:
        normalizeId(
          source.deviceId,
          'deviceId',
        ),

      sessionId:
        normalizeId(
          source.sessionId,
          'sessionId',
        ),

      channel:
        normalizeString(
          source.channel,
        ) ||
        'web',
    },

    locale:
      normalizeString(
        source.locale,
      ),

    timezone:
      normalizeString(
        source.timezone,
      ),

    route:
      normalizeString(
        source.route,
      ),

    method:
      normalizeString(
        source.method,
      )?.toUpperCase(),

    service:
      normalizeString(
        source.service,
      ),

    serviceVersion:
      normalizeString(
        source.serviceVersion,
      ),

    operation:
      normalizeString(
        source.operation,
      ),

    requestStartedAt:
      source.requestStartedAt
        ? new Date(
            source.requestStartedAt,
          ).toISOString()
        : now.toISOString(),

    createdAt:
      now.toISOString(),

    metadata:
      redact(
        cloneSafe(
          source.metadata ||
            {},
        ),
      ),
  };

  return deepFreeze(
    context,
  );
}

/**
 * ============================================================================
 * CONTEXT ACCESS
 * ============================================================================
 */

function getRawContext() {
  return (
    storage.getStore() ||
    null
  );
}

/**
 * Returns the currently active context.
 *
 * Never creates a new context implicitly. Call createContext()/run() when a
 * request context is being established.
 */
function getContext() {
  return getRawContext();
}

function hasContext() {
  return Boolean(
    getRawContext(),
  );
}

/**
 * ============================================================================
 * REQUIRED CONTEXT ASSERTIONS
 * ============================================================================
 */

function requireContext() {
  const context =
    getContext();

  if (!context) {
    throw new AdminContextError(
      'No active TITech administrator execution context exists.',
      {
        code:
          'ADMIN_CONTEXT_MISSING',

        statusCode:
          500,
      },
    );
  }

  return context;
}

function requireTenantId() {
  const context =
    requireContext();

  if (
    !context.tenantId
  ) {
    throw new AdminContextError(
      'Tenant context is required for this administrative operation.',
      {
        code:
          'ADMIN_TENANT_CONTEXT_REQUIRED',

        statusCode:
          403,
      },
    );
  }

  return context.tenantId;
}

function requireActorId() {
  const context =
    requireContext();

  if (
    !context.actorId
  ) {
    throw new AdminContextError(
      'Authenticated administrator identity is required.',
      {
        code:
          'ADMIN_ACTOR_CONTEXT_REQUIRED',

        statusCode:
          401,
      },
    );
  }

  return context.actorId;
}

function requireCorrelationId() {
  const context =
    requireContext();

  if (
    !context.correlationId
  ) {
    throw new AdminContextError(
      'Correlation ID is missing from the administrator context.',
      {
        code:
          'CORRELATION_ID_REQUIRED',
      },
    );
  }

  return context.correlationId;
}

/**
 * ============================================================================
 * AUTHORIZATION CONTEXT
 * ============================================================================
 *
 * These methods inspect authorization claims only.
 *
 * They do NOT replace centralized RBAC middleware/policy enforcement.
 * ============================================================================
 */

function getRoles() {
  return [
    ...(
      requireContext()
        .authorization
        .roles || []
    ),
  ];
}

function hasRole(
  role,
) {
  const normalized =
    normalizeRole(
      role,
    );

  if (!normalized) {
    return false;
  }

  return getRoles().includes(
    normalized,
  );
}

function hasAnyRole(
  roles,
) {
  const required =
    normalizeRoles(
      roles,
    );

  if (
    required.length ===
    0
  ) {
    return false;
  }

  const current =
    getRoles();

  return required.some(
    (role) =>
      current.includes(
        role,
      ),
  );
}

function hasAllRoles(
  roles,
) {
  const required =
    normalizeRoles(
      roles,
    );

  if (
    required.length ===
    0
  ) {
    return true;
  }

  const current =
    getRoles();

  return required.every(
    (role) =>
      current.includes(
        role,
      ),
  );
}

function getPermissions() {
  return [
    ...(
      requireContext()
        .authorization
        .permissions || []
    ),
  ];
}

function hasPermission(
  permission,
) {
  const normalized =
    normalizeString(
      permission,
    );

  if (!normalized) {
    return false;
  }

  return getPermissions().includes(
    normalized,
  );
}

function hasAnyPermission(
  permissions,
) {
  const required =
    normalizeArray(
      permissions,
    );

  if (
    required.length ===
    0
  ) {
    return false;
  }

  const current =
    getPermissions();

  return required.some(
    (permission) =>
      current.includes(
        permission,
      ),
  );
}

function hasAllPermissions(
  permissions,
) {
  const required =
    normalizeArray(
      permissions,
    );

  if (
    required.length ===
    0
  ) {
    return true;
  }

  const current =
    getPermissions();

  return required.every(
    (permission) =>
      current.includes(
        permission,
      ),
  );
}

/**
 * ============================================================================
 * TENANT ASSERTIONS
 * ============================================================================
 */

function assertTenant(
  expectedTenantId,
) {
  const actualTenantId =
    requireTenantId();

  const expected =
    normalizeId(
      expectedTenantId,
      'tenantId',
    );

  if (
    !expected
  ) {
    throw new AdminContextError(
      'Expected tenantId is required.',
      {
        code:
          'EXPECTED_TENANT_ID_REQUIRED',
      },
    );
  }

  if (
    actualTenantId !==
    expected
  ) {
    throw new AdminContextError(
      'Administrative tenant context mismatch.',
      {
        code:
          'TENANT_CONTEXT_MISMATCH',

        statusCode:
          403,

        details: {
          expectedTenantId:
            expected,

          actualTenantId,
        },
      },
    );
  }

  return true;
}

function assertActor(
  expectedActorId,
) {
  const actualActorId =
    requireActorId();

  const expected =
    normalizeId(
      expectedActorId,
      'actorId',
    );

  if (
    !expected
  ) {
    throw new AdminContextError(
      'Expected actorId is required.',
      {
        code:
          'EXPECTED_ACTOR_ID_REQUIRED',
      },
    );
  }

  if (
    actualActorId !==
    expected
  ) {
    throw new AdminContextError(
      'Administrative actor context mismatch.',
      {
        code:
          'ACTOR_CONTEXT_MISMATCH',

        statusCode:
          403,
      },
    );
  }

  return true;
}

/**
 * ============================================================================
 * REQUEST / OPERATION METADATA
 * ============================================================================
 */

function getRequestId() {
  return requireContext()
    .requestId;
}

function getCorrelationId() {
  return requireCorrelationId();
}

function getTraceId() {
  return (
    requireContext()
      .traceId ||
    null
  );
}

function getOperation() {
  return (
    requireContext()
      .operation ||
    null
  );
}

function getRequestMetadata() {
  const context =
    requireContext();

  return {
    requestId:
      context.requestId,

    correlationId:
      context.correlationId,

    traceId:
      context.traceId,

    spanId:
      context.spanId,

    tenantId:
      context.tenantId,

    actorId:
      context.actorId,

    role:
      context.actor.role,

    roles:
      [
        ...context.actor.roles,
      ],

    operation:
      context.operation,

    route:
      context.route,

    method:
      context.method,

    channel:
      context.source.channel,
  };
}

/**
 * ============================================================================
 * AUDIT CONTEXT
 * ============================================================================
 *
 * Creates safe metadata for audit services.
 *
 * Sensitive credentials are intentionally omitted.
 * ============================================================================
 */

function getAuditContext(
  overrides = {},
) {
  const context =
    requireContext();

  return {
    tenantId:
      context.tenantId,

    userId:
      context.actorId,

    adminId:
      context.adminId,

    actorId:
      context.actorId,

    actorRole:
      context.actor.role,

    actionBy:
      context.actorId,

    correlationId:
      context.correlationId,

    requestId:
      context.requestId,

    traceId:
      context.traceId,

    operation:
      context.operation,

    service:
      context.service,

    serviceVersion:
      context.serviceVersion,

    route:
      context.route,

    method:
      context.method,

    channel:
      context.source.channel,

    metadata:
      redact(
        cloneSafe(
          overrides,
        ),
      ),

    timestamp:
      new Date(),
  };
}

/**
 * ============================================================================
 * LOGGING CONTEXT
 * ============================================================================
 */

function getLogContext(
  extra = {},
) {
  const context =
    requireContext();

  return {
    service:
      context.service ||
      APP_NAME,

    serviceVersion:
      context.serviceVersion ||
      null,

    tenantId:
      context.tenantId,

    actorId:
      context.actorId,

    requestId:
      context.requestId,

    correlationId:
      context.correlationId,

    traceId:
      context.traceId,

    spanId:
      context.spanId,

    operation:
      context.operation,

    route:
      context.route,

    method:
      context.method,

    channel:
      context.source.channel,

    ...redact(
      cloneSafe(
        extra,
      ),
    ),
  };
}

/**
 * ============================================================================
 * CHILD CONTEXT
 * ============================================================================
 *
 * Useful for service-to-service or job operations.
 *
 * Example:
 *
 *   const child = adminContext.child({
 *     operation: 'loan.approval',
 *   });
 *
 * ============================================================================
 */

function child(
  overrides = {},
) {
  const current =
    getContext();

  return normalizeContext(
    {
      ...overrides,

      parentCorrelationId:
        overrides.parentCorrelationId ||
        current?.correlationId ||
        null,

      tenantId:
        overrides.tenantId !==
        undefined
          ? overrides.tenantId
          : current?.tenantId,

      actorId:
        overrides.actorId !==
        undefined
          ? overrides.actorId
          : current?.actorId,

      userId:
        overrides.userId !==
        undefined
          ? overrides.userId
          : current?.userId,

      adminId:
        overrides.adminId !==
        undefined
          ? overrides.adminId
          : current?.adminId,

      correlationId:
        overrides.correlationId ||
        current?.correlationId,

      requestId:
        overrides.requestId ||
        current?.requestId,

      traceId:
        overrides.traceId ||
        current?.traceId,

      source:
        {
          ...(
            current?.source ||
            {}
          ),

          ...(overrides.source ||
            {}),
        },

      authorization:
        {
          ...(
            current?.authorization ||
            {}
          ),

          ...(overrides.authorization ||
            {}),
        },

      metadata:
        {
          ...(
            current?.metadata ||
            {}
          ),

          ...(overrides.metadata ||
            {}),
        },
    },
    current,
  );
}

/**
 * ============================================================================
 * CREATE CONTEXT
 * ============================================================================
 */

function createContext(
  input = {},
) {
  return normalizeContext(
    input,
  );
}

/**
 * ============================================================================
 * RUN WITH CONTEXT
 * ============================================================================
 */

function run(
  contextOrInput,
  callback,
) {
  if (
    typeof callback !==
    'function'
  ) {
    throw new AdminContextError(
      'Admin context callback must be a function.',
      {
        code:
          'CONTEXT_CALLBACK_REQUIRED',
      },
    );
  }

  const context =
    isContext(
      contextOrInput,
    )
      ? contextOrInput
      : createContext(
          contextOrInput,
        );

  return storage.run(
    context,
    callback,
  );
}

/**
 * ============================================================================
 * RUN WITH CHILD CONTEXT
 * ============================================================================
 */

function runChild(
  overrides,
  callback,
) {
  if (
    typeof callback !==
    'function'
  ) {
    throw new AdminContextError(
      'Admin child-context callback must be a function.',
      {
        code:
          'CONTEXT_CALLBACK_REQUIRED',
      },
    );
  }

  const nextContext =
    child(
      overrides,
    );

  return storage.run(
    nextContext,
    callback,
  );
}

/**
 * ============================================================================
 * BIND CURRENT CONTEXT
 * ============================================================================
 *
 * Useful for queue handlers, callbacks and event listeners.
 * ============================================================================
 */

function bind(
  callback,
) {
  if (
    typeof callback !==
    'function'
  ) {
    throw new AdminContextError(
      'A function is required to bind the current admin context.',
      {
        code:
          'CONTEXT_FUNCTION_REQUIRED',
      },
    );
  }

  const context =
    getContext();

  if (!context) {
    return callback;
  }

  return (
    ...args
  ) =>
    storage.run(
      context,
      () =>
        callback(
          ...args,
        ),
    );
}

/**
 * ============================================================================
 * ENTERPRISE REQUEST CONTEXT
 * ============================================================================
 *
 * Intended for Express middleware.
 *
 * This function does not authenticate the request. Authentication middleware
 * should run first and populate req.user / req.auth / req.tenantId.
 *
 * Example:
 *
 *   app.use(
 *     authenticate,
 *     adminContextMiddleware(),
 *   );
 * ============================================================================
 */

function middleware(
  options = {},
) {
  const {
    requiredTenant =
      options.requiredTenant !==
        false,

    requiredActor =
      options.requiredActor !==
        false,

    source =
      'request',
  } = options;

  return function adminContextMiddleware(
    req,
    res,
    next,
  ) {
    try {
      const auth =
        req.auth ||
        req.authentication ||
        req.user ||
        {};

      /**
       * Trusted tenant source priority:
       *
       * 1. req.tenantId
       * 2. authenticated identity tenantId
       * 3. auth.tenantId
       *
       * Client body/query tenant IDs are intentionally ignored here.
       */
      const tenantId =
        normalizeId(
          req.tenantId ||
            auth.tenantId ||
            auth.tenant?.id ||
            auth.tenant?._id,
          'tenantId',
        );

      const actorId =
        normalizeId(
          auth.userId ||
            auth.id ||
            auth._id,
          'actorId',
        );

      const roles =
        normalizeRoles(
          auth.roles ||
            auth.role,
        );

      const permissions =
        normalizeArray(
          auth.permissions,
        );

      const context =
        createContext({
          tenantId,

          actorId,

          userId:
            actorId,

          adminId:
            actorId,

          actorType:
            auth.actorType ||
            'administrator',

          role:
            auth.role,

          roles,

          permissions,

          requestId:
            req.id ||
            req.requestId ||
            req.headers?.[
              'x-request-id'
            ],

          correlationId:
            req.correlationId ||
            req.headers?.[
              'x-correlation-id'
            ],

          traceId:
            req.traceId ||
            req.headers?.[
              'x-trace-id'
            ],

          source: {
            ip:
              req.ip ||
              req.socket?.remoteAddress,

            userAgent:
              req.get?.(
                'user-agent',
              ) ||
              req.headers?.[
                'user-agent'
              ],

            sessionId:
              auth.sessionId,

            deviceId:
              auth.deviceId,

            channel:
              source,
          },

          locale:
            req.locale ||
            auth.locale,

          timezone:
            req.timezone ||
            auth.timezone,

          route:
            req.originalUrl ||
            req.url,

          method:
            req.method,

          service:
            options.service,

          serviceVersion:
            options.serviceVersion,

          operation:
            req.operation ||
            options.operation,

          metadata: {
            requestPath:
              req.path ||
              null,

            requestMethod:
              req.method ||
              null,
          },
        });

      if (
        requiredTenant &&
        !context.tenantId
      ) {
        throw new AdminContextError(
          'Authenticated tenant context is required.',
          {
            code:
              'TENANT_CONTEXT_REQUIRED',

            statusCode:
              403,
          },
        );
      }

      if (
        requiredActor &&
        !context.actorId
      ) {
        throw new AdminContextError(
          'Authenticated administrator context is required.',
          {
            code:
              'ADMINISTRATOR_CONTEXT_REQUIRED',

            statusCode:
              401,
          },
        );
      }

      /**
       * Expose the immutable context to downstream middleware for convenience.
       */
      req.adminContext =
        context;

      req.context =
        context;

      storage.run(
        context,
        () =>
          next(),
      );
    } catch (error) {
      next(
        error,
      );
    }
  };
}

/**
 * ============================================================================
 * QUEUE / JOB CONTEXT
 * ============================================================================
 *
 * Jobs should explicitly carry tenantId, actor/source metadata and
 * correlationId in their durable payload. This helper reconstructs the
 * execution context when a worker begins processing the job.
 * ============================================================================
 */

function fromJob(
  job,
  options = {},
) {
  if (
    !job
  ) {
    throw new AdminContextError(
      'Job is required to construct administrator context.',
      {
        code:
          'JOB_REQUIRED',
      },
    );
  }

  const payload =
    job.data ||
    job.payload ||
    {};

  return createContext({
    tenantId:
      payload.tenantId ||
      job.tenantId,

    actorId:
      payload.actorId ||
      payload.userId ||
      job.actorId,

    adminId:
      payload.adminId,

    actorType:
      payload.actorType ||
      'job',

    role:
      payload.role,

    roles:
      payload.roles,

    permissions:
      payload.permissions,

    requestId:
      payload.requestId ||
      job.id,

    correlationId:
      payload.correlationId ||
      job.correlationId ||
      job.id,

    traceId:
      payload.traceId,

    operation:
      payload.operation ||
      options.operation ||
      'background-job',

    service:
      options.service ||
      'TITech Community Capital',

    serviceVersion:
      options.serviceVersion,

    source: {
      channel:
        'background-job',

      deviceId:
        null,

      sessionId:
        null,
    },

    metadata: {
      jobId:
        job.id ||
        null,

      queue:
        job.queue?.name ||
        job.queueName ||
        null,

      jobName:
        job.name ||
        null,
    },
  });
}

/**
 * ============================================================================
 * SYSTEM / INTERNAL CONTEXT
 * ============================================================================
 *
 * Used for controlled internal jobs where there is no human actor.
 *
 * This does NOT magically authorize a request. Service code should use its own
 * explicit authorization rules for internal operations.
 * ============================================================================
 */

function createSystemContext(
  {
    tenantId = null,
    operation =
      'internal-operation',
    service =
      APP_NAME,
    serviceVersion =
      null,
    correlationId =
      null,
    requestId =
      null,
    metadata =
      {},
  } = {},
) {
  return createContext({
    tenantId,

    actorId:
      null,

    adminId:
      null,

    actorType:
      'system',

    role:
      'system',

    roles: [
      'system',
    ],

    permissions: [],

    requestId:

      requestId ||
      generateId(),

    correlationId:
      correlationId ||
      generateId(),

    operation,

    service,

    serviceVersion,

    source: {
      channel:
        'internal',
    },

    metadata,
  });
}

/**
 * ============================================================================
 * CONTEXT DETECTION
 * ============================================================================
 */

function isContext(
  value,
) {
  return Boolean(
    isObject(value) &&
      value.contextVersion ===
        UTILITY_VERSION &&
      typeof value.requestId ===
        'string' &&
      typeof value.correlationId ===
        'string' &&
      isObject(
        value.actor,
      ),
  );
}

/**
 * ============================================================================
 * CONTEXT SNAPSHOT
 * ============================================================================
 */

function snapshot(
  {
    redactSensitive =
      true,
  } = {},
) {
  const context =
    getContext();

  if (!context) {
    return null;
  }

  const cloned =
    cloneSafe(
      context,
    );

  return redactSensitive
    ? redact(cloned)
    : cloned;
}

/**
 * ============================================================================
 * CONTEXT HEADER VALUES
 * ============================================================================
 */

function getPropagationHeaders() {
  const context =
    requireContext();

  const headers =
    {
      'x-request-id':
        context.requestId,

      'x-correlation-id':
        context.correlationId,
    };

  if (
    context.traceId
  ) {
    headers[
      'x-trace-id'
    ] =
      context.traceId;
  }

  return headers;
}

/**
 * ============================================================================
 * TENANT QUERY CONTEXT
 * ============================================================================
 *
 * Repository helpers should call this rather than reading a potentially
 * untrusted req.body/query tenant ID.
 * ============================================================================
 */

function getTenantQuery() {
  return {
    tenantId:
      requireTenantId(),
  };
}

/**
 * ============================================================================
 * ADMIN ACTOR SUMMARY
 * ============================================================================
 */

function getActorSummary() {
  const context =
    requireContext();

  return {
    id:
      context.actorId,

    role:
      context.actor.role,

    roles:
      [
        ...context.actor.roles,
      ],

    type:
      context.actor.type,

    tenantId:
      context.tenantId,
  };
}

/**
 * ============================================================================
 * CLEARING / TEMPORARY CONTEXT
 * ============================================================================
 *
 * AsyncLocalStorage contexts end naturally at their execution boundary.
 * There is intentionally no mutable global "clear()" state.
 *
 * For tests, use:
 *
 *   run(null, callback)
 *
 * or create a fresh context.
 * ============================================================================
 */

/**
 * ============================================================================
 * PUBLIC API
 * ============================================================================
 */

const AdminContext = Object.freeze({
  /**
   * Metadata
   */
  name:
    UTILITY_NAME,

  version:
    UTILITY_VERSION,

  appName:
    APP_NAME,

  /**
   * Context creation
   */
  create:
    createContext,

  createContext,

  createSystemContext,

  fromJob,

  child,

  /**
   * Execution
   */
  run,

  runChild,

  bind,

  middleware,

  /**
   * Access
   */
  get:
    getContext,

  getContext,

  snapshot,

  hasContext,

  isContext,

  /**
   * Required context
   */
  requireContext,

  requireTenantId,

  requireActorId,

  requireCorrelationId,

  /**
   * Identity
   */
  getActorSummary,

  getRoles,

  getPermissions,

  hasRole,

  hasAnyRole,

  hasAllRoles,

  hasPermission,

  hasAnyPermission,

  hasAllPermissions,

  /**
   * Tenant
   */
  assertTenant,

  assertActor,

  getTenantQuery,

  /**
   * Request / tracing
   */
  getRequestId,

  getCorrelationId,

  getTraceId,

  getOperation,

  getRequestMetadata,

  getPropagationHeaders,

  /**
   * Audit / logging
   */
  getAuditContext,

  getLogContext,
});

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  AdminContext;

module.exports.AdminContext =
  AdminContext;

module.exports.AdminContextError =
  AdminContextError;

module.exports.createContext =
  createContext;

module.exports.create =
  createContext;

module.exports.createSystemContext =
  createSystemContext;

module.exports.fromJob =
  fromJob;

module.exports.child =
  child;

module.exports.run =
  run;

module.exports.runChild =
  runChild;

module.exports.bind =
  bind;

module.exports.middleware =
  middleware;

module.exports.getContext =
  getContext;

module.exports.get =
  getContext;

module.exports.hasContext =
  hasContext;

module.exports.isContext =
  isContext;

module.exports.snapshot =
  snapshot;

module.exports.requireContext =
  requireContext;

module.exports.requireTenantId =
  requireTenantId;

module.exports.requireActorId =
  requireActorId;

module.exports.requireCorrelationId =
  requireCorrelationId;

module.exports.assertTenant =
  assertTenant;

module.exports.assertActor =
  assertActor;

module.exports.getTenantQuery =
  getTenantQuery;

module.exports.getActorSummary =
  getActorSummary;

module.exports.getRoles =
  getRoles;

module.exports.getPermissions =
  getPermissions;

module.exports.hasRole =
  hasRole;

module.exports.hasAnyRole =
  hasAnyRole;

module.exports.hasAllRoles =
  hasAllRoles;

module.exports.hasPermission =
  hasPermission;

module.exports.hasAnyPermission =
  hasAnyPermission;

module.exports.hasAllPermissions =
  hasAllPermissions;

module.exports.getRequestId =
  getRequestId;

module.exports.getCorrelationId =
  getCorrelationId;

module.exports.getTraceId =
  getTraceId;

module.exports.getOperation =
  getOperation;

module.exports.getRequestMetadata =
  getRequestMetadata;

module.exports.getPropagationHeaders =
  getPropagationHeaders;

module.exports.getAuditContext =
  getAuditContext;

module.exports.getLogContext =
  getLogContext;

module.exports.normalizeContext =
  normalizeContext;

module.exports.redact =
  redact;