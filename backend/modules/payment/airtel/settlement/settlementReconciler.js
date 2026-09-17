'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Settlement Reconciler
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/settlement/settlementReconciler.js
 *
 * Architectural Role
 * ------------------
 * Authoritative comparison engine for Airtel settlement evidence against the
 * platform's internal financial/payment records.
 *
 * This module determines whether provider and internal evidence agree. It
 * produces reconciliation evidence and exceptions; it does NOT perform
 * financial mutation.
 *
 * Responsibilities
 * ----------------
 * • Settlement reconciliation orchestration.
 * • Tenant-scoped evidence loading.
 * • Provider-vs-internal record matching.
 * • Missing provider detection.
 * • Missing ledger/internal-record detection.
 * • Amount variance detection.
 * • Currency mismatch detection.
 * • Provider/internal duplicate detection.
 * • Reference validation.
 * • Deterministic reconciliation result generation.
 * • Reconciliation-result persistence delegation.
 * • Safe event publication.
 * • Audit integration.
 * • Metrics and tracing.
 *
 * NOT Responsible For
 * -------------------
 * • Calling Airtel settlement APIs.
 * • Initiating payments.
 * • Posting ledger entries.
 * • Mutating wallet/account balances.
 * • Changing payment/settlement state directly.
 * • Callback processing.
 * • Payment authorization.
 * • Automatic financial repair.
 *
 * Financial Safety Principles
 * ---------------------------
 * • Monetary comparison never uses JavaScript floating-point subtraction.
 * • Reconciliation evidence is not financial posting.
 * • A variance must never be silently converted into a match.
 * • Duplicate references are explicitly surfaced.
 * • Tenant filtering is applied to every repository lookup.
 * • Provider records are treated as untrusted external evidence.
 * • Reconciliation results should be persisted before being consumed by
 *   settlement automation.
 * • Repair is delegated to an explicit downstream repair/review workflow.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError
} = require('../../shared/errors');


const PROVIDER = 'AIRTEL';

const DEFAULT_TOLERANCE = '0.00';

const DEFAULT_CURRENCY_SCALE = 2;

const MAX_EXCEPTION_ITEMS = 10_000;

const RESULT_STATUS = Object.freeze({
    MATCHED:
        'MATCHED',

    VARIANCE:
        'VARIANCE',

    MISSING_PROVIDER:
        'MISSING_PROVIDER',

    MISSING_LEDGER:
        'MISSING_LEDGER',

    DUPLICATE_PROVIDER:
        'DUPLICATE_PROVIDER',

    DUPLICATE_LEDGER:
        'DUPLICATE_LEDGER',

    INVALID_PROVIDER_RECORD:
        'INVALID_PROVIDER_RECORD',

    INVALID_LEDGER_RECORD:
        'INVALID_LEDGER_RECORD',

    REQUIRES_REVIEW:
        'REQUIRES_REVIEW'
});


const VARIANCE_TYPE = Object.freeze({
    AMOUNT_MISMATCH:
        'AMOUNT_MISMATCH',

    CURRENCY_MISMATCH:
        'CURRENCY_MISMATCH',

    REFERENCE_MISMATCH:
        'REFERENCE_MISMATCH',

    MISSING_PROVIDER:
        'MISSING_PROVIDER',

    MISSING_LEDGER:
        'MISSING_LEDGER',

    DUPLICATE_PROVIDER:
        'DUPLICATE_PROVIDER',

    DUPLICATE_LEDGER:
        'DUPLICATE_LEDGER',

    PROVIDER_RECORD_INVALID:
        'PROVIDER_RECORD_INVALID',

    LEDGER_RECORD_INVALID:
        'LEDGER_RECORD_INVALID'
});


const SENSITIVE_KEYS = new Set([
    'authorization',
    'cookie',
    'password',
    'secret',
    'clientSecret',
    'client_secret',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'token',
    'signature',
    'credentials',
    'rawPayload',
    'raw_payload'
]);


/* ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function isFunction(value) {
    return typeof value === 'function';
}


function safeString(
    value,
    maxLength = 1000
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .trim()
        .slice(
            0,
            maxLength
        );
}


function generateId() {
    return crypto.randomUUID();
}


function normalizeCurrency(
    currency
) {
    const normalized =
        String(
            currency || ''
        )
            .trim()
            .toUpperCase();

    return normalized || undefined;
}


function cloneSafe(
    value,
    depth = 0
) {
    if (
        depth > 6
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return '[REDACTED_BUFFER]';
    }

    if (
        typeof value === 'string'
    ) {
        return value.slice(
            0,
            4000
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
        Array.isArray(value)
    ) {
        return value
            .slice(
                0,
                200
            )
            .map(
                item =>
                    cloneSafe(
                        item,
                        depth + 1
                    )
            );
    }

    if (
        isObject(value)
    ) {
        const result = {};

        for (
            const [
                key,
                item
            ] of Object.entries(value)
        ) {
            const lowerKey =
                String(key)
                    .toLowerCase();

            if (
                SENSITIVE_KEYS.has(key) ||
                SENSITIVE_KEYS.has(lowerKey)
            ) {
                result[key] =
                    '[REDACTED]';

                continue;
            }

            result[key] =
                cloneSafe(
                    item,
                    depth + 1
                );
        }

        return result;
    }

    return safeString(
        value
    );
}


function createError(
    code,
    message,
    details = {}
) {
    const error =
        new Error(
            message
        );

    error.name =
        'AirtelSettlementReconciliationError';

    error.code =
        code;

    error.provider =
        PROVIDER;

    Object.assign(
        error,
        details
    );

    return error;
}


/**
 * Convert a decimal monetary value into integer minor units.
 *
 * This deliberately avoids Number() arithmetic. The reconciler therefore
 * cannot introduce binary floating-point discrepancies into financial matching.
 */
