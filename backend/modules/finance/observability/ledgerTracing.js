'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Ledger Tracing / Financial Observability
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/observability/ledgerTracing.js
 *
 * Purpose:
 *   Enterprise-grade distributed tracing utilities for the immutable financial
 *   ledger, journal posting, reversals, balances, reconciliation and
 *   settlement pipelines.
 *
 * Architecture:
 *
 *   Finance Service
 *        |
 *        v
 *   Ledger Tracing
 *        |
 *        +---- OpenTelemetry API
 *        |
 *        +---- Application Tracer (optional)
 *        |
 *        +---- Structured Logger (optional)
 *        |
 *        +---- Metrics (optional)
 *
 * IMPORTANT:
 *
 *   This module intentionally does NOT initialize:
 *
 *     - NodeSDK
 *     - TracerProvider
 *     - exporters
 *     - span processors
 *     - global propagators
 *
 *   Application-wide observability bootstrap owns that lifecycle.
 *
 * Enterprise guarantees:
 *
 *   - Tracing never becomes a financial dependency.
 *   - Financial business errors are never swallowed.
 *   - OpenTelemetry remains optional.
 *   - No-op tracing is supported.
 *   - Async context propagation is preserved.
 *   - Tenant/correlation/request/transaction identity is supported.
 *   - Idempotency identifiers are hashed before telemetry emission.
 *   - Sensitive financial payloads are filtered.
 *   - High-cardinality data is bounded.
 *   - Manual and automatic span lifecycle are supported.
 *   - Parent/child spans are supported.
 *   - Runtime enable/disable is supported.
 *   - Diagnostics are available for production operations.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Optional OpenTelemetry API
 * ========================================================================== */

let otel = null;

try {
  // eslint-disable-next-line global-require
  otel = require('@opentelemetry/api');
} catch (_error) {
  otel = null;
}

/* ============================================================================
 * Constants
 * ========================================================================== */

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-ledger';

const INSTRUMENTATION_NAME =
  process.env.OTEL_INSTRUMENTATION_NAME ||
  'titech-community-capital/ledger';

const INSTRUMENTATION_VERSION =
  process.env.APP_VERSION ||
  process.env.npm_package_version ||
  '1.0.0';

const ENVIRONMENT =
  process.env.NODE_ENV ||
  process.env.APP_ENV ||
  'development';

const DEFAULT_MAX_ATTRIBUTE_LENGTH = 512;
const DEFAULT_MAX_EVENT_ATTRIBUTE_LENGTH = 512;
const DEFAULT_MAX_ARRAY_ITEMS = 20;

const TRACE_ENABLED =
  parseBoolean(
    process.env.LEDGER_TRACING_ENABLED,
    true
  ) &&
  !parseBoolean(
    process.env.OTEL_SDK_DISABLED,
    false
  );

const RECORD_SENSITIVE_DATA =
  parseBoolean(
    process.env.LEDGER_TRACE_SENSITIVE_DATA,
    false
  );

const INCLUDE_HIGH_CARDINALITY =
  parseBoolean(
    process.env.LEDGER_TRACE_HIGH_CARDINALITY,
    false
  );

const MAX_ATTRIBUTE_LENGTH =
  parsePositiveInteger(
    process.env.LEDGER_TRACE_MAX_ATTRIBUTE_LENGTH,
    DEFAULT_MAX_ATTRIBUTE_LENGTH
  );

const MAX_EVENT_ATTRIBUTE_LENGTH =
  parsePositiveInteger(
    process.env.LEDGER_TRACE_MAX_EVENT_ATTRIBUTE_LENGTH,
    DEFAULT_MAX_EVENT_ATTRIBUTE_LENGTH
  );

const MAX_ARRAY_ITEMS =
  parsePositiveInteger(
    process.env.LEDGER_TRACE_MAX_ARRAY_ITEMS,
    DEFAULT_MAX_ARRAY_ITEMS
  );

const AUTO_HASH_IDENTIFIERS =
  parseBoolean(
    process.env.LEDGER_TRACE_HASH_IDENTIFIERS,
    true
  );

const DEFAULT_TIMEOUT_MS =
  parsePositiveInteger(
    process.env.LEDGER_TRACE_DEFAULT_TIMEOUT_MS,
    0
  );

/* ============================================================================
 * OpenTelemetry constants / safe fallbacks
 * ========================================================================== */

const SpanStatusCode =
  otel?.SpanStatusCode || {
    UNSET: 0,
    OK: 1,
    ERROR: 2
  };

const SpanKind =
  otel?.SpanKind || {
    INTERNAL: 0,
    SERVER: 1,
    CLIENT: 2,
    PRODUCER: 3,
    CONSUMER: 4
  };

/* ============================================================================
 * Configuration state
 * ========================================================================== */

let configuredTracer = null;
let configuredLogger = null;
let configuredMetrics = null;
let tracer = null;

let configuredConfig = {
  serviceName:
    SERVICE_NAME,

  instrumentationName:
    INSTRUMENTATION_NAME,

  instrumentationVersion:
    INSTRUMENTATION_VERSION,

  environment:
    ENVIRONMENT,

  enabled:
    TRACE_ENABLED,

  recordSensitiveData:
    RECORD_SENSITIVE_DATA,

  includeHighCardinality:
    INCLUDE_HIGH_CARDINALITY,

  maxAttributeLength:
    MAX_ATTRIBUTE_LENGTH,

  maxEventAttributeLength:
    MAX_EVENT_ATTRIBUTE_LENGTH,

  maxArrayItems:
    MAX_ARRAY_ITEMS,

  hashIdentifiers:
    AUTO_HASH_IDENTIFIERS,

  defaultTimeoutMs:
    DEFAULT_TIMEOUT_MS,

  failOpen: true,

  tenantAware: true,

  correlationAware: true,

  propagationEnabled: true
};

