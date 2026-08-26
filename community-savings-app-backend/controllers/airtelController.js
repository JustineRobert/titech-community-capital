'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/airtelController.js
 *
 * Purpose:
 *   Canonical HTTP boundary for Airtel Money integrations.
 *
 * Responsibilities:
 *   - Request validation
 *   - Authentication / tenant-context propagation
 *   - Idempotency enforcement for financial writes
 *   - Financial amount normalization
 *   - Phone/reference validation
 *   - Airtel webhook security boundary
 *   - Service orchestration
 *   - Safe response formatting
 *   - Health / metrics exposure
 *   - Centralized error delegation
 *
 * Financial architecture:
 *
 *   HTTP Request
 *        ↓
 *   Authentication / Tenant Context
 *        ↓
 *   Validation
 *        ↓
 *   Airtel Service
 *        ↓
 *   Financial / Transaction Boundary
 *        ↓
 *   Idempotency
 *        ↓
 *   Ledger / Balance / Loan / Contribution
 *
 * IMPORTANT
 * =============================================================================
 *
 * This controller MUST NOT:
 *
 *   - create LedgerEntry records directly
 *   - mutate balances directly
 *   - create/commit/abort MongoDB transactions
 *   - trust client-supplied tenant identity
 *   - use JavaScript floating-point arithmetic as the authoritative money
 *     representation
 *   - generate fake payment references with Date.now()
 *   - treat a reconstructed JSON body as cryptographically equivalent to the
 *     original webhook bytes
 *
 * =============================================================================
 */

const collectionsService =
    require(
        '../services/airtel/collections'
    );

const disbursementService =
    require(
        '../services/airtel/disbursements'
    );

const webhookService =
    require(
        '../services/airtel/webhooks'
    );

const reconciliationService =
    require(
        '../services/airtel/reconciliation'
    );

let logger;

try {
    logger =
        require(
            '../utils/logger'
        );
} catch {
    logger = {
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

let handleError = null;

try {
    const errorMiddleware =
        require(
            '../middlewares/errorMiddleware'
        );

    handleError =
        errorMiddleware?.handleError ||
        null;
} catch {
    handleError =
        null;
}

// =============================================================================
// Constants
// =============================================================================

const COMPONENT =
    'airtel-controller';

const DEFAULT_CURRENCY =
    'UGX';

const MAX_IDENTIFIER_LENGTH =
    128;

const MAX_REFERENCE_LENGTH =
    256;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    256;

const MAX_BULK_TRANSACTIONS =
    100;

const MAX_PHONE_LENGTH =
    32;

const CORRELATION_HEADERS =
    Object.freeze([
        'x-correlation-id',
        'x-request-id',
        'x-trace-id'
    ]);

const SIGNATURE_HEADERS =
    Object.freeze([
        'x-airtel-signature',
        'x-signature'
    ]);

// =============================================================================
// Generic Helpers
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
        if (
            required
        ) {
            const error =
                new Error(
                    `${field} is required.`
                );

            error.statusCode =
                422;

            error.code =
                `AIRTEL_${field.toUpperCase()}_REQUIRED`;

            throw error;
        }

        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    if (
        !normalized
    ) {
        if (
            required
        ) {
            const error =
                new Error(
                    `${field} is required.`
                );

            error.statusCode =
                422;

            error.code =
                `AIRTEL_${field.toUpperCase()}_REQUIRED`;

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

        error.statusCode =
            422;

        error.code =
            `AIRTEL_${field.toUpperCase()}_TOO_LONG`;

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
            req.get(
                name
            );

        if (
            typeof value === 'string' &&
            value.trim()
        ) {
            return value.trim();
        }
    }

    const value =
        req?.headers?.[
            String(
                name
            ).toLowerCase()
        ];

    if (
        typeof value === 'string' &&
        value.trim()
    ) {
        return value.trim();
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

        if (
            value
        ) {
            return value;
        }
    }

    return null;
}

function getBody(
    req
) {
    if (
        req?.body &&
        typeof req.body ===
        'object' &&
        !Array.isArray(
            req.body
        )
    ) {
        return req.body;
    }

    return {};
}

// =============================================================================
// Tenant / Request Context
// =============================================================================

function resolveTenantId(
    req
) {
    const tenantId =
        req?.tenant_id ||
        req?.tenantId ||
        req?.tenant?.id ||
        req?.tenant?._id ||
        req?.auth?.tenantId ||
        req?.user?.tenantId ||
        req?.user?.tenant?.id ||
        req?.context?.tenantId;

    return normalizeString(
        tenantId,
        'tenantId',
        {
            required: true
        }
    );
}

function resolvePrincipalId(
    req
) {
    return normalizeString(
        req?.user?.id ||
        req?.user?._id ||
        req?.auth?.userId ||
        req?.auth?.id ||
        req?.principalId ||
        null,
        'principalId'
    );
}

function buildRequestContext(
    req,
    tenantId
) {
    return {
        component:
            COMPONENT,

        tenantId,

        principalId:
            resolvePrincipalId(
                req
            ),

        requestId:
            getHeader(
                req,
                'x-request-id'
            ),

        correlationId:
            getFirstHeader(
                req,
                CORRELATION_HEADERS
            ),

        idempotencyKey:
            getHeader(
                req,
                'idempotency-key'
            ),

        traceId:
            getHeader(
                req,
                'x-trace-id'
            ),

        endpoint:
            req?.originalUrl ||
            null,

        method:
            req?.method ||
            null
    };
}

// =============================================================================
// Authentication
// =============================================================================

function requireAuthenticatedUser(
    req
) {
    if (
        !req?.user &&
        !req?.auth
    ) {
        const error =
            new Error(
                'Authentication required.'
            );

        error.statusCode =
            401;

        error.code =
            'AIRTEL_AUTHENTICATION_REQUIRED';

        throw error;
    }
}

// =============================================================================
// Money
// =============================================================================
//
// IMPORTANT:
// Keep monetary input as a decimal string.
// Do NOT use Number() as the authoritative financial representation.
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

        error.statusCode =
            422;

        error.code =
            'AIRTEL_AMOUNT_REQUIRED';

        throw error;
    }

    const normalized =
        String(
            amount
        ).trim();

    if (
        !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(
            normalized
        )
    ) {
        const error =
            new Error(
                'amount must be a positive fixed-point monetary value with at most two decimal places.'
            );

        error.statusCode =
            422;

        error.code =
            'AIRTEL_INVALID_AMOUNT';

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

        error.statusCode =
            422;

        error.code =
            'AIRTEL_INVALID_AMOUNT';

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

        error.statusCode =
            422;

        error.code =
            'AIRTEL_INVALID_CURRENCY';

        throw error;
    }

    return normalized;
}

