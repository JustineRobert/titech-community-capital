'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * CrossAccountAnalyzer
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/fraud/CrossAccountAnalyzer.js
 *
 * Purpose:
 *   Enterprise cross-account financial intelligence engine.
 *
 * Responsibilities:
 *   - Detect relationships between accounts
 *   - Detect shared counterparties
 *   - Detect fan-in / fan-out patterns
 *   - Detect circular transaction paths
 *   - Detect rapid fund movement across accounts
 *   - Detect unusual account-to-account concentration
 *   - Detect coordinated transaction behavior
 *   - Detect common-device / channel / reference signals when supplied
 *   - Build account relationship graphs
 *   - Generate explainable risk signals
 *   - Calculate deterministic risk scores
 *   - Support tenant isolation
 *   - Support configurable thresholds
 *   - Preserve auditability
 *   - Remain safe for large transaction datasets
 *
 * IMPORTANT:
 *   This module is an intelligence / detection component.
 *
 *   It MUST NOT:
 *   - freeze accounts
 *   - block transactions
 *   - reverse transactions
 *   - post ledger entries
 *   - modify financial records
 *   - make legal conclusions
 *   - declare fraud as an established fact
 *
 * All results are risk signals requiring downstream policy, investigation,
 * human review, or additional deterministic controls.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODULE_NAME =
    'CrossAccountAnalyzer';

const MODULE_VERSION =
    '1.0.0';

const ANALYSIS_VERSION =
    '1.0.0';

const DEFAULT_CONFIG =
    Object.freeze({

        maxTransactions:
            100000,

        maxAccounts:
            10000,

        maxRelationships:
            250000,

        maxGraphDepth:
            4,

        maxCycleLength:
            6,

        velocityWindowMinutes:
            30,

        rapidMovementWindowMinutes:
            15,

        fanInThreshold:
            8,

        fanOutThreshold:
            8,

        concentrationThreshold:
            0.35,

        sharedCounterpartyThreshold:
            3,

        circularPathThreshold:
            1,

        minimumTransactionAmount:
            0,

        highValueMultiplier:
            3,

        riskScoreWeights: {

            velocity:
                0.18,

            fanIn:
                0.14,

            fanOut:
                0.14,

            circular:
                0.20,

            concentration:
                0.10,

            sharedCounterparty:
                0.08,

            coordination:
                0.10,

            networkDensity:
                0.06
        },

        riskBands: {

            LOW:
                0.25,

            MEDIUM:
                0.50,

            HIGH:
                0.75
        },

        suspiciousRiskThreshold:
            0.60,

        criticalRiskThreshold:
            0.85,

        enableDeviceSignals:
            true,

        enableChannelSignals:
            true,

        enableReferenceSignals:
            true,

        enableCircularDetection:
            true,

        enableCoordinationDetection:
            true,

        enableAmountNormalization:
            true,

        preserveRawReferences:
            false
    });

const RISK_BAND =
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

const SIGNAL_TYPE =
    Object.freeze({

        RAPID_FUND_MOVEMENT:
            'RAPID_FUND_MOVEMENT',

        HIGH_VELOCITY:
            'HIGH_VELOCITY',

        FAN_IN:
            'FAN_IN',

        FAN_OUT:
            'FAN_OUT',

        CIRCULAR_MOVEMENT:
            'CIRCULAR_MOVEMENT',

        SHARED_COUNTERPARTY:
            'SHARED_COUNTERPARTY',

        HIGH_CONCENTRATION:
            'HIGH_CONCENTRATION',

        COORDINATED_ACTIVITY:
            'COORDINATED_ACTIVITY',

        SHARED_DEVICE:
            'SHARED_DEVICE',

        SHARED_CHANNEL:
            'SHARED_CHANNEL',

        SHARED_REFERENCE:
            'SHARED_REFERENCE',

        NETWORK_CLUSTER:
            'NETWORK_CLUSTER',

        RAPID_FAN_OUT:
            'RAPID_FAN_OUT',

        RAPID_FAN_IN:
            'RAPID_FAN_IN'
    });

