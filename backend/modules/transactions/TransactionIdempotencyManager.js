'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Idempotency Manager
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionIdempotencyManager.js
 *
 * Purpose
 * -------
 * Enterprise idempotency coordination for financial transaction execution.
 *
 * Responsibilities
 * ----------------
 * • Tenant-scoped idempotency keys
 * • Atomic first-writer reservation
 * • Request fingerprint validation
 * • Duplicate request detection
 * • In-flight request detection
 * • Response replay
 * • Failure persistence
 * • Lease/claim support
 * • TTL expiration
 * • Distributed store support
 * • Memory fallback
 * • Audit integration
 * • Metrics
 * • Tracing
 * • Safe diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Financial posting
 * • Ledger accounting
 * • Payment provider communication
 * • Business validation
 *
 * Important
 * ---------
 * Idempotency is not authorization and is not a substitute for the ledger's
 * own financial uniqueness constraints.
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


/**
 * ============================================================================
 * Optional Domain Errors
 * ============================================================================
 */

let TransactionError = null;
let IdempotencyConflictError = null;

try {

    // eslint-disable-next-line global-require
    const errors =
        require('./TransactionErrors');

    TransactionError =
        errors.TransactionError;

    IdempotencyConflictError =
        errors.IdempotencyConflictError;

}
catch (_) {
    // Keep the module usable during partial startup/tests.
}


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const STATUS = Object.freeze({

    PROCESSING:
        'PROCESSING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    EXPIRED:
        'EXPIRED'

});


const DEFAULTS = Object.freeze({

    ttlSeconds:
        86400,

    processingTtlSeconds:
        300,

    namespace:
        'transaction:idempotency',

    maxKeyLength:
        512,

    fingerprintAlgorithm:
        'sha256',

    maxMetadataDepth:
        8,

    responseMaxBytes:
        1024 * 1024,

    errorRetention:
        true

});


const SENSITIVE_FIELDS = new Set([

    'password',

    'secret',

    'clientSecret',

    'client_secret',

    'accessToken',

    'access_token',

    'refreshToken',

    'refresh_token',

    'authorization',

    'Authorization',

    'apiKey',

    'api_key',

    'privateKey',

    'private_key',

    'token',

    'credential',

    'credentials'

]);


/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function deepClone(
    value,
    depth = 0,
    maxDepth = 8
) {

    if (
        depth > maxDepth
    ) {

        return '[MAX_DEPTH]';

    }

    if (
        value === null ||
        value === undefined
    ) {

        return value;

    }

    if (
        value instanceof Date
    ) {

        return new Date(
            value.getTime()
        );

    }

    if (
        typeof value !== 'object'
    ) {

        return value;

    }

    if (
        Array.isArray(value)
    ) {

        return value.map(
            item =>
                deepClone(
                    item,
                    depth + 1,
                    maxDepth
                )
        );

    }

    const output = {};

    for (
        const [
            key,
            nestedValue
        ]
        of Object.entries(value)
    ) {

        if (
            SENSITIVE_FIELDS.has(key)
        ) {

            output[key] =
                '[REDACTED]';

            continue;

        }

        output[key] =
            deepClone(
                nestedValue,
                depth + 1,
                maxDepth
            );

    }

    return output;

}


/**
 * Deterministic canonicalization.
 *
 * Object key order is normalized so equivalent requests generate the same
 * fingerprint.
 */
function canonicalize(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return value;

    }

    if (
        value instanceof Date
    ) {

        return value.toISOString();

    }

    if (
        typeof value !== 'object'
    ) {

        return value;

    }

    if (
        Array.isArray(value)
    ) {

        return value.map(
            canonicalize
        );

    }

    return Object.keys(value)
        .sort()
        .reduce(

            (
                output,
                key
            ) => {

                output[key] =
                    canonicalize(
                        value[key]
                    );

                return output;

            },

            {}

        );

}


