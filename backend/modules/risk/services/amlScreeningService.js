"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise AML / CFT Screening Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/AMLScreeningService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Central Anti-Money Laundering (AML), Counter-Terrorist Financing (CFT),
 * transaction-risk screening and customer-risk assessment engine.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - Transaction AML screening
 * - Customer risk evaluation
 * - Sanctions risk evaluation
 * - PEP risk evaluation
 * - Adverse media risk evaluation
 * - Geographic risk evaluation
 * - Structuring detection
 * - Transaction monitoring
 * - Suspicious behaviour detection
 * - Weighted AML risk scoring
 * - Hard-rule risk overrides
 * - Risk classification
 * - Compliance decision generation
 * - Compliance case generation
 * - STR/SAR preparation
 * - Periodic customer risk review
 * - Screening audit metadata
 * - Screening configuration versioning
 *
 * Architecture:
 * ----------------------------------------------------------------------------
 *
 * Controller
 *     |
 *     v
 * AMLScreeningService
 *     |
 *     +--> Sanctions Provider
 *     +--> PEP Provider
 *     +--> Adverse Media Provider
 *     +--> Customer Risk Engine
 *     +--> Transaction Monitoring Engine
 *     +--> Structuring Engine
 *     +--> Decision Engine
 *     +--> Compliance Case Service
 *     +--> Audit/Event Service
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This service does NOT directly modify financial ledger balances.
 *
 * A BLOCK / HOLD / MANUAL_REVIEW decision must be enforced by the transaction
 * orchestration/payment/ledger workflow before financial posting proceeds.
 *
 * ============================================================================
 */

const crypto = require("crypto");

const DEFAULT_CONFIG = Object.freeze({
    version: "1.0.0",

    thresholds: Object.freeze({
        LOW: 30,
        MEDIUM: 60,
        HIGH: 80,
        CRITICAL: 90
    }),

    weights: Object.freeze({
        sanctions: 30,
        pep: 15,
        adverseMedia: 10,
        geography: 10,
        customerProfile: 10,
        structuring: 10,
        transactionMonitoring: 10,
        suspiciousBehaviour: 5
    }),

    transactionThresholds: Object.freeze({
        highValue: 10000000,
        criticalValue: 50000000
    }),

    customerRisk: Object.freeze({
        newAccountMonths: 3,
        highRiskBusinessScore: 30,
        unverifiedKycScore: 40,
        unverifiedAddressScore: 15
    }),

    structuring: Object.freeze({
        multipleSmallTransactionsScore: 70,
        thresholdAvoidanceScore: 80
    }),

    behaviour: Object.freeze({
        rapidMovementOfFundsScore: 40,
        cashIntensivePatternScore: 35,
        highVelocityTransfersScore: 40,
        roundAmountScore: 15
    }),

    geographicRisk: Object.freeze({
        defaultScore: 10,
        highRiskScore: 90,

        countries: Object.freeze([
            "IRAN",
            "NORTH KOREA",
            "SYRIA",
            "AFGHANISTAN"
        ])
    }),

    screening: Object.freeze({
        defaultMissingDataRisk: 10,
        providerTimeoutMs: 5000
    })
});

/**
 * ============================================================================
 * Utility Functions
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
    const factor = 10 ** decimals;

    return Math.round(
        Number(value) * factor
    ) / factor;
}

function normalizeBoolean(value) {
    return value === true;
}

function normalizeString(value) {
    if (value === null || value === undefined) {
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
 * AML Screening Service
 * ============================================================================
 */

class AMLScreeningService {
    constructor(options = {}) {
        this.config = this.buildConfig(
            options.config || {}
        );

        /**
         * Optional enterprise dependencies.
         *
         * These are intentionally injected rather than hard imported so the
         * service remains drop-in compatible with the existing architecture.
         */
        this.dependencies = {
            sanctionsProvider:
                options.sanctionsProvider || null,

            pepProvider:
                options.pepProvider || null,

            adverseMediaProvider:
                options.adverseMediaProvider || null,

            transactionMonitoringEngine:
                options.transactionMonitoringEngine || null,

            structuringEngine:
                options.structuringEngine || null,

            auditService:
                options.auditService || null,

            complianceCaseService:
                options.complianceCaseService || null,

            reportingService:
                options.reportingService || null,

            logger:
                options.logger || console
        };

        this.serviceName =
            "AMLScreeningService";

        this.serviceVersion =
            this.config.version;
    }

