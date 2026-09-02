'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Settings Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/settings.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure HTTP routing boundary for TITech Community Capital application and
 * tenant settings.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * GET /api/settings
 *     Retrieve the settings visible to the authenticated authorized actor.
 *
 * PUT /api/settings
 *     Update permitted application/tenant settings.
 *
 * Security architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request / Correlation Metadata
 *        ↓
 *   Security Headers
 *        ↓
 *   Authentication
 *        ↓
 *   Trusted Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation / Allowed-Key Enforcement
 *        ↓
 *   Administrative Authorization
 *        ↓
 *   Settings Controller / Service
 *        ↓
 *   Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This router MUST NOT:
 *
 *   ✗ expose secrets
 *   ✗ accept arbitrary configuration keys
 *   ✗ allow clients to change JWT/security/provider credentials
 *   ✗ trust tenantId from request body
 *   ✗ access the database directly
 *   ✗ mutate settings directly
 *
 * The controller/service remains responsible for persistence, effective
 * configuration, audit logging and environment-specific policy.
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

const {
    body,
} =
    require('express-validator');

const asyncHandler =
    require('../utils/asyncHandler');

const {
    handleValidation,
} =
    require('../utils/validators');

const settingsController =
    require('../controllers/settingsController');

const auth =
    require('../middleware/auth');

/**
 * ============================================================================
 * Router
 * ============================================================================
 */

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechSettingsRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Settings API';

const MAX_SITE_NAME_LENGTH =
    255;

const MAX_EMAIL_LENGTH =
    320;

/**
 * ============================================================================
 * Controller Contract
 * ============================================================================
 */

if (
    typeof settingsController?.getSettings !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] settingsController.getSettings must be a function.`
    );
}

if (
    typeof settingsController?.updateSettings !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] settingsController.updateSettings must be a function.`
    );
}

/**
 * ============================================================================
 * Authentication / Authorization Contracts
 * ============================================================================
 */

const authenticate =
    auth?.verifyToken ||
    auth?.authenticate ||
    auth?.verifyAccessToken;

const isAdmin =
    auth?.isAdmin ||
    null;

const requireRole =
    auth?.requireRole ||
    null;

if (
    typeof authenticate !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Authentication middleware is unavailable.`
    );
}

if (
    typeof isAdmin !==
        'function' &&
    typeof requireRole !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Administrative authorization middleware is unavailable.`
    );
}

/**
 * ============================================================================
 * Request Metadata
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

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
 * Body Parser
 * ============================================================================
 */

router.use(
    express.json({
        limit:
            process.env.TITECH_SETTINGS_BODY_LIMIT ||
            '128kb',

        strict:
            true,
    })
);

/**
 * ============================================================================
 * Authentication
 * ============================================================================
 *
 * Settings are authenticated by default.
 * ============================================================================
 */

router.use(
    authenticate
);

/**
 * ============================================================================
 * Trusted Tenant Context
 * ============================================================================
 */

let adminContextMiddleware =
    null;

try {
    const adminContext =
        require(
            '../utils/admin/adminContext'
        );

    if (
        typeof adminContext?.middleware ===
            'function'
    ) {
        adminContextMiddleware =
            adminContext.middleware({
                requiredTenant:
                    true,

                requiredActor:
                    true,

                service:
                    SERVICE_NAME,

                serviceVersion:
                    ROUTER_VERSION,
            });
    }
} catch {
    adminContextMiddleware =
        null;
    }

