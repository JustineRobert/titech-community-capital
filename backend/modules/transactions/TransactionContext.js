'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Context
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionContext.js
 *
 * Purpose
 * -------
 * Maintains execution context for distributed financial transactions.
 *
 * Responsibilities
 * ----------------
 * • Transaction identity
 * • Parent/child transaction relationships
 * • Correlation propagation
 * • Request propagation
 * • Tenant isolation
 * • Organization/user context
 * • Idempotency propagation
 * • Audit context
 * • Tracing context
 * • Operation context
 * • Metadata propagation
 * • Event correlation
 * • Lifecycle state management
 * • Retry/operation statistics
 * • Safe serialization
 * • Context cloning
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Financial posting
 * • Ledger accounting
 * • Payment-provider communication
 * • Compliance decisions
 * • Persistence
 * • Distributed locking
 *
 * Security
 * --------
 * Context objects must never contain raw:
 *
 * • passwords
 * • client secrets
 * • access tokens
 * • refresh tokens
 * • authorization headers
 * • private keys
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


/**
 * ============================================================================
 * Optional Domain Constants
 * ============================================================================
 *
 * The context remains usable if the constants module is unavailable during
 * partial application startup/tests.
 * ============================================================================
 */

let DomainConstants = null;

try {

    // eslint-disable-next-line global-require
    DomainConstants =
        require('./TransactionConstants');

}
catch (_) {

    DomainConstants =
        null;

}


/**
 * ============================================================================
 * State Constants
 * ============================================================================
 */

const TransactionStates = Object.freeze(

    DomainConstants?.TransactionStates ||
    {

        CREATED:
            'CREATED',

        VALIDATING:
            'VALIDATING',

        VALIDATED:
            'VALIDATED',

        PENDING:
            'PENDING',

        PROCESSING:
            'PROCESSING',

        AUTHORIZING:
            'AUTHORIZING',

        COMPLETED:
            'COMPLETED',

        FAILED:
            'FAILED',

        CANCELLED:
            'CANCELLED',

        TIMEOUT:
            'TIMEOUT',

        ROLLBACK_PENDING:
            'ROLLBACK_PENDING',

        ROLLING_BACK:
            'ROLLING_BACK',

        ROLLED_BACK:
            'ROLLED_BACK',

        COMPENSATING:
            'COMPENSATING',

        COMPENSATED:
            'COMPENSATED',

        RECOVERING:
            'RECOVERING'

    }

);


/**
 * ============================================================================
 * Default Values
 * ============================================================================
 */

const DEFAULT_SERVICE =
    'transactions';

const DEFAULT_OPERATION =
    'unknown';

const DEFAULT_SOURCE =
    'INTERNAL';

const DEFAULT_PRIORITY =
    'NORMAL';


/**
 * ============================================================================
 * Sensitive Fields
 * ============================================================================
 */

const SENSITIVE_FIELDS = new Set([

    'password',

    'passwd',

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

function normalizeString(
    value,
    fallback = null,
    maxLength = 512
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }


    const normalized =
        String(value)
            .trim();


    if (
        !normalized
    ) {

        return fallback;

    }


    return normalized.slice(
        0,
        maxLength
    );

}


function normalizePriority(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {

        return DEFAULT_PRIORITY;

    }


    if (
        typeof value === 'number'
    ) {

        const numericValues =
            Object.values(
                DomainConstants?.TransactionPriority ||
                {}
            );


        if (
            numericValues.includes(
                value
            )
        ) {

            return value;

        }

    }


    const normalized =
        String(value)
            .trim()
            .toUpperCase();


    return [

        'LOW',
        'NORMAL',
        'HIGH',
        'CRITICAL'

    ].includes(
        normalized
    )
        ? normalized
        : DEFAULT_PRIORITY;

}


/**
 * Deep clone simple context values safely.
 */
function cloneValue(
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

        return new Date(
            value.getTime()
        );

    }


    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            cloneValue
        );

    }


    if (
        typeof value === 'object'
    ) {

        const result = {};


        for (
            const [
                key,
                nestedValue
            ]
            of Object.entries(
                value
            )
        ) {

            result[key] =
                cloneValue(
                    nestedValue
                );

        }


        return result;

    }


    return value;

}


