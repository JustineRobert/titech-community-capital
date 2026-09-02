'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Finance HTTP Routes
 * ============================================================================
 *
 * File:
 * backend/modules/finance/routes.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Authentication
 * - Trusted tenant isolation
 * - Request correlation
 * - Financial mutation rate limiting
 * - Strict request validation
 * - Idempotency enforcement
 * - Safe request normalization
 * - Delegation to finance application services
 * - Stable HTTP response contracts
 *
 * Architectural Rule
 * ----------------------------------------------------------------------------
 * Routes remain thin.
 *
 * Financial business logic belongs in:
 *
 * - application services
 * - domain services
 * - Ledger Engine
 * - payment orchestration
 *
 * Routes MUST NOT:
 * - update balances
 * - create ledger entries
 * - perform repayment calculations
 * - bypass idempotency
 * - trust tenantId supplied by clients
 *
 * Processing
 * ----------------------------------------------------------------------------
 *
 * HTTP Request
 *      |
 *      v
 * Authentication
 *      |
 *      v
 * Tenant Resolution
 *      |
 *      v
 * Request Correlation
 *      |
 *      v
 * Rate Limiting
 *      |
 *      v
 * Idempotency
 *      |
 *      v
 * Strict Validation
 *      |
 *      v
 * Repayment Application Service
 *      |
 *      v
 * Ledger / Transaction Boundary
 *      |
 *      v
 * HTTP Response
 *
 * ============================================================================
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');

const asyncHandler =
    require('../../../utils/asyncHandler');

const {
    requireAuth,
} = require('../../../middleware/auth');

const {
    requireTenant,
} = require('../../../middleware/tenant');

const {
    processRepayment,
} = require('./services/repaymentService');

const router =
    express.Router();

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_CURRENCY =
    'UGX';

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

const MAX_REQUEST_ID_LENGTH =
    255;

const MAX_CORRELATION_ID_LENGTH =
    255;

const MAX_LOAN_ID_LENGTH =
    128;

const MAX_WALLET_ID_LENGTH =
    128;

const MAX_ACCOUNT_CODE_LENGTH =
    128;

const MAX_DESCRIPTION_LENGTH =
    1024;

const MAX_METADATA_KEYS =
    100;

const MAX_METADATA_DEPTH =
    6;

const MAX_METADATA_ARRAY_LENGTH =
    100;

const REPAYMENT_RATE_LIMIT_WINDOW_MS =
    60 * 1000;

const REPAYMENT_RATE_LIMIT_MAX =
    10;

/**
 * ============================================================================
 * Supported Providers
 * ============================================================================
 *
 * Keep this list aligned with the payment-provider subsystem.
 *
 * The finance route does not perform provider configuration; it only accepts
 * a bounded provider identifier for downstream orchestration.
 * ============================================================================
 */

const SUPPORTED_PROVIDERS =
    Object.freeze([
        'MTN_MOMO',
        'AIRTEL_MONEY',
        'MANUAL',
        'API',
    ]);

/**
 * ============================================================================
 * HTTP Error Helpers
 * ============================================================================
 */

function sendClientError(
    res,
    status,
    error,
    details = undefined
) {
    const response = {
        success:
            false,

        error:
            typeof error === 'string'
                ? error
                : 'Request failed.',
    };

    if (
        details !== undefined
    ) {
        response.details =
            details;
    }

    return res
        .status(status)
        .json(response);
}

/**
 * ============================================================================
 * Request Correlation
 * ============================================================================
 */

function normalizeRequestIdentifier(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        return null;
    }

    const normalized =
        value.trim();

    if (
        normalized.length === 0
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        return null;
    }

    /**
     * Keep correlation identifiers log/index friendly.
     *
     * UUIDs and normal distributed tracing IDs pass naturally.
     */
    if (
        !/^[A-Za-z0-9._:-]+$/.test(
            normalized
        )
    ) {
        return null;
    }

    return normalized;
}

function resolveRequestId(
    req
) {
    return (
        normalizeRequestIdentifier(
            req.id,
            'requestId',
            MAX_REQUEST_ID_LENGTH
        ) ||
        normalizeRequestIdentifier(
            req.requestId,
            'requestId',
            MAX_REQUEST_ID_LENGTH
        ) ||
        normalizeRequestIdentifier(
            req.headers['x-request-id'],
            'requestId',
            MAX_REQUEST_ID_LENGTH
        ) ||
        null
    );
}

