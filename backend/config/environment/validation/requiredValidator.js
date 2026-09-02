'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validation/requiredValidator.js
 *
 * Purpose:
 *   Enterprise production-grade required environment-variable validator.
 *
 * Responsibilities:
 *   - Validate required TITech environment/configuration variables.
 *   - Support global, environment-specific and conditional requirements.
 *   - Support grouped "at least one", "exactly one" and "all of" requirements.
 *   - Support aliases and canonical-variable resolution.
 *   - Support feature-dependent requirements.
 *   - Support provider/dependency-dependent requirements.
 *   - Support production/staging/development policies.
 *   - Detect conflicting aliases.
 *   - Detect empty and whitespace-only values.
 *   - Produce safe diagnostics without exposing secrets.
 *   - Integrate with validationErrors.js.
 *   - Preserve deterministic validation ordering.
 *   - Remain independent from dotenv loading and runtime infrastructure.
 *
 * IMPORTANT:
 *
 *   This module validates PRESENCE and REQUIREMENT POLICY.
 *
 *   It does NOT:
 *     - parse complex values.
 *     - normalize booleans/numbers/URLs.
 *     - merge configuration layers.
 *     - determine configuration precedence.
 *     - load dotenv files.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - initialize Mobile Money providers.
 *     - sign or verify JWTs.
 *     - start Express.
 *     - execute financial transactions.
 *
 * Value semantics belong to:
 *
 *   backend/config/environment/normalizers/*
 *
 * Specialized validation belongs to:
 *
 *   backend/config/environment/validation/*
 *
 * =============================================================================
 *
 * Validation boundary:
 *
 *   merged environment
 *       ↓
 *   requiredValidator.js
 *       ↓
 *   normalizers/*
 *       ↓
 *   specialized validators
 *       ↓
 *   environmentValidator.js
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
    'environment-validation-required';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const REQUIREMENT_TYPES =
    Object.freeze({
        REQUIRED:
            'required',

        OPTIONAL:
            'optional',

        ANY_OF:
            'any-of',

        ALL_OF:
            'all-of',

        EXACTLY_ONE:
            'exactly-one',

        NONE_OF:
            'none-of',

        CONDITIONAL:
            'conditional',

        ALIAS:
            'alias',
    });

const REQUIREMENT_SEVERITIES =
    Object.freeze({
        DEVELOPMENT:
            VALIDATION_SEVERITIES.WARNING,

        TEST:
            VALIDATION_SEVERITIES.WARNING,

        STAGING:
            VALIDATION_SEVERITIES.ERROR,

        PRODUCTION:
            VALIDATION_SEVERITIES.CRITICAL,
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        environment:
            process.env.NODE_ENV ||
            'development',

        maxRequirements:
            1_000,

        maxVariableLength:
            512,

        maxGroupSize:
            100,

        maxAliases:
            50,

        allowEmptyString:
            false,

        allowWhitespaceOnly:
            false,

        treatNullAsMissing:
            true,

        treatUndefinedAsMissing:
            true,

        trimBeforePresenceCheck:
            true,

        detectAliasConflicts:
            true,

        detectDuplicateRequirements:
            true,

        stopAfterFirstError:
            false,

        includeValues:
            false,

        redactSensitive:
            true,

        requireProductionSecrets:
            true,

        fingerprintAlgorithm:
            'sha256',

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt|access[_-]?token|refresh[_-]?token|cookie|credential|pin|otp|cvv|cvc|passkey|subscription[_-]?key|webhook[_-]?secret)/i,
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class RequiredValidatorError
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
                        .REQUIRED,
            },
        );

        this.name =
            'RequiredValidatorError';
    }
}

/**
 * =============================================================================
 * Utility functions
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

function normalizeVariableName(
    value,
    options = DEFAULTS,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }

    const name =
        String(
            value,
        )
            .trim();

    if (
        !name
    ) {

        return null;
    }

    if (
        name.length >
        options.maxVariableLength
    ) {

        throw new RequiredValidatorError(
            'TITech environment variable name exceeds the configured maximum length.',
            {
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_RANGE,

                variable:
                    name,
            },
        );
    }

    /**
     * Environment variable naming policy.
     *
     * We deliberately permit nested configuration naming conventions such as
     *:
     *
     *   DATABASE_MONGO_URI
     *   PAYMENT__MOBILE_MONEY__PROVIDER
     *
     * while rejecting control characters.
     */
    if (
        /[\u0000-\u001F\u007F]/.test(
            name,
        )
    ) {

        throw new RequiredValidatorError(
            'TITech environment variable name contains control characters.',
            {
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_FORMAT,

                variable:
                    name,
            },
        );
    }

    return name;
}

