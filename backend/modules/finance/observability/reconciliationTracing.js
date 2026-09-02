'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Reconciliation Tracing / Financial Observability
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/observability/reconciliationTracing.js
 *
 * Purpose:
 *   Enterprise-grade distributed tracing utilities for financial
 *   reconciliation, comparison, mismatch detection, repair, replay,
 *   provider reconciliation and settlement verification.
 *
 * Architecture:
 *
 *   Reconciliation Service / Job
 *             |
 *             v
 *   reconciliationTracing
 *             |
 *             +---- OpenTelemetry API
 *             |
 *             +---- Application Tracer (optional)
 *             |
 *             +---- Structured Logger (optional)
 *             |
 *             +---- Metrics (optional)
 *
 * IMPORTANT:
 *
 *   This module does NOT initialize:
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
 *   - Reconciliation business failures are never swallowed.
 *   - Observability failures never become financial failures.
 *   - OpenTelemetry is optional.
 *   - No-op mode is supported.
 *   - Async context propagation is supported.
 *   - Tenant/correlation/request identity is preserved.
 *   - Idempotency identifiers are hashed before telemetry emission.
 *   - Sensitive values are filtered.
 *   - High-cardinality values are bounded/omitted by default.
 *   - Manual and automatic span lifecycle are supported.
 *   - Child spans are supported.
 *   - Provider and settlement workflows are traceable.
 *   - Comparison metrics remain bounded and numeric.
 *   - Repair and replay workflows retain lifecycle semantics.
 *   - Runtime configuration is supported.
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
  'titech-community-capital-reconciliation';

const INSTRUMENTATION_NAME =
  process.env.OTEL_INSTRUMENTATION_NAME ||
  'titech-community-capital/reconciliation';

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

const TRACING_ENABLED =
  parseBoolean(
    process.env.RECONCILIATION_TRACING_ENABLED,
    true
  ) &&
  !parseBoolean(
    process.env.OTEL_SDK_DISABLED,
    false
  );

const RECORD_SENSITIVE_DATA =
  parseBoolean(
    process.env.RECONCILIATION_TRACE_SENSITIVE_DATA,
    false
  );

const INCLUDE_HIGH_CARDINALITY =
  parseBoolean(
    process.env.RECONCILIATION_TRACE_HIGH_CARDINALITY,
    false
  );

const MAX_ATTRIBUTE_LENGTH =
  parsePositiveInteger(
    process.env.RECONCILIATION_TRACE_MAX_ATTRIBUTE_LENGTH,
    DEFAULT_MAX_ATTRIBUTE_LENGTH
  );

const MAX_EVENT_ATTRIBUTE_LENGTH =
  parsePositiveInteger(
    process.env.RECONCILIATION_TRACE_MAX_EVENT_ATTRIBUTE_LENGTH,
    DEFAULT_MAX_EVENT_ATTRIBUTE_LENGTH
  );

const MAX_ARRAY_ITEMS =
  parsePositiveInteger(
    process.env.RECONCILIATION_TRACE_MAX_ARRAY_ITEMS,
    DEFAULT_MAX_ARRAY_ITEMS
  );

const AUTO_HASH_IDENTIFIERS =
  parseBoolean(
    process.env.RECONCILIATION_TRACE_HASH_IDENTIFIERS,
    true
  );

const DEFAULT_TIMEOUT_MS =
  parsePositiveInteger(
    process.env.RECONCILIATION_TRACE_DEFAULT_TIMEOUT_MS,
    0
  );

/* ============================================================================
 * OpenTelemetry constants / fallbacks
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
 * Runtime configuration
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
    TRACING_ENABLED,

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

  failOpen:
    true,

  tenantAware:
    true,

  correlationAware:
    true,

  propagationEnabled:
    true
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

  noOpSpans: 0,

  runsStarted: 0,
  runsCompleted: 0,
  runsFailed: 0,

  mismatchesDetected: 0,
  mismatchesResolved: 0,

  repairsStarted: 0,
  repairsCompleted: 0,
  repairsFailed: 0,

  replaysStarted: 0,
  replaysCompleted: 0
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

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  )
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
    return 'reconciliation.operation';
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
    'reconciliation.operation'
  );
}

function isPromiseLike(value) {
  return Boolean(
    value &&
      typeof value.then ===
        'function'
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

function toFiniteNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : undefined;
}

/* ============================================================================
 * Sensitive / high-cardinality protection
 * ========================================================================== */

