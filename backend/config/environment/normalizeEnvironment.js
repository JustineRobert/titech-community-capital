'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/normalizeEnvironment.js
 *
 * Purpose:
 *   Enterprise production-grade environment normalization engine.
 *
 * Responsibilities:
 *   - Normalize raw TITech environment variables into predictable values.
 *   - Normalize booleans, integers, numbers, URLs, CSV lists and JSON.
 *   - Normalize common environment aliases and naming conventions.
 *   - Apply explicit normalization schemas.
 *   - Apply safe defaults where configured.
 *   - Preserve unknown variables without silently losing them.
 *   - Track normalization provenance.
 *   - Detect normalization conflicts and invalid conversions.
 *   - Prevent prototype-pollution keys.
 *   - Produce deterministic normalization fingerprints.
 *   - Produce immutable normalization results.
 *
 * IMPORTANT:
 *
 *   This module performs NORMALIZATION only.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - perform complete environment validation.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - start Express.
 *     - start the HTTP server.
 *     - execute financial transactions.
 *     - authorize tenant access.
 *
 * Environment loading:
 *
 *   backend/config/environment.js
 *
 * Layer merging:
 *
 *   backend/config/environment/layerMerger.js
 *
 * Namespace construction:
 *
 *   backend/config/environment/namespaceBuilder.js
 *
 * Validation:
 *
 *   backend/config/environment/environmentValidator.js
 *
 * Snapshot:
 *
 *   backend/config/environment/environmentSnapshot.js
 *
 * =============================================================================
 *
 * Normalization flow:
 *
 *   raw environment
 *        ↓
 *   normalizeEnvironment.js
 *        ↓
 *   normalized values
 *        ↓
 *   environmentValidator.js
 *        ↓
 *   validated configuration
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
    'environment-normalizer';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const NORMALIZATION_STATES =
    Object.freeze({
        CREATED:
            'created',

        NORMALIZING:
            'normalizing',

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

        BIGINT:
            'bigint',

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

        DATE:
            'date',

        NULL:
            'null',

        AUTO:
            'auto',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        preserveUnknown:
            true,

        includeUndefined:
            false,

        allowEmpty:
            true,

        trimStrings:
            true,

        lowercaseEnums:
            true,

        cloneInput:
            true,

        freezeResult:
            true,

        trackProvenance:
            true,

        detectConflicts:
            true,

        maxDepth:
            16,

        maxVariables:
            5_000,

        maxStringLength:
            16_384,

        maxArrayLength:
            2_000,

        fingerprintAlgorithm:
            'sha256',

        forbiddenKeys:
            Object.freeze([
                '__proto__',
                'prototype',
                'constructor',
            ]),

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt[_-]?secret|access[_-]?token|refresh[_-]?token|cookie|credential|signing[_-]?key)/i,

        booleanTrueValues:
            Object.freeze([
                '1',
                'true',
                'yes',
                'on',
                'enabled',
            ]),

        booleanFalseValues:
            Object.freeze([
                '0',
                'false',
                'no',
                'off',
                'disabled',
            ]),
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentNormalizationError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentNormalizationError';

        this.code =
            options.code ||
            'ENVIRONMENT_NORMALIZATION_ERROR';

        this.variable =
            options.variable ||
            null;

        this.path =
            options.path ||
            null;

        this.type =
            options.type ||
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
            EnvironmentNormalizationError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
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
            // Fallback below.
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

function isPlainObject(
    value,
) {

    if (
        value === null ||
        typeof value !==
        'object'
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
            value.trim() ===
                ''
        )
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

function isForbiddenKey(
    key,
    options,
) {

    return (
        options.forbiddenKeys ||
        DEFAULTS.forbiddenKeys
    ).includes(
        key,
    );
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

function isSensitive(
    key,
    options,
) {

    return (
        options.sensitivePattern ||
        DEFAULTS.sensitivePattern
    ).test(
        String(
            key ||
            '',
        ),
    );
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
        // Normalization must never depend on logger availability.
    }
}

/**
 * =============================================================================
 * Primitive value parsers
 * =============================================================================
 */

function normalizeString(
    value,
    options = DEFAULTS,
) {

    if (
        value === null
    ) {

        return null;
    }

    if (
        value === undefined
    ) {

        return undefined;
    }

    let result =
        String(
            value,
        );

    if (
        result.length >
        options.maxStringLength
    ) {

        throw new EnvironmentNormalizationError(
            'Environment string exceeds the configured maximum length.',
            {
                code:
                    'ENVIRONMENT_STRING_TOO_LONG',
            },
        );
    }

    if (
        options.trimStrings
    ) {

        result =
            result.trim();
    }

    return result;
}

function normalizeBoolean(
    value,
    options = DEFAULTS,
) {

    if (
        typeof value ===
        'boolean'
    ) {

        return value;
    }

    if (
        typeof value ===
        'number'
    ) {

        if (
            value ===
            1
        ) {

            return true;
        }

        if (
            value ===
            0
        ) {

            return false;
        }
    }

    const normalized =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        options.booleanTrueValues
            .includes(
                normalized,
            )
    ) {

        return true;
    }

    if (
        options.booleanFalseValues
            .includes(
                normalized,
            )
    ) {

        return false;
    }

    throw new EnvironmentNormalizationError(
        `Invalid boolean environment value "${normalized}".`,
        {
            code:
                'ENVIRONMENT_BOOLEAN_INVALID',

            details: {
                acceptedTrue:
                    options.booleanTrueValues,

                acceptedFalse:
                    options.booleanFalseValues,
            },
        },
    );
}

function normalizeInteger(
    value,
) {

    if (
        typeof value ===
            'number' &&
        Number.isInteger(
            value,
        )
    ) {

        if (
            Number.isSafeInteger(
                value,
            )
        ) {

            return value;
        }

        throw new EnvironmentNormalizationError(
            'Environment integer is outside JavaScript safe integer range.',
            {
                code:
                    'ENVIRONMENT_INTEGER_UNSAFE',
            },
        );
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

        throw new EnvironmentNormalizationError(
            `Invalid integer environment value "${normalized}".`,
            {
                code:
                    'ENVIRONMENT_INTEGER_INVALID',
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

        throw new EnvironmentNormalizationError(
            'Environment integer is outside JavaScript safe integer range.',
            {
                code:
                    'ENVIRONMENT_INTEGER_UNSAFE',
            },
        );
    }

    return parsed;
}

function normalizeNumber(
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

        throw new EnvironmentNormalizationError(
            `Invalid numeric environment value "${String(
                value,
            )}".`,
            {
                code:
                    'ENVIRONMENT_NUMBER_INVALID',
            },
        );
    }

    return parsed;
}

function normalizeBigInt(
    value,
) {

    try {

        return BigInt(
            String(
                value,
            ).trim(),
        );

    } catch (
        error
    ) {

        throw new EnvironmentNormalizationError(
            'Invalid bigint environment value.',
            {
                code:
                    'ENVIRONMENT_BIGINT_INVALID',

                cause:
                    error,
            },
        );
    }
}

function normalizeCsv(
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

    const normalized =
        String(
            value,
        );

    if (
        normalized.trim() ===
        ''
    ) {

        return [];
    }

    return normalized
        .split(',')
        .map(
            item =>
                item.trim(),
        )
        .filter(Boolean);
}

function normalizeArray(
    value,
) {

    if (
        Array.isArray(
            value,
        )
    ) {

        return clone(
            value,
        );
    }

    return normalizeCsv(
        value,
    );
}

function normalizeJson(
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

        throw new EnvironmentNormalizationError(
            'Invalid JSON environment value.',
            {
                code:
                    'ENVIRONMENT_JSON_INVALID',

                cause:
                    error,
            },
        );
    }
}

function normalizeUrl(
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

        throw new EnvironmentNormalizationError(
            'Invalid URL environment value.',
            {
                code:
                    'ENVIRONMENT_URL_INVALID',

                cause:
                    error,
            },
        );
    }
}

