'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/precedenceRules.js
 *
 * Purpose:
 *   Enterprise production-grade environment/configuration precedence policy
 *   engine.
 *
 * Responsibilities:
 *   - Define canonical TITech environment configuration precedence.
 *   - Provide deterministic layer ordering.
 *   - Resolve competing configuration values.
 *   - Enforce protected/security-sensitive precedence rules.
 *   - Prevent untrusted layers from overriding protected configuration.
 *   - Support explicit per-path precedence policies.
 *   - Detect precedence conflicts and policy violations.
 *   - Produce explainable resolution decisions.
 *   - Produce immutable rule definitions and evaluation results.
 *   - Provide safe provenance and configuration fingerprints.
 *   - Integrate cleanly with layerMerger.js, namespaceBuilder.js and
 *     normalizeEnvironment.js.
 *
 * IMPORTANT:
 *
 *   This module defines PRECEDENCE POLICY.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - merge configuration objects itself.
 *     - normalize values.
 *     - validate complete configuration.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - start Express.
 *     - start the HTTP server.
 *     - execute financial transactions.
 *     - perform tenant authorization.
 *
 * Canonical consumers:
 *
 *   backend/config/environment/layerMerger.js
 *   backend/config/environment/namespaceBuilder.js
 *   backend/config/environment/normalizeEnvironment.js
 *
 * =============================================================================
 *
 * Canonical precedence model:
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
 *       ↓
 *   explicit
 *
 * Higher precedence may override lower precedence ONLY when the applicable
 * policy permits the override.
 *
 * Security-sensitive configuration is intentionally subject to stricter rules.
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
    'environment-precedence-rules';

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

const LAYERS =
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

const DECISIONS =
    Object.freeze({
        ACCEPT:
            'accept',

        REJECT:
            'reject',

        IGNORE:
            'ignore',

        CONFLICT:
            'conflict',

        SAME:
            'same',
    });

