'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Compliance Decision Engine
 * ============================================================================
 *
 * Purpose
 * -------
 * Centralized decision orchestration across:
 *
 *   • Fraud
 *   • AML
 *   • KYC
 *
 * This component produces the final compliance disposition for an operation.
 *
 * Decision precedence
 * -------------------
 *
 *   BLOCK
 *     ↓
 *   REVIEW
 *     ↓
 *   APPROVE
 *
 * The engine is deliberately fail-closed for missing or invalid mandatory
 * compliance evidence.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Fraud scoring
 * • AML screening
 * • KYC verification
 * • Payment execution
 * • Ledger posting
 * • Regulatory filing
 *
 * ============================================================================
 */

const crypto = require('crypto');


const DECISIONS = Object.freeze({

    APPROVE:
        'APPROVE',

    REVIEW:
        'REVIEW',

    BLOCK:
        'BLOCK',

    ERROR:
        'ERROR'

});


const REASONS = Object.freeze({

    FRAUD_RISK:
        'FRAUD_RISK',

    AML_BLOCK:
        'AML_BLOCK',

    AML_REVIEW:
        'AML_REVIEW',

    KYC_FAILURE:
        'KYC_FAILURE',

    KYC_REVIEW:
        'KYC_REVIEW',

    MISSING_FRAUD_RESULT:
        'MISSING_FRAUD_RESULT',

    MISSING_AML_RESULT:
        'MISSING_AML_RESULT',

    MISSING_KYC_RESULT:
        'MISSING_KYC_RESULT',

    INVALID_FRAUD_RESULT:
        'INVALID_FRAUD_RESULT',

    INVALID_AML_RESULT:
        'INVALID_AML_RESULT',

    INVALID_KYC_RESULT:
        'INVALID_KYC_RESULT',

    COMPLIANCE_REVIEW:
        'COMPLIANCE_REVIEW',

    POLICY_ERROR:
        'POLICY_ERROR'

});


const DEFAULT_POLICY = Object.freeze({

    fraudBlockThreshold:
        70,

    fraudReviewThreshold:
        40,

    requireFraudResult:
        true,

    requireAMLResult:
        true,

    requireKYCResult:
        true,

    failClosed:
        true,

    policyVersion:
        'compliance-v1'

});


class ComplianceDecisionEngine {

    constructor({

        logger = null,

        metrics = null,

        auditService = null,

        policy = {},

        clock = Date

    } = {}) {

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.auditService =
            auditService;

        this.clock =
            clock;

        this.policy = Object.freeze({

            ...DEFAULT_POLICY,

            ...policy

        });

        this.startedAt =
            new this.clock();

        this.statistics = {

            evaluations:
                0,

            approved:
                0,

            reviewed:
                0,

            blocked:
                0,

            errors:
                0

        };

    }

    /**
     * =========================================================================
     * Evaluate
     * =========================================================================
     */

    async evaluate({

        fraud,

        aml,

        kyc,

        tenantId = null,

        transactionId = null,

        customerId = null,

        correlationId =
            crypto.randomUUID(),

        requestId = null,

        idempotencyKey = null

    } = {}) {

        const startedAt =
            Date.now();

        this.statistics.evaluations++;

        const context = {

            tenantId,

            transactionId,

            customerId,

            correlationId,

            requestId,

            idempotencyKey

        };

        try {

            this.validateContext(
                context
            );

            const normalized = {
                fraud:
                    this.normalizeFraud(
                        fraud
                    ),

                aml:
                    this.normalizeAML(
                        aml
                    ),

                kyc:
                    this.normalizeKYC(
                        kyc
                    )
            };

            const decision =
                this.evaluateDecision(
                    normalized
                );

            const result = {

                success:
                    true,

                decision:
                    decision.decision,

                reason:
                    decision.reason,

                reasons:
                    decision.reasons,

                riskScore:
                    decision.riskScore,

                fraudRiskScore:
                    normalized.fraud.riskScore,

                amlStatus:
                    normalized.aml.status,

                kycStatus:
                    normalized.kyc.status,

                tenantId,

                transactionId,

                customerId,

                correlationId,

                requestId,

                idempotencyKey,

                policyVersion:
                    this.policy.policyVersion,

                decisionFingerprint:
                    this.createDecisionFingerprint({
                        normalized,
                        decision:
                            decision.decision,
                        reasons:
                            decision.reasons,
                        policyVersion:
                            this.policy.policyVersion,
                        tenantId,
                        transactionId,
                        customerId
                    }),

                evaluatedAt:
                    new this.clock(),

                durationMs:
                    Date.now() - startedAt

            };

            this.recordDecisionMetrics(
                result
            );

            this.logger?.info?.({

                message:
                    'Compliance decision evaluated',

                tenantId,

                transactionId,

                customerId,

                correlationId,

                decision:
                    result.decision,

                reason:
                    result.reason,

                policyVersion:
                    result.policyVersion,

                durationMs:
                    result.durationMs

            });

            await this.recordAudit(
                result
            );

            return result;

        }
        catch (error) {

            this.statistics.errors++;

            this.metrics?.counter?.(
                'compliance_decision_error_total'
            );

            this.logger?.error?.({

                message:
                    'Compliance decision evaluation failed',

                tenantId,

                transactionId,

                customerId,

                correlationId,

                error:
                    this.safeError(
                        error
                    )

            });

            if (
                this.policy.failClosed
            ) {

                return {

                    success:
                        false,

                    decision:
                        DECISIONS.REVIEW,

                    reason:
                        REASONS.POLICY_ERROR,

                    reasons: [

                        REASONS.POLICY_ERROR

                    ],

                    tenantId,

                    transactionId,

                    customerId,

                    correlationId,

                    requestId,

                    idempotencyKey,

                    policyVersion:
                        this.policy.policyVersion,

                    evaluatedAt:
                        new this.clock(),

                    durationMs:
                        Date.now() - startedAt,

                    error:
                        this.safeError(
                            error
                        )

                };

            }

            throw error;

        }

    }

