'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * SuspiciousRepairScorer
 * ============================================================================
 *
 * Enterprise fraud-risk scoring engine for financial statement repairs.
 *
 * Location:
 *   backend/modules/finance/statements/fraud/SuspiciousRepairScorer.js
 *
 * Responsibilities
 * ----------------
 * - Calculate deterministic fraud/suspicion risk for a proposed repair.
 * - Combine repair, transaction, account, behavioural and correlation signals.
 * - Apply configurable risk weights and policy thresholds.
 * - Produce explainable risk factors and recommendations.
 * - Support confidence-aware scoring.
 * - Support tenant isolation.
 * - Remain strictly read-only.
 * - Produce deterministic results for identical inputs.
 * - Avoid making transactional or ledger mutations.
 *
 * This component DOES NOT:
 * - approve repairs;
 * - execute repairs;
 * - modify ledger entries;
 * - modify statements;
 * - modify accounts;
 * - create fraud alerts;
 * - block transactions;
 * - persist scoring results.
 *
 * Downstream components may use the result to make those decisions.
 *
 * Design principles
 * -----------------
 * 1. Deterministic
 * 2. Explainable
 * 3. Auditable
 * 4. Tenant-aware
 * 5. Fail-safe
 * 6. Configuration-driven
 * 7. Dependency-injection friendly
 * 8. Backward-compatible
 * 9. Read-only
 * 10. Production observability friendly
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULTS = Object.freeze({
    VERSION: '1.0.0',

    MIN_SCORE: 0,
    MAX_SCORE: 100,

    DEFAULT_CONFIDENCE: 0.50,

    HIGH_RISK_THRESHOLD: 70,
    CRITICAL_RISK_THRESHOLD: 85,
    REVIEW_THRESHOLD: 55,

    MAX_FACTORS: 50,

    /**
     * Maximum number of historical events consumed by helper calculations.
     * This protects the scorer from unexpectedly large payloads.
     */
    MAX_HISTORY_ITEMS: 500,

    /**
     * Maximum age of a signal in days before it is considered stale.
     */
    MAX_SIGNAL_AGE_DAYS: 365,

    /**
     * Default risk weights.
     *
     * Weights do not need to sum to 100 because individual factor
     * contributions are normalized independently.
     */
    WEIGHTS: Object.freeze({
        repairType: 0.14,
        amount: 0.12,
        frequency: 0.10,
        velocity: 0.08,
        duplication: 0.12,
        sequence: 0.08,
        accountBehaviour: 0.08,
        crossAccount: 0.10,
        historicalFraud: 0.10,
        timing: 0.04,
        metadata: 0.04
    }),

    /**
     * Repair types that deserve elevated scrutiny.
     *
     * These values deliberately use normalized identifiers so that different
     * enum/string representations can be handled safely.
     */
    HIGH_RISK_REPAIR_TYPES: Object.freeze([
        'MISSING_LEDGER_ENTRY',
        'FAILED_SETTLEMENT_POSTING',
        'LOAN_REPAYMENT_VARIANCE',
        'BALANCE_ADJUSTMENT',
        'MANUAL_ADJUSTMENT',
        'UNKNOWN_REPAIR',
        'UNCLASSIFIED'
    ]),

    CRITICAL_REPAIR_TYPES: Object.freeze([
        'MANUAL_ADJUSTMENT',
        'BALANCE_ADJUSTMENT'
    ])
});

/**
 * ============================================================================
 * Enumerations
 * ============================================================================
 */

const RISK_LEVEL = Object.freeze({
    LOW: 'LOW',
    MODERATE: 'MODERATE',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
});

const RECOMMENDATION = Object.freeze({
    PROCEED: 'PROCEED',
    PROCEED_WITH_MONITORING: 'PROCEED_WITH_MONITORING',
    REQUIRE_REVIEW: 'REQUIRE_REVIEW',
    ESCALATE: 'ESCALATE',
    BLOCK_AUTOMATION: 'BLOCK_AUTOMATION'
});

const SIGNAL_DIRECTION = Object.freeze({
    POSITIVE: 'POSITIVE',
    NEGATIVE: 'NEGATIVE',
    NEUTRAL: 'NEUTRAL'
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, min, max) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return min;
    }

    return Math.min(max, Math.max(min, numeric));
}

function toNumber(value, fallback = 0) {
    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : fallback;
}

function toBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (value === 'true' || value === 1 || value === '1') {
        return true;
    }

    if (value === 'false' || value === 0 || value === '0') {
        return false;
    }

    return fallback;
}

function normalizeString(value, fallback = '') {
    if (value === null || value === undefined) {
        return fallback;
    }

    return String(value)
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
}

function safeDate(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from, to = new Date()) {
    const start = safeDate(from);
    const end = safeDate(to);

    if (!start || !end) {
        return null;
    }

    return Math.max(
        0,
        (end.getTime() - start.getTime()) / 86400000
    );
}

function percentage(value) {
    return Math.round(clamp(value, 0, 100) * 100) / 100;
}

function round(value, decimals = 4) {
    const factor = 10 ** decimals;

    return Math.round(toNumber(value) * factor) / factor;
}

