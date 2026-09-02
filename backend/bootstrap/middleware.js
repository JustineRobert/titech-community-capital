"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/middleware.js
 *
 * Purpose:
 *   Centralized enterprise-grade HTTP middleware configuration.
 *
 * Responsibilities:
 *
 *   SECURITY
 *   ---------------------------------------------------------------------------
 *   - Helmet security headers
 *   - Strict CORS
 *   - HTTP parameter pollution protection
 *   - MongoDB query sanitization
 *   - XSS defense-in-depth
 *   - Request-size protection
 *   - Cache-control protection
 *   - Reverse-proxy awareness
 *
 *   OBSERVABILITY
 *   ---------------------------------------------------------------------------
 *   - Request ID
 *   - Correlation ID
 *   - Transaction ID
 *   - Device ID
 *   - Tenant context
 *   - Client metadata
 *   - Response timing
 *   - HTTP access logging
 *
 *   FINANCIAL SAFETY
 *   ---------------------------------------------------------------------------
 *   - Idempotency-Key extraction
 *   - Transaction context
 *   - Request identity
 *   - Financial-operation metadata
 *
 *   IMPORTANT:
 *
 *   This middleware DOES NOT perform:
 *
 *   - Authentication
 *   - Authorization
 *   - Tenant authorization
 *   - Financial balance validation
 *   - Ledger mutation
 *   - Idempotency persistence
 *   - Exactly-once transaction guarantees
 *   - Database transactions
 *   - Audit-log persistence
 *
 *   Those responsibilities belong to dedicated services/middleware.
 *
 * =============================================================================
 */

const crypto = require("crypto");
const morgan = require("morgan");

const {
    dependencies
} = require("./dependencies");

const configuration =
    require("../config");

// =============================================================================
// Dependency Resolution
// =============================================================================

const {
    express,
    helmet,
    cors,
    cookieParser,
    compression,
    responseTime,
    timeout,
    rateLimit,
    hpp,
    mongoSanitize,
    xss
} = dependencies;

// =============================================================================
// Runtime Configuration
// =============================================================================

const environment =
    configuration.environment ||
    process.env.NODE_ENV ||
    "development";

const isProduction =
    environment === "production";

const isTest =
    environment === "test";

const bodyLimit =
    configuration.bodyLimit ||
    process.env.BODY_LIMIT ||
    "1mb";

const requestTimeout =
    configuration.requestTimeout ||
    process.env.REQUEST_TIMEOUT ||
    "30s";

const trustProxy =
    configuration.trustProxy ??
    (
        isProduction
            ? 1
            : false
    );

const corsCredentials =
    configuration.corsCredentials !== false;

// =============================================================================
// Security Limits
// =============================================================================

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_TENANT_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_CLIENT_VERSION_LENGTH = 64;
const MAX_CLIENT_PLATFORM_LENGTH = 32;

// =============================================================================
// Generic Validation Patterns
// =============================================================================

const SAFE_ID_PATTERN =
    /^[a-zA-Z0-9._:-]{8,128}$/;

const SAFE_IDEMPOTENCY_PATTERN =
    /^[a-zA-Z0-9._:/+=@-]{8,256}$/;

const SAFE_TENANT_PATTERN =
    /^[a-zA-Z0-9._:-]{1,128}$/;

// =============================================================================
// Utility Helpers
// =============================================================================

function normalizeString(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    return String(value)
        .trim();
}

function normalizeOrigin(
    origin
) {
    const value =
        normalizeString(origin);

    if (!value) {
        return null;
    }

    return value.replace(
        /\/+$/,
        ""
    );
}

function getHeader(
    request,
    name
) {
    if (
        !request ||
        !request.headers
    ) {
        return null;
    }

    return normalizeString(
        request.headers[
            name.toLowerCase()
        ]
    );
}

// =============================================================================
// CORS Origin Configuration
// =============================================================================

