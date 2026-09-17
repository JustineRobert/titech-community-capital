'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Retry Intelligence Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/retryIntelligence.js
 *
 * Purpose:
 *   Enterprise-grade, payment-safe retry decision intelligence for the Airtel
 *   payment domain. The engine classifies provider/application outcomes, applies
 *   bounded retry policy, calculates deterministic backoff guidance, preserves
 *   tenant-scoped idempotency identity, and distinguishes safely retryable
 *   failures from ambiguous financial outcomes that require status lookup,
 *   reconciliation or human review.
 *
 * Architectural Position:
 *
 *   Payment Request / Provider Outcome
 *                |
 *                v
 *        Retry Intelligence Engine
 *          /        |         \
 *         /         |          \
 *        v          v           v
 *     Error      Provider     Prediction /
 *     Class      Resilience    Learning / Compliance
 *        |          |           |
 *        +----------+-----------+
 *                   |
 *                   v
 *          Retry / Status-Check /
 *             Review Decision
 *                   |
 *                   v
 *          Payment Orchestrator
 *                   |
 *                   v
 *             Airtel Adapter
 *                   |
 *                   v
 *             Financial Core
 *             Transaction/Ledger
 *
 * RESPONSIBILITIES
 * ----------------
 * - Normalize retry context, outcome and policy inputs.
 * - Classify failures into retryable, terminal, ambiguous and review states.
 * - Apply operation-aware and outcome-aware retry gates.
 * - Honour retry-after signals, deadline budgets, attempt limits and backoff.
 * - Preserve the original payment idempotency identity across retry attempts.
 * - Prevent retry of already-successful/settled financial operations.
 * - Distinguish transport uncertainty from confirmed provider failure.
 * - Recommend STATUS_CHECK / RECONCILE instead of blind repetition for ambiguous
 *   financial outcomes.
 * - Consume provider health, circuit, prediction, learning, reconciliation and
 *   regulatory signals without making them authoritative by themselves.
 * - Produce deterministic, explainable retry plans and decision fingerprints.
 * - Support optional execution delegation through an injected orchestrator adapter
 *   without performing provider calls or financial mutations in this module.
 * - Expose observability through dependency injection.
 *
 * NON-RESPONSIBILITIES / IMPORTANT BOUNDARIES
 * --------------------------------------------
 * - Does NOT call Airtel APIs directly.
 * - Does NOT create, settle, reverse, refund or otherwise mutate financial
 *   transactions.
 * - Does NOT write ledger entries or mutate balances.
 * - Does NOT silently generate a new financial idempotency key for a retry.
 * - Does NOT treat an intelligence recommendation as proof of provider success.
 * - Does NOT override a circuit breaker owned by the canonical resilience layer.
 * - Does NOT override regulatory/compliance BLOCK decisions.
 * - Does NOT resolve reconciliation conflicts itself.
 * - Does NOT persist retry state internally; the authoritative orchestrator/worker
 *   owns attempt persistence and atomic claiming.
 * - Does NOT retry a request merely because its error is technically retryable when
 *   payment outcome is financially ambiguous.
 *
 * FINANCIAL SAFETY PRINCIPLES
 * ---------------------------
 * 1. A retry plan is orchestration guidance, not settlement authority.
 * 2. The original idempotency key is immutable for payment retries.
 * 3. Financial success always wins over a later transport error.
 * 4. Ambiguous payment outcome => status check / reconciliation, not blind repost.
 * 5. Confirmed terminal provider outcomes are not retried unless an explicit,
 *    governed business operation allows it.
 * 6. A closed circuit is necessary but never sufficient for retry eligibility.
 * 7. Retry budgets are bounded by attempts, elapsed time, deadline and policy.
 * 8. Tenant isolation is mandatory.
 *
 * MODULE FORMAT
 * -------------
 * TITech backend targets ESM semantics. This file uses native ESM exports and
 * Node built-ins only; no new runtime dependency is required.
 *
 * =============================================================================
 */

import { createHash } from 'node:crypto';

// =============================================================================
// Engine identity
// =============================================================================

export const ENGINE_NAME = 'airtel-retry-intelligence';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;

// =============================================================================
// Enumerations / policy constants
// =============================================================================

export const PROVIDER = 'AIRTEL';

export const OPERATIONS = Object.freeze([
  'COLLECTION',
  'DISBURSEMENT',
  'REFUND',
  'REVERSAL',
  'STATUS',
]);

export const DECISIONS = Object.freeze([
  'RETRY',
  'STATUS_CHECK',
  'RECONCILE',
  'REVIEW',
  'STOP',
  'NO_RETRY',
]);

export const OUTCOME_STATES = Object.freeze([
  'SUCCESS',
  'FAILURE',
  'AMBIGUOUS',
  'PENDING',
  'UNKNOWN',
]);

export const ERROR_CLASSES = Object.freeze([
  'NETWORK_TRANSIENT',
  'TIMEOUT_TRANSIENT',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_SERVER_ERROR',
  'CONCURRENCY_CONFLICT',
  'AUTHENTICATION_FAILURE',
  'AUTHORIZATION_FAILURE',
  'VALIDATION_FAILURE',
  'BUSINESS_FAILURE',
  'NOT_FOUND',
  'DUPLICATE_OR_IDEMPOTENCY_CONFLICT',
  'COMPLIANCE_BLOCK',
  'FINANCIAL_CONFLICT',
  'UNKNOWN',
]);

export const RETRY_MODES = Object.freeze([
  'IMMEDIATE',
  'EXPONENTIAL',
  'EXPONENTIAL_FULL_JITTER',
  'EXPONENTIAL_EQUAL_JITTER',
  'RETRY_AFTER',
]);

export const CIRCUIT_STATES = Object.freeze([
  'CLOSED',
  'HALF_OPEN',
  'OPEN',
  'UNKNOWN',
]);

export const HEALTH_STATES = Object.freeze([
  'UP',
  'HEALTHY',
  'DEGRADED',
  'DOWN',
  'UNKNOWN',
]);

export const IDEMPOTENCY_POLICIES = Object.freeze([
  'PRESERVE_ORIGINAL',
  'REQUIRE_EXISTING',
  'STATUS_CHECK_ONLY_WHEN_AMBIGUOUS',
]);

export const EXECUTION_MODES = Object.freeze([
  'RECOMMENDATION_ONLY',
  'ORCHESTRATOR_DELEGATED',
]);

export const SEVERITIES = Object.freeze([
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 5,
  maxElapsedMs: 120_000,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0.20,
  mode: RETRY_MODES.EXPONENTIAL_FULL_JITTER,
  retryAfterCapMs: 60_000,
  initialAttemptNumber: 0,
  maxStatusChecks: 3,
  statusCheckDelayMs: 1_000,
  allowStatusCheckOnAmbiguous: true,
  allowRetryOnConfirmedFailure: true,
  allowFinancialPostRetryWithoutFreshStatus: false,
  retry429: true,
  retry5xx: true,
  retry408: true,
  retry425: true,
  retryNetworkErrors: true,
  retryTimeoutErrors: true,
  retryConnectionReset: true,
  retryDnsErrors: true,
  retryConcurrencyConflicts: false,
  requireOriginalIdempotencyKey: true,
  requireTenantId: true,
  failClosedOnPolicyError: true,
  staleProviderHealthMs: 60_000,
  staleRecommendationMs: 60_000,
  staleLearningMs: 300_000,
  retryBudgetJitterFloorRatio: 0.50,
  maxContextMetadataKeys: 50,
});

const DEFAULT_OPTIONS = Object.freeze({
  providerScope: PROVIDER,
  requireTenantId: true,
  defaultPolicy: DEFAULT_POLICY,
  timeoutMs: 2_000,
});

const HTTP_RETRYABLE = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

const HTTP_TERMINAL = new Set([
  400,
  401,
  403,
  404,
  405,
  406,
  410,
  411,
  413,
  415,
  422,
]);

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTDOWN',
  'EHOSTUNREACH',
]);

const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ERR_REQUEST_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'TITTECH_PROVIDER_TIMEOUT',
  'TITTECH_PROVIDER_REQUEST_TIMEOUT',
]);

const DNS_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'EAI_FAIL',
]);

const AUTH_CODES = new Set([
  'AUTHENTICATION_FAILED',
  'AUTH_FAILED',
  'INVALID_CREDENTIALS',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'AIRTEL_AUTH_FAILED',
  'AIRTEL_TOKEN_INVALID',
]);

const AUTHZ_CODES = new Set([
  'FORBIDDEN',
  'ACCESS_DENIED',
  'AUTHORIZATION_FAILED',
  'AIRTEL_PERMISSION_DENIED',
]);

const VALIDATION_CODES = new Set([
  'VALIDATION_ERROR',
  'INVALID_REQUEST',
  'INVALID_AMOUNT',
  'INVALID_CURRENCY',
  'MISSING_REQUIRED_FIELD',
  'MALFORMED_REQUEST',
  'SCHEMA_VALIDATION_FAILED',
]);

const BUSINESS_FAILURE_CODES = new Set([
  'INSUFFICIENT_FUNDS',
  'ACCOUNT_BLOCKED',
  'INVALID_MSISDN',
  'CUSTOMER_NOT_FOUND',
  'TRANSACTION_DECLINED',
  'DECLINED',
  'REJECTED',
  'LIMIT_EXCEEDED',
  'EXPIRED',
  'MERCHANT_NOT_ACTIVE',
]);

const DUPLICATE_CODES = new Set([
  'DUPLICATE',
  'DUPLICATE_TRANSACTION',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'ALREADY_PROCESSED',
  'CONFLICTING_IDEMPOTENCY_KEY',
]);

const FINANCIAL_CONFLICT_CODES = new Set([
  'LEDGER_CONFLICT',
  'FINANCIAL_CORE_CONFLICT',
  'FINANCIAL_CORE_POSTING_FAILED',
  'BALANCE_CONFLICT',
  'SETTLEMENT_CONFLICT',
  'LEDGER_ALREADY_POSTED',
  'TRANSACTION_ALREADY_SETTLED',
]);

