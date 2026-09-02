'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/layerMerger.js
 *
 * Purpose:
 *   Enterprise production-grade environment configuration layer merger.
 *
 * Responsibilities:
 *   - Merge layered TITech environment configuration deterministically.
 *   - Enforce explicit layer precedence.
 *   - Preserve process/runtime environment precedence rules.
 *   - Prevent accidental prototype pollution.
 *   - Support dotenv/base/environment/local/runtime layers.
 *   - Provide immutable merged output.
 *   - Track provenance of configuration values.
 *   - Detect conflicting layer definitions.
 *   - Detect invalid/sensitive override attempts.
 *   - Support controlled deletion/unset semantics.
 *   - Produce deterministic configuration fingerprints.
 *   - Provide safe diagnostics and merge reports.
 *
 * IMPORTANT:
 *
 *   This module performs CONFIGURATION LAYER COMPOSITION.
 *
 *   It does NOT:
 *     - mutate process.env.
 *     - load dotenv files.
 *     - validate the complete application configuration.
 *     - initialize MongoDB.
 *     - initialize Redis.
 *     - initialize queues.
 *     - initialize Express.
 *     - start HTTP servers.
 *     - execute financial transactions.
 *     - implement tenant authorization.
 *
 * Environment loading is owned by:
 *
 *   backend/config/environment.js
 *
 * Environment validation is owned by:
 *
 *   backend/config/environment/environmentValidator.js
 *
 * Environment state is owned by:
 *
 *   backend/config/environment/bootstrapState.js
 *
 * Environment snapshots are owned by:
 *
 *   backend/config/environment/environmentSnapshot.js
 *
 * =============================================================================
 *
 * Canonical layer precedence:
 *
 *   defaults
 *       ↓
 *   base
 *       ↓
 *   environment
 *       ↓
 *   local
 *       ↓
 *   runtime
 *
 * Higher layers override lower layers.
 *
 * Runtime process environment can be passed explicitly as the final layer.
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-layer-merger';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const MERGE_STATES =
    Object.freeze({
        CREATED:
            'created',

        MERGING:
            'merging',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        FAILED:
            'failed',
    });

const LAYER_TYPES =
    Object.freeze({
        DEFAULTS:
            'defaults',

        BASE:
            'base',

        ENVIRONMENT:
            'environment',

        LOCAL:
            'local',

        RUNTIME:
            'runtime',

        EXPLICIT:
            'explicit',
    });

const MERGE_STATUSES =
    Object.freeze({
        APPLIED:
            'applied',

        UNCHANGED:
            'unchanged',

        IGNORED:
            'ignored',

        CONFLICT:
            'conflict',

        REJECTED:
            'rejected',

        DELETED:
            'deleted',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        allowUnknownLayers:
            false,

        allowNullValues:
            true,

        allowUndefinedValues:
            false,

        allowDeletion:
            false,

        allowRuntimeOverrides:
            true,

        detectConflicts:
            true,

        failOnConflict:
            false,

        trackProvenance:
            true,

        freezeResult:
            true,

        freezeLayers:
            false,

        cloneInputs:
            true,

        /**
         * Arrays are replaced atomically by default rather than concatenated.
         * This avoids silently changing security-sensitive lists.
         */
        arrayStrategy:
            'replace',

        /**
         * Objects are merged recursively by default.
         */
        objectStrategy:
            'merge',

        maxDepth:
            16,

        maxKeys:
            10_000,

        maxLayerCount:
            20,

        maxKeyLength:
            255,

        maxValueLength:
            16_384,

        fingerprintAlgorithm:
            'sha256',

        /**
         * Prototype pollution protection.
         */
        forbiddenKeys:
            Object.freeze([
                '__proto__',
                'prototype',
                'constructor',
            ]),

        /**
         * Security-sensitive configuration roots should not normally be
         * overridable from arbitrary environment layers.
         *
         * Layer policy can explicitly override these controls through
         * `protectedPaths` / `allowProtectedPaths`.
         */
        protectedPaths:
            Object.freeze([
                'security.*',
                'encryption.*',
                'crypto.*',
                'credentials.*',
                'secrets.*',
                'jwt.secret',
                'jwt.signingKey',
                'jwt.privateKey',
                'database.password',
                'database.uri',
                'db.password',
                'db.uri',
                'redis.password',
                'redis.url',
                'redis.credentials.*',
                'tenantIsolation.*',
                'financial.ledger.*',
                'financial.transaction.*',
                'financial.idempotency.*',
                'audit.integrity.*',
                'audit.signing.*',
            ]),

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt[_-]?secret|access[_-]?token|refresh[_-]?token|cookie|credential|signing[_-]?key)/i,
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class LayerMergerError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'LayerMergerError';

        this.code =
            options.code ||
            'ENVIRONMENT_LAYER_MERGER_ERROR';

        this.layer =
            options.layer ||
            null;

        this.path =
            options.path ||
            null;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            LayerMergerError,
        );
    }
}

/**
 * =============================================================================
 * Utilities
 * =============================================================================
 */

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
            // Continue with recursive clone.
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

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !==
        'object'
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

