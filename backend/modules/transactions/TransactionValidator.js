'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Validator
 * ============================================================================
 *
 * Validates financial transactions before execution.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Transaction structure validation
 * ✓ Financial amount validation
 * ✓ Currency validation
 * ✓ Tenant validation
 * ✓ Provider validation
 * ✓ Idempotency validation
 * ✓ Initial state validation
 * ✓ Account validation hooks
 * ✓ Compliance hooks
 * ✓ Risk hooks
 * ✓ Validation timeout protection
 * ✓ Structured logging
 * ✓ Distributed tracing
 * ✓ Audit integration
 * ✓ Metrics integration
 * ✓ Error normalization
 * ✓ Deterministic transaction identity
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This validator validates whether a transaction is acceptable for execution.
 * It does NOT:
 *
 * • mutate account balances
 * • post ledger entries
 * • execute provider payments
 * • reserve funds
 * • mark idempotency keys as consumed
 *
 * Those responsibilities belong to the execution / ledger / idempotency
 * subsystems.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Validation Error
 * ============================================================================
 */

class TransactionValidationError extends Error {

    constructor(errors = [], context = {}) {

        super(
            'Transaction validation failed'
        );

        this.name =
            'TransactionValidationError';

        this.code =
            'TRANSACTION_VALIDATION_FAILED';

        this.errors =
            Array.isArray(errors)
                ? errors
                : [];

        this.transactionId =
            context.transactionId || null;

        this.tenantId =
            context.tenantId || null;

        this.correlationId =
            context.correlationId || null;

        this.retryable =
            false;

        Error.captureStackTrace?.(
            this,
            TransactionValidationError
        );
    }
}

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULTS = Object.freeze({

    minAmount:
        0.01,

    maxAmount:
        1000000000,

    supportedCurrencies: [
        'UGX',
        'USD',
        'KES',
        'TZS',
        'RWF'
    ],

    supportedStates: [
        undefined,
        null,
        'CREATED',
        'PENDING'
    ],

    allowedTypes: null,

    maxTransactionTypeLength:
        100,

    maxProviderLength:
        100,

    maxIdempotencyKeyLength:
        255,

    validationTimeout:
        10000,

    failClosedCompliance:
        true,

    failClosedRisk:
        true,

    failClosedAccounts:
        true
});

/**
 * ============================================================================
 * Transaction Validator
 * ============================================================================
 */

class TransactionValidator {

    constructor(options = {}) {

        this.logger =
            options.logger || console;

        this.metrics =
            options.metrics || null;

        this.auditPublisher =
            options.auditPublisher || null;

        this.tracer =
            options.tracer || null;

        this.accountValidator =
            options.accountValidator || null;

        this.riskEngine =
            options.riskEngine || null;

        this.complianceEngine =
            options.complianceEngine || null;

        this.idempotencyStore =
            options.idempotencyStore || null;

        this.config = {
            ...DEFAULTS,
            ...options
        };

        this.supportedCurrencies =
            new Set(
                (
                    this.config
                        .supportedCurrencies || []
                )
                .map(currency =>
                    String(currency)
                        .trim()
                        .toUpperCase()
                )
            );

    }

    /**
     * =========================================================================
     * Validate Transaction
     * =========================================================================
     */

