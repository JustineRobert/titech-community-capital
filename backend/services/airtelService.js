// ============================================================================
// File: backend/services/airtelService.js
// Description: Airtel Money Collection Service
// Production Grade Version
// ============================================================================

const crypto = require("crypto");

const httpClient = require("../utils/httpClient");
const logger = require("../utils/logger");

// ============================================================================
// Configuration
// ============================================================================

const AIRTEL_BASE_URL =
  process.env.AIRTEL_BASE_URL ||
  "https://openapiuat.airtel.africa";

const AIRTEL_CLIENT_ID =
  process.env.AIRTEL_CLIENT_ID;

const AIRTEL_CLIENT_SECRET =
  process.env.AIRTEL_CLIENT_SECRET;

const AIRTEL_COUNTRY =
  process.env.AIRTEL_COUNTRY ||
  "UG";

const AIRTEL_CURRENCY =
  process.env.AIRTEL_CURRENCY ||
  "UGX";

const REQUEST_TIMEOUT =
  Number(process.env.AIRTEL_TIMEOUT_MS || 30000);

// ============================================================================
// Custom Error
// ============================================================================

class AirtelServiceError extends Error {
  constructor(message, code, status = 500, metadata = {}) {
    super(message);

    this.name = "AirtelServiceError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateReferenceId() {
  return crypto.randomUUID();
}

function generateTransactionId() {
  return crypto.randomUUID();
}

function sanitizePhone(phoneNumber) {
  if (!phoneNumber) return null;

  return String(phoneNumber)
    .replace(/\s+/g, "")
    .replace(/[^\d]/g, "");
}

function validatePaymentRequest({ amount, phoneNumber }) {
  if (!amount || Number(amount) <= 0) {
    throw new AirtelServiceError(
      "Invalid transaction amount",
      "INVALID_AMOUNT",
      400
    );
  }

  if (!phoneNumber) {
    throw new AirtelServiceError(
      "Phone number is required",
      "PHONE_REQUIRED",
      400
    );
  }
}

function normalizeError(error) {
  if (!error.response) {
    return new AirtelServiceError(
      error.message,
      "NETWORK_ERROR",
      503
    );
  }

  return new AirtelServiceError(
    error.response.data?.message ||
      error.response.data?.error ||
      "Airtel API request failed",
    "AIRTEL_API_ERROR",
    error.response.status,
    {
      response: error.response.data
    }
  );
}

// ============================================================================
// OAuth Token
// ============================================================================

let tokenCache = {
  accessToken: null,
  expiresAt: null
};

async function getAccessToken() {
  try {
    const now = Date.now();

    if (
      tokenCache.accessToken &&
      tokenCache.expiresAt &&
      tokenCache.expiresAt > now
    ) {
      return tokenCache.accessToken;
    }

    logger.info("Requesting Airtel OAuth token");

    const response = await httpClient.post(
      `${AIRTEL_BASE_URL}/auth/oauth2/token`,
      {
        client_id: AIRTEL_CLIENT_ID,
        client_secret: AIRTEL_CLIENT_SECRET,
        grant_type: "client_credentials"
      },
      {
        timeout: REQUEST_TIMEOUT
      }
    );

    const accessToken =
      response.data?.access_token;

    const expiresIn =
      Number(response.data?.expires_in || 3600);

    tokenCache = {
      accessToken,
      expiresAt:
        Date.now() + (expiresIn - 60) * 1000
    };

    logger.info("Airtel OAuth token acquired");

    return accessToken;
  } catch (error) {
    const normalizedError =
      normalizeError(error);

    logger.error("Airtel OAuth failed", {
      error: normalizedError.message
    });

    throw normalizedError;
  }
}

// ============================================================================
// Collection Request
// ============================================================================

async function initiatePayment({
  amount,
  phoneNumber,
  requestId,
  externalId
}) {
  validatePaymentRequest({
    amount,
    phoneNumber
  });

  const correlationId =
    requestId ||
    generateReferenceId();

  const transactionId =
    externalId ||
    generateTransactionId();

  try {
    const accessToken =
      await getAccessToken();

    const msisdn =
      sanitizePhone(phoneNumber);

    const payload = {
      reference: transactionId,
      subscriber: {
        country: AIRTEL_COUNTRY,
        currency: AIRTEL_CURRENCY,
        msisdn
      },
      transaction: {
        amount: Number(amount).toFixed(0),
        country: AIRTEL_COUNTRY,
        currency: AIRTEL_CURRENCY,
        id: transactionId
      }
    };

    logger.info(
      "Airtel collection request started",
      {
        requestId: correlationId,
        transactionId,
        amount,
        msisdn
      }
    );

    const response = await httpClient.post(
      `${AIRTEL_BASE_URL}/merchant/v1/payments/`,
      payload,
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Country": AIRTEL_COUNTRY,
          "X-Correlation-ID": correlationId,
          "Content-Type":
            "application/json"
        }
      }
    );