const SENSITIVE_KEY_PATTERNS = [
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
  /national.?id/i,
  /identity.?number/i
];

function isSensitiveKey(key) {
  const normalized =
    String(key || '');

  return SENSITIVE_KEY_PATTERNS.some(
    pattern =>
      pattern.test(
        normalized
      )
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
    'document',
    'documents',
    'headers',
    'query',
    'metadata',
    'entries',
    'records',
    'transactions',
    'items',
    'stack',
    'fullstack',
    'email',
    'phone',
    'address'
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
      JSON.stringify(value),
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
        truncate(
          key,
          128
        )
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
    !configuredConfig.hashIdentifiers
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
    name =
      'reconciliation.operation'
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
 * Tracer configuration
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
    options.tracer !==
    undefined
  ) {
    configuredTracer =
      options.tracer || null;

    tracer =
      options.tracer || null;
  }

  if (
    options.logger !==
    undefined
  ) {
    configuredLogger =
      options.logger || null;
  }

  if (
    options.metrics !==
    undefined
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
        'Failed to obtain OpenTelemetry reconciliation tracer',
        error
      );
    }
  }

  return null;
}

/* ============================================================================
 * Logging
 * ========================================================================== */

function safeLog(
  level,
  message,
  error,
  metadata = {}
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
            ...metadata,

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
          .RECONCILIATION_TRACING_LOG_ERRORS,
        process.env.NODE_ENV !==
          'test'
      )
    ) {
      // eslint-disable-next-line no-console
      console[
        level === 'error'
          ? 'error'
          : 'warn'
      ](
        `[reconciliationTracing] ${message}`,
        {
          ...metadata,

          error:
            error instanceof
            Error
              ? error.message
              : error
        }
      );
    }
  } catch (_loggingError) {
    /*
     * Never allow logging failure to affect reconciliation.
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
      `Failed to increment reconciliation metric: ${name}`,
      error
    );
  }
}

/* ============================================================================
 * OpenTelemetry context
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
  const span =
    getActiveSpan();

  if (
    !span ||
    typeof span
      .spanContext !==
      'function'
  ) {
    return null;
  }

  try {
    return (
      span.spanContext() ||
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
        'Failed to inject reconciliation trace context',
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
      'Failed to extract reconciliation trace context',
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
 * Reconciliation attribute model
 * ========================================================================== */

function buildReconciliationAttributes(
  metadata = {}
) {
  const attributes = {
    'service.name':
      configuredConfig.serviceName,

    'service.version':
      configuredConfig
        .instrumentationVersion,

    'deployment.environment.name':
      configuredConfig.environment,

    'reconciliation.component':
      normalizeId(
        metadata.component ||
          metadata.reconciliationComponent ||
          'reconciliation'
      ),

    'reconciliation.operation':
      normalizeOperationName(
        metadata.operation ||
          metadata.operationName ||
          'reconciliation.operation'
      ),

    'reconciliation.id':
      normalizeId(
        metadata.reconciliationId ||
          metadata.reconciliation_id ||
          metadata.runId ||
          metadata.run_id
      ),

    'reconciliation.run.id':
      normalizeId(
        metadata.runId ||
          metadata.run_id
      ),

    'reconciliation.batch.id':
      normalizeId(
        metadata.batchId ||
          metadata.batch_id
      ),

    'reconciliation.job.id':
      normalizeId(
        metadata.jobId ||
          metadata.job_id
      ),

    'reconciliation.schedule.id':
      normalizeId(
        metadata.scheduleId ||
          metadata.schedule_id
      ),

    'reconciliation.correlation.id':
      normalizeId(
        metadata.correlationId ||
          metadata.correlation_id
      ),

    'reconciliation.request.id':
      normalizeId(
        metadata.requestId ||
          metadata.request_id
      ),

    /*
     * Idempotency keys are hashed by default before telemetry emission.
     */
    'reconciliation.idempotency.key':
      hashIdentifier(
        metadata.idempotencyKey ||
          metadata.idempotency_key
      ),

    'reconciliation.operation.key':
      hashIdentifier(
        metadata.operationKey ||
          metadata.operation_key
      ),

    'reconciliation.tenant.id':
      normalizeId(
        metadata.tenantId ||
          metadata.tenant_id
      ),

    'reconciliation.source':
      normalizeId(
        metadata.source ||
          metadata.sourceSystem
      ),

    'reconciliation.provider':
      normalizeId(
        metadata.provider ||
          metadata.providerName
      ),

    'reconciliation.provider.transaction.id':
      normalizeId(
        metadata.providerTransactionId ||
          metadata.provider_transaction_id
      ),

    'reconciliation.ledger.transaction.id':
      normalizeId(
        metadata.ledgerTransactionId ||
          metadata.ledger_transaction_id
      ),

    'reconciliation.journal.id':
      normalizeId(
        metadata.journalId ||
          metadata.journal_id
      ),

    'reconciliation.account.id':
      normalizeId(
        metadata.accountId ||
          metadata.account_id
      ),

    'reconciliation.currency':
      normalizeId(
        metadata.currency ||
          metadata.currencyCode
      ),

    'reconciliation.financial.period':
      normalizeId(
        metadata.financialPeriod ||
          metadata.period
      ),

    'reconciliation.status':
      normalizeId(
        metadata.status
      ),

    'reconciliation.mode':
      normalizeId(
        metadata.mode
      ),

    'reconciliation.strategy':
      normalizeId(
        metadata.strategy
      ),

    'reconciliation.scope':
      normalizeId(
        metadata.scope
      ),

    'reconciliation.mismatch.type':
      normalizeId(
        metadata.mismatchType ||
          metadata.mismatch_type
      ),

    'reconciliation.repair.strategy':
      normalizeId(
        metadata.repairStrategy ||
          metadata.repair_strategy
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

  return {
    ...cleaned,

    ...filterAttributes(
      metadata.attributes ||
        metadata.tags ||
        {}
    )
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

  const filtered =
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
        filtered
      );
    } else {
      for (
        const [key, value] of
        Object.entries(filtered)
      ) {
        span.setAttribute(
          key,
          value
        );
      }
    }
  } catch (error) {
    statistics
      .attributeFailures++;

    safeLog(
      'warn',
      'Failed to set reconciliation span attributes',
      error
    );

    incrementMetric(
      'reconciliation_tracing_attribute_failures_total'
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
      `Failed to add reconciliation trace event: ${eventName}`,
      error
    );

    incrementMetric(
      'reconciliation_tracing_event_failures_total'
    );
  }

  return span;
}

/* ============================================================================
 * Span status / exceptions
 * ========================================================================== */

function recordException(
  span,
  error,
  attributes = {}
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
          safeErrorName(
            error
          ),

        'error.message':
          safeErrorMessage(
            error
          ),

        'reconciliation.error.code':
          normalizeId(
            error?.code
          ),

        ...attributes
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
      'Failed to record reconciliation exception',
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
        'reconciliation.result':
          'success',

        ...attributes
      }
    );
  } catch (error) {
    safeLog(
      'warn',
      'Failed to mark reconciliation span successful',
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
      'reconciliation.result':
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
    buildReconciliationAttributes({
      ...metadata,

      correlationId,

      operation:
        name
    });

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
      span:
        fallbackSpan,

      context:
        null,

      startedAt:
        nowNs(),

      tracingEnabled:
        false,

      generatedCorrelationId:
        correlationId,

      operationName:
        name,

      ended:
        false
    };
  }

  try {
    const span =
      tracerInstance.startSpan(
        name,
        {
          ...options,

          kind:
            options.kind ??
            SpanKind.INTERNAL,

          attributes,

          links:
            options.links,

          startTime:
            options.startTime
        },
        options.parentContext ||
          undefined
      );

    let context = null;

    if (
      otel?.trace?.setSpan
    ) {
      context =
        otel.trace.setSpan(
          getActiveContext() ||
            otel.context.active(),
          span
        );
    }

    statistics.spansStarted++;

    return {
      span,

      context,

      startedAt:
        nowNs(),

      tracingEnabled:
        true,

      generatedCorrelationId:
        correlationId,

      operationName:
        name,

      ended:
        false
    };
  } catch (error) {
    statistics
      .spanStartFailures++;

    safeLog(
      'warn',
      `Failed to start reconciliation span: ${name}`,
      error
    );

    incrementMetric(
      'reconciliation_tracing_span_start_failures_total',
      {
        operation:
          name
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

      context:
        null,

      startedAt:
        nowNs(),

      tracingEnabled:
        false,

      generatedCorrelationId:
        correlationId,

      operationName:
        name,

      ended:
        false
    };
  }
}

