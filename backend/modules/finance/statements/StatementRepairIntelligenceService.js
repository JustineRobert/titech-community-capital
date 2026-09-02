'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementRepairIntelligenceService.js
 * ============================================================================
 *
 * Enterprise Statement Repair Intelligence Service
 *
 * File:
 * backend/modules/finance/statements/StatementRepairIntelligenceService.js
 *
 * Responsibilities:
 *
 * - Analyze statement reconciliation exceptions.
 * - Classify repair candidates.
 * - Calculate repair severity and priority.
 * - Integrate SLA intelligence.
 * - Integrate operational trend intelligence.
 * - Produce explainable repair recommendations.
 * - Generate deterministic intelligence identifiers.
 * - Support repair workflow orchestration.
 * - Support dashboards, alerts, audit, and executive reporting.
 * - Preserve tenant and execution context.
 *
 * Pipeline Position:
 *
 * StatementProcessor
 *       |
 *       v
 * StatementValidator
 *       |
 *       v
 * StatementReconciliationService
 *       |
 *       v
 * StatementRepairIntelligenceService
 *       |
 *       +---------------------------+
 *       |                           |
 *       v                           v
 * Repair Workflow             SLA / Trend Intelligence
 *       |
 *       v
 * StatementRepairService
 *
 * Design Principles:
 *
 * - Stateless.
 * - Deterministic where possible.
 * - No direct persistence.
 * - No mutation of input objects.
 * - Tenant isolated.
 * - Audit ready.
 * - Explainable.
 * - Idempotency aware.
 * - Distributed-processing ready.
 * - Provider agnostic.
 * - Safe for asynchronous workflows.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    StatementProcessingError
} = require('./StatementErrors');

/**
 * ============================================================================
 * Repair Types
 * ============================================================================
 */

const REPAIR_TYPE = Object.freeze({

    MISSING_LEDGER_ENTRY:
        'MISSING_LEDGER_ENTRY',

    FAILED_SETTLEMENT_POSTING:
        'FAILED_SETTLEMENT_POSTING',

    DUPLICATE_LEDGER_ENTRY:
        'DUPLICATE_LEDGER_ENTRY',

    AMOUNT_VARIANCE:
        'AMOUNT_VARIANCE',

    DATE_VARIANCE:
        'DATE_VARIANCE',

    REFERENCE_VARIANCE:
        'REFERENCE_VARIANCE',

    CURRENCY_VARIANCE:
        'CURRENCY_VARIANCE',

    UNMATCHED_TRANSACTION:
        'UNMATCHED_TRANSACTION',

    INVALID_ACCOUNT_MAPPING:
        'INVALID_ACCOUNT_MAPPING',

    INTEGRATION_FAILURE:
        'INTEGRATION_FAILURE',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Repair Severity
 * ============================================================================
 */

const REPAIR_SEVERITY = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});

/**
 * ============================================================================
 * Repair Priority
 * ============================================================================
 */

const REPAIR_PRIORITY = Object.freeze({

    LOW:
        'LOW',

    NORMAL:
        'NORMAL',

    HIGH:
        'HIGH',

    URGENT:
        'URGENT',

    CRITICAL:
        'CRITICAL'

});

/**
 * ============================================================================
 * Intelligence Status
 * ============================================================================
 */

const INTELLIGENCE_STATUS = Object.freeze({

    ANALYZED:
        'ANALYZED',

    ACTION_REQUIRED:
        'ACTION_REQUIRED',

    ESCALATED:
        'ESCALATED',

    NO_ACTION:
        'NO_ACTION',

    FAILED:
        'FAILED'

});

/**
 * ============================================================================
 * Recommendation Action
 * ============================================================================
 */

const RECOMMENDATION_ACTION = Object.freeze({

    CREATE_REPAIR:
        'CREATE_REPAIR',

    INVESTIGATE:
        'INVESTIGATE',

    ESCALATE:
        'ESCALATE',

    MONITOR:
        'MONITOR',

    NO_ACTION:
        'NO_ACTION'

});

