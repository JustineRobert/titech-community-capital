'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Artillery Load-Test Processor
 * ============================================================================
 *
 * File:
 *   backend/tests/load-testing/artillery-processor.js
 *
 * Purpose:
 *   Shared helper functions for Artillery performance, load, stress and
 *   endurance testing.
 *
 * Responsibilities:
 *   - Per-virtual-user initialization
 *   - Canonical TITech test identity
 *   - Synthetic email generation where required
 *   - Request correlation IDs
 *   - Idempotency-key generation
 *   - Token extraction
 *   - Request/response diagnostics
 *   - Lightweight test instrumentation
 *
 * Design goals:
 *   - Safe under high request rates
 *   - No secrets logged
 *   - No production credentials generated
 *   - Consistent +256782397907 test phone
 *   - Minimal console overhead during sustained load
 *
 * ============================================================================
 */

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEST_PHONE = '+256782397907';

const DEFAULT_LOG_LEVEL =
  process.env.LOAD_TEST_LOG_LEVEL || 'error';

const ENABLE_REQUEST_LOGGING =
  process.env.LOAD_TEST_REQUEST_LOGGING === 'true';

const ENABLE_RESPONSE_LOGGING =
  process.env.LOAD_TEST_RESPONSE_LOGGING === 'true';

const REQUEST_LOG_SAMPLE_RATE =
  Number(process.env.LOAD_TEST_REQUEST_LOG_SAMPLE_RATE) || 0.01;

const RESPONSE_LOG_SAMPLE_RATE =
  Number(process.env.LOAD_TEST_RESPONSE_LOG_SAMPLE_RATE) || 0.05;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a cryptographically strong short random suffix.
 *
 * @param {number} bytes
 * @returns {string}
 */
function randomHex(bytes = 8) {
  const crypto = require('crypto');

  return crypto
    .randomBytes(bytes)
    .toString('hex');
}

/**
 * Generate a synthetic email address.
 *
 * @returns {string}
 */
function randomEmail() {
  return [
    'loadtest',
    Date.now(),
    randomHex(4),
  ].join('-') + '@example.com';
}

/**
 * Generate a unique load-test correlation ID.
 *
 * @returns {string}
 */
function correlationId() {
  return `titech-load-${Date.now()}-${randomHex(6)}`;
}

/**
 * Generate a unique idempotency key.
 *
 * @param {string} prefix
 * @returns {string}
 */
function idempotencyKey(prefix = 'request') {
  return `titech-idem-${prefix}-${Date.now()}-${randomHex(8)}`;
}

/**
 * Return the canonical TITech integration/load-test phone number.
 *
 * An explicit LOAD_TEST_PHONE environment variable may override it for a
 * dedicated test environment, but the default remains the canonical TITech
 * number.
 *
 * @returns {string}
 */
function getTestPhone() {
  return (
    process.env.LOAD_TEST_PHONE ||
    DEFAULT_TEST_PHONE
  );
}

/**
 * Determine whether a log statement should be sampled.
 *
 * @param {number} sampleRate
 * @returns {boolean}
 */
function shouldSample(sampleRate) {
  if (sampleRate >= 1) {
    return true;
  }

  if (sampleRate <= 0) {
    return false;
  }

  return Math.random() < sampleRate;
}

/**
 * Check whether an error-level log should be emitted.
 *
 * @returns {boolean}
 */
function isErrorLoggingEnabled() {
  return [
    'error',
    'warn',
    'info',
    'debug',
  ].includes(DEFAULT_LOG_LEVEL);
}

/**
 * Check whether informational logging is enabled.
 *
 * @returns {boolean}
 */
function isInfoLoggingEnabled() {
  return [
    'info',
    'debug',
  ].includes(DEFAULT_LOG_LEVEL);
}

/**
 * Check whether debug logging is enabled.
 *
 * @returns {boolean}
 */
function isDebugLoggingEnabled() {
  return DEFAULT_LOG_LEVEL === 'debug';
}

/**
 * Safely stringify a value without accidentally logging secrets.
 *
 * @param {*} value
 * @returns {string}
 */
