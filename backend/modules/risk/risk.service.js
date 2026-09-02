'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Risk Scoring Service
 * ============================================================================
 *
 * File:
 *   backend/modules/risk/risk.service.js
 *
 * Purpose
 * -------
 * Deterministic, tenant-aware risk scoring engine used by:
 *
 *   • FraudDetectionPipeline
 *   • LoanRiskProfile
 *   • FraudScreeningResult
 *   • ComplianceDecisionEngine
 *
 * Responsibilities
 * ----------------
 * • Deterministic transaction risk scoring
 * • Tenant-aware policy configuration
 * • Rule-based risk evaluation
 * • Base-score support
 * • Final-score calculation
 * • Risk decision classification
 * • Risk-level classification
 * • Input normalization/validation
 * • Correlation ID propagation
 * • Request identity propagation
 * • Scoring-versioning
 * • Input fingerprinting
 * • Explainable rule evidence
 * • Safe metrics/logging hooks
 * • Runtime diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Transaction execution
 * • Ledger posting
 * • Payment processing
 * • AML case management
 * • Sanctions screening
 * • KYC verification
 * • Account blocking persistence
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

const MAX_SCORE =
    100;

const MIN_SCORE =
    0;


/**
 * ============================================================================
 * Decisions
 * ============================================================================
 */

const DECISIONS = Object.freeze({

    APPROVE:
        'APPROVE',

    REVIEW:
        'REVIEW',

    BLOCK:
        'BLOCK'

});


/**
 * ============================================================================
 * Risk Levels
 * ============================================================================
 */

const RISK_LEVELS = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH'

});


/**
 * ============================================================================
 * Default Rules
 * ============================================================================
 */

const RISK_RULES = Object.freeze({

    LARGE_TX_AMOUNT:
        1_000_000,

    NEW_ACCOUNT_MINUTES:
        60,

    HIGH_TX_COUNT:
        5

});


/**
 * ============================================================================
 * Rule Weights
 * ============================================================================
 */

const RULE_WEIGHTS = Object.freeze({

    LARGE_TRANSACTION:
        30,

    NEW_ACCOUNT:
        25,

    HIGH_VELOCITY:
        20,

    LOCATION_MISMATCH:
        25

});


/**
 * ============================================================================
 * Decision Thresholds
 * ============================================================================
 */

const DECISION_THRESHOLDS = Object.freeze({

    APPROVE_MAX:
        39,

    REVIEW_MIN:
        40,

    REVIEW_MAX:
        79,

    BLOCK_MIN:
        80

});


/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULT_OPTIONS = Object.freeze({

    rules:
        RISK_RULES,

    weights:
        RULE_WEIGHTS,

    thresholds:
        DECISION_THRESHOLDS,

    scoringVersion:
        SCORING_VERSION,

    baseScore:
        0

});


/**
 * ============================================================================
 * Logger
 * ============================================================================
 */

let logger =
    console;

try {

    // eslint-disable-next-line global-require
    const importedLogger =
        require('../utils/logger');

    if (
        importedLogger
    ) {

        logger =
            importedLogger;

    }

}
catch (_) {

    logger =
        console;

}


/**
 * ============================================================================
 * Runtime Statistics
 * ============================================================================
 */

const statistics = {

    evaluations:
        0,

    successful:
        0,

    approved:
        0,

    reviewed:
        0,

    blocked:
        0,

    failures:
        0

};


/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

