'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validation/schemaValidator.js
 *
 * Purpose:
 *   Enterprise production-grade configuration schema validator.
 *
 * Responsibilities:
 *   - Validate normalized TITech environment configuration against declarative
 *     schemas.
 *   - Support string, boolean, number, integer, URL, enum, array, object,
 *     date, JSON and custom value types.
 *   - Support required/optional fields.
 *   - Support defaults.
 *   - Support minimum/maximum/range constraints.
 *   - Support string length and pattern constraints.
 *   - Support enum and allowed-value constraints.
 *   - Support nested object schemas.
 *   - Support array item schemas.
 *   - Support conditional schemas.
 *   - Support environment-specific schema rules.
 *   - Support custom validation functions.
 *   - Detect unknown properties when strict mode is enabled.
 *   - Produce deterministic validation results.
 *   - Integrate with validationErrors.js.
 *   - Redact sensitive values from diagnostics.
 *   - Provide safe configuration fingerprints.
 *   - Remain independent from infrastructure initialization.
 *
 * IMPORTANT:
 *
 *   This module validates CONFIGURATION SHAPE and SEMANTIC SCHEMA RULES.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - merge configuration layers.
 *     - determine precedence.
 *     - connect MongoDB.
 *     - connect Redis.
 *     - initialize queues.
 *     - initialize Mobile Money providers.
 *     - sign/verify JWTs.
 *     - start Express.
 *     - execute financial transactions.
 *
 * Related modules:
 *
 *   backend/config/environment/normalizeEnvironment.js
 *   backend/config/environment/requiredVariables.js
 *   backend/config/environment/validationErrors.js
 *   backend/config/environment/secretMasker.js
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Validation error integration
 * =============================================================================
 */

const validationErrors =
    require('../validationErrors');

const {
    EnvironmentValidationError,
    EnvironmentValidationAggregateError,
    ValidationErrorCollection,
    VALIDATION_CATEGORIES,
    VALIDATION_SEVERITIES,
    VALIDATION_ERROR_CODES,
} = validationErrors;

/**
 * =============================================================================
 * Optional secret masker
 * =============================================================================
 */

let secretMaskerModule = null;

try {
    // eslint-disable-next-line global-require
    secretMaskerModule =
        require('../secretMasker');
} catch {
    secretMaskerModule = null;
}

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
    'environment-validation-schema';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const SCHEMA_TYPES =
    Object.freeze({
        ANY:
            'any',

        STRING:
            'string',

        NON_EMPTY_STRING:
            'non-empty-string',

        BOOLEAN:
            'boolean',

        NUMBER:
            'number',

        INTEGER:
            'integer',

        SAFE_INTEGER:
            'safe-integer',

        URL:
            'url',

        ENUM:
            'enum',

        ARRAY:
            'array',

        OBJECT:
            'object',

        JSON:
            'json',

        DATE:
            'date',

        REGEX:
            'regex',

        CUSTOM:
            'custom',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        allowUnknown:
            false,

        removeUnknown:
            false,

        applyDefaults:
            true,

        coerce:
            false,

        trimStrings:
            true,

        convertEmptyStringToUndefined:
            false,

        abortEarly:
            false,

        maxDepth:
            20,

        maxProperties:
            1_000,

        maxArrayLength:
            10_000,

        maxStringLength:
            1_000_000,

        maxErrors:
            500,

        environment:
            process.env.NODE_ENV ||
            'development',

        fingerprintAlgorithm:
            'sha256',

        redactSensitive:
            true,

        includeValues:
            false,

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|jwt|access[_-]?token|refresh[_-]?token|cookie|credential|pin|otp|cvv|cvc|passkey|subscription[_-]?key|webhook[_-]?secret|mongo_uri|database_uri|connection_string)/i,
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class SchemaValidatorError
    extends EnvironmentValidationError {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
            {
                ...options,

                component:
                    options.component ||
                    COMPONENT,

                category:
                    options.category ||
                    VALIDATION_CATEGORIES
                        .SCHEMA,
            },
        );

        this.name =
            'SchemaValidatorError';
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

        const result = {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            result[key] =
                clone(
                    item,
                );
        }

        return result;
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

function normalizeEnvironment(
    value,
) {

    return String(
        value ||
        process.env.NODE_ENV ||
        'development',
    )
        .trim()
        .toLowerCase();
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
        // Schema validation must remain independent from logging.
    }
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

function isSensitivePath(
    path,
    options = DEFAULTS,
) {

    return (
        options.sensitivePattern ||
        DEFAULTS.sensitivePattern
    ).test(
        String(
            path ||
            '',
        ),
    );
}

function maskValue(
    path,
    value,
    options = DEFAULTS,
) {

    if (
        options.includeValues ||
        !options.redactSensitive
    ) {

        return clone(
            value,
        );
    }

    if (
        !isSensitivePath(
            path,
            options,
        )
    ) {

        return clone(
            value,
        );
    }

    try {

        if (
            secretMaskerModule?.maskKeyValue
        ) {

            return secretMaskerModule
                .maskKeyValue(
                    path,
                    value,
                );
        }

        if (
            secretMaskerModule?.mask
        ) {

            return secretMaskerModule.mask(
                value,
            );
        }

    } catch {
        // Fall through.
    }

    return '[REDACTED]';
}

function pathJoin(
    parent,
    property,
) {

    if (
        !parent
    ) {

        return String(
            property,
        );
    }

    if (
        /^\d+$/.test(
            String(
                property,
            ),
        )
    ) {

        return `${parent}[${property}]`;
    }

    return `${parent}.${property}`;
}

function hasOwn(
    object,
    key,
) {

    return Boolean(
        object &&
        Object.prototype
            .hasOwnProperty
            .call(
                object,
                key,
            ),
    );
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
        prototype ===
            null
    );
}

