'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/normalizers/number.js
 *
 * Purpose:
 *   Enterprise production-grade numeric environment value normalizer.
 *
 * Responsibilities:
 *   - Convert raw TITech environment values into deterministic JavaScript
 *     numbers.
 *   - Support integer and floating-point values.
 *   - Support decimal and scientific notation.
 *   - Support controlled numeric separators.
 *   - Support configurable minimum/maximum bounds.
 *   - Support configurable integer-only mode.
 *   - Reject NaN, Infinity and unsafe numeric values by default.
 *   - Support defaults without mutating process.env.
 *   - Provide deterministic normalization metadata.
 *   - Produce stable numeric fingerprints.
 *   - Protect normalization metadata from prototype-pollution keys.
 *   - Support strict and explicitly permissive conversion modes.
 *   - Remain independent from configuration loading and infrastructure.
 *
 * IMPORTANT:
 *
 *   This module normalizes NUMBER VALUES only.
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
 *   backend/config/environment/normalizers/boolean.js
 *   backend/config/environment/normalizers/array.js
 *   backend/config/environment/environmentValidator.js
 *   backend/config/environment/validationErrors.js
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
    'environment-normalizer-number';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const NUMBER_INPUT_TYPES =
    Object.freeze({
        AUTO:
            'auto',

        STRING:
            'string',

        NUMBER:
            'number',

        BIGINT:
            'bigint',
    });

const NUMBER_MODES =
    Object.freeze({
        NUMBER:
            'number',

        INTEGER:
            'integer',

        SAFE_INTEGER:
            'safe-integer',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        inputType:
            NUMBER_INPUT_TYPES.AUTO,

        mode:
            NUMBER_MODES.NUMBER,

        trim:
            true,

        allowEmpty:
            false,

        emptyDefault:
            undefined,

        defaultValue:
            undefined,

        allowNumericSeparators:
            true,

        numericSeparator:
            '_',

        allowLeadingPlus:
            true,

        allowLeadingMinus:
            true,

        allowScientific:
            true,

        allowHex:
            false,

        allowBinary:
            false,

        allowOctal:
            false,

        allowInfinity:
            false,

        allowNaN:
            false,

        requireFinite:
            true,

        requireSafeInteger:
            false,

        min:
            undefined,

        max:
            undefined,

        exclusiveMin:
            false,

        exclusiveMax:
            false,

        precision:
            undefined,

        scale:
            undefined,

        maxInputLength:
            1_024,

        maxMetadataKeys:
            100,

        fingerprintAlgorithm:
            'sha256',

        freezeResult:
            true,

        includeSourceValue:
            false,

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

class NumberNormalizationError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'NumberNormalizationError';

        this.code =
            options.code ||
            'ENVIRONMENT_NUMBER_NORMALIZATION_ERROR';

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
            NumberNormalizationError,
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
            // Recursive fallback.
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
        output.length >
        options.maxInputLength
    ) {

        throw new NumberNormalizationError(
            'TITech numeric input exceeds the configured maximum length.',
            {
                code:
                    'NUMBER_INPUT_TOO_LONG',
            },
        );
    }

    return output;
}

function isForbiddenKey(
    key,
    options,
) {

    return options.forbiddenKeys.includes(
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

    const output = {};

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

        output[key] =
            clone(
                value,
            );

        count +=
            1;
    }

    return output;
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
        // Numeric normalization must not depend on logging.
    }
}

/**
 * =============================================================================
 * Input validation helpers
 * =============================================================================
 */