const COMPLIANCE_CODES = new Set([
  'AML_BLOCK',
  'SANCTIONS_BLOCK',
  'KYC_REQUIRED',
  'COMPLIANCE_BLOCK',
  'REGULATORY_BLOCK',
]);

const SUCCESS_STATUSES = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'COMPLETED',
  'SETTLED',
  'PAID',
  'REVERSED',
  'REFUNDED',
]);

const TERMINAL_PROVIDER_FAILURE_STATUSES = new Set([
  'FAILED',
  'FAILURE',
  'DECLINED',
  'REJECTED',
  'CANCELLED',
  'CANCELED',
  'EXPIRED',
]);

const AMBIGUOUS_STATUSES = new Set([
  'UNKNOWN',
  'TIMEOUT',
  'NO_RESPONSE',
  'PENDING_UNKNOWN',
]);

const PENDING_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'INITIATED',
  'SUBMITTED',
  'QUEUED',
]);

// =============================================================================
// Error class
// =============================================================================

export class AirtelRetryIntelligenceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AirtelRetryIntelligenceError';
    this.code = options.code || 'AIRTEL_RETRY_INTELLIGENCE_ERROR';
    this.statusCode = options.statusCode || 500;
    this.details = Object.freeze({ ...(options.details || {}) });
    this.cause = options.cause || null;

    Error.captureStackTrace?.(this, AirtelRetryIntelligenceError);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepClone(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const output = [];
    seen.set(value, output);
    for (const item of value) output.push(deepClone(item, seen));
    return output;
  }

  if (!isPlainObject(value)) return String(value);

  const output = {};
  seen.set(value, output);
  for (const [key, item] of Object.entries(value)) {
    output[key] = deepClone(item, seen);
  }
  return output;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function integer(value, fallback = null) {
  const numeric = finiteNumber(value, fallback);
  return numeric === null ? null : Math.trunc(numeric);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeString(value, field, maxLength = 256, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  if (!normalized) return fallback;

  if (normalized.length > maxLength) {
    throw new AirtelRetryIntelligenceError(
      `${field} exceeds the maximum allowed length.`,
      {
        code: 'RETRY_FIELD_TOO_LONG',
        statusCode: 422,
        details: { field, maxLength },
      },
    );
  }

  return normalized;
}

function upper(value, field, fallback = null, maxLength = 128) {
  const normalized = normalizeString(value, field, maxLength, fallback);
  return normalized ? normalized.toUpperCase() : fallback;
}

function normalizeDate(value, field = 'date') {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AirtelRetryIntelligenceError(
      `${field} must be a valid date.`,
      {
        code: 'RETRY_DATE_INVALID',
        statusCode: 422,
        details: { field },
      },
    );
  }
  return date;
}

function nowDate(clock) {
  try {
    const value = typeof clock === 'function' ? clock() : Date.now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

function normalizeEnum(value, field, allowed, fallback) {
  const normalized = upper(value, field, fallback);
  if (!normalized) return fallback;
  if (!allowed.includes(normalized)) {
    throw new AirtelRetryIntelligenceError(
      `${field} has an unsupported value.`,
      {
        code: 'RETRY_ENUM_INVALID',
        statusCode: 422,
        details: {
          field,
          value: normalized,
          allowed,
        },
      },
    );
  }
  return normalized;
}

function stableNormalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableNormalize(value[key]);
        return result;
      }, {});
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

function stableSerialize(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  return createHash('sha256')
    .update(stableSerialize(value))
    .digest('hex');
}

function safeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || null,
    message: String(error.message || 'Unknown error').slice(0, 400),
    statusCode: integer(error.statusCode, null),
  };
}

function normalizeHeaders(headers = {}) {
  if (!isPlainObject(headers)) return {};
  const output = {};
  const allow = new Set([
    'retry-after',
    'x-rate-limit-reset',
    'x-ratelimit-reset',
    'x-request-id',
    'x-correlation-id',
  ]);

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (!allow.has(normalizedKey)) continue;
    if (value === null || value === undefined) continue;
    output[normalizedKey] = String(value).slice(0, 256);
  }

  return output;
}

function parseRetryAfter(value, now = new Date(), capMs = 60_000) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return clamp(Math.trunc(numeric * 1000), 0, capMs);
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;

  return clamp(date.getTime() - now.getTime(), 0, capMs);
}

function sanitizeMetadata(metadata, maxKeys = 50) {
  if (!isPlainObject(metadata)) return {};
  const blocked = new Set([
    'password',
    'passwd',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'authorization',
    'cookie',
    'pin',
    'otp',
    'cvv',
    'cvc',
    'pan',
    'cardNumber',
    'rawProviderResponse',
    'requestBody',
    'responseBody',
  ]);

  const output = {};
  let count = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (count >= maxKeys) break;
    if (blocked.has(key)) continue;
    if (key.length > 128) continue;
    output[key] = deepClone(value);
    count += 1;
  }

  return output;
}

