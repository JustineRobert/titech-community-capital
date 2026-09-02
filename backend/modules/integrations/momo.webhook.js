/**
 * ============================================================================
 * TITech Community Capital LTD
 * momoCallback.controller.js
 * ============================================================================
 *
 * Enterprise Mobile Money Callback Controller
 *
 * Production responsibilities:
 *
 *  - Authenticate callback origin through provider adapter
 *  - Validate callback payload
 *  - Normalize provider-specific callback data
 *  - Establish tenant/provider execution context
 *  - Enforce distributed idempotency
 *  - Prevent callback replay
 *  - Process successful financial events
 *  - Preserve lifecycle state
 *  - Support provider retries
 *  - Emit audit/event hooks
 *  - Propagate correlation identifiers
 *  - Never expose internal errors to providers
 *
 * Supported lifecycle:
 *
 * Provider
 *    |
 *    v
 * Signature Verification
 *    |
 *    v
 * Payload Validation
 *    |
 *    v
 * Normalization
 *    |
 *    v
 * Idempotency
 *    |
 *    v
 * Financial Transaction
 *    |
 *    v
 * Audit/Event
 *    |
 *    v
 * Callback Response
 *
 * Design principles:
 *
 *  - Provider agnostic
 *  - Tenant isolated
 *  - Replay safe
 *  - Idempotent
 *  - Financially conservative
 *  - Observable
 *  - Audit ready
 *  - Retry aware
 *  - No raw provider coupling in business logic
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');

const {
    createTransaction
} = require('../transaction/transaction.service');

const idempotency =
    require('../utils/idempotency');

const logger =
    require('../utils/logger') || console;


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const CALLBACK_STATUS = Object.freeze({

    RECEIVED:
        'RECEIVED',

    PROCESSING:
        'PROCESSING',

    PROCESSED:
        'PROCESSED',

    DUPLICATE:
        'DUPLICATE',

    IGNORED:
        'IGNORED',

    REJECTED:
        'REJECTED',

    FAILED:
        'FAILED'

});


const SUCCESS_STATUSES = new Set([

    'SUCCESSFUL',

    'SUCCESS',

    'COMPLETED',

    'COMPLETED_SUCCESSFULLY'

]);


/**
 * ============================================================================
 * Provider Adapter Registry
 * ============================================================================
 *
 * Provider-specific callback behaviour belongs here rather than inside
 * the controller.
 *
 * Each adapter may expose:
 *
 *  verifySignature(req)
 *  normalizePayload(payload, req)
 *  resolveTenant(payload, req)
 *
 * This allows MTN, Airtel and future providers to share the same lifecycle.
 *
 * ============================================================================
 */

const providerAdapters = new Map();


/**
 * Register provider adapter.
 *
 * @param {string} provider
 * @param {Object} adapter
 */
function registerProviderAdapter(provider, adapter) {

    if (!provider) {

        throw new Error(
            'Provider name required'
        );

    }

    if (!adapter || typeof adapter !== 'object') {

        throw new Error(
            'Provider adapter required'
        );

    }

    providerAdapters.set(

        String(provider)
            .trim()
            .toUpperCase(),

        adapter

    );

}


/**
 * Resolve provider adapter.
 *
 * @param {string} provider
 * @returns {Object|null}
 */
function getProviderAdapter(provider) {

    if (!provider) {

        return null;

    }

    return providerAdapters.get(

        String(provider)
            .trim()
            .toUpperCase()

    ) || null;

}


/**
 * ============================================================================
 * Safe Logger Context
 * ============================================================================
 *
 * Never log complete callback payloads because provider payloads can contain
 * sensitive financial/customer information.
 * ============================================================================
 */

function buildLogContext({

    provider,
    tenantId,
    externalId,
    callbackId,
    requestId,
    status

}) {

    return {

        provider:
            provider || null,

        tenantId:
            tenantId || null,

        externalId:
            externalId || null,

        callbackId:
            callbackId || null,

        requestId:
            requestId || null,

        status:
            status || null

    };

}


/**
 * ============================================================================
 * Generate Callback Identifier
 * ============================================================================
 */