function normalizeVariableList(
    value,
    options = DEFAULTS,
) {

    if (
        !Array.isArray(
            value,
        )
    ) {

        return normalizeVariableName(
            value,
            options,
        )
            ? [
                normalizeVariableName(
                    value,
                    options,
                ),
            ]
            : [];
    }

    const result =
        [];

    const seen =
        new Set();

    for (
        const item of
        value
    ) {

        const variable =
            normalizeVariableName(
                item,
                options,
            );

        if (
            !variable
        ) {

            continue;
        }

        if (
            seen.has(
                variable,
            )
        ) {

            continue;
        }

        seen.add(
            variable,
        );

        result.push(
            variable,
        );

        if (
            result.length >=
            options.maxAliases
        ) {

            break;
        }
    }

    return result;
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

function isMissingValue(
    value,
    options = DEFAULTS,
) {

    if (
        value ===
            undefined &&
        options.treatUndefinedAsMissing
    ) {

        return true;
    }

    if (
        value ===
            null &&
        options.treatNullAsMissing
    ) {

        return true;
    }

    if (
        typeof value ===
            'string'
    ) {

        const normalized =
            options.trimBeforePresenceCheck
                ? value.trim()
                : value;

        if (
            normalized ===
            ''
        ) {

            return !options.allowEmptyString;
        }

        if (
            !options.allowWhitespaceOnly &&
            value.trim() ===
                ''
        ) {

            return true;
        }
    }

    return false;
}

function isPresentValue(
    value,
    options = DEFAULTS,
) {

    return !isMissingValue(
        value,
        options,
    );
}

function normalizePresenceValue(
    value,
    options = DEFAULTS,
) {

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    return options
        .trimBeforePresenceCheck
        ? value.trim()
        : value;
}

function isSensitiveVariable(
    variable,
    options = DEFAULTS,
) {

    if (
        !variable
    ) {

        return false;
    }

    return (
        options.sensitivePattern ||
        DEFAULTS.sensitivePattern
    ).test(
        variable,
    );
}

function maskValue(
    variable,
    value,
    options = DEFAULTS,
) {

    if (
        !options.redactSensitive ||
        options.includeValues
    ) {

        return value;
    }

    if (
        !isSensitiveVariable(
            variable,
            options,
        )
    ) {

        return value;
    }

    try {

        if (
            secretMaskerModule?.maskKeyValue
        ) {

            return secretMaskerModule
                .maskKeyValue(
                    variable,
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
        // Hard fallback below.
    }

    return '[REDACTED]';
}

function getRequirementSeverity(
    environment,
    requestedSeverity,
) {

    if (
        requestedSeverity &&
        Object.values(
            VALIDATION_SEVERITIES,
        ).includes(
            requestedSeverity,
        )
    ) {

        return requestedSeverity;
    }

    return (
        REQUIREMENT_SEVERITIES[
            String(
                environment ||
                'development',
            )
                .toUpperCase()
        ] ||
        VALIDATION_SEVERITIES
            .ERROR
    );
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
        // Required validation must remain operational without logging.
    }
}

/**
 * =============================================================================
 * Requirement predicates
 * =============================================================================
 */

function resolvePathValue(
    source,
    path,
) {

    if (
        !path
    ) {

        return undefined;
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
                undefined ||
            current ===
                null
        ) {

            return undefined;
        }

        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    current,
                    part,
                )
        ) {

            current =
                current[
                    part
                ];

        } else {

            return undefined;
        }
    }

    return current;
}

function evaluateCondition(
    condition,
    source,
    options = DEFAULTS,
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

    /**
     * Logical AND.
     */
    if (
        Array.isArray(
            condition.all,
        )
    ) {

        return condition.all.every(
            item =>
                evaluateCondition(
                    item,
                    source,
                    options,
                ),
        );
    }

    /**
     * Logical OR.
     */
    if (
        Array.isArray(
            condition.any,
        )
    ) {

        return condition.any.some(
            item =>
                evaluateCondition(
                    item,
                    source,
                    options,
                ),
        );
    }

    /**
     * Logical NOT.
     */
    if (
        condition.not
    ) {

        return !evaluateCondition(
            condition.not,
            source,
            options,
        );
    }

    const variable =
        normalizeVariableName(
            condition.variable,
            options,
        );

    if (
        !variable
    ) {

        return true;
    }

    const actual =
        resolvePathValue(
            source,
            variable,
        );

    if (
        condition.exists !==
            undefined
    ) {

        const exists =
            isPresentValue(
                actual,
                options,
            );

        return exists ===
            Boolean(
                condition.exists,
            );
    }

    if (
        condition.equals !==
            undefined
    ) {

        return normalizePresenceValue(
            actual,
            options,
        ) ===
        normalizePresenceValue(
            condition.equals,
            options,
        );
    }

    if (
        condition.notEquals !==
            undefined
    ) {

        return normalizePresenceValue(
            actual,
            options,
        ) !==
        normalizePresenceValue(
            condition.notEquals,
            options,
        );
    }

    if (
        Array.isArray(
            condition.oneOf,
        )
    ) {

        return condition.oneOf
            .some(
                expected =>
                    normalizePresenceValue(
                        actual,
                        options,
                    ) ===
                    normalizePresenceValue(
                        expected,
                        options,
                    ),
            );
    }

    if (
        Array.isArray(
            condition.notOneOf,
        )
    ) {

        return !condition.notOneOf
            .some(
                expected =>
                    normalizePresenceValue(
                        actual,
                        options,
                    ) ===
                    normalizePresenceValue(
                        expected,
                        options,
                    ),
            );
    }

    return true;
}

