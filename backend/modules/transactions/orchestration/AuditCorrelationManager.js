'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Audit Correlation Manager
 * ============================================================================
 * Enterprise Transaction Audit Correlation & Forensic Context Engine
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/orchestration/AuditCorrelationManager.js
 *
 * Purpose:
 * ---------------------------------------------------------------------------
 * Correlates financial transaction activity with security, fraud, risk,
 * compliance, authentication, device, sanctions and case-management events.
 *
 * Responsibilities:
 * ---------------------------------------------------------------------------
 * • Transaction-to-audit correlation
 * • Cross-domain event correlation
 * • Tenant isolation
 * • Correlation ID generation
 * • Idempotent correlation processing
 * • Temporal correlation windows
 * • Risk signal aggregation
 * • Fraud signal correlation
 * • Device/session correlation
 * • AML/sanctions correlation
 * • Case correlation
 * • Audit trail generation
 * • Evidence preservation
 * • Correlation confidence scoring
 * • Severity determination
 * • Forensic timeline construction
 * • Duplicate-event protection
 * • Safe metadata normalization
 * • Failure isolation
 *
 * Design Principles:
 * ---------------------------------------------------------------------------
 * • Never mutate financial records
 * • Never alter immutable audit history
 * • Never cross tenant boundaries
 * • Correlation must be deterministic where possible
 * • Correlation failures must not silently mutate transactions
 * • Sensitive values must not be logged unnecessarily
 * • Correlation is append-oriented
 * • Financial transaction processing remains authoritative elsewhere
 *
 * ============================================================================
 */

const crypto = require('crypto');

let AuditLog = null;

/**
 * AuditLog is intentionally loaded defensively.
 *
 * This allows the manager to remain compatible with installations where the
 * audit persistence model is supplied by middleware, another module, or a
 * later deployment migration.
 */
try {
    // eslint-disable-next-line global-require
    AuditLog = require('../../models/AuditLog');
} catch (error) {
    AuditLog = null;
}

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const CORRELATION_STATUS = Object.freeze({
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    PARTIAL: 'PARTIAL',
    FAILED: 'FAILED',
});

const CORRELATION_SEVERITY = Object.freeze({
    INFO: 'INFO',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
});

const CORRELATION_DECISION = Object.freeze({
    NONE: 'NONE',
    MONITOR: 'MONITOR',
    REVIEW: 'REVIEW',
    HOLD: 'HOLD',
    BLOCK: 'BLOCK',
    ESCALATE: 'ESCALATE',
});

const EVENT_TYPES = Object.freeze({
    TRANSACTION: 'TRANSACTION',
    FRAUD: 'FRAUD',
    RISK: 'RISK',
    BEHAVIORAL: 'BEHAVIORAL',
    DEVICE: 'DEVICE',
    SANCTIONS: 'SANCTIONS',
    AML: 'AML',
    AUTHENTICATION: 'AUTHENTICATION',
    SESSION: 'SESSION',
    CASE: 'CASE',
    PAYMENT: 'PAYMENT',
    SETTLEMENT: 'SETTLEMENT',
    KYC: 'KYC',
    AUDIT: 'AUDIT',
    SYSTEM: 'SYSTEM',
});

const DEFAULT_CONFIG = Object.freeze({
    correlationWindowMinutes: 30,

    extendedCorrelationWindowMinutes: 24 * 60,

    maxEvents: 500,

    maxEvidenceItems: 100,

    maxMetadataKeys: 100,

    thresholds: {
        REVIEW: 50,
        HIGH: 70,
        CRITICAL: 85,
    },

    confidence: {
        MINIMUM_CORRELATION: 20,
        STRONG_CORRELATION: 60,
        HIGH_CONFIDENCE: 80,
    },

    weights: {
        TRANSACTION: 10,
        FRAUD: 30,
        RISK: 20,
        BEHAVIORAL: 10,
        DEVICE: 15,
        SANCTIONS: 30,
        AML: 25,
        AUTHENTICATION: 15,
        SESSION: 10,
        CASE: 20,
        PAYMENT: 10,
        SETTLEMENT: 10,
        KYC: 10,
    },

    failOpen: true,

    persistCorrelationAudit: true,
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function generateId(prefix = 'CORR') {
    return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
    return new Date();
}

function toDate(value, fallback = null) {
    if (!value) {
        return fallback;
    }

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? fallback : date;
}

function clamp(value, min = 0, max = 100) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return min;
    }

    return Math.min(max, Math.max(min, numeric));
}

function safeString(value, fallback = null) {
    if (value === undefined || value === null) {
        return fallback;
    }

    return String(value);
}

