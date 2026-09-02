'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Idempotency Manager
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/IdempotencyManager.js
 *
 * Purpose
 * -------
 * Enterprise idempotency coordination layer for Airtel Money operations.
 *
 * Responsibilities
 * ----------------
 * • Duplicate request prevention
 * • Tenant-isolated idempotency keys
 * • Deterministic key hashing
 * • Atomic request acquisition where supported by cache adapter
 * • Concurrent execution protection
 * • Stale lock recovery
 * • Response replay
 * • TTL management
 * • Distributed cache support
 * • Local fallback cache
 * • Correlation ID propagation
 * • Metrics instrumentation
 * • Structured logging
 * • Audit hooks
 * • Runtime diagnostics
 * • Graceful shutdown
 *
 * Used By
 * -------
 * • Authentication workflows
 * • Collections
 * • Disbursements
 * • Settlement
 * • Reconciliation
 *
 * Explicitly NOT Responsible For
 * --------------------------------
 * • Payment execution
 * • Provider communication
 * • Ledger posting
 * • Business validation
 * • Authentication
 *
 * Security
 * --------
 * • Never logs raw idempotency keys
 * • Never exposes access tokens
 * • Never stores secrets intentionally
 * • Tenant identity is always part of the coordination key
 * • Response persistence can be disabled
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROVIDER = 'AIRTEL';

const STATUS = Object.freeze({
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    EXPIRED: 'EXPIRED'
});

const DEFAULT_TTL_SECONDS = 86400;

const DEFAULT_LOCK_TTL_SECONDS = 300;

const DEFAULT_MAX_KEY_LENGTH = 512;

const DEFAULT_MAX_TENANT_ID_LENGTH = 128;

const DEFAULT_MAX_METADATA_KEYS = 50;

const DEFAULT_ACQUIRE_RETRIES = 3;

const DEFAULT_ACQUIRE_RETRY_DELAY_MS = 50;

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

const DEFAULT_MAX_ERROR_MESSAGE_LENGTH = 1000;

const CACHE_NAMESPACE = 'payment';

const CACHE_PROVIDER = 'airtel';

const CACHE_COMPONENT = 'idempotency';

const CACHE_VERSION = 'v2';

/**
 * ============================================================================
 * Utility helpers
 * ============================================================================
 */

function asPositiveInteger(value, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return fallback;
    }

    return Math.floor(number);
}

function asNonNegativeInteger(value, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return fallback;
    }

    return Math.floor(number);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ============================================================================
 * Idempotency Manager
 * ============================================================================
 */

class IdempotencyManager {

