// backend/controllers/mtnController.js
/**
 * ============================================================================
 * MTN MOMO CONTROLLER
 * ============================================================================
 *
 * Endpoints
 *
 * POST /deposit
 * POST /withdraw
 * POST /repay-loan
 * POST /contribute-savings
 * POST /disburse
 * POST /bulk-disburse
 * POST /webhook
 *
 * GET /status/:reference
 * GET /reconciliation/:date
 *
 * ============================================================================
 */

const collectionsService = require("../services/mtn/collections");
const disbursementService = require("../services/mtn/disbursements");
const webhookService = require("../services/mtn/webhooks");
const reconciliationService = require("../services/mtn/reconciliation");

let logger;

try {
  logger = require("../modules/logger");
} catch {
  logger = console;
}

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

const success = (res, data, message = "Success", status = 200) => {
  return res.status(status).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

const failure = (
  res,
  error,
  status = 500
) => {
  return res.status(status).json({
    success: false,
    message:
      error.message ||
      "Internal Server Error",
    timestamp: new Date().toISOString(),
  });
};

const validateAmount = (
  amount
) => {
  return (
    Number(amount) > 0 &&
    !Number.isNaN(Number(amount))
  );
};

const validatePhoneNumber = (
  phoneNumber
) => {
  return !!phoneNumber;
};

/**
 * ============================================================================
 * POST /deposit
 * ============================================================================
 */

exports.deposit = async (
  req,
  res
) => {
  try {
    const {
      amount,
      phoneNumber,
    } = req.body;

    if (
      !validateAmount(amount)
    ) {
      return failure(
        res,
        new Error(
          "Valid amount is required"
        ),
        400
      );
    }

    if (
      !validatePhoneNumber(
        phoneNumber
      )
    ) {
      return failure(
        res,
        new Error(
          "Phone number is required"
        ),
        400
      );
    }

    const result =
      await collectionsService.deposit(
        req.body
      );

    return success(
      res,
      result,
      "Deposit initiated",
      201
    );
  } catch (error) {
    logger.error(
      "Deposit failed",
      error
    );

    return failure(res, error);
  }
};

/**
 * ============================================================================
 * POST /withdraw
 * ============================================================================
 */

exports.withdraw = async (
  req,
  res
) => {
  try {
    const result =
      await disbursementService.withdraw(
        req.body
      );

    return success(
      res,
      result,
      "Withdrawal initiated",
      201
    );
  } catch (error) {
    return failure(res, error);
  }
};

/**
 * ============================================================================
 * POST /repay-loan
 * ============================================================================
 */

exports.repayLoan =
  async (req, res) => {
    try {
      const result =
        await collectionsService.repayLoan(
          req.body
        );

      return success(
        res,
        result,
        "Loan repayment initiated",
        201
      );
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  };

/**
 * ============================================================================
 * POST /contribute-savings
 * ============================================================================
 */

exports.contributeSavings =
  async (req, res) => {
    try {
      const result =
        await collectionsService.contributeSavings(
          req.body
        );

      return success(
        res,
        result,
        "Savings contribution initiated",
        201
      );
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  };

/**
 * ============================================================================
 * POST /disburse
 * ============================================================================
 */

exports.disburse = async (
  req,
  res
) => {
  try {
    const result =
      await disbursementService.disburseLoan(
        req.body
      );

    return success(
      res,
      result,
      "Disbursement initiated",
      201
    );
  } catch (error) {
    return failure(res, error);
  }
};

/**
 * ============================================================================
 * POST /bulk-disburse
 * ============================================================================
 */

exports.bulkDisburse =
  async (req, res) => {
    try {
      const {
        transactions,
      } = req.body;

      if (
        !Array.isArray(
          transactions
        )
      ) {
        return failure(
          res,
          new Error(
            "transactions array required"
          ),
          400
        );
      }

      const result =
        await disbursementService.bulkTransfer(
          transactions
        );

      return success(
        res,
        result,
        "Bulk disbursement submitted"
      );
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  };

/**
 * ============================================================================
 * POST /webhook
 * ============================================================================
 */

exports.webhook = async (
  req,
  res
) => {
  try {
    const result =
      await webhookService.processWebhook(
        {
          payload:
            req.body,
          rawBody:
            req.rawBody ||
            JSON.stringify(
              req.body
            ),
          signature:
            req.headers[
              "x-signature"
            ] ||
            req.headers[
              "x-mtn-signature"
            ],
          sourceIP:
            req.ip,
        }
      );

    return res
      .status(200)
      .json({
        success: true,
        acknowledged: true,
        result,
      });
  } catch (error) {
    logger.error(
      "Webhook processing failed",
      error
    );

    return res
      .status(400)
      .json({
        success: false,
        message:
          error.message,
      });
  }
};

/**
 * ============================================================================
 * GET /status/:reference
 * ============================================================================
 */

exports.getStatus =
  async (req, res) => {
    try {
      const {
        reference,
      } = req.params;

      const result =
        await collectionsService.getStatus(
          reference
        );

      return success(
        res,
        result
      );
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  };

/**
 * ============================================================================
 * GET /reconciliation/:date
 * ============================================================================
 */

exports.getReconciliation =
  async (req, res) => {
    try {
      const {
        date,
      } = req.params;

      const report =
        await reconciliationService.reconcileDaily(
          {
            date,
          }
        );

      return success(
        res,
        report
      );
    } catch (error) {
      return failure(
        res,
        error
      );
    }
  };

/**
 * ============================================================================
 * GET /health
 * ============================================================================
 */

exports.health = async (
  req,
  res
) => {
  try {
    const [
      collections,
      disbursements,
      webhooks,
    ] =
      await Promise.all([
        collectionsService.healthCheck(),
        disbursementService.healthCheck(),
        webhookService.healthCheck(),
      ]);

    return success(
      res,
      {
        collections,
        disbursements,
        webhooks,
      },
      "MTN services healthy"
    );
  } catch (error) {
    return failure(res, error);
  }
};

/**
 * ============================================================================
 * GET /metrics
 * ============================================================================
 */

exports.metrics = async (
  req,
  res
) => {
  try {
    return success(
      res,
      {
        collections:
          collectionsService.getMetrics(),
        disbursements:
          disbursementService.getMetrics(),
        webhooks:
          webhookService.healthCheck(),
      },
      "Metrics retrieved"
    );
  } catch (error) {
    return failure(res, error);
  }
};

module.exports = exports;