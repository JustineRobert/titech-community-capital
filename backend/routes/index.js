'use strict';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

import authModule from '../middleware/auth.js';
import idempotencyModule from '../middleware/idempotency.js';
import contributionsControllerModule from '../controllers/contributionsController.js';

/**
 * =============================================================================
 * TITech Community Capital Ltd
 * Enterprise API Route Registry
 * =============================================================================
 *
 * File:
 *   backend/routes/index.js
 *
 * Purpose:
 *   Canonical application route registry for the TITech Community Capital
 *   backend.
 *
 * Bootstrap contract:
 *
 *   const {
 *       registerRoutes,
 *   } = require('../routes');
 *
 *   registerRoutes(app);
 *
 * Responsibilities:
 *   - Register the canonical TITech API route registry.
 *   - Preserve CommonJS router compatibility.
 *   - Validate middleware/controller contracts during startup.
 *   - Enforce authentication on protected financial boundaries.
 *   - Enforce trusted tenant context for financial operations.
 *   - Require idempotency for financial mutations.
 *   - Establish request/correlation tracing metadata.
 *   - Validate financial route parameters.
 *   - Register liveness, health, readiness and metadata endpoints.
 *   - Prevent duplicate registration against the same Express application.
 *   - Register a final route-level 404 handler.
 *
 * Non-responsibilities:
 *   - Database initialization.
 *   - Redis initialization.
 *   - Business logic.
 *   - Financial transaction orchestration.
 *   - Ledger posting.
 *   - Global Express error-handler ownership.
 *
 * Important:
 *   The final application error handler belongs to the application bootstrap
 *   layer and must be registered after this route registry.
 *
 * =============================================================================
 */

const express = require('express');
const crypto = require('node:crypto');

const {
    param,
    validationResult,
} = require('express-validator');

/**
 * =============================================================================
 * Application Identity
 * =============================================================================
 */

const SERVICE_NAME =
    normalizeEnvironmentValue(
        process.env.SERVICE_NAME,
        'titech-community-capital-backend',
    );

const APPLICATION_NAME =
    normalizeEnvironmentValue(
        process.env.APP_NAME,
        'TITech Community Capital',
    );

const APPLICATION_LEGAL_NAME =
    'TITech Community Capital Ltd';

const API_PREFIX =
    '/api/v1';

const ROUTER_MOUNT_PATH =
    '/';

const ROUTE_REGISTRY_NAME =
    'titech-api-v1';

const ROUTE_REGISTRY_VERSION =
    '1.2.0';

const API_VERSION =
    'v1';

const NODE_ENV =
    normalizeEnvironmentValue(
        process.env.NODE_ENV,
        'development',
    );

const IS_PRODUCTION =
    NODE_ENV ===
    'production';

/**
 * =============================================================================
 * Router
 * =============================================================================
 */

const router =
    express.Router({
        caseSensitive:
            false,

        strict:
            false,

        mergeParams:
            false,
    });

/**
 * =============================================================================
 * Router Metadata
 * =============================================================================
 */

const ROUTE_METADATA =
    Object.freeze({
        service:
            SERVICE_NAME,

        application:
            APPLICATION_NAME,

        applicationLegalName:
            APPLICATION_LEGAL_NAME,

        registry:
            ROUTE_REGISTRY_NAME,

        version:
            ROUTE_REGISTRY_VERSION,

        apiVersion:
            API_VERSION,

        environment:
            NODE_ENV,
    });

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

function normalizeEnvironmentValue(
    value,
    fallback,
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
            value,
        ).trim();

    return (
        normalized ||
        fallback
    );
}

function normalizeString(
    value,
    fallback = null,
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
            value,
        ).trim();

    return (
        normalized ||
        fallback
    );
}

/**
 * =============================================================================
 * Standard API Error Response
 * =============================================================================
 *
 * The route registry deliberately owns only route-level errors.
 *
 * Business/application exceptions continue to flow to the global application
 * error handler via next(error).
 * =============================================================================
 */

function sendRouteError(
    res,
    req,
    {
        statusCode = 400,
        code,
        message,
        details,
    },
) {
    const response =
        {
            success:
                false,

            error: {
                code,
                message,
            },

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            timestamp:
                new Date().toISOString(),
        };

    if (
        details !==
            undefined &&
        details !==
            null
    ) {
        response.error.details =
            details;
    }

    return res
        .status(
            statusCode,
        )
        .json(
            response,
        );
}