/**
 * ============================================================================
 * Default Intelligence Policy
 * ============================================================================
 *
 * Scores are intentionally explicit and deterministic.
 *
 * The policy can be overridden through the constructor without modifying
 * the service implementation.
 */

const DEFAULT_INTELLIGENCE_POLICY = Object.freeze({

    severityScores: Object.freeze({

        LOW:
            25,

        MEDIUM:
            50,

        HIGH:
            75,

        CRITICAL:
            100

    }),

    escalationThreshold:
        75,

    criticalThreshold:
        90,

    highThreshold:
        70,

    mediumThreshold:
        40,

    trendThreshold:
        30,

    slaWarningThreshold:
        25

});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Return a safe finite number.
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
 * Normalize string values.
 *
 * @param {*} value
 * @param {string|null} fallback
 * @returns {string|null}
 */
function normalizeString(value, fallback = null) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const normalized =
        String(value).trim();

    return normalized || fallback;

}

/**
 * Freeze an object defensively.
 *
 * @param {Object} object
 * @returns {Object}
 */
function freezeObject(object) {

    return Object.freeze(object);

}

/**
 * ============================================================================
 * StatementRepairIntelligenceService
 * ============================================================================
 */

class StatementRepairIntelligenceService {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {Object} dependencies
     *
     * Supported dependencies:
     *
     * - slaMonitor
     * - trendDetector
     * - recommendationEngine
     * - auditService
     * - logger
     * - policy
     */
    constructor({

        slaMonitor = null,

        trendDetector = null,

        recommendationEngine = null,

        auditService = null,

        logger = null,

        policy = {}

    } = {}) {

        this.slaMonitor =
            slaMonitor;

        this.trendDetector =
            trendDetector;

        this.recommendationEngine =
            recommendationEngine;

        this.auditService =
            auditService;

        this.logger =
            logger;

        this.policy =
            this.mergePolicy(

                DEFAULT_INTELLIGENCE_POLICY,

                policy

            );

    }

    /**
     * =========================================================================
     * Analyze Reconciliation Result
     * =========================================================================
     *
     * Primary public API.
     *
     * @param {Object} reconciliation
     * @param {StatementContext} context
     *
     * @returns {Promise<Object>}
     */
    async analyze(
        reconciliation,
        context
    ) {

        try {

            this.validateInput(
                reconciliation,
                context
            );

            const candidates =
                this.extractRepairCandidates(
                    reconciliation
                );

            const trend =
                await this.evaluateTrends(
                    candidates,
                    reconciliation,
                    context
                );

            const repairs =
                candidates.map(

                    candidate =>
                        this.analyzeRepairCandidate(

                            candidate,

                            reconciliation,

                            context,

                            trend

                        )

                );

            const summary =
                this.buildSummary(
                    repairs
                );

            const status =
                this.determineStatus(
                    repairs
                );

            const intelligenceId =
                this.generateIntelligenceId(
                    reconciliation,
                    context
                );

            const result = {

                intelligenceId,

                tenantId:
                    context.tenantId,

                statementId:
                    reconciliation.statementId || null,

                reconciliationId:
                    reconciliation.reconciliationId || null,

                batchId:
                    reconciliation.batchId ||
                    context.batchId ||
                    null,

                correlationId:
                    context.correlationId ||
                    null,

                requestId:
                    context.requestId ||
                    null,

                executionId:
                    context.executionId ||
                    null,

                traceId:
                    context.traceId ||
                    null,

                status,

                summary,

                repairs,

                trend,

                analyzedAt:
                    new Date()

            };

            await this.audit(
                result
            );

            return freezeObject(
                result
            );

        }

        catch (error) {

            if (
                error instanceof StatementProcessingError
            ) {

                throw error;

            }

            this.logError(
                'Statement repair intelligence analysis failed',
                error,
                context
            );

            throw new StatementProcessingError(

                'Statement repair intelligence analysis failed',

                {

                    statementId:
                        reconciliation?.statementId ||
                        null,

                    reconciliationId:
                        reconciliation?.reconciliationId ||
                        null,

                    tenantId:
                        context?.tenantId ||
                        null,

                    originalError:
                        error.message

                },

                {

                    cause:
                        error,

                    retryable:
                        true

                }

            );

        }

    }

