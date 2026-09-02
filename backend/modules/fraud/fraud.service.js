'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Risk Scoring Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/risk.service.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Deterministic, explainable, tenant-aware transaction risk scoring.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Deterministic transaction risk scoring
 * - Tenant-aware rule configuration
 * - Strict rule/weight validation
 * - Rule-based risk evaluation
 * - Risk decision classification
 * - Input validation and normalization
 * - Correlation ID propagation
 * - Scoring versioning
 * - Scoring configuration fingerprinting
 * - Input fingerprinting
 * - Explainable scoring
 * - Operational metrics hooks
 * - Structured logging
 * - Failure-safe diagnostics
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Transaction execution
 * - Ledger posting
 * - Payment processing
 * - AML case management
 * - Sanctions screening
 * - Account blocking
 * - Customer account mutation
 * - Financial balance mutation
 *
 * Architectural Boundary
 * ----------------------------------------------------------------------------
 *
 *                Transaction Request
 *                       │
 *                       ▼
 *              Input Normalization
 *                       │
 *                       ▼
 *              Canonical Fingerprint
 *                       │
 *                       ▼
 *              Versioned Rule Engine
 *                       │
 *             ┌─────────┴─────────┐
 *             ▼                   ▼
 *          Rule Evidence      Base Score
 *             │                   │
 *             └─────────┬─────────┘
 *                       ▼
 *                  Final Score
 *                       │
 *             ┌─────────┼─────────┐
 *             ▼         ▼         ▼
 *           APPROVE   REVIEW     BLOCK
 *
 * The service produces a decision.
 * Another subsystem is responsible for enforcing that decision.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROVIDER =
    'TITech Community Capital';

const SERVICE_NAME =
    'risk-scoring';

const SCORING_VERSION =
    'risk-v1';

const MAX_SCORE = 100;

const MIN_SCORE = 0;

const DECISIONS = Object.freeze({
    APPROVE: 'APPROVE',
    REVIEW: 'REVIEW',
    BLOCK: 'BLOCK',
});

const RISK_LEVELS = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
});

const RISK_RULES = Object.freeze({
    LARGE_TX_AMOUNT: 1_000_000,
    NEW_ACCOUNT_MINUTES: 60,
    HIGH_TX_COUNT: 5,
});

const RULE_WEIGHTS = Object.freeze({
    LARGE_TRANSACTION: 30,
    NEW_ACCOUNT: 25,
    HIGH_VELOCITY: 20,
    LOCATION_MISMATCH: 25,
});

const DECISION_THRESHOLDS = Object.freeze({
    APPROVE_MAX_EXCLUSIVE: 40,
    REVIEW_MAX_EXCLUSIVE: 80,
});

const RULE_CODES = Object.freeze([
    'LARGE_TRANSACTION',
    'NEW_ACCOUNT',
    'HIGH_TRANSACTION_VELOCITY',
    'LOCATION_MISMATCH',
]);

const REQUIRED_RULE_KEYS = Object.freeze([
    'LARGE_TX_AMOUNT',
    'NEW_ACCOUNT_MINUTES',
    'HIGH_TX_COUNT',
]);

const REQUIRED_WEIGHT_KEYS = Object.freeze([
    'LARGE_TRANSACTION',
    'NEW_ACCOUNT',
    'HIGH_VELOCITY',
    'LOCATION_MISMATCH',
]);

const DEFAULT_OPTIONS = Object.freeze({
    rules: RISK_RULES,
    weights: RULE_WEIGHTS,
    scoringVersion: SCORING_VERSION,
});

const MAX_TENANT_ID_LENGTH = 256;
const MAX_TRANSACTION_TYPE_LENGTH = 128;
const MAX_ACCOUNT_TYPE_LENGTH = 128;
const MAX_CURRENCY_LENGTH = 3;
const MAX_CORRELATION_ID_LENGTH = 256;

/**
 * ============================================================================
 * Safe Logger
 * ============================================================================
 */

let defaultLogger = console;

