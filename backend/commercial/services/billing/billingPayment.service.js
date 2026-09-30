"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Canonical SaaS Billing Payment Service
 * =============================================================================
 *
 * File:
 *   backend/commercial/services/billing/billingPayment.service.js
 *
 * Purpose:
 *   Application/service boundary for TITech SaaS billing payment creation and
 *   settlement.
 *
 * Architectural boundary:
 *
 *   HTTP / Worker / Provider Callback
 *                 |
 *                 v
 *        BillingPaymentService
 *                 |
 *       +---------+----------+
 *       |                    |
 *       v                    v
 * BillingRepository   TITech Financial Core Port
 *       |                    |
 *       v                    v
 * Commercial Billing     Financial Transaction /
 * State                   Ledger / Wallet / Balance
 *
 * The service NEVER writes directly to financial ledger, wallet, balance or
 * transaction models. Financial posting must happen through the configured
 * TITech Financial Core adapter.
 *
 * Production invariants:
 *   - Tenant isolation is mandatory.
 *   - Idempotency is tenant-scoped.
 *   - Monetary comparison uses exact decimal arithmetic.
 *   - Provider payment initiation is never silently duplicated.
 *   - Invoice currency and payment currency must match.
 *   - Provider callbacks cannot settle more than the invoice outstanding amount.
 *   - A payment cannot become SUCCESS before the Financial Core confirms posting.
 *   - Concurrent settlement attempts are protected by an atomic claim.
 *   - A failed Financial Core posting releases a PROCESSING payment to FAILED
 *     with explicit diagnostic context, making controlled retry possible.
 *   - Invoice application is delegated to an atomic repository operation.
 *   - Provider payloads/secrets are never blindly persisted to metadata.
 *   - The service is safe for HTTP requests, workers and provider callbacks.
 *
 * =============================================================================
 */

const {
    CommercialConflictError,
    CommercialNotFoundError,
    CommercialValidationError,
} = require("../../errors/commercial.errors");

const {
    PAYMENT_STATUS = Object.freeze({
        PENDING: "PENDING",
        PROCESSING: "PROCESSING",
        SUCCESS: "SUCCESS",
        FAILED: "FAILED",
        REVERSED: "REVERSED",
        REFUNDED: "REFUNDED",
    }),
} = require("../../constants/billing.constants");

const {
    compare,
    normalizeDecimal,
} = require("./decimalMoney.cjs");


const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const MAX_PROVIDER_LENGTH = 80;
const MAX_REFERENCE_LENGTH = 255;
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

const SETTLABLE_INVOICE_STATUSES = Object.freeze([
    "OPEN",
    "PARTIALLY_PAID",
    "PAST_DUE",
]);

const PROCESSING_PAYMENT_STATUSES = Object.freeze([
    PAYMENT_STATUS.PENDING,
    PAYMENT_STATUS.PROCESSING,
]);


/**
 * =============================================================================
 * Internal Helpers
 * =============================================================================
 */

function requireNonEmptyString(value, fieldName, maxLength = null) {
    if (value == null) {
        throw new CommercialValidationError(
            `${fieldName} is required.`
        );
    }

    const normalized = String(value).trim();

    if (!normalized) {
        throw new CommercialValidationError(
            `${fieldName} is required.`
        );
    }

    if (
        maxLength &&
        normalized.length > maxLength
    ) {
        throw new CommercialValidationError(
            `${fieldName} exceeds the maximum allowed length.`,
            {
                field: fieldName,
                maxLength,
            }
        );
    }

    return normalized;
}


function normalizeProvider(value) {
    return requireNonEmptyString(
        value,
        "provider",
        MAX_PROVIDER_LENGTH
    ).toLowerCase();
}


function normalizeIdempotencyKey(value) {
    return requireNonEmptyString(
        value,
        "idempotencyKey",
        MAX_IDEMPOTENCY_KEY_LENGTH
    );
}


function normalizeReference(value, fieldName) {
    if (value == null) {
        return null;
    }

    const normalized = String(value).trim();

    if (!normalized) {
        return null;
    }

    if (normalized.length > MAX_REFERENCE_LENGTH) {
        throw new CommercialValidationError(
            `${fieldName} exceeds the maximum allowed length.`,
            {
                field: fieldName,
                maxLength: MAX_REFERENCE_LENGTH,
            }
        );
    }

    return normalized;
}


function normalizeDate(value, fieldName) {
    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new CommercialValidationError(
            `${fieldName} must be a valid date.`
        );
    }

    return date;
}


