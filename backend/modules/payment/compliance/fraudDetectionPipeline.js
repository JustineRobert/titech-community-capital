'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Fraud Detection Pipeline
 * ============================================================================
 *
 * Purpose
 * -------
 * Pre-ledger fraud control boundary for payment operations.
 *
 * Responsibilities
 * ----------------
 * • Execute fraud risk scoring before ledger posting
 * • Normalize payment/risk inputs
 * • Enforce tenant-aware evaluation context
 * • Generate deterministic fraud fingerprints
 * • Preserve correlation/request identity
 * • Classify fraud outcomes
 * • Produce explainable fraud reasons
 * • Support configurable risk thresholds
 * • Support audit/metrics/logging hooks
 * • Fail closed when the fraud engine is unavailable
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Payment execution
 * • Ledger posting
 * • AML screening
 * • KYC verification
 * • Final compliance decision
 * • Account blocking persistence
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


const riskEngine =
    require('./riskScoringEngine');


/**
 * ============================================================================
 * Status / Decisions
 * ============================================================================
 */

const FRAUD_STATUS = Object.freeze({

    CLEAR:
        'CLEAR',

    REVIEW:
        'REVIEW',

    BLOCK:
        'BLOCK',

    ERROR:
        'ERROR'

});


const FRAUD_LEVELS = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});


const DEFAULTS = Object.freeze({

    blockThreshold:
        70,

    reviewThreshold:
        40,

    transactionThreshold:
        1_000_000,

    riskVersion:
        'fraud-v1',

    failClosed:
        true

});


class FraudDetectionPipeline {

    constructor({

        riskEngineInstance =
            riskEngine,

        logger = null,

        metrics = null,

        auditService = null,

        configuration = {},

        riskVersion =
            DEFAULTS.riskVersion,

        blockThreshold =
            DEFAULTS.blockThreshold,

        reviewThreshold =
            DEFAULTS.reviewThreshold,

        transactionThreshold =
            DEFAULTS.transactionThreshold,

        failClosed =
            DEFAULTS.failClosed,

        clock =
            Date

    } = {}) {

        if (
            !riskEngineInstance ||
            typeof riskEngineInstance.calculate !==
                'function'
        ) {
            throw new Error(
                'A valid fraud risk engine is required'
            );
        }

        this.riskEngine =
            riskEngineInstance;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.auditService =
            auditService;

        this.configuration =
            configuration;

        this.riskVersion =
            riskVersion;

        this.blockThreshold =
            Number.isFinite(
                Number(blockThreshold)
            )
                ? Number(blockThreshold)
                : DEFAULTS.blockThreshold;

        this.reviewThreshold =
            Number.isFinite(
                Number(reviewThreshold)
            )
                ? Number(reviewThreshold)
                : DEFAULTS.reviewThreshold;

        this.transactionThreshold =
            Number.isFinite(
                Number(transactionThreshold)
            )
                ? Number(transactionThreshold)
                : DEFAULTS.transactionThreshold;

        this.failClosed =
            failClosed !== false;

        this.clock =
            clock;

        this.startedAt =
            new this.clock();

        this.statistics = {

            evaluations:
                0,

            clear:
                0,

            review:
                0,

            blocked:
                0,

            errors:
                0

        };

    }

    /**
     * =========================================================================
     * Execute Fraud Screening
     * =========================================================================
     */