    /**
     * =========================================================================
     * Decision Evaluation
     * =========================================================================
     */

    evaluateDecision({
        fraud,
        aml,
        kyc
    }) {

        const reasons = [];

        /**
         * ---------------------------------------------------------------------
         * Fraud — strongest immediate block signal
         * ---------------------------------------------------------------------
         */

        if (
            fraud.riskScore >=
            this.policy.fraudBlockThreshold
        ) {

            reasons.push(
                REASONS.FRAUD_RISK
            );

            return {

                decision:
                    DECISIONS.BLOCK,

                reason:
                    REASONS.FRAUD_RISK,

                reasons,

                riskScore:
                    fraud.riskScore

            };

        }

        /**
         * ---------------------------------------------------------------------
         * AML hard block
         * ---------------------------------------------------------------------
         */

        if (
            aml.status === 'BLOCK' ||
            aml.blocked === true
        ) {

            reasons.push(
                REASONS.AML_BLOCK
            );

            return {

                decision:
                    DECISIONS.BLOCK,

                reason:
                    REASONS.AML_BLOCK,

                reasons,

                riskScore:
                    this.aggregateRiskScore({
                        fraud,
                        aml,
                        kyc
                    })

            };

        }

        /**
         * ---------------------------------------------------------------------
         * KYC hard failure
         * ---------------------------------------------------------------------
         *
         * A failed KYC state is not silently treated as approval.
         */

        if (
            kyc.status === 'FAILED' ||
            kyc.passed === false &&
            kyc.status === 'FAILED'
        ) {

            reasons.push(
                REASONS.KYC_FAILURE
            );

            return {

                decision:
                    DECISIONS.REVIEW,

                reason:
                    REASONS.KYC_FAILURE,

                reasons,

                riskScore:
                    this.aggregateRiskScore({
                        fraud,
                        aml,
                        kyc
                    })

            };

        }

        /**
         * ---------------------------------------------------------------------
         * AML review
         * ---------------------------------------------------------------------
         */

        if (
            aml.status === 'REVIEW' ||
            aml.requiresReview === true
        ) {

            reasons.push(
                REASONS.AML_REVIEW
            );

        }

        /**
         * ---------------------------------------------------------------------
         * KYC review
         * ---------------------------------------------------------------------
         */

        if (
            kyc.status === 'REVIEW' ||
            kyc.requiresReview === true
        ) {

            reasons.push(
                REASONS.KYC_REVIEW
            );

        }

        /**
         * ---------------------------------------------------------------------
         * Fraud elevated but below block threshold
         * ---------------------------------------------------------------------
         */

        if (
            fraud.riskScore >=
            this.policy.fraudReviewThreshold
        ) {

            reasons.push(
                REASONS.FRAUD_RISK
            );

        }

        if (reasons.length > 0) {

            return {

                decision:
                    DECISIONS.REVIEW,

                reason:
                    reasons[0],

                reasons,

                riskScore:
                    this.aggregateRiskScore({
                        fraud,
                        aml,
                        kyc
                    })

            };

        }

        /**
         * ---------------------------------------------------------------------
         * All mandatory compliance checks passed
         * ---------------------------------------------------------------------
         */

        return {

            decision:
                DECISIONS.APPROVE,

            reason:
                null,

            reasons: [],

            riskScore:
                this.aggregateRiskScore({
                    fraud,
                    aml,
                    kyc
                })

        };

    }

