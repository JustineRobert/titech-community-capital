
/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/utils/validateInput.js
 * Input Validation Utility — Native ESM
 * ============================================================================
 *
 * Validation capabilities:
 * - Required fields
 * - String type, length and trimming
 * - Finite numeric values and ranges
 * - Boolean values
 * - Date validity and temporal constraints
 * - Enumeration membership
 * - Email format
 * - E.164 international phone numbers
 * - MongoDB ObjectId validation
 * - Loan amount and interest-rate validation
 * - Loan application payload validation
 * - Structured ApiError exceptions
 *
 * Module strategy:
 * - Application package uses "type": "module".
 * - Dependencies must expose compatible ESM exports.
 * - Named and default exports are provided.
 * - A Node.js CommonJS interoperability export is provided for
 *   compatible Node.js runtimes.
 * ============================================================================
 */

import mongoose from 'mongoose';
import * as httpStatusModule from '../constants/httpStatus.js';
import ApiError from '../errors/ApiError.js';

const HttpStatus =
  httpStatusModule.default ??
  httpStatusModule.HttpStatus ??
  httpStatusModule;

/* ============================================================================
 * Internal Validation Helpers
 * ========================================================================== */

/**
 * Throw a structured validation error using TITech's canonical API error
 * class and HTTP status constants.
 */
function throwValidationError(message, code) {
  throw new ApiError(
    message,
    HttpStatus.BAD_REQUEST,
    code,
  );
}

/**
 * Validate numeric bounds supplied as configuration.
 *
 * Invalid validator configuration should fail immediately rather than
 * produce unpredictable validation outcomes.
 */
function validateNumericBounds(min, max) {
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min > max
  ) {
    throw new TypeError(
      'Validation minimum and maximum must be finite numbers, ' +
        'and minimum must not exceed maximum.',
    );
  }
}

/* ============================================================================
 * REQUIRED FIELD
 * ========================================================================== */

/**
 * Reject null, undefined, and empty-string values.
 *
 * Boolean false and numeric zero are valid supplied values.
 */
function validateInput(value, fieldName = 'Field') {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    throwValidationError(
      `${fieldName} is required`,
      'VALIDATION_ERROR',
    );
  }

  return true;
}

/* ============================================================================
 * STRING
 * ========================================================================== */

/**
 * Validate a string, optionally trimming surrounding whitespace.
 */
function validateString(
  value,
  fieldName = 'Field',
  {
    minLength = 0,
    maxLength = 10000,
    trim = true,
  } = {},
) {
  validateInput(value, fieldName);

  if (typeof value !== 'string') {
    throwValidationError(
      `${fieldName} must be a string`,
      'INVALID_STRING',
    );
  }

  if (
    !Number.isSafeInteger(minLength) ||
    !Number.isSafeInteger(maxLength) ||
    minLength < 0 ||
    maxLength < 0 ||
    minLength > maxLength
  ) {
    throw new TypeError(
      'String validation requires non-negative integer bounds, ' +
        'with minLength not exceeding maxLength.',
    );
  }

  const processed = trim
    ? value.trim()
    : value;

  if (
    trim &&
    processed.length === 0
  ) {
    throwValidationError(
      `${fieldName} is required`,
      'VALIDATION_ERROR',
    );
  }

  if (processed.length < minLength) {
    throwValidationError(
      `${fieldName} must be at least ${minLength} characters`,
      'MIN_LENGTH_VIOLATION',
    );
  }

  if (processed.length > maxLength) {
    throwValidationError(
      `${fieldName} exceeds maximum length of ${maxLength}`,
      'MAX_LENGTH_VIOLATION',
    );
  }

  return true;
}

/* ============================================================================
 * NUMBER
 * ========================================================================== */

/**
 * Accept finite JavaScript numbers within the configured range.
 *
 * Numeric strings are deliberately not coerced.
 */
