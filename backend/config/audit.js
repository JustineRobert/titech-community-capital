'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/audit.js
 *
 * Purpose:
 *   Enterprise production-grade audit configuration and policy module.
 *
 * Responsibilities:
 *   - Define centralized, validated audit configuration.
 *   - Control application/security/financial audit behavior.
 *   - Define immutable audit policy.
 *   - Configure retention, batching and delivery behavior.
 *   - Configure sensitive-field redaction.
 *   - Configure audit severity/event categories.
 *   - Support tenant-aware and actor-aware audit records.
 *   - Support correlation/request/trace identifiers.
 *   - Support immutable business-audit requirements.
 *   - Provide safe operational diagnostics.
 *   - Remain independent from the actual audit persistence implementation.
 *
 * IMPORTANT:
 *
 *   This file defines AUDIT CONFIGURATION AND POLICY.
 *
 *   It does NOT:
 *     - write audit records to MongoDB.
 *     - write audit records to Redis.
 *     - publish events to the event bus.
 *     - implement financial transactions.
 *     - implement ledger entries.
 *     - perform authorization decisions.
 *     - implement HTTP middleware.
 *
 * The actual audit writer/repository/service remains authoritative.
 *
 * Architectural position:
 *
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   audit configuration
 *       ↓
 *   logger / observability
 *       ↓
 *   audit service
 *       ↓
 *   event-bus / database / immutable audit store
 *
 * =============================================================================
 */

/**
 * -----------------------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------------------
 */

const COMPONENT =
  'audit-config';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const AUDIT_STATES =
  Object.freeze({
    DISABLED:
      'disabled',

    ENABLED:
      'enabled',

    DEGRADED:
      'degraded',
  });

const AUDIT_MODES =
  Object.freeze({
    ASYNC:
      'async',

    SYNC:
      'sync',

    HYBRID:
      'hybrid',
  });

const AUDIT_SEVERITIES =
  Object.freeze({
    DEBUG:
      'debug',

    INFO:
      'info',

    NOTICE:
      'notice',

    WARNING:
      'warning',

    ERROR:
      'error',

    CRITICAL:
      'critical',

    SECURITY:
      'security',
  });

const AUDIT_CATEGORIES =
  Object.freeze({
    AUTHENTICATION:
      'authentication',

    AUTHORIZATION:
      'authorization',

    ACCOUNT:
      'account',

    USER:
      'user',

    TENANT:
      'tenant',

    KYC:
      'kyc',

    AML:
      'aml',

    FINANCE:
      'finance',

    LEDGER:
      'ledger',

    TRANSACTION:
      'transaction',

    PAYMENT:
      'payment',

    WALLET:
      'wallet',

    SAVINGS:
      'savings',

    LOAN:
      'loan',

    CONTRIBUTION:
      'contribution',

    WITHDRAWAL:
      'withdrawal',

    IDEMPOTENCY:
      'idempotency',

    MEETING:
      'meeting',

    MOBILE_MONEY:
      'mobile-money',

    ADMIN:
      'admin',

    SECURITY:
      'security',

    COMPLIANCE:
      'compliance',

    SYSTEM:
      'system',

    CONFIGURATION:
      'configuration',

    INTEGRATION:
      'integration',

    API:
      'api',

    DATA:
      'data',

    AUDIT:
      'audit',
  });

const AUDIT_OUTCOMES =
  Object.freeze({
    SUCCESS:
      'success',

    FAILURE:
      'failure',

    DENIED:
      'denied',

    PENDING:
      'pending',

    PARTIAL:
      'partial',

    UNKNOWN:
      'unknown',
  });