/* ============================================================================
 * Span lifecycle
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

  spanHandle.ended =
    true;

  const span =
    spanHandle.span;

  try {
    const measuredDuration =
      durationMs !==
      undefined
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
          'reconciliation.duration_ms':
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
          'reconciliation.result.present':
            result !== undefined
        }
      );
    }

    incrementMetric(
      'reconciliation_tracing_spans_completed_total',
      {
        operation:
          spanHandle.operationName ||
          'reconciliation.operation',

        status:
          error
            ? 'error'
            : 'success'
      }
    );
  } catch (errorHandlingFailure) {
    safeLog(
      'warn',
      'Failed to finalize reconciliation span metadata',
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
        'Failed to end reconciliation span',
        error
      );

      incrementMetric(
        'reconciliation_tracing_span_end_failures_total'
      );
    }
  }
}

/* ============================================================================
 * Timeout support
 * ========================================================================== */

function withTimeout(
  promise,
  timeoutMs,
  onTimeout
) {
  if (
    !isPromiseLike(
      promise
    ) ||
    !timeoutMs ||
    timeoutMs <= 0
  ) {
    return promise;
  }

  let timer;

  const timeoutPromise =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              try {
                if (
                  typeof onTimeout ===
                  'function'
                ) {
                  onTimeout();
                }
              } catch (_error) {
                // Timeout instrumentation must never mask timeout behavior.
              }

              const error =
                new Error(
                  `Reconciliation operation timed out after ${timeoutMs}ms`
                );

              error.code =
                'RECONCILIATION_TRACE_TIMEOUT';

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
 * Generic execution wrapper
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
      'reconciliationTracing.withSpan requires a handler function'
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
            ...(metadata || {}),

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
      result =
        invoke();
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

function executeWithOptionalTimeout(
  operationName,
  metadata,
  handler,
  options = {}
) {
  const result =
    withSpan(
      operationName,
      metadata,
      handler,
      options
    );

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
          'reconciliation.timeout',
          {
            operation:
              operationName,

            timeoutMs
          }
        );

        incrementMetric(
          'reconciliation_tracing_timeout_total',
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
      'reconciliationTracing.traceChild requires a handler function'
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

  return executeWithOptionalTimeout(
    operationName,
    {
      ...(metadata || {}),

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
    return (
      span.spanContext()
        ?.spanId ||
      undefined
    );
  } catch (_error) {
    return undefined;
  }
}

/* ============================================================================
 * Specialized trace wrappers
 * ========================================================================== */

function traceReconciliationOperation(
  operation,
  metadata,
  handler,
  options = {}
) {
  const suffix =
    normalizeOperationName(
      operation
    ).replace(
      /^reconciliation\./,
      ''
    );

  return executeWithOptionalTimeout(
    `reconciliation.${suffix}`,
    {
      ...metadata,

      component:
        metadata?.component ||
        'reconciliation'
    },
    handler,
    options
  );
}

function traceReconciliationRun(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'run',
    metadata,
    handler,
    options
  );
}

function traceBatch(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'batch',
    metadata,
    handler,
    options
  );
}

