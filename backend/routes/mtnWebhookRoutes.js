'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise MTN Mobile Money Webhook Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/mtnWebhookRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure provider callback boundary for MTN Mobile Money events.
 *
 * Canonical endpoint
 * ----------------------------------------------------------------------------
 *
 * POST /mtn/callback
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   MTN Provider
 *       ↓
 *   Webhook Authentication / Signature Verification
 *       ↓
 *   Request / Correlation Context
 *       ↓
 *   Rate Limiting
 *       ↓
 *   Payload Validation
 *       ↓
 *   Webhook Controller / Service
 *       ↓
 *   Replay / Idempotency Protection
 *       ↓
 *   Financial Transaction Service
 *       ├── Transaction State
 *       ├── Ledger
 *       ├── Wallet
 *       ├── Loan
 *       └── Audit
 *       ↓
 *   Provider Acknowledgement
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This route MUST NOT:
 *
 *   ✗ trust tenantId from req.body
 *   ✗ trust userId from req.body
 *   ✗ directly credit/debit wallets
 *   ✗ directly post ledger entries
 *   ✗ directly change loan balances
 *   ✗ directly write Transaction records
 *   ✗ authenticate MTN with user JWT
 *   ✗ log the complete webhook payload
 *
 * Provider authenticity, replay protection, transaction state transitions and
 * financial posting belong to the webhook service/domain layer.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const express =
    require('express');

const crypto =
    require('node:crypto');

const rateLimit =
    require('express-rate-limit');

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

const mtnWebhookMiddleware =
    require(
        '../middleware/mtnWebhookMiddleware'
    );

/**
 * ============================================================================
 * Optional Webhook Service / Controller
 * ============================================================================
 *
 * The project may expose the canonical MTN callback handler under one of the
 * following paths/contracts. We resolve it at startup and fail closed if
 * production configuration requires it.
 * ============================================================================
 */

const webhookHandler =
    resolveWebhookHandler();

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechMtnWebhookRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech MTN Webhook';

const MAX_BODY_LIMIT =
    process.env.TITECH_MTN_WEBHOOK_BODY_LIMIT ||
    '256kb';

/**
 * ============================================================================
 * Dependency Validation
 * ============================================================================
 */