function stableStringify(
    value,
) {

    if (
        value === null ||
        typeof value !== 'object'
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

function isPlainObject(
    value,
) {

    if (
        value === null ||
        typeof value !== 'object'
    ) {

        return false;
    }

    const prototype =
        Object.getPrototypeOf(
            value,
        );

    return (
        prototype ===
            Object.prototype ||
        prototype === null
    );
}

function normalizePath(
    value,
) {

    const path =
        String(
            value || '',
        )
            .trim()
            .replace(
                /^\./,
                '',
            )
            .replace(
                /\[(\w+)\]/g,
                '.$1',
            );

    return path
        .split('.')
        .filter(Boolean)
        .join('.');
}

function splitPath(
    value,
) {

    return normalizePath(
        value,
    )
        .split('.')
        .filter(Boolean);
}

function isForbiddenKey(
    value,
    forbiddenKeys =
        DEFAULTS.forbiddenKeys,
) {

    return forbiddenKeys.includes(
        value,
    );
}

function isSensitivePath(
    value,
) {

    return DEFAULTS
        .sensitivePattern
        .test(
            normalizePath(
                value,
            ),
        );
}

function isObjectLike(
    value,
) {

    return (
        value !== null &&
        typeof value ===
            'object'
    );
}

function getAtPath(
    object,
    path,
) {

    const parts =
        splitPath(
            path,
        );

    let current =
        object;

    for (
        const part of
        parts
    ) {

        if (
            current === null ||
            current === undefined
        ) {

            return undefined;
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                Object(
                    current,
                ),
                part,
            )
        ) {

            return undefined;
        }

        current =
            current[part];
    }

    return current;
}

function hasAtPath(
    object,
    path,
) {

    const parts =
        splitPath(
            path,
        );

    if (
        parts.length === 0
    ) {

        return false;
    }

    let current =
        object;

    for (
        const part of
        parts
    ) {

        if (
            current === null ||
            current === undefined ||
            !Object.prototype.hasOwnProperty.call(
                Object(
                    current,
                ),
                part,
            )
        ) {

            return false;
        }

        current =
            current[part];
    }

    return true;
}

function setAtPath(
    object,
    path,
    value,
) {

    const parts =
        splitPath(
            path,
        );

    if (
        parts.length === 0
    ) {

        throw new LayerMergerError(
            'Configuration path is required.',
            {
                code:
                    'LAYER_MERGER_PATH_REQUIRED',
            },
        );
    }

    let current =
        object;

    for (
        let index = 0;
        index < parts.length;
        index += 1
    ) {

        const part =
            parts[index];

        if (
            isForbiddenKey(
                part,
            )
        ) {

            throw new LayerMergerError(
                `Forbidden configuration key "${part}".`,
                {
                    code:
                        'LAYER_MERGER_FORBIDDEN_KEY',

                    path,
                },
            );
        }

        const last =
            index ===
            parts.length - 1;

        if (
            last
        ) {

            current[part] =
                value;

            continue;
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                current,
                part,
            ) ||
            !isPlainObject(
                current[part],
            )
        ) {

            current[part] =
                {};
        }

        current =
            current[part];
    }

    return object;
}

function deleteAtPath(
    object,
    path,
) {

    const parts =
        splitPath(
            path,
        );

    if (
        parts.length === 0
    ) {

        return false;
    }

    let current =
        object;

    for (
        let index = 0;
        index < parts.length - 1;
        index += 1
    ) {

        const part =
            parts[index];

        if (
            current === null ||
            current === undefined ||
            !Object.prototype.hasOwnProperty.call(
                current,
                part,
            )
        ) {

            return false;
        }

        current =
            current[part];

        if (
            !isPlainObject(
                current,
            )
        ) {

            return false;
        }
    }

    const leaf =
        parts[
            parts.length - 1
        ];

    if (
        !Object.prototype.hasOwnProperty.call(
            current,
            leaf,
        )
    ) {

        return false;
    }

    delete current[leaf];

    return true;
}

function valuesEqual(
    left,
    right,
) {

    return (
        stableStringify(
            left,
        ) ===
        stableStringify(
            right,
        )
    );
}

function countKeys(
    value,
    depth = 0,
    maxDepth =
        DEFAULTS.maxDepth,
) {

    if (
        depth >
        maxDepth
    ) {

        throw new LayerMergerError(
            'Configuration object exceeds maximum nesting depth.',
            {
                code:
                    'LAYER_MERGER_MAX_DEPTH_EXCEEDED',
            },
        );
    }

    if (
        !isObjectLike(
            value,
        )
    ) {

        return 1;
    }

    let total =
        0;

    for (
        const [
            key,
            child,
        ] of Object.entries(
            value,
        )
    ) {

        if (
            isForbiddenKey(
                key,
            )
        ) {

            throw new LayerMergerError(
                `Forbidden configuration key "${key}".`,
                {
                    code:
                        'LAYER_MERGER_FORBIDDEN_KEY',

                    path:
                        key,
                },
            );
        }

        total += 1;

        if (
            isObjectLike(
                child,
            )
        ) {

            total +=
                countKeys(
                    child,
                    depth + 1,
                    maxDepth,
                );
        }
    }

    return total;
}

function collectLeafPaths(
    value,
    basePath = '',
    output = [],
    depth = 0,
    maxDepth =
        DEFAULTS.maxDepth,
) {

    if (
        depth >
        maxDepth
    ) {

        throw new LayerMergerError(
            'Configuration object exceeds maximum nesting depth.',
            {
                code:
                    'LAYER_MERGER_MAX_DEPTH_EXCEEDED',
            },
        );
    }

    if (
        !isPlainObject(
            value,
        )
    ) {

        if (
            basePath
        ) {

            output.push(
                basePath,
            );
        }

        return output;
    }

    const entries =
        Object.entries(
            value,
        );

    if (
        entries.length ===
        0 &&
        basePath
    ) {

        output.push(
            basePath,
        );

        return output;
    }

    for (
        const [
            key,
            child,
        ] of entries
    ) {

        if (
            isForbiddenKey(
                key,
            )
        ) {

            throw new LayerMergerError(
                `Forbidden configuration key "${key}".`,
                {
                    code:
                        'LAYER_MERGER_FORBIDDEN_KEY',

                    path:
                        basePath
                            ? `${basePath}.${key}`
                            : key,
                },
            );
        }

        const path =
            basePath
                ? `${basePath}.${key}`
                : key;

        if (
            isPlainObject(
                child,
            )
        ) {

            collectLeafPaths(
                child,
                path,
                output,
                depth + 1,
                maxDepth,
            );

        } else {

            output.push(
                path,
            );
        }
    }

    return output;
}

