'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/requiredVariables.js
 *
 * Purpose:
 *   Enterprise production-grade required environment variable policy registry.
 *
 * Responsibilities:
 *   - Define TITech environment variables required by runtime policy.
 *   - Separate universally required variables from environment-specific ones.
 *   - Define conditional requirements based on enabled features.
 *   - Define dependency-aware requirements.
 *   - Provide safe, deterministic requirement evaluation.
 *   - Prevent secrets from appearing in diagnostics.
 *   - Support aliases and alternative variable groups.
 *   - Support production/staging/development/test policies.
 *   - Provide structured missing-variable diagnostics.
 *   - Provide readiness/health reporting.
 *   - Produce a deterministic policy fingerprint.
 *
 * IMPORTANT:
 *
 *   This module defines REQUIREMENT POLICY.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - normalize values.
 *     - perform complete configuration validation.
 *     - create MongoDB connections.
 *     - create Redis connections.
 *     - initialize queues.
 *     - start Express.
 *     - start HTTP servers.
 *     - execute financial transactions.
 *     - authorize tenant access.
 *
 * Related environment modules:
 *
 *   backend/config/environment.js
 *   backend/config/environment/layerMerger.js
 *   backend/config/environment/precedenceRules.js
 *   backend/config/environment/namespaceBuilder.js
 *   backend/config/environment/normalizeEnvironment.js
 *   backend/config/environment/environmentValidator.js
 *   backend/config/environment/environmentSnapshot.js
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
    'environment-required-variables';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const ENVIRONMENTS =
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
        ENVIRONMENTS.DEVELOPMENT,
        ENVIRONMENTS.TEST,
        ENVIRONMENTS.STAGING,
        ENVIRONMENTS.PRODUCTION,
    ]);

const REQUIREMENT_TYPES =
    Object.freeze({
        REQUIRED:
            'required',

        OPTIONAL:
            'optional',

        CONDITIONAL:
            'conditional',

        ALTERNATIVE:
            'alternative',
    });

const REQUIREMENT_STATUSES =
    Object.freeze({
        PRESENT:
            'present',

        MISSING:
            'missing',

        SATISFIED:
            'satisfied',

        UNSATISFIED:
            'unsatisfied',

        IGNORED:
            'ignored',

        INVALID:
            'invalid',
    });

const SEVERITIES =
    Object.freeze({
        INFO:
            'info',

        WARNING:
            'warning',

        ERROR:
            'error',

        CRITICAL:
            'critical',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        includeOptional:
            true,

        includeDevelopment:
            true,

        includeTest:
            true,

        includeStaging:
            true,

        includeProduction:
            true,

        allowUnknownEnvironment:
            false,

        allowEmptyValues:
            false,

        maxDefinitions:
            500,

        maxChecks:
            2_500,

        fingerprintAlgorithm:
            'sha256',

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt[_-]?secret|access[_-]?token|refresh[_-]?token|cookie|credential|signing[_-]?key)/i,
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class RequiredVariablesError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'RequiredVariablesError';

        this.code =
            options.code ||
            'REQUIRED_VARIABLES_ERROR';

        this.environment =
            options.environment ||
            null;

        this.variable =
            options.variable ||
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
            RequiredVariablesError,
        );
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

function normalizeEnvironment(
    environment,
) {

    return String(
        environment ||
        ENVIRONMENTS.DEVELOPMENT,
    )
        .trim()
        .toLowerCase();
}

function isSupportedEnvironment(
    environment,
) {

    return SUPPORTED_ENVIRONMENTS.includes(
        normalizeEnvironment(
            environment,
        ),
    );
}

function isEmpty(
    value,
    options = DEFAULTS,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return true;
    }

    if (
        typeof value ===
        'string'
    ) {

        return (
            value.trim() ===
            ''
        );
    }

    return false;
}

function isPresent(
    value,
    options = DEFAULTS,
) {

    if (
        isEmpty(
            value,
            options,
        )
    ) {

        return false;
    }

    return true;
}

function isSensitive(
    variable,
    options = DEFAULTS,
) {

    return (
        options.sensitivePattern ||
        DEFAULTS.sensitivePattern
    ).test(
        String(
            variable ||
            '',
        ),
    );
}

function normalizeList(
    value,
) {

    if (
        Array.isArray(
            value,
        )
    ) {

        return [
            ...new Set(
                value
                    .map(
                        item =>
                            String(
                                item,
                            )
                                .trim(),
                    )
                    .filter(Boolean),
            ),
        ];
    }

    if (
        typeof value !==
        'string'
    ) {

        return [];
    }

    return [
        ...new Set(
            value
                .split(',')
                .map(
                    item =>
                        item.trim(),
                )
                .filter(Boolean),
        ),
    ];
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
        // Requirement evaluation must never depend on logger availability.
    }
}

/**
 * =============================================================================
 * RequirementDefinition
 * =============================================================================
 */

class RequirementDefinition {

