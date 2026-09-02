'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * FraudPatternDetector
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/fraud/FraudPatternDetector.js
 *
 * Purpose:
 *   Enterprise-grade fraud pattern detection engine.
 *
 * Responsibilities:
 *   - Detect recurring fraud patterns across financial activity.
 *   - Detect temporal, transactional, account, network and behavioral patterns.
 *   - Detect repeated patterns across multiple transactions/accounts.
 *   - Produce normalized fraud signals.
 *   - Produce explainable evidence.
 *   - Calculate pattern confidence and risk scores.
 *   - Generate deterministic pattern identifiers.
 *   - Support tenant isolation.
 *   - Support incremental / batch analysis.
 *   - Provide configurable detection thresholds.
 *
 * Non-responsibilities:
 *   - Does NOT mutate ledger records.
 *   - Does NOT modify transactions.
 *   - Does NOT freeze accounts.
 *   - Does NOT reverse transactions.
 *   - Does NOT make legal fraud determinations.
 *   - Does NOT independently create financial repairs.
 *   - Does NOT make final enforcement decisions.
 *
 * Pipeline:
 *
 *   Financial Activity
 *          │
 *          ▼
 *   FraudPatternDetector
 *          │
 *          ├── Velocity
 *          ├── Frequency
 *          ├── Amount
 *          ├── Temporal
 *          ├── Repetition
 *          ├── Fan-In
 *          ├── Fan-Out
 *          ├── Circular Flow
 *          ├── Counterparty
 *          ├── Behavioral
 *          └── Concentration
 *          │
 *          ▼
 *   Normalized Fraud Signals
 *          │
 *          ▼
 *   FraudCorrelationEngine
 *          │
 *          ▼
 *   FraudAlertService
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Module Metadata
 * ============================================================================
 */

const MODULE_NAME =
    'FraudPatternDetector';

const MODULE_VERSION =
    '1.0.0';

const SCHEMA_VERSION =
    '1.0.0';

/**
 * ============================================================================
 * Pattern Types
 * ============================================================================
 */

const PATTERN_TYPE =
    Object.freeze({

        HIGH_VELOCITY:
            'HIGH_VELOCITY',

        REPEATED_TRANSACTION:
            'REPEATED_TRANSACTION',

        RAPID_FUND_MOVEMENT:
            'RAPID_FUND_MOVEMENT',

        FAN_IN:
            'FAN_IN',

        FAN_OUT:
            'FAN_OUT',

        CIRCULAR_FLOW:
            'CIRCULAR_FLOW',

        SHARED_COUNTERPARTY:
            'SHARED_COUNTERPARTY',

        SHARED_DEVICE:
            'SHARED_DEVICE',

        SHARED_IP:
            'SHARED_IP',

        SHARED_IDENTIFIER:
            'SHARED_IDENTIFIER',

        AMOUNT_ANOMALY:
            'AMOUNT_ANOMALY',

        ROUND_AMOUNT:
            'ROUND_AMOUNT',

        STRUCTURED_AMOUNT:
            'STRUCTURED_AMOUNT',

        TEMPORAL_CLUSTER:
            'TEMPORAL_CLUSTER',

        UNUSUAL_HOURS:
            'UNUSUAL_HOURS',

        CONCENTRATION:
            'CONCENTRATION',

        BEHAVIORAL_DEVIATION:
            'BEHAVIORAL_DEVIATION',

        COUNTERPARTY_CONCENTRATION:
            'COUNTERPARTY_CONCENTRATION',

        TRANSACTION_CHAIN:
            'TRANSACTION_CHAIN',

        SPLIT_TRANSACTION:
            'SPLIT_TRANSACTION',

        AGGREGATION:
            'AGGREGATION',

        CROSS_ACCOUNT:
            'CROSS_ACCOUNT',

        NETWORK_CLUSTER:
            'NETWORK_CLUSTER',

        DORMANT_ACCOUNT_ACTIVITY:
            'DORMANT_ACCOUNT_ACTIVITY'
    });

/**
 * ============================================================================
 * Signal Types
 * ============================================================================
 */

