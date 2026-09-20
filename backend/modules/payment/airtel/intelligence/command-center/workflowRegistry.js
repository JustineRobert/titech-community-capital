/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Intelligence Workflow Registry
 * ============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/command-center/workflowRegistry.js
 *
 * Architectural role
 * ------------------
 * Declarative, versioned workflow-registry boundary for the Airtel payment
 * intelligence command center. The registry is the authoritative catalogue of
 * command-center workflow definitions and their lifecycle metadata. It makes
 * workflows discoverable, reviewable, tenant-scoped, provider-scoped and
 * execution-safe without becoming an execution engine itself.
 *
 * Responsibilities
 * ----------------
 * - Register immutable workflow definitions and explicit workflow versions.
 * - Validate workflow identity, provider scope, tenant scope and lifecycle data.
 * - Validate declarative steps, capabilities, triggers, policies and limits.
 * - Maintain active-version pointers without mutating historical definitions.
 * - Resolve the correct workflow version for an explicit or active request.
 * - Support tenant-scoped overrides while preserving Airtel provider isolation.
 * - Provide bounded list/get/search/resolve APIs for command-center consumers.
 * - Produce deterministic fingerprints for definitions and resolutions.
 * - Support durable persistence through an injected repository.
 * - Provide health/readiness/metrics/logging hooks through dependency injection.
 *
 * Non-responsibilities / important boundaries
 * --------------------------------------------
 * - NOT a workflow executor, worker, scheduler or queue consumer.
 * - NOT an arbitrary JavaScript/code execution runtime.
 * - NOT an Airtel API client or payment provider adapter.
 * - NOT a payment authorization, approval, settlement or ledger service.
 * - NOT a financial transaction state machine.
 * - NOT a retry engine; retry policy is declarative metadata only.
 * - NOT an AML/KYC/sanctions/fraud decision engine.
 * - NOT a governance policy engine or maker-checker authority.
 * - NOT allowed to mutate balances, payments, transactions or ledger entries.
 * - NOT allowed to turn an agent recommendation into financial authorization.
 * - NOT a replacement for durable audit/event infrastructure.
 *
 * Production principles
 * ---------------------
 * - Provider scope is fail-closed to AIRTEL.
 * - Tenant identity is mandatory for tenant-scoped workflows.
 * - Workflow versions are immutable once registered.
 * - Lifecycle changes affect pointers/status metadata, not historical versions.
 * - Only declarative handler keys may be registered; executable functions are
 *   rejected from persisted definitions.
 * - Step capabilities are allow-listed and bounded.
 * - Financially sensitive steps are marked as governed and can require approval,
 *   but this registry never performs the approval or execution itself.
 * - Secrets, credentials, authentication tokens and unnecessary PII are redacted.
 * - Arbitrary external URLs and dynamic module paths are not accepted by default.
 * - Workflow resolution is deterministic for identical inputs and registry state.
 * - Repository writes are tenant/provider scoped and idempotent where supported.
 * - Returned definitions and resolution objects are deeply frozen.
 *
 * Module format
 * -------------
 * Native ECMAScript module (ESM), Node.js 24+ compatible, Node built-ins only.
 * ============================================================================
 */

import crypto from 'node:crypto';

// =============================================================================
// Identity / constants
// =============================================================================

export const ENGINE_NAME = 'airtel-command-center-workflow-registry';
export const ENGINE_VERSION = '2.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const WORKFLOW_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  DEPRECATED: 'DEPRECATED',
  RETIRED: 'RETIRED',
});

export const WORKFLOW_SCOPE = Object.freeze({
  TENANT: 'TENANT',
  SYSTEM: 'SYSTEM',
});

export const WORKFLOW_TRIGGER = Object.freeze({
  MANUAL: 'MANUAL',
  API: 'API',
  EVENT: 'EVENT',
  SCHEDULED: 'SCHEDULED',
  ALERT: 'ALERT',
  INCIDENT: 'INCIDENT',
  SLA: 'SLA',
  GOVERNANCE: 'GOVERNANCE',
});

export const WORKFLOW_STEP_KIND = Object.freeze({
  INTELLIGENCE: 'INTELLIGENCE',
  VALIDATION: 'VALIDATION',
  GOVERNANCE: 'GOVERNANCE',
  APPROVAL: 'APPROVAL',
  NOTIFICATION: 'NOTIFICATION',
  RECONCILIATION: 'RECONCILIATION',
  OBSERVATION: 'OBSERVATION',
  HANDOFF: 'HANDOFF',
});

export const WORKFLOW_EXECUTION_MODE = Object.freeze({
  ADVISORY: 'ADVISORY',
  GOVERNED: 'GOVERNED',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
});

export const CAPABILITIES = Object.freeze({
  READ_PROVIDER_STATUS: 'READ_PROVIDER_STATUS',
  READ_PROVIDER_TELEMETRY: 'READ_PROVIDER_TELEMETRY',
  READ_OPERATIONAL_INTELLIGENCE: 'READ_OPERATIONAL_INTELLIGENCE',
  READ_INCIDENT_INTELLIGENCE: 'READ_INCIDENT_INTELLIGENCE',
  READ_SLA_INTELLIGENCE: 'READ_SLA_INTELLIGENCE',
  READ_COMPLIANCE_SIGNAL: 'READ_COMPLIANCE_SIGNAL',
  READ_GOVERNANCE_SIGNAL: 'READ_GOVERNANCE_SIGNAL',
  READ_RECONCILIATION_SIGNAL: 'READ_RECONCILIATION_SIGNAL',
  READ_RETRY_INTELLIGENCE: 'READ_RETRY_INTELLIGENCE',
  READ_MODEL_RISK: 'READ_MODEL_RISK',
  CREATE_ALERT: 'CREATE_ALERT',
  REQUEST_HUMAN_REVIEW: 'REQUEST_HUMAN_REVIEW',
  CREATE_NOTIFICATION_REQUEST: 'CREATE_NOTIFICATION_REQUEST',
  PREPARE_RECONCILIATION_CASE: 'PREPARE_RECONCILIATION_CASE',
  PREPARE_GOVERNANCE_CASE: 'PREPARE_GOVERNANCE_CASE',
  PREPARE_APPROVAL_REQUEST: 'PREPARE_APPROVAL_REQUEST',
  READ_DASHBOARD: 'READ_DASHBOARD',
});

export const FINANCIAL_CAPABILITIES = Object.freeze(new Set([
  'POST_PAYMENT',
  'SETTLE_PAYMENT',
  'REVERSE_PAYMENT',
  'REFUND_PAYMENT',
  'DEBIT_BALANCE',
  'CREDIT_BALANCE',
  'MUTATE_LEDGER',
  'AUTHORIZE_PAYMENT',
]));

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'WORKFLOW_REGISTRY_INVALID_INPUT',
  TENANT_REQUIRED: 'WORKFLOW_REGISTRY_TENANT_REQUIRED',
  TENANT_INVALID: 'WORKFLOW_REGISTRY_TENANT_INVALID',
  SYSTEM_SCOPE_FORBIDDEN: 'WORKFLOW_REGISTRY_SYSTEM_SCOPE_FORBIDDEN',
  PROVIDER_SCOPE_VIOLATION: 'WORKFLOW_REGISTRY_PROVIDER_SCOPE_VIOLATION',
  WORKFLOW_ID_REQUIRED: 'WORKFLOW_REGISTRY_WORKFLOW_ID_REQUIRED',
  WORKFLOW_ID_INVALID: 'WORKFLOW_REGISTRY_WORKFLOW_ID_INVALID',
  VERSION_INVALID: 'WORKFLOW_REGISTRY_VERSION_INVALID',
  VERSION_EXISTS: 'WORKFLOW_REGISTRY_VERSION_EXISTS',
  VERSION_NOT_FOUND: 'WORKFLOW_REGISTRY_VERSION_NOT_FOUND',
  WORKFLOW_NOT_FOUND: 'WORKFLOW_REGISTRY_WORKFLOW_NOT_FOUND',
  WORKFLOW_INACTIVE: 'WORKFLOW_REGISTRY_WORKFLOW_INACTIVE',
  DEFINITION_INVALID: 'WORKFLOW_REGISTRY_DEFINITION_INVALID',
  STEP_INVALID: 'WORKFLOW_REGISTRY_STEP_INVALID',
  CAPABILITY_INVALID: 'WORKFLOW_REGISTRY_CAPABILITY_INVALID',
  CAPABILITY_FORBIDDEN: 'WORKFLOW_REGISTRY_CAPABILITY_FORBIDDEN',
  HANDLER_INVALID: 'WORKFLOW_REGISTRY_HANDLER_INVALID',
  TRIGGER_INVALID: 'WORKFLOW_REGISTRY_TRIGGER_INVALID',
  PERSISTENCE_FAILED: 'WORKFLOW_REGISTRY_PERSISTENCE_FAILED',
  REPOSITORY_REQUIRED: 'WORKFLOW_REGISTRY_REPOSITORY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'WORKFLOW_REGISTRY_IDEMPOTENCY_CONFLICT',
  DEPENDENCY_CONFLICT: 'WORKFLOW_REGISTRY_DEPENDENCY_CONFLICT',
  INVALID_TRANSITION: 'WORKFLOW_REGISTRY_INVALID_TRANSITION',
  VERSION_POLICY_VIOLATION: 'WORKFLOW_REGISTRY_VERSION_POLICY_VIOLATION',
  PAYLOAD_TOO_LARGE: 'WORKFLOW_REGISTRY_PAYLOAD_TOO_LARGE',
  EXPORT_TOO_LARGE: 'WORKFLOW_REGISTRY_EXPORT_TOO_LARGE',
  CLOSED: 'WORKFLOW_REGISTRY_CLOSED',
});

