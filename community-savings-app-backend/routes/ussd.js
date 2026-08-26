'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise USSD Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/ussd.js
 *
 * Production boundary for TITech Community Capital USSD interactions.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Receive provider USSD callbacks.
 * - Establish correlation / request context.
 * - Validate callback structure.
 * - Verify provider signatures where configured.
 * - Resolve and enforce tenant context.
 * - Enforce USSD feature availability.
 * - Protect against replay / duplicate processing.
 * - Enforce request timeout.
 * - Delegate business logic to ussdController.
 * - Persist deterministic USSD responses.
 * - Expose controlled session operations.
 * - Record operational metrics.
 * - Avoid leaking PII, credentials or internal errors.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Provider
 *    ↓
 * Request Context
 *    ↓
 * Rate Limit
 *    ↓
 * Payload Validation
 *    ↓
 * Provider Signature Verification
 *    ↓
 * Tenant Resolution
 *    ↓
 * Feature Guard
 *    ↓
 * Idempotency / Replay Protection
 *    ↓
 * Audit
 *    ↓
 * USSD Controller / Service
 *    ↓
 * Response Cache
 *    ↓
 * Provider
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Routes contain no financial business logic.
 *
 * Never:
 *   - mutate balances directly
 *   - write ledger entries directly
 *   - trust tenantId supplied by a caller
 *   - expose raw provider payloads in logs
 *   - expose stack traces to USSD callers
 *
 * TITech terminology is canonical throughout this file.
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
        strict: false,
        caseSensitive: false,
    });

/**
 * ============================================================================
 * Dependencies
 * ============================================================================
 */

const ussdController =
    require('../controllers/ussdController');

const authenticate =
    require('../middleware/authenticate');

const authenticateTenant =
    require('../middleware/authenticateTenant');

const featureGuard =
    require('../middleware/featureGuard');

const correlationMiddleware =
    require('../middleware/correlationMiddleware');

const requestContext =
    require('../middleware/requestContext');

const auditMiddleware =
    require('../middleware/auditMiddleware');

const logger =
    require('../utils/logger');

const metrics =
    require('../services/metricsService');

const ussdSessionService =
    require('../services/ussdSessionService');

const tenantService =
    require('../services/tenantService');

const {
    FEATURES,
} =
    require('../constants/features');

/**
 * ============================================================================
 * Dependency Contracts
 * ============================================================================
 */

if (
    typeof ussdController?.handle !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] ussdController.handle must be a function.'
    );
}

if (
    typeof authenticate !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] authenticate middleware is required.'
    );
}

if (
    typeof authenticateTenant !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] authenticateTenant middleware is required.'
    );
}

if (
    typeof featureGuard !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] featureGuard middleware is required.'
    );
}

if (
    typeof correlationMiddleware !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] correlationMiddleware is required.'
    );
}

if (
    typeof requestContext !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] requestContext middleware is required.'
    );
}

if (
    typeof auditMiddleware !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] auditMiddleware is required.'
    );
}

if (
    typeof ussdSessionService?.getResponse !==
        'function' ||
    typeof ussdSessionService?.saveResponse !==
        'function' ||
    typeof ussdSessionService?.findSession !==
        'function' ||
    typeof ussdSessionService?.endSession !==
        'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] ussdSessionService is missing one or more required methods.'
    );
}

if (
    typeof tenantService?.findById !==
    'function'
) {
    throw new TypeError(
        '[TITechUSSDRoutes] tenantService.findById is required.'
    );
}

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechUSSDRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech USSD Service';

const REQUEST_TIMEOUT =
    getPositiveIntegerEnv(
        'USSD_REQUEST_TIMEOUT',
        25000
    );

const BODY_LIMIT =
    process.env.USSD_MAX_BODY_SIZE ||
    '100kb';

const VERIFY_SIGNATURE =
    String(
        process.env.USSD_VERIFY_SIGNATURE ||
        'true'
    ).toLowerCase() ===
    'true';

const REQUIRE_SIGNATURE_IN_PRODUCTION =
    String(
        process.env
            .USSD_REQUIRE_SIGNATURE_IN_PRODUCTION ||
            'true'
    ).toLowerCase() ===
    'true';