if (
    typeof mtnWebhookMiddleware !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] mtnWebhookMiddleware must be a function.`
    );
}

/**
 * ============================================================================
 * Request / Correlation Context
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return fallback;
    }

    const normalized =
        String(
            value
        ).trim();

    return (
        normalized ||
        fallback
    );
}

function requestMetadata(
    req,
    res,
    next
) {
    const requestId =
        normalizeString(
            req.requestId
        ) ||
        normalizeString(
            req.id
        ) ||
        normalizeString(
            req.headers?.[
                'x-request-id'
            ]
        ) ||
        crypto.randomUUID();

    const correlationId =
        normalizeString(
            req.correlationId
        ) ||
        normalizeString(
            req.headers?.[
                'x-correlation-id'
            ]
        ) ||
        requestId;

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

    res.setHeader(
        'X-Request-Id',
        requestId
    );

    res.setHeader(
        'X-Correlation-Id',
        correlationId
    );

    next();
}

router.use(
    requestMetadata
);

/**
 * ============================================================================
 * Security Headers
 * ============================================================================
 */

router.use(
    (
        req,
        res,
        next
    ) => {
        res.setHeader(
            'Cache-Control',
            'no-store'
        );

        res.setHeader(
            'Pragma',
            'no-cache'
        );

        res.setHeader(
            'X-Content-Type-Options',
            'nosniff'
        );

        res.setHeader(
            'Referrer-Policy',
            'no-referrer'
        );

        next();
    }
);

/**
 * ============================================================================
 * WEBHOOK BODY PARSING
 * ============================================================================
 *
 * IMPORTANT:
 * If `mtnWebhookMiddleware` verifies signatures against the raw HTTP body,
 * it must execute BEFORE express.json(), or the application bootstrap must
 * provide a raw-body parser that the middleware understands.
 *
 * We therefore allow the middleware to own parsing when appropriate.
 *
 * If your middleware expects req.body to already exist, set:
 *
 *   TITECH_MTN_WEBHOOK_PARSER_MODE=json
 *
 * Otherwise, the middleware remains the first parsing/security boundary.
 * ============================================================================
 */

const webhookParserMode =
    String(
        process.env
            .TITECH_MTN_WEBHOOK_PARSER_MODE ||
            'middleware'
    ).toLowerCase();

if (
    webhookParserMode ===
    'json'
) {
    router.use(
        express.json({
            limit:
                MAX_BODY_LIMIT,

            strict:
                true,
        })
    );
}

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 *
 * Provider callbacks should also be protected at the API gateway/load balancer
 * where possible.
 * ============================================================================
 */

const webhookLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MTN_WEBHOOK_RATE_LIMIT',
                300
            ),

        standardHeaders:
            'draft-8',

        legacyHeaders:
            false,

        skipSuccessfulRequests:
            false,

        keyGenerator(
            req
        ) {
            return (
                normalizeString(
                    req.ip
                ) ||
                normalizeString(
                    req.socket?.remoteAddress
                ) ||
                'unknown'
            );
        },

        handler(
            req,
            res
        ) {
            return res
                .status(429)
                .json({
                    success:
                        false,

                    code:
                        'MTN_WEBHOOK_RATE_LIMITED',

                    message:
                        'Too many MTN callback requests.',

                    retryAfter:
                        60,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    });

/**
 * ============================================================================
 * PAYLOAD VALIDATION
 * ============================================================================
 *
 * This validates only the transport boundary.
 *
 * Provider-specific business validation belongs in the webhook service.
 * ============================================================================
 */

function validateCallbackPayload(
    req,
    res,
    next
) {
    const payload =
        req.body;

    if (
        !payload ||
        typeof payload !==
            'object' ||
        Array.isArray(
            payload
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_WEBHOOK_PAYLOAD_INVALID',

                message:
                    'Invalid MTN callback payload.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    /**
     * Different MTN integrations may use slightly different identifiers, so
     * these fields are intentionally normalized rather than hard-coded to one
     * provider payload version.
     */
    const externalId =
        normalizeString(
            payload.externalId ||
                payload.externalid ||
                payload.externalReference
        );

    const status =
        normalizeString(
            payload.status ||
                payload.financialTransactionStatus
        )?.toUpperCase();

    if (
        !externalId
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_WEBHOOK_EXTERNAL_ID_REQUIRED',

                message:
                    'MTN callback transaction reference is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        externalId.length >
        255
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_WEBHOOK_EXTERNAL_ID_INVALID',

                message:
                    'MTN callback transaction reference is invalid.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        !status
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MTN_WEBHOOK_STATUS_REQUIRED',

                message:
                    'MTN callback status is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.mtnWebhook =
        {
            externalId,
            status,
        };

    next();
}

/**
 * ============================================================================
 * Canonical Callback Processing
 * ============================================================================
 */

async function processCallback(
    req,
    res,
    next
) {
    try {
        /**
         * The preferred production path delegates ALL financial effects to the
         * canonical webhook service/controller.
         */
        const result =
            await webhookHandler(
                req,
                res,
                next
            );

        /**
         * If the canonical handler already sent a response, do not send
         * another response.
         */
        if (
            res.headersSent
        ) {
            return;
        }

        /**
         * Preserve an explicit response returned by the handler where useful.
         */
        if (
            result &&
            typeof result ===
                'object'
        ) {
            return res
                .status(
                    Number.isInteger(
                        result.statusCode
                    )
                        ? result.statusCode
                        : 200
                )
                .json({
                    success:
                        result.success !==
                            false,

                    ...sanitizeCallbackResult(
                        result
                    ),

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        }

        return res
            .status(200)
            .json({
                success:
                    true,

                message:
                    'MTN callback processed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    } catch (
        error
    ) {
        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        /**
         * Provider callbacks generally need a retryable response for transient
         * processing failures.
         *
         * The webhook service may explicitly mark an error as non-retryable.
         */
        const retryable =
            error?.providerRetryable !==
            false;

        return res
            .status(
                retryable
                    ? 500
                    : 200
            )
            .json({
                success:
                    false,

                code:
                    normalizeString(
                        error?.code
                    ) ||
                    (
                        retryable
                            ? 'MTN_WEBHOOK_PROCESSING_FAILED'
                            : 'MTN_WEBHOOK_REJECTED'
                    ),

                message:
                    retryable
                        ? 'MTN callback processing failed.'
                        : 'MTN callback received but was not applied.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
}

/**
 * ============================================================================
 * Canonical Endpoint
 * ============================================================================
 *
 * POST /mtn/callback
 * ============================================================================
 */

router.post(
    '/mtn/callback',

    /**
     * Provider authenticity verification happens here.
     *
     * No JWT authentication.
     */
    webhookLimiter,

    mtnWebhookMiddleware,

    /**
     * If the middleware populated req.body, validate it.
     */
    ...(webhookParserMode ===
    'middleware'
        ? [
            validateCallbackPayload,
        ]
        : [
            validateCallbackPayload,
        ]),

    processCallback
);

/**
 * ============================================================================
 * Health
 * ============================================================================
 */

router.get(
    '/health',
    (
        req,
        res
    ) => {
        return res
            .status(200)
            .json({
                success:
                    true,

                service:
                    SERVICE_NAME,

                version:
                    ROUTER_VERSION,

                status:
                    'UP',

                provider:
                    'MTN',

                webhook:
                    'enabled',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
);

/**
 * ============================================================================
 * 404
 * ============================================================================
 */

router.use(
    (
        req,
        res
    ) => {
        return res
            .status(404)
            .json({
                success:
                    false,

                code:
                    'MTN_WEBHOOK_ROUTE_NOT_FOUND',

                message:
                    'MTN webhook endpoint not found.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
);

/**
 * ============================================================================
 * Error Handler
 * ============================================================================
 */

router.use(
    (
        error,
        req,
        res,
        next
    ) => {
        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        /**
         * Do not expose raw provider signatures, callback bodies, database
         * errors, stack traces, or implementation details.
         */
        return res
            .status(
                Number(
                    error?.statusCode
                ) >= 400 &&
                Number(
                    error?.statusCode
                ) < 600
                    ? Number(
                        error.statusCode
                    )
                    : 500
            )
            .json({
                success:
                    false,

                code:
                    normalizeString(
                        error?.code
                    ) ||
                    'MTN_WEBHOOK_ERROR',

                message:
                    'The MTN webhook request could not be completed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    }
);

/**
 * ============================================================================
 * Helper Resolution
 * ============================================================================
 */

function resolveWebhookHandler() {
    const candidates = [
        {
            path:
                '../controllers/mtnWebhookController',

            names: [
                'handleCallback',
                'mtnCallback',
                'handleMtnCallback',
                'handleWebhook',
                'processCallback',
            ],
        },

        {
            path:
                '../services/mtnWebhookService',

            names: [
                'handleCallback',
                'processCallback',
                'handleMtnCallback',
            ],
        },

        {
            path:
                '../modules/integrations/mtn.webhook',

            names: [
                'handleCallback',
                'handleMtnCallback',
                'handleWebhook',
            ],
        },
    ];

    for (
        const candidate of
        candidates
    ) {
        try {
            const loaded =
                require(
                    candidate.path
                );

            const moduleValue =
                loaded?.default ||
                loaded;

            if (
                typeof moduleValue ===
                'function'
            ) {
                return moduleValue;
            }

            for (
                const name of
                candidate.names
            ) {
                if (
                    typeof moduleValue?.[
                        name
                    ] ===
                    'function'
                ) {
                    return moduleValue[
                        name
                    ];
                }
            }
        } catch (
            error
        ) {
            if (
                error?.code !==
                'MODULE_NOT_FOUND'
            ) {
                throw error;
            }
        }
    }

    /**
     * Fail closed. A webhook route without a financial processing handler
     * should never appear healthy.
     */
    throw new Error(
        `[${ROUTER_NAME}] No canonical MTN webhook processing handler is configured.`
    );
}

function sanitizeCallbackResult(
    result
) {
    if (
        !result ||
        typeof result !==
            'object'
    ) {
        return {};
    }

    return {
        accepted:
            result.accepted,

        processed:
            result.processed,

        duplicate:
            result.duplicate,

        status:
            result.status,

        transactionId:
            result.transactionId,
    };
}

function getPositiveIntegerEnv(
    name,
    fallback
) {
    const value =
        Number(
            process.env[
                name
            ]
        );

    return (
        Number.isInteger(
            value
        ) &&
        value > 0
    )
        ? value
        : fallback;
}

/**
 * ============================================================================
 * Router Metadata
 * ============================================================================
 */

router.routerName =
    ROUTER_NAME;

router.routerVersion =
    ROUTER_VERSION;

router.serviceName =
    SERVICE_NAME;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    router;