function normalizePositiveMoney(value, fieldName) {
    try {
        const normalized = normalizeDecimal(value);
        const canonical = normalized.whole + (
            normalized.fraction
                ? `.${normalized.fraction}`
                : ""
        );

        if (
            compare(canonical, "0") <= 0
        ) {
            throw new CommercialValidationError(
                `${fieldName} must be greater than zero.`
            );
        }

        return canonical;
    } catch (error) {
        if (error instanceof CommercialValidationError) {
            throw error;
        }

        throw new CommercialValidationError(
            `${fieldName} must be a valid non-negative decimal.`
        );
    }
}


function decimalString(value) {
    if (value == null) {
        return "0";
    }

    return value?.toString?.() ?? String(value);
}


function normalizeCurrency(value) {
    return requireNonEmptyString(
        value,
        "currency",
        10
    ).toUpperCase();
}


function normalizeObject(value, fieldName) {
    if (value == null) {
        return {};
    }

    if (
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        throw new CommercialValidationError(
            `${fieldName} must be an object.`
        );
    }

    return value;
}


function sanitizeMetadata(metadata = {}) {
    const input = normalizeObject(
        metadata,
        "metadata"
    );

    const blockedKeys = new Set([
        "password",
        "passwd",
        "secret",
        "apiKey",
        "api_key",
        "accessToken",
        "access_token",
        "refreshToken",
        "refresh_token",
        "authorization",
        "cookie",
        "cvv",
        "cvc",
        "pin",
        "otp",
        "cardNumber",
        "pan",
        "rawProviderResponse",
    ]);

    const output = {};

    for (const [key, value] of Object.entries(input)) {
        if (blockedKeys.has(key)) {
            continue;
        }

        output[key] = value;
    }

    return output;
}


function extractFinancialTransactionId(result) {
    return (
        result?.transactionId ??
        result?.financialTransactionId ??
        result?.financialTransaction?._id ??
        null
    );
}


function errorCode(error, fallback) {
    return (
        error?.code ||
        error?.name ||
        fallback
    );
}


function errorMessage(error, fallback) {
    const message = String(
        error?.message ||
        fallback
    ).trim();

    return message.slice(0, 1000);
}


function isRetryableConflict(error) {
    return (
        error instanceof CommercialConflictError ||
        error?.code === 11000
    );
}


/**
 * Safely convert an exact decimal string to a provider-compatible number.
 *
 * This conversion exists only at the provider boundary. The canonical billing
 * state remains Decimal128/string-based and is never calculated with Number.
 */
function decimalToProviderNumber(value) {
    const normalized = normalizePositiveMoney(
        value,
        "provider amount"
    );

    const numberValue = Number(normalized);

    if (!Number.isFinite(numberValue)) {
        throw new CommercialValidationError(
            "Billing amount cannot be represented by the configured payment provider."
        );
    }

    if (
        Math.abs(numberValue) >=
        Number.MAX_SAFE_INTEGER
    ) {
        throw new CommercialValidationError(
            "Billing amount exceeds the safe numeric range of the configured payment provider."
        );
    }

    return numberValue;
}


/**
 * =============================================================================
 * Service
 * =============================================================================
 */

class BillingPaymentService {
    constructor({
        repository,
        invoiceService,
        paymentService = null,
        financialCore,
        logger = console,
        providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
        clock = () => new Date(),
    } = {}) {
        if (!repository) {
            throw new TypeError(
                "BillingPaymentService requires repository."
            );
        }

        if (!invoiceService) {
            throw new TypeError(
                "BillingPaymentService requires invoiceService."
            );
        }

        if (!financialCore) {
            throw new TypeError(
                "BillingPaymentService requires financialCore."
            );
        }

        if (
            !Number.isInteger(providerTimeoutMs) ||
            providerTimeoutMs <= 0
        ) {
            throw new TypeError(
                "BillingPaymentService providerTimeoutMs must be a positive integer."
            );
        }

        if (typeof clock !== "function") {
            throw new TypeError(
                "BillingPaymentService clock must be a function."
            );
        }

        this.repository = repository;
        this.invoiceService = invoiceService;
        this.paymentService = paymentService;
        this.financialCore = financialCore;
        this.logger = logger;
        this.providerTimeoutMs = providerTimeoutMs;
        this.clock = clock;
    }


    /**
     * -------------------------------------------------------------------------
     * Provider Capability Helpers
     * -------------------------------------------------------------------------
     */

