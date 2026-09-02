'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * ============================================================================
 *
 * Anomaly Classifier
 *
 * File:
 *   backend/modules/finance/statements/intelligence/anomalyClassifier.js
 *
 * Responsibilities:
 *   - Classify statement repair anomalies
 *   - Produce explainable classifications
 *   - Support multiple anomaly categories
 *   - Generate confidence scores
 *   - Preserve evidence for audit
 *   - Support deterministic rule-based classification
 *   - Provide ML integration point
 *   - Protect classification from malformed extension rules
 *   - Preserve classification provenance
 *
 * Design Principles:
 *   - Stateless classification
 *   - Deterministic rule evaluation
 *   - Explainable decisions
 *   - Extensible rules
 *   - ML-ready
 *   - Audit friendly
 *   - Fail-safe
 *   - No database access
 *   - No persistence side effects
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Categories
 * ============================================================================
 */

const ANOMALY_CATEGORY = Object.freeze({

    SETTLEMENT:
        'SETTLEMENT',

    LEDGER:
        'LEDGER',

    MAPPING:
        'MAPPING',

    DUPLICATE:
        'DUPLICATE',

    MISSING_POSTING:
        'MISSING_POSTING',

    TIMING:
        'TIMING',

    CURRENCY:
        'CURRENCY',

    FRAUD_INDICATOR:
        'FRAUD_INDICATOR',

    SYSTEM_ERROR:
        'SYSTEM_ERROR',

    MANUAL_ERROR:
        'MANUAL_ERROR',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Confidence Levels
 * ============================================================================
 */

const CONFIDENCE = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    VERY_HIGH:
        'VERY_HIGH'

});

/**
 * ============================================================================
 * Classification Sources
 * ============================================================================
 */

