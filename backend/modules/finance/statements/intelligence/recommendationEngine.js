'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Repair Recommendation Engine
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/recommendationEngine.js
 *
 * Purpose
 * -------
 * Converts statement-repair intelligence into an explainable operational
 * recommendation.
 *
 * Responsibilities
 * ---------------
 * • Recommend repair actions
 * • Apply enterprise decision policies
 * • Determine automation eligibility
 * • Determine approval authority
 * • Enforce financial-risk controls
 * • Explain recommendation decisions
 * • Produce deterministic decision traces
 * • Support executive / operational reporting
 * • Support future AI/ML recommendation models
 * • Preserve policy precedence
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Explainable
 * • Policy driven
 * • Audit ready
 * • ML ready
 * • Fail closed
 * • No database access
 * • No repair execution
 * • No mutation of caller-owned objects
 *
 * IMPORTANT
 * ---------
 * This engine recommends an action.
 *
 * It MUST NOT:
 * • execute repairs
 * • mutate ledger entries
 * • approve financial transactions
 * • write to a database
 * • bypass authorization controls
 *
 * Downstream services are responsible for:
 * • authorization
 * • transaction boundaries
 * • idempotency
 * • execution
 * • audit persistence
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Recommendation Types
 * ============================================================================
 */

const RECOMMENDATION = Object.freeze({

    AUTO_APPROVE:
        'AUTO_APPROVE',

    MANUAL_REVIEW:
        'MANUAL_REVIEW',

    ESCALATE_FINANCE_MANAGER:
        'ESCALATE_FINANCE_MANAGER',

    ESCALATE_COMPLIANCE:
        'ESCALATE_COMPLIANCE',

    REVERSE_JOURNAL:
        'REVERSE_JOURNAL',

    MERGE_DUPLICATE_REPAIRS:
        'MERGE_DUPLICATE_REPAIRS',

    REQUEST_SUPPORTING_EVIDENCE:
        'REQUEST_SUPPORTING_EVIDENCE',

    RECONCILE_AUTOMATICALLY:
        'RECONCILE_AUTOMATICALLY',

    CLOSE_REPAIR:
        'CLOSE_REPAIR'
});

/**
 * ============================================================================
 * Risk Levels
 * ============================================================================
 */

const RISK_LEVEL = Object.freeze({

    LOW: 'LOW',

    MEDIUM: 'MEDIUM',

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

    MEDIUM: 2,

    HIGH: 3,

    CRITICAL: 4
});

/**
 * ============================================================================
 * Approval Authority
 * ============================================================================
 */

const APPROVAL_AUTHORITY = Object.freeze({

    SYSTEM: 'SYSTEM',

    FINANCE_OFFICER: 'FINANCE_OFFICER',

    FINANCE_MANAGER: 'FINANCE_MANAGER',

    COMPLIANCE_OFFICER: 'COMPLIANCE_OFFICER',

    CFO: 'CFO'
});

/**
 * ============================================================================
 * Policy Version
 * ============================================================================
 */

const POLICY_VERSION =
    'STATEMENT_REPAIR_RECOMMENDATION_POLICY_V1';

/**
 * ============================================================================
 * Default Policy Configuration
 * ============================================================================
 *
 * All monetary thresholds should be treated as policy configuration rather
 * than hidden business logic.
 *
 * Currency conversion, tenant-specific limits, and regulatory thresholds
 * should be resolved by the caller before this engine is invoked.
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    autoApprovalAmountLimit: 1000,

    automaticReconciliationConfidence: 95,

    autoApprovalConfidence: 90,

    mlMinimumConfidence: 90,

    maximumAutomatedRisk:
        RISK_LEVEL.LOW,

    requireEvidenceForAutomation: true,

    allowMlToOverridePolicy: false,

    allowMlToChangeAuthority: false,

    allowMlToChangeAutomation: false
});

/**
 * ============================================================================
 * Confidence Range
 * ============================================================================
 */

const CONFIDENCE_RANGE = Object.freeze({

    MIN: 0,

    MAX: 100
});

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
function toFiniteNumber(value, fallback = 0) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

/**
 * Clamp confidence to 0–100.
 *
 * @param {*} value
 * @returns {number}
 */
