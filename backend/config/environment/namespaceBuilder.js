'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/namespaceBuilder.js
 *
 * Purpose:
 *   Enterprise production-grade environment namespace builder.
 *
 * Responsibilities:
 *   - Transform flat environment variables into structured configuration
 *     namespaces.
 *   - Produce deterministic, immutable configuration namespaces.
 *   - Preserve explicit environment-variable mappings.
 *   - Support nested namespaces using safe delimiter semantics.
 *   - Normalize environment values by declared type.
 *   - Prevent prototype pollution.
 *   - Prevent unsafe namespace collisions.
 *   - Detect conflicting environment variables.
 *   - Track namespace/value provenance.
 *   - Redact sensitive values from diagnostics.
 *   - Produce stable namespace fingerprints.
 *   - Support explicit schema-driven namespace definitions.
 *   - Support prefix-based namespace construction.
 *
 * IMPORTANT:
 *
 *   This module performs STRUCTURAL TRANSFORMATION only.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - validate complete application configuration.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - start Express.
 *     - start HTTP servers.
 *     - execute business logic.
 *     - execute financial transactions.
 *
 * Environment loading:
 *
 *   backend/config/environment.js
 *
 * Layer composition:
 *
 *   backend/config/environment/layerMerger.js
 *
 * Environment validation:
 *
 *   backend/config/environment/environmentValidator.js
 *
 * Snapshot:
 *
 *   backend/config/environment/environmentSnapshot.js
 *
 * =============================================================================
 *
 * Example:
 *
 *   INPUT:
 *
 *     {
 *       APP_NAME: "titech-community-capital",
 *       APP_VERSION: "1.0.0",
 *       HTTP_PORT: "5000",
 *       DB_HOST: "127.0.0.1",
 *       DB_PORT: "27017",
 *       ENABLE_METRICS: "true"
 *     }
 *
 *   OUTPUT:
 *
 *     {
 *       app: {
 *         name: "titech-community-capital",
 *         version: "1.0.0"
 *       },
 *
 *       http: {
 *         port: 5000
 *       },
 *
 *       db: {
 *         host: "127.0.0.1",
 *         port: 27017
 *       },
 *
 *       metrics: {
 *         enabled: true
 *       }
 *     }
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
    'environment-namespace-builder';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const BUILDER_STATES =
    Object.freeze({
        CREATED:
            'created',

        BUILDING:
            'building',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        FAILED:
            'failed',
    });

const VALUE_TYPES =
    Object.freeze({
        STRING:
            'string',

        BOOLEAN:
            'boolean',

        INTEGER:
            'integer',

        NUMBER:
            'number',

        JSON:
            'json',

        ARRAY:
            'array',

        CSV:
            'csv',

        URL:
            'url',

        EMAIL:
            'email',

        NULL:
            'null',

        AUTO:
            'auto',
    });

