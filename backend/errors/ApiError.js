"use strict";

/**
 * ============================================================
 * TITech Community Capital LTD
 * API Error
 * ============================================================
 * Enterprise Grade Error Handling
 *
 * Features:
 * - Standardized API errors
 * - HTTP status support
 * - Error codes
 * - Validation errors
 * - Loan workflow errors
 * - Payment provider errors
 * - Correlation IDs
 * - Structured logging
 * - Jest-friendly
 *
 * ============================================================
 */

const HttpStatus =
    require("../constants/httpStatus");

class ApiError extends Error {

    constructor(
        message,
        status = HttpStatus.INTERNAL_SERVER_ERROR,
        code = "INTERNAL_ERROR",
        details = null,
        metadata = {}
    ) {

        super(message);

        this.name = this.constructor.name;

        this.status = status;

        this.code = code;

        this.details = details;

        this.metadata = metadata;

        this.timestamp =
            new Date().toISOString();

        Error.captureStackTrace(
            this,
            this.constructor
        );
    }

    /**
     * ==========================================
     * SERIALIZE
     * ==========================================
     */
    toJSON() {

        return {

            success: false,

            error: {

                name: this.name,

                code: this.code,

                message: this.message,

                status: this.status,

                details: this.details,

                metadata: this.metadata,

                timestamp: this.timestamp
            }
        };
    }

    /**
     * ==========================================
     * VALIDATION ERROR
     * ==========================================
     */
    static validation(
        message = "Validation failed",
        details = null
    ) {

        return new ApiError(
            message,
            HttpStatus.BAD_REQUEST,
            "VALIDATION_ERROR",
            details
        );
    }

    /**
     * ==========================================
     * AUTHENTICATION ERROR
     * ==========================================
     */
    static unauthorized(
        message = "Unauthorized"
    ) {

        return new ApiError(
            message,
            HttpStatus.UNAUTHORIZED,
            "UNAUTHORIZED"
        );
    }

    /**
     * ==========================================
     * FORBIDDEN
     * ==========================================
     */
    static forbidden(
        message = "Access denied"
    ) {

        return new ApiError(
            message,
            HttpStatus.FORBIDDEN,
            "FORBIDDEN"
        );
    }

    /**
     * ==========================================
     * NOT FOUND
     * ==========================================
     */
    static notFound(
        message = "Resource not found"
    ) {

        return new ApiError(
            message,
            HttpStatus.NOT_FOUND,
            "NOT_FOUND"
        );
    }

    /**
     * ==========================================
     * CONFLICT
     * ==========================================
     */
    static conflict(
        message = "Conflict detected"
    ) {

        return new ApiError(
            message,
            HttpStatus.CONFLICT,
            "CONFLICT"
        );
    }

    /**
     * ==========================================
     * PAYMENT FAILURE
     * ==========================================
     */
    static paymentFailed(
        message = "Payment failed",
        details = null
    ) {

        return new ApiError(
            message,
            HttpStatus.PAYMENT_REQUIRED,
            "PAYMENT_FAILED",
            details
        );
    }

    /**
     * ==========================================
     * INSUFFICIENT FUNDS
     * ==========================================
     */
    static insufficientFunds(
        message = "Insufficient funds"
    ) {

        return new ApiError(
            message,
            HttpStatus.INSUFFICIENT_FUNDS ||
                HttpStatus.PAYMENT_REQUIRED,
            "INSUFFICIENT_FUNDS"
        );
    }

    /**
     * ==========================================
     * RATE LIMITING
     * ==========================================
     */
    static rateLimitExceeded(
        message = "Too many requests"
    ) {

        return new ApiError(
            message,
            HttpStatus.TOO_MANY_REQUESTS,
            "RATE_LIMIT_EXCEEDED"
        );
    }

    /**
     * ==========================================
     * LOAN NOT ELIGIBLE
     * ==========================================
     */
    static loanNotEligible(
        message = "Member not eligible for loan",
        details = null
    ) {

        return new ApiError(
            message,
            HttpStatus.LOAN_NOT_ELIGIBLE ||
                HttpStatus.BAD_REQUEST,
            "LOAN_NOT_ELIGIBLE",
            details
        );
    }

    /**
     * ==========================================
     * DUPLICATE TRANSACTION
     * ==========================================
     */
    static duplicateTransaction(
        transactionId
    ) {

        return new ApiError(
            `Duplicate transaction detected: ${transactionId}`,
            HttpStatus.CONFLICT,
            "DUPLICATE_TRANSACTION"
        );
    }

    /**
     * ==========================================
     * INTERNAL ERROR
     * ==========================================
     */
    static internal(
        message = "Internal server error",
        details = null
    ) {

        return new ApiError(
            message,
            HttpStatus.INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            details
        );
    }
}

module.exports = ApiError;