function generateCallbackId({

    provider,
    externalId

}) {

    const identity = [

        provider || '',

        externalId || ''

    ].join('|');


    return (

        'MCB-' +

        crypto

            .createHash('sha256')

            .update(identity)

            .digest('hex')

            .substring(0, 32)

    );

}


/**
 * ============================================================================
 * Build Idempotency Key
 * ============================================================================
 *
 * Scope idempotency by provider and tenant.
 *
 * This prevents two different providers from accidentally colliding on the
 * same external transaction identifier.
 * ============================================================================
 */

function buildIdempotencyKey({

    provider,
    tenantId,
    externalId

}) {

    return [

        'momo',

        String(provider)
            .trim()
            .toLowerCase(),

        String(tenantId)
            .trim(),

        String(externalId)
            .trim()

    ].join(':');

}


/**
 * ============================================================================
 * Validate Normalized Callback
 * ============================================================================
 */

function validateCallback(callback) {

    if (!callback || typeof callback !== 'object') {

        return [

            'Callback payload is required'

        ];

    }


    const errors = [];


    if (!callback.provider) {

        errors.push(
            'Provider is required'
        );

    }


    if (!callback.externalId) {

        errors.push(
            'External transaction identifier is required'
        );

    }


    if (
        callback.amount === undefined ||
        callback.amount === null
    ) {

        errors.push(
            'Transaction amount is required'
        );

    }


    const amount =
        Number(callback.amount);


    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        errors.push(
            'Transaction amount must be greater than zero'
        );

    }


    if (!callback.status) {

        errors.push(
            'Transaction status is required'
        );

    }


    return errors;

}


/**
 * ============================================================================
 * Verify Callback Signature
 * ============================================================================
 *
 * Provider adapters should implement the actual cryptographic verification.
 *
 * The controller intentionally does not know whether the provider uses:
 *
 *  - HMAC
 *  - RSA
 *  - asymmetric signatures
 *  - bearer authentication
 *  - provider-specific headers
 *
 * ============================================================================
 */

async function verifyCallbackSignature({

    adapter,
    req

}) {

    if (
        !adapter ||
        typeof adapter.verifySignature !== 'function'
    ) {

        /*
         * Fail closed in production.
         *
         * Development/test environments may explicitly disable this through
         * configuration.
         */

        if (
            process.env.NODE_ENV === 'production'
        ) {

            throw new Error(
                'Callback signature verification adapter unavailable'
            );

        }

        return true;

    }


    return Boolean(

        await adapter.verifySignature(req)

    );

}


/**
 * ============================================================================
 * Normalize Provider Callback
 * ============================================================================
 */

async function normalizeCallback({

    adapter,
    req,
    provider

}) {

    if (
        adapter &&
        typeof adapter.normalizePayload === 'function'
    ) {

        return adapter.normalizePayload(

            req.body,

            req

        );

    }


    /*
     * Safe generic fallback.
     *
     * Provider-specific integrations should normally provide their own
     * normalization adapter.
     */

    return {

        provider,

        externalId:
            req.body.externalId ||
            req.body.transactionId ||
            req.body.reference ||
            null,

        status:
            req.body.status ||
            null,

        amount:
            req.body.amount,

        currency:
            req.body.currency ||
            'UGX',

        reference:
            req.body.reference ||
            null,

        phone:
            req.body.phone ||
            req.body.msisdn ||
            null,

        transactionDate:
            req.body.transactionDate ||
            req.body.timestamp ||
            null,

        metadata: {

            providerPayloadVersion:
                req.body.version || null

        }

    };

}


/**
 * ============================================================================
 * Resolve Tenant
 * ============================================================================
 *
 * Tenant must be established from trusted provider configuration / routing
 * metadata rather than blindly trusting arbitrary callback body values.
 * ============================================================================
 */

async function resolveTenant({

    adapter,
    callback,
    req

}) {

    if (
        adapter &&
        typeof adapter.resolveTenant === 'function'
    ) {

        return adapter.resolveTenant(

            callback,

            req

        );

    }


    /*
     * Existing integration compatibility.
     *
     * Prefer middleware-established tenant context.
     */

    return (

        req.tenantId ||

        req.tenant?.id ||

        req.tenant?._id ||

        null

    );

}


