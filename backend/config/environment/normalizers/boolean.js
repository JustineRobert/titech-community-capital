'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/normalizers/boolean.js
 *
 * Purpose:
 *   Enterprise production-grade boolean environment normalizer.
 *
 * Responsibilities:
 *   - Convert raw TITech environment values into deterministic booleans.
 *   - Support canonical true/false representations.
 *   - Support numeric, string and boolean inputs.
 *   - Support configurable accepted aliases.
 *   - Reject ambiguous values in strict mode.
 *   - Support defaults without mutating process.env.
 *   - Provide diagnostics and explainable normalization results.
 *   - Produce deterministic fingerprints.
 *   - Protect against prototype-pollution style keys in metadata.
 *   - Return immutable results when configured.
 *
 * IMPORTANT:
 *
 *   This module normalizes BOOLEAN VALUES only.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - merge configuration layers.
 *     - determine configuration precedence.
 *     - validate complete application configuration.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - start Express.
 *     - start the HTTP server.
 *     - execute financial transactions.
 *
 * Related modules:
 *
 *   backend/config/environment/normalizeEnvironment.js
 *   backend/config/environment/normalizers/array.js
 *   backend/config/environment/environmentValidator.js
 *   backend/config/environment/validationErrors.js
 *
 * =============================================================================
 */

