'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/compression.js
 *
 * Enterprise Compression Middleware
 *
 * =============================================================================
 */


/**
 * ============================================================================
 * Node.js Core Dependencies
 * ============================================================================
 */

const os = require('os');

const zlib = require('zlib');

const compression = require('compression');



/**
 * ============================================================================
 * Component Identity
 * ============================================================================
 */

const COMPONENT_NAME =
    'enterprise-compression';


const COMPONENT_VERSION =
    '1.0.0';


const COMPONENT_OWNER =
    'TITech Community Capital LTD';



/**
 * ============================================================================
 * Runtime Metadata
 * ============================================================================
 */

const RUNTIME_METADATA = Object.freeze({

    service:
        COMPONENT_NAME,

    version:
        COMPONENT_VERSION,

    hostname:
        os.hostname(),

    processId:
        process.pid

});



/**
 * ============================================================================
 * Enterprise Dependency Loader
 * ============================================================================
 *
 * Optional dependencies are loaded safely.
 *
 * Middleware remains bootable during:
 *
 * - unit tests
 * - isolated development
 * - partial service startup
 *
 * Production diagnostics expose missing dependencies.
 *
 * ============================================================================
 */

function loadOptionalDependency(path) {

    try {

        return require(path);

    }

    catch (error) {

        return Object.freeze({

            unavailable: true,

            module: path,

            reason:
                error.message

        });

    }

}



/**
 * ============================================================================
 * Enterprise Dependencies
 * ============================================================================
 */

const ConfigurationProvider =

    loadOptionalDependency(

        '../../config/ConfigurationProvider'

    );



const LoggerFactory =

    loadOptionalDependency(

        '../../shared/logging/LoggerFactory'

    );



const StructuredLogger =

    loadOptionalDependency(

        '../../shared/logging/StructuredLogger'

    );



const MetricsRegistry =

    loadOptionalDependency(

        '../../shared/metrics/MetricsRegistry'

    );



const RequestMetrics =

    loadOptionalDependency(

        '../../shared/metrics/RequestMetrics'

    );



const EventBus =

    loadOptionalDependency(

        '../../shared/events/EventBus'

    );



const TraceContext =

    loadOptionalDependency(

        '../../shared/tracing/TraceContext'

    );





/**
 * ============================================================================
 * Compression Constants
 * ============================================================================
 */


/**
 * Supported compression algorithms.
 */
const COMPRESSION_ALGORITHMS = Object.freeze({

    BROTLI:

        'br',


    GZIP:

        'gzip',


    DEFLATE:

        'deflate'

});



/**
 * Default compression configuration.
 */
const DEFAULT_CONFIGURATION = Object.freeze({

    enabled:
        true,


    algorithm:
        COMPRESSION_ALGORITHMS.BROTLI,


    threshold:
        1024,


    gzipLevel:
        zlib.constants.Z_DEFAULT_COMPRESSION,


    brotliQuality:

        zlib.constants.BROTLI_PARAM_QUALITY,


    enableBrotli:
        true,


    enableGzip:
        true,


    minimumSize:
        1024,


    honorNoTransform:
        true,


    excludedRoutes:

        Object.freeze([

            '/health',

            '/healthz',

            '/metrics',

            '/socket.io'

        ]),


    compressibleMimeTypes:

        Object.freeze([

            'text/html',

            'text/plain',

            'text/css',

            'application/json',

            'application/javascript',

            'application/xml',

            'application/problem+json'

        ])

});



/**
 * ============================================================================
 * Middleware Constants
 * ============================================================================
 */

const COMPONENT_METADATA = Object.freeze({

    name:
        COMPONENT_NAME,

    version:
        COMPONENT_VERSION,

    owner:
        COMPONENT_OWNER,

    category:
        'performance',

    phase:
        'middleware',

    priority:
        300,

    critical:
        false,

    description:

        'Enterprise HTTP response compression middleware.',


    supportedAlgorithms:

        Object.values(

            COMPRESSION_ALGORITHMS

        )

});



/**
 * ============================================================================
 * Dependency Diagnostics
 * ============================================================================
 */

const DEPENDENCY_STATUS = Object.freeze({

    ConfigurationProvider:

        !ConfigurationProvider.unavailable,


    LoggerFactory:

        !LoggerFactory.unavailable,


    StructuredLogger:

        !StructuredLogger.unavailable,


    MetricsRegistry:

        !MetricsRegistry.unavailable,


    RequestMetrics:

        !RequestMetrics.unavailable,


    EventBus:

        !EventBus.unavailable,


    TraceContext:

        !TraceContext.unavailable

});

/**
 * ============================================================================
 * Enterprise Constants
 * ============================================================================
 */

const COMPONENT_NAME =
    'compression';

const COMPONENT_VERSION =
    '1.0.0';

const SERVICE_NAME =
    'titech-community-capital';

const DEFAULT_THRESHOLD =
    1024; // 1 KB

const DEFAULT_GZIP_LEVEL =
    zlib.constants.Z_DEFAULT_COMPRESSION;

const DEFAULT_BROTLI_QUALITY =
    5;

const DEFAULT_MEM_LEVEL =
    8;

const DEFAULT_WINDOW_BITS =
    15;

/**
 * Compression algorithms
 */
const COMPRESSION_ALGORITHMS =
    Object.freeze({

        BROTLI: 'br',

        GZIP: 'gzip',

        DEFLATE: 'deflate',

        IDENTITY: 'identity'

    });

/**
 * Compression strategies
 */
const COMPRESSION_STRATEGIES =
    Object.freeze({

        DEFAULT:
            zlib.constants.Z_DEFAULT_STRATEGY,

        FILTERED:
            zlib.constants.Z_FILTERED,

        HUFFMAN:
            zlib.constants.Z_HUFFMAN_ONLY,

        RLE:
            zlib.constants.Z_RLE

    });

/**
 * MIME types suitable for compression.
 */
const COMPRESSIBLE_TYPES =
    Object.freeze([

        'application/json',

        'application/problem+json',

        'application/javascript',

        'application/xml',

        'application/xhtml+xml',

        'application/rss+xml',

        'application/atom+xml',

        'application/manifest+json',

        'application/vnd.api+json',

        'application/graphql',

        'application/x-javascript',

        'application/x-www-form-urlencoded',

        'application/octet-stream',

        'text/plain',

        'text/html',

        'text/css',

        'text/javascript',

        'text/xml',

        'text/csv',

        'image/svg+xml'

    ]);