function normalizeNumericString(
    value,
    options,
) {

    let text =
        normalizeText(
            value,
            options,
        );

    if (
        text ===
        ''
    ) {

        if (
            options.allowEmpty
        ) {

            if (
                options.emptyDefault !==
                undefined
            ) {

                return String(
                    options.emptyDefault,
                );
            }

            if (
                options.defaultValue !==
                undefined
            ) {

                return String(
                    options.defaultValue,
                );
            }
        }

        throw new NumberNormalizationError(
            'Empty TITech numeric value is not allowed.',
            {
                code:
                    'NUMBER_EMPTY_VALUE',
            },
        );
    }

    if (
        options.allowNumericSeparators
    ) {

        text =
            text.replace(
                new RegExp(
                    escapeRegex(
                        options.numericSeparator,
                    ),
                    'g',
                ),
                '',
            );
    }

    if (
        !options.allowScientific &&
        /e/i.test(
            text,
        )
    ) {

        throw new NumberNormalizationError(
            `Scientific notation is disabled for TITech numeric value "${text}".`,
            {
                code:
                    'NUMBER_SCIENTIFIC_NOT_ALLOWED',
            },
        );
    }

    if (
        text.includes('Infinity') ||
        text.includes('NaN')
    ) {

        if (
            text ===
                'Infinity' ||
            text ===
                '+Infinity' ||
            text ===
                '-Infinity'
        ) {

            if (
                options.allowInfinity &&
                !options.requireFinite
            ) {

                return text;
            }

            throw new NumberNormalizationError(
                'Infinity is not permitted for TITech configuration numbers.',
                {
                    code:
                        'NUMBER_INFINITY_NOT_ALLOWED',
                },
            );
        }

        if (
            text ===
            'NaN'
        ) {

            if (
                options.allowNaN &&
                !options.requireFinite
            ) {

                return text;
            }

            throw new NumberNormalizationError(
                'NaN is not permitted for TITech configuration numbers.',
                {
                    code:
                        'NUMBER_NAN_NOT_ALLOWED',
                },
            );
        }

        throw new NumberNormalizationError(
            `Invalid TITech numeric value "${text}".`,
            {
                code:
                    'NUMBER_SPECIAL_VALUE_INVALID',
            },
        );
    }

    /**
     * Optional hexadecimal/binary/octal support.
     *
     * Disabled by default because environment configuration normally uses
     * decimal values and accepting alternate radices can cause operator
     * mistakes.
     */
    if (
        /^0x[0-9a-f]+$/i.test(
            text,
        )
    ) {

        if (
            !options.allowHex
        ) {

            throw new NumberNormalizationError(
                'Hexadecimal TITech numeric configuration is disabled.',
                {
                    code:
                        'NUMBER_HEX_NOT_ALLOWED',
                },
            );
        }

        return text;
    }

    if (
        /^0b[01]+$/i.test(
            text,
        )
    ) {

        if (
            !options.allowBinary
        ) {

            throw new NumberNormalizationError(
                'Binary TITech numeric configuration is disabled.',
                {
                    code:
                        'NUMBER_BINARY_NOT_ALLOWED',
                },
            );
        }

        return text;
    }

    if (
        /^0o[0-7]+$/i.test(
            text,
        )
    ) {

        if (
            !options.allowOctal
        ) {

            throw new NumberNormalizationError(
                'Octal TITech numeric configuration is disabled.',
                {
                    code:
                        'NUMBER_OCTAL_NOT_ALLOWED',
                },
            );
        }

        return text;
    }

    /**
     * Strict decimal/scientific syntax.
     *
     * Allowed:
     *   10
     *   -10
     *   +10
     *   10.5
     *   .5
     *   1.
     *   1e3
     *   -2.5E-4
     */
    const decimalPattern =
        options.allowScientific
            ? /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
            : /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))$/;

    if (
        !decimalPattern.test(
            text,
        )
    ) {

        throw new NumberNormalizationError(
            `Invalid TITech numeric format "${text}".`,
            {
                code:
                    'NUMBER_FORMAT_INVALID',
            },
        );
    }

    return text;
}

function parseStringNumber(
    value,
    options,
) {

    const text =
        normalizeNumericString(
            value,
            options,
        );

    let parsed;

    if (
        /^0x[0-9a-f]+$/i.test(
            text,
        )
    ) {

        parsed =
            Number.parseInt(
                text.slice(
                    2,
                ),
                16,
            );

    } else if (
        /^0b[01]+$/i.test(
            text,
        )
    ) {

        parsed =
            Number.parseInt(
                text.slice(
                    2,
                ),
                2,
            );

    } else if (
        /^0o[0-7]+$/i.test(
            text,
        )
    ) {

        parsed =
            Number.parseInt(
                text.slice(
                    2,
                ),
                8,
            );

    } else if (
        text ===
            'Infinity' ||
        text ===
            '+Infinity'
    ) {

        parsed =
            Infinity;

    } else if (
        text ===
        '-Infinity'
    ) {

        parsed =
            -Infinity;

    } else if (
        text ===
        'NaN'
    ) {

        parsed =
            NaN;

    } else {

        parsed =
            Number(
                text,
            );
    }

    return {
        value:
            parsed,

        source:
            text,
    };
}

