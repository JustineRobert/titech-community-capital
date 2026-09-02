/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN Mobile Money Service
 * =============================================================================
 *
 * File:
 *   backend/services/momo.service.js
 *
 * Purpose:
 *   Production-oriented MTN MoMo integration facade.
 *
 * Responsibilities:
 *   - Request-to-Pay / Collections
 *   - Request-to-Pay status lookup
 *   - Disbursement / payout
 *   - Input validation
 *   - Safe money normalization
 *   - UUID v4 references
 *   - HTTP timeout/retry handling
 *   - Circuit-breaker protection
 *   - Structured errors
 *   - Safe logging
 *
 * Architecture:
 *
 *   Controller / Transaction Service
 *              ↓
 *        momo.service.js
 *              ↓
 *        HTTP transport
 *              ↓
 *        MTN MoMo API
 *
 * IMPORTANT:
 *   This service does NOT mark a financial transaction as successful merely
 *   because MTN accepted a request. MTN Request-to-Pay and Transfer APIs are
 *   asynchronous. The financial transaction must transition to a pending state
 *   and later be reconciled through callback and/or status polling.
 *
 * =============================================================================
 */

'use strict';

const axios = require('axios');
const { randomUUID } = require('crypto');

const logger = require('../utils/logger');

let circuitFactory = null;

try {
  // Optional resilience dependency.
  // The service still works without it.
  // eslint-disable-next-line global-require
  circuitFactory = require('../utils/circuitBreaker');
} catch {
  circuitFactory = null;
}

// =============================================================================
// ENVIRONMENT / CONFIGURATION
// =============================================================================

function envString(name, fallback = '') {
  const value = process.env[name];

  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {
    return fallback;
  }

  return String(value).trim();
}

function envInteger(
  name,
  fallback,
  min,
  max,
) {
  const raw = envString(name, '');

  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    logger.warn(
      'Invalid MoMo numeric configuration; using fallback',
      {
        name,
        fallback,
      },
    );

    return fallback;
  }

  return value;
}

const CONFIG = Object.freeze({
  BASE_URL: envString(
    'MTN_MOMO_BASE_URL',
    'https://sandbox.momodeveloper.mtn.com',
  ),

  TARGET_ENV:
    envString(
      'MTN_TARGET_ENV',
      'sandbox',
    ).toLowerCase(),

  SUBSCRIPTION_KEY:
    envString(
      'MTN_SUBSCRIPTION_KEY',
    ),

  TOKEN:
    envString(
      'MTN_TOKEN',
    ),

  API_USER:
    envString(
      'MTN_API_USER',
    ),

  API_KEY:
    envString(
      'MTN_API_KEY',
    ),

  DEFAULT_CURRENCY:
    envString(
      'DEFAULT_CURRENCY',
      'UGX',
    ).toUpperCase(),

  REQUEST_TIMEOUT_MS:
    envInteger(
      'MTN_REQUEST_TIMEOUT_MS',
      10_000,
      1_000,
      120_000,
    ),

  MAX_RETRIES:
    envInteger(
      'MTN_MAX_RETRIES',
      3,
      0,
      10,
    ),

  RETRY_DELAY_MS:
    envInteger(
      'MTN_RETRY_DELAY_MS',
      500,
      50,
      30_000,
    ),

  CIRCUIT_TIMEOUT_MS:
    envInteger(
      'MTN_CIRCUIT_TIMEOUT_MS',
      8_000,
      1_000,
      120_000,
    ),

  CIRCUIT_ERROR_THRESHOLD:
    envInteger(
      'MTN_CIRCUIT_ERROR_THRESHOLD',
      60,
      1,
      100,
    ),

  CIRCUIT_RESET_TIMEOUT_MS:
    envInteger(
      'MTN_CIRCUIT_RESET_TIMEOUT_MS',
      30_000,
      1_000,
      600_000,
    ),
});

// =============================================================================
// HTTP CLIENT
// =============================================================================

