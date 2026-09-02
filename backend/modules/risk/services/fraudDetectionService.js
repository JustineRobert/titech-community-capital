"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Fraud Detection Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/FraudDetectionService.js
 *
 * Purpose:
 * Central fraud-risk analysis and transaction fraud decision engine.
 *
 * Responsibilities:
 * --------------------------------------------------------------------------
 * - Transaction fraud screening
 * - Velocity analysis
 * - Geographic anomaly detection
 * - Device-risk integration
 * - Account takeover detection
 * - Beneficiary-risk analysis
 * - Behavioural analysis
 * - Transaction-pattern analysis
 * - AML risk integration
 * - Weighted fraud-risk scoring
 * - Hard-rule fraud overrides
 * - Risk classification
 * - Fraud decision generation
 * - Fraud recommendations
 * - Fraud alert preparation
 * - Investigation case preparation
 * - Audit metadata
 * - Configuration versioning
 * - Dependency injection
 * - Tenant-aware processing
 * - Idempotency support
 *
 * IMPORTANT:
 * --------------------------------------------------------------------------
 * This service does NOT directly modify:
 *
 * - Ledger balances
 * - Account balances
 * - Journal entries
 * - Settlement records
 * - Loan balances
 *
 * BLOCK / HOLD / REVIEW decisions MUST be enforced by the parent
 * transaction orchestration/payment workflow before financial posting.
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * DEFAULT CONFIGURATION
 * ============================================================================
 */

const DEFAULT_FRAUD_CONFIG = Object.freeze({
    version: "3.0.0",

    thresholds: Object.freeze({
        LOW: 25,
        MEDIUM: 50,
        HIGH: 75,
        CRITICAL: 90
    }),

    weights: Object.freeze({
        velocity: 20,
        geoRisk: 15,
        deviceRisk: 15,
        accountTakeover: 15,
        beneficiaryRisk: 10,
        behavioralRisk: 10,
        transactionPattern: 10,
        amlRisk: 5
    }),

    transactionThresholds: Object.freeze({
        highValue: 10000000,
        criticalValue: 50000000
    }),

    velocity: Object.freeze({
        hourlyReviewCount: 5,
        dailyReviewCount: 20,
        hourlyRiskScore: 40,
        dailyRiskScore: 60
    }),

    behavioural: Object.freeze({
        extremeMultiplier: 10,
        highMultiplier: 5,
        elevatedMultiplier: 2,
        extremeScore: 90,
        highScore: 60,
        elevatedScore: 30,
        defaultScore: 10
    }),

    accountTakeover: Object.freeze({
        passwordResetScore: 30,
        newDeviceScore: 25,
        newIpScore: 20,
        failedLoginThreshold: 3,
        failedLoginScore: 30
    }),

    beneficiary: Object.freeze({
        newBeneficiaryScore: 40,
        unverifiedBeneficiaryScore: 30,
        nameMismatchScore: 20
    }),

    transactionPattern: Object.freeze({
        roundAmountThreshold: 1000000,
        roundAmountScore: 30,
        highValueCashOutScore: 40,
        midnightTransactionScore: 20
    }),

    aml: Object.freeze({
        structuringScore: 50,
        sanctionsScore: 100,
        pepScore: 40
    }),

    geography: Object.freeze({
        missingCountryScore: 20,
        mismatchScore: 70,
        normalScore: 10
    }),

    device: Object.freeze({
        missingDeviceScore: 20,
        mismatchScore: 75,
        normalScore: 5
    }),

    screening: Object.freeze({
        defaultRiskScore: 0,
        providerTimeoutMs: 5000
    })
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function clamp(value, min = 0, max = 100) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return min;
    }

    return Math.min(
        max,
        Math.max(min, numeric)
    );
}

function round(value, decimals = 2) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return 0;
    }

    const factor = 10 ** decimals;

    return Math.round(
        numeric * factor
    ) / factor;
}

function normalizeBoolean(value) {
    return value === true;
}

function normalizeString(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    return String(value)
        .trim()
        .toUpperCase();
}

function generateId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * ============================================================================
 * FRAUD DETECTION SERVICE
 * ============================================================================
 */