function normalizeNumberType(
    value,
) {

    if (
        typeof value !==
        'number'
    ) {

        throw new NumberNormalizationError(
            'TITech number input type requires a JavaScript number.',
            {
                code:
                    'NUMBER_INPUT_TYPE_INVALID',
            },
        );
    }

    return value;
}

function normalizeBigIntType(
    value,
    options,
) {

    if (
        typeof value !==
        'bigint'
    ) {

        throw new NumberNormalizationError(
            'TITech bigint input type requires a bigint value.',
            {
                code:
                    'NUMBER_BIGINT_INPUT_TYPE_INVALID',
            },
        );
    }

    const converted =
        Number(
            value,
        );

    if (
        !Number.isSafeInteger(
            converted,
        )
    ) {

        throw new NumberNormalizationError(
            'TITech bigint exceeds JavaScript safe integer range.',
            {
                code:
                    'NUMBER_BIGINT_UNSAFE',
            },
        );
    }

    return converted;
}

/**
 * =============================================================================
 * Range and precision policy
 * =============================================================================
 */

function validateFinite(
    value,
    options,
) {

    if (
        Number.isNaN(
            value,
        )
    ) {

        if (
            options.allowNaN &&
            !options.requireFinite
        ) {

            return;
        }

        throw new NumberNormalizationError(
            'NaN is not permitted in TITech numeric configuration.',
            {
                code:
                    'NUMBER_NAN_NOT_ALLOWED',
            },
        );
    }

    if (
        !Number.isFinite(
            value,
        )
    ) {

        if (
            options.allowInfinity &&
            !options.requireFinite
        ) {

            return;
        }

        throw new NumberNormalizationError(
            'Infinite numeric values are not permitted in TITech configuration.',
            {
                code:
                    'NUMBER_INFINITY_NOT_ALLOWED',
            },
        );
    }
}

function validateIntegerMode(
    value,
    options,
) {

    if (
        options.mode ===
        NUMBER_MODES.INTEGER
    ) {

        if (
            !Number.isInteger(
                value,
            )
        ) {

            throw new NumberNormalizationError(
                `TITech value "${String(
                    value,
                )}" must be an integer.`,
                {
                    code:
                        'NUMBER_INTEGER_REQUIRED',
                },
            );
        }
    }

    if (
        options.mode ===
            NUMBER_MODES.SAFE_INTEGER ||
        options.requireSafeInteger
    ) {

        if (
            !Number.isSafeInteger(
                value,
            )
        ) {

            throw new NumberNormalizationError(
                `TITech value "${String(
                    value,
                )}" is outside the JavaScript safe integer range.`,
                {
                    code:
                        'NUMBER_SAFE_INTEGER_REQUIRED',
                },
            );
        }
    }
}

function validateRange(
    value,
    options,
) {

    if (
        options.min !==
            undefined
    ) {

        if (
            options.exclusiveMin
        ) {

            if (
                value <=
                options.min
            ) {

                throw new NumberNormalizationError(
                    `TITech numeric value must be greater than ${String(
                        options.min,
                    )}.`,
                    {
                        code:
                            'NUMBER_MIN_EXCLUSIVE',
                    },
                );
            }

        } else if (
            value <
            options.min
        ) {

            throw new NumberNormalizationError(
                `TITech numeric value must be at least ${String(
                    options.min,
                )}.`,
                {
                    code:
                        'NUMBER_MIN_EXCEEDED',
                },
            );
        }
    }

    if (
        options.max !==
            undefined
    ) {

        if (
            options.exclusiveMax
        ) {

            if (
                value >=
                options.max
            ) {

                throw new NumberNormalizationError(
                    `TITech numeric value must be less than ${String(
                        options.max,
                    )}.`,
                    {
                        code:
                            'NUMBER_MAX_EXCLUSIVE',
                    },
                );
            }

        } else if (
            value >
            options.max
        ) {

            throw new NumberNormalizationError(
                `TITech numeric value must be at most ${String(
                    options.max,
                )}.`,
                {
                    code:
                        'NUMBER_MAX_EXCEEDED',
                },
            );
        }
    }
}