    async validate(
        transaction = {},
        context = {}
    ) {

        const transactionId =
            transaction.transactionId ||
            crypto.randomUUID();

        const validationContext = {

            ...context,

            transactionId,

            tenantId:
                context.tenantId ||
                transaction.tenantId ||
                null
        };

        const errors = [];

        const startedAt =
            Date.now();

        const span =
            this.tracer?.startSpan?.(
                'transaction.validation',
                {
                    transactionId,

                    tenantId:
                        validationContext.tenantId,

                    correlationId:
                        validationContext.correlationId,

                    requestId:
                        validationContext.requestId,

                    operation:
                        'transaction.validation'
                }
            );

        this.logger.debug?.(
            '[TransactionValidator] Validation started',
            {
                transactionId,

                tenantId:
                    validationContext.tenantId,

                operation:
                    transaction.type || null
            }
        );

        try {

            /**
             * ---------------------------------------------------------------
             * Structural validation
             * ---------------------------------------------------------------
             */

            this.validateTransactionObject(
                transaction,
                errors
            );

            this.validateRequiredFields(
                transaction,
                errors
            );

            this.validateTransactionType(
                transaction,
                errors
            );

            /**
             * ---------------------------------------------------------------
             * Financial validation
             * ---------------------------------------------------------------
             */

            this.validateAmount(
                transaction,
                errors
            );

            this.validateCurrency(
                transaction,
                errors
            );

            /**
             * ---------------------------------------------------------------
             * Tenant / provider / identity
             * ---------------------------------------------------------------
             */

            this.validateTenant(
                transaction,
                validationContext,
                errors
            );

            this.validateProvider(
                transaction,
                errors
            );

            this.validateIdempotencyKey(
                transaction,
                errors
            );

            /**
             * ---------------------------------------------------------------
             * State validation
             * ---------------------------------------------------------------
             */

            this.validateState(
                transaction,
                errors
            );

            /**
             * ---------------------------------------------------------------
             * Account validation
             * ---------------------------------------------------------------
             */

            if (
                this.accountValidator
            ) {

                await this.validateAccounts(
                    transaction,
                    validationContext,
                    errors
                );

            }

            /**
             * ---------------------------------------------------------------
             * Idempotency lookup
             * ---------------------------------------------------------------
             */

            if (
                errors.length === 0 &&
                this.idempotencyStore
            ) {

                await this.validateIdempotency(
                    transaction,
                    validationContext,
                    errors
                );

            }

            /**
             * ---------------------------------------------------------------
             * Compliance
             * ---------------------------------------------------------------
             */

            if (
                this.complianceEngine &&
                errors.length === 0
            ) {

                await this.validateCompliance(
                    transaction,
                    validationContext,
                    errors
                );

            }

            /**
             * ---------------------------------------------------------------
             * Risk
             * ---------------------------------------------------------------
             */

            if (
                this.riskEngine &&
                errors.length === 0
            ) {

                await this.validateRisk(
                    transaction,
                    validationContext,
                    errors
                );

            }

            const durationMs =
                Date.now() -
                startedAt;

            const valid =
                errors.length === 0;

            /**
             * ---------------------------------------------------------------
             * Metrics
             * ---------------------------------------------------------------
             */

            this.metrics?.increment?.(
                valid
                    ? 'transaction_validation_success_total'
                    : 'transaction_validation_failure_total'
            );

            this.metrics?.observe?.(
                'transaction_validation_duration_ms',
                durationMs
            );

            /**
             * ---------------------------------------------------------------
             * Failed validation
             * ---------------------------------------------------------------
             */

            if (!valid) {

                const validationError =
                    new TransactionValidationError(
                        errors,
                        validationContext
                    );

                this.tracer?.recordError?.(
                    span,
                    validationError
                );

                await this.publishAudit(
                    'TRANSACTION_VALIDATION_FAILED',
                    {
                        transactionId,

                        tenantId:
                            validationContext.tenantId,

                        correlationId:
                            validationContext.correlationId,

                        errors,

                        durationMs
                    }
                );

                this.logger.warn?.(
                    '[TransactionValidator] Validation failed',
                    {
                        transactionId,

                        tenantId:
                            validationContext.tenantId,

                        errorCount:
                            errors.length,

                        durationMs
                    }
                );

                this.tracer?.endSpan?.(
                    span,
                    {
                        error:
                            validationError
                    }
                );

                throw validationError;
            }

            /**
             * ---------------------------------------------------------------
             * Successful validation
             * ---------------------------------------------------------------
             */

            this.tracer?.addEvent?.(
                span,
                'transaction.validation.passed',
                {
                    transactionId
                }
            );

            this.tracer?.endSpan?.(
                span,
                {
                    status: 'OK',

                    attributes: {
                        transactionId,

                        tenantId:
                            validationContext.tenantId
                    }
                }
            );

            await this.publishAudit(
                'TRANSACTION_VALIDATION_PASSED',
                {
                    transactionId,

                    tenantId:
                        validationContext.tenantId,

                    correlationId:
                        validationContext.correlationId,

                    durationMs
                }
            );

            return {

                valid:
                    true,

                transactionId,

                tenantId:
                    validationContext.tenantId,

                currency:
                    this.normalizeCurrency(
                        transaction.currency
                    ),

                amount:
                    this.normalizeAmount(
                        transaction.amount
                    ),

                durationMs

            };

        }
        catch (error) {

            /**
             * Validation errors have already been handled
             * above. Unexpected errors are converted into a
             * validation failure and fail closed.
             */

            if (
                error instanceof
                TransactionValidationError
            ) {

                throw error;

            }

            this.metrics?.increment?.(
                'transaction_validation_error_total'
            );

            this.tracer?.recordError?.(
                span,
                error
            );

            this.logger.error?.(
                '[TransactionValidator] Unexpected validation error',
                {
                    transactionId,

                    tenantId:
                        validationContext.tenantId,

                    error:
                        this.normalizeError(
                            error
                        )
                }
            );

            const validationError =
                new TransactionValidationError(
                    [
                        {
                            field:
                                'transaction',

                            code:
                                'VALIDATION_ENGINE_ERROR',

                            message:
                                'Transaction validation could not be completed'
                        }
                    ],
                    validationContext
                );

            this.tracer?.endSpan?.(
                span,
                {
                    error
                }
            );

            throw validationError;
        }

    }