function generateCorrelationId() {

    return crypto.randomUUID();

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


function normalizeBoolean(
    value
) {

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
            'y'

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


function clampScore(
    score
) {

    return Math.min(

        MAX_SCORE,

        Math.max(
            MIN_SCORE,
            score
        )

    );

}


/**
 * ============================================================================
 * Stable Canonicalization
 * ============================================================================
 *
 * JSON.stringify() preserves insertion order. We explicitly sort keys so the
 * fingerprint does not depend on object construction order.
 * ============================================================================
 */

function sortCanonical(value) {

    if (
        value === null ||
        typeof value !== 'object'
    ) {

        return value;

    }

    if (
        Array.isArray(value)
    ) {

        return value.map(
            sortCanonical
        );

    }

    return Object.keys(value)
        .sort()
        .reduce(
            (
                output,
                key
            ) => {

                output[key] =
                    sortCanonical(
                        value[key]
                    );

                return output;

            },
            {}
        );

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
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
    ) {

        throw new TypeError(
            'Risk evaluation input must be an object'
        );

    }


    if (
        data.tenantId !== undefined &&
        data.tenantId !== null &&
        typeof data.tenantId !== 'string'
    ) {

        throw new TypeError(
            'tenantId must be a string'
        );

    }


    if (
        data.customerId !== undefined &&
        data.customerId !== null &&
        typeof data.customerId !== 'string'
    ) {

        throw new TypeError(
            'customerId must be a string'
        );

    }


    const amount =
        Number(
            data.amount ?? 0
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
        Number(
            data.userAgeMinutes ?? 0
        );

    if (
        !Number.isFinite(
            userAgeMinutes
        )
    ) {

        throw new TypeError(
            'userAgeMinutes must be a finite number'
        );

    }


    if (
        userAgeMinutes < 0
    ) {

        throw new RangeError(
            'userAgeMinutes cannot be negative'
        );

    }


    const transactionCount =
        Number(
            data.transactionCount ?? 0
        );

    if (
        !Number.isFinite(
            transactionCount
        )
    ) {

        throw new TypeError(
            'transactionCount must be a finite number'
        );

    }


    if (
        transactionCount < 0
    ) {

        throw new RangeError(
            'transactionCount cannot be negative'
        );

    }


    return true;

}


/**
 * ============================================================================
 * Canonical Input
 * ============================================================================
 */

function buildCanonicalInput(
    data = {}
) {

    return {

        tenantId:
            normalizeString(
                data.tenantId
            ),

        customerId:
            normalizeString(
                data.customerId
            ),

        transactionId:
            normalizeString(
                data.transactionId
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
            )?.toUpperCase() || null,

        transactionType:
            normalizeString(
                data.transactionType
            )?.toUpperCase() || null,

        accountType:
            normalizeString(
                data.accountType
            )?.toUpperCase() || null

    };

}


/**
 * ============================================================================
 * Input Fingerprint
 * ============================================================================
 */

function createInputFingerprint(
    data = {}
) {

    const canonical =
        sortCanonical(
            buildCanonicalInput(
                data
            )
        );


    return crypto

        .createHash(
            'sha256'
        )

        .update(
            JSON.stringify(
                canonical
            ),
            'utf8'
        )

        .digest(
            'hex'
        );

}


/**
 * ============================================================================
 * Configuration Validation
 * ============================================================================
 */

function validateConfiguration(
    options = {}
) {

    const configuration =
        options || {};


    const rules = {

        ...RISK_RULES,

        ...(configuration.rules || {})

    };


    const weights = {

        ...RULE_WEIGHTS,

        ...(configuration.weights || {})

    };


    const thresholds = {

        ...DECISION_THRESHOLDS,

        ...(configuration.thresholds || {})

    };


    const scoringVersion =
        normalizeString(
            configuration.scoringVersion,
            SCORING_VERSION
        );


    const baseScore =
        Number(
            configuration.baseScore ?? 0
        );


    if (
        !Number.isFinite(
            baseScore
        ) ||
        baseScore < MIN_SCORE ||
        baseScore > MAX_SCORE
    ) {

        throw new RangeError(
            'baseScore must be between 0 and 100'
        );

    }


    const numericRules = [

        'LARGE_TX_AMOUNT',
        'NEW_ACCOUNT_MINUTES',
        'HIGH_TX_COUNT'

    ];


    for (
        const rule
        of numericRules
    ) {

        const value =
            Number(
                rules[rule]
            );

        if (
            !Number.isFinite(value) ||
            value < 0
        ) {

            throw new RangeError(
                `Invalid risk rule: ${rule}`
            );

        }

    }


    const numericWeights = [

        'LARGE_TRANSACTION',
        'NEW_ACCOUNT',
        'HIGH_VELOCITY',
        'LOCATION_MISMATCH'

    ];


    for (
        const weight
        of numericWeights
    ) {

        const value =
            Number(
                weights[weight]
            );

        if (
            !Number.isFinite(value) ||
            value < 0
        ) {

            throw new RangeError(
                `Invalid risk weight: ${weight}`
            );

        }

    }


    const approveMax =
        Number(
            thresholds.APPROVE_MAX
        );

    const reviewMin =
        Number(
            thresholds.REVIEW_MIN
        );

    const reviewMax =
        Number(
            thresholds.REVIEW_MAX
        );

    const blockMin =
        Number(
            thresholds.BLOCK_MIN
        );


    if (
        !Number.isFinite(
            approveMax
        ) ||
        !Number.isFinite(
            reviewMin
        ) ||
        !Number.isFinite(
            reviewMax
        ) ||
        !Number.isFinite(
            blockMin
        )
    ) {

        throw new RangeError(
            'Risk decision thresholds must be finite numbers'
        );

    }


    if (
        approveMax < 0 ||
        reviewMin <= approveMax ||
        reviewMax < reviewMin ||
        blockMin <= reviewMax ||
        blockMin > MAX_SCORE
    ) {

        throw new RangeError(
            'Invalid risk decision threshold configuration'
        );

    }


    if (
        scoringVersion.length >
        128
    ) {

        throw new RangeError(
            'scoringVersion exceeds maximum length'
        );

    }


    return {

        rules,

        weights,

        thresholds: {

            APPROVE_MAX:
                approveMax,

            REVIEW_MIN:
                reviewMin,

            REVIEW_MAX:
                reviewMax,

            BLOCK_MIN:
                blockMin

        },

        scoringVersion,

        baseScore

    };

}


/**
 * ============================================================================
 * Rule Configuration Resolver
 * ============================================================================
 */

function resolveConfiguration(
    options = {}
) {

    return validateConfiguration(
        options
    );

}


/**
 * ============================================================================
 * Rule Evaluation
 * ============================================================================
 *
 * Returns the COMPLETE scoring result instead of only a number.
 *
 * This is the preferred internal API.
 * ============================================================================
 */

function evaluateRules({

    amount,

    userAgeMinutes,

    transactionCount,

    locationMismatch,

    baseScore,

    rules,

    weights

}) {

    const triggeredRules = [];

    let ruleScore =
        0;


    /**
     * -------------------------------------------------------------------------
     * Large Transaction
     * -------------------------------------------------------------------------
     */

    if (
        amount >
        rules.LARGE_TX_AMOUNT
    ) {

        const points =
            weights.LARGE_TRANSACTION;


        ruleScore += points;


        triggeredRules.push({

            code:
                'LARGE_TRANSACTION',

            category:
                'TRANSACTION_AMOUNT',

            points,

            severity:
                points >= 30
                    ? 'HIGH'
                    : 'MEDIUM',

            evidence: {

                amount,

                threshold:
                    rules.LARGE_TX_AMOUNT

            },

            reason:
                'Transaction amount exceeds configured threshold.'

        });

    }


    /**
     * -------------------------------------------------------------------------
     * New Account
     * -------------------------------------------------------------------------
     */

    if (
        userAgeMinutes <
        rules.NEW_ACCOUNT_MINUTES
    ) {

        const points =
            weights.NEW_ACCOUNT;


        ruleScore += points;


        triggeredRules.push({

            code:
                'NEW_ACCOUNT',

            category:
                'ACCOUNT_AGE',

            points,

            severity:
                points >= 25
                    ? 'HIGH'
                    : 'MEDIUM',

            evidence: {

                userAgeMinutes,

                threshold:
                    rules.NEW_ACCOUNT_MINUTES

            },

            reason:
                'Account age is below configured minimum.'

        });

    }


    /**
     * -------------------------------------------------------------------------
     * Transaction Velocity
     * -------------------------------------------------------------------------
     */

    if (
        transactionCount >
        rules.HIGH_TX_COUNT
    ) {

        const points =
            weights.HIGH_VELOCITY;


        ruleScore += points;


        triggeredRules.push({

            code:
                'HIGH_TRANSACTION_VELOCITY',

            category:
                'VELOCITY',

            points,

            severity:
                points >= 25
                    ? 'HIGH'
                    : 'MEDIUM',

            evidence: {

                transactionCount,

                threshold:
                    rules.HIGH_TX_COUNT

            },

            reason:
                'Transaction velocity exceeds configured threshold.'

        });

    }


    /**
     * -------------------------------------------------------------------------
     * Location Anomaly
     * -------------------------------------------------------------------------
     */

    if (
        locationMismatch
    ) {

        const points =
            weights.LOCATION_MISMATCH;


        ruleScore += points;


        triggeredRules.push({

            code:
                'LOCATION_MISMATCH',

            category:
                'LOCATION',

            points,

            severity:
                points >= 25
                    ? 'HIGH'
                    : 'MEDIUM',

            evidence: {

                locationMismatch:
                    true

            },

            reason:
                'Transaction location differs from expected location.'

        });

    }


    const rawScore =
        baseScore +
        ruleScore;


    const score =
        clampScore(
            rawScore
        );


    return {

        baseScore,

        ruleScore,

        rawScore,

        score,

        triggeredRules

    };

}


/**
 * ============================================================================
 * Full Risk Evaluation
 * ============================================================================
 */

function evaluateRisk(
    data = {},
    options = {}
) {

    const startedAt =
        Date.now();


    const correlationId =
        data.correlationId ||
        generateCorrelationId();


    statistics.evaluations++;


    try {

        validateTransactionInput(
            data
        );


        const configuration =
            resolveConfiguration(
                options
            );


        const canonicalInput =
            buildCanonicalInput(
                data
            );


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

                baseScore:
                    configuration.baseScore,

                rules:
                    configuration.rules,

                weights:
                    configuration.weights

            });


        const decision =
            getDecision(
                rulesResult.score,
                configuration
            );


        const riskLevel =
            getRiskLevel(
                rulesResult.score
            );


        const result = {

            provider:
                PROVIDER,

            service:
                SERVICE_NAME,

            scoringVersion:
                configuration.scoringVersion,

            correlationId,

            requestId:
                normalizeString(
                    data.requestId
                ),

            tenantId:
                canonicalInput.tenantId,

            customerId:
                canonicalInput.customerId,

            transactionId:
                canonicalInput.transactionId,

            idempotencyKey:
                normalizeString(
                    data.idempotencyKey
                ),

            inputFingerprint,

            baseScore:
                rulesResult.baseScore,

            ruleScore:
                rulesResult.ruleScore,

            rawScore:
                rulesResult.rawScore,

            score:
                rulesResult.score,

            riskLevel,

            decision,

            triggeredRules:
                rulesResult.triggeredRules,

            ruleCount:
                rulesResult.triggeredRules.length,

            durationMs:
                Date.now() -
                startedAt,

            evaluatedAt:
                new Date()

        };


        recordDecisionStatistics(
            decision
        );


        publishEvaluationMetrics(
            result,
            options
        );


        options.logger?.info?.({

            message:
                'Risk transaction evaluated',

            tenantId:
                result.tenantId,

            customerId:
                result.customerId,

            transactionId:
                result.transactionId,

            correlationId:
                result.correlationId,

            scoringVersion:
                result.scoringVersion,

            inputFingerprint:
                result.inputFingerprint,

            baseScore:
                result.baseScore,

            ruleScore:
                result.ruleScore,

            score:
                result.score,

            riskLevel:
                result.riskLevel,

            decision:
                result.decision,

            ruleCount:
                result.ruleCount,

            durationMs:
                result.durationMs

        });


        statistics.successful++;


        return result;

    }
    catch (error) {

        statistics.failures++;


        options.metrics?.counter?.(
            'risk_evaluation_failures_total'
        );


        options.logger?.error?.({

            message:
                'Risk evaluation failed',

            tenantId:
                data?.tenantId,

            customerId:
                data?.customerId,

            transactionId:
                data?.transactionId,

            correlationId,

            error:
                sanitizeError(
                    error
                )

        });


        throw error;

    }

}


