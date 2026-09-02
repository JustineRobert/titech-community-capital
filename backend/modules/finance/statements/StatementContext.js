/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementContext.js
 * ============================================================================
 *
 * Enterprise Statement Processing Runtime Context
 *
 * Immutable execution context passed through the complete statement lifecycle.
 *
 * Pipeline:
 *
 * Context
 *    ↓
 * Import Statement
 *    ↓
 * Validate
 *    ↓
 * Persist
 *    ↓
 * Reconcile
 *    ↓
 * Variance Detection
 *    ↓
 * Repair
 *    ↓
 * Reporting
 *
 * Design Principles:
 *
 * - Immutable
 * - Multi-tenant aware
 * - Audit friendly
 * - Distributed-processing ready
 * - Serialization safe
 * - Deterministic
 * - Traceable
 * - Backward compatible
 *
 * ============================================================================
 */

'use strict';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const CONTEXT_VERSION = '1.0.0';

const DEFAULT_SOURCE = 'UNKNOWN';

const DEFAULT_ENVIRONMENT =
    process.env.NODE_ENV || 'development';

const DEFAULT_SERVICE =
    'statement-processing';

const MAX_METADATA_DEPTH = 10;

/**
 * ============================================================================
 * Validation Error
 * ============================================================================
 */

class StatementContextValidationError extends Error {

    constructor(message, details = {}) {

        super(message);

        this.name =
            'StatementContextValidationError';

        this.code =
            'STATEMENT_CONTEXT_VALIDATION_ERROR';

        this.details =
            Object.freeze({
                ...details
            });

        if (Error.captureStackTrace) {

            Error.captureStackTrace(
                this,
                this.constructor
            );

        }

    }

}

/**
 * ============================================================================
 * Utility: Deep Freeze
 * ============================================================================
 *
 * Recursively freezes plain objects and arrays.
 *
 * Date, RegExp, Buffer, Map, Set and other special objects are not recursively
 * traversed because their internal representation is not a plain object graph.
 */

function deepFreeze(
    object,
    depth = 0
) {

    if (
        object === null ||
        typeof object !== 'object'
    ) {

        return object;

    }

    if (
        Object.isFrozen(object) ||
        depth > MAX_METADATA_DEPTH
    ) {

        return object;

    }

    if (
        object instanceof Date ||
        object instanceof RegExp ||
        object instanceof Map ||
        object instanceof Set ||
        (typeof Buffer !== 'undefined' &&
            Buffer.isBuffer(object))
    ) {

        return Object.freeze(object);

    }

    Object.getOwnPropertyNames(object)
        .forEach(property => {

            const value =
                object[property];

            if (
                value &&
                typeof value === 'object' &&
                !Object.isFrozen(value)
            ) {

                deepFreeze(
                    value,
                    depth + 1
                );

            }

        });

    return Object.freeze(object);

}

/**
 * ============================================================================
 * Utility: Clone Metadata
 * ============================================================================
 *
 * Produces a detached metadata structure so callers cannot mutate the
 * original context through shared references.
 */

function cloneValue(
    value,
    depth = 0
) {

    if (
        value === null ||
        value === undefined
    ) {

        return value;

    }

    if (depth > MAX_METADATA_DEPTH) {

        throw new StatementContextValidationError(
            'Statement context metadata exceeds maximum nesting depth',
            {
                maxDepth:
                    MAX_METADATA_DEPTH
            }
        );

    }

    if (value instanceof Date) {

        return new Date(
            value.getTime()
        );

    }

    if (Array.isArray(value)) {

        return value.map(
            item =>
                cloneValue(
                    item,
                    depth + 1
                )
        );

    }

    if (
        typeof value === 'object'
    ) {

        const cloned = {};

        Object.keys(value)
            .forEach(key => {

                cloned[key] =
                    cloneValue(
                        value[key],
                        depth + 1
                    );

            });

        return cloned;

    }

    return value;

}

/**
 * ============================================================================
 * StatementContext
 * ============================================================================
 */

class StatementContext {

