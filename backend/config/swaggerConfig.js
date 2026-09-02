'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/swaggerConfig.js
 *
 * Purpose:
 *   Enterprise production-grade OpenAPI 3 configuration and API contract.
 *
 * Responsibilities:
 *   - Define the canonical TITech OpenAPI document.
 *   - Centralize API metadata and server definitions.
 *   - Define authentication/security schemes.
 *   - Define reusable financial/domain schemas.
 *   - Define common response envelopes and error contracts.
 *   - Define request/correlation/trace/idempotency headers.
 *   - Document authentication, loan, group, contribution and admin APIs.
 *   - Provide safe production documentation policy.
 *   - Support swagger-ui-express and swagger-jsdoc.
 *   - Preserve compatibility with legacy `definition` / `apis` consumers.
 *
 * IMPORTANT:
 *
 *   This file documents the API contract.
 *
 *   It does NOT:
 *     - register Express routes.
 *     - execute controllers.
 *     - validate requests at runtime.
 *     - implement authentication.
 *     - issue JWTs.
 *     - execute financial transactions.
 *
 * Runtime validation and authorization remain authoritative.
 *
 * =============================================================================
 */

const process =
    require('node:process');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'swagger-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const OPENAPI_VERSION =
    '3.0.3';

const DEFAULT_API_PREFIX =
    '/api';

const DOCUMENTATION_STATES =
    Object.freeze({
        ENABLED: 'enabled',
        DISABLED: 'disabled',
        DEGRADED: 'degraded',
        INVALID: 'invalid',
    });

const DEFAULT_TAGS =
    Object.freeze([
        {
            name: 'Authentication',
            description:
                'Authentication, identity and account-access operations.',
        },
        {
            name: 'Users',
            description:
                'User profile and account operations.',
        },
        {
            name: 'Groups',
            description:
                'Community group management operations.',
        },
        {
            name: 'Contributions',
            description:
                'Community savings and contribution operations.',
        },
        {
            name: 'Loans',
            description:
                'Loan applications, eligibility, approval, disbursement and repayment.',
        },
        {
            name: 'Payments',
            description:
                'Payment initiation, status and reconciliation operations.',
        },
        {
            name: 'Notifications',
            description:
                'Email, SMS and application notification operations.',
        },
        {
            name: 'Admin',
            description:
                'Administrative and operational endpoints.',
        },
        {
            name: 'Health',
            description:
                'Service health, liveness and readiness endpoints.',
        },
    ]);

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({
        enabled: true,

        uiEnabled: true,

        jsonEnabled: true,

        yamlEnabled: true,

        title:
            'TITech Community Capital API',

        description:
            'Enterprise REST API for the TITech Community Capital Operating System.',

        version:
            process.env.APP_VERSION ||
            process.env.npm_package_version ||
            '1.0.0',

        contact: {
            name:
                'TITech Africa',

            email:
                'support@titech.africa',

            url:
                'https://titech.africa',
        },

        license: {
            name:
                'Proprietary',

            url:
                null,
        },

        apiPrefix:
            process.env.API_PREFIX ||
            DEFAULT_API_PREFIX,

        servers: {
            development:
                'http://localhost:5000',

            test:
                'http://localhost:5000',

            staging:
                'https://staging-api.titech.africa',

            production:
                'https://api.titech.africa',
        },

        docsPath:
            '/docs',

        jsonPath:
            '/docs/openapi.json',

        yamlPath:
            '/docs/openapi.yaml',

        routePatterns: [
            'backend/routes/**/*.js',
            'backend/controllers/**/*.js',
        ],

        excludePatterns: [
            '**/*.test.js',
            '**/*.spec.js',
        ],

        /**
         * Security.
         */
        bearerAuthEnabled:
            true,

        apiKeyAuthEnabled:
            true,

        cookieAuthEnabled:
            false,

        oauth2Enabled:
            false,

        requireDocumentationAuthentication:
            true,

        publicUiInProduction:
            false,

        publicJsonInProduction:
            false,

        publicYamlInProduction:
            false,

        allowTryItOutInProduction:
            false,

        allowProductionServerSelection:
            false,

        exposeInternalRoutes:
            false,

        exposeDiagnostics:
            false,

        /**
         * UI.
         */
        explorer:
            true,

        persistAuthorization:
            false,

        docExpansion:
            'none',

        defaultModelsExpandDepth:
            1,

        defaultModelExpandDepth:
            1,

        displayRequestDuration:
            true,

        filter:
            true,

        showExtensions:
            false,

        showCommonExtensions:
            false,

        deepLinking:
            true,

        tryItOutEnabled:
            true,

        withCredentials:
            false,

        /**
         * Examples.
         */
        exposeExamples:
            true,

        redactExamples:
            true,

        /**
         * Common headers.
         */
        includeRequestId:
            true,

        includeCorrelationId:
            true,

        includeTraceId:
            true,

        includeIdempotencyKey:
            true,

        /**
         * Cache.
         */
        cacheEnabled:
            true,

        cacheMaxAgeSeconds:
            300,
    });

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

function env(
    key,
    fallback = undefined,
) {
    const value =
        process.env[key];

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return fallback;
    }

    return String(
        value,
    ).trim();
}

function asBoolean(
    value,
    fallback,
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return fallback;
    }

    if (
        typeof value === 'boolean'
    ) {
        return value;
    }

    const normalized =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        [
            '1',
            'true',
            'yes',
            'on',
            'enabled',
        ].includes(
            normalized,
        )
    ) {
        return true;
    }

    if (
        [
            '0',
            'false',
            'no',
            'off',
            'disabled',
        ].includes(
            normalized,
        )
    ) {
        return false;
    }

    return fallback;
}

