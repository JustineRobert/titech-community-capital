'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise AI Decision Engine
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/aiDecisionEngine.js
 *
 * Architectural Role
 * ------------------
 * Governed AI-assisted decision-support boundary for Airtel payment operations.
 *
 * This component consumes configured feature, prediction, fraud-intelligence,
 * recommendation and explanation services and produces explainable operational
 * recommendations. It must never become an autonomous financial execution
 * boundary.
 *
 * Responsibilities
 * ----------------
 * - Generate AI-assisted recommendations.
 * - Aggregate model/prediction/fraud signals.
 * - Produce explainable decision output.
 * - Recommend operational routing.
 * - Recommend bounded retry strategies.
 * - Estimate settlement/liquidity impact through a configured prediction
 *   service.
 * - Recommend reconciliation repair actions.
 * - Expose command-center operational projections.
 * - Record outcome/feedback for approved learning workflows.
 * - Provide metrics, tracing, health and diagnostics.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Airtel API communication.
 * - Payment execution.
 * - Settlement execution.
 * - Ledger posting.
 * - Wallet/balance mutation.
 * - Approving financial transactions.
 * - KYC/AML decisions.
 * - Regulatory decisions.
 * - Autonomous fraud blocking unless an external policy boundary authorizes it.
 * - Autonomous reconciliation repair.
 * - Direct modification of provider or financial records.
 *
 * AI Governance Principles
 * ------------------------
 * 1. AI output is advisory, not authoritative financial state.
 * 2. Recommendations require deterministic downstream business-rule and
 *    authorization controls before any financial side effect.
 * 3. Model confidence is not a probability of correctness unless the model
 *    contract explicitly establishes calibration.
 * 4. Unknown, missing or contradictory model signals bias toward REVIEW or
 *    ESCALATE rather than PROCEED.
 * 5. AI recommendations do not override compliance, approval, fraud or ledger
 *    controls.
 * 6. Raw callbacks, provider payloads, credentials and model internals are not
 *    blindly logged or published.
 * 7. Retry recommendations are bounded and must remain compatible with provider
 *    and idempotency controls.
 * 8. Learning feedback must preserve recommendation identity and outcome
 *    provenance.
 *
 * Financial Safety Principles
 * ---------------------------
 * - Never mutate balances, wallets or ledgers.
 * - Never call a financial posting service directly.
 * - Never treat a model recommendation as settlement confirmation.
 * - Never automatically invoke reconciliation repair solely because an AI model
 *   recommends it.
 *
 * Operational Principles
 * ----------------------
 * - Fail closed when critical AI dependencies are missing.
 * - Gracefully degrade when optional intelligence services are unavailable.
 * - Bound model outputs before passing them to downstream automation.
 * - Preserve correlation/decision identifiers.
 * - Prefer policy/approval workflow boundaries over direct action execution.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'AIDecisionEngine';
const VERSION = '1.0.0';

const DECISION = Object.freeze({

    PROCEED:
        'PROCEED',

    REVIEW:
        'REVIEW',

    RETRY:
        'RETRY',

    ESCALATE:
        'ESCALATE',

    REPAIR:
        'REPAIR',

    REJECT:
        'REJECT'

});

const DECISION_SOURCE = Object.freeze({

    AI:
        'AI',

    RULE:
        'RULE',

    HYBRID:
        'HYBRID',

    UNKNOWN:
        'UNKNOWN'

});

const ENGINE_STATUS = Object.freeze({

    INITIALIZING:
        'INITIALIZING',

    READY:
        'READY',

    DEGRADED:
        'DEGRADED',

    FAILED:
        'FAILED'

});

const ROUTE = Object.freeze({

    PROCESS_PAYMENT:
        'PROCESS_PAYMENT',

    RETRY_QUEUE:
        'RETRY_QUEUE',

    REPAIR_WORKFLOW:
        'REPAIR_WORKFLOW',

    MANUAL_REVIEW:
        'MANUAL_REVIEW',

    STANDARD_PROCESSING:
        'STANDARD_PROCESSING',

    ESCALATION:
        'ESCALATION',

    REJECT:
        'REJECT'

});

const ACTION_TYPE = Object.freeze({

    REFRESH_CACHE:
        'REFRESH_CACHE',

    START_RECONCILIATION:
        'START_RECONCILIATION',

    OPEN_INCIDENT:
        'OPEN_INCIDENT'

});

const DEFAULTS = Object.freeze({

    maxRetryCount:
        5,

    defaultRetryDelayMs:
        2_000,

    maxRetryDelayMs:
        300_000,

    minRetryDelayMs:
        250,

    maxRecommendationAgeMs:
        15 * 60 * 1000,

    defaultConfidence:
        0,

    maxOperationalActions:
        20

});

const SENSITIVE_KEYS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'access_token',
    'refresh_token',
    'client_secret',
    'clientSecret',
    'secret',
    'api_key',
    'apiKey',
    'signature',
    'x-signature',
    'raw',
    'body',
    'requestBody',
    'responseBody',
    'providerRequest',
    'providerResponse',
    'credentials'
]);

const MAX_STRING_LENGTH = 512;
const MAX_REASON_COUNT = 25;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 5;

function truncate(
    value,
    maxLength = MAX_STRING_LENGTH
) {

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const stringValue =
        String(value);

    return stringValue.length <= maxLength
        ? stringValue
        : `${stringValue.slice(0, maxLength)}…`;
}

