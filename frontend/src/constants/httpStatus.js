"use strict";

/**
 * ============================================================
 * TITech Community Capital LTD
 * HTTP Status Constants
 * ============================================================
 * Enterprise Fintech Edition
 *
 * Features:
 * - REST API standards
 * - Payment processing support
 * - MTN MoMo integration support
 * - Airtel Money integration support
 * - Banking integrations
 * - Fraud detection responses
 * - Rate limiting responses
 * - API Gateway support
 * - Microservices compatibility
 * ============================================================
 */

const HttpStatus = Object.freeze({

    /* ========================================================
     * INFORMATIONAL
     * ====================================================== */

    CONTINUE: 100,
    SWITCHING_PROTOCOLS: 101,
    PROCESSING: 102,

    /* ========================================================
     * SUCCESS
     * ====================================================== */

    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NON_AUTHORITATIVE_INFORMATION: 203,
    NO_CONTENT: 204,
    RESET_CONTENT: 205,
    PARTIAL_CONTENT: 206,

    /* ========================================================
     * REDIRECTION
     * ====================================================== */

    MULTIPLE_CHOICES: 300,
    MOVED_PERMANENTLY: 301,
    FOUND: 302,
    SEE_OTHER: 303,
    NOT_MODIFIED: 304,
    TEMPORARY_REDIRECT: 307,
    PERMANENT_REDIRECT: 308,

    /* ========================================================
     * CLIENT ERRORS
     * ====================================================== */

    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,

    /**
     * Payment-related
     */
    PAYMENT_REQUIRED: 402,

    FORBIDDEN: 403,

    NOT_FOUND: 404,

    METHOD_NOT_ALLOWED: 405,

    NOT_ACCEPTABLE: 406,

    PROXY_AUTHENTICATION_REQUIRED: 407,

    REQUEST_TIMEOUT: 408,

    CONFLICT: 409,

    GONE: 410,

    LENGTH_REQUIRED: 411,

    PRECONDITION_FAILED: 412,

    PAYLOAD_TOO_LARGE: 413,

    URI_TOO_LONG: 414,

    UNSUPPORTED_MEDIA_TYPE: 415,

    RANGE_NOT_SATISFIABLE: 416,

    EXPECTATION_FAILED: 417,

    /**
     * Fintech APIs commonly use this
     */
    UNPROCESSABLE_ENTITY: 422,

    LOCKED: 423,

    FAILED_DEPENDENCY: 424,

    TOO_EARLY: 425,

    UPGRADE_REQUIRED: 426,

    PRECONDITION_REQUIRED: 428,

    /**
     * Rate Limiting
     */
    TOO_MANY_REQUESTS: 429,

    REQUEST_HEADER_FIELDS_TOO_LARGE: 431,

    UNAVAILABLE_FOR_LEGAL_REASONS: 451,

    /* ========================================================
     * SERVER ERRORS
     * ====================================================== */

    INTERNAL_SERVER_ERROR: 500,

    NOT_IMPLEMENTED: 501,

    BAD_GATEWAY: 502,

    SERVICE_UNAVAILABLE: 503,

    GATEWAY_TIMEOUT: 504,

    HTTP_VERSION_NOT_SUPPORTED: 505,

    VARIANT_ALSO_NEGOTIATES: 506,

    INSUFFICIENT_STORAGE: 507,

    LOOP_DETECTED: 508,

    NOT_EXTENDED: 510,

    NETWORK_AUTHENTICATION_REQUIRED: 511,

    /* ========================================================
     * FINTECH / BUSINESS SPECIFIC
     * ====================================================== */

    INSUFFICIENT_FUNDS: 460,

    ACCOUNT_SUSPENDED: 461,

    ACCOUNT_BLOCKED: 462,

    ACCOUNT_LIMIT_EXCEEDED: 463,

    KYC_REQUIRED: 464,

    AML_REVIEW_REQUIRED: 465,

    FRAUD_SUSPECTED: 466,

    TRANSACTION_DECLINED: 467,

    DUPLICATE_TRANSACTION: 468,

    BENEFICIARY_NOT_FOUND: 469,

    MOBILE_MONEY_PROVIDER_UNAVAILABLE: 470,

    LOAN_NOT_ELIGIBLE: 471,

    LOAN_LIMIT_EXCEEDED: 472,

    SACCO_MEMBERSHIP_REQUIRED: 473,

    GUARANTOR_REQUIREMENT_NOT_MET: 474,

    /* ========================================================
     * HELPERS
     * ====================================================== */

    isSuccess(code) {
        return code >= 200 && code < 300;
    },

    isRedirect(code) {
        return code >= 300 && code < 400;
    },

    isClientError(code) {
        return code >= 400 && code < 500;
    },

    isServerError(code) {
        return code >= 500;
    },

    isPaymentError(code) {
        return [
            this.PAYMENT_REQUIRED,
            this.INSUFFICIENT_FUNDS,
            this.TRANSACTION_DECLINED,
            this.DUPLICATE_TRANSACTION,
            this.ACCOUNT_LIMIT_EXCEEDED,
            this.MOBILE_MONEY_PROVIDER_UNAVAILABLE
        ].includes(code);
    },

    isRateLimit(code) {
        return code === this.TOO_MANY_REQUESTS;
    },

    isFraudRelated(code) {
        return [
            this.FRAUD_SUSPECTED,
            this.AML_REVIEW_REQUIRED,
            this.KYC_REQUIRED
        ].includes(code);
    }
});

module.exports = HttpStatus;