function hashValue(value) {
    return crypto
        .createHash('sha256')
        .update(String(value))
        .digest('hex');
}

/**
 * Removes dangerous / excessively large metadata while preserving useful
 * forensic context.
 */
function sanitizeMetadata(metadata = {}, maxKeys = 100) {
    if (!metadata || typeof metadata !== 'object') {
        return {};
    }

    const sensitiveKeys = new Set([
        'password',
        'passwd',
        'secret',
        'token',
        'accessToken',
        'refreshToken',
        'authorization',
        'cookie',
        'sessionToken',
        'privateKey',
        'apiKey',
        'pin',
        'otp',
        'cvv',
        'cardNumber',
        'securityAnswer',
    ]);

    const result = {};
    const keys = Object.keys(metadata).slice(0, maxKeys);

    for (const key of keys) {
        if (sensitiveKeys.has(key)) {
            result[key] = '[REDACTED]';
            continue;
        }

        const value = metadata[key];

        if (
            typeof value === 'string' &&
            value.length > 2048
        ) {
            result[key] = `${value.substring(0, 2048)}...[TRUNCATED]`;
            continue;
        }

        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value)
        ) {
            result[key] = sanitizeMetadata(value, 25);
            continue;
        }

        result[key] = value;
    }

    return result;
}

/**
 * Creates a stable representation used for duplicate detection.
 */
function fingerprintEvent(event) {
    const canonical = {
        eventId: event.eventId || null,
        eventType: event.eventType || null,
        transactionId: event.transactionId || null,
        userId: event.userId || null,
        tenantId: event.tenantId || null,
        timestamp: event.timestamp
            ? new Date(event.timestamp).toISOString()
            : null,
        riskScore:
            event.riskScore !== undefined
                ? Number(event.riskScore)
                : null,
        decision: event.decision || null,
        source: event.source || null,
    };

    return hashValue(JSON.stringify(canonical));
}

/**
 * ============================================================================
 * AUDIT CORRELATION MANAGER
 * ============================================================================
 */

class AuditCorrelationManager {
    constructor(options = {}) {
        this.config = this.mergeConfig(
            DEFAULT_CONFIG,
            options
        );
    }

    /**
     * =========================================================================
     * CONFIGURATION
     * =========================================================================
     */

    mergeConfig(base, overrides) {
        return {
            ...base,
            ...overrides,
            thresholds: {
                ...base.thresholds,
                ...(overrides.thresholds || {}),
            },
            confidence: {
                ...base.confidence,
                ...(overrides.confidence || {}),
            },
            weights: {
                ...base.weights,
                ...(overrides.weights || {}),
            },
        };
    }

    /**
     * =========================================================================
     * MAIN CORRELATION ENTRYPOINT
     * =========================================================================
     *
     * Accepts:
     *
     * {
     *   tenantId,
     *   transaction,
     *   events: [],
     *   context: {}
     * }
     *
     * The events array can contain output from:
     *
     * • FraudDetectionService
     * • RiskEngineService
     * • TransactionMonitoringService
     * • BehavioralAnalysisService
     * • DeviceFingerprintService
     * • SanctionsScreeningService
     * • CaseManagementService
     * • authentication/session services
     */
    async correlate({
        tenantId,
        transaction,
        events = [],
        context = {},
    } = {}) {
        const correlationId = generateId('CORR');
        const startedAt = now();

        try {
            this.validateCorrelationRequest({
                tenantId,
                transaction,
            });

            const normalizedTransaction =
                this.normalizeTransaction(
                    transaction,
                    tenantId
                );

            const normalizedEvents =
                this.normalizeEvents(
                    events,
                    tenantId,
                    normalizedTransaction
                );

            const temporalEvents =
                this.filterByCorrelationWindow(
                    normalizedEvents,
                    normalizedTransaction.timestamp
                );

            const deduplicatedEvents =
                this.deduplicateEvents(
                    temporalEvents
                );

            const grouped =
                this.groupEvents(
                    deduplicatedEvents
                );

            const riskSignals =
                this.aggregateRiskSignals(
                    grouped
                );

            const correlationScore =
                this.calculateCorrelationScore(
                    normalizedTransaction,
                    grouped,
                    riskSignals
                );

            const severity =
                this.determineSeverity(
                    correlationScore,
                    riskSignals
                );

            const decision =
                this.determineDecision(
                    severity,
                    riskSignals
                );

            const confidence =
                this.calculateConfidence(
                    normalizedTransaction,
                    grouped,
                    riskSignals
                );

            const evidence =
                this.buildEvidence(
                    normalizedTransaction,
                    grouped,
                    riskSignals
                );

            const timeline =
                this.buildTimeline(
                    normalizedTransaction,
                    deduplicatedEvents
                );

            const result = {
                success: true,

                correlationId,

                tenantId,

                transactionId:
                    normalizedTransaction.transactionId,

                status: CORRELATION_STATUS.COMPLETED,

                severity,

                decision,

                correlationScore,

                confidence,

                riskSignals,

                eventSummary:
                    this.buildEventSummary(
                        grouped
                    ),

                evidence,

                timeline,

                context:
                    sanitizeMetadata(
                        context,
                        this.config.maxMetadataKeys
                    ),

                statistics: {
                    receivedEvents: events.length,
                    normalizedEvents:
                        normalizedEvents.length,
                    correlatedEvents:
                        deduplicatedEvents.length,
                    correlationWindowMinutes:
                        this.config
                            .correlationWindowMinutes,
                },

                startedAt:
                    startedAt.toISOString(),

                completedAt:
                    now().toISOString(),
            };

            if (
                this.config
                    .persistCorrelationAudit
            ) {
                await this.persistCorrelationAudit(
                    result
                );
            }

            return result;
        } catch (error) {
            return this.handleCorrelationFailure(
                error,
                {
                    correlationId,
                    tenantId,
                    transaction,
                    startedAt,
                }
            );
        }
    }

