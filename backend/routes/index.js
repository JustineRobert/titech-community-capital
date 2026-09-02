'use strict';

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
 *       registerRoutes
 *   } = require('../routes');
 *
 *   registerRoutes(app);
 *
 * Responsibilities:
 *   - Register the canonical TITech API route registry.
 *   - Preserve CommonJS router compatibility.
 *   - Validate controller contracts during startup.
 *   - Enforce authentication on protected financial boundaries.
 *   - Enforce trusted tenant context for financial operations.
 *   - Require idempotency for financial mutations.
 *   - Apply request/correlation tracing.
 *   - Validate financial route parameters.
 *   - Register liveness / health / readiness endpoints.
 *   - Prevent duplicate registration against the same Express app.
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
 *   layer, after route registration.
 *
 * =============================================================================
 */

const express =
    require('express');

const crypto =
    require('node:crypto');

const {
    param,
} =
    require('express-validator');

/**
 * =============================================================================
 * Application Identity
 * =============================================================================
 */

const SERVICE_NAME =
    process.env.SERVICE_NAME ||
    'titech-community-capital-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'TITech Community Capital';

const APPLICATION_LEGAL_NAME =
    'TITech Community Capital Ltd';

const API_PREFIX =
    '/api/v1';

const ROUTER_MOUNT_PATH =
    '/';

const ROUTE_REGISTRY_NAME =
    'titech-api-v1';

const ROUTE_REGISTRY_VERSION =
    '1.1.0';

const API_VERSION =
    'v1';

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
    });

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
            require(relativePath);

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

/**
 * =============================================================================
 * Request Metadata
 * =============================================================================
 */

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

function requestMetadata(
    req,
    res,
    next,
) {
    const requestId =
        normalizeString(
            req.requestId,
        ) ||
        normalizeString(
            req.id,
        ) ||
        normalizeString(
            req.headers?.[
                'x-request-id'
            ],
        ) ||
        crypto.randomUUID();

    const correlationId =
        normalizeString(
            req.correlationId,
        ) ||
        normalizeString(
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
 * Security Headers
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

        next();
    },
);

/**
 * =============================================================================
 * Authentication Middleware
 * =============================================================================
 */

const authenticationModule =
    requireRouteDependency(
        '../middleware/auth',
        'authentication middleware',
    );

const authenticate =
    typeof authenticationModule ===
        'function'
        ? authenticationModule
        : (
            authenticationModule?.authenticate ||
            authenticationModule?.verifyToken
        );

if (
    typeof authenticate !==
    'function'
) {
    const error =
        new Error(
            'TITech authentication middleware must export authenticate() or verifyToken().',
        );

    error.code =
        'TITECH_AUTHENTICATE_EXPORT_INVALID';

    throw error;
}

/**
 * =============================================================================
 * Tenant Authorization
 * =============================================================================
 *
 * Financial operations must have a trusted tenant context before reaching the
 * financial controller.
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
    ) ||
    (
        tenantAuthorizationModule &&
        typeof tenantAuthorizationModule ===
            'function'
            ? tenantAuthorizationModule
            : null
    );

if (
    typeof tenantAuthorization !==
    'function'
) {
    const error =
        new Error(
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

const idempotencyModule =
    requireRouteDependency(
        '../middleware/idempotency',
        'idempotency middleware',
    );

const idempotencyFactory =
    resolveMiddlewareExport(
        idempotencyModule,
        [
            'idempotency',
        ],
    ) ||
    (
        typeof idempotencyModule ===
            'function'
            ? idempotencyModule
            : null
    );

if (
    typeof idempotencyFactory !==
    'function'
) {
    const error =
        new Error(
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
    requireRouteDependency(
        '../controllers/contributionsController',
        'contributions controller',
    );

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
    const middleware =
        idempotencyFactory({
            operation,

            resource,

            required:
                true,
        });

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

        throw error;
    }

    return middleware;
}

/**
 * =============================================================================
 * Financial Request Validation
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
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'TITECH_INVALID_REQUEST_BODY',

                message:
                    'A JSON object request body is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    next();
}

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
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'IDEMPOTENCY_KEY_REQUIRED',

                message:
                    'Idempotency-Key is required for financial mutations.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        key.length <
            16 ||
        key.length >
            255
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    'Idempotency-Key must contain between 16 and 255 characters.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        /[\u0000-\u001F\u007F]/.test(
            key,
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    'Idempotency-Key contains unsupported characters.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    req.idempotencyKey =
        key;

    next();
}

/**
 * =============================================================================
 * Group Wallet Parameter Validation
 * =============================================================================
 *
 * The current controller contract indicates MongoDB-style IDs, so validate
 * these before the controller executes.
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
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'GROUP_WALLET_ID_REQUIRED',

                message:
                    'Group wallet ID is required.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    if (
        !/^[a-f\d]{24}$/i.test(
            id,
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    'INVALID_GROUP_WALLET_ID',

                message:
                    'Group wallet ID must be a valid identifier.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }

    next();
}

/**
 * =============================================================================
 * Loan / Transaction Parameter Validation
 * ============================================================================= */

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
    ];
}

