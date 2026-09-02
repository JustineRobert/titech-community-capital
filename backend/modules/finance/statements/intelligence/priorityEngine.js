'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Priority Engine
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/priorityEngine.js
 *
 * Purpose
 * -------
 * Deterministically calculates and ranks repair priorities for the Statement
 * Intelligence subsystem.
 *
 * Responsibilities
 * ----------------
 * • Calculate weighted repair priority scores
 * • Prioritize individual repairs
 * • Prioritize repair batches
 * • Build deterministic execution queues
 * • Explain scoring decisions
 * • Support executive / operational reporting
 * • Preserve audit-friendly scoring metadata
 * • Support configurable scoring weights
 *
 * Design Principles
 * -----------------
 * • Pure scoring logic
 * • No database access
 * • No external service dependencies
 * • No mutation of caller-owned objects
 * • Deterministic ordering
 * • Bounded scores
 * • Validated configuration
 * • Audit-friendly explanations
 * • Backward-compatible public API
 *
 * Important
 * ---------
 * The engine intentionally does not execute repairs.
 * It determines ORDER and PRIORITY only.
 *
 * Execution belongs to the repair orchestration layer.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PRIORITY = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
});

const PRIORITY_RANK = Object.freeze({
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4
});

const DEFAULT_WEIGHTS = Object.freeze({
    financialExposure: 30,
    customerImpact: 20,
    regulatoryUrgency: 20,
    settlementDependency: 10,
    accountingPeriod: 10,
    repairAge: 5,
    severity: 5
});

const SCORE_RANGE = Object.freeze({
    MIN: 0,
    MAX: 100
});

const PRIORITY_THRESHOLDS = Object.freeze({
    CRITICAL: 85,
    HIGH: 65,
    MEDIUM: 40,
    LOW: 0
});

const DEFAULT_VALUES = Object.freeze({
    financialExposure: 10,
    customerImpact: 10,
    regulatoryUrgency: 20,
    settlementDependency: 15,
    accountingPeriod: 25,
    repairAge: 0,
    severity: 10
});

const MS_PER_DAY = 86400000;

const WEIGHT_TOLERANCE = 0.000001;

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Safely convert a value to a finite number.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

/**
 * Clamp a score to the supported scoring range.
 *
 * @param {*} value
 * @returns {number}
 */
function clampScore(value) {
    const number = toFiniteNumber(value, 0);

    return Math.min(
        SCORE_RANGE.MAX,
        Math.max(
            SCORE_RANGE.MIN,
            number
        )
    );
}

/**
 * Normalize an enum-like string.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeEnum(value) {
    if (typeof value !== 'string') {
        return null;
    }

    return value.trim().toUpperCase();
}

/**
 * Convert a date into a timestamp safely.
 *
 * @param {*} value
 * @returns {number|null}
 */
function toTimestamp(value) {
    if (value instanceof Date) {
        const timestamp = value.getTime();

        return Number.isFinite(timestamp)
            ? timestamp
            : null;
    }

    if (
        typeof value !== 'string' &&
        typeof value !== 'number'
    ) {
        return null;
    }

    const timestamp = new Date(value).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : null;
}

/**
 * Safely freeze an object.
 *
 * @param {object} object
 * @returns {object}
 */
function freezeObject(object) {
    return Object.freeze(object);
}

/**
 * ============================================================================
 * Priority Engine
 * ============================================================================
 */

class PriorityEngine {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {object} options
     * @param {object} options.weights
     */
    constructor(options = {}) {

        if (
            options === null ||
            typeof options !== 'object' ||
            Array.isArray(options)
        ) {
            throw new TypeError(
                'PriorityEngine options must be an object.'
            );
        }

        const suppliedWeights =
            options.weights || {};

        this.weights = freezeObject(
            this.validateWeights({
                ...DEFAULT_WEIGHTS,
                ...suppliedWeights
            })
        );

        this.thresholds = PRIORITY_THRESHOLDS;
        this.scoreRange = SCORE_RANGE;
    }