function isMissing(
    value,
) {

    return (
        value ===
            undefined ||
        value ===
            null
    );
}

function normalizeString(
    value,
    options,
) {

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    return options.trimStrings
        ? value.trim()
        : value;
}

/**
 * =============================================================================
 * Coercion helpers
 * =============================================================================
 */

function coerceBoolean(
    value,
) {

    if (
        typeof value ===
        'boolean'
    ) {

        return value;
    }

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    const normalized =
        value.trim()
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

    return value;
}

function coerceNumber(
    value,
) {

    if (
        typeof value ===
            'number' &&
        Number.isFinite(
            value,
        )
    ) {

        return value;
    }

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {

        return value;
    }

    const parsed =
        Number(
            normalized,
        );

    return Number.isFinite(
        parsed,
    )
        ? parsed
        : value;
}

function coerceInteger(
    value,
) {

    const parsed =
        coerceNumber(
            value,
        );

    if (
        typeof parsed ===
            'number' &&
        Number.isInteger(
            parsed,
        )
    ) {

        return parsed;
    }

    return value;
}

function coerceArray(
    value,
) {

    if (
        Array.isArray(
            value,
        )
    ) {

        return value;
    }

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {

        return [];
    }

    return normalized
        .split(
            ',',
        )
        .map(
            item =>
                item.trim(),
        );
}

function coerceJson(
    value,
) {

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    try {

        return JSON.parse(
            value,
        );

    } catch {

        return value;
    }
}

/**
 * =============================================================================
 * Rule normalization
 * =============================================================================
 */

function normalizeSchema(
    schema,
    options = DEFAULTS,
) {

    if (
        schema ===
            undefined ||
        schema ===
            null
    ) {

        return {
            type:
                SCHEMA_TYPES
                    .ANY,
        };
    }

    if (
        typeof schema ===
        'string'
    ) {

        return {
            type:
                schema
                    .trim()
                    .toLowerCase(),
        };
    }

    if (
        typeof schema ===
        'function'
    ) {

        return {
            type:
                SCHEMA_TYPES
                    .CUSTOM,

            validate:
                schema,
        };
    }

    if (
        typeof schema !==
        'object'
    ) {

        throw new SchemaValidatorError(
            'TITech schema definition must be an object, string or function.',
            {
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_TYPE,
            },
        );
    }

    const normalized =
        {
            ...schema,
        };

    normalized.type =
        String(
            schema.type ||
            SCHEMA_TYPES
                .ANY,
        )
            .trim()
            .toLowerCase();

    if (
        normalized.type ===
            SCHEMA_TYPES
                .ENUM &&
        !Array.isArray(
            normalized.values,
        ) &&
        Array.isArray(
            normalized.enum,
        )
    ) {

        normalized.values =
            [
                ...normalized.enum,
            ];
    }

    if (
        normalized.type ===
            SCHEMA_TYPES
                .ARRAY &&
        !normalized.items &&
        normalized.element
    ) {

        normalized.items =
            normalized.element;
    }

    if (
        normalized.type ===
            SCHEMA_TYPES
                .OBJECT &&
        !normalized.properties &&
        normalized.schema
    ) {

        normalized.properties =
            normalized.schema;
    }

    if (
        normalized.type ===
            SCHEMA_TYPES
                .OBJECT &&
        !normalized.properties
    ) {

        normalized.properties =
            {};
    }

    return normalized;
}

/**
 * =============================================================================
 * Error generation
 * =============================================================================
 */

function addSchemaIssue(
    collection,
    code,
    path,
    message,
    options = {},
) {

    collection.addIssue({
        code,

        category:
            options.category ||
            VALIDATION_CATEGORIES
                .SCHEMA,

        severity:
            options.severity ||
            VALIDATION_SEVERITIES
                .ERROR,

        variable:
            path,

        path,

        environment:
            options.environment,

        expected:
            options.expected,

        actual:
            options.actual,

        message,
    });
}

/**
 * =============================================================================
 * Type validation
 * =============================================================================
 */

function typeMatches(
    value,
    type,
) {

    switch (
        type
    ) {

        case SCHEMA_TYPES.ANY:
            return true;

        case SCHEMA_TYPES.STRING:
            return typeof value ===
                'string';

        case SCHEMA_TYPES
            .NON_EMPTY_STRING:
            return (
                typeof value ===
                    'string' &&
                value.trim()
                    .length >
                    0
            );

        case SCHEMA_TYPES.BOOLEAN:
            return typeof value ===
                'boolean';

        case SCHEMA_TYPES.NUMBER:
            return (
                typeof value ===
                    'number' &&
                Number.isFinite(
                    value,
                )
            );

        case SCHEMA_TYPES.INTEGER:
            return (
                typeof value ===
                    'number' &&
                Number.isInteger(
                    value,
            )
            );

        case SCHEMA_TYPES
            .SAFE_INTEGER:
            return Number.isSafeInteger(
                value,
            );

        case SCHEMA_TYPES.URL:
            return (
                typeof value ===
                    'string' &&
                isValidAbsoluteUrl(
                    value,
                )
            );

        case SCHEMA_TYPES.ENUM:
            return true;

        case SCHEMA_TYPES.ARRAY:
            return Array.isArray(
                value,
            );

        case SCHEMA_TYPES.OBJECT:
            return isPlainObject(
                value,
            );

        case SCHEMA_TYPES.JSON:
            return (
                isPlainObject(
                    value,
                ) ||
                Array.isArray(
                    value,
                )
            );

        case SCHEMA_TYPES.DATE:
            return (
                value instanceof
                    Date &&
                !Number.isNaN(
                    value.getTime(),
                )
            );

        case SCHEMA_TYPES.REGEX:
            return (
                typeof value ===
                'string'
            );

        case SCHEMA_TYPES.CUSTOM:
            return true;

        default:
            return false;
    }
}