const SIGNAL_TYPE =
    Object.freeze({

        FRAUD_PATTERN:
            'FRAUD_PATTERN',

        VELOCITY:
            'VELOCITY',

        NETWORK:
            'NETWORK',

        BEHAVIORAL_ANOMALY:
            'BEHAVIORAL_ANOMALY',

        TRANSACTION_ANOMALY:
            'TRANSACTION_ANOMALY',

        CROSS_ACCOUNT:
            'CROSS_ACCOUNT'
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
 * Severity
 * ============================================================================
 */

const SEVERITY =
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

        minimumPatternScore:
            0.30,

        highRiskThreshold:
            0.65,

        criticalRiskThreshold:
            0.85,

        minimumConfidence:
            0.30,

        velocityWindowMinutes:
            60,

        rapidMovementWindowMinutes:
            30,

        temporalClusterWindowMinutes:
            15,

        maximumTransactions:
            5000,

        maximumPatterns:
            500,

        maximumEvidenceItems:
            250,

        maximumAccounts:
            500,

        maximumCounterparties:
            500,

        maximumPatternOccurrences:
            250,

        minimumVelocityCount:
            5,

        highVelocityCount:
            10,

        minimumFanInCount:
            4,

        highFanInCount:
            8,

        minimumFanOutCount:
            4,

        highFanOutCount:
            8,

        minimumRepeatedTransactions:
            3,

        minimumCircularTransactions:
            3,

        minimumCounterpartyConcentration:
            0.60,

        minimumSplitTransactions:
            3,

        roundAmountTolerance:
            0.000001,

        amountSimilarityTolerance:
            0.01,

        unusualHourStart:
            0,

        unusualHourEnd:
            5,

        enableVelocityDetection:
            true,

        enableNetworkDetection:
            true,

        enableBehavioralDetection:
            true,

        enableAmountDetection:
            true,

        enableTemporalDetection:
            true,

        enableDormancyDetection:
            true,

        enablePatternDeduplication:
            true,

        preserveRawTransactions:
            false,

        failOnInvalidTransaction:
            false,

        requireTenantId:
            true,

        correlationIdAlgorithm:
            'sha256'
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class FraudPatternDetectorError extends Error {

    constructor(
        message,
        code = 'FRAUD_PATTERN_DETECTOR_ERROR',
        metadata = {}
    ) {

        super(
            message
        );

        this.name =
            'FraudPatternDetectorError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            FraudPatternDetectorError
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
        value === null ||
        value === undefined
    ) {

        return null;
    }

    const result =
        String(
            value
        ).trim();

    return result ||
        null;
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

    const result =
        Number(
            value
        );

    return Number.isFinite(
        result
    )
        ? result
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

    return Math.round(
        safeNumber(
            value
        ) *
        multiplier
    ) /
    multiplier;
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

function mean(
    values
) {

    if (
        !values.length
    ) {

        return 0;
    }

    return values.reduce(
        (
            total,
            value
        ) =>
            total +
            safeNumber(
                value
            ),
        0
    ) /
    values.length;
}

function median(
    values
) {

    if (
        !values.length
    ) {

        return 0;
    }

    const sorted =
        [
            ...values
        ]
            .sort(
                (
                    first,
                    second
                ) =>
                    first -
                    second
            );

    const middle =
        Math.floor(
            sorted.length / 2
        );

    if (
        sorted.length %
        2 ===
        0
    ) {

        return (
            sorted[
                middle - 1
            ] +
            sorted[
                middle
            ]
        ) /
        2;
    }

    return sorted[
        middle
    ];
}

/**
 * ============================================================================
 * FraudPatternDetector
 * ============================================================================
 */

class FraudPatternDetector {

    constructor(
        options = {}
    ) {

        this.config = {

            ...DEFAULT_CONFIG,

            ...(options.config || {})
        };

        this.repository =
            options.repository ||
            null;

        this.logger =
            options.logger ||
            null;

        this.metrics =
            options.metrics ||
            null;

        this.auditLogger =
            options.auditLogger ||
            null;

        this.featureExtractor =
            options.featureExtractor ||
            null;

        this.crossAccountAnalyzer =
            options.crossAccountAnalyzer ||
            null;

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
             * Logging must never become a fraud-processing failure.
             */
        }
    }

    /**
     * =========================================================================
     * Main Detection API
     * =========================================================================
     */

    async detect(
        input = {},
        context = {}
    ) {

        const startedAt =
            Date.now();

        const normalized =
            this.normalizeInput(
                input,
                context
            );

        const detectionId =
            this.generateDetectionId(
                normalized
            );

        try {

            this.recordMetric(
                'fraud_pattern_detection_started',
                {

                    tenantId:
                        normalized.tenantId
                }
            );

            const transactions =
                this.normalizeTransactions(
                    normalized.transactions,
                    normalized.tenantId
                );

            if (
                !transactions.length
            ) {

                return this.buildEmptyResult(
                    normalized,
                    detectionId,
                    startedAt
                );
            }

            const patterns =
                [];

            if (
                this.config.enableVelocityDetection
            ) {

                patterns.push(
                    ...this.detectVelocityPatterns(
                        transactions,
                        normalized
                    )
                );
            }

            if (
                this.config.enableTemporalDetection
            ) {

                patterns.push(
                    ...this.detectTemporalPatterns(
                        transactions,
                        normalized
                    )
                );
            }

            if (
                this.config.enableAmountDetection
            ) {

                patterns.push(
                    ...this.detectAmountPatterns(
                        transactions,
                        normalized
                    )
                );
            }

            if (
                this.config.enableNetworkDetection
            ) {

                patterns.push(
                    ...this.detectNetworkPatterns(
                        transactions,
                        normalized
                    )
                );
            }

            if (
                this.config.enableBehavioralDetection
            ) {

                patterns.push(
                    ...this.detectBehavioralPatterns(
                        transactions,
                        normalized
                    )
                );
            }

            if (
                this.config.enableDormancyDetection
            ) {

                patterns.push(
                    ...this.detectDormancyPatterns(
                        transactions,
                        normalized
                    )
                );
            }

            const normalizedPatterns =
                this.normalizePatterns(
                    patterns,
                    normalized.tenantId
                );

            const deduplicatedPatterns =
                this.deduplicatePatterns(
                    normalizedPatterns
                );

            const result =
                this.buildDetectionResult(
                    {

                        ...normalized,

                        detectionId,

                        transactions,
                        patterns:
                            deduplicatedPatterns
                    },
                    startedAt
                );

            await this.persistResult(
                result
            );

            this.recordAudit(
                'FRAUD_PATTERN_DETECTION_COMPLETED',
                {

                    detectionId,

                    tenantId:
                        normalized.tenantId,

                    transactionCount:
                        transactions.length,

                    patternCount:
                        deduplicatedPatterns.length,

                    riskScore:
                        result.riskScore,

                    riskLevel:
                        result.riskLevel
                },
                context.actor
            );

            this.recordMetric(
                'fraud_pattern_detection_completed',
                {

                    tenantId:
                        normalized.tenantId,

                    patternCount:
                        deduplicatedPatterns.length
                }
            );

            this.log(
                'info',
                'Fraud pattern detection completed.',
                {

                    detectionId,

                    tenantId:
                        normalized.tenantId,

                    transactionCount:
                        transactions.length,

                    patternCount:
                        deduplicatedPatterns.length,

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
                'fraud_pattern_detection_failure',
                {

                    tenantId:
                        normalized.tenantId
                }
            );

            this.log(
                'error',
                'Fraud pattern detection failed.',
                {

                    detectionId,

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
     * Convenience APIs
     * =========================================================================
     */

    async detectPatterns(
        transactions,
        context = {}
    ) {

        return this.detect(
            {

                tenantId:
                    context.tenantId,

                transactions,

                accountId:
                    context.accountId,

                statementId:
                    context.statementId,

                analysisId:
                    context.analysisId,

                source:
                    context.source
            },
            context
        );
    }

    async analyzeAccount(
        accountId,
        transactions,
        context = {}
    ) {

        return this.detect(
            {

                tenantId:
                    context.tenantId,

                accountId,

                transactions,

                source:
                    context.source ||
                    'ACCOUNT_PATTERN_ANALYSIS'
            },
            context
        );
    }

    /**
     * =========================================================================
     * Input Normalization
     * =========================================================================
     */

    normalizeInput(
        input,
        context
    ) {

        if (
            !isObject(
                input
            )
        ) {

            throw new FraudPatternDetectorError(
                'Detection input must be an object.',
                'INVALID_DETECTION_INPUT'
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

            throw new FraudPatternDetectorError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }

        return {

            tenantId,

            accountId:
                normalizeId(
                    input.accountId
                ),

            statementId:
                normalizeId(
                    input.statementId
                ),

            analysisId:
                normalizeId(
                    input.analysisId
                ),

            source:
                normalizeString(
                    input.source
                ) ||
                'FRAUD_PATTERN_DETECTOR',

            detectedAt:
                input.detectedAt ||
                now(),

            windowStart:
                input.windowStart ||
                null,

            windowEnd:
                input.windowEnd ||
                null,

            transactions:
                isArray(
                    input.transactions
                )
                    ? input.transactions
                    : [],

            metadata:
                this.sanitizeValue(
                    input.metadata || {}
                )
        };
    }

    /**
     * =========================================================================
     * Transaction Normalization
     * =========================================================================
     */

    normalizeTransactions(
        transactions,
        tenantId
    ) {

        if (
            !isArray(
                transactions
            )
        ) {

            return [];
        }

        const normalized =
            [];

        for (
            const transaction
            of transactions
        ) {

            try {

                const normalizedTransaction =
                    this.normalizeTransaction(
                        transaction,
                        tenantId
                    );

                if (
                    normalizedTransaction
                ) {

                    normalized.push(
                        normalizedTransaction
                    );
                }

            } catch (
                error
            ) {

                if (
                    this.config.failOnInvalidTransaction
                ) {

                    throw error;
                }

                this.log(
                    'warn',
                    'Invalid transaction skipped during fraud pattern detection.',
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
                this.config.maximumTransactions
            );
    }

    normalizeTransaction(
        transaction,
        tenantId
    ) {

        if (
            !isObject(
                transaction
            )
        ) {

            throw new FraudPatternDetectorError(
                'Transaction must be an object.',
                'INVALID_TRANSACTION'
            );
        }

        const transactionId =
            normalizeId(
                transaction.transactionId ||
                transaction.id ||
                transaction._id
            );

        if (
            !transactionId
        ) {

            throw new FraudPatternDetectorError(
                'Transaction ID is required.',
                'TRANSACTION_ID_REQUIRED'
            );
        }

        const amount =
            Math.abs(
                safeNumber(
                    transaction.amount ??
                    transaction.value ??
                    transaction.transactionAmount
                )
            );

        const timestamp =
            transaction.timestamp ||
            transaction.transactionDate ||
            transaction.date ||
            transaction.createdAt;

        const parsedTimestamp =
            Date.parse(
                timestamp
            );

        return {

            id:
                transactionId,

            tenantId,

            accountId:
                normalizeId(
                    transaction.accountId ||
                    transaction.sourceAccountId
                ),

            counterpartyAccountId:
                normalizeId(
                    transaction.counterpartyAccountId ||
                    transaction.destinationAccountId ||
                    transaction.recipientAccountId
                ),

            relatedAccountIds:
                unique(
                    [
                        ...(isArray(
                            transaction.relatedAccountIds
                        )
                            ? transaction.relatedAccountIds
                            : []),

                        normalizeId(
                            transaction.counterpartyAccountId
                        )
                    ]
                ),

            amount,

            currency:
                normalizeString(
                    transaction.currency
                )?.toUpperCase(),

            direction:
                this.normalizeDirection(
                    transaction.direction,
                    transaction.type
                ),

            type:
                normalizeString(
                    transaction.type
                )?.toUpperCase(),

            status:
                normalizeString(
                    transaction.status
                )?.toUpperCase(),

            timestamp:
                Number.isFinite(
                    parsedTimestamp
                )
                    ? new Date(
                        parsedTimestamp
                    ).toISOString()
                    : null,

            deviceId:
                normalizeId(
                    transaction.deviceId
                ),

            ipAddress:
                normalizeId(
                    transaction.ipAddress
                ),

            identifier:
                normalizeId(
                    transaction.identifier ||
                    transaction.reference ||
                    transaction.externalReference
                ),

            description:
                normalizeString(
                    transaction.description
                ),

            metadata:
                this.sanitizeValue(
                    transaction.metadata || {}
                )
        };
    }

    normalizeDirection(
        direction,
        type
    ) {

        const normalized =
            normalizeString(
                direction
            )?.toUpperCase();

        if (
            normalized ===
            'DEBIT' ||
            normalized ===
            'OUT' ||
            normalized ===
            'OUTFLOW'
        ) {

            return 'OUTFLOW';
        }

        if (
            normalized ===
            'CREDIT' ||
            normalized ===
            'IN' ||
            normalized ===
            'INFLOW'
        ) {

            return 'INFLOW';
        }

        const normalizedType =
            normalizeString(
                type
            )?.toUpperCase();

        if (
            normalizedType?.includes(
                'DEBIT'
            )
        ) {

            return 'OUTFLOW';
        }

        if (
            normalizedType?.includes(
                'CREDIT'
            )
        ) {

            return 'INFLOW';
        }

        return 'UNKNOWN';
    }

    /**
     * =========================================================================
     * Velocity Detection
     * =========================================================================
     */

    detectVelocityPatterns(
        transactions,
        input
    ) {

        const patterns =
            [];

        const accountGroups =
            this.groupByAccount(
                transactions
            );

        for (
            const [
                accountId,
                accountTransactions
            ]
            of accountGroups.entries()
        ) {

            const sorted =
                this.sortTransactions(
                    accountTransactions
                );

            let start =
                0;

            for (
                let end = 0;
                end < sorted.length;
                end++
            ) {

                while (
                    start < end &&
                    this.minutesBetween(
                        sorted[start].timestamp,
                        sorted[end].timestamp
                    ) >
                    this.config.velocityWindowMinutes
                ) {

                    start++;
                }

                const count =
                    end -
                    start +
                    1;

                if (
                    count >=
                    this.config.minimumVelocityCount
                ) {

                    const windowTransactions =
                        sorted.slice(
                            start,
                            end + 1
                        );

                    const score =
                        this.calculateVelocityScore(
                            count
                        );

                    patterns.push(
                        this.createPattern(
                            {

                                type:
                                    PATTERN_TYPE.HIGH_VELOCITY,

                                signalType:
                                    SIGNAL_TYPE.VELOCITY,

                                score,

                                confidence:
                                    this.calculateCountConfidence(
                                        count,
                                        this.config.minimumVelocityCount
                                    ),

                                accountIds:
                                    [
                                        accountId
                                    ],

                                transactionIds:
                                    windowTransactions.map(
                                        transaction =>
                                            transaction.id
                                    ),

                                evidence: {

                                    transactionCount:
                                        count,

                                    windowMinutes:
                                        this.config.velocityWindowMinutes,

                                    firstTransactionAt:
                                        windowTransactions[0]?.timestamp,

                                    lastTransactionAt:
                                        windowTransactions[
                                            windowTransactions.length - 1
                                        ]?.timestamp
                                },

                                explanation:
                                    `Account ${accountId} recorded ` +
                                    `${count} transactions within ` +
                                    `${this.config.velocityWindowMinutes} minutes.`
                            },
                            input
                        )
                    );
                }
            }
        }

        return patterns;
    }

    calculateVelocityScore(
        count
    ) {

        if (
            count >=
            this.config.highVelocityCount
        ) {

            return 0.90;
        }

        return clamp(
            0.45 +
            (
                count -
                this.config.minimumVelocityCount
            ) /
            Math.max(
                this.config.highVelocityCount -
                this.config.minimumVelocityCount,
                1
            ) *
            0.40
        );
    }

    /**
     * =========================================================================
     * Temporal Detection
     * =========================================================================
     */

    detectTemporalPatterns(
        transactions,
        input
    ) {

        const patterns =
            [];

        const sorted =
            this.sortTransactions(
                transactions
            );

        const clusters =
            this.buildTemporalClusters(
                sorted
            );

        for (
            const cluster
            of clusters
        ) {

            if (
                cluster.length <
                3
            ) {

                continue;
            }

            const score =
                clamp(
                    0.40 +
                    (
                        Math.min(
                            cluster.length,
                            20
                        ) /
                        20
                    ) *
                    0.45
                );

            patterns.push(
                this.createPattern(
                    {

                        type:
                            PATTERN_TYPE.TEMPORAL_CLUSTER,

                        signalType:
                            SIGNAL_TYPE.FRAUD_PATTERN,

                        score,

                        confidence:
                            this.calculateCountConfidence(
                                cluster.length,
                                3
                            ),

                        accountIds:
                            unique(
                                cluster.flatMap(
                                    transaction => [
                                        transaction.accountId,
                                        transaction.counterpartyAccountId
                                    ]
                                )
                            ),

                        transactionIds:
                            cluster.map(
                                transaction =>
                                    transaction.id
                            ),

                        evidence: {

                            transactionCount:
                                cluster.length,

                            windowMinutes:
                                this.config.temporalClusterWindowMinutes,

                            start:
                                cluster[0]?.timestamp,

                            end:
                                cluster[
                                    cluster.length - 1
                                ]?.timestamp
                        },

                        explanation:
                            `${cluster.length} transactions occurred ` +
                            `within a concentrated temporal window.`
                    },
                    input
                )
            );
        }

        patterns.push(
            ...this.detectUnusualHourPatterns(
                transactions,
                input
            )
        );

        return patterns;
    }

    buildTemporalClusters(
        sorted
    ) {

        const clusters =
            [];

        let current =
            [];

        for (
            const transaction
            of sorted
        ) {

            if (
                !current.length
            ) {

                current.push(
                    transaction
                );

                continue;
            }

            const previous =
                current[
                    current.length - 1
                ];

            if (
                this.minutesBetween(
                    previous.timestamp,
                    transaction.timestamp
                ) <=
                this.config.temporalClusterWindowMinutes
            ) {

                current.push(
                    transaction
                );

            } else {

                clusters.push(
                    current
                );

                current =
                    [
                        transaction
                    ];
            }
        }

        if (
            current.length
        ) {

            clusters.push(
                current
            );
        }

        return clusters;
    }

    detectUnusualHourPatterns(
        transactions,
        input
    ) {

        const unusual =
            transactions.filter(
                transaction =>
                    this.isUnusualHour(
                        transaction.timestamp
                    )
            );

        if (
            unusual.length <
            3
        ) {

            return [];
        }

        const score =
            clamp(
                0.40 +
                Math.min(
                    unusual.length /
                    20,
                    0.45
                )
            );

        return [
            this.createPattern(
                {

                    type:
                        PATTERN_TYPE.UNUSUAL_HOURS,

                    signalType:
                        SIGNAL_TYPE.BEHAVIORAL_ANOMALY,

                    score,

                    confidence:
                        this.calculateCountConfidence(
                            unusual.length,
                            3
                        ),

                    accountIds:
                        unique(
                            unusual.map(
                                transaction =>
                                    transaction.accountId
                            )
                        ),

                    transactionIds:
                        unusual.map(
                            transaction =>
                                transaction.id
                        ),

                    evidence: {

                        transactionCount:
                            unusual.length,

                        unusualHourRange:
                            `${this.config.unusualHourStart}:00-${this.config.unusualHourEnd}:00`
                    },

                    explanation:
                        `${unusual.length} transactions occurred ` +
                        `during configured unusual hours.`
                },
                input
            )
        ];
    }

    isUnusualHour(
        timestamp
    ) {

        if (
            !timestamp
        ) {

            return false;
        }

        const date =
            new Date(
                timestamp
            );

        const hour =
            date.getUTCHours();

        return (
            hour >=
            this.config.unusualHourStart &&
            hour <
            this.config.unusualHourEnd
        );
    }

    /**
     * =========================================================================
     * Amount Pattern Detection
     * =========================================================================
     */

    detectAmountPatterns(
        transactions,
        input
    ) {

        return [

            ...this.detectRoundAmountPatterns(
                transactions,
                input
            ),

            ...this.detectRepeatedAmountPatterns(
                transactions,
                input
            ),

            ...this.detectSplitTransactionPatterns(
                transactions,
                input
            )
        ];
    }

    detectRoundAmountPatterns(
        transactions,
        input
    ) {

        const roundTransactions =
            transactions.filter(
                transaction =>
                    this.isRoundAmount(
                        transaction.amount
                    )
            );

        if (
            roundTransactions.length <
            3
        ) {

            return [];
        }

        const score =
            clamp(
                0.35 +
                Math.min(
                    roundTransactions.length /
                    20,
                    0.50
                )
            );

        return [
            this.createPattern(
                {

                    type:
                        PATTERN_TYPE.ROUND_AMOUNT,

                    signalType:
                        SIGNAL_TYPE.TRANSACTION_ANOMALY,

                    score,

                    confidence:
                        this.calculateCountConfidence(
                            roundTransactions.length,
                            3
                        ),

                    accountIds:
                        unique(
                            roundTransactions.map(
                                transaction =>
                                    transaction.accountId
                            )
                        ),

                    transactionIds:
                        roundTransactions.map(
                            transaction =>
                                transaction.id
                        ),

                    evidence: {

                        transactionCount:
                            roundTransactions.length,

                        amounts:
                            unique(
                                roundTransactions.map(
                                    transaction =>
                                        transaction.amount
                                )
                            ).slice(
                                0,
                                this.config.maximumEvidenceItems
                            )
                    },

                    explanation:
                        `${roundTransactions.length} transactions ` +
                        `used highly structured round amounts.`
                },
                input
            )
        ];
    }

    isRoundAmount(
        amount
    ) {

        if (
            amount <=
            0
        ) {

            return false;
        }

        return (
            Math.abs(
                amount -
                Math.round(
                    amount
                )
            ) <=
            this.config.roundAmountTolerance
        );
    }

    detectRepeatedAmountPatterns(
        transactions,
        input
    ) {

        const amountGroups =
            new Map();

        for (
            const transaction
            of transactions
        ) {

            const key =
                String(
                    round(
                        transaction.amount,
                        2
                    )
                );

            if (
                !amountGroups.has(
                    key
                )
            ) {

                amountGroups.set(
                    key,
                    []
                );
            }

            amountGroups.get(
                key
            ).push(
                transaction
            );
        }

        const patterns =
            [];

        for (
            const [
                amount,
                grouped
            ]
            of amountGroups.entries()
        ) {

            if (
                grouped.length <
                this.config.minimumRepeatedTransactions
            ) {

                continue;
            }

            const score =
                clamp(
                    0.40 +
                    Math.min(
                        grouped.length /
                        20,
                        0.45
                    )
                );

            patterns.push(
                this.createPattern(
                    {

                        type:
                            PATTERN_TYPE.REPEATED_TRANSACTION,

                        signalType:
                            SIGNAL_TYPE.FRAUD_PATTERN,

                        score,

                        confidence:
                            this.calculateCountConfidence(
                                grouped.length,
                                this.config.minimumRepeatedTransactions
                            ),

                        accountIds:
                            unique(
                                grouped.map(
                                    transaction =>
                                        transaction.accountId
                                )
                            ),

                        transactionIds:
                            grouped.map(
                                transaction =>
                                    transaction.id
                            ),

                        evidence: {

                            repeatedAmount:
                                safeNumber(
                                    amount
                                ),

                            occurrenceCount:
                                grouped.length
                        },

                        explanation:
                            `${grouped.length} transactions repeated ` +
                            `the same amount (${amount}).`
                    },
                    input
                )
            );
        }

        return patterns;
    }

    detectSplitTransactionPatterns(
        transactions,
        input
    ) {

        const accountGroups =
            this.groupByAccount(
                transactions
            );

        const patterns =
            [];

        for (
            const [
                accountId,
                accountTransactions
            ]
            of accountGroups.entries()
        ) {

            const sorted =
                this.sortTransactions(
                    accountTransactions
                );

            for (
                let index = 0;
                index <
                sorted.length;
                index++
            ) {

                const transaction =
                    sorted[index];

                const nearby =
                    sorted.filter(
                        candidate => {

                            if (
                                candidate.id ===
                                transaction.id
                            ) {

                                return false;
                            }

                            return (
                                this.minutesBetween(
                                    transaction.timestamp,
                                    candidate.timestamp
                                ) <=
                                this.config.velocityWindowMinutes
                            );
                        }
                    );

                if (
                    nearby.length + 1 <
                    this.config.minimumSplitTransactions
                ) {

                    continue;
                }

                const amounts =
                    [

                        transaction.amount,

                        ...nearby.map(
                            candidate =>
                                candidate.amount
                        )
                    ];

                const total =
                    amounts.reduce(
                        (
                            sum,
                            amount
                        ) =>
                            sum +
                            amount,
                        0
                    );

                const similar =
                    nearby.filter(
                        candidate =>
                            this.amountsAreSimilar(
                                candidate.amount,
                                transaction.amount
                            )
                    );

                if (
                    similar.length <
                    this.config.minimumSplitTransactions -
                    1
                ) {

                    continue;
                }

                const involved =
                    [

                        transaction,

                        ...nearby
                    ];

                patterns.push(
                    this.createPattern(
                        {

                            type:
                                PATTERN_TYPE.SPLIT_TRANSACTION,

                            signalType:
                                SIGNAL_TYPE.TRANSACTION_ANOMALY,

                            score:
                                clamp(
                                    0.55 +
                                    Math.min(
                                        involved.length /
                                        20,
                                        0.30
                                    )
                                ),

                            confidence:
                                clamp(
                                    0.55 +
                                    Math.min(
                                        similar.length /
                                        10,
                                        0.35
                                    )
                                ),

                            accountIds:
                                [
                                    accountId
                                ],

                            transactionIds:
                                unique(
                                    involved.map(
                                        candidate =>
                                            candidate.id
                                    )
                                ),

                            evidence: {

                                transactionCount:
                                    involved.length,

                                totalAmount:
                                    total,

                                amounts:
                                    amounts,

                                windowMinutes:
                                    this.config.velocityWindowMinutes
                            },

                            explanation:
                                `${involved.length} similarly sized ` +
                                `transactions were executed by account ` +
                                `${accountId} within a short window, which ` +
                                `may indicate transaction splitting.`
                        },
                        input
                    )
                );
            }
        }

        return patterns;
    }

    amountsAreSimilar(
        first,
        second
    ) {

        const maximum =
            Math.max(
                Math.abs(
                    first
                ),
                Math.abs(
                    second
                ),
                1
            );

        return (
            Math.abs(
                first -
                second
            ) /
            maximum <=
            this.config.amountSimilarityTolerance
        );
    }

    /**
     * =========================================================================
     * Network Pattern Detection
     * =========================================================================
     */

    detectNetworkPatterns(
        transactions,
        input
    ) {

        const patterns =
            [];

        patterns.push(
            ...this.detectFanIn(
                transactions,
                input
            )
        );

        patterns.push(
            ...this.detectFanOut(
                transactions,
                input
            )
        );

        patterns.push(
            ...this.detectSharedCounterparty(
                transactions,
                input
            )
        );

        patterns.push(
            ...this.detectSharedDevice(
                transactions,
                input
            )
        );

        patterns.push(
            ...this.detectSharedIP(
                transactions,
                input
            )
        );

        patterns.push(
            ...this.detectCircularFlows(
                transactions,
                input
            )
        );

        return patterns;
    }

    detectFanIn(
        transactions,
        input
    ) {

        const counterpartyGroups =
            new Map();

        for (
            const transaction
            of transactions
        ) {

            if (
                !transaction.counterpartyAccountId
            ) {

                continue;
            }

            if (
                transaction.direction !==
                'INFLOW'
            ) {

                continue;
            }

            const key =
                transaction.accountId;

            if (
                !counterpartyGroups.has(
                    key
                )
            ) {

                counterpartyGroups.set(
                    key,
                    []
                );
            }

            counterpartyGroups.get(
                key
            ).push(
                transaction
            );
        }

        const patterns =
            [];

        for (
            const [
                accountId,
                grouped
            ]
            of counterpartyGroups.entries()
        ) {

            const sources =
                unique(
                    grouped.map(
                        transaction =>
                            transaction.counterpartyAccountId
                    )
                );

            if (
                sources.length <
                this.config.minimumFanInCount
            ) {

                continue;
            }

            const score =
                sources.length >=
                this.config.highFanInCount
                    ? 0.90
                    : clamp(
                        0.50 +
                        (
                            sources.length -
                            this.config.minimumFanInCount
                        ) /
                        Math.max(
                            this.config.highFanInCount -
                            this.config.minimumFanInCount,
                            1
                        ) *
                        0.35
                    );

            patterns.push(
                this.createPattern(
                    {

                        type:
                            PATTERN_TYPE.FAN_IN,

                        signalType:
                            SIGNAL_TYPE.NETWORK,

                        score,

                        confidence:
                            this.calculateCountConfidence(
                                sources.length,
                                this.config.minimumFanInCount
                            ),

                        accountIds:
                            unique(
                                [

                                    accountId,

                                    ...sources
                                ]
                            ),

                        transactionIds:
                            grouped.map(
                                transaction =>
                                    transaction.id
                            ),

                        evidence: {

                            destinationAccount:
                                accountId,

                            sourceAccountCount:
                                sources.length,

                            sourceAccounts:
                                sources
                        },

                        explanation:
                            `Account ${accountId} received funds from ` +
                            `${sources.length} distinct counterparties.`
                    },
                    input
                )
            );
        }

        return patterns;
    }

    detectFanOut(
        transactions,
        input
    ) {

        const accountGroups =
            this.groupByAccount(
                transactions
            );

        const patterns =
            [];

        for (
            const [
                accountId,
                grouped
            ]
            of accountGroups.entries()
        ) {

            const outflows =
                grouped.filter(
                    transaction =>
                        transaction.direction ===
                        'OUTFLOW'
                );

            const destinations =
                unique(
                    outflows.map(
                        transaction =>
                            transaction.counterpartyAccountId
                    )
                );

            if (
                destinations.length <
                this.config.minimumFanOutCount
            ) {

                continue;
            }

            const score =
                destinations.length >=
                this.config.highFanOutCount
                    ? 0.90
                    : clamp(
                        0.50 +
                        (
                            destinations.length -
                            this.config.minimumFanOutCount
                        ) /
                        Math.max(
                            this.config.highFanOutCount -
                            this.config.minimumFanOutCount,
                            1
                        ) *
                        0.35
                    );

            patterns.push(
                this.createPattern(
                    {

                        type:
                            PATTERN_TYPE.FAN_OUT,

                        signalType:
                            SIGNAL_TYPE.NETWORK,

                        score,

                        confidence:
                            this.calculateCountConfidence(
                                destinations.length,
                                this.config.minimumFanOutCount
                            ),

                        accountIds:
                            unique(
                                [

                                    accountId,

                                    ...destinations
                                ]
                            ),

                        transactionIds:
                            outflows.map(
                                transaction =>
                                    transaction.id
                            ),

                        evidence: {

                            sourceAccount:
                                accountId,

                            destinationAccountCount:
                                destinations.length,

                            destinationAccounts:
                                destinations
                        },

                        explanation:
                            `Account ${accountId} sent funds to ` +
                            `${destinations.length} distinct counterparties.`
                    },
                    input
                )
            );
        }

        return patterns;
    }

    detectSharedCounterparty(
        transactions,
        input
    ) {

        const counterpartyMap =
            new Map();

        for (
            const transaction
            of transactions
        ) {

            if (
                !transaction.counterpartyAccountId
            ) {

                continue;
            }

            if (
                !counterpartyMap.has(
                    transaction.counterpartyAccountId
                )
            ) {

                counterpartyMap.set(
                    transaction.counterpartyAccountId,
                    []
                );
            }

            counterpartyMap.get(
                transaction.counterpartyAccountId
            ).push(
                transaction
            );
        }

        const patterns =
            [];

        for (
            const [
                counterparty,
                grouped
            ]
            of counterpartyMap.entries()
        ) {

            const accounts =
                unique(
                    grouped.map(
                        transaction =>
                            transaction.accountId
                    )
                );

            if (
                accounts.length <
                2
            ) {

                continue;
            }

            const score =
                clamp(
                    0.45 +
                    Math.min(
                        accounts.length /
                        15,
                        0.45
                    )
                );

            patterns.push(
                this.createPattern(
                    {

                        type:
                            PATTERN_TYPE.SHARED_COUNTERPARTY,

                        signalType:
                            SIGNAL_TYPE.NETWORK,

                        score,

                        confidence:
                            this.calculateCountConfidence(
                                accounts.length,
                                2
                            ),

                        accountIds:
                            [

                                ...accounts,

                                counterparty
                            ],

                        transactionIds:
                            grouped.map(
                                transaction =>
                                    transaction.id
                            ),

                        evidence: {

                            counterpartyAccount:
                                counterparty,

                            accountCount:
                                accounts.length,

                            accounts
                        },

                        explanation:
                            `${accounts.length} accounts shared ` +
                            `counterparty ${counterparty}.`
                    },
                    input
                )
            );
        }

        return patterns;
    }

    detectSharedDevice(
        transactions,
        input
    ) {

        return this.detectSharedIdentifier(
            transactions,
            input,
            'deviceId',
            PATTERN_TYPE.SHARED_DEVICE,
            'device'
        );
    }

    detectSharedIP(
        transactions,
        input
    ) {

        return this.detectSharedIdentifier(
            transactions,
            input,
            'ipAddress',
            PATTERN_TYPE.SHARED_IP,
            'IP address'
        );
    }

    detectSharedIdentifier(
        transactions,
        input,
        property,
        patternType,
        label
    ) {

        const groups =
            new Map();

        for (
            const transaction
            of transactions
        ) {

            const identifier =
                transaction[
                    property
                ];

            if (
                !identifier
            ) {

                continue;
            }

            if (
                !groups.has(
                    identifier
                )
            ) {

                groups.set(
                    identifier,
                    []
                );
            }

            groups.get(
                identifier
            ).push(
                transaction
            );
        }

        const patterns =
            [];

        for (
            const [
                identifier,
                grouped
            ]
            of groups.entries()
        ) {

            const accounts =
                unique(
                    grouped.map(
                        transaction =>
                            transaction.accountId
                    )
                );

            if (
                accounts.length <
                2
            ) {

                continue;
            }

            const score =
                clamp(
                    0.50 +
                    Math.min(
                        accounts.length /
                        15,
                        0.40
                    )
                );

            patterns.push(
                this.createPattern(
                    {

                        type:
                            patternType,

                        signalType:
                            SIGNAL_TYPE.NETWORK,

                        score,

                        confidence:
                            this.calculateCountConfidence(
                                accounts.length,
                                2
                            ),

                        accountIds:
                            accounts,

                        transactionIds:
                            grouped.map(
                                transaction =>
                                    transaction.id
                            ),

                        evidence: {

                            sharedIdentifier:
                                identifier,

                            accountCount:
                                accounts.length,

                            accounts
                        },

                        explanation:
                            `${accounts.length} accounts shared ` +
                            `the same ${label}.`
                    },
                    input
                )
            );
        }

        return patterns;
    }

    /**
     * =========================================================================
     * Circular Flow Detection
     * =========================================================================
     */

    detectCircularFlows(
        transactions,
        input
    ) {

        const edges =
            new Map();

        for (
            const transaction
            of transactions
        ) {

            if (
                !transaction.accountId ||
                !transaction.counterpartyAccountId
            ) {

                continue;
            }

            if (
                transaction.direction !==
                'OUTFLOW'
            ) {

                continue;
            }

            if (
                !edges.has(
                    transaction.accountId
                )
            ) {

                edges.set(
                    transaction.accountId,
                    []
                );
            }

            edges.get(
                transaction.accountId
            ).push(
                {

                    destination:
                        transaction.counterpartyAccountId,

                    transaction
                }
            );
        }

        const patterns =
            [];

        const visitedCycles =
            new Set();

        for (
            const [
                startAccount
            ]
            of edges.entries()
        ) {

            const cycles =
                this.findCycles(
                    startAccount,
                    edges,
                    5
                );

            for (
                const cycle
                of cycles
            ) {

                const key =
                    [
                        ...cycle.accounts
                    ]
                        .sort()
                        .join(
                            '|'
                        );

                if (
                    visitedCycles.has(
                        key
                    )
                ) {

                    continue;
                }

                visitedCycles.add(
                    key
                );

                if (
                    cycle.transactions.length <
                    this.config.minimumCircularTransactions
                ) {

                    continue;
                }

                patterns.push(
                    this.createPattern(
                        {

                            type:
                                PATTERN_TYPE.CIRCULAR_FLOW,

                            signalType:
                                SIGNAL_TYPE.NETWORK,

                            score:
                                clamp(
                                    0.65 +
                                    Math.min(
                                        cycle.accounts.length /
                                        10,
                                        0.25
                                    )
                                ),

                            confidence:
                                clamp(
                                    0.60 +
                                    Math.min(
                                        cycle.transactions.length /
                                        10,
                                        0.30
                                    )
                                ),

                            accountIds:
                                cycle.accounts,

                            transactionIds:
                                cycle.transactions.map(
                                    transaction =>
                                        transaction.id
                                ),

                            evidence: {

                                cycle:
                                    cycle.accounts,

                                transactionCount:
                                    cycle.transactions.length
                            },

                            explanation:
                                `A circular movement pattern was detected ` +
                                `across ${cycle.accounts.length} accounts.`
                        },
                        input
                    )
                );
            }
        }

        return patterns;
    }

    findCycles(
        startAccount,
        edges,
        maxDepth
    ) {

        const cycles =
            [];

        const visit =
            (
                current,
                pathAccounts,
                pathTransactions,
                depth
            ) => {

                if (
                    depth >
                    maxDepth
                ) {

                    return;
                }

                const outgoing =
                    edges.get(
                        current
                    ) ||
                    [];

                for (
                    const edge
                    of outgoing
                ) {

                    if (
                        edge.destination ===
                        startAccount
                    ) {

                        if (
                            pathAccounts.length >=
                            this.config.minimumCircularTransactions
                        ) {

                            cycles.push(
                                {

                                    accounts:
                                        [
                                            ...pathAccounts
                                        ],

                                    transactions:
                                        [

                                            ...pathTransactions,

                                            edge.transaction
                                        ]
                                }
                            );
                        }

                        continue;
                    }

                    if (
                        pathAccounts.includes(
                            edge.destination
                        )
                    ) {

                        continue;
                    }

                    visit(
                        edge.destination,
                        [

                            ...pathAccounts,

                            edge.destination
                        ],
                        [

                            ...pathTransactions,

                            edge.transaction
                        ],
                        depth + 1
                    );
                }
            };

        visit(
            startAccount,
            [
                startAccount
            ],
            [],
            1
        );

        return cycles;
    }

    /**
     * =========================================================================
     * Behavioral Detection
     * =========================================================================
     */

    detectBehavioralPatterns(
        transactions,
        input
    ) {

        const patterns =
            [];

        patterns.push(
            ...this.detectCounterpartyConcentration(
                transactions,
                input
            )
        );

        patterns.push(
            ...this.detectTransactionChains(
                transactions,
                input
            )
        );

        return patterns;
    }

    detectCounterpartyConcentration(
        transactions,
        input
    ) {

        const accountGroups =
            this.groupByAccount(
                transactions
            );

        const patterns =
            [];

        for (
            const [
                accountId,
                grouped
            ]
            of accountGroups.entries()
        ) {

            if (
                grouped.length <
                5
            ) {

                continue;
            }

            const counterpartyCounts =
                new Map();

            for (
                const transaction
                of grouped
            ) {

                const counterparty =
                    transaction.counterpartyAccountId;

                if (
                    !counterparty
                ) {

                    continue;
                }

                counterpartyCounts.set(
                    counterparty,
                    (
                        counterpartyCounts.get(
                            counterparty
                        ) ||
                        0
                    ) +
                    1
                );
            }

            if (
                !counterpartyCounts.size
            ) {

                continue;
            }

            const largest =
                Math.max(
                    ...counterpartyCounts.values()
                );

            const concentration =
                largest /
                grouped.length;

            if (
                concentration <
                this.config.minimumCounterpartyConcentration
            ) {

                continue;
            }

            const dominantCounterparty =
                [
                    ...counterpartyCounts.entries()
                ]
                    .sort(
                        (
                            first,
                            second
                        ) =>
                            second[1] -
                            first[1]
                    )[0]?.[0];

            patterns.push(
                this.createPattern(
                    {

                        type:
                            PATTERN_TYPE.COUNTERPARTY_CONCENTRATION,

                        signalType:
                            SIGNAL_TYPE.BEHAVIORAL_ANOMALY,

                        score:
                            clamp(
                                0.40 +
                                concentration *
                                0.50
                            ),

                        confidence:
                            clamp(
                                0.50 +
                                concentration *
                                0.40
                            ),

                        accountIds:
                            unique(
                                [

                                    accountId,

                                    dominantCounterparty
                                ]
                            ),

                        transactionIds:
                            grouped
                                .filter(
                                    transaction =>
                                        transaction.counterpartyAccountId ===
                                        dominantCounterparty
                                )
                                .map(
                                    transaction =>
                                        transaction.id
                                ),

                        evidence: {

                            accountId,

                            concentration:
                                round(
                                    concentration
                                ),

                            dominantCounterparty,

                            dominantTransactionCount:
                                largest,

                            totalTransactions:
                                grouped.length
                        },

                        explanation:
                            `Account ${accountId} concentrated ` +
                            `${round(
                                concentration * 100,
                                2
                            )}% of observed transactions with ` +
                            `counterparty ${dominantCounterparty}.`
                    },
                    input
                )
            );
        }

        return patterns;
    }

    detectTransactionChains(
        transactions,
        input
    ) {

        const sorted =
            this.sortTransactions(
                transactions
            );

        const patterns =
            [];

        for (
            let index = 0;
            index <
            sorted.length -
            2;
            index++
        ) {

            const first =
                sorted[index];

            const second =
                sorted[index + 1];

            const third =
                sorted[index + 2];

            if (
                !first.counterpartyAccountId ||
                !second.accountId ||
                !third.accountId
            ) {

                continue;
            }

            if (
                first.counterpartyAccountId !==
                second.accountId
            ) {

                continue;
            }

            if (
                this.minutesBetween(
                    first.timestamp,
                    second.timestamp
                ) >
                this.config.rapidMovementWindowMinutes
            ) {

                continue;
            }

            if (
                second.counterpartyAccountId !==
                third.accountId
            ) {

                continue;
            }

            if (
                this.minutesBetween(
                    second.timestamp,
                    third.timestamp
                ) >
                this.config.rapidMovementWindowMinutes
            ) {

                continue;
            }

            const accounts =
                unique(
                    [

                        first.accountId,

                        first.counterpartyAccountId,

                        second.counterpartyAccountId,

                        third.counterpartyAccountId
                    ]
                );

            patterns.push(
                this.createPattern(
                    {

                        type:
                            PATTERN_TYPE.TRANSACTION_CHAIN,

                        signalType:
                            SIGNAL_TYPE.NETWORK,

                        score:
                            0.70,

                        confidence:
                            0.70,

                        accountIds:
                            accounts,

                        transactionIds:
                            [

                                first.id,

                                second.id,

                                third.id
                            ],

                        evidence: {

                            transactionChain:
                                [

                                    {

                                        transactionId:
                                            first.id,

                                        from:
                                            first.accountId,

                                        to:
                                            first.counterpartyAccountId,

                                        amount:
                                            first.amount
                                    },

                                    {

                                        transactionId:
                                            second.id,

                                        from:
                                            second.accountId,

                                        to:
                                            second.counterpartyAccountId,

                                        amount:
                                            second.amount
                                    },

                                    {

                                        transactionId:
                                            third.id,

                                        from:
                                            third.accountId,

                                        to:
                                            third.counterpartyAccountId,

                                        amount:
                                            third.amount
                                    }
                                ]
                        },

                        explanation:
                            'A rapid sequential transaction chain was detected ' +
                            'across related accounts.'
                    },
                    input
                )
            );
        }

        return patterns;
    }

    /**
     * =========================================================================
     * Dormant Account Detection
     * =========================================================================
     */

    detectDormancyPatterns(
        transactions,
        input
    ) {

        /*
         * Dormancy requires a sufficiently long historical window.
         * If timestamps do not establish meaningful inactivity, the detector
         * deliberately returns no signal rather than guessing.
         */

        const accountGroups =
            this.groupByAccount(
                transactions
            );

        const patterns =
            [];

        for (
            const [
                accountId,
                grouped
            ]
            of accountGroups.entries()
        ) {

            const sorted =
                this.sortTransactions(
                    grouped
                );

            if (
                sorted.length <
                2
            ) {

                continue;
            }

            for (
                let index = 1;
                index <
                sorted.length;
                index++
            ) {

                const previous =
                    sorted[
                        index - 1
                    ];

                const current =
                    sorted[
                        index
                    ];

                const gapDays =
                    this.daysBetween(
                        previous.timestamp,
                        current.timestamp
                    );

                if (
                    gapDays <
                    30
                ) {

                    continue;
                }

                patterns.push(
                    this.createPattern(
                        {

                            type:
                                PATTERN_TYPE.DORMANT_ACCOUNT_ACTIVITY,

                            signalType:
                                SIGNAL_TYPE.BEHAVIORAL_ANOMALY,

                            score:
                                clamp(
                                    0.45 +
                                    Math.min(
                                        gapDays /
                                        365,
                                        0.40
                                    )
                                ),

                            confidence:
                                clamp(
                                    0.55 +
                                    Math.min(
                                        gapDays /
                                        365,
                                        0.30
                                    )
                                ),

                            accountIds:
                                [
                                    accountId
                                ],

                            transactionIds:
                                [
                                    current.id
                                ],

                            evidence: {

                                dormancyDays:
                                    round(
                                        gapDays,
                                        2
                                    ),

                                previousTransactionAt:
                                    previous.timestamp,

                                resumedTransactionAt:
                                    current.timestamp
                            },

                            explanation:
                                `Account ${accountId} resumed activity ` +
                                `after approximately ${round(
                                    gapDays,
                                    1
                                )} days of inactivity.`
                        },
                        input
                    )
                );
            }
        }

        return patterns;
    }

    /**
     * =========================================================================
     * Pattern Factory
     * =========================================================================
     */

    createPattern(
        definition,
        input
    ) {

        const accountIds =
            unique(
                definition.accountIds || []
            )
                .slice(
                    0,
                    this.config.maximumAccounts
                );

        const transactionIds =
            unique(
                definition.transactionIds || []
            )
                .slice(
                    0,
                    this.config.maximumTransactions
                );

        const evidence =
            this.sanitizeValue(
                definition.evidence || {}
            );

        const patternId =
            this.generatePatternId(
                {

                    tenantId:
                        input.tenantId,

                    type:
                        definition.type,

                    accountIds,

                    transactionIds
                }
            );

        return {

            id:
                patternId,

            tenantId:
                input.tenantId,

            type:
                definition.type,

            signalType:
                definition.signalType ||
                SIGNAL_TYPE.FRAUD_PATTERN,

            source:
                MODULE_NAME,

            score:
                clamp(
                    definition.score
                ),

            confidence:
                clamp(
                    definition.confidence
                ),

            riskLevel:
                this.getRiskLevel(
                    definition.score
                ),

            severity:
                this.getSeverity(
                    definition.score
                ),

            accountIds,

            transactionIds,

            entityIds:
                unique(
                    definition.entityIds || []
                ),

            detectedAt:
                now(),

            evidence,

            explanation:
                definition.explanation ||
                null,

            tags:
                unique(
                    [

                        'FRAUD_PATTERN',

                        definition.type,

                        this.getRiskLevel(
                            definition.score
                        )
                    ]
                ),

            metadata: {

                schemaVersion:
                    SCHEMA_VERSION,

                sourceAnalysisId:
                    input.analysisId,

                statementId:
                    input.statementId
            }
        };
    }

    /**
     * =========================================================================
     * Pattern Normalization
     * =========================================================================
     */

    normalizePatterns(
        patterns,
        tenantId
    ) {

        return patterns
            .filter(
                pattern =>
                    pattern &&
                    pattern.tenantId ===
                    tenantId
            )
            .filter(
                pattern =>
                    pattern.score >=
                    this.config.minimumPatternScore
            )
            .filter(
                pattern =>
                    pattern.confidence >=
                    this.config.minimumConfidence
            )
            .sort(
                (
                    first,
                    second
                ) =>
                    second.score -
                    first.score
            )
            .slice(
                0,
                this.config.maximumPatterns
            );
    }

    /**
     * =========================================================================
     * Pattern Deduplication
     * =========================================================================
     */

    deduplicatePatterns(
        patterns
    ) {

        if (
            !this.config.enablePatternDeduplication
        ) {

            return patterns;
        }

        const map =
            new Map();

        for (
            const pattern
            of patterns
        ) {

            const key =
                [

                    pattern.type,

                    ...[
                        ...pattern.accountIds
                    ].sort(),

                    ...[
                        ...pattern.transactionIds
                    ].sort()
                ]
                    .join(
                        '|'
                    );

            const existing =
                map.get(
                    key
                );

            if (
                !existing ||
                pattern.score >
                existing.score
            ) {

                map.set(
                    key,
                    pattern
                );
            }
        }

        return [
            ...map.values()
        ]
            .sort(
                (
                    first,
                    second
                ) =>
                    second.score -
                    first.score
            )
            .slice(
                0,
                this.config.maximumPatterns
            );
    }

    /**
     * =========================================================================
     * Risk Classification
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

            return SEVERITY.CRITICAL;
        }

        if (
            score >=
            this.config.highRiskThreshold
        ) {

            return SEVERITY.HIGH;
        }

        if (
            score >=
            0.40
        ) {

            return SEVERITY.MEDIUM;
        }

        return SEVERITY.LOW;
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    calculatePatternStatistics(
        patterns
    ) {

        const byType =
            {};

        const byRisk =
            {};

        const bySeverity =
            {};

        for (
            const pattern
            of patterns
        ) {

            byType[
                pattern.type
            ] =
                (
                    byType[
                        pattern.type
                    ] ||
                    0
                ) +
                1;

            byRisk[
                pattern.riskLevel
            ] =
                (
                    byRisk[
                        pattern.riskLevel
                    ] ||
                    0
                ) +
                1;

            bySeverity[
                pattern.severity
            ] =
                (
                    bySeverity[
                        pattern.severity
                    ] ||
                    0
                ) +
                1;
        }

        return {

            byType,

            byRisk,

            bySeverity,

            total:
                patterns.length,

            highRisk:
                patterns.filter(
                    pattern =>
                        pattern.riskLevel ===
                        RISK_LEVEL.HIGH
                ).length,

            criticalRisk:
                patterns.filter(
                    pattern =>
                        pattern.riskLevel ===
                        RISK_LEVEL.CRITICAL
                ).length
        };
    }

    /**
     * =========================================================================
     * Result Builder
     * =========================================================================
     */

    buildDetectionResult(
        input,
        startedAt
    ) {

        const patterns =
            input.patterns;

        const riskScore =
            patterns.length
                ? Math.max(
                    ...patterns.map(
                        pattern =>
                            pattern.score
                    )
                )
                : 0;

        const confidence =
            patterns.length
                ? mean(
                    patterns.map(
                        pattern =>
                            pattern.confidence
                    )
                )
                : 0;

        return {

            schemaVersion:
                SCHEMA_VERSION,

            module:
                MODULE_NAME,

            moduleVersion:
                MODULE_VERSION,

            detectionId:
                input.detectionId,

            tenantId:
                input.tenantId,

            accountId:
                input.accountId,

            statementId:
                input.statementId,

            analysisId:
                input.analysisId,

            source:
                input.source,

            transactionCount:
                input.transactions.length,

            patternCount:
                patterns.length,

            riskScore:
                round(
                    riskScore
                ),

            riskLevel:
                this.getRiskLevel(
                    riskScore
                ),

            severity:
                this.getSeverity(
                    riskScore
                ),

            confidence:
                round(
                    confidence
                ),

            patterns,

            statistics:
                this.calculatePatternStatistics(
                    patterns
                ),

            accounts:
                unique(
                    patterns.flatMap(
                        pattern =>
                            pattern.accountIds
                    )
                )
                    .slice(
                        0,
                        this.config.maximumAccounts
                    ),

            transactions:
                this.config.preserveRawTransactions
                    ? input.transactions
                    : undefined,

            metadata:
                input.metadata,

            createdAt:
                now(),

            durationMs:
                Date.now() -
                startedAt
        };
    }

    buildEmptyResult(
        input,
        detectionId,
        startedAt
    ) {

        return {

            schemaVersion:
                SCHEMA_VERSION,

            module:
                MODULE_NAME,

            moduleVersion:
                MODULE_VERSION,

            detectionId,

            tenantId:
                input.tenantId,

            accountId:
                input.accountId,

            statementId:
                input.statementId,

            analysisId:
                input.analysisId,

            source:
                input.source,

            transactionCount:
                0,

            patternCount:
                0,

            riskScore:
                0,

            riskLevel:
                RISK_LEVEL.MINIMAL,

            severity:
                SEVERITY.LOW,

            confidence:
                0,

            patterns:
                [],

            statistics:
                this.calculatePatternStatistics(
                    []
                ),

            createdAt:
                now(),

            durationMs:
                Date.now() -
                startedAt
        };
    }

    /**
     * =========================================================================
     * Grouping / Sorting
     * =========================================================================
     */

    groupByAccount(
        transactions
    ) {

        const groups =
            new Map();

        for (
            const transaction
            of transactions
        ) {

            const accountId =
                transaction.accountId;

            if (
                !accountId
            ) {

                continue;
            }

            if (
                !groups.has(
                    accountId
                )
            ) {

                groups.set(
                    accountId,
                    []
                );
            }

            groups.get(
                accountId
            ).push(
                transaction
            );
        }

        return groups;
    }

    sortTransactions(
        transactions
    ) {

        return [
            ...transactions
        ].sort(
            (
                first,
                second
            ) => {

                const firstTime =
                    Date.parse(
                        first.timestamp
                    );

                const secondTime =
                    Date.parse(
                        second.timestamp
                    );

                return (
                    (
                        Number.isFinite(
                            firstTime
                        )
                            ? firstTime
                            : 0
                    ) -
                    (
                        Number.isFinite(
                            secondTime
                        )
                            ? secondTime
                            : 0
                    )
                );
            }
        );
    }

    /**
     * =========================================================================
     * Date Helpers
     * =========================================================================
     */

    minutesBetween(
        first,
        second
    ) {

        const firstTime =
            Date.parse(
                first
            );

        const secondTime =
            Date.parse(
                second
            );

        if (
            !Number.isFinite(
                firstTime
            ) ||
            !Number.isFinite(
                secondTime
            )
        ) {

            return Infinity;
        }

        return Math.abs(
            secondTime -
            firstTime
        ) /
        60000;
    }

    daysBetween(
        first,
        second
    ) {

        return this.minutesBetween(
            first,
            second
        ) /
        1440;
    }

    /**
     * =========================================================================
     * Confidence Helpers
     * =========================================================================
     */

    calculateCountConfidence(
        count,
        minimum
    ) {

        if (
            count <
            minimum
        ) {

            return 0;
        }

        return clamp(
            0.50 +
            (
                count -
                minimum
            ) /
            Math.max(
                minimum * 3,
                1
            ) *
            0.40
        );
    }

    /**
     * =========================================================================
     * Deterministic IDs
     * =========================================================================
     */

    generateDetectionId(
        input
    ) {

        const payload =
            [

                input.tenantId,

                input.accountId,

                input.statementId,

                input.analysisId,

                ...input.transactions
                    .map(
                        transaction =>
                            transaction.id ||
                            transaction.transactionId ||
                            transaction._id
                    )
                    .filter(
                        Boolean
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

    generatePatternId(
        input
    ) {

        const payload =
            [

                input.tenantId,

                input.type,

                ...[
                    ...input.accountIds
                ].sort(),

                ...[
                    ...input.transactionIds
                ].sort()
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
     * Persistence
     * =========================================================================
     */

    async persistResult(
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
                'Fraud pattern result persistence failed.',
                {

                    detectionId:
                        result.detectionId,

                    error:
                        error.message
                }
            );

            throw new FraudPatternDetectorError(
                'Fraud pattern result persistence failed.',
                'PERSISTENCE_FAILED',
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
     * Audit
     * =========================================================================
     */

    recordAudit(
        event,
        metadata,
        actor
    ) {

        if (
            !this.auditLogger
        ) {

            return;
        }

        try {

            if (
                typeof this.auditLogger.log ===
                'function'
            ) {

                this.auditLogger.log(
                    {

                        event,

                        actor:
                            actor || null,

                        metadata: {

                            module:
                                MODULE_NAME,

                            version:
                                MODULE_VERSION,

                            ...metadata
                        },

                        timestamp:
                            now()
                    }
                );

                return;
            }

            if (
                typeof this.auditLogger.record ===
                'function'
            ) {

                this.auditLogger.record(
                    event,
                    metadata,
                    actor
                );
            }

        } catch (
            error
        ) {

            this.log(
                'warn',
                'Fraud pattern audit logging failed.',
                {

                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    recordMetric(
        metric,
        labels = {}
    ) {

        if (
            !this.metrics
        ) {

            return;
        }

        try {

            if (
                typeof this.metrics.increment ===
                'function'
            ) {

                this.metrics.increment(
                    metric,
                    labels
                );

                return;
            }

            if (
                typeof this.metrics.inc ===
                'function'
            ) {

                this.metrics.inc(
                    metric,
                    labels
                );
            }

        } catch (
            error
        ) {

            /*
             * Metrics must never affect fraud processing.
             */
        }
    }

    /**
     * =========================================================================
     * Sanitization
     * =========================================================================
     */

    sanitizeValue(
        value,
        depth = 0
    ) {

        if (
            depth >
            8
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

            return value.length >
                4000
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
                    nested
                ]
                of Object.entries(
                    value
                )
            ) {

                result[key] =
                    this.sanitizeValue(
                        nested,
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
                SCHEMA_VERSION,

            dependencies: {

                repository:
                    repositoryHealthy,

                featureExtractor:
                    Boolean(
                        this.featureExtractor
                    ),

                crossAccountAnalyzer:
                    Boolean(
                        this.crossAccountAnalyzer
                    )
            },

            capabilities: {

                velocity:
                    this.config.enableVelocityDetection,

                temporal:
                    this.config.enableTemporalDetection,

                amount:
                    this.config.enableAmountDetection,

                network:
                    this.config.enableNetworkDetection,

                behavioral:
                    this.config.enableBehavioralDetection,

                dormancy:
                    this.config.enableDormancyDetection
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
                SCHEMA_VERSION,

            capabilities: [

                'velocity-pattern-detection',

                'temporal-pattern-detection',

                'amount-pattern-detection',

                'round-amount-detection',

                'repeated-amount-detection',

                'transaction-splitting-detection',

                'fan-in-detection',

                'fan-out-detection',

                'shared-counterparty-detection',

                'shared-device-detection',

                'shared-ip-detection',

                'circular-flow-detection',

                'transaction-chain-detection',

                'counterparty-concentration',

                'unusual-hour-detection',

                'dormant-account-activity',

                'pattern-deduplication',

                'deterministic-pattern-identifiers',

                'explainable-evidence',

                'tenant-isolation',

                'audit-hooks',

                'metrics-hooks'
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

                createsRepairs:
                    false,

                declaresLegalFraud:
                    false,

                producesFraudSignals:
                    true,

                producesRiskIntelligence:
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

function createFraudPatternDetector(
    options = {}
) {

    return new FraudPatternDetector(
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

    SCHEMA_VERSION,

    PATTERN_TYPE,

    SIGNAL_TYPE,

    RISK_LEVEL,

    SEVERITY,

    DEFAULT_CONFIG,

    FraudPatternDetector,

    FraudPatternDetectorError,

    createFraudPatternDetector
};