    /**
     * =========================================================================
     * Validate Weights
     * =========================================================================
     *
     * Weights must represent percentages and therefore sum to 100.
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
                'Priority weights must be an object.'
            );
        }

        const expectedKeys =
            Object.keys(DEFAULT_WEIGHTS);

        const normalized = {};

        for (const key of expectedKeys) {

            const value =
                toFiniteNumber(weights[key], NaN);

            if (!Number.isFinite(value)) {
                throw new TypeError(
                    `Priority weight "${key}" must be a finite number.`
                );
            }

            if (value < 0) {
                throw new RangeError(
                    `Priority weight "${key}" cannot be negative.`
                );
            }

            normalized[key] = value;
        }

        const total =
            Object.values(normalized)
                .reduce(
                    (sum, value) => sum + value,
                    0
                );

        if (
            Math.abs(
                total - SCORE_RANGE.MAX
            ) > WEIGHT_TOLERANCE
        ) {
            throw new RangeError(
                `Priority weights must total 100. Received ${total}.`
            );
        }

        return normalized;
    }

    /**
     * =========================================================================
     * Get Configuration
     * =========================================================================
     *
     * Returns an immutable configuration snapshot useful for:
     * • audit records
     * • executive reporting
     * • debugging
     * • reproducibility
     *
     * @returns {object}
     */
    getConfiguration() {

        return freezeObject({
            weights: freezeObject({
                ...this.weights
            }),
            thresholds: freezeObject({
                ...this.thresholds
            }),
            scoreRange: freezeObject({
                ...this.scoreRange
            })
        });
    }

    /**
     * =========================================================================
     * Prioritize Single Repair
     * =========================================================================
     *
     * @param {object} repair
     * @returns {object}
     */
    prioritizeRepair(repair = {}) {

        this.assertRepairObject(repair);

        const result =
            this.calculatePriorityScore(repair);

        const priority =
            this.resolvePriority(result.score);

        return freezeObject({

            repairId:
                repair.repairId ??
                repair.id ??
                null,

            score:
                result.score,

            priority,

            priorityRank:
                PRIORITY_RANK[priority],

            breakdown:
                result.breakdown,

            weightedBreakdown:
                result.weightedBreakdown,

            explanation:
                result.explanation
        });
    }

    /**
     * =========================================================================
     * Prioritize Batch
     * =========================================================================
     *
     * Deterministic ordering:
     *
     * 1. Score descending
     * 2. Priority rank descending
     * 3. Creation timestamp ascending
     * 4. Repair ID ascending
     * 5. Original input position ascending
     *
     * The final criterion guarantees deterministic ordering even when all
     * business attributes are identical.
     *
     * @param {Array<object>} repairs
     * @returns {Array<object>}
     */
    prioritizeBatch(repairs = []) {

        if (!Array.isArray(repairs)) {
            throw new TypeError(
                'repairs must be an array.'
            );
        }

        const prioritized =
            repairs.map(
                (repair, originalIndex) => {

                    this.assertRepairObject(repair);

                    return {
                        repair,
                        originalIndex,
                        priority:
                            this.prioritizeRepair(repair)
                    };
                }
            );

        prioritized.sort(
            (a, b) =>
                this.comparePriorityEntries(a, b)
        );

        return prioritized.map(
            (entry, index) =>
                freezeObject({

                    ...entry.priority,

                    queuePosition:
                        index + 1
                })
        );
    }

    /**
     * =========================================================================
     * Build Execution Queue
     * =========================================================================
     *
     * Produces an explicit queue representation suitable for downstream
     * orchestration services.
     *
     * No repair is executed here.
     *
     * @param {Array<object>} repairs
     * @returns {Array<object>}
     */
    buildExecutionQueue(repairs = []) {

        return this.prioritizeBatch(repairs)
            .map(entry =>
                freezeObject({

                    queuePosition:
                        entry.queuePosition,

                    repairId:
                        entry.repairId,

                    priority:
                        entry.priority,

                    priorityRank:
                        entry.priorityRank,

                    score:
                        entry.score,

                    status:
                        'QUEUED',

                    explanation:
                        entry.explanation,

                    breakdown:
                        entry.breakdown,

                    weightedBreakdown:
                        entry.weightedBreakdown
                })
            );
    }

