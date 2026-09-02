'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Repair Risk Index Calculator
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/riskIndexCalculator.js
 *
 * Purpose
 * -------
 * Calculates a deterministic, explainable risk index for statement repairs.
 *
 * Responsibilities
 * ---------------
 * • Calculate repair risk index
 * • Produce explainable risk scores
 * • Classify operational risk
 * • Identify risk drivers
 * • Determine escalation requirements
 * • Support executive reporting
 * • Support prioritization
 * • Support recommendation engine
 * • Support future ML advisory models
 *
 * Risk Scale
 * ----------
 * 0–25     LOW
 * 26–50    MODERATE
 * 51–75    HIGH
 * 76–100   CRITICAL
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Explainable
 * • Policy driven
 * • Immutable outputs
 * • Audit ready
 * • No database access
 * • No side effects
 * • ML advisory by default
 * • Fail closed for critical controls
 *
 * IMPORTANT
 * ---------
 * This calculator determines risk.
 *
 * It MUST NOT:
 * • execute repairs
 * • approve repairs
 * • mutate ledger data
 * • persist risk results
 * • bypass compliance controls
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Risk Levels
 * ============================================================================
 */

const RISK_LEVEL = Object.freeze({

    LOW: 'LOW',

    MODERATE: 'MODERATE',

    HIGH: 'HIGH',

    CRITICAL: 'CRITICAL'
});

/**
 * ============================================================================
 * Risk Rank
 * ============================================================================
 */

const RISK_RANK = Object.freeze({

    LOW: 1,

    MODERATE: 2,

    HIGH: 3,

    CRITICAL: 4
});

/**
 * ============================================================================
 * Default Weighted Model
 * ============================================================================
 *
 * Total = 100%
 * ============================================================================
 */

const DEFAULT_WEIGHTS = Object.freeze({

    financialExposure: 25,

    regulatoryRisk: 20,

    operationalRisk: 15,

    customerImpact: 15,

    ledgerIntegrity: 15,

    repairAge: 10
});

/**
 * ============================================================================
 * Risk Thresholds
 * ============================================================================
 */

const RISK_THRESHOLDS = Object.freeze({

    LOW_MAX: 25,

    MODERATE_MAX: 50,

    HIGH_MAX: 75,

    CRITICAL_MIN: 76
});

/**
 * ============================================================================
 * Default Policy
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    criticalScoreThreshold: 76,

    escalationScoreThreshold: 75,

    criticalRegulatoryEscalation: true,

    criticalLedgerEscalation: true,

    mlMinimumConfidence: 90,

    allowMlScoreOverride: false,

    allowMlLevelOverride: false

});

/**
 * ============================================================================
 * Score Range
 * ============================================================================
 */

const SCORE_RANGE = Object.freeze({

    MIN: 0,

    MAX: 100
});

/**
 * ============================================================================
 * Policy / Model Version
 * ============================================================================
 */

const MODEL_VERSION =
    'STATEMENT_REPAIR_RISK_MODEL_V1';

/**
 * ============================================================================
 * Time Constants
 * ============================================================================
 */

const MS_PER_DAY =
    86400000;

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Convert a value into a finite number.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

/**
 * Clamp a score into the supported range.
 *
 * @param {*} value
 * @returns {number}
 */
function clampScore(value) {

    return Math.min(
        SCORE_RANGE.MAX,
        Math.max(
            SCORE_RANGE.MIN,
            toFiniteNumber(value, 0)
        )
    );
}

/**
 * Normalize enum-like values.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeEnum(value) {

    if (typeof value !== 'string') {
        return null;
    }

    return value
        .trim()
        .toUpperCase();
}

/**
 * Safely parse a date.
 *
 * @param {*} value
 * @returns {number|null}
 */
function toTimestamp(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const timestamp =
        new Date(value).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : null;
}

/**
 * Freeze an object without exposing a mutable reference.
 *
 * @param {object} value
 * @returns {object}
 */
function freezeObject(value) {

    return Object.freeze({
        ...value
    });
}

/**
 * Freeze an array.
 *
 * @param {Array} value
 * @returns {Array}
 */
function freezeArray(value) {

    return Object.freeze([
        ...value
    ]);
}

/**
 * ============================================================================
 * Risk Index Calculator
 * ============================================================================
 */