    /**
     * =========================================================================
     * REQUEST VALIDATION
     * =========================================================================
     */

    validateCorrelationRequest({
        tenantId,
        transaction,
    }) {
        if (!tenantId) {
            throw new Error(
                'tenantId is required for audit correlation'
            );
        }

        if (!transaction) {
            throw new Error(
                'transaction is required for audit correlation'
            );
        }

        if (
            !transaction._id &&
            !transaction.id &&
            !transaction.transactionId
        ) {
            throw new Error(
                'transaction identifier is required'
            );
        }
    }

    /**
     * =========================================================================
     * TRANSACTION NORMALIZATION
     * =========================================================================
     */

    normalizeTransaction(
        transaction,
        tenantId
    ) {
        const transactionId =
            transaction.transactionId ||
            transaction._id ||
            transaction.id;

        return {
            transactionId:
                safeString(transactionId),

            tenantId,

            userId:
                transaction.userId ||
                transaction.memberId ||
                transaction.customerId ||
                null,

            amount:
                Number(transaction.amount || 0),

            currency:
                transaction.currency || null,

            type:
                transaction.type ||
                transaction.transactionType ||
                null,

            status:
                transaction.status || null,

            timestamp:
                toDate(
                    transaction.createdAt ||
                    transaction.timestamp ||
                    transaction.date,
                    now()
                ),

            deviceId:
                transaction.deviceId || null,

            sessionId:
                transaction.sessionId || null,

            ipAddress:
                transaction.ipAddress ||
                transaction.ip ||
                null,

            channel:
                transaction.channel || null,

            beneficiaryId:
                transaction.beneficiaryId ||
                null,

            metadata:
                sanitizeMetadata(
                    transaction.metadata || {},
                    this.config.maxMetadataKeys
                ),
        };
    }

    /**
     * =========================================================================
     * EVENT NORMALIZATION
     * =========================================================================
     */

    normalizeEvents(
        events,
        tenantId,
        transaction
    ) {
        if (!Array.isArray(events)) {
            return [];
        }

        return events
            .slice(0, this.config.maxEvents)
            .filter(Boolean)
            .map((event) => {
                const normalized = {
                    eventId:
                        event.eventId ||
                        event.id ||
                        generateId('EVT'),

                    eventType:
                        this.normalizeEventType(
                            event.eventType ||
                            event.type ||
                            event.source
                        ),

                    source:
                        event.source ||
                        event.service ||
                        'UNKNOWN',

                    tenantId:
                        event.tenantId ||
                        tenantId,

                    transactionId:
                        event.transactionId ||
                        transaction.transactionId ||
                        null,

                    userId:
                        event.userId ||
                        event.memberId ||
                        event.customerId ||
                        transaction.userId ||
                        null,

                    timestamp:
                        toDate(
                            event.timestamp ||
                            event.createdAt ||
                            event.occurredAt,
                            transaction.timestamp
                        ),

                    riskScore:
                        this.extractRiskScore(
                            event
                        ),

                    decision:
                        event.decision ||
                        event.action ||
                        null,

                    severity:
                        event.severity ||
                        event.fraudLevel ||
                        event.classification ||
                        null,

                    status:
                        event.status || null,

                    signal:
                        event.signal ||
                        event.indicator ||
                        null,

                    metadata:
                        sanitizeMetadata(
                            event.metadata ||
                            event.details ||
                            {},
                            this.config.maxMetadataKeys
                        ),
                };

                normalized.eventFingerprint =
                    fingerprintEvent(
                        normalized
                    );

                return normalized;
            })
            .filter(
                (event) =>
                    event.tenantId === tenantId
            );
    }