// =============================================================================
// Phone Validation
// =============================================================================

function normalizePhoneNumber(
    phoneNumber
) {
    const normalized =
        normalizeString(
            phoneNumber,
            'phoneNumber',
            {
                required: true,
                maxLength:
                    MAX_PHONE_LENGTH
            }
        );

    /**
     * Permit international and common E.164-style formats while rejecting
     * obviously malformed input.
     */
    if (
        !/^\+?[1-9]\d{7,14}$/.test(
            normalized
        )
    ) {
        const error =
            new Error(
                'Invalid phone number format.'
            );

        error.statusCode =
            422;

        error.code =
            'AIRTEL_INVALID_PHONE_NUMBER';

        throw error;
    }

    return normalized;
}

// =============================================================================
// Reference / Idempotency
// =============================================================================

function normalizeReference(
    value,
    field = 'reference'
) {
    return normalizeString(
        value,
        field,
        {
            required: true,
            maxLength:
                MAX_REFERENCE_LENGTH
        }
    );
}

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
// Error Handling
// =============================================================================

function resolveStatusCode(
    error,
    fallback = 500
) {
    const status =
        Number(
            error?.statusCode ||
            error?.status ||
            error?.httpStatus
        );

    if (
        Number.isInteger(
            status
        ) &&
        status >= 400 &&
        status <= 599
    ) {
        return status;
    }

    return fallback;
}

function safeErrorMessage(
    error,
    statusCode
) {
    if (
        statusCode >= 500
    ) {
        return (
            'Airtel Money operation could not be completed.'
        );
    }

    return (
        error?.publicMessage ||
        error?.message ||
        'Airtel Money request could not be processed.'
    );
}

function failure(
    res,
    error,
    {
        statusCode = null,
        correlationId = null
    } = {}
) {
    const resolvedStatus =
        statusCode ||
        resolveStatusCode(
            error
        );

    logger.error(
        {
            component:
                COMPONENT,

            code:
                error?.code,

            message:
                error?.message,

            statusCode:
                resolvedStatus,

            correlationId
        },
        '[AIRTEL CONTROLLER]'
    );

    return res
        .status(
            resolvedStatus
        )
        .json({
            success:
                false,

            code:
                error?.code ||
                'AIRTEL_REQUEST_FAILED',

            message:
                safeErrorMessage(
                    error,
                    resolvedStatus
                ),

            correlationId,

            timestamp:
                new Date().toISOString()
        });
}

