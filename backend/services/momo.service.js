// services/momo.service.js
'use strict';
// Production-ready MTN MoMo Request-to-Pay integration (collection API)

const axios = require("axios");
const { randomUUID } = require('crypto');
const logger = require("../utils/logger"); // optional structured logger

const BASE_URL = process.env.MTN_MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com";
const TOKEN = process.env.MTN_TOKEN || "";
const TARGET_ENV = process.env.MTN_TARGET_ENV || "sandbox";
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "UGX";
const REQUEST_TIMEOUT = parseInt(process.env.MTN_REQUEST_TIMEOUT_MS || "10000", 10);
const MAX_RETRIES = parseInt(process.env.MTN_MAX_RETRIES || "3", 10);
const RETRY_DELAY_MS = parseInt(process.env.MTN_RETRY_DELAY_MS || "500", 10);


const momoServiceImpl = require('./momoServiceImpl'); // actual HTTP client to MoMo
const circuitFactory = require('../utils/circuitBreaker');
const logger = require('../utils/logger');

// Optional: fallback when MoMo is unavailable
const fallback = async (payload) => {
  logger.warn('MoMo fallback invoked', { reference: payload.reference, phone: payload.phone });
  // return a safe response shape so callers can decide what to do
  return { ok: false, reason: 'momo_unavailable', reference: payload.reference };
};

// Create a single breaker instance for requestToPay
const { fire: safeRequestToPay, breaker: momoBreaker } = circuitFactory(
  async (payload) => {
    // delegate to the real implementation that calls MoMo API
    return await momoServiceImpl.requestToPay(payload);
  },
  { timeout: 8000, errorThresholdPercentage: 60, resetTimeout: 30000 }, // optional overrides
  fallback
);

// Export the safe wrapper and the raw breaker if you need metrics
module.exports = {
  requestToPay: async (payload) => {
    // ensure phone default where applicable
    payload.phone = payload.phone || '256772123546';

    try {
      const result = await safeRequestToPay(payload);
      // result may be the real MoMo response or fallback response
      return result;
    } catch (err) {
      // circuit threw (no fallback or fallback also failed)
      logger.error('requestToPay failed', { error: err.message, reference: payload.reference });
      throw err;
    }
  },
  momoBreaker, // optional: expose for metrics/inspection
};


if (!TOKEN) {
  logger?.warn?.("MTN token is not set. Requests will likely fail until MTN_TOKEN is provided.");
}

const axiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: REQUEST_TIMEOUT,
  headers: {
    "Ocp-Apim-Subscription-Key": process.env.MTN_SUBSCRIPTION_KEY || "",
    "Content-Type": "application/json",
  },
});

/**
 * Helper: perform HTTP request with simple retry/backoff
 */
async function httpRequestWithRetry(config, retries = MAX_RETRIES) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      const resp = await axiosInstance.request(config);
      return resp;
    } catch (err) {
      lastError = err;
      attempt += 1;
      const status = err?.response?.status;
      // Do not retry on 4xx except 429
      if (status && status >= 400 && status < 500 && status !== 429) {
        break;
      }
      if (attempt > retries) break;
      const delay = RETRY_DELAY_MS * attempt;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastError;
}

/**
 * requestToPay
 *
 * Initiates a Request-to-Pay (collection) call to MTN MoMo.
 *
 * Params:
 *  - phone: MSISDN string (e.g., "25677XXXXXXX")
 *  - amount: numeric or string amount (positive)
 *  - reference: optional external reference; if not provided a UUID will be generated and used as X-Reference-Id
 *  - currency: optional ISO currency (defaults to UGX)
 *
 * Returns: MTN API response object
 *
 * Throws: Error with details on failure
 */