const DECISION_REASONS =
    Object.freeze({
        HIGHER_PRECEDENCE:
            'higher-precedence',

        LOWER_PRECEDENCE:
            'lower-precedence',

        SAME_VALUE:
            'same-value',

        PROTECTED_PATH:
            'protected-path',

        TRUSTED_LAYER_REQUIRED:
            'trusted-layer-required',

        RUNTIME_OVERRIDE_DISABLED:
            'runtime-override-disabled',

        EXPLICIT_OVERRIDE_REQUIRED:
            'explicit-override-required',

        ENVIRONMENT_LOCKED:
            'environment-locked',

        FINANCIAL_CONTROL:
            'financial-control',

        TENANT_ISOLATION:
            'tenant-isolation',

        AUDIT_INTEGRITY:
            'audit-integrity',

        SECURITY_POLICY:
            'security-policy',

        UNKNOWN_LAYER:
            'unknown-layer',

        INVALID_PATH:
            'invalid-path',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        allowUnknownLayers:
            false,

        allowRuntimeOverrides:
            true,

        allowExplicitOverrides:
            true,

        allowLocalOverrides:
            true,

        allowEnvironmentOverrides:
            true,

        allowBaseOverrides:
            true,

        detectConflicts:
            true,

        sameValueIsConflict:
            false,

        /**
         * Default canonical priority.
         */
        priorities:
            Object.freeze({
                defaults:
                    10,

                base:
                    20,

                environment:
                    30,

                local:
                    40,

                runtime:
                    50,

                explicit:
                    60,
            }),

        /**
         * A protected path may still be overridden if the incoming layer is
         * explicitly trusted by the rule.
         */
        protectedPaths:
            Object.freeze([
                'security.*',
                'security.authentication.*',
                'security.authorization.*',
                'security.cookies.*',
                'security.cors.*',
                'security.csrf.*',

                'crypto.*',
                'encryption.*',
                'credentials.*',
                'secrets.*',

                'jwt.secret',
                'jwt.signingKey',
                'jwt.privateKey',

                'database.uri',
                'database.password',
                'db.uri',
                'db.password',

                'redis.url',
                'redis.password',
                'redis.credentials.*',

                'tenantIsolation.*',
                'tenant.isolation.*',

                'financial.*',
                'financial.ledger.*',
                'financial.transaction.*',
                'financial.idempotency.*',

                'audit.integrity.*',
                'audit.signing.*',
                'audit.retention.*',
            ]),

        /**
         * These paths require explicit top-level governance regardless of layer
         * priority.
         */
        governancePaths:
            Object.freeze([
                'tenantIsolation.*',
                'financial.*',
                'audit.integrity.*',
                'security.*',
                'crypto.*',
            ]),

        /**
         * These paths are effectively locked from local developer overrides in
         * staging/production.
         */
        environmentLockedPaths:
            Object.freeze([
                'tenantIsolation.*',
                'financial.*',
                'audit.integrity.*',
                'security.authentication.*',
                'security.authorization.*',
            ]),

        /**
         * A runtime layer can modify operational values but must not silently
         * weaken security, financial or tenant boundaries.
         */
        runtimeProtectedPaths:
            Object.freeze([
                'tenantIsolation.*',
                'financial.*',
                'audit.integrity.*',
                'security.*',
                'crypto.*',
                'jwt.secret',
                'jwt.signingKey',
                'jwt.privateKey',
            ]),

        /**
         * Explicit override is required for these common high-risk values.
         */
        explicitOverridePaths:
            Object.freeze([
                'database.uri',
                'db.uri',
                'redis.url',
                'jwt.secret',
                'jwt.signingKey',
                'financial.*',
                'tenantIsolation.*',
                'security.*',
            ]),

        /**
         * Default trusted layers by environment.
         */
        trustedLayers:
            Object.freeze({
                development:
                    Object.freeze([
                        'defaults',
                        'base',
                        'environment',
                        'local',
                        'runtime',
                        'explicit',
                    ]),

                test:
                    Object.freeze([
                        'defaults',
                        'base',
                        'environment',
                        'runtime',
                        'explicit',
                    ]),

                staging:
                    Object.freeze([
                        'defaults',
                        'base',
                        'environment',
                        'runtime',
                        'explicit',
                    ]),

                production:
                    Object.freeze([
                        'defaults',
                        'base',
                        'environment',
                        'runtime',
                        'explicit',
                    ]),
            }),

        /**
         * Local overrides are deliberately blocked for high-risk production
         * paths.
         */
        localOverrideBlockedIn:
            Object.freeze([
                'staging',
                'production',
            ]),

        fingerprintAlgorithm:
            'sha256',

        maxRules:
            500,

        maxEvaluations:
            5_000,

        maxPathDepth:
            16,

        forbiddenKeys:
            Object.freeze([
                '__proto__',
                'prototype',
                'constructor',
            ]),

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt[_-]?secret|access[_-]?token|refresh[_-]?token|cookie|credential|signing[_-]?key)/i,
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class PrecedenceRulesError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'PrecedenceRulesError';

        this.code =
            options.code ||
            'ENVIRONMENT_PRECEDENCE_RULES_ERROR';

        this.path =
            options.path ||
            null;

        this.layer =
            options.layer ||
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
            PrecedenceRulesError,
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
            // Continue recursively.
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

function normalizeEnvironment(
    value,
) {

    return String(
        value ||
        ENVIRONMENTS.DEVELOPMENT,
    )
        .trim()
        .toLowerCase();
}

function isSupportedLayer(
    layer,
) {

    return Object.values(
        LAYERS,
    ).includes(
        layer,
    );
}

function normalizeLayer(
    layer,
) {

    return String(
        layer ||
        '',
    )
        .trim()
        .toLowerCase();
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

function isSensitive(
    path,
    options,
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

function pathMatchesPattern(
    path,
    pattern,
) {

    const pathParts =
        splitPath(
            path,
        );

    const patternParts =
        splitPath(
            pattern,
        );

    if (
        patternParts.length ===
        0
    ) {
        return false;
    }

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
        patternParts.length !==
        pathParts.length
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

function matchesAnyPattern(
    path,
    patterns,
) {

    return (
        Array.isArray(
            patterns,
        ) &&
        patterns.some(
            pattern =>
                pathMatchesPattern(
                    path,
                    pattern,
                ),
        )
    );
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
        // Policy engine remains logger-independent.
    }
}

/**
 * =============================================================================
 * Rule object
 * =============================================================================
 */

class PrecedenceRule {

    constructor(
        definition,
    ) {

        this.path =
            normalizePath(
                definition.path ||
                '*',
            );

        this.allow =
            definition.allow !==
            false;

        this.minimumLayer =
            definition.minimumLayer ||
            null;

        this.maximumLayer =
            definition.maximumLayer ||
            null;

        this.requiredLayer =
            definition.requiredLayer ||
            null;

        this.trustedLayers =
            Object.freeze([
                ...(
                    definition.trustedLayers ||
                    []
                ),
            ].map(
                normalizeLayer,
            ));

        this.blockedLayers =
            Object.freeze([
                ...(
                    definition.blockedLayers ||
                    []
                ).map(
                    normalizeLayer,
                ),
            ]);

        this.environments =
            Object.freeze([
                ...(
                    definition.environments ||
                    []
                ).map(
                    normalizeEnvironment,
                ),
            ]);

        this.reason =
            definition.reason ||
            null;

        this.metadata =
            Object.freeze({
                ...(definition.metadata || {}),
            });
    }

    matches(
        path,
        environment,
    ) {

        const pathMatch =
            pathMatchesPattern(
                path,
                this.path,
            );

        if (
            !pathMatch
        ) {
            return false;
        }

        if (
            this.environments.length >
                0 &&
            !this.environments.includes(
                normalizeEnvironment(
                    environment,
                ),
            )
        ) {
            return false;
        }

        return true;
    }

    toJSON() {

        return {
            path:
                this.path,

            allow:
                this.allow,

            minimumLayer:
                this.minimumLayer,

            maximumLayer:
                this.maximumLayer,

            requiredLayer:
                this.requiredLayer,

            trustedLayers:
                [...this.trustedLayers],

            blockedLayers:
                [...this.blockedLayers],

            environments:
                [...this.environments],

            reason:
                this.reason,

            metadata:
                clone(
                    this.metadata,
                ),
        };
    }
}

/**
 * =============================================================================
 * PrecedenceRules
 * =============================================================================
 */

class PrecedenceRules {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,

                priorities:
                    Object.freeze({
                        ...DEFAULTS.priorities,
                        ...(options.priorities || {}),
                    }),

                protectedPaths:
                    Object.freeze([
                        ...(
                            options.protectedPaths ||
                            DEFAULTS.protectedPaths
                        ),
                    ]),

                governancePaths:
                    Object.freeze([
                        ...(
                            options.governancePaths ||
                            DEFAULTS.governancePaths
                        ),
                    ]),

                environmentLockedPaths:
                    Object.freeze([
                        ...(
                            options.environmentLockedPaths ||
                            DEFAULTS.environmentLockedPaths
                        ),
                    ]),

                runtimeProtectedPaths:
                    Object.freeze([
                        ...(
                            options.runtimeProtectedPaths ||
                            DEFAULTS.runtimeProtectedPaths
                        ),
                    ]),

                explicitOverridePaths:
                    Object.freeze([
                        ...(
                            options.explicitOverridePaths ||
                            DEFAULTS.explicitOverridePaths
                        ),
                    ]),
            });

        this.state =
            'created';

        this.rules =
            [];

        this.evaluations =
            [];

        this.history =
            [];

        this.lastResult =
            null;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Register rule.
     * -------------------------------------------------------------------------
     */

    registerRule(
        definition,
    ) {

        if (
            this.rules.length >=
            this.options.maxRules
        ) {

            throw new PrecedenceRulesError(
                'TITech precedence rule limit exceeded.',
                {
                    code:
                        'PRECEDENCE_RULE_LIMIT_EXCEEDED',
                },
            );
        }

        const rule =
            definition instanceof
            PrecedenceRule
                ? definition
                : new PrecedenceRule(
                    definition,
                );

        this.assertSafePath(
            rule.path,
        );

        this.rules.push(
            rule,
        );

        return rule;
    }

    /**
     * -------------------------------------------------------------------------
     * Register many rules.
     * -------------------------------------------------------------------------
     */

    registerRules(
        definitions = [],
    ) {

        if (
            !Array.isArray(
                definitions,
            )
        ) {

            throw new PrecedenceRulesError(
                'TITech precedence rules must be an array.',
                {
                    code:
                        'PRECEDENCE_RULES_ARRAY_REQUIRED',
                },
            );
        }

        return definitions.map(
            definition =>
                this.registerRule(
                    definition,
                ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Clear custom rules.
     * -------------------------------------------------------------------------
     */

    clearRules() {

        this.rules.length =
            0;

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Layer priority.
     * -------------------------------------------------------------------------
     */

    getPriority(
        layer,
    ) {

        const normalized =
            normalizeLayer(
                layer,
            );

        if (
            !isSupportedLayer(
                normalized,
            )
        ) {

            if (
                !this.options
                    .allowUnknownLayers
            ) {

                throw new PrecedenceRulesError(
                    `Unknown TITech configuration layer "${normalized}".`,
                    {
                        code:
                            'UNKNOWN_CONFIGURATION_LAYER',

                        layer:
                            normalized,
                    },
                );
            }

            return 0;
        }

        return (
            this.options
                .priorities[
                    normalized
                ] ??
            0
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Compare layers.
     * -------------------------------------------------------------------------
     */

    compareLayers(
        left,
        right,
    ) {

        const leftPriority =
            this.getPriority(
                left,
            );

        const rightPriority =
            this.getPriority(
                right,
            );

        if (
            leftPriority >
            rightPriority
        ) {
            return 1;
        }

        if (
            leftPriority <
            rightPriority
        ) {
            return -1;
        }

        return 0;
    }

    /**
     * -------------------------------------------------------------------------
     * Determine stronger layer.
     * -------------------------------------------------------------------------
     */

    higherPrecedence(
        left,
        right,
    ) {

        return (
            this.compareLayers(
                left,
                right,
            ) >= 0
                ? normalizeLayer(
                    left,
                )
                : normalizeLayer(
                    right,
                )
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Determine if path is protected.
     * -------------------------------------------------------------------------
     */

    isProtectedPath(
        path,
    ) {

        return matchesAnyPattern(
            path,
            this.options
                .protectedPaths,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Determine if path is governance-sensitive.
     * -------------------------------------------------------------------------
     */

    isGovernancePath(
        path,
    ) {

        return matchesAnyPattern(
            path,
            this.options
                .governancePaths,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Determine if path is environment-locked.
     * -------------------------------------------------------------------------
     */

    isEnvironmentLockedPath(
        path,
        environment,
    ) {

        const normalizedEnvironment =
            normalizeEnvironment(
                environment,
            );

        if (
            !(
                normalizedEnvironment ===
                    ENVIRONMENTS.STAGING ||
                normalizedEnvironment ===
                    ENVIRONMENTS.PRODUCTION
            )
        ) {
            return false;
        }

        return matchesAnyPattern(
            path,
            this.options
                .environmentLockedPaths,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Determine if runtime is protected.
     * -------------------------------------------------------------------------
     */

    isRuntimeProtectedPath(
        path,
    ) {

        return matchesAnyPattern(
            path,
            this.options
                .runtimeProtectedPaths,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Determine if explicit override is required.
     * -------------------------------------------------------------------------
     */

    requiresExplicitOverride(
        path,
    ) {

        return matchesAnyPattern(
            path,
            this.options
                .explicitOverridePaths,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Trusted layer determination.
     * -------------------------------------------------------------------------
     */

    getTrustedLayers(
        environment,
    ) {

        const normalized =
            normalizeEnvironment(
                environment,
            );

        return [
            ...(
                this.options
                    .trustedLayers[
                        normalized
                    ] ||
                []
            ),
        ];
    }

    isTrustedLayer(
        layer,
        environment,
    ) {

        const normalizedLayer =
            normalizeLayer(
                layer,
            );

        return this
            .getTrustedLayers(
                environment,
            )
            .includes(
                normalizedLayer,
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Evaluate one candidate override.
     * -------------------------------------------------------------------------
     *
     * Inputs:
     *
     * {
     *   path: 'database.uri',
     *   currentLayer: 'environment',
     *   incomingLayer: 'runtime',
     *   environment: 'production',
     *   explicit: false
     * }
     * -------------------------------------------------------------------------
     */

    evaluate(
        {
            path,
            currentLayer,
            incomingLayer,
            environment =
                ENVIRONMENTS.DEVELOPMENT,
            explicit =
                false,
            trusted =
                false,
            currentValue,
            incomingValue,
        } = {},
    ) {

        const normalizedPath =
            normalizePath(
                path,
            );

        const current =
            normalizeLayer(
                currentLayer,
            );

        const incoming =
            normalizeLayer(
                incomingLayer,
            );

        const normalizedEnvironment =
            normalizeEnvironment(
                environment,
            );

        this.assertSafePath(
            normalizedPath,
        );

        this.assertLayer(
            current,
        );

        this.assertLayer(
            incoming,
        );

        const evaluation =
            this.evaluateInternal(
                {
                    path:
                        normalizedPath,

                    currentLayer:
                        current,

                    incomingLayer:
                        incoming,

                    environment:
                        normalizedEnvironment,

                    explicit,

                    trusted,

                    currentValue,

                    incomingValue,
                },
            );

        this.recordEvaluation(
            evaluation,
        );

        return deepFreeze(
            evaluation,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Internal evaluation engine.
     * -------------------------------------------------------------------------
     */

    evaluateInternal(
        context,
    ) {

        const {
            path,
            currentLayer,
            incomingLayer,
            environment,
            explicit,
            trusted,
            currentValue,
            incomingValue,
        } = context;

        /**
         * Same layer is not a precedence override.
         */
        if (
            currentLayer ===
            incomingLayer
        ) {

            const sameValue =
                valuesEqual(
                    currentValue,
                    incomingValue,
                );

            return this.buildDecision(
                {
                    decision:
                        sameValue
                            ? DECISIONS.SAME
                            : DECISIONS.CONFLICT,

                    reason:
                        sameValue
                            ? DECISION_REASONS.SAME_VALUE
                            : DECISION_REASONS
                                .LOWER_PRECEDENCE,

                    accepted:
                        sameValue,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,

                    currentValue,

                    incomingValue,
                },
            );
        }

        /**
         * Unknown/untrusted layers.
         */
        if (
            !isSupportedLayer(
                incomingLayer,
            ) &&
            !this.options
                .allowUnknownLayers
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .UNKNOWN_LAYER,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        /**
         * Explicit overrides are governed separately.
         */
        if (
            explicit &&
            !this.options
                .allowExplicitOverrides
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .EXPLICIT_OVERRIDE_REQUIRED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        /**
         * Runtime policy.
         */
        if (
            incomingLayer ===
            LAYERS.RUNTIME &&
            !this.options
                .allowRuntimeOverrides
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .RUNTIME_OVERRIDE_DISABLED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        /**
         * Local overrides in staging/production are restricted.
         */
        if (
            incomingLayer ===
                LAYERS.LOCAL &&
            this.options
                .localOverrideBlockedIn
                .includes(
                    environment,
                )
        ) {

            return this.evaluateBlockedLocalOverride(
                context,
            );
        }

        /**
         * Protected runtime path.
         */
        if (
            incomingLayer ===
                LAYERS.RUNTIME &&
            this.isRuntimeProtectedPath(
                path,
            ) &&
            !trusted &&
            !explicit
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .SECURITY_POLICY,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        /**
         * Protected/gov paths.
         */
        if (
            this.isProtectedPath(
                path,
            )
        ) {

            if (
                explicit
            ) {
                return this.evaluateProtectedExplicitOverride(
                    context,
                );
            }

            if (
                trusted
            ) {
                return this.evaluateTrustedOverride(
                    context,
                );
            }

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        this.getProtectedPathReason(
                            path,
                        ),

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        /**
         * Environment-locked governance values.
         */
        if (
            this.isEnvironmentLockedPath(
                path,
                environment,
            )
        ) {

            if (
                explicit ||
                trusted
            ) {
                return this.evaluateTrustedOverride(
                    context,
                );
            }

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .ENVIRONMENT_LOCKED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        /**
         * Custom path rules.
         */
        const customRule =
            this.findMatchingRule(
                path,
                environment,
            );

        if (
            customRule
        ) {

            return this.evaluateCustomRule(
                context,
                customRule,
            );
        }

        /**
         * Normal precedence resolution.
         */
        const comparison =
            this.compareLayers(
                incomingLayer,
                currentLayer,
            );

        if (
            comparison > 0
        ) {

            const sameValue =
                valuesEqual(
                    currentValue,
                    incomingValue,
                );

            if (
                sameValue
            ) {

                return this.buildDecision(
                    {
                        decision:
                            DECISIONS.SAME,

                        reason:
                            DECISION_REASONS
                                .SAME_VALUE,

                        accepted:
                            true,

                        path,

                        currentLayer,

                        incomingLayer,

                        environment,

                        currentValue,

                        incomingValue,
                    },
                );
            }

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.ACCEPT,

                    reason:
                        DECISION_REASONS
                            .HIGHER_PRECEDENCE,

                    accepted:
                        true,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,

                    currentValue,

                    incomingValue,
                },
            );
        }

        if (
            comparison ===
            0
        ) {

            const sameValue =
                valuesEqual(
                    currentValue,
                    incomingValue,
                );

            return this.buildDecision(
                {
                    decision:
                        sameValue
                            ? DECISIONS.SAME
                            : DECISIONS.CONFLICT,

                    reason:
                        sameValue
                            ? DECISION_REASONS
                                .SAME_VALUE
                            : DECISION_REASONS
                                .LOWER_PRECEDENCE,

                    accepted:
                        sameValue,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,

                    currentValue,

                    incomingValue,
                },
            );
        }

        return this.buildDecision(
            {
                decision:
                    DECISIONS.IGNORE,

                reason:
                    DECISION_REASONS
                        .LOWER_PRECEDENCE,

                accepted:
                    false,

                path,

                currentLayer,

                incomingLayer,

                environment,

                currentValue,

                incomingValue,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Local override handling.
     * -------------------------------------------------------------------------
     */

    evaluateBlockedLocalOverride(
        context,
    ) {

        const {
            path,
            currentLayer,
            incomingLayer,
            environment,
        } = context;

        if (
            this.isProtectedPath(
                path,
            ) ||
            this.isGovernancePath(
                path,
            ) ||
            this.requiresExplicitOverride(
                path,
            )
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .ENVIRONMENT_LOCKED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        /**
         * Non-sensitive local settings may still be permitted if explicitly
         * configured by the caller.
         */
        if (
            this.options
                .allowLocalOverrides
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.ACCEPT,

                    reason:
                        DECISION_REASONS
                            .HIGHER_PRECEDENCE,

                    accepted:
                        true,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        return this.buildDecision(
            {
                decision:
                    DECISIONS.REJECT,

                reason:
                    DECISION_REASONS
                        .ENVIRONMENT_LOCKED,

                accepted:
                    false,

                path,

                currentLayer,

                incomingLayer,

                environment,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Protected explicit override.
     * -------------------------------------------------------------------------
     */

    evaluateProtectedExplicitOverride(
        context,
    ) {

        const {
            path,
            currentLayer,
            incomingLayer,
            environment,
        } = context;

        if (
            !this.options
                .allowExplicitOverrides
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .EXPLICIT_OVERRIDE_REQUIRED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        return this.buildDecision(
            {
                decision:
                    DECISIONS.ACCEPT,

                reason:
                    DECISION_REASONS
                        .EXPLICIT_OVERRIDE_REQUIRED,

                accepted:
                    true,

                path,

                currentLayer,

                incomingLayer,

                environment,

                governanceOverride:
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Trusted override.
     * -------------------------------------------------------------------------
     */

    evaluateTrustedOverride(
        context,
    ) {

        const {
            path,
            currentLayer,
            incomingLayer,
            environment,
            trusted,
        } = context;

        if (
            !trusted &&
            !this.isTrustedLayer(
                incomingLayer,
                environment,
            )
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        DECISION_REASONS
                            .TRUSTED_LAYER_REQUIRED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        const comparison =
            this.compareLayers(
                incomingLayer,
                currentLayer,
            );

        if (
            comparison < 0
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.IGNORE,

                    reason:
                        DECISION_REASONS
                            .LOWER_PRECEDENCE,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        return this.buildDecision(
            {
                decision:
                    DECISIONS.ACCEPT,

                reason:
                    this.isGovernancePath(
                        path,
                    )
                        ? DECISION_REASONS
                            .FINANCIAL_CONTROL
                        : DECISION_REASONS
                            .HIGHER_PRECEDENCE,

                accepted:
                    true,

                path,

                currentLayer,

                incomingLayer,

                environment,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Custom rule.
     * -------------------------------------------------------------------------
     */

    findMatchingRule(
        path,
        environment,
    ) {

        /**
         * Most specific rule wins.
         */
        const matches =
            this.rules.filter(
                rule =>
                    rule.matches(
                        path,
                        environment,
                    ),
            );

        if (
            matches.length ===
            0
        ) {
            return null;
        }

        matches.sort(
            (
                left,
                right,
            ) =>
                splitPath(
                    right.path,
                ).length -
                splitPath(
                    left.path,
                ).length,
        );

        return matches[0];
    }

    evaluateCustomRule(
        context,
        rule,
    ) {

        const {
            path,
            currentLayer,
            incomingLayer,
            environment,
            trusted,
            explicit,
        } = context;

        if (
            !rule.allow
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        rule.reason ||
                        DECISION_REASONS
                            .SECURITY_POLICY,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        if (
            rule.blockedLayers.includes(
                incomingLayer,
            )
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        rule.reason ||
                        DECISION_REASONS
                            .SECURITY_POLICY,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        if (
            rule.requiredLayer &&
            incomingLayer !==
                rule.requiredLayer
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        rule.reason ||
                        DECISION_REASONS
                            .TRUSTED_LAYER_REQUIRED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        if (
            rule.trustedLayers.length >
                0 &&
            !rule.trustedLayers.includes(
                incomingLayer,
            ) &&
            !trusted &&
            !explicit
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        rule.reason ||
                        DECISION_REASONS
                            .TRUSTED_LAYER_REQUIRED,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        if (
            rule.minimumLayer &&
            this.compareLayers(
                incomingLayer,
                rule.minimumLayer,
            ) < 0
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        rule.reason ||
                        DECISION_REASONS
                            .LOWER_PRECEDENCE,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        if (
            rule.maximumLayer &&
            this.compareLayers(
                incomingLayer,
                rule.maximumLayer,
            ) > 0
        ) {

            return this.buildDecision(
                {
                    decision:
                        DECISIONS.REJECT,

                    reason:
                        rule.reason ||
                        DECISION_REASONS
                            .HIGHER_PRECEDENCE,

                    accepted:
                        false,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,
                },
            );
        }

        return this.evaluateNormalPrecedence(
            context,
            {
                customReason:
                    rule.reason,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Normal precedence helper.
     * -------------------------------------------------------------------------
     */

    evaluateNormalPrecedence(
        context,
        metadata = {},
    ) {

        const {
            path,
            currentLayer,
            incomingLayer,
            environment,
            currentValue,
            incomingValue,
        } = context;

        const comparison =
            this.compareLayers(
                incomingLayer,
                currentLayer,
            );

        if (
            comparison > 0
        ) {

            const same =
                valuesEqual(
                    currentValue,
                    incomingValue,
                );

            return this.buildDecision(
                {
                    decision:
                        same
                            ? DECISIONS.SAME
                            : DECISIONS.ACCEPT,

                    reason:
                        same
                            ? DECISION_REASONS
                                .SAME_VALUE
                            : metadata
                                .customReason ||
                              DECISION_REASONS
                                .HIGHER_PRECEDENCE,

                    accepted:
                        true,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,

                    currentValue,

                    incomingValue,
                },
            );
        }

        if (
            comparison ===
            0
        ) {

            const same =
                valuesEqual(
                    currentValue,
                    incomingValue,
                );

            return this.buildDecision(
                {
                    decision:
                        same
                            ? DECISIONS.SAME
                            : DECISIONS.CONFLICT,

                    reason:
                        same
                            ? DECISION_REASONS
                                .SAME_VALUE
                            : DECISION_REASONS
                                .LOWER_PRECEDENCE,

                    accepted:
                        same,

                    path,

                    currentLayer,

                    incomingLayer,

                    environment,

                    currentValue,

                    incomingValue,
                },
            );
        }

        return this.buildDecision(
            {
                decision:
                    DECISIONS.IGNORE,

                reason:
                    metadata.customReason ||
                    DECISION_REASONS
                        .LOWER_PRECEDENCE,

                accepted:
                    false,

                path,

                currentLayer,

                incomingLayer,

                environment,

                currentValue,

                incomingValue,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Build decision.
     * -------------------------------------------------------------------------
     */

    buildDecision(
        decision,
    ) {

        const safe = {
            decision:
                decision.decision,

            accepted:
                Boolean(
                    decision.accepted,
                ),

            reason:
                decision.reason ||
                null,

            path:
                decision.path,

            currentLayer:
                decision.currentLayer,

            incomingLayer:
                decision.incomingLayer,

            currentPriority:
                this.getPriority(
                    decision.currentLayer,
                ),

            incomingPriority:
                this.getPriority(
                    decision.incomingLayer,
                ),

            environment:
                decision.environment,

            governanceOverride:
                decision.governanceOverride ===
                true,

            timestamp:
                new Date().toISOString(),
        };

        /**
         * Values are fingerprinted rather than emitted.
         */
        if (
            decision.currentValue !==
            undefined
        ) {
            safe.currentValueFingerprint =
                fingerprint(
                    decision.currentValue,
                    this.options
                        .fingerprintAlgorithm,
                );
        }

        if (
            decision.incomingValue !==
            undefined
        ) {
            safe.incomingValueFingerprint =
                fingerprint(
                    decision.incomingValue,
                    this.options
                        .fingerprintAlgorithm,
                );
        }

        safe.sensitive =
            isSensitive(
                decision.path,
                this.options,
            );

        return safe;
    }

    /**
     * -------------------------------------------------------------------------
     * Bulk resolution.
     * -------------------------------------------------------------------------
     *
     * candidates:
     *
     * [
     *   {
     *     layer: 'defaults',
     *     value: ...
     *   },
     *   {
     *     layer: 'environment',
     *     value: ...
     *   }
     * ]
     *
     * -------------------------------------------------------------------------
     */

    resolve(
        {
            path,
            candidates = [],
            environment =
                ENVIRONMENTS.DEVELOPMENT,
            explicit =
                false,
            trustedLayers = [],
        } = {},
    ) {

        if (
            !Array.isArray(
                candidates,
            ) ||
            candidates.length ===
                0
        ) {

            throw new PrecedenceRulesError(
                'At least one configuration candidate is required.',
                {
                    code:
                        'PRECEDENCE_CANDIDATES_REQUIRED',

                    path,
                },
            );
        }

        if (
            candidates.length >
            this.options.maxEvaluations
        ) {

            throw new PrecedenceRulesError(
                'TITech precedence candidate limit exceeded.',
                {
                    code:
                        'PRECEDENCE_EVALUATION_LIMIT_EXCEEDED',

                    path,
                },
            );
        }

        const normalized =
            candidates.map(
                candidate => {

                    const layer =
                        normalizeLayer(
                            candidate.layer,
                        );

                    this.assertLayer(
                        layer,
                    );

                    return {
                        layer,

                        value:
                            candidate.value,

                        priority:
                            this.getPriority(
                                layer,
                            ),
                    };
                },
            );

        normalized.sort(
            (
                left,
                right,
            ) =>
                left.priority -
                right.priority,
        );

        let winner =
            normalized[0];

        const decisions =
            [];

        for (
            let index = 1;
            index < normalized.length;
            index += 1
        ) {

            const candidate =
                normalized[index];

            const trusted =
                trustedLayers.includes(
                    candidate.layer,
                );

            const decision =
                this.evaluate(
                    {
                        path,

                        currentLayer:
                            winner.layer,

                        incomingLayer:
                            candidate.layer,

                        environment,

                        explicit,

                        trusted,

                        currentValue:
                            winner.value,

                        incomingValue:
                            candidate.value,
                    },
                );

            decisions.push(
                decision,
            );

            if (
                decision.accepted
            ) {

                winner =
                    candidate;
            }
        }

        const result = {
            path:
                normalizePath(
                    path,
                ),

            environment:
                normalizeEnvironment(
                    environment,
                ),

            winner: {
                layer:
                    winner.layer,

                priority:
                    winner.priority,

                valueFingerprint:
                    fingerprint(
                        winner.value,
                        this.options
                            .fingerprintAlgorithm,
                    ),
            },

            candidates:
                normalized.map(
                    candidate => ({
                        layer:
                            candidate.layer,

                        priority:
                            candidate.priority,

                        valueFingerprint:
                            fingerprint(
                                candidate.value,
                                this.options
                                    .fingerprintAlgorithm,
                            ),
                    }),
                ),

            decisions,

            fingerprint:
                fingerprint(
                    {
                        path,

                        winner:
                            winner.layer,

                        environment:
                            normalizeEnvironment(
                                environment,
                            ),
                    },
                    this.options
                        .fingerprintAlgorithm,
                ),
        };

        this.lastResult =
            deepFreeze(
                result,
            );

        return this.lastResult;
    }

    /**
     * -------------------------------------------------------------------------
     * Standard environment ordering.
     * -------------------------------------------------------------------------
     */

    getOrderedLayers(
        {
            includeExplicit =
                this.options
                    .allowExplicitOverrides,
        } = {},
    ) {

        const layers = [
            LAYERS.DEFAULTS,
            LAYERS.BASE,
            LAYERS.ENVIRONMENT,
            LAYERS.LOCAL,
            LAYERS.RUNTIME,
        ];

        if (
            includeExplicit
        ) {
            layers.push(
                LAYERS.EXPLICIT,
            );
        }

        return Object.freeze(
            layers.map(
                layer => ({
                    layer,

                    priority:
                        this.getPriority(
                            layer,
                        ),
                }),
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Generate canonical policy.
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

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                normalized,

            orderedLayers:
                this.getOrderedLayers(),

            trustedLayers:
                this.getTrustedLayers(
                    normalized,
                ),

            protectedPaths:
                [
                    ...this.options
                        .protectedPaths,
                ],

            governancePaths:
                [
                    ...this.options
                        .governancePaths,
                ],

            environmentLockedPaths:
                [
                    ...this.options
                        .environmentLockedPaths,
                ],

            runtimeProtectedPaths:
                [
                    ...this.options
                        .runtimeProtectedPaths,
                ],

            explicitOverridePaths:
                [
                    ...this.options
                        .explicitOverridePaths,
                ],

            allowRuntimeOverrides:
                this.options
                    .allowRuntimeOverrides,

            allowExplicitOverrides:
                this.options
                    .allowExplicitOverrides,

            allowLocalOverrides:
                this.options
                    .allowLocalOverrides,

            fingerprint: {
                algorithm:
                    this.options
                        .fingerprintAlgorithm,

                value:
                    fingerprint(
                        {
                            environment:
                                normalized,

                            priorities:
                                this.options
                                    .priorities,

                            protectedPaths:
                                this.options
                                    .protectedPaths,

                            governancePaths:
                                this.options
                                    .governancePaths,

                            environmentLockedPaths:
                                this.options
                                    .environmentLockedPaths,

                            runtimeProtectedPaths:
                                this.options
                                    .runtimeProtectedPaths,

                            explicitOverridePaths:
                                this.options
                                    .explicitOverridePaths,
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
     * Rule validation.
     * -------------------------------------------------------------------------
     */

    validateRules() {

        const errors = [];

        for (
            const rule of
            this.rules
        ) {

            try {
                this.assertSafePath(
                    rule.path,
                );

                if (
                    rule.minimumLayer
                ) {
                    this.assertLayer(
                        rule.minimumLayer,
                    );
                }

                if (
                    rule.maximumLayer
                ) {
                    this.assertLayer(
                        rule.maximumLayer,
                    );
                }

                if (
                    rule.requiredLayer
                ) {
                    this.assertLayer(
                        rule.requiredLayer,
                    );
                }

                for (
                    const layer of
                    rule.trustedLayers
                ) {
                    this.assertLayer(
                        layer,
                    );
                }

                for (
                    const layer of
                    rule.blockedLayers
                ) {
                    this.assertLayer(
                        layer,
                    );
                }
            } catch (
                error
            ) {

                errors.push(
                    {
                        path:
                            rule.path,

                        code:
                            error.code ||
                            'INVALID_PRECEDENCE_RULE',

                        message:
                            error.message,
                    },
                );
            }
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
     * Assertions.
     * -------------------------------------------------------------------------
     */

    assertLayer(
        layer,
    ) {

        if (
            !isSupportedLayer(
                layer,
            )
        ) {

            throw new PrecedenceRulesError(
                `Unsupported TITech configuration layer "${layer}".`,
                {
                    code:
                        'INVALID_CONFIGURATION_LAYER',

                    layer,
                },
            );
        }
    }

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

            throw new PrecedenceRulesError(
                'Configuration precedence path is required.',
                {
                    code:
                        'PRECEDENCE_PATH_REQUIRED',
                },
            );
        }

        const parts =
            splitPath(
                normalized,
            );

        if (
            parts.length >
            this.options.maxPathDepth
        ) {

            throw new PrecedenceRulesError(
                'Configuration precedence path exceeds maximum depth.',
                {
                    code:
                        'PRECEDENCE_PATH_MAX_DEPTH_EXCEEDED',

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
                    this.options,
                )
            ) {

                throw new PrecedenceRulesError(
                    `Forbidden configuration precedence path "${normalized}".`,
                    {
                        code:
                            'PRECEDENCE_FORBIDDEN_PATH',

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
     * Evaluation history.
     * -------------------------------------------------------------------------
     */

    recordEvaluation(
        evaluation,
    ) {

        if (
            this.evaluations.length >=
            this.options.maxEvaluations
        ) {

            this.evaluations.shift();
        }

        this.evaluations.push(
            clone(
                evaluation,
            ),
        );

        return evaluation;
    }

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

            rules:
                this.rules.map(
                    rule =>
                        rule.toJSON(),
                ),

            policy:
                this.getPolicy(
                    ENVIRONMENTS.DEVELOPMENT,
                ),

            evaluations:
                this.evaluations
                    .slice(
                        -100,
                    )
                    .map(
                        clone,
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
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        const validation =
            this.validateRules();

        return {
            status:
                validation.valid
                    ? 'ready'
                    : 'not_ready',

            ready:
                validation.valid,

            state:
                this.state,

            ruleCount:
                this.rules.length,

            errors:
                validation.errors.length,

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

        const validation =
            this.validateRules();

        return {
            status:
                validation.valid
                    ? 'healthy'
                    : 'unhealthy',

            healthy:
                validation.valid,

            state:
                this.state,

            ruleCount:
                this.rules.length,

            errors:
                validation.errors.length,

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

        this.rules.length =
            0;

        this.evaluations.length =
            0;

        this.history.length =
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

const precedenceRules =
    new PrecedenceRules();

/**
 * =============================================================================
 * Register canonical enterprise rules
 * =============================================================================
 *
 * These rules express TITech's architectural expectations without embedding
 * application business logic into the policy engine.
 * =============================================================================
 */

precedenceRules.registerRules([
    {
        path:
            'security.*',

        minimumLayer:
            LAYERS.ENVIRONMENT,

        trustedLayers: [
            LAYERS.ENVIRONMENT,
            LAYERS.RUNTIME,
            LAYERS.EXPLICIT,
        ],

        reason:
            DECISION_REASONS
                .SECURITY_POLICY,
    },

    {
        path:
            'tenantIsolation.*',

        minimumLayer:
            LAYERS.ENVIRONMENT,

        trustedLayers: [
            LAYERS.ENVIRONMENT,
            LAYERS.EXPLICIT,
        ],

        reason:
            DECISION_REASONS
                .TENANT_ISOLATION,
    },

    {
        path:
            'financial.*',

        minimumLayer:
            LAYERS.ENVIRONMENT,

        trustedLayers: [
            LAYERS.ENVIRONMENT,
            LAYERS.EXPLICIT,
        ],

        reason:
            DECISION_REASONS
                .FINANCIAL_CONTROL,
    },

    {
        path:
            'audit.integrity.*',

        minimumLayer:
            LAYERS.ENVIRONMENT,

        trustedLayers: [
            LAYERS.ENVIRONMENT,
            LAYERS.EXPLICIT,
        ],

        reason:
            DECISION_REASONS
                .AUDIT_INTEGRITY,
    },

    {
        path:
            'jwt.secret',

        minimumLayer:
            LAYERS.ENVIRONMENT,

        requiredLayer:
            LAYERS.EXPLICIT,

        trustedLayers: [
            LAYERS.EXPLICIT,
        ],

        reason:
            DECISION_REASONS
                .SECURITY_POLICY,
    },

    {
        path:
            'jwt.signingKey',

        minimumLayer:
            LAYERS.ENVIRONMENT,

        requiredLayer:
            LAYERS.EXPLICIT,

        trustedLayers: [
            LAYERS.EXPLICIT,
        ],

        reason:
            DECISION_REASONS
                .SECURITY_POLICY,
    },
]);

/**
 * =============================================================================
 * Convenience functions
 * =============================================================================
 */

function getPriority(
    layer,
) {
    return precedenceRules.getPriority(
        layer,
    );
}

function compareLayers(
    left,
    right,
) {
    return precedenceRules.compareLayers(
        left,
        right,
    );
}

function evaluate(
    context,
) {
    return precedenceRules.evaluate(
        context,
    );
}

function resolve(
    context,
) {
    return precedenceRules.resolve(
        context,
    );
}

function getPolicy(
    environment,
) {
    return precedenceRules.getPolicy(
        environment,
    );
}

function getOrderedLayers(
    options,
) {
    return precedenceRules.getOrderedLayers(
        options,
    );
}

function isProtectedPath(
    path,
) {
    return precedenceRules.isProtectedPath(
        path,
    );
}

function isGovernancePath(
    path,
) {
    return precedenceRules.isGovernancePath(
        path,
    );
}

function requiresExplicitOverride(
    path,
) {
    return precedenceRules
        .requiresExplicitOverride(
            path,
        );
}

function isEnvironmentLockedPath(
    path,
    environment,
) {
    return precedenceRules
        .isEnvironmentLockedPath(
            path,
            environment,
        );
}

function isRuntimeProtectedPath(
    path,
) {
    return precedenceRules
        .isRuntimeProtectedPath(
            path,
        );
}

function validateRules() {
    return precedenceRules.validateRules();
}

function readiness() {
    return precedenceRules.readiness();
}

function health() {
    return precedenceRules.health();
}

function snapshot() {
    return precedenceRules.snapshot();
}

function reset() {
    return precedenceRules.reset();
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
        precedenceRules,

        PrecedenceRules,

        PrecedenceRule,

        PrecedenceRulesError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ENVIRONMENTS,

        LAYERS,

        DECISIONS,

        DECISION_REASONS,

        DEFAULTS,

        /**
         * Rules.
         */
        registerRule:
            definition =>
                precedenceRules.registerRule(
                    definition,
                ),

        registerRules:
            definitions =>
                precedenceRules.registerRules(
                    definitions,
                ),

        clearRules:
            () =>
                precedenceRules.clearRules(),

        validateRules,

        /**
         * Precedence.
         */
        getPriority,

        compareLayers,

        higherPrecedence:
            (
                left,
                right,
            ) =>
                precedenceRules.higherPrecedence(
                    left,
                    right,
                ),

        getTrustedLayers:
            environment =>
                precedenceRules.getTrustedLayers(
                    environment,
                ),

        isTrustedLayer:
            (
                layer,
                environment,
            ) =>
                precedenceRules.isTrustedLayer(
                    layer,
                    environment,
                ),

        /**
         * Path policy.
         */
        isProtectedPath,

        isGovernancePath,

        requiresExplicitOverride,

        isEnvironmentLockedPath,

        isRuntimeProtectedPath,

        pathMatchesPattern,

        /**
         * Evaluation.
         */
        evaluate,

        resolve,

        /**
         * Policy and diagnostics.
         */
        getPolicy,

        getOrderedLayers,

        readiness,

        health,

        snapshot,

        reset,

        /**
         * Utilities.
         */
        normalizeEnvironment,

        normalizeLayer,

        normalizePath,

        fingerprint,

        stableStringify,
    });