function normalizeActor(actor) {
  if (!isPlainObject(actor)) return null;
  const actorId = normalizeString(
    actor.actorId ?? actor.userId ?? actor.id,
    'actor.actorId',
    256,
    null,
  );
  if (!actorId) return null;
  return {
    actorId,
    actorType: upper(actor.actorType, 'actor.actorType', 'SYSTEM', 80),
    tenantId: normalizeString(actor.tenantId, 'actor.tenantId', 128, null),
  };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function providerHealthScore(status) {
  switch (upper(status, 'healthStatus', 'UNKNOWN')) {
    case 'UP':
    case 'HEALTHY':
      return 1;
    case 'DEGRADED':
      return 0.55;
    case 'DOWN':
      return 0;
    default:
      return 0.4;
  }
}

function circuitAllowsRetry(state) {
  return ['CLOSED', 'HALF_OPEN'].includes(
    upper(state, 'circuitState', 'UNKNOWN'),
  );
}

function normalizeStatus(value) {
  return upper(value, 'status', 'UNKNOWN', 80);
}

function inferAttemptNumber(context) {
  return clamp(
    integer(
      context.attemptNumber ?? context.retryAttempt ?? context.attempt,
      0,
    ),
    0,
    100,
  );
}

function isFinancialOperation(operation) {
  return ['COLLECTION', 'DISBURSEMENT', 'REFUND', 'REVERSAL'].includes(operation);
}

function isStatusOperation(operation) {
  return operation === 'STATUS';
}

function isTerminalFinancialState(context) {
  const localStatus = normalizeStatus(
    context.paymentStatus ?? context.localStatus,
  );

  const providerStatus = normalizeStatus(
    context.providerStatus,
  );

  const financialStatus = normalizeStatus(
    context.financialStatus,
  );

  return (
    SUCCESS_STATUSES.has(localStatus) ||
    SUCCESS_STATUSES.has(financialStatus) ||
    SUCCESS_STATUSES.has(providerStatus)
  );
}

function errorText(error = {}) {
  return [
    error.code,
    error.errorCode,
    error.error,
    error.name,
    error.message,
    error.response?.data?.code,
    error.response?.data?.errorCode,
    error.response?.data?.message,
  ]
    .filter(Boolean)
    .map(value => String(value).trim().toUpperCase())
    .join(' ');
}

function httpStatus(error = {}) {
  return integer(
    error.statusCode ??
      error.status ??
      error.httpStatus ??
      error.response?.status ??
      error.response?.statusCode,
    null,
  );
}

function classifyError(error = {}) {
  const status = httpStatus(error);
  const code = String(
    error.code ?? error.errorCode ?? error.response?.data?.code ?? '',
  ).trim().toUpperCase();
  const text = errorText(error);

  if (COMPLIANCE_CODES.has(code) || /AML|SANCTIONS|REGULATORY|KYC.*REQUIRED/.test(text)) {
    return {
      errorClass: 'COMPLIANCE_BLOCK',
      retryable: false,
      ambiguous: false,
      severity: 'CRITICAL',
      reason: 'Compliance or regulatory controls indicate that retry must not proceed.',
    };
  }

  if (FINANCIAL_CONFLICT_CODES.has(code) || /FINANCIAL CORE|LEDGER.*CONFLICT|ALREADY SETTLED/.test(text)) {
    return {
      errorClass: 'FINANCIAL_CONFLICT',
      retryable: false,
      ambiguous: true,
      severity: 'CRITICAL',
      reason: 'Financial state may already have changed or may be inconsistent; reconciliation is required.',
    };
  }

  if (DUPLICATE_CODES.has(code) || /IDEMPOTENCY|DUPLICATE TRANSACTION|ALREADY PROCESSED/.test(text)) {
    return {
      errorClass: 'DUPLICATE_OR_IDEMPOTENCY_CONFLICT',
      retryable: false,
      ambiguous: true,
      severity: 'HIGH',
      reason: 'The provider indicates duplicate or idempotency conflict; do not issue a fresh financial request.',
    };
  }

  if (AUTH_CODES.has(code) || status === 401) {
    return {
      errorClass: 'AUTHENTICATION_FAILURE',
      retryable: false,
      ambiguous: false,
      severity: 'HIGH',
      reason: 'Provider authentication must be repaired before another request can safely be sent.',
    };
  }

  if (AUTHZ_CODES.has(code) || status === 403) {
    return {
      errorClass: 'AUTHORIZATION_FAILURE',
      retryable: false,
      ambiguous: false,
      severity: 'HIGH',
      reason: 'Provider authorization does not permit the operation.',
    };
  }

  if (VALIDATION_CODES.has(code) || status === 400 || status === 422) {
    return {
      errorClass: 'VALIDATION_FAILURE',
      retryable: false,
      ambiguous: false,
      severity: 'MEDIUM',
      reason: 'The request is invalid and should be corrected rather than retried unchanged.',
    };
  }

  if (status === 404) {
    return {
      errorClass: 'NOT_FOUND',
      retryable: false,
      ambiguous: false,
      severity: 'MEDIUM',
      reason: 'The provider resource was not found.',
    };
  }

  if (BUSINESS_FAILURE_CODES.has(code) || /INSUFFICIENT FUNDS|DECLINED|REJECTED|LIMIT EXCEEDED/.test(text)) {
    return {
      errorClass: 'BUSINESS_FAILURE',
      retryable: false,
      ambiguous: false,
      severity: 'MEDIUM',
      reason: 'The provider returned a business-level terminal failure.',
    };
  }

  if (NETWORK_CODES.has(code)) {
    return {
      errorClass: 'NETWORK_TRANSIENT',
      retryable: true,
      ambiguous: true,
      severity: 'HIGH',
      reason: 'The network outcome is uncertain; a financial operation requires status verification before replay.',
    };
  }

  if (DNS_CODES.has(code)) {
    return {
      errorClass: 'NETWORK_TRANSIENT',
      retryable: true,
      ambiguous: true,
      severity: 'HIGH',
      reason: 'DNS resolution failed transiently and the provider outcome is unknown.',
    };
  }

  if (TIMEOUT_CODES.has(code) || /TIMEOUT|TIMED OUT/.test(text)) {
    return {
      errorClass: 'TIMEOUT_TRANSIENT',
      retryable: true,
      ambiguous: true,
      severity: 'HIGH',
      reason: 'The provider response timed out and payment outcome may be unknown.',
    };
  }

  if (status === 429) {
    return {
      errorClass: 'RATE_LIMITED',
      retryable: true,
      ambiguous: false,
      severity: 'MEDIUM',
      reason: 'The provider rate limit was reached; retry only after the configured retry window.',
    };
  }

  if (status === 408 || status === 425) {
    return {
      errorClass: 'TIMEOUT_TRANSIENT',
      retryable: true,
      ambiguous: isFinancialOperation('COLLECTION'),
      severity: 'HIGH',
      reason: 'The provider returned a transient HTTP outcome.',
    };
  }

  if (status && status >= 500 && status <= 599) {
    return {
      errorClass: 'PROVIDER_SERVER_ERROR',
      retryable: true,
      ambiguous: true,
      severity: 'HIGH',
      reason: 'The provider returned a transient server-side failure and outcome may be uncertain.',
    };
  }

  if (status && HTTP_TERMINAL.has(status)) {
    return {
      errorClass: 'BUSINESS_FAILURE',
      retryable: false,
      ambiguous: false,
      severity: 'MEDIUM',
      reason: 'The HTTP response indicates a terminal request/provider error.',
    };
  }

  return {
    errorClass: 'UNKNOWN',
    retryable: false,
    ambiguous: true,
    severity: 'HIGH',
    reason: 'The error could not be confidently classified; fail closed to review or reconciliation.',
  };
}

function inferOutcomeFromContext(context) {
  const providerStatus = normalizeStatus(context.providerStatus);
  const localStatus = normalizeStatus(context.paymentStatus ?? context.localStatus);
  const financialStatus = normalizeStatus(context.financialStatus);

  if (
    SUCCESS_STATUSES.has(providerStatus) ||
    SUCCESS_STATUSES.has(localStatus) ||
    SUCCESS_STATUSES.has(financialStatus)
  ) {
    return 'SUCCESS';
  }

  if (
    AMBIGUOUS_STATUSES.has(providerStatus) ||
    context.outcomeKnown === false ||
    context.responseReceived === false ||
    context.responseTimedOut === true
  ) {
    return 'AMBIGUOUS';
  }

  if (PENDING_STATUSES.has(providerStatus)) {
    return 'PENDING';
  }

  if (TERMINAL_PROVIDER_FAILURE_STATUSES.has(providerStatus)) {
    return 'FAILURE';
  }

  return normalizeEnum(
    context.outcome,
    'outcome',
    OUTCOME_STATES,
    'UNKNOWN',
  );
}

function idempotencyKeyFromContext(context) {
  return normalizeString(
    context.idempotencyKey ??
      context.paymentIdempotencyKey ??
      context.originalIdempotencyKey,
    'idempotencyKey',
    255,
    null,
  );
}

function paymentIdentityFromContext(context) {
  return normalizeString(
    context.paymentId ??
      context.transactionId ??
      context.payment?.id ??
      context.payment?._id,
    'paymentId',
    256,
    null,
  );
}

function extractRetryAfterMs(context, now, capMs) {
  const headers = normalizeHeaders(
    context.headers ?? context.error?.response?.headers ?? context.error?.headers,
  );

  const retryAfter =
    context.retryAfter ??
    headers['retry-after'] ??
    null;

  return parseRetryAfter(
    retryAfter,
    now,
    capMs,
  );
}

function deterministicJitter(
  seed,
  amplitude,
  randomOverride = null,
) {
  if (amplitude <= 0) return 0;

  if (typeof randomOverride === 'function') {
    const value = finiteNumber(randomOverride(), 0.5);
    return (clamp(value, 0, 1) * 2 - 1) * amplitude;
  }

  const digest = sha256(seed);
  const slice = Number.parseInt(digest.slice(0, 8), 16);
  const normalized = slice / 0xffffffff;
  return (normalized * 2 - 1) * amplitude;
}

function calculateExponentialDelay(
  attemptNumber,
  policy,
  seed,
  randomOverride = null,
) {
  const exponent = Math.max(0, attemptNumber);
  const raw = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * (2 ** exponent),
  );

  if (policy.mode === 'IMMEDIATE') return 0;

  if (policy.mode === 'RETRY_AFTER') return raw;

  if (policy.mode === 'EXPONENTIAL_EQUAL_JITTER') {
    const half = raw / 2;
    const jitter = deterministicJitter(
      seed,
      half * policy.jitterRatio,
      randomOverride,
    );
    return clamp(
      Math.round(half + jitter),
      0,
      policy.maxDelayMs,
    );
  }

  if (policy.mode === 'EXPONENTIAL_FULL_JITTER') {
    const jitterFloor = raw * policy.retryBudgetJitterFloorRatio;
    const upper = Math.max(jitterFloor, raw);
    const deterministic = deterministicJitter(
      seed,
      upper * policy.jitterRatio,
      randomOverride,
    );
    return clamp(
      Math.round((upper / 2) + deterministic),
      0,
      policy.maxDelayMs,
    );
  }

  const jitter = deterministicJitter(
    seed,
    raw * policy.jitterRatio,
    randomOverride,
  );

  return clamp(
    Math.round(raw + jitter),
    0,
    policy.maxDelayMs,
  );
}

function normalizePolicy(policy = {}) {
  const input = isPlainObject(policy) ? policy : {};
  const merged = {
    ...DEFAULT_POLICY,
    ...input,
  };

  const normalized = {
    maxAttempts: clamp(integer(merged.maxAttempts, DEFAULT_POLICY.maxAttempts), 0, 100),
    maxElapsedMs: clamp(integer(merged.maxElapsedMs, DEFAULT_POLICY.maxElapsedMs), 1_000, 86_400_000),
    baseDelayMs: clamp(integer(merged.baseDelayMs, DEFAULT_POLICY.baseDelayMs), 0, 300_000),
    maxDelayMs: clamp(integer(merged.maxDelayMs, DEFAULT_POLICY.maxDelayMs), 0, 900_000),
    jitterRatio: clamp(finiteNumber(merged.jitterRatio, DEFAULT_POLICY.jitterRatio), 0, 1),
    mode: normalizeEnum(merged.mode, 'policy.mode', RETRY_MODES, DEFAULT_POLICY.mode),
    retryAfterCapMs: clamp(integer(merged.retryAfterCapMs, DEFAULT_POLICY.retryAfterCapMs), 0, 900_000),
    initialAttemptNumber: clamp(integer(merged.initialAttemptNumber, DEFAULT_POLICY.initialAttemptNumber), 0, 100),
    maxStatusChecks: clamp(integer(merged.maxStatusChecks, DEFAULT_POLICY.maxStatusChecks), 0, 20),
    statusCheckDelayMs: clamp(integer(merged.statusCheckDelayMs, DEFAULT_POLICY.statusCheckDelayMs), 0, 300_000),
    allowStatusCheckOnAmbiguous: merged.allowStatusCheckOnAmbiguous !== false,
    allowRetryOnConfirmedFailure: merged.allowRetryOnConfirmedFailure !== false,
    allowFinancialPostRetryWithoutFreshStatus: merged.allowFinancialPostRetryWithoutFreshStatus === true,
    retry429: merged.retry429 !== false,
    retry5xx: merged.retry5xx !== false,
    retry408: merged.retry408 !== false,
    retry425: merged.retry425 !== false,
    retryNetworkErrors: merged.retryNetworkErrors !== false,
    retryTimeoutErrors: merged.retryTimeoutErrors !== false,
    retryConnectionReset: merged.retryConnectionReset !== false,
    retryDnsErrors: merged.retryDnsErrors !== false,
    retryConcurrencyConflicts: merged.retryConcurrencyConflicts === true,
    requireOriginalIdempotencyKey: merged.requireOriginalIdempotencyKey !== false,
    requireTenantId: merged.requireTenantId !== false,
    failClosedOnPolicyError: merged.failClosedOnPolicyError !== false,
    staleProviderHealthMs: clamp(integer(merged.staleProviderHealthMs, DEFAULT_POLICY.staleProviderHealthMs), 1_000, 3_600_000),
    staleRecommendationMs: clamp(integer(merged.staleRecommendationMs, DEFAULT_POLICY.staleRecommendationMs), 1_000, 3_600_000),
    staleLearningMs: clamp(integer(merged.staleLearningMs, DEFAULT_POLICY.staleLearningMs), 1_000, 86_400_000),
    retryBudgetJitterFloorRatio: clamp(finiteNumber(merged.retryBudgetJitterFloorRatio, DEFAULT_POLICY.retryBudgetJitterFloorRatio), 0, 1),
    maxContextMetadataKeys: clamp(integer(merged.maxContextMetadataKeys, DEFAULT_POLICY.maxContextMetadataKeys), 1, 250),
  };

  if (normalized.maxDelayMs < normalized.baseDelayMs) {
    normalized.maxDelayMs = normalized.baseDelayMs;
  }

  return deepFreeze(normalized);
}

