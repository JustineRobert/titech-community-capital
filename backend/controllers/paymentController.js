/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Payment Controller
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Multi-Tenant Aware
 * • Mobile Money (MTN, Airtel)
 * • Bank Integration Ready
 * • Double Entry Ledger Integration
 * • Fraud / AML / KYC Orchestration
 * • Idempotent Operations
 * • Distributed Transaction Support
 * • Audit Logging
 * • Event Publishing
 * • OpenTelemetry Ready
 * • Structured Logging
 * • Enterprise Error Handling
 * • MongoDB Transaction Support
 * * This controller is intentionally orchestration-only.
 * Business logic belongs inside dedicated services.
 * ============================================================================
 */

"use strict";

/* ============================================================================
 * Core Dependencies
 * ==========================================================================*/

const mongoose = require("mongoose");
const crypto = require("crypto");

/* ============================================================================
 * Models
 * ==========================================================================*/

const Payment = require("../models/Payment");

/* ============================================================================
 * Services
 * ==========================================================================*/

const paymentService = require("../services/paymentService");
const ledgerService = require("../services/ledgerService");
const auditService = require("../services/auditService");
const momoService = require("../services/momoService");

const fraudDetectionService =
    require("../services/fraudDetectionService");

const amlService =
    require("../services/amlService");

const sanctionsService =
    require("../services/sanctionsService");

const kycService =
    require("../services/kycService");

const settlementService =
    require("../services/settlementService");

const reconciliationService =
    require("../services/reconciliationService");

const eventBus =
    require("../services/eventBus");

/* ============================================================================
 * Shared Utilities
 * ==========================================================================*/

const logger =
    require("../utils/logger");

const asyncHandler =
    require("../utils/asyncHandler");

/* ============================================================================
 * Enterprise Constants
 * ==========================================================================*/

const PAYMENT_PROVIDER = Object.freeze({

    MTN: "MTN",

    AIRTEL: "AIRTEL",

    BANK: "BANK",

    CARD: "CARD"

});

const PAYMENT_STATUS = Object.freeze({

    CREATED: "CREATED",

    PENDING: "PENDING",

    PROCESSING: "PROCESSING",

    SUCCESS: "SUCCESS",

    FAILED: "FAILED",

    CANCELLED: "CANCELLED",

    REVERSED: "REVERSED",

    REFUNDED: "REFUNDED"

});

const PAYMENT_TYPE = Object.freeze({

    CONTRIBUTION: "CONTRIBUTION",

    LOAN_REPAYMENT: "LOAN_REPAYMENT",

    LOAN_DISBURSEMENT: "LOAN_DISBURSEMENT",

    SAVINGS: "SAVINGS",

    WITHDRAWAL: "WITHDRAWAL",

    PENALTY: "PENALTY",

    REGISTRATION: "REGISTRATION"

});

/* ============================================================================
 * Enterprise Controller Configuration
 * ==========================================================================*/

const CONFIG = Object.freeze({

    MAX_RETRIES: 5,

    CALLBACK_TIMEOUT_MS: 15000,

    PAYMENT_TIMEOUT_MS: 120000,

    LEDGER_TIMEOUT_MS: 15000,

    EVENT_TIMEOUT_MS: 5000,

    ENABLE_TRACING: true,

    ENABLE_AUDIT: true,

    ENABLE_FRAUD_CHECKS: true,

    ENABLE_AML: true,

    ENABLE_SANCTIONS: true,

    ENABLE_KYC: true

});

/* ============================================================================
 * Enterprise Helper Functions
 * ==========================================================================*/

function generateCorrelationId() {

    return crypto.randomUUID();
}

function generateRequestId() {

    return crypto.randomUUID();
}

function generateIdempotencyKey() {

    return crypto.randomBytes(32).toString("hex");
}

function now() {

    return new Date().toISOString();
}

/* ============================================================================
 * Base Enterprise Controller
 * ==========================================================================*/

class PaymentController {