class FraudDetectionService {

    constructor(options = {}) {

        this.config =
            this.buildConfig(
                options.config || {}
            );

        /**
         * Optional enterprise dependencies.
         *
         * Dependencies are injected rather than hard imported so the service
         * remains modular and compatible with the existing architecture.
         */
        this.dependencies = {

            amlService:
                options.amlService || null,

            behavioralService:
                options.behavioralService || null,

            deviceFingerprintService:
                options.deviceFingerprintService || null,

            riskAlertService:
                options.riskAlertService || null,

            caseManagementService:
                options.caseManagementService || null,

            auditService:
                options.auditService || null,

            logger:
                options.logger || console
        };

        this.serviceName =
            "FraudDetectionService";

        this.serviceVersion =
            this.config.version;
    }

    /**
     * =========================================================================
     * CONFIGURATION
     * =========================================================================
     */

    buildConfig(customConfig = {}) {

        const merged = {

            ...DEFAULT_FRAUD_CONFIG,

            ...customConfig,

            thresholds: {
                ...DEFAULT_FRAUD_CONFIG.thresholds,
                ...(customConfig.thresholds || {})
            },

            weights: {
                ...DEFAULT_FRAUD_CONFIG.weights,
                ...(customConfig.weights || {})
            },

            transactionThresholds: {
                ...DEFAULT_FRAUD_CONFIG.transactionThresholds,
                ...(customConfig.transactionThresholds || {})
            },

            velocity: {
                ...DEFAULT_FRAUD_CONFIG.velocity,
                ...(customConfig.velocity || {})
            },

            behavioural: {
                ...DEFAULT_FRAUD_CONFIG.behavioural,
                ...(customConfig.behavioural || {})
            },

            accountTakeover: {
                ...DEFAULT_FRAUD_CONFIG.accountTakeover,
                ...(customConfig.accountTakeover || {})
            },

            beneficiary: {
                ...DEFAULT_FRAUD_CONFIG.beneficiary,
                ...(customConfig.beneficiary || {})
            },

            transactionPattern: {
                ...DEFAULT_FRAUD_CONFIG.transactionPattern,
                ...(customConfig.transactionPattern || {})
            },

            aml: {
                ...DEFAULT_FRAUD_CONFIG.aml,
                ...(customConfig.aml || {})
            },

            geography: {
                ...DEFAULT_FRAUD_CONFIG.geography,
                ...(customConfig.geography || {})
            },

            device: {
                ...DEFAULT_FRAUD_CONFIG.device,
                ...(customConfig.device || {})
            },

            screening: {
                ...DEFAULT_FRAUD_CONFIG.screening,
                ...(customConfig.screening || {})
            }
        };

        this.validateConfiguration(
            merged
        );

        return Object.freeze(
            merged
        );
    }

    validateConfiguration(config) {

        const weights =
            Object.values(
                config.weights
            );

        const totalWeight =
            weights.reduce(
                (sum, value) =>
                    sum +
                    Number(value || 0),
                0
            );

        if (totalWeight !== 100) {

            throw new Error(
                `Fraud risk weights must total 100. Current total: ${totalWeight}`
            );
        }

        const thresholds =
            config.thresholds;

        if (
            thresholds.LOW < 0 ||
            thresholds.MEDIUM <= thresholds.LOW ||
            thresholds.HIGH <= thresholds.MEDIUM ||
            thresholds.CRITICAL <= thresholds.HIGH ||
            thresholds.CRITICAL > 100
        ) {

            throw new Error(
                "Invalid fraud risk thresholds."
            );
        }
    }

    /**
     * =========================================================================
     * MAIN ENTRYPOINT
     * =========================================================================
     */

