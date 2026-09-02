'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * FraudCorrelation
 * ============================================================================
 *
 * Enterprise-grade domain model for correlating financial fraud signals,
 * anomalies, transactions, accounts, statements, repairs, settlements,
 * customers, branches, devices, channels and related entities.
 *
 * Location:
 *   backend/modules/finance/statements/models/FraudCorrelation.js
 *
 * Responsibilities
 * ---------------
 * - Represent a normalized fraud correlation result
 * - Preserve explainable fraud evidence
 * - Aggregate multiple fraud signals
 * - Track correlated entities and relationships
 * - Maintain confidence / risk / severity scores
 * - Support investigation workflows
 * - Support tenant-aware financial intelligence
 * - Provide deterministic integrity fingerprints
 * - Support persistence without coupling to MongoDB/Mongoose
 * - Provide safe serialization for APIs/events/audit records
 *
 * Non-responsibilities
 * --------------------
 * This model does NOT:
 * - authorize users
 * - persist itself
 * - execute fraud detection algorithms
 * - send alerts
 * - mutate ledger entries
 * - freeze accounts
 * - make irreversible financial decisions
 *
 * Those responsibilities belong to application services.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODEL_NAME = 'FraudCorrelation';

const SCHEMA_VERSION = '1.0.0';

const STATUS = Object.freeze({
    DETECTED: 'DETECTED',
    ANALYZING: 'ANALYZING',
    CORRELATED: 'CORRELATED',
    REVIEW_REQUIRED: 'REVIEW_REQUIRED',
    CONFIRMED: 'CONFIRMED',
    FALSE_POSITIVE: 'FALSE_POSITIVE',
    DISMISSED: 'DISMISSED',
    RESOLVED: 'RESOLVED',
    ESCALATED: 'ESCALATED',
    FAILED: 'FAILED'
});

const RISK_LEVEL = Object.freeze({
    UNKNOWN: 'UNKNOWN',
    LOW: 'LOW',
    MODERATE: 'MODERATE',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
});

const SEVERITY = Object.freeze({
    INFO: 'INFO',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
});

const CORRELATION_TYPE = Object.freeze({
    TRANSACTION: 'TRANSACTION',
    ACCOUNT: 'ACCOUNT',
    CUSTOMER: 'CUSTOMER',
    STATEMENT: 'STATEMENT',
    REPAIR: 'REPAIR',
    SETTLEMENT: 'SETTLEMENT',
    JOURNAL: 'JOURNAL',
    LEDGER: 'LEDGER',
    BRANCH: 'BRANCH',
    DEVICE: 'DEVICE',
    CHANNEL: 'CHANNEL',
    BENEFICIARY: 'BENEFICIARY',
    PAYMENT_PROVIDER: 'PAYMENT_PROVIDER',
    CROSS_ACCOUNT: 'CROSS_ACCOUNT',
    TEMPORAL: 'TEMPORAL',
    BEHAVIORAL: 'BEHAVIORAL',
    NETWORK: 'NETWORK',
    COMPOSITE: 'COMPOSITE'
});

const SIGNAL_TYPE = Object.freeze({
    DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
    UNUSUAL_AMOUNT: 'UNUSUAL_AMOUNT',
    UNUSUAL_FREQUENCY: 'UNUSUAL_FREQUENCY',
    VELOCITY_ANOMALY: 'VELOCITY_ANOMALY',
    RAPID_REVERSAL: 'RAPID_REVERSAL',
    ROUND_AMOUNT: 'ROUND_AMOUNT',
    STRUCTURING: 'STRUCTURING',
    CROSS_ACCOUNT_TRANSFER: 'CROSS_ACCOUNT_TRANSFER',
    SUSPICIOUS_REPAIR: 'SUSPICIOUS_REPAIR',
    SETTLEMENT_MISMATCH: 'SETTLEMENT_MISMATCH',
    LEDGER_VARIANCE: 'LEDGER_VARIANCE',
    STATEMENT_VARIANCE: 'STATEMENT_VARIANCE',
    SEQUENTIAL_ACTIVITY: 'SEQUENTIAL_ACTIVITY',
    TEMPORAL_ANOMALY: 'TEMPORAL_ANOMALY',
    DEVICE_ANOMALY: 'DEVICE_ANOMALY',
    CHANNEL_ANOMALY: 'CHANNEL_ANOMALY',
    BENEFICIARY_ANOMALY: 'BENEFICIARY_ANOMALY',
    IP_ANOMALY: 'IP_ANOMALY',
    LOCATION_ANOMALY: 'LOCATION_ANOMALY',
    PATTERN_MATCH: 'PATTERN_MATCH',
    MANUAL_FLAG: 'MANUAL_FLAG',
    OTHER: 'OTHER'
});

const ENTITY_TYPE = Object.freeze({
    TENANT: 'TENANT',
    ORGANIZATION: 'ORGANIZATION',
    CUSTOMER: 'CUSTOMER',
    MEMBER: 'MEMBER',
    ACCOUNT: 'ACCOUNT',
    TRANSACTION: 'TRANSACTION',
    STATEMENT: 'STATEMENT',
    STATEMENT_LINE: 'STATEMENT_LINE',
    REPAIR: 'REPAIR',
    SETTLEMENT: 'SETTLEMENT',
    JOURNAL: 'JOURNAL',
    JOURNAL_ENTRY: 'JOURNAL_ENTRY',
    LEDGER_ENTRY: 'LEDGER_ENTRY',
    BRANCH: 'BRANCH',
    DEVICE: 'DEVICE',
    IP_ADDRESS: 'IP_ADDRESS',
    USER: 'USER',
    EMPLOYEE: 'EMPLOYEE',
    BENEFICIARY: 'BENEFICIARY',
    PAYMENT: 'PAYMENT',
    PAYMENT_PROVIDER: 'PAYMENT_PROVIDER',
    CHANNEL: 'CHANNEL',
    OTHER: 'OTHER'
});

