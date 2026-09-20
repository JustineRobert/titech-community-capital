/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Intelligence Command Registry
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/command-center/commandRegistry.js
 *
 * Architectural role
 * ------------------
 * Declarative control-plane registry for command contracts used by the Airtel
 * payment intelligence command center. The registry is the authoritative
 * catalogue for command identity, versions, lifecycle status, declared
 * capabilities, governance/approval requirements, bounded input/output
 * contracts, risk metadata and execution-safety metadata.
 *
 * Responsibilities
 * ----------------
 * - Register immutable command versions with deterministic semantic fingerprints.
 * - Resolve commands by namespace/name/version within tenant and Airtel scope.
 * - Validate bounded command input against the registered schema.
 * - Validate command output against the registered output schema.
 * - Check required capabilities without granting IAM privileges.
 * - Manage lifecycle transitions with version and fingerprint guards.
 * - Preserve historical definitions for traceability after deprecation/retirement.
 * - Support injected durable persistence, audit, metrics, tracing and events.
 * - Provide an in-memory repository implementation for tests/local development.
 * - Expose bounded health/readiness and operational component metadata.
 *
 * Non-responsibilities / hard boundaries
 * ---------------------------------------
 * - NOT a command executor, worker, scheduler or arbitrary code runtime.
 * - NOT an Airtel provider adapter and never calls Airtel APIs.
 * - NOT the payment/transaction execution authority.
 * - NOT a settlement, reconciliation, ledger or balance mutation service.
 * - NOT the Financial Core and never posts journal entries.
 * - NOT an IAM/RBAC authority and never grants capabilities to an actor.
 * - NOT the governance decision engine.
 * - NOT maker-checker / approval state management.
 * - NOT KYC, AML, sanctions, fraud or regulatory adjudication.
 * - NOT model serving/training/retraining.
 * - NOT responsible for secrets, credentials, OTP/PIN/card data or raw provider
 *   payload storage.
 * - NOT responsible for background scheduling or polling loops.
 * - A registry record does not constitute authorization to execute a command.
 *
 * Enterprise safety principles
 * ----------------------------
 * 1. Provider scope is fail-closed to AIRTEL.
 * 2. Tenant context is required by default; system/global visibility never
 *    removes tenant isolation.
 * 3. Command identity is namespace + name + semantic version.
 * 4. A published version's semantic contract is immutable. Lifecycle changes
 *    do not rewrite the semantic fingerprint.
 * 5. Financial, provider-call, ledger, balance, approval-grant and other
 *    privileged side-effect capabilities are forbidden at this boundary.
 * 6. Governance and approval metadata are requirements, not satisfied controls.
 * 7. Deprecated/retired/disabled versions remain discoverable only when the
 *    caller explicitly requests historical/inactive visibility.
 * 8. Lifecycle transitions use optimistic concurrency and semantic-fingerprint
 *    guards. Durable repositories should implement atomic compare-and-set.
 * 9. Registry metadata is sanitized, bounded and deterministic before storage.
 * 10. Sensitive identifiers are digested; secrets/raw payloads are redacted.
 * 11. Input validation is deliberately bounded and is not a replacement for
 *     domain validation owned by the command's business service.
 * 12. Offline/local payment states never become final settlement authority.
 * 13. No method in this module mutates a financial record.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 * - No dynamic imports, module loading or runtime code generation.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const ENGINE_NAME = 'airtel-command-center-command-registry';
export const ENGINE_VERSION = '2.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 2;
export const HASH_ALGORITHM = 'sha256';

export const COMMAND_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
  RETIRED: 'RETIRED',
  DISABLED: 'DISABLED',
});

export const COMMAND_RISK_LEVEL = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const GOVERNANCE_MODE = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  ADVISORY: 'ADVISORY',
  REQUIRED: 'REQUIRED',
  FAIL_CLOSED: 'FAIL_CLOSED',
});

export const APPROVAL_MODE = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  OPTIONAL: 'OPTIONAL',
  REQUIRED: 'REQUIRED',
  MAKER_CHECKER_REQUIRED: 'MAKER_CHECKER_REQUIRED',
});

export const EXECUTION_MODE = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  ANALYSIS_ONLY: 'ANALYSIS_ONLY',
  RECOMMENDATION_ONLY: 'RECOMMENDATION_ONLY',
  SIMULATION_ONLY: 'SIMULATION_ONLY',
  CONTROL_PLANE: 'CONTROL_PLANE',
  FINANCIAL_EXECUTION: 'FINANCIAL_EXECUTION',
});

export const COMMAND_CAPABILITIES = Object.freeze({
  OBSERVE: 'command.observe',
  READ: 'command.read',
  ANALYZE: 'command.analyze',
  RECOMMEND: 'command.recommend',
  SIMULATE: 'command.simulate',
  REVIEW: 'command.review',
  ESCALATE: 'command.escalate',
  NOTIFY: 'command.notify',
  GOVERNANCE_EVALUATE: 'governance.evaluate',
  APPROVAL_REQUEST: 'approval.request',

  // Explicitly prohibited at this boundary.
  APPROVAL_GRANT: 'approval.grant',
  PROVIDER_CALL: 'provider.call',
  PAYMENT_EXECUTE: 'payment.execute',
  PAYMENT_SETTLE: 'payment.settle',
  LEDGER_MUTATE: 'ledger.mutate',
  BALANCE_MUTATE: 'balance.mutate',
  MODEL_DISABLE: 'model.disable',
  MODEL_RETRAIN: 'model.retrain',
  DATA_DELETE: 'data.delete',
});

export const COMMAND_REGISTRY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'COMMAND_REGISTRY_INVALID_INPUT',
  TENANT_REQUIRED: 'COMMAND_REGISTRY_TENANT_REQUIRED',
  TENANT_SCOPE_VIOLATION: 'COMMAND_REGISTRY_TENANT_SCOPE_VIOLATION',
  PROVIDER_SCOPE_VIOLATION: 'COMMAND_REGISTRY_PROVIDER_SCOPE_VIOLATION',
  COMMAND_REQUIRED: 'COMMAND_REGISTRY_COMMAND_REQUIRED',
  COMMAND_NOT_FOUND: 'COMMAND_REGISTRY_COMMAND_NOT_FOUND',
  COMMAND_VERSION_REQUIRED: 'COMMAND_REGISTRY_COMMAND_VERSION_REQUIRED',
  COMMAND_VERSION_INVALID: 'COMMAND_REGISTRY_COMMAND_VERSION_INVALID',
  COMMAND_VERSION_CONFLICT: 'COMMAND_REGISTRY_COMMAND_VERSION_CONFLICT',
  DUPLICATE_COMMAND: 'COMMAND_REGISTRY_DUPLICATE_COMMAND',
  COMMAND_IMMUTABLE: 'COMMAND_REGISTRY_COMMAND_IMMUTABLE',
  COMMAND_NOT_EXECUTABLE: 'COMMAND_REGISTRY_COMMAND_NOT_EXECUTABLE',
  COMMAND_DISABLED: 'COMMAND_REGISTRY_COMMAND_DISABLED',
  COMMAND_DEPRECATED: 'COMMAND_REGISTRY_COMMAND_DEPRECATED',
  COMMAND_RETIRED: 'COMMAND_REGISTRY_COMMAND_RETIRED',
  INVALID_LIFECYCLE_TRANSITION: 'COMMAND_REGISTRY_INVALID_LIFECYCLE_TRANSITION',
  CONCURRENCY_CONFLICT: 'COMMAND_REGISTRY_CONCURRENCY_CONFLICT',
  CAPABILITY_REQUIRED: 'COMMAND_REGISTRY_CAPABILITY_REQUIRED',
  CAPABILITY_NOT_ALLOWED: 'COMMAND_REGISTRY_CAPABILITY_NOT_ALLOWED',
  FORBIDDEN_CAPABILITY: 'COMMAND_REGISTRY_FORBIDDEN_CAPABILITY',
  REQUIRED_CAPABILITY_NOT_DECLARED: 'COMMAND_REGISTRY_REQUIRED_CAPABILITY_NOT_DECLARED',
  GOVERNANCE_REQUIRED: 'COMMAND_REGISTRY_GOVERNANCE_REQUIRED',
  APPROVAL_REQUIRED: 'COMMAND_REGISTRY_APPROVAL_REQUIRED',
  INPUT_INVALID: 'COMMAND_REGISTRY_INPUT_INVALID',
  SCHEMA_INVALID: 'COMMAND_REGISTRY_SCHEMA_INVALID',
  SCHEMA_UNSUPPORTED_KEY: 'COMMAND_REGISTRY_SCHEMA_UNSUPPORTED_KEY',
  PAYLOAD_TOO_LARGE: 'COMMAND_REGISTRY_PAYLOAD_TOO_LARGE',
  OUTPUT_TOO_LARGE: 'COMMAND_REGISTRY_OUTPUT_TOO_LARGE',
  ACTION_NOT_ALLOWED: 'COMMAND_REGISTRY_ACTION_NOT_ALLOWED',
  OFFLINE_UNSAFE: 'COMMAND_REGISTRY_OFFLINE_UNSAFE',
  PERSISTENCE_REQUIRED: 'COMMAND_REGISTRY_PERSISTENCE_REQUIRED',
  REPOSITORY_UNAVAILABLE: 'COMMAND_REGISTRY_REPOSITORY_UNAVAILABLE',
  AUDIT_UNAVAILABLE: 'COMMAND_REGISTRY_AUDIT_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'COMMAND_REGISTRY_IDEMPOTENCY_CONFLICT',
  EXPORT_TOO_LARGE: 'COMMAND_REGISTRY_EXPORT_TOO_LARGE',
  REGISTRY_CLOSED: 'COMMAND_REGISTRY_CLOSED',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  allowSystemScope: false,
  allowDraftResolution: false,
  allowDeprecatedResolution: false,
  allowRetiredResolution: false,
  allowDisabledResolution: false,
  allowFinancialCapabilities: false,
  allowProviderCapabilities: false,
  allowApprovalGrantCapability: false,
  allowControlPlaneCommands: true,
  allowInProcessHandlerMetadata: true,
  allowMultipleActiveVersions: false,

  // Production repositories should provide an atomic compare-and-set method.
  requireAtomicLifecycleTransition: true,
  requireDurableRepositoryForMutation: true,
  requireAuditForMutation: false,
  failClosedOnRepositoryError: true,
  failClosedOnAuditError: true,

  maxTenantIdLength: 160,
  maxNamespaceLength: 120,
  maxCommandNameLength: 180,
  maxCommandVersionLength: 80,
  maxCommandIdLength: 180,
  maxDescriptionLength: 1200,
  maxOwnerLength: 200,
  maxDomainLength: 120,
  maxActionLength: 160,
  maxActionCount: 50,
  maxCapabilityCount: 64,
  maxCapabilityLength: 160,
  maxRequiredEvidenceCount: 100,
  maxRequiredEvidenceLength: 160,
  maxTagCount: 64,
  maxTagLength: 80,
  maxDependencyCount: 50,
  maxDependencyLength: 240,
  maxSchemaDepth: 10,
  maxSchemaProperties: 150,
  maxEnumValues: 100,
  maxMetadataKeys: 100,
  maxTenantOverrides: 100,
  maxReasonLength: 1000,
  maxQueryLimit: 250,
  defaultQueryLimit: 50,
  maxPayloadBytes: 512 * 1024,
  maxOutputBytes: 2 * 1024 * 1024,
  defaultTimeoutMs: 8_000,
  maxTimeoutMs: 120_000,
  defaultConcurrencyLimit: 4,
  maxConcurrencyLimit: 100,
  maxInputBytes: 512 * 1024,
  maxOutputDefinitionBytes: 2 * 1024 * 1024,
  maxExportBytes: 4 * 1024 * 1024,
  maxValidationErrors: 50,
});

