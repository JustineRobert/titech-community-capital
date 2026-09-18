/**
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Decision Governance Service
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/governance/decisionGovernanceService.js
 *
 * Architectural role
 * ------------------
 * The decision-governance orchestration boundary for Airtel payment intelligence.
 * It combines deterministic regulatory/compliance intelligence, risk/prediction
 * signals, provider/recommendation intelligence and maker-checker governance into
 * one execution-safe decision envelope.
 *
 * The service deliberately sits ABOVE intelligence engines and approvalWorkflow
 * and BELOW the payment orchestrator / Financial Core boundary:
 *
 *   Provider / payment context
 *             |
 *             v
 *   +-------------------------+
 *   | Decision Governance     |
 *   | Service                 |
 *   +-------------------------+
 *      |     |      |      |
 *      v     v      v      v
 *   Regulatory Risk   Prediction  Recommendation / Learning
 *   Intelligence             Engines
 *             |
 *             v
 *      Governance result
 *             |
 *       +-----+------+
 *       |            |
 *       v            v
 *   BLOCK/REVIEW   Approval Workflow
 *                         |
 *                         v
 *                Execution Authorization
 *                         |
 *                         v
 *                  Payment Orchestrator
 *                         |
 *                         v
 *                  Financial Core
 *
 * Responsibilities
 * ----------------
 * - Enforce tenant and Airtel provider boundaries.
 * - Build one deterministic governance fingerprint for the complete decision
 *   context without persisting raw provider secrets or sensitive payloads.
 * - Consume optional regulatory, prediction, recommendation, risk and policy
 *   engines through dependency injection.
 * - Fail closed on authoritative governance uncertainty for consequential
 *   financial actions.
 * - Distinguish intelligence assessment from approval and execution authority.
 * - Enforce original payment idempotency identity preservation.
 * - Enforce unresolved-offline-state restrictions.
 * - Produce auditable governance events through decisionAuditLedger.js.
 * - Delegate maker-checker state transitions to approvalWorkflow.js.
 * - Re-verify the exact immutable operation scope before execution.
 * - Support health/metrics/logging without introducing new runtime dependencies.
 *
 * Non-responsibilities / important boundaries
 * --------------------------------------------
 * - Does NOT call Airtel APIs.
 * - Does NOT create, settle, reverse, refund or otherwise execute payments.
 * - Does NOT mutate balances or post accounting entries.
 * - Does NOT replace the canonical double-entry ledger.
 * - Does NOT perform authoritative KYC/AML/sanctions screening by itself.
 * - Does NOT silently override a regulatory BLOCK, reconciliation conflict,
 *   circuit-breaker state or approval requirement.
 * - Does NOT treat model confidence or provider recommendations as proof of
 *   financial success.
 * - Does NOT make an approval decision on behalf of a required checker.
 * - Does NOT persist financial state internally; repository/workflow adapters own
 *   durable state transitions.
 * - Does NOT treat LOCAL_ONLY / PENDING_SYNC / SYNCING / CONFLICT states as final
 *   settlement.
 *
 * Production safety principles
 * ----------------------------
 * 1. Tenant isolation is mandatory by default.
 * 2. Provider scope is Airtel by default and cross-provider use is rejected.
 * 3. Governance decisions are deterministic and fingerprinted.
 * 4. The original idempotency key remains immutable through the governance path.
 * 5. Missing authoritative governance evidence is never silently upgraded to ALLOW.
 * 6. Regulatory BLOCK dominates ML/recommendation signals.
 * 7. Recommendation and prediction engines are advisory inputs, not settlement
 *    authority.
 * 8. Financial-impact decisions default to maker-checker governance.
 * 9. Scope must be revalidated at execution time; stale approvals are unusable.
 * 10. Audit failures fail closed for consequential governance operations.
 * 11. Sensitive payloads are redacted before logging or audit persistence.
 * 12. Offline/local state is explicitly distinguished from server-confirmed state.
 *
 * Module format
 * -------------
 * Native ESM, Node.js built-ins only. No static project-internal imports are used
 * so this orchestration boundary can be introduced without circular dependency
 * risk. Pass existing project services through the constructor.
 */

import { createHash, randomUUID } from 'node:crypto';

export const ENGINE_NAME = 'airtel-decision-governance-service';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;

export const GOVERNANCE_OUTCOMES = Object.freeze({
  ALLOW: 'ALLOW',
  ALLOW_WITH_CONTROLS: 'ALLOW_WITH_CONTROLS',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  BLOCK: 'BLOCK',
  CONFLICT: 'CONFLICT',
  STALE: 'STALE',
  INVALID: 'INVALID',
  INDETERMINATE: 'INDETERMINATE',
});

export const EXECUTION_STATES = Object.freeze({
  NOT_EVALUATED: 'NOT_EVALUATED',
  BLOCKED: 'BLOCKED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  AUTHORIZED: 'AUTHORIZED',
  CONSUMED: 'CONSUMED',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  STALE: 'STALE',
  CONFLICT: 'CONFLICT',
});

export const IMPACT_LEVELS = Object.freeze({
  NON_FINANCIAL: 'NON_FINANCIAL',
  FINANCIAL: 'FINANCIAL',
  COLLECTION: 'COLLECTION',
  DISBURSEMENT: 'DISBURSEMENT',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
  SETTLEMENT: 'SETTLEMENT',
});

export const OFFLINE_STATES = Object.freeze({
  LOCAL_ONLY: 'LOCAL_ONLY',
  PENDING_SYNC: 'PENDING_SYNC',
  SYNCING: 'SYNCING',
  SERVER_ACCEPTED: 'SERVER_ACCEPTED',
  SERVER_REJECTED: 'SERVER_REJECTED',
  CONFLICT: 'CONFLICT',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  CONFIRMED: 'CONFIRMED',
});

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const GOVERNANCE_EVENT_TYPES = Object.freeze({
  EVALUATED: 'GOVERNANCE_EVALUATED',
  BLOCKED: 'GOVERNANCE_BLOCKED',
  REVIEW_REQUIRED: 'GOVERNANCE_REVIEW_REQUIRED',
  APPROVAL_REQUIRED: 'GOVERNANCE_APPROVAL_REQUIRED',
  APPROVAL_REQUESTED: 'GOVERNANCE_APPROVAL_REQUESTED',
  APPROVAL_SUBMITTED: 'GOVERNANCE_APPROVAL_SUBMITTED',
  APPROVAL_GRANTED: 'GOVERNANCE_APPROVAL_GRANTED',
  APPROVAL_REJECTED: 'GOVERNANCE_APPROVAL_REJECTED',
  APPROVAL_CANCELLED: 'GOVERNANCE_APPROVAL_CANCELLED',
  APPROVAL_EXPIRED: 'GOVERNANCE_APPROVAL_EXPIRED',
  EXECUTION_VERIFIED: 'GOVERNANCE_EXECUTION_VERIFIED',
  EXECUTION_CONSUMED: 'GOVERNANCE_EXECUTION_CONSUMED',
  CONFLICT: 'GOVERNANCE_CONFLICT',
  STALE: 'GOVERNANCE_STALE',
  FAILURE: 'GOVERNANCE_FAILURE',
});

export const GOVERNANCE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'GOVERNANCE_INVALID_INPUT',
  TENANT_REQUIRED: 'GOVERNANCE_TENANT_REQUIRED',
  PROVIDER_SCOPE_VIOLATION: 'GOVERNANCE_PROVIDER_SCOPE_VIOLATION',
  OPERATION_REQUIRED: 'GOVERNANCE_OPERATION_REQUIRED',
  IDEMPOTENCY_REQUIRED: 'GOVERNANCE_IDEMPOTENCY_REQUIRED',
  OFFLINE_STATE_UNSAFE: 'GOVERNANCE_OFFLINE_STATE_UNSAFE',
  REGULATORY_BLOCK: 'GOVERNANCE_REGULATORY_BLOCK',
  POLICY_BLOCK: 'GOVERNANCE_POLICY_BLOCK',
  POLICY_UNAVAILABLE: 'GOVERNANCE_POLICY_UNAVAILABLE',
  INTELLIGENCE_UNAVAILABLE: 'GOVERNANCE_INTELLIGENCE_UNAVAILABLE',
  APPROVAL_REQUIRED: 'GOVERNANCE_APPROVAL_REQUIRED',
  APPROVAL_UNAVAILABLE: 'GOVERNANCE_APPROVAL_UNAVAILABLE',
  APPROVAL_REJECTED: 'GOVERNANCE_APPROVAL_REJECTED',
  APPROVAL_EXPIRED: 'GOVERNANCE_APPROVAL_EXPIRED',
  APPROVAL_STALE: 'GOVERNANCE_APPROVAL_STALE',
  EXECUTION_NOT_AUTHORIZED: 'GOVERNANCE_EXECUTION_NOT_AUTHORIZED',
  EXECUTION_ALREADY_CONSUMED: 'GOVERNANCE_EXECUTION_ALREADY_CONSUMED',
  AUDIT_UNAVAILABLE: 'GOVERNANCE_AUDIT_UNAVAILABLE',
  PERSISTENCE_UNAVAILABLE: 'GOVERNANCE_PERSISTENCE_UNAVAILABLE',
  CONFLICT: 'GOVERNANCE_CONFLICT',
});

const TERMINAL_REGULATORY_DECISIONS = new Set([
  'BLOCK',
  'DENY',
  'DENIED',
  'BLOCKED',
  'REJECT',
  'REJECTED',
]);