function redactValue(
    value,
    path = '',
    options = {},
) {

    if (
        options.exposeSensitiveValues
    ) {

        return clone(
            value,
        );
    }

    if (
        isSensitivePath(
            path,
        )
    ) {

        return '[REDACTED]';
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            (
                item,
                index,
            ) =>
                redactValue(
                    item,
                    `${path}.${index}`,
                    options,
                ),
        );
    }

    if (
        isPlainObject(
            value,
        )
    ) {

        const output = {};

        for (
            const [
                key,
                child,
            ] of Object.entries(
                value,
            )
        ) {

            const childPath =
                path
                    ? `${path}.${key}`
                    : key;

            output[key] =
                redactValue(
                    child,
                    childPath,
                    options,
                );
        }

        return output;
    }

    return value;
}

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console
        );

    } catch {

        return console;
    }
}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            getLogger();

        if (
            typeof logger?.[level] ===
            'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Merge subsystem must not depend on logger availability.
    }
}

/**
 * =============================================================================
 * Layer normalization
 * =============================================================================
 */

function normalizeLayer(
    layer,
    index,
    options,
) {

    if (
        !layer
    ) {

        throw new LayerMergerError(
            'Configuration layer is required.',
            {
                code:
                    'LAYER_MERGER_LAYER_REQUIRED',

                layer:
                    index,
            },
        );
    }

    const name =
        String(
            layer.name ||
            layer.type ||
            `layer-${index}`,
        )
            .trim();

    const type =
        String(
            layer.type ||
            name,
        )
            .trim()
            .toLowerCase();

    if (
        !name
    ) {

        throw new LayerMergerError(
            'Configuration layer name is required.',
            {
                code:
                    'LAYER_MERGER_LAYER_NAME_REQUIRED',

                layer:
                    index,
            },
        );
    }

    if (
        !options.allowUnknownLayers &&
        !Object.values(
            LAYER_TYPES,
        ).includes(
            type,
        )
    ) {

        throw new LayerMergerError(
            `Unknown TITech configuration layer "${type}".`,
            {
                code:
                    'LAYER_MERGER_UNKNOWN_LAYER',

                layer:
                    name,
            },
        );
    }

    const source =
        layer.values ??
        layer.config ??
        layer.data ??
        layer;

    if (
        source === layer
    ) {

        /**
         * Remove metadata fields when the layer itself is the configuration
         * object.
         */
        const {
            name: ignoredName,
            type: ignoredType,
            priority: ignoredPriority,
            source: ignoredSource,
            metadata: ignoredMetadata,
            allowProtectedPaths: ignoredAllowProtectedPaths,
            unset: ignoredUnset,
            ...configuration
        } = layer;

        return {
            name,

            type,

            priority:
                Number.isFinite(
                    layer.priority,
                )
                    ? Number(
                        layer.priority,
                    )
                    : index,

            values:
                configuration,

            metadata:
                clone(
                    layer.metadata ||
                    {},
                ),

            allowProtectedPaths:
                layer.allowProtectedPaths ===
                true,

            unset:
                layer.unset ||
                null,

            index,
        };
    }

    return {
        name,

        type,

        priority:
            Number.isFinite(
                layer.priority,
            )
                ? Number(
                    layer.priority,
                )
                : index,

        values:
            source &&
            typeof source ===
                'object'
                ? clone(
                    source,
                )
                : {},

        metadata:
            clone(
                layer.metadata ||
                {},
            ),

        allowProtectedPaths:
            layer.allowProtectedPaths ===
            true,

        unset:
            layer.unset ||
            null,

        index,
    };
}

/**
 * =============================================================================
 * LayerMerger
 * =============================================================================
 */

class LayerMerger {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,

                protectedPaths:
                    Object.freeze([
                        ...(
                            options.protectedPaths ||
                            DEFAULTS.protectedPaths
                        ),
                    ]),

