'use strict';

/**
 * =============================================================================
 * TITech Community Capital Ltd
 * Enterprise API Route Registry Test Suite
 * =============================================================================
 *
 * File:
 *   backend/routes/index.test.js
 *
 * Test framework:
 *   Jest
 *
 * Runtime contract:
 *   CommonJS
 *
 * Purpose:
 *   Enterprise contract/integration tests for the canonical TITech Community
 *   Capital API route registry.
 *
 * Coverage:
 *   - CommonJS router compatibility
 *   - registerRoutes(app)
 *   - duplicate registration protection
 *   - custom mount paths
 *   - request/correlation identifiers
 *   - route security headers
 *   - public liveness / health / readiness
 *   - metadata exposure
 *   - authentication boundary
 *   - trusted tenant boundary
 *   - financial idempotency boundary
 *   - request body validation
 *   - Idempotency-Key validation
 *   - ObjectId validation
 *   - controller delegation
 *   - controller async error propagation
 *   - route-level 404 behavior
 *   - route registry diagnostics
 *
 * Isolation:
 *   No real database, Redis, JWT verification, queues, payment providers,
 *   server bootstrap, or financial business logic are loaded by this suite.
 *
 * =============================================================================
 */

const express =
    require('express');

const request =
    require('supertest');

/**
 * =============================================================================
 * Mock Middleware
 * =============================================================================
 *
 * IMPORTANT:
 *
 * Jest hoists jest.mock() declarations. Mock variables referenced inside mock
 * factories therefore intentionally use the "mock*" naming convention.
 * =============================================================================
 */

const mockAuthenticate =
    jest.fn(
        (
            req,
            res,
            next,
        ) => {
            req.user = {
                id:
                    '65f000000000000000000001',

                userId:
                    '65f000000000000000000001',

                tenantId:
                    '65f000000000000000000010',

                role:
                    'member',
            };

            next();
        },
    );

const mockTenantAuthorization =
    jest.fn(
        (
            req,
            res,
            next,
        ) => {
            req.tenantContext = {
                tenantId:
                    req.user?.tenantId ||
                    '65f000000000000000000010',

                source:
                    'test-trusted-context',

                trusted:
                    true,
            };

            next();
        },
    );

const mockIdempotencyFactory =
    jest.fn(
        ({
            operation,
            resource,
            required,
        }) => {
            return (
                req,
                res,
                next,
            ) => {
                req.idempotencyContext = {
                    key:
                        req.idempotencyKey,

                    operation,

                    resource,

                    required:
                        Boolean(
                            required,
                        ),

                    replay:
                        false,
                };

                next();
            };
        },
    );

/**
 * =============================================================================
 * Mock Controllers
 * =============================================================================
 */

const mockCreateContribution =
    jest.fn(
        (
            req,
            res,
        ) => {
            return res
                .status(201)
                .json({
                    success:
                        true,

                    operation:
                        'createContribution',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    tenantId:
                        req.tenantContext
                            ?.tenantId,

                    idempotencyKey:
                        req.idempotencyKey,
                });
        },
    );

const mockCreateLoan =
    jest.fn(
        (
            req,
            res,
        ) => {
            return res
                .status(201)
                .json({
                    success:
                        true,

                    operation:
                        'createLoan',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    tenantId:
                        req.tenantContext
                            ?.tenantId,

                    idempotencyKey:
                        req.idempotencyKey,
                });
        },
    );

const mockCreateRepayment =
    jest.fn(
        (
            req,
            res,
        ) => {
            return res
                .status(201)
                .json({
                    success:
                        true,

                    operation:
                        'createRepayment',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    tenantId:
                        req.tenantContext
                            ?.tenantId,

                    idempotencyKey:
                        req.idempotencyKey,
                });
        },
    );

