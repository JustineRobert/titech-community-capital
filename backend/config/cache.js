'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/cache.js
 *
 * Purpose:
 *   Enterprise production-grade cache configuration and policy module.
 *
 * Responsibilities:
 *   - Define centralized cache configuration.
 *   - Support Redis-backed distributed caching.
 *   - Support local/in-process cache configuration.
 *   - Define cache namespaces and key policy.
 *   - Define TTL and stale-data policy.
 *   - Define connection/retry/health settings.
 *   - Define cache failure behavior.
 *   - Define tenant-aware key isolation.
 *   - Define financial/cache safety controls.
 *   - Provide immutable validated configuration.
 *   - Provide safe operational diagnostics.
 *
 * IMPORTANT:
 *
 *   This file defines CACHE CONFIGURATION AND POLICY ONLY.
 *
 *   It does NOT:
 *     - instantiate Redis clients.
 *     - call Redis.connect().
 *     - perform cache reads/writes.
 *     - implement distributed locking.
 *     - implement idempotency storage.
 *     - persist financial records.
 *     - implement application services.
 *
 * Runtime ownership:
 *
 *   backend/bootstrap/cache.js
 *       or
 *   backend/infrastructure/cache.js
 *
 * should own the actual cache implementation and lifecycle.
 *
 * =============================================================================
 *
 * TITech cache architecture:
 *
 *   process.env
 *       ↓
 *   backend/config/cache.js
 *       ↓
 *   validated immutable cache configuration
 *       ↓
 *   cache infrastructure adapter
 *       ↓
 *   Redis / local cache
 *       ↓
 *   services
 *
 * =============================================================================
 */

const crypto =
  require('node:crypto');

/**
 * -----------------------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------------------
 */

const COMPONENT =
  'cache-config';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

/**
 * -----------------------------------------------------------------------------
 * Cache Providers
 * -----------------------------------------------------------------------------
 */

const CACHE_PROVIDERS =
  Object.freeze({
    REDIS:
      'redis',

    MEMORY:
      'memory',

    DISABLED:
      'disabled',
  });

/**
 * -----------------------------------------------------------------------------
 * Cache Modes
 * -----------------------------------------------------------------------------
 */

const CACHE_MODES =
  Object.freeze({
    DISTRIBUTED:
      'distributed',

    LOCAL:
      'local',

    HYBRID:
      'hybrid',

    DISABLED:
      'disabled',
  });

/**
 * -----------------------------------------------------------------------------
 * Cache States
 * -----------------------------------------------------------------------------
 */

const CACHE_STATES =
  Object.freeze({
    DISABLED:
      'disabled',

    ENABLED:
      'enabled',

    DEGRADED:
      'degraded',
  });

/**
 * -----------------------------------------------------------------------------
 * Failure Policies
 * -----------------------------------------------------------------------------
 *
 * Fail-open is appropriate for non-authoritative derived data.
 *
 * Fail-closed is appropriate when a cache is explicitly being used as part of
 * a security/integrity boundary. Financial source-of-truth data must never be
 * replaced by cache state.
 */

const CACHE_FAILURE_POLICIES =
  Object.freeze({
    FAIL_OPEN:
      'fail_open',

    FAIL_CLOSED:
      'fail_closed',
  });

/**
 * -----------------------------------------------------------------------------
 * Key Policies
 * -----------------------------------------------------------------------------
 */

const CACHE_KEY_POLICIES =
  Object.freeze({
    TENANT_SCOPED:
      'tenant_scoped',

    GLOBAL:
      'global',

    USER_SCOPED:
      'user_scoped',

    SERVICE_SCOPED:
      'service_scoped',
  });

/**
 * -----------------------------------------------------------------------------
 * TTL Defaults
 * -----------------------------------------------------------------------------
 */

const DEFAULT_TTLS =
  Object.freeze({
    defaultSeconds:
      300,

    sessionSeconds:
      1_800,

    authSeconds:
      300,

    userSeconds:
      300,

    tenantSeconds:
      300,

    configurationSeconds:
      600,

    referenceDataSeconds:
      3_600,

    permissionSeconds:
      300,

    rateLimitSeconds:
      60,

    idempotencySeconds:
      86_400,

    lockSeconds:
      30,

    shortLivedSeconds:
      30,

    longLivedSeconds:
      86_400,
  });

/**
 * -----------------------------------------------------------------------------
 * Defaults
 * -----------------------------------------------------------------------------
 */

const DEFAULTS =
  Object.freeze({
    enabled:
      true,

    provider:
      CACHE_PROVIDERS.REDIS,

    mode:
      CACHE_MODES.DISTRIBUTED,

    required:
      false,

    failurePolicy:
      CACHE_FAILURE_POLICIES.FAIL_OPEN,

    financialFailurePolicy:
      CACHE_FAILURE_POLICIES.FAIL_OPEN,

    securityFailurePolicy:
      CACHE_FAILURE_POLICIES.FAIL_CLOSED,

    keyPrefix:
      'titech',

    namespace:
      'app',

    tenantIsolation:
      true,

    includeEnvironment:
      true,

    includeService:
      true,

    includeApplication:
      true,

    hashingEnabled:
      false,

    compressionEnabled:
      false,

    encryptionEnabled:
      false,

    staleWhileRevalidate:
      false,

    allowStale:
      false,

    maxMemoryItems:
      10_000,

    maxMemoryBytes:
      64 * 1024 * 1024,

    connectTimeoutMs:
      10_000,

    commandTimeoutMs:
      5_000,

    healthTimeoutMs:
      5_000,

    shutdownTimeoutMs:
      10_000,

    retryAttempts:
      5,

    retryDelayMs:
      250,

    maxRetryDelayMs:
      5_000,

    reconnectOnError:
      true,

    enableOfflineQueue:
      false,

    enableReadyCheck:
      true,

    lazyConnect:
      true,

    keepAlive:
      5_000,

    maxRetriesPerRequest:
      3,

    enableAutoPipelining:
      true,

    keyMaxLength:
      512,

    valueMaxBytes:
      1 * 1024 * 1024,

    negativeCacheEnabled:
      false,

    negativeCacheSeconds:
      30,

    metricsEnabled:
      true,

    tracingEnabled:
      true,

    loggingEnabled:
      true,

    auditEnabled:
      true,

    cacheFinancialReads:
      true,

    cacheFinancialWrites:
      false,

    cacheLedgerReads:
      false,

    cacheBalances:
      false,

    cacheAccountState:
      false,

    cacheAuthorization:
      true,

    cacheKyc:
      false,

    cacheAml:
      false,

    cachePaymentState:
      false,

    cacheMobileMoneyState:
      false,

    invalidationEnabled:
      true,

    pubSubInvalidationEnabled:
      true,

    versionedKeysEnabled:
      true,

    schemaVersion:
      1,

    defaultSerializer:
      'json',

    staleMarker:
      '__stale__',
  });

