'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Reconciliation Engine
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/reconciliation/reconciliationEngine.js
 *
 * Architectural Role
 * ------------------
 * Enterprise reconciliation intelligence and evidence-comparison boundary for
 * Airtel settlement processing.
 *
 * This component compares provider settlement evidence against the authoritative
 * internal financial/ledger evidence exposed through the configured adapters.
 * It identifies matches, variances, missing records and duplicates, persists
 * reconciliation outcomes, and exposes explicit repair hooks.
 *
 * Responsibilities
 * ----------------
 * - Provider settlement evidence retrieval through the configured adapter.
 * - Internal ledger evidence retrieval through the configured financial adapter.
 * - Deterministic transaction matching.
 * - Duplicate provider/ledger transaction detection.
 * - Missing provider/ledger transaction detection.
 * - Amount and currency variance detection.
 * - Settlement/reference mismatch detection.
 * - Reconciliation run lifecycle tracking.
 * - Tenant isolation.
 * - Idempotent reconciliation execution.
 * - Exception generation and bounded evidence projection.
 * - Audit integration.
 * - Safe lifecycle event publication.
 * - Operational metrics and tracing.
 * - Explicit repair-engine integration when invoked by a trusted workflow.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Airtel API authentication.
 * - Airtel payment execution.
 * - Airtel callback processing.
 * - Direct provider HTTP communication.
 * - Direct ledger mutation.
 * - Direct wallet/balance mutation.
 * - Accounting journal creation.
 * - Financial transaction settlement.
 * - Automatic financial repair without explicit authorization.
 * - KYC/AML decisions.
 * - Regulatory reporting generation.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. Reconciliation is evidence comparison, not financial posting.
 * 2. Provider acknowledgement is not treated as ledger settlement.
 * 3. Monetary values are compared using exact decimal/minor-unit arithmetic.
 * 4. JavaScript Number is never used to compare monetary amounts.
 * 5. Tenant identity is mandatory for all reconciliation operations.
 * 6. Duplicate records are never silently collapsed into a single map entry.
 * 7. Missing provider and missing ledger evidence are explicit exceptions.
 * 8. Reconciliation exceptions default to review rather than silent repair.
 * 9. Repair is an explicit operation and is never automatically invoked by
 *    reconcile().
 * 10. Raw provider responses are never emitted through lifecycle events.
 *
 * Consistency Principles
 * ----------------------
 * - Idempotency is checked before creating side-effecting reconciliation state.
 * - Repository atomic lifecycle methods are preferred where available.
 * - A repeated completed reconciliation returns the existing authoritative
 *   result when an idempotency store is configured.
 * - Concurrent execution must not silently create duplicate financial outcomes.
 * - Persistence/event/audit failures are distinguished from comparison results.
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
const COMPONENT = 'ReconciliationEngine';
const VERSION = '1.0.0';

const RECONCILIATION_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    RUNNING:
        'RUNNING',

    MATCHED:
        'MATCHED',

    PARTIAL:
        'PARTIAL',

    FAILED:
        'FAILED',

    COMPLETED:
        'COMPLETED',

    REVIEW:
        'REVIEW'

});

const MATCH_STATUS = Object.freeze({

    MATCHED:
        'MATCHED',

    MISSING_PROVIDER:
        'MISSING_PROVIDER',

    MISSING_LEDGER:
        'MISSING_LEDGER',

    AMOUNT_MISMATCH:
        'AMOUNT_MISMATCH',

    CURRENCY_MISMATCH:
        'CURRENCY_MISMATCH',

    REFERENCE_MISMATCH:
        'REFERENCE_MISMATCH',

    DUPLICATE:
        'DUPLICATE',

    DUPLICATE_PROVIDER:
        'DUPLICATE_PROVIDER',

    DUPLICATE_LEDGER:
        'DUPLICATE_LEDGER',

    INVALID_PROVIDER:
        'INVALID_PROVIDER',

    INVALID_LEDGER:
        'INVALID_LEDGER',

    UNKNOWN:
        'UNKNOWN'

});

const RECONCILIATION_RESULT = Object.freeze({

    MATCHED:
        'MATCHED',

    PARTIAL:
        'PARTIAL',

    REVIEW:
        'REVIEW',

    FAILED:
        'FAILED'

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

    INVALID_PROVIDER_RECORD:
        'INVALID_PROVIDER_RECORD',

    INVALID_LEDGER_RECORD:
        'INVALID_LEDGER_RECORD'

});

/**
 * Provider statuses that should be treated as financially relevant only after
 * the downstream ledger/reconciliation evidence agrees.
 */
const SUCCESS_STATUSES = new Set([
    'SUCCESS',
    'COMPLETED',
    'SETTLED',
    'SETTLEMENT_SUCCESS'
]);