function stableStringify(value) {
    if (value === null || value === undefined) {
        return String(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (isObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function createHash(value) {
    return crypto
        .createHash('sha256')
        .update(stableStringify(value))
        .digest('hex');
}

function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }

    return undefined;
}

/**
 * ============================================================================
 * Default Logger
 * ============================================================================
 */

const noopLogger = Object.freeze({
    debug() {},
    info() {},
    warn() {},
    error() {}
});

/**
 * ============================================================================
 * SuspiciousRepairScorer
 * ============================================================================
 */

class SuspiciousRepairScorer {

    /**
     * @param {Object} [options]
     * @param {Object} [options.logger]
     * @param {Object} [options.config]
     * @param {Object} [options.metrics]
     * @param {Object} [options.policy]
     * @param {Object} [options.clock]
     */
    constructor(options = {}) {

        if (!isObject(options)) {
            throw new TypeError(
                'SuspiciousRepairScorer options must be an object.'
            );
        }

        this.logger = options.logger || noopLogger;
        this.metrics = options.metrics || null;
        this.policy = options.policy || null;
        this.clock = options.clock || {
            now: () => new Date()
        };

        this.config = this._buildConfig(options.config);

        this.version = this.config.version;
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    /**
     * Score a proposed repair.
     *
     * Supported call styles:
     *
     *   scorer.score(input)
     *
     *   scorer.calculate(input)
     *
     * @param {Object} input
     * @returns {Object}
     */
    score(input = {}) {

        const startedAt = this._now();

        try {

            const context = this._normalizeInput(input);

            const factors = [];

            this._safeFactor(
                factors,
                'repairType',
                () => this._scoreRepairType(context)
            );

            this._safeFactor(
                factors,
                'amount',
                () => this._scoreAmount(context)
            );

            this._safeFactor(
                factors,
                'frequency',
                () => this._scoreFrequency(context)
            );

            this._safeFactor(
                factors,
                'velocity',
                () => this._scoreVelocity(context)
            );

            this._safeFactor(
                factors,
                'duplication',
                () => this._scoreDuplication(context)
            );

            this._safeFactor(
                factors,
                'sequence',
                () => this._scoreSequence(context)
            );

            this._safeFactor(
                factors,
                'accountBehaviour',
                () => this._scoreAccountBehaviour(context)
            );

            this._safeFactor(
                factors,
                'crossAccount',
                () => this._scoreCrossAccount(context)
            );

            this._safeFactor(
                factors,
                'historicalFraud',
                () => this._scoreHistoricalFraud(context)
            );

            this._safeFactor(
                factors,
                'timing',
                () => this._scoreTiming(context)
            );

            this._safeFactor(
                factors,
                'metadata',
                () => this._scoreMetadata(context)
            );

            const aggregate = this._aggregateFactors(factors);

            const confidence = this._calculateConfidence(
                context,
                factors
            );

            const adjustedScore = this._applyConfidenceAdjustment(
                aggregate.score,
                confidence
            );

            const finalScore = percentage(adjustedScore);

            const riskLevel = this._determineRiskLevel(finalScore);

            const recommendation = this._determineRecommendation(
                finalScore,
                riskLevel,
                context,
                confidence
            );

            const result = this._buildResult({
                context,
                factors,
                rawScore: aggregate.score,
                finalScore,
                confidence,
                riskLevel,
                recommendation,
                startedAt
            });

            this._recordMetric('score.completed', {
                tenantId: context.tenantId,
                riskLevel,
                recommendation
            });

            return result;

        } catch (error) {

            this._recordMetric('score.failed');

            this.logger.error(
                '[SuspiciousRepairScorer] Scoring failed.',
                {
                    error: error.message,
                    stack: error.stack
                }
            );

            return this._buildFailureResult(
                input,
                error,
                startedAt
            );
        }
    }

    /**
     * Alias retained for integration flexibility.
     */
    calculate(input = {}) {
        return this.score(input);
    }

    /**
     * Async-compatible API.
     *
     * This deliberately performs no I/O but allows the engine to be placed
     * behind async orchestration without changing callers later.
     */
    async scoreAsync(input = {}) {
        return this.score(input);
    }

    /**
     * Determine whether a repair should receive enhanced review.
     *
     * @param {Object} input
     * @returns {boolean}
     */
    isSuspicious(input = {}) {
        const result = this.score(input);

        return result.score >= this.config.reviewThreshold;
    }

    /**
     * Determine whether automation should be blocked.
     *
     * @param {Object} input
     * @returns {boolean}
     */
    shouldBlockAutomation(input = {}) {
        const result = this.score(input);

        return result.recommendation === RECOMMENDATION.BLOCK_AUTOMATION;
    }

    /**
     * Return only the risk score.
     *
     * @param {Object} input
     * @returns {number}
     */
    getScore(input = {}) {
        return this.score(input).score;
    }

    /**
     * Return the risk level.
     *
     * @param {Object} input
     * @returns {string}
     */
    getRiskLevel(input = {}) {
        return this.score(input).riskLevel;
    }

    /**
     * Validate a scoring context without calculating risk.
     *
     * @param {Object} input
     * @returns {Object}
     */
    validateInput(input = {}) {

        const errors = [];
        const warnings = [];

        if (!isObject(input)) {
            errors.push('Input must be an object.');

            return {
                valid: false,
                errors,
                warnings
            };
        }

        const tenantId = firstDefined(
            input.tenantId,
            input.context && input.context.tenantId
        );

        if (!tenantId) {
            warnings.push(
                'tenantId is not supplied; tenant-scoped audit correlation may be limited.'
            );
        }

        const repair = input.repair || input.repairCandidate || input;

        if (!isObject(repair)) {
            errors.push('Repair context is invalid.');
        }

        const amount = firstDefined(
            repair.amount,
            repair.repairAmount,
            repair.varianceAmount,
            repair.transactionAmount
        );

        if (
            amount !== undefined &&
            amount !== null &&
            !Number.isFinite(Number(amount))
        ) {
            errors.push('Repair amount must be numeric.');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    _buildConfig(config = {}) {

        const suppliedWeights = isObject(config.weights)
            ? config.weights
            : {};

        const weights = {
            ...DEFAULTS.WEIGHTS,
            ...suppliedWeights
        };

        for (const key of Object.keys(weights)) {
            weights[key] = Math.max(
                0,
                toNumber(weights[key], DEFAULTS.WEIGHTS[key] || 0)
            );
        }

        return Object.freeze({
            version: config.version || DEFAULTS.VERSION,

            minScore: clamp(
                firstDefined(config.minScore, DEFAULTS.MIN_SCORE),
                0,
                100
            ),

            maxScore: clamp(
                firstDefined(config.maxScore, DEFAULTS.MAX_SCORE),
                0,
                100
            ),

            defaultConfidence: clamp(
                firstDefined(
                    config.defaultConfidence,
                    DEFAULTS.DEFAULT_CONFIDENCE
                ),
                0,
                1
            ),

            reviewThreshold: clamp(
                firstDefined(
                    config.reviewThreshold,
                    DEFAULTS.REVIEW_THRESHOLD
                ),
                0,
                100
            ),

            highRiskThreshold: clamp(
                firstDefined(
                    config.highRiskThreshold,
                    DEFAULTS.HIGH_RISK_THRESHOLD
                ),
                0,
                100
            ),

            criticalRiskThreshold: clamp(
                firstDefined(
                    config.criticalRiskThreshold,
                    DEFAULTS.CRITICAL_RISK_THRESHOLD
                ),
                0,
                100
            ),

            maxFactors: Math.max(
                1,
                Math.floor(
                    toNumber(
                        config.maxFactors,
                        DEFAULTS.MAX_FACTORS
                    )
                )
            ),

            maxHistoryItems: Math.max(
                1,
                Math.floor(
                    toNumber(
                        config.maxHistoryItems,
                        DEFAULTS.MAX_HISTORY_ITEMS
                    )
                )
            ),

            maxSignalAgeDays: Math.max(
                1,
                toNumber(
                    config.maxSignalAgeDays,
                    DEFAULTS.MAX_SIGNAL_AGE_DAYS
                )
            ),

            weights,

            highRiskRepairTypes: new Set(
                Array.isArray(config.highRiskRepairTypes)
                    ? config.highRiskRepairTypes.map(normalizeString)
                    : DEFAULTS.HIGH_RISK_REPAIR_TYPES
            ),

            criticalRepairTypes: new Set(
                Array.isArray(config.criticalRepairTypes)
                    ? config.criticalRepairTypes.map(normalizeString)
                    : DEFAULTS.CRITICAL_REPAIR_TYPES
            )
        });
    }

    /**
     * =========================================================================
     * Input Normalization
     * =========================================================================
     */

    _normalizeInput(input) {

        const validation = this.validateInput(input);

        if (!validation.valid) {
            throw new TypeError(
                validation.errors.join(' ')
            );
        }

        const repair = input.repair ||
            input.repairCandidate ||
            {};

        const transaction = input.transaction ||
            input.statementTransaction ||
            {};

        const account = input.account || {};

        const context = isObject(input.context)
            ? input.context
            : {};

        const history = this._limitArray(
            firstDefined(
                input.history,
                input.repairHistory,
                context.history,
                []
            )
        );

        const fraudSignals = this._limitArray(
            firstDefined(
                input.fraudSignals,
                context.fraudSignals,
                []
            )
        );

        const correlationSignals = this._limitArray(
            firstDefined(
                input.correlationSignals,
                context.correlationSignals,
                []
            )
        );

        const behaviouralSignals = this._limitArray(
            firstDefined(
                input.behaviouralSignals,
                input.behaviorSignals,
                context.behaviouralSignals,
                []
            )
        );

        const crossAccountSignals = this._limitArray(
            firstDefined(
                input.crossAccountSignals,
                context.crossAccountSignals,
                []
            )
        );

        const now = this._now();

        return {
            raw: input,

            tenantId: firstDefined(
                input.tenantId,
                context.tenantId,
                repair.tenantId,
                transaction.tenantId
            ) || null,

            correlationId: firstDefined(
                input.correlationId,
                context.correlationId,
                repair.correlationId
            ) || null,

            repairId: firstDefined(
                repair.id,
                repair.repairId,
                input.repairId
            ) || null,

            statementId: firstDefined(
                repair.statementId,
                transaction.statementId,
                input.statementId
            ) || null,

            repair,

            transaction,

            account,

            history,

            fraudSignals,

            correlationSignals,

            behaviouralSignals,

            crossAccountSignals,

            modelSignals: isObject(input.modelSignals)
                ? input.modelSignals
                : {},

            now
        };
    }

    _limitArray(value) {

        if (!Array.isArray(value)) {
            return [];
        }

        return value.slice(
            Math.max(0, value.length - this.config.maxHistoryItems)
        );
    }

    /**
     * =========================================================================
     * Factor Scoring
     * =========================================================================
     */

    _scoreRepairType(context) {

        const type = normalizeString(
            firstDefined(
                context.repair.type,
                context.repair.repairType,
                context.repair.category,
                context.repair.reason
            ),
            'UNKNOWN_REPAIR'
        );

        let score = 20;

        if (this.config.highRiskRepairTypes.has(type)) {
            score = 65;
        }

        if (this.config.criticalRepairTypes.has(type)) {
            score = 85;
        }

        if (
            type === 'DUPLICATE_LEDGER_ENTRY' ||
            type === 'DUPLICATE_TRANSACTION'
        ) {
            score = 60;
        }

        if (
            type === 'MISSING_LEDGER_ENTRY' ||
            type === 'FAILED_SETTLEMENT_POSTING'
        ) {
            score = 55;
        }

        return this._factor({
            key: 'repairType',
            score,
            evidence: {
                repairType: type
            },
            reason: `Repair type ${type} carries a baseline suspicion score of ${score}.`
        });
    }

    _scoreAmount(context) {

        const amount = Math.abs(
            toNumber(
                firstDefined(
                    context.repair.amount,
                    context.repair.repairAmount,
                    context.repair.varianceAmount,
                    context.transaction.amount
                ),
                0
            )
        );

        const configuredThreshold = Math.abs(
            toNumber(
                firstDefined(
                    context.repair.materialityThreshold,
                    context.account.materialityThreshold,
                    context.raw.materialityThreshold
                ),
                0
            )
        );

        let score = 10;

        if (amount > 0) {
            score = 20;
        }

        if (configuredThreshold > 0) {

            if (amount >= configuredThreshold) {
                score = 60;
            }

            if (amount >= configuredThreshold * 2) {
                score = 80;
            }

            if (amount >= configuredThreshold * 5) {
                score = 95;
            }

        } else {

            /**
             * Relative thresholds are intentionally conservative because
             * absolute monetary materiality is tenant-specific.
             */
            const accountBalance = Math.abs(
                toNumber(
                    firstDefined(
                        context.account.balance,
                        context.transaction.accountBalance
                    ),
                    0
                )
            );

            if (accountBalance > 0) {

                const ratio = amount / accountBalance;

                if (ratio >= 0.10) {
                    score = 50;
                }

                if (ratio >= 0.25) {
                    score = 70;
                }

                if (ratio >= 0.50) {
                    score = 90;
                }
            }
        }

        return this._factor({
            key: 'amount',
            score,
            evidence: {
                amount,
                materialityThreshold: configuredThreshold || null
            },
            reason: 'Repair amount was evaluated against available materiality context.'
        });
    }

    _scoreFrequency(context) {

        const count = context.history.filter(item => {

            if (!isObject(item)) {
                return false;
            }

            const typeA = normalizeString(
                firstDefined(
                    item.type,
                    item.repairType,
                    item.category
                )
            );

            const typeB = normalizeString(
                firstDefined(
                    context.repair.type,
                    context.repair.repairType,
                    context.repair.category
                )
            );

            return !typeA || !typeB || typeA === typeB;

        }).length;

        let score = 10;

        if (count >= 3) {
            score = 35;
        }

        if (count >= 5) {
            score = 55;
        }

        if (count >= 10) {
            score = 75;
        }

        if (count >= 20) {
            score = 90;
        }

        return this._factor({
            key: 'frequency',
            score,
            evidence: {
                similarHistoricalRepairs: count
            },
            reason: 'Repeated similar repairs increase suspicion.'
        });
    }

    _scoreVelocity(context) {

        const timestamps = [
            ...context.history,
            ...context.behaviouralSignals
        ]
            .map(item => safeDate(
                firstDefined(
                    item.createdAt,
                    item.timestamp,
                    item.occurredAt,
                    item.date
                )
            ))
            .filter(Boolean)
            .sort((a, b) => b.getTime() - a.getTime());

        const now = context.now.getTime();

        const recent = timestamps.filter(date => (
            now - date.getTime() <= 24 * 60 * 60 * 1000
        ));

        let score = 5;

        if (recent.length >= 3) {
            score = 30;
        }

        if (recent.length >= 5) {
            score = 50;
        }

        if (recent.length >= 10) {
            score = 75;
        }

        if (recent.length >= 20) {
            score = 95;
        }

        return this._factor({
            key: 'velocity',
            score,
            evidence: {
                eventsLast24Hours: recent.length
            },
            reason: 'High repair or related-event velocity increases suspicion.'
        });
    }

    _scoreDuplication(context) {

        const duplicateFlags = [
            context.repair.isDuplicate,
            context.transaction.isDuplicate,
            context.repair.duplicateDetected
        ];

        const explicitDuplicate = duplicateFlags.some(
            value => toBoolean(value, false)
        );

        const duplicateSignals = context.fraudSignals.filter(signal => {

            const type = normalizeString(
                firstDefined(
                    signal.type,
                    signal.code,
                    signal.name
                )
            );

            return (
                type.includes('DUPLICATE') ||
                type.includes('REPLAY')
            );
        });

        let score = 5;

        if (duplicateSignals.length > 0) {
            score = 70;
        }

        if (explicitDuplicate) {
            score = 95;
        }

        return this._factor({
            key: 'duplication',
            score,
            evidence: {
                explicitDuplicate,
                duplicateSignalCount: duplicateSignals.length
            },
            reason: explicitDuplicate
                ? 'Explicit duplicate indicators were detected.'
                : 'Duplicate/replay signals were evaluated.'
        });
    }

    _scoreSequence(context) {

        const sequenceSignals = [
            ...context.correlationSignals,
            ...context.fraudSignals
        ].filter(signal => {

            const type = normalizeString(
                firstDefined(
                    signal.type,
                    signal.code,
                    signal.name
                )
            );

            return (
                type.includes('SEQUENCE') ||
                type.includes('ORDER') ||
                type.includes('OUT_OF_ORDER')
            );
        });

        let score = 5;

        for (const signal of sequenceSignals) {

            const severity = normalizeString(
                firstDefined(
                    signal.severity,
                    signal.riskLevel
                )
            );

            if (severity === 'CRITICAL') {
                score = Math.max(score, 90);
            } else if (severity === 'HIGH') {
                score = Math.max(score, 75);
            } else if (severity === 'MEDIUM' || severity === 'MODERATE') {
                score = Math.max(score, 50);
            } else {
                score = Math.max(score, 30);
            }
        }

        return this._factor({
            key: 'sequence',
            score,
            evidence: {
                sequenceSignalCount: sequenceSignals.length
            },
            reason: 'Transaction and repair sequencing anomalies were evaluated.'
        });
    }

    _scoreAccountBehaviour(context) {

        const signals = context.behaviouralSignals;

        if (!signals.length) {
            return this._factor({
                key: 'accountBehaviour',
                score: 10,
                confidence: 0.35,
                evidence: {
                    signalCount: 0
                },
                reason: 'No behavioural anomalies were supplied.'
            });
        }

        let highest = 10;

        for (const signal of signals) {

            const score = firstDefined(
                signal.score,
                signal.riskScore,
                signal.anomalyScore
            );

            if (score !== undefined) {
                highest = Math.max(
                    highest,
                    clamp(score, 0, 100)
                );
                continue;
            }

            const severity = normalizeString(
                firstDefined(
                    signal.severity,
                    signal.riskLevel
                )
            );

            if (severity === 'CRITICAL') {
                highest = Math.max(highest, 95);
            } else if (severity === 'HIGH') {
                highest = Math.max(highest, 80);
            } else if (
                severity === 'MEDIUM' ||
                severity === 'MODERATE'
            ) {
                highest = Math.max(highest, 55);
            } else {
                highest = Math.max(highest, 25);
            }
        }

        return this._factor({
            key: 'accountBehaviour',
            score: highest,
            evidence: {
                signalCount: signals.length
            },
            reason: 'Account behavioural anomalies contribute to repair suspicion.'
        });
    }

    _scoreCrossAccount(context) {

        const signals = context.crossAccountSignals;

        let score = 5;

        let highRiskCount = 0;
        let criticalCount = 0;

        for (const signal of signals) {

            const signalScore = firstDefined(
                signal.score,
                signal.riskScore,
                signal.anomalyScore
            );

            if (signalScore !== undefined) {
                score = Math.max(
                    score,
                    clamp(signalScore, 0, 100)
                );
            }

            const severity = normalizeString(
                firstDefined(
                    signal.severity,
                    signal.riskLevel
                )
            );

            if (severity === 'CRITICAL') {
                criticalCount++;
            } else if (severity === 'HIGH') {
                highRiskCount++;
            }
        }

        if (highRiskCount >= 2) {
            score = Math.max(score, 80);
        }

        if (criticalCount > 0) {
            score = Math.max(score, 95);
        }

        return this._factor({
            key: 'crossAccount',
            score,
            evidence: {
                signalCount: signals.length,
                highRiskCount,
                criticalCount
            },
            reason: 'Cross-account relationships and correlated activity were evaluated.'
        });
    }

    _scoreHistoricalFraud(context) {

        const signals = [
            ...context.fraudSignals,
            ...context.history
        ];

        let score = 5;
        let confirmed = 0;
        let elevated = 0;

        for (const signal of signals) {

            const status = normalizeString(
                firstDefined(
                    signal.status,
                    signal.outcome,
                    signal.disposition
                )
            );

            const severity = normalizeString(
                firstDefined(
                    signal.severity,
                    signal.riskLevel
                )
            );

            if (
                status === 'CONFIRMED_FRAUD' ||
                status === 'FRAUD_CONFIRMED'
            ) {
                confirmed++;
            }

            if (
                severity === 'CRITICAL' ||
                severity === 'HIGH'
            ) {
                elevated++;
            }

            const directScore = firstDefined(
                signal.fraudScore,
                signal.riskScore,
                signal.score
            );

            if (directScore !== undefined) {
                score = Math.max(
                    score,
                    clamp(directScore, 0, 100)
                );
            }
        }

        if (confirmed > 0) {
            score = Math.max(score, 95);
        } else if (elevated >= 3) {
            score = Math.max(score, 80);
        } else if (elevated >= 1) {
            score = Math.max(score, 60);
        }

        return this._factor({
            key: 'historicalFraud',
            score,
            evidence: {
                confirmedFraudSignals: confirmed,
                elevatedSignals: elevated
            },
            reason: 'Historical fraud and risk indicators were incorporated.'
        });
    }

    _scoreTiming(context) {

        const timestamp = safeDate(
            firstDefined(
                context.repair.createdAt,
                context.repair.timestamp,
                context.transaction.createdAt,
                context.transaction.timestamp
            )
        );

        if (!timestamp) {
            return this._factor({
                key: 'timing',
                score: 10,
                confidence: 0.25,
                evidence: {
                    timestampAvailable: false
                },
                reason: 'No reliable repair or transaction timestamp was available.'
            });
        }

        const hour = timestamp.getHours();

        /**
         * This is intentionally only a weak signal.
         * Off-hours activity can be legitimate in 24/7 financial systems.
         */
        let score = 10;

        if (hour < 5 || hour >= 23) {
            score = 35;
        }

        const timingSignals = context.fraudSignals.filter(signal => {

            const type = normalizeString(
                firstDefined(
                    signal.type,
                    signal.code,
                    signal.name
                )
            );

            return (
                type.includes('TIMING') ||
                type.includes('OFF_HOURS') ||
                type.includes('TEMPORAL')
            );
        });

        if (timingSignals.length > 0) {
            score = Math.max(score, 65);
        }

        return this._factor({
            key: 'timing',
            score,
            evidence: {
                timestampAvailable: true,
                hour,
                timingSignalCount: timingSignals.length
            },
            reason: 'Temporal anomalies were evaluated as a supporting risk signal.'
        });
    }

    _scoreMetadata(context) {

        let score = 5;

        const repair = context.repair;

        const missingCriticalMetadata = [
            !firstDefined(
                repair.type,
                repair.repairType
            ),
            !firstDefined(
                repair.reason,
                repair.description
            ),
            !firstDefined(
                repair.createdBy,
                repair.requestedBy,
                repair.userId
            )
        ].filter(Boolean).length;

        if (missingCriticalMetadata === 1) {
            score = 25;
        }

        if (missingCriticalMetadata === 2) {
            score = 45;
        }

        if (missingCriticalMetadata >= 3) {
            score = 65;
        }

        if (
            toBoolean(
                repair.metadataTampered,
                false
            ) ||
            toBoolean(
                repair.signatureInvalid,
                false
            )
        ) {
            score = 95;
        }

        return this._factor({
            key: 'metadata',
            score,
            evidence: {
                missingCriticalMetadata,
                metadataTampered: toBoolean(
                    repair.metadataTampered,
                    false
                ),
                signatureInvalid: toBoolean(
                    repair.signatureInvalid,
                    false
                )
            },
            reason: 'Repair metadata integrity and completeness were evaluated.'
        });
    }

    /**
     * =========================================================================
     * Factor Construction
     * =========================================================================
     */

    _factor({
        key,
        score,
        confidence = 0.75,
        evidence = {},
        reason = ''
    }) {

        return {
            key,
            score: percentage(score),
            confidence: clamp(confidence, 0, 1),
            direction: score >= 50
                ? SIGNAL_DIRECTION.POSITIVE
                : SIGNAL_DIRECTION.NEUTRAL,
            evidence,
            reason
        };
    }

    _safeFactor(factors, key, callback) {

        if (factors.length >= this.config.maxFactors) {
            return;
        }

        try {

            const factor = callback();

            if (!factor) {
                return;
            }

            factors.push(factor);

        } catch (error) {

            this.logger.warn(
                '[SuspiciousRepairScorer] Factor calculation failed.',
                {
                    factor: key,
                    error: error.message
                }
            );

            factors.push(
                this._factor({
                    key,
                    score: 0,
                    confidence: 0,
                    evidence: {
                        calculationFailed: true
                    },
                    reason: 'Risk factor calculation failed safely.'
                })
            );
        }
    }

    /**
     * =========================================================================
     * Aggregation
     * =========================================================================
     */

    _aggregateFactors(factors) {

        let weightedScore = 0;
        let totalWeight = 0;

        for (const factor of factors) {

            const weight = toNumber(
                this.config.weights[factor.key],
                0
            );

            if (weight <= 0) {
                continue;
            }

            weightedScore +=
                factor.score *
                weight *
                clamp(factor.confidence, 0, 1);

            totalWeight +=
                weight *
                clamp(factor.confidence, 0, 1);
        }

        if (totalWeight <= 0) {
            return {
                score: 0,
                coverage: 0
            };
        }

        return {
            score: percentage(
                weightedScore / totalWeight
            ),
            coverage: percentage(
                totalWeight /
                Object.values(this.config.weights)
                    .reduce((sum, value) => sum + value, 0)
            )
        };
    }

    _calculateConfidence(context, factors) {

        if (!factors.length) {
            return this.config.defaultConfidence;
        }

        const averageFactorConfidence =
            factors.reduce(
                (sum, factor) => sum + factor.confidence,
                0
            ) / factors.length;

        const signalCount =
            context.fraudSignals.length +
            context.correlationSignals.length +
            context.behaviouralSignals.length +
            context.crossAccountSignals.length;

        const dataAvailability = clamp(
            (
                signalCount +
                context.history.length
            ) / 20,
            0,
            1
        );

        /**
         * Confidence should rise when there is more corroborating evidence,
         * but never become equivalent to risk itself.
         */
        return round(
            clamp(
                (
                    averageFactorConfidence * 0.70
                ) +
                (
                    dataAvailability * 0.30
                ),
                0,
                1
            ),
            4
        );
    }

    _applyConfidenceAdjustment(score, confidence) {

        /**
         * Do not allow low confidence to erase a genuine high-risk signal.
         *
         * The adjustment only pulls the aggregate partially toward neutral.
         */
        const neutral = 25;

        const confidenceWeight =
            0.50 +
            (clamp(confidence, 0, 1) * 0.50);

        return clamp(
            neutral +
            (
                score - neutral
            ) *
            confidenceWeight,
            this.config.minScore,
            this.config.maxScore
        );
    }

    /**
     * =========================================================================
     * Risk Classification
     * =========================================================================
     */

    _determineRiskLevel(score) {

        if (score >= this.config.criticalRiskThreshold) {
            return RISK_LEVEL.CRITICAL;
        }

        if (score >= this.config.highRiskThreshold) {
            return RISK_LEVEL.HIGH;
        }

        if (score >= this.config.reviewThreshold) {
            return RISK_LEVEL.MODERATE;
        }

        return RISK_LEVEL.LOW;
    }

    _determineRecommendation(
        score,
        riskLevel,
        context,
        confidence
    ) {

        const repairType = normalizeString(
            firstDefined(
                context.repair.type,
                context.repair.repairType
            )
        );

        const explicitFraud = context.fraudSignals.some(signal => {

            const status = normalizeString(
                firstDefined(
                    signal.status,
                    signal.outcome
                )
            );

            return (
                status === 'CONFIRMED_FRAUD' ||
                status === 'FRAUD_CONFIRMED'
            );
        });

        if (explicitFraud) {
            return RECOMMENDATION.BLOCK_AUTOMATION;
        }

        if (
            riskLevel === RISK_LEVEL.CRITICAL
        ) {
            return RECOMMENDATION.BLOCK_AUTOMATION;
        }

        if (
            riskLevel === RISK_LEVEL.HIGH
        ) {
            return RECOMMENDATION.ESCALATE;
        }

        if (
            riskLevel === RISK_LEVEL.MODERATE ||
            score >= this.config.reviewThreshold
        ) {
            return RECOMMENDATION.REQUIRE_REVIEW;
        }

        if (
            this.config.highRiskRepairTypes.has(repairType) &&
            confidence < 0.50
        ) {
            return RECOMMENDATION.REQUIRE_REVIEW;
        }

        if (score >= 30) {
            return RECOMMENDATION.PROCEED_WITH_MONITORING;
        }

        return RECOMMENDATION.PROCEED;
    }

    /**
     * =========================================================================
     * Result Construction
     * =========================================================================
     */

    _buildResult({
        context,
        factors,
        rawScore,
        finalScore,
        confidence,
        riskLevel,
        recommendation,
        startedAt
    }) {

        const normalizedFactors = factors
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.maxFactors);

        const riskFactors = normalizedFactors
            .filter(factor => factor.score >= 40)
            .map(factor => ({
                key: factor.key,
                score: factor.score,
                confidence: factor.confidence,
                reason: factor.reason,
                evidence: factor.evidence
            }));

        const protectiveSignals = normalizedFactors
            .filter(factor => factor.score < 20)
            .map(factor => factor.key);

        const fingerprint = createHash({
            version: this.version,
            tenantId: context.tenantId,
            repairId: context.repairId,
            statementId: context.statementId,
            score: finalScore,
            riskLevel,
            recommendation,
            factors: normalizedFactors.map(factor => ({
                key: factor.key,
                score: factor.score,
                confidence: factor.confidence
            }))
        });

        return {
            success: true,

            engine: {
                name: 'SuspiciousRepairScorer',
                version: this.version,
                mode: 'READ_ONLY',
                deterministic: true
            },

            score: finalScore,

            rawScore: percentage(rawScore),

            riskScore: finalScore,

            riskLevel,

            recommendation,

            confidence: percentage(confidence * 100) / 100,

            requiresReview:
                recommendation === RECOMMENDATION.REQUIRE_REVIEW ||
                recommendation === RECOMMENDATION.ESCALATE ||
                recommendation === RECOMMENDATION.BLOCK_AUTOMATION,

            automationAllowed:
                recommendation !== RECOMMENDATION.BLOCK_AUTOMATION,

            riskFactors,

            protectiveSignals,

            factors: normalizedFactors,

            context: {
                tenantId: context.tenantId,
                correlationId: context.correlationId,
                repairId: context.repairId,
                statementId: context.statementId
            },

            audit: {
                fingerprint,
                generatedAt: this._now().toISOString(),
                durationMs: Math.max(
                    0,
                    Date.now() - startedAt
                )
            }
        };
    }

    _buildFailureResult(
        input,
        error,
        startedAt
    ) {

        const tenantId = isObject(input)
            ? firstDefined(
                input.tenantId,
                input.context && input.context.tenantId
            )
            : null;

        /**
         * Fail closed for automation.
         *
         * A scoring failure must never silently become a low-risk result.
         */
        return {
            success: false,

            engine: {
                name: 'SuspiciousRepairScorer',
                version: this.version,
                mode: 'READ_ONLY',
                deterministic: true
            },

            score: 100,

            rawScore: 100,

            riskScore: 100,

            riskLevel: RISK_LEVEL.CRITICAL,

            recommendation: RECOMMENDATION.BLOCK_AUTOMATION,

            confidence: 0,

            requiresReview: true,

            automationAllowed: false,

            riskFactors: [
                {
                    key: 'SCORING_ENGINE_FAILURE',
                    score: 100,
                    confidence: 0,
                    reason: 'Risk scoring failed; automation is blocked fail-closed.',
                    evidence: {
                        errorType: error.name,
                        errorMessage: error.message
                    }
                }
            ],

            protectiveSignals: [],

            factors: [],

            context: {
                tenantId: tenantId || null
            },

            error: {
                code: 'SUSPICIOUS_REPAIR_SCORING_FAILED',
                message: error.message
            },

            audit: {
                generatedAt: this._now().toISOString(),
                durationMs: Math.max(
                    0,
                    Date.now() - startedAt
                )
            }
        };
    }

    /**
     * =========================================================================
     * Policy Integration
     * =========================================================================
     */

    evaluatePolicy(result, context = {}) {

        if (
            !this.policy ||
            typeof this.policy.evaluate !== 'function'
        ) {
            return {
                applied: false,
                decision: null
            };
        }

        try {

            const decision = this.policy.evaluate({
                result,
                context
            });

            return {
                applied: true,
                decision
            };

        } catch (error) {

            this.logger.error(
                '[SuspiciousRepairScorer] Policy evaluation failed.',
                {
                    error: error.message
                }
            );

            /**
             * Policy failures fail closed.
             */
            return {
                applied: true,
                decision: {
                    allowed: false,
                    action: RECOMMENDATION.BLOCK_AUTOMATION,
                    reason: 'Fraud scoring policy evaluation failed.'
                }
            };
        }
    }

    /**
     * =========================================================================
     * Observability
     * =========================================================================
     */

    _recordMetric(name, labels = {}) {

        if (!this.metrics) {
            return;
        }

        try {

            if (typeof this.metrics.increment === 'function') {
                this.metrics.increment(
                    `suspicious_repair_scorer.${name}`,
                    labels
                );
                return;
            }

            if (typeof this.metrics.inc === 'function') {
                this.metrics.inc(
                    `suspicious_repair_scorer_${name.replace(/\./g, '_')}`,
                    labels
                );
            }

        } catch (error) {

            this.logger.debug(
                '[SuspiciousRepairScorer] Metric emission failed.',
                {
                    metric: name,
                    error: error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    _now() {

        try {

            const value =
                this.clock &&
                typeof this.clock.now === 'function'
                    ? this.clock.now()
                    : new Date();

            return safeDate(value) || new Date();

        } catch (error) {
            return new Date();
        }
    }
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

SuspiciousRepairScorer.VERSION = DEFAULTS.VERSION;

SuspiciousRepairScorer.RISK_LEVEL = RISK_LEVEL;

SuspiciousRepairScorer.RECOMMENDATION = RECOMMENDATION;

SuspiciousRepairScorer.SIGNAL_DIRECTION = SIGNAL_DIRECTION;

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createSuspiciousRepairScorer(options = {}) {
    return new SuspiciousRepairScorer(options);
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 *
 * The primary class is exported directly for compatibility with:
 *
 *   const SuspiciousRepairScorer =
 *       require('./SuspiciousRepairScorer');
 *
 * Additional named properties are attached for consumers that prefer:
 *
 *   const {
 *       SuspiciousRepairScorer,
 *       createSuspiciousRepairScorer
 *   } = require('./SuspiciousRepairScorer');
 *
 * ============================================================================
 */

module.exports = SuspiciousRepairScorer;

module.exports.SuspiciousRepairScorer =
    SuspiciousRepairScorer;

module.exports.createSuspiciousRepairScorer =
    createSuspiciousRepairScorer;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.RECOMMENDATION =
    RECOMMENDATION;

module.exports.SIGNAL_DIRECTION =
    SIGNAL_DIRECTION;
