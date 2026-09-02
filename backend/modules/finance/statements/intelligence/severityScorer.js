'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Severity Scorer
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/severityScorer.js
 *
 * Purpose
 * -------
 * Calculates the financial severity of statement repair candidates.
 *
 * Responsibilities
 * ---------------
 * • Calculate financial repair severity
 * • Produce explainable weighted scores
 * • Apply enterprise escalation rules
 * • Identify severity drivers
 * • Preserve deterministic behaviour
 * • Support audit reporting
 * • Support executive reporting
 * • Support repair prioritization
 * • Provide policy-safe inputs to recommendation engines
 *
 * Weighted Model
 * --------------
 * Amount Impact        30%
 * Regulatory Risk      25%
 * Customer Impact      20%
 * Ledger Integrity     15%
 * Repair Age           10%
 *
 * Severity Scale
 * --------------
 * 0–39     LOW
 * 40–64    MEDIUM
 * 65–84    HIGH
 * 85–100   CRITICAL
 *
 * Hard-Stop Conditions
 * --------------------
 * The following conditions force CRITICAL severity:
 *
 * • Regulatory violation
 * • Ledger integrity violation
 * • Closed accounting period impact
 * • Systemic failure
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Explainable
 * • Policy driven
 * • Immutable outputs
 * • Audit friendly
 * • No database access
 * • No side effects
 * • Configuration validated
 *
 * IMPORTANT
 * ---------
 * This component determines severity.
 *
 * It MUST NOT:
 * • execute repairs
 * • approve repairs
 * • modify ledger records
 * • persist results
 * • bypass compliance controls
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Severity Levels
 * ============================================================================
 */

const SEVERITY = Object.freeze({

    LOW: 'LOW',

    MEDIUM: 'MEDIUM',

    HIGH: 'HIGH',

    CRITICAL: 'CRITICAL'
});

/**
 * ============================================================================
 * Severity Rank
 * ============================================================================
 */

const SEVERITY_RANK = Object.freeze({

    LOW: 1,

    MEDIUM: 2,

    HIGH: 3,

    CRITICAL: 4
});

/**
 * ============================================================================
 * Default Weights
 * ============================================================================
 *
 * Total = 100%
 * ============================================================================
 */

const DEFAULT_WEIGHTS = Object.freeze({

    amountImpact: 30,

    regulatoryRisk: 25,

    customerImpact: 20,

    ledgerIntegrity: 15,

    repairAge: 10
});

/**
 * ============================================================================
 * Severity Thresholds
 * ============================================================================
 */

const SEVERITY_THRESHOLDS = Object.freeze({

    LOW_MAX: 39,

    MEDIUM_MAX: 64,

    HIGH_MAX: 84,

    CRITICAL_MIN: 85
});

/**
 * ============================================================================
 * Maximum Score
 * ============================================================================
 */

const MAX_SCORE = 100;

/**
 * ============================================================================
 * Minimum Score
 * ============================================================================
 */

const MIN_SCORE = 0;

/**
 * ============================================================================
 * Model Version
 * ============================================================================
 */

const MODEL_VERSION =
    'STATEMENT_REPAIR_SEVERITY_MODEL_V1';

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
 * Clamp score to the supported range.
 *
 * @param {*} value
 * @returns {number}
 */
