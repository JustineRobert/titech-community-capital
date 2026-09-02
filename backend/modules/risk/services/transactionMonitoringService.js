"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Transaction Monitoring Service
 * ============================================================================
 *
 * Enterprise Transaction Monitoring Engine
 * Version: 3.0.0
 *
 * Purpose
 * -------
 * Central transaction-risk monitoring and decisioning service.
 *
 * Responsibilities
 * ----------------
 * - Real-time transaction monitoring
 * - Rule-based risk detection
 * - Weighted risk scoring
 * - Velocity analysis
 * - Transaction amount analysis
 * - Account-age analysis
 * - Geolocation anomaly detection
 * - Device anomaly detection
 * - Behavioral deviation analysis
 * - Beneficiary risk analysis
 * - AML / sanctions / fraud signal integration
 * - Hard-block signal enforcement
 * - Risk decisioning
 * - Risk-factor explainability
 * - Transaction monitoring persistence
 * - Risk alert generation
 * - Alert deduplication
 * - Idempotency protection
 * - Tenant isolation
 * - Audit-event integration hooks
 *
 * Design Principles
 * -----------------
 * - Fail closed for critical compliance signals
 * - Never mutate financial transaction state
 * - Never directly modify ledger balances
 * - Deterministic scoring
 * - Explainable decisions
 * - Tenant-aware processing
 * - Backward-compatible public API
 * - Safe integration with external risk engines
 *
 * NOTE
 * ----
 * This service monitors and decides risk. It should NOT itself perform
 * financial posting, ledger mutation, transaction settlement, account
 * freezing, or loan approval.
 *
 * ============================================================================
 */

const crypto = require("crypto");

const RiskAlert = require("../../models/RiskAlert");
const TransactionLog = require("../../models/TransactionLog");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const DECISIONS = Object.freeze({
    APPROVE: "APPROVE",
    REVIEW: "REVIEW",
    BLOCK: "BLOCK",
});

const ALERT_STATUS = Object.freeze({
    OPEN: "OPEN",
});

const RISK_LEVELS = Object.freeze({
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
    CRITICAL: "CRITICAL",
});

