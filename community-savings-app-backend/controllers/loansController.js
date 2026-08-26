'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Loans Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/loansController.js
 *
 * Purpose:
 *   HTTP boundary for loan creation/disbursement workflows.
 *
 * Architecture:
 *
 *   HTTP Request
 *        ↓
 *   Authentication
 *        ↓
 *   Authorization
 *        ↓
 *   Tenant Context
 *        ↓
 *   Validation
 *        ↓
 *   LoanWorkflowService
 *        ↓
 *   Financial Transaction Boundary
 *        ↓
 *   Loan + Balance + Ledger + Audit
 *        ↓
 *   Commit / Rollback
 *
 * Controller rules:
 *   - No direct LedgerEntry writes.
 *   - No direct AuditLog writes.
 *   - No MongoDB session creation.
 *   - No transaction commit/abort.
 *   - No payment-provider calls.
 *   - No business logic.
 *   - No client-controlled tenant override.
 *   - Financial mutations require idempotency.
 *
 * =============================================================================
 */

const LoanWorkflowService =
    require(
        '../modules/loan/services/loanWorkflowService'
    );

const {
    handleError
} = require(
    '../middlewares/errorMiddleware'
);

// =============================================================================
// Constants
// =============================================================================

const COMPONENT =
    'loans-controller';

const ADMIN_ROLES =
    Object.freeze([
        'ADMIN',
        'SUPER_ADMIN'
    ]);

const MAX_IDENTIFIER_LENGTH =
    128;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    256;

const DEFAULT_CURRENCY =
    'UGX';

const CORRELATION_HEADERS =
    Object.freeze([
        'x-correlation-id',
        'x-request-id',
        'x-trace-id'
    ]);

// =============================================================================
// Utilities
// =============================================================================

function normalizeString(
    value,
    field,
    {
        required = false,
        maxLength = MAX_IDENTIFIER_LENGTH
    } = {}
) {
    if (
        value === null ||
        value === undefined
    ) {
        if (required) {
            const error =
                new Error(
                    `${field} is required.`
                );

            error.code =
                `LOAN_${field.toUpperCase()}_REQUIRED`;

            error.statusCode =
                422;

            throw error;
        }

        return null;
    }

    const normalized =
        String(value).trim();

    if (!normalized) {
        if (required) {
            const error =
                new Error(
                    `${field} is required.`
                );

            error.code =
                `LOAN_${field.toUpperCase()}_REQUIRED`;

            error.statusCode =
                422;

            throw error;
        }

        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        const error =
            new Error(
                `${field} exceeds the maximum allowed length.`
            );

        error.code =
            `LOAN_${field.toUpperCase()}_TOO_LONG`;

        error.statusCode =
            422;

        throw error;
    }

    return normalized;
}

function getHeader(
    req,
    name
) {
    if (
        typeof req?.get ===
        'function'
    ) {
        const value =
            req.get(name);

        if (
            typeof value === 'string' &&
            value.trim()
        ) {
            return value.trim();
        }
    }

    const value =
        req?.headers?.[
            String(name).toLowerCase()
        ];

    if (
        typeof value === 'string' &&
        value.trim()
    ) {
        return value.trim();
    }

    return null;
}

function getCorrelationId(
    req
) {
    for (
        const header of CORRELATION_HEADERS
    ) {
        const value =
            getHeader(
                req,
                header
            );

        if (value) {
            return value;
        }
    }

    return (
        req?.correlationId ||
        req?.requestId ||
        null
    );
}

function getBody(
    req
) {
    if (
        req?.body &&
        typeof req.body === 'object' &&
        !Array.isArray(req.body)
    ) {
        return req.body;
    }

    return {};
}

// =============================================================================
// Tenant Context
// =============================================================================

function resolveTenantId(
    req
) {
    return normalizeString(
        req?.tenant_id ||
        req?.tenantId ||
        req?.tenant?.id ||
        req?.tenant?._id ||
        req?.auth?.tenantId ||
        req?.user?.tenantId ||
        req?.context?.tenantId,
        'tenantId',
        {
            required: true
        }
    );
}

// =============================================================================
// Authentication
// =============================================================================

function requireUser(
    req
) {
    if (
        !req?.user
    ) {
        const error =
            new Error(
                'Authenticated user context is required.'
            );

        error.code =
            'LOAN_AUTHENTICATION_REQUIRED';

        error.statusCode =
            401;

        throw error;
    }

    return req.user;
}

// =============================================================================
// Authorization
// =============================================================================

function resolveRoles(
    user
) {
    const roles = [];

    const candidates = [
        user?.roles,
        user?.role,
        user?.permissions?.roles
    ];

    for (
        const candidate of candidates
    ) {
        if (
            Array.isArray(candidate)
        ) {
            roles.push(
                ...candidate
            );
        } else if (
            typeof candidate ===
            'string'
        ) {
            roles.push(candidate);
        }
    }

    return [
        ...new Set(
            roles
                .map(role =>
                    String(role)
                        .trim()
                        .toUpperCase()
                )
                .filter(Boolean)
        )
    ];
}

