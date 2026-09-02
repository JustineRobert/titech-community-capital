"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Credit Scoring Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/CreditScoringService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Central credit-risk assessment and underwriting scoring engine.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 *
 * - Multi-factor credit scoring
 * - Payment history evaluation
 * - Debt-to-income analysis
 * - Loan utilization analysis
 * - Account-age analysis
 * - Fraud risk integration
 * - Sanctions risk integration
 * - Risk classification
 * - Credit decision generation
 * - Explainable score factors
 * - Underwriting recommendations
 * - Risk-profile persistence
 * - Tenant isolation
 * - Scoring-model versioning
 * - Audit metadata
 * - Deterministic scoring
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This service does NOT disburse loans, modify ledger balances, approve
 * financial postings, or directly execute credit facilities.
 *
 * A CREDIT decision must be enforced by the appropriate:
 *
 *   Loan Application Workflow
 *          |
 *          v
 *   Loan Approval Service
 *          |
 *          v
 *   Credit Decision Engine
 *          |
 *          v
 *   Ledger / Disbursement Workflow
 *
 * ============================================================================
 */

const crypto = require("crypto");

const RiskProfile = require("../../models/RiskProfile");

/**
 * ============================================================================
 * DEFAULT CONFIGURATION
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    version: "2.0.0",

    /**
     * ------------------------------------------------------------------------
     * Credit score range
     * ------------------------------------------------------------------------
     */

    scoreRange: Object.freeze({
        minimum: 300,
        maximum: 850,
        base: 300,
    }),

    /**
     * ------------------------------------------------------------------------
     * Factor weights
     *
     * Total must equal 100.
     * ------------------------------------------------------------------------
     */

    weights: Object.freeze({
        PAYMENT_HISTORY: 35,
        DEBT_TO_INCOME: 25,
        LOAN_UTILIZATION: 20,
        ACCOUNT_AGE: 10,
        FRAUD_SANCTIONS: 10,
    }),

    /**
     * ------------------------------------------------------------------------
     * Risk classification thresholds
     * ------------------------------------------------------------------------
     */

    thresholds: Object.freeze({
        EXCELLENT: 750,
        GOOD: 650,
        FAIR: 550,
        POOR: 450,
        VERY_POOR: 300,
    }),

    /**
     * ------------------------------------------------------------------------
     * Payment history configuration
     * ------------------------------------------------------------------------
     */

    paymentHistory: Object.freeze({
        excellentRatio: 0.98,
        goodRatio: 0.95,
        fairRatio: 0.85,
        poorRatio: 0.70,
    }),

    /**
     * ------------------------------------------------------------------------
     * DTI configuration
     *
     * Lower DTI = lower credit risk.
     * ------------------------------------------------------------------------
     */

    debtToIncome: Object.freeze({
        excellent: 0.20,
        good: 0.35,
        fair: 0.50,
        high: 0.65,
        maximum: 1.00,
    }),

    /**
     * ------------------------------------------------------------------------
     * Loan utilization configuration
     * ------------------------------------------------------------------------
     */

    utilization: Object.freeze({
        excellent: 0.30,
        good: 0.50,
        fair: 0.70,
        high: 0.90,
        maximum: 1.00,
    }),

    /**
     * ------------------------------------------------------------------------
     * Account age
     * ------------------------------------------------------------------------
     */

    accountAge: Object.freeze({
        minimumMonths: 0,
        matureMonths: 60,
    }),

    /**
     * ------------------------------------------------------------------------
     * Risk penalties
     * ------------------------------------------------------------------------
     */

    penalties: Object.freeze({
        fraud: 100,
        sanctions: 250,
        confirmedFraud: 200,
    }),

    /**
     * ------------------------------------------------------------------------
     * Hard underwriting rules
     * ------------------------------------------------------------------------
     */

    hardRules: Object.freeze({
        sanctionsBlock: true,
        confirmedFraudBlock: true,
        minimumScoreForApproval: 550,
    }),

    /**
     * ------------------------------------------------------------------------
     * Screening behaviour
     * ------------------------------------------------------------------------
     */

    screening: Object.freeze({
        defaultMissingDataRisk: 50,
    }),
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

function normalizeNumber(
    value,
    fallback = 0
) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return numeric;
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
 * SERVICE
 * ============================================================================
 */

