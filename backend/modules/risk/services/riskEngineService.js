"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Risk Engine Service
 * ============================================================================
 * Production Grade Risk Assessment Engine
 * Version: 3.0.0
 * ============================================================================
 *
 * Purpose
 * -------
 * Centralized member risk assessment and lending decision engine.
 *
 * Responsibilities
 * ----------------
 * - Multi-factor member risk scoring
 * - Deterministic risk classification
 * - Credit history analysis
 * - Repayment behaviour analysis
 * - Indebtedness analysis
 * - Savings behaviour analysis
 * - KYC / AML compliance risk
 * - Fraud signal analysis
 * - Transaction behaviour analysis
 * - Explainable risk recommendations
 * - Loan eligibility decisioning
 * - Tenant-aware assessment validation
 * - Correlation / assessment identifiers
 * - Safe numeric normalization
 * - Decision safeguards
 * - Production-grade error handling
 *
 * Design Principles
 * -----------------
 * - No direct mutation of member records
 * - No financial balance mutation
 * - Deterministic calculations
 * - Fail closed for invalid critical inputs
 * - Scores normalized to 0-100
 * - Higher score = higher risk
 * - Financial decisions remain explainable
 * - Existing public API preserved
 * ============================================================================
 */

const crypto = require("crypto");

class RiskEngineService {
    constructor() {
        this.serviceName = "RiskEngineService";
        this.version = "3.0.0";

        this.config = Object.freeze({
            riskBands: Object.freeze({
                LOW: Object.freeze({
                    min: 0,
                    max: 29,
                }),
                MEDIUM: Object.freeze({
                    min: 30,
                    max: 59,
                }),
                HIGH: Object.freeze({
                    min: 60,
                    max: 79,
                }),
                CRITICAL: Object.freeze({
                    min: 80,
                    max: 100,
                }),
            }),

            /**
             * Component weights must total 100.
             */
            weights: Object.freeze({
                creditHistory: 25,
                repaymentBehaviour: 20,
                indebtedness: 15,
                savingsPattern: 10,
                kycCompliance: 10,
                fraudIndicators: 10,
                transactionBehaviour: 10,
            }),

            /**
             * Lending policy.
             */
            lending: Object.freeze({
                LOW: Object.freeze({
                    approvalAllowed: true,
                    exposureMultiplier: 1.0,
                }),

                MEDIUM: Object.freeze({
                    approvalAllowed: true,
                    exposureMultiplier: 0.75,
                }),

                HIGH: Object.freeze({
                    approvalAllowed: false,
                    exposureMultiplier: 0,
                }),

                CRITICAL: Object.freeze({
                    approvalAllowed: false,
                    exposureMultiplier: 0,
                }),
            }),

            /**
             * Hard-stop risk controls.
             *
             * These signals must not be overridden by a favourable
             * aggregate score.
             */
            hardStops: Object.freeze({
                suspectedIdentityFraud: true,
                sanctionsMatch: true,
                confirmedFraud: true,
            }),

            /**
             * Numeric protection.
             */
            limits: Object.freeze({
                maxLoanAmount: Number.MAX_SAFE_INTEGER,
                maxIncome: Number.MAX_SAFE_INTEGER,
                maxDebt: Number.MAX_SAFE_INTEGER,
                maxTransactions: 1000000,
            }),
        });

        this.validateConfiguration();
    }

    /**
     * =========================================================================
     * CONFIGURATION VALIDATION
     * =========================================================================
     */

    validateConfiguration() {
        const totalWeight = Object.values(this.config.weights).reduce(
            (sum, weight) => sum + weight,
            0
        );

        if (totalWeight !== 100) {
            throw new Error(
                `Risk engine configuration invalid: weights must total 100. Current total: ${totalWeight}`
            );
        }
    }

