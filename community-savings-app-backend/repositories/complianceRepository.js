"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Compliance Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/complianceRepository.js
 *
 * Purpose:
 *   Enterprise persistence boundary for compliance-domain records.
 *
 * Supported compliance domains:
 *
 *   ✓ AML cases
 *   ✓ Fraud cases
 *   ✓ Sanctions screening matches
 *   ✓ PEP screening matches
 *   ✓ High-risk cases
 *   ✓ Compliance investigations
 *   ✓ Compliance lifecycle persistence
 *
 * ============================================================================
 * ARCHITECTURAL RESPONSIBILITIES
 * ============================================================================
 *
 * ✓ Tenant isolation at the persistence boundary.
 * ✓ Session-aware MongoDB reads/writes.
 * ✓ Soft deletion.
 * ✓ Controlled updates.
 * ✓ Pagination and filtered search.
 * ✓ Compliance metrics.
 * ✓ Specialized AML/Fraud/Sanctions/PEP queries.
 * ✓ Optimistic concurrency support where requested.
 * ✓ Safe query construction.
 * ✓ Structured error handling.
 * ✓ Bulk updates with tenant scoping.
 *
 * ============================================================================
 * ARCHITECTURAL NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Does not make AML decisions.
 * ✗ Does not calculate risk scores.
 * ✗ Does not perform sanctions screening.
 * ✗ Does not determine fraud.
 * ✗ Does not authorize compliance actions.
 * ✗ Does not own workflow orchestration.
 * ✗ Does not start/commit/abort MongoDB transactions.
 *
 * Business logic belongs in:
 *
 *   backend/services/compliance.service.js
 *
 * ============================================================================
 * TENANT SECURITY
 * ============================================================================
 *
 * Every normal repository operation requires tenantId.
 *
 * The repository deliberately rejects malformed tenant identifiers rather than
 * silently transforming them.
 *
 * ============================================================================
 * TITech TERMINOLOGY
 * ============================================================================
 *
 * All legacy ACFOS terminology has been replaced with TITech terminology.
 *
 * ============================================================================
 */

const mongoose =
    require("mongoose");

const ComplianceModel =
    require(
        "../models/Compliance"
    );

const tenantConstants =
    require(
        "../tenancy/tenant.constants"
    );

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    20;

const MAX_LIMIT =
    200;

const MAX_BULK_UPDATE =
    5000;

const MAX_SEARCH_TEXT_LENGTH =
    200;

const MAX_METADATA_KEYS =
    100;

const TENANT_ID_MAX_LENGTH =
    64;

const IDENTIFIER_REGEX =
    /^[a-zA-Z0-9._:-]+$/;

/**
 * ============================================================================
 * Repository Error
 * ============================================================================
 */

class ComplianceRepositoryError
    extends Error {

    constructor(
        message,
        code = "COMPLIANCE_REPOSITORY_ERROR",
        statusCode = 500,
        details = undefined
    ) {
        super(message);

        this.name =
            "ComplianceRepositoryError";

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
            ComplianceRepositoryError
        );
    }
}

/**
 * ============================================================================
 * Optional Logger Resolution
 * ============================================================================
 *
 * Supports the project's structured logger while preserving startup
 * compatibility if the logging implementation exports differently.
 * ============================================================================
 */

let logger;

try {
    logger =
        require(
            "../infrastructure/logging/logger"
        );
} catch {
    logger =
        console;
}

/**
 * ============================================================================
 * Utility: require tenant ID
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
        throw new ComplianceRepositoryError(
            "tenantId is required.",
            "COMPLIANCE_TENANT_REQUIRED",
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
        !normalized
    ) {
        throw new ComplianceRepositoryError(
            "tenantId is required.",
            "COMPLIANCE_TENANT_REQUIRED",
            400
        );
    }

    if (
        normalized.length >
        TENANT_ID_MAX_LENGTH
    ) {
        throw new ComplianceRepositoryError(
            "tenantId is too long.",
            "COMPLIANCE_TENANT_TOO_LONG",
            400
        );
    }

    if (
        !IDENTIFIER_REGEX.test(
            normalized
        )
    ) {
        throw new ComplianceRepositoryError(
            "Invalid tenant identifier.",
            "COMPLIANCE_INVALID_TENANT",
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
        throw new ComplianceRepositoryError(
            "Invalid TITech tenant identifier.",
            "COMPLIANCE_INVALID_TENANT",
            400
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Utility: require MongoDB ObjectId
 * ============================================================================
 */