try {
    // eslint-disable-next-line global-require
    const importedLogger =
        require('../utils/logger');

    if (
        importedLogger &&
        (
            typeof importedLogger.info === 'function' ||
            typeof importedLogger.error === 'function' ||
            typeof importedLogger.warn === 'function'
        )
    ) {
        defaultLogger =
            importedLogger;
    }
} catch (error) {
    /**
     * Risk evaluation must never fail because optional logging is unavailable.
     */
    defaultLogger = console;
}

/**
 * ============================================================================
 * Runtime Statistics
 * ============================================================================
 *
 * Process-local telemetry only.
 *
 * These statistics are NOT authoritative financial/risk records and are not
 * safe to treat as durable metrics.
 * ============================================================================
 */

const statistics = {
    evaluations: 0,
    approved: 0,
    reviewed: 0,
    blocked: 0,
    failures: 0,
};

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function generateCorrelationId() {
    return crypto.randomUUID();
}

function isPlainObject(value) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function normalizeNumber(
    value,
    fallback = 0
) {
    if (
        typeof value === 'number'
    ) {
        return Number.isFinite(value)
            ? value
            : fallback;
    }

    if (
        typeof value === 'string' &&
        value.trim() !== ''
    ) {
        const parsed =
            Number(value);

        return Number.isFinite(parsed)
            ? parsed
            : fallback;
    }

    return fallback;
}

function normalizeBoolean(value) {
    if (
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        typeof value === 'string'
    ) {
        return [
            'true',
            '1',
            'yes',
            'y',
        ].includes(
            value.trim().toLowerCase()
        );
    }

    if (
        typeof value === 'number'
    ) {
        return value === 1;
    }

    return false;
}

function normalizeString(
    value,
    fallback = null
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        return fallback;
    }

    return value.trim();
}

