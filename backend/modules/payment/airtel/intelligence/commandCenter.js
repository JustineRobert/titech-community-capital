'use strict';

/**
 * =============================================================================
 * TITech Community Capital
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/commandCenter.js
 *
 * Purpose:
 *   Enterprise Airtel intelligence command center / operational control-plane.
 *
 * Architectural Role
 * ------------------
 *   The Command Center is the governed orchestration boundary for Airtel
 *   intelligence and operational workflows.
 *
 *   It coordinates:
 *
 *     - callback intelligence
 *     - analytics inspection
 *     - fraud/failure intelligence
 *     - reconciliation workflows
 *     - provider health awareness
 *     - operational recommendations
 *     - incident escalation
 *     - bounded retry requests
 *     - repair-workflow requests
 *     - manual-review routing
 *     - executive/operational summaries
 *
 *   It converts signals into explicit commands or recommendations while
 *   maintaining a strict distinction between:
 *
 *       OBSERVATION
 *           ↓
 *       ANALYSIS
 *           ↓
 *       RECOMMENDATION
 *           ↓
 *       APPROVAL
 *           ↓
 *       EXECUTION BY AUTHORITATIVE SERVICE
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 *   This module MUST NOT:
 *
 *     - authenticate Airtel credentials
 *     - verify callback signatures
 *     - execute provider HTTP calls directly
 *     - settle financial transactions
 *     - post ledger entries
 *     - mutate balances
 *     - create accounting entries
 *     - authorize a payment on its own
 *     - mark provider acceptance as settlement
 *     - directly perform disbursement
 *     - make a final compliance determination
 *     - override maker-checker controls
 *     - silently retry financial operations
 *     - treat an AI recommendation as an authorization
 *     - treat callback evidence as final financial truth
 *
 * Financial Safety Principles
 * ---------------------------
 *   1. The Command Center is never the financial source of truth.
 *   2. Financial execution remains behind canonical payment/financial services.
 *   3. AI/ML output is advisory unless a separate explicit policy says otherwise.
 *   4. Consequential actions require explicit approval/execution boundaries.
 *   5. Retries are bounded and must be classified as operationally retryable.
 *   6. Tenant isolation is mandatory.
 *   7. Idempotency is mandatory before command side effects.
 *   8. Monetary values remain strings and are never arithmetically converted
 *      through JavaScript Number.
 *   9. Commands are immutable once accepted into execution.
 *  10. Audit/event publication failure must never be used to invent financial
 *      success.
 *
 * Security Principles
 * -------------------
 *   - deny-by-default commands
 *   - explicit command allow-list
 *   - tenant-bound command identity
 *   - approval boundary separation
 *   - idempotency
 *   - bounded payloads
 *   - sensitive-data redaction
 *   - safe diagnostics
 *   - no credential propagation
 *   - no arbitrary function execution supplied by callers
 *
 * Dependencies
 * ------------
 *   Dependencies are injected and may include:
 *
 *     callbackIntelligenceService
 *     aiDecisionEngine
 *     autonomousRouter
 *     analyticsPipeline
 *     reconciliationService
 *     providerHealthService
 *     approvalService
 *     incidentService
 *     retryService
 *     commandRepository
 *     idempotencyService
 *     auditService
 *     eventPublisher / outbox
 *     observability
 *     logger
 *
 *   No concrete dependency is required at import time.
 *
 * Module Format
 * -------------
 *   CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const SERVICE_NAME =
  'airtel.commandCenter';

const PROVIDER =
  'AIRTEL';

const VERSION =
  '1.0.0';

const MAX_COMMAND_ID_LENGTH =
  256;

const MAX_CORRELATION_ID_LENGTH =
  256;

const MAX_IDEMPOTENCY_KEY_LENGTH =
  256;

const MAX_TENANT_ID_LENGTH =
  256;

const MAX_REASON_LENGTH =
  2048;

const MAX_REFERENCE_LENGTH =
  256;

const MAX_METADATA_KEYS =
  100;

const MAX_ARRAY_ITEMS =
  100;

const MAX_OBJECT_DEPTH =
  6;

const MAX_STRING_LENGTH =
  4096;

const DEFAULT_MAX_RETRY_ATTEMPTS =
  3;

const DEFAULT_MAX_COMMAND_PAYLOAD_BYTES =
  64 * 1024;

const COMMAND_STATUS =
  Object.freeze({
    PLANNED:
      'PLANNED',

    APPROVAL_REQUIRED:
      'APPROVAL_REQUIRED',

    APPROVED:
      'APPROVED',

    DISPATCHED:
      'DISPATCHED',

    COMPLETED:
      'COMPLETED',

    FAILED:
      'FAILED',

    REJECTED:
      'REJECTED',

    EXPIRED:
      'EXPIRED',

    CANCELLED:
      'CANCELLED',
  });

const COMMAND_TYPE =
  Object.freeze({
    INSPECT:
      'INSPECT',

    CALLBACK_ANALYSIS:
      'CALLBACK_ANALYSIS',

    PROVIDER_HEALTH:
      'PROVIDER_HEALTH',

    ANALYTICS_REFRESH:
      'ANALYTICS_REFRESH',

    RECONCILIATION:
      'RECONCILIATION',

    RETRY_QUEUE:
      'RETRY_QUEUE',

    REPAIR_WORKFLOW:
      'REPAIR_WORKFLOW',

    MANUAL_REVIEW:
      'MANUAL_REVIEW',

    ESCALATION:
      'ESCALATION',

    INCIDENT:
      'INCIDENT',

    PROCESS_PAYMENT:
      'PROCESS_PAYMENT',

    DISPATCH:
      'DISPATCH',
  });

const COMMAND_CLASS =
  Object.freeze({
    READ_ONLY:
      'READ_ONLY',

    ANALYTICS:
      'ANALYTICS',

    OPERATIONAL:
      'OPERATIONAL',

    FINANCIAL:
      'FINANCIAL',

    INCIDENT:
      'INCIDENT',
  });

const RISK_LEVEL =
  Object.freeze({
    LOW:
      'LOW',

    MEDIUM:
      'MEDIUM',

    HIGH:
      'HIGH',

    CRITICAL:
      'CRITICAL',
  });

const APPROVAL_STATE =
  Object.freeze({
    NOT_REQUIRED:
      'NOT_REQUIRED',

    REQUIRED:
      'REQUIRED',

    PENDING:
      'PENDING',

    APPROVED:
      'APPROVED',

    REJECTED:
      'REJECTED',
  });

const DECISION =
  Object.freeze({
    PROCEED:
      'PROCEED',

    REVIEW:
      'REVIEW',

    RETRY:
      'RETRY',

    ESCALATE:
      'ESCALATE',

    REPAIR:
      'REPAIR',

    REJECT:
      'REJECT',
  });

/**
 * Command policies.
 *
 * Important:
 * These are orchestration policies, not provider API contracts.
 */
const COMMAND_POLICY =
  Object.freeze({
    [COMMAND_TYPE.INSPECT]:
      {
        class:
          COMMAND_CLASS.READ_ONLY,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.CALLBACK_ANALYSIS]:
      {
        class:
          COMMAND_CLASS.ANALYTICS,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.PROVIDER_HEALTH]:
      {
        class:
          COMMAND_CLASS.READ_ONLY,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.ANALYTICS_REFRESH]:
      {
        class:
          COMMAND_CLASS.ANALYTICS,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.RECONCILIATION]:
      {
        class:
          COMMAND_CLASS.OPERATIONAL,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.RETRY_QUEUE]:
      {
        class:
          COMMAND_CLASS.OPERATIONAL,
        approvalRequired:
          true,
        financial:
          false,
      },

    [COMMAND_TYPE.REPAIR_WORKFLOW]:
      {
        class:
          COMMAND_CLASS.OPERATIONAL,
        approvalRequired:
          true,
        financial:
          false,
      },

    [COMMAND_TYPE.MANUAL_REVIEW]:
      {
        class:
          COMMAND_CLASS.OPERATIONAL,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.ESCALATION]:
      {
        class:
          COMMAND_CLASS.INCIDENT,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.INCIDENT]:
      {
        class:
          COMMAND_CLASS.INCIDENT,
        approvalRequired:
          false,
        financial:
          false,
      },

    [COMMAND_TYPE.PROCESS_PAYMENT]:
      {
        class:
          COMMAND_CLASS.FINANCIAL,
        approvalRequired:
          true,
        financial:
          true,
      },

    [COMMAND_TYPE.DISPATCH]:
      {
        class:
          COMMAND_CLASS.FINANCIAL,
        approvalRequired:
          true,
        financial:
          true,
      },
  });