    /**
     * =========================================================================
     * Alias: Analyze Reconciliation
     * =========================================================================
     *
     * Keeps the service convenient for orchestration layers that use a more
     * explicit method name.
     */
    async analyzeReconciliation(
        reconciliation,
        context
    ) {

        return this.analyze(
            reconciliation,
            context
        );

    }

    /**
     * =========================================================================
     * Extract Repair Candidates
     * =========================================================================
     *
     * Converts reconciliation output into a canonical repair candidate list.
     *
     * @param {Object} reconciliation
     * @returns {Array<Object>}
     */
    extractRepairCandidates(
        reconciliation
    ) {

        const candidates = [];

        const unmatched =
            Array.isArray(
                reconciliation.unmatched
            )
                ? reconciliation.unmatched
                : [];

        unmatched.forEach(
            transaction => {

                candidates.push({

                    type:
                        REPAIR_TYPE.UNMATCHED_TRANSACTION,

                    transaction,

                    source:
                        'UNMATCHED'

                });

            }
        );

        const variances =
            Array.isArray(
                reconciliation.variances
            )
                ? reconciliation.variances
                : [];

        variances.forEach(
            variance => {

                candidates.push({

                    type:
                        this.resolveVarianceRepairType(
                            variance
                        ),

                    transaction:
                        variance,

                    source:
                        'VARIANCE',

                    variance

                });

            }
        );

        return candidates;

    }

    /**
     * =========================================================================
     * Analyze Repair Candidate
     * =========================================================================
     */
    analyzeRepairCandidate(

        candidate,

        reconciliation,

        context,

        trend = null

    ) {

        const severity =
            this.resolveSeverity(
                candidate
            );

        const score =
            this.calculateRiskScore(

                candidate,

                severity,

                reconciliation,

                trend

            );

        const priority =
            this.resolvePriority(
                score,
                severity
            );

        const recommendation =
            this.resolveRecommendation(

                candidate,

                severity,

                priority,

                score

            );

        const repairId =
            this.generateRepairId(

                reconciliation,

                candidate

            );

        const explanation =
            this.buildExplanation(

                candidate,

                severity,

                priority,

                score,

                recommendation

            );

        const sla =
            this.evaluateSLA(

                {

                    repairId,

                    severity,

                    createdAt:
                        reconciliation.createdAt ||
                        new Date(),

                    statementId:
                        reconciliation.statementId ||
                        null

                }

            );

        return freezeObject({

            repairId,

            tenantId:
                context.tenantId,

            statementId:
                reconciliation.statementId ||
                null,

            reconciliationId:
                reconciliation.reconciliationId ||
                null,

            batchId:
                reconciliation.batchId ||
                context.batchId ||
                null,

            type:
                candidate.type,

            severity,

            priority,

            score,

            recommendation,

            explanation,

            transaction:
                candidate.transaction,

            variance:
                candidate.variance ||
                null,

            sla,

            actionRequired:
                recommendation.action !==
                RECOMMENDATION_ACTION.NO_ACTION,

            analyzedAt:
                new Date()

        });

    }

    /**
     * =========================================================================
     * Resolve Variance Type
     * =========================================================================
     */
    resolveVarianceRepairType(
        variance = {}
    ) {

        const type =
            normalizeString(
                variance.type,
                ''
            ).toUpperCase();

        switch (type) {

            case 'AMOUNT_VARIANCE':

                return REPAIR_TYPE.AMOUNT_VARIANCE;

            case 'DATE_VARIANCE':

                return REPAIR_TYPE.DATE_VARIANCE;

            case 'REFERENCE_VARIANCE':

                return REPAIR_TYPE.REFERENCE_VARIANCE;

            case 'CURRENCY_VARIANCE':

                return REPAIR_TYPE.CURRENCY_VARIANCE;

            default:

                return REPAIR_TYPE.UNKNOWN;

        }

    }