function normalizeProviderSignals(signals = {}) {
  const input = isPlainObject(signals) ? signals : {};
  return {
    healthStatus: upper(input.healthStatus, 'healthStatus', 'UNKNOWN', 80),
    circuitState: upper(input.circuitState, 'circuitState', 'UNKNOWN', 80),
    successRate: clamp(finiteNumber(input.successRate, 0.5), 0, 1),
    latencyMs: Math.max(0, finiteNumber(input.latencyMs, 0) ?? 0),
    sampleSize: Math.max(0, integer(input.sampleSize, 0) ?? 0),
    updatedAt: normalizeDate(input.updatedAt, 'providerSignals.updatedAt'),
    retryable: input.retryable === true,
    available: input.available !== false,
  };
}

function normalizeLearningSignal(signal = {}) {
  if (!isPlainObject(signal)) return null;
  return {
    retryScore: clamp(finiteNumber(signal.retryScore ?? signal.score, 0.5), 0, 1),
    ambiguousOutcomeRate: clamp(finiteNumber(signal.ambiguousOutcomeRate, 0), 0, 1),
    sampleSize: Math.max(0, integer(signal.sampleSize, 0) ?? 0),
    updatedAt: normalizeDate(signal.updatedAt, 'learning.updatedAt'),
    confidence: clamp(finiteNumber(signal.confidence, 0.5), 0, 1),
  };
}

function normalizePredictionSignal(signal = {}) {
  if (!isPlainObject(signal)) return null;
  return {
    retryProbability: clamp(
      finiteNumber(
        signal.retryProbability ?? signal.probability ?? signal.score,
        0.5,
      ),
      0,
      1,
    ),
    successProbabilityAfterRetry: clamp(
      finiteNumber(signal.successProbabilityAfterRetry, 0.5),
      0,
      1,
    ),
    ambiguityProbability: clamp(
      finiteNumber(signal.ambiguityProbability, 0.5),
      0,
      1,
    ),
    confidence: clamp(finiteNumber(signal.confidence, 0.5), 0, 1),
    updatedAt: normalizeDate(signal.updatedAt, 'prediction.updatedAt'),
  };
}

function normalizeReconciliationSignal(signal = {}) {
  if (!isPlainObject(signal)) return null;
  return {
    status: upper(signal.status, 'reconciliation.status', 'UNKNOWN', 80),
    knownSuccess: normalizeBoolean(signal.knownSuccess, false),
    financialPosted: normalizeBoolean(signal.financialPosted, false),
    contradiction: normalizeBoolean(signal.contradiction, false),
    repairRequired: normalizeBoolean(signal.repairRequired, false),
    fingerprint: normalizeString(signal.fingerprint, 'reconciliation.fingerprint', 128, null),
  };
}

function normalizeRegulatorySignal(signal = {}) {
  if (!isPlainObject(signal)) return null;
  return {
    decision: upper(signal.decision, 'regulatory.decision', 'UNKNOWN', 80),
    blocked: normalizeBoolean(signal.blocked, false),
    reviewRequired: normalizeBoolean(signal.reviewRequired, false),
    decisionId: normalizeString(signal.decisionId, 'regulatory.decisionId', 128, null),
  };
}

function normalizeContext(input = {}) {
  if (!isPlainObject(input)) {
    throw new AirtelRetryIntelligenceError(
      'Retry intelligence input must be a plain object.',
      {
        code: 'RETRY_INPUT_INVALID',
        statusCode: 422,
      },
    );
  }

  const tenantId = normalizeString(
    input.tenantId,
    'tenantId',
    128,
    null,
  );

  const provider = upper(
    input.provider,
    'provider',
    PROVIDER,
    80,
  );

  const operation = normalizeEnum(
    input.operation,
    'operation',
    OPERATIONS,
    'COLLECTION',
  );

  const context = {
    tenantId,
    provider,
    operation,

    paymentId: paymentIdentityFromContext(input),
    transactionId: normalizeString(input.transactionId, 'transactionId', 256, null),

    idempotencyKey: idempotencyKeyFromContext(input),

    attemptNumber: inferAttemptNumber(input),

    startedAt: normalizeDate(input.startedAt, 'startedAt'),
    lastAttemptAt: normalizeDate(input.lastAttemptAt, 'lastAttemptAt'),
    deadlineAt: normalizeDate(input.deadlineAt, 'deadlineAt'),

    providerStatus: normalizeStatus(input.providerStatus),
    paymentStatus: normalizeStatus(input.paymentStatus ?? input.localStatus),
    financialStatus: normalizeStatus(input.financialStatus),

    outcome: normalizeEnum(
      input.outcome,
      'outcome',
      OUTCOME_STATES,
      null,
    ),

    responseReceived: input.responseReceived !== false,
    responseTimedOut: input.responseTimedOut === true,
    outcomeKnown: input.outcomeKnown !== false,

    error: isPlainObject(input.error)
      ? sanitizeMetadata(input.error, 25)
      : {},

    statusResponse: isPlainObject(input.statusResponse)
      ? sanitizeMetadata(input.statusResponse, 25)
      : {},

    headers: normalizeHeaders(input.headers),
    retryAfter: input.retryAfter ?? null,

    providerSignals: normalizeProviderSignals(
      input.providerSignals ?? input.health,
    ),

    prediction: normalizePredictionSignal(
      input.prediction,
    ),

    learning: normalizeLearningSignal(
      input.learning,
    ),

    reconciliation: normalizeReconciliationSignal(
      input.reconciliation,
    ),

    regulatory: normalizeRegulatorySignal(
      input.regulatory,
    ),

    payment: isPlainObject(input.payment)
      ? sanitizeMetadata(input.payment, 50)
      : {},

    metadata: sanitizeMetadata(
      input.metadata,
      50,
    ),
  };

  return deepFreeze(context);
}

// =============================================================================
// Engine
// =============================================================================

export class AirtelRetryIntelligence {
  constructor(options = {}) {
    const supplied = isPlainObject(options) ? options : {};

    const providerScope = upper(
      supplied.providerScope,
      'providerScope',
      PROVIDER,
      80,
    );

    if (providerScope !== PROVIDER) {
      throw new AirtelRetryIntelligenceError(
        'This engine is scoped to AIRTEL.',
        {
          code: 'RETRY_PROVIDER_SCOPE_INVALID',
          statusCode: 500,
          details: { providerScope },
        },
      );
    }

    this.config = deepFreeze({
      ...DEFAULT_OPTIONS,
      ...supplied,
      providerScope,
      defaultPolicy: normalizePolicy(
        supplied.defaultPolicy ?? DEFAULT_POLICY,
      ),
      timeoutMs: clamp(
        integer(supplied.timeoutMs, DEFAULT_OPTIONS.timeoutMs),
        50,
        30_000,
      ),
    });

    this.clock =
      typeof supplied.clock === 'function'
        ? supplied.clock
        : () => Date.now();

    this.random =
      typeof supplied.random === 'function'
        ? supplied.random
        : null;

    this.logger =
      isObject(supplied.logger)
        ? supplied.logger
        : null;

    this.metrics =
      isObject(supplied.metrics)
        ? supplied.metrics
        : null;

    this.predictionEngine =
      supplied.predictionEngine || null;

    this.providerLearningEngine =
      supplied.providerLearningEngine || null;

    this.reconciliationEngine =
      supplied.reconciliationEngine || null;

    this.regulatoryIntelligence =
      supplied.regulatoryIntelligence || null;

    this.orchestrator =
      supplied.orchestrator ||
      supplied.executionAdapter ||
      supplied.retryAdapter ||
      null;
  }

  // ---------------------------------------------------------------------------
  // Health / diagnostics
  // ---------------------------------------------------------------------------