function safeError(
    error
) {

    if (!error) {

        return null;

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
                ),

        category:
            error.category ||
            null,

        retryable:
            error.retryable === true,

        statusCode:
            error.statusCode ||
            null

    };

}


function createError(
    code,
    message,
    options = {}
) {

    if (
        IdempotencyConflictError &&
        (
            code ===
                'TX_IDEMPOTENCY_CONFLICT' ||
            code ===
                'IDEMPOTENCY_CONFLICT'
        )
    ) {

        return new IdempotencyConflictError(

            message,

            options

        );

    }


    if (
        TransactionError
    ) {

        return new TransactionError(

            message,

            {

                ...options,

                code

            }

        );

    }


    const error =
        new Error(
            message
        );

    error.code =
        code;

    Object.assign(
        error,
        options
    );

    return error;

}


/**
 * ============================================================================
 * Manager
 * ============================================================================
 */

class TransactionIdempotencyManager {

    constructor(
        options = {}
    ) {

        this.store =
            options.store ||
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

        this.clock =
            options.clock ||
            Date;

        this.config = {

            ...DEFAULTS,

            ...options

        };

        this.memoryStore =
            new Map();

        this.statistics = {

            reserves:
                0,

            reserved:
                0,

            duplicates:
                0,

            conflicts:
                0,

            replays:
                0,

            completed:
                0,

            failed:
                0,

            expired:
                0,

            released:
                0,

            atomicReservations:
                0,

            atomicReservationMisses:
                0,

            memoryFallbacks:
                0

        };

    }


    /**
     * =========================================================================
     * Generate Deterministic Idempotency Key
     * =========================================================================
     *
     * This is a convenience generator, not a replacement for an explicit
     * client-provided idempotency key.
     */

    generateKey(
        transaction = {}
    ) {

        const payload = {

            tenantId:
                transaction.tenantId ||
                null,

            accountId:
                transaction.accountId ||
                null,

            customerId:
                transaction.customerId ||
                null,

            type:
                transaction.type ||
                null,

            amount:
                transaction.amount ??
                null,

            currency:
                transaction.currency ||
                null,

            reference:
                transaction.reference ||
                null,

            operation:
                transaction.operation ||
                null

        };

        return this.hash(
            payload
        );

    }


    /**
     * =========================================================================
     * Request Fingerprint
     * =========================================================================
     */