    /**
     * =========================================================================
     * Transaction Object Validation
     * =========================================================================
     */

    validateTransactionObject(
        transaction,
        errors
    ) {

        if (
            !transaction ||
            typeof transaction !== 'object' ||
            Array.isArray(transaction)
        ) {

            errors.push({
                field:
                    'transaction',

                code:
                    'INVALID_TRANSACTION',

                message:
                    'Transaction must be a valid object'
            });

        }

    }

    /**
     * =========================================================================
     * Required Fields
     * =========================================================================
     */

    validateRequiredFields(
        transaction,
        errors
    ) {

        const required = [
            'type',
            'amount',
            'currency'
        ];

        for (
            const field
            of required
        ) {

            if (
                transaction[field] === undefined ||
                transaction[field] === null ||
                (
                    typeof transaction[field] ===
                    'string' &&
                    transaction[field].trim() === ''
                )
            ) {

                errors.push({

                    field,

                    code:
                        'REQUIRED_FIELD_MISSING',

                    message:
                        `${field} is required`

                });

            }

        }

    }

    /**
     * =========================================================================
     * Transaction Type
     * =========================================================================
     */

    validateTransactionType(
        transaction,
        errors
    ) {

        if (
            transaction.type === undefined ||
            transaction.type === null
        ) {

            return;

        }

        if (
            typeof transaction.type !==
            'string'
        ) {

            errors.push({

                field:
                    'type',

                code:
                    'INVALID_TRANSACTION_TYPE',

                message:
                    'Transaction type must be a string'

            });

            return;
        }

        const type =
            transaction.type.trim();

        if (!type) {

            errors.push({

                field:
                    'type',

                code:
                    'INVALID_TRANSACTION_TYPE',

                message:
                    'Transaction type cannot be empty'

            });

            return;
        }

        if (
            type.length >
            this.config.maxTransactionTypeLength
        ) {

            errors.push({

                field:
                    'type',

                code:
                    'TRANSACTION_TYPE_TOO_LONG',

                message:
                    'Transaction type exceeds maximum length'

            });

        }

        if (
            Array.isArray(
                this.config.allowedTypes
            ) &&
            this.config.allowedTypes.length > 0 &&
            !this.config.allowedTypes.includes(type)
        ) {

            errors.push({

                field:
                    'type',

                code:
                    'UNSUPPORTED_TRANSACTION_TYPE',

                message:
                    'Unsupported transaction type'

            });

        }

    }

    /**
     * =========================================================================
     * Amount Validation
     * =========================================================================
     */