    constructor({

        tenantId,

        userId,

        source = DEFAULT_SOURCE,

        correlationId,

        requestId,

        batchId = null,

        executionId = null,

        traceId = null,

        actor = null,

        environment =
            DEFAULT_ENVIRONMENT,

        service =
            DEFAULT_SERVICE,

        metadata = {},

        createdAt = new Date()

    } = {}) {

        this.validateRequired({

            tenantId,

            userId,

            correlationId,

            requestId

        });

        /**
         * Validate metadata.
         */
        this.validateMetadata(
            metadata
        );

        /**
         * Validate identifiers.
         */
        const normalizedTenantId =
            this.normalizeIdentifier(
                tenantId,
                'tenantId'
            );

        const normalizedUserId =
            this.normalizeIdentifier(
                userId,
                'userId'
            );

        const normalizedCorrelationId =
            this.normalizeIdentifier(
                correlationId,
                'correlationId'
            );

        const normalizedRequestId =
            this.normalizeIdentifier(
                requestId,
                'requestId'
            );

        const normalizedBatchId =
            this.normalizeOptionalIdentifier(
                batchId,
                'batchId'
            );

        const normalizedExecutionId =
            this.normalizeOptionalIdentifier(
                executionId,
                'executionId'
            );

        const normalizedTraceId =
            this.normalizeOptionalIdentifier(
                traceId,
                'traceId'
            );

        /**
         * Validate timestamp.
         */
        const normalizedCreatedAt =
            this.normalizeDate(
                createdAt,
                'createdAt'
            );

        /**
         * Normalize source.
         */
        const normalizedSource =
            this.normalizeValue(
                source,
                DEFAULT_SOURCE
            );

        /**
         * Normalize environment.
         */
        const normalizedEnvironment =
            this.normalizeValue(
                environment,
                DEFAULT_ENVIRONMENT
            );

        /**
         * Normalize service.
         */
        const normalizedService =
            this.normalizeValue(
                service,
                DEFAULT_SERVICE
            );

        /**
         * Context version.
         */
        this.version =
            CONTEXT_VERSION;

        /**
         * Multi-tenant boundary.
         */
        this.tenantId =
            normalizedTenantId;

        /**
         * Initiating user/system.
         */
        this.userId =
            normalizedUserId;

        /**
         * Statement origin.
         */
        this.source =
            normalizedSource;

        /**
         * Distributed tracing.
         */
        this.correlationId =
            normalizedCorrelationId;

        this.requestId =
            normalizedRequestId;

        this.executionId =
            normalizedExecutionId;

        this.traceId =
            normalizedTraceId;

        /**
         * Execution actor.
         *
         * Examples:
         *
         * USER
         * SYSTEM
         * JOB
         * API
         */
        this.actor =
            actor === null ||
            actor === undefined
                ? null
                : this.normalizeValue(
                    actor,
                    null
                );

        /**
         * Runtime information.
         */
        this.environment =
            normalizedEnvironment;

        this.service =
            normalizedService;

        /**
         * Processing batch.
         */
        this.batchId =
            normalizedBatchId;

        /**
         * Audit timestamp.
         */
        this.createdAt =
            normalizedCreatedAt;

        /**
         * Extension metadata.
         */
        this.metadata =
            deepFreeze(
                cloneValue(metadata)
            );

        /**
         * Make runtime context immutable.
         */
        Object.freeze(this);

    }

    /**
     * =========================================================================
     * Create Context With Batch
     * =========================================================================
     *
     * Returns a new immutable context.
     */

    withBatch(batchId) {

        const normalizedBatchId =
            this.normalizeIdentifier(
                batchId,
                'batchId'
            );

        return new StatementContext({

            ...this.toJSON(),

            batchId:
                normalizedBatchId

        });

    }

    /**
     * =========================================================================
     * Add Metadata
     * =========================================================================
     *
     * Returns a new context without mutating the current context.
     */

    withMetadata(metadata = {}) {

        this.validateMetadata(
            metadata
        );

        return new StatementContext({

            ...this.toJSON(),

            metadata: {

                ...cloneValue(
                    this.metadata
                ),

                ...cloneValue(
                    metadata
                )

            }

        });

    }

    /**
     * =========================================================================
     * Attach Distributed Trace
     * =========================================================================
     */

    withTrace({

        executionId =
            this.executionId,

        traceId =
            this.traceId

    } = {}) {

        return new StatementContext({

            ...this.toJSON(),

            executionId,

            traceId

        });

    }

    /**
     * =========================================================================
     * Attach Execution ID
     * =========================================================================
     */

    withExecution(executionId) {

        return this.withTrace({

            executionId,

            traceId:
                this.traceId

        });

    }

    /**
     * =========================================================================
     * Clone Context
     * =========================================================================
     */

    clone() {

        return new StatementContext(
            this.toJSON()
        );

    }

    /**
     * =========================================================================
     * Compare Context Identity
     * =========================================================================
     *
     * Identity is tenant-scoped.
     *
     * Primary identity:
     *
     * tenantId + correlationId + requestId
     *
     * If executionId exists, it is also compared.
     */

    equals(context) {

        if (
            !(context instanceof StatementContext)
        ) {

            return false;

        }

        return (

            this.tenantId ===
                context.tenantId &&

            this.correlationId ===
                context.correlationId &&

            this.requestId ===
                context.requestId &&

            this.executionId ===
                context.executionId

        );

    }

    /**
     * =========================================================================
     * Batch Context Check
     * =========================================================================
     */