/**
 * MIME types that should never be compressed.
 */
const NON_COMPRESSIBLE_TYPES =
    Object.freeze([

        'image/jpeg',

        'image/png',

        'image/gif',

        'image/webp',

        'image/avif',

        'video/mp4',

        'video/webm',

        'video/mpeg',

        'audio/mpeg',

        'audio/ogg',

        'application/zip',

        'application/gzip',

        'application/x-gzip',

        'application/x-7z-compressed',

        'application/x-rar-compressed',

        'application/pdf',

        'application/vnd.ms-excel',

        'application/vnd.openxmlformats-officedocument',

        'application/x-bzip2'

    ]);

/**
 * Routes typically excluded from compression.
 */
const DEFAULT_EXCLUDED_ROUTES =
    Object.freeze([

        '/health',

        '/healthz',

        '/ready',

        '/live',

        '/metrics'

    ]);

/**
 * Cache-Control directives that prohibit transformation.
 */
const NO_TRANSFORM_DIRECTIVES =
    Object.freeze([

        'no-transform'

    ]);

/**
 * Enterprise defaults.
 */
const DEFAULT_CONFIGURATION =
    Object.freeze({

        enabled: true,

        algorithm:
            COMPRESSION_ALGORITHMS.BROTLI,

        threshold:
            DEFAULT_THRESHOLD,

        gzipLevel:
            DEFAULT_GZIP_LEVEL,

        brotliQuality:
            DEFAULT_BROTLI_QUALITY,

        memoryLevel:
            DEFAULT_MEM_LEVEL,

        windowBits:
            DEFAULT_WINDOW_BITS,

        strategy:
            COMPRESSION_STRATEGIES.DEFAULT,

        removeContentLength:
            true,

        honorNoTransform:
            true,

        trustProxy:
            true,

        excludedRoutes:
            DEFAULT_EXCLUDED_ROUTES,

        compressibleTypes:
            COMPRESSIBLE_TYPES,

        nonCompressibleTypes:
            NON_COMPRESSIBLE_TYPES

    });

/**
 * Runtime diagnostics.
 *
 * Internal mutable state is intentionally isolated and will be exposed through
 * immutable diagnostic snapshots.
 * 
 * 
 * const INTERNAL_STATE = {

    initialized: false,

    initializedAt: null,

    hostname: os.hostname(),

    processId: process.pid,

    middlewareVersion: COMPONENT_VERSION

};
 * 
 */

const INTERNAL_STATE = Object.seal({

    /**
     * -------------------------------------------------------------------------
     * Runtime Initialization
     * -------------------------------------------------------------------------
     */
    initialized: false,

    initializedAt: null,

    /**
     * -------------------------------------------------------------------------
     * Health & Readiness
     * -------------------------------------------------------------------------
     */
    lastHealthCheck: null,

    lastReadinessCheck: null,

    /**
     * -------------------------------------------------------------------------
     * Configuration
     * -------------------------------------------------------------------------
     */
    configurationHash: null,

    configurationLoadedAt: null,

    /**
     * -------------------------------------------------------------------------
     * Runtime Environment
     * -------------------------------------------------------------------------
     */
    hostname: os.hostname(),

    processId: process.pid,

    nodeVersion: process.version,

    platform: process.platform,

    architecture: process.arch,

    /**
     * -------------------------------------------------------------------------
     * Middleware Information
     * -------------------------------------------------------------------------
     */
    middlewareName: COMPONENT_NAME,

    middlewareVersion: COMPONENT_VERSION,

    /**
     * -------------------------------------------------------------------------
     * Runtime Statistics
     * -------------------------------------------------------------------------
     */
    requestsProcessed: 0,

    responsesCompressed: 0,

    compressionFailures: 0,

    totalBytesSaved: 0,

    /**
     * -------------------------------------------------------------------------
     * Observability
     * -------------------------------------------------------------------------
     */
    observabilityInitialized: false,

    diagnosticsEnabled: true,

    lastDiagnosticsSnapshot: null

});



/**
 * Exported immutable metadata.
 */
const METADATA = Object.freeze({

    name: COMPONENT_NAME,

    version: COMPONENT_VERSION,

    category: 'performance',

    phase: 'middleware',

    priority: 30,

    critical: false,

    description:
        'Enterprise HTTP response compression middleware.',

    supportedAlgorithms:

        Object.values(

            COMPRESSION_ALGORITHMS

        )

});



/**
 * ============================================================================
 * Enterprise Module Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    /**
     * Middleware factory
     */
    createCompressionMiddleware,


    /**
     * Middleware metadata
     */
    metadata:

        METADATA,


    /**
     * Diagnostics
     */
    healthCheck,

    readinessCheck,

    diagnostics,


    /**
     * Configuration snapshot
     */
    configurationSnapshot,


    /**
     * Runtime initialization
     */
    initializeCompressionRuntime

});


/**
 * ============================================================================
 * 2. Enterprise Error Types
 * ============================================================================
 *
 * Enterprise error hierarchy for the compression middleware.
 *
 * Design Goals
 * ----------------------------------------------------------------------------
 * • Immutable error instances
 * • Consistent error codes
 * • HTTP status mapping
 * • Severity classification
 * • Operational vs programmer errors
 * • Trace/correlation friendly
 * • Serializable diagnostics
 * • Future OpenTelemetry compatibility
 * ============================================================================
 */

/**
 * Enterprise severity levels.
 */
const ERROR_SEVERITY = Object.freeze({

    LOW: 'LOW',

    MEDIUM: 'MEDIUM',

    HIGH: 'HIGH',

    CRITICAL: 'CRITICAL'

});

/**
 * Base compression error.
 */
class CompressionError extends Error {