const DEFAULT_LIMITS = Object.freeze({
  maxWorkflowIdLength: 120,
  maxVersionLength: 40,
  maxNameLength: 200,
  maxDescriptionLength: 2000,
  maxTenantIdLength: 160,
  maxHandlerKeyLength: 160,
  maxStepIdLength: 100,
  maxTriggerIdLength: 120,
  maxCapabilityCount: 32,
  maxStepCount: 50,
  maxTriggerCount: 20,
  maxDependencyCount: 20,
  maxMetadataKeys: 50,
  maxPayloadBytes: 512 * 1024,
  maxHistory: 100,
  defaultHistoryLimit: 20,
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  systemScopeAllowed: false,
  allowFinancialCapabilities: false,
  allowExternalUrls: false,
  allowDynamicModules: false,
  enforceImmutableVersions: true,
  persistDefinitions: true,
  requireRepository: false,
  maxPayloadBytes: DEFAULT_LIMITS.maxPayloadBytes,
  maxWorkflowIdLength: DEFAULT_LIMITS.maxWorkflowIdLength,
  maxVersionLength: DEFAULT_LIMITS.maxVersionLength,
  maxNameLength: DEFAULT_LIMITS.maxNameLength,
  maxDescriptionLength: DEFAULT_LIMITS.maxDescriptionLength,
  maxHandlerKeyLength: DEFAULT_LIMITS.maxHandlerKeyLength,
  maxStepIdLength: DEFAULT_LIMITS.maxStepIdLength,
  maxTriggerIdLength: DEFAULT_LIMITS.maxTriggerIdLength,
  maxCapabilityCount: DEFAULT_LIMITS.maxCapabilityCount,
  maxStepCount: DEFAULT_LIMITS.maxStepCount,
  maxTriggerCount: DEFAULT_LIMITS.maxTriggerCount,
  maxDependencyCount: DEFAULT_LIMITS.maxDependencyCount,
  maxMetadataKeys: DEFAULT_LIMITS.maxMetadataKeys,
  maxHistory: DEFAULT_LIMITS.maxHistory,
  defaultHistoryLimit: DEFAULT_LIMITS.defaultHistoryLimit,
});

const VALID_STATUSES = new Set(Object.values(WORKFLOW_STATUS));
const VALID_SCOPES = new Set(Object.values(WORKFLOW_SCOPE));
const VALID_TRIGGERS = new Set(Object.values(WORKFLOW_TRIGGER));
const VALID_STEP_KINDS = new Set(Object.values(WORKFLOW_STEP_KIND));
const VALID_EXECUTION_MODES = new Set(Object.values(WORKFLOW_EXECUTION_MODE));
const VALID_CAPABILITIES = new Set(Object.values(CAPABILITIES));

const SAFE_HANDLER_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{1,159}$/;
const WORKFLOW_ID_PATTERN = /^[a-z][a-z0-9._:-]{1,119}$/;
const VERSION_PATTERN = /^(0|[1-9]\d{0,5})(?:\.(0|[1-9]\d{0,5})){0,3}(?:[-+][A-Za-z0-9.-]{1,32})?$/;
const STEP_ID_PATTERN = /^[a-z][a-z0-9._:-]{1,99}$/;
const TRIGGER_ID_PATTERN = /^[a-z][a-z0-9._:-]{1,119}$/;

const TERMINAL_STATUSES = new Set([
  WORKFLOW_STATUS.DEPRECATED,
  WORKFLOW_STATUS.RETIRED,
]);

// =============================================================================
// Sensitive-data / structural helpers
// =============================================================================

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'set-cookie',
  'apiKey',
  'clientSecret',
  'privateKey',
  'otp',
  'pin',
  'cvv',
  'cardNumber',
  'accountNumber',
  'phoneNumber',
  'mobileNumber',
  'email',
  'nationalId',
  'nin',
]);

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Date)
    && !Buffer.isBuffer(value);
}

function normalizeString(value, max = 200) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : '';
}

function normalizeTenantId(value) {
  return normalizeString(value, DEFAULT_LIMITS.maxTenantIdLength);
}

function normalizeProvider(value) {
  return normalizeString(value, 32).toUpperCase();
}

function stableNormalize(value, depth = 0) {
  if (depth > 12) return '[MAX_DEPTH]';

  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BUFFER:${value.length}]`;
  if (typeof value === 'bigint') return `${value}n`;

  if (typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return String(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item, depth + 1));
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = stableNormalize(value[key], depth + 1);
  }
  return result;
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  return crypto
    .createHash(HASH_ALGORITHM)
    .update(
      typeof value === 'string' ? value : stableStringify(value),
      'utf8',
    )
    .digest('hex');
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    try {
      deepFreeze(value[key], seen);
    } catch {
      // Defensive best effort.
    }
  }

  try {
    Object.freeze(value);
  } catch {
    // Defensive best effort.
  }

  return value;
}

function redact(value, depth = 0, seen = new WeakSet()) {
  if (depth > 10) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BUFFER:${value.length}]`;
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 250).map((item) => redact(item, depth + 1, seen));
  }

  const output = {};

  for (const [key, item] of Object.entries(value).slice(0, 500)) {
    if (
      SENSITIVE_KEYS.has(key)
      || SENSITIVE_KEYS.has(key.toLowerCase())
      || /password|secret|token|authorization|cookie|private.?key|otp|pin|cvv/i.test(key)
    ) {
      output[key] = item == null ? null : '[REDACTED]';
      continue;
    }

    output[key] = redact(item, depth + 1, seen);
  }

  return output;
}

