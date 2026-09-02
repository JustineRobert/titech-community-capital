
// ============================================================================
// TITech Community Capital LTD
// Idempotency Utility
// File: utils/idempotency.js
// ============================================================================
//
// Enterprise-grade distributed idempotency infrastructure.
//
// Responsibilities:
//   - Atomically reserve idempotency keys.
//   - Prevent duplicate financial execution.
//   - Support tenant-scoped idempotency.
//   - Preserve request fingerprints.
//   - Track PROCESSING / COMPLETED / FAILED states.
//   - Store/replay successful responses.
//   - Provide safe Redis-backed metadata.
//   - Support retry and recovery workflows.
//
// IMPORTANT:
//
// This module provides the distributed idempotency primitive.
//
// It does NOT replace the financial transaction boundary.
//
// The caller must still ensure:
//
//   Idempotency reservation
//          |
//          v
//   Financial transaction
//          |
//          v
//   Commit
//          |
//          v
//   Mark idempotency COMPLETED
//
// ============================================================================

'use strict';

const crypto = require('crypto');

const redis = require('./redis');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_TTL_SECONDS = 86400; // 24 hours

const MIN_TTL_SECONDS = 1;

const MAX_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const DEFAULT_PROCESSING_TTL_SECONDS = 15 * 60; // 15 minutes

const KEY_PREFIX = 'idempotency';

const VERSION = 1;

/**
 * Idempotency lifecycle.
 */
const STATUS = Object.freeze({

    PROCESSING:
        'PROCESSING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED'

});

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

class IdempotencyError extends Error {

    constructor(
        message,
        {
            code = 'IDEMPOTENCY_ERROR',
            details = {},
            cause = null
        } = {}
    ) {

        super(message);

        this.name =
            'IdempotencyError';

        this.code =
            code;

        this.details =
            details;

        this.cause =
            cause;

        this.timestamp =
            new Date();

        if (
            Error.captureStackTrace
        ) {

            Error.captureStackTrace(
                this,
                this.constructor
            );

        }

    }

    toJSON() {

        return {

            name:
                this.name,

            code:
                this.code,

            message:
                this.message,

            details:
                this.details,

            timestamp:
                this.timestamp

        };

    }

}

/**
 * ============================================================================
 * Idempotency Conflict Error
 * ============================================================================
 *
 * Raised when the same idempotency key is reused for a different request.
 * ============================================================================
 */

class IdempotencyConflictError
    extends IdempotencyError {

    constructor(
        message = 'Idempotency key has already been used with a different request',
        details = {}
    ) {

        super(

            message,

            {

                code:
                    'IDEMPOTENCY_CONFLICT',

                details

            }

        );

        this.name =
            'IdempotencyConflictError';

    }

}

/**
 * ============================================================================
 * Redis Helpers
 * ============================================================================
 */

function assertRedis() {

    if (
        !redis ||
        typeof redis.set !== 'function'
    ) {

        throw new IdempotencyError(

            'Redis idempotency store is unavailable',

            {

                code:
                    'IDEMPOTENCY_STORE_UNAVAILABLE'

            }

        );

    }

}

/**
 * ============================================================================
 * Validate Key
 * ============================================================================
 */

function validateKey(key) {

    if (
        key === undefined ||
        key === null ||
        String(key).trim() === ''
    ) {

        throw new IdempotencyError(

            'Idempotency key required',

            {

                code:
                    'IDEMPOTENCY_KEY_REQUIRED'

            }

        );

    }

    const normalized =
        String(key).trim();

    if (
        normalized.length > 255
    ) {

        throw new IdempotencyError(

            'Idempotency key exceeds maximum length',

            {

                code:
                    'IDEMPOTENCY_KEY_TOO_LONG',

                maxLength:
                    255

            }

        );

    }

    return normalized;

}

/**
 * ============================================================================
 * Validate TTL
 * ============================================================================
 */

