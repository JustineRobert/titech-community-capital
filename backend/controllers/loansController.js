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
 *   Trusted Tenant Context
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
 * Module system:
 *   - CommonJS only.
 *   - Do NOT mix import/export syntax with require/module.exports.
 *
 * =============================================================================
 */

const LoanWorkflowService = require(
    '../modules/loan/services/loanWorkflowService'
);

const {
    handleError,
} = require(
    '../middleware/errorMiddleware'
);

// =============================================================================
// Constants
// =============================================================================

const COMPONENT = 'loans-controller';

const OPERATION = 'LOAN_DISBURSEMENT';

const ADMIN_ROLES = Object.freeze([
    'ADMIN',
    'SUPER_ADMIN',
]);

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_REQUEST_ID_LENGTH = 128;

const DEFAULT_CURRENCY = 'UGX';

const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Monetary values are deliberately accepted as decimal strings.
 *
 * Examples:
 *   "1000"
 *   "1000.5"
 *   "1000.50"
 *
 * Rejected:
 *   "1,000"
 *   "1e6"
 *   "-100"
 *   ".50"
 *   "01"
 *   "100.123"
 *   1000
 */
const FIXED_MONEY_PATTERN =
    /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

const ZERO_MONEY_PATTERN =
    /^0(?:\.0{1,2})?$/;

const CORRELATION_HEADERS = Object.freeze([
    'x-correlation-id',
    'x-request-id',
    'x-trace-id',
]);

// =============================================================================
// Error Utility
// =============================================================================

function createLoanError(
    message,
    code,
    statusCode = 422
) {
    const error = new Error(message);

    error.code = code;
    error.statusCode = statusCode;

    return error;
}

// =============================================================================
// String Validation
// =============================================================================

function normalizeString(
    value,
    field,
    {
        required = false,
        maxLength = MAX_IDENTIFIER_LENGTH,
    } = {}
) {
    if (
        value === null ||
        value === undefined
    ) {
        if (required) {
            throw createLoanError(
                `${field} is required.`,
                `LOAN_${field.toUpperCase()}_REQUIRED`
            );
        }

        return null;
    }

    if (typeof value !== 'string') {
        throw createLoanError(
            `${field} must be a string.`,
            `LOAN_${field.toUpperCase()}_INVALID`
        );
    }

    const normalized = value.trim();

    if (!normalized) {
        if (required) {
            throw createLoanError(
                `${field} is required.`,
                `LOAN_${field.toUpperCase()}_REQUIRED`
            );
        }

        return null;
    }

    if (normalized.length > maxLength) {
        throw createLoanError(
            `${field} exceeds the maximum allowed length.`,
            `LOAN_${field.toUpperCase()}_TOO_LONG`
        );
    }

    return normalized;
}

// =============================================================================
// Header Handling
// =============================================================================

function getHeader(req, name) {
    if (
        typeof req?.get === 'function'
    ) {
        const value = req.get(name);

        if (
            typeof value === 'string' &&
            value.trim()
        ) {
            return value.trim();
        }
    }

    const value =
        req?.headers?.[String(name).toLowerCase()];

    if (
        typeof value === 'string' &&
        value.trim()
    ) {
        return value.trim();
    }

    return null;
}

function getBoundedHeader(
    req,
    name,
    maxLength
) {
    return normalizeString(
        getHeader(req, name),
        name,
        {
            required: false,
            maxLength,
        }
    );
}

function getCorrelationId(req) {
    for (
        const header of CORRELATION_HEADERS
    ) {
        const value = getBoundedHeader(
            req,
            header,
            MAX_CORRELATION_ID_LENGTH
        );

        if (value) {
            return value;
        }
    }

    return normalizeString(
        req?.correlationId ??
        req?.requestId ??
        null,
        'correlationId',
        {
            required: false,
            maxLength: MAX_CORRELATION_ID_LENGTH,
        }
    );
}

// =============================================================================
// Request Body
// =============================================================================

function getBody(req) {
    const body = req?.body;

    if (
        body &&
        typeof body === 'object' &&
        !Array.isArray(body)
    ) {
        return body;
    }

    return {};
}

// =============================================================================
// Trusted Tenant Context
// =============================================================================

function resolveTenantId(req, user) {
    const tenantId =
        req?.context?.tenantId ??
        req?.auth?.tenantId ??
        user?.tenantId;

    return normalizeString(
        tenantId,
        'tenantId',
        {
            required: true,
        }
    );
}

// =============================================================================
// Authentication
// =============================================================================

function requireUser(req) {
    if (
        !req?.user ||
        typeof req.user !== 'object'
    ) {
        throw createLoanError(
            'Authenticated user context is required.',
            'LOAN_AUTHENTICATION_REQUIRED',
            401
        );
    }

    return req.user;
}

// =============================================================================
// Authorization
// =============================================================================