    /**
     * =========================================================================
     * MAIN RISK ASSESSMENT ENTRY POINT
     * =========================================================================
     *
     * @param {Object} member
     * @returns {Promise<Object>}
     */
    async assessMemberRisk(member) {
        const assessmentId = crypto.randomUUID();
        const assessedAt = new Date();

        try {
            this.validateMember(member);

            const scores = {
                creditHistory: this.evaluateCreditHistory(member),

                repaymentBehaviour:
                    this.evaluateRepaymentBehaviour(member),

                indebtedness:
                    this.evaluateIndebtedness(member),

                savingsPattern:
                    this.evaluateSavingsPattern(member),

                kycCompliance:
                    this.evaluateKYCCompliance(member),

                fraudIndicators:
                    this.evaluateFraudRisk(member),

                transactionBehaviour:
                    this.evaluateTransactionBehaviour(member),
            };

            const weightedScore =
                this.calculateWeightedRiskScore(scores);

            const hardStop = this.detectHardStopRisk(member);

            const riskScore = hardStop.triggered
                ? 100
                : weightedScore;

            const classification =
                this.classifyRisk(riskScore);

            const recommendations =
                this.generateRecommendations(
                    classification,
                    scores,
                    member,
                    hardStop
                );

            return {
                success: true,

                service: this.serviceName,
                version: this.version,

                assessmentId,

                memberId: this.extractMemberId(member),
                tenantId: member.tenantId || null,

                riskScore,

                classification,

                componentScores: scores,

                hardStop,

                recommendations,

                metadata: {
                    scoringVersion: this.version,
                    deterministic: true,
                    assessedAt: assessedAt.toISOString(),
                },

                timestamp: assessedAt.toISOString(),
            };
        } catch (error) {
            return this.buildErrorResponse(
                error,
                assessmentId,
                member
            );
        }
    }

    /**
     * =========================================================================
     * MEMBER VALIDATION
     * =========================================================================
     */

    validateMember(member) {
        if (!member || typeof member !== "object") {
            throw new Error("Member data is required");
        }

        if (
            member.tenantId !== undefined &&
            member.tenantId !== null &&
            String(member.tenantId).trim() === ""
        ) {
            throw new Error("Invalid tenantId");
        }
    }

    /**
     * =========================================================================
     * CREDIT HISTORY SCORE
     * =========================================================================
     *
     * Higher score = higher risk.
     */

    evaluateCreditHistory(member) {
        const history = member.creditHistory;

        if (!history || typeof history !== "object") {
            return 80;
        }

        const defaults = this.toSafeNumber(
            history.defaults,
            0
        );

        const latePayments = this.toSafeNumber(
            history.latePayments,
            0
        );

        const writeOffs = this.toSafeNumber(
            history.writeOffs,
            0
        );

        const restructurings = this.toSafeNumber(
            history.restructurings,
            0
        );

        let score = 0;

        score += defaults * 25;
        score += latePayments * 4;
        score += writeOffs * 30;
        score += restructurings * 10;

        return this.clampScore(score);
    }

    /**
     * =========================================================================
     * LOAN REPAYMENT BEHAVIOUR
     * =========================================================================
     */

    evaluateRepaymentBehaviour(member) {
        const repaymentRate = this.clampPercentage(
            this.toSafeNumber(
                member.repaymentRate,
                100
            )
        );

        if (repaymentRate >= 95) {
            return 10;
        }

        if (repaymentRate >= 85) {
            return 30;
        }

        if (repaymentRate >= 70) {
            return 60;
        }

        if (repaymentRate >= 50) {
            return 80;
        }

        return 95;
    }

    /**
     * =========================================================================
     * DEBT EXPOSURE ANALYSIS
     * =========================================================================
     */

    evaluateIndebtedness(member) {
        const monthlyIncome = this.toSafeNumber(
            member.monthlyIncome,
            0
        );

        const activeDebt = this.toSafeNumber(
            member.activeDebt,
            0
        );

        /**
         * No verified income while debt exists is treated
         * conservatively.
         */
        if (monthlyIncome <= 0) {
            return activeDebt > 0 ? 90 : 50;
        }

        const ratio =
            (activeDebt / monthlyIncome) * 100;

        if (ratio < 30) {
            return 10;
        }

        if (ratio < 50) {
            return 30;
        }

        if (ratio < 70) {
            return 60;
        }

        if (ratio < 100) {
            return 80;
        }

        return 95;
    }

    /**
     * =========================================================================
     * SAVINGS BEHAVIOUR
     * =========================================================================
     */

    evaluateSavingsPattern(member) {
        const consistency = this.clampPercentage(
            this.toSafeNumber(
                member.savingsConsistency,
                0
            )
        );

        if (consistency >= 90) {
            return 10;
        }

        if (consistency >= 70) {
            return 30;
        }

        if (consistency >= 50) {
            return 60;
        }

        if (consistency >= 30) {
            return 75;
        }

        return 85;
    }

    /**
     * =========================================================================
     * KYC / AML COMPLIANCE RISK
     * =========================================================================
     */