const CLASSIFICATION_SOURCE = Object.freeze({

    RULE_ENGINE:
        'RULE_ENGINE',

    CUSTOM_RULE:
        'CUSTOM_RULE',

    MACHINE_LEARNING:
        'MACHINE_LEARNING',

    HYBRID:
        'HYBRID',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Rule Priorities
 * ============================================================================
 *
 * Higher number = higher priority.
 *
 * Fraud and ledger integrity exceptions intentionally receive stronger
 * precedence than generic processing anomalies.
 * ============================================================================
 */

const CATEGORY_PRIORITY = Object.freeze({

    [ANOMALY_CATEGORY.FRAUD_INDICATOR]:
        100,

    [ANOMALY_CATEGORY.LEDGER]:
        90,

    [ANOMALY_CATEGORY.MISSING_POSTING]:
        80,

    [ANOMALY_CATEGORY.SETTLEMENT]:
        70,

    [ANOMALY_CATEGORY.DUPLICATE]:
        60,

    [ANOMALY_CATEGORY.CURRENCY]:
        50,

    [ANOMALY_CATEGORY.MAPPING]:
        40,

    [ANOMALY_CATEGORY.TIMING]:
        30,

    [ANOMALY_CATEGORY.SYSTEM_ERROR]:
        20,

    [ANOMALY_CATEGORY.MANUAL_ERROR]:
        10,

    [ANOMALY_CATEGORY.UNKNOWN]:
        0

});

/**
 * ============================================================================
 * AnomalyClassifier
 * ============================================================================
 */

class AnomalyClassifier {

    /**
     * ------------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------------
     */

    constructor({

        customRules = [],

        mlProvider = null,

        strict = false,

        logger = null

    } = {}) {

        this.customRules =
            Array.isArray(
                customRules
            )
                ? customRules.filter(
                    rule =>
                        typeof rule ===
                        'function'
                )
                : [];

        this.mlProvider =
            mlProvider || null;

        this.strict =
            strict === true;

        this.logger =
            logger || null;

    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    classifyAnomaly(
        repair = {}
    ) {

        const safeRepair =
            this._normalizeRepair(
                repair
            );

        const ruleResult =
            this.applyRules(
                safeRepair
            );

        const mlResult =
            this.runMachineLearning(
                safeRepair,
                ruleResult
            );

        const normalizedResult =
            this._normalizeClassificationResult(
                mlResult,
                ruleResult
            );

        const classifiedAt =
            new Date();

        return Object.freeze({

            repairId:
                safeRepair.repairId,

            category:
                normalizedResult.category,

            secondaryCategory:
                normalizedResult.secondaryCategory,

            confidence:
                normalizedResult.confidence,

            confidenceScore:
                normalizedResult.confidenceScore,

            indicators:
                Object.freeze(
                    [
                        ...new Set(
                            normalizedResult.indicators
                        )
                    ]
                ),

            evidence:
                Object.freeze(
                    this._cloneAndFreeze(
                        normalizedResult.evidence
                    )
                ),

            source:
                normalizedResult.source,

            ruleCount:
                normalizedResult.ruleCount,

            classifiedAt:
                classifiedAt.toISOString()

        });

    }

    /**
     * =========================================================================
     * Rule Engine
     * =========================================================================
     */

    applyRules(
        repair = {}
    ) {

        const indicators = [];

        const evidence = {

            repairType:
                repair.type,

            severity:
                repair.severity,

            amount:
                repair.amount ??
                repair.evidence?.amount ??
                0,

            currency:
                repair.currency ??
                repair.evidence?.currency ??
                null,

            transactionId:
                repair.transactionId ??
                repair.evidence?.transactionId ??
                null,

            accountId:
                repair.accountId ??
                repair.evidence?.accountId ??
                null

        };

        const candidates = [];

        /**
         * ---------------------------------------------------------------------
         * Settlement
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.settlementMismatch
            ) ||
            this._isTruthy(
                repair.failedSettlement
            ) ||
            this._isTruthy(
                repair.missingSettlement
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.SETTLEMENT,

                indicator:
                    'SETTLEMENT_EXCEPTION',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.SETTLEMENT
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Ledger
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.ledgerIntegrityViolation
            ) ||
            this._isTruthy(
                repair.balanceMismatch
            ) ||
            this._isTruthy(
                repair.doubleEntryMismatch
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.LEDGER,

                indicator:
                    'LEDGER_INTEGRITY',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.LEDGER
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Mapping
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.accountMappingError
            ) ||
            this._isTruthy(
                repair.invalidAccount
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.MAPPING,

                indicator:
                    'ACCOUNT_MAPPING',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.MAPPING
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Duplicate
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.duplicate
            ) ||
            this._isTruthy(
                repair.duplicatePosting
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.DUPLICATE,

                indicator:
                    'DUPLICATE_TRANSACTION',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.DUPLICATE
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Missing Posting
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.missingLedgerEntry
            ) ||
            this._isTruthy(
                repair.missingPosting
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.MISSING_POSTING,

                indicator:
                    'LEDGER_POSTING_MISSING',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.MISSING_POSTING
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Timing
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.dateMismatch
            ) ||
            this._isTruthy(
                repair.latePosting
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.TIMING,

                indicator:
                    'TIMING_EXCEPTION',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.TIMING
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Currency
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.currencyMismatch
            ) ||
            this._isTruthy(
                repair.exchangeRateVariance
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.CURRENCY,

                indicator:
                    'CURRENCY_VARIANCE',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.CURRENCY
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Fraud
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.fraudSuspected
            ) ||
            this._isTruthy(
                repair.suspiciousActivity
            ) ||
            this._isTruthy(
                repair.highRiskPattern
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.FRAUD_INDICATOR,

                indicator:
                    'FRAUD_PATTERN',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.FRAUD_INDICATOR
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * System Error
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.systemFailure
            ) ||
            this._isTruthy(
                repair.integrationFailure
            ) ||
            this._isTruthy(
                repair.processingError
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.SYSTEM_ERROR,

                indicator:
                    'SYSTEM_FAILURE',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.SYSTEM_ERROR
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Manual Error
         * ---------------------------------------------------------------------
         */

        if (
            this._isTruthy(
                repair.manualAdjustment
            ) ||
            this._isTruthy(
                repair.operatorError
            )
        ) {

            candidates.push({

                category:
                    ANOMALY_CATEGORY.MANUAL_ERROR,

                indicator:
                    'MANUAL_PROCESSING',

                priority:
                    CATEGORY_PRIORITY[
                        ANOMALY_CATEGORY.MANUAL_ERROR
                    ]

            });

        }

        /**
         * ---------------------------------------------------------------------
         * Custom Rules
         * ---------------------------------------------------------------------
         */

        for (
            let index = 0;
            index < this.customRules.length;
            index += 1
        ) {

            const rule =
                this.customRules[index];

            try {

                const result =
                    rule(
                        repair
                    );

                if (
                    !result ||
                    !result.category
                ) {
                    continue;
                }

                const category =
                    this._normalizeCategory(
                        result.category
                    );

                if (
                    category ===
                    ANOMALY_CATEGORY.UNKNOWN
                ) {
                    continue;
                }

                const customIndicators =
                    Array.isArray(
                        result.indicators
                    )
                        ? result.indicators
                        : [];

                candidates.push({

                    category,

                    indicator:
                        customIndicators.length > 0
                            ? customIndicators[0]
                            : `CUSTOM_RULE_${index + 1}`,

                    indicators:
                        customIndicators,

                    priority:
                        Number.isFinite(
                            result.priority
                        )
                            ? result.priority
                            : CATEGORY_PRIORITY[
                                category
                            ] + 1,

                    evidence:
                        result.evidence ||
                        null,

                    source:
                        CLASSIFICATION_SOURCE.CUSTOM_RULE

                });

            } catch (error) {

                this._log(
                    'warn',
                    'Anomaly custom rule failed.',
                    {
                        ruleIndex:
                            index,

                        error:
                            error.message
                    }
                );

                if (
                    this.strict
                ) {
                    throw error;
                }

            }

        }

        /**
         * ---------------------------------------------------------------------
         * Determine Primary Category
         * ---------------------------------------------------------------------
         */

        candidates.sort(
            (
                left,
                right
            ) =>
                right.priority -
                left.priority
        );

        const primary =
            candidates[0] || null;

        const secondary =
            candidates[1] || null;

        if (
            primary
        ) {

            indicators.push(
                primary.indicator
            );

            if (
                Array.isArray(
                    primary.indicators
                )
            ) {

                indicators.push(
                    ...primary.indicators
                );

            }

        }

        for (
            const candidate of
            candidates.slice(1)
        ) {

            if (
                candidate.indicator
            ) {

                indicators.push(
                    candidate.indicator
                );

            }

            if (
                Array.isArray(
                    candidate.indicators
                )
            ) {

                indicators.push(
                    ...candidate.indicators
                );

            }

        }

        const uniqueIndicators =
            [
                ...new Set(
                    indicators.filter(
                        Boolean
                    )
                )
            ];

        /**
         * ---------------------------------------------------------------------
         * Confidence
         * ---------------------------------------------------------------------
         */

        const confidenceScore =
            this._calculateConfidenceScore(
                {
                    indicatorCount:
                        uniqueIndicators.length,

                    candidateCount:
                        candidates.length,

                    hasPrimary:
                        Boolean(
                            primary
                        ),

                    hasStrongIndicator:
                        this._hasStrongIndicator(
                            repair
                        )
                }
            );

        const evidencePayload = {

            ...evidence,

            matchedCategories:
                candidates.map(
                    candidate =>
                        candidate.category
                ),

            ruleMatches:
                candidates.map(
                    candidate => ({
                        category:
                            candidate.category,

                        indicator:
                            candidate.indicator,

                        priority:
                            candidate.priority,

                        source:
                            candidate.source ||
                            CLASSIFICATION_SOURCE.RULE_ENGINE
                    })
                )

        };

        if (
            primary &&
            primary.evidence
        ) {

            evidencePayload.customEvidence =
                primary.evidence;

        }

        return {

            category:
                primary
                    ? primary.category
                    : ANOMALY_CATEGORY.UNKNOWN,

            secondaryCategory:
                secondary
                    ? secondary.category
                    : null,

            confidence:
                this.resolveConfidence(
                    uniqueIndicators.length,
                    confidenceScore
                ),

            confidenceScore,

            indicators:
                uniqueIndicators,

            evidence:
                evidencePayload,

            source:
                primary &&
                primary.source ===
                    CLASSIFICATION_SOURCE.CUSTOM_RULE
                    ? CLASSIFICATION_SOURCE.CUSTOM_RULE
                    : CLASSIFICATION_SOURCE.RULE_ENGINE,

            ruleCount:
                candidates.length

        };

    }

    /**
     * =========================================================================
     * ML Integration Hook
     * =========================================================================
     */

    runMachineLearning(
        repair,
        ruleResult
    ) {

        if (
            !this.mlProvider
        ) {

            return ruleResult;

        }

        if (
            typeof this.mlProvider.classify !==
            'function'
        ) {

            this._log(
                'warn',
                'Configured ML provider does not expose classify().'
            );

            return ruleResult;

        }

        try {

            const result =
                this.mlProvider.classify(
                    repair,
                    ruleResult
                );

            /**
             * Support synchronous and asynchronous providers.
             *
             * This method intentionally remains synchronous for backward
             * compatibility. Async ML providers should expose a separate
             * async classification orchestration layer.
             */

            if (
                result &&
                typeof result.then ===
                'function'
            ) {

                this._log(
                    'warn',
                    'Async ML provider detected; falling back to rule classification.'
                );

                return ruleResult;

            }

            if (
                !result ||
                typeof result !== 'object'
            ) {

                return ruleResult;

            }

            const category =
                this._normalizeCategory(
                    result.category
                );

            const confidenceScore =
                this._normalizeConfidenceScore(
                    result.confidenceScore
                );

            return {

                ...ruleResult,

                ...result,

                category:
                    category ===
                        ANOMALY_CATEGORY.UNKNOWN
                        ? ruleResult.category
                        : category,

                secondaryCategory:
                    this._normalizeSecondaryCategory(
                        result.secondaryCategory
                    ),

                confidenceScore:
                    confidenceScore === null
                        ? ruleResult.confidenceScore
                        : confidenceScore,

                confidence:
                    result.confidence ||
                    ruleResult.confidence,

                indicators:
                    Array.isArray(
                        result.indicators
                    )
                        ? [
                            ...new Set(
                                [
                                    ...ruleResult.indicators,
                                    ...result.indicators
                                ]
                            )
                        ]
                        : ruleResult.indicators,

                evidence:
                    {
                        ...ruleResult.evidence,
                        ...(result.evidence || {})
                    },

                source:
                    CLASSIFICATION_SOURCE.HYBRID

            };

        } catch (error) {

            this._log(
                'warn',
                'ML anomaly classification failed; falling back to rules.',
                {
                    error:
                        error.message
                }
            );

            if (
                this.strict
            ) {
                throw error;
            }

            return ruleResult;

        }

    }

    /**
     * =========================================================================
     * Confidence Resolution
     * =========================================================================
     */

    resolveConfidence(
        indicatorCount = 0,
        confidenceScore = null
    ) {

        const normalizedScore =
            this._normalizeConfidenceScore(
                confidenceScore
            );

        const score =
            normalizedScore === null
                ? this._calculateConfidenceScore(
                    {
                        indicatorCount
                    }
                )
                : normalizedScore;

        if (
            score >= 90
        ) {

            return CONFIDENCE.VERY_HIGH;

        }

        if (
            score >= 75
        ) {

            return CONFIDENCE.HIGH;

        }

        if (
            score >= 50
        ) {

            return CONFIDENCE.MEDIUM;

        }

        return CONFIDENCE.LOW;

    }

    /**
     * =========================================================================
     * Confidence Score
     * =========================================================================
     */

    _calculateConfidenceScore({
        indicatorCount = 0,
        candidateCount = 0,
        hasPrimary = false,
        hasStrongIndicator = false
    } = {}) {

        let score = 0;

        if (
            hasPrimary
        ) {

            score += 40;

        }

        score +=
            Math.min(
                30,
                Math.max(
                    0,
                    indicatorCount
                ) * 10
            );

        if (
            candidateCount >= 2
        ) {

            score += 10;

        }

        if (
            hasStrongIndicator
        ) {

            score += 20;

        }

        return Math.min(
            100,
            Math.max(
                0,
                score
            )
        );

    }

    /**
     * =========================================================================
     * Strong Indicator Detection
     * =========================================================================
     */

    _hasStrongIndicator(
        repair
    ) {

        return Boolean(

            repair.ledgerIntegrityViolation ||

            repair.doubleEntryMismatch ||

            repair.fraudSuspected ||

            repair.suspiciousActivity ||

            repair.highRiskPattern ||

            repair.missingLedgerEntry ||

            repair.missingPosting

        );

    }

    /**
     * =========================================================================
     * Category Normalization
     * =========================================================================
     */

    _normalizeCategory(
        category
    ) {

        if (
            !category
        ) {

            return ANOMALY_CATEGORY.UNKNOWN;

        }

        const normalized =
            String(
                category
            )
                .trim()
                .toUpperCase();

        if (
            Object.values(
                ANOMALY_CATEGORY
            ).includes(
                normalized
            )
        ) {

            return normalized;

        }

        return ANOMALY_CATEGORY.UNKNOWN;

    }

    /**
     * =========================================================================
     * Secondary Category Normalization
     * =========================================================================
     */

    _normalizeSecondaryCategory(
        category
    ) {

        const normalized =
            this._normalizeCategory(
                category
            );

        return normalized ===
            ANOMALY_CATEGORY.UNKNOWN
            ? null
            : normalized;

    }

    /**
     * =========================================================================
     * Classification Result Normalization
     * =========================================================================
     */

    _normalizeClassificationResult(
        result,
        fallback
    ) {

        const safeResult =
            result &&
            typeof result === 'object'
                ? result
                : fallback;

        const category =
            this._normalizeCategory(
                safeResult.category
            );

        const confidenceScore =
            this._normalizeConfidenceScore(
                safeResult.confidenceScore
            );

        const indicators =
            Array.isArray(
                safeResult.indicators
            )
                ? safeResult.indicators.filter(
                    Boolean
                )
                : [];

        const finalScore =
            confidenceScore === null
                ? this._calculateConfidenceScore(
                    {
                        indicatorCount:
                            indicators.length,

                        candidateCount:
                            safeResult.ruleCount ||
                            0,

                        hasPrimary:
                            category !==
                            ANOMALY_CATEGORY.UNKNOWN
                    }
                )
                : confidenceScore;

        return {

            category,

            secondaryCategory:
                this._normalizeSecondaryCategory(
                    safeResult.secondaryCategory
                ),

            confidence:
                this.resolveConfidence(
                    indicators.length,
                    finalScore
                ),

            confidenceScore:
                finalScore,

            indicators,

            evidence:
                safeResult.evidence &&
                typeof safeResult.evidence ===
                    'object'
                    ? safeResult.evidence
                    : {},

            source:
                safeResult.source ||
                CLASSIFICATION_SOURCE.UNKNOWN,

            ruleCount:
                Number.isFinite(
                    Number(
                        safeResult.ruleCount
                    )
                )
                    ? Number(
                        safeResult.ruleCount
                    )
                    : 0

        };

    }

    /**
     * =========================================================================
     * Repair Normalization
     * =========================================================================
     */

    _normalizeRepair(
        repair
    ) {

        if (
            !repair ||
            typeof repair !== 'object'
        ) {

            return {};

        }

        return repair;

    }

    /**
     * =========================================================================
     * Truthiness Helper
     * =========================================================================
     */

    _isTruthy(
        value
    ) {

        if (
            value === true
        ) {

            return true;

        }

        if (
            typeof value === 'string'
        ) {

            return [
                'true',
                'yes',
                '1'
            ].includes(
                value
                    .trim()
                    .toLowerCase()
            );

        }

        return Boolean(
            value
        );

    }

    /**
     * =========================================================================
     * Confidence Score Normalization
     * =========================================================================
     */

    _normalizeConfidenceScore(
        score
    ) {

        if (
            score === null ||
            score === undefined ||
            score === ''
        ) {

            return null;

        }

        const numeric =
            Number(
                score
            );

        if (
            !Number.isFinite(
                numeric
            )
        ) {

            return null;

        }

        return Math.min(
            100,
            Math.max(
                0,
                numeric
            )
        );

    }

    /**
     * =========================================================================
     * Deep Clone / Freeze
     * =========================================================================
     */

    _cloneAndFreeze(
        value,
        seen = new WeakSet()
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;

        }

        if (
            typeof value !== 'object'
        ) {

            return value;

        }

        if (
            value instanceof Date
        ) {

            return Object.freeze(
                value.toISOString()
            );

        }

        if (
            seen.has(
                value
            )
        ) {

            return '[CIRCULAR_REFERENCE]';

        }

        seen.add(
            value
        );

        if (
            Array.isArray(
                value
            )
        ) {

            const array =
                value.map(
                    item =>
                        this._cloneAndFreeze(
                            item,
                            seen
                        )
                );

            seen.delete(
                value
            );

            return Object.freeze(
                array
            );

        }

        const result = {};

        for (
            const [
                key,
                child
            ] of Object.entries(
                value
            )
        ) {

            result[key] =
                this._cloneAndFreeze(
                    child,
                    seen
                );

        }

        seen.delete(
            value
        );

        return Object.freeze(
            result
        );

    }

    /**
     * =========================================================================
     * Logging
     * =========================================================================
     */

    _log(
        level,
        message,
        metadata = {}
    ) {

        if (
            !this.logger
        ) {

            return;

        }

        const method =
            typeof this.logger[level] ===
            'function'
                ? this.logger[level]
                : typeof this.logger.log ===
                    'function'
                    ? this.logger.log
                    : null;

        if (
            !method
        ) {

            return;

        }

        try {

            method.call(
                this.logger,
                message,
                metadata
            );

        } catch (
            error
        ) {

            /**
             * Logging must never break classification.
             */

        }

    }

}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports =
    AnomalyClassifier;

module.exports.AnomalyClassifier =
    AnomalyClassifier;

module.exports.ANOMALY_CATEGORY =
    ANOMALY_CATEGORY;

module.exports.CONFIDENCE =
    CONFIDENCE;

module.exports.CLASSIFICATION_SOURCE =
    CLASSIFICATION_SOURCE;

module.exports.CATEGORY_PRIORITY =
    CATEGORY_PRIORITY;