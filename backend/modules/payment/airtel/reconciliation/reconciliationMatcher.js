'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Reconciliation Matcher
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/reconciliation/reconciliationMatcher.js
 *
 * Architectural Role
 * ------------------
 * Deterministic transaction matching intelligence component used by the
 * Airtel reconciliation workflow.
 *
 * The matcher evaluates provider-side and internal financial evidence and
 * produces an explainable matching decision. It does not persist reconciliation
 * state and does not mutate financial records.
 *
 * Responsibilities
 * ----------------
 * - Match provider transactions to ledger/financial transactions.
 * - Apply deterministic multi-factor matching rules.
 * - Match exact transaction references.
 * - Match provider references and compatible reference aliases.
 * - Validate monetary amounts using exact decimal/minor-unit arithmetic.
 * - Validate currency.
 * - Apply configurable timestamp/date tolerance.
 * - Detect duplicate candidate records.
 * - Detect missing matches.
 * - Produce bounded confidence and match explanations.
 * - Produce explicit exception classifications.
 * - Support batch matching.
 * - Instrument metrics and tracing.
 * - Expose operational statistics and health.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Provider API communication.
 * - Provider authentication.
 * - Payment execution.
 * - Settlement execution.
 * - Reconciliation persistence.
 * - Ledger writes.
 * - Wallet/balance mutation.
 * - Accounting journal creation.
 * - Financial repair.
 * - Regulatory/compliance decisions.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. Matching is evidence analysis, never accounting.
 * 2. Money is never compared through floating-point arithmetic.
 * 3. Conflicting amounts or currencies cannot become MATCHED because of a
 *    strong reference score.
 * 4. Duplicate records are never silently overwritten.
 * 5. A missing identifier does not become an automatic match.
 * 6. A high score is not sufficient when a hard contradiction exists.
 * 7. Confidence is an explanatory signal, not authorization to post money.
 * 8. Returned transaction objects are sanitized projections rather than raw
 *    provider request/response payloads.
 *
 * Deterministic Matching Model
 * -----------------------------
 * Identifier evidence:
 * - Exact reference
 * - Provider reference
 * - Transaction/external reference aliases
 *
 * Financial evidence:
 * - Amount
 * - Currency
 *
 * Temporal evidence:
 * - Timestamp within configured tolerance
 *
 * Hard contradictions:
 * - Different currencies.
 * - Different amounts beyond configured tolerance.
 * - Explicit contradictory lifecycle state where configured.
 *
 * Recommended downstream interpretation:
 * - MATCHED: deterministic evidence agrees.
 * - PARTIAL_MATCH: meaningful evidence agrees but a final hard identifier is
 *   absent or the configured rules do not permit automatic acceptance.
 * - REVIEW: ambiguous or insufficient evidence.
 * - DUPLICATE: multiple materially equivalent candidates exist.
 * - MISSING: no candidate exists.
 * - FAILED: evidence directly contradicts.
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
const COMPONENT = 'ReconciliationMatcher';
const VERSION = '1.0.0';

const MATCH_RESULT = Object.freeze({

    MATCHED:
        'MATCHED',

    PARTIAL_MATCH:
        'PARTIAL_MATCH',

    FAILED:
        'FAILED',

    DUPLICATE:
        'DUPLICATE',

    MISSING:
        'MISSING',

    REVIEW:
        'REVIEW'

});

/**
 * Scores are explanatory weights. They are NOT probabilities.
 *
 * A result can never become MATCHED solely because the aggregate score is high:
 * hard financial contradictions are evaluated separately.
 */
const MATCH_RULES = Object.freeze({

    EXACT_REFERENCE:
        100,

    PROVIDER_REFERENCE:
        90,

    TRANSACTION_REFERENCE_ALIAS:
        80,

    AMOUNT:
        40,

    CURRENCY:
        20,

    DATE:
        10

});

const DEFAULT_TOLERANCE = Object.freeze({

    amount:
        '0',

    days:
        1

});

const DEFAULT_AMOUNT_SCALE = 2;
const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_MIN_MATCH_SCORE = 100;
const DEFAULT_PARTIAL_SCORE = 70;
const DEFAULT_REVIEW_SCORE = 40;