class CreditScoringService {
    constructor(options = {}) {
        this.config =
            this.buildConfig(
                options.config || {}
            );

        this.dependencies = {
            fraudEngine:
                options.fraudEngine || null,

            sanctionsEngine:
                options.sanctionsEngine || null,

            auditService:
                options.auditService || null,

            logger:
                options.logger || console,
        };

        this.serviceName =
            "CreditScoringService";

        this.serviceVersion =
            this.config.version;
    }

    /**
     * ========================================================================
     * CONFIGURATION
     * ========================================================================
     */

    buildConfig(customConfig = {}) {
        const merged = {
            ...DEFAULT_CONFIG,

            ...customConfig,

            scoreRange: {
                ...DEFAULT_CONFIG.scoreRange,
                ...(customConfig.scoreRange || {}),
            },

            weights: {
                ...DEFAULT_CONFIG.weights,
                ...(customConfig.weights || {}),
            },

            thresholds: {
                ...DEFAULT_CONFIG.thresholds,
                ...(customConfig.thresholds || {}),
            },

            paymentHistory: {
                ...DEFAULT_CONFIG.paymentHistory,
                ...(customConfig.paymentHistory || {}),
            },

            debtToIncome: {
                ...DEFAULT_CONFIG.debtToIncome,
                ...(customConfig.debtToIncome || {}),
            },

            utilization: {
                ...DEFAULT_CONFIG.utilization,
                ...(customConfig.utilization || {}),
            },

            accountAge: {
                ...DEFAULT_CONFIG.accountAge,
                ...(customConfig.accountAge || {}),
            },

            penalties: {
                ...DEFAULT_CONFIG.penalties,
                ...(customConfig.penalties || {}),
            },

            hardRules: {
                ...DEFAULT_CONFIG.hardRules,
                ...(customConfig.hardRules || {}),
            },

            screening: {
                ...DEFAULT_CONFIG.screening,
                ...(customConfig.screening || {}),
            },
        };

        this.validateConfiguration(
            merged
        );

        return Object.freeze(
            merged
        );
    }

    validateConfiguration(config) {
        const totalWeight =
            Object.values(
                config.weights
            ).reduce(
                (sum, value) =>
                    sum +
                    normalizeNumber(
                        value
                    ),
                0
            );

        if (
            totalWeight !== 100
        ) {
            throw new Error(
                `Credit scoring weights must total 100. Current total: ${totalWeight}`
            );
        }

        if (
            config.scoreRange.minimum >=
            config.scoreRange.maximum
        ) {
            throw new Error(
                "Invalid credit score range."
            );
        }

        const thresholds =
            config.thresholds;

        if (
            thresholds.EXCELLENT <=
            thresholds.GOOD ||
            thresholds.GOOD <=
            thresholds.FAIR ||
            thresholds.FAIR <=
            thresholds.POOR ||
            thresholds.POOR <=
            thresholds.VERY_POOR
        ) {
            throw new Error(
                "Invalid credit risk thresholds."
            );
        }
    }

    /**
     * ========================================================================
     * MAIN ENTRYPOINT
     * ========================================================================
     */

    async scoreCustomer(
        user,
        financialData,
        riskFlags = {},
        options = {}
    ) {
        const scoreId =
            generateId("CREDIT");

        const startedAt =
            Date.now();

        try {
            this.validateInputs(
                user,
                financialData
            );

            const normalizedUser =
                this.normalizeUser(
                    user
                );

            const normalizedFinancialData =
                this.normalizeFinancialData(
                    financialData
                );

            const normalizedRiskFlags =
                this.normalizeRiskFlags(
                    riskFlags
                );

            const context = {
                scoreId,
                user:
                    normalizedUser,
                financialData:
                    normalizedFinancialData,
                riskFlags:
                    normalizedRiskFlags,
                options,
            };

            const factors =
                await this.calculateScoreFactors(
                    context
                );

            const creditScore =
                this.calculateScore(
                    factors
                );

            const riskLevel =
                this.classifyRisk(
                    creditScore
                );

            const decision =
                this.generateDecision(
                    creditScore,
                    riskLevel,
                    factors,
                    normalizedRiskFlags
                );

            const recommendations =
                this.generateRecommendations(
                    riskLevel,
                    factors,
                    decision
                );

            const result = {
                success: true,

                scoreId,

                service:
                    this.serviceName,

                scoringVersion:
                    this.serviceVersion,

                timestamp:
                    new Date().toISOString(),

                durationMs:
                    Date.now() -
                    startedAt,

                userId:
                    normalizedUser.id,

                tenantId:
                    normalizedUser.tenantId,

                creditScore,

                riskLevel,

                decision,

                factors,

                recommendations,

                metadata: {
                    currency:
                        normalizedFinancialData.currency,

                    scoringStatus:
                        "COMPLETED",

                    modelVersion:
                        this.serviceVersion,
                },
            };

            await this.persistRiskProfile(
                normalizedUser,
                normalizedFinancialData,
                normalizedRiskFlags,
                result
            );

            await this.auditScore(
                result
            );

            return result;
        } catch (error) {
            this.logError(
                "Credit scoring failed",
                error,
                {
                    scoreId,
                    userId:
                        user?._id?.toString() ||
                        user?.id ||
                        null,
                }
            );

            throw this.createScoringError(
                error,
                scoreId
            );
        }
    }

