/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/settlement/idempotencyManager.js
 *
 * Architectural Role:
 *   Payment-settlement idempotency coordination component.
 *
 * Purpose:
 *   Prevent duplicate processing of payment-provider callbacks, settlement
 *   notifications, webhook retries, and other externally retried settlement
 *   messages across multiple application instances.
 *
 * Responsibilities:
 *   - Generate deterministic request fingerprints.
 *   - Normalize and scope idempotency keys.
 *   - Atomically reserve processing ownership.
 *   - Detect an existing completed/failed/in-progress operation.
 *   - Prevent concurrent workers from processing the same operation.
 *   - Support processing leases and stale-operation recovery.
 *   - Persist bounded callback/result metadata in Redis.
 *   - Return deterministic state information to settlement services.
 *
 * Non-Responsibilities:
 *   - This component does NOT post to the financial ledger.
 *   - This component does NOT mutate Wallet, Account, Balance, or Transaction.
 *   - This component does NOT validate payment-provider signatures.
 *   - This component does NOT authorize tenants/users.
 *   - This component does NOT decide whether a callback is financially valid.
 *   - This component does NOT replace Payment / PaymentIntent state.
 *
 * Production Architecture:
 *
 *   Provider callback
 *         |
 *         v
 *   Signature verification
 *         |
 *         v
 *   IdempotencyManager
 *         |
 *         +---- already completed ----> return prior result
 *         |
 *         +---- processing lease ------> retry / acknowledge / wait
 *         |
 *         +---- new -------------------> reserve ownership
 *                                           |
 *                                           v
 *                                  Settlement Service
 *                                           |
 *                         +-----------------+------------------+
 *                         |                                    |
 *                         v                                    v
 *                 FinancialTransactionService             AuditLog
 *                         |
 *                    Ledger / Wallet / Account
 *
 * Storage:
 *   Redis is used for distributed coordination and short/medium-lived
 *   idempotency state.
 *
 * Important:
 *   A Redis idempotency record is a coordination/control record. It is NOT
 *   the accounting source of truth.
 *
 *   Financial settlement MUST remain durable in MongoDB through the canonical
 *   transaction/payment/ledger workflow.
 *
 * Redis Requirements:
 *   The supplied Redis client must support:
 *     - set(key, value, options...)
 *     - get(key)
 *     - del(key)
 *     - eval(script, options)
 *
 *   The implementation supports both node-redis and compatible Redis clients
 *   through a small command adapter.
 *
 * Security Principles:
 *   - Never persist plaintext provider secrets or access tokens.
 *   - Do not use raw callback payloads as unbounded Redis values.
 *   - Fingerprints use SHA-256.
 *   - Reservation ownership uses cryptographically random tokens.
 *   - Tenant/provider/event namespaces are part of the Redis key.
 *   - Stored result/error payloads are bounded.
 *   - Completion/failure require the current reservation owner.
 *   - Expired processing leases can be reclaimed safely.
 *
 * Module Format:
 *   Native ECMAScript Modules (ESM).
 *
 * =============================================================================
 */

import crypto from 'node:crypto';

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