function requireAdmin(
    user
) {
    const roles =
        resolveRoles(
            user
        );

    const authorized =
        ADMIN_ROLES.some(
            role =>
                roles.includes(
                    role
                )
        );

    if (!authorized) {
        const error =
            new Error(
                'Forbidden.'
            );

        error.code =
            'LOAN_ADMIN_AUTHORIZATION_REQUIRED';

        error.statusCode =
            403;

        throw error;
    }
}

// =============================================================================
// Idempotency
// =============================================================================

function requireIdempotencyKey(
    req
) {
    return normalizeString(
        getHeader(
            req,
            'idempotency-key'
        ),
        'idempotencyKey',
        {
            required: true,
            maxLength:
                MAX_IDEMPOTENCY_KEY_LENGTH
        }
    );
}

// =============================================================================
// Monetary Validation
// =============================================================================
//
// Keep the monetary value as a string.
// Do not convert through JavaScript Number.
// This is compatible with the financial boundary's exact-money design.
// =============================================================================

function normalizeAmount(
    amount
) {
    if (
        amount === null ||
        amount === undefined
    ) {
        const error =
            new Error(
                'amount is required.'
            );

        error.code =
            'LOAN_AMOUNT_REQUIRED';

        error.statusCode =
            422;

        throw error;
    }

    const normalized =
        String(amount).trim();

    if (
        !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(
            normalized
        )
    ) {
        const error =
            new Error(
                'amount must be a fixed-point monetary value with at most two decimal places.'
            );

        error.code =
            'LOAN_INVALID_AMOUNT';

        error.statusCode =
            422;

        throw error;
    }

    if (
        /^0(?:\.0{1,2})?$/.test(
            normalized
        )
    ) {
        const error =
            new Error(
                'amount must be greater than zero.'
            );

        error.code =
            'LOAN_INVALID_AMOUNT';

        error.statusCode =
            422;

        throw error;
    }

    return normalized;
}

// =============================================================================
// Currency
// =============================================================================

function normalizeCurrency(
    currency
) {
    const normalized =
        String(
            currency ||
            DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            normalized
        )
    ) {
        const error =
            new Error(
                'currency must be a valid three-letter currency code.'
            );

        error.code =
            'LOAN_INVALID_CURRENCY';

        error.statusCode =
            422;

        throw error;
    }

    return normalized;
}

// =============================================================================
// Main Controller
// =============================================================================

class LoansController {

    /**
     * =========================================================================
     * CREATE / DISBURSE LOAN
     * =========================================================================
     *
     * IMPORTANT:
     *
     * This method does not create a ledger entry itself.
     *
     * LoanWorkflowService is the business/workflow boundary and should delegate
     * the actual financial mutation to the canonical financial transaction
     * service.
     */
    static async createLoan(
        req,
        res,
        next
    ) {
        const startedAt =
            Date.now();

        try {
            const user =
                requireUser(
                    req
                );

            requireAdmin(
                user
            );

            const tenantId =
                resolveTenantId(
                    req
                );

            const body =
                getBody(
                    req
                );

            const saccoId =
                normalizeString(
                    body.saccoId,
                    'saccoId',
                    {
                        required: true
                    }
                );

            const memberId =
                normalizeString(
                    body.memberId,
                    'memberId',
                    {
                        required: true
                    }
                );

            const amount =
                normalizeAmount(
                    body.amount
                );

            const currency =
                normalizeCurrency(
                    body.currency
                );

            const idempotencyKey =
                requireIdempotencyKey(
                    req
                );

            const correlationId =
                getCorrelationId(
                    req
                );

            /**
             * Prefer workflow/service-generated transaction identifiers.
             * Date.now() must NOT be used as an idempotency authority.
             */
            const requestContext = {
                component:
                    COMPONENT,

                operation:
                    'LOAN_DISBURSEMENT',

                tenantId,

                principalId:
                    String(
                        user.id ||
                        user._id
                    ),

                correlationId,

                requestId:
                    getHeader(
                        req,
                        'x-request-id'
                    ),

                idempotencyKey,

                endpoint:
                    req.originalUrl,

                method:
                    req.method
            };

            /**
             * Keep the HTTP layer free of accounting logic.
             *
             * The workflow service should:
             *
             *   1. validate/authorize the loan
             *   2. establish/participate in the financial transaction
             *   3. mutate loan state
             *   4. increment destination balance
             *   5. create balanced double-entry ledger postings
             *   6. record immutable audit evidence
             *   7. commit atomically
             */
            const result =
                await LoanWorkflowService
                    .disburseLoan(
                        null,
                        {
                            saccoId,
                            memberId,
                            amount,
                            currency,
                            idempotencyKey,
                            correlationId,
                            metadata: {
                                source:
                                    COMPONENT,

                                operation:
                                    'LOAN_DISBURSEMENT'
                            }
                        },
                        user,
                        tenantId,
                        requestContext
                    );

            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    message:
                        'Loan disbursed successfully.',

                    timestamp:
                        new Date().toISOString(),

                    meta: {
                        requestId:
                            requestContext.requestId,

                        correlationId,

                        tenantId,

                        operation:
                            'LOAN_DISBURSEMENT',

                        idempotencyKey,

                        executionTimeMs:
                            Date.now() -
                            startedAt
                    },

                    data:
                        result
                });
        } catch (
            error
        ) {
            return handleError(
                error,
                req,
                res,
                next
            );
        }
    }
}

module.exports =
    LoansController;