const STATUS_VALUES = Object.freeze(Object.values(COMMAND_STATUS));
const RISK_VALUES = Object.freeze(Object.values(COMMAND_RISK_LEVEL));
const GOVERNANCE_VALUES = Object.freeze(Object.values(GOVERNANCE_MODE));
const APPROVAL_VALUES = Object.freeze(Object.values(APPROVAL_MODE));
const EXECUTION_VALUES = Object.freeze(Object.values(EXECUTION_MODE));

const FORBIDDEN_CAPABILITY_SET = new Set([
  COMMAND_CAPABILITIES.PROVIDER_CALL,
  COMMAND_CAPABILITIES.PAYMENT_EXECUTE,
  COMMAND_CAPABILITIES.PAYMENT_SETTLE,
  COMMAND_CAPABILITIES.LEDGER_MUTATE,
  COMMAND_CAPABILITIES.BALANCE_MUTATE,
  COMMAND_CAPABILITIES.APPROVAL_GRANT,
  COMMAND_CAPABILITIES.MODEL_DISABLE,
  COMMAND_CAPABILITIES.MODEL_RETRAIN,
  COMMAND_CAPABILITIES.DATA_DELETE,
]);

const SIDE_EFFECT_CAPABILITY_PATTERNS = Object.freeze([
  /(?:^|\.)(execute|settle|capture|transfer|debit|credit|withdraw|deposit|disburse|collect|refund|reverse)(?:\.|$)/i,
  /(?:^|\.)ledger\.mutate(?:\.|$)/i,
  /(?:^|\.)balance\.mutate(?:\.|$)/i,
  /(?:^|\.)provider\.call(?:\.|$)/i,
  /(?:^|\.)approval\.grant(?:\.|$)/i,
  /(?:^|\.)data\.delete(?:\.|$)/i,
]);

const SECRET_KEY_PATTERNS = Object.freeze([
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
  /raw.?request/i,
  /raw.?response/i,
  /raw.?payload/i,
  /provider.?payload/i,
]);

const SENSITIVE_IDENTIFIER_PATTERNS = Object.freeze([
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
  /ip(address)?/i,
]);

const LIFECYCLE_TRANSITIONS = Object.freeze({
  [COMMAND_STATUS.DRAFT]: new Set([
    COMMAND_STATUS.ACTIVE,
    COMMAND_STATUS.DEPRECATED,
    COMMAND_STATUS.DISABLED,
    COMMAND_STATUS.RETIRED,
  ]),
  [COMMAND_STATUS.ACTIVE]: new Set([
    COMMAND_STATUS.DEPRECATED,
    COMMAND_STATUS.DISABLED,
    COMMAND_STATUS.RETIRED,
  ]),
  [COMMAND_STATUS.DEPRECATED]: new Set([
    COMMAND_STATUS.RETIRED,
    COMMAND_STATUS.DISABLED,
  ]),
  [COMMAND_STATUS.DISABLED]: new Set([
    COMMAND_STATUS.ACTIVE,
    COMMAND_STATUS.DEPRECATED,
    COMMAND_STATUS.RETIRED,
  ]),
  [COMMAND_STATUS.RETIRED]: new Set([]),
});

const SUPPORTED_SCHEMA_TYPES = new Set([
  'OBJECT',
  'ARRAY',
  'STRING',
  'NUMBER',
  'INTEGER',
  'BOOLEAN',
  'NULL',
]);

const RESERVED_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'required',
  'properties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'additionalProperties',
]);

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function normalizeString(value, maxLength = 200) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) return normalized.slice(0, maxLength);
  return normalized;
}

function requireString(value, field, maxLength) {
  const normalized = normalizeString(value, maxLength);
  if (!normalized) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.INVALID_INPUT,
      `${field} is required.`,
      { field },
    );
  }
  return normalized;
}

function upper(value, maxLength = 80) {
  return normalizeString(value, maxLength)?.toUpperCase();
}

function boundedInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function boundedNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function toIso(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableNormalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string' || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return 'NaN';
    return value > 0 ? 'Infinity' : '-Infinity';
  }

  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `base64:${value.toString('base64')}`;
  if (value instanceof Uint8Array) return `base64:${Buffer.from(value).toString('base64')}`;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => stableNormalize(item, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value.toJSON === 'function' && !isPlainObject(value)) {
    const result = stableNormalize(value.toJSON(), seen);
    seen.delete(value);
    return result;
  }

  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    result[key] = stableNormalize(value[key], seen);
  }

  seen.delete(value);
  return result;
}

function canonicalize(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  const input = typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : canonicalize(value);

  return createHash(HASH_ALGORITHM).update(input).digest('hex');
}

