'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Approval Workflow
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/governance/approvalWorkflow.js
 *
 * Purpose:
 *   Enterprise maker-checker governance for Airtel payment operations and other
 *   financially consequential command-center plans. The workflow creates,
 *   validates, approves, rejects, cancels and verifies approval decisions while
 *   enforcing tenant isolation, scope integrity, separation of duties,
 *   expiry/replay protection and immutable approval evidence.
 *
 * Responsibilities:
 *   - Define approval states, actions and governance outcomes.
 *   - Normalize and validate approval requests and actors.
 *   - Generate a deterministic scope fingerprint for the exact operation being
 *     approved so approvals cannot be silently reused for a changed plan.
 *   - Enforce maker-checker separation of duties by default.
 *   - Enforce tenant/provider/operation/financial-impact boundaries.
 *   - Support TTL/expiry and approval replay protection.
 *   - Delegate persistence, atomic compare-and-set transitions and audit storage
 *     to injected repositories/adapters.
 *   - Provide execution-time verification for command-center / Financial Core
 *     callers before an approved operation is dispatched.
 *
 * Non-responsibilities:
 *   - No direct MongoDB writes.
 *   - No direct provider API calls.
 *   - No wallet, balance, transaction, journal or ledger mutation.
 *   - No Financial Core posting.
 *   - No credential, OTP, PIN or secret storage.
 *   - No replacement for KYC/AML, fraud, sanctions or regulatory policy engines.
 *   - No assumption that local/offline state is final settlement.
 *
 * Financial safety principles:
 *   1. Approval is scoped to an immutable operation fingerprint.
 *   2. The maker and checker must be different principals by default.
 *   3. Approval must be tenant-scoped and provider-scoped.
 *   4. Approval cannot override a regulatory BLOCK or an unresolved conflict.
 *   5. Expired, rejected, cancelled, superseded or already-consumed approvals
 *      cannot be reused.
 *   6. A successful approval does not itself execute a financial transaction.
 *   7. Execution must preserve original financial identity/idempotency semantics.
 *   8. Persistence adapters must implement atomic state transitions.
 *   9. Approval evidence is auditable without storing secrets or sensitive raw
 *      provider payloads.
 *
 * Module format:
 *   ESM-compatible. This file intentionally has no static project-internal
 *   imports so it can be introduced without creating circular dependency risk.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const ENGINE_NAME = 'airtel-payment-approval-workflow';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';

export const APPROVAL_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  SUPERSEDED: 'SUPERSEDED',
  CONSUMED: 'CONSUMED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
});

export const APPROVAL_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL',
  EXPIRE: 'EXPIRE',
  SUPERSEDE: 'SUPERSEDE',
  CONSUME: 'CONSUME',
  MARK_EXECUTION_FAILED: 'MARK_EXECUTION_FAILED',
});

export const APPROVAL_DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  BLOCK: 'BLOCK',
});

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const IMPACT_LEVELS = Object.freeze({
  NON_FINANCIAL: 'NON_FINANCIAL',
  FINANCIAL: 'FINANCIAL',
  SETTLEMENT: 'SETTLEMENT',
  REVERSAL: 'REVERSAL',
  REFUND: 'REFUND',
  DISBURSEMENT: 'DISBURSEMENT',
  COLLECTION: 'COLLECTION',
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

export const GOVERNANCE_OUTCOMES = Object.freeze({
  READY: 'READY',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  BLOCKED: 'BLOCKED',
  EXPIRED: 'EXPIRED',
  INVALID: 'INVALID',
  REPLAY: 'REPLAY',
  STALE: 'STALE',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [APPROVAL_STATES.DRAFT]: new Set([
    APPROVAL_STATES.PENDING,
    APPROVAL_STATES.CANCELLED,
  ]),

  [APPROVAL_STATES.PENDING]: new Set([
    APPROVAL_STATES.APPROVED,
    APPROVAL_STATES.REJECTED,
    APPROVAL_STATES.CANCELLED,
    APPROVAL_STATES.EXPIRED,
    APPROVAL_STATES.SUPERSEDED,
  ]),

  [APPROVAL_STATES.APPROVED]: new Set([
    APPROVAL_STATES.CONSUMED,
    APPROVAL_STATES.EXECUTION_FAILED,
    APPROVAL_STATES.CANCELLED,
    APPROVAL_STATES.SUPERSEDED,
  ]),

  [APPROVAL_STATES.REJECTED]: new Set([]),
  [APPROVAL_STATES.CANCELLED]: new Set([]),
  [APPROVAL_STATES.EXPIRED]: new Set([]),
  [APPROVAL_STATES.SUPERSEDED]: new Set([]),
  [APPROVAL_STATES.CONSUMED]: new Set([]),
  [APPROVAL_STATES.EXECUTION_FAILED]: new Set([]),
});

const DEFAULTS = Object.freeze({
  requireTenantId: true,
  enforceAirtelProvider: true,

  requireMakerCheckerForFinancialImpact: true,
  requireMakerCheckerForReversal: true,
  requireMakerCheckerForRefund: true,
  requireMakerCheckerForDisbursement: true,
  requireMakerCheckerForSettlement: true,

  requireOriginalIdempotencyKeyForFinancialImpact: true,

  defaultTtlMs: 15 * 60 * 1000,
  minTtlMs: 30 * 1000,
  maxTtlMs: 24 * 60 * 60 * 1000,

  maxCommentLength: 2000,
  maxActorIdLength: 160,
  maxTenantIdLength: 160,
  maxApprovalIdLength: 160,
  maxReferenceLength: 240,

  requireApprovalReason: true,
  requireRejectionReason: true,
  requireCancellationReason: true,
  requireRejectionComment: false,

  failClosedOnPersistenceError: true,
  failClosedOnPolicyError: true,
});

const SECRET_FIELD_PATTERN =
  /(password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|card(number)?|private.?key|access.?key|api.?key|signature|credential|raw(request|response)|provider.?payload)/i;

const SENSITIVE_PATH_PATTERN =
  /(request|response)\.(body|payload|headers|raw)|(^|\.)(authorization|cookie|token|secret|password|pin|otp|cvv|pan)$/i;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeString = (value, maxLength = 240) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
};

const upper = (value) =>
  normalizeString(value, 80)?.toUpperCase();

const stableSerialize = (value) => {
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'bigint') {
    return `bigint:${value.toString()}`;
  }

  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableSerialize(value[key])}`,
      )
      .join(',')}}`;
  }

  if (typeof value === 'number' && Object.is(value, -0)) {
    return '0';
  }

  return JSON.stringify(value);
};

const sha256 = (value) =>
  createHash('sha256')
    .update(stableSerialize(value))
    .digest('hex');

const clone = (value) => {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
};

const sanitizeObject = (
  value,
  path = '',
  depth = 0,
  limits = {},
) => {
  const maxDepth = limits.maxDepth ?? 6;
  const maxKeys = limits.maxKeys ?? 80;
  const maxArray = limits.maxArray ?? 100;
  const maxStringLength = limits.maxStringLength ?? 2000;

  if (depth > maxDepth) {
    return '[TRUNCATED]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > maxStringLength
      ? `${value.slice(0, maxStringLength)}…`
      : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArray)
      .map((item, index) =>
        sanitizeObject(
          item,
          `${path}[${index}]`,
          depth + 1,
          limits,
        ),
      );
  }

  const out = {};

  for (const key of Object.keys(value).slice(0, maxKeys)) {
    const childPath = path ? `${path}.${key}` : key;

    if (
      SECRET_FIELD_PATTERN.test(key) ||
      SENSITIVE_PATH_PATTERN.test(childPath)
    ) {
      out[key] = '[REDACTED]';
      continue;
    }

    out[key] = sanitizeObject(
      value[key],
      childPath,
      depth + 1,
      limits,
    );
  }

  return out;
};