function normalizeObjectId(
    id,
    field = "id"
) {
    if (
        !mongoose.Types.ObjectId.isValid(
            id
        )
    ) {
        throw new ComplianceRepositoryError(
            `Invalid ${field}.`,
            "COMPLIANCE_INVALID_ID",
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
 * Session Helper
 * ============================================================================
 */

function getSession(
    options = {}
) {
    return options.session || null;
}

/**
 * ============================================================================
 * Safe Pagination
 * ============================================================================
 */

function normalizePagination(
    page,
    limit
) {
    const normalizedPage =
        Number.isInteger(
            Number(page)
        ) &&
        Number(page) > 0
            ? Number(page)
            : DEFAULT_PAGE;

    const normalizedLimit =
        Number.isInteger(
            Number(limit)
        ) &&
        Number(limit) > 0
            ? Math.min(
                Number(limit),
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
 * Date Normalization
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
        throw new ComplianceRepositoryError(
            `Invalid ${field}.`,
            "COMPLIANCE_INVALID_DATE",
            400,
            {
                field
            }
        );
    }

    return date;
}

/**
 * ============================================================================
 * Date Range
 * ============================================================================
 */

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
        throw new ComplianceRepositoryError(
            "startDate must be earlier than or equal to endDate.",
            "COMPLIANCE_INVALID_DATE_RANGE",
            400
        );
    }

    if (
        !start &&
        !end
    ) {
        return null;
    }

    const range =
        {};

    if (
        start
    ) {
        range.$gte =
            start;
    }

    if (
        end
    ) {
        range.$lte =
            end;
    }

    return range;
}

/**
 * ============================================================================
 * Metadata Sanitization
 * ============================================================================
 */

function normalizeMetadata(
    metadata
) {
    if (
        metadata ===
            undefined ||
        metadata ===
            null
    ) {
        return {};
    }

    if (
        typeof metadata !==
            "object" ||
        Array.isArray(
            metadata
        )
    ) {
        throw new ComplianceRepositoryError(
            "Compliance metadata must be an object.",
            "COMPLIANCE_INVALID_METADATA",
            400
        );
    }

    const keys =
        Object.keys(
            metadata
        );

    if (
        keys.length >
        MAX_METADATA_KEYS
    ) {
        throw new ComplianceRepositoryError(
            "Compliance metadata contains too many fields.",
            "COMPLIANCE_METADATA_TOO_LARGE",
            400
        );
    }

    return deepClone(
        metadata
    );
}

/**
 * ============================================================================
 * Search Text
 * ============================================================================
 */

function normalizeSearchText(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    const text =
        String(
            value
        )
            .trim()
            .slice(
                0,
                MAX_SEARCH_TEXT_LENGTH
            );

    return text || null;
}

/**
 * ============================================================================
 * Sort Normalization
 * ============================================================================
 *
 * Prevents arbitrary client-controlled Mongo sort expressions from being
 * passed through without restriction.
 * ============================================================================
 */

const ALLOWED_SORT_FIELDS =
    Object.freeze([
        "createdAt",
        "updatedAt",
        "status",
        "riskLevel",
        "category",
        "type",
        "closedAt"
    ]);

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
    ).length >
        0
        ? result
        : {
            createdAt:
                -1
        };
}

