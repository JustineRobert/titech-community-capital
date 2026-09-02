'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Webhook Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/webhook.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical external payment-provider webhook boundary.
 *
 * Endpoint
 * ----------------------------------------------------------------------------
 *
 * POST /momo/callback
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   Mobile Money Provider
 *          ↓
 *   Request / Correlation Context
 *          ↓
 *   Rate Limiting
 *          ↓
 *   Provider Authentication / Signature Verification
 *          ↓
 *   Payload Validation
 *          ↓
 *   Canonical MTN/MoMo Webhook Controller
 *          ↓
 *   Replay / Idempotency Protection
 *          ↓
 *   Transaction State Validation
 *          ↓
 *   Financial Transaction Service
 *          ├── Transaction
 *          ├── Ledger
 *          ├── Wallet
 *          ├── Loan / Savings
 *          └── Audit
 *          ↓
 *   Provider Acknowledgement
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This route MUST NOT:
 *
 *   ✗ directly update Transaction.status
 *   ✗ directly mutate wallet balances
 *   ✗ directly write ledger entries
 *   ✗ trust a provider-supplied tenantId
 *   ✗ treat any status string as a valid financial state transition
 *   ✗ allow duplicate callbacks to post duplicate financial entries
 *   ✗ log the full callback payload
 *
 * Provider authenticity and financial processing belong to the webhook
 * security/service layer.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS references are replaced with TITech Community Capital.
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

/**
 * ============================================================================
 * Canonical Webhook Handler
 * ============================================================================
 *
 * Resolve the project's existing MTN/MoMo webhook implementation instead of
 * duplicating financial logic inside this route.
 * ============================================================================
 */

const webhookHandler =
    resolveWebhookHandler();

if (
    typeof webhookHandler !==
    'function'
) {
    throw new Error(
        '[TITechWebhookRoutes] No canonical Mobile Money webhook handler is configured.'
    );
}

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechWebhookRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Payment Webhook API';

const BODY_LIMIT =
    process.env.TITECH_WEBHOOK_BODY_LIMIT ||
    '256kb';

const MAX_EXTERNAL_ID_LENGTH =
    255;

const MAX_STATUS_LENGTH =
    64;

const VERIFY_SIGNATURE =
    String(
        process.env.TITECH_MOMO_WEBHOOK_VERIFY_SIGNATURE ||
        'true'
    ).toLowerCase() ===
    'true';

const WEBHOOK_SECRET =
    process.env.TITECH_MOMO_WEBHOOK_SECRET ||
    null;

/**
 * ============================================================================
 * Startup Security Validation
 * ============================================================================
 */

if (
    VERIFY_SIGNATURE &&
    !WEBHOOK_SECRET
) {
    throw new Error(
        '[TITechWebhookRoutes] Signature verification is enabled but TITECH_MOMO_WEBHOOK_SECRET is not configured.'
    );
}