const deepFreeze = (value, seen = new WeakSet()) => {
  if (
    !value ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
};

const nowIso = (clock) =>
  new Date(
    clock?.now?.() ?? Date.now(),
  ).toISOString();

const actorKey = (actor) => {
  if (!actor || typeof actor !== 'object') {
    return undefined;
  }

  return normalizeString(
    actor.actorId ??
      actor.userId ??
      actor.id ??
      actor.principalId,
    160,
  );
};

const actorRole = (actor) =>
  upper(
    actor?.role ??
      actor?.actorRole ??
      actor?.type,
  );

const approvalRequiredForImpact = (
  impact,
  config,
) => {
  const normalized =
    upper(impact) ??
    IMPACT_LEVELS.NON_FINANCIAL;

  if (
    normalized === IMPACT_LEVELS.NON_FINANCIAL
  ) {
    return false;
  }

  if (
    normalized === IMPACT_LEVELS.REVERSAL
  ) {
    return config.requireMakerCheckerForReversal;
  }

  if (
    normalized === IMPACT_LEVELS.REFUND
  ) {
    return config.requireMakerCheckerForRefund;
  }

  if (
    normalized === IMPACT_LEVELS.DISBURSEMENT
  ) {
    return config.requireMakerCheckerForDisbursement;
  }

  if (
    normalized === IMPACT_LEVELS.SETTLEMENT
  ) {
    return config.requireMakerCheckerForSettlement;
  }

  return config.requireMakerCheckerForFinancialImpact;
};

const isOfflineUnsafe = (state) => {
  const normalized = upper(state);

  return [
    OFFLINE_STATES.LOCAL_ONLY,
    OFFLINE_STATES.PENDING_SYNC,
    OFFLINE_STATES.SYNCING,
    OFFLINE_STATES.SERVER_REJECTED,
    OFFLINE_STATES.CONFLICT,
    OFFLINE_STATES.REQUIRES_REVIEW,
  ].includes(normalized);
};

export class AirtelApprovalWorkflowError extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message, options);

    this.name = 'AirtelApprovalWorkflowError';
    this.code = code;
    this.component = COMPONENT;
    this.provider = PROVIDER;
    this.details = sanitizeObject(details);
    this.retryable = Boolean(options.retryable);
    this.httpStatus = options.httpStatus ?? 400;
  }
}

export const normalizeContext = (input = {}) => {
  if (!isPlainObject(input)) {
    throw new AirtelApprovalWorkflowError(
      'INVALID_INPUT',
      'Approval workflow input must be an object.',
    );
  }

  const context = clone(input) ?? {};

  delete context.password;
  delete context.secret;
  delete context.token;
  delete context.authorization;
  delete context.cookie;
  delete context.rawRequest;
  delete context.rawResponse;
  delete context.providerPayload;
  delete context.requestBody;
  delete context.responseBody;

  return sanitizeObject(context);
};

export const buildApprovalScope = (input = {}) => {
  const commandPlan =
    input.commandPlan ??
    input.plan ??
    {};

  const identity =
    input.paymentIdentity ??
    input.payment ??
    {};

  const normalized = {
    tenantId: normalizeString(
      input.tenantId ??
        commandPlan.tenantId ??
        identity.tenantId,
      160,
    ),

    provider: upper(
      input.provider ??
        commandPlan.provider ??
        identity.provider ??
        PROVIDER,
    ),

    operation: upper(
      input.operation ??
        commandPlan.operation,
    ),

    command: upper(
      input.command ??
        commandPlan.command,
    ),

    action: upper(
      input.action ??
        commandPlan.action,
    ),

    decision: upper(
      input.decision ??
        commandPlan.decision,
    ),

    operationType: upper(
      input.operationType ??
        commandPlan.operationType,
    ),

    impactLevel: upper(
      input.impactLevel ??
        commandPlan.impactLevel ??
        commandPlan.financialImpact,
    ),

    paymentId: normalizeString(
      input.paymentId ??
        identity.paymentId ??
        identity.transactionId,
      240,
    ),

    transactionId: normalizeString(
      input.transactionId ??
        identity.transactionId,
      240,
    ),

    idempotencyKey: normalizeString(
      input.originalIdempotencyKey ??
        identity.originalIdempotencyKey ??
        identity.idempotencyKey,
      240,
    ),

    offlineState: upper(
      input.offlineState ??
        commandPlan.offlineState ??
        identity.offlineState,
    ),

    amountMinor:
      input.amountMinor ??
      identity.amountMinor,

    currency: upper(
      input.currency ??
        identity.currency,
    ),

    reasonCode: normalizeString(
      input.reasonCode ??
        commandPlan.reasonCode,
      160,
    ),

    riskLevel: upper(
      input.riskLevel ??
        commandPlan.riskLevel,
    ),
  };

  const passthrough = isPlainObject(input.scope)
    ? sanitizeObject(
        input.scope,
        'scope',
        0,
        {
          maxDepth: 5,
          maxKeys: 50,
          maxArray: 50,
          maxStringLength: 500,
        },
      )
    : undefined;

  return {
    ...normalized,
    ...(passthrough
      ? { customScope: passthrough }
      : {}),
  };
};

export const scopeFingerprint = (scope) =>
  sha256(buildApprovalScope(scope));

export const isApprovalStateTerminal = (
  state,
) =>
  [
    APPROVAL_STATES.REJECTED,
    APPROVAL_STATES.CANCELLED,
    APPROVAL_STATES.EXPIRED,
    APPROVAL_STATES.SUPERSEDED,
    APPROVAL_STATES.CONSUMED,
    APPROVAL_STATES.EXECUTION_FAILED,
  ].includes(upper(state));

export const isApprovalStateActive = (
  state,
) =>
  [
    APPROVAL_STATES.PENDING,
    APPROVAL_STATES.APPROVED,
  ].includes(upper(state));

export const canTransition = (
  from,
  to,
) => {
  const allowed =
    ALLOWED_TRANSITIONS[upper(from)];

  return Boolean(
    allowed?.has(upper(to)),
  );
};

export const createApprovalWorkflow = (
  options = {},
) =>
  new AirtelApprovalWorkflow(options);

export class AirtelApprovalWorkflow {
  constructor(options = {}) {
    this.config = Object.freeze({
      ...DEFAULTS,
      ...(options.config ?? {}),
    });

    this.repository =
      options.repository ??
      options.store ??
      null;

    this.audit =
      options.audit ??
      null;

    this.policy =
      options.policy ??
      options.policyEngine ??
      null;

    this.logger =
      options.logger ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.clock =
      options.clock ??
      {
        now: () => Date.now(),
      };

    this.idFactory =
      options.idFactory ??
      (() => randomUUID());
  }

  _requireRepository(
    method,
    { optional = false } = {},
  ) {
    const fn =
      this.repository?.[method];

    if (typeof fn === 'function') {
      return fn.bind(this.repository);
    }

    if (optional) {
      return null;
    }

    if (
      this.config.failClosedOnPersistenceError
    ) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_REPOSITORY_UNAVAILABLE',
        `Approval repository method "${method}" is required for this operation.`,
        { method },
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    return null;
  }