    /**
     * ========================================================================
     * INPUT VALIDATION
     * ========================================================================
     */

    validateInputs(
        user,
        financialData
    ) {
        if (!user) {
            throw new Error(
                "User required for credit scoring."
            );
        }

        if (!financialData) {
            throw new Error(
                "Financial data required for credit scoring."
            );
        }
    }

    /**
     * ========================================================================
     * NORMALIZATION
     * ========================================================================
     */

    normalizeUser(user) {
        return {
            ...user,

            id:
                user.id ||
                user._id?.toString() ||
                null,

            tenantId:
                user.tenantId ||
                null,
        };
    }

    normalizeFinancialData(
        financialData
    ) {
        const normalized = {
            ...financialData,

            income:
                normalizeNumber(
                    financialData.income
                ),

            debt:
                normalizeNumber(
                    financialData.debt
                ),

            onTimePayments:
                normalizeNumber(
                    financialData.onTimePayments
                ),

            totalPayments:
                normalizeNumber(
                    financialData.totalPayments
                ),

            currentLoans:
                normalizeNumber(
                    financialData.currentLoans
                ),

            loanLimit:
                normalizeNumber(
                    financialData.loanLimit
                ),

            accountAgeMonths:
                normalizeNumber(
                    financialData.accountAgeMonths
                ),

            currency:
                normalizeString(
                    financialData.currency
                ),
        };

        return normalized;
    }

    normalizeRiskFlags(
        riskFlags
    ) {
        return {
            ...riskFlags,

            fraud:
                normalizeBoolean(
                    riskFlags.fraud
                ),

            confirmedFraud:
                normalizeBoolean(
                    riskFlags.confirmedFraud
                ),

            sanctions:
                normalizeBoolean(
                    riskFlags.sanctions
                ),
        };
    }

    /**
     * ========================================================================
     * FACTOR ENGINE
     * ========================================================================
     */

    async calculateScoreFactors(
        context
    ) {
        const {
            financialData,
            riskFlags,
        } = context;

        const [
            paymentHistory,
            debtToIncome,
            loanUtilization,
            accountAge,
            fraudSanctions,
        ] = await Promise.all([
            this.evaluatePaymentHistory(
                financialData
            ),

            this.evaluateDebtToIncome(
                financialData
            ),

            this.evaluateLoanUtilization(
                financialData
            ),

            this.evaluateAccountAge(
                financialData
            ),

            this.evaluateFraudSanctions(
                riskFlags,
                context
            ),
        ]);

        return {
            paymentHistory,
            debtToIncome,
            loanUtilization,
            accountAge,
            fraudSanctions,
        };
    }

    /**
     * ========================================================================
     * PAYMENT HISTORY
     * ========================================================================
     */

