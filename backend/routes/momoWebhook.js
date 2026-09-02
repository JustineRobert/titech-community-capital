'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Mobile Money Webhook Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/momoWebhook.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure provider callback boundary for Mobile Money transactions.
 *
 * Endpoint:
 *
 *   POST /momo/callback
 *
 * Processing boundary:
 *
 *   Provider
 *      ↓
 *   Request / Correlation Context
 *      ↓
 *   Provider Authentication / Signature Verification
 *      ↓
 *   Rate Limiting
 *      ↓
 *   Payload Validation
 *      ↓
 *   Transaction Lookup
 *      ↓
 *   Replay / State Validation
 *      ↓
 *   Database Transaction
 *      ├── Transaction state
 *      ├── Ledger posting
 *      └── Wallet mutation
 *      ↓
 *   COMMIT
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This route MUST NOT trust:
 *
 *   - tenantId from the webhook body
 *   - userId from the webhook body
 *   - arbitrary account identifiers
 *   - an unsigned status field as proof of payment
 *
 * The provider transaction must map to an existing TITech transaction using
 * the previously registered external/reference ID.
 *
 * ============================================================================
 */

const express =
    require('express');

const crypto =
    require('node:crypto');

const rateLimit =
    require('express-rate-limit');

const Transaction =
    require('../models/Transaction');

const ledgerService =
    require('../services/ledgerService');

const walletService =
    require('../services/walletService');

const logger =
    require('../utils/logger');

/**
 * ============================================================================
 * Router
 * ============================================================================
 */

const router =
    express.Router({
        strict:
            false,

        caseSensitive:
            false,
    });

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const ROUTER_NAME =
    'TITechMoMoWebhookRoutes';

const ROUTER_VERSION =
    '2026.1';

const SERVICE_NAME =
    'TITech Mobile Money Webhook';

const SUCCESS_STATUS =
    'SUCCESSFUL';

const FAILED_STATUSES =
    Object.freeze([
        'FAILED',
        'CANCELLED',
        'REVERSED',
        'EXPIRED',
    ]);

const PROCESSABLE_STATUSES =
    Object.freeze([
        SUCCESS_STATUS,
        ...FAILED_STATUSES,
        'PENDING',
        'PROCESSING',
    ]);

const MAX_EXTERNAL_ID_LENGTH =
    255;

const MAX_PROVIDER_REFERENCE_LENGTH =
    255;

/**
 * ============================================================================
 * Dependency Contracts
 * ============================================================================
 */

if (
    !Transaction ||
    typeof Transaction.findOne !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] Transaction.findOne is required.`,
    );
}

if (
    typeof ledgerService?.recordEntry !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] ledgerService.recordEntry is required.`,
    );
}

if (
    typeof walletService?.creditWallet !==
        'function' ||
    typeof walletService?.debitWallet !==
        'function'
) {
    throw new TypeError(
        `[${ROUTER_NAME}] walletService.creditWallet/debitWallet are required.`,
    );
}

/**
 * ============================================================================
 * Request / Correlation Context
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null,
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return fallback;
    }

    const normalized =
        String(
            value,
        ).trim();

    return (
        normalized ||
        fallback
    );
}

function getRequestId(
    req,
) {
    return (
        normalizeString(
            req.requestId,
        ) ||
        normalizeString(
            req.id,
        ) ||
        normalizeString(
            req.headers?.[
                'x-request-id'
            ],
        ) ||
        crypto.randomUUID()
    );
}

function requestContext(
    req,
    res,
    next,
) {
    const requestId =
        getRequestId(
            req,
        );

    const correlationId =
        normalizeString(
            req.correlationId,
        ) ||
        normalizeString(
            req.headers?.[
                'x-correlation-id'
            ],
        ) ||
        requestId;

    req.requestId =
        requestId;

    req.correlationId =
        correlationId;

    res.setHeader(
        'X-Request-Id',
        requestId,
    );

    res.setHeader(
        'X-Correlation-Id',
        correlationId,
    );

    next();
}

router.use(
    requestContext,
);

/**
 * ============================================================================
 * Security Headers
 * ============================================================================
 */

