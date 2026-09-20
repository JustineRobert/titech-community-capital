'use strict';


/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   controllers/contributionsController.js
 *
 * Purpose:
 *   Enterprise HTTP/application boundary for contribution creation.
 *
 * Architectural position:
 *
 *   HTTP Request
 *        ↓
 *   Authentication / Authorization
 *        ↓
 *   Tenant Context
 *        ↓
 *   Idempotency / Financial Transaction Boundary
 *        ↓
 *   MongoDB Transaction Session
 *        ↓
 *   Financial Operation Service
 *        ↓
 *   Contribution + Ledger + Balance
 *        ↓
 *   Commit / Rollback
 *        ↓
 *   HTTP Response
 *
 * IMPORTANT
 * =============================================================================
 *
 * This controller DOES NOT:
 *
 *   - write LedgerEntry directly
 *   - write balances directly
 *   - create MongoDB sessions itself
 *   - commit MongoDB transactions
 *   - abort MongoDB transactions
 *   - call payment providers
 *   - trust client-supplied tenant identity
 *   - persist the entire request body into an audit record
 *
 * The financial transaction boundary MUST provide:
 *
 *   {
 *      session,
 *      repositories,
 *      transactionId,
 *      idempotencyKey
 *   }
 *
 * The canonical financial operation service then executes:
 *
 *   executeFinancialOperation({
 *      operation: FINANCIAL_OPERATION.CONTRIBUTION_CREATE,
 *      session,
 *      context,
 *      repositories,
 *      payload
 *   })
 *
 * =============================================================================
 */

import {
    FINANCIAL_OPERATION,
    executeFinancialOperation
} from '../services/financial/financialOperation.service.js';

// =============================================================================
// Constants
// =============================================================================

const COMPONENT =
    'contributions-controller';

const DEFAULT_CURRENCY =
    'UGX';

const IDEMPOTENCY_HEADER =
    'idempotency-key';

const CORRELATION_HEADERS =
    Object.freeze([
        'x-correlation-id',
        'x-request-id',
        'x-trace-id'
    ]);

const MAX_IDENTIFIER_LENGTH =
    128;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    256;

const MAX_METADATA_KEYS =
    50;

// =============================================================================
// Generic Helpers
// =============================================================================

function normalizeString(
    value,
    field,
    options = {}
) {
    const {
        required = false,
        maxLength = MAX_IDENTIFIER_LENGTH
    } = options;

    if (
        value === null ||
        value === undefined
    ) {
        if (required) {
            throw createControllerError(
                `${field} is required.`,
                `CONTRIBUTION_${field.toUpperCase()}_REQUIRED`,
                422
            );
        }

        return null;
    }

    const normalized =
        String(value).trim();

    if (
        !normalized
    ) {
        if (required) {
            throw createControllerError(
                `${field} is required.`,
                `CONTRIBUTION_${field.toUpperCase()}_REQUIRED`,
                422
            );
        }

        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw createControllerError(
            `${field} exceeds the maximum allowed length.`,
            `CONTRIBUTION_${field.toUpperCase()}_TOO_LONG`,
            422
        );
    }

    return normalized;
}

function getHeader(
    req,
    name
) {
    if (
        !req
    ) {
        return null;
    }

    if (
        typeof req.get ===
        'function'
    ) {
        const value =
            req.get(name);

        if (
            typeof value ===
            'string' &&
            value.trim()
        ) {
            return value.trim();
        }
    }

    const direct =
        req.headers?.[
            String(name).toLowerCase()
        ];

    if (
        typeof direct ===
        'string' &&
        direct.trim()
    ) {
        return direct.trim();
    }

    return null;
}

function getFirstHeader(
    req,
    names
) {
    for (
        const name of names
    ) {
        const value =
            getHeader(
                req,
                name
            );

        if (value) {
            return value;
        }
    }

    return null;
}