/* ============================================================================
 * Statistics
 * ========================================================================== */

const statistics = {
  spansStarted: 0,
  spansEnded: 0,
  spansFailed: 0,
  spanStartFailures: 0,
  spanEndFailures: 0,
  attributeFailures: 0,
  eventFailures: 0,
  propagationFailures: 0,
  timeoutCount: 0,
  noOpSpans: 0
};

/* ============================================================================
 * Utility functions
 * ========================================================================== */

function parseBoolean(value, fallback) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      'true',
      '1',
      'yes',
      'on',
      'enabled'
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      'false',
      '0',
      'no',
      'off',
      'disabled'
    ].includes(normalized)
  ) {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(
  value,
  fallback
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

function generateId() {
  if (
    typeof crypto.randomUUID ===
    'function'
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now().toString(16),
    Math.random()
      .toString(16)
      .slice(2)
  ].join('-');
}

function isPromiseLike(value) {
  return Boolean(
    value &&
      typeof value.then ===
        'function'
  );
}

function truncate(
  value,
  maxLength =
    configuredConfig.maxAttributeLength
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  const stringValue =
    String(value);

  if (
    stringValue.length <=
    maxLength
  ) {
    return stringValue;
  }

  return `${stringValue.slice(
    0,
    Math.max(
      0,
      maxLength - 3
    )
  )}...`;
}

function normalizeId(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  return truncate(
    String(value),
    configuredConfig.maxAttributeLength
  );
}

function normalizeOperationName(
  operationName
) {
  if (!operationName) {
    return 'ledger.operation';
  }

  const normalized =
    String(operationName)
      .trim()
      .replace(/\s+/g, '.')
      .replace(
        /[^a-zA-Z0-9._:-]/g,
        ''
      )
      .slice(0, 200);

  return (
    normalized ||
    'ledger.operation'
  );
}

function safeErrorName(error) {
  if (!error) {
    return undefined;
  }

  return truncate(
    error.name ||
      'Error',
    128
  );
}

function safeErrorMessage(error) {
  if (!error) {
    return undefined;
  }

  return truncate(
    error instanceof Error
      ? error.message
      : String(error),
    configuredConfig.maxAttributeLength
  );
}

function nowNs() {
  if (
    typeof process.hrtime.bigint ===
    'function'
  ) {
    return process.hrtime.bigint();
  }

  return (
    BigInt(Date.now()) *
    BigInt(1_000_000)
  );
}

function durationMilliseconds(
  startNs
) {
  if (startNs === undefined) {
    return undefined;
  }

  try {
    return (
      Number(
        nowNs() - startNs
      ) / 1_000_000
    );
  } catch (_error) {
    return undefined;
  }
}

function isSensitiveKey(key) {
  const normalized =
    String(key || '');

  return [
    /password/i,
    /passcode/i,
    /secret/i,
    /private.?key/i,
    /access.?token/i,
    /refresh.?token/i,
    /authorization/i,
    /cookie/i,
    /session/i,
    /credential/i,
    /signature/i,
    /otp/i,
    /pin/i,
    /cvv/i,
    /security.?code/i,
    /card.?number/i,
    /account.?password/i,
    /national.?id/i,
    /identity.?number/i
  ].some(pattern =>
    pattern.test(normalized)
  );
}

function isHighCardinalityKey(key) {
  const normalized =
    String(key || '')
      .toLowerCase();

  return [
    'rawpayload',
    'requestbody',
    'responsebody',
    'stack',
    'fullstack',
    'query',
    'document',
    'documents',
    'metadata',
    'headers',
    'email',
    'phone',
    'address',
    'entries',
    'transactions',
    'records',
    'items'
  ].some(
    restricted =>
      normalized.includes(
        restricted
      )
  );
}

function serializeAttributeValue(
  value,
  maxLength =
    configuredConfig.maxAttributeLength
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    return truncate(
      value,
      maxLength
    );
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    value instanceof Error
  ) {
    return truncate(
      value.message,
      maxLength
    );
  }

  if (Array.isArray(value)) {
    return value
      .slice(
        0,
        configuredConfig
          .maxArrayItems
      )
      .map(item =>
        serializeAttributeValue(
          item,
          maxLength
        )
      );
  }

  try {
    return truncate(
      JSON.stringify(
        value
      ),
      maxLength
    );
  } catch (_error) {
    return '[unserializable]';
  }
}

function filterAttributes(
  attributes = {},
  options = {}
) {
  const result = {};

  if (
    !attributes ||
    typeof attributes !==
      'object'
  ) {
    return result;
  }

  const allowSensitive =
    options.allowSensitive === true &&
    configuredConfig.recordSensitiveData ===
      true;

  for (
    const [key, rawValue] of
    Object.entries(attributes)
  ) {
    if (!key) {
      continue;
    }

    if (
      isSensitiveKey(key) &&
      !allowSensitive
    ) {
      continue;
    }

    if (
      configuredConfig
        .includeHighCardinality ===
        false &&
      isHighCardinalityKey(key)
    ) {
      continue;
    }

    const value =
      serializeAttributeValue(
        rawValue,
        options.event
          ? configuredConfig
              .maxEventAttributeLength
          : configuredConfig
              .maxAttributeLength
      );

    if (
      value !== undefined
    ) {
      result[
        truncate(key, 128)
      ] = value;
    }
  }

  return result;
}

function hashIdentifier(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  if (
    !configuredConfig
      .hashIdentifiers
  ) {
    return normalizeId(
      value
    );
  }

  try {
    return crypto
      .createHash('sha256')
      .update(
        String(value),
        'utf8'
      )
      .digest('hex');
  } catch (_error) {
    return normalizeId(
      value
    );
  }
}

/* ============================================================================
 * No-op span
 * ========================================================================== */

class NoopSpan {
  constructor(
    name = 'ledger.operation'
  ) {
    this.name = name;

    this._ended = false;
    this._attributes = {};
    this._events = [];

    this._status = {
      code:
        SpanStatusCode.UNSET
    };
  }

  setAttribute(
    key,
    value
  ) {
    if (key) {
      this._attributes[
        key
      ] = value;
    }

    return this;
  }

  setAttributes(
    attributes
  ) {
    if (
      attributes &&
      typeof attributes ===
        'object'
    ) {
      Object.assign(
        this._attributes,
        attributes
      );
    }

    return this;
  }

  addEvent(
    name,
    attributes
  ) {
    this._events.push({
      name,
      attributes:
        attributes || {},
      timestamp:
        new Date()
    });

    return this;
  }

  setStatus(
    status
  ) {
    this._status =
      status || {
        code:
          SpanStatusCode.UNSET
      };

    return this;
  }

  recordException() {
    return this;
  }

  updateName(
    name
  ) {
    this.name =
      name || this.name;

    return this;
  }

  end() {
    this._ended = true;
  }

  isRecording() {
    return false;
  }

  spanContext() {
    return {
      traceId: '',
      spanId: '',
      traceFlags: 0,
      isRemote: false
    };
  }
}

/* ============================================================================
 * Tracer initialization
 * ========================================================================== */

function getTracer() {
  if (configuredTracer) {
    return configuredTracer;
  }

  if (
    !configuredConfig.enabled
  ) {
    return null;
  }

  if (
    otel &&
    otel.trace &&
    typeof otel.trace
      .getTracer ===
      'function'
  ) {
    try {
      tracer =
        otel.trace.getTracer(
          configuredConfig
            .instrumentationName,
          configuredConfig
            .instrumentationVersion
        );

      return tracer;
    } catch (error) {
      safeLog(
        'warn',
        'Failed to obtain OpenTelemetry tracer',
        error
      );
    }
  }

  return null;
}

/* ============================================================================
 * Configuration
 * ========================================================================== */

function configure(
  options = {}
) {
  if (
    !options ||
    typeof options !==
      'object'
  ) {
    return getConfig();
  }

  configuredConfig = {
    ...configuredConfig,
    ...options
  };

  if (
    options.tracer !== undefined
  ) {
    configuredTracer =
      options.tracer || null;

    tracer =
      options.tracer || null;
  }

  if (
    options.logger !== undefined
  ) {
    configuredLogger =
      options.logger || null;
  }

  if (
    options.metrics !== undefined
  ) {
    configuredMetrics =
      options.metrics || null;
  }

  return getConfig();
}

function getConfig() {
  return {
    ...configuredConfig,

    tracingApiAvailable:
      Boolean(otel),

    tracerConfigured:
      Boolean(
        configuredTracer ||
          tracer
      ),

    loggerConfigured:
      Boolean(
        configuredLogger
      ),

    metricsConfigured:
      Boolean(
        configuredMetrics
      )
  };
}

/* ============================================================================
 * Logging
 * ========================================================================== */

function safeLog(
  level,
  message,
  error,
  meta = {}
) {
  try {
    if (configuredLogger) {
      const method =
        typeof configuredLogger[
          level
        ] === 'function'
          ? configuredLogger[
              level
            ].bind(
              configuredLogger
            )
          : typeof configuredLogger.log ===
              'function'
            ? configuredLogger.log.bind(
                configuredLogger
              )
            : null;

      if (method) {
        method(
          message,
          {
            ...meta,
            error:
              error instanceof
              Error
                ? error.message
                : error
          }
        );

        return;
      }
    }

    if (
      parseBoolean(
        process.env
          .LEDGER_TRACING_LOG_ERRORS,
        process.env.NODE_ENV !==
          'test'
      )
    ) {
      const payload = {
        ...meta,
        error:
          error instanceof
          Error
            ? error.message
            : error
      };

      const method =
        level === 'error'
          ? console.error
          : console.warn;

      method(
        `[ledgerTracing] ${message}`,
        payload
      );
    }
  } catch (_error) {
    /*
     * Logging must never become a business-path failure.
     */
  }
}

/* ============================================================================
 * Metrics
 * ========================================================================== */

function incrementMetric(
  name,
  labels = {}
) {
  if (!configuredMetrics) {
    return;
  }

  try {
    if (
      typeof configuredMetrics
        .increment ===
      'function'
    ) {
      configuredMetrics.increment(
        name,
        labels
      );

      return;
    }

    if (
      typeof configuredMetrics.inc ===
      'function'
    ) {
      configuredMetrics.inc(
        name,
        labels
      );
    }
  } catch (error) {
    safeLog(
      'warn',
      `Failed to increment metric: ${name}`,
      error
    );
  }
}

/* ============================================================================
 * OpenTelemetry Context
 * ========================================================================== */

function getActiveContext() {
  if (
    otel &&
    otel.context &&
    typeof otel.context
      .active ===
      'function'
  ) {
    try {
      return otel.context.active();
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function getActiveSpan() {
  if (
    otel &&
    otel.trace &&
    typeof otel.trace
      .getActiveSpan ===
      'function'
  ) {
    try {
      return (
        otel.trace
          .getActiveSpan() ||
        null
      );
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function getActiveSpanContext() {
  const activeSpan =
    getActiveSpan();

  if (
    !activeSpan ||
    typeof activeSpan
      .spanContext !==
      'function'
  ) {
    return null;
  }

  try {
    return (
      activeSpan.spanContext() ||
      null
    );
  } catch (_error) {
    return null;
  }
}

function getTraceId() {
  return (
    getActiveSpanContext()
      ?.traceId ||
    undefined
  );
}

function getSpanId() {
  return (
    getActiveSpanContext()
      ?.spanId ||
    undefined
  );
}

/* ============================================================================
 * Context propagation
 * ========================================================================== */

function injectContext(
  carrier = {},
  span = null
) {
  const target =
    carrier || {};

  if (
    !configuredConfig
      .propagationEnabled
  ) {
    return target;
  }

  if (
    otel &&
    otel.propagation &&
    typeof otel.propagation
      .inject ===
      'function'
  ) {
    try {
      let context =
        getActiveContext();

      if (
        span &&
        otel.trace &&
        typeof otel.trace
          .setSpan ===
          'function'
      ) {
        context =
          otel.trace.setSpan(
            context ||
              otel.context.active(),
            span
          );
      }

      otel.propagation.inject(
        context ||
          otel.context.active(),
        target
      );

      return target;
    } catch (error) {
      statistics
        .propagationFailures++;

      safeLog(
        'warn',
        'Failed to inject ledger trace context',
        error
      );
    }
  }

  return target;
}

function extractContext(
  carrier
) {
  if (
    !configuredConfig
      .propagationEnabled ||
    !carrier ||
    !otel ||
    !otel.propagation ||
    typeof otel.propagation
      .extract !==
      'function'
  ) {
    return null;
  }

  try {
    return otel.propagation.extract(
      otel.context.active(),
      carrier
    );
  } catch (error) {
    statistics
      .propagationFailures++;

    safeLog(
      'warn',
      'Failed to extract ledger trace context',
      error
    );

    return null;
  }
}

function getTraceHeaders(
  span = null
) {
  return injectContext(
    {},
    span
  );
}

/* ============================================================================
 * Ledger attribute normalization
 * ========================================================================== */

function buildLedgerAttributes(
  metadata = {}
) {
  const normalized =
    metadata || {};

  const attributes = {
    'service.name':
      configuredConfig.serviceName,

    'service.version':
      configuredConfig
        .instrumentationVersion,

    'deployment.environment.name':
      configuredConfig.environment,

    'ledger.component':
      normalizeId(
        normalized.component ||
          normalized.ledgerComponent ||
          'ledger'
      ),

    'ledger.operation':
      normalizeOperationName(
        normalized.operation ||
          normalized.operationName ||
          'ledger.operation'
      ),

    'ledger.transaction.id':
      normalizeId(
        normalized.transactionId ||
          normalized.transaction_id
      ),

    'ledger.journal.id':
      normalizeId(
        normalized.journalId ||
          normalized.journal_id
      ),

    'ledger.account.id':
      normalizeId(
        normalized.accountId ||
          normalized.account_id
      ),

    'ledger.entry.id':
      normalizeId(
        normalized.entryId ||
          normalized.entry_id
      ),

    'ledger.correlation.id':
      normalizeId(
        normalized.correlationId ||
          normalized.correlation_id
      ),

    'ledger.request.id':
      normalizeId(
        normalized.requestId ||
          normalized.request_id
      ),

    /*
     * Never expose an idempotency key in cleartext by default.
     */
    'ledger.idempotency.key':
      hashIdentifier(
        normalized.idempotencyKey ||
          normalized.idempotency_key
      ),

    'ledger.operation.key':
      hashIdentifier(
        normalized.operationKey ||
          normalized.operation_key
      ),

    'ledger.tenant.id':
      normalizeId(
        normalized.tenantId ||
          normalized.tenant_id
      ),

    'ledger.user.id':
      normalizeId(
        normalized.userId ||
          normalized.user_id
      ),

    'ledger.actor.type':
      normalizeId(
        normalized.actorType ||
          normalized.actor_type
      ),

    'ledger.provider':
      normalizeId(
        normalized.provider
      ),

    'ledger.currency':
      normalizeId(
        normalized.currency ||
          normalized.currencyCode
      ),

    'ledger.product':
      normalizeId(
        normalized.product ||
          normalized.loanProduct
      ),

    'ledger.financial.period':
      normalizeId(
        normalized.financialPeriod ||
          normalized.period
      ),

    'ledger.reversal.type':
      normalizeId(
        normalized.reversalType
      ),

    'ledger.reversal.reason':
      normalizeId(
        normalized.reversalReason
      ),

    'ledger.source':
      normalizeId(
        normalized.source
      ),

    'ledger.status':
      normalizeId(
        normalized.status
      )
  };

  const cleaned = {};

  for (
    const [key, value] of
    Object.entries(
      attributes
    )
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      cleaned[key] = value;
    }
  }

  const custom =
    filterAttributes(
      normalized.attributes ||
        normalized.tags ||
        {}
    );

  return {
    ...cleaned,
    ...custom
  };
}

/* ============================================================================
 * Span enrichment
 * ========================================================================== */

function setAttributes(
  span,
  attributes = {},
  options = {}
) {
  if (
    !span ||
    typeof span.setAttribute !==
      'function'
  ) {
    return span;
  }

  const safeAttributes =
    filterAttributes(
      attributes,
      options
    );

  try {
    if (
      typeof span.setAttributes ===
      'function'
    ) {
      span.setAttributes(
        safeAttributes
      );
    } else {
      for (
        const [key, value] of
        Object.entries(
          safeAttributes
        )
      ) {
        span.setAttribute(
          key,
          value
        );
      }
    }
  } catch (error) {
    safeLog(
      'warn',
      'Failed to set ledger span attributes',
      error
    );

    incrementMetric(
      'ledger_tracing_attribute_failures_total'
    );
  }

  return span;
}

function addEvent(
  span,
  eventName,
  attributes = {}
) {
  if (
    !span ||
    typeof span.addEvent !==
      'function' ||
    !eventName
  ) {
    return span;
  }

  try {
    span.addEvent(
      truncate(
        String(eventName),
        200
      ),
      filterAttributes(
        attributes,
        {
          event: true
        }
      )
    );
  } catch (error) {
    statistics
      .eventFailures++;

    safeLog(
      'warn',
      `Failed to add ledger trace event: ${eventName}`,
      error
    );

    incrementMetric(
      'ledger_tracing_event_failures_total'
    );
  }

  return span;
}

/* ============================================================================
 * Span status / exception
 * ========================================================================== */

function recordException(
  span,
  error,
  additionalAttributes = {}
) {
  if (
    !span ||
    !error
  ) {
    return span;
  }

  try {
    if (
      typeof span.recordException ===
      'function'
    ) {
      span.recordException(
        error
      );
    }

    setAttributes(
      span,
      {
        'error.type':
          safeErrorName(error),

        'error.message':
          safeErrorMessage(error),

        'ledger.error.code':
          normalizeId(
            error?.code
          ),

        ...additionalAttributes
      }
    );

    if (
      typeof span.setStatus ===
      'function'
    ) {
      span.setStatus({
        code:
          SpanStatusCode.ERROR,

        message:
          safeErrorMessage(
            error
          )
      });
    }
  } catch (traceError) {
    safeLog(
      'warn',
      'Failed to record ledger tracing exception',
      traceError
    );
  }

  return span;
}

function markSuccess(
  span,
  attributes = {}
) {
  if (!span) {
    return span;
  }

  try {
    if (
      typeof span.setStatus ===
      'function'
    ) {
      span.setStatus({
        code:
          SpanStatusCode.OK
      });
    }

    setAttributes(
      span,
      {
        'ledger.result':
          'success',
        ...attributes
      }
    );
  } catch (error) {
    safeLog(
      'warn',
      'Failed to mark ledger span successful',
      error
    );
  }

  return span;
}

function markFailure(
  span,
  error,
  attributes = {}
) {
  if (!span) {
    return span;
  }

  recordException(
    span,
    error,
    {
      'ledger.result':
        'failure',
      ...attributes
    }
  );

  return span;
}

/* ============================================================================
 * Span creation
 * ========================================================================== */

function startSpan(
  operationName,
  metadata = {},
  options = {}
) {
  const name =
    normalizeOperationName(
      operationName
    );

  const correlationId =
    normalizeId(
      metadata.correlationId ||
        metadata.correlation_id
    ) ||
    generateId();

  const attributes =
    buildLedgerAttributes({
      ...metadata,
      correlationId,
      operation: name
    });

  const requestedSpanKind =
    options.kind !== undefined
      ? options.kind
      : SpanKind.INTERNAL;

  const tracerInstance =
    options.tracer ||
    getTracer();

  if (
    !configuredConfig.enabled ||
    !tracerInstance ||
    typeof tracerInstance
      .startSpan !==
      'function'
  ) {
    statistics.noOpSpans++;

    const fallbackSpan =
      new NoopSpan(name);

    setAttributes(
      fallbackSpan,
      attributes,
      options
    );

    return {
      span: fallbackSpan,

      context: null,

      startedAt:
        nowNs(),

      tracingEnabled:
        false,

      generatedCorrelationId:
        correlationId,

      operationName: name,

      ended: false
    };
  }

  try {
    const span =
      tracerInstance.startSpan(
        name,
        {
          ...options,

          kind:
            requestedSpanKind,

          attributes
        },

        options.parentContext ||
          undefined
      );

    statistics.spansStarted++;

    const context =
      otel?.trace?.setSpan
        ? otel.trace.setSpan(
            getActiveContext() ||
              otel.context.active(),
            span
          )
        : null;

    return {
      span,

      context,

      startedAt:
        nowNs(),

      tracingEnabled:
        true,

      generatedCorrelationId:
        correlationId,

      operationName: name,

      ended: false
    };
  } catch (error) {
    statistics
      .spanStartFailures++;

    safeLog(
      'warn',
      `Failed to start ledger span: ${name}`,
      error
    );

    incrementMetric(
      'ledger_tracing_span_start_failures_total',
      {
        operation: name
      }
    );

    statistics.noOpSpans++;

    const fallbackSpan =
      new NoopSpan(name);

    setAttributes(
      fallbackSpan,
      attributes,
      options
    );

    return {
      span:
        fallbackSpan,

      context: null,

      startedAt:
        nowNs(),

      tracingEnabled:
        false,

      generatedCorrelationId:
        correlationId,

      operationName: name,

      ended: false
    };
  }
}

/* ============================================================================
 * End span
 * ========================================================================== */

function endSpan(
  spanHandle,
  {
    error,
    result,
    durationMs,
    attributes = {}
  } = {}
) {
  if (
    !spanHandle ||
    !spanHandle.span ||
    spanHandle.ended
  ) {
    return;
  }

  spanHandle.ended = true;

  const span =
    spanHandle.span;

  try {
    const measuredDuration =
      durationMs !== undefined
        ? Number(
            durationMs
          )
        : durationMilliseconds(
            spanHandle.startedAt
          );

    if (
      measuredDuration !==
        undefined &&
      Number.isFinite(
        measuredDuration
      )
    ) {
      setAttributes(
        span,
        {
          'ledger.duration_ms':
            Number(
              measuredDuration.toFixed(
                3
              )
            ),

          ...attributes
        }
      );
    } else {
      setAttributes(
        span,
        attributes
      );
    }

    if (error) {
      statistics.spansFailed++;

      markFailure(
        span,
        error
      );
    } else {
      markSuccess(
        span,
        {
          'ledger.result.present':
            result !== undefined
        }
      );
    }

    incrementMetric(
      'ledger_tracing_spans_completed_total',
      {
        operation:
          spanHandle.operationName ||
          'ledger.operation',

        status:
          error
            ? 'error'
            : 'success'
      }
    );
  } catch (errorHandlingFailure) {
    safeLog(
      'warn',
      'Failed to finalize ledger tracing metadata',
      errorHandlingFailure
    );
  } finally {
    try {
      if (
        typeof span.end ===
        'function'
      ) {
        span.end();
      }

      statistics.spansEnded++;
    } catch (error) {
      statistics
        .spanEndFailures++;

      safeLog(
        'warn',
        'Failed to end ledger tracing span',
        error
      );

      incrementMetric(
        'ledger_tracing_span_end_failures_total'
      );
    }
  }
}

/* ============================================================================
 * withSpan
 * ========================================================================== */

function withSpan(
  operationName,
  metadata,
  handler,
  options = {}
) {
  if (
    typeof metadata ===
    'function'
  ) {
    options =
      handler || {};

    handler =
      metadata;

    metadata = {};
  }

  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      'ledgerTracing.withSpan requires a handler function'
    );
  }

  const spanHandle =
    startSpan(
      operationName,
      metadata || {},
      options || {}
    );

  const span =
    spanHandle.span;

  const invoke =
    () => {
      try {
        return handler(
          span,
          {
            ...metadata,

            correlationId:
              spanHandle
                .generatedCorrelationId,

            traceId:
              getTraceId(),

            spanId:
              getSpanId()
          }
        );
      } catch (error) {
        endSpan(
          spanHandle,
          {
            error
          }
        );

        throw error;
      }
    };

  let result;

  try {
    if (
      spanHandle.context &&
      otel?.context?.with
    ) {
      result =
        otel.context.with(
          spanHandle.context,
          invoke
        );
    } else {
      result = invoke();
    }
  } catch (error) {
    throw error;
  }

  if (
    isPromiseLike(result)
  ) {
    return result
      .then(value => {

        endSpan(
          spanHandle,
          {
            result: value
          }
        );

        return value;
      })
      .catch(error => {

        endSpan(
          spanHandle,
          {
            error
          }
        );

        throw error;
      });
  }

  endSpan(
    spanHandle,
    {
      result
    }
  );

  return result;
}

/* ============================================================================
 * Timeout wrapper
 * ========================================================================== */

function withTimeout(
  promise,
  timeoutMs,
  onTimeout
) {
  if (
    !isPromiseLike(promise) ||
    !timeoutMs ||
    timeoutMs <= 0
  ) {
    return promise;
  }

  let timer;

  const timeoutPromise =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            try {
              if (
                typeof onTimeout ===
                'function'
              ) {
                onTimeout();
              }
            } catch (_error) {
              // Timeout notification must not mask the timeout itself.
            }

            const error =
              new Error(
                `Ledger operation timed out after ${timeoutMs}ms`
              );

            error.code =
              'LEDGER_TRACE_TIMEOUT';

            reject(error);
          },
          timeoutMs
        );

        if (
          typeof timer?.unref ===
          'function'
        ) {
          timer.unref();
        }
      }
    );

  return Promise.race([
    Promise.resolve(
      promise
    ).finally(() => {
      clearTimeout(
        timer
      );
    }),

    timeoutPromise
  ]);
}