function applyPrecision(
    value,
    options,
) {

    if (
        options.precision ===
        undefined &&
        options.scale ===
        undefined
    ) {

        return value;
    }

    if (
        !Number.isFinite(
            value,
        )
    ) {

        return value;
    }

    if (
        options.scale !==
        undefined
    ) {

        const scale =
            normalizeIntegerOption(
                options.scale,
                'scale',
            );

        const factor =
            10 ** scale;

        const rounded =
            Math.round(
                (value + Number.EPSILON) *
                factor,
            ) /
            factor;

        return rounded;
    }

    const precision =
        normalizeIntegerOption(
            options.precision,
            'precision',
        );

    if (
        value ===
        0
    ) {

        return 0;
    }

    const digits =
        Math.floor(
            Math.log10(
                Math.abs(
                    value,
                ),
            ),
        ) +
        1;

    const decimals =
        Math.max(
            precision -
                digits,
            0,
        );

    const factor =
        10 ** decimals;

    return (
        Math.round(
            (value + Number.EPSILON) *
            factor,
        ) /
        factor
    );
}

function normalizeIntegerOption(
    value,
    name,
) {

    const number =
        Number(
            value,
        );

    if (
        !Number.isInteger(
            number,
        ) ||
        number < 0
    ) {

        throw new NumberNormalizationError(
            `TITech ${name} must be a non-negative integer.`,
            {
                code:
                    `NUMBER_${name.toUpperCase()}_INVALID`,
            },
        );
    }

    return number;
}

/**
 * =============================================================================
 * NumberNormalizer
 * =============================================================================
 */

class NumberNormalizer {

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

            const parsed =
                this.normalizeValue(
                    value,
                    config,
                );

            validateFinite(
                parsed,
                config,
            );

            validateIntegerMode(
                parsed,
                config,
            );

            validateRange(
                parsed,
                config,
            );

            const adjusted =
                applyPrecision(
                    parsed,
                    config,
                );

            validateFinite(
                adjusted,
                config,
            );

            validateIntegerMode(
                adjusted,
                config,
            );

            validateRange(
                adjusted,
                config,
            );

            const result =
                this.buildResult(
                    value,
                    adjusted,
                    config,
                );