const REVIEW_REGULATORY_DECISIONS = new Set([
  'REVIEW',
  'REQUIRE_REVIEW',
  'PENDING',
  'NO_POLICY',
  'INDETERMINATE',
]);

const POSITIVE_REGULATORY_DECISIONS = new Set([
  'ALLOW',
  'PASS',
  'ALLOW_WITH_REPORTING',
]);

const UNSAFE_OFFLINE_STATES = new Set([
  OFFLINE_STATES.LOCAL_ONLY,
  OFFLINE_STATES.PENDING_SYNC,
  OFFLINE_STATES.SYNCING,
  OFFLINE_STATES.SERVER_REJECTED,
  OFFLINE_STATES.CONFLICT,
  OFFLINE_STATES.REQUIRES_REVIEW,
]);

const CONSEQUENT_FINANCIAL_IMPACTS = new Set([
  IMPACT_LEVELS.FINANCIAL,
  IMPACT_LEVELS.COLLECTION,
  IMPACT_LEVELS.DISBURSEMENT,
  IMPACT_LEVELS.REFUND,
  IMPACT_LEVELS.REVERSAL,
  IMPACT_LEVELS.SETTLEMENT,
]);

const HIGH_RISK_LEVELS = new Set([
  RISK_LEVELS.HIGH,
  RISK_LEVELS.CRITICAL,
]);

const AUTO_APPROVAL_SAFE_ACTIONS = new Set([
  'STATUS',
  'READ',
  'QUERY',
  'HEALTH_CHECK',
]);

const SECRET_KEY_PATTERN =
  /(password|passphrase|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|private.?key|api.?key|access.?key|credential|signature|provider.?payload|raw(request|response))/i;

const PROTOTYPE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  enforceAirtelProvider: true,
  requireOriginalIdempotencyForFinancialImpact: true,
  requireMakerCheckerForFinancialImpact: true,
  requireMakerCheckerForHighRisk: true,
  failClosedOnRegulatoryError: true,
  failClosedOnPolicyError: true,
  failClosedOnCriticalIntelligenceError: true,
  failClosedOnAuditError: true,
  requireConfirmedOfflineStateForExecution: true,
  autoApprovalAllowedForNonFinancialReadOnly: true,
  defaultRiskLevel: RISK_LEVELS.MEDIUM,
  maxTenantIdLength: 160,
  maxOperationLength: 120,
  maxReferenceLength: 240,
  maxReasonLength: 1200,
  maxMetadataDepth: 6,
  maxMetadataKeys: 80,
  maxMetadataArray: 100,
  maxMetadataString: 2000,
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

function normalizeString(value, maxLength = 240) {
  if (value === undefined || value === null) return undefined;

  const output = String(value).trim();

  if (!output) return undefined;

  if (output.length > maxLength) {
    return output.slice(0, maxLength);
  }

  return output;
}

function upper(value, maxLength = 120) {
  return normalizeString(value, maxLength)?.toUpperCase();
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}

function nowIso(clock) {
  const value =
    typeof clock === 'function'
      ? clock()
      : clock?.now?.() ?? Date.now();

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function stableNormalize(
  value,
  seen = new WeakSet(),
) {
  if (value === null) return null;
  if (value === undefined) return null;

  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }

  if (
    typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return String(value);
    }

    if (Object.is(value, -0)) {
      return 0;
    }

    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `base64:${value.toString('base64')}`;
  }

  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }

  if (
    typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return String(value);
  }

  if (seen.has(value)) {
    throw new AirtelDecisionGovernanceError(
      GOVERNANCE_ERROR_CODES.INVALID_INPUT,
      'Circular governance data is not supported.',
    );
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map(
      (item) =>
        stableNormalize(
          item,
          seen,
        ),
    );

    seen.delete(value);

    return result;
  }

  if (
    typeof value.toJSON === 'function'
    && !isPlainObject(value)
  ) {
    const result =
      stableNormalize(
        value.toJSON(),
        seen,
      );

    seen.delete(value);

    return result;
  }

  const result = {};

  for (
    const key of Object.keys(value).sort()
  ) {
    if (PROTOTYPE_KEYS.has(key)) {
      continue;
    }

    result[key] =
      stableNormalize(
        value[key],
        seen,
      );
  }

  seen.delete(value);

  return result;
}

function canonicalize(value) {
  return JSON.stringify(
    stableNormalize(value),
  );
}

function sha256(value) {
  return createHash('sha256')
    .update(canonicalize(value))
    .digest('hex');
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(value),
  );
}

function redact(
  value,
  path = '',
  depth = 0,
  config = DEFAULT_CONFIG,
) {
  if (
    depth > config.maxMetadataDepth
  ) {
    return '[TRUNCATED]';
  }

  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > config.maxMetadataString
      ? `${value.slice(0, config.maxMetadataString)}…`
      : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return '[BUFFER_REDACTED]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, config.maxMetadataArray)
      .map(
        (item, index) =>
          redact(
            item,
            `${path}[${index}]`,
            depth + 1,
            config,
          ),
      );
  }

  const out = {};

  const keys = Object.keys(value)
    .slice(0, config.maxMetadataKeys);

  for (const key of keys) {
    if (PROTOTYPE_KEYS.has(key)) {
      continue;
    }

    const childPath =
      path
        ? `${path}.${key}`
        : key;

    if (
      SECRET_KEY_PATTERN.test(key)
      || SECRET_KEY_PATTERN.test(childPath)
    ) {
      out[key] = '[REDACTED]';
      continue;
    }

    out[key] =
      redact(
        value[key],
        childPath,
        depth + 1,
        config,
      );
  }

  return out;
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    !value
    || typeof value !== 'object'
    || seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const child of Object.values(value)
  ) {
    deepFreeze(
      child,
      seen,
    );
  }

  return Object.freeze(value);
}

function getNestedDecision(result) {
  if (
    !result
    || typeof result !== 'object'
  ) {
    return undefined;
  }

  return upper(
    result.decision
      ?? result.outcome
      ?? result.status
      ?? result.complianceDecision
      ?? result.governanceDecision,
  );
}

function getRiskLevel(
  result,
  fallback = RISK_LEVELS.MEDIUM,
) {
  const candidate = upper(
    result?.riskLevel
      ?? result?.risk?.level
      ?? result?.risk?.riskLevel
      ?? result?.prediction?.riskLevel,
  );

  return Object.values(
    RISK_LEVELS,
  ).includes(candidate)
    ? candidate
    : fallback;
}

function getConfidence(result) {
  const value = finiteNumber(
    result?.confidence
      ?? result?.prediction?.confidence
      ?? result?.risk?.confidence,
  );

  if (value === null) {
    return null;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function normalizeActor(actor) {
  if (!actor) {
    return undefined;
  }

  if (!isPlainObject(actor)) {
    throw new AirtelDecisionGovernanceError(
      GOVERNANCE_ERROR_CODES.INVALID_INPUT,
      'actor must be an object.',
    );
  }

  const actorId =
    normalizeString(
      actor.actorId
        ?? actor.userId
        ?? actor.principalId
        ?? actor.id,
      160,
    );

  if (!actorId) {
    throw new AirtelDecisionGovernanceError(
      GOVERNANCE_ERROR_CODES.INVALID_INPUT,
      'actor.actorId is required when actor context is supplied.',
    );
  }

  return {
    actorId,
    role: upper(
      actor.role
        ?? actor.actorRole
        ?? actor.type,
      100,
    ),
    tenantId:
      normalizeString(
        actor.tenantId,
        160,
      ),
    source:
      normalizeString(
        actor.source
          ?? actor.authSource,
        120,
      ),
  };
}

function approvalRequiredForImpact(
  impactLevel,
  config,
) {
  const impact =
    upper(impactLevel)
    ?? IMPACT_LEVELS.NON_FINANCIAL;

  if (
    !CONSEQUENT_FINANCIAL_IMPACTS.has(
      impact,
    )
  ) {
    return false;
  }

  if (
    impact === IMPACT_LEVELS.REVERSAL
  ) {
    return config.requireMakerCheckerForFinancialImpact;
  }

  if (
    impact === IMPACT_LEVELS.REFUND
  ) {
    return config.requireMakerCheckerForFinancialImpact;
  }

  if (
    impact === IMPACT_LEVELS.DISBURSEMENT
  ) {
    return config.requireMakerCheckerForFinancialImpact;
  }

  if (
    impact === IMPACT_LEVELS.COLLECTION
  ) {
    return config.requireMakerCheckerForFinancialImpact;
  }

  if (
    impact === IMPACT_LEVELS.SETTLEMENT
  ) {
    return config.requireMakerCheckerForFinancialImpact;
  }

  return config.requireMakerCheckerForFinancialImpact;
}

function isReadOnlyOperation(
  operation,
) {
  return AUTO_APPROVAL_SAFE_ACTIONS.has(
    upper(operation),
  );
}

function normalizeApprovalState(value) {
  return upper(
    value,
    60,
  );
}

function safeError(error) {
  if (!error) {
    return null;
  }

  return {
    name:
      error.name
      || 'Error',

    code:
      error.code
      || null,

    message:
      normalizeString(
        error.message
          || 'Unknown error',
        400,
      ),

    retryable:
      Boolean(error.retryable),
  };
}

export class AirtelDecisionGovernanceError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(
      message,
      options,
    );

    this.name =
      'AirtelDecisionGovernanceError';

    this.code =
      code;

    this.component =
      COMPONENT;

    this.provider =
      PROVIDER;

    this.details =
      redact(details);

    this.retryable =
      Boolean(options.retryable);

    this.httpStatus =
      options.httpStatus ?? 400;

    this.expose =
      options.expose !== false;
  }
}