    constructor(
        definition = {},
    ) {

        this.name =
            String(
                definition.name ||
                definition.variable ||
                '',
            ).trim();

        this.variable =
            String(
                definition.variable ||
                definition.name ||
                '',
            ).trim();

        this.description =
            definition.description ||
            null;

        this.type =
            definition.type ||
            REQUIREMENT_TYPES.REQUIRED;

        this.severity =
            definition.severity ||
            SEVERITIES.ERROR;

        this.requiredIn =
            Object.freeze([
                ...(
                    definition.requiredIn ||
                    []
                ).map(
                    normalizeEnvironment,
                ),
            ]);

        this.optionalIn =
            Object.freeze([
                ...(
                    definition.optionalIn ||
                    []
                ).map(
                    normalizeEnvironment,
                ),
            ]);

        this.default =
            definition.default;

        this.aliases =
            Object.freeze([
                ...(
                    definition.aliases ||
                    []
                ).map(
                    value =>
                        String(
                            value,
                        ).trim(),
                ).filter(Boolean),
            ]);

        this.anyOf =
            Object.freeze([
                ...(
                    definition.anyOf ||
                    []
                ).map(
                    value =>
                        String(
                            value,
                        ).trim(),
                ).filter(Boolean),
            ]);

        this.allOf =
            Object.freeze([
                ...(
                    definition.allOf ||
                    []
                ).map(
                    value =>
                        String(
                            value,
                        ).trim(),
                ).filter(Boolean),
            ]);

        this.dependsOn =
            Object.freeze([
                ...(
                    definition.dependsOn ||
                    []
                ).map(
                    value =>
                        String(
                            value,
                        ).trim(),
                ).filter(Boolean),
            ]);

        this.when =
            typeof definition.when ===
            'function'
                ? definition.when
                : null;

        this.condition =
            definition.condition ||
            null;

        this.validate =
            typeof definition.validate ===
            'function'
                ? definition.validate
                : null;

        this.metadata =
            Object.freeze({
                ...(definition.metadata || {}),
            });
    }

    isApplicable(
        environment,
        config,
    ) {

        const normalized =
            normalizeEnvironment(
                environment,
            );

        if (
            this.requiredIn.length >
                0 &&
            !this.requiredIn.includes(
                normalized,
            )
        ) {

            return false;
        }

        if (
            this.optionalIn.length >
                0 &&
            this.optionalIn.includes(
                normalized,
            )
        ) {

            return false;
        }

        if (
            this.when
        ) {

            return Boolean(
                this.when(
                    {
                        environment:
                            normalized,

                        config:
                            config || {},
                    },
                ),
            );
        }

        if (
            this.condition
        ) {

            return evaluateCondition(
                this.condition,
                config,
            );
        }

        return true;
    }

    getCandidateVariables() {

        const candidates = [
            this.variable,
            ...this.aliases,
            ...this.anyOf,
        ];

        return [
            ...new Set(
                candidates.filter(
                    Boolean,
                ),
            ),
        ];
    }

    toJSON() {

        return {
            name:
                this.name,

            variable:
                this.variable,

            description:
                this.description,

            type:
                this.type,

            severity:
                this.severity,

            requiredIn:
                [...this.requiredIn],

            optionalIn:
                [...this.optionalIn],

            default:
                this.default,

            aliases:
                [...this.aliases],

            anyOf:
                [...this.anyOf],

            allOf:
                [...this.allOf],

            dependsOn:
                [...this.dependsOn],

            condition:
                this.condition,

            metadata:
                clone(
                    this.metadata,
                ),
        };
    }
}

/**
 * =============================================================================
 * Conditional expression evaluator
 * =============================================================================
 *
 * Supported forms:
 *
 * {
 *   variable: 'ENABLE_REDIS',
 *   equals: 'true'
 * }
 *
 * {
 *   variable: 'NODE_ENV',
 *   in: ['production', 'staging']
 * }
 *
 * {
 *   variable: 'ENABLE_REDIS',
 *   truthy: true
 * }
 *
 * {
 *   all: [...]
 * }
 *
 * {
 *   any: [...]
 * }
 *
 * {
 *   not: {...}
 * }
 * =============================================================================
 */

function evaluateCondition(
    condition,
    config = {},
) {

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
                evaluateCondition(
                    item,
                    config,
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
                evaluateCondition(
                    item,
                    config,
                ),
        );
    }

    if (
        condition.not
    ) {

        return !evaluateCondition(
            condition.not,
            config,
        );
    }

    const variable =
        String(
            condition.variable ||
            '',
        ).trim();

    if (
        !variable
    ) {

        return false;
    }

    const value =
        config[
            variable
        ];

    if (
        condition.equals !==
        undefined
    ) {

        return String(
            value,
        ) ===
        String(
            condition.equals,
        );
    }

    if (
        Array.isArray(
            condition.in,
        )
    ) {

        return condition.in.some(
            item =>
                String(
                    value,
                ) ===
                String(
                    item,
                ),
        );
    }

    if (
        condition.truthy !==
        undefined
    ) {

        const truthy =
            !isEmpty(
                value,
            ) &&
            !(
                value ===
                    false ||
                String(
                    value,
                )
                    .trim()
                    .toLowerCase() ===
                    'false'
            );

        return condition.truthy
            ? truthy
            : !truthy;
    }

    return Boolean(
        value,
    );
}

/**
 * =============================================================================
 * RequiredVariables
 * =============================================================================
 */

class RequiredVariables {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.definitions =
            new Map();

        this.state =
            'created';

        this.lastResult =
            null;

        this.lastError =
            null;