    async execute(
        paymentContext = {}
    ) {

        const startedAt =
            Date.now();

        this.statistics.evaluations++;

        const context =
            this.normalizeContext(
                paymentContext
            );

        try {

            this.validateContext(
                context
            );

            const input =
                this.buildRiskInput(
                    context
                );

            const inputFingerprint =
                this.createInputFingerprint(
                    input
                );

            /**
             * -----------------------------------------------------------------
             * Execute risk engine
             * -----------------------------------------------------------------
             */

            const risk =
                await Promise.resolve(
                    this.riskEngine.calculate(
                        input
                    )
                );

            const normalizedRisk =
                this.normalizeRiskResult(
                    risk
                );

            const decision =
                this.determineDecision(
                    normalizedRisk.score
                );

            const reasons =
                this.buildReasons({
                    context,
                    normalizedRisk
                });

            const result = {

                success:
                    true,

                provider:
                    context.provider,

                status:
                    decision.status,

                passed:
                    decision.status ===
                    FRAUD_STATUS.CLEAR,

                requiresReview:
                    decision.status ===
                    FRAUD_STATUS.REVIEW,

                blocked:
                    decision.status ===
                    FRAUD_STATUS.BLOCK,

                riskScore:
                    normalizedRisk.score,

                riskLevel:
                    normalizedRisk.level,

                reasons,

                riskVersion:
                    this.riskVersion,

                inputFingerprint,

                tenantId:
                    context.tenantId,

                customerId:
                    context.customerId,

                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                requestId:
                    context.requestId,

                idempotencyKey:
                    context.idempotencyKey,

                evaluatedAt:
                    new this.clock(),

                durationMs:
                    Date.now() -
                    startedAt

            };

            this.recordDecisionStatistics(
                result.status
            );

            this.metrics?.counter?.(
                'fraud_screening_completed_total'
            );

            this.metrics?.histogram?.(
                'fraud_screening_duration_ms',
                result.durationMs
            );

            this.metrics?.counter?.(
                `fraud_screening_${result.status.toLowerCase()}_total`
            );

            this.logger?.info?.({

                message:
                    'Fraud detection completed',

                tenantId:
                    context.tenantId,

                customerId:
                    context.customerId,

                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                riskScore:
                    result.riskScore,

                riskLevel:
                    result.riskLevel,

                status:
                    result.status,

                riskVersion:
                    result.riskVersion,

                inputFingerprint,

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
                'fraud_screening_error_total'
            );

            this.logger?.error?.({

                message:
                    'Fraud detection pipeline failed',

                tenantId:
                    context.tenantId,

                customerId:
                    context.customerId,

                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                error:
                    this.safeError(
                        error
                    )

            });

            /**
             * Fraud is a pre-ledger control.
             *
             * If the scoring engine cannot make a reliable decision,
             * do not silently approve the payment.
             */
            if (
                this.failClosed
            ) {

                const result = {

                    success:
                        false,

                    provider:
                        context.provider,

                    status:
                        FRAUD_STATUS.ERROR,

                    passed:
                        false,

                    requiresReview:
                        true,

                    blocked:
                        false,

                    riskScore:
                        null,

                    riskLevel:
                        FRAUD_LEVELS.CRITICAL,

                    reasons: [

                        {

                            code:
                                'FRAUD_ENGINE_UNAVAILABLE',

                            severity:
                                'CRITICAL',

                            message:
                                'Fraud risk evaluation could not be completed'

                        }

                    ],

                    riskVersion:
                        this.riskVersion,

                    inputFingerprint:
                        this.createInputFingerprint(
                            this.safeFingerprintInput(
                                context
                            )
                        ),

                    tenantId:
                        context.tenantId,

                    customerId:
                        context.customerId,

                    transactionId:
                        context.transactionId,

                    correlationId:
                        context.correlationId,

                    requestId:
                        context.requestId,

                    idempotencyKey:
                        context.idempotencyKey,

                    evaluatedAt:
                        new this.clock(),

                    durationMs:
                        Date.now() -
                        startedAt,

                    error:
                        this.safeError(
                            error
                        )

                };

                await this.recordAudit(
                    result
                );

                return result;

            }

            throw error;

        }

    }

    /**
     * =========================================================================
     * Context Normalization
     * =========================================================================
     */

    normalizeContext(
        paymentContext
    ) {

        return {

            tenantId:
                paymentContext?.tenantId ??
                null,

            customerId:
                paymentContext?.customerId ??
                paymentContext?.userId ??
                null,

            transactionId:
                paymentContext?.transactionId ??
                paymentContext?.paymentId ??
                null,

            provider:
                String(
                    paymentContext?.provider ||
                    'UNKNOWN'
                )
                    .trim()
                    .toUpperCase(),

            operation:
                String(
                    paymentContext?.operation ||
                    'PAYMENT'
                )
                    .trim()
                    .toUpperCase(),

            correlationId:
                paymentContext?.correlationId ??
                crypto.randomUUID(),

            requestId:
                paymentContext?.requestId ??
                null,

            idempotencyKey:
                paymentContext?.idempotencyKey ??
                null,

            amount:
                paymentContext?.amount ??
                0,

            threshold:
                paymentContext?.threshold ??
                paymentContext?.reportingThreshold ??
                this.transactionThreshold,

            velocity:
                paymentContext?.velocity ??
                paymentContext?.transactionVelocity ??
                0,

            failedAttempts:
                paymentContext?.failedAttempts ??
                0,

            kycStatus:
                paymentContext?.kycStatus ??
                null,

            amlMatch:
                paymentContext?.amlMatch ??
                false

        };

    }

    /**
     * =========================================================================
     * Validate Context
     * =========================================================================
     */

    validateContext(
        context
    ) {

        if (
            !context.tenantId
        ) {

            throw new Error(
                'tenantId required for fraud screening'
            );

        }

        if (
            !context.customerId
        ) {

            throw new Error(
                'customerId required for fraud screening'
            );

        }

        const amount =
            Number(
                context.amount
            );

        if (
            !Number.isFinite(amount) ||
            amount < 0
        ) {

            throw new Error(
                'amount must be a finite non-negative number'
            );

        }

        const velocity =
            Number(
                context.velocity
            );

        if (
            !Number.isFinite(velocity) ||
            velocity < 0
        ) {

            throw new Error(
                'transaction velocity must be a finite non-negative number'
            );

        }

        const failedAttempts =
            Number(
                context.failedAttempts
            );

        if (
            !Number.isFinite(
                failedAttempts
            ) ||
            failedAttempts < 0
        ) {

            throw new Error(
                'failedAttempts must be a finite non-negative number'
            );

        }

        return true;

    }

    /**
     * =========================================================================
     * Risk Input
     * =========================================================================
     */

    buildRiskInput(
        context
    ) {

        return {

            amount:
                Number(
                    context.amount
                ),

            threshold:
                Number(
                    context.threshold
                ),

            transactionVelocity:
                Number(
                    context.velocity
                ),

            failedAttempts:
                Number(
                    context.failedAttempts
                ),

            kycStatus:
                context.kycStatus,

            amlMatch:
                Boolean(
                    context.amlMatch
                )

        };

    }

    /**
     * =========================================================================
     * Safe Fingerprint Input
     * =========================================================================
     *
     * The fingerprint deliberately excludes secrets and raw credentials.
     */

    safeFingerprintInput(
        context
    ) {

        return {

            tenantId:
                context.tenantId,

            customerId:
                context.customerId,

            transactionId:
                context.transactionId,

            provider:
                context.provider,

            operation:
                context.operation,

            amount:
                context.amount,

            threshold:
                context.threshold,

            velocity:
                context.velocity,

            failedAttempts:
                context.failedAttempts,

            kycStatus:
                context.kycStatus,

            amlMatch:
                context.amlMatch,

            riskVersion:
                this.riskVersion

        };

    }

    /**
     * =========================================================================
     * Fingerprint
     * =========================================================================
     */

    createInputFingerprint(
        input
    ) {

        const canonical =
            JSON.stringify(
                this.sortObject(
                    input
                )
            );

        return crypto
            .createHash('sha256')
            .update(
                canonical,
                'utf8'
            )
            .digest('hex');

    }

    /**
     * =========================================================================
     * Stable Object Sorting
     * =========================================================================
     */

    sortObject(
        value
    ) {

        if (
            value === null ||
            typeof value !== 'object'
        ) {

            return value;

        }

        if (
            Array.isArray(value)
        ) {

            return value.map(
                item =>
                    this.sortObject(
                        item
                    )
            );

        }

        return Object.keys(value)
            .sort()
            .reduce(
                (
                    sorted,
                    key
                ) => {

                    sorted[key] =
                        this.sortObject(
                            value[key]
                        );

                    return sorted;

                },
                {}
            );

    }

    /**
     * =========================================================================
     * Risk Result Normalization
     * =========================================================================
     */

    normalizeRiskResult(
        risk
    ) {

        if (
            !risk ||
            typeof risk !== 'object'
        ) {

            throw new Error(
                'Fraud risk engine returned an invalid result'
            );

        }

        const score =
            Number(
                risk.score
            );

        if (
            !Number.isFinite(score)
        ) {

            throw new Error(
                'Fraud risk engine returned an invalid score'
            );

        }

        const normalizedScore =
            Math.min(
                Math.max(score, 0),
                100
            );

        return {

            score:
                normalizedScore,

            level:
                this.normalizeRiskLevel(
                    risk.level,
                    normalizedScore
                ),

            reasons:
                Array.isArray(
                    risk.reasons
                )
                    ? risk.reasons
                    : []

        };

    }

    /**
     * =========================================================================
     * Risk Level
     * =========================================================================
     */

    normalizeRiskLevel(
        level,
        score
    ) {

        if (
            level
        ) {

            const normalized =
                String(
                    level
                )
                    .trim()
                    .toUpperCase();

            if (
                Object.values(
                    FRAUD_LEVELS
                ).includes(
                    normalized
                )
            ) {

                return normalized;

            }

        }

        if (
            score >= 80
        ) {

            return FRAUD_LEVELS.CRITICAL;

        }

        if (
            score >= 70
        ) {

            return FRAUD_LEVELS.HIGH;

        }

        if (
            score >= 40
        ) {

            return FRAUD_LEVELS.MEDIUM;

        }

        return FRAUD_LEVELS.LOW;

    }

    /**
     * =========================================================================
     * Decision
     * =========================================================================
     */

    determineDecision(
        score
    ) {

        if (
            score >=
            this.blockThreshold
        ) {

            return {

                status:
                    FRAUD_STATUS.BLOCK

            };

        }

        if (
            score >=
            this.reviewThreshold
        ) {

            return {

                status:
                    FRAUD_STATUS.REVIEW

            };

        }

        return {

            status:
                FRAUD_STATUS.CLEAR

        };

    }

    /**
     * =========================================================================
     * Explainable Reasons
     * =========================================================================
     */

    buildReasons({

        context,

        normalizedRisk

    }) {

        const reasons = [];


        if (
            normalizedRisk.score >=
            this.blockThreshold
        ) {

            reasons.push({

                code:
                    'FRAUD_RISK_THRESHOLD',

                severity:
                    'CRITICAL',

                message:
                    'Fraud risk score exceeds the configured blocking threshold',

                evidence: {

                    score:
                        normalizedRisk.score,

                    threshold:
                        this.blockThreshold

                }

            });

        }
        else if (
            normalizedRisk.score >=
            this.reviewThreshold
        ) {

            reasons.push({

                code:
                    'FRAUD_RISK_REVIEW_THRESHOLD',

                severity:
                    'HIGH',

                message:
                    'Fraud risk score requires review',

                evidence: {

                    score:
                        normalizedRisk.score,

                    threshold:
                        this.reviewThreshold

                }

            });

        }


        if (
            Number(
                context.amount
            ) >
            Number(
                context.threshold
            )
        ) {

            reasons.push({

                code:
                    'LARGE_TRANSACTION',

                severity:
                    'MEDIUM',

                message:
                    'Transaction exceeds configured fraud monitoring threshold',

                evidence: {

                    amount:
                        context.amount,

                    threshold:
                        context.threshold

                }

            });

        }


        /**
         * Preserve detailed reasons from the underlying risk engine.
         */
        for (
            const reason
            of normalizedRisk.reasons
        ) {

            if (
                typeof reason === 'string'
            ) {

                reasons.push({

                    code:
                        'RISK_ENGINE_SIGNAL',

                    severity:
                        'MEDIUM',

                    message:
                        reason

                });

                continue;

            }

            if (
                reason &&
                typeof reason === 'object'
            ) {

                reasons.push({

                    code:
                        reason.code ||
                        'RISK_ENGINE_SIGNAL',

                    severity:
                        reason.severity ||
                        'MEDIUM',

                    message:
                        reason.message ||
                        reason.reason ||
                        'Fraud risk signal detected',

                    evidence:
                        reason.evidence

                });

            }

        }


        return reasons;

    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    recordDecisionStatistics(
        status
    ) {

        switch (
            status
        ) {

            case FRAUD_STATUS.CLEAR:

                this.statistics.clear++;

                break;

            case FRAUD_STATUS.REVIEW:

                this.statistics.review++;

                break;

            case FRAUD_STATUS.BLOCK:

                this.statistics.blocked++;

                break;

            default:
                break;

        }

    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAudit(
        result
    ) {

        if (
            !this.auditService?.record
        ) {

            return;

        }

        try {

            await this.auditService.record({

                action:
                    'FRAUD_SCREENING_COMPLETED',

                tenantId:
                    result.tenantId,

                correlationId:
                    result.correlationId,

                metadata: {

                    transactionId:
                        result.transactionId,

                    customerId:
                        result.customerId,

                    status:
                        result.status,

                    riskScore:
                        result.riskScore,

                    riskLevel:
                        result.riskLevel,

                    riskVersion:
                        result.riskVersion,

                    inputFingerprint:
                        result.inputFingerprint

                }

            });

        }
        catch (error) {

            /**
             * Audit infrastructure must never mutate
             * the fraud result itself.
             */
            this.metrics?.counter?.(
                'fraud_screening_audit_failure_total'
            );

            this.logger?.warn?.({

                message:
                    'Fraud screening audit recording failed',

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
     * Error Sanitization
     * =========================================================================
     */

    safeError(
        error
    ) {

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
                )
                    .slice(
                        0,
                        500
                    ),

            retryable:
                error.retryable

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
                'FRAUD_DETECTION_PIPELINE',

            status:
                this.statistics.errors > 0
                    ? 'DEGRADED'
                    : 'UP',

            riskVersion:
                this.riskVersion,

            failClosed:
                this.failClosed,

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

            riskVersion:
                this.riskVersion,

            blockThreshold:
                this.blockThreshold,

            reviewThreshold:
                this.reviewThreshold,

            transactionThreshold:
                this.transactionThreshold,

            failClosed:
                this.failClosed,

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

            fraudScoring:
                true,

            preLedgerControl:
                true,

            explainableReasons:
                true,

            tenantAware:
                true,

            correlationAware:
                true,

            inputFingerprinting:
                true,

            riskVersioning:
                true,

            configurableThresholds:
                true,

            failClosed:
                this.failClosed,

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

const fraudDetectionPipeline =
    new FraudDetectionPipeline();


module.exports =
    fraudDetectionPipeline;


/**
 * Named exports for dependency injection and tests.
 */

module.exports.FraudDetectionPipeline =
    FraudDetectionPipeline;

module.exports.FRAUD_STATUS =
    FRAUD_STATUS;

module.exports.FRAUD_LEVELS =
    FRAUD_LEVELS;