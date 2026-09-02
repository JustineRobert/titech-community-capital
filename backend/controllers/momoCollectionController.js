// controllers/momoCollectionController.js
// ============================================================================
// MTN MOMO COLLECTION CONTROLLER
// ============================================================================
//
// TITech Community Capital
//
// Responsibilities
//  - Request To Pay (Collection)
//  - Deposit Initiation
//  - Transaction Persistence
//  - MTN MoMo API Integration
//  - Audit Metadata
//  - Correlation Tracking
//  - Reconciliation Support
//
// Production Grade
// ============================================================================

"use strict";

const axios = require("axios");
const crypto = require("crypto");

let logger;

try {
  logger = require("../utils/logger");
} catch {
  logger = console;
}

/* -------------------------------------------------------------------------- */
/*                              MODEL RESOLUTION                              */
/* -------------------------------------------------------------------------- */

let Transaction = null;

const candidateModels = [
  "../models/Transaction",
  "../models/transaction",
  "../models/FinancialTransaction",
  "../models/MobileMoneyTransaction",
];

for (const modelPath of candidateModels) {
  try {
    Transaction = require(modelPath);
    logger.info(
      `[MoMo Collection] Transaction model loaded: ${modelPath}`
    );
    break;
  } catch (_) {}
}

if (!Transaction) {
  logger.warn(
    "[MoMo Collection] No transaction model found. Running in degraded mode."
  );
}

/* -------------------------------------------------------------------------- */
/*                                 HELPERS                                    */
/* -------------------------------------------------------------------------- */

const generateReferenceId = () => crypto.randomUUID();

const getEnvironment = () =>
  process.env.MOMO_ENV ||
  process.env.MTN_ENV ||
  "sandbox";

const getCurrency = () =>
  process.env.MOMO_CURRENCY || "UGX";

const getBaseUrl = () =>
  (process.env.MOMO_BASE_URL || "").replace(/\/$/, "");

const buildHeaders = ({
  token,
  referenceId,
}) => ({
  Authorization: `Bearer ${token}`,
  "X-Reference-Id": referenceId,
  "X-Target-Environment": getEnvironment(),
  "Ocp-Apim-Subscription-Key":
    process.env.COLLECTION_KEY,
  "Content-Type": "application/json",
});

const createTransactionRecord = async ({
  referenceId,
  amount,
  phone,
  currency,
  payload,
}) => {
  if (!Transaction) {
    return null;
  }

  return Transaction.create({
    externalId: referenceId,
    referenceId,

    amount: Number(amount),

    currency,

    phone,

    provider: "MTN_MOMO",

    channel: "MOBILE_MONEY",

    transactionType: "DEPOSIT",

    flow: "CREDIT",

    status: "PENDING",

    metadata: {
      requestPayload: payload,
      source: "requestToPay",
    },
  });
};

const markTransactionFailed = async (
  referenceId,
  error
) => {
  try {
    if (!Transaction) {
      return;
    }

    await Transaction.updateOne(
      {
        $or: [
          { externalId: referenceId },
          { referenceId },
        ],
      },
      {
        $set: {
          status: "FAILED",
          failureReason:
            error?.message ||
            "Unknown Error",

          "metadata.providerError":
            error?.response?.data ||
            error?.message,

          updatedAt: new Date(),
        },
      }
    );
  } catch (updateError) {
    logger.error(
      "[MoMo Collection] Failed to update transaction",
      {
        error: updateError.message,
      }
    );
  }
};

/* -------------------------------------------------------------------------- */
/*                           REQUEST TO PAY                                   */
/* -------------------------------------------------------------------------- */

exports.requestToPay = async (
  req,
  res,
  next
) => {
  let referenceId;

  try {
    const {
      amount,
      phone,
      payerMessage,
      payeeNote,
    } = req.body;

    /* ---------------------------------------------------------------------- */
    /* VALIDATION                                                             */
    /* ---------------------------------------------------------------------- */

    if (!amount) {
      return res.status(400).json({
        success: false,
        message: "Amount is required",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Amount must be greater than zero",
      });
    }

    /* ---------------------------------------------------------------------- */
    /* TOKEN                                                                   */
    /* ---------------------------------------------------------------------- */

    const token =
      req.token ||
      process.env.MOMO_BEARER_TOKEN;

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "MoMo access token not available",
      });
    }

    /* ---------------------------------------------------------------------- */
    /* REFERENCE ID                                                            */
    /* ---------------------------------------------------------------------- */

    referenceId = generateReferenceId();

    /* ---------------------------------------------------------------------- */
    /* PAYLOAD                                                                 */
    /* ---------------------------------------------------------------------- */

    const payload = {
      amount: String(amount),

      currency: getCurrency(),

      externalId: referenceId,

      payer: {
        partyIdType: "MSISDN",
        partyId: String(phone),
      },

      payerMessage:
        payerMessage ||
        "TITech Community Capital Deposit",

      payeeNote:
        payeeNote ||
        "Community Savings Deposit",
    };

    /* ---------------------------------------------------------------------- */
    /* PERSIST TRANSACTION                                                     */
    /* ---------------------------------------------------------------------- */

    const transaction =
      await createTransactionRecord({
        referenceId,
        amount,
        phone,
        currency: payload.currency,
        payload,
      });

    /* ---------------------------------------------------------------------- */
    /* API REQUEST                                                             */
    /* ---------------------------------------------------------------------- */

    const url =
      `${getBaseUrl()}` +
      "/collection/v1_0/requesttopay";

    const headers = buildHeaders({
      token,
      referenceId,
    });

    logger.info(
      "[MoMo Collection] Initiating RequestToPay",
      {
        referenceId,
        amount,
        phone,
      }
    );

    await axios.post(
      url,
      payload,
      {
        headers,
        timeout: 20000,
      }
    );

    logger.info(
      "[MoMo Collection] RequestToPay Accepted",
      {
        referenceId,
      }
    );

    return res.status(202).json({
      success: true,

      referenceId,

      transactionId:
        transaction?._id || null,

      status: "PENDING",

      message:
        "Request To Pay initiated successfully",
    });
  } catch (error) {
    logger.error(
      "[MoMo Collection] RequestToPay Failed",
      {
        referenceId,
        error: error.message,
        providerError:
          error?.response?.data,
      }
    );

    if (referenceId) {
      await markTransactionFailed(
        referenceId,
        error
      );
    }

    return res.status(
      error?.response?.status || 500
    ).json({
      success: false,

      message:
        "Failed to initiate Request To Pay",

      referenceId,

      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,

      providerError:
        process.env.NODE_ENV ===
        "development"
          ? error?.response?.data
          : undefined,
    });
  }
};