function safeBytes(value) {
  try {
    return Buffer.byteLength(stableStringify(redact(value)), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function versionKey(workflowId, version) {
  return `${workflowId}@${version}`;
}

function tenantKey(tenantId) {
  return normalizeTenantId(tenantId) || '__SYSTEM__';
}

function registryKey({ tenantId, workflowId, version }) {
  return `${tenantKey(tenantId)}:${versionKey(workflowId, version)}`;
}

function activePointerKey({ tenantId, workflowId }) {
  return `${tenantKey(tenantId)}:${workflowId}`;
}

function compareVersions(a, b) {
  const parse = (value) => {
    const core = String(value).split(/[-+]/)[0];
    return core.split('.').map((part) => Number(part));
  };

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return String(a).localeCompare(String(b));
}

function normalizeStatus(value, fallback = WORKFLOW_STATUS.DRAFT) {
  const normalized = normalizeString(value, 40).toUpperCase();
  return VALID_STATUSES.has(normalized) ? normalized : fallback;
}

function containsForbiddenUrl(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') {
    return /https?:\/\/|ftp:\/\//i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenUrl(item, depth + 1));
  }
  if (typeof value !== 'object') return false;
  return Object.values(value).some((item) => containsForbiddenUrl(item, depth + 1));
}

function containsDynamicModuleReference(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') {
    return /(?:^|[\s])(?:node:|file:|\.\.\/|\.\/|require\(|import\()/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsDynamicModuleReference(item, depth + 1));
  }
  if (typeof value !== 'object') return false;
  return Object.values(value).some((item) => containsDynamicModuleReference(item, depth + 1));
}

function transitionAllowed(from, to) {
  const allowed = {
    [WORKFLOW_STATUS.DRAFT]: new Set([
      WORKFLOW_STATUS.ACTIVE,
      WORKFLOW_STATUS.RETIRED,
    ]),
    [WORKFLOW_STATUS.ACTIVE]: new Set([
      WORKFLOW_STATUS.PAUSED,
      WORKFLOW_STATUS.DEPRECATED,
      WORKFLOW_STATUS.RETIRED,
    ]),
    [WORKFLOW_STATUS.PAUSED]: new Set([
      WORKFLOW_STATUS.ACTIVE,
      WORKFLOW_STATUS.DEPRECATED,
      WORKFLOW_STATUS.RETIRED,
    ]),
    [WORKFLOW_STATUS.DEPRECATED]: new Set([
      WORKFLOW_STATUS.RETIRED,
    ]),
    [WORKFLOW_STATUS.RETIRED]: new Set(),
  };

  return Boolean(allowed[from]?.has(to));
}

// =============================================================================
// Error
// =============================================================================

export class WorkflowRegistryError extends Error {
  constructor(code, message, status = 500, details = undefined, cause = undefined) {
    super(message, { cause });
    this.name = 'WorkflowRegistryError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// =============================================================================
// In-memory repository (test/local development support)
// =============================================================================

export class InMemoryWorkflowRegistryRepository {
  constructor({ maxHistory = DEFAULT_LIMITS.maxHistory } = {}) {
    this.maxHistory = normalizeInteger(
      maxHistory,
      DEFAULT_LIMITS.maxHistory,
      1,
      DEFAULT_LIMITS.maxHistory,
    );

    this.definitions = new Map();
    this.pointers = new Map();
    this.history = [];
    this.idempotency = new Map();
  }

  async saveDefinition(definition) {
    this.definitions.set(
      registryKey(definition),
      redact(definition),
    );

    this.history.unshift({
      type: 'DEFINITION_SAVED',
      workflowId: definition.workflowId,
      version: definition.version,
      tenantId: definition.tenantId || null,
      provider: definition.provider,
      fingerprint: definition.fingerprint,
      recordedAt: definition.updatedAt || new Date().toISOString(),
    });

    this.history = this.history.slice(0, this.maxHistory);
    return definition;
  }

  async getDefinition({ tenantId, workflowId, version }) {
    return this.definitions.get(
      registryKey({ tenantId, workflowId, version }),
    ) || null;
  }

  async listDefinitions({ tenantId, workflowId, limit = 20 } = {}) {
    const normalizedTenant = tenantKey(tenantId);
    const rows = [];

    for (const definition of this.definitions.values()) {
      if (tenantKey(definition.tenantId) !== normalizedTenant) continue;
      if (workflowId && definition.workflowId !== workflowId) continue;
      rows.push(definition);
    }

    rows.sort((a, b) => compareVersions(b.version, a.version));
    return rows.slice(0, limit);
  }

  async setActiveVersion({ tenantId, workflowId, version, status }) {
    this.pointers.set(
      activePointerKey({ tenantId, workflowId }),
      {
        tenantId: tenantId || null,
        workflowId,
        version,
        status,
        updatedAt: new Date().toISOString(),
      },
    );

    return this.pointers.get(
      activePointerKey({ tenantId, workflowId }),
    );
  }

  async getActiveVersion({ tenantId, workflowId }) {
    return this.pointers.get(
      activePointerKey({ tenantId, workflowId }),
    ) || null;
  }

  async deleteActiveVersion({ tenantId, workflowId }) {
    this.pointers.delete(
      activePointerKey({ tenantId, workflowId }),
    );
  }

  async saveIdempotency({ tenantId, operationKey, fingerprint, result }) {
    const key = `${tenantKey(tenantId)}:${operationKey}`;
    this.idempotency.set(key, {
      fingerprint,
      result: redact(result),
      recordedAt: new Date().toISOString(),
    });
  }

  async getIdempotency({ tenantId, operationKey }) {
    return this.idempotency.get(
      `${tenantKey(tenantId)}:${operationKey}`,
    ) || null;
  }

  async historyList({ tenantId, limit = 20 } = {}) {
    return this.history
      .filter((item) => tenantKey(item.tenantId) === tenantKey(tenantId))
      .slice(0, limit);
  }

  async healthCheck() {
    return {
      status: 'UP',
      definitions: this.definitions.size,
      activePointers: this.pointers.size,
    };
  }

  async close() {
    this.definitions.clear();
    this.pointers.clear();
    this.history.length = 0;
    this.idempotency.clear();
  }
}

// =============================================================================
// Registry
// =============================================================================

export class AirtelWorkflowRegistry {
  constructor({
    repository,
    logger,
    metrics,
    tracer,
    audit,
    clock = () => new Date(),
    config = {},
  } = {}) {
    this.repository = repository || new InMemoryWorkflowRegistryRepository();
    this.logger = logger;
    this.metrics = metrics;
    this.tracer = tracer;
    this.audit = audit;
    this.clock = clock;

    const merged = {
      ...DEFAULT_CONFIG,
      ...(isPlainObject(config) ? config : {}),
      provider: PROVIDER,
    };

    this.config = deepFreeze(merged);
    this.definitions = new Map();
    this.activePointers = new Map();
    this._closed = false;

    this.statistics = {
      registrations: 0,
      registrationFailures: 0,
      activations: 0,
      pauses: 0,
      deprecations: 0,
      retirements: 0,
      resolutions: 0,
      resolutionFailures: 0,
      searches: 0,
      persistenceFailures: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  async register(definition, { idempotencyKey } = {}) {
    this._assertOpen();

    this.statistics.registrations += 1;

    const normalized = this._normalizeDefinition(definition);
    const key = versionKey(normalized.workflowId, normalized.version);
    const scopedKey = registryKey(normalized);

    if (this.definitions.has(scopedKey)) {
      if (this.config.enforceImmutableVersions) {
        throw new WorkflowRegistryError(
          ERROR_CODES.VERSION_EXISTS,
          `Workflow version ${key} is already registered.`,
          409,
        );
      }
    }

    if (normalized.status === WORKFLOW_STATUS.ACTIVE) {
      this._assertActivationEligibility(normalized);
    }

    const requestFingerprint = this._registrationFingerprint(normalized);

    if (idempotencyKey) {
      const replay = await this._getIdempotency(normalized.tenantId, idempotencyKey);

      if (replay) {
        if (replay.fingerprint !== requestFingerprint) {
          throw new WorkflowRegistryError(
            ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'The idempotency key was previously used with a different workflow registration.',
            409,
          );
        }

        return deepFreeze(
          redact(replay.result),
        );
      }
    }

    const now = nowIso(this.clock);

    const stored = {
      ...normalized,
      createdAt:
        normalized.createdAt
        || now,
      updatedAt:
        now,
      fingerprint:
        this._definitionFingerprint(
          normalized,
        ),
      registrationFingerprint:
        requestFingerprint,
    };

    this.definitions.set(
      scopedKey,
      stored,
    );

    if (
      stored.status
      === WORKFLOW_STATUS.ACTIVE
    ) {
      await this._setActivePointer(
        stored,
      );
    }

    await this._persistDefinition(
      stored,
    );

    if (idempotencyKey) {
      await this._saveIdempotency(
        stored.tenantId,
        idempotencyKey,
        requestFingerprint,
        stored,
      );
    }

    await this._auditEvent(
      'WORKFLOW_REGISTERED',
      stored,
    );

    this._metric(
      'airtel_workflow_registry_registrations_total',
      1,
      {
        status:
          stored.status,
      },
    );

    return this._freeze(
      stored,
    );
  }

  async registerVersion(
    definition,
    options = {},
  ) {
    return this.register(
      definition,
      options,
    );
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async activate({
    tenantId,
    workflowId,
    version,
    reason = 'activation',
  } = {}) {
    return this._transition({
      tenantId,
      workflowId,
      version,
      toStatus:
        WORKFLOW_STATUS.ACTIVE,
      reason,
    });
  }

  async pause({
    tenantId,
    workflowId,
    version,
    reason = 'pause',
  } = {}) {
    return this._transition({
      tenantId,
      workflowId,
      version,
      toStatus:
        WORKFLOW_STATUS.PAUSED,
      reason,
    });
  }

  async deprecate({
    tenantId,
    workflowId,
    version,
    reason = 'deprecation',
  } = {}) {
    return this._transition({
      tenantId,
      workflowId,
      version,
      toStatus:
        WORKFLOW_STATUS.DEPRECATED,
      reason,
    });
  }

  async retire({
    tenantId,
    workflowId,
    version,
    reason = 'retirement',
  } = {}) {
    return this._transition({
      tenantId,
      workflowId,
      version,
      toStatus:
        WORKFLOW_STATUS.RETIRED,
      reason,
    });
  }

  async _transition({
    tenantId,
    workflowId,
    version,
    toStatus,
    reason,
  }) {
    this._assertOpen();

    const current =
      this._getLocalDefinition({
        tenantId,
        workflowId,
        version,
      });

    if (!current) {
      throw new WorkflowRegistryError(
        ERROR_CODES.VERSION_NOT_FOUND,
        `Workflow version ${workflowId}@${version} was not found.`,
        404,
      );
    }

    if (current.status === toStatus) {
      return this._freeze(
        current,
      );
    }

    if (
      !transitionAllowed(
        current.status,
        toStatus,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.INVALID_TRANSITION,
        `Workflow state transition ${current.status} -> ${toStatus} is not allowed.`,
        409,
      );
    }

    if (
      toStatus
      === WORKFLOW_STATUS.ACTIVE
    ) {
      this._assertActivationEligibility(
        current,
      );
    }

    const updated = {
      ...current,

      status:
        toStatus,

      lifecycle: {
        ...(current.lifecycle || {}),

        lastTransition: {
          from:
            current.status,

          to:
            toStatus,

          reason:
            normalizeString(
              reason,
              500,
            )
            || 'lifecycle-change',

          at:
            nowIso(
              this.clock,
            ),
        },
      },

      updatedAt:
        nowIso(
          this.clock,
        ),
    };

    this.definitions.set(
      registryKey({
        tenantId,
        workflowId,
        version,
      }),
      updated,
    );

    if (
      toStatus
      === WORKFLOW_STATUS.ACTIVE
    ) {
      await this._setActivePointer(
        updated,
      );

      this.statistics.activations += 1;
    } else if (
      toStatus
      === WORKFLOW_STATUS.PAUSED
    ) {
      this.statistics.pauses += 1;

      const pointer =
        await this._getActivePointer({
          tenantId,
          workflowId,
        });

      if (
        pointer?.version
        === version
      ) {
        await this._deleteActivePointer({
          tenantId,
          workflowId,
        });
      }
    } else if (
      toStatus
      === WORKFLOW_STATUS.DEPRECATED
    ) {
      this.statistics.deprecations += 1;

      const pointer =
        await this._getActivePointer({
          tenantId,
          workflowId,
        });

      if (
        pointer?.version
        === version
      ) {
        await this._deleteActivePointer({
          tenantId,
          workflowId,
        });
      }
    } else if (
      toStatus
      === WORKFLOW_STATUS.RETIRED
    ) {
      this.statistics.retirements += 1;

      const pointer =
        await this._getActivePointer({
          tenantId,
          workflowId,
        });

      if (
        pointer?.version
        === version
      ) {
        await this._deleteActivePointer({
          tenantId,
          workflowId,
        });
      }
    }

    await this._persistDefinition(
      updated,
    );

    await this._auditEvent(
      'WORKFLOW_LIFECYCLE_CHANGED',
      {
        ...updated,

        reason:
          normalizeString(
            reason,
            500,
          ),
      },
    );

    return this._freeze(
      updated,
    );
  }

  // ---------------------------------------------------------------------------
  // Read / resolution
  // ---------------------------------------------------------------------------

  async get({
    tenantId,
    workflowId,
    version,
    includeDefinition = true,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    this._assertWorkflowId(
      workflowId,
    );

    const normalizedVersion =
      this._normalizeVersion(
        version,
      );

    let definition =
      this._getLocalDefinition({
        tenantId,
        workflowId,
        version:
          normalizedVersion,
      });

    if (
      !definition
      && this.repository?.getDefinition
    ) {
      definition =
        await this.repository.getDefinition({
          tenantId,
          workflowId,
          version:
            normalizedVersion,
        });
    }

    if (!definition) {
      throw new WorkflowRegistryError(
        ERROR_CODES.VERSION_NOT_FOUND,
        `Workflow ${workflowId}@${normalizedVersion} was not found.`,
        404,
      );
    }

    return this._freeze(
      includeDefinition
        ? definition
        : {
            workflowId:
              definition.workflowId,

            version:
              definition.version,

            tenantId:
              definition.tenantId
              || null,

            provider:
              definition.provider,

            status:
              definition.status,

            fingerprint:
              definition.fingerprint,
          },
    );
  }

  async getWorkflow({
    tenantId,
    workflowId,
    version,
  } = {}) {
    return this.get({
      tenantId,
      workflowId,
      version,
    });
  }

  async resolve({
    tenantId,
    workflowId,
    version,
    trigger,
    executionMode =
      WORKFLOW_EXECUTION_MODE
        .ADVISORY,
    allowInactive = false,
  } = {}) {
    this._assertOpen();

    this.statistics.resolutions += 1;

    try {
      this._assertTenant(
        tenantId,
      );

      this._assertWorkflowId(
        workflowId,
      );

      const normalizedTrigger =
        trigger
          ? normalizeString(
              trigger,
              40,
            ).toUpperCase()
          : null;

      if (
        normalizedTrigger
        && !VALID_TRIGGERS.has(
          normalizedTrigger,
        )
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.TRIGGER_INVALID,
          `Unsupported workflow trigger ${normalizedTrigger}.`,
          400,
        );
      }

      const normalizedMode =
        normalizeString(
          executionMode,
          40,
        ).toUpperCase()
        || WORKFLOW_EXECUTION_MODE
          .ADVISORY;

      if (
        !VALID_EXECUTION_MODES.has(
          normalizedMode,
        )
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.INVALID_INPUT,
          `Unsupported workflow execution mode ${normalizedMode}.`,
          400,
        );
      }

      let resolvedVersion =
        version
          ? this._normalizeVersion(
              version,
            )
          : null;

      if (!resolvedVersion) {
        const pointer =
          await this._getActivePointer({
            tenantId,
            workflowId,
          });

        resolvedVersion =
          pointer?.version
          || null;
      }

      if (!resolvedVersion) {
        resolvedVersion =
          await this._resolveHighestActiveVersion({
            tenantId,
            workflowId,
          });
      }

      if (!resolvedVersion) {
        throw new WorkflowRegistryError(
          ERROR_CODES.WORKFLOW_NOT_FOUND,
          `No active workflow version exists for ${workflowId}.`,
          404,
        );
      }

      const definition =
        await this.get({
          tenantId,
          workflowId,
          version:
            resolvedVersion,
        });

      if (
        !allowInactive
        && definition.status
          !== WORKFLOW_STATUS.ACTIVE
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.WORKFLOW_INACTIVE,
          `Workflow ${workflowId}@${resolvedVersion} is ${definition.status}.`,
          409,
        );
      }

      if (
        normalizedTrigger
        && !definition.triggers.some(
          (item) =>
            item.type
              === normalizedTrigger,
        )
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.TRIGGER_INVALID,
          `Workflow ${workflowId}@${resolvedVersion} does not accept trigger ${normalizedTrigger}.`,
          409,
        );
      }

      if (
        normalizedMode
          === WORKFLOW_EXECUTION_MODE
            .GOVERNED
        && !definition.requiresGovernance
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.VERSION_POLICY_VIOLATION,
          'Governed execution was requested for a workflow that is not declared as governed.',
          409,
        );
      }

      const resolution = {
        component:
          COMPONENT,

        engine:
          ENGINE_NAME,

        engineVersion:
          ENGINE_VERSION,

        schemaVersion:
          SCHEMA_VERSION,

        provider:
          PROVIDER,

        tenantId:
          definition.tenantId
          || tenantId
          || null,

        tenantDigest:
          sha256(
            definition.tenantId
              || tenantId
              || 'system',
          ),

        workflowId:
          definition.workflowId,

        version:
          definition.version,

        status:
          definition.status,

        trigger:
          normalizedTrigger,

        executionMode:
          normalizedMode,

        requiresApproval:
          Boolean(
            definition.requiresApproval,
          ),

        requiresGovernance:
          Boolean(
            definition.requiresGovernance,
          ),

        requiredCapabilities:
          definition
            .requiredCapabilities,

        workflowFingerprint:
          definition.fingerprint,

        resolutionFingerprint:
          sha256({
            provider:
              PROVIDER,

            tenantDigest:
              sha256(
                definition.tenantId
                  || tenantId
                  || 'system',
              ),

            workflowId:
              definition.workflowId,

            version:
              definition.version,

            status:
              definition.status,

            trigger:
              normalizedTrigger,

            executionMode:
              normalizedMode,

            workflowFingerprint:
              definition.fingerprint,
          }),

        resolvedAt:
          nowIso(
            this.clock,
          ),
      };

      this._metric(
        'airtel_workflow_registry_resolutions_total',
        1,
        {
          executionMode:
            normalizedMode,
        },
      );

      return this._freeze(
        resolution,
      );
    } catch (error) {
      this.statistics
        .resolutionFailures += 1;

      throw error;
    }
  }

  async resolveWorkflow(
    input = {},
  ) {
    return this.resolve(
      input,
    );
  }

  async list({
    tenantId,
    workflowId,
    status,
    trigger,
    limit =
      this.config
        .defaultHistoryLimit,
  } = {}) {
    this._assertOpen();

    this.statistics.searches += 1;

    this._assertTenant(
      tenantId,
    );

    if (workflowId) {
      this._assertWorkflowId(
        workflowId,
      );
    }

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config
          .defaultHistoryLimit,
        1,
        this.config.maxHistory,
      );

    const normalizedStatus =
      status
        ? normalizeStatus(
            status,
            '',
          )
        : '';

    if (
      status
      && !VALID_STATUSES.has(
        normalizedStatus,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.INVALID_INPUT,
        `Unsupported workflow status ${status}.`,
        400,
      );
    }

    const normalizedTrigger =
      trigger
        ? normalizeString(
            trigger,
            40,
          ).toUpperCase()
        : '';

    if (
      normalizedTrigger
      && !VALID_TRIGGERS.has(
        normalizedTrigger,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.TRIGGER_INVALID,
        `Unsupported workflow trigger ${trigger}.`,
        400,
      );
    }

    const rows = [];
    const seen = new Set();

    for (
      const definition
      of this.definitions.values()
    ) {
      if (
        tenantKey(
          definition.tenantId,
        )
        !== tenantKey(
          tenantId,
        )
      ) {
        continue;
      }

      if (
        workflowId
        && definition.workflowId
          !== workflowId
      ) {
        continue;
      }

      if (
        normalizedStatus
        && definition.status
          !== normalizedStatus
      ) {
        continue;
      }

      if (
        normalizedTrigger
        && !definition.triggers.some(
          (item) =>
            item.type
              === normalizedTrigger,
        )
      ) {
        continue;
      }

      const key =
        registryKey(
          definition,
        );

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);
      rows.push(
        definition,
      );
    }

    if (
      this.repository?.listDefinitions
    ) {
      const persisted =
        await this.repository
          .listDefinitions({
            tenantId,
            workflowId,
            limit:
              boundedLimit,
          });

      for (
        const definition
        of persisted
      ) {
        if (!definition) {
          continue;
        }

        if (
          normalizedStatus
          && definition.status
            !== normalizedStatus
        ) {
          continue;
        }

        if (
          normalizedTrigger
          && !definition.triggers?.some(
            (item) =>
              item.type
                === normalizedTrigger,
          )
        ) {
          continue;
        }

        const key =
          registryKey(
            definition,
          );

        if (
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);
        rows.push(
          definition,
        );
      }
    }

    rows.sort(
      (a, b) => {
        const workflow =
          a.workflowId.localeCompare(
            b.workflowId,
          );

        if (
          workflow !== 0
        ) {
          return workflow;
        }

        return compareVersions(
          b.version,
          a.version,
        );
      },
    );

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      tenantDigest:
        sha256(
          normalizeTenantId(
            tenantId,
          ),
        ),

      count:
        Math.min(
          rows.length,
          boundedLimit,
        ),

      items:
        rows.slice(
          0,
          boundedLimit,
        ),

      generatedAt:
        nowIso(
          this.clock,
        ),
    });
  }

  async search({
    tenantId,
    query = '',
    limit =
      this.config
        .defaultHistoryLimit,
  } = {}) {
    const normalizedQuery =
      normalizeString(
        query,
        200,
      ).toLowerCase();

    const response =
      await this.list({
        tenantId,
        limit:
          this.config
            .maxHistory,
      });

    const filtered =
      response.items.filter(
        (definition) => {
          if (
            !normalizedQuery
          ) {
            return true;
          }

          const haystack = [
            definition.workflowId,
            definition.name,
            definition.description,
            definition.version,
            ...(definition.tags || []),
          ]
            .join(' ')
            .toLowerCase();

          return haystack.includes(
            normalizedQuery,
          );
        },
      );

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config
          .defaultHistoryLimit,
        1,
        this.config.maxHistory,
      );

    return this._freeze({
      ...response,

      count:
        Math.min(
          filtered.length,
          boundedLimit,
        ),

      items:
        filtered.slice(
          0,
          boundedLimit,
        ),
    });
  }

  async listActive({
    tenantId,
    limit =
      this.config
        .defaultHistoryLimit,
  } = {}) {
    return this.list({
      tenantId,
      status:
        WORKFLOW_STATUS.ACTIVE,
      limit,
    });
  }

  async getActive({
    tenantId,
    workflowId,
  } = {}) {
    const pointer =
      await this._getActivePointer({
        tenantId,
        workflowId,
      });

    if (!pointer) {
      return null;
    }

    return this.get({
      tenantId,
      workflowId,
      version:
        pointer.version,
    });
  }

  async getHistory({
    tenantId,
    limit =
      this.config
        .defaultHistoryLimit,
  } = {}) {
    this._assertOpen();

    this._assertTenant(
      tenantId,
    );

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config
          .defaultHistoryLimit,
        1,
        this.config.maxHistory,
      );

    if (
      this.repository?.historyList
    ) {
      const records =
        await this.repository
          .historyList({
            tenantId,
            limit:
              boundedLimit,
          });

      return this._freeze({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        tenantId:
          normalizeTenantId(
            tenantId,
          ),

        tenantDigest:
          sha256(
            normalizeTenantId(
              tenantId,
            ),
          ),

        count:
          records.length,

        records,

        generatedAt:
          nowIso(
            this.clock,
          ),
      });
    }

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      tenantDigest:
        sha256(
          normalizeTenantId(
            tenantId,
          ),
        ),

      count:
        0,

      records:
        [],

      generatedAt:
        nowIso(
          this.clock,
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  _normalizeDefinition(
    input,
  ) {
    if (!isPlainObject(input)) {
      throw new WorkflowRegistryError(
        ERROR_CODES.INVALID_INPUT,
        'Workflow definition must be a plain object.',
        400,
      );
    }

    if (
      safeBytes(input)
      > this.config.maxPayloadBytes
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        'Workflow definition exceeds the configured payload limit.',
        413,
      );
    }

    const provider =
      normalizeProvider(
        input.provider
        || PROVIDER,
      );

    if (
      provider !== PROVIDER
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'The workflow registry accepts Airtel workflows only.',
        403,
        {
          provider,
        },
      );
    }

    const workflowId =
      normalizeString(
        input.workflowId
        || input.id,
        this.config
          .maxWorkflowIdLength,
      ).toLowerCase();

    if (!workflowId) {
      throw new WorkflowRegistryError(
        ERROR_CODES.WORKFLOW_ID_REQUIRED,
        'workflowId is required.',
        400,
      );
    }

    if (
      !WORKFLOW_ID_PATTERN.test(
        workflowId,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.WORKFLOW_ID_INVALID,
        'workflowId contains unsupported characters.',
        400,
      );
    }

    const version =
      this._normalizeVersion(
        input.version,
      );

    const tenantId =
      normalizeTenantId(
        input.tenantId,
      );

    const scope =
      normalizeString(
        input.scope,
        20,
      ).toUpperCase()
      || WORKFLOW_SCOPE.TENANT;

    if (
      !VALID_SCOPES.has(
        scope,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.INVALID_INPUT,
        `Unsupported workflow scope ${scope}.`,
        400,
      );
    }

    if (
      scope
        === WORKFLOW_SCOPE.SYSTEM
      && !this.config
        .systemScopeAllowed
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.SYSTEM_SCOPE_FORBIDDEN,
        'System-scoped workflows are disabled.',
        403,
      );
    }

    if (
      this.config.tenantRequired
      && scope
        === WORKFLOW_SCOPE.TENANT
      && !tenantId
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required for tenant-scoped workflows.',
        400,
      );
    }

    const name =
      normalizeString(
        input.name
        || workflowId,
        this.config
          .maxNameLength,
      );

    const description =
      normalizeString(
        input.description,
        this.config
          .maxDescriptionLength,
      );

    const status =
      normalizeStatus(
        input.status,
        WORKFLOW_STATUS.DRAFT,
      );

    const executionMode =
      normalizeString(
        input.executionMode,
        40,
      ).toUpperCase()
      || WORKFLOW_EXECUTION_MODE
        .ADVISORY;

    if (
      !VALID_EXECUTION_MODES.has(
        executionMode,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.INVALID_INPUT,
        `Unsupported workflow execution mode ${executionMode}.`,
        400,
      );
    }

    const triggers =
      this._normalizeTriggers(
        input.triggers,
      );

    const steps =
      this._normalizeSteps(
        input.steps,
      );

    const requiredCapabilities =
      this._normalizeCapabilities(
        input.requiredCapabilities,
      );

    const optionalCapabilities =
      this._normalizeCapabilities(
        input.optionalCapabilities,
      );

    this._validateCapabilitySeparation(
      requiredCapabilities,
      optionalCapabilities,
    );

    const requiresApproval =
      Boolean(
        input.requiresApproval,
      );

    const requiresGovernance =
      Boolean(
        input.requiresGovernance,
      );

    if (
      [...requiredCapabilities, ...optionalCapabilities]
        .some(
          (capability) =>
            FINANCIAL_CAPABILITIES.has(
              capability,
            ),
        )
    ) {
      if (
        !this.config
          .allowFinancialCapabilities
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.CAPABILITY_FORBIDDEN,
          'Financial mutation capabilities are not permitted in this registry.',
          403,
        );
      }
    }

    if (
      executionMode
        === WORKFLOW_EXECUTION_MODE.GOVERNED
      && !requiresGovernance
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.VERSION_POLICY_VIOLATION,
        'Governed workflows must explicitly declare requiresGovernance=true.',
        400,
      );
    }

    if (
      (
        requiresApproval
        || requiresGovernance
      )
      && executionMode
        === WORKFLOW_EXECUTION_MODE
          .ADVISORY
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.VERSION_POLICY_VIOLATION,
        'Approval/governance workflows cannot be declared as purely advisory.',
        400,
      );
    }

    const dependencies =
      this._normalizeDependencies(
        input.dependencies,
      );

    const tags =
      this._normalizeTags(
        input.tags,
      );

    const metadata =
      this._normalizeMetadata(
        input.metadata,
      );

    if (
      !this.config
        .allowExternalUrls
      && containsForbiddenUrl(
        input,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.DEFINITION_INVALID,
        'External URLs are not permitted in workflow definitions.',
        400,
      );
    }

    if (
      !this.config
        .allowDynamicModules
      && containsDynamicModuleReference(
        input,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.DEFINITION_INVALID,
        'Dynamic module references are not permitted in workflow definitions.',
        400,
      );
    }

    const concurrency =
      normalizeInteger(
        input.concurrency,
        1,
        1,
        32,
      );

    const timeoutMs =
      normalizeInteger(
        input.timeoutMs,
        30_000,
        100,
        300_000,
      );

    const retryPolicy =
      this._normalizeRetryPolicy(
        input.retryPolicy,
      );

    const normalized = {
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      workflowId,
      version,
      tenantId:
        tenantId || null,

      scope,

      name,
      description,

      status,

      executionMode,

      requiresApproval,

      requiresGovernance,

      triggers,

      steps,

      requiredCapabilities,

      optionalCapabilities,

      dependencies,

      tags,

      metadata,

      concurrency,

      timeoutMs,

      retryPolicy,

      owner:
        normalizeString(
          input.owner,
          160,
        )
        || null,

      source:
        normalizeString(
          input.source,
          160,
        )
        || null,

      replaces:
        input.replaces
          ? {
              workflowId:
                normalizeString(
                  input.replaces
                    .workflowId,
                  this.config
                    .maxWorkflowIdLength,
                ),

              version:
                this._normalizeVersion(
                  input.replaces
                    .version,
                ),
            }
          : null,

      lifecycle:
        isPlainObject(
          input.lifecycle,
        )
          ? redact(
              input.lifecycle,
            )
          : {},
    };

    return deepFreeze(
      normalized,
    );
  }

  _normalizeVersion(
    value,
  ) {
    const version =
      normalizeString(
        value,
        this.config
          .maxVersionLength,
      );

    if (
      !version
      || !VERSION_PATTERN.test(
        version,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.VERSION_INVALID,
        'A valid semantic-like workflow version is required.',
        400,
      );
    }

    return version;
  }

  _normalizeTriggers(
    triggers,
  ) {
    if (
      !Array.isArray(
        triggers,
      )
      || triggers.length === 0
    ) {
      return [
        {
          id:
            'manual',

          type:
            WORKFLOW_TRIGGER
              .MANUAL,

          enabled:
            true,

          conditions:
            {},
        },
      ];
    }

    if (
      triggers.length
      > this.config
          .maxTriggerCount
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.TRIGGER_INVALID,
        'Workflow contains too many triggers.',
        400,
      );
    }

    const ids =
      new Set();

    return triggers.map(
      (
        trigger,
        index,
      ) => {
        if (
          !isPlainObject(
            trigger,
          )
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.TRIGGER_INVALID,
            `Trigger ${index} must be an object.`,
            400,
          );
        }

        const id =
          normalizeString(
            trigger.id
            || `trigger-${index + 1}`,
            this.config
              .maxTriggerIdLength,
          ).toLowerCase();

        if (
          !TRIGGER_ID_PATTERN.test(
            id,
          )
          || ids.has(id)
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.TRIGGER_INVALID,
            `Trigger id ${id} is invalid or duplicated.`,
            400,
          );
        }

        ids.add(id);

        const type =
          normalizeString(
            trigger.type,
            40,
          ).toUpperCase();

        if (
          !VALID_TRIGGERS.has(
            type,
          )
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.TRIGGER_INVALID,
            `Unsupported workflow trigger ${type}.`,
            400,
          );
        }

        return {
          id,
          type,

          enabled:
            trigger.enabled !== false,

          conditions:
            isPlainObject(
              trigger.conditions,
            )
              ? redact(
                  trigger.conditions,
                )
              : {},

          eventTypes:
            Array.isArray(
              trigger.eventTypes,
            )
              ? trigger.eventTypes
                  .slice(0, 20)
                  .map(
                    (
                      value,
                    ) =>
                      normalizeString(
                        value,
                        120,
                      ),
                  )
                  .filter(
                    Boolean,
                  )
              : [],
        };
      },
    );
  }

  _normalizeSteps(
    steps,
  ) {
    if (
      !Array.isArray(
        steps,
      )
      || steps.length === 0
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.STEP_INVALID,
        'A workflow must contain at least one declarative step.',
        400,
      );
    }

    if (
      steps.length
      > this.config
          .maxStepCount
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.STEP_INVALID,
        'Workflow contains too many steps.',
        400,
      );
    }

    const ids =
      new Set();

    return steps.map(
      (
        step,
        index,
      ) => {
        if (
          !isPlainObject(
            step,
          )
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.STEP_INVALID,
            `Workflow step ${index} must be an object.`,
            400,
          );
        }

        const id =
          normalizeString(
            step.id
            || `step-${index + 1}`,
            this.config
              .maxStepIdLength,
          ).toLowerCase();

        if (
          !STEP_ID_PATTERN.test(
            id,
          )
          || ids.has(id)
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.STEP_INVALID,
            `Workflow step id ${id} is invalid or duplicated.`,
            400,
          );
        }

        ids.add(id);

        const kind =
          normalizeString(
            step.kind,
            40,
          ).toUpperCase();

        if (
          !VALID_STEP_KINDS.has(
            kind,
          )
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.STEP_INVALID,
            `Unsupported workflow step kind ${kind}.`,
            400,
          );
        }

        const handlerKey =
          normalizeString(
            step.handlerKey
            || step.handler,
            this.config
              .maxHandlerKeyLength,
          );

        if (
          !handlerKey
          || !SAFE_HANDLER_PATTERN.test(
            handlerKey,
          )
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.HANDLER_INVALID,
            `Workflow step ${id} requires a safe handlerKey.`,
            400,
          );
        }

        const capabilities =
          this._normalizeCapabilities(
            step.capabilities,
          );

        if (
          capabilities.length === 0
          && kind
            !== WORKFLOW_STEP_KIND
              .OBSERVATION
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.CAPABILITY_INVALID,
            `Workflow step ${id} must declare at least one capability.`,
            400,
          );
        }

        const financialCapability =
          capabilities.find(
            (capability) =>
              FINANCIAL_CAPABILITIES
                .has(capability),
          );

        if (
          financialCapability
          && !this.config
            .allowFinancialCapabilities
        ) {
          throw new WorkflowRegistryError(
            ERROR_CODES.CAPABILITY_FORBIDDEN,
            `Financial capability ${financialCapability} is not permitted.`,
            403,
          );
        }

        const dependsOn =
          Array.isArray(
            step.dependsOn,
          )
            ? step.dependsOn
                .slice(0, 20)
                .map(
                  (
                    value,
                  ) =>
                    normalizeString(
                      value,
                      this.config
                        .maxStepIdLength,
                    ).toLowerCase(),
                )
                .filter(
                  Boolean,
                )
            : [];

        return {
          id,

          order:
            normalizeInteger(
              step.order,
              index + 1,
              1,
              10_000,
            ),

          kind,

          handlerKey,

          capabilities,

          dependsOn,

          optional:
            step.optional
            === true,

          requiresApproval:
            step.requiresApproval
            === true,

          requiresGovernance:
            step.requiresGovernance
            === true,

          timeoutMs:
            normalizeInteger(
              step.timeoutMs,
              30_000,
              100,
              300_000,
            ),

          inputSchema:
            isPlainObject(
              step.inputSchema,
            )
              ? redact(
                  step.inputSchema,
                )
              : {},

          outputSchema:
            isPlainObject(
              step.outputSchema,
            )
              ? redact(
                  step.outputSchema,
                )
              : {},

          config:
            isPlainObject(
              step.config,
            )
              ? redact(
                  step.config,
                )
              : {},
        };
      },
    );
  }

  _normalizeCapabilities(
    capabilities,
  ) {
    if (
      capabilities
      == null
    ) {
      return [];
    }

    if (
      !Array.isArray(
        capabilities,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.CAPABILITY_INVALID,
        'Workflow capabilities must be an array.',
        400,
      );
    }

    if (
      capabilities.length
      > this.config
          .maxCapabilityCount
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.CAPABILITY_INVALID,
        'Workflow declares too many capabilities.',
        400,
      );
    }

    const normalized = [];
    const seen =
      new Set();

    for (
      const capabilityValue
      of capabilities
    ) {
      const capability =
        normalizeString(
          capabilityValue,
          120,
        ).toUpperCase();

      if (!capability) {
        continue;
      }

      if (
        seen.has(
          capability,
        )
      ) {
        continue;
      }

      seen.add(
        capability,
      );

      if (
        !VALID_CAPABILITIES.has(
          capability,
        )
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.CAPABILITY_INVALID,
          `Capability ${capability} is not registered.`,
          400,
        );
      }

      normalized.push(
        capability,
      );
    }

    return normalized;
  }

  _validateCapabilitySeparation(
    required,
    optional,
  ) {
    const optionalSet =
      new Set(
        optional,
      );

    for (
      const capability
      of required
    ) {
      if (
        optionalSet.has(
          capability,
        )
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.CAPABILITY_INVALID,
          `Capability ${capability} cannot be both required and optional.`,
          400,
        );
      }
    }
  }

  _normalizeDependencies(
    dependencies,
  ) {
    if (
      dependencies
      == null
    ) {
      return [];
    }

    if (
      !Array.isArray(
        dependencies,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.DEPENDENCY_CONFLICT,
        'Workflow dependencies must be an array.',
        400,
      );
    }

    if (
      dependencies.length
      > this.config
          .maxDependencyCount
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.DEPENDENCY_CONFLICT,
        'Workflow contains too many dependencies.',
        400,
      );
    }

    return dependencies
      .map(
        (
          dependency,
        ) => {
          if (
            typeof dependency
            === 'string'
          ) {
            return {
              workflowId:
                normalizeString(
                  dependency,
                  this.config
                    .maxWorkflowIdLength,
                ).toLowerCase(),

              versionRange:
                '*',

              optional:
                false,
            };
          }

          if (
            !isPlainObject(
              dependency,
            )
          ) {
            throw new WorkflowRegistryError(
              ERROR_CODES.DEPENDENCY_CONFLICT,
              'Each workflow dependency must be an object or workflow id.',
              400,
            );
          }

          const workflowId =
            normalizeString(
              dependency.workflowId,
              this.config
                .maxWorkflowIdLength,
            ).toLowerCase();

          if (
            !WORKFLOW_ID_PATTERN.test(
              workflowId,
            )
          ) {
            throw new WorkflowRegistryError(
              ERROR_CODES.DEPENDENCY_CONFLICT,
              `Dependency workflowId ${workflowId} is invalid.`,
              400,
            );
          }

          return {
            workflowId,

            versionRange:
              normalizeString(
                dependency.versionRange,
                80,
              )
              || '*',

            optional:
              dependency.optional
              === true,
          };
        },
      )
      .filter(
        (
          dependency,
        ) =>
          dependency.workflowId,
      );
  }

  _normalizeRetryPolicy(
    policy,
  ) {
    if (
      policy
      == null
    ) {
      return {
        maxAttempts:
          1,

        backoffMs:
          0,

        retryOn:
          [],
      };
    }

    if (
      !isPlainObject(
        policy,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.DEFINITION_INVALID,
        'retryPolicy must be an object.',
        400,
      );
    }

    const retryOn =
      Array.isArray(
        policy.retryOn,
      )
        ? policy.retryOn
            .slice(0, 20)
            .map(
              (
                item,
              ) =>
                normalizeString(
                  item,
                  100,
                ).toUpperCase(),
            )
            .filter(
              Boolean,
            )
        : [];

    return {
      maxAttempts:
        normalizeInteger(
          policy.maxAttempts,
          1,
          1,
          10,
        ),

      backoffMs:
        normalizeInteger(
          policy.backoffMs,
          0,
          0,
          300_000,
        ),

      retryOn,
    };
  }

  _normalizeTags(
    tags,
  ) {
    if (
      !Array.isArray(
        tags,
      )
    ) {
      return [];
    }

    return tags
      .slice(0, 30)
      .map(
        (tag) =>
          normalizeString(
            tag,
            80,
          ).toLowerCase(),
      )
      .filter(Boolean)
      .filter(
        (
          tag,
          index,
          array,
        ) =>
          array.indexOf(
            tag,
          )
          === index,
      );
  }

  _normalizeMetadata(
    metadata,
  ) {
    if (
      !isPlainObject(
        metadata,
      )
    ) {
      return {};
    }

    const entries =
      Object.entries(
        metadata,
      ).slice(
        0,
        this.config
          .maxMetadataKeys,
      );

    return Object.fromEntries(
      entries.map(
        (
          [key, value],
        ) => [
          normalizeString(
            key,
            100,
          ),

          redact(
            value,
          ),
        ],
      ),
    );
  }

  _assertActivationEligibility(
    definition,
  ) {
    if (
      TERMINAL_STATUSES.has(
        definition.status,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.INVALID_TRANSITION,
        `Workflow ${definition.workflowId}@${definition.version} cannot become ACTIVE from ${definition.status}.`,
        409,
      );
    }

    if (
      definition.steps.length
      === 0
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.DEFINITION_INVALID,
        'An active workflow must have at least one step.',
        400,
      );
    }

    for (
      const step
      of definition.steps
    ) {
      if (!step.handlerKey) {
        throw new WorkflowRegistryError(
          ERROR_CODES.HANDLER_INVALID,
          `Workflow step ${step.id} is missing a handlerKey.`,
          400,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Storage / pointer operations
  // ---------------------------------------------------------------------------

  _getLocalDefinition({
    tenantId,
    workflowId,
    version,
  }) {
    return (
      this.definitions.get(
        registryKey({
          tenantId,
          workflowId,
          version,
        }),
      )
      || null
    );
  }

  async _getActivePointer({
    tenantId,
    workflowId,
  }) {
    const local =
      this.activePointers.get(
        activePointerKey({
          tenantId,
          workflowId,
        }),
      );

    if (local) {
      return local;
    }

    if (
      this.repository?.getActiveVersion
    ) {
      const persisted =
        await this.repository
          .getActiveVersion({
            tenantId,
            workflowId,
          });

      if (persisted) {
        this.activePointers.set(
          activePointerKey({
            tenantId,
            workflowId,
          }),
          persisted,
        );

        return persisted;
      }
    }

    return null;
  }

  async _setActivePointer(
    definition,
  ) {
    const pointer = {
      tenantId:
        definition.tenantId
        || null,

      workflowId:
        definition.workflowId,

      version:
        definition.version,

      status:
        WORKFLOW_STATUS.ACTIVE,

      fingerprint:
        definition.fingerprint,

      updatedAt:
        nowIso(
          this.clock,
        ),
    };

    this.activePointers.set(
      activePointerKey(
        definition,
      ),
      pointer,
    );

    if (
      this.repository?.setActiveVersion
    ) {
      await this.repository
        .setActiveVersion(
          pointer,
        );
    } else if (
      this.config
        .requireRepository
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'Active workflow persistence repository is required.',
        503,
      );
    }
  }

  async _deleteActivePointer({
    tenantId,
    workflowId,
  }) {
    this.activePointers.delete(
      activePointerKey({
        tenantId,
        workflowId,
      }),
    );

    if (
      this.repository?.deleteActiveVersion
    ) {
      await this.repository
        .deleteActiveVersion({
          tenantId,
          workflowId,
        });
    }
  }

  async _resolveHighestActiveVersion({
    tenantId,
    workflowId,
  }) {
    const candidates = [];

    for (
      const definition
      of this.definitions.values()
    ) {
      if (
        tenantKey(
          definition.tenantId,
        )
        !== tenantKey(
          tenantId,
        )
      ) {
        continue;
      }

      if (
        definition.workflowId
        !== workflowId
      ) {
        continue;
      }

      if (
        definition.status
        !== WORKFLOW_STATUS.ACTIVE
      ) {
        continue;
      }

      candidates.push(
        definition,
      );
    }

    if (
      this.repository?.listDefinitions
    ) {
      const persisted =
        await this.repository
          .listDefinitions({
            tenantId,
            workflowId,
            limit:
              this.config.maxHistory,
          });

      for (
        const definition
        of persisted
      ) {
        if (
          definition?.status
          === WORKFLOW_STATUS.ACTIVE
        ) {
          candidates.push(
            definition,
          );
        }
      }
    }

    const unique =
      new Map(
        candidates.map(
          (definition) => [
            registryKey(
              definition,
            ),
            definition,
          ],
        ),
      );

    return [
      ...unique.values(),
    ]
      .sort(
        (
          a,
          b,
        ) =>
          compareVersions(
            b.version,
            a.version,
          ),
      )
      .at(0)
      ?.version
      || null;
  }

  async _persistDefinition(
    definition,
  ) {
    if (
      !this.config
        .persistDefinitions
    ) {
      return;
    }

    if (
      !this.repository?.saveDefinition
    ) {
      if (
        this.config
          .requireRepository
      ) {
        throw new WorkflowRegistryError(
          ERROR_CODES.REPOSITORY_REQUIRED,
          'Workflow repository is required but unavailable.',
          503,
        );
      }

      return;
    }

    try {
      await this.repository
        .saveDefinition(
          redact(
            definition,
          ),
        );
    } catch (
      error
    ) {
      this.statistics
        .persistenceFailures += 1;

      this._log(
        'error',
        'Workflow definition persistence failed.',
        {
          code:
            this._normalizeError(
              error,
            ).code,

          workflowId:
            definition.workflowId,

          version:
            definition.version,

          tenantDigest:
            sha256(
              definition.tenantId
              || 'system',
            ),
        },
      );

      throw new WorkflowRegistryError(
        ERROR_CODES.PERSISTENCE_FAILED,
        'Workflow definition persistence failed.',
        503,
        undefined,
        error,
      );
    }
  }

  async _getIdempotency(
    tenantId,
    idempotencyKey,
  ) {
    if (
      !this.repository?.getIdempotency
    ) {
      return null;
    }

    return this.repository.getIdempotency({
      tenantId,

      operationKey:
        normalizeString(
          idempotencyKey,
          200,
        ),
    });
  }

  async _saveIdempotency(
    tenantId,
    idempotencyKey,
    fingerprint,
    result,
  ) {
    if (
      !this.repository?.saveIdempotency
    ) {
      return;
    }

    await this.repository
      .saveIdempotency({
        tenantId,

        operationKey:
          normalizeString(
            idempotencyKey,
            200,
          ),

        fingerprint,

        result,
      });
  }

  // ---------------------------------------------------------------------------
  // Fingerprints / audit / observability
  // ---------------------------------------------------------------------------

  _registrationFingerprint(
    definition,
  ) {
    return sha256({
      provider:
        PROVIDER,

      tenantId:
        definition.tenantId
        || null,

      scope:
        definition.scope,

      workflowId:
        definition.workflowId,

      version:
        definition.version,

      name:
        definition.name,

      description:
        definition.description,

      executionMode:
        definition.executionMode,

      requiresApproval:
        definition.requiresApproval,

      requiresGovernance:
        definition.requiresGovernance,

      triggers:
        definition.triggers,

      steps:
        definition.steps,

      requiredCapabilities:
        definition.requiredCapabilities,

      optionalCapabilities:
        definition.optionalCapabilities,

      dependencies:
        definition.dependencies,

      tags:
        definition.tags,

      concurrency:
        definition.concurrency,

      timeoutMs:
        definition.timeoutMs,

      retryPolicy:
        definition.retryPolicy,
    });
  }

  _definitionFingerprint(
    definition,
  ) {
    return sha256({
      component:
        COMPONENT,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenantId:
        definition.tenantId
        || null,

      scope:
        definition.scope,

      workflowId:
        definition.workflowId,

      version:
        definition.version,

      name:
        definition.name,

      description:
        definition.description,

      executionMode:
        definition.executionMode,

      requiresApproval:
        definition.requiresApproval,

      requiresGovernance:
        definition.requiresGovernance,

      triggers:
        definition.triggers,

      steps:
        definition.steps,

      requiredCapabilities:
        definition.requiredCapabilities,

      optionalCapabilities:
        definition.optionalCapabilities,

      dependencies:
        definition.dependencies,

      tags:
        definition.tags,

      concurrency:
        definition.concurrency,

      timeoutMs:
        definition.timeoutMs,

      retryPolicy:
        definition.retryPolicy,

      owner:
        definition.owner,

      source:
        definition.source,
    });
  }

  async _auditEvent(
    type,
    payload,
  ) {
    if (!this.audit) {
      return;
    }

    const event =
      redact({
        eventType:
          type,

        component:
          COMPONENT,

        provider:
          PROVIDER,

        tenantId:
          payload?.tenantId
          || null,

        tenantDigest:
          sha256(
            payload?.tenantId
            || 'system',
          ),

        workflowId:
          payload?.workflowId
          || null,

        version:
          payload?.version
          || null,

        status:
          payload?.status
          || null,

        fingerprint:
          payload?.fingerprint
          || null,

        timestamp:
          nowIso(
            this.clock,
          ),
      });

    const methods = [
      'recordDecisionEvent',
      'record',
      'append',
      'write',
    ];

    for (
      const method
      of methods
    ) {
      if (
        typeof this.audit[method]
        !== 'function'
      ) {
        continue;
      }

      try {
        await this.audit[method](
          event,
        );

        return;
      } catch (
        error
      ) {
        this._log(
          'warn',
          'Workflow registry audit write failed.',
          {
            code:
              this._normalizeError(
                error,
              ).code,

            eventType:
              type,
          },
        );

        return;
      }
    }
  }

  _metric(
    name,
    value = 1,
    labels = {},
  ) {
    try {
      if (
        typeof this.metrics?.increment
        === 'function'
      ) {
        this.metrics.increment(
          name,
          value,
          {
            provider:
              PROVIDER,

            ...labels,
          },
        );
      } else if (
        typeof this.metrics?.inc
        === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          {
            provider:
              PROVIDER,

            ...labels,
          },
        );
      }
    } catch {
      // Observability is non-authoritative.
    }
  }

  _log(
    level,
    message,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[level]
        || this.logger?.info;

      if (
        typeof method
        !== 'function'
      ) {
        return;
      }

      method.call(
        this.logger,

        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          ...redact(
            context,
          ),
        },

        message,
      );
    } catch {
      // Logging must never affect workflow-registry semantics.
    }
  }

  _normalizeError(
    error,
  ) {
    if (
      error
      instanceof WorkflowRegistryError
    ) {
      return {
        code:
          error.code,

        status:
          error.status,

        message:
          error.message,
      };
    }

    return {
      code:
        ERROR_CODES
          .DEFINITION_INVALID,

      status:
        500,

      message:
        'Workflow registry operation failed.',
    };
  }

  _assertTenant(
    tenantId,
  ) {
    const normalized =
      normalizeTenantId(
        tenantId,
      );

    if (
      this.config.tenantRequired
      && !normalized
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required.',
        400,
      );
    }

    if (
      normalized
      && normalized.length < 2
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.TENANT_INVALID,
        'tenantId is invalid.',
        400,
      );
    }

    return normalized;
  }

  _assertWorkflowId(
    workflowId,
  ) {
    const normalized =
      normalizeString(
        workflowId,
        this.config
          .maxWorkflowIdLength,
      ).toLowerCase();

    if (
      !normalized
      || !WORKFLOW_ID_PATTERN.test(
        normalized,
      )
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.WORKFLOW_ID_INVALID,
        'workflowId is invalid.',
        400,
      );
    }

    return normalized;
  }

  _assertOpen() {
    if (
      this._closed
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.CLOSED,
        'Workflow registry is closed.',
        503,
      );
    }
  }

  _freeze(
    value,
  ) {
    return deepFreeze(
      redact(
        value,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Health / component metadata / exports
  // ---------------------------------------------------------------------------

  async health() {
    const repository =
      await this._safeHealthCheck(
        this.repository,
        'repository',
      );

    return this._freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      status:
        repository.ok
          ? 'UP'
          : 'DEGRADED',

      checkedAt:
        nowIso(
          this.clock,
        ),

      checks: [
        repository,
      ],

      statistics: {
        ...this.statistics,
      },
    });
  }

  async readiness() {
    const health =
      await this.health();

    return this._freeze({
      ...health,

      ready:
        health.status
        === 'UP',
    });
  }

  async _safeHealthCheck(
    adapter,
    name,
  ) {
    if (!adapter) {
      return {
        name,
        ok:
          false,
        status:
          'MISSING',
      };
    }

    const method =
      (
        [
          'health',
          'readiness',
          'healthCheck',
        ].find(
          (candidate) =>
            typeof adapter[candidate]
            === 'function',
        )
      )
      || null;

    if (!method) {
      return {
        name,
        ok:
          false,
        status:
          'UNSUPPORTED',
      };
    }

    try {
      const result =
        await adapter[method]({
          provider:
            PROVIDER,
        });

      const status =
        normalizeString(
          result?.status
          || result?.state
          || 'UNKNOWN',
          50,
        ).toUpperCase();

      return {
        name,

        ok:
          ![
            'DOWN',
            'FAILED',
            'UNAVAILABLE',
            'ERROR',
            'NOT_READY',
            'SHUTDOWN',
          ].includes(
            status,
          ),

        status,

        details:
          redact(
            result,
          ),
      };
    } catch (
      error
    ) {
      return {
        name,
        ok:
          false,
        status:
          this._normalizeError(
            error,
          ).code,
      };
    }
  }

  getComponentInfo() {
    return this._freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      schemaVersion:
        SCHEMA_VERSION,

      moduleFormat:
        'ESM',

      immutableVersions:
        Boolean(
          this.config
            .enforceImmutableVersions,
        ),

      financialCapabilitiesAllowed:
        Boolean(
          this.config
            .allowFinancialCapabilities,
        ),

      externalUrlsAllowed:
        Boolean(
          this.config
            .allowExternalUrls,
        ),

      dynamicModulesAllowed:
        Boolean(
          this.config
            .allowDynamicModules,
        ),

      supportedStatuses:
        [...VALID_STATUSES],

      supportedTriggers:
        [...VALID_TRIGGERS],

      supportedStepKinds:
        [...VALID_STEP_KINDS],

      supportedExecutionModes:
        [...VALID_EXECUTION_MODES],

      supportedCapabilities:
        [...VALID_CAPABILITIES],
    });
  }

  async exportRegistry({
    tenantId,
    workflowId,
    limit =
      this.config.maxHistory,
  } = {}) {
    const result =
      await this.list({
        tenantId,
        workflowId,
        limit,
      });

    const payload =
      JSON.stringify(
        result,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        payload,
        'utf8',
      );

    const maxExportBytes =
      Math.min(
        this.config.maxPayloadBytes
          * 8,

        4 * 1024 * 1024,
      );

    if (
      bytes
      > maxExportBytes
    ) {
      throw new WorkflowRegistryError(
        ERROR_CODES.EXPORT_TOO_LARGE,
        'Workflow registry export exceeds the configured size limit.',
        413,
      );
    }

    return this._freeze({
      contentType:
        'application/json',

      filename:
        'airtel-workflow-registry.json',

      bytes,

      fingerprint:
        sha256(
          result,
        ),

      payload,
    });
  }

  async close() {
    if (
      this._closed
    ) {
      return;
    }

    this._closed = true;

    if (
      typeof this.repository?.close
      === 'function'
    ) {
      await this.repository.close();
    }
  }
}