    /**
     * =========================================================================
     * Severity Resolution
     * =========================================================================
     */
    resolveSeverity(
        candidate = {}
    ) {

        switch (candidate.type) {

            case REPAIR_TYPE.FAILED_SETTLEMENT_POSTING:

            case REPAIR_TYPE.MISSING_LEDGER_ENTRY:

            case REPAIR_TYPE.INVALID_ACCOUNT_MAPPING:

                return REPAIR_SEVERITY.HIGH;

            case REPAIR_TYPE.AMOUNT_VARIANCE:

                return REPAIR_SEVERITY.HIGH;

            case REPAIR_TYPE.DUPLICATE_LEDGER_ENTRY:

                return REPAIR_SEVERITY.HIGH;

            case REPAIR_TYPE.CURRENCY_VARIANCE:

                return REPAIR_SEVERITY.HIGH;

            case REPAIR_TYPE.INTEGRATION_FAILURE:

                return REPAIR_SEVERITY.HIGH;

            case REPAIR_TYPE.REFERENCE_VARIANCE:

            case REPAIR_TYPE.DATE_VARIANCE:

                return REPAIR_SEVERITY.MEDIUM;

            case REPAIR_TYPE.UNMATCHED_TRANSACTION:

                return REPAIR_SEVERITY.MEDIUM;

            case REPAIR_TYPE.UNKNOWN:

            default:

                return REPAIR_SEVERITY.LOW;

        }

    }

    /**
     * =========================================================================
     * Risk Score
     * =========================================================================
     */
    calculateRiskScore(

        candidate,

        severity,

        reconciliation,

        trend

    ) {

        let score =
            this.policy.severityScores[
                severity
            ] || 0;

        /**
         * High-value financial variances increase risk.
         */
        if (
            candidate.variance &&
            Number.isFinite(
                Number(candidate.variance.actual)
            ) &&
            Number.isFinite(
                Number(candidate.variance.expected)
            )
        ) {

            const actual =
                Math.abs(
                    Number(candidate.variance.actual)
                );

            const expected =
                Math.abs(
                    Number(candidate.variance.expected)
                );

            if (
                expected > 0
            ) {

                const varianceRatio =
                    Math.abs(
                        actual - expected
                    ) / expected;

                if (
                    varianceRatio >= 0.50
                ) {

                    score += 20;

                }
                else if (
                    varianceRatio >= 0.10
                ) {

                    score += 10;

                }

            }

        }

        /**
         * Large reconciliation exception sets increase operational risk.
         */
        const unmatchedCount =
            Array.isArray(
                reconciliation?.unmatched
            )
                ? reconciliation.unmatched.length
                : 0;

        if (
            unmatchedCount >= 10
        ) {

            score += 10;

        }

        /**
         * Trend intelligence can increase priority.
         */
        if (
            trend?.trendDetected === true
        ) {

            score += 10;

        }

        return Math.min(
            100,
            Math.round(score)
        );

    }

    /**
     * =========================================================================
     * Priority Resolution
     * =========================================================================
     */
    resolvePriority(
        score,
        severity
    ) {

        if (
            severity ===
            REPAIR_SEVERITY.CRITICAL ||
            score >=
            this.policy.criticalThreshold
        ) {

            return REPAIR_PRIORITY.CRITICAL;

        }

        if (
            severity ===
            REPAIR_SEVERITY.HIGH ||
            score >=
            this.policy.highThreshold
        ) {

            return REPAIR_PRIORITY.HIGH;

        }

        if (
            severity ===
            REPAIR_SEVERITY.MEDIUM ||
            score >=
            this.policy.mediumThreshold
        ) {

            return REPAIR_PRIORITY.NORMAL;

        }

        return REPAIR_PRIORITY.LOW;

    }