    /**
     * =========================================================================
     * EVENT TYPE NORMALIZATION
     * =========================================================================
     */

    normalizeEventType(type) {
        if (!type) {
            return EVENT_TYPES.SYSTEM;
        }

        const normalized =
            String(type)
                .trim()
                .toUpperCase();

        const aliases = {
            FRAUDDETECTION:
                EVENT_TYPES.FRAUD,

            FRAUD_DETECTION:
                EVENT_TYPES.FRAUD,

            RISKENGINE:
                EVENT_TYPES.RISK,

            RISK_ENGINE:
                EVENT_TYPES.RISK,

            TRANSACTIONMONITORING:
                EVENT_TYPES.TRANSACTION,

            TRANSACTION_MONITORING:
                EVENT_TYPES.TRANSACTION,

            BEHAVIOURAL:
                EVENT_TYPES.BEHAVIORAL,

            DEVICEFINGERPRINT:
                EVENT_TYPES.DEVICE,

            DEVICE_FINGERPRINT:
                EVENT_TYPES.DEVICE,

            SANCTIONSSCREENING:
                EVENT_TYPES.SANCTIONS,

            SANCTIONS_SCREENING:
                EVENT_TYPES.SANCTIONS,

            AML_SCREENING:
                EVENT_TYPES.AML,

            CASEMANAGEMENT:
                EVENT_TYPES.CASE,

            CASE_MANAGEMENT:
                EVENT_TYPES.CASE,
        };

        return (
            aliases[normalized] ||
            EVENT_TYPES[normalized] ||
            normalized
        );
    }

    /**
     * =========================================================================
     * RISK SCORE EXTRACTION
     * =========================================================================
     */

    extractRiskScore(event) {
        const candidates = [
            event.riskScore,
            event.fraudScore,
            event.score,
            event.matchScore,
        ];

        for (const value of candidates) {
            const numeric = Number(value);

            if (
                Number.isFinite(numeric) &&
                numeric >= 0
            ) {
                return clamp(numeric);
            }
        }

        return 0;
    }

    /**
     * =========================================================================
     * TEMPORAL CORRELATION
     * =========================================================================
     */

    filterByCorrelationWindow(
        events,
        transactionTimestamp
    ) {
        const transactionTime =
            toDate(
                transactionTimestamp,
                now()
            ).getTime();

        const windowMs =
            this.config
                .correlationWindowMinutes *
            60 *
            1000;

        const extendedWindowMs =
            this.config
                .extendedCorrelationWindowMinutes *
            60 *
            1000;

        return events.filter((event) => {
            if (!event.timestamp) {
                return false;
            }

            const difference =
                Math.abs(
                    event.timestamp.getTime() -
                    transactionTime
                );

            /**
             * Strong correlation window.
             */
            if (difference <= windowMs) {
                return true;
            }

            /**
             * Extended correlation is permitted for
             * high-value security/compliance events.
             */
            if (
                difference <= extendedWindowMs &&
                [
                    EVENT_TYPES.FRAUD,
                    EVENT_TYPES.SANCTIONS,
                    EVENT_TYPES.AML,
                    EVENT_TYPES.CASE,
                    EVENT_TYPES.RISK,
                ].includes(event.eventType)
            ) {
                return true;
            }

            return false;
        });
    }

    /**
     * =========================================================================
     * DUPLICATE EVENT PROTECTION
     * =========================================================================
     */

    deduplicateEvents(events) {
        const seen = new Set();
        const result = [];

        for (const event of events) {
            const fingerprint =
                event.eventFingerprint ||
                fingerprintEvent(event);

            if (seen.has(fingerprint)) {
                continue;
            }

            seen.add(fingerprint);

            result.push({
                ...event,
                eventFingerprint:
                    fingerprint,
            });
        }

        return result;
    }

    /**
     * =========================================================================
     * EVENT GROUPING
     * =========================================================================
     */

    groupEvents(events) {
        const grouped = {};

        for (const type of Object.values(EVENT_TYPES)) {
            grouped[type] = [];
        }

        for (const event of events) {
            if (!grouped[event.eventType]) {
                grouped[event.eventType] = [];
            }

            grouped[event.eventType].push(
                event
            );
        }

        return grouped;
    }