function resolveLogger(
    req
) {
    const candidates = [
        req?.logger,
        req?.context?.logger,
        req?.servicesContext?.logger
    ];

    for (
        const logger of candidates
    ) {
        if (
            logger &&
            (
                typeof logger.info ===
                'function' ||
                typeof logger.warn ===
                'function' ||
                typeof logger.error ===
                'function' ||
                typeof logger.debug ===
                'function'
            )
        ) {
            return logger;
        }
    }

    return {
        info:
            console.info.bind(
                console
            ),

        warn:
            console.warn.bind(
                console
            ),

        error:
            console.error.bind(
                console
            ),

        debug:
            console.debug.bind(
                console
            )
    };
}

// =============================================================================
// Controller Errors
// =============================================================================

function createControllerError(
    message,
    code,
    status = 500,
    details = undefined
) {
    const error =
        new Error(
            message
        );

    error.name =
        'ContributionControllerError';

    error.code =
        code;

    error.status =
        status;

    if (
        details !== undefined
    ) {
        error.details =
            details;
    }

    return error;
}

// =============================================================================
// Financial Amount Validation
// =============================================================================
//
// Preserve money as a decimal string.
//
// DO NOT convert the amount through Number().
// The financial service deliberately validates fixed-point monetary values and
// the project's financial architecture expects exact monetary representation.
// =============================================================================

function normalizeAmount(
    amount
) {
    if (
        amount === null ||
        amount === undefined
    ) {
        throw createControllerError(
            'amount is required.',
            'CONTRIBUTION_AMOUNT_REQUIRED',
            422
        );
    }

    const normalized =
        String(amount).trim();

    if (!normalized) {
        throw createControllerError(
            'amount is required.',
            'CONTRIBUTION_AMOUNT_REQUIRED',
            422
        );
    }

    if (
        !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(
            normalized
        )
    ) {
        throw createControllerError(
            'amount must be a positive fixed-point monetary value with at most two decimal places.',
            'CONTRIBUTION_INVALID_AMOUNT',
            422
        );
    }

    if (
        /^0(?:\.0{1,2})?$/.test(
            normalized
        )
    ) {
        throw createControllerError(
            'amount must be greater than zero.',
            'CONTRIBUTION_INVALID_AMOUNT',
            422
        );
    }

    return normalized;
}

// =============================================================================
// Currency Validation
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
        throw createControllerError(
            'currency must be a valid three-letter currency code.',
            'CONTRIBUTION_INVALID_CURRENCY',
            422
        );
    }

    return normalized;
}

// =============================================================================
// Tenant Resolution
// =============================================================================
//
// Client-supplied tenantId is deliberately NOT authoritative.
//
// The authenticated/request transaction context is authoritative.
// =============================================================================

function resolveTenantId(
    req
) {
    const tenantId =
        req?.tenantId ||
        req?.tenant?.id ||
        req?.tenant?._id ||
        req?.auth?.tenantId ||
        req?.user?.tenantId ||
        req?.user?.tenant?.id ||
        req?.context?.tenantId ||
        req?.transactionContext?.tenantId ||
        req?.financialTransactionContext?.tenantId;

    return normalizeString(
        tenantId,
        'tenantId',
        {
            required: true
        }
    );
}

// =============================================================================
// Principal / Actor Resolution
// =============================================================================

function resolvePrincipalId(
    req,
    memberId
) {
    const principalId =
        req?.auth?.userId ||
        req?.auth?.id ||
        req?.user?.id ||
        req?.user?._id ||
        req?.principalId ||
        req?.transactionContext?.principalId ||
        req?.financialTransactionContext?.principalId ||
        memberId;

    return normalizeString(
        principalId,
        'principalId',
        {
            required: true
        }
    );
}

// =============================================================================
// Idempotency
// =============================================================================

function resolveIdempotencyKey(
    req
) {
    const key =
        getHeader(
            req,
            IDEMPOTENCY_HEADER
        );

    return normalizeString(
        key,
        'idempotencyKey',
        {
            required: true,
            maxLength:
                MAX_IDEMPOTENCY_KEY_LENGTH
        }
    );
}