class RiskIndexCalculator {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {object} options
     * @param {object} options.weights
     * @param {object} options.policy
     * @param {object|null} options.mlProvider
     * @param {Function} options.clock
     */
    constructor({

        weights = DEFAULT_WEIGHTS,

        policy = {},

        mlProvider = null,

        clock = () => new Date()

    } = {}) {

        if (
            typeof clock !== 'function'
        ) {

            throw new TypeError(
                'clock must be a function.'
            );
        }

        if (
            mlProvider !== null &&
            typeof mlProvider !== 'object'
        ) {

            throw new TypeError(
                'mlProvider must be an object or null.'
            );
        }

        this.weights =
            freezeObject(
                this.validateWeights(
                    {
                        ...DEFAULT_WEIGHTS,
                        ...(weights || {})
                    }
                )
            );

        this.policy =
            freezeObject({

                ...DEFAULT_POLICY,

                ...(policy || {})

            });

        this.mlProvider =
            mlProvider;

        this.clock =
            clock;

        this.modelVersion =
            MODEL_VERSION;
    }

    /**
     * =========================================================================
     * Validate Weights
     * =========================================================================
     *
     * Risk dimensions must total exactly 100%.
     *
     * @param {object} weights
     * @returns {object}
     */
    validateWeights(weights) {

        if (
            weights === null ||
            typeof weights !== 'object' ||
            Array.isArray(weights)
        ) {

            throw new TypeError(
                'Risk weights must be an object.'
            );
        }

        const keys =
            Object.keys(
                DEFAULT_WEIGHTS
            );

        const normalized = {};

        for (const key of keys) {

            const value =
                toFiniteNumber(
                    weights[key],
                    NaN
                );

            if (!Number.isFinite(value)) {

                throw new TypeError(
                    `Risk weight "${key}" must be a finite number.`
                );
            }

            if (value < 0) {

                throw new RangeError(
                    `Risk weight "${key}" cannot be negative.`
                );
            }

            normalized[key] =
                value;
        }

        const total =
            Object.values(
                normalized
            ).reduce(
                (sum, value) =>
                    sum + value,
                0
            );

        if (
            Math.abs(
                total - 100
            ) > 0.000001
        ) {

            throw new RangeError(
                `Risk weights must total 100. Received ${total}.`
            );
        }

        return normalized;
    }

    /**
     * =========================================================================
     * Public API — Calculate Risk Index
     * =========================================================================
     *
     * @param {object} repair
     * @returns {object}
     */
    calculateRiskIndex(
        repair = {}
    ) {

        this.assertRepairObject(
            repair
        );

        const breakdown = {

            financialExposure:
                this.scoreFinancialExposure(
                    repair
                ),

            regulatoryRisk:
                this.scoreRegulatoryRisk(
                    repair
                ),

            operationalRisk:
                this.scoreOperationalRisk(
                    repair
                ),

            customerImpact:
                this.scoreCustomerImpact(
                    repair
                ),

            ledgerIntegrity:
                this.scoreLedgerIntegrity(
                    repair
                ),

            repairAge:
                this.scoreRepairAge(
                    repair
                )
        };

        const weightedBreakdown =
            this.calculateWeightedBreakdown(
                breakdown
            );

        const rawScore =
            Object.values(
                weightedBreakdown
            ).reduce(
                (sum, value) =>
                    sum + value,
                0
            );

        const score =
            Math.round(
                clampScore(
                    rawScore
                )
            );

        const level =
            this.resolveRiskLevel(
                score
            );

        const escalation =
            this.determineEscalation(
                repair,
                score
            );

        const result =
            this.buildRiskResult({

                repair,

                score,

                level,

                breakdown,

                weightedBreakdown,

                escalation
            });

        const mlRecommendation =
            this.getMlRiskAssessment(
                repair,
                result
            );

        return Object.freeze(
            this.resolveMlAssessment(
                result,
                mlRecommendation
            )
        );
    }

    /**
     * =========================================================================
     * Weighted Breakdown
     * =========================================================================
     *
     * @param {object} breakdown
     * @returns {object}
     */
    calculateWeightedBreakdown(
        breakdown
    ) {

        const weighted = {};

        for (
            const [factor, value]
            of Object.entries(breakdown)
        ) {

            const normalizedValue =
                clampScore(value);

            const weight =
                this.weights[factor];

            weighted[factor] =
                Number(
                    (
                        normalizedValue *
                        (
                            weight /
                            100
                        )
                    ).toFixed(6)
                );
        }

        return weighted;
    }

