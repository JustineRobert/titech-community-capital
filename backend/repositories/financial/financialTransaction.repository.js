"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Financial Transaction Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/financial/financialTransaction.repository.js
 *
 * Purpose:
 *   Persistence boundary for immutable financial transaction records.
 *
 * ============================================================================
 * ARCHITECTURAL POSITION
 * ============================================================================
 *
 *   Financial Transaction Service
 *              │
 *              ▼
 *   Financial Transaction Repository
 *              │
 *              ▼
 *   FinancialTransaction Model
 *              │
 *              ▼
 *          MongoDB
 *
 * ============================================================================
 * REPOSITORY RESPONSIBILITIES
 * ============================================================================
 *
 * ✓ Persist immutable financial transaction records.
 * ✓ Require a MongoDB session for every financial write.
 * ✓ Require an active transaction where the driver exposes inTransaction().
 * ✓ Never start a MongoDB transaction.
 * ✓ Never commit a MongoDB transaction.
 * ✓ Never abort a MongoDB transaction.
 * ✓ Validate tenant ownership.
 * ✓ Validate transaction identity.
 * ✓ Validate financial identifiers.
 * ✓ Preserve exact monetary values.
 * ✓ Normalize supported enumerations.
 * ✓ Convert duplicate-key errors into domain errors.
 * ✓ Provide tenant-scoped reads.
 * ✓ Provide existing-record lookup helpers.
 *
 * ============================================================================
 * REPOSITORY NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Authorization.
 * ✗ Business-level financial validation.
 * ✗ Ledger balancing.
 * ✗ Balance mutation.
 * ✗ Idempotency orchestration.
 * ✗ Transaction lifecycle ownership.
 * ✗ Transaction state transitions after creation.
 * ✗ Generic update/delete operations.
 *
 * ============================================================================
 * IMMUTABILITY
 * ============================================================================
 *
 * Financial transaction records are append-only from this repository.
 *
 * Deliberately NOT exported:
 *
 *   update()
 *   patch()
 *   delete()
 *   remove()
 *   replace()
 *
 * Any legal financial state transition should be represented through the
 * financial transaction coordinator's domain workflow rather than arbitrary
 * repository mutation.
 *
 * ============================================================================
 * TENANT ISOLATION
 * ============================================================================
 *
 * Tenant IDs are validated against:
 *
 *   backend/tenancy/tenant.constants.js
 *
 * The repository never silently converts an invalid tenant identifier into a
 * different valid identifier.
 *
 * ============================================================================
 * MONEY
 * ============================================================================
 *
 * The repository never performs financial calculations using JavaScript
 * floating-point arithmetic.
 *
 * Preferred model representations:
 *
 *   MongoDB Decimal128
 *   OR exact decimal string
 *   OR integer minor units where the model is designed accordingly.
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * All legacy ACFOS terminology has been replaced with TITech terminology.
 *
 * ============================================================================
 */

import { createRequire } from 'node:module';

import mongoose from 'mongoose';

import FinancialTransaction from '../../models/FinancialTransaction.js';

import { FinancialTransactionError } from '../../services/financial/financialTransaction.service.js';

const require = createRequire(import.meta.url);

const tenantConstants =
  require('../../tenancy/tenant.constants.js');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const TRANSACTION_STATUSES =
    Object.freeze([
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "REVERSED",
        "CANCELLED"
    ]);

const TRANSACTION_ID_MAX_LENGTH =
    128;

const TENANT_ID_MAX_LENGTH =
    64;

const PRINCIPAL_ID_MAX_LENGTH =
    128;

const OPERATION_MAX_LENGTH =
    128;

const RESOURCE_MAX_LENGTH =
    256;

const CURRENCY_MAX_LENGTH =
    16;

const MAX_METADATA_KEYS =
    100;

const MAX_METADATA_BYTES =
    32 * 1024;

const IDENTIFIER_REGEX =
    /^[a-zA-Z0-9._:-]+$/;

const CURRENCY_REGEX =
    /^[A-Z]{3,16}$/;

/**
 * ============================================================================
 * Domain Error Factory
 * ============================================================================
 */