/**
 * =============================================================================
 * Module Resolution
 * =============================================================================
 */

function resolveModuleExport(
    loadedModule,
) {
    if (
        loadedModule &&
        typeof loadedModule ===
            'object' &&
        loadedModule.default
    ) {
        return loadedModule.default;
    }

    return loadedModule;
}

function requireRouteDependency(
    relativePath,
    dependencyName,
) {
    try {
        const loaded =
            require(
                relativePath,
            );

        return resolveModuleExport(
            loaded,
        );
    } catch (
        error
    ) {
        const startupError =
            new Error(
                `Failed to load TITech route dependency "${dependencyName}" from "${relativePath}".`,
            );

        startupError.code =
            'TITECH_ROUTE_DEPENDENCY_LOAD_FAILED';

        startupError.dependency =
            dependencyName;

        startupError.modulePath =
            relativePath;

        startupError.cause =
            error;

        throw startupError;
    }
}

function resolveOptionalModule(
    candidates,
) {
    for (
        const candidate of
        candidates
    ) {
        try {
            return resolveModuleExport(
                require(
                    candidate,
                ),
            );
        } catch (
            error
        ) {
            if (
                error?.code !==
                'MODULE_NOT_FOUND'
            ) {
                throw error;
            }

            /**
             * Only continue when the candidate itself is missing.
             *
             * An installed module that throws during initialization must not
             * be silently swallowed.
             */
            if (
                error?.message &&
                !error.message.includes(
                    candidate,
                )
            ) {
                throw error;
            }
        }
    }

    return null;
}

function resolveMiddlewareExport(
    moduleValue,
    exportNames,
) {
    if (
        !moduleValue
    ) {
        return null;
    }

    if (
        typeof moduleValue ===
        'function'
    ) {
        return moduleValue;
    }

    for (
        const exportName of
        exportNames
    ) {
        if (
            typeof moduleValue[
                exportName
            ] ===
            'function'
        ) {
            return moduleValue[
                exportName
            ];
        }
    }

    return null;
}

/**
 * =============================================================================
 * Request / Correlation Metadata
 * =============================================================================
 */

const REQUEST_ID_MAX_LENGTH =
    128;

function sanitizeTraceId(
    value,
) {
    const normalized =
        normalizeString(
            value,
        );

    if (
        !normalized
    ) {
        return null;
    }

    if (
        normalized.length >
        REQUEST_ID_MAX_LENGTH
    ) {
        return null;
    }

    /**
     * Request IDs are opaque identifiers, but rejecting control characters
     * prevents malformed values from reaching response headers/log pipelines.
     */
    if (
        /[\u0000-\u001F\u007F]/.test(
            normalized,
        )
    ) {
        return null;
    }

    return normalized;
}

function requestMetadata(
    req,
    res,
    next,
) {
    const requestId =
        sanitizeTraceId(
            req.requestId,
        ) ||
        sanitizeTraceId(
            req.id,
        ) ||
        sanitizeTraceId(
            req.headers?.[
                'x-request-id'
            ],
        ) ||
        crypto.randomUUID();

    const correlationId =
        sanitizeTraceId(
            req.correlationId,
        ) ||
        sanitizeTraceId(
            req.headers?.[
                'x-correlation-id'
            ],
        ) ||
        requestId;

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

    res.setHeader(
        'X-Request-Id',
        requestId,
    );

    res.setHeader(
        'X-Correlation-Id',
        correlationId,
    );

    next();
}

router.use(
    requestMetadata,
);

/**
 * =============================================================================
 * Route-Level Security Headers
 * ============================================================================= *
 *
 * These are intentionally conservative and do not attempt to replace a
 * dedicated application-wide security middleware such as Helmet.
 * =============================================================================
 */

router.use(
    (
        req,
        res,
        next,
    ) => {
        res.setHeader(
            'X-Content-Type-Options',
            'nosniff',
        );

        res.setHeader(
            'Referrer-Policy',
            'strict-origin-when-cross-origin',
        );

        res.setHeader(
            'X-Frame-Options',
            'DENY',
        );

        res.setHeader(
            'Permissions-Policy',
            'camera=(), microphone=(), geolocation=()',
        );

        next();
    },
);