    /**
     * =========================================================================
     * RISK SIGNAL AGGREGATION
     * =========================================================================
     */

    aggregateRiskSignals(grouped) {
        const signals = {
            fraud: {
                score: 0,
                count: 0,
                present: false,
            },

            sanctions: {
                score: 0,
                count: 0,
                present: false,
            },

            aml: {
                score: 0,
                count: 0,
                present: false,
            },

            device: {
                score: 0,
                count: 0,
                present: false,
            },

            behavioral: {
                score: 0,
                count: 0,
                present: false,
            },

            authentication: {
                score: 0,
                count: 0,
                present: false,
            },

            risk: {
                score: 0,
                count: 0,
                present: false,
            },

            caseManagement: {
                score: 0,
                count: 0,
                present: false,
            },
        };

        this.aggregateSignalGroup(
            signals.fraud,
            grouped[EVENT_TYPES.FRAUD]
        );

        this.aggregateSignalGroup(
            signals.sanctions,
            grouped[EVENT_TYPES.SANCTIONS]
        );

        this.aggregateSignalGroup(
            signals.aml,
            grouped[EVENT_TYPES.AML]
        );

        this.aggregateSignalGroup(
            signals.device,
            grouped[EVENT_TYPES.DEVICE]
        );

        this.aggregateSignalGroup(
            signals.behavioral,
            grouped[EVENT_TYPES.BEHAVIORAL]
        );

        this.aggregateSignalGroup(
            signals.authentication,
            grouped[EVENT_TYPES.AUTHENTICATION]
        );

        this.aggregateSignalGroup(
            signals.risk,
            grouped[EVENT_TYPES.RISK]
        );

        this.aggregateSignalGroup(
            signals.caseManagement,
            grouped[EVENT_TYPES.CASE]
        );

        return signals;
    }

    aggregateSignalGroup(
        target,
        events = []
    ) {
        if (!events.length) {
            return;
        }

        target.present = true;
        target.count = events.length;

        const scores =
            events
                .map((event) =>
                    clamp(
                        event.riskScore || 0
                    )
                )
                .filter(
                    (score) =>
                        Number.isFinite(score)
                );

        if (scores.length) {
            target.score =
                Math.max(...scores);
        }
    }

    /**
     * =========================================================================
     * CORRELATION SCORE
     * =========================================================================
     */

    calculateCorrelationScore(
        transaction,
        grouped,
        riskSignals
    ) {
        let score = 0;

        for (const [
            type,
            weight,
        ] of Object.entries(
            this.config.weights
        )) {
            const events =
                grouped[type] || [];

            if (!events.length) {
                continue;
            }

            const signalScore =
                events.reduce(
                    (
                        highest,
                        event
                    ) =>
                        Math.max(
                            highest,
                            clamp(
                                event.riskScore ||
                                0
                            )
                        ),
                    0
                );

            score +=
                signalScore *
                (weight / 100);
        }

        /**
         * Cross-domain amplification.
         *
         * Multiple independent security signals
         * are materially more significant than one
         * isolated signal.
         */
        const activeDomains =
            Object.values(
                riskSignals
            ).filter(
                (signal) =>
                    signal.present
            ).length;

        if (activeDomains >= 3) {
            score += 10;
        }

        if (activeDomains >= 5) {
            score += 10;
        }

        /**
         * High-value transactions receive additional
         * contextual weighting but never become
         * automatically fraudulent solely because
         * of transaction size.
         */
        if (
            Number(transaction.amount) >
            1000000
        ) {
            score += 5;
        }

        return clamp(
            Number(score.toFixed(2))
        );
    }

    /**
     * =========================================================================
     * SEVERITY
     * =========================================================================
     */

    determineSeverity(
        score,
        riskSignals
    ) {
        if (
            riskSignals.sanctions.score >= 95
        ) {
            return CORRELATION_SEVERITY.CRITICAL;
        }

        if (
            riskSignals.fraud.score >= 90
        ) {
            return CORRELATION_SEVERITY.CRITICAL;
        }

        if (
            score >=
            this.config.thresholds.CRITICAL
        ) {
            return CORRELATION_SEVERITY.CRITICAL;
        }

        if (
            score >=
            this.config.thresholds.HIGH
        ) {
            return CORRELATION_SEVERITY.HIGH;
        }

        if (
            score >=
            this.config.thresholds.REVIEW
        ) {
            return CORRELATION_SEVERITY.MEDIUM;
        }

        if (score > 0) {
            return CORRELATION_SEVERITY.LOW;
        }

        return CORRELATION_SEVERITY.INFO;
    }

    /**
     * =========================================================================
     * DECISION ENGINE
     * =========================================================================
     */