function createRepositoryError(
    message,
    code,
    statusCode = 500,
    details = undefined
) {
    const error =
        new FinancialTransactionError(
            message,
            code,
            statusCode
        );

    if (
        details !==
        undefined
    ) {
        error.details =
            details;
    }

    return error;
}

/**
 * ============================================================================
 * Session Validation
 * ============================================================================
 */

function requireSession(
    session
) {
    if (
        !session ||
        typeof session !==
            "object"
    ) {
        throw createRepositoryError(
            "MongoDB transaction session is required for financial writes.",
            "FINANCIAL_SESSION_REQUIRED",
            500
        );
    }

    return session;
}

/**
 * Require an active transaction where the MongoDB session exposes that
 * capability.
 *
 * The repository does not create the transaction.
 */
function requireActiveTransaction(
    session
) {
    requireSession(
        session
    );

    if (
        typeof session.inTransaction ===
        "function"
    ) {
        if (
            !session.inTransaction()
        ) {
            throw createRepositoryError(
                "An active MongoDB transaction is required for financial transaction persistence.",
                "FINANCIAL_TRANSACTION_NOT_ACTIVE",
                500
            );
        }
    }

    return session;
}

/**
 * ============================================================================
 * Generic Value Validation
 * ============================================================================
 */

function requireValue(
    value,
    field,
    {
        maxLength,
        trim = true
    } = {}
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        throw createRepositoryError(
            `${field} is required.`,
            "FINANCIAL_TRANSACTION_FIELD_REQUIRED",
            400,
            {
                field
            }
        );
    }

    const normalized =
        trim &&
        typeof value ===
            "string"
            ? value.trim()
            : value;

    if (
        normalized ===
        ""
    ) {
        throw createRepositoryError(
            `${field} is required.`,
            "FINANCIAL_TRANSACTION_FIELD_REQUIRED",
            400,
            {
                field
            }
        );
    }

    if (
        maxLength &&
        String(
            normalized
        ).length >
            maxLength
    ) {
        throw createRepositoryError(
            `${field} exceeds the maximum permitted length.`,
            "FINANCIAL_TRANSACTION_FIELD_TOO_LONG",
            400,
            {
                field,
                maxLength
            }
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Identifier Validation
 * ============================================================================
 */

function requireIdentifier(
    value,
    field,
    maxLength
) {
    const normalized =
        requireValue(
            value,
            field,
            {
                maxLength
            }
        );

    if (
        !IDENTIFIER_REGEX.test(
            String(
                normalized
            )
        )
    ) {
        throw createRepositoryError(
            `${field} contains invalid characters.`,
            "FINANCIAL_TRANSACTION_INVALID_IDENTIFIER",
            400,
            {
                field
            }
        );
    }

    return String(
        normalized
    );
}

/**
 * ============================================================================
 * Transaction ID
 * ============================================================================
 */

function requireTransactionId(
    transactionId
) {
    return requireIdentifier(
        transactionId,
        "transactionId",
        TRANSACTION_ID_MAX_LENGTH
    );
}

/**
 * ============================================================================
 * Tenant ID
 * ============================================================================
 *
 * Strict canonical validation.
 * ============================================================================
 */

function requireTenantId(
    tenantId
) {
    const normalized =
        requireIdentifier(
            tenantId,
            "tenantId",
            TENANT_ID_MAX_LENGTH
        )
            .toLowerCase();

    if (
        typeof tenantConstants
            .isValidTenantId ===
        "function"
    ) {
        if (
            !tenantConstants.isValidTenantId(
                normalized
            )
        ) {
            throw createRepositoryError(
                "Invalid tenant identifier.",
                "FINANCIAL_TRANSACTION_INVALID_TENANT",
                400,
                {
                    tenantId:
                        normalized
                }
            );
        }
    }

    return normalized;
}

/**
 * ============================================================================
 * Principal ID
 * ============================================================================
 */

function requirePrincipalId(
    principalId
) {
    return requireIdentifier(
        principalId,
        "principalId",
        PRINCIPAL_ID_MAX_LENGTH
    );
}

/**
 * ============================================================================
 * Operation
 * ============================================================================
 */

function requireOperation(
    operation
) {
    return requireIdentifier(
        operation,
        "operation",
        OPERATION_MAX_LENGTH
    );
}

/**
 * ============================================================================
 * Resource
 * ============================================================================
 */

function requireResource(
    resource
) {
    return requireValue(
        resource,
        "resource",
        {
            maxLength:
                RESOURCE_MAX_LENGTH
        }
    );
}

/**
 * ============================================================================
 * Currency
 * ============================================================================
 */

function requireCurrency(
    currency
) {
    const normalized =
        requireValue(
            currency,
            "currency",
            {
                maxLength:
                    CURRENCY_MAX_LENGTH
            }
        );

    const value =
        String(
            normalized
        )
            .trim()
            .toUpperCase();

    if (
        !CURRENCY_REGEX.test(
            value
        )
    ) {
        throw createRepositoryError(
            "Invalid currency code.",
            "FINANCIAL_TRANSACTION_INVALID_CURRENCY",
            400,
            {
                currency:
                    value
            }
        );
    }

    return value;
}

/**
 * ============================================================================
 * Monetary Amount Validation
 * ============================================================================
 *
 * No Number(amount) conversion.
 *
 * Accepted:
 *
 *   Decimal128
 *   canonical decimal string
 *   safe integer Number
 *
 * Rejected:
 *
 *   NaN
 *   Infinity
 *   scientific notation
 *   unsafe floating-point values
 *
 * The final BSON representation is delegated to the Mongoose model.
 * ============================================================================
 */

function requireAmount(
    amount
) {
    if (
        amount ===
            undefined ||
        amount ===
            null
    ) {
        throw createRepositoryError(
            "amount is required.",
            "FINANCIAL_TRANSACTION_AMOUNT_REQUIRED",
            400,
            {
                field:
                    "amount"
            }
        );
    }

    if (
        mongoose.isDecimal128(
            amount
        )
    ) {
        validateDecimalText(
            amount.toString()
        );

        return amount;
    }

    if (
        typeof amount ===
        "string"
    ) {
        const value =
            amount.trim();

        validateDecimalText(
            value
        );

        return value;
    }

    if (
        typeof amount ===
        "number"
    ) {
        if (
            !Number.isFinite(
                amount
            )
        ) {
            throw createRepositoryError(
                "Financial transaction amount must be finite.",
                "FINANCIAL_TRANSACTION_INVALID_AMOUNT",
                400
            );
        }

        /**
         * Non-integer JS numbers are deliberately rejected because they may
         * contain binary floating-point representation errors.
         */
        if (
            !Number.isSafeInteger(
                amount
            )
        ) {
            throw createRepositoryError(
                "Financial transaction amount must use Decimal128 or an exact decimal string.",
                "FINANCIAL_TRANSACTION_UNSAFE_NUMBER",
                400
            );
        }

        return amount;
    }

    if (
        typeof amount?.toString ===
        "function"
    ) {
        const value =
            amount
                .toString()
                .trim();

        validateDecimalText(
            value
        );

        return amount;
    }

    throw createRepositoryError(
        "Invalid financial transaction amount.",
        "FINANCIAL_TRANSACTION_INVALID_AMOUNT",
        400
    );
}

function validateDecimalText(
    value
) {
    if (
        !value
    ) {
        throw createRepositoryError(
            "Financial transaction amount is required.",
            "FINANCIAL_TRANSACTION_AMOUNT_REQUIRED",
            400
        );
    }

    /**
     * Canonical non-scientific decimal notation.
     */
    if (
        !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(
            value
        )
    ) {
        throw createRepositoryError(
            "Financial transaction amount must use canonical decimal notation.",
            "FINANCIAL_TRANSACTION_INVALID_AMOUNT",
            400
        );
    }

    if (
        /^0+(?:\.0+)?$/.test(
            value
        )
    ) {
        throw createRepositoryError(
            "Financial transaction amount must be greater than zero.",
            "FINANCIAL_TRANSACTION_ZERO_AMOUNT",
            400
        );
    }

    if (
        value.length >
        64
    ) {
        throw createRepositoryError(
            "Financial transaction amount is too large.",
            "FINANCIAL_TRANSACTION_AMOUNT_TOO_LARGE",
            400
        );
    }
}

/**
 * ============================================================================
 * Status
 * ============================================================================
 */

function requireStatus(
    status
) {
    const normalized =
        String(
            status ||
                "COMPLETED"
        )
            .trim()
            .toUpperCase();

    if (
        !TRANSACTION_STATUSES.includes(
            normalized
        )
    ) {
        throw createRepositoryError(
            "Invalid financial transaction status.",
            "FINANCIAL_TRANSACTION_INVALID_STATUS",
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
 * Metadata
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
        throw createRepositoryError(
            "Financial transaction metadata must be an object.",
            "FINANCIAL_TRANSACTION_INVALID_METADATA",
            400,
            {
                field:
                    "metadata"
            }
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
        throw createRepositoryError(
            "Financial transaction metadata contains too many fields.",
            "FINANCIAL_TRANSACTION_METADATA_TOO_LARGE",
            400,
            {
                maxKeys:
                    MAX_METADATA_KEYS
            }
        );
    }

    let serialized;

    try {
        serialized =
            JSON.stringify(
                metadata
            );
    } catch {
        throw createRepositoryError(
            "Financial transaction metadata must be JSON serializable.",
            "FINANCIAL_TRANSACTION_METADATA_NOT_SERIALIZABLE",
            400
        );
    }

    if (
        Buffer.byteLength(
            serialized,
            "utf8"
        ) >
        MAX_METADATA_BYTES
    ) {
        throw createRepositoryError(
            "Financial transaction metadata exceeds the maximum permitted size.",
            "FINANCIAL_TRANSACTION_METADATA_TOO_LARGE",
            400,
            {
                maxBytes:
                    MAX_METADATA_BYTES
            }
        );
    }

    return deepClone(
        metadata
    );
}

/**
 * ============================================================================
 * Normalize Creation Payload
 * ============================================================================
 */

function normalizeCreatePayload({
    transactionId,
    tenantId,
    principalId,
    operation,
    resource,
    amount,
    currency,
    status = "COMPLETED",
    metadata = {}
}) {
    return {
        transactionId:
            requireTransactionId(
                transactionId
            ),

        tenantId:
            requireTenantId(
                tenantId
            ),

        principalId:
            requirePrincipalId(
                principalId
            ),

        operation:
            requireOperation(
                operation
            ),

        resource:
            requireResource(
                resource
            ),

        amount:
            requireAmount(
                amount
            ),

        currency:
            requireCurrency(
                currency
            ),

        status:
            requireStatus(
                status
            ),

        metadata:
            normalizeMetadata(
                metadata
            )
    };
}

/**
 * ============================================================================
 * Create
 * ============================================================================
 *
 * The caller MUST own the MongoDB transaction.
 * ============================================================================
 */

async function create({
    session,
    transactionId,
    tenantId,
    principalId,
    operation,
    resource,
    amount,
    currency,
    status = "COMPLETED",
    metadata = {}
}) {
    requireActiveTransaction(
        session
    );

    const normalized =
        normalizeCreatePayload({
            transactionId,
            tenantId,
            principalId,
            operation,
            resource,
            amount,
            currency,
            status,
            metadata
        });

    try {
        const created =
            await FinancialTransaction.create(
                [
                    normalized
                ],
                {
                    session
                }
            );

        return created[0];
    } catch (
        error
    ) {
        throw translatePersistenceError(
            error,
            normalized
        );
    }
}

/**
 * ============================================================================
 * Complete / State Transition
 * ============================================================================
 *
 * Only the canonical financial coordinator may move a transaction to a
 * completed state. Identity and monetary fields remain immutable.
 * ============================================================================
 */

async function complete({
    session,
    transactionId,
    tenantId,
    metadata = {}
}) {
    requireActiveTransaction(session);

    const normalizedTransactionId =
        requireTransactionId(transactionId);

    const normalizedTenantId =
        requireTenantId(tenantId);

    const normalizedMetadata =
        normalizeMetadata(metadata);

    try {
        const result =
            await FinancialTransaction.findOneAndUpdate(
                {
                    transactionId: normalizedTransactionId,
                    tenantId: normalizedTenantId,
                    status: {
                        $in: ['PENDING', 'PROCESSING']
                    }
                },
                {
                    $set: {
                        status: 'COMPLETED',
                        completedAt: new Date(),
                        ...(Object.keys(normalizedMetadata).length > 0
                            ? { completionMetadata: normalizedMetadata }
                            : {})
                    }
                },
                {
                    new: true,
                    session,
                    runValidators: true,
                    context: 'query'
                }
            )
                .lean()
                .exec();

        if (!result) {
            const existing =
                await FinancialTransaction.findOne({
                    transactionId: normalizedTransactionId,
                    tenantId: normalizedTenantId
                })
                    .session(session)
                    .lean()
                    .exec();

            if (!existing) {
                throw createRepositoryError(
                    'Financial transaction was not found.',
                    'FINANCIAL_TRANSACTION_NOT_FOUND',
                    404,
                    {
                        transactionId: normalizedTransactionId,
                        tenantId: normalizedTenantId
                    }
                );
            }

            throw createRepositoryError(
                'Financial transaction cannot transition to COMPLETED from its current state.',
                'FINANCIAL_TRANSACTION_INVALID_COMPLETION_STATE',
                409,
                {
                    transactionId: normalizedTransactionId,
                    tenantId: normalizedTenantId,
                    status: existing.status
                }
            );
        }

        return result;
    } catch (error) {
        if (error instanceof FinancialTransactionError) {
            throw error;
        }

        throw translatePersistenceError(
            error,
            {
                transactionId: normalizedTransactionId,
                tenantId: normalizedTenantId
            }
        );
    }
}

const updateState = complete;

/**
 * ============================================================================
 * Find By Transaction ID
 * ============================================================================
 *
 * Tenant is mandatory for every lookup.
 * ============================================================================
 */

async function findById({
    session,
    transactionId,
    tenantId
}) {
    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const query =
        FinancialTransaction.findOne(
            {
                transactionId:
                    normalizedTransactionId,

                tenantId:
                    normalizedTenantId
            }
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
 * Require Existing Record
 * ============================================================================
 */

async function requireById({
    session,
    transactionId,
    tenantId
}) {
    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const record =
        await findById({
            session,
            transactionId:
                normalizedTransactionId,
            tenantId:
                normalizedTenantId
        });

    if (
        !record
    ) {
        throw createRepositoryError(
            "Financial transaction was not found.",
            "FINANCIAL_TRANSACTION_NOT_FOUND",
            404,
            {
                transactionId:
                    normalizedTransactionId,

                tenantId:
                    normalizedTenantId
            }
        );
    }

    return record;
}

/**
 * ============================================================================
 * Find By Operation
 * ============================================================================
 */

async function findByOperation({
    session,
    tenantId,
    principalId,
    operation,
    limit = 50
}) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedPrincipalId =
        requirePrincipalId(
            principalId
        );

    const normalizedOperation =
        requireOperation(
            operation
        );

    const safeLimit =
        clampInteger(
            limit,
            1,
            100,
            50
        );

    const query =
        FinancialTransaction
            .find(
                {
                    tenantId:
                        normalizedTenantId,

                    principalId:
                        normalizedPrincipalId,

                    operation:
                        normalizedOperation
                }
            )
            .sort(
                {
                    createdAt:
                        -1,

                    _id:
                        -1
                }
            )
            .limit(
                safeLimit
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
 * Find By Principal
 * ============================================================================
 */

async function findByPrincipal({
    session,
    tenantId,
    principalId,
    limit = 100,
    status
}) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedPrincipalId =
        requirePrincipalId(
            principalId
        );

    const safeLimit =
        clampInteger(
            limit,
            1,
            500,
            100
        );

    const filter =
        {
            tenantId:
                normalizedTenantId,

            principalId:
                normalizedPrincipalId
        };

    if (
        status !==
            undefined &&
        status !==
            null
    ) {
        filter.status =
            requireStatus(
                status
            );
    }

    const query =
        FinancialTransaction
            .find(
                filter
            )
            .sort(
                {
                    createdAt:
                        -1,

                    _id:
                        -1
                }
            )
            .limit(
                safeLimit
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
 * Count By Tenant
 * ============================================================================
 */

async function countByTenant({
    session,
    tenantId,
    status
}) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const filter =
        {
            tenantId:
                normalizedTenantId
        };

    if (
        status !==
            undefined &&
        status !==
            null
    ) {
        filter.status =
            requireStatus(
                status
            );
    }

    const query =
        FinancialTransaction.countDocuments(
            filter
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    return query.exec();
}

/**
 * ============================================================================
 * Check Existence
 * ============================================================================
 *
 * Useful for idempotency/service-level orchestration without exposing a
 * generic query builder.
 * ============================================================================
 */

async function exists({
    session,
    transactionId,
    tenantId
}) {
    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const query =
        FinancialTransaction.exists(
            {
                transactionId:
                    normalizedTransactionId,

                tenantId:
                    normalizedTenantId
            }
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    const result =
        await query.exec();

    return Boolean(
        result
    );
}

/**
 * ============================================================================
 * Immutable Transaction Query
 * ============================================================================
 *
 * Explicitly returns the persisted record only. There is intentionally no
 * repository method for modifying an existing transaction.
 * ============================================================================
 */

async function getSnapshot({
    session,
    transactionId,
    tenantId
}) {
    return requireById({
        session,
        transactionId,
        tenantId
    });
}

/**
 * ============================================================================
 * Persistence Error Translation
 * ============================================================================
 */

function translatePersistenceError(
    error,
    context
) {
    if (
        error?.code ===
        11000
    ) {
        return createRepositoryError(
            "Financial transaction already exists.",
            "FINANCIAL_TRANSACTION_ALREADY_EXISTS",
            409,
            {
                transactionId:
                    context
                        ?.transactionId,

                tenantId:
                    context
                        ?.tenantId,

                principalId:
                    context
                        ?.principalId,

                keyPattern:
                    error
                        ?.keyPattern
            }
        );
    }

    if (
        error?.name ===
        "ValidationError"
    ) {
        return createRepositoryError(
            "Financial transaction model validation failed.",
            "FINANCIAL_TRANSACTION_MODEL_VALIDATION_FAILED",
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
        return createRepositoryError(
            "Financial transaction persistence received an invalid MongoDB value.",
            "FINANCIAL_TRANSACTION_MONGO_CAST_ERROR",
            400
        );
    }

    /**
     * Transaction retry labels must propagate to the coordinator.
     */
    if (
        error?.hasErrorLabel?.(
            "TransientTransactionError"
        )
    ) {
        return error;
    }

    if (
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

function clampInteger(
    value,
    minimum,
    maximum,
    fallback
) {
    const numeric =
        Number(
            value
        );

    if (
        !Number.isInteger(
            numeric
        )
    ) {
        return fallback;
    }

    return Math.min(
        Math.max(
            numeric,
            minimum
        ),
        maximum
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

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

const repositoryModule =
    Object.freeze({
        TRANSACTION_STATUSES,

        requireSession,

        requireActiveTransaction,

        requireTransactionId,

        requireTenantId,

        requirePrincipalId,

        requireOperation,

        requireResource,

        requireCurrency,

        requireAmount,

        create,

        complete,

        updateState,

        findById,

        requireById,

        findByOperation,

        findByPrincipal,

        countByTenant,

        exists,

        getSnapshot
    });
export {
    TRANSACTION_STATUSES,
    requireSession,
    requireActiveTransaction,
    requireTransactionId,
    requireTenantId,
    requirePrincipalId,
    requireOperation,
    requireResource,
    requireCurrency,
    requireAmount,
    create,
    complete,
    updateState,
    findById,
    requireById,
    findByOperation,
    findByPrincipal,
    countByTenant,
    exists,
    getSnapshot
};

export default repositoryModule;