function traceLedgerReconciliation(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'ledger',
    {
      ...metadata,
      component:
        'ledger'
    },
    handler,
    options
  );
}

function traceAccountReconciliation(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'account',
    {
      ...metadata,
      component:
        'account'
    },
    handler,
    options
  );
}

function traceTransactionReconciliation(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'transaction',
    {
      ...metadata,
      component:
        'transaction'
    },
    handler,
    options
  );
}

function traceProviderReconciliation(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'provider',
    {
      ...metadata,
      component:
        'provider'
    },
    handler,
    options
  );
}

function traceSettlementReconciliation(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
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

function traceComparison(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'comparison',
    metadata,
    handler,
    options
  );
}

function traceMismatchAnalysis(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'mismatchAnalysis',
    metadata,
    handler,
    options
  );
}

function traceRepair(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'repair',
    {
      ...metadata,
      component:
        'repair'
    },
    handler,
    options
  );
}

function traceReplay(
  metadata,
  handler,
  options = {}
) {
  return traceReconciliationOperation(
    'replay',
    {
      ...metadata,
      component:
        'replay'
    },
    handler,
    options
  );
}

/* ============================================================================
 * Reconciliation lifecycle
 * ========================================================================== */

function markRunStarted(
  span,
  metadata = {}
) {
  statistics.runsStarted++;

  setAttributes(
    span,
    {
      'reconciliation.lifecycle':
        'run',

      'reconciliation.state':
        'started',

      ...buildReconciliationAttributes(
        metadata
      )
    }
  );

  addEvent(
    span,
    'reconciliation.run.started',
    metadata
  );

  incrementMetric(
    'reconciliation_runs_started_total',
    {
      source:
        metadata.source ||
        'unknown'
    }
  );

  return span;
}