function sanitizeValue(
    value,
    key = '',
    depth = 0
) {

    if (
        depth > MAX_DEPTH
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const normalizedKey =
        String(key || '')
            .toLowerCase();

    if (
        SENSITIVE_KEYS.has(key) ||
        SENSITIVE_KEYS.has(normalizedKey)
    ) {
        return '[REDACTED]';
    }

    if (
        typeof value === 'string'
    ) {
        return truncate(
            value
        );
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        typeof value === 'bigint'
    ) {
        return value.toString();
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Array.isArray(value)
    ) {

        return value
            .slice(
                0,
                100
            )
            .map(
                item =>
                    sanitizeValue(
                        item,
                        '',
                        depth + 1
                    )
            );
    }

    if (
        typeof value === 'object'
    ) {

        const output = {};

        for (
            const [
                childKey,
                childValue
            ] of Object.entries(value)
                .slice(
                    0,
                    MAX_OBJECT_KEYS
                )
        ) {

            if (
                childKey === '__proto__' ||
                childKey === 'prototype' ||
                childKey === 'constructor'
            ) {
                continue;
            }

            output[childKey] =
                sanitizeValue(
                    childValue,
                    childKey,
                    depth + 1
                );
        }

        return output;
    }

    return truncate(
        value
    );
}

function safeError(
    error
) {

    return {

        name:
            truncate(
                error?.name ||
                'Error',
                128
            ),

        message:
            truncate(
                error?.message ||
                String(error || 'Unknown error'),
                1_000
            ),

        code:
            truncate(
                error?.code,
                128
            )

    };
}

function normalizeCorrelationId(
    correlation
) {

    if (
        correlation === null ||
        correlation === undefined
    ) {

        return crypto.randomUUID();
    }

    if (
        typeof correlation === 'string'
    ) {

        return truncate(
            correlation.trim(),
            256
        );
    }

    if (
        typeof correlation === 'object'
    ) {

        const candidate =
            correlation.correlationId ??
            correlation.id ??
            correlation.requestId;

        if (
            candidate
        ) {

            return truncate(
                String(candidate).trim(),
                256
            );
        }
    }

    return crypto.randomUUID();
}

function normalizeDecision(
    value
) {

    const normalized =
        String(
            value ||
            DECISION.REVIEW
        )
            .trim()
            .toUpperCase();

    return Object.values(
        DECISION
    ).includes(
        normalized
    )
        ? normalized
        : DECISION.REVIEW;
}

function clamp(
    value,
    min,
    max
) {

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return min;
    }

    return Math.min(
        max,
        Math.max(
            min,
            numeric
        )
    );
}

function normalizeConfidence(
    value
) {

    /*
     * Confidence is an ordinal normalized score in [0,1], not a claim of
     * calibrated statistical probability.
     */
    return Number(
        clamp(
            value,
            0,
            1
        ).toFixed(4)
    );
}

function normalizeDelay(
    value,
    fallback
) {

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        ) ||
        numeric < 0
    ) {
        return fallback;
    }

    return Math.floor(
        numeric
    );
}

function safeActionName(
    action
) {

    return String(
        action
    )
        .trim()
        .toUpperCase();
}

class AIDecisionEngine {

    constructor({

        featureStore,

        predictionEngine,

        fraudEngine,

        recommendationEngine,

        decisionExplainer,

        cache,

        reconciliationService,

        incidentService,

        operationsService,

        healthService,

        policyEngine,

        approvalService,

        auditService,

        logger,

        metrics,

        tracer,

        clock = Date,

        maxRetryCount =
            DEFAULTS.maxRetryCount,

        defaultRetryDelayMs =
            DEFAULTS.defaultRetryDelayMs,

        maxRetryDelayMs =
            DEFAULTS.maxRetryDelayMs,

        minRetryDelayMs =
            DEFAULTS.minRetryDelayMs,

        maxRecommendationAgeMs =
            DEFAULTS.maxRecommendationAgeMs,

        maxOperationalActions =
            DEFAULTS.maxOperationalActions,

        allowOperationalAutomation =
            false

    } = {}) {

        this.featureStore =
            featureStore;

        this.predictionEngine =
            predictionEngine;

        this.fraudEngine =
            fraudEngine;

        this.recommendationEngine =
            recommendationEngine;

        this.decisionExplainer =
            decisionExplainer;

        this.cache =
            cache;

        this.reconciliationService =
            reconciliationService;

        this.incidentService =
            incidentService;

        this.operationsService =
            operationsService;

        this.healthService =
            healthService;

        this.policyEngine =
            policyEngine;

        this.approvalService =
            approvalService;

        this.auditService =
            auditService;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.clock =
            clock;

        this.maxRetryCount =
            Math.max(
                0,
                Math.floor(
                    Number(maxRetryCount) ||
                    DEFAULTS.maxRetryCount
                )
            );

        this.defaultRetryDelayMs =
            Math.max(
                0,
                Math.floor(
                    Number(defaultRetryDelayMs) ||
                    DEFAULTS.defaultRetryDelayMs
                )
            );

        this.maxRetryDelayMs =
            Math.max(
                this.defaultRetryDelayMs,
                Math.floor(
                    Number(maxRetryDelayMs) ||
                    DEFAULTS.maxRetryDelayMs
                )
            );

        this.minRetryDelayMs =
            Math.max(
                0,
                Math.floor(
                    Number(minRetryDelayMs) ||
                    DEFAULTS.minRetryDelayMs
                )
            );

        this.maxRecommendationAgeMs =
            Math.max(
                0,
                Math.floor(
                    Number(maxRecommendationAgeMs) ||
                    DEFAULTS.maxRecommendationAgeMs
                )
            );

        this.maxOperationalActions =
            Math.max(
                1,
                Math.floor(
                    Number(maxOperationalActions) ||
                    DEFAULTS.maxOperationalActions
                )
            );

        /*
         * Direct operational automation is disabled by default. When enabled,
         * each action still passes through policy/approval checks where those
         * services are configured.
         */
        this.allowOperationalAutomation =
            Boolean(
                allowOperationalAutomation
            );

        this.startedAt =
            this.now();

        this.healthState = {

            status:
                ENGINE_STATUS.INITIALIZING,

            lastRecommendationAt:
                null,

            lastFeedbackAt:
                null,

            lastError:
                null

        };

        this.statistics = {

            recommendations:
                0,

            predictions:
                0,

            fraudEvaluations:
                0,

            reviews:
                0,

            escalations:
                0,

            retriesRecommended:
                0,

            repairsRecommended:
                0,

            rejectedRecommendations:
                0,

            feedbackEvents:
                0,

            operationalActionsRequested:
                0,

            operationalActionsExecuted:
                0,

            operationalActionsRejected:
                0,

            failures:
                0

        };

        this.initialized =
            false;
    }

    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     */

    async initialize() {

        try {

            this.validateDependencies();

            this.initialized =
                true;

            this.healthState.status =
                ENGINE_STATUS.READY;

            this.logger?.info?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Airtel AI decision engine initialized',

                allowOperationalAutomation:
                    this.allowOperationalAutomation

            });

            this.metrics?.counter?.(
                'airtel_ai_decision_engine_initialized_total',
                1
            );