/**
 * =============================================================================
 * Financial Routes
 * =============================================================================
 *
 * IMPORTANT:
 * Authentication and tenant authorization are intentionally placed before
 * idempotency.
 *
 * This ensures idempotency scope is based on a trusted:
 *
 *   tenant + principal + key
 *
 * rather than an attacker-controlled identity.
 * =============================================================================
 */

const financialWriteChain = [
    authenticate,

    tenantAuthorization,

    requireObjectBody,

    requireIdempotencyKey,
];

/**
 * CONTRIBUTIONS
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
 * LOANS
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
 * LOAN REPAYMENTS
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

/**
 * =============================================================================
 * GROUP WALLET ROUTES
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
 * READ-ONLY FINANCIAL LOOKUP
 * ============================================================================= */

router.get(
    `${API_PREFIX}/transactions/:transactionId`,

    authenticate,

    tenantAuthorization,

    ...validateObjectIdParameter(
        'transactionId',
    ),

    asyncHandler(
        async (
            req,
            res,
            next,
        ) => {
            /**
             * This route deliberately requires the controller contract to be
             * extended before it is enabled.
             *
             * The current supplied registry exposes createContribution,
             * createLoan, createRepayment, getBalance and getLedger only.
             *
             * Therefore we do not invent a transaction lookup controller here.
             */
            const error =
                new Error(
                    'Transaction lookup is not connected to the current canonical controller contract.',
                );

            error.code =
                'TITECH_TRANSACTION_LOOKUP_NOT_CONFIGURED';

            error.statusCode =
                501;

            next(
                error,
            );
        },
    ),
);

/**
 * =============================================================================
 * LIVENESS
 * =============================================================================
 *
 * The liveness endpoint does not require authentication and does not test
 * external dependencies. It only proves the HTTP process is alive.
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
 * The bootstrap layer may expose:
 *
 *   req.app.locals.titechReadiness
 *
 * The route itself does not duplicate database/Redis health logic.
 * =============================================================================
 */

router.get(
    `${API_PREFIX}/ready`,
    (
        req,
        res,
    ) => {
        const readiness =
            req.app?.locals?.titechReadiness;

        let isReady =
            true;

        try {
            if (
                typeof readiness ===
                'function'
            ) {
                isReady =
                    Boolean(
                        readiness(),
                    );
            }
        } catch {
            isReady =
                false;
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
);

/**
 * =============================================================================
 * Route Registry Metadata
 * =============================================================================
 */

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
                    ROUTE_METADATA.applicationLegalName,

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

/**
 * =============================================================================
 * Route Registry 404
 * =============================================================================
 *
 * This should be the final middleware in this router.
 *
 * The global application error handler remains responsible for exceptions.
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
        throw new TypeError(
            'TITech route registry requires a valid Express router.',
        );
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
 *       registerRoutes
 *   } = require('../routes');
 *
 *   registerRoutes(app);
 *
 * Optional:
 *
 *   registerRoutes(app, {
 *       mountPath: '/'
 *   });
 *
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
    return {
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

        authenticationMiddleware:
            typeof authenticate ===
            'function',

        tenantAuthorization:
            typeof tenantAuthorization ===
            'function',

        idempotencyFactory:
            typeof idempotencyFactory ===
            'function',

        controllerContracts: {
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
        },
    };
}

/**
 * =============================================================================
 * Optional Dependency Resolution
 * =============================================================================
 */

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
            /**
             * Only ignore a missing candidate module.
             *
             * Errors originating from an installed module must surface.
             */
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
 * CommonJS Compatibility
 * =============================================================================
 *
 * Existing consumers can still do:
 *
 *   const routes = require('./routes');
 *
 * while the canonical bootstrap can do:
 *
 *   const {
 *       registerRoutes
 *   } = require('./routes');
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

router.ROUTE_METADATA =
    ROUTE_METADATA;

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

module.exports =
    router;