    constructor(message, options = {}) {

        super(message);

        Error.captureStackTrace?.(
            this,
            this.constructor
        );

        this.name =
            this.constructor.name;

        this.code =
            options.code ||
            'COMPRESSION_ERROR';

        this.statusCode =
            Number.isInteger(options.statusCode)
                ? options.statusCode
                : 500;

        this.severity =
            options.severity ||
            ERROR_SEVERITY.HIGH;

        this.operational =
            options.operational !== false;

        this.component =
            COMPONENT_NAME;

        this.version =
            COMPONENT_VERSION;

        this.timestamp =
            new Date().toISOString();

        this.details =
            Object.freeze({
                ...(options.details || {})
            });

        this.cause =
            options.cause || null;

        Object.freeze(this.details);
        Object.freeze(this);
    }

    /**
     * Safe serialization.
     */
    toJSON() {

        return {

            name:
                this.name,

            code:
                this.code,

            message:
                this.message,

            statusCode:
                this.statusCode,

            severity:
                this.severity,

            operational:
                this.operational,

            component:
                this.component,

            version:
                this.version,

            timestamp:
                this.timestamp,

            details:
                this.details

        };

    }

}

/**
 * Invalid middleware configuration.
 */
class CompressionConfigurationError
    extends CompressionError {

    constructor(message, details = {}) {

        super(

            message ||

            'Invalid compression configuration.',

            {

                code:
                    'COMPRESSION_CONFIGURATION_ERROR',

                statusCode:
                    500,

                severity:
                    ERROR_SEVERITY.CRITICAL,

                details

            }

        );

    }

}

/**
 * Compression execution failure.
 */
class CompressionMiddlewareError
    extends CompressionError {

    constructor(message, details = {}) {

        super(

            message ||

            'Compression middleware execution failed.',

            {

                code:
                    'COMPRESSION_MIDDLEWARE_ERROR',

                statusCode:
                    500,

                severity:
                    ERROR_SEVERITY.HIGH,

                details

            }

        );

    }

}

/**
 * Content negotiation failure.
 */
class CompressionNegotiationError
    extends CompressionError {

    constructor(message, details = {}) {

        super(

            message ||

            'Unable to negotiate a supported compression encoding.',

            {

                code:
                    'COMPRESSION_NEGOTIATION_ERROR',

                statusCode:
                    406,

                severity:
                    ERROR_SEVERITY.MEDIUM,

                details

            }

        );

    }

}

/**
 * Compression strategy selection failure.
 */
class CompressionStrategyError
    extends CompressionError {

    constructor(message, details = {}) {

        super(

            message ||

            'Unable to determine compression strategy.',

            {

                code:
                    'COMPRESSION_STRATEGY_ERROR',

                statusCode:
                    500,

                severity:
                    ERROR_SEVERITY.HIGH,

                details

            }

        );

    }

}

/**
 * Error helper.
 *
 * Wrap unknown errors into enterprise errors.
 */
function normalizeCompressionError(error) {

    if (

        error instanceof CompressionError

    ) {

        return error;

    }

    return new CompressionMiddlewareError(

        error?.message ||

        'Unexpected compression middleware error.',

        {

            originalName:
                error?.name,

            stack:
                error?.stack

        }

    );

}

/**
 * Error classification helper.
 */
function isOperationalCompressionError(error) {

    return (

        error instanceof CompressionError &&

        error.operational === true

    );

}



/**
 * ============================================================================
 * 3. Enterprise Compression Policy Engine
 * ============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Global compression defaults
 * • Tenant-specific policy overrides
 * • Route-specific policy overrides
 * • MIME type policy resolution
 * • Compression threshold resolution
 * • Brotli/Gzip strategy selection
 * • Enterprise configuration validation
 * • Immutable effective policy generation
 *
 * Every request receives a fully-resolved compression policy before the
 * compression middleware executes.
 * ============================================================================
 */

/**
 * Deep freeze helper.
 */
function deepFreeze(value) {

    if (
        value &&
        typeof value === 'object' &&
        !Object.isFrozen(value)
    ) {

        Object.freeze(value);

        for (const key of Object.keys(value)) {

            deepFreeze(value[key]);

        }

    }

    return value;

}

/**
 * Merge helper.
 */
function mergePolicy(...sources) {

    return Object.assign({}, ...sources);

}

/**
 * Normalize MIME type.
 */
function normalizeMimeType(contentType = '') {

    return String(contentType)
        .split(';')[0]
        .trim()
        .toLowerCase();

}

/**
 * Enterprise configuration lookup.
 */
function loadCompressionConfiguration() {

    if (

        ConfigurationProvider &&
        typeof ConfigurationProvider.get === 'function'

    ) {

        return (

            ConfigurationProvider.get(
                'performance.compression'
            )

            ||

            {}

        );

    }

    return {};

}

/**
 * Validate compression configuration.
 */
function validateCompressionConfiguration(config) {

    if (

        typeof config.threshold !== 'number' ||

        config.threshold < 0

    ) {

        throw new CompressionConfigurationError(

            'Compression threshold must be a non-negative integer.',

            {

                threshold:
                    config.threshold

            }

        );

    }

    if (

        !Object.values(
            COMPRESSION_ALGORITHMS
        ).includes(config.algorithm)

    ) {

        throw new CompressionConfigurationError(

            'Unsupported compression algorithm.',

            {

                algorithm:
                    config.algorithm

            }

        );

    }

    if (

        config.brotliQuality < 0 ||

        config.brotliQuality > 11

    ) {

        throw new CompressionConfigurationError(

            'Brotli quality must be between 0 and 11.'

        );

    }

}

/**
 * Resolve tenant overrides.
 *
 * Expected configuration:
 *
 * tenants:
 * {
 *     premium:{...},
 *     enterprise:{...}
 * }
 */
function resolveTenantPolicy(

    tenant,

    configuration

) {

    if (

        !tenant ||

        !configuration.tenants

    ) {

        return {};

    }

    return (

        configuration.tenants[
            tenant.plan
        ]

        ||

        {}

    );

}

/**
 * Resolve route overrides.
 *
 * Example:
 *
 * routes:
 * {
 *     "/metrics":{
 *         enabled:false
 *     }
 * }
 */
function resolveRoutePolicy(

    route,

    configuration

) {

    if (

        !configuration.routes

    ) {

        return {};

    }

    return (

        configuration.routes[route]

        ||

        {}

    );

}

/**
 * Determine whether the MIME type is compressible.
 */