function normalizeTTL(
    ttlSeconds,
    fallback = DEFAULT_TTL_SECONDS
) {

    const ttl =
        Number(ttlSeconds);

    if (
        !Number.isFinite(ttl)
    ) {

        return fallback;

    }

    const normalized =
        Math.floor(ttl);

    if (
        normalized < MIN_TTL_SECONDS
    ) {

        return MIN_TTL_SECONDS;

    }

    if (
        normalized > MAX_TTL_SECONDS
    ) {

        return MAX_TTL_SECONDS;

    }

    return normalized;

}

/**
 * ============================================================================
 * Normalize Tenant Scope
 * ============================================================================
 */

function normalizeTenantId(tenantId) {

    if (
        tenantId === undefined ||
        tenantId === null ||
        String(tenantId).trim() === ''
    ) {

        return 'GLOBAL';

    }

    return String(
        tenantId
    ).trim();

}

/**
 * ============================================================================
 * Build Redis Key
 * ============================================================================
 *
 * Tenant isolation is intentionally embedded into the Redis key.
 *
 * This prevents:
 *
 *   Tenant A + KEY-123
 *
 * from colliding with:
 *
 *   Tenant B + KEY-123
 *
 * ============================================================================
 */

function buildKey(
    key,
    tenantId = null
) {

    const normalizedKey =
        validateKey(key);

    const normalizedTenant =
        normalizeTenantId(tenantId);

    const tenantHash =
        crypto
            .createHash('sha256')
            .update(normalizedTenant)
            .digest('hex')
            .slice(0, 32);

    const keyHash =
        crypto
            .createHash('sha256')
            .update(normalizedKey)
            .digest('hex');

    return `${KEY_PREFIX}:v${VERSION}:${tenantHash}:${keyHash}`;

}

/**
 * ============================================================================
 * Fingerprint
 * ============================================================================
 *
 * Used to detect accidental/replayed reuse of the same idempotency key for
 * a different financial request.
 * ============================================================================
 */

function createFingerprint(payload) {

    if (
        payload === undefined
    ) {

        return null;

    }

    let serialized;

    try {

        serialized =
            stableStringify(payload);

    }
    catch(error) {

        throw new IdempotencyError(

            'Unable to generate idempotency request fingerprint',

            {

                code:
                    'IDEMPOTENCY_FINGERPRINT_FAILED',

                originalError:
                    error.message

            }

        );

    }

    return crypto
        .createHash('sha256')
        .update(serialized)
        .digest('hex');

}

/**
 * ============================================================================
 * Stable JSON Stringification
 * ============================================================================
 *
 * Object key ordering is deterministic so semantically identical payloads
 * produce the same fingerprint.
 * ============================================================================
 */

