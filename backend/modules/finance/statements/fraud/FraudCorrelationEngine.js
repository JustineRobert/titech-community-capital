'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * FraudCorrelationEngine
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/fraud/FraudCorrelationEngine.js
 *
 * Purpose:
 *   Enterprise fraud-intelligence correlation and risk aggregation engine.
 *
 * Pipeline position:
 *
 *   Statement / Ledger / Transaction Intelligence
 *                    │
 *                    ▼
 *        ┌───────────────────────────┐
 *        │ Fraud Signal Producers    │
 *        │                           │
 *        │ CrossAccountAnalyzer      │
 *        │ Anomaly Detectors         │
 *        │ Velocity Detectors        │
 *        │ Network Detectors         │
 *        │ AI Risk Components        │
 *        └─────────────┬─────────────┘
 *                      │
 *                      ▼
 *        ┌───────────────────────────┐
 *        │ FraudCorrelationEngine    │
 *        │                           │
 *        │ Normalize                 │
 *        │ Validate                  │
 *        │ Correlate                 │
 *        │ Cluster                   │
 *        │ Score                     │
 *        │ Calculate Confidence      │
 *        │ Aggregate Evidence        │
 *        │ Explain                   │
 *        │ Suppress Duplicates       │
 *        └─────────────┬─────────────┘
 *                      │
 *                      ▼
 *             FraudAlertService
 *                      │
 *          ┌───────────┼───────────┐
 *          ▼           ▼           ▼
 *       Alerts     Notifications  Cases
 *
 * Design principles:
 *   - Tenant isolated
 *   - Deterministic correlation
 *   - Explainable scoring
 *   - No ledger mutation
 *   - No transaction mutation
 *   - No account freezing
 *   - No legal fraud declaration
 *   - Repository agnostic
 *   - Dependency injectable
 *   - Safe failure boundaries
 *   - Idempotent correlation
 *   - Bounded memory operations
 *   - Production observability hooks
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Module Metadata
 * ============================================================================
 */

const MODULE_NAME =
    'FraudCorrelationEngine';

const MODULE_VERSION =
    '1.0.0';

const CORRELATION_SCHEMA_VERSION =
    '1.0.0';

/**
 * ============================================================================
 * Signal Types
 * ============================================================================
 */

const SIGNAL_TYPE =
    Object.freeze({

        TRANSACTION_ANOMALY:
            'TRANSACTION_ANOMALY',

        ACCOUNT_ANOMALY:
            'ACCOUNT_ANOMALY',

        CROSS_ACCOUNT:
            'CROSS_ACCOUNT',

        CIRCULAR_MOVEMENT:
            'CIRCULAR_MOVEMENT',

        RAPID_FUND_MOVEMENT:
            'RAPID_FUND_MOVEMENT',

        FAN_IN:
            'FAN_IN',

        FAN_OUT:
            'FAN_OUT',

        SHARED_COUNTERPARTY:
            'SHARED_COUNTERPARTY',

        SHARED_DEVICE:
            'SHARED_DEVICE',

        SHARED_IP:
            'SHARED_IP',

        SHARED_IDENTIFIER:
            'SHARED_IDENTIFIER',

        COORDINATED_ACTIVITY:
            'COORDINATED_ACTIVITY',

        NETWORK_CLUSTER:
            'NETWORK_CLUSTER',

        VELOCITY:
            'VELOCITY',

        CONCENTRATION:
            'CONCENTRATION',

        BEHAVIORAL_ANOMALY:
            'BEHAVIORAL_ANOMALY',

        AI_RISK:
            'AI_RISK',

        MANUAL:
            'MANUAL'
    });

/**
 * ============================================================================
 * Correlation Types
 * ============================================================================
 */

const CORRELATION_TYPE =
    Object.freeze({

        ACCOUNT:
            'ACCOUNT',

        TRANSACTION:
            'TRANSACTION',

        CROSS_ACCOUNT:
            'CROSS_ACCOUNT',

        NETWORK:
            'NETWORK',

        BEHAVIOR:
            'BEHAVIOR',

        TEMPORAL:
            'TEMPORAL',

        ENTITY:
            'ENTITY',

        COMPOSITE:
            'COMPOSITE'
    });

/**
 * ============================================================================
 * Risk Levels
 * ============================================================================
 */

const RISK_LEVEL =
    Object.freeze({

        MINIMAL:
            'MINIMAL',

        LOW:
            'LOW',

        MEDIUM:
            'MEDIUM',

        HIGH:
            'HIGH',

        CRITICAL:
            'CRITICAL'
    });

/**
 * ============================================================================
 * Alert Severity
 * ============================================================================
 */