const MAX_REASON_COUNT = 25;
const MAX_CANDIDATES = 100;
const MAX_BATCH_RESULTS = 100_000;
const MAX_STRING_LENGTH = 512;

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

    return {

        name:
            truncate(
                error?.name || 'Error',
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

function normalizeReference(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const normalized =
        String(value)
            .trim();

    return normalized
        ? truncate(normalized, 256)
        : null;
}

function normalizeCurrency(
    value,
    fallback = DEFAULT_CURRENCY
) {

    const normalized =
        String(
            value ||
            fallback
        )
            .trim()
            .toUpperCase();

    return truncate(
        normalized,
        16
    );
}

function normalizeAmountString(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const normalized =
        String(value)
            .trim();

    return normalized
        ? normalized
        : null;
}

/**
 * Exact decimal-to-minor-unit conversion.
 *
 * No Number() conversion is performed for monetary comparisons.
 */
function decimalToMinorUnits(
    value,
    scale
) {

    const amount =
        normalizeAmountString(
            value
        );

    if (!amount) {
        throw new Error(
            'Amount is required'
        );
    }

    if (
        !/^\d+(?:\.\d+)?$/.test(
            amount
        )
    ) {

        throw new Error(
            `Invalid monetary amount: ${amount}`
        );
    }

    const [
        integerPart,
        fractionPart = ''
    ] =
        amount.split('.');

    if (
        fractionPart.length > scale
    ) {

        throw new Error(
            `Amount exceeds configured precision of ${scale} decimal places`
        );
    }

    const normalizedFraction =
        fractionPart.padEnd(
            scale,
            '0'
        );

    return BigInt(
        `${integerPart}${normalizedFraction}`
    );
}

function normalizeStatus(
    transaction
) {

    const value =
        transaction?.status ??
        transaction?.state;

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    return truncate(
        String(value)
            .trim()
            .toUpperCase(),
        128
    );
}

function extractIdentifiers(
    transaction
) {

    const identifiers = [];

    const candidates = [

        {
            field:
                'reference',

            value:
                transaction?.reference
        },

        {
            field:
                'providerReference',

            value:
                transaction?.providerReference
        },

        {
            field:
                'transactionReference',

            value:
                transaction?.transactionReference
        },

        {
            field:
                'externalReference',

            value:
                transaction?.externalReference
        },

        {
            field:
                'externalId',

            value:
                transaction?.externalId
        },

        {
            field:
                'providerTransactionId',

            value:
                transaction?.providerTransactionId
        },

        {
            field:
                'providerTransactionReference',

            value:
                transaction?.providerTransactionReference
        },

        {
            field:
                'receiptNumber',

            value:
                transaction?.receiptNumber
        }

    ];

    const seen =
        new Set();

    for (
        const candidate of candidates
    ) {

        const value =
            normalizeReference(
                candidate.value
            );

        if (
            !value ||
            seen.has(value)
        ) {
            continue;
        }

        seen.add(value);

        identifiers.push({

            field:
                candidate.field,

            value

        });
    }

    return identifiers;
}

function extractPrimaryReference(
    transaction
) {

    return (
        normalizeReference(
            transaction?.reference
        ) ||
        normalizeReference(
            transaction?.providerReference
        ) ||
        normalizeReference(
            transaction?.transactionReference
        ) ||
        normalizeReference(
            transaction?.externalReference
        ) ||
        normalizeReference(
            transaction?.externalId
        )
    );
}

function safeTransaction(
    transaction
) {

    if (
        transaction === null ||
        transaction === undefined
    ) {
        return null;
    }

    return sanitizeValue({

        id:
            transaction.id ??
            transaction._id ??
            transaction.transactionId ??
            transaction.providerTransactionId,

        reference:
            transaction.reference,

        providerReference:
            transaction.providerReference,

        transactionReference:
            transaction.transactionReference,

        externalReference:
            transaction.externalReference,

        externalId:
            transaction.externalId,

        providerTransactionId:
            transaction.providerTransactionId,

        amount:
            transaction.amount,

        currency:
            transaction.currency,

        status:
            transaction.status ??
            transaction.state,

        transactionType:
            transaction.transactionType,

        settlementReference:
            transaction.settlementReference,

        createdAt:
            transaction.createdAt,

        occurredAt:
            transaction.occurredAt,

        transactionDate:
            transaction.transactionDate

    });
}

class ReconciliationMatcher {

    constructor({

        logger,

        metrics,

        tracer,

        tolerance = DEFAULT_TOLERANCE,

        clock = Date,

        amountScale =
            process.env.AIRTEL_RECONCILIATION_AMOUNT_SCALE ||
            DEFAULT_AMOUNT_SCALE,

        currency =
            process.env.AIRTEL_RECONCILIATION_CURRENCY ||
            DEFAULT_CURRENCY,

        minMatchScore =
            DEFAULT_MIN_MATCH_SCORE,

        partialScore =
            DEFAULT_PARTIAL_SCORE,

        reviewScore =
            DEFAULT_REVIEW_SCORE,

        requireCurrency =
            true,

        requireAmount =
            true,

        requireTemporalAgreement =
            false,

        allowStatusConflict =
            false,

        maxCandidates =
            MAX_CANDIDATES

    } = {}) {

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.clock =
            clock;

        this.amountScale =
            this.normalizeScale(
                amountScale
            );

        this.currency =
            normalizeCurrency(
                currency
            );

        this.tolerance = {

            amount:
                this.normalizeAmountTolerance(
                    tolerance?.amount ?? '0'
                ),

            days:
                this.normalizeDaysTolerance(
                    tolerance?.days ?? 1
                )

        };

        this.minMatchScore =
            Math.max(
                1,
                Number(minMatchScore) ||
                    DEFAULT_MIN_MATCH_SCORE
            );

        this.partialScore =
            Math.max(
                0,
                Number(partialScore) ||
                    DEFAULT_PARTIAL_SCORE
            );

        this.reviewScore =
            Math.max(
                0,
                Number(reviewScore) ||
                    DEFAULT_REVIEW_SCORE
            );

        this.requireCurrency =
            Boolean(
                requireCurrency
            );

        this.requireAmount =
            Boolean(
                requireAmount
            );

        this.requireTemporalAgreement =
            Boolean(
                requireTemporalAgreement
            );

        this.allowStatusConflict =
            Boolean(
                allowStatusConflict
            );

        this.maxCandidates =
            Math.max(
                1,
                Math.floor(
                    Number(maxCandidates) ||
                    MAX_CANDIDATES
                )
            );

        this.statistics = {

            comparisons:
                0,

            matched:
                0,

            partialMatches:
                0,

            failed:
                0,

            duplicates:
                0,

            missing:
                0,

            reviews:
                0,

            amountMismatches:
                0,

            currencyMismatches:
                0,

            dateMismatches:
                0

        };
    }

    /**
     * =========================================================================
     * Match Single Transaction
     * =========================================================================
     */

    match({

        providerTransaction,

        ledgerTransaction,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        const span =
            this.startSpan(
                'airtel.reconciliation.matcher.match',
                {
                    correlationId
                }
            );

        try {

            this.statistics.comparisons++;

            if (
                !providerTransaction ||
                !ledgerTransaction
            ) {

                this.statistics.missing++;

                return this.createResult({

                    status:
                        MATCH_RESULT.MISSING,

                    score:
                        0,

                    reasons: [
                        !providerTransaction
                            ? 'PROVIDER_TRANSACTION_MISSING'
                            : null,

                        !ledgerTransaction
                            ? 'LEDGER_TRANSACTION_MISSING'
                            : null

                    ].filter(Boolean),

                    providerTransaction,
                    ledgerTransaction,

                    correlationId

                });
            }

            const analysis =
                this.evaluatePair({
                    providerTransaction,
                    ledgerTransaction
                });

            this.recordStatistics(
                analysis.status
            );

            return this.createResult({

                status:
                    analysis.status,

                score:
                    analysis.score,

                reasons:
                    analysis.reasons,

                ruleMatches:
                    analysis.ruleMatches,

                contradictions:
                    analysis.contradictions,

                evidence:
                    analysis.evidence,

                providerTransaction,
                ledgerTransaction,

                correlationId

            });

        } catch (error) {

            this.statistics.failed++;

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Airtel reconciliation pair matching failed',

                correlationId,

                error:
                    safeError(error)

            });

            throw normalizeError(
                error,
                {
                    metadata: {

                        operation:
                            'airtel_reconciliation_match'

                    }
                }
            );

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Batch Matching
     * =========================================================================
     */

    matchBatch({

        providerTransactions = [],

        ledgerTransactions = [],

        correlationId =
            crypto.randomUUID()

    } = {}) {

        if (
            !Array.isArray(providerTransactions) ||
            !Array.isArray(ledgerTransactions)
        ) {

            throw new TypeError(
                'Provider and ledger transactions must be arrays'
            );
        }

        if (
            providerTransactions.length >
            MAX_BATCH_RESULTS ||
            ledgerTransactions.length >
            MAX_BATCH_RESULTS
        ) {

            throw new RangeError(
                'Transaction batch exceeds the supported reconciliation limit'
            );
        }

        const ledgerIndex =
            this.buildLedgerIndex(
                ledgerTransactions
            );

        const results = [];

        const matchedLedgerIds =
            new Set();

        for (
            const providerTransaction of
            providerTransactions
        ) {

            const candidates =
                this.findCandidates(
                    providerTransaction,
                    ledgerIndex
                );

            if (
                candidates.length === 0
            ) {

                this.statistics.missing++;

                results.push(
                    this.createResult({

                        status:
                            MATCH_RESULT.MISSING,

                        score:
                            0,

                        reasons: [
                            'NO_LEDGER_CANDIDATE'
                        ],

                        providerTransaction,

                        correlationId

                    })
                );

                continue;
            }

            if (
                candidates.length > 1
            ) {

                const candidateResults =
                    candidates
                        .slice(
                            0,
                            this.maxCandidates
                        )
                        .map(
                            candidate =>
                                this.match({
                                    providerTransaction,
                                    ledgerTransaction:
                                        candidate,
                                    correlationId
                                })
                        );

                const ranked =
                    this.rankCandidates(
                        candidateResults
                    );

                const top =
                    ranked[0];

                const second =
                    ranked[1];

                /*
                 * If two candidates are effectively tied, automatic matching
                 * is unsafe. The matcher deliberately returns DUPLICATE/REVIEW
                 * rather than arbitrarily choosing one.
                 */
                if (
                    top &&
                    second &&
                    top.score ===
                        second.score
                ) {

                    this.statistics.duplicates++;

                    results.push(
                        this.createResult({

                            status:
                                MATCH_RESULT.DUPLICATE,

                            score:
                                top.score,

                            reasons: [
                                'AMBIGUOUS_TOP_CANDIDATES'
                            ],

                            contradictions:
                                [
                                    ...(top.contradictions || []),
                                    ...(second.contradictions || [])
                                ]
                                    .slice(
                                        0,
                                        MAX_REASON_COUNT
                                    ),

                            evidence: {

                                candidateCount:
                                    candidates.length,

                                topCandidateScore:
                                    top.score,

                                secondCandidateScore:
                                    second.score

                            },

                            providerTransaction,

                            ledgerTransaction:
                                null,

                            correlationId

                        })
                    );

                    continue;
                }

                if (
                    top?.status ===
                    MATCH_RESULT.MATCHED
                ) {

                    const ledgerIdentity =
                        this.transactionIdentity(
                            top.ledgerTransaction
                        );

                    if (
                        ledgerIdentity &&
                        matchedLedgerIds.has(
                            ledgerIdentity
                        )
                    ) {

                        this.statistics.duplicates++;

                        results.push(
                            this.createResult({

                                status:
                                    MATCH_RESULT.DUPLICATE,

                                score:
                                    top.score,

                                reasons: [
                                    'LEDGER_CANDIDATE_ALREADY_MATCHED'
                                ],

                                providerTransaction,

                                ledgerTransaction:
                                    top.ledgerTransaction,

                                correlationId

                            })
                        );

                        continue;
                    }

                    if (
                        ledgerIdentity
                    ) {

                        matchedLedgerIds.add(
                            ledgerIdentity
                        );
                    }
                }

                results.push(
                    top
                );

                continue;
            }

            const result =
                this.match({

                    providerTransaction,

                    ledgerTransaction:
                        candidates[0],

                    correlationId

                });

            if (
                result.status ===
                MATCH_RESULT.MATCHED
            ) {

                const ledgerIdentity =
                    this.transactionIdentity(
                        candidates[0]
                    );

                if (
                    ledgerIdentity &&
                    matchedLedgerIds.has(
                        ledgerIdentity
                    )
                ) {

                    this.statistics.duplicates++;

                    results.push(
                        this.createResult({

                            status:
                                MATCH_RESULT.DUPLICATE,

                            score:
                                result.score,

                            reasons: [
                                'LEDGER_CANDIDATE_ALREADY_MATCHED'
                            ],

                            providerTransaction,

                            ledgerTransaction:
                                candidates[0],

                            correlationId

                        })
                    );

                    continue;
                }

                if (
                    ledgerIdentity
                ) {

                    matchedLedgerIds.add(
                        ledgerIdentity
                    );
                }
            }

            results.push(
                result
            );
        }

        return results;
    }

    /**
     * =========================================================================
     * Candidate Discovery
     * =========================================================================
     */

    findCandidates(
        transaction,
        index
    ) {

        if (
            !transaction ||
            !(index instanceof Map)
        ) {
            return [];
        }

        const keys =
            this.extractCandidateKeys(
                transaction
            );

        const candidateMap =
            new Map();

        for (
            const key of keys
        ) {

            const records =
                index.get(
                    key
                ) || [];

            for (
                const record of records
            ) {

                const identity =
                    this.transactionIdentity(
                        record
                    ) ||
                    crypto
                        .createHash('sha256')
                        .update(
                            JSON.stringify(
                                this.safeTransaction(
                                    record
                                )
                            )
                        )
                        .digest('hex');

                candidateMap.set(
                    identity,
                    record
                );

                if (
                    candidateMap.size >=
                    this.maxCandidates
                ) {
                    break;
                }
            }

            if (
                candidateMap.size >=
                this.maxCandidates
            ) {
                break;
            }
        }

        return [
            ...candidateMap.values()
        ];
    }

    extractCandidateKeys(
        transaction
    ) {

        return [
            ...new Set(
                extractIdentifiers(
                    transaction
                )
                    .map(
                        item =>
                            item.value
                    )
            )
        ];
    }

    /**
     * =========================================================================
     * Build Ledger Index
     * =========================================================================
     *
     * Map<string, Array<Transaction>> is mandatory here. A simple
     * Map<string, Transaction> silently overwrites duplicates and destroys
     * evidence needed by reconciliation.
     */

    buildLedgerIndex(
        transactions
    ) {

        const index =
            new Map();

        for (
            const transaction of
            transactions
        ) {

            const identifiers =
                extractIdentifiers(
                    transaction
                );

            for (
                const identifier of
                identifiers
            ) {

                const current =
                    index.get(
                        identifier.value
                    ) || [];

                current.push(
                    transaction
                );

                index.set(
                    identifier.value,
                    current
                );
            }
        }

        return index;
    }

    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */

    detectDuplicates(
        transactions = []
    ) {

        if (
            !Array.isArray(
                transactions
            )
        ) {

            throw new TypeError(
                'transactions must be an array'
            );
        }

        const groups =
            new Map();

        for (
            const transaction of
            transactions
        ) {

            const fingerprint =
                this.generateFingerprint(
                    transaction
                );

            const current =
                groups.get(
                    fingerprint
                ) || [];

            current.push(
                transaction
            );

            groups.set(
                fingerprint,
                current
            );
        }

        const duplicates = [];

        for (
            const [
                fingerprint,
                records
            ] of groups.entries()
        ) {

            if (
                records.length <= 1
            ) {
                continue;
            }

            this.statistics.duplicates++;

            duplicates.push({

                fingerprint,

                count:
                    records.length,

                transactions:
                    records.map(
                        record =>
                            this.safeTransaction(
                                record
                            )
                    )

            });
        }

        return duplicates;
    }

    /**
     * =========================================================================
     * Fingerprint Generator
     * =========================================================================
     */

    generateFingerprint(
        transaction
    ) {

        const normalized = {

            reference:
                normalizeReference(
                    transaction?.reference
                ),

            providerReference:
                normalizeReference(
                    transaction?.providerReference
                ),

            transactionReference:
                normalizeReference(
                    transaction?.transactionReference
                ),

            amount:
                normalizeAmountString(
                    transaction?.amount
                ),

            currency:
                normalizeCurrency(
                    transaction?.currency,
                    this.currency
                ),

            transactionType:
                transaction?.transactionType
                    ? truncate(
                        String(
                            transaction.transactionType
                        )
                            .trim()
                            .toUpperCase(),
                        128
                    )
                    : null

        };

        return crypto
            .createHash('sha256')
            .update(
                JSON.stringify(
                    normalized
                )
            )
            .digest('hex');
    }

    /**
     * =========================================================================
     * Pair Evaluation
     * =========================================================================
     */

    evaluatePair({

        providerTransaction,

        ledgerTransaction

    }) {

        let score = 0;

        const reasons = [];
        const ruleMatches = [];
        const contradictions = [];

        const providerIdentifiers =
            extractIdentifiers(
                providerTransaction
            );

        const ledgerIdentifiers =
            extractIdentifiers(
                ledgerTransaction
            );

        const providerIdentifierMap =
            new Map(
                providerIdentifiers.map(
                    item => [
                        item.field,
                        item.value
                    ]
                )
            );

        const ledgerIdentifierMap =
            new Map(
                ledgerIdentifiers.map(
                    item => [
                        item.field,
                        item.value
                    ]
                )
            );

        const exactReference =
            providerIdentifierMap.get(
                'reference'
            ) &&
            providerIdentifierMap.get(
                'reference'
            ) ===
            ledgerIdentifierMap.get(
                'reference'
            );

        const providerReference =
            providerIdentifierMap.get(
                'providerReference'
            ) &&
            providerIdentifierMap.get(
                'providerReference'
            ) ===
            ledgerIdentifierMap.get(
                'providerReference'
            );

        const aliasReference =
            this.referencesIntersect(
                providerIdentifiers,
                ledgerIdentifiers
            );

        if (exactReference) {

            score +=
                MATCH_RULES.EXACT_REFERENCE;

            reasons.push(
                'REFERENCE_MATCH'
            );

            ruleMatches.push(
                'EXACT_REFERENCE'
            );

        } else if (
            providerReference
        ) {

            score +=
                MATCH_RULES.PROVIDER_REFERENCE;

            reasons.push(
                'PROVIDER_REFERENCE_MATCH'
            );

            ruleMatches.push(
                'PROVIDER_REFERENCE'
            );

        } else if (
            aliasReference
        ) {

            score +=
                MATCH_RULES.TRANSACTION_REFERENCE_ALIAS;

            reasons.push(
                'REFERENCE_ALIAS_MATCH'
            );

            ruleMatches.push(
                'TRANSACTION_REFERENCE_ALIAS'
            );
        }

        const amountComparison =
            this.compareAmountValues(
                providerTransaction.amount,
                ledgerTransaction.amount
            );

        if (
            amountComparison.valid
        ) {

            if (
                amountComparison.matches
            ) {

                score +=
                    MATCH_RULES.AMOUNT;

                reasons.push(
                    'AMOUNT_MATCH'
                );

                ruleMatches.push(
                    'AMOUNT'
                );

            } else {

                contradictions.push(
                    'AMOUNT_MISMATCH'
                );

                this.statistics.amountMismatches++;
            }

        } else {

            contradictions.push(
                'AMOUNT_INVALID_OR_MISSING'
            );
        }

        const providerCurrency =
            normalizeCurrency(
                providerTransaction.currency,
                this.currency
            );

        const ledgerCurrency =
            normalizeCurrency(
                ledgerTransaction.currency,
                this.currency
            );

        const currencyMatches =
            providerCurrency ===
            ledgerCurrency;

        if (
            currencyMatches
        ) {

            score +=
                MATCH_RULES.CURRENCY;

            reasons.push(
                'CURRENCY_MATCH'
            );

            ruleMatches.push(
                'CURRENCY'
            );

        } else {

            contradictions.push(
                'CURRENCY_MISMATCH'
            );

            this.statistics.currencyMismatches++;
        }

        const dateComparison =
            this.compareDates(
                this.extractDate(
                    providerTransaction
                ),
                this.extractDate(
                    ledgerTransaction
                )
            );

        if (
            dateComparison.valid
        ) {

            if (
                dateComparison.matches
            ) {

                score +=
                    MATCH_RULES.DATE;

                reasons.push(
                    'DATE_MATCH'
                );

                ruleMatches.push(
                    'DATE'
                );

            } else {

                contradictions.push(
                    'DATE_OUTSIDE_TOLERANCE'
                );

                this.statistics.dateMismatches++;
            }
        }

        const statusComparison =
            this.compareLifecycleStatuses(
                providerTransaction,
                ledgerTransaction
            );

        if (
            statusComparison.conflict
        ) {

            contradictions.push(
                'LIFECYCLE_STATUS_CONFLICT'
            );
        }

        const hardContradiction =
            this.hasHardContradiction({
                amountComparison,
                currencyMatches,
                statusComparison,
                exactReference,
                providerReference,
                aliasReference
            });

        const status =
            this.resolveStatus({
                score,
                hardContradiction,
                amountComparison,
                currencyMatches,
                dateComparison,
                statusComparison,
                exactReference,
                providerReference,
                aliasReference
            });

        return {

            status,

            score,

            reasons:
                [
                    ...new Set(
                        reasons
                    )
                ]
                    .slice(
                        0,
                        MAX_REASON_COUNT
                    ),

            ruleMatches:
                [
                    ...new Set(
                        ruleMatches
                    )
                ],

            contradictions:
                [
                    ...new Set(
                        contradictions
                    )
                ]
                    .slice(
                        0,
                        MAX_REASON_COUNT
                    ),

            evidence: {

                reference: {

                    exact:
                        Boolean(
                            exactReference
                        ),

                    provider:
                        Boolean(
                            providerReference
                        ),

                    alias:
                        Boolean(
                            aliasReference
                        )

                },

                amount:
                    amountComparison,

                currency: {

                    provider:
                        providerCurrency,

                    ledger:
                        ledgerCurrency,

                    matches:
                        currencyMatches

                },

                date:
                    dateComparison,

                status:
                    statusComparison

            }

        };
    }

    /**
     * =========================================================================
     * Amount Comparison
     * =========================================================================
     */

    amountMatches(
        providerAmount,
        ledgerAmount
    ) {

        return this.compareAmountValues(
            providerAmount,
            ledgerAmount
        ).matches;
    }

    compareAmountValues(
        providerAmount,
        ledgerAmount
    ) {

        try {

            if (
                providerAmount === null ||
                providerAmount === undefined ||
                ledgerAmount === null ||
                ledgerAmount === undefined
            ) {

                return {

                    valid:
                        false,

                    matches:
                        false,

                    differenceMinor:
                        null,

                    toleranceMinor:
                        this.tolerance.amount
                            .toString()

                };
            }

            const providerMinor =
                decimalToMinorUnits(
                    providerAmount,
                    this.amountScale
                );

            const ledgerMinor =
                decimalToMinorUnits(
                    ledgerAmount,
                    this.amountScale
                );

            const difference =
                providerMinor >=
                ledgerMinor
                    ? providerMinor -
                        ledgerMinor
                    : ledgerMinor -
                        providerMinor;

            return {

                valid:
                    true,

                matches:
                    difference <=
                    this.tolerance.amount,

                providerMinor:
                    providerMinor.toString(),

                ledgerMinor:
                    ledgerMinor.toString(),

                differenceMinor:
                    difference.toString(),

                toleranceMinor:
                    this.tolerance.amount
                        .toString()

            };

        } catch {

            return {

                valid:
                    false,

                matches:
                    false,

                differenceMinor:
                    null,

                toleranceMinor:
                    this.tolerance.amount
                        .toString()

            };
        }
    }

    /**
     * =========================================================================
     * Date Comparison
     * =========================================================================
     */

    dateMatches(
        providerDate,
        ledgerDate
    ) {

        return this.compareDates(
            providerDate,
            ledgerDate
        ).matches;
    }

    compareDates(
        providerDate,
        ledgerDate
    ) {

        if (
            !providerDate ||
            !ledgerDate
        ) {

            return {

                valid:
                    false,

                matches:
                    false,

                differenceMs:
                    null,

                differenceDays:
                    null,

                toleranceDays:
                    this.tolerance.days

            };
        }

        const providerTimestamp =
            new Date(
                providerDate
            ).getTime();

        const ledgerTimestamp =
            new Date(
                ledgerDate
            ).getTime();

        if (
            !Number.isFinite(
                providerTimestamp
            ) ||
            !Number.isFinite(
                ledgerTimestamp
            )
        ) {

            return {

                valid:
                    false,

                matches:
                    false,

                differenceMs:
                    null,

                differenceDays:
                    null,

                toleranceDays:
                    this.tolerance.days

            };
        }

        const differenceMs =
            Math.abs(
                providerTimestamp -
                ledgerTimestamp
            );

        const toleranceMs =
            this.tolerance.days *
            86_400_000;

        return {

            valid:
                true,

            matches:
                differenceMs <=
                toleranceMs,

            differenceMs,

            differenceDays:
                differenceMs /
                86_400_000,

            toleranceDays:
                this.tolerance.days

        };
    }

    /**
     * =========================================================================
     * Status Comparison
     * =========================================================================
     */

    compareLifecycleStatuses(
        providerTransaction,
        ledgerTransaction
    ) {

        const providerStatus =
            normalizeStatus(
                providerTransaction
            );

        const ledgerStatus =
            normalizeStatus(
                ledgerTransaction
            );

        if (
            !providerStatus ||
            !ledgerStatus
        ) {

            return {

                comparable:
                    false,

                conflict:
                    false,

                providerStatus,

                ledgerStatus

            };
        }

        const providerSuccess =
            SUCCESS_STATUSES.has(
                providerStatus
            );

        const ledgerSuccess =
            SUCCESS_STATUSES.has(
                ledgerStatus
            );

        const providerFailure =
            FAILURE_STATUSES.has(
                providerStatus
            );

        const ledgerFailure =
            FAILURE_STATUSES.has(
                ledgerStatus
            );

        const conflict =
            (
                providerSuccess &&
                ledgerFailure
            ) ||
            (
                providerFailure &&
                ledgerSuccess
            );

        return {

            comparable:
                true,

            conflict:
                !this.allowStatusConflict &&
                conflict,

            providerStatus,

            ledgerStatus,

            providerSuccess,

            ledgerSuccess,

            providerFailure,

            ledgerFailure

        };
    }

    /**
     * =========================================================================
     * Resolve Match Status
     * =========================================================================
     */

    resolveStatus({

        score,

        hardContradiction,

        amountComparison,

        currencyMatches,

        dateComparison,

        statusComparison,

        exactReference,

        providerReference,

        aliasReference

    }) {

        if (
            hardContradiction
        ) {

            /*
             * If the transaction is strongly identified but financially
             * contradictory, REVIEW is safer than FAILED: downstream
             * reconciliation must decide whether the discrepancy represents
             * timing, adjustment, reversal or data corruption.
             */
            if (
                exactReference ||
                providerReference ||
                aliasReference
            ) {

                return MATCH_RESULT.REVIEW;
            }

            return MATCH_RESULT.FAILED;
        }

        const identifierMatch =
            Boolean(
                exactReference ||
                providerReference ||
                aliasReference
            );

        const amountMatch =
            Boolean(
                amountComparison?.matches
            );

        const currencyMatch =
            Boolean(
                currencyMatches
            );

        const temporalMatch =
            Boolean(
                dateComparison?.matches
            );

        if (
            exactReference &&
            amountMatch &&
            currencyMatch &&
            (
                temporalMatch ||
                !this.requireTemporalAgreement ||
                !dateComparison.valid
            )
        ) {

            return MATCH_RESULT.MATCHED;
        }

        if (
            identifierMatch &&
            amountMatch &&
            currencyMatch &&
            score >=
                this.minMatchScore
        ) {

            if (
                this.requireTemporalAgreement &&
                dateComparison.valid &&
                !temporalMatch
            ) {

                return MATCH_RESULT.PARTIAL_MATCH;
            }

            return MATCH_RESULT.MATCHED;
        }

        if (
            identifierMatch &&
            amountMatch &&
            currencyMatch &&
            score >=
                this.partialScore
        ) {

            return MATCH_RESULT.PARTIAL_MATCH;
        }

        if (
            score >=
            this.reviewScore
        ) {

            return MATCH_RESULT.REVIEW;
        }

        return MATCH_RESULT.FAILED;
    }

    /**
     * =========================================================================
     * Hard Contradictions
     * =========================================================================
     */

    hasHardContradiction({

        amountComparison,

        currencyMatches,

        statusComparison

    }) {

        if (
            this.requireAmount &&
            (
                !amountComparison?.valid ||
                !amountComparison?.matches
            )
        ) {

            return true;
        }

        if (
            this.requireCurrency &&
            !currencyMatches
        ) {

            return true;
        }

        if (
            statusComparison?.conflict
        ) {

            return true;
        }

        return false;
    }

    /**
     * =========================================================================
     * Reference Intersection
     * =========================================================================
     */

    referencesIntersect(
        providerIdentifiers,
        ledgerIdentifiers
    ) {

        const providerValues =
            new Set(
                providerIdentifiers.map(
                    item =>
                        item.value
                )
            );

        return ledgerIdentifiers.some(
            item =>
                providerValues.has(
                    item.value
                )
        );
    }

    /**
     * =========================================================================
     * Candidate Ranking
     * =========================================================================
     */

    rankCandidates(
        results
    ) {

        return [
            ...results
        ].sort(
            (
                left,
                right
            ) => {

                const leftPriority =
                    this.statusPriority(
                        left.status
                    );

                const rightPriority =
                    this.statusPriority(
                        right.status
                    );

                if (
                    leftPriority !==
                    rightPriority
                ) {

                    return (
                        rightPriority -
                        leftPriority
                    );
                }

                return (
                    right.score -
                    left.score
                );
            }
        );
    }

    statusPriority(
        status
    ) {

        switch (status) {

            case MATCH_RESULT.MATCHED:
                return 5;

            case MATCH_RESULT.PARTIAL_MATCH:
                return 4;

            case MATCH_RESULT.REVIEW:
                return 3;

            case MATCH_RESULT.DUPLICATE:
                return 2;

            case MATCH_RESULT.MISSING:
                return 1;

            default:
                return 0;
        }
    }

    /**
     * =========================================================================
     * Result Builder
     * =========================================================================
     */

    createResult({

        status,

        score = 0,

        reasons = [],

        ruleMatches = [],

        contradictions = [],

        evidence = null,

        providerTransaction = null,

        ledgerTransaction = null,

        correlationId = null

    } = {}) {

        const normalizedScore =
            Math.max(
                0,
                Number(score) || 0
            );

        return {

            matchId:
                crypto.randomUUID(),

            provider:
                PROVIDER,

            status,

            score:
                normalizedScore,

            confidence:
                this.confidenceFromScore(
                    normalizedScore
                ),

            reasons:
                [
                    ...new Set(
                        reasons
                    )
                ]
                    .slice(
                        0,
                        MAX_REASON_COUNT
                    ),

            ruleMatches:
                [
                    ...new Set(
                        ruleMatches
                    )
                ]
                    .slice(
                        0,
                        MAX_REASON_COUNT
                    ),

            contradictions:
                [
                    ...new Set(
                        contradictions
                    )
                ]
                    .slice(
                        0,
                        MAX_REASON_COUNT
                    ),

            evidence:
                evidence
                    ? sanitizeValue(
                        evidence
                    )
                    : null,

            providerTransaction:
                safeTransaction(
                    providerTransaction
                ),

            ledgerTransaction:
                safeTransaction(
                    ledgerTransaction
                ),

            correlationId,

            timestamp:
                this.now()

        };
    }

    confidenceFromScore(
        score
    ) {

        /*
         * This is an explanatory normalized score, not a statistical
         * probability. The maximum is intentionally capped at 100.
         */
        return Math.min(
            Math.max(
                0,
                Math.round(
                    score
                )
            ),
            100
        );
    }

    /**
     * =========================================================================
     * Transaction Identity
     * =========================================================================
     */

    transactionIdentity(
        transaction
    ) {

        const explicitId =
            transaction?.id ??
            transaction?._id ??
            transaction?.transactionId ??
            transaction?.providerTransactionId;

        if (
            explicitId !== null &&
            explicitId !== undefined
        ) {

            return truncate(
                String(explicitId),
                256
            );
        }

        const fingerprint =
            this.generateFingerprint(
                transaction
            );

        return fingerprint || null;
    }

    extractDate(
        transaction
    ) {

        return (
            transaction?.occurredAt ??
            transaction?.transactionDate ??
            transaction?.createdAt ??
            transaction?.processedAt ??
            null
        );
    }

    /**
     * =========================================================================
     * Configuration Normalization
     * =========================================================================
     */

    normalizeScale(
        value
    ) {

        const numeric =
            Number(value);

        if (
            !Number.isInteger(
                numeric
            ) ||
            numeric < 0 ||
            numeric > 9
        ) {

            return DEFAULT_AMOUNT_SCALE;
        }

        return numeric;
    }

    normalizeAmountTolerance(
        value
    ) {

        try {

            return decimalToMinorUnits(
                value,
                this.amountScale
            );

        } catch {

            return BigInt(0);
        }
    }

    normalizeDaysTolerance(
        value
    ) {

        const numeric =
            Number(value);

        if (
            !Number.isFinite(
                numeric
            ) ||
            numeric < 0
        ) {

            return 1;
        }

        return numeric;
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    recordStatistics(
        status
    ) {

        switch (status) {

            case MATCH_RESULT.MATCHED:

                this.statistics.matched++;

                break;

            case MATCH_RESULT.PARTIAL_MATCH:

                this.statistics.partialMatches++;

                break;

            case MATCH_RESULT.DUPLICATE:

                this.statistics.duplicates++;

                break;

            case MATCH_RESULT.MISSING:

                this.statistics.missing++;

                break;

            case MATCH_RESULT.REVIEW:

                this.statistics.reviews++;

                break;

            default:

                this.statistics.failed++;
        }
    }

    stats() {

        return {

            ...this.statistics,

            amountScale:
                this.amountScale,

            amountToleranceMinor:
                this.tolerance.amount
                    .toString(),

            dateToleranceDays:
                this.tolerance.days,

            minMatchScore:
                this.minMatchScore,

            partialScore:
                this.partialScore,

            reviewScore:
                this.reviewScore,

            requireAmount:
                this.requireAmount,

            requireCurrency:
                this.requireCurrency,

            requireTemporalAgreement:
                this.requireTemporalAgreement

        };
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        const configurationValid =
            this.amountScale >= 0 &&
            this.amountScale <= 9 &&
            this.tolerance.days >= 0 &&
            this.tolerance.amount >=
                BigInt(0);

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            status:
                configurationValid
                    ? 'UP'
                    : 'DOWN',

            configuration: {

                amountScale:
                    this.amountScale,

                currency:
                    this.currency,

                amountToleranceMinor:
                    this.tolerance.amount
                        .toString(),

                dateToleranceDays:
                    this.tolerance.days

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

            matchingModel: {

                exactReferenceWeight:
                    MATCH_RULES.EXACT_REFERENCE,

                providerReferenceWeight:
                    MATCH_RULES.PROVIDER_REFERENCE,

                referenceAliasWeight:
                    MATCH_RULES.TRANSACTION_REFERENCE_ALIAS,

                amountWeight:
                    MATCH_RULES.AMOUNT,

                currencyWeight:
                    MATCH_RULES.CURRENCY,

                dateWeight:
                    MATCH_RULES.DATE

            },

            controls: {

                requireAmount:
                    this.requireAmount,

                requireCurrency:
                    this.requireCurrency,

                requireTemporalAgreement:
                    this.requireTemporalAgreement,

                allowStatusConflict:
                    this.allowStatusConflict,

                maxCandidates:
                    this.maxCandidates

            },

            statistics:
                this.stats()

        };
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

        } catch (error) {

            this.logger?.debug?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Unable to start Airtel reconciliation matcher span',

                error:
                    safeError(error)

            });

            return null;
        }
    }
}

module.exports = {

    ReconciliationMatcher,

    MATCH_RESULT,

    MATCH_RULES,

    DEFAULT_TOLERANCE,

    SUCCESS_STATUSES,

    FAILURE_STATUSES,

    PROVIDER,

    COMPONENT,

    VERSION,

    decimalToMinorUnits
};