function validateNumber(
  value,
  fieldName = 'Field',
  {
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
  } = {},
) {
  validateInput(value, fieldName);
  validateNumericBounds(min, max);

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    throwValidationError(
      `${fieldName} must be a valid finite number`,
      'INVALID_NUMBER',
    );
  }

  if (value < min) {
    throwValidationError(
      `${fieldName} must be at least ${min}`,
      'MIN_VALUE_VIOLATION',
    );
  }

  if (value > max) {
    throwValidationError(
      `${fieldName} cannot exceed ${max}`,
      'MAX_VALUE_VIOLATION',
    );
  }

  return true;
}

/* ============================================================================
 * BOOLEAN
 * ========================================================================== */

/**
 * Validate a strict boolean.
 *
 * Values such as "true", 1, and 0 are not implicitly converted.
 */
function validateBoolean(
  value,
  fieldName = 'Field',
) {
  validateInput(value, fieldName);

  if (typeof value !== 'boolean') {
    throwValidationError(
      `${fieldName} must be boolean`,
      'INVALID_BOOLEAN',
    );
  }

  return true;
}

/* ============================================================================
 * DATE VALIDATION
 * ========================================================================== */

/**
 * Validate a Date, date string, or numeric timestamp.
 *
 * Boolean values and arbitrary objects are not accepted as dates.
 */
function validateDate(
  value,
  fieldName = 'Date',
  {
    futureOnly = false,
    pastOnly = false,
  } = {},
) {
  validateInput(value, fieldName);

  if (
    typeof futureOnly !== 'boolean' ||
    typeof pastOnly !== 'boolean'
  ) {
    throw new TypeError(
      'futureOnly and pastOnly must be boolean options.',
    );
  }

  if (futureOnly && pastOnly) {
    throw new TypeError(
      'futureOnly and pastOnly cannot both be true.',
    );
  }

  const supportedInput =
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number';

  const date = supportedInput
    ? new Date(value instanceof Date ? value.getTime() : value)
    : new Date(Number.NaN);

  if (Number.isNaN(date.getTime())) {
    throwValidationError(
      `${fieldName} must contain a valid date`,
      'INVALID_DATE',
    );
  }

  const now = new Date();

  if (
    futureOnly &&
    date <= now
  ) {
    throwValidationError(
      `${fieldName} must be in the future`,
      'FUTURE_DATE_REQUIRED',
    );
  }

  if (
    pastOnly &&
    date >= now
  ) {
    throwValidationError(
      `${fieldName} must be in the past`,
      'PAST_DATE_REQUIRED',
    );
  }

  return true;
}

/* ============================================================================
 * ENUM
 * ========================================================================== */

/**
 * Validate membership in an explicit array of allowed values.
 */
function validateEnum(
  value,
  fieldName = 'Field',
  allowedValues = [],
) {
  validateInput(value, fieldName);

  if (!Array.isArray(allowedValues)) {
    throw new TypeError(
      'allowedValues must be an array.',
    );
  }

  if (!allowedValues.includes(value)) {
    throwValidationError(
      `${fieldName} contains unsupported value`,
      'INVALID_ENUM',
    );
  }

  return true;
}

/* ============================================================================
 * EMAIL
 * ========================================================================== */

/**
 * Validate a conventional email address.
 *
 * This performs syntax-level validation only. It does not establish that
 * the mailbox exists or that the user controls it.
 */
function validateEmail(email) {
  validateString(email, 'Email', {
    minLength: 3,
    maxLength: 254,
    trim: true,
  });

  const normalized = email.trim();

  const emailRegex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(normalized)) {
    throwValidationError(
      'Invalid email address',
      'INVALID_EMAIL',
    );
  }

  return true;
}

/* ============================================================================
 * PHONE
 * ========================================================================== */

/**
 * Validate an international phone number in E.164 representation.
 *
 * The input must include the leading plus sign and country calling code.
 * Country-specific national-number validity should be handled by an
 * appropriate phone-number normalization library.
 */