/* ============================================================================
 * Specialized tracing helpers
 * ========================================================================== */

function traceLedgerOperation(
  operation,
  metadata,
  handler,
  options = {}
) {
  const normalized =
    normalizeOperationName(
      operation
    );

  const operationName =
    normalized.startsWith(
      'ledger.'
    )
      ? normalized
      : `ledger.${normalized}`;

  return executeWithOptionalTimeout(
    operationName,
    {
      ...metadata,
      component:
        metadata?.component ||
        'ledger'
    },
    handler,
    options
  );
}

function executeWithOptionalTimeout(
  operationName,
  metadata,
  handler,
  options = {}
) {
  const execute =
    () =>
      withSpan(
        operationName,
        metadata,
        handler,
        options
      );

  const result =
    execute();

  const timeoutMs =
    options.timeoutMs ??
    configuredConfig.defaultTimeoutMs;

  if (
    isPromiseLike(result) &&
    timeoutMs > 0
  ) {
    return withTimeout(
      result,
      timeoutMs,
      () => {
        statistics.timeoutCount++;

        const span =
          getActiveSpan();

        addEvent(
          span,
          'ledger.timeout',
          {
            operation:
              operationName,

            timeoutMs
          }
        );

        incrementMetric(
          'ledger_tracing_timeout_total',
          {
            operation:
              operationName
          }
        );
      }
    );
  }

  return result;
}