function isCompressibleMimeType(

    mime,

    policy

) {

    mime =
        normalizeMimeType(mime);

    if (

        policy.nonCompressibleTypes
            .includes(mime)

    ) {

        return false;

    }

    if (

        policy.compressibleTypes
            .includes(mime)

    ) {

        return true;

    }

    return mime.startsWith('text/');

}

/**
 * Select best compression algorithm.
 *
 * Priority:
 *
 * Brotli
 * ↓
 * Gzip
 * ↓
 * Identity
 */
function resolveCompressionAlgorithm(

    req,

    policy

) {

    const acceptEncoding =

        String(

            req.headers[
                'accept-encoding'
            ] ||

            ''

        ).toLowerCase();

    if (

        policy.algorithm ===
        COMPRESSION_ALGORITHMS.BROTLI &&

        acceptEncoding.includes('br')

    ) {

        return COMPRESSION_ALGORITHMS.BROTLI;

    }

    if (

        acceptEncoding.includes('gzip')

    ) {

        return COMPRESSION_ALGORITHMS.GZIP;

    }

    return COMPRESSION_ALGORITHMS.IDENTITY;

}

/**
 * Build immutable effective policy.
 */
function buildCompressionPolicy(req) {

    const configuration =

        mergePolicy(

            DEFAULT_CONFIGURATION,

            loadCompressionConfiguration()

        );

    validateCompressionConfiguration(
        configuration
    );

    const tenantPolicy =

        resolveTenantPolicy(

            req.user?.tenant,

            configuration

        );

    const routePolicy =

        resolveRoutePolicy(

            req.route?.path ||

            req.path,

            configuration

        );

    const effectivePolicy =

        mergePolicy(

            configuration,

            tenantPolicy,

            routePolicy

        );

    effectivePolicy.algorithm =

        resolveCompressionAlgorithm(

            req,

            effectivePolicy

        );

    effectivePolicy.mimeResolver =

        isCompressibleMimeType;

    effectivePolicy.generatedAt =

        new Date().toISOString();

    effectivePolicy.component =

        COMPONENT_NAME;

    return deepFreeze(
        effectivePolicy
    );

}

/**
 * Attach policy to request.
 */
function attachCompressionPolicy(req) {

    const policy =

        buildCompressionPolicy(req);

    req.compressionPolicy =
        policy;

    return policy;

}

/**
 * ============================================================================
 * 4. Compression Strategy & Request Filtering
 * ============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Response size threshold evaluation
 * • Excluded route handling
 * • Streaming response detection
 * • Server-Sent Events (SSE) detection
 * • WebSocket upgrade detection
 * • Already-compressed content detection
 * • Cache-Control: no-transform compliance
 * • Compression eligibility evaluation
 * • Observability integration
 * ============================================================================
 */

/**
 * Response types that should never be compressed.
 */
const STREAMING_CONTENT_TYPES = Object.freeze([

    'text/event-stream',

    'application/octet-stream'

]);

/**
 * Content encodings indicating the response is already compressed.
 */
const COMPRESSED_ENCODINGS = Object.freeze([

    'gzip',

    'br',

    'deflate',

    'compress',

    'identity'

]);

/**
 * Determine whether request targets an excluded route.
 */
function isExcludedRoute(req, policy) {

    const path = req.path || req.originalUrl || '';

    return policy.excludedRoutes.some(route => {

        if (route instanceof RegExp) {

            return route.test(path);

        }

        return path.startsWith(route);

    });

}

/**
 * Detect WebSocket upgrade requests.
 */
function isWebSocketRequest(req) {

    return String(

        req.headers.upgrade || ''

    ).toLowerCase() === 'websocket';

}

/**
 * Detect Server-Sent Events.
 */
function isServerSentEvents(res) {

    const type = normalizeMimeType(

        res.getHeader('Content-Type') || ''

    );

    return STREAMING_CONTENT_TYPES.includes(type);

}

/**
 * Detect streaming responses.
 */
function isStreamingResponse(res) {

    return (

        res.headersSent &&

        !res.writableEnded &&

        typeof res.flush === 'function'

    );

}

/**
 * Detect existing content encoding.
 */
function isAlreadyCompressed(res) {

    const encoding =

        String(

            res.getHeader('Content-Encoding') || ''

        ).toLowerCase();

    return COMPRESSED_ENCODINGS.includes(encoding);

}

/**
 * Respect Cache-Control: no-transform.
 */
function hasNoTransform(res) {

    const cacheControl =

        String(

            res.getHeader('Cache-Control') || ''

        ).toLowerCase();

    return NO_TRANSFORM_DIRECTIVES.some(

        directive => cacheControl.includes(directive)

    );

}

/**
 * Determine response size.
 */
function resolveContentLength(res) {

    const value =

        res.getHeader('Content-Length');

    if (

        value === undefined ||

        value === null

    ) {

        return null;

    }

    const parsed = Number(value);

    return Number.isFinite(parsed)

        ? parsed

        : null;

}

/**
 * Evaluate minimum compression threshold.
 */
function exceedsThreshold(length, policy) {

    if (

        length === null

    ) {

        /*
         * Unknown length.
         * Allow compression.
         */
        return true;

    }

    return length >= policy.threshold;

}

/**
 * Enterprise observability hook.
 */
function publishCompressionDecision({

    req,

    policy,

    allowed,

    reason

}) {

    try {

        req.logger?.debug?.(

            {

                component:
                    COMPONENT_NAME,

                requestId:
                    req.id,

                correlationId:
                    req.context?.correlationId,

                traceId:
                    TraceContext?.getTraceId?.(),

                algorithm:
                    policy.algorithm,

                allowed,

                reason

            },

            'Compression policy evaluated'

        );

        MetricsRegistry?.increment?.(

            'compression_policy_evaluations_total'

        );

        if (

            !allowed

        ) {

            MetricsRegistry?.increment?.(

                'compression_skipped_total'

            );

        }

        EventBus?.publish?.(

            'compression.policy.evaluated',

            Object.freeze({

                requestId:
                    req.id,

                correlationId:
                    req.context?.correlationId,

                traceId:
                    TraceContext?.getTraceId?.(),

                route:
                    req.originalUrl,

                algorithm:
                    policy.algorithm,

                allowed,

                reason,

                timestamp:
                    new Date().toISOString()

            })

        );

    }

    catch (_) {

        /*
         * Observability failures must never affect
         * the request lifecycle.
         */

    }

}