        this.history =
            [];
    }

    /**
     * -------------------------------------------------------------------------
     * Register a definition.
     * -------------------------------------------------------------------------
     */

    register(
        definition,
    ) {

        if (
            this.definitions.size >=
            this.options.maxDefinitions
        ) {

            throw new RequiredVariablesError(
                'TITech required-variable definition limit exceeded.',
                {
                    code:
                        'REQUIRED_VARIABLE_DEFINITION_LIMIT_EXCEEDED',
                },
            );
        }

        const normalized =
            definition instanceof
            RequirementDefinition
                ? definition
                : new RequirementDefinition(
                    definition,
                );

        if (
            !normalized.variable &&
            normalized.type !==
                REQUIREMENT_TYPES.ALTERNATIVE
        ) {

            throw new RequiredVariablesError(
                'Required environment variable definition requires a variable name.',
                {
                    code:
                        'REQUIRED_VARIABLE_NAME_REQUIRED',
                },
            );
        }

        this.definitions.set(
            normalized.name ||
            normalized.variable,
            normalized,
        );

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Register many definitions.
     * -------------------------------------------------------------------------
     */

    registerMany(
        definitions = [],
    ) {

        if (
            !Array.isArray(
                definitions,
            )
        ) {

            throw new RequiredVariablesError(
                'TITech required-variable definitions must be an array.',
                {
                    code:
                        'REQUIRED_VARIABLE_DEFINITIONS_ARRAY_REQUIRED',
                },
            );
        }

        return definitions.map(
            definition =>
                this.register(
                    definition,
                ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Get definition.
     * -------------------------------------------------------------------------
     */

    get(
        name,
    ) {

        return this.definitions.get(
            String(
                name,
            ).trim(),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Remove definition.
     * -------------------------------------------------------------------------
     */

    remove(
        name,
    ) {

        return this.definitions.delete(
            String(
                name,
            ).trim(),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Clear definitions.
     * -------------------------------------------------------------------------
     */

    clear() {

        this.definitions.clear();

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Evaluate current environment.
     * -------------------------------------------------------------------------
     */

    evaluate(
        environment =
            process.env,
        options = {},
    ) {

        const env =
            normalizeEnvironment(
                options.environment ||
                environment?.NODE_ENV ||
                ENVIRONMENTS.DEVELOPMENT,
            );

        if (
            !isSupportedEnvironment(
                env
            ) &&
            !this.options
                .allowUnknownEnvironment
        ) {

            throw new RequiredVariablesError(
                `Unsupported TITech environment "${env}".`,
                {
                    code:
                        'REQUIRED_VARIABLE_ENVIRONMENT_UNSUPPORTED',

                    environment:
                        env,
                },
            );
        }

        const source =
            environment &&
            typeof environment ===
                'object'
                ? environment
                : {};

        const checks =
            [];

        const missing =
            [];

        const satisfied =
            [];

        const ignored =
            [];

        const invalid =
            [];

        const warnings =
            [];

        const processed =
            new Set();

        for (
            const definition of
            this.definitions.values()
        ) {

            if (
                processed.has(
                    definition.name,
                )
            ) {

                continue;
            }

            processed.add(
                definition.name,
            );

            if (
                !definition.isApplicable(
                    env,
                    source,
                )
            ) {

                ignored.push(
                    this.buildCheck(
                        definition,
                        {
                            status:
                                REQUIREMENT_STATUSES
                                    .IGNORED,

                            environment:
                                env,

                            reason:
                                'not-applicable',
                        },
                    ),
                );

                continue;
            }

            const check =
                this.evaluateDefinition(
                    definition,
                    source,
                    env,
                );

            checks.push(
                check,
            );

            switch (
                check.status
            ) {

                case REQUIREMENT_STATUSES
                    .PRESENT:

                case REQUIREMENT_STATUSES
                    .SATISFIED:

                    satisfied.push(
                        check,
                    );

                    break;

                case REQUIREMENT_STATUSES
                    .MISSING:

                case REQUIREMENT_STATUSES
                    .UNSATISFIED:

                    if (
                        check.severity ===
                        SEVERITIES.WARNING
                    ) {

                        warnings.push(
                            check,
                        );
                    } else {

                        missing.push(
                            check,
                        );
                    }

                    break;

                case REQUIREMENT_STATUSES
                    .INVALID:

                    invalid.push(
                        check,
                    );

                    break;

                case REQUIREMENT_STATUSES
                    .IGNORED:

                default:

                    ignored.push(
                        check,
                    );
            }
        }

        /**
         * Evaluate alternative groups separately.
         */
        const alternativeGroups =
            this.collectAlternativeGroups();

        for (
            const group of
            alternativeGroups
        ) {

            const result =
                this.evaluateAlternativeGroup(
                    group,
                    source,
                    env,
                );

            checks.push(
                result,
            );

            if (
                result.status ===
                REQUIREMENT_STATUSES
                    .MISSING
            ) {

                if (
                    result.severity ===
                    SEVERITIES.WARNING
                ) {

                    warnings.push(
                        result,
                    );

                } else {

                    missing.push(
                        result,
                    );
                }
            } else if (
                result.status ===
                REQUIREMENT_STATUSES
                    .SATISFIED
            ) {

                satisfied.push(
                    result,
                );
            }
        }

        const dependencyErrors =
            this.evaluateDependencies(
                source,
                checks,
                env,
            );

        for (
            const dependencyError of
            dependencyErrors
        ) {

            checks.push(
                dependencyError,
            );

            invalid.push(
                dependencyError,
            );
        }

        const valid =
            (
                missing.length ===
                    0 &&
                invalid.length ===
                    0
            );

        const status =
            valid
                ? warnings.length >
                  0
                    ? 'degraded'
                    : 'ready'
                : 'invalid';

        const result = {
            status,

            valid,

            ready:
                valid,

            environment:
                env,

            summary: {
                total:
                    checks.length,

                satisfied:
                    satisfied.length,

                missing:
                    missing.length,

                invalid:
                    invalid.length,

                warnings:
                    warnings.length,

                ignored:
                    ignored.length,
            },

            missing:
                missing.map(
                    item =>
                        this.toSafeDiagnostic(
                            item,
                            source,
                        ),
                ),

            invalid:
                invalid.map(
                    item =>
                        this.toSafeDiagnostic(
                            item,
                            source,
                        ),
                ),

            warnings:
                warnings.map(
                    item =>
                        this.toSafeDiagnostic(
                            item,
                            source,
                        ),
                ),

            satisfied:
                satisfied.map(
                    item =>
                        this.toSafeDiagnostic(
                            item,
                            source,
                ),

            ignored:
                ignored.map(
                    item =>
                        this.toSafeDiagnostic(
                            item,
                            source,
                        ),
                ),

            fingerprint:
                {
                    algorithm:
                        this.options
                            .fingerprintAlgorithm,

                    value:
                        fingerprint(
                            this.buildFingerprintPayload(
                                env,
                                checks,
                            ),
                            this.options
                                .fingerprintAlgorithm,
                        ),
                },

            timestamp:
                new Date().toISOString(),
        };

        this.state =
            valid
                ? warnings.length >
                  0
                    ? 'degraded'
                    : 'ready'
                : 'failed';

        this.lastResult =
            deepFreeze(
                result,
            );

        this.recordHistory(
            {
                type:
                    'requirements.evaluated',

                environment:
                    env,

                status,
                missing:
                    missing.length,

                invalid:
                    invalid.length,

                warnings:
                    warnings.length,
            },
        );

        log(
            valid
                ? warnings.length >
                  0
                    ? 'warn'
                    : 'info'
                : 'error',
            {
                environment:
                    env,

                status,

                missing:
                    missing.length,

                invalid:
                    invalid.length,

                warnings:
                    warnings.length,
            },
            valid
                ? 'TITech required environment variable evaluation completed.'
                : 'TITech required environment variable evaluation failed.',
        );

        if (
            !valid &&
            (
                options.throwOnError ||
                (
                    options.failClosed ??
                    this.options.failClosed
                )
            )
        ) {

            throw new RequiredVariablesError(
                `TITech environment is missing or contains invalid required variables for "${env}".`,
                {
                    code:
                        'REQUIRED_ENVIRONMENT_VARIABLES_MISSING',

                    environment:
                        env,

                    details: {
                        missing:
                            result.missing,

                        invalid:
                            result.invalid,
                    },
                },
            );
        }

        return this.lastResult;
    }

    /**
     * -------------------------------------------------------------------------
     * Evaluate one definition.
     * -------------------------------------------------------------------------
     */

    evaluateDefinition(
        definition,
        source,
        environment,
    ) {

        const candidates =
            definition.getCandidateVariables();

        let matchedVariable =
            null;

        let matchedValue =
            undefined;

        for (
            const candidate of
            candidates
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    source,
                    candidate,
                ) &&
                (
                    this.options
                        .allowEmptyValues ||
                    isPresent(
                        source[
                            candidate
                        ],
                        this.options,
                    )
                )
            ) {

                matchedVariable =
                    candidate;

                matchedValue =
                    source[
                        candidate
                    ];

                break;
            }
        }

        /**
         * `allOf` requires every variable.
         */
        if (
            definition.allOf.length >
            0
        ) {

            const missing =
                definition.allOf.filter(
                    variable =>
                        !isPresent(
                            source[
                                variable
                            ],
                            this.options,
                        ),
                );

            if (
                missing.length >
                0
            ) {

                return this.buildCheck(
                    definition,
                    {
                        status:
                            REQUIREMENT_STATUSES
                                .MISSING,

                        environment,

                        missingVariables:
                            missing,
                    },
                );
            }

            return this.buildCheck(
                definition,
                {
                    status:
                        REQUIREMENT_STATUSES
                            .SATISFIED,

                    environment,

                    matchedVariable:
                        definition.allOf.join(
                            ',',
                        ),
                },
            );
        }

        /**
         * Any valid candidate satisfies the requirement.
         */
        if (
            matchedVariable
        ) {

            let validation =
                null;

            if (
                definition.validate
            ) {

                try {

                    const valid =
                        definition.validate(
                            matchedValue,
                            {
                                environment,

                                variable:
                                    matchedVariable,

                                config:
                                    source,
                            },
                        );

                    if (
                        valid !==
                        true
                    ) {

                        validation = {
                            status:
                                REQUIREMENT_STATUSES
                                    .INVALID,

                            validationError:
                                typeof valid ===
                                    'string'
                                    ? valid
                                    : 'Variable failed custom requirement validation.',
                        };

                    }

                } catch (
                    error
                ) {

                    validation = {
                        status:
                            REQUIREMENT_STATUSES
                                .INVALID,

                        validationError:
                            error.message,
                    };
                }
            }

            if (
                validation
            ) {

                return this.buildCheck(
                    definition,
                    {
                        status:
                            validation.status,

                        environment,

                        matchedVariable,

                        matchedValue,

                        validationError:
                            validation.validationError,
                    },
                );
            }

            return this.buildCheck(
                definition,
                {
                    status:
                        definition.type ===
                        REQUIREMENT_TYPES
                            .CONDITIONAL
                            ? REQUIREMENT_STATUSES
                                .SATISFIED
                            : REQUIREMENT_STATUSES
                                .PRESENT,

                    environment,

                    matchedVariable,

                    matchedValue,
                },
            );
        }

        /**
         * Default can satisfy optional/defaultable definitions.
         */
        if (
            definition.default !==
            undefined
        ) {

            return this.buildCheck(
                definition,
                {
                    status:
                        REQUIREMENT_STATUSES
                            .SATISFIED,

                    environment,

                    matchedVariable:
                        null,

                    defaultUsed:
                        true,
                },
            );
        }

        /**
         * Optional definitions do not block readiness.
         */
        if (
            definition.type ===
                REQUIREMENT_TYPES.OPTIONAL ||
            (
                definition.severity ===
                SEVERITIES.WARNING
            )
        ) {

            return this.buildCheck(
                definition,
                {
                    status:
                        REQUIREMENT_STATUSES
                            .MISSING,

                    environment,

                    severity:
                        SEVERITIES.WARNING,
                },
            );
        }

        return this.buildCheck(
            definition,
            {
                status:
                    REQUIREMENT_STATUSES
                        .MISSING,

                environment,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Alternative groups.
     * -------------------------------------------------------------------------
     */

    collectAlternativeGroups() {

        const groups =
            new Map();

        for (
            const definition of
            this.definitions.values()
        ) {

            if (
                definition.type !==
                    REQUIREMENT_TYPES
                        .ALTERNATIVE ||
                definition.anyOf.length ===
                    0
            ) {

                continue;
            }

            const key =
                definition.name ||
                definition.anyOf.join(
                    '|',
                );

            if (
                !groups.has(
                    key,
                )
            ) {

                groups.set(
                    key,
                    {
                        name:
                            key,

                        variables:
                            [
                                ...definition
                                    .anyOf,
                            ],

                        severity:
                            definition
                                .severity,

                        description:
                            definition
                                .description,
                    },
                );
            }
        }

        return [
            ...groups.values(),
        ];
    }

    evaluateAlternativeGroup(
        group,
        source,
        environment,
    ) {

        const present =
            group.variables.filter(
                variable =>
                    isPresent(
                        source[
                            variable
                        ],
                        this.options,
                    ),
            );

        if (
            present.length >
            0
        ) {

            return {
                name:
                    group.name,

                variable:
                    null,

                type:
                    REQUIREMENT_TYPES
                        .ALTERNATIVE,

                status:
                    REQUIREMENT_STATUSES
                        .SATISFIED,

                severity:
                    group.severity,

                environment,

                candidateVariables:
                    [
                        ...group.variables,
                    ],

                matchedVariables:
                    present,

                description:
                    group.description,

                timestamp:
                    new Date().toISOString(),
            };
        }

        return {
            name:
                group.name,

            variable:
                null,

            type:
                REQUIREMENT_TYPES
                    .ALTERNATIVE,

            status:
                REQUIREMENT_STATUSES
                    .MISSING,

            severity:
                group.severity,

            environment,

            candidateVariables:
                [
                    ...group.variables,
                ],

            matchedVariables:
                [],

            description:
                group.description,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Dependency evaluation.
     * -------------------------------------------------------------------------
     */

    evaluateDependencies(
        source,
        checks,
        environment,
    ) {

        const results = [];

        for (
            const definition of
            this.definitions.values()
        ) {

            if (
                definition.dependsOn.length ===
                0
            ) {

                continue;
            }

            const requirementSatisfied =
                checks.find(
                    check =>
                        check.name ===
                        definition.name,
                );

            if (
                !requirementSatisfied ||
                !(
                    requirementSatisfied.status ===
                    REQUIREMENT_STATUSES
                        .PRESENT ||
                    requirementSatisfied.status ===
                        REQUIREMENT_STATUSES
                            .SATISFIED
                )
            ) {

                continue;
            }

            const missingDependencies =
                definition.dependsOn.filter(
                    dependency =>
                        !isPresent(
                            source[
                                dependency
                            ],
                            this.options,
                        ),
                );

            if (
                missingDependencies.length >
                0
            ) {

                results.push(
                    {
                        name:
                            `${definition.name}.dependencies`,

                        variable:
                            definition.variable,

                        type:
                            REQUIREMENT_TYPES
                                .CONDITIONAL,

                        status:
                            REQUIREMENT_STATUSES
                                .UNSATISFIED,

                        severity:
                            definition.severity,

                        environment,

                        missingVariables:
                            missingDependencies,

                        description:
                            `Dependencies required by "${definition.name}" are missing.`,

                        timestamp:
                            new Date().toISOString(),
                    },
                );
            }
        }

        return results;
    }

    /**
     * -------------------------------------------------------------------------
     * Build check.
     * -------------------------------------------------------------------------
     */

    buildCheck(
        definition,
        values = {},
    ) {

        return {
            name:
                definition.name,

            variable:
                definition.variable,

            type:
                definition.type,

            status:
                values.status ||
                REQUIREMENT_STATUSES
                    .MISSING,

            severity:
                values.severity ||
                definition.severity,

            environment:
                values.environment ||
                null,

            matchedVariable:
                values.matchedVariable ||
                null,

            defaultUsed:
                values.defaultUsed ===
                true,

            missingVariables:
                values.missingVariables ||
                [],

            validationError:
                values.validationError ||
                null,

            description:
                definition.description,

            aliases:
                definition.aliases,

            candidateVariables:
                definition.getCandidateVariables(),

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Safe diagnostics.
     * -------------------------------------------------------------------------
     */

    toSafeDiagnostic(
        check,
        source,
    ) {

        const variable =
            check.matchedVariable ||
            check.variable ||
            null;

        const result = {
            ...clone(
                check,
            ),
        };

        if (
            variable &&
            Object.prototype.hasOwnProperty.call(
                source,
                variable,
            )
        ) {

            const value =
                source[
                    variable
                ];

            result.present =
                isPresent(
                    value,
                    this.options,
                );

            result.valueFingerprint =
                fingerprint(
                    value,
                    this.options
                        .fingerprintAlgorithm,
                );

            if (
                isSensitive(
                    variable,
                    this.options,
                )
            ) {

                result.value =
                    '[REDACTED]';

            } else {

                result.value =
                    value;
            }

        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint payload.
     * -------------------------------------------------------------------------
     */

    buildFingerprintPayload(
        environment,
        checks,
    ) {

        return {
            environment,

            checks:
                checks.map(
                    check => ({
                        name:
                            check.name,

                        variable:
                            check.variable,

                        type:
                            check.type,

                        status:
                            check.status,

                        severity:
                            check.severity,

                        aliases:
                            check.aliases,
                    }),
                ),

            policy:
                this.getPolicy(
                    environment,
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Environment policy.
     * -------------------------------------------------------------------------
     */

    getPolicy(
        environment =
            ENVIRONMENTS.DEVELOPMENT,
    ) {

        const normalized =
            normalizeEnvironment(
                environment,
            );

        const definitions =
            [
                ...this.definitions.values(),
            ]
            .filter(
                definition =>
                    definition.isApplicable(
                        normalized,
                        {},
                    ),
            )
            .map(
                definition =>
                    definition.toJSON(),
            );

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                normalized,

            definitions,

            count:
                definitions.length,

            fingerprint: {
                algorithm:
                    this.options
                        .fingerprintAlgorithm,

                value:
                    fingerprint(
                        {
                            environment:
                                normalized,

                            definitions,
                        },
                        this.options
                            .fingerprintAlgorithm,
                    ),
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

        const result =
            this.lastResult;

        return {
            status:
                result?.ready
                    ? result.status
                    : 'not_ready',

            ready:
                Boolean(
                    result?.ready,
                ),

            state:
                this.state,

            environment:
                result?.environment ||
                null,

            missing:
                result?.summary
                    ?.missing ||
                0,

            invalid:
                result?.summary
                    ?.invalid ||
                0,

            warnings:
                result?.summary
                    ?.warnings ||
                0,

            fingerprint:
                result?.fingerprint
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

        const readiness =
            this.readiness();

        return {
            status:
                readiness.ready
                    ? readiness.status ===
                      'degraded'
                        ? 'degraded'
                        : 'healthy'
                    : 'unhealthy',

            healthy:
                readiness.ready,

            degraded:
                readiness.ready &&
                readiness.status ===
                    'degraded',

            state:
                this.state,

            environment:
                readiness.environment,

            missing:
                readiness.missing,

            invalid:
                readiness.invalid,

            warnings:
                readiness.warnings,

            timestamp:
                new Date().toISOString(),
        };
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

            definitionCount:
                this.definitions.size,

            definitions:
                [
                    ...this.definitions.values(),
                ].map(
                    definition =>
                        definition.toJSON(),
                ),

            policyDevelopment:
                this.getPolicy(
                    ENVIRONMENTS.DEVELOPMENT,
                ),

            policyTest:
                this.getPolicy(
                    ENVIRONMENTS.TEST,
                ),

            policyStaging:
                this.getPolicy(
                    ENVIRONMENTS.STAGING,
                ),

            policyProduction:
                this.getPolicy(
                    ENVIRONMENTS.PRODUCTION,
                ),

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
                ...clone(
                    event,
                ),

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

        this.state =
            'created';

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
 * Canonical TITech environment policy
 * =============================================================================
 *
 * These definitions intentionally describe policy rather than connectivity.
 * Infrastructure modules remain responsible for establishing connections.
 * =============================================================================
 */

function registerCanonicalRequirements(
    registry,
) {

    registry.registerMany([
        /**
         * ---------------------------------------------------------------------
         * Core runtime
         * ---------------------------------------------------------------------
         */

        {
            name:
                'node-environment',

            variable:
                'NODE_ENV',

            description:
                'TITech runtime environment identifier.',

            type:
                REQUIREMENT_TYPES.REQUIRED,

            severity:
                SEVERITIES.CRITICAL,

            requiredIn:
                [
                    ENVIRONMENTS.DEVELOPMENT,
                    ENVIRONMENTS.TEST,
                    ENVIRONMENTS.STAGING,
                    ENVIRONMENTS.PRODUCTION,
                ],
        },

        {
            name:
                'service-name',

            variable:
                'SERVICE_NAME',

            description:
                'Canonical TITech backend service identity.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            default:
                'titech-backend',
        },

        {
            name:
                'application-name',

            variable:
                'APP_NAME',

            description:
                'Canonical TITech application identity.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            default:
                'titech-community-capital',
        },

        {
            name:
                'application-version',

            variable:
                'APP_VERSION',

            description:
                'TITech application release version.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,
        },

        {
            name:
                'port',

            variable:
                'PORT',

            description:
                'HTTP service listening port.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            default:
                '5000',
        },

        /**
         * ---------------------------------------------------------------------
         * Database
         * ---------------------------------------------------------------------
         *
         * Either MONGO_URI or MONGO_URI_FALLBACK may satisfy the connection
         * configuration requirement.
         */

        {
            name:
                'mongodb-connection',

            type:
                REQUIREMENT_TYPES.ALTERNATIVE,

            anyOf:
                [
                    'MONGO_URI',
                    'MONGO_URI_FALLBACK',
                ],

            description:
                'At least one TITech MongoDB connection URI.',

            severity:
                SEVERITIES.ERROR,

            requiredIn:
                [
                    ENVIRONMENTS.STAGING,
                    ENVIRONMENTS.PRODUCTION,
                ],
        },

        {
            name:
                'mongodb-primary',

            variable:
                'MONGO_URI',

            aliases:
                [
                    'MONGODB_URI',
                    'DATABASE_URL',
                ],

            description:
                'Primary TITech MongoDB connection URI.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                ],
        },

        {
            name:
                'mongodb-fallback',

            variable:
                'MONGO_URI_FALLBACK',

            aliases:
                [
                    'MONGODB_FALLBACK_URI',
                ],

            description:
                'TITech fallback MongoDB connection URI.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            requiredIn:
                [
                    ENVIRONMENTS.DEVELOPMENT,
                ],
        },

        /**
         * ---------------------------------------------------------------------
         * Redis
         * ---------------------------------------------------------------------
         */

        {
            name:
                'redis-connection',

            type:
                REQUIREMENT_TYPES.ALTERNATIVE,

            anyOf:
                [
                    'REDIS_URL',
                    'REDIS_HOST',
                ],

            description:
                'Redis must be configured when a Redis-backed subsystem is enabled.',

            severity:
                SEVERITIES.ERROR,

            condition:
                {
                    any:
                        [
                            {
                                variable:
                                    'ENABLE_REDIS',
                                truthy:
                                    true,
                            },

                            {
                                variable:
                                    'REDIS_ENABLED',
                                truthy:
                                    true,
                            },

                            {
                                variable:
                                    'ENABLE_IDEMPOTENCY',
                                truthy:
                                    true,
                            },

                            {
                                variable:
                                    'IDEMPOTENCY_ENABLED',
                                truthy:
                                    true,
                            },
                        ],
                },
        },

        {
            name:
                'redis-port',

            variable:
                'REDIS_PORT',

            description:
                'Redis TCP port when host-based configuration is used.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            default:
                '6379',

            condition:
                {
                    variable:
                        'REDIS_HOST',
                    truthy:
                        true,
                },
        },

        /**
         * ---------------------------------------------------------------------
         * Authentication / JWT
         * ---------------------------------------------------------------------
         */

        {
            name:
                'jwt-secret',

            variable:
                'JWT_SECRET',

            aliases:
                [
                    'JWT_SIGNING_SECRET',
                    'AUTH_JWT_SECRET',
                ],

            description:
                'TITech JWT signing secret.',

            type:
                REQUIREMENT_TYPES.REQUIRED,

            severity:
                SEVERITIES.CRITICAL,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                    ENVIRONMENTS.STAGING,
                ],
        },

        {
            name:
                'jwt-expiration',

            variable:
                'JWT_EXPIRES_IN',

            aliases:
                [
                    'JWT_EXPIRATION',
                    'JWT_EXPIRES',
                ],

            description:
                'TITech JWT token expiration policy.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            default:
                '1h',
        },

        /**
         * ---------------------------------------------------------------------
         * Security / cookies / CORS
         * ---------------------------------------------------------------------
         */

        {
            name:
                'secure-cookies',

            variable:
                'SECURE_COOKIES',

            description:
                'Secure cookie policy.',

            type:
                REQUIREMENT_TYPES.REQUIRED,

            severity:
                SEVERITIES.CRITICAL,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                ],
        },

        {
            name:
                'cors-origin',

            variable:
                'CORS_ORIGIN',

            aliases:
                [
                    'ALLOWED_ORIGINS',
                    'CORS_ORIGINS',
                ],

            description:
                'Trusted TITech API origins.',

            type:
                REQUIREMENT_TYPES.REQUIRED,

            severity:
                SEVERITIES.ERROR,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                    ENVIRONMENTS.STAGING,
                ],
        },

        /**
         * ---------------------------------------------------------------------
         * Tenant isolation
         * ---------------------------------------------------------------------
         */

        {
            name:
                'tenant-isolation',

            variable:
                'ENABLE_TENANT_ISOLATION',

            aliases:
                [
                    'TENANT_ISOLATION_ENABLED',
                ],

            description:
                'TITech tenant isolation control.',

            type:
                REQUIREMENT_TYPES.REQUIRED,

            severity:
                SEVERITIES.CRITICAL,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                ],

            validate:
                value =>
                    String(
                        value,
                    )
                        .trim()
                        .toLowerCase() ===
                    'true',
        },

        /**
         * ---------------------------------------------------------------------
         * Audit integrity
         * ---------------------------------------------------------------------
         */

        {
            name:
                'audit-logging',

            variable:
                'ENABLE_AUDIT_LOGGING',

            aliases:
                [
                    'AUDIT_LOGGING_ENABLED',
                ],

            description:
                'TITech audit logging control.',

            type:
                REQUIREMENT_TYPES.REQUIRED,

            severity:
                SEVERITIES.CRITICAL,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                ],

            validate:
                value =>
                    String(
                        value,
                    )
                        .trim()
                        .toLowerCase() ===
                    'true',
        },

        /**
         * ---------------------------------------------------------------------
         * Financial idempotency
         * ---------------------------------------------------------------------
         */

        {
            name:
                'financial-idempotency',

            variable:
                'ENABLE_IDEMPOTENCY',

            aliases:
                [
                    'IDEMPOTENCY_ENABLED',
                ],

            description:
                'TITech financial idempotency protection.',

            type:
                REQUIREMENT_TYPES.REQUIRED,

            severity:
                SEVERITIES.CRITICAL,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                ],

            validate:
                value =>
                    String(
                        value,
                    )
                        .trim()
                        .toLowerCase() ===
                    'true',

            dependsOn:
                [
                    'REDIS_URL',
                ],
        },

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
         */

        {
            name:
                'observability',

            variable:
                'OBSERVABILITY_ENABLED',

            description:
                'TITech observability subsystem.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            default:
                'true',
        },

        {
            name:
                'otel-service-name',

            variable:
                'OTEL_SERVICE_NAME',

            aliases:
                [
                    'SERVICE_NAME',
                ],

            description:
                'OpenTelemetry service identity.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            condition:
                {
                    variable:
                        'ENABLE_TRACING',
                    truthy:
                        true,
                },
        },

        /**
         * ---------------------------------------------------------------------
         * Mail
         * ---------------------------------------------------------------------
         */

        {
            name:
                'smtp-host',

            variable:
                'SMTP_HOST',

            aliases:
                [
                    'MAIL_HOST',
                    'SMTP_SERVER',
                ],

            description:
                'TITech SMTP host.',

            type:
                REQUIREMENT_TYPES.CONDITIONAL,

            severity:
                SEVERITIES.ERROR,

            condition:
                {
                    any:
                        [
                            {
                                variable:
                                    'ENABLE_EMAIL',
                                truthy:
                                    true,
                            },

                            {
                                variable:
                                    'MAIL_ENABLED',
                                truthy:
                                    true,
                            },
                        ],
                },
        },

        {
            name:
                'smtp-username',

            variable:
                'SMTP_USERNAME',

            aliases:
                [
                    'MAIL_USERNAME',
                ],

            description:
                'TITech SMTP authentication username.',

            type:
                REQUIREMENT_TYPES.CONDITIONAL,

            severity:
                SEVERITIES.ERROR,

            condition:
                {
                    variable:
                        'ENABLE_EMAIL',
                    truthy:
                        true,
                },
        },

        {
            name:
                'smtp-password',

            variable:
                'SMTP_PASSWORD',

            aliases:
                [
                    'MAIL_PASSWORD',
                ],

            description:
                'TITech SMTP authentication password.',

            type:
                REQUIREMENT_TYPES.CONDITIONAL,

            severity:
                SEVERITIES.ERROR,

            condition:
                {
                    variable:
                        'ENABLE_EMAIL',
                    truthy:
                        true,
                },
        },

        /**
         * ---------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------------
         */

        {
            name:
                'metrics-prefix',

            variable:
                'METRICS_PREFIX',

            description:
                'TITech Prometheus metric prefix.',

            type:
                REQUIREMENT_TYPES.OPTIONAL,

            severity:
                SEVERITIES.WARNING,

            default:
                'titech_',

            condition:
                {
                    variable:
                        'ENABLE_METRICS',
                    truthy:
                        true,
                },
        },

        /**
         * ---------------------------------------------------------------------
         * Encryption / application secret
         * ---------------------------------------------------------------------
         */

        {
            name:
                'encryption-key',

            variable:
                'ENCRYPTION_KEY',

            aliases:
                [
                    'APP_ENCRYPTION_KEY',
                ],

            description:
                'TITech application encryption key.',

            type:
                REQUIREMENT_TYPES.CONDITIONAL,

            severity:
                SEVERITIES.CRITICAL,

            requiredIn:
                [
                    ENVIRONMENTS.PRODUCTION,
                ],

            condition:
                {
                    variable:
                        'ENCRYPTION_ENABLED',
                    truthy:
                        true,
                },
        },
    ]);

    return registry;
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const requiredVariables =
    registerCanonicalRequirements(
        new RequiredVariables(),
    );

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function evaluate(
    environment,
    options,
) {

    return requiredVariables.evaluate(
        environment,
        options,
    );
}

function evaluateCurrent(
    options,
) {

    return requiredVariables.evaluate(
        process.env,
        options,
    );
}

function register(
    definition,
) {

    return requiredVariables.register(
        definition,
    );
}

function registerMany(
    definitions,
) {

    return requiredVariables.registerMany(
        definitions,
    );
}

function getPolicy(
    environment,
) {

    return requiredVariables.getPolicy(
        environment,
    );
}

function readiness() {

    return requiredVariables.readiness();
}

function health() {

    return requiredVariables.health();
}

function snapshot() {

    return requiredVariables.snapshot();
}

function reset() {

    requiredVariables.reset();

    return registerCanonicalRequirements(
        requiredVariables,
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
        requiredVariables,

        RequiredVariables,

        RequirementDefinition,

        RequiredVariablesError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ENVIRONMENTS,

        SUPPORTED_ENVIRONMENTS,

        REQUIREMENT_TYPES,

        REQUIREMENT_STATUSES,

        SEVERITIES,

        DEFAULTS,

        /**
         * Registry.
         */
        register,

        registerMany,

        get:
            name =>
                requiredVariables.get(
                    name,
                ),

        remove:
            name =>
                requiredVariables.remove(
                    name,
                ),

        clear:
            () =>
                requiredVariables.clear(),

        /**
         * Evaluation.
         */
        evaluate,

        evaluateCurrent,

        /**
         * Policy/operations.
         */
        getPolicy,

        readiness,

        health,

        snapshot,

        reset,

        /**
         * Utilities.
         */
        normalizeEnvironment,

        isSupportedEnvironment,

        isPresent,

        isEmpty,

        fingerprint,

        stableStringify,
    });