function traceJournalPost(
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    'postJournal',
    metadata,
    handler,
    options
  );
}

function traceJournalEntry(
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    'postJournalEntry',
    metadata,
    handler,
    options
  );
}

function traceAccountOperation(
  operation,
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    `account.${operation}`,
    metadata,
    handler,
    options
  );
}

function traceTransactionOperation(
  operation,
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    `transaction.${operation}`,
    metadata,
    handler,
    options
  );
}

function traceReversal(
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    'reverseTransaction',
    {
      ...metadata,
      component:
        'reversal'
    },
    handler,
    options
  );
}

function traceBalanceOperation(
  operation,
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    `balance.${operation}`,
    {
      ...metadata,
      component:
        'balance'
    },
    handler,
    options
  );
}

function traceReconciliation(
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    'reconciliation',
    {
      ...metadata,
      component:
        'reconciliation'
    },
    handler,
    options
  );
}

function traceSettlement(
  metadata,
  handler,
  options = {}
) {
  return traceLedgerOperation(
    'settlement',
    {
      ...metadata,
      component:
        'settlement'
    },
    handler,
    options
  );
}

/* ============================================================================
 * Child span
 * ========================================================================== */

function traceChild(
  parentSpan,
  operationName,
  metadata,
  handler,
  options = {}
) {
  if (
    typeof metadata ===
    'function'
  ) {
    options =
      handler || {};

    handler =
      metadata;

    metadata = {};
  }

  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      'ledgerTracing.traceChild requires a handler function'
    );
  }

  let parentContext =
    options.parentContext ||
    null;

  if (
    !parentContext &&
    parentSpan &&
    otel?.trace?.setSpan
  ) {
    parentContext =
      otel.trace.setSpan(
        getActiveContext() ||
          otel.context.active(),
        parentSpan
      );
  }

  return withSpan(
    operationName,
    {
      ...metadata,

      parentSpanId:
        getSpanIdFromSpan(
          parentSpan
        )
    },
    handler,
    {
      ...options,
      parentContext
    }
  );
}