function resolveCorrelationId(
    req
) {
    return (
        normalizeRequestIdentifier(
            req.correlationId,
            'correlationId',
            MAX_CORRELATION_ID_LENGTH
        ) ||
        normalizeRequestIdentifier(
            req.headers['x-correlation-id'],
            'correlationId',
            MAX_CORRELATION_ID_LENGTH
        ) ||
        null
    );
}

/**
 * ============================================================================
 * Rate Limiter
 * ============================================================================
 *
 * The global limiter remains responsible for broad API protection.
 *
 * This limiter specifically protects the repayment mutation.
 * ============================================================================
 */

const repayLimiter =
    rateLimit({

        windowMs:
            REPAYMENT_RATE_LIMIT_WINDOW_MS,

        max:
            REPAYMENT_RATE_LIMIT_MAX,

        standardHeaders:
            true,

        legacyHeaders:
            false,

        skipSuccessfulRequests:
            false,

        handler(
            req,
            res
        ) {

            return sendClientError(
                res,
                429,
                'Too many repayment requests. Please try again later.'
            );
        },

    });

/**
 * ============================================================================
 * Strict Metadata Validation
 * ============================================================================
 *
 * Joi's object validation controls the shape, while this helper protects
 * against prototype-pollution and pathological nested structures.
 * ============================================================================
 */

function validateMetadataValue(
    value,
    path = 'metadata',
    depth = 0
) {
    if (
        depth >
        MAX_METADATA_DEPTH
    ) {
        throw new Error(
            `${path} exceeds maximum nesting depth`
        );
    }

    if (
        value === null ||
        value === undefined
    ) {
        return;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'boolean'
    ) {
        return;
    }

    if (
        typeof value === 'number'
    ) {
        if (
            !Number.isFinite(value)
        ) {
            throw new Error(
                `${path} contains a non-finite number`
            );
        }

        return;
    }

    if (
        Array.isArray(value)
    ) {
        if (
            value.length >
            MAX_METADATA_ARRAY_LENGTH
        ) {
            throw new Error(
                `${path} array exceeds maximum length`
            );
        }

        value.forEach(
            (
                item,
                index
            ) =>
                validateMetadataValue(
                    item,
                    `${path}[${index}]`,
                    depth + 1
                )
        );

        return;
    }

    if (
        typeof value === 'object'
    ) {
        for (
            const [
                key,
                child
            ] of Object.entries(
                value
            )
        ) {

            if (
                key === '__proto__' ||
                key === 'prototype' ||
                key === 'constructor'
            ) {
                throw new Error(
                    `${path}.${key} is not permitted`
                );
            }

            validateMetadataValue(
                child,
                `${path}.${key}`,
                depth + 1
            );
        }

        return;
    }

    throw new Error(
        `${path} contains an unsupported value`
    );
}

/**
 * ============================================================================
 * Money Validation
 * ============================================================================
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * The route accepts a decimal string instead of a JavaScript floating-point
 * number.
 *
 * This prevents avoidable binary floating-point ambiguity at the HTTP boundary.
 *
 * The repayment service can convert this to Decimal128 / exact monetary type.
 * ============================================================================
 */

const MONEY_PATTERN =
    /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/;

const AMOUNT_SCHEMA =
    Joi.alternatives()
        .try(
            Joi.string()
                .trim()
                .pattern(
                    MONEY_PATTERN
                ),

            Joi.number()
                .positive()
                .precision(2)
                .unsafe(false)
        )
        .custom(
            (
                value,
                helpers
            ) => {

                const normalized =
                    String(value).trim();

                if (
                    !MONEY_PATTERN.test(
                        normalized
                    )
                ) {
                    return helpers.error(
                        'any.invalid'
                    );
                }

                if (
                    normalized.endsWith('.')
                ) {
                    return helpers.error(
                        'any.invalid'
                    );
                }

                return normalized;
            }
        )
        .required();

