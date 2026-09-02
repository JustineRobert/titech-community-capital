'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * FraudAlertService
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/fraud/FraudAlertService.js
 *
 * Purpose:
 *   Enterprise fraud-alert lifecycle and orchestration service.
 *
 * Responsibilities:
 *   - Create fraud alerts from intelligence signals
 *   - Normalize fraud findings into a canonical alert structure
 *   - Enforce tenant isolation
 *   - Provide deterministic idempotency
 *   - Deduplicate repeated fraud signals
 *   - Calculate / normalize severity
 *   - Maintain alert lifecycle
 *   - Support acknowledgement
 *   - Support investigation assignment
 *   - Support escalation
 *   - Support resolution / dismissal
 *   - Preserve evidence and explainability
 *   - Provide notification hooks
 *   - Provide audit hooks
 *   - Provide metrics hooks
 *   - Support bulk alert ingestion
 *   - Prevent duplicate alert creation
 *   - Provide alert statistics
 *   - Support retention metadata
 *
 * IMPORTANT:
 *   This service DOES NOT:
 *     - modify ledger entries
 *     - reverse transactions
 *     - freeze accounts
 *     - block transactions
 *     - declare legal fraud
 *     - perform financial repairs
 *
 * It creates and manages fraud-risk alerts for downstream investigation,
 * policy, case-management, compliance, or human-review workflows.
 *
 * Repository contract:
 *
 *   create(alert)
 *   findById(id, tenantId)
 *   findByFingerprint(fingerprint, tenantId)
 *   update(id, tenantId, patch)
 *   list(filter, options)
 *   count(filter)
 *
 * Optional repository methods:
 *
 *   findOpenByFingerprint(fingerprint, tenantId)
 *   findSimilar(...)
 *   bulkCreate(alerts)
 *   bulkUpdate(...)
 *   aggregate(...)
 *
 * The service deliberately does not require a specific ORM.
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
    'FraudAlertService';

const MODULE_VERSION =
    '1.0.0';

const ALERT_SCHEMA_VERSION =
    '1.0.0';

/**
 * ============================================================================
 * Alert Status
 * ============================================================================
 */

const ALERT_STATUS =
    Object.freeze({

        OPEN:
            'OPEN',

        ACKNOWLEDGED:
            'ACKNOWLEDGED',

        INVESTIGATING:
            'INVESTIGATING',

        ESCALATED:
            'ESCALATED',

        RESOLVED:
            'RESOLVED',

        DISMISSED:
            'DISMISSED',

        FALSE_POSITIVE:
            'FALSE_POSITIVE'
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
 * Alert Types
 * ============================================================================
 */

const ALERT_TYPE =
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

        COORDINATED_ACTIVITY:
            'COORDINATED_ACTIVITY',

        NETWORK_CLUSTER:
            'NETWORK_CLUSTER',

        HIGH_CONCENTRATION:
            'HIGH_CONCENTRATION',

        AI_RECOMMENDATION:
            'AI_RECOMMENDATION',

        MODEL_ANOMALY:
            'MODEL_ANOMALY',

        MANUAL:
            'MANUAL',

        SYSTEM:
            'SYSTEM'
    });

/**
 * ============================================================================
 * Alert Source
 * ============================================================================
 */

const ALERT_SOURCE =
    Object.freeze({

        RULE_ENGINE:
            'RULE_ENGINE',

        ANOMALY_DETECTOR:
            'ANOMALY_DETECTOR',

        CROSS_ACCOUNT_ANALYZER:
            'CROSS_ACCOUNT_ANALYZER',

        AI_ENGINE:
            'AI_ENGINE',

        FRAUD_CORRELATION_ENGINE:
            'FRAUD_CORRELATION_ENGINE',

        MANUAL:
            'MANUAL',

        EXTERNAL:
            'EXTERNAL',

        SYSTEM:
            'SYSTEM'
    });

/**
 * ============================================================================
 * Resolution Codes
 * ============================================================================
 */

