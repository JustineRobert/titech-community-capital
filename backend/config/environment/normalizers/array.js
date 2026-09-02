'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/normalizers/array.js
 *
 * Purpose:
 *   Enterprise production-grade environment array normalizer.
 *
 * Responsibilities:
 *   - Convert raw environment values into deterministic arrays.
 *   - Support CSV, JSON-array and repeated-delimiter input formats.
 *   - Normalize whitespace and optional casing.
 *   - Remove empty values safely.
 *   - Support configurable deduplication.
 *   - Support configurable item-level normalization.
 *   - Validate maximum item count and item length.
 *   - Preserve stable ordering.
 *   - Prevent prototype-pollution values.
 *   - Provide safe diagnostics and fingerprints.
 *   - Support explicit typed array schemas.
 *   - Remain independent from environment loading and validation orchestration.
 *
 * IMPORTANT:
 *
 *   This module normalizes ARRAY VALUES only.
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
 *     - execute business or financial transactions.
 *
 * Related modules:
 *
 *   backend/config/environment/normalizeEnvironment.js
 *   backend/config/environment/namespaceBuilder.js
 *   backend/config/environment/environmentValidator.js
 *
 * =============================================================================
 *
 * Supported inputs:
 *
 *   "a,b,c"
 *
 *   "a, b, c"
 *
 *   ["a", "b", "c"]
 *
 *   '["a","b","c"]'
 *
 *   "a|b|c"
 *
 *   "a;b;c"
 *
 *   Multi-line:
 *
 *     a
 *     b
 *     c
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
    'environment-normalizer-array';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const ARRAY_INPUT_TYPES =
    Object.freeze({
        AUTO:
            'auto',

        CSV:
            'csv',

        JSON:
            'json',

        DELIMITED:
            'delimited',

        REPEATED:
            'repeated',

        ARRAY:
            'array',
    });

const ITEM_TYPES =
    Object.freeze({
        STRING:
            'string',

        INTEGER:
            'integer',

        NUMBER:
            'number',

        BOOLEAN:
            'boolean',

        URL:
            'url',

        EMAIL:
            'email',

        JSON:
            'json',
    });