const SENSITIVE_KEYS =
  new Set([
    'password',
    'passwd',
    'passcode',
    'pin',
    'otp',
    'token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'clientsecret',
    'client_secret',
    'secret',
    'apikey',
    'api_key',
    'authorization',
    'cookie',
    'set-cookie',
    'privatekey',
    'private_key',
    'encryptionkey',
    'encryption_key',
    'credentials',
    'credential',
  ]);

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class CommandCenterError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'CommandCenterError';

    this.code =
      options.code ||
      'AIRTEL_COMMAND_CENTER_ERROR';

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 500;

    this.retryable =
      options.retryable === true;

    this.tenantId =
      options.tenantId ||
      null;

    this.commandId =
      options.commandId ||
      null;

    this.correlationId =
      options.correlationId ||
      null;

    this.cause =
      options.cause ||
      null;

    if (
      Error.captureStackTrace
    ) {
      Error.captureStackTrace(
        this,
        CommandCenterError,
      );
    }
  }
}

class CommandValidationError
  extends CommandCenterError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        code:
          options.code ||
          'AIRTEL_COMMAND_VALIDATION_ERROR',
        statusCode:
          options.statusCode ||
          400,
        retryable:
          false,
      },
    );

    this.name =
      'CommandValidationError';
  }
}

class CommandApprovalError
  extends CommandCenterError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        code:
          options.code ||
          'AIRTEL_COMMAND_APPROVAL_REQUIRED',
        statusCode:
          options.statusCode ||
          403,
        retryable:
          false,
      },
    );

    this.name =
      'CommandApprovalError';
  }
}

class CommandDependencyError
  extends CommandCenterError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        ...options,
        code:
          options.code ||
          'AIRTEL_COMMAND_DEPENDENCY_ERROR',
        statusCode:
          options.statusCode ||
          503,
        retryable:
          options.retryable !== false,
      },
    );

    this.name =
      'CommandDependencyError';
  }
}

/**
 * =============================================================================
 * Primitive Helpers
 * =============================================================================
 */

function isPlainObject(
  value,
) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function isFunction(
  value,
) {
  return (
    typeof value ===
    'function'
  );
}

function normalizeString(
  value,
  {
    name =
      'value',
    required =
      false,
    maxLength =
      MAX_STRING_LENGTH,
  } = {},
) {
  if (
    value === null ||
    value === undefined
  ) {
    if (required) {
      throw new CommandValidationError(
        `${name} is required.`,
        {
          code:
            'AIRTEL_COMMAND_REQUIRED_FIELD',
        },
      );
    }

    return null;
  }

  if (
    typeof value !==
      'string' &&
    typeof value !==
      'number' &&
    typeof value !==
      'boolean'
  ) {
    throw new CommandValidationError(
      `${name} must be a string-compatible primitive.`,
      {
        code:
          'AIRTEL_COMMAND_INVALID_STRING',
      },
    );
  }

  const normalized =
    String(value).trim();

  if (
    !normalized
  ) {
    if (required) {
      throw new CommandValidationError(
        `${name} must not be empty.`,
        {
          code:
            'AIRTEL_COMMAND_EMPTY_FIELD',
        },
      );
    }

    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new CommandValidationError(
      `${name} exceeds its maximum permitted length.`,
      {
        code:
          'AIRTEL_COMMAND_FIELD_TOO_LARGE',
      },
    );
  }

  return normalized;
}

function normalizeTenantId(
  value,
) {
  return normalizeString(
    value,
    {
      name:
        'tenantId',
      required:
        true,
      maxLength:
        MAX_TENANT_ID_LENGTH,
    },
  );
}

function normalizeCommandType(
  value,
) {
  const normalized =
    normalizeString(
      value,
      {
        name:
          'commandType',
        required:
          true,
        maxLength:
          64,
      },
    ).toUpperCase();

  if (
    !Object.prototype.hasOwnProperty.call(
      COMMAND_POLICY,
      normalized,
    )
  ) {
    throw new CommandValidationError(
      `Unsupported Airtel command type "${normalized}".`,
      {
        code:
          'AIRTEL_COMMAND_TYPE_NOT_ALLOWED',
      },
    );
  }

  return normalized;
}

function normalizeCorrelationId(
  value,
) {
  return (
    normalizeString(
      value,
      {
        name:
          'correlationId',
        maxLength:
          MAX_CORRELATION_ID_LENGTH,
      },
    ) ||
    null
  );
}

function normalizeIdempotencyKey(
  value,
) {
  return (
    normalizeString(
      value,
      {
        name:
          'idempotencyKey',
        maxLength:
          MAX_IDEMPOTENCY_KEY_LENGTH,
      },
    ) ||
    null
  );
}

function normalizeRiskLevel(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return RISK_LEVEL.LOW;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  if (
    !Object.values(
      RISK_LEVEL,
    ).includes(
      normalized,
    )
  ) {
    throw new CommandValidationError(
      `Invalid risk level "${normalized}".`,
      {
        code:
          'AIRTEL_COMMAND_INVALID_RISK_LEVEL',
      },
    );
  }

  return normalized;
}

function normalizeDecision(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  if (
    !Object.values(
      DECISION,
    ).includes(
      normalized,
    )
  ) {
    throw new CommandValidationError(
      `Invalid command decision "${normalized}".`,
      {
        code:
          'AIRTEL_COMMAND_INVALID_DECISION',
      },
    );
  }

  return normalized;
}

function normalizeNonNegativeInteger(
  value,
  {
    name =
      'value',
    defaultValue =
      0,
    max =
      Number.MAX_SAFE_INTEGER,
  } = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return defaultValue;
  }

  const normalized =
    Number(value);

  if (
    !Number.isInteger(
      normalized,
    ) ||
    normalized < 0 ||
    normalized > max
  ) {
    throw new CommandValidationError(
      `${name} must be a non-negative integer.`,
      {
        code:
          'AIRTEL_COMMAND_INVALID_INTEGER',
      },
    );
  }

  return normalized;
}

/**
 * Monetary values are retained as strings.
 *
 * The command center does not perform financial arithmetic.
 */
function normalizeMoneyString(
  value,
  name =
    'amount',
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (
    !/^-?\d+(?:\.\d+)?$/.test(
      normalized,
    )
  ) {
    throw new CommandValidationError(
      `${name} must be a plain decimal representation.`,
      {
        code:
          'AIRTEL_COMMAND_INVALID_MONEY',
      },
    );
  }

  if (
    normalized.length >
    128
  ) {
    throw new CommandValidationError(
      `${name} exceeds the maximum supported length.`,
      {
        code:
          'AIRTEL_COMMAND_MONEY_TOO_LARGE',
      },
    );
  }

  return normalized;
}

function nowDate(
) {
  return new Date();
}

/**
 * =============================================================================
 * Stable Identity / Hashing
 * =============================================================================
 */

function stableSort(
  value,
  depth = 0,
) {
  if (
    depth >
    MAX_OBJECT_DEPTH
  ) {
    return '[TRUNCATED_DEPTH]';
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        MAX_ARRAY_ITEMS,
      )
      .map(
        item =>
          stableSort(
            item,
            depth + 1,
          ),
      );
  }

  if (
    !isPlainObject(value)
  ) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce(
      (
        result,
        key,
      ) => {
        result[key] =
          stableSort(
            value[key],
            depth + 1,
          );

        return result;
      },
      {},
    );
}

function stableStringify(
  value,
) {
  return JSON.stringify(
    stableSort(value),
  );
}

function sha256(
  value,
) {
  return crypto
    .createHash(
      'sha256',
    )
    .update(
      typeof value ===
        'string'
        ? value
        : stableStringify(
            value,
          ),
      'utf8',
    )
    .digest('hex');
}

function createCommandId(
  {
    tenantId,
    commandType,
    correlationId,
    idempotencyKey,
    targetReference,
    payloadHash,
  },
) {
  return `airtel-command-${sha256(
    [
      tenantId,
      PROVIDER,
      commandType,
      correlationId || '',
      idempotencyKey || '',
      targetReference || '',
      payloadHash || '',
    ].join('|'),
  )}`;
}

/**
 * =============================================================================
 * Sanitization
 * =============================================================================
 */

function isSensitiveKey(
  key,
) {
  const normalized =
    String(key)
      .replace(
        /[\s-]/g,
        '',
      )
      .toLowerCase();

  return (
    SENSITIVE_KEYS.has(
      normalized,
    )
  );
}

function sanitize(
  value,
  depth = 0,
) {
  if (
    depth >
    MAX_OBJECT_DEPTH
  ) {
    return '[TRUNCATED_DEPTH]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
      'string'
  ) {
    if (
      value.length >
      MAX_STRING_LENGTH
    ) {
      return (
        value.slice(
          0,
          MAX_STRING_LENGTH,
        ) +
        '[TRUNCATED]'
      );
    }

    return value;
  }

  if (
    typeof value ===
      'number'
  ) {
    return Number.isFinite(
      value,
    )
      ? value
      : null;
  }

  if (
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'bigint'
  ) {
    return value.toString();
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(value)
  ) {
    return `[BUFFER:${value.length} bytes]`;
  }

  if (
    Array.isArray(value)
  ) {
    const output =
      value
        .slice(
          0,
          MAX_ARRAY_ITEMS,
        )
        .map(
          item =>
            sanitize(
              item,
              depth + 1,
            ),
        );

    if (
      value.length >
      MAX_ARRAY_ITEMS
    ) {
      output.push(
        `[TRUNCATED_ITEMS:${value.length - MAX_ARRAY_ITEMS}]`,
      );
    }

    return output;
  }

  if (
    typeof value ===
      'object'
  ) {
    const output = {};

    const keys =
      Object.keys(
        value,
      ).slice(
        0,
        MAX_METADATA_KEYS,
      );

    for (
      const key of keys
    ) {
      if (
        isSensitiveKey(
          key,
        )
      ) {
        output[key] =
          '[REDACTED]';

        continue;
      }

      output[key] =
        sanitize(
          value[key],
          depth + 1,
        );
    }

    if (
      Object.keys(value)
        .length >
      MAX_METADATA_KEYS
    ) {
      output.__truncatedKeys =
        Object.keys(value)
          .length -
        MAX_METADATA_KEYS;
    }

    return output;
  }

  return String(value);
}