function toMinorUnits(
    value,
    scale = DEFAULT_CURRENCY_SCALE
) {
    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
    ) {
        return null;
    }

    const normalized =
        String(value)
            .trim();

    if (
        !/^-?\d+(?:\.\d+)?$/.test(
            normalized
        )
    ) {
        return null;
    }

    const negative =
        normalized.startsWith('-');

    const unsigned =
        negative
            ? normalized.slice(1)
            : normalized;

    const [
        whole,
        fractional = ''
    ] =
        unsigned.split('.');

    if (
        fractional.length >
            scale &&
        !/^0+$/.test(
            fractional.slice(
                scale
            )
        )
    ) {
        return null;
    }

    const paddedFraction =
        fractional
            .padEnd(
                scale,
                '0'
            )
            .slice(
                0,
                scale
            );

    const units =
        BigInt(
            whole
        ) *
        (
            10n **
            BigInt(scale)
        ) +
        BigInt(
            paddedFraction || '0'
        );

    return negative
        ? -units
        : units;
}


function amountsEqual(
    left,
    right,
    scale = DEFAULT_CURRENCY_SCALE
) {
    const leftMinor =
        toMinorUnits(
            left,
            scale
        );

    const rightMinor =
        toMinorUnits(
            right,
            scale
        );

    if (
        leftMinor === null ||
        rightMinor === null
    ) {
        return false;
    }

    return (
        leftMinor ===
        rightMinor
    );
}


function amountDifferenceMinorUnits(
    left,
    right,
    scale = DEFAULT_CURRENCY_SCALE
) {
    const leftMinor =
        toMinorUnits(
            left,
            scale
        );

    const rightMinor =
        toMinorUnits(
            right,
            scale
        );

    if (
        leftMinor === null ||
        rightMinor === null
    ) {
        return null;
    }

    return (
        leftMinor -
        rightMinor
    ).toString();
}


function normalizeTolerance(
    value
) {
    const normalized =
        String(
            value ??
            DEFAULT_TOLERANCE
        )
            .trim();

    if (
        !/^\d+(?:\.\d+)?$/.test(
            normalized
        )
    ) {
        throw createError(
            'AIRTEL_RECONCILIATION_TOLERANCE_INVALID',
            `Invalid amount tolerance: ${value}`
        );
    }

    if (
        toMinorUnits(
            normalized
        ) === null
    ) {
        throw createError(
            'AIRTEL_RECONCILIATION_TOLERANCE_INVALID',
            `Invalid amount tolerance: ${value}`
        );
    }

    return normalized;
}


/* ============================================================================
 * Settlement Reconciler
 * ============================================================================
 */

class SettlementReconciler {

    constructor({
        settlementRepository,

        ledgerRepository,

        reconciliationRepository,

        eventBus,
        eventPublisher,
        outboxService,

        auditService,

        logger,
        metrics,
        tracer,

        tenantResolver,

        amountTolerance =
            DEFAULT_TOLERANCE,

        currencyScale =
            DEFAULT_CURRENCY_SCALE,

        defaultCurrency =
            'UGX',

        strictProviderReferences =
            true
    } = {}) {
        this.settlementRepository =
            settlementRepository;

        this.ledgerRepository =
            ledgerRepository;

        this.reconciliationRepository =
            reconciliationRepository;

        this.eventBus =
            eventBus;

        this.eventPublisher =
            eventPublisher;

        this.outboxService =
            outboxService;

        this.auditService =
            auditService;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.tenantResolver =
            tenantResolver;

        this.amountTolerance =
            normalizeTolerance(
                amountTolerance
            );

        this.currencyScale =
            Number(
                currencyScale
            );

        if (
            !Number.isSafeInteger(
                this.currencyScale
            ) ||
            this.currencyScale < 0 ||
            this.currencyScale > 9
        ) {
            throw createError(
                'AIRTEL_RECONCILIATION_CURRENCY_SCALE_INVALID',
                'currencyScale must be an integer between 0 and 9'
            );
        }

        this.defaultCurrency =
            normalizeCurrency(
                defaultCurrency
            ) || 'UGX';

        this.strictProviderReferences =
            Boolean(
                strictProviderReferences
            );

        this.startedAt =
            new Date();

        this.statistics = {
            executions:
                0,

            completed:
                0,

            failed:
                0,

            matched:
                0,

            variances:
                0,

            missingProvider:
                0,

            missingLedger:
                0,

            duplicateProvider:
                0,

            duplicateLedger:
                0
        };
    }


    /**
     * =========================================================================
     * Reconcile Batch
     * =========================================================================
     */
    async reconcile({
        tenantId,

        settlementDate,

        settlements = null,

        ledgerEntries = null,

        correlationId =
            generateId(),

        operationId =
            generateId(),

        session,

        context = {},

        persist = true,

        publish = true
    } = {}) {
        this.statistics.executions++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.settlement.reconcile'
            );