function getAllowedOrigins() {

    const configuredValues = [

        configuration.frontendUrl,

        process.env.FRONTEND_URL,

        process.env.FRONTEND_URLS

    ]
        .filter(Boolean)
        .flatMap(
            value =>
                String(value)
                    .split(",")
        )
        .map(
            normalizeOrigin
        )
        .filter(Boolean);

    const developmentOrigins =
        isProduction
            ? []
            : [

                "http://localhost:3000",

                "http://127.0.0.1:3000",

                "http://localhost:3001",

                "http://127.0.0.1:3001",

                "http://localhost:5173",

                "http://127.0.0.1:5173"

            ];

    return [
        ...new Set([
            ...configuredValues,
            ...developmentOrigins
        ])
    ];
}

const allowedOrigins =
    getAllowedOrigins();

// =============================================================================
// Request ID
// =============================================================================

function sanitizeRequestId(
    value
) {

    const normalized =
        normalizeString(value);

    if (!normalized) {
        return null;
    }

    if (
        normalized.length >
        MAX_REQUEST_ID_LENGTH
    ) {
        return null;
    }

    if (
        !SAFE_ID_PATTERN.test(
            normalized
        )
    ) {
        return null;
    }

    return normalized;
}

function generateRequestId() {

    if (
        typeof crypto.randomUUID ===
        "function"
    ) {
        return crypto.randomUUID();
    }

    return crypto
        .randomBytes(16)
        .toString("hex");
}

function getOrCreateRequestId(
    request
) {

    return (
        sanitizeRequestId(
            getHeader(
                request,
                "x-request-id"
            )
        ) ||
        generateRequestId()
    );
}

// =============================================================================
// Correlation ID
// =============================================================================

function getOrCreateCorrelationId(
    request
) {

    return (
        sanitizeRequestId(
            getHeader(
                request,
                "x-correlation-id"
            )
        ) ||
        generateRequestId()
    );
}

// =============================================================================
// Device ID
// =============================================================================

function sanitizeDeviceId(
    value
) {

    const normalized =
        normalizeString(value);

    if (!normalized) {
        return null;
    }

    if (
        normalized.length >
        MAX_DEVICE_ID_LENGTH
    ) {
        return null;
    }

    if (
        !SAFE_ID_PATTERN.test(
            normalized
        )
    ) {
        return null;
    }

    return normalized;
}

// =============================================================================
// Transaction ID
// =============================================================================

function getTransactionId(
    request
) {

    const value =
        getHeader(
            request,
            "x-transaction-id"
        );

    if (!value) {
        return null;
    }

    if (
        value.length >
        MAX_TRANSACTION_ID_LENGTH
    ) {
        return null;
    }

    return sanitizeRequestId(
        value
    );
}

// =============================================================================
// Tenant Context
// =============================================================================

function getTenantId(
    request
) {

    const value =
        getHeader(
            request,
            "x-tenant-id"
        );

    if (!value) {
        return null;
    }

    if (
        value.length >
        MAX_TENANT_ID_LENGTH
    ) {
        return null;
    }

    if (
        !SAFE_TENANT_PATTERN.test(
            value
        )
    ) {
        return null;
    }

    return value;
}

// =============================================================================
// Idempotency Key
// =============================================================================
//
// IMPORTANT:
//
// This function ONLY extracts and validates the syntactic representation.
//
// It does NOT provide exactly-once semantics.
//
// Exactly-once financial operation protection requires:
//
//   Idempotency-Key
//        ↓
//   authenticated principal
//        ↓
//   tenant
//        ↓
//   request fingerprint
//        ↓
//   atomic persistence
//        ↓
//   database transaction
//        ↓
//   original response replay
//
// That belongs in the financial transaction boundary.
// =============================================================================

function getIdempotencyKey(
    request
) {

    const value =
        getHeader(
            request,
            "idempotency-key"
        );

    if (!value) {
        return null;
    }

    if (
        value.length >
        MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
        return null;
    }

    if (
        !SAFE_IDEMPOTENCY_PATTERN.test(
            value
        )
    ) {
        return null;
    }

    return value;
}