/**
 * Enterprise compression filter.
 *
 * Compatible with the "compression" package filter option.
 */
function shouldCompress(req, res) {

    const policy =

        req.compressionPolicy ||

        attachCompressionPolicy(req);

    let allowed = true;

    let reason = 'eligible';

    if (!policy.enabled) {

        allowed = false;
        reason = 'disabled';

    }
    else if (isExcludedRoute(req, policy)) {

        allowed = false;
        reason = 'excluded-route';

    }
    else if (isWebSocketRequest(req)) {

        allowed = false;
        reason = 'websocket';

    }
    else if (isServerSentEvents(res)) {

        allowed = false;
        reason = 'server-sent-events';

    }
    else if (isStreamingResponse(res)) {

        allowed = false;
        reason = 'streaming-response';

    }
    else if (isAlreadyCompressed(res)) {

        allowed = false;
        reason = 'already-compressed';

    }
    else if (

        policy.honorNoTransform &&

        hasNoTransform(res)

    ) {

        allowed = false;
        reason = 'cache-control-no-transform';

    }
    else {

        const mime = normalizeMimeType(

            res.getHeader('Content-Type') || ''

        );

        if (

            !policy.mimeResolver(

                mime,

                policy

            )

        ) {

            allowed = false;
            reason = 'mime-type';

        }
        else {

            const length =

                resolveContentLength(res);

            if (

                !exceedsThreshold(

                    length,

                    policy

                )

            ) {

                allowed = false;
                reason = 'below-threshold';

            }

        }

    }

    publishCompressionDecision({

        req,

        policy,

        allowed,

        reason

    });

    return allowed;

}

/**
 * ============================================================================
 * 5. Request Filtering
 * ============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Skip already-compressed responses
 * • Skip binary/media content
 * • Skip Server-Sent Events (SSE)
 * • Skip WebSocket upgrades
 * • Skip streaming responses
 * • Honor Cache-Control: no-transform
 * • Produce immutable compression decision
 *
 * Notes
 * -----------------------------------------------------------------------------
 * This layer only determines eligibility. It never performs compression.
 * ============================================================================
 */

/**
 * Binary MIME types that should never be compressed.
 */
const BINARY_MIME_PREFIXES = Object.freeze([

    'image/',

    'video/',

    'audio/',

    'font/'

]);

const BINARY_MIME_TYPES = Object.freeze([

    'application/pdf',

    'application/zip',

    'application/gzip',

    'application/x-gzip',

    'application/x-7z-compressed',

    'application/x-rar-compressed',

    'application/x-bzip2',

    'application/octet-stream',

    'application/vnd.ms-excel',

    'application/vnd.openxmlformats-officedocument'

]);

/**
 * Compression skip reasons.
 */
const FILTER_REASONS = Object.freeze({

    ELIGIBLE:
        'eligible',

    DISABLED:
        'disabled',

    EXCLUDED_ROUTE:
        'excluded-route',

    WEBSOCKET:
        'websocket',

    SERVER_SENT_EVENTS:
        'server-sent-events',

    STREAMING:
        'streaming-response',

    ALREADY_COMPRESSED:
        'already-compressed',

    BINARY_CONTENT:
        'binary-content',

    NO_TRANSFORM:
        'cache-control-no-transform',

    BELOW_THRESHOLD:
        'below-threshold',

    MIME_NOT_ALLOWED:
        'mime-not-allowed'

});

/**
 * Determine whether a MIME type is binary.
 */
function isBinaryMimeType(contentType = '') {

    const mime = normalizeMimeType(contentType);

    if (

        BINARY_MIME_TYPES.includes(mime)

    ) {

        return true;

    }

    return BINARY_MIME_PREFIXES.some(

        prefix => mime.startsWith(prefix)

    );

}

/**
 * Detect Server-Sent Events.
 */
function isSSE(res) {

    return (

        normalizeMimeType(

            res.getHeader('Content-Type')

        ) === 'text/event-stream'

    );

}

/**
 * Detect WebSocket upgrade.
 */
function isWebSocket(req) {

    return (

        String(

            req.headers.upgrade || ''

        )

        .toLowerCase() === 'websocket'

    );

}

/**
 * Detect streaming responses.
 */
function isStreaming(res) {

    return (

        typeof res.flush === 'function' ||

        res.writableEnded === false &&

        res.headersSent === true

    );

}

/**
 * Detect existing compression.
 */
function hasExistingCompression(res) {

    return Boolean(

        res.getHeader(

            'Content-Encoding'

        )

    );

}

/**
 * Honor Cache-Control: no-transform.
 */
function hasNoTransformDirective(res) {

    const cacheControl =

        String(

            res.getHeader(

                'Cache-Control'

            ) ||

            ''

        )

        .toLowerCase();

    return cacheControl.includes(

        'no-transform'

    );

}

/**
 * Evaluate request filtering.
 *
 * Returns an immutable decision object.
 */
function evaluateRequestFiltering(

    req,

    res,

    policy

) {

    let allowed = true;

    let reason = FILTER_REASONS.ELIGIBLE;

    if (!policy.enabled) {

        allowed = false;

        reason = FILTER_REASONS.DISABLED;

    }

    else if (

        isExcludedRoute(req, policy)

    ) {

        allowed = false;

        reason = FILTER_REASONS.EXCLUDED_ROUTE;

    }

    else if (

        isWebSocket(req)

    ) {

        allowed = false;

        reason = FILTER_REASONS.WEBSOCKET;

    }

    else if (

        isSSE(res)

    ) {

        allowed = false;

        reason = FILTER_REASONS.SERVER_SENT_EVENTS;

    }

    else if (

        isStreaming(res)

    ) {

        allowed = false;

        reason = FILTER_REASONS.STREAMING;

    }

    else if (

        hasExistingCompression(res)

    ) {

        allowed = false;

        reason = FILTER_REASONS.ALREADY_COMPRESSED;

    }

    else if (

        policy.honorNoTransform &&

        hasNoTransformDirective(res)

    ) {

        allowed = false;

        reason = FILTER_REASONS.NO_TRANSFORM;

    }

    else {

        const mime = normalizeMimeType(

            res.getHeader(

                'Content-Type'

            ) || ''

        );

        if (

            isBinaryMimeType(mime)

        ) {

            allowed = false;

            reason = FILTER_REASONS.BINARY_CONTENT;

        }

        else if (

            !policy.mimeResolver(

                mime,

                policy

            )

        ) {

            allowed = false;

            reason = FILTER_REASONS.MIME_NOT_ALLOWED;

        }

        else {

            const length =

                resolveContentLength(res);

            if (

                !exceedsThreshold(

                    length,

                    policy

                )

            ) {

                allowed = false;

                reason = FILTER_REASONS.BELOW_THRESHOLD;

            }

        }

    }

    const decision = Object.freeze({

        allowed,

        reason,

        algorithm:
            policy.algorithm,

        route:
            req.originalUrl,

        method:
            req.method,

        mimeType:

            normalizeMimeType(

                res.getHeader(

                    'Content-Type'

                ) || ''

            ),

        timestamp:

            new Date()

                .toISOString()

    });

    return decision;

}