function getSpanIdFromSpan(
  span
) {
  if (
    !span ||
    typeof span.spanContext !==
      'function'
  ) {
    return undefined;
  }

  try {
    return span
      .spanContext()
      ?.spanId;
  } catch (_error) {
    return undefined;
  }
}

/* ============================================================================
 * Financial lifecycle helpers
 * ========================================================================== */

function markPostingStarted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'ledger.lifecycle':
        'posting',

      'ledger.posting.state':
        'started',

      ...buildLedgerAttributes(
        metadata
      )
    }
  );

  return addEvent(
    span,
    'ledger.posting.started',
    metadata
  );
}

function markPostingValidated(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'ledger.posting.state':
        'validated',

      ...buildLedgerAttributes(
        metadata
      )
    }
  );

  return addEvent(
    span,
    'ledger.posting.validated',
    metadata
  );
}

function markPostingCommitted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'ledger.posting.state':
        'committed',

      ...buildLedgerAttributes(
        metadata
      )
    }
  );

  return addEvent(
    span,
    'ledger.posting.committed',
    metadata
  );
}

function markPostingRejected(
  span,
  error,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'ledger.posting.state':
        'rejected',

      ...buildLedgerAttributes(
        metadata
      )
    }
  );

  addEvent(
    span,
    'ledger.posting.rejected',
    {
      reason:
        safeErrorMessage(
          error
        ),

      ...metadata
    }
  );

  return markFailure(
    span,
    error
  );
}

