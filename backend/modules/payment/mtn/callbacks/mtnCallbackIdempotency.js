'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN Callback Idempotency / Ownership Coordinator
 * ============================================================================
 *
 * File:
 * backend/modules/payment/mtn/callbacks/mtnCallbackIdempotency.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Durable idempotency + distributed worker ownership adapter for MTN MoMo
 * callbacks.
 *
 * The adapter coordinates:
 *
 *     callback
 *        │
 *        ▼
 *   reserve / claim
 *        │
 *        ├──── duplicate
 *        │
 *        └──── claimToken + lease
 *                     │
 *                     ▼
 *                 processing
 *                     │
 *              heartbeat()
 *                     │
 *          ┌──────────┴──────────┐
 *          ▼                     ▼
 *      complete()              fail()
 *          │                     │
 *          ▼                     ▼
 *      COMPLETED             FAILED
 *                                │
 *                           release/retry
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Deterministic callback idempotency key generation
 * - Tenant-scoped identity
 * - Atomic ownership claim
 * - Claim-token generation
 * - Lease expiration
 * - Lease heartbeat
 * - Ownership verification
 * - Completion
 * - Failure
 * - Explicit release
 * - Expired-lease recovery
 * - Bounded in-process fallback
 * - Safe operational diagnostics
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Signature verification
 * - Callback normalization
 * - Payment execution
 * - Ledger posting
 * - Reconciliation
 * - DLQ scheduling
 *
 * Production Rule
 * ----------------------------------------------------------------------------
 * Persistent model-backed coordination SHOULD be mandatory in production.
 *
 * The Map fallback exists for:
 * - isolated unit tests
 * - local development
 * - controlled non-distributed execution
 *
 * It must NOT be treated as durable distributed idempotency.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROVIDER = 'MTN';

const OPERATION_PREFIX =
    'MTN_MOMO:CALLBACK';

const DEFAULT_TTL_MS =
    24 * 60 * 60 * 1000;

const DEFAULT_LEASE_MS =
    5 * 60 * 1000;

const DEFAULT_MAX_LEASE_MS =
    24 * 60 * 60 * 1000;

const DEFAULT_MAX_ENTRIES =
    10000;

const MAX_KEY_LENGTH =
    768;

const MAX_CALLBACK_ID_LENGTH =
    256;

const MAX_TENANT_ID_LENGTH =
    256;

const MAX_REFERENCE_LENGTH =
    256;

const MAX_PROVIDER_REFERENCE_LENGTH =
    256;

const MAX_WORKER_ID_LENGTH =
    256;

const MAX_REQUEST_ID_LENGTH =
    256;

const MAX_CORRELATION_ID_LENGTH =
    256;

/**
 * ============================================================================
 * States
 * ============================================================================
 */