exports.requestToPay = async ({ phone, amount, reference, currency } = {}) => {
  if (!phone) throw new Error("phone is required");
  if (amount == null || Number(amount) <= 0) throw new Error("amount must be a positive number");

  const extRef = reference || randomUUID();
  const body = {
    amount: String(amount),
    currency: (currency || DEFAULT_CURRENCY).toUpperCase(),
    externalId: extRef,
    payer: {
      partyIdType: "MSISDN",
      partyId: phone,
    },
    payerMessage: `Payment request ${extRef}`,
    payeeNote: `Request for ${extRef}`,
  };

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "X-Reference-Id": extRef,
    "X-Target-Environment": TARGET_ENV,
    // Ocp-Apim-Subscription-Key is set on axiosInstance defaults if provided
  };

  try {
    const resp = await httpRequestWithRetry({
      method: "post",
      url: "/collection/v1_0/requesttopay",
      data: body,
      headers,
    });

    // MTN returns 202 Accepted with no body in some environments; return structured result
    const result = {
      status: resp.status,
      data: resp.data || null,
      externalId: extRef,
      headers: resp.headers,
    };

    logger?.info?.("MTN requestToPay initiated", { externalId: extRef, phone, amount });
    return result;
  } catch (err) {
    logger?.error?.("MTN requestToPay failed", {
      externalId: extRef,
      phone,
      amount,
      message: err?.message,
      status: err?.response?.status,
      body: err?.response?.data,
    });

    const error = new Error("Failed to initiate request-to-pay");
    error.details = {
      externalId: extRef,
      status: err?.response?.status,
      body: err?.response?.data,
      message: err?.message,
    };
    throw error;
  }
};

/**
 * getRequestToPayStatus
 *
 * Fetches the status of a previously initiated Request-to-Pay using X-Reference-Id.
 *
 * Params:
 *  - reference: X-Reference-Id used when initiating the request
 *
 * Returns: MTN API response object
 */
exports.getRequestToPayStatus = async ({ reference } = {}) => {
  if (!reference) throw new Error("reference is required");

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "X-Target-Environment": TARGET_ENV,
  };

  try {
    const resp = await httpRequestWithRetry({
      method: "get",
      url: `/collection/v1_0/requesttopay/${reference}`,
      headers,
    });

    logger?.info?.("MTN requestToPay status fetched", { reference, status: resp.status });
    return { status: resp.status, data: resp.data, headers: resp.headers };
  } catch (err) {
    logger?.error?.("Failed to fetch requestToPay status", {
      reference,
      message: err?.message,
      status: err?.response?.status,
      body: err?.response?.data,
    });

    const error = new Error("Failed to fetch request-to-pay status");
    error.details = {
      reference,
      status: err?.response?.status,
      body: err?.response?.data,
      message: err?.message,
    };
    throw error;
  }
};

/**
 * initiatePayout (optional)
 *
 * Initiates a payout (disbursement) to a customer's MSISDN using the disbursement API.
 * Note: Many providers require a separate API key/permission for disbursements.
 *
 * Params:
 *  - phone, amount, reference, currency
 */
exports.initiatePayout = async ({ phone, amount, reference, currency } = {}) => {
  if (!phone) throw new Error("phone is required");
  if (amount == null || Number(amount) <= 0) throw new Error("amount must be a positive number");

  const extRef = reference || randomUUID();
  const body = {
    amount: String(amount),
    currency: (currency || DEFAULT_CURRENCY).toUpperCase(),
    externalId: extRef,
    payee: {
      partyIdType: "MSISDN",
      partyId: phone,
    },
    payerMessage: `Payout ${extRef}`,
    payeeNote: `Payout ${extRef}`,
  };

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "X-Reference-Id": extRef,
    "X-Target-Environment": TARGET_ENV,
  };

  try {
    const resp = await httpRequestWithRetry({
      method: "post",
      url: "/disbursement/v1_0/transfer",
      data: body,
      headers,
    });

    logger?.info?.("MTN initiatePayout initiated", { externalId: extRef, phone, amount });
    return { status: resp.status, data: resp.data, externalId: extRef, headers: resp.headers };
  } catch (err) {
    logger?.error?.("MTN initiatePayout failed", {
      externalId: extRef,
      phone,
      amount,
      message: err?.message,
      status: err?.response?.status,
      body: err?.response?.data,
    });

    const error = new Error("Failed to initiate payout");
    error.details = {
      externalId: extRef,
      status: err?.response?.status,
      body: err?.response?.data,
      message: err?.message,
    };
    throw error;
  }
};