const USSD_WEBHOOK_SECRET =
    process.env.USSD_WEBHOOK_SECRET ||
    null;

const MAX_SESSION_ID_LENGTH =
    255;

const MAX_SERVICE_CODE_LENGTH =
    64;

const MAX_PHONE_NUMBER_LENGTH =
    32;

const MAX_TEXT_LENGTH =
    4096;

/**
 * ============================================================================
 * Signature Configuration Validation
 * ============================================================================
 */

if (
    VERIFY_SIGNATURE &&
    !USSD_WEBHOOK_SECRET
) {
    throw new Error(
        '[TITechUSSDRoutes] USSD_VERIFY_SIGNATURE=true but USSD_WEBHOOK_SECRET is not configured.'
    );
}

if (
    process.env.NODE_ENV ===
        'production' &&
    REQUIRE_SIGNATURE_IN_PRODUCTION &&
    !VERIFY_SIGNATURE
) {
    throw new Error(
        '[TITechUSSDRoutes] USSD signature verification must be enabled in production.'
    );
}

/**
 * ============================================================================
 * Raw-Body Capture
 * ============================================================================
 *
 * The signature must be calculated from the exact bytes received from the
 * provider rather than a re-serialized JSON object.
 * ============================================================================
 */

function captureRawBody(
    req,
    res,
    buffer
) {
    if (
        buffer &&
        buffer.length > 0
    ) {
        req.rawBody =
            Buffer.from(
                buffer
            );
    }
}

/**
 * ============================================================================
 * Body Parsers
 * ============================================================================
 */