/**
 * =============================================================================
 * Context Resolution
 * =============================================================================
 */

function resolveTenantId(
  input = {},
) {
  return normalizeTenantId(
    input.tenantId ||
      input.context?.tenantId ||
      input.context?.tenant?.tenantId ||
      input.context?.tenant?.id,
  );
}

function resolveCorrelationId(
  input = {},
) {
  return normalizeCorrelationId(
    input.correlationId ||
      input.context?.correlationId ||
      input.context?.correlation?.id,
  );
}

function resolveRequestId(
  input = {},
) {
  return normalizeString(
    input.requestId ||
      input.context?.requestId,
    {
      name:
        'requestId',
      maxLength:
        MAX_REFERENCE_LENGTH,
    },
  );
}

/**
 * =============================================================================
 * Dependency Invocation
 * =============================================================================
 */

async function invokeDependency(
  dependency,
  methods,
  args = [],
  {
    dependencyName =
      'dependency',
    required =
      true,
  } = {},
) {
  if (
    !dependency
  ) {
    if (!required) {
      return null;
    }

    throw new CommandDependencyError(
      `${dependencyName} is not configured.`,
      {
        code:
          'AIRTEL_COMMAND_DEPENDENCY_NOT_CONFIGURED',
      },
    );
  }

  if (
    isFunction(
      dependency,
    )
  ) {
    return dependency(
      ...args,
    );
  }

  for (
    const method of methods
  ) {
    if (
      isFunction(
        dependency[method],
      )
    ) {
      return dependency[
        method
      ](
        ...args,
      );
    }
  }

  if (!required) {
    return null;
  }

  throw new CommandDependencyError(
    `${dependencyName} exposes none of the supported methods.`,
    {
      code:
        'AIRTEL_COMMAND_DEPENDENCY_METHOD_UNAVAILABLE',
    },
  );
}

/**
 * =============================================================================
 * Command Center
 * =============================================================================
 */

class CommandCenter {
  constructor(
    options = {},
  ) {
    this.service =
      SERVICE_NAME;

    this.provider =
      PROVIDER;

    this.version =
      VERSION;

    this.repository =
      options.commandRepository ||
      options.repository ||
      null;

    this.idempotencyService =
      options.idempotencyService ||
      null;

    this.callbackIntelligenceService =
      options.callbackIntelligenceService ||
      null;

    this.aiDecisionEngine =
      options.aiDecisionEngine ||
      null;

    this.autonomousRouter =
      options.autonomousRouter ||
      null;

    this.analyticsPipeline =
      options.analyticsPipeline ||
      null;

    this.reconciliationService =
      options.reconciliationService ||
      null;

    this.providerHealthService =
      options.providerHealthService ||
      options.healthService ||
      null;

    this.approvalService =
      options.approvalService ||
      null;

    this.incidentService =
      options.incidentService ||
      null;

    this.retryService =
      options.retryService ||
      null;

    this.auditService =
      options.auditService ||
      null;

    this.eventPublisher =
      options.eventPublisher ||
      options.outbox ||
      null;

    this.observability =
      options.observability ||
      null;

    this.logger =
      options.logger ||
      null;

    this.clock =
      isFunction(
        options.clock,
      )
        ? options.clock
        : nowDate;

    this.maxRetryAttempts =
      normalizeNonNegativeInteger(
        options.maxRetryAttempts,
        {
          name:
            'maxRetryAttempts',
          defaultValue:
            DEFAULT_MAX_RETRY_ATTEMPTS,
          max:
            10,
        },
      );

    this.maxCommandPayloadBytes =
      normalizeNonNegativeInteger(
        options.maxCommandPayloadBytes,
        {
          name:
            'maxCommandPayloadBytes',
          defaultValue:
            DEFAULT_MAX_COMMAND_PAYLOAD_BYTES,
          max:
            1024 * 1024,
        },
      );

    this.metrics = {
      planned:
        0,

      approvalRequired:
        0,

      approved:
        0,

      dispatched:
        0,

      completed:
        0,

      failed:
        0,

      rejected:
        0,

      idempotentHits:
        0,

      dependencyFailures:
        0,
    };

    this.initialized =
      false;
  }

  /**
   * ---------------------------------------------------------------------------
   * Logging / Observability
   * ---------------------------------------------------------------------------
   */

  log(
    level,
    payload,
  ) {
    try {
      if (
        this.logger &&
        isFunction(
          this.logger[level],
        )
      ) {
        this.logger[level](
          payload,
        );

        return;
      }

      if (
        this.logger &&
        isFunction(
          this.logger.log,
        )
      ) {
        this.logger.log(
          level,
          payload,
        );
      }
    } catch {
      /**
       * Logging cannot alter command semantics.
       */
    }
  }