    constructor({

        payment = paymentService,

        ledger = ledgerService,

        audit = auditService,

        momo = momoService,

        fraud = fraudDetectionService,

        aml = amlService,

        sanctions = sanctionsService,

        kyc = kycService,

        settlement = settlementService,

        reconciliation = reconciliationService,

        events = eventBus

    } = {}) {

        this.paymentService = payment;

        this.ledgerService = ledger;

        this.auditService = audit;

        this.momoService = momo;

        this.fraudService = fraud;

        this.amlService = aml;

        this.sanctionsService = sanctions;

        this.kycService = kyc;

        this.settlementService = settlement;

        this.reconciliationService = reconciliation;

        this.eventBus = events;
    }

    /* =====================================================================
     * Context Helpers
     * ===================================================================*/

    getTenant(req) {

        return req.tenant ||
            req.context?.tenant ||
            req.user?.tenantId ||
            null;
    }

    getUser(req) {

        return req.user || null;
    }

    getRequestId(req) {

        return (
            req.headers["x-request-id"] ||
            generateRequestId()
        );
    }

    getCorrelationId(req) {

        return (
            req.headers["x-correlation-id"] ||
            generateCorrelationId()
        );
    }

    getIdempotencyKey(req) {

        return (
            req.headers["idempotency-key"] ||
            generateIdempotencyKey()
        );
    }

    /* =====================================================================
     * MongoDB Transaction Helpers
     * ===================================================================*/

    async startSession() {

        const session =
            await mongoose.startSession();

        session.startTransaction();

        return session;
    }

    async commit(session) {

        await session.commitTransaction();

        session.endSession();
    }

    async rollback(session) {

        await session.abortTransaction();

        session.endSession();
    }

    /* =====================================================================
     * Logging Helpers
     * ===================================================================*/

    log(level, message, metadata = {}) {

        logger[level](message, {

            timestamp: now(),

            component: "PaymentController",

            ...metadata

        });
    }

    info(message, metadata) {

        this.log("info", message, metadata);
    }

    warn(message, metadata) {

        this.log("warn", message, metadata);
    }

    error(message, metadata) {

        this.log("error", message, metadata);
    }