function markReversalStarted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'ledger.reversal.state':
        'started',

      ...buildLedgerAttributes(
        metadata
      )
    }
  );

  return addEvent(
    span,
    'ledger.reversal.started',
    metadata
  );
}

function markReversalCommitted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'ledger.reversal.state':
        'committed',

      ...buildLedgerAttributes(
        metadata
      )
    }
  );

  return addEvent(
    span,
    'ledger.reversal.committed',
    metadata
  );
}

/* ============================================================================
 * Idempotency telemetry
 * ========================================================================== */

function markIdempotencyHit(
  span,
  idempotencyKey,
  metadata = {}
) {
  return addEvent(
    span,
    'ledger.idempotency.hit',
    {
      idempotencyKey:
        hashIdentifier(
          idempotencyKey
        ),

      ...metadata
    }
  );
}

function markIdempotencyMiss(
  span,
  idempotencyKey,
  metadata = {}
) {
  return addEvent(
    span,
    'ledger.idempotency.miss',
    {
      idempotencyKey:
        hashIdentifier(
          idempotencyKey
        ),

      ...metadata
    }
  );
}

/* ============================================================================
 * Correlation context
 * ========================================================================== */

function createCorrelationContext(
  metadata = {}
) {
  const activeSpanContext =
    getActiveSpanContext();

  const correlationId =
    normalizeId(
      metadata.correlationId ||
        metadata.correlation_id
    ) ||
    activeSpanContext?.traceId ||
    generateId();

  return {
    correlationId,

    requestId:
      normalizeId(
        metadata.requestId ||
          metadata.request_id
      ),

    traceId:
      activeSpanContext
        ?.traceId ||
      undefined,

    spanId:
      activeSpanContext
        ?.spanId ||
      undefined,

    tenantId:
      normalizeId(
        metadata.tenantId ||
          metadata.tenant_id
      ),

    transactionId:
      normalizeId(
        metadata.transactionId ||
          metadata.transaction_id
      ),

    journalId:
      normalizeId(
        metadata.journalId ||
          metadata.journal_id
      ),

    accountId:
      normalizeId(
        metadata.accountId ||
          metadata.account_id
      ),

    entryId:
      normalizeId(
        metadata.entryId ||
          metadata.entry_id
      ),

    idempotencyKey:
      hashIdentifier(
        metadata.idempotencyKey ||
          metadata.idempotency_key
      ),

    operationKey:
      hashIdentifier(
        metadata.operationKey ||
          metadata.operation_key
      )
  };
}