    determineDecision(
        severity,
        riskSignals
    ) {
        if (
            riskSignals.sanctions.score >= 95
        ) {
            return CORRELATION_DECISION.BLOCK;
        }

        if (
            riskSignals.fraud.score >= 90
        ) {
            return CORRELATION_DECISION.BLOCK;
        }

        switch (severity) {
            case CORRELATION_SEVERITY.CRITICAL:
                return CORRELATION_DECISION.BLOCK;

            case CORRELATION_SEVERITY.HIGH:
                return CORRELATION_DECISION.HOLD;

            case CORRELATION_SEVERITY.MEDIUM:
                return CORRELATION_DECISION.REVIEW;

            case CORRELATION_SEVERITY.LOW:
                return CORRELATION_DECISION.MONITOR;

            default:
                return CORRELATION_DECISION.NONE;
        }
    }

    /**
     * =========================================================================
     * CONFIDENCE ENGINE
     * =========================================================================
     */

    calculateConfidence(
        transaction,
        grouped,
        riskSignals
    ) {
        let confidence = 0;

        const correlationFactors = [
            {
                condition:
                    transaction.userId &&
                    this.hasMatchingUser(
                        transaction,
                        grouped
                    ),
                value: 25,
            },

            {
                condition:
                    transaction.transactionId &&
                    this.hasMatchingTransaction(
                        transaction,
                        grouped
                    ),
                value: 30,
            },

            {
                condition:
                    transaction.deviceId &&
                    this.hasMatchingDevice(
                        transaction,
                        grouped
                    ),
                value: 15,
            },

            {
                condition:
                    transaction.sessionId &&
                    this.hasMatchingSession(
                        transaction,
                        grouped
                    ),
                value: 10,
            },

            {
                condition:
                    this.countActiveDomains(
                        riskSignals
                    ) >= 2,
                value: 10,
            },

            {
                condition:
                    this.countActiveDomains(
                        riskSignals
                    ) >= 4,
                value: 10,
            },
        ];

        for (const factor of correlationFactors) {
            if (factor.condition) {
                confidence += factor.value;
            }
        }

        return clamp(
            confidence,
            0,
            100
        );
    }

    hasMatchingUser(
        transaction,
        grouped
    ) {
        return Object.values(grouped)
            .flat()
            .some(
                (event) =>
                    event.userId &&
                    String(event.userId) ===
                        String(
                            transaction.userId
                        )
            );
    }

    hasMatchingTransaction(
        transaction,
        grouped
    ) {
        return Object.values(grouped)
            .flat()
            .some(
                (event) =>
                    event.transactionId &&
                    String(
                        event.transactionId
                    ) ===
                        String(
                            transaction.transactionId
                        )
            );
    }

    hasMatchingDevice(
        transaction,
        grouped
    ) {
        return Object.values(grouped)
            .flat()
            .some(
                (event) =>
                    event.metadata &&
                    event.metadata.deviceId &&
                    String(
                        event.metadata.deviceId
                    ) ===
                        String(
                            transaction.deviceId
                        )
            );
    }

    hasMatchingSession(
        transaction,
        grouped
    ) {
        return Object.values(grouped)
            .flat()
            .some(
                (event) =>
                    event.metadata &&
                    event.metadata.sessionId &&
                    String(
                        event.metadata.sessionId
                    ) ===
                        String(
                            transaction.sessionId
                        )
            );
    }

    countActiveDomains(
        riskSignals
    ) {
        return Object.values(
            riskSignals
        ).filter(
            (signal) =>
                signal.present
        ).length;
    }

    /**
     * =========================================================================
     * EVENT SUMMARY
     * =========================================================================
     */

    buildEventSummary(grouped) {
        const summary = {};

        for (const [
            type,
            events,
        ] of Object.entries(grouped)) {
            if (!events.length) {
                continue;
            }

            summary[type] = {
                count: events.length,

                highestRiskScore:
                    Math.max(
                        ...events.map(
                            (event) =>
                                event.riskScore ||
                                0
                        )
                    ),

                decisions:
                    [
                        ...new Set(
                            events
                                .map(
                                    (event) =>
                                        event.decision
                                )
                                .filter(Boolean)
                        ),
                    ],

                sources:
                    [
                        ...new Set(
                            events
                                .map(
                                    (event) =>
                                        event.source
                                )
                                .filter(Boolean)
                        ),
                    ],
            };
        }

        return summary;
    }

    /**
     * =========================================================================
     * EVIDENCE BUILDER
     * =========================================================================
     */