function normalizeEmail(
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

        throw new EnvironmentNormalizationError(
            'Invalid email environment value.',
            {
                code:
                    'ENVIRONMENT_EMAIL_INVALID',
            },
        );
    }

    return normalized;
}

function normalizeDate(
    value,
) {

    const date =
        value instanceof Date
            ? new Date(
                value.getTime(),
            )
            : new Date(
                String(
                    value,
                ),
            );

    if (
        Number.isNaN(
            date.getTime(),
        )
    ) {

        throw new EnvironmentNormalizationError(
            'Invalid date environment value.',
            {
                code:
                    'ENVIRONMENT_DATE_INVALID',
            },
        );
    }

    return date;
}

/**
 * =============================================================================
 * AUTO type inference
 * =============================================================================
 */

function inferType(
    value,
    options = DEFAULTS,
) {

    if (
        value === null
    ) {

        return VALUE_TYPES.NULL;
    }

    if (
        typeof value ===
        'boolean'
    ) {

        return VALUE_TYPES.BOOLEAN;
    }

    if (
        typeof value ===
        'number'
    ) {

        return Number.isInteger(
            value,
        )
            ? VALUE_TYPES.INTEGER
            : VALUE_TYPES.NUMBER;
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return VALUE_TYPES.ARRAY;
    }

    if (
        typeof value ===
        'object'
    ) {

        return VALUE_TYPES.JSON;
    }

    const normalized =
        String(
            value,
        ).trim();

    if (
        options.booleanTrueValues
            .includes(
                normalized.toLowerCase(),
            ) ||
        options.booleanFalseValues
            .includes(
                normalized.toLowerCase(),
            )
    ) {

        return VALUE_TYPES.BOOLEAN;
    }

    if (
        /^-?\d+$/.test(
            normalized,
        )
    ) {

        return VALUE_TYPES.INTEGER;
    }

    if (
        /^-?\d+\.\d+$/.test(
            normalized,
        )
    ) {

        return VALUE_TYPES.NUMBER;
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

            JSON.parse(
                normalized,
            );

            return VALUE_TYPES.JSON;

        } catch {
            // Treat as string.
        }
    }

    return VALUE_TYPES.STRING;
}