    /**
     * =========================================================================
     * Fraud Normalization
     * =========================================================================
     */

    normalizeFraud(fraud) {

        if (
            fraud === undefined ||
            fraud === null
        ) {

            if (
                this.policy.requireFraudResult
            ) {

                throw new Error(
                    REASONS.MISSING_FRAUD_RESULT
                );

            }

            return {

                riskScore:
                    0,

                status:
                    'UNKNOWN'

            };

        }

        if (
            typeof fraud !== 'object'
        ) {

            throw new Error(
                REASONS.INVALID_FRAUD_RESULT
            );

        }

        const riskScore =
            Number(
                fraud.riskScore ?? 0
            );

        if (
            !Number.isFinite(riskScore) ||
            riskScore < 0
        ) {

            throw new Error(
                REASONS.INVALID_FRAUD_RESULT
            );

        }

        return {

            riskScore:
                Math.min(
                    riskScore,
                    100
                ),

            status:
                fraud.status ||
                'CLEAR',

            requiresReview:
                Boolean(
                    fraud.requiresReview
                )

        };

    }

    /**
     * =========================================================================
     * AML Normalization
     * =========================================================================
     */

    normalizeAML(aml) {

        if (
            aml === undefined ||
            aml === null
        ) {

            if (
                this.policy.requireAMLResult
            ) {

                throw new Error(
                    REASONS.MISSING_AML_RESULT
                );

            }

            return {

                status:
                    'CLEAR',

                passed:
                    true,

                requiresReview:
                    false,

                blocked:
                    false

            };

        }

        if (
            typeof aml !== 'object'
        ) {

            throw new Error(
                REASONS.INVALID_AML_RESULT
            );

        }

        const status =
            String(
                aml.status ||
                (
                    aml.blocked
                        ? 'BLOCK'
                        : aml.requiresReview
                            ? 'REVIEW'
                            : aml.passed
                                ? 'CLEAR'
                                : 'REVIEW'
                )
            )
                .trim()
                .toUpperCase();

        return {

            status,

            passed:
                status === 'CLEAR' ||
                aml.passed === true,

            requiresReview:
                status === 'REVIEW' ||
                aml.requiresReview === true,

            blocked:
                status === 'BLOCK' ||
                aml.blocked === true

        };

    }

    /**
     * =========================================================================
     * KYC Normalization
     * =========================================================================
     */

    normalizeKYC(kyc) {

        if (
            kyc === undefined ||
            kyc === null
        ) {

            if (
                this.policy.requireKYCResult
            ) {

                throw new Error(
                    REASONS.MISSING_KYC_RESULT
                );

            }

            return {

                status:
                    'CLEAR',

                passed:
                    true,

                requiresReview:
                    false

            };

        }

        if (
            typeof kyc !== 'object'
        ) {

            throw new Error(
                REASONS.INVALID_KYC_RESULT
            );

        }

        let status =
            String(
                kyc.status ||
                (
                    kyc.passed
                        ? 'CLEAR'
                        : kyc.requiresReview
                            ? 'REVIEW'
                            : 'FAILED'
                )
            )
                .trim()
                .toUpperCase();

        if (
            status === 'PASS' ||
            status === 'PASSED' ||
            status === 'VERIFIED'
        ) {

            status =
                'CLEAR';

        }

        if (
            status === 'PENDING'
        ) {

            status =
                'REVIEW';

        }

        return {

            status,

            passed:
                status === 'CLEAR' ||
                kyc.passed === true,

            requiresReview:
                status === 'REVIEW' ||
                kyc.requiresReview === true

        };

    }

    /**
     * =========================================================================
     * Risk Aggregation
     * =========================================================================
     *
     * Fraud is the only normalized numeric risk score currently supplied.
     *
     * AML/KYC remain compliance-state controls rather than pretending they
     * produce comparable numeric scores.
     */

    aggregateRiskScore({
        fraud
    }) {

        return Math.min(
            100,
            Math.max(
                0,
                Number(
                    fraud?.riskScore || 0
                )
            )
        );

    }

    /**
     * =========================================================================
     * Decision Fingerprint
     * =========================================================================
     */