router.use(
    (
        req,
        res,
        next,
    ) => {
        res.setHeader(
            'Cache-Control',
            'no-store',
        );

        res.setHeader(
            'Pragma',
            'no-cache',
        );

        res.setHeader(
            'X-Content-Type-Options',
            'nosniff',
        );

        res.setHeader(
            'Referrer-Policy',
            'no-referrer',
        );

        next();
    },
);

/**
 * ============================================================================
 * Provider Authentication / Verification
 * ============================================================================
 *
 * We deliberately do not invent a signature algorithm here because the exact
 * MTN/Airtel/provider contract depends on the integration adapter.
 *
 * Supported middleware contracts:
 *
 *   verifyMomoWebhook
 *   verifyWebhook
 *   verifySignature
 *
 * If a verifier is configured, it MUST pass before financial processing.
 *
 * If none is configured, production startup can be made fail-closed through:
 *
 *   TITECH_REQUIRE_MOMO_WEBHOOK_VERIFICATION=true
 *
 * which is strongly recommended.
 * ============================================================================
 */

const webhookVerifier =
    resolveWebhookVerifier();

const requireWebhookVerification =
    String(
        process.env
            .TITECH_REQUIRE_MOMO_WEBHOOK_VERIFICATION ||
            'true',
    ).toLowerCase() ===
    'true';

if (
    requireWebhookVerification &&
    typeof webhookVerifier !==
        'function'
) {
    throw new Error(
        `[${ROUTER_NAME}] Mobile Money webhook verification middleware is required but was not configured.`,
    );
}

if (
    typeof webhookVerifier ===
        'function'
) {
    router.use(
        webhookVerifier,
    );
}

/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 *
 * Provider callbacks should also be protected at the API gateway/load-balancer
 * where possible.
 * ============================================================================
 */

const webhookLimiter =
    rateLimit({
        windowMs:
            60 *
            1000,

        max:
            getPositiveIntegerEnv(
                'TITECH_MOMO_WEBHOOK_RATE_LIMIT',
                300,
            ),

        standardHeaders:
            'draft-8',

        legacyHeaders:
            false,

        skipSuccessfulRequests:
            false,

        keyGenerator(
            req,
        ) {
            return (
                normalizeString(
                    req.ip,
                ) ||
                normalizeString(
                    req.socket?.remoteAddress,
                ) ||
                'unknown'
            );
        },

        handler(
            req,
            res,
        ) {
            res.setHeader(
                'Retry-After',
                '60',
            );

            return res
                .status(429)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_WEBHOOK_RATE_LIMITED',

                    message:
                        'Too many Mobile Money webhook requests.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,

                    timestamp:
                        new Date().toISOString(),
                });
        },
    });

/**
 * ============================================================================
 * Provider Payload Parser
 * ============================================================================
 *
 * This route assumes upstream/provider-specific parsing has already produced
 * req.body.
 *
 * DO NOT install a global JSON parser here if the signature verifier needs raw
 * request bytes.
 * ============================================================================
 */

router.post(
    '/momo/callback',

    webhookLimiter,

    processWebhook,
);

/**
 * ============================================================================
 * Main Webhook Processor
 * ============================================================================
 */