function clampConfidence(value) {

    return Math.min(
        CONFIDENCE_RANGE.MAX,
        Math.max(
            CONFIDENCE_RANGE.MIN,
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
 * Safely freeze an array.
 *
 * @param {Array} values
 * @returns {Array}
 */
function freezeArray(values) {

    return Object.freeze([
        ...values
    ]);
}

/**
 * Safely freeze an object.
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
 * ============================================================================
 * Recommendation Engine
 * ============================================================================
 */

class RecommendationEngine {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {object} options
     * @param {object|null} options.mlProvider
     * @param {object} options.policy
     * @param {Function} options.clock
     */
    constructor({

        mlProvider = null,

        policy = {},

        clock = () => new Date()

    } = {}) {

        if (
            mlProvider !== null &&
            typeof mlProvider !== 'object'
        ) {

            throw new TypeError(
                'mlProvider must be an object or null.'
            );
        }

        if (typeof clock !== 'function') {

            throw new TypeError(
                'clock must be a function.'
            );
        }

        this.mlProvider =
            mlProvider;

        this.policy =
            freezeObject({

                ...DEFAULT_POLICY,

                ...(policy || {})

            });

        this.clock =
            clock;

        this.policyVersion =
            POLICY_VERSION;
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     *
     * Main recommendation entry point.
     *
     * Enterprise policy always remains authoritative.
     *
     * ML is advisory unless explicitly configured otherwise.
     *
     * @param {object} repair
     * @returns {object}
     */
    recommendAction(repair = {}) {

        this.assertRepairObject(repair);

        const policyRecommendation =
            this.applyPolicies(repair);

        const mlRecommendation =
            this.getMlRecommendation(
                repair,
                policyRecommendation
            );

        const finalRecommendation =
            this.resolveMlRecommendation(
                policyRecommendation,
                mlRecommendation
            );

        return Object.freeze(
            finalRecommendation
        );
    }

    /**
     * =========================================================================
     * Enterprise Policy Engine
     * =========================================================================
     *
     * Policy precedence is intentionally explicit.
     *
     * Highest-risk conditions are evaluated first.
     *
     * @param {object} repair
     * @returns {object}
     */
    applyPolicies(repair = {}) {

        this.assertRepairObject(repair);

        /**
         * ---------------------------------------------------------------------
         * Policy 1 — Regulatory / Compliance
         * ---------------------------------------------------------------------
         */

        if (
            repair.regulatoryViolation === true ||
            repair.requiresComplianceReview === true
        ) {

            return this.buildRecommendation({

                action:
                    RECOMMENDATION.ESCALATE_COMPLIANCE,

                authority:
                    APPROVAL_AUTHORITY.COMPLIANCE_OFFICER,

                confidence: 99,

                automated: false,

                risk:
                    RISK_LEVEL.CRITICAL,

                reasons: [

                    'Regulatory or compliance review is required.'

                ],

                policyCode:
                    'REGULATORY_COMPLIANCE_ESCALATION',

                automationEligible: false

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 2 — Ledger Integrity
         * ---------------------------------------------------------------------
         */

        if (
            repair.ledgerIntegrityViolation === true ||
            repair.doubleEntryMismatch === true
        ) {

            return this.buildRecommendation({

                action:
                    RECOMMENDATION.ESCALATE_FINANCE_MANAGER,

                authority:
                    APPROVAL_AUTHORITY.FINANCE_MANAGER,

                confidence: 97,

                automated: false,

                risk:
                    RISK_LEVEL.CRITICAL,

                reasons: [

                    'Ledger integrity or double-entry consistency is affected.'

                ],

                policyCode:
                    'LEDGER_INTEGRITY_ESCALATION',

                automationEligible: false

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 3 — Invalid Posting / Reversal
         * ---------------------------------------------------------------------
         */

        if (
            repair.reverseRequired === true ||
            repair.invalidPosting === true
        ) {

            return this.buildRecommendation({

                action:
                    RECOMMENDATION.REVERSE_JOURNAL,

                authority:
                    APPROVAL_AUTHORITY.FINANCE_MANAGER,

                confidence: 95,

                automated: false,

                risk:
                    RISK_LEVEL.HIGH,

                reasons: [

                    'A journal reversal or correction is required.'

                ],

                policyCode:
                    'JOURNAL_REVERSAL_REQUIRED',

                automationEligible: false

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 4 — Duplicate Repair
         * ---------------------------------------------------------------------
         */

        if (
            repair.duplicate === true ||
            repair.duplicatePosting === true
        ) {

            const evidenceGate =
                this.hasRequiredEvidence(
                    repair
                );

            const automationEligible =
                evidenceGate;

            return this.buildRecommendation({

                action:
                    RECOMMENDATION.MERGE_DUPLICATE_REPAIRS,

                authority:
                    APPROVAL_AUTHORITY.FINANCE_OFFICER,

                confidence: 95,

                automated:
                    automationEligible,

                risk:
                    RISK_LEVEL.LOW,

                reasons:
                    evidenceGate
                        ? [
                            'Duplicate repair or posting detected.'
                        ]
                        : [
                            'Duplicate repair or posting detected.',
                            'Supporting evidence is insufficient for automation.'
                        ],

                policyCode:
                    'DUPLICATE_REPAIR_DETECTED',

                automationEligible

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 5 — Missing Evidence
         * ---------------------------------------------------------------------
         */

        if (
            repair.missingEvidence === true ||
            repair.supportingEvidenceMissing === true
        ) {

            return this.buildRecommendation({

                action:
                    RECOMMENDATION.REQUEST_SUPPORTING_EVIDENCE,

                authority:
                    APPROVAL_AUTHORITY.FINANCE_OFFICER,

                confidence: 96,

                automated: false,

                risk:
                    RISK_LEVEL.MEDIUM,

                reasons: [

                    'Required supporting evidence is missing.'

                ],

                policyCode:
                    'SUPPORTING_EVIDENCE_REQUIRED',

                automationEligible: false

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 6 — Already Executed
         * ---------------------------------------------------------------------
         *
         * A successfully executed repair should be closed rather than
         * re-approved.
         */

        if (
            normalizeEnum(
                repair.status
            ) === 'EXECUTED'
        ) {

            return this.buildRecommendation({

                action:
                    RECOMMENDATION.CLOSE_REPAIR,

                authority:
                    APPROVAL_AUTHORITY.SYSTEM,

                confidence: 100,

                automated: true,

                risk:
                    RISK_LEVEL.LOW,

                reasons: [

                    'Repair has already been successfully executed.'

                ],

                policyCode:
                    'EXECUTED_REPAIR_CLOSE',

                automationEligible: true

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 7 — Automatic Reconciliation
         * ---------------------------------------------------------------------
         */

        const matchConfidence =
            toFiniteNumber(
                repair.matchConfidence,
                0
            );

        if (
            repair.autoReconciliable === true ||
            matchConfidence >=
                this.policy
                    .automaticReconciliationConfidence
        ) {

            const evidenceGate =
                this.hasRequiredEvidence(
                    repair
                );

            const automationEligible =
                evidenceGate &&
                this.isRiskWithinAutomationLimit(
                    RISK_LEVEL.LOW
                );

            return this.buildRecommendation({

                action:
                    automationEligible
                        ? RECOMMENDATION.RECONCILE_AUTOMATICALLY
                        : RECOMMENDATION.MANUAL_REVIEW,

                authority:
                    automationEligible
                        ? APPROVAL_AUTHORITY.SYSTEM
                        : APPROVAL_AUTHORITY.FINANCE_OFFICER,

                confidence:
                    Math.max(
                        98,
                        clampConfidence(
                            matchConfidence
                        )
                    ),

                automated:
                    automationEligible,

                risk:
                    RISK_LEVEL.LOW,

                reasons:
                    automationEligible
                        ? [
                            'High-confidence reconciliation criteria satisfied.'
                        ]
                        : [
                            'High-confidence reconciliation detected.',
                            'Automation gate not satisfied.'
                        ],

                policyCode:
                    automationEligible
                        ? 'AUTOMATIC_RECONCILIATION_ELIGIBLE'
                        : 'AUTOMATIC_RECONCILIATION_BLOCKED',

                automationEligible

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 8 — Low Value / Low Risk Auto Approval
         * ---------------------------------------------------------------------
         */

        const amount =
            Math.abs(
                toFiniteNumber(
                    repair.amount ??
                    repair.evidence?.amount,
                    0
                )
            );

        const severity =
            normalizeEnum(
                repair.severity
            );

        const lowValue =
            amount <
            this.policy.autoApprovalAmountLimit;

        const lowSeverity =
            severity === 'LOW';

        const evidenceGate =
            this.hasRequiredEvidence(
                repair
            );

        if (
            lowValue &&
            lowSeverity &&
            evidenceGate
        ) {

            const automationEligible =
                this.isRiskWithinAutomationLimit(
                    RISK_LEVEL.LOW
                );

            return this.buildRecommendation({

                action:
                    automationEligible
                        ? RECOMMENDATION.AUTO_APPROVE
                        : RECOMMENDATION.MANUAL_REVIEW,

                authority:
                    automationEligible
                        ? APPROVAL_AUTHORITY.SYSTEM
                        : APPROVAL_AUTHORITY.FINANCE_OFFICER,

                confidence:
                    this.policy.autoApprovalConfidence,

                automated:
                    automationEligible,

                risk:
                    RISK_LEVEL.LOW,

                reasons:
                    automationEligible
                        ? [
                            'Repair is low severity.',
                            `Repair amount is below configured auto-approval limit of ${this.policy.autoApprovalAmountLimit}.`,
                            'Required supporting evidence is present.'
                        ]
                        : [
                            'Repair satisfies low-value and low-severity criteria.',
                            'Automation policy currently prevents automatic approval.'
                        ],

                policyCode:
                    automationEligible
                        ? 'LOW_VALUE_AUTO_APPROVAL'
                        : 'LOW_VALUE_AUTOMATION_BLOCKED',

                automationEligible

            });
        }

        /**
         * ---------------------------------------------------------------------
         * Policy 9 — Default Manual Review
         * ---------------------------------------------------------------------
         */

        return this.buildRecommendation({

            action:
                RECOMMENDATION.MANUAL_REVIEW,

            authority:
                APPROVAL_AUTHORITY.FINANCE_OFFICER,

            confidence: 80,

            automated: false,

            risk:
                RISK_LEVEL.MEDIUM,

            reasons: [

                'No deterministic automatic policy was satisfied.',

                'Manual financial assessment is required.'

            ],

            policyCode:
                'DEFAULT_MANUAL_REVIEW',

            automationEligible: false

        });
    }

    /**
     * =========================================================================
     * Supporting Evidence Gate
     * =========================================================================
     *
     * @param {object} repair
     * @returns {boolean}
     */
    hasRequiredEvidence(repair = {}) {

        if (
            !this.policy
                .requireEvidenceForAutomation
        ) {
            return true;
        }

        if (
            repair.missingEvidence === true ||
            repair.supportingEvidenceMissing === true
        ) {
            return false;
        }

        /**
         * Explicit evidence state takes precedence.
         */
        if (
            typeof repair.hasSupportingEvidence ===
            'boolean'
        ) {
            return repair.hasSupportingEvidence;
        }

        /**
         * Existing evidence objects are accepted.
         */
        if (
            repair.evidence &&
            typeof repair.evidence === 'object'
        ) {
            return Object.keys(
                repair.evidence
            ).length > 0;
        }

        /**
         * Preserve compatibility with existing callers that do not provide
         * explicit evidence metadata.
         */
        return true;
    }

    /**
     * =========================================================================
     * Automation Risk Gate
     * =========================================================================
     *
     * Fail-closed comparison.
     *
     * @param {string} risk
     * @returns {boolean}
     */
    isRiskWithinAutomationLimit(risk) {

        const currentRank =
            RISK_RANK[
                normalizeEnum(risk)
            ] || Number.MAX_SAFE_INTEGER;

        const maximumRank =
            RISK_RANK[
                normalizeEnum(
                    this.policy.maximumAutomatedRisk
                )
            ] || 0;

        return currentRank <= maximumRank;
    }

    /**
     * =========================================================================
     * ML Recommendation
     * =========================================================================
     *
     * ML is deliberately advisory.
     *
     * A failing ML provider must never break the deterministic policy engine.
     *
     * @param {object} repair
     * @param {object} policyRecommendation
     * @returns {object|null}
     */
    getMlRecommendation(
        repair,
        policyRecommendation
    ) {

        if (
            !this.mlProvider ||
            typeof this.mlProvider.recommend !==
                'function'
        ) {
            return null;
        }

        try {

            const result =
                this.mlProvider.recommend(
                    repair,
                    policyRecommendation
                );

            if (
                !result ||
                typeof result !== 'object'
            ) {
                return null;
            }

            return freezeObject({

                ...result,

                source: 'ML_PROVIDER'

            });

        } catch (error) {

            /**
             * ML failures are intentionally contained.
             *
             * The deterministic enterprise policy remains authoritative.
             */

            return freezeObject({

                source:
                    'ML_PROVIDER',

                available: false,

                error:
                    error?.message ||
                    'ML recommendation provider failed.'

            });
        }
    }

    /**
     * =========================================================================
     * Resolve ML Recommendation
     * =========================================================================
     *
     * By default, ML cannot override:
     * • compliance escalation
     * • ledger integrity escalation
     * • journal reversal
     * • evidence requirements
     * • approval authority
     * • automation eligibility
     *
     * @param {object} policyRecommendation
     * @param {object|null} mlRecommendation
     * @returns {object}
     */
    resolveMlRecommendation(
        policyRecommendation,
        mlRecommendation
    ) {

        if (!mlRecommendation) {

            return policyRecommendation;
        }

        /**
         * Enterprise policy remains authoritative unless explicitly enabled.
         */

        if (
            !this.policy.allowMlToOverridePolicy
        ) {

            return this.attachMlAdvisory(
                policyRecommendation,
                mlRecommendation
            );
        }

        /**
         * Even when ML override is enabled, confidence must satisfy the
         * configured threshold.
         */

        const mlConfidence =
            clampConfidence(
                mlRecommendation.confidence
            );

        if (
            mlConfidence <
            this.policy.mlMinimumConfidence
        ) {

            return this.attachMlAdvisory(
                policyRecommendation,
                mlRecommendation
            );
        }

        /**
         * Critical enterprise policy decisions cannot be overridden by ML.
         */

        if (
            policyRecommendation.riskLevel ===
            RISK_LEVEL.CRITICAL
        ) {

            return this.attachMlAdvisory(
                policyRecommendation,
                mlRecommendation
            );
        }

        const merged = {

            ...policyRecommendation,

            mlAdvisory:
                mlRecommendation,

            decisionSource:
                'POLICY_WITH_ML_INPUT'

        };

        /**
         * Recommendation action may only be changed when explicitly allowed.
         */

        if (
            typeof mlRecommendation.recommendation ===
                'string'
        ) {

            merged.recommendation =
                mlRecommendation.recommendation;
        }

        /**
         * Approval authority is protected unless explicitly enabled.
         */

        if (
            this.policy.allowMlToChangeAuthority &&
            typeof mlRecommendation.approvalAuthority ===
                'string'
        ) {

            merged.approvalAuthority =
                mlRecommendation.approvalAuthority;
        }

        /**
         * Automation remains protected unless explicitly enabled.
         */

        if (
            !this.policy.allowMlToChangeAutomation
        ) {

            merged.automated =
                policyRecommendation.automated;

            merged.automationEligible =
                policyRecommendation
                    .automationEligible;
        }

        return freezeObject(
            merged
        );
    }

    /**
     * =========================================================================
     * Attach ML Advisory
     * =========================================================================
     *
     * @param {object} recommendation
     * @param {object} mlRecommendation
     * @returns {object}
     */
    attachMlAdvisory(
        recommendation,
        mlRecommendation
    ) {

        return freezeObject({

            ...recommendation,

            mlAdvisory:
                mlRecommendation,

            decisionSource:
                'DETERMINISTIC_POLICY'

        });
    }

    /**
     * =========================================================================
     * Build Recommendation
     * =========================================================================
     *
     * Centralizes recommendation construction and validation.
     *
     * @param {object} options
     * @returns {object}
     */
    buildRecommendation({

        action,

        authority,

        confidence,

        automated,

        risk,

        reasons = [],

        policyCode,

        automationEligible = false

    }) {

        const normalizedAction =
            normalizeEnum(action);

        const normalizedAuthority =
            normalizeEnum(authority);

        const normalizedRisk =
            normalizeEnum(risk);

        if (
            !Object.values(
                RECOMMENDATION
            ).includes(
                normalizedAction
            )
        ) {

            throw new Error(
                `Invalid recommendation action: ${action}`
            );
        }

        if (
            !Object.values(
                APPROVAL_AUTHORITY
            ).includes(
                normalizedAuthority
            )
        ) {

            throw new Error(
                `Invalid approval authority: ${authority}`
            );
        }

        if (
            !Object.values(
                RISK_LEVEL
            ).includes(
                normalizedRisk
            )
        ) {

            throw new Error(
                `Invalid risk level: ${risk}`
            );
        }

        const normalizedConfidence =
            clampConfidence(
                confidence
            );

        const normalizedReasons =
            Array.isArray(reasons)
                ? reasons
                    .filter(
                        reason =>
                            typeof reason ===
                            'string' &&
                            reason.trim().length > 0
                    )
                    .map(
                        reason =>
                            reason.trim()
                    )
                : [];

        /**
         * Automation is never allowed when risk exceeds policy limits.
         */
        const safeAutomation =
            Boolean(automated) &&
            Boolean(automationEligible) &&
            this.isRiskWithinAutomationLimit(
                normalizedRisk
            );

        return freezeObject({

            recommendation:
                normalizedAction,

            approvalAuthority:
                normalizedAuthority,

            confidence:
                normalizedConfidence,

            automated:
                safeAutomation,

            automationEligible:
                Boolean(
                    automationEligible
                ),

            riskLevel:
                normalizedRisk,

            riskRank:
                RISK_RANK[
                    normalizedRisk
                ],

            policyCode:
                policyCode ||
                'UNSPECIFIED_POLICY',

            policyVersion:
                this.policyVersion,

            reasons:
                freezeArray(
                    normalizedReasons
                ),

            generatedAt:
                this.clock(),

            decisionTrace:
                freezeObject({

                    policyVersion:
                        this.policyVersion,

                    policyCode:
                        policyCode ||
                        'UNSPECIFIED_POLICY',

                    recommendation:
                        normalizedAction,

                    approvalAuthority:
                        normalizedAuthority,

                    riskLevel:
                        normalizedRisk,

                    confidence:
                        normalizedConfidence,

                    automated:
                        safeAutomation

                }),

            decisionSource:
                'DETERMINISTIC_POLICY'
        });
    }

    /**
     * =========================================================================
     * Explain Recommendation
     * =========================================================================
     *
     * Generates an executive-friendly explanation without changing the
     * recommendation itself.
     *
     * @param {object} repair
     * @returns {object}
     */
    explainRecommendation(repair = {}) {

        const recommendation =
            this.recommendAction(
                repair
            );

        return freezeObject({

            repairId:
                repair.repairId ??
                repair.id ??
                null,

            recommendation:
                recommendation.recommendation,

            approvalAuthority:
                recommendation.approvalAuthority,

            riskLevel:
                recommendation.riskLevel,

            confidence:
                recommendation.confidence,

            automated:
                recommendation.automated,

            summary:
                this.buildExplanationSummary(
                    recommendation
                ),

            reasons:
                recommendation.reasons,

            policyCode:
                recommendation.policyCode,

            policyVersion:
                recommendation.policyVersion,

            decisionSource:
                recommendation.decisionSource
        });
    }

    /**
     * =========================================================================
     * Build Explanation Summary
     * =========================================================================
     *
     * @param {object} recommendation
     * @returns {string}
     */
    buildExplanationSummary(
        recommendation
    ) {

        const action =
            recommendation
                .recommendation;

        const authority =
            recommendation
                .approvalAuthority;

        const risk =
            recommendation
                .riskLevel;

        const automation =
            recommendation
                .automated
                ? 'automated'
                : 'requires controlled review';

        return (
            `${action} was selected with ` +
            `${recommendation.confidence}% confidence. ` +
            `Risk level is ${risk}. ` +
            `Approval authority is ${authority}. ` +
            `The recommendation ${automation}.`
        );
    }

    /**
     * =========================================================================
     * Get Policy Configuration
     * =========================================================================
     *
     * @returns {object}
     */
    getPolicyConfiguration() {

        return freezeObject({

            policyVersion:
                this.policyVersion,

            policy:
                freezeObject({
                    ...this.policy
                }),

            recommendationTypes:
                freezeArray(
                    Object.values(
                        RECOMMENDATION
                    )
                ),

            riskLevels:
                freezeArray(
                    Object.values(
                        RISK_LEVEL
                    )
                ),

            approvalAuthorities:
                freezeArray(
                    Object.values(
                        APPROVAL_AUTHORITY
                    )
                )
        });
    }

    /**
     * =========================================================================
     * Validate Repair
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

RecommendationEngine.RECOMMENDATION =
    RECOMMENDATION;

RecommendationEngine.RISK_LEVEL =
    RISK_LEVEL;

RecommendationEngine.RISK_RANK =
    RISK_RANK;

RecommendationEngine.APPROVAL_AUTHORITY =
    APPROVAL_AUTHORITY;

RecommendationEngine.DEFAULT_POLICY =
    DEFAULT_POLICY;

RecommendationEngine.POLICY_VERSION =
    POLICY_VERSION;

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    RecommendationEngine;

module.exports.RECOMMENDATION =
    RECOMMENDATION;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.RISK_RANK =
    RISK_RANK;

module.exports.APPROVAL_AUTHORITY =
    APPROVAL_AUTHORITY;

module.exports.DEFAULT_POLICY =
    DEFAULT_POLICY;

module.exports.POLICY_VERSION =
    POLICY_VERSION;