/**
 * =============================================================================
 * Requirement specification normalization
 * =============================================================================
 */

function normalizeRequirement(
    requirement,
    index,
    options,
) {

    if (
        typeof requirement ===
        'string'
    ) {

        return {
            id:
                `requirement:${index + 1}`,

            type:
                REQUIREMENT_TYPES
                    .REQUIRED,

            variables:
                [
                    normalizeVariableName(
                        requirement,
                        options,
                    ),
                ],

            severity:
                getRequirementSeverity(
                    options.environment,
                ),

            enabled:
                true,

            condition:
                null,

            message:
                null,

            description:
                null,

            metadata:
                {},
        };
    }

    if (
        !requirement ||
        typeof requirement !==
            'object'
    ) {

        throw new RequiredValidatorError(
            `Invalid TITech required-variable specification at index ${index}.`,
            {
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_VALUE,

                details: {
                    index,
                },
            },
        );
    }

    const type =
        String(
            requirement.type ||
            REQUIREMENT_TYPES
                .REQUIRED,
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            REQUIREMENT_TYPES,
        ).includes(
            type,
        )
    ) {

        throw new RequiredValidatorError(
            `Unsupported TITech requirement type "${type}".`,
            {
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_ENUM,

                details: {
                    index,
                    type,
                },
            },
        );
    }

    const variables =
        normalizeVariableList(
            requirement.variables ||
            requirement.variable ||
            requirement.names ||
            requirement.name ||
            [],
            options,
        );

    if (
        variables.length ===
        0 &&
        type !==
            REQUIREMENT_TYPES
                .CONDITIONAL
    ) {

        throw new RequiredValidatorError(
            'TITech required-variable specification does not define any variables.',
            {
                code:
                    VALIDATION_ERROR_CODES
                        .REQUIRED_VARIABLE_MISSING,

                details: {
                    index,
                },
            },
        );
    }

    return {
        id:
            normalizeVariableName(
                requirement.id,
                options,
            ) ||
            `requirement:${index + 1}`,

        type,

        variables,

        severity:
            getRequirementSeverity(
                options.environment,
                requirement.severity,
            ),

        enabled:
            requirement.enabled !==
            false,

        condition:
            requirement.condition ||
            null,

        when:
            requirement.when ||
            null,

        unless:
            requirement.unless ||
            null,

        message:
            requirement.message ||
            null,

        description:
            requirement.description ||
            null,

        aliases:
            normalizeVariableList(
                requirement.aliases ||
                [],
                options,
            ),

        defaultAllowed:
            requirement.defaultAllowed ===
                true,

        metadata:
            clone(
                requirement.metadata ||
                {},
            ),

        provider:
            requirement.provider ||
            null,

        feature:
            requirement.feature ||
            null,

        environments:
            Array.isArray(
                requirement.environments,
            )
                ? requirement.environments
                    .map(
                        value =>
                            normalizeEnvironment(
                                value,
                            ),
                    )
                : null,
    };
}

/**
 * =============================================================================
 * Core requirement checks
 * =============================================================================
 */

function findPresentAliases(
    variables,
    source,
    options,
) {

    const present =
        [];

    for (
        const variable of
        variables
    ) {

        const rawValue =
            resolvePathValue(
                source,
                variable,
            );

        if (
            isPresentValue(
                rawValue,
                options,
            )
        ) {

            present.push({
                variable,

                value:
                    rawValue,
            });
        }
    }

    return present;
}

