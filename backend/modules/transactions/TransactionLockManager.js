'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Lock Manager
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionLockManager.js
 *
 * Purpose
 * -------
 * Distributed lease-based locking for financial transaction coordination.
 *
 * Responsibilities
 * ----------------
 * • Distributed Redis locking
 * • Atomic lock acquisition
 * • Atomic owner-safe release
 * • Atomic owner-safe renewal
 * • In-memory fallback
 * • Lease expiration
 * • Heartbeat renewal
 * • Reentrant ownership
 * • Tenant/resource isolation
 * • Acquisition timeout
 * • Lease-loss detection
 * • Administrative force release
 * • Metrics
 * • Audit hooks
 * • OpenTelemetry hooks
 * • Graceful cleanup
 *
 * Important
 * ---------
 * A lock is a coordination primitive, NOT a financial source of truth.
 *
 * Financial correctness must still be protected by:
 *
 * • database transactions
 * • unique constraints
 * • optimistic concurrency
 * • ledger invariants
 * • idempotency
 *
 * Redis release/renew operations are implemented atomically so an expired
 * lease cannot be accidentally released or renewed by its former owner after
 * another worker has acquired the resource.
 *
 * ============================================================================
 */

const crypto = require('crypto');


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_LOCK_TTL_MS =
    30000;

const DEFAULT_WAIT_TIMEOUT_MS =
    10000;

const DEFAULT_RETRY_DELAY_MS =
    100;

const DEFAULT_HEARTBEAT_FRACTION =
    1 / 3;

const DEFAULT_NAMESPACE =
    'transaction:lock';

const DEFAULT_MAX_RESOURCE_LENGTH =
    512;

const DEFAULT_OWNER_LENGTH =
    256;


/**
 * ============================================================================
 * Lock States
 * ============================================================================
 */

const LOCK_STATES = Object.freeze({

    ACQUIRED:
        'ACQUIRED',

    BUSY:
        'BUSY',

    EXPIRED:
        'EXPIRED',

    RELEASED:
        'RELEASED',

    LOST:
        'LOST',

    FAILED:
        'FAILED'

});


/**
 * ============================================================================
 * Redis Lua Scripts
 * ============================================================================
 *
 * These are deliberately atomic.
 */

/**
 * Compare owner + increment reentrant count, or create new lock.
 *
 * Stored Redis value:
 *
 * {
 *   owner: "...",
 *   count: 1,
 *   fencingToken: "...",
 *   acquiredAt: 123,
 *   expiresAt: 123
 * }
 */
const REDIS_ACQUIRE_SCRIPT = `
local existing = redis.call('GET', KEYS[1])

if not existing then

    local token = ARGV[2]

    local value = cjson.encode({
        owner = ARGV[1],
        count = 1,
        fencingToken = token,
        acquiredAt = tonumber(ARGV[3]),
        expiresAt = tonumber(ARGV[3]) + tonumber(ARGV[4])
    })

    redis.call(
        'SET',
        KEYS[1],
        value,
        'PX',
        ARGV[4]
    )

    return {
        1,
        value
    }

end

local decoded = cjson.decode(existing)

if decoded.owner == ARGV[1] then

    decoded.count =
        tonumber(decoded.count or 0) + 1

    decoded.expiresAt =
        tonumber(ARGV[3]) + tonumber(ARGV[4])

    local value =
        cjson.encode(decoded)

    redis.call(
        'SET',
        KEYS[1],
        value,
        'PX',
        ARGV[4]
    )

    return {
        2,
        value
    }

end

return {
    0,
    existing
}
`;


/**
 * Release one reentrant level.
 *
 * Returns:
 * 1 = fully released
 * 2 = decremented but still owned
 * 0 = owner mismatch / lock absent
 */
const REDIS_RELEASE_SCRIPT = `
local existing = redis.call('GET', KEYS[1])

if not existing then
    return 0
end

local decoded = cjson.decode(existing)

if decoded.owner ~= ARGV[1] then
    return 0
end

local count =
    tonumber(decoded.count or 1)

if count > 1 then

    decoded.count =
        count - 1

    local value =
        cjson.encode(decoded)

    local ttl =
        redis.call('PTTL', KEYS[1])

    if ttl < 1 then
        return 0
    end

    redis.call(
        'SET',
        KEYS[1],
        value,
        'PX',
        ttl
    )

    return 2

end

redis.call(
    'DEL',
    KEYS[1]
)

return 1
`;


/**
 * Renew only if the current owner still owns the lock.
 */