function safeSerialize(value) {
  if (value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(
      value,
      (key, currentValue) => {
        const sensitiveKeys = [
          'authorization',
          'cookie',
          'set-cookie',
          'token',
          'accessToken',
          'refreshToken',
          'clientSecret',
          'secret',
          'password',
          'apiKey',
          'stripeSecret',
          'jwt',
        ];

        if (
          sensitiveKeys.some(
            (sensitiveKey) =>
              key.toLowerCase() ===
              sensitiveKey.toLowerCase()
          )
        ) {
          return '[REDACTED]';
        }

        return currentValue;
      }
    );
  } catch (_error) {
    return '[UNSERIALIZABLE]';
  }
}

// ============================================================================
// Scenario Setup
// ============================================================================

/**
 * Setup hook executed before each virtual-user scenario.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} next
 * @returns {*}
 */
function setup(context, events, next) {
  context.vars = context.vars || {};

  /**
   * Per-virtual-user values.
   */
  context.vars.timestamp = Date.now();

  context.vars.testRunId =
    context.vars.testRunId ||
    `run-${Date.now()}-${randomHex(4)}`;

  context.vars.virtualUserId =
    context.vars.virtualUserId ||
    `vu-${randomHex(6)}`;

  context.vars.correlationId =
    correlationId();

  /**
   * Authentication fixture.
   *
   * These are synthetic values unless the scenario overrides them with
   * $env variables from the Artillery configuration.
   */
  context.vars.authEmail =
    context.vars.authEmail ||
    process.env.LOAD_TEST_EMAIL ||
    randomEmail();

  context.vars.authPassword =
    context.vars.authPassword ||
    process.env.LOAD_TEST_PASSWORD ||
    'TestPassword123!';

  /**
   * Canonical TITech phone number.
   */
  context.vars.phone =
    getTestPhone();

  /**
   * Test currency.
   */
  context.vars.currency =
    process.env.LOAD_TEST_CURRENCY ||
    'USD';

  /**
   * Load-test group.
   */
  context.vars.groupId =
    context.vars.groupId ||
    process.env.LOAD_TEST_GROUP_ID ||
    '';

  /**
   * Request-specific idempotency keys.
   */
  context.vars.idempotencyKey =
    idempotencyKey('generic');

  context.vars.contributionIdempotencyKey =
    idempotencyKey('contribution');

  context.vars.paymentIdempotencyKey =
    idempotencyKey('payment');

  /**
   * Keep sensitive values out of logs.
   */
  context.vars.enableDiagnostics =
    process.env.LOAD_TEST_DIAGNOSTICS === 'true';

  return next();
}

// ============================================================================
// Scenario Teardown
// ============================================================================

/**
 * Teardown hook executed after each virtual-user scenario.
 *
 * No database mutations are performed here. Cleanup of persistent test data
 * should be handled by the target environment or dedicated cleanup jobs.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} next
 * @returns {*}
 */
function teardown(context, events, next) {
  if (
    context &&
    context.vars &&
    context.vars.enableDiagnostics &&
    isDebugLoggingEnabled()
  ) {
    console.debug(
      `[TITech LoadTest] scenario complete ` +
      `vu=${context.vars.virtualUserId || 'unknown'} ` +
      `run=${context.vars.testRunId || 'unknown'}`
    );
  }

  return next();
}

// ============================================================================
// Phone Number Helper
// ============================================================================

/**
 * Set the canonical TITech phone number on the virtual user.
 *
 * This function intentionally does NOT generate random regional numbers.
 * Mobile-money load testing should use a dedicated sandbox identity/number.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function phoneNumber(context, events, done) {
  context.vars = context.vars || {};

  context.vars.phone =
    process.env.LOAD_TEST_PHONE ||
    DEFAULT_TEST_PHONE;

  return done();
}

// ============================================================================
// Token Extraction
// ============================================================================

/**
 * Extract an authentication token from an HTTP response.
 *
 * The original implementation attempted to inspect requestParams.json, which
 * contains the outgoing request body, not the response returned by the API.
 *
 * @param {object} requestParams
 * @param {object} response
 * @param {object} context
 * @param {object} events
 * @param {Function} next
 * @returns {*}
 */