export const buildGovernanceScope = (
  input = {},
  config = DEFAULT_CONFIG,
) => {
  if (!isPlainObject(input)) {
    throw new AirtelDecisionGovernanceError(
      GOVERNANCE_ERROR_CODES.INVALID_INPUT,
      'Governance input must be an object.',
    );
  }

  const commandPlan =
    isPlainObject(
      input.commandPlan,
    )
      ? input.commandPlan
      : isPlainObject(input.plan)
        ? input.plan
        : {};

  const identity =
    isPlainObject(
      input.paymentIdentity,
    )
      ? input.paymentIdentity
      : isPlainObject(input.payment)
        ? input.payment
        : {};

  const tenantId =
    normalizeString(
      input.tenantId
        ?? commandPlan.tenantId
        ?? identity.tenantId,
      config.maxTenantIdLength,
    );

  const provider =
    upper(
      input.provider
        ?? commandPlan.provider
        ?? identity.provider
        ?? PROVIDER,
    );

  const operation =
    upper(
      input.operation
        ?? commandPlan.operation
        ?? commandPlan.operationType,
      config.maxOperationLength,
    );

  const originalIdempotencyKey =
    normalizeString(
      input.originalIdempotencyKey
        ?? identity.originalIdempotencyKey
        ?? identity.idempotencyKey
        ?? commandPlan.originalIdempotencyKey
        ?? commandPlan.idempotencyKey,
      240,
    );

  const impactLevel =
    upper(
      input.impactLevel
        ?? commandPlan.impactLevel
        ?? commandPlan.financialImpact
        ?? (
          input.isFinancialImpact
            ? IMPACT_LEVELS.FINANCIAL
            : undefined
        ),
    )
      ?? (
        isReadOnlyOperation(operation)
          ? IMPACT_LEVELS.NON_FINANCIAL
          : IMPACT_LEVELS.FINANCIAL
      );

  const amountMinor =
    input.amountMinor
      ?? identity.amountMinor
      ?? commandPlan.amountMinor;

  const currency =
    upper(
      input.currency
        ?? identity.currency
        ?? commandPlan.currency,
      20,
    );

  const offlineState =
    upper(
      input.offlineState
        ?? commandPlan.offlineState
        ?? identity.offlineState,
      80,
    );

  return {
    tenantId,

    provider,

    operation,

    operationType:
      upper(
        input.operationType
          ?? commandPlan.operationType,
        120,
      ),

    command:
      upper(
        input.command
          ?? commandPlan.command,
        120,
      ),

    action:
      upper(
        input.action
          ?? commandPlan.action,
        120,
      ),

    impactLevel,

    amountMinor:
      amountMinor === undefined
        ? undefined
        : String(amountMinor),

    currency,

    paymentId:
      normalizeString(
        input.paymentId
          ?? identity.paymentId,
        240,
      ),

    transactionId:
      normalizeString(
        input.transactionId
          ?? identity.transactionId,
        240,
      ),

    providerReference:
      normalizeString(
        input.providerReference
          ?? identity.providerReference
          ?? commandPlan.providerReference,
        240,
      ),

    originalIdempotencyKey,

    offlineState,

    riskLevel:
      getRiskLevel(
        input,
        config.defaultRiskLevel,
      ),

    jurisdiction:
      upper(
        input.jurisdiction
          ?? commandPlan.jurisdiction,
        120,
      ),

    country:
      upper(
        input.country
          ?? commandPlan.country,
        80,
      ),

    channel:
      upper(
        input.channel
          ?? commandPlan.channel,
        80,
      ),

    productType:
      normalizeString(
        input.productType
          ?? commandPlan.productType,
        120,
      ),

    decisionIdHint:
      normalizeString(
        input.decisionId,
        160,
      ),
  };
};

export const governanceFingerprint = (
  scope,
  intelligenceFingerprints = {},
) =>
  sha256({
    schemaVersion:
      SCHEMA_VERSION,

    provider:
      PROVIDER,

    scope,

    intelligence: {
      regulatory:
        intelligenceFingerprints.regulatory
        ?? null,

      policy:
        intelligenceFingerprints.policy
        ?? null,

      prediction:
        intelligenceFingerprints.prediction
        ?? null,

      recommendation:
        intelligenceFingerprints.recommendation
        ?? null,

      learning:
        intelligenceFingerprints.learning
        ?? null,

      risk:
        intelligenceFingerprints.risk
        ?? null,
    },
  });