/**
 * Redact sensitive object fields.
 */
function redactValue(
    value,
    depth = 0,
    maxDepth = 8
) {

    if (
        depth >
        maxDepth
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
        typeof value === 'string'
    ) {

        return value.slice(
            0,
            5000
        );

    }


    if (
        typeof value !== 'object'
    ) {

        return value;

    }


    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            item =>
                redactValue(
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
        of Object.entries(
            value
        )
    ) {

        if (
            SENSITIVE_FIELDS.has(
                key
            )
        ) {

            output[key] =
                '[REDACTED]';

        }
        else {

            output[key] =
                redactValue(
                    nestedValue,
                    depth + 1,
                    maxDepth
                );

        }

    }


    return output;

}


function generateId() {

    return crypto.randomUUID();

}


/**
 * ============================================================================
 * Transaction Context
 * ============================================================================
 */

class TransactionContext {

    constructor(
        options = {}
    ) {

        /**
         * ---------------------------------------------------------------------
         * Core Identity
         * ---------------------------------------------------------------------
         */

        this.transactionId =
            normalizeString(
                options.transactionId,
                generateId(),
                128
            );


        this.parentTransactionId =
            normalizeString(
                options.parentTransactionId,
                null,
                128
            );


        this.correlationId =
            normalizeString(
                options.correlationId,
                this.transactionId,
                256
            );


        this.requestId =
            normalizeString(
                options.requestId,
                null,
                256
            );


        this.idempotencyKey =
            normalizeString(
                options.idempotencyKey,
                null,
                512
            );


        /**
         * ---------------------------------------------------------------------
         * Tenant / Actor Context
         * ---------------------------------------------------------------------
         */

        this.tenantId =
            normalizeString(
                options.tenantId,
                null,
                256
            );


        this.organizationId =
            normalizeString(
                options.organizationId,
                null,
                256
            );


        this.userId =
            normalizeString(
                options.userId,
                null,
                256
            );


        this.sessionId =
            normalizeString(
                options.sessionId,
                null,
                256
            );


        this.customerId =
            normalizeString(
                options.customerId,
                null,
                256
            );


        /**
         * ---------------------------------------------------------------------
         * Execution Context
         * ---------------------------------------------------------------------
         */

        this.service =
            normalizeString(
                options.service,
                DEFAULT_SERVICE,
                128
            );


        this.operation =
            normalizeString(
                options.operation,
                DEFAULT_OPERATION,
                256
            );


        this.source =
            normalizeString(
                options.source,
                DEFAULT_SOURCE,
                128
            )
                .toUpperCase();


        this.priority =
            normalizePriority(
                options.priority
            );


        /**
         * ---------------------------------------------------------------------
         * Lifecycle
         * ---------------------------------------------------------------------
         */

        this.state =
            options.state ||
            TransactionStates.CREATED;


        this.createdAt =
            options.createdAt
                ? new Date(
                    options.createdAt
                )
                : new Date();


        this.startedAt =
            options.startedAt
                ? new Date(
                    options.startedAt
                )
                : null;


        this.completedAt =
            options.completedAt
                ? new Date(
                    options.completedAt
                )
                : null;


        this.lastHeartbeatAt =
            options.lastHeartbeatAt
                ? new Date(
                    options.lastHeartbeatAt
                )
                : null;


        /**
         * ---------------------------------------------------------------------
         * Context Collections
         * ---------------------------------------------------------------------
         */

        this.tags =
            new Map();


        this.attributes =
            new Map();


        this.metadata =
            new Map();


        this.restoreMaps(
            options
        );


        /**
         * ---------------------------------------------------------------------
         * Audit Context
         * ---------------------------------------------------------------------
         */

        this.audit = {

            ipAddress:
                normalizeString(
                    options.ipAddress,
                    null,
                    128
                ),

            userAgent:
                normalizeString(
                    options.userAgent,
                    null,
                    1024
                ),

            deviceId:
                normalizeString(
                    options.deviceId,
                    null,
                    256
                ),

            initiatedBy:
                normalizeString(
                    options.initiatedBy ||
                    options.userId,
                    'system',
                    256
                )

        };


        /**
         * ---------------------------------------------------------------------
         * Trace Context
         * ---------------------------------------------------------------------
         */

        this.trace = {

            traceId:
                normalizeString(
                    options.traceId,
                    null,
                    256
                ),

            spanId:
                normalizeString(
                    options.spanId,
                    null,
                    256
                ),

            parentSpanId:
                normalizeString(
                    options.parentSpanId,
                    null,
                    256
                ),

            traceFlags:
                options.traceFlags ??
                null,

            traceState:
                options.traceState ??
                null

        };


        /**
         * ---------------------------------------------------------------------
         * Statistics
         * ---------------------------------------------------------------------
         */

        this.statistics = {

            retries:
                Number(
                    options.statistics?.retries ||
                    0
                ),

            operations:
                Number(
                    options.statistics?.operations ||
                    0
                ),

            rollbackOperations:
                Number(
                    options.statistics?.rollbackOperations ||
                    0
                ),

            warnings:
                Number(
                    options.statistics?.warnings ||
                    0
                ),

            errors:
                Number(
                    options.statistics?.errors ||
                    0
                )

        };


        /**
         * ---------------------------------------------------------------------
         * Errors
         * ---------------------------------------------------------------------
         */

        this.lastError =
            options.lastError
                ? redactValue(
                    options.lastError
                )
                : null;


        /**
         * ---------------------------------------------------------------------
         * Runtime control
         * ---------------------------------------------------------------------
         */

        this.abortController =
            options.abortController ||
            null;

    }