        const started =
            Date.now();

        try {
            const resolvedTenantId =
                await this.requireTenant({
                    tenantId,
                    context
                });

            const normalizedDate =
                this.normalizeSettlementDate(
                    settlementDate
                );

            if (
                settlements === null ||
                settlements === undefined
            ) {
                settlements =
                    await this.loadSettlements({
                        tenantId:
                            resolvedTenantId,
                        settlementDate:
                            normalizedDate,
                        session,
                        context
                    });
            }

            if (
                ledgerEntries === null ||
                ledgerEntries === undefined
            ) {
                ledgerEntries =
                    await this.loadLedgerEntries({
                        tenantId:
                            resolvedTenantId,
                        settlementDate:
                            normalizedDate,
                        session,
                        context
                    });
            }

            settlements =
                this.normalizeRecords(
                    settlements
                );

            ledgerEntries =
                this.normalizeRecords(
                    ledgerEntries
                );

            const result =
                await this.performReconciliation({
                    tenantId:
                        resolvedTenantId,

                    settlementDate:
                        normalizedDate,

                    settlements,

                    ledgerEntries,

                    correlationId,

                    operationId
                });

            result.durationMs =
                Date.now() -
                started;

            if (
                persist
            ) {
                await this.persist(
                    result,
                    session
                );
            }

            if (
                publish
            ) {
                await this.publish({
                    result,
                    session
                });
            }

            await this.audit({
                action:
                    'AIRTEL_SETTLEMENT_RECONCILED',

                tenantId:
                    resolvedTenantId,

                settlementDate:
                    normalizedDate,

                correlationId,

                operationId,

                metadata: {
                    status:
                        result.status,

                    summary:
                        result.summary
                }
            });

            this.updateStatistics(
                result
            );

            this.metrics?.increment?.(
                'payment_airtel_settlement_reconciliation_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_settlement_reconciliation_total'
            );

            this.metrics?.histogram?.(
                'payment_airtel_settlement_reconciliation_duration_ms',
                result.durationMs
            );

            return result;
        } catch (error) {
            this.statistics.failed++;

            this.metrics?.increment?.(
                'payment_airtel_settlement_reconciliation_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel settlement reconciliation failed',

                provider:
                    PROVIDER,

                tenantId,

                settlementDate,

                correlationId,

                operationId,

                error:
                    this.safeError(
                        error
                    )
            });

