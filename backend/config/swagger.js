'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/swagger.js
 *
 * Purpose:
 *   Enterprise production-grade OpenAPI / Swagger configuration boundary.
 *
 * Responsibilities:
 *   - Centralize OpenAPI metadata.
 *   - Define API documentation configuration.
 *   - Define server/environment metadata.
 *   - Define authentication/security schemes.
 *   - Define reusable documentation components.
 *   - Define common response schemas.
 *   - Define pagination/error/request correlation schemas.
 *   - Define documentation exposure policy.
 *   - Prevent accidental production exposure of sensitive diagnostics.
 *   - Provide compatibility with swagger-ui-express / swagger-jsdoc.
 *   - Provide safe documentation snapshots.
 *
 * IMPORTANT:
 *
 *   This file owns API DOCUMENTATION CONFIGURATION.
 *
 *   It does NOT:
 *     - register Express routes.
 *     - implement controllers.
 *     - execute business logic.
 *     - implement authentication.
 *     - create JWT tokens.
 *     - expose secrets.
 *     - replace runtime validation.
 *
 * OpenAPI documentation is descriptive metadata only.
 *
 * =============================================================================
 *
 * Canonical architecture:
 *
 *   config/environment.js
 *       ↓
 *   config/defaults.js
 *       ↓
 *   config/swagger.js
 *       ↓
 *   routes / controllers
 *       ↓
 *   OpenAPI generator
 *       ↓
 *   Swagger UI / JSON document
 *
 * =============================================================================
 */

const process =
    require('node:process');

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configProvider = null;

try {
    // eslint-disable-next-line global-require
    configProvider = require('./configProvider');
} catch {
    configProvider = null;
}

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

const DOCUMENTATION_STATES =
    Object.freeze({
        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',
    });

const DEFAULT_TAGS =
    Object.freeze([
        {
            name:
                'Authentication',

            description:
                'Authentication, identity, session and account-access operations.',
        },

        {
            name:
                'Users',

            description:
                'User and profile operations.',
        },

        {
            name:
                'Groups',

            description:
                'Community and group management operations.',
        },

        {
            name:
                'Contributions',

            description:
                'Community contribution and savings operations.',
        },

        {
            name:
                'Loans',

            description:
                'Loan lifecycle and eligibility operations.',
        },

        {
            name:
                'Payments',

            description:
                'Payment initiation, status and reconciliation operations.',
        },

        {
            name:
                'Notifications',

            description:
                'Email, SMS and application notification operations.',
        },

        {
            name:
                'Health',

            description:
                'Liveness, readiness and service-health endpoints.',
        },
    ]);

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({

        enabled:
            true,

        uiEnabled:
            true,

        jsonEnabled:
            true,

        yamlEnabled:
            true,

        title:
            'TITech Community Capital API',

        description:
            'Enterprise API for the TITech Community Capital platform.',

        version:
            process.env.APP_VERSION ||
            process.env.npm_package_version ||
            '1.0.0',

        termsOfService:
            null,

        contact:
            {
                name:
                    'TITech Community Capital',

                email:
                    'support@example.com',

                url:
                    null,
            },

        license:
            {
                name:
                    'Proprietary',

                url:
                    null,
            },

        servers:
            {
                development:
                    'http://localhost:3000',

                test:
                    'http://localhost:3000',

                staging:
                    'https://staging-api.example.com',

                production:
                    'https://api.example.com',
            },

        defaultServer:
            null,

        docsPath:
            '/docs',

        jsonPath:
            '/docs/openapi.json',

        yamlPath:
            '/docs/openapi.yaml',

        routePatterns:
            [
                'backend/routes/**/*.js',
                'backend/controllers/**/*.js',
            ],

        excludePatterns:
            [
                '**/*.test.js',
                '**/*.spec.js',
            ],

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

        validatorUrl:
            null,

        oauth2RedirectUrl:
            null,

        /**
         * Documentation exposure policy.
         */
        publicUiInProduction:
            false,

        publicJsonInProduction:
            false,

        publicYamlInProduction:
            false,

        requireAuthentication:
            true,

        allowTryItOutInProduction:
            false,

        allowServerSelectionInProduction:
            false,

        exposeInternalRoutes:
            false,

        exposeDiagnostics:
            false,

        exposeExamples:
            true,

        exposeSchemas:
            true,

        redactExamples:
            true,

        /**
         * Security schemes.
         */
        security:
            {
                bearerEnabled:
                    true,

                apiKeyEnabled:
                    true,

                cookieEnabled:
                    false,

                oauth2Enabled:
                    false,
            },

        /**
         * Schema behavior.
         */
        schemas:
            {
                strict:
                    true,

                nullable:
                    true,

                additionalProperties:
                    false,
            },

        /**
         * Common response behavior.
         */
        responses:
            {
                includeRequestId:
                    true,

                includeCorrelationId:
                    true,

                includeTraceId:
                    true,

                includeTimestamp:
                    true,
            },

        /**
         * Documentation caching.
         */
        cache:
            {
                enabled:
                    true,

                maxAgeSeconds:
                    300,
            },

        /**
         * Metadata.
         */
        metadata:
            {
                organization:
                    'TITech Community Capital LTD',

                platform:
                    'TITech Community Capital Operating System',

                vendor:
                    'TITech',

                environment:
                    process.env.NODE_ENV ||
                    'development',
            },
    });