const DEFAULTS =
    Object.freeze({
        inputType:
            ARRAY_INPUT_TYPES.AUTO,

        delimiter:
            ',',

        delimiters:
            Object.freeze([
                ',',
            ]),

        trimItems:
            true,

        removeEmpty:
            true,

        deduplicate:
            true,

        caseSensitive:
            true,

        lowercase:
            false,

        uppercase:
            false,

        preserveOrder:
            true,

        itemType:
            ITEM_TYPES.STRING,

        maxItems:
            2_000,

        maxItemLength:
            16_384,

        maxInputLength:
            32_768,

        allowEmptyArray:
            true,

        allowEmptyInput:
            true,

        allowNestedArrays:
            false,

        flattenNestedArrays:
            true,

        parseJson:
            true,

        parseQuotedCsv:
            true,

        normalizeUrls:
            true,

        normalizeEmails:
            true,

        validateItems:
            true,

        strict:
            true,

        failClosed:
            true,

        freezeResult:
            true,

        fingerprintAlgorithm:
            'sha256',

        forbiddenItems:
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

class ArrayNormalizationError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'ArrayNormalizationError';

        this.code =
            options.code ||
            'ENVIRONMENT_ARRAY_NORMALIZATION_ERROR';

        this.index =
            options.index ??
            null;

        this.value =
            options.value ??
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
            ArrayNormalizationError,
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

function normalizeOptions(
    options = {},
) {

    return {
        ...DEFAULTS,
        ...options,

        delimiters:
            Array.isArray(
                options.delimiters,
            )
                ? [
                    ...options.delimiters,
                ]
                : [
                    options.delimiter ||
                    DEFAULTS.delimiter,
                ],

        forbiddenItems:
            [
                ...(
                    options.forbiddenItems ||
                    DEFAULTS.forbiddenItems
                ),
            ],
    };
}

function normalizeString(
    value,
    options,
) {

    let result =
        String(
            value,
        );

    if (
        options.trimItems
    ) {

        result =
            result.trim();
    }

    if (
        options.lowercase
    ) {

        result =
            result.toLowerCase();
    }

    if (
        options.uppercase
    ) {

        result =
            result.toUpperCase();
    }

    if (
        result.length >
        options.maxItemLength
    ) {

        throw new ArrayNormalizationError(
            'TITech array item exceeds configured maximum length.',
            {
                code:
                    'ARRAY_ITEM_TOO_LONG',
            },
        );
    }

    return result;
}

function isForbiddenItem(
    value,
    options,
) {

    if (
        typeof value !==
        'string'
    ) {

        return false;
    }

    return options
        .forbiddenItems
        .includes(
            value,
        );
}

function isEmpty(
    value,
) {

    return (
        value ===
            undefined ||
        value ===
            null ||
        (
            typeof value ===
                'string' &&
            value.trim() ===
                ''
        )
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
        // Normalization remains logger-independent.
    }
}

/**
 * =============================================================================
 * CSV parsing
 * =============================================================================
 *
 * Handles quoted CSV:
 *
 *   one,"two,with,commas",three
 *
 * and escaped quotes:
 *
 *   one,"two ""quoted""",three
 *
 * =============================================================================
 */

function parseCsv(
    input,
    options,
) {

    const text =
        String(
            input,
        );

    const values =
        [];

    let current =
        '';

    let insideQuotes =
        false;

    for (
        let index = 0;
        index < text.length;
        index += 1
    ) {

        const character =
            text[index];

        if (
            character === '"'
        ) {

            if (
                insideQuotes &&
                text[index + 1] ===
                    '"'
            ) {

                current +=
                    '"';

                index +=
                    1;

                continue;
            }

            insideQuotes =
                !insideQuotes;

            continue;
        }

        if (
            character ===
                options.delimiter &&
            !insideQuotes
        ) {

            values.push(
                current,
            );

            current =
                '';

            continue;
        }

        current +=
            character;
    }

    if (
        insideQuotes
    ) {

        throw new ArrayNormalizationError(
            'TITech CSV environment value contains an unterminated quoted field.',
            {
                code:
                    'ARRAY_CSV_UNTERMINATED_QUOTE',
            },
        );
    }

    values.push(
        current,
    );

    return values;
}

/**
 * =============================================================================
 * Delimited parsing
 * =============================================================================
 */

function parseDelimited(
    input,
    options,
) {

    const text =
        String(
            input,
        );

    const delimiters =
        [
            ...options.delimiters,
        ]
            .filter(
                delimiter =>
                    typeof delimiter ===
                        'string' &&
                    delimiter.length >
                        0,
            )
            .sort(
                (
                    left,
                    right,
                ) =>
                    right.length -
                    left.length,
            );

    if (
        delimiters.length ===
        0
    ) {

        return [
            text,
        ];
    }

    const escaped =
        delimiters.map(
            escapeRegex,
        );

    const pattern =
        new RegExp(
            escaped.join('|'),
            'g',
        );

    return text.split(
        pattern,
    );
}

/**
 * =============================================================================
 * JSON parsing
 * =============================================================================
 */

function parseJsonArray(
    input,
) {

    let parsed;

    try {

        parsed =
            JSON.parse(
                String(
                    input,
                ),
            );

    } catch (
        error
    ) {

        throw new ArrayNormalizationError(
            'TITech environment array contains invalid JSON.',
            {
                code:
                    'ARRAY_JSON_INVALID',

                cause:
                    error,
            },
        );
    }

    if (
        !Array.isArray(
            parsed,
        )
    ) {

        throw new ArrayNormalizationError(
            'TITech JSON environment value must contain an array.',
            {
                code:
                    'ARRAY_JSON_NOT_ARRAY',
            },
        );
    }

    return parsed;
}

/**
 * =============================================================================
 * Nested-array handling
 * =============================================================================
 */

function flattenArray(
    input,
    options,
    depth = 0,
) {

    if (
        depth >
        20
    ) {

        throw new ArrayNormalizationError(
            'TITech environment array nesting exceeds safe limits.',
            {
                code:
                    'ARRAY_NESTING_TOO_DEEP',
            },
        );
    }

    const output =
        [];

    for (
        const item of
        input
    ) {

        if (
            Array.isArray(
                item,
            )
        ) {

            if (
                !options.allowNestedArrays
            ) {

                if (
                    options.flattenNestedArrays
                ) {

                    output.push(
                        ...flattenArray(
                            item,
                            options,
                            depth + 1,
                        ),
                    );

                    continue;
                }

                throw new ArrayNormalizationError(
                    'Nested arrays are not permitted by the TITech array normalization policy.',
                    {
                        code:
                            'ARRAY_NESTED_ARRAY_NOT_ALLOWED',
                    },
                );
            }

            if (
                options.flattenNestedArrays
            ) {

                output.push(
                    ...flattenArray(
                        item,
                        options,
                        depth + 1,
                    ),
                );

            } else {

                output.push(
                    item,
                );
            }

        } else {

            output.push(
                item,
            );
        }
    }

    return output;
}

/**
 * =============================================================================
 * Item type normalization
 * =============================================================================
 */

function normalizeBoolean(
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

    throw new ArrayNormalizationError(
        `Invalid TITech boolean array item "${String(
            value,
        )}".`,
        {
            code:
                'ARRAY_ITEM_BOOLEAN_INVALID',
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
        ) &&
        Number.isSafeInteger(
            value,
        )
    ) {

        return value;
    }

    const text =
        String(
            value,
        ).trim();

    if (
        !/^-?\d+$/.test(
            text,
        )
    ) {

        throw new ArrayNormalizationError(
            `Invalid TITech integer array item "${text}".`,
            {
                code:
                    'ARRAY_ITEM_INTEGER_INVALID',
            },
        );
    }

    const number =
        Number(
            text,
        );

    if (
        !Number.isSafeInteger(
            number,
        )
    ) {

        throw new ArrayNormalizationError(
            'TITech integer array item exceeds safe integer limits.',
            {
                code:
                    'ARRAY_ITEM_INTEGER_UNSAFE',
            },
        );
    }

    return number;
}

function normalizeNumber(
    value,
) {

    const number =
        Number(
            value,
        );

    if (
        !Number.isFinite(
            number,
        )
    ) {

        throw new ArrayNormalizationError(
            `Invalid TITech numeric array item "${String(
                value,
            )}".`,
            {
                code:
                    'ARRAY_ITEM_NUMBER_INVALID',
            },
        );
    }

    return number;
}

function normalizeUrl(
    value,
) {

    try {

        const url =
            new URL(
                String(
                    value,
                ).trim(),
            );

        return url.toString();

    } catch (
        error
    ) {

        throw new ArrayNormalizationError(
            `Invalid TITech URL array item "${String(
                value,
            )}".`,
            {
                code:
                    'ARRAY_ITEM_URL_INVALID',

                cause:
                    error,
            },
        );
    }
}

function normalizeEmail(
    value,
) {

    const text =
        String(
            value,
        ).trim();

    if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            text,
        )
    ) {

        throw new ArrayNormalizationError(
            `Invalid TITech email array item "${text}".`,
            {
                code:
                    'ARRAY_ITEM_EMAIL_INVALID',
            },
        );
    }

    return text;
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

        throw new ArrayNormalizationError(
            'Invalid JSON array item.',
            {
                code:
                    'ARRAY_ITEM_JSON_INVALID',

                cause:
                    error,
            },
        );
    }
}