    hasProviderPaymentIntentSupport() {
        return Boolean(
            this.paymentService &&
            typeof this.paymentService.createPaymentIntent === "function"
        );
    }


    hasProviderCancellationSupport() {
        return Boolean(
            this.paymentService &&
            (
                typeof this.paymentService.cancelPaymentIntent === "function" ||
                typeof this.paymentService.cancelPayment === "function"
            )
        );
    }


    async cancelProviderIntentSafely(intent, context = {}) {
        if (!intent || !this.hasProviderCancellationSupport()) {
            return false;
        }

        const intentId =
            intent?._id ??
            intent?.id ??
            intent?.paymentIntentId ??
            null;

        if (!intentId) {
            return false;
        }

        try {
            const cancellationMethod =
                typeof this.paymentService.cancelPaymentIntent === "function"
                    ? this.paymentService.cancelPaymentIntent.bind(this.paymentService)
                    : this.paymentService.cancelPayment.bind(this.paymentService);

            await cancellationMethod({
                paymentIntentId: String(intentId),
                paymentId: String(intentId),
                reason: "TITech billing payment persistence failed after provider intent creation.",
                ...context,
            });

            return true;
        } catch (error) {
            this.logger?.warn?.({
                event: "titech_billing_provider_intent_compensation_failed",
                intentId: String(intentId),
                error: errorMessage(
                    error,
                    "Provider cancellation failed."
                ),
            });

            return false;
        }
    }