/**
 * ============================================================================
 * Joi Validation Schema
 * ============================================================================
 *
 * Unknown fields are rejected rather than silently stripped.
 *
 * This is intentional for a financial mutation endpoint.
 * ============================================================================
 */

const repaySchema =
    Joi.object({

        loanId:
            Joi.string()
                .trim()
                .min(1)
                .max(
                    MAX_LOAN_ID_LENGTH
                )
                .pattern(
                    /^[A-Za-z0-9._:-]+$/
                )
                .required(),

        walletId:
            Joi.string()
                .trim()
                .min(1)
                .max(
                    MAX_WALLET_ID_LENGTH
                )
                .pattern(
                    /^[A-Za-z0-9._:-]+$/
                )
                .required(),

        amount:
            AMOUNT_SCHEMA,

        currency:
            Joi.string()
                .trim()
                .length(3)
                .uppercase()
                .default(
                    DEFAULT_CURRENCY
                ),

        debitAccountCode:
            Joi.string()
                .trim()
                .min(1)
                .max(
                    MAX_ACCOUNT_CODE_LENGTH
                )
                .pattern(
                    /^[A-Za-z0-9._:-]+$/
                )
                .optional(),

        creditAccountCode:
            Joi.string()
                .trim()
                .min(1)
                .max(
                    MAX_ACCOUNT_CODE_LENGTH
                )
                .pattern(
                    /^[A-Za-z0-9._:-]+$/
                )
                .optional(),

        description:
            Joi.string()
                .trim()
                .max(
                    MAX_DESCRIPTION_LENGTH
                )
                .allow('')
                .optional(),

        provider:
            Joi.string()
                .trim()
                .uppercase()
                .valid(
                    ...SUPPORTED_PROVIDERS
                )
                .optional(),

        momoTransactionId:
            Joi.string()
                .trim()
                .min(1)
                .max(255)
                .pattern(
                    /^[A-Za-z0-9._:-]+$/
                )
                .optional(),

        metadata:
            Joi.object()
                .max(
                    MAX_METADATA_KEYS
                )
                .default({})

    })
        .required()
        .unknown(false);

/**
 * ============================================================================
 * Require Idempotency Key
 * ============================================================================
 *
 * Financial mutation endpoints MUST supply a caller-controlled idempotency
 * identity separately from the payment/business identity.
 * ============================================================================
 */

function requireIdempotencyKey(
    req,
    res,
    next
) {

    const rawKey =
        req.headers['idempotency-key'];

    const idempotencyKey =
        Array.isArray(rawKey)
            ? rawKey[0]
            : rawKey;

    const normalizedKey =
        typeof idempotencyKey === 'string'
            ? idempotencyKey.trim()
            : '';

    if (
        !normalizedKey
    ) {

        return sendClientError(
            res,
            400,
            'Idempotency-Key header is required.'
        );
    }

    if (
        normalizedKey.length >
        MAX_IDEMPOTENCY_KEY_LENGTH
    ) {

        return sendClientError(
            res,
            400,
            'Idempotency-Key exceeds the maximum allowed length.'
        );
    }

    /**
     * Accept common idempotency-key formats while rejecting whitespace,
     * control characters, and header-injection material.
     */
    if (
        !/^[A-Za-z0-9._:-]+$/.test(
            normalizedKey
        )
    ) {

        return sendClientError(
            res,
            400,
            'Idempotency-Key contains unsupported characters.'
        );
    }

    req.idempotencyKey =
        normalizedKey;

    return next();
}

/**
 * ============================================================================
 * Request Correlation Middleware
 * ============================================================================
 */

function resolveCorrelation(
    req,
    res,
    next
) {

    const requestId =
        resolveRequestId(
            req
        );

    const correlationId =
        resolveCorrelationId(
            req
        ) ||
        requestId;

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

    return next();
}

/**
 * ============================================================================
 * Validate Repayment Body
 * ============================================================================
 */