    async analyzeTransaction(
        transaction,
        member,
        options = {}
    ) {

        const investigationId =
            generateId("FRAUD");

        const startedAt =
            Date.now();

        try {

            this.validateTransaction(
                transaction
            );

            const normalizedTransaction =
                this.normalizeTransaction(
                    transaction
                );

            const normalizedMember =
                this.normalizeMember(
                    member
                );

            const context = {

                investigationId,

                transaction:
                    normalizedTransaction,

                member:
                    normalizedMember,

                options
            };

            /**
             * Idempotency support.
             *
             * The parent orchestration layer can supply an existing
             * investigation/reference key.
             */
            const idempotencyKey =
                options.idempotencyKey ||
                normalizedTransaction.id ||
                investigationId;

            const riskFactors =
                await this.collectRiskFactors(
                    context
                );

            const fraudScore =
                this.calculateFraudScore(
                    riskFactors
                );

            const fraudLevel =
                this.classifyRisk(
                    fraudScore
                );

            const decision =
                this.generateDecision(
                    fraudScore,
                    fraudLevel,
                    riskFactors
                );

            const recommendations =
                this.generateRecommendations(
                    fraudLevel,
                    riskFactors,
                    decision
                );

            const result = {

                success: true,

                investigationId,

                idempotencyKey,

                service:
                    this.serviceName,

                serviceVersion:
                    this.serviceVersion,

                timestamp:
                    new Date().toISOString(),

                durationMs:
                    Date.now() - startedAt,

                transactionId:
                    normalizedTransaction.id,

                memberId:
                    normalizedMember?.id || null,

                tenantId:
                    normalizedTransaction.tenantId ||
                    normalizedMember?.tenantId ||
                    null,

                fraudScore,

                fraudLevel,

                decision,

                indicators:
                    riskFactors,

                recommendations,

                metadata: {

                    amount:
                        normalizedTransaction.amount,

                    currency:
                        normalizedTransaction.currency,

                    country:
                        normalizedTransaction.country,

                    channel:
                        normalizedTransaction.channel,

                    transactionType:
                        normalizedTransaction.transactionType,

                    screeningStatus:
                        "COMPLETED"
                }
            };

            await this.auditAnalysis(
                result
            );

            return result;

        } catch (error) {

            this.logError(
                "Fraud transaction analysis failed",
                error,
                {
                    investigationId,
                    transactionId:
                        transaction?.id ||
                        transaction?._id?.toString()
                }
            );

            /**
             * Compliance/fraud infrastructure failures should not silently
             * become an ALLOW decision.
             *
             * Parent transaction orchestration should fail closed or place
             * the transaction into a pending compliance state.
             */
            throw this.createFraudError(
                error,
                investigationId
            );
        }
    }

    /**
     * =========================================================================
     * INPUT VALIDATION
     * =========================================================================
     */

    validateTransaction(transaction) {

        if (!transaction) {

            throw new Error(
                "Transaction data is required for fraud analysis."
            );
        }

        if (
            transaction.amount !== undefined &&
            (
                !Number.isFinite(
                    Number(transaction.amount)
                ) ||
                Number(transaction.amount) < 0
            )
        ) {

            throw new Error(
                "Transaction amount must be a valid non-negative number."
            );
        }
    }

    /**
     * =========================================================================
     * NORMALIZATION
     * =========================================================================
     */

    normalizeTransaction(
        transaction
    ) {

        return {

            ...transaction,

            id:
                transaction.id ||
                transaction._id?.toString() ||
                null,

            tenantId:
                transaction.tenantId ||
                null,

            amount:
                Number(
                    transaction.amount || 0
                ),

            currency:
                normalizeString(
                    transaction.currency
                ),

            country:
                normalizeString(
                    transaction.country
                ),

            transactionType:
                normalizeString(
                    transaction.transactionType
                ),

            channel:
                normalizeString(
                    transaction.channel
                )
        };
    }

    normalizeMember(member) {

        if (!member) {
            return null;
        }

        return {

            ...member,

            id:
                member.id ||
                member._id?.toString() ||
                null,

            tenantId:
                member.tenantId ||
                null,

            country:
                normalizeString(
                    member.country
                ),

            lastKnownDevice:
                member.lastKnownDevice ||
                null
        };
    }

    /**
     * =========================================================================
     * RISK FACTOR COLLECTION
     * =========================================================================
     */