function fallbackTrustedContext(
    req,
    res,
    next
) {
    const tenantId =
        normalizeString(
            req.adminContext?.tenantId ||
            req.tenantId ||
            req.user?.tenantId ||
            req.auth?.tenantId
        );

    const actorId =
        normalizeString(
            req.adminContext?.actorId ||
            req.user?.id ||
            req.user?._id ||
            req.user?.userId ||
            req.auth?.userId
        );

    if (
        !tenantId
    ) {
        return res
            .status(403)
            .json({
                success:
                    false,

                code:
                    'SETTINGS_TENANT_CONTEXT_REQUIRED',

                message:
                    'A trusted tenant context is required for settings operations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        !actorId
    ) {
        return res
            .status(401)
            .json({
                success:
                    false,

                code:
                    'SETTINGS_ACTOR_CONTEXT_REQUIRED',

                message:
                    'An authenticated actor context is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.tenantId =
        tenantId;

    req.settingsActorId =
        actorId;

    req.adminContext =
        {
            tenantId,

            actorId,

            userId:
                actorId,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,
        };

    next();
}

router.use(
    adminContextMiddleware ||
    fallbackTrustedContext
);

/**
 * ============================================================================
 * Allowed Settings Contract
 * ============================================================================
 *
 * Route-level allowlisting prevents accidental updates to arbitrary
 * application configuration.
 *
 * Keep secrets, credentials, cryptographic configuration and infrastructure
 * settings OUT of this API.
 * ============================================================================
 */

const ALLOWED_SETTINGS =
    Object.freeze([
        'siteName',
        'supportEmail',
        'features',
    ]);

const FORBIDDEN_SETTINGS =
    Object.freeze([
        'jwtSecret',
        'jwtPrivateKey',
        'jwtPublicKey',
        'refreshTokenSecret',
        'encryptionKey',
        'encryptionSecret',
        'apiKey',
        'apiKeys',
        'clientSecret',
        'clientSecrets',
        'databaseUrl',
        'mongoUri',
        'redisUrl',
        'redisPassword',
        'smtpPassword',
        'smtpSecret',
        'mtnApiKey',
        'mtnApiSecret',
        'airtelApiKey',
        'airtelApiSecret',
        'mpesaConsumerKey',
        'mpesaConsumerSecret',
        'providerCredentials',
        'credentials',
        'secrets',
        'passwords',
        'privateKey',
        'signingKey',
    ]);

/**
 * ============================================================================
 * Settings Validation
 * ============================================================================
 */

const settingsValidation =
    [
        body()
            .custom(
                value => {
                    if (
                        !value ||
                        typeof value !==
                            'object' ||
                        Array.isArray(value)
                    ) {
                        throw new Error(
                            'Settings payload must be an object.'
                        );
                    }

                    return true;
                }
            ),

        body('siteName')
            .optional()
            .isString()
            .trim()
            .isLength({
                min:
                    1,

                max:
                    MAX_SITE_NAME_LENGTH,
            })
            .withMessage(
                `siteName must be between 1 and ${MAX_SITE_NAME_LENGTH} characters.`
            ),

        body('supportEmail')
            .optional()
            .isEmail()
            .withMessage(
                'supportEmail must be a valid email address.'
            )
            .normalizeEmail(),

        body('features')
            .optional()
            .isObject()
            .withMessage(
                'features must be an object.'
            ),

        body('features.directMessaging')
            .optional()
            .isBoolean()
            .withMessage(
                'features.directMessaging must be boolean.'
            )
            .toBoolean(),

        body('features.loans')
            .optional()
            .isBoolean()
            .withMessage(
                'features.loans must be boolean.'
            )
            .toBoolean(),

        body('tenantId')
            .not()
            .exists()
            .withMessage(
                'tenantId must come from trusted tenant context.'
            ),

        body('userId')
            .not()
            .exists()
            .withMessage(
                'userId must come from authenticated context.'
            ),
    ];

/**
 * ============================================================================
 * Top-Level Settings Key Guard
 * ============================================================================
 */

function enforceSettingsAllowlist(
    req,
    res,
    next
) {
    const payload =
        req.body;

    const keys =
        Object.keys(
            payload || {}
        );

    const forbidden =
        keys.filter(
            key =>
                FORBIDDEN_SETTINGS.includes(
                    key
                )
        );

    if (
        forbidden.length
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'SETTINGS_SENSITIVE_FIELD_FORBIDDEN',

                message:
                    'One or more settings cannot be modified through the settings API.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    const unsupported =
        keys.filter(
            key =>
                !ALLOWED_SETTINGS.includes(
                    key
                )
        );

    if (
        unsupported.length
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'SETTINGS_FIELD_NOT_ALLOWED',

                message:
                    'One or more submitted settings are not supported by the settings API.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    return next();
}

/**
 * ============================================================================
 * Nested Feature Allowlist
 * ============================================================================
 */

function enforceFeatureAllowlist(
    req,
    res,
    next
) {
    const features =
        req.body?.features;

    if (
        features ===
            undefined
    ) {
        return next();
    }

    if (
        !features ||
        typeof features !==
            'object' ||
        Array.isArray(features)
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'SETTINGS_FEATURES_INVALID',

                message:
                    'features must be an object.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    const allowedFeatureKeys =
        new Set([
            'directMessaging',
            'loans',
        ]);

    const unsupported =
        Object.keys(
            features
        ).filter(
            key =>
                !allowedFeatureKeys.has(
                    key
                )
        );

    if (
        unsupported.length
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'SETTINGS_FEATURE_NOT_ALLOWED',

                message:
                    'One or more feature settings are not supported by this API.',

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
 * Rate Limiters
 * ============================================================================
 */

const settingsReadLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_SETTINGS_READ_RATE_LIMIT',
                120
            ),

        code:
            'SETTINGS_READ_RATE_LIMITED',

        message:
            'Too many settings requests. Please try again later.',
    });

const settingsWriteLimiter =
    createLimiter({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_SETTINGS_WRITE_RATE_LIMIT',
                20
            ),

        code:
            'SETTINGS_WRITE_RATE_LIMITED',

        message:
            'Too many settings update requests. Please try again later.',
    });

function createLimiter({
    windowMs,
    max,
    code,
    message,
}) {
    return rateLimit({
        windowMs,

        max,

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
                    req.settingsActorId ||
                    req.user?.id ||
                    req.user?._id ||
                    req.user?.userId ||
                    req.auth?.userId
                ) ||
                normalizeString(
                    req.tenantId
                ) ||
                normalizeString(
                    req.ip
                ) ||
                'unknown'
            );
        },

        handler(
            req,
            res
        ) {
            const retryAfter =
                Math.ceil(
                    windowMs /
                    1000
                );

            res.setHeader(
                'Retry-After',
                String(
                    retryAfter
                )
            );

            return res
                .status(429)
                .json({
                    success:
                        false,

                    code,

                    message,

                    retryAfter,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    });
}

/**
 * ============================================================================
 * Admin Authorization
 * ============================================================================
 */

function requireSettingsAdmin(
    req,
    res,
    next
) {
    if (
        typeof requireRole ===
            'function'
    ) {
        return requireRole(
            'ADMIN'
        )(
            req,
            res,
            next
        );
    }

    if (
        typeof isAdmin ===
            'function'
    ) {
        return isAdmin(
            req,
            res,
            next
        );
    }

    return res
        .status(503)
        .json({
            success:
                false,

            code:
                'SETTINGS_ADMIN_AUTH_UNAVAILABLE',

            message:
                'Settings administrative authorization is unavailable.',

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,
        });
}

/**
 * ============================================================================
 * Async Handler
 * ============================================================================
 */

function asyncRouteHandler(
    handler
) {
    if (
        typeof handler !==
            'function'
    ) {
        throw new TypeError(
            `[${ROUTER_NAME}] Async route handler must be a function.`
        );
    }

    return (
        req,
        res,
        next
    ) => {
        Promise
            .resolve(
                handler(
                    req,
                    res,
                    next
                )
            )
            .catch(
                next
            );
    };
}

/**
 * ============================================================================
 * GET /api/settings
 * ============================================================================
 *
 * Settings are tenant/user-context scoped and authenticated.
 *
 * The controller should return only settings safe for the requesting actor.
 * ============================================================================
 */

router.get(
    '/',

    settingsReadLimiter,

    asyncRouteHandler(
        async (
            req,
            res,
            next
        ) => {
            req.settingsContext =
                {
                    tenantId:
                        req.tenantId,

                    actorId:
                        req.settingsActorId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                };

            return settingsController
                .getSettings(
                    req,
                    res,
                    next
                );
        }
    )
);

/**
 * ============================================================================
 * PUT /api/settings
 * ============================================================================
 *
 * Settings mutation is restricted to administrators.
 * ============================================================================
 */

router.put(
    '/',

    settingsWriteLimiter,

    requireSettingsAdmin,

    enforceSettingsAllowlist,

    enforceFeatureAllowlist,

    ...settingsValidation,

    handleValidation,

    asyncRouteHandler(
        async (
            req,
            res,
            next
        ) => {
            req.settingsContext =
                {
                    tenantId:
                        req.tenantId,

                    actorId:
                        req.settingsActorId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                };

            return settingsController
                .updateSettings(
                    req,
                    res,
                    next
                );
        }
    )
);

/**
 * ============================================================================
 * HEALTH
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

                authenticated:
                    true,

                tenantScoped:
                    true,

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
                    'SETTINGS_ROUTE_NOT_FOUND',

                message:
                    'Settings endpoint not found.',

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

        const statusCode =
            Number(
                error?.statusCode
            ) >=
                400 &&
            Number(
                error?.statusCode
            ) <
                600
                ? Number(
                    error.statusCode
                )
                : 500;

        const clientError =
            statusCode >=
                400 &&
            statusCode <
                500;

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
                    (
                        clientError
                            ? 'SETTINGS_REQUEST_ERROR'
                            : 'SETTINGS_INTERNAL_ERROR'
                    ),

                message:
                    clientError
                        ? (
                            error?.message ||
                            'The settings request could not be completed.'
                        )
                        : 'The settings request could not be completed.',

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
 * Helpers
 * ============================================================================
 */

function resolveAuthenticationMiddleware() {
    const candidates =
        [
            '../middleware/auth',
            '../middleware/authMiddleware',
            '../middleware/requireAuth',
        ];

    for (
        const candidate of
            candidates
    ) {
        try {
            const loaded =
                require(
                    candidate
                );

            if (
                typeof loaded ===
                    'function'
            ) {
                return loaded;
            }

            const middleware =
                loaded?.authenticate ||
                loaded?.verifyToken ||
                loaded?.verifyAccessToken ||
                loaded?.requireAuth;

            if (
                typeof middleware ===
                    'function'
            ) {
                return middleware;
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