    evaluatePaymentHistory(
        financialData
    ) {
        const total =
            financialData.totalPayments;

        const onTime =
            financialData.onTimePayments;

        if (
            total <= 0
        ) {
            return {
                factor:
                    "PAYMENT_HISTORY",

                rawValue:
                    0,

                normalizedScore:
                    0,

                weightedContribution:
                    0,

                status:
                    "INSUFFICIENT_DATA",
            };
        }

        const ratio =
            clamp(
                onTime / total,
                0,
                1
            );

        let normalizedScore;

        if (
            ratio >=
            this.config.paymentHistory
                .excellentRatio
        ) {
            normalizedScore = 100;
        } else if (
            ratio >=
            this.config.paymentHistory
                .goodRatio
        ) {
            normalizedScore = 85;
        } else if (
            ratio >=
            this.config.paymentHistory
                .fairRatio
        ) {
            normalizedScore = 65;
        } else if (
            ratio >=
            this.config.paymentHistory
                .poorRatio
        ) {
            normalizedScore = 40;
        } else {
            normalizedScore = 15;
        }

        return {
            factor:
                "PAYMENT_HISTORY",

            rawValue:
                round(ratio * 100, 2),

            normalizedScore,

            weightedContribution:
                round(
                    normalizedScore *
                    this.config.weights
                        .PAYMENT_HISTORY /
                    100,
                    2
                ),

            status:
                "ASSESSED",
        };
    }

    /**
     * ========================================================================
     * DEBT TO INCOME
     * ========================================================================
     */

    evaluateDebtToIncome(
        financialData
    ) {
        const income =
            financialData.income;

        const debt =
            financialData.debt;

        if (
            income <= 0
        ) {
            return {
                factor:
                    "DEBT_TO_INCOME",

                rawValue:
                    null,

                normalizedScore:
                    0,

                weightedContribution:
                    0,

                status:
                    "INSUFFICIENT_DATA",
            };
        }

        const dti =
            debt / income;

        let normalizedScore;

        if (
            dti <=
            this.config.debtToIncome
                .excellent
        ) {
            normalizedScore = 100;
        } else if (
            dti <=
            this.config.debtToIncome
                .good
        ) {
            normalizedScore = 85;
        } else if (
            dti <=
            this.config.debtToIncome
                .fair
        ) {
            normalizedScore = 65;
        } else if (
            dti <=
            this.config.debtToIncome
                .high
        ) {
            normalizedScore = 40;
        } else {
            normalizedScore = 15;
        }

        return {
            factor:
                "DEBT_TO_INCOME",

            rawValue:
                round(dti * 100, 2),

            normalizedScore,

            weightedContribution:
                round(
                    normalizedScore *
                    this.config.weights
                        .DEBT_TO_INCOME /
                    100,
                    2
                ),

            status:
                "ASSESSED",
        };
    }

    /**
     * ========================================================================
     * LOAN UTILIZATION
     * ========================================================================
     */

    evaluateLoanUtilization(
        financialData
    ) {
        const currentLoans =
            financialData.currentLoans;

        const loanLimit =
            financialData.loanLimit;

        if (
            loanLimit <= 0
        ) {
            return {
                factor:
                    "LOAN_UTILIZATION",

                rawValue:
                    null,

                normalizedScore:
                    0,

                weightedContribution:
                    0,

                status:
                    "INSUFFICIENT_DATA",
            };
        }

        const utilization =
            currentLoans /
            loanLimit;

        let normalizedScore;

        if (
            utilization <=
            this.config.utilization
                .excellent
        ) {
            normalizedScore = 100;
        } else if (
            utilization <=
            this.config.utilization
                .good
        ) {
            normalizedScore = 85;
        } else if (
            utilization <=
            this.config.utilization
                .fair
        ) {
            normalizedScore = 65;
        } else if (
            utilization <=
            this.config.utilization
                .high
        ) {
            normalizedScore = 40;
        } else {
            normalizedScore = 15;
        }

        return {
            factor:
                "LOAN_UTILIZATION",

            rawValue:
                round(
                    utilization * 100,
                    2
                ),

            normalizedScore,

            weightedContribution:
                round(
                    normalizedScore *
                    this.config.weights
                        .LOAN_UTILIZATION /
                    100,
                    2
                ),

            status:
                "ASSESSED",
        };
    }

    /**
     * ========================================================================
     * ACCOUNT AGE
     * ========================================================================
     */

    evaluateAccountAge(
        financialData
    ) {
        const months =
            Math.max(
                0,
                financialData.accountAgeMonths
            );

        const normalizedScore =
            clamp(
                months /
                    this.config.accountAge
                        .matureMonths *
                    100
            );

        return {
            factor:
                "ACCOUNT_AGE",

            rawValue:
                months,

            normalizedScore:
                round(
                    normalizedScore,
                    2
                ),

            weightedContribution:
                round(
                    normalizedScore *
                    this.config.weights
                        .ACCOUNT_AGE /
                    100,
                    2
                ),

            status:
                "ASSESSED",
        };
    }