/* ============================================================================
 * Diagnostics / health
 * ========================================================================== */

function diagnostics() {
  const activeSpan =
    getActiveSpan();

  const activeContext =
    getActiveSpanContext();

  const tracerInstance =
    configuredTracer ||
    tracer ||
    getTracer();

  return {
    enabled:
      configuredConfig.enabled,

    failOpen:
      configuredConfig.failOpen,

    otelApiAvailable:
      Boolean(otel),

    tracerAvailable:
      Boolean(
        tracerInstance
      ),

    tracerConfigured:
      Boolean(
        configuredTracer
      ),

    loggerConfigured:
      Boolean(
        configuredLogger
      ),

    metricsConfigured:
      Boolean(
        configuredMetrics
      ),

    serviceName:
      configuredConfig.serviceName,

    instrumentationName:
      configuredConfig.instrumentationName,

    instrumentationVersion:
      configuredConfig
        .instrumentationVersion,

    environment:
      configuredConfig.environment,

    propagationEnabled:
      configuredConfig
        .propagationEnabled,

    tenantAware:
      configuredConfig
        .tenantAware,

    correlationAware:
      configuredConfig
        .correlationAware,

    traceId:
      activeContext
        ?.traceId ||
      null,

    spanId:
      activeContext
        ?.spanId ||
      null,

    traceFlags:
      activeContext
        ?.traceFlags ??
      null,

    recording:
      Boolean(
        activeSpan &&
          typeof activeSpan
            .isRecording ===
            'function' &&
          activeSpan.isRecording()
      ),

    statistics:
      {
        ...statistics
      }
  };
}