    constructor({

        cache = null,

        ttlSeconds = DEFAULT_TTL_SECONDS,

        lockTTLSeconds = DEFAULT_LOCK_TTL_SECONDS,

        logger,

        metrics,

        auditService,

        tracer,

        clock = Date,

        keyPrefix = null,

        maxKeyLength = DEFAULT_MAX_KEY_LENGTH,

        maxTenantIdLength = DEFAULT_MAX_TENANT_ID_LENGTH,

        maxMetadataKeys = DEFAULT_MAX_METADATA_KEYS,

        maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,

        maxErrorMessageLength = DEFAULT_MAX_ERROR_MESSAGE_LENGTH,

        acquireRetries = DEFAULT_ACQUIRE_RETRIES,

        acquireRetryDelayMs = DEFAULT_ACQUIRE_RETRY_DELAY_MS,

        persistResponses = true,

        persistFailures = true,

        failOpenOnCacheError = true,

        allowLocalFallback = true

    } = {}) {

        this.cache = cache;

        this.ttlSeconds =
            asPositiveInteger(
                ttlSeconds,
                DEFAULT_TTL_SECONDS
            );

        this.lockTTLSeconds =
            asPositiveInteger(
                lockTTLSeconds,
                DEFAULT_LOCK_TTL_SECONDS
            );

        this.logger = logger;

        this.metrics = metrics;

        this.auditService = auditService;

        this.tracer = tracer;

        this.clock = clock || Date;

        this.maxKeyLength =
            asPositiveInteger(
                maxKeyLength,
                DEFAULT_MAX_KEY_LENGTH
            );

        this.maxTenantIdLength =
            asPositiveInteger(
                maxTenantIdLength,
                DEFAULT_MAX_TENANT_ID_LENGTH
            );

        this.maxMetadataKeys =
            asPositiveInteger(
                maxMetadataKeys,
                DEFAULT_MAX_METADATA_KEYS
            );

        this.maxResponseBytes =
            asPositiveInteger(
                maxResponseBytes,
                DEFAULT_MAX_RESPONSE_BYTES
            );

        this.maxErrorMessageLength =
            asPositiveInteger(
                maxErrorMessageLength,
                DEFAULT_MAX_ERROR_MESSAGE_LENGTH
            );

        this.acquireRetries =
            asNonNegativeInteger(
                acquireRetries,
                DEFAULT_ACQUIRE_RETRIES
            );

        this.acquireRetryDelayMs =
            asNonNegativeInteger(
                acquireRetryDelayMs,
                DEFAULT_ACQUIRE_RETRY_DELAY_MS
            );

        this.persistResponses =
            persistResponses !== false;

        this.persistFailures =
            persistFailures !== false;

        this.failOpenOnCacheError =
            failOpenOnCacheError !== false;

        this.allowLocalFallback =
            allowLocalFallback !== false;

        this.keyPrefix =
            String(
                keyPrefix ||
                `${CACHE_NAMESPACE}:${CACHE_PROVIDER}:${CACHE_COMPONENT}:${CACHE_VERSION}`
            )
                .trim()
                .replace(/:+$/, '');

        /**
         * Local fallback store.
         *
         * This is intentionally treated as a fallback only. In a multi-node
         * production deployment, a distributed cache adapter should be used.
         */
        this.memory = new Map();

        /**
         * Local ownership information.
         *
         * This allows release/complete operations to verify that the current
         * process owns a processing lock when an operation token is supplied.
         */
        this.locks = new Map();

        this.statistics = {

            checks: 0,

            hits: 0,

            misses: 0,

            acquired: 0,

            acquisitionConflicts: 0,

            acquisitionFailures: 0,

            stored: 0,

            completed: 0,

            failed: 0,

            removed: 0,

            expired: 0,

            staleLocksRecovered: 0,

            cacheReads: 0,

            cacheWrites: 0,

            cacheErrors: 0,

            localFallbackReads: 0,

            localFallbackWrites: 0,

            shutdowns: 0

        };

        this.startedAt = this.now();

        this.shuttingDown = false;

    }

    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    now() {

        return new this.clock();

    }

    /**
     * =========================================================================
     * Validate request identity
     * =========================================================================
     */