function clampScore(value) {

    return Math.min(

        MAX_SCORE,

        Math.max(

            MIN_SCORE,

            toFiniteNumber(
                value,
                0
            )
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

    if (
        typeof value !== 'string'
    ) {

        return null;
    }

    return value
        .trim()
        .toUpperCase();
}

/**
 * Safely convert a date into a timestamp.
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
 * Freeze a shallow object copy.
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
 * Freeze an array copy.
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
 * Severity Scorer
 * ============================================================================
 */

class SeverityScorer {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {object} options
     * @param {object} options.weights
     * @param {Function} options.clock
     */
    constructor({

        weights = DEFAULT_WEIGHTS,

        clock = () => new Date()

    } = {}) {

        if (
            typeof clock !== 'function'
        ) {

            throw new TypeError(
                'clock must be a function.'
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
     * The severity model must always total exactly 100%.
     *
     * @param {object} weights
     * @returns {object}
     */
    validateWeights(
        weights
    ) {

        if (
            weights === null ||
            typeof weights !== 'object' ||
            Array.isArray(weights)
        ) {

            throw new TypeError(
                'Severity weights must be an object.'
            );
        }

        const normalized = {};

        for (
            const key
            of Object.keys(
                DEFAULT_WEIGHTS
            )
        ) {

            const value =
                toFiniteNumber(
                    weights[key],
                    NaN
                );

            if (
                !Number.isFinite(value)
            ) {

                throw new TypeError(
                    `Severity weight "${key}" must be a finite number.`
                );
            }

            if (
                value < 0
            ) {

                throw new RangeError(
                    `Severity weight "${key}" cannot be negative.`
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
                `Severity weights must total 100. Received ${total}.`
            );
        }

        return normalized;
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     *
     * @param {object} repair
     * @returns {object}
     */
    calculateSeverityScore(
        repair = {}
    ) {

        this.assertRepairObject(
            repair
        );

        const breakdown = {

            amountImpact:
                this.scoreAmountImpact(
                    repair
                ),

            regulatoryRisk:
                this.scoreRegulatoryRisk(
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

        const weightedScore =
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
                    weightedScore
                )
            );

        const hardStops =
            this.evaluateHardStops(
                repair,
                breakdown
            );

        const severity =
            this.resolveSeverity(
                score,
                repair,
                breakdown
            );

        const severityDrivers =
            this.identifySeverityDrivers(
                breakdown,
                weightedBreakdown
            );

        const escalation =
            this.determineEscalation(
                severity,
                score,
                hardStops
            );

        return Object.freeze({

            repairId:
                repair.repairId ??
                repair.id ??
                null,

            score,

            severity,

            severityRank:
                SEVERITY_RANK[
                    severity
                ],

            breakdown:
                freezeObject(
                    breakdown
                ),

            weightedBreakdown:
                freezeObject(
                    weightedBreakdown
                ),

            severityDrivers,

            hardStops,

            escalation,

            explanation:
                this.buildExplanation(
                    score,
                    severity,
                    severityDrivers,
                    hardStops,
                    escalation
                ),

            modelVersion:
                this.modelVersion,

            calculatedAt:
                this.clock()
        });
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
            const [key, value]
            of Object.entries(
                breakdown
            )
        ) {

            const normalizedScore =
                clampScore(
                    value
                );

            const weight =
                this.weights[key];

            weighted[key] =
                Number(
                    (
                        normalizedScore *
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
     * Amount Impact
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreAmountImpact(
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

        if (
            amount >= 5000000
        ) return 100;

        if (
            amount >= 1000000
        ) return 90;

        if (
            amount >= 500000
        ) return 80;

        if (
            amount >= 100000
        ) return 65;

        if (
            amount >= 25000
        ) return 45;

        if (
            amount >= 5000
        ) return 25;

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
            repair.regulatoryReportable === true
        ) {

            return 80;
        }

        if (
            repair.requiresComplianceReview === true
        ) {

            return 60;
        }

        return 10;
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

                return 50;

            case 'LOW':

                return 20;

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
            repair.requiresManualJournal === true
        ) {

            return 50;
        }

        return 15;
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

        if (
            createdAt === null
        ) {

            return 0;
        }

        const now =
            this.getCurrentTimestamp();

        /**
         * Future timestamps are not treated as aged repairs.
         */
        if (
            createdAt >= now
        ) {

            return 0;
        }

        const ageDays =
            (
                now -
                createdAt
            ) /
            MS_PER_DAY;

        if (
            ageDays >= 60
        ) return 100;

        if (
            ageDays >= 30
        ) return 90;

        if (
            ageDays >= 14
        ) return 75;

        if (
            ageDays >= 7
        ) return 60;

        if (
            ageDays >= 3
        ) return 35;

        return 15;
    }

    /**
     * =========================================================================
     * Hard-Stop Evaluation
     * =========================================================================
     *
     * Hard-stop conditions are independently recorded so auditors and
     * downstream engines can distinguish:
     *
     * "high mathematical severity"
     *
     * from:
     *
     * "mandatory critical escalation condition".
     *
     * @param {object} repair
     * @param {object} breakdown
     * @returns {object}
     */
    evaluateHardStops(
        repair,
        breakdown
    ) {

        const conditions = [];

        if (
            repair.regulatoryViolation === true
        ) {

            conditions.push({

                code:
                    'REGULATORY_VIOLATION',

                severity:
                    SEVERITY.CRITICAL,

                reason:
                    'Regulatory violation detected.'
            });
        }

        if (
            repair.ledgerIntegrityViolation === true
        ) {

            conditions.push({

                code:
                    'LEDGER_INTEGRITY_VIOLATION',

                severity:
                    SEVERITY.CRITICAL,

                reason:
                    'Ledger integrity violation detected.'
            });
        }

        if (
            repair.closedPeriodImpact === true
        ) {

            conditions.push({

                code:
                    'CLOSED_PERIOD_IMPACT',

                severity:
                    SEVERITY.CRITICAL,

                reason:
                    'Repair affects a closed accounting period.'
            });
        }

        if (
            repair.systemicFailure === true
        ) {

            conditions.push({

                code:
                    'SYSTEMIC_FAILURE',

                severity:
                    SEVERITY.CRITICAL,

                reason:
                    'Systemic financial processing failure detected.'
            });
        }

        if (
            breakdown.ledgerIntegrity >= 100
        ) {

            const alreadyRecorded =
                conditions.some(
                    condition =>
                        condition.code ===
                        'LEDGER_INTEGRITY_VIOLATION'
                );

            if (
                !alreadyRecorded
            ) {

                conditions.push({

                    code:
                        'CRITICAL_LEDGER_RISK',

                    severity:
                        SEVERITY.CRITICAL,

                    reason:
                        'Ledger integrity score reached the critical threshold.'
                });
            }
        }

        return freezeObject({

            triggered:
                conditions.length > 0,

            count:
                conditions.length,

            conditions:
                freezeArray(
                    conditions.map(
                        condition =>
                            freezeObject(
                                condition
                            )
                    )
                )
        });
    }

    /**
     * =========================================================================
     * Severity Resolution
     * =========================================================================
     *
     * @param {number} score
     * @param {object} repair
     * @param {object} breakdown
     * @returns {string}
     */
    resolveSeverity(
        score,
        repair,
        breakdown
    ) {

        /**
         * Hard-stop conditions always win.
         */
        if (
            repair.regulatoryViolation === true ||
            repair.ledgerIntegrityViolation === true ||
            repair.closedPeriodImpact === true ||
            repair.systemicFailure === true ||
            breakdown.ledgerIntegrity >= 100
        ) {

            return SEVERITY.CRITICAL;
        }

        const normalizedScore =
            clampScore(
                score
            );

        if (
            normalizedScore >=
            SEVERITY_THRESHOLDS.CRITICAL_MIN
        ) {

            return SEVERITY.CRITICAL;
        }

        if (
            normalizedScore >= 65
        ) {

            return SEVERITY.HIGH;
        }

        if (
            normalizedScore >= 40
        ) {

            return SEVERITY.MEDIUM;
        }

        return SEVERITY.LOW;
    }

    /**
     * =========================================================================
     * Escalation Determination
     * =========================================================================
     *
     * Escalation is a policy decision separate from severity classification.
     *
     * @param {string} severity
     * @param {number} score
     * @param {object} hardStops
     * @returns {object}
     */
    determineEscalation(
        severity,
        score,
        hardStops
    ) {

        const reasons = [];

        if (
            hardStops.triggered
        ) {

            reasons.push(
                ...hardStops.conditions.map(
                    condition =>
                        condition.reason
                )
            );
        }

        if (
            severity ===
            SEVERITY.CRITICAL
        ) {

            reasons.push(
                'Repair classified as CRITICAL severity.'
            );
        }

        return freezeObject({

            required:
                reasons.length > 0,

            reasons:
                freezeArray(
                    [
                        ...new Set(
                            reasons
                        )
                    ]
                ),

            hardStop:
                hardStops.triggered,

            severityEscalation:
                severity ===
                SEVERITY.CRITICAL,

            score:
                clampScore(
                    score
                )
        });
    }

    /**
     * =========================================================================
     * Severity Drivers
     * =========================================================================
     *
     * @param {object} breakdown
     * @param {object} weightedBreakdown
     * @returns {Array<object>}
     */
    identifySeverityDrivers(
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
                                    breakdown[
                                        factor
                                    ]
                                ),

                            weight:
                                this.weights[
                                    factor
                                ],

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
     * @param {string} severity
     * @param {Array<object>} drivers
     * @param {object} hardStops
     * @param {object} escalation
     * @returns {object}
     */
    buildExplanation(
        score,
        severity,
        drivers,
        hardStops,
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
            `Severity score is ${score}/100 and classified as ${severity}.`;

        if (
            topDrivers.length > 0
        ) {

            summary +=
                ` Primary severity drivers: ${topDrivers.join(', ')}.`;
        }

        if (
            hardStops.triggered
        ) {

            summary +=
                ' One or more hard-stop conditions require critical treatment.';
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

            severity,

            topDrivers:
                freezeArray(
                    topDrivers
                ),

            hardStopTriggered:
                hardStops.triggered,

            escalationRequired:
                escalation.required
        });
    }

    /**
     * =========================================================================
     * Configuration
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

            thresholds:
                freezeObject({
                    ...SEVERITY_THRESHOLDS
                }),

            severityLevels:
                freezeArray(
                    Object.values(
                        SEVERITY
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
                'Severity scorer clock returned an invalid date.'
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

SeverityScorer.SEVERITY =
    SEVERITY;

SeverityScorer.SEVERITY_RANK =
    SEVERITY_RANK;

SeverityScorer.DEFAULT_WEIGHTS =
    DEFAULT_WEIGHTS;

SeverityScorer.SEVERITY_THRESHOLDS =
    SEVERITY_THRESHOLDS;

SeverityScorer.MAX_SCORE =
    MAX_SCORE;

SeverityScorer.MODEL_VERSION =
    MODEL_VERSION;

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    SeverityScorer;

module.exports.SEVERITY =
    SEVERITY;

module.exports.SEVERITY_RANK =
    SEVERITY_RANK;

module.exports.DEFAULT_WEIGHTS =
    DEFAULT_WEIGHTS;

module.exports.SEVERITY_THRESHOLDS =
    SEVERITY_THRESHOLDS;

module.exports.MAX_SCORE =
    MAX_SCORE;

module.exports.MODEL_VERSION =
    MODEL_VERSION;