if (
    process.env.NODE_ENV ===
        'production' &&
    !VERIFY_SIGNATURE
) {
    throw new Error(
        '[TITechWebhookRoutes] Mobile Money webhook signature verification must be enabled in production.'
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

function requestContext(
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
    requestContext
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
 * Raw Body Capture
 * ============================================================================
 *
 * Provider signatures must be calculated against the exact bytes received.
 * ============================================================================
 */

function captureRawBody(
    req,
    res,
    buffer
) {
    if (
        buffer &&
        buffer.length
    ) {
        req.rawBody =
            Buffer.from(
                buffer
            );
    }
}

/**
 * ============================================================================
 * Body Parser
 * ============================================================================
 */

router.use(
    express.urlencoded({
        extended:
            true,

        limit:
            BODY_LIMIT,

        verify:
            captureRawBody,
    })
);

router.use(
    express.json({
        limit:
            BODY_LIMIT,

        strict:
            true,

        verify:
            captureRawBody,
    })
);

/**
 * ============================================================================
 * Webhook Rate Limiting
 * ============================================================================
 */

const webhookLimiter =
    rateLimit({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_WEBHOOK_RATE_LIMIT',
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
            res.setHeader(
                'Retry-After',
                '60'
            );

            return res
                .status(429)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_WEBHOOK_RATE_LIMITED',

                    message:
                        'Too many Mobile Money callback requests.',

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
 * Payload Validation
 * ============================================================================
 */

function validateWebhookPayload(
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
                    'MOMO_WEBHOOK_PAYLOAD_INVALID',

                message:
                    'Invalid Mobile Money callback payload.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    const externalId =
        normalizeString(
            payload.externalId ||
            payload.externalid ||
            payload.externalReference ||
            payload.reference
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
                    'MOMO_EXTERNAL_ID_REQUIRED',

                message:
                    'Mobile Money transaction reference is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        externalId.length >
        MAX_EXTERNAL_ID_LENGTH
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_EXTERNAL_ID_INVALID',

                message:
                    'Mobile Money transaction reference is invalid.',

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
                    'MOMO_STATUS_REQUIRED',

                message:
                    'Mobile Money transaction status is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        status.length >
        MAX_STATUS_LENGTH
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'MOMO_STATUS_INVALID',

                message:
                    'Mobile Money transaction status is invalid.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.webhookContext =
        {
            externalId,

            status,
        };

    next();
}

/**
 * ============================================================================
 * Signature Verification
 * ============================================================================
 *
 * This middleware verifies provider authenticity before financial processing.
 *
 * IMPORTANT:
 * A real provider integration may use a provider-specific signature scheme.
 * The generic HMAC implementation below is suitable only where that exactly
 * matches the configured provider contract.
 * ============================================================================
 */

function verifySignature(
    req,
    res,
    next
) {
    if (
        !VERIFY_SIGNATURE
    ) {
        return next();
    }

    try {
        const signature =
            normalizeString(
                req.headers?.[
                    'x-signature'
                ] ||
                req.headers?.[
                    'x-momo-signature'
                ]
            );

        if (
            !signature
        ) {
            return res
                .status(401)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_SIGNATURE_REQUIRED',

                    message:
                        'Webhook authentication failed.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        const rawPayload =
            req.rawBody ||
            Buffer.from(
                JSON.stringify(
                    req.body ||
                        {}
                ),
                'utf8'
            );

        const expected =
            crypto
                .createHmac(
                    'sha256',
                    WEBHOOK_SECRET
                )
                .update(
                    rawPayload
                )
                .digest();

        const provided =
            decodeSignature(
                signature
            );

        if (
            !provided ||
            provided.length !==
                expected.length
        ) {
            return res
                .status(401)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_SIGNATURE_INVALID',

                    message:
                        'Webhook authentication failed.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        if (
            !crypto.timingSafeEqual(
                expected,
                provided
            )
        ) {
            return res
                .status(401)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_SIGNATURE_INVALID',

                    message:
                        'Webhook authentication failed.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        req.webhookSignatureVerified =
            true;

        next();
    } catch (
        error
    ) {
        next(
            error
        );
    }
}

/**
 * ============================================================================
 * Canonical Webhook Endpoint
 * ============================================================================
 *
 * POST /momo/callback
 * ============================================================================
 */

router.post(
    '/momo/callback',

    webhookLimiter,

    validateWebhookPayload,

    verifySignature,

    async (
        req,
        res,
        next
    ) => {
        try {
            /**
             * Pass only trusted routing context plus the original provider
             * payload to the canonical webhook implementation.
             */
            req.paymentWebhookContext =
                {
                    provider:
                        'momo',

                    externalId:
                        req.webhookContext
                            .externalId,

                    status:
                        req.webhookContext
                            .status,

                    signatureVerified:
                        req.webhookSignatureVerified ===
                        true,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                };

            const result =
                await webhookHandler(
                    req,
                    res,
                    next
                );

            if (
                res.headersSent
            ) {
                return;
            }

            return res
                .status(200)
                .json({
                    success:
                        result?.success !==
                        false,

                    accepted:
                        result?.accepted !==
                            false,

                    processed:
                        result?.processed,

                    duplicate:
                        result?.duplicate,

                    status:
                        result?.status ||
                        req.webhookContext
                            .status,

                    transactionId:
                        result?.transactionId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date()
                            .toISOString(),
                });
        } catch (
            error
        ) {
            next(
                error
            );
        }
    }
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

                route:
                    ROUTER_NAME,

                version:
                    ROUTER_VERSION,

                status:
                    'UP',

                provider:
                    'momo',

                signatureVerification:
                    VERIFY_SIGNATURE,

                timestamp:
                    new Date()
                        .toISOString(),

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
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
                    'WEBHOOK_ROUTE_NOT_FOUND',

                message:
                    'Webhook endpoint not found.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date()
                        .toISOString(),
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

        safeLogError(
            'Mobile Money webhook processing failure',
            {
                code:
                    error?.code,

                message:
                    error?.message,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                externalId:
                    req.webhookContext
                        ?.externalId,
            }
        );

        const statusCode =
            Number(
                error?.statusCode
            ) >= 400 &&
            Number(
                error?.statusCode
            ) < 600
                ? Number(
                    error.statusCode
                )
                : 500;

        return res
            .status(
                statusCode
            )
            .json({
                success:
                    false,

                code:
                    normalizeString(
                        error?.code
                    ) ||
                    'MOMO_WEBHOOK_PROCESSING_FAILED',

                message:
                    statusCode >= 400 &&
                    statusCode < 500
                        ? (
                            error?.message ||
                            'The Mobile Money callback could not be processed.'
                        )
                        : 'The Mobile Money callback could not be processed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date()
                        .toISOString(),
            });
    }
);

/**
 * ============================================================================
 * Webhook Handler Resolution
 * ============================================================================
 */

function resolveWebhookHandler() {
    const candidates =
        [
            {
                path:
                    '../controllers/momoWebhookController',

                names:
                    [
                        'momoCallback',
                        'handleMoMoWebhook',
                        'handleWebhook',
                        'processCallback',
                    ],
            },

            {
                path:
                    '../controllers/mtnWebhookController',

                names:
                    [
                        'momoCallback',
                        'handleMomoCallback',
                        'handleCallback',
                        'handleWebhook',
                    ],
            },

            {
                path:
                    '../services/momoWebhookService',

                names:
                    [
                        'processCallback',
                        'handleCallback',
                        'handleWebhook',
                    ],
            },

            {
                path:
                    '../services/mtnWebhookService',

                names:
                    [
                        'processCallback',
                        'handleCallback',
                        'handleWebhook',
                    ],
            },

            {
                path:
                    '../modules/integrations/momo.webhook',

                names:
                    [
                        'handleMomoCallback',
                        'handleCallback',
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

    return null;
}

/**
 * ============================================================================
 * Signature Decoder
 * ============================================================================
 */

function decodeSignature(
    signature
) {
    const value =
        normalizeString(
            signature
        );

    if (
        !value
    ) {
        return null;
    }

    if (
        /^[0-9a-fA-F]{64}$/.test(
            value
        )
    ) {
        return Buffer.from(
            value,
            'hex'
        );
    }

    try {
        const decoded =
            Buffer.from(
                value,
                'base64'
            );

        if (
            decoded.length ===
            32
        ) {
            return decoded;
        }
    } catch {
        // Invalid encoding.
    }

    return null;
}

/**
 * ============================================================================
 * Environment Helper
 * ============================================================================
 */

function getPositiveIntegerEnv(
    name,
    fallback
) {
    const value =
        Number(
            process.env[name]
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
 * Logging
 * ============================================================================
 */

function safeLogError(
    message,
    metadata
) {
    try {
        logger?.error?.(
            message,
            metadata
        );
    } catch {
        // Logging must never interrupt webhook processing.
    }
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    router;