    validateAmount(
        transaction,
        errors
    ) {

        if (
            transaction.amount === undefined ||
            transaction.amount === null
        ) {

            return;

        }

        /**
         * Reject booleans and arbitrary objects.
         */
        if (
            typeof transaction.amount !==
                'number' &&
            typeof transaction.amount !==
                'string'
        ) {

            errors.push({

                field:
                    'amount',

                code:
                    'INVALID_AMOUNT',

                message:
                    'Amount must be numeric'

            });

            return;

        }

        const raw =
            String(
                transaction.amount
            ).trim();

        /**
         * Reject empty strings.
         */
        if (!raw) {

            errors.push({

                field:
                    'amount',

                code:
                    'INVALID_AMOUNT',

                message:
                    'Amount must be numeric'

            });

            return;

        }

        /**
         * Strict decimal syntax.
         */
        if (
            !/^\d+(\.\d+)?$/.test(raw)
        ) {

            errors.push({

                field:
                    'amount',

                code:
                    'INVALID_AMOUNT',

                message:
                    'Amount must be a positive decimal number'

            });

            return;

        }

        const amount =
            Number(raw);

        if (
            !Number.isFinite(amount)
        ) {

            errors.push({

                field:
                    'amount',

                code:
                    'INVALID_AMOUNT',

                message:
                    'Amount must be finite'

            });

            return;

        }

        if (
            amount <= 0
        ) {

            errors.push({

                field:
                    'amount',

                code:
                    'INVALID_AMOUNT',

                message:
                    'Amount must be greater than zero'

            });

        }

        if (
            amount <
            this.config.minAmount
        ) {

            errors.push({

                field:
                    'amount',

                code:
                    'AMOUNT_BELOW_MINIMUM',

                message:
                    'Amount below minimum limit'

            });

        }

        if (
            amount >
            this.config.maxAmount
        ) {

            errors.push({

                field:
                    'amount',

                code:
                    'AMOUNT_ABOVE_MAXIMUM',

                message:
                    'Amount exceeds maximum limit'

            });

        }

    }

    /**
     * =========================================================================
     * Currency Validation
     * =========================================================================
     */

    validateCurrency(
        transaction,
        errors
    ) {

        if (
            transaction.currency === undefined ||
            transaction.currency === null
        ) {

            return;

        }

        if (
            typeof transaction.currency !==
            'string'
        ) {

            errors.push({

                field:
                    'currency',

                code:
                    'INVALID_CURRENCY',

                message:
                    'Currency must be a string'

            });

            return;

        }

        const currency =
            transaction.currency
                .trim()
                .toUpperCase();

        if (
            !/^[A-Z]{3}$/.test(currency)
        ) {

            errors.push({

                field:
                    'currency',

                code:
                    'INVALID_CURRENCY',

                message:
                    'Currency must be a valid three-letter currency code'

            });

            return;

        }

        if (
            !this.supportedCurrencies.has(
                currency
            )
        ) {

            errors.push({

                field:
                    'currency',

                code:
                    'UNSUPPORTED_CURRENCY',

                message:
                    'Unsupported currency'

            });

        }

    }

    /**
     * =========================================================================
     * Tenant Validation
     * =========================================================================
     */

    validateTenant(
        transaction,
        context,
        errors
    ) {

        const contextTenant =
            context.tenantId || null;

        const transactionTenant =
            transaction.tenantId || null;

        /**
         * Financial operations must not
         * silently cross tenant boundaries.
         */
        if (
            contextTenant &&
            transactionTenant &&
            contextTenant !== transactionTenant
        ) {

            errors.push({

                field:
                    'tenantId',

                code:
                    'TENANT_MISMATCH',

                message:
                    'Tenant mismatch'

            });

            return;
        }

        /**
         * If the execution context identifies
         * a tenant, require the transaction to
         * belong to that tenant.
         */
        if (
            contextTenant &&
            !transactionTenant
        ) {

            errors.push({

                field:
                    'tenantId',

                code:
                    'TENANT_REQUIRED',

                message:
                    'Transaction tenant is required'

            });

        }

    }

    /**
     * =========================================================================
     * Provider Validation
     * =========================================================================
     */

    validateProvider(
        transaction,
        errors
    ) {

        if (
            transaction.provider === undefined ||
            transaction.provider === null
        ) {

            return;

        }

        if (
            typeof transaction.provider !==
            'string'
        ) {

            errors.push({

                field:
                    'provider',

                code:
                    'INVALID_PROVIDER',

                message:
                    'Invalid provider'

            });

            return;

        }

        const provider =
            transaction.provider.trim();

        if (!provider) {

            errors.push({

                field:
                    'provider',

                code:
                    'INVALID_PROVIDER',

                message:
                    'Provider cannot be empty'

            });

            return;

        }

        if (
            provider.length >
            this.config.maxProviderLength
        ) {

            errors.push({

                field:
                    'provider',

                code:
                    'PROVIDER_NAME_TOO_LONG',

                message:
                    'Provider name exceeds maximum length'

            });

        }

    }

    /**
     * =========================================================================
     * Idempotency Key Structure
     * =========================================================================
     */