/**
 * ============================================================================
 * Backward-Compatible Score Calculation
 * ============================================================================
 *
 * Existing consumers that expect:
 *
 *   calculateRiskScore(data) -> number
 *
 * continue to receive a number.
 * ============================================================================
 */

function calculateRiskScore(
    data = {},
    options = {}
) {

    return evaluateRisk(
        data,
        options
    ).score;

}


/**
 * ============================================================================
 * Full Score Calculation
 * ============================================================================
 *
 * New consumers should prefer this API.
 * ============================================================================
 */

function calculateRiskDetails(
    data = {},
    options = {}
) {

    return evaluateRisk(
        data,
        options
    );

}


/**
 * ============================================================================
 * Decision Engine
 * ============================================================================
 */

function getDecision(
    score,
    configuration = DEFAULT_OPTIONS
) {

    const normalizedScore =
        clampScore(
            normalizeNumber(
                score
            )
        );


    const thresholds =
        configuration.thresholds
        ||
        DECISION_THRESHOLDS;


    if (
        normalizedScore <=
        thresholds.APPROVE_MAX
    ) {

        return DECISIONS.APPROVE;

    }


    if (
        normalizedScore >=
        thresholds.BLOCK_MIN
    ) {

        return DECISIONS.BLOCK;

    }


    return DECISIONS.REVIEW;

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
            normalizeNumber(
                score
            )
        );


    if (
        normalizedScore <
        40
    ) {

        return RISK_LEVELS.LOW;

    }


    if (
        normalizedScore <
        80
    ) {

        return RISK_LEVELS.MEDIUM;

    }


    return RISK_LEVELS.HIGH;

}