const RELATIONSHIP_TYPE = Object.freeze({
    SAME_ACCOUNT: 'SAME_ACCOUNT',
    SAME_CUSTOMER: 'SAME_CUSTOMER',
    SAME_DEVICE: 'SAME_DEVICE',
    SAME_IP: 'SAME_IP',
    SAME_BENEFICIARY: 'SAME_BENEFICIARY',
    SAME_COUNTERPARTY: 'SAME_COUNTERPARTY',
    SAME_BRANCH: 'SAME_BRANCH',
    SAME_PROVIDER: 'SAME_PROVIDER',
    SAME_CHANNEL: 'SAME_CHANNEL',
    TEMPORAL_PROXIMITY: 'TEMPORAL_PROXIMITY',
    AMOUNT_SIMILARITY: 'AMOUNT_SIMILARITY',
    SEQUENTIAL: 'SEQUENTIAL',
    REVERSAL: 'REVERSAL',
    DUPLICATE: 'DUPLICATE',
    NETWORK_LINK: 'NETWORK_LINK',
    OTHER: 'OTHER'
});

const INVESTIGATION_STATUS = Object.freeze({
    NOT_STARTED: 'NOT_STARTED',
    OPEN: 'OPEN',
    IN_PROGRESS: 'IN_PROGRESS',
    ESCALATED: 'ESCALATED',
    PENDING_REVIEW: 'PENDING_REVIEW',
    RESOLVED: 'RESOLVED',
    CLOSED: 'CLOSED'
});

const DECISION = Object.freeze({
    NONE: 'NONE',
    MONITOR: 'MONITOR',
    REVIEW: 'REVIEW',
    ESCALATE: 'ESCALATE',
    BLOCK: 'BLOCK',
    FREEZE: 'FREEZE',
    CONFIRM: 'CONFIRM',
    DISMISS: 'DISMISS'
});

const SCORE_BAND = Object.freeze({
    MIN: 0,
    MAX: 100
});

const DEFAULTS = Object.freeze({
    maximumSignals: 200,
    maximumEntities: 200,
    maximumRelationships: 200,
    maximumEvidence: 200,
    maximumRecommendations: 100,
    maximumTags: 50,
    maximumHistory: 100
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function clone(value) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (Array.isArray(value)) {
        return value.map(clone);
    }

    if (isObject(value)) {
        const result = {};

        for (const key of Object.keys(value)) {
            result[key] = clone(value[key]);
        }

        return result;
    }

    return value;
}

function normalizeString(value, fallback = null) {
    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized.length > 0
        ? normalized
        : fallback;
}

function normalizeEnum(
    value,
    allowed,
    fallback
) {
    const normalized =
        normalizeString(value);

    if (!normalized) {
        return fallback;
    }

    const upper =
        normalized.toUpperCase();

    return allowed.includes(upper)
        ? upper
        : fallback;
}

function toNumber(
    value,
    fallback = null
) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return fallback;
    }

    const numeric =
        Number(value);

    return Number.isFinite(numeric)
        ? numeric
        : fallback;
}

function clamp(
    value,
    minimum,
    maximum
) {
    const numeric =
        toNumber(value, minimum);

    return Math.min(
        maximum,
        Math.max(
            minimum,
            numeric
        )
    );
}

function round(
    value,
    decimals = 4
) {
    const numeric =
        toNumber(value, 0);

    const factor =
        10 ** decimals;

    return Math.round(
        numeric * factor
    ) / factor;
}

function normalizeDate(
    value,
    fallback = null
) {
    if (!value) {
        return fallback;
    }

    if (value instanceof Date) {
        return Number.isNaN(
            value.getTime()
        )
            ? fallback
            : new Date(value.getTime());
    }

    const date =
        new Date(value);

    return Number.isNaN(
        date.getTime()
    )
        ? fallback
        : date;
}

function normalizeArray(
    value,
    maximum = Infinity
) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .slice(0, maximum)
        .map(clone);
}

function uniqueStrings(
    values,
    maximum = Infinity
) {
    if (!Array.isArray(values)) {
        return [];
    }

    const result = [];
    const seen = new Set();

    for (const value of values) {
        const normalized =
            normalizeString(value);

        if (!normalized) {
            continue;
        }

        const key =
            normalized.toLowerCase();

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(normalized);

        if (result.length >= maximum) {
            break;
        }
    }

    return result;
}

function firstNumber(...values) {
    for (const value of values) {
        const numeric =
            toNumber(value);

        if (numeric !== null) {
            return numeric;
        }
    }

    return null;
}