function markRunValidated(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.state':
        'validated',

      ...buildReconciliationAttributes(
        metadata
      )
    }
  );

  addEvent(
    span,
    'reconciliation.run.validated',
    metadata
  );

  return span;
}

function markRunCompleted(
  span,
  metadata = {}
) {
  statistics.runsCompleted++;

  setAttributes(
    span,
    {
      'reconciliation.state':
        'completed',

      'reconciliation.status':
        metadata.status ||
        'completed',

      ...buildReconciliationAttributes(
        metadata
      )
    }
  );

  addEvent(
    span,
    'reconciliation.run.completed',
    metadata
  );

  markSuccess(
    span
  );

  incrementMetric(
    'reconciliation_runs_completed_total',
    {
      status:
        metadata.status ||
        'completed'
    }
  );

  return span;
}

function markRunFailed(
  span,
  error,
  metadata = {}
) {
  statistics.runsFailed++;

  setAttributes(
    span,
    {
      'reconciliation.state':
        'failed',

      'reconciliation.status':
        'failed',

      ...buildReconciliationAttributes(
        metadata
      )
    }
  );

  addEvent(
    span,
    'reconciliation.run.failed',
    {
      reason:
        safeErrorMessage(
          error
        ),

      ...metadata
    }
  );

  markFailure(
    span,
    error
  );

  incrementMetric(
    'reconciliation_runs_failed_total'
  );

  return span;
}

/* ============================================================================
 * Comparison telemetry
 * ========================================================================== */

function recordComparison(
  span,
  metrics = {}
) {
  const sourceCount =
    toFiniteNumber(
      metrics.sourceCount
    );

  const ledgerCount =
    toFiniteNumber(
      metrics.ledgerCount
    );

  const matchedCount =
    toFiniteNumber(
      metrics.matchedCount
    );

  const mismatchCount =
    toFiniteNumber(
      metrics.mismatchCount
    );

  const missingSourceCount =
    toFiniteNumber(
      metrics.missingSourceCount
    );

  const missingLedgerCount =
    toFiniteNumber(
      metrics.missingLedgerCount
    );

  const expectedAmount =
    toFiniteNumber(
      metrics.expectedAmount
    );

  const actualAmount =
    toFiniteNumber(
      metrics.actualAmount
    );

  const amountDifference =
    toFiniteNumber(
      metrics.amountDifference
    );

  const sourceDebit =
    toFiniteNumber(
      metrics.sourceDebit
    );

  const sourceCredit =
    toFiniteNumber(
      metrics.sourceCredit
    );

  const ledgerDebit =
    toFiniteNumber(
      metrics.ledgerDebit
    );

  const ledgerCredit =
    toFiniteNumber(
      metrics.ledgerCredit
    );

  const attributes = {
    'reconciliation.source.count':
      sourceCount,

    'reconciliation.ledger.count':
      ledgerCount,

    'reconciliation.matched.count':
      matchedCount,

    'reconciliation.mismatch.count':
      mismatchCount,

    'reconciliation.missing.source.count':
      missingSourceCount,

    'reconciliation.missing.ledger.count':
      missingLedgerCount,

    'reconciliation.amount.expected':
      expectedAmount,

    'reconciliation.amount.actual':
      actualAmount,

    'reconciliation.amount.difference':
      amountDifference,

    'reconciliation.source.debit':
      sourceDebit,

    'reconciliation.source.credit':
      sourceCredit,

    'reconciliation.ledger.debit':
      ledgerDebit,

    'reconciliation.ledger.credit':
      ledgerCredit
  };

  for (
    const [key, value] of
    Object.entries(
      attributes
    )
  ) {
    if (
      value !== undefined
    ) {
      setAttributes(
        span,
        {
          [key]: value
        }
      );
    }
  }

  addEvent(
    span,
    'reconciliation.comparison.completed',
    {
      sourceCount,
      ledgerCount,
      matchedCount,
      mismatchCount,
      missingSourceCount,
      missingLedgerCount,
      amountDifference
    }
  );

  incrementMetric(
    'reconciliation_comparisons_total'
  );

  if (
    mismatchCount !==
      undefined &&
    mismatchCount > 0
  ) {
    incrementMetric(
      'reconciliation_comparison_mismatches_total'
    );
  }

  return span;
}