    async collectRiskFactors(
        context
    ) {

        const {
            transaction,
            member
        } = context;

        const [
            velocityRisk,
            geoRisk,
            deviceRisk,
            accountTakeoverRisk,
            beneficiaryRisk,
            behavioralRisk,
            transactionPatternRisk,
            amlRisk
        ] = await Promise.all([

            this.checkVelocityRisk(
                transaction,
                member
            ),

            this.checkGeoRisk(
                transaction,
                member
            ),

            this.checkDeviceRisk(
                transaction,
                member
            ),

            this.checkAccountTakeoverRisk(
                transaction,
                member
            ),

            this.checkBeneficiaryRisk(
                transaction
            ),

            this.checkBehaviouralRisk(
                transaction,
                member,
                context
            ),

            this.checkTransactionPatternRisk(
                transaction,
                member
            ),

            this.checkAMLRisk(
                transaction,
                member,
                context
            )
        ]);

        return {

            velocityRisk,

            geoRisk,

            deviceRisk,

            accountTakeoverRisk,

            beneficiaryRisk,

            behavioralRisk,

            transactionPatternRisk,

            amlRisk
        };
    }

    /**
     * =========================================================================
     * VELOCITY CHECK
     * =========================================================================
     */

    async checkVelocityRisk(
        transaction,
        member
    ) {

        const txLastHour =
            Number(
                transaction.transactionsLastHour || 0
            );

        const txLastDay =
            Number(
                transaction.transactionsLastDay || 0
            );

        let risk = 0;

        if (
            txLastHour >
            this.config.velocity.hourlyReviewCount
        ) {

            risk +=
                this.config.velocity.hourlyRiskScore;
        }

        if (
            txLastDay >
            this.config.velocity.dailyReviewCount
        ) {

            risk +=
                this.config.velocity.dailyRiskScore;
        }

        return clamp(risk);
    }

    /**
     * =========================================================================
     * GEOGRAPHIC ANOMALY
     * =========================================================================
     */

    checkGeoRisk(
        transaction,
        member
    ) {

        if (
            !member ||
            !member.country
        ) {

            return this.config.geography
                .missingCountryScore;
        }

        const transactionCountry =
            normalizeString(
                transaction.country
            );

        const memberCountry =
            normalizeString(
                member.country
            );

        if (
            transactionCountry &&
            transactionCountry !== memberCountry
        ) {

            return this.config.geography
                .mismatchScore;
        }

        return this.config.geography
            .normalScore;
    }

    /**
     * =========================================================================
     * DEVICE RISK
     * =========================================================================
     */

    async checkDeviceRisk(
        transaction,
        member
    ) {

        if (
            !member ||
            !member.lastKnownDevice
        ) {

            return this.config.device
                .missingDeviceScore;
        }

        if (
            transaction.deviceId &&
            transaction.deviceId !==
            member.lastKnownDevice
        ) {

            return this.config.device
                .mismatchScore;
        }

        /**
         * Optional integration with the enterprise device fingerprint engine.
         */
        const deviceService =
            this.dependencies
                .deviceFingerprintService;

        if (
            deviceService &&
            typeof deviceService.monitorDevice ===
                "function"
        ) {

            const result =
                await deviceService.monitorDevice(
                    member,
                    transaction.deviceMetadata ||
                    transaction
                );

            if (
                result &&
                Number.isFinite(
                    Number(result.riskScore)
                )
            ) {

                return clamp(
                    result.riskScore
                );
            }
        }

        return this.config.device
            .normalScore;
    }

    /**
     * =========================================================================
     * ACCOUNT TAKEOVER DETECTION
     * =========================================================================
     */

    checkAccountTakeoverRisk(
        transaction,
        member
    ) {

        let risk = 0;

        if (
            normalizeBoolean(
                transaction.passwordResetRecently
            )
        ) {

            risk +=
                this.config.accountTakeover
                    .passwordResetScore;
        }

        if (
            normalizeBoolean(
                transaction.newDeviceLogin
            )
        ) {

            risk +=
                this.config.accountTakeover
                    .newDeviceScore;
        }

        if (
            normalizeBoolean(
                transaction.newIPAddress
            )
        ) {

            risk +=
                this.config.accountTakeover
                    .newIpScore;
        }

        if (
            Number(transaction.failedLogins || 0) >
            this.config.accountTakeover
                .failedLoginThreshold
        ) {

            risk +=
                this.config.accountTakeover
                    .failedLoginScore;
        }

        return clamp(risk);
    }

