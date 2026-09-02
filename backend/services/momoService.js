// ============================================================================
// File: backend/services/momoService.js
// Description: MTN MoMo Collection Service
// Production Grade Version
// ============================================================================

const crypto = require("crypto");
const axios = require("axios");

const logger = require("../utils/logger");
const httpClient = require("../utils/httpClient");

// ============================================================================
// Configuration
// ============================================================================

const MTN_BASE_URL =
  process.env.MTN_BASE_URL ||
  "https://sandbox.momodeveloper.mtn.com";

const MTN_ENV =
  process.env.MTN_ENV ||
  "sandbox";

const MTN_TOKEN =
  process.env.MTN_TOKEN;

const MTN_SUB_KEY =
  process.env.MTN_SUB_KEY;

const DEFAULT_CURRENCY =
  process.env.MTN_CURRENCY ||
  "UGX";

const REQUEST_TIMEOUT =
  Number(process.env.MTN_TIMEOUT_MS || 30000);

// ============================================================================
// Custom Errors
// ============================================================================

class MoMoServiceError extends Error {
  constructor(message, code, status = 500, metadata = {}) {
    super(message);

    this.name = "MoMoServiceError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateExternalId() {
  return crypto.randomUUID();
}

function generateReferenceId() {
  return crypto.randomUUID();
}

function sanitizePhone(phoneNumber) {
  if (!phoneNumber) return null;

  return String(phoneNumber)
    .replace(/\s+/g, "")
    .replace(/[^\d]/g, "");
}

function validateRequest({ amount, phoneNumber }) {
  if (!amount || Number(amount) <= 0) {
    throw new MoMoServiceError(
      "Invalid transaction amount",
      "INVALID_AMOUNT",
      400
    );
  }

  if (!phoneNumber) {
    throw new MoMoServiceError(
      "Phone number is required",
      "PHONE_REQUIRED",
      400
    );
  }
}

function buildHeaders(requestId) {
  return {
    Authorization: `Bearer ${MTN_TOKEN}`,
    "X-Request-Id": requestId,
    "X-Target-Environment": MTN_ENV,
    "Ocp-Apim-Subscription-Key": MTN_SUB_KEY,
    "Content-Type": "application/json"
  };
}

function normalizeAxiosError(error) {
  const response = error.response;

  if (!response) {
    return new MoMoServiceError(
      error.message,
      "NETWORK_ERROR",
      503
    );
  }

  return new MoMoServiceError(
    response.data?.message ||
      response.data?.error ||
      "MTN MoMo request failed",
    "MOMO_API_ERROR",
    response.status,
    {
      response: response.data
    }
  );
}

// ============================================================================
// Payment Initiation
// ============================================================================

/**
 * Initiate MTN MoMo Request-To-Pay
 *
 * @param {Object} params
 * @param {Number} params.amount
 * @param {String} params.phoneNumber
 * @param {String} params.requestId
 * @param {String} params.externalId
 *
 * @returns {Promise<Object>}
 */
async function initiatePayment({
  amount,
  phoneNumber,
  requestId,
  externalId
}) {
  validateRequest({
    amount,
    phoneNumber
  });

  const correlationId =
    requestId ||
    generateReferenceId();

  const transactionExternalId =
    externalId ||
    generateExternalId();

  const msisdn =
    sanitizePhone(phoneNumber);

  const payload = {
    amount: Number(amount).toFixed(0),
    currency: DEFAULT_CURRENCY,
    externalId: transactionExternalId,
    payer: {
      partyIdType: "MSISDN",
      partyId: msisdn
    },
    payerMessage: "Wallet deposit",
    payeeNote: "Community savings deposit"
  };

  try {
    logger.info("MTN MoMo payment initiation started", {
      requestId: correlationId,
      externalId: transactionExternalId,
      amount,
      phoneNumber: msisdn
    });

    const response = await httpClient.post(
      `${MTN_BASE_URL}/collection/v1_0/requesttopay`,
      payload,
      {
        timeout: REQUEST_TIMEOUT,
        requestId: correlationId,
        headers: buildHeaders(correlationId)
      }
    );

    logger.info("MTN MoMo payment initiation successful", {
      requestId: correlationId,
      externalId: transactionExternalId,
      status: response.status
    });

    return {
      success: true,
      requestId: correlationId,
      externalId: transactionExternalId,
      status: "PENDING",
      provider: "MTN_MOMO",
      providerStatusCode: response.status,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const normalizedError =
      normalizeAxiosError(error);

    logger.error("MTN MoMo payment initiation failed", {
      requestId: correlationId,
      externalId: transactionExternalId,
      error: normalizedError.message,
      code: normalizedError.code,
      metadata: normalizedError.metadata
    });

    throw normalizedError;
  }
}

// ============================================================================
// Transaction Status
// ============================================================================

/**
 * Check Request-To-Pay status
 *
 * @param {String} referenceId
 */
async function getTransactionStatus(referenceId) {
  try {
    const response = await httpClient.get(
      `${MTN_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          Authorization: `Bearer ${MTN_TOKEN}`,
          "X-Target-Environment": MTN_ENV,
          "Ocp-Apim-Subscription-Key": MTN_SUB_KEY
        }
      }
    );

    logger.info("MoMo transaction status fetched", {
      referenceId,
      status: response.data?.status
    });

    return {
      success: true,
      referenceId,
      data: response.data
    };
  } catch (error) {
    const normalizedError =
      normalizeAxiosError(error);

    logger.error("MoMo status lookup failed", {
      referenceId,
      error: normalizedError.message
    });

    throw normalizedError;
  }
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  try {
    return {
      provider: "MTN_MOMO",
      environment: MTN_ENV,
      status: "UP",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      provider: "MTN_MOMO",
      status: "DOWN",
      error: error.message
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  initiatePayment,
  getTransactionStatus,
  healthCheck,
  MoMoServiceError
};