    /**
     * =========================================================================
     * Calculate Weighted Score
     * =========================================================================
     *
     * Each dimension produces a normalized 0–100 score.
     *
     * The configured percentage weight is then applied.
     *
     * Example:
     *
     * financialExposure = 80
     * financialExposure weight = 30%
     *
     * contribution = 80 × 0.30 = 24
     *
     * @param {object} repair
     * @returns {object}
     */
    calculatePriorityScore(repair = {}) {

        this.assertRepairObject(repair);

        const breakdown = {

            financialExposure:
                this.scoreFinancialExposure(repair),

            customerImpact:
                this.scoreCustomerImpact(repair),

            regulatoryUrgency:
                this.scoreRegulatoryUrgency(repair),

            settlementDependency:
                this.scoreSettlementDependency(repair),

            accountingPeriod:
                this.scoreAccountingPeriod(repair),

            repairAge:
                this.scoreRepairAge(repair),

            severity:
                this.scoreSeverity(repair)
        };

        const weightedBreakdown = {};

        let rawScore = 0;

        Object.entries(breakdown)
            .forEach(([key, value]) => {

                const normalizedValue =
                    clampScore(value);

                const weight =
                    this.weights[key];

                const contribution =
                    normalizedValue *
                    (weight / SCORE_RANGE.MAX);

                weightedBreakdown[key] =
                    Number(
                        contribution.toFixed(6)
                    );

                rawScore += contribution;
            });

        const score =
            Math.round(
                clampScore(rawScore)
            );

        const explanation =
            this.buildExplanation(
                breakdown,
                weightedBreakdown,
                score
            );

        return {

            score,

            breakdown:
                freezeObject({
                    ...breakdown
                }),

            weightedBreakdown:
                freezeObject({
                    ...weightedBreakdown
                }),

            explanation
        };
    }

    /**
     * =========================================================================
     * Financial Exposure
     * =========================================================================
     *
     * Exposure bands intentionally remain deterministic and transparent.
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreFinancialExposure(repair = {}) {

        const amount =
            Math.abs(
                toFiniteNumber(
                    repair.amount ??
                    repair.evidence?.amount,
                    0
                )
            );

        if (amount >= 1000000) return 100;
        if (amount >= 250000) return 90;
        if (amount >= 100000) return 75;
        if (amount >= 25000) return 55;
        if (amount >= 5000) return 35;

        return DEFAULT_VALUES.financialExposure;
    }

    /**
     * =========================================================================
     * Customer Impact
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreCustomerImpact(repair = {}) {

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
                return DEFAULT_VALUES.customerImpact;
        }
    }

    /**
     * =========================================================================
     * Regulatory Urgency
     * =========================================================================
     *
     * Supports both boolean and explicit severity values.
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreRegulatoryUrgency(repair = {}) {

        if (repair.regulatory === true) {
            return 100;
        }

        switch (
            normalizeEnum(
                repair.regulatoryUrgency
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
                return DEFAULT_VALUES.regulatoryUrgency;
        }
    }

    /**
     * =========================================================================
     * Settlement Dependency
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreSettlementDependency(repair = {}) {

        if (
            repair.blocksSettlement === true
        ) {
            return 100;
        }

        switch (
            normalizeEnum(
                repair.settlementDependency
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
                return DEFAULT_VALUES.settlementDependency;
        }
    }

    /**
     * =========================================================================
     * Accounting Period
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreAccountingPeriod(repair = {}) {

        if (
            repair.periodClosing === true
        ) {
            return 100;
        }

        switch (
            normalizeEnum(
                repair.accountingPeriodUrgency
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
                return DEFAULT_VALUES.accountingPeriod;
        }
    }

    /**
     * =========================================================================
     * Repair Age
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreRepairAge(repair = {}) {

        const createdAt =
            toTimestamp(
                repair.createdAt
            );

        if (createdAt === null) {
            return DEFAULT_VALUES.repairAge;
        }

        const now =
            Date.now();

        /**
         * Future timestamps are treated as zero age rather than producing a
         * negative age score.
         */
        if (createdAt >= now) {
            return DEFAULT_VALUES.repairAge;
        }

        const ageDays =
            (now - createdAt) /
            MS_PER_DAY;

        if (ageDays >= 30) return 100;
        if (ageDays >= 14) return 80;
        if (ageDays >= 7) return 60;
        if (ageDays >= 3) return 40;