function recordMatch(
  span,
  metadata = {}
) {
  const count =
    toFiniteNumber(
      metadata.count
    );

  setAttributes(
    span,
    {
      'reconciliation.match.count':
        count
    }
  );

  addEvent(
    span,
    'reconciliation.match',
    {
      count,
      ...metadata
    }
  );

  return span;
}

function recordComparisonDifference(
  span,
  metadata = {}
) {
  const difference =
    toFiniteNumber(
      metadata.amountDifference ??
        metadata.difference
    );

  if (
    difference !==
    undefined
  ) {
    setAttributes(
      span,
      {
        'reconciliation.amount.difference':
          difference
      }
    );
  }

  addEvent(
    span,
    'reconciliation.comparison.difference',
    metadata
  );

  return span;
}

/* ============================================================================
 * Mismatch telemetry
 * ========================================================================== */

function markMismatchDetected(
  span,
  metadata = {}
) {
  statistics
    .mismatchesDetected++;

  const mismatchCount =
    toFiniteNumber(
      metadata.mismatchCount
    );

  setAttributes(
    span,
    {
      'reconciliation.mismatch.detected':
        true,

      'reconciliation.mismatch.type':
        normalizeId(
          metadata.mismatchType ||
            metadata.type ||
            'unknown'
        ),

      'reconciliation.mismatch.count':
        mismatchCount,

      'reconciliation.mismatch.severity':
        normalizeId(
          metadata.severity
        )
    }
  );

  addEvent(
    span,
    'reconciliation.mismatch.detected',
    metadata
  );

  incrementMetric(
    'reconciliation_mismatches_detected_total',
    {
      type:
        metadata.mismatchType ||
        metadata.type ||
        'unknown'
    }
  );

  return span;
}

function markMismatchClassified(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.mismatch.classification':
        normalizeId(
          metadata.classification
        ),

      'reconciliation.mismatch.severity':
        normalizeId(
          metadata.severity
        ),

      'reconciliation.mismatch.root.cause':
        normalizeId(
          metadata.rootCause ||
            metadata.root_cause
        )
    }
  );

  addEvent(
    span,
    'reconciliation.mismatch.classified',
    metadata
  );

  return span;
}

function markMismatchResolved(
  span,
  metadata = {}
) {
  statistics
    .mismatchesResolved++;

  setAttributes(
    span,
    {
      'reconciliation.mismatch.resolved':
        true
    }
  );

  addEvent(
    span,
    'reconciliation.mismatch.resolved',
    metadata
  );

  incrementMetric(
    'reconciliation_mismatches_resolved_total'
  );

  return span;
}

/* ============================================================================
 * Repair telemetry
 * ========================================================================== */

function markRepairStarted(
  span,
  metadata = {}
) {
  statistics
    .repairsStarted++;

  setAttributes(
    span,
    {
      'reconciliation.repair.state':
        'started',

      'reconciliation.repair.strategy':
        normalizeId(
          metadata.strategy ||
            metadata.repairStrategy
        ),

      'reconciliation.repair.id':
        normalizeId(
          metadata.repairId
        )
    }
  );

  addEvent(
    span,
    'reconciliation.repair.started',
    metadata
  );

  incrementMetric(
    'reconciliation_repairs_started_total'
  );

  return span;
}