    /**
     * =========================================================================
     * BENEFICIARY RISK
     * =========================================================================
     */

    checkBeneficiaryRisk(
        transaction
    ) {

        let risk = 0;

        if (
            normalizeBoolean(
                transaction.newBeneficiary
            )
        ) {

            risk +=
                this.config.beneficiary
                    .newBeneficiaryScore;
        }

        if (
            normalizeBoolean(
                transaction.unverifiedBeneficiary
            )
        ) {

            risk +=
                this.config.beneficiary
                    .unverifiedBeneficiaryScore;
        }

        if (
            normalizeBoolean(
                transaction.beneficiaryNameMismatch
            )
        ) {

            risk +=
                this.config.beneficiary
                    .nameMismatchScore;
        }

        return clamp(risk);
    }

    /**
     * =========================================================================
     * BEHAVIOURAL ANALYSIS
     * =========================================================================
     */

    async checkBehaviouralRisk(
        transaction,
        member,
        context
    ) {

        const averageTransaction =
            Number(
                member?.averageTransactionAmount || 0
            );

        const amount =
            Number(
                transaction.amount || 0
            );

        let risk;

        if (
            averageTransaction <= 0
        ) {

            risk =
                this.config.behavioural
                    .defaultScore;

        } else {

            const ratio =
                amount /
                averageTransaction;

            if (
                ratio >
                this.config.behavioural
                    .extremeMultiplier
            ) {

                risk =
                    this.config.behavioural
                        .extremeScore;

            } else if (
                ratio >
                this.config.behavioural
                    .highMultiplier
            ) {

                risk =
                    this.config.behavioural
                        .highScore;

            } else if (
                ratio >
                this.config.behavioural
                    .elevatedMultiplier
            ) {

                risk =
                    this.config.behavioural
                        .elevatedScore;

            } else {

                risk =
                    this.config.behavioural
                        .defaultScore;
            }
        }

        /**
         * Optional integration with the Behavioral Analysis Service.
         */
        const behavioralService =
            this.dependencies
                .behavioralService;

        if (
            behavioralService &&
            typeof behavioralService.analyzeBehavior ===
                "function"
        ) {

            const result =
                await behavioralService.analyzeBehavior(
                    member,
                    transaction
                );

            if (
                result &&
                Number.isFinite(
                    Number(result.riskScore)
                )
            ) {

                risk =
                    Math.max(
                        risk,
                        Number(result.riskScore)
                    );
            }
        }

        return clamp(risk);
    }

    /**
     * =========================================================================
     * TRANSACTION PATTERN ANALYSIS
     * =========================================================================
     */

    checkTransactionPatternRisk(
        transaction,
        member
    ) {

        let risk = 0;

        if (
            normalizeBoolean(
                transaction.roundAmount
            ) &&
            Number(transaction.amount || 0) >
                this.config.transactionPattern
                    .roundAmountThreshold
        ) {

            risk +=
                this.config.transactionPattern
                    .roundAmountScore;
        }

        if (
            normalizeBoolean(
                transaction.highValueCashOut
            )
        ) {

            risk +=
                this.config.transactionPattern
                    .highValueCashOutScore;
        }

        if (
            normalizeBoolean(
                transaction.midnightTransaction
            )
        ) {

            risk +=
                this.config.transactionPattern
                    .midnightTransactionScore;
        }

        return clamp(risk);
    }

    /**
     * =========================================================================
     * AML INTEGRATION
     * =========================================================================
     */