const REDIS_RENEW_SCRIPT = `
local existing = redis.call('GET', KEYS[1])

if not existing then
    return 0
end

local decoded =
    cjson.decode(existing)

if decoded.owner ~= ARGV[1] then
    return 0
end

decoded.expiresAt =
    tonumber(ARGV[2]) + tonumber(ARGV[3])

local value =
    cjson.encode(decoded)

redis.call(
    'SET',
    KEYS[1],
    value,
    'PX',
    ARGV[3]
)

return 1
`;


/**
 * Administrative force release.
 *
 * Can optionally require the expected owner for safer operational recovery.
 */
const REDIS_FORCE_RELEASE_SCRIPT = `
local existing = redis.call('GET', KEYS[1])

if not existing then
    return 0
end

if ARGV[1] ~= '' then

    local decoded =
        cjson.decode(existing)

    if decoded.owner ~= ARGV[1] then
        return 0
    end

end

redis.call(
    'DEL',
    KEYS[1]
)

return 1
`;


/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function safeError(error) {

    if (!error) {

        return {

            name:
                'Error',

            code:
                'UNKNOWN',

            message:
                'Unknown lock error'

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
            String(
                error.message ||
                error
            )
                .slice(
                    0,
                    2000
                )

    };

}


/**
 * ============================================================================
 * Transaction Lock Manager
 * ============================================================================
 */

class TransactionLockManager {

    constructor(options = {}) {

        this.redis =
            options.redis ||
            null;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.tracer =
            options.tracer ||
            null;

        this.auditPublisher =
            options.auditPublisher ||
            null;

        this.namespace =
            this.normalizeNamespace(
                options.namespace ||
                DEFAULT_NAMESPACE
            );

        this.defaultTTL =
            this.normalizePositiveInteger(
                options.defaultTTL ||
                DEFAULT_LOCK_TTL_MS,
                DEFAULT_LOCK_TTL_MS
            );

        this.waitTimeout =
            this.normalizePositiveInteger(
                options.waitTimeout ||
                DEFAULT_WAIT_TIMEOUT_MS,
                DEFAULT_WAIT_TIMEOUT_MS
            );

        this.retryDelay =
            this.normalizePositiveInteger(
                options.retryDelay ||
                DEFAULT_RETRY_DELAY_MS,
                DEFAULT_RETRY_DELAY_MS
            );

        this.heartbeatFraction =
            Number.isFinite(
                Number(
                    options.heartbeatFraction
                )
            )
                ? Math.min(
                    0.8,
                    Math.max(
                        0.05,
                        Number(
                            options.heartbeatFraction
                        )
                    )
                )
                : DEFAULT_HEARTBEAT_FRACTION;

        this.instanceId =
            options.instanceId ||
            crypto.randomUUID();

        this.maxResourceLength =
            Number(
                options.maxResourceLength ||
                DEFAULT_MAX_RESOURCE_LENGTH
            );

        this.maxOwnerLength =
            Number(
                options.maxOwnerLength ||
                DEFAULT_OWNER_LENGTH
            );

        this.allowMemoryFallback =
            options.allowMemoryFallback !== false;

        this.requireRedis =
            options.requireRedis === true;

        /**
         * Memory fallback.
         *
         * key -> {
         *   owner,
         *   count,
         *   fencingToken,
         *   acquiredAt,
         *   expiresAt
         * }
         */
        this.memoryLocks =
            new Map();

        /**
         * Active heartbeat jobs.
         *
         * key -> {
         *   timer,
         *   owner,
         *   ttl,
         *   lock
         * }
         */
        this.heartbeats =
            new Map();

        /**
         * Local ownership state.
         *
         * key -> local reference count
         */
        this.localReferences =
            new Map();

        this.statistics = {

            acquisitions:
                0,

            acquired:
                0,

            busy:
                0,

            timeouts:
                0,

            releases:
                0,

            releaseFailures:
                0,

            renewals:
                0,

            renewalFailures:
                0,

            leaseLosses:
                0,

            forcedReleases:
                0,

            reentrantAcquisitions:
                0,

            memoryFallbackAcquisitions:
                0

        };

    }


    /**
     * =========================================================================
     * Acquire Lock
     * =========================================================================
     */

    async acquire(
        resource,
        options = {}
    ) {

        const span =
            this.startSpan(
                'transaction.lock.acquire',
                {

                    'lock.resource':
                        resource,

                    'lock.tenant_id':
                        options.tenantId ||
                        'global'

                }
            );

        const owner =
            this.normalizeOwner(
                options.owner ||
                this.buildDefaultOwner()
            );

        const tenantId =
            this.normalizeTenant(
                options.tenantId ||
                'global'
            );

        const ttl =
            this.normalizePositiveInteger(
                options.ttl ||
                this.defaultTTL,
                this.defaultTTL
            );

        const timeout =
            this.normalizePositiveInteger(
                options.timeout ||
                this.waitTimeout,
                this.waitTimeout
            );

        const retryDelay =
            this.normalizePositiveInteger(
                options.retryDelay ||
                this.retryDelay,
                this.retryDelay
            );

        const normalizedResource =
            this.normalizeResource(
                resource
            );

        const key =
            this.buildKey(
                tenantId,
                normalizedResource
            );

        const startedAt =
            Date.now();

        this.statistics.acquisitions++;

        try {

            if (
                this.requireRedis &&
                !this.redis
            ) {

                const error =
                    new Error(
                        'Redis is required for transaction locking'
                    );

                error.code =
                    'LOCK_REDIS_REQUIRED';

                throw error;

            }


            while (
                true
            ) {

                const result =
                    this.redis

                        ? await this.acquireRedis(
                            key,
                            owner,
                            ttl
                        )

                        : await this.acquireMemory(
                            key,
                            owner,
                            ttl
                        );


                if (
                    result.acquired
                ) {

                    const lock = {

                        resource:
                            normalizedResource,

                        tenantId,

                        owner,

                        key,

                        ttl,

                        count:
                            result.count ||
                            1,

                        fencingToken:
                            result.fencingToken ||
                            null,

                        acquiredAt:
                            new Date(),

                        state:
                            LOCK_STATES.ACQUIRED,

                        managerInstanceId:
                            this.instanceId

                    };


                    this.localReferences.set(
                        key,
                        lock.count
                    );


                    this.startHeartbeat(
                        lock
                    );


                    this.statistics.acquired++;

                    if (
                        result.reentrant
                    ) {

                        this.statistics.reentrantAcquisitions++;

                        this.metrics?.increment?.(
                            'transaction_lock_reentrant_total'
                        );

                    }


                    this.metrics?.increment?.(
                        'transaction_lock_acquired_total'
                    );


                    await this.publishAuditSafely({

                        type:
                            'LOCK_ACQUIRED',

                        resource:
                            normalizedResource,

                        tenantId,

                        owner,

                        transactionId:
                            options.transactionId ||
                            null,

                        correlationId:
                            options.correlationId ||
                            null,

                        fencingToken:
                            lock.fencingToken,

                        timestamp:
                            new Date()

                    });


                    this.setSpanSuccess(
                        span
                    );


                    return lock;

                }


                this.statistics.busy++;

                this.metrics?.increment?.(
                    'transaction_lock_busy_total'
                );


                if (
                    Date.now() -
                        startedAt >=
                    timeout
                ) {

                    this.statistics.timeouts++;

                    this.metrics?.increment?.(
                        'transaction_lock_timeout_total'
                    );


                    const error =
                        new Error(

                            `Timeout acquiring lock for ${normalizedResource}`

                        );

                    error.name =
                        'TransactionLockTimeoutError';

                    error.code =
                        'LOCK_TIMEOUT';

                    error.retryable =
                        true;

                    error.resource =
                        normalizedResource;

                    error.tenantId =
                        tenantId;


                    this.setSpanError(
                        span,
                        error
                    );


                    throw error;

                }


                await this.sleep(
                    retryDelay
                );

            }

        }
        catch (error) {

            this.setSpanError(
                span,
                error
            );

            throw error;

        }
        finally {

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Release Lock
     * =========================================================================
     */

    async release(
        lock
    ) {

        if (
            !lock
        ) {

            return false;

        }


        const key =
            lock.key;

        const owner =
            lock.owner;


        this.stopHeartbeat(
            key
        );


        let result;


        try {

            result =
                this.redis

                    ? await this.releaseRedis(
                        key,
                        owner
                    )

                    : await this.releaseMemory(
                        key,
                        owner
                    );


            if (
                result.released
            ) {

                this.statistics.releases++;

                this.metrics?.increment?.(
                    'transaction_lock_released_total'
                );


                await this.publishAuditSafely({

                    type:
                        'LOCK_RELEASED',

                    resource:
                        lock.resource,

                    tenantId:
                        lock.tenantId,

                    owner,

                    transactionId:
                        lock.transactionId ||
                        null,

                    correlationId:
                        lock.correlationId ||
                        null,

                    fencingToken:
                        lock.fencingToken ||
                        null,

                    timestamp:
                        new Date()

                });


                return true;

            }


            if (
                result.decremented
            ) {

                this.localReferences.set(

                    key,

                    Math.max(
                        0,
                        Number(
                            result.count ||
                            0
                        )
                    )

                );


                return true;

            }


            this.statistics.releaseFailures++;

            this.metrics?.increment?.(
                'transaction_lock_release_failure_total'
            );


            /**
             * If the lock disappeared because the lease expired, that is not
             * an authorization to delete someone else's replacement lock.
             */
            if (
                result.ownerMismatch ||
                result.notFound
            ) {

                return false;

            }


            return false;

        }
        catch (error) {

            this.statistics.releaseFailures++;

            this.metrics?.increment?.(
                'transaction_lock_release_error_total'
            );


            this.logger.error?.({

                message:
                    'Transaction lock release failed',

                key,

                owner,

                error:
                    safeError(
                        error
                    )

            });


            throw error;

        }

    }


    /**
     * =========================================================================
     * Execute Within Lock
     * =========================================================================
     */

    async execute(
        resource,
        operation,
        options = {}
    ) {

        if (
            typeof operation !==
            'function'
        ) {

            throw new TypeError(
                'Lock operation must be a function'
            );

        }


        const lock =
            await this.acquire(
                resource,
                options
            );


        try {

            return await operation(
                lock
            );

        }
        finally {

            await this.release(
                lock
            );

        }

    }


    /**
     * =========================================================================
     * Redis Acquire
     * =========================================================================
     */

    async acquireRedis(
        key,
        owner,
        ttl
    ) {

        const acquiredAt =
            Date.now();

        const fencingToken =
            crypto.randomUUID();

        const result =
            await this.evalRedis(

                REDIS_ACQUIRE_SCRIPT,

                [key],

                [

                    owner,

                    fencingToken,

                    String(
                        acquiredAt
                    ),

                    String(
                        ttl
                    )

                ]

            );


        if (
            !Array.isArray(
                result
            )
        ) {

            return {

                acquired:
                    false

            };

        }


        const code =
            Number(
                result[0]
            );


        if (
            code ===
            1
        ) {

            return {

                acquired:
                    true,

                reentrant:
                    false,

                count:
                    1,

                fencingToken

            };

        }


        if (
            code ===
            2
        ) {

            let decoded = null;

            try {

                decoded =
                    this.parseRedisValue(
                        result[1]
                    );

            }
            catch (_) {
                decoded = null;
            }


            return {

                acquired:
                    true,

                reentrant:
                    true,

                count:
                    Number(
                        decoded?.count ||
                        1
                    ),

                fencingToken:
                    decoded?.fencingToken ||
                    null

            };

        }


        return {

            acquired:
                false

        };

    }


    /**
     * =========================================================================
     * Redis Release
     * =========================================================================
     */

    async releaseRedis(
        key,
        owner
    ) {

        const result =
            await this.evalRedis(

                REDIS_RELEASE_SCRIPT,

                [key],

                [owner]

            );


        const code =
            Number(
                result
            );


        if (
            code ===
            1
        ) {

            this.localReferences.delete(
                key
            );


            return {

                released:
                    true,

                decremented:
                    false

            };

        }


        if (
            code ===
            2
        ) {

            const current =
                await this.readRedisLock(
                    key
                );


            return {

                released:
                    false,

                decremented:
                    true,

                count:
                    Number(
                        current?.count ||
                        0
                    )

            };

        }


        const exists =
            await this.redisExists(
                key
            );


        return {

            released:
                false,

            decremented:
                false,

            ownerMismatch:
                exists,

            notFound:
                !exists

        };

    }


    /**
     * =========================================================================
     * Redis Renew
     * =========================================================================
     */

    async renewRedis(
        key,
        owner,
        ttl
    ) {

        const result =
            await this.evalRedis(

                REDIS_RENEW_SCRIPT,

                [key],

                [

                    owner,

                    String(
                        Date.now()
                    ),

                    String(
                        ttl
                    )

                ]

            );


        return Number(
            result
        ) === 1;

    }


    /**
     * =========================================================================
     * Redis Force Release
     * =========================================================================
     */

    async forceReleaseRedis(
        key,
        expectedOwner = ''
    ) {

        const result =
            await this.evalRedis(

                REDIS_FORCE_RELEASE_SCRIPT,

                [key],

                [

                    expectedOwner ||
                    ''

                ]

            );


        return Number(
            result
        ) === 1;

    }


    /**
     * =========================================================================
     * Redis Read
     * =========================================================================
     */

    async readRedis(
        key
    ) {

        const raw =
            await this.redis.get(
                key
            );


        if (
            !raw
        ) {

            return null;

        }


        return this.parseRedisValue(
            raw
        );

    }


    async readRedisLock(
        key
    ) {

        try {

            return await this.readRedis(
                key
            );

        }
        catch (error) {

            this.logger.warn?.({

                message:
                    'Unable to inspect Redis lock',

                key,

                error:
                    safeError(
                        error
                    )

            });


            return null;

        }

    }


    async redisExists(
        key
    ) {

        if (
            typeof this.redis.exists ===
            'function'
        ) {

            return Number(
                await this.redis.exists(
                    key
                )
            ) > 0;

        }


        return Boolean(
            await this.redis.get(
                key
            )
        );

    }


    /**
     * =========================================================================
     * Redis EVAL Compatibility
     * =========================================================================
     *
     * Supports common node-redis and ioredis calling conventions.
     */

    async evalRedis(
        script,
        keys,
        args
    ) {

        if (
            typeof this.redis.eval !==
            'function'
        ) {

            throw new Error(
                'Configured Redis client does not support EVAL'
            );

        }


        try {

            /**
             * node-redis v4.
             */
            return await this.redis.eval(

                script,

                {
                    keys,
                    arguments:
                        args

                }

            );

        }
        catch (firstError) {

            /**
             * ioredis / legacy convention.
             */
            try {

                return await this.redis.eval(

                    script,

                    keys.length,
                    ...keys,
                    ...args

                );

            }
            catch (_) {

                throw firstError;

            }

        }

    }


    /**
     * =========================================================================
     * Memory Acquire
     * =========================================================================
     */

    async acquireMemory(
        key,
        owner,
        ttl
    ) {

        let existing =
            this.memoryLocks.get(
                key
            );


        const now =
            Date.now();


        if (
            existing &&
            existing.expiresAt <=
                now
        ) {

            this.memoryLocks.delete(
                key
            );

            existing =
                null;

        }


        if (
            existing
        ) {

            if (
                existing.owner !==
                owner
            ) {

                return {

                    acquired:
                        false

                };

            }


            existing.count++;


            existing.expiresAt =
                now +
                ttl;


            this.memoryLocks.set(
                key,
                existing
            );


            this.statistics.memoryFallbackAcquisitions++;


            return {

                acquired:
                    true,

                reentrant:
                    true,

                count:
                    existing.count,

                fencingToken:
                    existing.fencingToken

            };

        }


        const lock = {

            owner,

            count:
                1,

            fencingToken:
                crypto.randomUUID(),

            acquiredAt:
                now,

            expiresAt:
                now +
                ttl

        };


        this.memoryLocks.set(
            key,
            lock
        );


        this.statistics.memoryFallbackAcquisitions++;


        this.metrics?.increment?.(
            'transaction_lock_memory_fallback_total'
        );


        return {

            acquired:
                true,

            reentrant:
                false,

            count:
                1,

            fencingToken:
                lock.fencingToken

        };

    }


    /**
     * =========================================================================
     * Memory Release
     * =========================================================================
     */

    async releaseMemory(
        key,
        owner
    ) {

        const lock =
            this.memoryLocks.get(
                key
            );


        if (
            !lock
        ) {

            return {

                released:
                    false,

                notFound:
                    true

            };

        }


        if (
            lock.expiresAt <=
                Date.now()
        ) {

            this.memoryLocks.delete(
                key
            );


            return {

                released:
                    false,

                notFound:
                    true

            };

        }


        if (
            lock.owner !==
            owner
        ) {

            return {

                released:
                    false,

                ownerMismatch:
                    true

            };

        }


        lock.count--;


        if (
            lock.count <=
            0
        ) {

            this.memoryLocks.delete(
                key
            );

            this.localReferences.delete(
                key
            );


            return {

                released:
                    true

            };

        }


        lock.expiresAt =
            Date.now() +
            Math.max(
                1000,
                this.defaultTTL
            );


        this.memoryLocks.set(
            key,
            lock
        );


        return {

            released:
                false,

            decremented:
                true,

            count:
                lock.count

        };

    }


    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     */

    startHeartbeat(
        lock
    ) {

        const key =
            lock.key;


        this.stopHeartbeat(
            key
        );


        const interval =
            Math.max(

                250,

                Math.floor(
                    lock.ttl *
                    this.heartbeatFraction
                )

            );


        const state = {

            owner:
                lock.owner,

            ttl:
                lock.ttl,

            timer:
                null,

            lock

        };


        state.timer =
            setInterval(

                async () => {

                    try {

                        let renewed;


                        if (
                            this.redis
                        ) {

                            renewed =
                                await this.renewRedis(

                                    key,

                                    state.owner,

                                    state.ttl

                                );

                        }
                        else {

                            renewed =
                                this.renewMemory(

                                    key,

                                    state.owner,

                                    state.ttl

                                );

                        }


                        if (
                            renewed
                        ) {

                            this.statistics.renewals++;


                            this.metrics?.increment?.(
                                'transaction_lock_renewed_total'
                            );

                            return;

                        }


                        /**
                         * We no longer own the lock.
                         */
                        this.statistics.renewalFailures++;
                        this.statistics.leaseLosses++;


                        lock.state =
                            LOCK_STATES.LOST;


                        this.metrics?.increment?.(
                            'transaction_lock_lease_lost_total'
                        );


                        this.logger.error?.({

                            message:
                                'Transaction lock lease lost',

                            key,

                            owner:
                                state.owner,

                            resource:
                                lock.resource,

                            tenantId:
                                lock.tenantId

                        });


                        this.stopHeartbeat(
                            key
                        );

                    }
                    catch (error) {

                        this.statistics.renewalFailures++;


                        this.metrics?.increment?.(
                            'transaction_lock_renewal_error_total'
                        );


                        this.logger.error?.({

                            message:
                                'Transaction lock heartbeat failed',

                            key,

                            owner:
                                state.owner,

                            error:
                                safeError(
                                    error
                                )

                        });

                        /**
                         * A single heartbeat failure does not immediately
                         * declare the lease lost; the next renewal can recover.
                         */

                    }

                },

                interval

            );


        this.heartbeats.set(
            key,
            state
        );

    }


    /**
     * =========================================================================
     * Memory Renew
     * =========================================================================
     */

    renewMemory(
        key,
        owner,
        ttl
    ) {

        const lock =
            this.memoryLocks.get(
                key
            );


        if (
            !lock
        ) {

            return false;

        }


        if (
            lock.owner !==
            owner
        ) {

            return false;

        }


        if (
            lock.expiresAt <=
                Date.now()
        ) {

            this.memoryLocks.delete(
                key
            );


            return false;

        }


        lock.expiresAt =
            Date.now() +
            ttl;


        this.memoryLocks.set(
            key,
            lock
        );


        return true;

    }


    /**
     * =========================================================================
     * Stop Heartbeat
     * =========================================================================
     */

    stopHeartbeat(
        key
    ) {

        const state =
            this.heartbeats.get(
                key
            );


        if (
            state?.timer
        ) {

            clearInterval(
                state.timer
            );

        }


        this.heartbeats.delete(
            key
        );

    }


    /**
     * =========================================================================
     * Lock Status
     * =========================================================================
     */

    async isLocked(
        resource,
        tenantId = 'global'
    ) {

        const key =
            this.buildKey(
                tenantId,
                resource
            );


        if (
            this.redis
        ) {

            const value =
                await this.readRedisLock(
                    key
                );


            return Boolean(
                value
            );

        }


        const lock =
            this.memoryLocks.get(
                key
            );


        if (
            !lock
        ) {

            return false;

        }


        if (
            lock.expiresAt <=
                Date.now()
        ) {

            this.memoryLocks.delete(
                key
            );

            this.stopHeartbeat(
                key
            );

            return false;

        }


        return true;

    }


    /**
     * =========================================================================
     * Inspect Lock
     * =========================================================================
     */

    async inspect(
        resource,
        tenantId = 'global'
    ) {

        const key =
            this.buildKey(
                tenantId,
                resource
            );


        const data =
            this.redis

                ? await this.readRedisLock(
                    key
                )

                : this.memoryLocks.get(
                    key
                ) || null;


        if (
            !data
        ) {

            return {

                locked:
                    false,

                key,

                tenantId,

                resource

            };

        }


        return {

            locked:
                true,

            key,

            tenantId,

            resource,

            owner:
                data.owner,

            count:
                Number(
                    data.count ||
                    1
                ),

            fencingToken:
                data.fencingToken ||
                null,

            expiresAt:
                data.expiresAt
                    ? new Date(
                        Number(
                            data.expiresAt
                        )
                    )
                    : null

        };

    }


    /**
     * =========================================================================
     * Force Release
     * =========================================================================
     *
     * Administrative operation.
     *
     * `expectedOwner` is strongly recommended. If omitted, this becomes an
     * unconditional administrative unlock.
     */

    async forceRelease(
        resource,
        tenantId = 'global',
        options = {}
    ) {

        const normalizedTenant =
            this.normalizeTenant(
                tenantId
            );

        const normalizedResource =
            this.normalizeResource(
                resource
            );

        const key =
            this.buildKey(
                normalizedTenant,
                normalizedResource
            );


        this.stopHeartbeat(
            key
        );


        let released =
            false;


        if (
            this.redis
        ) {

            released =
                await this.forceReleaseRedis(

                    key,

                    options.expectedOwner ||
                    ''

                );

        }
        else {

            const existing =
                this.memoryLocks.get(
                    key
                );


            if (
                !existing
            ) {

                return false;

            }


            if (
                options.expectedOwner &&
                existing.owner !==
                    options.expectedOwner
            ) {

                return false;

            }


            this.memoryLocks.delete(
                key
            );


            released =
                true;

        }


        if (
            released
        ) {

            this.statistics.forcedReleases++;


            this.metrics?.increment?.(
                'transaction_lock_force_release_total'
            );


            await this.publishAuditSafely({

                type:
                    'LOCK_FORCE_RELEASED',

                resource:
                    normalizedResource,

                tenantId:
                    normalizedTenant,

                expectedOwner:
                    options.expectedOwner ||
                    null,

                timestamp:
                    new Date()

            });


            this.logger.warn?.({

                message:
                    'Transaction lock force released',

                resource:
                    normalizedResource,

                tenantId:
                    normalizedTenant,

                expectedOwner:
                    options.expectedOwner ||
                    null

            });

        }


        return released;

    }


    /**
     * =========================================================================
     * Cleanup Expired Memory Locks
     * =========================================================================
     */

    cleanupExpiredLocks() {

        const now =
            Date.now();

        let removed =
            0;


        for (
            const [
                key,
                lock
            ]
            of this.memoryLocks.entries()
        ) {

            if (
                lock.expiresAt <=
                now
            ) {

                this.memoryLocks.delete(
                    key
                );

                this.stopHeartbeat(
                    key
                );

                removed++;

            }

        }


        return removed;

    }


    /**
     * =========================================================================
     * Cleanup
     * =========================================================================
     */

    cleanup() {

        return this.cleanupExpiredLocks();

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    getStatistics() {

        return {

            instanceId:
                this.instanceId,

            activeMemoryLocks:
                this.memoryLocks.size,

            activeHeartbeats:
                this.heartbeats.size,

            usingRedis:
                Boolean(
                    this.redis
                ),

            requireRedis:
                this.requireRedis,

            namespace:
                this.namespace,

            statistics:
                {
                    ...this.statistics
                }

        };

    }


    stats() {

        return this.getStatistics();

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        let redisStatus =
            this.redis
                ? 'CONFIGURED'
                : 'NOT_CONFIGURED';


        if (
            this.redis &&
            typeof this.redis.ping ===
                'function'
        ) {

            try {

                await this.redis.ping();

                redisStatus =
                    'UP';

            }
            catch (error) {

                redisStatus =
                    'DOWN';

            }

        }


        const status =
            this.requireRedis
                ? redisStatus ===
                    'UP'

                    ? 'UP'
                    : 'DOWN'

                : (
                    redisStatus ===
                        'DOWN' &&
                    !this.allowMemoryFallback
                )

                    ? 'DOWN'

                    : 'UP';


        return {

            status,

            component:
                'transaction-lock-manager',

            instanceId:
                this.instanceId,

            redis:
                redisStatus,

            memoryFallback:
                this.allowMemoryFallback,

            activeMemoryLocks:
                this.memoryLocks.size,

            activeHeartbeats:
                this.heartbeats.size,

            statistics:
                this.getStatistics()

        };

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        for (
            const state
            of this.heartbeats.values()
        ) {

            if (
                state?.timer
            ) {

                clearInterval(
                    state.timer
                );

            }

        }


        this.heartbeats.clear();


        this.memoryLocks.clear();


        this.localReferences.clear();


        return true;

    }


    /**
     * =========================================================================
     * Key Construction
     * =========================================================================
     */

    buildKey(
        tenantId,
        resource
    ) {

        const normalizedTenant =
            this.normalizeTenant(
                tenantId
            );

        const normalizedResource =
            this.normalizeResource(
                resource
            );


        return [

            this.namespace,

            this.hashOrEncode(
                normalizedTenant
            ),

            this.hashOrEncode(
                normalizedResource
            )

        ].join(':');

    }


    /**
     * =========================================================================
     * Safe Key Encoding
     * =========================================================================
     */

    hashOrEncode(
        value
    ) {

        const normalized =
            String(
                value
            );


        /**
         * Keep normal operational identifiers readable while preventing
         * whitespace and special Redis key characters from creating ambiguity.
         */
        if (
            /^[a-zA-Z0-9._-]+$/.test(
                normalized
            ) &&
            normalized.length <=
                256
        ) {

            return normalized;

        }


        return crypto
            .createHash(
                'sha256'
            )
            .update(
                normalized,
                'utf8'
            )
            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Input Normalization
     * =========================================================================
     */

    normalizeTenant(
        tenantId
    ) {

        const normalized =
            String(
                tenantId
            )
                .trim();


        if (
            !normalized
        ) {

            return 'global';

        }


        return normalized.slice(
            0,
            256
        );

    }


    normalizeResource(
        resource
    ) {

        if (
            resource ===
                undefined ||
            resource ===
                null
        ) {

            throw new TypeError(
                'Lock resource is required'
            );

        }


        const normalized =
            String(
                resource
            )
                .trim();


        if (
            !normalized
        ) {

            throw new TypeError(
                'Lock resource is required'
            );

        }


        return normalized.slice(
            0,
            this.maxResourceLength
        );

    }


    normalizeOwner(
        owner
    ) {

        const normalized =
            String(
                owner
            )
                .trim();


        if (
            !normalized
        ) {

            throw new TypeError(
                'Lock owner is required'
            );

        }


        return normalized.slice(
            0,
            this.maxOwnerLength
        );

    }


    normalizeNamespace(
        namespace
    ) {

        return String(
            namespace
        )
            .trim()
            .replace(
                /\s+/g,
                ':'
            )
            .replace(
                /:+/g,
                ':'
            )
            .replace(
                /^:|:$/g,
                ''
            ) ||
            DEFAULT_NAMESPACE;

    }


    normalizePositiveInteger(
        value,
        fallback
    ) {

        const number =
            Number(
                value
            );


        if (
            !Number.isFinite(number) ||
            number <= 0
        ) {

            return fallback;

        }


        return Math.floor(
            number
        );

    }


    buildDefaultOwner() {

        return [

            this.instanceId,

            process.pid,

            crypto.randomUUID()

        ].join(':');

    }


    /**
     * =========================================================================
     * Parse Redis Value
     * =========================================================================
     */

    parseRedisValue(
        raw
    ) {

        if (
            raw &&
            typeof raw ===
                'object'
        ) {

            return raw;

        }


        return JSON.parse(
            String(
                raw
            )
        );

    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async publishAuditSafely(
        event
    ) {

        try {

            await this.auditPublisher?.publish?.(
                event
            );

        }
        catch (error) {

            this.logger.warn?.({

                message:
                    'Transaction lock audit publication failed',

                error:
                    safeError(
                        error
                    )

            });

            this.metrics?.increment?.(
                'transaction_lock_audit_failure_total'
            );

        }

    }


    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        name,
        attributes = {}
    ) {

        try {

            return this.tracer?.startSpan?.(

                name,

                {

                    attributes

                }

            );

        }
        catch (_) {

            return null;

        }

    }


    setSpanSuccess(
        span
    ) {

        try {

            span?.setStatus?.({

                code:
                    1

            });

        }
        catch (_) {
            // Tracing must never affect lock safety.
        }

    }


    setSpanError(
        span,
        error
    ) {

        try {

            span?.recordException?.(
                error
            );

            span?.setStatus?.({

                code:
                    2,

                message:
                    error?.message

            });

        }
        catch (_) {
            // Tracing must never affect lock safety.
        }

    }


    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        ms
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );

    }

}


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

TransactionLockManager.States =
    LOCK_STATES;


TransactionLockManager.RedisScripts = {

    acquire:
        REDIS_ACQUIRE_SCRIPT,

    release:
        REDIS_RELEASE_SCRIPT,

    renew:
        REDIS_RENEW_SCRIPT,

    forceRelease:
        REDIS_FORCE_RELEASE_SCRIPT

};


module.exports =
    TransactionLockManager;


module.exports.TransactionLockManager =
    TransactionLockManager;


module.exports.LOCK_STATES =
    LOCK_STATES;