    /**
     * =========================================================================
     * Restore Maps
     * =========================================================================
     *
     * Fixes the original clone/deserialize problem.
     */

    restoreMaps(
        options
    ) {

        const tags =
            options.tags instanceof Map
                ? options.tags
                : Object.entries(
                    options.tags || {}
                );


        for (
            const [
                key,
                value
            ]
            of tags
        ) {

            this.tags.set(
                key,
                redactValue(
                    value
                )
            );

        }


        const attributes =
            options.attributes instanceof Map
                ? options.attributes
                : Object.entries(
                    options.attributes || {}
                );


        for (
            const [
                key,
                value
            ]
            of attributes
        ) {

            this.attributes.set(
                key,
                redactValue(
                    value
                )
            );

        }


        const metadata =
            options.metadata instanceof Map
                ? options.metadata
                : Object.entries(
                    options.metadata || {}
                );


        for (
            const [
                key,
                value
            ]
            of metadata
        ) {

            this.metadata.set(
                key,
                redactValue(
                    value
                )
            );

        }


        return this;

    }


    /**
     * =========================================================================
     * Lifecycle
     * =========================================================================
     */

    start() {

        this.assertCanTransition(
            this.state,
            TransactionStates.PROCESSING
        );


        this.startedAt =
            new Date();


        this.lastHeartbeatAt =
            new Date();


        this.state =
            TransactionStates.PROCESSING;


        return this;

    }


    beginValidation() {

        this.transition(
            TransactionStates.VALIDATING
        );


        return this;

    }


    markValidated() {

        this.transition(
            TransactionStates.VALIDATED
        );


        return this;

    }


    beginAuthorization() {

        this.transition(
            TransactionStates.AUTHORIZING
        );


        return this;

    }


    markPending() {

        this.transition(
            TransactionStates.PENDING
        );


        return this;

    }


    markCompleted() {

        this.transition(
            TransactionStates.COMPLETED
        );


        this.completedAt =
            new Date();


        this.lastHeartbeatAt =
            new Date();


        return this;

    }


    rollback() {

        /**
         * A rollback may be entered from a failed/timeout state through the
         * explicit rollback lifecycle.
         */
        if (
            this.state ===
            TransactionStates.FAILED ||
            this.state ===
            TransactionStates.TIMEOUT
        ) {

            this.transition(
                TransactionStates.ROLLBACK_PENDING
            );

        }


        if (
            this.state ===
            TransactionStates.ROLLBACK_PENDING
        ) {

            this.transition(
                TransactionStates.ROLLING_BACK
            );

        }


        if (
            this.state ===
            TransactionStates.ROLLING_BACK
        ) {

            this.transition(
                TransactionStates.ROLLED_BACK
            );

        }


        if (
            this.state ===
            TransactionStates.COMPENSATING
        ) {

            this.transition(
                TransactionStates.COMPENSATED
            );

        }


        this.completedAt =
            new Date();


        return this;

    }