function validateSingleRequired(
    requirement,
    source,
    collection,
    options,
) {

    const variables =
        [
            ...requirement.variables,
            ...requirement.aliases,
        ];

    const uniqueVariables =
        [
            ...new Set(
                variables,
            ),
        ];

    const present =
        findPresentAliases(
            uniqueVariables,
            source,
            options,
        );

    /**
     * Alias groups:
     *
     * If any alias exists, the logical requirement is satisfied.
     */
    if (
        present.length >
        0
    ) {

        if (
            options.detectAliasConflicts &&
            present.length >
                1
        ) {

            const values =
                present.map(
                    item => ({
                        variable:
                            item.variable,

                        value:
                            maskValue(
                                item.variable,
                                item.value,
                                options,
                            ),
                    }),
                );

            /**
             * Conflicting aliases are an error when values differ.
             */
            const canonicalValues =
                present.map(
                    item =>
                        normalizePresenceValue(
                            item.value,
                            options,
                        ),
                );

            const first =
                canonicalValues[0];

            const hasConflict =
                canonicalValues.some(
                    value =>
                        value !==
                        first,
                );

            if (
                hasConflict
            ) {

                collection.addIssue({
                    code:
                        VALIDATION_ERROR_CODES
                            .PRECEDENCE_CONFLICT,

                    category:
                        VALIDATION_CATEGORIES
                            .PRECEDENCE,

                    severity:
                        requirement.severity,

                    variable:
                        requirement.variables[0] ||
                        present[0]
                            .variable,

                    environment:
                        options.environment,

                    actual:
                        values,

                    message:
                        requirement.message ||
                        `Conflicting TITech values were supplied for aliases of "${requirement.variables[0] || present[0].variable}".`,
                });

                return {
                    satisfied:
                        false,

                    present,
                };
            }
        }

        return {
            satisfied:
                true,

            present,
        };
    }

    collection.addIssue({
        code:
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,

        category:
            VALIDATION_CATEGORIES
                .REQUIRED,

        severity:
            requirement.severity,

        variable:
            requirement.variables[0] ||
            null,

        path:
            requirement.variables[0] ||
            null,

        environment:
            options.environment,

        expected:
            uniqueVariables,

        message:
            requirement.message ||
            `TITech required configuration is missing: ${uniqueVariables.join(
                ', ',
            )}.`,
    });

    return {
        satisfied:
            false,

        present:
            [],
    };
}

function validateAnyOf(
    requirement,
    source,
    collection,
    options,
) {

    const variables =
        [
            ...requirement.variables,
            ...requirement.aliases,
        ];

    const uniqueVariables =
        [
            ...new Set(
                variables,
            ),
        ];

    const present =
        findPresentAliases(
            uniqueVariables,
            source,
            options,
        );

    if (
        present.length >
        0
    ) {

        return {
            satisfied:
                true,

            present,
        };
    }

    collection.addIssue({
        code:
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,

        category:
            VALIDATION_CATEGORIES
                .REQUIRED,

        severity:
            requirement.severity,

        variable:
            uniqueVariables.join(
                ',',
            ),

        environment:
            options.environment,

        expected:
            {
                anyOf:
                    uniqueVariables,
            },

        message:
            requirement.message ||
            `TITech requires at least one of: ${uniqueVariables.join(
                ', ',
            )}.`,
    });

    return {
        satisfied:
            false,

        present:
            [],
    };
}

function validateAllOf(
    requirement,
    source,
    collection,
    options,
) {

    const results =
        [];

    for (
        const variable of
        requirement.variables
    ) {

        const value =
            resolvePathValue(
                source,
                variable,
            );

        const satisfied =
            isPresentValue(
                value,
                options,
            );

        results.push({
            variable,

            satisfied,

            value:
                satisfied
                    ? value
                    : undefined,
        });

        if (
            !satisfied
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .REQUIRED_VARIABLE_MISSING,

                category:
                    VALIDATION_CATEGORIES
                        .REQUIRED,

                severity:
                    requirement.severity,

                variable,

                environment:
                    options.environment,

                message:
                    requirement.message ||
                    `TITech required configuration "${variable}" is missing.`,
            });
        }
    }

    return {
        satisfied:
            results.every(
                item =>
                    item.satisfied,
            ),

        present:
            results.filter(
                item =>
                    item.satisfied,
            ),
    };
}

function validateExactlyOne(
    requirement,
    source,
    collection,
    options,
) {

    const present =
        findPresentAliases(
            requirement.variables,
            source,
            options,
        );

    if (
        present.length ===
        1
    ) {

        return {
            satisfied:
                true,

            present,
        };
    }

    if (
        present.length ===
        0
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                requirement.severity,

            variable:
                requirement.variables.join(
                    ',',
                ),

            environment:
                options.environment,

            expected:
                {
                    exactlyOne:
                        requirement.variables,
                },

            message:
                requirement.message ||
                `TITech requires exactly one of: ${requirement.variables.join(
                    ', ',
                )}.`,
        });

    } else {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .CONFIGURATION,

            severity:
                requirement.severity,

            variable:
                requirement.variables.join(
                    ',',
                ),

            environment:
                options.environment,

            actual:
                present.map(
                    item =>
                        item.variable,
                ),

            message:
                requirement.message ||
                `TITech requires exactly one of ${requirement.variables.join(
                    ', ',
                )}, but multiple values were supplied.`,
        });
    }

    return {
        satisfied:
            false,

        present,
    };
}