    async checkAMLRisk(
        transaction,
        member,
        context
    ) {

        let risk = 0;

        if (
            normalizeBoolean(
                transaction.structuringDetected
            )
        ) {

            risk +=
                this.config.aml
                    .structuringScore;
        }

        if (
            normalizeBoolean(
                transaction.sanctionMatch
            )
        ) {

            risk +=
                this.config.aml
                    .sanctionsScore;
        }

        if (
            normalizeBoolean(
                transaction.pepMatch
            )
        ) {

            risk +=
                this.config.aml
                    .pepScore;
        }

        /**
         * Optional AML service integration.
         */
        const amlService =
            this.dependencies
                .amlService;

        if (
            amlService &&
            typeof amlService.screenTransaction ===
                "function"
        ) {

            const result =
                await amlService.screenTransaction(
                    transaction,
                    member,
                    {
                        source:
                            "FraudDetectionService",

                        investigationId:
                            context.investigationId
                    }
                );

            if (
                result &&
                Number.isFinite(
                    Number(result.amlScore)
                )
            ) {

                risk =
                    Math.max(
                        risk,
                        Number(result.amlScore)
                    );
            }

            /**
             * A sanctions match is an absolute fraud/compliance concern.
             */
            if (
                result?.decision?.reasonCode ===
                "SANCTIONS_MATCH"
            ) {

                risk = 100;
            }
        }

        return clamp(risk);
    }

    /**
     * =========================================================================
     * FRAUD SCORE CALCULATION
     * =========================================================================
     */

    calculateFraudScore(
        risks
    ) {

        const score =
            (
                Number(risks.velocityRisk || 0) *
                    this.config.weights.velocity +

                Number(risks.geoRisk || 0) *
                    this.config.weights.geoRisk +

                Number(risks.deviceRisk || 0) *
                    this.config.weights.deviceRisk +

                Number(risks.accountTakeoverRisk || 0) *
                    this.config.weights.accountTakeover +

                Number(risks.beneficiaryRisk || 0) *
                    this.config.weights.beneficiaryRisk +

                Number(risks.behavioralRisk || 0) *
                    this.config.weights.behavioralRisk +

                Number(risks.transactionPatternRisk || 0) *
                    this.config.weights.transactionPattern +

                Number(risks.amlRisk || 0) *
                    this.config.weights.amlRisk
            ) / 100;

        return round(
            clamp(score)
        );
    }

    /**
     * =========================================================================
     * RISK CLASSIFICATION
     * =========================================================================
     */

    classifyRisk(
        score
    ) {

        const numericScore =
            clamp(score);

        if (
            numericScore >=
            this.config.thresholds.CRITICAL
        ) {

            return "CRITICAL";
        }

        if (
            numericScore >=
            this.config.thresholds.HIGH
        ) {

            return "HIGH";
        }

        if (
            numericScore >=
            this.config.thresholds.MEDIUM
        ) {

            return "MEDIUM";
        }

        return "LOW";
    }

    /**
     * =========================================================================
     * DECISION ENGINE
     * =========================================================================
     *
     * Hard rules are evaluated before weighted classification.
     *
     * A sanctions match or severe account-takeover signal must not be diluted
     * by a lower weighted average.
     * =========================================================================
     */