function markRepairCompleted(
  span,
  metadata = {}
) {
  statistics
    .repairsCompleted++;

  setAttributes(
    span,
    {
      'reconciliation.repair.state':
        'completed',

      'reconciliation.repair.records':
        toFiniteNumber(
          metadata.recordsRepaired
        )
    }
  );

  addEvent(
    span,
    'reconciliation.repair.completed',
    metadata
  );

  incrementMetric(
    'reconciliation_repairs_completed_total'
  );

  return span;
}

function markRepairFailed(
  span,
  error,
  metadata = {}
) {
  statistics
    .repairsFailed++;

  setAttributes(
    span,
    {
      'reconciliation.repair.state':
        'failed'
    }
  );

  addEvent(
    span,
    'reconciliation.repair.failed',
    {
      reason:
        safeErrorMessage(
          error
        ),

      ...metadata
    }
  );

  markFailure(
    span,
    error
  );

  incrementMetric(
    'reconciliation_repairs_failed_total'
  );

  return span;
}

/* ============================================================================
 * Replay telemetry
 * ========================================================================== */

function markReplayStarted(
  span,
  metadata = {}
) {
  statistics
    .replaysStarted++;

  setAttributes(
    span,
    {
      'reconciliation.replay.state':
        'started',

      'reconciliation.replay.id':
        hashIdentifier(
          metadata.replayId
        )
    }
  );

  addEvent(
    span,
    'reconciliation.replay.started',
    metadata
  );

  incrementMetric(
    'reconciliation_replays_started_total'
  );

  return span;
}

function markReplayCompleted(
  span,
  metadata = {}
) {
  statistics
    .replaysCompleted++;

  setAttributes(
    span,
    {
      'reconciliation.replay.state':
        'completed',

      'reconciliation.replay.records':
        toFiniteNumber(
          metadata.recordsReplayed
        )
    }
  );

  addEvent(
    span,
    'reconciliation.replay.completed',
    metadata
  );

  incrementMetric(
    'reconciliation_replays_completed_total'
  );

  return span;
}

/* ============================================================================
 * Provider telemetry
 * ========================================================================== */

function markProviderFetchStarted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.provider.operation':
        'fetch',

      'reconciliation.provider':
        normalizeId(
          metadata.provider ||
            metadata.providerName
        )
    }
  );

  return addEvent(
    span,
    'reconciliation.provider.fetch.started',
    metadata
  );
}

function markProviderFetchCompleted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.provider.fetch.state':
        'completed',

      'reconciliation.provider.record.count':
        toFiniteNumber(
          metadata.recordCount
        )
    }
  );

  addEvent(
    span,
    'reconciliation.provider.fetch.completed',
    metadata
  );

  return span;
}

function markProviderFetchFailed(
  span,
  error,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.provider.fetch.state':
        'failed'
    }
  );

  addEvent(
    span,
    'reconciliation.provider.fetch.failed',
    {
      reason:
        safeErrorMessage(
          error
        ),

      ...metadata
    }
  );

  markFailure(
    span,
    error
  );

  return span;
}

/* ============================================================================
 * Settlement telemetry
 * ========================================================================== */

function markSettlementCompared(
  span,
  metadata = {}
) {
  const expected =
    toFiniteNumber(
      metadata.expectedAmount
    );

  const actual =
    toFiniteNumber(
      metadata.actualAmount
    );

  const difference =
    toFiniteNumber(
      metadata.amountDifference
    );

  setAttributes(
    span,
    {
      'reconciliation.settlement.compared':
        true,

      'reconciliation.settlement.expected':
        expected,

      'reconciliation.settlement.actual':
        actual,

      'reconciliation.settlement.difference':
        difference
    }
  );

  addEvent(
    span,
    'reconciliation.settlement.compared',
    {
      expectedAmount:
        expected,

      actualAmount:
        actual,

      amountDifference:
        difference
    }
  );

  return span;
}

function markSettlementMismatch(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.settlement.mismatch':
        true
    }
  );

  addEvent(
    span,
    'reconciliation.settlement.mismatch',
    metadata
  );

  return span;
}

/* ============================================================================
 * Batch telemetry
 * ========================================================================== */