const TRANSACTION_DIRECTION =
    Object.freeze({

        CREDIT:
            'CREDIT',

        DEBIT:
            'DEBIT',

        IN:
            'IN',

        OUT:
            'OUT',

        UNKNOWN:
            'UNKNOWN'
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class CrossAccountAnalyzerError extends Error {

    constructor(
        message,
        code = 'CROSS_ACCOUNT_ANALYZER_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'CrossAccountAnalyzerError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            CrossAccountAnalyzerError
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

function now() {

    return new Date()
        .toISOString();
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
            Number(
                value
            ) || 0
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
            (
                Number(value) ||
                0
            ) *
            multiplier
        ) /
        multiplier
    );
}

function normalizeId(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }

    return String(
        value
    ).trim();
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

    return String(
        value
    )
        .trim();
}

function hashValue(
    value
) {

    return crypto
        .createHash(
            'sha256'
        )
        .update(
            String(
                value
            )
        )
        .digest(
            'hex'
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

function toTimestamp(
    value
) {

    if (
        value instanceof Date
    ) {

        return value.getTime();
    }

    const timestamp =
        Date.parse(
            value
        );

    return Number.isFinite(
        timestamp
    )
        ? timestamp
        : null;
}

function minutesBetween(
    first,
    second
) {

    const a =
        toTimestamp(
            first
        );

    const b =
        toTimestamp(
            second
        );

    if (
        a === null ||
        b === null
    ) {

        return null;
    }

    return Math.abs(
        b - a
    ) /
    60000;
}

function unique(
    values
) {

    return [
        ...new Set(
            values.filter(
                value =>
                    value !== undefined &&
                    value !== null &&
                    value !== ''
            )
        )
    ];
}

/**
 * ============================================================================
 * CrossAccountAnalyzer
 * ============================================================================
 */

class CrossAccountAnalyzer {

    constructor(
        options = {}
    ) {

        this.config = {

            ...DEFAULT_CONFIG,

            ...(options.config || {}),

            riskScoreWeights: {

                ...DEFAULT_CONFIG.riskScoreWeights,

                ...(
                    options.config?.riskScoreWeights ||
                    {}
                )
            },

            riskBands: {

                ...DEFAULT_CONFIG.riskBands,

                ...(
                    options.config?.riskBands ||
                    {}
                )
            }
        };

        this.logger =
            options.logger ||
            null;

        this.auditLogger =
            options.auditLogger ||
            null;

        this.metrics =
            options.metrics ||
            null;

        this.initialized =
            true;

        this.instanceId =
            crypto
                .randomBytes(
                    12
                )
                .toString(
                    'hex'
                );
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

            // Logging must never break fraud analysis.
        }
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    analyze(
        input = {},
        options = {}
    ) {

        const startedAt =
            Date.now();

        const context =
            this.validateAndNormalizeInput(
                input
            );

        const graph =
            this.buildRelationshipGraph(
                context.transactions,
                context
            );

        const signals =
            [];

        signals.push(
            ...this.detectVelocity(
                context,
                graph
            )
        );

        signals.push(
            ...this.detectFanIn(
                context,
                graph
            )
        );

        signals.push(
            ...this.detectFanOut(
                context,
                graph
            )
        );

        if (
            this.config.enableCircularDetection
        ) {

            signals.push(
                ...this.detectCircularMovement(
                    context,
                    graph
                )
            );
        }

        signals.push(
            ...this.detectConcentration(
                context,
                graph
            )
        );

        signals.push(
            ...this.detectSharedCounterparties(
                context,
                graph
            )
        );

        if (
            this.config.enableCoordinationDetection
        ) {

            signals.push(
                ...this.detectCoordination(
                    context,
                    graph
                )
            );
        }

        if (
            this.config.enableDeviceSignals
        ) {

            signals.push(
                ...this.detectSharedAttribute(
                    context,
                    graph,
                    'deviceId',
                    SIGNAL_TYPE.SHARED_DEVICE
                )
            );
        }

        if (
            this.config.enableChannelSignals
        ) {

            signals.push(
                ...this.detectSharedAttribute(
                    context,
                    graph,
                    'channel',
                    SIGNAL_TYPE.SHARED_CHANNEL
                )
            );
        }

        if (
            this.config.enableReferenceSignals
        ) {

            signals.push(
                ...this.detectSharedAttribute(
                    context,
                    graph,
                    'reference',
                    SIGNAL_TYPE.SHARED_REFERENCE
                )
            );
        }

        signals.push(
            ...this.detectNetworkClusters(
                context,
                graph
            )
        );

        const deduplicatedSignals =
            this.deduplicateSignals(
                signals
            );

        const accountRisk =
            this.calculateAccountRisk(
                context,
                graph,
                deduplicatedSignals
            );

        const networkRisk =
            this.calculateNetworkRisk(
                context,
                graph,
                deduplicatedSignals
            );

        const duration =
            Date.now() -
            startedAt;

        const result = {

            analysisId:
                crypto.randomUUID(),

            analysisVersion:
                ANALYSIS_VERSION,

            module:
                MODULE_NAME,

            moduleVersion:
                MODULE_VERSION,

            tenantId:
                context.tenantId,

            generatedAt:
                now(),

            durationMs:
                duration,

            summary: {

                accountCount:
                    graph.accounts.size,

                transactionCount:
                    context.transactions.length,

                relationshipCount:
                    graph.relationships.length,

                signalCount:
                    deduplicatedSignals.length,

                suspiciousAccountCount:
                    accountRisk.filter(
                        account =>
                            account.riskScore >=
                            this.config.suspiciousRiskThreshold
                    ).length,

                criticalAccountCount:
                    accountRisk.filter(
                        account =>
                            account.riskScore >=
                            this.config.criticalRiskThreshold
                    ).length
            },

            network: {

                score:
                    networkRisk.score,

                band:
                    networkRisk.band,

                density:
                    networkRisk.density,

                components:
                    networkRisk.components,

                indicators:
                    networkRisk.indicators
            },

            accounts:
                accountRisk,

            relationships:
                this.serializeRelationships(
                    graph.relationships
                ),

            signals:
                deduplicatedSignals,

            limitations:
                context.limitations,

            governance: {

                analysisOnly:
                    true,

                financialMutationPerformed:
                    false,

                accountActionPerformed:
                    false,

                fraudDetermination:
                    false,

                requiresInvestigation:
                    deduplicatedSignals.length > 0
            }
        };

        this.recordAudit(
            'CROSS_ACCOUNT_ANALYSIS_COMPLETED',
            {

                analysisId:
                    result.analysisId,

                tenantId:
                    result.tenantId,

                accountCount:
                    result.summary.accountCount,

                transactionCount:
                    result.summary.transactionCount,

                signalCount:
                    result.summary.signalCount,

                networkRisk:
                    result.network.score,

                durationMs:
                    duration
            },
            options.actor
        );

        this.recordMetric(
            'cross_account_analysis',
            result
        );

        return result;
    }

    /**
     * =========================================================================
     * Input Validation / Normalization
     * =========================================================================
     */

    validateAndNormalizeInput(
        input
    ) {

        if (
            !isObject(
                input
            )
        ) {

            throw new CrossAccountAnalyzerError(
                'Analysis input must be an object.',
                'INVALID_ANALYSIS_INPUT'
            );
        }

        const tenantId =
            normalizeId(
                input.tenantId ||
                input.tenant?.id
            );

        if (
            !tenantId
        ) {

            throw new CrossAccountAnalyzerError(
                'tenantId is required for cross-account analysis.',
                'TENANT_ID_REQUIRED'
            );
        }

        const transactions =
            isArray(
                input.transactions
            )
                ? input.transactions
                : [];

        if (
            transactions.length >
            this.config.maxTransactions
        ) {

            throw new CrossAccountAnalyzerError(
                'Transaction dataset exceeds configured analysis limit.',
                'TRANSACTION_LIMIT_EXCEEDED',
                {

                    maximum:
                        this.config.maxTransactions,

                    received:
                        transactions.length
                }
            );
        }

        const normalizedTransactions =
            transactions
                .map(
                    transaction =>
                        this.normalizeTransaction(
                            transaction
                        )
                )
                .filter(
                    Boolean
                );

        const accountSeed =
            isArray(
                input.accounts
            )
                ? input.accounts
                : [];

        const accounts =
            new Map();

        for (
            const account
            of accountSeed
        ) {

            const normalized =
                this.normalizeAccount(
                    account
                );

            if (
                normalized
            ) {

                accounts.set(
                    normalized.id,
                    normalized
                );
            }
        }

        for (
            const transaction
            of normalizedTransactions
        ) {

            if (
                transaction.sourceAccountId
            ) {

                if (
                    !accounts.has(
                        transaction.sourceAccountId
                    )
                ) {

                    accounts.set(
                        transaction.sourceAccountId,
                        this.createImplicitAccount(
                            transaction.sourceAccountId
                        )
                    );
                }
            }

            if (
                transaction.destinationAccountId
            ) {

                if (
                    !accounts.has(
                        transaction.destinationAccountId
                    )
                ) {

                    accounts.set(
                        transaction.destinationAccountId,
                        this.createImplicitAccount(
                            transaction.destinationAccountId
                        )
                    );
                }
            }
        }

        if (
            accounts.size >
            this.config.maxAccounts
        ) {

            throw new CrossAccountAnalyzerError(
                'Account dataset exceeds configured analysis limit.',
                'ACCOUNT_LIMIT_EXCEEDED'
            );
        }

        return {

            tenantId,

            transactions:
                normalizedTransactions,

            accounts,

            baseline:
                input.baseline ||
                {},

            metadata:
                input.metadata ||
                {},

            limitations:
                this.collectLimitations(
                    input
                )
        };
    }

    /**
     * =========================================================================
     * Transaction Normalization
     * =========================================================================
     */

    normalizeTransaction(
        transaction
    ) {

        if (
            !isObject(
                transaction
            )
        ) {

            return null;
        }

        const sourceAccountId =
            normalizeId(
                transaction.sourceAccountId ||
                transaction.fromAccountId ||
                transaction.debitAccountId ||
                transaction.senderAccountId
            );

        const destinationAccountId =
            normalizeId(
                transaction.destinationAccountId ||
                transaction.toAccountId ||
                transaction.creditAccountId ||
                transaction.receiverAccountId
            );

        if (
            !sourceAccountId &&
            !destinationAccountId
        ) {

            return null;
        }

        const amount =
            Math.abs(
                safeNumber(
                    transaction.amount
                )
            );

        if (
            amount <
            this.config.minimumTransactionAmount
        ) {

            return null;
        }

        const timestamp =
            transaction.timestamp ||
            transaction.transactionDate ||
            transaction.createdAt ||
            transaction.date;

        return {

            id:
                normalizeId(
                    transaction.id ||
                    transaction.transactionId
                ) ||
                crypto.randomUUID(),

            sourceAccountId,

            destinationAccountId,

            amount,

            currency:
                normalizeString(
                    transaction.currency
                ),

            timestamp,

            direction:
                this.normalizeDirection(
                    transaction,
                    sourceAccountId,
                    destinationAccountId
                ),

            counterpartyId:
                normalizeId(
                    transaction.counterpartyId
                ),

            merchantId:
                normalizeId(
                    transaction.merchantId
                ),

            provider:
                normalizeString(
                    transaction.provider
                ),

            channel:
                normalizeString(
                    transaction.channel
                ),

            deviceId:
                normalizeId(
                    transaction.deviceId
                ),

            reference:
                this.normalizeReference(
                    transaction.reference
                ),

            status:
                normalizeString(
                    transaction.status
                ),

            metadata:
                isObject(
                    transaction.metadata
                )
                    ? transaction.metadata
                    : {}
        };
    }

    normalizeDirection(
        transaction,
        sourceAccountId,
        destinationAccountId
    ) {

        const explicit =
            normalizeString(
                transaction.direction
            );

        if (
            explicit
        ) {

            const normalized =
                explicit.toUpperCase();

            if (
                Object.values(
                    TRANSACTION_DIRECTION
                ).includes(
                    normalized
                )
            ) {

                return normalized;
            }
        }

        if (
            sourceAccountId &&
            destinationAccountId
        ) {

            return TRANSACTION_DIRECTION.OUT;
        }

        return TRANSACTION_DIRECTION.UNKNOWN;
    }

    normalizeReference(
        reference
    ) {

        if (
            !reference
        ) {

            return null;
        }

        const normalized =
            String(
                reference
            )
                .trim()
                .toUpperCase();

        if (
            !normalized
        ) {

            return null;
        }

        return this.config.preserveRawReferences
            ? normalized
            : hashValue(
                normalized
            );
    }

    /**
     * =========================================================================
     * Account Normalization
     * =========================================================================
     */

    normalizeAccount(
        account
    ) {

        if (
            !isObject(
                account
            )
        ) {

            return null;
        }

        const id =
            normalizeId(
                account.id ||
                account.accountId
            );

        if (
            !id
        ) {

            return null;
        }

        return {

            id,

            type:
                normalizeString(
                    account.type
                ),

            status:
                normalizeString(
                    account.status
                ),

            branchId:
                normalizeId(
                    account.branchId
                ),

            customerId:
                normalizeId(
                    account.customerId
                ),

            tenantId:
                normalizeId(
                    account.tenantId
                ),

            metadata:
                isObject(
                    account.metadata
                )
                    ? account.metadata
                    : {}
        };
    }

    createImplicitAccount(
        id
    ) {

        return {

            id,

            type:
                'UNKNOWN',

            status:
                'UNKNOWN',

            branchId:
                null,

            customerId:
                null,

            tenantId:
                null,

            metadata:
                {}
        };
    }

    /**
     * =========================================================================
     * Relationship Graph
     * =========================================================================
     */

    buildRelationshipGraph(
        transactions,
        context
    ) {

        const accounts =
            new Map(
                context.accounts
            );

        const relationships =
            [];

        const adjacency =
            new Map();

        const inbound =
            new Map();

        const outbound =
            new Map();

        const transactionByAccount =
            new Map();

        const ensureAccount =
            accountId => {

                if (
                    !accountId
                ) {

                    return;
                }

                if (
                    !accounts.has(
                        accountId
                    )
                ) {

                    accounts.set(
                        accountId,
                        this.createImplicitAccount(
                            accountId
                        )
                    );
                }

                if (
                    !adjacency.has(
                        accountId
                    )
                ) {

                    adjacency.set(
                        accountId,
                        new Set()
                    );
                }

                if (
                    !inbound.has(
                        accountId
                    )
                ) {

                    inbound.set(
                        accountId,
                        []
                    );
                }

                if (
                    !outbound.has(
                        accountId
                    )
                ) {

                    outbound.set(
                        accountId,
                        []
                    );
                }

                if (
                    !transactionByAccount.has(
                        accountId
                    )
                ) {

                    transactionByAccount.set(
                        accountId,
                        []
                    );
                }
            };

        for (
            const transaction
            of transactions
        ) {

            ensureAccount(
                transaction.sourceAccountId
            );

            ensureAccount(
                transaction.destinationAccountId
            );

            if (
                transaction.sourceAccountId
            ) {

                outbound
                    .get(
                        transaction.sourceAccountId
                    )
                    .push(
                        transaction
                    );

                transactionByAccount
                    .get(
                        transaction.sourceAccountId
                    )
                    .push(
                        transaction
                    );
            }

            if (
                transaction.destinationAccountId
            ) {

                inbound
                    .get(
                        transaction.destinationAccountId
                    )
                    .push(
                        transaction
                    );

                transactionByAccount
                    .get(
                        transaction.destinationAccountId
                    )
                    .push(
                        transaction
                    );
            }

            if (
                transaction.sourceAccountId &&
                transaction.destinationAccountId &&
                transaction.sourceAccountId !==
                transaction.destinationAccountId
            ) {

                adjacency
                    .get(
                        transaction.sourceAccountId
                    )
                    .add(
                        transaction.destinationAccountId
                    );

                adjacency
                    .get(
                        transaction.destinationAccountId
                    )
                    .add(
                        transaction.sourceAccountId
                    );

                relationships.push(
                    this.createRelationship(
                        transaction
                    )
                );
            }
        }

        return {

            accounts,

            relationships,

            adjacency,

            inbound,

            outbound,

            transactionByAccount
        };
    }

    createRelationship(
        transaction
    ) {

        return {

            id:
                hashValue(
                    [
                        transaction.sourceAccountId,
                        transaction.destinationAccountId,
                        transaction.currency,
                        transaction.id
                    ].join('|')
                ).slice(
                    0,
                    32
                ),

            sourceAccountId:
                transaction.sourceAccountId,

            destinationAccountId:
                transaction.destinationAccountId,

            amount:
                transaction.amount,

            currency:
                transaction.currency,

            timestamp:
                transaction.timestamp,

            transactionId:
                transaction.id,

            channel:
                transaction.channel
        };
    }

    /**
     * =========================================================================
     * Velocity Detection
     * =========================================================================
     */

    detectVelocity(
        context,
        graph
    ) {

        const signals =
            [];

        for (
            const [
                accountId,
                transactions
            ]
            of graph.transactionByAccount
        ) {

            const sorted =
                [...transactions]
                    .filter(
                        transaction =>
                            transaction.timestamp
                    )
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            toTimestamp(
                                a.timestamp
                            ) -
                            toTimestamp(
                                b.timestamp
                            )
                    );

            if (
                sorted.length <
                2
            ) {

                continue;
            }

            let maximumCount =
                0;

            let maximumAmount =
                0;

            let windowStart =
                0;

            for (
                let windowEnd = 0;
                windowEnd < sorted.length;
                windowEnd++
            ) {

                while (
                    windowStart <
                    windowEnd &&
                    minutesBetween(
                        sorted[
                            windowStart
                        ].timestamp,
                        sorted[
                            windowEnd
                        ].timestamp
                    ) >
                    this.config.velocityWindowMinutes
                ) {

                    windowStart++;
                }

                const window =
                    sorted.slice(
                        windowStart,
                        windowEnd + 1
                    );

                const count =
                    window.length;

                const amount =
                    window.reduce(
                        (
                            total,
                            transaction
                        ) =>
                            total +
                            transaction.amount,
                        0
                    );

                if (
                    count >
                    maximumCount
                ) {

                    maximumCount =
                        count;
                }

                if (
                    amount >
                    maximumAmount
                ) {

                    maximumAmount =
                        amount;
                }
            }

            if (
                maximumCount >=
                this.config.fanOutThreshold
            ) {

                signals.push(
                    this.createSignal(
                        SIGNAL_TYPE.HIGH_VELOCITY,
                        accountId,
                        null,
                        clamp(
                            maximumCount /
                            (
                                this.config.fanOutThreshold *
                                2
                            )
                        ),
                        {

                            transactionCount:
                                maximumCount,

                            transactionAmount:
                                round(
                                    maximumAmount
                                ),

                            windowMinutes:
                                this.config.velocityWindowMinutes
                        }
                    )
                );
            }
        }

        return signals;
    }

    /**
     * =========================================================================
     * Fan-In Detection
     * =========================================================================
     */

    detectFanIn(
        context,
        graph
    ) {

        const signals =
            [];

        for (
            const [
                accountId,
                transactions
            ]
            of graph.inbound
        ) {

            const uniqueSources =
                unique(
                    transactions
                        .map(
                            transaction =>
                                transaction.sourceAccountId
                        )
                )
                .filter(
                    source =>
                        source &&
                        source !== accountId
                );

            if (
                uniqueSources.length >=
                this.config.fanInThreshold
            ) {

                const amount =
                    transactions.reduce(
                        (
                            total,
                            transaction
                        ) =>
                            total +
                            transaction.amount,
                        0
                    );

                signals.push(
                    this.createSignal(
                        SIGNAL_TYPE.FAN_IN,
                        accountId,
                        null,
                        clamp(
                            uniqueSources.length /
                            (
                                this.config.fanInThreshold *
                                2
                            )
                        ),
                        {

                            uniqueSourceAccounts:
                                uniqueSources.length,

                            totalAmount:
                                round(
                                    amount
                                ),

                            sourceAccounts:
                                uniqueSources
                        }
                    )
                );
            }
        }

        return signals;
    }

    /**
     * =========================================================================
     * Fan-Out Detection
     * =========================================================================
     */

    detectFanOut(
        context,
        graph
    ) {

        const signals =
            [];

        for (
            const [
                accountId,
                transactions
            ]
            of graph.outbound
        ) {

            const uniqueDestinations =
                unique(
                    transactions
                        .map(
                            transaction =>
                                transaction.destinationAccountId
                        )
                )
                .filter(
                    destination =>
                        destination &&
                        destination !== accountId
                );

            if (
                uniqueDestinations.length >=
                this.config.fanOutThreshold
            ) {

                const amount =
                    transactions.reduce(
                        (
                            total,
                            transaction
                        ) =>
                            total +
                            transaction.amount,
                        0
                    );

                signals.push(
                    this.createSignal(
                        SIGNAL_TYPE.FAN_OUT,
                        accountId,
                        null,
                        clamp(
                            uniqueDestinations.length /
                            (
                                this.config.fanOutThreshold *
                                2
                            )
                        ),
                        {

                            uniqueDestinationAccounts:
                                uniqueDestinations.length,

                            totalAmount:
                                round(
                                    amount
                                ),

                            destinationAccounts:
                                uniqueDestinations
                        }
                    )
                );
            }
        }

        return signals;
    }

    /**
     * =========================================================================
     * Circular Movement Detection
     * =========================================================================
     */

    detectCircularMovement(
        context,
        graph
    ) {

        const signals =
            [];

        const visitedCycles =
            new Set();

        for (
            const accountId
            of graph.accounts.keys()
        ) {

            const cycles =
                this.findCycles(
                    accountId,
                    graph,
                    this.config.maxCycleLength
                );

            for (
                const cycle
                of cycles
            ) {

                const canonical =
                    this.canonicalizeCycle(
                        cycle
                    );

                if (
                    visitedCycles.has(
                        canonical
                    )
                ) {

                    continue;
                }

                visitedCycles.add(
                    canonical
                );

                const cycleTransactions =
                    this.getCycleTransactions(
                        cycle,
                        graph
                    );

                if (
                    cycleTransactions.length <
                    this.config.circularPathThreshold
                ) {

                    continue;
                }

                const totalAmount =
                    cycleTransactions.reduce(
                        (
                            total,
                            transaction
                        ) =>
                            total +
                            transaction.amount,
                        0
                    );

                const rapid =
                    this.isRapidCycle(
                        cycleTransactions
                    );

                const score =
                    clamp(
                        (
                            cycle.length /
                            this.config.maxCycleLength
                        ) *
                        (
                            rapid
                                ? 1.25
                                : 1
                        )
                    );

                signals.push(
                    this.createSignal(
                        SIGNAL_TYPE.CIRCULAR_MOVEMENT,
                        cycle[0],
                        null,
                        score,
                        {

                            cycle,

                            cycleLength:
                                cycle.length,

                            transactionCount:
                                cycleTransactions.length,

                            totalAmount:
                                round(
                                    totalAmount
                                ),

                            rapidMovement:
                                rapid
                        }
                    )
                );
            }
        }

        return signals;
    }

    findCycles(
        startAccount,
        graph,
        maxDepth
    ) {

        const cycles =
            [];

        const path =
            [
                startAccount
            ];

        const visited =
            new Set(
                path
            );

        const dfs =
            current => {

                if (
                    path.length >
                    maxDepth
                ) {

                    return;
                }

                const neighbors =
                    graph.adjacency.get(
                        current
                    ) ||
                    new Set();

                for (
                    const next
                    of neighbors
                ) {

                    if (
                        next ===
                        startAccount &&
                        path.length >=
                        3
                    ) {

                        cycles.push(
                            [
                                ...path
                            ]
                        );

                        continue;
                    }

                    if (
                        visited.has(
                            next
                        )
                    ) {

                        continue;
                    }

                    visited.add(
                        next
                    );

                    path.push(
                        next
                    );

                    dfs(
                        next
                    );

                    path.pop();

                    visited.delete(
                        next
                    );
                }
            };

        dfs(
            startAccount
        );

        return cycles;
    }

    canonicalizeCycle(
        cycle
    ) {

        const rotations =
            [];

        for (
            let index = 0;
            index < cycle.length;
            index++
        ) {

            rotations.push(
                [
                    ...cycle.slice(
                        index
                    ),
                    ...cycle.slice(
                        0,
                        index
                    )
                ].join(
                    '>'
                )
            );
        }

        const reversed =
            [
                ...cycle
            ].reverse();

        for (
            let index = 0;
            index < reversed.length;
            index++
        ) {

            rotations.push(
                [
                    ...reversed.slice(
                        index
                    ),
                    ...reversed.slice(
                        0,
                        index
                    )
                ].join(
                    '>'
                )
            );
        }

        return rotations.sort()[0];
    }

    getCycleTransactions(
        cycle,
        graph
    ) {

        const transactions =
            [];

        for (
            let index = 0;
            index < cycle.length;
            index++
        ) {

            const source =
                cycle[index];

            const destination =
                cycle[
                    (
                        index + 1
                    ) %
                    cycle.length
                ];

            const candidates =
                graph.outbound.get(
                    source
                ) ||
                [];

            for (
                const transaction
                of candidates
            ) {

                if (
                    transaction.destinationAccountId ===
                    destination
                ) {

                    transactions.push(
                        transaction
                    );
                }
            }
        }

        return transactions;
    }

    isRapidCycle(
        transactions
    ) {

        if (
            transactions.length <
            2
        ) {

            return false;
        }

        const timestamps =
            transactions
                .map(
                    transaction =>
                        toTimestamp(
                            transaction.timestamp
                        )
                )
                .filter(
                    timestamp =>
                        timestamp !== null
                )
                .sort(
                    (
                        a,
                        b
                    ) =>
                        a - b
                );

        if (
            timestamps.length <
            2
        ) {

            return false;
        }

        const durationMinutes =
            (
                timestamps[
                    timestamps.length - 1
                ] -
                timestamps[0]
            ) /
            60000;

        return (
            durationMinutes <=
            this.config.rapidMovementWindowMinutes
        );
    }

    /**
     * =========================================================================
     * Concentration Detection
     * =========================================================================
     */

    detectConcentration(
        context,
        graph
    ) {

        const signals =
            [];

        for (
            const [
                accountId,
                transactions
            ]
            of graph.outbound
        ) {

            if (
                transactions.length ===
                0
            ) {

                continue;
            }

            const totals =
                new Map();

            let totalAmount =
                0;

            for (
                const transaction
                of transactions
            ) {

                const destination =
                    transaction.destinationAccountId;

                if (
                    !destination
                ) {

                    continue;
                }

                const amount =
                    transaction.amount;

                totalAmount +=
                    amount;

                totals.set(
                    destination,
                    (
                        totals.get(
                            destination
                        ) ||
                        0
                    ) +
                    amount
                );
            }

            if (
                totalAmount <=
                0
            ) {

                continue;
            }

            for (
                const [
                    destination,
                    amount
                ]
                of totals
            ) {

                const share =
                    amount /
                    totalAmount;

                if (
                    share >=
                    this.config.concentrationThreshold
                ) {

                    signals.push(
                        this.createSignal(
                            SIGNAL_TYPE.HIGH_CONCENTRATION,
                            accountId,
                            destination,
                            clamp(
                                share
                            ),
                            {

                                amount:
                                    round(
                                        amount
                                    ),

                                totalOutboundAmount:
                                    round(
                                        totalAmount
                                    ),

                                concentration:
                                    round(
                                        share
                                    )
                            }
                        )
                    );
                }
            }
        }

        return signals;
    }

    /**
     * =========================================================================
     * Shared Counterparty Detection
     * =========================================================================
     */

    detectSharedCounterparties(
        context,
        graph
    ) {

        const signals =
            [];

        const counterpartyAccounts =
            new Map();

        for (
            const transaction
            of context.transactions
        ) {

            if (
                !transaction.counterpartyId
            ) {

                continue;
            }

            const accountIds =
                counterpartyAccounts.get(
                    transaction.counterpartyId
                ) ||
                new Set();

            if (
                transaction.sourceAccountId
            ) {

                accountIds.add(
                    transaction.sourceAccountId
                );
            }

            if (
                transaction.destinationAccountId
            ) {

                accountIds.add(
                    transaction.destinationAccountId
                );
            }

            counterpartyAccounts.set(
                transaction.counterpartyId,
                accountIds
            );
        }

        for (
            const [
                counterpartyId,
                accountIds
            ]
            of counterpartyAccounts
        ) {

            if (
                accountIds.size <
                this.config.sharedCounterpartyThreshold
            ) {

                continue;
            }

            const accounts =
                [
                    ...accountIds
                ];

            for (
                let index = 0;
                index < accounts.length;
                index++
            ) {

                for (
                    let second = index + 1;
                    second < accounts.length;
                    second++
                ) {

                    signals.push(
                        this.createSignal(
                            SIGNAL_TYPE.SHARED_COUNTERPARTY,
                            accounts[index],
                            accounts[second],
                            clamp(
                                accountIds.size /
                                (
                                    this.config.sharedCounterpartyThreshold *
                                    2
                                )
                            ),
                            {

                                counterpartyId:
                                    this.config.preserveRawReferences
                                        ? counterpartyId
                                        : hashValue(
                                            counterpartyId
                                        ),

                                relatedAccountCount:
                                    accountIds.size
                            }
                        )
                    );
                }
            }
        }

        return signals;
    }

    /**
     * =========================================================================
     * Coordination Detection
     * =========================================================================
     */

    detectCoordination(
        context,
        graph
    ) {

        const signals =
            [];

        const attributeMaps = {

            deviceId:
                new Map(),

            channel:
                new Map(),

            reference:
                new Map()
        };

        for (
            const transaction
            of context.transactions
        ) {

            for (
                const attribute
                of Object.keys(
                    attributeMaps
                )
            ) {

                const value =
                    transaction[
                        attribute
                    ];

                if (
                    !value
                ) {

                    continue;
                }

                const accounts =
                    attributeMaps[
                        attribute
                    ].get(
                        value
                    ) ||
                    new Set();

                if (
                    transaction.sourceAccountId
                ) {

                    accounts.add(
                        transaction.sourceAccountId
                    );
                }

                if (
                    transaction.destinationAccountId
                ) {

                    accounts.add(
                        transaction.destinationAccountId
                    );
                }

                attributeMaps[
                    attribute
                ].set(
                    value,
                    accounts
                );
            }
        }

        const combinations =
            new Map();

        for (
            const [
                attribute,
                valueMap
            ]
            of Object.entries(
                attributeMaps
            )
        ) {

            for (
                const [
                    value,
                    accounts
                ]
                of valueMap
            ) {

                if (
                    accounts.size <
                    2
                ) {

                    continue;
                }

                const key =
                    [
                        ...accounts
                    ]
                        .sort()
                        .join('|');

                const current =
                    combinations.get(
                        key
                    ) ||
                    {

                        accounts:
                            [
                                ...accounts
                            ],

                        attributes:
                            new Set(),

                        values:
                            new Map()
                    };

                current.attributes.add(
                    attribute
                );

                current.values.set(
                    attribute,
                    value
                );

                combinations.set(
                    key,
                    current
                );
            }
        }

        for (
            const combination
            of combinations.values()
        ) {

            if (
                combination.attributes.size <
                2
            ) {

                continue;
            }

            const score =
                clamp(
                    combination.attributes.size /
                    4
                );

            signals.push(
                this.createSignal(
                    SIGNAL_TYPE.COORDINATED_ACTIVITY,
                    combination.accounts[0],
                    combination.accounts[1],
                    score,
                    {

                        accounts:
                            combination.accounts,

                        sharedAttributes:
                            [
                                ...combination.attributes
                            ],

                        attributeCount:
                            combination.attributes.size
                    }
                )
            );
        }

        return signals;
    }

    /**
     * =========================================================================
     * Shared Attribute Detection
     * =========================================================================
     */

    detectSharedAttribute(
        context,
        graph,
        attribute,
        signalType
    ) {

        const signals =
            [];

        const map =
            new Map();

        for (
            const transaction
            of context.transactions
        ) {

            const value =
                transaction[
                    attribute
                ];

            if (
                !value
            ) {

                continue;
            }

            const accounts =
                map.get(
                    value
                ) ||
                new Set();

            if (
                transaction.sourceAccountId
            ) {

                accounts.add(
                    transaction.sourceAccountId
                );
            }

            if (
                transaction.destinationAccountId
            ) {

                accounts.add(
                    transaction.destinationAccountId
                );
            }

            map.set(
                value,
                accounts
            );
        }

        for (
            const [
                value,
                accounts
            ]
            of map
        ) {

            if (
                accounts.size <
                2
            ) {

                continue;
            }

            const accountList =
                [
                    ...accounts
                ];

            for (
                let index = 0;
                index < accountList.length;
                index++
            ) {

                for (
                    let second = index + 1;
                    second < accountList.length;
                    second++
                ) {

                    signals.push(
                        this.createSignal(
                            signalType,
                            accountList[index],
                            accountList[second],
                            clamp(
                                accounts.size /
                                (
                                    this.config.fanInThreshold *
                                    2
                                )
                            ),
                            {

                                attribute,

                                relatedAccountCount:
                                    accounts.size,

                                value:
                                    this.config.preserveRawReferences
                                        ? value
                                        : hashValue(
                                            value
                                        )
                            }
                        )
                    );
                }
            }
        }

        return signals;
    }

    /**
     * =========================================================================
     * Network Cluster Detection
     * =========================================================================
     */

    detectNetworkClusters(
        context,
        graph
    ) {

        const signals =
            [];

        const components =
            this.findConnectedComponents(
                graph
            );

        for (
            const component
            of components
        ) {

            if (
                component.length <
                3
            ) {

                continue;
            }

            const possibleEdges =
                component.length *
                (
                    component.length - 1
                );

            const actualEdges =
                component.reduce(
                    (
                        total,
                        accountId
                    ) =>
                        total +
                        (
                            graph.adjacency.get(
                                accountId
                            )?.size ||
                            0
                        ),
                    0
                );

            const density =
                possibleEdges > 0
                    ? actualEdges /
                      possibleEdges
                    : 0;

            if (
                density >=
                0.35
            ) {

                signals.push(
                    this.createSignal(
                        SIGNAL_TYPE.NETWORK_CLUSTER,
                        component[0],
                        null,
                        clamp(
                            density
                        ),
                        {

                            accounts:
                                component,

                            accountCount:
                                component.length,

                            density:
                                round(
                                    density
                                )
                        }
                    )
                );
            }
        }

        return signals;
    }

    findConnectedComponents(
        graph
    ) {

        const components =
            [];

        const visited =
            new Set();

        for (
            const accountId
            of graph.accounts.keys()
        ) {

            if (
                visited.has(
                    accountId
                )
            ) {

                continue;
            }

            const component =
                [];

            const queue =
                [
                    accountId
                ];

            visited.add(
                accountId
            );

            while (
                queue.length
            ) {

                const current =
                    queue.shift();

                component.push(
                    current
                );

                const neighbors =
                    graph.adjacency.get(
                        current
                    ) ||
                    new Set();

                for (
                    const neighbor
                    of neighbors
                ) {

                    if (
                        visited.has(
                            neighbor
                        )
                    ) {

                        continue;
                    }

                    visited.add(
                        neighbor
                    );

                    queue.push(
                        neighbor
                    );
                }
            }

            components.push(
                component
            );
        }

        return components;
    }

    /**
     * =========================================================================
     * Signal Creation
     * =========================================================================
     */

    createSignal(
        type,
        accountId,
        relatedAccountId,
        score,
        evidence = {}
    ) {

        return {

            id:
                crypto.randomUUID(),

            type,

            accountId,

            relatedAccountId,

            score:
                round(
                    clamp(
                        score
                    )
                ),

            evidence,

            severity:
                this.scoreToBand(
                    score
                ),

            generatedAt:
                now()
        };
    }

    /**
     * =========================================================================
     * Signal Deduplication
     * =========================================================================
     */

    deduplicateSignals(
        signals
    ) {

        const map =
            new Map();

        for (
            const signal
            of signals
        ) {

            const key =
                [
                    signal.type,
                    signal.accountId,
                    signal.relatedAccountId
                ]
                    .sort()
                    .join('|');

            const existing =
                map.get(
                    key
                );

            if (
                !existing ||
                signal.score >
                existing.score
            ) {

                map.set(
                    key,
                    signal
                );
            }
        }

        return [
            ...map.values()
        ];
    }

    /**
     * =========================================================================
     * Account Risk
     * =========================================================================
     */

    calculateAccountRisk(
        context,
        graph,
        signals
    ) {

        const byAccount =
            new Map();

        for (
            const accountId
            of graph.accounts.keys()
        ) {

            byAccount.set(
                accountId,
                []
            );
        }

        for (
            const signal
            of signals
        ) {

            if (
                byAccount.has(
                    signal.accountId
                )
            ) {

                byAccount
                    .get(
                        signal.accountId
                    )
                    .push(
                        signal
                    );
            }

            if (
                signal.relatedAccountId &&
                byAccount.has(
                    signal.relatedAccountId
                )
            ) {

                byAccount
                    .get(
                        signal.relatedAccountId
                    )
                    .push(
                        signal
                    );
            }

            if (
                Array.isArray(
                    signal.evidence?.accounts
                )
            ) {

                for (
                    const accountId
                    of signal.evidence.accounts
                ) {

                    if (
                        byAccount.has(
                            accountId
                        )
                    ) {

                        byAccount
                            .get(
                                accountId
                            )
                            .push(
                                signal
                            );
                    }
                }
            }
        }

        const results =
            [];

        for (
            const [
                accountId,
                accountSignals
            ]
            of byAccount
        ) {

            const weighted =
                this.calculateWeightedSignalScore(
                    accountSignals
                );

            const riskScore =
                clamp(
                    weighted
                );

            results.push(
                {

                    accountId,

                    riskScore:
                        round(
                            riskScore
                        ),

                    riskBand:
                        this.scoreToBand(
                            riskScore
                        ),

                    signalCount:
                        accountSignals.length,

                    signalTypes:
                        unique(
                            accountSignals.map(
                                signal =>
                                    signal.type
                            )
                        ),

                    signals:
                        accountSignals.map(
                            signal =>
                                signal.id
                        ),

                    requiresInvestigation:
                        riskScore >=
                        this.config.suspiciousRiskThreshold
                }
            );
        }

        return results
            .sort(
                (
                    first,
                    second
                ) =>
                    second.riskScore -
                    first.riskScore
            );
    }

    calculateWeightedSignalScore(
        signals
    ) {

        if (
            signals.length ===
            0
        ) {

            return 0;
        }

        const weightMap =
            {

                [SIGNAL_TYPE.HIGH_VELOCITY]:
                    this.config.riskScoreWeights.velocity,

                [SIGNAL_TYPE.RAPID_FUND_MOVEMENT]:
                    this.config.riskScoreWeights.velocity,

                [SIGNAL_TYPE.FAN_IN]:
                    this.config.riskScoreWeights.fanIn,

                [SIGNAL_TYPE.RAPID_FAN_IN]:
                    this.config.riskScoreWeights.fanIn,

                [SIGNAL_TYPE.FAN_OUT]:
                    this.config.riskScoreWeights.fanOut,

                [SIGNAL_TYPE.RAPID_FAN_OUT]:
                    this.config.riskScoreWeights.fanOut,

                [SIGNAL_TYPE.CIRCULAR_MOVEMENT]:
                    this.config.riskScoreWeights.circular,

                [SIGNAL_TYPE.HIGH_CONCENTRATION]:
                    this.config.riskScoreWeights.concentration,

                [SIGNAL_TYPE.SHARED_COUNTERPARTY]:
                    this.config.riskScoreWeights.sharedCounterparty,

                [SIGNAL_TYPE.COORDINATED_ACTIVITY]:
                    this.config.riskScoreWeights.coordination,

                [SIGNAL_TYPE.SHARED_DEVICE]:
                    this.config.riskScoreWeights.coordination,

                [SIGNAL_TYPE.SHARED_CHANNEL]:
                    this.config.riskScoreWeights.coordination,

                [SIGNAL_TYPE.SHARED_REFERENCE]:
                    this.config.riskScoreWeights.coordination,

                [SIGNAL_TYPE.NETWORK_CLUSTER]:
                    this.config.riskScoreWeights.networkDensity
            };

        let numerator =
            0;

        let denominator =
            0;

        for (
            const signal
            of signals
        ) {

            const weight =
                weightMap[
                    signal.type
                ] ||
                0.05;

            numerator +=
                signal.score *
                weight;

            denominator +=
                weight;
        }

        if (
            denominator <=
            0
        ) {

            return 0;
        }

        return clamp(
            numerator /
            denominator
        );
    }

    /**
     * =========================================================================
     * Network Risk
     * =========================================================================
     */

    calculateNetworkRisk(
        context,
        graph,
        signals
    ) {

        const components =
            this.findConnectedComponents(
                graph
            );

        const possibleEdges =
            graph.accounts.size *
            Math.max(
                graph.accounts.size - 1,
                0
            );

        const actualEdges =
            graph.relationships.length;

        const density =
            possibleEdges > 0
                ? actualEdges /
                  possibleEdges
                : 0;

        const signalScores =
            signals.map(
                signal =>
                    signal.score
            );

        const averageSignalScore =
            signalScores.length
                ? signalScores.reduce(
                    (
                        total,
                        score
                    ) =>
                        total +
                        score,
                    0
                ) /
                  signalScores.length
                : 0;

        const score =
            clamp(
                (
                    averageSignalScore *
                    0.70
                ) +
                (
                    clamp(
                        density /
                        0.50
                    ) *
                    0.30
                )
            );

        return {

            score:
                round(
                    score
                ),

            band:
                this.scoreToBand(
                    score
                ),

            density:
                round(
                    density
                ),

            components:
                components
                    .map(
                        component => ({
                            accountCount:
                                component.length,

                            accounts:
                                component
                        })
                    )
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            b.accountCount -
                            a.accountCount
                    ),

            indicators:
                unique(
                    signals.map(
                        signal =>
                            signal.type
                    )
                )
        };
    }

    /**
     * =========================================================================
     * Risk Band
     * =========================================================================
     */

    scoreToBand(
        score
    ) {

        const normalized =
            clamp(
                score
            );

        if (
            normalized >=
            this.config.riskBands.HIGH
        ) {

            if (
                normalized >=
                this.config.criticalRiskThreshold
            ) {

                return RISK_BAND.CRITICAL;
            }

            return RISK_BAND.HIGH;
        }

        if (
            normalized >=
            this.config.riskBands.MEDIUM
        ) {

            return RISK_BAND.MEDIUM;
        }

        return RISK_BAND.LOW;
    }

    /**
     * =========================================================================
     * Relationship Serialization
     * =========================================================================
     */

    serializeRelationships(
        relationships
    ) {

        if (
            relationships.length <=
            this.config.maxRelationships
        ) {

            return relationships;
        }

        return relationships.slice(
            0,
            this.config.maxRelationships
        );
    }

    /**
     * =========================================================================
     * Limitations
     * =========================================================================
     */

    collectLimitations(
        input
    ) {

        const limitations =
            [];

        if (
            !input.accounts
        ) {

            limitations.push(
                'Account metadata was not supplied; implicit accounts were inferred from transactions.'
            );
        }

        if (
            !input.baseline
        ) {

            limitations.push(
                'No historical baseline was supplied; anomaly interpretation is cross-sectional.'
            );
        }

        const transactions =
            input.transactions ||
            [];

        const missingTimestamps =
            transactions.filter(
                transaction =>
                    !(
                        transaction.timestamp ||
                        transaction.transactionDate ||
                        transaction.createdAt ||
                        transaction.date
                    )
            ).length;

        if (
            missingTimestamps > 0
        ) {

            limitations.push(
                `${missingTimestamps} transactions lacked usable timestamps.`
            );
        }

        return limitations;
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    recordMetric(
        name,
        result
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
                    name,
                    {

                        signalCount:
                            result.summary.signalCount,

                        suspiciousAccountCount:
                            result.summary.suspiciousAccountCount
                    }
                );
            }

        } catch (
            error
        ) {

            this.log(
                'warn',
                'Cross-account metrics recording failed.',
                {

                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    recordAudit(
        event,
        data = {},
        actor = {}
    ) {

        const record = {

            id:
                crypto.randomUUID(),

            timestamp:
                now(),

            event,

            module:
                MODULE_NAME,

            moduleVersion:
                MODULE_VERSION,

            actor: {

                id:
                    actor.id ||
                    actor.userId ||
                    actor.serviceId ||
                    'system',

                type:
                    actor.type ||
                    'SYSTEM'
            },

            data
        };

        if (
            this.auditLogger &&
            typeof this.auditLogger.record ===
            'function'
        ) {

            try {

                this.auditLogger.record(
                    record
                );

            } catch (
                error
            ) {

                this.log(
                    'warn',
                    'Cross-account audit logging failed.',
                    {

                        error:
                            error.message
                    }
                );
            }
        }

        return record;
    }

    /**
     * =========================================================================
     * Targeted Account Analysis
     * =========================================================================
     */

    analyzeAccount(
        accountId,
        input = {},
        options = {}
    ) {

        const result =
            this.analyze(
                input,
                options
            );

        const normalizedId =
            normalizeId(
                accountId
            );

        return {

            ...result,

            accounts:
                result.accounts.filter(
                    account =>
                        account.accountId ===
                        normalizedId
                ),

            relationships:
                result.relationships.filter(
                    relationship =>
                        relationship.sourceAccountId ===
                            normalizedId ||
                        relationship.destinationAccountId ===
                            normalizedId
                ),

            signals:
                result.signals.filter(
                    signal =>
                        signal.accountId ===
                            normalizedId ||
                        signal.relatedAccountId ===
                            normalizedId ||
                        signal.evidence?.accounts?.includes(
                            normalizedId
                        )
                )
        };
    }

    /**
     * =========================================================================
     * Compare Accounts
     * =========================================================================
     */

    compareAccounts(
        firstAccountId,
        secondAccountId,
        input = {},
        options = {}
    ) {

        const result =
            this.analyze(
                input,
                options
            );

        const first =
            result.accounts.find(
                account =>
                    account.accountId ===
                    normalizeId(
                        firstAccountId
                    )
            );

        const second =
            result.accounts.find(
                account =>
                    account.accountId ===
                    normalizeId(
                        secondAccountId
                    )
            );

        const relationshipSignals =
            result.signals.filter(
                signal => {

                    const firstMatch =
                        signal.accountId ===
                            firstAccountId &&
                        signal.relatedAccountId ===
                            secondAccountId;

                    const secondMatch =
                        signal.accountId ===
                            secondAccountId &&
                        signal.relatedAccountId ===
                            firstAccountId;

                    return (
                        firstMatch ||
                        secondMatch
                    );
                }
            );

        return {

            firstAccount:
                first ||
                null,

            secondAccount:
                second ||
                null,

            relationshipSignals,

            related:
                relationshipSignals.length >
                0
        };
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    healthCheck() {

        return {

            healthy:
                this.initialized,

            ready:
                this.initialized,

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION,

            analysisVersion:
                ANALYSIS_VERSION,

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

            analysisVersion:
                ANALYSIS_VERSION,

            capabilities: [

                'cross-account-analysis',

                'relationship-graph-analysis',

                'fan-in-detection',

                'fan-out-detection',

                'velocity-analysis',

                'circular-flow-detection',

                'concentration-analysis',

                'shared-counterparty-analysis',

                'coordination-analysis',

                'shared-device-analysis',

                'shared-channel-analysis',

                'shared-reference-analysis',

                'network-clustering',

                'account-risk-scoring',

                'network-risk-scoring',

                'explainable-risk-signals',

                'tenant-isolation',

                'audit-hooks',

                'metrics-hooks',

                'analysis-only-governance'
            ],

            governance: {

                modifiesFinancialData:
                    false,

                modifiesAccounts:
                    false,

                executesRepairs:
                    false,

                declaresFraud:
                    false,

                blocksTransactions:
                    false
            }
        };
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createCrossAccountAnalyzer(
    options = {}
) {

    return new CrossAccountAnalyzer(
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

    ANALYSIS_VERSION,

    DEFAULT_CONFIG,

    RISK_BAND,

    SIGNAL_TYPE,

    TRANSACTION_DIRECTION,

    CrossAccountAnalyzer,

    CrossAccountAnalyzerError,

    createCrossAccountAnalyzer
};