'use strict';

/**
 * =============================================================================
 * TITech Community Capital
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/callbackWarehouse.js
 *
 * Purpose:
 *   Enterprise callback intelligence warehouse / evidence persistence boundary
 *   for Airtel payment callbacks.
 *
 * Architectural Role
 * ------------------
 *   This module is the persistence and evidence boundary for authenticated
 *   Airtel callback intelligence data.
 *
 *   It stores a bounded, sanitized, analytics-safe projection of callback
 *   events so that downstream services can perform:
 *
 *     - callback analytics
 *     - feature generation
 *     - fraud analysis
 *     - failure analysis
 *     - provider behaviour analysis
 *     - operational optimisation
 *     - audit/evidence investigations
 *     - reconciliation support
 *
 *   The warehouse deliberately separates:
 *
 *     provider callback transport
 *         ->
 *     authenticated callback handling
 *         ->
 *     normalized callback evidence
 *         ->
 *     analytics warehouse
 *         ->
 *     intelligence / analytics consumers
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 *   This module MUST NOT:
 *
 *     - authenticate Airtel credentials
 *     - verify webhook signatures
 *     - decide whether a callback is trusted
 *     - settle a financial transaction
 *     - post to the financial ledger
 *     - mutate customer balances
 *     - authorize payments
 *     - release disbursements
 *     - mark provider acceptance as settlement
 *     - make final fraud/blocking decisions
 *     - execute AI recommendations
 *     - perform provider HTTP calls
 *     - contain undocumented Airtel API contracts
 *
 * Financial Safety Principles
 * ---------------------------
 *   1. Callback evidence is NOT financial settlement evidence by itself.
 *   2. The warehouse never mutates balances or the canonical ledger.
 *   3. Monetary values remain strings / exact minor-unit representations.
 *   4. JavaScript Number is never used for monetary arithmetic.
 *   5. Idempotency and deterministic event identity are first-class.
 *   6. Tenant isolation is mandatory for persisted and queried evidence.
 *   7. Provider payloads are sanitized before persistence.
 *   8. Secrets, credentials, tokens and authentication material are never
 *      intentionally persisted in analytics documents.
 *   9. Query operations are bounded and pagination is deterministic.
 *  10. Retention metadata is explicit and deletion is controlled by policy.
 *
 * Security Principles
 * -------------------
 *   - deny-by-default field handling
 *   - bounded recursive projection
 *   - sensitive-key redaction
 *   - payload size enforcement
 *   - deterministic payload hashing
 *   - tenant-bound identity
 *   - safe diagnostics
 *   - no raw credential persistence
 *   - no raw authorization header persistence
 *
 * Persistence Model
 * -----------------
 *   The warehouse uses a repository abstraction.
 *
 *   Supported repository styles include:
 *
 *     - save(document, options)
 *     - create(document, options)
 *     - insertOne(document, options)
 *     - upsert(document, options)
 *     - findOne(filter, options)
 *     - find(filter, options)
 *     - count(filter, options)
 *     - countDocuments(filter, options)
 *     - deleteExpired(filter, options)
 *     - purgeExpired(filter, options)
 *
 *   No database implementation is hard-coded here. This prevents the
 *   intelligence layer from being coupled to a specific Mongo/Mongoose model.
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

const SERVICE_NAME = 'airtel.callbackWarehouse';
const PROVIDER = 'AIRTEL';
const VERSION = '1.0.0';

const DEFAULT_RETENTION_DAYS = 365;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

const DEFAULT_MAX_DOCUMENT_BYTES = 256 * 1024;
const DEFAULT_MAX_STRING_LENGTH = 8 * 1024;
const DEFAULT_MAX_ARRAY_ITEMS = 100;
const DEFAULT_MAX_OBJECT_KEYS = 150;
const DEFAULT_MAX_DEPTH = 8;

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 200;

const EVENT_ID_PREFIX = 'airtel-callback';

const STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  ANALYZED: 'ANALYZED',
  REPLAYED: 'REPLAYED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  ARCHIVED: 'ARCHIVED',
});

const TRUST_LEVEL = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  UNVERIFIED: 'UNVERIFIED',
  VERIFIED: 'VERIFIED',
  HIGH: 'HIGH',
});

const SOURCE_TYPES = new Set([
  'WEBHOOK',
  'CALLBACK',
  'POLL',
  'MANUAL',
  'REPLAY',
  'TEST',
  'UNKNOWN',
]);

/**
 * Sensitive keys are matched case-insensitively.
 *
 * This is intentionally broader than merely "secret" because payment
 * integrations commonly use provider-specific names for credential material.
 */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
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
  'idtoken',
  'id_token',
  'bearertoken',
  'bearer_token',
  'clientsecret',
  'client_secret',
  'secret',
  'api_key',
  'apikey',
  'privatekey',
  'private_key',
  'encryptionkey',
  'encryption_key',
  'signaturesecret',
  'signature_secret',
  'credential',
  'credentials',
  'webhooksecret',
  'webhook_secret',
  'authorizationheader',
  'authorization_header',
]);

/**
 * The top-level event projection deliberately uses an allow-list.
 *
 * Anything not represented here remains in metadata only when safely projected
 * through the bounded generic sanitizer.
 */
const ALLOWED_EVENT_FIELDS = new Set([
  'provider',
  'tenantId',
  'eventId',
  'eventType',
  'status',
  'sourceType',
  'correlationId',
  'transactionId',
  'providerTransactionId',
  'providerReference',
  'idempotencyKey',
  'callbackId',
  'requestId',
  'traceId',
  'currency',
  'amount',
  'amountMinor',
  'country',
  'service',
  'channel',
  'operation',
  'customerReference',
  'merchantReference',
  'accountReference',
  'externalReference',
  'paymentReference',
  'retryCount',
  'processingTimeMs',
  'receivedAt',
  'processedAt',
  'completedAt',
  'signatureVerified',
  'idempotencyChecked',
  'replayDetected',
  'trustLevel',
  'riskScore',
  'fraudDecision',
  'failureCategory',
  'failureCode',
  'failureMessage',
  'httpStatus',
  'providerStatus',
  'providerStatusCode',
  'providerCode',
  'analysisStatus',
  'featureStatus',
  'rawPayloadHash',
  'schemaVersion',
  'metadata',
]);

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class CallbackWarehouseError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'CallbackWarehouseError';
    this.code =
      options.code ||
      'AIRTEL_CALLBACK_WAREHOUSE_ERROR';

    this.statusCode =
      Number.isInteger(options.statusCode)
        ? options.statusCode
        : 500;

    this.retryable =
      options.retryable === true;

    this.tenantId =
      options.tenantId ||
      null;

    this.eventId =
      options.eventId ||
      null;

    this.cause =
      options.cause || null;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        CallbackWarehouseError,
      );
    }
  }
}

class CallbackWarehouseValidationError extends CallbackWarehouseError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code:
        options.code ||
        'AIRTEL_CALLBACK_WAREHOUSE_VALIDATION_ERROR',
      statusCode:
        options.statusCode || 400,
      retryable: false,
    });

    this.name = 'CallbackWarehouseValidationError';
  }
}

class CallbackWarehouseDependencyError extends CallbackWarehouseError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code:
        options.code ||
        'AIRTEL_CALLBACK_WAREHOUSE_DEPENDENCY_ERROR',
      statusCode:
        options.statusCode || 503,
      retryable:
        options.retryable !== false,
    });

    this.name = 'CallbackWarehouseDependencyError';
  }
}