function validatePhoneNumber(phone) {
  validateString(phone, 'Phone Number', {
    minLength: 9,
    maxLength: 16,
    trim: true,
  });

  const normalized = phone.trim();

  const e164Regex =
    /^\+[1-9]\d{7,14}$/;

  if (!e164Regex.test(normalized)) {
    throwValidationError(
      'Invalid phone number. Expected E.164 format, ' +
        'e.g. +256772123546',
      'INVALID_PHONE',
    );
  }

  return true;
}

/* ============================================================================
 * MONGODB OBJECT ID
 * ========================================================================== */

/**
 * Validate an ObjectId instance or a canonical 24-character hexadecimal ID.
 *
 * Reject arbitrary numbers, short strings, and other values that might be
 * accepted by permissive ObjectId coercion.
 */
function validateObjectId(
  id,
  fieldName = 'ID',
) {
  validateInput(id, fieldName);

  const isObjectIdInstance =
    id instanceof mongoose.Types.ObjectId;

  const isCanonicalObjectIdString =
    typeof id === 'string' &&
    /^[a-f\d]{24}$/i.test(id);

  const valid =
    isObjectIdInstance ||
    (
      isCanonicalObjectIdString &&
      mongoose.Types.ObjectId.isValid(id)
    );

  if (!valid) {
    throwValidationError(
      `${fieldName} is invalid`,
      'INVALID_OBJECT_ID',
    );
  }

  return true;
}

/* ============================================================================
 * LOAN AMOUNT
 * ========================================================================== */

/**
 * Validate a positive loan amount.
 *
 * This validates numeric type and range. Currency-specific precision,
 * rounding, and ledger-safe representation must be enforced by the
 * financial domain layer.
 */
function validateLoanAmount(amount) {
  return validateNumber(
    amount,
    'Loan Amount',
    {
      min: 1,
    },
  );
}

/* ============================================================================
 * INTEREST RATE
 * ========================================================================== */

/**
 * Validate an interest rate between 0 and 100 inclusive.
 */
function validateInterestRate(rate) {
  return validateNumber(
    rate,
    'Interest Rate',
    {
      min: 0,
      max: 100,
    },
  );
}

/* ============================================================================
 * LOAN APPLICATION
 * ========================================================================== */

/**
 * Validate the required structure and basic financial fields of a loan
 * application.
 *
 * This is input validation, not authorization, credit approval, or a
 * substitute for tenant-scoped resource checks.
 */
function validateLoanApplication(payload) {
  validateInput(
    payload,
    'Loan Application',
  );

  if (
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throwValidationError(
      'Loan Application must be an object',
      'INVALID_LOAN_APPLICATION',
    );
  }

  validateObjectId(
    payload.memberId,
    'Member ID',
  );

  validateObjectId(
    payload.groupId,
    'Group ID',
  );

  validateLoanAmount(
    payload.amount,
  );

  validateInterestRate(
    payload.interestRate,
  );

  validateNumber(
    payload.repaymentPeriod,
    'Repayment Period',
    {
      min: 1,
      max: 120,
    },
  );

  if (!Number.isInteger(payload.repaymentPeriod)) {
    throwValidationError(
      'Repayment Period must be a whole number of months',
      'INVALID_REPAYMENT_PERIOD',
    );
  }

  return true;
}

/* ============================================================================
 * PUBLIC API
 * ========================================================================== */

const validationUtils = Object.freeze({
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
  validateLoanApplication,
});

/**
 * Preferred native ESM interface:
 *
 *   import validationUtils from './validateInput.js';
 *   import { validateEmail } from './validateInput.js';
 */
export {
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
  validateLoanApplication,
};

export default validationUtils;

/**
 * CommonJS interoperability for supported Node.js versions.
 *
 * The exported object retains the legacy shape:
 *
 *   const validators = require('./validateInput.js');
 *
 * Requires a Node.js version that supports require(esm) and the
 * 'module.exports' ESM export name. Jest compatibility must still be
 * verified using the repository's actual test suite.
 */
export {
  validationUtils as 'module.exports',
};