    /**
     * Apply a bounded timeout to a provider call when supported.
     */
    async withTimeout(promise, timeoutMs, message) {
        let timer;

        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(message);
                error.code = "TITTECH_PROVIDER_TIMEOUT";
                reject(error);
            }, timeoutMs);

            if (typeof timer.unref === "function") {
                timer.unref();
            }
        });

        try {
            return await Promise.race([
                promise,
                timeout,
            ]);
        } finally {
            clearTimeout(timer);
        }
    }


    /**
     * -------------------------------------------------------------------------
     * Create Payment Intent
     * -------------------------------------------------------------------------
     *
     * This creates commercial payment state after the external provider intent
     * has been created. Provider intent creation is compensated when local
     * persistence fails and the provider exposes a cancellation primitive.
     */
    async createPaymentIntent({
        tenantId,
        invoiceId,
        userId,
        provider,
        idempotencyKey,
        metadata = {},
        customerEmail = null,
        requestId = null,
    } = {}, { session = null } = {}) {
        if (!tenantId) {
            throw new CommercialValidationError(
                "tenantId is required."
            );
        }

        if (!invoiceId) {
            throw new CommercialValidationError(
                "invoiceId is required."
            );
        }

        if (!userId) {
            throw new CommercialValidationError(
                "userId is required."
            );
        }

        const normalizedProvider =
            normalizeProvider(provider);

        const normalizedIdempotencyKey =
            normalizeIdempotencyKey(idempotencyKey);

        if (!this.hasProviderPaymentIntentSupport()) {
            throw new CommercialConflictError(
                "TITech payment provider service is not configured for billing payment intents."
            );
        }

        const existing =
            await this.repository.findBillingPaymentByIdempotencyKey(
                tenantId,
                normalizedIdempotencyKey,
                { session }
            );

        if (existing) {
            return {
                payment: existing,
                paymentIntent: null,
                idempotent: true,
            };
        }

        const invoice =
            await this.repository.findInvoiceById(
                tenantId,
                invoiceId,
                { session }
            );

        if (!invoice) {
            throw new CommercialNotFoundError(
                "TITech billing invoice not found.",
                { invoiceId }
            );
        }

        const invoiceCurrency =
            normalizeCurrency(invoice.currency);

        const amountDue =
            normalizePositiveMoney(
                invoice.amountDue,
                "invoice.amountDue"
            );

        if (
            ![
                ...SETTLABLE_INVOICE_STATUSES,
                "DRAFT",
            ].includes(invoice.status)
        ) {
            throw new CommercialConflictError(
                `Invoice cannot accept a payment intent while in ${invoice.status} status.`,
                {
                    invoiceId,
                    status: invoice.status,
                }
            );
        }

        if (
            compare(amountDue, "0") <= 0
        ) {
            throw new CommercialConflictError(
                "Invoice has no outstanding balance.",
                { invoiceId }
            );
        }

        /**
         * Provider intent amount is deliberately converted only at this
         * boundary. All authoritative billing arithmetic remains exact.
         */
        const providerAmount =
            decimalToProviderNumber(
                amountDue
            );

        const paymentMetadata = {
            ...sanitizeMetadata(metadata),
            tenantId: String(tenantId),
            invoiceId: String(invoiceId),
            billingPurpose: "TITEC_SAAS_SUBSCRIPTION",
            requestId: requestId
                ? String(requestId)
                : undefined,
        };

        let intent;

        try {
            intent = await this.withTimeout(
                this.paymentService.createPaymentIntent({
                    userId,
                    amount: providerAmount,
                    currency: invoiceCurrency.toLowerCase(),
                    provider: normalizedProvider,
                    metadata: paymentMetadata,
                    idempotencyKey: normalizedIdempotencyKey,
                    description:
                        `TITech SaaS invoice ${invoice.invoiceNumber}`,
                    customerEmail:
                        customerEmail || undefined,
                }),
                this.providerTimeoutMs,
                "TITech payment provider timed out while creating the billing payment intent."
            );
        } catch (error) {
            this.logger?.error?.({
                event: "titech_billing_payment_intent_provider_failure",
                tenantId: String(tenantId),
                invoiceId: String(invoiceId),
                provider: normalizedProvider,
                idempotencyKey: normalizedIdempotencyKey,
                error: errorMessage(
                    error,
                    "Payment provider intent creation failed."
                ),
            });

            throw error;
        }

        try {
            const providerPaymentId =
                normalizeReference(
                    intent?.providerPaymentId ??
                    intent?.providerId ??
                    intent?.paymentId ??
                    null,
                    "providerPaymentId"
                );

            const payment =
                await this.repository.createBillingPayment(
                    {
                        tenantId,
                        invoiceId,
                        subscriptionId:
                            invoice.subscriptionId || null,
                        amount:
                            amountDue,
                        currency:
                            invoiceCurrency,
                        status:
                            PAYMENT_STATUS.PENDING,
                        provider:
                            normalizedProvider,
                        providerPaymentId,
                        providerReference:
                            normalizeReference(
                                intent?.reference ??
                                intent?.providerReference ??
                                null,
                                "providerReference"
                            ),
                        paymentIntentId:
                            intent?._id ??
                            intent?.paymentIntentId ??
                            null,
                        idempotencyKey:
                            normalizedIdempotencyKey,
                        metadata:
                            sanitizeMetadata(metadata),
                    },
                    { session }
                );

            return {
                payment,
                paymentIntent: intent,
                idempotent: false,
            };
        } catch (error) {
            /**
             * A duplicate may mean another request won the race after both
             * requests passed the initial idempotency lookup. Prefer the
             * persisted payment rather than creating a second local record.
             */
            if (
                isRetryableConflict(error)
            ) {
                const duplicate =
                    await this.repository.findBillingPaymentByIdempotencyKey(
                        tenantId,
                        normalizedIdempotencyKey,
                        { session }
                    );

                if (duplicate) {
                    return {
                        payment:
                            duplicate,
                        paymentIntent:
                            intent,
                        idempotent:
                            true,
                    };
                }
            }

            /**
             * Local persistence failed after an external intent was created.
             * Compensate when the provider supports cancellation; otherwise
             * surface the failure loudly for reconciliation/ops handling.
             */
            await this.cancelProviderIntentSafely(
                intent,
                {
                    tenantId:
                        String(tenantId),
                    invoiceId:
                        String(invoiceId),
                    idempotencyKey:
                        normalizedIdempotencyKey,
                }
            );

            this.logger?.error?.({
                event: "titech_billing_payment_persistence_failure",
                tenantId: String(tenantId),
                invoiceId: String(invoiceId),
                provider: normalizedProvider,
                idempotencyKey: normalizedIdempotencyKey,
                providerIntentId:
                    intent?._id ??
                    intent?.paymentIntentId ??
                    null,
                error: errorMessage(
                    error,
                    "Billing payment persistence failed."
                ),
            });

            throw error;
        }
    }


    /**
     * -------------------------------------------------------------------------
     * Settle Successful Payment
     * -------------------------------------------------------------------------
     *
     * Provider success callback -> claim -> validate -> Financial Core ->
     * commercial payment SUCCESS -> atomic invoice application.
     */
    async settleSuccessfulPayment({
        tenantId,
        paymentId = null,
        idempotencyKey,
        provider,
        providerPaymentId = null,
        providerReference = null,
        paidAmount,
        occurredAt = null,
        financialContext = {},
        metadata = {},
        requestId = null,
    } = {}, { session = null } = {}) {
        if (!tenantId) {
            throw new CommercialValidationError(
                "tenantId is required."
            );
        }

        const normalizedIdempotencyKey =
            normalizeIdempotencyKey(idempotencyKey);

        const normalizedProvider =
            normalizeProvider(provider);

        const normalizedProviderPaymentId =
            normalizeReference(
                providerPaymentId,
                "providerPaymentId"
            );

        const normalizedProviderReference =
            normalizeReference(
                providerReference,
                "providerReference"
            );

        const normalizedPaidAmount =
            normalizePositiveMoney(
                paidAmount,
                "paidAmount"
            );

        const paymentOccurredAt =
            normalizeDate(
                occurredAt || this.clock(),
                "occurredAt"
            );

        let payment;

        if (paymentId) {
            const query =
                this.repository.BillingPayment?.findOne
                    ? this.repository.BillingPayment.findOne({
                        _id:
                            paymentId,
                        tenantId,
                    })
                    : null;

            payment = query
                ? await (
                    session
                        ? query.session(session).lean()
                        : query.lean()
                )
                : null;
        }

        if (!payment) {
            payment =
                await this.repository.findBillingPaymentByIdempotencyKey(
                    tenantId,
                    normalizedIdempotencyKey,
                    { session }
                );
        }

        if (
            !payment &&
            normalizedProviderPaymentId
        ) {
            payment =
                await this.repository.findBillingPaymentByProviderPaymentId(
                    normalizedProvider,
                    normalizedProviderPaymentId,
                    { session }
                );

            /**
             * Provider lookups must still satisfy tenant isolation. The current
             * repository contract is provider+ID based, so reject any tenant
             * mismatch rather than returning a cross-tenant payment.
             */
            if (
                payment &&
                String(payment.tenantId) !==
                    String(tenantId)
            ) {
                throw new CommercialConflictError(
                    "Provider payment belongs to a different TITech tenant.",
                    {
                        provider:
                            normalizedProvider,
                        providerPaymentId:
                            normalizedProviderPaymentId,
                    }
                );
            }
        }

        if (!payment) {
            throw new CommercialNotFoundError(
                "TITech billing payment not found."
            );
        }

        /**
         * Idempotent successful replay.
         */
        if (
            payment.status ===
            PAYMENT_STATUS.SUCCESS
        ) {
            if (
                compare(
                    decimalString(payment.amount),
                    normalizedPaidAmount
                ) !== 0
            ) {
                throw new CommercialConflictError(
                    "Successful payment replay amount does not match the recorded TITech billing payment amount.",
                    {
                        paymentId:
                            String(payment._id),
                        recordedAmount:
                            decimalString(payment.amount),
                        replayAmount:
                            normalizedPaidAmount,
                    }
                );
            }

            return {
                payment,
                invoice:
                    await this.repository.findInvoiceById(
                        tenantId,
                        payment.invoiceId,
                        { session }
                    ),
                financial:
                    null,
                idempotent:
                    true,
            };
        }

        if (
            !PROCESSING_PAYMENT_STATUSES.includes(
                payment.status
            )
        ) {
            throw new CommercialConflictError(
                `TITech billing payment cannot be settled from ${payment.status} status.`,
                {
                    paymentId:
                        String(payment._id),
                    status:
                        payment.status,
                }
            );
        }

        /**
         * Payment amount is fixed at intent creation and must match the
         * provider success amount exactly. Under/over-payment is not silently
         * converted into success.
         */
        if (
            compare(
                decimalString(payment.amount),
                normalizedPaidAmount
            ) !== 0
        ) {
            throw new CommercialConflictError(
                "Provider payment amount does not match the TITech billing payment amount.",
                {
                    paymentId:
                        String(payment._id),
                    expected:
                        decimalString(payment.amount),
                    received:
                        normalizedPaidAmount,
                }
            );
        }

        const invoice =
            await this.repository.findInvoiceById(
                tenantId,
                payment.invoiceId,
                { session }
            );

        if (!invoice) {
            throw new CommercialNotFoundError(
                "Invoice not found for TITech billing payment.",
                {
                    invoiceId:
                        String(payment.invoiceId),
                }
            );
        }

        const invoiceCurrency =
            normalizeCurrency(invoice.currency);

        const paymentCurrency =
            normalizeCurrency(payment.currency);

        if (
            invoiceCurrency !== paymentCurrency
        ) {
            throw new CommercialConflictError(
                "Billing payment currency does not match invoice currency.",
                {
                    invoiceCurrency,
                    paymentCurrency,
                    invoiceId:
                        String(invoice._id),
                    paymentId:
                        String(payment._id),
                }
            );
        }

        if (
            !SETTLABLE_INVOICE_STATUSES.includes(
                invoice.status
            )
        ) {
            throw new CommercialConflictError(
                `Invoice cannot accept settlement while in ${invoice.status} status.`,
                {
                    invoiceId:
                        String(invoice._id),
                    status:
                        invoice.status,
                }
            );
        }

        const amountDue =
            normalizePositiveMoney(
                invoice.amountDue,
                "invoice.amountDue"
            );

        if (
            compare(
                normalizedPaidAmount,
                amountDue
            ) > 0
        ) {
            throw new CommercialConflictError(
                "Payment exceeds the outstanding TITech invoice balance.",
                {
                    invoiceId:
                        String(invoice._id),
                    amountDue,
                    paidAmount:
                        normalizedPaidAmount,
                }
            );
        }

        /**
         * Atomic settlement claim prevents two workers/callbacks from posting
         * the same BillingPayment concurrently.
         */
        if (typeof this.repository.claimBillingPaymentSettlement !== "function") {
            throw new CommercialConflictError(
                "The TITech billing repository does not expose the atomic settlement-claim operation required for production settlement.",
                {
                    requiredMethod:
                        "claimBillingPaymentSettlement",
                }
            );
        }

        const claimed =
            await this.repository.claimBillingPaymentSettlement(
                tenantId,
                payment._id,
                { session }
            );

        if (!claimed) {
            const latest =
                await this.repository.findBillingPaymentByIdempotencyKey(
                    tenantId,
                    normalizedIdempotencyKey,
                    { session }
                );

            if (
                latest?.status ===
                PAYMENT_STATUS.SUCCESS
            ) {
                return {
                    payment:
                        latest,
                    invoice:
                        await this.repository.findInvoiceById(
                            tenantId,
                            latest.invoiceId,
                            { session }
                        ),
                    financial:
                        null,
                    idempotent:
                        true,
                };
            }

            throw new CommercialConflictError(
                "TITech billing payment is being settled concurrently; retry after the current settlement attempt completes.",
                {
                    paymentId:
                        String(payment._id),
                }
            );
        }

        payment = claimed;

        const settlementMetadata = {
            ...sanitizeMetadata(metadata),
            requestId:
                requestId
                    ? String(requestId)
                    : undefined,
        };

        let financialResult;

        try {
            /**
             * The Financial Core is intentionally called with the MongoDB
             * session supplied by the caller when available. The configured
             * adapter remains responsible for making the actual financial
             * operation atomic with its own transaction/ledger writes.
             */
            financialResult =
                await this.financialCore.postBillingPayment({
                    tenantId,
                    invoice,
                    payment,
                    amount:
                        normalizedPaidAmount,
                    currency:
                        paymentCurrency,
                    provider:
                        normalizedProvider,
                    providerPaymentId:
                        normalizedProviderPaymentId,
                    providerReference:
                        normalizedProviderReference,
                    idempotencyKey:
                        normalizedIdempotencyKey,
                    occurredAt:
                        paymentOccurredAt,
                    financialContext:
                        normalizeObject(
                            financialContext,
                            "financialContext"
                        ),
                    metadata:
                        settlementMetadata,
                    session,
                });
        } catch (error) {
            /**
             * The payment is left recoverable rather than permanently stuck in
             * PROCESSING. This is deliberately a separate database operation;
             * it must execute even when the Financial Core rejects the posting.
             */
            try {
                await this.repository.updateBillingPaymentById(
                    tenantId,
                    payment._id,
                    {
                        $set: {
                            status:
                                PAYMENT_STATUS.FAILED,
                            failureCode:
                                errorCode(
                                    error,
                                    "FINANCIAL_CORE_POSTING_FAILED"
                                ).slice(0, 120),
                            failureReason:
                                errorMessage(
                                    error,
                                    "TITech Financial Core rejected the billing payment settlement."
                                ),
                            metadata: {
                                ...(payment.metadata || {}),
                                ...settlementMetadata,
                                settlementFailure: {
                                    at:
                                        paymentOccurredAt,
                                    code:
                                        errorCode(
                                            error,
                                            "FINANCIAL_CORE_POSTING_FAILED"
                                        ),
                                },
                            },
                            updatedAt:
                                this.clock(),
                        },
                    },
                    { session }
                );
            } catch (releaseError) {
                this.logger?.error?.({
                    event:
                        "titech_billing_payment_processing_release_failed",
                    tenantId:
                        String(tenantId),
                    paymentId:
                        String(payment._id),
                    originalError:
                        errorMessage(
                            error,
                            "Financial Core posting failed."
                        ),
                    releaseError:
                        errorMessage(
                            releaseError,
                            "Failed to release processing payment."
                        ),
                });
            }

            throw error;
        }

        const financialTransactionId =
            extractFinancialTransactionId(
                financialResult
            );

        if (!financialTransactionId) {
            /**
             * Never mark commercial payment SUCCESS without authoritative
             * financial-core transaction linkage.
             */
            const error =
                new CommercialConflictError(
                    "TITech Financial Core returned no authoritative transaction ID for a successful billing posting.",
                    {
                        paymentId:
                            String(payment._id),
                    }
                );

            try {
                await this.repository.updateBillingPaymentById(
                    tenantId,
                    payment._id,
                    {
                        $set: {
                            status:
                                PAYMENT_STATUS.FAILED,
                            failureCode:
                                "FINANCIAL_CORE_TRANSACTION_ID_MISSING",
                            failureReason:
                                error.message,
                            updatedAt:
                                this.clock(),
                        },
                    },
                    { session }
                );
            } catch (releaseError) {
                this.logger?.error?.({
                    event:
                        "titech_billing_payment_processing_release_failed",
                    paymentId:
                        String(payment._id),
                    error:
                        errorMessage(
                            releaseError,
                            "Failed to release payment after missing transaction ID."
                        ),
                });
            }

            throw error;
        }

        let updatedPayment;

        try {
            updatedPayment =
                await this.repository.updateBillingPaymentById(
                    tenantId,
                    payment._id,
                    {
                        $set: {
                            status:
                                PAYMENT_STATUS.SUCCESS,
                            providerPaymentId:
                                normalizedProviderPaymentId ||
                                payment.providerPaymentId ||
                                null,
                            providerReference:
                                normalizedProviderReference ||
                                payment.providerReference ||
                                null,
                            financialTransactionId:
                                String(
                                    financialTransactionId
                                ),
                            postedAt:
                                paymentOccurredAt,
                            metadata: {
                                ...(payment.metadata || {}),
                                ...settlementMetadata,
                                financialResult:
                                    sanitizeMetadata(
                                        financialResult?.metadata || {}
                                    ),
                            },
                            updatedAt:
                                this.clock(),
                        },
                    },
                    { session }
                );
        } catch (error) {
            /**
             * At this point the Financial Core has already posted authoritative
             * money. We MUST NOT attempt another financial posting merely
             * because the commercial state update failed.
             *
             * Surface the error to reconciliation/operations instead.
             */
            this.logger?.error?.({
                event:
                    "titech_billing_payment_financial_posting_commercial_update_failed",
                tenantId:
                    String(tenantId),
                paymentId:
                    String(payment._id),
                financialTransactionId:
                    String(financialTransactionId),
                error:
                    errorMessage(
                        error,
                        "Commercial payment update failed after financial posting."
                    ),
            });

            throw new CommercialConflictError(
                "TITech Financial Core posting succeeded but commercial billing state could not be updated. Reconciliation is required; do not retry financial posting blindly.",
                {
                    paymentId:
                        String(payment._id),
                    financialTransactionId:
                        String(financialTransactionId),
                    cause:
                        errorMessage(
                            error,
                            "Commercial state update failed."
                        ),
                }
            );
        }

        if (!updatedPayment) {
            /**
             * Financial money is already posted, therefore this is a
             * reconciliation condition rather than a reason to post again.
             */
            throw new CommercialConflictError(
                "TITech financial payment was posted but its commercial payment record could not be updated. Reconciliation is required.",
                {
                    paymentId:
                        String(payment._id),
                    financialTransactionId:
                        String(financialTransactionId),
                }
            );
        }

        let updatedInvoice;

        try {
            updatedInvoice =
                await this.invoiceService.markPaid(
                    {
                        tenantId,
                        invoiceId:
                            invoice._id,
                        paymentId:
                            updatedPayment._id,
                        financialTransactionId:
                            String(
                                financialTransactionId
                            ),
                        amount:
                            normalizedPaidAmount,
                        paidAt:
                            paymentOccurredAt,
                    },
                    { session }
                );
        } catch (error) {
            /**
             * Again, money is already posted and BillingPayment is already
             * SUCCESS. Do not attempt another financial posting. This condition
             * is deliberately surfaced for reconciliation.
             */
            this.logger?.error?.({
                event:
                    "titech_billing_invoice_application_failed_after_financial_posting",
                tenantId:
                    String(tenantId),
                invoiceId:
                    String(invoice._id),
                paymentId:
                    String(updatedPayment._id),
                financialTransactionId:
                    String(financialTransactionId),
                error:
                    errorMessage(
                        error,
                        "Invoice payment application failed."
                    ),
            });

            throw new CommercialConflictError(
                "TITech financial payment succeeded but invoice application requires reconciliation; do not retry financial posting blindly.",
                {
                    invoiceId:
                        String(invoice._id),
                    paymentId:
                        String(updatedPayment._id),
                    financialTransactionId:
                        String(financialTransactionId),
                    cause:
                        errorMessage(
                            error,
                            "Invoice application failed."
                        ),
                }
            );
        }

        this.logger?.info?.({
            event:
                "titech_billing_payment_settled",
            tenantId:
                String(tenantId),
            invoiceId:
                String(invoice._id),
            paymentId:
                String(updatedPayment._id),
            financialTransactionId:
                String(financialTransactionId),
            amount:
                normalizedPaidAmount,
            currency:
                paymentCurrency,
            provider:
                normalizedProvider,
        });

        return {
            payment:
                updatedPayment,
            invoice:
                updatedInvoice,
            financial:
                financialResult,
            idempotent:
                false,
        };
    }


    /**
     * -------------------------------------------------------------------------
     * Recover a Stale Processing Payment
     * -------------------------------------------------------------------------
     *
     * This operation is for an operations/recovery worker. It deliberately
     * requires an explicit caller decision on whether the payment may be
     * failed/reconciled; it never posts money.
     */
    async failProcessingPayment({
        tenantId,
        paymentId,
        failureCode = "BILLING_SETTLEMENT_TIMEOUT",
        failureReason = "TITech billing payment settlement exceeded the allowed processing window.",
        metadata = {},
    } = {}, { session = null } = {}) {
        if (!tenantId) {
            throw new CommercialValidationError(
                "tenantId is required."
            );
        }

        if (!paymentId) {
            throw new CommercialValidationError(
                "paymentId is required."
            );
        }

        /**
         * The canonical repository currently exposes idempotency/provider
         * lookups rather than a dedicated tenant+payment-ID method. Prefer the
         * model exposed by the repository when available; otherwise fail closed.
         */
        const directQuery =
            this.repository.BillingPayment?.findOne
                ? this.repository.BillingPayment.findOne({
                    _id:
                        paymentId,
                    tenantId,
                    status:
                        PAYMENT_STATUS.PROCESSING,
                })
                : null;

        if (!directQuery) {
            throw new CommercialConflictError(
                "The TITech billing repository does not expose a payment lookup required for processing recovery.",
                { requiredCapability: "BillingPayment.findOne" }
            );
        }

        const target = await (
            session
                ? directQuery.session(session).lean()
                : directQuery.lean()
        );

        if (!target) {
            throw new CommercialNotFoundError(
                "TITech processing billing payment not found."
            );
        }

        const updated =
            await this.repository.updateBillingPaymentById(
                tenantId,
                paymentId,
                {
                    $set: {
                        status:
                            PAYMENT_STATUS.FAILED,
                        failureCode:
                            requireNonEmptyString(
                                failureCode,
                                "failureCode",
                                120
                            ),
                        failureReason:
                            requireNonEmptyString(
                                failureReason,
                                "failureReason",
                                1000
                            ),
                        metadata: {
                            ...(target.metadata || {}),
                            ...sanitizeMetadata(metadata),
                            recovery: {
                                recoveredAt:
                                    this.clock(),
                                reason:
                                    failureCode,
                            },
                        },
                        updatedAt:
                            this.clock(),
                    },
                },
                { session }
            );

        if (!updated) {
            throw new CommercialConflictError(
                "TITech billing payment changed concurrently during processing recovery.",
                {
                    paymentId:
                        String(paymentId),
                }
            );
        }

        return {
            payment:
                updated,
            recovered:
                true,
        };
    }
}


module.exports = BillingPaymentService;