function validateRepayBody(
    req,
    res,
    next
) {

    const {
        error,
        value,
    } =
        repaySchema.validate(
            req.body,
            {
                abortEarly:
                    false,

                /**
                 * IMPORTANT:
                 * Financial APIs should reject unknown fields.
                 */
                allowUnknown:
                    false,

                stripUnknown:
                    false,

                convert:
                    true,
            }
        );

    if (
        error
    ) {

        const validationErrors =
            error.details.map(
                detail => ({
                    field:
                        detail.path.join('.'),

                    code:
                        detail.type,

                    message:
                        detail.message,
                })
            );

        return sendClientError(
            res,
            400,
            'Invalid repayment request.',
            validationErrors
        );
    }

    try {

        validateMetadataValue(
            value.metadata
        );

    } catch (
        metadataError
    ) {

        return sendClientError(
            res,
            400,
            'Invalid repayment metadata.',
            [
                {
                    field:
                        'metadata',

                    code:
                        'INVALID_METADATA',

                    message:
                        metadataError.message,
                },
            ]
        );
    }

    /**
     * Canonical financial representation.
     */
    req.validatedBody =
        {
            ...value,

            amount:
                String(
                    value.amount
                ).trim(),

            currency:
                String(
                    value.currency
                )
                    .trim()
                    .toUpperCase(),

            provider:
                value.provider
                    ? String(
                        value.provider
                    )
                        .trim()
                        .toUpperCase()
                    : null,

            debitAccountCode:
                value.debitAccountCode ||
                null,

            creditAccountCode:
                value.creditAccountCode ||
                null,

            description:
                value.description ||
                null,

            momoTransactionId:
                value.momoTransactionId ||
                null,

            metadata:
                value.metadata ||
                {},
        };

    return next();
}

/**
 * ============================================================================
 * Validate Request Context
 * ============================================================================
 *
 * Authentication and tenant middleware establish the trusted identity.
 * ============================================================================
 */

function validateFinanceContext(
    req,
    res,
    next
) {

    if (
        !req.user ||
        !req.user.id
    ) {

        return sendClientError(
            res,
            401,
            'Authentication required.'
        );
    }

    if (
        !req.tenant ||
        !req.tenant.id
    ) {

        return sendClientError(
            res,
            403,
            'Tenant context required.'
        );
    }

    /**
     * Never allow client payload tenant identity to become authoritative.
     */
    req.tenantId =
        String(
            req.tenant.id
        ).trim();

    if (
        !req.tenantId
    ) {

        return sendClientError(
            res,
            403,
            'Valid tenant context required.'
        );
    }

    return next();
}

/**
 * ============================================================================
 * Normalize Service Error
 * ============================================================================
 *
 * Keeps the route compatible with domain/application errors that expose
 * statusCode/status/retryable without leaking stack traces.
 * ============================================================================
 */

function resolveServiceErrorStatus(
    error
) {

    const candidate =
        Number(
            error?.statusCode ??
            error?.status
        );

    if (
        Number.isInteger(
            candidate
        ) &&
        candidate >= 400 &&
        candidate <= 599
    ) {
        return candidate;
    }

    /**
     * Common domain conflict cases.
     */
    if (
        [
            'IDEMPOTENCY_CONFLICT',
            'IDEMPOTENCY_KEY_REUSED',
            'PAYMENT_ALREADY_COMPLETED',
            'PAYMENT_ALREADY_PROCESSING',
            'FINANCIAL_CONFLICT',
        ].includes(
            error?.code
        )
    ) {
        return 409;
    }

    return 500;
}

function buildSafeServiceError(
    error
) {

    const status =
        resolveServiceErrorStatus(
            error
        );

    /**
     * Do not expose raw internal messages for 5xx failures.
     */
    const publicMessage =
        status >= 500
            ? 'Unable to process repayment.'
            : (
                error?.message ||
                'Repayment request failed.'
            );

    return {
        status,

        message:
            publicMessage,

        code:
            status < 500
                ? (
                    error?.code ||
                    'PAYMENT_REQUEST_FAILED'
                )
                : 'PAYMENT_PROCESSING_FAILED',

        retryable:
            error?.retryable === true,
    };
}