function normalizeItem(
    value,
    index,
    options,
) {

    let normalized =
        value;

    if (
        typeof value ===
        'string'
    ) {

        normalized =
            normalizeString(
                value,
                options,
            );
    }

    switch (
        options.itemType
    ) {

        case ITEM_TYPES.INTEGER:

            normalized =
                normalizeInteger(
                    normalized,
                );

            break;

        case ITEM_TYPES.NUMBER:

            normalized =
                normalizeNumber(
                    normalized,
                );

            break;

        case ITEM_TYPES.BOOLEAN:

            normalized =
                normalizeBoolean(
                    normalized,
                );

            break;

        case ITEM_TYPES.URL:

            normalized =
                normalizeUrl(
                    normalized,
                );

            break;

        case ITEM_TYPES.EMAIL:

            normalized =
                normalizeEmail(
                    normalized,
                );

            break;

        case ITEM_TYPES.JSON:

            normalized =
                normalizeJson(
                    normalized,
                );

            break;

        case ITEM_TYPES.STRING:

        default:

            if (
                typeof normalized !==
                'string'
            ) {

                normalized =
                    normalizeString(
                        normalized,
                        options,
                    );
            }
    }

    if (
        isForbiddenItem(
            normalized,
            options,
        )
    ) {

        throw new ArrayNormalizationError(
            `Forbidden TITech array item "${String(
                normalized,
            )}".`,
            {
                code:
                    'ARRAY_ITEM_FORBIDDEN',

                index,

                value:
                    normalized,
            },
        );
    }

    return normalized;
}