function validateNoneOf(
    requirement,
    source,
    collection,
    options,
) {

    const present =
        findPresentAliases(
            requirement.variables,
            source,
            options,
        );

    if (
        present.length ===
        0
    ) {

        return {
            satisfied:
                true,

            present:
                [],
        };
    }

    collection.addIssue({
        code:
            VALIDATION_ERROR_CODES
                .INVALID_VALUE,

        category:
            VALIDATION_CATEGORIES
                .CONFIGURATION,

        severity:
            requirement.severity,

        variable:
            requirement.variables.join(
                ',',
            ),

        environment:
            options.environment,

        actual:
            present.map(
                item =>
                    item.variable,
            ),

        message:
            requirement.message ||
            `TITech configuration must not contain any of: ${requirement.variables.join(
                ', ',
            )}.`,
    });

    return {
        satisfied:
            false,

        present,
    };
}

function validateConditional(
    requirement,
    source,
    collection,
    options,
) {

    const condition =
        evaluateCondition(
            requirement.condition ||
            requirement.when,
            source,
            options,
        );

    if (
        requirement.unless &&
        evaluateCondition(
            requirement.unless,
            source,
            options,
        )
    ) {

        return {
            satisfied:
                true,

            skipped:
                true,

            condition:
                false,

            present:
                [],
        };
    }

    if (
        !condition
    ) {

        return {
            satisfied:
                true,

            skipped:
                true,

            condition:
                false,

            present:
                [],
        };
    }

    return validateSingleRequired(
        {
            ...requirement,

            type:
                REQUIREMENT_TYPES
                    .REQUIRED,
        },
        source,
        collection,
        options,
    );
}

/**
 * =============================================================================
 * Provider/feature requirements
 * =============================================================================
 */

function matchesEnvironment(
    requirement,
    environment,
) {

    if (
        !requirement.environments ||
        requirement.environments.length ===
            0
    ) {

        return true;
    }

    return requirement
        .environments
        .includes(
            normalizeEnvironment(
                environment,
            ),
        );
}

function matchesProvider(
    requirement,
    source,
) {

    if (
        !requirement.provider
    ) {

        return true;
    }

    const expected =
        Array.isArray(
            requirement.provider,
        )
            ? requirement.provider
                .map(
                    normalizeEnvironment,
                )
            : [
                normalizeEnvironment(
                    requirement.provider,
                ),
            ];

    const actual =
        String(
            resolvePathValue(
                source,
                'MOBILE_MONEY_PROVIDER',
            ) ||
            resolvePathValue(
                source,
                'PAYMENT_PROVIDER',
            ) ||
            resolvePathValue(
                source,
                'PROVIDER',
            ) ||
            '',
        )
            .trim()
            .toLowerCase();

    return (
        expected.length ===
            0 ||
        expected.includes(
            actual,
        )
    );
}

function isFeatureEnabled(
    feature,
    source,
    options,
) {

    if (
        !feature
    ) {

        return true;
    }

    if (
        typeof feature ===
        'function'
    ) {

        try {

            return Boolean(
                feature(
                    source,
                ),
            );

        } catch {

            return false;
        }
    }

    if (
        typeof feature ===
        'string'
    ) {

        const value =
            resolvePathValue(
                source,
                feature,
            );

        return isPresentValue(
            value,
            options,
        );
    }

    if (
        typeof feature ===
        'object'
    ) {

        return evaluateCondition(
            feature,
            source,
            options,
        );
    }

    return Boolean(
        feature,
    );
}

/**
 * =============================================================================
 * Main validation function
 * =============================================================================
 */