function stableSerialize(value) {
    if (value === null) {
        return 'null';
    }

    if (value === undefined) {
        return 'undefined';
    }

    if (value instanceof Date) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (Array.isArray(value)) {
        return `[${value
            .map(stableSerialize)
            .join(',')}]`;
    }

    if (isObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map(key => (
                `${JSON.stringify(key)}:${stableSerialize(value[key])}`
            ))
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(stableSerialize(value))
        .digest('hex');
}

function now() {
    return new Date();
}

/**
 * ============================================================================
 * FraudCorrelation
 * ============================================================================
 */

class FraudCorrelation {

    /**
     * @param {Object} data
     */
    constructor(data = {}) {

        if (!isObject(data)) {
            throw new TypeError(
                'FraudCorrelation data must be an object.'
            );
        }

        this._initialize(data);
    }

    /**
     * =========================================================================
     * Initialization
     * =========================================================================
     */

    _initialize(data) {

        const source =
            clone(data);

        this.model =
            MODEL_NAME;

        this.schemaVersion =
            normalizeString(
                source.schemaVersion,
                SCHEMA_VERSION
            );

        /**
         * Identity.
         */
        this.id =
            normalizeString(
                source.id ||
                source._id ||
                source.correlationId
            );

        this.correlationId =
            this.id ||
            normalizeString(
                source.correlationId
            );

        /**
         * Tenant boundary.
         */
        this.tenantId =
            normalizeString(
                source.tenantId
            );

        this.organizationId =
            normalizeString(
                source.organizationId
            );

        this.groupId =
            normalizeString(
                source.groupId
            );

        this.branchId =
            normalizeString(
                source.branchId
            );

        /**
         * Correlation classification.
         */
        this.correlationType =
            normalizeEnum(
                source.correlationType ||
                source.type,
                Object.values(
                    CORRELATION_TYPE
                ),
                CORRELATION_TYPE.COMPOSITE
            );

        this.status =
            normalizeEnum(
                source.status,
                Object.values(STATUS),
                STATUS.DETECTED
            );

        this.riskLevel =
            normalizeEnum(
                source.riskLevel ||
                source.risk,
                Object.values(RISK_LEVEL),
                RISK_LEVEL.UNKNOWN
            );

        this.severity =
            normalizeEnum(
                source.severity,
                Object.values(SEVERITY),
                SEVERITY.INFO
            );

        this.decision =
            normalizeEnum(
                source.decision ||
                source.recommendedDecision,
                Object.values(DECISION),
                DECISION.NONE
            );

        /**
         * Scores.
         */
        this.riskScore =
            clamp(
                firstNumber(
                    source.riskScore,
                    source.score
                ),
                SCORE_BAND.MIN,
                SCORE_BAND.MAX
            );

        this.confidenceScore =
            clamp(
                firstNumber(
                    source.confidenceScore,
                    source.confidence
                ),
                0,
                1
            );

        this.anomalyScore =
            clamp(
                firstNumber(
                    source.anomalyScore
                ),
                SCORE_BAND.MIN,
                SCORE_BAND.MAX
            );

        this.patternScore =
            clamp(
                firstNumber(
                    source.patternScore
                ),
                SCORE_BAND.MIN,
                SCORE_BAND.MAX
            );

        this.behavioralScore =
            clamp(
                firstNumber(
                    source.behavioralScore
                ),
                SCORE_BAND.MIN,
                SCORE_BAND.MAX
            );

        this.networkScore =
            clamp(
                firstNumber(
                    source.networkScore
                ),
                SCORE_BAND.MIN,
                SCORE_BAND.MAX
            );

        this.temporalScore =
            clamp(
                firstNumber(
                    source.temporalScore
                ),
                SCORE_BAND.MIN,
                SCORE_BAND.MAX
            );

        /**
         * Primary financial references.
         */
        this.customerId =
            normalizeString(
                source.customerId ||
                source.memberId
            );

        this.accountId =
            normalizeString(
                source.accountId
            );

        this.transactionId =
            normalizeString(
                source.transactionId
            );

        this.statementId =
            normalizeString(
                source.statementId
            );

        this.statementLineId =
            normalizeString(
                source.statementLineId
            );

        this.repairId =
            normalizeString(
                source.repairId
            );

        this.settlementId =
            normalizeString(
                source.settlementId
            );

        this.journalId =
            normalizeString(
                source.journalId
            );

        this.ledgerEntryId =
            normalizeString(
                source.ledgerEntryId
            );

        this.paymentId =
            normalizeString(
                source.paymentId
            );

        this.paymentProvider =
            normalizeString(
                source.paymentProvider
            );

        this.channel =
            normalizeString(
                source.channel
            );

        this.deviceId =
            normalizeString(
                source.deviceId
            );

        /**
         * Amount context.
         */
        this.amount =
            toNumber(
                source.amount
            );

        this.currency =
            normalizeString(
                source.currency
            );

        this.relatedAmount =
            toNumber(
                source.relatedAmount
            );

        this.amountVariance =
            toNumber(
                source.amountVariance
            );

        this.amountVariancePercent =
            toNumber(
                source.amountVariancePercent
            );

        /**
         * Correlated objects.
         */
        this.signals =
            this._normalizeSignals(
                source.signals ||
                source.fraudSignals
            );

        this.entities =
            this._normalizeEntities(
                source.entities ||
                source.relatedEntities
            );

        this.relationships =
            this._normalizeRelationships(
                source.relationships
            );

        this.evidence =
            this._normalizeEvidence(
                source.evidence
            );

        /**
         * Explainability.
         */
        this.patterns =
            normalizeArray(
                source.patterns,
                DEFAULTS.maximumSignals
            );

        this.reasons =
            uniqueStrings(
                source.reasons ||
                source.explanations,
                DEFAULTS.maximumEvidence
            );

        this.recommendations =
            normalizeArray(
                source.recommendations,
                DEFAULTS.maximumRecommendations
            );

        this.tags =
            uniqueStrings(
                source.tags,
                DEFAULTS.maximumTags
            );

        /**
         * Investigation state.
         */
        this.investigation =
            this._normalizeInvestigation(
                source.investigation
            );

        /**
         * Historical state transitions.
         */
        this.history =
            normalizeArray(
                source.history,
                DEFAULTS.maximumHistory
            );

        /**
         * Detection / correlation metadata.
         */
        this.detection =
            this._normalizeDetection(
                source.detection
            );

        this.provenance =
            this._normalizeProvenance(
                source.provenance
            );

        /**
         * Period.
         */
        this.period =
            this._normalizePeriod(
                source.period
            );

        /**
         * Lifecycle.
         */
        this.createdAt =
            normalizeDate(
                source.createdAt
            ) || now();

        this.updatedAt =
            normalizeDate(
                source.updatedAt
            ) || new Date(
                this.createdAt.getTime()
            );

        this.detectedAt =
            normalizeDate(
                source.detectedAt
            ) || new Date(
                this.createdAt.getTime()
            );

        this.correlatedAt =
            normalizeDate(
                source.correlatedAt
            );

        this.resolvedAt =
            normalizeDate(
                source.resolvedAt
            );

        this.expiresAt =
            normalizeDate(
                source.expiresAt
            );

        /**
         * Observability.
         */
        this.requestId =
            normalizeString(
                source.requestId
            );

        this.traceId =
            normalizeString(
                source.traceId
            );

        this.createdBy =
            normalizeString(
                source.createdBy
            );

        this.updatedBy =
            normalizeString(
                source.updatedBy
            );

        /**
         * Extensible metadata.
         */
        this.metadata =
            isObject(source.metadata)
                ? clone(source.metadata)
                : {};

        /**
         * Integrity fingerprint.
         */
        this.fingerprint =
            normalizeString(
                source.fingerprint
            ) ||
            this.generateFingerprint();
    }

    /**
     * =========================================================================
     * Nested Normalization
     * =========================================================================
     */

    _normalizeSignals(
        signals
    ) {

        if (!Array.isArray(signals)) {
            return [];
        }

        return signals
            .slice(
                0,
                DEFAULTS.maximumSignals
            )
            .map(signal => {

                if (!isObject(signal)) {
                    return {
                        type: SIGNAL_TYPE.OTHER,
                        score: 0,
                        confidence: 0,
                        description:
                            normalizeString(
                                signal
                            )
                    };
                }

                return {
                    id:
                        normalizeString(
                            signal.id ||
                            signal.signalId
                        ),

                    type:
                        normalizeEnum(
                            signal.type ||
                            signal.signalType,
                            Object.values(
                                SIGNAL_TYPE
                            ),
                            SIGNAL_TYPE.OTHER
                        ),

                    score:
                        clamp(
                            toNumber(
                                signal.score,
                                0
                            ),
                            0,
                            100
                        ),

                    confidence:
                        clamp(
                            toNumber(
                                signal.confidence,
                                0
                            ),
                            0,
                            1
                        ),

                    severity:
                        normalizeEnum(
                            signal.severity,
                            Object.values(
                                SEVERITY
                            ),
                            SEVERITY.INFO
                        ),

                    description:
                        normalizeString(
                            signal.description ||
                            signal.reason
                        ),

                    source:
                        normalizeString(
                            signal.source
                        ),

                    detector:
                        normalizeString(
                            signal.detector
                        ),

                    entityId:
                        normalizeString(
                            signal.entityId
                        ),

                    entityType:
                        normalizeEnum(
                            signal.entityType,
                            Object.values(
                                ENTITY_TYPE
                            ),
                            ENTITY_TYPE.OTHER
                        ),

                    detectedAt:
                        normalizeDate(
                            signal.detectedAt
                        ),

                    metadata:
                        isObject(
                            signal.metadata
                        )
                            ? clone(
                                signal.metadata
                            )
                            : {}
                };
            });
    }

    _normalizeEntities(
        entities
    ) {

        if (!Array.isArray(entities)) {
            return [];
        }

        return entities
            .slice(
                0,
                DEFAULTS.maximumEntities
            )
            .map(entity => {

                if (!isObject(entity)) {
                    return {
                        id:
                            normalizeString(
                                entity
                            ),
                        type:
                            ENTITY_TYPE.OTHER,
                        role: null
                    };
                }

                return {
                    id:
                        normalizeString(
                            entity.id ||
                            entity.entityId
                        ),

                    type:
                        normalizeEnum(
                            entity.type ||
                            entity.entityType,
                            Object.values(
                                ENTITY_TYPE
                            ),
                            ENTITY_TYPE.OTHER
                        ),

                    role:
                        normalizeString(
                            entity.role
                        ),

                    score:
                        clamp(
                            toNumber(
                                entity.score,
                                0
                            ),
                            0,
                            100
                        ),

                    primary:
                        Boolean(
                            entity.primary
                        ),

                    metadata:
                        isObject(
                            entity.metadata
                        )
                            ? clone(
                                entity.metadata
                            )
                            : {}
                };
            });
    }

    _normalizeRelationships(
        relationships
    ) {

        if (!Array.isArray(relationships)) {
            return [];
        }

        return relationships
            .slice(
                0,
                DEFAULTS.maximumRelationships
            )
            .map(relationship => {

                if (!isObject(relationship)) {
                    return {
                        type:
                            RELATIONSHIP_TYPE.OTHER,
                        confidence: 0
                    };
                }

                return {
                    id:
                        normalizeString(
                            relationship.id ||
                            relationship.relationshipId
                        ),

                    type:
                        normalizeEnum(
                            relationship.type ||
                            relationship.relationshipType,
                            Object.values(
                                RELATIONSHIP_TYPE
                            ),
                            RELATIONSHIP_TYPE.OTHER
                        ),

                    fromEntityId:
                        normalizeString(
                            relationship.fromEntityId
                        ),

                    toEntityId:
                        normalizeString(
                            relationship.toEntityId
                        ),

                    confidence:
                        clamp(
                            toNumber(
                                relationship.confidence,
                                0
                            ),
                            0,
                            1
                        ),

                    strength:
                        clamp(
                            toNumber(
                                relationship.strength,
                                0
                            ),
                            0,
                            100
                        ),

                    description:
                        normalizeString(
                            relationship.description
                        ),

                    metadata:
                        isObject(
                            relationship.metadata
                        )
                            ? clone(
                                relationship.metadata
                            )
                            : {}
                };
            });
    }

    _normalizeEvidence(
        evidence
    ) {

        if (!Array.isArray(evidence)) {
            return [];
        }

        return evidence
            .slice(
                0,
                DEFAULTS.maximumEvidence
            )
            .map(item => {

                if (!isObject(item)) {
                    return {
                        type: 'OTHER',
                        value:
                            normalizeString(
                                item
                            ),
                        weight: 1
                    };
                }

                return {
                    id:
                        normalizeString(
                            item.id ||
                            item.evidenceId
                        ),

                    type:
                        normalizeString(
                            item.type
                        ) || 'OTHER',

                    source:
                        normalizeString(
                            item.source
                        ),

                    description:
                        normalizeString(
                            item.description
                        ),

                    value:
                        clone(
                            item.value
                        ),

                    weight:
                        clamp(
                            toNumber(
                                item.weight,
                                1
                            ),
                            0,
                            100
                        ),

                    confidence:
                        clamp(
                            toNumber(
                                item.confidence,
                                0
                            ),
                            0,
                            1
                        ),

                    observedAt:
                        normalizeDate(
                            item.observedAt
                        ),

                    metadata:
                        isObject(
                            item.metadata
                        )
                            ? clone(
                                item.metadata
                            )
                            : {}
                };
            });
    }

    _normalizeInvestigation(
        investigation
    ) {

        const source =
            isObject(investigation)
                ? investigation
                : {};

        return {
            status:
                normalizeEnum(
                    source.status,
                    Object.values(
                        INVESTIGATION_STATUS
                    ),
                    INVESTIGATION_STATUS.NOT_STARTED
                ),

            caseId:
                normalizeString(
                    source.caseId
                ),

            assignedTo:
                normalizeString(
                    source.assignedTo
                ),

            assignedTeam:
                normalizeString(
                    source.assignedTeam
                ),

            priority:
                normalizeEnum(
                    source.priority,
                    Object.values(
                        SEVERITY
                    ),
                    SEVERITY.INFO
                ),

            openedAt:
                normalizeDate(
                    source.openedAt
                ),

            lastReviewedAt:
                normalizeDate(
                    source.lastReviewedAt
                ),

            closedAt:
                normalizeDate(
                    source.closedAt
                ),

            resolution:
                normalizeString(
                    source.resolution
                ),

            notes:
                uniqueStrings(
                    source.notes,
                    DEFAULTS.maximumEvidence
                )
        };
    }

    _normalizeDetection(
        detection
    ) {

        const source =
            isObject(detection)
                ? detection
                : {};

        return {
            engine:
                normalizeString(
                    source.engine
                ),

            engineVersion:
                normalizeString(
                    source.engineVersion
                ),

            detectorVersion:
                normalizeString(
                    source.detectorVersion
                ),

            modelVersion:
                normalizeString(
                    source.modelVersion
                ),

            ruleVersion:
                normalizeString(
                    source.ruleVersion
                ),

            method:
                normalizeString(
                    source.method
                ),

            executionTimeMs:
                toNumber(
                    source.executionTimeMs
                ),

            signalCount:
                toNumber(
                    source.signalCount
                ),

            entityCount:
                toNumber(
                    source.entityCount
                )
        };
    }

    _normalizeProvenance(
        provenance
    ) {

        const source =
            isObject(provenance)
                ? provenance
                : {};

        return {
            source:
                normalizeString(
                    source.source
                ),

            sourceSystem:
                normalizeString(
                    source.sourceSystem
                ),

            sourceEventId:
                normalizeString(
                    source.sourceEventId
                ),

            sourceRecordId:
                normalizeString(
                    source.sourceRecordId
                ),

            modelVersion:
                normalizeString(
                    source.modelVersion
                ),

            generatedBy:
                normalizeString(
                    source.generatedBy
                )
        };
    }

    _normalizePeriod(
        period
    ) {

        const source =
            isObject(period)
                ? period
                : {};

        return {
            start:
                normalizeDate(
                    source.start
                ),

            end:
                normalizeDate(
                    source.end
                ),

            timezone:
                normalizeString(
                    source.timezone
                ),

            fiscalYear:
                toNumber(
                    source.fiscalYear
                ),

            fiscalPeriod:
                normalizeString(
                    source.fiscalPeriod
                )
        };
    }

    /**
     * =========================================================================
     * Correlation Operations
     * =========================================================================
     */

    addSignal(signal) {

        if (
            this.signals.length >=
            DEFAULTS.maximumSignals
        ) {
            return false;
        }

        const normalized =
            this._normalizeSignals([
                signal
            ])[0];

        if (!normalized) {
            return false;
        }

        this.signals.push(
            normalized
        );

        this.updatedAt = now();

        this.refreshFingerprint();

        return true;
    }

    addEntity(entity) {

        if (
            this.entities.length >=
            DEFAULTS.maximumEntities
        ) {
            return false;
        }

        const normalized =
            this._normalizeEntities([
                entity
            ])[0];

        if (!normalized) {
            return false;
        }

        this.entities.push(
            normalized
        );

        this.updatedAt = now();

        this.refreshFingerprint();

        return true;
    }

    addRelationship(
        relationship
    ) {

        if (
            this.relationships.length >=
            DEFAULTS.maximumRelationships
        ) {
            return false;
        }

        const normalized =
            this._normalizeRelationships([
                relationship
            ])[0];

        if (!normalized) {
            return false;
        }

        this.relationships.push(
            normalized
        );

        this.updatedAt = now();

        this.refreshFingerprint();

        return true;
    }

    addEvidence(evidence) {

        if (
            this.evidence.length >=
            DEFAULTS.maximumEvidence
        ) {
            return false;
        }

        const normalized =
            this._normalizeEvidence([
                evidence
            ])[0];

        if (!normalized) {
            return false;
        }

        this.evidence.push(
            normalized
        );

        this.updatedAt = now();

        this.refreshFingerprint();

        return true;
    }

    addReason(reason) {

        const normalized =
            normalizeString(reason);

        if (!normalized) {
            return false;
        }

        if (
            this.reasons.some(
                existing =>
                    existing.toLowerCase() ===
                    normalized.toLowerCase()
            )
        ) {
            return false;
        }

        if (
            this.reasons.length >=
            DEFAULTS.maximumEvidence
        ) {
            return false;
        }

        this.reasons.push(
            normalized
        );

        this.updatedAt = now();

        this.refreshFingerprint();

        return true;
    }

    /**
     * =========================================================================
     * Score Aggregation
     * =========================================================================
     */

    calculateRiskScore() {

        const signalScore =
            this._averageSignalScore();

        const evidenceScore =
            this._averageEvidenceScore();

        const relationshipScore =
            this._averageRelationshipStrength();

        const explicitScores = [
            this.anomalyScore,
            this.patternScore,
            this.behavioralScore,
            this.networkScore,
            this.temporalScore
        ].filter(
            value =>
                value !== null &&
                Number.isFinite(value)
        );

        const components = [];

        if (explicitScores.length > 0) {
            components.push({
                value:
                    explicitScores.reduce(
                        (sum, value) =>
                            sum + value,
                        0
                    ) /
                    explicitScores.length,
                weight: 0.45
            });
        }

        if (signalScore !== null) {
            components.push({
                value: signalScore,
                weight: 0.30
            });
        }

        if (evidenceScore !== null) {
            components.push({
                value: evidenceScore,
                weight: 0.15
            });
        }

        if (relationshipScore !== null) {
            components.push({
                value: relationshipScore,
                weight: 0.10
            });
        }

        if (components.length === 0) {
            this.riskScore = 0;
        } else {

            const totalWeight =
                components.reduce(
                    (sum, item) =>
                        sum + item.weight,
                    0
                );

            const weighted =
                components.reduce(
                    (sum, item) =>
                        sum +
                        (
                            item.value *
                            item.weight
                        ),
                    0
                );

            this.riskScore =
                round(
                    clamp(
                        weighted /
                        totalWeight,
                        0,
                        100
                    ),
                    2
                );
        }

        this.riskLevel =
            this.classifyRiskLevel();

        this.severity =
            this.classifySeverity();

        this.confidenceScore =
            this.calculateCorrelationConfidence();

        this.updatedAt = now();

        this.refreshFingerprint();

        return this.riskScore;
    }

    _averageSignalScore() {

        const values =
            this.signals
                .map(signal =>
                    toNumber(
                        signal.score
                    )
                )
                .filter(
                    value =>
                        value !== null
                );

        if (values.length === 0) {
            return null;
        }

        return (
            values.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            values.length
        );
    }

    _averageEvidenceScore() {

        const values =
            this.evidence
                .map(evidence => {

                    const weight =
                        toNumber(
                            evidence.weight,
                            0
                        );

                    const confidence =
                        clamp(
                            toNumber(
                                evidence.confidence,
                                0
                            ),
                            0,
                            1
                        );

                    return (
                        weight *
                        confidence
                    );
                });

        if (values.length === 0) {
            return null;
        }

        return (
            values.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            values.length
        );
    }

    _averageRelationshipStrength() {

        const values =
            this.relationships
                .map(
                    relationship =>
                        toNumber(
                            relationship.strength
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        if (values.length === 0) {
            return null;
        }

        return (
            values.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            values.length
        );
    }

    calculateCorrelationConfidence() {

        let confidence = 0;

        const factors = [];

        if (this.signals.length > 0) {
            factors.push(
                Math.min(
                    this.signals.length /
                    5,
                    1
                )
            );
        }

        if (this.entities.length > 1) {
            factors.push(1);
        }

        if (this.relationships.length > 0) {
            factors.push(
                Math.min(
                    this.relationships.length /
                    3,
                    1
                )
            );
        }

        if (this.evidence.length > 0) {
            factors.push(
                Math.min(
                    this.evidence.length /
                    5,
                    1
                )
            );
        }

        if (
            this.detection.engineVersion ||
            this.detection.modelVersion ||
            this.detection.ruleVersion
        ) {
            factors.push(1);
        }

        if (factors.length > 0) {
            confidence =
                factors.reduce(
                    (sum, value) =>
                        sum + value,
                    0
                ) /
                factors.length;
        }

        this.confidenceScore =
            round(
                clamp(
                    confidence,
                    0,
                    1
                ),
                4
            );

        return this.confidenceScore;
    }

    classifyRiskLevel() {

        const score =
            toNumber(
                this.riskScore,
                0
            );

        if (score >= 85) {
            return RISK_LEVEL.CRITICAL;
        }

        if (score >= 65) {
            return RISK_LEVEL.HIGH;
        }

        if (score >= 40) {
            return RISK_LEVEL.MODERATE;
        }

        if (score > 0) {
            return RISK_LEVEL.LOW;
        }

        return RISK_LEVEL.UNKNOWN;
    }

    classifySeverity() {

        switch (this.riskLevel) {

            case RISK_LEVEL.CRITICAL:
                return SEVERITY.CRITICAL;

            case RISK_LEVEL.HIGH:
                return SEVERITY.HIGH;

            case RISK_LEVEL.MODERATE:
                return SEVERITY.MEDIUM;

            case RISK_LEVEL.LOW:
                return SEVERITY.LOW;

            default:
                return SEVERITY.INFO;
        }
    }

    /**
     * =========================================================================
     * Decisioning
     * =========================================================================
     */

    calculateRecommendedDecision() {

        const score =
            toNumber(
                this.riskScore,
                0
            );

        if (
            this.status ===
            STATUS.FALSE_POSITIVE
        ) {
            this.decision =
                DECISION.DISMISS;

            return this.decision;
        }

        if (
            score >= 90
        ) {
            this.decision =
                DECISION.FREEZE;

        } else if (
            score >= 75
        ) {
            this.decision =
                DECISION.BLOCK;

        } else if (
            score >= 60
        ) {
            this.decision =
                DECISION.ESCALATE;

        } else if (
            score >= 35
        ) {
            this.decision =
                DECISION.REVIEW;

        } else if (
            score > 0
        ) {
            this.decision =
                DECISION.MONITOR;

        } else {
            this.decision =
                DECISION.NONE;
        }

        this.updatedAt = now();

        this.refreshFingerprint();

        return this.decision;
    }

    /**
     * =========================================================================
     * Lifecycle
     * =========================================================================
     */

    markCorrelated() {

        this.status =
            STATUS.CORRELATED;

        this.correlatedAt =
            now();

        this.updatedAt =
            new Date(
                this.correlatedAt.getTime()
            );

        this.addHistory(
            STATUS.CORRELATED,
            'Correlation completed.'
        );

        this.refreshFingerprint();

        return this;
    }

    markReviewRequired(
        reason
    ) {

        this.status =
            STATUS.REVIEW_REQUIRED;

        this.investigation.status =
            INVESTIGATION_STATUS.PENDING_REVIEW;

        if (reason) {
            this.addReason(reason);
        }

        this.updatedAt = now();

        this.addHistory(
            STATUS.REVIEW_REQUIRED,
            reason ||
            'Manual review required.'
        );

        this.refreshFingerprint();

        return this;
    }

    confirm(reason) {

        this.status =
            STATUS.CONFIRMED;

        this.investigation.status =
            INVESTIGATION_STATUS.RESOLVED;

        if (reason) {
            this.investigation.resolution =
                normalizeString(reason);
        }

        this.updatedAt = now();

        this.addHistory(
            STATUS.CONFIRMED,
            reason ||
            'Fraud correlation confirmed.'
        );

        this.refreshFingerprint();

        return this;
    }

    markFalsePositive(
        reason
    ) {

        this.status =
            STATUS.FALSE_POSITIVE;

        this.decision =
            DECISION.DISMISS;

        this.investigation.status =
            INVESTIGATION_STATUS.RESOLVED;

        this.investigation.resolution =
            normalizeString(
                reason,
                'False positive.'
            );

        this.updatedAt = now();

        this.addHistory(
            STATUS.FALSE_POSITIVE,
            this.investigation.resolution
        );

        this.refreshFingerprint();

        return this;
    }

    resolve(reason) {

        this.status =
            STATUS.RESOLVED;

        this.investigation.status =
            INVESTIGATION_STATUS.RESOLVED;

        this.resolvedAt =
            now();

        if (reason) {
            this.investigation.resolution =
                normalizeString(reason);
        }

        this.updatedAt =
            new Date(
                this.resolvedAt.getTime()
            );

        this.addHistory(
            STATUS.RESOLVED,
            reason ||
            'Correlation resolved.'
        );

        this.refreshFingerprint();

        return this;
    }

    escalate(reason) {

        this.status =
            STATUS.ESCALATED;

        this.decision =
            DECISION.ESCALATE;

        this.investigation.status =
            INVESTIGATION_STATUS.ESCALATED;

        if (reason) {
            this.addReason(reason);
        }

        this.updatedAt = now();

        this.addHistory(
            STATUS.ESCALATED,
            reason ||
            'Correlation escalated.'
        );

        this.refreshFingerprint();

        return this;
    }

    /**
     * =========================================================================
     * Investigation History
     * =========================================================================
     */

    addHistory(
        status,
        message,
        actor = null
    ) {

        if (
            this.history.length >=
            DEFAULTS.maximumHistory
        ) {
            this.history.shift();
        }

        this.history.push({
            status:
                normalizeEnum(
                    status,
                    Object.values(STATUS),
                    STATUS.DETECTED
                ),

            message:
                normalizeString(
                    message
                ),

            actor:
                normalizeString(
                    actor
                ),

            timestamp:
                now()
        });

        return this;
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validate(
        options = {}
    ) {

        const errors = [];
        const warnings = [];

        const requireTenant =
            options.requireTenant !== false;

        if (
            requireTenant &&
            !this.tenantId
        ) {
            errors.push({
                code:
                    'TENANT_ID_REQUIRED',
                field:
                    'tenantId',
                message:
                    'tenantId is required.'
            });
        }

        if (
            !this.correlationId
        ) {
            warnings.push({
                code:
                    'CORRELATION_ID_MISSING',
                field:
                    'correlationId',
                message:
                    'correlationId is recommended for persisted fraud investigations.'
            });
        }

        if (
            this.entities.length === 0 &&
            this.signals.length === 0
        ) {
            errors.push({
                code:
                    'CORRELATION_CONTEXT_REQUIRED',
                field:
                    'entities',
                message:
                    'At least one signal or correlated entity is required.'
            });
        }

        if (
            this.riskScore !== null &&
            (
                this.riskScore < 0 ||
                this.riskScore > 100
            )
        ) {
            errors.push({
                code:
                    'INVALID_RISK_SCORE',
                field:
                    'riskScore',
                message:
                    'riskScore must be between 0 and 100.'
            });
        }

        if (
            this.confidenceScore !== null &&
            (
                this.confidenceScore < 0 ||
                this.confidenceScore > 1
            )
        ) {
            errors.push({
                code:
                    'INVALID_CONFIDENCE_SCORE',
                field:
                    'confidenceScore',
                message:
                    'confidenceScore must be between 0 and 1.'
            });
        }

        if (
            this.period.start &&
            this.period.end &&
            this.period.start >
                this.period.end
        ) {
            errors.push({
                code:
                    'INVALID_PERIOD',
                field:
                    'period',
                message:
                    'period.start cannot be after period.end.'
            });
        }

        if (
            this.status ===
                STATUS.CONFIRMED &&
            this.investigation.status !==
                INVESTIGATION_STATUS.RESOLVED
        ) {
            warnings.push({
                code:
                    'CONFIRMED_WITH_OPEN_INVESTIGATION',
                message:
                    'Confirmed fraud should normally have a resolved investigation state.'
            });
        }

        if (
            this.riskLevel ===
                RISK_LEVEL.CRITICAL &&
            this.decision ===
                DECISION.NONE
        ) {
            warnings.push({
                code:
                    'CRITICAL_WITHOUT_DECISION',
                message:
                    'Critical correlations should have an explicit operational decision.'
            });
        }

        if (
            this.signals.length === 0
        ) {
            warnings.push({
                code:
                    'NO_SIGNALS',
                message:
                    'No individual fraud signals are attached.'
            });
        }

        return {
            valid:
                errors.length === 0,

            errors,

            warnings
        };
    }

    isValid(
        options = {}
    ) {
        return this.validate(
            options
        ).valid;
    }

    assertValid(
        options = {}
    ) {

        const validation =
            this.validate(
                options
            );

        if (!validation.valid) {

            const error =
                new Error(
                    'Invalid FraudCorrelation.'
                );

            error.code =
                'INVALID_FRAUD_CORRELATION';

            error.details =
                validation.errors;

            throw error;
        }

        return this;
    }

    /**
     * =========================================================================
     * Status / Risk Helpers
     * =========================================================================
     */

    isOpen() {

        return ![
            STATUS.FALSE_POSITIVE,
            STATUS.DISMISSED,
            STATUS.RESOLVED
        ].includes(
            this.status
        );
    }

    isResolved() {

        return [
            STATUS.RESOLVED,
            STATUS.FALSE_POSITIVE,
            STATUS.DISMISSED
        ].includes(
            this.status
        );
    }

    isHighRisk() {

        return [
            RISK_LEVEL.HIGH,
            RISK_LEVEL.CRITICAL
        ].includes(
            this.riskLevel
        );
    }

    isCritical() {

        return (
            this.riskLevel ===
            RISK_LEVEL.CRITICAL
        );
    }

    requiresReview() {

        return (
            this.status ===
                STATUS.REVIEW_REQUIRED ||
            this.isHighRisk()
        );
    }

    /**
     * =========================================================================
     * Expiration
     * =========================================================================
     */

    isExpired(
        referenceDate = new Date()
    ) {

        if (!this.expiresAt) {
            return false;
        }

        const reference =
            normalizeDate(
                referenceDate
            );

        if (!reference) {
            return false;
        }

        return (
            this.expiresAt.getTime() <=
            reference.getTime()
        );
    }

    /**
     * =========================================================================
     * Fingerprint / Integrity
     * =========================================================================
     */

    generateFingerprint() {

        return sha256({
            model:
                MODEL_NAME,

            schemaVersion:
                this.schemaVersion,

            tenantId:
                this.tenantId,

            correlationId:
                this.correlationId,

            correlationType:
                this.correlationType,

            customerId:
                this.customerId,

            accountId:
                this.accountId,

            transactionId:
                this.transactionId,

            statementId:
                this.statementId,

            repairId:
                this.repairId,

            settlementId:
                this.settlementId,

            amount:
                this.amount,

            currency:
                this.currency,

            signals:
                this.signals,

            entities:
                this.entities,

            relationships:
                this.relationships,

            evidence:
                this.evidence,

            riskScore:
                this.riskScore,

            confidenceScore:
                this.confidenceScore,

            anomalyScore:
                this.anomalyScore,

            patternScore:
                this.patternScore,

            behavioralScore:
                this.behavioralScore,

            networkScore:
                this.networkScore,

            temporalScore:
                this.temporalScore,

            status:
                this.status,

            riskLevel:
                this.riskLevel,

            severity:
                this.severity,

            decision:
                this.decision,

            detection:
                this.detection,

            provenance:
                this.provenance,

            period:
                this.period
        });
    }

    verifyFingerprint() {

        if (!this.fingerprint) {
            return false;
        }

        return (
            this.fingerprint ===
            this.generateFingerprint()
        );
    }

    refreshFingerprint() {

        this.fingerprint =
            this.generateFingerprint();

        return this.fingerprint;
    }

    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */

    toObject(
        options = {}
    ) {

        const includeMetadata =
            options.includeMetadata !== false;

        const includeFingerprint =
            options.includeFingerprint !== false;

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            id:
                this.id,

            correlationId:
                this.correlationId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            groupId:
                this.groupId,

            branchId:
                this.branchId,

            correlationType:
                this.correlationType,

            status:
                this.status,

            riskLevel:
                this.riskLevel,

            severity:
                this.severity,

            decision:
                this.decision,

            riskScore:
                this.riskScore,

            confidenceScore:
                this.confidenceScore,

            anomalyScore:
                this.anomalyScore,

            patternScore:
                this.patternScore,

            behavioralScore:
                this.behavioralScore,

            networkScore:
                this.networkScore,

            temporalScore:
                this.temporalScore,

            customerId:
                this.customerId,

            accountId:
                this.accountId,

            transactionId:
                this.transactionId,

            statementId:
                this.statementId,

            statementLineId:
                this.statementLineId,

            repairId:
                this.repairId,

            settlementId:
                this.settlementId,

            journalId:
                this.journalId,

            ledgerEntryId:
                this.ledgerEntryId,

            paymentId:
                this.paymentId,

            paymentProvider:
                this.paymentProvider,

            channel:
                this.channel,

            deviceId:
                this.deviceId,

            amount:
                this.amount,

            currency:
                this.currency,

            relatedAmount:
                this.relatedAmount,

            amountVariance:
                this.amountVariance,

            amountVariancePercent:
                this.amountVariancePercent,

            signals:
                clone(
                    this.signals
                ),

            entities:
                clone(
                    this.entities
                ),

            relationships:
                clone(
                    this.relationships
                ),

            evidence:
                clone(
                    this.evidence
                ),

            patterns:
                clone(
                    this.patterns
                ),

            reasons:
                clone(
                    this.reasons
                ),

            recommendations:
                clone(
                    this.recommendations
                ),

            tags:
                clone(
                    this.tags
                ),

            investigation:
                clone(
                    this.investigation
                ),

            history:
                clone(
                    this.history
                ),

            detection:
                clone(
                    this.detection
                ),

            provenance:
                clone(
                    this.provenance
                ),

            period:
                clone(
                    this.period
                ),

            requestId:
                this.requestId,

            traceId:
                this.traceId,

            createdBy:
                this.createdBy,

            updatedBy:
                this.updatedBy,

            createdAt:
                this.createdAt
                    ? new Date(
                        this.createdAt.getTime()
                    )
                    : null,

            updatedAt:
                this.updatedAt
                    ? new Date(
                        this.updatedAt.getTime()
                    )
                    : null,

            detectedAt:
                this.detectedAt
                    ? new Date(
                        this.detectedAt.getTime()
                    )
                    : null,

            correlatedAt:
                this.correlatedAt
                    ? new Date(
                        this.correlatedAt.getTime()
                    )
                    : null,

            resolvedAt:
                this.resolvedAt
                    ? new Date(
                        this.resolvedAt.getTime()
                    )
                    : null,

            expiresAt:
                this.expiresAt
                    ? new Date(
                        this.expiresAt.getTime()
                    )
                    : null
        };

        if (includeMetadata) {
            result.metadata =
                clone(
                    this.metadata
                );
        }

        if (includeFingerprint) {
            result.fingerprint =
                this.fingerprint;
        }

        return result;
    }

    toJSON() {
        return this.toObject();
    }

    toPersistence() {

        return this.toObject({
            includeMetadata: true,
            includeFingerprint: true
        });
    }

    /**
     * =========================================================================
     * Static Constructors
     * =========================================================================
     */

    static create(
        data = {}
    ) {
        return new FraudCorrelation(
            data
        );
    }

    static from(
        data = {}
    ) {

        if (
            data instanceof
            FraudCorrelation
        ) {
            return new FraudCorrelation(
                data.toObject()
            );
        }

        return new FraudCorrelation(
            data
        );
    }

    static detected(
        data = {}
    ) {

        return new FraudCorrelation({
            ...data,
            status:
                STATUS.DETECTED
        });
    }

    static analyzing(
        data = {}
    ) {

        return new FraudCorrelation({
            ...data,
            status:
                STATUS.ANALYZING
        });
    }

    static correlated(
        data = {}
    ) {

        return new FraudCorrelation({
            ...data,
            status:
                STATUS.CORRELATED
        });
    }

    static reviewRequired(
        data = {}
    ) {

        return new FraudCorrelation({
            ...data,
            status:
                STATUS.REVIEW_REQUIRED
        });
    }

    static confirmed(
        data = {}
    ) {

        return new FraudCorrelation({
            ...data,
            status:
                STATUS.CONFIRMED
        });
    }

    static falsePositive(
        data = {}
    ) {

        return new FraudCorrelation({
            ...data,
            status:
                STATUS.FALSE_POSITIVE,
            decision:
                DECISION.DISMISS
        });
    }

    /**
     * =========================================================================
     * Static Constants
     * =========================================================================
     */

    static get MODEL_NAME() {
        return MODEL_NAME;
    }

    static get SCHEMA_VERSION() {
        return SCHEMA_VERSION;
    }

    static get STATUS() {
        return STATUS;
    }

    static get RISK_LEVEL() {
        return RISK_LEVEL;
    }

    static get SEVERITY() {
        return SEVERITY;
    }

    static get CORRELATION_TYPE() {
        return CORRELATION_TYPE;
    }

    static get SIGNAL_TYPE() {
        return SIGNAL_TYPE;
    }

    static get ENTITY_TYPE() {
        return ENTITY_TYPE;
    }

    static get RELATIONSHIP_TYPE() {
        return RELATIONSHIP_TYPE;
    }

    static get INVESTIGATION_STATUS() {
        return INVESTIGATION_STATUS;
    }

    static get DECISION() {
        return DECISION;
    }
}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 *
 * Supports both:
 *
 *   const FraudCorrelation =
 *       require('./FraudCorrelation');
 *
 * and:
 *
 *   const {
 *       FraudCorrelation,
 *       STATUS,
 *       RISK_LEVEL
 *   } = require('./FraudCorrelation');
 *
 * ============================================================================
 */

module.exports =
    FraudCorrelation;

module.exports.FraudCorrelation =
    FraudCorrelation;

module.exports.STATUS =
    STATUS;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.SEVERITY =
    SEVERITY;

module.exports.CORRELATION_TYPE =
    CORRELATION_TYPE;

module.exports.SIGNAL_TYPE =
    SIGNAL_TYPE;

module.exports.ENTITY_TYPE =
    ENTITY_TYPE;

module.exports.RELATIONSHIP_TYPE =
    RELATIONSHIP_TYPE;

module.exports.INVESTIGATION_STATUS =
    INVESTIGATION_STATUS;

module.exports.DECISION =
    DECISION;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;