function isValidAbsoluteUrl(
    value,
) {

    if (
        typeof value !==
        'string'
    ) {

        return false;
    }

    try {

        const parsed =
            new URL(
                value,
            );

        return Boolean(
            parsed.protocol &&
            parsed.hostname,
        );

    } catch {

        return false;
    }
}

/**
 * =============================================================================
 * Type coercion
 * =============================================================================
 */

function coerceByType(
    value,
    schema,
) {

    switch (
        schema.type
    ) {

        case SCHEMA_TYPES
            .BOOLEAN:
            return coerceBoolean(
                value,
            );

        case SCHEMA_TYPES
            .NUMBER:
            return coerceNumber(
                value,
            );

        case SCHEMA_TYPES
            .INTEGER:
        case SCHEMA_TYPES
            .SAFE_INTEGER:
            return coerceInteger(
                value,
            );

        case SCHEMA_TYPES
            .ARRAY:
            return coerceArray(
                value,
            );

        case SCHEMA_TYPES
            .JSON:
            return coerceJson(
                value,
            );

        case SCHEMA_TYPES
            .STRING:
        case SCHEMA_TYPES
            .NON_EMPTY_STRING:
        case SCHEMA_TYPES
            .URL:
        case SCHEMA_TYPES
            .ENUM:
        case SCHEMA_TYPES
            .REGEX:
            return (
                typeof value ===
                'string'
                    ? value
                    : String(
                        value,
                    )
            );

        default:
            return value;
    }
}

/**
 * =============================================================================
 * Constraints
 * =============================================================================
 */