const DEFAULT_CONFIG = Object.freeze({
    thresholds: {
        BLOCK: 80,
        REVIEW: 50,
        APPROVE: 0,
    },

    rules: {
        LARGE_AMOUNT: 1000000,

        VELOCITY_LIMIT: 5,

        NEW_ACCOUNT_AGE_MINUTES: 60,

        HIGH_VELOCITY_LIMIT: 10,

        EXTREME_VELOCITY_LIMIT: 20,

        HIGH_VALUE_AMOUNT: 5000000,

        EXTREME_VALUE_AMOUNT: 10000000,

        BEHAVIORAL_DEVIATION_MULTIPLIER: 5,

        HIGH_RISK_BEHAVIORAL_MULTIPLIER: 10,
    },

    weights: {
        LARGE_AMOUNT: 15,
        HIGH_VALUE_AMOUNT: 10,
        EXTREME_VALUE_AMOUNT: 20,

        NEW_ACCOUNT: 15,

        VELOCITY: 15,
        HIGH_VELOCITY: 10,
        EXTREME_VELOCITY: 20,

        LOCATION_MISMATCH: 15,

        NEW_DEVICE: 10,

        BEHAVIORAL_DEVIATION: 15,

        BENEFICIARY_RISK: 10,

        FRAUD_RISK: 20,

        AML_RISK: 25,

        SANCTIONS_RISK: 40,
    },

    /**
     * Risk scores are always normalized into this range.
     */
    scoreRange: {
        MIN: 0,
        MAX: 100,
    },

    /**
     * Alert deduplication window.
     */
    alertDeduplicationMinutes: 30,

    /**
     * Monitoring log idempotency window.
     */
    idempotencyWindowMinutes: 24 * 60,
});

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class TransactionMonitoringError extends Error {
    constructor(message, code = "TRANSACTION_MONITORING_ERROR", metadata = {}) {
        super(message);

        this.name = "TransactionMonitoringError";
        this.code = code;
        this.metadata = metadata;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, TransactionMonitoringError);
        }
    }
}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class TransactionMonitoringService {
    constructor(options = {}) {
        this.config = this.mergeConfig(DEFAULT_CONFIG, options.config || {});

        /**
         * Optional dependencies.
         *
         * These are intentionally injectable so this service can integrate
         * with the broader TITech risk architecture without creating hard
         * circular dependencies.
         */
        this.dependencies = {
            behavioralService: options.behavioralService || null,
            deviceService: options.deviceService || null,
            fraudService: options.fraudService || null,
            sanctionsService: options.sanctionsService || null,
            auditService: options.auditService || null,
            logger: options.logger || console,
        };
    }

    /**
     * =========================================================================
     * MAIN ENTRYPOINT
     * =========================================================================
     *
     * Backward compatible:
     *
     * monitorTransaction(user, transaction)
     *
     * Optional third argument:
     *
     * monitorTransaction(user, transaction, context)
     *
     * context may contain:
     * - idempotencyKey
     * - riskSignals
     * - behavioralRisk
     * - deviceRisk
     * - fraudRisk
     * - amlRisk
     * - sanctionsRisk
     * - beneficiaryRisk
     * - locationMismatch
     * - newDevice
     */
    async monitorTransaction(user, transaction, context = {}) {
        this.validateUser(user);
        this.validateTransaction(transaction);

        const monitoringId =
            context.monitoringId || crypto.randomUUID();

        const tenantId = this.resolveTenantId(user, transaction);

        const idempotencyKey =
            context.idempotencyKey ||
            transaction.idempotencyKey ||
            transaction.reference ||
            transaction._id
                ? String(
                      context.idempotencyKey ||
                          transaction.idempotencyKey ||
                          transaction.reference ||
                          transaction._id
                  )
                : null;

        /**
         * Prevent cross-tenant processing.
         */
        this.assertTenantIsolation(user, transaction, tenantId);

        /**
         * Optional idempotency lookup.
         */
        if (idempotencyKey) {
            const existingResult =
                await this.findExistingMonitoringResult(
                    tenantId,
                    idempotencyKey
                );

            if (existingResult) {
                return {
                    ...existingResult,
                    idempotentReplay: true,
                };
            }
        }

        const riskFactors =
            await this.buildRiskFactors(
                user,
                transaction,
                context
            );

        const riskScore =
            this.calculateFraudSafeRiskScore(riskFactors);

        const riskLevel =
            this.classifyRisk(riskScore);

        const decision =
            this.getDecision(
                riskScore,
                riskFactors
            );

        const reasons =
            this.generateDecisionReasons(
                riskFactors,
                riskScore,
                decision
            );

        const recommendations =
            this.generateRecommendations(
                riskLevel,
                riskFactors,
                decision
            );

        const result = {
            success: true,

            monitoringId,

            transactionId:
                transaction._id ||
                transaction.id ||
                transaction.transactionId ||
                null,

            userId:
                user._id ||
                user.id ||
                null,

            tenantId,

            riskScore,

            riskLevel,

            decision,

            approved:
                decision === DECISIONS.APPROVE,

            reviewRequired:
                decision === DECISIONS.REVIEW ||
                decision === DECISIONS.BLOCK,

            blocked:
                decision === DECISIONS.BLOCK,

            riskFactors,

            reasons,

            recommendations,

            timestamp:
                new Date().toISOString(),
        };

        /**
         * Persist monitoring result before generating an alert.
         *
         * This creates a durable monitoring trail even if alert creation
         * subsequently fails.
         */
        await this.persistMonitoringResult({
            monitoringId,
            tenantId,
            user,
            transaction,
            result,
            idempotencyKey,
        });

        /**
         * Generate alert for REVIEW/BLOCK decisions.
         */
        if (
            decision === DECISIONS.REVIEW ||
            decision === DECISIONS.BLOCK
        ) {
            try {
                await this.generateAlert(
                    user,
                    transaction,
                    riskScore,
                    decision,
                    {
                        monitoringId,
                        riskLevel,
                        riskFactors,
                        reasons,
                    }
                );
            } catch (error) {
                this.logError(
                    "Failed to generate transaction risk alert",
                    error,
                    {
                        monitoringId,
                        transactionId:
                            transaction._id ||
                            transaction.id,
                        tenantId,
                    }
                );

                /**
                 * A BLOCK decision must never silently become an approval
                 * because alert persistence failed.
                 */
                if (decision === DECISIONS.BLOCK) {
                    throw new TransactionMonitoringError(
                        "Transaction monitoring alert creation failed for blocked transaction",
                        "ALERT_PERSISTENCE_FAILURE",
                        {
                            monitoringId,
                            transactionId:
                                transaction._id ||
                                transaction.id,
                        }
                    );
                }
            }
        }

        /**
         * Optional audit integration.
         */
        await this.emitAuditEvent(
            "TRANSACTION_RISK_ASSESSED",
            {
                monitoringId,
                transactionId:
                    transaction._id ||
                    transaction.id ||
                    null,
                userId:
                    user._id ||
                    user.id ||
                    null,
                tenantId,
                riskScore,
                riskLevel,
                decision,
            }
        );

        return result;
    }

    /**
     * =========================================================================
     * RISK FACTOR ENGINE
     * =========================================================================
     */

    async buildRiskFactors(user, transaction, context = {}) {
        const amount =
            this.toSafeNumber(
                transaction.amount,
                0
            );

        const transactionCount =
            this.toSafeNumber(
                context.transactionCount ??
                    transaction.transactionCount ??
                    user.transactionCount,
                0
            );

        const userAgeMinutes =
            this.getUserAgeMinutes(user);

        const locationMismatch =
            this.resolveBooleanSignal(
                context.locationMismatch,
                transaction.locationMismatch
            );

        const newDevice =
            this.resolveBooleanSignal(
                context.newDevice,
                transaction.newDevice
            );

        const beneficiaryRisk =
            this.normalizeRiskSignal(
                context.beneficiaryRisk ??
                    transaction.beneficiaryRisk ??
                    0
            );

        const fraudRisk =
            this.normalizeRiskSignal(
                context.fraudRisk ??
                    transaction.fraudRisk ??
                    0
            );

        const amlRisk =
            this.normalizeRiskSignal(
                context.amlRisk ??
                    transaction.amlRisk ??
                    0
            );

        const sanctionsRisk =
            this.normalizeRiskSignal(
                context.sanctionsRisk ??
                    transaction.sanctionsRisk ??
                    0
            );

        const behavioralRisk =
            this.resolveBehavioralRisk(
                user,
                transaction,
                context
            );

        return {
            amountRisk:
                this.calculateAmountRisk(amount),

            accountAgeRisk:
                this.calculateAccountAgeRisk(
                    userAgeMinutes
                ),

            velocityRisk:
                this.calculateVelocityRisk(
                    transactionCount
                ),

            locationRisk:
                locationMismatch ? 100 : 0,

            deviceRisk:
                newDevice ? 100 : 0,

            behavioralRisk,

            beneficiaryRisk,

            fraudRisk,

            amlRisk,

            sanctionsRisk,

            /**
             * Raw operational signals are retained for explainability.
             */
            signals: {
                amount,
                userAgeMinutes,
                transactionCount,
                locationMismatch,
                newDevice,
            },
        };
    }

    /**
     * =========================================================================
     * AMOUNT RISK
     * =========================================================================
     */

    calculateAmountRisk(amount) {
        if (amount >= this.config.rules.EXTREME_VALUE_AMOUNT) {
            return 100;
        }

        if (amount >= this.config.rules.HIGH_VALUE_AMOUNT) {
            return 75;
        }

        if (amount >= this.config.rules.LARGE_AMOUNT) {
            return 50;
        }

        return 0;
    }

    /**
     * =========================================================================
     * ACCOUNT AGE RISK
     * =========================================================================
     */

    calculateAccountAgeRisk(userAgeMinutes) {
        if (
            !Number.isFinite(userAgeMinutes) ||
            userAgeMinutes < 0
        ) {
            return 0;
        }

        if (
            userAgeMinutes <
            this.config.rules.NEW_ACCOUNT_AGE_MINUTES
        ) {
            return 100;
        }

        return 0;
    }

    /**
     * =========================================================================
     * VELOCITY RISK
     * =========================================================================
     */

    calculateVelocityRisk(transactionCount) {
        if (
            transactionCount >=
            this.config.rules.EXTREME_VELOCITY_LIMIT
        ) {
            return 100;
        }

        if (
            transactionCount >=
            this.config.rules.HIGH_VELOCITY_LIMIT
        ) {
            return 75;
        }

        if (
            transactionCount >
            this.config.rules.VELOCITY_LIMIT
        ) {
            return 50;
        }

        return 0;
    }

    /**
     * =========================================================================
     * BEHAVIORAL RISK
     * =========================================================================
     */

    resolveBehavioralRisk(
        user,
        transaction,
        context
    ) {
        if (
            context.behavioralRisk !== undefined
        ) {
            return this.normalizeRiskSignal(
                context.behavioralRisk
            );
        }

        if (
            transaction.behavioralRisk !== undefined
        ) {
            return this.normalizeRiskSignal(
                transaction.behavioralRisk
            );
        }

        const averageAmount =
            this.toSafeNumber(
                user.averageTransactionAmount,
                0
            );

        const transactionAmount =
            this.toSafeNumber(
                transaction.amount,
                0
            );

        if (
            averageAmount <= 0 ||
            transactionAmount <= 0
        ) {
            return 0;
        }

        const ratio =
            transactionAmount /
            averageAmount;

        if (
            ratio >=
            this.config.rules
                .HIGH_RISK_BEHAVIORAL_MULTIPLIER
        ) {
            return 100;
        }

        if (
            ratio >=
            this.config.rules
                .BEHAVIORAL_DEVIATION_MULTIPLIER
        ) {
            return 70;
        }

        if (ratio >= 2) {
            return 35;
        }

        return 0;
    }

    /**
     * =========================================================================
     * BACKWARD-COMPATIBLE RISK SCORE API
     * =========================================================================
     */

    calculateRiskScore({
        amount = 0,
        userAgeMinutes = Infinity,
        transactionCount = 0,
        locationMismatch = false,
        newDevice = false,
        behavioralRisk = 0,
        beneficiaryRisk = 0,
        fraudRisk = 0,
        amlRisk = 0,
        sanctionsRisk = 0,
    } = {}) {
        const riskFactors = {
            amountRisk:
                this.calculateAmountRisk(
                    this.toSafeNumber(amount, 0)
                ),

            accountAgeRisk:
                this.calculateAccountAgeRisk(
                    this.toSafeNumber(
                        userAgeMinutes,
                        Infinity
                    )
                ),

            velocityRisk:
                this.calculateVelocityRisk(
                    this.toSafeNumber(
                        transactionCount,
                        0
                    )
                ),

            locationRisk:
                locationMismatch ? 100 : 0,

            deviceRisk:
                newDevice ? 100 : 0,

            behavioralRisk:
                this.normalizeRiskSignal(
                    behavioralRisk
                ),

            beneficiaryRisk:
                this.normalizeRiskSignal(
                    beneficiaryRisk
                ),

            fraudRisk:
                this.normalizeRiskSignal(
                    fraudRisk
                ),

            amlRisk:
                this.normalizeRiskSignal(
                    amlRisk
                ),

            sanctionsRisk:
                this.normalizeRiskSignal(
                    sanctionsRisk
                ),
        };

        return this.calculateFraudSafeRiskScore(
            riskFactors
        );
    }

    /**
     * =========================================================================
     * WEIGHTED RISK CALCULATION
     * =========================================================================
     */

    calculateFraudSafeRiskScore(risks) {
        const weightedSignals = [
            [
                risks.amountRisk,
                this.config.weights.LARGE_AMOUNT,
            ],

            [
                risks.accountAgeRisk,
                this.config.weights.NEW_ACCOUNT,
            ],

            [
                risks.velocityRisk,
                this.config.weights.VELOCITY,
            ],

            [
                risks.locationRisk,
                this.config.weights.LOCATION_MISMATCH,
            ],

            [
                risks.deviceRisk,
                this.config.weights.NEW_DEVICE,
            ],

            [
                risks.behavioralRisk,
                this.config.weights.BEHAVIORAL_DEVIATION,
            ],

            [
                risks.beneficiaryRisk,
                this.config.weights.BENEFICIARY_RISK,
            ],

            [
                risks.fraudRisk,
                this.config.weights.FRAUD_RISK,
            ],

            [
                risks.amlRisk,
                this.config.weights.AML_RISK,
            ],

            [
                risks.sanctionsRisk,
                this.config.weights.SANCTIONS_RISK,
            ],
        ];

        let weightedScore = 0;
        let totalWeight = 0;

        for (const [signal, weight] of weightedSignals) {
            const safeSignal =
                this.normalizeRiskSignal(signal);

            const safeWeight =
                this.toSafeNumber(weight, 0);

            weightedScore +=
                safeSignal * safeWeight;

            totalWeight += safeWeight;
        }

        if (totalWeight <= 0) {
            return 0;
        }

        const score =
            weightedScore / totalWeight;

        return Number(
            this.clamp(
                score,
                this.config.scoreRange.MIN,
                this.config.scoreRange.MAX
            ).toFixed(2)
        );
    }

    /**
     * =========================================================================
     * HARD-BLOCK SIGNALS
     * =========================================================================
     *
     * Some compliance signals should not be diluted by averaging.
     *
     * Example:
     * A confirmed sanctions match should not become APPROVE merely because
     * the customer's transaction history is otherwise normal.
     */

    hasHardBlockSignal(riskFactors) {
        return (
            riskFactors.sanctionsRisk >= 95 ||
            riskFactors.fraudRisk >= 100 ||
            riskFactors.amlRisk >= 100
        );
    }

    /**
     * =========================================================================
     * DECISION ENGINE
     * =========================================================================
     */

    getDecision(score, riskFactors = {}) {
        if (
            this.hasHardBlockSignal(
                riskFactors
            )
        ) {
            return DECISIONS.BLOCK;
        }

        if (
            score >=
            this.config.thresholds.BLOCK
        ) {
            return DECISIONS.BLOCK;
        }

        if (
            score >=
            this.config.thresholds.REVIEW
        ) {
            return DECISIONS.REVIEW;
        }

        return DECISIONS.APPROVE;
    }

    /**
     * =========================================================================
     * RISK CLASSIFICATION
     * =========================================================================
     */

    classifyRisk(score) {
        if (score >= 80) {
            return RISK_LEVELS.CRITICAL;
        }

        if (score >= 60) {
            return RISK_LEVELS.HIGH;
        }

        if (score >= 30) {
            return RISK_LEVELS.MEDIUM;
        }

        return RISK_LEVELS.LOW;
    }

    /**
     * =========================================================================
     * DECISION EXPLAINABILITY
     * =========================================================================
     */

    generateDecisionReasons(
        risks,
        score,
        decision
    ) {
        const reasons = [];

        if (risks.amountRisk >= 75) {
            reasons.push(
                "Transaction amount is significantly above normal monitoring thresholds."
            );
        } else if (risks.amountRisk >= 50) {
            reasons.push(
                "Transaction amount exceeds the large-value monitoring threshold."
            );
        }

        if (risks.accountAgeRisk >= 100) {
            reasons.push(
                "Transaction originated from a newly created account."
            );
        }

        if (risks.velocityRisk >= 75) {
            reasons.push(
                "Transaction velocity significantly exceeds normal limits."
            );
        } else if (risks.velocityRisk >= 50) {
            reasons.push(
                "Transaction velocity exceeds normal monitoring limits."
            );
        }

        if (risks.locationRisk >= 100) {
            reasons.push(
                "Transaction location differs from the expected customer location."
            );
        }

        if (risks.deviceRisk >= 100) {
            reasons.push(
                "Transaction originated from a new or unrecognized device."
            );
        }

        if (risks.behavioralRisk >= 70) {
            reasons.push(
                "Transaction amount materially deviates from the customer's historical behavior."
            );
        }

        if (risks.beneficiaryRisk >= 70) {
            reasons.push(
                "Beneficiary presents elevated transaction risk."
            );
        }

        if (risks.fraudRisk >= 70) {
            reasons.push(
                "Fraud detection signals indicate elevated risk."
            );
        }

        if (risks.amlRisk >= 70) {
            reasons.push(
                "AML monitoring signals indicate elevated risk."
            );
        }

        if (risks.sanctionsRisk >= 70) {
            reasons.push(
                "Sanctions screening returned an elevated match risk."
            );
        }

        if (
            reasons.length === 0 &&
            decision === DECISIONS.APPROVE
        ) {
            reasons.push(
                "No material transaction monitoring anomalies were detected."
            );
        }

        if (decision === DECISIONS.BLOCK) {
            reasons.push(
                `Transaction risk score of ${score} meets the blocking threshold or contains a hard-block compliance signal.`
            );
        }

        if (decision === DECISIONS.REVIEW) {
            reasons.push(
                `Transaction risk score of ${score} requires additional review.`
            );
        }

        return reasons;
    }

    /**
     * =========================================================================
     * RECOMMENDATIONS
     * =========================================================================
     */

    generateRecommendations(
        level,
        risks,
        decision
    ) {
        const recommendations = [];

        if (risks.deviceRisk >= 100) {
            recommendations.push(
                "Trigger device re-verification."
            );
        }

        if (risks.locationRisk >= 100) {
            recommendations.push(
                "Verify transaction location and customer access context."
            );
        }

        if (risks.velocityRisk >= 50) {
            recommendations.push(
                "Perform enhanced transaction velocity review."
            );
        }

        if (risks.behavioralRisk >= 70) {
            recommendations.push(
                "Compare transaction against established customer behavioral profile."
            );
        }

        if (risks.beneficiaryRisk >= 70) {
            recommendations.push(
                "Verify beneficiary identity and ownership."
            );
        }

        if (risks.fraudRisk >= 50) {
            recommendations.push(
                "Escalate transaction for fraud investigation."
            );
        }

        if (risks.amlRisk >= 50) {
            recommendations.push(
                "Escalate transaction to AML monitoring workflow."
            );
        }

        if (risks.sanctionsRisk >= 50) {
            recommendations.push(
                "Perform enhanced sanctions screening and compliance review."
            );
        }

        switch (level) {
            case RISK_LEVELS.CRITICAL:
                recommendations.push(
                    "Do not release transaction automatically."
                );

                recommendations.push(
                    "Escalate to Risk & Compliance investigation workflow."
                );
                break;

            case RISK_LEVELS.HIGH:
                recommendations.push(
                    "Require manual risk review before transaction release."
                );
                break;

            case RISK_LEVELS.MEDIUM:
                recommendations.push(
                    "Increase monitoring sensitivity for subsequent activity."
                );
                break;

            default:
                break;
        }

        if (
            decision === DECISIONS.BLOCK
        ) {
            recommendations.push(
                "Transaction must remain blocked until the applicable control workflow completes."
            );
        }

        return [
            ...new Set(recommendations),
        ];
    }

    /**
     * =========================================================================
     * ALERT GENERATION
     * =========================================================================
     */

    async generateAlert(
        user,
        transaction,
        riskScore,
        decision,
        metadata = {}
    ) {
        const tenantId =
            this.resolveTenantId(
                user,
                transaction
            );

        const transactionId =
            transaction._id ||
            transaction.id ||
            transaction.transactionId ||
            null;

        /**
         * Prevent excessive duplicate alerts for the same transaction.
         */
        const duplicate =
            await this.findRecentAlert(
                tenantId,
                transactionId
            );

        if (duplicate) {
            return duplicate;
        }

        return RiskAlert.create({
            alertId:
                crypto.randomUUID(),

            monitoringId:
                metadata.monitoringId ||
                null,

            userId:
                user._id ||
                user.id ||
                null,

            tenantId,

            transactionId,

            riskScore,

            riskLevel:
                metadata.riskLevel ||
                this.classifyRisk(
                    riskScore
                ),

            decision,

            riskFactors:
                metadata.riskFactors ||
                {},

            reasons:
                metadata.reasons ||
                [],

            status:
                ALERT_STATUS.OPEN,

            createdAt:
                new Date(),

            updatedAt:
                new Date(),
        });
    }

    /**
     * =========================================================================
     * TRANSACTION LOG PERSISTENCE
     * =========================================================================
     */

    async persistMonitoringResult({
        monitoringId,
        tenantId,
        user,
        transaction,
        result,
        idempotencyKey,
    }) {
        const transactionId =
            transaction._id ||
            transaction.id ||
            transaction.transactionId ||
            null;

        const payload = {
            monitoringId,

            userId:
                user._id ||
                user.id ||
                null,

            tenantId,

            transactionId,

            riskScore:
                result.riskScore,

            decision:
                result.decision,

            riskLevel:
                result.riskLevel,

            createdAt:
                new Date(),

            updatedAt:
                new Date(),
        };

        /**
         * Add idempotencyKey only when supplied.
         *
         * This avoids requiring the existing TransactionLog schema to contain
         * the field before this service can be deployed.
         */
        if (idempotencyKey) {
            payload.idempotencyKey =
                idempotencyKey;
        }

        return TransactionLog.create(
            payload
        );
    }

    /**
     * =========================================================================
     * IDEMPOTENCY LOOKUP
     * =========================================================================
     */

    async findExistingMonitoringResult(
        tenantId,
        idempotencyKey
    ) {
        if (
            !tenantId ||
            !idempotencyKey
        ) {
            return null;
        }

        const since =
            new Date(
                Date.now() -
                    this.config
                        .idempotencyWindowMinutes *
                        60 *
                        1000
            );

        const existing =
            await TransactionLog.findOne({
                tenantId,
                idempotencyKey,
                createdAt: {
                    $gte: since,
                },
            })
                .sort({
                    createdAt: -1,
                })
                .lean();

        if (!existing) {
            return null;
        }

        return {
            success: true,

            monitoringId:
                existing.monitoringId,

            transactionId:
                existing.transactionId,

            userId:
                existing.userId,

            tenantId:
                existing.tenantId,

            riskScore:
                existing.riskScore,

            riskLevel:
                existing.riskLevel ||
                this.classifyRisk(
                    existing.riskScore
                ),

            decision:
                existing.decision,

            approved:
                existing.decision ===
                DECISIONS.APPROVE,

            reviewRequired:
                existing.decision !==
                DECISIONS.APPROVE,

            blocked:
                existing.decision ===
                DECISIONS.BLOCK,

            timestamp:
                existing.createdAt
                    ? new Date(
                          existing.createdAt
                      ).toISOString()
                    : new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * ALERT DEDUPLICATION
     * =========================================================================
     */

    async findRecentAlert(
        tenantId,
        transactionId
    ) {
        if (
            !tenantId ||
            !transactionId
        ) {
            return null;
        }

        const since =
            new Date(
                Date.now() -
                    this.config
                        .alertDeduplicationMinutes *
                        60 *
                        1000
            );

        return RiskAlert.findOne({
            tenantId,
            transactionId,
            createdAt: {
                $gte: since,
            },
            status: {
                $in: [
                    "OPEN",
                    "IN_CASE",
                    "REVIEW",
                ],
            },
        })
            .sort({
                createdAt: -1,
            });
    }

    /**
     * =========================================================================
     * USER AGE
     * =========================================================================
     */

    getUserAgeMinutes(user) {
        if (!user || !user.createdAt) {
            return Infinity;
        }

        const createdAt =
            new Date(
                user.createdAt
            ).getTime();

        if (
            !Number.isFinite(
                createdAt
            )
        ) {
            return Infinity;
        }

        const diffMs =
            Date.now() -
            createdAt;

        if (diffMs < 0) {
            return 0;
        }

        return Math.floor(
            diffMs / 60000
        );
    }

    /**
     * =========================================================================
     * VALIDATION
     * =========================================================================
     */

    validateUser(user) {
        if (!user) {
            throw new TransactionMonitoringError(
                "User data is required",
                "USER_REQUIRED"
            );
        }

        if (
            !user._id &&
            !user.id
        ) {
            throw new TransactionMonitoringError(
                "User identifier is required",
                "USER_ID_REQUIRED"
            );
        }
    }

    validateTransaction(transaction) {
        if (!transaction) {
            throw new TransactionMonitoringError(
                "Transaction data is required",
                "TRANSACTION_REQUIRED"
            );
        }

        const amount =
            Number(transaction.amount);

        if (
            transaction.amount !==
                undefined &&
            (!Number.isFinite(amount) ||
                amount < 0)
        ) {
            throw new TransactionMonitoringError(
                "Transaction amount must be a valid non-negative number",
                "INVALID_TRANSACTION_AMOUNT"
            );
        }
    }

    /**
     * =========================================================================
     * TENANT ISOLATION
     * =========================================================================
     */

    resolveTenantId(
        user,
        transaction
    ) {
        return (
            transaction.tenantId ||
            user.tenantId ||
            null
        );
    }

    assertTenantIsolation(
        user,
        transaction,
        tenantId
    ) {
        if (!tenantId) {
            throw new TransactionMonitoringError(
                "Tenant context is required",
                "TENANT_CONTEXT_REQUIRED"
            );
        }

        if (
            user.tenantId &&
            String(user.tenantId) !==
                String(tenantId)
        ) {
            throw new TransactionMonitoringError(
                "User tenant context does not match transaction tenant",
                "TENANT_ISOLATION_VIOLATION"
            );
        }

        if (
            transaction.tenantId &&
            String(
                transaction.tenantId
            ) !==
                String(tenantId)
        ) {
            throw new TransactionMonitoringError(
                "Transaction tenant context is invalid",
                "TENANT_ISOLATION_VIOLATION"
            );
        }
    }

    /**
     * =========================================================================
     * NORMALIZATION HELPERS
     * =========================================================================
     */

    normalizeRiskSignal(value) {
        const numeric =
            Number(value);

        if (
            !Number.isFinite(
                numeric
            )
        ) {
            return 0;
        }

        return this.clamp(
            numeric,
            0,
            100
        );
    }

    toSafeNumber(
        value,
        fallback = 0
    ) {
        const numeric =
            Number(value);

        return Number.isFinite(
            numeric
        )
            ? numeric
            : fallback;
    }

    resolveBooleanSignal(
        primary,
        secondary
    ) {
        if (
            primary !== undefined
        ) {
            return Boolean(
                primary
            );
        }

        return Boolean(
            secondary
        );
    }

    clamp(
        value,
        min,
        max
    ) {
        return Math.min(
            Math.max(
                value,
                min
            ),
            max
        );
    }

    /**
     * =========================================================================
     * CONFIGURATION MERGING
     * =========================================================================
     */

    mergeConfig(
        base,
        overrides
    ) {
        return {
            ...base,

            ...overrides,

            thresholds: {
                ...base.thresholds,
                ...(overrides.thresholds ||
                    {}),
            },

            rules: {
                ...base.rules,
                ...(overrides.rules ||
                    {}),
            },

            weights: {
                ...base.weights,
                ...(overrides.weights ||
                    {}),
            },

            scoreRange: {
                ...base.scoreRange,
                ...(overrides.scoreRange ||
                    {}),
            },
        };
    }

    /**
     * =========================================================================
     * AUDIT EVENT
     * =========================================================================
     */

    async emitAuditEvent(
        eventName,
        payload
    ) {
        if (
            !this.dependencies
                .auditService
        ) {
            return;
        }

        try {
            if (
                typeof this
                    .dependencies
                    .auditService
                    .log ===
                "function"
            ) {
                await this.dependencies
                    .auditService
                    .log({
                        event:
                            eventName,
                        ...payload,
                    });
            } else if (
                typeof this
                    .dependencies
                    .auditService
                    .record ===
                "function"
            ) {
                await this.dependencies
                    .auditService
                    .record(
                        eventName,
                        payload
                    );
            }
        } catch (error) {
            this.logError(
                "Risk monitoring audit event failed",
                error,
                {
                    eventName,
                    payload,
                }
            );
        }
    }

    /**
     * =========================================================================
     * LOGGING
     * =========================================================================
     */

    logError(
        message,
        error,
        metadata = {}
    ) {
        const logger =
            this.dependencies
                .logger;

        if (
            logger &&
            typeof logger.error ===
                "function"
        ) {
            logger.error(
                message,
                {
                    error:
                        error?.message ||
                        String(error),

                    stack:
                        error?.stack,

                    ...metadata,
                }
            );
        }
    }
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * Default export remains a singleton for compatibility with the existing
 * codebase:
 *
 * const TransactionMonitoringService =
 *     require("./TransactionMonitoringService");
 *
 * Advanced consumers may instantiate the class directly.
 * ============================================================================
 */

const service =
    new TransactionMonitoringService();

service.TransactionMonitoringError =
    TransactionMonitoringError;

service.DECISIONS =
    DECISIONS;

service.RISK_LEVELS =
    RISK_LEVELS;

module.exports =
    service;