router.use(
    express.urlencoded({
        extended: true,

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
 * Request Context
 * ============================================================================
 */

router.use(
    correlationMiddleware
);

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
 * Request Metrics
 * ============================================================================
 */

router.use(
    requestMetricsMiddleware
);

function requestMetricsMiddleware(
    req,
    res,
    next
) {
    req.startedAt =
        Date.now();

    safeMetricIncrement(
        'ussd_requests_total'
    );

    res.once(
        'finish',
        () => {
            const duration =
                Date.now() -
                req.startedAt;

            safeMetricTiming(
                'ussd_response_time_ms',
                duration
            );

            safeMetricIncrement(
                `ussd_status_${res.statusCode}_total`
            );
        }
    );

    next();
}

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */

const ussdLimiter =
    rateLimit({
        windowMs:
            60 * 1000,

        max:
            getPositiveIntegerEnv(
                'USSD_RATE_LIMIT',
                1000
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
            /**
             * Use a normalized phone hash rather than writing the phone number
             * directly into rate-limiter state.
             */
            const phone =
                normalizeString(
                    req.body?.phoneNumber
                );

            if (
                phone
            ) {
                return hashIdentifier(
                    phone
                );
            }

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
            safeMetricIncrement(
                'ussd_rate_limit_exceeded_total'
            );

            safeLogWarn(
                'USSD rate limit exceeded',
                {
                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    tenantId:
                        req.tenant?.id,
                }
            );

            res.setHeader(
                'Retry-After',
                '60'
            );

            return res
                .status(429)
                .send(
                    'END Too many requests. Please try again later.'
                );
        },
    });

/**
 * ============================================================================
 * Health
 * ============================================================================
 *
 * Lightweight liveness endpoint.
 * Does not require a tenant or authenticated application user.
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

                uptime:
                    process.uptime(),

                timestamp:
                    new Date().toISOString(),

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }
);

/**
 * ============================================================================
 * Metrics
 * ============================================================================
 *
 * Operational metrics can be sensitive. Protect this endpoint when configured.
 * ============================================================================
 */

router.get(
    '/metrics',
    authenticate,
    async (
        req,
        res,
        next
    ) => {
        try {
            const data =
                await metrics.getMetrics();

            return res
                .status(200)
                .json(
                    sanitizeMetrics(
                        data
                    )
                );
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
 * Main USSD Endpoint
 * ============================================================================
 *
 * POST /
 * ============================================================================
 */

router.post(
    '/',

    ussdLimiter,

    validateRequest,

    verifySignature,

    requestTimeout,

    /**
     * Tenant authentication must happen BEFORE idempotency so that replay
     * state cannot be shared across tenants or unauthorized requests.
     */
    authenticateTenant,

    featureGuard(
        FEATURES.USSD
    ),

    idempotency,

    auditMiddleware,

    handleUSSD
);

/**
 * ============================================================================
 * Session Lookup
 * ============================================================================
 *
 * Must remain tenant-scoped.
 * A sessionId alone is not an authorization boundary.
 * ============================================================================
 */

router.get(
    '/sessions/:sessionId',

    authenticate,

    validateSessionId,

    async (
        req,
        res,
        next
    ) => {
        try {
            const session =
                await ussdSessionService.findSession(
                    req.params.sessionId
                );

            if (
                !session
            ) {
                return res
                    .status(404)
                    .json({
                        success:
                            false,

                        code:
                            'USSD_SESSION_NOT_FOUND',

                        message:
                            'USSD session not found.',

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,
                    });
            }

            /**
             * Object-level authorization.
             */
            if (
                !isSessionAccessibleByActor(
                    session,
                    req
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success:
                            false,

                        code:
                            'USSD_SESSION_ACCESS_DENIED',

                        message:
                            'You are not authorized to access this USSD session.',

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,
                    });
            }

            return res
                .status(200)
                .json({
                    success:
                        true,

                    data:
                        sanitizeSession(
                            session
                        ),

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
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
 * Session Termination
 * ============================================================================
 */

router.delete(
    '/sessions/:sessionId',

    authenticate,

    validateSessionId,

    async (
        req,
        res,
        next
    ) => {
        try {
            const session =
                await ussdSessionService.findSession(
                    req.params.sessionId
                );

            if (
                !session
            ) {
                return res
                    .status(404)
                    .json({
                        success:
                            false,

                        code:
                            'USSD_SESSION_NOT_FOUND',

                        message:
                            'USSD session not found.',

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,
                    });
            }

            if (
                !isSessionAccessibleByActor(
                    session,
                    req
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success:
                            false,

                        code:
                            'USSD_SESSION_ACCESS_DENIED',

                        message:
                            'You are not authorized to terminate this USSD session.',

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,
                    });
            }

            await ussdSessionService.endSession(
                req.params.sessionId
            );

            return res
                .status(200)
                .json({
                    success:
                        true,

                    message:
                        'USSD session terminated.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
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
 * Main Handler
 * ============================================================================
 */

async function handleUSSD(
    req,
    res,
    next
) {
    try {
        /**
         * authenticateTenant should populate req.tenant.
         */
        const tenantId =
            normalizeString(
                req.tenant?.id ||
                req.tenant?.['_id'] ||
                req.tenantId
            );

        if (
            !tenantId
        ) {
            return res.send(
                'END Invalid tenant.'
            );
        }

        const tenant =
            await tenantService.findById(
                tenantId
            );

        if (
            !tenant
        ) {
            return res.send(
                'END Invalid tenant.'
            );
        }

        const response =
            await ussdController.handle({
                tenant:
                    sanitizeTenantForController(
                        tenant
                    ),

                sessionId:
                    req.body.sessionId,

                serviceCode:
                    req.body.serviceCode,

                phoneNumber:
                    req.body.phoneNumber,

                text:
                    req.body.text ||
                    '',

                correlationId:
                    req.correlationId,

                requestId:
                    req.requestId,

                idempotencyKey:
                    req.idempotencyKey,

                tenantId,
            });

        const normalizedResponse =
            normalizeUSSDResponse(
                response
            );

        await ussdSessionService.saveResponse(
            req.idempotencyKey,
            normalizedResponse
        );

        safeMetricIncrement(
            'ussd_responses_total'
        );

        return res.send(
            normalizedResponse
        );
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
 * Request Validation
 * ============================================================================
 */

function validateRequest(
    req,
    res,
    next
) {
    const {
        sessionId,
        phoneNumber,
        serviceCode,
    } =
        req.body || {};

    if (
        !sessionId
    ) {
        return res.send(
            'END Invalid session.'
        );
    }

    if (
        !phoneNumber
    ) {
        return res.send(
            'END Invalid phone number.'
        );
    }

    if (
        !serviceCode
    ) {
        return res.send(
            'END Invalid service code.'
        );
    }

    if (
        String(
            sessionId
        ).length >
        MAX_SESSION_ID_LENGTH
    ) {
        return res.send(
            'END Invalid session.'
        );
    }

    if (
        String(
            serviceCode
        ).length >
        MAX_SERVICE_CODE_LENGTH
    ) {
        return res.send(
            'END Invalid service code.'
        );
    }

    if (
        String(
            phoneNumber
        ).length >
        MAX_PHONE_NUMBER_LENGTH
    ) {
        return res.send(
            'END Invalid phone number.'
        );
    }

    const normalizedPhone =
        normalizePhoneNumber(
            phoneNumber
        );

    if (
        !normalizedPhone
    ) {
        return res.send(
            'END Invalid phone number.'
        );
    }

    const text =
        String(
            req.body?.text ||
            ''
        );

    if (
        text.length >
        MAX_TEXT_LENGTH
    ) {
        return res.send(
            'END Request too long.'
        );
    }

    req.body.phoneNumber =
        normalizedPhone;

    req.body.text =
        text;

    req.body.serviceCode =
        String(
            serviceCode
        ).trim();

    req.body.sessionId =
        String(
            sessionId
        ).trim();

    next();
}

/**
 * ============================================================================
 * Signature Verification
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
                ]
            );

        if (
            !signature
        ) {
            safeLogWarn(
                'USSD signature missing',
                {
                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                }
            );

            return res
                .status(401)
                .send(
                    'END Unauthorized.'
                );
        }

        if (
            !USSD_WEBHOOK_SECRET
        ) {
            throw createSecurityError(
                'USSD_WEBHOOK_SECRET_NOT_CONFIGURED',
                'USSD webhook secret is not configured.'
            );
        }

        /**
         * Prefer exact raw request bytes.
         *
         * Do not JSON.stringify(req.body) for HMAC verification because that
         * can produce different bytes from those originally signed.
         */
        const payload =
            req.rawBody ||
            Buffer.from(
                buildCanonicalFallbackPayload(
                    req.body
                ),
                'utf8'
            );

        const expected =
            crypto
                .createHmac(
                    'sha256',
                    USSD_WEBHOOK_SECRET
                )
                .update(
                    payload
                )
                .digest();

        const provided =
            decodeSignature(
                signature
            );

        if (
            !provided
        ) {
            return res
                .status(401)
                .send(
                    'END Unauthorized.'
                );
        }

        if (
            expected.length !==
            provided.length
        ) {
            return res
                .status(401)
                .send(
                    'END Unauthorized.'
                );
        }

        if (
            !crypto.timingSafeEqual(
                expected,
                provided
            )
        ) {
            safeLogWarn(
                'Invalid USSD signature',
                {
                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                }
            );

            return res
                .status(401)
                .send(
                    'END Unauthorized.'
                );
        }

        req.ussdSignatureVerified =
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
 * Idempotency
 * ============================================================================
 *
 * Authentication/tenant resolution occurs before this middleware.
 *
 * The deterministic key includes:
 *   - tenant
 *   - provider session
 *   - normalized phone
 *   - current USSD text
 *
 * This prevents cross-tenant replay collisions.
 * ============================================================================
 */

async function idempotency(
    req,
    res,
    next
) {
    try {
        const tenantId =
            normalizeString(
                req.tenant?.id ||
                req.tenant?._id ||
                req.tenantId
            );

        const keyMaterial =
            [
                tenantId,
                req.body.sessionId,
                req.body.text,
                req.body.phoneNumber,
                req.body.serviceCode,
            ].join(
                '|'
            );

        const key =
            crypto
                .createHash(
                    'sha256'
                )
                .update(
                    keyMaterial,
                    'utf8'
                )
                .digest(
                    'hex'
                );

        req.idempotencyKey =
            key;

        const cached =
            await ussdSessionService.getResponse(
                key
            );

        if (
            cached !==
            null &&
            cached !==
            undefined
        ) {
            safeMetricIncrement(
                'ussd_idempotency_hits_total'
            );

            return res.send(
                normalizeUSSDResponse(
                    cached
                )
            );
        }

        safeMetricIncrement(
            'ussd_idempotency_misses_total'
        );

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
 * Request Timeout
 * ============================================================================
 *
 * This avoids leaving an open provider request indefinitely.
 *
 * The timeout does not cancel downstream business work. Services should have
 * their own database/provider timeout policies as well.
 * ============================================================================
 */

function requestTimeout(
    req,
    res,
    next
) {
    let completed =
        false;

    const timer =
        setTimeout(
            () => {
                if (
                    completed ||
                    res.headersSent
                ) {
                    return;
                }

                completed =
                    true;

                safeMetricIncrement(
                    'ussd_request_timeout_total'
                );

                safeLogError(
                    'USSD request timeout',
                    {
                        sessionId:
                            req.body?.sessionId,

                        requestId:
                            req.requestId,

                        correlationId:
                            req.correlationId,

                        tenantId:
                            req.tenant?.id,
                    }
                );

                res.send(
                    'END Service temporarily unavailable.'
                );
            },
            REQUEST_TIMEOUT
        );

    res.once(
        'finish',
        () => {
            completed =
                true;

            clearTimeout(
                timer
            );
        }
    );

    res.once(
        'close',
        () => {
            completed =
                true;

            clearTimeout(
                timer
            );
        }
    );

    next();
}

/**
 * ============================================================================
 * Session Validation
 * ============================================================================
 */

function validateSessionId(
    req,
    res,
    next
) {
    const sessionId =
        normalizeString(
            req.params.sessionId
        );

    if (
        !sessionId ||
        sessionId.length >
            MAX_SESSION_ID_LENGTH
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'USSD_SESSION_ID_INVALID',

                message:
                    'Invalid USSD session identifier.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    next();
}

/**
 * ============================================================================
 * Session Object-Level Authorization
 * ============================================================================
 */

function isSessionAccessibleByActor(
    session,
    req
) {
    const sessionTenantId =
        normalizeString(
            session?.tenantId ||
            session?.tenant?._id ||
            session?.tenant?.id
        );

    const requestTenantId =
        normalizeString(
            req.user?.tenantId ||
            req.auth?.tenantId ||
            req.tenantId
        );

    if (
        sessionTenantId &&
        requestTenantId &&
        sessionTenantId !==
            requestTenantId
    ) {
        return false;
    }

    /**
     * Administrative users may access sessions according to application RBAC.
     * Ordinary authenticated users should only access their own session where
     * a userId/actorId is persisted.
     */
    const sessionUserId =
        normalizeString(
            session?.userId ||
            session?.user?._id ||
            session?.user?.id
        );

    const requestUserId =
        normalizeString(
            req.user?.id ||
            req.user?._id ||
            req.user?.userId
        );

    if (
        sessionUserId &&
        requestUserId
    ) {
        return (
            sessionUserId ===
            requestUserId
        );
    }

    /**
     * When the existing session schema has no user identity, tenant scope is
     * the minimum protection available.
     */
    return true;
}

/**
 * ============================================================================
 * Sanitization
 * ============================================================================
 */

function sanitizeTenantForController(
    tenant
) {
    if (
        !tenant ||
        typeof tenant !==
            'object'
    ) {
        return null;
    }

    /**
     * Keep the controller from accidentally receiving secrets/credentials
     * embedded in a complete tenant persistence document.
     */
    return {
        id:
            normalizeString(
                tenant.id ||
                tenant._id
            ),

        code:
            normalizeString(
                tenant.code
            ),

        name:
            normalizeString(
                tenant.name
            ),

        status:
            normalizeString(
                tenant.status
            ),

        featureFlags:
            sanitizeFeatureFlags(
                tenant.featureFlags
            ),
    };
}

function sanitizeFeatureFlags(
    featureFlags
) {
    if (
        !featureFlags ||
        typeof featureFlags !==
            'object'
    ) {
        return undefined;
    }

    const result =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            featureFlags
        )
    ) {
        if (
            typeof value ===
                'boolean'
        ) {
            result[key] =
                value;
        }
    }

    return result;
}

function sanitizeSession(
    session
) {
    if (
        !session ||
        typeof session !==
            'object'
    ) {
        return null;
    }

    return {
        sessionId:
            normalizeString(
                session.sessionId ||
                session.id ||
                session._id
            ),

        tenantId:
            normalizeString(
                session.tenantId ||
                session.tenant?.id ||
                session.tenant?._id
            ),

        status:
            normalizeString(
                session.status
            ),

        serviceCode:
            normalizeString(
                session.serviceCode
            ),

        createdAt:
            session.createdAt,

        updatedAt:
            session.updatedAt,

        expiresAt:
            session.expiresAt,
    };
}

function sanitizeMetrics(
    data
) {
    /**
     * Avoid blindly returning arbitrary internal metrics state.
     *
     * If metricsService.getMetrics() returns a controlled public metrics
     * structure, the original object can be returned.
     */
    if (
        !data ||
        typeof data !==
            'object'
    ) {
        return {
            data,
        };
    }

    return data;
}

/**
 * ============================================================================
 * Response Normalization
 * ============================================================================
 */

function normalizeUSSDResponse(
    response
) {
    const value =
        String(
            response ||
            ''
        ).trim();

    if (
        !value
    ) {
        return 'END Unable to process your request.';
    }

    if (
        value.startsWith(
            'CON '
        ) ||
        value.startsWith(
            'END '
        )
    ) {
        return value;
    }

    /**
     * Defensive default:
     *
     * A USSD controller should return CON/END explicitly. If an older
     * controller returns plain text, terminate the session rather than leaving
     * provider behavior ambiguous.
     */
    return `END ${value}`;
}

/**
 * ============================================================================
 * Logging / Metrics Helpers
 * ============================================================================
 */

function safeLogWarn(
    message,
    metadata
) {
    try {
        logger?.warn?.(
            message,
            metadata
        );
    } catch {
        // Logging must never break USSD processing.
    }
}

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
        // Logging must never break USSD processing.
    }
}

function safeMetricIncrement(
    name
) {
    try {
        metrics?.increment?.(
            name
        );
    } catch {
        // Metrics failures must never break USSD processing.
    }
}

function safeMetricTiming(
    name,
    value
) {
    try {
        metrics?.timing?.(
            name,
            value
        );
    } catch {
        // Metrics failures must never break USSD processing.
    }
}

/**
 * ============================================================================
 * Crypto Helpers
 * ============================================================================
 */

function hashIdentifier(
    value
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            String(
                value
            ),
            'utf8'
        )
        .digest(
            'hex'
        );
}

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

    /**
     * Support:
     *
     *   hex
     *   base64
     *
     * without silently accepting arbitrary formats.
     */
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
        // Invalid base64.
    }

    return null;
}

function buildCanonicalFallbackPayload(
    payload
) {
    /**
     * This fallback exists only for deployments where the middleware/parser
     * cannot provide req.rawBody.
     *
     * Production provider contracts should preferably sign the exact raw
     * request bytes.
     */
    return JSON.stringify(
        payload ||
            {}
    );
}

function normalizePhoneNumber(
    phone
) {
    const normalized =
        normalizeString(
            phone
        );

    if (
        !normalized
    ) {
        return null;
    }

    const cleaned =
        normalized.replace(
            /[\s\-()]/g,
            ''
        );

    if (
        !/^\+?[0-9]{7,32}$/.test(
            cleaned
        )
    ) {
        return null;
    }

    return cleaned;
}

/**
 * ============================================================================
 * Security Error
 * ============================================================================
 */

function createSecurityError(
    code,
    message
) {
    const error =
        new Error(
            message
        );

    error.code =
        code;

    error.statusCode =
        500;

    return error;
}

/**
 * ============================================================================
 * Environment Helpers
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
 * Global Error Handler
 * ============================================================================
 */

router.use(
    (
        err,
        req,
        res,
        next
    ) => {
        safeLogError(
            'USSD route failure',
            {
                code:
                    err?.code,

                message:
                    err?.message,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                tenantId:
                    req.tenant?.id,

                sessionId:
                    req.body?.sessionId,
            }
        );

        safeMetricIncrement(
            'ussd_errors_total'
        );

        if (
            res.headersSent
        ) {
            return next(
                err
            );
        }

        /**
         * Never expose stack traces or provider internals to USSD callers.
         */
        return res
            .status(
                Number(
                    err?.statusCode
                ) >=
                    400 &&
                Number(
                    err?.statusCode
                ) <
                    600
                    ? Number(
                        err.statusCode
                    )
                    : 500
            )
            .send(
                'END An unexpected error occurred.'
            );
    }
);

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    router;