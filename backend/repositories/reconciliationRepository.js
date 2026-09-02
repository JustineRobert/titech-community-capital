"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Reconciliation Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/reconciliationRepository.js
 *
 * Purpose:
 *   Persistence boundary for financial reconciliation reports, provider
 *   reconciliation results, balance exceptions, and settlement comparisons.
 *
 * ============================================================================
 * ARCHITECTURAL POSITION
 * ============================================================================
 *
 *   Reconciliation Service
 *            │
 *            ▼
 *   Reconciliation Repository
 *            │
 *            ▼
 *   Reconciliation Model
 *            │
 *            ▼
 *          MongoDB
 *
 * ============================================================================
 * RESPONSIBILITIES
 * ============================================================================
 *
 * ✓ Tenant isolation.
 * ✓ Session-aware persistence.
 * ✓ Reconciliation report creation.
 * ✓ Scoped retrieval.
 * ✓ Paginated searching.
 * ✓ Daily/monthly reporting.
 * ✓ Exception retrieval.
 * ✓ Provider-specific reporting.
 * ✓ Reconciliation summary metrics.
 * ✓ Health metrics.
 * ✓ Controlled updates.
 * ✓ Optimistic concurrency support.
 * ✓ Soft deletion.
 * ✓ Safe bulk updates.
 * ✓ Duplicate-key/error normalization.
 *
 * ============================================================================
 * NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Does not perform reconciliation calculations.
 * ✗ Does not decide whether a transaction is financially correct.
 * ✗ Does not match provider records itself.
 * ✗ Does not calculate settlement differences.
 * ✗ Does not authorize reconciliation actions.
 * ✗ Does not start MongoDB transactions.
 * ✗ Does not commit MongoDB transactions.
 * ✗ Does not abort MongoDB transactions.
 *
 * Those responsibilities belong to the reconciliation service/coordinator.
 *
 * ============================================================================
 * TENANCY
 * ============================================================================
 *
 * Every normal operation requires a valid TITech tenant identifier.
 *
 * Caller-supplied query objects cannot override:
 *
 *   tenantId
 *   deleted
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * All legacy ACFOS terminology has been replaced with TITech terminology.
 *
 * ============================================================================
 */

const mongoose =
    require("mongoose");

const tenantConstants =
    require(
        "../tenancy/tenant.constants"
    );

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    20;

const MAX_LIMIT =
    200;

const MAX_BULK_UPDATE =
    5000;

const TENANT_ID_MAX_LENGTH =
    64;

const IDENTIFIER_REGEX =
    /^[a-zA-Z0-9._:-]+$/;

const ALLOWED_SORT_FIELDS =
    Object.freeze([
        "createdAt",
        "updatedAt",
        "provider",
        "status",
        "isBalanced",
        "reconciledAt",
        "reportDate"
    ]);

const ALLOWED_STATUSES =
    Object.freeze([
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "EXCEPTION",
        "RECONCILED",
        "PARTIALLY_RECONCILED",
        "CANCELLED"
    ]);

/**
 * ============================================================================
 * Logger
 * ============================================================================
 */

let logger;

try {
    logger =
        require(
            "../src/infrastructure/logging/logger"
        );
} catch {
    try {
        logger =
            require(
                "../infrastructure/logging/logger"
            );
    } catch {
        logger =
            console;
    }
}

/**
 * ============================================================================
 * Repository Error
 * ============================================================================
 */

class ReconciliationRepositoryError
    extends Error {

    constructor(
        message,
        code = "RECONCILIATION_REPOSITORY_ERROR",
        statusCode = 500,
        details = undefined
    ) {
        super(message);

        this.name =
            "ReconciliationRepositoryError";

        this.code =
            code;

        this.statusCode =
            statusCode;

        if (
            details !==
            undefined
        ) {
            this.details =
                details;
        }

        Error.captureStackTrace?.(
            this,
            ReconciliationRepositoryError
        );
    }
}

/**
 * ============================================================================
 * Tenant Validation
 * ============================================================================
 */