class CallbackWarehouseConflictError extends CallbackWarehouseError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code:
        options.code ||
        'AIRTEL_CALLBACK_WAREHOUSE_CONFLICT',
      statusCode:
        options.statusCode || 409,
      retryable: false,
    });

    this.name = 'CallbackWarehouseConflictError';
  }
}

/**
 * =============================================================================
 * Primitive Helpers
 * =============================================================================
 */

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function normalizeString(
  value,
  {
    name = 'value',
    required = false,
    maxLength = DEFAULT_MAX_STRING_LENGTH,
    trim = true,
  } = {},
) {
  if (
    value === null ||
    value === undefined
  ) {
    if (required) {
      throw new CallbackWarehouseValidationError(
        `${name} is required.`,
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_REQUIRED_FIELD',
        },
      );
    }

    return null;
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} must be a string-compatible primitive.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_INVALID_STRING',
      },
    );
  }

  let normalized =
    String(value);

  if (trim) {
    normalized =
      normalized.trim();
  }

  if (!normalized) {
    if (required) {
      throw new CallbackWarehouseValidationError(
        `${name} must not be empty.`,
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_EMPTY_FIELD',
        },
      );
    }

    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} exceeds the maximum permitted length.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_FIELD_TOO_LARGE',
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
      name: 'tenantId',
      required: true,
      maxLength: 256,
    },
  );
}

function normalizeOptionalString(
  value,
  name,
  maxLength = DEFAULT_MAX_STRING_LENGTH,
) {
  return normalizeString(
    value,
    {
      name,
      required: false,
      maxLength,
    },
  );
}

function normalizeInteger(
  value,
  {
    name,
    defaultValue = null,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
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
    !Number.isInteger(normalized)
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} must be an integer.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_INVALID_INTEGER',
      },
    );
  }

  if (
    normalized < min ||
    normalized > max
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} is outside the permitted range.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_INTEGER_OUT_OF_RANGE',
      },
    );
  }

  return normalized;
}

function normalizeNonNegativeInteger(
  value,
  name,
  defaultValue = 0,
) {
  return normalizeInteger(
    value,
    {
      name,
      defaultValue,
      min: 0,
    },
  );
}

/**
 * Never convert monetary values through Number.
 *
 * The warehouse stores the source decimal string and optionally an exact
 * minor-unit string supplied by the upstream normalizer.
 */
function normalizeMoneyString(
  value,
  {
    name = 'amount',
    required = false,
    maxLength = 128,
  } = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    if (required) {
      throw new CallbackWarehouseValidationError(
        `${name} is required.`,
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_AMOUNT_REQUIRED',
        },
      );
    }

    return null;
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} must be represented as a decimal-compatible value.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_INVALID_AMOUNT',
      },
    );
  }

  const normalized =
    String(value).trim();

  if (
    normalized.length >
    maxLength
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} exceeds the maximum permitted length.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_AMOUNT_TOO_LARGE',
      },
    );
  }

  /**
   * Accept common decimal representations without trying to perform
   * arithmetic. Scientific notation is intentionally rejected because
   * provider payloads should be normalized before analytical storage.
   */
  if (
    !/^-?\d+(?:\.\d+)?$/.test(
      normalized,
    )
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} must be a plain decimal string.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_INVALID_DECIMAL',
      },
    );
  }

  return normalized;
}

function normalizeCurrency(
  value,
) {
  const currency =
    normalizeString(
      value,
      {
        name: 'currency',
        required: false,
        maxLength: 16,
      },
    );

  if (!currency) {
    return null;
  }

  return currency.toUpperCase();
}