// =============================================================================
// Factories / aliases / helpers
// =============================================================================

export function createWorkflowRegistry(
  options = {},
) {
  return new AirtelWorkflowRegistry(
    options,
  );
}

export function createAirtelWorkflowRegistry(
  options = {},
) {
  return new AirtelWorkflowRegistry({
    ...options,

    config: {
      ...(options.config || {}),
      provider:
        PROVIDER,
    },
  });
}

export const WorkflowRegistry =
  AirtelWorkflowRegistry;

export const AirtelPaymentWorkflowRegistry =
  AirtelWorkflowRegistry;

export function buildWorkflowFingerprint(
  definition = {},
) {
  return sha256({
    component:
      COMPONENT,

    provider:
      PROVIDER,

    tenantId:
      normalizeTenantId(
        definition.tenantId,
      )
      || null,

    scope:
      normalizeString(
        definition.scope,
        20,
      ).toUpperCase()
      || WORKFLOW_SCOPE.TENANT,

    workflowId:
      normalizeString(
        definition.workflowId
        || definition.id,
        DEFAULT_LIMITS
          .maxWorkflowIdLength,
      ).toLowerCase(),

    version:
      normalizeString(
        definition.version,
        DEFAULT_LIMITS
          .maxVersionLength,
      ),

    executionMode:
      normalizeString(
        definition.executionMode,
        40,
      ).toUpperCase()
      || WORKFLOW_EXECUTION_MODE
        .ADVISORY,

    requiresApproval:
      definition.requiresApproval
      === true,

    requiresGovernance:
      definition.requiresGovernance
      === true,

    triggers:
      definition.triggers
      || [],

    steps:
      definition.steps
      || [],

    requiredCapabilities:
      definition.requiredCapabilities
      || [],

    optionalCapabilities:
      definition.optionalCapabilities
      || [],

    dependencies:
      definition.dependencies
      || [],
  });
}

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,

    WORKFLOW_STATUS,
    WORKFLOW_SCOPE,
    WORKFLOW_TRIGGER,
    WORKFLOW_STEP_KIND,
    WORKFLOW_EXECUTION_MODE,

    CAPABILITIES,

    ERROR_CODES,
  });

export default AirtelWorkflowRegistry;