function validateCommonConstraints(
    value,
    schema,
    path,
    collection,
    options,
) {

    /**
     * Required is handled before this function.
     */

    if (
        schema.default !==
            undefined &&
        isMissing(
            value,
        )
    ) {

        return schema.default;
    }

    if (
        typeof value ===
        'string'
    ) {

        const length =
            value.length;

        if (
            schema.minLength !==
                undefined &&
            length <
                schema.minLength
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must contain at least ${schema.minLength} characters.`,
                {
                    expected:
                        {
                            minLength:
                                schema.minLength,
                        },

                    actual:
                        length,
                },
            );
        }

        if (
            schema.maxLength !==
                undefined &&
            length >
                schema.maxLength
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must not exceed ${schema.maxLength} characters.`,
                {
                    expected:
                        {
                            maxLength:
                                schema.maxLength,
                        },

                    actual:
                        length,
                },
            );
        }

        if (
            schema.pattern
        ) {

            let pattern =
                schema.pattern;

            try {

                if (
                    typeof pattern ===
                    'string'
                ) {

                    pattern =
                        new RegExp(
                            pattern,
                        );
                }

                if (
                    pattern instanceof
                    RegExp &&
                    !pattern.test(
                        value,
                    )
                ) {

                    addSchemaIssue(
                        collection,
                        VALIDATION_ERROR_CODES
                            .INVALID_FORMAT,
                        path,
                        `${path} does not match the required pattern.`,
                        {
                            expected:
                                pattern
                                    .toString(),

                            actual:
                                maskValue(
                                    path,
                                    value,
                                    options,
                                ),
                        },
                    );
                }

            } catch {

                addSchemaIssue(
                    collection,
                    VALIDATION_ERROR_CODES
                        .INVALID_FORMAT,
                    path,
                    `${path} contains an invalid schema pattern.`,
                );
            }
        }
    }

    if (
        typeof value ===
            'number' &&
        Number.isFinite(
            value,
        )
    ) {

        if (
            schema.min !==
                undefined &&
            value <
                schema.min
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must be greater than or equal to ${schema.min}.`,
                {
                    expected:
                        {
                            min:
                                schema.min,
                        },

                    actual:
                        value,
                },
            );
        }

        if (
            schema.max !==
                undefined &&
            value >
                schema.max
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must be less than or equal to ${schema.max}.`,
                {
                    expected:
                        {
                            max:
                                schema.max,
                        },

                    actual:
                        value,
                },
            );
        }

        if (
            schema.exclusiveMin !==
                undefined &&
            value <=
                schema.exclusiveMin
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must be greater than ${schema.exclusiveMin}.`,
                {
                    expected:
                        {
                            exclusiveMin:
                                schema.exclusiveMin,
                        },

                    actual:
                        value,
                },
            );
        }

        if (
            schema.exclusiveMax !==
                undefined &&
            value >=
                schema.exclusiveMax
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must be less than ${schema.exclusiveMax}.`,
                {
                    expected:
                        {
                            exclusiveMax:
                                schema.exclusiveMax,
                        },

                    actual:
                        value,
                },
            );
        }
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        if (
            schema.minItems !==
                undefined &&
            value.length <
                schema.minItems
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must contain at least ${schema.minItems} item(s).`,
                {
                    expected:
                        {
                            minItems:
                                schema.minItems,
                        },

                    actual:
                        value.length,
                },
            );
        }

        if (
            schema.maxItems !==
                undefined &&
            value.length >
                schema.maxItems
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                path,
                `${path} must not contain more than ${schema.maxItems} item(s).`,
                {
                    expected:
                        {
                            maxItems:
                                schema.maxItems,
                        },

                    actual:
                        value.length,
                },
            );
        }

        if (
            schema.unique
        ) {

            const fingerprints =
                value.map(
                    item =>
                        stableStringify(
                            item,
                        ),
                );

            if (
                new Set(
                    fingerprints,
                ).size !==
                fingerprints.length
            ) {

                addSchemaIssue(
                    collection,
                    VALIDATION_ERROR_CODES
                        .INVALID_VALUE,
                    path,
                    `${path} must contain unique items.`,
                );
            }
        }
    }

    if (
        schema.enum &&
        Array.isArray(
            schema.enum,
        )
    ) {

        const allowed =
            schema.enum;

        const found =
            allowed.some(
                allowedValue =>
                    Object.is(
                        allowedValue,
                        value,
                    ),
            );

        if (
            !found
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,
                path,
                `${path} contains a value that is not permitted by the TITech schema.`,
                {
                    expected:
                        allowed,

                    actual:
                        maskValue(
                            path,
                            value,
                            options,
                        ),
                },
            );
        }
    }

    if (
        schema.values &&
        Array.isArray(
            schema.values,
        )
    ) {

        const found =
            schema.values.some(
                allowedValue =>
                    Object.is(
                        allowedValue,
                        value,
                    ),
            );

        if (
            !found
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,
                path,
                `${path} contains a value that is not allowed.`,
                {
                    expected:
                        schema.values,

                    actual:
                        maskValue(
                            path,
                            value,
                            options,
                        ),
                },
            );
        }
    }

    if (
        schema.not
    ) {

        const nestedCollection =
            new ValidationErrorCollection({
                maxErrors:
                    options.maxErrors,
            });

        validateNode(
            value,
            schema.not,
            path,
            nestedCollection,
            {
                ...options,

                failClosed:
                    false,
            },
        );

        if (
            nestedCollection.getBlockingErrors()
                .length ===
            0
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,
                path,
                `${path} matches a forbidden schema.`,
            );
        }
    }

    return value;
}

/**
 * =============================================================================
 * Custom validator
 * =============================================================================
 */

function executeCustomValidator(
    value,
    schema,
    path,
    collection,
    options,
) {

    if (
        typeof schema.validate !==
        'function'
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_TYPE,
            path,
            `${path} defines a custom schema without a validate function.`,
        );

        return;
    }

    try {

        const result =
            schema.validate(
                value,
                {
                    path,

                    environment:
                        options.environment,

                    schema,

                    options,
                },
            );

        if (
            result ===
            true
        ) {

            return;
        }

        if (
            result ===
            false
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,
                path,
                schema.message ||
                    `${path} failed custom TITech validation.`,
            );

            return;
        }

        if (
            typeof result ===
            'string'
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,
                path,
                result,
            );

            return;
        }

        if (
            result &&
            typeof result ===
            'object'
        ) {

            if (
                result.valid ===
                false
            ) {

                addSchemaIssue(
                    collection,
                    result.code ||
                        VALIDATION_ERROR_CODES
                            .INVALID_VALUE,
                    path,
                    result.message ||
                        `${path} failed custom TITech validation.`,
                    {
                        expected:
                            result.expected,

                        actual:
                            maskValue(
                                path,
                                result.actual ??
                                    value,
                                options,
                            ),

                        category:
                            result.category,

                        severity:
                            result.severity,
                    },
                );
            }
        }

    } catch (
        error
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .VALIDATOR_EXECUTION_FAILED,
            path,
            `${path} custom schema validation failed: ${error.message}`,
        );
    }
}

/**
 * =============================================================================
 * Conditional schema support
 * =============================================================================
 */

function evaluateSchemaCondition(
    condition,
    source,
) {

    if (
        typeof condition ===
        'function'
    ) {

        try {
            return Boolean(
                condition(
                    source,
                ),
            );
        } catch {
            return false;
        }
    }

    if (
        !condition ||
        typeof condition !==
        'object'
    ) {

        return true;
    }

    if (
        Array.isArray(
            condition.all,
        )
    ) {

        return condition.all.every(
            item =>
                evaluateSchemaCondition(
                    item,
                    source,
                ),
        );
    }

    if (
        Array.isArray(
            condition.any,
        )
    ) {

        return condition.any.some(
            item =>
                evaluateSchemaCondition(
                    item,
                    source,
                ),
        );
    }

    if (
        condition.not
    ) {

        return !evaluateSchemaCondition(
            condition.not,
            source,
        );
    }

    const path =
        condition.path ||
        condition.variable;

    if (
        !path
    ) {

        return true;
    }

    const actual =
        getPathValue(
            source,
            path,
        );

    if (
        condition.exists !==
        undefined
    ) {

        return (
            !isMissing(
                actual,
            ) ===
            Boolean(
                condition.exists,
            )
        );
    }

    if (
        condition.equals !==
        undefined
    ) {

        return Object.is(
            actual,
            condition.equals,
        );
    }

    if (
        condition.notEquals !==
        undefined
    ) {

        return !Object.is(
            actual,
            condition.notEquals,
        );
    }

    if (
        Array.isArray(
            condition.oneOf,
        )
    ) {

        return condition.oneOf.some(
            expected =>
                Object.is(
                    expected,
                    actual,
                ),
        );
    }

    return true;
}

/**
 * =============================================================================
 * Nested path helpers
 * =============================================================================
 */

function getPathValue(
    source,
    path,
) {

    if (
        !path
    ) {

        return source;
    }

    if (
        hasOwn(
            source,
            path,
        )
    ) {

        return source[path];
    }

    const parts =
        String(
            path,
        )
            .split(
                '.',
            )
            .filter(
                Boolean,
            );

    let current =
        source;

    for (
        const part of
        parts
    ) {

        if (
            current ===
                null ||
            current ===
                undefined
        ) {

            return undefined;
        }

        if (
            Array.isArray(
                current,
            )
        ) {

            const index =
                Number(
                    part,
                );

            if (
                !Number.isInteger(
                    index,
                )
            ) {

                return undefined;
            }

            current =
                current[
                    index
                ];

        } else {

            if (
                !hasOwn(
                    current,
                    part,
                )
            ) {

                return undefined;
            }

            current =
                current[
                    part
                ];
        }
    }

    return current;
}

function setPathValue(
    target,
    path,
    value,
) {

    const parts =
        String(
            path,
        )
            .split(
                '.',
            )
            .filter(
                Boolean,
            );

    if (
        parts.length ===
        0
    ) {

        return target;
    }

    let current =
        target;

    for (
        let index = 0;
        index <
            parts.length - 1;
        index += 1
    ) {

        const part =
            parts[index];

        if (
            !hasOwn(
                current,
                part,
            ) ||
            current[part] ===
                null ||
            typeof current[part] !==
                'object'
        ) {

            current[part] =
                {};
        }

        current =
            current[
                part
            ];
    }

    current[
        parts[
            parts.length - 1
        ]
    ] =
        value;

    return target;
}

/**
 * =============================================================================
 * Object unknown-key validation
 * =============================================================================
 */

function validateObjectProperties(
    value,
    schema,
    path,
    collection,
    options,
    depth,
) {

    if (
        !isPlainObject(
            value,
        )
    ) {

        return;
    }

    const properties =
        schema.properties ||
        {};

    const required =
        Array.isArray(
            schema.required,
        )
            ? schema.required
            : [];

    if (
        Object.keys(
            value,
        ).length >
        options.maxProperties
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            path,
            `${path || 'configuration'} contains too many properties.`,
            {
                expected:
                    {
                        maxProperties:
                            options.maxProperties,
                    },

                actual:
                    Object.keys(
                        value,
                    ).length,
            },
        );
    }

    /**
     * Required object properties.
     */
    for (
        const key of
        required
    ) {

        const propertyPath =
            pathJoin(
                path,
                key,
            );

        if (
            !hasOwn(
                value,
                key,
            ) ||
            isMissing(
                value[key],
            )
        ) {

            addSchemaIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,
                propertyPath,
                `${propertyPath} is required by the TITech schema.`,
            );
        }
    }

    /**
     * Known properties.
     */
    for (
        const [
            key,
            childSchema,
        ] of Object.entries(
            properties,
        )
    ) {

        if (
            hasOwn(
                value,
                key,
            )
        ) {

            validateNode(
                value[key],
                childSchema,
                pathJoin(
                    path,
                    key,
                ),
                collection,
                options,
                depth + 1,
            );
        }
    }

    /**
     * Unknown properties.
     */
    if (
        options.allowUnknown ||
        schema.allowUnknown
    ) {

        return;
    }

    const knownKeys =
        new Set(
            Object.keys(
                properties,
            ),
        );

    for (
        const key of
        Object.keys(
            value,
        )
    ) {

        if (
            knownKeys.has(
                key,
            )
        ) {

            continue;
        }

        const propertyPath =
            pathJoin(
                path,
                key,
            );

        if (
            schema.stripUnknown ||
            options.removeUnknown
        ) {

            delete value[key];

            continue;
        }

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .UNKNOWN_PROPERTY,
            propertyPath,
            `${propertyPath} is not defined by the TITech schema.`,
        );
    }

    /**
     * Pattern properties.
     */
    if (
        schema.patternProperties &&
        typeof schema.patternProperties ===
            'object'
    ) {

        for (
            const [
                pattern,
                childSchema,
            ] of Object.entries(
                schema.patternProperties,
            )
        ) {

            let regex;

            try {

                regex =
                    new RegExp(
                        pattern,
                    );

            } catch {

                addSchemaIssue(
                    collection,
                    VALIDATION_ERROR_CODES
                        .INVALID_FORMAT,
                    path,
                    `${path || 'configuration'} contains an invalid patternProperties expression.`,
                );

                continue;
            }

            for (
                const key of
                Object.keys(
                    value,
                )
            ) {

                if (
                    regex.test(
                        key,
                    )
                ) {

                    validateNode(
                        value[key],
                        childSchema,
                        pathJoin(
                            path,
                            key,
                        ),
                        collection,
                        options,
                        depth + 1,
                    );
                }
            }
        }
    }

    /**
     * Additional property schema.
     */
    if (
        schema.additionalProperties &&
        typeof schema.additionalProperties ===
            'object'
    ) {

        for (
            const key of
            Object.keys(
                value,
            )
        ) {

            if (
                knownKeys.has(
                    key,
                )
            ) {

                continue;
            }

            validateNode(
                value[key],
                schema.additionalProperties,
                pathJoin(
                    path,
                    key,
                ),
                collection,
                options,
                depth + 1,
            );
        }
    }
}

/**
 * =============================================================================
 * Array validation
 * =============================================================================
 */

function validateArrayItems(
    value,
    schema,
    path,
    collection,
    options,
    depth,
) {

    if (
        !Array.isArray(
            value,
        )
    ) {

        return;
    }

    if (
        value.length >
        options.maxArrayLength
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            path,
            `${path} contains too many items.`,
            {
                expected:
                    {
                        maxItems:
                            options.maxArrayLength,
                    },

                actual:
                    value.length,
            },
        );

        return;
    }

    if (
        schema.items
    ) {

        for (
            let index = 0;
            index <
                value.length;
            index += 1
        ) {

            validateNode(
                value[index],
                schema.items,
                pathJoin(
                    path,
                    index,
                ),
                collection,
                options,
                depth + 1,
            );

            if (
                options.abortEarly &&
                collection.hasErrors()
            ) {

                return;
            }
        }
    }

    if (
        Array.isArray(
            schema.prefixItems,
        )
    ) {

        for (
            let index = 0;
            index <
                schema.prefixItems.length;
            index += 1
        ) {

            if (
                index >=
                value.length
            ) {

                break;
            }

            validateNode(
                value[index],
                schema.prefixItems[index],
                pathJoin(
                    path,
                    index,
                ),
                collection,
                options,
                depth + 1,
            );
        }
    }
}

/**
 * =============================================================================
 * Main recursive node validator
 * =============================================================================
 */

function validateNode(
    rawValue,
    rawSchema,
    path,
    collection,
    options,
    depth = 0,
) {

    if (
        depth >
        options.maxDepth
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            path,
            `${path || 'configuration'} exceeds the maximum schema depth.`,
            {
                expected:
                    {
                        maxDepth:
                            options.maxDepth,
                    },

                actual:
                    depth,
            },
        );

        return rawValue;
    }

    let schema;

    try {

        schema =
            normalizeSchema(
                rawSchema,
                options,
            );

    } catch (
        error
    ) {

        addSchemaIssue(
            collection,
            error.code ||
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,
            path,
            error.message,
        );

        return rawValue;
    }

    /**
     * Conditional branches.
     */
    if (
        schema.when
    ) {

        const condition =
            evaluateSchemaCondition(
                schema.when,
                options.rootValue,
            );

        if (
            condition
        ) {

            if (
                schema.then
            ) {

                validateNode(
                    rawValue,
                    schema.then,
                    path,
                    collection,
                    options,
                    depth + 1,
                );
            }

        } else if (
            schema.else
        ) {

            validateNode(
                rawValue,
                schema.else,
                path,
                collection,
                options,
                depth + 1,
            );
        }

        /**
         * Apply common constraints to the active value as well.
         */
    }

    let value =
        rawValue;

    /**
     * Default.
     */
    if (
        isMissing(
            value,
        ) &&
        schema.default !==
            undefined &&
        options.applyDefaults
    ) {

        value =
            clone(
                schema.default,
            );
    }

    /**
     * Required.
     */
    if (
        schema.required &&
        isMissing(
            value,
        )
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            path,
            schema.message ||
                `${path || 'configuration'} is required.`,
        );

        return value;
    }

    /**
     * Nullable.
     */
    if (
        isMissing(
            value,
        )
    ) {

        if (
            schema.nullable
        ) {

            return value;
        }

        /**
         * Optional missing value is acceptable.
         */
        if (
            !schema.required
        ) {

            return value;
        }
    }

    /**
     * Empty string policy.
     */
    if (
        typeof value ===
            'string' &&
        value ===
            '' &&
        schema.required &&
        !schema.allowEmpty
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_VALUE,
            path,
            schema.message ||
                `${path || 'configuration'} must not be empty.`,
        );

        return value;
    }

    /**
     * Coercion.
     */
    if (
        options.coerce ||
        schema.coerce
    ) {

        value =
            coerceByType(
                value,
                schema,
            );
    }

    /**
     * String normalization.
     */
    if (
        typeof value ===
        'string'
    ) {

        value =
            normalizeString(
                value,
                {
                    ...options,

                    trimStrings:
                        schema.trim ??
                        options.trimStrings,
                },
            );

        if (
            options.convertEmptyStringToUndefined &&
            value ===
                ''
        ) {

            return undefined;
        }
    }

    /**
     * Type validation.
     */
    if (
        !typeMatches(
            value,
            schema.type,
        )
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_TYPE,
            path,
            schema.message ||
                `${path || 'configuration'} must be of type "${schema.type}".`,
            {
                expected:
                    schema.type,

                actual:
                    maskValue(
                        path,
                        value,
                        options,
                    ),
            },
        );

        return value;
    }

    /**
     * Type-specific validation.
     */

    switch (
        schema.type
    ) {

        case SCHEMA_TYPES
            .OBJECT:

            validateObjectProperties(
                value,
                schema,
                path,
                collection,
                options,
                depth,
            );

            break;

        case SCHEMA_TYPES
            .ARRAY:

            validateArrayItems(
                value,
                schema,
                path,
                collection,
                options,
                depth,
            );

            break;

        case SCHEMA_TYPES
            .URL:

            if (
                !isValidAbsoluteUrl(
                    value,
                )
            ) {

                addSchemaIssue(
                    collection,
                    VALIDATION_ERROR_CODES
                        .INVALID_URL,
                    path,
                    `${path} must contain a valid absolute URL.`,
                    {
                        actual:
                            maskValue(
                                path,
                                value,
                                options,
                            ),
                    },
                );
            }

            break;

        case SCHEMA_TYPES
            .DATE:

            if (
                !(value instanceof Date) ||
                Number.isNaN(
                    value.getTime(),
                )
            ) {

                addSchemaIssue(
                    collection,
                    VALIDATION_ERROR_CODES
                        .INVALID_FORMAT,
                    path,
                    `${path} must contain a valid date.`,
                );
            }

            break;

        case SCHEMA_TYPES
            .REGEX:

            if (
                schema.pattern
            ) {

                let pattern;

                try {

                    pattern =
                        schema.pattern instanceof
                            RegExp
                            ? schema.pattern
                            : new RegExp(
                                schema.pattern,
                            );

                    if (
                        !pattern.test(
                            value,
                        )
                    ) {

                        addSchemaIssue(
                            collection,
                            VALIDATION_ERROR_CODES
                                .INVALID_FORMAT,
                            path,
                            `${path} does not match the configured regular expression.`,
                        );
                    }

                } catch {

                    addSchemaIssue(
                        collection,
                        VALIDATION_ERROR_CODES
                            .INVALID_FORMAT,
                        path,
                        `${path} contains an invalid regular expression schema.`,
                    );
                }
            }

            break;

        case SCHEMA_TYPES
            .JSON:

            if (
                typeof value ===
                    'string'
            ) {

                try {
                    JSON.parse(
                        value,
                    );
                } catch {
                    addSchemaIssue(
                        collection,
                        VALIDATION_ERROR_CODES
                            .INVALID_FORMAT,
                        path,
                        `${path} must contain valid JSON.`,
                    );
                }
            }

            break;

        case SCHEMA_TYPES
            .CUSTOM:

            executeCustomValidator(
                value,
                schema,
                path,
                collection,
                options,
            );

            break;

        default:
            break;
    }

    /**
     * Common constraints.
     */
    validateCommonConstraints(
        value,
        schema,
        path,
        collection,
        options,
    );

    /**
     * Optional custom validator under any schema type.
     */
    if (
        typeof schema.validate ===
        'function' &&
        schema.type !==
            SCHEMA_TYPES
                .CUSTOM
    ) {

        executeCustomValidator(
            value,
            schema,
            path,
            collection,
            options,
        );
    }

    /**
     * Optional constant.
     */
    if (
        schema.const !==
        undefined &&
        !Object.is(
            value,
            schema.const,
        )
    ) {

        addSchemaIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_VALUE,
            path,
            `${path} must equal the configured constant value.`,
            {
                expected:
                    schema.const,

                actual:
                    maskValue(
                        path,
                        value,
                        options,
                    ),
            },
        );
    }

    return value;
}

/**
 * =============================================================================
 * SchemaValidator class
 * =============================================================================
 */

class SchemaValidator {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.state =
            'created';

        this.validationCount =
            0;

        this.lastResult =
            null;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate configuration.
     * -------------------------------------------------------------------------
     */

    validate(
        value = {},
        schema = {},
        options = {},
    ) {

        const mergedOptions =
            {
                ...this.options,
                ...options,

                environment:
                    normalizeEnvironment(
                        options.environment ||
                        value?.NODE_ENV,
                    ),
            };

        if (
            !value ||
            typeof value !==
                'object'
        ) {

            throw new SchemaValidatorError(
                'TITech schema validation requires an object or structured value.',
                {
                    code:
                        VALIDATION_ERROR_CODES
                            .INVALID_TYPE,
                },
            );
        }

        this.state =
            'validating';

        const workingValue =
            clone(
                value,
            );

        const collection =
            new ValidationErrorCollection({
                maxErrors:
                    mergedOptions.maxErrors,
            });

        const rootOptions =
            {
                ...mergedOptions,

                rootValue:
                    workingValue,
            };

        try {

            validateNode(
                workingValue,
                schema,
                '',
                collection,
                rootOptions,
                0,
            );

            const summary =
                collection.summary();

            const blockingErrors =
                collection.getBlockingErrors();

            const status =
                blockingErrors.length >
                0
                    ? 'invalid'
                    : summary.warnings >
                        0
                        ? 'degraded'
                        : 'valid';

            const result = {
                valid:
                    blockingErrors.length ===
                    0,

                ready:
                    blockingErrors.length ===
                    0,

                status,

                value:
                    sanitizeOutputValue(
                        workingValue,
                        mergedOptions,
                    ),

                summary,

                errors:
                    collection.toJSON({
                        environment:
                            mergedOptions
                                .environment,

                        includeRawValues:
                            mergedOptions
                                .includeValues,
                    }),

                fingerprint:
                    fingerprint(
                        sanitizeOutputValue(
                            workingValue,
                            {
                                ...mergedOptions,

                                includeValues:
                                    false,
                            },
                        ),
                        mergedOptions,
                    ),

                environment:
                    mergedOptions.environment,

                timestamp:
                    new Date().toISOString(),
            };

            this.validationCount +=
                1;

            this.lastResult =
                result;

            this.lastError =
                null;

            this.state =
                result.valid
                    ? 'ready'
                    : 'failed';

            log(
                result.valid
                    ? result.status ===
                      'degraded'
                        ? 'warn'
                        : 'debug'
                    : 'error',
                {
                    environment:
                        result.environment,

                    status:
                        result.status,

                    totalErrors:
                        result.summary
                            .total,
                },
                result.valid
                    ? 'TITech configuration schema validation completed.'
                    : 'TITech configuration schema validation failed.',
            );

            if (
                mergedOptions.failClosed &&
                blockingErrors.length >
                0
            ) {

                throw new EnvironmentValidationAggregateError(
                    blockingErrors,
                    {
                        message:
                            'TITech configuration schema validation failed.',

                        environment:
                            mergedOptions
                                .environment,

                        component:
                            COMPONENT,

                        code:
                            'TITECH_CONFIGURATION_SCHEMA_INVALID',
                    },
                );
            }

            return deepFreeze(
                result,
            );

        } catch (
            error
        ) {

            this.state =
                'failed';

            this.lastError =
                error;

            throw error;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Validate process environment.
     * -------------------------------------------------------------------------
     */

    validateEnvironment(
        schema,
        options = {},
    ) {

        return this.validate(
            process.env,
            schema,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Non-throwing check.
     * -------------------------------------------------------------------------
     */

    check(
        value,
        schema,
        options = {},
    ) {

        try {

            return this.validate(
                value,
                schema,
                {
                    ...options,

                    failClosed:
                        false,
                },
            );

        } catch (
            error
        ) {

            if (
                error instanceof
                EnvironmentValidationAggregateError
            ) {

                return {
                    valid:
                        false,

                    ready:
                        false,

                    status:
                        'invalid',

                    error:
                        error.toJSON(),
                };
            }

            return {
                valid:
                    false,

                ready:
                    false,

                status:
                    'invalid',

                error:
                    {
                        name:
                            error.name,

                        code:
                            error.code,

                        message:
                            error.message,
                    },
            };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Production convenience.
     * -------------------------------------------------------------------------
     */

    validateProduction(
        value,
        schema,
        options = {},
    ) {

        return this.validate(
            value,
            schema,
            {
                ...options,

                environment:
                    'production',

                failClosed:
                    options.failClosed ??
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Staging convenience.
     * -------------------------------------------------------------------------
     */

    validateStaging(
        value,
        schema,
        options = {},
    ) {

        return this.validate(
            value,
            schema,
            {
                ...options,

                environment:
                    'staging',

                failClosed:
                    options.failClosed ??
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Schema fingerprint.
     * -------------------------------------------------------------------------
     */

    schemaFingerprint(
        schema,
        options = {},
    ) {

        return fingerprint(
            schema,
            {
                ...this.options,
                ...options,
            },
        );
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

            validationCount:
                this.validationCount,

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

            validationCount:
                this.validationCount,

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

            validationCount:
                this.validationCount,

            lastValidationStatus:
                this.lastResult
                    ?.status ||
                null,

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

        this.validationCount =
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
 * Output sanitizer
 * =============================================================================
 */

function sanitizeOutputValue(
    value,
    options,
    path = '',
    depth = 0,
) {

    if (
        depth >
        options.maxDepth
    ) {

        return '[MAX_DEPTH_EXCEEDED]';
    }

    if (
        value === null ||
        value === undefined
    ) {

        return value;
    }

    if (
        typeof value !==
        'object'
    ) {

        return maskValue(
            path,
            value,
            options,
        );
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
                sanitizeOutputValue(
                    item,
                    options,
                    pathJoin(
                        path,
                        index,
                    ),
                    depth + 1,
                ),
        );
    }

    const result =
        {};

    for (
        const [
            key,
            item,
        ] of Object.entries(
            value,
        )
    ) {

        const childPath =
            pathJoin(
                path,
                key,
            );

        result[key] =
            sanitizeOutputValue(
                item,
                options,
                childPath,
                depth + 1,
            );
    }

    return result;
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const schemaValidator =
    new SchemaValidator();

/**
 * =============================================================================
 * Convenience functions
 * =============================================================================
 */

function validate(
    value,
    schema,
    options,
) {

    return schemaValidator.validate(
        value,
        schema,
        options,
    );
}

function validateEnvironment(
    schema,
    options,
) {

    return schemaValidator
        .validateEnvironment(
            schema,
            options,
        );
}

function validateProduction(
    value,
    schema,
    options,
) {

    return schemaValidator
        .validateProduction(
            value,
            schema,
            options,
        );
}

function validateStaging(
    value,
    schema,
    options,
) {

    return schemaValidator
        .validateStaging(
            value,
            schema,
            options,
        );
}

function check(
    value,
    schema,
    options,
) {

    return schemaValidator.check(
        value,
        schema,
        options,
    );
}

function schemaFingerprint(
    schema,
    options,
) {

    return schemaValidator.schemaFingerprint(
        schema,
        options,
    );
}

function snapshot() {

    return schemaValidator.snapshot();
}

function readiness() {

    return schemaValidator.readiness();
}

function health() {

    return schemaValidator.health();
}

function reset() {

    return schemaValidator.reset();
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
        schemaValidator,

        SchemaValidator,

        SchemaValidatorError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        SCHEMA_TYPES,

        DEFAULTS,

        /**
         * Validation.
         */
        validate,

        validateEnvironment,

        validateProduction,

        validateStaging,

        check,

        /**
         * Schema helpers.
         */
        normalizeSchema,

        typeMatches,

        isValidAbsoluteUrl,

        getPathValue,

        setPathValue,

        /**
         * Fingerprinting.
         */
        fingerprint,

        schemaFingerprint,

        /**
         * Diagnostics/lifecycle.
         */
        snapshot,

        readiness,

        health,

        reset,
    });