function markBatchStarted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.batch.state':
        'started',

      'reconciliation.batch.record.count':
        toFiniteNumber(
          metadata.recordCount
        )
    }
  );

  addEvent(
    span,
    'reconciliation.batch.started',
    metadata
  );

  return span;
}

function markBatchCompleted(
  span,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.batch.state':
        'completed',

      'reconciliation.batch.processed.count':
        toFiniteNumber(
          metadata.processedCount
        ),

      'reconciliation.batch.failed.count':
        toFiniteNumber(
          metadata.failedCount
        )
    }
  );

  addEvent(
    span,
    'reconciliation.batch.completed',
    metadata
  );

  return span;
}

function markBatchFailed(
  span,
  error,
  metadata = {}
) {
  setAttributes(
    span,
    {
      'reconciliation.batch.state':
        'failed'
    }
  );

  addEvent(
    span,
    'reconciliation.batch.failed',
    {
      reason:
        safeErrorMessage(
          error
        ),

      ...metadata
    }
  );

  markFailure(
    span,
    error
  );

  return span;
}

/* ============================================================================
 * Correlation context
 * ========================================================================== */

function createCorrelationContext(
  metadata = {}
) {
  const spanContext =
    getActiveSpanContext();

  const correlationId =
    normalizeId(
      metadata.correlationId ||
        metadata.correlation_id
    ) ||
    spanContext?.traceId ||
    generateId();

  return {
    correlationId,

    requestId:
      normalizeId(
        metadata.requestId ||
          metadata.request_id
      ),

    traceId:
      spanContext?.traceId ||
      undefined,

    spanId:
      spanContext?.spanId ||
      undefined,

    tenantId:
      normalizeId(
        metadata.tenantId ||
          metadata.tenant_id
      ),

    reconciliationId:
      normalizeId(
        metadata.reconciliationId ||
          metadata.reconciliation_id ||
          metadata.runId ||
          metadata.run_id
      ),

    runId:
      normalizeId(
        metadata.runId ||
          metadata.run_id
      ),

    batchId:
      normalizeId(
        metadata.batchId ||
          metadata.batch_id
      ),

    jobId:
      normalizeId(
        metadata.jobId ||
          metadata.job_id
      ),

    source:
      normalizeId(
        metadata.source ||
          metadata.sourceSystem
      ),

    provider:
      normalizeId(
        metadata.provider
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
  const activeContext =
    getActiveSpanContext();

  const activeSpan =
    getActiveSpan();

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
      activeContext?.traceId ||
      null,

    spanId:
      activeContext?.spanId ||
      null,

    traceFlags:
      activeContext?.traceFlags ??
      null,

    recording:
      Boolean(
        activeSpan &&
          typeof activeSpan
            .isRecording ===
            'function' &&
          activeSpan.isRecording()
      ),

    statistics: {
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

  /* Specialized tracing */
  traceReconciliationOperation,
  traceReconciliationRun,
  traceBatch,
  traceLedgerReconciliation,
  traceAccountReconciliation,
  traceTransactionReconciliation,
  traceProviderReconciliation,
  traceSettlementReconciliation,
  traceComparison,
  traceMismatchAnalysis,
  traceRepair,
  traceReplay,

  /* Attributes / events */
  buildReconciliationAttributes,
  setAttributes,
  addEvent,
  recordException,
  markSuccess,
  markFailure,

  /* Run lifecycle */
  markRunStarted,
  markRunValidated,
  markRunCompleted,
  markRunFailed,

  /* Comparison */
  recordComparison,
  recordMatch,
  recordComparisonDifference,

  /* Mismatch */
  markMismatchDetected,
  markMismatchClassified,
  markMismatchResolved,

  /* Repair */
  markRepairStarted,
  markRepairCompleted,
  markRepairFailed,

  /* Replay */
  markReplayStarted,
  markReplayCompleted,

  /* Provider */
  markProviderFetchStarted,
  markProviderFetchCompleted,
  markProviderFetchFailed,

  /* Settlement */
  markSettlementCompared,
  markSettlementMismatch,

  /* Batch */
  markBatchStarted,
  markBatchCompleted,
  markBatchFailed,

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
  SpanStatusCode,

  /* Compatibility */
  isOpenTelemetryAvailable:
    Boolean(otel)
};