  _requireTenant(context) {
    const tenantId =
      normalizeString(
        context.tenantId,
        this.config.maxTenantIdLength,
      );

    if (
      this.config.requireTenantId &&
      !tenantId
    ) {
      throw new AirtelApprovalWorkflowError(
        'TENANT_REQUIRED',
        'tenantId is required for approval governance.',
      );
    }

    return tenantId;
  }

  _requireProvider(context) {
    const provider =
      upper(
        context.provider ??
          PROVIDER,
      ) ??
      PROVIDER;

    if (
      this.config.enforceAirtelProvider &&
      provider !== PROVIDER
    ) {
      throw new AirtelApprovalWorkflowError(
        'PROVIDER_SCOPE_VIOLATION',
        'This approval workflow is scoped to the Airtel provider.',
        { provider },
      );
    }

    return provider;
  }

  _normalizeActor(
    actor,
    fieldName = 'actor',
  ) {
    if (
      !actor ||
      typeof actor !== 'object'
    ) {
      throw new AirtelApprovalWorkflowError(
        'ACTOR_REQUIRED',
        `${fieldName} is required.`,
      );
    }

    const actorId = actorKey(actor);

    if (!actorId) {
      throw new AirtelApprovalWorkflowError(
        'ACTOR_ID_REQUIRED',
        `${fieldName}.actorId is required.`,
      );
    }

    return {
      actorId: actorId.slice(
        0,
        this.config.maxActorIdLength,
      ),

      role: actorRole(actor),

      tenantId: normalizeString(
        actor.tenantId,
        this.config.maxTenantIdLength,
      ),

      displayName: normalizeString(
        actor.displayName ??
          actor.name,
        240,
      ),

      source: normalizeString(
        actor.source ??
          actor.authSource,
        120,
      ),
    };
  }

  _assertActorTenant(
    actor,
    tenantId,
    fieldName = 'actor',
  ) {
    if (
      actor.tenantId &&
      tenantId &&
      actor.tenantId !== tenantId
    ) {
      throw new AirtelApprovalWorkflowError(
        'ACTOR_TENANT_MISMATCH',
        `${fieldName} does not belong to the approval tenant.`,
        {
          fieldName,
          tenantId,
          actorTenantId: actor.tenantId,
        },
      );
    }
  }

  _normalizeImpact(input) {
    return (
      upper(
        input.impactLevel ??
          input.financialImpact ??
          input.operationImpact,
      ) ??
      (input.isFinancialImpact
        ? IMPACT_LEVELS.FINANCIAL
        : IMPACT_LEVELS.NON_FINANCIAL)
    );
  }

  _validateFinancialIdentity(
    input,
    impactLevel,
  ) {
    if (
      !approvalRequiredForImpact(
        impactLevel,
        this.config,
      )
    ) {
      return;
    }

    if (
      !this.config
        .requireOriginalIdempotencyKeyForFinancialImpact
    ) {
      return;
    }

    const key =
      normalizeString(
        input.originalIdempotencyKey ??
          input.paymentIdentity
            ?.originalIdempotencyKey ??
          input.paymentIdentity
            ?.idempotencyKey ??
          input.commandPlan
            ?.originalIdempotencyKey,
        240,
      );

    if (!key) {
      throw new AirtelApprovalWorkflowError(
        'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
        'Financial approval requires the original tenant-scoped idempotency key.',
      );
    }
  }