function requireTenantId(
    tenantId
) {
    if (
        tenantId ===
            undefined ||
        tenantId ===
            null
    ) {
        throw new ReconciliationRepositoryError(
            "tenantId is required.",
            "RECONCILIATION_TENANT_REQUIRED",
            400
        );
    }

    const normalized =
        String(
            tenantId
        )
            .trim()
            .toLowerCase();

    if (
        normalized.length ===
        0
    ) {
        throw new ReconciliationRepositoryError(
            "tenantId is required.",
            "RECONCILIATION_TENANT_REQUIRED",
            400
        );
    }

    if (
        normalized.length >
        TENANT_ID_MAX_LENGTH
    ) {
        throw new ReconciliationRepositoryError(
            "tenantId exceeds the maximum permitted length.",
            "RECONCILIATION_TENANT_TOO_LONG",
            400
        );
    }

    if (
        !IDENTIFIER_REGEX.test(
            normalized
        )
    ) {
        throw new ReconciliationRepositoryError(
            "Invalid tenant identifier.",
            "RECONCILIATION_INVALID_TENANT",
            400
        );
    }

    if (
        typeof tenantConstants
            .isValidTenantId ===
        "function" &&
        !tenantConstants.isValidTenantId(
            normalized
        )
    ) {
        throw new ReconciliationRepositoryError(
            "Invalid TITech tenant identifier.",
            "RECONCILIATION_INVALID_TENANT",
            400
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * ObjectId Validation
 * ============================================================================
 */

function requireObjectId(
    id,
    field = "id"
) {
    if (
        !mongoose.Types.ObjectId.isValid(
            id
        )
    ) {
        throw new ReconciliationRepositoryError(
            `Invalid ${field}.`,
            "RECONCILIATION_INVALID_ID",
            400,
            {
                field
            }
        );
    }

    return new mongoose.Types.ObjectId(
        id
    );
}

/**
 * ============================================================================
 * Session
 * ============================================================================
 */

function getSession(
    options = {}
) {
    return options.session || null;
}

/**
 * ============================================================================
 * Pagination
 * ============================================================================
 */

function normalizePagination(
    page,
    limit
) {
    const parsedPage =
        Number(
            page
        );

    const parsedLimit =
        Number(
            limit
        );

    const normalizedPage =
        Number.isInteger(
            parsedPage
        ) &&
        parsedPage > 0
            ? parsedPage
            : DEFAULT_PAGE;

    const normalizedLimit =
        Number.isInteger(
            parsedLimit
        ) &&
        parsedLimit > 0
            ? Math.min(
                parsedLimit,
                MAX_LIMIT
            )
            : DEFAULT_LIMIT;

    return {
        page:
            normalizedPage,

        limit:
            normalizedLimit,

        skip:
            (
                normalizedPage -
                1
            ) *
            normalizedLimit
    };
}

/**
 * ============================================================================
 * Date Handling
 * ============================================================================
 */

function normalizeDate(
    value,
    field
) {
    if (
        value ===
            undefined ||
        value ===
            null ||
        value ===
            ""
    ) {
        return null;
    }

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
        throw new ReconciliationRepositoryError(
            `Invalid ${field}.`,
            "RECONCILIATION_INVALID_DATE",
            400,
            {
                field
            }
        );
    }

    return date;
}

function buildDateRange(
    startDate,
    endDate
) {
    const start =
        normalizeDate(
            startDate,
            "startDate"
        );

    const end =
        normalizeDate(
            endDate,
            "endDate"
        );

    if (
        start &&
        end &&
        start >
            end
    ) {
        throw new ReconciliationRepositoryError(
            "startDate must be earlier than or equal to endDate.",
            "RECONCILIATION_INVALID_DATE_RANGE",
            400
        );
    }

    if (
        !start &&
        !end
    ) {
        return null;
    }

    const result =
        {};

    if (
        start
    ) {
        result.$gte =
            start;
    }

    if (
        end
    ) {
        result.$lte =
            end;
    }

    return result;
}

/**
 * ============================================================================
 * Provider Validation
 * ============================================================================
 */

function normalizeProvider(
    provider
) {
    if (
        provider ===
            undefined ||
        provider ===
            null
    ) {
        return null;
    }

    const normalized =
        String(
            provider
        )
            .trim()
            .toUpperCase();

    if (
        normalized.length <
            2 ||
        normalized.length >
            64 ||
        !/^[A-Z0-9._:-]+$/.test(
            normalized
        )
    ) {
        throw new ReconciliationRepositoryError(
            "Invalid reconciliation provider.",
            "RECONCILIATION_INVALID_PROVIDER",
            400
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Status Validation
 * ============================================================================
 */

function normalizeStatus(
    status
) {
    if (
        status ===
            undefined ||
        status ===
            null
    ) {
        return null;
    }

    const normalized =
        String(
            status
        )
            .trim()
            .toUpperCase();

    if (
        !ALLOWED_STATUSES.includes(
            normalized
        )
    ) {
        throw new ReconciliationRepositoryError(
            "Invalid reconciliation status.",
            "RECONCILIATION_INVALID_STATUS",
            400,
            {
                status:
                    normalized
            }
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Sort
 * ============================================================================
 */

function normalizeSort(
    sort
) {
    if (
        !sort ||
        typeof sort !==
            "object" ||
        Array.isArray(
            sort
        )
    ) {
        return {
            createdAt:
                -1
        };
    }

    const result =
        {};

    for (
        const [
            field,
            direction
        ] of Object.entries(
            sort
        )
    ) {
        if (
            !ALLOWED_SORT_FIELDS.includes(
                field
            )
        ) {
            continue;
        }

        result[field] =
            direction ===
                1 ||
            String(
                direction
            ).toLowerCase() ===
                "asc"
                ? 1
                : -1;
    }

    return Object.keys(
        result
    ).length
        ? result
        : {
            createdAt:
                -1
        };
}

/**
 * ============================================================================
 * Tenant-Scoped Query
 * ============================================================================
 */

function buildTenantScopedQuery(
    tenantId,
    filters = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const safeFilters =
        isPlainObject(
            filters
        )
            ? {
                ...filters
            }
            : {};

    /**
     * These fields are authoritative and can never be supplied by callers.
     */
    delete safeFilters.tenantId;
    delete safeFilters.deleted;

    /**
     * Block MongoDB update/query operators at the top level.
     */
    for (
        const key of Object.keys(
            safeFilters
        )
    ) {
        if (
            key.startsWith(
                "$"
            )
        ) {
            throw new ReconciliationRepositoryError(
                "MongoDB operators are not permitted in reconciliation filters.",
                "RECONCILIATION_INVALID_FILTER",
                400
            );
        }
    }

    return {
        ...safeFilters,

        tenantId:
            normalizedTenantId,

        deleted:
            false
    };
}

/**
 * ============================================================================
 * Create Document
 * ============================================================================
 */

function buildCreateDocument(
    tenantId,
    payload = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    if (
        !isPlainObject(
            payload
        )
    ) {
        throw new ReconciliationRepositoryError(
            "Reconciliation payload must be an object.",
            "RECONCILIATION_INVALID_PAYLOAD",
            400
        );
    }

    const source =
        {
            ...payload
        };

    delete source._id;
    delete source.tenantId;
    delete source.deleted;
    delete source.deletedAt;
    delete source.createdAt;
    delete source.updatedAt;

    if (
        source.provider !==
        undefined
    ) {
        source.provider =
            normalizeProvider(
                source.provider
            );
    }

    if (
        source.status !==
        undefined
    ) {
        source.status =
            normalizeStatus(
                source.status
            );
    }

    const now =
        new Date();

    return {
        ...source,

        tenantId:
            normalizedTenantId,

        deleted:
            false,

        createdAt:
            now,

        updatedAt:
            now
    };
}

/**
 * ============================================================================
 * Update Sanitization
 * ============================================================================
 */

const BLOCKED_UPDATE_FIELDS =
    new Set([
        "_id",
        "tenantId",
        "deleted",
        "deletedAt",
        "createdAt"
    ]);

function sanitizeUpdates(
    updates
) {
    if (
        !isPlainObject(
            updates
        )
    ) {
        throw new ReconciliationRepositoryError(
            "Reconciliation updates must be an object.",
            "RECONCILIATION_INVALID_UPDATE",
            400
        );
    }

    const sanitized =
        {};

    for (
        const [
            key,
            value
        ] of Object.entries(
            updates
        )
    ) {
        if (
            BLOCKED_UPDATE_FIELDS.has(
                key
            )
        ) {
            continue;
        }

        if (
            key.startsWith(
                "$"
            ) ||
            key.includes(
                "."
            )
        ) {
            throw new ReconciliationRepositoryError(
                "Invalid reconciliation update field.",
                "RECONCILIATION_INVALID_UPDATE_FIELD",
                400,
                {
                    field:
                        key
                }
            );
        }

        sanitized[key] =
            value;
    }

    if (
        Object.prototype.hasOwnProperty.call(
            sanitized,
            "provider"
        )
    ) {
        sanitized.provider =
            normalizeProvider(
                sanitized.provider
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            sanitized,
            "status"
        )
    ) {
        sanitized.status =
            normalizeStatus(
                sanitized.status
            );
    }

    return sanitized;
}

/**
 * ============================================================================
 * CREATE
 * ============================================================================
 */

async function create(
    payload,
    options = {}
) {
    const tenantId =
        requireTenantId(
            payload?.tenantId
        );

    const document =
        buildCreateDocument(
            tenantId,
            payload
        );

    try {
        const [
            result
        ] =
            await this.model.create(
                [
                    document
                ],
                {
                    session:
                        getSession(
                            options
                        )
                }
            );

        return result;
    } catch (
        error
    ) {
        this.logError(
            "create",
            error,
            {
                tenantId
            }
        );

        throw translateRepositoryError(
            error,
            {
                operation:
                    "create",

                tenantId
            }
        );
    }
}

/**
 * ============================================================================
 * CREATE FOR TENANT
 * ============================================================================
 *
 * Preferred API where tenant identity is supplied separately from the payload.
 * ============================================================================
 */

async function createForTenant(
    tenantId,
    payload,
    options = {}
) {
    const document =
        buildCreateDocument(
            tenantId,
            payload
        );

    try {
        const [
            result
        ] =
            await this.model.create(
                [
                    document
                ],
                {
                    session:
                        getSession(
                            options
                        )
                }
            );

        return result;
    } catch (
        error
    ) {
        this.logError(
            "createForTenant",
            error,
            {
                tenantId
            }
        );

        throw translateRepositoryError(
            error,
            {
                operation:
                    "createForTenant",

                tenantId:
                    document.tenantId
            }
        );
    }
}

/**
 * ============================================================================
 * FIND BY ID
 * ============================================================================
 */

async function findById(
    tenantId,
    id,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const objectId =
        requireObjectId(
            id
        );

    const query =
        this.model.findOne(
            {
                _id:
                    objectId,

                tenantId:
                    normalizedTenantId,

                deleted:
                    false
            }
        );

    const session =
        getSession(
            options
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    return query
        .lean()
        .exec();
}

/**
 * ============================================================================
 * REQUIRE BY ID
 * ============================================================================
 */

async function requireById(
    tenantId,
    id,
    options = {}
) {
    const result =
        await this.findById(
            tenantId,
            id,
            options
        );

    if (
        !result
    ) {
        throw new ReconciliationRepositoryError(
            "Reconciliation record not found.",
            "RECONCILIATION_NOT_FOUND",
            404,
            {
                tenantId,
                id
            }
        );
    }

    return result;
}

/**
 * ============================================================================
 * FIND ONE
 * ============================================================================
 */

async function findOne(
    tenantId,
    query = {},
    options = {}
) {
    const filter =
        buildTenantScopedQuery(
            tenantId,
            query
        );

    const mongoQuery =
        this.model.findOne(
            filter
        );

    const session =
        getSession(
            options
        );

    if (
        session
    ) {
        mongoQuery.session(
            session
        );
    }

    return mongoQuery
        .lean()
        .exec();
}

/**
 * ============================================================================
 * SEARCH
 * ============================================================================
 */

async function search(
    tenantId,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const pagination =
        normalizePagination(
            options.page,
            options.limit
        );

    const query = {
        tenantId:
            normalizedTenantId,

        deleted:
            false
    };

    if (
        options.provider
    ) {
        query.provider =
            normalizeProvider(
                options.provider
            );
    }

    if (
        options.status
    ) {
        query.status =
            normalizeStatus(
                options.status
            );
    }

    if (
        typeof options.balanced ===
        "boolean"
    ) {
        query.isBalanced =
            options.balanced;
    }

    if (
        options.currency
    ) {
        query.currency =
            String(
                options.currency
            )
                .trim()
                .toUpperCase();
    }

    if (
        options.reconciliationType
    ) {
        query.reconciliationType =
            String(
                options.reconciliationType
            ).trim();
    }

    const dateRange =
        buildDateRange(
            options.startDate,
            options.endDate
        );

    if (
        dateRange
    ) {
        query.createdAt =
            dateRange;
    }

    if (
        options.reportDate
    ) {
        const reportDate =
            normalizeDate(
                options.reportDate,
                "reportDate"
            );

        query.reportDate =
            reportDate;
    }

    const sort =
        normalizeSort(
            options.sort
        );

    const session =
        getSession(
            options
        );

    const dataQuery =
        this.model
            .find(
                query
            )
            .skip(
                pagination.skip
            )
            .limit(
                pagination.limit
            )
            .sort(
                sort
            );

    const countQuery =
        this.model.countDocuments(
            query
        );

    if (
        session
    ) {
        dataQuery.session(
            session
        );

        countQuery.session(
            session
        );
    }

    const [
        data,
        total
    ] =
        await Promise.all([
            dataQuery
                .lean()
                .exec(),

            countQuery
                .exec()
        ]);

    return {
        data,

        pagination:
            {
                page:
                    pagination.page,

                limit:
                    pagination.limit,

                total,

                totalPages:
                    Math.ceil(
                        total /
                        pagination.limit
                    ),

                hasNextPage:
                    pagination.page *
                        pagination.limit <
                    total,

                hasPreviousPage:
                    pagination.page >
                    1
            }
    };
}

/**
 * ============================================================================
 * UPDATE BY ID
 * ============================================================================
 *
 * Supports optional optimistic concurrency:
 *
 *   options.expectedUpdatedAt
 * ============================================================================
 */

async function updateById(
    tenantId,
    id,
    updates,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const objectId =
        requireObjectId(
            id
        );

    const sanitized =
        sanitizeUpdates(
            updates
        );

    const filter = {
        _id:
            objectId,

        tenantId:
            normalizedTenantId,

        deleted:
            false
    };

    if (
        options.expectedUpdatedAt
    ) {
        filter.updatedAt =
            normalizeDate(
                options.expectedUpdatedAt,
                "expectedUpdatedAt"
            );
    }

    const setPayload =
        {
            ...sanitized,

            updatedAt:
                new Date()
        };

    if (
        options.updatedBy
    ) {
        setPayload.updatedBy =
            String(
                options.updatedBy
            ).slice(
                0,
                128
            );
    }

    try {
        const result =
            await this.model
                .findOneAndUpdate(
                    filter,
                    {
                        $set:
                            setPayload
                    },
                    {
                        new:
                            true,

                        runValidators:
                            true,

                        session:
                            getSession(
                                options
                            )
                    }
                )
                .lean()
                .exec();

        if (
            options.expectedUpdatedAt &&
            !result
        ) {
            const existing =
                await this.model
                    .findOne(
                        {
                            _id:
                                objectId,

                            tenantId:
                                normalizedTenantId,

                            deleted:
                                false
                        }
                    )
                    .select(
                        {
                            _id:
                                1
                        }
                    )
                    .session(
                        getSession(
                            options
                        ) || null
                    )
                    .lean()
                    .exec();

            if (
                existing
            ) {
                throw new ReconciliationRepositoryError(
                    "Reconciliation record was modified by another process.",
                    "RECONCILIATION_CONCURRENCY_CONFLICT",
                    409
                );
            }
        }

        return result;
    } catch (
        error
    ) {
        if (
            error instanceof
            ReconciliationRepositoryError
        ) {
            throw error;
        }

        this.logError(
            "updateById",
            error,
            {
                tenantId:
                    normalizedTenantId,

                id
            }
        );

        throw translateRepositoryError(
            error,
            {
                operation:
                    "updateById",

                tenantId:
                    normalizedTenantId,

                id
            }
        );
    }
}

/**
 * ============================================================================
 * MARK RECONCILED
 * ============================================================================
 */

async function markReconciled(
    tenantId,
    id,
    options = {}
) {
    return this.updateById(
        tenantId,
        id,
        {
            status:
                "RECONCILED",

            isBalanced:
                true,

            reconciledAt:
                new Date()
        },
        options
    );
}

/**
 * ============================================================================
 * MARK EXCEPTION
 * ============================================================================
 */

async function markException(
    tenantId,
    id,
    exceptionData = {},
    options = {}
) {
    return this.updateById(
        tenantId,
        id,
        {
            ...exceptionData,

            status:
                "EXCEPTION",

            isBalanced:
                false,

            exceptionAt:
                new Date()
        },
        options
    );
}

/**
 * ============================================================================
 * SOFT DELETE
 * ============================================================================
 */

async function deleteById(
    tenantId,
    id,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const objectId =
        requireObjectId(
            id
        );

    const filter = {
        _id:
            objectId,

        tenantId:
            normalizedTenantId,

        deleted:
            false
    };

    if (
        options.expectedUpdatedAt
    ) {
        filter.updatedAt =
            normalizeDate(
                options.expectedUpdatedAt,
                "expectedUpdatedAt"
            );
    }

    const now =
        new Date();

    const result =
        await this.model
            .findOneAndUpdate(
                filter,
                {
                    $set:
                        {
                            deleted:
                                true,

                            deletedAt:
                                now,

                            updatedAt:
                                now,

                            deletedBy:
                                options.deletedBy ||
                                null
                        }
                },
                {
                    new:
                        true,

                    session:
                        getSession(
                            options
                        )
                }
            )
            .lean()
            .exec();

    if (
        !result &&
        options.expectedUpdatedAt
    ) {
        throw new ReconciliationRepositoryError(
            "Reconciliation record was modified by another process or already deleted.",
            "RECONCILIATION_CONCURRENCY_CONFLICT",
            409
        );
    }

    return result;
}

/**
 * ============================================================================
 * RESTORE
 * ============================================================================
 */

async function restoreById(
    tenantId,
    id,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const objectId =
        requireObjectId(
            id
        );

    return this.model
        .findOneAndUpdate(
            {
                _id:
                    objectId,

                tenantId:
                    normalizedTenantId,

                deleted:
                    true
            },
            {
                $set:
                    {
                        deleted:
                            false,

                        deletedAt:
                            null,

                        updatedAt:
                            new Date(),

                        ...(options.updatedBy
                            ? {
                                updatedBy:
                                    options.updatedBy
                            }
                            : {})
                    }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    getSession(
                        options
                    )
            }
        )
        .lean()
        .exec();
}

/**
 * ============================================================================
 * DAILY REPORTS
 * ============================================================================
 */

async function findDailyReports(
    tenantId,
    date = new Date(),
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const sourceDate =
        normalizeDate(
            date,
            "date"
        ) ||
        new Date();

    const start =
        new Date(
            sourceDate
        );

    start.setHours(
        0,
        0,
        0,
        0
    );

    const end =
        new Date(
            sourceDate
        );

    end.setHours(
        23,
        59,
        59,
        999
    );

    const query =
        this.model
            .find(
                {
                    tenantId:
                        normalizedTenantId,

                    deleted:
                        false,

                    createdAt:
                        {
                            $gte:
                                start,

                            $lte:
                                end
                        }
                }
            )
            .sort(
                {
                    createdAt:
                        -1,

                    _id:
                        -1
                }
            );

    const session =
        getSession(
            options
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    return query
        .lean()
        .exec();
}

/**
 * ============================================================================
 * MONTHLY REPORTS
 * ============================================================================
 *
 * Uses an exclusive upper bound instead of 23:59:59.999, avoiding edge-case
 * precision issues around month boundaries.
 * ============================================================================
 */

async function findMonthlyReports(
    tenantId,
    year = new Date().getFullYear(),
    month = new Date().getMonth(),
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedYear =
        Number(
            year
        );

    const normalizedMonth =
        Number(
            month
        );

    if (
        !Number.isInteger(
            normalizedYear
        ) ||
        normalizedYear <
            1970 ||
        normalizedYear >
            9999
    ) {
        throw new ReconciliationRepositoryError(
            "Invalid report year.",
            "RECONCILIATION_INVALID_YEAR",
            400
        );
    }

    if (
        !Number.isInteger(
            normalizedMonth
        ) ||
        normalizedMonth <
            0 ||
        normalizedMonth >
            11
    ) {
        throw new ReconciliationRepositoryError(
            "Invalid report month.",
            "RECONCILIATION_INVALID_MONTH",
            400
        );
    }

    const start =
        new Date(
            normalizedYear,
            normalizedMonth,
            1
        );

    const end =
        new Date(
            normalizedYear,
            normalizedMonth + 1,
            1
        );

    const query =
        this.model
            .find(
                {
                    tenantId:
                        normalizedTenantId,

                    deleted:
                        false,

                    createdAt:
                        {
                            $gte:
                                start,

                            $lt:
                                end
                        }
                }
            )
            .sort(
                {
                    createdAt:
                        -1,

                    _id:
                        -1
                }
            );

    const session =
        getSession(
            options
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    return query
        .lean()
        .exec();
}

/**
 * ============================================================================
 * EXCEPTIONS
 * ============================================================================
 */

async function getExceptions(
    tenantId,
    options = {}
) {
    return this.search(
        tenantId,
        {
            ...options,

            balanced:
                false,

            status:
                options.status ||
                "EXCEPTION"
        }
    );
}

/**
 * ============================================================================
 * SUMMARY
 * ============================================================================
 */

async function getSummary(
    tenantId,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const base =
        {
            tenantId:
                normalizedTenantId,

            deleted:
                false
        };

    const queries = [
        this.model.countDocuments(
            base
        ),

        this.model.countDocuments(
            {
                ...base,

                isBalanced:
                    true
            }
        ),

        this.model.countDocuments(
            {
                ...base,

                isBalanced:
                    false
            }
        ),

        this.model.countDocuments(
            {
                ...base,

                status:
                    {
                        $in:
                            [
                                "RECONCILED"
                            ]
                    }
            }
        ),

        this.model.countDocuments(
            {
                ...base,

                status:
                    {
                        $in:
                            [
                                "EXCEPTION",
                                "FAILED"
                            ]
                    }
            }
        )
    ];

    const session =
        getSession(
            options
        );

    if (
        session
    ) {
        queries.forEach(
            query =>
                query.session(
                    session
                )
        );
    }

    const [
        totalReports,
        balancedReports,
        exceptionReports,
        reconciledReports,
        failedReports
    ] =
        await Promise.all(
            queries.map(
                query =>
                    query.exec()
            )
        );

    return {
        totalReports,

        balancedReports,

        exceptionReports,

        reconciledReports,

        failedReports,

        unreconciledReports:
            Math.max(
                totalReports -
                reconciledReports,
                0
            )
    };
}

/**
 * ============================================================================
 * PROVIDER REPORTS
 * ============================================================================
 */

async function getProviderReports(
    tenantId,
    provider,
    options = {}
) {
    const normalizedProvider =
        normalizeProvider(
            provider
        );

    if (
        !normalizedProvider
    ) {
        throw new ReconciliationRepositoryError(
            "provider is required.",
            "RECONCILIATION_PROVIDER_REQUIRED",
            400
        );
    }

    const query =
        this.model
            .find(
                {
                    tenantId:
                        requireTenantId(
                            tenantId
                        ),

                    provider:
                        normalizedProvider,

                    deleted:
                        false
                }
            )
            .sort(
                {
                    createdAt:
                        -1,

                    _id:
                        -1
                }
            );

    const session =
        getSession(
            options
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    return query
        .lean()
        .exec();
}

/**
 * ============================================================================
 * PROVIDER SUMMARY
 * ============================================================================
 */

async function getProviderSummary(
    tenantId,
    provider,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedProvider =
        normalizeProvider(
            provider
        );

    const base =
        {
            tenantId:
                normalizedTenantId,

            provider:
                normalizedProvider,

            deleted:
                false
        };

    const session =
        getSession(
            options
        );

    const pipeline =
        [
            {
                $match:
                    base
            },

            {
                $group:
                    {
                        _id:
                            null,

                        total:
                            {
                                $sum:
                                    1
                            },

                        balanced:
                            {
                                $sum:
                                    {
                                        $cond:
                                            [
                                                {
                                                    $eq:
                                                        [
                                                            "$isBalanced",
                                                            true
                                                        ]
                                                },
                                                1,
                                                0
                                            ]
                                    }
                            },

                        exceptions:
                            {
                                $sum:
                                    {
                                        $cond:
                                            [
                                                {
                                                    $eq:
                                                        [
                                                            "$isBalanced",
                                                            false
                                                        ]
                                                },
                                                1,
                                                0
                                            ]
                                    }
                            }
                    }
            }
        ];

    const aggregate =
        this.model.aggregate(
            pipeline
        );

    if (
        session &&
        typeof aggregate.session ===
            "function"
    ) {
        aggregate.session(
            session
        );
    }

    const [
        summary
    ] =
        await aggregate.exec();

    return {
        provider:
            normalizedProvider,

        total:
            summary?.total ||
            0,

        balanced:
            summary?.balanced ||
            0,

        exceptions:
            summary?.exceptions ||
            0
    };
}

/**
 * ============================================================================
 * BULK UPDATE
 * ============================================================================
 */

async function bulkUpdate(
    tenantId,
    filter = {},
    updates = {},
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const scopedFilter =
        buildTenantScopedQuery(
            normalizedTenantId,
            filter
        );

    const sanitizedUpdates =
        sanitizeUpdates(
            updates
        );

    const maximum =
        Math.min(
            Math.max(
                Number(
                    options.maxDocuments
                ) || MAX_BULK_UPDATE,
                1
            ),
            MAX_BULK_UPDATE
        );

    if (
        options.enforceMax !==
        false
    ) {
        const sample =
            await this.model
                .find(
                    scopedFilter
                )
                .select(
                    {
                        _id:
                            1
                    }
                )
                .limit(
                    maximum + 1
                )
                .session(
                    getSession(
                        options
                    ) ||
                    null
                )
                .lean()
                .exec();

        if (
            sample.length >
            maximum
        ) {
            throw new ReconciliationRepositoryError(
                `Bulk reconciliation update exceeds the configured maximum of ${maximum} documents.`,
                "RECONCILIATION_BULK_UPDATE_TOO_LARGE",
                400
            );
        }
    }

    return this.model.updateMany(
        scopedFilter,
        {
            $set:
                {
                    ...sanitizedUpdates,

                    updatedAt:
                        new Date()
                }
        },
        {
            session:
                getSession(
                    options
                )
        }
    );
}

/**
 * ============================================================================
 * EXISTS
 * ============================================================================
 */

async function exists(
    tenantId,
    query = {},
    options = {}
) {
    const scopedQuery =
        buildTenantScopedQuery(
            tenantId,
            query
        );

    const result =
        this.model.exists(
            scopedQuery
        );

    const session =
        getSession(
            options
        );

    if (
        session &&
        typeof result.session ===
            "function"
    ) {
        result.session(
            session
        );
    }

    return Boolean(
        await result.exec()
    );
}

/**
 * ============================================================================
 * COUNT
 * ============================================================================
 */

async function count(
    tenantId,
    query = {},
    options = {}
) {
    const scopedQuery =
        buildTenantScopedQuery(
            tenantId,
            query
        );

    const result =
        this.model.countDocuments(
            scopedQuery
        );

    const session =
        getSession(
            options
        );

    if (
        session &&
        typeof result.session ===
            "function"
    ) {
        result.session(
            session
        );
    }

    return result.exec();
}

/**
 * ============================================================================
 * CREATE WITH SESSION
 * ============================================================================
 */

async function createWithSession(
    payload,
    session
) {
    if (
        !session
    ) {
        throw new ReconciliationRepositoryError(
            "MongoDB session is required.",
            "RECONCILIATION_SESSION_REQUIRED",
            500
        );
    }

    if (
        !payload?.tenantId
    ) {
        throw new ReconciliationRepositoryError(
            "tenantId is required.",
            "RECONCILIATION_TENANT_REQUIRED",
            400
        );
    }

    return this.create(
        payload,
        {
            session
        }
    );
}

/**
 * ============================================================================
 * DAILY SUMMARY
 * ============================================================================
 */

async function getDailySummary(
    tenantId,
    date = new Date(),
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const sourceDate =
        normalizeDate(
            date,
            "date"
        ) ||
        new Date();

    const start =
        new Date(
            sourceDate
        );

    start.setHours(
        0,
        0,
        0,
        0
    );

    const end =
        new Date(
            sourceDate
        );

    end.setDate(
        end.getDate() + 1
    );

    end.setHours(
        0,
        0,
        0,
        0
    );

    const match =
        {
            tenantId:
                normalizedTenantId,

            deleted:
                false,

            createdAt:
                {
                    $gte:
                        start,

                    $lt:
                        end
                }
        };

    const pipeline =
        [
            {
                $match:
                    match
            },

            {
                $group:
                    {
                        _id:
                            null,

                        total:
                            {
                                $sum:
                                    1
                            },

                        balanced:
                            {
                                $sum:
                                    {
                                        $cond:
                                            [
                                                {
                                                    $eq:
                                                        [
                                                            "$isBalanced",
                                                            true
                                                        ]
                                                },
                                                1,
                                                0
                                            ]
                                    }
                            },

                        exceptions:
                            {
                                $sum:
                                    {
                                        $cond:
                                            [
                                                {
                                                    $eq:
                                                        [
                                                            "$isBalanced",
                                                            false
                                                        ]
                                                },
                                                1,
                                                0
                                            ]
                                    }
                            }
                    }
            }
        ];

    const aggregate =
        this.model.aggregate(
            pipeline
        );

    const session =
        getSession(
            options
        );

    if (
        session &&
        typeof aggregate.session ===
            "function"
    ) {
        aggregate.session(
            session
        );
    }

    const [
        result
    ] =
        await aggregate.exec();

    return {
        date:
            start.toISOString()
                .slice(
                    0,
                    10
                ),

        total:
            result?.total ||
            0,

        balanced:
            result?.balanced ||
            0,

        exceptions:
            result?.exceptions ||
            0
    };
}

/**
 * ============================================================================
 * HEALTH METRICS
 * ============================================================================
 */

async function getHealthMetrics(
    tenantId,
    options = {}
) {
    const summary =
        await this.getSummary(
            tenantId,
            options
        );

    const total =
        summary.totalReports;

    const successRate =
        total ===
            0
            ? 100
            : (
                summary.balancedReports /
                total
            ) *
            100;

    return {
        ...summary,

        successRate:
            Number(
                successRate.toFixed(
                    2
                )
            )
    };
}

/**
 * ============================================================================
 * LOGGING
 * ============================================================================
 */

function logError(
    method,
    error,
    metadata = {}
) {
    try {
        if (
            logger &&
            typeof logger.error ===
                "function"
        ) {
            logger.error(
                `TITech ReconciliationRepository.${method} failed`,
                {
                    ...metadata,

                    error:
                        error?.message,

                    code:
                        error?.code,

                    stack:
                        error?.stack
                }
            );

            return;
        }
    } catch {
        // Fall through.
    }

    console.error(
        `TITech ReconciliationRepository.${method} failed`,
        {
            ...metadata,

            error:
                error?.message
        }
    );
}

/**
 * ============================================================================
 * Error Translation
 * ============================================================================
 */

function translateRepositoryError(
    error,
    context = {}
) {
    if (
        error instanceof
        ReconciliationRepositoryError
    ) {
        return error;
    }

    if (
        error?.code ===
        11000
    ) {
        return new ReconciliationRepositoryError(
            "Reconciliation record already exists.",
            "RECONCILIATION_RECORD_ALREADY_EXISTS",
            409,
            {
                tenantId:
                    context.tenantId,

                keyPattern:
                    error?.keyPattern
            }
        );
    }

    if (
        error?.name ===
        "ValidationError"
    ) {
        return new ReconciliationRepositoryError(
            "Reconciliation model validation failed.",
            "RECONCILIATION_MODEL_VALIDATION_FAILED",
            400,
            {
                errors:
                    sanitizeValidationErrors(
                        error
                    )
            }
        );
    }

    if (
        error?.name ===
        "CastError"
    ) {
        return new ReconciliationRepositoryError(
            "Invalid MongoDB value supplied to reconciliation repository.",
            "RECONCILIATION_MONGO_CAST_ERROR",
            400
        );
    }

    if (
        error?.hasErrorLabel?.(
            "TransientTransactionError"
        ) ||
        error?.hasErrorLabel?.(
            "UnknownTransactionCommitResult"
        )
    ) {
        return error;
    }

    return error;
}

/**
 * ============================================================================
 * Validation Error Sanitization
 * ============================================================================
 */

function sanitizeValidationErrors(
    error
) {
    const result =
        {};

    if (
        !error?.errors
    ) {
        return result;
    }

    for (
        const [
            field,
            detail
        ] of Object.entries(
            error.errors
        )
    ) {
        result[field] =
            detail?.message ||
            "Validation failed";
    }

    return result;
}

/**
 * ============================================================================
 * Utility
 * ============================================================================
 */

function isPlainObject(
    value
) {
    return (
        value !==
            null &&
        typeof value ===
            "object" &&
        !Array.isArray(
            value
        )
    );
}

/**
 * ============================================================================
 * Class
 * ============================================================================
 */

class ReconciliationRepository {

    constructor(
        ReconciliationModel
    ) {
        if (
            !ReconciliationModel
        ) {
            throw new ReconciliationRepositoryError(
                "ReconciliationModel is required.",
                "RECONCILIATION_MODEL_REQUIRED",
                500
            );
        }

        this.model =
            ReconciliationModel;
    }

    create(
        payload,
        options
    ) {
        return create.call(
            this,
            payload,
            options
        );
    }

    createForTenant(
        tenantId,
        payload,
        options
    ) {
        return createForTenant.call(
            this,
            tenantId,
            payload,
            options
        );
    }

    findById(
        tenantId,
        id,
        options
    ) {
        return findById.call(
            this,
            tenantId,
            id,
            options
        );
    }

    requireById(
        tenantId,
        id,
        options
    ) {
        return requireById.call(
            this,
            tenantId,
            id,
            options
        );
    }

    findOne(
        tenantId,
        query,
        options
    ) {
        return findOne.call(
            this,
            tenantId,
            query,
            options
        );
    }

    search(
        tenantId,
        options
    ) {
        return search.call(
            this,
            tenantId,
            options
        );
    }

    updateById(
        tenantId,
        id,
        updates,
        options
    ) {
        return updateById.call(
            this,
            tenantId,
            id,
            updates,
            options
        );
    }

    markReconciled(
        tenantId,
        id,
        options
    ) {
        return markReconciled.call(
            this,
            tenantId,
            id,
            options
        );
    }

    markException(
        tenantId,
        id,
        exceptionData,
        options
    ) {
        return markException.call(
            this,
            tenantId,
            id,
            exceptionData,
            options
        );
    }

    deleteById(
        tenantId,
        id,
        options
    ) {
        return deleteById.call(
            this,
            tenantId,
            id,
            options
        );
    }

    restoreById(
        tenantId,
        id,
        options
    ) {
        return restoreById.call(
            this,
            tenantId,
            id,
            options
        );
    }

    findDailyReports(
        tenantId,
        date,
        options
    ) {
        return findDailyReports.call(
            this,
            tenantId,
            date,
            options
        );
    }

    findMonthlyReports(
        tenantId,
        year,
        month,
        options
    ) {
        return findMonthlyReports.call(
            this,
            tenantId,
            year,
            month,
            options
        );
    }

    getExceptions(
        tenantId,
        options
    ) {
        return getExceptions.call(
            this,
            tenantId,
            options
        );
    }

    getSummary(
        tenantId,
        options
    ) {
        return getSummary.call(
            this,
            tenantId,
            options
        );
    }

    getProviderReports(
        tenantId,
        provider,
        options
    ) {
        return getProviderReports.call(
            this,
            tenantId,
            provider,
            options
        );
    }

    getProviderSummary(
        tenantId,
        provider,
        options
    ) {
        return getProviderSummary.call(
            this,
            tenantId,
            provider,
            options
        );
    }

    bulkUpdate(
        tenantId,
        filter,
        updates,
        options
    ) {
        return bulkUpdate.call(
            this,
            tenantId,
            filter,
            updates,
            options
        );
    }

    exists(
        tenantId,
        query,
        options
    ) {
        return exists.call(
            this,
            tenantId,
            query,
            options
        );
    }

    count(
        tenantId,
        query,
        options
    ) {
        return count.call(
            this,
            tenantId,
            query,
            options
        );
    }

    createWithSession(
        payload,
        session
    ) {
        return createWithSession.call(
            this,
            payload,
            session
        );
    }

    getDailySummary(
        tenantId,
        date,
        options
    ) {
        return getDailySummary.call(
            this,
            tenantId,
            date,
            options
        );
    }

    getHealthMetrics(
        tenantId,
        options
    ) {
        return getHealthMetrics.call(
            this,
            tenantId,
            options
        );
    }

    logError(
        method,
        error,
        metadata
    ) {
        logError(
            method,
            error,
            metadata
        );
    }
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    ReconciliationRepository;

module.exports.ReconciliationRepository =
    ReconciliationRepository;

module.exports.ReconciliationRepositoryError =
    ReconciliationRepositoryError;