/**
 * =============================================================================
 * Authentication Middleware
 * =============================================================================
 */

const authenticationModule =
    authModule;

const authenticate =
    resolveMiddlewareExport(
        authenticationModule,
        [
            'authenticate',
            'verifyToken',
        ],
    );

if (
    typeof authenticate !==
    'function'
) {
    const error =
        new TypeError(
            'TITech authentication middleware must export authenticate() or verifyToken(), or itself be callable.',
        );

    error.code =
        'TITECH_AUTHENTICATE_EXPORT_INVALID';

    throw error;
}

/**
 * =============================================================================
 * Tenant Authorization Middleware
 * =============================================================================
 *
 * Tenant authorization is mandatory for financial boundaries.
 *
 * The registry deliberately supports the project's possible existing naming
 * conventions without weakening the requirement.
 * =============================================================================
 */

const tenantAuthorizationModule =
    resolveOptionalModule(
        [
            '../middleware/tenantAuthorization',
            '../middleware/tenant.authorization',
            '../middleware/tenantMiddleware',
            '../middleware/tenant',
        ],
    );

const tenantAuthorization =
    resolveMiddlewareExport(
        tenantAuthorizationModule,
        [
            'tenantAuthorization',
            'requireTenant',
            'tenantMiddleware',
        ],
    );

if (
    typeof tenantAuthorization !==
    'function'
) {
    const error =
        new TypeError(
            'TITech financial routes require trusted tenant authorization middleware.',
        );

    error.code =
        'TITECH_TENANT_AUTHORIZATION_EXPORT_INVALID';

    throw error;
}

/**
 * =============================================================================
 * Idempotency Middleware
 * =============================================================================
 */

const idempotencyFactory =
    resolveMiddlewareExport(
        idempotencyModule,
        [
            'idempotency',
        ],
    );

if (
    typeof idempotencyFactory !==
    'function'
) {
    const error =
        new TypeError(
            'TITech financial routes require a callable idempotency middleware factory.',
        );

    error.code =
        'TITECH_IDEMPOTENCY_EXPORT_INVALID';

    throw error;
}

/**
 * =============================================================================
 * Controllers
 * =============================================================================
 */

const contributionsController =
    contributionsControllerModule;

const loansController =
    requireRouteDependency(
        '../controllers/loansController',
        'loans controller',
    );

const repaymentsController =
    requireRouteDependency(
        '../controllers/repaymentsController',
        'repayments controller',
    );

const walletsController =
    requireRouteDependency(
        '../controllers/groupWalletController',
        'group wallet controller',
    );

const offlineSyncRoutes =
    requireRouteDependency(
        '../modules/offline/routes/offline-sync.routes',
        'offline synchronization routes',
    );

/**
 * =============================================================================
 * Controller Contract Validation
 * =============================================================================
 */

function requireControllerMethod(
    controller,
    controllerName,
    methodName,
) {
    if (
        !controller ||
        typeof controller[
            methodName
        ] !==
            'function'
    ) {
        const error =
            new TypeError(
                `TITech ${controllerName} must export "${methodName}()".`,
            );

        error.code =
            'TITECH_ROUTE_CONTROLLER_CONTRACT_INVALID';

        error.controller =
            controllerName;

        error.method =
            methodName;

        throw error;
    }

    return controller[
        methodName
    ];
}

const createContribution =
    requireControllerMethod(
        contributionsController,
        'contributions controller',
        'createContribution',
    );

const createLoan =
    requireControllerMethod(
        loansController,
        'loans controller',
        'createLoan',
    );

const createRepayment =
    requireControllerMethod(
        repaymentsController,
        'repayments controller',
        'createRepayment',
    );

const getBalance =
    requireControllerMethod(
        walletsController,
        'group wallet controller',
        'getBalance',
    );

const getLedger =
    requireControllerMethod(
        walletsController,
        'group wallet controller',
        'getLedger',
    );

/**
 * =============================================================================
 * Async Handler
 * =============================================================================
 */

function asyncHandler(
    handler,
) {
    if (
        typeof handler !==
        'function'
    ) {
        const error =
            new TypeError(
                'TITech asyncHandler requires a function.',
            );

        error.code =
            'TITECH_ROUTE_HANDLER_INVALID';

        throw error;
    }

    return function asyncRouteHandler(
        req,
        res,
        next,
    ) {
        Promise.resolve(
            handler(
                req,
                res,
                next,
            ),
        ).catch(
            next,
        );
    };
}