// =============================================================================
// Client Metadata
// =============================================================================

function getClientMetadata(
    request
) {

    const version =
        getHeader(
            request,
            "x-client-version"
        );

    const platform =
        getHeader(
            request,
            "x-client-platform"
        );

    return {

        version:
            version
                ? version.slice(
                    0,
                    MAX_CLIENT_VERSION_LENGTH
                )
                : null,

        platform:
            platform
                ? platform.slice(
                    0,
                    MAX_CLIENT_PLATFORM_LENGTH
                )
                : null

    };
}

// =============================================================================
// Request Context Middleware
// =============================================================================

function requestContextMiddleware(
    req,
    res,
    next
) {

    const requestId =
        getOrCreateRequestId(
            req
        );

    const correlationId =
        getOrCreateCorrelationId(
            req
        );

    const deviceId =
        sanitizeDeviceId(
            getHeader(
                req,
                "x-device-id"
            )
        );

    const tenantId =
        getTenantId(req);

    const transactionId =
        getTransactionId(req);

    const idempotencyKey =
        getIdempotencyKey(req);

    const client =
        getClientMetadata(req);

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

    req.deviceId =
        deviceId;

    req.tenantId =
        tenantId;

    req.transactionId =
        transactionId;

    req.idempotencyKey =
        idempotencyKey;

    req.clientContext =
        client;

    req.requestStartedAt =
        Date.now();

    req.context = {

        requestId,

        correlationId,

        transactionId,

        tenantId,

        deviceId,

        idempotencyKey,

        client,

        startedAt:
            req.requestStartedAt

    };

    res.setHeader(
        "X-Request-Id",
        requestId
    );

    res.setHeader(
        "X-Correlation-Id",
        correlationId
    );

    if (transactionId) {

        res.setHeader(
            "X-Transaction-Id",
            transactionId
        );
    }

    next();
}

// =============================================================================
// Helmet
// =============================================================================

function registerHelmet(
    app
) {

    if (!helmet) {
        return;
    }

    app.use(
        helmet({

            contentSecurityPolicy:
                false,

            crossOriginEmbedderPolicy:
                false,

            crossOriginOpenerPolicy:
                {
                    policy:
                        "same-origin"
                },

            crossOriginResourcePolicy:
                {
                    policy:
                        "cross-origin"
                },

            dnsPrefetchControl:
                {
                    allow:
                        false
                },

            frameguard:
                {
                    action:
                        "deny"
                },

            hidePoweredBy:
                true,

            hsts:
                isProduction
                    ? {
                        maxAge:
                            31536000,
                        includeSubDomains:
                            true,
                        preload:
                            true
                    }
                    : false,

            noSniff:
                true,

            permittedCrossDomainPolicies:
                {
                    permittedPolicies:
                        "none"
                },

            referrerPolicy:
                {
                    policy:
                        "strict-origin-when-cross-origin"
                },

            xssFilter:
                false

        })
    );
}

// =============================================================================
// CORS
// =============================================================================