/**
 * =============================================================================
 * Generic value normalizer
 * =============================================================================
 */

function normalizeValue(
    value,
    definition = {},
    options = DEFAULTS,
) {

    if (
        value ===
        undefined
    ) {

        if (
            options.includeUndefined
        ) {

            return undefined;
        }

        return undefined;
    }

    if (
        value ===
        null
    ) {

        if (
            definition.type ===
            VALUE_TYPES.NULL ||
            definition.allowNull
        ) {

            return null;
        }

        return null;
    }

    const type =
        definition.type &&
        definition.type !==
            VALUE_TYPES.AUTO
            ? definition.type
            : inferType(
                value,
                options,
            );

    switch (
        type
    ) {

        case VALUE_TYPES.STRING:

            return normalizeString(
                value,
                options,
            );

        case VALUE_TYPES.BOOLEAN:

            return normalizeBoolean(
                value,
                options,
            );

        case VALUE_TYPES.INTEGER:

            return normalizeInteger(
                value,
            );

        case VALUE_TYPES.NUMBER:

            return normalizeNumber(
                value,
            );

        case VALUE_TYPES.BIGINT:

            return normalizeBigInt(
                value,
            );

        case VALUE_TYPES.JSON:

            return normalizeJson(
                value,
            );

        case VALUE_TYPES.ARRAY:

            return normalizeArray(
                value,
            );

        case VALUE_TYPES.CSV:

            return normalizeCsv(
                value,
            );

        case VALUE_TYPES.URL:

            return normalizeUrl(
                value,
            );

        case VALUE_TYPES.EMAIL:

            return normalizeEmail(
                value,
            );

        case VALUE_TYPES.DATE:

            return normalizeDate(
                value,
            );

        case VALUE_TYPES.NULL:

            return null;

        case VALUE_TYPES.AUTO:

        default:

            return normalizeString(
                value,
                options,
            );
    }
}

/**
 * =============================================================================
 * Namespace transformation
 * =============================================================================
 */