        return 15;
    }

    /**
     * =========================================================================
     * Severity
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    scoreSeverity(repair = {}) {

        switch (
            normalizeEnum(
                repair.severity
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
                return DEFAULT_VALUES.severity;
        }
    }

    /**
     * =========================================================================
     * Resolve Priority
     * =========================================================================
     *
     * @param {number} score
     * @returns {string}
     */
    resolvePriority(score) {

        const normalizedScore =
            clampScore(score);

        if (
            normalizedScore >=
            this.thresholds.CRITICAL
        ) {
            return PRIORITY.CRITICAL;
        }

        if (
            normalizedScore >=
            this.thresholds.HIGH
        ) {
            return PRIORITY.HIGH;
        }

        if (
            normalizedScore >=
            this.thresholds.MEDIUM
        ) {
            return PRIORITY.MEDIUM;
        }

        return PRIORITY.LOW;
    }

    /**
     * =========================================================================
     * Explain Scoring Decision
     * =========================================================================
     *
     * Returns human-readable and machine-friendly scoring explanations.
     *
     * @param {object} breakdown
     * @param {object} weightedBreakdown
     * @param {number} score
     * @returns {object}
     */
    buildExplanation(
        breakdown,
        weightedBreakdown,
        score
    ) {

        const contributors =
            Object.keys(breakdown)
                .map(key => ({
                    factor: key,
                    rawScore:
                        breakdown[key],
                    weight:
                        this.weights[key],
                    contribution:
                        weightedBreakdown[key]
                }))
                .sort(
                    (a, b) =>
                        b.contribution -
                        a.contribution
                );

        const topContributors =
            contributors
                .slice(0, 3)
                .map(
                    contributor =>
                        contributor.factor
                );

        const priority =
            this.resolvePriority(score);

        const summary =
            topContributors.length > 0
                ? `Priority ${priority} with a score of ${score}/100, primarily driven by ${topContributors.join(', ')}.`
                : `Priority ${priority} with a score of ${score}/100.`;

        return freezeObject({

            summary,

            priority,

            score,

            topContributors:
                Object.freeze([
                    ...topContributors
                ]),

            contributors:
                Object.freeze(
                    contributors.map(
                        contributor =>
                            freezeObject({
                                ...contributor
                            })
                    )
                )
        });
    }

    /**
     * =========================================================================
     * Compare Priority Entries
     * =========================================================================
     *
     * @param {object} a
     * @param {object} b
     * @returns {number}
     */
    comparePriorityEntries(a, b) {

        if (
            b.priority.score !==
            a.priority.score
        ) {
            return (
                b.priority.score -
                a.priority.score
            );
        }

        if (
            b.priority.priorityRank !==
            a.priority.priorityRank
        ) {
            return (
                b.priority.priorityRank -
                a.priority.priorityRank
            );
        }

        const aCreatedAt =
            toTimestamp(
                a.repair.createdAt
            );

        const bCreatedAt =
            toTimestamp(
                b.repair.createdAt
            );

        /**
         * Repairs without valid dates are placed after repairs with valid
         * dates, preserving deterministic behaviour.
         */
        if (
            aCreatedAt !== null &&
            bCreatedAt !== null &&
            aCreatedAt !== bCreatedAt
        ) {
            return aCreatedAt - bCreatedAt;
        }

        if (
            aCreatedAt !== null &&
            bCreatedAt === null
        ) {
            return -1;
        }

        if (
            aCreatedAt === null &&
            bCreatedAt !== null
        ) {
            return 1;
        }

        const aId =
            String(
                a.repair.repairId ??
                a.repair.id ??
                ''
            );

        const bId =
            String(
                b.repair.repairId ??
                b.repair.id ??
                ''
            );

        if (aId < bId) return -1;
        if (aId > bId) return 1;

        return (
            a.originalIndex -
            b.originalIndex
        );
    }

    /**
     * =========================================================================
     * Validate Repair Input
     * =========================================================================
     *
     * @param {*} repair
     */
    assertRepairObject(repair) {

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

PriorityEngine.PRIORITY =
    PRIORITY;

PriorityEngine.PRIORITY_RANK =
    PRIORITY_RANK;

PriorityEngine.DEFAULT_WEIGHTS =
    DEFAULT_WEIGHTS;

PriorityEngine.PRIORITY_THRESHOLDS =
    PRIORITY_THRESHOLDS;

PriorityEngine.SCORE_RANGE =
    SCORE_RANGE;

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    PriorityEngine;

module.exports.PRIORITY =
    PRIORITY;

module.exports.PRIORITY_RANK =
    PRIORITY_RANK;

module.exports.DEFAULT_WEIGHTS =
    DEFAULT_WEIGHTS;

module.exports.PRIORITY_THRESHOLDS =
    PRIORITY_THRESHOLDS;

module.exports.SCORE_RANGE =
    SCORE_RANGE;