    buildEvidence(
        transaction,
        grouped,
        riskSignals
    ) {
        const evidence = [];

        for (const events of Object.values(
            grouped
        )) {
            for (const event of events) {
                if (
                    evidence.length >=
                    this.config.maxEvidenceItems
                ) {
                    break;
                }

                evidence.push({
                    evidenceId:
                        generateId('EVID'),

                    eventId:
                        event.eventId,

                    eventType:
                        event.eventType,

                    source:
                        event.source,

                    timestamp:
                        event.timestamp
                            ? event.timestamp.toISOString()
                            : null,

                    riskScore:
                        event.riskScore,

                    severity:
                        event.severity,

                    decision:
                        event.decision,

                    fingerprint:
                        event.eventFingerprint,

                    metadata:
                        event.metadata,
                });
            }
        }

        /**
         * Add transaction fingerprint as an immutable
         * forensic reference without exposing unnecessary
         * financial details.
         */
        evidence.unshift({
            evidenceId:
                generateId('EVID'),

            eventType:
                EVENT_TYPES.TRANSACTION,

            source:
                'AuditCorrelationManager',

            timestamp:
                transaction.timestamp.toISOString(),

            transactionFingerprint:
                hashValue(
                    transaction.transactionId
                ),

            riskSignalCount:
                Object.values(
                    riskSignals
                ).filter(
                    (signal) =>
                        signal.present
                ).length,
        });

        return evidence.slice(
            0,
            this.config.maxEvidenceItems
        );
    }

    /**
     * =========================================================================
     * FORENSIC TIMELINE
     * =========================================================================
     */

    buildTimeline(
        transaction,
        events
    ) {
        const timeline = [
            {
                timestamp:
                    transaction.timestamp.toISOString(),

                type:
                    EVENT_TYPES.TRANSACTION,

                eventId:
                    transaction.transactionId,

                source:
                    'TRANSACTION',

                description:
                    'Transaction observed by correlation engine.',
            },
        ];

        for (const event of events) {
            timeline.push({
                timestamp:
                    event.timestamp
                        ? event.timestamp.toISOString()
                        : null,

                type:
                    event.eventType,

                eventId:
                    event.eventId,

                source:
                    event.source,

                riskScore:
                    event.riskScore,

                decision:
                    event.decision,

                severity:
                    event.severity,
            });
        }

        return timeline.sort(
            (a, b) =>
                new Date(a.timestamp) -
                new Date(b.timestamp)
        );
    }

    /**
     * =========================================================================
     * AUDIT PERSISTENCE
     * =========================================================================
     *
     * This method intentionally uses a defensive persistence strategy.
     *
     * If an AuditLog model exists, the correlation record is persisted.
     * If the deployment supplies audit persistence elsewhere, the correlation
     * engine remains operational without modifying transaction processing.
     */
    async persistCorrelationAudit(
        result
    ) {
        if (!AuditLog) {
            return {
                persisted: false,
                reason:
                    'AuditLog model unavailable',
            };
        }

        try {
            const payload = {
                auditId:
                    generateId('AUD'),

                eventType:
                    'TRANSACTION_RISK_CORRELATION',

                action:
                    'CORRELATE',

                tenantId:
                    result.tenantId,

                transactionId:
                    result.transactionId,

                correlationId:
                    result.correlationId,

                severity:
                    result.severity,

                decision:
                    result.decision,

                riskScore:
                    result.correlationScore,

                confidence:
                    result.confidence,

                status:
                    result.status,

                metadata:
                    sanitizeMetadata(
                        {
                            riskSignals:
                                result.riskSignals,

                            eventSummary:
                                result.eventSummary,

                            statistics:
                                result.statistics,
                        }
                    ),

                createdAt:
                    new Date(),
            };

            await AuditLog.create(
                payload
            );

            return {
                persisted: true,
            };
        } catch (error) {
            /**
             * Audit persistence failure must never cause the
             * financial transaction itself to fail.
             *
             * The failure is returned to the caller so the
             * orchestration layer can route it to observability,
             * retry or dead-letter handling.
             */
            return {
                persisted: false,
                reason:
                    error.message,
            };
        }
    }

    /**
     * =========================================================================
     * DIRECT AUDIT EVENT CORRELATION
     * =========================================================================
     *
     * Convenience method for callers that already have audit events.
     */
    async correlateAuditEvents({
        tenantId,
        transaction,
        auditEvents = [],
        context = {},
    } = {}) {
        return this.correlate({
            tenantId,
            transaction,
            events: auditEvents,
            context,
        });
    }