    validateIdempotencyKey(
        transaction,
        errors
    ) {

        if (
            !transaction.idempotencyKey
        ) {

            return;

        }

        if (
            typeof transaction.idempotencyKey !==
            'string'
        ) {

            errors.push({

                field:
                    'idempotencyKey',

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    'Idempotency key must be a string'

            });

            return;

        }

        const key =
            transaction.idempotencyKey.trim();

        if (!key) {

            errors.push({

                field:
                    'idempotencyKey',

                code:
                    'INVALID_IDEMPOTENCY_KEY',

                message:
                    'Idempotency key cannot be empty'

            });

            return;

        }

        if (
            key.length >
            this.config.maxIdempotencyKeyLength
        ) {

            errors.push({

                field:
                    'idempotencyKey',

                code:
                    'IDEMPOTENCY_KEY_TOO_LONG',

                message:
                    'Idempotency key exceeds maximum length'

            });

        }

    }

    /**
     * =========================================================================
     * Idempotency Validation
     * =========================================================================
     */

    async validateIdempotency(
        transaction,
        context,
        errors
    ) {

        if (
            !transaction.idempotencyKey
        ) {

            return;

        }

        const key =
            transaction.idempotencyKey
                .trim();

        try {

            const fingerprint =
                this.createFingerprint(
                    transaction,
                    context
                );

            let existing = null;

            /**
             * Preferred store contract:
             *
             * get(key)
             */
            if (
                typeof this.idempotencyStore.get ===
                'function'
            ) {

                existing =
                    await this.withTimeout(
                        () =>
                            this.idempotencyStore.get(
                                key
                            ),
                        this.config.validationTimeout,
                        'IDEMPOTENCY_STORE_TIMEOUT'
                    );

            }
            /**
             * Backwards-compatible contract:
             *
             * exists(key)
             */
            else if (
                typeof this.idempotencyStore.exists ===
                'function'
            ) {

                const exists =
                    await this.withTimeout(
                        () =>
                            this.idempotencyStore.exists(
                                key
                            ),
                        this.config.validationTimeout,
                        'IDEMPOTENCY_STORE_TIMEOUT'
                    );

                if (exists) {

                    existing = {
                        exists: true
                    };

                }

            }

            if (!existing) {
                return;
            }

            /**
             * A matching key with the same
             * transaction fingerprint is a
             * duplicate request.
             */
            if (
                existing.fingerprint &&
                existing.fingerprint === fingerprint
            ) {

                errors.push({

                    field:
                        'idempotencyKey',

                    code:
                        'DUPLICATE_TRANSACTION',

                    message:
                        'Duplicate transaction request'

                });

                return;
            }

            /**
             * Same key with different payload
             * is an idempotency conflict.
             */
            if (
                existing.fingerprint &&
                existing.fingerprint !== fingerprint
            ) {

                errors.push({

                    field:
                        'idempotencyKey',

                    code:
                        'IDEMPOTENCY_CONFLICT',

                    message:
                        'Idempotency key has already been used for a different transaction'

                });

                return;
            }

            /**
             * Legacy exists() stores do not expose
             * fingerprints.
             */
            if (
                existing.exists === true ||
                existing === true
            ) {

                errors.push({

                    field:
                        'idempotencyKey',

                    code:
                        'DUPLICATE_TRANSACTION',

                    message:
                        'Duplicate transaction request'

                });

            }

        }
        catch (error) {

            this.metrics?.increment?.(
                'transaction_validation_idempotency_error_total'
            );

            this.logger.error?.(
                '[TransactionValidator] Idempotency validation failed',
                {
                    transactionId:
                        context.transactionId,

                    error:
                        this.normalizeError(
                            error
                        )
                }
            );

            errors.push({

                field:
                    'idempotencyKey',

                code:
                    error.code ||
                    'IDEMPOTENCY_VALIDATION_FAILED',

                message:
                    'Unable to validate transaction idempotency'

            });

        }

    }

    /**
     * =========================================================================
     * Initial State Validation
     * =========================================================================
     */

    validateState(
        transaction,
        errors
    ) {

        if (
            !this.config.supportedStates.includes(
                transaction.state
            )
        ) {

            errors.push({

                field:
                    'state',

                code:
                    'INVALID_TRANSACTION_STATE',

                message:
                    'Invalid initial transaction state'

            });

        }

    }