function validateRequiredConfiguration(
    source = {},
    options = {},
) {

    const normalizedOptions =
        {
            ...DEFAULTS,
            ...options,

            environment:
                normalizeEnvironment(
                    options.environment ||
                    source.NODE_ENV,
                ),
        };

    if (
        !source ||
        typeof source !==
        'object'
    ) {

        throw new RequiredValidatorError(
            'TITech required configuration validator requires an object.',
            {
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_TYPE,

                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,
            },
        );
    }

    const collection =
        new ValidationErrorCollection({
            maxErrors:
                normalizedOptions.maxRequirements,
        });

    const diagnostics =
        {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                normalizedOptions.environment,

            evaluated:
                0,

            satisfied:
                0,

            skipped:
                0,

            failed:
                0,

            aliases:
                0,

            conditional:
                0,

            groups:
                0,

            timestamp:
                new Date().toISOString(),
        };

    const requirements =
        buildRequirementSet(
            normalizedOptions,
        );

    if (
        requirements.length >
        normalizedOptions
            .maxRequirements
    ) {

        throw new RequiredValidatorError(
            'TITech required configuration policy contains too many requirements.',
            {
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_RANGE,
            },
        );
    }

    const seenRequirementKeys =
        new Set();

    for (
        const [
            index,
            rawRequirement,
        ] of requirements.entries()
    ) {

        if (
            normalizedOptions
                .stopAfterFirstError &&
            collection.hasErrors()
        ) {

            break;
        }

        let requirement =
            null;

        try {

            requirement =
                normalizeRequirement(
                    rawRequirement,
                    index,
                    normalizedOptions,
                );

        } catch (
            error
        ) {

            collection.add(
                error,
            );

            diagnostics.failed +=
                1;

            continue;
        }

        diagnostics.evaluated +=
            1;

        if (
            requirement.aliases.length >
            0
        ) {

            diagnostics.aliases +=
                1;
        }

        if (
            requirement.type ===
            REQUIREMENT_TYPES
                .CONDITIONAL
        ) {

            diagnostics.conditional +=
                1;
        }

        if (
            [
                REQUIREMENT_TYPES
                    .ANY_OF,
                REQUIREMENT_TYPES
                    .ALL_OF,
                REQUIREMENT_TYPES
                    .EXACTLY_ONE,
                REQUIREMENT_TYPES
                    .NONE_OF,
            ].includes(
                requirement.type,
            )
        ) {

            diagnostics.groups +=
                1;
        }

        /**
         * Environment filter.
         */
        if (
            !matchesEnvironment(
                requirement,
                normalizedOptions
                    .environment,
            )
        ) {

            diagnostics.skipped +=
                1;

            continue;
        }

        /**
         * Provider filter.
         */
        if (
            !matchesProvider(
                requirement,
                source,
            )
        ) {

            diagnostics.skipped +=
                1;

            continue;
        }

        /**
         * Feature filter.
         */
        if (
            requirement.feature &&
            !isFeatureEnabled(
                requirement.feature,
                source,
                normalizedOptions,
            )
        ) {

            diagnostics.skipped +=
                1;

            continue;
        }

        /**
         * Explicit enabled switch.
         */
        if (
            !requirement.enabled
        ) {

            diagnostics.skipped +=
                1;

            continue;
        }

        const requirementKey =
            stableStringify({
                type:
                    requirement.type,

                variables:
                    requirement.variables,

                aliases:
                    requirement.aliases,

                environment:
                    requirement.environments,

                provider:
                    requirement.provider,

                feature:
                    Boolean(
                        requirement.feature,
                    ),
            });

        if (
            normalizedOptions
                .detectDuplicateRequirements
        ) {

            if (
                seenRequirementKeys.has(
                    requirementKey,
                )
            ) {

                collection.addIssue({
                    code:
                        VALIDATION_ERROR_CODES
                            .CONFIGURATION_INCONSISTENT,

                    category:
                        VALIDATION_CATEGORIES
                            .CONFIGURATION,

                    severity:
                        VALIDATION_SEVERITIES
                            .WARNING,

                    variable:
                        requirement.variables.join(
                            ',',
                        ),

                    environment:
                        normalizedOptions
                            .environment,

                    message:
                        `Duplicate TITech required-configuration policy detected for "${requirement.variables.join(
                            ', ',
                        )}".`,
                });

                continue;
            }

            seenRequirementKeys.add(
                requirementKey,
            );
        }

        /**
         * Evaluate requirement.
         */
        let evaluation;

        switch (
            requirement.type
        ) {

            case REQUIREMENT_TYPES
                .REQUIRED:

                evaluation =
                    validateSingleRequired(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );

                break;

            case REQUIREMENT_TYPES
                .ALIAS:

                evaluation =
                    validateSingleRequired(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );

                break;

            case REQUIREMENT_TYPES
                .ANY_OF:

                evaluation =
                    validateAnyOf(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );

                break;

            case REQUIREMENT_TYPES
                .ALL_OF:

                evaluation =
                    validateAllOf(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );

                break;

            case REQUIREMENT_TYPES
                .EXACTLY_ONE:

                evaluation =
                    validateExactlyOne(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );

                break;

            case REQUIREMENT_TYPES
                .NONE_OF:

                evaluation =
                    validateNoneOf(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );

                break;

            case REQUIREMENT_TYPES
                .CONDITIONAL:

                evaluation =
                    validateConditional(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );

                break;

            default:

                evaluation =
                    validateSingleRequired(
                        requirement,
                        source,
                        collection,
                        normalizedOptions,
                    );
        }

        if (
            evaluation?.skipped
        ) {

            diagnostics.skipped +=
                1;

        } else if (
            evaluation?.satisfied
        ) {

            diagnostics.satisfied +=
                1;

        } else {

            diagnostics.failed +=
                1;
        }
    }

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

    diagnostics.blockingErrors =
        blockingErrors.length;

    diagnostics.totalErrors =
        summary.total;

    const result = {
        valid:
            blockingErrors.length ===
            0,

        ready:
            blockingErrors.length ===
            0,

        status,

        environment:
            normalizedOptions.environment,

        summary,

        diagnostics,

        errors:
            collection.toJSON({
                environment:
                    normalizedOptions
                        .environment,

                includeRawValues:
                    normalizedOptions
                        .includeValues,
            }),

        fingerprint:
            fingerprint(
                {
                    environment:
                        normalizedOptions
                            .environment,

                    requirements:
                        requirements.map(
                            requirement =>
                                typeof requirement ===
                                'string'
                                    ? requirement
                                    : {
                                        type:
                                            requirement
                                                .type ||
                                            null,

                                        variables:
                                            requirement
                                                .variables ||
                                            requirement
                                                .variable ||
                                            null,

                                        environments:
                                            requirement
                                                .environments ||
                                            null,

                                        provider:
                                            requirement
                                                .provider ||
                                            null,
                                    },
                        ),

                    errorCodes:
                        collection.errors
                            .map(
                                error =>
                                    error.code,
                            ),
                },
                normalizedOptions,
            ),

        timestamp:
            new Date().toISOString(),
    };

    if (
        normalizedOptions.failClosed &&
        blockingErrors.length >
        0
    ) {

        throw new EnvironmentValidationAggregateError(
            blockingErrors,
            {
                message:
                    'TITech required environment configuration validation failed.',

                environment:
                    normalizedOptions
                        .environment,

                component:
                    COMPONENT,

                code:
                    'TITECH_REQUIRED_CONFIGURATION_INVALID',
            },
        );
    }

    return deepFreeze(
        result,
    );
}