    generateDecision(
        score,
        level,
        risks
    ) {

        /**
         * HARD RULE:
         * Sanctions match.
         */
        if (
            Number(risks.amlRisk) >= 100
        ) {

            return {

                action:
                    "BLOCK",

                reasonCode:
                    "AML_SANCTIONS_OR_CRITICAL_SIGNAL",

                approved:
                    false,

                reviewRequired:
                    true,

                escalate:
                    true,

                financialPostingAllowed:
                    false,

                requiresInvestigation:
                    true
            };
        }

        /**
         * HARD RULE:
         * Extreme account takeover risk.
         */
        if (
            Number(risks.accountTakeoverRisk) >= 90
        ) {

            return {

                action:
                    "BLOCK",

                reasonCode:
                    "ACCOUNT_TAKEOVER_RISK",

                approved:
                    false,

                reviewRequired:
                    true,

                escalate:
                    true,

                financialPostingAllowed:
                    false,

                requiresInvestigation:
                    true
            };
        }

        if (
            level === "CRITICAL"
        ) {

            return {

                action:
                    "BLOCK",

                reasonCode:
                    "CRITICAL_FRAUD_RISK",

                approved:
                    false,

                reviewRequired:
                    true,

                escalate:
                    true,

                financialPostingAllowed:
                    false,

                requiresInvestigation:
                    true
            };
        }

        if (
            level === "HIGH"
        ) {

            return {

                action:
                    "HOLD",

                reasonCode:
                    "HIGH_FRAUD_RISK",

                approved:
                    false,

                reviewRequired:
                    true,

                escalate:
                    true,

                financialPostingAllowed:
                    false,

                requiresInvestigation:
                    true
            };
        }

        if (
            level === "MEDIUM"
        ) {

            return {

                action:
                    "MONITOR",

                reasonCode:
                    "MEDIUM_FRAUD_RISK",

                approved:
                    true,

                reviewRequired:
                    false,

                escalate:
                    false,

                financialPostingAllowed:
                    true,

                requiresInvestigation:
                    false
            };
        }

        return {

            action:
                "ALLOW",

            reasonCode:
                "LOW_FRAUD_RISK",

            approved:
                true,

            reviewRequired:
                false,

            escalate:
                false,

            financialPostingAllowed:
                true,

            requiresInvestigation:
                false
        };
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

        if (
            Number(risks.deviceRisk) > 70
        ) {

            recommendations.push(
                "Trigger device re-verification before transaction continuation."
            );
        }

        if (
            Number(risks.accountTakeoverRisk) > 50
        ) {

            recommendations.push(
                "Require strong customer authentication or MFA."
            );
        }

        if (
            Number(risks.amlRisk) > 50
        ) {

            recommendations.push(
                "Escalate transaction to AML/Compliance review."
            );
        }

        if (
            Number(risks.beneficiaryRisk) > 50
        ) {

            recommendations.push(
                "Verify beneficiary identity and ownership before release."
            );
        }

        if (
            Number(risks.velocityRisk) > 50
        ) {

            recommendations.push(
                "Review transaction velocity across the customer and linked accounts."
            );
        }

        if (
            Number(risks.geoRisk) > 50
        ) {

            recommendations.push(
                "Perform geographic anomaly and customer-location verification."
            );
        }

        if (
            Number(risks.behavioralRisk) > 50
        ) {

            recommendations.push(
                "Review transaction behaviour against the customer's historical profile."
            );
        }

        if (
            Number(risks.transactionPatternRisk) > 50
        ) {

            recommendations.push(
                "Investigate unusual transaction patterns and cash-out behaviour."
            );
        }

        if (
            decision.action === "BLOCK"
        ) {

            recommendations.push(
                "Prevent transaction execution until fraud/compliance disposition is recorded."
            );
        }

        if (
            decision.action === "HOLD"
        ) {

            recommendations.push(
                "Place transaction in the fraud investigation queue."
            );
        }

        if (
            decision.action === "MONITOR"
        ) {

            recommendations.push(
                "Permit transaction while increasing monitoring sensitivity."
            );
        }

        if (
            level === "CRITICAL"
        ) {

            recommendations.push(
                "Create and escalate a fraud investigation case immediately."
            );
        }

        return [
            ...new Set(
                recommendations
            )
        ];
    }

    /**
     * =========================================================================
     * FRAUD ALERT CREATION
     * =========================================================================
     */

    async createFraudAlert(
        transaction,
        fraudResult
    ) {

        if (!transaction) {

            throw new Error(
                "Transaction required to create fraud alert."
            );
        }

        if (!fraudResult) {

            throw new Error(
                "Fraud result required to create fraud alert."
            );
        }

        const alert = {

            alertId:
                generateId("FRAUDALERT"),

            transactionId:
                transaction.id ||
                transaction._id?.toString() ||
                null,

            memberId:
                transaction.memberId ||
                null,

            tenantId:
                transaction.tenantId ||
                null,

            investigationId:
                fraudResult.investigationId,

            severity:
                fraudResult.fraudLevel,

            fraudScore:
                fraudResult.fraudScore,

            decision:
                fraudResult.decision,

            indicators:
                fraudResult.indicators,

            status:
                "OPEN",

            createdAt:
                new Date().toISOString(),

            screeningVersion:
                fraudResult.serviceVersion
        };

        const service =
            this.dependencies
                .riskAlertService;

        if (
            service &&
            typeof service.create ===
                "function"
        ) {

            return service.create(
                alert
            );
        }

        return alert;
    }

    /**
     * =========================================================================
     * INVESTIGATION CASE
     * =========================================================================
     */