async function processWebhook(
    req,
    res,
    next,
) {
    const log =
        createSafeLogger(
            req,
        );

    try {
        /**
         * --------------------------------------------------------------------
         * 1. Validate payload shape
         * --------------------------------------------------------------------
         */

        const payload =
            validateWebhookPayload(
                req.body,
            );

        /**
         * --------------------------------------------------------------------
         * 2. Log only non-sensitive metadata
         * --------------------------------------------------------------------
         */

        log.info(
            'MoMo callback received',
            {
                externalId:
                    payload.externalId,

                status:
                    payload.status,

                financialTransactionId:
                    payload.financialTransactionId,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            },
        );

        /**
         * --------------------------------------------------------------------
         * 3. Locate existing TITech transaction
         * --------------------------------------------------------------------
         *
         * externalId must have been generated by TITech when the provider
         * transaction was initiated.
         * --------------------------------------------------------------------
         */

        const transaction =
            await Transaction.findOne({
                externalId:
                    payload.externalId,
            });

        if (
            !transaction
        ) {
            /**
             * For provider webhooks, returning 404 can cause providers to
             * retry indefinitely.
             *
             * The safer integration strategy is to acknowledge receipt while
             * recording the unknown-reference condition for reconciliation.
             */
            log.warn(
                'MoMo transaction reference not found',
                {
                    externalId:
                        payload.externalId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                },
            );

            return res
                .status(200)
                .json({
                    success:
                        false,

                    accepted:
                        true,

                    code:
                        'TRANSACTION_REFERENCE_UNKNOWN',

                    message:
                        'Callback received for an unknown transaction reference.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        /**
         * --------------------------------------------------------------------
         * 4. Validate transaction tenant identity
         * --------------------------------------------------------------------
         *
         * tenantId comes from the persisted TITech transaction, not the
         * provider callback body.
         * --------------------------------------------------------------------
         */

        const tenantId =
            normalizeString(
                transaction.tenantId,
            );

        if (
            !tenantId
        ) {
            const error =
                new Error(
                    'Transaction does not contain a trusted tenant context.',
                );

            error.code =
                'MOMO_TRANSACTION_TENANT_MISSING';

            error.statusCode =
                500;

            throw error;
        }

        /**
         * --------------------------------------------------------------------
         * 5. Validate transaction/user identity
         * --------------------------------------------------------------------
         */

        const userId =
            normalizeString(
                transaction.user,
            );

        if (
            !userId
        ) {
            const error =
                new Error(
                    'Transaction does not contain a valid user reference.',
                );

            error.code =
                'MOMO_TRANSACTION_USER_MISSING';

            error.statusCode =
                500;

            throw error;
        }

        /**
         * --------------------------------------------------------------------
         * 6. Prevent invalid/replayed state transitions
         * --------------------------------------------------------------------
         */

        const currentStatus =
            normalizeString(
                transaction.status,
            )?.toUpperCase();

        const incomingStatus =
            payload.status;

        if (
            !PROCESSABLE_STATUSES.includes(
                incomingStatus,
            )
        ) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_STATUS_UNSUPPORTED',

                    message:
                        'Unsupported Mobile Money transaction status.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        /**
         * Idempotent replay:
         *
         * A transaction already finalized as SUCCESSFUL must not be posted
         * into the ledger or wallet again.
         */
        if (
            currentStatus ===
                SUCCESS_STATUS &&
            incomingStatus ===
                SUCCESS_STATUS
        ) {
            log.info(
                'Duplicate successful MoMo callback ignored',
                {
                    transactionId:
                        String(
                            transaction._id,
                        ),

                    externalId:
                        payload.externalId,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                },
            );

            return res
                .status(200)
                .json({
                    success:
                        true,

                    duplicate:
                        true,

                    processed:
                        true,

                    transactionId:
                        String(
                            transaction._id,
                        ),

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        /**
         * A finalized FAILED/REVERSED/CANCELLED transaction should not be
         * blindly moved back into SUCCESSFUL.
         */
        if (
            isFinalStatus(
                currentStatus,
            ) &&
            incomingStatus !==
                currentStatus
        ) {
            log.warn(
                'Invalid MoMo transaction state transition',
                {
                    transactionId:
                        String(
                            transaction._id,
                        ),

                    currentStatus,

                    incomingStatus,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                },
            );

            return res
                .status(409)
                .json({
                    success:
                        false,

                    code:
                        'MOMO_INVALID_STATE_TRANSITION',

                    message:
                        'The Mobile Money transaction is already in a final state.',

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId,
                });
        }

        /**
         * --------------------------------------------------------------------
         * 7. Process inside database transaction when supported
         * --------------------------------------------------------------------
         */

        await processTransactionFinancially({
            transaction,

            payload,

            tenantId,

            userId,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            log,
        });

        /**
         * --------------------------------------------------------------------
         * 8. Acknowledge provider
         * --------------------------------------------------------------------
         */

        return res
            .status(200)
            .json({
                success:
                    true,

                processed:
                    true,

                transactionId:
                    String(
                        transaction._id,
                    ),

                status:
                    payload.status,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    } catch (
        error
    ) {
        log.error(
            'MoMo callback processing failed',
            {
                code:
                    error?.code,

                message:
                    error?.message,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            },
        );

        /**
         * Provider callback handlers should generally avoid leaking internal
         * implementation errors.
         *
         * Returning 500 lets providers retry transient failures.
         */
        if (
            res.headersSent
        ) {
            return next(
                error,
            );
        }

        return res
            .status(
                error?.providerRetryable ===
                    false
                    ? 200
                    : 500,
            )
            .json({
                success:
                    false,

                code:
                    error?.providerRetryable ===
                        false
                        ? 'CALLBACK_REJECTED'
                        : 'CALLBACK_PROCESSING_FAILED',

                message:
                    error?.providerRetryable ===
                        false
                        ? 'Callback received but could not be applied.'
                        : 'Callback processing failed.',

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,
            });
    }
}

/**
 * ============================================================================
 * Financial Transaction Processing
 * ============================================================================
 *
 * IMPORTANT:
 * The ledger and wallet services should support a MongoDB session/options
 * argument. If the current services do not support it, the route cannot
 * provide true atomicity by itself.
 *
 * The long-term TITech design should move this function into a dedicated
 * Mobile Money / Financial Transaction service.
 * ============================================================================
 */

async function processTransactionFinancially({
    transaction,
    payload,
    tenantId,
    userId,
    requestId,
    correlationId,
    log,
}) {
    const connection =
        Transaction.db;

    /**
     * Start a MongoDB session if the model's connection supports it.
     */
    if (
        connection &&
        typeof connection.startSession ===
            'function'
    ) {
        const session =
            await connection.startSession();

        try {
            let transactionCompleted =
                false;

            await session.withTransaction(
                async () => {
                    /**
                     * Re-read transaction within the session to minimize race
                     * conditions between duplicate callbacks.
                     */
                    const current =
                        await Transaction
                            .findOne({
                                _id:
                                    transaction._id,
                            })
                            .session(
                                session,
                            );

                    if (
                        !current
                    ) {
                        throw createProcessingError(
                            'MOMO_TRANSACTION_DISAPPEARED',
                            'Transaction no longer exists.',
                        );
                    }

                    const currentStatus =
                        normalizeString(
                            current.status,
                        )?.toUpperCase();

                    /**
                     * Another concurrent callback may already have completed
                     * the transaction.
                     */
                    if (
                        currentStatus ===
                            SUCCESS_STATUS &&
                        payload.status ===
                            SUCCESS_STATUS
                    ) {
                        transactionCompleted =
                            true;

                        return;
                    }

                    /**
                     * Update provider state/reference first within the same
                     * database transaction.
                     */
                    current.status =
                        payload.status;

                    current.momoTransactionId =
                        normalizeString(
                            payload.financialTransactionId,
                        );

                    /**
                     * Provider reference metadata is stored only when the
                     * schema supports it.
                     */
                    if (
                        Object.prototype.hasOwnProperty.call(
                            current.toObject
                                ? current.toObject()
                                : current,
                            'providerReference',
                        )
                    ) {
                        current.providerReference =
                            normalizeString(
                                payload.providerReference,
                            );
                    }

                    await current.save({
                        session,
                    });

                    /**
                     * Only successful callbacks create the financial posting.
                     */
                    if (
                        payload.status !==
                        SUCCESS_STATUS
                    ) {
                        transactionCompleted =
                            true;

                        return;
                    }

                    const amount =
                        Number(
                            current.amount,
                        );

                    if (
                        !Number.isFinite(
                            amount,
                        ) ||
                        amount <=
                            0
                    ) {
                        throw createProcessingError(
                            'MOMO_TRANSACTION_AMOUNT_INVALID',
                            'Transaction amount is invalid.',
                        );
                    }

                    /**
                     * --------------------------------------------------------
                     * Ledger
                     * --------------------------------------------------------
                     *
                     * The exact account identifiers must come from the
                     * financial/accounting service. Do not use user IDs as
                     * ledger account IDs.
                     */
                    await recordLedgerEntry({
                        transaction:
                            current,

                        tenantId,

                        amount,

                        requestId,

                        correlationId,

                        session,
                    });

                    /**
                     * --------------------------------------------------------
                     * Wallet
                     * --------------------------------------------------------
                     */
                    await updateWallet({
                        transaction:
                            current,

                        tenantId,

                        userId,

                        amount,

                        requestId,

                        correlationId,

                        session,
                    });

                    transactionCompleted =
                        true;
                },
            );

            if (
                transactionCompleted
            ) {
                log.info(
                    'MoMo financial processing completed',
                    {
                        transactionId:
                            String(
                                transaction._id,
                            ),

                        tenantId,

                        status:
                            payload.status,

                        requestId,

                        correlationId,
                    },
                );
            }
        } finally {
            await session.endSession();
        }

        return;
    }

    /**
     * =========================================================================
     * Fallback
     * =========================================================================
     *
     * If MongoDB transaction support is unavailable, process via the existing
     * services. This is compatibility behavior, not the preferred TITech
     * production financial boundary.
     */
    await processWithoutSession({
        transaction,

        payload,

        tenantId,

        userId,

        requestId,

        correlationId,

        log,
    });
}

/**
 * ============================================================================
 * Non-transactional Compatibility Processing
 * ============================================================================
 */

async function processWithoutSession({
    transaction,
    payload,
    tenantId,
    userId,
    requestId,
    correlationId,
    log,
}) {
    if (
        payload.status !==
        SUCCESS_STATUS
    ) {
        transaction.status =
            payload.status;

        transaction.momoTransactionId =
            normalizeString(
                payload.financialTransactionId,
            );

        await transaction.save();

        return;
    }

    const currentStatus =
        normalizeString(
            transaction.status,
        )?.toUpperCase();

    if (
        currentStatus ===
        SUCCESS_STATUS
    ) {
        return;
    }

    transaction.status =
        payload.status;

    transaction.momoTransactionId =
        normalizeString(
            payload.financialTransactionId,
        );

    await transaction.save();

    const amount =
        Number(
            transaction.amount,
        );

    if (
        !Number.isFinite(
            amount,
        ) ||
        amount <=
            0
    ) {
        throw createProcessingError(
            'MOMO_TRANSACTION_AMOUNT_INVALID',
            'Transaction amount is invalid.',
        );
    }

    await recordLedgerEntry({
        transaction,

        tenantId,

        amount,

        requestId,

        correlationId,

        session:
            null,
    });

    await updateWallet({
        transaction,

        tenantId,

        userId,

        amount,

        requestId,

        correlationId,

        session:
            null,
    });

    log.warn(
        'MoMo callback processed without MongoDB transaction support',
        {
            transactionId:
                String(
                    transaction._id,
                ),

            tenantId,

            requestId,

            correlationId,
        },
    );
}

/**
 * ============================================================================
 * Ledger Adapter
 * ============================================================================
 *
 * The exact ledgerService API in the supplied project accepts:
 *
 *   tenantId
 *   debit
 *   credit
 *   amount
 *   ref
 *   requestId
 *
 * We deliberately do not use `transaction.user` as a ledger account unless the
 * service is explicitly designed for that.
 * ============================================================================
 */

async function recordLedgerEntry({
    transaction,
    tenantId,
    amount,
    requestId,
    correlationId,
    session,
}) {
    /**
     * `transaction.flow === credit` means funds are entering the wallet:
     *
     *   Debit  cash / provider settlement
     *   Credit customer wallet
     *
     * The exact account mapping belongs in ledgerService/configuration.
     */
    const accounts =
        resolveLedgerAccounts(
            transaction,
        );

    if (
        !accounts.debit ||
        !accounts.credit
    ) {
        throw createProcessingError(
            'MOMO_LEDGER_ACCOUNTS_NOT_CONFIGURED',
            'Mobile Money ledger accounts are not configured.',
        );
    }

    return ledgerService.recordEntry({
        tenantId,

        debit:
            accounts.debit,

        credit:
            accounts.credit,

        amount,

        ref:
            `momo:${String(
                transaction._id,
            )}`,

        requestId,

        correlationId,

        session,
    });
}

/**
 * ============================================================================
 * Wallet Adapter
 * ============================================================================
 */

async function updateWallet({
    transaction,
    tenantId,
    userId,
    amount,
    requestId,
    correlationId,
    session,
}) {
    const params = {
        userId,

        tenantId,

        amount,

        requestId,

        correlationId,

        session,
    };

    if (
        transaction.flow ===
        'credit'
    ) {
        return walletService.creditWallet(
            params,
        );
    }

    if (
        transaction.flow ===
        'debit'
    )
    {
        return walletService.debitWallet(
            params,
        );
    }

    throw createProcessingError(
        'MOMO_TRANSACTION_FLOW_INVALID',
        'Unsupported Mobile Money transaction flow.',
    );
}

/**
 * ============================================================================
 * Ledger Account Resolution
 * ============================================================================
 *
 * Do NOT hard-code USER_WALLET_ACCOUNT_ID or use a MongoDB user ID as a
 * general-ledger account.
 *
 * The preferred source is the transaction's persisted accounting metadata.
 * ============================================================================
 */

function resolveLedgerAccounts(
    transaction,
) {
    const flow =
        normalizeString(
            transaction.flow,
        )?.toLowerCase();

    const providerAccount =
        normalizeString(
            transaction.providerSettlementAccount ||
                transaction.cashAccountId ||
                process.env
                    .TITECH_MOMO_CASH_ACCOUNT_ID,
        );

    const walletAccount =
        normalizeString(
            transaction.walletAccountId,
        );

    if (
        !providerAccount ||
        !walletAccount
    ) {
        return {
            debit:
                null,

            credit:
                null,
        };
    }

    if (
        flow ===
        'credit'
    ) {
        return {
            debit:
                providerAccount,

            credit:
                walletAccount,
        };
    }

    return {
        debit:
            walletAccount,

        credit:
            providerAccount,
    };
}

/**
 * ============================================================================
 * Webhook Payload Validation
 * ============================================================================
 */

function validateWebhookPayload(
    payload,
) {
    if (
        !payload ||
        typeof payload !==
            'object' ||
        Array.isArray(
            payload,
        )
    ) {
        throw createProcessingError(
            'MOMO_CALLBACK_PAYLOAD_INVALID',
            'Invalid Mobile Money callback payload.',
            400,
        );
    }

    const externalId =
        normalizeString(
            payload.externalId,
        );

    const status =
        normalizeString(
            payload.status,
        )?.toUpperCase();

    const financialTransactionId =
        normalizeString(
            payload.financialTransactionId,
        );

    if (
        !externalId
    ) {
        throw createProcessingError(
            'MOMO_EXTERNAL_ID_REQUIRED',
            'externalId is required.',
            400,
        );
    }

    if (
        externalId.length >
        MAX_EXTERNAL_ID_LENGTH
    ) {
        throw createProcessingError(
            'MOMO_EXTERNAL_ID_INVALID',
            'externalId is invalid.',
            400,
        );
    }

    if (
        !status
    ) {
        throw createProcessingError(
            'MOMO_STATUS_REQUIRED',
            'status is required.',
            400,
        );
    }

    if (
        !PROCESSABLE_STATUSES.includes(
            status,
        )
    ) {
        throw createProcessingError(
            'MOMO_STATUS_UNSUPPORTED',
            'Unsupported Mobile Money status.',
            400,
        );
    }

    if (
        financialTransactionId &&
        financialTransactionId.length >
            MAX_PROVIDER_REFERENCE_LENGTH
    ) {
        throw createProcessingError(
            'MOMO_PROVIDER_REFERENCE_INVALID',
            'Provider transaction reference is invalid.',
            400,
        );
    }

    return {
        externalId,

        status,

        financialTransactionId,

        providerReference:
            normalizeString(
                payload.providerReference ||
                    payload.transactionId ||
                    payload.reference,
            ),
    };
}

/**
 * ============================================================================
 * Status Helpers
 * ============================================================================
 */

function isFinalStatus(
    status,
) {
    return (
        status ===
            SUCCESS_STATUS ||
        FAILED_STATUSES.includes(
            status,
        )
    );
}

/**
 * ============================================================================
 * Logger
 * ============================================================================
 */

function createSafeLogger(
    req,
) {
    const requestId =
        req.requestId;

    try {
        if (
            typeof logger?.withRequest ===
                'function'
        ) {
            return logger.withRequest(
                requestId,
            );
        }
    } catch {
        // Fall through to adapter.
    }

    return {
        info(
            message,
            metadata,
        ) {
            safeLog(
                'info',
                message,
                metadata,
            );
        },

        warn(
            message,
            metadata,
        ) {
            safeLog(
                'warn',
                message,
                metadata,
            );
        },

        error(
            message,
            metadata,
        ) {
            safeLog(
                'error',
                message,
                metadata,
            );
        },
    };
}

function safeLog(
    level,
    message,
    metadata,
) {
    try {
        const fn =
            logger?.[
                level
            ];

        if (
            typeof fn ===
                'function'
        ) {
            fn(
                message,
                metadata,
            );
        }
    } catch {
        // Logging must never break financial processing.
    }
}

/**
 * ============================================================================
 * Processing Error
 * ============================================================================
 */

function createProcessingError(
    code,
    message,
    statusCode = 500,
) {
    const error =
        new Error(
            message,
        );

    error.code =
        code;

    error.statusCode =
        statusCode;

    return error;
}

/**
 * ============================================================================
 * Environment Helpers
 * ============================================================================
 */

function getPositiveIntegerEnv(
    name,
    fallback,
) {
    const value =
        Number(
            process.env[
                name
            ],
        );

    return (
        Number.isInteger(
            value,
        ) &&
        value > 0
    )
        ? value
        : fallback;
}

/**
 * ============================================================================
 * Webhook Verifier Resolution
 * ============================================================================
 */

function resolveWebhookVerifier() {
    const candidates = [
        '../middleware/momoWebhookAuth',
        '../middleware/momoWebhookVerification',
        '../middleware/verifyMomoWebhook',
        '../middleware/webhookVerification',
    ];

    for (
        const candidate of
            candidates
    ) {
        try {
            const loaded =
                require(
                    candidate,
                );

            if (
                typeof loaded ===
                    'function'
            ) {
                return loaded;
            }

            const named =
                loaded?.verifyMomoWebhook ||
                loaded?.verifyWebhook ||
                loaded?.verifySignature;

            if (
                typeof named ===
                    'function'
            ) {
                return named;
            }
        } catch (
            error
        ) {
            if (
                error?.code !==
                    'MODULE_NOT_FOUND'
            ) {
                throw error;
            }
        }
    }

    return null;
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

router.routerName =
    ROUTER_NAME;

router.routerVersion =
    ROUTER_VERSION;

router.serviceName =
    SERVICE_NAME;

module.exports =
    router;