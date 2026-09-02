'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * AML Screening Pipeline
 * ============================================================================
 *
 * Enterprise Anti-Money Laundering transaction screening pipeline.
 *
 * Responsibilities
 * ----------------
 * • Customer blacklist screening
 * • Transaction threshold screening
 * • AML finding generation
 * • Risk classification
 * • Review/block decisions
 * • Tenant isolation
 * • Correlation ID propagation
 * • Screening versioning
 * • Idempotent screening support
 * • Structured logging
 * • Metrics instrumentation
 * • Audit hooks
 * • Operational diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Final regulatory reporting
 * • STR/CTR filing
 * • Sanctions-list ownership
 * • Customer KYC ownership
 * • Ledger posting
 * • Payment execution
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


const AML_STATUS = Object.freeze({

    CLEAR:
        'CLEAR',

    REVIEW:
        'REVIEW',

    BLOCK:
        'BLOCK',

    ERROR:
        'ERROR'

});


const FINDING_SEVERITY = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});


const DEFAULT_RULES = Object.freeze({

    REPORTABLE_TRANSACTION_THRESHOLD:
        1_000_000,

    BLACKLIST_MATCH_SEVERITY:
        FINDING_SEVERITY.CRITICAL,

    REPORTABLE_TRANSACTION_SEVERITY:
        FINDING_SEVERITY.MEDIUM

});


const DEFAULT_SCREENING_VERSION =
    '1.0.0';


class AMLScreeningPipeline {


    constructor({

        logger = null,

        metrics = null,

        auditService = null,

        configuration = null,

        screeningProvider = null,

        rules = {},

        screeningVersion =
            DEFAULT_SCREENING_VERSION,

        failClosed =
            true,

        clock =
            Date,

        maxBlacklistEntries =
            100000

    } = {}) {


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.auditService =
            auditService;


        this.configuration =
            configuration;


        this.screeningProvider =
            screeningProvider;


        this.rules = {

            ...DEFAULT_RULES,

            ...rules

        };


        this.screeningVersion =
            screeningVersion;


        this.failClosed =
            failClosed;


        this.clock =
            clock;


        this.maxBlacklistEntries =
            maxBlacklistEntries;


        /**
         * IMPORTANT:
         *
         * This remains an in-process fallback only.
         *
         * Production blacklist/sanctions data should come
         * from a persistent tenant-aware screening repository
         * or sanctions provider.
         */
        this.blacklist =
            new Map();


        /**
         * screeningId -> result
         *
         * Short-lived process-local idempotency fallback.
         *
         * A distributed/persistent repository should eventually
         * replace this.
         */
        this.screeningResults =
            new Map();


        this.startedAt =
            new this.clock();


        this.statistics = {

            screenings:
                0,

            passed:
                0,

            reviews:
                0,

            blocked:
                0,

            errors:
                0,

            blacklistMatches:
                0,

            reportableTransactions:
                0,

            externalProviderChecks:
                0,

            externalProviderFailures:
                0

        };

    }


