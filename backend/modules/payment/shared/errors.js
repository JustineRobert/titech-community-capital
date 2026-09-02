'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Error Framework
 * =============================================================================
 *
 * Centralized payment error hierarchy.
 *
 * Used by:
 *
 * • Payment Engine
 * • MTN MoMo Adapter
 * • Airtel Money Adapter
 * • Bank Integrations
 * • Callback Processing Engine
 * • Settlement Engine
 * • Reconciliation Engine
 * • Ledger Bridge
 * • Retry / Recovery Engine
 *
 *
 * Features
 * -----------------------------------------------------------------------------
 *
 * ✓ Standard error taxonomy
 * ✓ Provider-independent error handling
 * ✓ HTTP status mapping
 * ✓ Retry classification
 * ✓ Circuit breaker compatibility
 * ✓ Operational error detection
 * ✓ Root cause preservation
 * ✓ Tenant awareness
 * ✓ Correlation tracing
 * ✓ Structured logging serialization
 * ✓ API-safe responses
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 *
 * ✗ Handle retries
 * ✗ Publish events
 * ✗ Perform logging
 * ✗ Decide business outcomes
 *
 * =============================================================================
 */






/**
 * =============================================================================
 * Payment Error Codes
 * =============================================================================
 */


const PAYMENT_ERROR_CODES = Object.freeze({



    UNKNOWN:

        'PAYMENT_UNKNOWN',



    VALIDATION:

        'PAYMENT_VALIDATION',



    CONFIGURATION:

        'PAYMENT_CONFIGURATION',



    AUTHENTICATION:

        'PAYMENT_AUTHENTICATION',



    AUTHORIZATION:

        'PAYMENT_AUTHORIZATION',



    TOKEN_EXPIRED:

        'PAYMENT_TOKEN_EXPIRED',



    NETWORK:

        'PAYMENT_NETWORK',



    TIMEOUT:

        'PAYMENT_TIMEOUT',



    PROVIDER_UNAVAILABLE:

        'PAYMENT_PROVIDER_UNAVAILABLE',



    PROVIDER_REJECTED:

        'PAYMENT_PROVIDER_REJECTED',



    IDEMPOTENCY:

        'PAYMENT_IDEMPOTENCY',



    CALLBACK_VERIFICATION:

        'PAYMENT_CALLBACK_VERIFICATION',



    CALLBACK_PROCESSING:

        'PAYMENT_CALLBACK_PROCESSING',



    FRAUD:

        'PAYMENT_FRAUD',



    APPROVAL:

        'PAYMENT_APPROVAL',



    SETTLEMENT:

        'PAYMENT_SETTLEMENT',



    RECONCILIATION:

        'PAYMENT_RECONCILIATION',



    LEDGER:

        'PAYMENT_LEDGER',



    DEAD_LETTER:

        'PAYMENT_DEAD_LETTER'


});









/**
 * =============================================================================
 * Base Payment Error
 * =============================================================================
 */


class PaymentError extends Error {



    constructor({

        code = PAYMENT_ERROR_CODES.UNKNOWN,

        message = 'Payment processing error',

        httpStatus = 500,

        retryable = false,

        operational = true,

        cause = null,

        metadata = {},

        tenantId = null,

        correlationId = null,

        transactionId = null,

        provider = null

    } = {}) {



        super(message);



        Error.captureStackTrace?.(

            this,

            this.constructor

        );





        this.name =

            this.constructor.name;





        this.code = code;



        this.httpStatus = httpStatus;



        this.retryable = retryable;



        this.operational = operational;



        this.provider = provider;



        this.cause = cause;



        this.metadata = metadata;



        this.tenantId = tenantId;



        this.transactionId = transactionId;



        this.correlationId = correlationId;



        this.timestamp = new Date();


    }








    isRetryable() {


        return this.retryable;


    }








    isOperational() {


        return this.operational;


    }








    toJSON() {



        return {



            name:

                this.name,



            code:

                this.code,



            message:

                this.message,



            httpStatus:

                this.httpStatus,



            retryable:

                this.retryable,



            operational:

                this.operational,



            provider:

                this.provider,



            tenantId:

                this.tenantId,



            transactionId:

                this.transactionId,



            correlationId:

                this.correlationId,



            metadata:

                this.metadata,



            timestamp:

                this.timestamp,



            cause:

                this.cause

                    ? {

                        name:

                            this.cause.name,


                        message:

                            this.cause.message

                    }

                    : null


        };


    }