  observe(
    event,
    data = {},
  ) {
    try {
      if (
        this.observability &&
        isFunction(
          this.observability.increment,
        )
      ) {
        this.observability.increment(
          event,
          1,
          data,
        );
      }

      if (
        this.observability &&
        isFunction(
          this.observability.record,
        )
      ) {
        this.observability.record(
          event,
          data,
        );
      }
    } catch {
      /**
       * Telemetry is non-authoritative.
       */
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Command Policy
   * ---------------------------------------------------------------------------
   */

  getPolicy(
    commandType,
  ) {
    const normalized =
      normalizeCommandType(
        commandType,
      );

    return {
      commandType:
        normalized,
      ...COMMAND_POLICY[
        normalized
      ],
    };
  }

  requiresApproval(
    commandType,
    {
      riskLevel =
        RISK_LEVEL.LOW,
    } = {},
  ) {
    const policy =
      this.getPolicy(
        commandType,
      );

    /**
     * High/critical-risk operational or financial commands always require
     * an explicit approval boundary.
     */
    return Boolean(
      policy.approvalRequired ||
        riskLevel ===
          RISK_LEVEL.HIGH ||
        riskLevel ===
          RISK_LEVEL.CRITICAL,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Command Normalization
   * ---------------------------------------------------------------------------
   */

  normalizeCommand(
    input,
  ) {
    if (
      !isPlainObject(
        input,
      )
    ) {
      throw new CommandValidationError(
        'Command payload must be a plain object.',
        {
          code:
            'AIRTEL_COMMAND_INVALID_PAYLOAD',
        },
      );
    }

    const tenantId =
      resolveTenantId(
        input,
      );

    const commandType =
      normalizeCommandType(
        input.commandType ||
          input.type,
      );

    const correlationId =
      resolveCorrelationId(
        input,
      );

    const idempotencyKey =
      normalizeIdempotencyKey(
        input.idempotencyKey ||
          input.context?.idempotencyKey,
      );

    const requestId =
      resolveRequestId(
        input,
      );

    const targetReference =
      normalizeString(
        input.targetReference ||
          input.transactionId ||
          input.providerTransactionId ||
          input.callbackId ||
          input.entityId,
        {
          name:
            'targetReference',
          maxLength:
            MAX_REFERENCE_LENGTH,
        },
      );

    const reason =
      normalizeString(
        input.reason,
        {
          name:
            'reason',
          maxLength:
            MAX_REASON_LENGTH,
        },
      );

    const riskLevel =
      normalizeRiskLevel(
        input.riskLevel ||
          input.risk?.level,
      );

    const decision =
      normalizeDecision(
        input.decision,
      );

    const retryAttempt =
      normalizeNonNegativeInteger(
        input.retryAttempt ||
          input.attempt,
        {
          name:
            'retryAttempt',
          defaultValue:
            0,
          max:
            this.maxRetryAttempts,
        },
      );

    const amount =
      normalizeMoneyString(
        input.amount ??
          input.payload?.amount,
        'amount',
      );

    const amountMinor =
      normalizeMoneyString(
        input.amountMinor ??
          input.payload?.amountMinor,
        'amountMinor',
      );

    const currency =
      normalizeString(
        input.currency ||
          input.payload?.currency,
        {
          name:
            'currency',
          maxLength:
            16,
        },
      )?.toUpperCase() ||
      null;

    const safePayload =
      sanitize(
        input.payload ||
          input.data ||
          {},
      );

    const payloadHash =
      sha256(
        safePayload,
      );

    const commandId =
      normalizeString(
        input.commandId,
        {
          name:
            'commandId',
          maxLength:
            MAX_COMMAND_ID_LENGTH,
        },
      ) ||
      createCommandId(
        {
          tenantId,
          commandType,
          correlationId,
          idempotencyKey,
          targetReference,
          payloadHash,
        },
      );

    const approvalRequired =
      this.requiresApproval(
        commandType,
        {
          riskLevel,
        },
      );

    const approvalState =
      approvalRequired
        ? APPROVAL_STATE.REQUIRED
        : APPROVAL_STATE.NOT_REQUIRED;

    const policy =
      this.getPolicy(
        commandType,
      );

    const document = {
      provider:
        PROVIDER,

      service:
        this.service,

      version:
        this.version,

      commandId,

      commandType,

      commandClass:
        policy.class,

      tenantId,

      correlationId,

      requestId,

      idempotencyKey,

      targetReference,

      reason,

      decision,

      riskLevel,

      retryAttempt,

      amount,

      amountMinor,

      currency,

      approvalRequired,

      approvalState,

      financial:
        Boolean(
          policy.financial,
        ),

      payload:
        safePayload,

      payloadHash,

      status:
        approvalRequired
          ? COMMAND_STATUS.APPROVAL_REQUIRED
          : COMMAND_STATUS.PLANNED,

      createdAt:
        this.clock(),

      updatedAt:
        this.clock(),

      metadata:
        sanitize(
          input.metadata ||
            {},
        ),
    };

    return document;
  }

  /**
   * ---------------------------------------------------------------------------
   * Payload Bound
   * ---------------------------------------------------------------------------
   */

  assertPayloadSize(
    command,
  ) {
    const serialized =
      stableStringify(
        command,
      );

    const bytes =
      Buffer.byteLength(
        serialized,
        'utf8',
      );

    if (
      bytes >
      this.maxCommandPayloadBytes
    ) {
      throw new CommandValidationError(
        'Command payload exceeds the configured size limit.',
        {
          code:
            'AIRTEL_COMMAND_PAYLOAD_TOO_LARGE',
        },
      );
    }

    return bytes;
  }

  /**
   * ---------------------------------------------------------------------------
   * Idempotency
   * ---------------------------------------------------------------------------
   */

  async resolveIdempotency(
    command,
    options = {},
  ) {
    if (
      !command.idempotencyKey
    ) {
      return null;
    }

    if (
      !this.idempotencyService
    ) {
      return null;
    }

    try {
      const existing =
        await invokeDependency(
          this.idempotencyService,
          [
            'get',
            'find',
            'lookup',
            'findByKey',
            'resolve',
          ],
          [
            command.tenantId,
            command.idempotencyKey,
            {
              commandType:
                command.commandType,
              ...options,
            },
          ],
          {
            dependencyName:
              'idempotencyService',
            required:
              false,
          },
        );

      if (
        existing
      ) {
        this.metrics.idempotentHits +=
          1;
      }

      return (
        existing ||
        null
      );
    } catch (error) {
      /**
       * Idempotency lookup failure is not ignored for commands that can cause
       * consequential side effects. Fail closed rather than risking duplicate
       * execution.
       */
      if (
        command.financial ||
        command.approvalRequired
      ) {
        throw new CommandDependencyError(
          'Unable to verify command idempotency state.',
          {
            code:
              'AIRTEL_COMMAND_IDEMPOTENCY_CHECK_FAILED',
            tenantId:
              command.tenantId,
            commandId:
              command.commandId,
            cause:
              error,
          },
        );
      }

      return null;
    }
  }

  async reserveIdempotency(
    command,
    options = {},
  ) {
    if (
      !command.idempotencyKey ||
      !this.idempotencyService
    ) {
      return null;
    }

    return invokeDependency(
      this.idempotencyService,
      [
        'reserve',
        'create',
        'set',
        'put',
        'claim',
      ],
      [
        command.tenantId,
        command.idempotencyKey,
        {
          commandId:
            command.commandId,
          commandType:
            command.commandType,
          payloadHash:
            command.payloadHash,
          ...options,
        },
      ],
      {
        dependencyName:
          'idempotencyService',
        required:
          false,
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Persist Planning State
   * ---------------------------------------------------------------------------
   */

  async persistCommand(
    command,
    options = {},
  ) {
    if (
      !this.repository
    ) {
      return command;
    }

    try {
      return await invokeDependency(
        this.repository,
        [
          'create',
          'save',
          'insert',
          'upsert',
          'store',
        ],
        [
          command,
          options,
        ],
        {
          dependencyName:
            'commandRepository',
          required:
            false,
        },
      );
    } catch (error) {
      this.metrics.dependencyFailures +=
        1;

      /**
       * Command state persistence is authoritative for operational workflows.
       * Failing silently would make control-plane state unreliable.
       */
      throw new CommandDependencyError(
        'Command persistence failed.',
        {
          code:
            'AIRTEL_COMMAND_PERSISTENCE_FAILED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
          cause:
            error,
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Audit / Event Publishing
   * ---------------------------------------------------------------------------
   */

  async recordAudit(
    action,
    command,
    extra = {},
  ) {
    if (
      !this.auditService
    ) {
      return null;
    }

    const payload =
      sanitize(
        {
          provider:
            PROVIDER,

          service:
            this.service,

          action,

          commandId:
            command.commandId,

          commandType:
            command.commandType,

          tenantId:
            command.tenantId,

          correlationId:
            command.correlationId,

          status:
            command.status,

          riskLevel:
            command.riskLevel,

          approvalState:
            command.approvalState,

          targetReference:
            command.targetReference,

          ...extra,
        },
      );

    try {
      return await invokeDependency(
        this.auditService,
        [
          'record',
          'recordEvent',
          'audit',
          'append',
        ],
        [
          payload,
        ],
        {
          dependencyName:
            'auditService',
          required:
            false,
        },
      );
    } catch (error) {
      /**
       * Audit failures must be observable but must not invent a success state.
       */
      this.log(
        'error',
        {
          service:
            this.service,
          event:
            'command.audit.failed',
          action,
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
          code:
            error?.code ||
            'AUDIT_ERROR',
        },
      );

      this.observe(
        'airtel.command.audit.failure',
        {
          tenantId:
            command.tenantId,
          commandType:
            command.commandType,
        },
      );

      return null;
    }
  }

  async publishEvent(
    eventType,
    command,
    extra = {},
  ) {
    if (
      !this.eventPublisher
    ) {
      return null;
    }

    const envelope =
      sanitize(
        {
          eventType,

          provider:
            PROVIDER,

          service:
            this.service,

          version:
            this.version,

          commandId:
            command.commandId,

          commandType:
            command.commandType,

          tenantId:
            command.tenantId,

          correlationId:
            command.correlationId,

          status:
            command.status,

          targetReference:
            command.targetReference,

          timestamp:
            this.clock(),

          ...extra,
        },
      );

    try {
      return await invokeDependency(
        this.eventPublisher,
        [
          'publish',
          'emit',
          'enqueue',
          'append',
          'add',
        ],
        [
          envelope,
        ],
        {
          dependencyName:
            'eventPublisher',
          required:
            false,
        },
      );
    } catch (error) {
      /**
       * Events are non-authoritative unless the caller explicitly makes them
       * part of an outbox transaction.
       */
      this.log(
        'error',
        {
          service:
            this.service,
          event:
            'command.event.publish.failed',
          eventType,
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
          code:
            error?.code ||
            'EVENT_PUBLISH_ERROR',
        },
      );

      return null;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Plan
   * ---------------------------------------------------------------------------
   *
   * Planning never executes the command.
   */

  async plan(
    input,
    options = {},
  ) {
    const command =
      this.normalizeCommand(
        input,
      );

    this.assertPayloadSize(
      command,
    );

    const existing =
      await this.resolveIdempotency(
        command,
        options,
      );

    if (
      existing
    ) {
      return {
        ...existing,
        idempotent:
          true,
        reused:
          true,
      };
    }

    const reserved =
      await this.reserveIdempotency(
        command,
        {
          mode:
            'PLAN',
        },
      );

    if (
      reserved &&
      reserved.conflict
    ) {
      this.metrics.idempotentHits +=
        1;

      return {
        ...reserved.existing,
        idempotent:
          true,
        reused:
          true,
      };
    }

    await this.persistCommand(
      command,
      options,
    );

    this.metrics.planned +=
      1;

    if (
      command.approvalRequired
    ) {
      this.metrics.approvalRequired +=
        1;
    }

    await this.recordAudit(
      'COMMAND_PLANNED',
      command,
    );

    await this.publishEvent(
      'AIRTEL_COMMAND_PLANNED',
      command,
    );

    this.observe(
      'airtel.command.planned',
      {
        tenantId:
          command.tenantId,
        commandType:
          command.commandType,
        approvalRequired:
          command.approvalRequired,
      },
    );

    return {
      ...command,
      idempotent:
        false,
      reused:
        false,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Approval
   * ---------------------------------------------------------------------------
   */

  async approve(
    input,
    options = {},
  ) {
    const command =
      await this.resolveCommand(
        input,
        options,
      );

    if (
      !command.approvalRequired
    ) {
      return {
        ...command,
        approvalState:
          APPROVAL_STATE.NOT_REQUIRED,
        status:
          COMMAND_STATUS.PLANNED,
      };
    }

    if (
      !this.approvalService
    ) {
      throw new CommandApprovalError(
        'An approval service is required for this command.',
        {
          code:
            'AIRTEL_COMMAND_APPROVAL_SERVICE_REQUIRED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    const approvalContext =
      sanitize(
        {
          provider:
            PROVIDER,

          service:
            this.service,

          commandId:
            command.commandId,

          commandType:
            command.commandType,

          tenantId:
            command.tenantId,

          correlationId:
            command.correlationId,

          riskLevel:
            command.riskLevel,

          financial:
            command.financial,

          targetReference:
            command.targetReference,

          reason:
            command.reason,

          metadata:
            input.metadata ||
            options.metadata ||
            {},
        },
      );

    let result;

    try {
      result =
        await invokeDependency(
          this.approvalService,
          [
            'authorize',
            'approve',
            'requestApproval',
            'check',
          ],
          [
            approvalContext,
          ],
          {
            dependencyName:
              'approvalService',
            required:
              true,
          },
        );
    } catch (error) {
      throw new CommandApprovalError(
        'Command approval could not be established.',
        {
          code:
            'AIRTEL_COMMAND_APPROVAL_FAILED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
          cause:
            error,
        },
      );
    }

    const approved =
      result === true ||
      result?.approved === true ||
      result?.authorized === true ||
      result?.status ===
        'APPROVED';

    if (
      !approved
    ) {
      this.metrics.rejected +=
        1;

      const rejectedCommand =
        {
          ...command,
          status:
            COMMAND_STATUS.REJECTED,
          approvalState:
            APPROVAL_STATE.REJECTED,
          updatedAt:
            this.clock(),
        };

      await this.persistCommand(
        rejectedCommand,
        options,
      );

      await this.recordAudit(
        'COMMAND_REJECTED',
        rejectedCommand,
        {
          approval:
            sanitize(
              result || {},
            ),
        },
      );

      await this.publishEvent(
        'AIRTEL_COMMAND_REJECTED',
        rejectedCommand,
      );

      throw new CommandApprovalError(
        'Command approval was not granted.',
        {
          code:
            'AIRTEL_COMMAND_NOT_APPROVED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    const approvedCommand =
      {
        ...command,

        status:
          COMMAND_STATUS.APPROVED,

        approvalState:
          APPROVAL_STATE.APPROVED,

        approvalReference:
          normalizeString(
            result?.approvalReference ||
              result?.reference ||
              result?.approvalId,
            {
              name:
                'approvalReference',
              maxLength:
                MAX_REFERENCE_LENGTH,
            },
          ),

        approvedAt:
          this.clock(),

        approvedBy:
          normalizeString(
            result?.approvedBy ||
              options.approvedBy ||
              options.actorId,
            {
              name:
                'approvedBy',
              maxLength:
                MAX_REFERENCE_LENGTH,
            },
          ),

        updatedAt:
          this.clock(),
      };

    await this.persistCommand(
      approvedCommand,
      options,
    );

    this.metrics.approved +=
      1;

    await this.recordAudit(
      'COMMAND_APPROVED',
      approvedCommand,
    );

    await this.publishEvent(
      'AIRTEL_COMMAND_APPROVED',
      approvedCommand,
    );

    return approvedCommand;
  }

  /**
   * ---------------------------------------------------------------------------
   * Resolve Existing Command
   * ---------------------------------------------------------------------------
   */

  async resolveCommand(
    input,
    options = {},
  ) {
    const command =
      isPlainObject(input)
        ? this.normalizeCommand(
            input,
          )
        : null;

    if (
      command
    ) {
      if (
        this.repository
      ) {
        const existing =
          await invokeDependency(
            this.repository,
            [
              'findById',
              'getById',
              'findOne',
              'get',
            ],
            [
              command.tenantId,
              command.commandId,
              options,
            ],
            {
              dependencyName:
                'commandRepository',
              required:
                false,
            },
          );

        if (
          existing
        ) {
          return existing;
        }
      }

      return command;
    }

    throw new CommandValidationError(
      'A command payload or command reference is required.',
      {
        code:
          'AIRTEL_COMMAND_REFERENCE_REQUIRED',
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Intelligence Analysis
   * ---------------------------------------------------------------------------
   */

  async analyzeCallback(
    input,
    options = {},
  ) {
    const command =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.CALLBACK_ANALYSIS,
        },
        options,
      );

    return this.invokeAnalysis(
      command,
      this.callbackIntelligenceService,
      [
        'analyzeEvent',
        'analyze',
        'processEvent',
      ],
      input,
      options,
    );
  }

  async invokeAnalysis(
    command,
    service,
    methods,
    input,
    options,
  ) {
    if (
      !service
    ) {
      throw new CommandDependencyError(
        'Callback/intelligence analysis service is not configured.',
        {
          code:
            'AIRTEL_COMMAND_INTELLIGENCE_SERVICE_REQUIRED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    try {
      const result =
        await invokeDependency(
          service,
          methods,
          [
            {
              ...sanitize(
                input,
              ),
              tenantId:
                command.tenantId,
              correlationId:
                command.correlationId,
              commandId:
                command.commandId,
            },
            options,
          ],
          {
            dependencyName:
              'intelligenceService',
            required:
              true,
          },
        );

      const enriched =
        {
          ...command,

          status:
            COMMAND_STATUS.COMPLETED,

          analysis:
            sanitize(
              result || {},
            ),

          completedAt:
            this.clock(),

          updatedAt:
            this.clock(),
        };

      await this.persistCommand(
        enriched,
        options,
      );

      this.metrics.completed +=
        1;

      await this.recordAudit(
        'COMMAND_ANALYSIS_COMPLETED',
        enriched,
      );

      return enriched;
    } catch (error) {
      return this.failCommand(
        command,
        error,
        options,
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Provider Health
   * ---------------------------------------------------------------------------
   */

  async inspectProviderHealth(
    input,
    options = {},
  ) {
    const command =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.PROVIDER_HEALTH,
        },
        options,
      );

    if (
      !this.providerHealthService
    ) {
      throw new CommandDependencyError(
        'Provider health service is not configured.',
        {
          code:
            'AIRTEL_COMMAND_PROVIDER_HEALTH_SERVICE_REQUIRED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    try {
      const result =
        await invokeDependency(
          this.providerHealthService,
          [
            'health',
            'check',
            'status',
            'getHealth',
          ],
          [
            {
              provider:
                PROVIDER,
              tenantId:
                command.tenantId,
              correlationId:
                command.correlationId,
            },
            options,
          ],
          {
            dependencyName:
              'providerHealthService',
            required:
              true,
          },
        );

      const completed =
        {
          ...command,

          status:
            COMMAND_STATUS.COMPLETED,

          result:
            sanitize(
              result || {},
            ),

          completedAt:
            this.clock(),

          updatedAt:
            this.clock(),
        };

      await this.persistCommand(
        completed,
        options,
      );

      this.metrics.completed +=
        1;

      return completed;
    } catch (error) {
      return this.failCommand(
        command,
        error,
        options,
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Analytics Refresh
   * ---------------------------------------------------------------------------
   */

  async refreshAnalytics(
    input,
    options = {},
  ) {
    const command =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.ANALYTICS_REFRESH,
        },
        options,
      );

    if (
      !this.analyticsPipeline
    ) {
      throw new CommandDependencyError(
        'Analytics pipeline is not configured.',
        {
          code:
            'AIRTEL_COMMAND_ANALYTICS_PIPELINE_REQUIRED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    return this.executeAnalysisDependency(
      command,
      this.analyticsPipeline,
      [
        'refresh',
        'run',
        'execute',
        'process',
      ],
      input,
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Reconciliation
   * ---------------------------------------------------------------------------
   */

  async reconcile(
    input,
    options = {},
  ) {
    const command =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.RECONCILIATION,
        },
        options,
      );

    if (
      !this.reconciliationService
    ) {
      throw new CommandDependencyError(
        'Reconciliation service is not configured.',
        {
          code:
            'AIRTEL_COMMAND_RECONCILIATION_SERVICE_REQUIRED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    return this.executeAnalysisDependency(
      command,
      this.reconciliationService,
      [
        'reconcile',
        'run',
        'execute',
        'start',
      ],
      input,
      options,
    );
  }

  async executeAnalysisDependency(
    command,
    dependency,
    methods,
    input,
    options,
  ) {
    try {
      const result =
        await invokeDependency(
          dependency,
          methods,
          [
            {
              ...sanitize(
                input,
              ),
              tenantId:
                command.tenantId,
              correlationId:
                command.correlationId,
              commandId:
                command.commandId,
            },
            options,
          ],
          {
            dependencyName:
              'analysisDependency',
            required:
              true,
          },
        );

      const completed =
        {
          ...command,

          status:
            COMMAND_STATUS.COMPLETED,

          result:
            sanitize(
              result || {},
            ),

          completedAt:
            this.clock(),

          updatedAt:
            this.clock(),
        };

      await this.persistCommand(
        completed,
        options,
      );

      this.metrics.completed +=
        1;

      return completed;
    } catch (error) {
      return this.failCommand(
        command,
        error,
        options,
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Autonomous Recommendation
   * ---------------------------------------------------------------------------
   */

  async recommend(
    input,
    options = {},
  ) {
    if (
      !this.aiDecisionEngine
    ) {
      throw new CommandDependencyError(
        'AI decision engine is not configured.',
        {
          code:
            'AIRTEL_COMMAND_AI_ENGINE_REQUIRED',
        },
      );
    }

    const tenantId =
      resolveTenantId(
        input,
      );

    const correlationId =
      resolveCorrelationId(
        input,
      );

    const safeInput =
      sanitize(
        input,
      );

    try {
      const result =
        await invokeDependency(
          this.aiDecisionEngine,
          [
            'decide',
            'recommend',
            'evaluate',
            'assess',
          ],
          [
            {
              ...safeInput,
              provider:
                PROVIDER,
              tenantId,
              correlationId,
              advisoryOnly:
                true,
            },
            options,
          ],
          {
            dependencyName:
              'aiDecisionEngine',
            required:
              true,
          },
        );

      /**
       * The command center normalizes AI output to advisory semantics.
       */
      return {
        provider:
          PROVIDER,

        tenantId,

        correlationId,

        advisoryOnly:
          true,

        decision:
          normalizeDecision(
            result?.decision ||
              result?.recommendation,
          ),

        riskLevel:
          normalizeRiskLevel(
            result?.riskLevel ||
              result?.risk?.level,
          ),

        rationale:
          normalizeString(
            result?.rationale ||
              result?.reason,
            {
              name:
                'rationale',
              maxLength:
                MAX_REASON_LENGTH,
            },
          ),

        result:
          sanitize(
            result || {},
          ),

        commandExecutionRequired:
          true,

        financialAuthority:
          false,
      };
    } catch (error) {
      throw new CommandDependencyError(
        'AI decision analysis failed.',
        {
          code:
            'AIRTEL_COMMAND_AI_ANALYSIS_FAILED',
          tenantId,
          correlationId,
          cause:
            error,
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Autonomous Router Integration
   * ---------------------------------------------------------------------------
   */

  async route(
    input,
    options = {},
  ) {
    if (
      !this.autonomousRouter
    ) {
      throw new CommandDependencyError(
        'Autonomous router is not configured.',
        {
          code:
            'AIRTEL_COMMAND_AUTONOMOUS_ROUTER_REQUIRED',
        },
      );
    }

    const tenantId =
      resolveTenantId(
        input,
      );

    const correlationId =
      resolveCorrelationId(
        input,
      );

    try {
      const result =
        await invokeDependency(
          this.autonomousRouter,
          [
            'route',
            'decide',
            'resolve',
          ],
          [
            {
              ...sanitize(
                input,
              ),
              provider:
                PROVIDER,
              tenantId,
              correlationId,
              execution:
                'NOT_EXECUTED',
            },
            options,
          ],
          {
            dependencyName:
              'autonomousRouter',
            required:
              true,
          },
        );

      /**
       * Route selection is not execution.
       */
      return {
        provider:
          PROVIDER,

        tenantId,

        correlationId,

        advisoryOnly:
          result?.advisoryOnly !==
          false,

        executionStarted:
          false,

        route:
          sanitize(
            result || {},
          ),
      };
    } catch (error) {
      throw new CommandDependencyError(
        'Autonomous route evaluation failed.',
        {
          code:
            'AIRTEL_COMMAND_ROUTING_FAILED',
          tenantId,
          correlationId,
          cause:
            error,
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Retry Queue
   * ---------------------------------------------------------------------------
   *
   * Retry commands are deliberately separated from execution.
   */

  async retryQueue(
    input,
    options = {},
  ) {
    const planned =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.RETRY_QUEUE,
          riskLevel:
            input.riskLevel ||
            RISK_LEVEL.MEDIUM,
        },
        options,
      );

    const approved =
      await this.approve(
        planned,
        options,
      );

    if (
      approved.status !==
      COMMAND_STATUS.APPROVED
    ) {
      throw new CommandApprovalError(
        'Retry command is not approved.',
        {
          code:
            'AIRTEL_COMMAND_RETRY_NOT_APPROVED',
          tenantId:
            approved.tenantId,
          commandId:
            approved.commandId,
        },
      );
    }

    return this.dispatchOperationalCommand(
      approved,
      this.retryService,
      [
        'retry',
        'enqueue',
        'schedule',
        'execute',
      ],
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Repair Workflow
   * ---------------------------------------------------------------------------
   */

  async repair(
    input,
    options = {},
  ) {
    const planned =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.REPAIR_WORKFLOW,
          riskLevel:
            input.riskLevel ||
            RISK_LEVEL.HIGH,
        },
        options,
      );

    const approved =
      await this.approve(
        planned,
        options,
      );

    return this.dispatchOperationalCommand(
      approved,
      this.reconciliationService ||
        this.retryService,
      [
        'repair',
        'repairWorkflow',
        'executeRepair',
        'execute',
      ],
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Financial Command Boundary
   * ---------------------------------------------------------------------------
   *
   * The Command Center can request a financial workflow only through an
   * authoritative financial/payment dependency.
   *
   * It cannot execute direct provider HTTP or ledger operations.
   */

  async processPayment(
    input,
    options = {},
  ) {
    const planned =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.PROCESS_PAYMENT,
          riskLevel:
            input.riskLevel ||
            RISK_LEVEL.HIGH,
        },
        options,
      );

    /**
     * Explicitly require approval even when policy already says so.
     */
    const approved =
      await this.approve(
        planned,
        options,
      );

    return this.dispatchFinancialCommand(
      approved,
      input,
      options,
    );
  }

  async dispatchFinancialCommand(
    command,
    input,
    options,
  ) {
    /**
     * Prefer the canonical payment execution boundary supplied by the
     * composition root. Several names are accepted for compatibility, but the
     * Command Center does not import arbitrary provider implementations here.
     */
    const financialService =
      options.financialTransactionService ||
      options.paymentExecutionService ||
      options.paymentService ||
      null;

    if (
      !financialService
    ) {
      throw new CommandDependencyError(
        'An authoritative financial/payment execution service is required.',
        {
          code:
            'AIRTEL_COMMAND_FINANCIAL_EXECUTOR_REQUIRED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    /**
     * Financial execution receives the sanitized command context. Financial
     * authority remains with the injected service.
     */
    return this.dispatchOperationalCommand(
      command,
      financialService,
      [
        'process',
        'execute',
        'processPayment',
        'createTransaction',
      ],
      {
        ...options,
        financialContext:
          {
            provider:
              PROVIDER,
            tenantId:
              command.tenantId,
            correlationId:
              command.correlationId,
            commandId:
              command.commandId,

            /**
             * Preserve exact money strings.
             */
            amount:
              normalizeMoneyString(
                input.amount ??
                  command.amount,
                'amount',
              ),

            amountMinor:
              normalizeMoneyString(
                input.amountMinor ??
                  command.amountMinor,
                'amountMinor',
              ),

            currency:
              command.currency,

            /**
             * The Command Center is never the ledger authority.
             */
            ledgerAuthority:
              'AUTHORITATIVE_FINANCIAL_SERVICE',
          },
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Operational Dispatch
   * ---------------------------------------------------------------------------
   */

  async dispatchOperationalCommand(
    command,
    dependency,
    methods,
    options = {},
  ) {
    if (
      !dependency
    ) {
      throw new CommandDependencyError(
        'Command execution dependency is not configured.',
        {
          code:
            'AIRTEL_COMMAND_EXECUTOR_NOT_CONFIGURED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    if (
      command.approvalRequired &&
      command.approvalState !==
        APPROVAL_STATE.APPROVED
    ) {
      throw new CommandApprovalError(
        'Command cannot be dispatched before approval.',
        {
          code:
            'AIRTEL_COMMAND_APPROVAL_GATE_BLOCKED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    const dispatching =
      {
        ...command,

        status:
          COMMAND_STATUS.DISPATCHED,

        dispatchedAt:
          this.clock(),

        updatedAt:
          this.clock(),
      };

    await this.persistCommand(
      dispatching,
      options,
    );

    this.metrics.dispatched +=
      1;

    await this.recordAudit(
      'COMMAND_DISPATCHED',
      dispatching,
    );

    await this.publishEvent(
      'AIRTEL_COMMAND_DISPATCHED',
      dispatching,
    );

    try {
      const result =
        await invokeDependency(
          dependency,
          methods,
          [
            {
              command:
                sanitize(
                  dispatching,
                ),

              provider:
                PROVIDER,

              tenantId:
                command.tenantId,

              correlationId:
                command.correlationId,

              commandId:
                command.commandId,
            },

            options,
          ],
          {
            dependencyName:
              'commandExecutor',
            required:
              true,
          },
        );

      const completed =
        {
          ...dispatching,

          status:
            COMMAND_STATUS.COMPLETED,

          executionResult:
            sanitize(
              result || {},
            ),

          completedAt:
            this.clock(),

          updatedAt:
            this.clock(),
        };

      await this.persistCommand(
        completed,
        options,
      );

      this.metrics.completed +=
        1;

      await this.recordAudit(
        'COMMAND_COMPLETED',
        completed,
      );

      await this.publishEvent(
        'AIRTEL_COMMAND_COMPLETED',
        completed,
      );

      return completed;
    } catch (error) {
      return this.failCommand(
        dispatching,
        error,
        options,
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Manual Review
   * ---------------------------------------------------------------------------
   */

  async createManualReview(
    input,
    options = {},
  ) {
    const command =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.MANUAL_REVIEW,
          riskLevel:
            input.riskLevel ||
            RISK_LEVEL.MEDIUM,
        },
        options,
      );

    const reviewService =
      options.reviewService ||
      this.incidentService;

    if (
      !reviewService
    ) {
      return {
        ...command,
        status:
          COMMAND_STATUS.COMPLETED,
        review:
          {
            created:
              false,
            deferred:
              true,
            reason:
              'No review service configured.',
          },
      };
    }

    return this.dispatchOperationalCommand(
      command,
      reviewService,
      [
        'createReview',
        'openReview',
        'review',
        'createIncident',
      ],
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Escalation
   * ---------------------------------------------------------------------------
   */

  async escalate(
    input,
    options = {},
  ) {
    const command =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.ESCALATION,
          riskLevel:
            input.riskLevel ||
            RISK_LEVEL.HIGH,
        },
        options,
      );

    if (
      !this.incidentService
    ) {
      return {
        ...command,
        status:
          COMMAND_STATUS.COMPLETED,
        escalation:
          {
            created:
              false,
            deferred:
              true,
            reason:
              'Incident service is not configured.',
          },
      };
    }

    return this.dispatchOperationalCommand(
      command,
      this.incidentService,
      [
        'escalate',
        'createIncident',
        'openIncident',
        'notify',
      ],
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Incident
   * ---------------------------------------------------------------------------
   */

  async createIncident(
    input,
    options = {},
  ) {
    const command =
      await this.plan(
        {
          ...input,
          commandType:
            COMMAND_TYPE.INCIDENT,
          riskLevel:
            input.riskLevel ||
            RISK_LEVEL.HIGH,
        },
        options,
      );

    if (
      !this.incidentService
    ) {
      throw new CommandDependencyError(
        'Incident service is not configured.',
        {
          code:
            'AIRTEL_COMMAND_INCIDENT_SERVICE_REQUIRED',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
        },
      );
    }

    return this.dispatchOperationalCommand(
      command,
      this.incidentService,
      [
        'createIncident',
        'openIncident',
        'create',
        'open',
      ],
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Generic Execute
   * ---------------------------------------------------------------------------
   *
   * Generic command execution is deliberately restricted to known command
   * types. Callers cannot provide an arbitrary method/function to execute.
   */

  async execute(
    input,
    options = {},
  ) {
    const planned =
      await this.plan(
        input,
        options,
      );

    switch (
      planned.commandType
    ) {
      case COMMAND_TYPE.INSPECT:
        return planned;

      case COMMAND_TYPE.CALLBACK_ANALYSIS:
        return this.invokeAnalysis(
          planned,
          this.callbackIntelligenceService,
          [
            'analyzeEvent',
            'analyze',
            'processEvent',
          ],
          input,
          options,
        );

      case COMMAND_TYPE.PROVIDER_HEALTH:
        return this.inspectProviderHealth(
          input,
          options,
        );

      case COMMAND_TYPE.ANALYTICS_REFRESH:
        return this.refreshAnalytics(
          input,
          options,
        );

      case COMMAND_TYPE.RECONCILIATION:
        return this.reconcile(
          input,
          options,
        );

      case COMMAND_TYPE.RETRY_QUEUE:
        return this.retryQueue(
          input,
          options,
        );

      case COMMAND_TYPE.REPAIR_WORKFLOW:
        return this.repair(
          input,
          options,
        );

      case COMMAND_TYPE.MANUAL_REVIEW:
        return this.createManualReview(
          input,
          options,
        );

      case COMMAND_TYPE.ESCALATION:
        return this.escalate(
          input,
          options,
        );

      case COMMAND_TYPE.INCIDENT:
        return this.createIncident(
          input,
          options,
        );

      case COMMAND_TYPE.PROCESS_PAYMENT:
      case COMMAND_TYPE.DISPATCH:
        return this.processPayment(
          input,
          options,
        );

      default:
        throw new CommandValidationError(
          `No execution handler exists for "${planned.commandType}".`,
          {
            code:
              'AIRTEL_COMMAND_EXECUTION_HANDLER_NOT_FOUND',
          },
        );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Failure
   * ---------------------------------------------------------------------------
   */

  async failCommand(
    command,
    error,
    options = {},
  ) {
    this.metrics.failed +=
      1;

    const failed =
      {
        ...command,

        status:
          COMMAND_STATUS.FAILED,

        failure:
          {
            code:
              error?.code ||
              'AIRTEL_COMMAND_EXECUTION_FAILED',

            message:
              normalizeString(
                error?.message,
                {
                  name:
                    'failureMessage',
                  maxLength:
                    MAX_REASON_LENGTH,
                },
              ) ||
              'Command execution failed.',

            retryable:
              error?.retryable === true,
          },

        failedAt:
          this.clock(),

        updatedAt:
          this.clock(),
      };

    try {
      await this.persistCommand(
        failed,
        options,
      );

      await this.recordAudit(
        'COMMAND_FAILED',
        failed,
      );

      await this.publishEvent(
        'AIRTEL_COMMAND_FAILED',
        failed,
      );
    } catch (persistenceError) {
      this.log(
        'error',
        {
          service:
            this.service,
          event:
            'command.failure.persistence.failed',
          tenantId:
            command.tenantId,
          commandId:
            command.commandId,
          code:
            persistenceError?.code ||
            'PERSISTENCE_FAILURE',
        },
      );
    }

    const normalized =
      error instanceof
      CommandCenterError
        ? error
        : new CommandDependencyError(
            'Airtel command execution failed.',
            {
              code:
                'AIRTEL_COMMAND_EXECUTION_FAILED',
              tenantId:
                command.tenantId,
              commandId:
                command.commandId,
              correlationId:
                command.correlationId,
              cause:
                error,
              retryable:
                error?.retryable === true,
            },
          );

    normalized.command =
      failed;

    return {
      ...failed,
      error:
        {
          code:
            normalized.code,
          message:
            normalized.message,
          retryable:
            normalized.retryable,
        },
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Cancellation
   * ---------------------------------------------------------------------------
   */

  async cancel(
    input,
    options = {},
  ) {
    const command =
      await this.resolveCommand(
        input,
        options,
      );

    if (
      [
        COMMAND_STATUS.COMPLETED,
        COMMAND_STATUS.CANCELLED,
        COMMAND_STATUS.EXPIRED,
      ].includes(
        command.status,
      )
    ) {
      return command;
    }

    const cancelled =
      {
        ...command,

        status:
          COMMAND_STATUS.CANCELLED,

        cancelledAt:
          this.clock(),

        updatedAt:
          this.clock(),

        cancellationReason:
          normalizeString(
            input.reason ||
              options.reason,
            {
              name:
                'cancellationReason',
              maxLength:
                MAX_REASON_LENGTH,
            },
          ),
      };

    await this.persistCommand(
      cancelled,
      options,
    );

    await this.recordAudit(
      'COMMAND_CANCELLED',
      cancelled,
    );

    await this.publishEvent(
      'AIRTEL_COMMAND_CANCELLED',
      cancelled,
    );

    return cancelled;
  }

  /**
   * ---------------------------------------------------------------------------
   * Query
   * ---------------------------------------------------------------------------
   */

  async get(
    tenantId,
    commandId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedCommandId =
      normalizeString(
        commandId,
        {
          name:
            'commandId',
          required:
            true,
          maxLength:
            MAX_COMMAND_ID_LENGTH,
        },
      );

    if (
      this.repository
    ) {
      const existing =
        await invokeDependency(
          this.repository,
          [
            'findById',
            'getById',
            'findOne',
            'get',
          ],
          [
            normalizedTenantId,
            normalizedCommandId,
            options,
          ],
          {
            dependencyName:
              'commandRepository',
            required:
              false,
          },
        );

      if (
        existing
      ) {
        return existing;
      }
    }

    return null;
  }

  async list(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const limit =
      normalizeNonNegativeInteger(
        options.limit,
        {
          name:
            'limit',
          defaultValue:
            50,
          max:
            200,
        },
      );

    const skip =
      normalizeNonNegativeInteger(
        options.skip,
        {
          name:
            'skip',
          defaultValue:
            0,
        },
      );

    const filter =
      sanitize(
        options.filter ||
          {},
      );

    /**
     * Tenant is always overwritten with the authoritative method argument.
     */
    filter.tenantId =
      normalizedTenantId;

    if (
      !this.repository
    ) {
      return {
        tenantId:
          normalizedTenantId,
        items:
          [],
        limit,
        skip,
        nextSkip:
          null,
      };
    }

    const result =
      await invokeDependency(
        this.repository,
        [
          'list',
          'find',
          'query',
        ],
        [
          filter,
          {
            ...options,
            limit,
            skip,
          },
        ],
        {
          dependencyName:
            'commandRepository',
          required:
            false,
        },
      );

    const items =
      Array.isArray(result)
        ? result
        : result?.items ||
          result?.documents ||
          [];

    return {
      tenantId:
        normalizedTenantId,

      items,

      limit,

      skip,

      nextSkip:
        items.length ===
        limit
          ? skip + limit
          : null,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Health
   * ---------------------------------------------------------------------------
   */

  async health(
    options = {},
  ) {
    const started =
      Date.now();

    const checks = {
      commandPolicy:
        true,

      tenantIsolation:
        true,

      repositoryConfigured:
        Boolean(
          this.repository,
        ),

      idempotencyConfigured:
        Boolean(
          this.idempotencyService,
        ),

      callbackIntelligenceConfigured:
        Boolean(
          this.callbackIntelligenceService,
        ),

      analyticsConfigured:
        Boolean(
          this.analyticsPipeline,
        ),

      reconciliationConfigured:
        Boolean(
          this.reconciliationService,
        ),

      aiConfigured:
        Boolean(
          this.aiDecisionEngine,
        ),

      autonomousRouterConfigured:
        Boolean(
          this.autonomousRouter,
        ),

      approvalConfigured:
        Boolean(
          this.approvalService,
        ),

      incidentConfigured:
        Boolean(
          this.incidentService,
        ),
    };

    let repositoryHealthy =
      null;

    if (
      this.repository
    ) {
      try {
        if (
          isFunction(
            this.repository.health,
          )
        ) {
          const result =
            await invokeDependency(
              this.repository,
              [
                'health',
              ],
              [
                options,
              ],
              {
                dependencyName:
                  'commandRepository',
                required:
                  false,
              },
            );

          repositoryHealthy =
            result?.healthy !==
              false &&
            result?.status !==
              'DOWN';
        } else if (
          isFunction(
            this.repository.ping,
          )
        ) {
          repositoryHealthy =
            (await invokeDependency(
              this.repository,
              [
                'ping',
              ],
              [
                options,
              ],
              {
                dependencyName:
                  'commandRepository',
                required:
                  false,
              },
            )) !== false;
        } else {
          repositoryHealthy =
            true;
        }
      } catch {
        repositoryHealthy =
          false;
      }
    }

    const criticalChecks =
      [
        checks.commandPolicy,
        checks.tenantIsolation,
      ];

    const healthy =
      criticalChecks.every(
        Boolean,
      );

    const degraded =
      !checks.approvalConfigured ||
      !checks.idempotencyConfigured ||
      (
        checks.repositoryConfigured &&
        repositoryHealthy ===
          false
      );

    return {
      service:
        this.service,

      provider:
        this.provider,

      version:
        this.version,

      status:
        !healthy
          ? 'DOWN'
          : degraded
            ? 'DEGRADED'
            : 'UP',

      healthy,

      checks: {
        ...checks,
        repositoryHealthy,
      },

      latencyMs:
        Date.now() -
        started,

      metrics:
        {
          ...this.metrics,
        },
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Diagnostics
   * ---------------------------------------------------------------------------
   */

  diagnostics() {
    return {
      service:
        this.service,

      provider:
        this.provider,

      version:
        this.version,

      initialized:
        this.initialized,

      dependencies: {
        repository:
          Boolean(
            this.repository,
          ),

        idempotency:
          Boolean(
            this.idempotencyService,
          ),

        callbackIntelligence:
          Boolean(
            this.callbackIntelligenceService,
          ),

        aiDecisionEngine:
          Boolean(
            this.aiDecisionEngine,
          ),

        autonomousRouter:
          Boolean(
            this.autonomousRouter,
          ),

        analyticsPipeline:
          Boolean(
            this.analyticsPipeline,
          ),

        reconciliationService:
          Boolean(
            this.reconciliationService,
          ),

        approvalService:
          Boolean(
            this.approvalService,
          ),

        incidentService:
          Boolean(
            this.incidentService,
          ),
      },

      policies: {
        commandCount:
          Object.keys(
            COMMAND_POLICY,
          ).length,

        financialExecutionDelegated:
          true,

        providerHttpExecutionDirectlyAllowed:
          false,

        ledgerMutationDirectlyAllowed:
          false,

        balanceMutationDirectlyAllowed:
          false,

        aiAdvisoryOnly:
          true,

        approvalRequiredForFinancialCommands:
          true,

        boundedRetryAttempts:
          this.maxRetryAttempts,
      },

      limits: {
        maxCommandPayloadBytes:
          this.maxCommandPayloadBytes,

        maxMetadataKeys:
          MAX_METADATA_KEYS,

        maxObjectDepth:
          MAX_OBJECT_DEPTH,

        maxArrayItems:
          MAX_ARRAY_ITEMS,
      },

      metrics:
        {
          ...this.metrics,
        },
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Initialization
   * ---------------------------------------------------------------------------
   */

  async initialize(
    options = {},
  ) {
    if (
      this.initialized
    ) {
      return {
        status:
          'READY',
      };
    }

    /**
     * Repository initialization is optional but supported when supplied.
     */
    if (
      this.repository &&
      isFunction(
        this.repository.initialize,
      )
    ) {
      await invokeDependency(
        this.repository,
        [
          'initialize',
        ],
        [
          options,
        ],
        {
          dependencyName:
            'commandRepository',
          required:
            false,
        },
      );
    }

    this.initialized =
      true;

    return {
      status:
        'READY',

      service:
        this.service,

      provider:
        this.provider,

      version:
        this.version,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Shutdown
   * ---------------------------------------------------------------------------
   */

  async close(
    options = {},
  ) {
    if (
      this.repository &&
      isFunction(
        this.repository.close,
      )
    ) {
      await invokeDependency(
        this.repository,
        [
          'close',
        ],
        [
          options,
        ],
        {
          dependencyName:
            'commandRepository',
          required:
            false,
        },
      );
    }

    this.initialized =
      false;

    return {
      status:
        'CLOSED',

      service:
        this.service,

      provider:
        this.provider,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Dependency Injection Setters
   * ---------------------------------------------------------------------------
   */

  setDependency(
    name,
    dependency,
  ) {
    const allowed =
      new Set([
        'repository',
        'commandRepository',
        'idempotencyService',
        'callbackIntelligenceService',
        'aiDecisionEngine',
        'autonomousRouter',
        'analyticsPipeline',
        'reconciliationService',
        'providerHealthService',
        'approvalService',
        'incidentService',
        'retryService',
        'auditService',
        'eventPublisher',
        'outbox',
        'observability',
        'logger',
      ]);

    if (
      !allowed.has(name)
    ) {
      throw new CommandValidationError(
        `Unsupported command-center dependency "${name}".`,
        {
          code:
            'AIRTEL_COMMAND_DEPENDENCY_NOT_ALLOWED',
        },
      );
    }

    const property =
      name ===
      'commandRepository'
        ? 'repository'
        : name;

    this[property] =
      dependency;

    return this;
  }
}

/**
 * =============================================================================
 * Factory
 * =============================================================================
 */

function createCommandCenter(
  options = {},
) {
  return new CommandCenter(
    options,
  );
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 *
 * The singleton has no database/provider side effects at import time.
 *
 * The Airtel composition root should inject the actual dependencies.
 * =============================================================================
 */

const commandCenter =
  createCommandCenter();

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
  commandCenter;

module.exports.CommandCenter =
  CommandCenter;

module.exports.CommandCenterError =
  CommandCenterError;

module.exports.CommandValidationError =
  CommandValidationError;

module.exports.CommandApprovalError =
  CommandApprovalError;

module.exports.CommandDependencyError =
  CommandDependencyError;

module.exports.createCommandCenter =
  createCommandCenter;

module.exports.COMMAND_TYPE =
  COMMAND_TYPE;

module.exports.COMMAND_CLASS =
  COMMAND_CLASS;

module.exports.COMMAND_STATUS =
  COMMAND_STATUS;

module.exports.RISK_LEVEL =
  RISK_LEVEL;

module.exports.APPROVAL_STATE =
  APPROVAL_STATE;

module.exports.DECISION =
  DECISION;

module.exports.COMMAND_POLICY =
  COMMAND_POLICY;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.PROVIDER =
  PROVIDER;

module.exports.VERSION =
  VERSION;