    createDecisionFingerprint({

        normalized,

        decision,

        reasons,

        policyVersion,

        tenantId,

        transactionId,

        customerId

    }) {

        const canonical = {

            tenantId,

            transactionId,

            customerId,

            fraud:
                normalized.fraud,

            aml:
                normalized.aml,

            kyc:
                normalized.kyc,

            decision,

            reasons:
                [...reasons].sort(),

            policyVersion

        };

        return crypto
            .createHash('sha256')
            .update(
                JSON.stringify(
                    canonical
                ),
                'utf8'
            )
            .digest('hex');

    }

    /**
     * =========================================================================
     * Context Validation
     * =========================================================================
     */

    validateContext(context) {

        if (
            context.tenantId !== null &&
            typeof context.tenantId !== 'string'
        ) {

            throw new TypeError(
                'tenantId must be a string'
            );

        }

        if (
            context.correlationId &&
            typeof context.correlationId !== 'string'
        ) {

            throw new TypeError(
                'correlationId must be a string'
            );

        }

        return true;

    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    recordDecisionMetrics(result) {

        switch (
            result.decision
        ) {

            case DECISIONS.APPROVE:

                this.statistics.approved++;

                this.metrics?.counter?.(
                    'compliance_decision_approve_total'
                );

                break;

            case DECISIONS.REVIEW:

                this.statistics.reviewed++;

                this.metrics?.counter?.(
                    'compliance_decision_review_total'
                );

                break;

            case DECISIONS.BLOCK:

                this.statistics.blocked++;

                this.metrics?.counter?.(
                    'compliance_decision_block_total'
                );

                break;

            default:
                break;

        }

        this.metrics?.counter?.(
            'compliance_decision_total'
        );

    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAudit(result) {

        if (
            !this.auditService?.record
        ) {

            return;

        }

        try {

            await this.auditService.record({

                action:
                    'COMPLIANCE_DECISION_EVALUATED',

                tenantId:
                    result.tenantId,

                correlationId:
                    result.correlationId,

                metadata: {

                    transactionId:
                        result.transactionId,

                    customerId:
                        result.customerId,

                    decision:
                        result.decision,

                    reason:
                        result.reason,

                    reasons:
                        result.reasons,

                    riskScore:
                        result.riskScore,

                    fraudRiskScore:
                        result.fraudRiskScore,

                    amlStatus:
                        result.amlStatus,

                    kycStatus:
                        result.kycStatus,

                    policyVersion:
                        result.policyVersion,

                    decisionFingerprint:
                        result.decisionFingerprint

                }

            });

        }
        catch (error) {

            /**
             * Audit infrastructure failure is observable but does not
             * retroactively invalidate the compliance decision.
             */

            this.metrics?.counter?.(
                'compliance_decision_audit_failure_total'
            );

            this.logger?.warn?.({

                message:
                    'Compliance decision audit recording failed',

                correlationId:
                    result.correlationId,

                error:
                    this.safeError(
                        error
                    )

            });

        }

    }

    /**
     * =========================================================================
     * Safe Error
     * =========================================================================
     */

    safeError(error) {

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
                ).slice(
                    0,
                    500
                )

        };

    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        return {

            service:
                'COMPLIANCE_DECISION_ENGINE',

            status:
                'UP',

            policyVersion:
                this.policy.policyVersion,

            failClosed:
                this.policy.failClosed,

            statistics:
                this.stats()

        };

    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            policyVersion:
                this.policy.policyVersion,

            failClosed:
                this.policy.failClosed,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime()

        };

    }

    /**
     * =========================================================================
     * Capabilities
     * =========================================================================
     */

    capabilities() {

        return Object.freeze({

            fraudEvaluation:
                true,

            amlEvaluation:
                true,

            kycEvaluation:
                true,

            finalDecision:
                true,

            tenantAware:
                true,

            correlationAware:
                true,

            policyVersioning:
                true,

            decisionFingerprint:
                true,

            failClosed:
                this.policy.failClosed,

            audit:
                Boolean(
                    this.auditService
                ),

            metrics:
                Boolean(
                    this.metrics
                )

        });

    }

}


/**
 * ============================================================================
 * Backward-Compatible Singleton
 * ============================================================================
 */

const complianceDecisionEngine =
    new ComplianceDecisionEngine();


/**
 * Existing consumers can continue doing:
 *
 *   const engine = require('./complianceDecisionEngine');
 *
 *   engine.evaluate({
 *       fraud,
 *       aml,
 *       kyc
 *   });
 */

module.exports =
    complianceDecisionEngine;


/**
 * Named exports for tests / dependency injection.
 */

module.exports.ComplianceDecisionEngine =
    ComplianceDecisionEngine;

module.exports.DECISIONS =
    DECISIONS;

module.exports.REASONS =
    REASONS;