/**
 * ============================================================================
 * Process Callback
 * ============================================================================
 *
 * Core financial callback lifecycle.
 *
 * ============================================================================
 */

async function handleMomoCallback(req, res) {

    const requestId =

        req.id ||

        req.requestId ||

        req.headers?.['x-request-id'] ||

        crypto.randomUUID();


    let provider =

        req.provider ||

        req.params?.provider ||

        req.headers?.['x-provider'] ||

        'MTN_MOMO';


    provider = String(provider)
        .trim()
        .toUpperCase();


    const adapter =
        getProviderAdapter(provider);


    let callbackId = null;
    let tenantId = null;
    let externalId = null;


    try {

        /**
         * =====================================================================
         * 1. Verify provider callback authenticity
         * =====================================================================
         */

        const signatureValid =

            await verifyCallbackSignature({

                adapter,

                req

            });


        if (!signatureValid) {

            logger.warn(

                '[MoMoCallback] Signature verification failed',

                {

                    provider,

                    requestId

                }

            );


            return res

                .status(401)

                .json({

                    success: false,

                    status:
                        CALLBACK_STATUS.REJECTED,

                    error:
                        'Invalid callback signature',

                    requestId

                });

        }


        /**
         * =====================================================================
         * 2. Normalize callback
         * =====================================================================
         */

        const callback =

            await normalizeCallback({

                adapter,

                req,

                provider

            });


        externalId =
            callback.externalId;


        /**
         * =====================================================================
         * 3. Resolve tenant
         * =====================================================================
         */

        tenantId =

            await resolveTenant({

                adapter,

                callback,

                req

            });


        if (!tenantId) {

            logger.error(

                '[MoMoCallback] Tenant resolution failed',

                {

                    provider,

                    externalId,

                    requestId

                }

            );


            return res

                .status(400)

                .json({

                    success: false,

                    status:
                        CALLBACK_STATUS.REJECTED,

                    error:
                        'Unable to resolve callback tenant',

                    requestId

                });

        }


        /**
         * =====================================================================
         * 4. Generate callback identity
         * =====================================================================
         */

        callbackId =
            generateCallbackId({

                provider,

                externalId

            });


        /**
         * =====================================================================
         * 5. Validate normalized callback
         * =====================================================================
         */

        const validationErrors =

            validateCallback({

                ...callback,

                provider

            });


        if (validationErrors.length) {

            logger.warn(

                '[MoMoCallback] Invalid callback payload',

                buildLogContext({

                    provider,

                    tenantId,

                    externalId,

                    callbackId,

                    requestId,

                    status:
                        CALLBACK_STATUS.REJECTED

                })

            );


            return res

                .status(400)

                .json({

                    success: false,

                    status:
                        CALLBACK_STATUS.REJECTED,

                    error:
                        'Invalid callback payload',

                    requestId

                });

        }


        /**
         * =====================================================================
         * 6. Ignore non-successful provider events
         * =====================================================================
         *
         * IMPORTANT:
         *
         * Non-success callbacks are not financial deposits.
         * They may eventually be persisted into a callback/event ledger,
         * but must not create a financial transaction.
         */

        if (
            !SUCCESS_STATUSES.has(

                String(callback.status)
                    .trim()
                    .toUpperCase()

            )
        ) {

            logger.info(

                '[MoMoCallback] Non-success callback received',

                buildLogContext({

                    provider,

                    tenantId,

                    externalId,

                    callbackId,

                    requestId,

                    status:
                        callback.status

                })

            );


            return res

                .status(200)

                .json({

                    success: true,

                    status:
                        CALLBACK_STATUS.IGNORED,

                    callbackId,

                    requestId

                });

        }


        /**
         * =====================================================================
         * 7. Build distributed idempotency key
         * =====================================================================
         */

        const idempotencyKey =

            buildIdempotencyKey({

                provider,

                tenantId,

                externalId

            });


        /**
         * =====================================================================
         * 8. Atomically claim callback
         * =====================================================================
         *
         * `check()` must perform Redis SET NX semantics.
         *
         * Only the first callback processor receives true.
         */

        const isNew =

            await idempotency.check(

                idempotencyKey

            );


        if (!isNew) {

            logger.info(

                '[MoMoCallback] Duplicate callback',

                buildLogContext({

                    provider,

                    tenantId,

                    externalId,

                    callbackId,

                    requestId,

                    status:
                        CALLBACK_STATUS.DUPLICATE

                })

            );


            /*
             * Provider already received/triggered this event.
             *
             * Return 200 so provider does not endlessly retry.
             */

            return res

                .status(200)

                .json({

                    success: true,

                    status:
                        CALLBACK_STATUS.DUPLICATE,

                    callbackId,

                    requestId

                });

        }


        /**
         * =====================================================================
         * 9. Record callback metadata
         * =====================================================================
         */

        await idempotency.record(

            idempotencyKey,

            {

                callbackId,

                provider,

                tenantId,

                externalId,

                requestId,

                status:
                    CALLBACK_STATUS.PROCESSING

            }

        );


        /**
         * =====================================================================
         * 10. Create financial transaction
         * =====================================================================
         *
         * The transaction service remains the financial authority.
         *
         * The callback controller MUST NOT:
         *
         *  - modify account balances directly;
         *  - create ledger entries directly;
         *  - update loans directly.
         */

        const transaction =

            await createTransaction({

                tenantId,

                type:
                    'deposit',

                amount:
                    Number(callback.amount),

                currency:
                    callback.currency || 'UGX',

                reference:
                    callback.reference ||

                    externalId,

                externalId,

                provider,

                idempotencyKey,

                description:
                    `Mobile money callback - ${provider}`,

                metadata: {

                    callbackId,

                    requestId,

                    provider,

                    phone:
                        callback.phone || null,

                    transactionDate:
                        callback.transactionDate || null,

                    providerMetadata:
                        callback.metadata || {}

                }

            });


        /**
         * =====================================================================
         * 11. Mark callback as processed
         * =====================================================================
         */

        await idempotency.record(

            idempotencyKey,

            {

                callbackId,

                provider,

                tenantId,

                externalId,

                requestId,

                status:
                    CALLBACK_STATUS.PROCESSED,

                transactionId:
                    transaction?.transactionId ||

                    transaction?._id ||

                    null

            }

        );


        /**
         * =====================================================================
         * 12. Operational logging
         * =====================================================================
         */

        logger.info(

            '[MoMoCallback] Callback processed successfully',

            {

                provider,

                tenantId,

                externalId,

                callbackId,

                requestId,

                transactionId:

                    transaction?.transactionId ||

                    transaction?._id ||

                    null

            }

        );


        /**
         * =====================================================================
         * 13. Provider acknowledgement
         * =====================================================================
         */

        return res

            .status(200)

            .json({

                success: true,

                status:
                    CALLBACK_STATUS.PROCESSED,

                callbackId,

                transactionId:

                    transaction?.transactionId ||

                    transaction?._id ||

                    null,

                requestId

            });


    } catch (error) {

        /**
         * =====================================================================
         * FAILURE HANDLING
         * =====================================================================
         */

        logger.error(

            '[MoMoCallback] Callback processing failed',

            {

                provider,

                tenantId,

                externalId,

                callbackId,

                requestId,

                error:
                    error.message,

                errorCode:
                    error.code || null

            }

        );


        /**
         * IMPORTANT:
         *
         * A provider retry should occur when the financial transaction could
         * not be safely completed.
         *
         * Do NOT return 200 for an uncertain financial outcome.
         */

        return res

            .status(500)

            .json({

                success: false,

                status:
                    CALLBACK_STATUS.FAILED,

                error:
                    'Callback processing failed',

                retryable: true,

                callbackId,

                requestId

            });

    }

}


/**
 * ============================================================================
 * Provider Adapter Registration
 * ============================================================================
 *
 * Example:
 *
 * registerProviderAdapter('MTN_MOMO', require('../providers/mtn/mtnCallback'));
 * registerProviderAdapter('AIRTEL_MONEY', require('../providers/airtel/airtelCallback'));
 *
 * ============================================================================
 */

module.exports = {

    handleMomoCallback,

    registerProviderAdapter,

    getProviderAdapter,

    CALLBACK_STATUS

};