/**
 * ============================================================================
 * Query Sanitization
 * ============================================================================
 *
 * Prevents tenant scope and soft-delete constraints from being overwritten by
 * caller-supplied objects.
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

    delete safeFilters.tenantId;
    delete safeFilters.deleted;

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
 * Create Payload
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

    const source =
        isPlainObject(
            payload
        )
            ? {
                ...payload
            }
            : {};

    /**
     * Never allow callers to override repository-managed fields.
     */
    delete source._id;
    delete source.tenantId;
    delete source.deleted;
    delete source.deletedAt;
    delete source.createdAt;
    delete source.updatedAt;

    if (
        source.metadata !==
            undefined
    ) {
        source.metadata =
            normalizeMetadata(
                source.metadata
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
        throw new ComplianceRepositoryError(
            "Compliance updates must be an object.",
            "COMPLIANCE_INVALID_UPDATE",
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
            throw new ComplianceRepositoryError(
                "Invalid compliance update field.",
                "COMPLIANCE_INVALID_UPDATE_FIELD",
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
            "metadata"
        )
    ) {
        sanitized.metadata =
            normalizeMetadata(
                sanitized.metadata
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

        return result.toObject();
    } catch (
        error
    ) {
        this.logError(
            "create",
            error,
            {
                tenantId:
                    document.tenantId
            }
        );

        throw translateRepositoryError(
            error,
            {
                operation:
                    "create",

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
        normalizeObjectId(
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
        throw new ComplianceRepositoryError(
            "Compliance record not found.",
            "COMPLIANCE_NOT_FOUND",
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
 * FIND MANY
 * ============================================================================
 */

async function find(
    tenantId,
    filters = {},
    options = {}
) {
    const query =
        buildTenantScopedQuery(
            tenantId,
            filters
        );

    const mongoQuery =
        this.model
            .find(
                query
            )
            .sort(
                normalizeSort(
                    options.sort
                )
            );

    if (
        options.limit !==
            undefined
    ) {
        const limit =
            Math.min(
                Math.max(
                    Number(
                        options.limit
                    ) || DEFAULT_LIMIT,
                    1
                ),
                MAX_LIMIT
            );

        mongoQuery.limit(
            limit
        );
    }

    if (
        options.skip !==
            undefined
    ) {
        mongoQuery.skip(
            Math.max(
                Number(
                    options.skip
                ) || 0,
                0
            )
        );
    }

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

    const {
        page,
        limit,
        status,
        category,
        riskLevel,
        type,
        startDate,
        endDate,
        searchText
    } =
        options;

    const pagination =
        normalizePagination(
            page,
            limit
        );

    const query = {
        tenantId:
            normalizedTenantId,

        deleted:
            false
    };

    if (
        status
    ) {
        query.status =
            status;
    }

    if (
        category
    ) {
        query.category =
            category;
    }

    if (
        riskLevel
    ) {
        query.riskLevel =
            riskLevel;
    }

    if (
        type
    ) {
        query.type =
            type;
    }

    const dateRange =
        buildDateRange(
            startDate,
            endDate
        );

    if (
        dateRange
    ) {
        query.createdAt =
            dateRange;
    }

    const normalizedSearchText =
        normalizeSearchText(
            searchText
        );

    if (
        normalizedSearchText
    ) {
        /**
         * Prefer a configured text index if the Compliance model defines one.
         * The regex fallback is deliberately bounded by the normalized query
         * length.
         */
        query.$or = [
            {
                caseId: {
                    $regex:
                        escapeRegex(
                            normalizedSearchText
                        ),
                    $options:
                        "i"
                }
            },
            {
                reference: {
                    $regex:
                        escapeRegex(
                            normalizedSearchText
                        ),
                    $options:
                        "i"
                }
            },
            {
                description: {
                    $regex:
                        escapeRegex(
                            normalizedSearchText
                        ),
                    $options:
                        "i"
                }
            }
        ];
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

        pagination: {
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
 * Supports optimistic concurrency through:
 *
 *   options.expectedUpdatedAt
 *
 * When supplied, the update only succeeds when the current record still has
 * the expected timestamp.
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
        normalizeObjectId(
            id
        );

    const sanitized =
        sanitizeUpdates(
            updates
        );

    const expectedUpdatedAt =
        normalizeDate(
            options.expectedUpdatedAt,
            "expectedUpdatedAt"
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
        expectedUpdatedAt
    ) {
        filter.updatedAt =
            expectedUpdatedAt;
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
        const query =
            this.model.findOneAndUpdate(
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
            );

        const result =
            await query
                .lean()
                .exec();

        if (
            expectedUpdatedAt &&
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
                throw new ComplianceRepositoryError(
                    "Compliance record was modified by another process.",
                    "COMPLIANCE_CONCURRENCY_CONFLICT",
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
            ComplianceRepositoryError
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
 * CLOSE CASE
 * ============================================================================
 */

async function closeById(
    tenantId,
    id,
    data = {},
    options = {}
) {
    return this.updateById(
        tenantId,
        id,
        {
            ...data,

            status:
                "CLOSED",

            closedAt:
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
        normalizeObjectId(
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

    const update =
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
        };

    const query =
        this.model.findOneAndUpdate(
            filter,
            update,
            {
                new:
                    true,

                session:
                    getSession(
                        options
                    )
            }
        );

    const result =
        await query
            .lean()
            .exec();

    if (
        !result &&
        options.expectedUpdatedAt
    ) {
        throw new ComplianceRepositoryError(
            "Compliance record was modified by another process or has already been deleted.",
            "COMPLIANCE_CONCURRENCY_CONFLICT",
            409
        );
    }

    return result;
}

/**
 * ============================================================================
 * RESTORE
 * ============================================================================
 *
 * Explicit recovery operation.
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
        normalizeObjectId(
            id
        );

    const result =
        await this.model
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

    return result;
}

/**
 * ============================================================================
 * SPECIALIZED AML QUERIES
 * ============================================================================
 */

async function getAmlCases(
    tenantId,
    options = {}
) {
    return this.find(
        tenantId,
        {
            category:
                "AML"
        },
        options
    );
}

/**
 * ============================================================================
 * SPECIALIZED FRAUD QUERIES
 * ============================================================================
 */

async function getFraudCases(
    tenantId,
    options = {}
) {
    return this.find(
        tenantId,
        {
            category:
                "FRAUD"
        },
        options
    );
}

/**
 * ============================================================================
 * HIGH-RISK CASES
 * ============================================================================
 */

async function getHighRiskCases(
    tenantId,
    options = {}
) {
    return this.find(
        tenantId,
        {
            riskLevel:
                {
                    $in:
                        [
                            "HIGH",
                            "CRITICAL"
                        ]
                }
        },
        options
    );
}

/**
 * ============================================================================
 * SANCTIONS MATCHES
 * ============================================================================
 */

async function getSanctionsMatches(
    tenantId,
    options = {}
) {
    return this.find(
        tenantId,
        {
            type:
                "SANCTIONS_MATCH"
        },
        options
    );
}

/**
 * ============================================================================
 * PEP MATCHES
 * ============================================================================
 */

async function getPepMatches(
    tenantId,
    options = {}
) {
    return this.find(
        tenantId,
        {
            type:
                "PEP_MATCH"
        },
        options
    );
}

/**
 * ============================================================================
 * OPEN CASES
 * ============================================================================
 */

async function getOpenCases(
    tenantId,
    options = {}
) {
    return this.find(
        tenantId,
        {
            status:
                "OPEN"
        },
        options
    );
}

/**
 * ============================================================================
 * COMPLIANCE METRICS
 * ============================================================================
 */

async function getComplianceMetrics(
    tenantId,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const session =
        getSession(
            options
        );

    const base =
        {
            tenantId:
                normalizedTenantId,

            deleted:
                false
        };

    const queries = [
        this.model
            .countDocuments(
                base
            ),

        this.model
            .countDocuments(
                {
                    ...base,

                    category:
                        "AML"
                }
            ),

        this.model
            .countDocuments(
                {
                    ...base,

                    category:
                        "FRAUD"
                }
            ),

        this.model
            .countDocuments(
                {
                    ...base,

                    riskLevel:
                        {
                            $in:
                                [
                                    "HIGH",
                                    "CRITICAL"
                                ]
                        }
            }
        ),

        this.model
            .countDocuments(
                {
                    ...base,

                    status:
                        "OPEN"
                }
            ),

        this.model
            .countDocuments(
                {
                    ...base,

                    type:
                        "SANCTIONS_MATCH"
                }
            ),

        this.model
            .countDocuments(
                {
                    ...base,

                    type:
                        "PEP_MATCH"
                }
            )
    ];

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
        totalCases,
        amlCases,
        fraudCases,
        highRiskCases,
        openCases,
        sanctionsMatches,
        pepMatches
    ] =
        await Promise.all(
            queries.map(
                query =>
                    query.exec()
            )
        );

    return {
        tenantId:
            normalizedTenantId,

        totalCases,

        amlCases,

        fraudCases,

        highRiskCases,

        openCases,

        sanctionsMatches,

        pepMatches
    };
}

/**
 * ============================================================================
 * BULK UPDATE
 * ============================================================================
 *
 * Caller-provided filter cannot override tenant scope or soft-deletion scope.
 *
 * For large updates, the service layer should consider batching or background
 * jobs instead of one unbounded updateMany().
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

    const sanitizedFilter =
        buildTenantScopedQuery(
            normalizedTenantId,
            filter
        );

    const sanitizedUpdates =
        sanitizeUpdates(
            updates
        );

    const update =
        {
            $set:
                {
                    ...sanitizedUpdates,

                    updatedAt:
                        new Date()
                }
        };

    const session =
        getSession(
            options
        );

    /**
     * Optional safety limit.
     *
     * The limit is enforced by first obtaining IDs when explicitly enabled.
     */
    if (
        options.maxDocuments
    ) {
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

        const ids =
            await this.model
                .find(
                    sanitizedFilter
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
                    session ||
                    null
                )
                .lean()
                .exec();

        if (
            ids.length >
            maximum
        ) {
            throw new ComplianceRepositoryError(
                `Bulk update exceeds the configured maximum of ${maximum} records.`,
                "COMPLIANCE_BULK_UPDATE_TOO_LARGE",
                400
            );
        }
    }

    return this.model.updateMany(
        sanitizedFilter,
        update,
        {
            session
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
    const filter =
        buildTenantScopedQuery(
            tenantId,
            query
        );

    const queryBuilder =
        this.model.exists(
            filter
        );

    const session =
        getSession(
            options
        );

    if (
        session &&
        typeof queryBuilder.session ===
            "function"
    ) {
        queryBuilder.session(
            session
        );
    }

    const result =
        await queryBuilder.exec();

    return Boolean(
        result
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
    const filter =
        buildTenantScopedQuery(
            tenantId,
            query
        );

    const queryBuilder =
        this.model.countDocuments(
            filter
        );

    const session =
        getSession(
            options
        );

    if (
        session &&
        typeof queryBuilder.session ===
            "function"
    ) {
        queryBuilder.session(
            session
        );
    }

    return queryBuilder.exec();
}

/**
 * ============================================================================
 * CREATE WITH SESSION
 * ============================================================================
 */

async function createWithSession(
    tenantId,
    payload,
    session
) {
    if (
        !session
    ) {
        throw new ComplianceRepositoryError(
            "MongoDB session is required.",
            "COMPLIANCE_SESSION_REQUIRED",
            500
        );
    }

    return this.create(
        tenantId,
        payload,
        {
            session
        }
    );
}

/**
 * ============================================================================
 * CASE STATISTICS BY STATUS
 * ============================================================================
 */

async function getStatusBreakdown(
    tenantId,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const match =
        {
            tenantId:
                normalizedTenantId,

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
                    match
            },

            {
                $group:
                    {
                        _id:
                            "$status",

                        count:
                            {
                                $sum:
                                    1
                            }
                    }
            },

            {
                $sort:
                    {
                        count:
                            -1
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

    const rows =
        await aggregate.exec();

    return rows.map(
        row => ({
            status:
                row._id ||
                "UNKNOWN",

            count:
                row.count
        })
    );
}

/**
 * ============================================================================
 * COMPLIANCE CASE AUDIT SUMMARY
 * ============================================================================
 */

async function getAuditSummary(
    tenantId,
    options = {}
) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const match =
        {
            tenantId:
                normalizedTenantId,

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

                        open:
                            {
                                $sum:
                                    {
                                        $cond:
                                            [
                                                {
                                                    $eq:
                                                        [
                                                            "$status",
                                                            "OPEN"
                                                        ]
                                                },
                                                1,
                                                0
                                            ]
                                    }
                            },

                        closed:
                            {
                                $sum:
                                    {
                                        $cond:
                                            [
                                                {
                                                    $eq:
                                                        [
                                                            "$status",
                                                            "CLOSED"
                                                        ]
                                                },
                                                1,
                                                0
                                            ]
                                    }
                            },

                        highRisk:
                            {
                                $sum:
                                    {
                                        $cond:
                                            [
                                                {
                                                    $in:
                                                        [
                                                            "$riskLevel",
                                                            [
                                                                "HIGH",
                                                                "CRITICAL"
                                                            ]
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

    return (
        summary ||
        {
            total:
                0,

            open:
                0,

            closed:
                0,

            highRisk:
                0
        }
    );
}

/**
 * ============================================================================
 * LOGGER
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
                `TITech ComplianceRepository.${method} failed`,
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
        // Fall through to console.
    }

    console.error(
        `TITech ComplianceRepository.${method} failed`,
        {
            ...metadata,

            error:
                error?.message,

            stack:
                error?.stack
        }
    );
}

/**
 * ============================================================================
 * ERROR TRANSLATION
 * ============================================================================
 */

function translateRepositoryError(
    error,
    context = {}
) {
    if (
        error instanceof
        ComplianceRepositoryError
    ) {
        return error;
    }

    if (
        error?.code ===
        11000
    ) {
        return new ComplianceRepositoryError(
            "Compliance record already exists.",
            "COMPLIANCE_RECORD_ALREADY_EXISTS",
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
        return new ComplianceRepositoryError(
            "Compliance model validation failed.",
            "COMPLIANCE_MODEL_VALIDATION_FAILED",
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
        return new ComplianceRepositoryError(
            "Invalid MongoDB value supplied to compliance repository.",
            "COMPLIANCE_MONGO_CAST_ERROR",
            400
        );
    }

    /**
     * MongoDB transaction errors should propagate so the transaction
     * coordinator can perform the appropriate retry/abort logic.
     */
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
        result[
            field
        ] =
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

function deepClone(
    value
) {
    try {
        return JSON.parse(
            JSON.stringify(
                value
            )
        );
    } catch {
        return {
            ...value
        };
    }
}

function escapeRegex(
    value
) {
    return String(
        value
    ).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
}

/**
 * ============================================================================
 * Class
 * ============================================================================
 */

class ComplianceRepository {
    constructor(
        model =
            ComplianceModel
    ) {
        if (
            !model
        ) {
            throw new ComplianceRepositoryError(
                "ComplianceModel is required.",
                "COMPLIANCE_MODEL_REQUIRED",
                500
            );
        }

        this.model =
            model;
    }

    create(
        tenantId,
        payload,
        options
    ) {
        return create.call(
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

    find(
        tenantId,
        filters,
        options
    ) {
        return find.call(
            this,
            tenantId,
            filters,
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

    closeById(
        tenantId,
        id,
        data,
        options
    ) {
        return closeById.call(
            this,
            tenantId,
            id,
            data,
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

    getAmlCases(
        tenantId,
        options
    ) {
        return getAmlCases.call(
            this,
            tenantId,
            options
        );
    }

    getFraudCases(
        tenantId,
        options
    ) {
        return getFraudCases.call(
            this,
            tenantId,
            options
        );
    }

    getHighRiskCases(
        tenantId,
        options
    ) {
        return getHighRiskCases.call(
            this,
            tenantId,
            options
        );
    }

    getSanctionsMatches(
        tenantId,
        options
    ) {
        return getSanctionsMatches.call(
            this,
            tenantId,
            options
        );
    }

    getPepMatches(
        tenantId,
        options
    ) {
        return getPepMatches.call(
            this,
            tenantId,
            options
        );
    }

    getOpenCases(
        tenantId,
        options
    ) {
        return getOpenCases.call(
            this,
            tenantId,
            options
        );
    }

    getComplianceMetrics(
        tenantId,
        options
    ) {
        return getComplianceMetrics.call(
            this,
            tenantId,
            options
        );
    }

    getStatusBreakdown(
        tenantId,
        options
    ) {
        return getStatusBreakdown.call(
            this,
            tenantId,
            options
        );
    }

    getAuditSummary(
        tenantId,
        options
    ) {
        return getAuditSummary.call(
            this,
            tenantId,
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
        tenantId,
        payload,
        session
    ) {
        return createWithSession.call(
            this,
            tenantId,
            payload,
            session
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
    ComplianceRepository;

module.exports.ComplianceRepository =
    ComplianceRepository;

module.exports.ComplianceRepositoryError =
    ComplianceRepositoryError;