                forbiddenKeys:
                    Object.freeze([
                        ...(
                            options.forbiddenKeys ||
                            DEFAULTS.forbiddenKeys
                        ),
                    ]),
            });

        this.state =
            MERGE_STATES.CREATED;

        this.lastResult =
            null;

        this.lastError =
            null;

        this.startedAt =
            null;

        this.completedAt =
            null;

        this.history =
            [];

        this._mergePromise =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Merge.
     * -------------------------------------------------------------------------
     */

    merge(
        layers = [],
        options = {},
    ) {

        if (
            this._mergePromise
        ) {

            return this._mergePromise;
        }

        this._mergePromise =
            Promise.resolve().then(
                () =>
                    this.performMerge(
                        layers,
                        options,
                    ),
            );

        return this._mergePromise.finally(
            () => {
                this._mergePromise =
                    null;
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Synchronous merge.
     * -------------------------------------------------------------------------
     */

    mergeSync(
        layers = [],
        options = {},
    ) {

        return this.performMerge(
            layers,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Internal merge engine.
     * -------------------------------------------------------------------------
     */

    performMerge(
        layers = [],
        options = {},
    ) {

        const started =
            process.hrtime.bigint();

        this.state =
            MERGE_STATES.MERGING;

        this.lastError =
            null;

        this.startedAt =
            new Date();

        try {

            if (
                !Array.isArray(
                    layers,
                )
            ) {

                throw new LayerMergerError(
                    'TITech configuration layers must be supplied as an array.',
                    {
                        code:
                            'LAYER_MERGER_LAYERS_ARRAY_REQUIRED',
                    },
                );
            }

            if (
                layers.length >
                this.options.maxLayerCount
            ) {

                throw new LayerMergerError(
                    'TITech configuration layer count exceeds the configured maximum.',
                    {
                        code:
                            'LAYER_MERGER_LAYER_COUNT_EXCEEDED',

                        details: {
                            count:
                                layers.length,

                            maximum:
                                this.options.maxLayerCount,
                        },
                    },
                );
            }

            const normalizedLayers =
                layers.map(
                    (
                        layer,
                        index,
                    ) =>
                        normalizeLayer(
                            layer,
                            index,
                            this.options,
                        ),
                );

            /**
             * Lower priority/index first; higher priority layers override.
             */
            normalizedLayers.sort(
                (
                    left,
                    right,
                ) =>
                    left.priority -
                    right.priority ||
                    left.index -
                    right.index,
            );

            const result = {};

            const provenance =
                {};

            const report = {
                layers:
                    [],

                changes:
                    [],

                conflicts:
                    [],

                rejected:
                    [],

                ignored:
                    [],

                deleted:
                    [],

                warnings:
                    [],

                errors:
                    [],
            };

            let totalKeys =
                0;

            for (
                const layer of
                normalizedLayers
            ) {

                const layerReport =
                    this.applyLayer(
                        result,
                        provenance,
                        layer,
                        report,
                        options,
                    );

                report.layers.push(
                    layerReport,
                );

                totalKeys =
                    countKeys(
                        result,
                        0,
                        this.options.maxDepth,
                    );

                if (
                    totalKeys >
                    this.options.maxKeys
                ) {

                    throw new LayerMergerError(
                        'Merged TITech configuration exceeds the configured key limit.',
                        {
                            code:
                                'LAYER_MERGER_KEY_LIMIT_EXCEEDED',

                            details: {
                                maximum:
                                    this.options.maxKeys,
                            },
                        },
                    );
                }
            }

            /**
             * Explicit runtime layer can be requested as final precedence even
             * when callers provided the layers in arbitrary order.
             */
            const finalResult =
                this.options.cloneInputs ||
                options.cloneResult
                    ? clone(
                        result,
                    )
                    : result;

            const safeProvenance =
                this.options.trackProvenance
                    ? clone(
                        provenance,
                    )
                    : {};

            const fingerprintPayload =
                this.buildFingerprintPayload(
                    finalResult,
                );

            const fingerprintValue =
                fingerprint(
                    fingerprintPayload,
                    this.options
                        .fingerprintAlgorithm,
                );

            const warnings =
                [
                    ...report.warnings,
                ];

            const conflicts =
                [
                    ...report.conflicts,
                ];

            const errors =
                [
                    ...report.errors,
                ];

            if (
                this.options.failOnConflict &&
                conflicts.length >
                0
            ) {

                throw new LayerMergerError(
                    'TITech configuration layer conflicts were detected.',
                    {
                        code:
                            'LAYER_MERGER_CONFLICTS_DETECTED',

                        details: {
                            conflicts,
                        },
                    },
                );
            }

            if (
                this.options.failClosed &&
                errors.length >
                0
            ) {

                throw new LayerMergerError(
                    'TITech configuration layer merging failed.',
                    {
                        code:
                            'LAYER_MERGER_ERRORS_DETECTED',

                        details: {
                            errors,
                        },
                    },
                );
            }

            const durationMs =
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000;

            const output = {
                status:
                    conflicts.length >
                        0 ||
                    warnings.length >
                        0
                        ? MERGE_STATES.DEGRADED
                        : MERGE_STATES.READY,

                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                application:
                    APPLICATION_NAME,

                configuration:
                    finalResult,

                provenance:
                    safeProvenance,

                report: {
                    ...report,

                    totalKeys,

                    layerCount:
                        normalizedLayers.length,

                    durationMs:
                        Number(
                            durationMs.toFixed(
                                3,
                            ),
                        ),
                },

                fingerprint: {
                    algorithm:
                        this.options
                            .fingerprintAlgorithm,

                    value:
                        fingerprintValue,
                },

                timestamp:
                    new Date().toISOString(),
            };

            this.lastResult =
                this.options.freezeResult
                    ? deepFreeze(
                        output,
                    )
                    : output;

            this.completedAt =
                new Date();

            this.state =
                warnings.length >
                    0 ||
                conflicts.length >
                    0
                    ? MERGE_STATES.DEGRADED
                    : MERGE_STATES.READY;

            this.recordHistory(
                {
                    type:
                        'merge.completed',

                    status:
                        this.state,

                    layers:
                        normalizedLayers.length,

                    totalKeys,

                    warnings:
                        warnings.length,

                    conflicts:
                        conflicts.length,

                    fingerprint:
                        fingerprintValue,
                },
            );

            log(
                warnings.length >
                    0 ||
                conflicts.length >
                    0
                    ? 'warn'
                    : 'info',
                {
                    state:
                        this.state,

                    layers:
                        normalizedLayers.length,

                    totalKeys,

                    warnings:
                        warnings.length,

                    conflicts:
                        conflicts.length,
                },
                warnings.length >
                    0 ||
                conflicts.length >
                    0
                    ? 'TITech configuration layers merged with warnings.'
                    : 'TITech configuration layers merged successfully.',
            );

            return this.lastResult;

        } catch (
            error
        ) {

            this.state =
                MERGE_STATES.FAILED;

            this.lastError =
                error;

            this.completedAt =
                new Date();

            this.recordHistory(
                {
                    type:
                        'merge.failed',

                    error:
                        {
                            name:
                                error?.name,

                            code:
                                error?.code,

                            message:
                                error?.message,
                        },
                },
            );

            log(
                'error',
                {
                    error:
                        {
                            name:
                                error?.name,

                            code:
                                error?.code,

                            message:
                                error?.message,
                        },
                },
                'TITech configuration layer merge failed.',
            );

            throw (
                error instanceof
                LayerMergerError
                    ? error
                    : new LayerMergerError(
                        'TITech configuration layer merge failed.',
                        {
                            code:
                                'LAYER_MERGER_RUNTIME_FAILURE',

                            cause:
                                error,
                        },
                    )
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Apply one layer.
     * -------------------------------------------------------------------------
     */

    applyLayer(
        target,
        provenance,
        layer,
        report,
        options,
    ) {

        const layerReport = {
            name:
                layer.name,

            type:
                layer.type,

            priority:
                layer.priority,

            status:
                MERGE_STATUSES.APPLIED,

            keys:
                0,

            changes:
                0,

            unchanged:
                0,

            rejected:
                0,

            deleted:
                0,
        };

        /**
         * Validate layer shape.
         */
        if (
            !isPlainObject(
                layer.values,
            )
        ) {

            throw new LayerMergerError(
                `TITech configuration layer "${layer.name}" must contain a plain object.`,
                {
                    code:
                        'LAYER_MERGER_LAYER_VALUES_INVALID',

                    layer:
                        layer.name,
                },
            );
        }

        const keyCount =
            countKeys(
                layer.values,
                0,
                this.options.maxDepth,
            );

        layerReport.keys =
            keyCount;

        const leafPaths =
            collectLeafPaths(
                layer.values,
                '',
                [],
                0,
                this.options.maxDepth,
            );

        for (
            const path of
            leafPaths
        ) {

            const exists =
                hasAtPath(
                    target,
                    path,
                );

            const incoming =
                getAtPath(
                    layer.values,
                    path,
                );

            const current =
                getAtPath(
                    target,
                    path,
                );

            const sourceIsSensitive =
                isSensitivePath(
                    path,
                );

            /**
             * Protected-path policy.
             */
            if (
                this.isProtectedPath(
                    path,
                ) &&
                !(
                    layer.allowProtectedPaths ||
                    options.allowProtectedPaths
                )
            ) {

                report.rejected.push(
                    this.createSafeChangeRecord(
                        {
                            path,
                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.REJECTED,

                            reason:
                                'protected-path',

                            incoming,
                        },
                    ),
                );

                layerReport.rejected +=
                    1;

                continue;
            }

            /**
             * Sensitive configuration can only be overridden by an explicitly
             * trusted layer.
             */
            if (
                sourceIsSensitive &&
                layer.type !==
                    LAYER_TYPES.RUNTIME &&
                !(
                    layer.allowProtectedPaths ||
                    options.allowProtectedPaths
                )
            ) {

                report.rejected.push(
                    this.createSafeChangeRecord(
                        {
                            path,
                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.REJECTED,

                            reason:
                                'sensitive-path',

                            incoming,
                        },
                    ),
                );

                layerReport.rejected +=
                    1;

                continue;
            }

            if (
                incoming ===
                undefined &&
                !this.options
                    .allowUndefinedValues
            ) {

                report.ignored.push(
                    this.createSafeChangeRecord(
                        {
                            path,
                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.IGNORED,

                            reason:
                                'undefined-value',

                            incoming,
                        },
                    ),
                );

                layerReport.unchanged +=
                    1;

                continue;
            }

            if (
                incoming ===
                    null &&
                !this.options
                    .allowNullValues
            ) {

                report.ignored.push(
                    this.createSafeChangeRecord(
                        {
                            path,
                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.IGNORED,

                            reason:
                                'null-value',

                            incoming,
                        },
                    ),
                );

                layerReport.unchanged +=
                    1;

                continue;
            }

            /**
             * Conflict detection.
             */
            if (
                exists &&
                !valuesEqual(
                    current,
                    incoming,
                ) &&
                this.options
                    .detectConflicts
            ) {

                const conflict =
                    this.createSafeChangeRecord(
                        {
                            path,

                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.CONFLICT,

                            previous:
                                current,

                            incoming,

                            previousSource:
                                provenance[
                                    path
                                ]?.source ||
                                null,
                        },
                    );

                report.conflicts.push(
                    conflict,
                );
            }

            /**
             * Apply according to value strategy.
             */
            const merged =
                this.resolveValue(
                    current,
                    incoming,
                    path,
                );

            if (
                exists &&
                valuesEqual(
                    current,
                    merged,
                )
            ) {

                report.ignored.push(
                    this.createSafeChangeRecord(
                        {
                            path,

                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.UNCHANGED,

                            current,
                        },
                    ),
                );

                layerReport.unchanged +=
                    1;

                /**
                 * Provenance still advances only when the same effective value
                 * was explicitly supplied by a higher-precedence layer.
                 */
                provenance[path] =
                    this.createProvenanceRecord(
                        layer,
                        path,
                        merged,
                    );

                continue;
            }

            setAtPath(
                target,
                path,
                clone(
                    merged,
                ),
            );

            provenance[path] =
                this.createProvenanceRecord(
                    layer,
                    path,
                    merged,
                );

            report.changes.push(
                this.createSafeChangeRecord(
                    {
                        path,

                        layer:
                            layer.name,

                        layerType:
                            layer.type,

                        status:
                            MERGE_STATUSES.APPLIED,

                        previous:
                            exists
                                ? current
                                : undefined,

                        incoming:
                            merged,
                    },
                ),
            );

            layerReport.changes +=
                1;
        }

        /**
         * Explicit unsets/deletions are processed after values so a layer may
         * intentionally remove lower-layer configuration.
         */
        if (
            this.options.allowDeletion &&
            layer.unset
        ) {

            this.applyUnsetPaths(
                target,
                provenance,
                layer,
                report,
                layerReport,
                options,
            );
        }

        return layerReport;
    }

    /**
     * -------------------------------------------------------------------------
     * Apply unsets.
     * -------------------------------------------------------------------------
     */

    applyUnsetPaths(
        target,
        provenance,
        layer,
        report,
        layerReport,
        options,
    ) {

        const unsetPaths =
            Array.isArray(
                layer.unset,
            )
                ? layer.unset
                : [
                    layer.unset,
                ];

        for (
            const rawPath of
            unsetPaths
        ) {

            const path =
                normalizePath(
                    rawPath,
                );

            if (
                !path
            ) {

                continue;
            }

            if (
                this.isProtectedPath(
                    path,
                ) &&
                !(
                    layer.allowProtectedPaths ||
                    options.allowProtectedPaths
                )
            ) {

                report.rejected.push(
                    this.createSafeChangeRecord(
                        {
                            path,

                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.REJECTED,

                            reason:
                                'protected-unset',
                        },
                    ),
                );

                layerReport.rejected +=
                    1;

                continue;
            }

            if (
                deleteAtPath(
                    target,
                    path,
                )
            ) {

                delete provenance[path];

                report.deleted.push(
                    this.createSafeChangeRecord(
                        {
                            path,

                            layer:
                                layer.name,

                            layerType:
                                layer.type,

                            status:
                                MERGE_STATUSES.DELETED,
                        },
                    ),
                );

                layerReport.deleted +=
                    1;
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve value according to strategy.
     * -------------------------------------------------------------------------
     */

    resolveValue(
        current,
        incoming,
        path,
    ) {

        if (
            Array.isArray(
                incoming,
            )
        ) {

            switch (
                this.options.arrayStrategy
            ) {

                case 'append':

                    return [
                        ...(
                            Array.isArray(
                                current,
                            )
                                ? current
                                : []
                        ),
                        ...incoming,
                    ];

                case 'unique':

                    return [
                        ...new Map(
                            [
                                ...(
                                    Array.isArray(
                                        current,
                                    )
                                        ? current
                                        : []
                                ),

                                ...incoming,
                            ].map(
                                item => [
                                    stableStringify(
                                        item,
                                    ),
                                    item,
                                ],
                            ),
                        ).values(),
                    ];

                case 'replace':
                default:

                    return clone(
                        incoming,
                    );
            }
        }

        if (
            isPlainObject(
                incoming,
            ) &&
            isPlainObject(
                current,
            ) &&
            this.options.objectStrategy ===
                'merge'
        ) {

            return this.deepMergeObjects(
                current,
                incoming,
                path,
            );
        }

        return clone(
            incoming,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Recursive object merge.
     * -------------------------------------------------------------------------
     */

    deepMergeObjects(
        current,
        incoming,
        basePath = '',
        depth = 0,
    ) {

        if (
            depth >
            this.options.maxDepth
        ) {

            throw new LayerMergerError(
                'TITech configuration object merge exceeded maximum depth.',
                {
                    code:
                        'LAYER_MERGER_MAX_DEPTH_EXCEEDED',

                    path:
                        basePath,
                },
            );
        }

        const result =
            clone(
                current,
            );

        for (
            const [
                key,
                value,
            ] of Object.entries(
                incoming,
            )
        ) {

            if (
                isForbiddenKey(
                    key,
                    this.options
                        .forbiddenKeys,
                )
            ) {

                throw new LayerMergerError(
                    `Forbidden configuration key "${key}".`,
                    {
                        code:
                            'LAYER_MERGER_FORBIDDEN_KEY',

                        path:
                            basePath
                                ? `${basePath}.${key}`
                                : key,
                    },
                );
            }

            const path =
                basePath
                    ? `${basePath}.${key}`
                    : key;

            const exists =
                Object.prototype.hasOwnProperty.call(
                    result,
                    key,
                );

            if (
                isPlainObject(
                    value,
                ) &&
                isPlainObject(
                    result[key],
                )
            ) {

                result[key] =
                    this.deepMergeObjects(
                        result[key],
                        value,
                        path,
                        depth + 1,
                    );

                continue;
            }

            if (
                Array.isArray(
                    value,
                )
            ) {

                result[key] =
                    this.resolveValue(
                        exists
                            ? result[key]
                            : undefined,
                        value,
                        path,
                    );

                continue;
            }

            result[key] =
                clone(
                    value,
                );
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Protected path matching.
     * -------------------------------------------------------------------------
     */

    isProtectedPath(
        path,
    ) {

        const normalized =
            normalizePath(
                path,
            );

        return this.options
            .protectedPaths
            .some(
                pattern =>
                    this.pathMatchesPattern(
                        normalized,
                        pattern,
                    ),
            );
    }

    pathMatchesPattern(
        path,
        pattern,
    ) {

        const pathParts =
            normalizePath(
                path,
            )
                .split('.')
                .filter(Boolean);

        const patternParts =
            normalizePath(
                pattern,
            )
                .split('.')
                .filter(Boolean);

        if (
            patternParts.length ===
            0
        ) {

            return false;
        }

        /**
         * Support terminal wildcard:
         *
         *   financial.ledger.*
         */
        if (
            patternParts[
                patternParts.length - 1
            ] === '*'
        ) {

            const prefix =
                patternParts.slice(
                    0,
                    -1,
                );

            if (
                pathParts.length <
                prefix.length
            ) {

                return false;
            }

            return prefix.every(
                (
                    segment,
                    index,
                ) =>
                    segment ===
                        '*' ||
                    segment ===
                        pathParts[index],
            );
        }

        if (
            pathParts.length !==
            patternParts.length
        ) {

            return false;
        }

        return patternParts.every(
            (
                segment,
                index,
            ) =>
                segment === '*' ||
                segment ===
                    pathParts[index],
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Provenance.
     * -------------------------------------------------------------------------
     */

    createProvenanceRecord(
        layer,
        path,
        value,
    ) {

        return {
            path,

            source:
                layer.name,

            layerType:
                layer.type,

            priority:
                layer.priority,

            index:
                layer.index,

            sensitive:
                isSensitivePath(
                    path,
                ),

            valueFingerprint:
                fingerprint(
                    value,
                    this.options
                        .fingerprintAlgorithm,
                ),

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Safe report records.
     * -------------------------------------------------------------------------
     */

    createSafeChangeRecord(
        record,
    ) {

        const safe = {
            path:
                record.path,

            layer:
                record.layer,

            layerType:
                record.layerType,

            status:
                record.status,

            reason:
                record.reason ||
                null,

            previousSource:
                record.previousSource ||
                null,
        };

        if (
            record.previous !==
            undefined
        ) {

            safe.previous =
                redactValue(
                    record.previous,
                    record.path,
                    {
                        exposeSensitiveValues:
                            false,
                    },
                );
        }

        if (
            record.incoming !==
            undefined
        ) {

            safe.incoming =
                redactValue(
                    record.incoming,
                    record.path,
                    {
                        exposeSensitiveValues:
                            false,
                    },
                );
        }

        if (
            record.current !==
            undefined
        ) {

            safe.current =
                redactValue(
                    record.current,
                    record.path,
                    {
                        exposeSensitiveValues:
                            false,
                    },
                );
        }

        return safe;
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint payload.
     * -------------------------------------------------------------------------
     */

    buildFingerprintPayload(
        configuration,
    ) {

        return this.redactConfiguration(
            configuration,
            '',
        );
    }

    redactConfiguration(
        value,
        path = '',
    ) {

        if (
            Array.isArray(
                value,
            )
        ) {

            return value.map(
                (
                    item,
                    index,
                ) =>
                    this.redactConfiguration(
                        item,
                        `${path}.${index}`,
                    ),
            );
        }

        if (
            isPlainObject(
                value,
            )
        ) {

            const output = {};

            for (
                const [
                    key,
                    child,
                ] of Object.entries(
                    value,
                )
            ) {

                const childPath =
                    path
                        ? `${path}.${key}`
                        : key;

                if (
                    isSensitivePath(
                        childPath,
                    )
                ) {

                    output[key] =
                        '[REDACTED]';

                    continue;
                }

                output[key] =
                    this.redactConfiguration(
                        child,
                        childPath,
                    );
            }

            return output;
        }

        return value;
    }

    /**
     * -------------------------------------------------------------------------
     * Layer-specific merge helpers.
     * -------------------------------------------------------------------------
     */

    mergeObjectLayers(
        ...objects
    ) {

        const layers =
            objects
                .filter(
                    object =>
                        object !==
                            null &&
                        object !==
                            undefined,
                )
                .map(
                    (
                        object,
                        index,
                    ) => ({
                        name:
                            `object-${index}`,

                        type:
                            LAYER_TYPES.EXPLICIT,

                        priority:
                            index,

                        values:
                            object,
                    }),
                );

        return this.mergeSync(
            layers,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Standard environment layer merger.
     * -------------------------------------------------------------------------
     *
     * This is the canonical helper for backend/config/environment.js:
     *
     *   defaults
     *   base
     *   environment
     *   local
     *   runtime
     *
     * Later layers have higher priority.
     * -------------------------------------------------------------------------
     */

    mergeEnvironmentLayers(
        {
            defaults = {},
            base = {},
            environment = {},
            local = {},
            runtime = {},
            explicit = null,
        } = {},
        options = {},
    ) {

        const layers = [
            {
                name:
                    LAYER_TYPES.DEFAULTS,

                type:
                    LAYER_TYPES.DEFAULTS,

                priority:
                    10,

                values:
                    defaults,
            },

            {
                name:
                    LAYER_TYPES.BASE,

                type:
                    LAYER_TYPES.BASE,

                priority:
                    20,

                values:
                    base,
            },

            {
                name:
                    LAYER_TYPES.ENVIRONMENT,

                type:
                    LAYER_TYPES.ENVIRONMENT,

                priority:
                    30,

                values:
                    environment,
            },

            {
                name:
                    LAYER_TYPES.LOCAL,

                type:
                    LAYER_TYPES.LOCAL,

                priority:
                    40,

                values:
                    local,
            },

            {
                name:
                    LAYER_TYPES.RUNTIME,

                type:
                    LAYER_TYPES.RUNTIME,

                priority:
                    50,

                values:
                    runtime,
            },
        ];

        if (
            explicit
        ) {

            layers.push(
                {
                    name:
                        LAYER_TYPES.EXPLICIT,

                    type:
                        LAYER_TYPES.EXPLICIT,

                    priority:
                        60,

                    values:
                        explicit,
                },
            );
        }

        return this.mergeSync(
            layers,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Result access.
     * -------------------------------------------------------------------------
     */

    getConfiguration() {

        return (
            this.lastResult
                ?.configuration ||
            null
        );
    }

    getProvenance() {

        return (
            this.lastResult
                ?.provenance ||
            {}
        );
    }

    getReport() {

        return (
            this.lastResult
                ?.report ||
            null
        );
    }

    getFingerprint() {

        return (
            this.lastResult
                ?.fingerprint
                ?.value ||
            null
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness / health.
     * -------------------------------------------------------------------------
     */

    readiness() {

        return {
            ready:
                this.state ===
                    MERGE_STATES.READY ||
                this.state ===
                    MERGE_STATES.DEGRADED,

            status:
                this.state ===
                    MERGE_STATES.READY
                    ? 'ready'
                    : this.state ===
                        MERGE_STATES.DEGRADED
                        ? 'degraded'
                        : 'not_ready',

            state:
                this.state,

            fingerprint:
                this.getFingerprint(),

            timestamp:
                new Date().toISOString(),
        };
    }

    health() {

        return {
            status:
                this.state ===
                    MERGE_STATES.READY
                    ? 'healthy'
                    : this.state ===
                        MERGE_STATES.DEGRADED
                        ? 'degraded'
                        : 'unhealthy',

            healthy:
                this.state ===
                MERGE_STATES.READY,

            degraded:
                this.state ===
                MERGE_STATES.DEGRADED,

            state:
                this.state,

            fingerprint:
                this.getFingerprint(),

            lastError:
                this.lastError
                    ? {
                        name:
                            this.lastError.name,

                        code:
                            this.lastError.code,

                        message:
                            this.lastError.message,
                    }
                    : null,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        const result =
            this.lastResult;

        if (
            !result
        ) {

            return deepFreeze({
                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                application:
                    APPLICATION_NAME,

                state:
                    this.state,

                configuration:
                    null,

                provenance:
                    {},

                report:
                    null,

                fingerprint:
                    null,

                lastError:
                    this.lastError
                        ? {
                            name:
                                this.lastError
                                    .name,

                            code:
                                this.lastError
                                    .code,

                            message:
                                this.lastError
                                    .message,
                        }
                        : null,

                timestamp:
                    new Date().toISOString(),
            });
        }

        const includeConfiguration =
            options.includeConfiguration ??
            true;

        const includeProvenance =
            options.includeProvenance ??
            this.options
                .trackProvenance;

        const exposeSensitiveValues =
            options.exposeSensitiveValues ??
            false;

        const output = {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            configuration:
                includeConfiguration
                    ? redactValue(
                        result.configuration,
                        '',
                        {
                            exposeSensitiveValues,
                        },
                    )
                    : null,

            provenance:
                includeProvenance
                    ? redactValue(
                        result.provenance,
                        '',
                        {
                            exposeSensitiveValues:
                                false,
                        },
                    )
                    : {},

            report:
                clone(
                    result.report,
                ),

            fingerprint:
                result.fingerprint,

            lastError:
                this.lastError
                    ? {
                        name:
                            this.lastError.name,

                        code:
                            this.lastError.code,

                        message:
                            this.lastError.message,
                    }
                    : null,

            timestamps: {
                startedAt:
                    this.startedAt,

                completedAt:
                    this.completedAt,
            },

            timestamp:
                new Date().toISOString(),
        };

        return deepFreeze(
            output,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * History.
     * -------------------------------------------------------------------------
     */

    recordHistory(
        event,
    ) {

        if (
            this.history.length >=
            100
        ) {

            this.history.shift();
        }

        this.history.push(
            {
                ...event,

                timestamp:
                    new Date().toISOString(),
            },
        );

        return this.history[
            this.history.length - 1
        ];
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        if (
            this._mergePromise
        ) {

            throw new LayerMergerError(
                'Cannot reset TITech layer merger while a merge is active.',
                {
                    code:
                        'LAYER_MERGER_RESET_NOT_ALLOWED',
                },
            );
        }

        this.state =
            MERGE_STATES.CREATED;

        this.lastResult =
            null;

        this.lastError =
            null;

        this.startedAt =
            null;

        this.completedAt =
            null;

        this.history.length =
            0;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const layerMerger =
    new LayerMerger();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function merge(
    layers,
    options,
) {

    return layerMerger.merge(
        layers,
        options,
    );
}

function mergeSync(
    layers,
    options,
) {

    return layerMerger.mergeSync(
        layers,
        options,
    );
}

function mergeEnvironmentLayers(
    layers,
    options,
) {

    return layerMerger.mergeEnvironmentLayers(
        layers,
        options,
    );
}

function mergeObjectLayers(
    ...objects
) {

    return layerMerger.mergeObjectLayers(
        ...objects,
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
         * Singleton.
         */
        layerMerger,

        LayerMerger,

        LayerMergerError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        MERGE_STATES,

        LAYER_TYPES,

        MERGE_STATUSES,

        DEFAULTS,

        /**
         * Core merge operations.
         */
        merge,

        mergeSync,

        mergeEnvironmentLayers,

        mergeObjectLayers,

        /**
         * Result access.
         */
        getConfiguration:
            () =>
                layerMerger.getConfiguration(),

        getProvenance:
            () =>
                layerMerger.getProvenance(),

        getReport:
            () =>
                layerMerger.getReport(),

        getFingerprint:
            () =>
                layerMerger.getFingerprint(),

        /**
         * Policy helpers.
         */
        isProtectedPath:
            path =>
                layerMerger.isProtectedPath(
                    path,
                ),

        pathMatchesPattern:
            (
                path,
                pattern,
            ) =>
                layerMerger.pathMatchesPattern(
                    path,
                    pattern,
                ),

        /**
         * Operations.
         */
        readiness:
            () =>
                layerMerger.readiness(),

        health:
            () =>
                layerMerger.health(),

        snapshot:
            options =>
                layerMerger.snapshot(
                    options,
                ),

        reset:
            () =>
                layerMerger.reset(),

        /**
         * Utility exports useful to adjacent environment modules.
         */
        normalizePath,

        splitPath,

        stableStringify,

        fingerprint,
    });