/**
 * Compatibility filter for the `compression` package.
 */
function compressionFilter(req, res) {

    const policy =

        req.compressionPolicy ||

        attachCompressionPolicy(req);

    const decision =

        evaluateRequestFiltering(

            req,

            res,

            policy

        );

    req.compressionContext = Object.freeze({

        policy,

        decision

    });

    publishCompressionDecision({

        req,

        policy,

        allowed:
            decision.allowed,

        reason:
            decision.reason

    });

    return decision.allowed;

}

/**
 * ============================================================================
 * 6. Middleware Execution
 * ============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Instantiate enterprise compression middleware
 * • Apply resolved compression policy
 * • Attach immutable compression context
 * • Record original/compressed response sizes
 * • Calculate compression ratio
 * • Emit enterprise response headers
 * • Publish metrics
 * • Publish lifecycle events
 * • Integrate with tracing and structured logging
 *
 * Pipeline
 * -----------------------------------------------------------------------------
 *
 * Request
 *      │
 *      ▼
 * Compression Policy
 *      │
 *      ▼
 * Request Filtering
 *      │
 *      ▼
 * Enterprise Compression Middleware
 *      │
 *      ▼
 * Compression Package
 *      │
 *      ▼
 * Response Metrics
 *      │
 *      ▼
 * EventBus
 *      │
 *      ▼
 * Structured Logger
 * ============================================================================
 */

/**
 * Safe integer conversion.
 */
function safeNumber(value) {

    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? parsed
        : 0;

}

/**
 * Calculate compression ratio.
 */
function calculateCompressionRatio(originalSize, compressedSize) {

    if (

        originalSize <= 0 ||

        compressedSize <= 0

    ) {

        return 0;

    }

    return Number(

        (

            (originalSize - compressedSize)

            /

            originalSize

        ).toFixed(4)

    );

}

/**
 * Build immutable compression metrics.
 */
function buildCompressionMetrics({

    originalSize,

    compressedSize,

    algorithm,

    duration

}) {

    return Object.freeze({

        originalSize,

        compressedSize,

        savedBytes:

            Math.max(

                originalSize - compressedSize,

                0

            ),

        compressionRatio:

            calculateCompressionRatio(

                originalSize,

                compressedSize

            ),

        algorithm,

        duration,

        timestamp:

            new Date().toISOString()

    });

}

/**
 * Emit enterprise response headers.
 */
function applyCompressionHeaders(res, metrics) {

    res.setHeader(

        'X-Compression-Algorithm',

        metrics.algorithm

    );

    res.setHeader(

        'X-Compression-Ratio',

        metrics.compressionRatio

    );

    res.setHeader(

        'X-Original-Content-Length',

        metrics.originalSize

    );

}

/**
 * Enterprise compression middleware factory.
 */
function compressionMiddleware(options = {}) {

    const middleware = compression({

        threshold:

            options.threshold ||

            DEFAULT_CONFIGURATION.threshold,

        filter:

            compressionFilter,

        level:

            options.gzipLevel ||

            DEFAULT_CONFIGURATION.gzipLevel,

        strategy:

            options.strategy ||

            DEFAULT_CONFIGURATION.strategy,

        memLevel:

            options.memoryLevel ||

            DEFAULT_CONFIGURATION.memoryLevel,

        windowBits:

            options.windowBits ||

            DEFAULT_CONFIGURATION.windowBits

    });

    return function enterpriseCompressionMiddleware(

        req,

        res,

        next

    ) {

        const startedAt = process.hrtime.bigint();

        const policy =

            req.compressionPolicy ||

            attachCompressionPolicy(req);

        /**
         * Immutable execution context.
         */
        req.compressionContext = Object.freeze({

            policy,

            startedAt,

            algorithm:

                policy.algorithm

        });

        /**
         * Observe response completion.
         */
        res.once(

            'finish',

            () => {

                try {

                    const duration = Number(

                        process.hrtime.bigint() -

                        startedAt

                    ) / 1_000_000;

                    const originalSize = safeNumber(

                        res.getHeader(

                            'X-Original-Content-Length'

                        ) ||

                        res.getHeader(

                            'Content-Length'

                        )

                    );

                    const compressedSize = safeNumber(

                        res.getHeader(

                            'Content-Length'

                        )

                    );

                    const metrics =

                        buildCompressionMetrics({

                            originalSize,

                            compressedSize,

                            algorithm:

                                policy.algorithm,

                            duration

                        });

                    req.compressionContext = Object.freeze({

                        ...req.compressionContext,

                        metrics

                    });

                    applyCompressionHeaders(

                        res,

                        metrics

                    );

                    /**
                     * Publish metrics.
                     */
                    MetricsRegistry?.record?.(

                        'http.compression',

                        metrics

                    );

                    /**
                     * Publish lifecycle event.
                     */
                    EventBus?.publish?.(

                        'http.compression.completed',

                        Object.freeze({

                            requestId:

                                req.id,

                            correlationId:

                                req.context

                                ?.correlationId,

                            traceId:

                                TraceContext

                                ?.getTraceId?.(),

                            route:

                                req.originalUrl,

                            method:

                                req.method,

                            metrics

                        })

                    );

                    /**
                     * Structured logging.
                     */
                    req.logger?.debug?.(

                        {

                            component:

                                COMPONENT_NAME,

                            requestId:

                                req.id,

                            correlationId:

                                req.context

                                ?.correlationId,

                            traceId:

                                TraceContext

                                ?.getTraceId?.(),

                            metrics

                        },

                        'HTTP response compression completed'

                    );

                }

                catch (error) {

                    req.logger?.warn?.(

                        {

                            component:

                                COMPONENT_NAME,

                            error:

                                error.message

                        },

                        'Compression metrics collection failed'

                    );

                }

            }

        );

        /**
         * Delegate to the compression package.
         */
        return middleware(

            req,

            res,

            next

        );

    };

}