    /**
     * =========================================================================
     * Recommendation Resolution
     * =========================================================================
     */
    resolveRecommendation(

        candidate,

        severity,

        priority,

        score

    ) {

        if (
            severity ===
            REPAIR_SEVERITY.CRITICAL
        ) {

            return {

                action:
                    RECOMMENDATION_ACTION.ESCALATE,

                confidence:
                    100,

                reason:
                    'Critical financial repair candidate requires immediate escalation.'

            };

        }

        if (
            score >=
            this.policy.escalationThreshold
        ) {

            return {

                action:
                    RECOMMENDATION_ACTION.ESCALATE,

                confidence:
                    Math.min(
                        100,
                        score
                    ),

                reason:
                    'Risk score exceeds the operational escalation threshold.'

            };

        }

        if (
            priority ===
            REPAIR_PRIORITY.HIGH
        ) {

            return {

                action:
                    RECOMMENDATION_ACTION.CREATE_REPAIR,

                confidence:
                    Math.min(
                        100,
                        score
                    ),

                reason:
                    'High-priority reconciliation exception requires repair workflow.'

            };

        }

        if (
            candidate.type ===
            REPAIR_TYPE.UNKNOWN
        ) {

            return {

                action:
                    RECOMMENDATION_ACTION.INVESTIGATE,

                confidence:
                    50,

                reason:
                    'Exception type is not recognized by the deterministic repair policy.'

            };

        }

        return {

            action:
                RECOMMENDATION_ACTION.CREATE_REPAIR,

            confidence:
                Math.max(
                    50,
                    Math.min(
                        100,
                        score
                    )
                ),

            reason:
                'Reconciliation exception qualifies for controlled repair workflow.'

        };

    }

    /**
     * =========================================================================
     * Explain Recommendation
     * =========================================================================
     */
    buildExplanation(

        candidate,

        severity,

        priority,

        score,

        recommendation

    ) {

        const reasons = [];

        reasons.push(
            `Exception type: ${candidate.type}.`
        );

        reasons.push(
            `Severity classified as ${severity}.`
        );

        reasons.push(
            `Priority classified as ${priority}.`
        );

        reasons.push(
            `Risk score: ${score}/100.`
        );

        reasons.push(
            recommendation.reason
        );

        return reasons.join(' ');

    }

    /**
     * =========================================================================
     * SLA Evaluation
     * =========================================================================
     */
    evaluateSLA(
        repair
    ) {

        if (
            !this.slaMonitor ||
            typeof this.slaMonitor.evaluateSLA !==
                'function'
        ) {

            return null;

        }

        try {

            return this.slaMonitor.evaluateSLA(
                repair
            );

        }
        catch (error) {

            this.logWarn(
                'Repair SLA evaluation failed',
                error
            );

            return null;

        }

    }

    /**
     * =========================================================================
     * Trend Evaluation
     * =========================================================================
     */
    async evaluateTrends(

        candidates,

        reconciliation,

        context

    ) {

        if (
            !this.trendDetector ||
            typeof this.trendDetector.detectRepairTrends !==
                'function'
        ) {

            return null;

        }

        try {

            const history =
                this.buildTrendHistory(
                    candidates,
                    reconciliation,
                    context
                );

            const result =
                await this.trendDetector
                    .detectRepairTrends(
                        history
                    );

            return freezeObject({

                trendDetected:
                    this.detectAnyTrend(
                        result
                    ),

                analysis:
                    result

            });

        }
        catch (error) {

            this.logWarn(
                'Repair trend analysis failed',
                error
            );

            return null;

        }

    }

    /**
     * =========================================================================
     * Build Trend History
     * =========================================================================
     *
     * The service does not retrieve historical records itself. Callers can
     * provide historical data through reconciliation metadata when available.
     */
    buildTrendHistory(

        candidates,

        reconciliation,

        context

    ) {

        const history =
            Array.isArray(
                reconciliation?.history
            )
                ? reconciliation.history
                : [];

        if (
            history.length
        ) {

            return history;

        }

        return candidates.map(
            candidate => ({

                tenantId:
                    context.tenantId,

                statementId:
                    reconciliation.statementId ||
                    null,

                type:
                    candidate.type,

                failedSettlement:
                    candidate.type ===
                    REPAIR_TYPE.FAILED_SETTLEMENT_POSTING,

                duplicate:
                    candidate.type ===
                    REPAIR_TYPE.DUPLICATE_LEDGER_ENTRY,

                accountMappingError:
                    candidate.type ===
                    REPAIR_TYPE.INVALID_ACCOUNT_MAPPING,

                integrationFailure:
                    candidate.type ===
                    REPAIR_TYPE.INTEGRATION_FAILURE,

                createdAt:
                    reconciliation.createdAt ||
                    new Date()

            })
        );

    }