            throw normalizeError(
                error,
                {
                    provider:
                        PROVIDER,

                    tenantId,

                    correlationId,

                    operationId,

                    details: {
                        settlementDate
                    }
                }
            );
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Core Reconciliation
     * =========================================================================
     */
    async performReconciliation({
        tenantId,

        settlementDate,

        settlements = [],

        ledgerEntries = [],

        correlationId,

        operationId
    }) {
        const providerRecords =
            this.prepareProviderRecords(
                settlements
            );

        const ledgerRecords =
            this.prepareLedgerRecords(
                ledgerEntries
            );

        const providerIndex =
            this.buildMultiIndex(
                providerRecords
            );

        const ledgerIndex =
            this.buildMultiIndex(
                ledgerRecords
            );

        const matches = [];

        const exceptions = [];

        /**
         * ---------------------------------------------------------------
         * Duplicate detection must happen before matching because multiple
         * provider/internal records with the same reference make a simple
         * one-to-one map ambiguous.
         * ---------------------------------------------------------------
         */
        exceptions.push(
            ...this.detectDuplicateExceptions({
                records:
                    providerRecords,
                type:
                    RESULT_STATUS.DUPLICATE_PROVIDER
            })
        );

        exceptions.push(
            ...this.detectDuplicateExceptions({
                records:
                    ledgerRecords,
                type:
                    RESULT_STATUS.DUPLICATE_LEDGER
            })
        );

        const matchedProviderIndexes =
            new Set();

        const matchedLedgerIndexes =
            new Set();

        for (
            let providerIndexPosition = 0;
            providerIndexPosition <
                providerRecords.length;
            providerIndexPosition++
        ) {
            const provider =
                providerRecords[
                    providerIndexPosition
                ];

            const providerReference =
                this.primaryReference(
                    provider
                );

            if (
                !providerReference
            ) {
                exceptions.push(
                    this.createException({
                        status:
                            RESULT_STATUS.INVALID_PROVIDER_RECORD,

                        reason:
                            'Provider record has no usable reference',

                        provider
                    })
                );

                continue;
            }

            const candidates =
                this.findCandidates(
                    ledgerIndex,
                    providerReference
                );

            if (
                candidates.length === 0
            ) {
                exceptions.push(
                    this.createException({
                        status:
                            RESULT_STATUS.MISSING_LEDGER,

                        provider,

                        reason:
                            'No matching internal record found'
                    })
                );

                this.statistics.missingLedger++;

                continue;
            }

            if (
                candidates.length > 1
            ) {
                exceptions.push(
                    this.createException({
                        status:
                            RESULT_STATUS.REQUIRES_REVIEW,

                        provider,

                        reason:
                            'Multiple internal records match provider reference',

                        details: {
                            candidateCount:
                                candidates.length
                        }
                    })
                );

                continue;
            }

            const ledger =
                candidates[0];

            const ledgerIndexPosition =
                ledgerRecords.indexOf(
                    ledger
                );

            const comparison =
                this.compare(
                    provider,
                    ledger
                );

            matchedProviderIndexes.add(
                providerIndexPosition
            );

            matchedLedgerIndexes.add(
                ledgerIndexPosition
            );

            if (
                comparison.matched
            ) {
                matches.push({
                    reference:
                        providerReference,

                    provider:
                        cloneSafe(
                            provider
                        ),

                    ledger:
                        cloneSafe(
                            ledger
                        )
                });
            } else {
                exceptions.push(
                    comparison.exception
                );
            }
        }

        /**
         * Every unmatched internal record needs explicit treatment.
         */
        for (
            let ledgerIndexPosition = 0;
            ledgerIndexPosition <
                ledgerRecords.length;
            ledgerIndexPosition++
        ) {
            if (
                matchedLedgerIndexes.has(
                    ledgerIndexPosition
                )
            ) {
                continue;
            }

            const ledger =
                ledgerRecords[
                    ledgerIndexPosition
                ];

            const reference =
                this.primaryReference(
                    ledger
                );

            const providerCandidates =
                reference
                    ? this.findCandidates(
                        providerIndex,
                        reference
                    )
                    : [];

            if (
                providerCandidates.length > 0
            ) {
                continue;
            }

            exceptions.push(
                this.createException({
                    status:
                        RESULT_STATUS.MISSING_PROVIDER,

                    ledger,

                    reason:
                        'No matching provider settlement record found'
                })
            );

            this.statistics.missingProvider++;
        }

        const varianceCount =
            exceptions.length;

        const status =
            varianceCount === 0
                ? RESULT_STATUS.MATCHED
                : exceptions.some(
                    exception =>
                        exception.status ===
                            RESULT_STATUS.DUPLICATE_PROVIDER ||
                        exception.status ===
                            RESULT_STATUS.DUPLICATE_LEDGER ||
                        exception.status ===
                            RESULT_STATUS.REQUIRES_REVIEW
                )
                    ? RESULT_STATUS.REQUIRES_REVIEW
                    : RESULT_STATUS.VARIANCE;

        const result = {
            reconciliationId:
                generateId(),

            provider:
                PROVIDER,

            tenantId,

            settlementDate,

            correlationId,

            operationId,

            status,

            matched:
                status ===
                RESULT_STATUS.MATCHED,

            completedAt:
                new Date(),

            matches,

            exceptions:
                exceptions.slice(
                    0,
                    MAX_EXCEPTION_ITEMS
                ),

            summary: {
                matched:
                    matches.length,

                exceptions:
                    exceptions.length,

                settlements:
                    providerRecords.length,

                ledgerEntries:
                    ledgerRecords.length,

                duplicateProvider:
                    exceptions.filter(
                        exception =>
                            exception.status ===
                            RESULT_STATUS.DUPLICATE_PROVIDER
                    ).length,

                duplicateLedger:
                    exceptions.filter(
                        exception =>
                            exception.status ===
                            RESULT_STATUS.DUPLICATE_LEDGER
                    ).length,

                missingProvider:
                    exceptions.filter(
                        exception =>
                            exception.status ===
                            RESULT_STATUS.MISSING_PROVIDER
                    ).length,

                missingLedger:
                    exceptions.filter(
                        exception =>
                            exception.status ===
                            RESULT_STATUS.MISSING_LEDGER
                    ).length,

                variance:
                    exceptions.filter(
                        exception =>
                            exception.status ===
                            RESULT_STATUS.VARIANCE
                    ).length,

                requiresReview:
                    exceptions.filter(
                        exception =>
                            exception.status ===
                            RESULT_STATUS.REQUIRES_REVIEW
                    ).length
            },

            policy: {
                amountTolerance:
                    this.amountTolerance,

                currencyScale:
                    this.currencyScale,

                defaultCurrency:
                    this.defaultCurrency,

                strictProviderReferences:
                    this.strictProviderReferences
            }
        };

        return result;
    }


    /**
     * =========================================================================
     * Record Normalization
     * =========================================================================
     */
    normalizeRecords(
        records
    ) {
        if (
            records === undefined ||
            records === null
        ) {
            return [];
        }

        if (
            !Array.isArray(records)
        ) {
            return [
                records
            ];
        }

        return records;
    }


    prepareProviderRecords(
        records
    ) {
        return records.map(
            record =>
                this.normalizeFinancialRecord(
                    record,
                    'provider'
                )
        );
    }


    prepareLedgerRecords(
        records
    ) {
        return records.map(
            record =>
                this.normalizeFinancialRecord(
                    record,
                    'ledger'
                )
        );
    }


    normalizeFinancialRecord(
        record,
        source
    ) {
        const safe =
            isObject(record)
                ? record
                : {};

        return {
            ...safe,

            reference:
                this.primaryReference(
                    safe
                ),

            amount:
                safe.amount ??
                safe.settlementAmount ??
                safe.transactionAmount ??
                safe.value,

            currency:
                normalizeCurrency(
                    safe.currency
                ) ||
                this.defaultCurrency,

            status:
                safe.status ??
                safe.state,

            source
        };
    }