const FAILURE_STATUSES = new Set([
    'FAILED',
    'ERROR',
    'REVERSED',
    'CANCELLED',
    'CANCELED'
]);

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
const MAX_REASON_LENGTH = 1_000;
const MAX_EXCEPTION_COUNT = 10_000;
const DEFAULT_AMOUNT_SCALE = 2;
const DEFAULT_CURRENCY = 'UGX';

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

    if (depth > 5) {
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
        return truncate(value);
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {

        return value
            .slice(0, 100)
            .map(item =>
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
                .slice(0, 100)
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

    return truncate(value);
}

function safeError(
    error
) {

    if (!error) {

        return {

            name:
                'Error',

            message:
                'Unknown error'

        };
    }

    return {

        name:
            truncate(
                error.name || 'Error',
                128
            ),

        message:
            truncate(
                error.message ||
                String(error),
                MAX_REASON_LENGTH
            ),

        code:
            truncate(
                error.code,
                128
            ),

        statusCode:
            Number.isFinite(error.statusCode)
                ? error.statusCode
                : undefined

    };
}

function normalizeTenantId(
    tenantId
) {

    if (
        tenantId === null ||
        tenantId === undefined
    ) {
        return null;
    }

    const normalized =
        String(
            typeof tenantId === 'object' &&
            typeof tenantId.toString === 'function'
                ? tenantId.toString()
                : tenantId
        ).trim();

    return normalized
        ? truncate(normalized, 128)
        : null;
}

function requireTenantId(
    tenantId
) {

    const normalized =
        normalizeTenantId(
            tenantId
        );

    if (!normalized) {

        throw new Error(
            'tenantId is required for Airtel reconciliation'
        );
    }

    return normalized;
}

function normalizeIdentifier(
    value,
    fieldName
) {

    if (
        value === null ||
        value === undefined
    ) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    const normalized =
        String(value).trim();

    if (!normalized) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    return truncate(
        normalized,
        256
    );
}

function normalizeDate(
    value
) {

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new Error(
            'settlementDate must be a valid date'
        );
    }

    return date;
}

function normalizeCurrency(
    currency
) {

    if (
        currency === null ||
        currency === undefined ||
        String(currency).trim() === ''
    ) {
        return DEFAULT_CURRENCY;
    }

    return truncate(
        String(currency)
            .trim()
            .toUpperCase(),
        16
    );
}

/**
 * Converts a non-negative decimal monetary string to exact minor units.
 *
 * Examples with scale=2:
 *   "100"       -> 10000
 *   "100.50"    -> 10050
 *   "100.5"     -> 10050
 *
 * No floating-point arithmetic is used.
 */
function decimalToMinorUnits(
    value,
    scale = DEFAULT_AMOUNT_SCALE
) {

    if (
        value === null ||
        value === undefined
    ) {
        throw new Error(
            'Monetary amount is required'
        );
    }

    const stringValue =
        String(value)
            .trim();

    if (!stringValue) {
        throw new Error(
            'Monetary amount cannot be empty'
        );
    }

    if (
        !/^\d+(?:\.\d+)?$/.test(
            stringValue
        )
    ) {

        throw new Error(
            `Invalid monetary amount: ${stringValue}`
        );
    }

    const [
        integerPart,
        fractionPart = ''
    ] =
        stringValue.split('.');

    if (
        fractionPart.length > scale
    ) {

        /*
         * Reconciliation must not silently round provider or ledger evidence.
         * Values with greater precision are considered invalid instead.
         */
        throw new Error(
            `Monetary amount has more than ${scale} decimal places`
        );
    }

    const normalizedFraction =
        fractionPart
            .padEnd(scale, '0');

    const minorString =
        `${integerPart}${normalizedFraction || ''}`;

    return BigInt(
        minorString || '0'
    );
}

function absoluteDifference(
    left,
    right
) {

    return left >= right
        ? left - right
        : right - left;
}

function extractReference(
    transaction
) {

    if (!transaction) {
        return null;
    }

    const candidates = [

        transaction.reference,

        transaction.transactionReference,

        transaction.providerReference,

        transaction.externalReference,

        transaction.externalId,

        transaction.providerTransactionId,

        transaction.providerTransactionReference,

        transaction.receiptNumber

    ];

    for (const candidate of candidates) {

        if (
            candidate !== null &&
            candidate !== undefined &&
            String(candidate).trim()
        ) {

            return truncate(
                String(candidate).trim(),
                256
            );
        }
    }

    return null;
}

function extractCurrency(
    transaction
) {

    return normalizeCurrency(
        transaction?.currency
    );
}

function extractAmount(
    transaction
) {

    if (
        transaction?.amount !== undefined &&
        transaction?.amount !== null
    ) {

        return String(
            transaction.amount
        );
    }

    if (
        transaction?.amountMinor !== undefined &&
        transaction?.amountMinor !== null
    ) {

        return String(
            transaction.amountMinor
        );
    }

    if (
        transaction?.value !== undefined &&
        transaction?.value !== null
    ) {

        return String(
            transaction.value
        );
    }

    return null;
}

function extractStatus(
    transaction
) {

    const status =
        transaction?.status ??
        transaction?.state;

    return status
        ? truncate(
            String(status)
                .trim()
                .toUpperCase(),
            128
        )
        : null;
}

function extractRecordId(
    transaction
) {

    if (!transaction) {
        return null;
    }

    return (
        transaction.id ??
        transaction._id ??
        transaction.transactionId ??
        transaction.providerTransactionId ??
        null
    );
}

class ReconciliationEngine {

    constructor({

        repository,

        settlementRepository,

        ledgerBridge,

        financialTransactionService,

        providerAdapter,

        matcher,

        repairEngine,

        auditService,

        eventBus,

        outboxService,

        eventPublisher,

        metrics,

        logger,

        tracer,

        idempotencyStore,

        tenantResolver,

        authorizationService,

        clock = Date,

        amountScale =
            process.env.AIRTEL_RECONCILIATION_AMOUNT_SCALE ||
            DEFAULT_AMOUNT_SCALE,

        amountTolerance = '0',

        currency = DEFAULT_CURRENCY,

        maxExceptions =
            10_000

    } = {}) {

        this.repository =
            repository;

        this.settlementRepository =
            settlementRepository;

        this.ledgerBridge =
            ledgerBridge;

        this.financialTransactionService =
            financialTransactionService;

        this.providerAdapter =
            providerAdapter;

        this.matcher =
            matcher;

        this.repairEngine =
            repairEngine;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.outboxService =
            outboxService;

        this.eventPublisher =
            eventPublisher;

        this.metrics =
            metrics;

        this.logger =
            logger;

        this.tracer =
            tracer;

        this.idempotencyStore =
            idempotencyStore;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.clock =
            clock;

        this.amountScale =
            this.normalizeScale(
                amountScale
            );

        this.amountTolerance =
            this.normalizeTolerance(
                amountTolerance
            );

        this.currency =
            normalizeCurrency(
                currency
            );

        this.maxExceptions =
            Number.isFinite(
                Number(maxExceptions)
            ) &&
            Number(maxExceptions) > 0
                ? Math.floor(
                    Number(maxExceptions)
                )
                : MAX_EXCEPTION_COUNT;

        this.statistics = {

            executions:
                0,

            matched:
                0,

            mismatched:
                0,

            partial:
                0,

            repaired:
                0,

            failed:
                0,

            exceptions:
                0,

            duplicates:
                0,

            missingProvider:
                0,

            missingLedger:
                0

        };

        this.healthState = {

            status:
                'INITIALIZING',

            startedAt:
                this.now(),

            lastExecution:
                null,

            lastError:
                null

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

        this.validateDependencies();

        this.initialized =
            true;

        this.healthState.status =
            'READY';

        this.logger?.info?.({

            component:
                COMPONENT,

            provider:
                PROVIDER,

            message:
                'Airtel reconciliation engine initialized'

        });

        this.metrics?.counter?.(
            'payment_airtel_reconciliation_engine_initialized_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Reconcile
     * =========================================================================
     */

    async reconcile({

        tenantId,

        settlementDate,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        idempotencyKey,

        session = null,

        metadata = {}

    } = {}) {

        const span =
            this.startSpan(
                'airtel.reconciliation.execute',
                {
                    tenantId,
                    correlationId,
                    executionId
                }
            );

        const startedAt =
            Date.now();

        let run = null;

        try {

            const normalizedTenantId =
                requireTenantId(
                    tenantId
                );

            const normalizedSettlementDate =
                normalizeDate(
                    settlementDate
                );

            const normalizedCorrelationId =
                normalizeIdentifier(
                    correlationId,
                    'correlationId'
                );

            const normalizedExecutionId =
                normalizeIdentifier(
                    executionId,
                    'executionId'
                );

            const effectiveIdempotencyKey =
                idempotencyKey ||
                this.buildIdempotencyKey({
                    tenantId:
                        normalizedTenantId,
                    settlementDate:
                        normalizedSettlementDate
                });

            const existing =
                await this.getIdempotentResult({
                    tenantId:
                        normalizedTenantId,
                    idempotencyKey:
                        effectiveIdempotencyKey
                });

            if (existing) {

                this.metrics?.counter?.(
                    'payment_airtel_reconciliation_idempotent_hit_total',
                    1
                );

                return existing;
            }

            this.statistics.executions++;

            const safeMetadata =
                sanitizeValue(
                    metadata
                );

            run = {

                reconciliationId:
                    normalizedExecutionId,

                executionId:
                    normalizedExecutionId,

                tenantId:
                    normalizedTenantId,

                provider:
                    PROVIDER,

                settlementDate:
                    normalizedSettlementDate,

                correlationId:
                    normalizedCorrelationId,

                idempotencyKey:
                    effectiveIdempotencyKey,

                status:
                    RECONCILIATION_STATUS.CREATED,

                startedAt:
                    this.now(),

                metadata:
                    safeMetadata

            };

            await this.createRun(
                run,
                {
                    session
                }
            );

            await this.updateRunStatus(
                run,
                RECONCILIATION_STATUS.RUNNING,
                {
                    session
                }
            );

            const providerTransactions =
                await this.fetchProviderTransactions({

                    tenantId:
                        normalizedTenantId,

                    settlementDate:
                        normalizedSettlementDate,

                    correlationId:
                        normalizedCorrelationId,

                    executionId:
                        normalizedExecutionId,

                    session

                });

            const ledgerTransactions =
                await this.fetchLedgerTransactions({

                    tenantId:
                        normalizedTenantId,

                    settlementDate:
                        normalizedSettlementDate,

                    correlationId:
                        normalizedCorrelationId,

                    executionId:
                        normalizedExecutionId,

                    session

                });

            const comparison =
                await this.compare({

                    tenantId:
                        normalizedTenantId,

                    providerTransactions,

                    ledgerTransactions,

                    settlementDate:
                        normalizedSettlementDate,

                    correlationId:
                        normalizedCorrelationId

                });

            const completedAt =
                this.now();

            const resultStatus =
                this.determineRunStatus(
                    comparison
                );

            const result = {

                ...run,

                status:
                    resultStatus,

                summary:
                    comparison.summary,

                exceptions:
                    comparison.exceptions,

                matchedRecords:
                    comparison.matchedRecords,

                providerCount:
                    comparison.summary.providerCount,

                ledgerCount:
                    comparison.summary.ledgerCount,

                completedAt,

                durationMs:
                    completedAt.getTime() -
                    run.startedAt.getTime()

            };

            await this.completeRun(
                result,
                {
                    session
                }
            );

            await this.recordAuditSafe({

                action:
                    'AIRTEL_RECONCILIATION_COMPLETED',

                tenantId:
                    normalizedTenantId,

                reconciliationId:
                    normalizedExecutionId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                settlementDate:
                    normalizedSettlementDate,

                status:
                    result.status,

                summary:
                    result.summary

            });

            await this.publishCompletionEvent({
                result
            });

            await this.setIdempotentResult({
                tenantId:
                    normalizedTenantId,

                idempotencyKey:
                    effectiveIdempotencyKey,

                result
            });

            this.statistics.exceptions +=
                comparison.exceptions.length;

            if (
                resultStatus ===
                RECONCILIATION_RESULT.MATCHED
            ) {

                this.statistics.matched++;

            } else if (
                resultStatus ===
                RECONCILIATION_RESULT.PARTIAL
            ) {

                this.statistics.partial++;

                this.statistics.mismatched++;

            } else {

                this.statistics.mismatched++;
            }

            this.touchExecution();

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_completed_total',
                1
            );

            this.metrics?.histogram?.(
                'payment_airtel_reconciliation_duration_ms',
                Date.now() - startedAt
            );

            return result;

        } catch (error) {

            this.statistics.failed++;

            this.setHealthError(
                error
            );

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_failed_total',
                1
            );

            if (run) {

                await this.failRunSafe(
                    run,
                    error,
                    {
                        session
                    }
                );

                await this.recordAuditSafe({

                    action:
                        'AIRTEL_RECONCILIATION_FAILED',

                    tenantId:
                        run.tenantId,

                    reconciliationId:
                        run.reconciliationId,

                    correlationId:
                        run.correlationId,

                    executionId:
                        run.executionId,

                    settlementDate:
                        run.settlementDate,

                    error:
                        safeError(error)

                });

                await this.publishFailureEvent({
                    run,
                    error
                });
            }

            this.logger?.error?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Airtel reconciliation execution failed',

                tenantId:
                    run?.tenantId,

                reconciliationId:
                    run?.reconciliationId,

                correlationId:
                    run?.correlationId,

                executionId:
                    run?.executionId,

                error:
                    safeError(error)

            });

            throw normalizeError(
                error,
                {
                    metadata: {
                        operation:
                            'airtel_reconciliation'
                    }
                }
            );

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Provider Transactions
     * =========================================================================
     */

    async fetchProviderTransactions({

        tenantId,

        settlementDate,

        correlationId,

        executionId,

        session

    }) {

        if (
            !this.providerAdapter ||
            typeof this.providerAdapter
                .getSettlementTransactions !==
            'function'
        ) {

            throw new Error(
                'Airtel provider settlement transaction adapter is not configured'
            );
        }

        const transactions =
            await this.providerAdapter
                .getSettlementTransactions({

                    tenantId,

                    settlementDate,

                    correlationId,

                    executionId,

                    session

                });

        if (
            !Array.isArray(transactions)
        ) {

            throw new Error(
                'Provider settlement transaction adapter returned an invalid collection'
            );
        }

        return transactions;
    }

    /**
     * =========================================================================
     * Ledger / Financial Evidence
     * =========================================================================
     */

    async fetchLedgerTransactions({

        tenantId,

        settlementDate,

        correlationId,

        executionId,

        session

    }) {

        /*
         * financialTransactionService is preferred where it exposes the
         * settlement evidence query. ledgerBridge remains a compatibility
         * adapter and must still be read-only from this engine's perspective.
         */

        if (
            this.financialTransactionService &&
            typeof this.financialTransactionService
                .getSettlementTransactions ===
            'function'
        ) {

            const transactions =
                await this.financialTransactionService
                    .getSettlementTransactions({

                        tenantId,

                        settlementDate,

                        correlationId,

                        executionId,

                        session

                    });

            if (
                !Array.isArray(transactions)
            ) {

                throw new Error(
                    'Financial transaction service returned an invalid collection'
                );
            }

            return transactions;
        }

        if (
            this.ledgerBridge &&
            typeof this.ledgerBridge
                .getSettlementTransactions ===
            'function'
        ) {

            const transactions =
                await this.ledgerBridge
                    .getSettlementTransactions({

                        tenantId,

                        settlementDate,

                        correlationId,

                        executionId,

                        session

                    });

            if (
                !Array.isArray(transactions)
            ) {

                throw new Error(
                    'Ledger bridge returned an invalid collection'
                );
            }

            return transactions;
        }

        throw new Error(
            'No authoritative ledger/financial transaction evidence adapter is configured'
        );
    }

    /**
     * =========================================================================
     * Compare Provider and Ledger
     * =========================================================================
     */

    async compare({

        tenantId = null,

        providerTransactions = [],

        ledgerTransactions = [],

        settlementDate = null,

        correlationId = null

    } = {}) {

        if (
            !Array.isArray(providerTransactions) ||
            !Array.isArray(ledgerTransactions)
        ) {

            throw new Error(
                'Provider and ledger transaction collections are required'
            );
        }

        /*
         * A custom matcher is allowed to perform domain-specific matching,
         * provided it returns the canonical comparison shape. The engine still
         * validates the result before returning it.
         */
        if (
            this.matcher &&
            typeof this.matcher.match ===
            'function'
        ) {

            const customResult =
                await this.matcher.match({

                    tenantId,

                    providerTransactions,

                    ledgerTransactions,

                    settlementDate,

                    correlationId

                });

            return this.normalizeComparisonResult(
                customResult,
                {
                    providerCount:
                        providerTransactions.length,

                    ledgerCount:
                        ledgerTransactions.length
                }
            );
        }

        return this.performDeterministicComparison({

            providerTransactions,

            ledgerTransactions

        });
    }

    /**
     * =========================================================================
     * Deterministic Comparison
     * =========================================================================
     */

    performDeterministicComparison({

        providerTransactions,

        ledgerTransactions

    }) {

        const exceptions = [];
        const matchedRecords = [];

        const providerPrepared =
            this.prepareTransactions(
                providerTransactions,
                'PROVIDER'
            );

        const ledgerPrepared =
            this.prepareTransactions(
                ledgerTransactions,
                'LEDGER'
            );

        const providerIndex =
            this.buildReferenceIndex(
                providerPrepared.records
            );

        const ledgerIndex =
            this.buildReferenceIndex(
                ledgerPrepared.records
            );

        /*
         * Invalid records are exceptions, not silently discarded.
         */
        for (
            const invalid of
            providerPrepared.invalidRecords
        ) {

            this.pushException(
                exceptions,
                this.createException({

                    status:
                        MATCH_STATUS.INVALID_PROVIDER,

                    type:
                        VARIANCE_TYPE.INVALID_PROVIDER_RECORD,

                    side:
                        'PROVIDER',

                    reference:
                        invalid.reference,

                    provider:
                        invalid.safeRecord,

                    reason:
                        invalid.reason

                })
            );
        }

        for (
            const invalid of
            ledgerPrepared.invalidRecords
        ) {

            this.pushException(
                exceptions,
                this.createException({

                    status:
                        MATCH_STATUS.INVALID_LEDGER,

                    type:
                        VARIANCE_TYPE.INVALID_LEDGER_RECORD,

                    side:
                        'LEDGER',

                    reference:
                        invalid.reference,

                    ledger:
                        invalid.safeRecord,

                    reason:
                        invalid.reason

                })
            );
        }

        const duplicateProviderReferences =
            this.findDuplicateReferences(
                providerIndex
            );

        const duplicateLedgerReferences =
            this.findDuplicateReferences(
                ledgerIndex
            );

        for (
            const reference of
            duplicateProviderReferences
        ) {

            this.pushException(
                exceptions,
                this.createException({

                    status:
                        MATCH_STATUS.DUPLICATE_PROVIDER,

                    type:
                        VARIANCE_TYPE.DUPLICATE_PROVIDER,

                    side:
                        'PROVIDER',

                    reference,

                    count:
                        providerIndex.get(
                            reference
                        ).length

                })
            );
        }

        for (
            const reference of
            duplicateLedgerReferences
        ) {

            this.pushException(
                exceptions,
                this.createException({

                    status:
                        MATCH_STATUS.DUPLICATE_LEDGER,

                    type:
                        VARIANCE_TYPE.DUPLICATE_LEDGER,

                    side:
                        'LEDGER',

                    reference,

                    count:
                        ledgerIndex.get(
                            reference
                        ).length

                })
            );
        }

        const allReferences =
            new Set([
                ...providerIndex.keys(),
                ...ledgerIndex.keys()
            ]);

        const duplicateProviderSet =
            new Set(
                duplicateProviderReferences
            );

        const duplicateLedgerSet =
            new Set(
                duplicateLedgerReferences
            );

        for (const reference of allReferences) {

            const providerRecords =
                providerIndex.get(
                    reference
                ) || [];

            const ledgerRecords =
                ledgerIndex.get(
                    reference
                ) || [];

            if (
                providerRecords.length === 0
            ) {

                this.pushException(
                    exceptions,
                    this.createException({

                        status:
                            MATCH_STATUS.MISSING_PROVIDER,

                        type:
                            VARIANCE_TYPE.MISSING_PROVIDER,

                        side:
                            'PROVIDER',

                        reference,

                        ledger:
                            this.safeRecord(
                                ledgerRecords[0]
                            )

                    })
                );

                continue;
            }

            if (
                ledgerRecords.length === 0
            ) {

                this.pushException(
                    exceptions,
                    this.createException({

                        status:
                            MATCH_STATUS.MISSING_LEDGER,

                        type:
                            VARIANCE_TYPE.MISSING_LEDGER,

                        side:
                            'LEDGER',

                        reference,

                        provider:
                            this.safeRecord(
                                providerRecords[0]
                            )

                    })
                );

                continue;
            }

            /*
             * A duplicate cannot be considered a clean match merely because
             * one pair happens to agree.
             */
            if (
                duplicateProviderSet.has(
                    reference
                ) ||
                duplicateLedgerSet.has(
                    reference
                )
            ) {

                continue;
            }

            if (
                providerRecords.length !== 1 ||
                ledgerRecords.length !== 1
            ) {

                this.pushException(
                    exceptions,
                    this.createException({

                        status:
                            MATCH_STATUS.DUPLICATE,

                        type:
                            providerRecords.length > 1
                                ? VARIANCE_TYPE.DUPLICATE_PROVIDER
                                : VARIANCE_TYPE.DUPLICATE_LEDGER,

                        reference,

                        providerCount:
                            providerRecords.length,

                        ledgerCount:
                            ledgerRecords.length

                    })
                );

                continue;
            }

            const providerRecord =
                providerRecords[0];

            const ledgerRecord =
                ledgerRecords[0];

            const comparison =
                this.compareRecordPair(
                    providerRecord,
                    ledgerRecord,
                    reference
                );

            if (
                comparison.status ===
                MATCH_STATUS.MATCHED
            ) {

                matchedRecords.push({

                    reference,

                    provider:
                        this.safeRecord(
                            providerRecord
                        ),

                    ledger:
                        this.safeRecord(
                            ledgerRecord
                        )

                });

                continue;
            }

            this.pushException(
                exceptions,
                comparison.exception
            );
        }

        const summary = {

            providerCount:
                providerTransactions.length,

            ledgerCount:
                ledgerTransactions.length,

            validProviderCount:
                providerPrepared.records.length,

            validLedgerCount:
                ledgerPrepared.records.length,

            matched:
                matchedRecords.length,

            exceptions:
                exceptions.length,

            missingProvider:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.MISSING_PROVIDER
                ).length,

            missingLedger:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.MISSING_LEDGER
                ).length,

            duplicateProvider:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.DUPLICATE_PROVIDER ||
                        exception.type ===
                        VARIANCE_TYPE.DUPLICATE_PROVIDER
                ).length,

            duplicateLedger:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.DUPLICATE_LEDGER ||
                        exception.type ===
                        VARIANCE_TYPE.DUPLICATE_LEDGER
                ).length,

            amountMismatch:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.AMOUNT_MISMATCH
                ).length,

            currencyMismatch:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.CURRENCY_MISMATCH
                ).length,

            invalidProvider:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.INVALID_PROVIDER
                ).length,

            invalidLedger:
                exceptions.filter(
                    exception =>
                        exception.status ===
                        MATCH_STATUS.INVALID_LEDGER
                ).length

        };

        return {

            matched:
                exceptions.length === 0 &&
                providerTransactions.length ===
                    ledgerTransactions.length,

            summary,

            matchedRecords,

            exceptions

        };
    }

    /**
     * =========================================================================
     * Transaction Preparation
     * =========================================================================
     */

    prepareTransactions(
        transactions,
        side
    ) {

        const records = [];
        const invalidRecords = [];

        transactions.forEach(
            (
                transaction,
                index
            ) => {

                const normalized =
                    this.normalizeFinancialRecord(
                        transaction,
                        side
                    );

                if (
                    normalized.valid
                ) {

                    records.push(
                        normalized.record
                    );

                } else {

                    invalidRecords.push({

                        index,

                        reference:
                            normalized.reference,

                        reason:
                            normalized.reason,

                        safeRecord:
                            normalized.safeRecord

                    });
                }

            }
        );

        return {

            records,

            invalidRecords

        };
    }

    /**
     * =========================================================================
     * Financial Record Normalization
     * =========================================================================
     */

    normalizeFinancialRecord(
        transaction,
        side
    ) {

        if (
            !transaction ||
            typeof transaction !== 'object'
        ) {

            return {

                valid: false,

                reference: null,

                reason:
                    `${side} transaction must be an object`,

                safeRecord:
                    sanitizeValue(
                        transaction
                    )

            };
        }

        const reference =
            extractReference(
                transaction
            );

        const amount =
            extractAmount(
                transaction
            );

        const currency =
            extractCurrency(
                transaction
            );

        const status =
            extractStatus(
                transaction
            );

        if (!reference) {

            return {

                valid: false,

                reference: null,

                reason:
                    `${side} transaction reference is missing`,

                safeRecord:
                    this.safeRecord(
                        transaction
                    )

            };
        }

        if (
            amount === null ||
            amount === undefined
        ) {

            return {

                valid: false,

                reference,

                reason:
                    `${side} transaction amount is missing`,

                safeRecord:
                    this.safeRecord(
                        transaction
                    )

            };
        }

        let amountMinor;

        try {

            amountMinor =
                decimalToMinorUnits(
                    amount,
                    this.amountScale
                );

        } catch (error) {

            return {

                valid: false,

                reference,

                reason:
                    `${side} transaction amount is invalid`,

                safeRecord:
                    this.safeRecord(
                        transaction
                    )

            };
        }

        /*
         * Negative settlement evidence is intentionally rejected by
         * decimalToMinorUnits. Reversals should be represented by lifecycle
         * status/type and reconciled using the appropriate settlement workflow,
         * not smuggled into a normal settlement amount as a negative value.
         */

        return {

            valid: true,

            record: {

                side,

                reference,

                amount:
                    String(amount),

                amountMinor,

                currency,

                status,

                recordId:
                    extractRecordId(
                        transaction
                    ),

                source:
                    truncate(
                        String(
                            transaction.source ||
                            side
                        ),
                        128
                    ),

                settlementReference:
                    transaction.settlementReference
                        ? truncate(
                            String(
                                transaction.settlementReference
                            ),
                            256
                        )
                        : null,

                transactionType:
                    transaction.transactionType
                        ? truncate(
                            String(
                                transaction.transactionType
                            )
                                .trim()
                                .toUpperCase(),
                            128
                        )
                        : null,

                occurredAt:
                    transaction.occurredAt ||
                    transaction.transactionDate ||
                    transaction.createdAt ||
                    null,

                original:
                    transaction

            }

        };
    }

    /**
     * =========================================================================
     * Reference Index
     * =========================================================================
     *
     * Map<string, Array<Record>> is intentional. A Map<string, Record> would
     * overwrite duplicates and hide exactly the evidence reconciliation is
     * supposed to detect.
     */

    buildReferenceIndex(
        records
    ) {

        const index =
            new Map();

        for (const record of records) {

            const reference =
                record.reference;

            const current =
                index.get(
                    reference
                ) || [];

            current.push(
                record
            );

            index.set(
                reference,
                current
            );
        }

        return index;
    }

    findDuplicateReferences(
        index
    ) {

        const duplicates = [];

        for (
            const [
                reference,
                records
            ] of index.entries()
        ) {

            if (
                records.length > 1
            ) {

                duplicates.push(
                    reference
                );

                this.statistics.duplicates++;
            }
        }

        return duplicates;
    }

    /**
     * =========================================================================
     * Compare a Single Pair
     * =========================================================================
     */

    compareRecordPair(
        providerRecord,
        ledgerRecord,
        reference
    ) {

        if (
            providerRecord.currency !==
            ledgerRecord.currency
        ) {

            return {

                status:
                    MATCH_STATUS.CURRENCY_MISMATCH,

                exception:
                    this.createException({

                        status:
                            MATCH_STATUS.CURRENCY_MISMATCH,

                        type:
                            VARIANCE_TYPE.CURRENCY_MISMATCH,

                        reference,

                        providerCurrency:
                            providerRecord.currency,

                        ledgerCurrency:
                            ledgerRecord.currency,

                        provider:
                            this.safeRecord(
                                providerRecord
                            ),

                        ledger:
                            this.safeRecord(
                                ledgerRecord
                            )

                    })

            };
        }

        const differenceMinor =
            absoluteDifference(
                providerRecord.amountMinor,
                ledgerRecord.amountMinor
            );

        const toleranceMinor =
            this.amountTolerance;

        if (
            differenceMinor >
            toleranceMinor
        ) {

            return {

                status:
                    MATCH_STATUS.AMOUNT_MISMATCH,

                exception:
                    this.createException({

                        status:
                            MATCH_STATUS.AMOUNT_MISMATCH,

                        type:
                            VARIANCE_TYPE.AMOUNT_MISMATCH,

                        reference,

                        providerAmount:
                            providerRecord.amount,

                        ledgerAmount:
                            ledgerRecord.amount,

                        amountDifferenceMinor:
                            differenceMinor.toString(),

                        toleranceMinor:
                            toleranceMinor.toString(),

                        currency:
                            providerRecord.currency

                    })

            };
        }

        const providerSettlementReference =
            providerRecord.settlementReference;

        const ledgerSettlementReference =
            ledgerRecord.settlementReference;

        if (
            providerSettlementReference &&
            ledgerSettlementReference &&
            providerSettlementReference !==
                ledgerSettlementReference
        ) {

            return {

                status:
                    MATCH_STATUS.REFERENCE_MISMATCH,

                exception:
                    this.createException({

                        status:
                            MATCH_STATUS.REFERENCE_MISMATCH,

                        type:
                            VARIANCE_TYPE.REFERENCE_MISMATCH,

                        reference,

                        providerSettlementReference,

                        ledgerSettlementReference

                    })

            };
        }

        return {

            status:
                MATCH_STATUS.MATCHED,

            exception:
                null

        };
    }

    /**
     * =========================================================================
     * Determine Overall Run Status
     * =========================================================================
     */

    determineRunStatus(
        comparison
    ) {

        const exceptions =
            Array.isArray(
                comparison?.exceptions
            )
                ? comparison.exceptions
                : [];

        const matchedCount =
            Number(
                comparison?.summary?.matched ||
                0
            );

        if (
            exceptions.length === 0 &&
            matchedCount ===
                Number(
                    comparison?.summary?.providerCount ||
                    0
                ) &&
            Number(
                comparison?.summary?.providerCount ||
                0
            ) ===
                Number(
                    comparison?.summary?.ledgerCount ||
                    0
                )
        ) {

            return RECONCILIATION_RESULT.MATCHED;
        }

        if (
            matchedCount > 0
        ) {

            return RECONCILIATION_RESULT.PARTIAL;
        }

        return RECONCILIATION_RESULT.REVIEW;
    }

    /**
     * =========================================================================
     * Exception Creation
     * =========================================================================
     */

    createException(
        input = {}
    ) {

        return sanitizeValue({

            exceptionId:
                crypto.randomUUID(),

            provider:
                PROVIDER,

            createdAt:
                this.now(),

            ...input

        });
    }

    pushException(
        exceptions,
        exception
    ) {

        if (
            exceptions.length >=
            this.maxExceptions
        ) {

            return false;
        }

        exceptions.push(
            exception
        );

        return true;
    }

    normalizeComparisonResult(
        result,
        fallbackCounts = {}
    ) {

        const exceptions =
            Array.isArray(
                result?.exceptions
            )
                ? result.exceptions
                    .slice(
                        0,
                        this.maxExceptions
                    )
                    .map(
                        exception =>
                            sanitizeValue(
                                exception
                            )
                    )
                : [];

        const matchedRecords =
            Array.isArray(
                result?.matchedRecords
            )
                ? result.matchedRecords
                    .slice(
                        0,
                        this.maxExceptions
                    )
                : [];

        const providerCount =
            Number(
                result?.summary?.providerCount ??
                fallbackCounts.providerCount ??
                0
            );

        const ledgerCount =
            Number(
                result?.summary?.ledgerCount ??
                fallbackCounts.ledgerCount ??
                0
            );

        const summary = {

            providerCount,

            ledgerCount,

            matched:
                Number(
                    result?.summary?.matched ??
                    matchedRecords.length
                ),

            exceptions:
                exceptions.length,

            ...sanitizeValue(
                result?.summary || {}
            )

        };

        return {

            matched:
                exceptions.length === 0,

            summary,

            matchedRecords,

            exceptions

        };
    }

    /**
     * =========================================================================
     * Automated Repair Hook
     * =========================================================================
     *
     * This operation is deliberately separate from reconcile().
     *
     * The reconciliation engine identifies evidence differences. It does not
     * automatically repair a financial record merely because it detected a
     * difference.
     */

    async repair({

        tenantId,

        exception,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        actorId = null,

        authorizationContext = {}

    } = {}) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        if (!this.repairEngine) {
            return null;
        }

        if (
            !exception ||
            typeof exception !== 'object'
        ) {

            throw new Error(
                'A reconciliation exception is required for repair'
            );
        }

        await this.authorizeRepair({

            tenantId:
                normalizedTenantId,

            exception,

            correlationId,

            executionId,

            actorId,

            authorizationContext

        });

        const safeException =
            sanitizeValue(
                exception
            );

        const result =
            await this.repairEngine.execute({

                provider:
                    PROVIDER,

                tenantId:
                    normalizedTenantId,

                exception:
                    safeException,

                correlationId,

                executionId,

                actorId,

                authorizationContext:
                    sanitizeValue(
                        authorizationContext
                    )

            });

        this.statistics.repaired++;

        this.metrics?.counter?.(
            'payment_airtel_reconciliation_repair_total',
            1
        );

        await this.recordAuditSafe({

            action:
                'AIRTEL_RECONCILIATION_REPAIR_EXECUTED',

            tenantId:
                normalizedTenantId,

            correlationId,

            executionId,

            actorId,

            exceptionId:
                exception.exceptionId,

            status:
                exception.status

        });

        return result;
    }

    async authorizeRepair(
        context
    ) {

        if (
            !this.authorizationService
        ) {
            return true;
        }

        if (
            typeof this.authorizationService.authorize !==
            'function'
        ) {

            return true;
        }

        const authorized =
            await this.authorizationService.authorize({
                action:
                    'AIRTEL_RECONCILIATION_REPAIR',

                ...context
            });

        if (
            authorized === false
        ) {

            const error =
                new Error(
                    'Airtel reconciliation repair is not authorized'
                );

            error.code =
                'AIRTEL_RECONCILIATION_REPAIR_NOT_AUTHORIZED';

            throw error;
        }

        return true;
    }

    /**
     * =========================================================================
     * Repository Run Lifecycle
     * =========================================================================
     */

    async createRun(
        run,
        {
            session = null
        } = {}
    ) {

        if (
            !this.repository
        ) {

            throw new Error(
                'Reconciliation repository is required'
            );
        }

        if (
            typeof this.repository.createForTenant ===
            'function'
        ) {

            return this.repository.createForTenant(
                run.tenantId,
                run,
                {
                    session
                }
            );
        }

        if (
            typeof this.repository.create ===
            'function'
        ) {

            return this.repository.create(
                run,
                {
                    session
                }
            );
        }

        throw new Error(
            'Reconciliation repository does not expose create()'
        );
    }

    async updateRunStatus(
        run,
        status,
        {
            session = null
        } = {}
    ) {

        if (
            typeof this.repository.transitionStatus ===
            'function'
        ) {

            return this.repository.transitionStatus({

                tenantId:
                    run.tenantId,

                reconciliationId:
                    run.reconciliationId,

                status,

                correlationId:
                    run.correlationId,

                executionId:
                    run.executionId,

                session

            });
        }

        if (
            typeof this.repository.updateStatus ===
            'function'
        ) {

            return this.repository.updateStatus(

                run.reconciliationId,

                status,

                {
                    tenantId:
                        run.tenantId,

                    correlationId:
                        run.correlationId,

                    executionId:
                        run.executionId,

                    session
                }

            );
        }

        /*
         * Compatibility: some repositories only persist the final state.
         */
        return null;
    }

    async completeRun(
        result,
        {
            session = null
        } = {}
    ) {

        if (
            typeof this.repository.completeForTenant ===
            'function'
        ) {

            return this.repository.completeForTenant(
                result.tenantId,
                result.reconciliationId,
                result,
                {
                    session
                }
            );
        }

        if (
            typeof this.repository.complete ===
            'function'
        ) {

            return this.repository.complete({

                reconciliationId:
                    result.reconciliationId,

                tenantId:
                    result.tenantId,

                correlationId:
                    result.correlationId,

                executionId:
                    result.executionId,

                result,

                session

            });
        }

        if (
            typeof this.repository.updateResult ===
            'function'
        ) {

            return this.repository.updateResult(

                result.reconciliationId,

                result,

                {
                    tenantId:
                        result.tenantId,

                    session
                }

            );
        }

        throw new Error(
            'Reconciliation repository does not expose a completion operation'
        );
    }

    async failRunSafe(
        run,
        error,
        {
            session = null
        } = {}
    ) {

        const failure = {

            status:
                RECONCILIATION_STATUS.FAILED,

            error:
                safeError(error),

            failedAt:
                this.now()

        };

        try {

            if (
                typeof this.repository.failForTenant ===
                'function'
            ) {

                await this.repository.failForTenant(

                    run.tenantId,

                    run.reconciliationId,

                    failure,

                    {
                        session
                    }

                );

                return true;
            }

            if (
                typeof this.repository.fail ===
                'function'
            ) {

                await this.repository.fail({

                    reconciliationId:
                        run.reconciliationId,

                    tenantId:
                        run.tenantId,

                    correlationId:
                        run.correlationId,

                    executionId:
                        run.executionId,

                    failure,

                    session

                });

                return true;
            }

        } catch (persistenceError) {

            this.logger?.error?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Failed to persist Airtel reconciliation failure state',

                tenantId:
                    run.tenantId,

                reconciliationId:
                    run.reconciliationId,

                error:
                    safeError(
                        persistenceError
                    )

            });

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_failure_persistence_error_total',
                1
            );
        }

        return false;
    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    buildIdempotencyKey({
        tenantId,
        settlementDate
    }) {

        const dateKey =
            settlementDate
                .toISOString()
                .slice(0, 10);

        return (
            `airtel-recon:${tenantId}:${dateKey}`
        );
    }

    async getIdempotentResult({

        tenantId,
        idempotencyKey

    }) {

        if (
            !this.idempotencyStore ||
            typeof this.idempotencyStore.get !==
            'function'
        ) {
            return null;
        }

        return this.idempotencyStore.get(
            this.scopedIdempotencyKey(
                tenantId,
                idempotencyKey
            )
        );
    }

    async setIdempotentResult({

        tenantId,
        idempotencyKey,
        result

    }) {

        if (
            !this.idempotencyStore ||
            typeof this.idempotencyStore.set !==
            'function'
        ) {
            return false;
        }

        const safeResult =
            sanitizeValue(
                result
            );

        /*
         * 24 hours matches the scheduler's daily execution model. The
         * canonical idempotency store should still enforce its own maximum
         * TTL and serialization constraints.
         */
        await this.idempotencyStore.set(
            this.scopedIdempotencyKey(
                tenantId,
                idempotencyKey
            ),
            safeResult,
            86_400
        );

        return true;
    }

    scopedIdempotencyKey(
        tenantId,
        idempotencyKey
    ) {

        const digest =
            crypto
                .createHash('sha256')
                .update(
                    `${tenantId}:${idempotencyKey}`
                )
                .digest('hex');

        return (
            `airtel:reconciliation:${digest}`
        );
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

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_audit_success_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_audit_failure_total',
                1
            );

            this.logger?.error?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Failed to persist Airtel reconciliation audit record',

                tenantId:
                    record?.tenantId,

                reconciliationId:
                    record?.reconciliationId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Event Publication
     * =========================================================================
     */

    async publishCompletionEvent({
        result
    }) {

        const event = {

            type:
                'SETTLEMENT_RECONCILIATION_COMPLETED',

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            occurredAt:
                this.now().toISOString(),

            tenantId:
                result.tenantId,

            correlationId:
                result.correlationId,

            executionId:
                result.executionId,

            payload: {

                reconciliationId:
                    result.reconciliationId,

                status:
                    result.status,

                settlementDate:
                    result.settlementDate,

                summary:
                    sanitizeValue(
                        result.summary
                    )

            }

        };

        try {

            if (
                this.outboxService &&
                typeof this.outboxService.publish ===
                'function'
            ) {

                await this.outboxService.publish(
                    event
                );

            } else if (
                this.eventPublisher &&
                typeof this.eventPublisher.publish ===
                'function'
            ) {

                await this.eventPublisher.publish(
                    event
                );

            } else if (
                this.eventBus &&
                typeof this.eventBus.publish ===
                'function'
            ) {

                await this.eventBus.publish(
                    event
                );

            } else {

                return false;
            }

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_event_published_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_event_publish_failure_total',
                1
            );

            this.logger?.error?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Failed to publish Airtel reconciliation completion event',

                tenantId:
                    result.tenantId,

                reconciliationId:
                    result.reconciliationId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    async publishFailureEvent({
        run,
        error
    }) {

        const event = {

            type:
                'SETTLEMENT_RECONCILIATION_FAILED',

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            occurredAt:
                this.now().toISOString(),

            tenantId:
                run.tenantId,

            correlationId:
                run.correlationId,

            executionId:
                run.executionId,

            payload: {

                reconciliationId:
                    run.reconciliationId,

                settlementDate:
                    run.settlementDate,

                error: {

                    name:
                        truncate(
                            error?.name,
                            128
                        ),

                    code:
                        truncate(
                            error?.code,
                            128
                        )

                }

            }

        };

        try {

            if (
                this.outboxService &&
                typeof this.outboxService.publish ===
                'function'
            ) {

                await this.outboxService.publish(
                    event
                );

            } else if (
                this.eventPublisher &&
                typeof this.eventPublisher.publish ===
                'function'
            ) {

                await this.eventPublisher.publish(
                    event
                );

            } else if (
                this.eventBus &&
                typeof this.eventBus.publish ===
                'function'
            ) {

                await this.eventBus.publish(
                    event
                );

            } else {

                return false;
            }

            return true;

        } catch (publishError) {

            this.logger?.error?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Failed to publish Airtel reconciliation failure event',

                tenantId:
                    run.tenantId,

                reconciliationId:
                    run.reconciliationId,

                error:
                    safeError(
                        publishError
                    )

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Safe Record Projection
     * =========================================================================
     */

    safeRecord(
        record
    ) {

        if (
            record === null ||
            record === undefined
        ) {
            return null;
        }

        if (
            record.reference !== undefined ||
            record.amountMinor !== undefined
        ) {

            return sanitizeValue({

                side:
                    record.side,

                reference:
                    record.reference,

                amount:
                    record.amount,

                currency:
                    record.currency,

                status:
                    record.status,

                recordId:
                    record.recordId,

                source:
                    record.source,

                settlementReference:
                    record.settlementReference,

                transactionType:
                    record.transactionType,

                occurredAt:
                    record.occurredAt

            });
        }

        return sanitizeValue(
            record
        );
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        const repositoryAvailable =
            Boolean(
                this.repository
            );

        const providerAdapterAvailable =
            Boolean(
                this.providerAdapter &&
                typeof this.providerAdapter
                    .getSettlementTransactions ===
                'function'
            );

        const ledgerEvidenceAvailable =
            Boolean(
                (
                    this.financialTransactionService &&
                    typeof this.financialTransactionService
                        .getSettlementTransactions ===
                    'function'
                ) ||
                (
                    this.ledgerBridge &&
                    typeof this.ledgerBridge
                        .getSettlementTransactions ===
                    'function'
                )
            );

        const idempotencyConfigured =
            Boolean(
                this.idempotencyStore &&
                typeof this.idempotencyStore.get ===
                'function' &&
                typeof this.idempotencyStore.set ===
                'function'
            );

        let status =
            this.healthState.status;

        if (
            !repositoryAvailable ||
            !providerAdapterAvailable ||
            !ledgerEvidenceAvailable
        ) {

            status =
                'DOWN';

        } else if (
            status === 'DEGRADED'
        ) {

            status =
                'DEGRADED';

        } else if (
            !idempotencyConfigured
        ) {

            /*
             * Reconciliation can technically execute without an idempotency
             * store, but the omission weakens an important operational control.
             */
            status =
                'DEGRADED';

        } else if (
            status === 'INITIALIZING'
        ) {

            status =
                'DEGRADED';

        } else {

            status =
                'UP';
        }

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            status,

            initialized:
                this.initialized,

            dependencies: {

                repository:
                    repositoryAvailable,

                providerAdapter:
                    providerAdapterAvailable,

                ledgerEvidence:
                    ledgerEvidenceAvailable,

                financialTransactionService:
                    Boolean(
                        this.financialTransactionService
                    ),

                ledgerBridge:
                    Boolean(
                        this.ledgerBridge
                    ),

                idempotencyStore:
                    idempotencyConfigured,

                repairEngine:
                    Boolean(
                        this.repairEngine
                    ),

                auditService:
                    !this.auditService ||
                    typeof this.auditService.record ===
                    'function',

                eventPublisher:
                    Boolean(
                        (
                            this.outboxService &&
                            typeof this.outboxService.publish ===
                            'function'
                        ) ||
                        (
                            this.eventPublisher &&
                            typeof this.eventPublisher.publish ===
                            'function'
                        ) ||
                        (
                            this.eventBus &&
                            typeof this.eventBus.publish ===
                            'function'
                        )
                    )

            },

            lastExecution:
                this.healthState.lastExecution,

            lastError:
                this.healthState.lastError,

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

            amountScale:
                this.amountScale,

            amountToleranceMinor:
                this.amountTolerance.toString(),

            currency:
                this.currency

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

            initialized:
                this.initialized,

            configuration: {

                amountScale:
                    this.amountScale,

                amountToleranceMinor:
                    this.amountTolerance.toString(),

                currency:
                    this.currency,

                maxExceptions:
                    this.maxExceptions

            },

            statistics:
                this.stats(),

            health: {

                status:
                    this.healthState.status,

                startedAt:
                    this.healthState.startedAt,

                lastExecution:
                    this.healthState.lastExecution,

                lastError:
                    this.healthState.lastError

            }

        };
    }

    /**
     * =========================================================================
     * Numeric Configuration
     * =========================================================================
     */

    normalizeScale(
        scale
    ) {

        const numeric =
            Number(scale);

        if (
            !Number.isInteger(numeric) ||
            numeric < 0 ||
            numeric > 9
        ) {

            return DEFAULT_AMOUNT_SCALE;
        }

        return numeric;
    }

    normalizeTolerance(
        tolerance
    ) {

        try {

            return decimalToMinorUnits(
                tolerance,
                this.amountScale || DEFAULT_AMOUNT_SCALE
            );

        } catch {
            return BigInt(0);
        }
    }

    /**
     * =========================================================================
     * Activity / Error State
     * =========================================================================
     */

    now() {

        return new this.clock();
    }

    touchExecution() {

        this.healthState.lastExecution =
            this.now();

        this.healthState.lastError =
            null;

        if (
            this.initialized
        ) {

            this.healthState.status =
                'READY';
        }
    }

    setHealthError(
        error
    ) {

        this.healthState.lastError =
            safeError(
                error
            );

        if (
            this.initialized
        ) {

            this.healthState.status =
                'DEGRADED';
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
                    value !== undefined &&
                    value !== null
                ) {

                    span?.setAttribute?.(
                        key,
                        String(value)
                    );
                }
            }

            return span;

        } catch (error) {

            this.logger?.debug?.({

                component:
                    COMPONENT,

                provider:
                    PROVIDER,

                message:
                    'Failed to initialize Airtel reconciliation trace span',

                error:
                    safeError(error)

            });

            return null;
        }
    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {

        if (
            !this.repository
        ) {

            throw new Error(
                'Reconciliation repository missing'
            );
        }

        const repositoryCanCreate =
            typeof this.repository.createForTenant ===
                'function' ||
            typeof this.repository.create ===
                'function';

        if (
            !repositoryCanCreate
        ) {

            throw new Error(
                'Reconciliation repository create operation missing'
            );
        }

        const repositoryCanComplete =
            typeof this.repository.completeForTenant ===
                'function' ||
            typeof this.repository.complete ===
                'function' ||
            typeof this.repository.updateResult ===
                'function';

        if (
            !repositoryCanComplete
        ) {

            throw new Error(
                'Reconciliation repository completion operation missing'
            );
        }

        if (
            !this.providerAdapter ||
            typeof this.providerAdapter
                .getSettlementTransactions !==
            'function'
        ) {

            throw new Error(
                'Provider settlement transaction adapter missing'
            );
        }

        const ledgerEvidenceAvailable =
            (
                this.financialTransactionService &&
                typeof this.financialTransactionService
                    .getSettlementTransactions ===
                'function'
            ) ||
            (
                this.ledgerBridge &&
                typeof this.ledgerBridge
                    .getSettlementTransactions ===
                'function'
            );

        if (
            !ledgerEvidenceAvailable
        ) {

            throw new Error(
                'Authoritative ledger/financial evidence adapter missing'
            );
        }

        return true;
    }
}

module.exports = {

    ReconciliationEngine,

    RECONCILIATION_STATUS,

    MATCH_STATUS,

    RECONCILIATION_RESULT,

    VARIANCE_TYPE,

    SUCCESS_STATUSES,

    FAILURE_STATUSES,

    PROVIDER,

    COMPONENT,

    VERSION,

    decimalToMinorUnits
};