    /**
     * =========================================================================
     * Detect Any Trend
     * =========================================================================
     */
    detectAnyTrend(
        result
    ) {

        if (
            !result ||
            typeof result !== 'object'
        ) {

            return false;

        }

        return Object.values(
            result
        ).some(
            value => {

                if (
                    !value ||
                    typeof value !== 'object'
                ) {

                    return false;

                }

                return (
                    value.detected === true ||
                    value.direction === 'INCREASING'
                );

            }
        );

    }

    /**
     * =========================================================================
     * Build Summary
     * =========================================================================
     */
    buildSummary(
        repairs
    ) {

        const bySeverity = {

            LOW: 0,

            MEDIUM: 0,

            HIGH: 0,

            CRITICAL: 0

        };

        const byPriority = {

            LOW: 0,

            NORMAL: 0,

            HIGH: 0,

            URGENT: 0,

            CRITICAL: 0

        };

        repairs.forEach(
            repair => {

                if (
                    Object.prototype.hasOwnProperty.call(
                        bySeverity,
                        repair.severity
                    )
                ) {

                    bySeverity[
                        repair.severity
                    ]++;

                }

                if (
                    Object.prototype.hasOwnProperty.call(
                        byPriority,
                        repair.priority
                    )
                ) {

                    byPriority[
                        repair.priority
                    ]++;

                }

            }
        );

        const actionable =
            repairs.filter(
                repair =>
                    repair.actionRequired
            ).length;

        const escalated =
            repairs.filter(
                repair =>
                    repair.recommendation.action ===
                    RECOMMENDATION_ACTION.ESCALATE
            ).length;

        const highestRisk =
            repairs.reduce(

                (highest, repair) => {

                    if (
                        !highest ||
                        repair.score >
                        highest.score
                    ) {

                        return repair;

                    }

                    return highest;

                },

                null

            );

        return freezeObject({

            totalRepairs:
                repairs.length,

            actionable,

            escalated,

            bySeverity:
                freezeObject(
                    bySeverity
                ),

            byPriority:
                freezeObject(
                    byPriority
                ),

            highestRiskRepairId:
                highestRisk?.repairId ||
                null,

            highestRiskScore:
                highestRisk?.score ||
                0

        });

    }

    /**
     * =========================================================================
     * Determine Intelligence Status
     * =========================================================================
     */
    determineStatus(
        repairs
    ) {

        if (
            !repairs.length
        ) {

            return INTELLIGENCE_STATUS.NO_ACTION;

        }

        const hasEscalation =
            repairs.some(
                repair =>
                    repair.recommendation.action ===
                    RECOMMENDATION_ACTION.ESCALATE
            );

        if (
            hasEscalation
        ) {

            return INTELLIGENCE_STATUS.ESCALATED;

        }

        const actionable =
            repairs.some(
                repair =>
                    repair.actionRequired
            );

        return actionable
            ? INTELLIGENCE_STATUS.ACTION_REQUIRED
            : INTELLIGENCE_STATUS.ANALYZED;

    }

    /**
     * =========================================================================
     * Generate Repair ID
     * =========================================================================
     */
    generateRepairId(

        reconciliation,

        candidate

    ) {

        const identity = [

            reconciliation.reconciliationId ||
                '',

            reconciliation.statementId ||
                '',

            candidate.type ||
                '',

            candidate.transaction?.externalId ||
                candidate.transaction?.reference ||
                '',

            JSON.stringify(
                candidate.variance ||
                {}
            )

        ].join('|');

        return (

            'REPAIR-' +

            crypto
                .createHash('sha256')
                .update(identity)
                .digest('hex')
                .substring(0, 24)

        );

    }

    /**
     * =========================================================================
     * Generate Intelligence ID
     * =========================================================================
     */
    generateIntelligenceId(

        reconciliation,

        context

    ) {

        const identity = [

            context.tenantId,

            reconciliation.reconciliationId ||
                '',

            reconciliation.statementId ||
                ''

        ].join('|');

        return (

            'REPAIR-INT-' +

            crypto
                .createHash('sha256')
                .update(identity)
                .digest('hex')
                .substring(0, 24)

        );

    }