/**
 * -----------------------------------------------------------------------------
 * Default namespaces
 * -----------------------------------------------------------------------------
 */

const DEFAULT_NAMESPACES =
  Object.freeze({
    application:
      'app',

    session:
      'session',

    auth:
      'auth',

    user:
      'user',

    tenant:
      'tenant',

    configuration:
      'config',

    reference:
      'reference',

    permissions:
      'permissions',

    rateLimit:
      'rate-limit',

    idempotency:
      'idempotency',

    lock:
      'lock',

    financial:
      'financial',

    ledger:
      'ledger',

    wallet:
      'wallet',

    savings:
      'savings',

    loan:
      'loan',

    contribution:
      'contribution',

    withdrawal:
      'withdrawal',

    payment:
      'payment',

    mobileMoney:
      'mobile-money',

    kyc:
      'kyc',

    aml:
      'aml',
  });

/**
 * -----------------------------------------------------------------------------
 * Sensitive configuration fields
 * -----------------------------------------------------------------------------
 */

const SENSITIVE_KEYS =
  new Set([
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'secret',
    'apiKey',
    'api_key',
    'clientSecret',
    'client_secret',
    'privateKey',
    'private_key',
    'encryptionKey',
    'encryption_key',
    'jwt',
    'jwtSecret',
    'redisPassword',
    'redisUri',
    'redisUrl',
    'connectionString',
    'dsn',
  ]);

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class CacheConfigError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'CacheConfigError';

    this.code =
      options.code ||
      'CACHE_CONFIG_ERROR';

    this.variable =
      options.variable ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    this.cause =
      options.cause ||
      null;

    Error.captureStackTrace?.(
      this,
      CacheConfigError,
    );
  }
}

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

function asBoolean(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (
    typeof value ===
    'boolean'
  ) {
    return value;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      '1',
      'true',
      'yes',
      'on',
      'enabled',
    ].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    [
      '0',
      'false',
      'no',
      'off',
      'disabled',
    ].includes(
      normalized,
    )
  ) {
    return false;
  }

  return fallback;
}

function asPositiveInteger(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(
      parsed,
    ) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function asNonNegativeInteger(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(
      parsed,
    ) ||
    parsed < 0
  ) {
    return fallback;
  }

  return parsed;
}

function asPort(
  value,
  fallback,
) {
  const parsed =
    asPositiveInteger(
      value,
      fallback,
    );

  if (
    parsed < 1 ||
    parsed > 65_535
  ) {
    return fallback;
  }

  return parsed;
}

function asString(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  return normalized ||
    fallback;
}

function asEnum(
  value,
  values,
  fallback,
) {
  const normalized =
    asString(
      value,
      fallback,
    );

  return values.includes(
    normalized,
  )
    ? normalized
    : fallback;
}

function asStringList(
  value,
  fallback = [],
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return [
      ...fallback,
    ];
  }

  const input =
    Array.isArray(value)
      ? value
      : String(
          value,
        ).split(',');

  return [
    ...new Set(
      input
        .map(
          item =>
            String(
              item,
            ).trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeObject(
  value,
) {
  if (
    !value ||
    typeof value !==
      'object' ||
    Array.isArray(value)
  ) {
    return {};
  }

  return {
    ...value,
  };
}

function safeFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined ||
    (
      typeof value !==
        'object' &&
      typeof value !==
        'function'
    )
  ) {
    return value;
  }

  if (
    seen.has(
      value,
    )
  ) {
    return value;
  }

  seen.add(
    value,
  );

  for (
    const key of
      Reflect.ownKeys(
        value,
      )
  ) {
    try {
      safeFreeze(
        value[key],
        seen,
      );
    } catch {
      // Best effort.
    }
  }

  try {
    Object.freeze(
      value,
    );
  } catch {
    // Best effort.
  }

  return value;
}

function env(
  name,
  fallback,
) {
  const value =
    process.env[name];

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return fallback;
  }

  return String(
    value,
  ).trim();
}

function envBoolean(
  name,
  fallback,
) {
  return asBoolean(
    env(
      name,
      undefined,
    ),
    fallback,
  );
}

function envNumber(
  name,
  fallback,
  parser = asPositiveInteger,
) {
  return parser(
    env(
      name,
      undefined,
    ),
    fallback,
  );
}

function normalizePathSegment(
  value,
) {
  return String(
    value ||
      '',
  )
    .trim()
    .replace(
      /^:+/,
      '',
    )
    .replace(
      /:+/g,
      '-',
    )
    .replace(
      /[^a-zA-Z0-9._-]/g,
      '-',
    )
    .replace(
      /-+/g,
      '-',
    )
    .replace(
      /^-|-$/g,
      '',
    );
}

function normalizePrefix(
  value,
  fallback,
) {
  const normalized =
    normalizePathSegment(
      value,
    );

  return normalized ||
    fallback;
}

function getEnvironmentName() {
  return asString(
    env(
      'NODE_ENV',
    ),
    'development',
  );
}

function getServiceName() {
  return asString(
    env(
      'SERVICE_NAME',
    ),
    SERVICE_NAME,
  );
}

function getApplicationName() {
  return asString(
    env(
      'APP_NAME',
    ),
    APPLICATION_NAME,
  );
}

function hashText(
  value,
) {
  return crypto
    .createHash(
      'sha256',
    )
    .update(
      String(
        value,
      ),
      'utf8',
    )
    .digest(
      'hex',
    );
}

/**
 * =============================================================================
 * Key Policy
 * =============================================================================
 */

function buildKeyPrefix(
  config,
) {
  const parts = [
    config.keyPrefix,
  ];

  if (
    config.includeEnvironment
  ) {
    parts.push(
      config.environment,
    );
  }

  if (
    config.includeApplication
  ) {
    parts.push(
      config.applicationName,
    );
  }

  if (
    config.includeService
  ) {
    parts.push(
      config.serviceName,
    );
  }

  parts.push(
    config.namespace,
  );

  if (
    config.versionedKeysEnabled
  ) {
    parts.push(
      `v${config.schemaVersion}`,
    );
  }

  return parts
    .map(
      normalizePathSegment,
    )
    .filter(Boolean)
    .join(':');
}

