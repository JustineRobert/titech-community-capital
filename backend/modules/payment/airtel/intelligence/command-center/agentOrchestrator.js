/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/agentOrchestrator.js
 *
 * Architectural role
 * ------------------
 * Enterprise command-center agent orchestration boundary for Airtel payment
 * intelligence. Coordinates bounded specialist agents, evidence collection,
 * deterministic execution plans, policy/governance gates, human-review needs,
 * and audit-safe command-center outcomes.
 *
 * The orchestrator is intentionally NOT an autonomous financial actor. Agents
 * can inspect evidence, calculate intelligence, propose actions, and produce
 * recommendations. Financial execution, settlement, ledger mutation,
 * provider calls, authorization, approval state transitions, and irreversible
 * operations remain outside this module and require the appropriate dedicated
 * service boundaries.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth.
 * - NOT the canonical double-entry ledger.
 * - NOT a payment execution or settlement service.
 * - NOT an Airtel provider adapter.
 * - NOT a policy engine.
 * - NOT a governance decision engine.
 * - NOT an approval workflow or maker-checker state machine.
 * - NOT an AML/KYC/sanctions adjudication engine.
 * - NOT a model-serving, model-training, or model-retraining service.
 * - NOT an arbitrary code execution runtime.
 * - NOT a replacement for immutable audit storage.
 * - NOT allowed to promote an agent recommendation into authorization.
 * - NOT allowed to treat offline local state as final financial settlement.
 *
 * Production principles
 * ---------------------
 * - Tenant context is mandatory by default and propagated to every agent.
 * - Provider scope is fail-closed to AIRTEL.
 * - Agent registration is explicit; no dynamic module loading is performed.
 * - Agent capabilities are declarative and policy-checkable.
 * - Only registered capabilities may be requested.
 * - Tool/action requests are represented as data, not executable code.
 * - Agents receive immutable, bounded context snapshots.
 * - Parallelism, per-agent timeouts, total orchestration timeout, and output
 *   size are bounded to prevent runaway command-center work.
 * - Duplicate requests are idempotent within a tenant scope.
 * - Agent outputs are treated as untrusted intelligence until normalized.
 * - A failing, unavailable, stale, or conflicting agent does not silently
 *   become a positive recommendation.
 * - Governance and approval hooks are consultative gates. They may block the
 *   command-center plan, but this orchestrator never grants financial
 *   execution authority itself.
 * - Audit writes are append-only through an injected adapter.
 * - Sensitive identifiers, secrets, authentication material, raw provider
 *   payloads, and unnecessary PII are redacted or hashed before persistence.
 * - Results are deterministic for identical normalized inputs, excluding
 *   generated run identifiers and timestamps from semantic fingerprints.
 * - Returned orchestration records are deeply frozen to prevent accidental
 *   post-decision mutation in application memory.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-agent-orchestrator';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const RUN_STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  CONFLICT: 'CONFLICT',
  IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
});

export const AGENT_STATUS = Object.freeze({
  REGISTERED: 'REGISTERED',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  DISABLED: 'DISABLED',
  TIMED_OUT: 'TIMED_OUT',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
});

export const AGENT_OUTCOMES = Object.freeze({
  ALLOW: 'ALLOW',
  ALLOW_WITH_CONTROLS: 'ALLOW_WITH_CONTROLS',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  BLOCK: 'BLOCK',
  INFORM: 'INFORM',
  NO_ACTION: 'NO_ACTION',
  CONFLICT: 'CONFLICT',
  UNAVAILABLE: 'UNAVAILABLE',
  INDETERMINATE: 'INDETERMINATE',
});

export const ACTION_TYPES = Object.freeze({
  OBSERVE: 'OBSERVE',
  EVALUATE: 'EVALUATE',
  RECOMMEND: 'RECOMMEND',
  REQUEST_REVIEW: 'REQUEST_REVIEW',
  REQUEST_APPROVAL: 'REQUEST_APPROVAL',
  ESCALATE: 'ESCALATE',
  SIMULATE: 'SIMULATE',
});

export const EXECUTION_STATES = Object.freeze({
  NOT_REQUESTED: 'NOT_REQUESTED',
  PROPOSED: 'PROPOSED',
  REQUIRES_GOVERNANCE: 'REQUIRES_GOVERNANCE',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
  BLOCKED: 'BLOCKED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
});

export const ORCHESTRATOR_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'AGENT_ORCHESTRATOR_INVALID_INPUT',
  TENANT_REQUIRED: 'AGENT_ORCHESTRATOR_TENANT_REQUIRED',
  PROVIDER_SCOPE_VIOLATION: 'AGENT_ORCHESTRATOR_PROVIDER_SCOPE_VIOLATION',
  AGENT_REQUIRED: 'AGENT_ORCHESTRATOR_AGENT_REQUIRED',
  AGENT_NOT_FOUND: 'AGENT_ORCHESTRATOR_AGENT_NOT_FOUND',
  AGENT_DISABLED: 'AGENT_ORCHESTRATOR_AGENT_DISABLED',
  CAPABILITY_NOT_ALLOWED: 'AGENT_ORCHESTRATOR_CAPABILITY_NOT_ALLOWED',
  CAPABILITY_REQUIRED: 'AGENT_ORCHESTRATOR_CAPABILITY_REQUIRED',
  DUPLICATE_AGENT: 'AGENT_ORCHESTRATOR_DUPLICATE_AGENT',
  AGENT_PROTOCOL_ERROR: 'AGENT_ORCHESTRATOR_AGENT_PROTOCOL_ERROR',
  AGENT_OUTPUT_INVALID: 'AGENT_ORCHESTRATOR_AGENT_OUTPUT_INVALID',
  AGENT_TIMEOUT: 'AGENT_ORCHESTRATOR_AGENT_TIMEOUT',
  ORCHESTRATION_TIMEOUT: 'AGENT_ORCHESTRATOR_ORCHESTRATION_TIMEOUT',
  CONTEXT_TOO_LARGE: 'AGENT_ORCHESTRATOR_CONTEXT_TOO_LARGE',
  OUTPUT_TOO_LARGE: 'AGENT_ORCHESTRATOR_OUTPUT_TOO_LARGE',
  REPOSITORY_REQUIRED: 'AGENT_ORCHESTRATOR_REPOSITORY_REQUIRED',
  REPOSITORY_UNAVAILABLE: 'AGENT_ORCHESTRATOR_REPOSITORY_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'AGENT_ORCHESTRATOR_IDEMPOTENCY_CONFLICT',
  GOVERNANCE_BLOCKED: 'AGENT_ORCHESTRATOR_GOVERNANCE_BLOCKED',
  APPROVAL_REQUIRED: 'AGENT_ORCHESTRATOR_APPROVAL_REQUIRED',
  FINANCIAL_EXECUTION_FORBIDDEN: 'AGENT_ORCHESTRATOR_FINANCIAL_EXECUTION_FORBIDDEN',
  ACTION_NOT_ALLOWED: 'AGENT_ORCHESTRATOR_ACTION_NOT_ALLOWED',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  maxTenantIdLength: 160,
  maxRunIdLength: 180,
  maxAgentIdLength: 160,
  maxAgentNameLength: 200,
  maxCapabilityLength: 160,
  maxReasonCodeLength: 180,
  maxActionCount: 50,
  maxAgentCountPerRun: 25,
  maxContextBytes: 512 * 1024,
  maxAgentOutputBytes: 256 * 1024,
  maxRunOutputBytes: 1024 * 1024,
  defaultAgentTimeoutMs: 8_000,
  maxAgentTimeoutMs: 30_000,
  defaultOverallTimeoutMs: 30_000,
  maxOverallTimeoutMs: 120_000,
  defaultParallelism: 8,
  maxParallelism: 16,
  maxEvidenceItems: 250,
  maxFindings: 100,
  maxControls: 100,
  maxRecommendations: 100,
  maxMetadataKeys: 100,
  failClosedOnGovernanceError: true,
  failClosedOnRepositoryError: true,
  failClosedOnAuditError: false,
  requireExplicitActionAllowList: true,
  allowFinancialExecutionRequests: false,
  allowProviderCalls: false,
  allowLedgerMutation: false,
  allowApprovalGrant: false,
  allowAgentSideEffects: false,
  persistCompletedRuns: true,
  persistAgentResults: true,
});

const FINANCIAL_ACTION_PATTERNS = Object.freeze([
  /(?:^|\.)(execute|settle|disburse|transfer|refund|collect|debit|credit|withdraw|deposit|authorize|capture)(?:\.|$)/i,
  /(?:^|\.)ledger\.mutate(?:\.|$)/i,
  /(?:^|\.)balance\.mutate(?:\.|$)/i,
  /(?:^|\.)payment\.(?:execute|settle|capture)(?:\.|$)/i,
]);