/**
 * =============================================================================
 * Utility helpers
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
        typeof value ===
        'boolean'
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

function asPositiveInteger(
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

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isInteger(
            parsed,
        ) ||
        parsed <= 0
    ) {

        return fallback;
    }

    return parsed;
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

    return normalized || fallback;
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

    const match =
        allowed.find(
            item =>
                String(
                    item,
                ).toLowerCase() ===
                String(
                    normalized,
                ).toLowerCase(),
        );

    return (
        match ||
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
        const key of Reflect.ownKeys(
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

function getConfig(
    key,
    fallback,
) {

    try {

        if (
            typeof configProvider?.get ===
                'function'
        ) {

            return configProvider.get(
                key,
                fallback,
            );
        }

    } catch {
        // Fall through.
    }

    return fallback;
}

function getEnvironment() {

    try {

        if (
            typeof configProvider?.getEnvironment ===
                'function'
        ) {

            return configProvider.getEnvironment();
        }

    } catch {
        // Fall through.
    }

    return (
        getConfig(
            'app.environment',
            process.env.NODE_ENV ||
                'development',
        ) ||
        'development'
    );
}

function isProduction(
    environment =
        getEnvironment(),
) {

    return environment ===
        'production';
}

/**
 * =============================================================================
 * Server resolution
 * =============================================================================
 */

function resolveDefaultServer(
    environment,
    source,
) {

    if (
        source.defaultServer
    ) {

        return source.defaultServer;
    }

    const configured =
        env(
            'API_PUBLIC_URL',
        ) ||
        env(
            'PUBLIC_API_URL',
        );

    if (
        configured
    ) {

        return configured;
    }

    return (
        DEFAULTS
            .servers[
                environment
            ] ||
        DEFAULTS
            .servers
            .development
    );
}

function createServers(
    source,
) {

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const primary =
        resolveDefaultServer(
            environment,
            source,
        );

    const configuredServers =
        source.servers ||
        {};

    const servers = [];

    /**
     * Primary server.
     */
    if (
        primary
    ) {

        servers.push({
            url:
                primary,

            description:
                `${environment} API server`,
        });
    }

    /**
     * Additional explicitly configured servers.
     */
    for (
        const [
            name,
            value,
        ] of Object.entries(
            configuredServers,
        )
    ) {

        if (
            !value
        ) {

            continue;
        }

        if (
            servers.some(
                server =>
                    server.url ===
                    value,
            )
        ) {

            continue;
        }

        servers.push({
            url:
                String(
                    value,
                ),

            description:
                `${name} API server`,
        });
    }

    return servers;
}

/**
 * =============================================================================
 * Reusable schema builders
 * =============================================================================
 */