function health() {
  const status =
    diagnostics();

  const healthy =
    !configuredConfig.enabled ||
    Boolean(
      status.tracerAvailable
    );

  return {
    status:
      healthy
        ? 'healthy'
        : 'degraded',

    healthy,

    enabled:
      configuredConfig.enabled,

    failOpen:
      configuredConfig.failOpen,

    tracerAvailable:
      status.tracerAvailable,

    otelApiAvailable:
      status.otelApiAvailable,

    serviceName:
      configuredConfig.serviceName,

    environment:
      configuredConfig.environment,

    timestamp:
      new Date().toISOString()
  };
}

/* ============================================================================
 * Public API
 * ========================================================================== */

module.exports = {
  /* Configuration */
  configure,
  getConfig,
  getTracer,

  /* Generic tracing */
  startSpan,
  endSpan,
  withSpan,
  traceChild,

  /* Specialized ledger tracing */
  traceLedgerOperation,
  traceJournalPost,
  traceJournalEntry,
  traceAccountOperation,
  traceTransactionOperation,
  traceReversal,
  traceBalanceOperation,
  traceReconciliation,
  traceSettlement,

  /* Span enrichment */
  setAttributes,
  addEvent,
  markSuccess,
  markFailure,
  recordException,

  /* Financial lifecycle */
  markPostingStarted,
  markPostingValidated,
  markPostingCommitted,
  markPostingRejected,
  markReversalStarted,
  markReversalCommitted,

  /* Idempotency */
  markIdempotencyHit,
  markIdempotencyMiss,

  /* Correlation */
  createCorrelationContext,
  getActiveSpan,
  getActiveSpanContext,
  getTraceId,
  getSpanId,

  /* Propagation */
  injectContext,
  extractContext,
  getTraceHeaders,

  /* Diagnostics */
  diagnostics,
  health,

  /* Constants */
  SERVICE_NAME,
  INSTRUMENTATION_NAME,
  INSTRUMENTATION_VERSION,
  SpanKind,
  SpanStatusCode
};