/**
 * ============================================================================
 * POST /repay
 * ============================================================================
 *
 * @openapi
 * /api/finance/repay:
 *   post:
 *     summary: Process a loan repayment
 *     description: >
 *       Processes a tenant-scoped loan repayment through the finance
 *       application service. The operation requires an Idempotency-Key.
 *     tags:
 *       - Finance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 255
 *       - in: header
 *         name: X-Request-Id
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 255
 *       - in: header
 *         name: X-Correlation-Id
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 255
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required:
 *               - loanId
 *               - walletId
 *               - amount
 *             properties:
 *               loanId:
 *                 type: string
 *               walletId:
 *                 type: string
 *               amount:
 *                 type: string
 *                 pattern: '^[0-9]+(\\.[0-9]{1,2})?$'
 *                 description: Exact decimal repayment amount.
 *               currency:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 3
 *                 example: UGX
 *               debitAccountCode:
 *                 type: string
 *               creditAccountCode:
 *                 type: string
 *               description:
 *                 type: string
 *                 maxLength: 1024
 *               provider:
 *                 type: string
 *                 enum:
 *                   - MTN_MOMO
 *                   - AIRTEL_MONEY
 *                   - MANUAL
 *                   - API
 *               momoTransactionId:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       '200':
 *         description: Repayment processed successfully.
 *       '400':
 *         description: Invalid request or missing idempotency key.
 *       '401':
 *         description: Authentication required.
 *       '403':
 *         description: Tenant context required.
 *       '409':
 *         description: Idempotency or financial conflict.
 *       '429':
 *         description: Too many repayment requests.
 *       '500':
 *         description: Internal server error.
 */

router.post(
    '/repay',

    requireAuth,

    requireTenant,

    validateFinanceContext,

    resolveCorrelation,

    repayLimiter,

    requireIdempotencyKey,

    validateRepayBody,

    asyncHandler(
        async (
            req,
            res
        ) => {

            const body =
                req.validatedBody;

            const tenantId =
                req.tenantId;

            const userId =
                String(
                    req.user.id
                ).trim();

            const requestId =
                req.requestId;

            const correlationId =
                req.correlationId;

            const idempotencyKey =
                req.idempotencyKey;

            /**
             * ----------------------------------------------------------------
             * Downstream application-service options
             * ----------------------------------------------------------------
             */

            const opts = {

                currency:
                    body.currency,

                debitAccountCode:
                    body.debitAccountCode,

                creditAccountCode:
                    body.creditAccountCode,

                description:
                    body.description,

                requestId,

                correlationId,

                idempotencyKey,

                provider:
                    body.provider,

                momoTransactionId:
                    body.momoTransactionId,

                metadata:
                    body.metadata,

                createdBy:
                    userId,
            };

            /**
             * ----------------------------------------------------------------
             * Financial application service
             * ----------------------------------------------------------------
             *
             * The route passes tenant identity from trusted middleware.
             * The client cannot override it.
             */

            const result =
                await processRepayment({

                    tenantId,

                    loanId:
                        body.loanId,

                    payerWalletId:
                        body.walletId,

                    amount:
                        body.amount,

                    /**
                     * Preserve backward compatibility if the repayment
                     * service currently expects paymentId.
                     *
                     * Idempotency identity remains distinct in opts.
                     */
                    paymentId:
                        idempotencyKey,

                    opts,
                });

            /**
             * ----------------------------------------------------------------
             * Stable response contract
             * ----------------------------------------------------------------
             */

            return res
                .status(200)
                .json({

                    success:
                        true,

                    result,

                    requestId:
                        requestId ||
                        null,

                    correlationId:
                        correlationId ||
                        null,
                });
        }
    )
);

/**
 * ============================================================================
 * Error Normalization
 * ============================================================================
 *
 * This middleware is deliberately local and minimal. Global error middleware
 * may still perform final cross-application normalization.
 * ============================================================================
 */

router.use(
    (
        error,
        req,
        res,
        next
    ) => {

        /**
         * If the response is already committed, allow Express/global middleware
         * to handle the connection.
         */
        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        const normalized =
            buildSafeServiceError(
                error
            );

        return res
            .status(
                normalized.status
            )
            .json({

                success:
                    false,

                error:
                    normalized.message,

                code:
                    normalized.code,

                requestId:
                    req.requestId ||
                    null,

                correlationId:
                    req.correlationId ||
                    null,

                ...(normalized.retryable
                    ? {
                        retryable:
                            true,
                    }
                    : {}),
            });
    }
);

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    router;