    evaluateKYCCompliance(member) {
        let score = 0;

        if (!member.kycVerified) {
            score += 30;
        }

        if (!member.nationalIdVerified) {
            score += 20;
        }

        if (!member.addressVerified) {
            score += 15;
        }

        if (!member.selfieVerified) {
            score += 15;
        }

        if (member.pepFlag) {
            score += 20;
        }

        if (member.sanctionsMatch) {
            score += 100;
        }

        return this.clampScore(score);
    }

    /**
     * =========================================================================
     * FRAUD DETECTION SIGNALS
     * =========================================================================
     */

    evaluateFraudRisk(member) {
        let score = 0;

        if (member.deviceMismatch) {
            score += 20;
        }

        if (member.multipleAccounts) {
            score += 25;
        }

        if (member.suspectedIdentityFraud) {
            score += 40;
        }

        if (member.confirmedFraud) {
            score += 100;
        }

        if (member.velocityViolation) {
            score += 15;
        }

        if (member.beneficiaryMismatch) {
            score += 10;
        }

        if (member.accountTakeoverRisk) {
            score += 30;
        }

        return this.clampScore(score);
    }

    /**
     * =========================================================================
     * TRANSACTION BEHAVIOUR
     * =========================================================================
     */

    evaluateTransactionBehaviour(member) {
        const suspiciousTransactions =
            this.toSafeNumber(
                member.suspiciousTransactions,
                0
            );

        const chargebacks =
            this.toSafeNumber(
                member.chargebacks,
                0
            );

        const structuringEvents =
            this.toSafeNumber(
                member.structuringEvents,
                0
            );

        let score = 0;

        score += suspiciousTransactions * 8;
        score += chargebacks * 10;
        score += structuringEvents * 20;

        if (member.unusualTransactionVelocity) {
            score += 20;
        }

        return this.clampScore(score);
    }

    /**
     * =========================================================================
     * WEIGHTED RISK CALCULATION
     * =========================================================================
     */

    calculateWeightedRiskScore(scores) {
        if (!scores || typeof scores !== "object") {
            throw new Error("Risk component scores are required");
        }

        const weightedScore =
            (this.normalizeComponentScore(
                scores.creditHistory
            ) *
                this.config.weights.creditHistory +

                this.normalizeComponentScore(
                    scores.repaymentBehaviour
                ) *
                    this.config.weights.repaymentBehaviour +

                this.normalizeComponentScore(
                    scores.indebtedness
                ) *
                    this.config.weights.indebtedness +

                this.normalizeComponentScore(
                    scores.savingsPattern
                ) *
                    this.config.weights.savingsPattern +

                this.normalizeComponentScore(
                    scores.kycCompliance
                ) *
                    this.config.weights.kycCompliance +

                this.normalizeComponentScore(
                    scores.fraudIndicators
                ) *
                    this.config.weights.fraudIndicators +

                this.normalizeComponentScore(
                    scores.transactionBehaviour
                ) *
                    this.config.weights.transactionBehaviour) /
            100;

        return Number(
            this.clampScore(weightedScore).toFixed(2)
        );
    }

    /**
     * =========================================================================
     * HARD STOP RISK
     * =========================================================================
     *
     * Hard-stop signals override the aggregate score.
     */

    detectHardStopRisk(member) {
        const reasons = [];

        if (
            this.config.hardStops.suspectedIdentityFraud &&
            member.suspectedIdentityFraud
        ) {
            reasons.push("SUSPECTED_IDENTITY_FRAUD");
        }

        if (
            this.config.hardStops.sanctionsMatch &&
            member.sanctionsMatch
        ) {
            reasons.push("SANCTIONS_MATCH");
        }

        if (
            this.config.hardStops.confirmedFraud &&
            member.confirmedFraud
        ) {
            reasons.push("CONFIRMED_FRAUD");
        }

        return {
            triggered: reasons.length > 0,
            reasons,
        };
    }

    /**
     * =========================================================================
     * RISK CLASSIFICATION
     * =========================================================================
     */

    classifyRisk(score) {
        const normalizedScore =
            this.clampScore(
                this.toSafeNumber(score, 0)
            );

        if (
            normalizedScore >=
            this.config.riskBands.CRITICAL.min
        ) {
            return "CRITICAL";
        }

        if (
            normalizedScore >=
            this.config.riskBands.HIGH.min
        ) {
            return "HIGH";
        }

        if (
            normalizedScore >=
            this.config.riskBands.MEDIUM.min
        ) {
            return "MEDIUM";
        }

        return "LOW";
    }

    /**
     * =========================================================================
     * RISK RECOMMENDATIONS
     * =========================================================================
     */