    /**
     * ========================================================================
     * FRAUD / SANCTIONS
     * ========================================================================
     */

    async evaluateFraudSanctions(
        riskFlags,
        context
    ) {
        let riskScore = 100;

        let reason =
            "NO_RISK_FLAGS";

        if (
            riskFlags.sanctions
        ) {
            riskScore = 0;

            reason =
                "SANCTIONS_MATCH";
        } else if (
            riskFlags.confirmedFraud
        ) {
            riskScore = 0;

            reason =
                "CONFIRMED_FRAUD";
        } else if (
            riskFlags.fraud
        ) {
            riskScore = 25;

            reason =
                "FRAUD_RISK";
        }

        /**
         * Optional external fraud engine.
         */

        const fraudEngine =
            this.dependencies
                .fraudEngine;

        if (
            fraudEngine &&
            typeof fraudEngine.assess ===
                "function"
        ) {
            const result =
                await fraudEngine.assess(
                    context
                );

            if (
                result &&
                Number.isFinite(
                    Number(
                        result.riskScore
                    )
                )
            ) {
                const externalRisk =
                    clamp(
                        result.riskScore
                    );

                riskScore =
                    Math.min(
                        riskScore,
                        externalRisk
                    );

                reason =
                    result.reasonCode ||
                    reason;
            }
        }

        /**
         * Optional sanctions engine.
         */

        const sanctionsEngine =
            this.dependencies
                .sanctionsEngine;

        if (
            sanctionsEngine &&
            typeof sanctionsEngine.screen ===
                "function"
        ) {
            const result =
                await sanctionsEngine.screen(
                    context.user,
                    context
                );

            if (
                result &&
                result.match === true
            ) {
                riskScore = 0;

                reason =
                    "SANCTIONS_MATCH";
            }
        }

        return {
            factor:
                "FRAUD_SANCTIONS",

            rawValue:
                riskScore,

            normalizedScore:
                riskScore,

            weightedContribution:
                round(
                    riskScore *
                    this.config.weights
                        .FRAUD_SANCTIONS /
                    100,
                    2
                ),

            status:
                riskScore === 0
                    ? "HIGH_RISK"
                    : "ASSESSED",

            reasonCode:
                reason,
        };
    }

    /**
     * ========================================================================
     * SCORE CALCULATION
     * ========================================================================
     *
     * Converts weighted 0-100 factor contributions into the traditional
     * 300-850 credit score range.
     * ========================================================================
     */

    calculateScore(
        factors
    ) {
        const weightedScore =
            Object.values(
                factors
            ).reduce(
                (
                    total,
                    factor
                ) =>
                    total +
                    normalizeNumber(
                        factor
                            .weightedContribution
                    ),
                0
            );

        const normalized =
            clamp(
                weightedScore,
                0,
                100
            );

        const minimum =
            this.config.scoreRange
                .minimum;

        const maximum =
            this.config.scoreRange
                .maximum;

        const score =
            minimum +
            (
                normalized /
                100
            ) *
            (
                maximum -
                minimum
            );

        return Math.round(
            clamp(
                score,
                minimum,
                maximum
            )
        );
    }

    /**
     * ========================================================================
     * RISK CLASSIFICATION
     * ========================================================================
     */

    classifyRisk(
        score
    ) {
        const numericScore =
            normalizeNumber(
                score
            );

        if (
            numericScore >=
            this.config.thresholds
                .EXCELLENT
        ) {
            return "LOW";
        }

        if (
            numericScore >=
            this.config.thresholds
                .GOOD
        ) {
            return "MEDIUM";
        }

        if (
            numericScore >=
            this.config.thresholds
                .FAIR
        ) {
            return "HIGH";
        }

        if (
            numericScore >=
            this.config.thresholds
                .POOR
        ) {
            return "CRITICAL";
        }

        return "SEVERE";
    }

    /**
     * ========================================================================
     * CREDIT DECISION ENGINE
     * ========================================================================
     *
     * Credit score alone must never override hard compliance or fraud rules.
     * ========================================================================
     */