'use strict';

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
        require('../../../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-normalizer-boolean';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const BOOLEAN_STATES =
    Object.freeze({
        TRUE:
            true,

        FALSE:
            false,
    });

const BOOLEAN_INPUT_TYPES =
    Object.freeze({
        AUTO:
            'auto',

        BOOLEAN:
            'boolean',

        STRING:
            'string',

        NUMBER:
            'number',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        trim:
            true,

        caseInsensitive:
            true,

        allowNumeric:
            true,

        allowBoolean:
            true,

        allowString:
            true,

        allowEmpty:
            false,

        emptyDefault:
            undefined,

        defaultValue:
            undefined,

        inputType:
            BOOLEAN_INPUT_TYPES.AUTO,

        trueValues:
            Object.freeze([
                'true',
                '1',
                'yes',
                'y',
                'on',
                'enabled',
                'enable',
                'active',
                'accepted',
            ]),

        falseValues:
            Object.freeze([
                'false',
                '0',
                'no',
                'n',
                'off',
                'disabled',
                'disable',
                'inactive',
                'rejected',
            ]),

        /**
         * Explicitly ambiguous values.
         *
         * These are intentionally NOT silently coerced.
         */
        ambiguousValues:
            Object.freeze([
                '',
                'null',
                'undefined',
                'none',
                'nil',
                'unknown',
                'maybe',
            ]),

        maxInputLength:
            1_024,

        fingerprintAlgorithm:
            'sha256',

        freezeResult:
            true,

        includeSourceValue:
            false,

        maxMetadataKeys:
            100,

        forbiddenKeys:
            Object.freeze([
                '__proto__',
                'prototype',
                'constructor',
            ]),
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class BooleanNormalizationError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'BooleanNormalizationError';

        this.code =
            options.code ||
            'ENVIRONMENT_BOOLEAN_NORMALIZATION_ERROR';

        this.variable =
            options.variable ||
            null;

        this.path =
            options.path ||
            null;

        this.input =
            options.input ===
                undefined
                ? null
                : options.input;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            BooleanNormalizationError,
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
        value ===
            undefined ||
        value ===
            null
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

function normalizeOptions(
    options = {},
) {

    return {
        ...DEFAULTS,
        ...options,

        trueValues:
            [
                ...(
                    options.trueValues ||
                    DEFAULTS.trueValues
                ),
            ],

        falseValues:
            [
                ...(
                    options.falseValues ||
                    DEFAULTS.falseValues
                ),
            ],

        ambiguousValues:
            [
                ...(
                    options.ambiguousValues ||
                    DEFAULTS.ambiguousValues
                ),
            ],

        forbiddenKeys:
            [
                ...(
                    options.forbiddenKeys ||
                    DEFAULTS.forbiddenKeys
                ),
            ],
    };
}

function normalizeText(
    value,
    options,
) {

    let output =
        String(
            value,
        );

    if (
        options.trim
    ) {

        output =
            output.trim();
    }

    if (
        options.caseInsensitive
    ) {

        output =
            output.toLowerCase();
    }

    if (
        output.length >
        options.maxInputLength
    ) {

        throw new BooleanNormalizationError(
            'TITech boolean input exceeds the configured maximum length.',
            {
                code:
                    'BOOLEAN_INPUT_TOO_LONG',
            },
        );
    }

    return output;
}

function normalizeNumber(
    value,
    options,
) {

    if (
        !options.allowNumeric
    ) {

        throw new BooleanNormalizationError(
            'Numeric boolean values are disabled by policy.',
            {
                code:
                    'BOOLEAN_NUMERIC_INPUT_DISABLED',
            },
        );
    }

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

    /**
     * Strict handling deliberately excludes arbitrary truthiness.
     *
     * Examples:
     *   2    -> invalid
     *  -1    -> invalid
     *   NaN  -> invalid
     */
    throw new BooleanNormalizationError(
        `Invalid TITech numeric boolean value "${String(
            value,
        )}".`,
        {
            code:
                'BOOLEAN_NUMERIC_VALUE_INVALID',
        },
    );
}

function normalizeBoolean(
    value,
    options,
) {

    if (
        !options.allowBoolean
    ) {

        throw new BooleanNormalizationError(
            'Boolean input values are disabled by policy.',
            {
                code:
                    'BOOLEAN_INPUT_DISABLED',
            },
        );
    }

    return value;
}

function normalizeStringBoolean(
    value,
    options,
) {

    if (
        !options.allowString
    ) {

        throw new BooleanNormalizationError(
            'String boolean values are disabled by policy.',
            {
                code:
                    'BOOLEAN_STRING_INPUT_DISABLED',
            },
        );
    }

    const normalized =
        normalizeText(
            value,
            options,
        );

    /**
     * Empty strings are treated separately from false.
     */
    if (
        normalized ===
        ''
    ) {

        if (
            options.allowEmpty
        ) {

            if (
                options.emptyDefault !==
                undefined
            ) {

                return Boolean(
                    options.emptyDefault,
                );
            }

            if (
                options.defaultValue !==
                undefined
            ) {

                return Boolean(
                    options.defaultValue,
                );
            }
        }

        throw new BooleanNormalizationError(
            'Empty TITech boolean value is not allowed.',
            {
                code:
                    'BOOLEAN_EMPTY_VALUE',
            },
        );
    }

    if (
        options.ambiguousValues.some(
            candidate =>
                (
                    options.caseInsensitive
                        ? String(
                            candidate,
                        ).toLowerCase()
                        : String(
                            candidate,
                        )
                ) ===
                normalized,
        )
    ) {

        /**
         * `''` has already been handled above. Remaining ambiguous values are
         * deliberately not treated as false.
         */
        throw new BooleanNormalizationError(
            `Ambiguous TITech boolean value "${normalized}".`,
            {
                code:
                    'BOOLEAN_AMBIGUOUS_VALUE',
            },
        );
    }

    const trueValues =
        normalizeAcceptedValues(
            options.trueValues,
            options,
        );

    const falseValues =
        normalizeAcceptedValues(
            options.falseValues,
            options,
        );

    if (
        trueValues.has(
            normalized,
        )
    ) {

        return true;
    }

    if (
        falseValues.has(
            normalized,
        )
    ) {

        return false;
    }

    throw new BooleanNormalizationError(
        `Invalid TITech boolean value "${normalized}".`,
        {
            code:
                'BOOLEAN_STRING_VALUE_INVALID',

            details: {
                acceptedTrue:
                    [...trueValues],

                acceptedFalse:
                    [...falseValues],
            },
        },
    );
}

function normalizeAcceptedValues(
    values,
    options,
) {

    const output =
        new Set();

    for (
        const value of
        values || []
    ) {

        let normalized =
            String(
                value,
            );

        if (
            options.trim
        ) {

            normalized =
                normalized.trim();
        }

        if (
            options.caseInsensitive
        ) {

            normalized =
                normalized.toLowerCase();
        }

        if (
            normalized.length >
            0
        ) {

            output.add(
                normalized,
            );
        }
    }

    return output;
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
    options = DEFAULTS,
) {

    return crypto
        .createHash(
            options.fingerprintAlgorithm ||
                DEFAULTS.fingerprintAlgorithm,
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

function isForbiddenKey(
    key,
    options,
) {

    return options
        .forbiddenKeys
        .includes(
            key,
        );
}

function sanitizeMetadata(
    metadata,
    options,
) {

    if (
        !metadata ||
        typeof metadata !==
            'object'
    ) {

        return {};
    }

    const result =
        {};

    let count =
        0;

    for (
        const [
            key,
            value,
        ] of Object.entries(
            metadata,
        )
    ) {

        if (
            count >=
            options.maxMetadataKeys
        ) {

            break;
        }

        if (
            isForbiddenKey(
                key,
                options,
            )
        ) {

            continue;
        }

        result[key] =
            clone(
                value,
            );

        count +=
            1;
    }

    return result;
}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console;

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
        // Normalization must remain independent of logging.
    }
}

/**
 * =============================================================================
 * Normalization engine
 * =============================================================================
 */

class BooleanNormalizer {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze(
                normalizeOptions(
                    options,
                ),
            );

        this.state =
            'created';

        this.normalizationCount =
            0;

        this.lastResult =
            null;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize.
     * -------------------------------------------------------------------------
     */

    normalize(
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        this.state =
            'normalizing';

        try {

            const result =
                this.normalizeValue(
                    value,
                    config,
                );

            const normalizedResult =
                this.buildResult(
                    value,
                    result,
                    config,
                );

            this.lastResult =
                normalizedResult;

            this.lastError =
                null;

            this.state =
                'ready';

            this.normalizationCount +=
                1;

            log(
                'debug',
                {
                    variable:
                        config.variable ||
                        null,

                    path:
                        config.path ||
                        null,

                    value:
                        result,
                },
                'TITech environment boolean normalization completed.',
            );

            return config.freezeResult
                ? deepFreeze(
                    normalizedResult,
                )
                : normalizedResult;

        } catch (
            error
        ) {

            this.state =
                'failed';

            this.lastError =
                error;

            throw (
                error instanceof
                BooleanNormalizationError
                    ? error
                    : new BooleanNormalizationError(
                        'TITech boolean normalization failed.',
                        {
                            code:
                                'BOOLEAN_NORMALIZATION_FAILED',

                            variable:
                                config.variable,

                            path:
                                config.path,

                            cause:
                                error,
                        },
                    )
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize raw value.
     * -------------------------------------------------------------------------
     */

    normalizeValue(
        value,
        options,
    ) {

        if (
            value ===
                undefined ||
            value ===
                null
        ) {

            if (
                options.defaultValue !==
                undefined
            ) {

                return Boolean(
                    options.defaultValue,
                );
            }

            if (
                options.allowEmpty
            ) {

                if (
                    options.emptyDefault !==
                    undefined
                ) {

                    return Boolean(
                        options.emptyDefault,
                    );
                }

                throw new BooleanNormalizationError(
                    'TITech boolean value is empty and no default was provided.',
                    {
                        code:
                            'BOOLEAN_EMPTY_VALUE',
                    },
                );
            }

            throw new BooleanNormalizationError(
                'TITech boolean value is required.',
                {
                    code:
                        'BOOLEAN_VALUE_REQUIRED',
                },
            );
        }

        switch (
            options.inputType
        ) {

            case BOOLEAN_INPUT_TYPES.BOOLEAN:

                if (
                    typeof value !==
                    'boolean'
                ) {

                    throw new BooleanNormalizationError(
                        'TITech boolean input type requires a boolean value.',
                        {
                            code:
                                'BOOLEAN_INPUT_TYPE_INVALID',
                        },
                    );
                }

                return normalizeBoolean(
                    value,
                    options,
                );

            case BOOLEAN_INPUT_TYPES.STRING:

                if (
                    typeof value !==
                    'string'
                ) {

                    throw new BooleanNormalizationError(
                        'TITech boolean string input type requires a string value.',
                        {
                            code:
                                'BOOLEAN_STRING_INPUT_TYPE_INVALID',
                        },
                    );
                }

                return normalizeStringBoolean(
                    value,
                    options,
                );

            case BOOLEAN_INPUT_TYPES.NUMBER:

                if (
                    typeof value !==
                    'number'
                ) {

                    throw new BooleanNormalizationError(
                        'TITech numeric boolean input type requires a number.',
                        {
                            code:
                                'BOOLEAN_NUMBER_INPUT_TYPE_INVALID',
                        },
                    );
                }

                return normalizeNumber(
                    value,
                    options,
                );

            case BOOLEAN_INPUT_TYPES.AUTO:
            default:

                if (
                    typeof value ===
                    'boolean'
                ) {

                    return normalizeBoolean(
                        value,
                        options,
                    );
                }

                if (
                    typeof value ===
                    'number'
                ) {

                    return normalizeNumber(
                        value,
                        options,
                    );
                }

                if (
                    typeof value ===
                    'string'
                ) {

                    return normalizeStringBoolean(
                        value,
                        options,
                    );
                }

                throw new BooleanNormalizationError(
                    `Unsupported TITech boolean input type "${typeof value}".`,
                    {
                        code:
                            'BOOLEAN_INPUT_UNSUPPORTED',
                    },
                );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Build result.
     * -------------------------------------------------------------------------
     */

    buildResult(
        rawValue,
        normalizedValue,
        options,
    ) {

        const metadata =
            sanitizeMetadata(
                options.metadata,
                options,
            );

        const result = {
            value:
                normalizedValue,

            type:
                'boolean',

            changed:
                typeof rawValue ===
                    'boolean'
                    ? rawValue !==
                      normalizedValue
                    : true,

            variable:
                options.variable ||
                null,

            path:
                options.path ||
                null,

            metadata,

            fingerprint:
                fingerprint(
                    {
                        value:
                            normalizedValue,

                        variable:
                            options.variable ||
                            null,

                        path:
                            options.path ||
                            null,
                    },
                    options,
                ),

            timestamp:
                new Date().toISOString(),
        };

        if (
            options.includeSourceValue
        ) {

            result.sourceValue =
                clone(
                    rawValue,
                );
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize only the value.
     * -------------------------------------------------------------------------
     */

    value(
        input,
        options = {},
    ) {

        return this.normalize(
            input,
            {
                ...options,
                freezeResult:
                    false,
            },
        ).value;
    }

    /**
     * -------------------------------------------------------------------------
     * Require explicit boolean.
     * -------------------------------------------------------------------------
     */

    require(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                strict:
                    true,

                failClosed:
                    true,

                allowEmpty:
                    false,

                defaultValue:
                    undefined,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Parse permissively.
     * -------------------------------------------------------------------------
     */

    parse(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                strict:
                    false,

                failClosed:
                    false,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Convenience true/false checks.
     * -------------------------------------------------------------------------
     */

    isTrue(
        input,
        options = {},
    ) {

        try {

            return (
                this.value(
                    input,
                    options,
                ) ===
                true
            );

        } catch {

            return false;
        }
    }

    isFalse(
        input,
        options = {},
    ) {

        try {

            return (
                this.value(
                    input,
                    options,
                ) ===
                false
            );

        } catch {

            return false;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Validate already-normalized value.
     * -------------------------------------------------------------------------
     */

    validate(
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        if (
            typeof value !==
            'boolean'
        ) {

            throw new BooleanNormalizationError(
                'TITech boolean validation requires a boolean value.',
                {
                    code:
                        'BOOLEAN_VALIDATION_TYPE_INVALID',

                    variable:
                        config.variable,

                    path:
                        config.path,
                },
            );
        }

        return {
            valid:
                true,

            value,

            type:
                'boolean',

            fingerprint:
                fingerprint(
                    value,
                    config,
                ),

            variable:
                config.variable ||
                null,

            path:
                config.path ||
                null,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Describe policy.
     * -------------------------------------------------------------------------
     */

    describe(
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            inputType:
                config.inputType,

            strict:
                config.strict,

            allowNumeric:
                config.allowNumeric,

            allowBoolean:
                config.allowBoolean,

            allowString:
                config.allowString,

            allowEmpty:
                config.allowEmpty,

            trueValues:
                [
                    ...config.trueValues,
                ],

            falseValues:
                [
                    ...config.falseValues,
                ],

            ambiguousValues:
                [
                    ...config.ambiguousValues,
                ],

            defaultValue:
                config.defaultValue,

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            lastResult:
                clone(
                    this.lastResult,
                ),

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

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        return {
            status:
                this.state ===
                    'failed'
                    ? 'not_ready'
                    : 'ready',

            ready:
                this.state !==
                'failed',

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

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

        const readiness =
            this.readiness();

        return {
            status:
                readiness.ready
                    ? 'healthy'
                    : 'unhealthy',

            healthy:
                readiness.ready,

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.state =
            'created';

        this.normalizationCount =
            0;

        this.lastResult =
            null;

        this.lastError =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const booleanNormalizer =
    new BooleanNormalizer();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function normalize(
    input,
    options,
) {

    return booleanNormalizer.normalize(
        input,
        options,
    );
}

function value(
    input,
    options,
) {

    return booleanNormalizer.value(
        input,
        options,
    );
}

function requireBoolean(
    input,
    options,
) {

    return booleanNormalizer.require(
        input,
        options,
    );
}

function parse(
    input,
    options,
) {

    return booleanNormalizer.parse(
        input,
        options,
    );
}

function isTrue(
    input,
    options,
) {

    return booleanNormalizer.isTrue(
        input,
        options,
    );
}

function isFalse(
    input,
    options,
) {

    return booleanNormalizer.isFalse(
        input,
        options,
    );
}

function validate(
    input,
    options,
) {

    return booleanNormalizer.validate(
        input,
        options,
    );
}

function describe(
    options,
) {

    return booleanNormalizer.describe(
        options,
    );
}

function snapshot() {

    return booleanNormalizer.snapshot();
}

function readiness() {

    return booleanNormalizer.readiness();
}

function health() {

    return booleanNormalizer.health();
}

function reset() {

    return booleanNormalizer.reset();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton and class.
         */
        booleanNormalizer,

        BooleanNormalizer,

        BooleanNormalizationError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        BOOLEAN_STATES,

        BOOLEAN_INPUT_TYPES,

        DEFAULTS,

        /**
         * Core normalization.
         */
        normalize,

        value,

        require:
            requireBoolean,

        parse,

        /**
         * Convenience checks.
         */
        isTrue,

        isFalse,

        /**
         * Validation.
         */
        validate,

        /**
         * Diagnostics.
         */
        describe,

        snapshot,

        readiness,

        health,

        /**
         * Utility.
         */
        fingerprint,

        stableStringify,

        /**
         * Reset.
         */
        reset,
    });