/**
 * ============================================================================
 * Statistics
 * ============================================================================
 */

function recordDecisionStatistics(
    decision
) {

    switch (
        decision
    ) {

        case DECISIONS.APPROVE:

            statistics.approved++;

            break;

        case DECISIONS.REVIEW:

            statistics.reviewed++;

            break;

        case DECISIONS.BLOCK:

            statistics.blocked++;

            break;

        default:
            break;

    }

}


/**
 * ============================================================================
 * Metrics
 * ============================================================================
 */

function safeCounter(
    metrics,
    name,
    value = 1,
    labels = undefined
) {

    try {

        if (
            typeof metrics?.counter ===
            'function'
        ) {

            /**
             * Supports common metrics interfaces:
             *
             * counter(name, value, labels)
             * counter(name, labels)
             *
             * We preserve the existing project's simple API where possible.
             */
            if (
                labels !== undefined
            ) {

                metrics.counter(
                    name,
                    value,
                    labels
                );

            }
            else {

                metrics.counter(
                    name,
                    value
                );

            }

        }

    }
    catch (error) {

        logger?.warn?.({

            message:
                'Risk metrics counter publication failed',

            metric:
                name,

            error:
                sanitizeError(
                    error
                )

        });

    }

}


function safeHistogram(
    metrics,
    name,
    value,
    labels = undefined
) {

    try {

        if (
            typeof metrics?.histogram ===
            'function'
        ) {

            if (
                labels !== undefined
            ) {

                metrics.histogram(
                    name,
                    value,
                    labels
                );

            }
            else {

                metrics.histogram(
                    name,
                    value
                );

            }

        }

    }
    catch (error) {

        logger?.warn?.({

            message:
                'Risk metrics histogram publication failed',

            metric:
                name,

            error:
                sanitizeError(
                    error
                )

        });

    }

}