function registerCors(
    app
) {

    if (!cors) {
        return;
    }

    app.use(
        cors({

            origin:
                (origin, callback) => {

                    /*
                     * Requests without Origin may be:
                     *
                     * - mobile applications
                     * - server-to-server requests
                     * - health checks
                     * - command-line clients
                     */

                    if (!origin) {

                        callback(
                            null,
                            true
                        );

                        return;
                    }

                    const normalized =
                        normalizeOrigin(
                            origin
                        );

                    if (
                        allowedOrigins.includes(
                            normalized
                        )
                    ) {

                        callback(
                            null,
                            true
                        );

                        return;
                    }

                    callback(
                        new Error(
                            "CORS origin is not allowed."
                        )
                    );
                },

            credentials:
                corsCredentials,

            methods: [

                "GET",
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
                "OPTIONS"

            ],

            allowedHeaders: [

                "Accept",

                "Content-Type",

                "Authorization",

                "X-Requested-With",

                "X-Request-Id",

                "X-Correlation-Id",

                "X-Transaction-Id",

                "X-Tenant-Id",

                "X-Device-Id",

                "X-Client-Version",

                "X-Client-Platform",

                "Idempotency-Key",

                "Cache-Control",

                "Pragma"

            ],

            exposedHeaders: [

                "X-Request-Id",

                "X-Correlation-Id",

                "X-Transaction-Id",

                "X-Response-Time",

                "Retry-After"

            ],

            preflightContinue:
                false,

            optionsSuccessStatus:
                204,

            maxAge:
                isProduction
                    ? 86400
                    : 300

        })
    );
}

// =============================================================================
// Response Security Headers
// =============================================================================

function registerResponseSecurity(
    app
) {

    app.use(
        (req, res, next) => {

            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );

            res.setHeader(
                "X-Frame-Options",
                "DENY"
            );

            res.setHeader(
                "Referrer-Policy",
                "strict-origin-when-cross-origin"
            );

            /*
             * APIs generally should not be cached unless an endpoint
             * explicitly opts into caching.
             */

            if (
                req.headers.authorization ||
                req.headers.cookie
            ) {

                res.setHeader(
                    "Cache-Control",
                    "no-store"
                );

                res.setHeader(
                    "Pragma",
                    "no-cache"
                );
            }

            next();
        }
    );
}

// =============================================================================
// Compression
// =============================================================================

function registerCompression(
    app
) {

    if (!compression) {
        return;
    }

    app.use(
        compression({

            threshold:
                1024,

            level:
                isProduction
                    ? 6
                    : 4

        })
    );
}

// =============================================================================
// Response Timing
// =============================================================================

function registerResponseTiming(
    app
) {

    if (!responseTime) {
        return;
    }

    app.use(
        responseTime(
            (req, res, time) => {

                res.setHeader(
                    "X-Response-Time",
                    `${Math.round(time)}ms`
                );

            }
        )
    );
}

// =============================================================================
// Access Logging
// =============================================================================

function registerAccessLogging(
    app
) {

    const stream = {

        write(message) {

            const line =
                String(message)
                    .trim();

            if (!line) {
                return;
            }

            if (isProduction) {

                console.info(
                    `[HTTP] ${line}`
                );

                return;
            }

            console.log(line);
        }

    };

    app.use(
        morgan(

            isProduction
                ? "combined"
                : "dev",

            {
                stream
            }

        )
    );
}

// =============================================================================
// Request Rate Limiting
// =============================================================================

function registerRateLimiting(
    app
) {

    if (
        !rateLimit ||
        isTest
    ) {
        return;
    }

    const configuredWindow =
        Number(
            process.env.RATE_LIMIT_WINDOW_MS
        );

    const configuredMax =
        Number(
            process.env.RATE_LIMIT_MAX
        );

    const windowMs =
        Number.isFinite(
            configuredWindow
        ) &&
        configuredWindow > 0
            ? configuredWindow
            : 15 * 60 * 1000;

    const max =
        Number.isFinite(
            configuredMax
        ) &&
        configuredMax > 0
            ? configuredMax
            : (
                isProduction
                    ? 1000
                    : 5000
            );

    app.use(
        rateLimit({

            windowMs,

            max,

            standardHeaders:
                "draft-8",

            legacyHeaders:
                false,

            message: {

                success:
                    false,

                code:
                    "RATE_LIMIT_EXCEEDED",

                message:
                    "Too many requests. Please try again later."

            },

            skip:
                req => {

                    const path =
                        req.path ||
                        "";

                    return (

                        path === "/health" ||

                        path === "/ready" ||

                        path === "/live" ||

                        path === "/health/live" ||

                        path === "/health/ready"

                    );
                }

        })
    );
}