function delegateError(
    error,
    req,
    res,
    next
) {
    if (
        typeof handleError ===
        'function'
    ) {
        return handleError(
            error,
            req,
            res,
            next
        );
    }

    return failure(
        res,
        error,
        {
            correlationId:
                getFirstHeader(
                    req,
                    CORRELATION_HEADERS
                )
        }
    );
}

// =============================================================================
// Response Helpers
// =============================================================================

function success(
    res,
    data,
    message = 'Success',
    statusCode = 200,
    meta = {}
) {
    return res
        .status(
            statusCode
        )
        .json({
            success:
                true,

            message,

            data,

            meta,

            timestamp:
                new Date().toISOString()
        });
}

// =============================================================================
// Service Invocation
// =============================================================================
//
// Additional context is passed as a second argument for newer enterprise
// service implementations. Existing one-argument services remain compatible
// because JavaScript ignores unused arguments.
//
// =============================================================================

async function invokeService(
    service,
    method,
    payload,
    context
) {
    if (
        !service ||
        typeof service[
            method
        ] !==
        'function'
    ) {
        const error =
            new Error(
                `Airtel service method "${method}" is unavailable.`
            );

        error.statusCode =
            503;

        error.code =
            'AIRTEL_SERVICE_METHOD_UNAVAILABLE';

        throw error;
    }

    return service[
        method
    ](
        payload,
        context
    );
}

// =============================================================================
// Common Financial Request Normalization
// =============================================================================

function buildFinancialPayload(
    req,
    {
        requirePhone = false,
        requireReference = false
    } = {}
) {
    const body =
        getBody(
            req
        );

    const tenantId =
        resolveTenantId(
            req
        );

    const idempotencyKey =
        requireIdempotencyKey(
            req
        );

    const payload = {
        ...body,

        tenantId,

        amount:
            normalizeAmount(
                body.amount
            ),

        currency:
            normalizeCurrency(
                body.currency
            ),

        idempotencyKey,

        correlationId:
            getFirstHeader(
                req,
                CORRELATION_HEADERS
            )
    };

    if (
        requirePhone
    ) {
        payload.phoneNumber =
            normalizePhoneNumber(
                body.phoneNumber
            );
    }

    if (
        requireReference
    ) {
        payload.reference =
            normalizeReference(
                body.reference ||
                body.paymentReference ||
                body.transactionReference
            );
    }

    return {
        payload,

        context:
            buildRequestContext(
                req,
                tenantId
            )
    };
}

// =============================================================================
// POST /deposit
// =============================================================================