    async createInvestigationCase(
        transaction,
        fraudResult,
        options = {}
    ) {

        if (!transaction) {

            throw new Error(
                "Transaction required to create investigation case."
            );
        }

        if (!fraudResult) {

            throw new Error(
                "Fraud result required to create investigation case."
            );
        }

        const investigationCase = {

            caseId:
                generateId("FRAUDCASE"),

            transactionId:
                transaction.id ||
                transaction._id?.toString() ||
                null,

            memberId:
                transaction.memberId ||
                null,

            tenantId:
                transaction.tenantId ||
                null,

            investigationId:
                fraudResult.investigationId,

            fraudScore:
                fraudResult.fraudScore,

            fraudLevel:
                fraudResult.fraudLevel,

            decision:
                fraudResult.decision,

            indicators:
                fraudResult.indicators,

            recommendations:
                fraudResult.recommendations,

            status:
                "PENDING_REVIEW",

            assignedTo:
                options.assignedTo ||
                null,

            createdAt:
                new Date().toISOString(),

            closedAt:
                null
        };

        const service =
            this.dependencies
                .caseManagementService;

        if (
            service &&
            typeof service.createCase ===
                "function"
        ) {

            return service.createCase(
                {
                    alertId:
                        options.alertId ||
                        null,

                    userId:
                        transaction.userId ||
                        transaction.memberId ||
                        null,

                    tenantId:
                        transaction.tenantId ||
                        null,

                    assignedTo:
                        options.assignedTo ||
                        null,

                    metadata:
                        investigationCase
                }
            );
        }

        return investigationCase;
    }

    /**
     * =========================================================================
     * AUDIT LOGGING
     * =========================================================================
     */

    async auditAnalysis(
        result
    ) {

        const auditService =
            this.dependencies
                .auditService;

        if (
            auditService &&
            typeof auditService.log ===
                "function"
        ) {

            await auditService.log({

                event:
                    "FRAUD_ANALYSIS_COMPLETED",

                service:
                    this.serviceName,

                investigationId:
                    result.investigationId,

                transactionId:
                    result.transactionId,

                memberId:
                    result.memberId,

                tenantId:
                    result.tenantId,

                fraudScore:
                    result.fraudScore,

                fraudLevel:
                    result.fraudLevel,

                action:
                    result.decision.action,

                reasonCode:
                    result.decision.reasonCode,

                financialPostingAllowed:
                    result.decision
                        .financialPostingAllowed,

                serviceVersion:
                    result.serviceVersion,

                timestamp:
                    result.timestamp
            });
        }

        return true;
    }

    /**
     * =========================================================================
     * ERROR CREATION
     * =========================================================================
     */

    createFraudError(
        originalError,
        investigationId
    ) {

        const error =
            new Error(
                `Fraud detection failed: ${originalError.message}`
            );

        error.code =
            "FRAUD_DETECTION_FAILED";

        error.investigationId =
            investigationId;

        error.service =
            this.serviceName;

        error.cause =
            originalError;

        return error;
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
            this.dependencies.logger;

        if (
            logger &&
            typeof logger.error ===
                "function"
        ) {

            logger.error(
                message,
                {

                    error:
                        error?.message,

                    stack:
                        error?.stack,

                    service:
                        this.serviceName,

                    ...metadata
                }
            );
        }
    }
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 *
 * Backward compatible:
 *
 * const FraudDetectionService =
 *     require("./FraudDetectionService");
 *
 * FraudDetectionService.analyzeTransaction(...)
 *
 * ============================================================================
 */

module.exports =
    new FraudDetectionService();

/**
 * ============================================================================
 * CLASS EXPORT
 * ============================================================================
 *
 * Useful for:
 *
 * - Unit testing
 * - Dependency injection
 * - Tenant-specific configuration
 * - Provider integration
 * - Test doubles/mocks
 * ============================================================================
 */

module.exports.FraudDetectionService =
    FraudDetectionService;

/**
 * ============================================================================
 * DEFAULT CONFIG EXPORT
 * ============================================================================
 */

module.exports.DEFAULT_FRAUD_CONFIG =
    DEFAULT_FRAUD_CONFIG;