    toSafeJSON() {



        return {



            code:

                this.code,



            message:

                this.message,



            correlationId:

                this.correlationId,



            retryable:

                this.retryable


        };


    }


}









/**
 * =============================================================================
 * Validation Errors
 * =============================================================================
 */


class ValidationError extends PaymentError {



    constructor(

        message = 'Invalid payment request',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.VALIDATION,



            httpStatus:

                400,



            retryable:

                false,



            message,



            ...options



        });


    }


}









/**
 * =============================================================================
 * Authentication Errors
 * =============================================================================
 */


class AuthenticationError extends PaymentError {



    constructor(

        message = 'Payment authentication failed',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.AUTHENTICATION,



            httpStatus:

                401,



            retryable:

                false,



            message,



            ...options



        });


    }


}








class TokenExpiredError extends PaymentError {



    constructor(

        message = 'Payment provider token expired',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.TOKEN_EXPIRED,



            httpStatus:

                401,



            retryable:

                true,



            message,



            ...options



        });


    }


}









/**
 * =============================================================================
 * Provider Communication Errors
 * =============================================================================
 */


class NetworkError extends PaymentError {



    constructor(

        message = 'Payment provider network failure',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.NETWORK,



            httpStatus:

                503,



            retryable:

                true,



            message,



            ...options



        });


    }


}








class TimeoutError extends PaymentError {



    constructor(

        message = 'Payment provider timeout',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.TIMEOUT,



            httpStatus:

                504,



            retryable:

                true,



            message,



            ...options



        });


    }


}








class ProviderUnavailableError extends PaymentError {



    constructor(

        message = 'Payment provider unavailable',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.PROVIDER_UNAVAILABLE,



            httpStatus:

                503,



            retryable:

                true,



            message,



            ...options



        });


    }


}









class ProviderRejectedError extends PaymentError {



    constructor(

        message = 'Payment provider rejected transaction',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.PROVIDER_REJECTED,



            httpStatus:

                422,



            retryable:

                false,



            message,



            ...options



        });


    }


}









/**
 * =============================================================================
 * Payment Processing Errors
 * =============================================================================
 */


class IdempotencyError extends PaymentError {



    constructor(

        message = 'Duplicate payment request',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.IDEMPOTENCY,



            httpStatus:

                409,



            retryable:

                false,



            message,



            ...options



        });


    }


}








class CallbackVerificationError extends PaymentError {



    constructor(

        message = 'Callback signature verification failed',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.CALLBACK_VERIFICATION,



            httpStatus:

                401,



            retryable:

                false,



            message,



            ...options



        });


    }


}








class FraudError extends PaymentError {



    constructor(

        message = 'Payment blocked by fraud controls',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.FRAUD,



            httpStatus:

                403,



            retryable:

                false,



            message,



            ...options



        });


    }


}








class SettlementError extends PaymentError {



    constructor(

        message = 'Settlement processing failed',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.SETTLEMENT,



            httpStatus:

                500,



            retryable:

                false,



            message,



            ...options



        });


    }


}








class ReconciliationError extends PaymentError {



    constructor(

        message = 'Payment reconciliation failed',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.RECONCILIATION,



            httpStatus:

                500,



            retryable:

                false,



            message,



            ...options



        });


    }


}








class LedgerError extends PaymentError {



    constructor(

        message = 'Ledger posting failed',

        options = {}

    ) {



        super({



            code:

                PAYMENT_ERROR_CODES.LEDGER,



            httpStatus:

                500,



            retryable:

                false,



            message,



            ...options



        });


    }


}









/**
 * =============================================================================
 * Error Normalizer
 * =============================================================================
 */


function normalizeError(

    error,

    defaults = {}

) {



    if (error instanceof PaymentError) {



        return error;


    }








    return new PaymentError({



        message:

            error?.message ||

            'Unexpected payment failure',



        cause:

            error,



        ...defaults



    });


}








module.exports = {


    PAYMENT_ERROR_CODES,


    PaymentError,


    ValidationError,


    AuthenticationError,


    TokenExpiredError,


    NetworkError,


    TimeoutError,


    ProviderUnavailableError,


    ProviderRejectedError,


    IdempotencyError,


    CallbackVerificationError,


    FraudError,


    SettlementError,


    ReconciliationError,


    LedgerError,


    normalizeError


};