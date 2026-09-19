/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/diagnosticsService.js.js
 *
 * Architectural role
 * ------------------
 * Enterprise operational diagnostics boundary for Airtel payment intelligence.
 * Coordinates bounded, read-only health, readiness, contract, configuration,
 * dependency, repository, integrity and safety diagnostics across command-center
 * and intelligence services.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth, ledger, balance service, or settlement service.
 * - NOT an Airtel provider adapter and never owns provider credentials.
 * - NOT a payment execution, authorization, capture, refund, collection or transfer service.
 * - NOT a policy, governance, KYC, AML, sanctions, fraud, prediction or model-training engine.
 * - NOT an approval/maker-checker state machine and never grants approval.
 * - NOT an audit ledger; audit integration is append-only and diagnostic-only.
 * - NOT a notification transport and does not send external notifications.
 * - NOT a raw analytics warehouse, feature store or source-of-truth data store.
 * - NOT an arbitrary code execution framework.
 * - NOT allowed to mutate financial state, balances, ledger entries, provider state,
 *   policies, compliance cases, alerts, models, approvals or customer records.
 * - Does not interpret a failing dependency as permission to bypass that dependency.
 *
 * Production principles
 * ---------------------
 * - Airtel provider scope is fail-closed.
 * - Tenant scope is mandatory for tenant diagnostics unless an explicit system scope
 *   is requested and allowed by configuration.
 * - Every external diagnostic call is allow-listed, bounded and timeout protected.
 * - Dependency output is treated as untrusted operational evidence and normalized.
 * - Health, readiness and diagnostic errors never expose secrets, credentials,
 *   authentication material, raw provider payloads or unnecessary identifiers.
 * - Tenant/customer identifiers are represented by one-way digests in results.
 * - Diagnostic fingerprints exclude generated timestamps and run identifiers.
 * - Missing data is never silently converted into a successful zero.
 * - A component that reports financial/provider mutation from a supposedly read-only
 *   health boundary is considered unsafe and is not reported as healthy.
 * - Required dependency failures fail the overall diagnostic closed.
 * - Optional dependency failures degrade the diagnostic but remain visible.
 * - Parallel checks are bounded and result order remains deterministic.
 * - Payloads, check counts, dependency counts and export sizes are bounded.
 * - Persistence is injected; no database dependency is hard-coded here.
 * - No internal scheduler is created. Scheduling belongs to workers/job infrastructure.
 * - Returned records are deeply frozen after redaction and normalization.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-command-center-diagnostics-service';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const DIAGNOSTIC_SCOPE = Object.freeze({
  TENANT: 'TENANT',
  SYSTEM: 'SYSTEM',
});

export const DIAGNOSTIC_STATUS = Object.freeze({
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
  SKIPPED: 'SKIPPED',
  UNKNOWN: 'UNKNOWN',
});

export const DIAGNOSTIC_HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const DIAGNOSTIC_SEVERITY = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const DIAGNOSTIC_CHECK_TYPES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  CONTRACT: 'CONTRACT',
  DEPENDENCY: 'DEPENDENCY',
  REPOSITORY: 'REPOSITORY',
  SECURITY: 'SECURITY',
  TENANCY: 'TENANCY',
  INTEGRITY: 'INTEGRITY',
  AVAILABILITY: 'AVAILABILITY',
  SAFETY: 'SAFETY',
  CUSTOM: 'CUSTOM',
});

export const DIAGNOSTIC_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'DIAGNOSTICS_INVALID_INPUT',
  TENANT_REQUIRED: 'DIAGNOSTICS_TENANT_REQUIRED',
  SYSTEM_SCOPE_FORBIDDEN: 'DIAGNOSTICS_SYSTEM_SCOPE_FORBIDDEN',
  PROVIDER_SCOPE_VIOLATION: 'DIAGNOSTICS_PROVIDER_SCOPE_VIOLATION',
  REPOSITORY_REQUIRED: 'DIAGNOSTICS_REPOSITORY_REQUIRED',
  REPOSITORY_UNAVAILABLE: 'DIAGNOSTICS_REPOSITORY_UNAVAILABLE',
  RANGE_INVALID: 'DIAGNOSTICS_RANGE_INVALID',
  RANGE_TOO_LARGE: 'DIAGNOSTICS_RANGE_TOO_LARGE',
  TIMEOUT: 'DIAGNOSTICS_TIMEOUT',
  SOURCE_UNAVAILABLE: 'DIAGNOSTICS_SOURCE_UNAVAILABLE',
  SOURCE_PROTOCOL_ERROR: 'DIAGNOSTICS_SOURCE_PROTOCOL_ERROR',
  SOURCE_UNSAFE: 'DIAGNOSTICS_SOURCE_UNSAFE',
  CHECK_NOT_FOUND: 'DIAGNOSTICS_CHECK_NOT_FOUND',
  DUPLICATE_CHECK: 'DIAGNOSTICS_DUPLICATE_CHECK',
  CHECK_FORBIDDEN: 'DIAGNOSTICS_CHECK_FORBIDDEN',
  TOO_MANY_CHECKS: 'DIAGNOSTICS_TOO_MANY_CHECKS',
  TOO_MANY_DEPENDENCIES: 'DIAGNOSTICS_TOO_MANY_DEPENDENCIES',
  PAYLOAD_TOO_LARGE: 'DIAGNOSTICS_PAYLOAD_TOO_LARGE',
  EXPORT_TOO_LARGE: 'DIAGNOSTICS_EXPORT_TOO_LARGE',
  IDEMPOTENCY_CONFLICT: 'DIAGNOSTICS_IDEMPOTENCY_CONFLICT',
  PERSISTENCE_FAILED: 'DIAGNOSTICS_PERSISTENCE_FAILED',
});

export const DIAGNOSTIC_SAFETY_FLAGS = Object.freeze({
  financialMutationPerformed: 'financialMutationPerformed',
  ledgerMutationPerformed: 'ledgerMutationPerformed',
  balanceMutationPerformed: 'balanceMutationPerformed',
  providerCallPerformed: 'providerCallPerformed',
  paymentExecutionPerformed: 'paymentExecutionPerformed',
  settlementPerformed: 'settlementPerformed',
  approvalGranted: 'approvalGranted',
  executionAuthorized: 'executionAuthorized',
  arbitraryCodeExecutionPerformed: 'arbitraryCodeExecutionPerformed',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  allowSystemScope: true,
  maxTenantIdLength: 160,
  defaultTimeoutMs: 5_000,
  maxTimeoutMs: 30_000,
  maxChecks: 100,
  maxDependencies: 50,
  maxConcurrency: 8,
  maxResultBytes: 512 * 1024,
  maxExportBytes: 4 * 1024 * 1024,
  maxEvidenceItems: 100,
  maxHistoryLimit: 100,
  defaultHistoryLimit: 20,
  maxReasonLength: 500,
  maxNameLength: 160,
  maxDescriptionLength: 500,
  requireRepository: true,
  persistRuns: true,
  auditRuns: false,
  failClosedOnRequiredFailure: true,
  failClosedOnUnsafeSource: true,
  failClosedOnRepositoryError: true,
  requireComponentInfoForConfiguredSource: false,
  requireHealthContractForConfiguredSource: false,
  requireTenantIsolationDeclaration: false,
});

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /otp/i,
  /pin/i,
  /cvv/i,
  /cvc/i,
  /pan/i,
  /private.?key/i,
  /api.?key/i,
  /access.?key/i,
  /credential/i,
  /signature/i,
  /raw.?payload/i,
  /raw.?request/i,
  /raw.?response/i,
]);

const IDENTIFIER_KEY_PATTERNS = Object.freeze([
  /^phone$/i,
  /phone(number)?/i,
  /msisdn/i,
  /email/i,
  /national.?id/i,
  /^nin$/i,
  /account(number)?/i,
  /bank.?account/i,
  /wallet(number|id)?/i,
  /customer(number|id)?/i,
  /device.?id/i,
  /\bip(?:address)?\b/i,
  /tenant.?id/i,
  /user.?id/i,
  /actor.?id/i,
]);

const FORBIDDEN_CHECK_PATTERNS = Object.freeze([
  /execute/i,
  /settle/i,
  /transfer/i,
  /refund/i,
  /collect/i,
  /debit/i,
  /credit/i,
  /withdraw/i,
  /deposit/i,
  /capture/i,
  /authorize/i,
  /provider.?call/i,
  /ledger.?mutat/i,
  /balance.?mutat/i,
  /approval.?grant/i,
  /send.?notification/i,
  /write.?payment/i,
  /delete/i,
  /update.?customer/i,
]);

const HEALTH_METHODS = Object.freeze([
  'readiness',
  'health',
  'healthCheck',
]);

const COMPONENT_INFO_METHOD = 'getComponentInfo';

const DEFAULT_DEPENDENCY_DEFINITIONS = Object.freeze([
  {
    name: 'governanceDashboard',
    label: 'Governance Dashboard',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: true,
    capability: 'tenant-scoped governance read model',
  },
  {
    name: 'dashboardAggregator',
    label: 'Dashboard Aggregator',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'command-center aggregation read model',
  },
  {
    name: 'complianceCenter',
    label: 'Compliance Center',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'compliance posture and case read model',
  },
  {
    name: 'alertManager',
    label: 'Alert Manager',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'alerting read model',
  },
  {
    name: 'agentOrchestrator',
    label: 'Agent Orchestrator',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'bounded command-center agent coordination',
  },
  {
    name: 'modelDriftMonitor',
    label: 'Model Drift Monitor',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'model-risk and drift monitoring',
  },
  {
    name: 'explainabilityStore',
    label: 'Explainability Store',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'decision explainability evidence',
  },
  {
    name: 'auditLedger',
    label: 'Decision Audit Ledger',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'append-only governance audit evidence',
  },
  {
    name: 'governanceService',
    label: 'Decision Governance Service',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'governance orchestration',
  },
  {
    name: 'policyEngine',
    label: 'Decision Policy Engine',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'policy evaluation',
  },
  {
    name: 'approvalWorkflow',
    label: 'Approval Workflow',
    type: DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
    required: false,
    capability: 'maker-checker lifecycle',
  },
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label = 'value') {
  if (!isPlainObject(value)) {
    throw new DiagnosticsServiceError(
      DIAGNOSTIC_ERROR_CODES.INVALID_INPUT,
      `${label} must be a plain object.`,
    );
  }
}

function isPromiseLike(value) {
  return Boolean(value && typeof value.then === 'function');
}

function normalizeString(value, maxLength = 200) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function upper(value, maxLength = 80) {
  const normalized = normalizeString(value, maxLength);
  return normalized ? normalized.toUpperCase() : undefined;
}

function toBoolean(value) {
  return value === true;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toInteger(
  value,
  fallback,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function iso(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function nowFrom(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const normalized = iso(value);
  if (!normalized) return new Date().toISOString();
  return normalized;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')}`;
}

function stableNormalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '[NaN]';
    if (!Number.isFinite(value)) return value > 0 ? '[Infinity]' : '[-Infinity]';
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === 'bigint') return `${value}n`;

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return iso(value, null);
  }

  if (Buffer.isBuffer(value)) {
    return `buffer:${digest(value.toString('base64'))}`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item, seen));
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (seen.has(value)) return '[Circular]';

  seen.add(value);

  const output = {};

  for (const key of Object.keys(value).sort()) {
    output[key] = stableNormalize(value[key], seen);
  }

  seen.delete(value);

  return output;
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  return createHash(HASH_ALGORITHM)
    .update(stableStringify(value), 'utf8')
    .digest('hex');
}

function safeBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function safePercent(numerator, denominator) {
  const numeratorValue = finiteNumber(numerator, null);
  const denominatorValue = finiteNumber(denominator, null);

  if (
    numeratorValue === null ||
    denominatorValue === null ||
    denominatorValue <= 0
  ) {
    return null;
  }

  return Number(((numeratorValue / denominatorValue) * 100).toFixed(4));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }

  return Object.freeze(value);
}

function redact(value, options = {}, seen = new WeakMap()) {
  const maxArrayItems = options.maxArrayItems ?? 100;
  const maxObjectKeys = options.maxObjectKeys ?? 100;
  const maxStringLength = options.maxStringLength ?? 2_000;

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > maxStringLength
      ? value.slice(0, maxStringLength)
      : value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[REDACTED_BUFFER:${digest(value.toString('base64')).slice(-16)}]`;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (Array.isArray(value)) {
    seen.set(value, true);

    const result = value
      .slice(0, maxArrayItems)
      .map((item) => redact(item, options, seen));

    seen.delete(value);

    if (value.length > maxArrayItems) {
      result.push(`[TRUNCATED:${value.length - maxArrayItems}]`);
    }

    return result;
  }

  seen.set(value, true);

  const result = {};

  const keys = Object.keys(value)
    .sort()
    .slice(0, maxObjectKeys);

  for (const key of keys) {
    if (
      SENSITIVE_KEY_PATTERNS.some(
        (pattern) => pattern.test(key),
      )
    ) {
      result[key] = '[REDACTED]';
      continue;
    }

    if (
      IDENTIFIER_KEY_PATTERNS.some(
        (pattern) => pattern.test(key),
      )
    ) {
      const identifier = normalizeString(value[key], 600);

      result[key] = identifier
        ? digest(identifier)
        : undefined;

      continue;
    }

    result[key] = redact(value[key], options, seen);
  }

  if (Object.keys(value).length > keys.length) {
    result.__truncatedKeys =
      Object.keys(value).length - keys.length;
  }

  seen.delete(value);

  return result;
}

function safeError(error, maxMessageLength = 500) {
  if (!error) return null;

  const code =
    normalizeString(error.code, 160) ??
    null;

  const name =
    normalizeString(error.name, 120) ??
    'Error';

  const message =
    normalizeString(error.message, maxMessageLength) ??
    'Unknown error';

  return redact({
    name,
    code,
    message,
  });
}

function normalizeStatus(
  value,
  fallback = DIAGNOSTIC_STATUS.UNKNOWN,
) {
  const normalized = upper(value, 40);

  return Object.values(DIAGNOSTIC_STATUS).includes(normalized)
    ? normalized
    : fallback;
}

function normalizeSeverity(
  value,
  fallback = DIAGNOSTIC_SEVERITY.INFO,
) {
  const normalized = upper(value, 40);

  return Object.values(DIAGNOSTIC_SEVERITY).includes(normalized)
    ? normalized
    : fallback;
}

function severityRank(value) {
  const order = [
    DIAGNOSTIC_SEVERITY.INFO,
    DIAGNOSTIC_SEVERITY.LOW,
    DIAGNOSTIC_SEVERITY.MEDIUM,
    DIAGNOSTIC_SEVERITY.HIGH,
    DIAGNOSTIC_SEVERITY.CRITICAL,
  ];

  return order.indexOf(
    normalizeSeverity(value),
  );
}

function statusRank(value) {
  const order = [
    DIAGNOSTIC_STATUS.PASS,
    DIAGNOSTIC_STATUS.SKIPPED,
    DIAGNOSTIC_STATUS.UNKNOWN,
    DIAGNOSTIC_STATUS.WARN,
    DIAGNOSTIC_STATUS.FAIL,
  ];

  return order.indexOf(
    normalizeStatus(value),
  );
}

function validateProvider(
  provider,
  expected = PROVIDER,
) {
  return upper(provider, 80) === upper(expected, 80);
}

function normalizeTenantId(
  value,
  maxLength,
) {
  return normalizeString(
    value,
    maxLength,
  );
}

function hasUnsafeSafetyFlags(value) {
  if (!isPlainObject(value)) return [];

  return Object.values(
    DIAGNOSTIC_SAFETY_FLAGS,
  ).filter(
    (key) =>
      value[key] === true,
  );
}

function extractSafetyFlags(value) {
  const input =
    isPlainObject(value)
      ? value
      : {};

  return {
    financialMutationPerformed:
      input.financialMutationPerformed === true,

    ledgerMutationPerformed:
      input.ledgerMutationPerformed === true,

    balanceMutationPerformed:
      input.balanceMutationPerformed === true,

    providerCallPerformed:
      input.providerCallPerformed === true,

    paymentExecutionPerformed:
      input.paymentExecutionPerformed === true,

    settlementPerformed:
      input.settlementPerformed === true,

    approvalGranted:
      input.approvalGranted === true,

    executionAuthorized:
      input.executionAuthorized === true,

    arbitraryCodeExecutionPerformed:
      input.arbitraryCodeExecutionPerformed === true,
  };
}

function normalizeHealthState(value) {
  const normalized =
    upper(value, 40);

  if (
    normalized ===
    DIAGNOSTIC_HEALTH_STATES.HEALTHY
  ) {
    return normalized;
  }

  if (
    normalized ===
    DIAGNOSTIC_HEALTH_STATES.DEGRADED
  ) {
    return normalized;
  }

  if (
    normalized ===
    DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE
  ) {
    return normalized;
  }

  return undefined;
}

function deriveDependencyStatus(
  result,
  required = false,
) {
  if (!result?.configured) {
    return required
      ? DIAGNOSTIC_STATUS.FAIL
      : DIAGNOSTIC_STATUS.WARN;
  }

  if (result.unsafe) {
    return DIAGNOSTIC_STATUS.FAIL;
  }

  if (result.available === false) {
    return required
      ? DIAGNOSTIC_STATUS.FAIL
      : DIAGNOSTIC_STATUS.WARN;
  }

  if (
    result.healthState ===
    DIAGNOSTIC_HEALTH_STATES.DEGRADED
  ) {
    return DIAGNOSTIC_STATUS.WARN;
  }

  if (result.contractValid === false) {
    return DIAGNOSTIC_STATUS.FAIL;
  }

  if (result.available === true) {
    return DIAGNOSTIC_STATUS.PASS;
  }

  return DIAGNOSTIC_STATUS.UNKNOWN;
}

function timeoutPromise(
  promiseOrValue,
  timeoutMs,
  code = DIAGNOSTIC_ERROR_CODES.TIMEOUT,
) {
  const value =
    isPromiseLike(promiseOrValue)
      ? promiseOrValue
      : Promise.resolve(promiseOrValue);

  let timer;

  return new Promise(
    (resolve, reject) => {
      timer = setTimeout(
        () => {
          reject(
            new DiagnosticsServiceError(
              code,
              `Diagnostic operation timed out after ${timeoutMs} ms.`,
            ),
          );
        },
        timeoutMs,
      );

      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      value.then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    },
  );
}

function boundedSlice(values, limit) {
  return Array.isArray(values)
    ? values.slice(0, limit)
    : [];
}

function mergeConfig(
  base,
  override,
) {
  return Object.freeze({
    ...base,
    ...(isPlainObject(override)
      ? override
      : {}),
  });
}

function normalizeDependencyDefinition(
  definition,
  config,
) {
  assertPlainObject(
    definition,
    'dependency definition',
  );

  const name =
    normalizeString(
      definition.name,
      config.maxNameLength,
    );

  if (!name) {
    throw new DiagnosticsServiceError(
      DIAGNOSTIC_ERROR_CODES.INVALID_INPUT,
      'Dependency name is required.',
    );
  }

  return {
    name,

    label:
      normalizeString(
        definition.label ?? name,
        config.maxDescriptionLength,
      ) ?? name,

    type:
      upper(
        definition.type ??
          DIAGNOSTIC_CHECK_TYPES.DEPENDENCY,
        60,
      ),

    required:
      Boolean(definition.required),

    capability:
      normalizeString(
        definition.capability,
        config.maxDescriptionLength,
      ) ?? null,

    source:
      definition.source ?? null,

    healthMethods:
      Array.isArray(
        definition.healthMethods,
      )
        ? definition.healthMethods.filter(
          (method) =>
            HEALTH_METHODS.includes(
              method,
            ),
        )
        : [...HEALTH_METHODS],

    componentInfo:
      definition.componentInfo !== false,

    enabled:
      definition.enabled !== false,

    metadata:
      redact(
        definition.metadata ?? {},
      ),
  };
}

function normalizeCheckDefinition(
  definition,
  config,
) {
  assertPlainObject(
    definition,
    'diagnostic check definition',
  );

  const id =
    normalizeString(
      definition.id ?? definition.name,
      config.maxNameLength,
    );

  if (!id) {
    throw new DiagnosticsServiceError(
      DIAGNOSTIC_ERROR_CODES.INVALID_INPUT,
      'Diagnostic check id is required.',
    );
  }

  if (
    FORBIDDEN_CHECK_PATTERNS.some(
      (pattern) => pattern.test(id),
    )
  ) {
    throw new DiagnosticsServiceError(
      DIAGNOSTIC_ERROR_CODES.CHECK_FORBIDDEN,
      `Diagnostic check ${id} is outside the read-only command-center boundary.`,
      { checkId: id },
    );
  }

  const execute =
    definition.execute ??
    definition.run ??
    definition.check;

  if (typeof execute !== 'function') {
    throw new DiagnosticsServiceError(
      DIAGNOSTIC_ERROR_CODES.SOURCE_PROTOCOL_ERROR,
      `Diagnostic check ${id} must implement execute(context), run(context), or check(context).`,
    );
  }

  return {
    id,

    label:
      normalizeString(
        definition.label ?? id,
        config.maxNameLength,
      ) ?? id,

    type:
      upper(
        definition.type ??
          DIAGNOSTIC_CHECK_TYPES.CUSTOM,
        60,
      ),

    severity:
      normalizeSeverity(
        definition.severity,
        DIAGNOSTIC_SEVERITY.MEDIUM,
      ),

    required:
      Boolean(definition.required),

    enabled:
      definition.enabled !== false,

    readOnly:
      definition.readOnly !== false,

    timeoutMs:
      toInteger(
        definition.timeoutMs,
        config.defaultTimeoutMs,
        {
          min: 1,
          max: config.maxTimeoutMs,
        },
      ),

    execute,

    metadata:
      redact(
        definition.metadata ?? {},
      ),
  };
}

function buildFingerprintPayload(
  value,
  key = null,
) {
  if (
    key === 'generatedAt' ||
    key === 'startedAt' ||
    key === 'completedAt'
  ) {
    return undefined;
  }

  if (
    key === 'durationMs' ||
    key === 'runId'
  ) {
    return undefined;
  }

  if (
    key === 'replay' ||
    key === 'persistence' ||
    key === 'diagnosticFingerprint'
  ) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map(
        (item) =>
          buildFingerprintPayload(item),
      )
      .filter(
        (item) =>
          item !== undefined,
      );
  }

  if (isPlainObject(value)) {
    const output = {};

    for (
      const childKey of
      Object.keys(value).sort()
    ) {
      const child =
        buildFingerprintPayload(
          value[childKey],
          childKey,
        );

      if (
        child !== undefined
      ) {
        output[childKey] = child;
      }
    }

    return output;
  }

  return value;
}

function buildSemanticDiagnosticFingerprint(
  result,
) {
  return `sha256:${sha256(
    buildFingerprintPayload(
      result,
    ),
  )}`;
}

async function runWithConcurrency(
  items,
  worker,
  concurrency,
) {
  const results =
    new Array(items.length);

  let nextIndex = 0;

  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index,
          );
      } catch (error) {
        results[index] = {
          error,
        };
      }
    }
  }

  const workers = [];

  const workerCount =
    Math.min(
      Math.max(
        1,
        concurrency,
      ),
      items.length || 1,
    );

  for (
    let index = 0;
    index < workerCount;
    index += 1
  ) {
    workers.push(
      consume(),
    );
  }

  await Promise.all(
    workers,
  );

  return results;
}

function summarizeStatuses(
  checks,
) {
  const summary = {
    total: checks.length,
    pass: 0,
    warn: 0,
    fail: 0,
    skipped: 0,
    unknown: 0,
  };

  for (
    const check of checks
  ) {
    switch (
      normalizeStatus(
        check.status,
      )
    ) {
      case DIAGNOSTIC_STATUS.PASS:
        summary.pass += 1;
        break;

      case DIAGNOSTIC_STATUS.WARN:
        summary.warn += 1;
        break;

      case DIAGNOSTIC_STATUS.FAIL:
        summary.fail += 1;
        break;

      case DIAGNOSTIC_STATUS.SKIPPED:
        summary.skipped += 1;
        break;

      default:
        summary.unknown += 1;
        break;
    }
  }

  return summary;
}

function deriveOverallStatus(
  checks,
  config,
) {
  if (!checks.length) {
    return DIAGNOSTIC_STATUS.UNKNOWN;
  }

  if (
    checks.some(
      (check) =>
        check.status ===
          DIAGNOSTIC_STATUS.FAIL &&
        check.required,
    )
  ) {
    return config.failClosedOnRequiredFailure
      ? DIAGNOSTIC_STATUS.FAIL
      : DIAGNOSTIC_STATUS.WARN;
  }

  if (
    checks.some(
      (check) =>
        check.status ===
        DIAGNOSTIC_STATUS.FAIL,
    )
  ) {
    return DIAGNOSTIC_STATUS.FAIL;
  }

  if (
    checks.some(
      (check) =>
        check.status ===
        DIAGNOSTIC_STATUS.WARN,
    )
  ) {
    return DIAGNOSTIC_STATUS.WARN;
  }

  if (
    checks.every(
      (check) =>
        check.status ===
        DIAGNOSTIC_STATUS.SKIPPED,
    )
  ) {
    return DIAGNOSTIC_STATUS.SKIPPED;
  }

  if (
    checks.some(
      (check) =>
        check.status ===
        DIAGNOSTIC_STATUS.UNKNOWN,
    )
  ) {
    return DIAGNOSTIC_STATUS.UNKNOWN;
  }

  return DIAGNOSTIC_STATUS.PASS;
}

function deriveHealthState(
  status,
) {
  switch (status) {
    case DIAGNOSTIC_STATUS.PASS:
      return DIAGNOSTIC_HEALTH_STATES.HEALTHY;

    case DIAGNOSTIC_STATUS.WARN:
    case DIAGNOSTIC_STATUS.SKIPPED:
    case DIAGNOSTIC_STATUS.UNKNOWN:
      return DIAGNOSTIC_HEALTH_STATES.DEGRADED;

    case DIAGNOSTIC_STATUS.FAIL:
    default:
      return DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE;
  }
}

export class DiagnosticsServiceError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'DiagnosticsServiceError';

    this.code =
      code;

    this.details =
      redact(details);

    this.cause =
      options.cause ??
      undefined;

    this.statusCode =
      options.httpStatus ??
      500;
  }
}

export class InMemoryDiagnosticsRepository {
  constructor(seed = {}) {
    this.runs =
      Array.isArray(seed.runs)
        ? seed.runs.map(
          (run) =>
            redact(run),
        )
        : [];

    this.closed = false;
  }

  _assertOpen() {
    if (this.closed) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'Diagnostics repository is closed.',
      );
    }
  }

  async saveRun(record) {
    this._assertOpen();

    const normalized =
      redact(record);

    const existingIndex =
      this.runs.findIndex(
        (item) =>
          item.tenantScope ===
            normalized.tenantScope &&
          item.idempotencyKey &&
          normalized.idempotencyKey &&
          item.idempotencyKey ===
            normalized.idempotencyKey,
      );

    if (
      existingIndex >= 0
    ) {
      if (
        this.runs[existingIndex]
          .diagnosticFingerprint !==
        normalized.diagnosticFingerprint
      ) {
        throw new DiagnosticsServiceError(
          DIAGNOSTIC_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Diagnostics idempotency key maps to a different diagnostic fingerprint.',
        );
      }

      return {
        record:
          this.runs[
            existingIndex
          ],
        replay: true,
      };
    }

    this.runs.push(
      normalized,
    );

    return {
      record:
        normalized,
      replay: false,
    };
  }

  async findByIdempotencyKey({
    tenantScope,
    idempotencyKey,
  } = {}) {
    this._assertOpen();

    return (
      this.runs.find(
        (item) =>
          item.tenantScope ===
            tenantScope &&
          item.idempotencyKey ===
            idempotencyKey,
      ) ?? null
    );
  }

  async getRun({
    tenantScope,
    runId,
  } = {}) {
    this._assertOpen();

    return (
      this.runs.find(
        (item) =>
          item.tenantScope ===
            tenantScope &&
          item.runId ===
            runId,
      ) ?? null
    );
  }

  async listRuns({
    tenantScope,
    limit = 20,
    offset = 0,
  } = {}) {
    this._assertOpen();

    const filtered =
      this.runs
        .filter(
          (item) =>
            item.tenantScope ===
            tenantScope,
        )
        .sort(
          (
            left,
            right,
          ) =>
            String(
              right.completedAt ??
                right.generatedAt ??
                '',
            ).localeCompare(
              String(
                left.completedAt ??
                  left.generatedAt ??
                  '',
              ),
            ),
        );

    return filtered.slice(
      offset,
      offset + limit,
    );
  }

  async healthCheck() {
    return {
      ok:
        !this.closed,

      state:
        this.closed
          ? 'UNAVAILABLE'
          : 'HEALTHY',

      count:
        this.runs.length,
    };
  }

  async close() {
    this.closed = true;
  }
}

export class DiagnosticsService {
  constructor(options = {}) {
    assertPlainObject(
      options,
      'options',
    );

    this.config =
      mergeConfig(
        DEFAULT_CONFIG,
        options.config,
      );

    if (
      !validateProvider(
        this.config.provider,
      )
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Diagnostics service supports provider ${PROVIDER} only.`,
        {
          provider:
            this.config.provider,
        },
        {
          httpStatus: 400,
        },
      );
    }

    this.repository =
      options.repository ??
      options.diagnosticsRepository ??
      null;

    if (
      !this.repository &&
      this.config.requireRepository
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.REPOSITORY_REQUIRED,
        'A durable diagnostics repository must be injected in production.',
      );
    }

    this.logger =
      options.logger ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.audit =
      options.audit ??
      options.decisionAuditLedger ??
      null;

    this.clock =
      typeof options.clock ===
      'function'
        ? options.clock
        : () => new Date();

    this.runIdFactory =
      typeof options.runIdFactory ===
      'function'
        ? options.runIdFactory
        : () =>
          `diagnostic-run-${Date.now()}-${sha256(
            `${Date.now()}-${Math.random()}`,
          ).slice(0, 20)}`;

    this.sources =
      Object.freeze({
        governanceDashboard:
          options.governanceDashboard ??
          null,

        dashboardAggregator:
          options.dashboardAggregator ??
          null,

        complianceCenter:
          options.complianceCenter ??
          null,

        alertManager:
          options.alertManager ??
          null,

        agentOrchestrator:
          options.agentOrchestrator ??
          null,

        modelDriftMonitor:
          options.modelDriftMonitor ??
          null,

        explainabilityStore:
          options.explainabilityStore ??
          null,

        auditLedger:
          options.auditLedger ??
          options.decisionAuditLedger ??
          null,

        governanceService:
          options.governanceService ??
          options.decisionGovernanceService ??
          null,

        policyEngine:
          options.policyEngine ??
          options.decisionPolicyEngine ??
          null,

        approvalWorkflow:
          options.approvalWorkflow ??
          null,
      });

    const configuredDefinitions =
      Array.isArray(
        options.dependencies,
      )
        ? options.dependencies
        : DEFAULT_DEPENDENCY_DEFINITIONS;

    if (
      configuredDefinitions.length >
      this.config.maxDependencies
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.TOO_MANY_DEPENDENCIES,
        `At most ${this.config.maxDependencies} diagnostic dependencies are allowed.`,
      );
    }

    this.dependencies =
      new Map();

    for (
      const definition of
      configuredDefinitions
    ) {
      const normalized =
        normalizeDependencyDefinition(
          {
            ...definition,
            source:
              definition.source ??
              this.sources[
                definition.name
              ] ??
              null,
          },
          this.config,
        );

      if (
        this.dependencies.has(
          normalized.name,
        )
      ) {
        throw new DiagnosticsServiceError(
          DIAGNOSTIC_ERROR_CODES.DUPLICATE_CHECK,
          `Diagnostic dependency ${normalized.name} is already registered.`,
        );
      }

      this.dependencies.set(
        normalized.name,
        normalized,
      );
    }

    this.checks =
      new Map();

    this._registerBuiltInChecks();

    const customChecks =
      Array.isArray(options.checks)
        ? options.checks
        : [];

    for (
      const check of
      customChecks
    ) {
      this.registerCheck(
        check,
      );
    }

    this._validateConfiguredDependencies();
  }

  _validateConfiguredDependencies() {
    for (
      const definition of
      this.dependencies.values()
    ) {
      if (
        !definition.enabled
      ) {
        continue;
      }

      const source =
        definition.source;

      if (
        source &&
        typeof source ===
          'object'
      ) {
        continue;
      }

      if (
        definition.required &&
        this.config
          .failClosedOnRequiredFailure
      ) {
        continue;
      }
    }
  }

  _registerBuiltInChecks() {
    const builtIns = [
      {
        id:
          'configuration.provider-scope',

        label:
          'Provider scope',

        type:
          DIAGNOSTIC_CHECK_TYPES.CONFIGURATION,

        severity:
          DIAGNOSTIC_SEVERITY.CRITICAL,

        required:
          true,

        execute:
          async () => ({
            status:
              validateProvider(
                this.config.provider,
              )
                ? DIAGNOSTIC_STATUS.PASS
                : DIAGNOSTIC_STATUS.FAIL,

            severity:
              validateProvider(
                this.config.provider,
              )
                ? DIAGNOSTIC_SEVERITY.INFO
                : DIAGNOSTIC_SEVERITY.CRITICAL,

            reason:
              validateProvider(
                this.config.provider,
              )
                ? `Provider scope is ${PROVIDER}.`
                : `Configured provider is outside the Airtel diagnostics boundary.`,

            evidence: {
              providerScope:
                PROVIDER,

              configuredProvider:
                upper(
                  this.config.provider,
                ),
            },
          }),
      },

      {
        id:
          'configuration.bounds',

        label:
          'Operational bounds',

        type:
          DIAGNOSTIC_CHECK_TYPES.CONFIGURATION,

        severity:
          DIAGNOSTIC_SEVERITY.HIGH,

        required:
          true,

        execute:
          async () => {
            const failures = [];

            if (
              this.config.maxChecks < 1
            ) {
              failures.push(
                'maxChecks',
              );
            }

            if (
              this.config.maxDependencies < 1
            ) {
              failures.push(
                'maxDependencies',
              );
            }

            if (
              this.config.maxConcurrency < 1
            ) {
              failures.push(
                'maxConcurrency',
              );
            }

            if (
              this.config.maxResultBytes < 1
            ) {
              failures.push(
                'maxResultBytes',
              );
            }

            if (
              this.config.maxExportBytes <
              this.config.maxResultBytes
            ) {
              failures.push(
                'maxExportBytes',
              );
            }

            if (
              this.config.maxTimeoutMs <
              this.config.defaultTimeoutMs
            ) {
              failures.push(
                'maxTimeoutMs',
              );
            }

            return {
              status:
                failures.length
                  ? DIAGNOSTIC_STATUS.FAIL
                  : DIAGNOSTIC_STATUS.PASS,

              severity:
                failures.length
                  ? DIAGNOSTIC_SEVERITY.HIGH
                  : DIAGNOSTIC_SEVERITY.INFO,

              reason:
                failures.length
                  ? `Invalid diagnostics bounds: ${failures.join(', ')}.`
                  : 'Diagnostic execution bounds are configured.',

              evidence: {
                maxChecks:
                  this.config.maxChecks,

                maxDependencies:
                  this.config.maxDependencies,

                maxConcurrency:
                  this.config.maxConcurrency,

                maxResultBytes:
                  this.config.maxResultBytes,

                maxExportBytes:
                  this.config.maxExportBytes,

                defaultTimeoutMs:
                  this.config.defaultTimeoutMs,

                maxTimeoutMs:
                  this.config.maxTimeoutMs,
              },
            };
          },
      },

      {
        id:
          'repository.availability',

        label:
          'Diagnostics repository',

        type:
          DIAGNOSTIC_CHECK_TYPES.REPOSITORY,

        severity:
          DIAGNOSTIC_SEVERITY.CRITICAL,

        required:
          this.config.requireRepository,

        execute:
          async () => {
            if (
              !this.repository
            ) {
              return {
                status:
                  this.config.requireRepository
                    ? DIAGNOSTIC_STATUS.FAIL
                    : DIAGNOSTIC_STATUS.WARN,

                severity:
                  this.config.requireRepository
                    ? DIAGNOSTIC_SEVERITY.CRITICAL
                    : DIAGNOSTIC_SEVERITY.MEDIUM,

                reason:
                  'Diagnostics persistence repository is not configured.',

                evidence: {
                  configured:
                    false,
                },
              };
            }

            const health =
              await this._callHealthMethod(
                this.repository,
                {
                  name:
                    'diagnosticsRepository',

                  timeoutMs:
                    this.config.defaultTimeoutMs,

                  healthMethods:
                    [
                      ...HEALTH_METHODS,
                    ],
                },
              );

            const unsafeFlags =
              hasUnsafeSafetyFlags(
                health.result?.safety,
              );

            const status =
              health.error
                ? DIAGNOSTIC_STATUS.FAIL
                : unsafeFlags.length &&
                  this.config.failClosedOnUnsafeSource
                  ? DIAGNOSTIC_STATUS.FAIL
                  : health.available === false
                    ? DIAGNOSTIC_STATUS.FAIL
                    : health.healthState ===
                      DIAGNOSTIC_HEALTH_STATES.DEGRADED
                      ? DIAGNOSTIC_STATUS.WARN
                      : DIAGNOSTIC_STATUS.PASS;

            return {
              status,

              severity:
                status ===
                DIAGNOSTIC_STATUS.PASS
                  ? DIAGNOSTIC_SEVERITY.INFO
                  : DIAGNOSTIC_SEVERITY.CRITICAL,

              reason:
                health.error
                  ? 'Diagnostics repository health check failed.'
                  : unsafeFlags.length
                    ? 'Diagnostics repository reported forbidden side-effect indicators.'
                    : health.available === false
                      ? 'Diagnostics repository is unavailable.'
                      : 'Diagnostics repository is available.',

              evidence: {
                configured:
                  true,

                method:
                  health.method,

                available:
                  health.available,

                healthState:
                  health.healthState ??
                  null,

                repositoryHealth:
                  health.result ??
                  null,

                unsafeFlags,
              },

              error:
                health.error,
            };
          },
      },

      {
        id:
          'contract.sources',

        label:
          'Dependency contracts',

        type:
          DIAGNOSTIC_CHECK_TYPES.CONTRACT,

        severity:
          DIAGNOSTIC_SEVERITY.HIGH,

        required:
          false,

        execute:
          async (
            context,
          ) => {
            const dependencies =
              await this._inspectDependencies(
                context,
              );

            const failures =
              dependencies.filter(
                (item) =>
                  item.status ===
                  DIAGNOSTIC_STATUS.FAIL,
              );

            const warnings =
              dependencies.filter(
                (item) =>
                  item.status ===
                  DIAGNOSTIC_STATUS.WARN,
              );

            return {
              status:
                failures.length
                  ? DIAGNOSTIC_STATUS.FAIL
                  : warnings.length
                    ? DIAGNOSTIC_STATUS.WARN
                    : DIAGNOSTIC_STATUS.PASS,

              severity:
                failures.length
                  ? DIAGNOSTIC_SEVERITY.HIGH
                  : DIAGNOSTIC_SEVERITY.INFO,

              reason:
                failures.length
                  ? `${failures.length} configured dependency contract(s) failed.`
                  : warnings.length
                    ? `${warnings.length} configured dependency contract(s) are degraded or unavailable.`
                    : 'Configured dependency contracts are available.',

              evidence: {
                dependencies,

                configuredCount:
                  dependencies.filter(
                    (item) =>
                      item.configured,
                  ).length,

                availableCount:
                  dependencies.filter(
                    (item) =>
                      item.available,
                  ).length,

                requiredFailureCount:
                  dependencies.filter(
                    (item) =>
                      item.required &&
                      item.status ===
                        DIAGNOSTIC_STATUS.FAIL,
                  ).length,
              },
            };
          },
      },

      {
        id:
          'safety.read-only-boundary',

        label:
          'Read-only safety boundary',

        type:
          DIAGNOSTIC_CHECK_TYPES.SAFETY,

        severity:
          DIAGNOSTIC_SEVERITY.CRITICAL,

        required:
          true,

        execute:
          async () => ({
            status:
              DIAGNOSTIC_STATUS.PASS,

            severity:
              DIAGNOSTIC_SEVERITY.INFO,

            reason:
              'Diagnostics service does not execute provider or financial operations.',

            evidence: {
              financialMutationPerformed:
                false,

              ledgerMutationPerformed:
                false,

              balanceMutationPerformed:
                false,

              providerCallPerformed:
                false,

              paymentExecutionPerformed:
                false,

              settlementPerformed:
                false,

              approvalGranted:
                false,

              executionAuthorized:
                false,

              arbitraryCodeExecutionPerformed:
                false,
            },
          }),
      },

      {
        id:
          'tenancy.context',

        label:
          'Tenant scope',

        type:
          DIAGNOSTIC_CHECK_TYPES.TENANCY,

        severity:
          DIAGNOSTIC_SEVERITY.CRITICAL,

        required:
          true,

        execute:
          async (
            context,
          ) => ({
            status:
              context.scope ===
                DIAGNOSTIC_SCOPE.SYSTEM ||
              context.tenantId
                ? DIAGNOSTIC_STATUS.PASS
                : DIAGNOSTIC_STATUS.FAIL,

            severity:
              context.scope ===
                DIAGNOSTIC_SCOPE.SYSTEM ||
              context.tenantId
                ? DIAGNOSTIC_SEVERITY.INFO
                : DIAGNOSTIC_SEVERITY.CRITICAL,

            reason:
              context.scope ===
                DIAGNOSTIC_SCOPE.SYSTEM
                ? 'System diagnostics scope is explicit and enabled.'
                : context.tenantId
                  ? 'Tenant diagnostics scope is explicit.'
                  : 'Tenant diagnostics scope is missing.',

            evidence: {
              scope:
                context.scope,

              tenantDigest:
                context.tenantId
                  ? digest(
                    context.tenantId,
                  )
                  : null,

              tenantRequired:
                this.config
                  .tenantRequired,
            },
          }),
      },
    ];

    for (
      const definition of
      builtIns
    ) {
      this.checks.set(
        definition.id,
        normalizeCheckDefinition(
          definition,
          this.config,
        ),
      );
    }
  }

  registerCheck(
    definition = {},
  ) {
    const normalized =
      normalizeCheckDefinition(
        definition,
        this.config,
      );

    if (
      this.checks.has(
        normalized.id,
      )
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.DUPLICATE_CHECK,
        `Diagnostic check ${normalized.id} is already registered.`,
        {
          checkId:
            normalized.id,
        },
      );
    }

    if (
      !normalized.readOnly
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.CHECK_FORBIDDEN,
        `Diagnostic check ${normalized.id} must be declared read-only.`,
        {
          checkId:
            normalized.id,
        },
      );
    }

    if (
      this.checks.size >=
      this.config.maxChecks
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.TOO_MANY_CHECKS,
        `At most ${this.config.maxChecks} diagnostic checks are allowed.`,
      );
    }

    this.checks.set(
      normalized.id,
      normalized,
    );

    return deepFreeze({
      id:
        normalized.id,

      label:
        normalized.label,

      type:
        normalized.type,

      severity:
        normalized.severity,

      required:
        normalized.required,

      enabled:
        normalized.enabled,

      timeoutMs:
        normalized.timeoutMs,
    });
  }

  unregisterCheck(
    checkId,
  ) {
    const normalizedId =
      normalizeString(
        checkId,
        this.config.maxNameLength,
      );

    if (!normalizedId) {
      return false;
    }

    if (
      normalizedId.startsWith(
        'configuration.',
      ) ||
      normalizedId.startsWith(
        'repository.',
      ) ||
      normalizedId.startsWith(
        'safety.',
      ) ||
      normalizedId.startsWith(
        'tenancy.',
      ) ||
      normalizedId.startsWith(
        'contract.',
      )
    ) {
      return false;
    }

    return this.checks.delete(
      normalizedId,
    );
  }

  listChecks() {
    return deepFreeze(
      [
        ...this.checks.values(),
      ].map(
        (check) => ({
          id:
            check.id,

          label:
            check.label,

          type:
            check.type,

          severity:
            check.severity,

          required:
            check.required,

          enabled:
            check.enabled,

          timeoutMs:
            check.timeoutMs,

          readOnly:
            check.readOnly,

          metadata:
            redact(
              check.metadata,
            ),
        }),
      ),
    );
  }

  registerDependency(
    definition = {},
  ) {
    const normalized =
      normalizeDependencyDefinition(
        definition,
        this.config,
      );

    if (
      this.dependencies.has(
        normalized.name,
      )
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.DUPLICATE_CHECK,
        `Diagnostic dependency ${normalized.name} is already registered.`,
      );
    }

    if (
      this.dependencies.size >=
      this.config.maxDependencies
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.TOO_MANY_DEPENDENCIES,
        `At most ${this.config.maxDependencies} diagnostic dependencies are allowed.`,
      );
    }

    this.dependencies.set(
      normalized.name,
      normalized,
    );

    return deepFreeze({
      name:
        normalized.name,

      label:
        normalized.label,

      required:
        normalized.required,

      enabled:
        normalized.enabled,

      capability:
        normalized.capability,
    });
  }

  listDependencies() {
    return deepFreeze(
      [
        ...this.dependencies.values(),
      ].map(
        (dependency) => ({
          name:
            dependency.name,

          label:
            dependency.label,

          type:
            dependency.type,

          required:
            dependency.required,

          enabled:
            dependency.enabled,

          capability:
            dependency.capability,

          configured:
            Boolean(
              dependency.source,
            ),

          healthMethods:
            [
              ...dependency.healthMethods,
            ],

          componentInfoEnabled:
            dependency.componentInfo,

          metadata:
            redact(
              dependency.metadata,
            ),
        }),
      ),
    );
  }

  _tenantScope({
    tenantId,
    scope,
  } = {}) {
    const normalizedScope =
      upper(
        scope ??
          DIAGNOSTIC_SCOPE.TENANT,
        40,
      );

    if (
      !Object.values(
        DIAGNOSTIC_SCOPE,
      ).includes(
        normalizedScope,
      )
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.INVALID_INPUT,
        `Unsupported diagnostics scope ${normalizedScope}.`,
      );
    }

    if (
      normalizedScope ===
      DIAGNOSTIC_SCOPE.SYSTEM
    ) {
      if (
        !this.config.allowSystemScope
      ) {
        throw new DiagnosticsServiceError(
          DIAGNOSTIC_ERROR_CODES.SYSTEM_SCOPE_FORBIDDEN,
          'System diagnostics scope is disabled.',
        );
      }

      return {
        scope:
          normalizedScope,

        tenantId:
          null,

        tenantScope:
          'SYSTEM',
      };
    }

    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
        this.config.maxTenantIdLength,
      );

    if (
      this.config.tenantRequired &&
      !normalizedTenantId
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required for tenant-scoped diagnostics.',
        {},
        {
          httpStatus: 400,
        },
      );
    }

    return {
      scope:
        normalizedScope,

      tenantId:
        normalizedTenantId ??
        null,

      tenantScope:
        normalizedTenantId
          ? digest(
            normalizedTenantId,
          )
          : 'TENANT:UNSPECIFIED',
    };
  }

  _provider(
    provider,
  ) {
    const normalized =
      upper(
        provider ??
          PROVIDER,
        80,
      );

    if (
      !validateProvider(
        normalized,
      )
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Diagnostics service supports provider ${PROVIDER} only.`,
        {
          provider:
            normalized,
        },
        {
          httpStatus: 400,
        },
      );
    }

    return PROVIDER;
  }

  _metric(
    name,
    labels = {},
    value = 1,
  ) {
    const metricName =
      normalizeString(
        name,
        200,
      );

    if (!metricName) {
      return;
    }

    try {
      if (
        typeof this.metrics?.increment ===
        'function'
      ) {
        this.metrics.increment(
          metricName,
          labels,
          value,
        );
      } else if (
        typeof this.metrics?.inc ===
        'function'
      ) {
        this.metrics.inc(
          metricName,
          labels,
          value,
        );
      } else if (
        typeof this.metrics?.observe ===
        'function'
      ) {
        this.metrics.observe(
          metricName,
          value,
          labels,
        );
      }
    } catch (error) {
      this._log(
        'warn',
        'Diagnostic metric emission failed.',
        error,
        {
          metricName,
        },
      );
    }
  }

  _log(
    level,
    message,
    error = null,
    context = {},
  ) {
    const payload =
      redact({
        component:
          COMPONENT,

        ...context,

        ...(error
          ? {
            error:
              safeError(
                error,
              ),
          }
          : {}),
      });

    const logger =
      this.logger;

    if (!logger) {
      return;
    }

    const fn =
      typeof logger[level] ===
      'function'
        ? logger[level]
        : typeof logger.info ===
          'function'
          ? logger.info
          : null;

    if (fn) {
      try {
        fn.call(
          logger,
          payload,
          message,
        );
      } catch {
        // Logging must never change diagnostic outcomes.
      }
    }
  }

  async _audit(
    event,
  ) {
    if (
      !this.config.auditRuns ||
      !this.audit
    ) {
      return;
    }

    const method =
      this.audit.append ??
      this.audit.record ??
      this.audit.write ??
      this.audit.audit;

    if (
      typeof method !==
      'function'
    ) {
      return;
    }

    try {
      await timeoutPromise(
        method.call(
          this.audit,
          redact({
            component:
              COMPONENT,

            provider:
              PROVIDER,

            category:
              'DIAGNOSTICS',

            eventType:
              event.eventType ??
              'DIAGNOSTIC_RUN_COMPLETED',

            tenantId:
              event.tenantId
                ? digest(
                  event.tenantId,
                )
                : null,

            scope:
              event.scope,

            runId:
              event.runId,

            status:
              event.status,

            diagnosticFingerprint:
              event.diagnosticFingerprint,

            counts:
              event.counts,
          }),
        ),
        this.config
          .defaultTimeoutMs,
      );
    } catch (error) {
      this._log(
        'warn',
        'Diagnostic audit append failed.',
        error,
        {
          runId:
            event.runId,
        },
      );
    }
  }

  async _callHealthMethod(
    source,
    {
      name,
      timeoutMs,
      healthMethods = [
        ...HEALTH_METHODS,
      ],
    } = {},
  ) {
    if (
      !source ||
      typeof source !==
        'object'
    ) {
      return {
        configured:
          false,

        available:
          false,

        method:
          null,

        result:
          null,

        healthState:
          DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE,

        contractValid:
          false,

        unsafe:
          false,

        error:
          null,
      };
    }

    let selectedMethod =
      null;

    for (
      const methodName of
      healthMethods
    ) {
      if (
        typeof source[
          methodName
        ] === 'function'
      ) {
        selectedMethod =
          methodName;

        break;
      }
    }

    if (
      !selectedMethod
    ) {
      return {
        configured:
          true,

        available:
          false,

        method:
          null,

        result:
          null,

        healthState:
          DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE,

        contractValid:
          false,

        unsafe:
          false,

        error:
          new DiagnosticsServiceError(
            DIAGNOSTIC_ERROR_CODES.SOURCE_PROTOCOL_ERROR,
            `${name} does not expose a supported health/readiness method.`,
          ),
      };
    }

    try {
      const raw =
        await timeoutPromise(
          source[
            selectedMethod
          ].call(source),
          timeoutMs,
        );

      const result =
        isPlainObject(raw)
          ? redact(raw)
          : null;

      const contractValid =
        isPlainObject(raw);

      const safety =
        extractSafetyFlags(
          raw?.safety ??
            raw,
        );

      const unsafeFlags =
        hasUnsafeSafetyFlags(
          raw?.safety ??
            raw,
        );

      const state =
        normalizeHealthState(
          raw?.state,
        );

      const explicitOk =
        raw?.ok === true;

      const explicitFailure =
        raw?.ok === false;

      const available =
        explicitFailure
          ? false
          : state ===
              DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE
            ? false
            : explicitOk ||
              state ===
                DIAGNOSTIC_HEALTH_STATES.HEALTHY ||
              state ===
                DIAGNOSTIC_HEALTH_STATES.DEGRADED
              ? true
              : contractValid;

      return {
        configured:
          true,

        available,

        method:
          selectedMethod,

        result,

        healthState:
          state,

        contractValid,

        safety,

        unsafe:
          unsafeFlags.length >
          0,

        unsafeFlags,

        error:
          null,
      };
    } catch (error) {
      return {
        configured:
          true,

        available:
          false,

        method:
          selectedMethod,

        result:
          null,

        healthState:
          DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE,

        contractValid:
          true,

        unsafe:
          false,

        unsafeFlags:
          [],

        error:
          safeError(
            error,
          ),
      };
    }
  }

  async _callComponentInfo(
    source,
    {
      name,
      timeoutMs,
    } = {},
  ) {
    if (
      !source ||
      typeof source.getComponentInfo !==
        'function'
    ) {
      return {
        available:
          false,

        contractValid:
          !this.config
            .requireComponentInfoForConfiguredSource,

        result:
          null,

        error:
          null,
      };
    }

    try {
      const raw =
        await timeoutPromise(
          source[
            COMPONENT_INFO_METHOD
          ](),
          timeoutMs,
        );

      const result =
        isPlainObject(raw)
          ? redact(raw)
          : null;

      return {
        available:
          true,

        contractValid:
          isPlainObject(raw),

        result,

        error:
          null,
      };
    } catch (error) {
      return {
        available:
          false,

        contractValid:
          false,

        result:
          null,

        error:
          safeError(
            error,
          ),
      };
    }
  }

  _validateSourceSafety(
    name,
    healthResult,
    componentInfo,
  ) {
    const issues = [];

    const unsafeFlags =
      healthResult?.unsafeFlags ??
      [];

    if (
      unsafeFlags.length
    ) {
      issues.push(
        `Health boundary reported forbidden side-effect indicators: ${unsafeFlags.join(', ')}`,
      );
    }

    const info =
      componentInfo?.result;

    if (
      isPlainObject(info)
    ) {
      const forbiddenCapabilities = [
        [
          'executesPayments',
          true,
        ],
        [
          'callsProvider',
          true,
        ],
        [
          'settlesPayments',
          true,
        ],
        [
          'mutatesLedger',
          true,
        ],
        [
          'mutatesBalances',
          true,
        ],
        [
          'grantsApproval',
          true,
        ],
        [
          'arbitraryCodeExecution',
          true,
        ],
        [
          'financialExecution',
          true,
        ],
        [
          'providerCalls',
          true,
        ],
        [
          'ledgerMutation',
          true,
        ],
        [
          'approvalGrant',
          true,
        ],
      ];

      for (
        const [
          key,
          forbiddenValue,
        ] of forbiddenCapabilities
      ) {
        if (
          info[key] ===
          forbiddenValue
        ) {
          issues.push(
            `${name} component info reports forbidden capability ${key}.`,
          );
        }
      }
    }

    return issues;
  }

  async _inspectDependency(
    definition,
    context,
  ) {
    const source =
      definition.source;

    if (
      !definition.enabled
    ) {
      return {
        name:
          definition.name,

        label:
          definition.label,

        required:
          definition.required,

        enabled:
          false,

        configured:
          false,

        available:
          false,

        contractValid:
          true,

        status:
          DIAGNOSTIC_STATUS.SKIPPED,

        healthState:
          null,

        method:
          null,

        unsafe:
          false,

        unsafeFlags:
          [],

        reason:
          'Dependency diagnostics are disabled.',
      };
    }

    if (!source) {
      return {
        name:
          definition.name,

        label:
          definition.label,

        required:
          definition.required,

        enabled:
          true,

        configured:
          false,

        available:
          false,

        contractValid:
          false,

        status:
          definition.required
            ? DIAGNOSTIC_STATUS.FAIL
            : DIAGNOSTIC_STATUS.WARN,

        healthState:
          DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE,

        method:
          null,

        unsafe:
          false,

        unsafeFlags:
          [],

        reason:
          definition.required
            ? 'Required dependency is not configured.'
            : 'Optional dependency is not configured.',
      };
    }

    const health =
      await this._callHealthMethod(
        source,
        {
          name:
            definition.name,

          timeoutMs:
            context.timeoutMs,

          healthMethods:
            definition.healthMethods,
        },
      );

    const componentInfo =
      definition.componentInfo
        ? await this._callComponentInfo(
          source,
          {
            name:
              definition.name,

            timeoutMs:
              context.timeoutMs,
          },
        )
        : null;

    const safetyIssues =
      this._validateSourceSafety(
        definition.name,
        health,
        componentInfo,
      );

    const healthProvider =
      upper(
        health.result?.provider,
        80,
      );

    const infoProvider =
      upper(
        componentInfo?.result?.provider,
        80,
      );

    if (
      healthProvider &&
      !validateProvider(
        healthProvider,
      )
    ) {
      safetyIssues.push(
        `${definition.name} health boundary reports provider ${healthProvider}, outside the Airtel diagnostics scope.`,
      );
    }

    if (
      infoProvider &&
      !validateProvider(
        infoProvider,
      )
    ) {
      safetyIssues.push(
        `${definition.name} component info reports provider ${infoProvider}, outside the Airtel diagnostics scope.`,
      );
    }

    const tenantIsolationDeclared =
      componentInfo?.result?.tenantIsolation === true ||
      componentInfo?.result?.supportsTenantIsolation === true ||
      health.result?.tenantIsolation === true ||
      health.result?.sources?.tenantIsolation?.configured === true;

    const tenantIsolationFailure =
      context.scope ===
        DIAGNOSTIC_SCOPE.TENANT &&
      this.config
        .requireTenantIsolationDeclaration &&
      !tenantIsolationDeclared;

    if (
      tenantIsolationFailure
    ) {
      safetyIssues.push(
        'Tenant-scoped diagnostics require an explicit tenant-isolation declaration.',
      );
    }

    let status =
      deriveDependencyStatus(
        {
          ...health,
          unsafe:
            safetyIssues.length >
              0 ||
            health.unsafe,
        },
        definition.required,
      );

    if (
      health.error
    ) {
      status =
        definition.required
          ? DIAGNOSTIC_STATUS.FAIL
          : DIAGNOSTIC_STATUS.WARN;
    }

    if (
      tenantIsolationFailure
    ) {
      status =
        definition.required
          ? DIAGNOSTIC_STATUS.FAIL
          : DIAGNOSTIC_STATUS.WARN;
    }

    if (
      this.config
        .failClosedOnUnsafeSource &&
      safetyIssues.length
    ) {
      status =
        DIAGNOSTIC_STATUS.FAIL;
    }

    return {
      name:
        definition.name,

      label:
        definition.label,

      required:
        definition.required,

      enabled:
        definition.enabled,

      configured:
        true,

      available:
        Boolean(
          health.available,
        ),

      contractValid:
        Boolean(
          health.contractValid,
        ) &&
        Boolean(
          componentInfo?.contractValid ??
            true,
        ),

      status,

      healthState:
        health.healthState ??
        null,

      method:
        health.method ??
        null,

      componentInfo:
        componentInfo?.result ??
        null,

      health:
        health.result ??
        null,

      unsafe:
        Boolean(
          health.unsafe ||
            safetyIssues.length,
        ),

      unsafeFlags:
        boundedSlice(
          [
            ...new Set(
              [
                ...(health.unsafeFlags ??
                  []),

                ...safetyIssues,
              ],
            ),
          ],
          this.config
            .maxEvidenceItems,
        ),

      tenantIsolationDeclared,

      capability:
        definition.capability,

      reason:
        health.error
          ? 'Dependency health/readiness check failed.'
          : safetyIssues.length
            ? 'Dependency reported an unsafe read-only boundary.'
            : status ===
              DIAGNOSTIC_STATUS.PASS
              ? 'Dependency is available and within the read-only diagnostics contract.'
              : status ===
                DIAGNOSTIC_STATUS.WARN
                ? 'Dependency is configured but degraded, incomplete or unavailable.'
                : 'Dependency contract is not acceptable for production diagnostics.',

      error:
        health.error ??
        componentInfo?.error ??
        null,

      metadata:
        redact(
          definition.metadata,
        ),
    };
  }

  async _inspectDependencies(
    context,
  ) {
    const definitions =
      [
        ...this.dependencies.values(),
      ].filter(
        (dependency) =>
          dependency.enabled,
      );

    const bounded =
      definitions.slice(
        0,
        this.config.maxDependencies,
      );

    const results =
      await runWithConcurrency(
        bounded,
        (definition) =>
          this._inspectDependency(
            definition,
            context,
          ),
        this.config.maxConcurrency,
      );

    return results.map(
      (
        result,
        index,
      ) => {
        if (result?.error) {
          const definition =
            bounded[index];

          return {
            name:
              definition.name,

            label:
              definition.label,

            required:
              definition.required,

            enabled:
              definition.enabled,

            configured:
              Boolean(
                definition.source,
              ),

            available:
              false,

            contractValid:
              false,

            status:
              definition.required
                ? DIAGNOSTIC_STATUS.FAIL
                : DIAGNOSTIC_STATUS.WARN,

            healthState:
              DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE,

            method:
              null,

            unsafe:
              false,

            unsafeFlags:
              [],

            reason:
              'Dependency diagnostic worker failed.',

            error:
              safeError(
                result.error,
              ),
          };
        }

        return result;
      },
    );
  }

  _normalizeCheckResult(
    definition,
    rawResult,
    context,
  ) {
    const raw =
      isPlainObject(
        rawResult,
      )
        ? rawResult
        : {
          status:
            DIAGNOSTIC_STATUS.UNKNOWN,

          severity:
            definition.severity,

          reason:
            'Diagnostic check returned a non-object result.',

          evidence: {
            valueType:
              typeof rawResult,
          },
        };

    let status =
      normalizeStatus(
        raw.status,
        DIAGNOSTIC_STATUS.UNKNOWN,
      );

    let severity =
      normalizeSeverity(
        raw.severity,
        definition.severity,
      );

    const unsafeFlags =
      hasUnsafeSafetyFlags(
        raw.safety ??
          raw,
      );

    if (
      unsafeFlags.length
    ) {
      status =
        this.config
          .failClosedOnUnsafeSource
          ? DIAGNOSTIC_STATUS.FAIL
          : status ===
            DIAGNOSTIC_STATUS.PASS
            ? DIAGNOSTIC_STATUS.WARN
            : status;

      severity =
        severityRank(
          severity,
        ) <
        severityRank(
          DIAGNOSTIC_SEVERITY.HIGH,
        )
          ? DIAGNOSTIC_SEVERITY.HIGH
          : severity;
    }

    const reason =
      normalizeString(
        raw.reason ??
          raw.message,
        this.config
          .maxReasonLength,
      ) ?? null;

    const evidence =
      redact(
        raw.evidence ??
          raw.details ??
          {},
      );

    const evidenceItems =
      Array.isArray(evidence)
        ? boundedSlice(
          evidence,
          this.config
            .maxEvidenceItems,
        )
        : evidence;

    const result = {
      id:
        definition.id,

      label:
        definition.label,

      type:
        definition.type,

      status,

      severity,

      required:
        definition.required,

      durationMs:
        finiteNumber(
          raw.durationMs,
          null,
        ),

      reason,

      error:
        raw.error
          ? safeError(
            raw.error,
          )
          : null,

      evidence:
        evidenceItems,

      safety:
        extractSafetyFlags(
          raw.safety ??
            raw,
        ),

      context: {
        scope:
          context.scope,

        tenantDigest:
          context.tenantId
            ? digest(
              context.tenantId,
            )
            : null,

        provider:
          PROVIDER,
      },

      metadata:
        redact(
          definition.metadata,
        ),
    };

    const bytes =
      safeBytes(result);

    if (
      bytes >
      this.config.maxResultBytes
    ) {
      result.evidence = {
        state:
          'TRUNCATED',

        digest:
          digest(
            stableStringify(
              evidenceItems,
            ),
          ),

        bytes,

        maxResultBytes:
          this.config.maxResultBytes,
      };
    }

    return result;
  }

  async _executeCheck(
    definition,
    context,
  ) {
    const startedAt =
      nowFrom(
        this.clock,
      );

    try {
      const rawResult =
        await timeoutPromise(
          definition.execute(
            Object.freeze({
              scope:
                context.scope,

              tenantId:
                context.tenantId,

              tenantDigest:
                context.tenantId
                  ? digest(
                    context.tenantId,
                  )
                  : null,

              provider:
                PROVIDER,

              runId:
                context.runId,

              timeoutMs:
                definition.timeoutMs,

              services:
                Object.freeze({
                  ...this.sources,
                }),

              dependencies:
                Object.freeze(
                  this.listDependencies(),
                ),
            }),
          ),
          definition.timeoutMs,
        );

      const result =
        this._normalizeCheckResult(
          definition,
          rawResult,
          context,
        );

      result.durationMs =
        Math.max(
          0,
          Math.round(
            Date.parse(
              nowFrom(
                this.clock,
              ),
            ) -
            Date.parse(
              startedAt,
            ),
          ),
        );

      return result;
    } catch (error) {
      const isTimeout =
        error?.code ===
        DIAGNOSTIC_ERROR_CODES.TIMEOUT;

      return {
        id:
          definition.id,

        label:
          definition.label,

        type:
          definition.type,

        status:
          definition.required
            ? DIAGNOSTIC_STATUS.FAIL
            : DIAGNOSTIC_STATUS.WARN,

        severity:
          isTimeout
            ? DIAGNOSTIC_SEVERITY.HIGH
            : definition.severity,

        required:
          definition.required,

        durationMs:
          Math.max(
            0,
            Date.parse(
              nowFrom(
                this.clock,
              ),
            ) -
            Date.parse(
              startedAt,
            ),
          ),

        reason:
          isTimeout
            ? 'Diagnostic check timed out.'
            : 'Diagnostic check failed.',

        error:
          safeError(
            error,
          ),

        evidence:
          {},

        safety:
          extractSafetyFlags(),

        context: {
          scope:
            context.scope,

          tenantDigest:
            context.tenantId
              ? digest(
                context.tenantId,
              )
              : null,

          provider:
            PROVIDER,
        },

        metadata:
          redact(
            definition.metadata,
          ),
      };
    }
  }

  _selectChecks(
    inputChecks,
  ) {
    const enabled =
      [
        ...this.checks.values(),
      ].filter(
        (check) =>
          check.enabled,
      );

    if (
      inputChecks ===
        undefined ||
      inputChecks === null
    ) {
      return enabled.slice(
        0,
        this.config.maxChecks,
      );
    }

    if (
      !Array.isArray(
        inputChecks,
      )
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.INVALID_INPUT,
        'checks must be an array when provided.',
      );
    }

    if (
      inputChecks.length >
      this.config.maxChecks
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.TOO_MANY_CHECKS,
        `At most ${this.config.maxChecks} checks may be requested.`,
      );
    }

    const selected = [];

    for (
      const item of
      inputChecks
    ) {
      const id =
        normalizeString(
          item,
          this.config.maxNameLength,
        );

      if (!id) {
        continue;
      }

      const check =
        this.checks.get(
          id,
        );

      if (!check) {
        throw new DiagnosticsServiceError(
          DIAGNOSTIC_ERROR_CODES.CHECK_NOT_FOUND,
          `Diagnostic check ${id} is not registered.`,
          {
            checkId:
              id,
          },
          {
            httpStatus: 404,
          },
        );
      }

      if (
        !check.enabled
      ) {
        continue;
      }

      selected.push(
        check,
      );
    }

    return selected;
  }

  _normalizeInput(
    input,
  ) {
    assertPlainObject(
      input,
      'input',
    );

    const scopeInfo =
      this._tenantScope(
        input,
      );

    const provider =
      this._provider(
        input.provider,
      );

    const timeoutMs =
      toInteger(
        input.timeoutMs,
        this.config
          .defaultTimeoutMs,
        {
          min: 1,
          max: this.config
            .maxTimeoutMs,
        },
      );

    const reason =
      normalizeString(
        input.reason,
        this.config
          .maxReasonLength,
      ) ?? null;

    const idempotencyKey =
      normalizeString(
        input.idempotencyKey,
        240,
      ) ?? null;

    return {
      ...scopeInfo,

      provider,

      timeoutMs,

      reason,

      idempotencyKey,

      requestedChecks:
        input.checks,

      metadata:
        redact(
          input.metadata ??
            {},
        ),
    };
  }

  async _loadReplay({
    tenantScope,
    idempotencyKey,
  }) {
    if (
      !this.repository ||
      !idempotencyKey ||
      typeof this.repository
        .findByIdempotencyKey !==
        'function'
    ) {
      return null;
    }

    try {
      return await this.repository
        .findByIdempotencyKey({
          tenantScope,
          idempotencyKey,
        });
    } catch (error) {
      this._log(
        'warn',
        'Diagnostics idempotency lookup failed.',
        error,
        {
          tenantScope,
        },
      );

      return null;
    }
  }

  _newRunId() {
    const value =
      this.runIdFactory();

    return (
      normalizeString(
        value,
        200,
      ) ??
      `diagnostic-run-${Date.now()}`
    );
  }

  async diagnose(
    input = {},
  ) {
    const normalized =
      this._normalizeInput(
        input,
      );

    const checks =
      this._selectChecks(
        normalized.requestedChecks,
      );

    if (
      checks.length >
      this.config.maxChecks
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.TOO_MANY_CHECKS,
        `At most ${this.config.maxChecks} checks are allowed.`,
      );
    }

    const requestFingerprint =
      `sha256:${sha256({
        scope:
          normalized.scope,

        tenantScope:
          normalized.tenantScope,

        provider:
          normalized.provider,

        timeoutMs:
          normalized.timeoutMs,

        requestedChecks:
          this._selectChecks(
            normalized.requestedChecks,
          )
            .map(
              (check) =>
                check.id,
            )
            .sort(),

        reason:
          normalized.reason,

        metadata:
          normalized.metadata,
      })}`;

    const replay =
      normalized.idempotencyKey
        ? await this._loadReplay({
          tenantScope:
            normalized.tenantScope,

          idempotencyKey:
            normalized.idempotencyKey,
        })
        : null;

    if (replay) {
      if (
        replay.requestFingerprint &&
        replay.requestFingerprint !==
          requestFingerprint
      ) {
        throw new DiagnosticsServiceError(
          DIAGNOSTIC_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Diagnostics idempotency key maps to a different diagnostic request.',
          {
            tenantScope:
              normalized.tenantScope,
          },
          {
            httpStatus: 409,
          },
        );
      }

      return deepFreeze({
        ...redact(
          replay,
        ),

        replay:
          true,

        replayedFromRunId:
          replay.runId ??
          null,
      });
    }

    const runId =
      this._newRunId();

    const startedAt =
      nowFrom(
        this.clock,
      );

    const context =
      Object.freeze({
        ...normalized,
        runId,
      });

    this._metric(
      'titech.airtel.diagnostics.started',
      {
        provider:
          PROVIDER,

        scope:
          normalized.scope,
      },
    );

    const executionResults =
      await runWithConcurrency(
        checks,
        (check) =>
          this._executeCheck(
            check,
            context,
          ),
        this.config
          .maxConcurrency,
      );

    const normalizedChecks =
      executionResults.map(
        (
          result,
          index,
        ) => {
          if (result?.error) {
            const check =
              checks[index];

            return {
              id:
                check.id,

              label:
                check.label,

              type:
                check.type,

              status:
                check.required
                  ? DIAGNOSTIC_STATUS.FAIL
                  : DIAGNOSTIC_STATUS.WARN,

              severity:
                check.required
                  ? DIAGNOSTIC_SEVERITY.HIGH
                  : check.severity,

              required:
                check.required,

              durationMs:
                null,

              reason:
                'Diagnostic worker failed before producing a result.',

              error:
                safeError(
                  result.error,
                ),

              evidence:
                {},

              safety:
                extractSafetyFlags(),

              context: {
                scope:
                  normalized.scope,

                tenantDigest:
                  normalized.tenantId
                    ? digest(
                      normalized.tenantId,
                    )
                    : null,

                provider:
                  PROVIDER,
              },

              metadata:
                redact(
                  check.metadata,
                ),
            };
          }

          return result;
        },
      );

    const completedAt =
      nowFrom(
        this.clock,
      );

    const status =
      deriveOverallStatus(
        normalizedChecks,
        this.config,
      );

    const counts =
      summarizeStatuses(
        normalizedChecks,
      );

    const highSeverityCount =
      normalizedChecks.filter(
        (check) =>
          severityRank(
            check.severity,
          ) >=
          severityRank(
            DIAGNOSTIC_SEVERITY.HIGH,
          ),
      ).length;

    const unsafeChecks =
      normalizedChecks.filter(
        (check) =>
          Object.values(
            check.safety ??
              {},
          ).some(Boolean),
      );

    const failedRequiredChecks =
      normalizedChecks.filter(
        (check) =>
          check.required &&
          check.status ===
            DIAGNOSTIC_STATUS.FAIL,
      );

    const result = {
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      runId,

      replay:
        false,

      scope:
        normalized.scope,

      tenantScope:
        normalized.tenantScope,

      tenantDigest:
        normalized.tenantId
          ? digest(
            normalized.tenantId,
          )
          : null,

      generatedAt:
        completedAt,

      startedAt,

      completedAt,

      durationMs:
        Math.max(
          0,
          Date.parse(
            completedAt,
          ) -
          Date.parse(
            startedAt,
          ),
        ),

      status,

      healthState:
        deriveHealthState(
          status,
        ),

      healthy:
        status ===
        DIAGNOSTIC_STATUS.PASS,

      degraded:
        status ===
          DIAGNOSTIC_STATUS.WARN ||
        status ===
          DIAGNOSTIC_STATUS.SKIPPED ||
        status ===
          DIAGNOSTIC_STATUS.UNKNOWN,

      unavailable:
        status ===
        DIAGNOSTIC_STATUS.FAIL,

      reason:
        normalized.reason,

      counts: {
        ...counts,

        highSeverity:
          highSeverityCount,

        unsafe:
          unsafeChecks.length,

        failedRequired:
          failedRequiredChecks.length,
      },

      checkRate: {
        passPercent:
          safePercent(
            counts.pass,
            counts.total,
          ),

        warnPercent:
          safePercent(
            counts.warn,
            counts.total,
          ),

        failPercent:
          safePercent(
            counts.fail,
            counts.total,
          ),
      },

      checks:
        normalizedChecks,

      configuration: {
        timeoutMs:
          normalized.timeoutMs,

        maxConcurrency:
          this.config
            .maxConcurrency,

        maxChecks:
          this.config
            .maxChecks,

        failClosedOnRequiredFailure:
          this.config
            .failClosedOnRequiredFailure,

        failClosedOnUnsafeSource:
          this.config
            .failClosedOnUnsafeSource,
      },

      safety: {
        readOnly:
          true,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        balanceMutationPerformed:
          false,

        providerCallPerformed:
          false,

        paymentExecutionPerformed:
          false,

        settlementPerformed:
          false,

        approvalGranted:
          false,

        executionAuthorized:
          false,

        arbitraryCodeExecutionPerformed:
          false,
      },

      metadata:
        normalized.metadata,

      requestFingerprint,
    };

    result.diagnosticFingerprint =
      buildSemanticDiagnosticFingerprint(
        redact(result),
      );

    const bytes =
      safeBytes(
        result,
      );

    if (
      bytes >
      this.config.maxResultBytes
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Diagnostic result exceeds ${this.config.maxResultBytes} bytes.`,
        {
          bytes,
          maxResultBytes:
            this.config
              .maxResultBytes,
        },
        {
          httpStatus: 413,
        },
      );
    }

    let persisted =
      false;

    let persistedReplay =
      false;

    let persistenceError =
      null;

    if (
      this.config.persistRuns &&
      this.repository &&
      typeof this.repository
        .saveRun ===
        'function'
    ) {
      try {
        const saveResult =
          await this.repository.saveRun(
            redact({
              ...result,

              idempotencyKey:
                normalized.idempotencyKey,
            }),
          );

        persisted =
          true;

        persistedReplay =
          Boolean(
            saveResult?.replay,
          );
      } catch (error) {
        persistenceError =
          safeError(
            error,
          );

        this._metric(
          'titech.airtel.diagnostics.persistence_failure',
          {
            provider:
              PROVIDER,
          },
        );

        this._log(
          'error',
          'Diagnostic run persistence failed.',
          error,
          {
            runId,
          },
        );

        if (
          this.config
            .failClosedOnRepositoryError
        ) {
          throw new DiagnosticsServiceError(
            DIAGNOSTIC_ERROR_CODES.PERSISTENCE_FAILED,
            'Diagnostic run persistence failed.',
            {
              runId,
            },
            {
              cause:
                error,
            },
          );
        }
      }
    }

    result.persistence = {
      attempted:
        Boolean(
          this.config.persistRuns &&
          this.repository,
        ),

      persisted,

      replay:
        persistedReplay,

      error:
        persistenceError,
    };

    await this._audit({
      eventType:
        'DIAGNOSTIC_RUN_COMPLETED',

      tenantId:
        normalized.tenantId,

      scope:
        normalized.scope,

      runId,

      status,

      diagnosticFingerprint:
        result.diagnosticFingerprint,

      counts:
        result.counts,
    });

    this._metric(
      'titech.airtel.diagnostics.completed',
      {
        provider:
          PROVIDER,

        scope:
          normalized.scope,

        status,
      },
    );

    return deepFreeze(
      redact(
        result,
      ),
    );
  }

  async run(
    input = {},
  ) {
    return this.diagnose(
      input,
    );
  }

  async check(
    input = {},
  ) {
    return this.diagnose(
      input,
    );
  }

  async getDiagnostics(
    input = {},
  ) {
    return this.diagnose(
      input,
    );
  }

  async listRuns({
    tenantId,
    scope =
      DIAGNOSTIC_SCOPE.TENANT,
    limit =
      this.config
        .defaultHistoryLimit,
    offset = 0,
  } = {}) {
    const scopeInfo =
      this._tenantScope({
        tenantId,
        scope,
      });

    const boundedLimit =
      toInteger(
        limit,
        this.config
          .defaultHistoryLimit,
        {
          min: 1,
          max: this.config
            .maxHistoryLimit,
        },
      );

    const boundedOffset =
      toInteger(
        offset,
        0,
        {
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        },
      );

    if (
      !this.repository ||
      typeof this.repository
        .listRuns !==
        'function'
    ) {
      return deepFreeze({
        scope:
          scopeInfo.scope,

        tenantScope:
          scopeInfo.tenantScope,

        dataState:
          'UNAVAILABLE',

        records:
          [],

        limit:
          boundedLimit,

        offset:
          boundedOffset,
      });
    }

    const records =
      await this.repository.listRuns(
        {
          tenantScope:
            scopeInfo.tenantScope,

          limit:
            boundedLimit,

          offset:
            boundedOffset,
        },
      );

    return deepFreeze({
      scope:
        scopeInfo.scope,

      tenantScope:
        scopeInfo.tenantScope,

      dataState:
        records.length
          ? 'AVAILABLE'
          : 'EMPTY',

      records:
        records.map(
          (record) =>
            redact(record),
        ),

      limit:
        boundedLimit,

      offset:
        boundedOffset,
    });
  }

  async getRun({
    tenantId,
    scope =
      DIAGNOSTIC_SCOPE.TENANT,
    runId,
  } = {}) {
    const scopeInfo =
      this._tenantScope({
        tenantId,
        scope,
      });

    const normalizedRunId =
      normalizeString(
        runId,
        220,
      );

    if (
      !normalizedRunId
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.INVALID_INPUT,
        'runId is required.',
      );
    }

    if (
      !this.repository ||
      typeof this.repository
        .getRun !==
        'function'
    ) {
      return null;
    }

    const record =
      await this.repository.getRun(
        {
          tenantScope:
            scopeInfo.tenantScope,

          runId:
            normalizedRunId,
        },
      );

    return record
      ? deepFreeze(
        redact(
          record,
        ),
      )
      : null;
  }

  async exportDiagnostics(
    input = {},
  ) {
    const result =
      await this.diagnose(
        input,
      );

    const content =
      JSON.stringify(
        result,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        content,
        'utf8',
      );

    if (
      bytes >
      this.config.maxExportBytes
    ) {
      throw new DiagnosticsServiceError(
        DIAGNOSTIC_ERROR_CODES.EXPORT_TOO_LARGE,
        `Diagnostic export exceeds ${this.config.maxExportBytes} bytes.`,
        {
          bytes,
          maxExportBytes:
            this.config
              .maxExportBytes,
        },
        {
          httpStatus: 413,
        },
      );
    }

    return deepFreeze({
      contentType:
        'application/json',

      filename:
        `airtel-command-center-diagnostics-${result.scope.toLowerCase()}-${result.status.toLowerCase()}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          content,
        )}`,

      content,
    });
  }

  async health() {
    const repositoryConfigured =
      Boolean(
        this.repository,
      );

    let repository =
      null;

    if (
      this.repository
    ) {
      const result =
        await this._callHealthMethod(
          this.repository,
          {
            name:
              'diagnosticsRepository',

            timeoutMs:
              this.config
                .defaultTimeoutMs,

            healthMethods:
              [
                ...HEALTH_METHODS,
              ],
          },
        );

      repository = {
        configured:
          true,

        available:
          result.available,

        method:
          result.method,

        state:
          result.healthState ??
          (
            result.available
              ? DIAGNOSTIC_HEALTH_STATES.HEALTHY
              : DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE
          ),

        contractValid:
          result.contractValid,

        error:
          result.error,
      };
    } else {
      repository = {
        configured:
          false,

        available:
          false,

        method:
          null,

        state:
          DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE,

        contractValid:
          !this.config
            .requireRepository,

        error:
          this.config
            .requireRepository
            ? {
              name:
                'DiagnosticsServiceError',

              code:
                DIAGNOSTIC_ERROR_CODES
                  .REPOSITORY_REQUIRED,

              message:
                'Diagnostics repository is required but not configured.',
            }
            : null,
      };
    }

    const dependencyStatus =
      {};

    const configuredDependencies =
      [
        ...this.dependencies.values(),
      ].filter(
        (dependency) =>
          dependency.enabled,
      );

    const dependencyResults =
      await runWithConcurrency(
        configuredDependencies,
        (dependency) =>
          this._inspectDependency(
            dependency,
            {
              scope:
                DIAGNOSTIC_SCOPE.SYSTEM,

              tenantId:
                null,

              timeoutMs:
                this.config
                  .defaultTimeoutMs,

              runId:
                null,
            },
          ),
        this.config
          .maxConcurrency,
      );

    for (
      let index = 0;
      index <
        configuredDependencies.length;
      index += 1
    ) {
      const definition =
        configuredDependencies[
          index
        ];

      const item =
        dependencyResults[index]
          ?.error
          ? {
            name:
              definition.name,

            required:
              definition.required,

            configured:
              Boolean(
                definition.source,
              ),

            available:
              false,

            status:
              definition.required
                ? DIAGNOSTIC_STATUS.FAIL
                : DIAGNOSTIC_STATUS.WARN,

            error:
              safeError(
                dependencyResults[
                  index
                ].error,
              ),
          }
          : dependencyResults[
            index
          ];

      dependencyStatus[
        definition.name
      ] =
        redact(item);
    }

    const dependencyValues =
      Object.values(
        dependencyStatus,
      );

    const requiredFailures =
      dependencyValues.filter(
        (item) =>
          item.required &&
          item.status ===
            DIAGNOSTIC_STATUS.FAIL,
      ).length;

    const optionalFailures =
      dependencyValues.filter(
        (item) =>
          !item.required &&
          [
            DIAGNOSTIC_STATUS.FAIL,
            DIAGNOSTIC_STATUS.WARN,
          ].includes(
            item.status,
          ),
      ).length;

    const repositoryFailure =
      repository.available ===
        false &&
      this.config.requireRepository;

    const state =
      repositoryFailure ||
      requiredFailures > 0
        ? DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE
        : optionalFailures > 0
          ? DIAGNOSTIC_HEALTH_STATES.DEGRADED
          : DIAGNOSTIC_HEALTH_STATES.HEALTHY;

    return deepFreeze(
      redact({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        version:
          ENGINE_VERSION,

        schemaVersion:
          SCHEMA_VERSION,

        state,

        healthy:
          state ===
          DIAGNOSTIC_HEALTH_STATES.HEALTHY,

        degraded:
          state ===
          DIAGNOSTIC_HEALTH_STATES.DEGRADED,

        unavailable:
          state ===
          DIAGNOSTIC_HEALTH_STATES.UNAVAILABLE,

        repository:
          repositoryConfigured
            ? repository
            : {
              ...repository,
            },

        dependencies:
          dependencyStatus,

        dependencyAvailabilityRate:
          safePercent(
            dependencyValues.filter(
              (item) =>
                item.available,
            ).length,

            dependencyValues.filter(
              (item) =>
                item.configured,
            ).length,
          ),

        requiredDependencyFailures:
          requiredFailures,

        optionalDependencyWarnings:
          optionalFailures,

        checkRegistry: {
          registered:
            this.checks.size,

          enabled:
            [
              ...this.checks.values(),
            ].filter(
              (check) =>
                check.enabled,
            ).length,
        },

        safety: {
          readOnly:
            true,

          financialMutationPerformed:
            false,

          ledgerMutationPerformed:
            false,

          balanceMutationPerformed:
            false,

          providerCallPerformed:
            false,

          paymentExecutionPerformed:
            false,

          settlementPerformed:
            false,

          approvalGranted:
            false,

          executionAuthorized:
            false,

          arbitraryCodeExecutionPerformed:
            false,
        },
      }),
    );
  }

  async readiness() {
    return this.health();
  }

  getComponentInfo() {
    return Object.freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      tenantIsolation:
        true,

      systemDiagnostics:
        this.config
          .allowSystemScope,

      readOnly:
        true,

      boundedChecks:
        true,

      boundedConcurrency:
        true,

      boundedTimeouts:
        true,

      deterministicFingerprint:
        true,

      dependencyContractChecks:
        true,

      repositoryPersistence:
        Boolean(
          this.repository,
        ),

      auditIntegration:
        Boolean(
          this.audit &&
          this.config.auditRuns,
        ),

      financialMutation:
        false,

      ledgerMutation:
        false,

      balanceMutation:
        false,

      providerCalls:
        false,

      paymentExecution:
        false,

      settlement:
        false,

      approvalGrant:
        false,

      executionAuthorization:
        false,

      arbitraryCodeExecution:
        false,

      policyMutation:
        false,

      complianceMutation:
        false,

      alertMutation:
        false,

      modelMutation:
        false,

      internalScheduler:
        false,
    });
  }

  async close() {
    if (
      typeof this.repository?.close ===
      'function'
    ) {
      await this.repository.close();
    }
  }
}

export function createDiagnosticsService(
  options = {},
) {
  return new DiagnosticsService(
    options,
  );
}

export const createAirtelDiagnosticsService =
  createDiagnosticsService;

export const AirtelDiagnosticsService =
  DiagnosticsService;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    DIAGNOSTIC_SCOPE,
    DIAGNOSTIC_STATUS,
    DIAGNOSTIC_HEALTH_STATES,
    DIAGNOSTIC_SEVERITY,
    DIAGNOSTIC_CHECK_TYPES,
    DIAGNOSTIC_ERROR_CODES,
    DIAGNOSTIC_SAFETY_FLAGS,
  });

export function buildDiagnosticFingerprint(
  value,
) {
  return `sha256:${sha256(
    buildFingerprintPayload(
      value,
    ),
  )}`;
}

export default DiagnosticsService;