    generateRecommendations(
        category,
        scores = {},
        member = {},
        hardStop = {}
    ) {
        const recommendations = [];

        switch (category) {
            case "LOW":
                recommendations.push(
                    "Eligible for standard lending products subject to normal credit policy."
                );
                break;

            case "MEDIUM":
                recommendations.push(
                    "Consider reduced loan exposure."
                );

                recommendations.push(
                    "Increase risk monitoring frequency."
                );
                break;

            case "HIGH":
                recommendations.push(
                    "Manual credit committee review required."
                );

                recommendations.push(
                    "Consider guarantor or additional security requirements."
                );

                recommendations.push(
                    "Enable enhanced transaction monitoring."
                );
                break;

            case "CRITICAL":
                recommendations.push(
                    "Reject automated credit approval."
                );

                recommendations.push(
                    "Escalate to Risk & Compliance."
                );

                recommendations.push(
                    "Conduct enhanced due diligence."
                );
                break;

            default:
                recommendations.push(
                    "Risk classification requires manual review."
                );
        }

        if (
            Number(scores.fraudIndicators || 0) > 50
        ) {
            recommendations.push(
                "Fraud investigation required."
            );
        }

        if (
            Number(scores.kycCompliance || 0) > 50
        ) {
            recommendations.push(
                "Complete outstanding KYC / AML verification."
            );
        }

        if (
            Number(scores.indebtedness || 0) >= 60
        ) {
            recommendations.push(
                "Review debt exposure before extending additional credit."
            );
        }

        if (
            Number(scores.repaymentBehaviour || 0) >= 60
        ) {
            recommendations.push(
                "Review repayment performance and delinquency history."
            );
        }

        if (
            hardStop &&
            hardStop.triggered
        ) {
            recommendations.push(
                "Automated lending approval is prohibited until the hard-stop issue is resolved."
            );
        }

        return [...new Set(recommendations)];
    }

    /**
     * =========================================================================
     * LOAN DECISIONING ENGINE
     * =========================================================================
     *
     * Existing API preserved:
     *
     * evaluateLoanEligibility(member, loanAmount)
     */

    async evaluateLoanEligibility(member, loanAmount) {
        const risk = await this.assessMemberRisk(member);

        if (!risk.success) {
            return risk;
        }

        const requestedAmount =
            this.validateLoanAmount(loanAmount);

        const decision = {
            approved: false,
            maxEligibleAmount: 0,
            requestedAmount,
            reason: [],
        };

        /**
         * Hard-stop controls always override normal
         * classification-based lending.
         */
        if (
            risk.hardStop &&
            risk.hardStop.triggered
        ) {
            decision.approved = false;

            decision.reason.push(
                "Hard-stop compliance or fraud condition detected."
            );

            decision.reason.push(
                ...risk.hardStop.reasons
            );

            return {
                ...risk,
                loanDecision: decision,
            };
        }

        const policy =
            this.config.lending[
                risk.classification
            ];

        if (!policy) {
            decision.reason.push(
                "No lending policy configured for risk classification."
            );

            return {
                ...risk,
                loanDecision: decision,
            };
        }

        if (!policy.approvalAllowed) {
            decision.approved = false;

            if (risk.classification === "HIGH") {
                decision.reason.push(
                    "Manual credit review required."
                );
            }

            if (risk.classification === "CRITICAL") {
                decision.reason.push(
                    "Risk profile exceeds automated lending threshold."
                );
            }

            return {
                ...risk,
                loanDecision: decision,
            };
        }

        const maximumEligibleAmount =
            requestedAmount *
            policy.exposureMultiplier;

        decision.approved =
            maximumEligibleAmount > 0;

        decision.maxEligibleAmount =
            this.roundFinancialAmount(
                maximumEligibleAmount
            );

        if (
            risk.classification === "MEDIUM"
        ) {
            decision.reason.push(
                "Moderate risk profile."
            );
        }

        if (
            risk.classification === "LOW"
        ) {
            decision.reason.push(
                "Risk profile is within standard automated lending threshold."
            );
        }

        return {
            ...risk,
            loanDecision: decision,
        };
    }

    /**
     * =========================================================================
     * ASSESSMENT SUMMARY
     * =========================================================================
     *
     * Useful for dashboards, audit trails and downstream orchestration.
     */