    generateDecision(
        score,
        riskLevel,
        factors,
        riskFlags
    ) {
        const fraudFactor =
            factors.fraudSanctions;

        /**
         * Hard sanctions block.
         */

        if (
            this.config.hardRules
                .sanctionsBlock &&
            riskFlags.sanctions
        ) {
            return {
                action:
                    "BLOCK",

                reasonCode:
                    "SANCTIONS_MATCH",

                approvalAllowed:
                    false,

                escalationRequired:
                    true,

                requiresManualReview:
                    true,

                complianceReviewRequired:
                    true,
            };
        }

        /**
         * Confirmed fraud block.
         */

        if (
            this.config.hardRules
                .confirmedFraudBlock &&
            riskFlags.confirmedFraud
        ) {
            return {
                action:
                    "BLOCK",

                reasonCode:
                    "CONFIRMED_FRAUD",

                approvalAllowed:
                    false,

                escalationRequired:
                    true,

                requiresManualReview:
                    true,

                complianceReviewRequired:
                    true,
            };
        }

        /**
         * Severe risk.
         */

        if (
            riskLevel === "SEVERE"
        ) {
            return {
                action:
                    "DECLINE",

                reasonCode:
                    "SEVERE_CREDIT_RISK",

                approvalAllowed:
                    false,

                escalationRequired:
                    true,

                requiresManualReview:
                    true,

                complianceReviewRequired:
                    false,
            };
        }

        /**
         * Critical risk.
         */

        if (
            riskLevel === "CRITICAL"
        ) {
            return {
                action:
                    "DECLINE",

                reasonCode:
                    "CRITICAL_CREDIT_RISK",

                approvalAllowed:
                    false,

                escalationRequired:
                    true,

                requiresManualReview:
                    true,

                complianceReviewRequired:
                    false,
            };
        }

        /**
         * High risk.
         */

        if (
            riskLevel === "HIGH"
        ) {
            return {
                action:
                    "MANUAL_REVIEW",

                reasonCode:
                    "HIGH_CREDIT_RISK",

                approvalAllowed:
                    false,

                escalationRequired:
                    true,

                requiresManualReview:
                    true,

                complianceReviewRequired:
                    false,
            };
        }

        /**
         * Medium risk.
         */

        if (
            riskLevel === "MEDIUM"
        ) {
            return {
                action:
                    "CONDITIONAL_APPROVAL",

                reasonCode:
                    "MEDIUM_CREDIT_RISK",

                approvalAllowed:
                    true,

                escalationRequired:
                    false,

                requiresManualReview:
                    false,

                complianceReviewRequired:
                    false,
            };
        }

        /**
         * Low risk.
         */

        return {
            action:
                "APPROVE",

            reasonCode:
                "LOW_CREDIT_RISK",

            approvalAllowed:
                true,

            escalationRequired:
                false,

            requiresManualReview:
                false,

            complianceReviewRequired:
                false,
        };
    }

    /**
     * ========================================================================
     * RECOMMENDATIONS ENGINE
     * ========================================================================
     */

    generateRecommendations(
        riskLevel,
        factors,
        decision
    ) {
        const recommendations = [];

        const payment =
            factors.paymentHistory;

        const dti =
            factors.debtToIncome;

        const utilization =
            factors.loanUtilization;

        const fraud =
            factors.fraudSanctions;

        if (
            payment.normalizedScore < 65
        ) {
            recommendations.push(
                "Improve repayment consistency and maintain timely payment behaviour."
            );
        }

        if (
            dti.rawValue !== null &&
            dti.rawValue > 50
        ) {
            recommendations.push(
                "Reduce debt-to-income exposure before taking additional credit."
            );
        }

        if (
            utilization.rawValue !== null &&
            utilization.rawValue > 70
        ) {
            recommendations.push(
                "Reduce existing loan utilization before requesting additional credit."
            );
        }

        if (
            factors.accountAge
                .normalizedScore < 50
        ) {
            recommendations.push(
                "Establish a longer and more stable financial history."
            );
        }

        if (
            fraud.reasonCode ===
            "FRAUD_RISK"
        ) {
            recommendations.push(
                "Complete enhanced fraud and identity verification before credit approval."
            );
        }

        if (
            fraud.reasonCode ===
            "SANCTIONS_MATCH"
        ) {
            recommendations.push(
                "Refer the customer to Compliance for sanctions review."
            );
        }

        switch (
            riskLevel
        ) {
            case "LOW":
                recommendations.push(
                    "Customer may qualify for standard or premium credit products subject to underwriting policy."
                );
                break;

            case "MEDIUM":
                recommendations.push(
                    "Consider standard credit products subject to affordability and exposure limits."
                );
                break;

            case "HIGH":
                recommendations.push(
                    "Require manual underwriting review before credit approval."
                );
                break;

            case "CRITICAL":
                recommendations.push(
                    "Credit approval should not proceed without documented senior underwriting review."
                );
                break;

            case "SEVERE":
                recommendations.push(
                    "Do not approve additional credit until material risk factors are resolved."
                );
                break;

            default:
                break;
        }

        if (
            decision.action ===
            "BLOCK"
        ) {
            recommendations.push(
                "Block credit workflow pending required compliance or fraud disposition."
            );
        }

        return [
            ...new Set(
                recommendations
            ),
        ];
    }