const FORBIDDEN_SECRET_PATTERNS = Object.freeze([
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

const SIDE_EFFECT_CAPABILITIES = Object.freeze([
  'provider.call',
  'payment.execute',
  'payment.settle',
  'ledger.mutate',
  'approval.grant',
  'model.disable',
  'model.retrain',
  'data.delete',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
  return normalizeString(value, maxLength)?.toUpperCase();
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

function toIso(value, fallback = undefined) {
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

  if (typeof value === 'bigint') return `${value.toString()}n`;
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
  const input = typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalize(value);
  return createHash(HASH_ALGORITHM).update(input).digest('hex');
}

function digest(value) {
  return `sha256:${sha256(String(value)).slice(0, 40)}`;
}

function safeBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function redact(value, key = '', depth = 0, maxDepth = 8) {
  if (depth > maxDepth) return '[TRUNCATED]';
  if (value === undefined || value === null) return value;

  if (FORBIDDEN_SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
    return '[REDACTED]';
  }

  if (SENSITIVE_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(key))) {
    return digest(value);
  }

  if (typeof value !== 'object') {
    return typeof value === 'string' && value.length > 400
      ? `${value.slice(0, 397)}...`
      : value;
  }

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return '[BINARY_REDACTED]';

  if (Array.isArray(value)) {
    return value.slice(0, 250).map((item) => redact(item, '', depth + 1, maxDepth));
  }

  const result = Object.create(null);

  for (const entryKey of Object.keys(value).slice(0, 250)) {
    result[entryKey] = redact(value[entryKey], entryKey, depth + 1, maxDepth);
  }

  return result;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new AgentOrchestratorError(
      ORCHESTRATOR_ERROR_CODES.INVALID_INPUT,
      `${name} must be an object.`,
    );
  }
}

function assertProvider(provider) {
  const normalized = upper(provider ?? PROVIDER, 30);

  if (normalized !== PROVIDER) {
    throw new AgentOrchestratorError(
      ORCHESTRATOR_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
      `Agent orchestrator scope is ${PROVIDER}.`,
      { provider: normalized },
    );
  }

  return PROVIDER;
}

function normalizeOutcome(value) {
  const normalized = upper(value, 80);

  if (!normalized) return AGENT_OUTCOMES.INDETERMINATE;

  return Object.values(AGENT_OUTCOMES).includes(normalized)
    ? normalized
    : AGENT_OUTCOMES.INDETERMINATE;
}

function normalizeActionType(value) {
  const normalized = upper(value, 80);

  if (!normalized) return ACTION_TYPES.OBSERVE;

  return Object.values(ACTION_TYPES).includes(normalized)
    ? normalized
    : ACTION_TYPES.OBSERVE;
}

function isForbiddenCapability(capability) {
  return SIDE_EFFECT_CAPABILITIES.some((pattern) => capability === pattern)
    || FINANCIAL_ACTION_PATTERNS.some((pattern) => pattern.test(capability));
}

function normalizeCapabilities(values, maxCount, maxLength) {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .map((value) => normalizeString(value, maxLength))
      .filter(Boolean),
  )].slice(0, maxCount);
}

function normalizeReasonCodes(values, maxCount, maxLength) {
  if (typeof values === 'string') values = [values];
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .map((value) => isPlainObject(value)
        ? value.code ?? value.reasonCode ?? value.id
        : value)
      .map((value) => normalizeString(value, maxLength))
      .filter(Boolean),
  )].slice(0, maxCount);
}

function normalizeFinding(item, config) {
  if (!isPlainObject(item)) return null;

  const status = upper(item.status, 50);

  return {
    code: normalizeString(
      item.code ?? item.findingCode ?? item.ruleCode,
      config.maxReasonCodeLength,
    ) ?? 'UNSPECIFIED',

    status: status ?? 'OBSERVATION',

    severity: upper(item.severity, 30) ?? 'INFO',

    title: normalizeString(
      item.title ?? item.name,
      200,
    ) ?? null,

    reason: normalizeString(
      item.reason ?? item.explanation,
      600,
    ) ?? null,

    humanReviewRequired: Boolean(
      item.humanReviewRequired
      ?? item.requiresReview,
    ),

    evidenceRefs:
      Array.isArray(item.evidenceRefs)
        ? item.evidenceRefs
            .slice(0, config.maxEvidenceItems)
            .map((value) => digest(value))
        : [],

    metadata: redact(
      item.metadata ?? {},
    ),
  };
}

function normalizeRecommendation(item, config) {
  if (!isPlainObject(item)) {
    if (typeof item !== 'string') return null;

    return {
      action: normalizeString(
        item,
        config.maxReasonCodeLength,
      ),

      rationale: null,

      confidence: null,

      humanReviewRequired: true,
    };
  }

  const confidence = Number(item.confidence);

  return {
    action:
      normalizeString(
        item.action
          ?? item.recommendation
          ?? item.code,
        config.maxReasonCodeLength,
      ) ?? 'UNSPECIFIED',

    rationale:
      normalizeString(
        item.rationale
          ?? item.reason,
        600,
      ) ?? null,

    confidence:
      Number.isFinite(confidence)
        ? confidence
        : null,

    humanReviewRequired:
      Boolean(
        item.humanReviewRequired
          ?? item.requiresReview,
      ),

    metadata:
      redact(
        item.metadata ?? {},
      ),
  };
}

function normalizeAgentResult(
  result,
  agent,
  config,
) {
  assertPlainObject(
    result,
    'agent result',
  );

  const output = {
    outcome:
      normalizeOutcome(
        result.outcome
          ?? result.decision,
      ),

    status:
      AGENT_STATUS.COMPLETED,

    rationale:
      normalizeString(
        result.rationale
          ?? result.reason,
        1200,
      ) ?? null,

    reasonCodes:
      normalizeReasonCodes(
        result.reasonCodes
          ?? result.reasons,
        config.maxFindings,
        config.maxReasonCodeLength,
      ),

    findings:
      Array.isArray(
        result.findings,
      )
        ? result.findings
            .map(
              (item) =>
                normalizeFinding(
                  item,
                  config,
                ),
            )
            .filter(Boolean)
            .slice(
              0,
              config.maxFindings,
            )
        : [],

    controls:
      normalizeReasonCodes(
        result.controls,
        config.maxControls,
        config.maxReasonCodeLength,
      ),

    recommendations:
      Array.isArray(
        result.recommendations,
      )
        ? result.recommendations
            .map(
              (item) =>
                normalizeRecommendation(
                  item,
                  config,
                ),
            )
            .filter(Boolean)
            .slice(
              0,
              config.maxRecommendations,
            )
        : [],

    requestedActions:
      Array.isArray(
        result.requestedActions,
      )
        ? result.requestedActions
            .slice(
              0,
              config.maxActionCount,
            )
            .map(
              (item) =>
                redact(item),
            )
        : [],

    evidence:
      Array.isArray(
        result.evidence,
      )
        ? result.evidence
            .slice(
              0,
              config.maxEvidenceItems,
            )
            .map(
              (item) =>
                redact(item),
            )
        : [],

    confidence:
      Number.isFinite(
        Number(
          result.confidence,
        ),
      )
        ? Number(
            result.confidence,
          )
        : null,

    riskLevel:
      upper(
        result.riskLevel
          ?? result.risk?.level,
        40,
      ) ?? 'UNKNOWN',

    modelVersion:
      normalizeString(
        result.modelVersion
          ?? result.model?.version,
        config.maxAgentNameLength,
      ) ?? null,

    policyFingerprint:
      normalizeString(
        result.policyFingerprint,
        140,
      ) ?? null,

    governanceFingerprint:
      normalizeString(
        result.governanceFingerprint,
        140,
      ) ?? null,

    metadata:
      redact(
        result.metadata ?? {},
      ),
  };

  output.sideEffectsRequested =
    output.requestedActions.some(
      (action) => {
        const type =
          upper(
            action?.type
              ?? action?.action
              ?? action?.capability,
            120,
          );

        return type
          ? isForbiddenCapability(
              type,
            )
          : false;
      },
    );

  if (output.sideEffectsRequested) {
    output.status =
      AGENT_STATUS.BLOCKED;

    output.outcome =
      AGENT_OUTCOMES.BLOCK;

    output.reasonCodes = [
      ...new Set([
        ...output.reasonCodes,

        ORCHESTRATOR_ERROR_CODES
          .FINANCIAL_EXECUTION_FORBIDDEN,
      ]),
    ].slice(
      0,
      config.maxFindings,
    );
  }

  output.agent = {
    id: agent.id,
    name: agent.name,
    version: agent.version,
    capabilities: [
      ...agent.capabilities,
    ],
  };

  output.resultFingerprint =
    `sha256:${sha256({
      outcome:
        output.outcome,

      rationale:
        output.rationale,

      reasonCodes:
        output.reasonCodes,

      findings:
        output.findings,

      controls:
        output.controls,

      recommendations:
        output.recommendations,

      requestedActions:
        output.requestedActions,

      evidence:
        output.evidence,

      confidence:
        output.confidence,

      riskLevel:
        output.riskLevel,

      modelVersion:
        output.modelVersion,

      policyFingerprint:
        output.policyFingerprint,

      governanceFingerprint:
        output.governanceFingerprint,

      sideEffectsRequested:
        output.sideEffectsRequested,
    })}`;

  return output;
}

function makeAbortSignal(
  timeoutMs,
  parentSignal = undefined,
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs,
    );

  let cleanupParent = null;

  if (parentSignal) {
    const abortParent =
      () => controller.abort();

    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener(
        'abort',
        abortParent,
        {
          once: true,
        },
      );

      cleanupParent = () =>
        parentSignal.removeEventListener(
          'abort',
          abortParent,
        );
    }
  }

  return {
    signal:
      controller.signal,

    cleanup: () => {
      clearTimeout(timer);
      cleanupParent?.();
    },
  };
}