const RESOLUTION_CODE =
    Object.freeze({

        CONFIRMED_RISK:
            'CONFIRMED_RISK',

        FALSE_POSITIVE:
            'FALSE_POSITIVE',

        DUPLICATE:
            'DUPLICATE',

        INSUFFICIENT_EVIDENCE:
            'INSUFFICIENT_EVIDENCE',

        LEGITIMATE_ACTIVITY:
            'LEGITIMATE_ACTIVITY',

        POLICY_EXCEPTION:
            'POLICY_EXCEPTION',

        EXPIRED:
            'EXPIRED',

        MANUAL_REVIEW_COMPLETED:
            'MANUAL_REVIEW_COMPLETED'
    });

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULT_CONFIG =
    Object.freeze({

        deduplicationWindowMinutes:
            1440,

        escalationThreshold:
            0.85,

        criticalThreshold:
            0.85,

        highThreshold:
            0.65,

        mediumThreshold:
            0.40,

        defaultExpirationDays:
            30,

        criticalExpirationDays:
            90,

        highExpirationDays:
            60,

        mediumExpirationDays:
            30,

        lowExpirationDays:
            14,

        maxEvidenceItems:
            100,

        maxRelatedAccounts:
            100,

        maxRelatedTransactions:
            500,

        maxTags:
            50,

        maxBulkAlerts:
            1000,

        requireTenantId:
            true,

        enableNotifications:
            true,

        enableAudit:
            true,

        enableMetrics:
            true,

        preserveRawReferences:
            false,

        allowCriticalDismissal:
            false,

        autoEscalateCritical:
            true,

        autoEscalateThreshold:
            0.85,

        autoAcknowledgeOnAssignment:
            true,

        fingerprintAlgorithm:
            'sha256'
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class FraudAlertServiceError extends Error {

    constructor(
        message,
        code = 'FRAUD_ALERT_SERVICE_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'FraudAlertServiceError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            FraudAlertServiceError
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

function normalizeId(
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
                    value !== undefined &&
                    value !== null &&
                    value !== ''
            )
        )
    ];
}

function addDays(
    date,
    days
) {

    const timestamp =
        new Date(
            date
        );

    timestamp.setUTCDate(
        timestamp.getUTCDate() +
        days
    );

    return timestamp
        .toISOString();
}

/**
 * ============================================================================
 * FraudAlertService
 * ============================================================================
 */

class FraudAlertService {

    constructor(
        options = {}
    ) {

        this.repository =
            options.repository ||
            null;

        this.alertRepository =
            options.alertRepository ||
            this.repository;

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

        this.caseService =
            options.caseService ||
            null;

        this.config = {

            ...DEFAULT_CONFIG,

            ...(options.config || {})
        };

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

            // Logging must never interrupt alert processing.
        }
    }

    /**
     * =========================================================================
     * Create Alert
     * =========================================================================
     */

    async createAlert(
        input = {},
        context = {}
    ) {

        const startedAt =
            Date.now();

        const normalized =
            this.normalizeAlertInput(
                input,
                context
            );

        const fingerprint =
            this.generateFingerprint(
                normalized
            );

        normalized.fingerprint =
            fingerprint;

        const existing =
            await this.findExistingAlert(
                normalized
            );

        if (
            existing
        ) {

            const deduplicated =
                await this.handleDuplicateAlert(
                    existing,
                    normalized,
                    context
                );

            this.recordMetric(
                'fraud_alert_deduplicated',
                {

                    tenantId:
                        normalized.tenantId
                }
            );

            return deduplicated;
        }

        const alert =
            this.buildAlert(
                normalized,
                context
            );

        const persisted =
            await this.persistAlert(
                alert
            );

        await this.afterAlertCreated(
            persisted,
            context
        );

        this.recordAudit(
            'FRAUD_ALERT_CREATED',
            {

                alertId:
                    persisted.id,

                tenantId:
                    persisted.tenantId,

                type:
                    persisted.type,

                severity:
                    persisted.severity,

                riskScore:
                    persisted.riskScore,

                fingerprint:
                    persisted.fingerprint
            },
            context.actor
        );

        this.recordMetric(
            'fraud_alert_created',
            {

                tenantId:
                    persisted.tenantId,

                type:
                    persisted.type,

                severity:
                    persisted.severity
            }
        );

        this.log(
            'info',
            'Fraud alert created.',
            {

                alertId:
                    persisted.id,

                tenantId:
                    persisted.tenantId,

                type:
                    persisted.type,

                severity:
                    persisted.severity,

                durationMs:
                    Date.now() -
                    startedAt
            }
        );

        return persisted;
    }

    /**
     * =========================================================================
     * Bulk Alert Creation
     * =========================================================================
     */

    async createAlerts(
        inputs = [],
        context = {}
    ) {

        if (
            !isArray(
                inputs
            )
        ) {

            throw new FraudAlertServiceError(
                'Alert input must be an array.',
                'INVALID_ALERT_BATCH'
            );
        }

        if (
            inputs.length >
            this.config.maxBulkAlerts
        ) {

            throw new FraudAlertServiceError(
                'Alert batch exceeds configured maximum.',
                'ALERT_BATCH_LIMIT_EXCEEDED',
                {

                    maximum:
                        this.config.maxBulkAlerts,

                    received:
                        inputs.length
                }
            );
        }

        const results =
            [];

        for (
            const input
            of inputs
        ) {

            try {

                const alert =
                    await this.createAlert(
                        input,
                        context
                    );

                results.push(
                    {

                        success:
                            true,

                        alert
                    }
                );

            } catch (
                error
            ) {

                results.push(
                    {

                        success:
                            false,

                        error: {

                            code:
                                error.code ||
                                'ALERT_CREATION_FAILED',

                            message:
                                error.message
                        }
                    }
                );
            }
        }

        return {

            total:
                inputs.length,

            successful:
                results.filter(
                    result =>
                        result.success
                ).length,

            failed:
                results.filter(
                    result =>
                        !result.success
                ).length,

            results
        };
    }

    /**
     * =========================================================================
     * Create From Fraud Signal
     * =========================================================================
     */

    async createFromSignal(
        signal,
        context = {}
    ) {

        if (
            !isObject(
                signal
            )
        ) {

            throw new FraudAlertServiceError(
                'Fraud signal must be an object.',
                'INVALID_FRAUD_SIGNAL'
            );
        }

        const type =
            this.mapSignalTypeToAlertType(
                signal.type
            );

        return this.createAlert(
            {

                tenantId:
                    context.tenantId,

                type,

                source:
                    this.mapSignalSource(
                        context.source ||
                        signal.source
                    ),

                sourceSignalId:
                    signal.id,

                accountId:
                    signal.accountId,

                relatedAccountId:
                    signal.relatedAccountId,

                riskScore:
                    signal.score,

                severity:
                    signal.severity,

                evidence:
                    signal.evidence,

                signalType:
                    signal.type,

                description:
                    this.buildSignalDescription(
                        signal
                    ),

                metadata:
                    {

                        originalSignal:
                            this.sanitizeSignal(
                                signal
                            )
                    }
            },
            context
        );
    }

    /**
     * =========================================================================
     * Create From Analyzer Result
     * =========================================================================
     */

    async createFromAnalysis(
        analysis,
        context = {}
    ) {

        if (
            !isObject(
                analysis
            )
        ) {

            throw new FraudAlertServiceError(
                'Fraud analysis result must be an object.',
                'INVALID_FRAUD_ANALYSIS'
            );
        }

        const signals =
            isArray(
                analysis.signals
            )
                ? analysis.signals
                : [];

        const results =
            [];

        for (
            const signal
            of signals
        ) {

            results.push(
                await this.createFromSignal(
                    signal,
                    {

                        ...context,

                        tenantId:
                            context.tenantId ||
                            analysis.tenantId,

                        source:
                            context.source ||
                            ALERT_SOURCE.FRAUD_CORRELATION_ENGINE
                    }
                )
            );
        }

        return {

            analysisId:
                analysis.analysisId ||
                null,

            tenantId:
                analysis.tenantId ||
                context.tenantId,

            created:
                results.length,

            alerts:
                results
        };
    }

    /**
     * =========================================================================
     * Input Normalization
     * =========================================================================
     */

    normalizeAlertInput(
        input,
        context
    ) {

        if (
            !isObject(
                input
            )
        ) {

            throw new FraudAlertServiceError(
                'Alert input must be an object.',
                'INVALID_ALERT_INPUT'
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

            throw new FraudAlertServiceError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }

        const riskScore =
            clamp(
                input.riskScore
            );

        const severity =
            this.normalizeSeverity(
                input.severity,
                riskScore
            );

        return {

            tenantId,

            type:
                this.normalizeType(
                    input.type
                ),

            source:
                this.normalizeSource(
                    input.source
                ),

            sourceSignalId:
                normalizeId(
                    input.sourceSignalId
                ),

            accountId:
                normalizeId(
                    input.accountId
                ),

            relatedAccountId:
                normalizeId(
                    input.relatedAccountId
                ),

            riskScore,

            severity,

            signalType:
                normalizeString(
                    input.signalType
                ),

            title:
                normalizeString(
                    input.title
                ),

            description:
                normalizeString(
                    input.description
                ),

            evidence:
                this.normalizeEvidence(
                    input.evidence
                ),

            relatedAccounts:
                this.normalizeIds(
                    input.relatedAccounts,
                    this.config.maxRelatedAccounts
                ),

            relatedTransactions:
                this.normalizeIds(
                    input.relatedTransactions,
                    this.config.maxRelatedTransactions
                ),

            tags:
                this.normalizeTags(
                    input.tags
                ),

            metadata:
                this.sanitizeMetadata(
                    input.metadata
                ),

            detectedAt:
                input.detectedAt ||
                now(),

            expiresAt:
                input.expiresAt ||
                null,

            assignedTo:
                normalizeId(
                    input.assignedTo
                ),

            assignedTeam:
                normalizeString(
                    input.assignedTeam
                ),

            priority:
                normalizeString(
                    input.priority
                ),

            correlationId:
                normalizeId(
                    input.correlationId
                ),

            requestId:
                normalizeId(
                    context.requestId ||
                    input.requestId
                )
        };
    }

    /**
     * =========================================================================
     * Alert Construction
     * =========================================================================
     */

    buildAlert(
        input,
        context
    ) {

        const id =
            crypto.randomUUID();

        const createdAt =
            now();

        const expiresAt =
            input.expiresAt ||
            this.calculateExpirationDate(
                input.severity,
                createdAt
            );

        const initialStatus =
            this.determineInitialStatus(
                input
            );

        return {

            id,

            schemaVersion:
                ALERT_SCHEMA_VERSION,

            module:
                MODULE_NAME,

            moduleVersion:
                MODULE_VERSION,

            tenantId:
                input.tenantId,

            type:
                input.type,

            source:
                input.source,

            sourceSignalId:
                input.sourceSignalId,

            fingerprint:
                input.fingerprint,

            accountId:
                input.accountId,

            relatedAccountId:
                input.relatedAccountId,

            relatedAccounts:
                input.relatedAccounts,

            relatedTransactions:
                input.relatedTransactions,

            signalType:
                input.signalType,

            riskScore:
                input.riskScore,

            severity:
                input.severity,

            status:
                initialStatus,

            title:
                input.title ||
                this.generateDefaultTitle(
                    input
                ),

            description:
                input.description ||
                this.generateDefaultDescription(
                    input
                ),

            evidence:
                input.evidence,

            tags:
                input.tags,

            priority:
                input.priority ||
                this.calculatePriority(
                    input
                ),

            assignedTo:
                input.assignedTo,

            assignedTeam:
                input.assignedTeam,

            correlationId:
                input.correlationId,

            requestId:
                input.requestId,

            detectedAt:
                input.detectedAt,

            createdAt,

            updatedAt:
                createdAt,

            expiresAt,

            acknowledgedAt:
                null,

            acknowledgedBy:
                null,

            escalatedAt:
                initialStatus ===
                ALERT_STATUS.ESCALATED
                    ? createdAt
                    : null,

            escalatedBy:
                initialStatus ===
                ALERT_STATUS.ESCALATED
                    ? 'SYSTEM'
                    : null,

            resolvedAt:
                null,

            resolvedBy:
                null,

            resolutionCode:
                null,

            resolutionNotes:
                null,

            metadata:
                {

                    ...input.metadata,

                    lifecycle:
                        {

                            createdBy:
                                context.actor?.id ||
                                context.actor?.userId ||
                                'SYSTEM',

                            creationReason:
                                input.source,

                            autoEscalated:
                                initialStatus ===
                                ALERT_STATUS.ESCALATED
                        }
                }
        };
    }

    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */

    async persistAlert(
        alert
    ) {

        if (
            !this.alertRepository
        ) {

            throw new FraudAlertServiceError(
                'Fraud alert repository is not configured.',
                'ALERT_REPOSITORY_NOT_CONFIGURED'
            );
        }

        if (
            typeof this.alertRepository.create !==
            'function'
        ) {

            throw new FraudAlertServiceError(
                'Fraud alert repository does not implement create().',
                'ALERT_REPOSITORY_INVALID'
            );
        }

        return this.alertRepository.create(
            alert
        );
    }

    /**
     * =========================================================================
     * Existing Alert / Deduplication
     * =========================================================================
     */

    async findExistingAlert(
        alert
    ) {

        if (
            !this.alertRepository
        ) {

            return null;
        }

        if (
            typeof this.alertRepository.findOpenByFingerprint ===
            'function'
        ) {

            return this.alertRepository.findOpenByFingerprint(
                alert.fingerprint,
                alert.tenantId
            );
        }

        if (
            typeof this.alertRepository.findByFingerprint !==
            'function'
        ) {

            return null;
        }

        const existing =
            await this.alertRepository.findByFingerprint(
                alert.fingerprint,
                alert.tenantId
            );

        if (
            !existing
        ) {

            return null;
        }

        if (
            this.isWithinDeduplicationWindow(
                existing.createdAt
            )
        ) {

            return existing;
        }

        return null;
    }

    isWithinDeduplicationWindow(
        createdAt
    ) {

        if (
            !createdAt
        ) {

            return false;
        }

        const created =
            Date.parse(
                createdAt
            );

        if (
            !Number.isFinite(
                created
            )
        ) {

            return false;
        }

        const elapsedMinutes =
            (
                Date.now() -
                created
            ) /
            60000;

        return (
            elapsedMinutes >= 0 &&
            elapsedMinutes <=
            this.config.deduplicationWindowMinutes
        );
    }

    async handleDuplicateAlert(
        existing,
        incoming,
        context
    ) {

        const existingRisk =
            clamp(
                existing.riskScore
            );

        const incomingRisk =
            clamp(
                incoming.riskScore
            );

        const highestRisk =
            Math.max(
                existingRisk,
                incomingRisk
            );

        const highestSeverity =
            this.normalizeSeverity(
                null,
                highestRisk
            );

        const patch = {

            updatedAt:
                now(),

            riskScore:
                highestRisk,

            severity:
                this.maxSeverity(
                    existing.severity,
                    highestSeverity
                ),

            metadata:
                {

                    ...(existing.metadata || {}),

                    deduplication:
                        {

                            ...(existing.metadata?.deduplication || {}),

                            duplicateCount:
                                safeNumber(
                                    existing.metadata?.deduplication?.duplicateCount
                                ) + 1,

                            lastDuplicateAt:
                                now(),

                            latestSourceSignalId:
                                incoming.sourceSignalId
                        }
                }
        };

        let updated =
            existing;

        if (
            this.alertRepository &&
            typeof this.alertRepository.update ===
            'function'
        ) {

            updated =
                await this.alertRepository.update(
                    existing.id,
                    existing.tenantId,
                    patch
                );
        }

        this.recordAudit(
            'FRAUD_ALERT_DEDUPLICATED',
            {

                alertId:
                    existing.id,

                tenantId:
                    existing.tenantId,

                incomingSignalId:
                    incoming.sourceSignalId,

                riskScore:
                    highestRisk
            },
            context.actor
        );

        return {

            ...updated,

            deduplicated:
                true
        };
    }

    /**
     * =========================================================================
     * Fingerprinting
     * =========================================================================
     */

    generateFingerprint(
        input
    ) {

        const components = [

            input.tenantId,

            input.type,

            input.signalType,

            input.accountId,

            input.relatedAccountId,

            input.source,

            input.sourceSignalId
        ];

        /*
         * Do not rely solely on sourceSignalId because different detectors
         * may produce semantically identical findings.
         */

        if (
            input.evidence
        ) {

            components.push(
                this.extractStableEvidenceKey(
                    input.evidence
                )
            );
        }

        const payload =
            components
                .map(
                    value =>
                        value === null ||
                        value === undefined
                            ? ''
                            : String(
                                value
                            )
                )
                .join(
                    '|'
                );

        return crypto
            .createHash(
                this.config.fingerprintAlgorithm
            )
            .update(
                payload
            )
            .digest(
                'hex'
            );
    }

    extractStableEvidenceKey(
        evidence
    ) {

        if (
            !isObject(
                evidence
            )
        ) {

            return '';
        }

        const stable = {

            transactionCount:
                evidence.transactionCount,

            cycleLength:
                evidence.cycleLength,

            counterpartyId:
                evidence.counterpartyId,

            concentration:
                evidence.concentration,

            attribute:
                evidence.attribute,

            relatedAccountCount:
                evidence.relatedAccountCount
        };

        return JSON.stringify(
            stable
        );
    }

    /**
     * =========================================================================
     * Severity
     * =========================================================================
     */

    normalizeSeverity(
        severity,
        riskScore
    ) {

        const normalized =
            normalizeString(
                severity
            )?.toUpperCase();

        if (
            normalized &&
            Object.values(
                ALERT_SEVERITY
            ).includes(
                normalized
            )
        ) {

            return normalized;
        }

        const score =
            clamp(
                riskScore
            );

        if (
            score >=
            this.config.criticalThreshold
        ) {

            return ALERT_SEVERITY.CRITICAL;
        }

        if (
            score >=
            this.config.highThreshold
        ) {

            return ALERT_SEVERITY.HIGH;
        }

        if (
            score >=
            this.config.mediumThreshold
        ) {

            return ALERT_SEVERITY.MEDIUM;
        }

        return ALERT_SEVERITY.LOW;
    }

    maxSeverity(
        first,
        second
    ) {

        const ranking = {

            [ALERT_SEVERITY.LOW]:
                1,

            [ALERT_SEVERITY.MEDIUM]:
                2,

            [ALERT_SEVERITY.HIGH]:
                3,

            [ALERT_SEVERITY.CRITICAL]:
                4
        };

        return (
            ranking[
                second
            ] >
            ranking[
                first
            ]
        )
            ? second
            : first;
    }

    /**
     * =========================================================================
     * Initial State
     * =========================================================================
     */

    determineInitialStatus(
        input
    ) {

        if (
            input.severity ===
            ALERT_SEVERITY.CRITICAL &&
            this.config.autoEscalateCritical
        ) {

            return ALERT_STATUS.ESCALATED;
        }

        if (
            input.riskScore >=
            this.config.autoEscalateThreshold
        ) {

            return ALERT_STATUS.ESCALATED;
        }

        return ALERT_STATUS.OPEN;
    }

    /**
     * =========================================================================
     * Titles / Descriptions
     * =========================================================================
     */

    generateDefaultTitle(
        input
    ) {

        const type =
            String(
                input.type
            )
                .replace(
                    /_/g,
                    ' '
                );

        return (
            `${type} fraud-risk alert`
        );
    }

    generateDefaultDescription(
        input
    ) {

        const score =
            round(
                input.riskScore,
                4
            );

        return (
            `A ${input.type} signal was generated with a risk score of ${score}. ` +
            `The alert requires appropriate investigation and policy evaluation.`
        );
    }

    buildSignalDescription(
        signal
    ) {

        const type =
            normalizeString(
                signal.type
            ) ||
            'UNKNOWN';

        const severity =
            normalizeString(
                signal.severity
            ) ||
            'UNKNOWN';

        return (
            `Cross-account fraud intelligence signal ${type} ` +
            `was detected with severity ${severity}.`
        );
    }

    /**
     * =========================================================================
     * Priority
     * =========================================================================
     */

    calculatePriority(
        input
    ) {

        if (
            input.severity ===
            ALERT_SEVERITY.CRITICAL
        ) {

            return 'P0';
        }

        if (
            input.severity ===
            ALERT_SEVERITY.HIGH
        ) {

            return 'P1';
        }

        if (
            input.severity ===
            ALERT_SEVERITY.MEDIUM
        ) {

            return 'P2';
        }

        return 'P3';
    }

    /**
     * =========================================================================
     * Evidence Normalization
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

        if (
            isArray(
                evidence
            )
        ) {

            return {

                items:
                    evidence
                        .slice(
                            0,
                            this.config.maxEvidenceItems
                        )
                        .map(
                            item =>
                                this.sanitizeEvidenceItem(
                                    item
                                )
                        )
            };
        }

        if (
            isObject(
                evidence
            )
        ) {

            const result =
                {};

            for (
                const [
                    key,
                    value
                ]
                of Object.entries(
                    evidence
                )
            ) {

                if (
                    key ===
                    'accounts' &&
                    isArray(
                        value
                    )
                ) {

                    result[key] =
                        value.slice(
                            0,
                            this.config.maxRelatedAccounts
                        );

                    continue;
                }

                if (
                    key ===
                    'transactions' &&
                    isArray(
                        value
                    )
                ) {

                    result[key] =
                        value.slice(
                            0,
                            this.config.maxRelatedTransactions
                        );

                    continue;
                }

                result[key] =
                    this.sanitizeEvidenceItem(
                        value
                    );
            }

            return result;
        }

        return {

            value:
                this.sanitizeEvidenceItem(
                    evidence
                )
        };
    }

    sanitizeEvidenceItem(
        value
    ) {

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

            if (
                value.length >
                2000
            ) {

                return value.slice(
                    0,
                    2000
                );
            }

            return value;
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
                    this.config.maxEvidenceItems
                )
                .map(
                    item =>
                        this.sanitizeEvidenceItem(
                            item
                        )
                );
        }

        if (
            isObject(
                value
            )
        ) {

            const output =
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

                output[key] =
                    this.sanitizeEvidenceItem(
                        nestedValue
                    );
            }

            return output;
        }

        return String(
            value
        );
    }

    /**
     * =========================================================================
     * Metadata Sanitization
     * =========================================================================
     */

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

        return this.sanitizeEvidenceItem(
            metadata
        );
    }

    sanitizeSignal(
        signal
    ) {

        if (
            !isObject(
                signal
            )
        ) {

            return null;
        }

        return {

            id:
                normalizeId(
                    signal.id
                ),

            type:
                normalizeString(
                    signal.type
                ),

            score:
                clamp(
                    signal.score
                ),

            severity:
                normalizeString(
                    signal.severity
                ),

            accountId:
                normalizeId(
                    signal.accountId
                ),

            relatedAccountId:
                normalizeId(
                    signal.relatedAccountId
                ),

            evidence:
                this.normalizeEvidence(
                    signal.evidence
                )
        };
    }

    normalizeIds(
        values,
        maximum
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
                        normalizeId(
                            value
                        )
                )
        )
            .slice(
                0,
                maximum
            );
    }

    normalizeTags(
        tags
    ) {

        if (
            !isArray(
                tags
            )
        ) {

            return [];
        }

        return unique(
            tags
                .map(
                    tag =>
                        normalizeString(
                            tag
                        )?.toUpperCase()
                )
        )
            .slice(
                0,
                this.config.maxTags
            );
    }

    /**
     * =========================================================================
     * Type / Source Mapping
     * =========================================================================
     */

    normalizeType(
        type
    ) {

        const normalized =
            normalizeString(
                type
            )?.toUpperCase();

        if (
            normalized &&
            Object.values(
                ALERT_TYPE
            ).includes(
                normalized
            )
        ) {

            return normalized;
        }

        return ALERT_TYPE.SYSTEM;
    }

    normalizeSource(
        source
    ) {

        const normalized =
            normalizeString(
                source
            )?.toUpperCase();

        if (
            normalized &&
            Object.values(
                ALERT_SOURCE
            ).includes(
                normalized
            )
        ) {

            return normalized;
        }

        return ALERT_SOURCE.SYSTEM;
    }

    mapSignalTypeToAlertType(
        signalType
    ) {

        const mapping = {

            CIRCULAR_MOVEMENT:
                ALERT_TYPE.CIRCULAR_MOVEMENT,

            RAPID_FUND_MOVEMENT:
                ALERT_TYPE.RAPID_FUND_MOVEMENT,

            HIGH_VELOCITY:
                ALERT_TYPE.TRANSACTION_ANOMALY,

            FAN_IN:
                ALERT_TYPE.FAN_IN,

            RAPID_FAN_IN:
                ALERT_TYPE.FAN_IN,

            FAN_OUT:
                ALERT_TYPE.FAN_OUT,

            RAPID_FAN_OUT:
                ALERT_TYPE.FAN_OUT,

            SHARED_COUNTERPARTY:
                ALERT_TYPE.SHARED_COUNTERPARTY,

            SHARED_DEVICE:
                ALERT_TYPE.SHARED_DEVICE,

            COORDINATED_ACTIVITY:
                ALERT_TYPE.COORDINATED_ACTIVITY,

            NETWORK_CLUSTER:
                ALERT_TYPE.NETWORK_CLUSTER,

            HIGH_CONCENTRATION:
                ALERT_TYPE.HIGH_CONCENTRATION
        };

        return (
            mapping[
                signalType
            ] ||
            ALERT_TYPE.CROSS_ACCOUNT
        );
    }

    mapSignalSource(
        source
    ) {

        const normalized =
            normalizeString(
                source
            )?.toUpperCase();

        if (
            normalized
        ) {

            return normalized;
        }

        return ALERT_SOURCE.CROSS_ACCOUNT_ANALYZER;
    }

    /**
     * =========================================================================
     * Lifecycle — Acknowledge
     * =========================================================================
     */

    async acknowledgeAlert(
        alertId,
        tenantId,
        actor = {},
        metadata = {}
    ) {

        const alert =
            await this.requireAlert(
                alertId,
                tenantId
            );

        this.assertTransitionAllowed(
            alert.status,
            ALERT_STATUS.ACKNOWLEDGED
        );

        const timestamp =
            now();

        const patch = {

            status:
                ALERT_STATUS.ACKNOWLEDGED,

            acknowledgedAt:
                timestamp,

            acknowledgedBy:
                this.actorId(
                    actor
                ),

            updatedAt:
                timestamp,

            metadata:
                this.appendLifecycleMetadata(
                    alert,
                    {

                        event:
                            'ACKNOWLEDGED',

                        actor:
                            this.actorId(
                                actor
                            ),

                        metadata
                    }
                )
        };

        const updated =
            await this.updateAlert(
                alert,
                patch
            );

        this.recordAudit(
            'FRAUD_ALERT_ACKNOWLEDGED',
            {

                alertId,

                tenantId,

                actor:
                    this.actorId(
                        actor
                    )
            },
            actor
        );

        return updated;
    }

    /**
     * =========================================================================
     * Lifecycle — Start Investigation
     * =========================================================================
     */

    async startInvestigation(
        alertId,
        tenantId,
        actor = {},
        metadata = {}
    ) {

        const alert =
            await this.requireAlert(
                alertId,
                tenantId
            );

        this.assertTransitionAllowed(
            alert.status,
            ALERT_STATUS.INVESTIGATING
        );

        const updated =
            await this.updateAlert(
                alert,
                {

                    status:
                        ALERT_STATUS.INVESTIGATING,

                    updatedAt:
                        now(),

                    metadata:
                        this.appendLifecycleMetadata(
                            alert,
                            {

                                event:
                                    'INVESTIGATION_STARTED',

                                actor:
                                    this.actorId(
                                        actor
                                    ),

                                metadata
                            }
                        )
                }
            );

        this.recordAudit(
            'FRAUD_ALERT_INVESTIGATION_STARTED',
            {

                alertId,

                tenantId,

                actor:
                    this.actorId(
                        actor
                    )
            },
            actor
        );

        return updated;
    }

    /**
     * =========================================================================
     * Lifecycle — Assign
     * =========================================================================
     */

    async assignAlert(
        alertId,
        tenantId,
        assignment = {},
        actor = {}
    ) {

        const alert =
            await this.requireAlert(
                alertId,
                tenantId
            );

        const assignedTo =
            normalizeId(
                assignment.assignedTo
            );

        const assignedTeam =
            normalizeString(
                assignment.assignedTeam
            );

        if (
            !assignedTo &&
            !assignedTeam
        ) {

            throw new FraudAlertServiceError(
                'assignedTo or assignedTeam is required.',
                'ASSIGNMENT_TARGET_REQUIRED'
            );
        }

        let status =
            alert.status;

        if (
            this.config.autoAcknowledgeOnAssignment &&
            status ===
            ALERT_STATUS.OPEN
        ) {

            status =
                ALERT_STATUS.ACKNOWLEDGED;
        }

        const updated =
            await this.updateAlert(
                alert,
                {

                    assignedTo,

                    assignedTeam,

                    status,

                    updatedAt:
                        now(),

                    acknowledgedAt:
                        status ===
                        ALERT_STATUS.ACKNOWLEDGED &&
                        !alert.acknowledgedAt
                            ? now()
                            : alert.acknowledgedAt,

                    acknowledgedBy:
                        status ===
                        ALERT_STATUS.ACKNOWLEDGED &&
                        !alert.acknowledgedBy
                            ? this.actorId(
                                actor
                            )
                            : alert.acknowledgedBy,

                    metadata:
                        this.appendLifecycleMetadata(
                            alert,
                            {

                                event:
                                    'ASSIGNED',

                                actor:
                                    this.actorId(
                                        actor
                                    ),

                                metadata:
                                    assignment
                            }
                        )
                }
            );

        this.recordAudit(
            'FRAUD_ALERT_ASSIGNED',
            {

                alertId,

                tenantId,

                assignedTo,

                assignedTeam
            },
            actor
        );

        return updated;
    }

    /**
     * =========================================================================
     * Lifecycle — Escalate
     * =========================================================================
     */

    async escalateAlert(
        alertId,
        tenantId,
        actor = {},
        reason = null
    ) {

        const alert =
            await this.requireAlert(
                alertId,
                tenantId
            );

        if (
            [
                ALERT_STATUS.RESOLVED,
                ALERT_STATUS.DISMISSED,
                ALERT_STATUS.FALSE_POSITIVE
            ].includes(
                alert.status
            )
        ) {

            throw new FraudAlertServiceError(
                'Resolved alerts cannot be escalated.',
                'INVALID_ESCALATION_STATE'
            );
        }

        const timestamp =
            now();

        const updated =
            await this.updateAlert(
                alert,
                {

                    status:
                        ALERT_STATUS.ESCALATED,

                    severity:
                        this.maxSeverity(
                            alert.severity,
                            ALERT_SEVERITY.HIGH
                        ),

                    escalatedAt:
                        timestamp,

                    escalatedBy:
                        this.actorId(
                            actor
                        ),

                    updatedAt:
                        timestamp,

                    metadata:
                        this.appendLifecycleMetadata(
                            alert,
                            {

                                event:
                                    'ESCALATED',

                                actor:
                                    this.actorId(
                                        actor
                                    ),

                                reason
                            }
                        )
                }
            );

        await this.notifyEscalation(
            updated,
            {

                actor,

                reason
            }
        );

        this.recordAudit(
            'FRAUD_ALERT_ESCALATED',
            {

                alertId,

                tenantId,

                reason
            },
            actor
        );

        return updated;
    }

    /**
     * =========================================================================
     * Lifecycle — Resolve
     * =========================================================================
     */

    async resolveAlert(
        alertId,
        tenantId,
        resolution = {},
        actor = {}
    ) {

        const alert =
            await this.requireAlert(
                alertId,
                tenantId
            );

        if (
            [
                ALERT_STATUS.RESOLVED,
                ALERT_STATUS.DISMISSED,
                ALERT_STATUS.FALSE_POSITIVE
            ].includes(
                alert.status
            )
        ) {

            throw new FraudAlertServiceError(
                'Alert is already closed.',
                'ALERT_ALREADY_CLOSED'
            );
        }

        const resolutionCode =
            normalizeString(
                resolution.resolutionCode
            )?.toUpperCase();

        if (
            !resolutionCode
        ) {

            throw new FraudAlertServiceError(
                'resolutionCode is required.',
                'RESOLUTION_CODE_REQUIRED'
            );
        }

        if (
            !Object.values(
                RESOLUTION_CODE
            ).includes(
                resolutionCode
            )
        ) {

            throw new FraudAlertServiceError(
                'Invalid resolution code.',
                'INVALID_RESOLUTION_CODE',
                {

                    resolutionCode
                }
            );
        }

        const status =
            resolutionCode ===
            RESOLUTION_CODE.FALSE_POSITIVE
                ? ALERT_STATUS.FALSE_POSITIVE
                : resolutionCode ===
                  RESOLUTION_CODE.DUPLICATE
                    ? ALERT_STATUS.DISMISSED
                    : ALERT_STATUS.RESOLVED;

        if (
            status ===
            ALERT_STATUS.DISMISSED &&
            alert.severity ===
            ALERT_SEVERITY.CRITICAL &&
            !this.config.allowCriticalDismissal
        ) {

            throw new FraudAlertServiceError(
                'Critical alerts cannot be dismissed by default.',
                'CRITICAL_DISMISSAL_NOT_ALLOWED'
            );
        }

        const timestamp =
            now();

        const updated =
            await this.updateAlert(
                alert,
                {

                    status,

                    resolvedAt:
                        timestamp,

                    resolvedBy:
                        this.actorId(
                            actor
                        ),

                    resolutionCode,

                    resolutionNotes:
                        normalizeString(
                            resolution.notes
                        ),

                    updatedAt:
                        timestamp,

                    metadata:
                        this.appendLifecycleMetadata(
                            alert,
                            {

                                event:
                                    'RESOLVED',

                                actor:
                                    this.actorId(
                                        actor
                                    ),

                                resolutionCode,

                                notes:
                                    resolution.notes
                            }
                        )
                }
            );

        this.recordAudit(
            'FRAUD_ALERT_RESOLVED',
            {

                alertId,

                tenantId,

                resolutionCode,

                status
            },
            actor
        );

        this.recordMetric(
            'fraud_alert_resolved',
            {

                tenantId,

                resolutionCode,

                status
            }
        );

        return updated;
    }

    /**
     * =========================================================================
     * Lifecycle — Dismiss
     * =========================================================================
     */

    async dismissAlert(
        alertId,
        tenantId,
        actor = {},
        reason = null
    ) {

        return this.resolveAlert(
            alertId,
            tenantId,
            {

                resolutionCode:
                    RESOLUTION_CODE.FALSE_POSITIVE,

                notes:
                    reason
            },
            actor
        );
    }

    /**
     * =========================================================================
     * Generic Update
     * =========================================================================
     */

    async updateAlert(
        alert,
        patch
    ) {

        if (
            !this.alertRepository ||
            typeof this.alertRepository.update !==
            'function'
        ) {

            throw new FraudAlertServiceError(
                'Fraud alert repository does not implement update().',
                'ALERT_UPDATE_UNAVAILABLE'
            );
        }

        const safePatch =
            this.sanitizeUpdatePatch(
                patch
            );

        return this.alertRepository.update(
            alert.id,
            alert.tenantId,
            safePatch
        );
    }

    sanitizeUpdatePatch(
        patch
    ) {

        if (
            !isObject(
                patch
            )
        ) {

            return {};
        }

        const allowed = [

            'status',

            'severity',

            'riskScore',

            'title',

            'description',

            'assignedTo',

            'assignedTeam',

            'priority',

            'acknowledgedAt',

            'acknowledgedBy',

            'escalatedAt',

            'escalatedBy',

            'resolvedAt',

            'resolvedBy',

            'resolutionCode',

            'resolutionNotes',

            'updatedAt',

            'metadata'
        ];

        const sanitized =
            {};

        for (
            const key
            of allowed
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    patch,
                    key
                )
            ) {

                sanitized[key] =
                    patch[key];
            }
        }

        if (
            Object.prototype.hasOwnProperty.call(
                sanitized,
                'riskScore'
            )
        ) {

            sanitized.riskScore =
                clamp(
                    sanitized.riskScore
                );
        }

        return sanitized;
    }

    /**
     * =========================================================================
     * Alert Retrieval
     * =========================================================================
     */

    async getAlert(
        alertId,
        tenantId
    ) {

        return this.requireAlert(
            alertId,
            tenantId
        );
    }

    async requireAlert(
        alertId,
        tenantId
    ) {

        const normalizedAlertId =
            normalizeId(
                alertId
            );

        const normalizedTenantId =
            normalizeId(
                tenantId
            );

        if (
            !normalizedAlertId
        ) {

            throw new FraudAlertServiceError(
                'alertId is required.',
                'ALERT_ID_REQUIRED'
            );
        }

        if (
            this.config.requireTenantId &&
            !normalizedTenantId
        ) {

            throw new FraudAlertServiceError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }

        if (
            !this.alertRepository ||
            typeof this.alertRepository.findById !==
            'function'
        ) {

            throw new FraudAlertServiceError(
                'Fraud alert repository does not implement findById().',
                'ALERT_REPOSITORY_READ_UNAVAILABLE'
            );
        }

        const alert =
            await this.alertRepository.findById(
                normalizedAlertId,
                normalizedTenantId
            );

        if (
            !alert
        ) {

            throw new FraudAlertServiceError(
                'Fraud alert not found.',
                'ALERT_NOT_FOUND',
                {

                    alertId:
                        normalizedAlertId,

                    tenantId:
                        normalizedTenantId
                }
            );
        }

        if (
            this.config.requireTenantId &&
            normalizeId(
                alert.tenantId
            ) !==
            normalizedTenantId
        ) {

            throw new FraudAlertServiceError(
                'Fraud alert does not belong to the requested tenant.',
                'TENANT_ISOLATION_VIOLATION'
            );
        }

        return alert;
    }

    /**
     * =========================================================================
     * Alert Listing
     * =========================================================================
     */

    async listAlerts(
        filter = {},
        options = {}
    ) {

        const tenantId =
            normalizeId(
                filter.tenantId ||
                options.tenantId
            );

        if (
            this.config.requireTenantId &&
            !tenantId
        ) {

            throw new FraudAlertServiceError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }

        if (
            !this.alertRepository ||
            typeof this.alertRepository.list !==
            'function'
        ) {

            throw new FraudAlertServiceError(
                'Fraud alert repository does not implement list().',
                'ALERT_LIST_UNAVAILABLE'
            );
        }

        const normalizedFilter =
            this.normalizeListFilter(
                {

                    ...filter,

                    tenantId
                }
            );

        return this.alertRepository.list(
            normalizedFilter,
            this.normalizePagination(
                options
            )
        );
    }

    normalizeListFilter(
        filter
    ) {

        return {

            tenantId:
                normalizeId(
                    filter.tenantId
                ),

            status:
                filter.status
                    ? normalizeString(
                        filter.status
                    )?.toUpperCase()
                    : undefined,

            severity:
                filter.severity
                    ? normalizeString(
                        filter.severity
                    )?.toUpperCase()
                    : undefined,

            type:
                filter.type
                    ? normalizeString(
                        filter.type
                    )?.toUpperCase()
                    : undefined,

            source:
                filter.source
                    ? normalizeString(
                        filter.source
                    )?.toUpperCase()
                    : undefined,

            accountId:
                normalizeId(
                    filter.accountId
                ),

            assignedTo:
                normalizeId(
                    filter.assignedTo
                ),

            assignedTeam:
                normalizeString(
                    filter.assignedTeam
                ),

            correlationId:
                normalizeId(
                    filter.correlationId
                ),

            fingerprint:
                normalizeString(
                    filter.fingerprint
                ),

            minRiskScore:
                filter.minRiskScore !== undefined
                    ? clamp(
                        filter.minRiskScore
                    )
                    : undefined,

            maxRiskScore:
                filter.maxRiskScore !== undefined
                    ? clamp(
                        filter.maxRiskScore
                    )
                    : undefined,

            from:
                filter.from || undefined,

            to:
                filter.to || undefined
        };
    }

    normalizePagination(
        options
    ) {

        const page =
            Math.max(
                1,
                parseInt(
                    options.page,
                    10
                ) ||
                1
            );

        const limit =
            Math.min(
                500,
                Math.max(
                    1,
                    parseInt(
                        options.limit,
                        10
                    ) ||
                    50
                )
            );

        return {

            page,

            limit,

            sort:
                options.sort ||
                {

                    createdAt:
                        -1
                }
        };
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    async getStatistics(
        tenantId,
        filter = {}
    ) {

        const normalizedTenantId =
            normalizeId(
                tenantId
            );

        if (
            this.config.requireTenantId &&
            !normalizedTenantId
        ) {

            throw new FraudAlertServiceError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }

        const normalizedFilter =
            this.normalizeListFilter(
                {

                    ...filter,

                    tenantId:
                        normalizedTenantId
                }
            );

        if (
            this.alertRepository &&
            typeof this.alertRepository.statistics ===
            'function'
        ) {

            return this.alertRepository.statistics(
                normalizedFilter
            );
        }

        if (
            !this.alertRepository ||
            typeof this.alertRepository.list !==
            'function'
        ) {

            throw new FraudAlertServiceError(
                'Alert statistics repository operation is unavailable.',
                'ALERT_STATISTICS_UNAVAILABLE'
            );
        }

        const result =
            await this.alertRepository.list(
                normalizedFilter,
                {

                    page:
                        1,

                    limit:
                        500
                }
            );

        const alerts =
            isArray(
                result
            )
                ? result
                : result?.items || [];

        return this.calculateStatistics(
            alerts
        );
    }

    calculateStatistics(
        alerts
    ) {

        const statistics = {

            total:
                alerts.length,

            byStatus: {},

            bySeverity: {},

            byType: {},

            averageRiskScore:
                0,

            critical:
                0,

            high:
                0,

            open:
                0,

            escalated:
                0,

            resolved:
                0
        };

        let riskTotal =
            0;

        for (
            const alert
            of alerts
        ) {

            const status =
                alert.status ||
                'UNKNOWN';

            const severity =
                alert.severity ||
                'UNKNOWN';

            const type =
                alert.type ||
                'UNKNOWN';

            statistics.byStatus[
                status
            ] =
                (
                    statistics.byStatus[
                        status
                    ] ||
                    0
                ) + 1;

            statistics.bySeverity[
                severity
            ] =
                (
                    statistics.bySeverity[
                        severity
                    ] ||
                    0
                ) + 1;

            statistics.byType[
                type
            ] =
                (
                    statistics.byType[
                        type
                    ] ||
                    0
                ) + 1;

            riskTotal +=
                safeNumber(
                    alert.riskScore
                );

            if (
                severity ===
                ALERT_SEVERITY.CRITICAL
            ) {

                statistics.critical++;
            }

            if (
                severity ===
                ALERT_SEVERITY.HIGH
            ) {

                statistics.high++;
            }

            if (
                status ===
                ALERT_STATUS.OPEN
            ) {

                statistics.open++;
            }

            if (
                status ===
                ALERT_STATUS.ESCALATED
            ) {

                statistics.escalated++;
            }

            if (
                status ===
                ALERT_STATUS.RESOLVED
            ) {

                statistics.resolved++;
            }
        }

        statistics.averageRiskScore =
            alerts.length
                ? round(
                    riskTotal /
                    alerts.length
                )
                : 0;

        return statistics;
    }

    /**
     * =========================================================================
     * Lifecycle Validation
     * =========================================================================
     */

    assertTransitionAllowed(
        currentStatus,
        nextStatus
    ) {

        const transitions = {

            [ALERT_STATUS.OPEN]: [

                ALERT_STATUS.ACKNOWLEDGED,

                ALERT_STATUS.INVESTIGATING,

                ALERT_STATUS.ESCALATED,

                ALERT_STATUS.RESOLVED,

                ALERT_STATUS.DISMISSED,

                ALERT_STATUS.FALSE_POSITIVE
            ],

            [ALERT_STATUS.ACKNOWLEDGED]: [

                ALERT_STATUS.INVESTIGATING,

                ALERT_STATUS.ESCALATED,

                ALERT_STATUS.RESOLVED,

                ALERT_STATUS.DISMISSED,

                ALERT_STATUS.FALSE_POSITIVE
            ],

            [ALERT_STATUS.INVESTIGATING]: [

                ALERT_STATUS.ESCALATED,

                ALERT_STATUS.RESOLVED,

                ALERT_STATUS.DISMISSED,

                ALERT_STATUS.FALSE_POSITIVE
            ],

            [ALERT_STATUS.ESCALATED]: [

                ALERT_STATUS.INVESTIGATING,

                ALERT_STATUS.RESOLVED,

                ALERT_STATUS.DISMISSED,

                ALERT_STATUS.FALSE_POSITIVE
            ],

            [ALERT_STATUS.RESOLVED]: [],

            [ALERT_STATUS.DISMISSED]: [],

            [ALERT_STATUS.FALSE_POSITIVE]: []
        };

        const allowed =
            transitions[
                currentStatus
            ] ||
            [];

        if (
            !allowed.includes(
                nextStatus
            )
        ) {

            throw new FraudAlertServiceError(
                `Invalid alert status transition: ${currentStatus} -> ${nextStatus}.`,
                'INVALID_ALERT_STATE_TRANSITION',
                {

                    currentStatus,

                    nextStatus
                }
            );
        }
    }

    /**
     * =========================================================================
     * Lifecycle Metadata
     * =========================================================================
     */

    appendLifecycleMetadata(
        alert,
        event
    ) {

        const lifecycle =
            isArray(
                alert.metadata?.lifecycleHistory
            )
                ? [
                    ...alert.metadata.lifecycleHistory
                ]
                : [];

        lifecycle.push(
            {

                timestamp:
                    now(),

                ...event
            }
        );

        return {

            ...(alert.metadata || {}),

            lifecycleHistory:
                lifecycle.slice(
                    -100
                )
        };
    }

    /**
     * =========================================================================
     * Expiration
     * =========================================================================
     */

    calculateExpirationDate(
        severity,
        createdAt
    ) {

        let days =
            this.config.defaultExpirationDays;

        switch (
            severity
        ) {

            case ALERT_SEVERITY.CRITICAL:

                days =
                    this.config.criticalExpirationDays;

                break;

            case ALERT_SEVERITY.HIGH:

                days =
                    this.config.highExpirationDays;

                break;

            case ALERT_SEVERITY.MEDIUM:

                days =
                    this.config.mediumExpirationDays;

                break;

            case ALERT_SEVERITY.LOW:

                days =
                    this.config.lowExpirationDays;

                break;

            default:
                break;
        }

        return addDays(
            createdAt,
            days
        );
    }

    /**
     * =========================================================================
     * Notification Hooks
     * =========================================================================
     */

    async afterAlertCreated(
        alert,
        context
    ) {

        if (
            !this.config.enableNotifications
        ) {

            return;
        }

        if (
            !this.notificationService
        ) {

            return;
        }

        try {

            if (
                typeof this.notificationService.notifyFraudAlert ===
                'function'
            ) {

                await this.notificationService.notifyFraudAlert(
                    alert,
                    {

                        event:
                            'CREATED',

                        tenantId:
                            alert.tenantId,

                        context
                    }
                );
            }

        } catch (
            error
        ) {

            /*
             * Notification failure must not invalidate a persisted alert.
             */

            this.log(
                'error',
                'Fraud alert notification failed.',
                {

                    alertId:
                        alert.id,

                    error:
                        error.message
                }
            );

            this.recordMetric(
                'fraud_alert_notification_failure',
                {

                    alertId:
                        alert.id
                }
            );
        }
    }

    async notifyEscalation(
        alert,
        context
    ) {

        if (
            !this.notificationService
        ) {

            return;
        }

        try {

            if (
                typeof this.notificationService.notifyFraudAlertEscalation ===
                'function'
            ) {

                await this.notificationService.notifyFraudAlertEscalation(
                    alert,
                    context
                );
            }

        } catch (
            error
        ) {

            this.log(
                'error',
                'Fraud alert escalation notification failed.',
                {

                    alertId:
                        alert.id,

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

        if (
            !this.config.enableAudit
        ) {

            return;
        }

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
                    this.actorId(
                        actor
                    ),

                type:
                    actor?.type ||
                    'SYSTEM'
            },

            data
        };

        try {

            if (
                this.auditLogger &&
                typeof this.auditLogger.record ===
                'function'
            ) {

                this.auditLogger.record(
                    record
                );
            }

        } catch (
            error
        ) {

            this.log(
                'warn',
                'Fraud alert audit logging failed.',
                {

                    event,

                    error:
                        error.message
                }
            );
        }

        return record;
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    recordMetric(
        name,
        metadata = {}
    ) {

        if (
            !this.config.enableMetrics ||
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
                    metadata
                );
            }

        } catch (
            error
        ) {

            this.log(
                'warn',
                'Fraud alert metrics recording failed.',
                {

                    metric:
                        name,

                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * Actor
     * =========================================================================
     */

    actorId(
        actor
    ) {

        if (
            !actor
        ) {

            return 'SYSTEM';
        }

        return (
            normalizeId(
                actor.id
            ) ||
            normalizeId(
                actor.userId
            ) ||
            normalizeId(
                actor.serviceId
            ) ||
            'SYSTEM'
        );
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async healthCheck() {

        const repositoryAvailable =
            Boolean(
                this.alertRepository
            );

        let repositoryHealthy =
            repositoryAvailable;

        if (
            repositoryAvailable &&
            typeof this.alertRepository.healthCheck ===
            'function'
        ) {

            try {

                const result =
                    await this.alertRepository.healthCheck();

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
                ALERT_SCHEMA_VERSION,

            repository:
                repositoryHealthy,

            notifications:
                Boolean(
                    this.notificationService
                ),

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
                ALERT_SCHEMA_VERSION,

            capabilities: [

                'fraud-alert-creation',

                'fraud-signal-ingestion',

                'analysis-result-ingestion',

                'alert-deduplication',

                'idempotent-fingerprinting',

                'severity-normalization',

                'risk-scoring',

                'alert-lifecycle',

                'acknowledgement',

                'investigation-state',

                'assignment',

                'escalation',

                'resolution',

                'false-positive-management',

                'alert-statistics',

                'tenant-isolation',

                'audit-hooks',

                'metrics-hooks',

                'notification-hooks',

                'evidence-preservation'
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

                createsInvestigativeAlerts:
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

function createFraudAlertService(
    options = {}
) {

    return new FraudAlertService(
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

    ALERT_SCHEMA_VERSION,

    ALERT_STATUS,

    ALERT_SEVERITY,

    ALERT_TYPE,

    ALERT_SOURCE,

    RESOLUTION_CODE,

    DEFAULT_CONFIG,

    FraudAlertService,

    FraudAlertServiceError,

    createFraudAlertService
};