const STATE = Object.freeze({

    CLAIMED:
        'CLAIMED',

    PROCESSING:
        'PROCESSING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    RELEASED:
        'RELEASED',

    EXPIRED:
        'EXPIRED',

});

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeRequiredString(
    value,
    field,
    maxLength
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        throw new TypeError(
            `${field} is required`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new TypeError(
            `${field} must be a string`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length === 0
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizePositiveInteger(
    value,
    fallback,
    {
        max = Number.MAX_SAFE_INTEGER,
        field = 'value',
    } = {}
) {
    const number =
        Number(value);

    if (
        !Number.isSafeInteger(number) ||
        number <= 0 ||
        number > max
    ) {
        return fallback;
    }

    return number;
}

function normalizeLeaseMs(
    value
) {
    return normalizePositiveInteger(
        value,
        DEFAULT_LEASE_MS,
        {
            max:
                DEFAULT_MAX_LEASE_MS,
            field:
                'leaseMs',
        }
    );
}

function generateClaimToken() {
    return crypto
        .randomBytes(32)
        .toString('hex');
}

function stableSerialize(
    value
) {
    if (
        value === null ||
        value === undefined
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
            .map(stableSerialize)
            .join(',')}]`;
    }

    if (
        typeof value === 'object'
    ) {
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function createFingerprint(
    value
) {
    return crypto
        .createHash('sha256')
        .update(
            stableSerialize(value),
            'utf8'
        )
        .digest('hex');
}

function getDocumentValue(
    document,
    key,
    fallback = null
) {
    if (
        document === null ||
        document === undefined
    ) {
        return fallback;
    }

    const value =
        document[key];

    return value === undefined
        ? fallback
        : value;
}

function isDuplicateKeyError(
    error
) {
    return (
        error?.code === 11000
    );
}

/**
 * ============================================================================
 * Adapter
 * ============================================================================
 */

class MTNCallbackIdempotency {

    constructor(options = {}) {

        this.model =
            options.model ||
            null;

        this.cache =
            options.cache instanceof Map
                ? options.cache
                : new Map();

        this.ttlMs =
            normalizePositiveInteger(
                options.ttlMs,
                DEFAULT_TTL_MS,
                {
                    max:
                        30 * 24 * 60 * 60 * 1000,
                    field:
                        'ttlMs',
                }
            );

        this.leaseMs =
            normalizeLeaseMs(
                options.leaseMs
            );

        this.maxEntries =
            normalizePositiveInteger(
                options.maxEntries,
                DEFAULT_MAX_ENTRIES,
                {
                    max:
                        1_000_000,
                    field:
                        'maxEntries',
                }
            );

        /**
         * Production should explicitly set persistentRequired=true.
         *
         * Default:
         * - production => true
         * - development/test => false
         */
        this.persistentRequired =
            options.persistentRequired !==
                undefined
                ? Boolean(
                    options.persistentRequired
                )
                : (
                    process.env.NODE_ENV ===
                    'production'
                );

        this.allowInMemoryFallback =
            options.allowInMemoryFallback !==
                undefined
                ? Boolean(
                    options.allowInMemoryFallback
                )
                : !this.persistentRequired;

        this.workerId =
            normalizeOptionalString(
                options.workerId,
                'workerId',
                MAX_WORKER_ID_LENGTH
            ) ||
            `mtn-callback-worker:${process.pid}:${crypto
                .randomBytes(8)
                .toString('hex')}`;

        this.logger =
            options.logger ||
            console;

        /**
         * Prevent concurrent in-process reservations from racing the fallback
         * Map between asynchronous turns.
         *
         * Key -> Promise
         */
        this.pendingReservations =
            new Map();

        this.statistics = {

            reservations:
                0,

            duplicates:
                0,

            completions:
                0,

            failures:
                0,

            releases:
                0,

            heartbeats:
                0,

            ownershipLosses:
                0,

            persistentFailures:
                0,

            fallbackReservations:
                0,

        };
    }

    /**
     * =========================================================================
     * Key Construction
     * =========================================================================
     *
     * Tenant is intentionally part of the persisted identity.
     *
     * MTN callback identity becomes:
     *
     * tenant + provider + callbackId
     *
     * =========================================================================
     */

    createKey(
        callback,
        context = {}
    ) {

        if (
            !callback ||
            typeof callback !== 'object'
        ) {
            throw new TypeError(
                'callback is required'
            );
        }

        const tenantId =
            normalizeOptionalString(
                context.tenantId ||
                callback.tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        const callbackId =
            normalizeOptionalString(
                callback.callbackId,
                'callbackId',
                MAX_CALLBACK_ID_LENGTH
            );

        /**
         * Preferred deterministic identity.
         */
        if (
            callbackId
        ) {

            const prefix =
                tenantId
                    ? `${tenantId}:`
                    : '';

            const key =
                `${OPERATION_PREFIX}:${prefix}${callbackId}`;

            if (
                key.length >
                MAX_KEY_LENGTH
            ) {
                throw new RangeError(
                    'Generated idempotency key exceeds maximum length'
                );
            }

            return key;
        }

        /**
         * Fallback identity for malformed/legacy callbacks that do not have
         * callbackId.
         *
         * This should not be the normal production path.
         */
        const fingerprint =
            createFingerprint({
                tenantId,
                provider:
                    PROVIDER,

                providerReference:
                    callback.providerReference ||
                    null,

                reference:
                    callback.reference ||
                    null,

                status:
                    callback.status ||
                    null,

                payload:
                    callback.payload ||
                    null,
            });

        return `${OPERATION_PREFIX}:${tenantId || 'UNSCOPED'}:${fingerprint}`;
    }

    /**
     * =========================================================================
     * Persistent Model Availability
     * =========================================================================
     */

    hasPersistentStore() {
        return Boolean(
            this.model &&
            typeof this.model.findOne ===
                'function' &&
            typeof this.model.updateOne ===
                'function'
        );
    }

    assertProductionPersistence() {

        if (
            this.persistentRequired &&
            !this.hasPersistentStore()
        ) {

            throw new Error(
                'Persistent MTN callback idempotency storage is required but unavailable.'
            );
        }
    }

    /**
     * =========================================================================
     * Check
     * =========================================================================
     *
     * Returns:
     *
     * duplicate=true
     *     callback is already completed or actively owned
     *
     * duplicate=false
     *     no active/terminal record exists
     *
     * The returned record should be treated as diagnostic state only.
     * Ownership requires reserve().
     * =========================================================================
     */

    async check(
        callback,
        context = {}
    ) {

        const key =
            this.createKey(
                callback,
                context
            );

        this.assertProductionPersistence();

        /**
         * ---------------------------------------------------------------------
         * Persistent lookup
         * ---------------------------------------------------------------------
         */

        if (
            this.hasPersistentStore()
        ) {

            try {

                const filter =
                    this.buildIdentityFilter(
                        callback,
                        context,
                        key
                    );

                const existing =
                    await this.model
                        .findOne(
                            filter
                        )
                        .select?.(
                            '+claimToken'
                        )
                        .lean?.();

                if (
                    existing
                ) {

                    return {
                        duplicate:
                            this.isDuplicateOrOwned(
                                existing
                            ),

                        key,

                        record:
                            this.safeRecord(
                                existing
                            )
                    };
                }

            } catch (error) {

                this.statistics.persistentFailures++;

                /**
                 * Production should not silently downgrade to memory.
                 */
                if (
                    this.persistentRequired ||
                    !this.allowInMemoryFallback
                ) {

                    throw this.persistenceError(
                        'check',
                        error
                    );
                }

                this.logger.warn?.({
                    event:
                        'payment.mtn.callback.idempotency.persistence_check_failed',

                    error:
                        error?.message
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * In-process fallback
         * ---------------------------------------------------------------------
         */

        const cached =
            this.cache.get(
                key
            );

        if (
            cached
        ) {

            if (
                this.isExpired(
                    cached
                )
            ) {

                this.cache.delete(
                    key
                );

            } else {

                return {
                    duplicate:
                        this.isDuplicateOrOwned(
                            cached
                        ),

                    key,

                    record:
                        this.safeRecord(
                            cached
                        )
                };
            }
        }

        return {
            duplicate:
                false,

            key
        };
    }

    /**
     * =========================================================================
     * Reserve / Claim
     * =========================================================================
     *
     * This is the critical operation.
     *
     * Preferred persistent implementation:
     *
     * model.claim(...)
     *
     * If the model does not expose claim(), create() + unique index is used as
     * a compatibility path.
     * =========================================================================
     */

    async reserve(
        callback,
        metadata = {}
    ) {

        const context =
            metadata || {};

        const key =
            this.createKey(
                callback,
                context
            );

        this.statistics.reservations++;

        this.assertProductionPersistence();

        const leaseMs =
            normalizeLeaseMs(
                context.leaseMs ||
                this.leaseMs
            );

        const now =
            new Date();

        const leaseExpiresAt =
            new Date(
                now.getTime() +
                leaseMs
            );

        const claimToken =
            generateClaimToken();

        /**
         * ---------------------------------------------------------------------
         * Preferred model-native atomic claim.
         * ---------------------------------------------------------------------
         */

        if (
            this.model &&
            typeof this.model.claim ===
                'function'
        ) {

            try {

                const result =
                    await this.model.claim({
                        tenantId:
                            context.tenantId ||
                            callback.tenantId ||
                            null,

                        callbackId:
                            callback.callbackId,

                        idempotencyKey:
                            key,

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        status:
                            callback.status,

                        state:
                            STATE.CLAIMED,

                        claimToken,

                        leaseExpiresAt,

                        attemptCount:
                            normalizePositiveInteger(
                                context.attempt,
                                1,
                                {
                                    max:
                                        100000,
                                    field:
                                        'attempt'
                                }
                            ),

                        workerId:
                            this.workerId,

                        requestId:
                            context.requestId ||
                            null,

                        correlationId:
                            context.correlationId ||
                            null
                    });

                const normalized =
                    this.normalizeClaimResult(
                        result,
                        key,
                        claimToken
                    );

                if (
                    normalized.duplicate
                ) {
                    this.statistics.duplicates++;
                }

                return normalized;

            } catch (error) {

                if (
                    isDuplicateKeyError(
                        error
                    )
                ) {

                    this.statistics.duplicates++;

                    const existing =
                        await this.readExisting(
                            callback,
                            context,
                            key
                        );

                    return {
                        duplicate:
                            true,

                        key,

                        record:
                            existing?.record ||
                            existing ||
                            null,

                        claimToken:
                            null
                    };
                }

                throw error;
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Compatibility path using model.create().
         * ---------------------------------------------------------------------
         */

        if (
            this.model
        ) {

            try {

                const record =
                    await this.model.create({
                        tenantId:
                            context.tenantId ||
                            callback.tenantId ||
                            undefined,

                        provider:
                            PROVIDER,

                        idempotencyKey:
                            key,

                        callbackId:
                            callback.callbackId,

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        status:
                            callback.status,

                        state:
                            STATE.CLAIMED,

                        claimToken,

                        leaseExpiresAt,

                        attemptCount:
                            normalizePositiveInteger(
                                context.attempt,
                                1,
                                {
                                    max:
                                        100000,
                                    field:
                                        'attempt'
                                }
                            ),

                        workerId:
                            this.workerId,

                        requestId:
                            context.requestId ||
                            null,

                        correlationId:
                            context.correlationId ||
                            null,

                        createdAt:
                            now,

                        updatedAt:
                            now
                    });

                return {
                    duplicate:
                        false,

                    key,

                    claimToken,

                    leaseExpiresAt,

                    reserved:
                        true,

                    record
                };

            } catch (error) {

                if (
                    isDuplicateKeyError(
                        error
                    )
                ) {

                    this.statistics.duplicates++;

                    const existing =
                        await this.readExisting(
                            callback,
                            context,
                            key
                        );

                    return {
                        duplicate:
                            true,

                        key,

                        record:
                            existing?.record ||
                            existing ||
                            null,

                        claimToken:
                            null
                    };
                }

                this.statistics.persistentFailures++;

                throw error;
            }
        }

        /**
         * ---------------------------------------------------------------------
         * In-process fallback.
         * ---------------------------------------------------------------------
         */

        if (
            !this.allowInMemoryFallback
        ) {

            throw new Error(
                'In-memory MTN callback idempotency fallback is disabled.'
            );
        }

        return this.reserveInMemory(
            callback,
            context,
            {
                key,
                claimToken,
                now,
                leaseExpiresAt
            }
        );
    }

    /**
     * =========================================================================
     * In-Memory Reservation
     * =========================================================================
     */

    async reserveInMemory(
        callback,
        context,
        {
            key,
            claimToken,
            now,
            leaseExpiresAt
        }
    ) {

        /**
         * Serialize competing reservations for the same key.
         */
        const pending =
            this.pendingReservations.get(
                key
            );

        if (
            pending
        ) {

            return pending;
        }

        const reservationPromise =
            (async () => {

                const existing =
                    this.cache.get(
                        key
                    );

                if (
                    existing &&
                    !this.isExpired(
                        existing
                    )
                ) {

                    this.statistics.duplicates++;

                    return {
                        duplicate:
                            this.isDuplicateOrOwned(
                                existing
                            ),

                        key,

                        record:
                            this.safeRecord(
                                existing
                            ),

                        claimToken:
                            null
                    };
                }

                this.ensureCacheCapacity();

                const record = {

                    provider:
                        PROVIDER,

                    tenantId:
                        context.tenantId ||
                        callback.tenantId ||
                        null,

                    idempotencyKey:
                        key,

                    callbackId:
                        callback.callbackId ||
                        null,

                    reference:
                        callback.reference ||
                        null,

                    providerReference:
                        callback.providerReference ||
                        null,

                    status:
                        callback.status ||
                        null,

                    state:
                        STATE.CLAIMED,

                    claimToken,

                    leaseExpiresAt,

                    attemptCount:
                        normalizePositiveInteger(
                            context.attempt,
                            1
                        ),

                    workerId:
                        this.workerId,

                    requestId:
                        context.requestId ||
                        null,

                    correlationId:
                        context.correlationId ||
                        null,

                    createdAt:
                        now,

                    updatedAt:
                        now
                };

                this.cache.set(
                    key,
                    record
                );

                this.statistics
                    .fallbackReservations++;

                this.scheduleCacheExpiry(
                    key,
                    record
                );

                return {
                    duplicate:
                        false,

                    key,

                    claimToken,

                    leaseExpiresAt,

                    reserved:
                        true,

                    record
                };

            })();

        this.pendingReservations.set(
            key,
            reservationPromise
        );

        try {

            return await reservationPromise;

        } finally {

            this.pendingReservations.delete(
                key
            );

        }
    }

    /**
     * =========================================================================
     * Start
     * =========================================================================
     *
     * CLAIMED -> PROCESSING
     * =========================================================================
     */

    async start(
        callback,
        metadata = {}
    ) {

        const key =
            this.createKey(
                callback,
                metadata
            );

        const claimToken =
            metadata.claimToken ||
            metadata.token ||
            metadata.leaseToken;

        if (
            this.model &&
            typeof this.model.start ===
                'function'
        ) {

            return this.model.start({
                tenantId:
                    metadata.tenantId ||
                    callback.tenantId ||
                    null,

                idempotencyKey:
                    key,

                callbackId:
                    callback.callbackId,

                claimToken,

                workerId:
                    this.workerId,

                requestId:
                    metadata.requestId ||
                    null,

                correlationId:
                    metadata.correlationId ||
                    null,

                leaseMs:
                    normalizeLeaseMs(
                        metadata.leaseMs ||
                        this.leaseMs
                    )
            });
        }

        return this.transitionFallback(
            key,
            claimToken,
            STATE.CLAIMED,
            STATE.PROCESSING,
            metadata
        );
    }

    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     */

    async heartbeat(
        callback,
        metadata = {}
    ) {

        const key =
            this.createKey(
                callback,
                metadata
            );

        const claimToken =
            metadata.claimToken ||
            metadata.token ||
            metadata.leaseToken;

        const leaseMs =
            normalizeLeaseMs(
                metadata.leaseMs ||
                this.leaseMs
            );

        this.statistics.heartbeats++;

        if (
            this.model &&
            typeof this.model.heartbeat ===
                'function'
        ) {

            try {

                return await this.model.heartbeat({
                    tenantId:
                        metadata.tenantId ||
                        callback.tenantId ||
                        null,

                    idempotencyKey:
                        key,

                    callbackId:
                        callback.callbackId,

                    claimToken,

                    workerId:
                        this.workerId,

                    requestId:
                        metadata.requestId ||
                        null,

                    correlationId:
                        metadata.correlationId ||
                        null,

                    leaseMs
                });

            } catch (error) {

                this.statistics.ownershipLosses++;

                throw this.ownershipError(
                    error,
                    'heartbeat'
                );
            }
        }

        const record =
            this.cache.get(
                key
            );

        if (
            !record
        ) {

            throw this.ownershipLost(
                'No in-process reservation exists.'
            );
        }

        this.assertClaimOwnership(
            record,
            claimToken
        );

        if (
            this.isExpired(
                record
            )
        ) {

            throw this.ownershipLost(
                'Callback processing lease has expired.'
            );
        }

        const now =
            new Date();

        record.leaseExpiresAt =
            new Date(
                now.getTime() +
                leaseMs
            );

        record.updatedAt =
            now;

        this.cache.set(
            key,
            record
        );

        return {
            key,

            claimToken,

            leaseExpiresAt:
                record.leaseExpiresAt,

            record
        };
    }

    /**
     * =========================================================================
     * Complete
     * =========================================================================
     *
     * Only the current owner may complete the operation.
     * =========================================================================
     */

    async complete(
        callback,
        data = {}
    ) {

        const key =
            this.createKey(
                callback,
                data
            );

        const claimToken =
            data.claimToken ||
            data.token ||
            data.leaseToken;

        const now =
            new Date();

        if (
            this.model &&
            typeof this.model.complete ===
                'function'
        ) {

            try {

                const result =
                    await this.model.complete({
                        tenantId:
                            data.tenantId ||
                            callback.tenantId ||
                            null,

                        idempotencyKey:
                            key,

                        callbackId:
                            callback.callbackId,

                        claimToken,

                        workerId:
                            this.workerId,

                        requestId:
                            data.requestId ||
                            null,

                        correlationId:
                            data.correlationId ||
                            null,

                        ...data,

                        state:
                            STATE.COMPLETED,

                        completedAt:
                            data.processedAt ||
                            now
                    });

                this.statistics.completions++;

                return result;

            } catch (error) {

                this.statistics.ownershipLosses++;

                throw this.ownershipError(
                    error,
                    'complete'
                );
            }
        }

        const record =
            this.cache.get(
                key
            );

        if (
            !record
        ) {

            throw this.ownershipLost(
                'Callback ownership record does not exist.'
            );
        }

        this.assertClaimOwnership(
            record,
            claimToken
        );

        /**
         * A completion must not be accepted after the active lease expired.
         */
        if (
            this.isExpired(
                record
            )
        ) {

            throw this.ownershipLost(
                'Callback processing lease has expired.'
            );
        }

        const completed = {
            ...record,

            state:
                STATE.COMPLETED,

            updatedAt:
                now,

            completedAt:
                data.processedAt ||
                now,

            ...this.sanitizeUpdateData(
                data
            )
        };

        delete completed.claimToken;

        this.cache.set(
            key,
            completed
        );

        this.statistics.completions++;

        return {
            acknowledged:
                true,

            key,

            state:
                STATE.COMPLETED
        };
    }

    /**
     * =========================================================================
     * Fail
     * =========================================================================
     *
     * Failure records must still be ownership-scoped.
     * =========================================================================
     */

    async fail(
        callback,
        data = {}
    ) {

        const key =
            this.createKey(
                callback,
                data
            );

        const claimToken =
            data.claimToken ||
            data.token ||
            data.leaseToken;

        const now =
            new Date();

        if (
            this.model &&
            typeof this.model.fail ===
                'function'
        ) {

            try {

                const result =
                    await this.model.fail({
                        tenantId:
                            data.tenantId ||
                            callback.tenantId ||
                            null,

                        idempotencyKey:
                            key,

                        callbackId:
                            callback.callbackId,

                        claimToken,

                        workerId:
                            this.workerId,

                        requestId:
                            data.requestId ||
                            null,

                        correlationId:
                            data.correlationId ||
                            null,

                        ...data,

                        state:
                            STATE.FAILED,

                        failedAt:
                            now
                    });

                this.statistics.failures++;

                return result;

            } catch (error) {

                this.statistics.ownershipLosses++;

                /**
                 * Failure recording should not obscure the original
                 * processing error at the processor level.
                 */
                throw this.ownershipError(
                    error,
                    'fail'
                );
            }
        }

        const record =
            this.cache.get(
                key
            );

        if (
            !record
        ) {

            throw this.ownershipLost(
                'Callback ownership record does not exist.'
            );
        }

        this.assertClaimOwnership(
            record,
            claimToken
        );

        const failed = {
            ...record,

            state:
                STATE.FAILED,

            updatedAt:
                now,

            failedAt:
                now,

            ...this.sanitizeUpdateData(
                data
            )
        };

        this.cache.set(
            key,
            failed
        );

        this.statistics.failures++;

        return {
            acknowledged:
                true,

            key,

            state:
                STATE.FAILED
        };
    }

    /**
     * =========================================================================
     * Release
     * =========================================================================
     *
     * Explicit worker ownership release.
     * =========================================================================
     */

    async release(
        callback,
        data = {}
    ) {

        const key =
            this.createKey(
                callback,
                data
            );

        const claimToken =
            data.claimToken ||
            data.token ||
            data.leaseToken;

        const now =
            new Date();

        if (
            this.model &&
            typeof this.model.release ===
                'function'
        ) {

            const result =
                await this.model.release({
                    tenantId:
                        data.tenantId ||
                        callback.tenantId ||
                        null,

                    idempotencyKey:
                        key,

                    callbackId:
                        callback.callbackId,

                    claimToken,

                    workerId:
                        this.workerId,

                    requestId:
                        data.requestId ||
                        null,

                    correlationId:
                        data.correlationId ||
                        null,

                    releasedAt:
                        now
                });

            this.statistics.releases++;

            return result;
        }

        const record =
            this.cache.get(
                key
            );

        if (
            !record
        ) {

            throw this.ownershipLost(
                'Callback ownership record does not exist.'
            );
        }

        this.assertClaimOwnership(
            record,
            claimToken
        );

        record.state =
            STATE.RELEASED;

        record.updatedAt =
            now;

        record.releasedAt =
            now;

        record.leaseExpiresAt =
            now;

        this.cache.set(
            key,
            record
        );

        this.statistics.releases++;

        return {
            acknowledged:
                true,

            key,

            state:
                STATE.RELEASED
        };
    }

    /**
     * =========================================================================
     * Release Expired
     * =========================================================================
     *
     * Persistent model may provide a much more efficient implementation.
     * =========================================================================
     */

    async releaseExpired(
        options = {}
    ) {

        if (
            this.model &&
            typeof this.model.releaseExpiredClaims ===
                'function'
        ) {

            return this.model
                .releaseExpiredClaims(
                    options
                );
        }

        const now =
            new Date();

        let released =
            0;

        for (
            const [key, record]
            of this.cache.entries()
        ) {

            if (
                record?.leaseExpiresAt &&
                new Date(
                    record.leaseExpiresAt
                ) <= now &&
                (
                    record.state ===
                        STATE.CLAIMED ||
                    record.state ===
                        STATE.PROCESSING
                )
            ) {

                record.state =
                    STATE.EXPIRED;

                record.updatedAt =
                    now;

                record.expiredAt =
                    now;

                this.cache.set(
                    key,
                    record
                );

                released++;
            }
        }

        return {
            releasedCount:
                released
        };
    }

    /**
     * =========================================================================
     * Existing Record Read
     * =========================================================================
     */

    async readExisting(
        callback,
        context,
        key
    ) {

        if (
            this.model &&
            typeof this.model.findOne ===
                'function'
        ) {

            const filter =
                this.buildIdentityFilter(
                    callback,
                    context,
                    key
                );

            const existing =
                await this.model
                    .findOne(
                        filter
                    )
                    .select?.(
                        '+claimToken'
                    )
                    .lean?.();

            return existing;
        }

        return this.cache.get(
            key
        );
    }

    /**
     * =========================================================================
     * Identity Filter
     * =========================================================================
     */

    buildIdentityFilter(
        callback,
        context,
        key
    ) {

        const tenantId =
            context.tenantId ||
            callback.tenantId ||
            null;

        if (
            tenantId
        ) {

            return {
                tenantId,
                idempotencyKey:
                    key
            };
        }

        return {
            idempotencyKey:
                key
        };
    }

    /**
     * =========================================================================
     * Normalize Model Claim Result
     * =========================================================================
     */

    normalizeClaimResult(
        result,
        key,
        fallbackClaimToken
    ) {

        if (
            !result
        ) {

            return {
                duplicate:
                    false,

                reserved:
                    true,

                key,

                claimToken:
                    fallbackClaimToken
            };
        }

        if (
            result.duplicate ||
            result.alreadyCompleted
        ) {

            return {
                ...result,

                duplicate:
                    true,

                key,

                claimToken:
                    null
            };
        }

        return {
            ...result,

            duplicate:
                false,

            reserved:
                true,

            key,

            claimToken:
                result.claimToken ||
                result.token ||
                fallbackClaimToken,

            leaseExpiresAt:
                result.leaseExpiresAt ||
                null
        };
    }

    /**
     * =========================================================================
     * Duplicate / Ownership State
     * =========================================================================
     */

    isDuplicateOrOwned(
        record
    ) {

        if (
            !record
        ) {
            return false;
        }

        if (
            record.state ===
                STATE.COMPLETED
        ) {
            return true;
        }

        if (
            record.status ===
                'COMPLETED'
        ) {
            return true;
        }

        if (
            record.state ===
                STATE.CLAIMED ||
            record.state ===
                STATE.PROCESSING
        ) {

            return true;
        }

        return false;
    }

    /**
     * =========================================================================
     * Expiration
     * =========================================================================
     */

    isExpired(
        record
    ) {

        if (
            !record?.leaseExpiresAt
        ) {

            return false;
        }

        const expiry =
            new Date(
                record.leaseExpiresAt
            );

        if (
            Number.isNaN(
                expiry.getTime()
            )
        ) {

            return true;
        }

        return expiry <= new Date();
    }

    /**
     * =========================================================================
     * Fallback State Transition
     * =========================================================================
     */

    transitionFallback(
        key,
        claimToken,
        expectedState,
        nextState,
        metadata
    ) {

        const record =
            this.cache.get(
                key
            );

        if (
            !record
        ) {

            throw this.ownershipLost(
                'Callback reservation does not exist.'
            );
        }

        this.assertClaimOwnership(
            record,
            claimToken
        );

        if (
            this.isExpired(
                record
            )
        ) {

            throw this.ownershipLost(
                'Callback processing lease has expired.'
            );
        }

        if (
            record.state !==
            expectedState
        ) {

            const error =
                new Error(
                    `Invalid callback ownership state: ${record.state}; expected ${expectedState}.`
                );

            error.code =
                'MTN_CALLBACK_STATE_CONFLICT';

            throw error;
        }

        const now =
            new Date();

        record.state =
            nextState;

        record.updatedAt =
            now;

        if (
            metadata.requestId
        ) {
            record.requestId =
                metadata.requestId;
        }

        if (
            metadata.correlationId
        ) {
            record.correlationId =
                metadata.correlationId;
        }

        this.cache.set(
            key,
            record
        );

        return {
            acknowledged:
                true,

            key,

            claimToken,

            state:
                nextState
        };
    }

    /**
     * =========================================================================
     * Ownership Assertions
     * =========================================================================
     */

    assertClaimOwnership(
        record,
        claimToken
    ) {

        if (
            !claimToken
        ) {

            throw this.ownershipLost(
                'No claim token supplied.'
            );
        }

        if (
            !record.claimToken ||
            record.claimToken !==
                claimToken
        ) {

            this.statistics.ownershipLosses++;

            throw this.ownershipLost(
                'Callback is owned by another worker.'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Ownership Error
     * =========================================================================
     */

    ownershipLost(
        message
    ) {

        const error =
            new Error(
                message ||
                    'Callback ownership has been lost.'
            );

        error.code =
            'MTN_CALLBACK_OWNERSHIP_LOST';

        error.retryable =
            true;

        return error;
    }

    ownershipError(
        error,
        operation
    ) {

        if (
            error?.code ===
                'MTN_CALLBACK_OWNERSHIP_LOST'
        ) {

            return error;
        }

        const wrapped =
            this.ownershipLost(
                error?.message ||
                    `Callback ownership operation failed: ${operation}.`
            );

        wrapped.cause =
            error;

        wrapped.operation =
            operation;

        return wrapped;
    }

    persistenceError(
        operation,
        error
    ) {

        const wrapped =
            new Error(
                `Persistent MTN callback idempotency ${operation} failed.`
            );

        wrapped.code =
            'MTN_CALLBACK_IDEMPOTENCY_PERSISTENCE_FAILED';

        wrapped.retryable =
            true;

        wrapped.cause =
            error;

        return wrapped;
    }

    /**
     * =========================================================================
     * Cache Capacity
     * =========================================================================
     */

    ensureCacheCapacity() {

        if (
            this.cache.size <
            this.maxEntries
        ) {

            return;
        }

        /**
         * Remove the oldest entry.
         *
         * Map iteration preserves insertion order.
         */
        const first =
            this.cache.keys()
                .next()
                .value;

        if (
            first !== undefined
        ) {
            this.cache.delete(
                first
            );
        }
    }

    /**
     * =========================================================================
     * Fallback Cache Expiration
     * =========================================================================
     */

    scheduleCacheExpiry(
        key,
        record
    ) {

        const expiresAt =
            Math.min(
                record.leaseExpiresAt
                    .getTime?.() ||
                    new Date(
                        record.leaseExpiresAt
                    ).getTime(),

                Date.now() +
                    this.ttlMs
            );

        const delay =
            Math.max(
                expiresAt -
                    Date.now(),
                1000
            );

        const timer =
            setTimeout(
                () => {

                    const current =
                        this.cache.get(
                            key
                        );

                    if (
                        current ===
                        record
                    ) {

                        this.cache.delete(
                            key
                        );
                    }

                },
                delay
            );

        timer.unref?.();
    }

    /**
     * =========================================================================
     * Safe Record
     * =========================================================================
     *
     * Never expose claimToken through diagnostics.
     * =========================================================================
     */

    safeRecord(
        record
    ) {

        if (
            !record
        ) {

            return null;
        }

        const safe = {
            ...record
        };

        delete safe.claimToken;

        return safe;
    }

    /**
     * =========================================================================
     * Update Sanitization
     * =========================================================================
     *
     * Prevent callers from overwriting ownership fields accidentally.
     * =========================================================================
     */

    sanitizeUpdateData(
        data
    ) {

        const safe = {
            ...data
        };

        delete safe.claimToken;
        delete safe.token;
        delete safe.leaseToken;

        delete safe.state;
        delete safe.idempotencyKey;

        delete safe.provider;

        return safe;
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {
            ...this.statistics,

            cacheSize:
                this.cache.size,

            persistent:
                this.hasPersistentStore(),

            persistentRequired:
                this.persistentRequired,

            allowInMemoryFallback:
                this.allowInMemoryFallback,

            workerId:
                this.workerId
        };
    }
}

/**
 * ============================================================================
 * Static Exports
 * ============================================================================
 */

MTNCallbackIdempotency.STATE =
    STATE;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    MTNCallbackIdempotency;