    /**
     * =========================================================================
     * Financial Exposure
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreFinancialExposure(
        repair
    ) {

        const amount =
            Math.abs(
                toFiniteNumber(
                    repair.amount ??
                    repair.evidence?.amount,
                    0
                )
            );

        if (amount >= 10000000) return 100;
        if (amount >= 5000000) return 90;
        if (amount >= 1000000) return 75;
        if (amount >= 500000) return 60;
        if (amount >= 100000) return 45;
        if (amount >= 10000) return 25;

        return 10;
    }

    /**
     * =========================================================================
     * Regulatory Risk
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreRegulatoryRisk(
        repair
    ) {

        if (
            repair.regulatoryViolation === true
        ) {
            return 100;
        }

        if (
            repair.requiresComplianceReview === true
        ) {
            return 80;
        }

        if (
            repair.regulatoryReportable === true
        ) {
            return 65;
        }

        return 10;
    }

    /**
     * =========================================================================
     * Operational Risk
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreOperationalRisk(
        repair
    ) {

        if (
            repair.systemFailure === true
        ) {
            return 90;
        }

        if (
            repair.failedSettlement === true
        ) {
            return 80;
        }

        if (
            repair.processingError === true
        ) {
            return 60;
        }

        if (
            repair.manualRepairRequired === true
        ) {
            return 40;
        }

        return 15;
    }

    /**
     * =========================================================================
     * Customer Impact
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreCustomerImpact(
        repair
    ) {

        switch (
            normalizeEnum(
                repair.customerImpact
            )
        ) {

            case 'CRITICAL':
                return 100;

            case 'HIGH':
                return 80;

            case 'MEDIUM':
                return 55;

            case 'LOW':
                return 25;

            default:
                return 10;
        }
    }

    /**
     * =========================================================================
     * Ledger Integrity
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreLedgerIntegrity(
        repair
    ) {

        if (
            repair.ledgerIntegrityViolation === true
        ) {
            return 100;
        }

        if (
            repair.doubleEntryMismatch === true
        ) {
            return 90;
        }

        if (
            repair.balanceMismatch === true
        ) {
            return 75;
        }

        if (
            repair.requiresJournalAdjustment === true
        ) {
            return 55;
        }

        return 10;
    }

    /**
     * =========================================================================
     * Repair Age
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreRepairAge(
        repair
    ) {

        const createdAt =
            toTimestamp(
                repair.createdAt
            );

        if (createdAt === null) {
            return 0;
        }

        const now =
            this.getCurrentTimestamp();

        /**
         * Future timestamps do not increase risk.
         */
        if (
            createdAt >= now
        ) {
            return 0;
        }

        const days =
            (
                now -
                createdAt
            ) / MS_PER_DAY;

        if (days >= 60) return 100;
        if (days >= 30) return 85;
        if (days >= 14) return 65;
        if (days >= 7) return 45;
        if (days >= 3) return 25;