function buildNamespaceKey(
  namespace,
  key,
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  const normalizedNamespace =
    normalizePathSegment(
      namespace ||
        DEFAULT_NAMESPACES
          .application,
    );

  const normalizedKey =
    normalizePathSegment(
      key,
    );

  if (
    !normalizedKey
  ) {
    throw new CacheConfigError(
      'TITech cache key cannot be empty.',
      {
        code:
          'CACHE_KEY_EMPTY',
      },
    );
  }

  const parts = [
    config.keyPrefix,
  ];

  if (
    config.includeEnvironment
  ) {
    parts.push(
      config.environment,
    );
  }

  if (
    config.includeApplication
  ) {
    parts.push(
      config.applicationName,
    );
  }

  if (
    config.includeService
  ) {
    parts.push(
      config.serviceName,
    );
  }

  parts.push(
    normalizedNamespace,
  );

  if (
    options.tenantId &&
    config.tenantIsolation
  ) {
    parts.push(
      'tenant',
      normalizePathSegment(
        options.tenantId,
      ),
    );
  }

  if (
    options.userId
  ) {
    parts.push(
      'user',
      normalizePathSegment(
        options.userId,
      ),
    );
  }

  if (
    config.versionedKeysEnabled
  ) {
    parts.push(
      `v${config.schemaVersion}`,
    );
  }

  parts.push(
    normalizedKey,
  );

  let result =
    parts
      .filter(Boolean)
      .join(':');

  if (
    config.hashingEnabled &&
    result.length >
      config.keyMaxLength
  ) {
    result =
      `${buildKeyPrefix(
        config,
      )}:${hashText(
        result,
      )}`;
  }

  if (
    result.length >
    config.keyMaxLength
  ) {
    throw new CacheConfigError(
      `TITech cache key exceeds the configured maximum length of ${config.keyMaxLength}.`,
      {
        code:
          'CACHE_KEY_TOO_LONG',

        details: {
          maximum:
            config.keyMaxLength,

          actual:
            result.length,
        },
      },
    );
  }

  return result;
}

function buildTenantKey(
  namespace,
  tenantId,
  key,
  options = {},
) {
  if (
    !tenantId
  ) {
    throw new CacheConfigError(
      'TITech tenant-scoped cache keys require a tenantId.',
      {
        code:
          'CACHE_TENANT_ID_REQUIRED',
      },
    );
  }

  return buildNamespaceKey(
    namespace,
    key,
    {
      ...options,

      tenantId,
    },
  );
}

function buildUserKey(
  namespace,
  userId,
  key,
  options = {},
) {
  if (
    !userId
  ) {
    throw new CacheConfigError(
      'TITech user-scoped cache keys require a userId.',
      {
        code:
          'CACHE_USER_ID_REQUIRED',
      },
    );
  }

  return buildNamespaceKey(
    namespace,
    key,
    {
      ...options,

      userId,
    },
  );
}

/**
 * =============================================================================
 * TTL Policy
 * =============================================================================
 */

function resolveTtl(
  policy,
  override,
) {
  if (
    override !==
      undefined &&
    override !==
      null
  ) {
    const ttl =
      asPositiveInteger(
        override,
        DEFAULT_TTLS.defaultSeconds,
      );

    return ttl;
  }

  if (
    typeof policy ===
      'number'
  ) {
    return asPositiveInteger(
      policy,
      DEFAULT_TTLS.defaultSeconds,
    );
  }

  const config =
    defaultConfig;

  const normalized =
    normalizePathSegment(
      policy,
    );

  return (
    config.ttl[
      normalized
    ] ||
    config.ttl.defaultSeconds
  );
}

function getTtlPolicy(
  config = defaultConfig,
) {
  return safeFreeze({
    ...config.ttl,
  });
}

/**
 * =============================================================================
 * Cache Safety Policy
 * =============================================================================
 */

function isFinancialCacheAllowed(
  namespace,
  operation = 'read',
  config = defaultConfig,
) {
  const normalized =
    normalizePathSegment(
      namespace,
    );

  const read =
    String(
      operation,
    ).toLowerCase() ===
    'read';

  if (
    !read
  ) {
    return (
      config.cacheFinancialWrites ===
      true
    );
  }

  if (
    normalized ===
    DEFAULT_NAMESPACES
      .ledger
  ) {
    return (
      config.cacheLedgerReads ===
      true
    );
  }

  if (
    normalized ===
    DEFAULT_NAMESPACES
      .wallet
  ) {
    return (
      config.cacheBalances ===
      true
    );
  }

  if (
    normalized ===
    DEFAULT_NAMESPACES
      .financial
  ) {
    return (
      config.cacheFinancialReads ===
      true
    );
  }

  if (
    normalized ===
    DEFAULT_NAMESPACES
      .payment
  ) {
    return (
      config.cachePaymentState ===
      true
    );
  }

  if (
    normalized ===
    DEFAULT_NAMESPACES
      .mobileMoney
  ) {
    return (
      config.cacheMobileMoneyState ===
      true
    );
  }

  return true;
}

function shouldCacheNamespace(
  namespace,
  operation = 'read',
  config = defaultConfig,
) {
  const normalized =
    normalizePathSegment(
      namespace,
    );

  if (
    normalized ===
      DEFAULT_NAMESPACES
        .ledger &&
    !config.cacheLedgerReads
  ) {
    return false;
  }

  if (
    normalized ===
      DEFAULT_NAMESPACES
        .wallet &&
    !config.cacheBalances
  ) {
    return false;
  }

  if (
    normalized ===
      DEFAULT_NAMESPACES
        .payment &&
    !config.cachePaymentState
  ) {
    return false;
  }

  if (
    normalized ===
      DEFAULT_NAMESPACES
        .mobileMoney &&
    !config.cacheMobileMoneyState
  ) {
    return false;
  }

  if (
    normalized ===
      DEFAULT_NAMESPACES
        .kyc &&
    !config.cacheKyc
  ) {
    return false;
  }

  if (
    normalized ===
      DEFAULT_NAMESPACES
        .aml &&
    !config.cacheAml
  ) {
    return false;
  }

  return isFinancialCacheAllowed(
    normalized,
    operation,
    config,
  );
}

function resolveFailurePolicy(
  namespace,
  config = defaultConfig,
) {
  const normalized =
    normalizePathSegment(
      namespace,
    );

  if (
    [
      DEFAULT_NAMESPACES
        .financial,
      DEFAULT_NAMESPACES
        .ledger,
      DEFAULT_NAMESPACES
        .payment,
      DEFAULT_NAMESPACES
        .mobileMoney,
    ].includes(
      normalized,
    )
  ) {
    return config
      .financialFailurePolicy;
  }

  if (
    [
      DEFAULT_NAMESPACES
        .auth,
      DEFAULT_NAMESPACES
        .permissions,
    ].includes(
      normalized,
    )
  ) {
    return config
      .securityFailurePolicy;
  }

  return config.failurePolicy;
}

/**
 * =============================================================================
 * Configuration Builder
 * =============================================================================
 */