    /**
     * =========================================================================
     * RISK DOMAIN CORRELATION
     * =========================================================================
     *
     * Convenience method for the risk orchestration layer.
     */
    async correlateRiskSignals({
        tenantId,
        transaction,
        fraudResult,
        behavioralResult,
        deviceResult,
        sanctionsResult,
        transactionMonitoringResult,
        riskEngineResult,
        caseResult,
        context = {},
    } = {}) {
        const events = [];

        this.appendResultEvent(
            events,
            fraudResult,
            EVENT_TYPES.FRAUD,
            'FraudDetectionService'
        );

        this.appendResultEvent(
            events,
            behavioralResult,
            EVENT_TYPES.BEHAVIORAL,
            'BehavioralAnalysisService'
        );

        this.appendResultEvent(
            events,
            deviceResult,
            EVENT_TYPES.DEVICE,
            'DeviceFingerprintService'
        );

        this.appendResultEvent(
            events,
            sanctionsResult,
            EVENT_TYPES.SANCTIONS,
            'SanctionsScreeningService'
        );

        this.appendResultEvent(
            events,
            transactionMonitoringResult,
            EVENT_TYPES.TRANSACTION,
            'TransactionMonitoringService'
        );

        this.appendResultEvent(
            events,
            riskEngineResult,
            EVENT_TYPES.RISK,
            'RiskEngineService'
        );

        this.appendResultEvent(
            events,
            caseResult,
            EVENT_TYPES.CASE,
            'CaseManagementService'
        );

        return this.correlate({
            tenantId,
            transaction,
            events,
            context,
        });
    }

    /**
     * =========================================================================
     * RESULT EVENT ADAPTER
     * =========================================================================
     */

    appendResultEvent(
        events,
        result,
        eventType,
        source
    ) {
        if (!result) {
            return;
        }

        events.push({
            eventId:
                result.investigationId ||
                result.analysisId ||
                result.screeningId ||
                result.monitoringId ||
                result.assessmentId ||
                result.caseId ||
                null,

            eventType,

            source,

            transactionId:
                result.transactionId ||
                null,

            userId:
                result.userId ||
                result.memberId ||
                null,

            timestamp:
                result.timestamp ||
                result.createdAt ||
                new Date(),

            riskScore:
                result.fraudScore ??
                result.riskScore ??
                result.score ??
                result.creditScore ??
                result.maxRiskScore ??
                0,

            decision:
                typeof result.decision ===
                'string'
                    ? result.decision
                    : result.decision?.action ||
                      null,

            severity:
                result.fraudLevel ||
                result.classification ||
                result.severity ||
                result.riskLevel ||
                null,

            status:
                result.status ||
                null,

            metadata:
                result.indicators ||
                result.details ||
                result.componentScores ||
                result.metadata ||
                {},
        });
    }

    /**
     * =========================================================================
     * CORRELATION SUMMARY
     * =========================================================================
     */

    summarize(result) {
        if (!result) {
            return null;
        }

        return {
            correlationId:
                result.correlationId,

            tenantId:
                result.tenantId,

            transactionId:
                result.transactionId,

            status:
                result.status,

            severity:
                result.severity,

            decision:
                result.decision,

            correlationScore:
                result.correlationScore,

            confidence:
                result.confidence,

            activeRiskDomains:
                result.riskSignals
                    ? this.countActiveDomains(
                          result.riskSignals
                      )
                    : 0,

            correlatedEvents:
                result.statistics
                    ?.correlatedEvents || 0,

            timestamp:
                result.completedAt ||
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * FAILURE HANDLING
     * =========================================================================
     */

    handleCorrelationFailure(
        error,
        context
    ) {
        const correlationId =
            context.correlationId ||
            generateId('CORR');

        const safeError = {
            name:
                error?.name ||
                'CorrelationError',

            message:
                error?.message ||
                'Audit correlation failed',
        };

        /**
         * Fail-open means the correlation engine does not
         * become a transaction-processing dependency.
         *
         * The transaction itself remains authoritative in
         * the transaction/ledger subsystem.
         */
        if (this.config.failOpen) {
            return {
                success: false,

                correlationId,

                tenantId:
                    context.tenantId,

                transactionId:
                    context.transaction?.transactionId ||
                    context.transaction?._id ||
                    context.transaction?.id ||
                    null,

                status:
                    CORRELATION_STATUS.PARTIAL,

                severity:
                    CORRELATION_SEVERITY.INFO,

                decision:
                    CORRELATION_DECISION.MONITOR,

                correlationScore: 0,

                confidence: 0,

                degraded: true,

                error: safeError,

                timestamp:
                    new Date().toISOString(),
            };
        }

        throw error;
    }
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 */

module.exports =
    new AuditCorrelationManager();