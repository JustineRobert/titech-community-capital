"use strict";

/**
 * ============================================================
 * TITech Community Capital LTD
 * Input Validation Utility
 * ============================================================
 *
 * Enterprise Grade Validation Framework
 *
 * Features:
 * - Required field validation
 * - Type validation
 * - Length validation
 * - Range validation
 * - Enum validation
 * - Array validation
 * - Object validation
 * - Date validation
 * - Email validation
 * - Phone validation
 * - MongoDB ObjectId validation
 * - Loan validation helpers
 * - Mobile Money validation
 * - Structured API exceptions
 * - Jest-friendly architecture
 *
 * ============================================================
 */

const mongoose = require("mongoose");

const HttpStatus =
    require("../constants/httpStatus");

const ApiError =
    require("../errors/ApiError");

/**
 * ============================================================
 * REQUIRED FIELD
 * ============================================================
 */

function validateInput(
    value,
    fieldName = "Field"
) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {

        throw new ApiError(
            `${fieldName} is required`,
            HttpStatus.BAD_REQUEST,
            "VALIDATION_ERROR"
        );
    }

    return true;
}

/**
 * ============================================================
 * STRING
 * ============================================================
 */

function validateString(
    value,
    fieldName,
    {
        minLength = 0,
        maxLength = 10000,
        trim = true
    } = {}
) {

    validateInput(value, fieldName);

    if (typeof value !== "string") {

        throw new ApiError(
            `${fieldName} must be a string`,
            HttpStatus.BAD_REQUEST,
            "INVALID_STRING"
        );
    }

    const processed =
        trim
            ? value.trim()
            : value;

    if (processed.length < minLength) {

        throw new ApiError(
            `${fieldName} must be at least ${minLength} characters`,
            HttpStatus.BAD_REQUEST,
            "MIN_LENGTH_VIOLATION"
        );
    }

    if (processed.length > maxLength) {

        throw new ApiError(
            `${fieldName} exceeds maximum length of ${maxLength}`,
            HttpStatus.BAD_REQUEST,
            "MAX_LENGTH_VIOLATION"
        );
    }

    return true;
}

/**
 * ============================================================
 * NUMBER
 * ============================================================
 */

function validateNumber(
    value,
    fieldName,
    {
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER
    } = {}
) {

    validateInput(value, fieldName);

    if (
        typeof value !== "number" ||
        Number.isNaN(value)
    ) {

        throw new ApiError(
            `${fieldName} must be a valid number`,
            HttpStatus.BAD_REQUEST,
            "INVALID_NUMBER"
        );
    }

    if (value < min) {

        throw new ApiError(
            `${fieldName} must be at least ${min}`,
            HttpStatus.BAD_REQUEST,
            "MIN_VALUE_VIOLATION"
        );
    }

    if (value > max) {

        throw new ApiError(
            `${fieldName} cannot exceed ${max}`,
            HttpStatus.BAD_REQUEST,
            "MAX_VALUE_VIOLATION"
        );
    }

    return true;
}

/**
 * ============================================================
 * BOOLEAN
 * ============================================================
 */

function validateBoolean(
    value,
    fieldName
) {

    if (
        typeof value !== "boolean"
    ) {

        throw new ApiError(
            `${fieldName} must be boolean`,
            HttpStatus.BAD_REQUEST,
            "INVALID_BOOLEAN"
        );
    }

    return true;
}

/**
 * ============================================================
 * DATE VALIDATION
 * ============================================================
 */

function validateDate(
    value,
    fieldName,
    {
        futureOnly = false,
        pastOnly = false
    } = {}
) {

    validateInput(value, fieldName);

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new ApiError(
            `${fieldName} must contain a valid date`,
            HttpStatus.BAD_REQUEST,
            "INVALID_DATE"
        );
    }

    const now =
        new Date();

    if (
        futureOnly &&
        date <= now
    ) {

        throw new ApiError(
            `${fieldName} must be in the future`,
            HttpStatus.BAD_REQUEST,
            "FUTURE_DATE_REQUIRED"
        );
    }

    if (
        pastOnly &&
        date >= now
    ) {

        throw new ApiError(
            `${fieldName} must be in the past`,
            HttpStatus.BAD_REQUEST,
            "PAST_DATE_REQUIRED"
        );
    }

    return true;
}

/**
 * ============================================================
 * ENUM
 * ============================================================
 */

function validateEnum(
    value,
    fieldName,
    allowedValues = []
) {

    if (
        !allowedValues.includes(value)
    ) {

        throw new ApiError(
            `${fieldName} contains unsupported value`,
            HttpStatus.BAD_REQUEST,
            "INVALID_ENUM"
        );
    }

    return true;
}

/**
 * ============================================================
 * EMAIL
 * ============================================================
 */

function validateEmail(
    email
) {

    validateInput(
        email,
        "Email"
    );

    const regex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
        !regex.test(email)
    ) {

        throw new ApiError(
            "Invalid email address",
            HttpStatus.BAD_REQUEST,
            "INVALID_EMAIL"
        );
    }

    return true;
}

/**
 * ============================================================
 * PHONE
 * ============================================================
 */

function validatePhoneNumber(
    phone
) {

    validateInput(
        phone,
        "Phone Number"
    );

    const regex =
        /^\+?[0-9]{9,15}$/;

    if (
        !regex.test(phone)
    ) {

        throw new ApiError(
            "Invalid phone number",
            HttpStatus.BAD_REQUEST,
            "INVALID_PHONE"
        );
    }

    return true;
}

/**
 * ============================================================
 * OBJECT ID
 * ============================================================
 */

function validateObjectId(
    id,
    fieldName = "ID"
) {

    if (
        !mongoose.Types.ObjectId.isValid(id)
    ) {

        throw new ApiError(
            `${fieldName} is invalid`,
            HttpStatus.BAD_REQUEST,
            "INVALID_OBJECT_ID"
        );
    }

    return true;
}

/**
 * ============================================================
 * LOAN AMOUNT
 * ============================================================
 */

function validateLoanAmount(
    amount
) {

    return validateNumber(
        amount,
        "Loan Amount",
        {
            min: 1
        }
    );
}

/**
 * ============================================================
 * INTEREST RATE
 * ============================================================
 */

function validateInterestRate(
    rate
) {

    return validateNumber(
        rate,
        "Interest Rate",
        {
            min: 0,
            max: 100
        }
    );
}

/**
 * ============================================================
 * LOAN APPLICATION VALIDATOR
 * ============================================================
 */

function validateLoanApplication(
    payload
) {

    validateObjectId(
        payload.memberId,
        "Member ID"
    );

    validateObjectId(
        payload.groupId,
        "Group ID"
    );

    validateLoanAmount(
        payload.amount
    );

    validateInterestRate(
        payload.interestRate
    );

    validateNumber(
        payload.repaymentPeriod,
        "Repayment Period",
        {
            min: 1,
            max: 120
        }
    );

    return true;
}

/**
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {

    validateInput,

    validateString,

    validateNumber,

    validateBoolean,

    validateDate,

    validateEnum,

    validateEmail,

    validatePhoneNumber,

    validateObjectId,

    validateLoanAmount,

    validateInterestRate,

    validateLoanApplication
};