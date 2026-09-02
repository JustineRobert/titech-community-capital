'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Observability Module
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/observability/index.js
 *
 * Purpose:
 *   Central enterprise observability entry point for the Finance Core.
 *
 * Responsibilities:
 *   - Expose Finance tracing modules through one stable interface
 *   - Prevent consumers from coupling directly to implementation files
 *   - Provide safe optional loading of observability modules
 *   - Preserve compatibility when optional observability dependencies/modules
 *     are unavailable
 *   - Centralize observability configuration
 *   - Expose diagnostics, readiness and health information
 *   - Provide correlation / trace-context propagation helpers
 *   - Provide Finance-specific tracing convenience methods
 *   - Provide a stable integration point for future Finance observability
 *     domains
 *
 * Current tracing domains:
 *   - Ledger
 *   - Reconciliation
 *
 * Designed to cooperate with:
 *   - OpenTelemetry
 *   - Prometheus / metrics
 *   - Structured logging
 *   - Distributed transaction management
 *   - Event publisher / outbox
 *   - Finance jobs and workers
 *   - API request correlation middleware
 *
 * IMPORTANT:
 *   This file MUST NOT initialize an OpenTelemetry SDK, TracerProvider,
 *   exporter, or global propagator.
 *
 *   Application-wide observability bootstrap owns SDK lifecycle.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MODULE_NAME = 'finance-observability';

const DEFAULT_SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-finance';

const DEFAULT_ENVIRONMENT =
  process.env.NODE_ENV ||
  process.env.APP_ENV ||
  'development';

const DEFAULT_VERSION =
  process.env.APP_VERSION ||
  process.env.npm_package_version ||
  '1.0.0';

const DEFAULT_ENABLED = parseBoolean(
  process.env.FINANCE_OBSERVABILITY_ENABLED,
  true
);

const DEFAULT_PROPAGATION_ENABLED = parseBoolean(
  process.env.FINANCE_OBSERVABILITY_PROPAGATION_ENABLED,
  true
);

const DEFAULT_TENANT_AWARE = parseBoolean(
  process.env.FINANCE_OBSERVABILITY_TENANT_AWARE,
  true
);

const DEFAULT_CORRELATION_AWARE = parseBoolean(
  process.env.FINANCE_OBSERVABILITY_CORRELATION_AWARE,
  true
);

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

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

  const normalized = String(value)
    .trim()
    .toLowerCase();

  if (
    ['true', '1', 'yes', 'on', 'enabled'].includes(
      normalized
    )
  ) {
    return true;
  }

  if (
    ['false', '0', 'no', 'off', 'disabled'].includes(
      normalized
    )
  ) {
    return false;
  }

  return fallback;
}

function generateCorrelationId() {
  if (
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now().toString(16),
    Math.random().toString(16).slice(2),
  ].join('-');
}

