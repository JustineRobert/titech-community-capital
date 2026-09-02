"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Risk Orchestration Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/RiskOrchestrationService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Central enterprise risk decision orchestration layer.
 *
 * This service coordinates:
 *
 *   - AML / CFT screening
 *   - Fraud detection
 *   - Behavioral analysis
 *   - Device fingerprint risk
 *   - Credit risk
 *   - Risk alerts
 *   - Compliance case management
 *   - Risk decision aggregation
 *   - Hard-rule overrides
 *   - Transaction risk disposition
 *   - Audit metadata
 *   - Idempotency
 *   - Risk configuration versioning
 *   - Enterprise observability hooks
 *
 * Architecture:
 *
 *                    Transaction / Action
 *                            |
 *                            v
 *                RiskOrchestrationService
 *                            |
 *          +-----------------+------------------+
 *          |        |         |        |        |
 *          v        v         v        v        v
 *        AML     Fraud    Behavioral Device   Credit
 *          |        |         |        |        |
 *          +--------+---------+--------+--------+
 *                            |
 *                            v
 *                    Risk Aggregation
 *                            |
 *                            v
 *                    Decision Engine
 *                            |
 *             +--------------+--------------+
 *             |              |              |
 *            ALLOW          HOLD           BLOCK
 *             |              |              |
 *             v              v              v
 *        Transaction     Compliance      Transaction
 *        Workflow       Investigation   Workflow Stop
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This service does NOT directly modify:
 *
 *   - Ledger balances
 *   - Account balances
 *   - Journal entries
 *   - Payment settlement state
 *
 * A BLOCK / HOLD / MANUAL_REVIEW decision must be enforced by the parent
 * transaction/payment/ledger orchestration workflow.
 *
 * Design Principles:
 * ----------------------------------------------------------------------------
 * - Fail closed for critical compliance infrastructure failures.
 * - Never allow a weaker signal to override a hard compliance stop.
 * - Preserve individual engine results for explainability.
 * - Never silently swallow provider/service failures.
 * - Support dependency injection and testing.
 * - Preserve tenant isolation.
 * - Support deterministic idempotency.
 * - Maintain auditability.
 * - Keep risk orchestration separate from financial posting.
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * DEFAULT CONFIGURATION
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    version: "2.0.0",

    /**
     * Engine execution.
     */
    execution: Object.freeze({
        timeoutMs: 10000,
        failClosed: true,
        parallelExecution: true,
    }),

    /**
     * Risk aggregation weights.
     *
     * These represent the contribution of each risk domain to the composite
     * score. The sum MUST equal 100.
     */
    weights: Object.freeze({
        aml: 30,
        fraud: 25,
        behavioral: 15,
        device: 10,
        credit: 20,
    }),

    /**
     * Composite risk thresholds.
     */
    thresholds: Object.freeze({
        LOW: 25,
        MEDIUM: 50,
        HIGH: 75,
        CRITICAL: 90,
    }),

    /**
     * Decision policy.
     */
    decisions: Object.freeze({
        LOW_ACTION: "ALLOW",
        MEDIUM_ACTION: "MONITOR",
        HIGH_ACTION: "HOLD",
        CRITICAL_ACTION: "BLOCK",
    }),

    /**
     * Hard compliance overrides.
     */
    hardRules: Object.freeze({
        sanctionsMatch: true,
        confirmedFraud: true,
        accountTakeoverCritical: true,
        criticalAML: true,
        criticalDeviceRisk: true,
    }),

    /**
     * Case creation policy.
     */
    caseManagement: Object.freeze({
        createCaseForHigh: true,
        createCaseForCritical: true,
        createCaseForMedium: false,
        autoAssign: false,
    }),

    /**
     * Alert policy.
     */
    alerts: Object.freeze({
        createForMedium: true,
        createForHigh: true,
        createForCritical: true,
    }),

    /**
     * Credit policy.
     */
    credit: Object.freeze({
        enabled: true,
        useCreditScoreInTransactions: true,
    }),

    /**
     * Idempotency.
     */
    idempotency: Object.freeze({
        enabled: true,
        requireKey: false,
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

function now() {
    return new Date();
}

/**
 * ============================================================================
 * RISK ORCHESTRATION SERVICE
 * ============================================================================
 */

class RiskOrchestrationService {

    constructor(options = {}) {

        this.config = this.buildConfig(
            options.config || {}
        );

        /**
         * Enterprise dependencies are injected so this service does not
         * introduce hard coupling to individual risk engines.
         */
        this.dependencies = {

            amlService:
                options.amlService || null,

            fraudService:
                options.fraudService || null,

            behavioralService:
                options.behavioralService || null,

            deviceFingerprintService:
                options.deviceFingerprintService || null,

            creditScoringService:
                options.creditScoringService || null,

            caseManagementService:
                options.caseManagementService || null,

            riskAlertService:
                options.riskAlertService || null,

            auditService:
                options.auditService || null,

            logger:
                options.logger || console,

            metrics:
                options.metrics || null,

            idempotencyStore:
                options.idempotencyStore || null,

            eventPublisher:
                options.eventPublisher || null,
        };

        this.serviceName =
            "RiskOrchestrationService";

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

            execution: {
                ...DEFAULT_CONFIG.execution,
                ...(customConfig.execution || {}),
            },

            weights: {
                ...DEFAULT_CONFIG.weights,
                ...(customConfig.weights || {}),
            },

            thresholds: {
                ...DEFAULT_CONFIG.thresholds,
                ...(customConfig.thresholds || {}),
            },

            decisions: {
                ...DEFAULT_CONFIG.decisions,
                ...(customConfig.decisions || {}),
            },

            hardRules: {
                ...DEFAULT_CONFIG.hardRules,
                ...(customConfig.hardRules || {}),
            },

            caseManagement: {
                ...DEFAULT_CONFIG.caseManagement,
                ...(customConfig.caseManagement || {}),
            },

            alerts: {
                ...DEFAULT_CONFIG.alerts,
                ...(customConfig.alerts || {}),
            },

            credit: {
                ...DEFAULT_CONFIG.credit,
                ...(customConfig.credit || {}),
            },

            idempotency: {
                ...DEFAULT_CONFIG.idempotency,
                ...(customConfig.idempotency || {}),
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

        const weights =
            Object.values(
                config.weights
            );

        const totalWeight =
            weights.reduce(
                (sum, value) =>
                    sum + Number(value || 0),
                0
            );

        if (
            Math.abs(
                totalWeight - 100
            ) > 0.000001
        ) {
            throw new Error(
                `Risk orchestration weights must total 100. Current total: ${totalWeight}`
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
                "Invalid risk orchestration thresholds."
            );
        }

        if (
            !Number.isFinite(
                Number(config.execution.timeoutMs)
            ) ||
            Number(config.execution.timeoutMs) <= 0
        ) {
            throw new Error(
                "Risk orchestration execution timeout must be positive."
            );
        }
    }

    /**
     * ========================================================================
     * MAIN ENTRYPOINT
     * ========================================================================
     *
     * Orchestrates all configured risk engines and produces one unified
     * enterprise risk decision.
     * ========================================================================
     */

    async orchestrate(
        transaction,
        customer,
        context = {}
    ) {

        const orchestrationId =
            generateId("RISK");

        const startedAt =
            Date.now();

        this.validateInput(
            transaction,
            customer
        );

        const normalizedTransaction =
            this.normalizeTransaction(
                transaction
            );

        const normalizedCustomer =
            this.normalizeCustomer(
                customer
            );

        const tenantId =
            context.tenantId ||
            normalizedTransaction.tenantId ||
            normalizedCustomer?.tenantId ||
            null;

        const idempotencyKey =
            this.resolveIdempotencyKey(
                normalizedTransaction,
                normalizedCustomer,
                context
            );

        try {

            /**
             * ---------------------------------------------------------------
             * IDEMPOTENCY CHECK
             * ---------------------------------------------------------------
             */

            const cachedResult =
                await this.getIdempotentResult(
                    idempotencyKey
                );

            if (cachedResult) {

                return {
                    ...cachedResult,

                    metadata: {
                        ...(cachedResult.metadata || {}),
                        idempotentReplay: true,
                    },
                };
            }

            /**
             * ---------------------------------------------------------------
             * ENGINE CONTEXT
             * ---------------------------------------------------------------
             */

            const engineContext = {
                orchestrationId,

                tenantId,

                transaction:
                    normalizedTransaction,

                customer:
                    normalizedCustomer,

                context,
            };

            /**
             * ---------------------------------------------------------------
             * RISK ENGINE EXECUTION
             * ---------------------------------------------------------------
             */

            const engineResults =
                await this.executeRiskEngines(
                    engineContext
                );

            /**
             * ---------------------------------------------------------------
             * COMPOSITE SCORE
             * ---------------------------------------------------------------
             */

            const compositeScore =
                this.calculateCompositeScore(
                    engineResults
                );

            /**
             * ---------------------------------------------------------------
             * RISK CLASSIFICATION
             * ---------------------------------------------------------------
             */

            const riskLevel =
                this.classifyRisk(
                    compositeScore
                );

            /**
             * ---------------------------------------------------------------
             * HARD-RULE EVALUATION
             * ---------------------------------------------------------------
             */

            const overrides =
                this.evaluateHardRules(
                    engineResults
                );

            /**
             * ---------------------------------------------------------------
             * FINAL DECISION
             * ---------------------------------------------------------------
             */

            const decision =
                this.generateDecision(
                    compositeScore,
                    riskLevel,
                    overrides,
                    engineResults
                );

            /**
             * ---------------------------------------------------------------
             * RECOMMENDATIONS
             * ---------------------------------------------------------------
             */

            const recommendations =
                this.generateRecommendations(
                    riskLevel,
                    decision,
                    engineResults,
                    overrides
                );

            /**
             * ---------------------------------------------------------------
             * CASE / ALERT
             * ---------------------------------------------------------------
             */

            const caseResult =
                await this.handleCaseManagement(
                    normalizedTransaction,
                    normalizedCustomer,
                    {
                        orchestrationId,
                        tenantId,
                        compositeScore,
                        riskLevel,
                        decision,
                        engineResults,
                        recommendations,
                    }
                );

            /**
             * ---------------------------------------------------------------
             * FINAL RESULT
             * ---------------------------------------------------------------
             */

            const result = {

                success: true,

                orchestrationId,

                service:
                    this.serviceName,

                serviceVersion:
                    this.serviceVersion,

                tenantId,

                transactionId:
                    normalizedTransaction.id,

                customerId:
                    normalizedCustomer?.id || null,

                compositeScore,

                riskLevel,

                decision,

                overrides,

                engineResults,

                recommendations,

                case:
                    caseResult,

                metadata: {

                    executionDurationMs:
                        Date.now() - startedAt,

                    screeningStatus:
                        "COMPLETED",

                    decisionSource:
                        overrides.length > 0
                            ? "HARD_RULE_OVERRIDE"
                            : "COMPOSITE_RISK_SCORE",

                    financialPostingAllowed:
                        decision.financialPostingAllowed,

                    idempotencyKey:
                        idempotencyKey || null,

                    idempotentReplay:
                        false,

                    riskConfigurationVersion:
                        this.serviceVersion,

                    timestamp:
                        now().toISOString(),
                },
            };

            /**
             * ---------------------------------------------------------------
             * PERSIST RESULT
             * ---------------------------------------------------------------
             */

            await this.storeIdempotentResult(
                idempotencyKey,
                result
            );

            /**
             * ---------------------------------------------------------------
             * AUDIT
             * ---------------------------------------------------------------
             */

            await this.auditDecision(
                result
            );

            /**
             * ---------------------------------------------------------------
             * METRICS
             * ---------------------------------------------------------------
             */

            this.recordMetrics(
                result
            );

            /**
             * ---------------------------------------------------------------
             * EVENT
             * ---------------------------------------------------------------
             */

            await this.publishDecisionEvent(
                result
            );

            return result;

        } catch (error) {

            this.logError(
                "Risk orchestration failed",
                error,
                {
                    orchestrationId,
                    tenantId,
                    transactionId:
                        normalizedTransaction.id,
                    customerId:
                        normalizedCustomer?.id || null,
                }
            );

            /**
             * Critical compliance/risk infrastructure failure should not be
             * silently converted into ALLOW.
             */
            if (
                this.config.execution.failClosed
            ) {

                const failClosedResult =
                    this.createFailClosedDecision(
                        orchestrationId,
                        normalizedTransaction,
                        normalizedCustomer,
                        error
                    );

                await this.auditDecision(
                    failClosedResult
                );

                return failClosedResult;
            }

            throw this.createOrchestrationError(
                error,
                orchestrationId
            );
        }
    }

    /**
     * ========================================================================
     * COMPATIBILITY ENTRYPOINT
     * ========================================================================
     *
     * Allows callers to use:
     *
     *     riskService.analyzeTransaction(...)
     *
     * while keeping orchestrate() as the canonical API.
     * ========================================================================
     */

    async analyzeTransaction(
        transaction,
        customer,
        context = {}
    ) {

        return this.orchestrate(
            transaction,
            customer,
            context
        );
    }

    /**
     * ========================================================================
     * INPUT VALIDATION
     * ========================================================================
     */

    validateInput(
        transaction,
        customer
    ) {

        if (!transaction) {
            throw new Error(
                "Transaction is required for risk orchestration."
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

        if (!customer) {
            throw new Error(
                "Customer/member is required for risk orchestration."
            );
        }
    }

    /**
     * ========================================================================
     * NORMALIZATION
     * ========================================================================
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
                ),
        };
    }

    normalizeCustomer(
        customer
    ) {

        if (!customer) {
            return null;
        }

        return {
            ...customer,

            id:
                customer.id ||
                customer._id?.toString() ||
                null,

            tenantId:
                customer.tenantId ||
                null,

            country:
                normalizeString(
                    customer.country
                ),
        };
    }

    /**
     * ========================================================================
     * RISK ENGINE EXECUTION
     * ========================================================================
     */

    async executeRiskEngines(
        context
    ) {

        const {
            transaction,
            customer,
        } = context;

        const executions = {

            aml:
                () =>
                    this.executeAML(
                        transaction,
                        customer,
                        context
                    ),

            fraud:
                () =>
                    this.executeFraud(
                        transaction,
                        customer,
                        context
                    ),

            behavioral:
                () =>
                    this.executeBehavioral(
                        customer,
                        context
                    ),

            device:
                () =>
                    this.executeDevice(
                        customer,
                        transaction,
                        context
                    ),

            credit:
                () =>
                    this.executeCredit(
                        customer,
                        transaction,
                        context
                    ),
        };

        if (
            !this.config.execution.parallelExecution
        ) {

            const results = {};

            for (
                const [name, execute]
                of Object.entries(executions)
            ) {

                results[name] =
                    await this.executeSafely(
                        name,
                        execute
                    );
            }

            return results;
        }

        const entries =
            Object.entries(
                executions
            );

        const settled =
            await Promise.all(
                entries.map(
                    async ([name, execute]) => [
                        name,
                        await this.executeSafely(
                            name,
                            execute
                        ),
                    ]
                )
            );

        return Object.fromEntries(
            settled
        );
    }

    /**
     * ========================================================================
     * SAFE ENGINE EXECUTION
     * ========================================================================
     */

    async executeSafely(
        engineName,
        executor
    ) {

        try {

            return await this.withTimeout(
                executor(),
                this.config.execution.timeoutMs,
                engineName
            );

        } catch (error) {

            this.logError(
                `Risk engine failed: ${engineName}`,
                error,
                {
                    engine:
                        engineName,
                }
            );

            if (
                this.config.execution.failClosed
            ) {

                throw this.createEngineFailure(
                    engineName,
                    error
                );
            }

            return {
                success: false,

                engine:
                    engineName,

                unavailable: true,

                riskScore: 100,

                error:
                    error.message,
            };
        }
    }

    /**
     * ========================================================================
     * AML ENGINE
     * ========================================================================
     */

    async executeAML(
        transaction,
        customer,
        context
    ) {

        const service =
            this.dependencies.amlService;

        if (
            !service ||
            typeof service.screenTransaction !==
                "function"
        ) {

            return {
                success: true,
                unavailable: true,
                riskScore: 0,
                riskLevel: "LOW",
                decision: {
                    action: "NOT_CONFIGURED",
                },
            };
        }

        const result =
            await service.screenTransaction(
                transaction,
                customer,
                context
            );

        return {
            success:
                result?.success !== false,

            riskScore:
                clamp(
                    result?.amlScore || 0
                ),

            riskLevel:
                result?.riskLevel || "LOW",

            decision:
                result?.decision || null,

            indicators:
                result?.indicators || {},

            recommendations:
                result?.recommendations || [],

            screeningId:
                result?.screeningId || null,
        };
    }

    /**
     * ========================================================================
     * FRAUD ENGINE
     * ========================================================================
     */

    async executeFraud(
        transaction,
        customer
    ) {

        const service =
            this.dependencies.fraudService;

        if (
            !service ||
            typeof service.analyzeTransaction !==
                "function"
        ) {

            return {
                success: true,
                unavailable: true,
                riskScore: 0,
                fraudLevel: "LOW",
                decision: null,
            };
        }

        const result =
            await service.analyzeTransaction(
                transaction,
                customer
            );

        return {
            success:
                result?.success !== false,

            riskScore:
                clamp(
                    result?.fraudScore || 0
                ),

            riskLevel:
                result?.fraudLevel || "LOW",

            decision:
                result?.decision || null,

            indicators:
                result?.indicators || {},

            recommendations:
                result?.recommendations || [],

            investigationId:
                result?.investigationId || null,
        };
    }

    /**
     * ========================================================================
     * BEHAVIORAL ENGINE
     * ========================================================================
     */

    async executeBehavioral(
        customer,
        context
    ) {

        const service =
            this.dependencies.behavioralService;

        if (
            !service ||
            typeof service.analyzeBehavior !==
                "function"
        ) {

            return {
                success: true,
                unavailable: true,
                riskScore: 0,
                decision: "NOT_CONFIGURED",
            };
        }

        const sessionData =
            context.context?.sessionData ||
            context.transaction?.sessionData ||
            {};

        const result =
            await service.analyzeBehavior(
                customer,
                sessionData
            );

        return {
            success: true,

            riskScore:
                clamp(
                    result?.riskScore || 0
                ),

            riskLevel:
                this.scoreToLevel(
                    result?.riskScore || 0
                ),

            decision:
                result?.decision || null,

            analysisId:
                result?.analysisId || null,
        };
    }

    /**
     * ========================================================================
     * DEVICE ENGINE
     * ========================================================================
     */

    async executeDevice(
        customer,
        transaction
    ) {

        const service =
            this.dependencies
                .deviceFingerprintService;

        if (
            !service ||
            typeof service.monitorDevice !==
                "function"
        ) {

            return {
                success: true,
                unavailable: true,
                riskScore: 0,
                decision: "NOT_CONFIGURED",
            };
        }

        const metadata =
            transaction.deviceMetadata ||
            transaction.device ||
            {};

        const result =
            await service.monitorDevice(
                customer,
                metadata
            );

        return {
            success: true,

            riskScore:
                clamp(
                    result?.riskScore || 0
                ),

            riskLevel:
                this.scoreToLevel(
                    result?.riskScore || 0
                ),

            decision:
                result?.decision || null,

            fingerprint:
                result?.fingerprint || null,
        };
    }

    /**
     * ========================================================================
     * CREDIT ENGINE
     * ========================================================================
     */

    async executeCredit(
        customer,
        transaction
    ) {

        if (
            !this.config.credit.enabled
        ) {

            return {
                success: true,
                unavailable: true,
                riskScore: 0,
                decision: "DISABLED",
            };
        }

        const service =
            this.dependencies
                .creditScoringService;

        if (
            !service ||
            typeof service.scoreCustomer !==
                "function"
        ) {

            return {
                success: true,
                unavailable: true,
                riskScore: 0,
                decision: "NOT_CONFIGURED",
            };
        }

        const financialData =
            transaction.financialData ||
            customer.financialData ||
            {};

        const riskFlags =
            transaction.riskFlags ||
            customer.riskFlags ||
            {};

        const result =
            await service.scoreCustomer(
                customer,
                financialData,
                riskFlags
            );

        /**
         * Credit score is inverse-risk:
         *
         * high credit score -> lower risk
         * low credit score  -> higher risk
         */

        const creditScore =
            Number(
                result?.creditScore || 300
            );

        const normalizedCreditRisk =
            clamp(
                100 -
                (
                    (
                        creditScore - 300
                    ) /
                    550
                ) *
                100
            );

        return {
            success: true,

            creditScore,

            riskScore:
                round(
                    normalizedCreditRisk
                ),

            riskLevel:
                result?.riskLevel ||
                this.scoreToLevel(
                    normalizedCreditRisk
                ),

            recommendations:
                result?.recommendations || [],
        };
    }

    /**
     * ========================================================================
     * COMPOSITE SCORE
     * ========================================================================
     */

    calculateCompositeScore(
        engineResults
    ) {

        const weightedScore =

            this.normalizeEngineScore(
                engineResults.aml
            ) *
            this.config.weights.aml +

            this.normalizeEngineScore(
                engineResults.fraud
            ) *
            this.config.weights.fraud +

            this.normalizeEngineScore(
                engineResults.behavioral
            ) *
            this.config.weights.behavioral +

            this.normalizeEngineScore(
                engineResults.device
            ) *
            this.config.weights.device +

            this.normalizeEngineScore(
                engineResults.credit
            ) *
            this.config.weights.credit;

        return round(
            clamp(
                weightedScore / 100
            )
        );
    }

    normalizeEngineScore(
        result
    ) {

        if (!result) {
            return 0;
        }

        return clamp(
            result.riskScore || 0
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
     * HARD-RULE ENGINE
     * ========================================================================
     */

    evaluateHardRules(
        engines
    ) {

        const overrides = [];

        const aml =
            engines.aml || {};

        const fraud =
            engines.fraud || {};

        const behavioral =
            engines.behavioral || {};

        const device =
            engines.device || {};

        /**
         * Sanctions.
         */
        if (
            this.config.hardRules.sanctionsMatch &&
            Number(
                aml.indicators?.sanctionsRisk
            ) >= 100
        ) {

            overrides.push({
                code:
                    "SANCTIONS_MATCH",

                severity:
                    "CRITICAL",

                action:
                    "BLOCK",

                source:
                    "AML",
            });
        }

        /**
         * Critical AML.
         */
        if (
            this.config.hardRules.criticalAML &&
            aml.riskLevel === "CRITICAL"
        ) {

            overrides.push({
                code:
                    "CRITICAL_AML_RISK",

                severity:
                    "CRITICAL",

                action:
                    "BLOCK",

                source:
                    "AML",
            });
        }

        /**
         * Confirmed fraud.
         */
        if (
            this.config.hardRules.confirmedFraud &&
            fraud.riskLevel === "CRITICAL"
        ) {

            overrides.push({
                code:
                    "CRITICAL_FRAUD_RISK",

                severity:
                    "CRITICAL",

                action:
                    "BLOCK",

                source:
                    "FRAUD",
            });
        }

        /**
         * Account takeover.
         */
        if (
            this.config.hardRules
                .accountTakeoverCritical &&
            Number(
                fraud.indicators
                    ?.accountTakeoverRisk
            ) >= 90
        ) {

            overrides.push({
                code:
                    "CRITICAL_ACCOUNT_TAKEOVER",

                severity:
                    "CRITICAL",

                action:
                    "BLOCK",

                source:
                    "FRAUD",
            });
        }

        /**
         * Device critical risk.
         */
        if (
            this.config.hardRules
                .criticalDeviceRisk &&
            Number(
                device.riskScore
            ) >= 90
        ) {

            overrides.push({
                code:
                    "CRITICAL_DEVICE_RISK",

                severity:
                    "CRITICAL",

                action:
                    "BLOCK",

                source:
                    "DEVICE",
            });
        }

        /**
         * Behavioral hard stop.
         */
        if (
            behavioral.decision ===
            "BLOCK"
        ) {

            overrides.push({
                code:
                    "BEHAVIORAL_BLOCK",

                severity:
                    "CRITICAL",

                action:
                    "BLOCK",

                source:
                    "BEHAVIORAL",
            });
        }

        return overrides;
    }

    /**
     * ========================================================================
     * DECISION ENGINE
     * ========================================================================
     */

    generateDecision(
        score,
        riskLevel,
        overrides,
        engines
    ) {

        /**
         * Hard overrides ALWAYS win over weighted scoring.
         */
        if (
            overrides.some(
                override =>
                    override.action ===
                    "BLOCK"
            )
        ) {

            return {
                action: "BLOCK",

                approved: false,

                reviewRequired: true,

                escalationRequired: true,

                financialPostingAllowed: false,

                complianceHold: true,

                reasonCode:
                    overrides[0]?.code ||
                    "RISK_HARD_RULE",

                source:
                    "HARD_RULE_OVERRIDE",
            };
        }

        switch (riskLevel) {

            case "CRITICAL":

                return {
                    action:
                        this.config.decisions
                            .CRITICAL_ACTION,

                    approved: false,

                    reviewRequired: true,

                    escalationRequired: true,

                    financialPostingAllowed: false,

                    complianceHold: true,

                    reasonCode:
                        "CRITICAL_COMPOSITE_RISK",

                    source:
                        "COMPOSITE_RISK_SCORE",
                };

            case "HIGH":

                return {
                    action:
                        this.config.decisions
                            .HIGH_ACTION,

                    approved: false,

                    reviewRequired: true,

                    escalationRequired: true,

                    financialPostingAllowed: false,

                    complianceHold: true,

                    reasonCode:
                        "HIGH_COMPOSITE_RISK",

                    source:
                        "COMPOSITE_RISK_SCORE",
                };

            case "MEDIUM":

                return {
                    action:
                        this.config.decisions
                            .MEDIUM_ACTION,

                    approved: true,

                    reviewRequired: true,

                    escalationRequired: false,

                    financialPostingAllowed: true,

                    complianceHold: false,

                    reasonCode:
                        "MEDIUM_COMPOSITE_RISK",

                    source:
                        "COMPOSITE_RISK_SCORE",
                };

            default:

                return {
                    action:
                        this.config.decisions
                            .LOW_ACTION,

                    approved: true,

                    reviewRequired: false,

                    escalationRequired: false,

                    financialPostingAllowed: true,

                    complianceHold: false,

                    reasonCode:
                        "LOW_COMPOSITE_RISK",

                    source:
                        "COMPOSITE_RISK_SCORE",
                };
        }
    }

    /**
     * ========================================================================
     * RECOMMENDATIONS
     * ========================================================================
     */

    generateRecommendations(
        riskLevel,
        decision,
        engines,
        overrides
    ) {

        const recommendations = [];

        const aml =
            engines.aml || {};

        const fraud =
            engines.fraud || {};

        const behavioral =
            engines.behavioral || {};

        const device =
            engines.device || {};

        const credit =
            engines.credit || {};

        if (
            Number(
                aml.riskScore
            ) >= 50
        ) {

            recommendations.push(
                "Perform enhanced AML transaction review."
            );
        }

        if (
            fraud.riskLevel === "HIGH" ||
            fraud.riskLevel === "CRITICAL"
        ) {

            recommendations.push(
                "Escalate transaction to fraud investigation workflow."
            );
        }

        if (
            Number(
                fraud.indicators
                    ?.accountTakeoverRisk
            ) >= 50
        ) {

            recommendations.push(
                "Require step-up authentication and account takeover controls."
            );
        }

        if (
            Number(
                device.riskScore
            ) >= 50
        ) {

            recommendations.push(
                "Require device verification before sensitive transaction execution."
            );
        }

        if (
            Number(
                behavioral.riskScore
            ) >= 50
        ) {

            recommendations.push(
                "Review customer behavioral deviation and recent session activity."
            );
        }

        if (
            Number(
                credit.riskScore
            ) >= 60
        ) {

            recommendations.push(
                "Review customer credit exposure before approving credit-related activity."
            );
        }

        if (
            overrides.length > 0
        ) {

            recommendations.push(
                "Apply hard-rule compliance controls before transaction execution."
            );
        }

        if (
            decision.action === "BLOCK"
        ) {

            recommendations.push(
                "Prevent financial execution until an authorized compliance disposition is recorded."
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
            riskLevel === "MEDIUM"
        ) {

            recommendations.push(
                "Continue enhanced monitoring of subsequent activity."
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
     * CASE MANAGEMENT
     * ========================================================================
     */

    async handleCaseManagement(
        transaction,
        customer,
        riskResult
    ) {

        const {
            riskLevel,
            decision,
        } = riskResult;

        const shouldCreateCase =
            (
                riskLevel === "CRITICAL" &&
                this.config.caseManagement
                    .createCaseForCritical
            ) ||
            (
                riskLevel === "HIGH" &&
                this.config.caseManagement
                    .createCaseForHigh
            ) ||
            (
                riskLevel === "MEDIUM" &&
                this.config.caseManagement
                    .createCaseForMedium
            );

        if (
            !shouldCreateCase
        ) {

            return {
                created: false,
                caseId: null,
            };
        }

        const service =
            this.dependencies
                .caseManagementService;

        if (
            !service ||
            typeof service.createCase !==
                "function"
        ) {

            this.logWarning(
                "Case management service unavailable",
                {
                    orchestrationId:
                        riskResult.orchestrationId,

                    riskLevel,
                }
            );

            return {
                created: false,

                unavailable: true,

                caseId: null,
            };
        }

        const alertId =
            await this.createRiskAlert(
                transaction,
                customer,
                riskResult
            );

        if (!alertId) {

            return {
                created: false,

                alertUnavailable: true,

                caseId: null,
            };
        }

        const createdCase =
            await service.createCase({
                alertId,

                userId:
                    customer.id,

                tenantId:
                    riskResult.tenantId,

                assignedTo:
                    this.config.caseManagement
                        .autoAssign
                        ? null
                        : undefined,
            });

        return {
            created: true,

            caseId:
                createdCase?.caseId ||
                createdCase?._id?.toString() ||
                null,

            alertId,
        };
    }

    /**
     * ========================================================================
     * RISK ALERT CREATION
     * ========================================================================
     */

    async createRiskAlert(
        transaction,
        customer,
        riskResult
    ) {

        const service =
            this.dependencies
                .riskAlertService;

        if (
            !service
        ) {

            return generateId(
                "ALERT"
            );
        }

        if (
            typeof service.createAlert ===
                "function"
        ) {

            const alert =
                await service.createAlert({
                    alertId:
                        generateId(
                            "ALERT"
                        ),

                    tenantId:
                        riskResult.tenantId,

                    userId:
                        customer.id,

                    transactionId:
                        transaction.id,

                    riskScore:
                        riskResult.compositeScore,

                    riskLevel:
                        riskResult.riskLevel,

                    decision:
                        riskResult.decision,

                    status:
                        "OPEN",

                    source:
                        "RISK_ORCHESTRATION",

                    createdAt:
                        now(),
                });

            return (
                alert?.alertId ||
                alert?._id?.toString() ||
                null
            );
        }

        /**
         * Support simple model-like services exposing create().
         */
        if (
            typeof service.create ===
                "function"
        ) {

            const alert =
                await service.create({
                    alertId:
                        generateId(
                            "ALERT"
                        ),

                    tenantId:
                        riskResult.tenantId,

                    userId:
                        customer.id,

                    transactionId:
                        transaction.id,

                    riskScore:
                        riskResult.compositeScore,

                    riskLevel:
                        riskResult.riskLevel,

                    decision:
                        riskResult.decision,

                    status:
                        "OPEN",

                    source:
                        "RISK_ORCHESTRATION",

                    createdAt:
                        now(),
                });

            return (
                alert?.alertId ||
                alert?._id?.toString() ||
                null
            );
        }

        return null;
    }

    /**
     * ========================================================================
     * IDEMPOTENCY
     * ========================================================================
     */

    resolveIdempotencyKey(
        transaction,
        customer,
        context
    ) {

        if (
            context.idempotencyKey
        ) {

            return String(
                context.idempotencyKey
            );
        }

        if (
            !this.config.idempotency.enabled
        ) {

            return null;
        }

        if (
            !transaction.id
        ) {

            if (
                this.config.idempotency
                    .requireKey
            ) {

                throw new Error(
                    "Idempotency key required for risk orchestration."
                );
            }

            return null;
        }

        return crypto
            .createHash("sha256")
            .update(
                [
                    transaction.tenantId || "",
                    transaction.id || "",
                    customer?.id || "",
                    transaction.amount || "",
                    transaction.currency || "",
                ].join("|")
            )
            .digest("hex");
    }

    async getIdempotentResult(
        key
    ) {

        if (
            !key ||
            !this.dependencies
                .idempotencyStore
        ) {

            return null;
        }

        const store =
            this.dependencies
                .idempotencyStore;

        if (
            typeof store.get ===
                "function"
        ) {

            return store.get(
                `risk:${key}`
            );
        }

        return null;
    }

    async storeIdempotentResult(
        key,
        result
    ) {

        if (
            !key ||
            !this.dependencies
                .idempotencyStore
        ) {

            return;
        }

        const store =
            this.dependencies
                .idempotencyStore;

        if (
            typeof store.set ===
                "function"
        ) {

            await store.set(
                `risk:${key}`,
                result
            );
        }
    }

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    async auditDecision(
        result
    ) {

        const auditService =
            this.dependencies.auditService;

        if (
            auditService &&
            typeof auditService.log ===
                "function"
        ) {

            await auditService.log({

                event:
                    "RISK_ORCHESTRATION_COMPLETED",

                service:
                    this.serviceName,

                serviceVersion:
                    this.serviceVersion,

                orchestrationId:
                    result.orchestrationId,

                tenantId:
                    result.tenantId,

                transactionId:
                    result.transactionId,

                customerId:
                    result.customerId,

                riskScore:
                    result.compositeScore,

                riskLevel:
                    result.riskLevel,

                action:
                    result.decision?.action,

                reasonCode:
                    result.decision?.reasonCode,

                overrides:
                    result.overrides,

                financialPostingAllowed:
                    result.decision
                        ?.financialPostingAllowed,

                timestamp:
                    now(),
            });
        }
    }

    /**
     * ========================================================================
     * METRICS
     * ========================================================================
     */

    recordMetrics(
        result
    ) {

        const metrics =
            this.dependencies.metrics;

        if (
            !metrics
        ) {
            return;
        }

        try {

            if (
                typeof metrics.increment ===
                    "function"
            ) {

                metrics.increment(
                    "risk_orchestration_total",
                    {
                        riskLevel:
                            result.riskLevel,

                        action:
                            result.decision
                                ?.action,
                    }
                );
            }

            if (
                typeof metrics.observe ===
                    "function"
            ) {

                metrics.observe(
                    "risk_orchestration_score",
                    result.compositeScore
                );

                metrics.observe(
                    "risk_orchestration_duration_ms",
                    result.metadata
                        ?.executionDurationMs || 0
                );
            }

        } catch (error) {

            this.logWarning(
                "Risk metrics recording failed",
                {
                    error:
                        error.message,
                }
            );
        }
    }

    /**
     * ========================================================================
     * EVENT PUBLISHING
     * ========================================================================
     */

    async publishDecisionEvent(
        result
    ) {

        const publisher =
            this.dependencies
                .eventPublisher;

        if (
            !publisher
        ) {
            return;
        }

        if (
            typeof publisher.publish !==
                "function"
        ) {
            return;
        }

        await publisher.publish(
            "risk.orchestration.completed",
            {
                orchestrationId:
                    result.orchestrationId,

                tenantId:
                    result.tenantId,

                transactionId:
                    result.transactionId,

                customerId:
                    result.customerId,

                riskScore:
                    result.compositeScore,

                riskLevel:
                    result.riskLevel,

                action:
                    result.decision?.action,

                reasonCode:
                    result.decision?.reasonCode,

                financialPostingAllowed:
                    result.decision
                        ?.financialPostingAllowed,
            }
        );
    }

    /**
     * ========================================================================
     * FAIL-CLOSED DECISION
     * ========================================================================
     */

    createFailClosedDecision(
        orchestrationId,
        transaction,
        customer,
        error
    ) {

        return {

            success: false,

            orchestrationId,

            service:
                this.serviceName,

            serviceVersion:
                this.serviceVersion,

            tenantId:
                transaction.tenantId ||
                customer?.tenantId ||
                null,

            transactionId:
                transaction.id,

            customerId:
                customer?.id || null,

            compositeScore:
                100,

            riskLevel:
                "CRITICAL",

            decision: {

                action:
                    "HOLD",

                approved:
                    false,

                reviewRequired:
                    true,

                escalationRequired:
                    true,

                financialPostingAllowed:
                    false,

                complianceHold:
                    true,

                reasonCode:
                    "RISK_ENGINE_FAILURE",

                source:
                    "FAIL_CLOSED",
            },

            overrides: [
                {
                    code:
                        "RISK_ENGINE_FAILURE",

                    severity:
                        "CRITICAL",

                    action:
                        "HOLD",

                    source:
                        "RISK_ORCHESTRATION",
                },
            ],

            engineResults: {},

            recommendations: [
                "Do not execute the financial transaction until risk infrastructure is restored or an authorized compliance workflow disposes the hold.",
                "Investigate the underlying risk engine failure.",
            ],

            case: {
                created: false,
                pendingCreation: true,
            },

            error: {
                code:
                    "RISK_ORCHESTRATION_FAILED",

                message:
                    error?.message ||
                    "Risk orchestration failed.",
            },

            metadata: {

                screeningStatus:
                    "FAILED",

                financialPostingAllowed:
                    false,

                failClosed:
                    true,

                timestamp:
                    now().toISOString(),
            },
        };
    }

    /**
     * ========================================================================
     * ERROR HELPERS
     * ========================================================================
     */

    createEngineFailure(
        engineName,
        originalError
    ) {

        const error =
            new Error(
                `Risk engine "${engineName}" failed: ${originalError.message}`
            );

        error.code =
            "RISK_ENGINE_FAILURE";

        error.engine =
            engineName;

        error.cause =
            originalError;

        return error;
    }

    createOrchestrationError(
        originalError,
        orchestrationId
    ) {

        const error =
            new Error(
                `Risk orchestration failed: ${originalError.message}`
            );

        error.code =
            "RISK_ORCHESTRATION_FAILED";

        error.orchestrationId =
            orchestrationId;

        error.cause =
            originalError;

        error.service =
            this.serviceName;

        return error;
    }

    /**
     * ========================================================================
     * SCORE HELPERS
     * ========================================================================
     */

    scoreToLevel(
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
     * ========================================================================
     * TIMEOUT
     * ========================================================================
     */

    async withTimeout(
        promise,
        timeoutMs,
        operation
    ) {

        let timeoutHandle;

        const timeoutPromise =
            new Promise(
                (_, reject) => {

                    timeoutHandle =
                        setTimeout(
                            () => {

                                const error =
                                    new Error(
                                        `${operation} risk engine timed out after ${timeoutMs}ms`
                                    );

                                error.code =
                                    "RISK_ENGINE_TIMEOUT";

                                error.engine =
                                    operation;

                                reject(
                                    error
                                );

                            },
                            timeoutMs
                        );
                }
            );

        try {

            return await Promise.race([
                promise,
                timeoutPromise,
            ]);

        } finally {

            clearTimeout(
                timeoutHandle
            );
        }
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
            typeof logger.error ===
                "function"
        ) {

            logger.error(
                message,
                {
                    service:
                        this.serviceName,

                    error:
                        error?.message,

                    stack:
                        error?.stack,

                    ...metadata,
                }
            );
        }
    }

    logWarning(
        message,
        metadata = {}
    ) {

        const logger =
            this.dependencies.logger;

        if (
            logger &&
            typeof logger.warn ===
                "function"
        ) {

            logger.warn(
                message,
                {
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
 * Backward-compatible usage:
 *
 * const RiskOrchestrationService =
 *     require("./RiskOrchestrationService");
 *
 * await RiskOrchestrationService.orchestrate(...);
 *
 * ============================================================================
 */

module.exports =
    new RiskOrchestrationService();

/**
 * ============================================================================
 * CLASS EXPORT
 * ============================================================================
 *
 * Useful for:
 *
 * - Unit testing
 * - Integration testing
 * - Dependency injection
 * - Tenant-specific configuration
 * - Provider substitution
 * ============================================================================
 */

module.exports.RiskOrchestrationService =
    RiskOrchestrationService;

/**
 * ============================================================================
 * DEFAULT CONFIG EXPORT
 * ============================================================================
 */

module.exports.DEFAULT_RISK_ORCHESTRATION_CONFIG =
    DEFAULT_CONFIG;