  health() {
    return Object.freeze({
      success: true,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      providerScope: this.config.providerScope,
      ready: true,
      stateless: true,
      integrations: Object.freeze({
        predictionEngine: Boolean(this.predictionEngine),
        providerLearningEngine: Boolean(this.providerLearningEngine),
        reconciliationEngine: Boolean(this.reconciliationEngine),
        regulatoryIntelligence: Boolean(this.regulatoryIntelligence),
        orchestrator: Boolean(this.orchestrator),
        metrics: Boolean(this.metrics),
        logger: Boolean(this.logger),
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // Error classification
  // ---------------------------------------------------------------------------

  classifyError(error = {}) {
    return Object.freeze({
      success: true,
      ...classifyError(error),
      httpStatus: httpStatus(error),
      code: error.code ?? error.errorCode ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Backoff calculation
  // ---------------------------------------------------------------------------

  calculateDelay({
    attemptNumber = 0,
    policy = this.config.defaultPolicy,
    seed = 'titech-airtel-retry',
    retryAfterMs = null,
  } = {}) {
    const normalizedPolicy = normalizePolicy(policy);
    const attempt = clamp(integer(attemptNumber, 0), 0, 100);

    if (
      normalizedPolicy.mode === RETRY_MODES.RETRY_AFTER &&
      retryAfterMs !== null
    ) {
      return Object.freeze({
        success: true,
        delayMs: clamp(
          integer(retryAfterMs, 0),
          0,
          normalizedPolicy.retryAfterCapMs,
        ),
        mode: normalizedPolicy.mode,
        attemptNumber: attempt,
        capped: true,
      });
    }

    const retryAfter = retryAfterMs === null
      ? null
      : clamp(
          integer(retryAfterMs, 0),
          0,
          normalizedPolicy.retryAfterCapMs,
        );

    if (retryAfter !== null) {
      return Object.freeze({
        success: true,
        delayMs: retryAfter,
        mode: 'RETRY_AFTER_SIGNAL',
        attemptNumber: attempt,
        capped: retryAfter >= normalizedPolicy.retryAfterCapMs,
      });
    }

    const delayMs = calculateExponentialDelay(
      attempt,
      normalizedPolicy,
      seed,
      this.random,
    );

    return Object.freeze({
      success: true,
      delayMs,
      mode: normalizedPolicy.mode,
      attemptNumber: attempt,
      capped: delayMs >= normalizedPolicy.maxDelayMs,
    });
  }

  // ---------------------------------------------------------------------------
  // Synchronous analysis
  // ---------------------------------------------------------------------------

  analyzeSync(input = {}) {
    const now = nowDate(this.clock);
    const context = normalizeContext(input);
    const policy = normalizePolicy(
      input.policy ?? this.config.defaultPolicy,
    );

    const validation = this.#validateContext(
      context,
      policy,
    );

    if (!validation.valid) {
      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: validation.decision,
        severity: validation.severity,
        reason: validation.reason,
        findings: validation.findings,
        retry: null,
        validation,
      });
    }

    const classification = classifyError(
      context.error,
    );

    const outcome = inferOutcomeFromContext(
      context,
    );

    const findings = [];

    findings.push({
      code: 'ERROR_CLASSIFIED',
      severity: classification.severity,
      message: classification.reason,
      errorClass: classification.errorClass,
      retryable: classification.retryable,
      ambiguous: classification.ambiguous,
    });

    if (
      isTerminalFinancialState(context)
    ) {
      findings.push({
        code: 'FINANCIAL_STATE_ALREADY_TERMINAL',
        severity: 'CRITICAL',
        message: 'The payment or financial transaction is already in a terminal success/reversal state; no retry is permitted.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'NO_RETRY',
        severity: 'CRITICAL',
        reason: 'Authoritative financial/commercial state indicates no retry is required.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    const regulatoryGate = this.#regulatoryGate(
      context,
    );

    if (regulatoryGate.blocked) {
      findings.push({
        code: 'REGULATORY_RETRY_BLOCK',
        severity: 'CRITICAL',
        message: regulatoryGate.reason,
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'STOP',
        severity: 'CRITICAL',
        reason: regulatoryGate.reason,
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (context.reconciliation?.contradiction) {
      findings.push({
        code: 'RECONCILIATION_CONTRADICTION',
        severity: 'CRITICAL',
        message: 'Reconciliation evidence is contradictory; retry execution must stop until the discrepancy is resolved.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'RECONCILE',
        severity: 'CRITICAL',
        reason: 'Contradictory financial evidence requires reconciliation before any retry.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    const providerGate = this.#providerGate(
      context,
      policy,
      now,
    );

    findings.push(...providerGate.findings);

    if (providerGate.blocked) {
      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: providerGate.decision,
        severity: providerGate.severity,
        reason: providerGate.reason,
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (
      classification.errorClass ===
      'COMPLIANCE_BLOCK'
    ) {
      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'STOP',
        severity: 'CRITICAL',
        reason: classification.reason,
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (
      classification.errorClass ===
      'FINANCIAL_CONFLICT'
    ) {
      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'RECONCILE',
        severity: 'CRITICAL',
        reason: classification.reason,
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (
      classification.errorClass ===
      'DUPLICATE_OR_IDEMPOTENCY_CONFLICT'
    ) {
      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'STATUS_CHECK',
        severity: 'HIGH',
        reason: classification.reason,
        findings,
        retry: this.#statusCheckPlan(
          context,
          policy,
        ),
        validation,
        classification,
        outcome,
      });
    }

    if (
      outcome === 'SUCCESS'
    ) {
      findings.push({
        code: 'OUTCOME_SUCCESS_NO_RETRY',
        severity: 'CRITICAL',
        message: 'A successful outcome takes precedence over a transport/application error.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'NO_RETRY',
        severity: 'CRITICAL',
        reason: 'Payment outcome is already successful.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (
      context.operation !== 'STATUS' &&
      classification.ambiguous
    ) {
      if (
        policy.allowStatusCheckOnAmbiguous &&
        context.idempotencyKey
      ) {
        findings.push({
          code: 'AMBIGUOUS_OUTCOME_STATUS_CHECK',
          severity: 'HIGH',
          message: 'The provider result is ambiguous; perform status verification before repeating the financial operation.',
        });

        return this.#finalizeResult({
          context,
          policy,
          now,
          decision: 'STATUS_CHECK',
          severity: 'HIGH',
          reason: 'Ambiguous provider outcome requires a status lookup before a financial retry.',
          findings,
          retry: this.#statusCheckPlan(
            context,
            policy,
          ),
          validation,
          classification,
          outcome,
        });
      }

      findings.push({
        code: 'AMBIGUOUS_OUTCOME_REVIEW',
        severity: 'CRITICAL',
        message: 'The provider result is ambiguous and no safe status-check path is available.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'REVIEW',
        severity: 'CRITICAL',
        reason: 'Unable to establish a safe retry path for an ambiguous financial outcome.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (
      !classification.retryable &&
      outcome !== 'FAILURE'
    ) {
      findings.push({
        code: 'NON_RETRYABLE_UNKNOWN',
        severity: classification.severity,
        message: 'The outcome/error combination is not sufficiently classified for automatic retry.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'REVIEW',
        severity: classification.severity,
        reason: 'The failure is not confidently retryable.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (
      !this.#classificationPermitsRetry(
        classification,
        policy,
      )
    ) {
      findings.push({
        code: 'ERROR_CLASS_NOT_ALLOWED_BY_POLICY',
        severity: classification.severity,
        message: 'The classified error is outside the configured retry policy.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'NO_RETRY',
        severity: classification.severity,
        reason: 'Configured retry policy does not permit this error class.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    const budget = this.#budgetGate(
      context,
      policy,
      now,
    );

    findings.push(...budget.findings);

    if (budget.blocked) {
      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'STOP',
        severity: budget.severity,
        reason: budget.reason,
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    if (
      isFinancialOperation(context.operation) &&
      !context.idempotencyKey
    ) {
      findings.push({
        code: 'FINANCIAL_RETRY_IDEMPOTENCY_MISSING',
        severity: 'CRITICAL',
        message: 'Financial retry cannot be recommended without the original idempotency key.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'REVIEW',
        severity: 'CRITICAL',
        reason: 'Original idempotency identity is missing for a financial retry.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    const intelligence = this.#intelligenceGate(
      context,
      policy,
      now,
    );

    findings.push(...intelligence.findings);

    if (intelligence.blocked) {
      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: intelligence.decision,
        severity: intelligence.severity,
        reason: intelligence.reason,
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    const attemptNumber = context.attemptNumber;
    const nextAttemptNumber = attemptNumber + 1;

    const retryAfterMs = extractRetryAfterMs(
      context,
      now,
      policy.retryAfterCapMs,
    );

    const seed = sha256({
      tenantId: context.tenantId,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      operation: context.operation,
      errorClass: classification.errorClass,
      attemptNumber,
    });

    const delay = this.calculateDelay({
      attemptNumber,
      policy,
      seed,
      retryAfterMs,
    });

    if (
      context.deadlineAt &&
      now.getTime() + delay.delayMs >
        context.deadlineAt.getTime()
    ) {
      findings.push({
        code: 'RETRY_DELAY_EXCEEDS_DEADLINE',
        severity: 'HIGH',
        message: 'The calculated retry delay would exceed the payment retry deadline.',
      });

      return this.#finalizeResult({
        context,
        policy,
        now,
        decision: 'STOP',
        severity: 'HIGH',
        reason: 'Retry deadline would be exceeded.',
        findings,
        retry: null,
        validation,
        classification,
        outcome,
      });
    }

    const retryPlan = {
      action: 'RETRY',
      executionMode: this.orchestrator
        ? 'ORCHESTRATOR_DELEGATED'
        : 'RECOMMENDATION_ONLY',
      attemptNumber,
      nextAttemptNumber,
      delayMs: delay.delayMs,
      idempotencyPolicy: 'PRESERVE_ORIGINAL',
      idempotencyKey: context.idempotencyKey,
      provider: context.provider,
      operation: context.operation,
      tenantId: context.tenantId,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      deadlineAt: context.deadlineAt?.toISOString() || null,
      maxAttempts: policy.maxAttempts,
      maxElapsedMs: policy.maxElapsedMs,
      errorClass: classification.errorClass,
      retryAfterMs,
      invariants: [
        'Use the original payment idempotency key.',
        'Do not generate a new financial transaction for the retry.',
        'Do not retry after authoritative success/settlement.',
        'Do not bypass regulatory/compliance gates.',
        'The canonical resilience layer remains responsible for circuit breaking and actual network execution.',
        'Financial state remains authoritative in TITech Financial Core.',
      ],
    };

    findings.push({
      code: 'RETRY_PERMITTED',
      severity: 'INFO',
      message: 'The current failure is eligible for a bounded retry under the supplied policy.',
    });

    return this.#finalizeResult({
      context,
      policy,
      now,
      decision: 'RETRY',
      severity: 'INFO',
      reason: 'Retry is permitted within the configured attempt/deadline/idempotency constraints.',
      findings,
      retry: retryPlan,
      validation,
      classification,
      outcome,
      delay,
      intelligence,
    });
  }

  // ---------------------------------------------------------------------------
  // Async APIs
  // ---------------------------------------------------------------------------

  async analyze(input = {}) {
    const base = this.analyzeSync(input);
    const diagnostics = [];

    if (!isPlainObject(input)) return base;

    if (
      this.predictionEngine &&
      !base.retry &&
      base.decision === 'REVIEW'
    ) {
      const prediction = await this.#callPrediction(
        input,
        diagnostics,
      );

      if (prediction) {
        const enrichedInput = {
          ...input,
          prediction,
        };

        const enriched = this.analyzeSync(
          enrichedInput,
        );

        return deepFreeze({
          ...enriched,
          asyncIntegrationsAttempted: true,
          integrationDiagnostics: diagnostics,
        });
      }
    }

    const learning =
      this.providerLearningEngine
        ? await this.#callLearning(
            input,
            diagnostics,
          )
        : null;

    const reconciliation =
      this.reconciliationEngine
        ? await this.#callReconciliation(
            input,
            diagnostics,
          )
        : null;

    const regulatory =
      this.regulatoryIntelligence
        ? await this.#callRegulatory(
            input,
            diagnostics,
          )
        : null;

    if (
      learning ||
      reconciliation ||
      regulatory
    ) {
      const enriched = this.analyzeSync({
        ...input,
        ...(learning
          ? { learning }
          : {}),
        ...(reconciliation
          ? { reconciliation }
          : {}),
        ...(regulatory
          ? { regulatory }
          : {}),
      });

      return deepFreeze({
        ...enriched,
        asyncIntegrationsAttempted: true,
        integrationDiagnostics: diagnostics,
      });
    }

    return deepFreeze({
      ...base,
      asyncIntegrationsAttempted: false,
      integrationDiagnostics: diagnostics,
    });
  }

  async createRetryPlan(input = {}) {
    const result = await this.analyze(input);
    return result.retry
      ? Object.freeze({
          ...result.retry,
          decisionId: result.decisionId,
          decisionFingerprint: result.decisionFingerprint,
        })
      : null;
  }

  createRetryPlanSync(input = {}) {
    const result = this.analyzeSync(input);
    return result.retry
      ? Object.freeze({
          ...result.retry,
          decisionId: result.decisionId,
          decisionFingerprint: result.decisionFingerprint,
        })
      : null;
  }

  shouldRetry(input = {}) {
    const result = this.analyzeSync(input);
    return Object.freeze({
      retry: result.decision === 'RETRY',
      decision: result.decision,
      decisionId: result.decisionId,
      reason: result.reason,
    });
  }

  // ---------------------------------------------------------------------------
  // Delegated execution — deliberately not provider/financial logic
  // ---------------------------------------------------------------------------

  async executeRetryPlan(
    plan,
    executionContext = {},
  ) {
    if (!isPlainObject(plan)) {
      throw new AirtelRetryIntelligenceError(
        'Retry plan must be a plain object.',
        {
          code: 'RETRY_PLAN_INVALID',
          statusCode: 422,
        },
      );
    }

    if (!this.orchestrator) {
      throw new AirtelRetryIntelligenceError(
        'No orchestrator adapter is configured for delegated retry execution.',
        {
          code: 'RETRY_ORCHESTRATOR_UNAVAILABLE',
          statusCode: 503,
        },
      );
    }

    const context = normalizeContext({
      ...executionContext,
      tenantId:
        executionContext.tenantId ??
        plan.tenantId,
      provider:
        executionContext.provider ??
        plan.provider,
      operation:
        executionContext.operation ??
        plan.operation,
      paymentId:
        executionContext.paymentId ??
        plan.paymentId,
      transactionId:
        executionContext.transactionId ??
        plan.transactionId,
      idempotencyKey:
        executionContext.idempotencyKey ??
        plan.idempotencyKey,
      attemptNumber:
        executionContext.attemptNumber ??
        plan.attemptNumber,
    });

    const revalidated = this.analyzeSync({
      ...executionContext,
      tenantId: context.tenantId,
      provider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      attemptNumber: context.attemptNumber,
      providerStatus:
        executionContext.providerStatus ??
        context.providerStatus,
      error:
        executionContext.error ??
        {},
      outcome:
        executionContext.outcome ??
        'FAILURE',
    });

    if (revalidated.decision !== 'RETRY') {
      throw new AirtelRetryIntelligenceError(
        'Retry plan is no longer valid under current execution context.',
        {
          code: 'RETRY_PLAN_REVALIDATION_FAILED',
          statusCode: 409,
          details: {
            decision: revalidated.decision,
            decisionId: revalidated.decisionId,
          },
        },
      );
    }

    if (
      String(plan.idempotencyKey || '') !==
      String(context.idempotencyKey || '')
    ) {
      throw new AirtelRetryIntelligenceError(
        'Retry plan idempotency key does not match execution context.',
        {
          code: 'RETRY_IDEMPOTENCY_MISMATCH',
          statusCode: 409,
        },
      );
    }

    const actor = normalizeActor(
      executionContext.actor,
    );

    const payload = {
      retryPlan: deepClone(plan),
      tenantId: context.tenantId,
      provider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      attemptNumber: context.attemptNumber,
      nextAttemptNumber:
        context.attemptNumber + 1,
      decisionId:
        revalidated.decisionId,
      decisionFingerprint:
        revalidated.decisionFingerprint,
      actor,
      requestId:
        normalizeString(
          executionContext.requestId,
          'requestId',
          256,
          null,
        ),
      correlationId:
        normalizeString(
          executionContext.correlationId,
          'correlationId',
          256,
          null,
        ),
      financialSafety: {
        preserveOriginalIdempotencyKey: true,
        doNotCreateNewFinancialIdentity: true,
        doNotWriteLedgerHere: true,
        authoritativeBoundary: 'TITECH_FINANCIAL_CORE',
      },
    };

    const methodName = [
      'executeRetryPlan',
      'retryPayment',
      'retry',
      'execute',
    ].find(
      name =>
        typeof this.orchestrator?.[name] === 'function',
    );

    if (!methodName) {
      throw new AirtelRetryIntelligenceError(
        'Configured retry orchestrator exposes no supported execution method.',
        {
          code: 'RETRY_ORCHESTRATOR_METHOD_NOT_FOUND',
          statusCode: 503,
        },
      );
    }

    try {
      const result = await this.#withTimeout(
        Promise.resolve(
          this.orchestrator[methodName](
            payload,
          ),
        ),
        this.config.timeoutMs,
      );

      this.#metricIncrement(
        'airtel_retry_delegated_execution_total',
      );

      return deepFreeze({
        success: true,
        delegated: true,
        method: methodName,
        decisionId:
          revalidated.decisionId,
        result,
      });
    } catch (error) {
      this.#metricIncrement(
        'airtel_retry_delegated_execution_failures_total',
      );

      this.#log('error', {
        event: 'airtel_retry_delegated_execution_failed',
        tenantId: context.tenantId,
        provider: context.provider,
        operation: context.operation,
        paymentId: context.paymentId,
        attemptNumber: context.attemptNumber,
        code: error?.code || 'RETRY_EXECUTION_FAILED',
      });

      throw new AirtelRetryIntelligenceError(
        'Delegated retry execution failed.',
        {
          code: error?.code || 'RETRY_EXECUTION_FAILED',
          statusCode: error?.statusCode || 502,
          details: {
            decisionId: revalidated.decisionId,
          },
          cause: error,
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Validation gates
  // ---------------------------------------------------------------------------

  #validateContext(context, policy) {
    const findings = [];

    if (
      policy.requireTenantId &&
      this.config.requireTenantId &&
      !context.tenantId
    ) {
      findings.push({
        code: 'TENANT_REQUIRED',
        severity: 'CRITICAL',
        message: 'tenantId is required.',
      });

      return {
        valid: false,
        decision: 'REVIEW',
        severity: 'CRITICAL',
        reason: 'Retry intelligence cannot operate without tenant scope.',
        findings,
      };
    }

    if (
      context.provider !==
      this.config.providerScope
    ) {
      findings.push({
        code: 'PROVIDER_SCOPE_MISMATCH',
        severity: 'CRITICAL',
        message: `Expected provider ${this.config.providerScope}; received ${context.provider}.`,
      });

      return {
        valid: false,
        decision: 'STOP',
        severity: 'CRITICAL',
        reason: 'Provider scope mismatch.',
        findings,
      };
    }

    if (
      policy.requireOriginalIdempotencyKey &&
      isFinancialOperation(context.operation) &&
      !context.idempotencyKey
    ) {
      findings.push({
        code: 'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
        severity: 'CRITICAL',
        message: 'Financial retry requires the original idempotency key.',
      });

      return {
        valid: false,
        decision: 'REVIEW',
        severity: 'CRITICAL',
        reason: 'Original idempotency identity is unavailable.',
        findings,
      };
    }

    return {
      valid: true,
      decision: null,
      severity: 'INFO',
      reason: null,
      findings,
    };
  }

  #providerGate(context, policy, now) {
    const signals = context.providerSignals;
    const findings = [];

    if (
      signals.updatedAt &&
      now.getTime() - signals.updatedAt.getTime() >
        policy.staleProviderHealthMs
    ) {
      findings.push({
        code: 'PROVIDER_HEALTH_STALE',
        severity: 'MEDIUM',
        message: 'Provider health data is stale; retry confidence is reduced.',
      });
    }

    if (
      String(signals.healthStatus) === 'DOWN'
    ) {
      findings.push({
        code: 'PROVIDER_DOWN',
        severity: 'HIGH',
        message: 'Provider health is DOWN.',
      });

      return {
        blocked: true,
        decision: 'STOP',
        severity: 'HIGH',
        reason: 'Provider is currently unavailable; retry must wait for resilience controls to permit service.',
        findings,
      };
    }

    if (
      String(signals.circuitState) === 'OPEN'
    ) {
      findings.push({
        code: 'CIRCUIT_OPEN',
        severity: 'HIGH',
        message: 'Provider circuit breaker is OPEN.',
      });

      return {
        blocked: true,
        decision: 'STOP',
        severity: 'HIGH',
        reason: 'Canonical circuit breaker has opened; retry is not permitted by intelligence.',
        findings,
      };
    }

    if (
      String(signals.circuitState) === 'UNKNOWN'
    ) {
      findings.push({
        code: 'CIRCUIT_STATE_UNKNOWN',
        severity: 'MEDIUM',
        message: 'Circuit state is unknown; retry is allowed only when the resilience layer remains authoritative.',
      });
    }

    if (
      signals.available === false
    ) {
      return {
        blocked: true,
        decision: 'STOP',
        severity: 'HIGH',
        reason: 'Provider is marked unavailable by the supplied provider signal.',
        findings,
      };
    }

    return {
      blocked: false,
      decision: null,
      severity: 'INFO',
      reason: null,
      findings,
    };
  }

  #budgetGate(context, policy, now) {
    const findings = [];
    const attempt = context.attemptNumber;

    if (
      attempt >= policy.maxAttempts
    ) {
      findings.push({
        code: 'MAX_ATTEMPTS_REACHED',
        severity: 'HIGH',
        message: 'The configured retry attempt budget has been exhausted.',
      });

      return {
        blocked: true,
        severity: 'HIGH',
        reason: 'Maximum retry attempts reached.',
        findings,
      };
    }

    const startedAt =
      context.startedAt ??
      context.lastAttemptAt ??
      now;

    const elapsedMs = Math.max(
      0,
      now.getTime() - startedAt.getTime(),
    );

    if (
      elapsedMs >= policy.maxElapsedMs
    ) {
      findings.push({
        code: 'RETRY_TIME_BUDGET_EXHAUSTED',
        severity: 'HIGH',
        message: 'The configured elapsed-time retry budget has been exhausted.',
      });

      return {
        blocked: true,
        severity: 'HIGH',
        reason: 'Retry elapsed-time budget exhausted.',
        findings,
      };
    }

    if (
      context.deadlineAt &&
      now >= context.deadlineAt
    ) {
      findings.push({
        code: 'RETRY_DEADLINE_REACHED',
        severity: 'HIGH',
        message: 'The payment retry deadline has already elapsed.',
      });

      return {
        blocked: true,
        severity: 'HIGH',
        reason: 'Retry deadline reached.',
        findings,
      };
    }

    findings.push({
      code: 'RETRY_BUDGET_AVAILABLE',
      severity: 'INFO',
      message: `Retry budget available: attempt ${attempt + 1} of ${policy.maxAttempts}.`,
    });

    return {
      blocked: false,
      severity: 'INFO',
      reason: null,
      findings,
    };
  }

  #intelligenceGate(context, policy, now) {
    const findings = [];

    if (
      context.reconciliation?.knownSuccess ||
      context.reconciliation?.financialPosted
    ) {
      findings.push({
        code: 'RECONCILIATION_SUCCESS_PRESENT',
        severity: 'CRITICAL',
        message: 'Reconciliation evidence indicates the payment has already succeeded or posted financially.',
      });

      return {
        blocked: true,
        decision: 'NO_RETRY',
        severity: 'CRITICAL',
        reason: 'Authoritative reconciliation indicates financial success.',
        findings,
      };
    }

    if (
      context.reconciliation?.repairRequired
    ) {
      findings.push({
        code: 'RECONCILIATION_REPAIR_REQUIRED',
        severity: 'HIGH',
        message: 'A reconciliation repair is required before another provider attempt.',
      });

      return {
        blocked: true,
        decision: 'RECONCILE',
        severity: 'HIGH',
        reason: 'Reconciliation repair must be completed before retry.',
        findings,
      };
    }

    const prediction = context.prediction;

    if (
      prediction &&
      prediction.updatedAt &&
      now.getTime() - prediction.updatedAt.getTime() >
        policy.staleRecommendationMs
    ) {
      findings.push({
        code: 'PREDICTION_STALE',
        severity: 'LOW',
        message: 'Prediction signal is stale and will not be used as a hard gate.',
      });
    }

    if (
      prediction?.confidence !== undefined
    ) {
      findings.push({
        code: 'PREDICTION_CONSUMED',
        severity: 'INFO',
        message: 'Prediction signal consumed as supporting retry evidence only.',
      });
    }

    const learning = context.learning;

    if (
      learning &&
      learning.updatedAt &&
      now.getTime() - learning.updatedAt.getTime() >
        policy.staleLearningMs
    ) {
      findings.push({
        code: 'LEARNING_SIGNAL_STALE',
        severity: 'LOW',
        message: 'Provider learning signal is stale and will not be used as a hard gate.',
      });
    }

    if (
      learning &&
      learning.ambiguousOutcomeRate >= 0.75
    ) {
      findings.push({
        code: 'HIGH_AMBIGUITY_PROVIDER_HISTORY',
        severity: 'HIGH',
        message: 'Provider history shows a high rate of ambiguous outcomes; automatic retry is riskier.',
      });

      if (
        isFinancialOperation(context.operation) &&
        !policy.allowFinancialPostRetryWithoutFreshStatus
      ) {
        return {
          blocked: true,
          decision: 'STATUS_CHECK',
          severity: 'HIGH',
          reason: 'Historical ambiguity is too high to justify a blind financial replay.',
          findings,
        };
      }
    }

    if (
      prediction &&
      prediction.ambiguityProbability >= 0.80 &&
      isFinancialOperation(context.operation)
    ) {
      findings.push({
        code: 'PREDICTED_AMBIGUOUS_RETRY',
        severity: 'HIGH',
        message: 'Prediction indicates a high probability of another ambiguous outcome.',
      });

      if (!policy.allowFinancialPostRetryWithoutFreshStatus) {
        return {
          blocked: true,
          decision: 'STATUS_CHECK',
          severity: 'HIGH',
          reason: 'Predicted ambiguity requires status verification before financial replay.',
          findings,
        };
      }
    }

    if (
      context.regulatory?.reviewRequired
    ) {
      findings.push({
        code: 'REGULATORY_RETRY_REVIEW_REQUIRED',
        severity: 'HIGH',
        message: 'Regulatory intelligence requires review before retry.',
      });

      return {
        blocked: true,
        decision: 'REVIEW',
        severity: 'HIGH',
        reason: 'Regulatory review is required before retry.',
        findings,
      };
    }

    return {
      blocked: false,
      decision: null,
      severity: 'INFO',
      reason: null,
      findings,
    };
  }

  #classificationPermitsRetry(
    classification,
    policy,
  ) {
    switch (classification.errorClass) {
      case 'NETWORK_TRANSIENT':
        return policy.retryNetworkErrors;

      case 'TIMEOUT_TRANSIENT':
        return policy.retryTimeoutErrors;

      case 'RATE_LIMITED':
        return policy.retry429;

      case 'PROVIDER_SERVER_ERROR':
      case 'PROVIDER_UNAVAILABLE':
        return policy.retry5xx;

      case 'CONCURRENCY_CONFLICT':
        return policy.retryConcurrencyConflicts;

      case 'BUSINESS_FAILURE':
        return policy.allowRetryOnConfirmedFailure;

      default:
        return classification.retryable;
    }
  }

  #statusCheckPlan(context, policy) {
    const paymentId = context.paymentId;
    const idempotencyKey = context.idempotencyKey;

    return {
      action: 'STATUS_CHECK',
      provider: context.provider,
      operation: 'STATUS',
      originalOperation: context.operation,
      tenantId: context.tenantId,
      paymentId,
      transactionId: context.transactionId,
      idempotencyKey,
      maxStatusChecks: policy.maxStatusChecks,
      statusCheckDelayMs: policy.statusCheckDelayMs,
      preserveOriginalIdempotencyKey: true,
      doNotCreateNewFinancialIdentity: true,
      executionMode: this.orchestrator
        ? EXECUTION_MODES.ORCHESTRATOR_DELEGATED
        : EXECUTION_MODES.RECOMMENDATION_ONLY,
    };
  }

  #regulatoryGate(context) {
    const regulatory = context.regulatory;

    if (!regulatory) {
      return {
        blocked: false,
        reason: null,
      };
    }

    if (
      regulatory.blocked ||
      ['BLOCK', 'DENY', 'REJECT'].includes(
        regulatory.decision,
      )
    ) {
      return {
        blocked: true,
        reason: 'Regulatory intelligence indicates that retry is blocked.',
      };
    }

    return {
      blocked: false,
      reason: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Result / fingerprint
  // ---------------------------------------------------------------------------

  #finalizeResult({
    context,
    policy,
    now,
    decision,
    severity,
    reason,
    findings,
    retry,
    validation,
    classification = null,
    outcome = null,
    delay = null,
    intelligence = null,
  }) {
    const safeFindings = findings.map(item => ({
      code: item.code,
      severity: item.severity,
      message: item.message,
      ...(item.errorClass ? { errorClass: item.errorClass } : {}),
      ...(item.retryable !== undefined ? { retryable: item.retryable } : {}),
      ...(item.ambiguous !== undefined ? { ambiguous: item.ambiguous } : {}),
    }));

    const fingerprintInput = {
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      tenantId: context.tenantId,
      provider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      attemptNumber: context.attemptNumber,
      outcome,
      errorClass: classification?.errorClass || null,
      decision,
      severity,
      policy: {
        maxAttempts: policy.maxAttempts,
        maxElapsedMs: policy.maxElapsedMs,
        baseDelayMs: policy.baseDelayMs,
        maxDelayMs: policy.maxDelayMs,
        jitterRatio: policy.jitterRatio,
        mode: policy.mode,
      },
      providerSignals: {
        healthStatus: context.providerSignals.healthStatus,
        circuitState: context.providerSignals.circuitState,
        sampleSize: context.providerSignals.sampleSize,
      },
      reconciliation: context.reconciliation
        ? {
            status: context.reconciliation.status,
            knownSuccess: context.reconciliation.knownSuccess,
            financialPosted: context.reconciliation.financialPosted,
            contradiction: context.reconciliation.contradiction,
            fingerprint: context.reconciliation.fingerprint,
          }
        : null,
      regulatory: context.regulatory
        ? {
            decision: context.regulatory.decision,
            blocked: context.regulatory.blocked,
            reviewRequired: context.regulatory.reviewRequired,
            decisionId: context.regulatory.decisionId,
          }
        : null,
      findings: safeFindings,
      retry: retry
        ? {
            action: retry.action,
            nextAttemptNumber: retry.nextAttemptNumber,
            delayMs: retry.delayMs,
            idempotencyKey: retry.idempotencyKey,
          }
        : null,
    };

    const decisionFingerprint = sha256(
      fingerprintInput,
    );

    const decisionId = decisionFingerprint.slice(
      0,
      40,
    );

    const result = {
      success: true,
      component: COMPONENT,
      engine: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,
      evaluatedAt: now.toISOString(),

      decisionId,
      decisionFingerprint,

      tenantId: context.tenantId,
      provider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      attemptNumber: context.attemptNumber,

      decision,
      severity,
      reason,
      outcome,

      retry,
      delay,

      classification,
      findings: safeFindings,

      validation: {
        valid: validation.valid,
        policy: {
          maxAttempts: policy.maxAttempts,
          maxElapsedMs: policy.maxElapsedMs,
          mode: policy.mode,
          preserveOriginalIdempotencyKey: policy.requireOriginalIdempotencyKey,
        },
      },

      intelligence: intelligence
        ? {
            predictionPresent: Boolean(context.prediction),
            learningPresent: Boolean(context.learning),
            reconciliationPresent: Boolean(context.reconciliation),
            regulatoryPresent: Boolean(context.regulatory),
          }
        : {
            predictionPresent: Boolean(context.prediction),
            learningPresent: Boolean(context.learning),
            reconciliationPresent: Boolean(context.reconciliation),
            regulatoryPresent: Boolean(context.regulatory),
          },

      safety: {
        financialMutationPerformed: false,
        providerCallPerformed: false,
        ledgerMutationPerformed: false,
        newFinancialIdentityGenerated: false,
        authoritativeBoundary: 'TITECH_FINANCIAL_CORE',
      },
    };

    this.#metricIncrement(
      'airtel_retry_intelligence_evaluations_total',
    );

    this.#metricIncrement(
      `airtel_retry_decisions_${decision.toLowerCase()}_total`,
    );

    this.#log('info', {
      event: 'airtel_retry_intelligence_evaluation_completed',
      tenantId: context.tenantId,
      provider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      attemptNumber: context.attemptNumber,
      decision,
      severity,
      decisionId,
    });

    return deepFreeze(result);
  }

