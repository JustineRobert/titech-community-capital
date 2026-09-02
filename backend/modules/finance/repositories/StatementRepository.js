'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Finance Core - Statement Repository
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/repositories/StatementRepository.js
 *
 * Purpose:
 *   Enterprise persistence boundary for durable, effectively immutable
 *   financial statements.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 *
 *   CREATE
 *   • Create immutable statement records
 *   • Enforce tenant ownership
 *   • Preserve operation/idempotency identity
 *   • Protect source/provider identity fields
 *
 *   READ
 *   • Tenant-scoped lookup
 *   • Operation-key lookup
 *   • Provider-reference lookup
 *   • Processing-work lookup
 *
 *   LIFECYCLE
 *   • Guarded state transitions
 *   • Atomic compare-and-set transitions
 *   • Import / normalize / validate / persist / batch / complete / fail
 *
 *   OPERATIONAL
 *   • Batch assignment
 *   • Retry/attempt counters
 *   • Controlled operational metadata
 *
 * Forbidden
 * ----------------------------------------------------------------------------
 *
 *   • Arbitrary update()
 *   • Arbitrary findOneAndUpdate()
 *   • Editing financial transaction amounts
 *   • Editing source transaction identity
 *   • Editing provider references
 *   • Editing tenant identity
 *   • Editing operation keys
 *   • Editing idempotency identity
 *   • Deleting financial statements through this repository
 *
 * Financial safety model
 * ----------------------------------------------------------------------------
 *
 *   Immutable statement content
 *           +
 *   explicit lifecycle mutation
 *           +
 *   tenant-scoped repository queries
 *           +
 *   compare-and-set state transitions
 *
 *   = controlled production persistence boundary
 *
 * IMPORTANT:
 *   StatementRepository does not post financial entries, modify balances,
 *   reverse ledger transactions, or reconcile ledger truth.
 *
 * ============================================================================
 */

const Statement =
    require('../models/Statement');

/* ============================================================================
 * Model constants
 * ========================================================================== */

const PROCESSING_STATUS =
    Statement.PROCESSING_STATUS ||
    Object.freeze({
        RECEIVED: 'RECEIVED',
        PROCESSING: 'PROCESSING',
        IMPORTED: 'IMPORTED',
        NORMALIZED: 'NORMALIZED',
        VALIDATED: 'VALIDATED',
        PERSISTED: 'PERSISTED',
        BATCHED: 'BATCHED',
        PARTIAL: 'PARTIAL',
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED',
        DUPLICATE: 'DUPLICATE'
    });

const ALLOWED_TRANSITIONS =
    Statement.ALLOWED_STATUS_TRANSITIONS ||
    Object.freeze({
        RECEIVED: new Set([
            'PROCESSING',
            'FAILED',
            'DUPLICATE'
        ]),

        PROCESSING: new Set([
            'IMPORTED',
            'FAILED',
            'PARTIAL'
        ]),

        IMPORTED: new Set([
            'NORMALIZED',
            'FAILED',
            'PARTIAL'
        ]),

        NORMALIZED: new Set([
            'VALIDATED',
            'FAILED',
            'PARTIAL'
        ]),

        VALIDATED: new Set([
            'PERSISTED',
            'FAILED',
            'PARTIAL'
        ]),

        PERSISTED: new Set([
            'BATCHED',
            'COMPLETED',
            'FAILED',
            'PARTIAL'
        ]),

        BATCHED: new Set([
            'COMPLETED',
            'FAILED',
            'PARTIAL'
        ]),

        PARTIAL: new Set([
            'PROCESSING',
            'IMPORTED',
            'NORMALIZED',
            'VALIDATED',
            'PERSISTED',
            'BATCHED',
            'COMPLETED',
            'FAILED'
        ]),

        FAILED: new Set([
            'PROCESSING'
        ]),

        COMPLETED: new Set(),

        DUPLICATE: new Set()
    });

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_WORK_LIMIT = 100;
const MAX_WORK_LIMIT = 1000;

const MAX_METADATA_KEYS = 100;
const MAX_METADATA_STRING_LENGTH = 2048;
const MAX_METADATA_ARRAY_ITEMS = 50;

const MAX_ERROR_MESSAGE_LENGTH = 2000;

/* ============================================================================
 * Errors
 * ========================================================================== */

class StatementRepositoryError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'StatementRepositoryError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            StatementRepositoryError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new StatementRepositoryError(
        'STATEMENT_VALIDATION_ERROR',
        message,
        metadata
    );
}

