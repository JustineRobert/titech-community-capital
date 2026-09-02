/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementRepository.js
 * ============================================================================
 *
 * Enterprise Statement Repository
 *
 * Responsibilities:
 *
 * - Provide persistence abstraction for statement records.
 * - Enforce tenant-aware financial data isolation.
 * - Support idempotent statement storage.
 * - Provide lifecycle/status persistence.
 * - Support reconciliation and processing workflows.
 * - Provide safe query execution.
 * - Preserve audit and observability metadata.
 * - Prevent accidental cross-tenant reads/writes.
 *
 * Pipeline Position:
 *
 * StatementImporter
 *        |
 *        v
 * StatementNormalizer
 *        |
 *        v
 * StatementValidator
 *        |
 *        v
 * StatementRepository
 *        |
 *        v
 * Ledger / Reconciliation
 *
 * Design Principles:
 *
 * - No business workflow orchestration.
 * - No provider coupling.
 * - Tenant isolation by default.
 * - Idempotent persistence.
 * - Explicit validation.
 * - Async first.
 * - Production error handling.
 * - Audit friendly.
 * - Distributed-processing ready.
 * - Safe for Mongoose-style repositories.
 *
 * ============================================================================
 */

'use strict';

const {
    StatementPersistenceError,
    DuplicateStatementError
} = require('./StatementErrors');

const {
    STATEMENT_STATUS
} = require('./StatementConstants');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

/**
 * ============================================================================
 * StatementRepository
 * ============================================================================
 */

class StatementRepository {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {Object} model
     *
     * The model is intentionally injected so the repository remains
     * persistence implementation independent.
     */

    constructor(model) {

        if (!model || typeof model !== 'object') {

            throw new StatementPersistenceError(

                'Statement repository model required',

                {
                    reason: 'MISSING_MODEL'
                }

            );

        }

        this.model = model;

    }

    /**
     * =========================================================================
     * Save Statement
     * =========================================================================
     *
     * Persists a validated statement.
     *
     * Enterprise guarantees:
     *
     * - tenantId is mandatory.
     * - statementId is mandatory.
     * - duplicate statement identity is detected.
     * - existing statement is returned for idempotent replay.
     * - database duplicate-key errors are normalized.
     *
     * @param {Object} statement
     *
     * @returns {Promise<Object>}
     */