/**
 * =============================================================================
 * Requirement-set builder
 * =============================================================================
 *
 * A practical enterprise baseline is included so this validator can operate
 * even when the caller has not supplied an explicit schema.
 *
 * The caller can override/replace this set through:
 *
 *   options.requirements
 *
 * or extend it through:
 *
 *   options.additionalRequirements
 *
 * =============================================================================
 */

function buildRequirementSet(
    options,
) {

    if (
        Array.isArray(
            options.requirements,
        )
    ) {

        return [
            ...options.requirements,
            ...(
                options
                    .additionalRequirements ||
                []
            ),
        ];
    }

    const environment =
        options.environment;

    const baseline = [
        /**
         * Application identity.
         */
        {
            id:
                'application.name',

            variable:
                'APP_NAME',

            environments:
                [
                    'development',
                    'test',
                    'staging',
                    'production',
                ],
        },

        {
            id:
                'application.environment',

            variable:
                'NODE_ENV',

            environments:
                [
                    'development',
                    'test',
                    'staging',
                    'production',
                ],
        },
    ];

    /**
     * Production baseline.
     *
     * These are deliberately only presence requirements. Type/format/semantic
     * checks remain with specialized validators.
     */
    if (
        environment ===
        'production'
    ) {

        baseline.push(
            {
                id:
                    'production.jwt',

                type:
                    REQUIREMENT_TYPES
                        .ANY_OF,

                variables:
                    [
                        'JWT_ACCESS_SECRET',
                        'JWT_SECRET',
                        'JWT_PRIVATE_KEY',
                    ],

                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                message:
                    'TITech production authentication signing material is required.',
            },

            {
                id:
                    'production.mobileMoney',

                type:
                    REQUIREMENT_TYPES
                        .CONDITIONAL,

                condition:
                    {
                        variable:
                            'MOBILE_MONEY_ENABLED',

                        equals:
                            'true',
                    },

                variables:
                    [
                        'MOBILE_MONEY_PROVIDER',
                    ],

                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                message:
                    'TITech Mobile Money provider is required when Mobile Money is enabled.',
            },
        );
    }

    return baseline.concat(
        options.additionalRequirements ||
        [],
    );
}

/**
 * =============================================================================
 * Required variable convenience functions
 * =============================================================================
 */

function requireVariable(
    source,
    variable,
    options = {},
) {

    const result =
        validateRequiredConfiguration(
            source,
            {
                ...options,

                requirements:
                    [
                        {
                            type:
                                REQUIREMENT_TYPES
                                    .REQUIRED,

                            variable,

                            severity:
                                options.severity,
                        },
                    ],
            },
        );

    return result;
}

function requireAnyOf(
    source,
    variables,
    options = {},
) {

    return validateRequiredConfiguration(
        source,
        {
            ...options,

            requirements:
                [
                    {
                        type:
                            REQUIREMENT_TYPES
                                .ANY_OF,

                        variables,

                        severity:
                            options.severity,
                    },
                ],
        },
    );
}

function requireAllOf(
    source,
    variables,
    options = {},
) {

    return validateRequiredConfiguration(
        source,
        {
            ...options,

            requirements:
                [
                    {
                        type:
                            REQUIREMENT_TYPES
                                .ALL_OF,

                        variables,

                        severity:
                            options.severity,
                    },
                ],
        },
    );
}