function withTimeout(
  promiseFactory,
  timeoutMs,
  parentSignal = undefined,
) {
  const {
    signal,
    cleanup,
  } = makeAbortSignal(
    timeoutMs,
    parentSignal,
  );

  let timeoutHandle;
  let settled = false;

  const timeoutPromise =
    new Promise((_, reject) => {
      timeoutHandle =
        setTimeout(
          () => {
            reject(
              new AgentOrchestratorError(
                ORCHESTRATOR_ERROR_CODES
                  .AGENT_TIMEOUT,

                `Agent execution exceeded ${timeoutMs}ms.`,

                {
                  timeoutMs,
                },

                {
                  retryable: true,
                  httpStatus: 504,
                },
              ),
            );
          },
          timeoutMs,
        );
    });

  return Promise.race([
    promiseFactory(signal),

    timeoutPromise,
  ]).finally(() => {
    if (!settled) {
      settled = true;
      clearTimeout(
        timeoutHandle,
      );
    }

    cleanup();
  });
}

function safeError(error) {
  if (!error) return null;

  return {
    name:
      normalizeString(
        error.name,
        120,
      ) ?? 'Error',

    code:
      normalizeString(
        error.code,
        160,
      ) ?? null,

    message:
      normalizeString(
        error.message,
        500,
      ) ?? 'Unknown error',

    retryable:
      Boolean(
        error.retryable,
      ),
  };
}

function uniqueBy(
  items,
  keyFn,
) {
  const seen = new Set();
  const result = [];

  for (
    const item
    of items
  ) {
    const key =
      keyFn(item);

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

export class AgentOrchestratorError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'AgentOrchestratorError';

    this.code =
      code;

    this.details =
      redact(
        details,
      );

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.httpStatus =
      Number.isFinite(
        options.httpStatus,
      )
        ? options.httpStatus
        : 400;

    this.cause =
      options.cause;
  }
}

/**
 * Minimal test/local repository.
 *
 * Production deployments should inject a durable repository implementing the
 * same methods with proper Mongo transactions/unique indexes and tenant-aware
 * queries.
 */
export class InMemoryAgentOrchestratorRepository {
  constructor(seed = {}) {
    this.runs =
      Array.isArray(
        seed.runs,
      )
        ? clone(
            seed.runs,
          )
        : [];

    this.agentResults =
      Array.isArray(
        seed.agentResults,
      )
        ? clone(
            seed.agentResults,
          )
        : [];
  }

  async findRunByIdempotencyKey({
    tenantId,
    idempotencyKey,
  }) {
    const found =
      this.runs.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.idempotencyKey
            === idempotencyKey,
      );

    return found
      ? clone(found)
      : null;
  }

  async saveRun(
    record,
  ) {
    this.runs.push(
      clone(record),
    );

    return clone(record);
  }

  async getRun({
    tenantId,
    runId,
  }) {
    const found =
      this.runs.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.runId
            === runId,
      );

    return found
      ? clone(found)
      : null;
  }

  async saveAgentResult(
    record,
  ) {
    this.agentResults.push(
      clone(record),
    );

    return clone(record);
  }

  async listRuns({
    tenantId,
    limit = 50,
    offset = 0,
  }) {
    const records =
      this.runs.filter(
        (item) =>
          item.tenantId
            === tenantId,
      );

    return {
      entries:
        records.slice(
          offset,
          offset + limit,
        ),

      total:
        records.length,

      hasMore:
        offset + limit
        < records.length,
    };
  }

  async listAgentResults({
    tenantId,
    runId,
    limit = 100,
    offset = 0,
  }) {
    const records =
      this.agentResults.filter(
        (item) =>
          item.tenantId
            === tenantId
          && item.runId
            === runId,
      );

    return {
      entries:
        records.slice(
          offset,
          offset + limit,
        ),

      total:
        records.length,

      hasMore:
        offset + limit
        < records.length,
    };
  }

  async healthCheck() {
    return {
      ok: true,

      component:
        'in-memory-agent-orchestrator-repository',
    };
  }

  async close() {}
}