function resolveRoles(user) {
    const candidates = [
        user?.roles,
        user?.role,
        user?.permissions?.roles,
    ];

    const roles = [];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            roles.push(...candidate);
        } else if (
            typeof candidate === 'string'
        ) {
            roles.push(candidate);
        }
    }

    return [
        ...new Set(
            roles
                .filter(
                    value =>
                        typeof value === 'string'
                )
                .map(
                    value =>
                        value.trim().toUpperCase()
                )
                .filter(Boolean)
        ),
    ];
}

function requireAdmin(user) {
    const roles = resolveRoles(user);

    const authorized =
        ADMIN_ROLES.some(
            role => roles.includes(role)
        );

    if (!authorized) {
        throw createLoanError(
            'Forbidden.',
            'LOAN_ADMIN_AUTHORIZATION_REQUIRED',
            403
        );
    }
}

// =============================================================================
// Principal Identity
// =============================================================================

function resolvePrincipalId(user) {
    const principalId =
        user?.id ??
        user?._id;

    return normalizeString(
        principalId,
        'principalId',
        {
            required: true,
            maxLength: MAX_IDENTIFIER_LENGTH,
        }
    );
}

// =============================================================================
// Idempotency
// =============================================================================

function requireIdempotencyKey(req) {
    return normalizeString(
        getHeader(
            req,
            'idempotency-key'
        ),
        'idempotencyKey',
        {
            required: true,
            maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
        }
    );
}

// =============================================================================
// Monetary Validation
// =============================================================================

function normalizeAmount(amount) {
    if (
        amount === null ||
        amount === undefined
    ) {
        throw createLoanError(
            'amount is required.',
            'LOAN_AMOUNT_REQUIRED'
        );
    }

    if (typeof amount !== 'string') {
        throw createLoanError(
            'amount must be supplied as a decimal string.',
            'LOAN_INVALID_AMOUNT'
        );
    }

    const normalized = amount.trim();

    if (
        !FIXED_MONEY_PATTERN.test(normalized)
    ) {
        throw createLoanError(
            'amount must be a fixed-point monetary value with at most two decimal places.',
            'LOAN_INVALID_AMOUNT'
        );
    }

    if (
        ZERO_MONEY_PATTERN.test(normalized)
    ) {
        throw createLoanError(
            'amount must be greater than zero.',
            'LOAN_INVALID_AMOUNT'
        );
    }

    return normalized;
}

// =============================================================================
// Currency
// =============================================================================

function normalizeCurrency(currency) {
    const normalized = String(
        currency ?? DEFAULT_CURRENCY
    )
        .trim()
        .toUpperCase();

    if (
        !ISO_CURRENCY_PATTERN.test(normalized)
    ) {
        throw createLoanError(
            'currency must be a valid three-letter currency code.',
            'LOAN_INVALID_CURRENCY'
        );
    }

    return normalized;
}

// =============================================================================
// Controller
// =============================================================================

class LoansController {
    static async createLoan(
        req,
        res,
        next
    ) {
        const startedAt = Date.now();

        try {
            const user = requireUser(req);

            requireAdmin(user);

            const tenantId =
                resolveTenantId(
                    req,
                    user
                );

            const body =
                getBody(req);

            const saccoId =
                normalizeString(
                    body.saccoId,
                    'saccoId',
                    {
                        required: true,
                    }
                );

            const memberId =
                normalizeString(
                    body.memberId,
                    'memberId',
                    {
                        required: true,
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
                requireIdempotencyKey(req);

            const correlationId =
                getCorrelationId(req);

            const requestId =
                getBoundedHeader(
                    req,
                    'x-request-id',
                    MAX_REQUEST_ID_LENGTH
                );

            const principalId =
                resolvePrincipalId(user);

            const requestContext = {
                component: COMPONENT,
                operation: OPERATION,
                tenantId,
                principalId,
                correlationId,
                requestId,
                idempotencyKey,
                endpoint:
                    typeof req?.originalUrl === 'string'
                        ? req.originalUrl
                        : undefined,
                method:
                    typeof req?.method === 'string'
                        ? req.method.toUpperCase()
                        : undefined,
            };

            const result =
                await LoanWorkflowService.disburseLoan(
                    null,
                    {
                        saccoId,
                        memberId,
                        amount,
                        currency,
                        idempotencyKey,
                        correlationId,
                        metadata: {
                            source: COMPONENT,
                            operation: OPERATION,
                        },
                    },
                    user,
                    tenantId,
                    requestContext
                );

            return res
                .status(200)
                .json({
                    success: true,
                    message:
                        'Loan disbursed successfully.',
                    timestamp:
                        new Date().toISOString(),
                    meta: {
                        requestId,
                        correlationId,
                        tenantId,
                        operation: OPERATION,
                        idempotencyKey,
                        executionTimeMs:
                            Date.now() -
                            startedAt,
                    },
                    data: result,
                });
        } catch (error) {
            return handleError(
                error,
                req,
                res,
                next
            );
        }
    }
}

module.exports = LoansController;