    /**
     * =========================================================================
     * Optional Recommendation Engine
     * =========================================================================
     *
     * Allows a future AI/ML recommendation service to enhance deterministic
     * recommendations without making the core service dependent on AI.
     */
    async enrichRecommendations(
        repairs,
        context
    ) {

        if (
            !this.recommendationEngine ||
            typeof this.recommendationEngine.recommend !==
                'function'
        ) {

            return repairs;

        }

        const enriched = [];

        for (
            const repair of repairs
        ) {

            try {

                const recommendation =
                    await this.recommendationEngine
                        .recommend(
                            repair,
                            context
                        );

                enriched.push({

                    ...repair,

                    recommendation:
                        recommendation ||
                        repair.recommendation

                });

            }
            catch (error) {

                this.logWarn(
                    'Repair recommendation enrichment failed',
                    error
                );

                enriched.push(
                    repair
                );

            }

        }

        return enriched;

    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */
    async audit(
        result
    ) {

        if (
            !this.auditService ||
            typeof this.auditService.log !==
                'function'
        ) {

            return;

        }

        try {

            await this.auditService.log({

                action:
                    'STATEMENT_REPAIR_INTELLIGENCE_ANALYZED',

                tenantId:
                    result.tenantId,

                data:
                    result

            });

        }
        catch (error) {

            /**
             * Audit failures must not silently destroy an otherwise valid
             * intelligence result. They are logged for operational recovery.
             */
            this.logWarn(
                'Repair intelligence audit failed',
                error
            );

        }

    }

    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     */
    validateInput(

        reconciliation,

        context

    ) {

        if (
            !reconciliation ||
            typeof reconciliation !==
                'object'
        ) {

            throw new StatementProcessingError(

                'Reconciliation result required',

                {

                    reason:
                        'MISSING_RECONCILIATION'

                }

            );

        }

        if (
            !context ||
            !context.tenantId
        ) {

            throw new StatementProcessingError(

                'Tenant context required',

                {

                    reason:
                        'MISSING_TENANT_CONTEXT'

                }

            );

        }

        if (
            reconciliation.statementId ===
            undefined &&
            reconciliation.reconciliationId ===
            undefined
        ) {

            throw new StatementProcessingError(

                'Reconciliation identity required',

                {

                    reason:
                        'MISSING_RECONCILIATION_IDENTITY'

                }

            );

        }

    }

    /**
     * =========================================================================
     * Policy Merge
     * =========================================================================
     */
    mergePolicy(
        base,
        override
    ) {

        return freezeObject({

            ...base,

            ...override,

            severityScores:
                freezeObject({

                    ...base.severityScores,

                    ...(override.severityScores || {})

                })

        });

    }

    /**
     * =========================================================================
     * Logging
     * =========================================================================
     */

    logWarn(
        message,
        error = null
    ) {

        if (
            this.logger &&
            typeof this.logger.warn ===
                'function'
        ) {

            this.logger.warn(

                message,

                {

                    error:
                        error?.message ||
                        null

                }

            );

        }

    }

    logError(

        message,

        error,

        context = null

    ) {

        if (
            this.logger &&
            typeof this.logger.error ===
                'function'
        ) {

            this.logger.error(

                message,

                {

                    error:
                        error?.message ||
                        null,

                    tenantId:
                        context?.tenantId ||
                        null,

                    correlationId:
                        context?.correlationId ||
                        null

                }

            );

        }

    }

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    StatementRepairIntelligenceService;

module.exports.REPAIR_TYPE =
    REPAIR_TYPE;

module.exports.REPAIR_SEVERITY =
    REPAIR_SEVERITY;

module.exports.REPAIR_PRIORITY =
    REPAIR_PRIORITY;

module.exports.INTELLIGENCE_STATUS =
    INTELLIGENCE_STATUS;

module.exports.RECOMMENDATION_ACTION =
    RECOMMENDATION_ACTION;

module.exports.DEFAULT_INTELLIGENCE_POLICY =
    DEFAULT_INTELLIGENCE_POLICY;