function extractAuthToken(
  requestParams,
  response,
  context,
  events,
  next
) {
  context.vars = context.vars || {};

  const body =
    response && response.body
      ? response.body
      : {};

  let token =
    body.token ||
    body.accessToken ||
    body.data?.token ||
    body.data?.accessToken ||
    null;

  /**
   * Some Artillery transports expose the body as a string.
   */
  if (!token && typeof response?.body === 'string') {
    try {
      const parsed = JSON.parse(response.body);

      token =
        parsed.token ||
        parsed.accessToken ||
        parsed.data?.token ||
        parsed.data?.accessToken ||
        null;
    } catch (_error) {
      // Ignore non-JSON responses.
    }
  }

  if (token) {
    context.vars.authToken = token;
  }

  return next();
}

// ============================================================================
// Correlation / Idempotency Hooks
// ============================================================================

/**
 * Add a correlation ID to the current request.
 *
 * @param {object} requestParams
 * @param {object} context
 * @param {object} events
 * @param {Function} next
 * @returns {*}
 */
function beforeRequest(
  requestParams,
  context,
  events,
  next
) {
  context.vars = context.vars || {};

  context.vars.correlationId =
    context.vars.correlationId ||
    correlationId();

  requestParams.headers =
    requestParams.headers || {};

  requestParams.headers[
    'X-Correlation-ID'
  ] = context.vars.correlationId;

  /**
   * Propagate canonical phone number when a request explicitly references
   * the helper-generated phone variable.
   */
  if (
    requestParams.json &&
    requestParams.json.phone === undefined &&
    requestParams.json.phoneNumber === undefined
  ) {
    /**
     * Do not automatically inject a phone number into every request. Only
     * payment/auth flows should send it explicitly.
     */
  }

  /**
   * Sampled request logging only.
   *
   * Logging every request during a high-arrival-rate load test can itself
   * become the bottleneck.
   */
  if (
    ENABLE_REQUEST_LOGGING &&
    shouldSample(REQUEST_LOG_SAMPLE_RATE)
  ) {
    const method =
      requestParams.method || 'GET';

    const url =
      requestParams.url || '';

    const timestamp =
      new Date().toISOString();

    if (isDebugLoggingEnabled()) {
      console.debug(
        `[${timestamp}] ${method} ${url} ` +
        `correlationId=${context.vars.correlationId}`
      );
    } else if (isInfoLoggingEnabled()) {
      console.log(
        `[${timestamp}] ${method} ${url}`
      );
    }
  }

  return next();
}

// ============================================================================
// Response Diagnostics
// ============================================================================

/**
 * Inspect HTTP responses and emit sampled diagnostics.
 *
 * @param {object} requestParams
 * @param {object} response
 * @param {object} context
 * @param {object} events
 * @param {Function} next
 * @returns {*}
 */
function afterResponse(
  requestParams,
  response,
  context,
  events,
  next
) {
  const statusCode =
    Number(response?.statusCode) || 0;

  const url =
    requestParams?.url || '';

  const timestamp =
    new Date().toISOString();

  /**
   * Errors are always potentially useful, but response bodies are sanitized
   * before logging.
   */
  if (statusCode >= 400) {
    if (isErrorLoggingEnabled()) {
      const responseBody =
        response?.body !== undefined
          ? safeSerialize(response.body)
          : '';

      console.error(
        `[${timestamp}] ` +
        `HTTP ${statusCode} ${url} ` +
        `response=${responseBody}`
      );
    }

    return next();
  }

  /**
   * Successful responses are sampled to reduce load-test logger overhead.
   */
  if (
    ENABLE_RESPONSE_LOGGING &&
    shouldSample(RESPONSE_LOG_SAMPLE_RATE)
  ) {
    if (isDebugLoggingEnabled()) {
      console.debug(
        `[${timestamp}] ` +
        `HTTP ${statusCode} ${url}`
      );
    }
  }

  return next();
}