    beginCompensation() {

        this.transition(
            TransactionStates.COMPENSATING
        );


        return this;

    }


    markCompensated() {

        if (
            this.state ===
            TransactionStates.ROLLING_BACK
        ) {

            this.transition(
                TransactionStates.COMPENSATING
            );

        }


        if (
            this.state ===
            TransactionStates.COMPENSATING
        ) {

            this.transition(
                TransactionStates.COMPENSATED
            );

        }


        this.completedAt =
            new Date();


        return this;

    }


    beginRecovery() {

        this.transition(
            TransactionStates.RECOVERING
        );


        this.lastHeartbeatAt =
            new Date();


        return this;

    }


    timeout() {

        this.transition(
            TransactionStates.TIMEOUT
        );


        this.completedAt =
            new Date();


        return this;

    }


    fail(
        error
    ) {

        /**
         * Failure can originate from a processing/authorization/recovery flow.
         */
        if (
            this.state !==
            TransactionStates.FAILED
        ) {

            this.assertCanTransition(
                this.state,
                TransactionStates.FAILED
            );

        }


        this.state =
            TransactionStates.FAILED;


        this.completedAt =
            new Date();


        this.lastError =
            this.normalizeError(
                error
            );


        this.statistics.errors++;


        return this;

    }


    cancel() {

        this.transition(
            TransactionStates.CANCELLED
        );


        this.completedAt =
            new Date();


        return this;

    }


    /**
     * =========================================================================
     * Generic Transition
     * =========================================================================
     */

    transition(
        nextState
    ) {

        this.assertCanTransition(
            this.state,
            nextState
        );


        this.state =
            nextState;


        if (
            nextState ===
            TransactionStates.PROCESSING
        ) {

            this.startedAt =
                this.startedAt ||
                new Date();

        }


        if (
            this.isTerminalState(
                nextState
            )
        ) {

            this.completedAt =
                this.completedAt ||
                new Date();

        }


        this.lastHeartbeatAt =
            new Date();


        return this;

    }


    /**
     * =========================================================================
     * Transition Validation
     * =========================================================================
     */

    assertCanTransition(
        from,
        to
    ) {

        if (
            from ===
            to
        ) {

            return true;

        }


        const helper =
            DomainConstants?.canTransition;


        if (
            typeof helper ===
            'function'
        ) {

            if (
                helper(
                    from,
                    to
                )
            ) {

                return true;

            }

        }
        else {

            /**
             * Lightweight fallback if TransactionConstants is unavailable.
             */
            if (
                from ===
                TransactionStates.CREATED &&
                [

                    TransactionStates.VALIDATING,

                    TransactionStates.CANCELLED,

                    TransactionStates.FAILED

                ].includes(
                    to
                )
            ) {

                return true;

            }

            if (
                from ===
                TransactionStates.VALIDATING &&
                [

                    TransactionStates.VALIDATED,

                    TransactionStates.FAILED

                ].includes(
                    to
                )
            ) {

                return true;

            }

            if (
                from ===
                TransactionStates.VALIDATED &&
                [

                    TransactionStates.PENDING,

                    TransactionStates.FAILED,

                    TransactionStates.CANCELLED

                ].includes(
                    to
                )
            ) {

                return true;

            }

            if (
                from ===
                    TransactionStates.PENDING ||
                from ===
                    TransactionStates.PROCESSING ||
                from ===
                    TransactionStates.AUTHORIZING ||
                from ===
                    TransactionStates.RECOVERING
            ) {

                if (
                    [

                        TransactionStates.PROCESSING,

                        TransactionStates.AUTHORIZING,

                        TransactionStates.COMPLETED,

                        TransactionStates.FAILED,

                        TransactionStates.TIMEOUT,

                        TransactionStates.ROLLBACK_PENDING

                    ].includes(
                        to
                    )
                ) {

                    return true;

                }

            }

        }


        const error =
            new Error(

                `Invalid transaction state transition: ${from} -> ${to}`

            );


        error.code =
            'TRANSACTION_INVALID_TRANSITION';


        error.from =
            from;


        error.to =
            to;


        throw error;

    }