function safeErrorMessage(error) {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createNoopSpan(
  name = 'finance.operation'
) {
  return {
    name,

    setAttribute() {
      return this;
    },

    setAttributes() {
      return this;
    },

    addEvent() {
      return this;
    },

    setStatus() {
      return this;
    },

    recordException() {
      return this;
    },

    updateName(nextName) {
      this.name =
        nextName || this.name;

      return this;
    },

    end() {},

    isRecording() {
      return false;
    },

    spanContext() {
      return {
        traceId: '',
        spanId: '',
        traceFlags: 0,
        isRemote: false,
      };
    },
  };
}

function createNoopSpanHandle(
  operationName
) {
  return {
    span: createNoopSpan(
      operationName
    ),
    context: null,
    startedAt:
      typeof process.hrtime.bigint ===
      'function'
        ? process.hrtime.bigint()
        : BigInt(Date.now()) *
          BigInt(1_000_000),
    tracingEnabled: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Optional module loading                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Optional loading is deliberate.
 *
 * Finance business processing must not fail merely because an observability
 * implementation is missing or an optional tracing dependency is unavailable.
 */
function loadOptional(
  relativePath,
  label
) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const moduleValue =
      require(relativePath);

    return {
      available: true,
      operational: true,
      value: moduleValue,
      error: null,
      label,
      path: relativePath,
    };
  } catch (error) {
    return {
      available: false,
      operational: false,
      value: createUnavailableModule(
        label,
        relativePath,
        error
      ),
      error,
      label,
      path: relativePath,
    };
  }
}

function createUnavailableModule(
  label,
  modulePath,
  originalError
) {
  const errorMessage =
    safeErrorMessage(
      originalError
    ) ||
    'Unknown module loading error';

  return {
    available: false,
    operational: false,

    module: label,

    path: modulePath,

    error: errorMessage,

    getConfig() {
      return {
        enabled: false,
        available: false,
        operational: false,
        reason: 'module_unavailable',
        module: label,
        path: modulePath,
        error: errorMessage,
      };
    },

    diagnostics() {
      return {
        module: label,
        path: modulePath,
        available: false,
        operational: false,
        error: errorMessage,
      };
    },

    configure() {
      return this.getConfig();
    },

    getTracer() {
      return null;
    },

    getActiveSpan() {
      return null;
    },

    getActiveSpanContext() {
      return null;
    },

    getTraceId() {
      return undefined;
    },

    getSpanId() {
      return undefined;
    },

    injectContext(carrier = {}) {
      return carrier || {};
    },

    extractContext() {
      return null;
    },

    getTraceHeaders() {
      return {};
    },

    withSpan(
      _operationName,
      metadata,
      handler
    ) {
      let callback = handler;

      /*
       * Support both:
       *
       * withSpan(name, metadata, handler)
       * withSpan(name, handler)
       */
      if (
        typeof metadata === 'function' &&
        callback === undefined
      ) {
        callback = metadata;
      }

      if (typeof callback !== 'function') {
        throw new TypeError(
          `${label}.withSpan requires a handler function`
        );
      }

      return callback(
        createNoopSpan()
      );
    },

    startSpan(
      operationName
    ) {
      return createNoopSpanHandle(
        operationName
      );
    },

    endSpan() {},

    addEvent() {},

    setAttributes(
      _span,
      _attributes
    ) {
      return _span;
    },

    markSuccess(span) {
      return span;
    },

    markFailure(span) {
      return span;
    },

    recordException() {},

    createCorrelationContext(
      metadata = {}
    ) {
      return {
        correlationId:
          metadata.correlationId ||
          metadata.correlation_id ||
          generateCorrelationId(),

        requestId:
          metadata.requestId ||
          metadata.request_id,

        tenantId:
          metadata.tenantId ||
          metadata.tenant_id,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Core tracing modules                                                       */
/* -------------------------------------------------------------------------- */

const ledgerModule = loadOptional(
  './ledgerTracing',
  'ledgerTracing'
);

const reconciliationModule =
  loadOptional(
    './reconciliationTracing',
    'reconciliationTracing'
  );

const ledgerTracing =
  ledgerModule.value;

const reconciliationTracing =
  reconciliationModule.value;

/* -------------------------------------------------------------------------- */
/* Runtime configuration                                                      */
/* -------------------------------------------------------------------------- */

let configured = false;

let configuration = {
  serviceName:
    DEFAULT_SERVICE_NAME,

  environment:
    DEFAULT_ENVIRONMENT,

  version:
    DEFAULT_VERSION,

  enabled:
    DEFAULT_ENABLED,

  tenantAware:
    DEFAULT_TENANT_AWARE,

  correlationAware:
    DEFAULT_CORRELATION_AWARE,

  propagationEnabled:
    DEFAULT_PROPAGATION_ENABLED,

  failOpen:
    true,

  modules: {
    ledger: true,
    reconciliation: true,
  },

  metadata: {},
};

/* -------------------------------------------------------------------------- */
/* Module registry                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A stable registry makes the Finance observability layer extensible without
 * requiring callers to know file paths.
 */
const MODULE_REGISTRY = Object.freeze({
  ledger: ledgerTracing,
  ledgerTracing,
  reconciliation: reconciliationTracing,
  reconciliationTracing,
});

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

function configure(options = {}) {
  if (
    options === null ||
    typeof options !== 'object'
  ) {
    return getConfig();
  }

  configuration = {
    ...configuration,
    ...options,

    modules: {
      ...configuration.modules,
      ...(options.modules || {}),
    },

    metadata: {
      ...configuration.metadata,
      ...(options.metadata || {}),
    },
  };

  const moduleConfig = {
    serviceName:
      configuration.serviceName,

    environment:
      configuration.environment,

    version:
      configuration.version,

    enabled:
      configuration.enabled,

    tenantAware:
      configuration.tenantAware,

    correlationAware:
      configuration.correlationAware,

    propagationEnabled:
      configuration.propagationEnabled,
  };

  safelyConfigure(
    ledgerTracing,
    moduleConfig
  );

  safelyConfigure(
    reconciliationTracing,
    moduleConfig
  );

  configured = true;

  return getConfig();
}

function safelyConfigure(
  moduleValue,
  options
) {
  if (
    !moduleValue ||
    typeof moduleValue.configure !==
      'function'
  ) {
    return null;
  }

  try {
    return moduleValue.configure(
      options
    );
  } catch (_error) {
    /*
     * Observability configuration is fail-open.
     *
     * The financial engine must not stop processing because a tracer cannot
     * accept a configuration value.
     */
    return null;
  }
}

function getConfig() {
  return {
    ...configuration,

    modules: {
      ...configuration.modules,
    },

    metadata: {
      ...configuration.metadata,
    },

    configured,

    moduleAvailability: {
      ledger:
        ledgerModule.available,

      reconciliation:
        reconciliationModule.available,
    },

    moduleOperationalState: {
      ledger:
        ledgerModule.operational,

      reconciliation:
        reconciliationModule.operational,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Module access                                                              */
/* -------------------------------------------------------------------------- */

function getModule(name) {
  const normalized =
    String(name || '')
      .trim()
      .toLowerCase();

  return (
    MODULE_REGISTRY[
      normalized
    ] || null
  );
}

function getLedgerTracing() {
  return ledgerTracing;
}

function getReconciliationTracing() {
  return reconciliationTracing;
}

/* -------------------------------------------------------------------------- */
/* Availability / enablement                                                  */
/* -------------------------------------------------------------------------- */

function isAvailable(name) {
  const normalized =
    String(name || '')
      .trim()
      .toLowerCase();

  const moduleValue =
    getModule(normalized);

  if (!moduleValue) {
    return false;
  }

  return (
    moduleValue.available !== false
  );
}

function isOperational(name) {
  const normalized =
    String(name || '')
      .trim()
      .toLowerCase();

  const moduleValue =
    getModule(normalized);

  if (!moduleValue) {
    return false;
  }

  return (
    moduleValue.operational !== false &&
    moduleValue.available !== false
  );
}

function isEnabled(name) {
  const normalized =
    String(name || '')
      .trim()
      .toLowerCase();

  if (!configuration.enabled) {
    return false;
  }

  switch (normalized) {
    case 'ledger':
    case 'ledgertracing':
      return (
        configuration.modules
          .ledger !== false
      );

    case 'reconciliation':
    case 'reconciliationtracing':
      return (
        configuration.modules
          .reconciliation !== false
      );

    default:
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Safe delegation                                                            */
/* -------------------------------------------------------------------------- */

function safeCall(
  moduleValue,
  method,
  args = [],
  fallback
) {
  if (
    !moduleValue ||
    typeof moduleValue[method] !==
      'function'
  ) {
    return fallback;
  }

  try {
    return moduleValue[method](
      ...args
    );
  } catch (_error) {
    /*
     * failOpen=true is deliberate.
     *
     * Tracing, logging and instrumentation failures must never become
     * financial-business failures.
     */
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/* Generic tracing API                                                        */
/* -------------------------------------------------------------------------- */

function withSpan(
  domain,
  operationName,
  metadata,
  handler,
  options = {}
) {
  let resolvedMetadata = metadata;
  let resolvedHandler = handler;
  let resolvedOptions = options;

  /*
   * Support:
   *
   * withSpan(domain, operation, handler)
   * withSpan(domain, operation, metadata, handler)
   * withSpan(domain, operation, metadata, handler, options)
   */
  if (
    typeof metadata === 'function'
  ) {
    resolvedHandler = metadata;
    resolvedMetadata = {};
    resolvedOptions = handler || {};
  }

  if (
    typeof resolvedHandler !==
    'function'
  ) {
    throw new TypeError(
      'financeObservability.withSpan requires a handler function'
    );
  }

  const normalizedDomain =
    normalizeDomain(domain);

  const moduleValue =
    getModule(
      normalizedDomain
    );

  if (
    !moduleValue ||
    !isEnabled(
      normalizedDomain
    )
  ) {
    return resolvedHandler(
      createNoopSpan(
        operationName
      )
    );
  }

  const enrichedMetadata = {
    ...(resolvedMetadata || {}),

    serviceName:
      configuration.serviceName,

    environment:
      configuration.environment,

    version:
      configuration.version,

    ...(configuration.metadata || {}),
  };

  try {
    return moduleValue.withSpan(
      operationName,
      enrichedMetadata,
      resolvedHandler,
      resolvedOptions || {}
    );
  } catch (error) {
    if (
      !configuration.failOpen
    ) {
      throw error;
    }

    /*
     * Only fall back to a no-op execution if the failure happened while
     * creating/instrumenting the span.
     *
     * This protects financial execution while preserving the original handler.
     */
    return resolvedHandler(
      createNoopSpan(
        operationName
      )
    );
  }
}

function startSpan(
  domain,
  operationName,
  metadata = {},
  options = {}
) {
  const normalizedDomain =
    normalizeDomain(domain);

  const moduleValue =
    getModule(
      normalizedDomain
    );

  if (
    !moduleValue ||
    !isEnabled(
      normalizedDomain
    )
  ) {
    return createNoopSpanHandle(
      operationName
    );
  }

  try {
    return moduleValue.startSpan(
      operationName,
      {
        ...(metadata || {}),

        serviceName:
          configuration.serviceName,

        environment:
          configuration.environment,

        version:
          configuration.version,

        ...(configuration.metadata || {}),
      },
      options || {}
    );
  } catch (error) {
    if (
      !configuration.failOpen
    ) {
      throw error;
    }

    return createNoopSpanHandle(
      operationName
    );
  }
}

function endSpan(
  domain,
  spanHandle,
  options = {}
) {
  const moduleValue =
    getModule(domain);

  if (!moduleValue) {
    return undefined;
  }

  return safeCall(
    moduleValue,
    'endSpan',
    [
      spanHandle,
      options,
    ],
    undefined
  );
}

function normalizeDomain(
  domain
) {
  return String(
    domain || ''
  )
    .trim()
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Correlation / propagation                                                 */
/* -------------------------------------------------------------------------- */

function getActiveSpan(
  preferredDomain
) {
  if (preferredDomain) {
    return safeCall(
      getModule(
        preferredDomain
      ),
      'getActiveSpan',
      [],
      null
    );
  }

  return (
    safeCall(
      ledgerTracing,
      'getActiveSpan',
      [],
      null
    ) ||
    safeCall(
      reconciliationTracing,
      'getActiveSpan',
      [],
      null
    ) ||
    null
  );
}

function getActiveSpanContext(
  preferredDomain
) {
  if (preferredDomain) {
    return safeCall(
      getModule(
        preferredDomain
      ),
      'getActiveSpanContext',
      [],
      null
    );
  }

  return (
    safeCall(
      ledgerTracing,
      'getActiveSpanContext',
      [],
      null
    ) ||
    safeCall(
      reconciliationTracing,
      'getActiveSpanContext',
      [],
      null
    ) ||
    null
  );
}

function getTraceId(
  preferredDomain
) {
  if (preferredDomain) {
    return safeCall(
      getModule(
        preferredDomain
      ),
      'getTraceId',
      [],
      undefined
    );
  }

  return (
    safeCall(
      ledgerTracing,
      'getTraceId',
      [],
      undefined
    ) ||
    safeCall(
      reconciliationTracing,
      'getTraceId',
      [],
      undefined
    ) ||
    undefined
  );
}

function getSpanId(
  preferredDomain
) {
  if (preferredDomain) {
    return safeCall(
      getModule(
        preferredDomain
      ),
      'getSpanId',
      [],
      undefined
    );
  }

  return (
    safeCall(
      ledgerTracing,
      'getSpanId',
      [],
      undefined
    ) ||
    safeCall(
      reconciliationTracing,
      'getSpanId',
      [],
      undefined
    ) ||
    undefined
  );
}

function createCorrelationContext(
  metadata = {}
) {
  const normalizedMetadata =
    metadata || {};

  const activeTraceId =
    getTraceId();

  const common = {
    serviceName:
      configuration.serviceName,

    environment:
      configuration.environment,

    version:
      configuration.version,

    correlationId:
      normalizedMetadata.correlationId ||
      normalizedMetadata.correlation_id ||
      activeTraceId ||
      generateCorrelationId(),

    requestId:
      normalizedMetadata.requestId ||
      normalizedMetadata.request_id,

    tenantId:
      normalizedMetadata.tenantId ||
      normalizedMetadata.tenant_id,

    transactionId:
      normalizedMetadata.transactionId ||
      normalizedMetadata.transaction_id,

    journalId:
      normalizedMetadata.journalId ||
      normalizedMetadata.journal_id,

    accountId:
      normalizedMetadata.accountId ||
      normalizedMetadata.account_id,

    reconciliationId:
      normalizedMetadata.reconciliationId ||
      normalizedMetadata.reconciliation_id,

    runId:
      normalizedMetadata.runId ||
      normalizedMetadata.run_id,

    batchId:
      normalizedMetadata.batchId ||
      normalizedMetadata.batch_id,

    jobId:
      normalizedMetadata.jobId ||
      normalizedMetadata.job_id,

    idempotencyKey:
      normalizedMetadata.idempotencyKey ||
      normalizedMetadata.idempotency_key,

    traceId:
      activeTraceId,

    spanId:
      getSpanId(),
  };

  /*
   * Prefer reconciliation context because it already understands reconciliation
   * identifiers, then fill missing values from the generic Finance context.
   */
  const reconciliationContext =
    safeCall(
      reconciliationTracing,
      'createCorrelationContext',
      [normalizedMetadata],
      null
    );

  const ledgerContext =
    safeCall(
      ledgerTracing,
      'createCorrelationContext',
      [normalizedMetadata],
      null
    );

  return {
    ...common,
    ...(ledgerContext || {}),
    ...(reconciliationContext || {}),
    serviceName:
      configuration.serviceName,
    environment:
      configuration.environment,
    version:
      configuration.version,
    traceId:
      common.traceId ||
      undefined,
    spanId:
      common.spanId ||
      undefined,
  };
}

function injectContext(
  carrier = {},
  domain
) {
  if (
    configuration.propagationEnabled ===
    false
  ) {
    return carrier || {};
  }

  const target =
    carrier || {};

  if (domain) {
    return safeCall(
      getModule(domain),
      'injectContext',
      [target],
      target
    );
  }

  /*
   * Ledger and reconciliation both ultimately rely on the OpenTelemetry
   * propagation API. Calling either one is sufficient; ledger is preferred.
   */
  return (
    safeCall(
      ledgerTracing,
      'injectContext',
      [target],
      null
    ) ||
    safeCall(
      reconciliationTracing,
      'injectContext',
      [target],
      target
    ) ||
    target
  );
}

function extractContext(
  carrier,
  domain
) {
  if (
    configuration.propagationEnabled ===
    false
  ) {
    return null;
  }

  if (domain) {
    return safeCall(
      getModule(domain),
      'extractContext',
      [carrier],
      null
    );
  }

  return (
    safeCall(
      ledgerTracing,
      'extractContext',
      [carrier],
      null
    ) ||
    safeCall(
      reconciliationTracing,
      'extractContext',
      [carrier],
      null
    ) ||
    null
  );
}

function getTraceHeaders(
  domain
) {
  if (domain) {
    return safeCall(
      getModule(domain),
      'getTraceHeaders',
      [],
      {}
    );
  }

  return (
    safeCall(
      ledgerTracing,
      'getTraceHeaders',
      [],
      null
    ) ||
    safeCall(
      reconciliationTracing,
      'getTraceHeaders',
      [],
      {}
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Shared span enrichment                                                     */
/* -------------------------------------------------------------------------- */

function setAttributes(
  domain,
  span,
  attributes = {},
  options = {}
) {
  const moduleValue =
    getModule(domain);

  if (!moduleValue) {
    return span;
  }

  return safeCall(
    moduleValue,
    'setAttributes',
    [
      span,
      {
        'finance.service':
          configuration.serviceName,

        'finance.environment':
          configuration.environment,

        'finance.version':
          configuration.version,

        ...(configuration.tenantAware &&
        attributes.tenantId
          ? {
              'finance.tenant.id':
                attributes.tenantId,
            }
          : {}),

        ...attributes,
      },
      options,
    ],
    span
  );
}

function addEvent(
  domain,
  span,
  eventName,
  attributes = {}
) {
  const moduleValue =
    getModule(domain);

  if (!moduleValue) {
    return span;
  }

  return safeCall(
    moduleValue,
    'addEvent',
    [
      span,
      eventName,
      attributes,
    ],
    span
  );
}

function recordException(
  domain,
  span,
  error,
  attributes = {}
) {
  const moduleValue =
    getModule(domain);

  return safeCall(
    moduleValue,
    'recordException',
    [
      span,
      error,
      attributes,
    ],
    span
  );
}

function markSuccess(
  domain,
  span,
  attributes = {}
) {
  return safeCall(
    getModule(domain),
    'markSuccess',
    [
      span,
      attributes,
    ],
    span
  );
}

function markFailure(
  domain,
  span,
  error,
  attributes = {}
) {
  return safeCall(
    getModule(domain),
    'markFailure',
    [
      span,
      error,
      attributes,
    ],
    span
  );
}

/* -------------------------------------------------------------------------- */
/* Ledger convenience API                                                     */
/* -------------------------------------------------------------------------- */

function traceLedger(
  operation,
  metadata,
  handler,
  options = {}
) {
  if (
    typeof metadata ===
    'function'
  ) {
    options = handler || {};
    handler = metadata;
    metadata = {};
  }

  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      'financeObservability.traceLedger requires a handler function'
    );
  }

  const enrichedMetadata = {
    ...(metadata || {}),
    component: 'ledger',
  };

  if (
    typeof ledgerTracing.traceLedgerOperation ===
    'function'
  ) {
    try {
      return ledgerTracing.traceLedgerOperation(
        operation,
        enrichedMetadata,
        handler,
        options
      );
    } catch (error) {
      if (
        !configuration.failOpen
      ) {
        throw error;
      }

      return handler(
        createNoopSpan(
          `ledger.${operation}`
        )
      );
    }
  }

  return handler(
    createNoopSpan(
      `ledger.${operation}`
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Reconciliation convenience API                                             */
/* -------------------------------------------------------------------------- */

function traceReconciliation(
  metadata,
  handler,
  options = {}
) {
  if (
    typeof metadata ===
    'function'
  ) {
    options = handler || {};
    handler = metadata;
    metadata = {};
  }

  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      'financeObservability.traceReconciliation requires a handler function'
    );
  }

  const enrichedMetadata = {
    ...(metadata || {}),
    component:
      metadata?.component ||
      'reconciliation',
  };

  if (
    typeof reconciliationTracing.traceReconciliationRun ===
    'function'
  ) {
    try {
      return reconciliationTracing.traceReconciliationRun(
        enrichedMetadata,
        handler,
        options
      );
    } catch (error) {
      if (
        !configuration.failOpen
      ) {
        throw error;
      }

      return handler(
        createNoopSpan(
          'reconciliation.run'
        )
      );
    }
  }

  return handler(
    createNoopSpan(
      'reconciliation.run'
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Specialized convenience APIs                                              */
/* -------------------------------------------------------------------------- */

function traceJournalPost(
  metadata,
  handler,
  options = {}
) {
  return traceLedger(
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
  return traceLedger(
    'postJournalEntry',
    metadata,
    handler,
    options
  );
}

function traceLedgerReversal(
  metadata,
  handler,
  options = {}
) {
  return traceLedger(
    'reverseTransaction',
    metadata,
    handler,
    options
  );
}

function traceBalance(
  operation,
  metadata,
  handler,
  options = {}
) {
  return traceLedger(
    `balance.${operation}`,
    metadata,
    handler,
    options
  );
}

function traceProviderReconciliation(
  metadata,
  handler,
  options = {}
) {
  if (
    typeof reconciliationTracing
      .traceProviderReconciliation ===
    'function'
  ) {
    return reconciliationTracing.traceProviderReconciliation(
      metadata,
      handler,
      options
    );
  }

  return traceReconciliation(
    metadata,
    handler,
    options
  );
}

function traceSettlementReconciliation(
  metadata,
  handler,
  options = {}
) {
  if (
    typeof reconciliationTracing
      .traceSettlementReconciliation ===
    'function'
  ) {
    return reconciliationTracing.traceSettlementReconciliation(
      metadata,
      handler,
      options
    );
  }

  return traceReconciliation(
    metadata,
    handler,
    options
  );
}

function traceReconciliationRepair(
  metadata,
  handler,
  options = {}
) {
  if (
    typeof reconciliationTracing
      .traceRepair ===
    'function'
  ) {
    return reconciliationTracing.traceRepair(
      metadata,
      handler,
      options
    );
  }

  return traceReconciliation(
    {
      ...(metadata || {}),
      component: 'repair',
    },
    handler,
    options
  );
}

function traceReconciliationReplay(
  metadata,
  handler,
  options = {}
) {
  if (
    typeof reconciliationTracing
      .traceReplay ===
    'function'
  ) {
    return reconciliationTracing.traceReplay(
      metadata,
      handler,
      options
    );
  }

  return traceReconciliation(
    {
      ...(metadata || {}),
      component: 'replay',
    },
    handler,
    options
  );
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

function diagnostics() {
  const ledgerDiagnostics =
    safeCall(
      ledgerTracing,
      'diagnostics',
      [],
      {
        available:
          ledgerModule.available,

        operational:
          ledgerModule.operational,
      }
    );

  const reconciliationDiagnostics =
    safeCall(
      reconciliationTracing,
      'diagnostics',
      [],
      {
        available:
          reconciliationModule.available,

        operational:
          reconciliationModule.operational,
      }
    );

  return {
    module:
      MODULE_NAME,

    configured,

    enabled:
      configuration.enabled,

    failOpen:
      configuration.failOpen,

    serviceName:
      configuration.serviceName,

    environment:
      configuration.environment,

    version:
      configuration.version,

    timestamp:
      new Date().toISOString(),

    configuration: {
      tenantAware:
        configuration.tenantAware,

      correlationAware:
        configuration.correlationAware,

      propagationEnabled:
        configuration.propagationEnabled,
    },

    modules: {
      ledger: {
        enabled:
          configuration.modules
            .ledger !== false,

        available:
          ledgerModule.available,

        operational:
          ledgerModule.operational,

        diagnostics:
          ledgerDiagnostics,
      },

      reconciliation: {
        enabled:
          configuration.modules
            .reconciliation !==
          false,

        available:
          reconciliationModule.available,

        operational:
          reconciliationModule.operational,

        diagnostics:
          reconciliationDiagnostics,
      },
    },

    propagation: {
      enabled:
        configuration.propagationEnabled,

      traceId:
        getTraceId() || null,

      spanId:
        getSpanId() || null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

function health() {
  const result =
    diagnostics();

  const moduleStates = [
    {
      name: 'ledger',
      enabled:
        configuration.modules
          .ledger !== false,
      available:
        ledgerModule.available,
      operational:
        ledgerModule.operational,
    },

    {
      name: 'reconciliation',
      enabled:
        configuration.modules
          .reconciliation !== false,
      available:
        reconciliationModule.available,
      operational:
        reconciliationModule.operational,
    },
  ];

  const requiredModules =
    moduleStates.filter(
      (moduleValue) =>
        moduleValue.enabled
    );

  const healthy =
    !configuration.enabled ||
    requiredModules.every(
      (moduleValue) =>
        moduleValue.available &&
        moduleValue.operational
    );

  return {
    status: healthy
      ? 'healthy'
      : 'degraded',

    healthy,

    module:
      MODULE_NAME,

    timestamp:
      result.timestamp,

    serviceName:
      configuration.serviceName,

    environment:
      configuration.environment,

    version:
      configuration.version,

    enabled:
      configuration.enabled,

    failOpen:
      configuration.failOpen,

    modules:
      result.modules,

    tracing: {
      traceId:
        result.propagation.traceId,

      spanId:
        result.propagation.spanId,

      propagationEnabled:
        configuration.propagationEnabled,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Readiness                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Readiness is intentionally distinct from health.
 *
 * In a fail-open financial system, observability degradation should usually
 * not make the Finance application unready to process transactions.
 *
 * Therefore:
 *   ready = true when the observability layer can safely operate in either
 *           full or degraded/no-op mode.
 */
function ready() {
  return {
    ready: true,

    module:
      MODULE_NAME,

    timestamp:
      new Date().toISOString(),

    enabled:
      configuration.enabled,

    failOpen:
      configuration.failOpen,

    degraded:
      !health().healthy,
  };
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

function getStatus() {
  const healthResult =
    health();

  return {
    module:
      MODULE_NAME,

    state:
      healthResult.healthy
        ? 'operational'
        : 'degraded',

    ready:
      true,

    enabled:
      configuration.enabled,

    failOpen:
      configuration.failOpen,

    serviceName:
      configuration.serviceName,

    environment:
      configuration.environment,

    version:
      configuration.version,

    modules: {
      ledger: {
        enabled:
          configuration.modules
            .ledger !== false,

        available:
          ledgerModule.available,

        operational:
          ledgerModule.operational,
      },

      reconciliation: {
        enabled:
          configuration.modules
            .reconciliation !== false,

        available:
          reconciliationModule.available,

        operational:
          reconciliationModule.operational,
      },
    },

    timestamp:
      new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Module capability report                                                   */
/* -------------------------------------------------------------------------- */

function capabilities() {
  return {
    module:
      MODULE_NAME,

    tracing: {
      ledger:
        ledgerModule.available,

      reconciliation:
        reconciliationModule.available,
    },

    operations: {
      ledger: [
        'traceLedger',
        'traceJournalPost',
        'traceJournalEntry',
        'traceLedgerReversal',
        'traceBalance',
      ],

      reconciliation: [
        'traceReconciliation',
        'traceProviderReconciliation',
        'traceSettlementReconciliation',
        'traceReconciliationRepair',
        'traceReconciliationReplay',
      ],
    },

    propagation: {
      supported:
        true,

      enabled:
        configuration.propagationEnabled,
    },

    correlation: {
      supported:
        true,

      enabled:
        configuration.correlationAware,
    },

    tenantAwareness: {
      supported:
        true,

      enabled:
        configuration.tenantAware,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

module.exports = {
  /* Identity */
  MODULE_NAME,

  /* Configuration */
  configure,
  getConfig,

  /* Module registry */
  getModule,
  getLedgerTracing,
  getReconciliationTracing,

  /* Availability */
  isAvailable,
  isOperational,
  isEnabled,

  /* Generic tracing */
  withSpan,
  startSpan,
  endSpan,

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

  /* Span enrichment */
  setAttributes,
  addEvent,
  recordException,
  markSuccess,
  markFailure,

  /* Ledger convenience */
  traceLedger,
  traceJournalPost,
  traceJournalEntry,
  traceLedgerReversal,
  traceBalance,

  /* Reconciliation convenience */
  traceReconciliation,
  traceProviderReconciliation,
  traceSettlementReconciliation,
  traceReconciliationRepair,
  traceReconciliationReplay,

  /* Diagnostics */
  diagnostics,
  health,
  ready,
  getStatus,
  capabilities,

  /* Direct modules */
  ledgerTracing,
  reconciliationTracing,

  modules: {
    ledger:
      ledgerTracing,

    reconciliation:
      reconciliationTracing,
  },

  /* Module state */
  availability: {
    ledger:
      ledgerModule.available,

    reconciliation:
      reconciliationModule.available,
  },

  operationalState: {
    ledger:
      ledgerModule.operational,

    reconciliation:
      reconciliationModule.operational,
  },
};

/* -------------------------------------------------------------------------- */
/* Default initialization                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Eagerly apply environment/default configuration.
 *
 * This does NOT initialize OpenTelemetry itself.
 */
try {
  configure();
} catch (_error) {
  /*
   * The module remains usable in safe/no-op mode even if configuration cannot
   * be applied.
   */
  configured = false;
}