function normalizeBoundedString(
    value,
    field,
    maxLength,
    fallback = null
) {
    const normalized =
        normalizeString(
            value,
            fallback
        );

    if (
        normalized === null
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeTenantId(
    value
) {
    const tenantId =
        normalizeBoundedString(
            value,
            'tenantId',
            MAX_TENANT_ID_LENGTH
        );

    if (!tenantId) {
        throw new TypeError(
            'tenantId is required'
        );
    }

    return tenantId;
}

function normalizeCorrelationId(
    value
) {
    const correlationId =
        normalizeBoundedString(
            value,
            'correlationId',
            MAX_CORRELATION_ID_LENGTH
        );

    return correlationId ||
        generateCorrelationId();
}

function clampScore(value) {
    const normalized =
        normalizeNumber(
            value,
            0
        );

    return Math.min(
        Math.max(
            normalized,
            MIN_SCORE
        ),
        MAX_SCORE
    );
}

function stableSerialize(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(stableSerialize)
            .join(',')}]`;
    }

    if (
        typeof value === 'object'
    ) {
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(
            value,
            'utf8'
        )
        .digest('hex');
}

/**
 * ============================================================================
 * Input Validation
 * ============================================================================
 */

function validateTransactionInput(
    data = {}
) {
    if (
        !isPlainObject(data)
    ) {
        throw new TypeError(
            'Risk evaluation input must be an object'
        );
    }

    /**
     * Tenant identity is mandatory for a production multi-tenant risk engine.
     *
     * The trusted tenant context should normally already have been established
     * by authentication/tenant middleware. This validation simply ensures that
     * the service never executes an unscoped tenant evaluation.
     */
    normalizeTenantId(
        data.tenantId
    );

    const amount =
        normalizeNumber(
            data.amount,
            NaN
        );

    if (
        !Number.isFinite(amount)
    ) {
        throw new TypeError(
            'amount must be a finite number'
        );
    }

    if (
        amount < 0
    ) {
        throw new RangeError(
            'amount cannot be negative'
        );
    }

    const userAgeMinutes =
        normalizeNumber(
            data.userAgeMinutes,
            0
        );

    if (
        !Number.isFinite(
            userAgeMinutes
        ) ||
        userAgeMinutes < 0
    ) {
        throw new RangeError(
            'userAgeMinutes must be a non-negative finite number'
        );
    }

    const transactionCount =
        normalizeNumber(
            data.transactionCount,
            0
        );

    if (
        !Number.isFinite(
            transactionCount
        ) ||
        transactionCount < 0
    ) {
        throw new RangeError(
            'transactionCount must be a non-negative finite number'
        );
    }

    if (
        data.currency !== undefined &&
        data.currency !== null
    ) {
        const currency =
            normalizeString(
                data.currency
            );

        if (
            !/^[A-Za-z]{3}$/.test(
                currency
            )
        ) {
            throw new TypeError(
                'currency must be a three-letter currency code'
            );
        }
    }

    if (
        data.transactionType !== undefined &&
        data.transactionType !== null
    ) {
        normalizeBoundedString(
            data.transactionType,
            'transactionType',
            MAX_TRANSACTION_TYPE_LENGTH
        );
    }

    if (
        data.accountType !== undefined &&
        data.accountType !== null
    ) {
        normalizeBoundedString(
            data.accountType,
            'accountType',
            MAX_ACCOUNT_TYPE_LENGTH
        );
    }

    if (
        data.correlationId !== undefined &&
        data.correlationId !== null
    ) {
        normalizeCorrelationId(
            data.correlationId
        );
    }

    return true;
}

/**
 * ============================================================================
 * Canonical Input
 * ============================================================================
 *
 * Only fields that participate in the scoring algorithm are included.
 *
 * This gives:
 *
 * same logical scoring inputs
 *        +
 * same scoring configuration
 *        =
 * same fingerprinted decision context
 *
 * Secrets, tokens, credentials and arbitrary request payloads are deliberately
 * excluded.
 * ============================================================================
 */

function buildCanonicalInput(
    data = {}
) {
    return {
        tenantId:
            normalizeTenantId(
                data.tenantId
            ),

        amount:
            normalizeNumber(
                data.amount
            ),

        userAgeMinutes:
            normalizeNumber(
                data.userAgeMinutes
            ),

        transactionCount:
            normalizeNumber(
                data.transactionCount
            ),

        locationMismatch:
            normalizeBoolean(
                data.locationMismatch
            ),

        currency:
            normalizeString(
                data.currency
            )?.toUpperCase() ||
            null,

        transactionType:
            normalizeBoundedString(
                data.transactionType,
                'transactionType',
                MAX_TRANSACTION_TYPE_LENGTH
            ),

        accountType:
            normalizeBoundedString(
                data.accountType,
                'accountType',
                MAX_ACCOUNT_TYPE_LENGTH
            ),
    };
}

/**
 * ============================================================================
 * Input Fingerprint
 * ============================================================================
 */

function createInputFingerprint(
    data
) {
    const canonical =
        isPlainObject(data) &&
        Object.prototype.hasOwnProperty.call(
            data,
            'tenantId'
        )
            ? buildCanonicalInput(data)
            : buildCanonicalInput({
                ...data,
                tenantId:
                    data?.tenantId
            });

    return sha256(
        stableSerialize(
            canonical
        )
    );
}

/**
 * ============================================================================
 * Configuration Validation
 * ============================================================================
 */

function assertFiniteNonNegative(
    value,
    field
) {
    const normalized =
        Number(value);

    if (
        !Number.isFinite(
            normalized
        ) ||
        normalized < 0
    ) {
        throw new TypeError(
            `${field} must be a non-negative finite number`
        );
    }

    return normalized;
}

function assertPositiveThreshold(
    value,
    field
) {
    const normalized =
        Number(value);

    if (
        !Number.isFinite(
            normalized
        ) ||
        normalized < 0
    ) {
        throw new TypeError(
            `${field} must be a non-negative finite number`
        );
    }

    return normalized;
}

function validateRuleConfiguration(
    rules
) {
    if (
        !isPlainObject(rules)
    ) {
        throw new TypeError(
            'Risk rules configuration must be an object'
        );
    }

    const normalized = {};

    for (
        const key of REQUIRED_RULE_KEYS
    ) {
        if (
            !Object.prototype.hasOwnProperty.call(
                rules,
                key
            )
        ) {
            throw new TypeError(
                `Missing risk rule: ${key}`
            );
        }

        normalized[key] =
            assertPositiveThreshold(
                rules[key],
                `rules.${key}`
            );
    }

    return Object.freeze(
        normalized
    );
}

function validateWeightConfiguration(
    weights
) {
    if (
        !isPlainObject(weights)
    ) {
        throw new TypeError(
            'Risk weights configuration must be an object'
        );
    }

    const normalized = {};

    for (
        const key of REQUIRED_WEIGHT_KEYS
    ) {
        if (
            !Object.prototype.hasOwnProperty.call(
                weights,
                key
            )
        ) {
            throw new TypeError(
                `Missing risk weight: ${key}`
            );
        }

        normalized[key] =
            assertFiniteNonNegative(
                weights[key],
                `weights.${key}`
            );
    }

    const totalWeight =
        Object.values(
            normalized
        ).reduce(
            (sum, value) =>
                sum + value,
            0
        );

    if (
        totalWeight <= 0
    ) {
        throw new RangeError(
            'Total risk rule weight must be greater than zero'
        );
    }

    return Object.freeze(
        normalized
    );
}

/**
 * ============================================================================
 * Configuration Fingerprint
 * ============================================================================
 *
 * Immutable fingerprint of:
 *
 * - scoring version
 * - thresholds
 * - weights
 * - decision thresholds
 *
 * This is essential for reproducing historical decisions after configuration
 * changes.
 * ============================================================================
 */

function createConfigurationFingerprint(
    configuration
) {
    return sha256(
        stableSerialize(
            configuration
        )
    );
}

/**
 * ============================================================================
 * Rule Configuration Resolution
 * ============================================================================
 */

function resolveConfiguration(
    options = {}
) {
    if (
        options === null ||
        typeof options !== 'object'
    ) {
        throw new TypeError(
            'Risk configuration options must be an object'
        );
    }

    const rules = {
        ...RISK_RULES,
        ...(options.rules || {}),
    };

    const weights = {
        ...RULE_WEIGHTS,
        ...(options.weights || {}),
    };

    const scoringVersion =
        normalizeBoundedString(
            options.scoringVersion ||
                SCORING_VERSION,
            'scoringVersion',
            128
        );

    if (
        !scoringVersion
    ) {
        throw new TypeError(
            'scoringVersion is required'
        );
    }

    const validatedRules =
        validateRuleConfiguration(
            rules
        );

    const validatedWeights =
        validateWeightConfiguration(
            weights
        );

    const configuration = {
        rules:
            validatedRules,

        weights:
            validatedWeights,

        scoringVersion,

        decisionThresholds: {
            ...DECISION_THRESHOLDS,
        },
    };

    return Object.freeze({
        ...configuration,

        configurationFingerprint:
            createConfigurationFingerprint(
                configuration
            ),
    });
}

/**
 * ============================================================================
 * Rule Evaluation
 * ============================================================================
 */

function evaluateRules({
    amount,
    userAgeMinutes,
    transactionCount,
    locationMismatch,
    rules,
    weights,
}) {
    const triggeredRules = [];

    let rawScore = 0;

    /**
     * Large transaction.
     */
    if (
        amount >
        rules.LARGE_TX_AMOUNT
    ) {
        const points =
            weights.LARGE_TRANSACTION;

        rawScore +=
            points;

        triggeredRules.push({
            code:
                'LARGE_TRANSACTION',

            category:
                'TRANSACTION_AMOUNT',

            points,

            evidence: {
                amount,

                threshold:
                    rules.LARGE_TX_AMOUNT,
            },

            reason:
                'Transaction amount exceeds configured threshold.',
        });
    }

    /**
     * New account.
     */
    if (
        userAgeMinutes <
        rules.NEW_ACCOUNT_MINUTES
    ) {
        const points =
            weights.NEW_ACCOUNT;

        rawScore +=
            points;

        triggeredRules.push({
            code:
                'NEW_ACCOUNT',

            category:
                'ACCOUNT_AGE',

            points,

            evidence: {
                userAgeMinutes,

                threshold:
                    rules.NEW_ACCOUNT_MINUTES,
            },

            reason:
                'Account age is below configured minimum.',
        });
    }

    /**
     * Transaction velocity.
     */
    if (
        transactionCount >
        rules.HIGH_TX_COUNT
    ) {
        const points =
            weights.HIGH_VELOCITY;

        rawScore +=
            points;

        triggeredRules.push({
            code:
                'HIGH_TRANSACTION_VELOCITY',

            category:
                'VELOCITY',

            points,

            evidence: {
                transactionCount,

                threshold:
                    rules.HIGH_TX_COUNT,
            },

            reason:
                'Transaction velocity exceeds configured threshold.',
        });
    }

    /**
     * Location mismatch.
     */
    if (
        locationMismatch
    ) {
        const points =
            weights.LOCATION_MISMATCH;

        rawScore +=
            points;

        triggeredRules.push({
            code:
                'LOCATION_MISMATCH',

            category:
                'LOCATION',

            points,

            evidence: {
                locationMismatch:
                    true,
            },

            reason:
                'Transaction location differs from expected location.',
        });
    }

    return {
        rawScore,

        score:
            clampScore(
                rawScore
            ),

        triggeredRules,
    };
}

/**
 * ============================================================================
 * Decision Engine
 * ============================================================================
 */

function getDecision(
    score,
    thresholds =
        DECISION_THRESHOLDS
) {
    const normalizedScore =
        clampScore(
            score
        );

    if (
        normalizedScore <
        thresholds.APPROVE_MAX_EXCLUSIVE
    ) {
        return DECISIONS.APPROVE;
    }

    if (
        normalizedScore <
        thresholds.REVIEW_MAX_EXCLUSIVE
    ) {
        return DECISIONS.REVIEW;
    }

    return DECISIONS.BLOCK;
}

/**
 * ============================================================================
 * Risk Classification
 * ============================================================================
 */

function getRiskLevel(
    score
) {
    const normalizedScore =
        clampScore(
            score
        );

    if (
        normalizedScore <
        DECISION_THRESHOLDS.APPROVE_MAX_EXCLUSIVE
    ) {
        return RISK_LEVELS.LOW;
    }

    if (
        normalizedScore <
        DECISION_THRESHOLDS.REVIEW_MAX_EXCLUSIVE
    ) {
        return RISK_LEVELS.MEDIUM;
    }

    return RISK_LEVELS.HIGH;
}

/**
 * ============================================================================
 * Metrics
 * ============================================================================
 *
 * Metrics failures are deliberately non-fatal.
 * ============================================================================
 */

function incrementMetric(
    metrics,
    logger,
    name,
    labels = {}
) {
    if (
        !metrics ||
        typeof metrics.counter !==
            'function'
    ) {
        return;
    }

    try {
        metrics.counter(
            name,
            labels
        );
    } catch (error) {
        logger?.warn?.({
            message:
                'Risk metrics publication failed',

            metric:
                name,

            error:
                error?.message,
        });
    }
}

/**
 * ============================================================================
 * Structured Logging
 * ============================================================================
 */

function logInfo(
    logger,
    payload
) {
    try {
        logger?.info?.(
            payload
        );
    } catch (error) {
        /**
         * Never allow logging infrastructure to change scoring behavior.
         */
    }
}

function logError(
    logger,
    payload
) {
    try {
        logger?.error?.(
            payload
        );
    } catch (error) {
        /**
         * Intentionally ignored.
         */
    }
}

/**
 * ============================================================================
 * Core Risk Calculation
 * ============================================================================
 *
 * Returns only the numeric score.
 *
 * This preserves the original API while using the same deterministic engine
 * as evaluateTransaction().
 * ============================================================================
 */

function calculateRiskScore(
    data = {},
    options = {}
) {
    validateTransactionInput(
        {
            ...data,

            /**
             * calculateRiskScore historically allowed a reduced payload.
             * Production service calls should still supply tenantId.
             */
            tenantId:
                data.tenantId
        }
    );

    const canonicalInput =
        buildCanonicalInput(
            data
        );

    const configuration =
        resolveConfiguration(
            options
        );

    const rulesResult =
        evaluateRules({
            amount:
                canonicalInput.amount,

            userAgeMinutes:
                canonicalInput.userAgeMinutes,

            transactionCount:
                canonicalInput.transactionCount,

            locationMismatch:
                canonicalInput.locationMismatch,

            rules:
                configuration.rules,

            weights:
                configuration.weights,
        });

    return rulesResult.score;
}

/**
 * ============================================================================
 * Full Transaction Evaluation
 * ============================================================================
 */

function evaluateTransaction(
    data = {},
    options = {}
) {
    const startedAt =
        Date.now();

    const correlationId =
        normalizeCorrelationId(
            data.correlationId
        );

    const evaluationLogger =
        options.logger ||
        defaultLogger;

    const evaluationMetrics =
        options.metrics ||
        null;

    statistics.evaluations++;

    try {
        validateTransactionInput(
            data
        );

        const canonicalInput =
            buildCanonicalInput(
                data
            );

        /**
         * Resolve and freeze the exact scoring configuration used for this
         * decision.
         */
        const configuration =
            resolveConfiguration(
                options
            );

        /**
         * Fingerprint the exact normalized scoring input.
         */
        const inputFingerprint =
            createInputFingerprint(
                canonicalInput
            );

        const rulesResult =
            evaluateRules({
                amount:
                    canonicalInput.amount,

                userAgeMinutes:
                    canonicalInput.userAgeMinutes,

                transactionCount:
                    canonicalInput.transactionCount,

                locationMismatch:
                    canonicalInput.locationMismatch,

                rules:
                    configuration.rules,

                weights:
                    configuration.weights,
            });

        const score =
            rulesResult.score;

        const decision =
            getDecision(
                score,
                configuration.decisionThresholds
            );

        const riskLevel =
            getRiskLevel(
                score
            );

        if (
            decision ===
            DECISIONS.APPROVE
        ) {
            statistics.approved++;
        } else if (
            decision ===
            DECISIONS.REVIEW
        ) {
            statistics.reviewed++;
        } else if (
            decision ===
            DECISIONS.BLOCK
        ) {
            statistics.blocked++;
        }

        const durationMs =
            Date.now() -
            startedAt;

        const evaluatedAt =
            new Date();

        /**
         * Base score explicitly represents the initial score before rule
         * contributions.
         */
        const baseScore = 0;

        const result = {
            provider:
                PROVIDER,

            service:
                SERVICE_NAME,

            scoringVersion:
                configuration.scoringVersion,

            configurationFingerprint:
                configuration.configurationFingerprint,

            correlationId,

            tenantId:
                canonicalInput.tenantId,

            inputFingerprint,

            baseScore,

            score,

            riskLevel,

            decision,

            triggeredRules:
                rulesResult.triggeredRules,

            ruleCount:
                rulesResult.triggeredRules.length,

            rawScore:
                rulesResult.rawScore,

            maxScore:
                MAX_SCORE,

            durationMs,

            evaluatedAt,
        };

        incrementMetric(
            evaluationMetrics,
            evaluationLogger,
            'risk_evaluations_total',
            {
                tenantId:
                    canonicalInput.tenantId,

                decision,

                riskLevel,

                scoringVersion:
                    configuration.scoringVersion,
            }
        );

        incrementMetric(
            evaluationMetrics,
            evaluationLogger,
            'risk_score_total',
            {
                decision,
                riskLevel,
            }
        );

        logInfo(
            evaluationLogger,
            {
                message:
                    'Risk transaction evaluated',

                component:
                    SERVICE_NAME,

                tenantId:
                    canonicalInput.tenantId,

                correlationId,

                scoringVersion:
                    configuration.scoringVersion,

                configurationFingerprint:
                    configuration.configurationFingerprint,

                inputFingerprint,

                score,

                riskLevel,

                decision,

                ruleCount:
                    rulesResult.triggeredRules.length,

                durationMs,
            }
        );

        return result;
    } catch (error) {
        statistics.failures++;

        incrementMetric(
            evaluationMetrics,
            evaluationLogger,
            'risk_evaluation_failures_total',
            {
                tenantId:
                    normalizeString(
                        data?.tenantId,
                        'unknown'
                    ),
            }
        );

        logError(
            evaluationLogger,
            {
                message:
                    'Risk evaluation failed',

                component:
                    SERVICE_NAME,

                tenantId:
                    normalizeString(
                        data?.tenantId
                    ),

                correlationId,

                error:
                    error?.message,

                errorName:
                    error?.name,

                durationMs:
                    Date.now() -
                    startedAt,
            }
        );

        throw error;
    }
}

/**
 * ============================================================================
 * Configuration Inspection
 * ============================================================================
 *
 * Returns the frozen scoring configuration without exposing mutable references.
 * ============================================================================
 */

function getScoringConfiguration(
    options = {}
) {
    const configuration =
        resolveConfiguration(
            options
        );

    return {
        scoringVersion:
            configuration.scoringVersion,

        configurationFingerprint:
            configuration.configurationFingerprint,

        rules: {
            ...configuration.rules,
        },

        weights: {
            ...configuration.weights,
        },

        decisionThresholds: {
            ...configuration.decisionThresholds,
        },
    };
}

/**
 * ============================================================================
 * Service Factory
 * ============================================================================
 *
 * Allows tenant/environment-specific configuration without changing the
 * service's public API.
 * ============================================================================
 */

function createRiskService({
    logger:
        serviceLogger = defaultLogger,

    metrics = null,

    configuration = {},
} = {}) {
    /**
     * Resolve once for deterministic service configuration.
     *
     * The resulting object is frozen by resolveConfiguration().
     */
    const resolvedConfiguration =
        resolveConfiguration(
            configuration
        );

    return Object.freeze({
        evaluateTransaction(
            data = {}
        ) {
            return evaluateTransaction(
                data,
                {
                    ...resolvedConfiguration,
                    logger:
                        serviceLogger,
                    metrics,
                }
            );
        },

        calculateRiskScore(
            data = {}
        ) {
            return calculateRiskScore(
                data,
                resolvedConfiguration
            );
        },

        getDecision,

        getRiskLevel,

        getConfiguration() {
            return getScoringConfiguration(
                resolvedConfiguration
            );
        },

        getScoringVersion() {
            return resolvedConfiguration
                .scoringVersion;
        },

        getConfigurationFingerprint() {
            return resolvedConfiguration
                .configurationFingerprint;
        },

        health() {
            return {
                provider:
                    PROVIDER,

                component:
                    SERVICE_NAME,

                status:
                    'UP',

                scoringVersion:
                    resolvedConfiguration.scoringVersion,

                configurationFingerprint:
                    resolvedConfiguration.configurationFingerprint,

                statistics: {
                    ...statistics,
                },
            };
        },

        stats() {
            return {
                ...statistics,
            };
        },
    });
}

/**
 * ============================================================================
 * Health
 * ============================================================================
 */

function health(
    options = {}
) {
    const configuration =
        resolveConfiguration(
            options
        );

    return {
        provider:
            PROVIDER,

        component:
            SERVICE_NAME,

        status:
            'UP',

        scoringVersion:
            configuration.scoringVersion,

        configurationFingerprint:
            configuration.configurationFingerprint,

        statistics: {
            ...statistics,
        },
    };
}

/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 */

function stats() {
    return {
        ...statistics,
    };
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {
    evaluateTransaction,

    calculateRiskScore,

    getDecision,

    getRiskLevel,

    validateTransactionInput,

    createInputFingerprint,

    buildCanonicalInput,

    createConfigurationFingerprint,

    createRiskService,

    resolveConfiguration,

    getScoringConfiguration,

    health,

    stats,

    RISK_RULES,

    RULE_WEIGHTS,

    DECISION_THRESHOLDS,

    DECISIONS,

    RISK_LEVELS,

    SCORING_VERSION,

    PROVIDER,
};