    /**
     * =========================================================================
     * Metadata
     * =========================================================================
     */

    set(
        key,
        value
    ) {

        this.validateKey(
            key
        );


        this.metadata.set(

            key,

            redactValue(
                value
            )

        );


        return this;

    }


    get(
        key
    ) {

        return cloneValue(
            this.metadata.get(
                key
            )
        );

    }


    has(
        key
    ) {

        return this.metadata.has(
            key
        );

    }


    delete(
        key
    ) {

        this.metadata.delete(
            key
        );


        return this;

    }


    /**
     * =========================================================================
     * Tags
     * =========================================================================
     */

    addTag(
        name,
        value = true
    ) {

        this.validateKey(
            name
        );


        this.tags.set(

            name,

            redactValue(
                value
            )

        );


        return this;

    }


    getTag(
        name
    ) {

        return cloneValue(
            this.tags.get(
                name
            )
        );

    }


    hasTag(
        name
    ) {

        return this.tags.has(
            name
        );

    }


    removeTag(
        name
    ) {

        this.tags.delete(
            name
        );


        return this;

    }


    /**
     * =========================================================================
     * Attributes
     * =========================================================================
     */

    setAttribute(
        name,
        value
    ) {

        this.validateKey(
            name
        );


        this.attributes.set(

            name,

            redactValue(
                value
            )

        );


        return this;

    }


    getAttribute(
        name
    ) {

        return cloneValue(
            this.attributes.get(
                name
            )
        );

    }


    hasAttribute(
        name
    ) {

        return this.attributes.has(
            name
        );

    }