/**
 * =============================================================================
 * Deduplication
 * =============================================================================
 */

function deduplicate(
    values,
    options,
) {

    if (
        !options.deduplicate
    ) {

        return values;
    }

    const seen =
        new Set();

    const result =
        [];

    for (
        const value of
        values
    ) {

        const key =
            typeof value ===
                'string' &&
            !options.caseSensitive
                ? value.toLowerCase()
                : stableStringify(
                    value,
                );

        if (
            seen.has(
                key,
            )
        ) {

            continue;
        }

        seen.add(
            key,
        );

        result.push(
            value,
        );
    }

    return result;
}

/**
 * =============================================================================
 * Main normalizer
 * =============================================================================
 */

class ArrayNormalizer {

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
        input,
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

            if (
                input ===
                    undefined ||
                input ===
                    null ||
                input ===
                    ''
            ) {

                if (
                    !config.allowEmptyInput
                ) {

                    throw new ArrayNormalizationError(
                        'Empty TITech environment array input is not allowed.',
                        {
                            code:
                                'ARRAY_INPUT_EMPTY',
                        },
                    );
                }

                const empty =
                    [];

                this.state =
                    'ready';

                this.normalizationCount +=
                    1;

                return config.freezeResult
                    ? deepFreeze(
                        empty,
                    )
                    : empty;
            }

            const source =
                this.parseInput(
                    input,
                    config,
                );

            const flattened =
                Array.isArray(
                    source,
                )
                    ? flattenArray(
                        source,
                        config,
                    )
                    : [
                        source,
                    ];

            if (
                flattened.length >
                config.maxItems
            ) {

                throw new ArrayNormalizationError(
                    'TITech environment array contains too many items.',
                    {
                        code:
                            'ARRAY_MAX_ITEMS_EXCEEDED',

                        details: {
                            count:
                                flattened.length,

                            maximum:
                                config.maxItems,
                        },
                    },
                );
            }

            const normalized =
                [];

            for (
                let index = 0;
                index < flattened.length;
                index += 1
            ) {

                const value =
                    flattened[index];

                if (
                    isEmpty(
                        value,
                    )
                ) {

                    if (
                        config.removeEmpty
                    ) {

                        continue;
                    }

                    if (
                        !config.allowEmptyArray
                    ) {

                        throw new ArrayNormalizationError(
                            `Empty TITech array item at index ${index}.`,
                            {
                                code:
                                    'ARRAY_EMPTY_ITEM_NOT_ALLOWED',

                                index,
                            },
                        );
                    }
                }

                const normalizedItem =
                    normalizeItem(
                        value,
                        index,
                        config,
                    );

                if (
                    isEmpty(
                        normalizedItem,
                    ) &&
                    config.removeEmpty
                ) {

                    continue;
                }

                normalized.push(
                    normalizedItem,
                );
            }

            const deduplicated =
                deduplicate(
                    normalized,
                    config,
                );

            if (
                deduplicated.length >
                config.maxItems
            ) {

                throw new ArrayNormalizationError(
                    'TITech normalized array exceeds configured maximum items.',
                    {
                        code:
                            'ARRAY_NORMALIZED_MAX_ITEMS_EXCEEDED',
                    },
                );
            }

            if (
                deduplicated.length ===
                    0 &&
                !config.allowEmptyArray
            ) {

                throw new ArrayNormalizationError(
                    'TITech normalized array cannot be empty.',
                    {
                        code:
                            'ARRAY_RESULT_EMPTY_NOT_ALLOWED',
                    },
                );
            }