function setAtPath(
    object,
    path,
    value,
    options,
) {

    const parts =
        normalizePath(
            path,
        )
            .split('.')
            .filter(Boolean);

    if (
        parts.length ===
        0
    ) {

        throw new EnvironmentNormalizationError(
            'Normalization target path is required.',
            {
                code:
                    'ENVIRONMENT_NORMALIZATION_PATH_REQUIRED',
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
                options,
            )
        ) {

            throw new EnvironmentNormalizationError(
                `Forbidden normalization path key "${part}".`,
                {
                    code:
                        'ENVIRONMENT_NORMALIZATION_FORBIDDEN_KEY',

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

/**
 * =============================================================================
 * EnvironmentNormalizer
 * =============================================================================
 */

class EnvironmentNormalizer {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,

                forbiddenKeys:
                    Object.freeze([
                        ...(
                            options.forbiddenKeys ||
                            DEFAULTS.forbiddenKeys
                        ),
                    ]),

                booleanTrueValues:
                    Object.freeze([
                        ...(
                            options.booleanTrueValues ||
                            DEFAULTS.booleanTrueValues
                        ),
                    ]),

                booleanFalseValues:
                    Object.freeze([
                        ...(
                            options.booleanFalseValues ||
                            DEFAULTS.booleanFalseValues
                        ),
                    ]),
            });

        this.state =
            NORMALIZATION_STATES.CREATED;

        this.startedAt =
            null;

        this.completedAt =
            null;

        this.lastResult =
            null;

        this.lastError =
            null;

        this.history =
            [];

        this._normalizePromise =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize.
     * -------------------------------------------------------------------------
     */

    normalize(
        environment = process.env,
        options = {},
    ) {

        if (
            this._normalizePromise
        ) {

            return this._normalizePromise;
        }

        this._normalizePromise =
            Promise.resolve().then(
                () =>
                    this.normalizeSync(
                        environment,
                        options,
                    ),
            );

        return this._normalizePromise.finally(
            () => {
                this._normalizePromise =
                    null;
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Synchronous normalize.
     * -------------------------------------------------------------------------
     */

    normalizeSync(
        environment = process.env,
        options = {},
    ) {

        const started =
            process.hrtime.bigint();

        this.state =
            NORMALIZATION_STATES.NORMALIZING;

        this.startedAt =
            new Date();

        this.lastError =
            null;

        try {

            if (
                environment ===
                    null ||
                typeof environment !==
                    'object'
            ) {

                throw new EnvironmentNormalizationError(
                    'TITech environment input must be an object.',
                    {
                        code:
                            'ENVIRONMENT_INPUT_OBJECT_REQUIRED',
                    },
                );
            }

            const config =
                this.normalizeOptions(
                    options,
                );

            const source =
                config.cloneInput
                    ? clone(
                        environment,
                    )
                    : environment;

            const keys =
                Object.keys(
                    source,
                );

            if (
                keys.length >
                config.maxVariables
            ) {

                throw new EnvironmentNormalizationError(
                    'TITech environment variable count exceeds the configured maximum.',
                    {
                        code:
                            'ENVIRONMENT_VARIABLE_LIMIT_EXCEEDED',

                        details: {
                            count:
                                keys.length,

                            maximum:
                                config.maxVariables,
                        },
                    },
                );
            }

            const result =
                {};

            const provenance =
                {};

            const report = {
                total:
                    keys.length,

                normalized:
                    0,

                preserved:
                    0,

                skipped:
                    0,

                defaulted:
                    0,

                transformed:
                    0,

                conflicts:
                    [],

                warnings:
                    [],

                errors:
                    [],
            };

            const mappings =
                this.normalizeMappings(
                    config,
                );

            const mappedVariables =
                new Set();

            /**
             * ---------------------------------------------------------------
             * Explicit schema mappings.
             * ---------------------------------------------------------------
             */
            for (
                const mapping of
                mappings
            ) {

                if (
                    !Object.prototype.hasOwnProperty.call(
                        source,
                        mapping.variable,
                    )
                ) {

                    if (
                        mapping.default !==
                        undefined
                    ) {

                        const normalized =
                            normalizeValue(
                                mapping.default,
                                mapping,
                                config,
                            );

                        this.writeValue(
                            result,
                            provenance,
                            mapping.path,
                            normalized,
                            {
                                variable:
                                    mapping.variable,

                                source:
                                    'default',

                                type:
                                    mapping.type,

                                defaulted:
                                    true,
                            },
                            config,
                            report,
                        );

                        report.defaulted +=
                            1;

                    }

                    continue;
                }

                mappedVariables.add(
                    mapping.variable,
                );

                const rawValue =
                    source[
                        mapping.variable
                    ];

                try {

                    let value =
                        normalizeValue(
                            rawValue,
                            mapping,
                            config,
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

                                    raw:
                                        rawValue,

                                    type:
                                        mapping.type,
                                },
                            );

                        report.transformed +=
                            1;
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
                                mapping.type ||
                                inferType(
                                    rawValue,
                                    config,
                                ),

                            defaulted:
                                false,
                        },
                        config,
                        report,
                    );

                    report.normalized +=
                        1;

                } catch (
                    error
                ) {

                    this.recordError(
                        report,
                        error,
                        {
                            variable:
                                mapping.variable,

                            path:
                                mapping.path,
                        },
                    );
                }
            }

            /**
             * ---------------------------------------------------------------
             * Prefix mappings.
             * ---------------------------------------------------------------
             */
            const prefixes =
                this.normalizePrefixes(
                    config,
                );

            for (
                const variable of
                keys
            ) {

                if (
                    mappedVariables.has(
                        variable,
                    )
                ) {

                    continue;
                }

                const prefix =
                    prefixes.find(
                        definition =>
                            variable ===
                                definition.prefix ||
                            variable.startsWith(
                                `${definition.prefix}${definition.delimiter}`,
                            ),
                    );

                if (
                    !prefix
                ) {

                    if (
                        config
                            .preserveUnknown
                    ) {

                        this.writeUnknown(
                            result,
                            provenance,
                            variable,
                            source[
                                variable
                            ],
                            config,
                            report,
                        );

                        report.preserved +=
                            1;

                    } else {

                        report.skipped +=
                            1;
                    }

                    continue;
                }

                try {

                    const targetPath =
                        this.buildPrefixPath(
                            variable,
                            prefix,
                            config,
                        );

                    const type =
                        prefix.typeMap?.[
                            variable
                        ] ||
                        prefix.typeMap?.[
                            targetPath
                        ] ||
                        prefix.type ||
                        VALUE_TYPES.AUTO;

                    let value =
                        normalizeValue(
                            source[
                                variable
                            ],
                            {
                                type,
                            },
                            config,
                        );

                    if (
                        prefix.transform
                    ) {

                        value =
                            prefix.transform(
                                value,
                                {
                                    variable,

                                    path:
                                        targetPath,

                                    raw:
                                        source[
                                            variable
                                        ],

                                    namespace:
                                        prefix.namespace,
                                },
                            );

                        report.transformed +=
                            1;
                    }

                    this.writeValue(
                        result,
                        provenance,
                        targetPath,
                        value,
                        {
                            variable,

                            source:
                                prefix.prefix,

                            type,
                        },
                        config,
                        report,
                    );

                    report.normalized +=
                        1;

                } catch (
                    error
                ) {

                    this.recordError(
                        report,
                        error,
                        {
                            variable,
                        },
                    );
                }
            }

            /**
             * ---------------------------------------------------------------
             * Namespace-level normalization.
             * ---------------------------------------------------------------
             */
            this.normalizeExistingObjects(
                result,
                config,
            );

            /**
             * ---------------------------------------------------------------
             * Conflict/error policy.
             * ---------------------------------------------------------------
             */
            const fatal =
                report.errors.length >
                0;

            if (
                fatal &&
                config.failClosed
            ) {

                throw new EnvironmentNormalizationError(
                    'TITech environment normalization failed.',
                    {
                        code:
                            'ENVIRONMENT_NORMALIZATION_FAILED',

                        details: {
                            errors:
                                report.errors,
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

            const fingerprintPayload =
                this.buildFingerprintPayload(
                    result,
                );

            const fingerprintValue =
                fingerprint(
                    fingerprintPayload,
                    config
                        .fingerprintAlgorithm,
                );

            const degraded =
                report.warnings.length >
                    0 ||
                report.errors.length >
                    0;

            const output = {
                status:
                    fatal
                        ? NORMALIZATION_STATES
                            .FAILED
                        : degraded
                            ? NORMALIZATION_STATES
                                .DEGRADED
                            : NORMALIZATION_STATES
                                .READY,

                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                application:
                    APPLICATION_NAME,

                environment:
                    result,

                provenance:
                    config.trackProvenance
                        ? provenance
                        : {},

                report: {
                    ...report,

                    durationMs:
                        Number(
                            durationMs.toFixed(
                                3,
                            ),
                        ),
                },

                fingerprint: {
                    algorithm:
                        config
                            .fingerprintAlgorithm,

                    value:
                        fingerprintValue,
                },

                timestamp:
                    new Date().toISOString(),
            };

            this.lastResult =
                config.freezeResult
                    ? deepFreeze(
                        output,
                    )
                    : output;

            this.completedAt =
                new Date();

            this.state =
                fatal
                    ? NORMALIZATION_STATES.FAILED
                    : degraded
                        ? NORMALIZATION_STATES
                            .DEGRADED
                        : NORMALIZATION_STATES
                            .READY;

            this.recordHistory(
                {
                    type:
                        'normalization.completed',

                    status:
                        this.state,

                    total:
                        report.total,

                    normalized:
                        report.normalized,

                    errors:
                        report.errors.length,

                    warnings:
                        report.warnings.length,

                    fingerprint:
                        fingerprintValue,
                },
            );

            log(
                fatal
                    ? 'error'
                    : degraded
                        ? 'warn'
                        : 'info',
                {
                    state:
                        this.state,

                    total:
                        report.total,

                    normalized:
                        report.normalized,

                    errors:
                        report.errors.length,

                    warnings:
                        report.warnings.length,
                },
                fatal
                    ? 'TITech environment normalization failed.'
                    : degraded
                        ? 'TITech environment normalization completed with warnings.'
                        : 'TITech environment normalization completed successfully.',
            );

            return this.lastResult;

        } catch (
            error
        ) {

            this.state =
                NORMALIZATION_STATES.FAILED;

            this.lastError =
                error;

            this.completedAt =
                new Date();

            this.recordHistory(
                {
                    type:
                        'normalization.failed',

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

            throw (
                error instanceof
                EnvironmentNormalizationError
                    ? error
                    : new EnvironmentNormalizationError(
                        'TITech environment normalization failed.',
                        {
                            code:
                                'ENVIRONMENT_NORMALIZATION_RUNTIME_FAILURE',

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

            cloneInput:
                options.cloneInput ??
                this.options.cloneInput,

            freezeResult:
                options.freezeResult ??
                this.options.freezeResult,

            preserveUnknown:
                options.preserveUnknown ??
                this.options.preserveUnknown,

            maxVariables:
                options.maxVariables ||
                this.options.maxVariables,

            maxDepth:
                options.maxDepth ||
                this.options.maxDepth,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Mapping schema normalization.
     * -------------------------------------------------------------------------
     *
     * Example:
     *
     * {
     *   variable: 'PORT',
     *   path: 'http.port',
     *   type: 'integer',
     *   default: 5000
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

                    throw new EnvironmentNormalizationError(
                        `Invalid normalization mapping at index ${index}.`,
                        {
                            code:
                                'ENVIRONMENT_MAPPING_INVALID',
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
                        '',
                    );

                if (
                    !variable
                ) {

                    throw new EnvironmentNormalizationError(
                        'Normalization mapping variable is required.',
                        {
                            code:
                                'ENVIRONMENT_MAPPING_VARIABLE_REQUIRED',
                        },
                    );
                }

                if (
                    !path
                ) {

                    throw new EnvironmentNormalizationError(
                        `Normalization mapping target is required for "${variable}".`,
                        {
                            code:
                                'ENVIRONMENT_MAPPING_PATH_REQUIRED',

                            variable,
                        },
                    );
                }

                this.assertSafePath(
                    path,
                    options,
                );

                return {
                    variable,

                    path,

                    type:
                        mapping.type ||
                        VALUE_TYPES.AUTO,

                    default:
                        mapping.default,

                    allowNull:
                        mapping.allowNull ===
                        true,

                    transform:
                        typeof mapping.transform ===
                            'function'
                            ? mapping.transform
                            : null,

                    required:
                        mapping.required ===
                        true,
                };
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Prefix schema normalization.
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
            ) => {

                if (
                    !definition ||
                    typeof definition !==
                        'object'
                ) {

                    throw new EnvironmentNormalizationError(
                        'Invalid environment namespace prefix definition.',
                        {
                            code:
                                'ENVIRONMENT_PREFIX_INVALID',
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
                    String(
                        definition.namespace ||
                        prefix,
                    )
                        .trim()
                        .toLowerCase();

                if (
                    !prefix
                ) {

                    throw new EnvironmentNormalizationError(
                        'Environment prefix is required.',
                        {
                            code:
                                'ENVIRONMENT_PREFIX_REQUIRED',
                        },
                    );
                }

                this.assertSafePath(
                    namespace,
                    options,
                );

                return {
                    prefix,

                    namespace,

                    delimiter:
                        definition.delimiter ||
                        '_',

                    nestedDelimiter:
                        definition.nestedDelimiter ||
                        '__',

                    stripPrefix:
                        definition.stripPrefix !==
                        false,

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
                };
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Prefix target path.
     * -------------------------------------------------------------------------
     */

    buildPrefixPath(
        variable,
        prefix,
        options,
    ) {

        let tail =
            variable;

        if (
            prefix.stripPrefix
        ) {

            tail =
                tail.slice(
                    prefix.prefix.length,
                );

            if (
                tail.startsWith(
                    prefix.delimiter,
                )
            ) {

                tail =
                    tail.slice(
                        prefix.delimiter.length,
                    );
            }
        }

        if (
            !tail
        ) {

            throw new EnvironmentNormalizationError(
                `No namespace key remains after stripping prefix "${prefix.prefix}".`,
                {
                    code:
                        'ENVIRONMENT_PREFIX_KEY_EMPTY',

                    variable,
                },
            );
        }

        const nestedSegments =
            tail
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
                    segment =>
                        this.normalizeKey(
                            segment,
                            options,
                        ),
                );

        if (
            nestedSegments.length ===
            0
        ) {

            throw new EnvironmentNormalizationError(
                `Unable to construct namespace path for "${variable}".`,
                {
                    code:
                        'ENVIRONMENT_NAMESPACE_PATH_EMPTY',

                    variable,
                },
            );
        }

        const namespace =
            prefix.namespace;

        const path =
            [
                namespace,
                ...nestedSegments,
            ].join('.');

        return this.assertSafePath(
            path,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Unknown variable handling.
     * -------------------------------------------------------------------------
     */

    writeUnknown(
        result,
        provenance,
        variable,
        value,
        options,
        report,
    ) {

        const key =
            this.normalizeKey(
                variable,
                options,
            );

        const path =
            `${
                options.unknownNamespace ||
                'unknown'
            }.${key}`;

        try {

            this.assertSafePath(
                path,
                options,
            );

            const normalized =
                normalizeValue(
                    value,
                    {
                        type:
                            VALUE_TYPES.AUTO,
                    },
                    options,
                );

            this.writeValue(
                result,
                provenance,
                path,
                normalized,
                {
                    variable,

                    source:
                        'unknown',

                    type:
                        inferType(
                            value,
                            options,
                        ),
                },
                options,
                report,
            );

        } catch (
            error
        ) {

            this.recordError(
                report,
                error,
                {
                    variable,
                    path,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Write normalized value.
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
            options,
        );

        const existing =
            getAtPath(
                result,
                path,
            );

        const alreadyExists =
            existing !==
            undefined;

        if (
            alreadyExists &&
            options.detectConflicts &&
            stableStringify(
                existing,
            ) !==
            stableStringify(
                value,
            )
        ) {

            const conflict = {
                path,

                variable:
                    metadata.variable ||
                    null,

                previousSource:
                    provenance[
                        path
                    ]?.variable ||
                    provenance[
                        path
                    ]?.source ||
                    null,

                incomingSource:
                    metadata.variable ||
                    metadata.source ||
                    null,

                previousFingerprint:
                    fingerprint(
                        existing,
                        options
                            .fingerprintAlgorithm,
                    ),

                incomingFingerprint:
                    fingerprint(
                        value,
                        options
                            .fingerprintAlgorithm,
                    ),
            };

            report.conflicts.push(
                conflict,
            );

            if (
                options.strict &&
                options.failClosed
            ) {

                throw new EnvironmentNormalizationError(
                    `Normalization conflict detected for "${path}".`,
                    {
                        code:
                            'ENVIRONMENT_NORMALIZATION_CONFLICT',

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
            options,
        );

        if (
            options.trackProvenance
        ) {

            provenance[path] = {
                variable:
                    metadata.variable ||
                    null,

                source:
                    metadata.source ||
                    'environment',

                type:
                    metadata.type ||
                    VALUE_TYPES.AUTO,

                defaulted:
                    metadata.defaulted ===
                    true,

                sensitive:
                    isSensitive(
                        path,
                        options,
                    ) ||
                    isSensitive(
                        metadata.variable,
                        options,
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
     * Normalize object values already inside the result.
     * -------------------------------------------------------------------------
     */

    normalizeExistingObjects(
        value,
        options,
        depth = 0,
        currentPath = '',
    ) {

        if (
            depth >
            options.maxDepth
        ) {

            throw new EnvironmentNormalizationError(
                'Normalized environment exceeds maximum nesting depth.',
                {
                    code:
                        'ENVIRONMENT_MAX_DEPTH_EXCEEDED',

                    path:
                        currentPath,
                },
            );
        }

        if (
            !isPlainObject(
                value,
            )
        ) {

            return value;
        }

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
                    options,
                )
            ) {

                throw new EnvironmentNormalizationError(
                    `Forbidden environment key "${key}".`,
                    {
                        code:
                            'ENVIRONMENT_FORBIDDEN_KEY',

                        path:
                            currentPath
                                ? `${currentPath}.${key}`
                                : key,
                    },
                );
            }

            const path =
                currentPath
                    ? `${currentPath}.${key}`
                    : key;

            if (
                isPlainObject(
                    child,
                )
            ) {

                this.normalizeExistingObjects(
                    child,
                    options,
                    depth + 1,
                    path,
                );
            }
        }

        return value;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize key.
     * -------------------------------------------------------------------------
     */

    normalizeKey(
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
            !key
        ) {

            throw new EnvironmentNormalizationError(
                'Environment namespace key cannot be empty.',
                {
                    code:
                        'ENVIRONMENT_NAMESPACE_KEY_EMPTY',
                },
            );
        }

        if (
            options.lowercaseKeys
        ) {

            key =
                key.toLowerCase();
        }

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
                            index ===
                            0
                                ? part
                                : part.charAt(
                                      0,
                                  ).toUpperCase() +
                                  part.slice(
                                      1,
                                  ),
                    )
                    .join('');
        }

        return key;
    }

    /**
     * -------------------------------------------------------------------------
     * Safe target path.
     * -------------------------------------------------------------------------
     */

    assertSafePath(
        path,
        options,
    ) {

        const normalized =
            normalizePath(
                path,
            );

        if (
            !normalized
        ) {

            throw new EnvironmentNormalizationError(
                'Environment target path is empty.',
                {
                    code:
                        'ENVIRONMENT_PATH_EMPTY',
                },
            );
        }

        const parts =
            normalized
                .split('.')
                .filter(Boolean);

        if (
            parts.length >
            options.maxDepth
        ) {

            throw new EnvironmentNormalizationError(
                'Environment target path exceeds maximum depth.',
                {
                    code:
                        'ENVIRONMENT_MAX_DEPTH_EXCEEDED',

                    path:
                        normalized,
                },
            );
        }

        for (
            const part of
            parts
        ) {

            if (
                isForbiddenKey(
                    part,
                    options,
                )
            ) {

                throw new EnvironmentNormalizationError(
                    `Forbidden environment path component "${part}".`,
                    {
                        code:
                            'ENVIRONMENT_FORBIDDEN_KEY',

                        path:
                            normalized,
                    },
                );
            }
        }

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint payload.
     * -------------------------------------------------------------------------
     */

    buildFingerprintPayload(
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
                    this.buildFingerprintPayload(
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
                    isSensitive(
                        childPath,
                        this.options,
                    )
                ) {

                    output[key] =
                        '[REDACTED]';

                    continue;
                }

                output[key] =
                    this.buildFingerprintPayload(
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
     * Record error.
     * -------------------------------------------------------------------------
     */

    recordError(
        report,
        error,
        metadata = {},
    ) {

        report.errors.push(
            {
                variable:
                    metadata.variable ||
                    error.variable ||
                    null,

                path:
                    metadata.path ||
                    error.path ||
                    null,

                code:
                    error.code ||
                    'ENVIRONMENT_NORMALIZATION_ERROR',

                message:
                    error.message ||
                    String(
                        error,
                    ),
            },
        );

        return report.errors[
            report.errors.length - 1
        ];
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
                    NORMALIZATION_STATES.READY
                    ? 'ready'
                    : this.state ===
                        NORMALIZATION_STATES.DEGRADED
                        ? 'degraded'
                        : 'not_ready',

            ready:
                this.state ===
                    NORMALIZATION_STATES.READY ||
                this.state ===
                    NORMALIZATION_STATES.DEGRADED,

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
                    NORMALIZATION_STATES.READY
                    ? 'healthy'
                    : this.state ===
                        NORMALIZATION_STATES.DEGRADED
                        ? 'degraded'
                        : 'unhealthy',

            healthy:
                this.state ===
                NORMALIZATION_STATES.READY,

            degraded:
                this.state ===
                NORMALIZATION_STATES.DEGRADED,

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

        if (
            !this.lastResult
        ) {

            return deepFreeze({
                component:
                    COMPONENT,

                state:
                    this.state,

                environment:
                    null,

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

        const includeEnvironment =
            options.includeEnvironment ??
            true;

        const includeProvenance =
            options.includeProvenance ??
            this.options.trackProvenance;

        const exposeSensitiveValues =
            options.exposeSensitiveValues ??
            false;

        const environment =
            includeEnvironment
                ? clone(
                    this.lastResult
                        .environment,
                )
                : null;

        const safeEnvironment =
            exposeSensitiveValues
                ? environment
                : this.redactSensitive(
                    environment,
                );

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            environment:
                safeEnvironment,

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
                            this.lastError.name,

                        code:
                            this.lastError.code,

                        message:
                            this.lastError.message,
                    }
                    : null,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Redact sensitive snapshot fields.
     * -------------------------------------------------------------------------
     */

    redactSensitive(
        value,
        path = '',
    ) {

        if (
            isSensitive(
                path,
                this.options,
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
                    this.redactSensitive(
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

                output[key] =
                    this.redactSensitive(
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
     * Result accessors.
     * -------------------------------------------------------------------------
     */

    getEnvironment() {

        return (
            this.lastResult
                ?.environment ||
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
            this._normalizePromise
        ) {

            throw new EnvironmentNormalizationError(
                'Cannot reset TITech environment normalizer while normalization is active.',
                {
                    code:
                        'ENVIRONMENT_NORMALIZATION_RESET_NOT_ALLOWED',
                },
            );
        }

        this.state =
            NORMALIZATION_STATES.CREATED;

        this.startedAt =
            null;

        this.completedAt =
            null;

        this.lastResult =
            null;

        this.lastError =
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

const environmentNormalizer =
    new EnvironmentNormalizer();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function normalize(
    environment,
    options,
) {

    return environmentNormalizer.normalize(
        environment,
        options,
    );
}

function normalizeSync(
    environment,
    options,
) {

    return environmentNormalizer.normalizeSync(
        environment,
        options,
    );
}

function normalizeValuePublic(
    value,
    definition,
    options,
) {

    return normalizeValue(
        value,
        definition,
        {
            ...DEFAULTS,
            ...(options || {}),
        },
    );
}

function inferTypePublic(
    value,
    options,
) {

    return inferType(
        value,
        {
            ...DEFAULTS,
            ...(options || {}),
        },
    );
}

function readiness() {

    return environmentNormalizer.readiness();
}

function health() {

    return environmentNormalizer.health();
}

function snapshot(
    options,
) {

    return environmentNormalizer.snapshot(
        options,
    );
}

function reset() {

    return environmentNormalizer.reset();
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
        environmentNormalizer,

        EnvironmentNormalizer,

        EnvironmentNormalizationError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        NORMALIZATION_STATES,

        VALUE_TYPES,

        DEFAULTS,

        /**
         * Core operations.
         */
        normalize,

        normalizeSync,

        /**
         * Public value utilities.
         */
        normalizeValue:
            normalizeValuePublic,

        inferType:
            inferTypePublic,

        normalizeString,

        normalizeBoolean,

        normalizeInteger,

        normalizeNumber,

        normalizeBigInt,

        normalizeJson,

        normalizeArray,

        normalizeCsv,

        normalizeUrl,

        normalizeEmail,

        normalizeDate,

        /**
         * Path helpers.
         */
        normalizePath,

        /**
         * Diagnostics.
         */
        readiness,

        health,

        snapshot,

        /**
         * Utility.
         */
        fingerprint,

        stableStringify,

        /**
         * Test support.
         */
        reset,
    });