// =============================================================================
// Request Timeout
// =============================================================================

function registerTimeout(
    app
) {

    if (!timeout) {
        return;
    }

    app.use(
        timeout(
            requestTimeout
        )
    );

    /*
     * connect-timeout can mark the request as timed out while downstream
     * middleware continues unless the chain is explicitly halted.
     */

    app.use(
        (req, res, next) => {

            if (
                !req.timedout
            ) {
                next();
                return;
            }

            if (
                res.headersSent
            ) {
                return;
            }

            res.status(408)
                .json({

                    success:
                        false,

                    code:
                        "REQUEST_TIMEOUT",

                    message:
                        "The request exceeded the permitted processing time.",

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId

                });
        }
    );
}

// =============================================================================
// Body Parsers
// =============================================================================

function registerBodyParsers(
    app
) {

    if (!express) {
        throw new Error(
            "Express dependency is unavailable."
        );
    }

    app.use(
        express.json({

            limit:
                bodyLimit,

            strict:
                true,

            type:
                [
                    "application/json",
                    "application/*+json"
                ]

        })
    );

    app.use(
        express.urlencoded({

            extended:
                false,

            limit:
                bodyLimit,

            parameterLimit:
                100

        })
    );
}

// =============================================================================
// Cookie Parser
// =============================================================================

function registerCookieParser(
    app
) {

    if (!cookieParser) {
        return;
    }

    app.use(
        cookieParser()
    );
}

// =============================================================================
// HTTP Parameter Pollution Protection
// =============================================================================

function registerHpp(
    app
) {

    if (!hpp) {
        return;
    }

    app.use(
        hpp({

            /*
             * Only these parameters are intentionally allowed to occur
             * multiple times.
             *
             * Business/financial fields should NOT be placed here.
             */

            whitelist: [

                "sort",

                "fields",

                "include"

            ]

        })
    );
}

// =============================================================================
// MongoDB Query Sanitization
// =============================================================================

function registerMongoSanitize(
    app
) {

    if (!mongoSanitize) {
        return;
    }

    /*
     * Do not allow MongoDB operator injection through request bodies,
     * query parameters or URL parameters.
     */

    app.use(
        mongoSanitize({

            allowDots:
                false,

            replaceWith:
                "_"

        })
    );
}

// =============================================================================
// XSS Defense-in-Depth
// =============================================================================
//
// NOTE:
//
// The preferred strategy is:
//   - schema validation
//   - output encoding
//   - contextual escaping
//   - CSP where applicable
//
// xss-clean/xss middleware should not be treated as the primary XSS defense.
//
// It is retained here only when supplied by the dependency layer.
// =============================================================================

function registerXssProtection(
    app
) {

    if (!xss) {
        return;
    }

    app.use(
        xss()
    );
}

// =============================================================================
// Financial Request Metadata
// =============================================================================

function registerFinancialMetadata(
    app
) {

    app.use(
        (req, res, next) => {

            const method =
                String(
                    req.method ||
                    ""
                ).toUpperCase();

            const financialMethod =
                method === "POST" ||
                method === "PUT" ||
                method === "PATCH";

            req.financialContext = {

                method,

                isMutation:
                    financialMethod,

                idempotencyKey:
                    req.idempotencyKey ||
                    null,

                transactionId:
                    req.transactionId ||
                    null,

                tenantId:
                    req.tenantId ||
                    null,

                deviceId:
                    req.deviceId ||
                    null,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId

            };

            next();
        }
    );
}

// =============================================================================
// Transport Safety
// =============================================================================

function registerTransportSafety(
    app
) {

    app.use(
        (req, res, next) => {

            /*
             * Financial/authenticated requests must never be cached by
             * intermediaries unless an explicit route overrides this.
             */

            if (
                req.headers.authorization ||
                req.headers.cookie ||
                req.idempotencyKey ||
                req.transactionId
            ) {

                res.setHeader(
                    "Cache-Control",
                    "no-store"
                );

                res.setHeader(
                    "Pragma",
                    "no-cache"
                );

                res.setHeader(
                    "Expires",
                    "0"
                );
            }

            next();
        }
    );
}