function normalizeDate(
  value,
  {
    name = 'date',
    defaultValue = null,
  } = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return defaultValue;
  }

  if (
    value instanceof Date
  ) {
    if (
      Number.isNaN(
        value.getTime(),
      )
    ) {
      throw new CallbackWarehouseValidationError(
        `${name} is not a valid date.`,
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_INVALID_DATE',
        },
      );
    }

    return new Date(
      value.getTime(),
    );
  }

  const parsed =
    new Date(value);

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new CallbackWarehouseValidationError(
      `${name} is not a valid date.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_INVALID_DATE',
      },
    );
  }

  return parsed;
}

function normalizeBoolean(
  value,
  defaultValue = false,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return defaultValue;
  }

  if (
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    const normalized =
      value.trim().toLowerCase();

    if (
      normalized === 'true' ||
      normalized === '1' ||
      normalized === 'yes'
    ) {
      return true;
    }

    if (
      normalized === 'false' ||
      normalized === '0' ||
      normalized === 'no'
    ) {
      return false;
    }
  }

  return Boolean(value);
}

function normalizeSourceType(
  value,
) {
  const normalized =
    normalizeOptionalString(
      value,
      'sourceType',
      32,
    );

  if (!normalized) {
    return 'UNKNOWN';
  }

  const upper =
    normalized.toUpperCase();

  return SOURCE_TYPES.has(
    upper,
  )
    ? upper
    : 'UNKNOWN';
}

function normalizeTrustLevel(
  value,
) {
  const normalized =
    normalizeOptionalString(
      value,
      'trustLevel',
      32,
    );

  if (!normalized) {
    return TRUST_LEVEL.UNKNOWN;
  }

  const upper =
    normalized.toUpperCase();

  return Object.prototype.hasOwnProperty.call(
    TRUST_LEVEL,
    upper,
  )
    ? upper
    : TRUST_LEVEL.UNKNOWN;
}

function normalizePageSize(
  value,
) {
  return normalizeInteger(
    value,
    {
      name: 'limit',
      defaultValue: DEFAULT_PAGE_SIZE,
      min: MIN_PAGE_SIZE,
      max: MAX_PAGE_SIZE,
    },
  );
}

function normalizeRetentionDays(
  value,
) {
  return normalizeInteger(
    value,
    {
      name: 'retentionDays',
      defaultValue:
        DEFAULT_RETENTION_DAYS,
      min: MIN_RETENTION_DAYS,
      max: MAX_RETENTION_DAYS,
    },
  );
}

function stableSortObject(
  value,
) {
  if (
    Array.isArray(value)
  ) {
    return value.map(
      stableSortObject,
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
      (result, key) => {
        result[key] =
          stableSortObject(
            value[key],
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
    stableSortObject(
      value,
    ),
  );
}

function sha256(
  value,
) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(
            value,
          ),
      'utf8',
    )
    .digest('hex');
}

function createDeterministicEventId(
  {
    tenantId,
    callbackId,
    providerTransactionId,
    providerReference,
    transactionId,
    correlationId,
    rawPayloadHash,
  },
) {
  const identityParts = [
    tenantId,
    PROVIDER,
    callbackId || '',
    providerTransactionId || '',
    providerReference || '',
    transactionId || '',
    correlationId || '',
    rawPayloadHash || '',
  ];

  const digest =
    sha256(
      identityParts.join('|'),
    );

  return `${EVENT_ID_PREFIX}-${digest}`;
}

function calculateByteLength(
  value,
) {
  try {
    return Buffer.byteLength(
      typeof value === 'string'
        ? value
        : JSON.stringify(value),
      'utf8',
    );
  } catch {
    return 0;
  }
}

/**
 * =============================================================================
 * Sensitive Data Sanitization
 * =============================================================================
 */

function normalizeSensitiveKey(
  key,
) {
  return String(key)
    .replace(/[\s-]/g, '')
    .toLowerCase();
}

function isSensitiveKey(
  key,
) {
  return SENSITIVE_KEYS.has(
    normalizeSensitiveKey(
      key,
    ),
  );
}

function safePrimitive(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'bigint'
  ) {
    return value.toString();
  }

  if (
    typeof value === 'number'
  ) {
    if (
      !Number.isFinite(value)
    ) {
      return null;
    }

    return value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  return String(value);
}

function sanitizeValue(
  value,
  {
    depth = 0,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxStringLength =
      DEFAULT_MAX_STRING_LENGTH,
    maxArrayItems =
      DEFAULT_MAX_ARRAY_ITEMS,
    maxObjectKeys =
      DEFAULT_MAX_OBJECT_KEYS,
  } = {},
) {
  if (
    depth > maxDepth
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
    typeof value !== 'object'
  ) {
    const primitive =
      safePrimitive(
        value,
      );

    if (
      typeof primitive === 'string' &&
      primitive.length >
        maxStringLength
    ) {
      return (
        primitive.slice(
          0,
          maxStringLength,
        ) +
        '[TRUNCATED]'
      );
    }

    return primitive;
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
    const result =
      value
        .slice(
          0,
          maxArrayItems,
        )
        .map(
          (item) =>
            sanitizeValue(
              item,
              {
                depth:
                  depth + 1,
                maxDepth,
                maxStringLength,
                maxArrayItems,
                maxObjectKeys,
              },
            ),
        );

    if (
      value.length >
      maxArrayItems
    ) {
      result.push(
        `[TRUNCATED_ITEMS:${value.length - maxArrayItems}]`,
      );
    }

    return result;
  }

  const result = {};
  const keys =
    Object.keys(value)
      .slice(
        0,
        maxObjectKeys,
      );

  for (
    const key of keys
  ) {
    if (
      isSensitiveKey(
        key,
      )
    ) {
      result[key] =
        '[REDACTED]';

      continue;
    }

    result[key] =
      sanitizeValue(
        value[key],
        {
          depth:
            depth + 1,
          maxDepth,
          maxStringLength,
          maxArrayItems,
          maxObjectKeys,
        },
      );
  }

  if (
    Object.keys(value).length >
    maxObjectKeys
  ) {
    result.__truncatedKeys =
      Object.keys(value).length -
      maxObjectKeys;
  }

  return result;
}

/**
 * =============================================================================
 * Callback Projection
 * =============================================================================
 */

function extractCanonicalValue(
  payload,
  paths = [],
) {
  for (
    const path of paths
  ) {
    const segments =
      String(path)
        .split('.')
        .filter(Boolean);

    let current =
      payload;

    let found = true;

    for (
      const segment of segments
    ) {
      if (
        current === null ||
        current === undefined ||
        !Object.prototype.hasOwnProperty.call(
          Object(current),
          segment,
        )
      ) {
        found = false;
        break;
      }

      current =
        current[segment];
    }

    if (
      found &&
      current !== null &&
      current !== undefined &&
      current !== ''
    ) {
      return current;
    }
  }

  return null;
}

function buildSafeCallbackProjection(
  payload,
  options = {},
) {
  const source =
    isPlainObject(payload)
      ? payload
      : {
          value:
            sanitizeValue(
              payload,
            ),
        };

  const metadata =
    isPlainObject(
      options.metadata,
    )
      ? options.metadata
      : {};

  return sanitizeValue(
    {
      ...source,
      metadata,
    },
    {
      maxDepth:
        options.maxDepth ||
        DEFAULT_MAX_DEPTH,
      maxStringLength:
        options.maxStringLength ||
        DEFAULT_MAX_STRING_LENGTH,
      maxArrayItems:
        options.maxArrayItems ||
        DEFAULT_MAX_ARRAY_ITEMS,
      maxObjectKeys:
        options.maxObjectKeys ||
        DEFAULT_MAX_OBJECT_KEYS,
    },
  );
}

function normalizeCallbackDocument(
  input,
  options = {},
) {
  if (
    !isPlainObject(input)
  ) {
    throw new CallbackWarehouseValidationError(
      'Callback warehouse input must be a plain object.',
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_INVALID_INPUT',
      },
    );
  }

  const tenantId =
    normalizeTenantId(
      input.tenantId ||
        input.context?.tenantId ||
        input.context?.tenant?.tenantId ||
        input.context?.tenant?.id,
    );

  const callbackId =
    normalizeOptionalString(
      input.callbackId ||
        input.event?.callbackId ||
        input.payload?.callbackId ||
        input.payload?.id,
      'callbackId',
      256,
    );

  const transactionId =
    normalizeOptionalString(
      input.transactionId ||
        input.event?.transactionId ||
        input.payload?.transactionId,
      'transactionId',
      256,
    );

  const providerTransactionId =
    normalizeOptionalString(
      input.providerTransactionId ||
        input.event?.providerTransactionId ||
        input.payload?.providerTransactionId ||
        input.payload?.transactionId,
      'providerTransactionId',
      256,
    );

  const providerReference =
    normalizeOptionalString(
      input.providerReference ||
        input.event?.providerReference ||
        input.payload?.providerReference ||
        input.payload?.reference,
      'providerReference',
      256,
    );

  const correlationId =
    normalizeOptionalString(
      input.correlationId ||
        input.context?.correlationId ||
        input.context?.correlation?.id,
      'correlationId',
      256,
    );

  const idempotencyKey =
    normalizeOptionalString(
      input.idempotencyKey ||
        input.context?.idempotencyKey,
      'idempotencyKey',
      256,
    );

  const requestId =
    normalizeOptionalString(
      input.requestId ||
        input.context?.requestId,
      'requestId',
      256,
    );

  const traceId =
    normalizeOptionalString(
      input.traceId ||
        input.context?.traceId,
      'traceId',
      256,
    );

  const eventType =
    normalizeOptionalString(
      input.eventType ||
        input.event?.eventType ||
        input.type ||
        input.payload?.eventType ||
        input.payload?.type,
      'eventType',
      128,
    ) || 'UNKNOWN';

  const status =
    normalizeOptionalString(
      input.status ||
        input.event?.status ||
        input.payload?.status,
      'status',
      64,
    ) || STATUS.RECEIVED;

  const sourceType =
    normalizeSourceType(
      input.sourceType ||
        input.event?.sourceType ||
        input.context?.sourceType,
    );

  const amount =
    normalizeMoneyString(
      input.amount ??
        input.event?.amount ??
        input.payload?.amount,
      {
        name: 'amount',
      },
    );

  const amountMinor =
    normalizeMoneyString(
      input.amountMinor ??
        input.event?.amountMinor ??
        input.payload?.amountMinor,
      {
        name: 'amountMinor',
      },
    );

  const currency =
    normalizeCurrency(
      input.currency ||
        input.event?.currency ||
        input.payload?.currency,
    );

  const receivedAt =
    normalizeDate(
      input.receivedAt ||
        input.event?.receivedAt ||
        input.context?.receivedAt,
      {
        name: 'receivedAt',
        defaultValue:
          new Date(),
      },
    );

  const processedAt =
    normalizeDate(
      input.processedAt ||
        input.event?.processedAt,
      {
        name: 'processedAt',
      },
    );

  const completedAt =
    normalizeDate(
      input.completedAt ||
        input.event?.completedAt,
      {
        name: 'completedAt',
      },
    );

  const retryCount =
    normalizeNonNegativeInteger(
      input.retryCount ??
        input.event?.retryCount,
      'retryCount',
      0,
    );

  const processingTimeMs =
    normalizeNonNegativeInteger(
      input.processingTimeMs ??
        input.event?.processingTimeMs,
      'processingTimeMs',
      null,
    );

  const riskScore =
    input.riskScore === null ||
    input.riskScore === undefined
      ? null
      : normalizeInteger(
          input.riskScore,
          {
            name: 'riskScore',
            defaultValue: null,
            min: 0,
            max: 100,
          },
        );

  const signatureVerified =
    normalizeBoolean(
      input.signatureVerified ??
        input.security?.signatureVerified,
      false,
    );

  const idempotencyChecked =
    normalizeBoolean(
      input.idempotencyChecked ??
        input.security?.idempotencyChecked,
      false,
    );

  const replayDetected =
    normalizeBoolean(
      input.replayDetected ??
        input.security?.replayDetected,
      false,
    );

  const trustLevel =
    normalizeTrustLevel(
      input.trustLevel ||
        input.security?.trustLevel,
    );

  const providerPayload =
    input.payload ??
    input.body ??
    input.providerPayload ??
    input.eventPayload ??
    {};

  /**
   * The raw provider body itself is never persisted as authoritative raw
   * material. A bounded, sanitized projection is retained for intelligence.
   */
  const safePayload =
    buildSafeCallbackProjection(
      providerPayload,
      {
        metadata:
          input.metadata || {},
        maxDepth:
          options.maxDepth ||
          DEFAULT_MAX_DEPTH,
        maxStringLength:
          options.maxStringLength ||
          DEFAULT_MAX_STRING_LENGTH,
        maxArrayItems:
          options.maxArrayItems ||
          DEFAULT_MAX_ARRAY_ITEMS,
        maxObjectKeys:
          options.maxObjectKeys ||
          DEFAULT_MAX_OBJECT_KEYS,
      },
    );

  const rawPayloadHash =
    normalizeOptionalString(
      input.rawPayloadHash,
      'rawPayloadHash',
      128,
    ) ||
    sha256(
      safePayload,
    );

  const resolvedEventId =
    normalizeOptionalString(
      input.eventId ||
        input.id,
      'eventId',
      256,
    ) ||
    createDeterministicEventId(
      {
        tenantId,
        callbackId,
        providerTransactionId,
        providerReference,
        transactionId,
        correlationId,
        rawPayloadHash,
      },
    );

  const normalized = {
    provider: PROVIDER,

    tenantId,

    eventId:
      resolvedEventId,

    eventType,

    status,

    sourceType,

    correlationId,

    transactionId,

    providerTransactionId,

    providerReference,

    idempotencyKey,

    callbackId,

    requestId,

    traceId,

    currency,

    amount,

    amountMinor,

    country:
      normalizeOptionalString(
        input.country ||
          input.event?.country ||
          input.payload?.country,
        'country',
        8,
      ),

    service:
      normalizeOptionalString(
        input.service ||
          input.event?.service ||
          input.payload?.service,
        'service',
        128,
      ),

    channel:
      normalizeOptionalString(
        input.channel ||
          input.event?.channel ||
          input.payload?.channel,
        'channel',
        128,
      ),

    operation:
      normalizeOptionalString(
        input.operation ||
          input.event?.operation ||
          input.payload?.operation,
        'operation',
        128,
      ),

    customerReference:
      normalizeOptionalString(
        input.customerReference ||
          input.payload?.customerReference,
        'customerReference',
        256,
      ),

    merchantReference:
      normalizeOptionalString(
        input.merchantReference ||
          input.payload?.merchantReference,
        'merchantReference',
        256,
      ),

    accountReference:
      normalizeOptionalString(
        input.accountReference ||
          input.payload?.accountReference,
        'accountReference',
        256,
      ),

    externalReference:
      normalizeOptionalString(
        input.externalReference ||
          input.payload?.externalReference,
        'externalReference',
        256,
      ),

    paymentReference:
      normalizeOptionalString(
        input.paymentReference ||
          input.payload?.paymentReference,
        'paymentReference',
        256,
      ),

    retryCount,

    processingTimeMs,

    receivedAt,

    processedAt,

    completedAt,

    signatureVerified,

    idempotencyChecked,

    replayDetected,

    trustLevel,

    riskScore,

    fraudDecision:
      normalizeOptionalString(
        input.fraudDecision ||
          input.security?.fraudDecision,
        'fraudDecision',
        64,
      ),

    failureCategory:
      normalizeOptionalString(
        input.failureCategory ||
          input.failure?.category,
        'failureCategory',
        128,
      ),

    failureCode:
      normalizeOptionalString(
        input.failureCode ||
          input.failure?.code,
        'failureCode',
        128,
      ),

    failureMessage:
      normalizeOptionalString(
        input.failureMessage ||
          input.failure?.message,
        'failureMessage',
        1024,
      ),

    httpStatus:
      input.httpStatus === null ||
      input.httpStatus === undefined
        ? null
        : normalizeInteger(
            input.httpStatus,
            {
              name: 'httpStatus',
              defaultValue: null,
              min: 100,
              max: 599,
            },
          ),

    providerStatus:
      normalizeOptionalString(
        input.providerStatus ||
          input.payload?.providerStatus,
        'providerStatus',
        128,
      ),

    providerStatusCode:
      normalizeOptionalString(
        input.providerStatusCode ||
          input.payload?.providerStatusCode,
        'providerStatusCode',
        128,
      ),

    providerCode:
      normalizeOptionalString(
        input.providerCode ||
          input.payload?.providerCode ||
          input.payload?.code,
        'providerCode',
        128,
      ),

    analysisStatus:
      normalizeOptionalString(
        input.analysisStatus,
        'analysisStatus',
        64,
      ),

    featureStatus:
      normalizeOptionalString(
        input.featureStatus,
        'featureStatus',
        64,
      ),

    rawPayloadHash,

    schemaVersion:
      normalizeOptionalString(
        input.schemaVersion,
        'schemaVersion',
        64,
      ) || VERSION,

    /**
     * Safe bounded provider-payload projection.
     */
    payload:
      safePayload,

    /**
     * Additional safe metadata is intentionally separate from `payload`.
     */
    metadata:
      sanitizeValue(
        input.metadata || {},
        {
          maxDepth:
            Math.min(
              options.maxDepth ||
                DEFAULT_MAX_DEPTH,
              6,
            ),
          maxStringLength:
            Math.min(
              options.maxStringLength ||
                DEFAULT_MAX_STRING_LENGTH,
              4096,
            ),
          maxArrayItems:
            Math.min(
              options.maxArrayItems ||
                DEFAULT_MAX_ARRAY_ITEMS,
              50,
            ),
          maxObjectKeys:
            Math.min(
              options.maxObjectKeys ||
                DEFAULT_MAX_OBJECT_KEYS,
              75,
            ),
        },
      ),
  };

  /**
   * The allow-list prevents accidental persistence of arbitrary top-level
   * security material from a callback envelope.
   */
  const projected =
    {};

  for (
    const key of ALLOWED_EVENT_FIELDS
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        normalized,
        key,
      )
    ) {
      projected[key] =
        normalized[key];
    }
  }

  projected.payload =
    normalized.payload;

  /**
   * Preserve provider and warehouse metadata even if the allow-list changes.
   */
  projected.provider =
    PROVIDER;

  projected.tenantId =
    tenantId;

  projected.eventId =
    resolvedEventId;

  projected.metadata =
    normalized.metadata;

  return projected;
}

/**
 * =============================================================================
 * Repository Adapter
 * =============================================================================
 */

function resolveRepository(
  repository,
) {
  if (
    repository &&
    typeof repository === 'object'
  ) {
    return repository;
  }

  return null;
}

async function repositoryCall(
  repository,
  operation,
  ...args
) {
  if (
    !repository ||
    !isFunction(
      repository[operation],
    )
  ) {
    throw new CallbackWarehouseDependencyError(
      `Callback warehouse repository does not implement "${operation}".`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_REPOSITORY_OPERATION_UNAVAILABLE',
      },
    );
  }

  try {
    return await repository[
      operation
    ](
      ...args,
    );
  } catch (error) {
    throw new CallbackWarehouseDependencyError(
      `Callback warehouse repository operation "${operation}" failed.`,
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_REPOSITORY_OPERATION_FAILED',
        cause: error,
        retryable:
          error?.retryable !== false,
      },
    );
  }
}

function buildRepositoryFilter(
  tenantId,
  filter = {},
) {
  const safeFilter =
    isPlainObject(filter)
      ? {
          ...filter,
        }
      : {};

  /**
   * Tenant must remain authoritative and cannot be overridden by callers.
   */
  safeFilter.tenantId =
    tenantId;

  return safeFilter;
}

/**
 * =============================================================================
 * Callback Warehouse
 * =============================================================================
 */

class CallbackWarehouse {
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
      resolveRepository(
        options.repository ||
          options.callbackRepository ||
          options.store,
      );

    this.logger =
      options.logger ||
      null;

    this.observability =
      options.observability ||
      null;

    this.readiness =
      options.readiness ||
      null;

    this.clock =
      isFunction(options.clock)
        ? options.clock
        : () =>
            new Date();

    this.maxDocumentBytes =
      normalizeInteger(
        options.maxDocumentBytes,
        {
          name:
            'maxDocumentBytes',
          defaultValue:
            DEFAULT_MAX_DOCUMENT_BYTES,
          min: 1024,
          max:
            10 * 1024 * 1024,
        },
      );

    this.retentionDays =
      normalizeRetentionDays(
        options.retentionDays,
      );

    this.maxDepth =
      normalizeInteger(
        options.maxDepth,
        {
          name: 'maxDepth',
          defaultValue:
            DEFAULT_MAX_DEPTH,
          min: 1,
          max: 16,
        },
      );

    this.maxStringLength =
      normalizeInteger(
        options.maxStringLength,
        {
          name:
            'maxStringLength',
          defaultValue:
            DEFAULT_MAX_STRING_LENGTH,
          min: 256,
          max: 64 * 1024,
        },
      );

    this.maxArrayItems =
      normalizeInteger(
        options.maxArrayItems,
        {
          name:
            'maxArrayItems',
          defaultValue:
            DEFAULT_MAX_ARRAY_ITEMS,
          min: 1,
          max: 1000,
        },
      );

    this.maxObjectKeys =
      normalizeInteger(
        options.maxObjectKeys,
        {
          name:
            'maxObjectKeys',
          defaultValue:
            DEFAULT_MAX_OBJECT_KEYS,
          min: 1,
          max: 1000,
        },
      );

    this.startedAt =
      this.clock();

    this.lastWriteAt =
      null;

    this.lastReadAt =
      null;

    this.metrics = {
      writes: 0,
      reads: 0,
      duplicates: 0,
      failures: 0,
      oversized: 0,
      validationFailures: 0,
      retentionPurges: 0,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Logger / Observability
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
       * Logging must never turn a successful warehouse operation into a
       * failed financial/business operation.
       */
    }
  }

  incrementMetric(
    name,
    value = 1,
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        this.metrics,
        name,
      )
    ) {
      return;
    }

    this.metrics[name] +=
      value;
  }

  recordObservation(
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
   * Readiness
   * ---------------------------------------------------------------------------
   */

  isReady() {
    if (
      this.readiness &&
      isFunction(
        this.readiness.isReady,
      )
    ) {
      try {
        return Boolean(
          this.readiness.isReady(),
        );
      } catch {
        return false;
      }
    }

    /**
     * A warehouse without a repository is intentionally not reported as
     * operationally ready. It may still construct successfully for dependency
     * injection and testing.
     */
    return Boolean(
      this.repository,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Document Size Guard
   * ---------------------------------------------------------------------------
   */

  assertDocumentSize(
    document,
  ) {
    const bytes =
      calculateByteLength(
        document,
      );

    if (
      bytes >
      this.maxDocumentBytes
    ) {
      this.incrementMetric(
        'oversized',
      );

      throw new CallbackWarehouseValidationError(
        'Callback warehouse document exceeds the configured size limit.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_DOCUMENT_TOO_LARGE',
        },
      );
    }

    return bytes;
  }

  /**
   * ---------------------------------------------------------------------------
   * Retention
   * ---------------------------------------------------------------------------
   */

  buildRetentionMetadata(
    receivedAt,
    options = {},
  ) {
    const retentionDays =
      normalizeRetentionDays(
        options.retentionDays ??
          this.retentionDays,
      );

    const receivedDate =
      normalizeDate(
        receivedAt,
        {
          name:
            'receivedAt',
          defaultValue:
            this.clock(),
        },
      );

    const expiresAt =
      new Date(
        receivedDate.getTime() +
          retentionDays *
            24 *
            60 *
            60 *
            1000,
      );

    return {
      retentionDays,
      retentionPolicy:
        normalizeOptionalString(
          options.retentionPolicy,
          'retentionPolicy',
          128,
        ) ||
        'AIRTEL_CALLBACK_INTELLIGENCE_DEFAULT',
      expiresAt,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Timestamp / Lifecycle Metadata
   * ---------------------------------------------------------------------------
   */

  buildLifecycleMetadata(
    document,
    options = {},
  ) {
    const now =
      this.clock();

    return {
      createdAt:
        document.createdAt ||
        now,

      updatedAt:
        now,

      receivedAt:
        document.receivedAt ||
        now,

      archivedAt:
        document.archivedAt ||
        null,

      retention:
        this.buildRetentionMetadata(
          document.receivedAt ||
            now,
          options,
        ),
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Safe Projection
   * ---------------------------------------------------------------------------
   */

  project(
    input,
    options = {},
  ) {
    const document =
      normalizeCallbackDocument(
        input,
        {
          maxDepth:
            this.maxDepth,
          maxStringLength:
            this.maxStringLength,
          maxArrayItems:
            this.maxArrayItems,
          maxObjectKeys:
            this.maxObjectKeys,
          ...options,
        },
      );

    const lifecycle =
      this.buildLifecycleMetadata(
        document,
        options,
      );

    const result = {
      ...document,
      lifecycle,
      createdAt:
        lifecycle.createdAt,
      updatedAt:
        lifecycle.updatedAt,
    };

    /**
     * Do not persist top-level objects that callers can use as arbitrary
     * secret containers.
     */
    delete result.rawPayload;
    delete result.rawBody;
    delete result.headers;
    delete result.authorization;
    delete result.credentials;
    delete result.secrets;

    this.assertDocumentSize(
      result,
    );

    return result;
  }

  /**
   * ---------------------------------------------------------------------------
   * Existing Event Lookup
   * ---------------------------------------------------------------------------
   */

  async findExistingByEventId(
    tenantId,
    eventId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedEventId =
      normalizeString(
        eventId,
        {
          name:
            'eventId',
          required: true,
          maxLength: 256,
        },
      );

    if (!this.repository) {
      return null;
    }

    const filter =
      buildRepositoryFilter(
        normalizedTenantId,
        {
          eventId:
            normalizedEventId,
        },
      );

    this.incrementMetric(
      'reads',
    );

    this.lastReadAt =
      this.clock();

    if (
      isFunction(
        this.repository.findOne,
      )
    ) {
      return repositoryCall(
        this.repository,
        'findOne',
        filter,
        options,
      );
    }

    if (
      isFunction(
        this.repository.findByEventId,
      )
    ) {
      return repositoryCall(
        this.repository,
        'findByEventId',
        normalizedTenantId,
        normalizedEventId,
        options,
      );
    }

    return null;
  }

  /**
   * ---------------------------------------------------------------------------
   * Idempotent Write
   * ---------------------------------------------------------------------------
   *
   * Preferred repository behaviour:
   *
   *   upsert({ tenantId, eventId }, { $setOnInsert: document }, ...)
   *
   * or an equivalent atomic repository method.
   *
   * The warehouse does not treat "check then insert" as atomic when a repository
   * exposes an atomic implementation.
   */

  async store(
    input,
    options = {},
  ) {
    let document;

    try {
      document =
        this.project(
          input,
          options,
        );
    } catch (error) {
      this.incrementMetric(
        'validationFailures',
      );

      throw error;
    }

    if (!this.repository) {
      this.incrementMetric(
        'failures',
      );

      throw new CallbackWarehouseDependencyError(
        'Callback warehouse repository is not configured.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_REPOSITORY_NOT_CONFIGURED',
          tenantId:
            document.tenantId,
          eventId:
            document.eventId,
        },
      );
    }

    /**
     * -------------------------------------------------------------------------
     * Atomic native repository path
     * -------------------------------------------------------------------------
     */

    try {
      if (
        isFunction(
          this.repository.upsert,
        )
      ) {
        const result =
          await repositoryCall(
            this.repository,
            'upsert',
            {
              tenantId:
                document.tenantId,
              eventId:
                document.eventId,
            },
            document,
            {
              ...options,
              onDuplicate:
                'RETURN_EXISTING',
            },
          );

        const duplicate =
          Boolean(
            result?.duplicate ||
              result?.existing ||
              result?.matchedCount > 0 &&
              result?.upsertedCount === 0,
          );

        if (duplicate) {
          this.incrementMetric(
            'duplicates',
          );
        } else {
          this.incrementMetric(
            'writes',
          );
        }

        this.lastWriteAt =
          this.clock();

        this.recordObservation(
          'airtel.callback.warehouse.store',
          {
            provider:
              PROVIDER,
            tenantId:
              document.tenantId,
            eventId:
              document.eventId,
            duplicate,
          },
        );

        return {
          inserted:
            !duplicate,
          duplicate,
          document:
            result?.document ||
            result?.value ||
            result,
        };
      }

      /**
       * -----------------------------------------------------------------------
       * Repository-native idempotent create path
       * -----------------------------------------------------------------------
       */

      if (
        isFunction(
          this.repository.create,
        )
      ) {
        try {
          const created =
            await repositoryCall(
              this.repository,
              'create',
              document,
              options,
            );

          this.incrementMetric(
            'writes',
          );

          this.lastWriteAt =
            this.clock();

          return {
            inserted: true,
            duplicate: false,
            document:
              created,
          };
        } catch (error) {
          /**
           * A uniqueness conflict is treated as duplicate only when the
           * repository identifies the conflict explicitly.
           */
          const duplicate =
            error?.code ===
              11000 ||
            error?.code ===
              'DUPLICATE_KEY' ||
            error?.code ===
              'AIRTEL_CALLBACK_DUPLICATE';

          if (duplicate) {
            this.incrementMetric(
              'duplicates',
            );

            const existing =
              await this.findExistingByEventId(
                document.tenantId,
                document.eventId,
                options,
              );

            return {
              inserted: false,
              duplicate: true,
              document:
                existing,
            };
          }

          throw error;
        }
      }

      /**
       * -----------------------------------------------------------------------
       * Generic insertOne path
       * -----------------------------------------------------------------------
       */

      if (
        isFunction(
          this.repository.insertOne,
        )
      ) {
        try {
          const inserted =
            await repositoryCall(
              this.repository,
              'insertOne',
              document,
              options,
            );

          this.incrementMetric(
            'writes',
          );

          this.lastWriteAt =
            this.clock();

          return {
            inserted: true,
            duplicate: false,
            document:
              inserted,
          };
        } catch (error) {
          const duplicate =
            error?.code ===
              11000 ||
            error?.code ===
              'DUPLICATE_KEY';

          if (duplicate) {
            this.incrementMetric(
              'duplicates',
            );

            const existing =
              await this.findExistingByEventId(
                document.tenantId,
                document.eventId,
                options,
              );

            return {
              inserted: false,
              duplicate: true,
              document:
                existing,
            };
          }

          throw error;
        }
      }

      /**
       * -----------------------------------------------------------------------
       * Conservative save fallback
       * -----------------------------------------------------------------------
       */

      if (
        isFunction(
          this.repository.save,
        )
      ) {
        const existing =
          await this.findExistingByEventId(
            document.tenantId,
            document.eventId,
            options,
          );

        if (existing) {
          this.incrementMetric(
            'duplicates',
          );

          return {
            inserted: false,
            duplicate: true,
            document:
              existing,
          };
        }

        const saved =
          await repositoryCall(
            this.repository,
            'save',
            document,
            options,
          );

        this.incrementMetric(
          'writes',
        );

        this.lastWriteAt =
          this.clock();

        return {
          inserted: true,
          duplicate: false,
          document:
            saved,
        };
      }

      throw new CallbackWarehouseDependencyError(
        'Callback warehouse repository exposes no supported write method.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_WRITE_METHOD_UNAVAILABLE',
          tenantId:
            document.tenantId,
          eventId:
            document.eventId,
        },
      );
    } catch (error) {
      this.incrementMetric(
        'failures',
      );

      this.log(
        'error',
        {
          service:
            this.service,
          event:
            'callback.warehouse.store.failed',
          provider:
            PROVIDER,
          tenantId:
            document.tenantId,
          eventId:
            document.eventId,
          code:
            error?.code ||
            'UNKNOWN',
          message:
            error?.message ||
            'Callback warehouse store failed.',
        },
      );

      if (
        error instanceof
        CallbackWarehouseError
      ) {
        throw error;
      }

      throw new CallbackWarehouseDependencyError(
        'Callback warehouse persistence failed.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_PERSISTENCE_FAILED',
          tenantId:
            document.tenantId,
          eventId:
            document.eventId,
          cause:
            error,
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Compatibility Aliases
   * ---------------------------------------------------------------------------
   */

  async save(
    input,
    options = {},
  ) {
    return this.store(
      input,
      options,
    );
  }

  async insert(
    input,
    options = {},
  ) {
    return this.store(
      input,
      options,
    );
  }

  async upsert(
    input,
    options = {},
  ) {
    return this.store(
      input,
      options,
    );
  }

  async storeCallbackEvent(
    input,
    options = {},
  ) {
    return this.store(
      input,
      options,
    );
  }

  async saveCallbackEvent(
    input,
    options = {},
  ) {
    return this.store(
      input,
      options,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Query
   * ---------------------------------------------------------------------------
   */

  async findById(
    tenantId,
    eventId,
    options = {},
  ) {
    return this.findExistingByEventId(
      tenantId,
      eventId,
      options,
    );
  }

  async findByEventId(
    tenantId,
    eventId,
    options = {},
  ) {
    return this.findExistingByEventId(
      tenantId,
      eventId,
      options,
    );
  }

  async findByCorrelationId(
    tenantId,
    correlationId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedCorrelationId =
      normalizeString(
        correlationId,
        {
          name:
            'correlationId',
          required: true,
          maxLength: 256,
        },
      );

    return this.list(
      normalizedTenantId,
      {
        ...options,
        filter: {
          ...(options.filter || {}),
          correlationId:
            normalizedCorrelationId,
        },
      },
    );
  }

  async findByTransactionId(
    tenantId,
    transactionId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedTransactionId =
      normalizeString(
        transactionId,
        {
          name:
            'transactionId',
          required: true,
          maxLength: 256,
        },
      );

    return this.list(
      normalizedTenantId,
      {
        ...options,
        filter: {
          ...(options.filter || {}),
          transactionId:
            normalizedTransactionId,
        },
      },
    );
  }

  async list(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    if (!this.repository) {
      throw new CallbackWarehouseDependencyError(
        'Callback warehouse repository is not configured.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_REPOSITORY_NOT_CONFIGURED',
          tenantId:
            normalizedTenantId,
        },
      );
    }

    const limit =
      normalizePageSize(
        options.limit,
      );

    const skip =
      normalizeInteger(
        options.skip,
        {
          name: 'skip',
          defaultValue: 0,
          min: 0,
          max:
            Number.MAX_SAFE_INTEGER,
        },
      );

    const filter =
      buildRepositoryFilter(
        normalizedTenantId,
        options.filter,
      );

    /**
     * Never trust caller-provided tenantId from filter objects.
     */
    filter.tenantId =
      normalizedTenantId;

    let result;

    this.incrementMetric(
      'reads',
    );

    this.lastReadAt =
      this.clock();

    if (
      isFunction(
        this.repository.list,
      )
    ) {
      result =
        await repositoryCall(
          this.repository,
          'list',
          filter,
          {
            ...options,
            limit,
            skip,
          },
        );
    } else if (
      isFunction(
        this.repository.find,
      )
    ) {
      result =
        await repositoryCall(
          this.repository,
          'find',
          filter,
          {
            ...options,
            limit,
            skip,
          },
        );
    } else {
      throw new CallbackWarehouseDependencyError(
        'Callback warehouse repository exposes no supported read method.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_READ_METHOD_UNAVAILABLE',
          tenantId:
            normalizedTenantId,
        },
      );
    }

    return {
      items:
        Array.isArray(result)
          ? result
          : result?.items ||
            result?.documents ||
            [],
      limit,
      skip,
      nextSkip:
        Array.isArray(result)
          ? result.length === limit
            ? skip + limit
            : null
          : result?.nextSkip ??
            null,
      tenantId:
        normalizedTenantId,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Count
   * ---------------------------------------------------------------------------
   */

  async count(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    if (!this.repository) {
      throw new CallbackWarehouseDependencyError(
        'Callback warehouse repository is not configured.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_REPOSITORY_NOT_CONFIGURED',
          tenantId:
            normalizedTenantId,
        },
      );
    }

    const filter =
      buildRepositoryFilter(
        normalizedTenantId,
        options.filter,
      );

    if (
      isFunction(
        this.repository.countDocuments,
      )
    ) {
      const value =
        await repositoryCall(
          this.repository,
          'countDocuments',
          filter,
          options,
        );

      return Number.isSafeInteger(
        value,
      )
        ? value
        : Number(value) || 0;
    }

    if (
      isFunction(
        this.repository.count,
      )
    ) {
      const value =
        await repositoryCall(
          this.repository,
          'count',
          filter,
          options,
        );

      return Number.isSafeInteger(
        value,
      )
        ? value
        : Number(value) || 0;
    }

    throw new CallbackWarehouseDependencyError(
      'Callback warehouse repository exposes no supported count method.',
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_COUNT_METHOD_UNAVAILABLE',
        tenantId:
          normalizedTenantId,
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Retention Purge
   * ---------------------------------------------------------------------------
   *
   * This operation is intentionally repository-mediated. The warehouse does
   * not directly delete arbitrary documents because retention/destruction
   * policy may require legal, regulatory, audit or backup controls.
   */

  async purgeExpired(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    if (!this.repository) {
      throw new CallbackWarehouseDependencyError(
        'Callback warehouse repository is not configured.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_REPOSITORY_NOT_CONFIGURED',
          tenantId:
            normalizedTenantId,
        },
      );
    }

    const now =
      normalizeDate(
        options.now,
        {
          name: 'now',
          defaultValue:
            this.clock(),
        },
      );

    const filter =
      buildRepositoryFilter(
        normalizedTenantId,
        {
          ...(options.filter || {}),
          'lifecycle.retention.expiresAt': {
            $lte: now,
          },
        },
      );

    let result;

    if (
      isFunction(
        this.repository.purgeExpired,
      )
    ) {
      result =
        await repositoryCall(
          this.repository,
          'purgeExpired',
          filter,
          options,
        );
    } else if (
      isFunction(
        this.repository.deleteExpired,
      )
    ) {
      result =
        await repositoryCall(
          this.repository,
          'deleteExpired',
          filter,
          options,
        );
    } else {
      throw new CallbackWarehouseDependencyError(
        'Retention purge is not supported by the configured warehouse repository.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_RETENTION_METHOD_UNAVAILABLE',
          tenantId:
            normalizedTenantId,
        },
      );
    }

    const deleted =
      Number(
        result?.deletedCount ??
          result?.deleted ??
          result?.count ??
          0,
      ) || 0;

    this.incrementMetric(
      'retentionPurges',
      deleted,
    );

    this.recordObservation(
      'airtel.callback.warehouse.retention.purge',
      {
        provider:
          PROVIDER,
        tenantId:
          normalizedTenantId,
        deleted,
      },
    );

    return {
      tenantId:
        normalizedTenantId,
      deleted,
      cutoff:
        now,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Archive Marker
   * ---------------------------------------------------------------------------
   *
   * Archiving is distinct from deletion and should normally be implemented by
   * the repository using an atomic update.
   */

  async markArchived(
    tenantId,
    eventId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedEventId =
      normalizeString(
        eventId,
        {
          name:
            'eventId',
          required: true,
          maxLength: 256,
        },
      );

    if (!this.repository) {
      throw new CallbackWarehouseDependencyError(
        'Callback warehouse repository is not configured.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_REPOSITORY_NOT_CONFIGURED',
          tenantId:
            normalizedTenantId,
          eventId:
            normalizedEventId,
        },
      );
    }

    const filter = {
      tenantId:
        normalizedTenantId,
      eventId:
        normalizedEventId,
    };

    const update = {
      $set: {
        status:
          STATUS.ARCHIVED,
        archived:
          true,
        archivedAt:
          this.clock(),
        updatedAt:
          this.clock(),
      },
    };

    if (
      isFunction(
        this.repository.updateOne,
      )
    ) {
      return repositoryCall(
        this.repository,
        'updateOne',
        filter,
        update,
        options,
      );
    }

    if (
      isFunction(
        this.repository.archive,
      )
    ) {
      return repositoryCall(
        this.repository,
        'archive',
        filter,
        options,
      );
    }

    throw new CallbackWarehouseDependencyError(
      'Callback warehouse repository exposes no supported archive method.',
      {
        code:
          'AIRTEL_CALLBACK_WAREHOUSE_ARCHIVE_METHOD_UNAVAILABLE',
        tenantId:
          normalizedTenantId,
        eventId:
          normalizedEventId,
      },
    );
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
      repositoryConfigured:
        Boolean(
          this.repository,
        ),
      repositoryResponsive:
        false,
      tenantIsolation:
        true,
      boundedProjection:
        true,
      monetaryRepresentation:
        true,
      readiness:
        this.isReady(),
    };

    let repositoryError =
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
            await repositoryCall(
              this.repository,
              'health',
              options,
            );

          checks.repositoryResponsive =
            result?.healthy !== false &&
            result?.status !== 'DOWN';
        } else if (
          isFunction(
            this.repository.ping,
          )
        ) {
          const result =
            await repositoryCall(
              this.repository,
              'ping',
              options,
            );

          checks.repositoryResponsive =
            result !== false;
        } else {
          /**
           * Having a configured repository is enough for structural health,
           * but not proof of database reachability.
           */
          checks.repositoryResponsive =
            true;
        }
      } catch (error) {
        repositoryError =
          error;

        checks.repositoryResponsive =
          false;
      }
    }

    const healthy =
      checks.repositoryConfigured &&
      checks.repositoryResponsive &&
      checks.tenantIsolation &&
      checks.boundedProjection &&
      checks.monetaryRepresentation;

    return {
      service:
        this.service,
      provider:
        this.provider,
      version:
        this.version,
      status:
        healthy
          ? 'UP'
          : checks.repositoryConfigured
            ? 'DEGRADED'
            : 'DOWN',
      healthy,
      checks,
      latencyMs:
        Date.now() -
        started,
      repository:
        repositoryError
          ? {
              error:
                repositoryError.code ||
                'REPOSITORY_ERROR',
            }
          : {
              configured:
                checks.repositoryConfigured,
              responsive:
                checks.repositoryResponsive,
            },
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
   *
   * Diagnostics intentionally exclude repository internals, credentials,
   * payloads and error stacks.
   */

  diagnostics() {
    return {
      service:
        this.service,

      provider:
        this.provider,

      version:
        this.version,

      repositoryConfigured:
        Boolean(
          this.repository,
        ),

      startedAt:
        this.startedAt,

      lastWriteAt:
        this.lastWriteAt,

      lastReadAt:
        this.lastReadAt,

      limits: {
        maxDocumentBytes:
          this.maxDocumentBytes,

        maxDepth:
          this.maxDepth,

        maxStringLength:
          this.maxStringLength,

        maxArrayItems:
          this.maxArrayItems,

        maxObjectKeys:
          this.maxObjectKeys,

        retentionDays:
          this.retentionDays,
      },

      metrics:
        {
          ...this.metrics,
        },

      security: {
        sensitiveFieldRedaction:
          true,

        tenantIsolation:
          true,

        deterministicIdentity:
          true,

        exactMoneyRepresentation:
          true,

        rawCredentialPersistence:
          false,

        rawAuthorizationPersistence:
          false,
      },
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Repository Replacement
   * ---------------------------------------------------------------------------
   *
   * Useful during composition/bootstrap and controlled testing.
   */

  setRepository(
    repository,
  ) {
    if (
      !repository ||
      typeof repository !==
        'object'
    ) {
      throw new CallbackWarehouseValidationError(
        'A valid callback warehouse repository is required.',
        {
          code:
            'AIRTEL_CALLBACK_WAREHOUSE_INVALID_REPOSITORY',
        },
      );
    }

    this.repository =
      repository;

    return this;
  }

  getRepository() {
    return this.repository;
  }

  /**
   * ---------------------------------------------------------------------------
   * Lifecycle
   * ---------------------------------------------------------------------------
   */

  async initialize(
    options = {},
  ) {
    if (
      this.repository &&
      isFunction(
        this.repository.initialize,
      )
    ) {
      await repositoryCall(
        this.repository,
        'initialize',
        options,
      );
    }

    return {
      status:
        this.isReady()
          ? 'READY'
          : 'DEGRADED',
      service:
        this.service,
      provider:
        this.provider,
    };
  }

  async close(
    options = {},
  ) {
    if (
      this.repository &&
      isFunction(
        this.repository.close,
      )
    ) {
      await repositoryCall(
        this.repository,
        'close',
        options,
      );
    }

    return {
      status:
        'CLOSED',
      service:
        this.service,
      provider:
        this.provider,
    };
  }
}

/**
 * =============================================================================
 * Factory
 * =============================================================================
 */

function createCallbackWarehouse(
  options = {},
) {
  return new CallbackWarehouse(
    options,
  );
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 *
 * The singleton is deliberately repository-unconfigured until the application
 * composition root injects the canonical repository.
 *
 * This prevents import-time database side effects and avoids silently writing
 * analytics data to an unintended store.
 * =============================================================================
 */

const callbackWarehouse =
  createCallbackWarehouse();

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports = callbackWarehouse;

/**
 * Named properties on the exported singleton preserve CommonJS compatibility
 * with callers that import either:
 *
 *   const callbackWarehouse = require('./callbackWarehouse');
 *
 * or:
 *
 *   const {
 *     CallbackWarehouse,
 *     createCallbackWarehouse,
 *   } = require('./callbackWarehouse');
 */
module.exports.CallbackWarehouse =
  CallbackWarehouse;

module.exports.CallbackWarehouseError =
  CallbackWarehouseError;

module.exports.CallbackWarehouseValidationError =
  CallbackWarehouseValidationError;

module.exports.CallbackWarehouseDependencyError =
  CallbackWarehouseDependencyError;

module.exports.CallbackWarehouseConflictError =
  CallbackWarehouseConflictError;

module.exports.createCallbackWarehouse =
  createCallbackWarehouse;

module.exports.normalizeCallbackDocument =
  normalizeCallbackDocument;

module.exports.sanitizeValue =
  sanitizeValue;

module.exports.createDeterministicEventId =
  createDeterministicEventId;

module.exports.sha256 =
  sha256;

module.exports.STATUS =
  STATUS;

module.exports.TRUST_LEVEL =
  TRUST_LEVEL;

module.exports.VERSION =
  VERSION;