// ============================================================================
// Dynamic Data Helpers
// ============================================================================

/**
 * Generate a unique group name.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function groupName(context, events, done) {
  context.vars = context.vars || {};

  context.vars.groupName =
    `TITech Load Group ${Date.now()}-${randomHex(4)}`;

  return done();
}

/**
 * Generate a generic correlation identifier.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function generateCorrelationId(
  context,
  events,
  done
) {
  context.vars = context.vars || {};

  context.vars.correlationId =
    correlationId();

  return done();
}

/**
 * Generate an idempotency key for a request.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function generateIdempotencyKey(
  context,
  events,
  done
) {
  context.vars = context.vars || {};

  context.vars.idempotencyKey =
    idempotencyKey('request');

  return done();
}

/**
 * Generate a contribution-specific idempotency key.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function generateContributionIdempotencyKey(
  context,
  events,
  done
) {
  context.vars = context.vars || {};

  context.vars.contributionIdempotencyKey =
    idempotencyKey('contribution');

  return done();
}

/**
 * Generate a payment-specific idempotency key.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function generatePaymentIdempotencyKey(
  context,
  events,
  done
) {
  context.vars = context.vars || {};

  context.vars.paymentIdempotencyKey =
    idempotencyKey('payment');

  return done();
}

// ============================================================================
// Lightweight Metrics
// ============================================================================

/**
 * Increment a custom Artillery counter when the event emitter supports it.
 *
 * @param {object} events
 * @param {string} metric
 * @param {number} value
 */
function incrementMetric(
  events,
  metric,
  value = 1
) {
  if (
    events &&
    typeof events.emit === 'function'
  ) {
    events.emit(
      'counter',
      metric,
      value
    );
  }
}

/**
 * Record request latency in an Artillery metric when supported.
 *
 * @param {object} requestParams
 * @param {object} response
 * @param {object} context
 * @param {object} events
 * @param {Function} next
 * @returns {*}
 */
function recordResponseMetrics(
  requestParams,
  response,
  context,
  events,
  next
) {
  const statusCode =
    Number(response?.statusCode) || 0;

  if (statusCode >= 500) {
    incrementMetric(
      events,
      'titech.http.server_errors'
    );
  } else if (statusCode >= 400) {
    incrementMetric(
      events,
      'titech.http.client_errors'
    );
  } else {
    incrementMetric(
      events,
      'titech.http.success'
    );
  }

  return next();
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that the load-test group is configured.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function validateGroupConfiguration(
  context,
  events,
  done
) {
  context.vars = context.vars || {};

  const groupId =
    context.vars.groupId ||
    process.env.LOAD_TEST_GROUP_ID ||
    '';

  if (!groupId) {
    return done(
      new Error(
        'LOAD_TEST_GROUP_ID must be configured for scenarios that require a group.'
      )
    );
  }

  context.vars.groupId =
    groupId;

  return done();
}

/**
 * Validate canonical phone configuration.
 *
 * @param {object} context
 * @param {object} events
 * @param {Function} done
 * @returns {*}
 */
function validatePhoneConfiguration(
  context,
  events,
  done
) {
  context.vars = context.vars || {};

  const phone =
    context.vars.phone ||
    getTestPhone();

  if (
    typeof phone !== 'string' ||
    !/^\+256\d{9}$/.test(phone)
  ) {
    return done(
      new Error(
        `Invalid TITech load-test phone number: ${phone}`
      )
    );
  }

  context.vars.phone =
    phone;

  return done();
}

// ============================================================================
// Exported Processor API
// ============================================================================

module.exports = {
  // Lifecycle
  setup,
  teardown,

  // Existing helper compatibility
  phoneNumber,
  extractAuthToken,
  beforeRequest,
  afterResponse,

  // Dynamic data
  groupName,
  generateCorrelationId,
  generateIdempotencyKey,
  generateContributionIdempotencyKey,
  generatePaymentIdempotencyKey,

  // Metrics
  recordResponseMetrics,

  // Validation
  validateGroupConfiguration,
  validatePhoneConfiguration,
};