    validate(tenantId, key) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            String(tenantId).trim() === ''
        ) {

            throw new Error(
                'tenantId required'
            );

        }

        if (
            key === undefined ||
            key === null ||
            String(key).trim() === ''
        ) {

            throw new Error(
                'idempotency key required'
            );

        }

        const normalizedTenant =
            String(tenantId).trim();

        const normalizedKey =
            String(key).trim();

        if (
            normalizedTenant.length >
            this.maxTenantIdLength
        ) {

            throw new Error(
                `tenantId exceeds maximum length of ${this.maxTenantIdLength}`
            );

        }

        if (
            normalizedKey.length >
            this.maxKeyLength
        ) {

            throw new Error(
                `idempotency key exceeds maximum length of ${this.maxKeyLength}`
            );

        }

        return {

            tenantId: normalizedTenant,

            key: normalizedKey

        };

    }

    /**
     * =========================================================================
     * Normalize metadata
     * =========================================================================
     */

    normalizeMetadata(metadata = {}) {

        if (
            metadata === null ||
            metadata === undefined
        ) {

            return {};

        }

        if (
            typeof metadata !== 'object' ||
            Array.isArray(metadata)
        ) {

            return {};

        }

        const entries =
            Object.entries(metadata)
                .slice(0, this.maxMetadataKeys);

        const result = {};

        for (const [key, value] of entries) {

            if (!key) {
                continue;
            }

            /**
             * Do not allow common secret-bearing fields into operational
             * metadata.
             */
            if (
                this.isSensitiveField(key)
            ) {

                continue;

            }

            if (
                value === null ||
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean'
            ) {

                result[key] = value;

                continue;

            }

            try {

                result[key] =
                    JSON.parse(
                        JSON.stringify(value)
                    );

            }
            catch {

                result[key] =
                    String(value);

            }

        }

        return result;

    }

    /**
     * =========================================================================
     * Sensitive field detection
     * =========================================================================
     */

    isSensitiveField(field) {

        const normalized =
            String(field)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');

        return [

            'authorization',

            'accesstoken',

            'refreshtoken',

            'clientsecret',

            'clientid',

            'password',

            'secret',

            'apikey',

            'token',

            'credential',

            'privatekey'

        ].some(
            sensitive =>
                normalized.includes(sensitive)
        );

    }

    /**
     * =========================================================================
     * Hash idempotency key
     * =========================================================================
     *
     * Raw keys are never placed into Redis/cache keys or logs.
     */

    hashKey(key) {

        return crypto
            .createHash('sha256')
            .update(
                String(key),
                'utf8'
            )
            .digest('hex');

    }

    /**
     * =========================================================================
     * Tenant fingerprint
     * =========================================================================
     */

    tenantFingerprint(tenantId) {

        return crypto
            .createHash('sha256')
            .update(
                String(tenantId),
                'utf8'
            )
            .digest('hex')
            .slice(0, 24);

    }

    /**
     * =========================================================================
     * Build deterministic cache key
     * =========================================================================
     */

    buildKey(tenantId, key) {

        const validated =
            this.validate(
                tenantId,
                key
            );

        return [

            this.keyPrefix,

            this.tenantFingerprint(
                validated.tenantId
            ),

            this.hashKey(
                validated.key
            )

        ].join(':');

    }

    /**
     * =========================================================================
     * Build lock key
     * =========================================================================
     */

    buildLockKey(tenantId, key) {

        return `${this.buildKey(
            tenantId,
            key
        )}:lock`;

    }

    /**
     * =========================================================================
     * Request fingerprint
     * =========================================================================
     */

    fingerprint(tenantId, key) {

        return crypto
            .createHash('sha256')
            .update(
                `${String(tenantId)}:${String(key)}`,
                'utf8'
            )
            .digest('hex');

    }

    /**
     * =========================================================================
     * Check Existing Request
     * =========================================================================
     */

    async check({

        tenantId,

        key

    }) {

        this.validate(
            tenantId,
            key
        );

        if (this.shuttingDown) {

            throw new Error(
                'Idempotency manager is shutting down'
            );

        }

        this.statistics.checks++;

        let record;

        try {

            record =
                await this.getRecord({
                    tenantId,
                    key
                });

        }
        catch (error) {

            this.statistics.cacheErrors++;

            if (!this.failOpenOnCacheError) {
                throw error;
            }

            record = null;

        }

        if (!record) {

            this.statistics.misses++;

            this.metrics?.counter?.(
                'payment_airtel_idempotency_miss_total'
            );

            return null;

        }

        if (this.isExpired(record)) {

            await this.remove({
                tenantId,
                key
            });

            this.statistics.expired++;

            this.metrics?.counter?.(
                'payment_airtel_idempotency_expired_total'
            );

            return {

                ...record,

                status:
                    STATUS.EXPIRED

            };

        }

        this.statistics.hits++;

        this.metrics?.counter?.(
            'payment_airtel_idempotency_hit_total'
        );

        return this.safeRecordForReturn(
            record
        );

    }

    /**
     * =========================================================================
     * Acquire Idempotency Lock
     * =========================================================================
     *
     * Preferred distributed-cache adapters should implement one of:
     *
     *   setIfAbsent(key, value, ttlSeconds)
     *   setNX(key, value, ttlSeconds)
     *   acquire(key, value, ttlSeconds)
     *
     * If unavailable, this implementation falls back to a read/write
     * coordination path and local protection.
     *
     * A distributed cache with an atomic SET NX primitive is strongly
     * recommended for multi-instance production deployments.
     */

    async acquire({

        tenantId,

        key,

        metadata = {},

        correlationId = crypto.randomUUID()

    }) {

        this.validate(
            tenantId,
            key
        );

        if (this.shuttingDown) {

            throw new Error(
                'Idempotency manager is shutting down'
            );

        }

        const span =
            this.tracer?.startSpan?.(
                'airtel.idempotency.acquire'
            );

        const cacheKey =
            this.buildKey(
                tenantId,
                key
            );

        const lockKey =
            this.buildLockKey(
                tenantId,
                key
            );

        const operationId =
            crypto.randomUUID();

        const startedAt =
            this.now();

        try {

            /**
             * First perform a normal lookup.
             */
            const existing =
                await this.check({
                    tenantId,
                    key
                });

            if (
                existing &&
                existing.status !== STATUS.EXPIRED
            ) {

                this.statistics.acquisitionConflicts++;

                this.metrics?.counter?.(
                    'payment_airtel_idempotency_conflict_total'
                );

                return {

                    acquired: false,

                    replay: existing.status ===
                        STATUS.COMPLETED,

                    existing:
                        this.safeRecordForReturn(
                            existing
                        )

                };

            }

            /**
             * Remove an expired record before acquisition.
             */
            if (
                existing &&
                existing.status === STATUS.EXPIRED
            ) {

                await this.remove({
                    tenantId,
                    key
                });

            }

            const lock = {

                status:
                    STATUS.PROCESSING,

                provider:
                    PROVIDER,

                tenantId,

                keyHash:
                    this.hashKey(key),

                tenantFingerprint:
                    this.tenantFingerprint(
                        tenantId
                    ),

                operationId,

                correlationId,

                metadata:
                    this.normalizeMetadata(
                        metadata
                    ),

                createdAt:
                    startedAt,

                expiresAt:
                    new Date(
                        startedAt.getTime() +
                        this.lockTTLSeconds * 1000
                    )

            };

            let acquired = false;

            /**
             * Attempt atomic distributed acquisition.
             */
            if (
                this.cache &&
                typeof this.cache.setIfAbsent ===
                'function'
            ) {

                acquired =
                    await this.cache.setIfAbsent(
                        cacheKey,
                        lock,
                        this.lockTTLSeconds
                    );

            }

            else if (
                this.cache &&
                typeof this.cache.setNX ===
                'function'
            ) {

                acquired =
                    await this.cache.setNX(
                        cacheKey,
                        lock,
                        this.lockTTLSeconds
                    );

            }

            else if (
                this.cache &&
                typeof this.cache.acquire ===
                'function'
            ) {

                acquired =
                    await this.cache.acquire(
                        cacheKey,
                        lock,
                        this.lockTTLSeconds
                    );

            }

            /**
             * Fallback coordination.
             *
             * This is not as strong as Redis SET NX, but preserves the
             * existing adapter compatibility of the original implementation.
             */
            else {

                acquired =
                    await this.acquireFallback(
                        cacheKey,
                        lock
                    );

            }

            if (!acquired) {

                /**
                 * Another node/process won the race.
                 */
                const winner =
                    await this.getRecord({
                        tenantId,
                        key
                    });

                this.statistics.acquisitionConflicts++;

                this.metrics?.counter?.(
                    'payment_airtel_idempotency_acquisition_conflict_total'
                );

                return {

                    acquired: false,

                    replay:
                        winner?.status ===
                        STATUS.COMPLETED,

                    existing:
                        winner
                            ? this.safeRecordForReturn(
                                winner
                            )
                            : null

                };

            }

            /**
             * Local ownership tracking.
             */
            this.locks.set(
                cacheKey,
                lock
            );

            /**
             * If using a generic cache.set path, persist the record.
             */
            if (
                !this.cache ||
                (
                    typeof this.cache.setIfAbsent !== 'function' &&
                    typeof this.cache.setNX !== 'function' &&
                    typeof this.cache.acquire !== 'function'
                )
            ) {

                await this.save({
                    tenantId,
                    key,
                    record: lock,
                    ttlSeconds:
                        this.lockTTLSeconds
                });

            }

            this.statistics.acquired++;

            this.metrics?.counter?.(
                'payment_airtel_idempotency_lock_created_total'
            );

            this.metrics?.gauge?.(
                'payment_airtel_idempotency_active_locks',
                this.locks.size
            );

            this.logger?.debug?.({

                message:
                    'Airtel idempotency lock acquired',

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId,

                keyHash:
                    this.hashKey(key)

            });

            await this.auditService?.record?.({

                action:
                    'AIRTEL_IDEMPOTENCY_LOCK_ACQUIRED',

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                metadata: {

                    operationId,

                    keyHash:
                        this.hashKey(key)

                }

            });

            return {

                acquired: true,

                operationId,

                lock:
                    this.safeRecordForReturn(
                        lock
                    ),

                startedAt

            };

        }
        catch (error) {

            this.statistics.acquisitionFailures++;

            this.metrics?.counter?.(
                'payment_airtel_idempotency_acquisition_failure_total'
            );

            this.logger?.error?.({

                message:
                    'Airtel idempotency acquisition failed',

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                error:
                    this.safeError(error)

            });

            throw error;

        }
        finally {

            span?.end?.();

        }

    }

    /**
     * =========================================================================
     * Fallback acquisition
     * =========================================================================
     */

    async acquireFallback(
        cacheKey,
        lock
    ) {

        /**
         * Local in-process atomicity.
         *
         * JavaScript execution is single-threaded, so checking and setting the
         * Map in the same synchronous turn prevents concurrent local callers
         * from entering this critical section.
         */
        const localExisting =
            this.memory.get(
                cacheKey
            );

        if (
            localExisting &&
            !this.isExpired(localExisting)
        ) {

            return false;

        }

        if (
            localExisting &&
            this.isExpired(localExisting)
        ) {

            this.memory.delete(
                cacheKey
            );

            this.statistics.staleLocksRecovered++;

        }

        this.memory.set(
            cacheKey,
            lock
        );

        this.statistics.localFallbackWrites++;

        return true;

    }

    /**
     * =========================================================================
     * Complete Idempotent Operation
     * =========================================================================
     */

    async complete({

        tenantId,

        key,

        response,

        metadata = {},

        operationId = null,

        correlationId = crypto.randomUUID(),

        statusCode = null

    }) {

        this.validate(
            tenantId,
            key
        );

        const cacheKey =
            this.buildKey(
                tenantId,
                key
            );

        const existing =
            await this.getRecord({
                tenantId,
                key
            });

        /**
         * If an operation ID is supplied, only its owner should be able to
         * finalize the record.
         */
        if (
            operationId &&
            existing?.operationId &&
            existing.operationId !== operationId
        ) {

            throw new Error(
                'Idempotency operation ownership conflict'
            );

        }

        const now =
            this.now();

        const record = {

            status:
                STATUS.COMPLETED,

            provider:
                PROVIDER,

            tenantId,

            keyHash:
                this.hashKey(key),

            operationId:
                operationId ||
                existing?.operationId ||
                null,

            correlationId,

            metadata:
                this.normalizeMetadata(
                    metadata
                ),

            statusCode:

                Number.isFinite(
                    Number(statusCode)
                )
                    ? Number(statusCode)
                    : null,

            completedAt:
                now,

            expiresAt:
                new Date(
                    now.getTime() +
                    this.ttlSeconds * 1000
                )

        };

        /**
         * Response replay can be disabled for security-sensitive workflows.
         */
        if (this.persistResponses) {

            record.response =
                this.sanitizeResponse(
                    response
                );

        }

        await this.save({

            tenantId,

            key,

            record,

            ttlSeconds:
                this.ttlSeconds

        });

        this.locks.delete(
            cacheKey
        );

        this.statistics.stored++;

        this.statistics.completed++;

        this.metrics?.counter?.(
            'payment_airtel_idempotency_completed_total'
        );

        this.metrics?.gauge?.(
            'payment_airtel_idempotency_active_locks',
            this.locks.size
        );

        await this.auditService?.record?.({

            action:
                'AIRTEL_IDEMPOTENCY_COMPLETED',

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            metadata: {

                operationId:
                    record.operationId,

                keyHash:
                    record.keyHash,

                statusCode:
                    record.statusCode

            }

        });

        this.logger?.debug?.({

            message:
                'Airtel idempotent operation completed',

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            operationId:
                record.operationId,

            keyHash:
                record.keyHash

        });

        return this.safeRecordForReturn(
            record
        );

    }

    /**
     * =========================================================================
     * Fail Idempotent Operation
     * =========================================================================
     */

    async fail({

        tenantId,

        key,

        error,

        metadata = {},

        operationId = null,

        correlationId = crypto.randomUUID(),

        retryable = false

    }) {

        this.validate(
            tenantId,
            key
        );

        const cacheKey =
            this.buildKey(
                tenantId,
                key
            );

        const existing =
            await this.getRecord({
                tenantId,
                key
            });

        if (
            operationId &&
            existing?.operationId &&
            existing.operationId !== operationId
        ) {

            throw new Error(
                'Idempotency operation ownership conflict'
            );

        }

        const now =
            this.now();

        const record = {

            status:
                STATUS.FAILED,

            provider:
                PROVIDER,

            tenantId,

            keyHash:
                this.hashKey(key),

            operationId:
                operationId ||
                existing?.operationId ||
                null,

            correlationId,

            metadata:
                this.normalizeMetadata(
                    metadata
                ),

            retryable:
                Boolean(retryable),

            error:
                this.normalizeError(
                    error
                ),

            failedAt:
                now,

            expiresAt:
                new Date(
                    now.getTime() +
                    this.ttlSeconds * 1000
                )

        };

        /**
         * If failures are configured not to persist, release the lock instead.
         */
        if (this.persistFailures) {

            await this.save({

                tenantId,

                key,

                record,

                ttlSeconds:
                    this.ttlSeconds

            });

        }
        else {

            await this.remove({

                tenantId,

                key

            });

        }

        this.locks.delete(
            cacheKey
        );

        this.statistics.failed++;

        this.metrics?.counter?.(
            'payment_airtel_idempotency_failed_total'
        );

        this.metrics?.gauge?.(
            'payment_airtel_idempotency_active_locks',
            this.locks.size
        );

        await this.auditService?.record?.({

            action:
                'AIRTEL_IDEMPOTENCY_FAILED',

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            metadata: {

                operationId:
                    record.operationId,

                keyHash:
                    record.keyHash,

                retryable:
                    record.retryable

            }

        });

        return this.safeRecordForReturn(
            record
        );

    }

    /**
     * =========================================================================
     * Release Processing Lock
     * =========================================================================
     *
     * Useful when an operation should be retried immediately rather than
     * retaining a FAILED idempotency record.
     */

    async release({

        tenantId,

        key,

        operationId = null

    }) {

        this.validate(
            tenantId,
            key
        );

        const cacheKey =
            this.buildKey(
                tenantId,
                key
            );

        const existing =
            await this.getRecord({
                tenantId,
                key
            });

        if (!existing) {
            return false;
        }

        if (
            existing.status !==
            STATUS.PROCESSING
        ) {

            return false;

        }

        if (
            operationId &&
            existing.operationId &&
            existing.operationId !== operationId
        ) {

            throw new Error(
                'Idempotency operation ownership conflict'
            );

        }

        await this.remove({

            tenantId,

            key

        });

        this.locks.delete(
            cacheKey
        );

        return true;

    }

    /**
     * =========================================================================
     * Remove Entry
     * =========================================================================
     */

    async remove({

        tenantId,

        key

    }) {

        this.validate(
            tenantId,
            key
        );

        const cacheKey =
            this.buildKey(
                tenantId,
                key
            );

        let removed = false;

        try {

            if (
                this.cache &&
                typeof this.cache.delete ===
                'function'
            ) {

                const result =
                    await this.cache.delete(
                        cacheKey
                    );

                removed =
                    result === undefined
                        ? true
                        : Boolean(result);

            }

        }
        catch (error) {

            this.statistics.cacheErrors++;

            this.logger?.warn?.({

                message:
                    'Airtel idempotency distributed cache removal failed',

                provider:
                    PROVIDER,

                tenantId,

                error:
                    this.safeError(error)

            });

            if (!this.failOpenOnCacheError) {
                throw error;
            }

        }

        const localRemoved =
            this.memory.delete(
                cacheKey
            );

        this.locks.delete(
            cacheKey
        );

        if (localRemoved) {
            removed = true;
        }

        if (removed) {

            this.statistics.removed++;

            this.metrics?.counter?.(
                'payment_airtel_idempotency_removed_total'
            );

        }

        return removed;

    }

    /**
     * =========================================================================
     * Save Record
     * =========================================================================
     */

    async save({

        tenantId,

        key,

        record,

        ttlSeconds = null

    }) {

        const cacheKey =
            this.buildKey(
                tenantId,
                key
            );

        const ttl =
            asPositiveInteger(

                ttlSeconds,

                record?.status ===
                    STATUS.PROCESSING

                    ? this.lockTTLSeconds

                    : this.ttlSeconds

            );

        if (
            this.cache &&
            typeof this.cache.set ===
            'function'
        ) {

            try {

                await this.cache.set(

                    cacheKey,

                    record,

                    ttl

                );

                this.statistics.cacheWrites++;

            }
            catch (error) {

                this.statistics.cacheErrors++;

                this.logger?.warn?.({

                    message:
                        'Airtel idempotency distributed cache write failed',

                    provider:
                        PROVIDER,

                    tenantId,

                    error:
                        this.safeError(error)

                });

                if (!this.failOpenOnCacheError) {
                    throw error;
                }

            }

        }

        if (this.allowLocalFallback) {

            this.memory.set(
                cacheKey,
                record
            );

            this.statistics.localFallbackWrites++;

        }

        return true;

    }

    /**
     * =========================================================================
     * Get Record
     * =========================================================================
     */

    async getRecord({

        tenantId,

        key

    }) {

        const cacheKey =
            this.buildKey(
                tenantId,
                key
            );

        if (
            this.cache &&
            typeof this.cache.get ===
            'function'
        ) {

            try {

                this.statistics.cacheReads++;

                const cached =
                    await this.cache.get(
                        cacheKey
                    );

                if (cached) {

                    /**
                     * Keep local cache synchronized with the distributed
                     * representation.
                     */
                    if (this.allowLocalFallback) {

                        this.memory.set(
                            cacheKey,
                            cached
                        );

                    }

                    return cached;

                }

            }
            catch (error) {

                this.statistics.cacheErrors++;

                this.logger?.warn?.({

                    message:
                        'Airtel idempotency distributed cache read failed',

                    provider:
                        PROVIDER,

                    tenantId,

                    error:
                        this.safeError(error)

                });

                if (!this.failOpenOnCacheError) {
                    throw error;
                }

            }

        }

        if (!this.allowLocalFallback) {
            return null;
        }

        const local =
            this.memory.get(
                cacheKey
            );

        this.statistics.localFallbackReads++;

        return local || null;

    }

    /**
     * =========================================================================
     * Expiration
     * =========================================================================
     */

    isExpired(record) {

        if (
            !record ||
            !record.expiresAt
        ) {

            return true;

        }

        const expiresAt =
            record.expiresAt instanceof Date

                ? record.expiresAt.getTime()

                : new Date(
                    record.expiresAt
                ).getTime();

        if (!Number.isFinite(expiresAt)) {
            return true;
        }

        return (
            expiresAt <=
            this.now().getTime()
        );

    }

    /**
     * =========================================================================
     * Cleanup Expired Local Entries
     * =========================================================================
     */

    cleanupExpired() {

        const now =
            this.now().getTime();

        let removed = 0;

        for (
            const [cacheKey, record]
            of this.memory.entries()
        ) {

            const expiresAt =
                record?.expiresAt instanceof Date

                    ? record.expiresAt.getTime()

                    : new Date(
                        record?.expiresAt
                    ).getTime();

            if (
                !Number.isFinite(expiresAt) ||
                expiresAt <= now
            ) {

                this.memory.delete(
                    cacheKey
                );

                this.locks.delete(
                    cacheKey
                );

                removed++;

            }

        }

        if (removed > 0) {

            this.statistics.expired +=
                removed;

        }

        return removed;

    }

    /**
     * =========================================================================
     * Safe Response Sanitization
     * =========================================================================
     *
     * Idempotency responses may contain provider data. We defensively clone
     * them and remove obvious secret-bearing fields.
     */

    sanitizeResponse(response) {

        if (
            response === undefined ||
            response === null
        ) {

            return null;

        }

        let cloned;

        try {

            cloned =
                JSON.parse(
                    JSON.stringify(response)
                );

        }
        catch {

            cloned =
                String(response);

        }

        const sanitized =
            this.redactSensitiveValues(
                cloned
            );

        /**
         * Avoid allowing extremely large provider responses to become a
         * persistent cache-memory amplification vector.
         */
        let serialized;

        try {

            serialized =
                JSON.stringify(
                    sanitized
                );

        }
        catch {

            serialized =
                JSON.stringify(
                    String(sanitized)
                );

        }

        if (
            Buffer.byteLength(
                serialized || '',
                'utf8'
            ) >
            this.maxResponseBytes
        ) {

            return {

                truncated: true,

                message:
                    'Idempotency response exceeded configured persistence limit'

            };

        }

        return sanitized;

    }

    /**
     * =========================================================================
     * Recursive secret redaction
     * =========================================================================
     */

    redactSensitiveValues(value) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;

        }

        if (
            typeof value !== 'object'
        ) {

            return value;

        }

        if (Array.isArray(value)) {

            return value.map(
                item =>
                    this.redactSensitiveValues(
                        item
                    )
            );

        }

        const result = {};

        for (
            const [key, child]
            of Object.entries(value)
        ) {

            if (
                this.isSensitiveField(key)
            ) {

                result[key] =
                    '[REDACTED]';

                continue;

            }

            result[key] =
                this.redactSensitiveValues(
                    child
                );

        }

        return result;

    }

    /**
     * =========================================================================
     * Normalize Errors
     * =========================================================================
     */

    normalizeError(error) {

        if (!error) {

            return {

                message:
                    'Unknown operation failure'

            };

        }

        return {

            name:
                String(
                    error.name ||
                    'Error'
                ).slice(0, 200),

            message:
                String(
                    error.message ||
                    error
                ).slice(
                    0,
                    this.maxErrorMessageLength
                ),

            code:
                error.code
                    ? String(
                        error.code
                    ).slice(0, 200)
                    : undefined,

            retryable:
                Boolean(
                    error.retryable
                )

        };

    }

    /**
     * =========================================================================
     * Safe Error
     * =========================================================================
     */

    safeError(error) {

        if (!error) {
            return null;
        }

        return {

            name:
                String(
                    error.name ||
                    'Error'
                ).slice(0, 200),

            message:
                String(
                    error.message ||
                    error
                ).slice(
                    0,
                    this.maxErrorMessageLength
                ),

            code:
                error.code
                    ? String(error.code).slice(
                        0,
                        200
                    )
                    : undefined

        };

    }

    /**
     * =========================================================================
     * Safe Record
     * =========================================================================
     *
     * Never return the raw idempotency key.
     */

    safeRecordForReturn(record) {

        if (!record) {
            return null;
        }

        const result = {

            ...record,

            keyHash:
                record.keyHash ||
                undefined

        };

        delete result.key;

        if (result.response) {

            result.response =
                this.sanitizeResponse(
                    result.response
                );

        }

        if (result.metadata) {

            result.metadata =
                this.normalizeMetadata(
                    result.metadata
                );

        }

        return result;

    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            activeEntries:
                this.memory.size,

            activeLocks:
                this.locks.size,

            ttlSeconds:
                this.ttlSeconds,

            lockTTLSeconds:
                this.lockTTLSeconds,

            startedAt:
                this.startedAt,

            uptimeMs:
                this.now().getTime() -
                this.startedAt.getTime(),

            distributedCache:
                Boolean(this.cache),

            localFallbackEnabled:
                this.allowLocalFallback,

            shuttingDown:
                this.shuttingDown

        };

    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        let cacheStatus =
            'NOT_CONFIGURED';

        if (this.cache) {

            cacheStatus =
                'UNKNOWN';

            try {

                if (
                    typeof this.cache.health ===
                    'function'
                ) {

                    const result =
                        await this.cache.health();

                    cacheStatus =
                        result?.status ||
                        'UP';

                }
                else {

                    cacheStatus =
                        'UP';

                }

            }
            catch {

                cacheStatus =
                    'DOWN';

            }

        }

        const status =
            this.shuttingDown
                ? 'DOWN'
                : (
                    cacheStatus === 'DOWN' &&
                    !this.allowLocalFallback
                )
                    ? 'DOWN'
                    : (
                        cacheStatus === 'DOWN'
                            ? 'DEGRADED'
                            : 'UP'
                    );

        return {

            provider:
                PROVIDER,

            component:
                'idempotency',

            status,

            cacheStatus,

            localFallback:
                this.allowLocalFallback,

            activeEntries:
                this.memory.size,

            activeLocks:
                this.locks.size,

            statistics:
                this.stats()

        };

    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     *
     * Operational snapshot intentionally excludes raw keys, responses and
     * secrets.
     */

    snapshot() {

        const entries =
            [];

        for (
            const [cacheKey, record]
            of this.memory.entries()
        ) {

            entries.push({

                cacheKey,

                status:
                    record?.status,

                tenantFingerprint:
                    record?.tenantFingerprint,

                keyHash:
                    record?.keyHash,

                operationId:
                    record?.operationId,

                correlationId:
                    record?.correlationId,

                createdAt:
                    record?.createdAt,

                expiresAt:
                    record?.expiresAt

            });

        }

        return {

            provider:
                PROVIDER,

            component:
                'idempotency',

            startedAt:
                this.startedAt,

            uptimeMs:
                this.now().getTime() -
                this.startedAt.getTime(),

            activeEntries:
                this.memory.size,

            activeLocks:
                this.locks.size,

            entries,

            statistics:
                this.stats()

        };

    }

    /**
     * =========================================================================
     * Clear Local Cache
     * =========================================================================
     */

    clearLocal() {

        this.memory.clear();

        this.locks.clear();

        return true;

    }

    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown({

        clearDistributed = false

    } = {}) {

        if (this.shuttingDown) {
            return true;
        }

        this.shuttingDown = true;

        /**
         * Distributed idempotency records normally should NOT be deleted on
         * application shutdown because completed responses are deliberately
         * durable for their configured TTL.
         *
         * Therefore clearDistributed defaults to false.
         */
        if (
            clearDistributed &&
            this.cache &&
            typeof this.cache.clearNamespace ===
            'function'
        ) {

            try {

                await this.cache.clearNamespace(
                    this.keyPrefix
                );

            }
            catch (error) {

                this.logger?.warn?.({

                    message:
                        'Airtel idempotency distributed namespace cleanup failed',

                    provider:
                        PROVIDER,

                    error:
                        this.safeError(error)

                });

            }

        }

        this.clearLocal();

        this.statistics.shutdowns++;

        this.metrics?.gauge?.(
            'payment_airtel_idempotency_active_locks',
            0
        );

        return true;

    }

}

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */

module.exports = {

    IdempotencyManager,

    IDEMPOTENCY_STATUS: STATUS,

    IDEMPOTENCY_STATUS_CODES: STATUS,

    AIRTEL_IDEMPOTENCY_PROVIDER: PROVIDER

};