function stableStringify(value) {

    if (
        value === null ||
        typeof value !== 'object'
    ) {

        return JSON.stringify(value);

    }

    if (
        value instanceof Date
    ) {

        return JSON.stringify(
            value.toISOString()
        );

    }

    if (
        Array.isArray(value)
    ) {

        return `[${value
            .map(item => stableStringify(item))
            .join(',')}]`;

    }

    const keys =
        Object.keys(value)
            .sort();

    return `{${keys
        .map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`
        )
        .join(',')}}`;

}

/**
 * ============================================================================
 * Safe JSON Parse
 * ============================================================================
 */

function parseValue(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;

    }

    if (
        typeof value === 'object'
    ) {

        return value;

    }

    try {

        return JSON.parse(value);

    }
    catch(error) {

        throw new IdempotencyError(

            'Invalid idempotency record stored in Redis',

            {

                code:
                    'IDEMPOTENCY_RECORD_CORRUPT'

            }

        );

    }

}

/**
 * ============================================================================
 * Get Record
 * ============================================================================
 */

async function getRecord(
    key,
    {
        tenantId = null
    } = {}
) {

    assertRedis();

    const redisKey =
        buildKey(
            key,
            tenantId
        );

    const value =
        await redis.get(redisKey);

    return parseValue(value);

}

/**
 * ============================================================================
 * Reserve Key
 * ============================================================================
 *
 * Atomic Redis NX operation.
 *
 * Returns:
 *
 * {
 *   acquired: true,
 *   record
 * }
 *
 * or
 *
 * {
 *   acquired: false,
 *   record
 * }
 *
 * The reservation is the critical distributed lock preventing concurrent
 * financial execution.
 * ============================================================================
 */

async function reserve(
    key,
    {
        tenantId = null,

        fingerprint = null,

        requestId = null,

        ttlSeconds =
            DEFAULT_PROCESSING_TTL_SECONDS,

        metadata = {}
    } = {}
) {

    assertRedis();

    const normalizedKey =
        validateKey(key);

    const redisKey =
        buildKey(
            normalizedKey,
            tenantId
        );

    const normalizedTTL =
        normalizeTTL(
            ttlSeconds,
            DEFAULT_PROCESSING_TTL_SECONDS
        );

    const record = {

        version:
            VERSION,

        key:
            normalizedKey,

        tenantId:
            normalizeTenantId(tenantId),

        status:
            STATUS.PROCESSING,

        fingerprint:
            fingerprint ||
            null,

        requestId:
            requestId ||
            null,

        metadata:
            metadata || {},

        createdAt:
            new Date().toISOString(),

        updatedAt:
            new Date().toISOString()

    };

    const result =
        await redis.set(

            redisKey,

            JSON.stringify(record),

            'EX',

            normalizedTTL,

            'NX'

        );

    if (
        result === 'OK'
    ) {

        return {

            acquired:
                true,

            record

        };

    }

    const existing =
        await getRecord(

            normalizedKey,

            {
                tenantId
            }

        );

    return {

        acquired:
            false,

        record:
            existing

    };

}

/**
 * ============================================================================
 * Check And Record
 * ============================================================================
 *
 * Backward-compatible primitive.
 *
 * Returns:
 *
 *   true  = key was newly reserved
 *   false = key already exists
 *
 * ============================================================================
 */

async function check(
    key,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    options = {}
) {

    const fingerprint =
        options.fingerprint ||
        null;

    const result =
        await reserve(

            key,

            {

                ...options,

                fingerprint,

                ttlSeconds

            }

        );

    return Boolean(
        result.acquired
    );

}

/**
 * ============================================================================
 * Mark Completed
 * ============================================================================
 *
 * Stores the final successful response for safe replay.
 * ============================================================================
 */

async function complete(
    key,
    {
        tenantId = null,

        fingerprint = null,

        response = null,

        result = null,

        metadata = {},

        ttlSeconds =
            DEFAULT_TTL_SECONDS
    } = {}
) {

    assertRedis();

    const normalizedKey =
        validateKey(key);

    const redisKey =
        buildKey(
            normalizedKey,
            tenantId
        );

    const existing =
        await getRecord(

            normalizedKey,

            {
                tenantId
            }

        );

    if (
        existing &&
        fingerprint &&
        existing.fingerprint &&
        existing.fingerprint !== fingerprint
    ) {

        throw new IdempotencyConflictError(

            undefined,

            {

                key:
                    normalizedKey

            }

        );

    }

    const record = {

        version:
            VERSION,

        key:
            normalizedKey,

        tenantId:
            normalizeTenantId(tenantId),

        status:
            STATUS.COMPLETED,

        fingerprint:
            fingerprint ||
            existing?.fingerprint ||
            null,

        response:
            response !== null
                ? response
                : result,

        metadata:
            {

                ...(existing?.metadata || {}),

                ...(metadata || {})

            },

        createdAt:
            existing?.createdAt ||
            new Date().toISOString(),

        updatedAt:
            new Date().toISOString(),

        completedAt:
            new Date().toISOString()

    };

    await redis.set(

        redisKey,

        JSON.stringify(record),

        'EX',

        normalizeTTL(
            ttlSeconds
        )

    );

    return record;

}

/**
 * ============================================================================
 * Mark Failed
 * ============================================================================
 *
 * A failed financial operation should normally be allowed to retry after
 * the processing record is released/expired.
 *
 * The record is retained briefly for diagnostics.
 * ============================================================================
 */

async function fail(
    key,
    {
        tenantId = null,

        fingerprint = null,

        error = null,

        metadata = {},

        ttlSeconds = 3600
    } = {}
) {

    assertRedis();

    const normalizedKey =
        validateKey(key);

    const redisKey =
        buildKey(
            normalizedKey,
            tenantId
        );

    const existing =
        await getRecord(

            normalizedKey,

            {
                tenantId
            }

        );

    if (
        existing &&
        fingerprint &&
        existing.fingerprint &&
        existing.fingerprint !== fingerprint
    ) {

        throw new IdempotencyConflictError(

            undefined,

            {

                key:
                    normalizedKey

            }

        );

    }

    const record = {

        version:
            VERSION,

        key:
            normalizedKey,

        tenantId:
            normalizeTenantId(tenantId),

        status:
            STATUS.FAILED,

        fingerprint:
            fingerprint ||
            existing?.fingerprint ||
            null,

        error:
            sanitizeError(error),

        metadata:
            {

                ...(existing?.metadata || {}),

                ...(metadata || {})

            },

        createdAt:
            existing?.createdAt ||
            new Date().toISOString(),

        updatedAt:
            new Date().toISOString(),

        failedAt:
            new Date().toISOString()

    };

    await redis.set(

        redisKey,

        JSON.stringify(record),

        'EX',

        normalizeTTL(
            ttlSeconds,
            3600
        )

    );

    return record;

}

/**
 * ============================================================================
 * Delete / Release
 * ============================================================================
 *
 * Used when a reservation failed before any financial transaction was
 * committed and the caller explicitly wants the key to become retryable.
 *
 * WARNING:
 * Do NOT call this after a successful financial commit.
 * ============================================================================
 */

async function release(
    key,
    {
        tenantId = null
    } = {}
) {

    assertRedis();

    const redisKey =
        buildKey(
            key,
            tenantId
        );

    if (
        typeof redis.del !== 'function'
    ) {

        throw new IdempotencyError(

            'Redis delete operation unavailable',

            {

                code:
                    'IDEMPOTENCY_RELEASE_UNAVAILABLE'

            }

        );

    }

    return Boolean(
        await redis.del(redisKey)
    );

}

/**
 * ============================================================================
 * Record Metadata
 * ============================================================================
 *
 * Backward-compatible metadata helper.
 *
 * NOTE:
 * record() creates a COMPLETED-style metadata record only for compatibility.
 * New financial workflows should prefer reserve() + complete().
 * ============================================================================
 */

async function record(
    key,
    meta = {},
    ttlSeconds = DEFAULT_TTL_SECONDS
) {

    const normalizedKey =
        validateKey(key);

    const existing =
        await getRecord(
            normalizedKey
        );

    if (
        existing
    ) {

        return false;

    }

    const result =
        await reserve(

            normalizedKey,

            {

                ttlSeconds,

                metadata:
                    meta

            }

        );

    return Boolean(
        result.acquired
    );

}

/**
 * ============================================================================
 * Retrieve Metadata
 * ============================================================================
 *
 * Backward-compatible get() method.
 * ============================================================================
 */

async function get(
    key,
    options = {}
) {

    return getRecord(
        key,
        options
    );

}

/**
 * ============================================================================
 * Inspect
 * ============================================================================
 *
 * Useful for operational tooling and reconciliation diagnostics.
 * ============================================================================
 */

async function inspect(
    key,
    options = {}
) {

    return getRecord(
        key,
        options
    );

}

/**
 * ============================================================================
 * Sanitize Error
 * ============================================================================
 *
 * Never persist stack traces, credentials, tokens, request bodies, or other
 * potentially sensitive infrastructure details into the idempotency store.
 * ============================================================================
 */

function sanitizeError(error) {

    if (!error) {

        return null;

    }

    if (
        typeof error === 'string'
    ) {

        return {

            message:
                error.slice(0, 1000)

        };

    }

    return {

        name:
            error.name ||
            'Error',

        code:
            error.code ||
            null,

        message:
            error.message
                ? String(error.message).slice(0, 1000)
                : 'Operation failed'

    };

}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports = {

    VERSION,

    STATUS,

    IdempotencyError,

    IdempotencyConflictError,

    check,

    record,

    get,

    reserve,

    complete,

    fail,

    release,

    inspect,

    createFingerprint,

    buildKey

};