    async save(statement) {

        try {

            this.validateStatement(statement);

            const tenantId = statement.tenantId;
            const statementId = statement.statementId;

            const existing = await this.findByStatementId(
                tenantId,
                statementId
            );

            if (existing) {

                /**
                 * Idempotent replay.
                 *
                 * If the same statement is already persisted, return the
                 * existing record instead of creating a duplicate.
                 */

                return existing;

            }

            const reference = statement.reference;

            if (reference) {

                const existingByReference =
                    await this.findByReference(
                        reference,
                        tenantId
                    );

                if (existingByReference) {

                    /**
                     * Same tenant + reference means the statement has
                     * already been imported.
                     */

                    if (
                        existingByReference.statementId ===
                        statementId
                    ) {

                        return existingByReference;

                    }

                    throw new DuplicateStatementError(

                        'Statement reference already exists',

                        {
                            tenantId,
                            reference,
                            existingStatementId:
                                existingByReference.statementId || null
                        }

                    );

                }

            }

            const document =
                await this.executeCreate(statement);

            return document;

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError ||
                error instanceof DuplicateStatementError
            ) {

                throw error;

            }

            /**
             * MongoDB duplicate key protection.
             */

            if (
                error &&
                (
                    error.code === 11000 ||
                    error.codeName === 'DuplicateKey'
                )
            ) {

                throw new DuplicateStatementError(

                    'Statement already exists',

                    {
                        tenantId:
                            statement?.tenantId || null,

                        statementId:
                            statement?.statementId || null,

                        reference:
                            statement?.reference || null,

                        originalError:
                            error.message
                    },

                    {
                        cause: error
                    }

                );

            }

            throw new StatementPersistenceError(

                'Failed to persist statement',

                {
                    tenantId:
                        statement?.tenantId || null,

                    statementId:
                        statement?.statementId || null,

                    reference:
                        statement?.reference || null,

                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Find By Statement ID
     * =========================================================================
     *
     * Tenant scoped internal lookup.
     *
     * @param {string} tenantId
     * @param {string} statementId
     *
     * @returns {Promise<Object|null>}
     */

    async findByStatementId(
        tenantId,
        statementId
    ) {

        try {

            this.validateTenantId(tenantId);
            this.validateStatementId(statementId);

            return await this.executeFindOne({

                tenantId,
                statementId

            });

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed finding statement by statement id',

                {
                    tenantId,
                    statementId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Find Statement By Reference
     * =========================================================================
     *
     * Tenant isolation is mandatory.
     *
     * Existing API compatibility is preserved:
     *
     * findByReference(reference)
     *
     * The optional tenantId argument is supported for enterprise-safe calls.
     *
     * @param {string} reference
     * @param {string|null} tenantId
     *
     * @returns {Promise<Object|null>}
     */

    async findByReference(
        reference,
        tenantId = null
    ) {

        try {

            if (!reference) {

                throw new StatementPersistenceError(

                    'Statement reference required',

                    {
                        reason:
                            'MISSING_REFERENCE'
                    }

                );

            }

            const filter = {
                reference
            };

            /**
             * When tenantId is available, always scope the query.
             */

            if (tenantId) {

                this.validateTenantId(tenantId);

                filter.tenantId = tenantId;

            }

            return await this.executeFindOne(filter);

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed finding statement by reference',

                {
                    tenantId,
                    reference,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Find Statement By ID
     * =========================================================================
     *
     * IMPORTANT:
     *
     * This method preserves the existing API but supports an optional tenantId.
     *
     * findById(id)
     * findById(id, tenantId)
     *
     * When tenantId is supplied, the query becomes tenant isolated.
     *
     * @param {string} statementId
     * @param {string|null} tenantId
     *
     * @returns {Promise<Object|null>}
     */

    async findById(
        statementId,
        tenantId = null
    ) {

        try {

            this.validateStatementId(statementId);

            if (tenantId) {

                this.validateTenantId(tenantId);

                return await this.executeFindOne({

                    _id: statementId,
                    tenantId

                });

            }

            /**
             * Backwards-compatible lookup.
             *
             * New financial workflow code should prefer the tenant-scoped
             * variant above.
             */

            return await this.executeFindById(
                statementId
            );

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed finding statement by id',

                {
                    tenantId,
                    statementId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Find Statements By Tenant
     * =========================================================================
     *
     * Critical multi-tenant financial isolation boundary.
     *
     * @param {string} tenantId
     * @param {Object} filters
     *
     * @returns {Promise<Array>}
     */

    async findByTenant(
        tenantId,
        filters = {}
    ) {

        try {

            this.validateTenantId(tenantId);

            if (
                !filters ||
                typeof filters !== 'object' ||
                Array.isArray(filters)
            ) {

                throw new StatementPersistenceError(

                    'Invalid statement query filters',

                    {
                        reason:
                            'INVALID_FILTERS'
                    }

                );

            }

            /**
             * Tenant ID is always controlled by the repository.
             *
             * A caller cannot override it through filters.
             */

            const query = {

                ...filters,

                tenantId

            };

            return await this.executeFind(query);

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed retrieving tenant statements',

                {
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Find Statements With Pagination
     * =========================================================================
     *
     * Distributed-processing friendly query API.
     *
     * @param {string} tenantId
     * @param {Object} options
     *
     * @returns {Promise<Object>}
     */

    async findPage(
        tenantId,
        {
            filters = {},
            page = 1,
            limit = DEFAULT_PAGE_SIZE,
            sort = {
                createdAt: -1,
                _id: -1
            }
        } = {}
    ) {

        try {

            this.validateTenantId(tenantId);

            const safePage =
                Math.max(
                    1,
                    Number(page) || 1
                );

            const safeLimit =
                Math.min(
                    MAX_PAGE_SIZE,
                    Math.max(
                        1,
                        Number(limit) ||
                        DEFAULT_PAGE_SIZE
                    )
                );

            const query = {

                ...(filters || {}),

                tenantId

            };

            const skip =
                (safePage - 1) *
                safeLimit;

            const [items, total] =
                await Promise.all([

                    this.executeFind(
                        query,
                        {
                            skip,
                            limit: safeLimit,
                            sort
                        }
                    ),

                    this.executeCount(query)

                ]);

            return {

                items,

                page:
                    safePage,

                limit:
                    safeLimit,

                total,

                totalPages:
                    Math.ceil(
                        total / safeLimit
                    )

            };

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed retrieving paginated tenant statements',

                {
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Update Statement Status
     * =========================================================================
     *
     * Tenant-aware lifecycle update.
     *
     * Existing API:
     *
     * updateStatus(id, status)
     *
     * Enterprise-safe API:
     *
     * updateStatus(id, status, tenantId)
     *
     * @param {string} id
     * @param {string} status
     * @param {string|null} tenantId
     *
     * @returns {Promise<Object|null>}
     */

    async updateStatus(
        id,
        status,
        tenantId = null
    ) {

        try {

            this.validateStatementId(id);
            this.validateStatus(status);

            const filter = {
                _id: id
            };

            if (tenantId) {

                this.validateTenantId(tenantId);

                filter.tenantId = tenantId;

            }

            const update = {

                $set: {

                    status,

                    updatedAt:
                        new Date()

                }

            };

            const result =
                await this.executeFindOneAndUpdate(

                    filter,

                    update,

                    {
                        new: true
                    }

                );

            return result;

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed updating statement status',

                {
                    id,
                    status,
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Update Statement
     * =========================================================================
     *
     * Controlled tenant-aware update.
     *
     * @param {string} statementId
     * @param {string} tenantId
     * @param {Object} updates
     *
     * @returns {Promise<Object|null>}
     */

    async update(
        statementId,
        tenantId,
        updates = {}
    ) {

        try {

            this.validateStatementId(statementId);
            this.validateTenantId(tenantId);

            if (
                !updates ||
                typeof updates !== 'object' ||
                Array.isArray(updates)
            ) {

                throw new StatementPersistenceError(

                    'Statement updates must be an object'

                );

            }

            /**
             * Protect immutable financial identity fields.
             */

            const protectedFields = new Set([

                '_id',
                'id',
                'statementId',
                'tenantId',
                'createdAt'

            ]);

            const sanitizedUpdates = {};

            Object.entries(updates)
                .forEach(([key, value]) => {

                    if (!protectedFields.has(key)) {

                        sanitizedUpdates[key] = value;

                    }

                });

            sanitizedUpdates.updatedAt =
                new Date();

            return await this.executeFindOneAndUpdate(

                {
                    _id: statementId,
                    tenantId
                },

                {
                    $set:
                        sanitizedUpdates
                },

                {
                    new: true
                }

            );

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed updating statement',

                {
                    statementId,
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Exists By Reference
     * =========================================================================
     *
     * Supports idempotent imports.
     *
     * @param {string} reference
     * @param {string|null} tenantId
     *
     * @returns {Promise<boolean>}
     */

    async existsByReference(
        reference,
        tenantId = null
    ) {

        try {

            const statement =
                await this.findByReference(
                    reference,
                    tenantId
                );

            return Boolean(statement);

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed checking statement reference',

                {
                    reference,
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Exists By Statement ID
     * =========================================================================
     */

    async existsByStatementId(
        statementId,
        tenantId
    ) {

        try {

            this.validateStatementId(statementId);
            this.validateTenantId(tenantId);

            const query = {

                statementId,
                tenantId

            };

            if (
                typeof this.model.exists === 'function'
            ) {

                const result =
                    await this.model.exists(query);

                return Boolean(result);

            }

            const result =
                await this.executeFindOne(query);

            return Boolean(result);

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed checking statement identity',

                {
                    statementId,
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Count Statements By Tenant
     * =========================================================================
     */

    async countByTenant(
        tenantId,
        filters = {}
    ) {

        try {

            this.validateTenantId(tenantId);

            const query = {

                ...(filters || {}),

                tenantId

            };

            return await this.executeCount(query);

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed counting tenant statements',

                {
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Mark Processing Failed
     * =========================================================================
     *
     * Convenience lifecycle operation used by processing workflows.
     */

    async markFailed(
        statementId,
        tenantId,
        reason = null
    ) {

        try {

            this.validateStatementId(statementId);
            this.validateTenantId(tenantId);

            const update = {

                $set: {

                    status:
                        STATEMENT_STATUS.FAILED,

                    failureReason:
                        this.normalizeFailureReason(reason),

                    updatedAt:
                        new Date()

                }

            };

            return await this.executeFindOneAndUpdate(

                {
                    _id: statementId,
                    tenantId
                },

                update,

                {
                    new: true
                }

            );

        }
        catch (error) {

            if (
                error instanceof StatementPersistenceError
            ) {

                throw error;

            }

            throw new StatementPersistenceError(

                'Failed marking statement as failed',

                {
                    statementId,
                    tenantId,
                    originalError:
                        error.message
                },

                {
                    cause: error,
                    retryable:
                        this.isRetryableDatabaseError(error)
                }

            );

        }

    }

    /**
     * =========================================================================
     * Internal: Create
     * =========================================================================
     */

    async executeCreate(document) {

        if (
            typeof this.model.create !== 'function'
        ) {

            throw new StatementPersistenceError(

                'Statement model does not support create()'

            );

        }

        return await this.model.create(
            document
        );

    }

    /**
     * =========================================================================
     * Internal: Find One
     * =========================================================================
     */

    async executeFindOne(filter) {

        if (
            typeof this.model.findOne !== 'function'
        ) {

            throw new StatementPersistenceError(

                'Statement model does not support findOne()'

            );

        }

        const query =
            this.model.findOne(filter);

        return await this.executeQuery(
            query
        );

    }

    /**
     * =========================================================================
     * Internal: Find By ID
     * =========================================================================
     */

    async executeFindById(id) {

        if (
            typeof this.model.findById !== 'function'
        ) {

            throw new StatementPersistenceError(

                'Statement model does not support findById()'

            );

        }

        const query =
            this.model.findById(id);

        return await this.executeQuery(
            query
        );

    }

    /**
     * =========================================================================
     * Internal: Find
     * =========================================================================
     */

    async executeFind(
        filter,
        {
            skip = 0,
            limit = null,
            sort = null
        } = {}
    ) {

        if (
            typeof this.model.find !== 'function'
        ) {

            throw new StatementPersistenceError(

                'Statement model does not support find()'

            );

        }

        let query =
            this.model.find(filter);

        if (
            sort &&
            typeof query.sort === 'function'
        ) {

            query =
                query.sort(sort);

        }

        if (
            Number.isInteger(skip) &&
            skip > 0 &&
            typeof query.skip === 'function'
        ) {

            query =
                query.skip(skip);

        }

        if (
            Number.isInteger(limit) &&
            limit > 0 &&
            typeof query.limit === 'function'
        ) {

            query =
                query.limit(limit);

        }

        return await this.executeQuery(
            query
        );

    }

    /**
     * =========================================================================
     * Internal: Count
     * =========================================================================
     */

    async executeCount(filter) {

        if (
            typeof this.model.countDocuments === 'function'
        ) {

            const query =
                this.model.countDocuments(filter);

            return await this.executeQuery(
                query
            );

        }

        if (
            typeof this.model.count === 'function'
        ) {

            const query =
                this.model.count(filter);

            return await this.executeQuery(
                query
            );

        }

        throw new StatementPersistenceError(

            'Statement model does not support document counting'

        );

    }

    /**
     * =========================================================================
     * Internal: Find One And Update
     * =========================================================================
     */

    async executeFindOneAndUpdate(
        filter,
        update,
        options = {}
    ) {

        if (
            typeof this.model.findOneAndUpdate !== 'function'
        ) {

            throw new StatementPersistenceError(

                'Statement model does not support findOneAndUpdate()'

            );

        }

        const query =
            this.model.findOneAndUpdate(

                filter,
                update,
                options

            );

        return await this.executeQuery(
            query
        );

    }

    /**
     * =========================================================================
     * Internal: Execute Query
     * =========================================================================
     *
     * Supports:
     *
     * - Mongoose Query
     * - Native Promise
     * - Promise-compatible query objects
     */

    async executeQuery(query) {

        if (!query) {

            return query;

        }

        if (
            typeof query.lean === 'function'
        ) {

            query =
                query.lean();

        }

        if (
            typeof query.exec === 'function'
        ) {

            return await query.exec();

        }

        return await query;

    }

    /**
     * =========================================================================
     * Validate Statement
     * =========================================================================
     */

    validateStatement(statement) {

        if (
            !statement ||
            typeof statement !== 'object' ||
            Array.isArray(statement)
        ) {

            throw new StatementPersistenceError(

                'Statement required for persistence',

                {
                    reason:
                        'INVALID_STATEMENT'
                }

            );

        }

        this.validateTenantId(
            statement.tenantId
        );

        this.validateStatementId(
            statement.statementId
        );

    }

    /**
     * =========================================================================
     * Validate Tenant ID
     * =========================================================================
     */

    validateTenantId(tenantId) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            String(tenantId).trim() === ''
        ) {

            throw new StatementPersistenceError(

                'Tenant id required',

                {
                    reason:
                        'MISSING_TENANT_ID'
                }

            );

        }

    }

    /**
     * =========================================================================
     * Validate Statement ID
     * =========================================================================
     */

    validateStatementId(statementId) {

        if (
            statementId === undefined ||
            statementId === null ||
            String(statementId).trim() === ''
        ) {

            throw new StatementPersistenceError(

                'Statement id required',

                {
                    reason:
                        'MISSING_STATEMENT_ID'
                }

            );

        }

    }

    /**
     * =========================================================================
     * Validate Status
     * =========================================================================
     */

    validateStatus(status) {

        if (
            !status ||
            typeof status !== 'string'
        ) {

            throw new StatementPersistenceError(

                'Statement status required',

                {
                    reason:
                        'MISSING_STATUS'
                }

            );

        }

        const allowedStatuses =
            Object.values(STATEMENT_STATUS);

        if (
            allowedStatuses.length &&
            !allowedStatuses.includes(status)
        ) {

            throw new StatementPersistenceError(

                'Invalid statement status',

                {
                    status,
                    allowedStatuses
                }

            );

        }

    }

    /**
     * =========================================================================
     * Normalize Failure Reason
     * =========================================================================
     */

    normalizeFailureReason(reason) {

        if (
            reason instanceof Error
        ) {

            return reason.message;

        }

        if (
            reason === undefined ||
            reason === null
        ) {

            return null;

        }

        return String(reason);

    }

    /**
     * =========================================================================
     * Determine Retryability
     * =========================================================================
     */

    isRetryableDatabaseError(error) {

        if (!error) {

            return false;

        }

        /**
         * Mongo/network/server transient failures.
         */

        const retryableCodes = new Set([

            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'EHOSTUNREACH',
            'MongoNetworkError',
            'MongoServerSelectionError',
            'MongoTimeoutError'

        ]);

        if (
            retryableCodes.has(error.code) ||
            retryableCodes.has(error.name)
        ) {

            return true;

        }

        /**
         * MongoDB transient transaction labels.
         */

        if (
            typeof error.hasErrorLabel === 'function'
        ) {

            return (

                error.hasErrorLabel(
                    'TransientTransactionError'
                ) ||

                error.hasErrorLabel(
                    'UnknownTransactionCommitResult'
                )

            );

        }

        return false;

    }

}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports = StatementRepository;