const axiosInstance = axios.create({
  baseURL: CONFIG.BASE_URL,
  timeout: CONFIG.REQUEST_TIMEOUT_MS,

  headers: {
    'Content-Type': 'application/json',

    ...(CONFIG.SUBSCRIPTION_KEY
      ? {
          'Ocp-Apim-Subscription-Key':
            CONFIG.SUBSCRIPTION_KEY,
        }
      : {}),
  },

  validateStatus: () => true,
});

// =============================================================================
// STARTUP VALIDATION
// =============================================================================

function validateConfiguration() {
  if (!CONFIG.SUBSCRIPTION_KEY) {
    logger.warn(
      'MTN MoMo subscription key is not configured',
    );
  }

  if (!CONFIG.TOKEN) {
    logger.warn(
      'MTN MoMo bearer token is not configured',
    );
  }

  if (
    CONFIG.TARGET_ENV !== 'sandbox' &&
    CONFIG.TARGET_ENV !== 'production'
  ) {
    logger.warn(
      'Unexpected MTN target environment',
      {
        targetEnv:
          CONFIG.TARGET_ENV,
      },
    );
  }

  if (
    CONFIG.TARGET_ENV === 'production' &&
    !CONFIG.BASE_URL.startsWith('https://')
  ) {
    logger.error(
      'MTN production environment must use HTTPS',
    );
  }
}

validateConfiguration();

// =============================================================================
// MONEY VALIDATION
// =============================================================================
//
// Avoid Number arithmetic for financial values.
//

function normalizeAmount(amount) {
  if (
    amount === undefined ||
    amount === null ||
    amount === ''
  ) {
    throw createValidationError(
      'amount is required',
    );
  }

  const value = String(amount).trim();

  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw createValidationError(
      'amount must be a positive numeric value',
    );
  }

  const numeric =
    Number(value);

  if (
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    throw createValidationError(
      'amount must be greater than zero',
    );
  }

  return value;
}

// =============================================================================
// PHONE VALIDATION
// =============================================================================
//
// MTN's Request-to-Pay examples use MSISDN party IDs.
// Keep formatting strict enough to prevent accidental malformed requests.
//

function normalizePhone(phone) {
  const value =
    String(phone || '').trim();

  if (!value) {
    throw createValidationError(
      'phone is required',
    );
  }

  // Accept international numeric MSISDN format.
  if (!/^\d{8,15}$/.test(value)) {
    throw createValidationError(
      'phone must be a valid MSISDN',
    );
  }

  return value;
}

// =============================================================================
// REFERENCE VALIDATION
// =============================================================================

function normalizeReference(
  reference,
) {
  if (
    reference === undefined ||
    reference === null ||
    reference === ''
  ) {
    return randomUUID();
  }

  const value =
    String(reference).trim();

  if (value.length > 100) {
    throw createValidationError(
      'reference must not exceed 100 characters',
    );
  }

  return value;
}

// =============================================================================
// CURRENCY VALIDATION
// =============================================================================

function normalizeCurrency(currency) {
  const value =
    String(
      currency ||
        CONFIG.DEFAULT_CURRENCY,
    )
      .trim()
      .toUpperCase();

  if (!/^[A-Z]{3}$/.test(value)) {
    throw createValidationError(
      'currency must be a valid 3-letter ISO currency code',
    );
  }

  return value;
}

// =============================================================================
// COMMON VALIDATION ERROR
// =============================================================================

function createValidationError(
  message,
) {
  const error =
    new Error(message);

  error.code =
    'MOMO_VALIDATION_ERROR';

  error.statusCode =
    400;

  error.retryable =
    false;

  return error;
}

// =============================================================================
// RETRY POLICY
// =============================================================================

function isRetryableStatus(status) {
  if (!status) {
    return true;
  }

  // Never retry normal client errors.
  if (
    status >= 400 &&
    status < 500
  ) {
    // 429 Too Many Requests is retryable.
    return status === 429;
  }

  // 5xx provider/server failures are retryable.
  return status >= 500;
}