    /**
     * ========================================================================
     * Configuration
     * ========================================================================
     */

    buildConfig(customConfig = {}) {
        const merged = {
            ...DEFAULT_CONFIG,

            ...customConfig,

            thresholds: {
                ...DEFAULT_CONFIG.thresholds,
                ...(customConfig.thresholds || {})
            },

            weights: {
                ...DEFAULT_CONFIG.weights,
                ...(customConfig.weights || {})
            },

            transactionThresholds: {
                ...DEFAULT_CONFIG.transactionThresholds,
                ...(customConfig.transactionThresholds || {})
            },

            customerRisk: {
                ...DEFAULT_CONFIG.customerRisk,
                ...(customConfig.customerRisk || {})
            },

            structuring: {
                ...DEFAULT_CONFIG.structuring,
                ...(customConfig.structuring || {})
            },

            behaviour: {
                ...DEFAULT_CONFIG.behaviour,
                ...(customConfig.behaviour || {})
            },

            geographicRisk: {
                ...DEFAULT_CONFIG.geographicRisk,
                ...(customConfig.geographicRisk || {})
            },

            screening: {
                ...DEFAULT_CONFIG.screening,
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
        const weights = Object.values(
            config.weights
        );

        const totalWeight =
            weights.reduce(
                (sum, value) =>
                    sum + Number(value || 0),
                0
            );

        if (totalWeight !== 100) {
            throw new Error(
                `AML risk weights must total 100. Current total: ${totalWeight}`
            );
        }

        const thresholds =
            config.thresholds;

        if (
            thresholds.LOW < 0 ||
            thresholds.MEDIUM <= thresholds.LOW ||
            thresholds.HIGH <= thresholds.MEDIUM ||
            thresholds.CRITICAL <= thresholds.HIGH
        ) {
            throw new Error(
                "Invalid AML risk thresholds."
            );
        }
    }

    /**
     * ========================================================================
     * MAIN AML SCREENING ENTRYPOINT
     * ========================================================================
     */

    async screenTransaction(
        transaction,
        customer,
        options = {}
    ) {
        const screeningId =
            generateId("AML");

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

            const normalizedCustomer =
                this.normalizeCustomer(
                    customer
                );

            const context = {
                screeningId,

                transaction:
                    normalizedTransaction,

                customer:
                    normalizedCustomer,

                options
            };

            const results =
                await this.collectRiskIndicators(
                    context
                );

            const score =
                this.calculateAMLScore(
                    results
                );

            const riskLevel =
                this.classifyRisk(
                    score
                );

            const decision =
                this.generateDecision(
                    score,
                    riskLevel,
                    results
                );

            const recommendations =
                this.generateRecommendations(
                    riskLevel,
                    results,
                    decision
                );

            const result = {
                success: true,

                screeningId,

                service:
                    this.serviceName,

                screeningVersion:
                    this.serviceVersion,

                timestamp:
                    new Date().toISOString(),

                durationMs:
                    Date.now() - startedAt,

                transactionId:
                    normalizedTransaction.id,

                customerId:
                    normalizedCustomer?.id || null,

                amlScore:
                    score,

                riskLevel,

                decision,

                indicators:
                    results,

                recommendations,

                metadata: {
                    currency:
                        normalizedTransaction.currency,

                    amount:
                        normalizedTransaction.amount,

                    country:
                        normalizedTransaction.country,

                    screeningStatus:
                        "COMPLETED"
                }
            };

            await this.auditScreening(
                result,
                context
            );

            return result;
        } catch (error) {
            this.logError(
                "AML screening failed",
                error,
                {
                    screeningId
                }
            );

            /**
             * Do not silently convert infrastructure failures into a normal
             * AML result.
             *
             * Compliance infrastructure failures should normally cause the
             * parent transaction workflow to fail closed or enter a pending
             * compliance state.
             */
            throw this.createScreeningError(
                error,
                screeningId
            );
        }
    }

    /**
     * ========================================================================
     * INPUT VALIDATION
     * ========================================================================
     */

    validateTransaction(transaction) {
        if (!transaction) {
            throw new Error(
                "Transaction required for AML screening."
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
     * ========================================================================
     * NORMALIZATION
     * ========================================================================
     */

    normalizeTransaction(transaction) {
        return {
            ...transaction,

            id:
                transaction.id ||
                transaction._id?.toString() ||
                null,

            amount:
                Number(transaction.amount || 0),

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

    normalizeCustomer(customer) {
        if (!customer) {
            return null;
        }

        return {
            ...customer,

            id:
                customer.id ||
                customer._id?.toString() ||
                null,

            customerType:
                normalizeString(
                    customer.customerType
                ),

            country:
                normalizeString(
                    customer.country
                ),

            riskRating:
                normalizeString(
                    customer.riskRating
                )
        };
    }

    /**
     * ========================================================================
     * RISK INDICATOR COLLECTION
     * ========================================================================
     */

    async collectRiskIndicators(context) {
        const {
            transaction,
            customer
        } = context;

        const [
            sanctionsRisk,
            pepRisk,
            adverseMediaRisk,
            geographyRisk,
            customerRisk,
            structuringRisk,
            monitoringRisk,
            suspiciousBehaviourRisk
        ] = await Promise.all([
            this.screenSanctions(
                customer,
                context
            ),

            this.screenPEP(
                customer,
                context
            ),

            this.screenAdverseMedia(
                customer,
                context
            ),

            this.evaluateGeographicRisk(
                transaction,
                customer
            ),

            this.evaluateCustomerRisk(
                customer
            ),

            this.detectStructuring(
                transaction,
                context
            ),

            this.monitorTransaction(
                transaction,
                context
            ),

            this.analyzeSuspiciousBehaviour(
                transaction,
                customer
            )
        ]);

        return {
            sanctionsRisk,
            pepRisk,
            adverseMediaRisk,
            geographyRisk,
            customerRisk,
            structuringRisk,
            monitoringRisk,
            suspiciousBehaviourRisk
        };
    }

    /**
     * ========================================================================
     * SANCTIONS SCREENING
     * ========================================================================
     *
     * Supports:
     * - Local customer flags
     * - External sanctions provider
     * - Provider confidence
     * - Evidence metadata
     *
     * External providers should eventually integrate:
     * - UN
     * - OFAC
     * - EU
     * - UK sanctions
     * - Applicable local regulatory lists
     * ========================================================================
     */

    async screenSanctions(
        customer,
        context = {}
    ) {
        if (!customer) {
            return 30;
        }

        if (
            normalizeBoolean(
                customer.sanctionMatch
            )
        ) {
            return 100;
        }

        const provider =
            this.dependencies.sanctionsProvider;

        if (
            provider &&
            typeof provider.screen === "function"
        ) {
            const result =
                await provider.screen(
                    customer,
                    context
                );

            if (
                result &&
                result.match === true
            ) {
                return 100;
            }

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

        return 0;
    }

    /**
     * ========================================================================
     * PEP SCREENING
     * ========================================================================
     */

    async screenPEP(
        customer,
        context = {}
    ) {
        if (!customer) {
            return 10;
        }

        if (
            normalizeBoolean(
                customer.pepMatch
            )
        ) {
            return 80;
        }

        if (
            normalizeBoolean(
                customer.relatedToPEP
            )
        ) {
            return 60;
        }

        const provider =
            this.dependencies.pepProvider;

        if (
            provider &&
            typeof provider.screen === "function"
        ) {
            const result =
                await provider.screen(
                    customer,
                    context
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

        return 0;
    }

    /**
     * ========================================================================
     * ADVERSE MEDIA SCREENING
     * ========================================================================
     */

    async screenAdverseMedia(
        customer,
        context = {}
    ) {
        if (!customer) {
            return 10;
        }

        if (
            normalizeBoolean(
                customer.adverseMediaHit
            )
        ) {
            return 75;
        }

        const provider =
            this.dependencies.adverseMediaProvider;

        if (
            provider &&
            typeof provider.screen === "function"
        ) {
            const result =
                await provider.screen(
                    customer,
                    context
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

        return 0;
    }

    /**
     * ========================================================================
     * GEOGRAPHIC RISK
     * ========================================================================
     */

    evaluateGeographicRisk(
        transaction,
        customer
    ) {
        const transactionCountry =
            normalizeString(
                transaction?.country
            );

        const customerCountry =
            normalizeString(
                customer?.country
            );

        const country =
            transactionCountry ||
            customerCountry;

        if (!country) {
            return this.config.geographicRisk.defaultScore;
        }

        if (
            this.config.geographicRisk.countries.includes(
                country
            )
        ) {
            return this.config.geographicRisk.highRiskScore;
        }

        return this.config.geographicRisk.defaultScore;
    }

    /**
     * ========================================================================
     * CUSTOMER PROFILE RISK
     * ========================================================================
     */

    evaluateCustomerRisk(customer) {
        if (!customer) {
            return 50;
        }

        let risk = 0;

        if (
            !normalizeBoolean(
                customer.kycVerified
            )
        ) {
            risk +=
                this.config.customerRisk
                    .unverifiedKycScore;
        }

        if (
            !normalizeBoolean(
                customer.addressVerified
            )
        ) {
            risk +=
                this.config.customerRisk
                    .unverifiedAddressScore;
        }

        if (
            customer.customerType ===
            "HIGH_RISK_BUSINESS"
        ) {
            risk +=
                this.config.customerRisk
                    .highRiskBusinessScore;
        }

        if (
            Number(
                customer.accountAgeMonths
            ) <
            this.config.customerRisk
                .newAccountMonths
        ) {
            risk += 20;
        }

        if (
            Number.isFinite(
                Number(customer.existingRiskScore)
            )
        ) {
            risk +=
                Number(
                    customer.existingRiskScore
                ) * 0.25;
        }

        return clamp(
            risk
        );
    }

    /**
     * ========================================================================
     * STRUCTURING / SMURFING DETECTION
     * ========================================================================
     */

    async detectStructuring(
        transaction,
        context = {}
    ) {
        let risk = 0;

        if (
            normalizeBoolean(
                transaction.multipleSmallTransactions
            )
        ) {
            risk +=
                this.config.structuring
                    .multipleSmallTransactionsScore;
        }

        if (
            normalizeBoolean(
                transaction.thresholdAvoidance
            )
        ) {
            risk +=
                this.config.structuring
                    .thresholdAvoidanceScore;
        }

        const engine =
            this.dependencies.structuringEngine;

        if (
            engine &&
            typeof engine.analyze === "function"
        ) {
            const result =
                await engine.analyze(
                    transaction,
                    context
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

        return clamp(
            risk
        );
    }

    /**
     * ========================================================================
     * TRANSACTION MONITORING
     * ========================================================================
     */

    async monitorTransaction(
        transaction,
        context = {}
    ) {
        const amount =
            Number(
                transaction.amount || 0
            );

        let risk =
            this.config.screening
                .defaultMissingDataRisk;

        if (
            amount >=
            this.config.transactionThresholds
                .criticalValue
        ) {
            risk = 90;
        } else if (
            amount >=
            this.config.transactionThresholds
                .highValue
        ) {
            risk = 50;
        }

        const engine =
            this.dependencies
                .transactionMonitoringEngine;

        if (
            engine &&
            typeof engine.analyze === "function"
        ) {
            const result =
                await engine.analyze(
                    transaction,
                    context
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

        return clamp(
            risk
        );
    }

    /**
     * ========================================================================
     * SUSPICIOUS BEHAVIOUR
     * ========================================================================
     */

    analyzeSuspiciousBehaviour(
        transaction,
        customer
    ) {
        let risk = 0;

        if (
            normalizeBoolean(
                transaction.rapidMovementOfFunds
            )
        ) {
            risk +=
                this.config.behaviour
                    .rapidMovementOfFundsScore;
        }

        if (
            normalizeBoolean(
                transaction.cashIntensivePattern
            )
        ) {
            risk +=
                this.config.behaviour
                    .cashIntensivePatternScore;
        }

        if (
            normalizeBoolean(
                transaction.highVelocityTransfers
            )
        ) {
            risk +=
                this.config.behaviour
                    .highVelocityTransfersScore;
        }

        if (
            normalizeBoolean(
                transaction.roundDollarAmounts
            )
        ) {
            risk +=
                this.config.behaviour
                    .roundAmountScore;
        }

        /**
         * Customer-specific behaviour.
         */
        if (
            customer &&
            customer.suddenProfileChange
        ) {
            risk += 20;
        }

        if (
            customer &&
            customer.unusualActivity
        ) {
            risk += 25;
        }

        return clamp(
            risk
        );
    }

    /**
     * ========================================================================
     * AML SCORE CALCULATION
     * ========================================================================
     */

    calculateAMLScore(risks) {
        const score =
            (
                Number(risks.sanctionsRisk || 0) *
                    this.config.weights.sanctions +

                Number(risks.pepRisk || 0) *
                    this.config.weights.pep +

                Number(risks.adverseMediaRisk || 0) *
                    this.config.weights.adverseMedia +

                Number(risks.geographyRisk || 0) *
                    this.config.weights.geography +

                Number(risks.customerRisk || 0) *
                    this.config.weights.customerProfile +

                Number(risks.structuringRisk || 0) *
                    this.config.weights.structuring +

                Number(risks.monitoringRisk || 0) *
                    this.config.weights.transactionMonitoring +

                Number(risks.suspiciousBehaviourRisk || 0) *
                    this.config.weights.suspiciousBehaviour
            ) / 100;

        return round(
            clamp(score)
        );
    }

    /**
     * ========================================================================
     * RISK CLASSIFICATION
     * ========================================================================
     */

    classifyRisk(score) {
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
     * ========================================================================
     * DECISION ENGINE
     * ========================================================================
     *
     * IMPORTANT:
     * Certain AML/CFT conditions are treated as hard overrides and therefore
     * cannot be diluted by the weighted score.
     * ========================================================================
     */

    generateDecision(
        score,
        riskLevel,
        indicators
    ) {
        /**
         * Sanctions match is a hard compliance stop.
         */
        if (
            Number(
                indicators.sanctionsRisk
            ) >= 100
        ) {
            return {
                action: "BLOCK",
                reasonCode:
                    "SANCTIONS_MATCH",
                reportRequired: true,
                escalate: true,
                requiresEnhancedDueDiligence: true,
                financialPostingAllowed: false
            };
        }

        if (
            riskLevel === "CRITICAL"
        ) {
            return {
                action: "BLOCK",
                reasonCode:
                    "CRITICAL_AML_RISK",
                reportRequired: true,
                escalate: true,
                requiresEnhancedDueDiligence: true,
                financialPostingAllowed: false
            };
        }

        if (
            riskLevel === "HIGH"
        ) {
            return {
                action: "HOLD",
                reasonCode:
                    "HIGH_AML_RISK",
                reportRequired: true,
                escalate: true,
                requiresEnhancedDueDiligence: true,
                financialPostingAllowed: false
            };
        }

        if (
            riskLevel === "MEDIUM"
        ) {
            return {
                action: "MANUAL_REVIEW",
                reasonCode:
                    "MEDIUM_AML_RISK",
                reportRequired: false,
                escalate: true,
                requiresEnhancedDueDiligence: false,
                financialPostingAllowed: false
            };
        }

        return {
            action: "ALLOW",
            reasonCode:
                "LOW_AML_RISK",
            reportRequired: false,
            escalate: false,
            requiresEnhancedDueDiligence: false,
            financialPostingAllowed: true
        };
    }

    /**
     * ========================================================================
     * RECOMMENDATIONS
     * ========================================================================
     */

    generateRecommendations(
        level,
        indicators,
        decision
    ) {
        const recommendations = [];

        if (
            indicators.sanctionsRisk > 0
        ) {
            recommendations.push(
                "Perform sanctions screening review and verify potential match resolution."
            );
        }

        if (
            indicators.pepRisk > 0
        ) {
            recommendations.push(
                "Apply Enhanced Due Diligence (EDD) and establish appropriate PEP controls."
            );
        }

        if (
            indicators.adverseMediaRisk > 0
        ) {
            recommendations.push(
                "Compliance Officer should review adverse media evidence and source reliability."
            );
        }

        if (
            indicators.structuringRisk > 50
        ) {
            recommendations.push(
                "Review transaction history for potential structuring or threshold-avoidance activity."
            );
        }

        if (
            indicators.monitoringRisk >= 50
        ) {
            recommendations.push(
                "Perform enhanced transaction monitoring and source-of-funds review."
            );
        }

        if (
            indicators.suspiciousBehaviourRisk > 50
        ) {
            recommendations.push(
                "Review behavioural transaction patterns and linked-account activity."
            );
        }

        if (
            indicators.customerRisk >= 50
        ) {
            recommendations.push(
                "Perform enhanced customer risk assessment and KYC review."
            );
        }

        if (
            decision.action === "BLOCK"
        ) {
            recommendations.push(
                "Prevent transaction execution until Compliance disposition is recorded."
            );
        }

        if (
            decision.action === "HOLD"
        ) {
            recommendations.push(
                "Place transaction in compliance hold queue pending investigation."
            );
        }

        if (
            decision.action === "MANUAL_REVIEW"
        ) {
            recommendations.push(
                "Route transaction to Compliance Officer for manual review."
            );
        }

        if (
            level === "CRITICAL"
        ) {
            recommendations.push(
                "Assess whether an applicable suspicious transaction/activity report is required."
            );
        }

        return [
            ...new Set(
                recommendations
            )
        ];
    }

    /**
     * ========================================================================
     * STR / SAR CREATION
     * ========================================================================
     *
     * This prepares a report object. Submission to the regulator must occur
     * through the appropriate regulatory reporting workflow.
     * ========================================================================
     */

    createSTR(
        transaction,
        result
    ) {
        if (!transaction) {
            throw new Error(
                "Transaction required to create STR/SAR."
            );
        }

        if (!result) {
            throw new Error(
                "AML screening result required to create STR/SAR."
            );
        }

        return {
            reportId:
                generateId("STR"),

            type:
                "SUSPICIOUS_TRANSACTION_REPORT",

            transactionId:
                transaction.id ||
                transaction._id?.toString() ||
                null,

            customerId:
                transaction.customerId ||
                null,

            severity:
                result.riskLevel,

            amlScore:
                result.amlScore,

            riskIndicators:
                result.indicators,

            decision:
                result.decision,

            reportedAt:
                new Date().toISOString(),

            status:
                "PENDING_SUBMISSION",

            submissionReference:
                null,

            createdBy:
                "AML_SCREENING_ENGINE",

            screeningId:
                result.screeningId,

            screeningVersion:
                result.screeningVersion
        };
    }

    /**
     * ========================================================================
     * COMPLIANCE CASE MANAGEMENT
     * ========================================================================
     */

    async createComplianceCase(
        transaction,
        result,
        options = {}
    ) {
        if (!transaction) {
            throw new Error(
                "Transaction required to create compliance case."
            );
        }

        if (!result) {
            throw new Error(
                "AML screening result required to create compliance case."
            );
        }

        const complianceCase = {
            caseId:
                generateId("AMLCASE"),

            transactionId:
                transaction.id ||
                transaction._id?.toString() ||
                null,

            customerId:
                transaction.customerId ||
                null,

            screeningId:
                result.screeningId,

            riskLevel:
                result.riskLevel,

            amlScore:
                result.amlScore,

            decision:
                result.decision,

            indicators:
                result.indicators,

            recommendations:
                result.recommendations,

            status:
                "OPEN",

            priority:
                this.mapPriority(
                    result.riskLevel
                ),

            createdAt:
                new Date().toISOString(),

            assignedTo:
                options.assignedTo ||
                null,

            disposition:
                null,

            closedAt:
                null
        };

        const service =
            this.dependencies
                .complianceCaseService;

        if (
            service &&
            typeof service.create === "function"
        ) {
            return service.create(
                complianceCase
            );
        }

        return complianceCase;
    }

    /**
     * ========================================================================
     * PRIORITY
     * ========================================================================
     */

    mapPriority(
        riskLevel
    ) {
        switch (riskLevel) {
            case "CRITICAL":
                return "P1";

            case "HIGH":
                return "P2";

            case "MEDIUM":
                return "P3";

            default:
                return "P4";
        }
    }

    /**
     * ========================================================================
     * PERIODIC CUSTOMER RISK REVIEW
     * ========================================================================
     */

    async reviewCustomerRisk(
        customer,
        options = {}
    ) {
        if (!customer) {
            throw new Error(
                "Customer required for risk review."
            );
        }

        const customerRisk =
            this.evaluateCustomerRisk(
                customer
            );

        const pepRisk =
            await this.screenPEP(
                customer,
                {
                    review: true,
                    options
                }
            );

        const sanctionsRisk =
            await this.screenSanctions(
                customer,
                {
                    review: true,
                    options
                }
            );

        const adverseMediaRisk =
            await this.screenAdverseMedia(
                customer,
                {
                    review: true,
                    options
                }
            );

        /**
         * Customer review uses a separate customer-risk weighting rather than
         * simply averaging unrelated indicators.
         */
        const reviewScore =
            round(
                (
                    customerRisk * 0.30 +
                    pepRisk * 0.25 +
                    sanctionsRisk * 0.35 +
                    adverseMediaRisk * 0.10
                )
            );

        const classification =
            this.classifyRisk(
                reviewScore
            );

        return {
            reviewId:
                generateId("AMLREVIEW"),

            reviewDate:
                new Date().toISOString(),

            customerId:
                customer.id ||
                customer._id?.toString() ||
                null,

            reviewScore,

            classification,

            indicators: {
                customerRisk,
                pepRisk,
                sanctionsRisk,
                adverseMediaRisk
            },

            requiresEDD:
                classification === "HIGH" ||
                classification === "CRITICAL",

            escalationRequired:
                classification !== "LOW",

            screeningVersion:
                this.serviceVersion
        };
    }

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    async auditScreening(
        result,
        context
    ) {
        const auditService =
            this.dependencies.auditService;

        if (
            auditService &&
            typeof auditService.log === "function"
        ) {
            await auditService.log({
                event:
                    "AML_SCREENING_COMPLETED",

                service:
                    this.serviceName,

                screeningId:
                    result.screeningId,

                transactionId:
                    result.transactionId,

                customerId:
                    result.customerId,

                amlScore:
                    result.amlScore,

                riskLevel:
                    result.riskLevel,

                action:
                    result.decision.action,

                screeningVersion:
                    result.screeningVersion,

                timestamp:
                    result.timestamp
            });
        }

        return true;
    }

    /**
     * ========================================================================
     * SCREENING ERROR
     * ========================================================================
     */

    createScreeningError(
        originalError,
        screeningId
    ) {
        const error =
            new Error(
                `AML screening failed: ${originalError.message}`
            );

        error.code =
            "AML_SCREENING_FAILED";

        error.screeningId =
            screeningId;

        error.cause =
            originalError;

        error.service =
            this.serviceName;

        return error;
    }

    /**
     * ========================================================================
     * LOGGING
     * ========================================================================
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
            typeof logger.error === "function"
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
 * Singleton Export
 * ============================================================================
 *
 * Preserves compatibility with:
 *
 * const AMLScreeningService =
 *     require("./AMLScreeningService");
 *
 * AMLScreeningService.screenTransaction(...)
 *
 * ============================================================================
 */

module.exports =
    new AMLScreeningService();

/**
 * ============================================================================
 * Optional Class Export
 * ============================================================================
 *
 * Useful for testing and dependency injection.
 * ============================================================================
 */

module.exports.AMLScreeningService =
    AMLScreeningService;

module.exports.DEFAULT_AML_CONFIG =
    DEFAULT_CONFIG;