// =============================================================================
// Correlation
// =============================================================================

function resolveCorrelationId(
    req
) {
    return (
        getFirstHeader(
            req,
            CORRELATION_HEADERS
        ) ||
        req?.correlationId ||
        req?.requestId ||
        req?.transactionContext?.correlationId ||
        null
    );
}

// =============================================================================
// Transaction Boundary Resolution
// =============================================================================
//
// The financialOperation.service.js explicitly requires a transaction session
// and repositories to be supplied by the caller.
//
// This controller therefore consumes an already-established financial
// transaction context instead of creating a second transaction boundary.
//
// Supported locations:
//
//   req.financialTransactionContext
//   req.transactionContext
//   req.context.financialTransactionContext
//   req.context.transactionContext
//   req.servicesContext financial transaction context
//
// =============================================================================

function resolveFinancialTransactionContext(
    req
) {
    const candidates = [
        req?.financialTransactionContext,
        req?.transactionContext,
        req?.context?.financialTransactionContext,
        req?.context?.transactionContext
    ];

    for (
        const context of candidates
    ) {
        if (
            context &&
            typeof context ===
            'object'
        ) {
            return context;
        }
    }

    throw createControllerError(
        'Financial transaction context is unavailable. The contribution route must execute inside the canonical financial transaction boundary.',
        'FINANCIAL_TRANSACTION_CONTEXT_REQUIRED',
        503
    );
}

// =============================================================================
// Session Validation
// =============================================================================

function assertActiveSession(
    session
) {
    if (
        !session
    ) {
        throw createControllerError(
            'MongoDB financial transaction session is required.',
            'FINANCIAL_SESSION_REQUIRED',
            503
        );
    }

    if (
        typeof session.inTransaction !==
        'function'
    ) {
        throw createControllerError(
            'Invalid MongoDB financial transaction session.',
            'FINANCIAL_INVALID_SESSION',
            503
        );
    }

    if (
        !session.inTransaction()
    ) {
        throw createControllerError(
            'The contribution request is not executing inside an active MongoDB transaction.',
            'FINANCIAL_TRANSACTION_NOT_ACTIVE',
            503
        );
    }
}

// =============================================================================
// Repository Validation
// =============================================================================

function assertRepositories(
    repositories
) {
    if (
        !repositories ||
        typeof repositories !==
        'object'
    ) {
        throw createControllerError(
            'Financial repositories are unavailable.',
            'FINANCIAL_REPOSITORIES_REQUIRED',
            503
        );
    }

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository
    } = repositories;

    if (
        !transactionRepository
    ) {
        throw createControllerError(
            'Financial transaction repository is unavailable.',
            'FINANCIAL_TRANSACTION_REPOSITORY_REQUIRED',
            503
        );
    }

    if (
        !ledgerRepository
    ) {
        throw createControllerError(
            'Financial ledger repository is unavailable.',
            'FINANCIAL_LEDGER_REPOSITORY_REQUIRED',
            503
        );
    }

    if (
        !balanceRepository
    ) {
        throw createControllerError(
            'Financial balance repository is unavailable.',
            'FINANCIAL_BALANCE_REPOSITORY_REQUIRED',
            503
        );
    }

    return {
        transactionRepository,
        ledgerRepository,
        balanceRepository
    };
}

// =============================================================================
// Account Resolution
// =============================================================================
//
// CONTRIBUTION_CREATE in the supplied financial service requires accountId.
//
// Do NOT derive a financial account from an untrusted arbitrary string unless
// your account model explicitly defines that mapping.
//
// The authenticated financial context should preferably provide accountId.
//
// =============================================================================

function resolveAccountId(
    req,
    body
) {
    const accountId =
        req?.financialTransactionContext?.accountId ||
        req?.transactionContext?.accountId ||
        req?.financialAccountId ||
        req?.accountId ||
        body?.accountId ||
        body?.walletAccountId ||
        body?.saccoWalletAccountId;

    return normalizeString(
        accountId,
        'accountId',
        {
            required: true
        }
    );
}