    debug(message, metadata) {

        this.log("debug", message, metadata);
    }

/* ==========================================================================
 * Request Validation & Context Resolution
 * ==========================================================================*/

/**
 * Build enterprise request context.
 * This context is propagated throughout the payment lifecycle.
 */
buildRequestContext(req) {

    const tenant =
        this.getTenant(req);

    const user =
        this.getUser(req);

    return Object.freeze({

        requestId:
            this.getRequestId(req),

        correlationId:
            this.getCorrelationId(req),

        idempotencyKey:
            this.getIdempotencyKey(req),

        tenantId:
            tenant?.id ||
            tenant?._id ||
            tenant,

        tenant,

        userId:
            user?.id ||
            user?._id,

        user,

        ipAddress:
            req.ip,

        userAgent:
            req.get("user-agent"),

        source:

            req.get("x-client-type") ||

            "web",

        timestamp:

            new Date(),

        traceId:

            req.headers["traceparent"] ||

            null

    });

}

/**
 * Validate required request payload.
 */
validatePaymentRequest(body = {}) {

    const errors = [];

    if (!body.amount)
        errors.push("amount is required");

    if (
        body.amount &&
        Number(body.amount) <= 0
    ) {
        errors.push(
            "amount must be greater than zero"
        );
    }

    if (!body.groupId)
        errors.push("groupId is required");

    if (!body.phoneNumber)
        errors.push(
            "phoneNumber is required"
        );

    if (!body.provider)
        errors.push(
            "provider is required"
        );

    if (!body.type)
        errors.push(
            "payment type is required"
        );

    return {

        valid:
            errors.length === 0,

        errors

    };

}

/**
 * Validate authenticated user.
 */
validateUser(context) {

    if (!context.user)
        throw new Error(
            "Authentication required."
        );

    if (!context.userId)
        throw new Error(
            "User identifier missing."
        );

    return true;

}

/**
 * Validate tenant.
 */
validateTenant(context) {

    if (!context.tenantId) {

        throw new Error(
            "Tenant context missing."
        );

    }

    return true;

}

/**
 * Validate payment type.
 */
validatePaymentType(type) {

    if (
        !Object.values(
            PAYMENT_TYPE
        ).includes(type)
    ) {

        throw new Error(

            `Unsupported payment type: ${type}`

        );

    }

    return type;

}

/**
 * Resolve payment provider.
 */
resolveProvider(provider) {

    const normalized =
        String(provider)
            .trim()
            .toUpperCase();

    switch (normalized) {

        case PAYMENT_PROVIDER.MTN:

            return {

                provider:
                    PAYMENT_PROVIDER.MTN,

                service:
                    this.momoService

            };

        case PAYMENT_PROVIDER.AIRTEL:

            return {

                provider:
                    PAYMENT_PROVIDER.AIRTEL,

                service:
                    this.paymentService
                        .airtel ||

                    this.paymentService

            };

        case PAYMENT_PROVIDER.BANK:

            return {

                provider:
                    PAYMENT_PROVIDER.BANK,

                service:
                    this.paymentService
                        .bank ||

                    this.paymentService

            };

        default:

            throw new Error(

                `Unsupported payment provider: ${provider}`

            );

    }

}

/**
 * Resolve transaction currency.
 */
resolveCurrency(body) {

    return (

        body.currency ||

        process.env
            .DEFAULT_CURRENCY ||

        "UGX"

    ).toUpperCase();

}

/**
 * Normalize monetary amount.
 */
normalizeAmount(amount) {

    const value =
        Number(amount);

    if (
        Number.isNaN(value) ||
        value <= 0
    ) {

        throw new Error(
            "Invalid payment amount."
        );

    }

    return Number(

        value.toFixed(2)

    );

}

/**
 * Validate mobile number.
 */
validatePhoneNumber(phoneNumber) {

    if (!phoneNumber) {

        throw new Error(
            "Phone number is required."
        );

    }

    const normalized =
        phoneNumber
            .replace(/\s+/g, "")
            .replace(/-/g, "");

    if (

        normalized.length < 10 ||

        normalized.length > 15

    ) {

        throw new Error(

            "Invalid phone number."

        );

    }

    return normalized;

}

/**
 * Build provider request payload.
 */
buildProviderPayload(body, context) {

    return {

        amount:
            this.normalizeAmount(
                body.amount
            ),

        currency:
            this.resolveCurrency(body),

        phoneNumber:
            this.validatePhoneNumber(
                body.phoneNumber
            ),

        externalId:

            context.correlationId,

        payerMessage:

            body.description ||

            "Community Savings Contribution",

        payeeNote:

            body.reference ||

            body.type,

        metadata: {

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            groupId:
                body.groupId,

            paymentType:
                body.type,

            requestId:
                context.requestId,

            correlationId:
                context.correlationId

        }

    };

}

/**
 * Enterprise request bootstrap.
 * Every payment entry point should invoke this first.
 */
initializePaymentRequest(req) {

    const context =
        this.buildRequestContext(req);

    this.validateUser(context);

    this.validateTenant(context);

    const validation =
        this.validatePaymentRequest(
            req.body
        );

    if (!validation.valid) {

        throw new Error(

            validation.errors.join("; ")

        );

    }

    const provider =
        this.resolveProvider(
            req.body.provider
        );

    const paymentType =
        this.validatePaymentType(
            req.body.type
        );

    const payload =
        this.buildProviderPayload(
            req.body,
            context
        );

    return Object.freeze({

        context,

        provider,

        paymentType,

        payload

    });

}

/* ==========================================================================
 * 2.2 Enterprise Fraud / AML / KYC / Sanctions Pipeline
 * ==========================================================================*/

/**
 * Execute Fraud Detection
 */
async executeFraudAssessment(context, payload) {

    if (!CONFIG.ENABLE_FRAUD_CHECKS) {

        return {
            passed: true,
            score: 0,
            decision: "ALLOW",
            reasons: []
        };

    }

    const result =
        await this.fraudService.assess({

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            amount:
                payload.amount,

            currency:
                payload.currency,

            paymentType:
                payload.metadata.paymentType,

            phoneNumber:
                payload.phoneNumber,

            ipAddress:
                context.ipAddress,

            userAgent:
                context.userAgent,

            correlationId:
                context.correlationId

        });

    return {

        passed:
            result.passed !== false,

        score:
            result.score ?? 0,

        decision:
            result.decision ?? "ALLOW",

        reasons:
            result.reasons ?? []

    };

}

/**
 * Execute AML Verification
 */
async executeAMLAssessment(context, payload) {

    if (!CONFIG.ENABLE_AML) {

        return {

            passed: true,

            level: "LOW",

            flags: []

        };

    }

    const result =
        await this.amlService.verify({

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            amount:
                payload.amount,

            paymentType:
                payload.metadata.paymentType,

            correlationId:
                context.correlationId

        });

    return {

        passed:
            result.passed !== false,

        level:
            result.level ?? "LOW",

        flags:
            result.flags ?? []

    };

}

/**
 * Execute Sanctions Screening
 */
async executeSanctionsAssessment(context, payload) {

    if (!CONFIG.ENABLE_SANCTIONS) {

        return {

            passed: true,

            matched: false,

            matches: []

        };

    }

    const result =
        await this.sanctionsService.screen({

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            phoneNumber:
                payload.phoneNumber,

            correlationId:
                context.correlationId

        });

    return {

        passed:
            result.passed !== false,

        matched:
            result.matched ?? false,

        matches:
            result.matches ?? []

    };

}

/**
 * Execute KYC Verification
 */
async executeKYCAssessment(context) {

    if (!CONFIG.ENABLE_KYC) {

        return {

            passed: true,

            status: "VERIFIED"

        };

    }

    const result =
        await this.kycService.verify({

            tenantId:
                context.tenantId,

            userId:
                context.userId

        });

    return {

        passed:
            result.passed !== false,

        status:
            result.status ?? "UNKNOWN",

        expiry:
            result.expiry,

        level:
            result.level

    };

}

/**
 * Enterprise Risk Decision Engine
 */
determineRiskDecision(results) {

    const {

        fraud,

        aml,

        sanctions,

        kyc

    } = results;

    if (!kyc.passed) {

        return {

            action: "BLOCK",

            reason:
                "KYC verification failed"

        };

    }

    if (!sanctions.passed) {

        return {

            action: "BLOCK",

            reason:
                "Sanctions screening failed"

        };

    }

    if (!aml.passed) {

        return {

            action: "REVIEW",

            reason:
                "AML verification requires review"

        };

    }

    if (!fraud.passed) {

        return {

            action: "REVIEW",

            reason:
                "Fraud engine requires manual review"

        };

    }

    if (fraud.score >= 90) {

        return {

            action: "BLOCK",

            reason:
                "Critical fraud score"

        };

    }

    if (fraud.score >= 70) {

        return {

            action: "CHALLENGE",

            reason:
                "Step-up authentication required"

        };

    }

    return {

        action: "ALLOW",

        reason:
            "Risk assessment passed"

    };

}

/**
 * Execute Complete Enterprise Risk Pipeline
 */
async executeRiskPipeline(context, payload) {

    this.info(

        "Executing enterprise payment risk pipeline",

        {

            correlationId:
                context.correlationId,

            userId:
                context.userId

        }

    );

    const [

        fraud,

        aml,

        sanctions,

        kyc

    ] = await Promise.all([

        this.executeFraudAssessment(
            context,
            payload
        ),

        this.executeAMLAssessment(
            context,
            payload
        ),

        this.executeSanctionsAssessment(
            context,
            payload
        ),

        this.executeKYCAssessment(
            context
        )

    ]);

    const decision =
        this.determineRiskDecision({

            fraud,

            aml,

            sanctions,

            kyc

        });

    return Object.freeze({

        fraud,

        aml,

        sanctions,

        kyc,

        decision,

        evaluatedAt:
            new Date(),

        correlationId:
            context.correlationId

    });

}

/**
 * Validate Enterprise Risk Decision
 */
enforceRiskDecision(risk) {

    switch (risk.decision.action) {

        case "ALLOW":

            return;

        case "CHALLENGE":

            throw Object.assign(

                new Error(

                    "Step-up authentication required."

                ),

                {

                    code:
                        "STEP_UP_REQUIRED",

                    status: 202,

                    risk

                }

            );

        case "REVIEW":

            throw Object.assign(

                new Error(

                    "Payment queued for manual review."

                ),

                {

                    code:
                        "MANUAL_REVIEW",

                    status: 202,

                    risk

                }

            );

        case "BLOCK":

            throw Object.assign(

                new Error(

                    risk.decision.reason

                ),

                {

                    code:
                        "PAYMENT_BLOCKED",

                    status: 403,

                    risk

                }

            );

        default:

            throw new Error(

                "Unknown enterprise risk decision."

            );

    }

}

/* ==========================================================================
 * 2.3A Enterprise Payment Creation Core
 *
 * Responsibilities
 * --------------------------------------------------------------------------
 * • Idempotency enforcement
 * • MongoDB transaction management
 * • Payment persistence
 * • Provider invocation
 * • Provider response normalization
 * ==========================================================================*/

/**
 * Enforce idempotent payment creation.
 */
async enforceIdempotency(context) {

    const existing =
        await Payment.findOne({

            tenantId:
                context.tenantId,

            idempotencyKey:
                context.idempotencyKey

        });

    if (!existing) {

        return null;

    }

    this.info(

        "Duplicate payment request detected.",

        {

            paymentId:
                existing._id,

            correlationId:
                context.correlationId

        }

    );

    return existing;

}

/**
 * Create enterprise payment record.
 */
async createPaymentRecord(
    context,
    payload,
    provider,
    session
) {

    return Payment.create([{

        tenantId:
            context.tenantId,

        userId:
            context.userId,

        groupId:
            payload.metadata.groupId,

        provider:
            provider.provider,

        type:
            payload.metadata.paymentType,

        amount:
            payload.amount,

        currency:
            payload.currency,

        phoneNumber:
            payload.phoneNumber,

        status:
            PAYMENT_STATUS.CREATED,

        requestId:
            context.requestId,

        correlationId:
            context.correlationId,

        idempotencyKey:
            context.idempotencyKey,

        metadata:
            payload.metadata

    }], {

        session

    });

}

/**
 * Execute provider payment request.
 */
async executeProviderRequest(
    provider,
    payment,
    payload
) {

    switch (provider.provider) {

        case PAYMENT_PROVIDER.MTN:

            return provider.service.requestCollection({

                amount:
                    payload.amount,

                currency:
                    payload.currency,

                phoneNumber:
                    payload.phoneNumber,

                externalId:
                    payment.correlationId,

                payerMessage:
                    payload.payerMessage,

                payeeNote:
                    payload.payeeNote

            });

        case PAYMENT_PROVIDER.AIRTEL:

            return provider.service.requestCollection({

                amount:
                    payload.amount,

                currency:
                    payload.currency,

                phoneNumber:
                    payload.phoneNumber,

                externalId:
                    payment.correlationId

            });

        case PAYMENT_PROVIDER.BANK:

            return provider.service.initiateTransfer({

                amount:
                    payload.amount,

                currency:
                    payload.currency,

                reference:
                    payment.correlationId,

                metadata:
                    payload.metadata

            });

        default:

            throw new Error(

                `Unsupported provider ${provider.provider}`

            );

    }

}

/**
 * Persist provider response.
 */
async persistProviderResponse(
    payment,
    providerResponse,
    session
) {

    payment.transactionReference =

        providerResponse.transactionReference ||

        providerResponse.reference ||

        providerResponse.externalId ||

        payment.correlationId;

    payment.providerReference =

        providerResponse.providerReference ||

        providerResponse.financialTransactionId ||

        null;

    payment.status =
        PAYMENT_STATUS.PENDING;

    payment.providerResponse =
        providerResponse;

    await payment.save({

        session

    });

    return payment;

}

/**
 * Enterprise Payment Creation Orchestrator.
 */
async createEnterprisePayment(
    context,
    provider,
    payload
) {

    const duplicate =

        await this.enforceIdempotency(
            context
        );

    if (duplicate) {

        return {

            duplicate: true,

            payment: duplicate

        };

    }

    const session =
        await this.startSession();

    try {

        const [payment] =

            await this.createPaymentRecord(

                context,

                payload,

                provider,

                session

            );

        const providerResponse =

            await this.executeProviderRequest(

                provider,

                payment,

                payload

            );

        await this.persistProviderResponse(

            payment,

            providerResponse,

            session

        );

        return {

            duplicate: false,

            session,

            payment,

            providerResponse

        };

    } catch (error) {

        await this.rollback(session);

        throw error;

    }

}

/* ==========================================================================
 * 2.3B Enterprise Completion Pipeline
 *
 * Responsibilities
 * --------------------------------------------------------------------------
 * • Audit logging
 * • Domain / Outbox event publishing
 * • MongoDB transaction commit
 * • Telemetry emission
 * • Standardized API response
 * • Structured logging
 * • Exception handling & compensation
 * ==========================================================================*/

/**
 * Persist enterprise audit trail.
 */
async recordPaymentAudit(
    context,
    payment,
    providerResponse
) {

    if (!CONFIG.ENABLE_AUDIT) {
        return;
    }

    await this.auditService.record({

        actorId:
            context.userId,

        actorType:
            "MEMBER",

        action:
            "PAYMENT_CREATED",

        entity:
            "Payment",

        entityId:
            payment._id,

        correlationId:
            context.correlationId,

        requestId:
            context.requestId,

        tenantId:
            context.tenantId,

        after:
            payment.toObject(),

        metadata: {

            provider:
                payment.provider,

            transactionReference:
                payment.transactionReference,

            providerReference:
                payment.providerReference,

            providerStatus:
                providerResponse.status

        }

    });

}

/**
 * Publish enterprise payment event.
 */
async publishPaymentCreatedEvent(
    context,
    payment
) {

    await this.eventBus.publish({

        type:
            "payment.created",

        aggregate:
            "Payment",

        aggregateId:
            payment._id.toString(),

        correlationId:
            context.correlationId,

        tenantId:
            context.tenantId,

        occurredAt:
            new Date(),

        payload: {

            paymentId:
                payment._id,

            userId:
                payment.userId,

            groupId:
                payment.groupId,

            amount:
                payment.amount,

            currency:
                payment.currency,

            provider:
                payment.provider,

            status:
                payment.status

        }

    });

}

/**
 * Emit enterprise telemetry.
 */
emitPaymentTelemetry(
    context,
    payment
) {

    this.info(

        "Enterprise payment initiated.",

        {

            paymentId:
                payment._id,

            tenantId:
                context.tenantId,

            userId:
                context.userId,

            provider:
                payment.provider,

            correlationId:
                context.correlationId

        }

    );

}

/**
 * Build enterprise API response.
 */
buildPaymentResponse(
    payment,
    duplicate = false
) {

    return {

        success: true,

        duplicate,

        paymentId:
            payment._id,

        status:
            payment.status,

        provider:
            payment.provider,

        amount:
            payment.amount,

        currency:
            payment.currency,

        transactionReference:
            payment.transactionReference,

        correlationId:
            payment.correlationId,

        createdAt:
            payment.createdAt

    };

}

/**
 * Complete enterprise payment orchestration.
 */
async finalizeEnterprisePayment(
    context,
    orchestration
) {

    const {

        session,

        payment,

        providerResponse,

        duplicate

    } = orchestration;

    if (duplicate) {

        return this.buildPaymentResponse(

            payment,

            true

        );

    }

    try {

        await this.recordPaymentAudit(

            context,

            payment,

            providerResponse

        );

        await this.publishPaymentCreatedEvent(

            context,

            payment

        );

        await this.commit(session);

        this.emitPaymentTelemetry(

            context,

            payment

        );

        return this.buildPaymentResponse(

            payment,

            false

        );

    } catch (error) {

        await this.rollback(session);

        throw error;

    }

}

/**
 * Enterprise compensation handler.
 */
async compensatePaymentFailure(
    context,
    session,
    payment,
    error
) {

    try {

        if (payment) {

            payment.status =
                PAYMENT_STATUS.FAILED;

            payment.failureReason =
                error.message;

            if (session) {

                await payment.save({
                    session
                });

            } else {

                await payment.save();

            }

        }

        await this.auditService.record({

            actorId:
                "SYSTEM",

            actorType:
                "SYSTEM",

            action:
                "PAYMENT_FAILED",

            entity:
                "Payment",

            entityId:
                payment?._id,

            correlationId:
                context?.correlationId,

            tenantId:
                context?.tenantId,

            metadata: {

                error:
                    error.message,

                stack:
                    error.stack

            }

        });

        this.error(

            "Enterprise payment orchestration failed.",

            {

                paymentId:
                    payment?._id,

                correlationId:
                    context?.correlationId,

                error:
                    error.message

            }

        );

    } finally {

        if (session) {

            try {

                await this.rollback(session);

            } catch (_) {

                // Ignore rollback errors.

            }

        }

    }

}

/* ==========================================================================
 * 2.4 Enterprise Failure Handling & Recovery
 *
 * Responsibilities
 * --------------------------------------------------------------------------
 * • Transaction rollback
 * • Retry metadata generation
 * • Dead-letter queue publishing
 * • Structured error responses
 * • Metrics & tracing
 * • Enterprise compensation
 * • Recovery orchestration
 * ==========================================================================*/

/**
 * Roll back active MongoDB transaction.
 */
async rollbackTransaction(session) {

    if (!session) {
        return;
    }

    try {

        await session.abortTransaction();

    } finally {

        session.endSession();

    }

}

/**
 * Build retry metadata.
 */
buildRetryMetadata(error, context) {

    const retryableCodes = [

        "ETIMEDOUT",
        "ECONNRESET",
        "ECONNREFUSED",
        "NETWORK_ERROR",
        "PROVIDER_TIMEOUT"

    ];

    const retryable =

        retryableCodes.includes(error.code) ||

        error.retryable === true;

    const attempts =

        Number(context.retryAttempt || 0);

    return {

        retryable,

        attempt: attempts,

        nextAttempt: retryable
            ? attempts + 1
            : attempts,

        maxAttempts:
            CONFIG.MAX_RETRIES,

        retryAfter:

            retryable

                ? Math.min(

                    Math.pow(2, attempts) * 1000,

                    30000

                )

                : null

    };

}

/**
 * Publish failed orchestration
 * to enterprise dead-letter queue.
 */
async publishDeadLetter(
    context,
    payment,
    error,
    retry
) {

    if (!this.eventBus) {

        return;

    }

    await this.eventBus.publish({

        type:

            "payment.deadletter",

        aggregate:

            "Payment",

        aggregateId:

            payment?._id?.toString(),

        correlationId:

            context.correlationId,

        tenantId:

            context.tenantId,

        occurredAt:

            new Date(),

        payload: {

            paymentId:

                payment?._id,

            requestId:

                context.requestId,

            provider:

                payment?.provider,

            retry,

            error: {

                code:

                    error.code,

                message:

                    error.message

            }

        }

    });

}

/**
 * Emit enterprise metrics.
 */
emitFailureMetrics(
    context,
    payment,
    error
) {

    this.error(

        "Payment orchestration failure.",

        {

            paymentId:

                payment?._id,

            tenantId:

                context.tenantId,

            correlationId:

                context.correlationId,

            provider:

                payment?.provider,

            errorCode:

                error.code,

            message:

                error.message

        }

    );

}

/**
 * Emit tracing event.
 */
emitFailureTrace(
    context,
    error
) {

    if (!CONFIG.ENABLE_TRACING) {

        return;

    }

    this.debug(

        "Tracing payment failure.",

        {

            traceId:

                context.traceId,

            requestId:

                context.requestId,

            correlationId:

                context.correlationId,

            error:

                error.message

        }

    );

}

/**
 * Enterprise error response.
 */
buildErrorResponse(
    context,
    error,
    retry
) {

    return {

        success: false,

        timestamp:
            new Date().toISOString(),

        correlationId:
            context.correlationId,

        requestId:
            context.requestId,

        code:

            error.code ||

            "PAYMENT_FAILURE",

        message:

            error.message ||

            "Payment processing failed.",

        retry

    };

}

/**
 * Enterprise recovery orchestration.
 */
async handlePaymentFailure({

    context,

    session,

    payment,

    error

}) {

    const retry =

        this.buildRetryMetadata(

            error,

            context

        );

    try {

        if (payment) {

            payment.status =

                PAYMENT_STATUS.FAILED;

            payment.failureReason =

                error.message;

            payment.retry = retry;

            if (session) {

                await payment.save({

                    session

                });

            } else {

                await payment.save();

            }

        }

        await this.publishDeadLetter(

            context,

            payment,

            error,

            retry

        );

        this.emitFailureMetrics(

            context,

            payment,

            error

        );

        this.emitFailureTrace(

            context,

            error

        );

    } finally {

        await this.rollbackTransaction(

            session

        );

    }

    return this.buildErrorResponse(

        context,

        error,

        retry

    );

}