/**
 * ============================================================================
 * 7. Observability Integration
 * ============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Structured logging
 * • RequestMetrics integration
 * • MetricsRegistry integration
 * • EventBus integration
 * • TraceContext enrichment
 * • Safe observability (never breaks request processing)
 * • Immutable diagnostics snapshots
 *
 * Architecture
 * -----------------------------------------------------------------------------
 *
 * Request
 *      │
 *      ▼
 * TraceContext
 *      │
 *      ▼
 * StructuredLogger
 *      │
 *      ▼
 * RequestMetrics
 *      │
 *      ▼
 * MetricsRegistry
 *      │
 *      ▼
 * EventBus
 *
 * ============================================================================
 */

/**
 * Internal observability state.
 */
const OBSERVABILITY_STATE = {

    initialized: false,

    initializedAt: null,

    logger: null,

    metricsRegistry: null,

    requestMetrics: null,

    eventBus: null,

    traceContext: null

};

/**
 * Initialize observability dependencies.
 */
function initializeObservability() {

    if (

        OBSERVABILITY_STATE.initialized

    ) {

        return OBSERVABILITY_STATE;

    }

    OBSERVABILITY_STATE.logger =

        LoggerFactory?.create?.({

            service: COMPONENT_NAME

        }) ||

        StructuredLogger ||

        null;

    OBSERVABILITY_STATE.metricsRegistry =

        MetricsRegistry ||

        null;

    OBSERVABILITY_STATE.requestMetrics =

        RequestMetrics ||

        null;

    OBSERVABILITY_STATE.eventBus =

        EventBus ||

        null;

    OBSERVABILITY_STATE.traceContext =

        TraceContext ||

        null;

    OBSERVABILITY_STATE.initialized = true;

    OBSERVABILITY_STATE.initializedAt =

        new Date().toISOString();

    return OBSERVABILITY_STATE;

}

/**
 * Build common observability context.
 */
function buildObservabilityContext(req = {}) {

    return Object.freeze({

        requestId:

            req.id ||

            null,

        correlationId:

            req.context?.correlationId ||

            null,

        traceId:

            TraceContext?.getTraceId?.() ||

            null,

        spanId:

            TraceContext?.getSpanId?.() ||

            null,

        tenant:

            req.context?.tenant ||

            req.user?.tenant ||

            null,

        user:

            req.user?.id ||

            null,

        component:

            COMPONENT_NAME,

        version:

            COMPONENT_VERSION,

        hostname:

            INTERNAL_STATE.hostname,

        processId:

            process.pid,

        timestamp:

            new Date().toISOString()

    });

}

/**
 * Structured logging helper.
 */
function logCompressionEvent(level, message, req, metadata = {}) {

    try {

        const logger =

            initializeObservability().logger;

        if (

            !logger ||

            typeof logger[level] !== 'function'

        ) {

            return;

        }

        logger[level](

            {

                ...buildObservabilityContext(req),

                ...metadata

            },

            message

        );

    }

    catch (_) {

        // Never interrupt request processing.

    }

}

/**
 * Publish enterprise metrics.
 */
function publishCompressionMetrics(req, metrics) {

    try {

        initializeObservability()

            .metricsRegistry

            ?.record?.(

                'compression',

                Object.freeze({

                    ...buildObservabilityContext(req),

                    ...metrics

                })

            );

        initializeObservability()

            .requestMetrics

            ?.recordCompression?.(

                metrics

            );

    }

    catch (_) {}

}

/**
 * Publish enterprise lifecycle event.
 */
function publishCompressionEvent(type, req, payload = {}) {

    try {

        initializeObservability()

            .eventBus

            ?.publish?.(

                type,

                Object.freeze({

                    ...buildObservabilityContext(req),

                    ...payload

                })

            );

    }

    catch (_) {}

}

/**
 * Capture current trace information.
 */
function captureTraceContext(req) {

    try {

        return Object.freeze({

            traceId:

                TraceContext?.getTraceId?.() ||

                null,

            spanId:

                TraceContext?.getSpanId?.() ||

                null,

            parentSpanId:

                TraceContext?.getParentSpanId?.() ||

                null,

            requestId:

                req.id ||

                null,

            correlationId:

                req.context?.correlationId ||

                null

        });

    }

    catch (_) {

        return Object.freeze({});

    }

}

/**
 * Create immutable diagnostics snapshot.
 */
function compressionObservabilitySnapshot() {

    const state =

        initializeObservability();

    return Object.freeze({

        initialized:

            state.initialized,

        initializedAt:

            state.initializedAt,

        logger:

            Boolean(state.logger),

        requestMetrics:

            Boolean(state.requestMetrics),

        metricsRegistry:

            Boolean(state.metricsRegistry),

        eventBus:

            Boolean(state.eventBus),

        traceContext:

            Boolean(state.traceContext),

        component:

            COMPONENT_NAME,

        version:

            COMPONENT_VERSION

    });

}

/**
 * ============================================================================
 * 8. Diagnostics, Health Checks & Middleware Registration
 * ============================================================================
 *
 * TITech Community Capital LTD
 *
 * Enterprise Compression Middleware Diagnostics
 *
 * Responsibilities
 * ---------------------------------------------------------------------------
 * • Health checks
 * • Readiness checks
 * • Runtime diagnostics
 * • Immutable configuration snapshot
 * • Middleware metadata
 * • Factory exports
 * • Enterprise middleware registration
 * ============================================================================
 */

/**
 * Internal runtime state.
 * 
 * const INTERNAL_STATE = Object.seal({

    initialized: false,

    initializedAt: null,

    lastHealthCheck: null,

    lastReadinessCheck: null,

    configurationHash: null

});
 * 
 */


/**
 * Build immutable configuration snapshot.
 */