const ALERT_SEVERITY =
    Object.freeze({

        LOW:
            'LOW',

        MEDIUM:
            'MEDIUM',

        HIGH:
            'HIGH',

        CRITICAL:
            'CRITICAL'
    });

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULT_CONFIG =
    Object.freeze({

        minimumSignalScore:
            0.05,

        correlationThreshold:
            0.30,

        strongCorrelationThreshold:
            0.65,

        highRiskThreshold:
            0.65,

        criticalRiskThreshold:
            0.85,

        minimumSignalsForHighConfidence:
            2,

        maximumSignalsPerCorrelation:
            250,

        maximumClusters:
            100,

        maximumAccountsPerCluster:
            250,

        maximumTransactionsPerCluster:
            1000,

        maximumEvidenceItems:
            500,

        maximumRelatedEntities:
            500,

        temporalWindowMinutes:
            1440,

        strongTemporalWindowMinutes:
            120,

        deduplicationWindowMinutes:
            1440,

        minimumClusterScore:
            0.20,

        evidenceWeight:
            0.20,

        signalWeight:
            0.50,

        diversityWeight:
            0.15,

        consistencyWeight:
            0.15,

        enableAlertCreation:
            true,

        enableDeduplication:
            true,

        enableNotifications:
            true,

        enableAudit:
            true,

        enableMetrics:
            true,

        requireTenantId:
            true,

        preserveRawSignals:
            false,

        failOnInvalidSignal:
            false,

        failOnAlertFailure:
            false,

        enableAIAdjustment:
            true,

        aiAdjustmentWeight:
            0.15,

        correlationIdAlgorithm:
            'sha256'
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class FraudCorrelationEngineError extends Error {

    constructor(
        message,
        code = 'FRAUD_CORRELATION_ENGINE_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'FraudCorrelationEngineError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            FraudCorrelationEngineError
        );
    }
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(
    value
) {

    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function isArray(
    value
) {

    return Array.isArray(
        value
    );
}

function normalizeString(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return normalized || null;
}

function normalizeId(
    value
) {

    return normalizeString(
        value
    );
}

function safeNumber(
    value
) {

    const number =
        Number(
            value
        );

    return Number.isFinite(
        number
    )
        ? number
        : 0;
}

function clamp(
    value,
    minimum = 0,
    maximum = 1
) {

    return Math.max(
        minimum,
        Math.min(
            maximum,
            safeNumber(
                value
            )
        )
    );
}

function round(
    value,
    decimals = 6
) {

    const multiplier =
        Math.pow(
            10,
            decimals
        );

    return (
        Math.round(
            safeNumber(
                value
            ) *
            multiplier
        ) /
        multiplier
    );
}

function now() {

    return new Date()
        .toISOString();
}

function unique(
    values
) {

    return [
        ...new Set(
            values.filter(
                value =>
                    value !== null &&
                    value !== undefined &&
                    value !== ''
            )
        )
    ];
}

function intersection(
    first,
    second
) {

    const set =
        new Set(
            first
        );

    return second.filter(
        item =>
            set.has(
                item
            )
    );
}

/**
 * ============================================================================
 * FraudCorrelationEngine
 * ============================================================================
 */

class FraudCorrelationEngine {

    constructor(
        options = {}
    ) {

        this.crossAccountAnalyzer =
            options.crossAccountAnalyzer ||
            null;

        this.alertService =
            options.alertService ||
            null;

        this.repository =
            options.repository ||
            options.correlationRepository ||
            null;

        this.aiScorer =
            options.aiScorer ||
            options.confidenceScorer ||
            null;

        this.featureExtractor =
            options.featureExtractor ||
            null;

        this.logger =
            options.logger ||
            null;

        this.auditLogger =
            options.auditLogger ||
            null;

        this.metrics =
            options.metrics ||
            null;

        this.notificationService =
            options.notificationService ||
            null;

        this.config = {

            ...DEFAULT_CONFIG,

            ...(options.config || {})
        };

        this.instanceId =
            require('crypto')
                .randomBytes(
                    12
                )
                .toString(
                    'hex'
                );

        this.initialized =
            true;
    }

    /**
     * =========================================================================
     * Logging
     * =========================================================================
     */

    log(
        level,
        message,
        metadata = {}
    ) {

        if (
            !this.logger
        ) {

            return;
        }

        try {

            if (
                typeof this.logger[level] ===
                'function'
            ) {

                this.logger[level](
                    message,
                    {

                        module:
                            MODULE_NAME,

                        version:
                            MODULE_VERSION,

                        ...metadata
                    }
                );
            }

        } catch (
            error
        ) {

            /*
             * Observability must never become a transaction/fraud-processing
             * failure source.
             */
        }
    }

    /**
     * =========================================================================
     * Primary Correlation API
     * =========================================================================
     */

    async correlate(
        input = {},
        context = {}
    ) {

        const startedAt =
            Date.now();

        const normalized =
            this.normalizeCorrelationInput(
                input,
                context
            );

        const correlationId =
            this.generateCorrelationId(
                normalized
            );

        normalized.correlationId =
            correlationId;

        this.recordMetric(
            'fraud_correlation_started',
            {

                tenantId:
                    normalized.tenantId
            }
        );

        try {

            const signals =
                this.normalizeSignals(
                    normalized.signals,
                    normalized.tenantId
                );

            if (
                signals.length === 0
            ) {

                return this.buildEmptyCorrelationResult(
                    normalized,
                    startedAt
                );
            }

            const clusters =
                this.buildSignalClusters(
                    signals
                );

            const correlations =
                [];

            for (
                const cluster
                of clusters
            ) {

                const correlation =
                    await this.correlateCluster(
                        cluster,
                        normalized,
                        context
                    );

                if (
                    correlation &&
                    correlation.riskScore >=
                    this.config.minimumClusterScore
                ) {

                    correlations.push(
                        correlation
                    );
                }
            }

            const result =
                this.buildCorrelationResult(
                    normalized,
                    signals,
                    clusters,
                    correlations,
                    startedAt
                );

            await this.persistCorrelation(
                result
            );

            await this.createAlerts(
                result,
                context
            );

            this.recordAudit(
                'FRAUD_CORRELATION_COMPLETED',
                {

                    correlationId,

                    tenantId:
                        normalized.tenantId,

                    signalCount:
                        signals.length,

                    clusterCount:
                        clusters.length,

                    correlationCount:
                        correlations.length,

                    riskScore:
                        result.riskScore,

                    riskLevel:
                        result.riskLevel
                },
                context.actor
            );

            this.recordMetric(
                'fraud_correlation_completed',
                {

                    tenantId:
                        normalized.tenantId,

                    riskLevel:
                        result.riskLevel
                }
            );

            this.log(
                'info',
                'Fraud correlation completed.',
                {

                    correlationId,

                    tenantId:
                        normalized.tenantId,

                    signalCount:
                        signals.length,

                    correlationCount:
                        correlations.length,

                    riskScore:
                        result.riskScore,

                    durationMs:
                        Date.now() -
                        startedAt
                }
            );

            return result;

        } catch (
            error
        ) {

            this.recordMetric(
                'fraud_correlation_failure',
                {

                    tenantId:
                        normalized.tenantId
                }
            );

            this.log(
                'error',
                'Fraud correlation failed.',
                {

                    correlationId,

                    tenantId:
                        normalized.tenantId,

                    error:
                        error.message,

                    code:
                        error.code
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * Correlate Signals Convenience API
     * =========================================================================
     */

    async correlateSignals(
        signals,
        context = {}
    ) {

        return this.correlate(
            {

                tenantId:
                    context.tenantId,

                signals,

                source:
                    context.source,

                accountId:
                    context.accountId,

                transactionId:
                    context.transactionId,

                analysisId:
                    context.analysisId
            },
            context
        );
    }

    /**
     * =========================================================================
     * Correlate Analyzer Result
     * =========================================================================
     */

    async correlateAnalysis(
        analysis,
        context = {}
    ) {

        if (
            !isObject(
                analysis
            )
        ) {

            throw new FraudCorrelationEngineError(
                'Analysis result must be an object.',
                'INVALID_ANALYSIS_RESULT'
            );
        }

        const signals =
            isArray(
                analysis.signals
            )
                ? analysis.signals
                : [];

        return this.correlate(
            {

                tenantId:
                    context.tenantId ||
                    analysis.tenantId,

                analysisId:
                    context.analysisId ||
                    analysis.analysisId,

                accountId:
                    context.accountId ||
                    analysis.accountId,

                transactionId:
                    context.transactionId ||
                    analysis.transactionId,

                signals,

                source:
                    context.source ||
                    analysis.source
            },
            context
        );
    }

    /**
     * =========================================================================
     * Input Normalization
     * =========================================================================
     */

    normalizeCorrelationInput(
        input,
        context
    ) {

        if (
            !isObject(
                input
            )
        ) {

            throw new FraudCorrelationEngineError(
                'Correlation input must be an object.',
                'INVALID_CORRELATION_INPUT'
            );
        }

        const tenantId =
            normalizeId(
                input.tenantId ||
                context.tenantId ||
                context.tenant?.id
            );

        if (
            this.config.requireTenantId &&
            !tenantId
        ) {

            throw new FraudCorrelationEngineError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }

        return {

            tenantId,

            analysisId:
                normalizeId(
                    input.analysisId
                ),

            accountId:
                normalizeId(
                    input.accountId
                ),

            transactionId:
                normalizeId(
                    input.transactionId
                ),

            source:
                normalizeString(
                    input.source
                ),

            detectedAt:
                input.detectedAt ||
                now(),

            windowStart:
                input.windowStart ||
                null,

            windowEnd:
                input.windowEnd ||
                null,

            signals:
                isArray(
                    input.signals
                )
                    ? input.signals
                    : [],

            metadata:
                this.sanitizeMetadata(
                    input.metadata
                )
        };
    }

    /**
     * =========================================================================
     * Signal Normalization
     * =========================================================================
     */

    normalizeSignals(
        signals,
        tenantId
    ) {

        if (
            !isArray(
                signals
            )
        ) {

            return [];
        }

        const normalized =
            [];

        for (
            const signal
            of signals
        ) {

            try {

                const normalizedSignal =
                    this.normalizeSignal(
                        signal,
                        tenantId
                    );

                if (
                    normalizedSignal.score <
                    this.config.minimumSignalScore
                ) {

                    continue;
                }

                normalized.push(
                    normalizedSignal
                );

            } catch (
                error
            ) {

                if (
                    this.config.failOnInvalidSignal
                ) {

                    throw error;
                }

                this.log(
                    'warn',
                    'Invalid fraud signal skipped.',
                    {

                        tenantId,

                        error:
                            error.message
                    }
                );
            }
        }

        return normalized
            .slice(
                0,
                this.config.maximumSignalsPerCorrelation
            );
    }

    normalizeSignal(
        signal,
        tenantId
    ) {

        if (
            !isObject(
                signal
            )
        ) {

            throw new FraudCorrelationEngineError(
                'Fraud signal must be an object.',
                'INVALID_FRAUD_SIGNAL'
            );
        }

        const score =
            clamp(
                signal.score ??
                signal.riskScore ??
                signal.confidence
            );

        const detectedAt =
            signal.detectedAt ||
            signal.timestamp ||
            now();

        return {

            id:
                normalizeId(
                    signal.id
                ) ||
                this.generateSignalId(
                    signal
                ),

            tenantId,

            type:
                normalizeString(
                    signal.type
                )?.toUpperCase() ||
                SIGNAL_TYPE.TRANSACTION_ANOMALY,

            source:
                normalizeString(
                    signal.source
                )?.toUpperCase() ||
                'UNKNOWN',

            score,

            confidence:
                clamp(
                    signal.confidence ??
                    score
                ),

            severity:
                this.normalizeSeverity(
                    signal.severity,
                    score
                ),

            accountId:
                normalizeId(
                    signal.accountId
                ),

            relatedAccountId:
                normalizeId(
                    signal.relatedAccountId
                ),

            accountIds:
                this.normalizeIds(
                    signal.accountIds
                ),

            transactionId:
                normalizeId(
                    signal.transactionId
                ),

            transactionIds:
                this.normalizeIds(
                    signal.transactionIds
                ),

            entityIds:
                this.normalizeIds(
                    signal.entityIds
                ),

            deviceId:
                normalizeId(
                    signal.deviceId
                ),

            ipAddress:
                normalizeId(
                    signal.ipAddress
                ),

            fingerprint:
                normalizeString(
                    signal.fingerprint
                ),

            detectedAt,

            evidence:
                this.normalizeEvidence(
                    signal.evidence
                ),

            tags:
                this.normalizeTags(
                    signal.tags
                ),

            metadata:
                this.sanitizeMetadata(
                    signal.metadata
                ),

            explanation:
                normalizeString(
                    signal.explanation
                ),

            model:
                normalizeString(
                    signal.model
                ),

            modelVersion:
                normalizeString(
                    signal.modelVersion
                )
        };
    }

    generateSignalId(
        signal
    ) {

        const crypto =
            require('crypto');

        const payload =
            JSON.stringify(
                {

                    type:
                        signal.type,

                    source:
                        signal.source,

                    accountId:
                        signal.accountId,

                    transactionId:
                        signal.transactionId,

                    detectedAt:
                        signal.detectedAt
                }
            );

        return crypto
            .createHash(
                'sha256'
            )
            .update(
                payload
            )
            .digest(
                'hex'
            );
    }

    /**
     * =========================================================================
     * Signal Clustering
     * =========================================================================
     *
     * The clustering algorithm intentionally avoids an external graph
     * dependency. This makes the engine deterministic, deployable, and
     * compatible with the existing backend architecture.
     *
     * Two signals can belong to the same cluster when they share:
     *
     *   - account
     *   - transaction
     *   - related account
     *   - entity
     *   - device
     *   - IP
     *   - fingerprint
     *   - temporal proximity
     *   - explicit correlation key
     */

    buildSignalClusters(
        signals
    ) {

        const clusters =
            [];

        const visited =
            new Set();

        for (
            let index = 0;
            index < signals.length;
            index++
        ) {

            if (
                visited.has(
                    index
                )
            ) {

                continue;
            }

            const clusterIndexes =
                this.expandCluster(
                    signals,
                    index,
                    visited
                );

            const clusterSignals =
                clusterIndexes.map(
                    clusterIndex =>
                        signals[
                            clusterIndex
                        ]
                );

            if (
                clusterSignals.length
            ) {

                clusters.push(
                    this.buildCluster(
                        clusterSignals
                    )
                );
            }

            if (
                clusters.length >=
                this.config.maximumClusters
            ) {

                break;
            }
        }

        return clusters;
    }

    expandCluster(
        signals,
        startIndex,
        visited
    ) {

        const queue =
            [
                startIndex
            ];

        const indexes =
            [];

        while (
            queue.length
        ) {

            const currentIndex =
                queue.shift();

            if (
                visited.has(
                    currentIndex
                )
            ) {

                continue;
            }

            visited.add(
                currentIndex
            );

            indexes.push(
                currentIndex
            );

            const current =
                signals[
                    currentIndex
                ];

            for (
                let index = 0;
                index < signals.length;
                index++
            ) {

                if (
                    visited.has(
                        index
                    )
                ) {

                    continue;
                }

                const candidate =
                    signals[
                        index
                    ];

                const correlationStrength =
                    this.calculateSignalCorrelation(
                        current,
                        candidate
                    );

                if (
                    correlationStrength >=
                    this.config.correlationThreshold
                ) {

                    queue.push(
                        index
                    );
                }
            }
        }

        return indexes;
    }

    calculateSignalCorrelation(
        first,
        second
    ) {

        if (
            first.id ===
            second.id
        ) {

            return 1;
        }

        let score =
            0;

        const sharedAccounts =
            this.sharedEntityCount(
                [

                    first.accountId,

                    first.relatedAccountId,

                    ...first.accountIds
                ],
                [

                    second.accountId,

                    second.relatedAccountId,

                    ...second.accountIds
                ]
            );

        if (
            sharedAccounts > 0
        ) {

            score +=
                0.35;
        }

        const sharedTransactions =
            this.sharedEntityCount(
                [

                    first.transactionId,

                    ...first.transactionIds
                ],
                [

                    second.transactionId,

                    ...second.transactionIds
                ]
            );

        if (
            sharedTransactions > 0
        ) {

            score +=
                0.35;
        }

        const sharedEntities =
            this.sharedEntityCount(
                first.entityIds,
                second.entityIds
            );

        if (
            sharedEntities > 0
        ) {

            score +=
                0.20;
        }

        if (
            first.deviceId &&
            first.deviceId ===
            second.deviceId
        ) {

            score +=
                0.15;
        }

        if (
            first.ipAddress &&
            first.ipAddress ===
            second.ipAddress
        ) {

            score +=
                0.10;
        }

        if (
            first.fingerprint &&
            first.fingerprint ===
            second.fingerprint
        ) {

            score +=
                0.50;
        }

        if (
            first.type ===
            second.type
        ) {

            score +=
                0.05;
        }

        if (
            first.source ===
            second.source
        ) {

            score +=
                0.03;
        }

        if (
            this.areTemporallyClose(
                first.detectedAt,
                second.detectedAt
            )
        ) {

            score +=
                0.10;
        }

        return clamp(
            score
        );
    }

    buildCluster(
        signals
    ) {

        const accountIds =
            unique(
                signals.flatMap(
                    signal => [

                        signal.accountId,

                        signal.relatedAccountId,

                        ...signal.accountIds
                    ]
                )
            );

        const transactionIds =
            unique(
                signals.flatMap(
                    signal => [

                        signal.transactionId,

                        ...signal.transactionIds
                    ]
                )
            );

        const entityIds =
            unique(
                signals.flatMap(
                    signal =>
                        signal.entityIds
                )
            );

        const types =
            unique(
                signals.map(
                    signal =>
                        signal.type
                )
            );

        const sources =
            unique(
                signals.map(
                    signal =>
                        signal.source
                )
            );

        const severities =
            unique(
                signals.map(
                    signal =>
                        signal.severity
                )
            );

        return {

            id:
                this.generateClusterId(
                    signals
                ),

            signals,

            signalCount:
                signals.length,

            accountIds:
                accountIds.slice(
                    0,
                    this.config.maximumAccountsPerCluster
                ),

            transactionIds:
                transactionIds.slice(
                    0,
                    this.config.maximumTransactionsPerCluster
                ),

            entityIds:
                entityIds.slice(
                    0,
                    this.config.maximumRelatedEntities
                ),

            types,

            sources,

            severities
        };
    }

    /**
     * =========================================================================
     * Cluster Correlation
     * =========================================================================
     */

    async correlateCluster(
        cluster,
        input,
        context
    ) {

        const baseScore =
            this.calculateBaseRiskScore(
                cluster
            );

        const diversityScore =
            this.calculateSignalDiversity(
                cluster
            );

        const consistencyScore =
            this.calculateSignalConsistency(
                cluster
            );

        const evidenceScore =
            this.calculateEvidenceStrength(
                cluster
            );

        const temporalScore =
            this.calculateTemporalRisk(
                cluster
            );

        const networkScore =
            this.calculateNetworkRisk(
                cluster
            );

        const aiAdjustment =
            await this.calculateAIAdjustment(
                cluster,
                context
            );

        const riskScore =
            this.calculateCompositeRiskScore(
                {

                    baseScore,

                    diversityScore,

                    consistencyScore,

                    evidenceScore,

                    temporalScore,

                    networkScore,

                    aiAdjustment
                }
            );

        const confidence =
            this.calculateConfidence(
                {

                    cluster,

                    riskScore,

                    diversityScore,

                    consistencyScore,

                    evidenceScore
                }
            );

        const riskLevel =
            this.getRiskLevel(
                riskScore
            );

        const severity =
            this.getSeverity(
                riskScore
            );

        const explanation =
            this.buildExplanation(
                {

                    cluster,

                    riskScore,

                    confidence,

                    diversityScore,

                    consistencyScore,

                    evidenceScore,

                    temporalScore,

                    networkScore
                }
            );

        const evidence =
            this.aggregateEvidence(
                cluster
            );

        const correlationType =
            this.determineCorrelationType(
                cluster
            );

        return {

            id:
                this.generateCorrelationIdForCluster(
                    cluster,
                    input.tenantId
                ),

            correlationId:
                input.correlationId,

            tenantId:
                input.tenantId,

            type:
                correlationType,

            signalCount:
                cluster.signalCount,

            signalIds:
                cluster.signals.map(
                    signal =>
                        signal.id
                ),

            accountIds:
                cluster.accountIds,

            transactionIds:
                cluster.transactionIds,

            entityIds:
                cluster.entityIds,

            signalTypes:
                cluster.types,

            signalSources:
                cluster.sources,

            riskScore,

            riskLevel,

            severity,

            confidence,

            scores: {

                base:
                    round(
                        baseScore
                    ),

                diversity:
                    round(
                        diversityScore
                    ),

                consistency:
                    round(
                        consistencyScore
                    ),

                evidence:
                    round(
                        evidenceScore
                    ),

                temporal:
                    round(
                        temporalScore
                    ),

                network:
                    round(
                        networkScore
                    ),

                aiAdjustment:
                    round(
                        aiAdjustment
                    ),

                composite:
                    round(
                        riskScore
                    )
            },

            evidence,

            explanation,

            tags:
                this.buildCorrelationTags(
                    cluster,
                    riskLevel
                ),

            detectedAt:
                this.getEarliestSignalDate(
                    cluster.signals
                ),

            latestSignalAt:
                this.getLatestSignalDate(
                    cluster.signals
                ),

            metadata: {

                schemaVersion:
                    CORRELATION_SCHEMA_VERSION,

                clusterId:
                    cluster.id,

                sourceAnalysisId:
                    input.analysisId,

                accountCount:
                    cluster.accountIds.length,

                transactionCount:
                    cluster.transactionIds.length,

                entityCount:
                    cluster.entityIds.length
            }
        };
    }

    /**
     * =========================================================================
     * Base Risk
     * =========================================================================
     */

    calculateBaseRiskScore(
        cluster
    ) {

        if (
            !cluster.signals.length
        ) {

            return 0;
        }

        const scores =
            cluster.signals.map(
                signal =>
                    clamp(
                        signal.score
                    )
            );

        /*
         * Weighted toward the strongest signals while preserving supporting
         * evidence from the rest of the cluster.
         */

        const sorted =
            [
                ...scores
            ].sort(
                (
                    first,
                    second
                ) =>
                    second -
                    first
            );

        let weighted =
            0;

        let weight =
            1;

        let totalWeight =
            0;

        for (
            const score
            of sorted
        ) {

            weighted +=
                score *
                weight;

            totalWeight +=
                weight;

            weight *=
                0.55;
        }

        return clamp(
            weighted /
            Math.max(
                totalWeight,
                1
            )
        );
    }

    /**
     * =========================================================================
     * Signal Diversity
     * =========================================================================
     */

    calculateSignalDiversity(
        cluster
    ) {

        if (
            cluster.signalCount <=
            1
        ) {

            return 0;
        }

        const typeCount =
            new Set(
                cluster.types
            ).size;

        const sourceCount =
            new Set(
                cluster.sources
            ).size;

        const typeDiversity =
            clamp(
                typeCount /
                Math.min(
                    cluster.signalCount,
                    5
                )
            );

        const sourceDiversity =
            clamp(
                sourceCount /
                Math.min(
                    cluster.signalCount,
                    4
                )
            );

        return clamp(
            (
                typeDiversity *
                0.65
            ) +
            (
                sourceDiversity *
                0.35
            )
        );
    }

    /**
     * =========================================================================
     * Signal Consistency
     * =========================================================================
     */

    calculateSignalConsistency(
        cluster
    ) {

        if (
            cluster.signalCount <=
            1
        ) {

            return 0.50;
        }

        const scores =
            cluster.signals.map(
                signal =>
                    clamp(
                        signal.score
                    )
            );

        const average =
            scores.reduce(
                (
                    total,
                    score
                ) =>
                    total +
                    score,
                0
            ) /
            scores.length;

        const variance =
            scores.reduce(
                (
                    total,
                    score
                ) =>
                    total +
                    Math.pow(
                        score -
                        average,
                        2
                    ),
                0
            ) /
            scores.length;

        const deviation =
            Math.sqrt(
                variance
            );

        return clamp(
            1 -
            deviation
        );
    }

    /**
     * =========================================================================
     * Evidence Strength
     * =========================================================================
     */

    calculateEvidenceStrength(
        cluster
    ) {

        let evidenceCount =
            0;

        let highQualityEvidence =
            0;

        for (
            const signal
            of cluster.signals
        ) {

            if (
                isObject(
                    signal.evidence
                )
            ) {

                const keys =
                    Object.keys(
                        signal.evidence
                    );

                evidenceCount +=
                    keys.length;

                if (
                    keys.length >=
                    3
                ) {

                    highQualityEvidence++;
                }
            }

            if (
                signal.transactionId
            ) {

                evidenceCount++;
            }

            if (
                signal.accountId
            ) {

                evidenceCount++;
            }

            if (
                signal.relatedAccountId
            ) {

                evidenceCount++;
            }
        }

        const evidenceDensity =
            clamp(
                evidenceCount /
                Math.max(
                    cluster.signalCount *
                    5,
                    1
                )
            );

        const quality =
            cluster.signalCount
                ? highQualityEvidence /
                  cluster.signalCount
                : 0;

        return clamp(
            (
                evidenceDensity *
                0.65
            ) +
            (
                quality *
                0.35
            )
        );
    }

    /**
     * =========================================================================
     * Temporal Risk
     * =========================================================================
     */

    calculateTemporalRisk(
        cluster
    ) {

        if (
            cluster.signals.length <=
            1
        ) {

            return 0;
        }

        const timestamps =
            cluster.signals
                .map(
                    signal =>
                        Date.parse(
                            signal.detectedAt
                        )
                )
                .filter(
                    timestamp =>
                        Number.isFinite(
                            timestamp
                        )
                )
                .sort(
                    (
                        first,
                        second
                    ) =>
                        first -
                        second
                );

        if (
            timestamps.length <=
            1
        ) {

            return 0;
        }

        const spreadMinutes =
            (
                timestamps[
                    timestamps.length - 1
                ] -
                timestamps[0]
            ) /
            60000;

        if (
            spreadMinutes <=
            this.config.strongTemporalWindowMinutes
        ) {

            return 1;
        }

        if (
            spreadMinutes <=
            this.config.temporalWindowMinutes
        ) {

            return 0.60;
        }

        return 0.20;
    }

    /**
     * =========================================================================
     * Network Risk
     * =========================================================================
     */

    calculateNetworkRisk(
        cluster
    ) {

        const accountCount =
            cluster.accountIds.length;

        const transactionCount =
            cluster.transactionIds.length;

        const entityCount =
            cluster.entityIds.length;

        let score =
            0;

        if (
            accountCount >=
            2
        ) {

            score +=
                0.30;
        }

        if (
            accountCount >=
            3
        ) {

            score +=
                0.20;
        }

        if (
            accountCount >=
            5
        ) {

            score +=
                0.20;
        }

        if (
            transactionCount >=
            3
        ) {

            score +=
                0.10;
        }

        if (
            transactionCount >=
            10
        ) {

            score +=
                0.10;
        }

        if (
            entityCount >=
            2
        ) {

            score +=
                0.10;
        }

        return clamp(
            score
        );
    }

    /**
     * =========================================================================
     * AI Risk Adjustment
     * =========================================================================
     */

    async calculateAIAdjustment(
        cluster,
        context
    ) {

        if (
            !this.config.enableAIAdjustment ||
            !this.aiScorer
        ) {

            return 0;
        }

        try {

            const features =
                this.buildAIInput(
                    cluster
                );

            let result;

            if (
                typeof this.aiScorer.score ===
                'function'
            ) {

                result =
                    await this.aiScorer.score(
                        features,
                        context
                    );

            } else if (
                typeof this.aiScorer.calculate ===
                'function'
            ) {

                result =
                    await this.aiScorer.calculate(
                        features,
                        context
                    );

            } else if (
                typeof this.aiScorer.scoreCorrelation ===
                'function'
            ) {

                result =
                    await this.aiScorer.scoreCorrelation(
                        features,
                        context
                    );
            }

            if (
                result === undefined ||
                result === null
            ) {

                return 0;
            }

            const score =
                clamp(
                    typeof result ===
                    'number'
                        ? result
                        : result.score ??
                          result.riskScore ??
                          result.confidence
                );

            /*
             * Adjustment is centered around zero:
             *
             * AI = 1.0 -> positive adjustment
             * AI = 0.5 -> neutral
             * AI = 0.0 -> negative adjustment
             */

            return (
                score -
                0.5
            ) *
            2 *
            this.config.aiAdjustmentWeight;

        } catch (
            error
        ) {

            this.log(
                'warn',
                'AI correlation adjustment failed; continuing without adjustment.',
                {

                    error:
                        error.message
                }
            );

            this.recordMetric(
                'fraud_correlation_ai_adjustment_failure'
            );

            return 0;
        }
    }

    buildAIInput(
        cluster
    ) {

        return {

            signalCount:
                cluster.signalCount,

            accountCount:
                cluster.accountIds.length,

            transactionCount:
                cluster.transactionIds.length,

            entityCount:
                cluster.entityIds.length,

            signalTypes:
                cluster.types,

            signalSources:
                cluster.sources,

            scores:
                cluster.signals.map(
                    signal =>
                        signal.score
                ),

            confidenceScores:
                cluster.signals.map(
                    signal =>
                        signal.confidence
                ),

            severityDistribution:
                this.buildSeverityDistribution(
                    cluster.signals
                ),

            temporalRisk:
                this.calculateTemporalRisk(
                    cluster
                ),

            networkRisk:
                this.calculateNetworkRisk(
                    cluster
                )
        };
    }

    /**
     * =========================================================================
     * Composite Risk
     * =========================================================================
     */

    calculateCompositeRiskScore(
        scores
    ) {

        const baseComponent =
            scores.baseScore *
            this.config.signalWeight;

        const evidenceComponent =
            scores.evidenceScore *
            this.config.evidenceWeight;

        const diversityComponent =
            scores.diversityScore *
            this.config.diversityWeight;

        const consistencyComponent =
            scores.consistencyScore *
            this.config.consistencyWeight;

        const structuralComponent =
            (
                scores.temporalScore +
                scores.networkScore
            ) /
            2 *
            0.10;

        const aiComponent =
            scores.aiAdjustment;

        /*
         * Evidence and signal components form the primary risk score.
         * Structural and AI components are bounded modifiers.
         */

        return clamp(
            baseComponent +
            evidenceComponent +
            diversityComponent +
            consistencyComponent +
            structuralComponent +
            aiComponent
        );
    }

    /**
     * =========================================================================
     * Confidence
     * =========================================================================
     */

    calculateConfidence(
        input
    ) {

        const {

            cluster,

            riskScore,

            diversityScore,

            consistencyScore,

            evidenceScore
        } = input;

        const signalConfidence =
            cluster.signals.length
                ? cluster.signals.reduce(
                    (
                        total,
                        signal
                    ) =>
                        total +
                        signal.confidence,
                    0
                ) /
                cluster.signals.length
                : 0;

        const signalCountConfidence =
            clamp(
                cluster.signalCount /
                this.config.minimumSignalsForHighConfidence
            );

        const confidence =
            (
                signalConfidence *
                0.35
            ) +
            (
                evidenceScore *
                0.25
            ) +
            (
                diversityScore *
                0.15
            ) +
            (
                consistencyScore *
                0.15
            ) +
            (
                signalCountConfidence *
                0.10
            );

        /*
         * A high risk score does not automatically mean high confidence.
         * Confidence measures evidentiary quality and agreement.
         */

        return clamp(
            confidence
        );
    }

    /**
     * =========================================================================
     * Risk Level
     * =========================================================================
     */

    getRiskLevel(
        score
    ) {

        const normalized =
            clamp(
                score
            );

        if (
            normalized >=
            this.config.criticalRiskThreshold
        ) {

            return RISK_LEVEL.CRITICAL;
        }

        if (
            normalized >=
            this.config.highRiskThreshold
        ) {

            return RISK_LEVEL.HIGH;
        }

        if (
            normalized >=
            0.40
        ) {

            return RISK_LEVEL.MEDIUM;
        }

        if (
            normalized >=
            0.15
        ) {

            return RISK_LEVEL.LOW;
        }

        return RISK_LEVEL.MINIMAL;
    }

    getSeverity(
        score
    ) {

        if (
            score >=
            this.config.criticalRiskThreshold
        ) {

            return ALERT_SEVERITY.CRITICAL;
        }

        if (
            score >=
            this.config.highRiskThreshold
        ) {

            return ALERT_SEVERITY.HIGH;
        }

        if (
            score >=
            0.40
        ) {

            return ALERT_SEVERITY.MEDIUM;
        }

        return ALERT_SEVERITY.LOW;
    }

    normalizeSeverity(
        severity,
        score
    ) {

        const normalized =
            normalizeString(
                severity
            )?.toUpperCase();

        if (
            Object.values(
                ALERT_SEVERITY
            ).includes(
                normalized
            )
        ) {

            return normalized;
        }

        return this.getSeverity(
            clamp(
                score
            )
        );
    }

    /**
     * =========================================================================
     * Correlation Type
     * =========================================================================
     */

    determineCorrelationType(
        cluster
    ) {

        const types =
            new Set(
                cluster.types
            );

        if (
            types.has(
                SIGNAL_TYPE.CIRCULAR_MOVEMENT
            ) ||
            types.has(
                SIGNAL_TYPE.FAN_IN
            ) ||
            types.has(
                SIGNAL_TYPE.FAN_OUT
            ) ||
            types.has(
                SIGNAL_TYPE.NETWORK_CLUSTER
            )
        ) {

            return CORRELATION_TYPE.NETWORK;
        }

        if (
            types.has(
                SIGNAL_TYPE.SHARED_DEVICE
            ) ||
            types.has(
                SIGNAL_TYPE.SHARED_IP
            ) ||
            types.has(
                SIGNAL_TYPE.SHARED_IDENTIFIER
            )
        ) {

            return CORRELATION_TYPE.ENTITY;
        }

        if (
            types.has(
                SIGNAL_TYPE.VELOCITY
            ) ||
            types.has(
                SIGNAL_TYPE.RAPID_FUND_MOVEMENT
            )
        ) {

            return CORRELATION_TYPE.TEMPORAL;
        }

        if (
            types.has(
                SIGNAL_TYPE.BEHAVIORAL_ANOMALY
            )
        ) {

            return CORRELATION_TYPE.BEHAVIOR;
        }

        if (
            cluster.accountIds.length >
            1
        ) {

            return CORRELATION_TYPE.CROSS_ACCOUNT;
        }

        if (
            cluster.transactionIds.length
        ) {

            return CORRELATION_TYPE.TRANSACTION;
        }

        return CORRELATION_TYPE.COMPOSITE;
    }

    /**
     * =========================================================================
     * Explanation
     * =========================================================================
     */

    buildExplanation(
        input
    ) {

        const {

            cluster,

            riskScore,

            confidence,

            diversityScore,

            consistencyScore,

            evidenceScore,

            temporalScore,

            networkScore
        } = input;

        const factors =
            [];

        if (
            cluster.accountIds.length >
            1
        ) {

            factors.push(
                `${cluster.accountIds.length} related accounts`
            );
        }

        if (
            cluster.transactionIds.length
        ) {

            factors.push(
                `${cluster.transactionIds.length} related transactions`
            );
        }

        if (
            cluster.types.length >
            1
        ) {

            factors.push(
                `${cluster.types.length} distinct fraud signal types`
            );
        }

        if (
            networkScore >=
            0.60
        ) {

            factors.push(
                'significant network relationship'
            );
        }

        if (
            temporalScore >=
            0.60
        ) {

            factors.push(
                'strong temporal concentration'
            );
        }

        if (
            evidenceScore >=
            0.60
        ) {

            factors.push(
                'substantial supporting evidence'
            );
        }

        if (
            diversityScore >=
            0.60
        ) {

            factors.push(
                'independent signal-source diversity'
            );
        }

        if (
            consistencyScore >=
            0.70
        ) {

            factors.push(
                'high signal consistency'
            );
        }

        const riskLabel =
            this.getRiskLevel(
                riskScore
            );

        const confidenceLabel =
            this.getRiskLevel(
                confidence
            );

        const factorText =
            factors.length
                ? factors.join(
                    ', '
                )
                : 'limited correlated evidence';

        return {

            summary:
                `Correlated fraud-risk activity classified as ${riskLabel} ` +
                `with ${confidenceLabel} evidentiary confidence.`,

            factors,

            narrative:
                `The correlation combines ${factorText}. ` +
                `Composite risk score: ${round(
                    riskScore
                )}; confidence: ${round(
                    confidence
                )}.`,

            methodology: {

                signalAggregation:
                    'weighted multi-signal aggregation',

                evidenceAssessment:
                    'evidence density and quality',

                temporalAssessment:
                    'detector-event temporal proximity',

                networkAssessment:
                    'account/entity relationship density',

                diversityAssessment:
                    'signal-type and source diversity',

                consistencyAssessment:
                    'cross-signal score consistency'
            }
        };
    }

    /**
     * =========================================================================
     * Evidence Aggregation
     * =========================================================================
     */

    aggregateEvidence(
        cluster
    ) {

        const signalEvidence =
            [];

        for (
            const signal
            of cluster.signals
        ) {

            signalEvidence.push(
                {

                    signalId:
                        signal.id,

                    type:
                        signal.type,

                    source:
                        signal.source,

                    score:
                        signal.score,

                    confidence:
                        signal.confidence,

                    severity:
                        signal.severity,

                    explanation:
                        signal.explanation,

                    evidence:
                        signal.evidence
                }
            );
        }

        const accounts =
            cluster.accountIds
                .slice(
                    0,
                    this.config.maximumRelatedEntities
                );

        const transactions =
            cluster.transactionIds
                .slice(
                    0,
                    this.config.maximumTransactionsPerCluster
                );

        return {

            signals:
                signalEvidence.slice(
                    0,
                    this.config.maximumEvidenceItems
                ),

            accounts,

            transactions,

            entities:
                cluster.entityIds.slice(
                    0,
                    this.config.maximumRelatedEntities
                ),

            signalTypes:
                cluster.types,

            signalSources:
                cluster.sources
        };
    }

    /**
     * =========================================================================
     * Tags
     * =========================================================================
     */

    buildCorrelationTags(
        cluster,
        riskLevel
    ) {

        const tags =
            [

                'FRAUD_CORRELATION',

                `RISK_${riskLevel}`
            ];

        for (
            const type
            of cluster.types
        ) {

            tags.push(
                type
            );
        }

        for (
            const source
            of cluster.sources
        ) {

            tags.push(
                `SOURCE_${source}`
            );
        }

        if (
            cluster.accountIds.length >
            1
        ) {

            tags.push(
                'CROSS_ACCOUNT'
            );
        }

        return unique(
            tags
        );
    }

    /**
     * =========================================================================
     * Alert Creation
     * =========================================================================
     */

    async createAlerts(
        result,
        context
    ) {

        if (
            !this.config.enableAlertCreation
        ) {

            return [];
        }

        if (
            !this.alertService
        ) {

            this.log(
                'warn',
                'FraudAlertService is not configured; correlation generated without alerts.'
            );

            return [];
        }

        const alerts =
            [];

        for (
            const correlation
            of result.correlations
        ) {

            try {

                const alert =
                    await this.createAlertForCorrelation(
                        correlation,
                        context
                    );

                if (
                    alert
                ) {

                    alerts.push(
                        alert
                    );
                }

            } catch (
                error
            ) {

                this.recordMetric(
                    'fraud_correlation_alert_failure'
                );

                this.log(
                    'error',
                    'Failed to create fraud alert from correlation.',
                    {

                        correlationId:
                            correlation.id,

                        error:
                            error.message
                    }
                );

                if (
                    this.config.failOnAlertFailure
                ) {

                    throw error;
                }
            }
        }

        result.alerts =
            alerts;

        return alerts;
    }

    async createAlertForCorrelation(
        correlation,
        context
    ) {

        if (
            typeof this.alertService.createAlert !==
            'function'
        ) {

            throw new FraudCorrelationEngineError(
                'FraudAlertService does not implement createAlert().',
                'ALERT_SERVICE_INVALID'
            );
        }

        return this.alertService.createAlert(
            {

                tenantId:
                    correlation.tenantId,

                type:
                    this.mapCorrelationToAlertType(
                        correlation
                    ),

                source:
                    'FRAUD_CORRELATION_ENGINE',

                sourceSignalId:
                    correlation.id,

                accountId:
                    correlation.accountIds[0] ||
                    null,

                relatedAccounts:
                    correlation.accountIds,

                relatedTransactions:
                    correlation.transactionIds,

                riskScore:
                    correlation.riskScore,

                severity:
                    correlation.severity,

                title:
                    this.buildAlertTitle(
                        correlation
                    ),

                description:
                    correlation.explanation?.narrative,

                evidence:
                    correlation.evidence,

                tags:
                    correlation.tags,

                correlationId:
                    correlation.correlationId,

                metadata: {

                    correlationType:
                        correlation.type,

                    confidence:
                        correlation.confidence,

                    scores:
                        correlation.scores,

                    explanation:
                        correlation.explanation,

                    schemaVersion:
                        CORRELATION_SCHEMA_VERSION
                }
            },
            {

                ...context,

                tenantId:
                    correlation.tenantId,

                source:
                    'FRAUD_CORRELATION_ENGINE'
            }
        );
    }

    mapCorrelationToAlertType(
        correlation
    ) {

        switch (
            correlation.type
        ) {

            case CORRELATION_TYPE.CROSS_ACCOUNT:

                return 'CROSS_ACCOUNT';

            case CORRELATION_TYPE.NETWORK:

                return 'NETWORK_CLUSTER';

            case CORRELATION_TYPE.ENTITY:

                return 'COORDINATED_ACTIVITY';

            case CORRELATION_TYPE.TEMPORAL:

                return 'RAPID_FUND_MOVEMENT';

            case CORRELATION_TYPE.BEHAVIOR:

                return 'ACCOUNT_ANOMALY';

            default:

                return 'MODEL_ANOMALY';
        }
    }

    buildAlertTitle(
        correlation
    ) {

        return (
            `${correlation.severity} fraud correlation detected`
        );
    }

    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */

    async persistCorrelation(
        result
    ) {

        if (
            !this.repository
        ) {

            return result;
        }

        if (
            typeof this.repository.create !==
            'function'
        ) {

            return result;
        }

        try {

            await this.repository.create(
                {

                    ...result,

                    persistedAt:
                        now()
                }
            );

        } catch (
            error
        ) {

            this.log(
                'error',
                'Fraud correlation persistence failed.',
                {

                    correlationId:
                        result.correlationId,

                    error:
                        error.message
                }
            );

            throw new FraudCorrelationEngineError(
                'Fraud correlation persistence failed.',
                'CORRELATION_PERSISTENCE_FAILED',
                {

                    cause:
                        error.message
                }
            );
        }

        return result;
    }

    /**
     * =========================================================================
     * Empty Result
     * =========================================================================
     */

    buildEmptyCorrelationResult(
        input,
        startedAt
    ) {

        return {

            schemaVersion:
                CORRELATION_SCHEMA_VERSION,

            correlationId:
                input.correlationId,

            tenantId:
                input.tenantId,

            signalCount:
                0,

            clusterCount:
                0,

            correlationCount:
                0,

            riskScore:
                0,

            riskLevel:
                RISK_LEVEL.MINIMAL,

            severity:
                ALERT_SEVERITY.LOW,

            confidence:
                0,

            correlations:
                [],

            alerts:
                [],

            statistics: {

                signalsProcessed:
                    0,

                clustersGenerated:
                    0,

                correlationsGenerated:
                    0,

                alertsGenerated:
                    0
            },

            durationMs:
                Date.now() -
                startedAt,

            createdAt:
                now()
        };
    }

    /**
     * =========================================================================
     * Final Result
     * =========================================================================
     */

    buildCorrelationResult(
        input,
        signals,
        clusters,
        correlations,
        startedAt
    ) {

        const riskScore =
            correlations.length
                ? Math.max(
                    ...correlations.map(
                        correlation =>
                            correlation.riskScore
                    )
                )
                : 0;

        const confidence =
            correlations.length
                ? Math.max(
                    ...correlations.map(
                        correlation =>
                            correlation.confidence
                    )
                )
                : 0;

        const severity =
            this.getSeverity(
                riskScore
            );

        return {

            schemaVersion:
                CORRELATION_SCHEMA_VERSION,

            module:
                MODULE_NAME,

            moduleVersion:
                MODULE_VERSION,

            correlationId:
                input.correlationId,

            tenantId:
                input.tenantId,

            analysisId:
                input.analysisId,

            accountId:
                input.accountId,

            transactionId:
                input.transactionId,

            source:
                input.source,

            signalCount:
                signals.length,

            clusterCount:
                clusters.length,

            correlationCount:
                correlations.length,

            riskScore:
                round(
                    riskScore
                ),

            riskLevel:
                this.getRiskLevel(
                    riskScore
                ),

            severity,

            confidence:
                round(
                    confidence
                ),

            correlations,

            alerts:
                [],

            statistics: {

                signalsProcessed:
                    signals.length,

                clustersGenerated:
                    clusters.length,

                correlationsGenerated:
                    correlations.length,

                highRiskCorrelations:
                    correlations.filter(
                        correlation =>
                            correlation.riskLevel ===
                            RISK_LEVEL.HIGH
                    ).length,

                criticalRiskCorrelations:
                    correlations.filter(
                        correlation =>
                            correlation.riskLevel ===
                            RISK_LEVEL.CRITICAL
                    ).length,

                crossAccountCorrelations:
                    correlations.filter(
                        correlation =>
                            correlation.type ===
                            CORRELATION_TYPE.CROSS_ACCOUNT
                    ).length,

                networkCorrelations:
                    correlations.filter(
                        correlation =>
                            correlation.type ===
                            CORRELATION_TYPE.NETWORK
                    ).length
            },

            metadata:
                input.metadata,

            createdAt:
                now(),

            durationMs:
                Date.now() -
                startedAt
        };
    }

    /**
     * =========================================================================
     * Correlation IDs
     * =========================================================================
     */

    generateCorrelationId(
        input
    ) {

        const crypto =
            require('crypto');

        const signalIds =
            input.signals
                .map(
                    signal =>
                        signal.id ||
                        signal.transactionId ||
                        signal.accountId
                )
                .filter(
                    Boolean
                )
                .sort();

        const payload =
            [

                input.tenantId,

                input.analysisId,

                input.accountId,

                input.transactionId,

                input.source,

                ...signalIds
            ]
                .join(
                    '|'
                );

        return crypto
            .createHash(
                this.config.correlationIdAlgorithm
            )
            .update(
                payload
            )
            .digest(
                'hex'
            );
    }

    generateClusterId(
        signals
    ) {

        const crypto =
            require('crypto');

        const payload =
            signals
                .map(
                    signal =>
                        signal.id
                )
                .sort()
                .join(
                    '|'
                );

        return crypto
            .createHash(
                this.config.correlationIdAlgorithm
            )
            .update(
                payload
            )
            .digest(
                'hex'
            );
    }

    generateCorrelationIdForCluster(
        cluster,
        tenantId
    ) {

        const crypto =
            require('crypto');

        const payload =
            [

                tenantId,

                cluster.id,

                ...cluster.signals
                    .map(
                        signal =>
                            signal.id
                    )
                    .sort()
            ]
                .join(
                    '|'
                );

        return crypto
            .createHash(
                this.config.correlationIdAlgorithm
            )
            .update(
                payload
            )
            .digest(
                'hex'
            );
    }

    /**
     * =========================================================================
     * Temporal Helpers
     * =========================================================================
     */

    areTemporallyClose(
        firstDate,
        secondDate
    ) {

        const first =
            Date.parse(
                firstDate
            );

        const second =
            Date.parse(
                secondDate
            );

        if (
            !Number.isFinite(
                first
            ) ||
            !Number.isFinite(
                second
            )
        ) {

            return false;
        }

        const differenceMinutes =
            Math.abs(
                first -
                second
            ) /
            60000;

        return (
            differenceMinutes <=
            this.config.temporalWindowMinutes
        );
    }

    getEarliestSignalDate(
        signals
    ) {

        const dates =
            signals
                .map(
                    signal =>
                        Date.parse(
                            signal.detectedAt
                        )
                )
                .filter(
                    timestamp =>
                        Number.isFinite(
                            timestamp
                        )
                );

        if (
            !dates.length
        ) {

            return now();
        }

        return new Date(
            Math.min(
                ...dates
            )
        )
            .toISOString();
    }

    getLatestSignalDate(
        signals
    ) {

        const dates =
            signals
                .map(
                    signal =>
                        Date.parse(
                            signal.detectedAt
                        )
                )
                .filter(
                    timestamp =>
                        Number.isFinite(
                            timestamp
                        )
                );

        if (
            !dates.length
        ) {

            return now();
        }

        return new Date(
            Math.max(
                ...dates
            )
        )
            .toISOString();
    }

    /**
     * =========================================================================
     * Entity Helpers
     * =========================================================================
     */

    sharedEntityCount(
        first,
        second
    ) {

        const firstValues =
            unique(
                first
            );

        const secondValues =
            unique(
                second
            );

        return intersection(
            firstValues,
            secondValues
        ).length;
    }

    normalizeIds(
        values
    ) {

        if (
            !isArray(
                values
            )
        ) {

            return [];
        }

        return unique(
            values.map(
                value =>
                    normalizeId(
                        value
                    )
            )
        );
    }

    normalizeTags(
        values
    ) {

        if (
            !isArray(
                values
            )
        ) {

            return [];
        }

        return unique(
            values
                .map(
                    value =>
                        normalizeString(
                            value
                        )?.toUpperCase()
                )
        );
    }

    /**
     * =========================================================================
     * Evidence / Metadata Sanitization
     * =========================================================================
     */

    normalizeEvidence(
        evidence
    ) {

        if (
            !evidence
        ) {

            return {};
        }

        return this.sanitizeValue(
            evidence
        );
    }

    sanitizeMetadata(
        metadata
    ) {

        if (
            !isObject(
                metadata
            )
        ) {

            return {};
        }

        return this.sanitizeValue(
            metadata
        );
    }

    sanitizeValue(
        value,
        depth = 0
    ) {

        if (
            depth > 8
        ) {

            return '[MAX_DEPTH]';
        }

        if (
            value === null ||
            value === undefined
        ) {

            return null;
        }

        if (
            typeof value ===
            'string'
        ) {

            return value.length > 4000
                ? value.slice(
                    0,
                    4000
                )
                : value;
        }

        if (
            typeof value ===
            'number' ||
            typeof value ===
            'boolean'
        ) {

            return value;
        }

        if (
            value instanceof Date
        ) {

            return value.toISOString();
        }

        if (
            isArray(
                value
            )
        ) {

            return value
                .slice(
                    0,
                    this.config.maximumEvidenceItems
                )
                .map(
                    item =>
                        this.sanitizeValue(
                            item,
                            depth + 1
                        )
                );
        }

        if (
            isObject(
                value
            )
        ) {

            const result =
                {};

            for (
                const [
                    key,
                    nestedValue
                ]
                of Object.entries(
                    value
                )
            ) {

                result[key] =
                    this.sanitizeValue(
                        nestedValue,
                        depth + 1
                    );
            }

            return result;
        }

        return String(
            value
        );
    }

    /**
     * =========================================================================
     * Severity Distribution
     * =========================================================================
     */

    buildSeverityDistribution(
        signals
    ) {

        const distribution = {

            LOW:
                0,

            MEDIUM:
                0,

            HIGH:
                0,

            CRITICAL:
                0
        };

        for (
            const signal
            of signals
        ) {

            if (
                distribution[
                    signal.severity
                ] !== undefined
            ) {

                distribution[
                    signal.severity
                ]++;
            }
        }

        return distribution;
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async healthCheck() {

        let repositoryHealthy =
            true;

        if (
            this.repository &&
            typeof this.repository.healthCheck ===
            'function'
        ) {

            try {

                const result =
                    await this.repository.healthCheck();

                repositoryHealthy =
                    result?.healthy !== false;

            } catch (
                error
            ) {

                repositoryHealthy =
                    false;
            }
        }

        return {

            healthy:
                this.initialized &&
                repositoryHealthy,

            ready:
                this.initialized &&
                repositoryHealthy,

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION,

            schemaVersion:
                CORRELATION_SCHEMA_VERSION,

            dependencies: {

                crossAccountAnalyzer:
                    Boolean(
                        this.crossAccountAnalyzer
                    ),

                alertService:
                    Boolean(
                        this.alertService
                    ),

                repository:
                    repositoryHealthy,

                aiScorer:
                    Boolean(
                        this.aiScorer
                    ),

                featureExtractor:
                    Boolean(
                        this.featureExtractor
                    )
            },

            timestamp:
                now()
        };
    }

    /**
     * =========================================================================
     * Metadata
     * =========================================================================
     */

    getMetadata() {

        return {

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION,

            schemaVersion:
                CORRELATION_SCHEMA_VERSION,

            capabilities: [

                'multi-signal-correlation',

                'signal-normalization',

                'entity-correlation',

                'cross-account-correlation',

                'transaction-correlation',

                'network-correlation',

                'temporal-correlation',

                'behavioral-correlation',

                'signal-clustering',

                'risk-scoring',

                'confidence-scoring',

                'evidence-aggregation',

                'explainability',

                'deterministic-correlation-id',

                'alert-orchestration',

                'tenant-isolation',

                'audit-hooks',

                'metrics-hooks',

                'ai-risk-adjustment'
            ],

            governance: {

                modifiesLedger:
                    false,

                modifiesTransactions:
                    false,

                freezesAccounts:
                    false,

                blocksTransactions:
                    false,

                performsFinancialRepair:
                    false,

                declaresLegalFraud:
                    false,

                producesRiskIntelligence:
                    true,

                producesInvestigationAlerts:
                    true
            }
        };
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createFraudCorrelationEngine(
    options = {}
) {

    return new FraudCorrelationEngine(
        options
    );
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports = {

    MODULE_NAME,

    MODULE_VERSION,

    CORRELATION_SCHEMA_VERSION,

    SIGNAL_TYPE,

    CORRELATION_TYPE,

    RISK_LEVEL,

    ALERT_SEVERITY,

    DEFAULT_CONFIG,

    FraudCorrelationEngine,

    FraudCorrelationEngineError,

    createFraudCorrelationEngine
};