function retryDelay(attempt) {
  const exponential =
    CONFIG.RETRY_DELAY_MS *
    Math.pow(2, attempt - 1);

  // Small jitter avoids synchronized retry bursts.
  const jitter =
    Math.floor(
      Math.random() * 100,
    );

  return exponential + jitter;
}

async function sleep(ms) {
  await new Promise(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

// =============================================================================
// HTTP REQUEST
// =============================================================================

async function httpRequest(
  requestConfig,
  retries = CONFIG.MAX_RETRIES,
) {
  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    try {
      const response =
        await axiosInstance.request(
          requestConfig,
        );

      if (
        response.status >= 200 &&
        response.status < 300
      ) {
        return response;
      }

      const providerError =
        new Error(
          `MTN API returned HTTP ${response.status}`,
        );

      providerError.response =
        response;

      providerError.status =
        response.status;

      providerError.retryable =
        isRetryableStatus(
          response.status,
        );

      if (
        !providerError.retryable ||
        attempt >= retries
      ) {
        throw providerError;
      }

      lastError =
        providerError;
    } catch (error) {
      lastError = error;

      const status =
        error?.response?.status ||
        error?.status;

      const retryable =
        error?.retryable ??
        (!status ||
          isRetryableStatus(
            status,
          ));

      attempt += 1;

      if (
        attempt > retries ||
        !retryable
      ) {
        break;
      }

      await sleep(
        retryDelay(attempt),
      );

      continue;
    }

    attempt += 1;

    if (
      attempt <= retries
    ) {
      await sleep(
        retryDelay(attempt),
      );
    }
  }

  throw normalizeProviderError(
    lastError,
  );
}

// =============================================================================
// ERROR NORMALIZATION
// =============================================================================

function normalizeProviderError(
  error,
) {
  if (
    error?.code ===
    'MOMO_VALIDATION_ERROR'
  ) {
    return error;
  }

  const providerStatus =
    error?.response?.status ??
    error?.status;

  const providerBody =
    error?.response?.data ??
    null;

  const normalized =
    new Error(
      'MTN MoMo request failed',
    );

  normalized.code =
    'MOMO_PROVIDER_ERROR';

  normalized.statusCode =
    providerStatus || 502;

  normalized.retryable =
    Boolean(
      error?.retryable,
    );

  normalized.details = {
    status:
      providerStatus,
    body:
      providerBody,
    message:
      error?.message,
  };

  return normalized;
}

// =============================================================================
// HEADERS
// =============================================================================

function buildHeaders(
  reference,
) {
  if (!CONFIG.TOKEN) {
    const error =
      new Error(
        'MTN_TOKEN is not configured',
      );

    error.code =
      'MOMO_AUTH_NOT_CONFIGURED';

    error.statusCode =
      503;

    error.retryable =
      false;

    throw error;
  }

  if (!CONFIG.SUBSCRIPTION_KEY) {
    const error =
      new Error(
        'MTN_SUBSCRIPTION_KEY is not configured',
      );

    error.code =
      'MOMO_SUBSCRIPTION_NOT_CONFIGURED';

    error.statusCode =
      503;

    error.retryable =
      false;

    throw error;
  }

  return {
    Authorization:
      `Bearer ${CONFIG.TOKEN}`,

    'X-Target-Environment':
      CONFIG.TARGET_ENV,

    'X-Reference-Id':
      reference,

    'Ocp-Apim-Subscription-Key':
      CONFIG.SUBSCRIPTION_KEY,

    'Content-Type':
      'application/json',
  };
}

// =============================================================================
// REQUEST-TO-PAY CORE IMPLEMENTATION
// =============================================================================

async function requestToPayCore({
  phone,
  amount,
  reference,
  currency,
  payerMessage,
  payeeNote,
  transferType,
}) {
  const normalizedPhone =
    normalizePhone(phone);

  const normalizedAmount =
    normalizeAmount(amount);

  const externalId =
    normalizeReference(reference);

  const normalizedCurrency =
    normalizeCurrency(currency);

  const body = {
    amount:
      normalizedAmount,

    currency:
      normalizedCurrency,

    externalId,

    payer: {
      partyIdType:
        'MSISDN',

      partyId:
        normalizedPhone,
    },

    payerMessage:
      String(
        payerMessage ||
          `Payment request ${externalId}`,
      ).substring(0, 160),

    payeeNote:
      String(
        payeeNote ||
          `Request for ${externalId}`,
      ).substring(0, 160),
  };

  // Aggregator configurations require transferType.
  if (transferType) {
    body.transferType =
      String(
        transferType,
      ).trim();
  }

  const response =
    await httpRequest({
      method: 'POST',

      url:
        '/collection/v1_0/requesttopay',

      data:
        body,

      headers:
        buildHeaders(externalId),
    });

  logger.info(
    'MTN Request-to-Pay initiated',
    {
      externalId,
      amount:
        normalizedAmount,
      currency:
        normalizedCurrency,
      status:
        response.status,
    },
  );

  return {
    accepted:
      response.status === 202,

    status:
      response.status,

    externalId,

    data:
      response.data ??
      null,

    headers:
      response.headers,
  };
}

// =============================================================================
// REQUEST-TO-PAY CIRCUIT BREAKER
// =============================================================================

const fallbackRequestToPay =
  async (payload) => {
    const reference =
      payload?.reference ||
      payload?.externalId ||
      undefined;

    logger.warn(
      'MTN Request-to-Pay circuit fallback triggered',
      {
        externalId:
          reference,
      },
    );

    return {
      accepted:
        false,

      status:
        503,

      externalId:
        reference,

      data:
        null,

      degraded:
        true,

      reason:
        'MOMO_PROVIDER_UNAVAILABLE',
    };
  };

let protectedRequestToPay =
  requestToPayCore;

let momoBreaker =
  null;

if (
  typeof circuitFactory ===
  'function'
) {
  try {
    const result =
      circuitFactory(
        requestToPayCore,
        {
          timeout:
            CONFIG.CIRCUIT_TIMEOUT_MS,

          errorThresholdPercentage:
            CONFIG.CIRCUIT_ERROR_THRESHOLD,

          resetTimeout:
            CONFIG.CIRCUIT_RESET_TIMEOUT_MS,
        },

        fallbackRequestToPay,
      );

    protectedRequestToPay =
      result.fire ||
      requestToPayCore;

    momoBreaker =
      result.breaker ||
      null;
  } catch (error) {
    logger.warn(
      'MoMo circuit breaker initialization failed; continuing without breaker',
      {
        error:
          error.message,
      },
    );
  }
}

// =============================================================================
// PUBLIC: REQUEST-TO-PAY
// =============================================================================

async function requestToPay(
  payload = {},
) {
  try {
    return await protectedRequestToPay(
      payload,
    );
  } catch (error) {
    const normalized =
      normalizeProviderError(
        error,
      );

    logger.error(
      'MTN Request-to-Pay failed',
      {
        externalId:
          payload?.reference,

        amount:
          payload?.amount,

        status:
          normalized.statusCode,

        code:
          normalized.code,

        message:
          normalized.message,
      },
    );

    throw normalized;
  }
}

// =============================================================================
// PUBLIC: REQUEST-TO-PAY STATUS
// =============================================================================

async function getRequestToPayStatus({
  reference,
} = {}) {
  const normalizedReference =
    normalizeReference(reference);

  try {
    const response =
      await httpRequest({
        method:
          'GET',

        url:
          `/collection/v1_0/requesttopay/${encodeURIComponent(
            normalizedReference,
          )}`,

        headers:
          buildHeaders(
            normalizedReference,
          ),
      });

    logger.info(
      'MTN Request-to-Pay status fetched',
      {
        reference:
          normalizedReference,

        status:
          response.status,
      },
    );

    return {
      status:
        response.status,

      reference:
        normalizedReference,

      data:
        response.data ??
        null,

      headers:
        response.headers,
    };
  } catch (error) {
    const normalized =
      normalizeProviderError(
        error,
      );

    logger.error(
      'Failed to fetch MTN Request-to-Pay status',
      {
        reference:
          normalizedReference,

        status:
          normalized.statusCode,

        code:
          normalized.code,

        message:
          normalized.message,
      },
    );

    throw normalized;
  }
}

// =============================================================================
// DISBURSEMENT CORE
// =============================================================================

async function initiatePayoutCore({
  phone,
  amount,
  reference,
  currency,
  payerMessage,
  payeeNote,
  transferType,
}) {
  const normalizedPhone =
    normalizePhone(phone);

  const normalizedAmount =
    normalizeAmount(amount);

  const externalId =
    normalizeReference(reference);

  const normalizedCurrency =
    normalizeCurrency(currency);

  const body = {
    amount:
      normalizedAmount,

    currency:
      normalizedCurrency,

    externalId,

    payee: {
      partyIdType:
        'MSISDN',

      partyId:
        normalizedPhone,
    },

    payerMessage:
      String(
        payerMessage ||
          `Payout ${externalId}`,
      ).substring(0, 160),

    payeeNote:
      String(
        payeeNote ||
          `Payout ${externalId}`,
      ).substring(0, 160),
  };

  if (transferType) {
    body.transferType =
      String(
        transferType,
      ).trim();
  }

  const response =
    await httpRequest({
      method:
        'POST',

      url:
        '/disbursement/v1_0/transfer',

      data:
        body,

      headers:
        buildHeaders(
          externalId,
        ),
    });

  logger.info(
    'MTN disbursement initiated',
    {
      externalId,

      amount:
        normalizedAmount,

      currency:
        normalizedCurrency,

      status:
        response.status,
    },
  );

  return {
    accepted:
      response.status === 202,

    status:
      response.status,

    externalId,

    data:
      response.data ??
      null,

    headers:
      response.headers,
  };
}

// =============================================================================
// PUBLIC: PAYOUT
// =============================================================================

async function initiatePayout(
  payload = {},
) {
  try {
    return await initiatePayoutCore(
      payload,
    );
  } catch (error) {
    const normalized =
      normalizeProviderError(
        error,
      );

    logger.error(
      'MTN disbursement failed',
      {
        externalId:
          payload?.reference,

        amount:
          payload?.amount,

        status:
          normalized.statusCode,

        code:
          normalized.code,

        message:
          normalized.message,
      },
    );

    throw normalized;
  }
}

// =============================================================================
// OPTIONAL: GENERIC HEALTH CHECK
// =============================================================================

async function healthCheck() {
  return {
    configured:
      Boolean(
        CONFIG.SUBSCRIPTION_KEY &&
        CONFIG.TOKEN,
      ),

    targetEnvironment:
      CONFIG.TARGET_ENV,

    baseUrl:
      CONFIG.BASE_URL,

    circuitBreaker:
      Boolean(momoBreaker),

    timestamp:
      new Date(),
  };
}

// =============================================================================
// CONFIG SNAPSHOT
// =============================================================================
//
// Never return TOKEN/API keys/subscription keys.
//

function getConfigSnapshot() {
  return {
    baseUrl:
      CONFIG.BASE_URL,

    targetEnvironment:
      CONFIG.TARGET_ENV,

    defaultCurrency:
      CONFIG.DEFAULT_CURRENCY,

    requestTimeoutMs:
      CONFIG.REQUEST_TIMEOUT_MS,

    maxRetries:
      CONFIG.MAX_RETRIES,

    retryDelayMs:
      CONFIG.RETRY_DELAY_MS,

    credentialsConfigured: {
      token:
        Boolean(CONFIG.TOKEN),

      subscriptionKey:
        Boolean(
          CONFIG.SUBSCRIPTION_KEY,
        ),

      apiUser:
        Boolean(CONFIG.API_USER),

      apiKey:
        Boolean(CONFIG.API_KEY),
    },

    circuitBreakerConfigured:
      Boolean(momoBreaker),
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  requestToPay,

  getRequestToPayStatus,

  initiatePayout,

  healthCheck,

  getConfigSnapshot,

  momoBreaker,
};