export const IDEMPOTENCY_STATUS = Object.freeze({
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

export const IDEMPOTENCY_OUTCOME = Object.freeze({
  RESERVED: 'RESERVED',
  ALREADY_PROCESSING: 'ALREADY_PROCESSING',
  ALREADY_COMPLETED: 'ALREADY_COMPLETED',
  ALREADY_FAILED: 'ALREADY_FAILED',
  RECLAIMED: 'RECLAIMED',
  NOT_FOUND: 'NOT_FOUND',
  OWNERSHIP_REQUIRED: 'OWNERSHIP_REQUIRED',
  KEY_CONFLICT: 'KEY_CONFLICT',
});

export const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export const DEFAULT_PROCESSING_TTL_SECONDS = 15 * 60;

export const DEFAULT_RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export const DEFAULT_MAX_RESULT_BYTES = 32 * 1024;

export const DEFAULT_MAX_ERROR_BYTES = 8 * 1024;

export const DEFAULT_MAX_KEY_LENGTH = 512;

export const DEFAULT_NAMESPACE = 'titech:payment:settlement:idempotency';

/**
 * =============================================================================
 * ERRORS
 * =============================================================================
 */

export class IdempotencyManagerError extends Error {
  constructor(message, code = 'IDEMPOTENCY_MANAGER_ERROR') {
    super(message);
    this.name = 'IdempotencyManagerError';
    this.code = code;
  }
}

export class IdempotencyConfigurationError extends IdempotencyManagerError {
  constructor(message) {
    super(message, 'IDEMPOTENCY_CONFIGURATION_ERROR');
    this.name = 'IdempotencyConfigurationError';
  }
}

export class IdempotencyOwnershipError extends IdempotencyManagerError {
  constructor(message) {
    super(message, 'IDEMPOTENCY_OWNERSHIP_ERROR');
    this.name = 'IdempotencyOwnershipError';
  }
}

export class IdempotencyKeyConflictError extends IdempotencyManagerError {
  constructor(message) {
    super(message, 'IDEMPOTENCY_KEY_CONFLICT');
    this.name = 'IdempotencyKeyConflictError';
  }
}

/**
 * =============================================================================
 * INTERNAL REDIS LUA SCRIPTS
 * =============================================================================
 *
 * Redis-side atomicity is important here.
 *
 * A read followed by a write in JavaScript is NOT sufficient because multiple
 * settlement workers may receive the same provider callback concurrently.
 */

/**
 * Reserve if absent.
 *
 * KEYS[1] = idempotency key
 * ARGV[1] = serialized record
 * ARGV[2] = TTL milliseconds
 *
 * Returns:
 *   1 -> reserved
 *   0 -> already exists
 */
const RESERVE_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 1 then
    return 0
  end

  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
`;

/**
 * Complete only if the current owner matches.
 *
 * KEYS[1] = idempotency key
 * ARGV[1] = expected owner token
 * ARGV[2] = completed serialized record
 * ARGV[3] = TTL milliseconds
 */
const COMPLETE_SCRIPT = `
  local current = redis.call('GET', KEYS[1])

  if not current then
    return -1
  end

  local ok, parsed = pcall(cjson.decode, current)

  if not ok or not parsed then
    return -2
  end

  if parsed.status ~= 'PROCESSING' then
    return 0
  end

  if parsed.ownerToken ~= ARGV[1] then
    return -3
  end

  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
`;

/**
 * Fail only if the current owner matches.
 */
const FAIL_SCRIPT = `
  local current = redis.call('GET', KEYS[1])

  if not current then
    return -1
  end

  local ok, parsed = pcall(cjson.decode, current)

  if not ok or not parsed then
    return -2
  end

  if parsed.status ~= 'PROCESSING' then
    return 0
  end

  if parsed.ownerToken ~= ARGV[1] then
    return -3
  end

  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
`;

/**
 * Refresh processing lease only when ownership still matches.
 */
const RENEW_SCRIPT = `
  local current = redis.call('GET', KEYS[1])

  if not current then
    return -1
  end

  local ok, parsed = pcall(cjson.decode, current)

  if not ok or not parsed then
    return -2
  end

  if parsed.status ~= 'PROCESSING' then
    return 0
  end

  if parsed.ownerToken ~= ARGV[1] then
    return -3
  end

  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
`;

/**
 * Reclaim a stale processing record by replacing ownership atomically.
 */
const RECLAIM_SCRIPT = `
  local current = redis.call('GET', KEYS[1])

  if not current then
    return 0
  end

  local ok, parsed = pcall(cjson.decode, current)

  if not ok or not parsed then
    return -2
  end

  if parsed.status ~= 'PROCESSING' then
    return -1
  end

  local now = tonumber(ARGV[1])
  local newRecord = ARGV[2]
  local ttlMs = ARGV[3]

  if not parsed.leaseExpiresAt then
    return -3
  end

  if tonumber(parsed.leaseExpiresAt) > now then
    return 0
  end

  redis.call('SET', KEYS[1], newRecord, 'PX', ttlMs)
  return 1
`;

/**
 * =============================================================================
 * SERIALIZATION HELPERS
 * =============================================================================
 */

/**
 * Stable JSON serializer.
 *
 * JavaScript object insertion order is generally deterministic, but an
 * idempotency fingerprint should not depend on caller property order.
 *
 * @param {*} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();

    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(value[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(String(value));
}

/**
 * SHA-256 fingerprint.
 *
 * @param {*} value
 * @returns {string}
 */
export function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(value),
      'utf8',
    )
    .digest('hex');
}

/**
 * Generate cryptographically random ownership token.
 *
 * @returns {string}
 */
function generateOwnerToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Bound an arbitrary serializable value before storing it.
 *
 * @param {*} value
 * @param {number} maxBytes
 * @param {string} fieldName
 * @returns {Object|null}
 */
function sanitizeStoredValue(value, maxBytes, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }

  let serialized;

  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(
      `${fieldName} must be JSON serializable`,
    );
  }

  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new RangeError(
      `${fieldName} exceeds the configured storage limit of ${maxBytes} bytes`,
    );
  }

  return value;
}

/**
 * Normalize provider/event identifiers used in key namespaces.
 *
 * @param {*} value
 * @param {string} field
 * @returns {string}
 */
function normalizeSegment(value, field) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    throw new TypeError(`${field} is required`);
  }

  const normalized = String(value).trim();

  if (!normalized) {
    throw new TypeError(`${field} is required`);
  }

  if (normalized.length > 256) {
    throw new RangeError(
      `${field} exceeds the maximum supported length`,
    );
  }

  /**
   * Prevent accidental Redis namespace traversal.
   */
  if (
    normalized.includes(':') ||
    normalized.includes('\n') ||
    normalized.includes('\r')
  ) {
    throw new TypeError(
      `${field} contains unsupported key characters`,
    );
  }

  return normalized;
}

/**
 * Convert seconds to milliseconds with validation.
 *
 * @param {*} value
 * @param {string} name
 * @returns {number}
 */
function secondsToMilliseconds(value, name) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(
      `${name} must be a positive safe integer`,
    );
  }

  return value * 1000;
}

/**
 * =============================================================================
 * CLASS
 * =============================================================================
 */

class IdempotencyManager {
  /**
   * @param {Object} options
   * @param {Object} options.redis
   * @param {string} [options.namespace]
   * @param {number} [options.ttlSeconds]
   * @param {number} [options.processingTtlSeconds]
   * @param {number} [options.resultTtlSeconds]
   * @param {number} [options.maxResultBytes]
   * @param {number} [options.maxErrorBytes]
   */
  constructor({
    redis = null,
    namespace = DEFAULT_NAMESPACE,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    processingTtlSeconds = DEFAULT_PROCESSING_TTL_SECONDS,
    resultTtlSeconds = DEFAULT_RESULT_TTL_SECONDS,
    maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
    maxErrorBytes = DEFAULT_MAX_ERROR_BYTES,
  } = {}) {
    this.redis = redis;
    this.namespace = normalizeSegment(
      namespace,
      'namespace',
    );

    this.ttlSeconds = ttlSeconds;
    this.processingTtlSeconds = processingTtlSeconds;
    this.resultTtlSeconds = resultTtlSeconds;

    this.maxResultBytes = maxResultBytes;
    this.maxErrorBytes = maxErrorBytes;
  }

  /**
   * ===========================================================================
   * CONFIGURATION
   * ===========================================================================
   */

  setRedis(redis) {
    this.assertRedisClient(redis);
    this.redis = redis;
    return this;
  }

  isConfigured() {
    return Boolean(this.redis);
  }

  assertConfigured() {
    if (!this.redis) {
      throw new IdempotencyConfigurationError(
        'Redis client is not configured for IdempotencyManager',
      );
    }
  }

  assertRedisClient(redis) {
    if (!redis) {
      throw new IdempotencyConfigurationError(
        'A Redis client is required',
      );
    }

    const supported =
      typeof redis.set === 'function' &&
      typeof redis.get === 'function' &&
      (
        typeof redis.eval === 'function' ||
        typeof redis.evalsha === 'function'
      );

    if (!supported) {
      throw new IdempotencyConfigurationError(
        'Redis client must support set(), get(), and eval()/evalsha()',
      );
    }
  }

  /**
   * ===========================================================================
   * KEY GENERATION
   * ===========================================================================
   */

  /**
   * Generate a deterministic hash for a payment callback payload.
   *
   * The caller should preferably pass a canonical provider-specific subset
   * rather than an entire HTTP request object.
   *
   * @param {*} payload
   * @returns {string}
   */
  generateFingerprint(payload) {
    return sha256(payload);
  }

  /**
   * Backwards-compatible alias.
   *
   * @param {*} payload
   * @returns {string}
   */
  generateKey(payload) {
    return this.generateFingerprint(payload);
  }

  /**
   * Generate a tenant/provider/event-scoped Redis key.
   *
   * @param {Object} options
   * @param {string} options.tenantId
   * @param {string} options.provider
   * @param {string} options.eventId
   * @param {string} [options.key]
   * @returns {string}
   */
  buildKey({
    tenantId,
    provider,
    eventId,
    key = null,
  } = {}) {
    const tenant = normalizeSegment(
      tenantId,
      'tenantId',
    );

    const normalizedProvider = normalizeSegment(
      provider,
      'provider',
    );

    const normalizedEventId = normalizeSegment(
      eventId,
      'eventId',
    );

    const identifier =
      key === null
        ? normalizedEventId
        : normalizeSegment(key, 'idempotencyKey');

    const redisKey = [
      this.namespace,
      tenant,
      normalizedProvider,
      identifier,
    ].join(':');

    if (redisKey.length > DEFAULT_MAX_KEY_LENGTH) {
      throw new RangeError(
        `Generated idempotency key exceeds ${DEFAULT_MAX_KEY_LENGTH} characters`,
      );
    }

    return redisKey;
  }

  /**
   * ===========================================================================
   * RECORD CREATION
   * ===========================================================================
   */

  createProcessingRecord({
    tenantId,
    provider,
    eventId,
    idempotencyKey,
    fingerprint,
    ownerToken,
    metadata = null,
  }) {
    const now = Date.now();

    return {
      version: 1,
      status: IDEMPOTENCY_STATUS.PROCESSING,

      tenantId: String(tenantId),
      provider: String(provider),
      eventId: String(eventId),
      idempotencyKey: String(idempotencyKey),

      fingerprint,

      ownerToken,

      createdAt: now,
      updatedAt: now,

      leaseExpiresAt:
        now +
        secondsToMilliseconds(
          this.processingTtlSeconds,
          'processingTtlSeconds',
        ),

      attempts: 1,

      metadata: sanitizeStoredValue(
        metadata,
        this.maxResultBytes,
        'metadata',
      ),
    };
  }

  /**
   * ===========================================================================
   * CHECK
   * ===========================================================================
   */

  /**
   * Retrieve the current idempotency record.
   *
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async check(key) {
    this.assertConfigured();

    const normalizedKey = normalizeSegment(
      key,
      'key',
    );

    const raw = await this.redis.get(normalizedKey);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new IdempotencyManagerError(
        `Stored idempotency record is invalid: ${error.message}`,
        'CORRUPT_IDEMPOTENCY_RECORD',
      );
    }
  }

  /**
   * ===========================================================================
   * RESERVATION
   * ===========================================================================
   */

  /**
   * Reserve an idempotency key.
   *
   * @returns {Promise<Object>}
   */
  async reserve({
    tenantId,
    provider,
    eventId,
    idempotencyKey = null,
    fingerprint = null,
    payload = null,
    metadata = null,
  } = {}) {
    this.assertConfigured();

    const effectiveKey =
      idempotencyKey ||
      this.generateFingerprint(payload);

    const redisKey = this.buildKey({
      tenantId,
      provider,
      eventId,
      key: effectiveKey,
    });

    const effectiveFingerprint =
      fingerprint ||
      this.generateFingerprint(payload);

    const ownerToken = generateOwnerToken();

    const record = this.createProcessingRecord({
      tenantId,
      provider,
      eventId,
      idempotencyKey: effectiveKey,
      fingerprint: effectiveFingerprint,
      ownerToken,
      metadata,
    });

    const serialized = JSON.stringify(record);

    const ttlMs = secondsToMilliseconds(
      this.processingTtlSeconds,
      'processingTtlSeconds',
    );

    const result = await this.redis.eval(
      RESERVE_SCRIPT,
      {
        keys: [redisKey],
        arguments: [
          serialized,
          String(ttlMs),
        ],
      },
    );

    /**
     * Some Redis clients return strings for Lua numeric replies.
     */
    if (Number(result) === 1) {
      return {
        outcome: IDEMPOTENCY_OUTCOME.RESERVED,
        reserved: true,
        key: redisKey,
        ownerToken,
        record,
      };
    }

    const existing = await this.check(redisKey);

    if (!existing) {
      throw new IdempotencyManagerError(
        'Reservation was rejected but no existing record could be retrieved',
        'RESERVATION_STATE_UNAVAILABLE',
      );
    }

    if (
      existing.fingerprint &&
      effectiveFingerprint &&
      existing.fingerprint !== effectiveFingerprint
    ) {
      throw new IdempotencyKeyConflictError(
        'The idempotency key already exists for a different payload fingerprint',
      );
    }

    if (
      existing.status === IDEMPOTENCY_STATUS.COMPLETED
    ) {
      return {
        outcome: IDEMPOTENCY_OUTCOME.ALREADY_COMPLETED,
        reserved: false,
        duplicate: true,
        key: redisKey,
        record: existing,
        result: existing.result ?? null,
      };
    }

    if (
      existing.status === IDEMPOTENCY_STATUS.FAILED
    ) {
      return {
        outcome: IDEMPOTENCY_OUTCOME.ALREADY_FAILED,
        reserved: false,
        duplicate: true,
        key: redisKey,
        record: existing,
        error: existing.error ?? null,
      };
    }

    return {
      outcome: IDEMPOTENCY_OUTCOME.ALREADY_PROCESSING,
      reserved: false,
      duplicate: true,
      key: redisKey,
      record: existing,
    };
  }

  /**
   * ===========================================================================
   * COMPLETE
   * ===========================================================================
   */

  /**
   * Mark an owned reservation as completed.
   *
   * The owner token prevents one worker from completing another worker's
   * reservation after a lease has been reclaimed.
   *
   * @param {string} key
   * @param {string} ownerToken
   * @param {*} result
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async complete(
    key,
    ownerToken,
    result = null,
    {
      metadata = null,
    } = {},
  ) {
    this.assertConfigured();

    const normalizedKey = normalizeSegment(
      key,
      'key',
    );

    if (!ownerToken) {
      throw new IdempotencyOwnershipError(
        'ownerToken is required to complete an idempotency reservation',
      );
    }

    const safeResult = sanitizeStoredValue(
      result,
      this.maxResultBytes,
      'result',
    );

    const safeMetadata = sanitizeStoredValue(
      metadata,
      this.maxResultBytes,
      'metadata',
    );

    const now = Date.now();

    const completedRecord = {
      version: 1,
      status: IDEMPOTENCY_STATUS.COMPLETED,
      updatedAt: now,
      completedAt: now,
      result: safeResult,
      metadata: safeMetadata,
    };

    const ttlMs = secondsToMilliseconds(
      this.resultTtlSeconds,
      'resultTtlSeconds',
    );

    const luaResult = await this.redis.eval(
      COMPLETE_SCRIPT,
      {
        keys: [normalizedKey],
        arguments: [
          String(ownerToken),
          JSON.stringify(completedRecord),
          String(ttlMs),
        ],
      },
    );

    const code = Number(luaResult);

    if (code === 1) {
      return {
        outcome: IDEMPOTENCY_OUTCOME.RESERVED,
        completed: true,
        key: normalizedKey,
        record: completedRecord,
      };
    }

    if (code === 0) {
      const existing = await this.check(normalizedKey);

      return {
        outcome:
          existing?.status === IDEMPOTENCY_STATUS.COMPLETED
            ? IDEMPOTENCY_OUTCOME.ALREADY_COMPLETED
            : IDEMPOTENCY_OUTCOME.ALREADY_PROCESSING,
        completed: false,
        key: normalizedKey,
        record: existing,
        result: existing?.result ?? null,
      };
    }

    if (code === -1) {
      throw new IdempotencyManagerError(
        'Cannot complete idempotency record because it no longer exists',
        'IDEMPOTENCY_RECORD_NOT_FOUND',
      );
    }

    if (code === -3) {
      throw new IdempotencyOwnershipError(
        'Cannot complete idempotency record because the reservation owner is no longer valid',
      );
    }

    throw new IdempotencyManagerError(
      'Unable to complete idempotency record',
      'IDEMPOTENCY_COMPLETE_FAILED',
    );
  }

  /**
   * ===========================================================================
   * FAIL
   * ===========================================================================
   */

  /**
   * Mark an owned reservation as failed.
   *
   * A failure record is retained so repeated callbacks do not blindly retry the
   * same business operation forever. Retry policy remains a business/service
   * decision.
   *
   * @param {string} key
   * @param {string} ownerToken
   * @param {Error|Object|string|null} error
   * @returns {Promise<Object>}
   */
  async fail(
    key,
    ownerToken,
    error = null,
    {
      metadata = null,
    } = {},
  ) {
    this.assertConfigured();

    const normalizedKey = normalizeSegment(
      key,
      'key',
    );

    if (!ownerToken) {
      throw new IdempotencyOwnershipError(
        'ownerToken is required to fail an idempotency reservation',
      );
    }

    const normalizedError =
      this.normalizeError(error);

    const safeError = sanitizeStoredValue(
      normalizedError,
      this.maxErrorBytes,
      'error',
    );

    const safeMetadata = sanitizeStoredValue(
      metadata,
      this.maxErrorBytes,
      'metadata',
    );

    const now = Date.now();

    const failedRecord = {
      version: 1,
      status: IDEMPOTENCY_STATUS.FAILED,
      updatedAt: now,
      failedAt: now,
      error: safeError,
      metadata: safeMetadata,
    };

    const ttlMs = secondsToMilliseconds(
      this.resultTtlSeconds,
      'resultTtlSeconds',
    );

    const luaResult = await this.redis.eval(
      FAIL_SCRIPT,
      {
        keys: [normalizedKey],
        arguments: [
          String(ownerToken),
          JSON.stringify(failedRecord),
          String(ttlMs),
        ],
      },
    );

    const code = Number(luaResult);

    if (code === 1) {
      return {
        outcome: IDEMPOTENCY_OUTCOME.RESERVED,
        failed: true,
        key: normalizedKey,
        record: failedRecord,
      };
    }

    if (code === 0) {
      const existing = await this.check(normalizedKey);

      return {
        outcome:
          existing?.status === IDEMPOTENCY_STATUS.FAILED
            ? IDEMPOTENCY_OUTCOME.ALREADY_FAILED
            : IDEMPOTENCY_OUTCOME.ALREADY_PROCESSING,
        failed: false,
        key: normalizedKey,
        record: existing,
      };
    }

    if (code === -1) {
      throw new IdempotencyManagerError(
        'Cannot fail idempotency record because it no longer exists',
        'IDEMPOTENCY_RECORD_NOT_FOUND',
      );
    }

    if (code === -3) {
      throw new IdempotencyOwnershipError(
        'Cannot fail idempotency record because the reservation owner is no longer valid',
      );
    }

    throw new IdempotencyManagerError(
      'Unable to mark idempotency record as failed',
      'IDEMPOTENCY_FAIL_FAILED',
    );
  }

  /**
   * ===========================================================================
   * LEASE MANAGEMENT
   * ===========================================================================
   */

  /**
   * Renew an active processing lease.
   *
   * @param {string} key
   * @param {string} ownerToken
   * @param {number} [processingTtlSeconds]
   * @returns {Promise<boolean>}
   */
  async renew(
    key,
    ownerToken,
    processingTtlSeconds = this.processingTtlSeconds,
  ) {
    this.assertConfigured();

    const normalizedKey = normalizeSegment(
      key,
      'key',
    );

    if (!ownerToken) {
      throw new IdempotencyOwnershipError(
        'ownerToken is required to renew an idempotency reservation',
      );
    }

    const ttlMs = secondsToMilliseconds(
      processingTtlSeconds,
      'processingTtlSeconds',
    );

    const result = await this.redis.eval(
      RENEW_SCRIPT,
      {
        keys: [normalizedKey],
        arguments: [
          String(ownerToken),
          String(ttlMs),
        ],
      },
    );

    const code = Number(result);

    if (code === 1) {
      return true;
    }

    if (code === -3) {
      throw new IdempotencyOwnershipError(
        'Cannot renew idempotency reservation because ownership has been lost',
      );
    }

    if (code === 0) {
      return false;
    }

    if (code === -1) {
      return false;
    }

    throw new IdempotencyManagerError(
      'Unable to renew idempotency reservation',
      'IDEMPOTENCY_RENEW_FAILED',
    );
  }

  /**
   * Reclaim an expired processing lease.
   *
   * This is useful when a worker dies after reservation but before completion.
   *
   * The new worker receives a new ownership token.
   *
   * @param {string} key
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async reclaim(
    key,
    {
      tenantId,
      provider,
      eventId,
      fingerprint,
      metadata = null,
    } = {},
  ) {
    this.assertConfigured();

    const normalizedKey = normalizeSegment(
      key,
      'key',
    );

    const ownerToken = generateOwnerToken();

    const record = this.createProcessingRecord({
      tenantId,
      provider,
      eventId,
      idempotencyKey: normalizedKey,
      fingerprint,
      ownerToken,
      metadata,
    });

    const now = Date.now();

    const ttlMs = secondsToMilliseconds(
      this.processingTtlSeconds,
      'processingTtlSeconds',
    );

    const result = await this.redis.eval(
      RECLAIM_SCRIPT,
      {
        keys: [normalizedKey],
        arguments: [
          String(now),
          JSON.stringify(record),
          String(ttlMs),
        ],
      },
    );

    const code = Number(result);

    if (code === 1) {
      return {
        outcome: IDEMPOTENCY_OUTCOME.RECLAIMED,
        reclaimed: true,
        key: normalizedKey,
        ownerToken,
        record,
      };
    }

    if (code === 0) {
      const existing = await this.check(normalizedKey);

      return {
        outcome: IDEMPOTENCY_OUTCOME.ALREADY_PROCESSING,
        reclaimed: false,
        key: normalizedKey,
        record: existing,
      };
    }

    if (code === -1) {
      const existing = await this.check(normalizedKey);

      return {
        outcome:
          existing?.status === IDEMPOTENCY_STATUS.COMPLETED
            ? IDEMPOTENCY_OUTCOME.ALREADY_COMPLETED
            : IDEMPOTENCY_OUTCOME.ALREADY_FAILED,
        reclaimed: false,
        key: normalizedKey,
        record: existing,
      };
    }

    throw new IdempotencyManagerError(
      'Unable to reclaim stale idempotency reservation',
      'IDEMPOTENCY_RECLAIM_FAILED',
    );
  }

  /**
   * ===========================================================================
   * ERROR NORMALIZATION
   * ===========================================================================
   */

  normalizeError(error) {
    if (error === null || error === undefined) {
      return {
        code: 'UNKNOWN_ERROR',
        message: 'Unknown settlement processing error',
      };
    }

    if (typeof error === 'string') {
      return {
        code: 'SETTLEMENT_ERROR',
        message: error,
      };
    }

    if (error instanceof Error) {
      return {
        code:
          error.code ||
          error.name ||
          'SETTLEMENT_ERROR',

        message:
          error.message ||
          'Settlement processing failed',
      };
    }

    if (typeof error === 'object') {
      return {
        code:
          error.code ||
          error.name ||
          'SETTLEMENT_ERROR',

        message:
          error.message ||
          'Settlement processing failed',
      };
    }

    return {
      code: 'SETTLEMENT_ERROR',
      message: String(error),
    };
  }

  /**
   * ===========================================================================
   * CONDITIONAL STATE HELPERS
   * ===========================================================================
   */

  async isCompleted(key) {
    const record = await this.check(key);

    return (
      record?.status ===
      IDEMPOTENCY_STATUS.COMPLETED
    );
  }

  async isProcessing(key) {
    const record = await this.check(key);

    return (
      record?.status ===
      IDEMPOTENCY_STATUS.PROCESSING
    );
  }

  async isFailed(key) {
    const record = await this.check(key);

    return (
      record?.status ===
      IDEMPOTENCY_STATUS.FAILED
    );
  }

  /**
   * ===========================================================================
   * SAFE KEY DELETION
   * ===========================================================================
   *
   * Deletion is intentionally restricted.
   *
   * Normal application flow should allow TTL expiry rather than deleting
   * idempotency state immediately, because early deletion can re-enable a
   * duplicate provider callback.
   */

  async release(
    key,
    ownerToken,
  ) {
    this.assertConfigured();

    const normalizedKey = normalizeSegment(
      key,
      'key',
    );

    const existing = await this.check(
      normalizedKey,
    );

    if (!existing) {
      return false;
    }

    if (
      existing.status !==
      IDEMPOTENCY_STATUS.PROCESSING
    ) {
      return false;
    }

    if (
      existing.ownerToken !== ownerToken
    ) {
      throw new IdempotencyOwnershipError(
        'Cannot release idempotency reservation because ownership has been lost',
      );
    }

    /**
     * We intentionally do NOT delete the record here.
     *
     * A failed operation should normally be marked FAILED, allowing the
     * application/service layer to decide whether and how it may be retried.
     */
    return false;
  }

  /**
   * ===========================================================================
   * DIAGNOSTICS
   * ===========================================================================
   */

  async healthCheck() {
    this.assertConfigured();

    if (typeof this.redis.ping !== 'function') {
      return {
        healthy: true,
        pingSupported: false,
      };
    }

    const response = await this.redis.ping();

    return {
      healthy:
        response === 'PONG' ||
        response === 'pong',
      pingSupported: true,
    };
  }
}

/**
 * =============================================================================
 * SINGLETON
 * =============================================================================
 *
 * The singleton is intentionally NOT initialized with a fake/in-memory store.
 *
 * The application bootstrap should inject the shared Redis client once Redis
 * has been initialized.
 */

export const idempotencyManager =
  new IdempotencyManager();

export default idempotencyManager;

/**
 * Example bootstrap integration:
 *
 *   import idempotencyManager from
 *     './modules/payment/settlement/idempotencyManager.js';
 *
 *   idempotencyManager.setRedis(redisClient);
 *
 * Example settlement flow:
 *
 *   const fingerprint =
 *     idempotencyManager.generateFingerprint({
 *       provider,
 *       eventId,
 *       amount,
 *       currency,
 *       reference,
 *       status,
 *     });
 *
 *   const reservation =
 *     await idempotencyManager.reserve({
 *       tenantId,
 *       provider,
 *       eventId,
 *       idempotencyKey: providerEventId,
 *       fingerprint,
 *     });
 *
 *   if (
 *     reservation.outcome ===
 *     'ALREADY_COMPLETED'
 *   ) {
 *     return reservation.result;
 *   }
 *
 *   if (
 *     reservation.outcome ===
 *     'ALREADY_PROCESSING'
 *   ) {
 *     // Do not process the settlement a second time.
 *     // Provider-specific acknowledgment/retry policy belongs to the service.
 *     return {
 *       accepted: true,
 *       duplicate: true,
 *       processing: true,
 *     };
 *   }
 *
 *   try {
 *     const result =
 *       await paymentSettlementService.settle(...);
 *
 *     await idempotencyManager.complete(
 *       reservation.key,
 *       reservation.ownerToken,
 *       result,
 *     );
 *
 *     return result;
 *   } catch (error) {
 *     await idempotencyManager.fail(
 *       reservation.key,
 *       reservation.ownerToken,
 *       error,
 *     );
 *
 *     throw error;
 *   }
 *
 * IMPORTANT:
 *   Signature verification MUST happen before reservation when the incoming
 *   callback can be forged.
 *
 * IMPORTANT:
 *   The provider event ID should be the preferred idempotency key whenever the
 *   provider supplies a stable unique event/reference identifier. Payload
 *   hashing should be a fallback or a secondary consistency fingerprint, not
 *   the primary substitute for provider event identity.
 */