    isBatchContext() {

        return Boolean(
            this.batchId
        );

    }

    /**
     * =========================================================================
     * Distributed Context Check
     * =========================================================================
     */

    isDistributedContext() {

        return Boolean(

            this.executionId ||

            this.traceId ||

            this.correlationId

        );

    }

    /**
     * =========================================================================
     * Tenant Identity Check
     * =========================================================================
     */

    belongsToTenant(tenantId) {

        if (
            tenantId === undefined ||
            tenantId === null
        ) {

            return false;

        }

        return (
            this.tenantId ===
            String(tenantId).trim()
        );

    }

    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     *
     * Safe for:
     *
     * - Audit logs
     * - Events
     * - Queues
     * - Persistence
     * - Distributed workers
     *
     * Returns a detached representation.
     */

    toJSON() {

        return {

            version:
                this.version,

            tenantId:
                this.tenantId,

            userId:
                this.userId,

            source:
                this.source,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            executionId:
                this.executionId,

            traceId:
                this.traceId,

            actor:
                this.actor,

            environment:
                this.environment,

            service:
                this.service,

            batchId:
                this.batchId,

            createdAt:
                new Date(
                    this.createdAt.getTime()
                ),

            metadata:
                cloneValue(
                    this.metadata
                )

        };

    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateRequired(fields) {

        const missing =
            Object.entries(fields)

                .filter(
                    ([, value]) =>

                        value ===
                            undefined ||

                        value ===
                            null ||

                        (
                            typeof value ===
                                'string' &&

                            value.trim() === ''
                        )
                )

                .map(
                    ([key]) =>
                        key
                );

        if (missing.length) {

            throw new StatementContextValidationError(

                'Invalid statement processing context',

                {
                    missingFields:
                        Object.freeze(
                            missing
                        )
                }

            );

        }

    }

    /**
     * =========================================================================
     * Identifier Normalization
     * =========================================================================
     */

    normalizeIdentifier(
        value,
        fieldName
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            throw new StatementContextValidationError(

                `Statement context ${fieldName} is required`,

                {
                    field:
                        fieldName
                }

            );

        }

        const normalized =
            String(value).trim();

        if (!normalized) {

            throw new StatementContextValidationError(

                `Statement context ${fieldName} cannot be empty`,

                {
                    field:
                        fieldName
                }

            );

        }

        return normalized;

    }

    /**
     * =========================================================================
     * Optional Identifier Normalization
     * =========================================================================
     */

    normalizeOptionalIdentifier(
        value,
        fieldName
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            return null;

        }

        const normalized =
            String(value).trim();

        if (!normalized) {

            return null;

        }

        return normalized;

    }

    /**
     * =========================================================================
     * Generic Value Normalization
     * =========================================================================
     */

    normalizeValue(
        value,
        fallback
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            return fallback;

        }

        const normalized =
            String(value).trim();

        return normalized ||
            fallback;

    }

    /**
     * =========================================================================
     * Date Normalization
     * =========================================================================
     */

    normalizeDate(
        value,
        fieldName
    ) {

        const date =
            value instanceof Date

                ? new Date(
                    value.getTime()
                )

                : new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            throw new StatementContextValidationError(

                `Invalid statement context ${fieldName}`,

                {
                    field:
                        fieldName,

                    value:
                        String(value)
                }

            );

        }

        return date;

    }

    /**
     * =========================================================================
     * Metadata Validation
     * =========================================================================
     */

    validateMetadata(metadata) {

        if (
            metadata === null ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata)
        ) {

            throw new StatementContextValidationError(

                'Statement context metadata must be a plain object',

                {
                    field:
                        'metadata'
                }

            );

        }

        /**
         * Force traversal now so invalid/deep metadata fails during context
         * creation rather than later during queue serialization.
         */
        cloneValue(metadata);

    }

    /**
     * =========================================================================
     * Factory
     * =========================================================================
     */

    static create(options = {}) {

        return new StatementContext(
            options
        );

    }

    /**
     * =========================================================================
     * Restore From Serialized Payload
     * =========================================================================
     */

    static fromJSON(payload) {

        if (
            !payload ||
            typeof payload !== 'object'
        ) {

            throw new StatementContextValidationError(

                'Invalid serialized statement context',

                {
                    payloadType:
                        typeof payload
                }

            );

        }

        return new StatementContext({

            ...payload,

            createdAt:
                payload.createdAt
                    ? new Date(
                        payload.createdAt
                    )
                    : undefined

        });

    }

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    StatementContext;

module.exports.StatementContextValidationError =
    StatementContextValidationError;

module.exports.CONTEXT_VERSION =
    CONTEXT_VERSION;

module.exports.DEFAULT_SOURCE =
    DEFAULT_SOURCE;