// backend/mtnValidation/mtnValidation.js
/**
 * ============================================================================
 * MTN MOMO VALIDATION
 * ============================================================================
 *
 * TITech Community Capital
 *
 * Responsibilities:
 *  - Deposit Validation
 *  - Withdrawal Validation
 *  - Loan Repayment Validation
 *  - Savings Contribution Validation
 *  - Loan Disbursement Validation
 *  - Bulk Disbursement Validation
 *  - Webhook Validation
 *  - Reconciliation Validation
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const VALID_CURRENCIES = ["UGX"];

const MSISDN_REGEX =
  /^(256|0)?(7[0-9]{8}|3[0-9]{8})$/;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function sanitizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function sanitizePayload(payload = {}) {
  const sanitized = {};

  Object.keys(payload).forEach((key) => {
    const value = payload[key];

    if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
    } else {
      sanitized[key] = value;
    }
  });

  return sanitized;
}

function isValidAmount(amount) {
  const num = Number(amount);

  return (
    !Number.isNaN(num) &&
    Number.isFinite(num) &&
    num > 0
  );
}

function isValidCurrency(currency) {
  if (!currency) return true;

  return VALID_CURRENCIES.includes(
    String(currency).toUpperCase()
  );
}

function normalizePhoneNumber(msisdn) {
  const phone = sanitizeString(msisdn)
    .replace(/\s+/g, "")
    .replace(/\+/g, "");

  if (phone.startsWith("0")) {
    return `256${phone.substring(1)}`;
  }

  return phone;
}

function isValidPhoneNumber(msisdn) {
  const phone =
    normalizePhoneNumber(msisdn);

  return MSISDN_REGEX.test(phone);
}

function isValidUUID(value) {
  return UUID_REGEX.test(
    sanitizeString(value)
  );
}

function isValidDate(date) {
  return !Number.isNaN(
    new Date(date).getTime()
  );
}

function createValidationResult(
  errors = []
) {
  return {
    valid: errors.length === 0,
    errors,
  };
}

function requireField(
  payload,
  field,
  errors
) {
  if (
    payload[field] === undefined ||
    payload[field] === null ||
    payload[field] === ""
  ) {
    errors.push(
      `${field} is required`
    );
  }
}

/**
 * ============================================================================
 * COMMON TRANSACTION VALIDATION
 * ============================================================================
 */

function validateTransactionPayload(
  payload
) {
  const errors = [];

  requireField(
    payload,
    "amount",
    errors
  );

  requireField(
    payload,
    "phoneNumber",
    errors
  );

  if (
    payload.amount !== undefined &&
    !isValidAmount(payload.amount)
  ) {
    errors.push(
      "amount must be greater than zero"
    );
  }

  if (
    payload.phoneNumber &&
    !isValidPhoneNumber(
      payload.phoneNumber
    )
  ) {
    errors.push(
      "invalid phone number"
    );
  }

  if (
    payload.currency &&
    !isValidCurrency(
      payload.currency
    )
  ) {
    errors.push(
      "unsupported currency"
    );
  }

  return createValidationResult(
    errors
  );
}

/**
 * ============================================================================
 * DEPOSIT
 * ============================================================================
 */

function validateDeposit(
  payload = {}
) {
  payload =
    sanitizePayload(payload);

  return validateTransactionPayload(
    payload
  );
}

/**
 * ============================================================================
 * WITHDRAW
 * ============================================================================
 */

function validateWithdrawal(
  payload = {}
) {
  payload =
    sanitizePayload(payload);

  return validateTransactionPayload(
    payload
  );
}

/**
 * ============================================================================
 * LOAN REPAYMENT
 * ============================================================================
 */

function validateLoanRepayment(
  payload = {}
) {
  payload =
    sanitizePayload(payload);

  const result =
    validateTransactionPayload(
      payload
    );

  if (!payload.loanId) {
    result.errors.push(
      "loanId is required"
    );
  }

  result.valid =
    result.errors.length === 0;

  return result;
}

/**
 * ============================================================================
 * SAVINGS CONTRIBUTION
 * ============================================================================
 */

function validateSavingsContribution(
  payload = {}
) {
  payload =
    sanitizePayload(payload);

  const result =
    validateTransactionPayload(
      payload
    );

  if (!payload.memberId) {
    result.errors.push(
      "memberId is required"
    );
  }

  result.valid =
    result.errors.length === 0;

  return result;
}

/**
 * ============================================================================
 * DISBURSEMENT
 * ============================================================================
 */

function validateDisbursement(
  payload = {}
) {
  payload =
    sanitizePayload(payload);

  const result =
    validateTransactionPayload(
      payload
    );

  if (!payload.memberId) {
    result.errors.push(
      "memberId is required"
    );
  }

  result.valid =
    result.errors.length === 0;

  return result;
}

/**
 * ============================================================================
 * BULK DISBURSEMENT
 * ============================================================================
 */

function validateBulkDisbursement(
  payload = {}
) {
  const errors = [];

  if (
    !Array.isArray(
      payload.transactions
    )
  ) {
    errors.push(
      "transactions array required"
    );
  } else {
    payload.transactions.forEach(
      (item, index) => {
        const validation =
          validateDisbursement(
            item
          );

        if (
          !validation.valid
        ) {
          errors.push({
            index,
            errors:
              validation.errors,
          });
        }
      }
    );
  }

  return createValidationResult(
    errors
  );
}

/**
 * ============================================================================
 * WEBHOOK
 * ============================================================================
 */

function validateWebhook(
  payload = {}
) {
  const errors = [];

  if (
    !payload.referenceId &&
    !payload.externalId
  ) {
    errors.push(
      "referenceId or externalId required"
    );
  }

  if (!payload.status) {
    errors.push(
      "status required"
    );
  }

  return createValidationResult(
    errors
  );
}

/**
 * ============================================================================
 * STATUS LOOKUP
 * ============================================================================
 */

function validateReference(
  reference
) {
  const errors = [];

  if (!reference) {
    errors.push(
      "reference required"
    );
  }

  return createValidationResult(
    errors
  );
}

/**
 * ============================================================================
 * RECONCILIATION
 * ============================================================================
 */

function validateReconciliationDate(
  date
) {
  const errors = [];

  if (!date) {
    errors.push(
      "date required"
    );
  }

  if (
    date &&
    !isValidDate(date)
  ) {
    errors.push(
      "invalid date format"
    );
  }

  return createValidationResult(
    errors
  );
}

/**
 * ============================================================================
 * IDEMPOTENCY
 * ============================================================================
 */

function generateIdempotencyKey(
  payload = {}
) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(payload)
    )
    .digest("hex");
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = {
  sanitizePayload,

  normalizePhoneNumber,

  isValidAmount,

  isValidPhoneNumber,

  isValidCurrency,

  isValidUUID,

  validateDeposit,

  validateWithdrawal,

  validateLoanRepayment,

  validateSavingsContribution,

  validateDisbursement,

  validateBulkDisbursement,

  validateWebhook,

  validateReference,

  validateReconciliationDate,

  generateIdempotencyKey,
};