/**
 * =============================================================================
 * Financial Idempotency Adapter
 * =============================================================================
 */

function createFinancialIdempotency(
    operation,
    resource,
) {
    let middleware;

    try {
        middleware =
            idempotencyFactory({
                operation,

                resource,

                required:
                    true,
            });
    } catch (
        error
    ) {
        const startupError =
            new Error(
                `Failed to create TITech idempotency middleware for "${operation}".`,
            );

        startupError.code =
            'TITECH_IDEMPOTENCY_MIDDLEWARE_FACTORY_FAILED';

        startupError.operation =
            operation;

        startupError.resource =
            resource;

        startupError.cause =
            error;

        throw startupError;
    }

    if (
        typeof middleware !==
        'function'
    ) {
        const error =
            new TypeError(
                `Invalid TITech idempotency middleware for operation "${operation}".`,
            );

        error.code =
            'TITECH_IDEMPOTENCY_MIDDLEWARE_INVALID';

        error.operation =
            operation;

        error.resource =
            resource;

        throw error;
    }

    return middleware;
}

/**
 * =============================================================================
 * Request Body Validation
 * =============================================================================
 */

function requireObjectBody(
    req,
    res,
    next,
) {
    if (
        !req.body ||
        typeof req.body !==
            'object' ||
        Array.isArray(
            req.body,
        )
    ) {
        return sendRouteError(
            res,
            req,
            {
                statusCode:
                    400,

                code:
                    'TITECH_INVALID_REQUEST_BODY',

                message:
                    'A JSON object request body is required.',
            },
        );
    }

    next();
}

/**
 * =============================================================================
 * Idempotency-Key Validation
 * =============================================================================
 */

const IDEMPOTENCY_KEY_MIN_LENGTH =
    16;

const IDEMPOTENCY_KEY_MAX_LENGTH =
    255;