function digest(value) {
  return `sha256:${sha256(String(value)).slice(0, 40)}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function redact(value, key = '', depth = 0, limits = {}) {
  const maxDepth = limits.maxDepth ?? 10;
  const maxKeys = limits.maxKeys ?? 250;
  const maxArray = limits.maxArray ?? 250;
  const maxStringLength = limits.maxStringLength ?? 800;

  if (depth > maxDepth) return '[TRUNCATED]';
  if (value === undefined || value === null) return value;

  if (SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))) return '[REDACTED]';
  if (SENSITIVE_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(key))) return digest(value);

  if (typeof value !== 'object') {
    return typeof value === 'string' && value.length > maxStringLength
      ? `${value.slice(0, maxStringLength - 3)}...`
      : value;
  }

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return '[BINARY_REDACTED]';

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArray)
      .map((item) => redact(item, '', depth + 1, limits));
  }

  const result = Object.create(null);
  for (const childKey of Object.keys(value).slice(0, maxKeys)) {
    result[childKey] = redact(value[childKey], childKey, depth + 1, limits);
  }
  return result;
}

function redactForPersistence(value) {
  return redact(value, '', 0, {
    maxDepth: 10,
    maxKeys: 250,
    maxArray: 250,
    maxStringLength: 1_000,
  });
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.INVALID_INPUT,
      `${name} must be a plain object.`,
      { field: name },
    );
  }
}

function parseSemver(value, field = 'version') {
  const normalized = requireString(value, field, DEFAULT_CONFIG.maxCommandVersionLength);
  const match = normalized.match(SEMVER_PATTERN);
  if (!match) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.COMMAND_VERSION_INVALID,
      `${field} must use semantic versioning x.y.z with optional prerelease/build metadata.`,
      { field },
    );
  }

  return Object.freeze({
    raw: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  });
}

function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);

  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a.localeCompare(b);
}

function compareSemver(left, right) {
  const a = typeof left === 'string' ? parseSemver(left) : left;
  const b = typeof right === 'string' ? parseSemver(right) : right;

  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (!aPre.length && !bPre.length) return 0;
  if (!aPre.length) return 1;
  if (!bPre.length) return -1;

  const length = Math.max(aPre.length, bPre.length);
  for (let index = 0; index < length; index += 1) {
    if (aPre[index] === undefined) return -1;
    if (bPre[index] === undefined) return 1;
    const compared = compareIdentifiers(aPre[index], bPre[index]);
    if (compared !== 0) return compared;
  }

  return 0;
}

function isHigherVersion(candidate, current) {
  return !current || compareSemver(candidate.version, current.version) > 0;
}

function highestVersion(commands) {
  let current = null;
  for (const command of commands) {
    if (isHigherVersion(command, current)) current = command;
  }
  return current?.version ?? null;
}

function commandIdentity(namespace, name, version) {
  return `${namespace}:${name}@${version}`;
}

function commandFamilyKey(namespace, name) {
  return `${namespace}:${name}`;
}

export function buildCommandVersionKey(namespace, name, version) {
  return commandIdentity(
    requireString(namespace, 'namespace', DEFAULT_CONFIG.maxNamespaceLength),
    requireString(name, 'name', DEFAULT_CONFIG.maxCommandNameLength),
    parseSemver(version).raw,
  );
}

function normalizeEnum(value, allowed, fallback, field) {
  const normalized = upper(value, 120);
  if (!normalized) return fallback;
  if (!allowed.includes(normalized)) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.INVALID_INPUT,
      `${field} has an unsupported value.`,
      { field, value: normalized, allowed },
    );
  }
  return normalized;
}

function normalizeStringList(values, maxCount, maxLength) {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .map((value) => normalizeString(value, maxLength))
      .filter(Boolean),
  )].slice(0, maxCount);
}

function normalizeMetadata(value, config) {
  if (!isPlainObject(value)) return {};
  const entries = Object.entries(value).slice(0, config.maxMetadataKeys);
  return redactForPersistence(Object.fromEntries(entries));
}

function normalizeScope(value, config) {
  if (value === undefined || value === null) {
    return Object.freeze({
      global: true,
      tenants: [],
    });
  }

  assertPlainObject(value, 'scope');

  const global = value.global !== false;
  const tenants = normalizeStringList(
    value.tenants,
    config.maxTenantOverrides,
    config.maxTenantIdLength,
  );

  if (!global && tenants.length === 0) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.TENANT_SCOPE_VIOLATION,
      'A non-global command scope must declare at least one tenant.',
    );
  }

  return {
    global,
    tenants,
  };
}

function normalizeHandlerMetadata(handler) {
  if (handler === undefined || handler === null) return null;
  return {
    present: typeof handler === 'function',
    type: typeof handler === 'function' ? 'IN_PROCESS_HANDLER' : 'UNSUPPORTED',
  };
}

function containsForbiddenCapability(capability) {
  if (FORBIDDEN_CAPABILITY_SET.has(capability)) return true;
  return SIDE_EFFECT_CAPABILITY_PATTERNS.some((pattern) => pattern.test(capability));
}

function safeCapabilitySet(values) {
  return new Set(Array.isArray(values) ? values : []);
}

function validateSchemaNode(node, config, depth = 0, path = '$') {
  if (depth > config.maxSchemaDepth) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
      `Schema depth exceeds ${config.maxSchemaDepth}.`,
      { path },
    );
  }

  assertPlainObject(node, `schema node at ${path}`);

  const type = normalizeEnum(
    node.type,
    [...SUPPORTED_SCHEMA_TYPES],
    null,
    `${path}.type`,
  );

  if (!type) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
      `${path}.type is required.`,
      { path },
    );
  }

  for (const key of Object.keys(node)) {
    if (!RESERVED_SCHEMA_KEYS.has(key)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_UNSUPPORTED_KEY,
        `Unsupported schema key ${key} at ${path}.`,
        { path, key },
      );
    }
  }

  const normalized = {
    type,
  };

  if (node.description !== undefined) {
    normalized.description = normalizeString(node.description, 600) ?? null;
  }

  if (node.required !== undefined) {
    if (!Array.isArray(node.required)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
        `${path}.required must be an array.`,
      );
    }
    normalized.required = normalizeStringList(
      node.required,
      config.maxSchemaProperties,
      config.maxCommandNameLength,
    );
  } else {
    normalized.required = [];
  }

  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
        `${path}.enum must be an array.`,
      );
    }
    if (node.enum.length > config.maxEnumValues) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
        `${path}.enum exceeds ${config.maxEnumValues} values.`,
      );
    }
    normalized.enum = node.enum.map((value) => redactForPersistence(value));
  }

  const minimum = node.minimum !== undefined ? Number(node.minimum) : undefined;
  const maximum = node.maximum !== undefined ? Number(node.maximum) : undefined;
  const minLength = node.minLength !== undefined ? Number(node.minLength) : undefined;
  const maxLength = node.maxLength !== undefined ? Number(node.maxLength) : undefined;
  const minItems = node.minItems !== undefined ? Number(node.minItems) : undefined;
  const maxItems = node.maxItems !== undefined ? Number(node.maxItems) : undefined;

  if (minimum !== undefined && !Number.isFinite(minimum)) {
    throw new CommandRegistryError(COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID, `${path}.minimum must be finite.`);
  }
  if (maximum !== undefined && !Number.isFinite(maximum)) {
    throw new CommandRegistryError(COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID, `${path}.maximum must be finite.`);
  }
  if (minimum !== undefined) normalized.minimum = minimum;
  if (maximum !== undefined) normalized.maximum = maximum;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new CommandRegistryError(COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID, `${path}.minimum cannot exceed maximum.`);
  }

  if (minLength !== undefined) normalized.minLength = boundedInteger(minLength, 0, { min: 0, max: 1_000_000 });
  if (maxLength !== undefined) normalized.maxLength = boundedInteger(maxLength, 0, { min: 0, max: 1_000_000 });
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw new CommandRegistryError(COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID, `${path}.minLength cannot exceed maxLength.`);
  }

  if (minItems !== undefined) normalized.minItems = boundedInteger(minItems, 0, { min: 0, max: 100_000 });
  if (maxItems !== undefined) normalized.maxItems = boundedInteger(maxItems, 0, { min: 0, max: 100_000 });
  if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
    throw new CommandRegistryError(COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID, `${path}.minItems cannot exceed maxItems.`);
  }

  if (node.additionalProperties !== undefined) {
    if (typeof node.additionalProperties !== 'boolean') {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
        `${path}.additionalProperties must be boolean.`,
      );
    }
    normalized.additionalProperties = node.additionalProperties;
  }

  if (type === 'OBJECT') {
    const properties = node.properties === undefined ? {} : node.properties;
    if (!isPlainObject(properties)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
        `${path}.properties must be an object.`,
      );
    }

    const propertyNames = Object.keys(properties).slice(0, config.maxSchemaProperties);
    if (Object.keys(properties).length > config.maxSchemaProperties) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
        `${path}.properties exceeds ${config.maxSchemaProperties} properties.`,
      );
    }

    normalized.properties = Object.fromEntries(
      propertyNames.map((key) => [
        requireString(key, `${path}.propertyName`, config.maxCommandNameLength),
        validateSchemaNode(properties[key], config, depth + 1, `${path}.${key}`),
      ]),
    );

    const propertySet = new Set(Object.keys(normalized.properties));
    const unknownRequired = normalized.required.filter((key) => !propertySet.has(key));
    if (unknownRequired.length) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
        `${path}.required references properties that are not declared.`,
        { unknownRequired },
      );
    }
  }

  if (type === 'ARRAY' && node.items !== undefined) {
    normalized.items = validateSchemaNode(node.items, config, depth + 1, `${path}.items`);
  }

  if (type === 'ARRAY' && node.items === undefined && (minItems ?? 0) > 0) {
    throw new CommandRegistryError(
      COMMAND_REGISTRY_ERROR_CODES.SCHEMA_INVALID,
      `${path}.items is required when minItems is greater than zero.`,
    );
  }

  return normalized;
}

function schemaTypeMatches(value, type) {
  return (
    (type === 'NULL' && value === null)
    || (type === 'OBJECT' && isPlainObject(value))
    || (type === 'ARRAY' && Array.isArray(value))
    || (type === 'STRING' && typeof value === 'string')
    || (type === 'NUMBER' && typeof value === 'number' && Number.isFinite(value))
    || (type === 'INTEGER' && typeof value === 'number' && Number.isInteger(value))
    || (type === 'BOOLEAN' && typeof value === 'boolean')
  );
}

function validateDataAgainstSchema(value, schema, path = '$', errors = [], limit = 50) {
  if (errors.length >= limit || !schema) return errors;

  if (!schemaTypeMatches(value, schema.type)) {
    errors.push({
      path,
      code: 'TYPE_MISMATCH',
      expected: schema.type,
    });
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => canonicalize(item) === canonicalize(value))) {
    errors.push({ path, code: 'ENUM_MISMATCH' });
    if (errors.length >= limit) return errors;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, code: 'MIN_LENGTH' });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, code: 'MAX_LENGTH' });
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, code: 'MINIMUM' });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, code: 'MAXIMUM' });
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, code: 'MIN_ITEMS' });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, code: 'MAX_ITEMS' });

    if (schema.items) {
      for (let index = 0; index < Math.min(value.length, 250); index += 1) {
        validateDataAgainstSchema(value[index], schema.items, `${path}[${index}]`, errors, limit);
        if (errors.length >= limit) break;
      }
    }
  }

  if (schema.type === 'OBJECT') {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({ path: `${path}.${key}`, code: 'REQUIRED' });
        if (errors.length >= limit) break;
      }
    }

    if (errors.length < limit) {
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      for (const [key, childSchema] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateDataAgainstSchema(value[key], childSchema, `${path}.${key}`, errors, limit);
          if (errors.length >= limit) break;
        }
      }
    }

    if (errors.length < limit && schema.additionalProperties === false) {
      const properties = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!properties.has(key)) {
          errors.push({ path: `${path}.${key}`, code: 'ADDITIONAL_PROPERTY' });
          if (errors.length >= limit) break;
        }
      }
    }
  }

  return errors;
}

function normalizeRisk(value) {
  return normalizeEnum(value, RISK_VALUES, COMMAND_RISK_LEVEL.MEDIUM, 'riskLevel');
}

function normalizeGovernance(value) {
  return normalizeEnum(value, GOVERNANCE_VALUES, GOVERNANCE_MODE.REQUIRED, 'governanceMode');
}

function normalizeApproval(value) {
  return normalizeEnum(value, APPROVAL_VALUES, APPROVAL_MODE.NOT_REQUIRED, 'approvalMode');
}

function normalizeExecutionMode(value) {
  return normalizeEnum(value, EXECUTION_VALUES, EXECUTION_MODE.ANALYSIS_ONLY, 'executionMode');
}

function commandStatusAllowed(status, config) {
  if (status === COMMAND_STATUS.ACTIVE) return true;
  if (status === COMMAND_STATUS.DRAFT) return config.allowDraftResolution;
  if (status === COMMAND_STATUS.DEPRECATED) return config.allowDeprecatedResolution;
  if (status === COMMAND_STATUS.RETIRED) return config.allowRetiredResolution;
  if (status === COMMAND_STATUS.DISABLED) return config.allowDisabledResolution;
  return false;
}

function lifecycleTransitionAllowed(from, to) {
  return Boolean(LIFECYCLE_TRANSITIONS[from]?.has(to));
}

function normalizedCommandReference(command) {
  return commandIdentity(command.namespace, command.name, command.version);
}

function semanticContractFromDefinition(definition) {
  return {
    schemaVersion: SCHEMA_VERSION,
    provider: definition.provider,
    namespace: definition.namespace,
    name: definition.name,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    owner: definition.owner,
    domain: definition.domain,
    riskLevel: definition.riskLevel,
    executionMode: definition.executionMode,
    governanceMode: definition.governanceMode,
    approvalMode: definition.approvalMode,
    capabilities: definition.capabilities,
    requiredCapabilities: definition.requiredCapabilities,
    actions: definition.actions,
    sideEffectFree: definition.sideEffectFree,
    idempotent: definition.idempotent,
    retryable: definition.retryable,
    offlineSafe: definition.offlineSafe,
    tenantScoped: definition.tenantScoped,
    providerScoped: true,
    readOnly: definition.readOnly,
    timeoutMs: definition.timeoutMs,
    concurrencyLimit: definition.concurrencyLimit,
    maxInputBytes: definition.maxInputBytes,
    maxOutputBytes: definition.maxOutputBytes,
    tags: definition.tags,
    requiredEvidence: definition.requiredEvidence,
    dependencies: definition.dependencies,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    safetyProfile: definition.safetyProfile,
  };
}

function buildSemanticFingerprint(definition) {
  return `sha256:${sha256(semanticContractFromDefinition(definition))}`;
}

function buildRecordFingerprint(record) {
  return `sha256:${sha256({
    commandId: record.commandId,
    semanticFingerprint: record.semanticFingerprint,
    status: record.status,
    deprecation: record.deprecation,
    scope: record.scope,
    metadata: record.metadata,
    version: record.recordVersion,
    updatedAt: record.updatedAt,
  })}`;
}

export function buildCommandFingerprint(value) {
  return `sha256:${sha256(value)}`;
}

function makeCommandId() {
  return `cmd_${randomUUID()}`;
}

function safeNow(clock) {
  try {
    const value = typeof clock === 'function' ? clock() : Date.now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

function normalizeDependency(value, config) {
  if (!isPlainObject(value)) return null;

  const namespace = normalizeString(value.namespace, config.maxNamespaceLength);
  const name = normalizeString(value.name, config.maxCommandNameLength);
  const version = value.version ? parseSemver(value.version).raw : null;

  if (!namespace || !name) return null;

  return {
    namespace,
    name,
    version,
    optional: value.optional === true,
  };
}

function normalizeDependencies(values, config) {
  if (!Array.isArray(values)) return [];
  return values
    .slice(0, config.maxDependencyCount)
    .map((value) => normalizeDependency(value, config))
    .filter(Boolean);
}

function normalizeSafetyProfile(definition) {
  return {
    providerCallAllowed: false,
    financialExecutionAllowed: false,
    paymentPostingAuthority: false,
    settlementAuthority: false,
    ledgerMutationAuthority: false,
    balanceMutationAuthority: false,
    approvalGrantAuthority: false,
    arbitraryCodeExecutionAllowed: false,
    offlineFinalSettlementAuthority: false,
    executionMode: definition.executionMode,
  };
}

export class CommandRegistryError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'CommandRegistryError';
    this.code = code;
    this.component = COMPONENT;
    this.provider = PROVIDER;
    this.details = redactForPersistence(details);
    this.retryable = Boolean(options.retryable);
    this.httpStatus = Number.isFinite(options.httpStatus) ? options.httpStatus : 400;
  }
}

export class InMemoryCommandRegistryRepository {
  constructor(seed = {}) {
    const commands = Array.isArray(seed?.commands) ? seed.commands : [];
    this.commands = new Map();
    this.closed = false;
    this._seed(commands);
  }

  _assertOpen() {
    if (this.closed) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REGISTRY_CLOSED,
        'Command registry repository is closed.',
      );
    }
  }

  _seed(commands) {
    for (const command of commands) {
      if (!isPlainObject(command)) continue;
      if (!command.namespace || !command.name || !command.version) continue;
      this.commands.set(
        commandIdentity(command.namespace, command.name, command.version),
        clone(command),
      );
    }
  }

  async save(command) {
    this._assertOpen();
    const key = normalizedCommandReference(command);
    if (this.commands.has(key)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.DUPLICATE_COMMAND,
        `Command ${key} already exists.`,
        { command: key },
        { httpStatus: 409 },
      );
    }
    this.commands.set(key, clone(command));
    return clone(command);
  }

  async get({ tenantId, provider = PROVIDER, namespace, name, version } = {}) {
    this._assertOpen();

    const commands = [...this.commands.values()]
      .filter((item) => item.provider === provider)
      .filter((item) => item.namespace === namespace && item.name === name)
      .filter((item) => !version || item.version === version)
      .filter((item) => {
        if (!tenantId) return true;
        if (item.scope?.global === false) return item.scope.tenants?.includes(tenantId);
        if (!item.tenantScoped) return true;
        return !item.scope?.tenants?.length || item.scope.tenants.includes(tenantId);
      });

    if (!commands.length) return null;

    if (version) return clone(commands[0]);

    return clone([...commands].sort((a, b) => compareSemver(b.version, a.version))[0]);
  }

  async list({
    tenantId,
    provider = PROVIDER,
    namespace,
    name,
    version,
    status,
    tags,
    capability,
    action,
    limit = 50,
    offset = 0,
    includeInactive = true,
  } = {}) {
    this._assertOpen();

    let filtered = [...this.commands.values()]
      .filter((item) => item.provider === provider)
      .filter((item) => {
        if (!tenantId) return true;
        if (item.scope?.global === false) {
          return Boolean(item.scope?.tenants?.includes(tenantId));
        }
        if (!item.tenantScoped) return true;
        return !item.scope?.tenants?.length || item.scope.tenants.includes(tenantId);
      })
      .filter((item) => !namespace || item.namespace === namespace)
      .filter((item) => !name || item.name === name)
      .filter((item) => !version || item.version === version)
      .filter((item) => !status || item.status === status)
      .filter((item) => !capability || item.capabilities?.includes(capability))
      .filter((item) => !action || item.actions?.includes(action));

    if (Array.isArray(tags) && tags.length) {
      filtered = filtered.filter((item) => tags.every((tag) => item.tags?.includes(tag)));
    }

    if (!includeInactive) filtered = filtered.filter((item) => item.status === COMMAND_STATUS.ACTIVE);

    filtered.sort((a, b) =>
      a.namespace.localeCompare(b.namespace)
      || a.name.localeCompare(b.name)
      || compareSemver(a.version, b.version));

    const entries = filtered.slice(offset, offset + limit).map(clone);

    return {
      entries,
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + entries.length < filtered.length,
    };
  }

  async count({ tenantId, provider = PROVIDER, status } = {}) {
    const result = await this.list({
      tenantId,
      provider,
      status,
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    });
    return result.total;
  }

  async updateStatus({
    provider = PROVIDER,
    namespace,
    name,
    version,
    status,
    patch = {},
    expectedRecordVersion,
    expectedSemanticFingerprint,
  } = {}) {
    return this.transitionStatus({
      provider,
      namespace,
      name,
      version,
      toStatus: status,
      patch,
      expectedRecordVersion,
      expectedSemanticFingerprint,
    });
  }

  async transitionStatus({
    provider = PROVIDER,
    namespace,
    name,
    version,
    toStatus,
    patch = {},
    expectedRecordVersion,
    expectedSemanticFingerprint,
  } = {}) {
    this._assertOpen();
    const key = commandIdentity(namespace, name, version);
    const current = this.commands.get(key);
    if (!current || current.provider !== provider) return null;

    if (expectedRecordVersion !== undefined && Number(current.recordVersion) !== Number(expectedRecordVersion)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.CONCURRENCY_CONFLICT,
        'Command lifecycle transition lost an optimistic concurrency race.',
        { command: key },
        { httpStatus: 409, retryable: true },
      );
    }

    if (expectedSemanticFingerprint && current.semanticFingerprint !== expectedSemanticFingerprint) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_IMMUTABLE,
        'Command semantic fingerprint changed unexpectedly.',
        { command: key },
        { httpStatus: 409 },
      );
    }

    const updated = {
      ...clone(current),
      ...clone(patch),
      status: toStatus,
      recordVersion: Number(current.recordVersion ?? 1) + 1,
    };

    updated.semanticFingerprint = current.semanticFingerprint;
    updated.recordFingerprint = buildRecordFingerprint(updated);
    this.commands.set(key, clone(updated));
    return clone(updated);
  }

  async healthCheck() {
    return {
      ok: !this.closed,
      type: 'IN_MEMORY',
      commandCount: this.commands.size,
      durable: false,
      closed: this.closed,
    };
  }

  async close() {
    this.closed = true;
  }
}

export class CommandRegistry {
  constructor(options = {}) {
    assertPlainObject(options, 'options');

    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...(isPlainObject(options.config) ? options.config : {}),
    });

    const configuredProvider = upper(this.config.provider, 40) ?? PROVIDER;
    if (configuredProvider !== PROVIDER) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'This command registry is scoped to Airtel.',
        { provider: configuredProvider },
        { httpStatus: 500 },
      );
    }

    this.provider = PROVIDER;
    this.repository = options.repository ?? options.commandRepository ?? null;
    this.audit = options.audit ?? options.auditLedger ?? null;
    this.logger = options.logger ?? null;
    this.metrics = options.metrics ?? null;
    this.tracer = options.tracer ?? null;
    this.eventBus = options.eventBus ?? null;
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : makeCommandId;

    this.localDefinitions = new Map();
    this.closed = false;
  }

  _assertOpen() {
    if (this.closed) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REGISTRY_CLOSED,
        'Command registry is closed.',
        {},
        { httpStatus: 503, retryable: false },
      );
    }
  }

  _tenantId(tenantId, required = this.config.tenantRequired) {
    const normalized = normalizeString(tenantId, this.config.maxTenantIdLength);
    if (required && !normalized) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required.',
        {},
        { httpStatus: 400 },
      );
    }
    return normalized;
  }

  _provider(provider) {
    const normalized = upper(provider ?? PROVIDER, 40);
    if (normalized !== PROVIDER) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'Command registry is scoped to Airtel.',
        { provider: normalized },
        { httpStatus: 409 },
      );
    }
    return PROVIDER;
  }

  _requireRepository(method, { mutation = false } = {}) {
    const fn = this.repository?.[method];
    if (typeof fn === 'function') return fn.bind(this.repository);

    if (mutation && this.config.requireDurableRepositoryForMutation) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.PERSISTENCE_REQUIRED,
        `Durable command registry repository method ${method}() is required.`,
        { method },
        { httpStatus: 503, retryable: true },
      );
    }

    return null;
  }

  _log(level, message, error = null, context = {}) {
    try {
      const method = this.logger?.[level] ?? this.logger?.info;
      if (typeof method !== 'function') return;
      method.call(
        this.logger,
        {
          component: COMPONENT,
          provider: PROVIDER,
          ...redactForPersistence(context),
          ...(error ? {
            error: {
              name: error.name,
              code: error.code,
              message: String(error.message ?? '').slice(0, 400),
            },
          } : {}),
        },
        message,
      );
    } catch {
      // Logging is intentionally non-authoritative.
    }
  }

  _metric(name, labels = {}, value = 1) {
    try {
      if (typeof this.metrics?.increment === 'function') {
        this.metrics.increment(name, labels, value);
      } else if (typeof this.metrics?.inc === 'function') {
        this.metrics.inc(name, value, labels);
      }
    } catch {
      // Metrics are intentionally non-authoritative.
    }
  }

  async _trace(name, attributes, operation) {
    const start = Date.now();
    const spanFactory = this.tracer?.startSpan;
    if (typeof spanFactory !== 'function') return operation();

    let span = null;
    try {
      span = spanFactory.call(this.tracer, name, redactForPersistence(attributes));
      const result = await operation();
      try { span?.setStatus?.({ code: 1 }); } catch {}
      return result;
    } catch (error) {
      try {
        span?.recordException?.(error);
        span?.setStatus?.({ code: 2, message: error.message });
      } catch {}
      throw error;
    } finally {
      try { span?.setAttribute?.('duration_ms', Date.now() - start); } catch {}
      try { span?.end?.(); } catch {}
    }
  }

  async _auditEvent(event, { required = this.config.requireAuditForMutation } = {}) {
    if (!this.audit) {
      if (required) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.AUDIT_UNAVAILABLE,
          'Command registry mutation requires an audit boundary.',
          {},
          { httpStatus: 503, retryable: true },
        );
      }
      return;
    }

    const writer = this.audit.append ?? this.audit.record ?? this.audit.write;
    if (typeof writer !== 'function') {
      if (required) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.AUDIT_UNAVAILABLE,
          'Configured command registry audit adapter does not implement append()/record()/write().',
          {},
          { httpStatus: 503, retryable: true },
        );
      }
      return;
    }

    const safeEvent = deepFreeze(redactForPersistence({
      ...event,
      component: COMPONENT,
      provider: PROVIDER,
      schemaVersion: SCHEMA_VERSION,
      emittedAt: event.emittedAt ?? safeNow(this.clock).toISOString(),
    }));

    try {
      await writer.call(this.audit, safeEvent);
    } catch (error) {
      this._log('error', 'Command registry audit write failed.', error, {
        eventType: event.eventType,
        commandRef: event.commandRef,
      });

      if (this.config.failClosedOnAuditError || required) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.AUDIT_UNAVAILABLE,
          'Command registry mutation cannot safely continue while audit persistence is unavailable.',
          {},
          { httpStatus: 503, retryable: true, cause: error },
        );
      }
    }
  }

  async _emitEvent(event) {
    const publisher = this.eventBus?.publish ?? this.eventBus?.emit ?? this.eventBus?.dispatch;
    if (typeof publisher !== 'function') return;

    try {
      await publisher.call(this.eventBus, redactForPersistence({
        ...event,
        component: COMPONENT,
        provider: PROVIDER,
        schemaVersion: SCHEMA_VERSION,
      }));
    } catch (error) {
      this._log('warn', 'Command registry event publication failed; state remains authoritative.', error, {
        eventType: event.eventType,
      });
    }
  }

  _rejectForbiddenCapabilities(capabilities) {
    for (const capability of capabilities) {
      if (containsForbiddenCapability(capability)) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.FORBIDDEN_CAPABILITY,
          `Capability ${capability} is forbidden at the Airtel command registry boundary.`,
          { capability },
          { httpStatus: 409 },
        );
      }
    }
  }

  _normalizeDefinition(definition, options = {}) {
    assertPlainObject(definition, 'command definition');

    const namespace = requireString(
      definition.namespace,
      'namespace',
      this.config.maxNamespaceLength,
    );
    const name = requireString(
      definition.name ?? definition.commandName,
      'name',
      this.config.maxCommandNameLength,
    );
    const version = parseSemver(
      definition.version,
      'command version',
    ).raw;
    const provider = this._provider(definition.provider);

    const status = normalizeEnum(
      definition.status,
      STATUS_VALUES,
      options.publish === true ? COMMAND_STATUS.ACTIVE : COMMAND_STATUS.DRAFT,
      'status',
    );
    const riskLevel = normalizeRisk(definition.riskLevel);
    const governanceMode = normalizeGovernance(definition.governanceMode);
    const approvalMode = normalizeApproval(definition.approvalMode);
    const executionMode = normalizeExecutionMode(definition.executionMode);

    const capabilities = normalizeStringList(
      definition.capabilities,
      this.config.maxCapabilityCount,
      this.config.maxCapabilityLength,
    );
    const requiredCapabilities = normalizeStringList(
      definition.requiredCapabilities ?? capabilities,
      this.config.maxCapabilityCount,
      this.config.maxCapabilityLength,
    );
    const actions = normalizeStringList(
      definition.actions ?? definition.allowedActions,
      this.config.maxActionCount,
      this.config.maxActionLength,
    );

    this._rejectForbiddenCapabilities(capabilities);
    this._rejectForbiddenCapabilities(requiredCapabilities);

    const capabilitySet = safeCapabilitySet(capabilities);
    const undeclaredRequired = requiredCapabilities.filter((capability) => !capabilitySet.has(capability));
    if (undeclaredRequired.length) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REQUIRED_CAPABILITY_NOT_DECLARED,
        'requiredCapabilities must be a subset of capabilities.',
        { undeclaredRequired },
        { httpStatus: 422 },
      );
    }

    if (executionMode === EXECUTION_MODE.FINANCIAL_EXECUTION) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.FORBIDDEN_CAPABILITY,
        'FINANCIAL_EXECUTION is forbidden at the command registry boundary.',
        {},
        { httpStatus: 409 },
      );
    }

    if (executionMode === EXECUTION_MODE.CONTROL_PLANE && !this.config.allowControlPlaneCommands) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.FORBIDDEN_CAPABILITY,
        'CONTROL_PLANE commands are disabled by registry policy.',
      );
    }

    if (riskLevel === COMMAND_RISK_LEVEL.CRITICAL && governanceMode === GOVERNANCE_MODE.NOT_REQUIRED) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.GOVERNANCE_REQUIRED,
        'CRITICAL-risk commands must declare governance.',
      );
    }

    if (riskLevel === COMMAND_RISK_LEVEL.CRITICAL && approvalMode === APPROVAL_MODE.NOT_REQUIRED) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.APPROVAL_REQUIRED,
        'CRITICAL-risk commands must declare an approval requirement.',
      );
    }

    if (approvalMode === APPROVAL_MODE.MAKER_CHECKER_REQUIRED && governanceMode === GOVERNANCE_MODE.NOT_REQUIRED) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.GOVERNANCE_REQUIRED,
        'Maker-checker approval requires governance.',
      );
    }

    const readOnly = definition.readOnly !== false;
    const inferredSideEffectFree = capabilities.length === 0 || capabilities.every((capability) => !containsForbiddenCapability(capability));
    const sideEffectFree = definition.sideEffectFree ?? inferredSideEffectFree;

    if (sideEffectFree && !readOnly && executionMode === EXECUTION_MODE.CONTROL_PLANE) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.INVALID_INPUT,
        'A non-read-only CONTROL_PLANE command cannot declare sideEffectFree=true.',
      );
    }

    const offlineSafe = Boolean(definition.offlineSafe);
    if (offlineSafe && [EXECUTION_MODE.CONTROL_PLANE, EXECUTION_MODE.FINANCIAL_EXECUTION].includes(executionMode)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.OFFLINE_UNSAFE,
        'Offline-safe commands cannot declare financial or control-plane execution modes.',
      );
    }

    const inputSchema = definition.inputSchema
      ? validateSchemaNode(definition.inputSchema, this.config)
      : { type: 'OBJECT', properties: {}, required: [] };
    const outputSchema = definition.outputSchema
      ? validateSchemaNode(definition.outputSchema, this.config)
      : null;

    const maxInputBytes = boundedInteger(
      definition.maxInputBytes,
      Math.min(this.config.maxInputBytes, 128 * 1024),
      { min: 1, max: this.config.maxInputBytes },
    );
    const maxOutputBytes = boundedInteger(
      definition.maxOutputBytes,
      Math.min(this.config.maxOutputDefinitionBytes, 256 * 1024),
      { min: 1, max: this.config.maxOutputDefinitionBytes },
    );

    const timeoutMs = boundedInteger(
      definition.timeoutMs,
      this.config.defaultTimeoutMs,
      { min: 1, max: this.config.maxTimeoutMs },
    );
    const concurrencyLimit = boundedInteger(
      definition.concurrencyLimit,
      this.config.defaultConcurrencyLimit,
      { min: 1, max: this.config.maxConcurrencyLimit },
    );

    const scope = normalizeScope(definition.scope, this.config);
    const tenantScoped = definition.tenantScoped !== false;
    if (!this.config.allowSystemScope && !tenantScoped && !scope.tenants.length) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.TENANT_SCOPE_VIOLATION,
        'System-scope commands are disabled by registry policy.',
      );
    }

    const metadata = normalizeMetadata(definition.metadata, this.config);
    const deprecation = isPlainObject(definition.deprecation)
      ? redactForPersistence(definition.deprecation)
      : null;
    const dependencies = normalizeDependencies(definition.dependencies, this.config);

    const normalized = {
      schemaVersion: SCHEMA_VERSION,
      provider,
      registryComponent: COMPONENT,
      commandId: normalizeString(definition.commandId, this.config.maxCommandIdLength) ?? this.idFactory(),
      namespace,
      name,
      version,
      title: normalizeString(definition.title, this.config.maxDescriptionLength) ?? `${namespace}:${name}`,
      description: normalizeString(definition.description, this.config.maxDescriptionLength) ?? null,
      owner: normalizeString(definition.owner, this.config.maxOwnerLength) ?? null,
      domain: normalizeString(definition.domain, this.config.maxDomainLength) ?? 'INTELLIGENCE',
      riskLevel,
      executionMode,
      governanceMode,
      approvalMode,
      capabilities,
      requiredCapabilities,
      actions,
      sideEffectFree,
      idempotent: definition.idempotent !== false,
      retryable: definition.retryable !== false,
      offlineSafe,
      tenantScoped,
      providerScoped: true,
      readOnly,
      timeoutMs,
      concurrencyLimit,
      maxInputBytes,
      maxOutputBytes,
      tags: normalizeStringList(definition.tags, this.config.maxTagCount, this.config.maxTagLength),
      requiredEvidence: normalizeStringList(definition.requiredEvidence, this.config.maxRequiredEvidenceCount, this.config.maxRequiredEvidenceLength),
      dependencies,
      scope,
      inputSchema,
      outputSchema,
      prohibitedCapabilities: [...FORBIDDEN_CAPABILITY_SET].sort(),
      safetyProfile: null,
      handlerMetadata: normalizeHandlerMetadata(definition.handler),
      metadata,
      deprecation,
      status,
      createdAt: toIso(definition.createdAt, safeNow(this.clock).toISOString()),
      updatedAt: safeNow(this.clock).toISOString(),
      recordVersion: boundedInteger(definition.recordVersion, 1, { min: 1, max: Number.MAX_SAFE_INTEGER }),
    };

    if (normalized.handlerMetadata?.type === 'IN_PROCESS_HANDLER' && !this.config.allowInProcessHandlerMetadata) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.INVALID_INPUT,
        'In-process handler metadata is disabled by registry policy.',
      );
    }

    normalized.safetyProfile = normalizeSafetyProfile(normalized);
    normalized.semanticFingerprint = buildSemanticFingerprint(normalized);
    normalized.recordFingerprint = buildRecordFingerprint(normalized);

    if (jsonBytes(normalized) > this.config.maxPayloadBytes) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.PAYLOAD_TOO_LARGE,
        'Command definition exceeds registry storage bounds.',
        { maxPayloadBytes: this.config.maxPayloadBytes },
      );
    }

    return normalized;
  }

  _visibleToTenant(command, tenantId) {
    if (!command) return false;
    if (command.scope?.global === false) {
      return Boolean(tenantId && command.scope.tenants?.includes(tenantId));
    }
    if (!command.tenantScoped) return true;
    if (!tenantId) return !this.config.tenantRequired;
    return !command.scope?.tenants?.length || command.scope.tenants.includes(tenantId);
  }

  _assertDefinitionImmutable(existing, incoming) {
    if (existing.semanticFingerprint !== incoming.semanticFingerprint) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_IMMUTABLE,
        'A command version is immutable. Register a new semantic version for a contract change.',
        {
          command: normalizedCommandReference(existing),
          existingSemanticFingerprint: existing.semanticFingerprint,
          incomingSemanticFingerprint: incoming.semanticFingerprint,
        },
        { httpStatus: 409 },
      );
    }
  }

  _sanitizeForReturn(value) {
    return deepFreeze(redactForPersistence(clone(value)));
  }

  async _findExact(namespace, name, version, tenantId, { allowInactive = true } = {}) {
    const key = commandIdentity(namespace, name, version);
    const local = this.localDefinitions.get(key);
    if (local && this._visibleToTenant(local, tenantId)) {
      if (!allowInactive && !commandStatusAllowed(local.status, this.config)) return null;
      return clone(local);
    }

    const getter = this._requireRepository('get');
    if (!getter) return null;

    try {
      const result = await getter({
        tenantId,
        provider: PROVIDER,
        namespace,
        name,
        version,
      });
      if (!result) return null;
      if (!this._visibleToTenant(result, tenantId)) return null;
      if (!allowInactive && !commandStatusAllowed(result.status, this.config)) return null;

      this.localDefinitions.set(key, clone(result));
      return clone(result);
    } catch (error) {
      this._log('error', 'Command registry exact lookup failed.', error, { namespace, name, version });
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'Unable to read command registry state.',
        { namespace, name, version },
        { httpStatus: 503, retryable: true, cause: error },
      );
    }
  }

  async _findCandidates(namespace, name, tenantId, { allowInactive = false, limit = this.config.maxQueryLimit } = {}) {
    const local = [...this.localDefinitions.values()]
      .filter((item) => item.namespace === namespace && item.name === name)
      .filter((item) => this._visibleToTenant(item, tenantId))
      .filter((item) => allowInactive || commandStatusAllowed(item.status, this.config));

    if (local.length) return local.slice(0, limit).map(clone);

    const lister = this._requireRepository('list');
    if (!lister) return [];

    try {
      const result = await lister({
        tenantId,
        provider: PROVIDER,
        namespace,
        name,
        limit,
        offset: 0,
        includeInactive: allowInactive,
      });

      const entries = Array.isArray(result?.entries) ? result.entries : Array.isArray(result) ? result : [];
      const visible = entries
        .filter((item) => this._visibleToTenant(item, tenantId))
        .filter((item) => allowInactive || commandStatusAllowed(item.status, this.config));

      for (const item of visible) {
        this.localDefinitions.set(commandIdentity(item.namespace, item.name, item.version), clone(item));
      }

      return visible.map(clone);
    } catch (error) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'Unable to list command registry candidates.',
        { namespace, name },
        { httpStatus: 503, retryable: true, cause: error },
      );
    }
  }

  async registerCommand(definition = {}, options = {}) {
    this._assertOpen();

    return this._trace(
      'command.registry.register',
      { namespace: definition?.namespace, name: definition?.name, version: definition?.version },
      async () => {
        const normalized = this._normalizeDefinition(definition, options);
        const key = normalizedCommandReference(normalized);

        const localExisting = this.localDefinitions.get(key);
        if (localExisting) {
          this._assertDefinitionImmutable(localExisting, normalized);
          return this._sanitizeForReturn(localExisting);
        }

        const getter = this._requireRepository('get');
        let durableExisting = null;

        if (getter) {
          try {
            durableExisting = await getter({
              provider: PROVIDER,
              tenantId: undefined,
              namespace: normalized.namespace,
              name: normalized.name,
              version: normalized.version,
            });
          } catch (error) {
            this._log('error', 'Command registry registration lookup failed.', error, {
              namespace: normalized.namespace,
              name: normalized.name,
              version: normalized.version,
            });
            throw new CommandRegistryError(
              COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
              'Unable to determine whether the command version already exists.',
              {},
              { httpStatus: 503, retryable: true, cause: error },
            );
          }
        }

        if (durableExisting) {
          this._assertDefinitionImmutable(durableExisting, normalized);
          this.localDefinitions.set(key, clone(durableExisting));
          return this._sanitizeForReturn(durableExisting);
        }

        const saver = this._requireRepository('save', { mutation: true });
        if (!saver) {
          throw new CommandRegistryError(
            COMMAND_REGISTRY_ERROR_CODES.PERSISTENCE_REQUIRED,
            'A durable repository is required to register command definitions.',
            {},
            { httpStatus: 503, retryable: true },
          );
        }

        const saved = await saver(clone(normalized));
        const finalRecord = clone(saved ?? normalized);

        // A durable repository is authoritative; reject a repository that
        // silently changes the immutable contract during registration.
        this._assertDefinitionImmutable(normalized, finalRecord);

        this.localDefinitions.set(key, clone(finalRecord));

        await this._auditEvent({
          eventType: 'COMMAND_REGISTERED',
          commandRef: key,
          commandId: digest(finalRecord.commandId),
          semanticFingerprint: finalRecord.semanticFingerprint,
          status: finalRecord.status,
          tenantScope: finalRecord.scope,
        });

        await this._emitEvent({
          eventType: 'command.registry.registered',
          commandRef: key,
          commandId: digest(finalRecord.commandId),
          semanticFingerprint: finalRecord.semanticFingerprint,
          status: finalRecord.status,
        });

        this._metric('command_registry_registered_total', {
          status: finalRecord.status,
          riskLevel: finalRecord.riskLevel,
        });

        return this._sanitizeForReturn(finalRecord);
      },
    );
  }

  async register(definition = {}, options = {}) {
    return this.registerCommand(definition, options);
  }

  async registerVersion(definition = {}, options = {}) {
    return this.registerCommand(definition, options);
  }

  async getCommand({
    tenantId,
    namespace,
    name,
    version,
    provider,
    allowInactive = false,
    requireTenant = this.config.tenantRequired,
  } = {}) {
    this._assertOpen();

    const scopedTenant = this._tenantId(tenantId, requireTenant);
    this._provider(provider);

    const scopedNamespace = requireString(namespace, 'namespace', this.config.maxNamespaceLength);
    const scopedName = requireString(name, 'name', this.config.maxCommandNameLength);

    if (version !== undefined && version !== null) {
      const parsedVersion = parseSemver(version, 'command version').raw;
      const exact = await this._findExact(
        scopedNamespace,
        scopedName,
        parsedVersion,
        scopedTenant,
        { allowInactive },
      );
      return exact ? this._sanitizeForReturn(exact) : null;
    }

    const candidates = await this._findCandidates(
      scopedNamespace,
      scopedName,
      scopedTenant,
      { allowInactive },
    );

    if (!candidates.length) return null;

    candidates.sort((a, b) => compareSemver(b.version, a.version));
    const selected = candidates[0];
    return selected ? this._sanitizeForReturn(selected) : null;
  }

  async resolveCommand({
    tenantId,
    command,
    namespace,
    name,
    version,
    provider,
    capabilities = [],
    action,
    input,
    requireExecutable = true,
    allowInactive = false,
  } = {}) {
    this._assertOpen();

    const scopedTenant = this._tenantId(tenantId, this.config.tenantRequired);
    this._provider(provider);

    let requestedNamespace = normalizeString(namespace, this.config.maxNamespaceLength);
    let requestedName = normalizeString(name, this.config.maxCommandNameLength);
    let requestedVersion = normalizeString(version, this.config.maxCommandVersionLength);

    if (command) {
      const reference = normalizeString(command, 420);
      const match = reference?.match(/^([^:]+):([^@]+)@(.+)$/);
      if (!match) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.COMMAND_REQUIRED,
          'command must use namespace:name@version format.',
        );
      }
      requestedNamespace ??= match[1];
      requestedName ??= match[2];
      requestedVersion ??= match[3];
    }

    const definition = await this.getCommand({
      tenantId: scopedTenant,
      namespace: requestedNamespace,
      name: requestedName,
      version: requestedVersion,
      provider: PROVIDER,
      allowInactive,
    });

    if (!definition) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        `Command ${requestedNamespace ?? ''}:${requestedName ?? ''}${requestedVersion ? `@${requestedVersion}` : ''} is not available for this tenant.`,
        {},
        { httpStatus: 404 },
      );
    }

    const requestedCapabilities = normalizeStringList(
      capabilities,
      this.config.maxCapabilityCount,
      this.config.maxCapabilityLength,
    );
    this._rejectForbiddenCapabilities(requestedCapabilities);

    const missingCapabilities = definition.requiredCapabilities
      .filter((requiredCapability) => !requestedCapabilities.includes(requiredCapability));

    if (missingCapabilities.length) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.CAPABILITY_REQUIRED,
        'Command resolution is missing one or more required capabilities.',
        { missingCapabilities },
        { httpStatus: 403 },
      );
    }

    const normalizedAction = action
      ? requireString(action, 'action', this.config.maxActionLength)
      : null;

    if (normalizedAction && definition.actions.length && !definition.actions.includes(normalizedAction)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.ACTION_NOT_ALLOWED,
        `Action ${normalizedAction} is not allowed by the registered command contract.`,
        { allowedActions: definition.actions },
        { httpStatus: 403 },
      );
    }

    if (normalizedAction && containsForbiddenCapability(normalizedAction)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.FORBIDDEN_CAPABILITY,
        `Requested action ${normalizedAction} is forbidden at the command registry boundary.`,
        {},
        { httpStatus: 409 },
      );
    }

    if (requireExecutable) {
      if (definition.status !== COMMAND_STATUS.ACTIVE) {
        const code = definition.status === COMMAND_STATUS.DEPRECATED
          ? COMMAND_REGISTRY_ERROR_CODES.COMMAND_DEPRECATED
          : definition.status === COMMAND_STATUS.RETIRED
            ? COMMAND_REGISTRY_ERROR_CODES.COMMAND_RETIRED
            : definition.status === COMMAND_STATUS.DISABLED
              ? COMMAND_REGISTRY_ERROR_CODES.COMMAND_DISABLED
              : COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_EXECUTABLE;
        throw new CommandRegistryError(
          code,
          `Command ${normalizedCommandReference(definition)} is ${definition.status}.`,
          { status: definition.status },
          { httpStatus: 409 },
        );
      }

      if (!definition.readOnly && definition.governanceMode === GOVERNANCE_MODE.NOT_REQUIRED) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.GOVERNANCE_REQUIRED,
          'Non-read-only commands must declare governance.',
          {},
          { httpStatus: 409 },
        );
      }
    }

    let inputValidation = null;
    if (input !== undefined) {
      inputValidation = await this.validateInput({
        tenantId: scopedTenant,
        namespace: definition.namespace,
        name: definition.name,
        version: definition.version,
        input,
      });

      if (!inputValidation.valid) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.INPUT_INVALID,
          'Command input does not satisfy the registered input schema.',
          { errors: inputValidation.errors },
          { httpStatus: 422 },
        );
      }
    }

    const resolution = {
      schemaVersion: SCHEMA_VERSION,
      provider: PROVIDER,
      tenantId: digest(scopedTenant),
      commandId: digest(definition.commandId),
      commandRef: normalizedCommandReference(definition),
      namespace: definition.namespace,
      name: definition.name,
      version: definition.version,
      status: definition.status,
      riskLevel: definition.riskLevel,
      executionMode: definition.executionMode,
      governanceMode: definition.governanceMode,
      approvalMode: definition.approvalMode,
      requiresGovernance: definition.governanceMode !== GOVERNANCE_MODE.NOT_REQUIRED,
      governanceFailClosed: definition.governanceMode === GOVERNANCE_MODE.FAIL_CLOSED,
      requiresApproval: definition.approvalMode !== APPROVAL_MODE.NOT_REQUIRED,
      requiresMakerChecker: definition.approvalMode === APPROVAL_MODE.MAKER_CHECKER_REQUIRED,
      capabilities: definition.capabilities,
      requiredCapabilities: definition.requiredCapabilities,
      actions: definition.actions,
      dependencies: definition.dependencies,
      semanticFingerprint: definition.semanticFingerprint,
      inputSchema: redactForPersistence(definition.inputSchema),
      outputSchema: redactForPersistence(definition.outputSchema),
      timeoutMs: definition.timeoutMs,
      concurrencyLimit: definition.concurrencyLimit,
      maxInputBytes: definition.maxInputBytes,
      maxOutputBytes: definition.maxOutputBytes,
      readOnly: definition.readOnly,
      sideEffectFree: definition.sideEffectFree,
      idempotent: definition.idempotent,
      retryable: definition.retryable,
      offlineSafe: definition.offlineSafe,
      tenantScoped: definition.tenantScoped,
      providerScoped: true,
      action: normalizedAction,
      safety: definition.safetyProfile,
      financialSafety: {
        executionAuthority: false,
        paymentPostingAuthority: false,
        settlementAuthority: false,
        ledgerMutationAuthority: false,
        balanceMutationAuthority: false,
      },
      governanceSatisfied: false,
      approvalSatisfied: false,
      inputValidated: Boolean(inputValidation?.valid),
    };

    resolution.resolutionFingerprint = buildCommandFingerprint({
      tenantId: resolution.tenantId,
      commandRef: resolution.commandRef,
      semanticFingerprint: resolution.semanticFingerprint,
      capabilities: resolution.capabilities,
      requiredCapabilities: resolution.requiredCapabilities,
      action: resolution.action,
      inputFingerprint: input === undefined ? null : buildCommandFingerprint(input),
    });

    this._metric('command_registry_resolutions_total', {
      riskLevel: definition.riskLevel,
      executionMode: definition.executionMode,
    });

    return this._sanitizeForReturn(resolution);
  }

  async validateInput({
    tenantId,
    namespace,
    name,
    version,
    input,
  } = {}) {
    this._assertOpen();

    const definition = await this.getCommand({
      tenantId,
      namespace,
      name,
      version,
    });

    if (!definition) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        'Command was not found.',
        {},
        { httpStatus: 404 },
      );
    }

    const bytes = jsonBytes(input);
    if (bytes > definition.maxInputBytes) {
      return this._sanitizeForReturn({
        valid: false,
        errors: [{
          code: COMMAND_REGISTRY_ERROR_CODES.PAYLOAD_TOO_LARGE,
          bytes,
          maxInputBytes: definition.maxInputBytes,
        }],
        schemaFingerprint: buildCommandFingerprint(definition.inputSchema),
      });
    }

    const errors = validateDataAgainstSchema(
      input,
      definition.inputSchema,
      '$',
      [],
      this.config.maxValidationErrors,
    );

    return this._sanitizeForReturn({
      valid: errors.length === 0,
      errors,
      schemaFingerprint: buildCommandFingerprint(definition.inputSchema),
    });
  }

  async validateOutput({
    tenantId,
    namespace,
    name,
    version,
    output,
  } = {}) {
    this._assertOpen();

    const definition = await this.getCommand({
      tenantId,
      namespace,
      name,
      version,
    });

    if (!definition) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        'Command was not found.',
        {},
        { httpStatus: 404 },
      );
    }

    const bytes = jsonBytes(output);
    if (bytes > definition.maxOutputBytes) {
      return this._sanitizeForReturn({
        valid: false,
        errors: [{
          code: COMMAND_REGISTRY_ERROR_CODES.OUTPUT_TOO_LARGE,
          bytes,
          maxOutputBytes: definition.maxOutputBytes,
        }],
        schemaFingerprint: definition.outputSchema
          ? buildCommandFingerprint(definition.outputSchema)
          : null,
      });
    }

    if (!definition.outputSchema) {
      return this._sanitizeForReturn({
        valid: true,
        errors: [],
        schemaFingerprint: null,
        schemaDeclared: false,
      });
    }

    const errors = validateDataAgainstSchema(
      output,
      definition.outputSchema,
      '$',
      [],
      this.config.maxValidationErrors,
    );

    return this._sanitizeForReturn({
      valid: errors.length === 0,
      errors,
      schemaFingerprint: buildCommandFingerprint(definition.outputSchema),
      schemaDeclared: true,
    });
  }

  async listCommands({
    tenantId,
    namespace,
    name,
    status,
    tags,
    capability,
    action,
    limit = this.config.defaultQueryLimit,
    offset = 0,
    includeInactive = true,
  } = {}) {
    this._assertOpen();

    const scopedTenant = this._tenantId(tenantId, this.config.tenantRequired);
    const boundedLimit = boundedInteger(limit, this.config.defaultQueryLimit, {
      min: 1,
      max: this.config.maxQueryLimit,
    });
    const boundedOffset = boundedInteger(offset, 0, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });

    const normalizedNamespace = namespace
      ? normalizeString(namespace, this.config.maxNamespaceLength)
      : undefined;
    const normalizedName = name
      ? normalizeString(name, this.config.maxCommandNameLength)
      : undefined;
    const normalizedStatus = status
      ? normalizeEnum(status, STATUS_VALUES, undefined, 'status')
      : undefined;
    const normalizedTags = normalizeStringList(tags, this.config.maxTagCount, this.config.maxTagLength);
    const normalizedCapability = capability
      ? normalizeString(capability, this.config.maxCapabilityLength)
      : undefined;
    const normalizedAction = action
      ? normalizeString(action, this.config.maxActionLength)
      : undefined;

    const lister = this._requireRepository('list');
    if (lister) {
      try {
        const result = await lister({
          tenantId: scopedTenant,
          provider: PROVIDER,
          namespace: normalizedNamespace,
          name: normalizedName,
          status: normalizedStatus,
          tags: normalizedTags,
          capability: normalizedCapability,
          action: normalizedAction,
          limit: boundedLimit,
          offset: boundedOffset,
          includeInactive,
        });

        const entries = Array.isArray(result?.entries)
          ? result.entries.filter((item) => this._visibleToTenant(item, scopedTenant))
          : Array.isArray(result)
            ? result.filter((item) => this._visibleToTenant(item, scopedTenant))
            : [];

        for (const item of entries) {
          if (item?.namespace && item?.name && item?.version) {
            this.localDefinitions.set(commandIdentity(item.namespace, item.name, item.version), clone(item));
          }
        }

        return this._sanitizeForReturn({
          entries,
          total: Number(result?.total ?? entries.length),
          limit: boundedLimit,
          offset: boundedOffset,
          hasMore: Boolean(result?.hasMore),
        });
      } catch (error) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
          'Unable to list command definitions.',
          {},
          { httpStatus: 503, retryable: true, cause: error },
        );
      }
    }

    let filtered = [...this.localDefinitions.values()]
      .filter((item) => this._visibleToTenant(item, scopedTenant))
      .filter((item) => !normalizedNamespace || item.namespace === normalizedNamespace)
      .filter((item) => !normalizedName || item.name === normalizedName)
      .filter((item) => !normalizedStatus || item.status === normalizedStatus)
      .filter((item) => !normalizedCapability || item.capabilities.includes(normalizedCapability))
      .filter((item) => !normalizedAction || item.actions.includes(normalizedAction));

    if (normalizedTags.length) {
      filtered = filtered.filter((item) => normalizedTags.every((tag) => item.tags.includes(tag)));
    }
    if (!includeInactive) filtered = filtered.filter((item) => item.status === COMMAND_STATUS.ACTIVE);

    filtered.sort((a, b) =>
      a.namespace.localeCompare(b.namespace)
      || a.name.localeCompare(b.name)
      || compareSemver(a.version, b.version));

    const entries = filtered.slice(boundedOffset, boundedOffset + boundedLimit);

    return this._sanitizeForReturn({
      entries,
      total: filtered.length,
      limit: boundedLimit,
      offset: boundedOffset,
      hasMore: boundedOffset + entries.length < filtered.length,
    });
  }

  async listVersions({ tenantId, namespace, name } = {}) {
    const result = await this.listCommands({
      tenantId,
      namespace,
      name,
      limit: this.config.maxQueryLimit,
      offset: 0,
      includeInactive: true,
    });

    return this._sanitizeForReturn({
      namespace: normalizeString(namespace, this.config.maxNamespaceLength),
      name: normalizeString(name, this.config.maxCommandNameLength),
      versions: result.entries.map((item) => ({
        version: item.version,
        status: item.status,
        riskLevel: item.riskLevel,
        governanceMode: item.governanceMode,
        approvalMode: item.approvalMode,
        semanticFingerprint: item.semanticFingerprint,
        recordVersion: item.recordVersion,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  }

  async capabilityCheck({
    tenantId,
    namespace,
    name,
    version,
    capabilities = [],
  } = {}) {
    const definition = await this.getCommand({
      tenantId,
      namespace,
      name,
      version,
    });

    if (!definition) {
      return this._sanitizeForReturn({
        allowed: false,
        reason: COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
      });
    }

    const requested = normalizeStringList(
      capabilities,
      this.config.maxCapabilityCount,
      this.config.maxCapabilityLength,
    );

    const forbidden = requested.filter((capability) => containsForbiddenCapability(capability));
    if (forbidden.length) {
      return this._sanitizeForReturn({
        allowed: false,
        reason: COMMAND_REGISTRY_ERROR_CODES.FORBIDDEN_CAPABILITY,
        forbidden,
      });
    }

    const missing = definition.requiredCapabilities.filter((requiredCapability) => !requested.includes(requiredCapability));

    return this._sanitizeForReturn({
      allowed: missing.length === 0,
      missing,
      requested,
      required: definition.requiredCapabilities,
      commandCapabilities: definition.capabilities,
    });
  }

  async getCommandContract({ tenantId, namespace, name, version } = {}) {
    const command = await this.getCommand({ tenantId, namespace, name, version });
    if (!command) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        'Command contract was not found.',
        {},
        { httpStatus: 404 },
      );
    }

    return this._sanitizeForReturn({
      provider: PROVIDER,
      commandId: digest(command.commandId),
      commandRef: normalizedCommandReference(command),
      namespace: command.namespace,
      name: command.name,
      version: command.version,
      status: command.status,
      title: command.title,
      description: command.description,
      riskLevel: command.riskLevel,
      executionMode: command.executionMode,
      governanceMode: command.governanceMode,
      approvalMode: command.approvalMode,
      capabilities: command.capabilities,
      requiredCapabilities: command.requiredCapabilities,
      actions: command.actions,
      dependencies: command.dependencies,
      idempotent: command.idempotent,
      retryable: command.retryable,
      offlineSafe: command.offlineSafe,
      tenantScoped: command.tenantScoped,
      providerScoped: command.providerScoped,
      readOnly: command.readOnly,
      sideEffectFree: command.sideEffectFree,
      timeoutMs: command.timeoutMs,
      concurrencyLimit: command.concurrencyLimit,
      maxInputBytes: command.maxInputBytes,
      maxOutputBytes: command.maxOutputBytes,
      inputSchema: command.inputSchema,
      outputSchema: command.outputSchema,
      requiredEvidence: command.requiredEvidence,
      semanticFingerprint: command.semanticFingerprint,
      safetyProfile: command.safetyProfile,
    });
  }

  async activate({ namespace, name, version, expectedRecordVersion, expectedSemanticFingerprint } = {}) {
    return this._transitionLifecycle({
      namespace,
      name,
      version,
      toStatus: COMMAND_STATUS.ACTIVE,
      expectedRecordVersion,
      expectedSemanticFingerprint,
    });
  }

  async deprecate({ namespace, name, version, reason, successorVersion, effectiveAt, expectedRecordVersion, expectedSemanticFingerprint } = {}) {
    const successor = successorVersion ? parseSemver(successorVersion, 'successorVersion').raw : null;
    const command = await this._getLifecycleCommand({ namespace, name, version });

    if (!command) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        'Command was not found.',
        {},
        { httpStatus: 404 },
      );
    }

    return this._transitionLifecycle({
      command,
      namespace,
      name,
      version,
      toStatus: COMMAND_STATUS.DEPRECATED,
      patch: {
        deprecation: {
          ...(command.deprecation ?? {}),
          reason: normalizeString(reason, this.config.maxReasonLength) ?? 'DEPRECATED',
          successorVersion: successor,
          effectiveAt: toIso(effectiveAt, safeNow(this.clock).toISOString()),
        },
      },
      expectedRecordVersion,
      expectedSemanticFingerprint,
    });
  }

  async retire({ namespace, name, version, reason, expectedRecordVersion, expectedSemanticFingerprint } = {}) {
    const command = await this._getLifecycleCommand({ namespace, name, version });

    if (!command) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        'Command was not found.',
        {},
        { httpStatus: 404 },
      );
    }

    return this._transitionLifecycle({
      command,
      namespace,
      name,
      version,
      toStatus: COMMAND_STATUS.RETIRED,
      patch: {
        deprecation: {
          ...(command.deprecation ?? {}),
          reason: normalizeString(reason, this.config.maxReasonLength) ?? 'RETIRED',
          retiredAt: safeNow(this.clock).toISOString(),
        },
      },
      expectedRecordVersion,
      expectedSemanticFingerprint,
    });
  }

  async disable({ namespace, name, version, reason, expectedRecordVersion, expectedSemanticFingerprint } = {}) {
    const command = await this._getLifecycleCommand({ namespace, name, version });

    if (!command) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        'Command was not found.',
        {},
        { httpStatus: 404 },
      );
    }

    return this._transitionLifecycle({
      command,
      namespace,
      name,
      version,
      toStatus: COMMAND_STATUS.DISABLED,
      patch: {
        deprecation: {
          ...(command.deprecation ?? {}),
          reason: normalizeString(reason, this.config.maxReasonLength) ?? 'DISABLED',
          disabledAt: safeNow(this.clock).toISOString(),
        },
      },
      expectedRecordVersion,
      expectedSemanticFingerprint,
    });
  }

  async _getLifecycleCommand({ namespace, name, version } = {}) {
    this._assertOpen();

    const scopedNamespace = requireString(
      namespace,
      'namespace',
      this.config.maxNamespaceLength,
    );
    const scopedName = requireString(
      name,
      'name',
      this.config.maxCommandNameLength,
    );
    const scopedVersion = parseSemver(
      version,
      'command version',
    ).raw;

    this._provider(PROVIDER);

    const key = commandIdentity(scopedNamespace, scopedName, scopedVersion);
    const local = this.localDefinitions.get(key);
    if (local) return clone(local);

    const getter = this._requireRepository('get');
    if (!getter) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.PERSISTENCE_REQUIRED,
        'A command repository is required for administrative lifecycle lookup.',
        {},
        { httpStatus: 503, retryable: true },
      );
    }

    try {
      const result = await getter({
        provider: PROVIDER,
        tenantId: undefined,
        namespace: scopedNamespace,
        name: scopedName,
        version: scopedVersion,
        includeInactive: true,
        administrative: true,
      });

      if (!result) return null;

      if (upper(result.provider ?? PROVIDER, 40) !== PROVIDER) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
          'Command lifecycle record is outside the Airtel provider scope.',
          {},
          { httpStatus: 409 },
        );
      }

      const normalized = clone(result);
      this.localDefinitions.set(key, normalized);
      return normalized;
    } catch (error) {
      if (error instanceof CommandRegistryError) throw error;
      this._log('error', 'Command registry lifecycle lookup failed.', error, {
        namespace: scopedNamespace,
        name: scopedName,
        version: scopedVersion,
      });
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'Unable to resolve command lifecycle state.',
        { command: key },
        { httpStatus: 503, retryable: true, cause: error },
      );
    }
  }

  async _listLifecycleFamily(namespace, name) {
    const scopedNamespace = requireString(
      namespace,
      'namespace',
      this.config.maxNamespaceLength,
    );
    const scopedName = requireString(
      name,
      'name',
      this.config.maxCommandNameLength,
    );

    const local = [...this.localDefinitions.values()].filter(
      (item) =>
        item?.provider === PROVIDER
        && item.namespace === scopedNamespace
        && item.name === scopedName,
    );

    const lister = this._requireRepository('list');
    if (!lister) return local.map(clone);

    try {
      const result = await lister({
        provider: PROVIDER,
        tenantId: undefined,
        namespace: scopedNamespace,
        name: scopedName,
        limit: this.config.maxQueryLimit,
        offset: 0,
        includeInactive: true,
        administrative: true,
      });

      const entries = Array.isArray(result?.entries)
        ? result.entries
        : Array.isArray(result)
          ? result
          : [];

      const merged = new Map();
      for (const item of [...local, ...entries]) {
        if (!item?.namespace || !item?.name || !item?.version) continue;
        if (upper(item.provider ?? PROVIDER, 40) !== PROVIDER) continue;
        const key = commandIdentity(item.namespace, item.name, item.version);
        merged.set(key, clone(item));
      }

      return [...merged.values()];
    } catch (error) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'Unable to inspect command family lifecycle state.',
        { namespace: scopedNamespace, name: scopedName },
        { httpStatus: 503, retryable: true, cause: error },
      );
    }
  }

  async _transitionLifecycle({
    command: suppliedCommand,
    namespace,
    name,
    version,
    toStatus,
    patch = {},
    expectedRecordVersion,
    expectedSemanticFingerprint,
  } = {}) {
    this._assertOpen();

    const command = suppliedCommand
      ? clone(suppliedCommand)
      : await this._getLifecycleCommand({ namespace, name, version });

    if (!command) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_NOT_FOUND,
        `Command ${namespace}:${name}${version ? `@${version}` : ''} was not found.`,
        {},
        { httpStatus: 404 },
      );
    }

    if (!STATUS_VALUES.includes(toStatus)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.INVALID_INPUT,
        `Unsupported lifecycle target ${toStatus}.`,
      );
    }

    if (command.status === toStatus) return this._sanitizeForReturn(command);

    if (!lifecycleTransitionAllowed(command.status, toStatus)) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.INVALID_LIFECYCLE_TRANSITION,
        `Cannot transition ${normalizedCommandReference(command)} from ${command.status} to ${toStatus}.`,
        { from: command.status, to: toStatus },
        { httpStatus: 409 },
      );
    }

    if (
      expectedSemanticFingerprint
      && expectedSemanticFingerprint !== command.semanticFingerprint
    ) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_IMMUTABLE,
        'The lifecycle request references a different immutable command contract.',
        {},
        { httpStatus: 409 },
      );
    }

    const currentVersion = Number(command.recordVersion ?? 1);
    const expectedVersion = expectedRecordVersion === undefined
      ? currentVersion
      : Number(expectedRecordVersion);

    if (!Number.isFinite(expectedVersion) || expectedVersion !== currentVersion) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.CONCURRENCY_CONFLICT,
        'Command lifecycle transition has an outdated record version.',
        {
          command: normalizedCommandReference(command),
          expectedRecordVersion: expectedVersion,
          actualRecordVersion: currentVersion,
        },
        { httpStatus: 409, retryable: true },
      );
    }

    if (
      toStatus === COMMAND_STATUS.ACTIVE
      && !this.config.allowMultipleActiveVersions
    ) {
      const family = await this._listLifecycleFamily(command.namespace, command.name);
      const conflicting = family.find(
        (item) =>
          item.version !== command.version
          && item.status === COMMAND_STATUS.ACTIVE,
      );

      if (conflicting) {
        throw new CommandRegistryError(
          COMMAND_REGISTRY_ERROR_CODES.COMMAND_VERSION_CONFLICT,
          `Command family ${command.namespace}:${command.name} already has active version ${conflicting.version}.`,
          {
            activeVersion: conflicting.version,
            requestedVersion: command.version,
          },
          { httpStatus: 409 },
        );
      }
    }

    const updatedAt = safeNow(this.clock).toISOString();
    const transitionPatch = {
      ...clone(patch),
      updatedAt,
      semanticFingerprint: command.semanticFingerprint,
    };

    const transitionMethod = this.repository?.transitionStatus ?? this.repository?.atomicTransition ?? null;
    const updateMethod = this.repository?.updateStatus ?? null;

    if (this.config.requireAtomicLifecycleTransition && typeof transitionMethod !== 'function') {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'Production lifecycle mutation requires an atomic transitionStatus()/atomicTransition() repository method.',
        { command: normalizedCommandReference(command) },
        { httpStatus: 503, retryable: true },
      );
    }

    if (!transitionMethod && typeof updateMethod !== 'function') {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.PERSISTENCE_REQUIRED,
        'Command registry repository does not implement a lifecycle transition method.',
        {},
        { httpStatus: 503, retryable: true },
      );
    }

    const executeTransition = transitionMethod ?? updateMethod;
    let saved;

    try {
      saved = await executeTransition.call(this.repository, {
        provider: PROVIDER,
        namespace: command.namespace,
        name: command.name,
        version: command.version,
        toStatus,
        status: toStatus,
        patch: transitionPatch,
        expectedRecordVersion: currentVersion,
        expectedSemanticFingerprint: command.semanticFingerprint,
      });
    } catch (error) {
      if (error instanceof CommandRegistryError) throw error;
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
        'Command lifecycle transition could not be persisted.',
        { command: normalizedCommandReference(command) },
        { httpStatus: 503, retryable: true, cause: error },
      );
    }

    if (!saved) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.CONCURRENCY_CONFLICT,
        'Command lifecycle transition was not committed.',
        { command: normalizedCommandReference(command) },
        { httpStatus: 409, retryable: true },
      );
    }

    if (saved.semanticFingerprint !== command.semanticFingerprint) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.COMMAND_IMMUTABLE,
        'Repository returned a lifecycle record with a changed semantic fingerprint.',
        { command: normalizedCommandReference(command) },
        { httpStatus: 409 },
      );
    }

    const finalRecord = {
      ...clone(command),
      ...clone(saved),
      ...transitionPatch,
      status: toStatus,
      semanticFingerprint: command.semanticFingerprint,
      recordVersion: Number(saved.recordVersion ?? currentVersion + 1),
    };
    finalRecord.recordFingerprint = buildRecordFingerprint(finalRecord);

    const key = normalizedCommandReference(finalRecord);
    this.localDefinitions.set(key, clone(finalRecord));

    await this._auditEvent({
      eventType: 'COMMAND_LIFECYCLE_TRANSITIONED',
      commandRef: key,
      commandId: digest(finalRecord.commandId),
      fromStatus: command.status,
      toStatus,
      recordVersion: finalRecord.recordVersion,
      semanticFingerprint: finalRecord.semanticFingerprint,
    });

    await this._emitEvent({
      eventType: 'command.registry.lifecycleTransitioned',
      commandRef: key,
      fromStatus: command.status,
      toStatus,
      recordVersion: finalRecord.recordVersion,
      semanticFingerprint: finalRecord.semanticFingerprint,
    });

    this._metric('command_registry_lifecycle_transition_total', {
      from: command.status,
      to: toStatus,
    });

    return this._sanitizeForReturn(finalRecord);
  }

  async activateVersion(input = {}) {
    return this.activate(input);
  }

  async deprecateVersion(input = {}) {
    return this.deprecate(input);
  }

  async retireVersion(input = {}) {
    return this.retire(input);
  }

  async disableVersion(input = {}) {
    return this.disable(input);
  }

  async getLatestActive({ tenantId, namespace, name } = {}) {
    return this.getCommand({
      tenantId,
      namespace,
      name,
      version: undefined,
      allowInactive: false,
    });
  }

  async isRegistered({ tenantId, namespace, name, version } = {}) {
    const result = await this.getCommand({
      tenantId,
      namespace,
      name,
      version,
      allowInactive: true,
    });
    return Boolean(result);
  }

  async export({
    tenantId,
    namespace,
    name,
    status,
    includeInactive = true,
    limit = this.config.maxQueryLimit,
  } = {}) {
    const result = await this.listCommands({
      tenantId,
      namespace,
      name,
      status,
      includeInactive,
      limit: boundedInteger(limit, this.config.maxQueryLimit, { min: 1, max: this.config.maxQueryLimit }),
      offset: 0,
    });

    const document = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: safeNow(this.clock).toISOString(),
      provider: PROVIDER,
      component: COMPONENT,
      entries: result.entries,
      total: result.total,
    };

    if (jsonBytes(document) > this.config.maxExportBytes) {
      throw new CommandRegistryError(
        COMMAND_REGISTRY_ERROR_CODES.EXPORT_TOO_LARGE,
        'Command registry export exceeds the configured maximum size.',
        { maxExportBytes: this.config.maxExportBytes },
      );
    }

    return this._sanitizeForReturn(document);
  }

  async health() {
    this._assertOpen();

    let repositoryHealth = {
      configured: Boolean(this.repository),
      ok: Boolean(this.repository),
      durable: Boolean(this.repository),
      state: this.repository ? 'CONFIGURED' : 'NOT_CONFIGURED',
    };

    if (this.repository) {
      try {
        const checker = this.repository.healthCheck ?? this.repository.health;
        if (typeof checker === 'function') {
          repositoryHealth = {
            ...repositoryHealth,
            ...(await checker.call(this.repository)),
          };
        }
      } catch (error) {
        repositoryHealth = {
          ...repositoryHealth,
          ok: false,
          state: 'UNAVAILABLE',
          error: redactForPersistence({
            name: error.name,
            code: error.code,
            message: error.message,
          }),
        };
      }
    }

    const durabilityMismatch =
      this.config.requireDurableRepositoryForMutation
      && repositoryHealth.durable === false;

    const state = !repositoryHealth.ok
      ? (repositoryHealth.configured ? 'DEGRADED' : 'UNAVAILABLE')
      : durabilityMismatch
        ? 'DEGRADED'
        : 'HEALTHY';

    return this._sanitizeForReturn({
      component: COMPONENT,
      provider: PROVIDER,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      state,
      healthy: state === 'HEALTHY',
      degraded: state === 'DEGRADED',
      unavailable: state === 'UNAVAILABLE',
      localDefinitions: this.localDefinitions.size,
      repository: repositoryHealth,
      auditConfigured: Boolean(this.audit),
      eventBusConfigured: Boolean(this.eventBus),
      metricsConfigured: Boolean(this.metrics),
      tracingConfigured: Boolean(this.tracer),
      safety: {
        commandExecutionPerformed: false,
        providerCallPerformed: false,
        financialMutationPerformed: false,
        ledgerMutationPerformed: false,
        balanceMutationPerformed: false,
        approvalGranted: false,
        arbitraryCodeExecutionPerformed: false,
      },
    });
  }

  async readiness() {
    this._assertOpen();

    const health = await this.health();
    const ready = Boolean(this.repository)
      && Boolean(health.repository?.ok)
      && (!this.config.requireDurableRepositoryForMutation || health.repository?.durable !== false);

    return this._sanitizeForReturn({
      ...health,
      ready,
      reason: ready
        ? 'Command registry durable persistence boundary is available.'
        : 'Command registry durable persistence boundary is not available or is not durable enough for production mutation.',
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.repository?.close?.();
    } catch (error) {
      this._log('warn', 'Command registry repository close failed.', error);
    }

    this.localDefinitions.clear();
  }

  getComponentInfo() {
    return Object.freeze({
      component: COMPONENT,
      engine: ENGINE_NAME,
      provider: PROVIDER,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      declarativeRegistry: true,
      immutableCommandVersions: true,
      semanticFingerprintExcludesLifecycleState: true,
      optimisticConcurrency: true,
      durableRepositoryBoundary: true,
      tenantScope: true,
      providerScope: true,
      capabilityAllowListing: true,
      capabilityDenyListing: true,
      schemaValidation: true,
      outputValidation: true,
      boundedPayloads: true,
      deterministicFingerprints: true,
      auditBoundary: true,
      eventBoundary: true,
      arbitraryCodeExecution: false,
      commandExecution: false,
      providerCalls: false,
      financialExecution: false,
      settlement: false,
      ledgerMutation: false,
      balanceMutation: false,
      approvalGrant: false,
      modelRetraining: false,
      offlineFinalSettlementAuthority: false,
      rawCredentialPersistence: false,
    });
  }
}

export function createCommandRegistry(options = {}) {
  return new CommandRegistry(options);
}

export const createAirtelCommandRegistry = createCommandRegistry;
export const AirtelCommandRegistry = CommandRegistry;

export const constants = Object.freeze({
  ENGINE_NAME,
  ENGINE_VERSION,
  COMPONENT,
  PROVIDER,
  SCHEMA_VERSION,
  HASH_ALGORITHM,
  COMMAND_STATUS,
  COMMAND_RISK_LEVEL,
  GOVERNANCE_MODE,
  APPROVAL_MODE,
  EXECUTION_MODE,
  COMMAND_CAPABILITIES,
  COMMAND_REGISTRY_ERROR_CODES,
});

export default CommandRegistry;