const DEFAULTS =
    Object.freeze({
        delimiter:
            '_',

        nestedDelimiter:
            '__',

        strict:
            true,

        failClosed:
            true,

        detectCollisions:
            true,

        detectConflicts:
            true,

        preserveUnknown:
            true,

        preserveUnmapped:
            false,

        allowEmpty:
            true,

        includeUndefined:
            false,

        lowercaseNamespaces:
            true,

        lowercaseKeys:
            false,

        camelCaseKeys:
            false,

        freezeResult:
            true,

        trackProvenance:
            true,

        maxDepth:
            12,

        maxVariables:
            5_000,

        maxNamespaceKeys:
            10_000,

        maxStringLength:
            16_384,

        fingerprintAlgorithm:
            'sha256',

        forbiddenKeys:
            Object.freeze([
                '__proto__',
                'prototype',
                'constructor',
            ]),

        /**
         * Sensitive variable/key patterns are never emitted as raw values in
         * provenance/diagnostic snapshots.
         */
        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt[_-]?secret|access[_-]?token|refresh[_-]?token|cookie|credential|signing[_-]?key)/i,
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class NamespaceBuilderError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'NamespaceBuilderError';

        this.code =
            options.code ||
            'ENVIRONMENT_NAMESPACE_BUILDER_ERROR';

        this.variable =
            options.variable ||
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
            NamespaceBuilderError,
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

function isEmpty(
    value,
) {

    return (
        value === undefined ||
        value === null ||
        (
            typeof value ===
            'string' &&
            value.trim() === ''
        )
    );
}

function isForbiddenKey(
    key,
) {

    return DEFAULTS
        .forbiddenKeys
        .includes(
            key,
        );
}

function isSensitive(
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

function normalizePath(
    value,
) {

    return String(
        value ||
        '',
    )
        .trim()
        .replace(
            /\[(\w+)\]/g,
            '.$1',
        )
        .split('.')
        .filter(Boolean)
        .join('.');
}

function normalizeKey(
    value,
    options,
) {

    let key =
        String(
            value ||
            '',
        )
            .trim();

    if (
        options.lowercaseKeys
    ) {

        key =
            key.toLowerCase();
    }

    if (
        options.camelCaseKeys
    ) {

        key =
            key.replace(
                /[-_]+([a-zA-Z0-9])/g,
                (
                    match,
                    character,
                ) =>
                    character.toUpperCase(),
            );
    }

    return key;
}

function normalizeNamespace(
    value,
    options,
) {

    let namespace =
        String(
            value ||
            '',
        )
            .trim();

    if (
        options.lowercaseNamespaces
    ) {

        namespace =
            namespace.toLowerCase();
    }

    return namespace;
}

function getAtPath(
    object,
    path,
) {

    const parts =
        normalizePath(
            path,
        )
            .split('.')
            .filter(Boolean);

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
        normalizePath(
            path,
        )
            .split('.')
            .filter(Boolean);

    let current =
        object;

    if (
        parts.length === 0
    ) {

        return false;
    }

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
        normalizePath(
            path,
        )
            .split('.')
            .filter(Boolean);

    if (
        parts.length === 0
    ) {

        throw new NamespaceBuilderError(
            'Namespace path is required.',
            {
                code:
                    'NAMESPACE_PATH_REQUIRED',
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

            throw new NamespaceBuilderError(
                `Forbidden namespace key "${part}".`,
                {
                    code:
                        'NAMESPACE_FORBIDDEN_KEY',

                    path:
                        normalizePath(
                            path,
                        ),
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

function flattenObject(
    object,
    prefix = '',
    output = {},
    depth = 0,
    options = DEFAULTS,
) {

    if (
        depth >
        options.maxDepth
    ) {

        throw new NamespaceBuilderError(
            'Configuration namespace exceeds maximum nesting depth.',
            {
                code:
                    'NAMESPACE_MAX_DEPTH_EXCEEDED',

                path:
                    prefix,
            },
        );
    }

    if (
        !isPlainObject(
            object,
        )
    ) {

        if (
            prefix
        ) {

            output[prefix] =
                object;
        }

        return output;
    }

    for (
        const [
            key,
            value,
        ] of Object.entries(
            object,
        )
    ) {

        if (
            isForbiddenKey(
                key,
            )
        ) {

            throw new NamespaceBuilderError(
                `Forbidden namespace key "${key}".`,
                {
                    code:
                        'NAMESPACE_FORBIDDEN_KEY',

                    path:
                        prefix
                            ? `${prefix}.${key}`
                            : key,
                },
            );
        }

        const next =
            prefix
                ? `${prefix}.${key}`
                : key;

        if (
            isPlainObject(
                value,
            )
        ) {

            flattenObject(
                value,
                next,
                output,
                depth + 1,
                options,
            );

        } else {

            output[next] =
                value;
        }
    }

    return output;
}

/**
 * =============================================================================
 * Typed value conversion
 * =============================================================================
 */

function parseBoolean(
    value,
) {

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
            'true',
            '1',
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
            'false',
            '0',
            'no',
            'off',
            'disabled',
        ].includes(
            normalized,
        )
    ) {

        return false;
    }

    throw new NamespaceBuilderError(
        `Invalid boolean value "${String(
            value,
        )}".`,
        {
            code:
                'NAMESPACE_BOOLEAN_INVALID',
        },
    );
}

function parseInteger(
    value,
) {

    if (
        typeof value ===
        'number' &&
        Number.isInteger(
            value,
        )
    ) {

        return value;
    }

    const normalized =
        String(
            value,
        ).trim();

    if (
        !/^-?\d+$/.test(
            normalized,
        )
    ) {

        throw new NamespaceBuilderError(
            `Invalid integer value "${normalized}".`,
            {
                code:
                    'NAMESPACE_INTEGER_INVALID',
            },
        );
    }

    const parsed =
        Number(
            normalized,
        );

    if (
        !Number.isSafeInteger(
            parsed,
        )
    ) {

        throw new NamespaceBuilderError(
            'Integer value exceeds JavaScript safe integer limits.',
            {
                code:
                    'NAMESPACE_INTEGER_UNSAFE',
            },
        );
    }

    return parsed;
}

function parseNumber(
    value,
) {

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isFinite(
            parsed,
        )
    ) {

        throw new NamespaceBuilderError(
            `Invalid numeric value "${String(
                value,
            )}".`,
            {
                code:
                    'NAMESPACE_NUMBER_INVALID',
            },
        );
    }

    return parsed;
}

function parseCsv(
    value,
) {

    if (
        Array.isArray(
            value,
        )
    ) {

        return value
            .map(
                item =>
                    String(
                        item,
                    ).trim(),
            )
            .filter(Boolean);
    }

    return String(
        value,
    )
        .split(',')
        .map(
            item =>
                item.trim(),
        )
        .filter(Boolean);
}

function parseJson(
    value,
) {

    if (
        typeof value !==
        'string'
    ) {

        return clone(
            value,
        );
    }

    try {

        return JSON.parse(
            value,
        );

    } catch (
        error
    ) {

        throw new NamespaceBuilderError(
            'Invalid JSON environment value.',
            {
                code:
                    'NAMESPACE_JSON_INVALID',

                cause:
                    error,
            },
        );
    }
}

function parseUrl(
    value,
) {

    try {

        const parsed =
            new URL(
                String(
                    value,
                ).trim(),
            );

        return parsed.toString();

    } catch (
        error
    ) {

        throw new NamespaceBuilderError(
            'Invalid URL environment value.',
            {
                code:
                    'NAMESPACE_URL_INVALID',

                cause:
                    error,
            },
        );
    }
}

function parseEmail(
    value,
) {

    const normalized =
        String(
            value,
        ).trim();

    if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            normalized,
        )
    ) {

        throw new NamespaceBuilderError(
            'Invalid email environment value.',
            {
                code:
                    'NAMESPACE_EMAIL_INVALID',
            },
        );
    }

    return normalized;
}

function parseValue(
    value,
    type,
    definition = {},
) {

    if (
        value ===
            undefined
    ) {

        return undefined;
    }

    if (
        value ===
            null
    ) {

        if (
            type ===
            VALUE_TYPES.NULL ||
            definition.allowNull
        ) {

            return null;
        }

        return null;
    }

    switch (
        type
    ) {

        case VALUE_TYPES.BOOLEAN:

            return parseBoolean(
                value,
            );

        case VALUE_TYPES.INTEGER:

            return parseInteger(
                value,
            );

        case VALUE_TYPES.NUMBER:

            return parseNumber(
                value,
            );

        case VALUE_TYPES.JSON:

            return parseJson(
                value,
            );

        case VALUE_TYPES.ARRAY:

        case VALUE_TYPES.CSV:

            return parseCsv(
                value,
            );

        case VALUE_TYPES.URL:

            return parseUrl(
                value,
            );

        case VALUE_TYPES.EMAIL:

            return parseEmail(
                value,
            );

        case VALUE_TYPES.NULL:

            return null;

        case VALUE_TYPES.AUTO:

            return inferValue(
                value,
            );

        case VALUE_TYPES.STRING:

        default: {

            const normalized =
                String(
                    value,
                );

            if (
                normalized.length >
                DEFAULTS.maxStringLength
            ) {

                throw new NamespaceBuilderError(
                    'Environment string value exceeds maximum length.',
                    {
                        code:
                            'NAMESPACE_STRING_TOO_LONG',
                    },
                );
            }

            return normalized.trim();
        }
    }
}

function inferValue(
    value,
) {

    if (
        typeof value !==
        'string'
    ) {

        return clone(
            value,
        );
    }

    const normalized =
        value.trim();

    if (
        [
            'true',
            'false',
            'yes',
            'no',
            'on',
            'off',
            '1',
            '0',
        ].includes(
            normalized.toLowerCase(),
        )
    ) {

        try {
            return parseBoolean(
                normalized,
            );
        } catch {
            // Continue as string.
        }
    }

    if (
        /^-?\d+$/.test(
            normalized,
        )
    ) {

        try {

            return parseInteger(
                normalized,
            );

        } catch {
            // Continue as string.
        }
    }

    if (
        /^-?\d+\.\d+$/.test(
            normalized,
        )
    ) {

        try {

            return parseNumber(
                normalized,
            );

        } catch {
            // Continue as string.
        }
    }

    if (
        (
            normalized.startsWith('{') &&
            normalized.endsWith('}')
        ) ||
        (
            normalized.startsWith('[') &&
            normalized.endsWith(']')
        )
    ) {

        try {
            return parseJson(
                normalized,
            );
        } catch {
            // Continue as string.
        }
    }

    return normalized;
}

/**
 * =============================================================================
 * NamespaceBuilder
 * =============================================================================
 */

class NamespaceBuilder {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.state =
            BUILDER_STATES.CREATED;

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

        this._buildPromise =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Build from a flat environment object.
     * -------------------------------------------------------------------------
     */

    build(
        environment = process.env,
        options = {},
    ) {

        if (
            this._buildPromise
        ) {

            return this._buildPromise;
        }

        this._buildPromise =
            Promise.resolve().then(
                () =>
                    this.buildSync(
                        environment,
                        options,
                    ),
            );

        return this._buildPromise.finally(
            () => {
                this._buildPromise =
                    null;
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Synchronous builder.
     * -------------------------------------------------------------------------
     */

    buildSync(
        environment = process.env,
        options = {},
    ) {

        const started =
            process.hrtime.bigint();

        this.state =
            BUILDER_STATES.BUILDING;

        this.lastError =
            null;

        this.startedAt =
            new Date();

        try {

            if (
                environment ===
                    null ||
                typeof environment !==
                    'object'
            ) {

                throw new NamespaceBuilderError(
                    'TITech environment input must be an object.',
                    {
                        code:
                            'NAMESPACE_ENVIRONMENT_OBJECT_REQUIRED',
                    },
                );
            }

            const mergedOptions =
                this.normalizeOptions(
                    options,
                );

            const source =
                mergedOptions.cloneInput
                    ? clone(
                        environment,
                    )
                    : environment;

            const variableEntries =
                Object.entries(
                    source,
                );

            if (
                variableEntries.length >
                mergedOptions.maxVariables
            ) {

                throw new NamespaceBuilderError(
                    'TITech environment variable count exceeds the configured maximum.',
                    {
                        code:
                            'NAMESPACE_VARIABLE_LIMIT_EXCEEDED',

                        details: {
                            count:
                                variableEntries.length,

                            maximum:
                                mergedOptions.maxVariables,
                        },
                    },
                );
            }

            const result =
                {};

            const provenance =
                {};

            const report = {
                variables:
                    0,

                mapped:
                    0,

                unmapped:
                    0,

                skipped:
                    0,

                conflicts:
                    [],

                rejected:
                    [],

                warnings:
                    [],

                unknown:
                    [],
            };

            const mappings =
                this.normalizeMappings(
                    mergedOptions,
                );

            /**
             * ---------------------------------------------------------------
             * Explicit mappings first.
             * ---------------------------------------------------------------
             */
            const explicitlyMapped =
                new Set();

            for (
                const mapping of
                mappings
            ) {

                const variable =
                    mapping.variable;

                if (
                    !Object.prototype.hasOwnProperty.call(
                        source,
                        variable,
                    )
                ) {

                    if (
                        mapping.required
                    ) {

                        report.rejected.push(
                            {
                                variable,

                                code:
                                    'NAMESPACE_REQUIRED_VARIABLE_MISSING',

                                message:
                                    `Required TITech environment variable "${variable}" is missing.`,
                            },
                        );
                    }

                    continue;
                }

                explicitlyMapped.add(
                    variable,
                );

                const value =
                    source[
                        variable
                    ];

                const mapped =
                    this.applyMapping(
                        result,
                        provenance,
                        mapping,
                        value,
                        mergedOptions,
                        report,
                    );

                if (
                    mapped
                ) {

                    report.mapped +=
                        1;
                }

                report.variables +=
                    1;
            }

            /**
             * ---------------------------------------------------------------
             * Prefix mappings.
             * ---------------------------------------------------------------
             */
            const prefixes =
                this.normalizePrefixes(
                    mergedOptions,
                );

            for (
                const [
                    variable,
                    rawValue,
                ] of variableEntries
            ) {

                if (
                    explicitlyMapped.has(
                        variable,
                    )
                ) {

                    continue;
                }

                const prefix =
                    prefixes.find(
                        item =>
                            variable ===
                                item.prefix ||
                            variable.startsWith(
                                `${item.prefix}${item.delimiter}`,
                            ),
                    );

                if (
                    !prefix
                ) {

                    if (
                        mergedOptions
                            .preserveUnknown
                    ) {

                        const unknownPath =
                            this.mapUnknownVariable(
                                variable,
                                mergedOptions,
                            );

                        this.writeValue(
                            result,
                            provenance,
                            unknownPath,
                            rawValue,
                            {
                                variable,

                                source:
                                    'unknown',

                                type:
                                    VALUE_TYPES.AUTO,
                            },
                            mergedOptions,
                            report,
                        );

                        report.unknown.push(
                            variable,
                        );

                        report.unmapped +=
                            1;

                    } else if (
                        mergedOptions
                            .preserveUnmapped
                    ) {

                        report.unmapped +=
                            1;

                    }

                    continue;
                }

                const mapped =
                    this.applyPrefixMapping(
                        result,
                        provenance,
                        prefix,
                        variable,
                        rawValue,
                        mergedOptions,
                        report,
                    );

                if (
                    mapped
                ) {

                    report.mapped +=
                        1;
                }

                report.variables +=
                    1;
            }

            /**
             * ---------------------------------------------------------------
             * Validate required explicit mappings.
             * ---------------------------------------------------------------
             */
            this.validateRequiredMappings(
                source,
                mappings,
                report,
            );

            /**
             * ---------------------------------------------------------------
             * Namespace key count.
             * ---------------------------------------------------------------
             */
            const totalKeys =
                this.countKeys(
                    result,
                );

            if (
                totalKeys >
                mergedOptions.maxNamespaceKeys
            ) {

                throw new NamespaceBuilderError(
                    'TITech namespace key count exceeds configured maximum.',
                    {
                        code:
                            'NAMESPACE_KEY_LIMIT_EXCEEDED',

                        details: {
                            totalKeys,

                            maximum:
                                mergedOptions.maxNamespaceKeys,
                        },
                    },
                );
            }

            /**
             * ---------------------------------------------------------------
             * Fingerprint.
             * ---------------------------------------------------------------
             */
            const fingerprintValue =
                fingerprint(
                    this.buildFingerprintPayload(
                        result,
                    ),
                    mergedOptions
                        .fingerprintAlgorithm,
                );

            const durationMs =
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000;

            const hasErrors =
                report.rejected.length >
                    0 ||
                report.conflicts.some(
                    conflict =>
                        conflict.fatal ===
                        true,
                );

            const degraded =
                report.rejected.length >
                    0 ||
                report.conflicts.length >
                    0 ||
                report.warnings.length >
                    0 ||
                report.unknown.length >
                    0;

            if (
                hasErrors &&
                mergedOptions.failClosed
            ) {

                throw new NamespaceBuilderError(
                    'TITech namespace construction encountered fatal mapping errors.',
                    {
                        code:
                            'NAMESPACE_BUILD_FAILED',

                        details: {
                            rejected:
                                report.rejected,

                            conflicts:
                                report.conflicts,
                        },
                    },
                );
            }

            const output = {
                status:
                    hasErrors
                        ? BUILDER_STATES.FAILED
                        : degraded
                            ? BUILDER_STATES.DEGRADED
                            : BUILDER_STATES.READY,

                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                application:
                    APPLICATION_NAME,

                namespaces:
                    result,

                provenance:
                    mergedOptions
                        .trackProvenance
                        ? provenance
                        : {},

                report: {
                    ...report,

                    totalKeys,

                    durationMs:
                        Number(
                            durationMs.toFixed(
                                3,
                            ),
                        ),
                },

                fingerprint: {
                    algorithm:
                        mergedOptions
                            .fingerprintAlgorithm,

                    value:
                        fingerprintValue,
                },

                timestamp:
                    new Date().toISOString(),
            };

            this.lastResult =
                mergedOptions.freezeResult
                    ? deepFreeze(
                        output,
                    )
                    : output;

            this.completedAt =
                new Date();

            this.state =
                hasErrors
                    ? BUILDER_STATES.FAILED
                    : degraded
                        ? BUILDER_STATES.DEGRADED
                        : BUILDER_STATES.READY;

            this.recordHistory(
                {
                    type:
                        'build.completed',

                    status:
                        this.state,

                    variables:
                        report.variables,

                    mapped:
                        report.mapped,

                    unmapped:
                        report.unmapped,

                    conflicts:
                        report.conflicts.length,

                    fingerprint:
                        fingerprintValue,
                },
            );

            log(
                this.state ===
                    BUILDER_STATES.READY
                    ? 'info'
                    : 'warn',
                {
                    state:
                        this.state,

                    variables:
                        report.variables,

                    mapped:
                        report.mapped,

                    conflicts:
                        report.conflicts.length,
                },
                this.state ===
                    BUILDER_STATES.READY
                    ? 'TITech environment namespaces built successfully.'
                    : 'TITech environment namespaces built with warnings.',
            );

            return this.lastResult;

        } catch (
            error
        ) {

            this.state =
                BUILDER_STATES.FAILED;

            this.lastError =
                error;

            this.completedAt =
                new Date();

            this.recordHistory(
                {
                    type:
                        'build.failed',

                    error: {
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
                    error: {
                        name:
                            error?.name,

                        code:
                            error?.code,

                        message:
                            error?.message,
                    },
                },
                'TITech environment namespace construction failed.',
            );

            throw (
                error instanceof
                NamespaceBuilderError
                    ? error
                    : new NamespaceBuilderError(
                        'TITech environment namespace construction failed.',
                        {
                            code:
                                'NAMESPACE_BUILD_RUNTIME_FAILURE',

                            cause:
                                error,
                        },
                    )
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize options.
     * -------------------------------------------------------------------------
     */

    normalizeOptions(
        options,
    ) {

        return {
            ...this.options,
            ...options,

            mappings:
                options.mappings ||
                this.options.mappings ||
                [],

            prefixes:
                options.prefixes ||
                this.options.prefixes ||
                [],

            delimiter:
                options.delimiter ||
                this.options.delimiter,

            nestedDelimiter:
                options.nestedDelimiter ||
                this.options.nestedDelimiter,

            protectedNamespaces:
                options.protectedNamespaces ||
                this.options
                    .protectedNamespaces ||
                [],

            cloneInput:
                options.cloneInput ??
                true,

            freezeResult:
                options.freezeResult ??
                this.options.freezeResult,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Explicit mapping normalization.
     * -------------------------------------------------------------------------
     *
     * Mapping format:
     *
     * {
     *   variable: 'MONGO_URI',
     *   path: 'database.uri',
     *   type: 'string',
     *   required: true
     * }
     *
     * Aliases:
     *
     * {
     *   env: 'MONGO_URI',
     *   target: 'database.uri'
     * }
     * -------------------------------------------------------------------------
     */

    normalizeMappings(
        options,
    ) {

        const mappings =
            Array.isArray(
                options.mappings,
            )
                ? options.mappings
                : [];

        return mappings.map(
            (
                mapping,
                index,
            ) => {

                if (
                    !mapping ||
                    typeof mapping !==
                        'object'
                ) {

                    throw new NamespaceBuilderError(
                        `Invalid namespace mapping at index ${index}.`,
                        {
                            code:
                                'NAMESPACE_MAPPING_INVALID',

                            details: {
                                index,
                            },
                        },
                    );
                }

                const variable =
                    String(
                        mapping.variable ||
                        mapping.env ||
                        mapping.name ||
                        '',
                    )
                        .trim();

                const path =
                    normalizePath(
                        mapping.path ||
                        mapping.target ||
                        mapping.namespace ||
                        '',
                    );

                if (
                    !variable
                ) {

                    throw new NamespaceBuilderError(
                        'Namespace mapping variable is required.',
                        {
                            code:
                                'NAMESPACE_MAPPING_VARIABLE_REQUIRED',

                            details: {
                                index,
                            },
                        },
                    );
                }

                if (
                    !path
                ) {

                    throw new NamespaceBuilderError(
                        `Namespace mapping target is required for "${variable}".`,
                        {
                            code:
                                'NAMESPACE_MAPPING_TARGET_REQUIRED',

                            variable,
                        },
                    );
                }

                this.assertSafePath(
                    path,
                );

                return {
                    variable,

                    path,

                    type:
                        mapping.type ||
                        VALUE_TYPES.AUTO,

                    required:
                        mapping.required ===
                        true,

                    default:
                        mapping.default,

                    transform:
                        typeof mapping.transform ===
                            'function'
                            ? mapping.transform
                            : null,

                    allowNull:
                        mapping.allowNull ===
                        true,

                    metadata:
                        clone(
                            mapping.metadata ||
                            {},
                        ),
                };
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Prefix mapping normalization.
     * -------------------------------------------------------------------------
     *
     * Format:
     *
     * {
     *   prefix: 'DB',
     *   namespace: 'database',
     *   delimiter: '_'
     * }
     *
     * DB_HOST   → database.host
     * DB_PORT   → database.port
     *
     * Nested delimiter:
     *
     * DB_POOL__MAX_SIZE → database.pool.maxSize
     * -------------------------------------------------------------------------
     */

    normalizePrefixes(
        options,
    ) {

        const prefixes =
            Array.isArray(
                options.prefixes,
            )
                ? options.prefixes
                : [];

        return prefixes.map(
            (
                definition,
                index,
            ) => {

                if (
                    !definition ||
                    typeof definition !==
                        'object'
                ) {

                    throw new NamespaceBuilderError(
                        `Invalid namespace prefix definition at index ${index}.`,
                        {
                            code:
                                'NAMESPACE_PREFIX_INVALID',

                            details: {
                                index,
                            },
                        },
                    );
                }

                const prefix =
                    String(
                        definition.prefix ||
                        '',
                    )
                        .trim();

                const namespace =
                    normalizeNamespace(
                        definition.namespace ||
                        prefix,
                        options,
                    );

                if (
                    !prefix
                ) {

                    throw new NamespaceBuilderError(
                        'Namespace prefix is required.',
                        {
                            code:
                                'NAMESPACE_PREFIX_REQUIRED',
                        },
                    );
                }

                if (
                    !namespace
                ) {

                    throw new NamespaceBuilderError(
                        `Namespace is required for prefix "${prefix}".`,
                        {
                            code:
                                'NAMESPACE_PREFIX_NAMESPACE_REQUIRED',

                            details: {
                                prefix,
                            },
                        },
                    );
                }

                return {
                    prefix,

                    namespace,

                    delimiter:
                        definition.delimiter ||
                        options.delimiter,

                    nestedDelimiter:
                        definition.nestedDelimiter ||
                        options.nestedDelimiter,

                    stripPrefix:
                        definition.stripPrefix !==
                            false,

                    caseSensitive:
                        definition.caseSensitive ===
                        true,

                    type:
                        definition.type ||
                        VALUE_TYPES.AUTO,

                    typeMap:
                        clone(
                            definition.typeMap ||
                            {},
                        ),

                    transform:
                        typeof definition.transform ===
                            'function'
                            ? definition.transform
                            : null,

                    metadata:
                        clone(
                            definition.metadata ||
                            {},
                        ),
                };
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Apply explicit mapping.
     * -------------------------------------------------------------------------
     */

    applyMapping(
        result,
        provenance,
        mapping,
        rawValue,
        options,
        report,
    ) {

        if (
            rawValue ===
            undefined &&
            mapping.default !==
                undefined
        ) {

            rawValue =
                mapping.default;
        }

        if (
            rawValue ===
            undefined &&
            !options.includeUndefined
        ) {

            report.skipped +=
                1;

            return false;
        }

        if (
            isEmpty(
                rawValue,
            ) &&
            !options.allowEmpty
        ) {

            report.skipped +=
                1;

            return false;
        }

        try {

            let value =
                parseValue(
                    rawValue,
                    mapping.type ||
                        VALUE_TYPES.AUTO,
                    mapping,
                );

            if (
                mapping.transform
            ) {

                value =
                    mapping.transform(
                        value,
                        {
                            variable:
                                mapping.variable,

                            path:
                                mapping.path,

                            source:
                                rawValue,
                        },
                    );
            }

            this.writeValue(
                result,
                provenance,
                mapping.path,
                value,
                {
                    variable:
                        mapping.variable,

                    source:
                        'explicit',

                    type:
                        mapping.type,

                    metadata:
                        mapping.metadata,
                },
                options,
                report,
            );

            return true;

        } catch (
            error
        ) {

            report.rejected.push(
                {
                    variable:
                        mapping.variable,

                    path:
                        mapping.path,

                    code:
                        error.code ||
                        'NAMESPACE_MAPPING_FAILED',

                    message:
                        error.message,
                },
            );

            return false;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Apply prefix mapping.
     * -------------------------------------------------------------------------
     */

    applyPrefixMapping(
        result,
        provenance,
        prefix,
        variable,
        rawValue,
        options,
        report,
    ) {

        let variableTail =
            variable;

        if (
            prefix.stripPrefix
        ) {

            variableTail =
                variableTail.slice(
                    prefix.prefix.length,
                );

            variableTail =
                variableTail.replace(
                    new RegExp(
                        `^${escapeRegExp(
                            prefix.delimiter,
                        )}`,
                    ),
                    '',
                );
        }

        if (
            !prefix.caseSensitive
        ) {

            variableTail =
                variableTail
                    .toUpperCase();
        }

        if (
            !variableTail
        ) {

            report.skipped +=
                1;

            return false;
        }

        /**
         * DB_POOL__MAX_SIZE:
         *
         * POOL__MAX_SIZE
         *       ↓ nested delimiter
         * pool.maxSize
         */
        const segments =
            variableTail
                .split(
                    prefix.nestedDelimiter,
                )
                .filter(Boolean)
                .flatMap(
                    segment =>
                        segment
                            .split(
                                prefix.delimiter,
                            )
                            .filter(Boolean),
                )
                .map(
                    key =>
                        normalizeNamespaceKey(
                            key,
                            options,
                        ),
                );

        if (
            segments.length ===
            0
        ) {

            report.skipped +=
                1;

            return false;
        }

        const namespace =
            normalizeNamespace(
                prefix.namespace,
                options,
            );

        const path =
            [
                namespace,
                ...segments,
            ].join('.');

        this.assertSafePath(
            path,
        );

        const type =
            prefix.typeMap?.[
                variable
            ] ||
            prefix.typeMap?.[
                segments.join('.')
            ] ||
            prefix.type ||
            VALUE_TYPES.AUTO;

        try {

            let value =
                parseValue(
                    rawValue,
                    type,
                    {
                        variable,

                        path,
                    },
                );

            if (
                prefix.transform
            ) {

                value =
                    prefix.transform(
                        value,
                        {
                            variable,

                            path,

                            namespace:
                                prefix.namespace,

                            source:
                                rawValue,
                        },
                    );
            }

            this.writeValue(
                result,
                provenance,
                path,
                value,
                {
                    variable,

                    source:
                        prefix.prefix,

                    type,

                    metadata:
                        prefix.metadata,
                },
                options,
                report,
            );

            return true;

        } catch (
            error
        ) {

            report.rejected.push(
                {
                    variable,

                    path,

                    code:
                        error.code ||
                        'NAMESPACE_PREFIX_MAPPING_FAILED',

                    message:
                        error.message,
                },
            );

            return false;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Unknown variable mapping.
     * -------------------------------------------------------------------------
     *
     * APP_NAME -> app_name when preserveUnknown is true.
     *
     * Unknowns are placed inside `unknown` by default so they do not collide
     * with canonical namespaces.
     * -------------------------------------------------------------------------
     */

    mapUnknownVariable(
        variable,
        options,
    ) {

        const namespace =
            options.unknownNamespace ||
            'unknown';

        const key =
            normalizeNamespaceKey(
                variable,
                options,
            );

        return `${namespace}.${key}`;
    }

    /**
     * -------------------------------------------------------------------------
     * Required mapping validation.
     * -------------------------------------------------------------------------
     */

    validateRequiredMappings(
        source,
        mappings,
        report,
    ) {

        for (
            const mapping of
            mappings
        ) {

            if (
                mapping.required &&
                isEmpty(
                    source[
                        mapping.variable
                    ],
                ) &&
                mapping.default ===
                    undefined
            ) {

                report.rejected.push(
                    {
                        variable:
                            mapping.variable,

                        path:
                            mapping.path,

                        code:
                            'NAMESPACE_REQUIRED_VARIABLE_MISSING',

                        message:
                            `Required TITech environment variable "${mapping.variable}" is missing.`,
                    },
                );
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Write value safely.
     * -------------------------------------------------------------------------
     */

    writeValue(
        result,
        provenance,
        path,
        value,
        metadata,
        options,
        report,
    ) {

        this.assertSafePath(
            path,
        );

        if (
            isSensitive(
                path,
            ) &&
            !options.allowSensitiveNamespaceValues
        ) {

            /**
             * The actual configuration value is still required by the runtime,
             * so it is stored normally. The protection here applies to
             * provenance/reporting, not the configuration itself.
             */
        }

        const exists =
            hasAtPath(
                result,
                path,
            );

        const previous =
            getAtPath(
                result,
                path,
            );

        if (
            exists &&
            options.detectConflicts &&
            stableStringify(
                previous,
            ) !==
            stableStringify(
                value,
            )
        ) {

            const conflict = {
                variable:
                    metadata.variable ||
                    null,

                path,

                previousSource:
                    provenance[path]
                        ?.variable ||
                    provenance[path]
                        ?.source ||
                    null,

                incomingSource:
                    metadata.variable ||
                    metadata.source ||
                    null,

                previousFingerprint:
                    fingerprint(
                        previous,
                        options
                            .fingerprintAlgorithm,
                    ),

                incomingFingerprint:
                    fingerprint(
                        value,
                        options
                            .fingerprintAlgorithm,
                    ),

                fatal:
                    options
                        .failOnConflict ===
                    true,
            };

            report.conflicts.push(
                conflict,
            );

            if (
                options.failOnConflict
            ) {

                throw new NamespaceBuilderError(
                    `TITech namespace conflict detected for "${path}".`,
                    {
                        code:
                            'NAMESPACE_CONFLICT',

                        path,

                        variable:
                            metadata.variable,
                    },
                );
            }
        }

        setAtPath(
            result,
            path,
            clone(
                value,
            ),
        );

        if (
            options.trackProvenance
        ) {

            provenance[path] =
                {
                    variable:
                        metadata.variable ||
                        null,

                    source:
                        metadata.source ||
                        'environment',

                    type:
                        metadata.type ||
                        VALUE_TYPES.AUTO,

                    metadata:
                        clone(
                            metadata.metadata ||
                            {},
                        ),

                    sensitive:
                        isSensitive(
                            path,
                        ) ||
                        isSensitive(
                            metadata.variable,
                        ),

                    valueFingerprint:
                        fingerprint(
                            value,
                            options
                                .fingerprintAlgorithm,
                        ),

                    timestamp:
                        new Date().toISOString(),
                };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Path safety.
     * -------------------------------------------------------------------------
     */

    assertSafePath(
        path,
    ) {

        const normalized =
            normalizePath(
                path,
            );

        if (
            !normalized
        ) {

            throw new NamespaceBuilderError(
                'Namespace path is empty.',
                {
                    code:
                        'NAMESPACE_PATH_EMPTY',
                },
            );
        }

        const parts =
            normalized
                .split('.')
                .filter(Boolean);

        for (
            const part of
            parts
        ) {

            if (
                isForbiddenKey(
                    part,
                )
            ) {

                throw new NamespaceBuilderError(
                    `Forbidden namespace key "${part}".`,
                    {
                        code:
                            'NAMESPACE_FORBIDDEN_KEY',

                        path:
                            normalized,
                    },
                );
            }
        }

        if (
            parts.length >
            this.options.maxDepth
        ) {

            throw new NamespaceBuilderError(
                'Namespace path exceeds the configured maximum depth.',
                {
                    code:
                        'NAMESPACE_MAX_DEPTH_EXCEEDED',

                    path:
                        normalized,
                },
            );
        }

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize namespace key.
     * -------------------------------------------------------------------------
     */

    normalizeNamespaceKey(
        value,
        options,
    ) {

        return normalizeNamespaceKey(
            value,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Count namespace keys.
     * -------------------------------------------------------------------------
     */

    countKeys(
        value,
        depth = 0,
    ) {

        if (
            depth >
            this.options.maxDepth
        ) {

            throw new NamespaceBuilderError(
                'Namespace exceeds maximum depth.',
                {
                    code:
                        'NAMESPACE_MAX_DEPTH_EXCEEDED',
                },
            );
        }

        if (
            !isPlainObject(
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

                throw new NamespaceBuilderError(
                    `Forbidden namespace key "${key}".`,
                    {
                        code:
                            'NAMESPACE_FORBIDDEN_KEY',
                    },
                );
            }

            total +=
                1;

            if (
                isPlainObject(
                    child,
                )
            ) {

                total +=
                    this.countKeys(
                        child,
                        depth + 1,
                    );
            }
        }

        return total;
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint payload.
     * -------------------------------------------------------------------------
     */

    buildFingerprintPayload(
        namespaces,
        path = '',
    ) {

        if (
            Array.isArray(
                namespaces,
            )
        ) {

            return namespaces.map(
                (
                    item,
                    index,
                ) =>
                    this.buildFingerprintPayload(
                        item,
                        `${path}.${index}`,
                    ),
            );
        }

        if (
            isPlainObject(
                namespaces,
            )
        ) {

            const output = {};

            for (
                const [
                    key,
                    value,
                ] of Object.entries(
                    namespaces,
                )
            ) {

                const childPath =
                    path
                        ? `${path}.${key}`
                        : key;

                if (
                    isSensitive(
                        childPath,
                    )
                ) {

                    output[key] =
                        '[REDACTED]';

                    continue;
                }

                output[key] =
                    this.buildFingerprintPayload(
                        value,
                        childPath,
                    );
            }

            return output;
        }

        return namespaces;
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        return {
            status:
                this.state ===
                    BUILDER_STATES.READY
                    ? 'ready'
                    : this.state ===
                        BUILDER_STATES.DEGRADED
                        ? 'degraded'
                        : 'not_ready',

            ready:
                this.state ===
                    BUILDER_STATES.READY ||
                this.state ===
                    BUILDER_STATES.DEGRADED,

            state:
                this.state,

            fingerprint:
                this.lastResult
                    ?.fingerprint
                    ?.value ||
                null,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        return {
            status:
                this.state ===
                    BUILDER_STATES.READY
                    ? 'healthy'
                    : this.state ===
                        BUILDER_STATES.DEGRADED
                        ? 'degraded'
                        : 'unhealthy',

            healthy:
                this.state ===
                BUILDER_STATES.READY,

            degraded:
                this.state ===
                BUILDER_STATES.DEGRADED,

            state:
                this.state,

            fingerprint:
                this.lastResult
                    ?.fingerprint
                    ?.value ||
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

        if (
            !this.lastResult
        ) {

            return deepFreeze({
                component:
                    COMPONENT,

                state:
                    this.state,

                namespaces:
                    {},

                provenance:
                    {},

                report:
                    null,

                fingerprint:
                    null,

                timestamp:
                    new Date().toISOString(),
            });
        }

        const includeValues =
            options.includeValues ??
            true;

        const includeProvenance =
            options.includeProvenance ??
            this.options.trackProvenance;

        const output = {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            namespaces:
                includeValues
                    ? clone(
                        this.lastResult
                            .namespaces,
                    )
                    : null,

            provenance:
                includeProvenance
                    ? clone(
                        this.lastResult
                            .provenance,
                    )
                    : {},

            report:
                clone(
                    this.lastResult
                        .report,
                ),

            fingerprint:
                clone(
                    this.lastResult
                        .fingerprint,
                ),

            timestamps: {
                startedAt:
                    this.startedAt,

                completedAt:
                    this.completedAt,
            },

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
        };

        return deepFreeze(
            output,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Result accessors.
     * -------------------------------------------------------------------------
     */

    getNamespaces() {

        return (
            this.lastResult
                ?.namespaces ||
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
            this._buildPromise
        ) {

            throw new NamespaceBuilderError(
                'Cannot reset TITech namespace builder while a build is active.',
                {
                    code:
                        'NAMESPACE_RESET_NOT_ALLOWED',
                },
            );
        }

        this.state =
            BUILDER_STATES.CREATED;

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
 * Key normalization helper
 * =============================================================================
 */

function normalizeNamespaceKey(
    value,
    options = DEFAULTS,
) {

    let key =
        String(
            value ||
            '',
        )
            .trim();

    if (
        !key
    ) {

        throw new NamespaceBuilderError(
            'Namespace key cannot be empty.',
            {
                code:
                    'NAMESPACE_KEY_EMPTY',
            },
        );
    }

    if (
        options.lowercaseKeys
    ) {

        key =
            key.toLowerCase();
    }

    /**
     * Convert common ENV_CASE into camelCase when requested:
     *
     * MAX_POOL_SIZE -> maxPoolSize
     */
    if (
        options.camelCaseKeys
    ) {

        const parts =
            key
                .split(
                    /[-_]+/,
                )
                .filter(Boolean)
                .map(
                    part =>
                        part.toLowerCase(),
                );

        key =
            parts
                .map(
                    (
                        part,
                        index,
                    ) =>
                        index === 0
                            ? part
                            : part
                                .charAt(
                                    0,
                                )
                                .toUpperCase() +
                              part.slice(
                                  1,
                              ),
                )
                .join('');
    }

    return key;
}

/**
 * =============================================================================
 * Logger
 * =============================================================================
 */

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
        // Namespace construction must remain logger-independent.
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const namespaceBuilder =
    new NamespaceBuilder();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function build(
    environment,
    options,
) {

    return namespaceBuilder.build(
        environment,
        options,
    );
}

function buildSync(
    environment,
    options,
) {

    return namespaceBuilder.buildSync(
        environment,
        options,
    );
}

function readiness() {

    return namespaceBuilder.readiness();
}

function health() {

    return namespaceBuilder.health();
}

function snapshot(
    options,
) {

    return namespaceBuilder.snapshot(
        options,
    );
}

function reset() {

    return namespaceBuilder.reset();
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
        namespaceBuilder,

        NamespaceBuilder,

        NamespaceBuilderError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        BUILDER_STATES,

        VALUE_TYPES,

        DEFAULTS,

        /**
         * Build.
         */
        build,

        buildSync,

        /**
         * State.
         */
        readiness,

        health,

        snapshot,

        /**
         * Utility helpers.
         */
        normalizeNamespaceKey,

        normalizeNamespace,

        normalizePath,

        flattenObject,

        fingerprint,

        stableStringify,

        /**
         * Test support.
         */
        reset,
    });