    /**
     * =========================================================================
     * Record Comparison
     * =========================================================================
     */
    compare(
        provider,
        ledger
    ) {
        const providerReference =
            this.primaryReference(
                provider
            );

        const ledgerReference =
            this.primaryReference(
                ledger
            );

        if (
            !providerReference ||
            !ledgerReference
        ) {
            return {
                matched:
                    false,

                exception:
                    this.createException({
                        status:
                            RESULT_STATUS.INVALID_PROVIDER_RECORD,

                        provider,

                        ledger,

                        reason:
                            'Reference missing from reconciliation record'
                    })
            };
        }

        if (
            providerReference !==
            ledgerReference
        ) {
            return {
                matched:
                    false,

                exception:
                    this.createException({
                        status:
                            RESULT_STATUS.VARIANCE,

                        provider,

                        ledger,

                        reason:
                            'Reference mismatch',

                        varianceType:
                            VARIANCE_TYPE.REFERENCE_MISMATCH
                    })
            };
        }

        const providerCurrency =
            normalizeCurrency(
                provider.currency
            ) ||
            this.defaultCurrency;

        const ledgerCurrency =
            normalizeCurrency(
                ledger.currency
            ) ||
            this.defaultCurrency;

        if (
            providerCurrency !==
            ledgerCurrency
        ) {
            return {
                matched:
                    false,

                exception:
                    this.createException({
                        status:
                            RESULT_STATUS.VARIANCE,

                        provider,

                        ledger,

                        reason:
                            'Currency mismatch',

                        varianceType:
                            VARIANCE_TYPE.CURRENCY_MISMATCH,

                        details: {
                            providerCurrency,
                            ledgerCurrency
                        }
                    })
            };
        }

        if (
            toMinorUnits(
                provider.amount,
                this.currencyScale
            ) === null
        ) {
            return {
                matched:
                    false,

                exception:
                    this.createException({
                        status:
                            RESULT_STATUS.INVALID_PROVIDER_RECORD,

                        provider,

                        ledger,

                        reason:
                            'Provider amount is invalid',

                        varianceType:
                            VARIANCE_TYPE.PROVIDER_RECORD_INVALID
                    })
            };
        }

        if (
            toMinorUnits(
                ledger.amount,
                this.currencyScale
            ) === null
        ) {
            return {
                matched:
                    false,

                exception:
                    this.createException({
                        status:
                            RESULT_STATUS.INVALID_LEDGER_RECORD,

                        provider,

                        ledger,

                        reason:
                            'Internal amount is invalid',

                        varianceType:
                            VARIANCE_TYPE.LEDGER_RECORD_INVALID
                    })
            };
        }

        const providerMinor =
            toMinorUnits(
                provider.amount,
                this.currencyScale
            );

        const ledgerMinor =
            toMinorUnits(
                ledger.amount,
                this.currencyScale
            );

        const toleranceMinor =
            toMinorUnits(
                this.amountTolerance,
                this.currencyScale
            );

        const difference =
            (
                providerMinor -
                ledgerMinor
            );

        const absoluteDifference =
            difference < 0n
                ? -difference
                : difference;

        if (
            absoluteDifference >
            toleranceMinor
        ) {
            return {
                matched:
                    false,

                exception:
                    this.createException({
                        status:
                            RESULT_STATUS.VARIANCE,

                        provider,

                        ledger,

                        reason:
                            'Amount mismatch',

                        varianceType:
                            VARIANCE_TYPE.AMOUNT_MISMATCH,

                        differenceMinorUnits:
                            difference.toString(),

                        absoluteDifferenceMinorUnits:
                            absoluteDifference.toString()
                    })
            };
        }

        return {
            matched:
                true
        };
    }


    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */
    detectDuplicates(
        records = []
    ) {
        const duplicates = [];

        const seen =
            new Map();

        for (
            const record
            of records
        ) {
            const reference =
                this.primaryReference(
                    record
                );

            if (
                !reference
            ) {
                continue;
            }

            if (
                seen.has(
                    reference
                )
            ) {
                duplicates.push({
                    reference,
                    duplicate:
                        record,
                    original:
                        seen.get(
                            reference
                        )
                });

                continue;
            }

            seen.set(
                reference,
                record
            );
        }

        return duplicates;
    }


    detectDuplicateExceptions({
        records,
        type
    }) {
        const duplicates =
            this.detectDuplicates(
                records
            );

        return duplicates.map(
            duplicate =>
                this.createException({
                    status:
                        type,

                    provider:
                        type ===
                            RESULT_STATUS.DUPLICATE_PROVIDER
                            ? duplicate.duplicate
                            : null,

                    ledger:
                        type ===
                            RESULT_STATUS.DUPLICATE_LEDGER
                            ? duplicate.duplicate
                            : null,

                    reason:
                        `Duplicate ${type === RESULT_STATUS.DUPLICATE_PROVIDER ? 'provider' : 'internal'} reference`,

                    varianceType:
                        type ===
                            RESULT_STATUS.DUPLICATE_PROVIDER
                            ? VARIANCE_TYPE.DUPLICATE_PROVIDER
                            : VARIANCE_TYPE.DUPLICATE_LEDGER,

                    details: {
                        reference:
                            duplicate.reference
                    }
                })
        );
    }