    fingerprint(
        request
    ) {

        const canonical =
            canonicalize(
                deepClone(
                    request || {},
                    0,
                    this.config.maxMetadataDepth
                )
            );

        return crypto

            .createHash(
                this.config.fingerprintAlgorithm
            )

            .update(
                JSON.stringify(
                    canonical
                ),
                'utf8'
            )

            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Reserve
     * =========================================================================
     *
     * First writer wins.
     *
     * Critical:
     *
     * Backing stores should implement atomic set-if-absent semantics.
     */

    async reserve(
        options = {}
    ) {

        const {

            key,

            transactionId = null,

            tenantId,

            request = {},

            correlationId = null,

            requestId = null,

            operation = null,

            metadata = {}

        } = options;


        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        this.statistics.reserves++;


        const fingerprint =
            this.fingerprint(
                request
            );


        const namespaceKey =
            this.namespaceKey({

                tenantId,

                key

            });


        const now =
            this.now();


        const record = {

            key,

            tenantId,

            transactionId,

            correlationId,

            requestId,

            operation,

            fingerprint,

            status:
                STATUS.PROCESSING,

            metadata:
                deepClone(
                    metadata,
                    0,
                    this.config.maxMetadataDepth
                ),

            createdAt:
                now,

            updatedAt:
                now,

            expiresAt:
                new Date(

                    now.getTime() +

                    Number(
                        this.config.ttlSeconds
                    ) *
                    1000

                ),

            processingExpiresAt:
                new Date(

                    now.getTime() +

                    Number(
                        this.config.processingTtlSeconds
                    ) *
                    1000

                )

        };


        /**
         * ---------------------------------------------------------------------
         * Atomic reservation
         * ---------------------------------------------------------------------
         */

        const atomicResult =
            await this.atomicReserve(

                namespaceKey,

                record

            );


        if (
            atomicResult
        ) {

            this.statistics.reserved++;
            this.statistics.atomicReservations++;


            await this.publishAuditSafely({

                type:
                    'IDEMPOTENCY_RESERVED',

                tenantId,

                transactionId,

                correlationId,

                requestId,

                keyFingerprint:
                    this.hashKey(
                        key
                    )

            });


            this.metrics?.increment?.(
                'transaction_idempotency_reserved_total'
            );


            return {

                reserved:
                    true,

                duplicate:
                    false,

                conflict:
                    false,

                record:
                    atomicResult

            };

        }


        this.statistics.atomicReservationMisses++;


        /**
         * ---------------------------------------------------------------------
         * Existing record
         * ---------------------------------------------------------------------
         */

        const existing =
            await this.getByNamespaceKey(
                namespaceKey
            );


        if (
            !existing
        ) {

            /**
             * The atomic store might not support conditional writes.
             *
             * Fall back to a process-local atomic lock to preserve correctness
             * as much as possible.
             */
            const fallback =
                await this.reserveWithProcessLock({

                    namespaceKey,

                    record

                });


            if (
                fallback
            ) {

                this.statistics.reserved++;


                this.metrics?.increment?.(
                    'transaction_idempotency_reserved_total'
                );


                return {

                    reserved:
                        true,

                    duplicate:
                        false,

                    conflict:
                        false,

                    record:
                        fallback

                };

            }


            const raced =
                await this.getByNamespaceKey(
                    namespaceKey
                );


            if (
                !raced
            ) {

                throw createError(

                    'IDEMPOTENCY_RESERVATION_FAILED',

                    'Unable to reserve idempotency key'

                );

            }


            return this.handleExistingRecord({

                existing:
                    raced,

                fingerprint,

                tenantId,

                transactionId,

                correlationId

            };

        }


        return this.handleExistingRecord({

            existing,

            fingerprint,

            tenantId,

            transactionId,

            correlationId

        });

    }


    /**
     * =========================================================================
     * Existing Record Handling
     * =========================================================================
     */

    handleExistingRecord({
        existing,
        fingerprint,
        tenantId,
        transactionId,
        correlationId
    }) {

        /**
         * Same key + different request = hard conflict.
         *
         * Never return another customer's/result's response.
         */

        if (
            existing.fingerprint !==
            fingerprint
        ) {

            this.statistics.conflicts++;


            this.metrics?.increment?.(
                'transaction_idempotency_conflict_total'
            );


            return {

                reserved:
                    false,

                duplicate:
                    false,

                conflict:
                    true,

                record:
                    existing,

                error:
                    createError(

                        'TX_IDEMPOTENCY_CONFLICT',

                        'Idempotency key was already used with a different request',

                        {

                            statusCode:
                                409,

                            retryable:
                                false,

                            tenantId,

                            transactionId,

                            correlationId,

                            metadata: {

                                keyFingerprint:
                                    this.hashKey(
                                        existing.key
                                    )

                            }

                        }

                    )

            };

        }


        /**
         * Expired records should be treated as available for a new operation.
         */
        if (
            this.isExpired(
                existing
            )
        ) {

            this.statistics.expired++;


            return {

                reserved:
                    false,

                duplicate:
                    false,

                expired:
                    true,

                conflict:
                    false,

                record:
                    existing

            };

        }


        this.statistics.duplicates++;


        this.metrics?.increment?.(
            'transaction_idempotency_duplicate_total'
        );


        return {

            reserved:
                false,

            duplicate:
                true,

            conflict:
                false,

            inProgress:
                existing.status ===
                    STATUS.PROCESSING,

            record:
                existing

        };

    }


    /**
     * =========================================================================
     * Atomic Store Reservation
     * =========================================================================
     */

    async atomicReserve(
        namespaceKey,
        record
    ) {

        /**
         * Preferred abstraction.
         */
        if (
            typeof this.store?.setIfAbsent ===
            'function'
        ) {

            const result =
                await this.store.setIfAbsent(

                    namespaceKey,

                    record,

                    this.config.ttlSeconds

                );


            return result
                ? record
                : null;

        }


        /**
         * Common Redis-style wrapper.
         */
        if (
            typeof this.store?.setNx ===
            'function'
        ) {

            const result =
                await this.store.setNx(

                    namespaceKey,

                    record,

                    this.config.ttlSeconds

                );


            return result
                ? record
                : null;

        }


        /**
         * Redis SET NX compatibility abstraction.
         */
        if (
            typeof this.store?.set ===
            'function' &&
            this.store.supportsSetNx ===
                true
        ) {

            const result =
                await this.store.set(

                    namespaceKey,

                    record,

                    this.config.ttlSeconds,

                    {
                        NX:
                            true
                    }

                );


            const acquired =
                result === true ||
                result === 'OK';


            return acquired
                ? record
                : null;

        }


        return null;

    }


    /**
     * =========================================================================
     * Process-local reservation fallback
     * =========================================================================
     */

    async reserveWithProcessLock({
        namespaceKey,
        record
    }) {

        /**
         * JavaScript execution is single-threaded within this process.
         * This section ensures two concurrent promises in the same process
         * do not both reserve the fallback map.
         */

        const existing =
            this.memoryStore.get(
                namespaceKey
            );


        if (
            existing &&
            !this.isExpired(
                existing
            )
        ) {

            return null;

        }


        this.statistics.memoryFallbacks++;


        this.memoryStore.set(

            namespaceKey,

            record

        );


        return record;

    }


    /**
     * =========================================================================
     * Check Existing Key
     * =========================================================================
     */

    async check(
        options = {}
    ) {

        const {

            key,

            tenantId

        } = options;


        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const record =
            await this.get({

                key,

                tenantId

            });


        if (
            !record
        ) {

            return {

                exists:
                    false,

                expired:
                    false

            };

        }


        if (
            this.isExpired(
                record
            )
        ) {

            this.statistics.expired++;


            return {

                exists:
                    false,

                expired:
                    true,

                record

            };

        }


        this.statistics.duplicates++;


        return {

            exists:
                true,

            expired:
                false,

            record

        };

    }


    /**
     * =========================================================================
     * Get
     * =========================================================================
     */

    async get({
        key,
        tenantId
    } = {}) {

        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const namespaceKey =
            this.namespaceKey({

                tenantId,

                key

            });


        const record =
            await this.getByNamespaceKey(
                namespaceKey
            );


        if (
            record &&
            this.isExpired(
                record
            )
        ) {

            await this.remove({

                key,

                tenantId

            });


            return null;

        }


        return record;

    }


    /**
     * =========================================================================
     * Complete
     * =========================================================================
     */

    async complete(
        options = {},
        maybeResponse
    ) {

        const {

            key,
            tenantId,
            response,
            metadata = {}
        } =
            typeof options === 'string'

                ? {

                    key:
                        options,

                    tenantId:
                        arguments[2]?.tenantId,

                    response:
                        maybeResponse

                }

                : options;


        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const record =
            await this.get({

                key,

                tenantId

            });


        if (
            !record
        ) {

            return false;

        }


        const now =
            this.now();


        const safeResponse =
            this.prepareResponse(
                response
            );


        const updated = {

            ...record,

            status:
                STATUS.COMPLETED,

            response:
                safeResponse,

            completedAt:
                now,

            updatedAt:
                now,

            metadata: {

                ...(record.metadata || {}),

                ...deepClone(
                    metadata
                )

            }

        };


        await this.saveRecord({

            namespaceKey:
                this.namespaceKey({
                    tenantId,
                    key
                }),

            record:
                updated,

            ttlSeconds:
                this.config.ttlSeconds

        });


        this.statistics.completed++;


        this.metrics?.increment?.(
            'transaction_idempotency_completed_total'
        );


        return true;

    }


    /**
     * =========================================================================
     * Fail
     * =========================================================================
     */

    async fail(
        options = {},
        maybeError
    ) {

        const {

            key,
            tenantId,
            error

        } =
            typeof options === 'string'

                ? {

                    key:
                        options,

                    tenantId:
                        arguments[2]?.tenantId,

                    error:
                        maybeError

                }

                : options;


        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const record =
            await this.get({

                key,

                tenantId

            });


        if (
            !record
        ) {

            return false;

        }


        const now =
            this.now();


        const updated = {

            ...record,

            status:
                STATUS.FAILED,

            error:
                this.config.errorRetention
                    ? safeError(
                        error
                    )
                    : null,

            failedAt:
                now,

            updatedAt:
                now

        };


        await this.saveRecord({

            namespaceKey:
                this.namespaceKey({
                    tenantId,
                    key
                }),

            record:
                updated,

            ttlSeconds:
                this.config.ttlSeconds

        });


        this.statistics.failed++;


        this.metrics?.increment?.(
            'transaction_idempotency_failed_total'
        );


        return true;

    }


    /**
     * =========================================================================
     * Replay
     * =========================================================================
     */

    async replay({
        key,
        tenantId
    } = {}) {

        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const record =
            await this.get({

                key,

                tenantId

            });


        if (
            !record
        ) {

            return null;

        }


        if (
            record.status !==
            STATUS.COMPLETED
        ) {

            return null;

        }


        this.statistics.replays++;


        this.metrics?.increment?.(
            'transaction_idempotency_replay_total'
        );


        return deepClone(
            record.response
        );

    }


    /**
     * =========================================================================
     * Get Full Result
     * =========================================================================
     */

    async getResult({
        key,
        tenantId
    } = {}) {

        const record =
            await this.get({

                key,

                tenantId

            });


        if (
            !record
        ) {

            return null;

        }


        return {

            status:
                record.status,

            processing:
                record.status ===
                    STATUS.PROCESSING,

            completed:
                record.status ===
                    STATUS.COMPLETED,

            failed:
                record.status ===
                    STATUS.FAILED,

            response:
                record.status ===
                    STATUS.COMPLETED
                        ? deepClone(
                            record.response
                        )
                        : null,

            error:
                record.error ||
                null,

            record

        };

    }


    /**
     * =========================================================================
     * Release Processing Reservation
     * =========================================================================
     *
     * Used when the operation has not actually started/committed and the caller
     * intentionally wants another request to retry using the same key.
     */

    async release({
        key,
        tenantId
    } = {}) {

        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const record =
            await this.get({

                key,

                tenantId

            });


        if (
            !record
        ) {

            return false;

        }


        if (
            record.status !==
            STATUS.PROCESSING
        ) {

            return false;

        }


        await this.remove({

            key,

            tenantId

        });


        this.statistics.released++;


        this.metrics?.increment?.(
            'transaction_idempotency_released_total'
        );


        return true;

    }


    /**
     * =========================================================================
     * Expire
     * =========================================================================
     */

    async expire({
        key,
        tenantId
    } = {}) {

        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const record =
            await this.get({

                key,

                tenantId

            });


        if (
            !record
        ) {

            return false;

        }


        const updated = {

            ...record,

            status:
                STATUS.EXPIRED,

            expiredAt:
                this.now(),

            updatedAt:
                this.now()

        };


        await this.saveRecord({

            namespaceKey:
                this.namespaceKey({
                    tenantId,
                    key
                }),

            record:
                updated,

            ttlSeconds:
                60

        });


        this.statistics.expired++;


        return true;

    }


    /**
     * =========================================================================
     * Execute Protected Operation
     * =========================================================================
     */

    async execute(
        options = {}
    ) {

        const {

            key,

            tenantId,

            transactionId = null,

            request = {},

            operation,

            correlationId = null,

            requestId = null,

            operationName = null,

            metadata = {},

            replayCompleted =
                true,

            waitForProcessing =
                false,

            processingWaitMs =
                5000

        } = options;


        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        if (
            typeof operation !==
            'function'
        ) {

            throw new TypeError(
                'operation must be a function'
            );

        }


        const reservation =
            await this.reserve({

                key,

                tenantId,

                transactionId,

                request,

                correlationId,

                requestId,

                operation:
                    operationName,

                metadata

            });


        if (
            reservation.conflict
        ) {

            throw reservation.error;

        }


        if (
            reservation.duplicate
        ) {

            /**
             * ---------------------------------------------------------------
             * Completed duplicate
             * ---------------------------------------------------------------
             */

            if (
                reservation.record.status ===
                STATUS.COMPLETED
            ) {

                return {

                    duplicate:
                        true,

                    replayed:
                        replayCompleted,

                    response:
                        replayCompleted
                            ? await this.replay({

                                key,

                                tenantId

                            })
                            : null,

                    record:
                        reservation.record

                };

            }


            /**
             * ---------------------------------------------------------------
             * Existing request still processing
             * ---------------------------------------------------------------
             */

            if (
                reservation.record.status ===
                STATUS.PROCESSING
            ) {

                if (
                    !waitForProcessing
                ) {

                    return {

                        duplicate:
                            true,

                        inProgress:
                            true,

                        replayed:
                            false,

                        response:
                            null,

                        record:
                            reservation.record

                    };

                }


                const completed =
                    await this.waitForCompletion({

                        key,

                        tenantId,

                        timeoutMs:
                            processingWaitMs

                    });


                if (
                    completed?.status ===
                    STATUS.COMPLETED
                ) {

                    return {

                        duplicate:
                            true,

                        inProgress:
                            false,

                        replayed:
                            true,

                        response:
                            deepClone(
                                completed.response
                            ),

                        record:
                            completed

                    };

                }


                return {

                    duplicate:
                        true,

                    inProgress:
                        true,

                    replayed:
                        false,

                    response:
                        null,

                    record:
                        completed ||
                        reservation.record

                };

            }


            if (
                reservation.record.status ===
                STATUS.FAILED
            ) {

                return {

                    duplicate:
                        true,

                    failed:
                        true,

                    replayed:
                        false,

                    response:
                        null,

                    error:
                        reservation.record.error ||
                        null,

                    record:
                        reservation.record

                };

            }

        }


        /**
         * ---------------------------------------------------------------------
         * Execute first owner
         * ---------------------------------------------------------------------
         */

        try {

            const response =
                await operation();


            await this.complete({

                key,

                tenantId,

                response

            });


            return {

                duplicate:
                    false,

                replayed:
                    false,

                response

            };

        }
        catch (error) {

            try {

                await this.fail({

                    key,

                    tenantId,

                    error

                });

            }
            catch (persistError) {

                this.logger.error?.({

                    message:
                        'Failed to persist transaction idempotency failure',

                    tenantId,

                    error:
                        safeError(
                            persistError
                        )

                });

            }


            throw error;

        }

    }


    /**
     * =========================================================================
     * Wait For Completion
     * =========================================================================
     */

    async waitForCompletion({

        key,

        tenantId,

        timeoutMs =
            5000,

        pollMs =
            100

    } = {}) {

        const started =
            Date.now();


        while (
            Date.now() -
                started <
            timeoutMs
        ) {

            const record =
                await this.get({

                    key,

                    tenantId

                });


            if (
                !record
            ) {

                return null;

            }


            if (
                record.status !==
                STATUS.PROCESSING
            ) {

                return record;

            }


            await this.sleep(
                pollMs
            );

        }


        return this.get({

            key,

            tenantId

        });

    }


    /**
     * =========================================================================
     * Save
     * =========================================================================
     */

    async saveRecord({

        namespaceKey,

        record,

        ttlSeconds

    }) {

        if (
            typeof this.store?.set ===
            'function'
        ) {

            await this.store.set(

                namespaceKey,

                record,

                ttlSeconds ??
                this.config.ttlSeconds

            );

            return record;

        }


        this.memoryStore.set(

            namespaceKey,

            record

        );


        return record;

    }


    /**
     * =========================================================================
     * Compatibility Save
     * =========================================================================
     */

    async save(
        key,
        value,
        options = {}
    ) {

        const tenantId =
            options.tenantId ||
            value?.tenantId;


        if (
            !tenantId
        ) {

            /**
             * Preserve compatibility with legacy direct save(key,value).
             *
             * Such calls should not be used by tenant-sensitive production
             * workflows.
             */
            if (
                this.store?.set
            ) {

                return this.store.set(

                    this.namespaceKey({
                        tenantId:
                            'global',
                        key
                    }),

                    value,

                    this.config.ttlSeconds

                );

            }


            this.memoryStore.set(

                this.namespaceKey({
                    tenantId:
                        'global',
                    key
                }),

                value

            );


            return value;

        }


        return this.saveRecord({

            namespaceKey:
                this.namespaceKey({

                    tenantId,

                    key

                }),

            record:
                value,

            ttlSeconds:
                options.ttlSeconds ||
                this.config.ttlSeconds

        });

    }


    /**
     * =========================================================================
     * Internal Read
     * =========================================================================
     */

    async getByNamespaceKey(
        namespaceKey
    ) {

        if (
            typeof this.store?.get ===
            'function'
        ) {

            const value =
                await this.store.get(
                    namespaceKey
                );


            if (
                value
            ) {

                return value;

            }

        }


        const local =
            this.memoryStore.get(
                namespaceKey
            );


        if (
            local
        ) {

            this.statistics.memoryFallbacks++;

        }


        return local ||
            null;

    }


    /**
     * =========================================================================
     * Remove
     * =========================================================================
     */

    async remove({
        key,
        tenantId
    } = {}) {

        this.validateKey(
            key
        );


        this.validateTenant(
            tenantId
        );


        const namespaceKey =
            this.namespaceKey({

                tenantId,

                key

            });


        let removed =
            false;


        if (
            typeof this.store?.delete ===
            'function'
        ) {

            removed =
                Boolean(

                    await this.store.delete(
                        namespaceKey
                    )

                );

        }


        removed =
            this.memoryStore.delete(
                namespaceKey
            ) ||
            removed;


        return removed;

    }


    /**
     * =========================================================================
     * Key Namespace
     * =========================================================================
     */

    namespaceKey({
        tenantId,
        key
    }) {

        return [

            this.config.namespace,

            String(
                tenantId
            )
                .trim(),

            this.hashKey(
                key
            )

        ].join(':');

    }


    /**
     * =========================================================================
     * Key Fingerprint
     * =========================================================================
     *
     * Never place raw idempotency keys directly into infrastructure keys when
     * they may contain sensitive or unusual values.
     */

    hashKey(
        key
    ) {

        return crypto
            .createHash(
                this.config.fingerprintAlgorithm
            )
            .update(
                String(
                    key
                ),
                'utf8'
            )
            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Response Protection
     * =========================================================================
     */

    prepareResponse(
        response
    ) {

        const cloned =
            deepClone(
                response,
                0,
                this.config.maxMetadataDepth
            );


        try {

            const serialized =
                JSON.stringify(
                    cloned
                );


            if (
                Buffer.byteLength(
                    serialized,
                    'utf8'
                ) >
                Number(
                    this.config.responseMaxBytes
                )
            ) {

                throw new Error(
                    'Idempotency response exceeds configured maximum size'
                );

            }

        }
        catch (error) {

            throw createError(

                'IDEMPOTENCY_RESPONSE_INVALID',

                error.message,

                {

                    retryable:
                        false,

                    statusCode:
                        500

                }

            );

        }


        return cloned;

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
            !record
        ) {

            return true;

        }


        if (
            record.expiresAt
        ) {

            const expires =
                new Date(
                    record.expiresAt
                );


            if (
                Number.isFinite(
                    expires.getTime()
                ) &&
                this.now() >=
                    expires
            ) {

                return true;

            }

        }


        return false;

    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateKey(
        key
    ) {

        if (
            key ===
                null ||
            key ===
                undefined ||
            String(key).trim() ===
                ''
        ) {

            throw createError(

                'TX_IDEMPOTENCY_KEY_REQUIRED',

                'Idempotency key required',

                {

                    statusCode:
                        400,

                    retryable:
                        false

                }

            );

        }


        if (
            String(key).length >
            Number(
                this.config.maxKeyLength
            )
        ) {

            throw createError(

                'TX_IDEMPOTENCY_KEY_TOO_LONG',

                'Idempotency key exceeds maximum length',

                {

                    statusCode:
                        400,

                    retryable:
                        false

                }

            );

        }


        return true;

    }


    validateTenant(
        tenantId
    ) {

        if (
            tenantId ===
                null ||
            tenantId ===
                undefined ||
            String(tenantId).trim() ===
                ''
        ) {

            throw createError(

                'TX_TENANT_REQUIRED',

                'tenantId is required for idempotency operations',

                {

                    statusCode:
                        400,

                    retryable:
                        false

                }

            );

        }


        return true;

    }


    /**
     * =========================================================================
     * Fingerprint Helper
     * =========================================================================
     */

    hash(
        payload
    ) {

        return crypto
            .createHash(
                this.config.fingerprintAlgorithm
            )
            .update(
                JSON.stringify(
                    canonicalize(
                        deepClone(
                            payload
                        )
                    )
                ),
                'utf8'
            )
            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Cleanup Expired Memory Records
     * =========================================================================
     */

    cleanupMemory() {

        const now =
            this.now();


        let removed =
            0;


        for (
            const [
                key,
                record
            ]
            of this.memoryStore.entries()
        ) {

            if (
                record?.expiresAt &&
                new Date(
                    record.expiresAt
                ) <=
                now
            ) {

                this.memoryStore.delete(
                    key
                );


                removed++;

            }

        }


        return removed;

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    getStatistics() {

        return {

            ...this.statistics,

            memoryRecords:
                this.memoryStore.size,

            namespace:
                this.config.namespace,

            ttlSeconds:
                this.config.ttlSeconds,

            processingTtlSeconds:
                this.config.processingTtlSeconds

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

        let storeStatus =
            this.store
                ? 'CONFIGURED'
                : 'MEMORY_ONLY';


        try {

            if (
                typeof this.store?.health ===
                'function'
            ) {

                const result =
                    await this.store.health();


                storeStatus =
                    result?.status ||
                    storeStatus;

            }

        }
        catch (error) {

            storeStatus =
                'DOWN';

        }


        return {

            status:
                storeStatus ===
                    'DOWN'
                    ? 'DEGRADED'
                    : 'UP',

            component:
                'transaction-idempotency-manager',

            store:
                storeStatus,

            statistics:
                this.getStatistics()

        };

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
                    'Transaction idempotency audit publication failed',

                error:
                    safeError(
                        error
                    )

            });

            this.metrics?.increment?.(
                'transaction_idempotency_audit_failure_total'
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


    /**
     * =========================================================================
     * Clear
     * =========================================================================
     */

    async clear({
        key,
        tenantId
    } = {}) {

        return this.remove({

            key,

            tenantId

        });

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        this.memoryStore.clear();

        return true;

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


TransactionIdempotencyManager.Status =
    STATUS;


module.exports =
    TransactionIdempotencyManager;


module.exports.TransactionIdempotencyManager =
    TransactionIdempotencyManager;


module.exports.STATUS =
    STATUS;