function createCacheConfig(
  input = {},
) {
  const source =
    input.cache ||
    input;

  const environment =
    asString(
      source.environment ??
        env(
          'NODE_ENV',
        ),
      getEnvironmentName(),
    );

  const serviceName =
    asString(
      source.serviceName ??
        env(
          'SERVICE_NAME',
        ),
      getServiceName(),
    );

  const applicationName =
    asString(
      source.applicationName ??
        env(
          'APP_NAME',
        ),
      getApplicationName(),
    );

  const enabled =
    source.enabled ??
    envBoolean(
      'CACHE_ENABLED',
      DEFAULTS.enabled,
    );

  const provider =
    asEnum(
      source.provider ??
        env(
          'CACHE_PROVIDER',
        ),
      Object.values(
        CACHE_PROVIDERS,
      ),
      DEFAULTS.provider,
    );

  const mode =
    asEnum(
      source.mode ??
        env(
          'CACHE_MODE',
        ),
      Object.values(
        CACHE_MODES,
      ),
      DEFAULTS.mode,
    );

  const state =
    !enabled ||
    provider ===
      CACHE_PROVIDERS.DISABLED
      ? CACHE_STATES.DISABLED
      : CACHE_STATES.ENABLED;

  const config = {
    /**
     * -------------------------------------------------------------------------
     * Identity
     * -------------------------------------------------------------------------
     */

    component:
      COMPONENT,

    serviceName,

    applicationName,

    environment,

    /**
     * -------------------------------------------------------------------------
     * Core
     * -------------------------------------------------------------------------
     */

    enabled,

    provider:
      enabled
        ? provider
        : CACHE_PROVIDERS
            .DISABLED,

    mode:
      enabled
        ? mode
        : CACHE_MODES
            .DISABLED,

    state,

    required:
      source.required ??
      envBoolean(
        'CACHE_REQUIRED',
        DEFAULTS.required,
      ),

    failurePolicy:
      asEnum(
        source.failurePolicy ??
          env(
            'CACHE_FAILURE_POLICY',
          ),
        Object.values(
          CACHE_FAILURE_POLICIES,
        ),
        DEFAULTS.failurePolicy,
      ),

    financialFailurePolicy:
      asEnum(
        source.financialFailurePolicy ??
          env(
            'CACHE_FINANCIAL_FAILURE_POLICY',
          ),
        Object.values(
          CACHE_FAILURE_POLICIES,
        ),
        DEFAULTS.financialFailurePolicy,
      ),

    securityFailurePolicy:
      asEnum(
        source.securityFailurePolicy ??
          env(
            'CACHE_SECURITY_FAILURE_POLICY',
          ),
        Object.values(
          CACHE_FAILURE_POLICIES,
        ),
        DEFAULTS.securityFailurePolicy,
      ),

    /**
     * -------------------------------------------------------------------------
     * Namespace / key strategy
     * -------------------------------------------------------------------------
     */

    keyPrefix:
      normalizePrefix(
        source.keyPrefix ??
          env(
            'CACHE_KEY_PREFIX',
          ),
        DEFAULTS.keyPrefix,
      ),

    namespace:
      normalizePrefix(
        source.namespace ??
          env(
            'CACHE_NAMESPACE',
          ),
        DEFAULTS.namespace,
      ),

    tenantIsolation:
      source.tenantIsolation ??
      envBoolean(
        'CACHE_TENANT_ISOLATION',
        DEFAULTS.tenantIsolation,
      ),

    includeEnvironment:
      source.includeEnvironment ??
      envBoolean(
        'CACHE_INCLUDE_ENVIRONMENT',
        DEFAULTS.includeEnvironment,
      ),

    includeService:
      source.includeService ??
      envBoolean(
        'CACHE_INCLUDE_SERVICE',
        DEFAULTS.includeService,
      ),

    includeApplication:
      source.includeApplication ??
      envBoolean(
        'CACHE_INCLUDE_APPLICATION',
        DEFAULTS.includeApplication,
      ),

    hashingEnabled:
      source.hashingEnabled ??
      envBoolean(
        'CACHE_HASHING_ENABLED',
        DEFAULTS.hashingEnabled,
      ),

    keyMaxLength:
      asPositiveInteger(
        source.keyMaxLength ??
          env(
            'CACHE_KEY_MAX_LENGTH',
          ),
        DEFAULTS.keyMaxLength,
      ),

    versionedKeysEnabled:
      source.versionedKeysEnabled ??
      envBoolean(
        'CACHE_VERSIONED_KEYS_ENABLED',
        DEFAULTS.versionedKeysEnabled,
      ),

    schemaVersion:
      asPositiveInteger(
        source.schemaVersion ??
          env(
            'CACHE_SCHEMA_VERSION',
          ),
        DEFAULTS.schemaVersion,
      ),

    /**
     * -------------------------------------------------------------------------
     * TTL
     * -------------------------------------------------------------------------
     */

    ttl: {
      defaultSeconds:
        asPositiveInteger(
          source.ttl?.defaultSeconds ??
            env(
              'CACHE_DEFAULT_TTL_SECONDS',
            ),
          DEFAULT_TTLS.defaultSeconds,
        ),

      sessionSeconds:
        asPositiveInteger(
          source.ttl?.sessionSeconds ??
            env(
              'CACHE_SESSION_TTL_SECONDS',
            ),
          DEFAULT_TTLS.sessionSeconds,
        ),

      authSeconds:
        asPositiveInteger(
          source.ttl?.authSeconds ??
            env(
              'CACHE_AUTH_TTL_SECONDS',
            ),
          DEFAULT_TTLS.authSeconds,
        ),

      userSeconds:
        asPositiveInteger(
          source.ttl?.userSeconds ??
            env(
              'CACHE_USER_TTL_SECONDS',
            ),
          DEFAULT_TTLS.userSeconds,
        ),

      tenantSeconds:
        asPositiveInteger(
          source.ttl?.tenantSeconds ??
            env(
              'CACHE_TENANT_TTL_SECONDS',
            ),
          DEFAULT_TTLS.tenantSeconds,
        ),

      configurationSeconds:
        asPositiveInteger(
          source.ttl?.configurationSeconds ??
            env(
              'CACHE_CONFIGURATION_TTL_SECONDS',
            ),
          DEFAULT_TTLS.configurationSeconds,
        ),

      referenceDataSeconds:
        asPositiveInteger(
          source.ttl?.referenceDataSeconds ??
            env(
              'CACHE_REFERENCE_DATA_TTL_SECONDS',
            ),
          DEFAULT_TTLS.referenceDataSeconds,
        ),

      permissionSeconds:
        asPositiveInteger(
          source.ttl?.permissionSeconds ??
            env(
              'CACHE_PERMISSION_TTL_SECONDS',
            ),
          DEFAULT_TTLS.permissionSeconds,
        ),

      rateLimitSeconds:
        asPositiveInteger(
          source.ttl?.rateLimitSeconds ??
            env(
              'CACHE_RATE_LIMIT_TTL_SECONDS',
            ),
          DEFAULT_TTLS.rateLimitSeconds,
        ),

      idempotencySeconds:
        asPositiveInteger(
          source.ttl?.idempotencySeconds ??
            env(
              'CACHE_IDEMPOTENCY_TTL_SECONDS',
            ),
          DEFAULT_TTLS.idempotencySeconds,
        ),

      lockSeconds:
        asPositiveInteger(
          source.ttl?.lockSeconds ??
            env(
              'CACHE_LOCK_TTL_SECONDS',
            ),
          DEFAULT_TTLS.lockSeconds,
        ),

      shortLivedSeconds:
        asPositiveInteger(
          source.ttl?.shortLivedSeconds ??
            env(
              'CACHE_SHORT_LIVED_TTL_SECONDS',
            ),
          DEFAULT_TTLS.shortLivedSeconds,
        ),

      longLivedSeconds:
        asPositiveInteger(
          source.ttl?.longLivedSeconds ??
            env(
              'CACHE_LONG_LIVED_TTL_SECONDS',
            ),
          DEFAULT_TTLS.longLivedSeconds,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Stale-data behavior
     * -------------------------------------------------------------------------
     */

    staleWhileRevalidate:
      source.staleWhileRevalidate ??
      envBoolean(
        'CACHE_STALE_WHILE_REVALIDATE',
        DEFAULTS.staleWhileRevalidate,
      ),

    allowStale:
      source.allowStale ??
      envBoolean(
        'CACHE_ALLOW_STALE',
        DEFAULTS.allowStale,
      ),

    staleMarker:
      asString(
        source.staleMarker ??
          env(
            'CACHE_STALE_MARKER',
          ),
        DEFAULTS.staleMarker,
      ),

    negativeCacheEnabled:
      source.negativeCacheEnabled ??
      envBoolean(
        'CACHE_NEGATIVE_ENABLED',
        DEFAULTS.negativeCacheEnabled,
      ),

    negativeCacheSeconds:
      asPositiveInteger(
        source.negativeCacheSeconds ??
          env(
            'CACHE_NEGATIVE_TTL_SECONDS',
          ),
        DEFAULTS.negativeCacheSeconds,
      ),

    /**
     * -------------------------------------------------------------------------
     * Redis connection
     * -------------------------------------------------------------------------
     */

    redis: {
      url:
        asString(
          source.redis?.url ??
            env(
              'REDIS_URL',
              env(
                'REDIS_URI',
              ),
            ),
          undefined,
        ),

      host:
        asString(
          source.redis?.host ??
            env(
              'REDIS_HOST',
            ),
          '127.0.0.1',
        ),

      port:
        asPort(
          source.redis?.port ??
            env(
              'REDIS_PORT',
            ),
          6379,
        ),

      username:
        asString(
          source.redis?.username ??
            env(
              'REDIS_USERNAME',
            ),
          undefined,
        ),

      password:
        asString(
          source.redis?.password ??
            env(
              'REDIS_PASSWORD',
            ),
          undefined,
        ),

      database:
        asNonNegativeInteger(
          source.redis?.database ??
            env(
              'REDIS_DB',
            ),
          0,
        ),

      connectTimeoutMs:
        asPositiveInteger(
          source.redis?.connectTimeoutMs ??
            env(
              'REDIS_CONNECT_TIMEOUT_MS',
            ),
          DEFAULTS.connectTimeoutMs,
        ),

      commandTimeoutMs:
        asPositiveInteger(
          source.redis?.commandTimeoutMs ??
            env(
              'REDIS_COMMAND_TIMEOUT_MS',
            ),
          DEFAULTS.commandTimeoutMs,
        ),

      healthTimeoutMs:
        asPositiveInteger(
          source.redis?.healthTimeoutMs ??
            env(
              'REDIS_HEALTH_TIMEOUT_MS',
            ),
          DEFAULTS.healthTimeoutMs,
        ),

      shutdownTimeoutMs:
        asPositiveInteger(
          source.redis?.shutdownTimeoutMs ??
            env(
              'REDIS_SHUTDOWN_TIMEOUT_MS',
            ),
          DEFAULTS.shutdownTimeoutMs,
        ),

      retryAttempts:
        asNonNegativeInteger(
          source.redis?.retryAttempts ??
            env(
              'REDIS_RETRY_ATTEMPTS',
            ),
          DEFAULTS.retryAttempts,
        ),

      retryDelayMs:
        asPositiveInteger(
          source.redis?.retryDelayMs ??
            env(
              'REDIS_RETRY_DELAY_MS',
            ),
          DEFAULTS.retryDelayMs,
        ),

      maxRetryDelayMs:
        asPositiveInteger(
          source.redis?.maxRetryDelayMs ??
            env(
              'REDIS_MAX_RETRY_DELAY_MS',
            ),
          DEFAULTS.maxRetryDelayMs,
        ),

      reconnectOnError:
        source.redis?.reconnectOnError ??
        envBoolean(
          'REDIS_RECONNECT_ON_ERROR',
          DEFAULTS.reconnectOnError,
        ),

      enableOfflineQueue:
        source.redis?.enableOfflineQueue ??
        envBoolean(
          'REDIS_ENABLE_OFFLINE_QUEUE',
          DEFAULTS.enableOfflineQueue,
        ),

      enableReadyCheck:
        source.redis?.enableReadyCheck ??
        envBoolean(
          'REDIS_ENABLE_READY_CHECK',
          DEFAULTS.enableReadyCheck,
        ),

      lazyConnect:
        source.redis?.lazyConnect ??
        envBoolean(
          'REDIS_LAZY_CONNECT',
          DEFAULTS.lazyConnect,
        ),

      keepAlive:
        asPositiveInteger(
          source.redis?.keepAlive ??
            env(
              'REDIS_KEEP_ALIVE_MS',
            ),
          DEFAULTS.keepAlive,
        ),

      maxRetriesPerRequest:
        asPositiveInteger(
          source.redis?.maxRetriesPerRequest ??
            env(
              'REDIS_MAX_RETRIES_PER_REQUEST',
            ),
          DEFAULTS.maxRetriesPerRequest,
        ),

      enableAutoPipelining:
        source.redis?.enableAutoPipelining ??
        envBoolean(
          'REDIS_AUTO_PIPELINING',
          DEFAULTS.enableAutoPipelining,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Memory cache
     * -------------------------------------------------------------------------
     */

    memory: {
      maxItems:
        asPositiveInteger(
          source.memory?.maxItems ??
            env(
              'CACHE_MEMORY_MAX_ITEMS',
            ),
          DEFAULTS.maxMemoryItems,
        ),

      maxBytes:
        asPositiveInteger(
          source.memory?.maxBytes ??
            env(
              'CACHE_MEMORY_MAX_BYTES',
            ),
          DEFAULTS.maxMemoryBytes,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Serialization
     * -------------------------------------------------------------------------
     */

    serializer: {
      type:
        asString(
          source.serializer?.type ??
            env(
              'CACHE_SERIALIZER',
            ),
          DEFAULTS.defaultSerializer,
        ),

      compressionEnabled:
        source.compressionEnabled ??
        envBoolean(
          'CACHE_COMPRESSION_ENABLED',
          DEFAULTS.compressionEnabled,
        ),

      encryptionEnabled:
        source.encryptionEnabled ??
        envBoolean(
          'CACHE_ENCRYPTION_ENABLED',
          DEFAULTS.encryptionEnabled,
        ),

      valueMaxBytes:
        asPositiveInteger(
          source.valueMaxBytes ??
            env(
              'CACHE_VALUE_MAX_BYTES',
            ),
          DEFAULTS.valueMaxBytes,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Invalidation
     * -------------------------------------------------------------------------
     */

    invalidation: {
      enabled:
        source.invalidation?.enabled ??
        envBoolean(
          'CACHE_INVALIDATION_ENABLED',
          DEFAULTS.invalidationEnabled,
        ),

      pubSubEnabled:
        source.invalidation?.pubSubEnabled ??
        envBoolean(
          'CACHE_PUBSUB_INVALIDATION_ENABLED',
          DEFAULTS.pubSubInvalidationEnabled,
        ),

      channel:
        asString(
          source.invalidation?.channel ??
            env(
              'CACHE_INVALIDATION_CHANNEL',
            ),
          'titech:cache:invalidate',
        ),

      namespaceVersioning:
        source.invalidation?.namespaceVersioning ??
        envBoolean(
          'CACHE_NAMESPACE_VERSIONING',
          DEFAULTS.versionedKeysEnabled,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Feature policy
     * -------------------------------------------------------------------------
     */

    features: {
      metricsEnabled:
        source.metricsEnabled ??
        envBoolean(
          'CACHE_METRICS_ENABLED',
          DEFAULTS.metricsEnabled,
        ),

      tracingEnabled:
        source.tracingEnabled ??
        envBoolean(
          'CACHE_TRACING_ENABLED',
          DEFAULTS.tracingEnabled,
        ),

      loggingEnabled:
        source.loggingEnabled ??
        envBoolean(
          'CACHE_LOGGING_ENABLED',
          DEFAULTS.loggingEnabled,
        ),

      auditEnabled:
        source.auditEnabled ??
        envBoolean(
          'CACHE_AUDIT_ENABLED',
          DEFAULTS.auditEnabled,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Business/financial cache policy
     * -------------------------------------------------------------------------
     */

    financial: {
      cacheReads:
        source.cacheFinancialReads ??
        envBoolean(
          'CACHE_FINANCIAL_READS',
          DEFAULTS.cacheFinancialReads,
        ),

      cacheWrites:
        source.cacheFinancialWrites ??
        envBoolean(
          'CACHE_FINANCIAL_WRITES',
          DEFAULTS.cacheFinancialWrites,
        ),

      cacheLedgerReads:
        source.cacheLedgerReads ??
        envBoolean(
          'CACHE_LEDGER_READS',
          DEFAULTS.cacheLedgerReads,
        ),

      cacheBalances:
        source.cacheBalances ??
        envBoolean(
          'CACHE_BALANCES',
          DEFAULTS.cacheBalances,
        ),

      cacheAccountState:
        source.cacheAccountState ??
        envBoolean(
          'CACHE_ACCOUNT_STATE',
          DEFAULTS.cacheAccountState,
        ),

      cachePaymentState:
        source.cachePaymentState ??
        envBoolean(
          'CACHE_PAYMENT_STATE',
          DEFAULTS.cachePaymentState,
        ),

      cacheMobileMoneyState:
        source.cacheMobileMoneyState ??
        envBoolean(
          'CACHE_MOBILE_MONEY_STATE',
          DEFAULTS.cacheMobileMoneyState,
        ),

      idempotencyTtlSeconds:
        asPositiveInteger(
          source.idempotencyTtlSeconds ??
            env(
              'CACHE_IDEMPOTENCY_TTL_SECONDS',
            ),
          DEFAULT_TTLS.idempotencySeconds,
        ),

      lockTtlSeconds:
        asPositiveInteger(
          source.lockTtlSeconds ??
            env(
              'CACHE_LOCK_TTL_SECONDS',
            ),
          DEFAULT_TTLS.lockSeconds,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Authorization / security cache policy
     * -------------------------------------------------------------------------
     */

    security: {
      cacheAuthorization:
        source.cacheAuthorization ??
        envBoolean(
          'CACHE_AUTHORIZATION',
          DEFAULTS.cacheAuthorization,
        ),

      cacheKyc:
        source.cacheKyc ??
        envBoolean(
          'CACHE_KYC',
          DEFAULTS.cacheKyc,
        ),

      cacheAml:
        source.cacheAml ??
        envBoolean(
          'CACHE_AML',
          DEFAULTS.cacheAml,
        ),

      failurePolicy:
        asEnum(
          source.securityFailurePolicy ??
            env(
              'CACHE_SECURITY_FAILURE_POLICY',
            ),
          Object.values(
            CACHE_FAILURE_POLICIES,
          ),
          DEFAULTS.securityFailurePolicy,
        ),
    },

    /**
     * -------------------------------------------------------------------------
     * Namespace catalog
     * -------------------------------------------------------------------------
     */

    namespaces: {
      ...DEFAULT_NAMESPACES,

      ...(normalizeObject(
        source.namespaces,
      ) || {}),
    },

    /**
     * -------------------------------------------------------------------------
     * Custom metadata
     * -------------------------------------------------------------------------
     */

    metadata:
      normalizeObject(
        source.metadata,
      ),
  };

  config.keyBase =
    buildKeyPrefix(
      config,
    );

  return validateCacheConfig(
    config,
  );
}

/**
 * =============================================================================
 * Validation
 * =============================================================================
 */

function validateCacheConfig(
  config,
) {
  if (
    !config ||
    typeof config !==
      'object'
  ) {
    throw new CacheConfigError(
      'TITech cache configuration must be an object.',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Provider/mode consistency
   * ---------------------------------------------------------------------------
   */

  if (
    config.provider ===
      CACHE_PROVIDERS.DISABLED &&
    config.enabled
  ) {
    throw new CacheConfigError(
      'TITech cache cannot be enabled with the disabled provider.',
      {
        code:
          'CACHE_PROVIDER_CONFIGURATION_INVALID',
      },
    );
  }

  if (
    config.mode ===
      CACHE_MODES.DISABLED &&
    config.enabled
  ) {
    throw new CacheConfigError(
      'TITech cache cannot be enabled with disabled cache mode.',
      {
        code:
          'CACHE_MODE_CONFIGURATION_INVALID',
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Redis requirements
   * ---------------------------------------------------------------------------
   */

  if (
    config.enabled &&
    [
      CACHE_PROVIDERS.REDIS,
    ].includes(
      config.provider,
    ) &&
    config.required &&
    !config.redis.url &&
    !config.redis.host
  ) {
    throw new CacheConfigError(
      'TITech distributed cache is required but no Redis endpoint is configured.',
      {
        code:
          'CACHE_REDIS_CONFIGURATION_MISSING',
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Queue/cache behavior
   * ---------------------------------------------------------------------------
   */

  if (
    config.batchEnabled &&
    config.maxQueueSize <
      config.batchSize
  ) {
    throw new CacheConfigError(
      'TITech cache maximum queue size must be greater than or equal to batch size.',
      {
        code:
          'CACHE_QUEUE_SIZE_INVALID',
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * TTL validation
   * ---------------------------------------------------------------------------
   */

  for (
    const [
      name,
      ttl,
    ] of Object.entries(
      config.ttl,
    )
  ) {
    if (
      !Number.isInteger(
        ttl,
      ) ||
      ttl <= 0
    ) {
      throw new CacheConfigError(
        `TITech cache TTL "${name}" must be a positive integer.`,
        {
          code:
            'CACHE_TTL_INVALID',

          details: {
            name,
            value:
              ttl,
          },
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Financial write safety
   * ---------------------------------------------------------------------------
   *
   * Financial writes should remain disabled by default because the authoritative
   * state belongs to the transactional database/ledger boundary.
   */

  if (
    config.financial.cacheWrites &&
    config.financial.cacheLedgerReads ===
      false
  ) {
    throw new CacheConfigError(
      'TITech financial cache writes cannot be enabled while ledger cache reads remain disabled.',
      {
        code:
          'CACHE_FINANCIAL_POLICY_INVALID',
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Key policy
   * ---------------------------------------------------------------------------
   */

  if (
    config.tenantIsolation &&
    !config.includeApplication &&
    !config.includeService
  ) {
    /**
     * Tenant isolation remains possible, but application/service namespaces are
     * strongly recommended.
     */
  }

  if (
    config.keyMaxLength <
    64
  ) {
    throw new CacheConfigError(
      'TITech cache key maximum length is too small for safe namespacing.',
      {
        code:
          'CACHE_KEY_MAX_LENGTH_INVALID',
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Security cache defaults
   * ---------------------------------------------------------------------------
   */

  if (
    config.security.cacheAuthorization &&
    config.security.failurePolicy ===
      CACHE_FAILURE_POLICIES.FAIL_OPEN
  ) {
    /**
     * Fail-open authorization caching is dangerous and therefore rejected.
     */
    throw new CacheConfigError(
      'TITech authorization cache cannot use fail-open failure policy.',
      {
        code:
          'CACHE_AUTHORIZATION_FAILURE_POLICY_INVALID',
      },
    );
  }

  return safeFreeze(
    config,
  );
}

/**
 * =============================================================================
 * Safe Snapshot
 * =============================================================================
 */

function getSnapshot(
  configuration = defaultConfig,
) {
  return safeFreeze({
    component:
      COMPONENT,

    serviceName:
      configuration.serviceName,

    applicationName:
      configuration.applicationName,

    environment:
      configuration.environment,

    enabled:
      configuration.enabled,

    provider:
      configuration.provider,

    mode:
      configuration.mode,

    state:
      configuration.state,

    required:
      configuration.required,

    failurePolicy:
      configuration.failurePolicy,

    financialFailurePolicy:
      configuration.financialFailurePolicy,

    securityFailurePolicy:
      configuration.securityFailurePolicy,

    keyPrefix:
      configuration.keyPrefix,

    keyBase:
      configuration.keyBase,

    namespace:
      configuration.namespace,

    tenantIsolation:
      configuration.tenantIsolation,

    keyMaxLength:
      configuration.keyMaxLength,

    versionedKeysEnabled:
      configuration.versionedKeysEnabled,

    schemaVersion:
      configuration.schemaVersion,

    ttl:
      {
        ...configuration.ttl,
      },

    staleWhileRevalidate:
      configuration.staleWhileRevalidate,

    allowStale:
      configuration.allowStale,

    negativeCacheEnabled:
      configuration.negativeCacheEnabled,

    redis: {
      urlConfigured:
        Boolean(
          configuration.redis.url,
        ),

      host:
        configuration.redis.host,

      port:
        configuration.redis.port,

      database:
        configuration.redis.database,

      connectTimeoutMs:
        configuration.redis.connectTimeoutMs,

      commandTimeoutMs:
        configuration.redis.commandTimeoutMs,

      retryAttempts:
        configuration.redis.retryAttempts,

      lazyConnect:
        configuration.redis.lazyConnect,

      offlineQueue:
        configuration.redis.enableOfflineQueue,
    },

    memory: {
      maxItems:
        configuration.memory.maxItems,

      maxBytes:
        configuration.memory.maxBytes,
    },

    serializer: {
      type:
        configuration.serializer.type,

      compressionEnabled:
        configuration.serializer
          .compressionEnabled,

      encryptionEnabled:
        configuration.serializer
          .encryptionEnabled,

      valueMaxBytes:
        configuration.serializer
          .valueMaxBytes,
    },

    invalidation: {
      enabled:
        configuration.invalidation
          .enabled,

      pubSubEnabled:
        configuration.invalidation
          .pubSubEnabled,

      channel:
        configuration.invalidation
          .channel,
    },

    financial: {
      cacheReads:
        configuration.financial
          .cacheReads,

      cacheWrites:
        configuration.financial
          .cacheWrites,

      cacheLedgerReads:
        configuration.financial
          .cacheLedgerReads,

      cacheBalances:
        configuration.financial
          .cacheBalances,

      cacheAccountState:
        configuration.financial
          .cacheAccountState,

      cachePaymentState:
        configuration.financial
          .cachePaymentState,

      cacheMobileMoneyState:
        configuration.financial
          .cacheMobileMoneyState,

      idempotencyTtlSeconds:
        configuration.financial
          .idempotencyTtlSeconds,

      lockTtlSeconds:
        configuration.financial
          .lockTtlSeconds,
    },

    security: {
      cacheAuthorization:
        configuration.security
          .cacheAuthorization,

      cacheKyc:
        configuration.security
          .cacheKyc,

      cacheAml:
        configuration.security
          .cacheAml,

      failurePolicy:
        configuration.security
          .failurePolicy,
    },

    namespaces:
      {
        ...configuration.namespaces,
      },

    timestamp:
      new Date().toISOString(),
  });
}

/**
 * =============================================================================
 * Default Configuration
 * =============================================================================
 */

const defaultConfig =
  createCacheConfig();

/**
 * =============================================================================
 * Public Configuration API
 * =============================================================================
 */

function getConfig(
  override = {},
) {
  if (
    !override ||
    Object.keys(
      override,
    ).length ===
      0
  ) {
    return defaultConfig;
  }

  return createCacheConfig({
    ...defaultConfig,
    ...override,
  });
}

function isEnabled(
  config = defaultConfig,
) {
  return (
    config.enabled ===
    true &&
    config.provider !==
      CACHE_PROVIDERS.DISABLED
  );
}

function isDistributed(
  config = defaultConfig,
) {
  return (
    isEnabled(
      config,
    ) &&
    (
      config.provider ===
        CACHE_PROVIDERS
          .REDIS ||
      config.mode ===
        CACHE_MODES.DISTRIBUTED
    )
  );
}

function isLocal(
  config = defaultConfig,
) {
  return (
    isEnabled(
      config,
    ) &&
    (
      config.provider ===
        CACHE_PROVIDERS
          .MEMORY ||
      config.mode ===
        CACHE_MODES.LOCAL
    )
  );
}

function isRequired(
  config = defaultConfig,
) {
  return (
    config.required ===
    true
  );
}

/**
 * =============================================================================
 * Cache Key API
 * =============================================================================
 */

function createKey(
  namespace,
  key,
  options = {},
) {
  return buildNamespaceKey(
    namespace,
    key,
    {
      ...options,
      config:
        options.config ||
        defaultConfig,
    },
  );
}

function createTenantKey(
  namespace,
  tenantId,
  key,
  options = {},
) {
  return buildTenantKey(
    namespace,
    tenantId,
    key,
    {
      ...options,
      config:
        options.config ||
        defaultConfig,
    },
  );
}

function createUserKey(
  namespace,
  userId,
  key,
  options = {},
) {
  return buildUserKey(
    namespace,
    userId,
    key,
    {
      ...options,
      config:
        options.config ||
        defaultConfig,
    },
  );
}

function createFinancialKey(
  namespace,
  tenantId,
  key,
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  if (
    !isFinancialCacheAllowed(
      namespace,
      options.operation ||
        'read',
      config,
    )
  ) {
    throw new CacheConfigError(
      `TITech cache policy does not permit caching "${namespace}" operations.`,
      {
        code:
          'CACHE_FINANCIAL_NAMESPACE_DISABLED',
      },
    );
  }

  return buildTenantKey(
    namespace,
    tenantId,
    key,
    {
      ...options,
      config,
    },
  );
}

/**
 * =============================================================================
 * TTL API
 * =============================================================================
 */

function getTtl(
  policy,
  override,
) {
  return resolveTtl(
    policy,
    override,
  );
}

/**
 * =============================================================================
 * Cache Policy API
 * =============================================================================
 */

function getFailurePolicy(
  namespace,
  config = defaultConfig,
) {
  return resolveFailurePolicy(
    namespace,
    config,
  );
}

function canCache(
  namespace,
  operation = 'read',
  config = defaultConfig,
) {
  return shouldCacheNamespace(
    namespace,
    operation,
    config,
  );
}

function canCacheFinancialData(
  namespace,
  operation = 'read',
  config = defaultConfig,
) {
  return isFinancialCacheAllowed(
    namespace,
    operation,
    config,
  );
}

/**
 * =============================================================================
 * Environment Overrides
 * =============================================================================
 *
 * Safe diagnostic view. Secret values are intentionally excluded.
 */

function getEnvironmentOverrides() {
  return safeFreeze({
    CACHE_ENABLED:
      process.env.CACHE_ENABLED,

    CACHE_PROVIDER:
      process.env.CACHE_PROVIDER,

    CACHE_MODE:
      process.env.CACHE_MODE,

    CACHE_REQUIRED:
      process.env.CACHE_REQUIRED,

    CACHE_FAILURE_POLICY:
      process.env.CACHE_FAILURE_POLICY,

    CACHE_FINANCIAL_FAILURE_POLICY:
      process.env.CACHE_FINANCIAL_FAILURE_POLICY,

    CACHE_SECURITY_FAILURE_POLICY:
      process.env.CACHE_SECURITY_FAILURE_POLICY,

    CACHE_KEY_PREFIX:
      process.env.CACHE_KEY_PREFIX,

    CACHE_NAMESPACE:
      process.env.CACHE_NAMESPACE,

    CACHE_TENANT_ISOLATION:
      process.env.CACHE_TENANT_ISOLATION,

    CACHE_DEFAULT_TTL_SECONDS:
      process.env.CACHE_DEFAULT_TTL_SECONDS,

    CACHE_IDEMPOTENCY_TTL_SECONDS:
      process.env.CACHE_IDEMPOTENCY_TTL_SECONDS,

    CACHE_LOCK_TTL_SECONDS:
      process.env.CACHE_LOCK_TTL_SECONDS,

    CACHE_INVALIDATION_ENABLED:
      process.env.CACHE_INVALIDATION_ENABLED,

    CACHE_PUBSUB_INVALIDATION_ENABLED:
      process.env
        .CACHE_PUBSUB_INVALIDATION_ENABLED,

    CACHE_FINANCIAL_READS:
      process.env.CACHE_FINANCIAL_READS,

    CACHE_FINANCIAL_WRITES:
      process.env.CACHE_FINANCIAL_WRITES,

    CACHE_LEDGER_READS:
      process.env.CACHE_LEDGER_READS,

    CACHE_BALANCES:
      process.env.CACHE_BALANCES,

    CACHE_AUTHORIZATION:
      process.env.CACHE_AUTHORIZATION,

    CACHE_KYC:
      process.env.CACHE_KYC,

    CACHE_AML:
      process.env.CACHE_AML,
  });
}

/**
 * =============================================================================
 * Bootstrap Adapter
 * =============================================================================
 */

async function initialize(
  context = {},
) {
  const config =
    defaultConfig;

  if (
    context &&
    typeof context ===
      'object'
  ) {
    context.cacheConfig =
      config;

    context.cache =
      config;
  }

  return config;
}

async function bootstrap(
  context = {},
) {
  return initialize(
    context,
  );
}

async function start(
  context = {},
) {
  return initialize(
    context,
  );
}

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Core.
     */
    config:
      defaultConfig,

    cache:
      defaultConfig,

    getConfig,

    createCacheConfig,

    /**
     * Providers/modes/states.
     */
    CACHE_PROVIDERS,

    CACHE_MODES,

    CACHE_STATES,

    CACHE_FAILURE_POLICIES,

    CACHE_KEY_POLICIES,

    DEFAULT_TTLS,

    DEFAULT_NAMESPACES,

    /**
     * Validation/policy.
     */
    validateCacheConfig,

    isEnabled,

    isDistributed,

    isLocal,

    isRequired,

    canCache,

    canCacheFinancialData,

    getFailurePolicy,

    isFinancialCacheAllowed,

    shouldCacheNamespace,

    /**
     * Keys.
     */
    createKey,

    createTenantKey,

    createUserKey,

    createFinancialKey,

    buildKeyPrefix,

    buildNamespaceKey,

    buildTenantKey,

    buildUserKey,

    /**
     * TTL.
     */
    getTtl,

    getTtlPolicy,

    /**
     * Diagnostics.
     */
    getSnapshot,

    getEnvironmentOverrides,

    /**
     * Bootstrap compatibility.
     */
    initialize,

    bootstrap,

    start,

    /**
     * Metadata.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    CacheConfigError,
  });