const DEFAULTS =
  Object.freeze({
    enabled:
      true,

    mode:
      AUDIT_MODES.ASYNC,

    failClosed:
      true,

    financialFailClosed:
      true,

    securityFailClosed:
      true,

    complianceFailClosed:
      true,

    includeRequestMetadata:
      true,

    includeResponseMetadata:
      false,

    includeTraceContext:
      true,

    includeActor:
      true,

    includeTenant:
      true,

    includeIpAddress:
      true,

    includeUserAgent:
      true,

    includeDeviceMetadata:
      true,

    includeRoute:
      true,

    includeMethod:
      true,

    includeOutcome:
      true,

    includeError:
      true,

    includeTiming:
      true,

    includeChanges:
      true,

    immutable:
      true,

    hashChainEnabled:
      true,

    eventSignatureEnabled:
      false,

    encryptionEnabled:
      false,

    compressionEnabled:
      false,

    queueEnabled:
      true,

    queueName:
      'audit-events',

    batchEnabled:
      true,

    batchSize:
      100,

    batchFlushIntervalMs:
      1_000,

    maxQueueSize:
      10_000,

    writeTimeoutMs:
      5_000,

    shutdownTimeoutMs:
      15_000,

    healthTimeoutMs:
      5_000,

    retentionDays:
      2_555,

    hotRetentionDays:
      90,

    coldRetentionDays:
      2_555,

    maximumPayloadBytes:
      64 * 1024,

    maximumChanges:
      100,

    maximumMetadataKeys:
      100,

    maximumStringLength:
      4_096,

    maximumActorIdLength:
      256,

    maximumTenantIdLength:
      256,

    requireTenantForTenantScopedEvents:
      true,

    requireActorForSecurityEvents:
      false,

    requireCorrelationId:
      true,

    requireRequestIdForHttpEvents:
      false,

    defaultSeverity:
      AUDIT_SEVERITIES.INFO,

    defaultCategory:
      AUDIT_CATEGORIES.SYSTEM,

    defaultOutcome:
      AUDIT_OUTCOMES.SUCCESS,

    allowAnonymousSecurityEvents:
      true,

    redactUnknownFields:
      false,

    allowSensitiveMetadata:
      false,
  });

/**
 * -----------------------------------------------------------------------------
 * Sensitive / Restricted Fields
 * -----------------------------------------------------------------------------
 */

const DEFAULT_REDACT_FIELDS =
  Object.freeze([
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'set-cookie',
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
    'access_token',
    'refresh_token',

    'cardNumber',
    'card_number',
    'pan',
    'cvv',
    'cvc',
    'expiry',
    'expiration',

    'bankAccountNumber',
    'accountNumber',
    'account_number',

    'nationalId',
    'national_id',
    'passportNumber',
    'passport_number',

    'securityAnswer',
    'security_answer',

    'databaseUri',
    'database_uri',
    'mongoUri',
    'mongodbUri',
    'redisUri',
    'redisUrl',
    'dsn',
    'connectionString',
  ]);

/**
 * -----------------------------------------------------------------------------
 * High-Risk / Financial Categories
 * -----------------------------------------------------------------------------
 */

const FINANCIAL_CATEGORIES =
  Object.freeze([
    AUDIT_CATEGORIES.FINANCE,
    AUDIT_CATEGORIES.LEDGER,
    AUDIT_CATEGORIES.TRANSACTION,
    AUDIT_CATEGORIES.PAYMENT,
    AUDIT_CATEGORIES.WALLET,
    AUDIT_CATEGORIES.SAVINGS,
    AUDIT_CATEGORIES.LOAN,
    AUDIT_CATEGORIES.CONTRIBUTION,
    AUDIT_CATEGORIES.WITHDRAWAL,
    AUDIT_CATEGORIES.IDEMPOTENCY,
    AUDIT_CATEGORIES.MOBILE_MONEY,
  ]);

const SECURITY_CATEGORIES =
  Object.freeze([
    AUDIT_CATEGORIES.AUTHENTICATION,
    AUDIT_CATEGORIES.AUTHORIZATION,
    AUDIT_CATEGORIES.SECURITY,
    AUDIT_CATEGORIES.COMPLIANCE,
    AUDIT_CATEGORIES.KYC,
    AUDIT_CATEGORIES.AML,
  ]);

/**
 * -----------------------------------------------------------------------------
 * Mandatory Financial Event Properties
 * -----------------------------------------------------------------------------
 *
 * Financial events must retain enough information to reconstruct the business
 * operation without recording secrets.
 */