  async _evaluatePolicy(
    action,
    input,
  ) {
    if (!this.policy) {
      return {
        decision: null,
        source: 'NONE',
      };
    }

    const method =
      this.policy.evaluateApproval ??
      this.policy.evaluate ??
      this.policy.assess;

    if (typeof method !== 'function') {
      return {
        decision: null,
        source: 'NONE',
      };
    }

    try {
      const result =
        await method.call(
          this.policy,
          {
            action,
            component: COMPONENT,
            provider: PROVIDER,
            tenantId: input.tenantId,
            impactLevel:
              input.impactLevel,
            riskLevel:
              input.riskLevel,
            commandPlan:
              sanitizeObject(
                input.commandPlan ??
                  input.plan ??
                  {},
              ),
            actor:
              sanitizeObject(
                input.actor ??
                  {},
              ),
          },
        );

      const decision = upper(
        result?.decision ??
          result?.outcome ??
          result?.status,
      );

      if (
        decision ===
        APPROVAL_DECISIONS.BLOCK
      ) {
        return {
          decision:
            APPROVAL_DECISIONS.BLOCK,
          source: 'POLICY',
          result:
            sanitizeObject(result),
        };
      }

      if (
        decision ===
        APPROVAL_DECISIONS.REJECT
      ) {
        return {
          decision:
            APPROVAL_DECISIONS.REJECT,
          source: 'POLICY',
          result:
            sanitizeObject(result),
        };
      }

      if (
        decision ===
        APPROVAL_DECISIONS.REQUIRE_REVIEW
      ) {
        return {
          decision:
            APPROVAL_DECISIONS.REQUIRE_REVIEW,
          source: 'POLICY',
          result:
            sanitizeObject(result),
        };
      }

      return {
        decision:
          APPROVAL_DECISIONS.APPROVE,
        source: 'POLICY',
        result:
          sanitizeObject(result),
      };
    } catch (error) {
      this._log(
        'error',
        'Approval policy evaluation failed closed.',
        {
          code:
            'APPROVAL_POLICY_EVALUATION_FAILED',
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnPolicyError
      ) {
        throw new AirtelApprovalWorkflowError(
          'APPROVAL_POLICY_UNAVAILABLE',
          'Approval policy evaluation failed; approval cannot proceed until policy evaluation is available.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          APPROVAL_DECISIONS.REQUIRE_REVIEW,
        source: 'POLICY_ERROR',
      };
    }
  }

  _buildRecord(
    input,
    maker,
    scope,
    fingerprint,
    expiresAt,
  ) {
    const approvalId =
      normalizeString(
        input.approvalId,
        this.config.maxApprovalIdLength,
      ) ??
      this.idFactory();

    const tenantId =
      this._requireTenant({
        tenantId: input.tenantId,
      });

    const provider =
      this._requireProvider({
        provider: input.provider,
      });

    const now =
      nowIso(this.clock);

    const impactLevel =
      this._normalizeImpact(input);

    const riskLevel =
      upper(input.riskLevel) ??
      RISK_LEVELS.MEDIUM;

    const ttlMs =
      this._ttl(input.ttlMs);

    return {
      approvalId,
      approvalVersion: 1,

      component: COMPONENT,
      engineName: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,

      provider,
      tenantId,

      state: APPROVAL_STATES.DRAFT,

      action:
        upper(input.action) ??
        APPROVAL_ACTIONS.CREATE,

      decision:
        APPROVAL_DECISIONS.REQUIRE_REVIEW,

      impactLevel,
      riskLevel,

      maker: maker.actorId,
      makerActor: maker,

      requiredChecker:
        input.requiredChecker
          ? this._normalizeActor(
              input.requiredChecker,
              'requiredChecker',
            )
          : undefined,

      scope:
        sanitizeObject(scope, 'scope'),

      scopeFingerprint:
        fingerprint,

      originalIdempotencyKey:
        normalizeString(
          input.originalIdempotencyKey ??
            input.paymentIdentity
              ?.originalIdempotencyKey ??
            input.paymentIdentity
              ?.idempotencyKey ??
            input.commandPlan
              ?.originalIdempotencyKey,
          240,
        ),

      commandId:
        normalizeString(
          input.commandId ??
            input.commandPlan?.commandId,
          240,
        ),

      paymentId:
        normalizeString(
          input.paymentId ??
            input.paymentIdentity?.paymentId,
          240,
        ),

      transactionId:
        normalizeString(
          input.transactionId ??
            input.paymentIdentity?.transactionId,
          240,
        ),

      reason:
        normalizeString(
          input.reason,
          this.config.maxCommentLength,
        ),

      metadata:
        sanitizeObject(
          input.metadata ?? {},
        ),

      createdAt:
        input.createdAt ??
        now,

      updatedAt:
        now,

      submittedAt: undefined,
      approvedAt: undefined,
      rejectedAt: undefined,
      cancelledAt: undefined,
      consumedAt: undefined,

      expiresAt:
        expiresAt.toISOString(),

      version: 1,
      auditFingerprint: undefined,
    };
  }

  _ttl(ttlMs) {
    const requested =
      toFiniteNumber(ttlMs);

    if (requested === null) {
      return this.config.defaultTtlMs;
    }

    return Math.min(
      this.config.maxTtlMs,
      Math.max(
        this.config.minTtlMs,
        Math.trunc(requested),
      ),
    );
  }

  _validateExpiry(
    record,
    atMs =
      this.clock.now?.() ??
      Date.now(),
  ) {
    const expiresAtMs =
      new Date(
        record.expiresAt,
      ).getTime();

    if (!Number.isFinite(expiresAtMs)) {
      throw new AirtelApprovalWorkflowError(
        'INVALID_EXPIRY',
        'Approval expiry is invalid.',
        {
          approvalId:
            record.approvalId,
        },
      );
    }

    return expiresAtMs <= atMs;
  }

  _assertTransition(
    currentState,
    nextState,
  ) {
    if (
      !canTransition(
        currentState,
        nextState,
      )
    ) {
      throw new AirtelApprovalWorkflowError(
        'INVALID_STATE_TRANSITION',
        `Cannot transition approval from ${currentState} to ${nextState}.`,
        {
          currentState,
          nextState,
        },
        {
          httpStatus: 409,
        },
      );
    }
  }

  _assertScopeMatch(
    record,
    input,
  ) {
    const expected =
      normalizeString(
        input.scopeFingerprint,
        128,
      );

    const actual =
      scopeFingerprint(
        buildApprovalScope(input),
      );

    const recordFingerprint =
      normalizeString(
        record.scopeFingerprint,
        128,
      );

    const candidate =
      expected ??
      actual;

    if (
      !recordFingerprint ||
      candidate !== recordFingerprint
    ) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_SCOPE_MISMATCH',
        'The approval does not match the exact operation being acted upon.',
        {
          approvalId:
            record.approvalId,
          expected:
            recordFingerprint,
          received:
            candidate,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return true;
  }

  _assertCheckerDistinct(
    record,
    checker,
  ) {
    const makerId =
      normalizeString(
        record.maker,
        this.config.maxActorIdLength,
      );

    const checkerId =
      actorKey(checker);

    if (!checkerId) {
      throw new AirtelApprovalWorkflowError(
        'CHECKER_ID_REQUIRED',
        'Checker actorId is required.',
      );
    }

    if (
      makerId &&
      makerId === checkerId
    ) {
      throw new AirtelApprovalWorkflowError(
        'MAKER_CHECKER_SEPARATION_VIOLATION',
        'The checker must be a different principal from the maker.',
        {
          makerId,
          checkerId,
        },
        {
          httpStatus: 409,
        },
      );
    }
  }

  _assertApprovalUsable(
    record,
    input = {},
  ) {
    const state =
      upper(record.state);

    if (
      state !==
      APPROVAL_STATES.APPROVED
    ) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_NOT_APPROVED',
        `Approval ${record.approvalId} is not executable in state ${state}.`,
        {
          state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      this._validateExpiry(record)
    ) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_EXPIRED',
        'Approval has expired and must not be reused.',
        {
          approvalId:
            record.approvalId,
          expiresAt:
            record.expiresAt,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const offlineState =
      upper(
        input.offlineState ??
          input.commandPlan
            ?.offlineState ??
          record.scope?.offlineState,
      );

    if (
      isOfflineUnsafe(
        offlineState,
      )
    ) {
      throw new AirtelApprovalWorkflowError(
        'OFFLINE_OPERATION_NOT_EXECUTABLE',
        'An approval cannot authorize execution while the payment remains in an unresolved offline state.',
        {
          offlineState,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const regulatoryDecision =
      upper(
        input.regulatoryDecision ??
          input.commandPlan
            ?.regulatoryDecision ??
          input.commandPlan
            ?.regulatoryOutcome,
      );

    if (
      [
        APPROVAL_DECISIONS.BLOCK,
        'DENY',
        'BLOCKED',
        'REJECTED',
      ].includes(
        regulatoryDecision,
      )
    ) {
      throw new AirtelApprovalWorkflowError(
        'REGULATORY_BLOCK',
        'Approval cannot override a regulatory block.',
        {
          regulatoryDecision,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return true;
  }

  _auditEvent(
    type,
    record,
    actor,
    extra = {},
  ) {
    const sanitized = {
      type,

      approvalId:
        record.approvalId,

      tenantId:
        record.tenantId,

      provider:
        record.provider,

      state:
        record.state,

      action:
        record.action,

      decision:
        record.decision,

      maker:
        record.maker,

      checker:
        actor?.actorId,

      scopeFingerprint:
        record.scopeFingerprint,

      at:
        nowIso(this.clock),

      ...sanitizeObject(extra),
    };

    sanitized.auditFingerprint =
      sha256(sanitized);

    return deepFreeze(
      sanitized,
    );
  }

  async _writeAudit(event) {
    try {
      const fn =
        this.audit?.append ??
        this.audit?.record ??
        this.audit?.write;

      if (
        typeof fn === 'function'
      ) {
        await fn.call(
          this.audit,
          event,
        );
      }
    } catch (error) {
      this._log(
        'error',
        'Approval audit write failed.',
        {
          code:
            'APPROVAL_AUDIT_WRITE_FAILED',
          approvalId:
            event.approvalId,
          message:
            error?.message,
        },
      );

      throw new AirtelApprovalWorkflowError(
        'APPROVAL_AUDIT_UNAVAILABLE',
        'Approval governance cannot continue because its audit boundary is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
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
      this.logger?.[level] ??
      this.logger?.info;

    if (
      typeof method === 'function'
    ) {
      method.call(
        this.logger,
        {
          component:
            COMPONENT,
          provider:
            PROVIDER,
          ...sanitizeObject(
            context,
          ),
        },
        message,
      );
    }
  }

  _metric(
    name,
    labels = {},
  ) {
    try {
      const metric =
        this.metrics?.[name] ??
        this.metrics?.counter ??
        this.metrics?.increment;

      if (
        typeof metric === 'function'
      ) {
        if (
          metric ===
            this.metrics.counter ||
          metric ===
            this.metrics.increment
        ) {
          metric.call(
            this.metrics,
            name,
            sanitizeObject(labels),
          );
        } else {
          metric.call(
            this.metrics,
            sanitizeObject(labels),
          );
        }
      }
    } catch {
      // Metrics must never change approval decisions.
    }
  }

  async create(input = {}) {
    const normalized =
      normalizeContext(input);

    const maker =
      this._normalizeActor(
        normalized.maker ??
          normalized.actor,
        'maker',
      );

    const tenantId =
      this._requireTenant(
        normalized,
      );

    this._assertActorTenant(
      maker,
      tenantId,
      'maker',
    );

    if (
      normalized.requiredChecker
    ) {
      const requiredChecker =
        this._normalizeActor(
          normalized.requiredChecker,
          'requiredChecker',
        );

      this._assertActorTenant(
        requiredChecker,
        tenantId,
        'requiredChecker',
      );

      if (
        requiredChecker.actorId ===
        maker.actorId
      ) {
        throw new AirtelApprovalWorkflowError(
          'MAKER_CHECKER_SEPARATION_VIOLATION',
          'The required checker must be a different principal from the maker.',
          {
            makerId:
              maker.actorId,
            checkerId:
              requiredChecker.actorId,
          },
          {
            httpStatus: 409,
          },
        );
      }
    }

    const provider =
      this._requireProvider(
        normalized,
      );

    const impactLevel =
      this._normalizeImpact(
        normalized,
      );

    this._validateFinancialIdentity(
      normalized,
      impactLevel,
    );

    const scope =
      buildApprovalScope({
        ...normalized,
        tenantId,
        provider,
        impactLevel,
      });

    const fingerprint =
      scopeFingerprint(scope);

    const policy =
      await this._evaluatePolicy(
        APPROVAL_ACTIONS.CREATE,
        {
          ...normalized,
          tenantId,
          provider,
          impactLevel,
          riskLevel:
            upper(
              normalized.riskLevel,
            ) ??
            RISK_LEVELS.MEDIUM,
        },
      );

    if (
      [
        APPROVAL_DECISIONS.BLOCK,
        APPROVAL_DECISIONS.REJECT,
      ].includes(
        policy.decision,
      )
    ) {
      this._metric(
        'approval_blocked_total',
        {
          reason:
            policy.decision,
        },
      );

      throw new AirtelApprovalWorkflowError(
        policy.decision ===
          APPROVAL_DECISIONS.BLOCK
          ? 'APPROVAL_POLICY_BLOCKED'
          : 'APPROVAL_POLICY_REJECTED',
        'Approval request is not eligible under the active governance policy.',
        {
          policyDecision:
            policy.decision,
          policySource:
            policy.source,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const required =
      approvalRequiredForImpact(
        impactLevel,
        this.config,
      );

    const expiresAt =
      new Date(
        (this.clock.now?.() ??
          Date.now()) +
          this._ttl(
            normalized.ttlMs,
          ),
      );

    const record =
      this._buildRecord(
        {
          ...normalized,
          tenantId,
          provider,
          impactLevel,
          action:
            normalized.action ??
            APPROVAL_ACTIONS.CREATE,
        },
        maker,
        scope,
        fingerprint,
        expiresAt,
      );

    record.auditFingerprint =
      sha256(
        this._auditEvent(
          'APPROVAL_CREATED',
          record,
          maker,
        ),
      );

    record.decision =
      required
        ? APPROVAL_DECISIONS.REQUIRE_REVIEW
        : APPROVAL_DECISIONS.APPROVE;

    record.state =
      required
        ? APPROVAL_STATES.DRAFT
        : APPROVAL_STATES.APPROVED;

    record.metadata = {
      ...record.metadata,
      approvalRequired:
        required,
      policyDecision:
        policy.decision ?? null,
      policySource:
        policy.source,
    };

    const createFn =
      this._requireRepository(
        'create',
      );

    let persisted =
      record;

    if (createFn) {
      persisted =
        await createFn(
          record,
          {
            idempotencyKey:
              this._approvalIdempotencyKey(
                record,
              ),
            expectedState:
              undefined,
          },
        );
    }

    const auditEvent =
      this._auditEvent(
        'APPROVAL_CREATED',
        persisted,
        maker,
        {
          required,
          policyDecision:
            policy.decision ?? null,
        },
      );

    await this._writeAudit(
      auditEvent,
    );

    this._metric(
      'approval_created_total',
      {
        required:
          String(required),
      },
    );

    return deepFreeze(
      clone(persisted),
    );
  }

  _approvalIdempotencyKey(
    record,
  ) {
    return `${record.tenantId}:approval:${record.approvalId}:${record.scopeFingerprint}`;
  }

  async submit(input = {}) {
    const normalized =
      normalizeContext(input);

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      this._normalizeActor(
        normalized.actor ??
          normalized.maker,
        'actor',
      );

    this._assertActorTenant(
      actor,
      approval.tenantId,
      'actor',
    );

    if (
      this._validateExpiry(
        approval,
      )
    ) {
      return this._expireRecord(
        approval,
        actor,
      );
    }

    if (
      approval.state ===
      APPROVAL_STATES.APPROVED
    ) {
      return deepFreeze(
        clone(approval),
      );
    }

    if (
      approval.state !==
      APPROVAL_STATES.DRAFT
    ) {
      throw new AirtelApprovalWorkflowError(
        'INVALID_SUBMIT_STATE',
        `Approval is not submittable from ${approval.state}.`,
        {
          approvalId:
            approval.approvalId,
          state:
            approval.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const impactLevel =
      upper(
        approval.impactLevel,
      ) ??
      IMPACT_LEVELS.NON_FINANCIAL;

    const required =
      approvalRequiredForImpact(
        impactLevel,
        this.config,
      );

    const targetState =
      required
        ? APPROVAL_STATES.PENDING
        : APPROVAL_STATES.APPROVED;

    this._assertTransition(
      approval.state,
      targetState,
    );

    const previousState =
      approval.state;

    if (
      targetState ===
      APPROVAL_STATES.APPROVED
    ) {
      approval.approvedAt =
        nowIso(this.clock);
    }

    approval.submittedAt =
      nowIso(this.clock);

    approval.updatedAt =
      nowIso(this.clock);

    approval.version =
      Number(
        approval.version ?? 1,
      ) + 1;

    approval.state =
      targetState;

    approval.decision =
      required
        ? APPROVAL_DECISIONS.REQUIRE_REVIEW
        : APPROVAL_DECISIONS.APPROVE;

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            previousState,

          toState:
            targetState,

          action:
            APPROVAL_ACTIONS.SUBMIT,

          actor,

          expectedVersion:
            Number(
              approval.version,
            ) - 1,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_SUBMITTED',
        updated,
        actor,
      ),
    );

    this._metric(
      'approval_submitted_total',
      {
        required:
          String(required),
      },
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async approve(input = {}) {
    const normalized =
      normalizeContext(input);

    const approval =
      await this._getApproval(
        normalized,
      );

    const checker =
      this._normalizeActor(
        normalized.checker ??
          normalized.actor,
        'checker',
      );

    this._assertActorTenant(
      checker,
      approval.tenantId,
      'checker',
    );

    this._assertCheckerDistinct(
      approval,
      checker,
    );

    if (
      approval.requiredChecker &&
      checker.actorId !==
        approval.requiredChecker.actorId
    ) {
      throw new AirtelApprovalWorkflowError(
        'REQUIRED_CHECKER_MISMATCH',
        'The approval is restricted to the configured checker principal.',
        {
          approvalId:
            approval.approvalId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      this._validateExpiry(
        approval,
      )
    ) {
      return this._expireRecord(
        approval,
        checker,
      );
    }

    if (
      approval.state ===
      APPROVAL_STATES.APPROVED
    ) {
      this._assertScopeMatch(
        approval,
        normalized,
      );

      throw new AirtelApprovalWorkflowError(
        'APPROVAL_ALREADY_APPROVED',
        'Approval is already approved and cannot be re-approved.',
        {
          approvalId:
            approval.approvalId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      approval.state !==
      APPROVAL_STATES.PENDING
    ) {
      throw new AirtelApprovalWorkflowError(
        'INVALID_APPROVAL_STATE',
        `Approval cannot be approved from ${approval.state}.`,
        {
          approvalId:
            approval.approvalId,
          state:
            approval.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    this._assertScopeMatch(
      approval,
      normalized,
    );

    const reason =
      normalizeString(
        normalized.reason ??
          normalized.comment,
        this.config.maxCommentLength,
      );

    if (
      this.config
        .requireApprovalReason &&
      !reason
    ) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_REASON_REQUIRED',
        'An approval reason is required.',
      );
    }

    const policy =
      await this._evaluatePolicy(
        APPROVAL_ACTIONS.APPROVE,
        {
          ...normalized,
          tenantId:
            approval.tenantId,
          provider:
            approval.provider,
          impactLevel:
            approval.impactLevel,
          riskLevel:
            approval.riskLevel,
          approval,
          actor:
            checker,
        },
      );

    if (
      [
        APPROVAL_DECISIONS.BLOCK,
        APPROVAL_DECISIONS.REJECT,
        APPROVAL_DECISIONS.REQUIRE_REVIEW,
      ].includes(
        policy.decision,
      )
    ) {
      throw new AirtelApprovalWorkflowError(
        policy.decision ===
          APPROVAL_DECISIONS.BLOCK
          ? 'APPROVAL_POLICY_BLOCKED'
          : 'APPROVAL_POLICY_REJECTED',
        'The checker decision was rejected by the active governance policy.',
        {
          approvalId:
            approval.approvalId,
          policyDecision:
            policy.decision,
        },
        {
          httpStatus: 409,
        },
      );
    }

    this._assertTransition(
      approval.state,
      APPROVAL_STATES.APPROVED,
    );

    approval.checker =
      checker.actorId;

    approval.checkerActor =
      checker;

    approval.reason =
      reason;

    approval.approvedAt =
      nowIso(this.clock);

    approval.updatedAt =
      nowIso(this.clock);

    approval.version =
      Number(
        approval.version ?? 1,
      ) + 1;

    approval.state =
      APPROVAL_STATES.APPROVED;

    approval.decision =
      APPROVAL_DECISIONS.APPROVE;

    approval.checkerScopeFingerprint =
      approval.scopeFingerprint;

    const previousState =
      APPROVAL_STATES.PENDING;

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            previousState,

          toState:
            APPROVAL_STATES.APPROVED,

          action:
            APPROVAL_ACTIONS.APPROVE,

          actor:
            checker,

          expectedVersion:
            Number(
              approval.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_APPROVED',
        updated,
        checker,
        { reason },
      ),
    );

    this._metric(
      'approval_approved_total',
      {},
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async reject(input = {}) {
    return this._decide(
      input,
      APPROVAL_STATES.REJECTED,
      APPROVAL_ACTIONS.REJECT,
      APPROVAL_DECISIONS.REJECT,
      'REJECT',
    );
  }

  async cancel(input = {}) {
    return this._decide(
      input,
      APPROVAL_STATES.CANCELLED,
      APPROVAL_ACTIONS.CANCEL,
      APPROVAL_DECISIONS.REJECT,
      'CANCEL',
    );
  }

  async _decide(
    input,
    targetState,
    action,
    decision,
    auditType,
  ) {
    const normalized =
      normalizeContext(input);

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      this._normalizeActor(
        normalized.actor ??
          normalized.checker ??
          normalized.maker,
        'actor',
      );

    this._assertActorTenant(
      actor,
      approval.tenantId,
      'actor',
    );

    if (
      ![
        APPROVAL_STATES.PENDING,
        APPROVAL_STATES.DRAFT,
        APPROVAL_STATES.APPROVED,
      ].includes(
        approval.state,
      )
    ) {
      throw new AirtelApprovalWorkflowError(
        'INVALID_DECISION_STATE',
        `Approval cannot be ${auditType.toLowerCase()}d from ${approval.state}.`,
        {
          approvalId:
            approval.approvalId,
          state:
            approval.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      auditType === 'REJECT'
    ) {
      this._assertCheckerDistinct(
        approval,
        actor,
      );
    }

    if (
      this._validateExpiry(
        approval,
      ) &&
      approval.state !==
        APPROVAL_STATES.DRAFT
    ) {
      return this._expireRecord(
        approval,
        actor,
      );
    }

    if (
      auditType === 'REJECT' &&
      normalized.scopeFingerprint
    ) {
      this._assertScopeMatch(
        approval,
        normalized,
      );
    }

    const reason =
      normalizeString(
        normalized.reason ??
          normalized.comment,
        this.config.maxCommentLength,
      );

    const required =
      auditType === 'REJECT'
        ? this.config
            .requireRejectionReason
        : this.config
            .requireCancellationReason;

    if (
      required &&
      !reason
    ) {
      throw new AirtelApprovalWorkflowError(
        auditType === 'REJECT'
          ? 'REJECTION_REASON_REQUIRED'
          : 'CANCELLATION_REASON_REQUIRED',
        `${
          auditType === 'REJECT'
            ? 'Rejection'
            : 'Cancellation'
        } reason is required.`,
      );
    }

    this._assertTransition(
      approval.state,
      targetState,
    );

    const previousState =
      approval.state;

    approval.reason =
      reason;

    approval.updatedAt =
      nowIso(this.clock);

    approval.version =
      Number(
        approval.version ?? 1,
      ) + 1;

    approval.state =
      targetState;

    approval.decision =
      decision;

    if (
      auditType === 'REJECT'
    ) {
      approval.rejectedAt =
        nowIso(this.clock);

      approval.checker =
        actor.actorId;

      approval.checkerActor =
        actor;
    }

    if (
      auditType === 'CANCEL'
    ) {
      approval.cancelledAt =
        nowIso(this.clock);
    }

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            previousState,

          toState:
            targetState,

          action,

          actor,

          expectedVersion:
            Number(
              approval.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        `APPROVAL_${auditType}ED`,
        updated,
        actor,
        { reason },
      ),
    );

    this._metric(
      `approval_${auditType.toLowerCase()}ed_total`,
      {},
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async consume(input = {}) {
    const normalized =
      normalizeContext(input);

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      this._normalizeActor(
        normalized.actor ??
          normalized.executor,
        'actor',
      );

    this._assertActorTenant(
      actor,
      approval.tenantId,
      'actor',
    );

    this._assertScopeMatch(
      approval,
      normalized,
    );

    this._assertApprovalUsable(
      approval,
      normalized,
    );

    const impactLevel =
      upper(
        approval.impactLevel,
      ) ??
      IMPACT_LEVELS.NON_FINANCIAL;

    this._validateFinancialIdentity(
      normalized,
      impactLevel,
    );

    this._assertTransition(
      approval.state,
      APPROVAL_STATES.CONSUMED,
    );

    approval.consumedAt =
      nowIso(this.clock);

    approval.consumedBy =
      actor.actorId;

    approval.updatedAt =
      nowIso(this.clock);

    approval.version =
      Number(
        approval.version ?? 1,
      ) + 1;

    approval.state =
      APPROVAL_STATES.CONSUMED;

    const previousState =
      APPROVAL_STATES.APPROVED;

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            previousState,

          toState:
            APPROVAL_STATES.CONSUMED,

          action:
            APPROVAL_ACTIONS.CONSUME,

          actor,

          expectedVersion:
            Number(
              approval.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_CONSUMED',
        updated,
        actor,
      ),
    );

    this._metric(
      'approval_consumed_total',
      {},
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async markExecutionFailed(
    input = {},
  ) {
    const normalized =
      normalizeContext(input);

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      this._normalizeActor(
        normalized.actor ??
          normalized.executor,
        'actor',
      );

    this._assertActorTenant(
      actor,
      approval.tenantId,
      'actor',
    );

    this._assertScopeMatch(
      approval,
      normalized,
    );

    if (
      approval.state !==
        APPROVAL_STATES.APPROVED &&
      approval.state !==
        APPROVAL_STATES.CONSUMED
    ) {
      throw new AirtelApprovalWorkflowError(
        'INVALID_EXECUTION_FAILURE_STATE',
        'Approval cannot be marked execution-failed from its current state.',
        {
          approvalId:
            approval.approvalId,
          state:
            approval.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      approval.state ===
      APPROVAL_STATES.CONSUMED
    ) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_ALREADY_CONSUMED',
        'A consumed approval cannot be reused or rewound after execution.',
        {
          approvalId:
            approval.approvalId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    this._assertTransition(
      approval.state,
      APPROVAL_STATES.EXECUTION_FAILED,
    );

    approval.state =
      APPROVAL_STATES.EXECUTION_FAILED;

    approval.decision =
      APPROVAL_DECISIONS.REQUIRE_REVIEW;

    approval.executionFailure =
      sanitizeObject({
        code:
          normalized.failureCode,

        reason:
          normalized.reason,

        at:
          nowIso(this.clock),

        operationReference:
          normalized.operationReference,
      });

    approval.updatedAt =
      nowIso(this.clock);

    approval.version =
      Number(
        approval.version ?? 1,
      ) + 1;

    const previousState =
      APPROVAL_STATES.APPROVED;

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            previousState,

          toState:
            APPROVAL_STATES.EXECUTION_FAILED,

          action:
            APPROVAL_ACTIONS.MARK_EXECUTION_FAILED,

          actor,

          expectedVersion:
            Number(
              approval.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_EXECUTION_FAILED',
        updated,
        actor,
      ),
    );

    this._metric(
      'approval_execution_failed_total',
      {},
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async expire(input = {}) {
    const normalized =
      normalizeContext(input);

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      this._normalizeActor(
        normalized.actor ??
          {
            actorId:
              'system:approval-expiry',
            role:
              'SYSTEM',
          },
        'actor',
      );

    this._assertActorTenant(
      actor,
      approval.tenantId,
      'actor',
    );

    return this._expireRecord(
      approval,
      actor,
    );
  }

  async _expireRecord(
    approval,
    actor,
  ) {
    if (
      isApprovalStateTerminal(
        approval.state,
      )
    ) {
      return deepFreeze(
        clone(approval),
      );
    }

    if (
      !this._validateExpiry(
        approval,
      )
    ) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_NOT_EXPIRED',
        'Approval has not reached its expiry time.',
        {
          approvalId:
            approval.approvalId,
          expiresAt:
            approval.expiresAt,
        },
        {
          httpStatus: 409,
        },
      );
    }

    this._assertTransition(
      approval.state,
      APPROVAL_STATES.EXPIRED,
    );

    const previousState =
      approval.state;

    approval.state =
      APPROVAL_STATES.EXPIRED;

    approval.decision =
      APPROVAL_DECISIONS.REJECT;

    approval.updatedAt =
      nowIso(this.clock);

    approval.version =
      Number(
        approval.version ?? 1,
      ) + 1;

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            previousState,

          toState:
            APPROVAL_STATES.EXPIRED,

          action:
            APPROVAL_ACTIONS.EXPIRE,

          actor,

          expectedVersion:
            Number(
              approval.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_EXPIRED',
        updated,
        actor,
      ),
    );

    this._metric(
      'approval_expired_total',
      {},
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async verifyForExecution(
    input = {},
  ) {
    const normalized =
      normalizeContext(input);

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      normalized.actor ??
      normalized.executor;

    const normalizedActor =
      actor
        ? this._normalizeActor(
            actor,
            'actor',
          )
        : null;

    if (normalizedActor) {
      this._assertActorTenant(
        normalizedActor,
        approval.tenantId,
        'actor',
      );
    }

    const tenantId =
      this._requireTenant(
        normalized,
      );

    if (
      tenantId !==
      approval.tenantId
    ) {
      throw new AirtelApprovalWorkflowError(
        'TENANT_SCOPE_MISMATCH',
        'Approval tenant does not match execution tenant.',
        {
          approvalTenantId:
            approval.tenantId,

          executionTenantId:
            tenantId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const provider =
      this._requireProvider(
        normalized,
      );

    if (
      provider !==
      approval.provider
    ) {
      throw new AirtelApprovalWorkflowError(
        'PROVIDER_SCOPE_MISMATCH',
        'Approval provider does not match execution provider.',
        {
          approvalProvider:
            approval.provider,

          executionProvider:
            provider,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      this._validateExpiry(
        approval,
      )
    ) {
      return {
        outcome:
          GOVERNANCE_OUTCOMES.EXPIRED,

        approvalId:
          approval.approvalId,

        executable:
          false,
      };
    }

    try {
      this._assertScopeMatch(
        approval,
        normalized,
      );

      this._assertApprovalUsable(
        approval,
        normalized,
      );
    } catch (error) {
      if (
        error?.code ===
        'APPROVAL_SCOPE_MISMATCH'
      ) {
        return {
          outcome:
            GOVERNANCE_OUTCOMES.STALE,

          approvalId:
            approval.approvalId,

          executable:
            false,

          code:
            error.code,

          details:
            error.details,
        };
      }

      return {
        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        approvalId:
          approval.approvalId,

        executable:
          false,

        code:
          error?.code ??
          'APPROVAL_NOT_EXECUTABLE',

        details:
          sanitizeObject(
            error?.details ??
              {},
          ),
      };
    }

    const impactLevel =
      upper(
        approval.impactLevel,
      ) ??
      IMPACT_LEVELS.NON_FINANCIAL;

    const requiresChecker =
      approvalRequiredForImpact(
        impactLevel,
        this.config,
      );

    if (
      requiresChecker &&
      (
        !approval.maker ||
        !approval.checker ||
        approval.maker ===
          approval.checker
      )
    ) {
      return {
        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        approvalId:
          approval.approvalId,

        executable:
          false,

        code:
          'MAKER_CHECKER_INCOMPLETE',
      };
    }

    if (
      approval.state ===
      APPROVAL_STATES.CONSUMED
    ) {
      return {
        outcome:
          GOVERNANCE_OUTCOMES.REPLAY,

        approvalId:
          approval.approvalId,

        executable:
          false,

        code:
          'APPROVAL_ALREADY_CONSUMED',
      };
    }

    return deepFreeze({
      outcome:
        GOVERNANCE_OUTCOMES.APPROVED,

      approvalId:
        approval.approvalId,

      executable:
        true,

      state:
        approval.state,

      tenantId:
        approval.tenantId,

      provider:
        approval.provider,

      scopeFingerprint:
        approval.scopeFingerprint,

      maker:
        approval.maker,

      checker:
        approval.checker,

      originalIdempotencyKey:
        approval.originalIdempotencyKey,

      expiresAt:
        approval.expiresAt,

      financialSafety:
        Object.freeze({
          preserveOriginalIdempotencyKey:
            true,

          generateNewFinancialIdentity:
            false,

          writeLedgerHere:
            false,

          mutateBalanceHere:
            false,

          authoritativeBoundary:
            'TITECH_FINANCIAL_CORE',
        }),
    });
  }

  async _getApproval(input) {
    const approvalId =
      normalizeString(
        input.approvalId ??
          input.id,
        this.config.maxApprovalIdLength,
      );

    if (!approvalId) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_ID_REQUIRED',
        'approvalId is required.',
      );
    }

    const tenantId =
      this._requireTenant(
        input,
      );

    const getFn =
      this._requireRepository(
        'getById',
      );

    const approval =
      getFn
        ? await getFn(
            approvalId,
            { tenantId },
          )
        : null;

    if (!approval) {
      throw new AirtelApprovalWorkflowError(
        'APPROVAL_NOT_FOUND',
        'Approval could not be found within the tenant scope.',
        {
          approvalId,
          tenantId,
        },
        {
          httpStatus: 404,
        },
      );
    }

    if (
      approval.tenantId !==
      tenantId
    ) {
      throw new AirtelApprovalWorkflowError(
        'TENANT_SCOPE_MISMATCH',
        'Approval tenant scope mismatch.',
        {},
        {
          httpStatus: 404,
        },
      );
    }

    if (
      approval.provider !==
      PROVIDER
    ) {
      throw new AirtelApprovalWorkflowError(
        'PROVIDER_SCOPE_VIOLATION',
        'Approval provider is outside Airtel governance scope.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    return clone(approval);
  }

  async _transition(
    record,
    transition,
  ) {
    const transitionFn =
      this._requireRepository(
        'transition',
        {
          optional:
            true,
        },
      ) ??
      this._requireRepository(
        'atomicTransition',
        {
          optional:
            true,
        },
      ) ??
      this._requireRepository(
        'updateState',
        {
          optional:
            true,
        },
      );

    if (!transitionFn) {
      if (
        this.config
          .failClosedOnPersistenceError
      ) {
        throw new AirtelApprovalWorkflowError(
          'APPROVAL_TRANSITION_REPOSITORY_UNAVAILABLE',
          'An atomic approval transition adapter is required in production.',
          {
            approvalId:
              record.approvalId,
          },
          {
            retryable:
              true,

            httpStatus:
              503,
          },
        );
      }

      return clone(record);
    }

    try {
      const result =
        await transitionFn({
          approvalId:
            record.approvalId,

          tenantId:
            record.tenantId,

          fromState:
            transition.fromState,

          toState:
            transition.toState,

          action:
            transition.action,

          expectedVersion:
            transition.expectedVersion,

          expectedScopeFingerprint:
            record.scopeFingerprint,

          actorId:
            transition.actor?.actorId,

          patch:
            sanitizeObject(
              record,
            ),
        });

      if (!result) {
        throw new AirtelApprovalWorkflowError(
          'APPROVAL_TRANSITION_REJECTED',
          'Approval transition was not committed.',
          {
            approvalId:
              record.approvalId,

            toState:
              transition.toState,
          },
          {
            httpStatus:
              409,
          },
        );
      }

      return clone(result);
    } catch (error) {
      if (
        error instanceof
        AirtelApprovalWorkflowError
      ) {
        throw error;
      }

      this._log(
        'error',
        'Approval state transition failed.',
        {
          approvalId:
            record.approvalId,

          toState:
            transition.toState,

          message:
            error?.message,
        },
      );

      throw new AirtelApprovalWorkflowError(
        'APPROVAL_TRANSITION_FAILED',
        'Approval state transition failed; no execution authorization should be inferred.',
        {
          approvalId:
            record.approvalId,
        },
        {
          retryable:
            true,

          httpStatus:
            503,
        },
      );
    }
  }

  buildExecutionAuthorization(
    input = {},
  ) {
    const approval =
      input.approval ??
      {};

    const actor =
      input.actor ??
      input.executor;

    const scope =
      buildApprovalScope(
        input,
      );

    const fingerprint =
      scopeFingerprint(
        scope,
      );

    if (
      upper(approval.state) !==
      APPROVAL_STATES.APPROVED
    ) {
      return {
        authorized:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        reason:
          'APPROVAL_NOT_APPROVED',
      };
    }

    if (
      approval.scopeFingerprint !==
      fingerprint
    ) {
      return {
        authorized:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.STALE,

        reason:
          'APPROVAL_SCOPE_MISMATCH',
      };
    }

    if (
      this._validateExpiry(
        approval,
      )
    ) {
      return {
        authorized:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.EXPIRED,

        reason:
          'APPROVAL_EXPIRED',
      };
    }

    const impactLevel =
      upper(
        approval.impactLevel,
      ) ??
      IMPACT_LEVELS.NON_FINANCIAL;

    const requiresChecker =
      approvalRequiredForImpact(
        impactLevel,
        this.config,
      );

    if (
      requiresChecker &&
      (
        !approval.maker ||
        !approval.checker ||
        approval.maker ===
          approval.checker
      )
    ) {
      return {
        authorized:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        reason:
          'MAKER_CHECKER_INCOMPLETE',
      };
    }

    if (actor) {
      const executionActor =
        actorKey(actor);

      if (
        executionActor &&
        approval.maker ===
          executionActor &&
        requiresChecker &&
        !input.allowMakerExecution
      ) {
        return {
          authorized:
            false,

          outcome:
            GOVERNANCE_OUTCOMES.INVALID,

          reason:
            'MAKER_EXECUTION_RESTRICTION',
        };
      }
    }

    return deepFreeze({
      authorized:
        true,

      outcome:
        GOVERNANCE_OUTCOMES.APPROVED,

      approvalId:
        approval.approvalId,

      tenantId:
        approval.tenantId,

      provider:
        approval.provider,

      scopeFingerprint:
        approval.scopeFingerprint,

      originalIdempotencyKey:
        approval.originalIdempotencyKey,

      financialSafety:
        Object.freeze({
          preserveOriginalIdempotencyKey:
            true,

          generateNewFinancialIdentity:
            false,

          writeLedgerHere:
            false,

          mutateBalanceHere:
            false,

          authoritativeBoundary:
            'TITECH_FINANCIAL_CORE',
        }),
    });
  }

  requestApproval(
    input = {},
  ) {
    return this.create(input);
  }

  submitForApproval(
    input = {},
  ) {
    return this.submit(input);
  }

  approveRequest(
    input = {},
  ) {
    return this.approve(input);
  }

  rejectRequest(
    input = {},
  ) {
    return this.reject(input);
  }

  cancelRequest(
    input = {},
  ) {
    return this.cancel(input);
  }

  verifyApproval(
    input = {},
  ) {
    return this.verifyForExecution(
      input,
    );
  }

  health() {
    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      healthy:
        Boolean(
          this.repository,
        ),

      repositoryConfigured:
        Boolean(
          this.repository,
        ),

      auditConfigured:
        Boolean(
          this.audit,
        ),

      policyConfigured:
        Boolean(
          this.policy,
        ),

      makerCheckerDefault:
        this.config
          .requireMakerCheckerForFinancialImpact,
    };
  }
}

export const defaultApprovalWorkflow =
  createApprovalWorkflow({
    repository: null,
  });

// Aliases retained for simple dependency wiring and backwards-compatible naming.
export const approvalWorkflow =
  defaultApprovalWorkflow;

export const AirtelPaymentApprovalWorkflow =
  AirtelApprovalWorkflow;

export default AirtelApprovalWorkflow;