    deleteAttribute(
        name
    ) {

        this.attributes.delete(
            name
        );


        return this;

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    incrementOperations(
        count = 1
    ) {

        this.statistics.operations +=
            Math.max(
                0,
                Number(count) || 0
            );


        return this;

    }


    incrementRollbackOperations(
        count = 1
    ) {

        this.statistics.rollbackOperations +=
            Math.max(
                0,
                Number(count) || 0
            );


        return this;

    }


    incrementRetries(
        count = 1
    ) {

        this.statistics.retries +=
            Math.max(
                0,
                Number(count) || 0
            );


        return this;

    }


    incrementWarnings(
        count = 1
    ) {

        this.statistics.warnings +=
            Math.max(
                0,
                Number(count) || 0
            );


        return this;

    }


    incrementErrors(
        count = 1
    ) {

        this.statistics.errors +=
            Math.max(
                0,
                Number(count) || 0
            );


        return this;

    }


    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     */

    heartbeat() {

        this.lastHeartbeatAt =
            new Date();


        return this;

    }


    /**
     * =========================================================================
     * Duration
     * =========================================================================
     */

    getDuration() {

        if (
            !this.startedAt
        ) {

            return 0;

        }


        const end =
            this.completedAt ||
            new Date();


        return Math.max(

            0,

            end.getTime() -
            this.startedAt.getTime()

        );

    }


    /**
     * =========================================================================
     * Terminal State
     * =========================================================================
     */

    isTerminalState(
        state =
            this.state
    ) {

        const helper =
            DomainConstants?.isTerminalState;


        if (
            typeof helper ===
            'function'
        ) {

            return helper(
                state
            );

        }


        return [

            TransactionStates.COMPLETED,

            TransactionStates.CANCELLED,

            TransactionStates.ROLLED_BACK,

            TransactionStates.COMPENSATED

        ].includes(
            state
        );

    }


    /**
     * =========================================================================
     * Recoverable State
     * =========================================================================
     */

    isRecoverable() {

        const helper =
            DomainConstants?.isRecoverableState;


        if (
            typeof helper ===
            'function'
        ) {

            return helper(
                this.state
            );

        }


        return [

            TransactionStates.FAILED,

            TransactionStates.TIMEOUT,

            TransactionStates.RECOVERING,

            TransactionStates.ROLLBACK_PENDING,

            TransactionStates.ROLLING_BACK,

            TransactionStates.COMPENSATING

        ].includes(
            this.state
        );

    }


    /**
     * =========================================================================
     * Abort Signal
     * =========================================================================
     */

    attachAbortController(
        controller
    ) {

        this.abortController =
            controller ||
            null;


        return this;

    }


    getAbortSignal() {

        return this.abortController?.signal ||
            null;

    }


    abort(
        reason = 'Transaction aborted'
    ) {

        try {

            this.abortController?.abort?.(
                reason
            );

        }
        catch (_) {
            // Abort signaling must never break transaction cleanup.
        }


        return this;

    }


    /**
     * =========================================================================
     * Child Context
     * =========================================================================
     *
     * Useful for distributed operations:
     *
     * Parent transaction
     *       │
     *       ├── Ledger context
     *       ├── Airtel context
     *       └── Settlement context
     *
     * The parent transaction identity is retained.
     */

    createChild(
        options = {}
    ) {

        const child =
            new TransactionContext({

                ...this.toJSON(),

                ...options,

                parentTransactionId:
                    options.parentTransactionId ||
                    this.transactionId,

                transactionId:
                    options.transactionId ||
                    generateId(),

                correlationId:
                    options.correlationId ||
                    this.correlationId,

                requestId:
                    options.requestId ||
                    this.requestId,

                tenantId:
                    this.tenantId,

                organizationId:
                    this.organizationId,

                userId:
                    this.userId,

                sessionId:
                    this.sessionId,

                idempotencyKey:
                    options.idempotencyKey ||
                    this.idempotencyKey,

                traceId:
                    options.traceId ||
                    this.trace.traceId,

                parentSpanId:
                    options.parentSpanId ||
                    this.trace.spanId

            });


        return child;

    }


    /**
     * =========================================================================
     * Operation Context
     * =========================================================================
     */

    createOperationContext(
        operation,
        options = {}
    ) {

        const operationId =
            options.operationId ||
            generateId();


        const context = {

            transactionId:
                this.transactionId,

            parentTransactionId:
                this.parentTransactionId,

            operationId,

            operation:
                operation ||
                this.operation,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            userId:
                this.userId,

            customerId:
                this.customerId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            idempotencyKey:
                options.idempotencyKey ||
                this.idempotencyKey,

            service:
                options.service ||
                this.service,

            source:
                options.source ||
                this.source,

            priority:
                options.priority ||
                this.priority,

            trace: {

                traceId:
                    options.traceId ||
                    this.trace.traceId,

                spanId:
                    options.spanId ||
                    this.trace.spanId,

                parentSpanId:
                    options.parentSpanId ||
                    this.trace.parentSpanId,

                traceFlags:
                    options.traceFlags ??
                    this.trace.traceFlags,

                traceState:
                    options.traceState ??
                    this.trace.traceState

            },

            audit: {

                initiatedBy:
                    this.audit.initiatedBy,

                ipAddress:
                    this.audit.ipAddress,

                userAgent:
                    this.audit.userAgent,

                deviceId:
                    this.audit.deviceId

            }

        };


        return Object.freeze(
            context
        );

    }


    /**
     * =========================================================================
     * Logging
     * =========================================================================
     */

    toLogObject() {

        return {

            transactionId:
                this.transactionId,

            parentTransactionId:
                this.parentTransactionId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            userId:
                this.userId,

            customerId:
                this.customerId,

            operation:
                this.operation,

            service:
                this.service,

            source:
                this.source,

            priority:
                this.priority,

            state:
                this.state,

            durationMs:
                this.getDuration(),

            idempotencyKey:
                this.idempotencyKey,

            traceId:
                this.trace.traceId,

            spanId:
                this.trace.spanId

        };

    }


    /**
     * =========================================================================
     * Event Payload
     * =========================================================================
     */

    toEvent() {

        return {

            transactionId:
                this.transactionId,

            parentTransactionId:
                this.parentTransactionId,

            correlationId:
                this.correlationId,

            tenantId:
                this.tenantId,

            requestId:
                this.requestId,

            operation:
                this.operation,

            service:
                this.service,

            source:
                this.source,

            state:
                this.state,

            priority:
                this.priority,

            timestamp:
                new Date(),

            traceId:
                this.trace.traceId

        };

    }


    /**
     * =========================================================================
     * Safe Snapshot
     * =========================================================================
     */

    snapshot() {

        return this.toJSON();

    }


    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */

    toJSON() {

        return {

            transactionId:
                this.transactionId,

            parentTransactionId:
                this.parentTransactionId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            idempotencyKey:
                this.idempotencyKey,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            userId:
                this.userId,

            customerId:
                this.customerId,

            sessionId:
                this.sessionId,

            service:
                this.service,

            operation:
                this.operation,

            source:
                this.source,

            priority:
                this.priority,

            state:
                this.state,

            createdAt:
                new Date(
                    this.createdAt
                        .getTime()
                ),

            startedAt:
                this.startedAt
                    ? new Date(
                        this.startedAt.getTime()
                    )
                    : null,

            completedAt:
                this.completedAt
                    ? new Date(
                        this.completedAt.getTime()
                    )
                    : null,

            lastHeartbeatAt:
                this.lastHeartbeatAt
                    ? new Date(
                        this.lastHeartbeatAt.getTime()
                    )
                    : null,

            durationMs:
                this.getDuration(),

            tags:
                redactValue(
                    Object.fromEntries(
                        this.tags
                    )
                ),

            attributes:
                redactValue(
                    Object.fromEntries(
                        this.attributes
                    )
                ),

            metadata:
                redactValue(
                    Object.fromEntries(
                        this.metadata
                    )
                ),

            audit:
                redactValue(
                    this.audit
                ),

            trace:
                redactValue(
                    this.trace
                ),

            statistics:
                {
                    ...this.statistics
                },

            lastError:
                this.lastError
                    ? redactValue(
                        this.lastError
                    )
                    : null

        };

    }


    /**
     * =========================================================================
     * Clone
     * =========================================================================
     */

    clone(
        overrides = {}
    ) {

        const snapshot =
            this.toJSON();


        return new TransactionContext({

            ...snapshot,

            ...overrides,

            tags:
                overrides.tags ??
                snapshot.tags,

            attributes:
                overrides.attributes ??
                snapshot.attributes,

            metadata:
                overrides.metadata ??
                snapshot.metadata,

            audit:
                overrides.audit ??
                snapshot.audit,

            trace:
                overrides.trace ??
                snapshot.trace,

            statistics:
                overrides.statistics ??
                snapshot.statistics

        });

    }


    /**
     * =========================================================================
     * Context Integrity
     * =========================================================================
     */

    validate() {

        const errors = [];


        if (
            !this.transactionId
        ) {

            errors.push(
                'transactionId is required'
            );

        }


        if (
            !this.correlationId
        ) {

            errors.push(
                'correlationId is required'
            );

        }


        if (
            !this.tenantId
        ) {

            errors.push(
                'tenantId is required'
            );

        }


        if (
            !Object.values(
                TransactionStates
            )
                .includes(
                    this.state
                )
        ) {

            errors.push(
                `Invalid transaction state: ${this.state}`
            );

        }


        if (
            errors.length > 0
        ) {

            const error =
                new Error(
                    errors.join('; ')
                );


            error.code =
                'TRANSACTION_CONTEXT_INVALID';


            error.errors =
                errors;


            throw error;

        }


        return true;

    }


    /**
     * =========================================================================
     * Key Validation
     * =========================================================================
     */

    validateKey(
        key
    ) {

        const normalized =
            normalizeString(
                key,
                null,
                256
            );


        if (
            !normalized
        ) {

            throw new TypeError(
                'Context key is required'
            );

        }


        return normalized;

    }


    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error
    ) {

        if (
            !error
        ) {

            return {

                message:
                    'Unknown transaction error',

                name:
                    'Error',

                code:
                    null,

                timestamp:
                    new Date()

            };

        }


        return redactValue({

            message:
                error.message,

            name:
                error.name,

            code:
                error.code ||
                null,

            category:
                error.category ||
                null,

            retryable:
                error.retryable,

            timestamp:
                new Date()

        });

    }


    /**
     * =========================================================================
     * Factory
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new TransactionContext(
            options
        );

    }


    /**
     * =========================================================================
     * Rehydrate
     * =========================================================================
     *
     * Useful for recovery workers loading a persisted context.
     */

    static fromJSON(
        data = {}
    ) {

        return new TransactionContext({
            ...data
        });

    }

}


/**
 * ============================================================================
 * Public Constants
 * ============================================================================
 */

TransactionContext.States =
    TransactionStates;


/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    TransactionContext;