const FINANCIAL_REQUIRED_FIELDS =
  Object.freeze([
    'eventId',
    'eventType',
    'category',
    'severity',
    'outcome',
    'timestamp',
    'service',
    'tenantId',
    'actorId',
    'correlationId',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Utility
 * -----------------------------------------------------------------------------
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

  return [
    '1',
    'true',
    'yes',
    'on',
    'enabled',
  ].includes(
    String(value)
      .trim()
      .toLowerCase(),
  );
}

function asPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    value === undefined
      ? fallback
      : Number(value);

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
  const parsed =
    value === undefined
      ? fallback
      : Number(value);

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

function normalizeString(
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
    String(value).trim();

  return normalized || fallback;
}

function normalizeEnum(
  value,
  values,
  fallback,
) {
  const normalized =
    normalizeString(
      value,
      fallback,
    );

  return values.includes(
    normalized,
  )
    ? normalized
    : fallback;
}

function normalizeStringArray(
  value,
  fallback = [],
) {
  if (
    value === undefined ||
    value === null
  ) {
    return [
      ...fallback,
    ];
  }

  const source =
    Array.isArray(value)
      ? value
      : String(value)
          .split(',');

  return [
    ...new Set(
      source
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
    typeof value !==
      'object' &&
      typeof value !==
        'function'
  ) {
    return value;
  }

  if (
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const key of
      Reflect.ownKeys(value)
  ) {
    try {
      safeFreeze(
        value[key],
        seen,
      );
    } catch {
      // Ignore inaccessible properties.
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

/**
 * -----------------------------------------------------------------------------
 * Environment Helpers
 * -----------------------------------------------------------------------------
 */

function envBoolean(
  key,
  fallback,
) {
  return asBoolean(
    process.env[key],
    fallback,
  );
}

function envNumber(
  key,
  fallback,
  parser = asPositiveInteger,
) {
  return parser(
    process.env[key],
    fallback,
  );
}

function envString(
  key,
  fallback,
) {
  return normalizeString(
    process.env[key],
    fallback,
  );
}

/**
 * =============================================================================
 * Configuration Factory
 * =============================================================================
 */

function createAuditConfig(
  input = {},
) {
  const source =
    input.audit ||
    input;

  const config = {
    /**
     * -------------------------------------------------------------------------
     * Core
     * -------------------------------------------------------------------------
     */

    enabled:
      source.enabled ??
      envBoolean(
        'AUDIT_ENABLED',
        DEFAULTS.enabled,
      ),

    mode:
      normalizeEnum(
        source.mode ??
          envString(
            'AUDIT_MODE',
            DEFAULTS.mode,
          ),
        Object.values(
          AUDIT_MODES,
        ),
        DEFAULTS.mode,
      ),

    failClosed:
      source.failClosed ??
      envBoolean(
        'AUDIT_FAIL_CLOSED',
        DEFAULTS.failClosed,
      ),

    financialFailClosed:
      source.financialFailClosed ??
      envBoolean(
        'AUDIT_FINANCIAL_FAIL_CLOSED',
        DEFAULTS.financialFailClosed,
      ),

    securityFailClosed:
      source.securityFailClosed ??
      envBoolean(
        'AUDIT_SECURITY_FAIL_CLOSED',
        DEFAULTS.securityFailClosed,
      ),

    complianceFailClosed:
      source.complianceFailClosed ??
      envBoolean(
        'AUDIT_COMPLIANCE_FAIL_CLOSED',
        DEFAULTS.complianceFailClosed,
      ),

    /**
     * -------------------------------------------------------------------------
     * Context
     * -------------------------------------------------------------------------
     */

    includeRequestMetadata:
      source.includeRequestMetadata ??
      envBoolean(
        'AUDIT_INCLUDE_REQUEST_METADATA',
        DEFAULTS.includeRequestMetadata,
      ),

    includeResponseMetadata:
      source.includeResponseMetadata ??
      envBoolean(
        'AUDIT_INCLUDE_RESPONSE_METADATA',
        DEFAULTS.includeResponseMetadata,
      ),

    includeTraceContext:
      source.includeTraceContext ??
      envBoolean(
        'AUDIT_INCLUDE_TRACE_CONTEXT',
        DEFAULTS.includeTraceContext,
      ),

    includeActor:
      source.includeActor ??
      envBoolean(
        'AUDIT_INCLUDE_ACTOR',
        DEFAULTS.includeActor,
      ),

    includeTenant:
      source.includeTenant ??
      envBoolean(
        'AUDIT_INCLUDE_TENANT',
        DEFAULTS.includeTenant,
      ),

    includeIpAddress:
      source.includeIpAddress ??
      envBoolean(
        'AUDIT_INCLUDE_IP_ADDRESS',
        DEFAULTS.includeIpAddress,
      ),

    includeUserAgent:
      source.includeUserAgent ??
      envBoolean(
        'AUDIT_INCLUDE_USER_AGENT',
        DEFAULTS.includeUserAgent,
      ),

    includeDeviceMetadata:
      source.includeDeviceMetadata ??
      envBoolean(
        'AUDIT_INCLUDE_DEVICE_METADATA',
        DEFAULTS.includeDeviceMetadata,
      ),

    includeRoute:
      source.includeRoute ??
      envBoolean(
        'AUDIT_INCLUDE_ROUTE',
        DEFAULTS.includeRoute,
      ),

    includeMethod:
      source.includeMethod ??
      envBoolean(
        'AUDIT_INCLUDE_METHOD',
        DEFAULTS.includeMethod,
      ),

    includeOutcome:
      source.includeOutcome ??
      envBoolean(
        'AUDIT_INCLUDE_OUTCOME',
        DEFAULTS.includeOutcome,
      ),

    includeError:
      source.includeError ??
      envBoolean(
        'AUDIT_INCLUDE_ERROR',
        DEFAULTS.includeError,
      ),

    includeTiming:
      source.includeTiming ??
      envBoolean(
        'AUDIT_INCLUDE_TIMING',
        DEFAULTS.includeTiming,
      ),

    includeChanges:
      source.includeChanges ??
      envBoolean(
        'AUDIT_INCLUDE_CHANGES',
        DEFAULTS.includeChanges,
      ),

    /**
     * -------------------------------------------------------------------------
     * Integrity
     * -------------------------------------------------------------------------
     */

    immutable:
      source.immutable ??
      envBoolean(
        'AUDIT_IMMUTABLE',
        DEFAULTS.immutable,
      ),

    hashChainEnabled:
      source.hashChainEnabled ??
      envBoolean(
        'AUDIT_HASH_CHAIN_ENABLED',
        DEFAULTS.hashChainEnabled,
      ),

    eventSignatureEnabled:
      source.eventSignatureEnabled ??
      envBoolean(
        'AUDIT_EVENT_SIGNATURE_ENABLED',
        DEFAULTS.eventSignatureEnabled,
      ),

    encryptionEnabled:
      source.encryptionEnabled ??
      envBoolean(
        'AUDIT_ENCRYPTION_ENABLED',
        DEFAULTS.encryptionEnabled,
      ),

    compressionEnabled:
      source.compressionEnabled ??
      envBoolean(
        'AUDIT_COMPRESSION_ENABLED',
        DEFAULTS.compressionEnabled,
      ),

    /**
     * -------------------------------------------------------------------------
     * Delivery
     * -------------------------------------------------------------------------
     */

    queueEnabled:
      source.queueEnabled ??
      envBoolean(
        'AUDIT_QUEUE_ENABLED',
        DEFAULTS.queueEnabled,
      ),

    queueName:
      envString(
        'AUDIT_QUEUE_NAME',
        normalizeString(
          source.queueName,
          DEFAULTS.queueName,
        ),
      ),

    batchEnabled:
      source.batchEnabled ??
      envBoolean(
        'AUDIT_BATCH_ENABLED',
        DEFAULTS.batchEnabled,
      ),

    batchSize:
      asPositiveInteger(
        source.batchSize ??
          process.env.AUDIT_BATCH_SIZE,
        DEFAULTS.batchSize,
      ),

    batchFlushIntervalMs:
      asPositiveInteger(
        source.batchFlushIntervalMs ??
          process.env
            .AUDIT_BATCH_FLUSH_INTERVAL_MS,
        DEFAULTS.batchFlushIntervalMs,
      ),

    maxQueueSize:
      asPositiveInteger(
        source.maxQueueSize ??
          process.env.AUDIT_MAX_QUEUE_SIZE,
        DEFAULTS.maxQueueSize,
      ),

    writeTimeoutMs:
      asPositiveInteger(
        source.writeTimeoutMs ??
          process.env.AUDIT_WRITE_TIMEOUT_MS,
        DEFAULTS.writeTimeoutMs,
      ),

    shutdownTimeoutMs:
      asPositiveInteger(
        source.shutdownTimeoutMs ??
          process.env.AUDIT_SHUTDOWN_TIMEOUT_MS,
        DEFAULTS.shutdownTimeoutMs,
      ),

    healthTimeoutMs:
      asPositiveInteger(
        source.healthTimeoutMs ??
          process.env.AUDIT_HEALTH_TIMEOUT_MS,
        DEFAULTS.healthTimeoutMs,
      ),

    /**
     * -------------------------------------------------------------------------
     * Retention
     * -------------------------------------------------------------------------
     */

    retentionDays:
      asPositiveInteger(
        source.retentionDays ??
          process.env.AUDIT_RETENTION_DAYS,
        DEFAULTS.retentionDays,
      ),

    hotRetentionDays:
      asPositiveInteger(
        source.hotRetentionDays ??
          process.env.AUDIT_HOT_RETENTION_DAYS,
        DEFAULTS.hotRetentionDays,
      ),

    coldRetentionDays:
      asPositiveInteger(
        source.coldRetentionDays ??
          process.env.AUDIT_COLD_RETENTION_DAYS,
        DEFAULTS.coldRetentionDays,
      ),

    /**
     * -------------------------------------------------------------------------
     * Payload limits
     * -------------------------------------------------------------------------
     */

    maximumPayloadBytes:
      asPositiveInteger(
        source.maximumPayloadBytes ??
          process.env
            .AUDIT_MAXIMUM_PAYLOAD_BYTES,
        DEFAULTS.maximumPayloadBytes,
      ),

    maximumChanges:
      asPositiveInteger(
        source.maximumChanges ??
          process.env.AUDIT_MAXIMUM_CHANGES,
        DEFAULTS.maximumChanges,
      ),

    maximumMetadataKeys:
      asPositiveInteger(
        source.maximumMetadataKeys ??
          process.env
            .AUDIT_MAXIMUM_METADATA_KEYS,
        DEFAULTS.maximumMetadataKeys,
      ),

    maximumStringLength:
      asPositiveInteger(
        source.maximumStringLength ??
          process.env
            .AUDIT_MAXIMUM_STRING_LENGTH,
        DEFAULTS.maximumStringLength,
      ),

    maximumActorIdLength:
      asPositiveInteger(
        source.maximumActorIdLength ??
          process.env
            .AUDIT_MAXIMUM_ACTOR_ID_LENGTH,
        DEFAULTS.maximumActorIdLength,
      ),

    maximumTenantIdLength:
      asPositiveInteger(
        source.maximumTenantIdLength ??
          process.env
            .AUDIT_MAXIMUM_TENANT_ID_LENGTH,
        DEFAULTS.maximumTenantIdLength,
      ),

    /**
     * -------------------------------------------------------------------------
     * Identity/context requirements
     * -------------------------------------------------------------------------
     */

    requireTenantForTenantScopedEvents:
      source.requireTenantForTenantScopedEvents ??
      envBoolean(
        'AUDIT_REQUIRE_TENANT_FOR_TENANT_EVENTS',
        DEFAULTS.requireTenantForTenantScopedEvents,
      ),

    requireActorForSecurityEvents:
      source.requireActorForSecurityEvents ??
      envBoolean(
        'AUDIT_REQUIRE_ACTOR_FOR_SECURITY_EVENTS',
        DEFAULTS.requireActorForSecurityEvents,
      ),

    requireCorrelationId:
      source.requireCorrelationId ??
      envBoolean(
        'AUDIT_REQUIRE_CORRELATION_ID',
        DEFAULTS.requireCorrelationId,
      ),

    requireRequestIdForHttpEvents:
      source.requireRequestIdForHttpEvents ??
      envBoolean(
        'AUDIT_REQUIRE_REQUEST_ID_FOR_HTTP',
        DEFAULTS.requireRequestIdForHttpEvents,
      ),

    allowAnonymousSecurityEvents:
      source.allowAnonymousSecurityEvents ??
      envBoolean(
        'AUDIT_ALLOW_ANONYMOUS_SECURITY_EVENTS',
        DEFAULTS.allowAnonymousSecurityEvents,
      ),

    /**
     * -------------------------------------------------------------------------
     * Data policy
     * -------------------------------------------------------------------------
     */

    redactUnknownFields:
      source.redactUnknownFields ??
      envBoolean(
        'AUDIT_REDACT_UNKNOWN_FIELDS',
        DEFAULTS.redactUnknownFields,
      ),

    allowSensitiveMetadata:
      source.allowSensitiveMetadata ??
      envBoolean(
        'AUDIT_ALLOW_SENSITIVE_METADATA',
        DEFAULTS.allowSensitiveMetadata,
      ),

    /**
     * -------------------------------------------------------------------------
     * Defaults
     * -------------------------------------------------------------------------
     */

    defaultSeverity:
      normalizeEnum(
        source.defaultSeverity ??
          envString(
            'AUDIT_DEFAULT_SEVERITY',
            DEFAULTS.defaultSeverity,
          ),
        Object.values(
          AUDIT_SEVERITIES,
        ),
        DEFAULTS.defaultSeverity,
      ),

    defaultCategory:
      normalizeEnum(
        source.defaultCategory ??
          envString(
            'AUDIT_DEFAULT_CATEGORY',
            DEFAULTS.defaultCategory,
          ),
        Object.values(
          AUDIT_CATEGORIES,
        ),
        DEFAULTS.defaultCategory,
      ),

    defaultOutcome:
      normalizeEnum(
        source.defaultOutcome ??
          envString(
            'AUDIT_DEFAULT_OUTCOME',
            DEFAULTS.defaultOutcome,
          ),
        Object.values(
          AUDIT_OUTCOMES,
        ),
        DEFAULTS.defaultOutcome,
      ),

    /**
     * -------------------------------------------------------------------------
     * Redaction
     * -------------------------------------------------------------------------
     */

    redactFields:
      normalizeStringArray(
        source.redactFields ??
          process.env
            .AUDIT_REDACT_FIELDS,
        DEFAULT_REDACT_FIELDS,
      ),

    /**
     * -------------------------------------------------------------------------
     * Event policy overrides
     * -------------------------------------------------------------------------
     */

    financialCategories:
      normalizeStringArray(
        source.financialCategories,
        FINANCIAL_CATEGORIES,
      ),

    securityCategories:
      normalizeStringArray(
        source.securityCategories,
        SECURITY_CATEGORIES,
      ),

    financialRequiredFields:
      normalizeStringArray(
        source.financialRequiredFields,
        FINANCIAL_REQUIRED_FIELDS,
      ),

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

  /**
   * ---------------------------------------------------------------------------
   * Derived state
   * ---------------------------------------------------------------------------
   */

  config.state =
    config.enabled
      ? AUDIT_STATES.ENABLED
      : AUDIT_STATES.DISABLED;

  config.financialAuditEnabled =
    config.enabled &&
    config.financialCategories
      .length >
      0;

  config.securityAuditEnabled =
    config.enabled &&
    config.securityCategories
      .length >
      0;

  config.complianceAuditEnabled =
    config.enabled;

  return validateAuditConfig(
    config,
  );
}

/**
 * =============================================================================
 * Validation
 * =============================================================================
 */

function validateAuditConfig(
  config,
) {
  if (
    !config ||
    typeof config !==
      'object'
  ) {
    throw new TypeError(
      'TITech audit configuration must be an object.',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Immutable audit policy
   * ---------------------------------------------------------------------------
   */

  if (
    config.immutable !==
    true
  ) {
    throw new Error(
      'TITech audit configuration must keep immutable audit records enabled.',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Financial fail-closed policy
   * ---------------------------------------------------------------------------
   */

  if (
    config.financialAuditEnabled &&
    config.financialFailClosed !==
      true
  ) {
    /**
     * This is intentionally not rejected because some deployments may elect a
     * degraded asynchronous policy. The warning is surfaced in diagnostics.
     */
  }

  /**
   * ---------------------------------------------------------------------------
   * Retention
   * ---------------------------------------------------------------------------
   */

  if (
    config.hotRetentionDays >
    config.retentionDays
  ) {
    throw new Error(
      'TITech audit hot retention cannot exceed total audit retention.',
    );
  }

  if (
    config.coldRetentionDays <
    config.retentionDays
  ) {
    throw new Error(
      'TITech audit cold retention must be greater than or equal to total retention.',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Queue/batch validation
   * ---------------------------------------------------------------------------
   */

  if (
    config.batchEnabled &&
    !config.queueEnabled
  ) {
    throw new Error(
      'TITech audit batching requires audit queue delivery to be enabled.',
    );
  }

  if (
    config.batchSize >
    config.maxQueueSize
  ) {
    throw new Error(
      'TITech audit batch size cannot exceed maximum queue size.',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Payload limits
   * ---------------------------------------------------------------------------
   */

  if (
    config.maximumChanges <=
    0
  ) {
    throw new Error(
      'TITech audit maximumChanges must be greater than zero.',
    );
  }

  if (
    config.maximumMetadataKeys <=
    0
  ) {
    throw new Error(
      'TITech audit maximumMetadataKeys must be greater than zero.',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Security constraints
   * ---------------------------------------------------------------------------
   */

  if (
    !config.allowSensitiveMetadata &&
    config.redactFields.length ===
      0
  ) {
    throw new Error(
      'TITech audit redaction fields cannot be empty when sensitive metadata is disabled.',
    );
  }

  return safeFreeze(
    config,
  );
}

/**
 * =============================================================================
 * Event Policy Helpers
 * =============================================================================
 */

function isFinancialCategory(
  category,
  config = defaultConfig,
) {
  return config.financialCategories.includes(
    category,
  );
}

function isSecurityCategory(
  category,
  config = defaultConfig,
) {
  return config.securityCategories.includes(
    category,
  );
}

function isTenantScopedCategory(
  category,
) {
  return [
    AUDIT_CATEGORIES.ACCOUNT,
    AUDIT_CATEGORIES.USER,
    AUDIT_CATEGORIES.TENANT,
    AUDIT_CATEGORIES.KYC,
    AUDIT_CATEGORIES.AML,
    AUDIT_CATEGORIES.FINANCE,
    AUDIT_CATEGORIES.LEDGER,
    AUDIT_CATEGORIES.TRANSACTION,
    AUDIT_CATEGORIES.PAYMENT,
    AUDIT_CATEGORIES.WALLET,
    AUDIT_CATEGORIES.SAVINGS,
    AUDIT_CATEGORIES.LOAN,
    AUDIT_CATEGORIES.CONTRIBUTION,
    AUDIT_CATEGORIES.WITHDRAWAL,
    AUDIT_CATEGORIES.IDEMPOTENCY,
    AUDIT_CATEGORIES.MEETING,
    AUDIT_CATEGORIES.MOBILE_MONEY,
  ].includes(
    category,
  );
}

function getRequiredFieldsForEvent(
  options = {},
  config = defaultConfig,
) {
  const category =
    normalizeString(
      options.category,
      config.defaultCategory,
    );

  const fields =
    new Set();

  if (
    config.requireCorrelationId
  ) {
    fields.add(
      'correlationId',
    );
  }

  if (
    isTenantScopedCategory(
      category,
    ) &&
    config.requireTenantForTenantScopedEvents
  ) {
    fields.add(
      'tenantId',
    );
  }

  if (
    isSecurityCategory(
      category,
      config,
    ) &&
    config.requireActorForSecurityEvents
  ) {
    fields.add(
      'actorId',
    );
  }

  if (
    options.http === true &&
    config.requireRequestIdForHttpEvents
  ) {
    fields.add(
      'requestId',
    );
  }

  if (
    isFinancialCategory(
      category,
      config,
    )
  ) {
    for (
      const field of
        config.financialRequiredFields
    ) {
      fields.add(
        field,
      );
    }
  }

  return Object.freeze([
    ...fields,
  ]);
}

/**
 * =============================================================================
 * Severity / Outcome Policy
 * =============================================================================
 */

function resolveSeverity(
  options = {},
  config = defaultConfig,
) {
  if (
    options.severity
  ) {
    return normalizeEnum(
      options.severity,
      Object.values(
        AUDIT_SEVERITIES,
      ),
      config.defaultSeverity,
    );
  }

  if (
    options.security === true
  ) {
    return AUDIT_SEVERITIES.SECURITY;
  }

  if (
    options.critical === true
  ) {
    return AUDIT_SEVERITIES.CRITICAL;
  }

  if (
    options.error === true
  ) {
    return AUDIT_SEVERITIES.ERROR;
  }

  return config.defaultSeverity;
}

function resolveOutcome(
  options = {},
  config = defaultConfig,
) {
  return normalizeEnum(
    options.outcome,
    Object.values(
      AUDIT_OUTCOMES,
    ),
    config.defaultOutcome,
  );
}

/**
 * =============================================================================
 * Failure Policy
 * =============================================================================
 */

function shouldFailClosed(
  options = {},
  config = defaultConfig,
) {
  const category =
    normalizeString(
      options.category,
      config.defaultCategory,
    );

  if (
    isFinancialCategory(
      category,
      config,
    )
  ) {
    return config.financialFailClosed;
  }

  if (
    isSecurityCategory(
      category,
      config,
    )
  ) {
    return config.securityFailClosed;
  }

  if (
    category ===
    AUDIT_CATEGORIES.COMPLIANCE
  ) {
    return config.complianceFailClosed;
  }

  return config.failClosed;
}

/**
 * =============================================================================
 * Public Policy Helpers
 * =============================================================================
 */

function getPolicy(
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  const category =
    normalizeString(
      options.category,
      config.defaultCategory,
    );

  return safeFreeze({
    category,

    severity:
      resolveSeverity(
        options,
        config,
      ),

    outcome:
      resolveOutcome(
        options,
        config,
      ),

    financial:
      isFinancialCategory(
        category,
        config,
      ),

    security:
      isSecurityCategory(
        category,
        config,
      ),

    tenantScoped:
      isTenantScopedCategory(
        category,
      ),

    requiredFields:
      getRequiredFieldsForEvent(
        {
          ...options,

          category,
        },
        config,
      ),

    failClosed:
      shouldFailClosed(
        {
          ...options,

          category,
        },
        config,
      ),

    immutable:
      config.immutable,

    hashChainEnabled:
      config.hashChainEnabled,

    eventSignatureEnabled:
      config.eventSignatureEnabled,

    encryptionEnabled:
      config.encryptionEnabled,
  });
}

/**
 * =============================================================================
 * Redaction Policy
 * =============================================================================
 */

function getRedactionFields(
  config = defaultConfig,
) {
  return Object.freeze([
    ...config.redactFields,
  ]);
}

function isSensitiveField(
  field,
  config = defaultConfig,
) {
  const normalized =
    String(
      field ||
        '',
    )
      .trim()
      .toLowerCase();

  return config.redactFields.some(
    sensitive =>
      String(
        sensitive,
      )
        .trim()
        .toLowerCase() ===
      normalized,
  );
}

/**
 * =============================================================================
 * Safe Diagnostics
 * =============================================================================
 */

function getSnapshot(
  config = defaultConfig,
) {
  return safeFreeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    state:
      config.state,

    enabled:
      config.enabled,

    mode:
      config.mode,

    failClosed:
      config.failClosed,

    financialFailClosed:
      config.financialFailClosed,

    securityFailClosed:
      config.securityFailClosed,

    complianceFailClosed:
      config.complianceFailClosed,

    immutable:
      config.immutable,

    hashChainEnabled:
      config.hashChainEnabled,

    eventSignatureEnabled:
      config.eventSignatureEnabled,

    encryptionEnabled:
      config.encryptionEnabled,

    queueEnabled:
      config.queueEnabled,

    batchEnabled:
      config.batchEnabled,

    queueName:
      config.queueName,

    retentionDays:
      config.retentionDays,

    hotRetentionDays:
      config.hotRetentionDays,

    coldRetentionDays:
      config.coldRetentionDays,

    maximumPayloadBytes:
      config.maximumPayloadBytes,

    maximumChanges:
      config.maximumChanges,

    maximumMetadataKeys:
      config.maximumMetadataKeys,

    redactionFieldCount:
      config.redactFields.length,

    financialCategories:
      [
        ...config.financialCategories,
      ],

    securityCategories:
      [
        ...config.securityCategories,
      ],

    timestamp:
      new Date().toISOString(),
  });
}

/**
 * =============================================================================
 * Config Singleton
 * =============================================================================
 */

const defaultConfig =
  createAuditConfig();

/**
 * =============================================================================
 * Public Factory / Accessors
 * ============================================================================= */

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

  return createAuditConfig({
    ...defaultConfig,

    ...override,
  });
}

function validateConfig(
  override = defaultConfig,
) {
  return validateAuditConfig(
    getConfig(
      override,
    ),
  );
}

function isEnabled(
  config = defaultConfig,
) {
  return (
    config.enabled ===
    true
  );
}

function isFinancialAuditEnabled(
  config = defaultConfig,
) {
  return (
    config.enabled ===
      true &&
    config.financialAuditEnabled ===
      true
  );
}

function isSecurityAuditEnabled(
  config = defaultConfig,
) {
  return (
    config.enabled ===
      true &&
    config.securityAuditEnabled ===
      true
  );
}

/**
 * =============================================================================
 * Environment Configuration
 * =============================================================================
 *
 * Exposed as a safe subset for diagnostics/configuration introspection.
 */

function getEnvironmentOverrides() {
  return safeFreeze({
    AUDIT_ENABLED:
      process.env.AUDIT_ENABLED,

    AUDIT_MODE:
      process.env.AUDIT_MODE,

    AUDIT_FAIL_CLOSED:
      process.env.AUDIT_FAIL_CLOSED,

    AUDIT_FINANCIAL_FAIL_CLOSED:
      process.env.AUDIT_FINANCIAL_FAIL_CLOSED,

    AUDIT_SECURITY_FAIL_CLOSED:
      process.env.AUDIT_SECURITY_FAIL_CLOSED,

    AUDIT_QUEUE_ENABLED:
      process.env.AUDIT_QUEUE_ENABLED,

    AUDIT_QUEUE_NAME:
      process.env.AUDIT_QUEUE_NAME,

    AUDIT_BATCH_ENABLED:
      process.env.AUDIT_BATCH_ENABLED,

    AUDIT_BATCH_SIZE:
      process.env.AUDIT_BATCH_SIZE,

    AUDIT_RETENTION_DAYS:
      process.env.AUDIT_RETENTION_DAYS,

    AUDIT_HOT_RETENTION_DAYS:
      process.env.AUDIT_HOT_RETENTION_DAYS,

    AUDIT_COLD_RETENTION_DAYS:
      process.env.AUDIT_COLD_RETENTION_DAYS,
  });
}

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Core configuration.
     */
    config:
      defaultConfig,

    audit:
      defaultConfig,

    getConfig,

    createAuditConfig,

    validateConfig,

    validateAuditConfig,

    /**
     * States / enums.
     */
    AUDIT_STATES,

    AUDIT_MODES,

    AUDIT_SEVERITIES,

    AUDIT_CATEGORIES,

    AUDIT_OUTCOMES,

    FINANCIAL_CATEGORIES,

    SECURITY_CATEGORIES,

    FINANCIAL_REQUIRED_FIELDS,

    DEFAULT_REDACT_FIELDS,

    /**
     * Policy.
     */
    getPolicy,

    getRequiredFieldsForEvent,

    resolveSeverity,

    resolveOutcome,

    shouldFailClosed,

    isFinancialCategory,

    isSecurityCategory,

    isTenantScopedCategory,

    /**
     * Redaction.
     */
    getRedactionFields,

    isSensitiveField,

    /**
     * Status.
     */
    isEnabled,

    isFinancialAuditEnabled,

    isSecurityAuditEnabled,

    getSnapshot,

    getEnvironmentOverrides,

    /**
     * Metadata.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,
  });