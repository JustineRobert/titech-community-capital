'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/environmentSnapshot.js
 *
 * Purpose:
 *   Enterprise production-grade immutable environment snapshot provider.
 *
 * Responsibilities:
 *   - Capture the effective TITech environment state.
 *   - Produce immutable, deterministic snapshots.
 *   - Separate public/runtime metadata from sensitive environment values.
 *   - Provide safe configuration/environment fingerprints.
 *   - Support bootstrap, diagnostics, readiness and operational tooling.
 *   - Detect environment drift between snapshots.
 *   - Provide controlled comparison and equality semantics.
 *   - Preserve dotenv discovery/loading metadata when available.
 *   - Prevent accidental mutation of environment snapshot state.
 *
 * IMPORTANT:
 *
 *   This module is SNAPSHOT / VALUE-OBJECT infrastructure.
 *
 *   It does NOT:
 *     - mutate process.env.
 *     - load dotenv files.
 *     - validate the entire application configuration.
 *     - initialize databases.
 *     - initialize Redis.
 *     - initialize queues.
 *     - create HTTP servers.
 *     - execute business logic.
 *     - execute financial transactions.
 *
 * Environment loading remains owned by:
 *
 *   backend/config/environment.js
 *
 * Environment lifecycle state remains owned by:
 *
 *   backend/config/environment/bootstrapState.js
 *
 * Diagnostics remain owned by:
 *
 *   backend/config/environment/diagnostics.js
 *
 * =============================================================================
 *
 * Snapshot model:
 *
 *   process.env
 *       ↓
 *   environment loader
 *       ↓
 *   normalized environment
 *       ↓
 *   EnvironmentSnapshot
 *       ↓
 *   immutable operational state
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const os =
    require('node:os');

const process =
    require('node:process');

/**
 * =============================================================================
 * Optional environment modules
 * =============================================================================
 */

let environmentModule =
    null;

try {
    // eslint-disable-next-line global-require
    environmentModule =
        require('../environment');
} catch {
    environmentModule =
        null;
}

let bootstrapStateModule =
    null;

