// backend/validation/airtelValidation.js
/**
 * ============================================================================
 * AIRTEL MONEY VALIDATION
 * ============================================================================
 *
 * TITech Community Capital
 *
 * Responsibilities
 *  - Deposit Validation
 *  - Withdrawal Validation
 *  - Loan Repayment Validation
 *  - Savings Contribution Validation
 *  - Disbursement Validation
 *  - Bulk Disbursement Validation
 *  - Webhook Validation
 *  - Status Validation
 *  - Reconciliation Validation
 *
 * ============================================================================
 */

const Joi = require("joi");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const PHONE_REGEX =
  /^\+?[1-9]\d{7,14}$/;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CURRENCIES = [
  "UGX",
  "KES",
  "TZS",
  "RWF",
  "USD",
];

/**
 * ============================================================================
 * COMMON SCHEMAS
 * ============================================================================
 */

const amountSchema = Joi.number()
  .positive()
  .precision(2)
  .max(1000000000)
  .required();

const phoneSchema = Joi.string()
  .trim()
  .pattern(PHONE_REGEX)
  .required()
  .messages({
    "string.pattern.base":
      "Phone number must be a valid E.164 number",
  });

const currencySchema = Joi.string()
  .uppercase()
  .valid(...CURRENCIES)
  .default(
    process.env.DEFAULT_CURRENCY ||
      "UGX"
  );

const referenceSchema = Joi.string()
  .trim()
  .max(100)
  .optional();

const metadataSchema = Joi.object()
  .unknown(true)
  .default({});

/**
 * ============================================================================
 * BASE TRANSACTION
 * ============================================================================
 */

const baseTransactionSchema =
  Joi.object({
    amount: amountSchema,

    phoneNumber:
      phoneSchema,

    currency:
      currencySchema,

    reference:
      referenceSchema,

    memberId:
      Joi.string()
        .trim()
        .max(100)
        .optional(),

    accountId:
      Joi.string()
        .trim()
        .max(100)
        .optional(),

    loanId:
      Joi.string()
        .trim()
        .max(100)
        .optional(),

    metadata:
      metadataSchema,
  });

/**
 * ============================================================================
 * DEPOSIT
 * ============================================================================
 */

const depositSchema =
  baseTransactionSchema.keys({
    narration:
      Joi.string()
        .max(255)
        .optional(),
  });

/**
 * ============================================================================
 * WITHDRAW
 * ============================================================================
 */

const withdrawSchema =
  baseTransactionSchema.keys({
    withdrawalReason:
      Joi.string()
        .max(255)
        .optional(),
  });

/**
 * ============================================================================
 * SAVINGS CONTRIBUTION
 * ============================================================================
 */

const savingsContributionSchema =
  baseTransactionSchema.keys({
    savingsAccountId:
      Joi.string()
        .required(),
  });

/**
 * ============================================================================
 * LOAN REPAYMENT
 * ============================================================================
 */

const loanRepaymentSchema =
  baseTransactionSchema.keys({
    loanId:
      Joi.string()
        .required(),

    installmentNumber:
      Joi.number()
        .integer()
        .positive()
        .optional(),
  });

/**
 * ============================================================================
 * DISBURSEMENT
 * ============================================================================
 */

const disbursementSchema =
  baseTransactionSchema.keys({
    beneficiaryName:
      Joi.string()
        .max(255)
        .optional(),
  });

/**
 * ============================================================================
 * BULK DISBURSEMENT
 * ============================================================================
 */

const bulkDisbursementSchema =
  Joi.object({
    transactions:
      Joi.array()
        .items(
          disbursementSchema
        )
        .min(1)
        .max(1000)
        .required(),
  });

/**
 * ============================================================================
 * WEBHOOK
 * ============================================================================
 */

const webhookSchema =
  Joi.object({
    id:
      Joi.string()
        .optional(),

    eventId:
      Joi.string()
        .optional(),

    transactionId:
      Joi.string()
        .optional(),

    reference:
      Joi.string()
        .optional(),

    status:
      Joi.string()
        .required(),

    amount:
      Joi.alternatives()
        .try(
          Joi.number(),
          Joi.string()
        )
        .optional(),

    timestamp:
      Joi.date()
        .optional(),

    providerReference:
      Joi.string()
        .optional(),
  }).unknown(true);

/**
 * ============================================================================
 * STATUS QUERY
 * ============================================================================
 */

const statusSchema =
  Joi.object({
    reference:
      Joi.string()
        .required(),
  });

/**
 * ============================================================================
 * RECONCILIATION
 * ============================================================================
 */

const reconciliationSchema =
  Joi.object({
    date:
      Joi.date()
        .iso()
        .required(),
  });

/**
 * ============================================================================
 * UUID VALIDATION
 * ============================================================================
 */

const uuidSchema =
  Joi.string()
    .pattern(
      UUID_REGEX
    )
    .required();

/**
 * ============================================================================
 * GENERIC VALIDATOR
 * ============================================================================
 */

function validate(
  schema,
  source = "body"
) {
  return (
    req,
    res,
    next
  ) => {
    const payload =
      req[source];

    const {
      error,
      value,
    } = schema.validate(
      payload,
      {
        abortEarly:
          false,
        stripUnknown:
          true,
        convert: true,
      }
    );

    if (error) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Validation failed",
          errors:
            error.details.map(
              (item) => ({
                field:
                  item.path.join(
                    "."
                  ),
                message:
                  item.message,
              })
            ),
          timestamp:
            new Date().toISOString(),
        });
    }

    req[source] = value;

    return next();
  };
}

/**
 * ============================================================================
 * MIDDLEWARE EXPORTS
 * ============================================================================
 */

const validateDeposit =
  validate(
    depositSchema
  );

const validateWithdraw =
  validate(
    withdrawSchema
  );

const validateRepayLoan =
  validate(
    loanRepaymentSchema
  );

const validateSavingsContribution =
  validate(
    savingsContributionSchema
  );

const validateDisbursement =
  validate(
    disbursementSchema
  );

const validateBulkDisbursement =
  validate(
    bulkDisbursementSchema
  );

const validateWebhook =
  validate(
    webhookSchema
  );

const validateStatus =
  validate(
    statusSchema,
    "params"
  );

const validateReconciliation =
  validate(
    reconciliationSchema,
    "params"
  );

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = {
  validate,

  schemas: {
    depositSchema,
    withdrawSchema,
    savingsContributionSchema,
    loanRepaymentSchema,
    disbursementSchema,
    bulkDisbursementSchema,
    webhookSchema,
    statusSchema,
    reconciliationSchema,
    uuidSchema,
  },

  validateDeposit,
  validateWithdraw,
  validateRepayLoan,
  validateSavingsContribution,
  validateDisbursement,
  validateBulkDisbursement,
  validateWebhook,
  validateStatus,
  validateReconciliation,
};