  // ---------------------------------------------------------------------------
  // Optional async integrations
  // ---------------------------------------------------------------------------

  async #callPrediction(input, diagnostics) {
    const methodName = [
      'predictRetry',
      'predict',
      'estimate',
      'score',
    ].find(
      name =>
        typeof this.predictionEngine?.[name] === 'function',
    );

    if (!methodName) {
      diagnostics.push({
        integration: 'predictionEngine',
        status: 'UNAVAILABLE',
        code: 'RETRY_PREDICTION_METHOD_NOT_FOUND',
      });
      return null;
    }

    const context = normalizeContext(input);

    try {
      const result = await this.#withTimeout(
        Promise.resolve(
          this.predictionEngine[methodName]({
            tenantId: context.tenantId,
            provider: context.provider,
            operation: context.operation,
            paymentId: context.paymentId,
            attemptNumber: context.attemptNumber,
            errorClass: classifyError(context.error).errorClass,
            outcome: inferOutcomeFromContext(context),
          }),
        ),
        this.config.timeoutMs,
      );

      diagnostics.push({
        integration: 'predictionEngine',
        status: 'OK',
        method: methodName,
      });

      return normalizePredictionSignal(result);
    } catch (error) {
      diagnostics.push({
        integration: 'predictionEngine',
        status: 'FAILED',
        method: methodName,
        code: error?.code || 'RETRY_PREDICTION_FAILED',
      });

      this.#log('warn', {
        event: 'airtel_retry_prediction_integration_failed',
        code: error?.code || 'RETRY_PREDICTION_FAILED',
      });

      return null;
    }
  }

  async #callLearning(input, diagnostics) {
    const methodName = [
      'getRetryLearningSignal',
      'getProviderLearningSignal',
      'getProviderScore',
      'scoreProvider',
      'evaluate',
    ].find(
      name =>
        typeof this.providerLearningEngine?.[name] === 'function',
    );

    if (!methodName) {
      diagnostics.push({
        integration: 'providerLearningEngine',
        status: 'UNAVAILABLE',
        code: 'RETRY_LEARNING_METHOD_NOT_FOUND',
      });
      return null;
    }

    const context = normalizeContext(input);

    try {
      const result = await this.#withTimeout(
        Promise.resolve(
          this.providerLearningEngine[methodName]({
            tenantId: context.tenantId,
            provider: context.provider,
            operation: context.operation,
            attemptNumber: context.attemptNumber,
            errorClass: classifyError(context.error).errorClass,
            outcome: inferOutcomeFromContext(context),
          }),
        ),
        this.config.timeoutMs,
      );

      diagnostics.push({
        integration: 'providerLearningEngine',
        status: 'OK',
        method: methodName,
      });

      return normalizeLearningSignal(result);
    } catch (error) {
      diagnostics.push({
        integration: 'providerLearningEngine',
        status: 'FAILED',
        method: methodName,
        code: error?.code || 'RETRY_LEARNING_FAILED',
      });

      this.#log('warn', {
        event: 'airtel_retry_learning_integration_failed',
        code: error?.code || 'RETRY_LEARNING_FAILED',
      });

      return null;
    }
  }

  async #callReconciliation(input, diagnostics) {
    const methodName = [
      'reconcile',
      'reconcilePayment',
      'analyze',
    ].find(
      name =>
        typeof this.reconciliationEngine?.[name] === 'function',
    );

    if (!methodName) {
      diagnostics.push({
        integration: 'reconciliationEngine',
        status: 'UNAVAILABLE',
        code: 'RETRY_RECONCILIATION_METHOD_NOT_FOUND',
      });
      return null;
    }

    const context = normalizeContext(input);

    try {
      const result = await this.#withTimeout(
        Promise.resolve(
          this.reconciliationEngine[methodName]({
            tenantId: context.tenantId,
            provider: context.provider,
            paymentId: context.paymentId,
            transactionId: context.transactionId,
            idempotencyKey: context.idempotencyKey,
            providerStatus: context.providerStatus,
            paymentStatus: context.paymentStatus,
            financialStatus: context.financialStatus,
          }),
        ),
        this.config.timeoutMs,
      );

      diagnostics.push({
        integration: 'reconciliationEngine',
        status: 'OK',
        method: methodName,
      });

      return normalizeReconciliationSignal(result);
    } catch (error) {
      diagnostics.push({
        integration: 'reconciliationEngine',
        status: 'FAILED',
        method: methodName,
        code: error?.code || 'RETRY_RECONCILIATION_FAILED',
      });

      this.#log('warn', {
        event: 'airtel_retry_reconciliation_integration_failed',
        code: error?.code || 'RETRY_RECONCILIATION_FAILED',
      });

      return null;
    }
  }

  async #callRegulatory(input, diagnostics) {
    const methodName = [
      'analyze',
      'evaluate',
      'analyzeSync',
    ].find(
      name =>
        typeof this.regulatoryIntelligence?.[name] === 'function',
    );

    if (!methodName) {
      diagnostics.push({
        integration: 'regulatoryIntelligence',
        status: 'UNAVAILABLE',
        code: 'RETRY_REGULATORY_METHOD_NOT_FOUND',
      });
      return null;
    }

    const context = normalizeContext(input);

    try {
      const result = await this.#withTimeout(
        Promise.resolve(
          this.regulatoryIntelligence[methodName]({
            tenantId: context.tenantId,
            provider: context.provider,
            operation: context.operation,
            transaction: context.payment,
            evidence: {
              provider: {
                status: context.providerStatus,
              },
              local: {
                status: context.paymentStatus,
              },
              financial: {
                status: context.financialStatus,
              },
            },
            mode: 'ADVISORY',
          }),
        ),
        this.config.timeoutMs,
      );

      diagnostics.push({
        integration: 'regulatoryIntelligence',
        status: 'OK',
        method: methodName,
      });

      return normalizeRegulatorySignal(result);
    } catch (error) {
      diagnostics.push({
        integration: 'regulatoryIntelligence',
        status: 'FAILED',
        method: methodName,
        code: error?.code || 'RETRY_REGULATORY_FAILED',
      });

      this.#log('warn', {
        event: 'airtel_retry_regulatory_integration_failed',
        code: error?.code || 'RETRY_REGULATORY_FAILED',
      });

      return null;
    }
  }

  async #withTimeout(promise, timeoutMs) {
    let timer;

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(
          'Retry intelligence integration timed out.',
        );
        error.code = 'RETRY_INTELLIGENCE_INTEGRATION_TIMEOUT';
        reject(error);
      }, timeoutMs);

      timer.unref?.();
    });

    try {
      return await Promise.race([
        Promise.resolve(promise),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  #metricIncrement(name, value = 1) {
    try {
      if (typeof this.metrics?.increment === 'function') {
        this.metrics.increment(name, value);
        return;
      }

      if (typeof this.metrics?.inc === 'function') {
        this.metrics.inc(name, value);
        return;
      }

      this.metrics?.counter?.(name, value);
    } catch {
      // Observability failure never changes the retry decision.
    }
  }

  #log(level, payload) {
    try {
      const logger = this.logger;
      if (!logger) return;

      const method =
        typeof logger[level] === 'function'
          ? logger[level]
          : logger.info;

      method?.call(logger, payload);
    } catch {
      // Logging failure never changes retry semantics.
    }
  }
}

// =============================================================================
// Public helpers / factory
// =============================================================================

export function createRetryIntelligence(options = {}) {
  return new AirtelRetryIntelligence(options);
}

export const defaultRetryIntelligence =
  new AirtelRetryIntelligence();

export const retryIntelligence =
  defaultRetryIntelligence;

export {
  classifyError,
  normalizePolicy,
  calculateExponentialDelay,
  inferOutcomeFromContext,
  isFinancialOperation,
};

export default AirtelRetryIntelligence;