function createCommonSchemas(
    config,
) {

    return {

        Error:
            {
                type:
                    'object',

                required:
                    [
                        'success',
                        'code',
                        'message',
                    ],

                properties:
                    {
                        success:
                            {
                                type:
                                    'boolean',

                                example:
                                    false,
                            },

                        code:
                            {
                                type:
                                    'string',

                                example:
                                    'VALIDATION_ERROR',
                            },

                        message:
                            {
                                type:
                                    'string',

                                example:
                                    'Request validation failed.',
                            },

                        details:
                            {
                                nullable:
                                    true,

                                oneOf:
                                    [
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

                        requestId:
                            {
                                type:
                                    'string',

                                nullable:
                                    true,

                                example:
                                    'b7d0e0f8-1a76-4f22-a9f5-5b0d22b9a4e8',
                            },

                        correlationId:
                            {
                                type:
                                    'string',

                                nullable:
                                    true,

                                example:
                                    'a2b4d6c8e0f1',
                            },

                        traceId:
                            {
                                type:
                                    'string',

                                nullable:
                                    true,

                                example:
                                    '4bf92f3577b34da6a3ce929d0e0e4736',
                            },

                        timestamp:
                            {
                                type:
                                    'string',

                                format:
                                    'date-time',
                            },
                    },
            },

        Pagination:
            {
                type:
                    'object',

                properties:
                    {
                        page:
                            {
                                type:
                                    'integer',

                                minimum:
                                    1,
                            },

                        limit:
                            {
                                type:
                                    'integer',

                                minimum:
                                    1,

                                maximum:
                                    100,
                            },

                        total:
                            {
                                type:
                                    'integer',

                                minimum:
                                    0,
                            },

                        pages:
                            {
                                type:
                                    'integer',

                                minimum:
                                    0,
                            },

                        hasNextPage:
                            {
                                type:
                                    'boolean',
                            },

                        hasPreviousPage:
                            {
                                type:
                                    'boolean',
                            },
                    },
            },

        HealthStatus:
            {
                type:
                    'object',

                properties:
                    {
                        success:
                            {
                                type:
                                    'boolean',
                            },

                        status:
                            {
                                type:
                                    'string',

                                enum:
                                    [
                                        'healthy',
                                        'degraded',
                                        'live',
                                        'ready',
                                        'not_ready',
                                        'stopped',
                                    ],
                            },

                        timestamp:
                            {
                                type:
                                    'string',

                                format:
                                    'date-time',
                            },

                        requestId:
                            {
                                type:
                                    'string',

                                nullable:
                                    true,
                            },
                    },
            },

        Money:
            {
                type:
                    'object',

                description:
                    'Monetary value represented as a decimal amount and currency. Financial APIs should avoid binary floating-point arithmetic internally.',

                required:
                    [
                        'amount',
                        'currency',
                    ],

                properties:
                    {
                        amount:
                            {
                                type:
                                    'string',

                                pattern:
                                    '^\\d+(\\.\\d{1,2})?$',

                                example:
                                    '250000.00',
                            },

                        currency:
                            {
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

        RequestContext:
            {
                type:
                    'object',

                properties:
                    {
                        requestId:
                            {
                                type:
                                    'string',
                            },

                        correlationId:
                            {
                                type:
                                    'string',
                            },

                        traceId:
                            {
                                type:
                                    'string',
                            },

                        spanId:
                            {
                                type:
                                    'string',
                            },
                    },
            },

        Idempotency:
            {
                type:
                    'object',

                properties:
                    {
                        idempotencyKey:
                            {
                                type:
                                    'string',

                                minLength:
                                    8,

                                maxLength:
                                    255,

                                example:
                                    '01J8T5M9R5TX4V2XH7M1B8N3Y9',
                            },
                    },
            },
    };
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
        config.security
            .bearerEnabled
    ) {

        schemes.BearerAuth =
            {
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
        config.security
            .apiKeyEnabled
    ) {

        schemes.ApiKeyAuth =
            {
                type:
                    'apiKey',

                in:
                    'header',

                name:
                    'X-API-Key',

                description:
                    'API key for service-to-service or approved integration access.',
            };
    }

    if (
        config.security
            .cookieEnabled
    ) {

        schemes.CookieAuth =
            {
                type:
                    'apiKey',

                in:
                    'cookie',

                name:
                    'titech_session',

                description:
                    'Authenticated application session cookie.',
            };
    }

    if (
        config.security
            .oauth2Enabled
    ) {

        schemes.OAuth2 =
            {
                type:
                    'oauth2',

                flows:
                    {
                        authorizationCode:
                            {
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

                                scopes:
                                    {
                                        'openid':
                                            'OpenID identity access',

                                        'profile':
                                            'Basic profile access',

                                        'email':
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
 * Common responses
 * =============================================================================
 */

function createCommonResponses(
    config,
) {

    const headers = {};

    if (
        config.responses
            .includeRequestId
    ) {

        headers['X-Request-ID'] =
            {
                description:
                    'Unique request identifier.',

                schema:
                    {
                        type:
                            'string',
                    },
            };
    }

    if (
        config.responses
            .includeCorrelationId
    ) {

        headers['X-Correlation-ID'] =
            {
                description:
                    'Request correlation identifier.',

                schema:
                    {
                        type:
                            'string',
                    },
            };
    }

    if (
        config.responses
            .includeTraceId
    ) {

        headers['X-Trace-ID'] =
            {
                description:
                    'Distributed trace identifier.',

                schema:
                    {
                        type:
                            'string',
                    },
            };
    }

    return {

        BadRequest:
            {
                description:
                    'Bad request.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        Unauthorized:
            {
                description:
                    'Authentication is required or credentials are invalid.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        Forbidden:
            {
                description:
                    'Authenticated principal is not authorized.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        NotFound:
            {
                description:
                    'Resource not found.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        Conflict:
            {
                description:
                    'Resource or operation conflicts with current state.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        UnprocessableEntity:
            {
                description:
                    'Business or validation rules prevent processing.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        TooManyRequests:
            {
                description:
                    'Rate limit exceeded.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        InternalServerError:
            {
                description:
                    'Unexpected server-side error.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },

        ServiceUnavailable:
            {
                description:
                    'Service is not ready or temporarily unavailable.',

                headers,
                content:
                    {
                        'application/json':
                            {
                                schema:
                                    {
                                        $ref:
                                            '#/components/schemas/Error',
                                    },
                            },
                    },
            },
    };
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

    const environment =
        asString(
            config.environment,
            getEnvironment(),
        );

    const servers =
        createServers(
            {
                ...config,
                environment,
            },
        );

    const securitySchemes =
        createSecuritySchemes(
            config,
        );

    const commonSchemas =
        createCommonSchemas(
            config,
        );

    const commonResponses =
        createCommonResponses(
            config,
        );

    const securityRequirements =
        [];

    if (
        config.security
            .bearerEnabled
    ) {

        securityRequirements.push({
            BearerAuth:
                [],
        });
    }

    const document = {

        openapi:
            OPENAPI_VERSION,

        info:
            {
                title:
                    config.title,

                description:
                    config.description,

                version:
                    config.version,

                termsOfService:
                    config.termsOfService ||
                    undefined,

                contact:
                    {
                        ...config.contact,
                    },

                license:
                    {
                        ...config.license,
                    },
            },

        servers,

        tags:
            [
                ...DEFAULT_TAGS,
            ],

        paths:
            {},

        components:
            {
                securitySchemes,

                schemas:
                    commonSchemas,

                responses:
                    commonResponses,

                parameters:
                    {
                        RequestId:
                            {
                                name:
                                    'X-Request-ID',

                                in:
                                    'header',

                                required:
                                    false,

                                schema:
                                    {
                                        type:
                                            'string',
                                    },

                                description:
                                    'Request identifier used for correlation and operational diagnostics.',
                            },

                        CorrelationId:
                            {
                                name:
                                    'X-Correlation-ID',

                                in:
                                    'header',

                                required:
                                    false,

                                schema:
                                    {
                                        type:
                                            'string',
                                    },

                                description:
                                    'Correlation identifier propagated across application services.',
                            },

                        IdempotencyKey:
                            {
                                name:
                                    'Idempotency-Key',

                                in:
                                    'header',

                                required:
                                    false,

                                schema:
                                    {
                                        type:
                                            'string',

                                        minLength:
                                            8,

                                        maxLength:
                                            255,
                                    },

                                description:
                                    'Unique key for safely retrying supported state-changing operations.',
                            },

                        Page:
                            {
                                name:
                                    'page',

                                in:
                                    'query',

                                required:
                                    false,

                                schema:
                                    {
                                        type:
                                            'integer',

                                        minimum:
                                            1,

                                        default:
                                            1,
                                    },
                            },

                        Limit:
                            {
                                name:
                                    'limit',

                                in:
                                    'query',

                                required:
                                    false,

                                schema:
                                    {
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
                    },

                headers:
                    {
                        RequestId:
                            {
                                description:
                                    'Unique request identifier.',

                                schema:
                                    {
                                        type:
                                            'string',
                                    },
                            },

                        CorrelationId:
                            {
                                description:
                                    'Correlation identifier.',

                                schema:
                                    {
                                        type:
                                            'string',
                                    },
                            },

                        TraceId:
                            {
                                description:
                                    'Distributed tracing identifier.',

                                schema:
                                    {
                                        type:
                                            'string',
                                    },
                            },
                    },
            },

        security:
            securityRequirements,

        externalDocs:
            {
                description:
                    'TITech Community Capital API documentation',

                url:
                    env(
                        'API_DOCUMENTATION_URL',
                        'https://example.com',
                    ),
            },
    };

    /**
     * Production hardening:
     *
     * Do not advertise alternate environments from a production document unless
     * explicitly configured.
     */
    if (
        environment ===
        'production' &&
        config.security
            .productionOnlyServer
    ) {

        document.servers =
            [
                {
                    url:
                        servers[0]?.url ||
                        DEFAULTS
                            .servers
                            .production,

                    description:
                        'Production API server',
                },
            ];
    }

    return deepFreeze(
        document,
    );
}

/**
 * =============================================================================
 * Route / source configuration
 * =============================================================================
 */

function getSourceConfiguration(
    config =
        defaultConfig,
) {

    return Object.freeze({
        routePatterns:
            [
                ...config.routePatterns,
            ],

        excludePatterns:
            [
                ...config.excludePatterns,
            ],

        swaggerJsdoc:
            {
                failOnErrors:
                    true,

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
            },
    });
}

/**
 * =============================================================================
 * Documentation exposure policy
 * =============================================================================
 */

function getExposurePolicy(
    config =
        defaultConfig,
) {

    const production =
        config.environment ===
        'production';

    return deepFreeze({

        environment:
            config.environment,

        enabled:
            config.enabled,

        ui:
            {
                enabled:
                    config.uiEnabled &&
                    (
                        !production ||
                        config.publicUiInProduction
                    ),

                public:
                    !config.requireAuthentication,
            },

        json:
            {
                enabled:
                    config.jsonEnabled &&
                    (
                        !production ||
                        config.publicJsonInProduction
                    ),
            },

        yaml:
            {
                enabled:
                    config.yamlEnabled &&
                    (
                        !production ||
                        config.publicYamlInProduction
                    ),
            },

        tryItOut:
            {
                enabled:
                    config.tryItOutEnabled &&
                    (
                        !production ||
                        config.allowTryItOutInProduction
                    ),
            },

        serverSelection:
            {
                enabled:
                    !production ||
                    config.allowServerSelectionInProduction,
            },

        internalRoutes:
            {
                enabled:
                    config.exposeInternalRoutes &&
                    !production,
            },

        diagnostics:
            {
                enabled:
                    config.exposeDiagnostics &&
                    !production,
            },
    });
}

/**
 * =============================================================================
 * Swagger UI options
 * ============================================================================= */

function getUiOptions(
    config =
        defaultConfig,
) {

    const exposure =
        getExposurePolicy(
            config,
        );

    const options = {

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
            exposure.tryItOut.enabled,

        withCredentials:
            config.withCredentials,

        validatorUrl:
            config.validatorUrl || undefined,

        oauth2RedirectUrl:
            config.oauth2RedirectUrl || undefined,
    };

    return deepFreeze(
        options,
    );
}

/**
 * =============================================================================
 * Safe snapshot
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

        enabled:
            config.enabled,

        openapi:
            OPENAPI_VERSION,

        title:
            config.title,

        version:
            config.version,

        endpoints:
            {
                ui:
                    config.docsPath,

                json:
                    config.jsonPath,

                yaml:
                    config.yamlPath,
            },

        exposure,

        servers:
            createServers(
                config,
            ).map(
                server => ({
                    url:
                        server.url,

                    description:
                        server.description,
                }),
            ),

        securitySchemes:
            {
                bearer:
                    config.security
                        .bearerEnabled,

                apiKey:
                    config.security
                        .apiKeyEnabled,

                cookie:
                    config.security
                        .cookieEnabled,

                oauth2:
                    config.security
                        .oauth2Enabled,
            },

        source:
            {
                routePatternCount:
                    config.routePatterns
                        .length,

                excludePatternCount:
                    config.excludePatterns
                        .length,
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

        'API_DOCUMENTATION_URL',
        'API_PUBLIC_URL',
        'PUBLIC_API_URL',

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

        'OAUTH_AUTHORIZATION_URL',
        'OAUTH_TOKEN_URL',
    ];

    const result = {};

    for (
        const key of keys
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
 * Configuration validation
 * =============================================================================
 */

function validateSwaggerConfig(
    config,
) {

    const errors = [];
    const warnings = [];

    const production =
        config.environment ===
        'production';

    /**
     * -------------------------------------------------------------------------
     * Basic configuration.
     * -------------------------------------------------------------------------
     */

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
        !config.docsPath.startsWith('/')
    ) {

        errors.push({
            code:
                'SWAGGER_DOCS_PATH_INVALID',

            field:
                'docsPath',
        });
    }

    if (
        !config.jsonPath.startsWith('/')
    ) {

        errors.push({
            code:
                'SWAGGER_JSON_PATH_INVALID',

            field:
                'jsonPath',
        });
    }

    if (
        !config.yamlPath.startsWith('/')
    ) {

        errors.push({
            code:
                'SWAGGER_YAML_PATH_INVALID',

            field:
                'yamlPath',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Production exposure.
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.uiEnabled &&
        config.publicUiInProduction &&
        !config.requireAuthentication
    ) {

        errors.push({
            code:
                'SWAGGER_PUBLIC_UI_UNAUTHENTICATED',

            field:
                'requireAuthentication',

            message:
                'TITech production Swagger UI must not be exposed anonymously.',
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
                'Internal diagnostics must not be exposed through production API documentation.',
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

            message:
                'TITech internal routes must not be documented in the public production API surface.',
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
                'Swagger Try-It-Out is enabled in production. Protect the documentation endpoint and consider disabling interactive requests.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Authentication.
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        config.requireAuthentication &&
        !config.security.bearerEnabled &&
        !config.security.apiKeyEnabled &&
        !config.security.cookieEnabled &&
        !config.security.oauth2Enabled
    ) {

        errors.push({
            code:
                'SWAGGER_AUTH_SCHEME_MISSING',

            field:
                'security',

            message:
                'TITech documentation requires authentication but no authentication scheme is configured.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Financial API documentation safety.
     * -------------------------------------------------------------------------
     */

    if (
        config.exposeExamples &&
        !config.redactExamples
    ) {

        warnings.push({
            code:
                'SWAGGER_EXAMPLES_UNREDACTED',

            field:
                'redactExamples',

            message:
                'Examples may expose values that should not be reused in documentation.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Environment server safety.
     * -------------------------------------------------------------------------
     */

    const servers =
        createServers(
            config,
        );

    if (
        servers.length ===
        0
    ) {

        errors.push({
            code:
                'SWAGGER_SERVER_MISSING',

            field:
                'servers',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Failure.
     * -------------------------------------------------------------------------
     */

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

        if (
            startupErrors?.configurationError
        ) {

            try {

                throw startupErrors.configurationError(
                    error.message,
                    {
                        cause:
                            error,

                        critical:
                            false,

                        fatal:
                            false,

                        details:
                            error.details,
                    },
                );

            } catch (
                wrappedError
            ) {

                throw wrappedError;
            }
        }

        throw error;
    }

    const state =
        !config.enabled
            ? DOCUMENTATION_STATES.DISABLED
            : warnings.length >
                0
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
            getEnvironment(),
        );

    const config = {

        component:
            COMPONENT,

        environment,

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

        termsOfService:
            asString(
                source.termsOfService ||
                    env(
                        'SWAGGER_TERMS_URL',
                    ),
                DEFAULTS.termsOfService,
            ),

        contact:
            {
                name:
                    asString(
                        source.contact
                            ?.name ||
                        env(
                            'SWAGGER_CONTACT_NAME',
                        ),
                        DEFAULTS
                            .contact
                            .name,
                    ),

                email:
                    asString(
                        source.contact
                            ?.email ||
                        env(
                            'SWAGGER_CONTACT_EMAIL',
                        ),
                        DEFAULTS
                            .contact
                            .email,
                    ),

                url:
                    asString(
                        source.contact
                            ?.url ||
                        env(
                            'SWAGGER_CONTACT_URL',
                        ),
                        DEFAULTS
                            .contact
                            .url,
                    ),
            },

        license:
            {
                name:
                    asString(
                        source.license
                            ?.name ||
                        env(
                            'SWAGGER_LICENSE_NAME',
                        ),
                        DEFAULTS
                            .license
                            .name,
                    ),

                url:
                    asString(
                        source.license
                            ?.url ||
                        env(
                            'SWAGGER_LICENSE_URL',
                        ),
                        DEFAULTS
                            .license
                            .url,
                    ),
            },

        servers:
            {
                ...DEFAULTS.servers,
                ...(source.servers || {}),
            },

        defaultServer:
            asString(
                source.defaultServer ||
                    env(
                        'API_PUBLIC_URL',
                    ) ||
                    env(
                        'PUBLIC_API_URL',
                    ),
                DEFAULTS.defaultServer,
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
            asPositiveInteger(
                source.defaultModelsExpandDepth ??
                    env(
                        'SWAGGER_DEFAULT_MODELS_EXPAND_DEPTH',
                    ),
                DEFAULTS.defaultModelsExpandDepth,
            ),

        defaultModelExpandDepth:
            asPositiveInteger(
                source.defaultModelExpandDepth ??
                    env(
                        'SWAGGER_DEFAULT_MODEL_EXPAND_DEPTH',
                    ),
                DEFAULTS.defaultModelExpandDepth,
            ),

        displayRequestDuration:
            source.displayRequestDuration ??
            asBoolean(
                env(
                    'SWAGGER_DISPLAY_REQUEST_DURATION',
                ),
                DEFAULTS.displayRequestDuration,
            ),

        filter:
            source.filter ??
            asBoolean(
                env(
                    'SWAGGER_FILTER',
                ),
                DEFAULTS.filter,
            ),

        showExtensions:
            source.showExtensions ??
            asBoolean(
                env(
                    'SWAGGER_SHOW_EXTENSIONS',
                ),
                DEFAULTS.showExtensions,
            ),

        showCommonExtensions:
            source.showCommonExtensions ??
            asBoolean(
                env(
                    'SWAGGER_SHOW_COMMON_EXTENSIONS',
                ),
                DEFAULTS.showCommonExtensions,
            ),

        deepLinking:
            source.deepLinking ??
            asBoolean(
                env(
                    'SWAGGER_DEEP_LINKING',
                ),
                DEFAULTS.deepLinking,
            ),

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
            asBoolean(
                env(
                    'SWAGGER_WITH_CREDENTIALS',
                ),
                DEFAULTS.withCredentials,
            ),

        validatorUrl:
            asString(
                source.validatorUrl ||
                    env(
                        'SWAGGER_VALIDATOR_URL',
                    ),
                DEFAULTS.validatorUrl,
            ),

        oauth2RedirectUrl:
            asString(
                source.oauth2RedirectUrl ||
                    env(
                        'SWAGGER_OAUTH2_REDIRECT_URL',
                    ),
                DEFAULTS.oauth2RedirectUrl,
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

        requireAuthentication:
            source.requireAuthentication ??
            asBoolean(
                env(
                    'SWAGGER_REQUIRE_AUTH',
                ),
                DEFAULTS.requireAuthentication,
            ),

        allowTryItOutInProduction:
            source.allowTryItOutInProduction ??
            asBoolean(
                env(
                    'SWAGGER_ALLOW_PRODUCTION_TRY_IT_OUT',
                ),
                DEFAULTS.allowTryItOutInProduction,
            ),

        allowServerSelectionInProduction:
            source.allowServerSelectionInProduction ??
            asBoolean(
                env(
                    'SWAGGER_ALLOW_SERVER_SELECTION_PRODUCTION',
                ),
                DEFAULTS.allowServerSelectionInProduction,
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
            asBoolean(
                env(
                    'SWAGGER_EXPOSE_EXAMPLES',
                ),
                DEFAULTS.exposeExamples,
            ),

        redactExamples:
            source.redactExamples ??
            asBoolean(
                env(
                    'SWAGGER_REDACT_EXAMPLES',
                ),
                DEFAULTS.redactExamples,
            ),

        security:
            {
                bearerEnabled:
                    source.security
                        ?.bearerEnabled ??
                    asBoolean(
                        env(
                            'SWAGGER_BEARER_ENABLED',
                        ),
                        DEFAULTS
                            .security
                            .bearerEnabled,
                    ),

                apiKeyEnabled:
                    source.security
                        ?.apiKeyEnabled ??
                    asBoolean(
                        env(
                            'SWAGGER_API_KEY_ENABLED',
                        ),
                        DEFAULTS
                            .security
                            .apiKeyEnabled,
                    ),

                cookieEnabled:
                    source.security
                        ?.cookieEnabled ??
                    asBoolean(
                        env(
                            'SWAGGER_COOKIE_ENABLED',
                        ),
                        DEFAULTS
                            .security
                            .cookieEnabled,
                    ),

                oauth2Enabled:
                    source.security
                        ?.oauth2Enabled ??
                    asBoolean(
                        env(
                            'SWAGGER_OAUTH2_ENABLED',
                        ),
                        DEFAULTS
                            .security
                            .oauth2Enabled,
                    ),

                productionOnlyServer:
                    source.security
                        ?.productionOnlyServer ??
                    true,
            },

        schemas:
            {
                strict:
                    source.schemas
                        ?.strict ??
                    DEFAULTS.schemas.strict,

                nullable:
                    source.schemas
                        ?.nullable ??
                    DEFAULTS.schemas.nullable,

                additionalProperties:
                    source.schemas
                        ?.additionalProperties ??
                    DEFAULTS.schemas
                        .additionalProperties,
            },

        responses:
            {
                includeRequestId:
                    source.responses
                        ?.includeRequestId ??
                    DEFAULTS
                        .responses
                        .includeRequestId,

                includeCorrelationId:
                    source.responses
                        ?.includeCorrelationId ??
                    DEFAULTS
                        .responses
                        .includeCorrelationId,

                includeTraceId:
                    source.responses
                        ?.includeTraceId ??
                    DEFAULTS
                        .responses
                        .includeTraceId,

                includeTimestamp:
                    source.responses
                        ?.includeTimestamp ??
                    DEFAULTS
                        .responses
                        .includeTimestamp,
            },

        cache:
            {
                enabled:
                    source.cache
                        ?.enabled ??
                    asBoolean(
                        env(
                            'SWAGGER_CACHE_ENABLED',
                        ),
                        DEFAULTS
                            .cache
                            .enabled,
                    ),

                maxAgeSeconds:
                    asPositiveInteger(
                        source.cache
                            ?.maxAgeSeconds ??
                            env(
                                'SWAGGER_CACHE_MAX_AGE_SECONDS',
                            ),
                        DEFAULTS
                            .cache
                            .maxAgeSeconds,
                    ),
            },

        metadata:
            {
                organization:
                    asString(
                        source.metadata
                            ?.organization,
                        DEFAULTS
                            .metadata
                            .organization,
                    ),

                platform:
                    asString(
                        source.metadata
                            ?.platform,
                        DEFAULTS
                            .metadata
                            .platform,
                    ),

                vendor:
                    asString(
                        source.metadata
                            ?.vendor,
                        DEFAULTS
                            .metadata
                            .vendor,
                    ),

                environment,
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

const defaultConfig =
    createSwaggerConfig();

/**
 * =============================================================================
 * Bootstrap lifecycle compatibility
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {},
) {

    const config =
        options.config
            ? createSwaggerConfig(
                options.config,
            )
            : defaultConfig;

    if (
        context &&
        typeof context === 'object'
    ) {

        context.swagger =
            config;

        context.swaggerConfig =
            config;
    }

    return config;
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
 */

module.exports =
    Object.freeze({

        /**
         * Core configuration.
         */
        config:
            defaultConfig,

        swagger:
            defaultConfig,

        DEFAULTS,

        OPENAPI_VERSION,

        DOCUMENTATION_STATES,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * Configuration.
         */
        createSwaggerConfig,

        validateSwaggerConfig,

        /**
         * OpenAPI generation.
         */
        createOpenApiDocument,

        createCommonSchemas,

        createSecuritySchemes,

        createCommonResponses,

        getSourceConfiguration,

        /**
         * UI/exposure.
         */
        getExposurePolicy,

        getUiOptions,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getEnvironmentOverrides,

        /**
         * Lifecycle compatibility.
         */
        initialize,

        start,

        bootstrap,
    });