function requireIdempotencyKey(
    req,
    res,
    next,
) {
    const key =
        normalizeString(
            req.headers?.[
                'idempotency-key'
            ],
        );

    if (
        !key
    ) {
        return sendRouteError(
            res,
            req,
            {
                statusCode:
                    400,

                code:
                    'IDEMPOTENCY_KEY_REQUIRED',

                message:
                    'Idempotency-Key is required for financial mutations.',
            },
        );
    }

    if (
        key.length <
            IDEMPOTENCY_KEY_MIN_LENGTH ||
        key.length >
            IDEMPOTENCY_KEY_MAX_LENGTH
    ) {
        return sendRouteError(
            res,
            req,
            {
                statusCode:
                    400,

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    `Idempotency-Key must contain between ${IDEMPOTENCY_KEY_MIN_LENGTH} and ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
            },
        );
    }

    if (
        /[\u0000-\u001F\u007F]/.test(
            key,
        )
    ) {
        return sendRouteError(
            res,
            req,
            {
                statusCode:
                    400,

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    'Idempotency-Key contains unsupported characters.',
            },
        );
    }

    req.idempotencyKey =
        key;

    next();
}

/**
 * =============================================================================
 * Validation Result Middleware
 * =============================================================================
 */

function handleValidationResult(
    req,
    res,
    next,
) {
    const errors =
        validationResult(
            req,
        );

    if (
        errors.isEmpty()
    ) {
        return next();
    }

    return sendRouteError(
        res,
        req,
        {
            statusCode:
                400,

            code:
                'TITECH_VALIDATION_FAILED',

            message:
                'One or more request parameters are invalid.',

            details:
                errors.array({
                    onlyFirstError:
                        true,
                }),
        },
    );
}

/**
 * =============================================================================
 * Group Wallet Parameter Validation
 * =============================================================================
 */

function validateWalletId(
    req,
    res,
    next,
) {
    const id =
        normalizeString(
            req.params?.id,
        );

    if (
        !id
    ) {
        return sendRouteError(
            res,
            req,
            {
                statusCode:
                    400,

                code:
                    'GROUP_WALLET_ID_REQUIRED',

                message:
                    'Group wallet ID is required.',
            },
        );
    }

    if (
        !/^[a-f\d]{24}$/i.test(
            id,
        )
    ) {
        return sendRouteError(
            res,
            req,
            {
                statusCode:
                    400,

                code:
                    'INVALID_GROUP_WALLET_ID',

                message:
                    'Group wallet ID must be a valid identifier.',
            },
        );
    }

    next();
}

/**
 * =============================================================================
 * MongoDB Parameter Validation
 * =============================================================================
 */

function validateObjectIdParameter(
    parameterName,
) {
    return [
        param(
            parameterName,
        )
            .exists()
            .withMessage(
                `${parameterName} is required.`,
            )
            .bail()
            .isMongoId()
            .withMessage(
                `${parameterName} must be a valid identifier.`,
            ),

        handleValidationResult,
    ];
}

/**
 * =============================================================================
 * Financial Route Middleware
 * =============================================================================
 *
 * Security ordering:
 *
 *   1. Authenticate principal
 *   2. Resolve/verify trusted tenant context
 *   3. Validate request body
 *   4. Validate idempotency key
 *   5. Resolve idempotency state
 *   6. Execute financial controller
 *
 * This prevents an unauthenticated or untrusted caller from establishing an
 * idempotency namespace.
 * =============================================================================
 */

const financialWriteChain = [
    authenticate,

    tenantAuthorization,

    requireObjectBody,

    requireIdempotencyKey,
];

/**
 * =============================================================================
 * CONTRIBUTIONS
 * =============================================================================
 */

router.post(
    `${API_PREFIX}/contributions`,

    ...financialWriteChain,

    createFinancialIdempotency(
        'CONTRIBUTION_CREATE',
        'contributions',
    ),

    asyncHandler(
        (
            req,
            res,
            next,
        ) =>
            createContribution(
                req,
                res,
                next,
            ),
    ),
);

/**
 * =============================================================================
 * LOANS
 * =============================================================================
 */

router.post(
    `${API_PREFIX}/loans`,

    ...financialWriteChain,

    createFinancialIdempotency(
        'LOAN_CREATE',
        'loans',
    ),

    asyncHandler(
        (
            req,
            res,
            next,
        ) =>
            createLoan(
                req,
                res,
                next,
            ),
    ),
);

/**
 * =============================================================================
 * LOAN REPAYMENTS
 * =============================================================================
 */

router.post(
    `${API_PREFIX}/repayments`,

    ...financialWriteChain,

    createFinancialIdempotency(
        'LOAN_REPAYMENT_CREATE',
        'repayments',
    ),

    asyncHandler(
        (
            req,
            res,
            next,
        ) =>
            createRepayment(
                req,
                res,
                next,
            ),
    ),
);

router.use(
    '/api',
    offlineSyncRoutes,
);

/**
 * =============================================================================
 * GROUP WALLET READ ROUTES
 * =============================================================================
 */

router.get(
    `${API_PREFIX}/group-wallets/:id/balance`,

    authenticate,

    tenantAuthorization,

    validateWalletId,

    asyncHandler(
        (
            req,
            res,
            next,
        ) =>
            getBalance(
                req,
                res,
                next,
            ),
    ),
);

router.get(
    `${API_PREFIX}/group-wallets/:id/ledger`,

    authenticate,

    tenantAuthorization,

    validateWalletId,

    asyncHandler(
        (
            req,
            res,
            next,
        ) =>
            getLedger(
                req,
                res,
                next,
            ),
    ),
);

/**
 * =============================================================================
 * LIVENESS
 * =============================================================================
 *
 * Liveness intentionally:
 *   - requires no authentication;
 *   - performs no database checks;
 *   - performs no Redis checks;
 *   - performs no external dependency checks.
 *
 * It answers one question:
 *
 *   "Is the HTTP process alive?"
 * =============================================================================
 */

router.get(
    `${API_PREFIX}/live`,
    (
        req,
        res,
    ) => {
        return res
            .status(200)
            .json({
                success:
                    true,

                status:
                    'alive',

                service:
                    ROUTE_METADATA.service,

                application:
                    ROUTE_METADATA.application,

                version:
                    ROUTE_METADATA.version,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    },
);

/**
 * =============================================================================
 * HEALTH
 * =============================================================================
 *
 * Health is intentionally lightweight.
 *
 * Dependency-specific health checks belong to the application's health
 * subsystem rather than being duplicated inside this route registry.
 * =============================================================================
 */

router.get(
    `${API_PREFIX}/health`,
    (
        req,
        res,
    ) => {
        return res
            .status(200)
            .json({
                success:
                    true,

                status:
                    'healthy',

                service:
                    ROUTE_METADATA.service,

                application:
                    ROUTE_METADATA.application,

                version:
                    ROUTE_METADATA.version,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                timestamp:
                    new Date().toISOString(),
            });
    },
);

/**
 * =============================================================================
 * READINESS
 * =============================================================================
 *
 * Bootstrap may expose:
 *
 *   app.locals.titechReadiness
 *
 * Supported forms:
 *
 *   () => boolean
 *
 * or:
 *
 *   async () => boolean
 *
 * Async readiness functions are intentionally supported because database,
 * Redis, queue and other infrastructure readiness may be asynchronous.
 * =============================================================================
 */

router.get(
    `${API_PREFIX}/ready`,
    asyncHandler(
        async (
            req,
            res,
        ) => {
            const readiness =
                req.app?.locals
                    ?.titechReadiness;

            let isReady =
                true;

            if (
                typeof readiness ===
                'function'
            ) {
                try {
                    isReady =
                        Boolean(
                            await readiness(),
                        );
                } catch {
                    isReady =
                        false;
                }
            }

            return res
                .status(
                    isReady
                        ? 200
                        : 503,
                )
                .json({
                    success:
                        isReady,

                    status:
                        isReady
                            ? 'ready'
                            : 'not_ready',

                    service:
                        ROUTE_METADATA.service,

                    application:
                        ROUTE_METADATA.application,

                    version:
                        ROUTE_METADATA.version,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    ),
);

/**
 * =============================================================================
 * Route Registry Metadata
 * =============================================================================
 *
 * Metadata is intentionally restricted to non-sensitive operational
 * information. No credentials, secrets, connection strings, internal host
 * information or controller details are exposed.
 *
 * In production, callers can optionally disable this endpoint with:
 *
 *   TITECH_EXPOSE_ROUTE_META=false
 * =============================================================================
 */

const EXPOSE_ROUTE_META =
    normalizeEnvironmentValue(
        process.env.TITECH_EXPOSE_ROUTE_META,
        IS_PRODUCTION
            ? 'false'
            : 'true',
    ).toLowerCase() ===
    'true';

if (
    EXPOSE_ROUTE_META
) {
    router.get(
        `${API_PREFIX}/meta`,
        (
            req,
            res,
        ) => {
            return res
                .status(200)
                .json({
                    success:
                        true,

                    service:
                        ROUTE_METADATA.service,

                    application:
                        ROUTE_METADATA.application,

                    applicationLegalName:
                        ROUTE_METADATA
                            .applicationLegalName,

                    registry:
                        ROUTE_METADATA.registry,

                    version:
                        ROUTE_METADATA.version,

                    apiVersion:
                        ROUTE_METADATA.apiVersion,

                    financialMutations:
                        'tenant-scoped-and-idempotent',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    );
}

/**
 * =============================================================================
 * Route Registry 404
 * =============================================================================
 *
 * This must remain the final middleware in this router.
 *
 * It handles only requests that reach the route registry without matching a
 * registered route.
 *
 * Unexpected application/business exceptions continue to the global Express
 * error handler.
 * =============================================================================
 */

function registerNotFoundHandler(
    targetRouter,
) {
    if (
        !targetRouter ||
        typeof targetRouter.use !==
            'function'
    ) {
        const error =
            new TypeError(
                'TITech route registry requires a valid Express router.',
            );

        error.code =
            'TITECH_ROUTE_REGISTRY_INVALID';

        throw error;
    }

    targetRouter.use(
        (
            req,
            res,
        ) => {
            return res
                .status(404)
                .json({
                    success:
                        false,

                    error: {
                        code:
                            'ROUTE_NOT_FOUND',

                        message:
                            'The requested TITech API route was not found.',
                    },

                    path:
                        req.originalUrl ||
                        req.url,

                    method:
                        req.method,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    );

    return targetRouter;
}

registerNotFoundHandler(
    router,
);

/**
 * =============================================================================
 * Registration State
 * =============================================================================
 *
 * WeakSet ensures:
 *
 *   registerRoutes(app);
 *   registerRoutes(app);
 *
 * does not mount the same registry twice.
 *
 * WeakSet also allows the Express application to be garbage collected.
 * =============================================================================
 */

const registeredApplications =
    new WeakSet();

/**
 * =============================================================================
 * Route Registration
 * =============================================================================
 *
 * Canonical:
 *
 *   const {
 *       registerRoutes,
 *   } = require('../routes');
 *
 *   registerRoutes(app);
 *
 * Optional:
 *
 *   registerRoutes(app, {
 *       mountPath: '/',
 *   });
 * =============================================================================
 */

function registerRoutes(
    app,
    {
        mountPath =
            ROUTER_MOUNT_PATH,
    } = {},
) {
    if (
        !app ||
        typeof app.use !==
            'function'
    ) {
        const error =
            new TypeError(
                'TITech registerRoutes(app) requires a valid Express application.',
            );

        error.code =
            'TITECH_ROUTE_APPLICATION_INVALID';

        throw error;
    }

    if (
        registeredApplications.has(
            app,
        )
    ) {
        return app;
    }

    const normalizedMountPath =
        normalizeString(
            mountPath,
            ROUTER_MOUNT_PATH,
        );

    if (
        !normalizedMountPath.startsWith(
            '/',
        )
    ) {
        const error =
            new TypeError(
                'TITech route mountPath must start with "/".',
            );

        error.code =
            'TITECH_ROUTE_MOUNT_PATH_INVALID';

        throw error;
    }

    app.use(
        normalizedMountPath,
        router,
    );

    if (
        !app.locals
    ) {
        app.locals =
            {};
    }

    app.locals.titechRouteRegistry =
        Object.freeze({
            name:
                ROUTE_METADATA.registry,

            version:
                ROUTE_METADATA.version,

            apiVersion:
                ROUTE_METADATA.apiVersion,

            mountPath:
                normalizedMountPath,

            registered:
                true,
        });

    registeredApplications.add(
        app,
    );

    return app;
}

/**
 * =============================================================================
 * Registry Diagnostics
 * =============================================================================
 */

function getRouteRegistryDiagnostics() {
    return Object.freeze({
        service:
            ROUTE_METADATA.service,

        application:
            ROUTE_METADATA.application,

        applicationLegalName:
            ROUTE_METADATA.applicationLegalName,

        registry:
            ROUTE_METADATA.registry,

        version:
            ROUTE_METADATA.version,

        apiVersion:
            ROUTE_METADATA.apiVersion,

        environment:
            ROUTE_METADATA.environment,

        exposeRouteMeta:
            EXPOSE_ROUTE_META,

        authenticationMiddleware:
            typeof authenticate ===
            'function',

        tenantAuthorization:
            typeof tenantAuthorization ===
            'function',

        idempotencyFactory:
            typeof idempotencyFactory ===
            'function',

        controllerContracts:
            Object.freeze({
                contributions:
                    typeof createContribution ===
                    'function',

                loans:
                    typeof createLoan ===
                    'function',

                repayments:
                    typeof createRepayment ===
                    'function',

                groupWalletBalance:
                    typeof getBalance ===
                    'function',

                groupWalletLedger:
                    typeof getLedger ===
                    'function',
            }),

        financialRoutePolicy:
            Object.freeze({
                authentication:
                    'required',

                tenantContext:
                    'required',

                idempotency:
                    'required',

                requestBody:
                    'object',
            }),
    });
}

/**
 * =============================================================================
 * CommonJS Compatibility
 * =============================================================================
 *
 * Existing consumers may continue to use:
 *
 *   const routes = require('./routes');
 *   app.use(routes);
 *
 * while canonical bootstrap code can use:
 *
 *   const {
 *       registerRoutes,
 *   } = require('./routes');
 *
 *   registerRoutes(app);
 * =============================================================================
 */

router.registerRoutes =
    registerRoutes;

router.registerNotFoundHandler =
    registerNotFoundHandler;

router.getRouteRegistryDiagnostics =
    getRouteRegistryDiagnostics;

router.router =
    router;

router.asyncHandler =
    asyncHandler;

router.API_PREFIX =
    API_PREFIX;

router.API_VERSION =
    API_VERSION;

router.ROUTE_METADATA =
    ROUTE_METADATA;

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

export default router;