// =============================================================================
// Metadata Sanitization
// =============================================================================

function sanitizeMetadata(
    metadata
) {
    if (
        metadata === null ||
        metadata === undefined
    ) {
        return {};
    }

    if (
        typeof metadata !==
        'object' ||
        Array.isArray(metadata)
    ) {
        return {};
    }

    const output = {};
    let count = 0;

    const blockedKeys =
        new Set([
            'authorization',
            'password',
            'passcode',
            'pin',
            'otp',
            'token',
            'accessToken',
            'refreshToken',
            'secret',
            'clientSecret',
            'apiKey',
            'cookie'
        ]);

    for (
        const [
            key,
            value
        ] of Object.entries(
            metadata
        )
    ) {
        if (
            count >=
            MAX_METADATA_KEYS
        ) {
            break;
        }

        if (
            blockedKeys.has(
                key
            )
        ) {
            continue;
        }

        if (
            value === null ||
            typeof value ===
            'string' ||
            typeof value ===
            'number' ||
            typeof value ===
            'boolean'
        ) {
            output[key] =
                value;

            count += 1;
        }
    }

    return output;
}

// =============================================================================
// Request Normalization
// =============================================================================

function normalizeContributionRequest(
    req
) {
    const body =
        req?.body &&
        typeof req.body ===
        'object' &&
        !Array.isArray(
            req.body
        )
            ? req.body
            : {};

    const tenantId =
        resolveTenantId(
            req
        );

    const memberId =
        normalizeString(
            body.memberId,
            'memberId',
            {
                required: true
            }
        );

    const principalId =
        resolvePrincipalId(
            req,
            memberId
        );

    const saccoId =
        normalizeString(
            body.saccoId,
            'saccoId',
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

    const paymentReference =
        normalizeString(
            body.paymentReference ||
            body.transactionReference ||
            body.externalReference ||
            body.providerReference,
            'paymentReference',
            {
                required: true
            }
        );

    const idempotencyKey =
        resolveIdempotencyKey(
            req
        );

    const accountId =
        resolveAccountId(
            req,
            body
        );

    return {
        tenantId,
        principalId,
        memberId,
        saccoId,
        accountId,
        amount,
        currency,
        paymentReference,
        idempotencyKey,

        savingsPlanId:
            normalizeString(
                body.savingsPlanId,
                'savingsPlanId'
            ),

        provider:
            normalizeString(
                body.provider,
                'provider'
            ),

        correlationId:
            resolveCorrelationId(
                req
            ),

        metadata:
            sanitizeMetadata(
                body.metadata
            )
    };
}

// =============================================================================
// Public Response Shaping
// =============================================================================

function buildResponse(
    operationResult,
    input
) {
    const result =
        operationResult || {};

    return {
        success: true,

        code:
            'CONTRIBUTION_CREATED',

        message:
            'Contribution created successfully.',

        data: {
            transactionId:
                result?.transaction?.transactionId ||
                input.transactionId ||
                null,

            operation:
                FINANCIAL_OPERATION.CONTRIBUTION_CREATE,

            tenantId:
                input.tenantId,

            saccoId:
                input.saccoId,

            memberId:
                input.memberId,

            accountId:
                input.accountId,

            amount:
                input.amount,

            currency:
                input.currency,

            paymentReference:
                input.paymentReference,

            transaction:
                result?.transaction ||
                null,

            ledgerEntry:
                result?.ledgerEntry ||
                null
        },

        correlationId:
            input.correlationId,

        idempotencyKey:
            input.idempotencyKey
    };
}

// =============================================================================
// Error Mapping
// =============================================================================

function resolveErrorStatus(
    error
) {
    const explicit =
        Number(
            error?.status ||
            error?.statusCode ||
            error?.httpStatus
        );

    if (
        Number.isInteger(
            explicit
        ) &&
        explicit >= 400 &&
        explicit <= 599
    ) {
        return explicit;
    }

    switch (
        error?.code
    ) {
        case 'FINANCIAL_INSUFFICIENT_BALANCE':
            return 422;

        case 'FINANCIAL_INVALID_AMOUNT':
        case 'FINANCIAL_INVALID_CURRENCY':
        case 'FINANCIAL_OPERATION_UNSUPPORTED':
            return 422;

        case 'CONTRIBUTION_SACCOID_REQUIRED':
        case 'CONTRIBUTION_MEMBERID_REQUIRED':
        case 'CONTRIBUTION_ACCOUNTID_REQUIRED':
        case 'CONTRIBUTION_AMOUNT_REQUIRED':
        case 'CONTRIBUTION_INVALID_AMOUNT':
        case 'CONTRIBUTION_IDEMPOTENCYKEY_REQUIRED':
            return 422;

        case 'IDEMPOTENCY_CONFLICT':
        case 'IDEMPOTENCY_KEY_REUSED':
        case 'FINANCIAL_IDEMPOTENCY_CONFLICT':
            return 409;

        case 'FINANCIAL_SESSION_REQUIRED':
        case 'FINANCIAL_INVALID_SESSION':
        case 'FINANCIAL_TRANSACTION_NOT_ACTIVE':
        case 'FINANCIAL_REPOSITORIES_REQUIRED':
        case 'FINANCIAL_TRANSACTION_CONTEXT_REQUIRED':
        case 'FINANCIAL_TRANSACTION_REPOSITORY_REQUIRED':
        case 'FINANCIAL_LEDGER_REPOSITORY_REQUIRED':
        case 'FINANCIAL_BALANCE_REPOSITORY_REQUIRED':
            return 503;

        default:
            return 500;
    }
}

function getSafeErrorMessage(
    error,
    status
) {
    if (
        status >= 500
    ) {
        return (
            'Contribution processing could not be completed.'
        );
    }

    return (
        error?.publicMessage ||
        error?.message ||
        'Contribution request could not be processed.'
    );
}

// =============================================================================
// Controller
// =============================================================================

async function createContribution(
    req,
    res,
    next
) {
    const logger =
        resolveLogger(
            req
        );

    const startedAt =
        Date.now();

    let input = null;

    try {
        // ---------------------------------------------------------------------
        // Normalize and validate request.
        // ---------------------------------------------------------------------

        input =
            normalizeContributionRequest(
                req
            );

        // ---------------------------------------------------------------------
        // Resolve canonical financial transaction context.
        //
        // The transaction context owns session/repositories/idempotency.
        // ---------------------------------------------------------------------

        const transactionContext =
            resolveFinancialTransactionContext(
                req
            );

        const session =
            transactionContext.session;

        const repositories =
            assertRepositories(
                transactionContext.repositories
            );

        assertActiveSession(
            session
        );

        // ---------------------------------------------------------------------
        // Verify the context agrees with the authenticated/request identity.
        // ---------------------------------------------------------------------

        const contextTenantId =
            normalizeString(
                transactionContext.tenantId,
                'transactionContext.tenantId',
                {
                    required: true
                }
            );

        if (
            contextTenantId !==
            input.tenantId
        ) {
            throw createControllerError(
                'Tenant context mismatch.',
                'FINANCIAL_TENANT_CONTEXT_MISMATCH',
                403
            );
        }

        const transactionId =
            normalizeString(
                transactionContext.transactionId,
                'transactionContext.transactionId',
                {
                    required: true
                }
            );

        const contextIdempotencyKey =
            normalizeString(
                transactionContext.idempotencyKey,
                'transactionContext.idempotencyKey',
                {
                    required: true,
                    maxLength:
                        MAX_IDEMPOTENCY_KEY_LENGTH
                }
            );

        if (
            contextIdempotencyKey !==
            input.idempotencyKey
        ) {
            throw createControllerError(
                'Idempotency key does not match the canonical transaction context.',
                'FINANCIAL_IDEMPOTENCY_CONTEXT_MISMATCH',
                409
            );
        }

        // ---------------------------------------------------------------------
        // Build the exact financial context required by the canonical service.
        // ---------------------------------------------------------------------

        const financialContext = {
            tenantId:
                input.tenantId,

            principalId:
                transactionContext.principalId ||
                input.principalId,

            transactionId,

            correlationId:
                input.correlationId,

            idempotencyKey:
                input.idempotencyKey
        };

        const result =
            await executeFinancialOperation({
                operation:
                    FINANCIAL_OPERATION.CONTRIBUTION_CREATE,

                session,

                context:
                    financialContext,

                repositories,

                payload: {
                    amount:
                        input.amount,

                    currency:
                        input.currency,

                    accountId:
                        input.accountId,

                    memberId:
                        input.memberId,

                    savingsPlanId:
                        input.savingsPlanId,

                    metadata: {
                        source:
                            COMPONENT,

                        saccoId:
                            input.saccoId,

                        memberId:
                            input.memberId,

                        paymentReference:
                            input.paymentReference,

                        provider:
                            input.provider,

                        correlationId:
                            input.correlationId,

                        idempotencyKey:
                            input.idempotencyKey,

                        ...input.metadata
                    }
                }
            });

        // ---------------------------------------------------------------------
        // IMPORTANT:
        //
        // financialOperation.service.js does NOT commit the transaction.
        //
        // The surrounding financial transaction boundary owns commit/rollback.
        //
        // Therefore this controller deliberately does NOT call:
        //
        //   session.commitTransaction()
        //   session.abortTransaction()
        //
        // ---------------------------------------------------------------------

        const durationMs =
            Date.now() -
            startedAt;

        logger.info?.({
            component:
                COMPONENT,

            operation:
                FINANCIAL_OPERATION.CONTRIBUTION_CREATE,

            event:
                'contribution.completed',

            tenantId:
                input.tenantId,

            saccoId:
                input.saccoId,

            memberId:
                input.memberId,

            transactionId,

            idempotencyKey:
                input.idempotencyKey,

            correlationId:
                input.correlationId,

            durationMs
        });

        return res.status(
            201
        ).json(
            buildResponse(
                result,
                {
                    ...input,
                    transactionId
                }
            )
        );
    } catch (
        error
    ) {
        const status =
            resolveErrorStatus(
                error
            );

        const safeMessage =
            getSafeErrorMessage(
                error,
                status
            );

        logger.error?.({
            component:
                COMPONENT,

            operation:
                FINANCIAL_OPERATION.CONTRIBUTION_CREATE,

            event:
                'contribution.failed',

            tenantId:
                input?.tenantId ||
                null,

            saccoId:
                input?.saccoId ||
                null,

            memberId:
                input?.memberId ||
                null,

            amount:
                input?.amount ||
                null,

            currency:
                input?.currency ||
                null,

            paymentReference:
                input?.paymentReference ||
                null,

            correlationId:
                input?.correlationId ||
                null,

            idempotencyKey:
                input?.idempotencyKey ||
                null,

            code:
                error?.code ||
                'CONTRIBUTION_PROCESSING_ERROR',

            status,

            error:
                error?.message ||
                String(error),

            durationMs:
                Date.now() -
                startedAt
        });

        /**
         * Preserve the centralized TITech error-handler contract where the
         * application has installed one.
         */
        if (
            typeof next ===
            'function' &&
            error?.delegateToErrorHandler === true
        ) {
            return next(
                error
            );
        }

        return res.status(
            status
        ).json({
            success:
                false,

            code:
                error?.code ||
                'CONTRIBUTION_PROCESSING_ERROR',

            message:
                safeMessage,

            correlationId:
                input?.correlationId ||
                resolveCorrelationId(
                    req
                )
        });
    }
}

// =============================================================================
// Exports
// =============================================================================

const contributionsControllerModule = Object.freeze({
    createContribution
});

export default contributionsControllerModule;