function asString(
    value,
    fallback,
) {
    if (
        value === undefined ||
        value === null
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

function asList(
    value,
    fallback = [],
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return [
            ...fallback,
        ];
    }

    const source =
        Array.isArray(value)
            ? value
            : String(
                value,
            ).split(',');

    return [
        ...new Set(
            source
                .map(
                    item =>
                        String(
                            item,
                        ).trim(),
                )
                .filter(Boolean),
        ),
    ];
}

function toEnum(
    value,
    allowed,
    fallback,
) {
    const normalized =
        asString(
            value,
            fallback,
        );

    return (
        allowed.find(
            item =>
                String(
                    item,
                ).toLowerCase() ===
                String(
                    normalized,
                ).toLowerCase(),
        ) ||
        fallback
    );
}

function deepFreeze(
    object,
    seen = new WeakSet(),
) {
    if (
        object === null ||
        object === undefined ||
        typeof object !== 'object'
    ) {
        return object;
    }

    if (
        seen.has(
            object,
        )
    ) {
        return object;
    }

    seen.add(
        object,
    );

    for (
        const key of
        Reflect.ownKeys(
            object,
        )
    ) {
        try {
            deepFreeze(
                object[key],
                seen,
            );
        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(
            object,
        );
    } catch {
        // Best effort.
    }

    return object;
}

function isProduction(
    environment,
) {
    return (
        environment ===
        'production'
    );
}

/**
 * =============================================================================
 * Server resolution
 * =============================================================================
 */

function buildApiUrl(
    baseUrl,
    apiPrefix,
) {
    const base =
        String(
            baseUrl,
        ).replace(
            /\/+$/,
            '',
        );

    const prefix =
        String(
            apiPrefix,
        ).replace(
            /^\/+/,
            '',
        ).replace(
            /\/+$/,
            '',
        );

    return prefix
        ? `${base}/${prefix}`
        : base;
}

function createServers(
    config,
) {
    const environment =
        config.environment;

    const configuredPrimary =
        config.defaultServer ||
        env(
            'API_PUBLIC_URL',
        ) ||
        env(
            'PUBLIC_API_URL',
        ) ||
        config.servers[
            environment
        ] ||
        config.servers.development;

    if (
        isProduction(
            environment,
        )
    ) {
        return [
            {
                url:
                    buildApiUrl(
                        configuredPrimary,
                        config.apiPrefix,
                    ),

                description:
                    'TITech production API server',
            },
        ];
    }

    const servers = [
        {
            url:
                buildApiUrl(
                    configuredPrimary,
                    config.apiPrefix,
                ),

            description:
                `${environment} API server`,
        },
    ];

    if (
        !isProduction(
            environment,
        )
    ) {
        const additional = [
            [
                'development',
                config.servers.development,
            ],
            [
                'test',
                config.servers.test,
            ],
            [
                'staging',
                config.servers.staging,
            ],
        ];

        for (
            const [
                name,
                value,
            ] of additional
        ) {
            if (
                !value
            ) {
                continue;
            }

            const url =
                buildApiUrl(
                    value,
                    config.apiPrefix,
                );

            if (
                servers.some(
                    server =>
                        server.url ===
                        url,
                )
            ) {
                continue;
            }

            servers.push({
                url,

                description:
                    `TITech ${name} API server`,
            });
        }
    }

    return servers;
}

/**
 * =============================================================================
 * Reusable parameter components
 * =============================================================================
 */

function createParameters(
    config,
) {
    const parameters = {
        RequestId: {
            name:
                'X-Request-ID',

            in:
                'header',

            required:
                false,

            schema: {
                type:
                    'string',

                maxLength:
                    255,
            },

            description:
                'Client-supplied or server-generated request identifier.',
        },

        CorrelationId: {
            name:
                'X-Correlation-ID',

            in:
                'header',

            required:
                false,

            schema: {
                type:
                    'string',

                maxLength:
                    255,
            },

            description:
                'Correlation identifier propagated across application services.',
        },

        Traceparent: {
            name:
                'traceparent',

            in:
                'header',

            required:
                false,

            schema: {
                type:
                    'string',

                pattern:
                    '^[\\da-f]{2}-[\\da-f]{32}-[\\da-f]{16}-[\\da-f]{2}$',
            },

            description:
                'W3C Trace Context propagation header.',
        },

        IdempotencyKey: {
            name:
                'Idempotency-Key',

            in:
                'header',

            required:
                false,

            schema: {
                type:
                    'string',

                minLength:
                    8,

                maxLength:
                    255,
            },

            description:
                'Unique key for retry-safe state-changing operations. Required by supported financial mutation endpoints.',
        },

        Page: {
            name:
                'page',

            in:
                'query',

            required:
                false,

            schema: {
                type:
                    'integer',

                minimum:
                    1,

                default:
                    1,
            },
        },

        Limit: {
            name:
                'limit',

            in:
                'query',

            required:
                false,

            schema: {
                type:
                    'integer',

                minimum:
                    1,

                maximum:
                    100,

                default:
                    25,
            },
        },

        GroupId: {
            name:
                'groupId',

            in:
                'path',

            required:
                true,

            schema: {
                type:
                    'string',

                minLength:
                    1,
            },

            description:
                'TITech group identifier.',
        },

        LoanId: {
            name:
                'loanId',

            in:
                'path',

            required:
                true,

            schema: {
                type:
                    'string',

                minLength:
                    1,
            },

            description:
                'TITech loan identifier.',
        },
    };

    if (
        !config.includeIdempotencyKey
    ) {
        delete parameters.IdempotencyKey;
    }

    if (
        !config.includeRequestId
    ) {
        delete parameters.RequestId;
    }

    if (
        !config.includeCorrelationId
    ) {
        delete parameters.CorrelationId;
    }

    if (
        !config.includeTraceId
    ) {
        delete parameters.Traceparent;
    }

    return parameters;
}

/**
 * =============================================================================
 * Security schemes
 * =============================================================================
 */

function createSecuritySchemes(
    config,
) {
    const schemes = {};

    if (
        config.bearerAuthEnabled
    ) {
        schemes.bearerAuth = {
            type:
                'http',

            scheme:
                'bearer',

            bearerFormat:
                'JWT',

            description:
                'JWT bearer access token.',
        };
    }

    if (
        config.apiKeyAuthEnabled
    ) {
        schemes.apiKeyAuth = {
            type:
                'apiKey',

            in:
                'header',

            name:
                'X-API-Key',

            description:
                'Approved service-to-service or integration API key.',
        };
    }

    if (
        config.cookieAuthEnabled
    ) {
        schemes.cookieAuth = {
            type:
                'apiKey',

            in:
                'cookie',

            name:
                'titech_session',

            description:
                'Authenticated TITech application session cookie.',
        };
    }

    if (
        config.oauth2Enabled
    ) {
        schemes.oauth2 = {
            type:
                'oauth2',

            flows: {
                authorizationCode: {
                    authorizationUrl:
                        env(
                            'OAUTH_AUTHORIZATION_URL',
                            'https://auth.example.com/oauth/authorize',
                        ),

                    tokenUrl:
                        env(
                            'OAUTH_TOKEN_URL',
                            'https://auth.example.com/oauth/token',
                        ),

                    scopes: {
                        openid:
                            'OpenID identity',

                        profile:
                            'Profile information',

                        email:
                            'Email access',
                    },
                },
            },
        };
    }

    return schemes;
}

/**
 * =============================================================================
 * Common schemas
 * =============================================================================
 */

function createSchemas(
    config,
) {
    return {
        User: {
            type:
                'object',

            required: [
                '_id',
                'name',
                'email',
                'role',
            ],

            properties: {
                _id: {
                    type:
                        'string',

                    example:
                        '60d5ec49c1234567890abcde',
                },

                name: {
                    type:
                        'string',

                    minLength:
                        1,

                    maxLength:
                        200,

                    example:
                        'John Doe',
                },

                email: {
                    type:
                        'string',

                    format:
                        'email',

                    example:
                        'john@example.com',
                },

                phone: {
                    type:
                        'string',

                    example:
                        '+256700000000',
                },

                role: {
                    type:
                        'string',

                    enum: [
                        'user',
                        'group_admin',
                        'admin',
                    ],

                    example:
                        'user',
                },

                isVerified: {
                    type:
                        'boolean',

                    example:
                        true,
                },

                createdAt: {
                    type:
                        'string',

                    format:
                        'date-time',
                },

                updatedAt: {
                    type:
                        'string',

                    format:
                        'date-time',
                },
            },
        },

        UserRegistrationRequest: {
            type:
                'object',

            required: [
                'name',
                'email',
                'password',
                'phone',
            ],

            properties: {
                name: {
                    type:
                        'string',

                    minLength:
                        2,

                    maxLength:
                        200,

                    example:
                        'John Doe',
                },

                email: {
                    type:
                        'string',

                    format:
                        'email',

                    example:
                        'john@example.com',
                },

                password: {
                    type:
                        'string',

                    minLength:
                        8,

                    maxLength:
                        128,

                    format:
                        'password',

                    writeOnly:
                        true,

                    example:
                        'SecurePass123!',
                },

                phone: {
                    type:
                        'string',

                    example:
                        '+256700000000',
                },
            },
        },

        LoginRequest: {
            type:
                'object',

            required: [
                'email',
                'password',
            ],

            properties: {
                email: {
                    type:
                        'string',

                    format:
                        'email',

                    example:
                        'john@example.com',
                },

                password: {
                    type:
                        'string',

                    format:
                        'password',

                    writeOnly:
                        true,

                    example:
                        'SecurePass123!',
                },
            },
        },

        LoginResponse: {
            type:
                'object',

            required: [
                'success',
                'token',
                'user',
            ],

            properties: {
                success: {
                    type:
                        'boolean',

                    example:
                        true,
                },

                token: {
                    type:
                        'string',

                    description:
                        'JWT access token.',
                },

                user: {
                    $ref:
                        '#/components/schemas/User',
                },
            },
        },

        Money: {
            type:
                'object',

            required: [
                'amount',
                'currency',
            ],

            description:
                'Financial amount represented as a decimal string to avoid floating-point ambiguity.',

            properties: {
                amount: {
                    type:
                        'string',

                    pattern:
                        '^\\d+(\\.\\d{1,2})?$',

                    example:
                        '50000.00',
                },

                currency: {
                    type:
                        'string',

                    minLength:
                        3,

                    maxLength:
                        3,

                    example:
                        'UGX',
                },
            },
        },

        Group: {
            type:
                'object',

            required: [
                '_id',
                'name',
                'admin',
                'status',
            ],

            properties: {
                _id: {
                    type:
                        'string',

                    example:
                        '60d5ec49c1234567890abcde',
                },

                name: {
                    type:
                        'string',

                    example:
                        'Community Group A',
                },

                description: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                members: {
                    type:
                        'array',

                    items: {
                        type:
                            'string',
                    },
                },

                admin: {
                    type:
                        'string',

                    example:
                        '60d5ec49c1234567890abcdf',
                },

                status: {
                    type:
                        'string',

                    enum: [
                        'active',
                        'inactive',
                    ],

                    example:
                        'active',
                },

                rules: {
                    type:
                        'object',

                    properties: {
                        minContribution: {
                            $ref:
                                '#/components/schemas/Money',
                        },

                        maxLoanMultiplier: {
                            type:
                                'number',

                            minimum:
                                0,

                            example:
                                2.5,
                        },

                        loanInterestRate: {
                            type:
                                'number',

                            minimum:
                                0,

                            maximum:
                                100,

                            example:
                                5,
                        },
                    },
                },

                createdAt: {
                    type:
                        'string',

                    format:
                        'date-time',
                },
            },
        },

        Contribution: {
            type:
                'object',

            required: [
                '_id',
                'user',
                'group',
                'amount',
                'status',
            ],

            properties: {
                _id: {
                    type:
                        'string',
                },

                user: {
                    type:
                        'string',
                },

                group: {
                    type:
                        'string',
                },

                amount: {
                    $ref:
                        '#/components/schemas/Money',
                },

                status: {
                    type:
                        'string',

                    enum: [
                        'pending',
                        'completed',
                        'failed',
                    ],

                    example:
                        'completed',
                },

                createdAt: {
                    type:
                        'string',

                    format:
                        'date-time',
                },
            },
        },

        Loan: {
            type:
                'object',

            required: [
                '_id',
                'user',
                'group',
                'amount',
                'status',
            ],

            properties: {
                _id: {
                    type:
                        'string',

                    example:
                        '60d5ec49c1234567890abcd0',
                },

                user: {
                    type:
                        'string',

                    description:
                        'Borrower user ID.',
                },

                group: {
                    type:
                        'string',

                    description:
                        'Community group ID.',
                },

                amount: {
                    $ref:
                        '#/components/schemas/Money',
                },

                status: {
                    type:
                        'string',

                    enum: [
                        'pending',
                        'approved',
                        'rejected',
                        'disbursed',
                        'repaid',
                    ],

                    example:
                        'pending',
                },

                interestRate: {
                    type:
                        'number',

                    minimum:
                        0,

                    maximum:
                        100,

                    example:
                        5,
                },

                repaymentPeriodMonths: {
                    type:
                        'integer',

                    minimum:
                        1,

                    maximum:
                        60,

                    example:
                        6,
                },

                eligibilityScore: {
                    type:
                        'number',

                    minimum:
                        0,

                    maximum:
                        100,

                    example:
                        75.5,
                },

                reason: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                createdAt: {
                    type:
                        'string',

                    format:
                        'date-time',
                },

                approvedAt: {
                    type:
                        'string',

                    format:
                        'date-time',

                    nullable:
                        true,
                },

                disburseDate: {
                    type:
                        'string',

                    format:
                        'date-time',

                    nullable:
                        true,
                },

                repaidAt: {
                    type:
                        'string',

                    format:
                        'date-time',

                    nullable:
                        true,
                },
            },
        },

        LoanEligibility: {
            type:
                'object',

            required: [
                'isEligible',
                'overallScore',
            ],

            properties: {
                isEligible: {
                    type:
                        'boolean',

                    example:
                        true,
                },

                overallScore: {
                    type:
                        'number',

                    minimum:
                        0,

                    maximum:
                        100,

                    example:
                        72.5,
                },

                maxLoanAmount: {
                    $ref:
                        '#/components/schemas/Money',
                },

                rejectionReason: {
                    type:
                        'string',

                    nullable:
                        true,

                    example:
                        'insufficient_contribution',
                },

                components: {
                    type:
                        'object',

                    properties: {
                        contributionScore: {
                            type:
                                'number',

                            minimum:
                                0,

                            maximum:
                                40,

                            example:
                                30,
                        },

                        participationScore: {
                            type:
                                'number',

                            minimum:
                                0,

                            maximum:
                                30,

                            example:
                                22,
                        },

                        repaymentScore: {
                            type:
                                'number',

                            minimum:
                                0,

                            maximum:
                                20,

                            example:
                                15,
                        },

                        riskScore: {
                            type:
                                'number',

                            minimum:
                                0,

                            maximum:
                                10,

                            example:
                                5.5,
                        },
                    },
                },

                metadata: {
                    type:
                        'object',

                    properties: {
                        totalContributed: {
                            $ref:
                                '#/components/schemas/Money',
                        },

                        monthsActive: {
                            type:
                                'integer',

                            example:
                                6,
                        },

                        contributionCount: {
                            type:
                                'integer',

                            example:
                                10,
                        },

                        activeLoans: {
                            type:
                                'integer',

                            example:
                                1,
                        },
                    },
                },
            },
        },

        LoanRepaymentInstallment: {
            type:
                'object',

            required: [
                'installmentNumber',
                'amount',
                'dueDate',
                'paid',
            ],

            properties: {
                installmentNumber: {
                    type:
                        'integer',

                    minimum:
                        1,
                },

                amount: {
                    $ref:
                        '#/components/schemas/Money',
                },

                dueDate: {
                    type:
                        'string',

                    format:
                        'date-time',
                },

                paid: {
                    type:
                        'boolean',
                },

                paidAt: {
                    type:
                        'string',

                    format:
                        'date-time',

                    nullable:
                        true,
                },
            },
        },

        LoanRepaymentSchedule: {
            type:
                'object',

            required: [
                '_id',
                'loan',
                'installments',
                'status',
            ],

            properties: {
                _id: {
                    type:
                        'string',
                },

                loan: {
                    type:
                        'string',
                },

                installments: {
                    type:
                        'array',

                    items: {
                        $ref:
                            '#/components/schemas/LoanRepaymentInstallment',
                    },
                },

                totalAmount: {
                    $ref:
                        '#/components/schemas/Money',
                },

                totalPaid: {
                    $ref:
                        '#/components/schemas/Money',
                },

                interestRate: {
                    type:
                        'number',

                    minimum:
                        0,

                    maximum:
                        100,
                },

                status: {
                    type:
                        'string',

                    enum: [
                        'active',
                        'completed',
                        'defaulted',
                    ],
                },
            },
        },

        ErrorResponse: {
            type:
                'object',

            required: [
                'success',
                'code',
                'message',
            ],

            properties: {
                success: {
                    type:
                        'boolean',

                    example:
                        false,
                },

                code: {
                    type:
                        'string',

                    example:
                        'VALIDATION_ERROR',
                },

                message: {
                    type:
                        'string',

                    example:
                        'Request validation failed.',
                },

                details: {
                    nullable:
                        true,

                    oneOf: [
                        {
                            type:
                                'object',
                        },
                        {
                            type:
                                'array',
                        },
                    ],
                },

                requestId: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                correlationId: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                traceId: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                timestamp: {
                    type:
                        'string',

                    format:
                        'date-time',
                },
            },
        },

        SuccessResponse: {
            type:
                'object',

            properties: {
                success: {
                    type:
                        'boolean',

                    example:
                        true,
                },

                message: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                data: {
                    nullable:
                        true,
                },

                requestId: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                correlationId: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                traceId: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                timestamp: {
                    type:
                        'string',

                    format:
                        'date-time',
                },
            },
        },

        PaginatedResponse: {
            type:
                'object',

            properties: {
                success: {
                    type:
                        'boolean',

                    example:
                        true,
                },

                data: {
                    type:
                        'array',

                    items: {
                        type:
                            'object',
                    },
                },

                pagination: {
                    $ref:
                        '#/components/schemas/Pagination',
                },

                requestId: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                correlationId: {
                    type:
                        'string',

                    nullable:
                        true,
                },
            },
        },

        Pagination: {
            type:
                'object',

            properties: {
                page: {
                    type:
                        'integer',

                    minimum:
                        1,
                },

                limit: {
                    type:
                        'integer',

                    minimum:
                        1,

                    maximum:
                        100,
                },

                total: {
                    type:
                        'integer',

                    minimum:
                        0,
                },

                pages: {
                    type:
                        'integer',

                    minimum:
                        0,
                },

                hasNextPage: {
                    type:
                        'boolean',
                },

                hasPreviousPage: {
                    type:
                        'boolean',
                },
            },
        },

        IdempotencyMetadata: {
            type:
                'object',

            properties: {
                key: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                replayed: {
                    type:
                        'boolean',

                    example:
                        false,
                },

                status: {
                    type:
                        'string',

                    enum: [
                        'new',
                        'replayed',
                        'conflict',
                    ],

                    example:
                        'new',
                },
            },
        },

        HealthResponse: {
            type:
                'object',

            properties: {
                success: {
                    type:
                        'boolean',
                },

                status: {
                    type:
                        'string',
                },

                live: {
                    type:
                        'boolean',
                },

                ready: {
                    type:
                        'boolean',
                },

                healthy: {
                    type:
                        'boolean',
                },

                started: {
                    type:
                        'boolean',
                },

                shuttingDown: {
                    type:
                        'boolean',
                },

                failed: {
                    type:
                        'boolean',
                },

                phase: {
                    type:
                        'string',

                    nullable:
                        true,
                },

                uptime: {
                    type:
                        'number',

                    minimum:
                        0,
                },

                timestamp: {
                    type:
                        'string',

                    format:
                        'date-time',
                },
            },
        },
    };
}

/**
 * =============================================================================
 * Common responses
 * =============================================================================
 */

function createResponses() {
    return {
        BadRequest: {
            description:
                'Invalid request.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        Unauthorized: {
            description:
                'Authentication is required or credentials are invalid.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        Forbidden: {
            description:
                'Authenticated principal is not authorized.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        NotFound: {
            description:
                'Requested resource was not found.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        Conflict: {
            description:
                'The request conflicts with current resource or operation state.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        UnprocessableEntity: {
            description:
                'Business or validation rules prevent the operation.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        TooManyRequests: {
            description:
                'Rate limit exceeded.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        InternalServerError: {
            description:
                'Unexpected server error.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },

        ServiceUnavailable: {
            description:
                'Service temporarily unavailable or not ready.',

            content: {
                'application/json': {
                    schema: {
                        $ref:
                            '#/components/schemas/ErrorResponse',
                    },
                },
            },
        },
    };
}

/**
 * =============================================================================
 * Reusable request bodies
 * =============================================================================
 */

function createRequestSchemas() {
    return {
        LoanRequest: {
            type:
                'object',

            required:
                [
                    'groupId',
                    'amount',
                ],

            properties: {
                groupId: {
                    type:
                        'string',

                    example:
                        '60d5ec49c1234567890abcde',
                },

                amount: {
                    $ref:
                        '#/components/schemas/Money',
                },

                reason: {
                    type:
                        'string',

                    maxLength:
                        2_000,

                    example:
                        'Business expansion',
                },

                repaymentTermMonths: {
                    type:
                        'integer',

                    minimum:
                        1,

                    maximum:
                        60,

                    example:
                        6,
                },
            },
        },

        LoanApprovalRequest: {
            type:
                'object',

            properties: {
                interestRate: {
                    type:
                        'number',

                    minimum:
                        0,

                    maximum:
                        100,

                    example:
                        5,
                },

                repaymentPeriodMonths: {
                    type:
                        'integer',

                    minimum:
                        1,

                    maximum:
                        60,

                    example:
                        6,
                },

                notes: {
                    type:
                        'string',

                    maxLength:
                        2_000,
                },
            },
        },

        LoanDisbursementRequest: {
            type:
                'object',

            properties: {
                paymentMethod: {
                    type:
                        'string',

                    example:
                        'bank_transfer',
                },

                notes: {
                    type:
                        'string',

                    maxLength:
                        2_000,
                },
            },
        },

        LoanRepaymentRequest: {
            type:
                'object',

            required:
                [
                    'amount',
                ],

            properties: {
                amount: {
                    $ref:
                        '#/components/schemas/Money',
                },

                paymentMethod: {
                    type:
                        'string',

                    example:
                        'mobile_money',
                },

                notes: {
                    type:
                        'string',

                    maxLength:
                        2_000,
                },
            },
        },
    };
}

/**
 * =============================================================================
 * Path helpers
 * =============================================================================
 */

function apiPath(
    pathValue,
    config,
) {
    const prefix =
        String(
            config.apiPrefix,
        )
            .replace(
                /\/+$/,
                '',
            );

    const value =
        String(
            pathValue,
        )
            .replace(
                /^\/+/,
                '',
            );

    return `${prefix}/${value}`;
}

/**
 * =============================================================================
 * OpenAPI paths
 * =============================================================================
 */

function createPaths(
    config,
) {
    return {
        /**
         * ---------------------------------------------------------------------
         * Authentication
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/auth/register',
            config,
        )]: {
            post: {
                operationId:
                    'registerUser',

                summary:
                    'Register a new user',

                description:
                    'Creates a new TITech Community Capital user account.',

                tags:
                    [
                        'Authentication',
                    ],

                requestBody: {
                    required:
                        true,

                    content: {
                        'application/json': {
                            schema: {
                                $ref:
                                    '#/components/schemas/UserRegistrationRequest',
                            },
                        },
                    },
                },

                responses: {
                    201: {
                        description:
                            'User registered successfully.',

                        content: {
                            'application/json': {
                                schema: {
                                    $ref:
                                        '#/components/schemas/SuccessResponse',
                                },
                            },
                        },
                    },

                    400: {
                        $ref:
                            '#/components/responses/BadRequest',
                    },

                    409: {
                        $ref:
                            '#/components/responses/Conflict',
                    },
                },
            },
        },

        [apiPath(
            '/auth/login',
            config,
        )]: {
            post: {
                operationId:
                    'loginUser',

                summary:
                    'Login user',

                description:
                    'Authenticates a TITech user and returns a JWT access token.',

                tags:
                    [
                        'Authentication',
                    ],

                requestBody: {
                    required:
                        true,

                    content: {
                        'application/json': {
                            schema: {
                                $ref:
                                    '#/components/schemas/LoginRequest',
                            },
                        },
                    },
                },

                responses: {
                    200: {
                        description:
                            'Login successful.',

                        content: {
                            'application/json': {
                                schema: {
                                    $ref:
                                        '#/components/schemas/LoginResponse',
                                },
                            },
                        },
                    },

                    400: {
                        $ref:
                            '#/components/responses/BadRequest',
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Loan eligibility
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/loans/eligibility/{groupId}',
            config,
        )]: {
            get: {
                operationId:
                    'getLoanEligibility',

                summary:
                    'Check loan eligibility',

                tags:
                    [
                        'Loans',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                parameters:
                    [
                        {
                            $ref:
                                '#/components/parameters/GroupId',
                        },
                    ],

                responses: {
                    200: {
                        description:
                            'Loan eligibility assessment.',

                        content: {
                            'application/json': {
                                schema: {
                                    type:
                                        'object',

                                    required:
                                        [
                                            'success',
                                            'data',
                                        ],

                                    properties: {
                                        success: {
                                            type:
                                                'boolean',
                                        },

                                        data: {
                                            $ref:
                                                '#/components/schemas/LoanEligibility',
                                        },
                                    },
                                },
                            },
                        },
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    404: {
                        $ref:
                            '#/components/responses/NotFound',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Loan request
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/loans/request',
            config,
        )]: {
            post: {
                operationId:
                    'requestLoan',

                summary:
                    'Submit a loan request',

                description:
                    'Creates a loan request for a community member.',

                tags:
                    [
                        'Loans',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                parameters:
                    [
                        {
                            $ref:
                                '#/components/parameters/RequestId',
                        },

                        {
                            $ref:
                                '#/components/parameters/CorrelationId',
                        },

                        {
                            $ref:
                                '#/components/parameters/IdempotencyKey',
                        },
                    ],

                requestBody: {
                    required:
                        true,

                    content: {
                        'application/json': {
                            schema: {
                                $ref:
                                    '#/components/schemas/LoanRequest',
                            },
                        },
                    },
                },

                responses: {
                    201: {
                        description:
                            'Loan request submitted.',

                        content: {
                            'application/json': {
                                schema: {
                                    type:
                                        'object',

                                    properties: {
                                        success: {
                                            type:
                                                'boolean',

                                            example:
                                                true,
                                        },

                                        data: {
                                            $ref:
                                                '#/components/schemas/Loan',
                                        },
                                    },
                                },
                            },
                        },
                    },

                    400: {
                        $ref:
                            '#/components/responses/BadRequest',
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    409: {
                        $ref:
                            '#/components/responses/Conflict',
                    },

                    422: {
                        $ref:
                            '#/components/responses/UnprocessableEntity',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Loan details
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/loans/{loanId}',
            config,
        )]: {
            get: {
                operationId:
                    'getLoan',

                summary:
                    'Get loan details',

                tags:
                    [
                        'Loans',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                parameters:
                    [
                        {
                            $ref:
                                '#/components/parameters/LoanId',
                        },
                    ],

                responses: {
                    200: {
                        description:
                            'Loan details and repayment schedule.',

                        content: {
                            'application/json': {
                                schema: {
                                    type:
                                        'object',

                                    properties: {
                                        success: {
                                            type:
                                                'boolean',
                                        },

                                        data: {
                                            type:
                                                'object',

                                            properties: {
                                                loan: {
                                                    $ref:
                                                        '#/components/schemas/Loan',
                                                },

                                                schedule: {
                                                    $ref:
                                                        '#/components/schemas/LoanRepaymentSchedule',
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    404: {
                        $ref:
                            '#/components/responses/NotFound',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Loan approval
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/loans/{loanId}/approve',
            config,
        )]: {
            patch: {
                operationId:
                    'approveLoan',

                summary:
                    'Approve a loan',

                description:
                    'Approves a pending loan request. Authorization must be enforced by runtime middleware/service policy.',

                tags:
                    [
                        'Loans',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                parameters:
                    [
                        {
                            $ref:
                                '#/components/parameters/LoanId',
                        },

                        {
                            $ref:
                                '#/components/parameters/RequestId',
                        },

                        {
                            $ref:
                                '#/components/parameters/CorrelationId',
                        },

                        {
                            $ref:
                                '#/components/parameters/IdempotencyKey',
                        },
                    ],

                requestBody: {
                    required:
                        false,

                    content: {
                        'application/json': {
                            schema: {
                                $ref:
                                    '#/components/schemas/LoanApprovalRequest',
                            },
                        },
                    },
                },

                responses: {
                    200: {
                        description:
                            'Loan approved.',

                        content: {
                            'application/json': {
                                schema: {
                                    type:
                                        'object',

                                    properties: {
                                        success: {
                                            type:
                                                'boolean',
                                        },

                                        data: {
                                            $ref:
                                                '#/components/schemas/Loan',
                                        },
                                    },
                                },
                            },
                        },
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    403: {
                        $ref:
                            '#/components/responses/Forbidden',
                    },

                    404: {
                        $ref:
                            '#/components/responses/NotFound',
                    },

                    409: {
                        $ref:
                            '#/components/responses/Conflict',
                    },

                    422: {
                        $ref:
                            '#/components/responses/UnprocessableEntity',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Loan disbursement
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/loans/{loanId}/disburse',
            config,
        )]: {
            patch: {
                operationId:
                    'disburseLoan',

                summary:
                    'Disburse an approved loan',

                description:
                    'Initiates or records loan disbursement. The actual financial transaction remains subject to the TITech financial transaction boundary.',

                tags:
                    [
                        'Loans',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                parameters:
                    [
                        {
                            $ref:
                                '#/components/parameters/LoanId',
                        },

                        {
                            $ref:
                                '#/components/parameters/RequestId',
                        },

                        {
                            $ref:
                                '#/components/parameters/CorrelationId',
                        },

                        {
                            $ref:
                                '#/components/parameters/IdempotencyKey',
                        },
                    ],

                requestBody: {
                    required:
                        false,

                    content: {
                        'application/json': {
                            schema: {
                                $ref:
                                    '#/components/schemas/LoanDisbursementRequest',
                            },
                        },
                    },
                },

                responses: {
                    200: {
                        description:
                            'Loan disbursement accepted or completed.',
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    403: {
                        $ref:
                            '#/components/responses/Forbidden',
                    },

                    404: {
                        $ref:
                            '#/components/responses/NotFound',
                    },

                    409: {
                        $ref:
                            '#/components/responses/Conflict',
                    },

                    422: {
                        $ref:
                            '#/components/responses/UnprocessableEntity',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Loan repayment
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/loans/{loanId}/repay',
            config,
        )]: {
            post: {
                operationId:
                    'repayLoan',

                summary:
                    'Record a loan repayment',

                description:
                    'Processes a loan repayment through the TITech financial transaction boundary.',

                tags:
                    [
                        'Loans',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                parameters:
                    [
                        {
                            $ref:
                                '#/components/parameters/LoanId',
                        },

                        {
                            $ref:
                                '#/components/parameters/RequestId',
                        },

                        {
                            $ref:
                                '#/components/parameters/CorrelationId',
                        },

                        {
                            $ref:
                                '#/components/parameters/IdempotencyKey',
                        },
                    ],

                requestBody: {
                    required:
                        true,

                    content: {
                        'application/json': {
                            schema: {
                                $ref:
                                    '#/components/schemas/LoanRepaymentRequest',
                            },
                        },
                    },
                },

                responses: {
                    200: {
                        description:
                            'Repayment accepted or recorded.',
                    },

                    400: {
                        $ref:
                            '#/components/responses/BadRequest',
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    404: {
                        $ref:
                            '#/components/responses/NotFound',
                    },

                    409: {
                        $ref:
                            '#/components/responses/Conflict',
                    },

                    422: {
                        $ref:
                            '#/components/responses/UnprocessableEntity',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Admin dashboard
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/admin/dashboard',
            config,
        )]: {
            get: {
                operationId:
                    'getAdminDashboard',

                summary:
                    'Get administrative dashboard metrics',

                tags:
                    [
                        'Admin',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                responses: {
                    200: {
                        description:
                            'Administrative dashboard metrics.',

                        content: {
                            'application/json': {
                                schema: {
                                    type:
                                        'object',

                                    properties: {
                                        success: {
                                            type:
                                                'boolean',
                                        },

                                        data: {
                                            type:
                                                'object',

                                            additionalProperties:
                                                true,
                                        },
                                    },
                                },
                            },
                        },
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    403: {
                        $ref:
                            '#/components/responses/Forbidden',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Admin analytics
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/admin/analytics/loans',
            config,
        )]: {
            get: {
                operationId:
                    'getLoanAnalytics',

                summary:
                    'Get loan analytics',

                tags:
                    [
                        'Admin',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                parameters: [
                    {
                        name:
                            'period',

                        in:
                            'query',

                        required:
                            false,

                        schema: {
                            type:
                                'string',

                            enum: [
                                '7d',
                                '30d',
                                '90d',
                                'all',
                            ],

                            default:
                                '30d',
                        },
                    },
                ],

                responses: {
                    200: {
                        description:
                            'Loan analytics.',
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    403: {
                        $ref:
                            '#/components/responses/Forbidden',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Admin health
         * ---------------------------------------------------------------------
         */

        [apiPath(
            '/admin/system/health',
            config,
        )]: {
            get: {
                operationId:
                    'getAdminSystemHealth',

                summary:
                    'Get system health status',

                tags:
                    [
                        'Admin',
                    ],

                security:
                    [
                        {
                            bearerAuth:
                                [],
                        },
                    ],

                responses: {
                    200: {
                        description:
                            'System health information.',

                        content: {
                            'application/json': {
                                schema: {
                                    $ref:
                                        '#/components/schemas/HealthResponse',
                                },
                            },
                        },
                    },

                    401: {
                        $ref:
                            '#/components/responses/Unauthorized',
                    },

                    403: {
                        $ref:
                            '#/components/responses/Forbidden',
                    },

                    503: {
                        $ref:
                            '#/components/responses/ServiceUnavailable',
                    },
                },
            },
        },

        /**
         * ---------------------------------------------------------------------
         * Runtime health endpoints
         * ---------------------------------------------------------------------
         */

        '/live': {
            get: {
                operationId:
                    'getLiveness',

                summary:
                    'Check process liveness',

                tags:
                    [
                        'Health',
                    ],

                security:
                    [],

                responses: {
                    200: {
                        description:
                            'Process is alive.',

                        content: {
                            'application/json': {
                                schema: {
                                    $ref:
                                        '#/components/schemas/HealthResponse',
                                },
                            },
                        },
                    },

                    503: {
                        $ref:
                            '#/components/responses/ServiceUnavailable',
                    },
                },
            },
        },

        '/ready': {
            get: {
                operationId:
                    'getReadiness',

                summary:
                    'Check application readiness',

                tags:
                    [
                        'Health',
                    ],

                security:
                    [],

                responses: {
                    200: {
                        description:
                            'Application is ready.',

                        content: {
                            'application/json': {
                                schema: {
                                    $ref:
                                        '#/components/schemas/HealthResponse',
                                },
                            },
                        },
                    },

                    503: {
                        $ref:
                            '#/components/responses/ServiceUnavailable',
                    },
                },
            },
        },

        '/health': {
            get: {
                operationId:
                    'getHealth',

                summary:
                    'Check application health',

                tags:
                    [
                        'Health',
                    ],

                security:
                    [],

                responses: {
                    200: {
                        description:
                            'Application is healthy.',

                        content: {
                            'application/json': {
                                schema: {
                                    $ref:
                                        '#/components/schemas/HealthResponse',
                                },
                            },
                        },
                    },

                    503: {
                        $ref:
                            '#/components/responses/ServiceUnavailable',
                    },
                },
            },
        },
    };
}

/**
 * =============================================================================
 * Configuration validation
 * =============================================================================
 */

function validateSwaggerConfig(
    config,
) {
    const errors = [];
    const warnings = [];

    const production =
        isProduction(
            config.environment,
        );

    if (
        !config.title
    ) {
        errors.push({
            code:
                'SWAGGER_TITLE_MISSING',

            field:
                'title',
        });
    }

    if (
        !config.version
    ) {
        errors.push({
            code:
                'SWAGGER_VERSION_MISSING',

            field:
                'version',
        });
    }

    if (
        production &&
        config.publicUiInProduction &&
        config.requireDocumentationAuthentication
    ) {
        warnings.push({
            code:
                'SWAGGER_PUBLIC_UI_AUTH_REQUIRED',

            message:
                'TITech production Swagger UI is enabled; the route must be protected by the bootstrap security layer.',
        });
    }

    if (
        production &&
        config.exposeDiagnostics
    ) {
        errors.push({
            code:
                'SWAGGER_DIAGNOSTICS_PRODUCTION_FORBIDDEN',

            field:
                'exposeDiagnostics',

            message:
                'Internal diagnostics must not be exposed through the public production API documentation.',
        });
    }

    if (
        production &&
        config.exposeInternalRoutes
    ) {
        errors.push({
            code:
                'SWAGGER_INTERNAL_ROUTES_PRODUCTION_FORBIDDEN',

            field:
                'exposeInternalRoutes',
        });
    }

    if (
        production &&
        config.allowTryItOutInProduction
    ) {
        warnings.push({
            code:
                'SWAGGER_TRY_IT_OUT_PRODUCTION_ENABLED',

            field:
                'allowTryItOutInProduction',

            message:
                'Swagger Try-It-Out is enabled in production and the documentation endpoint should be protected.',
        });
    }

    if (
        config.bearerAuthEnabled === false &&
        config.apiKeyAuthEnabled === false &&
        config.cookieAuthEnabled === false &&
        config.oauth2Enabled === false
    ) {
        warnings.push({
            code:
                'SWAGGER_NO_AUTH_SCHEME',
        });
    }

    if (
        config.redactExamples === false &&
        production
    ) {
        warnings.push({
            code:
                'SWAGGER_EXAMPLES_NOT_REDACTED',
        });
    }

    if (
        errors.length >
        0
    ) {
        const error =
            new Error(
                'TITech Swagger configuration validation failed.',
            );

        error.name =
            'SwaggerConfigError';

        error.code =
            'SWAGGER_CONFIGURATION_INVALID';

        error.details = {
            component:
                COMPONENT,

            errors,
            warnings,
        };

        throw error;
    }

    const state =
        !config.enabled
            ? DOCUMENTATION_STATES.DISABLED
            : warnings.length > 0
                ? DOCUMENTATION_STATES.DEGRADED
                : DOCUMENTATION_STATES.ENABLED;

    return deepFreeze({
        ...config,

        state,

        warnings:
            Object.freeze(
                warnings,
            ),
    });
}

/**
 * =============================================================================
 * OpenAPI document builder
 * =============================================================================
 */

function createOpenApiDocument(
    input = {},
) {
    const config =
        input.swagger ||
        input;

    const effectiveConfig =
        config.title
            ? validateSwaggerConfig(
                config,
            )
            : defaultConfig;

    const schemas =
        {
            ...createSchemas(
                effectiveConfig,
            ),

            ...createRequestSchemas(),
        };

    const document = {
        openapi:
            OPENAPI_VERSION,

        info: {
            title:
                effectiveConfig.title,

            version:
                effectiveConfig.version,

            description:
                effectiveConfig.description,

            contact: {
                ...effectiveConfig.contact,
            },

            license: {
                ...effectiveConfig.license,
            },
        },

        servers:
            createServers(
                effectiveConfig,
            ),

        tags:
            DEFAULT_TAGS.map(
                tag => ({
                    ...tag,
                }),
            ),

        paths:
            createPaths(
                effectiveConfig,
            ),

        components: {
            securitySchemes:
                createSecuritySchemes(
                    effectiveConfig,
                ),

            schemas,

            responses:
                createResponses(),

            parameters:
                createParameters(
                    effectiveConfig,
                ),
        },

        externalDocs: {
            description:
                'TITech Community Capital',

            url:
                env(
                    'API_DOCUMENTATION_URL',
                    'https://titech.africa',
                ),
        },
    };

    /**
     * Do NOT set a global BearerAuth requirement here.
     *
     * Authentication endpoints and health endpoints are intentionally public,
     * while protected business endpoints declare their own security explicitly.
     */
    return deepFreeze(
        document,
    );
}

/**
 * =============================================================================
 * Swagger-JSDoc compatibility
 * =============================================================================
 */

function createSwaggerJsdocOptions(
    config =
        defaultConfig,
) {
    return deepFreeze({
        definition:
            createOpenApiDocument(
                config,
            ),

        apis:
            [
                ...config.routePatterns,
                ...config.excludePatterns.map(
                    pattern =>
                        `!${pattern}`,
                ),
            ],

        failOnErrors:
            true,
    });
}

/**
 * =============================================================================
 * Swagger UI options
 * =============================================================================
 */

function createSwaggerUiOptions(
    config =
        defaultConfig,
) {
    const production =
        isProduction(
            config.environment,
        );

    return deepFreeze({
        explorer:
            config.explorer,

        persistAuthorization:
            config.persistAuthorization,

        docExpansion:
            config.docExpansion,

        defaultModelsExpandDepth:
            config.defaultModelsExpandDepth,

        defaultModelExpandDepth:
            config.defaultModelExpandDepth,

        displayRequestDuration:
            config.displayRequestDuration,

        filter:
            config.filter,

        showExtensions:
            config.showExtensions,

        showCommonExtensions:
            config.showCommonExtensions,

        deepLinking:
            config.deepLinking,

        tryItOutEnabled:
            config.tryItOutEnabled &&
            (
                !production ||
                config.allowTryItOutInProduction
            ),

        withCredentials:
            config.withCredentials,

        validatorUrl:
            env(
                'SWAGGER_VALIDATOR_URL',
                null,
            ) || null,
    });
}

/**
 * =============================================================================
 * Exposure policy
 * =============================================================================
 */

function getExposurePolicy(
    config =
        defaultConfig,
) {
    const production =
        isProduction(
            config.environment,
        );

    return deepFreeze({
        state:
            config.state,

        ui:
            config.enabled &&
            config.uiEnabled &&
            (
                !production ||
                config.publicUiInProduction
            ),

        json:
            config.enabled &&
            config.jsonEnabled &&
            (
                !production ||
                config.publicJsonInProduction
            ),

        yaml:
            config.enabled &&
            config.yamlEnabled &&
            (
                !production ||
                config.publicYamlInProduction
            ),

        requiresAuthentication:
            config.requireDocumentationAuthentication,

        tryItOut:
            config.tryItOutEnabled &&
            (
                !production ||
                config.allowTryItOutInProduction
            ),

        serverSelection:
            !production ||
            config.allowProductionServerSelection,

        internalRoutes:
            config.exposeInternalRoutes &&
            !production,

        diagnostics:
            config.exposeDiagnostics &&
            !production,
    });
}

/**
 * =============================================================================
 * Diagnostics snapshot
 * =============================================================================
 */

function getSnapshot(
    config =
        defaultConfig,
) {
    const exposure =
        getExposurePolicy(
            config,
        );

    return deepFreeze({
        component:
            COMPONENT,

        service:
            SERVICE_NAME,

        application:
            APPLICATION_NAME,

        environment:
            config.environment,

        state:
            config.state,

        openapi:
            OPENAPI_VERSION,

        title:
            config.title,

        version:
            config.version,

        apiPrefix:
            config.apiPrefix,

        docsPath:
            config.docsPath,

        jsonPath:
            config.jsonPath,

        yamlPath:
            config.yamlPath,

        exposure,

        security:
            {
                bearerAuth:
                    config.bearerAuthEnabled,

                apiKeyAuth:
                    config.apiKeyAuthEnabled,

                cookieAuth:
                    config.cookieAuthEnabled,

                oauth2:
                    config.oauth2Enabled,
            },

        routes:
            {
                explicitlyDocumented:
                    Object.keys(
                        createPaths(
                            config,
                        ),
                    ).length,

                sourcePatterns:
                    [
                        ...config.routePatterns,
                    ],

                excludedPatterns:
                    [
                        ...config.excludePatterns,
                    ],
            },

        warnings:
            [
                ...(config.warnings || []),
            ],

        timestamp:
            new Date().toISOString(),
    });
}

/**
 * =============================================================================
 * Environment override diagnostics
 * =============================================================================
 */

function getEnvironmentOverrides() {
    const keys = [
        'SWAGGER_ENABLED',
        'SWAGGER_UI_ENABLED',
        'SWAGGER_JSON_ENABLED',
        'SWAGGER_YAML_ENABLED',
        'SWAGGER_TITLE',
        'SWAGGER_DESCRIPTION',
        'SWAGGER_VERSION',
        'SWAGGER_TERMS_URL',
        'SWAGGER_CONTACT_NAME',
        'SWAGGER_CONTACT_EMAIL',
        'SWAGGER_CONTACT_URL',
        'SWAGGER_LICENSE_NAME',
        'SWAGGER_LICENSE_URL',
        'API_PREFIX',
        'API_PUBLIC_URL',
        'PUBLIC_API_URL',
        'API_DOCUMENTATION_URL',
        'SWAGGER_DOCS_PATH',
        'SWAGGER_JSON_PATH',
        'SWAGGER_YAML_PATH',
        'SWAGGER_ROUTE_PATTERNS',
        'SWAGGER_EXCLUDE_PATTERNS',
        'SWAGGER_EXPLORER',
        'SWAGGER_PERSIST_AUTHORIZATION',
        'SWAGGER_DOC_EXPANSION',
        'SWAGGER_TRY_IT_OUT',
        'SWAGGER_ALLOW_PRODUCTION_TRY_IT_OUT',
        'SWAGGER_PUBLIC_UI_PRODUCTION',
        'SWAGGER_PUBLIC_JSON_PRODUCTION',
        'SWAGGER_PUBLIC_YAML_PRODUCTION',
        'SWAGGER_REQUIRE_AUTH',
        'SWAGGER_ALLOW_SERVER_SELECTION_PRODUCTION',
        'SWAGGER_EXPOSE_INTERNAL_ROUTES',
        'SWAGGER_EXPOSE_DIAGNOSTICS',
        'SWAGGER_BEARER_ENABLED',
        'SWAGGER_API_KEY_ENABLED',
        'SWAGGER_COOKIE_ENABLED',
        'SWAGGER_OAUTH2_ENABLED',
        'SWAGGER_REDACT_EXAMPLES',
        'SWAGGER_VALIDATOR_URL',
    ];

    const result = {};

    for (
        const key of
        keys
    ) {
        result[key] =
            process.env[key];
    }

    return Object.freeze(
        result,
    );
}

/**
 * =============================================================================
 * Configuration builder
 * =============================================================================
 */

function createSwaggerConfig(
    input = {},
) {
    const source =
        input.swagger ||
        input;

    const environment =
        asString(
            source.environment,
            env(
                'NODE_ENV',
                'development',
            ),
        );

    const config = {
        ...DEFAULTS,

        enabled:
            source.enabled ??
            asBoolean(
                env(
                    'SWAGGER_ENABLED',
                ),
                DEFAULTS.enabled,
            ),

        uiEnabled:
            source.uiEnabled ??
            asBoolean(
                env(
                    'SWAGGER_UI_ENABLED',
                ),
                DEFAULTS.uiEnabled,
            ),

        jsonEnabled:
            source.jsonEnabled ??
            asBoolean(
                env(
                    'SWAGGER_JSON_ENABLED',
                ),
                DEFAULTS.jsonEnabled,
            ),

        yamlEnabled:
            source.yamlEnabled ??
            asBoolean(
                env(
                    'SWAGGER_YAML_ENABLED',
                ),
                DEFAULTS.yamlEnabled,
            ),

        title:
            asString(
                source.title ||
                env(
                    'SWAGGER_TITLE',
                ),
                DEFAULTS.title,
            ),

        description:
            asString(
                source.description ||
                env(
                    'SWAGGER_DESCRIPTION',
                ),
                DEFAULTS.description,
            ),

        version:
            asString(
                source.version ||
                env(
                    'SWAGGER_VERSION',
                ),
                DEFAULTS.version,
            ),

        apiPrefix:
            asString(
                source.apiPrefix ||
                env(
                    'API_PREFIX',
                ),
                DEFAULTS.apiPrefix,
            ),

        docsPath:
            asString(
                source.docsPath ||
                env(
                    'SWAGGER_DOCS_PATH',
                ),
                DEFAULTS.docsPath,
            ),

        jsonPath:
            asString(
                source.jsonPath ||
                env(
                    'SWAGGER_JSON_PATH',
                ),
                DEFAULTS.jsonPath,
            ),

        yamlPath:
            asString(
                source.yamlPath ||
                env(
                    'SWAGGER_YAML_PATH',
                ),
                DEFAULTS.yamlPath,
            ),

        routePatterns:
            asList(
                source.routePatterns ||
                env(
                    'SWAGGER_ROUTE_PATTERNS',
                ),
                DEFAULTS.routePatterns,
            ),

        excludePatterns:
            asList(
                source.excludePatterns ||
                env(
                    'SWAGGER_EXCLUDE_PATTERNS',
                ),
                DEFAULTS.excludePatterns,
            ),

        explorer:
            source.explorer ??
            asBoolean(
                env(
                    'SWAGGER_EXPLORER',
                ),
                DEFAULTS.explorer,
            ),

        persistAuthorization:
            source.persistAuthorization ??
            asBoolean(
                env(
                    'SWAGGER_PERSIST_AUTHORIZATION',
                ),
                DEFAULTS.persistAuthorization,
            ),

        docExpansion:
            toEnum(
                source.docExpansion ||
                env(
                    'SWAGGER_DOC_EXPANSION',
                ),
                [
                    'none',
                    'list',
                    'full',
                ],
                DEFAULTS.docExpansion,
            ),

        defaultModelsExpandDepth:
            Number.isInteger(
                source.defaultModelsExpandDepth,
            )
                ? source.defaultModelsExpandDepth
                : DEFAULTS
                    .defaultModelsExpandDepth,

        defaultModelExpandDepth:
            Number.isInteger(
                source.defaultModelExpandDepth,
            )
                ? source.defaultModelExpandDepth
                : DEFAULTS
                    .defaultModelExpandDepth,

        displayRequestDuration:
            source.displayRequestDuration ??
            DEFAULTS.displayRequestDuration,

        filter:
            source.filter ??
            DEFAULTS.filter,

        showExtensions:
            source.showExtensions ??
            DEFAULTS.showExtensions,

        showCommonExtensions:
            source.showCommonExtensions ??
            DEFAULTS.showCommonExtensions,

        deepLinking:
            source.deepLinking ??
            DEFAULTS.deepLinking,

        tryItOutEnabled:
            source.tryItOutEnabled ??
            asBoolean(
                env(
                    'SWAGGER_TRY_IT_OUT',
                ),
                DEFAULTS.tryItOutEnabled,
            ),

        withCredentials:
            source.withCredentials ??
            DEFAULTS.withCredentials,

        bearerAuthEnabled:
            source.bearerAuthEnabled ??
            asBoolean(
                env(
                    'SWAGGER_BEARER_ENABLED',
                ),
                DEFAULTS.bearerAuthEnabled,
            ),

        apiKeyAuthEnabled:
            source.apiKeyAuthEnabled ??
            asBoolean(
                env(
                    'SWAGGER_API_KEY_ENABLED',
                ),
                DEFAULTS.apiKeyAuthEnabled,
            ),

        cookieAuthEnabled:
            source.cookieAuthEnabled ??
            asBoolean(
                env(
                    'SWAGGER_COOKIE_ENABLED',
                ),
                DEFAULTS.cookieAuthEnabled,
            ),

        oauth2Enabled:
            source.oauth2Enabled ??
            asBoolean(
                env(
                    'SWAGGER_OAUTH2_ENABLED',
                ),
                DEFAULTS.oauth2Enabled,
            ),

        requireDocumentationAuthentication:
            source.requireDocumentationAuthentication ??
            asBoolean(
                env(
                    'SWAGGER_REQUIRE_AUTH',
                ),
                DEFAULTS
                    .requireDocumentationAuthentication,
            ),

        publicUiInProduction:
            source.publicUiInProduction ??
            asBoolean(
                env(
                    'SWAGGER_PUBLIC_UI_PRODUCTION',
                ),
                DEFAULTS.publicUiInProduction,
            ),

        publicJsonInProduction:
            source.publicJsonInProduction ??
            asBoolean(
                env(
                    'SWAGGER_PUBLIC_JSON_PRODUCTION',
                ),
                DEFAULTS.publicJsonInProduction,
            ),

        publicYamlInProduction:
            source.publicYamlInProduction ??
            asBoolean(
                env(
                    'SWAGGER_PUBLIC_YAML_PRODUCTION',
                ),
                DEFAULTS.publicYamlInProduction,
            ),

        allowTryItOutInProduction:
            source.allowTryItOutInProduction ??
            asBoolean(
                env(
                    'SWAGGER_ALLOW_PRODUCTION_TRY_IT_OUT',
                ),
                DEFAULTS.allowTryItOutInProduction,
            ),

        allowProductionServerSelection:
            source.allowProductionServerSelection ??
            asBoolean(
                env(
                    'SWAGGER_ALLOW_SERVER_SELECTION_PRODUCTION',
                ),
                DEFAULTS
                    .allowProductionServerSelection,
            ),

        exposeInternalRoutes:
            source.exposeInternalRoutes ??
            asBoolean(
                env(
                    'SWAGGER_EXPOSE_INTERNAL_ROUTES',
                ),
                DEFAULTS.exposeInternalRoutes,
            ),

        exposeDiagnostics:
            source.exposeDiagnostics ??
            asBoolean(
                env(
                    'SWAGGER_EXPOSE_DIAGNOSTICS',
                ),
                DEFAULTS.exposeDiagnostics,
            ),

        exposeExamples:
            source.exposeExamples ??
            DEFAULTS.exposeExamples,

        redactExamples:
            source.redactExamples ??
            asBoolean(
                env(
                    'SWAGGER_REDACT_EXAMPLES',
                ),
                DEFAULTS.redactExamples,
            ),

        includeRequestId:
            source.includeRequestId ??
            DEFAULTS.includeRequestId,

        includeCorrelationId:
            source.includeCorrelationId ??
            DEFAULTS.includeCorrelationId,

        includeTraceId:
            source.includeTraceId ??
            DEFAULTS.includeTraceId,

        includeIdempotencyKey:
            source.includeIdempotencyKey ??
            DEFAULTS.includeIdempotencyKey,

        cacheEnabled:
            source.cacheEnabled ??
            DEFAULTS.cacheEnabled,

        cacheMaxAgeSeconds:
            source.cacheMaxAgeSeconds ??
            DEFAULTS.cacheMaxAgeSeconds,

        defaultServer:
            source.defaultServer ||
            env(
                'API_PUBLIC_URL',
            ) ||
            env(
                'PUBLIC_API_URL',
            ) ||
            DEFAULTS
                .servers[
                    environment
                ],

        environment,

        servers: {
            ...DEFAULTS.servers,
            ...(source.servers || {}),
        },

        contact: {
            ...DEFAULTS.contact,
            ...(source.contact || {}),
        },

        license: {
            ...DEFAULTS.license,
            ...(source.license || {}),
        },
    };

    return validateSwaggerConfig(
        config,
    );
}

/**
 * =============================================================================
 * Default configuration
 * =============================================================================
 */

const config =
    createSwaggerConfig();

/**
 * =============================================================================
 * Canonical OpenAPI definition
 * ============================================================================= */

const definition =
    createOpenApiDocument(
        config,
    );

/**
 * =============================================================================
 * Swagger-jsdoc options
 * ============================================================================= */

const swaggerJsdoc =
    createSwaggerJsdocOptions(
        config,
    );

/**
 * =============================================================================
 * Swagger UI options
 * ============================================================================= */

const uiOptions =
    createSwaggerUiOptions(
        config,
    );

/**
 * =============================================================================
 * Lifecycle compatibility
 * ============================================================================= */

async function initialize(
    context = {},
    options = {},
) {
    const effectiveConfig =
        options.config
            ? createSwaggerConfig(
                options.config,
            )
            : config;

    if (
        context &&
        typeof context === 'object'
    ) {
        context.swagger =
            effectiveConfig;

        context.swaggerConfig =
            effectiveConfig;

        context.openapi =
            createOpenApiDocument(
                effectiveConfig,
            );
    }

    return effectiveConfig;
}

async function start(
    context = {},
    options = {},
) {
    return initialize(
        context,
        options,
    );
}

async function bootstrap(
    context = {},
    options = {},
) {
    return start(
        context,
        options,
    );
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 *
 * Compatibility:
 *
 * Existing code can continue to use:
 *
 *   require('./swaggerConfig').definition
 *
 * while newer bootstrap code can use:
 *
 *   createOpenApiDocument()
 *   createSwaggerJsdocOptions()
 *   createSwaggerUiOptions()
 *
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * ---------------------------------------------------------------------
         * Legacy / direct Swagger consumers
         * ---------------------------------------------------------------------
         */

        definition,

        apis:
            [
                ...config.routePatterns,
                ...config.excludePatterns.map(
                    pattern =>
                        `!${pattern}`,
                ),
            ],

        swaggerJsdoc,

        uiOptions,

        /**
         * ---------------------------------------------------------------------
         * Canonical configuration
         * ---------------------------------------------------------------------
         */

        config,

        swagger:
            config,

        DEFAULTS,

        OPENAPI_VERSION,

        DOCUMENTATION_STATES,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * ---------------------------------------------------------------------
         * Builders
         * ---------------------------------------------------------------------
         */

        createSwaggerConfig,

        validateSwaggerConfig,

        createOpenApiDocument,

        createSwaggerJsdocOptions,

        createSwaggerUiOptions,

        createServers,

        createSchemas,

        createRequestSchemas,

        createSecuritySchemes,

        createResponses,

        createParameters,

        createPaths,

        getExposurePolicy,

        getSnapshot,

        getEnvironmentOverrides,

        /**
         * ---------------------------------------------------------------------
         * Lifecycle compatibility
         * ---------------------------------------------------------------------
         */

        initialize,

        start,

        bootstrap,
    });