            return true;

        } catch (error) {

            this.statistics.failures++;

            this.healthState.status =
                ENGINE_STATUS.FAILED;

            this.healthState.lastError =
                safeError(error);

            throw error;
        }
    }

    /**
     * =========================================================================
     * Generate AI Recommendation
     * =========================================================================
     */

    async recommend({

        callback,

        context = {},

        correlation,

        tenantId = null,

        actorId = null,

        executionId =
            crypto.randomUUID(),

        policyContext = {}

    } = {}) {

        const correlationId =
            normalizeCorrelationId(
                correlation
            );

        const span =
            this.startSpan(
                'airtel.ai.decision.recommend',
                {
                    tenantId,
                    correlationId,
                    executionId
                }
            );

        const startedAt =
            Date.now();

        try {

            const features =
                await this.buildFeatures({
                    callback,
                    context,
                    correlationId,
                    tenantId,
                    executionId
                });

            const prediction =
                await this.runPrediction({
                    features,
                    correlationId,
                    tenantId,
                    executionId
                });

            const fraud =
                await this.runFraudEvaluation({
                    features,
                    correlationId,
                    tenantId,
                    executionId
                });

            const rawRecommendation =
                await this.generateRecommendation({
                    prediction,
                    fraud,
                    callback,
                    context,
                    correlationId,
                    tenantId,
                    executionId
                });

            const normalizedRecommendation =
                this.normalizeRecommendation(
                    rawRecommendation
                );

            const policy =
                await this.evaluatePolicy({
                    recommendation:
                        normalizedRecommendation,
                    prediction,
                    fraud,
                    callback,
                    context,
                    tenantId,
                    correlationId,
                    executionId,
                    policyContext
                });

            const governedDecision =
                this.applyGovernance({
                    recommendation:
                        normalizedRecommendation,
                    prediction,
                    fraud,
                    policy
                });

            const explanation =
                await this.generateExplanation({
                    features,
                    recommendation:
                        governedDecision,
                    prediction,
                    fraud,
                    policy,
                    correlationId
                });

            const decision = {

                decisionId:
                    crypto.randomUUID(),

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                version:
                    VERSION,

                tenantId,

                actorId,

                correlationId,

                executionId,

                decision:
                    governedDecision.decision,

                recommendation:
                    governedDecision.recommendation,

                route:
                    this.recommendRoute({
                        recommendation:
                            governedDecision.recommendation,

                        decision:
                            governedDecision.decision
                    }),

                prediction:
                    this.safeModelProjection(
                        prediction
                    ),

                fraud:
                    this.safeModelProjection(
                        fraud
                    ),

                explanation:
                    this.safeExplanation(
                        explanation
                    ),

                policy:
                    this.safePolicyProjection(
                        policy
                    ),

                confidence:
                    normalizeConfidence(
                        governedDecision.confidence
                    ),

                decisionSource:
                    governedDecision.decisionSource,

                advisoryOnly:
                    true,

                createdAt:
                    this.now(),

                expiresAt:
                    new Date(
                        Date.now() +
                        this.maxRecommendationAgeMs
                    )

            };

            this.statistics.recommendations++;
            this.healthState.lastRecommendationAt =
                decision.createdAt;
            this.healthState.lastError =
                null;
            this.healthState.status =
                ENGINE_STATUS.READY;

            if (
                prediction !== null
            ) {
                this.statistics.predictions++;
            }

            if (
                fraud !== null
            ) {
                this.statistics.fraudEvaluations++;
            }

            if (
                decision.decision ===
                DECISION.REVIEW
            ) {
                this.statistics.reviews++;
            }

            if (
                decision.decision ===
                DECISION.ESCALATE
            ) {
                this.statistics.escalations++;
            }

            if (
                decision.decision ===
                DECISION.REJECT
            ) {
                this.statistics.rejectedRecommendations++;
            }

            if (
                decision.decision ===
                DECISION.RETRY
            ) {
                this.statistics.retriesRecommended++;
            }

            if (
                decision.decision ===
                DECISION.REPAIR
            ) {
                this.statistics.repairsRecommended++;
            }

            await this.recordAuditSafe({

                action:
                    'AIRTEL_AI_DECISION_GENERATED',

                tenantId,

                actorId,

                decisionId:
                    decision.decisionId,

                correlationId,

                executionId,

                decision:
                    decision.decision,

                confidence:
                    decision.confidence,

                advisoryOnly:
                    true

            });

            this.metrics?.counter?.(
                'airtel_ai_recommendations_total',
                1
            );

            this.metrics?.histogram?.(
                'airtel_ai_recommendation_duration_ms',
                Date.now() - startedAt
            );

            return decision;

        } catch (error) {

            this.statistics.failures++;

            this.healthState.status =
                ENGINE_STATUS.DEGRADED;

            this.healthState.lastError =
                safeError(error);

            this.metrics?.counter?.(
                'airtel_ai_recommendations_failed_total',
                1
            );

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Airtel AI recommendation generation failed',

                tenantId,

                correlationId,

                executionId,

                error:
                    safeError(error)

            });

            throw error;

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Feature Construction
     * =========================================================================
     */

    async buildFeatures({

        callback,

        context,

        correlationId,

        tenantId,

        executionId

    }) {

        if (
            !this.featureStore ||
            typeof this.featureStore.build !==
            'function'
        ) {

            /*
             * A missing feature store is not silently converted into an empty
             * feature object because doing so could create an apparently valid
             * AI decision from no evidence.
             */
            throw this.createError(
                'Feature store is not configured',
                'AIRTEL_AI_FEATURE_STORE_NOT_CONFIGURED'
            );
        }

        const result =
            await this.featureStore.build({

                callback:
                    sanitizeValue(
                        callback
                    ),

                context:
                    sanitizeValue(
                        context
                    ),

                tenantId,

                correlationId,

                executionId

            });

        return result;
    }

    /**
     * =========================================================================
     * Prediction
     * =========================================================================
     */

    async runPrediction({

        features,

        correlationId,

        tenantId,

        executionId

    }) {

        if (
            !this.predictionEngine ||
            typeof this.predictionEngine.predict !==
            'function'
        ) {

            return null;
        }

        return this.predictionEngine.predict({

            features,

            tenantId,

            correlationId,

            executionId

        });
    }

    /**
     * =========================================================================
     * Fraud Evaluation
     * =========================================================================
     */

    async runFraudEvaluation({

        features,

        correlationId,

        tenantId,

        executionId

    }) {

        if (
            !this.fraudEngine ||
            typeof this.fraudEngine.predict !==
            'function'
        ) {

            return null;
        }

        return this.fraudEngine.predict({

            features,

            tenantId,

            correlationId,

            executionId

        });
    }

    /**
     * =========================================================================
     * Recommendation Generation
     * =========================================================================
     */

    async generateRecommendation({

        prediction,

        fraud,

        callback,

        context,

        tenantId,

        correlationId,

        executionId

    }) {

        if (
            !this.recommendationEngine ||
            typeof this.recommendationEngine.generate !==
            'function'
        ) {

            /*
             * No recommendation engine means no safe AI recommendation.
             */
            return {

                action:
                    DECISION.REVIEW,

                confidence:
                    0,

                reasons: [
                    'RECOMMENDATION_ENGINE_UNAVAILABLE'
                ]

            };
        }

        return this.recommendationEngine.generate({

            prediction:
                this.safeModelProjection(
                    prediction
                ),

            fraud:
                this.safeModelProjection(
                    fraud
                ),

            callback:
                sanitizeValue(
                    callback
                ),

            context:
                sanitizeValue(
                    context
                ),

            tenantId,

            correlationId,

            executionId

        });
    }

    /**
     * =========================================================================
     * Recommendation Normalization
     * =========================================================================
     */

    normalizeRecommendation(
        recommendation
    ) {

        const safe =
            recommendation &&
            typeof recommendation === 'object'
                ? recommendation
                : {};

        const action =
            safeActionName(
                safe.action ||
                safe.decision ||
                DECISION.REVIEW
            );

        const confidence =
            normalizeConfidence(
                safe.confidence
            );

        const reasons =
            Array.isArray(
                safe.reasons
            )
                ? [
                    ...new Set(
                        safe.reasons
                            .map(
                                reason =>
                                    truncate(
                                        reason,
                                        512
                                    )
                            )
                    )
                ].slice(
                    0,
                    MAX_REASON_COUNT
                )
                : [];

        return {

            action,

            confidence,

            reasons,

            rationale:
                truncate(
                    safe.rationale,
                    1_000
                ),

            recommendedDelayMs:
                safe.recommendedDelayMs,

            strategy:
                truncate(
                    safe.strategy,
                    128
                ),

            modelVersion:
                truncate(
                    safe.modelVersion,
                    128
                ),

            modelId:
                truncate(
                    safe.modelId,
                    256
                ),

            source:
                safe.source ||
                DECISION_SOURCE.AI

        };
    }

    /**
     * =========================================================================
     * Governance / Policy
     * =========================================================================
     */

    async evaluatePolicy({

        recommendation,

        prediction,

        fraud,

        callback,

        context,

        tenantId,

        correlationId,

        executionId,

        policyContext

    }) {

        if (
            !this.policyEngine ||
            typeof this.policyEngine.evaluate !==
            'function'
        ) {

            return {

                allowed:
                    true,

                overridden:
                    false,

                reason:
                    'NO_POLICY_ENGINE_CONFIGURED'

            };
        }

        return this.policyEngine.evaluate({

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            executionId,

            recommendation:
                sanitizeValue(
                    recommendation
                ),

            prediction:
                this.safeModelProjection(
                    prediction
                ),

            fraud:
                this.safeModelProjection(
                    fraud
                ),

            callback:
                sanitizeValue(
                    callback
                ),

            context:
                sanitizeValue(
                    context
                ),

            policyContext:
                sanitizeValue(
                    policyContext
                )

        });
    }

    applyGovernance({

        recommendation,

        prediction,

        fraud,

        policy

    }) {

        let decision =
            normalizeDecision(
                recommendation.action
            );

        let confidence =
            normalizeConfidence(
                recommendation.confidence
            );

        let decisionSource =
            DECISION_SOURCE.AI;

        const governanceReasons = [];

        /*
         * Missing intelligence evidence must not produce a synthetic PROCEED.
         */
        if (
            prediction === null &&
            fraud === null
        ) {

            decision =
                DECISION.REVIEW;

            confidence =
                0;

            governanceReasons.push(
                'NO_MODEL_EVIDENCE'
            );

            decisionSource =
                DECISION_SOURCE.RULE;
        }

        if (
            prediction === null &&
            (
                decision ===
                DECISION.PROCEED ||
                decision ===
                DECISION.RETRY ||
                decision ===
                DECISION.REPAIR
            )
        ) {

            decision =
                DECISION.REVIEW;

            governanceReasons.push(
                'PREDICTION_UNAVAILABLE'
            );

            decisionSource =
                DECISION_SOURCE.HYBRID;
        }

        if (
            fraud === null &&
            (
                decision ===
                DECISION.PROCEED ||
                decision ===
                DECISION.RETRY
            )
        ) {

            /*
             * Fraud intelligence absence should not silently become a positive
             * signal for higher-risk actions.
             */
            decision =
                DECISION.REVIEW;

            governanceReasons.push(
                'FRAUD_SIGNAL_UNAVAILABLE'
            );

            decisionSource =
                DECISION_SOURCE.HYBRID;
        }

        if (
            fraud &&
            this.fraudRequiresReview(
                fraud
            )
        ) {

            decision =
                DECISION.REVIEW;

            confidence =
                Math.min(
                    confidence,
                    0.5
                );

            governanceReasons.push(
                'FRAUD_RISK_REQUIRES_REVIEW'
            );

            decisionSource =
                DECISION_SOURCE.HYBRID;
        }

        if (
            policy &&
            policy.allowed === false
        ) {

            decision =
                normalizeDecision(
                    policy.decision ||
                    DECISION.REVIEW
                );

            confidence =
                Math.min(
                    confidence,
                    normalizeConfidence(
                        policy.confidence
                    )
                );

            governanceReasons.push(
                'POLICY_OVERRIDDEN_AI_RECOMMENDATION'
            );

            decisionSource =
                DECISION_SOURCE.HYBRID;
        }

        if (
            Array.isArray(
                policy?.reasons
            )
        ) {

            governanceReasons.push(
                ...policy.reasons
                    .map(
                        reason =>
                            truncate(
                                reason,
                                512
                            )
                    )
            );
        }

        /*
         * Financial action remains advisory-only. The returned decision never
         * itself grants authorization to execute a payment or repair.
         */
        return {

            decision,

            confidence,

            decisionSource,

            recommendation: {

                ...recommendation,

                action:
                    decision,

                governanceReasons:
                    [
                        ...new Set(
                            governanceReasons
                        )
                    ]
                        .slice(
                            0,
                            MAX_REASON_COUNT
                        )

            }

        };
    }

    fraudRequiresReview(
        fraud
    ) {

        if (
            fraud === null ||
            fraud === undefined
        ) {
            return false;
        }

        const decision =
            String(
                fraud.decision ||
                fraud.action ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            [
                DECISION.REVIEW,
                DECISION.ESCALATE,
                DECISION.REJECT
            ].includes(
                decision
            )
        ) {

            return true;
        }

        const risk =
            String(
                fraud.riskLevel ||
                fraud.risk ||
                ''
            )
                .trim()
                .toUpperCase();

        return [
            'HIGH',
            'CRITICAL',
            'SEVERE'
        ].includes(
            risk
        );
    }

    /**
     * =========================================================================
     * Explain Decision
     * =========================================================================
     */

    async generateExplanation({

        features,

        recommendation,

        prediction,

        fraud,

        policy,

        correlationId

    }) {

        if (
            !this.decisionExplainer ||
            typeof this.decisionExplainer.explain !==
            'function'
        ) {

            return {

                summary:
                    'AI recommendation generated without an explanation provider',

                limitations: [
                    'EXPLANATION_PROVIDER_UNAVAILABLE'
                ]

            };
        }

        return this.decisionExplainer.explain({

            features:
                sanitizeValue(
                    features
                ),

            recommendation:
                sanitizeValue(
                    recommendation
                ),

            prediction:
                this.safeModelProjection(
                    prediction
                ),

            fraud:
                this.safeModelProjection(
                    fraud
                ),

            policy:
                this.safePolicyProjection(
                    policy
                ),

            correlationId

        });
    }

    async explainDecision({

        recommendationId,

        decisionId,

        tenantId = null,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        if (
            !this.decisionExplainer ||
            typeof this.decisionExplainer.getExplanation !==
            'function'
        ) {
            return null;
        }

        return this.decisionExplainer.getExplanation({

            recommendationId,

            decisionId,

            tenantId,

            correlationId

        });
    }

    safeExplanation(
        explanation
    ) {

        if (
            explanation === null ||
            explanation === undefined
        ) {
            return null;
        }

        if (
            typeof explanation === 'string'
        ) {

            return {

                summary:
                    truncate(
                        explanation,
                        2_000
                    )

            };
        }

        return sanitizeValue(
            explanation
        );
    }

    safePolicyProjection(
        policy
    ) {

        if (
            !policy
        ) {
            return null;
        }

        return sanitizeValue({

            allowed:
                policy.allowed,

            decision:
                policy.decision,

            confidence:
                policy.confidence,

            overridden:
                policy.overridden,

            reasons:
                policy.reasons

        });
    }

    /**
     * =========================================================================
     * Routing Recommendation
     * =========================================================================
     */

    recommendRoute({

        recommendation = {},

        decision

    } = {}) {

        const action =
            safeActionName(
                decision ||
                recommendation.action
            );

        switch (action) {

            case 'FAST_TRACK':
            case DECISION.PROCEED:

                return ROUTE.PROCESS_PAYMENT;

            case DECISION.RETRY:
            case 'RETRY':
                return ROUTE.RETRY_QUEUE;

            case DECISION.REPAIR:
            case 'REPAIR':
                return ROUTE.REPAIR_WORKFLOW;

            case DECISION.REVIEW:
            case 'MANUAL_REVIEW':
                return ROUTE.MANUAL_REVIEW;

            case DECISION.ESCALATE:
                return ROUTE.ESCALATION;

            case DECISION.REJECT:
                return ROUTE.REJECT;

            default:
                return ROUTE.STANDARD_PROCESSING;
        }
    }

    /**
     * =========================================================================
     * Retry Intelligence
     * =========================================================================
     */

    recommendRetry({

        retryCount = 0,

        providerHealth,

        prediction = {},

        errorClass = null

    } = {}) {

        const normalizedRetryCount =
            Math.max(
                0,
                Math.floor(
                    Number(retryCount) || 0
                )
            );

        const normalizedHealth =
            String(
                providerHealth ||
                ''
            )
                .trim()
                .toUpperCase();

        const normalizedErrorClass =
            String(
                errorClass ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            normalizedRetryCount >=
            this.maxRetryCount
        ) {

            this.statistics.escalations++;

            return {

                retry:
                    false,

                decision:
                    DECISION.ESCALATE,

                route:
                    ROUTE.ESCALATION,

                retryCount:
                    normalizedRetryCount,

                reason:
                    'RETRY_LIMIT_REACHED'

            };
        }

        if (
            normalizedHealth ===
            'DOWN'
        ) {

            this.statistics.escalations++;

            return {

                retry:
                    false,

                decision:
                    DECISION.ESCALATE,

                route:
                    ROUTE.ESCALATION,

                retryCount:
                    normalizedRetryCount,

                reason:
                    'PROVIDER_UNAVAILABLE'

            };
        }

        /*
         * Financial and permanent failures should not be blindly retried.
         * The exact error vocabulary remains adapter/policy controlled.
         */
        if (
            [
                'FINANCIAL',
                'DUPLICATE',
                'AUTHENTICATION',
                'AUTHORIZATION',
                'VALIDATION',
                'REJECTED',
                'COMPLIANCE'
            ].includes(
                normalizedErrorClass
            )
        ) {

            return {

                retry:
                    false,

                decision:
                    DECISION.REVIEW,

                route:
                    ROUTE.MANUAL_REVIEW,

                retryCount:
                    normalizedRetryCount,

                reason:
                    'NON_RETRYABLE_ERROR_CLASS'

            };
        }

        const predictedDelay =
            normalizeDelay(
                prediction.recommendedDelayMs,
                this.defaultRetryDelayMs
            );

        const safeDelay =
            Math.min(
                this.maxRetryDelayMs,
                Math.max(
                    this.minRetryDelayMs,
                    predictedDelay
                )
            );

        const strategy =
            prediction.strategy ||
            'EXPONENTIAL_BACKOFF';

        this.statistics.retriesRecommended++;

        return {

            retry:
                true,

            decision:
                DECISION.RETRY,

            route:
                ROUTE.RETRY_QUEUE,

            retryCount:
                normalizedRetryCount,

            delayMs:
                safeDelay,

            strategy:
                truncate(
                    strategy,
                    128
                ),

            reason:
                'RETRY_ELIGIBLE',

            advisoryOnly:
                true

        };
    }

    /**
     * =========================================================================
     * Liquidity Prediction
     * =========================================================================
     */

    async estimateLiquidityImpact({

        settlementBatch,

        tenantId = null,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID()

    } = {}) {

        if (
            !this.predictionEngine ||
            typeof this.predictionEngine.predictLiquidity !==
            'function'
        ) {
            return null;
        }

        const result =
            await this.predictionEngine
                .predictLiquidity({

                    batch:
                        sanitizeValue(
                            settlementBatch
                        ),

                    tenantId,

                    correlationId,

                    executionId

                });

        return sanitizeValue(
            result
        );
    }

    /**
     * =========================================================================
     * Reconciliation Repair Recommendation
     * =========================================================================
     *
     * This creates an advisory recommendation only. It does not call the
     * reconciliation repair workflow.
     */

    async recommendRepair({

        reconciliationIssue,

        tenantId = null,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID()

    } = {}) {

        if (
            !this.recommendationEngine ||
            typeof this.recommendationEngine.repair !==
            'function'
        ) {

            return {

                decision:
                    DECISION.REVIEW,

                recommendation:
                    DECISION.REVIEW,

                reason:
                    'REPAIR_RECOMMENDATION_ENGINE_UNAVAILABLE',

                advisoryOnly:
                    true

            };
        }

        const result =
            await this.recommendationEngine.repair({

                issue:
                    sanitizeValue(
                        reconciliationIssue
                    ),

                tenantId,

                correlationId,

                executionId

            });

        this.statistics.repairsRecommended++;

        return {

            decision:
                DECISION.REPAIR,

            recommendation:
                sanitizeValue(
                    result
                ),

            advisoryOnly:
                true,

            requiresApproval:
                true,

            correlationId,

            executionId

        };
    }

    /**
     * =========================================================================
     * Operational Automation
     * =========================================================================
     *
     * This method deliberately does not execute financial actions.
     *
     * It may execute narrowly-scoped operational actions only when the engine
     * is explicitly configured to permit automation and policy/approval
     * boundaries allow each action.
     */

    async executeOperationalActions({

        tenantId = null,

        recommendations = [],

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        actorId = null,

        authorizationContext = {}

    } = {}) {

        const actions =
            Array.isArray(
                recommendations
            )
                ? recommendations.slice(
                    0,
                    this.maxOperationalActions
                )
                : [];

        this.statistics.operationalActionsRequested +=
            actions.length;

        if (
            !this.allowOperationalAutomation
        ) {

            this.statistics.operationalActionsRejected +=
                actions.length;

            return {

                executed:
                    0,

                rejected:
                    actions.length,

                reason:
                    'OPERATIONAL_AUTOMATION_DISABLED',

                advisoryOnly:
                    true

            };
        }

        const results = [];

        for (
            const action of actions
        ) {

            const normalizedAction =
                this.normalizeOperationalAction(
                    action
                );

            const allowed =
                await this.authorizeOperationalAction({

                    tenantId,

                    action:
                        normalizedAction,

                    correlationId,

                    executionId,

                    actorId,

                    authorizationContext

                });

            if (
                !allowed
            ) {

                this.statistics.operationalActionsRejected++;

                results.push({

                    action:
                        normalizedAction.type,

                    executed:
                        false,

                    reason:
                        'ACTION_NOT_AUTHORIZED'

                });

                continue;
            }

            try {

                const result =
                    await this.executeOperationalAction({
                        tenantId,
                        action:
                            normalizedAction,
                        correlationId,
                        executionId
                    });

                this.statistics.operationalActionsExecuted++;

                results.push({

                    action:
                        normalizedAction.type,

                    executed:
                        true,

                    result:
                        sanitizeValue(
                            result
                        )

                });

            } catch (error) {

                results.push({

                    action:
                        normalizedAction.type,

                    executed:
                        false,

                    error:
                        safeError(error)

                });

                this.logger?.error?.({

                    provider:
                        PROVIDER,

                    component:
                        COMPONENT,

                    message:
                        'Airtel AI operational action failed',

                    tenantId,

                    correlationId,

                    executionId,

                    action:
                        normalizedAction.type,

                    error:
                        safeError(error)

                });
            }
        }

        return {

            executed:
                results.filter(
                    result =>
                        result.executed
                ).length,

            rejected:
                results.filter(
                    result =>
                        !result.executed
                ).length,

            results,

            advisoryOnly:
                false

        };
    }

    normalizeOperationalAction(
        action
    ) {

        const source =
            action &&
            typeof action === 'object'
                ? action
                : {};

        const type =
            safeActionName(
                source.type
            );

        if (
            !Object.values(
                ACTION_TYPE
            ).includes(
                type
            )
        ) {

            return {

                type:
                    type ||
                    'UNKNOWN',

                valid:
                    false,

                metadata: {}

            };
        }

        return {

            type,

            valid:
                true,

            metadata:
                sanitizeValue(
                    source.metadata || {}
                ),

            reason:
                truncate(
                    source.reason,
                    1_000
                )

        };
    }

    async authorizeOperationalAction({

        tenantId,

        action,

        correlationId,

        executionId,

        actorId,

        authorizationContext

    }) {

        if (
            !action.valid
        ) {
            return false;
        }

        /*
         * Financial actions are categorically excluded from this method.
         */
        if (
            ![
                ACTION_TYPE.REFRESH_CACHE,
                ACTION_TYPE.START_RECONCILIATION,
                ACTION_TYPE.OPEN_INCIDENT
            ].includes(
                action.type
            )
        ) {

            return false;
        }

        if (
            this.policyEngine &&
            typeof this.policyEngine.authorize ===
            'function'
        ) {

            const policyResult =
                await this.policyEngine.authorize({

                    action:
                        action.type,

                    tenantId,

                    correlationId,

                    executionId,

                    actorId,

                    context:
                        sanitizeValue(
                            authorizationContext
                        )

                });

            if (
                policyResult === false
            ) {
                return false;
            }
        }

        if (
            this.approvalService &&
            typeof this.approvalService.isAuthorized ===
            'function'
        ) {

            const approved =
                await this.approvalService.isAuthorized({

                    action:
                        action.type,

                    tenantId,

                    actorId,

                    correlationId,

                    executionId

                });

            if (
                approved === false
            ) {
                return false;
            }
        }

        return true;
    }

    async executeOperationalAction({

        tenantId,

        action,

        correlationId,

        executionId

    }) {

        switch (
            action.type
        ) {

            case ACTION_TYPE.REFRESH_CACHE:

                if (
                    !this.cache ||
                    typeof this.cache.refresh !==
                    'function'
                ) {

                    throw this.createError(
                        'Cache refresh service unavailable',
                        'AIRTEL_AI_CACHE_REFRESH_UNAVAILABLE'
                    );
                }

                return this.cache.refresh({

                    tenantId,

                    correlationId,

                    executionId

                });

            case ACTION_TYPE.START_RECONCILIATION:

                if (
                    !this.reconciliationService
                ) {

                    throw this.createError(
                        'Reconciliation service unavailable',
                        'AIRTEL_AI_RECONCILIATION_SERVICE_UNAVAILABLE'
                    );
                }

                /*
                 * Only invoke an explicit scheduling/orchestration boundary.
                 * No financial mutation belongs here.
                 */
                if (
                    typeof this.reconciliationService.schedule ===
                    'function'
                ) {

                    return this.reconciliationService.schedule({

                        tenantId,

                        correlationId,

                        executionId,

                        source:
                            'AI_ASSISTED_OPERATIONAL_ACTION'

                    });
                }

                if (
                    typeof this.reconciliationService.execute ===
                    'function'
                ) {

                    return this.reconciliationService.execute({

                        tenantId,

                        mode:
                            'SCHEDULED',

                        settlementDate:
                            this.now(),

                        correlationId,

                        executionId

                    });
                }

                throw this.createError(
                    'Reconciliation scheduling boundary unavailable',
                    'AIRTEL_AI_RECONCILIATION_SCHEDULING_UNAVAILABLE'
                );

            case ACTION_TYPE.OPEN_INCIDENT:

                if (
                    !this.incidentService ||
                    typeof this.incidentService.create !==
                    'function'
                ) {

                    throw this.createError(
                        'Incident service unavailable',
                        'AIRTEL_AI_INCIDENT_SERVICE_UNAVAILABLE'
                    );
                }

                return this.incidentService.create({

                    provider:
                        PROVIDER,

                    tenantId,

                    correlationId,

                    executionId,

                    source:
                        'AI_DECISION_ENGINE',

                    metadata:
                        action.metadata,

                    reason:
                        action.reason

                });

            default:

                throw this.createError(
                    `Unsupported operational action: ${action.type}`,
                    'AIRTEL_AI_UNSUPPORTED_OPERATION'
                );
        }
    }

    /**
     * =========================================================================
     * Command Center Snapshot
     * =========================================================================
     */

    async commandCenter({

        tenantId = null,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        const results = {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            generatedAt:
                this.now(),

            correlationId,

            statistics:
                this.stats(),

            operations:
                null,

            health:
                null,

            incidents:
                null

        };

        try {

            if (
                this.operationsService &&
                typeof this.operationsService.dashboard ===
                'function'
            ) {

                results.operations =
                    await this.operationsService
                        .dashboard({

                            tenantId,

                            correlationId

                        });
            }

        } catch (error) {

            results.operations = {

                status:
                    'UNAVAILABLE',

                error:
                    safeError(error)

            };
        }

        try {

            if (
                this.healthService &&
                typeof this.healthService.health ===
                'function'
            ) {

                results.health =
                    await this.healthService
                        .health();
            }

        } catch (error) {

            results.health = {

                status:
                    'UNAVAILABLE',

                error:
                    safeError(error)

            };
        }

        try {

            if (
                this.incidentService &&
                typeof this.incidentService.summary ===
                'function'
            ) {

                results.incidents =
                    await this.incidentService
                        .summary({

                            tenantId,

                            correlationId

                        });
            }

        } catch (error) {

            results.incidents = {

                status:
                    'UNAVAILABLE',

                error:
                    safeError(error)

            };
        }

        return sanitizeValue(
            results
        );
    }

    /**
     * =========================================================================
     * Feedback / Continuous Learning
     * =========================================================================
     */

    async recordOutcome({

        recommendationId,

        decisionId = null,

        actualOutcome,

        tenantId = null,

        correlationId =
            crypto.randomUUID(),

        actorId = null,

        metadata = {}

    } = {}) {

        const normalizedRecommendationId =
            recommendationId
                ? truncate(
                    String(
                        recommendationId
                    ).trim(),
                    256
                )
                : null;

        const normalizedDecisionId =
            decisionId
                ? truncate(
                    String(
                        decisionId
                    ).trim(),
                    256
                )
                : null;

        if (
            !normalizedRecommendationId &&
            !normalizedDecisionId
        ) {

            throw this.createError(
                'recommendationId or decisionId is required for outcome feedback',
                'AIRTEL_AI_OUTCOME_ID_REQUIRED'
            );
        }

        const safeOutcome =
            sanitizeValue(
                actualOutcome
            );

        let featureRecorded =
            false;

        let predictionLearned =
            false;

        if (
            this.featureStore &&
            typeof this.featureStore.recordOutcome ===
            'function'
        ) {

            await this.featureStore.recordOutcome({

                recommendationId:
                    normalizedRecommendationId,

                decisionId:
                    normalizedDecisionId,

                tenantId,

                actualOutcome:
                    safeOutcome,

                correlationId,

                actorId,

                metadata:
                    sanitizeValue(
                        metadata
                    )

            });

            featureRecorded =
                true;
        }

        if (
            this.predictionEngine &&
            typeof this.predictionEngine.learn ===
            'function'
        ) {

            await this.predictionEngine.learn({

                recommendationId:
                    normalizedRecommendationId,

                decisionId:
                    normalizedDecisionId,

                tenantId,

                actualOutcome:
                    safeOutcome,

                correlationId,

                actorId

            });

            predictionLearned =
                true;
        }

        this.statistics.feedbackEvents++;

        this.healthState.lastFeedbackAt =
            this.now();

        await this.recordAuditSafe({

            action:
                'AIRTEL_AI_DECISION_OUTCOME_RECORDED',

            tenantId,

            actorId,

            recommendationId:
                normalizedRecommendationId,

            decisionId:
                normalizedDecisionId,

            correlationId,

            featureRecorded,

            predictionLearned

        });

        this.metrics?.counter?.(
            'airtel_ai_decision_feedback_total',
            1
        );

        return {

            accepted:
                featureRecorded ||
                predictionLearned,

            recommendationId:
                normalizedRecommendationId,

            decisionId:
                normalizedDecisionId,

            featureRecorded,

            predictionLearned,

            recordedAt:
                this.now()

        };
    }

    /**
     * =========================================================================
     * Safe Model Projection
     * =========================================================================
     */

    safeModelProjection(
        modelResult
    ) {

        if (
            modelResult === null ||
            modelResult === undefined
        ) {
            return null;
        }

        if (
            typeof modelResult !== 'object'
        ) {

            return {

                value:
                    truncate(
                        modelResult
                    )

            };
        }

        return sanitizeValue({

            decision:
                modelResult.decision,

            action:
                modelResult.action,

            confidence:
                modelResult.confidence,

            score:
                modelResult.score,

            risk:
                modelResult.risk,

            riskLevel:
                modelResult.riskLevel,

            probabilityBand:
                modelResult.probabilityBand,

            strategy:
                modelResult.strategy,

            recommendedDelayMs:
                modelResult.recommendedDelayMs,

            reason:
                modelResult.reason,

            reasons:
                modelResult.reasons,

            modelVersion:
                modelResult.modelVersion,

            modelId:
                modelResult.modelId

        });
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAuditSafe(
        record
    ) {

        if (
            !this.auditService ||
            typeof this.auditService.record !==
            'function'
        ) {
            return false;
        }

        try {

            await this.auditService.record(
                sanitizeValue({

                    provider:
                        PROVIDER,

                    component:
                        COMPONENT,

                    occurredAt:
                        this.now(),

                    ...record

                })
            );

            return true;

        } catch (error) {

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to record Airtel AI audit event',

                error:
                    safeError(error)

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        name,
        attributes = {}
    ) {

        if (
            !this.tracer ||
            typeof this.tracer.startSpan !==
            'function'
        ) {
            return null;
        }

        try {

            const span =
                this.tracer.startSpan(
                    name
                );

            span?.setAttribute?.(
                'provider',
                PROVIDER
            );

            span?.setAttribute?.(
                'component',
                COMPONENT
            );

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    attributes
                )
            ) {

                if (
                    value !== null &&
                    value !== undefined
                ) {

                    span?.setAttribute?.(
                        key,
                        String(value)
                    );
                }
            }

            return span;

        } catch {

            return null;
        }
    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createError(
        message,
        code
    ) {

        const error =
            new Error(
                message
            );

        error.code =
            code;

        return error;
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        const dependencies = {

            featureStore:
                Boolean(
                    this.featureStore &&
                    typeof this.featureStore.build ===
                    'function'
                ),

            predictionEngine:
                Boolean(
                    this.predictionEngine &&
                    typeof this.predictionEngine.predict ===
                    'function'
                ),

            fraudEngine:
                Boolean(
                    this.fraudEngine &&
                    typeof this.fraudEngine.predict ===
                    'function'
                ),

            recommendationEngine:
                Boolean(
                    this.recommendationEngine &&
                    typeof this.recommendationEngine.generate ===
                    'function'
                ),

            decisionExplainer:
                Boolean(
                    this.decisionExplainer &&
                    typeof this.decisionExplainer.explain ===
                    'function'
                ),

            policyEngine:
                Boolean(
                    this.policyEngine
                ),

            approvalService:
                Boolean(
                    this.approvalService
                ),

            auditService:
                !this.auditService ||
                typeof this.auditService.record ===
                'function'

        };

        let status =
            this.healthState.status;

        if (
            !dependencies.featureStore ||
            !dependencies.recommendationEngine
        ) {

            status =
                ENGINE_STATUS.FAILED;

        } else if (
            !dependencies.policyEngine ||
            !dependencies.approvalService
        ) {

            /*
             * AI can still provide advisory recommendations without these
             * optional governance dependencies, but production automation is
             * materially weaker without them.
             */
            status =
                ENGINE_STATUS.DEGRADED;

        } else if (
            status === ENGINE_STATUS.INITIALIZING
        ) {

            status =
                ENGINE_STATUS.DEGRADED;
        }

        return {

            service:
                'AIRTEL_AI_DECISION_ENGINE',

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            status,

            initialized:
                this.initialized,

            advisoryOnly:
                true,

            allowOperationalAutomation:
                this.allowOperationalAutomation,

            dependencies,

            uptime:
                Date.now() -
                this.startedAt.getTime(),

            healthState:
                {
                    ...this.healthState
                },

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

            initialized:
                this.initialized,

            advisoryOnly:
                true,

            maxRetryCount:
                this.maxRetryCount,

            minRetryDelayMs:
                this.minRetryDelayMs,

            defaultRetryDelayMs:
                this.defaultRetryDelayMs,

            maxRetryDelayMs:
                this.maxRetryDelayMs,

            maxRecommendationAgeMs:
                this.maxRecommendationAgeMs,

            maxOperationalActions:
                this.maxOperationalActions,

            allowOperationalAutomation:
                this.allowOperationalAutomation

        };
    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */

    snapshot() {

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            startedAt:
                this.startedAt,

            healthState:
                {
                    ...this.healthState
                },

            statistics:
                this.stats()

        };
    }

    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */

    diagnostics() {

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            governance: {

                advisoryOnly:
                    true,

                policyEngineConfigured:
                    Boolean(
                        this.policyEngine
                    ),

                approvalServiceConfigured:
                    Boolean(
                        this.approvalService
                    ),

                operationalAutomationEnabled:
                    this.allowOperationalAutomation

            },

            retryControls: {

                maxRetryCount:
                    this.maxRetryCount,

                minRetryDelayMs:
                    this.minRetryDelayMs,

                defaultRetryDelayMs:
                    this.defaultRetryDelayMs,

                maxRetryDelayMs:
                    this.maxRetryDelayMs

            },

            statistics:
                this.stats(),

            health:
                {
                    ...this.healthState
                }

        };
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateDependencies() {

        if (
            !this.featureStore ||
            typeof this.featureStore.build !==
            'function'
        ) {

            throw this.createError(
                'Feature store dependency missing',
                'AIRTEL_AI_FEATURE_STORE_REQUIRED'
            );
        }

        if (
            !this.recommendationEngine ||
            typeof this.recommendationEngine.generate !==
            'function'
        ) {

            throw this.createError(
                'Recommendation engine dependency missing',
                'AIRTEL_AI_RECOMMENDATION_ENGINE_REQUIRED'
            );
        }

        /*
         * Prediction and fraud engines remain optional at construction because
         * the engine can operate in governed REVIEW mode when one intelligence
         * source is unavailable.
         */
        return true;
    }

    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    now() {

        return new this.clock();
    }
}

module.exports = AIDecisionEngine;

module.exports.AIDecisionEngine =
    AIDecisionEngine;

module.exports.DECISION =
    DECISION;

module.exports.DECISION_SOURCE =
    DECISION_SOURCE;

module.exports.ENGINE_STATUS =
    ENGINE_STATUS;

module.exports.ROUTE =
    ROUTE;

module.exports.ACTION_TYPE =
    ACTION_TYPE;

module.exports.VERSION =
    VERSION;