function requireExactlyOne(
    source,
    variables,
    options = {},
) {

    return validateRequiredConfiguration(
        source,
        {
            ...options,

            requirements:
                [
                    {
                        type:
                            REQUIREMENT_TYPES
                                .EXACTLY_ONE,

                        variables,

                        severity:
                            options.severity,
                    },
                ],
        },
    );
}

/**
 * =============================================================================
 * RequiredValidator class
 * =============================================================================
 */

class RequiredValidator {

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
     * Validate.
     * -------------------------------------------------------------------------
     */

    validate(
        source = {},
        options = {},
    ) {

        const mergedOptions =
            {
                ...this.options,
                ...options,
            };

        this.state =
            'validating';

        try {

            const result =
                validateRequiredConfiguration(
                    source,
                    mergedOptions,
                );

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

                    evaluated:
                        result.diagnostics
                            .evaluated,

                    failed:
                        result.diagnostics
                            .failed,
                },
                result.valid
                    ? 'TITech required environment validation completed.'
                    : 'TITech required environment validation failed.',
            );

            return result;

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
        options = {},
    ) {

        return this.validate(
            process.env,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Production validation.
     * -------------------------------------------------------------------------
     */

    validateProduction(
        source = {},
        options = {},
    ) {

        return this.validate(
            source,
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
     * Staging validation.
     * -------------------------------------------------------------------------
     */

    validateStaging(
        source = {},
        options = {},
    ) {

        return this.validate(
            source,
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
     * Check without throwing.
     * -------------------------------------------------------------------------
     */

    check(
        source = {},
        options = {},
    ) {

        try {

            return this.validate(
                source,
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
     * Single variable.
     * -------------------------------------------------------------------------
     */

    require(
        source,
        variable,
        options = {},
    ) {

        return requireVariable(
            source,
            variable,
            {
                ...this.options,
                ...options,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Any of.
     * -------------------------------------------------------------------------
     */

    anyOf(
        source,
        variables,
        options = {},
    ) {

        return requireAnyOf(
            source,
            variables,
            {
                ...this.options,
                ...options,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * All of.
     * -------------------------------------------------------------------------
     */

    allOf(
        source,
        variables,
        options = {},
    ) {

        return requireAllOf(
            source,
            variables,
            {
                ...this.options,
                ...options,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Exactly one.
     * -------------------------------------------------------------------------
     */

    exactlyOne(
        source,
        variables,
        options = {},
    ) {

        return requireExactlyOne(
            source,
            variables,
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
 * Singleton
 * =============================================================================
 */

const requiredValidator =
    new RequiredValidator();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function validate(
    source,
    options,
) {

    return requiredValidator.validate(
        source,
        options,
    );
}

function validateEnvironment(
    options,
) {

    return requiredValidator
        .validateEnvironment(
            options,
        );
}

function validateProduction(
    source,
    options,
) {

    return requiredValidator
        .validateProduction(
            source,
            options,
        );
}

function validateStaging(
    source,
    options,
) {

    return requiredValidator
        .validateStaging(
            source,
            options,
        );
}

function check(
    source,
    options,
) {

    return requiredValidator.check(
        source,
        options,
    );
}

function requireValue(
    source,
    variable,
    options,
) {

    return requiredValidator.require(
        source,
        variable,
        options,
    );
}

function anyOf(
    source,
    variables,
    options,
) {

    return requiredValidator.anyOf(
        source,
        variables,
        options,
    );
}

function allOf(
    source,
    variables,
    options,
) {

    return requiredValidator.allOf(
        source,
        variables,
        options,
    );
}

function exactlyOne(
    source,
    variables,
    options,
) {

    return requiredValidator.exactlyOne(
        source,
        variables,
        options,
    );
}

function snapshot() {

    return requiredValidator.snapshot();
}

function readiness() {

    return requiredValidator.readiness();
}

function health() {

    return requiredValidator.health();
}

function reset() {

    return requiredValidator.reset();
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
        requiredValidator,

        RequiredValidator,

        RequiredValidatorError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        REQUIREMENT_TYPES,

        REQUIREMENT_SEVERITIES,

        DEFAULTS,

        /**
         * Main validation.
         */
        validate,

        validateEnvironment,

        validateProduction,

        validateStaging,

        check,

        validateRequiredConfiguration,

        /**
         * Requirement helpers.
         */
        require:
            requireValue,

        anyOf,

        allOf,

        exactlyOne,

        /**
         * Presence/predicate helpers.
         */
        isMissingValue,

        isPresentValue,

        evaluateCondition,

        resolvePathValue,

        normalizeVariableName,

        normalizeVariableList,

        /**
         * Diagnostics.
         */
        snapshot,

        readiness,

        health,

        /**
         * Fingerprinting.
         */
        fingerprint,

        /**
         * Reset.
         */
        reset,
    });