export class AgentOrchestrator {
  constructor(options = {}) {
    assertPlainObject(
      options,
      'options',
    );

    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,

        ...(isPlainObject(
          options.config,
        )
          ? options.config
          : {}),
      });

    assertProvider(
      this.config.provider,
    );

    this.repository =
      options.repository
      ?? options.orchestratorRepository
      ?? null;

    this.governanceService =
      options.governanceService
      ?? options.decisionGovernanceService
      ?? null;

    this.policyEngine =
      options.policyEngine
      ?? options.decisionPolicyEngine
      ?? null;

    this.approvalWorkflow =
      options.approvalWorkflow
      ?? null;

    this.audit =
      options.audit
      ?? options.decisionAuditLedger
      ?? null;

    this.metrics =
      options.metrics
      ?? null;

    this.logger =
      options.logger
      ?? null;

    this.clock =
      typeof options.clock
        === 'function'
        ? options.clock
        : () => new Date();

    this.idFactory =
      typeof options.idFactory
        === 'function'
        ? options.idFactory
        : () =>
            `agent-run-${Date.now()}-${sha256(
              `${Date.now()}-${Math.random()}`,
            ).slice(0, 16)}`;

    this.agents =
      new Map();

    const initialAgents =
      Array.isArray(
        options.agents,
      )
        ? options.agents
        : [];

    for (
      const agent
      of initialAgents
    ) {
      this.registerAgent(
        agent,
      );
    }

    if (!this.repository) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .REPOSITORY_REQUIRED,

        'A durable agent-orchestrator repository must be injected in production.',
      );
    }
  }

  registerAgent(
    definition = {},
  ) {
    assertPlainObject(
      definition,
      'agent definition',
    );

    const id =
      normalizeString(
        definition.id
          ?? definition.agentId,
        this.config
          .maxAgentIdLength,
      );

    const name =
      normalizeString(
        definition.name
          ?? definition.id,
        this.config
          .maxAgentNameLength,
      );

    const version =
      normalizeString(
        definition.version
          ?? '1.0.0',
        120,
      );

    if (!id) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .AGENT_REQUIRED,

        'Agent id is required.',
      );
    }

    if (
      this.agents.has(id)
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .DUPLICATE_AGENT,

        `Agent ${id} is already registered.`,
      );
    }

    if (
      typeof definition.run
        !== 'function'
      && typeof definition.execute
        !== 'function'
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .AGENT_PROTOCOL_ERROR,

        `Agent ${id} must implement run(context) or execute(context).`,
      );
    }

    const capabilities =
      normalizeCapabilities(
        definition.capabilities,
        100,
        this.config
          .maxCapabilityLength,
      );

    if (
      this.config
        .requireExplicitActionAllowList
    ) {
      for (
        const capability
        of capabilities
      ) {
        if (
          isForbiddenCapability(
            capability,
          )
        ) {
          throw new AgentOrchestratorError(
            ORCHESTRATOR_ERROR_CODES
              .ACTION_NOT_ALLOWED,

            `Agent capability ${capability} is forbidden at the command-center boundary.`,

            {
              agentId:
                id,

              capability,
            },
          );
        }
      }
    }

    const agent = {
      id,
      name,
      version,

      description:
        normalizeString(
          definition.description,
          600,
        ) ?? null,

      capabilities,

      enabled:
        definition.enabled !== false,

      required:
        Boolean(
          definition.required,
        ),

      priority:
        toInteger(
          definition.priority,
          100,
          {
            min: 0,
            max: 10_000,
          },
        ),

      timeoutMs:
        toInteger(
          definition.timeoutMs,
          this.config
            .defaultAgentTimeoutMs,
          {
            min: 1,
            max:
              this.config
                .maxAgentTimeoutMs,
          },
        ),

      run:
        definition.run
        ?? definition.execute,

      health:
        definition.health,

      metadata:
        redact(
          definition.metadata
          ?? {},
        ),
    };

    this.agents.set(
      id,
      agent,
    );

    return deepFreeze({
      id: agent.id,
      name: agent.name,
      version: agent.version,
      description:
        agent.description,

      capabilities:
        [
          ...agent.capabilities,
        ],

      enabled:
        agent.enabled,

      required:
        agent.required,

      priority:
        agent.priority,

      timeoutMs:
        agent.timeoutMs,

      metadata:
        clone(
          agent.metadata,
        ),
    });
  }

  unregisterAgent(
    agentId,
  ) {
    const id =
      normalizeString(
        agentId,
        this.config
          .maxAgentIdLength,
      );

    if (!id) {
      return false;
    }

    return this.agents.delete(
      id,
    );
  }

  getAgent(
    agentId,
  ) {
    const id =
      normalizeString(
        agentId,
        this.config
          .maxAgentIdLength,
      );

    const agent =
      this.agents.get(id);

    if (!agent) {
      return null;
    }

    return deepFreeze({
      id: agent.id,
      name: agent.name,
      version: agent.version,
      description:
        agent.description,

      capabilities:
        [
          ...agent.capabilities,
        ],

      enabled:
        agent.enabled,

      required:
        agent.required,

      priority:
        agent.priority,

      timeoutMs:
        agent.timeoutMs,

      metadata:
        clone(
          agent.metadata,
        ),
    });
  }

  listAgents({
    includeDisabled = true,
  } = {}) {
    return deepFreeze(
      [...this.agents.values()]
        .filter(
          (agent) =>
            includeDisabled
            || agent.enabled,
        )
        .sort(
          (a, b) =>
            a.priority
              - b.priority
            || a.id.localeCompare(
              b.id,
            ),
        )
        .map(
          (agent) => ({
            id: agent.id,
            name: agent.name,
            version: agent.version,

            capabilities:
              [
                ...agent.capabilities,
              ],

            enabled:
              agent.enabled,

            required:
              agent.required,

            priority:
              agent.priority,

            timeoutMs:
              agent.timeoutMs,
          }),
        ),
    );
  }

  _tenantId(
    tenantId,
  ) {
    const normalized =
      normalizeString(
        tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      this.config.tenantRequired
      && !normalized
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .TENANT_REQUIRED,

        'tenantId is required.',
      );
    }

    return normalized;
  }

  _provider(
    provider,
  ) {
    return assertProvider(
      provider
      ?? PROVIDER,
    );
  }

  _log(
    level,
    message,
    error = null,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[level]
        ?? this.logger?.info;

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

          ...redact(
            context,
          ),

          ...(error
            ? {
                error:
                  safeError(
                    error,
                  ),
              }
            : {}),
        },

        message,
      );
    } catch {
      // Logging is non-authoritative.
    }
  }

  _metric(
    name,
    labels = {},
    value = 1,
  ) {
    try {
      if (
        typeof this.metrics?.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          labels,
          value,
        );
      } else if (
        typeof this.metrics?.inc
          === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch {
      // Metrics are non-authoritative.
    }
  }

  async _audit(
    event,
  ) {
    if (!this.audit) {
      return {
        attempted: false,
        recorded: false,
      };
    }

    const payload =
      redact({
        eventType:
          'AGENT_ORCHESTRATION',

        stage:
          'COMMAND_CENTER',

        provider:
          PROVIDER,

        ...event,
      });

    const methods = [
      'recordDecisionEvent',
      'append',
      'record',
      'write',
    ];

    for (
      const methodName
      of methods
    ) {
      if (
        typeof this.audit[
          methodName
        ]
          !== 'function'
      ) {
        continue;
      }

      try {
        await this.audit[
          methodName
        ](
          payload,
        );

        return {
          attempted: true,
          recorded: true,
          method:
            methodName,
        };
      } catch (error) {
        this._log(
          'warn',

          'Agent orchestration audit write failed.',

          error,

          {
            eventType:
              payload.eventType,
          },
        );

        if (
          this.config
            .failClosedOnAuditError
        ) {
          throw new AgentOrchestratorError(
            ORCHESTRATOR_ERROR_CODES
              .REPOSITORY_UNAVAILABLE,

            'Agent orchestration audit write failed.',

            {},

            {
              httpStatus: 503,
              retryable: true,
              cause: error,
            },
          );
        }

        return {
          attempted: true,
          recorded: false,
          method:
            methodName,
        };
      }
    }

    return {
      attempted: false,
      recorded: false,
    };
  }

  _normalizeRequestedAgents(
    input,
  ) {
    if (
      input.agents
        === undefined
      || input.agents
        === null
    ) {
      return [...this.agents.values()]
        .filter(
          (agent) =>
            agent.enabled,
        )
        .sort(
          (a, b) =>
            a.priority
              - b.priority
            || a.id.localeCompare(
              b.id,
            ),
        )
        .slice(
          0,
          this.config
            .maxAgentCountPerRun,
        );
    }

    if (
      !Array.isArray(
        input.agents,
      )
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .INVALID_INPUT,

        'agents must be an array when provided.',
      );
    }

    const requested = [];

    for (
      const item
      of input.agents.slice(
        0,
        this.config
          .maxAgentCountPerRun,
      )
    ) {
      const agentId =
        normalizeString(
          isPlainObject(item)
            ? item.id
              ?? item.agentId
            : item,

          this.config
            .maxAgentIdLength,
        );

      if (!agentId) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .AGENT_REQUIRED,

          'Every requested agent must have an id.',
        );
      }

      const agent =
        this.agents.get(
          agentId,
        );

      if (!agent) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .AGENT_NOT_FOUND,

          `Agent ${agentId} is not registered.`,

          {
            agentId,
          },
        );
      }

      if (
        !agent.enabled
      ) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .AGENT_DISABLED,

          `Agent ${agentId} is disabled.`,

          {
            agentId,
          },
        );
      }

      requested.push(
        agent,
      );
    }

    return uniqueBy(
      requested,
      (agent) =>
        agent.id,
    );
  }

  _normalizeCapabilities(
    input,
    agents,
  ) {
    const requested =
      input.capabilities
        === undefined
        ? []
        : normalizeCapabilities(
            input.capabilities,
            100,
            this.config
              .maxCapabilityLength,
          );

    if (!requested.length) {
      return [];
    }

    for (
      const capability
      of requested
    ) {
      if (
        isForbiddenCapability(
          capability,
        )
      ) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .CAPABILITY_NOT_ALLOWED,

          `Capability ${capability} is not allowed by the command-center boundary.`,

          {
            capability,
          },
        );
      }

      const supported =
        agents.some(
          (agent) =>
            agent.capabilities.includes(
              capability,
            ),
        );

      if (!supported) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .CAPABILITY_NOT_ALLOWED,

          `No requested agent supports capability ${capability}.`,

          {
            capability,
          },
        );
      }
    }

    return requested;
  }

  _buildContext(
    input,
    tenantId,
    requestedCapabilities,
  ) {
    const context = {
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenant: {
        id:
          tenantId,

        digest:
          digest(
            tenantId,
          ),
      },

      command: {
        commandType:
          normalizeString(
            input.commandType
              ?? input.command
              ?? 'INTELLIGENCE_ORCHESTRATION',
            160,
          ),

        operation:
          normalizeString(
            input.operation,
            160,
          ) ?? null,

        requestedAction:
          normalizeActionType(
            input.requestedAction,
          ),

        capabilities:
          requestedCapabilities,
      },

      decision: {
        decisionId:
          normalizeString(
            input.decisionId,
            180,
          ) ?? null,

        idempotencyKeyDigest:
          input.idempotencyKey
            ? digest(
                input.idempotencyKey,
              )
            : null,
      },

      subject:
        redact(
          input.subject
          ?? {},
        ),

      evidence:
        Array.isArray(
          input.evidence,
        )
          ? input.evidence
              .slice(
                0,
                this.config
                  .maxEvidenceItems,
              )
              .map(
                (item) =>
                  redact(item),
              )
          : [],

      context:
        redact(
          input.context
          ?? input.payload
          ?? {},
        ),

      constraints:
        redact(
          input.constraints
          ?? {},
        ),

      metadata:
        redact(
          input.metadata
          ?? {},
        ),

      safety: {
        financialExecutionAllowed:
          false,

        providerCallsAllowed:
          false,

        ledgerMutationAllowed:
          false,

        approvalGrantAllowed:
          false,

        arbitraryCodeExecutionAllowed:
          false,

        rawProviderPayloadAccess:
          false,
      },
    };

    const bytes =
      safeBytes(
        context,
      );

    if (
      bytes
      > this.config.maxContextBytes
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .CONTEXT_TOO_LARGE,

        `Agent context exceeds ${this.config.maxContextBytes} bytes.`,

        {
          bytes,

          maxContextBytes:
            this.config
              .maxContextBytes,
        },
      );
    }

    return context;
  }

  async _checkIdempotency({
    tenantId,
    idempotencyKey,
    semanticFingerprint,
  }) {
    if (
      !idempotencyKey
      || typeof this.repository
        .findRunByIdempotencyKey
        !== 'function'
    ) {
      return null;
    }

    let existing;

    try {
      existing =
        await this.repository
          .findRunByIdempotencyKey({
            tenantId,

            idempotencyKey,

            provider:
              PROVIDER,
          });
    } catch (error) {
      if (
        this.config
          .failClosedOnRepositoryError
      ) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .REPOSITORY_UNAVAILABLE,

          'Unable to verify orchestration idempotency.',

          {},

          {
            httpStatus: 503,
            retryable: true,
            cause: error,
          },
        );
      }

      return null;
    }

    if (!existing) {
      return null;
    }

    if (
      existing.semanticFingerprint
        !== semanticFingerprint
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .IDEMPOTENCY_CONFLICT,

        'Idempotency key is already associated with a different orchestration request.',

        {
          runId:
            digest(
              existing.runId,
            ),
        },
      );
    }

    return {
      ...existing,

      status:
        RUN_STATUS
          .IDEMPOTENT_REPLAY,

      idempotentReplay:
        true,
    };
  }

  _validateAgentOutputSize(
    output,
  ) {
    const bytes =
      safeBytes(
        output,
      );

    if (
      bytes
      > this.config
        .maxAgentOutputBytes
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .OUTPUT_TOO_LARGE,

        `Agent output exceeds ${this.config.maxAgentOutputBytes} bytes.`,

        {
          bytes,

          maxAgentOutputBytes:
            this.config
              .maxAgentOutputBytes,
        },
      );
    }
  }

  async _runAgent(
    agent,
    context,
    options = {},
  ) {
    const startedAt =
      toIso(
        this.clock(),
        new Date().toISOString(),
      );

    const startedMs =
      Date.now();

    const requestedCapabilities =
      context.command.capabilities;

    const allowedForAgent =
      requestedCapabilities.length
        ? requestedCapabilities.filter(
            (capability) =>
              agent.capabilities.includes(
                capability,
              ),
          )
        : [
            ...agent.capabilities,
          ];

    const agentContext =
      deepFreeze(
        clone({
          ...context,

          agent: {
            id:
              agent.id,

            name:
              agent.name,

            version:
              agent.version,

            capabilities:
              allowedForAgent,
          },
        }),
      );

    try {
      const result =
        await withTimeout(
          async (
            signal,
          ) => {
            const executor =
              agent.run
              ?? agent.execute;

            if (
              typeof executor
                !== 'function'
            ) {
              throw new AgentOrchestratorError(
                ORCHESTRATOR_ERROR_CODES
                  .AGENT_PROTOCOL_ERROR,

                `Agent ${agent.id} no longer exposes an executable function.`,
              );
            }

            return executor(
              agentContext,
              {
                signal,

                provider:
                  PROVIDER,

                tenantId:
                  context.tenant.id,

                requestedCapabilities:
                  [
                    ...requestedCapabilities,
                  ],

                allowedCapabilities:
                  [
                    ...allowedForAgent,
                  ],

                readOnly:
                  true,
              },
            );
          },

          agent.timeoutMs,

          options.signal,
        );

      this._validateAgentOutputSize(
        result,
      );

      const normalized =
        normalizeAgentResult(
          result,
          agent,
          this.config,
        );

      return {
        agentId:
          agent.id,

        agentVersion:
          agent.version,

        startedAt,

        completedAt:
          toIso(
            this.clock(),
            new Date().toISOString(),
          ),

        durationMs:
          Date.now()
          - startedMs,

        status:
          normalized.status,

        outcome:
          normalized.outcome,

        result:
          normalized,

        error:
          null,
      };
    } catch (error) {
      const isTimeout =
        error?.code
          === ORCHESTRATOR_ERROR_CODES
            .AGENT_TIMEOUT;

      return {
        agentId:
          agent.id,

        agentVersion:
          agent.version,

        startedAt,

        completedAt:
          toIso(
            this.clock(),
            new Date().toISOString(),
          ),

        durationMs:
          Date.now()
          - startedMs,

        status:
          isTimeout
            ? AGENT_STATUS.TIMED_OUT
            : AGENT_STATUS.FAILED,

        outcome:
          AGENT_OUTCOMES.UNAVAILABLE,

        result: {
          outcome:
            AGENT_OUTCOMES.UNAVAILABLE,

          status:
            isTimeout
              ? AGENT_STATUS.TIMED_OUT
              : AGENT_STATUS.FAILED,

          rationale:
            null,

          reasonCodes: [
            isTimeout
              ? ORCHESTRATOR_ERROR_CODES
                  .AGENT_TIMEOUT
              : (
                  error?.code
                    ?? ORCHESTRATOR_ERROR_CODES
                      .AGENT_PROTOCOL_ERROR
                ),
          ],

          findings: [],

          controls: [],

          recommendations: [],

          requestedActions: [],

          evidence: [],

          confidence:
            null,

          riskLevel:
            'UNKNOWN',

          modelVersion:
            null,

          policyFingerprint:
            null,

          governanceFingerprint:
            null,

          metadata:
            {},

          sideEffectsRequested:
            false,

          resultFingerprint:
            `sha256:${sha256({
              agentId:
                agent.id,

              errorCode:
                error?.code
                ?? null,
            })}`,

          agent: {
            id:
              agent.id,

            name:
              agent.name,

            version:
              agent.version,

            capabilities:
              [
                ...agent.capabilities,
              ],
          },
        },

        error:
          safeError(
            error,
          ),
      };
    }
  }

  async _runAgents(
    agents,
    context,
    options = {},
  ) {
    const parallelism =
      toInteger(
        options.parallelism,
        this.config
          .defaultParallelism,

        {
          min: 1,
          max:
            this.config
              .maxParallelism,
        },
      );

    const results =
      new Array(
        agents.length,
      );

    let cursor = 0;

    const worker =
      async () => {
        while (true) {
          const index =
            cursor;

          cursor += 1;

          if (
            index >= agents.length
          ) {
            return;
          }

          results[index] =
            await this._runAgent(
              agents[index],
              context,
              options,
            );
        }
      };

    await Promise.all(
      Array.from(
        {
          length:
            Math.min(
              parallelism,
              agents.length,
            ),
        },
        () =>
          worker(),
      ),
    );

    return results;
  }

  _aggregateAgentResults(
    results,
  ) {
    const outcomes =
      results.map(
        (item) =>
          item.outcome,
      );

    const recommendations =
      results.flatMap(
        (item) =>
          item.result
            ?.recommendations
          ?? [],
      );

    const findings =
      results.flatMap(
        (item) =>
          item.result?.findings
          ?? [],
      );

    const controls =
      results.flatMap(
        (item) =>
          item.result?.controls
          ?? [],
      );

    const reasonCodes =
      results.flatMap(
        (item) =>
          item.result?.reasonCodes
          ?? [],
      );

    const evidence =
      results.flatMap(
        (item) =>
          item.result?.evidence
          ?? [],
      );

    const statuses =
      results.map(
        (item) =>
          item.status,
      );

    const failed =
      results.filter(
        (item) =>
          item.status
            === AGENT_STATUS.FAILED,
      );

    const timedOut =
      results.filter(
        (item) =>
          item.status
            === AGENT_STATUS.TIMED_OUT,
      );

    const blocked =
      results.filter(
        (item) =>
          item.status
            === AGENT_STATUS.BLOCKED
          || item.result?.outcome
            === AGENT_OUTCOMES.BLOCK,
      );

    const hasCriticalFinding =
      findings.some(
        (finding) =>
          upper(
            finding.severity,
            30,
          ) === 'CRITICAL',
      );

    const hasHighFinding =
      findings.some(
        (finding) =>
          [
            'HIGH',
            'CRITICAL',
          ].includes(
            upper(
              finding.severity,
              30,
            ),
          ),
      );

    const humanReviewRequired =
      findings.some(
        (finding) =>
          finding.humanReviewRequired,
      )
      || recommendations.some(
        (recommendation) =>
          recommendation
            .humanReviewRequired,
      )
      || outcomes.includes(
        AGENT_OUTCOMES
          .REQUIRE_REVIEW,
      )
      || outcomes.includes(
        AGENT_OUTCOMES
          .REQUIRE_APPROVAL,
      );

    let aggregateOutcome =
      AGENT_OUTCOMES.INFORM;

    let executionState =
      EXECUTION_STATES
        .NOT_AUTHORIZED;

    if (
      blocked.length > 0
      || outcomes.includes(
        AGENT_OUTCOMES.BLOCK,
      )
    ) {
      aggregateOutcome =
        AGENT_OUTCOMES.BLOCK;

      executionState =
        EXECUTION_STATES.BLOCKED;
    } else if (
      outcomes.includes(
        AGENT_OUTCOMES.CONFLICT,
      )
    ) {
      aggregateOutcome =
        AGENT_OUTCOMES.CONFLICT;

      executionState =
        EXECUTION_STATES
          .REQUIRES_GOVERNANCE;
    } else if (
      outcomes.includes(
        AGENT_OUTCOMES
          .REQUIRE_APPROVAL,
      )
    ) {
      aggregateOutcome =
        AGENT_OUTCOMES
          .REQUIRE_APPROVAL;

      executionState =
        EXECUTION_STATES
          .REQUIRES_APPROVAL;
    } else if (
      outcomes.includes(
        AGENT_OUTCOMES
          .REQUIRE_REVIEW,
      )
      || humanReviewRequired
    ) {
      aggregateOutcome =
        AGENT_OUTCOMES
          .REQUIRE_REVIEW;

      executionState =
        EXECUTION_STATES
          .REQUIRES_GOVERNANCE;
    } else if (
      outcomes.includes(
        AGENT_OUTCOMES
          .ALLOW_WITH_CONTROLS,
      )
    ) {
      aggregateOutcome =
        AGENT_OUTCOMES
          .ALLOW_WITH_CONTROLS;

      executionState =
        EXECUTION_STATES
          .PROPOSED;
    } else if (
      outcomes.includes(
        AGENT_OUTCOMES.ALLOW,
      )
    ) {
      aggregateOutcome =
        AGENT_OUTCOMES.ALLOW;

      executionState =
        EXECUTION_STATES
          .PROPOSED;
    } else if (
      outcomes.every(
        (value) =>
          value
            === AGENT_OUTCOMES
              .NO_ACTION,
      )
    ) {
      aggregateOutcome =
        AGENT_OUTCOMES.NO_ACTION;

      executionState =
        EXECUTION_STATES
          .NOT_REQUESTED;
    }

    if (
      failed.length > 0
      || timedOut.length > 0
    ) {
      if (
        aggregateOutcome
          === AGENT_OUTCOMES.ALLOW
      ) {
        aggregateOutcome =
          AGENT_OUTCOMES
            .INDETERMINATE;

        executionState =
          EXECUTION_STATES
            .REQUIRES_GOVERNANCE;
      }
    }

    return {
      aggregateOutcome,

      executionState,

      humanReviewRequired,

      criticalFinding:
        hasCriticalFinding,

      highFinding:
        hasHighFinding,

      agentCount:
        results.length,

      completedCount:
        statuses.filter(
          (status) =>
            status
              === AGENT_STATUS.COMPLETED,
        ).length,

      failedCount:
        failed.length,

      timedOutCount:
        timedOut.length,

      blockedCount:
        blocked.length,

      findings:
        uniqueBy(
          findings.slice(
            0,
            this.config
              .maxFindings,
          ),

          (item) =>
            `${item.code}|${item.reason ?? ''}`,
        ),

      controls:
        [
          ...new Set(
            controls,
          ),
        ].slice(
          0,
          this.config
            .maxControls,
        ),

      recommendations:
        uniqueBy(
          recommendations.slice(
            0,
            this.config
              .maxRecommendations,
          ),

          (item) =>
            `${item.action}|${item.rationale ?? ''}`,
        ),

      reasonCodes:
        [
          ...new Set(
            reasonCodes,
          ),
        ].slice(
          0,
          this.config
            .maxFindings,
        ),

      evidence:
        uniqueBy(
          evidence.slice(
            0,
            this.config
              .maxEvidenceItems,
          ),

          (item) =>
            sha256(
              item,
            ),
        ),
    };
  }

  async _applyGovernanceGate({
    tenantId,
    input,
    aggregate,
    agentResults,
  }) {
    if (
      !this.governanceService
    ) {
      return {
        available:
          false,

        outcome:
          'NOT_EVALUATED',

        reasonCodes: [
          'GOVERNANCE_SERVICE_NOT_CONFIGURED',
        ],

        approvedForExecution:
          false,

        decision:
          null,
      };
    }

    const request = {
      tenantId,

      provider:
        PROVIDER,

      decisionId:
        input.decisionId,

      idempotencyKey:
        input.idempotencyKey,

      operation:
        input.operation,

      commandType:
        input.commandType
        ?? 'INTELLIGENCE_ORCHESTRATION',

      action:
        input.requestedAction,

      impactLevel:
        input.impactLevel,

      offlineState:
        input.offlineState,

      agentSummary: {
        outcome:
          aggregate.aggregateOutcome,

        executionState:
          aggregate.executionState,

        humanReviewRequired:
          aggregate
            .humanReviewRequired,

        criticalFinding:
          aggregate
            .criticalFinding,

        highFinding:
          aggregate.highFinding,

        reasonCodes:
          aggregate.reasonCodes,
      },

      intelligence:
        agentResults.map(
          (item) => ({
            agentId:
              item.agentId,

            agentVersion:
              item.agentVersion,

            outcome:
              item.outcome,

            resultFingerprint:
              item.result
                ?.resultFingerprint,

            policyFingerprint:
              item.result
                ?.policyFingerprint,

            governanceFingerprint:
              item.result
                ?.governanceFingerprint,

            riskLevel:
              item.result
                ?.riskLevel,
          }),
        ),

      requestedActions:
        aggregate.recommendations.map(
          (item) =>
            item.action,
        ),

      financialExecutionRequested:
        false,
    };

    try {
      const evaluator =
        this.governanceService
          .evaluate
        ?? this.governanceService
          .orchestrate
        ?? this.governanceService
          .decide;

      if (
        typeof evaluator
          !== 'function'
      ) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .GOVERNANCE_BLOCKED,

          'Configured governance service does not expose an evaluation method.',
        );
      }

      const decision =
        await evaluator.call(
          this.governanceService,
          request,
        );

      const governanceOutcome =
        normalizeOutcome(
          decision?.outcome
            ?? decision?.decision
            ?? decision
              ?.governance
              ?.outcome,
        );

      const blocking =
        [
          AGENT_OUTCOMES.BLOCK,
          AGENT_OUTCOMES
            .CONFLICT,
        ].includes(
          governanceOutcome,
        );

      const review =
        [
          AGENT_OUTCOMES
            .REQUIRE_REVIEW,

          AGENT_OUTCOMES
            .REQUIRE_APPROVAL,
        ].includes(
          governanceOutcome,
        );

      return {
        available:
          true,

        outcome:
          governanceOutcome,

        reasonCodes:
          normalizeReasonCodes(
            decision?.reasonCodes
              ?? decision?.reasons,

            this.config
              .maxFindings,

            this.config
              .maxReasonCodeLength,
          ),

        approvedForExecution:
          false,

        blocked,

        requiresHumanReview:
          review
          || Boolean(
            decision
              ?.humanReviewRequired,
          ),

        decision:
          redact(
            decision,
          ),
      };
    } catch (error) {
      this._log(
        'warn',

        'Agent orchestration governance gate failed.',

        error,

        {
          tenantId:
            digest(
              tenantId,
            ),
        },
      );

      if (
        this.config
          .failClosedOnGovernanceError
      ) {
        throw new AgentOrchestratorError(
          ORCHESTRATOR_ERROR_CODES
            .GOVERNANCE_BLOCKED,

          'Governance evaluation failed and orchestration is fail-closed.',

          {},

          {
            httpStatus: 503,
            retryable: true,
            cause: error,
          },
        );
      }

      return {
        available:
          false,

        outcome:
          'UNAVAILABLE',

        reasonCodes: [
          ORCHESTRATOR_ERROR_CODES
            .GOVERNANCE_BLOCKED,
        ],

        approvedForExecution:
          false,

        blocked:
          true,

        requiresHumanReview:
          true,

        decision:
          null,
      };
    }
  }

  async _applyApprovalGate({
    tenantId,
    input,
    aggregate,
  }) {
    const approvalRequested =
      aggregate.aggregateOutcome
        === AGENT_OUTCOMES
          .REQUIRE_APPROVAL
      || input.requestedAction
        === ACTION_TYPES
          .REQUEST_APPROVAL;

    if (
      !approvalRequested
      || !this.approvalWorkflow
    ) {
      return {
        available:
          Boolean(
            this.approvalWorkflow,
          ),

        requested:
          approvalRequested,

        state:
          EXECUTION_STATES
            .NOT_REQUESTED,

        approval:
          null,
      };
    }

    try {
      const getter =
        this.approvalWorkflow
          .getApprovalStatus
        ?? this.approvalWorkflow
          .getByDecisionId
        ?? this.approvalWorkflow
          .getRequest;

      if (
        typeof getter
          !== 'function'
      ) {
        return {
          available:
            false,

          requested:
            true,

          state:
            EXECUTION_STATES
              .REQUIRES_APPROVAL,

          approval:
            null,
        };
      }

      const approval =
        await getter.call(
          this.approvalWorkflow,
          {
            tenantId,

            provider:
              PROVIDER,

            decisionId:
              input.decisionId,
          },
        );

      return {
        available:
          true,

        requested:
          true,

        state:
          EXECUTION_STATES
            .REQUIRES_APPROVAL,

        approval:
          redact(
            approval,
          ),
      };
    } catch (error) {
      this._log(
        'warn',

        'Agent orchestration approval lookup failed.',

        error,

        {
          tenantId:
            digest(
              tenantId,
            ),
        },
      );

      return {
        available:
          false,

        requested:
          true,

        state:
          EXECUTION_STATES
            .REQUIRES_APPROVAL,

        approval:
          null,

        error:
          safeError(
            error,
          ),
      };
    }
  }

  _buildSemanticFingerprint({
    tenantId,
    input,
    context,
    agents,
    capabilities,
  }) {
    return `sha256:${sha256({
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenantId:
        digest(
          tenantId,
        ),

      commandType:
        normalizeString(
          input.commandType
            ?? input.command
            ?? 'INTELLIGENCE_ORCHESTRATION',
          160,
        ),

      operation:
        normalizeString(
          input.operation,
          160,
        ) ?? null,

      requestedAction:
        normalizeActionType(
          input.requestedAction,
        ),

      decisionId:
        normalizeString(
          input.decisionId,
          180,
        ) ?? null,

      impactLevel:
        upper(
          input.impactLevel,
          80,
        ) ?? null,

      offlineState:
        upper(
          input.offlineState,
          80,
        ) ?? null,

      capabilities,

      agents:
        agents.map(
          (agent) => ({
            id:
              agent.id,

            version:
              agent.version,

            capabilities:
              agent.capabilities,
          }),
        ),

      context,
    })}`;
  }

  async orchestrate(
    input = {},
  ) {
    assertPlainObject(
      input,
      'input',
    );

    const tenantId =
      this._tenantId(
        input.tenantId,
      );

    this._provider(
      input.provider,
    );

    const agents =
      this._normalizeRequestedAgents(
        input,
      );

    if (!agents.length) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .AGENT_REQUIRED,

        'At least one enabled agent is required for orchestration.',
      );
    }

    const capabilities =
      this._normalizeCapabilities(
        input,
        agents,
      );

    const context =
      this._buildContext(
        input,
        tenantId,
        capabilities,
      );

    const semanticFingerprint =
      this._buildSemanticFingerprint({
        tenantId,
        input,
        context,
        agents,
        capabilities,
      });

    const idempotencyKey =
      normalizeString(
        input.idempotencyKey,
        300,
      );

    if (idempotencyKey) {
      const replay =
        await this._checkIdempotency({
          tenantId,

          idempotencyKey,

          semanticFingerprint,
        });

      if (replay) {
        this._metric(
          'agent_orchestration_idempotent_replay_total',

          {
            provider:
              PROVIDER,
          },
        );

        return deepFreeze(
          redact(
            replay,
          ),
        );
      }
    }

    const runId =
      normalizeString(
        input.runId,
        this.config
          .maxRunIdLength,
      )
      ?? this.idFactory();

    const startedAt =
      toIso(
        this.clock(),
        new Date().toISOString(),
      );

    const overallTimeoutMs =
      toInteger(
        input.overallTimeoutMs,
        this.config
          .defaultOverallTimeoutMs,

        {
          min: 1,

          max:
            this.config
              .maxOverallTimeoutMs,
        },
      );

    const controller =
      new AbortController();

    const overallTimer =
      setTimeout(
        () =>
          controller.abort(),

        overallTimeoutMs,
      );

    this._metric(
      'agent_orchestration_started_total',

      {
        provider:
          PROVIDER,
      },
    );

    let agentResults = [];
    let runStatus =
      RUN_STATUS.RUNNING;

    let aggregate = null;
    let governance = null;
    let approval = null;
    let fatalError = null;

    try {
      agentResults =
        await Promise.race([
          this._runAgents(
            agents,
            context,
            {
              parallelism:
                input.parallelism,

              signal:
                controller.signal,
            },
          ),

          new Promise(
            (_, reject) => {
              controller.signal.addEventListener(
                'abort',
                () => {
                  reject(
                    new AgentOrchestratorError(
                      ORCHESTRATOR_ERROR_CODES
                        .ORCHESTRATION_TIMEOUT,

                      `Agent orchestration exceeded ${overallTimeoutMs}ms.`,

                      {
                        timeoutMs:
                          overallTimeoutMs,
                      },

                      {
                        httpStatus: 504,
                        retryable: true,
                      },
                    ),
                  );
                },

                {
                  once: true,
                },
              );
            },
          ),
        ]);

      aggregate =
        this._aggregateAgentResults(
          agentResults,
        );

      if (
        agentResults.some(
          (item) =>
            item.result
              ?.sideEffectsRequested,
        )
      ) {
        aggregate.aggregateOutcome =
          AGENT_OUTCOMES.BLOCK;

        aggregate.executionState =
          EXECUTION_STATES.BLOCKED;

        aggregate.reasonCodes = [
          ...new Set([
            ...aggregate.reasonCodes,

            ORCHESTRATOR_ERROR_CODES
              .FINANCIAL_EXECUTION_FORBIDDEN,
          ]),
        ];
      }

      if (
        agents.some(
          (agent) =>
            agent.required,
        )
        && agentResults.some(
          (item) => {
            const agent =
              agents.find(
                (candidate) =>
                  candidate.id
                    === item.agentId,
              );

            return (
              agent?.required
              && item.status
                !== AGENT_STATUS.COMPLETED
            );
          },
        )
      ) {
        aggregate.aggregateOutcome =
          AGENT_OUTCOMES
            .INDETERMINATE;

        aggregate.executionState =
          EXECUTION_STATES
            .REQUIRES_GOVERNANCE;

        aggregate.reasonCodes = [
          ...new Set([
            ...aggregate.reasonCodes,

            'REQUIRED_AGENT_UNAVAILABLE',
          ]),
        ];
      }

      governance =
        await this._applyGovernanceGate({
          tenantId,
          input,
          aggregate,
          agentResults,
        });

      if (
        governance.blocked
      ) {
        aggregate.aggregateOutcome =
          AGENT_OUTCOMES.BLOCK;

        aggregate.executionState =
          EXECUTION_STATES.BLOCKED;
      } else if (
        governance.requiresHumanReview
      ) {
        aggregate.humanReviewRequired =
          true;

        if (
          aggregate.aggregateOutcome
            === AGENT_OUTCOMES.ALLOW
        ) {
          aggregate.aggregateOutcome =
            AGENT_OUTCOMES
              .REQUIRE_REVIEW;
        }

        aggregate.executionState =
          EXECUTION_STATES
            .REQUIRES_GOVERNANCE;
      }

      approval =
        await this._applyApprovalGate({
          tenantId,
          input,
          aggregate,
        });

      if (
        approval.requested
        && aggregate.aggregateOutcome
          !== AGENT_OUTCOMES.BLOCK
      ) {
        aggregate.aggregateOutcome =
          AGENT_OUTCOMES
            .REQUIRE_APPROVAL;

        aggregate.executionState =
          EXECUTION_STATES
            .REQUIRES_APPROVAL;
      }

      runStatus =
        agentResults.some(
          (item) =>
            item.status
              === AGENT_STATUS.FAILED
            || item.status
              === AGENT_STATUS.TIMED_OUT,
        )
          ? (
              aggregate.completedCount
                > 0
                ? RUN_STATUS.PARTIAL
                : RUN_STATUS.FAILED
            )
          : aggregate.aggregateOutcome
              === AGENT_OUTCOMES.BLOCK
            ? RUN_STATUS.BLOCKED
            : RUN_STATUS.COMPLETED;
    } catch (error) {
      fatalError =
        error;

      runStatus =
        error?.code
          === ORCHESTRATOR_ERROR_CODES
            .ORCHESTRATION_TIMEOUT
          ? RUN_STATUS.TIMED_OUT
          : error?.code
              === ORCHESTRATOR_ERROR_CODES
                .IDEMPOTENCY_CONFLICT
            ? RUN_STATUS.CONFLICT
            : RUN_STATUS.FAILED;

      aggregate =
        aggregate
        ?? {
          aggregateOutcome:
            AGENT_OUTCOMES
              .INDETERMINATE,

          executionState:
            EXECUTION_STATES
              .REQUIRES_GOVERNANCE,

          humanReviewRequired:
            true,

          criticalFinding:
            false,

          highFinding:
            true,

          agentCount:
            agents.length,

          completedCount:
            agentResults.filter(
              (item) =>
                item?.status
                  === AGENT_STATUS
                    .COMPLETED,
            ).length,

          failedCount:
            agentResults.filter(
              (item) =>
                item?.status
                  === AGENT_STATUS
                    .FAILED,
            ).length,

          timedOutCount:
            agentResults.filter(
              (item) =>
                item?.status
                  === AGENT_STATUS
                    .TIMED_OUT,
            ).length,

          blockedCount:
            0,

          findings: [],

          controls: [],

          recommendations: [],

          reasonCodes: [
            error?.code
              ?? ORCHESTRATOR_ERROR_CODES
                .INVALID_INPUT,
          ],

          evidence: [],
        };
    } finally {
      clearTimeout(
        overallTimer,
      );
    }

    const completedAt =
      toIso(
        this.clock(),
        new Date().toISOString(),
      );

    const run = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      runId,

      tenantId,

      idempotencyKey:
        idempotencyKey
        ?? null,

      semanticFingerprint,

      startedAt,

      completedAt,

      durationMs:
        Math.max(
          0,
          new Date(
            completedAt,
          ).getTime()
          - new Date(
              startedAt,
            ).getTime(),
        ),

      status:
        runStatus,

      requestedAction:
        normalizeActionType(
          input.requestedAction,
        ),

      commandType:
        normalizeString(
          input.commandType
            ?? input.command
            ?? 'INTELLIGENCE_ORCHESTRATION',
          160,
        ),

      operation:
        normalizeString(
          input.operation,
          160,
        ) ?? null,

      decisionId:
        input.decisionId
          ? digest(
              input.decisionId,
            )
          : null,

      agents:
        agents.map(
          (agent) => ({
            id:
              agent.id,

            name:
              agent.name,

            version:
              agent.version,

            capabilities:
              [
                ...agent.capabilities,
              ],

            required:
              agent.required,
          }),
        ),

      requestedCapabilities:
        capabilities,

      agentResults:
        agentResults.map(
          (item) =>
            redact(
              item,
            ),
        ),

      aggregate:
        redact(
          aggregate,
        ),

      governance:
        redact(
          governance,
        ),

      approval:
        redact(
          approval,
        ),

      errors:
        fatalError
          ? [
              safeError(
                fatalError,
              ),
            ]
          : [],

      controls: {
        humanReviewRequired:
          Boolean(
            aggregate
              ?.humanReviewRequired,
          ),

        executionState:
          aggregate
            ?.executionState
          ?? EXECUTION_STATES
            .NOT_AUTHORIZED,

        financialExecutionRequested:
          false,

        financialExecutionAllowed:
          false,

        providerCallAllowed:
          false,

        ledgerMutationAllowed:
          false,

        approvalGrantAllowed:
          false,

        autonomousSideEffectAllowed:
          false,
      },

      safety: {
        providerCallPerformed:
          false,

        paymentExecutionPerformed:
          false,

        settlementPerformed:
          false,

        ledgerMutationPerformed:
          false,

        balanceMutationPerformed:
          false,

        approvalGranted:
          false,

        modelDisabled:
          false,

        modelRetrained:
          false,
      },
    };

    run.runFingerprint =
      `sha256:${sha256({
        schemaVersion:
          run.schemaVersion,

        provider:
          run.provider,

        tenantId:
          digest(
            tenantId,
          ),

        semanticFingerprint:
          run.semanticFingerprint,

        status:
          run.status,

        requestedAction:
          run.requestedAction,

        commandType:
          run.commandType,

        operation:
          run.operation,

        decisionId:
          run.decisionId,

        agents:
          run.agents,

        requestedCapabilities:
          run.requestedCapabilities,

        agentResults:
          run.agentResults,

        aggregate:
          run.aggregate,

        governance:
          run.governance,

        approval:
          run.approval,

        errors:
          run.errors,

        controls:
          run.controls,
      })}`;

    if (
      safeBytes(
        run,
      )
      > this.config
        .maxRunOutputBytes
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .OUTPUT_TOO_LARGE,

        `Orchestration run exceeds ${this.config.maxRunOutputBytes} bytes.`,

        {
          maxRunOutputBytes:
            this.config
              .maxRunOutputBytes,
        },
      );
    }

    if (
      this.config
        .persistCompletedRuns
      && typeof this.repository
        .saveRun
        === 'function'
    ) {
      try {
        await this.repository
          .saveRun(
            clone(
              run,
            ),
          );
      } catch (error) {
        this._log(
          'error',

          'Agent orchestration run persistence failed.',

          error,

          {
            tenantId:
              digest(
                tenantId,
              ),

            runId:
              digest(
                runId,
              ),
          },
        );

        if (
          this.config
            .failClosedOnRepositoryError
        ) {
          throw new AgentOrchestratorError(
            ORCHESTRATOR_ERROR_CODES
              .REPOSITORY_UNAVAILABLE,

            'Unable to persist orchestration run.',

            {},

            {
              httpStatus: 503,
              retryable: true,
              cause: error,
            },
          );
        }
      }
    }

    if (
      this.config
        .persistAgentResults
      && typeof this.repository
        .saveAgentResult
        === 'function'
    ) {
      for (
        const agentResult
        of agentResults
      ) {
        try {
          await this.repository
            .saveAgentResult({
              schemaVersion:
                SCHEMA_VERSION,

              provider:
                PROVIDER,

              tenantId,

              runId,

              agentId:
                agentResult
                  .agentId,

              agentVersion:
                agentResult
                  .agentVersion,

              status:
                agentResult.status,

              outcome:
                agentResult.outcome,

              startedAt:
                agentResult.startedAt,

              completedAt:
                agentResult.completedAt,

              durationMs:
                agentResult.durationMs,

              result:
                clone(
                  agentResult.result,
                ),

              error:
                clone(
                  agentResult.error,
                ),
            });
        } catch (error) {
          this._log(
            'warn',

            'Agent result persistence failed.',

            error,

            {
              runId:
                digest(
                  runId,
                ),

              agentId:
                digest(
                  agentResult
                    .agentId,
                ),
            },
          );
        }
      }
    }

    await this._audit({
      action:
        'AGENT_ORCHESTRATION_COMPLETED',

      tenantId:
        digest(
          tenantId,
        ),

      runId:
        digest(
          runId,
        ),

      decisionId:
        run.decisionId,

      status:
        run.status,

      aggregateOutcome:
        aggregate
          ?.aggregateOutcome,

      executionState:
        aggregate
          ?.executionState,

      humanReviewRequired:
        Boolean(
          aggregate
            ?.humanReviewRequired,
        ),

      agentCount:
        agents.length,

      failedAgentCount:
        aggregate
          ?.failedCount
        ?? 0,

      timedOutAgentCount:
        aggregate
          ?.timedOutCount
        ?? 0,

      blockedAgentCount:
        aggregate
          ?.blockedCount
        ?? 0,

      semanticFingerprint,

      runFingerprint:
        run.runFingerprint,
    });

    this._metric(
      'agent_orchestration_completed_total',

      {
        status:
          run.status,

        outcome:
          aggregate
            ?.aggregateOutcome
          ?? 'INDETERMINATE',
      },
    );

    if (
      aggregate
        ?.humanReviewRequired
    ) {
      this._metric(
        'agent_orchestration_human_review_required_total',

        {
          outcome:
            aggregate
              .aggregateOutcome,
        },
      );
    }

    return deepFreeze(
      redact(
        run,
      ),
    );
  }

  async run(
    input = {},
  ) {
    return this.orchestrate(
      input,
    );
  }

  async execute(
    input = {},
  ) {
    return this.orchestrate(
      input,
    );
  }

  async getRun({
    tenantId,
    runId,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const scopedRunId =
      normalizeString(
        runId,
        this.config
          .maxRunIdLength,
      );

    if (!scopedRunId) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .INVALID_INPUT,

        'runId is required.',
      );
    }

    if (
      typeof this.repository
        .getRun
        !== 'function'
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Agent orchestrator repository does not implement getRun.',
      );
    }

    const record =
      await this.repository
        .getRun({
          tenantId:
            scopedTenant,

          runId:
            scopedRunId,

          provider:
            PROVIDER,
        });

    return record
      ? deepFreeze(
          redact(
            record,
          ),
        )
      : null;
  }

  async listRuns({
    tenantId,
    limit = 50,
    offset = 0,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    if (
      typeof this.repository
        .listRuns
        !== 'function'
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Agent orchestrator repository does not implement listRuns.',
      );
    }

    const boundedLimit =
      toInteger(
        limit,
        50,
        {
          min: 1,
          max: 250,
        },
      );

    const boundedOffset =
      toInteger(
        offset,
        0,
        {
          min: 0,
          max:
            Number.MAX_SAFE_INTEGER,
        },
      );

    const result =
      await this.repository
        .listRuns({
          tenantId:
            scopedTenant,

          provider:
            PROVIDER,

          limit:
            boundedLimit,

          offset:
            boundedOffset,
        });

    return deepFreeze(
      redact(
        result,
      ),
    );
  }

  async listAgentResults({
    tenantId,
    runId,
    limit = 100,
    offset = 0,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const scopedRunId =
      normalizeString(
        runId,
        this.config
          .maxRunIdLength,
      );

    if (!scopedRunId) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .INVALID_INPUT,

        'runId is required.',
      );
    }

    if (
      typeof this.repository
        .listAgentResults
        !== 'function'
    ) {
      throw new AgentOrchestratorError(
        ORCHESTRATOR_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Agent orchestrator repository does not implement listAgentResults.',
      );
    }

    const result =
      await this.repository
        .listAgentResults({
          tenantId:
            scopedTenant,

          runId:
            scopedRunId,

          provider:
            PROVIDER,

          limit:
            toInteger(
              limit,
              100,
              {
                min: 1,
                max: 250,
              },
            ),

          offset:
            toInteger(
              offset,
              0,
              {
                min: 0,
                max:
                  Number.MAX_SAFE_INTEGER,
              },
            ),
        });

    return deepFreeze(
      redact(
        result,
      ),
    );
  }

  async health() {
    let repository =
      null;

    let state =
      'HEALTHY';

    try {
      if (
        typeof this.repository
          .healthCheck
        === 'function'
      ) {
        repository =
          await this.repository
            .healthCheck();
      } else if (
        typeof this.repository
          .health
        === 'function'
      ) {
        repository =
          await this.repository
            .health();
      } else {
        repository = {
          ok:
            true,

          reason:
            'Repository configured; health method not implemented.',
        };
      }
    } catch (error) {
      state =
        'UNAVAILABLE';

      repository = {
        ok:
          false,

        error:
          safeError(
            error,
          ),
      };
    }

    if (
      repository?.ok
        === false
      && state
        !== 'UNAVAILABLE'
    ) {
      state =
        'DEGRADED';
    }

    const enabledAgentCount =
      [
        ...this.agents.values(),
      ].filter(
        (agent) =>
          agent.enabled,
      ).length;

    const disabledAgentCount =
      [
        ...this.agents.values(),
      ].filter(
        (agent) =>
          !agent.enabled,
      ).length;

    if (
      enabledAgentCount === 0
      && state === 'HEALTHY'
    ) {
      state =
        'DEGRADED';
    }

    return deepFreeze({
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
        state === 'HEALTHY',

      degraded:
        state === 'DEGRADED',

      unavailable:
        state === 'UNAVAILABLE',

      agents: {
        registered:
          this.agents.size,

        enabled:
          enabledAgentCount,

        disabled:
          disabledAgentCount,
      },

      repository:
        redact(
          repository,
        ),

      safety: {
        financialExecutionAllowed:
          false,

        providerCallsAllowed:
          false,

        ledgerMutationAllowed:
          false,

        approvalGrantAllowed:
          false,

        arbitraryCodeExecutionAllowed:
          false,
      },
    });
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

      idempotency:
        true,

      deterministicSemanticFingerprint:
        true,

      boundedParallelism:
        true,

      boundedTimeouts:
        true,

      immutableResults:
        true,

      explicitAgentRegistry:
        true,

      arbitraryCodeExecution:
        false,

      financialExecution:
        false,

      providerCalls:
        false,

      ledgerMutation:
        false,

      approvalGrant:
        false,

      modelRetraining:
        false,

      rawProviderPayloadPersistence:
        false,
    });
  }
}

export function createAgentOrchestrator(
  options = {},
) {
  return new AgentOrchestrator(
    options,
  );
}

export const createAirtelAgentOrchestrator =
  createAgentOrchestrator;

export const AirtelAgentOrchestrator =
  AgentOrchestrator;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    RUN_STATUS,
    AGENT_STATUS,
    AGENT_OUTCOMES,
    ACTION_TYPES,
    EXECUTION_STATES,
    ORCHESTRATOR_ERROR_CODES,
  });

export function buildOrchestrationFingerprint(
  value,
) {
  return `sha256:${sha256(
    value,
  )}`;
}

export default AgentOrchestrator;