try {
    // eslint-disable-next-line global-require
    bootstrapStateModule =
        require('./bootstrapState');
} catch {
    bootstrapStateModule =
        null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule =
    null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../utils/logger');
} catch {
    loggerModule =
        null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-snapshot';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const ENVIRONMENT_NAMES =
    Object.freeze({
        DEVELOPMENT:
            'development',

        TEST:
            'test',

        STAGING:
            'staging',

        PRODUCTION:
            'production',
    });

const SUPPORTED_ENVIRONMENTS =
    Object.freeze([
        ENVIRONMENT_NAMES.DEVELOPMENT,
        ENVIRONMENT_NAMES.TEST,
        ENVIRONMENT_NAMES.STAGING,
        ENVIRONMENT_NAMES.PRODUCTION,
    ]);

const SNAPSHOT_STATES =
    Object.freeze({
        CREATED:
            'created',

        CAPTURING:
            'capturing',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',
    });

const SNAPSHOT_SOURCES =
    Object.freeze({
        PROCESS:
            'process',

        ENVIRONMENT_MODULE:
            'environment-module',

        EXPLICIT:
            'explicit',

        BOOTSTRAP_STATE:
            'bootstrap-state',

        COMPOSITE:
            'composite',
    });

const DEFAULTS =
    Object.freeze({
        environment:
            process.env.NODE_ENV ||
            ENVIRONMENT_NAMES.DEVELOPMENT,

        strict:
            true,

        failClosed:
            true,

        includeRuntime:
            true,

        includeBootstrapState:
            true,

        includeEnvironmentMetadata:
            true,

        includeVariableMetadata:
            true,

        includeVariableValues:
            false,

        exposeSensitiveValues:
            false,

        redactSecrets:
            true,

        includeProcessEnvironmentFingerprint:
            true,

        includeSnapshotFingerprint:
            true,

        fingerprintAlgorithm:
            'sha256',

        maxVariableCount:
            2_000,

        maxKeyLength:
            255,

        maxValueLength:
            8_192,

        maxObjectDepth:
            12,

        /**
         * Never expose these classes of values.
         */
        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri)|jwt[_-]?secret|smtp[_-]?password|access[_-]?token|refresh[_-]?token|cookie|set-cookie|credential|signing[_-]?key)/i,

        /**
         * Infrastructure variables that should receive metadata only.
         */
        sensitiveVariablePattern:
            /(MONGO|REDIS|JWT|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY|SMTP|COOKIE|ENCRYPTION|SIGNING)/i,

        /**
         * Runtime metadata intentionally excludes command-line arguments,
         * open sockets and other potentially sensitive process data.
         */
        runtime:
            {
                includePid:
                    true,

                includeHostname:
                    true,

                includePlatform:
                    true,

                includeArchitecture:
                    true,

                includeNodeVersion:
                    true,

                includeUptime:
                    true,

                includeMemory:
                    true,

                includeCpu:
                    false,
            },
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentSnapshotError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentSnapshotError';

        this.code =
            options.code ||
            'ENVIRONMENT_SNAPSHOT_ERROR';

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            EnvironmentSnapshotError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function normalizeEnvironment(
    value,
) {

    return String(
        value ||
        DEFAULTS.environment,
    )
        .trim()
        .toLowerCase();
}

function isSupportedEnvironment(
    value,
) {

    return SUPPORTED_ENVIRONMENTS.includes(
        normalizeEnvironment(
            value,
        ),
    );
}

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {

        return value;
    }

    if (
        seen.has(
            value,
        )
    ) {

        return value;
    }

    seen.add(
        value,
    );

    for (
        const key of
        Reflect.ownKeys(
            value,
        )
    ) {

        try {
            deepFreeze(
                value[key],
                seen,
            );
        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(
            value,
        );
    } catch {
        // Best effort.
    }

    return value;
}

function clone(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    if (
        typeof structuredClone ===
        'function'
    ) {

        try {
            return structuredClone(
                value,
            );
        } catch {
            // Fall through.
        }
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                clone(
                    item,
                ),
        );
    }

    if (
        typeof value ===
        'object'
    ) {

        const output = {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            output[key] =
                clone(
                    item,
                );
        }

        return output;
    }

    return value;
}

function stableStringify(
    value,
) {

    if (
        value === null ||
        typeof value !==
        'object'
    ) {

        return JSON.stringify(
            value,
        );
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return `[${value
            .map(
                item =>
                    stableStringify(
                        item,
                    ),
            )
            .join(',')}]`;
    }

    return `{${Object.keys(
        value,
    )
        .sort()
        .map(
            key =>
                `${JSON.stringify(
                    key,
                )}:${stableStringify(
                    value[key],
                )}`,
        )
        .join(',')}}`;
}