function incrementMetric(
    metrics,
    name,
    labels
) {

    safeCounter(
        metrics,
        name,
        1,
        labels
    );

}


function publishEvaluationMetrics(
    result,
    options
) {

    const labels = {

        decision:
            result.decision,

        riskLevel:
            result.riskLevel,

        scoringVersion:
            result.scoringVersion

    };


    incrementMetric(
        options.metrics,
        'risk_evaluations_total',
        labels
    );


    incrementMetric(
        options.metrics,
        'risk_score_decision_total',
        labels
    );


    safeHistogram(

        options.metrics,

        'risk_evaluation_duration_ms',

        result.durationMs,

        {

            scoringVersion:
                result.scoringVersion

        }

    );

}


/**
 * ============================================================================
 * Safe Error
 * ============================================================================
 */

function sanitizeError(
    error
) {

    if (!error) {

        return {

            code:
                'UNKNOWN_ERROR',

            message:
                'Unknown error'

        };

    }


    return {

        name:
            error.name,

        code:
            error.code,

        message:
            String(
                error.message ||
                error
            )
                .replace(
                    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
                    'Bearer [REDACTED]'
                )
                .slice(
                    0,
                    500
                )

    };

}


/**
 * ============================================================================
 * Service Factory
 * ============================================================================
 */