export class AirtelDecisionGovernanceService {
  constructor(options = {}) {
    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,
        ...(options.config ?? {}),
      });

    this.regulatoryIntelligence =
      options.regulatoryIntelligence
      ?? options.regulatoryEngine
      ?? null;

    this.policyEngine =
      options.policyEngine
      ?? options.policy
      ?? null;

    this.predictionEngine =
      options.predictionEngine
      ?? null;

    this.recommendationEngine =
      options.recommendationEngine
      ?? null;

    this.providerLearningEngine =
      options.providerLearningEngine
      ?? null;

    this.riskEngine =
      options.riskEngine
      ?? null;

    this.approvalWorkflow =
      options.approvalWorkflow
      ?? options.workflow
      ?? null;

    this.audit =
      options.audit
      ?? options.auditLedger
      ?? null;

    this.logger =
      options.logger
      ?? null;

    this.metrics =
      options.metrics
      ?? null;

    this.clock =
      options.clock
      ?? {
        now: () => Date.now(),
      };

    this.idFactory =
      options.idFactory
      ?? (() => randomUUID());
  }

  _requireTenant(scope) {
    if (
      this.config.requireTenantId
      && !scope.tenantId
    ) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required for decision governance.',
        {},
        {
          httpStatus: 400,
        },
      );
    }

    return scope.tenantId;
  }

  _requireProvider(scope) {
    const provider =
      scope.provider
      ?? PROVIDER;

    if (
      this.config.enforceAirtelProvider
      && provider !== PROVIDER
    ) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'Decision governance is scoped to Airtel.',
        {
          provider,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return provider;
  }

  _requireOperation(scope) {
    if (!scope.operation) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.OPERATION_REQUIRED,
        'operation is required for decision governance.',
      );
    }

    return scope.operation;
  }

  _validateFinancialIdentity(scope) {
    if (
      !this.config.requireOriginalIdempotencyForFinancialImpact
    ) {
      return;
    }

    if (
      !CONSEQUENT_FINANCIAL_IMPACTS.has(
        scope.impactLevel,
      )
    ) {
      return;
    }

    if (
      !scope.originalIdempotencyKey
    ) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.IDEMPOTENCY_REQUIRED,
        'Financial-impact governance requires the original payment idempotency key.',
        {
          impactLevel:
            scope.impactLevel,
        },
        {
          httpStatus: 409,
        },
      );
    }
  }

  _offlineAssessment(scope) {
    if (!scope.offlineState) {
      return {
        safeForExecution: true,
        unresolved: false,
        state: null,
      };
    }

    const unresolved =
      UNSAFE_OFFLINE_STATES.has(
        scope.offlineState,
      );

    const confirmed =
      scope.offlineState
      === OFFLINE_STATES.CONFIRMED
      ||
      scope.offlineState
      === OFFLINE_STATES.SERVER_ACCEPTED;

    return {
      safeForExecution:
        !unresolved,

      unresolved,

      confirmed,

      state:
        scope.offlineState,
    };
  }

  _componentMethod(
    component,
    methods = [],
  ) {
    if (!component) {
      return null;
    }

    for (const method of methods) {
      if (
        typeof component[method]
        === 'function'
      ) {
        return component[method]
          .bind(component);
      }
    }

    return null;
  }

  async _callOptional(
    component,
    methods,
    payload,
    {
      name,
      failClosed = false,
    } = {},
  ) {
    const method =
      this._componentMethod(
        component,
        methods,
      );

    if (!method) {
      return {
        available: false,
        skipped: true,
        result: null,
        decision: null,
        fingerprint: null,
      };
    }

    try {
      const result =
        await method(payload);

      return {
        available: true,
        skipped: false,

        result:
          redact(
            result,
            '',
            0,
            this.config,
          ),

        decision:
          getNestedDecision(
            result,
          ),

        fingerprint:
          result?.decisionFingerprint
          ??
          result?.policyFingerprint
          ??
          result?.scopeFingerprint
          ??
          result?.fingerprint
          ??
          null,
      };
    } catch (error) {
      this._log(
        'error',
        `${name || 'governance'} component failed.`,
        {
          componentName:
            name,

          error:
            safeError(error),
        },
      );

      if (failClosed) {
        throw new AirtelDecisionGovernanceError(
          GOVERNANCE_ERROR_CODES.INTELLIGENCE_UNAVAILABLE,
          `${name || 'Governance'} component is unavailable; governance cannot safely continue.`,
          {
            componentName:
              name,
          },
          {
            retryable: true,
            httpStatus: 503,
            cause: error,
          },
        );
      }

      return {
        available: true,
        skipped: false,
        failed: true,
        result: null,
        decision: null,
        fingerprint: null,
        error:
          safeError(error),
      };
    }
  }

  async _evaluateRegulatory(
    input,
    scope,
  ) {
    if (!this.regulatoryIntelligence) {
      if (
        this.config.failClosedOnRegulatoryError
        &&
        CONSEQUENT_FINANCIAL_IMPACTS.has(
          scope.impactLevel,
        )
      ) {
        throw new AirtelDecisionGovernanceError(
          GOVERNANCE_ERROR_CODES.INTELLIGENCE_UNAVAILABLE,
          'Authoritative regulatory intelligence is not configured for a consequential financial governance decision.',
          {
            impactLevel:
              scope.impactLevel,
          },
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        available: false,
        decision: null,
        fingerprint: null,
        result: null,
      };
    }

    return this._callOptional(
      this.regulatoryIntelligence,
      [
        'evaluate',
        'analyze',
        'assess',
      ],
      {
        ...clone(input),

        tenantId:
          scope.tenantId,

        provider:
          PROVIDER,

        operation:
          scope.operation,

        jurisdiction:
          scope.jurisdiction,

        country:
          scope.country,

        channel:
          scope.channel,

        currency:
          scope.currency,

        productType:
          scope.productType,

        transaction:
          redact(
            input.transaction
              ?? input.paymentIdentity
              ?? {},
          ),
      },
      {
        name:
          'regulatoryIntelligence',

        failClosed:
          this.config.failClosedOnRegulatoryError
          &&
          CONSEQUENT_FINANCIAL_IMPACTS.has(
            scope.impactLevel,
          ),
      },
    );
  }

  async _evaluatePolicy(
    input,
    scope,
  ) {
    if (!this.policyEngine) {
      if (
        this.config.failClosedOnPolicyError
        &&
        CONSEQUENT_FINANCIAL_IMPACTS.has(
          scope.impactLevel,
        )
      ) {
        throw new AirtelDecisionGovernanceError(
          GOVERNANCE_ERROR_CODES.POLICY_UNAVAILABLE,
          'Decision governance policy engine is not configured for a consequential financial decision.',
          {
            impactLevel:
              scope.impactLevel,
          },
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        available: false,
        decision: null,
        fingerprint: null,
        result: null,
      };
    }

    return this._callOptional(
      this.policyEngine,
      [
        'evaluateGovernance',
        'evaluateDecision',
        'evaluate',
        'assess',
      ],
      {
        ...clone(input),

        tenantId:
          scope.tenantId,

        provider:
          PROVIDER,

        operation:
          scope.operation,

        impactLevel:
          scope.impactLevel,

        riskLevel:
          scope.riskLevel,
      },
      {
        name:
          'policyEngine',

        failClosed:
          this.config.failClosedOnPolicyError
          &&
          CONSEQUENT_FINANCIAL_IMPACTS.has(
            scope.impactLevel,
          ),
      },
    );
  }

  async _evaluatePrediction(
    input,
    scope,
  ) {
    return this._callOptional(
      this.predictionEngine,
      [
        'predict',
        'evaluate',
        'assess',
        'run',
      ],
      {
        ...clone(input),

        tenantId:
          scope.tenantId,

        provider:
          PROVIDER,

        operation:
          scope.operation,

        impactLevel:
          scope.impactLevel,
      },
      {
        name:
          'predictionEngine',

        failClosed:
          false,
      },
    );
  }

  async _evaluateRecommendation(
    input,
    scope,
  ) {
    return this._callOptional(
      this.recommendationEngine,
      [
        'recommend',
        'evaluate',
        'assess',
        'run',
      ],
      {
        ...clone(input),

        tenantId:
          scope.tenantId,

        provider:
          PROVIDER,

        operation:
          scope.operation,
      },
      {
        name:
          'recommendationEngine',

        failClosed:
          false,
      },
    );
  }

  async _evaluateLearning(
    input,
    scope,
  ) {
    return this._callOptional(
      this.providerLearningEngine,
      [
        'learn',
        'recommend',
        'evaluate',
        'assess',
        'predict',
        'run',
      ],
      {
        ...clone(input),

        tenantId:
          scope.tenantId,

        provider:
          PROVIDER,

        operation:
          scope.operation,
      },
      {
        name:
          'providerLearningEngine',

        failClosed:
          false,
      },
    );
  }

  async _evaluateRisk(
    input,
    scope,
  ) {
    return this._callOptional(
      this.riskEngine,
      [
        'evaluate',
        'assess',
        'score',
        'predict',
        'run',
      ],
      {
        ...clone(input),

        tenantId:
          scope.tenantId,

        provider:
          PROVIDER,

        operation:
          scope.operation,

        impactLevel:
          scope.impactLevel,
      },
      {
        name:
          'riskEngine',

        failClosed:
          this.config.failClosedOnCriticalIntelligenceError
          &&
          CONSEQUENT_FINANCIAL_IMPACTS.has(
            scope.impactLevel,
          ),
      },
    );
  }

  _consolidateDecision({
    scope,
    offline,
    regulatory,
    policy,
    prediction,
    recommendation,
    learning,
    risk,
  }) {
    const regulatoryDecision =
      regulatory.decision;

    const policyDecision =
      policy.decision;

    const riskLevel =
      getRiskLevel(
        risk.result
          ??
        prediction.result
          ??
        {},
        scope.riskLevel,
      );

    const predictionConfidence =
      getConfidence(
        prediction.result,
      );

    const riskConfidence =
      getConfidence(
        risk.result,
      );

    const confidenceCandidates = [
      predictionConfidence,
      riskConfidence,
    ].filter(
      (value) =>
        value !== null,
    );

    const confidence =
      confidenceCandidates.length
        ? Math.min(
          ...confidenceCandidates,
        )
        : null;

    const reasons = [];
    const controls = [];

    if (offline.unresolved) {
      reasons.push({
        code:
          'OFFLINE_STATE_UNRESOLVED',

        detail:
          offline.state,
      });
    }

    if (
      regulatoryDecision
      &&
      TERMINAL_REGULATORY_DECISIONS.has(
        regulatoryDecision,
      )
    ) {
      reasons.push({
        code:
          'REGULATORY_BLOCK',

        detail:
          regulatoryDecision,
      });
    }

    if (
      policyDecision
      &&
      TERMINAL_REGULATORY_DECISIONS.has(
        policyDecision,
      )
    ) {
      reasons.push({
        code:
          'POLICY_BLOCK',

        detail:
          policyDecision,
      });
    }

    if (
      regulatoryDecision
      &&
      REVIEW_REGULATORY_DECISIONS.has(
        regulatoryDecision,
      )
    ) {
      reasons.push({
        code:
          'REGULATORY_REVIEW_REQUIRED',

        detail:
          regulatoryDecision,
      });
    }

    if (
      policyDecision
      &&
      REVIEW_REGULATORY_DECISIONS.has(
        policyDecision,
      )
    ) {
      reasons.push({
        code:
          'POLICY_REVIEW_REQUIRED',

        detail:
          policyDecision,
      });
    }

    if (prediction?.failed) {
      reasons.push({
        code:
          'PREDICTION_UNAVAILABLE',
      });
    }

    if (risk?.failed) {
      reasons.push({
        code:
          'RISK_UNAVAILABLE',
      });
    }

    if (recommendation?.failed) {
      controls.push({
        code:
          'RECOMMENDATION_UNAVAILABLE',
      });
    }

    if (learning?.failed) {
      controls.push({
        code:
          'LEARNING_SIGNAL_UNAVAILABLE',
      });
    }

    if (HIGH_RISK_LEVELS.has(riskLevel)) {
      reasons.push({
        code:
          'HIGH_RISK_GOVERNANCE',

        detail:
          riskLevel,
      });
    }

    const regulatoryPositive =
      !regulatoryDecision
      ||
      POSITIVE_REGULATORY_DECISIONS.has(
        regulatoryDecision,
      );

    const policyPositive =
      !policyDecision
      ||
      POSITIVE_REGULATORY_DECISIONS.has(
        policyDecision,
      );

    if (!regulatoryPositive) {
      if (
        regulatoryDecision
        &&
        TERMINAL_REGULATORY_DECISIONS.has(
          regulatoryDecision,
        )
      ) {
        return {
          outcome:
            GOVERNANCE_OUTCOMES.BLOCK,

          executionState:
            EXECUTION_STATES.BLOCKED,

          approvalRequired:
            false,

          riskLevel,

          confidence,

          reasons,

          controls,
        };
      }
    }

    if (
      policyDecision
      &&
      TERMINAL_REGULATORY_DECISIONS.has(
        policyDecision,
      )
    ) {
      return {
        outcome:
          GOVERNANCE_OUTCOMES.BLOCK,

        executionState:
          EXECUTION_STATES.BLOCKED,

        approvalRequired:
          false,

        riskLevel,

        confidence,

        reasons,

        controls,
      };
    }

    if (offline.unresolved) {
      return {
        outcome:
          GOVERNANCE_OUTCOMES.REQUIRE_REVIEW,

        executionState:
          EXECUTION_STATES.REQUIRES_REVIEW,

        approvalRequired:
          false,

        riskLevel,

        confidence,

        reasons,

        controls,
      };
    }

    const financialImpact =
      CONSEQUENT_FINANCIAL_IMPACTS.has(
        scope.impactLevel,
      );

    const highRisk =
      HIGH_RISK_LEVELS.has(
        riskLevel,
      );

    const reviewSignal =
      reasons.some(
        (item) =>
          item.code.endsWith(
            'REVIEW_REQUIRED',
          ),
      )
      ||
      reasons.some(
        (item) =>
          item.code
          === 'PREDICTION_UNAVAILABLE'
          ||
          item.code
          === 'RISK_UNAVAILABLE',
      );

    const approvalRequired =
      (
        financialImpact
        &&
        this.config
          .requireMakerCheckerForFinancialImpact
      )
      ||
      (
        highRisk
        &&
        this.config
          .requireMakerCheckerForHighRisk
      )
      ||
      reviewSignal;

    if (approvalRequired) {
      return {
        outcome:
          reviewSignal
          && !financialImpact
          && !highRisk
            ? GOVERNANCE_OUTCOMES.REQUIRE_REVIEW
            : GOVERNANCE_OUTCOMES.REQUIRE_APPROVAL,

        executionState:
          reviewSignal
            ? EXECUTION_STATES.REQUIRES_REVIEW
            : EXECUTION_STATES.PENDING_APPROVAL,

        approvalRequired:
          true,

        riskLevel,

        confidence,

        reasons,

        controls,
      };
    }

    if (financialImpact) {
      return {
        outcome:
          GOVERNANCE_OUTCOMES.ALLOW_WITH_CONTROLS,

        executionState:
          EXECUTION_STATES.APPROVED,

        approvalRequired:
          false,

        riskLevel,

        confidence,

        reasons,

        controls: [
          ...controls,

          {
            code:
              'FINANCIAL_CORE_REMAINS_AUTHORITATIVE',
          },

          {
            code:
              'ORIGINAL_IDEMPOTENCY_KEY_MUST_BE_PRESERVED',
          },
        ],
      };
    }

    return {
      outcome:
        GOVERNANCE_OUTCOMES.ALLOW,

      executionState:
        EXECUTION_STATES.APPROVED,

      approvalRequired:
        false,

      riskLevel,

      confidence,

      reasons,

      controls,
    };
  }

  async evaluate(
    input = {},
    options = {},
  ) {
    let scope;

    try {
      scope =
        buildGovernanceScope(
          input,
          this.config,
        );

      this._requireTenant(
        scope,
      );

      this._requireProvider(
        scope,
      );

      this._requireOperation(
        scope,
      );

      this._validateFinancialIdentity(
        scope,
      );
    } catch (error) {
      const normalized =
        error
        instanceof
        AirtelDecisionGovernanceError
          ? error
          : new AirtelDecisionGovernanceError(
            GOVERNANCE_ERROR_CODES.INVALID_INPUT,
            error?.message
              || 'Invalid governance input.',
            {},
            {
              cause: error,
            },
          );

      throw normalized;
    }

    const offline =
      this._offlineAssessment(
        scope,
      );

    const [
      regulatory,
      policy,
      prediction,
      recommendation,
      learning,
      risk,
    ] =
      await Promise.all([
        this._evaluateRegulatory(
          input,
          scope,
        ),

        this._evaluatePolicy(
          input,
          scope,
        ),

        this._evaluatePrediction(
          input,
          scope,
        ),

        this._evaluateRecommendation(
          input,
          scope,
        ),

        this._evaluateLearning(
          input,
          scope,
        ),

        this._evaluateRisk(
          input,
          scope,
        ),
      ]);

    const intelligenceFingerprints = {
      regulatory:
        regulatory.fingerprint,

      policy:
        policy.fingerprint,

      prediction:
        prediction.fingerprint,

      recommendation:
        recommendation.fingerprint,

      learning:
        learning.fingerprint,

      risk:
        risk.fingerprint,
    };

    const fingerprint =
      governanceFingerprint(
        scope,
        intelligenceFingerprints,
      );

    const decisionId =
      scope.decisionIdHint
      ??
      fingerprint.slice(
        0,
        40,
      );

    const governance =
      this._consolidateDecision({
        scope,
        offline,
        regulatory,
        policy,
        prediction,
        recommendation,
        learning,
        risk,
      });

    const evaluatedAt =
      nowIso(
        this.clock,
      );

    const result = {
      success:
        true,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      evaluatedAt,

      decisionId,

      governanceFingerprint:
        fingerprint,

      tenantId:
        scope.tenantId,

      provider:
        PROVIDER,

      operation:
        scope.operation,

      operationType:
        scope.operationType,

      command:
        scope.command,

      action:
        scope.action,

      impactLevel:
        scope.impactLevel,

      riskLevel:
        governance.riskLevel,

      confidence:
        governance.confidence,

      outcome:
        governance.outcome,

      executionState:
        governance.executionState,

      approvalRequired:
        governance.approvalRequired,

      originalIdempotencyKey:
        scope.originalIdempotencyKey
        ?? null,

      scope:
        redact(
          scope,
          'scope',
          0,
          this.config,
        ),

      reasons:
        governance.reasons,

      controls:
        governance.controls,

      offline: {
        state:
          offline.state,

        unresolved:
          offline.unresolved,

        safeForExecution:
          offline.safeForExecution,

        confirmed:
          Boolean(
            offline.confirmed,
          ),
      },

      intelligence: {
        regulatory: {
          available:
            regulatory.available,

          decision:
            regulatory.decision,

          fingerprint:
            regulatory.fingerprint,

          summary:
            redact(
              regulatory.result
                ?.findingSummary
                ??
              regulatory.result
                ?.summary
                ??
              null,
              'regulatorySummary',
              0,
              this.config,
            ),
        },

        policy: {
          available:
            policy.available,

          decision:
            policy.decision,

          fingerprint:
            policy.fingerprint,

          summary:
            redact(
              policy.result
                ?.summary
                ??
              policy.result
                ?.findingSummary
                ??
              null,
              'policySummary',
              0,
              this.config,
            ),
        },

        prediction: {
          available:
            prediction.available,

          decision:
            prediction.decision,

          fingerprint:
            prediction.fingerprint,

          confidence:
            getConfidence(
              prediction.result,
            ),
        },

        recommendation: {
          available:
            recommendation.available,

          decision:
            recommendation.decision,

          fingerprint:
            recommendation.fingerprint,

          action:
            upper(
              recommendation.result
                ?.recommendedAction
                ??
              recommendation.result
                ?.action,
            ),
        },

        learning: {
          available:
            learning.available,

          decision:
            learning.decision,

          fingerprint:
            learning.fingerprint,
        },

        risk: {
          available:
            risk.available,

          decision:
            risk.decision,

          fingerprint:
            risk.fingerprint,

          level:
            getRiskLevel(
              risk.result,
              scope.riskLevel,
            ),

          confidence:
            getConfidence(
              risk.result,
            ),
        },
      },

      safety: {
        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        approvalGranted:
          false,

        executionAuthorized:
          false,

        authoritativeBoundary:
          'TITECH_FINANCIAL_CORE',
      },
    };

    if (options.audit !== false) {
      try {
        await this._audit(
          result.outcome
            === GOVERNANCE_OUTCOMES.BLOCK
            ? GOVERNANCE_EVENT_TYPES.BLOCKED
            : result.approvalRequired
              ? GOVERNANCE_EVENT_TYPES.APPROVAL_REQUIRED
              : result.outcome
                === GOVERNANCE_OUTCOMES.REQUIRE_REVIEW
                ? GOVERNANCE_EVENT_TYPES.REVIEW_REQUIRED
                : GOVERNANCE_EVENT_TYPES.EVALUATED,

          result,

          {
            idempotencyKey:
              `${
                scope.originalIdempotencyKey
                ?? `governance:${decisionId}`
              }:evaluation`,
          },
        );
      } catch (error) {
        if (
          this.config.failClosedOnAuditError
          &&
          CONSEQUENT_FINANCIAL_IMPACTS.has(
            scope.impactLevel,
          )
        ) {
          throw error;
        }
      }
    }

    this._metric(
      'governance_evaluated_total',
      {
        outcome:
          result.outcome,

        operation:
          result.operation,

        riskLevel:
          result.riskLevel,
      },
    );

    return deepFreeze(
      result,
    );
  }

  async govern(
    input = {},
    options = {},
  ) {
    return this.evaluate(
      input,
      options,
    );
  }

  async assess(
    input = {},
    options = {},
  ) {
    return this.evaluate(
      input,
      options,
    );
  }

  async requestApproval(
    input = {},
  ) {
    const evaluation =
      input.evaluation
      ??
      await this.evaluate(
        input,
        {
          audit: false,
        },
      );

    if (
      evaluation.outcome
      === GOVERNANCE_OUTCOMES.BLOCK
    ) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.REGULATORY_BLOCK,
        'A blocked governance decision cannot be submitted for approval.',
        {
          decisionId:
            evaluation.decisionId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      !evaluation.approvalRequired
    ) {
      return deepFreeze({
        success: true,
        requested: false,
        reason:
          'APPROVAL_NOT_REQUIRED',
        evaluation,
      });
    }

    const workflow =
      this.approvalWorkflow;

    const create =
      this._componentMethod(
        workflow,
        [
          'requestApproval',
          'create',
        ],
      );

    if (!create) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.APPROVAL_UNAVAILABLE,
        'An approval workflow is required to govern this consequential decision.',
        {
          decisionId:
            evaluation.decisionId,
        },
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const actor =
      normalizeActor(
        input.maker
          ?? input.actor,
      );

    const request = {
      ...clone(input),

      tenantId:
        evaluation.tenantId,

      provider:
        PROVIDER,

      operation:
        evaluation.operation,

      operationType:
        evaluation.scope.operationType,

      command:
        evaluation.scope.command,

      action:
        evaluation.scope.action,

      decision:
        evaluation.outcome,

      decisionId:
        evaluation.decisionId,

      impactLevel:
        evaluation.impactLevel,

      riskLevel:
        evaluation.riskLevel,

      paymentId:
        evaluation.scope.paymentId,

      transactionId:
        evaluation.scope.transactionId,

      providerReference:
        evaluation.scope.providerReference,

      originalIdempotencyKey:
        evaluation.originalIdempotencyKey,

      offlineState:
        evaluation.offline.state,

      amountMinor:
        evaluation.scope.amountMinor,

      currency:
        evaluation.scope.currency,

      reasonCode:
        evaluation.scope.reasonCode,

      jurisdiction:
        evaluation.scope.jurisdiction,

      country:
        evaluation.scope.country,

      channel:
        evaluation.scope.channel,

      productType:
        evaluation.scope.productType,

      maker:
        actor,

      actor,

      commandPlan: {
        ...(
          isPlainObject(
            input.commandPlan,
          )
            ? clone(
              input.commandPlan,
            )
            : {}
        ),

        tenantId:
          evaluation.tenantId,

        provider:
          PROVIDER,

        operation:
          evaluation.operation,

        impactLevel:
          evaluation.impactLevel,

        riskLevel:
          evaluation.riskLevel,

        offlineState:
          evaluation.offline.state,

        governanceDecision:
          evaluation.outcome,

        governanceFingerprint:
          evaluation.governanceFingerprint,

        decisionId:
          evaluation.decisionId,

        originalIdempotencyKey:
          evaluation.originalIdempotencyKey,
      },

      metadata: {
        ...(
          isPlainObject(
            input.metadata,
          )
            ? clone(
              input.metadata,
            )
            : {}
        ),

        governanceFingerprint:
          evaluation.governanceFingerprint,

        governanceOutcome:
          evaluation.outcome,

        governanceEngine:
          ENGINE_NAME,

        governanceEngineVersion:
          ENGINE_VERSION,
      },
    };

    let approval;

    try {
      approval =
        await create(
          request,
        );
    } catch (error) {
      this._log(
        'error',
        'Approval workflow request failed.',
        {
          error:
            safeError(error),
        },
      );

      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.APPROVAL_UNAVAILABLE,
        'Approval request could not be created.',
        {
          decisionId:
            evaluation.decisionId,
        },
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    }

    await this._audit(
      GOVERNANCE_EVENT_TYPES.APPROVAL_REQUESTED,
      evaluation,
      {
        idempotencyKey:
          `${
            evaluation.originalIdempotencyKey
            ?? `governance:${evaluation.decisionId}`
          }:approval-request`,

        extra: {
          approvalId:
            approval?.approvalId
            ?? approval?.id
            ?? null,

          approvalState:
            normalizeApprovalState(
              approval?.state,
            ),
        },
      },
    );

    this._metric(
      'governance_approval_requested_total',
      {
        operation:
          evaluation.operation,

        riskLevel:
          evaluation.riskLevel,
      },
    );

    return deepFreeze({
      success:
        true,

      requested:
        true,

      evaluation,

      approval:
        clone(approval),
    });
  }

  async submitApproval(
    input = {},
  ) {
    return this._transitionApproval(
      'submitForApproval',
      GOVERNANCE_EVENT_TYPES.APPROVAL_SUBMITTED,
      input,
    );
  }

  async approve(
    input = {},
  ) {
    return this._transitionApproval(
      'approveRequest',
      GOVERNANCE_EVENT_TYPES.APPROVAL_GRANTED,
      input,
    );
  }

  async reject(
    input = {},
  ) {
    return this._transitionApproval(
      'rejectRequest',
      GOVERNANCE_EVENT_TYPES.APPROVAL_REJECTED,
      input,
    );
  }

  async cancel(
    input = {},
  ) {
    return this._transitionApproval(
      'cancelRequest',
      GOVERNANCE_EVENT_TYPES.APPROVAL_CANCELLED,
      input,
    );
  }

  async expire(
    input = {},
  ) {
    return this._transitionApproval(
      'expire',
      GOVERNANCE_EVENT_TYPES.APPROVAL_EXPIRED,
      input,
    );
  }

  async _transitionApproval(
    methodName,
    eventType,
    input,
  ) {
    const workflow =
      this.approvalWorkflow;

    const method =
      this._componentMethod(
        workflow,
        [
          methodName,
          methodName.replace(
            /Request$/,
            '',
          ),
        ],
      );

    if (!method) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.APPROVAL_UNAVAILABLE,
        `Approval workflow does not expose ${methodName}.`,
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const evaluation =
      input.evaluation;

    const workflowInput =
      evaluation
        ? {
          ...clone(input),

          tenantId:
            evaluation.tenantId,

          provider:
            PROVIDER,

          operation:
            evaluation.scope.operation,

          operationType:
            evaluation.scope.operationType,

          command:
            evaluation.scope.command,

          action:
            evaluation.scope.action,

          decision:
            evaluation.outcome,

          impactLevel:
            evaluation.impactLevel,

          riskLevel:
            evaluation.riskLevel,

          paymentId:
            evaluation.scope.paymentId,

          transactionId:
            evaluation.scope.transactionId,

          originalIdempotencyKey:
            evaluation.originalIdempotencyKey,

          offlineState:
            evaluation.offline.state,

          amountMinor:
            evaluation.scope.amountMinor,

          currency:
            evaluation.scope.currency,

          reasonCode:
            evaluation.scope.reasonCode,

          jurisdiction:
            evaluation.scope.jurisdiction,

          country:
            evaluation.scope.country,

          channel:
            evaluation.scope.channel,

          productType:
            evaluation.scope.productType,

          governanceFingerprint:
            evaluation.governanceFingerprint,
        }
        : input;

    const result =
      await method(
        workflowInput,
      );

    const resolvedEvaluation =
      evaluation
      ?? {
        tenantId:
          input.tenantId,

        provider:
          PROVIDER,

        operation:
          input.operation,

        impactLevel:
          input.impactLevel,

        riskLevel:
          input.riskLevel,

        decisionId:
          input.decisionId
          ?? input.approvalId,

        governanceFingerprint:
          input.scopeFingerprint
          ?? input.governanceFingerprint,

        originalIdempotencyKey:
          input.originalIdempotencyKey,

        outcome:
          result?.decision
          ?? result?.state
          ?? null,

        intelligence: {
          policy: {},
          prediction: {},
          risk: {},
          recommendation: {},
          learning: {},
          regulatory: {},
        },

        offline: {
          state:
            input.offlineState
            ?? null,
        },
      };

    await this._audit(
      eventType,
      resolvedEvaluation,
      {
        idempotencyKey:
          `${
            input.originalIdempotencyKey
            ?? `approval:${input.approvalId ?? resolvedEvaluation.decisionId}`
          }:${eventType.toLowerCase()}`,

        extra: {
          approvalId:
            result?.approvalId
            ?? input.approvalId
            ?? null,

          approvalState:
            normalizeApprovalState(
              result?.state,
            ),

          actor:
            normalizeActor(
              input.actor
                ?? input.checker
                ?? input.executor,
            ),
        },
      },
    );

    return deepFreeze({
      success:
        true,

      result:
        clone(result),
    });
  }

  async verifyForExecution(
    input = {},
  ) {
    const evaluation =
      input.evaluation
      ??
      await this.evaluate(
        input,
        {
          audit: false,
        },
      );

    if (
      evaluation.outcome
      === GOVERNANCE_OUTCOMES.BLOCK
    ) {
      return deepFreeze({
        authorized:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.BLOCK,

        executionState:
          EXECUTION_STATES.BLOCKED,

        reason:
          'GOVERNANCE_BLOCKED',

        decisionId:
          evaluation.decisionId,

        governanceFingerprint:
          evaluation.governanceFingerprint,
      });
    }

    if (
      evaluation.offline.unresolved
    ) {
      return deepFreeze({
        authorized:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.REQUIRE_REVIEW,

        executionState:
          EXECUTION_STATES.REQUIRES_REVIEW,

        reason:
          'OFFLINE_STATE_UNRESOLVED',

        offlineState:
          evaluation.offline.state,

        decisionId:
          evaluation.decisionId,
      });
    }

    if (
      !evaluation.approvalRequired
    ) {
      if (
        this.config
          .requireConfirmedOfflineStateForExecution
        &&
        evaluation.offline.state
        &&
        evaluation.offline.state
          !== OFFLINE_STATES.CONFIRMED
        &&
        !isReadOnlyOperation(
          evaluation.operation,
        )
      ) {
        return deepFreeze({
          authorized:
            false,

          outcome:
            GOVERNANCE_OUTCOMES.REQUIRE_REVIEW,

          executionState:
            EXECUTION_STATES.REQUIRES_REVIEW,

          reason:
            'OFFLINE_CONFIRMATION_REQUIRED',

          decisionId:
            evaluation.decisionId,
        });
      }

      const authorization = {
        authorized:
          true,

        outcome:
          GOVERNANCE_OUTCOMES.ALLOW_WITH_CONTROLS,

        executionState:
          EXECUTION_STATES.AUTHORIZED,

        decisionId:
          evaluation.decisionId,

        tenantId:
          evaluation.tenantId,

        provider:
          PROVIDER,

        operation:
          evaluation.operation,

        governanceFingerprint:
          evaluation.governanceFingerprint,

        originalIdempotencyKey:
          evaluation.originalIdempotencyKey,

        safety: {
          preserveOriginalIdempotencyKey:
            true,

          financialMutationPerformed:
            false,

          ledgerMutationPerformed:
            false,

          providerCallPerformed:
            false,

          authoritativeBoundary:
            'TITECH_FINANCIAL_CORE',
        },
      };

      await this._audit(
        GOVERNANCE_EVENT_TYPES.EXECUTION_VERIFIED,
        evaluation,
        {
          idempotencyKey:
            `${
              evaluation.originalIdempotencyKey
              ?? `governance:${evaluation.decisionId}`
            }:execution-verified`,
        },
      );

      return deepFreeze(
        authorization,
      );
    }

    const workflow =
      this.approvalWorkflow;

    const verifier =
      this._componentMethod(
        workflow,
        [
          'verifyForExecution',
          'verifyApproval',
          'buildExecutionAuthorization',
        ],
      );

    if (!verifier) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.APPROVAL_UNAVAILABLE,
        'Approval workflow execution verification is unavailable.',
        {
          decisionId:
            evaluation.decisionId,
        },
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const verification =
      await verifier({
        ...clone(input),

        tenantId:
          evaluation.tenantId,

        provider:
          PROVIDER,

        operation:
          evaluation.operation,

        operationType:
          evaluation.scope.operationType,

        command:
          evaluation.scope.command,

        action:
          evaluation.scope.action,

        decision:
          evaluation.outcome,

        impactLevel:
          evaluation.impactLevel,

        riskLevel:
          evaluation.riskLevel,

        decisionId:
          evaluation.decisionId,

        paymentId:
          evaluation.scope.paymentId,

        transactionId:
          evaluation.scope.transactionId,

        originalIdempotencyKey:
          evaluation.originalIdempotencyKey,

        offlineState:
          evaluation.offline.state,

        amountMinor:
          evaluation.scope.amountMinor,

        currency:
          evaluation.scope.currency,

        reasonCode:
          evaluation.scope.reasonCode,

        jurisdiction:
          evaluation.scope.jurisdiction,

        country:
          evaluation.scope.country,

        channel:
          evaluation.scope.channel,

        productType:
          evaluation.scope.productType,

        governanceFingerprint:
          evaluation.governanceFingerprint,

        regulatoryDecision:
          evaluation.intelligence
            .regulatory
            .decision,

        commandPlan: {
          ...(
            isPlainObject(
              input.commandPlan,
            )
              ? clone(
                input.commandPlan,
              )
              : {}
          ),

          tenantId:
            evaluation.tenantId,

          provider:
            PROVIDER,

          operation:
            evaluation.operation,

          operationType:
            evaluation.scope.operationType,

          command:
            evaluation.scope.command,

          action:
            evaluation.scope.action,

          decision:
            evaluation.outcome,

          impactLevel:
            evaluation.impactLevel,

          riskLevel:
            evaluation.riskLevel,

          paymentId:
            evaluation.scope.paymentId,

          transactionId:
            evaluation.scope.transactionId,

          originalIdempotencyKey:
            evaluation.originalIdempotencyKey,

          offlineState:
            evaluation.offline.state,

          amountMinor:
            evaluation.scope.amountMinor,

          currency:
            evaluation.scope.currency,

          reasonCode:
            evaluation.scope.reasonCode,

          jurisdiction:
            evaluation.scope.jurisdiction,

          country:
            evaluation.scope.country,

          channel:
            evaluation.scope.channel,

          productType:
            evaluation.scope.productType,

          governanceFingerprint:
            evaluation.governanceFingerprint,

          decisionId:
            evaluation.decisionId,

          regulatoryDecision:
            evaluation.intelligence
              .regulatory
              .decision,
        },
      });

    const authorized =
      Boolean(
        verification?.authorized
        ??
        verification?.executable
        ??
        (
          verification?.outcome
          === 'APPROVED'
          &&
          verification?.state
          === 'APPROVED'
        ),
      );

    const normalized = {
      authorized,

      outcome:
        authorized
          ? GOVERNANCE_OUTCOMES.ALLOW_WITH_CONTROLS
          : verification?.outcome
            ?? GOVERNANCE_OUTCOMES.STALE,

      executionState:
        authorized
          ? EXECUTION_STATES.AUTHORIZED
          : EXECUTION_STATES.STALE,

      decisionId:
        evaluation.decisionId,

      tenantId:
        evaluation.tenantId,

      provider:
        PROVIDER,

      operation:
        evaluation.operation,

      governanceFingerprint:
        evaluation.governanceFingerprint,

      verification:
        redact(
          verification,
          'verification',
          0,
          this.config,
        ),

      originalIdempotencyKey:
        evaluation.originalIdempotencyKey,

      safety: {
        preserveOriginalIdempotencyKey:
          true,

        generateNewFinancialIdentity:
          false,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        authoritativeBoundary:
          'TITECH_FINANCIAL_CORE',
      },
    };

    await this._audit(
      authorized
        ? GOVERNANCE_EVENT_TYPES.EXECUTION_VERIFIED
        : verification?.outcome
          === 'EXPIRED'
          ? GOVERNANCE_EVENT_TYPES.APPROVAL_EXPIRED
          : verification?.outcome
            === 'STALE'
            ? GOVERNANCE_EVENT_TYPES.STALE
            : GOVERNANCE_EVENT_TYPES.CONFLICT,

      evaluation,

      {
        idempotencyKey:
          `${
            evaluation.originalIdempotencyKey
            ?? `governance:${evaluation.decisionId}`
          }:execution-verification`,

        extra: {
          authorized,

          verificationOutcome:
            verification?.outcome
            ?? null,

          approvalId:
            verification?.approvalId
            ?? input.approvalId
            ?? null,
        },
      },
    );

    if (!authorized) {
      this._metric(
        'governance_execution_denied_total',
        {
          reason:
            verification?.outcome
            ?? 'UNKNOWN',
        },
      );
    }

    return deepFreeze(
      normalized,
    );
  }

  async consumeApproval(
    input = {},
  ) {
    const workflow =
      this.approvalWorkflow;

    const consume =
      this._componentMethod(
        workflow,
        ['consume'],
      );

    if (!consume) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.APPROVAL_UNAVAILABLE,
        'Approval workflow consume operation is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const evaluation =
      input.evaluation
      ??
      await this.evaluate(
        input,
        {
          audit: false,
        },
      );

    const verification =
      await this.verifyForExecution({
        ...clone(input),
        evaluation,
      });

    if (
      !verification.authorized
    ) {
      throw new AirtelDecisionGovernanceError(
        verification.executionState
          === EXECUTION_STATES.STALE
          ? GOVERNANCE_ERROR_CODES.APPROVAL_STALE
          : GOVERNANCE_ERROR_CODES.EXECUTION_NOT_AUTHORIZED,

        'Execution authorization is not valid for consumption.',

        {
          decisionId:
            evaluation.decisionId,

          verification,
        },

        {
          httpStatus: 409,
        },
      );
    }

    const result =
      await consume({
        ...clone(input),

        tenantId:
          evaluation.tenantId,

        provider:
          PROVIDER,

        operation:
          evaluation.operation,

        impactLevel:
          evaluation.impactLevel,

        riskLevel:
          evaluation.riskLevel,

        decisionId:
          evaluation.decisionId,

        scopeFingerprint:
          evaluation.governanceFingerprint,

        governanceFingerprint:
          evaluation.governanceFingerprint,

        originalIdempotencyKey:
          evaluation.originalIdempotencyKey,

        offlineState:
          evaluation.offline.state,

        commandPlan: {
          ...(
            isPlainObject(
              input.commandPlan,
            )
              ? clone(
                input.commandPlan,
              )
              : {}
          ),

          tenantId:
            evaluation.tenantId,

          provider:
            PROVIDER,

          operation:
            evaluation.operation,

          impactLevel:
            evaluation.impactLevel,

          governanceFingerprint:
            evaluation.governanceFingerprint,

          decisionId:
            evaluation.decisionId,

          originalIdempotencyKey:
            evaluation.originalIdempotencyKey,
        },
      });

    await this._audit(
      GOVERNANCE_EVENT_TYPES.EXECUTION_CONSUMED,
      evaluation,
      {
        idempotencyKey:
          `${
            evaluation.originalIdempotencyKey
            ?? `governance:${evaluation.decisionId}`
          }:execution-consumed`,

        extra: {
          approvalId:
            result?.approvalId
            ?? input.approvalId
            ?? null,

          state:
            normalizeApprovalState(
              result?.state,
            ),
        },
      },
    );

    return deepFreeze({
      success:
        true,

      consumed:
        true,

      decisionId:
        evaluation.decisionId,

      governanceFingerprint:
        evaluation.governanceFingerprint,

      result:
        clone(result),
    });
  }

  buildExecutionContext(
    evaluation,
    authorization = {},
  ) {
    if (
      !evaluation
      || typeof evaluation !== 'object'
    ) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.INVALID_INPUT,
        'evaluation is required.',
      );
    }

    if (
      !authorization?.authorized
    ) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.EXECUTION_NOT_AUTHORIZED,
        'Execution context cannot be built without an authorization result.',
        {
          decisionId:
            evaluation.decisionId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return deepFreeze({
      authorized:
        true,

      tenantId:
        evaluation.tenantId,

      provider:
        PROVIDER,

      operation:
        evaluation.operation,

      impactLevel:
        evaluation.impactLevel,

      decisionId:
        evaluation.decisionId,

      governanceFingerprint:
        evaluation.governanceFingerprint,

      originalIdempotencyKey:
        evaluation.originalIdempotencyKey,

      commandPlan:
        redact(
          {
            ...evaluation.scope,

            governanceFingerprint:
              evaluation.governanceFingerprint,

            decisionId:
              evaluation.decisionId,

            originalIdempotencyKey:
              evaluation.originalIdempotencyKey,
          },
          'commandPlan',
          0,
          this.config,
        ),

      financialSafety: {
        mustPreserveOriginalIdempotencyKey:
          true,

        mustNotGenerateNewFinancialIdentity:
          true,

        mustNotPostLedgerHere:
          true,

        mustNotMutateBalanceHere:
          true,

        mustRouteThroughFinancialCore:
          true,
      },
    });
  }

  async _audit(
    eventType,
    evaluation,
    options = {},
  ) {
    const audit =
      this.audit;

    if (!audit) {
      if (
        this.config.failClosedOnAuditError
        &&
        CONSEQUENT_FINANCIAL_IMPACTS.has(
          evaluation?.impactLevel,
        )
      ) {
        throw new AirtelDecisionGovernanceError(
          GOVERNANCE_ERROR_CODES.AUDIT_UNAVAILABLE,
          'Decision audit ledger is unavailable for a consequential governance operation.',
          {
            decisionId:
              evaluation?.decisionId,
          },
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return null;
    }

    const method =
      this._componentMethod(
        audit,
        [
          'recordDecisionEvent',
          'append',
          'recordDecision',
          'record',
          'write',
        ],
      );

    if (!method) {
      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.AUDIT_UNAVAILABLE,
        'Decision audit ledger does not expose a supported write method.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const event = {
      tenantId:
        evaluation.tenantId,

      decisionId:
        evaluation.decisionId,

      eventType,

      eventId:
        this.idFactory(),

      stage:
        eventType.startsWith(
          'GOVERNANCE_APPROVAL',
        )
          ? 'APPROVAL'
          : eventType.includes(
            'EXECUTION',
          )
            ? 'EXECUTION_GOVERNANCE'
            : 'GOVERNANCE',

      outcome:
        evaluation.outcome,

      reasonCode:
        evaluation.reasons
          ?.[0]
          ?.code,

      provider: {
        code:
          PROVIDER,

        operation:
          evaluation.operation,
      },

      actor:
        normalizeActor(
          options.actor
            ?? evaluation.actor,
        ),

      request: {
        requestId:
          normalizeString(
            evaluation.requestId,
            200,
          ),

        correlationId:
          normalizeString(
            evaluation.correlationId,
            200,
          ),

        traceId:
          normalizeString(
            evaluation.traceId,
            200,
          ),

        idempotencyKey:
          normalizeString(
            options.idempotencyKey
              ??
              `${
                evaluation.originalIdempotencyKey
                ?? `governance:${evaluation.decisionId}`
              }:${eventType.toLowerCase()}`,
            300,
          ),

        source:
          ENGINE_NAME,
      },

      policy: {
        decision:
          evaluation.intelligence
            ?.policy
            ?.decision
          ?? null,

        fingerprint:
          evaluation.intelligence
            ?.policy
            ?.fingerprint
          ?? null,
      },

      model: {
        predictionFingerprint:
          evaluation.intelligence
            ?.prediction
            ?.fingerprint
          ?? null,

        riskFingerprint:
          evaluation.intelligence
            ?.risk
            ?.fingerprint
          ?? null,

        recommendationFingerprint:
          evaluation.intelligence
            ?.recommendation
            ?.fingerprint
          ?? null,

        learningFingerprint:
          evaluation.intelligence
            ?.learning
            ?.fingerprint
          ?? null,
      },

      decision: {
        action:
          evaluation.action
          ?? null,

        outcome:
          evaluation.outcome,

        confidence:
          evaluation.confidence
          === null
            ? undefined
            : evaluation.confidence,

        decisionVersion:
          ENGINE_VERSION,

        subjectType:
          evaluation.impactLevel,

        subjectId:
          evaluation.decisionId,
      },

      inputHash:
        evaluation.governanceFingerprint,

      outputHash:
        sha256({
          outcome:
            evaluation.outcome,

          executionState:
            evaluation.executionState,

          approvalRequired:
            evaluation.approvalRequired,

          reasons:
            evaluation.reasons,
        }),

      metadata: {
        governanceFingerprint:
          evaluation.governanceFingerprint,

        impactLevel:
          evaluation.impactLevel,

        riskLevel:
          evaluation.riskLevel,

        offlineState:
          evaluation.offline?.state
          ?? null,

        extra:
          redact(
            options.extra
              ?? {},
            'extra',
            0,
            this.config,
          ),
      },
    };

    try {
      const result =
        await method(event);

      return result;
    } catch (error) {
      this._log(
        'error',
        'Decision governance audit write failed.',
        {
          eventType,

          decisionId:
            evaluation?.decisionId,

          error:
            safeError(error),
        },
      );

      throw new AirtelDecisionGovernanceError(
        GOVERNANCE_ERROR_CODES.AUDIT_UNAVAILABLE,
        'Decision governance audit persistence failed; consequential governance cannot safely continue.',
        {
          eventType,

          decisionId:
            evaluation?.decisionId,
        },
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    }
  }

  _log(
    level,
    message,
    context = {},
  ) {
    const method =
      this.logger?.[level]
      ?? this.logger?.info;

    if (
      typeof method
      !== 'function'
    ) {
      return;
    }

    try {
      method.call(
        this.logger,

        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          ...redact(
            context,
            '',
            0,
            this.config,
          ),
        },

        message,
      );
    } catch {
      // Logging must never affect the governance path.
    }
  }

  _metric(
    name,
    labels = {},
  ) {
    try {
      const metric =
        this.metrics?.[name]
        ??
        this.metrics?.increment
        ??
        this.metrics?.counter;

      if (
        typeof metric
        !== 'function'
      ) {
        return;
      }

      if (
        metric
        === this.metrics.increment
        ||
        metric
        === this.metrics.counter
      ) {
        metric.call(
          this.metrics,
          name,
          redact(
            labels,
            '',
            0,
            this.config,
          ),
        );
      } else {
        metric.call(
          this.metrics,
          redact(
            labels,
            '',
            0,
            this.config,
          ),
        );
      }
    } catch {
      // Metrics must never affect governance decisions.
    }
  }

  async health() {
    const dependencies = {
      regulatoryIntelligence:
        Boolean(
          this.regulatoryIntelligence,
        ),

      policyEngine:
        Boolean(
          this.policyEngine,
        ),

      predictionEngine:
        Boolean(
          this.predictionEngine,
        ),

      recommendationEngine:
        Boolean(
          this.recommendationEngine,
        ),

      providerLearningEngine:
        Boolean(
          this.providerLearningEngine,
        ),

      riskEngine:
        Boolean(
          this.riskEngine,
        ),

      approvalWorkflow:
        Boolean(
          this.approvalWorkflow,
        ),

      audit:
        Boolean(
          this.audit,
        ),
    };

    const checks = {};

    for (
      const [name, component]
      of Object.entries({
        regulatoryIntelligence:
          this.regulatoryIntelligence,

        policyEngine:
          this.policyEngine,

        approvalWorkflow:
          this.approvalWorkflow,

        audit:
          this.audit,
      })
    ) {
      const method =
        this._componentMethod(
          component,
          [
            'health',
            'healthCheck',
            'ready',
            'readiness',
          ],
        );

      if (!method) {
        continue;
      }

      try {
        checks[name] =
          redact(
            await method(),
            name,
            0,
            this.config,
          );
      } catch (error) {
        checks[name] = {
          ok: false,

          error:
            safeError(error),
        };
      }
    }

    const criticalDependenciesConfigured =
      Boolean(
        this.approvalWorkflow
        &&
        this.audit,
      );

    const dependencyChecksHealthy =
      Object.values(checks)
        .every(
          (item) =>
            item?.ok !== false,
        );

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      healthy:
        criticalDependenciesConfigured
        &&
        dependencyChecksHealthy,

      productionSafeDefaults: {
        tenantRequired:
          this.config
            .requireTenantId,

        airtelProviderEnforced:
          this.config
            .enforceAirtelProvider,

        failClosedOnRegulatoryError:
          this.config
            .failClosedOnRegulatoryError,

        failClosedOnPolicyError:
          this.config
            .failClosedOnPolicyError,

        failClosedOnAuditError:
          this.config
            .failClosedOnAuditError,

        makerCheckerForFinancialImpact:
          this.config
            .requireMakerCheckerForFinancialImpact,

        originalIdempotencyRequired:
          this.config
            .requireOriginalIdempotencyForFinancialImpact,
      },

      dependencies,

      checks,
    });
  }

  async readiness() {
    return this.health();
  }

  getComponentInfo() {
    return Object.freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      responsibility:
        'Airtel decision governance orchestration',

      authoritativeFinancialBoundary:
        'TITECH_FINANCIAL_CORE',

      writesFinancialLedger:
        false,

      callsProviderAPIs:
        false,
    });
  }
}

export function createDecisionGovernanceService(
  options = {},
) {
  return new AirtelDecisionGovernanceService(
    options,
  );
}

export const createAirtelDecisionGovernanceService =
  createDecisionGovernanceService;

export const AirtelPaymentDecisionGovernanceService =
  AirtelDecisionGovernanceService;

export default AirtelDecisionGovernanceService;