            this.lastResult =
                result;

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
                        adjusted,
                },
                'TITech environment number normalization completed.',
            );

            return config.freezeResult
                ? deepFreeze(
                    result,
                )
                : result;

        } catch (
            error
        ) {

            this.state =
                'failed';

            this.lastError =
                error;

            throw (
                error instanceof
                NumberNormalizationError
                    ? error
                    : new NumberNormalizationError(
                        'TITech number normalization failed.',
                        {
                            code:
                                'NUMBER_NORMALIZATION_FAILED',

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
     * Normalize only the numeric value.
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
     * Strict number.
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
     * Integer convenience.
     * -------------------------------------------------------------------------
     */

    integer(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    NUMBER_MODES.INTEGER,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Safe-integer convenience.
     * -------------------------------------------------------------------------
     */

    safeInteger(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    NUMBER_MODES.SAFE_INTEGER,

                requireSafeInteger:
                    true,
            },
        );
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

                return normalizeDefault(
                    options.defaultValue,
                    options,
                );
            }

            if (
                options.allowEmpty
            ) {

                if (
                    options.emptyDefault !==
                    undefined
                ) {

                    return normalizeDefault(
                        options.emptyDefault,
                        options,
                    );
                }

                throw new NumberNormalizationError(
                    'Empty TITech numeric value is allowed but no empty default was supplied.',
                    {
                        code:
                            'NUMBER_EMPTY_DEFAULT_REQUIRED',
                    },
                );
            }

            throw new NumberNormalizationError(
                'TITech numeric value is required.',
                {
                    code:
                        'NUMBER_VALUE_REQUIRED',
                },
            );
        }

        switch (
            options.inputType
        ) {

            case NUMBER_INPUT_TYPES.NUMBER:

                return normalizeNumberType(
                    value,
                );

            case NUMBER_INPUT_TYPES.BIGINT:

                return normalizeBigIntType(
                    value,
                    options,
                );

            case NUMBER_INPUT_TYPES.STRING:

                if (
                    typeof value !==
                    'string'
                ) {

                    throw new NumberNormalizationError(
                        'TITech numeric string input requires a string value.',
                        {
                            code:
                                'NUMBER_STRING_INPUT_TYPE_INVALID',
                        },
                    );
                }

                return parseStringNumber(
                    value,
                    options,
                ).value;

            case NUMBER_INPUT_TYPES.AUTO:
            default:

                if (
                    typeof value ===
                    'number'
                ) {

                    return value;
                }

                if (
                    typeof value ===
                    'bigint'
                ) {

                    return normalizeBigIntType(
                        value,
                        options,
                    );
                }

                if (
                    typeof value ===
                    'string'
                ) {

                    return parseStringNumber(
                        value,
                        options,
                    ).value;
                }

                throw new NumberNormalizationError(
                    `Unsupported TITech numeric input type "${typeof value}".`,
                    {
                        code:
                            'NUMBER_INPUT_UNSUPPORTED',
                    },
                );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Default normalization.
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

        const sourceText =
            typeof rawValue ===
            'string'
                ? rawValue.trim()
                : rawValue;

        const result = {
            value:
                normalizedValue,

            type:
                Number.isInteger(
                    normalizedValue,
                )
                    ? 'integer'
                    : 'number',

            mode:
                options.mode,

            changed:
                !(
                    typeof rawValue ===
                        'number' &&
                    Object.is(
                        rawValue,
                        normalizedValue,
                    )
                ),

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
                sourceText;
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate normalized value.
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
            'number'
        ) {

            throw new NumberNormalizationError(
                'TITech numeric validation requires a JavaScript number.',
                {
                    code:
                        'NUMBER_VALIDATION_TYPE_INVALID',

                    variable:
                        config.variable,

                    path:
                        config.path,
                },
            );
        }

        validateFinite(
            value,
            config,
        );

        validateIntegerMode(
            value,
            config,
        );

        validateRange(
            value,
            config,
        );

        return {
            valid:
                true,

            value,

            type:
                Number.isInteger(
                    value,
                )
                    ? 'integer'
                    : 'number',

            mode:
                config.mode,

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

            mode:
                config.mode,

            strict:
                config.strict,

            allowNumericSeparators:
                config.allowNumericSeparators,

            allowScientific:
                config.allowScientific,

            allowHex:
                config.allowHex,

            allowBinary:
                config.allowBinary,

            allowOctal:
                config.allowOctal,

            requireFinite:
                config.requireFinite,

            requireSafeInteger:
                config.requireSafeInteger,

            min:
                config.min,

            max:
                config.max,

            exclusiveMin:
                config.exclusiveMin,

            exclusiveMax:
                config.exclusiveMax,

            precision:
                config.precision,

            scale:
                config.scale,

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
 * Default normalization helper
 * =============================================================================
 */

function normalizeDefault(
    value,
    options,
) {

    if (
        typeof value ===
        'number'
    ) {

        return value;
    }

    if (
        typeof value ===
        'bigint'
    ) {

        return normalizeBigIntType(
            value,
            options,
        );
    }

    if (
        typeof value ===
        'string'
    ) {

        return parseStringNumber(
            value,
            options,
        ).value;
    }

    throw new NumberNormalizationError(
        'TITech numeric default value has an unsupported type.',
        {
            code:
                'NUMBER_DEFAULT_TYPE_INVALID',
        },
    );
}

/**
 * =============================================================================
 * Regex helper
 * =============================================================================
 */

function escapeRegex(
    value,
) {

    return String(
        value,
    ).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
    );
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const numberNormalizer =
    new NumberNormalizer();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function normalize(
    value,
    options,
) {

    return numberNormalizer.normalize(
        value,
        options,
    );
}

function numericValue(
    value,
    options,
) {

    return numberNormalizer.value(
        value,
        options,
    );
}

function requireNumber(
    value,
    options,
) {

    return numberNormalizer.require(
        value,
        options,
    );
}

function integer(
    value,
    options,
) {

    return numberNormalizer.integer(
        value,
        options,
    );
}

function safeInteger(
    value,
    options,
) {

    return numberNormalizer.safeInteger(
        value,
        options,
    );
}

function validate(
    value,
    options,
) {

    return numberNormalizer.validate(
        value,
        options,
    );
}

function describe(
    options,
) {

    return numberNormalizer.describe(
        options,
    );
}

function snapshot() {

    return numberNormalizer.snapshot();
}

function readiness() {

    return numberNormalizer.readiness();
}

function health() {

    return numberNormalizer.health();
}

function reset() {

    return numberNormalizer.reset();
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
        numberNormalizer,

        NumberNormalizer,

        NumberNormalizationError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        NUMBER_INPUT_TYPES,

        NUMBER_MODES,

        DEFAULTS,

        /**
         * Core.
         */
        normalize,

        value:
            numericValue,

        require:
            requireNumber,

        integer,

        safeInteger,

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