    buildAssessmentSummary(riskAssessment) {
        if (
            !riskAssessment ||
            !riskAssessment.success
        ) {
            return null;
        }

        return {
            assessmentId:
                riskAssessment.assessmentId,

            memberId:
                riskAssessment.memberId,

            tenantId:
                riskAssessment.tenantId,

            riskScore:
                riskAssessment.riskScore,

            classification:
                riskAssessment.classification,

            hardStop:
                riskAssessment.hardStop,

            assessedAt:
                riskAssessment.timestamp,

            scoringVersion:
                riskAssessment.metadata?.scoringVersion,
        };
    }

    /**
     * =========================================================================
     * COMPONENT EXPLANATION
     * =========================================================================
     *
     * Produces a human-readable explanation of the major
     * risk contributors.
     */

    explainRisk(riskAssessment) {
        if (
            !riskAssessment ||
            !riskAssessment.componentScores
        ) {
            return [];
        }

        const labels = {
            creditHistory: "Credit history",
            repaymentBehaviour: "Repayment behaviour",
            indebtedness: "Debt exposure",
            savingsPattern: "Savings behaviour",
            kycCompliance: "KYC / AML compliance",
            fraudIndicators: "Fraud indicators",
            transactionBehaviour: "Transaction behaviour",
        };

        return Object.entries(
            riskAssessment.componentScores
        )
            .map(([key, score]) => ({
                factor: key,
                label: labels[key] || key,
                score: this.clampScore(score),
                weight:
                    this.config.weights[key] || 0,
                contribution: Number(
                    (
                        (this.clampScore(score) *
                            (this.config.weights[key] ||
                                0)) /
                        100
                    ).toFixed(2)
                ),
            }))
            .sort(
                (a, b) =>
                    b.contribution -
                    a.contribution
            );
    }

    /**
     * =========================================================================
     * MEMBER ID EXTRACTION
     * =========================================================================
     */

    extractMemberId(member) {
        if (!member) {
            return null;
        }

        return (
            member.memberId ||
            member.userId ||
            member._id ||
            member.id ||
            null
        );
    }

    /**
     * =========================================================================
     * SAFE NUMERIC CONVERSION
     * =========================================================================
     */

    toSafeNumber(value, fallback = 0) {
        const number =
            typeof value === "number"
                ? value
                : Number(value);

        if (
            !Number.isFinite(number) ||
            Number.isNaN(number)
        ) {
            return fallback;
        }

        if (number < 0) {
            return 0;
        }

        return Math.min(
            number,
            Number.MAX_SAFE_INTEGER
        );
    }

    /**
     * =========================================================================
     * SCORE NORMALIZATION
     * =========================================================================
     */

    normalizeComponentScore(score) {
        return this.clampScore(
            this.toSafeNumber(score, 0)
        );
    }

    /**
     * =========================================================================
     * SCORE CLAMP
     * =========================================================================
     */

    clampScore(score) {
        const numericScore =
            this.toSafeNumber(score, 0);

        return Math.max(
            0,
            Math.min(100, numericScore)
        );
    }

    /**
     * =========================================================================
     * PERCENTAGE NORMALIZATION
     * =========================================================================
     */

    clampPercentage(value) {
        const percentage =
            this.toSafeNumber(value, 0);

        return Math.max(
            0,
            Math.min(100, percentage)
        );
    }

    /**
     * =========================================================================
     * LOAN AMOUNT VALIDATION
     * =========================================================================
     */

    validateLoanAmount(amount) {
        const numericAmount =
            this.toSafeNumber(amount, 0);

        if (numericAmount <= 0) {
            throw new Error(
                "Loan amount must be greater than zero"
            );
        }

        if (
            numericAmount >
            this.config.limits.maxLoanAmount
        ) {
            throw new Error(
                "Loan amount exceeds configured risk engine limit"
            );
        }

        return numericAmount;
    }

    /**
     * =========================================================================
     * FINANCIAL ROUNDING
     * =========================================================================
     */

    roundFinancialAmount(amount) {
        const numericAmount =
            this.toSafeNumber(amount, 0);

        return Number(
            numericAmount.toFixed(2)
        );
    }

    /**
     * =========================================================================
     * ERROR RESPONSE
     * =========================================================================
     */

    buildErrorResponse(
        error,
        assessmentId,
        member
    ) {
        const safeError =
            error instanceof Error
                ? error
                : new Error(
                      String(error)
                  );

        /**
         * Do not expose stack traces or internal
         * implementation details to callers.
         */
        return {
            success: false,

            service: this.serviceName,
            version: this.version,

            assessmentId,

            memberId:
                this.extractMemberId(member),

            tenantId:
                member?.tenantId || null,

            error: safeError.message,

            timestamp:
                new Date().toISOString(),
        };
    }
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 */

module.exports = new RiskEngineService();