        return 10;
    }

    /**
     * =========================================================================
     * Risk Classification
     * =========================================================================
     *
     * @param {number} score
     * @returns {string}
     */
    resolveRiskLevel(
        score
    ) {

        const normalizedScore =
            clampScore(
                score
            );

        if (
            normalizedScore >=
            RISK_THRESHOLDS.CRITICAL_MIN
        ) {

            return RISK_LEVEL.CRITICAL;
        }

        if (
            normalizedScore >= 51
        ) {

            return RISK_LEVEL.HIGH;
        }

        if (
            normalizedScore >= 26
        ) {

            return RISK_LEVEL.MODERATE;
        }

        return RISK_LEVEL.LOW;
    }

    /**
     * =========================================================================
     * Escalation Determination
     * =========================================================================
     *
     * Explicit regulatory and ledger controls can require escalation even when
     * the aggregate mathematical score is below the normal threshold.
     *
     * @param {object} repair
     * @param {number} score
     * @returns {object}
     */
    determineEscalation(
        repair,
        score
    ) {

        const reasons = [];

        if (
            score >=
            this.policy
                .escalationScoreThreshold
        ) {

            reasons.push(
                'Aggregate risk score exceeds escalation threshold.'
            );
        }

        if (
            this.policy
                .criticalRegulatoryEscalation &&
            repair.regulatoryViolation === true
        ) {

            reasons.push(
                'Regulatory violation requires escalation.'
            );
        }

        if (
            this.policy
                .criticalLedgerEscalation &&
            repair.ledgerIntegrityViolation === true
        ) {

            reasons.push(
                'Ledger integrity violation requires escalation.'
            );
        }

        return freezeObject({

            required:
                reasons.length > 0,

            reasons:
                freezeArray(
                    reasons
                )
        });
    }

    /**
     * =========================================================================
     * Build Risk Result
     * =========================================================================
     *
     * @param {object} options
     * @returns {object}
     */
    buildRiskResult({

        repair,

        score,

        level,

        breakdown,

        weightedBreakdown,

        escalation

    }) {

        const financialExposure =
            Math.abs(
                toFiniteNumber(
                    repair.amount ??
                    repair.evidence?.amount,
                    0
                )
            );

        const riskDrivers =
            this.identifyRiskDrivers(
                breakdown,
                weightedBreakdown
            );

        return {

            repairId:
                repair.repairId ??
                repair.id ??
                null,

            score,

            level,

            riskRank:
                RISK_RANK[level],

            modelVersion:
                this.modelVersion,

            breakdown:
                freezeObject({
                    ...breakdown
                }),

            weightedBreakdown:
                freezeObject({
                    ...weightedBreakdown
                }),

            riskDrivers,

            financialExposure,

            escalationRequired:
                escalation.required,

            escalationReasons:
                escalation.reasons,

            explanation:
                this.buildExplanation(
                    score,
                    level,
                    riskDrivers,
                    escalation
                ),

            calculatedAt:
                this.clock(),

            decisionSource:
                'DETERMINISTIC_RISK_MODEL'
        };
    }

    /**
     * =========================================================================
     * Identify Risk Drivers
     * =========================================================================
     *
     * Returns the most material contributors to the final risk score.
     *
     * @param {object} breakdown
     * @param {object} weightedBreakdown
     * @returns {Array<object>}
     */
    identifyRiskDrivers(
        breakdown,
        weightedBreakdown
    ) {

        const drivers =
            Object.keys(
                breakdown
            )
                .map(
                    factor =>
                        ({
                            factor,

                            rawScore:
                                clampScore(
                                    breakdown[factor]
                                ),

                            weight:
                                this.weights[factor],

                            contribution:
                                weightedBreakdown[
                                    factor
                                ]
                        })
                )
                .sort(
                    (a, b) => {

                        if (
                            b.contribution !==
                            a.contribution
                        ) {

                            return (
                                b.contribution -
                                a.contribution
                            );
                        }

                        return (
                            b.rawScore -
                            a.rawScore
                        );
                    }
                );

        return freezeArray(
            drivers.map(
                driver =>
                    freezeObject(
                        driver
                    )
            )
        );
    }

    /**
     * =========================================================================
     * Explanation
     * =========================================================================
     *
     * @param {number} score
     * @param {string} level
     * @param {Array<object>} drivers
     * @param {object} escalation
     * @returns {object}
     */
    buildExplanation(
        score,
        level,
        drivers,
        escalation
    ) {

        const topDrivers =
            drivers
                .slice(0, 3)
                .map(
                    driver =>
                        driver.factor
                );

        let summary =
            `Risk index is ${score}/100 and classified as ${level}.`;

        if (
            topDrivers.length
        ) {

            summary +=
                ` Primary risk drivers: ${topDrivers.join(', ')}.`;
        }

        if (
            escalation.required
        ) {

            summary +=
                ' Escalation is required.';
        }

        return freezeObject({

            summary,

            score,

            level,

            topDrivers:
                freezeArray(
                    topDrivers
                ),

            escalationRequired:
                escalation.required
        });
    }

    /**
     * =========================================================================
     * ML Risk Assessment
     * =========================================================================
     *
     * ML remains advisory by default.
     *
     * A failed ML provider never invalidates the deterministic risk result.
     *
     * @param {object} repair
     * @param {object} deterministicResult
     * @returns {object|null}
     */
    getMlRiskAssessment(
        repair,
        deterministicResult
    ) {

        if (
            !this.mlProvider ||
            typeof this.mlProvider
                .calculateRiskIndex !==
                'function'
        ) {

            return null;
        }

        try {

            const result =
                this.mlProvider.calculateRiskIndex(
                    repair,
                    deterministicResult
                );

            if (
                !result ||
                typeof result !== 'object'
            ) {

                return null;
            }

            return freezeObject({

                ...result,

                source:
                    'ML_PROVIDER',

                available:
                    true
            });

        } catch (error) {

            return freezeObject({

                source:
                    'ML_PROVIDER',

                available:
                    false,

                error:
                    error?.message ||
                    'ML risk provider failed.'
            });
        }
    }

    /**
     * =========================================================================
     * ML Resolution
     * =========================================================================
     *
     * @param {object} deterministicResult
     * @param {object|null} mlAssessment
     * @returns {object}
     */
    resolveMlAssessment(
        deterministicResult,
        mlAssessment
    ) {

        if (!mlAssessment) {

            return deterministicResult;
        }

        const base =
            {

                ...deterministicResult,

                mlAssessment,

                decisionSource:
                    'DETERMINISTIC_RISK_MODEL'

            };

        if (
            !this.policy
                .allowMlScoreOverride
        ) {

            return base;
        }

        const mlConfidence =
            clampScore(
                mlAssessment.confidence
            );

        if (
            mlConfidence <
            this.policy
                .mlMinimumConfidence
        ) {

            return base;
        }

        /**
         * Critical regulatory or ledger conditions remain protected even when
         * ML override is explicitly enabled.
         */
        if (
            deterministicResult.escalationRequired
        ) {

            return base;
        }

        const mlScore =
            clampScore(
                mlAssessment.score
            );

        base.score =
            Math.round(
                mlScore
            );

        if (
            this.policy
                .allowMlLevelOverride
        ) {

            base.level =
                this.resolveRiskLevel(
                    base.score
                );

            base.riskRank =
                RISK_RANK[
                    base.level
                ];
        }

        base.decisionSource =
            'ML_AUGMENTED_RISK_MODEL';

        return base;
    }

    /**
     * =========================================================================
     * Get Configuration
     * =========================================================================
     *
     * @returns {object}
     */
    getConfiguration() {

        return freezeObject({

            modelVersion:
                this.modelVersion,

            weights:
                freezeObject({
                    ...this.weights
                }),

            policy:
                freezeObject({
                    ...this.policy
                }),

            thresholds:
                freezeObject({
                    ...RISK_THRESHOLDS
                }),

            riskLevels:
                freezeArray(
                    Object.values(
                        RISK_LEVEL
                    )
                )
        });
    }

    /**
     * =========================================================================
     * Current Timestamp
     * =========================================================================
     *
     * @returns {number}
     */
    getCurrentTimestamp() {

        const timestamp =
            toTimestamp(
                this.clock()
            );

        if (
            timestamp === null
        ) {

            throw new Error(
                'Risk calculator clock returned an invalid date.'
            );
        }

        return timestamp;
    }

    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     *
     * @param {*} repair
     */
    assertRepairObject(
        repair
    ) {

        if (
            repair === null ||
            typeof repair !== 'object' ||
            Array.isArray(repair)
        ) {

            throw new TypeError(
                'Repair must be a non-null object.'
            );
        }
    }
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

RiskIndexCalculator.RISK_LEVEL =
    RISK_LEVEL;

RiskIndexCalculator.RISK_RANK =
    RISK_RANK;

RiskIndexCalculator.DEFAULT_WEIGHTS =
    DEFAULT_WEIGHTS;

RiskIndexCalculator.RISK_THRESHOLDS =
    RISK_THRESHOLDS;

RiskIndexCalculator.DEFAULT_POLICY =
    DEFAULT_POLICY;

RiskIndexCalculator.MODEL_VERSION =
    MODEL_VERSION;

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    RiskIndexCalculator;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.RISK_RANK =
    RISK_RANK;

module.exports.DEFAULT_WEIGHTS =
    DEFAULT_WEIGHTS;

module.exports.RISK_THRESHOLDS =
    RISK_THRESHOLDS;

module.exports.DEFAULT_POLICY =
    DEFAULT_POLICY;

module.exports.MODEL_VERSION =
    MODEL_VERSION;