function configurationSnapshot() {

    const configuration = Object.freeze({

        enabled:
            DEFAULT_CONFIGURATION.enabled,

        algorithm:
            DEFAULT_CONFIGURATION.algorithm,

        threshold:
            DEFAULT_CONFIGURATION.threshold,

        gzipLevel:
            DEFAULT_CONFIGURATION.gzipLevel,

        brotliEnabled:
            DEFAULT_CONFIGURATION.enableBrotli,

        minimumSize:
            DEFAULT_CONFIGURATION.minimumSize,

        honorNoTransform:
            DEFAULT_CONFIGURATION.honorNoTransform,

        excludedRoutes:

            Object.freeze([

                ...DEFAULT_CONFIGURATION.excludedRoutes

            ]),

        mimeTypes:

            Object.freeze([

                ...DEFAULT_CONFIGURATION.compressibleMimeTypes

            ])

    });

    return configuration;

}

/**
 * Middleware health check.
 */
async function healthCheck() {

    INTERNAL_STATE.lastHealthCheck =

        new Date().toISOString();

    return Object.freeze({

        component:
            COMPONENT_NAME,

        healthy: true,

        initialized:
            INTERNAL_STATE.initialized,

        timestamp:
            INTERNAL_STATE.lastHealthCheck

    });

}

/**
 * Middleware readiness check.
 */
async function readinessCheck() {

    INTERNAL_STATE.lastReadinessCheck =

        new Date().toISOString();

    const ready =

        initializeObservability()

            .initialized;

    return Object.freeze({

        component:
            COMPONENT_NAME,

        ready,

        timestamp:
            INTERNAL_STATE.lastReadinessCheck,

        observability:

            compressionObservabilitySnapshot()

    });

}

/**
 * Runtime diagnostics.
 */
function diagnostics() {

    return Object.freeze({

        metadata:

            middlewareMetadata,

        runtime:

            {

                initialized:

                    INTERNAL_STATE.initialized,

                initializedAt:

                    INTERNAL_STATE.initializedAt,

                processId:

                    process.pid,

                nodeVersion:

                    process.version,

                uptime:

                    process.uptime()

            },

        configuration:

            configurationSnapshot(),

        observability:

            compressionObservabilitySnapshot()

    });

}

/**
 * Initialize middleware runtime.
 */
function initializeCompressionRuntime() {

    if (

        INTERNAL_STATE.initialized

    ) {

        return;

    }

    initializeObservability();

    INTERNAL_STATE.initialized = true;

    INTERNAL_STATE.initializedAt =

        new Date().toISOString();

}

/**
 * Enterprise middleware factory.
 */
function createCompressionMiddleware(options = {}) {

    initializeCompressionRuntime();

    return compressionMiddleware(options);

}

/**
 * Enterprise middleware metadata.
 */
const middlewareMetadata = Object.freeze({

    name:
        'compression',

    displayName:
        'Enterprise Compression Middleware',

    version:
        '1.0.0',

    category:
        'performance',

    phase:
        'performance',

    priority:
        300,

    critical:
        false,

    singleton:
        true,

    enabledByDefault:
        true,

    supportsHotReload:
        false,

    dependencies: Object.freeze([

        'requestContext',

        'requestLogger',

        'requestMetrics',

        'securityHeaders'

    ]),

    observability: Object.freeze({

        structuredLogging: true,

        metrics: true,

        tracing: true,

        eventBus: true

    }),

    owner:
        'TITech Community Capital LTD'

});

/**
 * Registration descriptor consumed by createApp().
 */
const registration = Object.freeze({

    metadata:

        middlewareMetadata,

    create:

        createCompressionMiddleware,

    healthCheck,

    readinessCheck,

    diagnostics,

    configurationSnapshot

});

/*
 * ============================================================================
 * Public Enterprise Module Exports
 * ============================================================================
 *
 * TITech Community Capital LTD
 *
 * Exposes:
 *
 * - Middleware factory
 * - Middleware metadata
 * - Diagnostics
 * - Health/readiness checks
 * - Runtime initialization
 * - Observability interfaces
 * - Enterprise error hierarchy
 * - Error normalization helpers
 *
 * Compatible with:
 *
 * - createApp()
 * - Middleware Registry
 * - Service Registry
 * - Runtime Diagnostics
 * - Enterprise Error Boundary
 *
 * ============================================================================
 */

module.exports = Object.freeze({

    /**
     * -------------------------------------------------------------------------
     * Middleware Factory
     * -------------------------------------------------------------------------
     */

    /**
     * Preferred enterprise factory.
     */
    createCompressionMiddleware,


    /**
     * Backward-compatible factory alias.
     */
    create:

        createCompressionMiddleware,


    /**
     * Middleware alias.
     */
    middleware:

        createCompressionMiddleware,



    /**
     * -------------------------------------------------------------------------
     * Middleware Metadata
     * -------------------------------------------------------------------------
     */

    metadata:

        METADATA,


    /**
     * Middleware registration descriptor.
     *
     * Used by createApp()
     * and middleware orchestration.
     */
    registration,



    /**
     * -------------------------------------------------------------------------
     * Diagnostics & Operational Checks
     * -------------------------------------------------------------------------
     */

    healthCheck,

    readinessCheck,

    diagnostics,

    configurationSnapshot,



    /**
     * -------------------------------------------------------------------------
     * Runtime Initialization
     * -------------------------------------------------------------------------
     */

    initialize:

        initializeCompressionRuntime,



    /**
     * -------------------------------------------------------------------------
     * Observability
     * -------------------------------------------------------------------------
     *
     * StructuredLogger
     * RequestMetrics
     * MetricsRegistry
     * EventBus
     * TraceContext
     *
     */

    observability:

        compressionObservabilitySnapshot,



    /**
     * -------------------------------------------------------------------------
     * Enterprise Error Hierarchy
     * -------------------------------------------------------------------------
     */

    errors: Object.freeze({

        CompressionError,

        CompressionConfigurationError,

        CompressionMiddlewareError,

        CompressionNegotiationError,

        CompressionStrategyError

    }),



    /**
     * -------------------------------------------------------------------------
     * Error Utilities
     * -------------------------------------------------------------------------
     */

    normalizeCompressionError,

    isOperationalCompressionError

});