function fingerprint(
    value,
    algorithm =
        DEFAULTS.fingerprintAlgorithm,
) {

    return crypto
        .createHash(
            algorithm,
        )
        .update(
            stableStringify(
                value,
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

function safeError(
    error,
) {

    if (
        !error
    ) {

        return null;
    }

    return {
        name:
            error.name ||
            'Error',

        code:
            error.code ||
            'UNKNOWN',

        message:
            error.message ||
            String(
                error,
            ),
    };
}

/**
 * =============================================================================
 * Sensitive value handling
 * =============================================================================
 */

function isSensitiveKey(
    key,
) {

    return DEFAULTS
        .sensitivePattern
        .test(
            String(
                key ||
                '',
            ),
        );
}

function isSensitiveEnvironmentVariable(
    key,
) {

    return DEFAULTS
        .sensitiveVariablePattern
        .test(
            String(
                key ||
                '',
            ),
        );
}

function sanitizeValue(
    value,
    {
        key = '',
        redactSecrets =
            DEFAULTS.redactSecrets,
        exposeSensitiveValues =
            DEFAULTS.exposeSensitiveValues,
        maxDepth =
            DEFAULTS.maxObjectDepth,
        depth = 0,
        seen =
            new WeakSet(),
    } = {},
) {

    if (
        depth >
        maxDepth
    ) {

        return '[MAX_DEPTH]';
    }

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    if (
        redactSecrets &&
        !exposeSensitiveValues &&
        isSensitiveKey(
            key,
        )
    ) {

        return '[REDACTED]';
    }

    if (
        typeof value ===
        'string'
    ) {

        return value.length >
            DEFAULTS.maxValueLength
            ? `${value.slice(
                0,
                DEFAULTS.maxValueLength,
            )}[TRUNCATED]`
            : value;
    }

    if (
        typeof value ===
        'number' ||
        typeof value ===
        'boolean'
    ) {

        return value;
    }

    if (
        typeof value ===
        'bigint'
    ) {

        return `${value}n`;
    }

    if (
        typeof value ===
        'function'
    ) {

        return '[FUNCTION]';
    }

    if (
        typeof value !==
        'object'
    ) {

        return String(
            value,
        );
    }

    if (
        seen.has(
            value,
        )
    ) {

        return '[CIRCULAR]';
    }

    seen.add(
        value,
    );

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                sanitizeValue(
                    item,
                    {
                        key,
                        redactSecrets,
                        exposeSensitiveValues,
                        maxDepth,
                        depth:
                            depth + 1,
                        seen,
                    },
                ),
        );
    }

    const output = {};

    for (
        const [
            childKey,
            childValue,
        ] of Object.entries(
            value,
        )
    ) {

        output[childKey] =
            sanitizeValue(
                childValue,
                {
                    key:
                        childKey,

                    redactSecrets,

                    exposeSensitiveValues,

                    maxDepth,

                    depth:
                        depth + 1,

                    seen,
                },
            );
    }

    return output;
}

/**
 * =============================================================================
 * Environment variable snapshot
 * ============================================================================= */

function captureEnvironmentVariables(
    options,
) {

    const result = {};

    const metadata = {};

    const names =
        Object.keys(
            process.env,
        ).sort();

    if (
        names.length >
        options.maxVariableCount
    ) {

        throw new EnvironmentSnapshotError(
            'TITech environment variable count exceeds the configured snapshot limit.',
            {
                code:
                    'ENVIRONMENT_VARIABLE_LIMIT_EXCEEDED',

                details: {
                    count:
                        names.length,

                    max:
                        options.maxVariableCount,
                },
            },
        );
    }

    for (
        const name of
        names
    ) {

        if (
            name.length >
            options.maxKeyLength
        ) {

            continue;
        }

        const value =
            process.env[name];

        const sensitive =
            isSensitiveEnvironmentVariable(
                name,
            );

        metadata[name] = {
            defined:
                value !==
                undefined,

            sensitive,

            length:
                typeof value ===
                    'string'
                    ? value.length
                    : 0,

            fingerprint:
                options
                    .includeProcessEnvironmentFingerprint
                    ? fingerprint(
                        value ??
                        '',
                        options
                            .fingerprintAlgorithm,
                    )
                    : null,
        };

        if (
            options.includeVariableValues &&
            !(
                sensitive &&
                options.redactSecrets &&
                !options.exposeSensitiveValues
            )
        ) {

            result[name] =
                value;
        } else {

            /**
             * Never expose actual production process.env values from a default
             * snapshot. Metadata remains available for drift diagnostics.
             */
            result[name] =
                '[HIDDEN]';
        }
    }

    return {
        values:
            result,

        metadata,
    };
}

/**
 * =============================================================================
 * Environment implementation resolution
 * ============================================================================= */

function resolveEnvironmentImplementation() {

    if (
        !environmentModule
    ) {

        return null;
    }

    return environmentModule;
}

function resolveBootstrapState() {

    if (
        !bootstrapStateModule
    ) {

        return null;
    }

    return (
        bootstrapStateModule.bootstrapState ||
        bootstrapStateModule
    );
}

/**
 * =============================================================================
 * EnvironmentSnapshot
 * =============================================================================
 */

class EnvironmentSnapshot {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,

                environment:
                    normalizeEnvironment(
                        options.environment ||
                        process.env.NODE_ENV ||
                        DEFAULTS.environment,
                    ),

                runtime:
                    Object.freeze({
                        ...DEFAULTS.runtime,
                        ...(options.runtime || {}),
                    }),
            });

        this.state =
            SNAPSHOT_STATES.CREATED;

        this.createdAt =
            null;

        this.capturedAt =
            null;

        this.snapshot =
            null;

        this.error =
            null;

        this._capturePromise =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Capture.
     * -------------------------------------------------------------------------
     */

    async capture(
        source = {},
    ) {

        if (
            this.snapshot
        ) {

            return this.snapshot;
        }

        if (
            this._capturePromise
        ) {

            return this._capturePromise;
        }

        this._capturePromise =
            (async () => {

                this.state =
                    SNAPSHOT_STATES
                        .CAPTURING;

                this.createdAt =
                    this.createdAt ||
                    new Date();

                try {

                    const captured =
                        this.buildSnapshot(
                            source,
                        );

                    this.snapshot =
                        deepFreeze(
                            captured,
                        );

                    this.capturedAt =
                        new Date();

                    this.state =
                        SNAPSHOT_STATES
                            .READY;

                    return this.snapshot;

                } catch (
                    error
                ) {

                    this.error =
                        error;

                    this.state =
                        SNAPSHOT_STATES
                            .INVALID;

                    throw error;
                }
            })();

        try {

            return await this._capturePromise;

        } finally {

            this._capturePromise =
                null;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Build snapshot.
     * -------------------------------------------------------------------------
     */

    buildSnapshot(
        source = {},
    ) {

        const effectiveEnvironment =
            normalizeEnvironment(
                source.environment ||
                process.env.NODE_ENV ||
                this.options.environment,
            );

        if (
            !this.options
                .allowUnknownEnvironment &&
            !isSupportedEnvironment(
                effectiveEnvironment,
            )
        ) {

            const error =
                new EnvironmentSnapshotError(
                    `Unsupported TITech environment "${effectiveEnvironment}".`,
                    {
                        code:
                            'ENVIRONMENT_SNAPSHOT_ENVIRONMENT_UNSUPPORTED',

                        details: {
                            environment:
                                effectiveEnvironment,

                            supported:
                                SUPPORTED_ENVIRONMENTS,
                        },
                    },
                );

            if (
                this.options.failClosed
            ) {

                throw error;
            }
        }

        const environmentImplementation =
            resolveEnvironmentImplementation();

        const bootstrapState =
            resolveBootstrapState();

        const environmentDiscovery =
            this.resolveEnvironmentDiscovery(
                source,
                environmentImplementation,
            );

        const dotenv =
            this.resolveDotenvDiagnostics(
                source,
                environmentImplementation,
            );

        const normalization =
            this.resolveNormalization(
                source,
                environmentImplementation,
            );

        const validation =
            this.resolveValidation(
                source,
                environmentImplementation,
            );

        const bootstrap =
            this.resolveBootstrapSnapshot(
                source,
                bootstrapState,
            );

        const environmentVariables =
            captureEnvironmentVariables(
                this.options,
            );

        const runtime =
            this.options
                .includeRuntime
                ? this.buildRuntimeSnapshot()
                : null;

        const metadata = {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                effectiveEnvironment,

            source:
                source.source ||
                SNAPSHOT_SOURCES.COMPOSITE,

            schemaVersion:
                '1.0.0',

            capturedAt:
                new Date().toISOString(),

            /**
             * Runtime environment identity.
             */
            nodeEnvironment:
                effectiveEnvironment,

            /**
             * Environment file/bootstrap information.
             */
            discovery:
                this.options
                    .includeEnvironmentMetadata
                    ? environmentDiscovery
                    : null,

            dotenv:
                this.options
                    .includeEnvironmentMetadata
                    ? dotenv
                    : null,

            normalization:
                this.options
                    .includeEnvironmentMetadata
                    ? normalization
                    : null,

            validation:
                this.options
                    .includeEnvironmentMetadata
                    ? validation
                    : null,

            bootstrap:
                this.options
                    .includeBootstrapState
                    ? bootstrap
                    : null,

            environmentVariables:
                this.options
                    .includeVariableMetadata
                    ? environmentVariables.metadata
                    : null,

            environmentValues:
                this.options
                    .includeVariableValues
                    ? environmentVariables.values
                    : null,

            runtime,

            fingerprint:
                null,
        };

        /**
         * Generate fingerprint from sanitized metadata, never from raw secrets.
         */
        if (
            this.options
                .includeSnapshotFingerprint
        ) {

            const fingerprintPayload =
                sanitizeValue(
                    {
                        ...metadata,

                        environmentValues:
                            null,

                        runtime: {
                            ...(
                                runtime ||
                                {}
                            ),

                            pid:
                                null,
                        },
                    },
                    {
                        redactSecrets:
                            true,

                        exposeSensitiveValues:
                            false,
                    },
                );

            metadata.fingerprint = {
                algorithm:
                    this.options
                        .fingerprintAlgorithm,

                value:
                    fingerprint(
                        fingerprintPayload,
                        this.options
                            .fingerprintAlgorithm,
                    ),
            };
        }

        return metadata;
    }

    /**
     * -------------------------------------------------------------------------
     * Discovery resolution.
     * -------------------------------------------------------------------------
     */

    resolveEnvironmentDiscovery(
        source,
        environmentImplementation,
    ) {

        if (
            source.discovery
        ) {

            return sanitizeValue(
                source.discovery,
                {
                    redactSecrets:
                        true,

                    exposeSensitiveValues:
                        false,
                },
            );
        }

        try {

            if (
                typeof environmentImplementation
                    ?.getEnvironmentDiscoveryDiagnostics ===
                'function'
            ) {

                return sanitizeValue(
                    environmentImplementation
                        .getEnvironmentDiscoveryDiagnostics(),
                    {
                        redactSecrets:
                            true,

                        exposeSensitiveValues:
                            false,
                    },
                );
            }

            if (
                environmentImplementation
                    ?.ENVIRONMENT_DISCOVERY
            ) {

                return sanitizeValue(
                    environmentImplementation
                        .ENVIRONMENT_DISCOVERY,
                    {
                        redactSecrets:
                            true,

                        exposeSensitiveValues:
                            false,
                    },
                );
            }

        } catch {
            // Discovery metadata is optional.
        }

        return null;
    }

    /**
     * -------------------------------------------------------------------------
     * Dotenv resolution.
     * -------------------------------------------------------------------------
     */

    resolveDotenvDiagnostics(
        source,
        environmentImplementation,
    ) {

        if (
            source.dotenv
        ) {

            return sanitizeValue(
                source.dotenv,
                {
                    redactSecrets:
                        true,

                    exposeSensitiveValues:
                        false,
                },
            );
        }

        try {

            if (
                typeof environmentImplementation
                    ?.getDotenvDiagnostics ===
                'function'
            ) {

                return sanitizeValue(
                    environmentImplementation
                        .getDotenvDiagnostics(),
                    {
                        redactSecrets:
                            true,

                        exposeSensitiveValues:
                            false,
                    },
                );
            }

        } catch {
            // Optional diagnostics.
        }

        return null;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalization resolution.
     * -------------------------------------------------------------------------
     */

    resolveNormalization(
        source,
        environmentImplementation,
    ) {

        if (
            source.normalization
        ) {

            return sanitizeValue(
                source.normalization,
                {
                    redactSecrets:
                        true,

                    exposeSensitiveValues:
                        false,
                },
            );
        }

        try {

            if (
                typeof environmentImplementation
                    ?.getNormalizationDiagnostics ===
                'function'
            ) {

                return sanitizeValue(
                    environmentImplementation
                        .getNormalizationDiagnostics(),
                    {
                        redactSecrets:
                            true,

                        exposeSensitiveValues:
                            false,
                    },
                );
            }

        } catch {
            // Optional diagnostics.
        }

        return null;
    }

    /**
     * -------------------------------------------------------------------------
     * Validation resolution.
     * -------------------------------------------------------------------------
     */

    resolveValidation(
        source,
        environmentImplementation,
    ) {

        if (
            source.validation
        ) {

            return sanitizeValue(
                source.validation,
                {
                    redactSecrets:
                        true,

                    exposeSensitiveValues:
                        false,
                },
            );
        }

        try {

            if (
                typeof environmentImplementation
                    ?.getValidationDiagnostics ===
                'function'
            ) {

                return sanitizeValue(
                    environmentImplementation
                        .getValidationDiagnostics(),
                    {
                        redactSecrets:
                            true,

                        exposeSensitiveValues:
                            false,
                    },
                );
            }

        } catch {
            // Optional diagnostics.
        }

        return null;
    }

    /**
     * -------------------------------------------------------------------------
     * Bootstrap state resolution.
     * -------------------------------------------------------------------------
     */

    resolveBootstrapSnapshot(
        source,
        bootstrapState,
    ) {

        if (
            source.bootstrap
        ) {

            return sanitizeValue(
                source.bootstrap,
                {
                    redactSecrets:
                        true,

                    exposeSensitiveValues:
                        false,
                },
            );
        }

        try {

            if (
                typeof bootstrapState?.snapshot ===
                'function'
            ) {

                return bootstrapState.snapshot(
                    {
                        exposeHistory:
                            false,

                        exposeTransitions:
                            false,
                    },
                );
            }

        } catch {
            // Optional bootstrap state.
        }

        return null;
    }

    /**
     * -------------------------------------------------------------------------
     * Runtime snapshot.
     * -------------------------------------------------------------------------
     */

    buildRuntimeSnapshot() {

        const memory =
            process.memoryUsage();

        const runtime = {};

        if (
            this.options.runtime
                .includePid
        ) {

            runtime.pid =
                process.pid;
        }

        if (
            this.options.runtime
                .includeHostname
        ) {

            runtime.hostname =
                os.hostname();
        }

        if (
            this.options.runtime
                .includePlatform
        ) {

            runtime.platform =
                process.platform;
        }

        if (
            this.options.runtime
                .includeArchitecture
        ) {

            runtime.architecture =
                process.arch;
        }

        if (
            this.options.runtime
                .includeNodeVersion
        ) {

            runtime.nodeVersion =
                process.version;
        }

        if (
            this.options.runtime
                .includeUptime
        ) {

            runtime.uptimeSeconds =
                process.uptime();
        }

        if (
            this.options.runtime
                .includeMemory
        ) {

            runtime.memory = {
                rssBytes:
                    memory.rss,

                heapUsedBytes:
                    memory.heapUsed,

                heapTotalBytes:
                    memory.heapTotal,

                externalBytes:
                    memory.external,

                arrayBuffersBytes:
                    memory.arrayBuffers,
            };
        }

        if (
            this.options.runtime
                .includeCpu
        ) {

            runtime.cpu =
                process.cpuUsage();
        }

        return runtime;
    }

    /**
     * -------------------------------------------------------------------------
     * Current live snapshot.
     * -------------------------------------------------------------------------
     */

    async current(
        options = {},
    ) {

        if (
            options.refresh
        ) {

            return this.refresh(
                options,
            );
        }

        return this.capture(
            options.source ||
            {},
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Refresh.
     * -------------------------------------------------------------------------
     */

    async refresh(
        options = {},
    ) {

        this.snapshot =
            null;

        this.state =
            SNAPSHOT_STATES
                .CREATED;

        return this.capture(
            options.source ||
            {},
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint.
     * -------------------------------------------------------------------------
     */

    getFingerprint() {

        return (
            this.snapshot
                ?.fingerprint
                ?.value ||
            null
        );
    }

    getSnapshotFingerprint() {

        return this.getFingerprint();
    }

    /**
     * -------------------------------------------------------------------------
     * Compare snapshots.
     * -------------------------------------------------------------------------
     */

    compare(
        left,
        right,
    ) {

        const first =
            this.normalizeComparableSnapshot(
                left,
            );

        const second =
            this.normalizeComparableSnapshot(
                right,
            );

        const firstFingerprint =
            fingerprint(
                first,
                this.options
                    .fingerprintAlgorithm,
            );

        const secondFingerprint =
            fingerprint(
                second,
                this.options
                    .fingerprintAlgorithm,
            );

        const changed =
            firstFingerprint !==
            secondFingerprint;

        const changedKeys =
            changed
                ? this.detectChangedKeys(
                    first,
                    second,
                )
                : [];

        return deepFreeze({
            equal:
                !changed,

            changed,

            changedKeys,

            before:
                firstFingerprint,

            after:
                secondFingerprint,

            algorithm:
                this.options
                    .fingerprintAlgorithm,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize comparison payload.
     * -------------------------------------------------------------------------
     */

    normalizeComparableSnapshot(
        snapshot,
    ) {

        const value =
            snapshot &&
            typeof snapshot ===
                'object'
                ? clone(
                    snapshot,
                )
                : {};

        /**
         * These values are expected to change between captures and therefore
         * should not produce configuration drift.
         */
        delete value.capturedAt;

        delete value.runtime?.uptimeSeconds;

        delete value.runtime?.pid;

        delete value.runtime?.memory;

        delete value.fingerprint;

        return sanitizeValue(
            value,
            {
                redactSecrets:
                    true,

                exposeSensitiveValues:
                    false,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Changed-key detection.
     * -------------------------------------------------------------------------
     */

    detectChangedKeys(
        before,
        after,
        path = '',
        output = [],
    ) {

        const beforeIsObject =
            before &&
            typeof before ===
                'object';

        const afterIsObject =
            after &&
            typeof after ===
                'object';

        if (
            !beforeIsObject ||
            !afterIsObject
        ) {

            if (
                JSON.stringify(
                    before,
                ) !==
                JSON.stringify(
                    after,
                )
            ) {

                output.push(
                    path ||
                    '$',
                );
            }

            return output;
        }

        const keys =
            new Set([
                ...Object.keys(
                    before,
                ),

                ...Object.keys(
                    after,
                ),
            ]);

        for (
            const key of
            [...keys].sort()
        ) {

            const currentPath =
                path
                    ? `${path}.${key}`
                    : key;

            if (
                JSON.stringify(
                    before[key],
                ) ===
                JSON.stringify(
                    after[key],
                )
            ) {

                continue;
            }

            if (
                before[key] &&
                after[key] &&
                typeof before[key] ===
                    'object' &&
                typeof after[key] ===
                    'object'
            ) {

                this.detectChangedKeys(
                    before[key],
                    after[key],
                    currentPath,
                    output,
                );

            } else {

                output.push(
                    currentPath,
                );
            }
        }

        return output;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate snapshot.
     * -------------------------------------------------------------------------
     */

    validate(
        snapshot =
            this.snapshot,
    ) {

        if (
            !snapshot
        ) {

            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            'SNAPSHOT_NOT_AVAILABLE',

                        message:
                            'TITech environment snapshot is unavailable.',
                    },
                ],
            };
        }

        const errors = [];

        const environment =
            normalizeEnvironment(
                snapshot.environment,
            );

        if (
            !isSupportedEnvironment(
                environment,
            )
        ) {

            errors.push({
                code:
                    'ENVIRONMENT_UNSUPPORTED',

                message:
                    `Unsupported environment "${environment}".`,
            });
        }

        if (
            !snapshot.capturedAt
        ) {

            errors.push({
                code:
                    'SNAPSHOT_TIMESTAMP_MISSING',

                message:
                    'Environment snapshot capture timestamp is missing.',
            });
        }

        if (
            this.options.includeSnapshotFingerprint &&
            !snapshot.fingerprint?.value
        ) {

            errors.push({
                code:
                    'SNAPSHOT_FINGERPRINT_MISSING',

                message:
                    'Environment snapshot fingerprint is missing.',
            });
        }

        return {
            valid:
                errors.length ===
                0,

            errors,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    async readiness() {

        const snapshot =
            await this.current();

        const validation =
            this.validate(
                snapshot,
            );

        const state =
            resolveBootstrapState();

        const bootstrapReady =
            state &&
            typeof state.isReady ===
                'function'
                ? state.isReady()
                : true;

        const ready =
            validation.valid &&
            bootstrapReady;

        return {
            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            ready,

            environment:
                snapshot.environment,

            fingerprint:
                snapshot.fingerprint?.value ||
                null,

            validation,

            bootstrapReady,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    async health() {

        try {

            const snapshot =
                await this.current();

            const validation =
                this.validate(
                    snapshot,
                );

            const bootstrapState =
                resolveBootstrapState();

            const bootstrapHealth =
                bootstrapState &&
                typeof bootstrapState.health ===
                    'function'
                    ? bootstrapState.health()
                    : null;

            const healthy =
                validation.valid &&
                (
                    !bootstrapHealth ||
                    (
                        bootstrapHealth.status !==
                        'unhealthy'
                    )
                );

            return {
                status:
                    healthy
                        ? 'healthy'
                        : 'degraded',

                healthy,

                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                environment:
                    snapshot.environment,

                fingerprint:
                    snapshot.fingerprint?.value ||
                    null,

                validation,

                bootstrap:
                    bootstrapHealth,

                timestamp:
                    new Date().toISOString(),
            };

        } catch (
            error
        ) {

            return {
                status:
                    'unhealthy',

                healthy:
                    false,

                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                error:
                    safeError(
                        error,
                    ),

                timestamp:
                    new Date().toISOString(),
            };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    getSnapshot(
        options = {},
    ) {

        if (
            !this.snapshot
        ) {

            return null;
        }

        const output =
            clone(
                this.snapshot,
            );

        if (
            !options.exposeValues
        ) {

            delete output.environmentValues;
        }

        return deepFreeze(
            sanitizeValue(
                output,
                {
                    redactSecrets:
                        true,

                    exposeSensitiveValues:
                        false,
                },
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * State.
     * -------------------------------------------------------------------------
     */

    getState() {

        return Object.freeze({
            component:
                COMPONENT,

            state:
                this.state,

            createdAt:
                this.createdAt,

            capturedAt:
                this.capturedAt,

            hasSnapshot:
                Boolean(
                    this.snapshot,
                ),

            fingerprint:
                this.getFingerprint(),

            error:
                safeError(
                    this.error,
                ),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        if (
            this._capturePromise
        ) {

            throw new EnvironmentSnapshotError(
                'Cannot reset TITech environment snapshot while capture is in progress.',
                {
                    code:
                        'ENVIRONMENT_SNAPSHOT_RESET_NOT_ALLOWED',
                },
            );
        }

        this.state =
            SNAPSHOT_STATES.CREATED;

        this.createdAt =
            null;

        this.capturedAt =
            null;

        this.snapshot =
            null;

        this.error =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const environmentSnapshot =
    new EnvironmentSnapshot({
        environment:
            process.env.NODE_ENV ||
            DEFAULTS.environment,

        strict:
            true,

        failClosed:
            true,

        redactSecrets:
            true,

        exposeSensitiveValues:
            false,

        includeVariableValues:
            false,
    });

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

async function capture(
    source,
) {

    return environmentSnapshot.capture(
        source,
    );
}

async function current(
    options,
) {

    return environmentSnapshot.current(
        options,
    );
}

async function refresh(
    options,
) {

    return environmentSnapshot.refresh(
        options,
    );
}

function compare(
    left,
    right,
) {

    return environmentSnapshot.compare(
        left,
        right,
    );
}

function validate(
    snapshot,
) {

    return environmentSnapshot.validate(
        snapshot,
    );
}

function getFingerprint() {

    return environmentSnapshot.getFingerprint();
}

async function readiness() {

    return environmentSnapshot.readiness();
}

async function health() {

    return environmentSnapshot.health();
}

function getSnapshot(
    options,
) {

    return environmentSnapshot.getSnapshot(
        options,
    );
}

function getState() {

    return environmentSnapshot.getState();
}

function reset() {

    return environmentSnapshot.reset();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Singleton.
         */
        environmentSnapshot,

        EnvironmentSnapshot,

        EnvironmentSnapshotError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ENVIRONMENT_NAMES,

        SUPPORTED_ENVIRONMENTS,

        SNAPSHOT_STATES,

        SNAPSHOT_SOURCES,

        DEFAULTS,

        /**
         * Capture.
         */
        capture,

        current,

        refresh,

        /**
         * Validation and comparison.
         */
        validate,

        compare,

        fingerprint,

        getFingerprint,

        /**
         * Operational state.
         */
        readiness,

        health,

        getState,

        getSnapshot,

        /**
         * Environment helpers.
         */
        normalizeEnvironment,

        isSupportedEnvironment,

        /**
         * Test support.
         */
        reset,
    });