const mockGetBalance =
    jest.fn(
        (
            req,
            res,
        ) => {
            return res
                .status(200)
                .json({
                    success:
                        true,

                    operation:
                        'getBalance',

                    walletId:
                        req.params.id,

                    tenantId:
                        req.tenantContext
                            ?.tenantId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        },
    );

const mockGetLedger =
    jest.fn(
        (
            req,
            res,
        ) => {
            return res
                .status(200)
                .json({
                    success:
                        true,

                    operation:
                        'getLedger',

                    walletId:
                        req.params.id,

                    tenantId:
                        req.tenantContext
                            ?.tenantId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        },
    );

/**
 * =============================================================================
 * Jest Module Mocks
 * =============================================================================
 */

jest.mock(
    '../middleware/auth',
    () => ({
        __esModule:
            true,

        default:
            mockAuthenticate,

        authenticate:
            mockAuthenticate,

        verifyToken:
            mockAuthenticate,
    }),
);

jest.mock(
    '../middleware/tenantAuthorization',
    () => ({
        __esModule:
            true,

        default:
            mockTenantAuthorization,

        tenantAuthorization:
            mockTenantAuthorization,

        requireTenant:
            mockTenantAuthorization,

        tenantMiddleware:
            mockTenantAuthorization,
    }),
);

jest.mock(
    '../middleware/idempotency',
    () => ({
        __esModule:
            true,

        default:
            mockIdempotencyFactory,

        idempotency:
            mockIdempotencyFactory,
    }),
);

jest.mock(
    '../controllers/contributionsController',
    () => ({
        __esModule:
            true,

        default: {
            createContribution:
                mockCreateContribution,
        },

        createContribution:
            mockCreateContribution,
    }),
);

jest.mock(
    '../controllers/loansController',
    () => ({
        __esModule:
            true,

        default: {
            createLoan:
                mockCreateLoan,
        },

        createLoan:
            mockCreateLoan,
    }),
);

jest.mock(
    '../controllers/repaymentsController',
    () => ({
        __esModule:
            true,

        default: {
            createRepayment:
                mockCreateRepayment,
        },

        createRepayment:
            mockCreateRepayment,
    }),
);

jest.mock(
    '../controllers/groupWalletController',
    () => ({
        __esModule:
            true,

        default: {
            getBalance:
                mockGetBalance,

            getLedger:
                mockGetLedger,
        },

        getBalance:
            mockGetBalance,

        getLedger:
            mockGetLedger,
    }),
);

/**
 * =============================================================================
 * Route Registry
 * =============================================================================
 */

let routes;

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const TENANT_ID =
    '65f000000000000000000010';

const USER_ID =
    '65f000000000000000000001';

const MEMBER_ID =
    '65f000000000000000000002';

const LOAN_ID =
    '65f000000000000000000003';

const WALLET_ID =
    '65f000000000000000000020';

/**
 * =============================================================================
 * Test Application Factory
 * =============================================================================
 */

function createTestApplication(
    {
        mountPath =
            '/',
        readiness,
    } = {},
) {
    const app =
        express();

    app.disable(
        'x-powered-by',
    );

    app.use(
        express.json({
            limit:
                '1mb',
        }),
    );

    if (
        readiness !==
        undefined
    ) {
        app.locals.titechReadiness =
            readiness;
    }

    routes.registerRoutes(
        app,
        {
            mountPath,
        },
    );

    /**
     * Production contract:
     *
     * The application's final error handler belongs after route registration.
     */
    app.use(
        (
            error,
            req,
            res,
            next,
        ) => {
            void next;

            return res
                .status(
                    Number.isInteger(
                        error?.statusCode,
                    )
                        ? error.statusCode
                        : Number.isInteger(
                            error?.status,
                        )
                            ? error.status
                            : 500,
                )
                .json({
                    success:
                        false,

                    error: {
                        code:
                            error?.code ||
                            'INTERNAL_SERVER_ERROR',

                        message:
                            error?.message ||
                            'Internal server error.',
                    },

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        },
    );

    return app;
}

/**
 * =============================================================================
 * Test Lifecycle
 * ============================================================================= */

beforeAll(
    () => {
        process.env.NODE_ENV =
            'test';

        process.env.TITECH_EXPOSE_ROUTE_META =
            'true';

        routes =
            require(
                './index',
            );
    },
);

beforeEach(
    () => {
        jest.clearAllMocks();

        mockAuthenticate.mockImplementation(
            (
                req,
                res,
                next,
            ) => {
                req.user = {
                    id:
                        USER_ID,

                    userId:
                        USER_ID,

                    tenantId:
                        TENANT_ID,

                    role:
                        'member',
                };

                next();
            },
        );

        mockTenantAuthorization.mockImplementation(
            (
                req,
                res,
                next,
            ) => {
                req.tenantContext = {
                    tenantId:
                        req.user?.tenantId ||
                        TENANT_ID,

                    source:
                        'test-trusted-context',

                    trusted:
                        true,
                };

                next();
            },
        );

        mockIdempotencyFactory.mockImplementation(
            ({
                operation,
                resource,
                required,
            }) =>
                (
                    req,
                    res,
                    next,
                ) => {
                    req.idempotencyContext =
                        {
                            key:
                                req.idempotencyKey,

                            operation,

                            resource,

                            required:
                                Boolean(
                                    required,
                                ),

                            replay:
                                false,
                        };

                    next();
                },
        );
    },
);

/**
 * =============================================================================
 * Module Contract
 * =============================================================================
 */

describe(
    'TITech API Route Registry',
    () => {
        describe(
            'module contract',
            () => {
                test(
                    'exports a callable Express router',
                    () => {
                        expect(
                            typeof routes,
                        ).toBe(
                            'function',
                        );

                        expect(
                            typeof routes.use,
                        ).toBe(
                            'function',
                        );

                        expect(
                            typeof routes.get,
                        ).toBe(
                            'function',
                        );

                        expect(
                            typeof routes.post,
                        ).toBe(
                            'function',
                        );
                    },
                );

                test(
                    'exports registerRoutes',
                    () => {
                        expect(
                            typeof routes.registerRoutes,
                        ).toBe(
                            'function',
                        );
                    },
                );

                test(
                    'preserves router self-reference compatibility',
                    () => {
                        expect(
                            routes.router,
                        ).toBe(
                            routes,
                        );
                    },
                );

                test(
                    'exports the canonical API prefix',
                    () => {
                        expect(
                            routes.API_PREFIX,
                        ).toBe(
                            '/api/v1',
                        );
                    },
                );

                test(
                    'exports canonical metadata',
                    () => {
                        expect(
                            routes.ROUTE_METADATA,
                        ).toEqual(
                            expect.objectContaining({
                                application:
                                    'TITech Community Capital',

                                applicationLegalName:
                                    'TITech Community Capital Ltd',

                                registry:
                                    'titech-api-v1',

                                apiVersion:
                                    'v1',
                            }),
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * Diagnostics
         * =====================================================================
         */

        describe(
            'registry diagnostics',
            () => {
                test(
                    'reports valid middleware contracts',
                    () => {
                        const diagnostics =
                            routes.getRouteRegistryDiagnostics();

                        expect(
                            diagnostics,
                        ).toEqual(
                            expect.objectContaining({
                                authenticationMiddleware:
                                    true,

                                tenantAuthorization:
                                    true,

                                idempotencyFactory:
                                    true,
                            }),
                        );
                    },
                );

                test(
                    'reports all required controller contracts',
                    () => {
                        const diagnostics =
                            routes.getRouteRegistryDiagnostics();

                        expect(
                            diagnostics.controllerContracts,
                        ).toEqual({
                            contributions:
                                true,

                            loans:
                                true,

                            repayments:
                                true,

                            groupWalletBalance:
                                true,

                            groupWalletLedger:
                                true,
                        });
                    },
                );

                test(
                    'exposes the financial security policy',
                    () => {
                        const diagnostics =
                            routes.getRouteRegistryDiagnostics();

                        expect(
                            diagnostics.financialRoutePolicy,
                        ).toEqual({
                            authentication:
                                'required',

                            tenantContext:
                                'required',

                            idempotency:
                                'required',

                            requestBody:
                                'object',
                        });
                    },
                );

                test(
                    'returns immutable diagnostics',
                    () => {
                        const diagnostics =
                            routes.getRouteRegistryDiagnostics();

                        expect(
                            Object.isFrozen(
                                diagnostics,
                            ),
                        ).toBe(
                            true,
                        );

                        expect(
                            Object.isFrozen(
                                diagnostics.controllerContracts,
                            ),
                        ).toBe(
                            true,
                        );

                        expect(
                            Object.isFrozen(
                                diagnostics.financialRoutePolicy,
                            ),
                        ).toBe(
                            true,
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * Tracing
         * =====================================================================
         */

        describe(
            'request and correlation identifiers',
            () => {
                test(
                    'generates request and correlation IDs',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/live',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.headers[
                                'x-request-id'
                            ],
                        ).toBeTruthy();

                        expect(
                            response.headers[
                                'x-correlation-id'
                            ],
                        ).toBeTruthy();

                        expect(
                            response.body.requestId,
                        ).toBe(
                            response.headers[
                                'x-request-id'
                            ],
                        );

                        expect(
                            response.body.correlationId,
                        ).toBe(
                            response.headers[
                                'x-correlation-id'
                            ],
                        );
                    },
                );

                test(
                    'preserves valid caller-supplied trace IDs',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/live',
                                )
                                .set(
                                    'X-Request-Id',
                                    'request-test-0001',
                                )
                                .set(
                                    'X-Correlation-Id',
                                    'correlation-test-0001',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.headers[
                                'x-request-id'
                            ],
                        ).toBe(
                            'request-test-0001',
                        );

                        expect(
                            response.headers[
                                'x-correlation-id'
                            ],
                        ).toBe(
                            'correlation-test-0001',
                        );
                    },
                );

                test(
                    'replaces oversized caller-supplied request IDs',
                    async () => {
                        const app =
                            createTestApplication();

                        const oversized =
                            'r'.repeat(
                                129,
                            );

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/live',
                                )
                                .set(
                                    'X-Request-Id',
                                    oversized,
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.headers[
                                'x-request-id'
                            ],
                        ).not.toBe(
                            oversized,
                        );

                        expect(
                            response.headers[
                                'x-request-id'
                            ],
                        ).toBeTruthy();
                    },
                );
            },
        );

        /**
         * =====================================================================
         * Security Headers
         * =====================================================================
         */

        describe(
            'security headers',
            () => {
                test(
                    'sets conservative route-level security headers',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/live',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.headers[
                                'x-content-type-options'
                            ],
                        ).toBe(
                            'nosniff',
                        );

                        expect(
                            response.headers[
                                'referrer-policy'
                            ],
                        ).toBe(
                            'strict-origin-when-cross-origin',
                        );

                        expect(
                            response.headers[
                                'x-frame-options'
                            ],
                        ).toBe(
                            'DENY',
                        );

                        expect(
                            response.headers[
                                'permissions-policy'
                            ],
                        ).toBe(
                            'camera=(), microphone=(), geolocation=()',
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * Public Endpoints
         * =====================================================================
         */

        describe(
            'public operational endpoints',
            () => {
                test(
                    'liveness is publicly accessible',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/live',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    true,

                                status:
                                    'alive',

                                application:
                                    'TITech Community Capital',
                            }),
                        );

                        expect(
                            mockAuthenticate,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'liveness remains alive when readiness is false',
                    async () => {
                        const app =
                            createTestApplication({
                                readiness:
                                    () =>
                                        false,
                            });

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/live',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body.status,
                        ).toBe(
                            'alive',
                        );
                    },
                );

                test(
                    'health endpoint is publicly accessible',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/health',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    true,

                                status:
                                    'healthy',
                            }),
                        );

                        expect(
                            mockAuthenticate,
                        ).not.toHaveBeenCalled();
                    },
                );
            },
        );

        /**
         * =====================================================================
         * Readiness
         * =====================================================================
         */

        describe(
            'readiness endpoint',
            () => {
                test(
                    'returns ready by default',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/ready',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    true,

                                status:
                                    'ready',
                            }),
                        );
                    },
                );

                test(
                    'supports synchronous readiness',
                    async () => {
                        const readiness =
                            jest.fn(
                                () =>
                                    true,
                            );

                        const app =
                            createTestApplication({
                                readiness,
                            });

                        await request(
                            app,
                        )
                            .get(
                                '/api/v1/ready',
                            )
                            .expect(
                                200,
                            );

                        expect(
                            readiness,
                        ).toHaveBeenCalledTimes(
                            1,
                        );
                    },
                );

                test(
                    'supports asynchronous readiness',
                    async () => {
                        const readiness =
                            jest.fn(
                                async () =>
                                    true,
                            );

                        const app =
                            createTestApplication({
                                readiness,
                            });

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/ready',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body.status,
                        ).toBe(
                            'ready',
                        );
                    },
                );

                test(
                    'returns 503 when readiness is false',
                    async () => {
                        const app =
                            createTestApplication({
                                readiness:
                                    () =>
                                        false,
                            });

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/ready',
                                )
                                .expect(
                                    503,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    false,

                                status:
                                    'not_ready',
                            }),
                        );
                    },
                );

                test(
                    'returns 503 when readiness throws',
                    async () => {
                        const app =
                            createTestApplication({
                                readiness:
                                    async () => {
                                        throw new Error(
                                            'dependency unavailable',
                                        );
                                    },
                            });

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/ready',
                                )
                                .expect(
                                    503,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    false,

                                status:
                                    'not_ready',
                            }),
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * Metadata
         * =====================================================================
         */

        describe(
            'metadata endpoint',
            () => {
                test(
                    'returns non-sensitive registry metadata',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/meta',
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    true,

                                application:
                                    'TITech Community Capital',

                                applicationLegalName:
                                    'TITech Community Capital Ltd',

                                registry:
                                    'titech-api-v1',

                                apiVersion:
                                    'v1',

                                financialMutations:
                                    'tenant-scoped-and-idempotent',
                            }),
                        );

                        const serialized =
                            JSON.stringify(
                                response.body,
                            );

                        expect(
                            serialized,
                        ).not.toMatch(
                            /mongodb|redis|password|secret|authorization/i,
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * CONTRIBUTIONS
         * =====================================================================
         */

        describe(
            'POST /api/v1/contributions',
            () => {
                const endpoint =
                    '/api/v1/contributions';

                test(
                    'executes the protected financial chain',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .set(
                                    'Idempotency-Key',
                                    'contribution-test-0001',
                                )
                                .set(
                                    'X-Request-Id',
                                    'request-contribution-001',
                                )
                                .set(
                                    'X-Correlation-Id',
                                    'correlation-contribution-001',
                                )
                                .send({
                                    memberId:
                                        MEMBER_ID,

                                    amount:
                                        50000,

                                    currency:
                                        'UGX',
                                })
                                .expect(
                                    201,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    true,

                                operation:
                                    'createContribution',

                                tenantId:
                                    TENANT_ID,

                                idempotencyKey:
                                    'contribution-test-0001',

                                requestId:
                                    'request-contribution-001',

                                correlationId:
                                    'correlation-contribution-001',
                            }),
                        );

                        expect(
                            mockAuthenticate,
                        ).toHaveBeenCalledTimes(
                            1,
                        );

                        expect(
                            mockTenantAuthorization,
                        ).toHaveBeenCalledTimes(
                            1,
                        );

                        expect(
                            mockIdempotencyFactory,
                        ).toHaveBeenCalledWith(
                            expect.objectContaining({
                                operation:
                                    'CONTRIBUTION_CREATE',

                                resource:
                                    'contributions',

                                required:
                                    true,
                            }),
                        );

                        expect(
                            mockCreateContribution,
                        ).toHaveBeenCalledTimes(
                            1,
                        );
                    },
                );

                test(
                    'rejects unauthenticated requests before tenant authorization',
                    async () => {
                        mockAuthenticate.mockImplementationOnce(
                            (
                                req,
                                res,
                            ) =>
                                res
                                    .status(
                                        401,
                                    )
                                    .json({
                                        success:
                                            false,

                                        error: {
                                            code:
                                                'AUTHENTICATION_REQUIRED',
                                        },
                                    }),
                        );

                        const app =
                            createTestApplication();

                        await request(
                            app,
                        )
                            .post(
                                endpoint,
                            )
                            .set(
                                'Idempotency-Key',
                                'contribution-test-0002',
                            )
                            .send({
                                amount:
                                    50000,
                            })
                            .expect(
                                401,
                            );

                        expect(
                            mockTenantAuthorization,
                        ).not.toHaveBeenCalled();

                        expect(
                            mockIdempotencyFactory,
                        ).not.toHaveBeenCalled();

                        expect(
                            mockCreateContribution,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'rejects requests without trusted tenant context',
                    async () => {
                        mockTenantAuthorization.mockImplementationOnce(
                            (
                                req,
                                res,
                            ) =>
                                res
                                    .status(
                                        403,
                                    )
                                    .json({
                                        success:
                                            false,

                                        error: {
                                            code:
                                                'TENANT_ACCESS_DENIED',
                                        },
                                    }),
                        );

                        const app =
                            createTestApplication();

                        await request(
                            app,
                        )
                            .post(
                                endpoint,
                            )
                            .set(
                                'Idempotency-Key',
                                'contribution-test-0003',
                            )
                            .send({
                                amount:
                                    50000,
                            })
                            .expect(
                                403,
                            );

                        expect(
                            mockIdempotencyFactory,
                        ).not.toHaveBeenCalled();

                        expect(
                            mockCreateContribution,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'requires a JSON object request body',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .set(
                                    'Idempotency-Key',
                                    'contribution-test-0004',
                                )
                                .send(
                                    [],
                                )
                                .expect(
                                    400,
                                );

                        expect(
                            response.body.error.code,
                        ).toBe(
                            'TITECH_INVALID_REQUEST_BODY',
                        );

                        expect(
                            mockCreateContribution,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'requires Idempotency-Key',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .send({
                                    amount:
                                        50000,
                                })
                                .expect(
                                    400,
                                );

                        expect(
                            response.body.error.code,
                        ).toBe(
                            'IDEMPOTENCY_KEY_REQUIRED',
                        );

                        expect(
                            mockIdempotencyFactory,
                        ).not.toHaveBeenCalled();

                        expect(
                            mockCreateContribution,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'rejects an Idempotency-Key shorter than 16 characters',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .set(
                                    'Idempotency-Key',
                                    'too-short',
                                )
                                .send({
                                    amount:
                                        50000,
                                })
                                .expect(
                                    400,
                                );

                        expect(
                            response.body.error.code,
                        ).toBe(
                            'INVALID_IDEMPOTENCY_KEY',
                        );

                        expect(
                            mockCreateContribution,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'rejects an Idempotency-Key containing control characters',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .set(
                                    'Idempotency-Key',
                                    'contribution-test-0005\u0000',
                                )
                                .send({
                                    amount:
                                        50000,
                                })
                                .expect(
                                    400,
                                );

                        expect(
                            response.body.error.code,
                        ).toBe(
                            'INVALID_IDEMPOTENCY_KEY',
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * LOANS
         * =====================================================================
         */

        describe(
            'POST /api/v1/loans',
            () => {
                const endpoint =
                    '/api/v1/loans';

                test(
                    'delegates a valid loan request',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .set(
                                    'Idempotency-Key',
                                    'loan-test-00000001',
                                )
                                .send({
                                    memberId:
                                        MEMBER_ID,

                                    principal:
                                        1000000,

                                    currency:
                                        'UGX',
                                })
                                .expect(
                                    201,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    true,

                                operation:
                                    'createLoan',

                                tenantId:
                                    TENANT_ID,
                            }),
                        );

                        expect(
                            mockCreateLoan,
                        ).toHaveBeenCalledTimes(
                            1,
                        );

                        expect(
                            mockIdempotencyFactory,
                        ).toHaveBeenCalledWith(
                            expect.objectContaining({
                                operation:
                                    'LOAN_CREATE',

                                resource:
                                    'loans',

                                required:
                                    true,
                            }),
                        );
                    },
                );

                test(
                    'does not execute the controller without idempotency',
                    async () => {
                        const app =
                            createTestApplication();

                        await request(
                            app,
                        )
                            .post(
                                endpoint,
                            )
                            .send({
                                principal:
                                    1000000,
                            })
                            .expect(
                                400,
                            );

                        expect(
                            mockCreateLoan,
                        ).not.toHaveBeenCalled();
                    },
                );
            },
        );

        /**
         * =====================================================================
         * REPAYMENTS
         * =====================================================================
         */

        describe(
            'POST /api/v1/repayments',
            () => {
                const endpoint =
                    '/api/v1/repayments';

                test(
                    'requires Idempotency-Key',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .send({
                                    loanId:
                                        LOAN_ID,

                                    amount:
                                        100000,

                                    currency:
                                        'UGX',
                                })
                                .expect(
                                    400,
                                );

                        expect(
                            response.body.error.code,
                        ).toBe(
                            'IDEMPOTENCY_KEY_REQUIRED',
                        );

                        expect(
                            mockCreateRepayment,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'delegates a valid repayment request',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    endpoint,
                                )
                                .set(
                                    'Idempotency-Key',
                                    'repayment-test-0001',
                                )
                                .send({
                                    loanId:
                                        LOAN_ID,

                                    amount:
                                        100000,

                                    currency:
                                        'UGX',
                                })
                                .expect(
                                    201,
                                );

                        expect(
                            response.body.operation,
                        ).toBe(
                            'createRepayment',
                        );

                        expect(
                            mockCreateRepayment,
                        ).toHaveBeenCalledTimes(
                            1,
                        );

                        expect(
                            mockIdempotencyFactory,
                        ).toHaveBeenCalledWith(
                            expect.objectContaining({
                                operation:
                                    'LOAN_REPAYMENT_CREATE',

                                resource:
                                    'repayments',

                                required:
                                    true,
                            }),
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * GROUP WALLET
         * =====================================================================
         */

        describe(
            'group wallet routes',
            () => {
                test(
                    'returns wallet balance for a valid wallet ID',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    `/api/v1/group-wallets/${WALLET_ID}/balance`,
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    true,

                                operation:
                                    'getBalance',

                                walletId:
                                    WALLET_ID,

                                tenantId:
                                    TENANT_ID,
                            }),
                        );

                        expect(
                            mockGetBalance,
                        ).toHaveBeenCalledTimes(
                            1,
                        );
                    },
                );

                test(
                    'returns wallet ledger for a valid wallet ID',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    `/api/v1/group-wallets/${WALLET_ID}/ledger`,
                                )
                                .expect(
                                    200,
                                );

                        expect(
                            response.body.operation,
                        ).toBe(
                            'getLedger',
                        );

                        expect(
                            mockGetLedger,
                        ).toHaveBeenCalledTimes(
                            1,
                        );
                    },
                );

                test(
                    'rejects an invalid wallet ID',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/group-wallets/not-a-valid-id/balance',
                                )
                                .expect(
                                    400,
                                );

                        expect(
                            response.body.error.code,
                        ).toBe(
                            'INVALID_GROUP_WALLET_ID',
                        );

                        expect(
                            mockGetBalance,
                        ).not.toHaveBeenCalled();
                    },
                );

                test(
                    'rejects wallet access when tenant authorization fails',
                    async () => {
                        mockTenantAuthorization.mockImplementationOnce(
                            (
                                req,
                                res,
                            ) =>
                                res
                                    .status(
                                        403,
                                    )
                                    .json({
                                        success:
                                            false,

                                        error: {
                                            code:
                                                'TENANT_ACCESS_DENIED',
                                        },
                                    }),
                        );

                        const app =
                            createTestApplication();

                        await request(
                            app,
                        )
                            .get(
                                `/api/v1/group-wallets/${WALLET_ID}/balance`,
                            )
                            .expect(
                                403,
                            );

                        expect(
                            mockGetBalance,
                        ).not.toHaveBeenCalled();
                    },
                );
            },
        );

        /**
         * =====================================================================
         * 404 HANDLING
         * =====================================================================
         */

        describe(
            'route-level 404 handling',
            () => {
                test(
                    'returns the canonical route-not-found response',
                    async () => {
                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .get(
                                    '/api/v1/does-not-exist',
                                )
                                .expect(
                                    404,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    false,

                                error: {
                                    code:
                                        'ROUTE_NOT_FOUND',

                                    message:
                                        'The requested TITech API route was not found.',
                                },

                                method:
                                    'GET',

                                path:
                                    '/api/v1/does-not-exist',
                            }),
                        );

                        expect(
                            response.body.requestId,
                        ).toBeTruthy();

                        expect(
                            response.body.correlationId,
                        ).toBeTruthy();
                    },
                );

                test(
                    'does not execute financial controllers',
                    async () => {
                        const app =
                            createTestApplication();

                        await request(
                            app,
                        )
                            .post(
                                '/api/v1/not-a-real-financial-route',
                            )
                            .set(
                                'Idempotency-Key',
                                'unknown-route-test-0001',
                            )
                            .send({
                                amount:
                                    1000,
                            })
                            .expect(
                                404,
                            );

                        expect(
                            mockCreateContribution,
                        ).not.toHaveBeenCalled();

                        expect(
                            mockCreateLoan,
                        ).not.toHaveBeenCalled();

                        expect(
                            mockCreateRepayment,
                        ).not.toHaveBeenCalled();
                    },
                );
            },
        );

        /**
         * =====================================================================
         * REGISTRATION
         * =====================================================================
         */

        describe(
            'application registration',
            () => {
                test(
                    'registers routes on an Express application',
                    async () => {
                        const app =
                            express();

                        app.use(
                            express.json(),
                        );

                        const result =
                            routes.registerRoutes(
                                app,
                            );

                        expect(
                            result,
                        ).toBe(
                            app,
                        );

                        expect(
                            app.locals
                                .titechRouteRegistry,
                        ).toEqual(
                            expect.objectContaining({
                                name:
                                    'titech-api-v1',

                                apiVersion:
                                    'v1',

                                mountPath:
                                    '/',
                                
                                registered:
                                    true,
                            }),
                        );

                        await request(
                            app,
                        )
                            .get(
                                '/api/v1/live',
                            )
                            .expect(
                                200,
                            );
                    },
                );

                test(
                    'does not register the same router twice on one application',
                    async () => {
                        const app =
                            express();

                        app.use(
                            express.json(),
                        );

                        const first =
                            routes.registerRoutes(
                                app,
                            );

                        const second =
                            routes.registerRoutes(
                                app,
                            );

                        expect(
                            first,
                        ).toBe(
                            app,
                        );

                        expect(
                            second,
                        ).toBe(
                            app,
                        );

                        await request(
                            app,
                        )
                            .get(
                                '/api/v1/live',
                            )
                            .expect(
                                200,
                            );

                        expect(
                            app.locals
                                .titechRouteRegistry
                                .registered,
                        ).toBe(
                            true,
                        );
                    },
                );

                test(
                    'supports separate Express application instances',
                    async () => {
                        const appOne =
                            express();

                        const appTwo =
                            express();

                        appOne.use(
                            express.json(),
                        );

                        appTwo.use(
                            express.json(),
                        );

                        routes.registerRoutes(
                            appOne,
                        );

                        routes.registerRoutes(
                            appTwo,
                        );

                        await request(
                            appOne,
                        )
                            .get(
                                '/api/v1/live',
                            )
                            .expect(
                                200,
                            );

                        await request(
                            appTwo,
                        )
                            .get(
                                '/api/v1/live',
                            )
                            .expect(
                                200,
                            );
                    },
                );

                test(
                    'supports a custom mount path',
                    async () => {
                        const app =
                            express();

                        app.use(
                            express.json(),
                        );

                        routes.registerRoutes(
                            app,
                            {
                                mountPath:
                                    '/platform',
                            },
                        );

                        expect(
                            app.locals
                                .titechRouteRegistry
                                .mountPath,
                        ).toBe(
                            '/platform',
                        );

                        await request(
                            app,
                        )
                            .get(
                                '/platform/api/v1/live',
                            )
                            .expect(
                                200,
                            );
                    },
                );

                test(
                    'rejects an invalid Express application',
                    () => {
                        expect(
                            () =>
                                routes.registerRoutes(
                                    null,
                                ),
                        ).toThrow(
                            expect.objectContaining({
                                code:
                                    'TITECH_ROUTE_APPLICATION_INVALID',
                            }),
                        );
                    },
                );

                test(
                    'rejects an invalid mount path',
                    () => {
                        const app =
                            express();

                        expect(
                            () =>
                                routes.registerRoutes(
                                    app,
                                    {
                                        mountPath:
                                            'platform',
                                    },
                                ),
                        ).toThrow(
                            expect.objectContaining({
                                code:
                                    'TITECH_ROUTE_MOUNT_PATH_INVALID',
                            }),
                        );
                    },
                );
            },
        );

        /**
         * =====================================================================
         * CONTROLLER CONTRACT / ERROR PROPAGATION
         * =====================================================================
         */

        describe(
            'controller contract and error propagation',
            () => {
                test(
                    'passes Express request, response and next to the controller',
                    async () => {
                        const app =
                            createTestApplication();

                        await request(
                            app,
                        )
                            .post(
                                '/api/v1/contributions',
                            )
                            .set(
                                'Idempotency-Key',
                                'controller-contract-001',
                            )
                            .send({
                                memberId:
                                    MEMBER_ID,

                                amount:
                                    5000,
                            })
                            .expect(
                                201,
                            );

                        const [
                            req,
                            res,
                            next,
                        ] =
                            mockCreateContribution.mock
                                .calls[0];

                        expect(
                            req,
                        ).toBeTruthy();

                        expect(
                            res,
                        ).toBeTruthy();

                        expect(
                            typeof next,
                        ).toBe(
                            'function',
                        );
                    },
                );

                test(
                    'preserves trusted tenant context before controller execution',
                    async () => {
                        const app =
                            createTestApplication();

                        await request(
                            app,
                        )
                            .post(
                                '/api/v1/loans',
                            )
                            .set(
                                'Idempotency-Key',
                                'tenant-context-0001',
                            )
                            .send({
                                principal:
                                    100000,
                            })
                            .expect(
                                201,
                            );

                        const [
                            req,
                        ] =
                            mockCreateLoan.mock
                                .calls[0];

                        expect(
                            req.tenantContext,
                        ).toEqual(
                            expect.objectContaining({
                                trusted:
                                    true,

                                tenantId:
                                    TENANT_ID,
                            }),
                        );
                    },
                );

                test(
                    'forwards asynchronous controller failures to the application error handler',
                    async () => {
                        mockCreateLoan.mockImplementationOnce(
                            async () => {
                                const error =
                                    new Error(
                                        'simulated controller failure',
                                    );

                                error.statusCode =
                                    422;

                                error.code =
                                    'SIMULATED_CONTROLLER_ERROR';

                                throw error;
                            },
                        );

                        const app =
                            createTestApplication();

                        const response =
                            await request(
                                app,
                            )
                                .post(
                                    '/api/v1/loans',
                                )
                                .set(
                                    'Idempotency-Key',
                                    'async-controller-error-001',
                                )
                                .send({
                                    principal:
                                        100000,
                                })
                                .expect(
                                    422,
                                );

                        expect(
                            response.body,
                        ).toEqual(
                            expect.objectContaining({
                                success:
                                    false,

                                error: {
                                    code:
                                        'SIMULATED_CONTROLLER_ERROR',

                                    message:
                                        'simulated controller failure',
                                },
                            }),
                        );
                    },
                );
            },
        );
    },
);

/**
 * =============================================================================
 * Exported Utility Contracts
 * =============================================================================
 */

describe(
    'TITech route utility contracts',
    () => {
        test(
            'asyncHandler rejects a non-function',
            () => {
                expect(
                    () =>
                        routes.asyncHandler(
                            null,
                        ),
                ).toThrow(
                    expect.objectContaining({
                        code:
                            'TITECH_ROUTE_HANDLER_INVALID',
                    }),
                );
            },
        );

        test(
            'registerNotFoundHandler rejects an invalid router',
            () => {
                expect(
                    () =>
                        routes.registerNotFoundHandler(
                            null,
                        ),
                ).toThrow(
                    expect.objectContaining({
                        code:
                            'TITECH_ROUTE_REGISTRY_INVALID',
                    }),
                );
            },
        );
    },
);