    /**
     * =========================================================================
     * Indexing
     * =========================================================================
     */
    buildMultiIndex(
        records
    ) {
        const index =
            new Map();

        for (
            const record
            of records
        ) {
            const references =
                this.getReferences(
                    record
                );

            for (
                const reference
                of references
            ) {
                if (
                    !index.has(
                        reference
                    )
                ) {
                    index.set(
                        reference,
                        []
                    );
                }

                index.get(
                    reference
                ).push(
                    record
                );
            }
        }

        return index;
    }


    findCandidates(
        index,
        reference
    ) {
        if (
            !reference
        ) {
            return [];
        }

        const candidates =
            index.get(
                reference
            ) || [];

        return [
            ...candidates
        ];
    }


    getReferences(
        record = {}
    ) {
        const candidates = [
            record.reference,

            record.providerReference,

            record.transactionReference,

            record.paymentReference,

            record.externalReference,

            record.externalId,

            record.providerTransactionId,

            record.transactionId,

            record.financialTransactionId,

            record.id
        ];

        return [
            ...new Set(
                candidates
                    .filter(
                        value =>
                            value !== undefined &&
                            value !== null &&
                            String(
                                value
                            ).trim() !== ''
                    )
                    .map(
                        value =>
                            String(
                                value
                            ).trim()
                    )
            )
        ];
    }


    primaryReference(
        record = {}
    ) {
        return this.getReferences(
            record
        )[0] || null;
    }


    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */
    async persist(
        result,
        session
    ) {
        if (
            !this.reconciliationRepository
        ) {
            return null;
        }

        const document = {
            ...result,

            matches:
                result.matches.map(
                    item => ({
                        reference:
                            item.reference,

                        provider:
                            item.provider,

                        ledger:
                            item.ledger
                    })
                ),

            exceptions:
                result.exceptions.map(
                    exception =>
                        this.createExceptionPersistenceProjection(
                            exception
                        )
                )
        };

        if (
            isFunction(
                this.reconciliationRepository.saveResult
            )
        ) {
            return this.reconciliationRepository.saveResult({
                ...document,
                session
            });
        }

        if (
            isFunction(
                this.reconciliationRepository.create
            )
        ) {
            return this.reconciliationRepository.create({
                ...document,
                session
            });
        }

        if (
            isFunction(
                this.reconciliationRepository.save
            )
        ) {
            return this.reconciliationRepository.save(
                document,
                {
                    session
                }
            );
        }

        throw createError(
            'AIRTEL_RECONCILIATION_PERSISTENCE_UNAVAILABLE',
            'Reconciliation repository does not expose a supported persistence method'
        );
    }


    createExceptionPersistenceProjection(
        exception
    ) {
        return {
            id:
                exception.id,

            status:
                exception.status,

            reason:
                exception.reason,

            varianceType:
                exception.varianceType,

            differenceMinorUnits:
                exception.differenceMinorUnits,

            absoluteDifferenceMinorUnits:
                exception.absoluteDifferenceMinorUnits,

            details:
                cloneSafe(
                    exception.details
                ),

            provider:
                cloneSafe(
                    exception.provider
                ),

            ledger:
                cloneSafe(
                    exception.ledger
                ),

            createdAt:
                exception.createdAt
        };
    }


    /**
     * =========================================================================
     * Publish
     * =========================================================================
     */
    async publish({
        result,
        session
    }) {
        const payload = {
            reconciliationId:
                result.reconciliationId,

            provider:
                PROVIDER,

            tenantId:
                result.tenantId,

            settlementDate:
                result.settlementDate,

            status:
                result.status,

            summary:
                result.summary,

            correlationId:
                result.correlationId,

            operationId:
                result.operationId
        };

        /**
         * Prefer transactional outbox.
         */
        if (
            this.outboxService
        ) {
            if (
                isFunction(
                    this.outboxService.enqueue
                )
            ) {
                await this.outboxService.enqueue({
                    tenantId:
                        result.tenantId,

                    aggregateType:
                        'AIRTEL_RECONCILIATION',

                    aggregateId:
                        result.reconciliationId,

                    eventType:
                        this.eventTypeForResult(
                            result
                        ),

                    payload,

                    idempotencyKey:
                        `AIRTEL_RECONCILIATION:${result.tenantId}:${result.reconciliationId}`,

                    session
                });

                return;
            }

            if (
                isFunction(
                    this.outboxService.publish
                )
            ) {
                await this.outboxService.publish({
                    tenantId:
                        result.tenantId,

                    eventType:
                        this.eventTypeForResult(
                            result
                        ),

                    payload,

                    idempotencyKey:
                        `AIRTEL_RECONCILIATION:${result.tenantId}:${result.reconciliationId}`,

                    session
                });

                return;
            }
        }

        const publisher =
            this.eventBus ||
            this.eventPublisher;

        if (
            publisher &&
            isFunction(
                publisher.publish
            )
        ) {
            await publisher.publish({
                type:
                    this.eventTypeForResult(
                        result
                    ),

                payload
            });
        }
    }