    logger.info(
      "Airtel collection request accepted",
      {
        requestId: correlationId,
        transactionId
      }
    );

    return {
      success: true,
      provider: "AIRTEL_MONEY",
      requestId: correlationId,
      transactionId,
      status: "PENDING",
      providerResponse: response.data,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const normalizedError =
      normalizeError(error);

    logger.error(
      "Airtel collection request failed",
      {
        requestId: correlationId,
        transactionId,
        error: normalizedError.message
      }
    );

    throw normalizedError;
  }
}

// ============================================================================
// Transaction Status
// ============================================================================

async function getTransactionStatus(
  transactionId
) {
  try {
    const accessToken =
      await getAccessToken();

    const response =
      await httpClient.get(
        `${AIRTEL_BASE_URL}/standard/v1/payments/${transactionId}`,
        {
          timeout: REQUEST_TIMEOUT,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Country":
              AIRTEL_COUNTRY
          }
        }
      );

    logger.info(
      "Airtel transaction status fetched",
      {
        transactionId
      }
    );

    return {
      success: true,
      transactionId,
      data: response.data
    };
  } catch (error) {
    const normalizedError =
      normalizeError(error);

    logger.error(
      "Airtel status lookup failed",
      {
        transactionId,
        error: normalizedError.message
      }
    );

    throw normalizedError;
  }
}

// ============================================================================
// Refund
// ============================================================================

async function initiateRefund({
  amount,
  transactionId,
  requestId
}) {
  const correlationId =
    requestId ||
    generateReferenceId();

  try {
    const accessToken =
      await getAccessToken();

    const payload = {
      amount: Number(amount).toFixed(0),
      transactionId
    };

    const response =
      await httpClient.post(
        `${AIRTEL_BASE_URL}/standard/v1/refund`,
        payload,
        {
          timeout: REQUEST_TIMEOUT,
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
            "X-Country":
              AIRTEL_COUNTRY,
            "X-Correlation-ID":
              correlationId
          }
        }
      );

    logger.info(
      "Airtel refund initiated",
      {
        requestId: correlationId,
        transactionId,
        amount
      }
    );

    return response.data;
  } catch (error) {
    const normalizedError =
      normalizeError(error);

    logger.error(
      "Airtel refund failed",
      {
        requestId: correlationId,
        transactionId,
        error: normalizedError.message
      }
    );

    throw normalizedError;
  }
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    provider: "AIRTEL_MONEY",
    country: AIRTEL_COUNTRY,
    status: "UP",
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// Token Management
// ============================================================================

function clearTokenCache() {
  tokenCache = {
    accessToken: null,
    expiresAt: null
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  initiatePayment,
  getTransactionStatus,
  initiateRefund,
  getAccessToken,
  clearTokenCache,
  healthCheck,
  AirtelServiceError
};