            const result =
                deduplicated;

            this.normalizationCount +=
                1;

            this.state =
                'ready';

            this.lastError =
                null;

            const frozen =
                config.freezeResult
                    ? deepFreeze(
                        result,
                    )
                    : result;

            this.lastResult =
                {
                    value:
                        frozen,

                    count:
                        frozen.length,

                    inputType:
                        config.inputType,

                    itemType:
                        config.itemType,

                    fingerprint:
                        fingerprint(
                            frozen,
                            config,
                        ),
                };

            log(
                'debug',
                {
                    count:
                        frozen.length,

                    itemType:
                        config.itemType,
                },
                'TITech environment array normalization completed.',
            );

            return frozen;

        } catch (
            error
        ) {

            this.state =
                'failed';

            this.lastError =
                error;

            throw (
                error instanceof
                ArrayNormalizationError
                    ? error
                    : new ArrayNormalizationError(
                        'TITech environment array normalization failed.',
                        {
                            code:
                                'ARRAY_NORMALIZATION_FAILED',

                            cause:
                                error,
                        },
                    )
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Parse raw input.
     * -------------------------------------------------------------------------
     */

    parseInput(
        input,
        options,
    ) {

        if (
            Array.isArray(
                input,
            )
        ) {

            return clone(
                input,
            );
        }

        if (
            typeof input !==
            'string'
        ) {

            return [
                input,
            ];
        }

        const text =
            input.length >
            options.maxInputLength
                ? (() => {
                    throw new ArrayNormalizationError(
                        'TITech environment array input exceeds maximum length.',
                        {
                            code:
                                'ARRAY_INPUT_TOO_LONG',
                        },
                    );
                })()
                : input;

        const trimmed =
            text.trim();

        if (
            trimmed ===
                ''
        ) {

            return [];
        }

        switch (
            options.inputType
        ) {

            case ARRAY_INPUT_TYPES.JSON:

                return parseJsonArray(
                    trimmed,
                );

            case ARRAY_INPUT_TYPES.CSV:

                return parseCsv(
                    trimmed,
                    {
                        ...options,

                        delimiter:
                            options.delimiter ||
                            ',',
                    },
                );

            case ARRAY_INPUT_TYPES.DELIMITED:

                return parseDelimited(
                    trimmed,
                    options,
                );

            case ARRAY_INPUT_TYPES.ARRAY:

                return [
                    trimmed,
                ];

            case ARRAY_INPUT_TYPES.REPEATED:

                return this.parseRepeated(
                    trimmed,
                    options,
                );

            case ARRAY_INPUT_TYPES.AUTO:
            default:

                return this.parseAuto(
                    trimmed,
                    options,
                );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * AUTO detection.
     * -------------------------------------------------------------------------
     */

    parseAuto(
        text,
        options,
    ) {

        /**
         * JSON array.
         */
        if (
            options.parseJson &&
            text.startsWith('[') &&
            text.endsWith(']')
        ) {

            try {

                return parseJsonArray(
                    text,
                );

            } catch (
                error
            ) {

                if (
                    options.strict
                ) {

                    throw error;
                }
            }
        }

        /**
         * JSON scalar should remain a single value.
         */
        if (
            options.parseJson &&
            (
                text.startsWith('{') &&
                text.endsWith('}')
            )
        ) {

            if (
                options.itemType ===
                ITEM_TYPES.JSON
            ) {

                return [
                    normalizeJson(
                        text,
                    ),
                ];
            }
        }

        /**
         * Newline-delimited values.
         */
        if (
            /\r?\n/.test(
                text,
            )
        ) {

            const lines =
                text
                    .split(
                        /\r?\n/,
                    )
                    .map(
                        line =>
                            line.trim(),
                    )
                    .filter(
                        Boolean,
                    );

            if (
                lines.length >
                1
            ) {

                return lines;
            }
        }

        /**
         * Preferred delimiter.
         */
        if (
            text.includes(
                options.delimiter,
            )
        ) {

            if (
                options.parseQuotedCsv
            ) {

                return parseCsv(
                    text,
                    options,
                );
            }

            return parseDelimited(
                text,
                options,
            );
        }

        /**
         * Other configured delimiters.
         */
        const alternate =
            options.delimiters.find(
                delimiter =>
                    delimiter !==
                        options.delimiter &&
                    text.includes(
                        delimiter,
                    ),
            );

        if (
            alternate
        ) {

            return parseDelimited(
                text,
                {
                    ...options,

                    delimiters:
                        [
                            alternate,
                        ],
                },
            );
        }

        /**
         * Plain scalar.
         */
        return [
            text,
        ];
    }

    /**
     * -------------------------------------------------------------------------
     * Repeated-input syntax.
     * -------------------------------------------------------------------------
     *
     * Supports:
     *
     *   "a;b;c"
     *   "a|b|c"
     *
     * based on configured delimiters.
     * -------------------------------------------------------------------------
     */

    parseRepeated(
        text,
        options,
    ) {

        return parseDelimited(
            text,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Validate a normalized array without transforming it.
     * -------------------------------------------------------------------------
     */

    validate(
        values,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        if (
            !Array.isArray(
                values,
            )
        ) {

            throw new ArrayNormalizationError(
                'TITech array validation requires an array.',
                {
                    code:
                        'ARRAY_VALIDATION_ARRAY_REQUIRED',
                },
            );
        }

        if (
            values.length >
            config.maxItems
        ) {

            throw new ArrayNormalizationError(
                'TITech array exceeds the configured maximum number of items.',
                {
                    code:
                        'ARRAY_VALIDATION_MAX_ITEMS_EXCEEDED',
                },
            );
        }

        const normalized =
            values.map(
                (
                    value,
                    index,
                ) =>
                    normalizeItem(
                        value,
                        index,
                        config,
                    ),
            );

        return {
            valid:
                true,

            count:
                normalized.length,

            fingerprint:
                fingerprint(
                    normalized,
                    config,
                ),

            values:
                config.freezeResult
                    ? deepFreeze(
                        normalized,
                    )
                    : normalized,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Diagnostic description.
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

            itemType:
                config.itemType,

            delimiter:
                config.delimiter,

            delimiters:
                [
                    ...config.delimiters,
                ],

            trimItems:
                config.trimItems,

            removeEmpty:
                config.removeEmpty,

            deduplicate:
                config.deduplicate,

            maxItems:
                config.maxItems,

            maxItemLength:
                config.maxItemLength,

            maxInputLength:
                config.maxInputLength,

            allowEmptyArray:
                config.allowEmptyArray,

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            lastFingerprint:
                this.lastResult
                    ?.fingerprint ||
                null,

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

            options:
                {
                    inputType:
                        this.options
                            .inputType,

                    delimiter:
                        this.options
                            .delimiter,

                    itemType:
                        this.options
                            .itemType,

                    deduplicate:
                        this.options
                            .deduplicate,

                    removeEmpty:
                        this.options
                            .removeEmpty,

                    maxItems:
                        this.options
                            .maxItems,
                },

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

const arrayNormalizer =
    new ArrayNormalizer();

/**
 * =============================================================================
 * Convenience functions
 * =============================================================================
 */

function normalize(
    input,
    options,
) {

    return arrayNormalizer.normalize(
        input,
        options,
    );
}

function validate(
    values,
    options,
) {

    return arrayNormalizer.validate(
        values,
        options,
    );
}

function describe(
    options,
) {

    return arrayNormalizer.describe(
        options,
    );
}

function snapshot() {

    return arrayNormalizer.snapshot();
}

function readiness() {

    return arrayNormalizer.readiness();
}

function health() {

    return arrayNormalizer.health();
}

function reset() {

    return arrayNormalizer.reset();
}

/**
 * =============================================================================
 * Regex escaping
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
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton and class.
         */
        arrayNormalizer,

        ArrayNormalizer,

        ArrayNormalizationError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ARRAY_INPUT_TYPES,

        ITEM_TYPES,

        DEFAULTS,

        /**
         * Core.
         */
        normalize,

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

        parseCsv,

        parseDelimited,

        parseJsonArray,

        /**
         * Reset.
         */
        reset,
    });