    /**
     * ========================================================================
     * RISK PROFILE PERSISTENCE
     * ========================================================================
     */

    async persistRiskProfile(
        user,
        financialData,
        riskFlags,
        result
    ) {
        const query = {
            userId:
                user.id,
        };

        /**
         * Tenant isolation.
         *
         * If tenantId exists, it becomes part of the persistence query.
         */

        if (
            user.tenantId
        ) {
            query.tenantId =
                user.tenantId;
        }

        await RiskProfile.updateOne(
            query,
            {
                $set: {
                    userId:
                        user.id,

                    tenantId:
                        user.tenantId,

                    creditScore:
                        result.creditScore,

                    riskLevel:
                        result.riskLevel,

                    decision:
                        result.decision,

                    factors:
                        result.factors,

                    recommendations:
                        result.recommendations,

                    financialData,

                    riskFlags,

                    scoringVersion:
                        result.scoringVersion,

                    lastScoreId:
                        result.scoreId,

                    updatedAt:
                        new Date(),
                },

                $setOnInsert: {
                    createdAt:
                        new Date(),
                },
            },
            {
                upsert:
                    true,
            }
        );
    }

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    async auditScore(
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
                    "CREDIT_SCORE_COMPLETED",

                service:
                    this.serviceName,

                scoreId:
                    result.scoreId,

                userId:
                    result.userId,

                tenantId:
                    result.tenantId,

                creditScore:
                    result.creditScore,

                riskLevel:
                    result.riskLevel,

                action:
                    result.decision
                        .action,

                reasonCode:
                    result.decision
                        .reasonCode,

                scoringVersion:
                    result.scoringVersion,

                timestamp:
                    result.timestamp,
            });
        }

        return true;
    }

    /**
     * ========================================================================
     * SCORE EXPLANATION
     * ========================================================================
     */

    explainScore(
        result
    ) {
        if (
            !result ||
            !result.factors
        ) {
            throw new Error(
                "Valid credit scoring result required."
            );
        }

        return Object.values(
            result.factors
        )
            .map(
                (factor) => ({
                    factor:
                        factor.factor,

                    rawValue:
                        factor.rawValue,

                    normalizedScore:
                        factor.normalizedScore,

                    weightedContribution:
                        factor.weightedContribution,

                    status:
                        factor.status,

                    reasonCode:
                        factor.reasonCode ||
                        null,
                })
            );
    }

    /**
     * ========================================================================
     * ERROR FACTORY
     * ========================================================================
     */

    createScoringError(
        originalError,
        scoreId
    ) {
        const error =
            new Error(
                `Credit scoring failed: ${originalError.message}`
            );

        error.code =
            "CREDIT_SCORING_FAILED";

        error.scoreId =
            scoreId;

        error.service =
            this.serviceName;

        error.cause =
            originalError;

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
                        error?.message,

                    stack:
                        error?.stack,

                    service:
                        this.serviceName,

                    ...metadata,
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
 * Preserves compatibility with:
 *
 * const CreditScoringService =
 *     require("./CreditScoringService");
 *
 * CreditScoringService.scoreCustomer(...)
 *
 * ============================================================================
 */

module.exports =
    new CreditScoringService();

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
 * - Alternative scoring models
 * ============================================================================
 */

module.exports.CreditScoringService =
    CreditScoringService;

module.exports.DEFAULT_CREDIT_SCORING_CONFIG =
    DEFAULT_CONFIG;