// =============================================================================
// Request Metadata
// =============================================================================

function registerRequestMetadata(
    app
) {

    /*
     * This MUST execute before:
     *
     * - logging
     * - rate limiting
     * - route handlers
     *
     * so downstream components have stable request identity.
     */

    app.use(
        requestContextMiddleware
    );
}

// =============================================================================
// Middleware Registration
// =============================================================================

function registerMiddleware(
    app
) {

    if (!app) {
        throw new Error(
            "Express application instance is required."
        );
    }

    if (!express) {
        throw new Error(
            "Express dependency is unavailable."
        );
    }

    // =========================================================================
    // Express Application Hardening
    // =========================================================================

    app.disable(
        "x-powered-by"
    );

    app.set(
        "trust proxy",
        trustProxy
    );

    // =========================================================================
    // Request Identity
    // =========================================================================

    registerRequestMetadata(
        app
    );

    // =========================================================================
    // Security
    // =========================================================================

    registerHelmet(
        app
    );

    registerCors(
        app
    );

    registerResponseSecurity(
        app
    );

    // =========================================================================
    // Transport / Observability
    // =========================================================================

    registerCompression(
        app
    );

    registerResponseTiming(
        app
    );

    registerAccessLogging(
        app
    );

    // =========================================================================
    // Protection
    // =========================================================================

    registerRateLimiting(
        app
    );

    registerTimeout(
        app
    );

    // =========================================================================
    // Request Parsing
    // =========================================================================

    registerBodyParsers(
        app
    );

    registerCookieParser(
        app
    );

    // =========================================================================
    // Input Hardening
    // =========================================================================

    registerHpp(
        app
    );

    registerMongoSanitize(
        app
    );

    registerXssProtection(
        app
    );

    // =========================================================================
    // Application Context
    // =========================================================================

    registerFinancialMetadata(
        app
    );

    // =========================================================================
    // Transport / Cache Safety
    // =========================================================================

    registerTransportSafety(
        app
    );

    return app;
}

// =============================================================================
// Middleware Diagnostics
// =============================================================================

function getMiddlewareDiagnostics() {

    return {

        environment,

        production:
            isProduction,

        test:
            isTest,

        bodyLimit,

        requestTimeout,

        trustProxy,

        corsCredentials,

        allowedOrigins: [
            ...allowedOrigins
        ],

        security: {

            helmet:
                Boolean(helmet),

            hpp:
                Boolean(hpp),

            mongoSanitize:
                Boolean(mongoSanitize),

            xss:
                Boolean(xss)

        },

        observability: {

            morgan:
                Boolean(morgan),

            responseTime:
                Boolean(responseTime),

            requestIdentity:
                true,

            correlationTracing:
                true,

            transactionTracing:
                true

        },

        protection: {

            compression:
                Boolean(compression),

            rateLimit:
                Boolean(rateLimit),

            timeout:
                Boolean(timeout),

            requestSizeLimit:
                Boolean(bodyLimit),

            parameterPollutionProtection:
                Boolean(hpp),

            mongoInjectionProtection:
                Boolean(mongoSanitize)

        },

        financialSafety: {

            idempotencyMetadata:
                true,

            transactionMetadata:
                true,

            exactlyOnceGuarantee:
                false,

            persistenceBoundary:
                "financial-transaction-service",

            authorizationBoundary:
                "authentication-and-authorization-layer"

        }

    };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    registerMiddleware,

    getMiddlewareDiagnostics,

    getAllowedOrigins,

    requestContextMiddleware,

    sanitizeRequestId,

    sanitizeDeviceId,

    getTransactionId,

    getTenantId,

    getIdempotencyKey

};