function createRiskService({

    logger:
        serviceLogger = logger,

    metrics =
        null,

    configuration =
        {}

} = {}) {

    const resolvedConfiguration =
        resolveConfiguration(
            configuration
        );


    return Object.freeze({

        evaluateTransaction(
            data = {}
        ) {

            return evaluateRisk(

                data,

                {

                    ...resolvedConfiguration,

                    logger:
                        serviceLogger,

                    metrics

                }

            );

        },


        /**
         * Backward-compatible numeric API.
         */
        calculateRiskScore(
            data = {}
        ) {

            return calculateRiskScore(

                data,

                resolvedConfiguration

            );

        },


        /**
         * Preferred detailed API.
         */
        calculateRiskDetails(
            data = {}
        ) {

            return calculateRiskDetails(

                data,

                resolvedConfiguration

            );

        },


        getDecision,

        getRiskLevel,


        getConfiguration() {

            return {

                ...resolvedConfiguration,

                rules: {
                    ...resolvedConfiguration.rules
                },

                weights: {
                    ...resolvedConfiguration.weights
                },

                thresholds: {
                    ...resolvedConfiguration.thresholds
                }

            };

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

                statistics:
                    {
                        ...statistics
                    }

            };

        },


        stats() {

            return {

                ...statistics

            };

        }

    });

}


/**
 * ============================================================================
 * Health
 * ============================================================================
 */

function health() {

    return {

        provider:
            PROVIDER,

        component:
            SERVICE_NAME,

        status:
            'UP',

        scoringVersion:
            SCORING_VERSION,

        statistics: {

            ...statistics

        }

    };

}


/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 */

function stats() {

    return {

        ...statistics

    };

}


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {

    evaluateTransaction:
        evaluateRisk,

    evaluateRisk,

    calculateRiskScore,

    calculateRiskDetails,

    getDecision,

    getRiskLevel,

    validateTransactionInput,

    validateConfiguration,

    createInputFingerprint,

    buildCanonicalInput,

    evaluateRules,

    createRiskService,

    resolveConfiguration,

    health,

    stats,

    RISK_RULES,

    RULE_WEIGHTS,

    DECISION_THRESHOLDS,

    DECISIONS,

    RISK_LEVELS,

    SCORING_VERSION

};