    eventTypeForResult(
        result
    ) {
        if (
            result.status ===
            RESULT_STATUS.MATCHED
        ) {
            return 'AIRTEL_RECONCILIATION_COMPLETED';
        }

        if (
            result.status ===
            RESULT_STATUS.REQUIRES_REVIEW
        ) {
            return 'AIRTEL_RECONCILIATION_REQUIRES_REVIEW';
        }

        return 'AIRTEL_RECONCILIATION_VARIANCE_DETECTED';
    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */
    async audit({
        action,
        tenantId,
        settlementDate,
        correlationId,
        operationId,
        metadata = {}
    }) {
        if (
            !this.auditService ||
            !isFunction(
                this.auditService.record
            )
        ) {
            return;
        }

        try {
            await this.auditService.record({
                action,

                provider:
                    PROVIDER,

                tenantId,

                settlementDate,

                correlationId,

                operationId,

                metadata:
                    cloneSafe(
                        metadata
                    )
            });
        } catch (error) {
            this.logger?.error?.({
                message:
                    'Airtel reconciliation audit recording failed',

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId,

                error:
                    this.safeError(
                        error
                    )
            });
        }
    }


    /**
     * =========================================================================
     * Repository Loaders
     * =========================================================================
     */
    async loadSettlements({
        tenantId,
        settlementDate,
        session,
        context = {}
    }) {
        if (
            !this.settlementRepository
        ) {
            throw createError(
                'AIRTEL_SETTLEMENT_REPOSITORY_UNAVAILABLE',
                'Settlement repository is not configured'
            );
        }

        const query = {
            tenantId,

            provider:
                PROVIDER,

            settlementDate,

            session,

            context
        };

        if (
            isFunction(
                this.settlementRepository.findForReconciliation
            )
        ) {
            return (
                await this.settlementRepository.findForReconciliation(
                    query
                )
            ) || [];
        }

        if (
            isFunction(
                this.settlementRepository.find
            )
        ) {
            return (
                await this.settlementRepository.find(
                    query
                )
            ) || [];
        }

        throw createError(
            'AIRTEL_SETTLEMENT_REPOSITORY_QUERY_UNAVAILABLE',
            'Settlement repository does not expose a supported query method'
        );
    }


    async loadLedgerEntries({
        tenantId,
        settlementDate,
        session,
        context = {}
    }) {
        if (
            !this.ledgerRepository
        ) {
            throw createError(
                'AIRTEL_LEDGER_REPOSITORY_UNAVAILABLE',
                'Ledger repository is not configured'
            );
        }

        const query = {
            tenantId,

            provider:
                PROVIDER,

            settlementDate,

            session,

            context
        };

        if (
            isFunction(
                this.ledgerRepository.findForReconciliation
            )
        ) {
            return (
                await this.ledgerRepository.findForReconciliation(
                    query
                )
            ) || [];
        }

        if (
            isFunction(
                this.ledgerRepository.find
            )
        ) {
            return (
                await this.ledgerRepository.find(
                    query
                )
            ) || [];
        }

        throw createError(
            'AIRTEL_LEDGER_REPOSITORY_QUERY_UNAVAILABLE',
            'Ledger repository does not expose a supported query method'
        );
    }


    /**
     * =========================================================================
     * Tenant
     * =========================================================================
     */
    async requireTenant({
        tenantId,
        context = {}
    }) {
        let resolved =
            tenantId;

        if (
            (
                resolved === undefined ||
                resolved === null ||
                String(
                    resolved
                ).trim() === ''
            ) &&
            this.tenantResolver &&
            isFunction(
                this.tenantResolver.resolve
            )
        ) {
            resolved =
                await this.tenantResolver.resolve(
                    context
                );
        }

        if (
            resolved === undefined ||
            resolved === null ||
            String(
                resolved
            ).trim() === ''
        ) {
            throw createError(
                'AIRTEL_RECONCILIATION_TENANT_REQUIRED',
                'Tenant context is required for Airtel reconciliation'
            );
        }

        return String(
            resolved
        ).trim();
    }


    /**
     * =========================================================================
     * Date Validation
     * =========================================================================
     */
    normalizeSettlementDate(
        value
    ) {
        if (
            value instanceof Date
        ) {
            if (
                Number.isNaN(
                    value.getTime()
                )
            ) {
                throw createError(
                    'AIRTEL_RECONCILIATION_DATE_INVALID',
                    'Settlement date is invalid'
                );
            }

            return value
                .toISOString()
                .slice(
                    0,
                    10
                );
        }

        const normalized =
            String(
                value || ''
            )
                .trim();

        if (
            /^\d{4}-\d{2}-\d{2}$/
                .test(
                    normalized
                )
        ) {
            return normalized;
        }

        const parsed =
            new Date(
                normalized
            );

        if (
            Number.isNaN(
                parsed.getTime()
            )
        ) {
            throw createError(
                'AIRTEL_RECONCILIATION_DATE_INVALID',
                'Settlement date is invalid'
            );
        }

        return parsed
            .toISOString()
            .slice(
                0,
                10
            );
    }


    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */
    updateStatistics(
        result
    ) {
        if (
            result.status ===
            RESULT_STATUS.MATCHED
        ) {
            this.statistics.matched++;
            this.statistics.completed++;
            return;
        }

        if (
            result.summary?.variance > 0
        ) {
            this.statistics.variances++;
        }

        if (
            result.summary?.duplicateProvider > 0
        ) {
            this.statistics.duplicateProvider++;
        }

        if (
            result.summary?.duplicateLedger > 0
        ) {
            this.statistics.duplicateLedger++;
        }

        if (
            result.summary?.missingProvider > 0
        ) {
            this.statistics.missingProvider++;
        }

        if (
            result.summary?.missingLedger > 0
        ) {
            this.statistics.missingLedger++;
        }

        this.statistics.completed++;
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health() {
        const repositoryHealth =
            await this.safeHealth(
                this.reconciliationRepository
            );

        const settlementHealth =
            await this.safeHealth(
                this.settlementRepository
            );

        const ledgerHealth =
            await this.safeHealth(
                this.ledgerRepository
            );

        const status =
            [
                repositoryHealth,
                settlementHealth,
                ledgerHealth
            ].some(
                item =>
                    item.status === 'DOWN'
            )
                ? 'DOWN'
                : 'UP';

        return {
            provider:
                PROVIDER,

            component:
                'SettlementReconciler',

            status,

            tolerance:
                this.amountTolerance,

            currencyScale:
                this.currencyScale,

            defaultCurrency:
                this.defaultCurrency,

            tenantAware:
                Boolean(
                    this.tenantResolver
                ),

            repository:
                repositoryHealth,

            settlementRepository:
                settlementHealth,

            ledgerRepository:
                ledgerHealth,

            reconciliationRepository:
                Boolean(
                    this.reconciliationRepository
                ),

            eventTransport:
                Boolean(
                    this.outboxService ||
                    this.eventBus ||
                    this.eventPublisher
                ),

            statistics: {
                ...this.statistics
            },

            uptimeMs:
                Date.now() -
                this.startedAt.getTime()
        };
    }


    async safeHealth(
        dependency
    ) {
        if (
            !dependency
        ) {
            return {
                status:
                    'NOT_CONFIGURED'
            };
        }

        try {
            if (
                isFunction(
                    dependency.health
                )
            ) {
                return cloneSafe(
                    await dependency.health()
                );
            }

            return {
                status:
                    'AVAILABLE'
            };
        } catch (error) {
            return {
                status:
                    'DOWN',

                error:
                    this.safeError(
                        error
                    )
            };
        }
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
                'SettlementReconciler',

            tolerance:
                this.amountTolerance,

            currencyScale:
                this.currencyScale,

            defaultCurrency:
                this.defaultCurrency,

            strictProviderReferences:
                this.strictProviderReferences,

            architecture: {
                providerHttp:
                    false,

                ledgerMutation:
                    false,

                balanceMutation:
                    false,

                callbackProcessing:
                    false,

                settlementPosting:
                    false,

                reconciliationPersistence:
                    Boolean(
                        this.reconciliationRepository
                    ),

                outbox:
                    Boolean(
                        this.outboxService
                    )
            },

            dependencies: {
                settlementRepository:
                    Boolean(
                        this.settlementRepository
                    ),

                ledgerRepository:
                    Boolean(
                        this.ledgerRepository
                    ),

                reconciliationRepository:
                    Boolean(
                        this.reconciliationRepository
                    ),

                tenantResolver:
                    Boolean(
                        this.tenantResolver
                    ),

                auditService:
                    Boolean(
                        this.auditService
                    )
            },

            resultStatuses:
                Object.values(
                    RESULT_STATUS
                ),

            varianceTypes:
                Object.values(
                    VARIANCE_TYPE
                ),

            statistics: {
                ...this.statistics
            }
        };
    }


    /**
     * =========================================================================
     * Helpers
     * =========================================================================
     */
    createException({
        status,
        provider = null,
        ledger = null,
        reason = null,
        varianceType = null,
        differenceMinorUnits = null,
        absoluteDifferenceMinorUnits = null,
        details = {}
    } = {}) {
        return {
            id:
                generateId(),

            status,

            varianceType,

            reason:
                safeString(
                    reason,
                    1000
                ),

            differenceMinorUnits,

            absoluteDifferenceMinorUnits,

            provider:
                provider
                    ? cloneSafe(provider)
                    : null,

            ledger:
                ledger
                    ? cloneSafe(ledger)
                    : null,

            details:
                cloneSafe(details),

            createdAt:
                new Date()
        };
    }


    safeError(
        error
    ) {
        if (
            !error
        ) {
            return null;
        }

        if (
            isFunction(
                error.toJSON
            )
        ) {
            try {
                return cloneSafe(
                    error.toJSON()
                );
            } catch (_) {
                // Continue to safe fields.
            }
        }

        return {
            name:
                safeString(
                    error.name,
                    128
                ),

            code:
                safeString(
                    error.code,
                    256
                ),

            message:
                safeString(
                    error.message,
                    2000
                )
        };
    }
}


/* ============================================================================
 * Static / Public Exports
 * ============================================================================
 */

SettlementReconciler.RESULT_STATUS =
    RESULT_STATUS;

SettlementReconciler.VARIANCE_TYPE =
    VARIANCE_TYPE;

SettlementReconciler.DEFAULT_TOLERANCE =
    DEFAULT_TOLERANCE;

SettlementReconciler.PROVIDER =
    PROVIDER;

module.exports =
    SettlementReconciler;

module.exports.SettlementReconciler =
    SettlementReconciler;

module.exports.RESULT_STATUS =
    RESULT_STATUS;

module.exports.VARIANCE_TYPE =
    VARIANCE_TYPE;

module.exports.DEFAULT_TOLERANCE =
    DEFAULT_TOLERANCE;