    /**
     * =========================================================================
     * Account Validation Hook
     * =========================================================================
     */

    async validateAccounts(
        transaction,
        context,
        errors
    ) {

        try {

            await this.withTimeout(
                () =>
                    this.accountValidator.validate(
                        transaction,
                        context
                    ),
                this.config.validationTimeout,
                'ACCOUNT_VALIDATION_TIMEOUT'
            );

        }
        catch (error) {

            this.metrics?.increment?.(
                'transaction_account_validation_failure_total'
            );

            errors.push({

                field:
                    'accounts',

                code:
                    error.code ||
                    'ACCOUNT_VALIDATION_FAILED',

                message:
                    this.config.failClosedAccounts
                        ? (
                            'Account validation failed'
                        )
                        : (
                            error.message ||
                            'Account validation failed'
                        )

            });

        }

    }

    /**
     * =========================================================================
     * Compliance Hook
     * =========================================================================
     */

    async validateCompliance(
        transaction,
        context,
        errors
    ) {

        try {

            const result =
                await this.withTimeout(
                    () =>
                        this.complianceEngine.check(
                            transaction,
                            context
                        ),
                    this.config.validationTimeout,
                    'COMPLIANCE_VALIDATION_TIMEOUT'
                );

            if (!result) {

                if (
                    this.config.failClosedCompliance
                ) {

                    errors.push({

                        field:
                            'compliance',

                        code:
                            'COMPLIANCE_VALIDATION_FAILED',

                        message:
                            'Compliance validation returned no decision'

                    });

                }

                return;

            }

            if (
                result.allowed === false ||
                result.blocked === true
            ) {

                errors.push({

                    field:
                        'compliance',

                    code:
                        result.code ||
                        'COMPLIANCE_BLOCKED',

                    message:
                        result.reason ||
                        'Transaction blocked by compliance engine'

                });

            }

        }
        catch (error) {

            this.metrics?.increment?.(
                'transaction_compliance_validation_failure_total'
            );

            errors.push({

                field:
                    'compliance',

                code:
                    error.code ||
                    'COMPLIANCE_VALIDATION_FAILED',

                message:
                    this.config.failClosedCompliance
                        ? (
                            'Compliance validation failed'
                        )
                        : (
                            error.message ||
                            'Compliance validation failed'
                        )

            });

        }

    }

    /**
     * =========================================================================
     * Risk Hook
     * =========================================================================
     */

    async validateRisk(
        transaction,
        context,
        errors
    ) {

        try {

            const result =
                await this.withTimeout(
                    () =>
                        this.riskEngine.evaluate(
                            transaction,
                            context
                        ),
                    this.config.validationTimeout,
                    'RISK_VALIDATION_TIMEOUT'
                );

            if (!result) {

                if (
                    this.config.failClosedRisk
                ) {

                    errors.push({

                        field:
                            'risk',

                        code:
                            'RISK_VALIDATION_FAILED',

                        message:
                            'Risk engine returned no decision'

                    });

                }

                return;

            }

            if (
                result.blocked === true ||
                result.allowed === false
            ) {

                errors.push({

                    field:
                        'risk',

                    code:
                        result.code ||
                        'RISK_BLOCKED',

                    message:
                        result.reason ||
                        'Transaction blocked by risk engine'

                });

            }

        }
        catch (error) {

            this.metrics?.increment?.(
                'transaction_risk_validation_failure_total'
            );

            errors.push({

                field:
                    'risk',

                code:
                    error.code ||
                    'RISK_VALIDATION_FAILED',

                message:
                    this.config.failClosedRisk
                        ? (
                            'Risk validation failed'
                        )
                        : (
                            error.message ||
                            'Risk validation failed'
                        )

            });

        }

    }

    /**
     * =========================================================================
     * Transaction Fingerprint
     * =========================================================================
     *
     * Used to distinguish:
     *
     * SAME KEY + SAME PAYLOAD
     * from
     * SAME KEY + DIFFERENT PAYLOAD
     *
     * =========================================================================
     */