exports.deposit =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const {
                payload,
                context
            } =
                buildFinancialPayload(
                    req,
                    {
                        requirePhone:
                            true
                    }
                );

            const result =
                await invokeService(
                    collectionsService,
                    'deposit',
                    payload,
                    context
                );

            return success(
                res,
                result,
                'Deposit initiated.',
                201,
                {
                    operation:
                        'DEPOSIT_CREATE',

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// POST /withdraw
// =============================================================================

exports.withdraw =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const {
                payload,
                context
            } =
                buildFinancialPayload(
                    req,
                    {
                        requirePhone:
                            true
                    }
                );

            const result =
                await invokeService(
                    disbursementService,
                    'withdraw',
                    payload,
                    context
                );

            return success(
                res,
                result,
                'Withdrawal initiated.',
                201,
                {
                    operation:
                        'WITHDRAWAL_CREATE',

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// POST /repay-loan
// =============================================================================

exports.repayLoan =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const {
                payload,
                context
            } =
                buildFinancialPayload(
                    req,
                    {
                        requirePhone:
                            true
                    }
                );

            const result =
                await invokeService(
                    collectionsService,
                    'repayLoan',
                    payload,
                    context
                );

            return success(
                res,
                result,
                'Loan repayment initiated.',
                201,
                {
                    operation:
                        'LOAN_REPAYMENT',

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// POST /contribute-savings
// =============================================================================

exports.contributeSavings =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const {
                payload,
                context
            } =
                buildFinancialPayload(
                    req,
                    {
                        requirePhone:
                            true
                    }
                );

            const result =
                await invokeService(
                    collectionsService,
                    'contributeSavings',
                    payload,
                    context
                );

            return success(
                res,
                result,
                'Savings contribution initiated.',
                201,
                {
                    operation:
                        'CONTRIBUTION_CREATE',

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// POST /disburse
// =============================================================================

exports.disburse =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const {
                payload,
                context
            } =
                buildFinancialPayload(
                    req
                );

            const result =
                await invokeService(
                    disbursementService,
                    'disburse',
                    payload,
                    context
                );

            return success(
                res,
                result,
                'Loan disbursement initiated.',
                201,
                {
                    operation:
                        'LOAN_DISBURSEMENT',

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// POST /bulk-disburse
// =============================================================================

exports.bulkDisburse =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const tenantId =
                resolveTenantId(
                    req
                );

            const idempotencyKey =
                requireIdempotencyKey(
                    req
                );

            const body =
                getBody(
                    req
                );

            const transactions =
                body.transactions;

            if (
                !Array.isArray(
                    transactions
                )
            ) {
                const error =
                    new Error(
                        'transactions array is required.'
                    );

                error.statusCode =
                    422;

                error.code =
                    'AIRTEL_TRANSACTIONS_ARRAY_REQUIRED';

                throw error;
            }

            if (
                transactions.length ===
                0
            ) {
                const error =
                    new Error(
                        'transactions array cannot be empty.'
                    );

                error.statusCode =
                    422;

                error.code =
                    'AIRTEL_TRANSACTIONS_ARRAY_EMPTY';

                throw error;
            }

            if (
                transactions.length >
                MAX_BULK_TRANSACTIONS
            ) {
                const error =
                    new Error(
                        `Bulk operation cannot contain more than ${MAX_BULK_TRANSACTIONS} transactions.`
                    );

                error.statusCode =
                    422;

                error.code =
                    'AIRTEL_BULK_TRANSACTION_LIMIT_EXCEEDED';

                throw error;
            }

            const normalizedTransactions =
                transactions.map(
                    transaction => {
                        if (
                            !transaction ||
                            typeof transaction !==
                            'object'
                        ) {
                            const error =
                                new Error(
                                    'Each bulk transaction must be an object.'
                                );

                            error.statusCode =
                                422;

                            error.code =
                                'AIRTEL_INVALID_BULK_TRANSACTION';

                            throw error;
                        }

                        return {
                            ...transaction,

                            amount:
                                normalizeAmount(
                                    transaction.amount
                                ),

                            currency:
                                normalizeCurrency(
                                    transaction.currency
                                ),

                            phoneNumber:
                                normalizePhoneNumber(
                                    transaction.phoneNumber
                                )
                        };
                    }
                );

            const context =
                buildRequestContext(
                    req,
                    tenantId
                );

            const result =
                await invokeService(
                    disbursementService,
                    'bulkTransfer',
                    normalizedTransactions,
                    {
                        ...context,

                        tenantId,

                        idempotencyKey
                    }
                );

            return success(
                res,
                result,
                'Bulk disbursement submitted.',
                202,
                {
                    operation:
                        'BULK_LOAN_DISBURSEMENT',

                    count:
                        normalizedTransactions.length,

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// POST /webhook
// =============================================================================

exports.webhook =
    async (
        req,
        res,
        next
    ) => {
        const correlationId =
            getFirstHeader(
                req,
                CORRELATION_HEADERS
            );

        try {
            /**
             * Webhooks normally authenticate themselves through the provider
             * signature rather than an application JWT.
             *
             * Do NOT impose requireAuthenticatedUser() here.
             */

            const signature =
                getFirstHeader(
                    req,
                    SIGNATURE_HEADERS
                );

            if (
                !signature
            ) {
                const error =
                    new Error(
                        'Airtel webhook signature is required.'
                    );

                error.statusCode =
                    401;

                error.code =
                    'AIRTEL_WEBHOOK_SIGNATURE_REQUIRED';

                throw error;
            }

            /**
             * req.rawBody MUST preferably come from express raw-body capture.
             *
             * Re-serializing req.body can alter:
             *   - whitespace
             *   - property ordering
             *   - encoding
             *   - number representation
             *
             * Therefore reconstructed JSON is compatibility fallback only.
             */
            const rawBody =
                req.rawBody ||
                req.bodyRaw ||
                (
                    typeof req.body ===
                    'string'
                        ? req.body
                        : JSON.stringify(
                            req.body
                        )
                );

            if (
                !rawBody
            ) {
                const error =
                    new Error(
                        'Webhook raw body is unavailable.'
                    );

                error.statusCode =
                    400;

                error.code =
                    'AIRTEL_WEBHOOK_RAW_BODY_REQUIRED';

                throw error;
            }

            const result =
                await invokeService(
                    webhookService,
                    'processWebhook',
                    {
                        payload:
                            req.body,

                        rawBody,

                        signature,

                        sourceIP:
                            req.ip ||
                            null,

                        headers:
                            req.headers,

                        correlationId,

                        receivedAt:
                            new Date()
                    },
                    {
                        component:
                            COMPONENT,

                        correlationId
                    }
                );

            /**
             * Do not expose internal provider/webhook-processing details in
             * the acknowledgement.
             */
            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    acknowledged:
                        true,

                    message:
                        'Webhook acknowledged.',

                    correlationId
                });
        } catch (
            error
        ) {
            logger.error(
                {
                    component:
                        COMPONENT,

                    event:
                        'airtel.webhook.failed',

                    correlationId,

                    code:
                        error?.code,

                    message:
                        error?.message
                },
                'Airtel webhook processing failed'
            );

            /**
             * For webhook failures, returning 4xx is appropriate when the
             * provider should not be told the event was accepted.
             *
             * Central error middleware remains preferred where configured.
             */
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// GET /status/:reference
// =============================================================================

exports.getStatus =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const tenantId =
                resolveTenantId(
                    req
                );

            const reference =
                normalizeReference(
                    req.params.reference,
                    'reference'
                );

            const context =
                buildRequestContext(
                    req,
                    tenantId
                );

            const result =
                await invokeService(
                    collectionsService,
                    'getStatus',
                    {
                        reference,
                        tenantId
                    },
                    context
                );

            return success(
                res,
                result,
                'Payment status retrieved.',
                200,
                {
                    operation:
                        'PAYMENT_STATUS',

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// GET /reconciliation/:date
// =============================================================================

exports.getReconciliation =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const tenantId =
                resolveTenantId(
                    req
                );

            const date =
                normalizeString(
                    req.params.date,
                    'date',
                    {
                        required:
                            true,
                        maxLength:
                            32
                    }
                );

            /**
             * Accept YYYY-MM-DD only at the controller boundary.
             */
            if (
                !/^\d{4}-\d{2}-\d{2}$/.test(
                    date
                )
            ) {
                const error =
                    new Error(
                        'date must use YYYY-MM-DD format.'
                    );

                error.statusCode =
                    422;

                error.code =
                    'AIRTEL_INVALID_RECONCILIATION_DATE';

                throw error;
            }

            const context =
                buildRequestContext(
                    req,
                    tenantId
                );

            const report =
                await invokeService(
                    reconciliationService,
                    'reconcileDaily',
                    {
                        date,
                        tenantId
                    },
                    context
                );

            return success(
                res,
                report,
                'Airtel reconciliation report retrieved.',
                200,
                {
                    operation:
                        'AIRTEL_RECONCILIATION',

                    correlationId:
                        context.correlationId
                }
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// GET /health
// =============================================================================

exports.health =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const results =
                await Promise.allSettled([
                    collectionsService.healthCheck(),
                    disbursementService.healthCheck(),
                    webhookService.healthCheck(),
                    reconciliationService.healthCheck()
                ]);

            const services = {
                collections:
                    normalizeHealthResult(
                        results[0]
                    ),

                disbursements:
                    normalizeHealthResult(
                        results[1]
                    ),

                webhooks:
                    normalizeHealthResult(
                        results[2]
                    ),

                reconciliation:
                    normalizeHealthResult(
                        results[3]
                    )
            };

            const healthy =
                Object.values(
                    services
                ).every(
                    item =>
                        item.healthy ===
                        true
                );

            return success(
                res,
                {
                    healthy,
                    services
                },
                healthy
                    ? 'Airtel services healthy.'
                    : 'Airtel services degraded.',
                healthy
                    ? 200
                    : 503
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

// =============================================================================
// Health Result Normalization
// =============================================================================

function normalizeHealthResult(
    result
) {
    if (
        result?.status ===
        'fulfilled'
    ) {
        const value =
            result.value;

        return {
            healthy:
                value?.healthy ??
                value?.status ===
                    'healthy' ??
                true,

            data:
                value ??
                null
        };
    }

    return {
        healthy:
            false,

        error:
            'Service health check failed.'
    };
}

// =============================================================================
// GET /metrics
// =============================================================================

exports.metrics =
    async (
        req,
        res,
        next
    ) => {
        try {
            requireAuthenticatedUser(
                req
            );

            const [
                collections,
                disbursements,
                webhooks,
                reconciliation
            ] =
                await Promise.all([
                    Promise.resolve(
                        collectionsService.getMetrics()
                    ),

                    Promise.resolve(
                        disbursementService.getMetrics()
                    ),

                    Promise.resolve(
                        webhookService.getMetrics()
                    ),

                    Promise.resolve(
                        reconciliationService.getMetrics()
                    )
                ]);

            return success(
                res,
                {
                    collections,
                    disbursements,
                    webhooks,
                    reconciliation
                },
                'Airtel metrics retrieved.'
            );
        } catch (
            error
        ) {
            return delegateError(
                error,
                req,
                res,
                next
            );
        }
    };

module.exports =
    exports;