function notFoundError(
    message,
    metadata = {}
) {

    return new StatementRepositoryError(
        'STATEMENT_NOT_FOUND',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new StatementRepositoryError(
        'STATEMENT_CONFLICT',
        message,
        metadata
    );
}

/* ============================================================================
 * Utility functions
 * ========================================================================== */

function normalizeString(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized ||
        null;
}

function requireTenantId(
    tenantId
) {

    const normalized =
        normalizeString(
            tenantId
        );

    if (
        !normalized
    ) {

        throw validationError(
            'tenantId is required'
        );
    }

    return normalized;
}

function requireStatementId(
    statementId
) {

    const normalized =
        normalizeString(
            statementId
        );

    if (
        !normalized
    ) {

        throw validationError(
            'statementId is required'
        );
    }

    return normalized;
}

function requireOperationKey(
    operationKey
) {

    const normalized =
        normalizeString(
            operationKey
        );

    if (
        !normalized
    ) {

        throw validationError(
            'operationKey is required'
        );
    }

    return normalized;
}

function normalizeLimit(
    limit
) {

    const numeric =
        Number(limit);

    if (
        !Number.isInteger(
            numeric
        ) ||
        numeric <= 0
    ) {

        return DEFAULT_WORK_LIMIT;
    }

    return Math.min(
        numeric,
        MAX_WORK_LIMIT
    );
}

/* ============================================================================
 * Repository
 * ========================================================================== */

class StatementRepository {

    constructor(options = {}) {

        this.model =
            options.model ||
            Statement;

        this.clock =
            options.clock ||
            (() => new Date());

        this.logger =
            options.logger ||
            console;

        this.maxMetadataKeys =
            Number.isInteger(
                options.maxMetadataKeys
            ) &&
            options.maxMetadataKeys > 0
                ? options.maxMetadataKeys
                : MAX_METADATA_KEYS;

        this.maxMetadataStringLength =
            Number.isInteger(
                options.maxMetadataStringLength
            ) &&
            options.maxMetadataStringLength > 0
                ? options.maxMetadataStringLength
                : MAX_METADATA_STRING_LENGTH;

        this.allowCrossTenantFindById =
            options.allowCrossTenantFindById ===
            true;
    }

    /* ========================================================================
     * CREATE
     * ====================================================================== */

    async create(
        statement,
        context = {}
    ) {

        const payload =
            this.prepareCreatePayload(
                statement,
                context
            );

        try {

            return await this.model.create(
                payload
            );

        } catch (error) {

            if (
                this.isDuplicateKeyError(
                    error
                )
            ) {

                const existing =
                    await this.findByOperationKey(
                        payload.tenantId,
                        payload.operationKey
                    );

                const duplicate =
                    new StatementRepositoryError(
                        'STATEMENT_DUPLICATE',
                        'Statement operation key already exists',
                        {
                            tenantId:
                                payload.tenantId,

                            operationKey:
                                payload.operationKey,

                            existing
                        }
                    );

                duplicate.existing =
                    existing;

                throw duplicate;
            }

            throw error;
        }
    }

    /* ========================================================================
     * FIND ONE
     * ====================================================================== */

    async findOne(
        filter = {},
        options = {}
    ) {

        const scopedFilter =
            this.applyTenantScope(
                filter,
                options.tenantId
            );

        let query =
            this.model.findOne(
                scopedFilter
            );

        if (
            options.lean !== false &&
            typeof query.lean === 'function'
        ) {

            query =
                query.lean();
        }

        return query.exec();
    }

    /* ========================================================================
     * FIND BY ID
     * ====================================================================== */

    async findById(
        id,
        options = {}
    ) {

        const normalizedId =
            normalizeString(
                id
            );

        if (
            !normalizedId
        ) {

            throw validationError(
                'id is required'
            );
        }

        let query;

        /*
         * Prefer tenant-scoped lookup whenever tenantId is available.
         * This prevents cross-tenant access by identifier.
         */
        if (
            options.tenantId
        ) {

            query =
                this.model.findOne({
                    _id:
                        normalizedId,

                    tenantId:
                        requireTenantId(
                            options.tenantId
                        )
                });

        } else if (
            this.allowCrossTenantFindById
        ) {

            query =
                this.model.findById(
                    normalizedId
                );

        } else {

            /*
             * Production-safe default:
             * repository callers should provide tenant scope.
             */
            throw validationError(
                'tenantId is required for StatementRepository.findById()'
            );
        }

        if (
            options.lean !== false &&
            typeof query.lean === 'function'
        ) {

            query =
                query.lean();
        }

        return query.exec();
    }

    /* ========================================================================
     * FIND BY OPERATION KEY
     * ====================================================================== */

    async findByOperationKey(
        tenantId,
        operationKey
    ) {

        return this.model
            .findOne({
                tenantId:
                    requireTenantId(
                        tenantId
                    ),

                operationKey:
                    requireOperationKey(
                        operationKey
                    )
            })
            .lean()
            .exec();
    }

    /* ========================================================================
     * FIND BY STATEMENT ID
     * ====================================================================== */

    async findByStatementId(
        tenantId,
        statementId
    ) {

        return this.model
            .findOne({
                tenantId:
                    requireTenantId(
                        tenantId
                    ),

                statementId:
                    requireStatementId(
                        statementId
                    )
            })
            .lean()
            .exec();
    }

    /* ========================================================================
     * FIND BY PROVIDER REFERENCE
     * ====================================================================== */

    async findByProviderReference({
        tenantId,
        provider,
        providerReference,
        providerStatementId
    } = {}) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedProvider =
            normalizeString(
                provider
            );

        if (
            !normalizedProvider
        ) {

            throw validationError(
                'provider is required'
            );
        }

        if (
            !providerReference &&
            !providerStatementId
        ) {

            throw validationError(
                'providerReference or providerStatementId is required'
            );
        }

        const filter = {

            tenantId:
                normalizedTenantId,

            provider:
                normalizedProvider
        };

        if (
            providerReference
        ) {

            filter.providerReference =
                String(
                    providerReference
                ).trim();
        }

        if (
            providerStatementId
        ) {

            filter.providerStatementId =
                String(
                    providerStatementId
                ).trim();
        }

        return this.model
            .findOne(
                filter
            )
            .lean()
            .exec();
    }

    /* ========================================================================
     * FIND PROCESSING WORK
     * ====================================================================== */

    async findProcessing({
        tenantId,
        statuses = [
            PROCESSING_STATUS.RECEIVED,
            PROCESSING_STATUS.PROCESSING,
            PROCESSING_STATUS.IMPORTED,
            PROCESSING_STATUS.NORMALIZED,
            PROCESSING_STATUS.VALIDATED,
            PROCESSING_STATUS.PERSISTED,
            PROCESSING_STATUS.BATCHED,
            PROCESSING_STATUS.PARTIAL
        ],
        limit =
            DEFAULT_WORK_LIMIT
    } = {}) {

        const filter = {};

        if (
            tenantId
        ) {

            filter.tenantId =
                requireTenantId(
                    tenantId
                );
        }

        if (
            !Array.isArray(
                statuses
            ) ||
            statuses.length === 0
        ) {

            throw validationError(
                'statuses must be a non-empty array'
            );
        }

        filter.processingStatus = {
            $in:
                statuses.map(
                    status =>
                        String(
                            status
                        )
                            .trim()
                            .toUpperCase()
                )
        };

        return this.model
            .find(
                filter
            )
            .sort({
                receivedAt:
                    1,

                _id:
                    1
            })
            .limit(
                normalizeLimit(
                    limit
                )
            )
            .lean()
            .exec();
    }

    /* ========================================================================
     * TRANSITION STATUS
     * ====================================================================== */

    async transitionStatus({
        tenantId,
        statementId,
        from,
        to,
        metadata = {},
        session = null
    } = {}) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        const normalizedFrom =
            String(
                from ||
                ''
            )
                .trim()
                .toUpperCase();

        const normalizedTo =
            String(
                to ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            !this.isValidTransition(
                normalizedFrom,
                normalizedTo
            )
        ) {

            throw conflictError(
                `Invalid statement status transition: ${normalizedFrom} -> ${normalizedTo}`,
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId,

                    from:
                        normalizedFrom,

                    to:
                        normalizedTo
                }
            );
        }

        const now =
            this.now();

        const update = {

            $set: {

                processingStatus:
                    normalizedTo,

                ...this.buildTransitionMetadata(
                    normalizedTo,
                    metadata,
                    now
                )
            },

            $inc: {

                version:
                    1
            }
        };

        const document =
            await this.model
                .findOneAndUpdate(
                    {
                        tenantId:
                            normalizedTenantId,

                        statementId:
                            normalizedStatementId,

                        processingStatus:
                            normalizedFrom
                    },
                    update,
                    {
                        new:
                            true,

                        runValidators:
                            true,

                        session
                    }
                )
                .exec();

        if (
            document
        ) {

            return document;
        }

        const existing =
            await this.findByStatementId(
                normalizedTenantId,
                normalizedStatementId
            );

        if (
            !existing
        ) {

            throw notFoundError(
                'Statement not found',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        throw conflictError(
            `Statement status transition conflict: expected ${normalizedFrom}, actual ${existing.processingStatus}`,
            {
                tenantId:
                    normalizedTenantId,

                statementId:
                    normalizedStatementId,

                expected:
                    normalizedFrom,

                actual:
                    existing.processingStatus
            }
        );
    }

    /* ========================================================================
     * MARK PROCESSING
     * ====================================================================== */

    async markProcessing(
        tenantId,
        statementId,
        metadata = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        /*
         * RECEIVED -> PROCESSING
         *
         * PARTIAL/FAILED -> PROCESSING may be requested through the explicit
         * retry() method instead of implicitly through markProcessing().
         */
        return this.transitionStatus({
            tenantId:
                normalizedTenantId,

            statementId:
                normalizedStatementId,

            from:
                PROCESSING_STATUS.RECEIVED,

            to:
                PROCESSING_STATUS.PROCESSING,

            metadata
        });
    }

    /* ========================================================================
     * MARK IMPORTED
     * ====================================================================== */

    async markImported(
        tenantId,
        statementId,
        metadata = {}
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.PROCESSING,

            to:
                PROCESSING_STATUS.IMPORTED,

            metadata
        });
    }

    /* ========================================================================
     * MARK NORMALIZED
     * ====================================================================== */

    async markNormalized(
        tenantId,
        statementId,
        metadata = {}
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.IMPORTED,

            to:
                PROCESSING_STATUS.NORMALIZED,

            metadata
        });
    }

    /* ========================================================================
     * MARK VALIDATED
     * ====================================================================== */

    async markValidated(
        tenantId,
        statementId,
        metadata = {}
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.NORMALIZED,

            to:
                PROCESSING_STATUS.VALIDATED,

            metadata
        });
    }

    /* ========================================================================
     * MARK PERSISTED
     * ====================================================================== */

    async markPersisted(
        tenantId,
        statementId,
        metadata = {}
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.VALIDATED,

            to:
                PROCESSING_STATUS.PERSISTED,

            metadata
        });
    }

    /* ========================================================================
     * MARK BATCHED
     * ====================================================================== */

    async markBatched(
        tenantId,
        statementId,
        metadata = {}
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.PERSISTED,

            to:
                PROCESSING_STATUS.BATCHED,

            metadata
        });
    }

    /* ========================================================================
     * COMPLETE
     * ====================================================================== */

    async complete(
        tenantId,
        statementId,
        metadata = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        /*
         * Support an idempotent completion call.
         */
        const existing =
            await this.findByStatementId(
                normalizedTenantId,
                normalizedStatementId
            );

        if (
            !existing
        ) {

            throw notFoundError(
                'Statement not found',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        if (
            existing.processingStatus ===
            PROCESSING_STATUS.COMPLETED
        ) {

            return existing;
        }

        const allowedFrom = [
            PROCESSING_STATUS.PERSISTED,
            PROCESSING_STATUS.BATCHED,
            PROCESSING_STATUS.PARTIAL
        ];

        if (
            !allowedFrom.includes(
                existing.processingStatus
            )
        ) {

            throw conflictError(
                `Statement cannot be completed from ${existing.processingStatus}`,
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId,

                    status:
                        existing.processingStatus
                }
            );
        }

        return this.transitionStatus({
            tenantId:
                normalizedTenantId,

            statementId:
                normalizedStatementId,

            from:
                existing.processingStatus,

            to:
                PROCESSING_STATUS.COMPLETED,

            metadata
        });
    }

    /* ========================================================================
     * MARK PARTIAL
     * ====================================================================== */

    async markPartial(
        tenantId,
        statementId,
        metadata = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        const existing =
            await this.findByStatementId(
                normalizedTenantId,
                normalizedStatementId
            );

        if (
            !existing
        ) {

            throw notFoundError(
                'Statement not found',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        if (
            existing.processingStatus ===
            PROCESSING_STATUS.PARTIAL
        ) {

            return existing;
        }

        if (
            !this.isValidTransition(
                existing.processingStatus,
                PROCESSING_STATUS.PARTIAL
            )
        ) {

            throw conflictError(
                `Statement cannot become PARTIAL from ${existing.processingStatus}`,
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId,

                    status:
                        existing.processingStatus
                }
            );
        }

        return this.transitionStatus({
            tenantId:
                normalizedTenantId,

            statementId:
                normalizedStatementId,

            from:
                existing.processingStatus,

            to:
                PROCESSING_STATUS.PARTIAL,

            metadata
        });
    }

    /* ========================================================================
     * MARK FAILED
     * ====================================================================== */

    async markFailed(
        tenantId,
        statementId,
        error,
        metadata = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        const existing =
            await this.findByStatementId(
                normalizedTenantId,
                normalizedStatementId
            );

        if (
            !existing
        ) {

            throw notFoundError(
                'Statement not found',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        if (
            existing.processingStatus ===
            PROCESSING_STATUS.COMPLETED
        ) {

            throw conflictError(
                'Completed statement cannot be marked failed',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        const from =
            existing.processingStatus;

        if (
            !this.isValidTransition(
                from,
                PROCESSING_STATUS.FAILED
            )
        ) {

            throw conflictError(
                `Statement cannot transition to FAILED from ${from}`,
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId,

                    from
                }
            );
        }

        const failureMetadata = {

            ...metadata,

            lastError: {

                code:
                    normalizeString(
                        error?.code
                    ),

                message:
                    this.sanitizeErrorMessage(
                        error?.message
                    ) ||
                    'Unknown error',

                stage:
                    normalizeString(
                        error?.stage
                    ),

                retryable:
                    Boolean(
                        error?.retryable
                    )
            }
        };

        return this.transitionStatus({

            tenantId:
                normalizedTenantId,

            statementId:
                normalizedStatementId,

            from,

            to:
                PROCESSING_STATUS.FAILED,

            metadata:
                failureMetadata
        });
    }

    /* ========================================================================
     * RETRY
     * ====================================================================== */

    async retry(
        tenantId,
        statementId,
        metadata = {}
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        return this.transitionStatus({
            tenantId:
                normalizedTenantId,

            statementId:
                normalizedStatementId,

            from:
                PROCESSING_STATUS.FAILED,

            to:
                PROCESSING_STATUS.PROCESSING,

            metadata: {
                ...metadata,

                retry:
                    true,

                retryAt:
                    this.now()
            }
        });
    }

    /* ========================================================================
     * ASSIGN BATCH
     * ====================================================================== */

    async assignBatch(
        tenantId,
        statementId,
        batchId
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        const normalizedBatchId =
            normalizeString(
                batchId
            );

        if (
            !normalizedBatchId
        ) {

            throw validationError(
                'batchId is required'
            );
        }

        /*
         * Batch assignment is operational metadata only.
         * It cannot alter immutable statement identity.
         *
         * Do not permit assignment to terminal DUPLICATE/COMPLETED statements
         * unless the statement already has the same batch ID.
         */
        const result =
            await this.model
                .findOneAndUpdate(
                    {
                        tenantId:
                            normalizedTenantId,

                        statementId:
                            normalizedStatementId,

                        processingStatus: {
                            $nin: [
                                PROCESSING_STATUS.COMPLETED,
                                PROCESSING_STATUS.DUPLICATE
                            ]
                        },

                        $or: [
                            {
                                batchId:
                                    null
                            },

                            {
                                batchId:
                                    {
                                        $exists:
                                            false
                                    }
                            },

                            {
                                batchId:
                                    normalizedBatchId
                            }
                        ]
                    },
                    {
                        $set: {
                            batchId:
                                normalizedBatchId
                        },

                        $inc: {
                            version:
                                1
                        }
                    },
                    {
                        new:
                            true,

                        runValidators:
                            true
                    }
                )
                .exec();

        if (
            result
        ) {

            return result;
        }

        const existing =
            await this.findByStatementId(
                normalizedTenantId,
                normalizedStatementId
            );

        if (
            !existing
        ) {

            throw notFoundError(
                'Statement not found',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        if (
            existing.batchId ===
            normalizedBatchId
        ) {

            return existing;
        }

        throw conflictError(
            'Statement already belongs to another batch or is terminal',
            {
                tenantId:
                    normalizedTenantId,

                statementId:
                    normalizedStatementId,

                existingBatchId:
                    existing.batchId || null
            }
        );
    }

    /* ========================================================================
     * INCREMENT ATTEMPT
     * ====================================================================== */

    async incrementAttempt(
        tenantId,
        statementId
    ) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        const result =
            await this.model
                .findOneAndUpdate(
                    {
                        tenantId:
                            normalizedTenantId,

                        statementId:
                            normalizedStatementId,

                        processingStatus: {
                            $nin: [
                                PROCESSING_STATUS.COMPLETED,
                                PROCESSING_STATUS.DUPLICATE
                            ]
                        }
                    },
                    {
                        $inc: {
                            attemptCount:
                                1,

                            version:
                                1
                        }
                    },
                    {
                        new:
                            true,

                        runValidators:
                            true
                    }
                )
                .exec();

        if (
            result
        ) {

            return result;
        }

        const existing =
            await this.findByStatementId(
                normalizedTenantId,
                normalizedStatementId
            );

        if (
            !existing
        ) {

            throw notFoundError(
                'Statement not found',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        throw conflictError(
            `Cannot increment attempt for statement in ${existing.processingStatus} state`,
            {
                tenantId:
                    normalizedTenantId,

                statementId:
                    normalizedStatementId,

                status:
                    existing.processingStatus
            }
        );
    }

    /* ========================================================================
     * UPDATE OPERATIONAL METADATA
     * ====================================================================== */

    async updateOperationalMetadata({
        tenantId,
        statementId,
        metadata = {}
    } = {}) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedStatementId =
            requireStatementId(
                statementId
            );

        const sanitized =
            this.filterOperationalMetadata(
                metadata
            );

        const update = {
            $set: {
                processingMetadata:
                    sanitized
            },

            $inc: {
                version:
                    1
            }
        };

        const result =
            await this.model
                .findOneAndUpdate(
                    {
                        tenantId:
                            normalizedTenantId,

                        statementId:
                            normalizedStatementId,

                        processingStatus: {
                            $nin: [
                                PROCESSING_STATUS.COMPLETED,
                                PROCESSING_STATUS.DUPLICATE
                            ]
                        }
                    },
                    update,
                    {
                        new:
                            true,

                        runValidators:
                            true
                    }
                )
                .exec();

        if (
            result
        ) {

            return result;
        }

        const existing =
            await this.findByStatementId(
                normalizedTenantId,
                normalizedStatementId
            );

        if (
            !existing
        ) {

            throw notFoundError(
                'Statement not found',
                {
                    tenantId:
                        normalizedTenantId,

                    statementId:
                        normalizedStatementId
                }
            );
        }

        throw conflictError(
            'Operational metadata cannot be modified for a terminal statement',
            {
                tenantId:
                    normalizedTenantId,

                statementId:
                    normalizedStatementId,

                status:
                    existing.processingStatus
            }
        );
    }

    /* ========================================================================
     * DELETE
     * ====================================================================== */

    async delete() {

        throw conflictError(
            'Statement deletion is prohibited. Use retention/archive workflow.'
        );
    }

    /* ========================================================================
     * GENERIC UPDATE
     * ====================================================================== */

    async update() {

        throw conflictError(
            'Generic Statement.update() is prohibited. Use explicit lifecycle methods.'
        );
    }

    async findOneAndUpdate() {

        throw conflictError(
            'Generic Statement.findOneAndUpdate() is prohibited. Use explicit repository methods.'
        );
    }

    /* ========================================================================
     * TRANSITION VALIDATION
     * ====================================================================== */

    isValidTransition(
        from,
        to
    ) {

        const normalizedFrom =
            String(
                from ||
                ''
            )
                .trim()
                .toUpperCase();

        const normalizedTo =
            String(
                to ||
                ''
            )
                .trim()
                .toUpperCase();

        return Boolean(
            ALLOWED_TRANSITIONS[
                normalizedFrom
            ]?.has(
                normalizedTo
            )
        );
    }

    /* ========================================================================
     * TRANSITION METADATA
     * ====================================================================== */

    buildTransitionMetadata(
        status,
        metadata,
        now
    ) {

        const safeMetadata =
            this.filterOperationalMetadata(
                metadata
            );

        const result = {

            /*
             * This is deliberately an explicit operational metadata field.
             * If the model supports Mongo $set/$setOnInsert semantics for
             * nested metadata, callers can introduce that independently.
             *
             * We preserve the repository's existing replacement behavior here
             * to avoid assuming a particular Statement schema.
             */
            processingMetadata:
                safeMetadata
        };

        switch (
            status
        ) {

            case PROCESSING_STATUS.PROCESSING:

                result.processingStartedAt =
                    now;

                break;

            case PROCESSING_STATUS.IMPORTED:

                result.importedAt =
                    now;

                break;

            case PROCESSING_STATUS.NORMALIZED:

                result.normalizedAt =
                    now;

                break;

            case PROCESSING_STATUS.VALIDATED:

                result.validatedAt =
                    now;

                break;

            case PROCESSING_STATUS.PERSISTED:

                result.persistedAt =
                    now;

                break;

            case PROCESSING_STATUS.BATCHED:

                result.batchedAt =
                    now;

                break;

            case PROCESSING_STATUS.COMPLETED:

                result.completedAt =
                    now;

                break;

            case PROCESSING_STATUS.FAILED:

                result.failedAt =
                    now;

                break;

            case PROCESSING_STATUS.PARTIAL:

                result.partialAt =
                    now;

                break;

            default:
                break;
        }

        return result;
    }

    /* ========================================================================
     * CREATE PAYLOAD PROTECTION
     * ====================================================================== */

    prepareCreatePayload(
        statement = {},
        context = {}
    ) {

        if (
            !statement ||
            typeof statement !==
                'object'
        ) {

            throw validationError(
                'statement must be an object'
            );
        }

        const tenantId =
            requireTenantId(
                statement.tenantId ||
                context.tenantId
            );

        const statementId =
            requireStatementId(
                statement.statementId ||
                context.statementId
            );

        const operationKey =
            requireOperationKey(
                statement.operationKey ||
                context.operationKey
            );

        const idempotencyKey =
            requireOperationKey(
                statement.idempotencyKey ||
                context.idempotencyKey ||
                operationKey
            );

        /*
         * Copy the input so callers do not observe mutation.
         */
        const payload = {
            ...statement
        };

        /*
         * Authoritative identity fields.
         */
        payload.tenantId =
            tenantId;

        payload.statementId =
            statementId;

        payload.operationKey =
            operationKey;

        payload.idempotencyKey =
            idempotencyKey;

        payload.correlationId =
            statement.correlationId ||
            context.correlationId ||
            null;

        payload.requestId =
            statement.requestId ||
            context.requestId ||
            null;

        payload.operationId =
            statement.operationId ||
            context.operationId ||
            null;

        payload.provider =
            statement.provider ||
            context.provider ||
            null;

        payload.providerStatementId =
            statement.providerStatementId ||
            context.providerStatementId ||
            null;

        payload.providerBatchId =
            statement.providerBatchId ||
            context.providerBatchId ||
            null;

        payload.providerReference =
            statement.providerReference ||
            context.providerReference ||
            null;

        payload.batchId =
            statement.batchId ||
            context.batchId ||
            null;

        payload.pipelineId =
            statement.pipelineId ||
            context.pipelineId ||
            null;

        payload.statementTraceId =
            statement.statementTraceId ||
            context.statementTraceId ||
            null;

        payload.inputFingerprint =
            statement.inputFingerprint ||
            context.inputFingerprint ||
            null;

        payload.receivedAt =
            statement.receivedAt ||
            this.now();

        /*
         * New statements normally enter RECEIVED.
         *
         * Preserve an explicitly supplied status only if it is a valid model
         * status and the caller explicitly opts into it.
         */
        const suppliedStatus =
            normalizeString(
                statement.processingStatus
            );

        payload.processingStatus =
            suppliedStatus ||
            PROCESSING_STATUS.RECEIVED;

        if (
            !Object.values(
                PROCESSING_STATUS
            ).includes(
                payload.processingStatus
            )
        ) {

            throw validationError(
                `Invalid initial processingStatus: ${payload.processingStatus}`
            );
        }

        /*
         * Do not allow creation to overwrite protected identity values through
         * nested metadata.
         */
        payload.processingMetadata =
            this.filterOperationalMetadata(
                statement.processingMetadata ||
                context.processingMetadata ||
                {}
            );

        return payload;
    }

    /* ========================================================================
     * OPERATIONAL METADATA FILTERING
     * ====================================================================== */

    filterOperationalMetadata(
        metadata = {}
    ) {

        if (
            !metadata ||
            typeof metadata !==
                'object'
        ) {
            return {};
        }

        const forbiddenExact =
            new Set([

                'tenantId',

                'statementId',

                'operationKey',

                'idempotencyKey',

                'provider',

                'providerStatementId',

                'providerReference',

                'batchId',

                'pipelineId',

                'statementTraceId',

                'sourceTransactionId',

                'transactionId',

                'currency',

                'amount',

                'balance',

                'accountId',

                'memberId',

                'rawPayload',

                'rawStatement',

                'statementContent'
            ]);

        const sensitivePatterns = [
            /password/i,
            /token/i,
            /secret/i,
            /authorization/i,
            /private.?key/i,
            /pin/i,
            /otp/i,
            /cvv/i,
            /card.?number/i,
            /account.?number/i,
            /wallet.?number/i,
            /national.?id/i,
            /identity.?number/i
        ];

        const output = {};
        let count = 0;

        for (
            const [
                key,
                value
            ]
            of Object.entries(
                metadata
            )
        ) {

            if (
                count >=
                this.maxMetadataKeys
            ) {
                break;
            }

            if (
                forbiddenExact.has(
                    key
                )
            ) {
                continue;
            }

            if (
                sensitivePatterns.some(
                    pattern =>
                        pattern.test(
                            key
                        )
                )
            ) {
                continue;
            }

            output[
                String(
                    key
                ).slice(
                    0,
                    128
                )
            ] =
                this.sanitizeMetadataValue(
                    value
                );

            count++;
        }

        return output;
    }

    /* ========================================================================
     * METADATA SANITIZATION
     * ====================================================================== */

    sanitizeMetadataValue(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {
            return value;
        }

        if (
            typeof value ===
            'string'
        ) {

            return value.slice(
                0,
                this.maxMetadataStringLength
            );
        }

        if (
            typeof value ===
                'number' ||
            typeof value ===
                'boolean'
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {

            return value.toISOString();
        }

        if (
            Array.isArray(
                value
            )
        ) {

            return value
                .slice(
                    0,
                    MAX_METADATA_ARRAY_ITEMS
                )
                .map(
                    item =>
                        this.sanitizeMetadataValue(
                            item
                        )
                );
        }

        if (
            typeof value ===
            'object'
        ) {

            const nested = {};
            let count = 0;

            for (
                const [
                    key,
                    nestedValue
                ] of Object.entries(
                    value
                )
            ) {

                if (
                    count >=
                    this.maxMetadataKeys
                ) {
                    break;
                }

                if (
                    /password|token|secret|authorization|private.?key|pin|otp|cvv|card.?number/i
                        .test(
                            key
                        )
                ) {
                    continue;
                }

                nested[
                    String(
                        key
                    ).slice(
                        0,
                        128
                    )
                ] =
                    this.sanitizeMetadataValue(
                        nestedValue
                    );

                count++;
            }

            return nested;
        }

        return String(
            value
        ).slice(
            0,
            this.maxMetadataStringLength
        );
    }

    /* ========================================================================
     * ERROR METADATA
     * ====================================================================== */

    sanitizeErrorMessage(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            return null;
        }

        return String(
            value
        ).slice(
            0,
            MAX_ERROR_MESSAGE_LENGTH
        );
    }

    /* ========================================================================
     * DUPLICATE KEY
     * ====================================================================== */

    isDuplicateKeyError(
        error
    ) {

        return Boolean(
            error &&
            (
                error.code ===
                    11000 ||
                error.keyPattern ||
                (
                    error.name ===
                        'MongoServerError' &&
                    String(
                        error.message ||
                        ''
                    )
                        .toLowerCase()
                        .includes(
                            'duplicate'
                        )
                )
            )
        );
    }

    /* ========================================================================
     * CLOCK
     * ====================================================================== */

    now() {

        const value =
            this.clock();

        const date =
            value instanceof Date
                ? new Date(
                    value.getTime()
                )
                : new Date(
                    value
                );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            throw new Error(
                'StatementRepository clock returned an invalid date'
            );
        }

        return date;
    }

    /* ========================================================================
     * TENANT SCOPE
     * ====================================================================== */

    applyTenantScope(
        filter = {},
        tenantId
    ) {

        const result = {
            ...filter
        };

        if (
            tenantId
        ) {

            result.tenantId =
                requireTenantId(
                    tenantId
                );
        }

        return result;
    }

    /* ========================================================================
     * DIAGNOSTICS
     * ====================================================================== */

    diagnostics() {

        return {

            repository:
                'StatementRepository',

            modelConfigured:
                Boolean(
                    this.model
                ),

            allowCrossTenantFindById:
                this.allowCrossTenantFindById,

            maxMetadataKeys:
                this.maxMetadataKeys,

            processingStatuses:
                Object.values(
                    PROCESSING_STATUS
                ),

            capabilities: {

                create:
                    typeof this.model
                        ?.create ===
                    'function',

                findOne:
                    typeof this.model
                        ?.findOne ===
                    'function',

                findById:
                    typeof this.model
                        ?.findById ===
                    'function',

                findOneAndUpdate:
                    typeof this.model
                        ?.findOneAndUpdate ===
                    'function'
            },

            timestamp:
                this.now()
                    .toISOString()
        };
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

StatementRepository.Status =
    PROCESSING_STATUS;

StatementRepository.AllowedTransitions =
    ALLOWED_TRANSITIONS;

StatementRepository.Error =
    StatementRepositoryError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    StatementRepository;