    createFingerprint(
        transaction,
        context = {}
    ) {

        const canonical = {

            tenantId:
                transaction.tenantId ||
                context.tenantId ||
                null,

            type:
                transaction.type || null,

            amount:
                this.normalizeAmount(
                    transaction.amount
                ),

            currency:
                this.normalizeCurrency(
                    transaction.currency
                ),

            provider:
                transaction.provider || null,

            sourceAccountId:
                transaction.sourceAccountId ||
                null,

            destinationAccountId:
                transaction.destinationAccountId ||
                null

        };

        return crypto
            .createHash('sha256')
            .update(
                JSON.stringify(
                    canonical
                )
            )
            .digest('hex');

    }

    /**
     * =========================================================================
     * Normalize Amount
     * =========================================================================
     */

    normalizeAmount(
        amount
    ) {

        if (
            amount === undefined ||
            amount === null
        ) {

            return null;

        }

        const numeric =
            Number(amount);

        if (
            !Number.isFinite(numeric)
        ) {

            return null;

        }

        return numeric;

    }

    /**
     * =========================================================================
     * Normalize Currency
     * =========================================================================
     */

    normalizeCurrency(
        currency
    ) {

        if (
            currency === undefined ||
            currency === null
        ) {

            return null;

        }

        return String(currency)
            .trim()
            .toUpperCase();

    }

    /**
     * =========================================================================
     * Validation Timeout
     * =========================================================================
     */

    async withTimeout(
        operation,
        timeout,
        code
    ) {

        let timer = null;

        try {

            return await Promise.race([

                Promise.resolve()
                    .then(operation),

                new Promise(
                    (_, reject) => {

                        timer =
                            setTimeout(
                                () => {

                                    const error =
                                        new Error(
                                            'Validation operation timed out'
                                        );

                                    error.code =
                                        code;

                                    reject(error);

                                },
                                timeout
                            );

                    }
                )

            ]);

        }
        finally {

            if (timer) {

                clearTimeout(
                    timer
                );

            }

        }

    }

    /**
     * =========================================================================
     * Audit Publisher
     * =========================================================================
     */

    async publishAudit(
        type,
        payload
    ) {

        if (
            !this.auditPublisher?.publish
        ) {

            return;

        }

        try {

            await this.auditPublisher.publish({

                type,

                ...payload,

                timestamp:
                    new Date()

            });

        }
        catch (error) {

            /**
             * Audit failure should be observable.
             *
             * Whether it should block financial execution
             * should be controlled by the higher-level audit
             * policy rather than silently swallowed here.
             */
            this.metrics?.increment?.(
                'transaction_validation_audit_publish_failure_total'
            );

            this.logger.error?.(
                '[TransactionValidator] Audit publication failed',
                {
                    error:
                        this.normalizeError(
                            error
                        ),

                    transactionId:
                        payload.transactionId
                }
            );

        }

    }

    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error
    ) {

        if (!error) {
            return null;
        }

        return {

            name:
                error.name ||
                'Error',

            message:
                error.message ||
                'Unknown error',

            code:
                error.code ||
                null,

            status:
                error.status ||
                null

        };

    }

    /**
     * =========================================================================
     * Synchronous Validation Helper
     * =========================================================================
     *
     * IMPORTANT:
     * Validation contains asynchronous hooks.
     *
     * Therefore this method intentionally returns a Promise.
     *
     * =========================================================================
     */

    async isValid(
        transaction,
        context = {}
    ) {

        try {

            const result =
                await this.validate(
                    transaction,
                    context
                );

            return result.valid === true;

        }
        catch (error) {

            return false;

        }

    }

    /**
     * =========================================================================
     * Get Configuration
     * =========================================================================
     */

    getConfiguration() {

        return {

            minAmount:
                this.config.minAmount,

            maxAmount:
                this.config.maxAmount,

            supportedCurrencies:
                [
                    ...this.supportedCurrencies
                ],

            supportedStates:
                [
                    ...this.config.supportedStates
                ],

            validationTimeout:
                this.config.validationTimeout,

            failClosedCompliance:
                this.config.failClosedCompliance,

            failClosedRisk:
                this.config.failClosedRisk,

            failClosedAccounts:
                this.config.failClosedAccounts

        };

    }

    /**
     * =========================================================================
     * Factory
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new TransactionValidator(
            options
        );

    }

}

/**
 * ============================================================================
 * Static Error Export
 * ============================================================================
 */

TransactionValidator.Error =
    TransactionValidationError;

TransactionValidator.TransactionValidationError =
    TransactionValidationError;

module.exports =
    TransactionValidator;