    /**
     * =========================================================================
     * Execute AML Screening
     * =========================================================================
     */
    async execute(transaction = {}) {


        const startedAt =
            Date.now();


        this.statistics.screenings++;


        const context =
            this.createContext(
                transaction
            );


        try {


            this.validateTransaction(
                transaction
            );


            /**
             * ---------------------------------------------------------------
             * Idempotency
             * ---------------------------------------------------------------
             */
            const existing =
                this.getCachedResult(
                    context.screeningKey
                );


            if (existing) {

                this.metrics?.counter?.(
                    'aml_screening_idempotency_hit_total'
                );


                return existing;

            }


            const findings = [];


            /**
             * ---------------------------------------------------------------
             * Customer blacklist screening
             * ---------------------------------------------------------------
             */
            await this.screenBlacklist({

                transaction,

                context,

                findings

            });


            /**
             * ---------------------------------------------------------------
             * Transaction threshold screening
             * ---------------------------------------------------------------
             */
            this.screenTransactionThreshold({

                transaction,

                context,

                findings

            });


            /**
             * ---------------------------------------------------------------
             * External screening provider
             * ---------------------------------------------------------------
             *
             * Optional integration point for:
             *
             * • sanctions
             * • PEP
             * • adverse media
             * • watchlists
             */
            await this.screenExternalProvider({

                transaction,

                context,

                findings

            });


            const decision =
                this.determineDecision(
                    findings
                );


            const result = {

                success:
                    true,

                screeningId:
                    context.screeningId,

                screeningKey:
                    context.screeningKey,

                tenantId:
                    context.tenantId,

                customerId:
                    context.customerId,

                correlationId:
                    context.correlationId,

                transactionId:
                    context.transactionId,

                status:
                    decision.status,

                passed:
                    decision.status ===
                    AML_STATUS.CLEAR,

                requiresReview:
                    decision.status ===
                    AML_STATUS.REVIEW,

                blocked:
                    decision.status ===
                    AML_STATUS.BLOCK,

                findings,

                findingCount:
                    findings.length,

                screeningVersion:
                    this.screeningVersion,

                screenedAt:
                    new this.clock(),

                durationMs:
                    Date.now() -
                    startedAt

            };


            /**
             * ---------------------------------------------------------------
             * Statistics
             * ---------------------------------------------------------------
             */
            if (
                result.status ===
                AML_STATUS.CLEAR
            ) {

                this.statistics.passed++;


                this.metrics?.counter?.(
                    'aml_screening_clear_total'
                );

            }
            else if (
                result.status ===
                AML_STATUS.REVIEW
            ) {

                this.statistics.reviews++;


                this.metrics?.counter?.(
                    'aml_screening_review_total'
                );

            }
            else if (
                result.status ===
                AML_STATUS.BLOCK
            ) {

                this.statistics.blocked++;


                this.metrics?.counter?.(
                    'aml_screening_block_total'
                );

            }


            this.metrics?.counter?.(
                'aml_screening_completed_total'
            );


            this.metrics?.histogram?.(
                'aml_screening_duration_ms',
                result.durationMs
            );


            this.cacheResult(
                context.screeningKey,
                result
            );


            this.logger?.info?.({

                message:
                    'AML screening completed',

                screeningId:
                    context.screeningId,

                tenantId:
                    context.tenantId,

                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                status:
                    result.status,

                findingCount:
                    result.findingCount,

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
                'aml_screening_error_total'
            );


            this.logger?.error?.({

                message:
                    'AML screening failed',

                screeningId:
                    context.screeningId,

                tenantId:
                    context.tenantId,

                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                error:
                    this.serializeError(
                        error
                    )

            });


            /**
             * AML screening is a financial control.
             *
             * If failClosed=true, failure prevents the
             * transaction from being treated as cleared.
             */
            if (this.failClosed) {


                const result = {

                    success:
                        false,

                    screeningId:
                        context.screeningId,

                    screeningKey:
                        context.screeningKey,

                    tenantId:
                        context.tenantId,

                    customerId:
                        context.customerId,

                    transactionId:
                        context.transactionId,

                    correlationId:
                        context.correlationId,

                    status:
                        AML_STATUS.ERROR,

                    passed:
                        false,

                    requiresReview:
                        true,

                    blocked:
                        false,

                    findings: [

                        {

                            code:
                                'AML_SCREENING_UNAVAILABLE',

                            severity:
                                FINDING_SEVERITY.CRITICAL,

                            message:
                                'AML screening could not be completed',

                            rule:
                                'SYSTEM',

                            screeningVersion:
                                this.screeningVersion

                        }

                    ],

                    findingCount:
                        1,

                    screeningVersion:
                        this.screeningVersion,

                    screenedAt:
                        new this.clock(),

                    durationMs:
                        Date.now() -
                        startedAt

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
     * Transaction Validation
     * =========================================================================
     */
    validateTransaction(
        transaction
    ) {


        if (
            !transaction ||
            typeof transaction !== 'object'
        ) {

            throw new TypeError(
                'AML transaction must be an object'
            );

        }


        if (
            !transaction.tenantId
        ) {

            throw new Error(
                'tenantId required for AML screening'
            );

        }


        if (
            !transaction.customerId
        ) {

            throw new Error(
                'customerId required for AML screening'
            );

        }


        if (
            transaction.amount !== undefined
        ) {

            const amount =
                Number(
                    transaction.amount
                );


            if (
                !Number.isFinite(amount) ||
                amount < 0
            ) {

                throw new Error(
                    'Invalid transaction amount'
                );

            }

        }


        return true;

    }


    /**
     * =========================================================================
     * Context
     * =========================================================================
     */
    createContext(
        transaction
    ) {


        const tenantId =
            transaction?.tenantId ||
            null;


        const customerId =
            transaction?.customerId ||
            null;


        const transactionId =
            transaction?.transactionId ||
            transaction?.id ||
            null;


        const correlationId =
            transaction?.correlationId ||
            crypto.randomUUID();


        const suppliedKey =
            transaction?.idempotencyKey ||
            transaction?.reference ||
            transactionId ||
            crypto.randomUUID();


        const screeningKey =
            crypto
                .createHash('sha256')
                .update(
                    [
                        tenantId,
                        customerId,
                        suppliedKey,
                        this.screeningVersion
                    ].join(':')
                )
                .digest('hex');


        return {

            screeningId:
                crypto.randomUUID(),

            screeningKey,

            tenantId,

            customerId,

            transactionId,

            correlationId

        };

    }


    /**
     * =========================================================================
     * Blacklist Screening
     * =========================================================================
     */
    async screenBlacklist({

        transaction,

        context,

        findings

    }) {


        const customerId =
            String(
                transaction.customerId
            );


        const tenantBlacklist =
            this.blacklist.get(
                context.tenantId
            );


        if (
            tenantBlacklist?.has(
                customerId
            )
        ) {


            this.statistics.blacklistMatches++;


            this.metrics?.counter?.(
                'aml_blacklist_match_total'
            );


            findings.push({

                code:
                    'BLACKLIST_MATCH',

                severity:
                    this.rules
                        .BLACKLIST_MATCH_SEVERITY,

                message:
                    'Customer matched an internal AML blacklist',

                rule:
                    'INTERNAL_BLACKLIST',

                customerId,

                screeningVersion:
                    this.screeningVersion

            });

        }


        return findings;

    }


    /**
     * =========================================================================
     * Transaction Threshold Screening
     * =========================================================================
     */
    screenTransactionThreshold({

        transaction,

        findings

    }) {


        const amount =
            Number(
                transaction.amount || 0
            );


        const configuredThreshold =
            Number(
                transaction.reportingThreshold
            );


        const threshold =
            Number.isFinite(
                configuredThreshold
            )
                ? configuredThreshold
                : this.rules
                    .REPORTABLE_TRANSACTION_THRESHOLD;


        if (
            amount >
            threshold
        ) {


            this.statistics
                .reportableTransactions++;


            this.metrics?.counter?.(
                'aml_reportable_transaction_total'
            );


            findings.push({

                code:
                    'REPORTABLE_TRANSACTION',

                severity:
                    this.rules
                        .REPORTABLE_TRANSACTION_SEVERITY,

                message:
                    'Transaction exceeds configured AML reporting threshold',

                rule:
                    'TRANSACTION_THRESHOLD',

                amount,

                threshold,

                screeningVersion:
                    this.screeningVersion

            });

        }


        return findings;

    }


    /**
     * =========================================================================
     * External Screening Provider
     * =========================================================================
     */
    async screenExternalProvider({

        transaction,

        context,

        findings

    }) {


        if (
            !this.screeningProvider?.screen
        ) {

            return findings;

        }


        this.statistics.externalProviderChecks++;


        this.metrics?.counter?.(
            'aml_external_screening_request_total'
        );


        try {


            const response =
                await this.screeningProvider.screen({

                    tenantId:
                        context.tenantId,

                    customerId:
                        context.customerId,

                    transactionId:
                        context.transactionId,

                    correlationId:
                        context.correlationId,

                    transaction

                });


            if (
                response?.findings &&
                Array.isArray(
                    response.findings
                )
            ) {

                findings.push(
                    ...response.findings
                );

            }


            return findings;


        }
        catch (error) {


            this.statistics
                .externalProviderFailures++;


            this.metrics?.counter?.(
                'aml_external_screening_failure_total'
            );


            this.logger?.error?.({

                message:
                    'External AML screening provider failed',

                tenantId:
                    context.tenantId,

                transactionId:
                    context.transactionId,

                correlationId:
                    context.correlationId,

                error:
                    this.serializeError(
                        error
                    )

            });


            if (
                this.failClosed
            ) {

                findings.push({

                    code:
                        'EXTERNAL_SCREENING_UNAVAILABLE',

                    severity:
                        FINDING_SEVERITY.CRITICAL,

                    message:
                        'External AML screening provider unavailable',

                    rule:
                        'EXTERNAL_PROVIDER',

                    screeningVersion:
                        this.screeningVersion

                });


                return findings;

            }


            return findings;

        }

    }


    /**
     * =========================================================================
     * Decision Engine
     * =========================================================================
     */
    determineDecision(
        findings
    ) {


        if (
            !findings.length
        ) {

            return {

                status:
                    AML_STATUS.CLEAR

            };

        }


        const hasCritical =
            findings.some(
                finding =>
                    finding.severity ===
                    FINDING_SEVERITY.CRITICAL
            );


        if (
            hasCritical
        ) {

            return {

                status:
                    AML_STATUS.BLOCK

            };

        }


        const hasHigh =
            findings.some(
                finding =>
                    finding.severity ===
                    FINDING_SEVERITY.HIGH
            );


        if (
            hasHigh
        ) {

            return {

                status:
                    AML_STATUS.REVIEW

            };

        }


        return {

            status:
                AML_STATUS.REVIEW

        };

    }


    /**
     * =========================================================================
     * Blacklist Management
     * =========================================================================
     *
     * Backward compatible with:
     *
     * addBlacklistEntry(id)
     *
     * Also supports:
     *
     * addBlacklistEntry(id, tenantId)
     */
    addBlacklistEntry(
        id,
        tenantId = 'GLOBAL'
    ) {


        if (!id) {

            throw new Error(
                'Blacklist entry id required'
            );

        }


        if (
            !tenantId
        ) {

            throw new Error(
                'tenantId required for blacklist entry'
            );

        }


        let entries =
            this.blacklist.get(
                tenantId
            );


        if (!entries) {

            entries =
                new Set();


            this.blacklist.set(
                tenantId,
                entries
            );

        }


        if (
            entries.size >=
            this.maxBlacklistEntries
        ) {

            throw new Error(
                'AML blacklist capacity exceeded'
            );

        }


        entries.add(
            String(id)
        );


        this.metrics?.gauge?.(
            'aml_blacklist_entries',
            this.getBlacklistSize()
        );


        return true;

    }


    /**
     * =========================================================================
     * Remove Blacklist Entry
     * =========================================================================
     */
    removeBlacklistEntry(
        id,
        tenantId = 'GLOBAL'
    ) {


        const entries =
            this.blacklist.get(
                tenantId
            );


        if (!entries) {

            return false;

        }


        const removed =
            entries.delete(
                String(id)
            );


        if (
            entries.size === 0
        ) {

            this.blacklist.delete(
                tenantId
            );

        }


        return removed;

    }


    /**
     * =========================================================================
     * Result Cache
     * =========================================================================
     */
    getCachedResult(
        screeningKey
    ) {


        const result =
            this.screeningResults.get(
                screeningKey
            );


        if (!result) {

            return null;

        }


        return result;

    }


    cacheResult(
        screeningKey,
        result
    ) {


        this.screeningResults.set(
            screeningKey,
            result
        );

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
                    'AML_TRANSACTION_SCREENED',

                metadata: {

                    screeningId:
                        result.screeningId,

                    screeningVersion:
                        result.screeningVersion,

                    tenantId:
                        result.tenantId,

                    customerId:
                        result.customerId,

                    transactionId:
                        result.transactionId,

                    correlationId:
                        result.correlationId,

                    status:
                        result.status,

                    findingCount:
                        result.findingCount

                }

            });

        }
        catch (error) {


            /**
             * Audit failure must not turn a completed
             * AML screening into a screening failure.
             */
            this.logger?.error?.({

                message:
                    'AML audit recording failed',

                screeningId:
                    result.screeningId,

                error:
                    this.serializeError(
                        error
                    )

            });


            this.metrics?.counter?.(
                'aml_audit_failure_total'
            );

        }

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */
    stats() {


        return {

            ...this.statistics,

            blacklistEntries:
                this.getBlacklistSize(),

            cachedScreeningResults:
                this.screeningResults.size,

            screeningVersion:
                this.screeningVersion,

            failClosed:
                this.failClosed,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime()

        };

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    health() {


        const status =
            this.statistics.errors > 0
                ? 'DEGRADED'
                : 'UP';


        return {

            service:
                'AML_SCREENING_PIPELINE',

            status,

            screeningVersion:
                this.screeningVersion,

            failClosed:
                this.failClosed,

            statistics:
                this.stats()

        };

    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */
    snapshot() {


        return {

            service:
                'AML_SCREENING_PIPELINE',

            screeningVersion:
                this.screeningVersion,

            failClosed:
                this.failClosed,

            rules:
                {
                    ...this.rules
                },

            statistics:
                this.stats(),

            generatedAt:
                new this.clock()

        };

    }


    /**
     * =========================================================================
     * Utility
     * =========================================================================
     */
    getBlacklistSize() {


        let count = 0;


        for (
            const entries
            of this.blacklist.values()
        ) {

            count +=
                entries.size;

        }


        return count;

    }


    /**
     * =========================================================================
     * Error Serialization
     * =========================================================================
     */
    serializeError(error) {


        return {

            name:
                error?.name,

            code:
                error?.code,

            message:
                error?.message,

            retryable:
                error?.retryable,

            timestamp:
                error?.timestamp

        };

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */
    async shutdown() {


        this.blacklist.clear();

        this.screeningResults.clear();


        return true;

    }

}


/**
 * Singleton export retained for compatibility.
 */
module.exports =
    new AMLScreeningPipeline();


/**
 * Expose the class for dependency injection and testing.
 */
module.exports.AMLScreeningPipeline =
    AMLScreeningPipeline;


module.exports.AML_STATUS =
    AML_STATUS;


module.exports.FINDING_SEVERITY =
    FINDING_SEVERITY;