'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Approval Workflow
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/approvalWorkflow.js
 *
 * Architectural Role
 * ------------------
 * Canonical maker-checker governance boundary for Airtel outbound disbursements.
 * This module is deliberately independent from provider transport, ledger
 * posting, wallet mutation, fraud execution and persistence implementation.
 * It authorizes a specific immutable disbursement intent and produces an
 * execution authorization that the canonical financial/disbursement service
 * may consume.
 *
 * Responsibilities
 * ----------------
 * • Validate tenant/provider/operation boundaries.
 * • Normalize and fingerprint the exact disbursement intent.
 * • Enforce maker-checker separation of duties.
 * • Enforce policy-engine decisions and requester/checker permissions.
 * • Support configurable approval thresholds and multiple approvers.
 * • Enforce approval expiry, stale-plan protection and replay protection.
 * • Require preservation of the original financial idempotency identity.
 * • Persist state only through injected atomic repository adapters.
 * • Produce sanitized audit evidence and optional durable domain events.
 * • Verify an approval immediately before execution.
 *
 * Non-responsibilities
 * --------------------
 * • No Airtel HTTP/API calls.
 * • No OAuth/token/secret/PIN/OTP/credential handling.
 * • No direct Mongo/Mongoose writes.
 * • No balance, wallet, ledger or journal mutation.
 * • No fraud/KYC/AML/sanctions decision replacement.
 * • No settlement finality decision.
 * • No assumption that LOCAL_ONLY/PENDING_SYNC equals server acceptance.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. An approval is bound to a deterministic scope fingerprint.
 * 2. Financial execution keeps the original idempotency key and transaction
 *    identity; the approval workflow never creates a replacement financial key.
 * 3. Maker and checker are distinct principals for financial disbursements.
 * 4. Tenant and provider scopes are immutable authorization boundaries.
 * 5. A regulatory BLOCK, unresolved conflict or stale operation cannot be
 *    overridden by human approval.
 * 6. Expired, rejected, cancelled, superseded and consumed approvals cannot be
 *    reused.
 * 7. Persistence transitions must be atomic and optimistic-concurrency safe.
 * 8. Audit payloads are sanitized and must not contain secrets or raw provider
 *    payloads.
 * 9. Approval is authorization evidence, not financial settlement evidence.
 *
 * Module Format
 * -------------
 * ESM-compatible. No static project-internal imports are used to avoid circular
 * dependency risk during payment-module bootstrap.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const ENGINE_NAME = 'airtel-disbursement-approval-workflow';
export const ENGINE_VERSION = '2.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const OPERATION = 'AIRTEL_DISBURSEMENT';

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
  DISBURSEMENT: 'DISBURSEMENT',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
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

const TERMINAL_STATES = new Set([
  APPROVAL_STATES.REJECTED,
  APPROVAL_STATES.CANCELLED,
  APPROVAL_STATES.EXPIRED,
  APPROVAL_STATES.SUPERSEDED,
  APPROVAL_STATES.CONSUMED,
  APPROVAL_STATES.EXECUTION_FAILED,
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [APPROVAL_STATES.DRAFT]: new Set([
    APPROVAL_STATES.PENDING,
    APPROVAL_STATES.APPROVED,
    APPROVAL_STATES.CANCELLED,
  ]),

  [APPROVAL_STATES.PENDING]: new Set([
    APPROVAL_STATES.PENDING,
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

  [APPROVAL_STATES.CONSUMED]: new Set([
    APPROVAL_STATES.EXECUTION_FAILED,
  ]),

  [APPROVAL_STATES.EXECUTION_FAILED]: new Set([]),
});

const DEFAULTS = Object.freeze({
  requireTenantId: true,
  enforceAirtelProvider: true,
  requirePolicyEngine: true,
  requireAuditBoundary: true,
  requireAtomicTransitions: true,

  requireMakerChecker: true,
  allowMakerToExecute: false,
  requireOriginalIdempotencyKey: true,
  requireReference: true,
  requireCurrency: true,
  requireAmountMinor: true,
  requireBeneficiaryIdentity: false,

  defaultTtlMs: 15 * 60 * 1000,
  minTtlMs: 30 * 1000,
  maxTtlMs: 24 * 60 * 60 * 1000,

  defaultRequiredApprovers: 1,
  maxRequiredApprovers: 5,

  /*
   * Optional local amount tiers. Policy-engine results always take precedence.
   * Values are expressed in minor units as canonical decimal strings.
   */
  amountApprovalTiers: Object.freeze([]),

  maxApprovalIdLength: 160,
  maxTenantIdLength: 160,
  maxActorIdLength: 160,
  maxReferenceLength: 240,
  maxIdempotencyKeyLength: 240,
  maxCommentLength: 2000,
  maxMetadataKeys: 80,
  maxMetadataDepth: 5,
  maxMetadataArray: 50,
  maxMetadataStringLength: 500,

  requireApprovalReason: true,
  requireRejectionReason: true,
  requireCancellationReason: true,
  requireSupersedeReason: true,

  failClosedOnPersistenceError: true,
  failClosedOnPolicyError: true,
  failClosedOnAuditError: true,
  failClosedOnEventError: false,

  eventTypePrefix: 'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL',
});

const SECRET_FIELD_PATTERN =
  /(password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|card(number)?|private.?key|access.?key|api.?key|signature|credential|raw(request|response)|provider.?payload|msisdn|phone|mobile)/i;

const SENSITIVE_PATH_PATTERN =
  /(request|response)\.(body|payload|headers|raw)|(^|\.)(authorization|cookie|token|secret|password|pin|otp|cvv|pan|msisdn|phone|mobile)$/i;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const isFunction = (value) => typeof value === 'function';

const clone = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value, maxLength = 240) => {
  if (value === undefined || value === null) return undefined;

  const normalized = String(value).trim();

  if (!normalized) return undefined;

  return normalized.slice(0, maxLength);
};

const upper = (value) => normalizeString(value, 120)?.toUpperCase();

const decimalString = (value) => {
  if (value === undefined || value === null) return undefined;

  const normalized = String(value).trim();

  if (!normalized) return undefined;

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;

  return normalized.replace(/^0+(?=\d)/, '');
};

const integerString = (value) => {
  if (value === undefined || value === null) return undefined;

  const normalized = String(value).trim();

  if (!/^\d+$/.test(normalized)) return undefined;

  return normalized.replace(/^0+(?=\d)/, '');
};

const compareMinorUnits = (left, right) => {
  const a = integerString(left);
  const b = integerString(right);

  if (a === undefined || b === undefined) return null;

  const aa = a.replace(/^0+/, '') || '0';
  const bb = b.replace(/^0+/, '') || '0';

  if (aa.length !== bb.length) {
    return aa.length > bb.length ? 1 : -1;
  }

  if (aa === bb) return 0;

  return aa > bb ? 1 : -1;
};

const stableSerialize = (value) => {
  if (value === undefined) return 'undefined';

  if (value === null) return 'null';

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

const deepFreeze = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
};

const sanitizeObject = (
  value,
  path = '',
  depth = 0,
  limits = {},
) => {
  const maxDepth = limits.maxDepth ?? 5;
  const maxKeys = limits.maxKeys ?? 80;
  const maxArray = limits.maxArray ?? 50;
  const maxStringLength = limits.maxStringLength ?? 500;

  if (depth > maxDepth) return '[TRUNCATED]';

  if (value === undefined || value === null) {
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

  const result = {};

  for (const key of Object.keys(value).slice(0, maxKeys)) {
    const childPath = path ? `${path}.${key}` : key;

    if (
      SECRET_FIELD_PATTERN.test(key) ||
      SENSITIVE_PATH_PATTERN.test(childPath)
    ) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeObject(
        value[key],
        childPath,
        depth + 1,
        limits,
      );
    }
  }

  return result;
};

const nowMs = (clock) => {
  try {
    const value = clock?.now?.();

    return Number.isFinite(value)
      ? value
      : Date.now();
  } catch {
    return Date.now();
  }
};

const nowIso = (clock) =>
  new Date(nowMs(clock)).toISOString();

const actorIdOf = (actor) =>
  normalizeString(
    actor?.actorId ??
      actor?.userId ??
      actor?.principalId ??
      actor?.id,
    160,
  );

const actorRoleOf = (actor) =>
  upper(
    actor?.role ??
      actor?.actorRole ??
      actor?.type,
  );

const riskRank = Object.freeze({
  [RISK_LEVELS.LOW]: 1,
  [RISK_LEVELS.MEDIUM]: 2,
  [RISK_LEVELS.HIGH]: 3,
  [RISK_LEVELS.CRITICAL]: 4,
});

const isRiskElevated = (riskLevel) =>
  (riskRank[upper(riskLevel)] ?? 2) >=
  riskRank[RISK_LEVELS.HIGH];

const isOfflineUnsafe = (state) =>
  new Set([
    OFFLINE_STATES.LOCAL_ONLY,
    OFFLINE_STATES.PENDING_SYNC,
    OFFLINE_STATES.SYNCING,
    OFFLINE_STATES.SERVER_REJECTED,
    OFFLINE_STATES.CONFLICT,
    OFFLINE_STATES.REQUIRES_REVIEW,
  ]).has(upper(state));

export class AirtelDisbursementApprovalError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);

    this.name = 'AirtelDisbursementApprovalError';
    this.code = code;
    this.component = COMPONENT;
    this.provider = PROVIDER;
    this.operation = OPERATION;
    this.details = sanitizeObject(details);
    this.retryable = Boolean(options.retryable);
    this.httpStatus = options.httpStatus ?? 400;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      component: this.component,
      provider: this.provider,
      operation: this.operation,
      details: this.details,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
    };
  }
}

export const isApprovalStateTerminal = (state) =>
  TERMINAL_STATES.has(upper(state));

export const isApprovalStateActive = (state) =>
  [
    APPROVAL_STATES.PENDING,
    APPROVAL_STATES.APPROVED,
  ].includes(upper(state));

export const canTransition = (from, to) =>
  Boolean(
    ALLOWED_TRANSITIONS[upper(from)]?.has(upper(to)),
  );

export const normalizeActor = (
  actor,
  fieldName = 'actor',
) => {
  if (!isPlainObject(actor)) {
    throw new AirtelDisbursementApprovalError(
      'ACTOR_REQUIRED',
      `${fieldName} is required.`,
    );
  }

  const actorId = actorIdOf(actor);

  if (!actorId) {
    throw new AirtelDisbursementApprovalError(
      'ACTOR_ID_REQUIRED',
      `${fieldName}.actorId is required.`,
    );
  }

  return {
    actorId,
    role: actorRoleOf(actor),
    tenantId: normalizeString(
      actor.tenantId,
      160,
    ),
    displayName: normalizeString(
      actor.displayName ?? actor.name,
      240,
    ),
    source: normalizeString(
      actor.source ?? actor.authSource,
      120,
    ),
  };
};

export const normalizeContext = (
  input = {},
  limits = {},
) => {
  if (!isPlainObject(input)) {
    throw new AirtelDisbursementApprovalError(
      'INVALID_INPUT',
      'Approval workflow input must be an object.',
    );
  }

  return sanitizeObject(
    clone(input),
    '',
    0,
    limits,
  );
};

export const buildDisbursementScope = (
  input = {},
) => {
  const plan = input.commandPlan ?? input.plan ?? {};
  const identity =
    input.paymentIdentity ??
    input.payment ??
    {};
  const beneficiary =
    input.beneficiary ?? {};

  const beneficiaryId = normalizeString(
    input.beneficiaryId ??
      identity.beneficiaryId ??
      beneficiary.beneficiaryId ??
      beneficiary.id,
    240,
  );

  const beneficiaryHash = beneficiaryId
    ? sha256(`beneficiary:${beneficiaryId}`)
    : undefined;

  const normalized = {
    tenantId: normalizeString(
      input.tenantId ??
        plan.tenantId ??
        identity.tenantId,
      160,
    ),

    provider: upper(
      input.provider ??
        plan.provider ??
        identity.provider ??
        PROVIDER,
    ),

    operation: OPERATION,

    action: upper(
      input.action ??
        plan.action ??
        'DISBURSE',
    ),

    commandId: normalizeString(
      input.commandId ??
        plan.commandId ??
        identity.commandId,
      240,
    ),

    reference: normalizeString(
      input.reference ??
        plan.reference ??
        identity.reference,
      240,
    ),

    paymentId: normalizeString(
      input.paymentId ??
        identity.paymentId,
      240,
    ),

    transactionId: normalizeString(
      input.transactionId ??
        identity.transactionId,
      240,
    ),

    originalIdempotencyKey: normalizeString(
      input.originalIdempotencyKey ??
        identity.originalIdempotencyKey ??
        identity.idempotencyKey ??
        plan.originalIdempotencyKey,
      240,
    ),

    beneficiaryId,

    beneficiaryHash,

    amount: decimalString(
      input.amount ??
        plan.amount ??
        identity.amount,
    ),

    amountMinor: integerString(
      input.amountMinor ??
        plan.amountMinor ??
        identity.amountMinor,
    ),

    currency: upper(
      input.currency ??
        plan.currency ??
        identity.currency,
    ),

    purposeCode: normalizeString(
      input.purposeCode ??
        plan.purposeCode ??
        identity.purposeCode,
      120,
    ),

    impactLevel:
      IMPACT_LEVELS.DISBURSEMENT,

    riskLevel: upper(
      input.riskLevel ??
        plan.riskLevel,
    ),

    offlineState: upper(
      input.offlineState ??
        plan.offlineState ??
        identity.offlineState,
    ),

    regulatoryDecision: upper(
      input.regulatoryDecision ??
        plan.regulatoryDecision ??
        plan.regulatoryOutcome,
    ),

    policyVersion: normalizeString(
      input.policyVersion ??
        plan.policyVersion,
      120,
    ),
  };

  const customScope = isPlainObject(
    input.scope,
  )
    ? sanitizeObject(
        input.scope,
        'scope',
        0,
        {
          maxDepth: 4,
          maxKeys: 40,
          maxArray: 40,
          maxStringLength: 400,
        },
      )
    : undefined;

  return {
    ...normalized,
    ...(customScope
      ? { customScope }
      : {}),
  };
};

export const disbursementScopeFingerprint = (
  input,
) =>
  sha256(
    buildDisbursementScope(input),
  );

export const scopeFingerprint =
  disbursementScopeFingerprint;

const approvalTierForAmount = (
  amountMinor,
  tiers = [],
) => {
  if (
    !Array.isArray(tiers) ||
    tiers.length === 0
  ) {
    return null;
  }

  const ordered = [...tiers]
    .filter((tier) =>
      isPlainObject(tier),
    )
    .sort((a, b) => {
      const left =
        integerString(
          a.minAmountMinor,
        ) ?? '0';

      const right =
        integerString(
          b.minAmountMinor,
        ) ?? '0';

      return (
        compareMinorUnits(
          left,
          right,
        ) ?? 0
      );
    });

  let selected = null;

  for (const tier of ordered) {
    const minimum =
      integerString(
        tier.minAmountMinor,
      ) ?? '0';

    const comparison =
      compareMinorUnits(
        amountMinor,
        minimum,
      );

    if (
      comparison !== null &&
      comparison >= 0
    ) {
      selected = tier;
    }
  }

  return selected;
};

const requiredApproversFromPolicy = (
  policy,
  amountMinor,
  config,
) => {
  const policyCount = Number(
    policy?.requiredApprovers,
  );

  if (
    Number.isInteger(policyCount) &&
    policyCount > 0
  ) {
    return Math.min(
      config.maxRequiredApprovers,
      policyCount,
    );
  }

  const tier =
    approvalTierForAmount(
      amountMinor,
      config.amountApprovalTiers,
    );

  const tierCount = Number(
    tier?.requiredApprovers,
  );

  if (
    Number.isInteger(tierCount) &&
    tierCount > 0
  ) {
    return Math.min(
      config.maxRequiredApprovers,
      tierCount,
    );
  }

  return Math.min(
    config.maxRequiredApprovers,
    Math.max(
      1,
      config.defaultRequiredApprovers,
    ),
  );
};

const normalizeRequiredRoles = (
  policy = {},
) => {
  const roles =
    policy.allowedCheckerRoles ??
    policy.requiredCheckerRoles;

  if (!Array.isArray(roles)) {
    return [];
  }

  return [
    ...new Set(
      roles
        .map(upper)
        .filter(Boolean),
    ),
  ];
};

const normalizePositiveInteger = (
  value,
  fallback,
  max,
) => {
  const candidate = Number(value);

  if (
    !Number.isInteger(candidate) ||
    candidate < 1
  ) {
    return fallback;
  }

  return Math.min(
    max,
    candidate,
  );
};

const policyDecision = (policy) =>
  upper(
    policy?.decision ??
      policy?.outcome ??
      (
        policy?.allowed === false
          ? APPROVAL_DECISIONS.REJECT
          : undefined
      ),
  );

const policyAllowed = (policy) => {
  if (
    !policy ||
    typeof policy !== 'object'
  ) {
    return false;
  }

  if (policy.allowed === true) {
    return true;
  }

  if (policy.allowed === false) {
    return false;
  }

  return [
    APPROVAL_DECISIONS.APPROVE,
    APPROVAL_DECISIONS.REQUIRE_REVIEW,
  ].includes(
    policyDecision(policy),
  );
};

export class AirtelDisbursementApprovalWorkflow {
  constructor(options = {}) {
    const configuration = {
      ...DEFAULTS,
      ...(
        options.config ??
        options.configuration ??
        {}
      ),
    };

    this.config =
      Object.freeze(configuration);

    this.approvalRepository =
      options.approvalRepository ??
      options.repository ??
      options.store ??
      null;

    this.policyEngine =
      options.policyEngine ??
      options.policy ??
      options.policyService ??
      null;

    this.roleService =
      options.roleService ??
      options.authorizationService ??
      null;

    this.userService =
      options.userService ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
      options.outboxService ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.logger =
      options.logger ??
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

  _throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelDisbursementApprovalError(
      code,
      message,
      details,
      options,
    );
  }

  _repositoryMethod(...names) {
    for (const name of names) {
      const candidate =
        this.approvalRepository?.[name];

      if (isFunction(candidate)) {
        return candidate.bind(
          this.approvalRepository,
        );
      }
    }

    return null;
  }

  _requireRepository(
    methods,
    message,
    options = {},
  ) {
    const method =
      this._repositoryMethod(...methods);

    if (method) {
      return method;
    }

    if (options.optional) {
      return null;
    }

    if (
      this.config
        .failClosedOnPersistenceError ||
      this.config
        .requireAtomicTransitions
    ) {
      this._throw(
        options.code ??
          'APPROVAL_REPOSITORY_UNAVAILABLE',
        message ??
          `Repository method is required: ${methods.join(', ')}`,
        { methods },
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    return null;
  }

  _requireTenant(input) {
    const tenantId =
      normalizeString(
        input?.tenantId,
        this.config.maxTenantIdLength,
      );

    if (
      this.config.requireTenantId &&
      !tenantId
    ) {
      this._throw(
        'TENANT_REQUIRED',
        'tenantId is required for approval governance.',
      );
    }

    return tenantId;
  }

  _requireProvider(input) {
    const provider =
      upper(
        input?.provider ??
          PROVIDER,
      ) ?? PROVIDER;

    if (
      this.config
        .enforceAirtelProvider &&
      provider !== PROVIDER
    ) {
      this._throw(
        'PROVIDER_SCOPE_VIOLATION',
        'This approval workflow is scoped to Airtel disbursements.',
        { provider },
        {
          httpStatus: 409,
        },
      );
    }

    return provider;
  }

  _validateActorTenant(
    actor,
    tenantId,
    fieldName,
  ) {
    if (
      actor.tenantId &&
      tenantId &&
      actor.tenantId !== tenantId
    ) {
      this._throw(
        'ACTOR_TENANT_MISMATCH',
        `${fieldName} does not belong to the approval tenant.`,
        { fieldName },
        {
          httpStatus: 403,
        },
      );
    }
  }

  _validateInput(
    input,
    {
      requireReference =
        this.config.requireReference,
    } = {},
  ) {
    const tenantId =
      this._requireTenant(input);

    const provider =
      this._requireProvider(input);

    const scope =
      buildDisbursementScope(input);

    if (
      scope.provider !==
      provider
    ) {
      this._throw(
        'PROVIDER_SCOPE_MISMATCH',
        'Disbursement scope provider does not match the requested provider.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    if (
      requireReference &&
      !scope.reference
    ) {
      this._throw(
        'REFERENCE_REQUIRED',
        'A stable disbursement reference is required.',
      );
    }

    if (
      this.config.requireCurrency &&
      !scope.currency
    ) {
      this._throw(
        'CURRENCY_REQUIRED',
        'Disbursement currency is required.',
      );
    }

    if (
      this.config.requireAmountMinor &&
      !scope.amountMinor
    ) {
      this._throw(
        'AMOUNT_MINOR_REQUIRED',
        'Disbursement amountMinor is required for approval fingerprinting. Financial amounts must be supplied as canonical minor units.',
      );
    }

    if (
      scope.amountMinor ===
      '0'
    ) {
      this._throw(
        'INVALID_AMOUNT',
        'Disbursement amount must be greater than zero.',
      );
    }

    if (
      this.config
        .requireOriginalIdempotencyKey &&
      !scope.originalIdempotencyKey
    ) {
      this._throw(
        'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
        'The original financial idempotency key is required for disbursement approval.',
      );
    }

    if (
      this.config
        .requireBeneficiaryIdentity &&
      !scope.beneficiaryId
    ) {
      this._throw(
        'BENEFICIARY_ID_REQUIRED',
        'A canonical beneficiary identifier is required for disbursement approval.',
      );
    }

    if (
      isOfflineUnsafe(
        scope.offlineState,
      )
    ) {
      this._throw(
        'OFFLINE_OPERATION_REQUIRES_REVIEW',
        'A disbursement in an unresolved offline state cannot receive execution authorization.',
        {
          offlineState:
            scope.offlineState,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      [
        APPROVAL_DECISIONS.BLOCK,
        APPROVAL_DECISIONS.REJECT,
        'DENY',
        'BLOCKED',
      ].includes(
        scope.regulatoryDecision,
      )
    ) {
      this._throw(
        'REGULATORY_BLOCK',
        'Approval cannot override a regulatory block.',
        {
          regulatoryDecision:
            scope.regulatoryDecision,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return {
      tenantId,
      provider,
      scope,
    };
  }

  _ttl(value) {
    const requested =
      Number(value);

    if (
      !Number.isFinite(
        requested,
      )
    ) {
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

  _expiryIsReached(record) {
    const expiresAt =
      new Date(
        record?.expiresAt,
      ).getTime();

    if (
      !Number.isFinite(
        expiresAt,
      )
    ) {
      this._throw(
        'INVALID_EXPIRY',
        'Approval expiry is invalid.',
        {
          approvalId:
            record?.approvalId,
        },
      );
    }

    return (
      expiresAt <=
      nowMs(this.clock)
    );
  }

  _assertTransition(
    fromState,
    toState,
  ) {
    if (
      !canTransition(
        fromState,
        toState,
      )
    ) {
      this._throw(
        'INVALID_STATE_TRANSITION',
        `Cannot transition approval from ${fromState} to ${toState}.`,
        {
          fromState,
          toState,
        },
        {
          httpStatus: 409,
        },
      );
    }
  }

  _assertMakerCheckerDistinct(
    makerId,
    checkerId,
  ) {
    if (
      !makerId ||
      !checkerId
    ) {
      this._throw(
        'MAKER_CHECKER_INCOMPLETE',
        'Both maker and checker identities are required for financial disbursement approval.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    if (
      makerId ===
      checkerId
    ) {
      this._throw(
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

  _assertCheckerRole(
    checker,
    requiredRoles = [],
  ) {
    if (
      !requiredRoles.length
    ) {
      return;
    }

    const role =
      actorRoleOf(checker);

    if (
      !role ||
      !requiredRoles.includes(
        role,
      )
    ) {
      this._throw(
        'CHECKER_ROLE_NOT_AUTHORIZED',
        'Checker role is not authorized for this approval requirement.',
        {
          requiredRoles,
        },
        {
          httpStatus: 403,
        },
      );
    }
  }

  async _evaluatePolicy(
    action,
    input,
  ) {
    if (!this.policyEngine) {
      if (
        this.config
          .requirePolicyEngine ||
        this.config
          .failClosedOnPolicyError
      ) {
        this._throw(
          'APPROVAL_POLICY_UNAVAILABLE',
          'A disbursement approval policy engine is required before financial authorization can proceed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        allowed: true,
        decision:
          APPROVAL_DECISIONS.REQUIRE_REVIEW,
        requiredApprovers:
          this.config.defaultRequiredApprovers,
        source: 'CONFIGURATION',
      };
    }

    const method =
      this.policyEngine
        .evaluateApproval ??
      this.policyEngine
        .evaluate ??
      this.policyEngine
        .assess;

    if (
      !isFunction(method)
    ) {
      if (
        this.config
          .failClosedOnPolicyError
      ) {
        this._throw(
          'APPROVAL_POLICY_CONTRACT_INVALID',
          'Configured approval policy engine does not expose evaluateApproval/evaluate/assess.',
          {},
          {
            retryable: false,
            httpStatus: 503,
          },
        );
      }

      return {
        allowed: true,
        decision:
          APPROVAL_DECISIONS.REQUIRE_REVIEW,
        requiredApprovers:
          this.config.defaultRequiredApprovers,
        source: 'CONFIGURATION',
      };
    }

    try {
      const result =
        (
          await method.call(
            this.policyEngine,
            {
              action,
              operation: OPERATION,
              provider: PROVIDER,
              tenantId:
                input.tenantId,
              amount:
                input.amount,
              amountMinor:
                input.amountMinor,
              currency:
                input.currency,
              reference:
                input.reference,
              impactLevel:
                IMPACT_LEVELS.DISBURSEMENT,
              riskLevel:
                input.riskLevel,
              maker:
                input.maker,
              checker:
                input.checker,
              metadata:
                sanitizeObject(
                  input.metadata ??
                    {},
                  'metadata',
                  0,
                  this._metadataLimits(),
                ),
              scope:
                sanitizeObject(
                  input.scope ?? {},
                  'scope',
                  0,
                  this._metadataLimits(),
                ),
              approval:
                sanitizeObject(
                  input.approval ??
                    {},
                  'approval',
                  0,
                  this._metadataLimits(),
                ),
            },
          )
        ) ?? {};

      return sanitizeObject(
        result,
        'policy',
        0,
        this._metadataLimits(),
      );
    } catch (error) {
      this._log(
        'error',
        'Airtel disbursement approval policy evaluation failed.',
        {
          code:
            'APPROVAL_POLICY_EVALUATION_FAILED',
          message:
            error?.message,
          action,
        },
      );

      if (
        this.config
          .failClosedOnPolicyError
      ) {
        this._throw(
          'APPROVAL_POLICY_UNAVAILABLE',
          'Approval policy evaluation failed; financial authorization is blocked until policy evaluation is available.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        allowed: true,
        decision:
          APPROVAL_DECISIONS.REQUIRE_REVIEW,
        requiredApprovers:
          this.config.defaultRequiredApprovers,
        source:
          'POLICY_ERROR_FAILSAFE',
      };
    }
  }

  async _checkRequesterPermission(
    tenantId,
    requestedBy,
    context,
  ) {
    const method =
      this.roleService
        ?.canRequest ??
      this.authorizationService
        ?.canRequest ??
      this.roleService
        ?.authorizeRequest;

    if (
      !isFunction(method)
    ) {
      return true;
    }

    const allowed =
      await method.call(
        this.roleService ??
          this.authorizationService,
        {
          tenantId,
          userId:
            requestedBy,
          actorId:
            requestedBy,
          operation:
            OPERATION,
          amountMinor:
            context.amountMinor,
          currency:
            context.currency,
        },
      );

    if (!allowed) {
      this._throw(
        'REQUESTER_NOT_AUTHORIZED',
        'Requester is not authorized to create Airtel disbursement approvals.',
        {},
        {
          httpStatus: 403,
        },
      );
    }

    return true;
  }

  async _checkCheckerPermission(
    tenantId,
    checker,
    record,
    policy,
  ) {
    const method =
      this.roleService
        ?.canApprove ??
      this.roleService
        ?.authorizeApproval ??
      this.authorizationService
        ?.canApprove;

    if (
      isFunction(method)
    ) {
      const allowed =
        await method.call(
          this.roleService ??
            this.authorizationService,
          {
            tenantId,
            userId:
              checker.actorId,
            actorId:
              checker.actorId,
            operation:
              OPERATION,
            amountMinor:
              record.amountMinor,
            currency:
              record.currency,
            riskLevel:
              record.riskLevel,
            approvalId:
              record.approvalId,
          },
        );

      if (!allowed) {
        this._throw(
          'CHECKER_NOT_AUTHORIZED',
          'Checker is not authorized to approve this Airtel disbursement.',
          {},
          {
            httpStatus: 403,
          },
        );
      }
    }

    this._assertCheckerRole(
      checker,
      normalizeRequiredRoles(
        policy,
      ),
    );

    return true;
  }

  _metadataLimits() {
    return {
      maxDepth:
        this.config
          .maxMetadataDepth,
      maxKeys:
        this.config
          .maxMetadataKeys,
      maxArray:
        this.config
          .maxMetadataArray,
      maxStringLength:
        this.config
          .maxMetadataStringLength,
    };
  }

  _buildApprovalRecord(
    input,
    maker,
    scope,
    fingerprint,
    policy,
  ) {
    const approvalId =
      normalizeString(
        input.approvalId,
        this.config
          .maxApprovalIdLength,
      ) ??
      this.idFactory();

    const now =
      nowIso(this.clock);

    const amountMinor =
      scope.amountMinor;

    const requiredApprovers =
      requiredApproversFromPolicy(
        policy,
        amountMinor,
        this.config,
      );

    const approvalRequired =
      (
        this.config
          .requireMakerChecker ||
        policy?.requiresApproval !== false
      ) &&
      policy?.autoApprove !== true &&
      requiredApprovers > 0;

    const state =
      approvalRequired
        ? APPROVAL_STATES.DRAFT
        : APPROVAL_STATES.APPROVED;

    const decision =
      approvalRequired
        ? APPROVAL_DECISIONS.REQUIRE_REVIEW
        : APPROVAL_DECISIONS.APPROVE;

    const expiresAt =
      new Date(
        nowMs(this.clock) +
          this._ttl(
            input.ttlMs,
          ),
      ).toISOString();

    return {
      approvalId,
      approvalVersion: 1,

      engineName: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,
      component: COMPONENT,

      provider: PROVIDER,
      operation: OPERATION,
      tenantId: scope.tenantId,

      state,
      decision,
      approvalRequired,
      requiredApprovers,

      approvals: [],

      maker: maker.actorId,
      makerActor: maker,

      checker: undefined,
      checkerActor: undefined,

      requiredCheckerRoles:
        normalizeRequiredRoles(
          policy,
        ),

      reference:
        scope.reference,

      paymentId:
        scope.paymentId,

      transactionId:
        scope.transactionId,

      commandId:
        scope.commandId,

      originalIdempotencyKey:
        scope.originalIdempotencyKey,

      amount:
        scope.amount,

      amountMinor:
        amountMinor,

      currency:
        scope.currency,

      beneficiaryId:
        scope.beneficiaryId,

      beneficiaryHash:
        scope.beneficiaryHash,

      purposeCode:
        scope.purposeCode,

      impactLevel:
        IMPACT_LEVELS.DISBURSEMENT,

      riskLevel:
        upper(
          scope.riskLevel ??
            policy?.riskLevel,
        ) ??
        RISK_LEVELS.MEDIUM,

      policyVersion:
        normalizeString(
          policy?.policyVersion ??
            scope.policyVersion,
          120,
        ),

      policyDecision:
        policyDecision(policy),

      policySource:
        normalizeString(
          policy?.source ??
            'POLICY_ENGINE',
          120,
        ),

      scope:
        sanitizeObject(
          scope,
          'scope',
          0,
          this._metadataLimits(),
        ),

      scopeFingerprint:
        fingerprint,

      metadata:
        sanitizeObject(
          input.metadata ?? {},
          'metadata',
          0,
          this._metadataLimits(),
        ),

      createdAt:
        input.createdAt ??
        now,

      updatedAt:
        now,

      submittedAt:
        undefined,

      approvedAt:
        approvalRequired
          ? undefined
          : now,

      rejectedAt:
        undefined,

      cancelledAt:
        undefined,

      expiredAt:
        undefined,

      supersededAt:
        undefined,

      consumedAt:
        undefined,

      executionFailedAt:
        undefined,

      executionFailure:
        undefined,

      expiresAt,

      version: 1,

      auditFingerprint:
        undefined,
    };
  }

  _auditEvent(
    type,
    record,
    actor,
    extra = {},
  ) {
    const event = {
      type,
      engineName:
        ENGINE_NAME,
      engineVersion:
        ENGINE_VERSION,
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        OPERATION,

      approvalId:
        record.approvalId,

      tenantId:
        record.tenantId,

      state:
        record.state,

      decision:
        record.decision,

      maker:
        record.maker,

      checker:
        record.checker,

      actorId:
        actor?.actorId,

      reference:
        record.reference,

      amountMinor:
        record.amountMinor,

      currency:
        record.currency,

      riskLevel:
        record.riskLevel,

      requiredApprovers:
        record.requiredApprovers,

      approvalCount:
        Array.isArray(
          record.approvals,
        )
          ? record.approvals.length
          : 0,

      scopeFingerprint:
        record.scopeFingerprint,

      at:
        nowIso(this.clock),

      ...sanitizeObject(
        extra,
        'extra',
        0,
        this._metadataLimits(),
      ),
    };

    return deepFreeze({
      ...event,
      auditFingerprint:
        sha256(event),
    });
  }

  async _writeAudit(event) {
    const method =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write;

    if (
      !isFunction(method)
    ) {
      if (
        this.config
          .requireAuditBoundary ||
        this.config
          .failClosedOnAuditError
      ) {
        this._throw(
          'APPROVAL_AUDIT_UNAVAILABLE',
          'Approval audit boundary is required for financial governance.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return null;
    }

    try {
      return await method.call(
        this.auditService,
        event,
      );
    } catch (error) {
      this._log(
        'error',
        'Airtel disbursement approval audit write failed.',
        {
          code:
            'APPROVAL_AUDIT_WRITE_FAILED',
          approvalId:
            event.approvalId,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        this._throw(
          'APPROVAL_AUDIT_UNAVAILABLE',
          'Approval governance cannot continue because its audit boundary failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return null;
    }
  }

  async _publishEvent(
    type,
    record,
    extra = {},
  ) {
    const method =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (
      !isFunction(method)
    ) {
      return null;
    }

    const event = {
      type:
        `${this.config.eventTypePrefix}.${type}`,

      eventId:
        this.idFactory(),

      occurredAt:
        nowIso(this.clock),

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        record.tenantId,

      approvalId:
        record.approvalId,

      state:
        record.state,

      scopeFingerprint:
        record.scopeFingerprint,

      payload:
        sanitizeObject(
          {
            approvalId:
              record.approvalId,

            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            reference:
              record.reference,

            state:
              record.state,

            decision:
              record.decision,

            maker:
              record.maker,

            checker:
              record.checker,

            amountMinor:
              record.amountMinor,

            currency:
              record.currency,

            requiredApprovers:
              record.requiredApprovers,

            approvals:
              record.approvals,

            ...extra,
          },
          'payload',
          0,
          this._metadataLimits(),
        ),
    };

    try {
      return await method.call(
        this.eventBus,
        event,
      );
    } catch (error) {
      this._log(
        'error',
        'Airtel disbursement approval event publication failed.',
        {
          code:
            'APPROVAL_EVENT_PUBLICATION_FAILED',
          approvalId:
            record.approvalId,
          eventType:
            event.type,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this._throw(
          'APPROVAL_EVENT_UNAVAILABLE',
          'Approval state changed but the required event boundary is unavailable.',
          {
            approvalId:
              record.approvalId,
          },
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return null;
    }
  }

  _log(
    level,
    message,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[level] ??
        this.logger?.log ??
        this.logger?.info;

      if (
        !isFunction(method)
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
          operation:
            OPERATION,
          ...sanitizeObject(
            context,
            'log',
            0,
            this._metadataLimits(),
          ),
        },
        message,
      );
    } catch {
      // Logging must never mutate governance outcomes.
    }
  }

  _metric(
    name,
    labels = {},
  ) {
    try {
      const counter =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      if (
        !isFunction(counter)
      ) {
        return;
      }

      counter.call(
        this.metrics,
        name,
        sanitizeObject(
          labels,
        ),
      );
    } catch {
      // Metrics are observational only.
    }
  }

  async _findExisting({
    tenantId,
    approvalId,
    reference,
    originalIdempotencyKey,
  }) {
    if (
      !this.approvalRepository
    ) {
      return null;
    }

    const byId =
      this._repositoryMethod(
        'getById',
        'findById',
      );

    if (
      approvalId &&
      byId
    ) {
      const found =
        await byId(
          approvalId,
          {
            tenantId,
          },
        );

      if (found) {
        return clone(found);
      }
    }

    const byReference =
      this._repositoryMethod(
        'findByReference',
        'getByReference',
      );

    if (
      reference &&
      byReference
    ) {
      const found =
        await byReference({
          tenantId,
          reference,
          operation:
            OPERATION,
        });

      if (found) {
        return clone(found);
      }
    }

    const byIdempotency =
      this._repositoryMethod(
        'findByOriginalIdempotencyKey',
        'findByIdempotencyKey',
      );

    if (
      originalIdempotencyKey &&
      byIdempotency
    ) {
      const found =
        await byIdempotency({
          tenantId,
          originalIdempotencyKey,
          operation:
            OPERATION,
        });

      if (found) {
        return clone(found);
      }
    }

    return null;
  }

  _assertSameScope(
    existing,
    fingerprint,
  ) {
    if (
      !existing?.scopeFingerprint ||
      existing.scopeFingerprint !==
        fingerprint
    ) {
      this._throw(
        'APPROVAL_SCOPE_CONFLICT',
        'An existing approval uses the same business identity but a different disbursement scope.',
        {
          approvalId:
            existing?.approvalId,
        },
        {
          httpStatus: 409,
        },
      );
    }
  }

  async _getApproval(
    input,
  ) {
    const approvalId =
      normalizeString(
        input?.approvalId ??
          input?.id,
        this.config
          .maxApprovalIdLength,
      );

    const reference =
      normalizeString(
        input?.reference,
        this.config
          .maxReferenceLength,
      );

    const tenantId =
      this._requireTenant(input);

    const provider =
      this._requireProvider(input);

    const found =
      await this._findExisting({
        tenantId,
        approvalId,
        reference,
        originalIdempotencyKey:
          normalizeString(
            input?.originalIdempotencyKey ??
              input?.idempotencyKey,
            this.config
              .maxIdempotencyKeyLength,
          ),
      });

    if (!found) {
      this._throw(
        'APPROVAL_NOT_FOUND',
        'Airtel disbursement approval was not found within the tenant scope.',
        {
          approvalId,
          reference,
          provider:
            PROVIDER,
        },
        {
          httpStatus: 404,
        },
      );
    }

    if (
      found.tenantId !==
      tenantId
    ) {
      this._throw(
        'TENANT_SCOPE_MISMATCH',
        'Approval tenant scope does not match execution tenant.',
        {},
        {
          httpStatus: 404,
        },
      );
    }

    if (
      upper(found.provider) !==
        provider ||
      upper(found.provider) !==
        PROVIDER
    ) {
      this._throw(
        'PROVIDER_SCOPE_VIOLATION',
        'Approval provider is outside Airtel disbursement governance scope.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    return clone(found);
  }

  async _transition(
    record,
    transition,
  ) {
    const method =
      this._requireRepository(
        [
          'transition',
          'atomicTransition',
          'compareAndSetTransition',
          'updateState',
        ],
        'An atomic approval transition adapter is required for financial disbursement governance.',
        {
          code:
            'APPROVAL_TRANSITION_REPOSITORY_UNAVAILABLE',
        },
      );

    const patch =
      sanitizeObject(
        transition.patch ?? {},
        'patch',
        0,
        this._metadataLimits(),
      );

    try {
      const result =
        await method({
          approvalId:
            record.approvalId,

          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          fromState:
            transition.fromState,

          toState:
            transition.toState,

          action:
            transition.action,

          actorId:
            transition.actor
              ?.actorId,

          expectedVersion:
            transition.expectedVersion,

          expectedScopeFingerprint:
            record.scopeFingerprint,

          patch,
        });

      if (!result) {
        this._throw(
          'APPROVAL_TRANSITION_REJECTED',
          'Approval state transition was not committed.',
          {
            approvalId:
              record.approvalId,
            toState:
              transition.toState,
          },
          {
            httpStatus: 409,
          },
        );
      }

      return clone(result);
    } catch (error) {
      if (
        error instanceof
        AirtelDisbursementApprovalError
      ) {
        throw error;
      }

      this._log(
        'error',
        'Airtel disbursement approval transition failed.',
        {
          approvalId:
            record.approvalId,
          fromState:
            transition.fromState,
          toState:
            transition.toState,
          message:
            error?.message,
        },
      );

      this._throw(
        'APPROVAL_TRANSITION_FAILED',
        'Approval state transition failed; execution authorization must not be inferred.',
        {
          approvalId:
            record.approvalId,
        },
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }
  }

  async authorize(
    input = {},
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const maker =
      normalizeActor(
        normalized.maker ??
          normalized.requester ??
          normalized.requestedByActor,
        'maker',
      );

    const requestedBy =
      maker.actorId;

    const {
      tenantId,
      provider,
      scope: validatedScope,
    } =
      this._validateInput({
        ...normalized,
        tenantId:
          normalized.tenantId,
        provider:
          normalized.provider,
      });

    this._validateActorTenant(
      maker,
      tenantId,
      'maker',
    );

    await this._checkRequesterPermission(
      tenantId,
      requestedBy,
      validatedScope,
    );

    const policy =
      await this._evaluatePolicy(
        OPERATION,
        {
          ...normalized,
          tenantId,
          provider,
          reference:
            validatedScope.reference,
          amount:
            validatedScope.amount,
          amountMinor:
            validatedScope.amountMinor,
          currency:
            validatedScope.currency,
          maker,
          scope:
            validatedScope,
        },
      );

    if (
      !policyAllowed(policy)
    ) {
      this._metric(
        'airtel.disbursement.approval.policy_rejected',
      );

      this._throw(
        policyDecision(
          policy,
        ) ===
        APPROVAL_DECISIONS.BLOCK
          ? 'APPROVAL_POLICY_BLOCKED'
          : 'APPROVAL_POLICY_REJECTED',

        policy?.reason ??
          'Approval policy rejected this Airtel disbursement.',

        {
          policyDecision:
            policyDecision(
              policy,
            ),
          policySource:
            policy?.source,
        },

        {
          httpStatus: 409,
        },
      );
    }

    /*
     * Policy-derived risk/version becomes part of the immutable scope. This
     * prevents an approval from silently surviving a materially different
     * governance assessment.
     */
    const scope =
      buildDisbursementScope({
        ...normalized,
        tenantId,
        provider,
        riskLevel:
          normalized.riskLevel ??
          policy?.riskLevel,
        policyVersion:
          normalized.policyVersion ??
          policy?.policyVersion,
      });

    const fingerprint =
      disbursementScopeFingerprint({
        ...normalized,
        tenantId,
        provider,
        riskLevel:
          normalized.riskLevel ??
          policy?.riskLevel,
        policyVersion:
          normalized.policyVersion ??
          policy?.policyVersion,
      });

    const existing =
      await this._findExisting({
        tenantId,
        approvalId:
          normalized.approvalId,
        reference:
          scope.reference,
        originalIdempotencyKey:
          scope.originalIdempotencyKey,
      });

    if (existing) {
      this._assertSameScope(
        existing,
        fingerprint,
      );

      return deepFreeze(
        clone(existing),
      );
    }

    const record =
      this._buildApprovalRecord(
        {
          ...normalized,
          tenantId,
          provider,
        },
        maker,
        scope,
        fingerprint,
        policy,
      );

    record.auditFingerprint =
      this._auditEvent(
        'APPROVAL_CREATED',
        record,
        maker,
        {
          approvalRequired:
            record.approvalRequired,
        },
      ).auditFingerprint;

    const createFn =
      this._requireRepository(
        ['create'],
        'An approval repository create adapter is required for financial disbursements.',
        {
          code:
            'APPROVAL_REPOSITORY_UNAVAILABLE',
        },
      );

    const persisted =
      await createFn(
        record,
        {
          idempotencyKey:
            `${tenantId}:airtel-disbursement-approval:${scope.originalIdempotencyKey ?? scope.reference}:${fingerprint}`,
          tenantId,
          expectedScopeFingerprint:
            fingerprint,
        },
      );

    if (!persisted) {
      this._throw(
        'APPROVAL_CREATE_FAILED',
        'Approval request was not persisted.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_CREATED',
        persisted,
        maker,
        {
          approvalRequired:
            record.approvalRequired,
          policyDecision:
            policyDecision(
              policy,
            ),
        },
      ),
    );

    await this._publishEvent(
      'CREATED',
      persisted,
      {
        approvalRequired:
          record.approvalRequired,
      },
    );

    this._metric(
      'airtel.disbursement.approval.created',
      {
        state:
          persisted.state,
        approvalRequired:
          String(
            record.approvalRequired,
          ),
      },
    );

    return deepFreeze(
      clone(persisted),
    );
  }

  async submit(
    input = {},
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      normalizeActor(
        normalized.actor ??
          normalized.maker ??
          normalized.requester ??
          {
            actorId:
              approval.maker,
            role:
              'SYSTEM',
          },
        'actor',
      );

    this._validateActorTenant(
      actor,
      approval.tenantId,
      'actor',
    );

    if (
      this._expiryIsReached(
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
        APPROVAL_STATES.PENDING ||
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
      this._throw(
        'INVALID_SUBMIT_STATE',
        `Approval cannot be submitted from ${approval.state}.`,
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

    const targetState =
      approval.approvalRequired
        ? APPROVAL_STATES.PENDING
        : APPROVAL_STATES.APPROVED;

    this._assertTransition(
      approval.state,
      targetState,
    );

    const previousState =
      approval.state;

    const nextVersion =
      Number(
        approval.version ??
          approval.approvalVersion ??
          1,
      ) + 1;

    const patch = {
      submittedAt:
        nowIso(this.clock),

      updatedAt:
        nowIso(this.clock),

      state:
        targetState,

      decision:
        targetState ===
        APPROVAL_STATES.APPROVED
          ? APPROVAL_DECISIONS.APPROVE
          : APPROVAL_DECISIONS.REQUIRE_REVIEW,

      ...(targetState ===
      APPROVAL_STATES.APPROVED
        ? {
            approvedAt:
              nowIso(
                this.clock,
              ),
          }
        : {}),

      version:
        nextVersion,
    };

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
              approval.version ??
                approval
                  .approvalVersion ??
                1,
            ),

          patch,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_SUBMITTED',
        updated,
        actor,
      ),
    );

    await this._publishEvent(
      'SUBMITTED',
      updated,
    );

    this._metric(
      'airtel.disbursement.approval.submitted',
      {
        state:
          updated.state,
      },
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async approve(
    input = {},
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const approval =
      await this._getApproval(
        normalized,
      );

    const checker =
      normalizeActor(
        normalized.checker ??
          normalized.actor ??
          normalized.approvedBy,
        'checker',
      );

    this._validateActorTenant(
      checker,
      approval.tenantId,
      'checker',
    );

    this._assertMakerCheckerDistinct(
      approval.maker,
      checker.actorId,
    );

    if (
      approval.requiredCheckerRoles
        ?.length
    ) {
      this._assertCheckerRole(
        checker,
        approval.requiredCheckerRoles,
      );
    }

    await this._checkCheckerPermission(
      approval.tenantId,
      checker,
      approval,
      approval,
    );

    if (
      this._expiryIsReached(
        approval,
      )
    ) {
      return this._expireRecord(
        approval,
        checker,
      );
    }

    if (
      approval.state !==
      APPROVAL_STATES.PENDING
    ) {
      this._throw(
        approval.state ===
          APPROVAL_STATES.APPROVED
          ? 'APPROVAL_ALREADY_APPROVED'
          : 'INVALID_APPROVAL_STATE',

        approval.state ===
          APPROVAL_STATES.APPROVED
          ? 'Approval is already approved.'
          : `Approval cannot be approved from ${approval.state}.`,

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

    const expectedFingerprint =
      disbursementScopeFingerprint({
        ...normalized,

        tenantId:
          approval.tenantId,

        provider:
          approval.provider,

        amount:
          normalized.amount ??
          approval.amount,

        amountMinor:
          normalized.amountMinor ??
          approval.amountMinor,

        currency:
          normalized.currency ??
          approval.currency,

        reference:
          normalized.reference ??
          approval.reference,

        commandId:
          normalized.commandId ??
          approval.commandId,

        originalIdempotencyKey:
          normalized.originalIdempotencyKey ??
          approval.originalIdempotencyKey,

        beneficiaryId:
          normalized.beneficiaryId ??
          approval.beneficiaryId,

        riskLevel:
          normalized.riskLevel ??
          approval.scope?.riskLevel ??
          approval.riskLevel,

        policyVersion:
          normalized.policyVersion ??
          approval.scope?.policyVersion ??
          approval.policyVersion,

        scope:
          normalized.scope ??
          approval.scope?.customScope,
      });

    if (
      expectedFingerprint !==
      approval.scopeFingerprint
    ) {
      this._throw(
        'APPROVAL_SCOPE_MISMATCH',
        'The approval does not match the exact disbursement intent being approved.',
        {
          approvalId:
            approval.approvalId,
          expected:
            approval.scopeFingerprint,
          received:
            expectedFingerprint,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const reason =
      normalizeString(
        normalized.reason ??
          normalized.comment,
        this.config
          .maxCommentLength,
      );

    if (
      this.config
        .requireApprovalReason &&
      !reason
    ) {
      this._throw(
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

          reference:
            approval.reference,

          amount:
            approval.amount,

          amountMinor:
            approval.amountMinor,

          currency:
            approval.currency,

          riskLevel:
            approval.riskLevel,

          checker,

          approval,

          scope:
            approval.scope,
        },
      );

    if (
      !policyAllowed(policy) ||
      policyDecision(policy) ===
        APPROVAL_DECISIONS.REQUIRE_REVIEW
    ) {
      this._throw(
        policyDecision(
          policy,
        ) ===
          APPROVAL_DECISIONS.BLOCK
          ? 'APPROVAL_POLICY_BLOCKED'
          : 'APPROVAL_POLICY_REJECTED',

        policy?.reason ??
          'The active approval policy does not authorize this checker decision.',

        {
          policyDecision:
            policyDecision(
              policy,
            ),
        },

        {
          httpStatus: 409,
        },
      );
    }

    const currentApprovals =
      Array.isArray(
        approval.approvals,
      )
        ? approval.approvals
        : [];

    const duplicateApproval =
      currentApprovals.some(
        (item) =>
          item?.actorId ===
          checker.actorId,
      );

    if (duplicateApproval) {
      this._throw(
        'DUPLICATE_CHECKER_DECISION',
        'This checker has already recorded an approval decision for the request.',
        {
          approvalId:
            approval.approvalId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const nextApprovals = [
      ...currentApprovals,

      {
        actorId:
          checker.actorId,

        role:
          actorRoleOf(checker),

        decision:
          APPROVAL_DECISIONS.APPROVE,

        reason,

        at:
          nowIso(this.clock),

        decisionFingerprint:
          sha256({
            approvalId:
              approval.approvalId,

            scopeFingerprint:
              approval.scopeFingerprint,

            actorId:
              checker.actorId,

            decision:
              APPROVAL_DECISIONS.APPROVE,

            reason,
          }),
      },
    ];

    const approvalCount =
      nextApprovals.length;

    const requiredApprovers =
      normalizePositiveInteger(
        approval.requiredApprovers,
        this.config
          .defaultRequiredApprovers,
        this.config
          .maxRequiredApprovers,
      );

    const fullyApproved =
      approvalCount >=
      requiredApprovers;

    const targetState =
      fullyApproved
        ? APPROVAL_STATES.APPROVED
        : APPROVAL_STATES.PENDING;

    this._assertTransition(
      approval.state,
      targetState,
    );

    const nextVersion =
      Number(
        approval.version ??
          1,
      ) + 1;

    const patch = {
      approvals:
        nextApprovals,

      approvalCount,

      checker:
        fullyApproved
          ? checker.actorId
          : approval.checker,

      checkerActor:
        fullyApproved
          ? checker
          : approval.checkerActor,

      decision:
        fullyApproved
          ? APPROVAL_DECISIONS.APPROVE
          : APPROVAL_DECISIONS.REQUIRE_REVIEW,

      state:
        targetState,

      approvedAt:
        fullyApproved
          ? nowIso(this.clock)
          : approval.approvedAt,

      updatedAt:
        nowIso(this.clock),

      version:
        nextVersion,
    };

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            APPROVAL_STATES.PENDING,

          toState:
            targetState,

          action:
            APPROVAL_ACTIONS.APPROVE,

          actor: checker,

          expectedVersion:
            Number(
              approval.version ??
                1,
            ),

          patch,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_APPROVED',
        updated,
        checker,
        {
          reason,
          fullyApproved,
          approvalCount,
          requiredApprovers,
        },
      ),
    );

    await this._publishEvent(
      fullyApproved
        ? 'APPROVED'
        : 'APPROVAL_RECORDED',

      updated,

      {
        approvalCount,
        requiredApprovers,
      },
    );

    this._metric(
      'airtel.disbursement.approval.approved',
      {
        fullyApproved:
          String(
            fullyApproved,
          ),
      },
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async reject(
    input = {},
  ) {
    return this._decide(
      input,
      APPROVAL_STATES.REJECTED,
      APPROVAL_ACTIONS.REJECT,
      APPROVAL_DECISIONS.REJECT,
      'REJECT',
    );
  }

  async cancel(
    input = {},
  ) {
    return this._decide(
      input,
      APPROVAL_STATES.CANCELLED,
      APPROVAL_ACTIONS.CANCEL,
      APPROVAL_DECISIONS.REJECT,
      'CANCEL',
    );
  }

  async supersede(
    input = {},
  ) {
    return this._decide(
      input,
      APPROVAL_STATES.SUPERSEDED,
      APPROVAL_ACTIONS.SUPERSEDE,
      APPROVAL_DECISIONS.REQUIRE_REVIEW,
      'SUPERSEDE',
    );
  }

  async _decide(
    input,
    targetState,
    action,
    decision,
    decisionType,
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      normalizeActor(
        normalized.actor ??
          normalized.checker ??
          normalized.maker ??
          normalized.rejectedBy ??
          normalized.cancelledBy ??
          normalized.supersededBy,
        'actor',
      );

    this._validateActorTenant(
      actor,
      approval.tenantId,
      'actor',
    );

    if (
      decisionType ===
        'REJECT' ||
      decisionType ===
        'SUPERSEDE'
    ) {
      this._assertMakerCheckerDistinct(
        approval.maker,
        actor.actorId,
      );
    }

    const allowedStates = [
      APPROVAL_STATES.DRAFT,
      APPROVAL_STATES.PENDING,
      ...(decisionType ===
      'CANCEL'
        ? [
            APPROVAL_STATES.APPROVED,
          ]
        : []),
    ];

    if (
      !allowedStates.includes(
        approval.state,
      )
    ) {
      this._throw(
        'INVALID_DECISION_STATE',
        `Approval cannot be ${decisionType.toLowerCase()}d from ${approval.state}.`,
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
      this._expiryIsReached(
        approval,
      ) &&
      !TERMINAL_STATES.has(
        approval.state,
      )
    ) {
      return this._expireRecord(
        approval,
        actor,
      );
    }

    if (
      decisionType ===
        'REJECT' &&
      normalized.scopeFingerprint
    ) {
      if (
        normalized.scopeFingerprint !==
        approval.scopeFingerprint
      ) {
        this._throw(
          'APPROVAL_SCOPE_MISMATCH',
          'Rejection scope does not match the persisted disbursement approval.',
          {},
          {
            httpStatus: 409,
          },
        );
      }
    }

    const reason =
      normalizeString(
        normalized.reason ??
          normalized.comment,
        this.config
          .maxCommentLength,
      );

    const reasonRequired =
      decisionType ===
      'REJECT'
        ? this.config
            .requireRejectionReason
        : decisionType ===
            'CANCEL'
          ? this.config
              .requireCancellationReason
          : this.config
              .requireSupersedeReason;

    if (
      reasonRequired &&
      !reason
    ) {
      this._throw(
        `${decisionType}_REASON_REQUIRED`,
        `${
          decisionType.charAt(
            0,
          ) +
          decisionType
            .slice(1)
            .toLowerCase()
        } reason is required.`,
      );
    }

    this._assertTransition(
      approval.state,
      targetState,
    );

    const nextVersion =
      Number(
        approval.version ??
          1,
      ) + 1;

    const patch = {
      state:
        targetState,

      decision,

      reason,

      updatedAt:
        nowIso(this.clock),

      version:
        nextVersion,

      ...(decisionType ===
      'REJECT'
        ? {
            rejectedAt:
              nowIso(
                this.clock,
              ),
            checker:
              actor.actorId,
            checkerActor:
              actor,
          }
        : {}),

      ...(decisionType ===
      'CANCEL'
        ? {
            cancelledAt:
              nowIso(
                this.clock,
              ),
          }
        : {}),

      ...(decisionType ===
      'SUPERSEDE'
        ? {
            supersededAt:
              nowIso(
                this.clock,
              ),
          }
        : {}),
    };

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            approval.state,

          toState:
            targetState,

          action,

          actor,

          expectedVersion:
            Number(
              approval.version ??
                1,
            ),

          patch,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        `APPROVAL_${decisionType}D`,
        updated,
        actor,
        {
          reason,
        },
      ),
    );

    await this._publishEvent(
      decisionType,
      updated,
      {
        reason,
      },
    );

    this._metric(
      `airtel.disbursement.approval.${decisionType.toLowerCase()}`,
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async consume(
    input = {},
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      normalizeActor(
        normalized.executor ??
          normalized.actor,
        'executor',
      );

    this._validateActorTenant(
      actor,
      approval.tenantId,
      'executor',
    );

    const verification =
      await this.verifyForExecution({
        ...normalized,

        approvalId:
          approval.approvalId,

        tenantId:
          approval.tenantId,

        provider:
          approval.provider,

        amount:
          normalized.amount ??
          approval.amount,

        amountMinor:
          normalized.amountMinor ??
          approval.amountMinor,

        currency:
          normalized.currency ??
          approval.currency,

        reference:
          normalized.reference ??
          approval.reference,

        commandId:
          normalized.commandId ??
          approval.commandId,

        originalIdempotencyKey:
          normalized.originalIdempotencyKey ??
          approval.originalIdempotencyKey,

        beneficiaryId:
          normalized.beneficiaryId ??
          approval.beneficiaryId,

        riskLevel:
          normalized.riskLevel ??
          approval.riskLevel,

        actor,

        approval,
      });

    if (
      !verification.executable
    ) {
      this._throw(
        verification.code ??
          'APPROVAL_NOT_EXECUTABLE',
        'Approval is not executable.',
        verification,
        {
          httpStatus: 409,
        },
      );
    }

    this._assertTransition(
      approval.state,
      APPROVAL_STATES.CONSUMED,
    );

    const nextVersion =
      Number(
        approval.version ??
          1,
      ) + 1;

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            APPROVAL_STATES.APPROVED,

          toState:
            APPROVAL_STATES.CONSUMED,

          action:
            APPROVAL_ACTIONS.CONSUME,

          actor,

          expectedVersion:
            Number(
              approval.version ??
                1,
            ),

          patch: {
            state:
              APPROVAL_STATES.CONSUMED,

            consumedAt:
              nowIso(
                this.clock,
              ),

            consumedBy:
              actor.actorId,

            updatedAt:
              nowIso(
                this.clock,
              ),

            version:
              nextVersion,
          },
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_CONSUMED',
        updated,
        actor,
      ),
    );

    await this._publishEvent(
      'CONSUMED',
      updated,
    );

    this._metric(
      'airtel.disbursement.approval.consumed',
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async markExecutionFailed(
    input = {},
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      normalizeActor(
        normalized.executor ??
          normalized.actor,
        'executor',
      );

    this._validateActorTenant(
      actor,
      approval.tenantId,
      'executor',
    );

    if (
      approval.state !==
        APPROVAL_STATES.APPROVED &&
      approval.state !==
        APPROVAL_STATES.CONSUMED
    ) {
      this._throw(
        'INVALID_EXECUTION_FAILURE_STATE',
        'Only an approved or consumed authorization can be marked as execution-failed.',
        {
          state:
            approval.state,
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

    const nextVersion =
      Number(
        approval.version ??
          1,
      ) + 1;

    const failure =
      sanitizeObject(
        {
          code:
            normalized.failureCode,

          category:
            normalized.failureCategory,

          operationReference:
            normalized.operationReference,

          retryable:
            Boolean(
              normalized.retryable,
            ),

          reason:
            normalized.reason,

          at:
            nowIso(
              this.clock,
            ),
        },

        'executionFailure',

        0,

        this._metadataLimits(),
      );

    const previousState =
      approval.state;

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
              approval.version ??
                1,
            ),

          patch: {
            state:
              APPROVAL_STATES.EXECUTION_FAILED,

            decision:
              APPROVAL_DECISIONS.REQUIRE_REVIEW,

            executionFailedAt:
              nowIso(
                this.clock,
              ),

            executionFailure:
              failure,

            updatedAt:
              nowIso(
                this.clock,
              ),

            version:
              nextVersion,
          },
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_EXECUTION_FAILED',
        updated,
        actor,
        {
          failureCode:
            normalized.failureCode,

          operationReference:
            normalized.operationReference,
        },
      ),
    );

    await this._publishEvent(
      'EXECUTION_FAILED',
      updated,
    );

    this._metric(
      'airtel.disbursement.approval.execution_failed',
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async expire(
    input = {},
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const approval =
      await this._getApproval(
        normalized,
      );

    const actor =
      normalizeActor(
        normalized.actor ??
          {
            actorId:
              'system:airtel-disbursement-approval-expiry',

            role:
              'SYSTEM',
          },
        'actor',
      );

    this._validateActorTenant(
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
      TERMINAL_STATES.has(
        approval.state,
      )
    ) {
      return deepFreeze(
        clone(approval),
      );
    }

    if (
      !this._expiryIsReached(
        approval,
      )
    ) {
      this._throw(
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

    const nextVersion =
      Number(
        approval.version ??
          1,
      ) + 1;

    const updated =
      await this._transition(
        approval,
        {
          fromState:
            approval.state,

          toState:
            APPROVAL_STATES.EXPIRED,

          action:
            APPROVAL_ACTIONS.EXPIRE,

          actor,

          expectedVersion:
            Number(
              approval.version ??
                1,
            ),

          patch: {
            state:
              APPROVAL_STATES.EXPIRED,

            decision:
              APPROVAL_DECISIONS.REJECT,

            expiredAt:
              nowIso(
                this.clock,
              ),

            updatedAt:
              nowIso(
                this.clock,
              ),

            version:
              nextVersion,
          },
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'APPROVAL_EXPIRED',
        updated,
        actor,
      ),
    );

    await this._publishEvent(
      'EXPIRED',
      updated,
    );

    this._metric(
      'airtel.disbursement.approval.expired',
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async verifyForExecution(
    input = {},
  ) {
    const normalized =
      normalizeContext(
        input,
        this._metadataLimits(),
      );

    const approval =
      input.approval
        ? clone(
            input.approval,
          )
        : await this._getApproval(
            normalized,
          );

    const tenantId =
      this._requireTenant({
        tenantId:
          normalized.tenantId ??
          approval.tenantId,
      });

    const provider =
      this._requireProvider({
        provider:
          normalized.provider ??
          approval.provider,
      });

    if (
      tenantId !==
      approval.tenantId
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.INVALID,
        'TENANT_SCOPE_MISMATCH',
      );
    }

    if (
      provider !==
      approval.provider
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.INVALID,
        'PROVIDER_SCOPE_MISMATCH',
      );
    }

    if (
      this._expiryIsReached(
        approval,
      )
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.EXPIRED,
        'APPROVAL_EXPIRED',
      );
    }

    if (
      approval.state ===
      APPROVAL_STATES.CONSUMED
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.REPLAY,
        'APPROVAL_ALREADY_CONSUMED',
      );
    }

    if (
      approval.state !==
      APPROVAL_STATES.APPROVED
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.INVALID,
        'APPROVAL_NOT_APPROVED',
      );
    }

    try {
      const expected =
        disbursementScopeFingerprint({
          ...normalized,

          tenantId:
            approval.tenantId,

          provider:
            approval.provider,

          reference:
            normalized.reference ??
            approval.reference,

          amount:
            normalized.amount ??
            approval.amount,

          amountMinor:
            normalized.amountMinor ??
            approval.amountMinor,

          currency:
            normalized.currency ??
            approval.currency,

          commandId:
            normalized.commandId ??
            approval.commandId,

          originalIdempotencyKey:
            normalized.originalIdempotencyKey ??
            approval.originalIdempotencyKey,

          beneficiaryId:
            normalized.beneficiaryId ??
            approval.beneficiaryId,

          riskLevel:
            normalized.riskLevel ??
            approval.scope?.riskLevel ??
            approval.riskLevel,

          policyVersion:
            normalized.policyVersion ??
            approval.scope?.policyVersion ??
            approval.policyVersion,

          scope:
            normalized.scope ??
            approval.scope?.customScope,
        });

      if (
        expected !==
        approval.scopeFingerprint
      ) {
        return this._invalidVerification(
          approval,
          GOVERNANCE_OUTCOMES.STALE,
          'APPROVAL_SCOPE_MISMATCH',
          {
            expected,
            actual:
              approval.scopeFingerprint,
          },
        );
      }
    } catch (error) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.INVALID,
        error?.code ??
          'APPROVAL_SCOPE_INVALID',
      );
    }

    const actor =
      normalized.actor ??
      normalized.executor;

    if (actor) {
      const normalizedActor =
        normalizeActor(
          actor,
          'actor',
        );

      this._validateActorTenant(
        normalizedActor,
        approval.tenantId,
        'actor',
      );

      if (
        !this.config
          .allowMakerToExecute &&
        approval.maker ===
          normalizedActor.actorId
      ) {
        return this._invalidVerification(
          approval,
          GOVERNANCE_OUTCOMES.INVALID,
          'MAKER_EXECUTION_RESTRICTION',
        );
      }
    }

    const requiredApprovers =
      normalizePositiveInteger(
        approval.requiredApprovers,
        this.config
          .defaultRequiredApprovers,
        this.config
          .maxRequiredApprovers,
      );

    const approvalCount =
      Array.isArray(
        approval.approvals,
      )
        ? approval.approvals.length
        : approval.checker
          ? 1
          : 0;

    if (
      this.config
        .requireMakerChecker
    ) {
      if (
        approval.maker &&
        approval.checker
      ) {
        if (
          approval.maker ===
          approval.checker
        ) {
          return this._invalidVerification(
            approval,
            GOVERNANCE_OUTCOMES.INVALID,
            'MAKER_CHECKER_SEPARATION_VIOLATION',
          );
        }
      } else if (
        approvalRequiredForVerification(
          approval,
        )
      ) {
        return this._invalidVerification(
          approval,
          GOVERNANCE_OUTCOMES.INVALID,
          'MAKER_CHECKER_INCOMPLETE',
        );
      }
    }

    if (
      approvalCount <
      requiredApprovers
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.PENDING,
        'APPROVAL_QUORUM_NOT_REACHED',
      );
    }

    const regulatoryDecision =
      upper(
        normalized.regulatoryDecision ??
          normalized
            .commandPlan
            ?.regulatoryDecision ??
          approval.scope
            ?.regulatoryDecision,
      );

    if (
      [
        APPROVAL_DECISIONS.BLOCK,
        APPROVAL_DECISIONS.REJECT,
        'DENY',
        'BLOCKED',
      ].includes(
        regulatoryDecision,
      )
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.BLOCKED,
        'REGULATORY_BLOCK',
      );
    }

    if (
      isOfflineUnsafe(
        normalized.offlineState ??
          approval.scope
            ?.offlineState,
      )
    ) {
      return this._invalidVerification(
        approval,
        GOVERNANCE_OUTCOMES.INVALID,
        'OFFLINE_OPERATION_NOT_EXECUTABLE',
      );
    }

    const authorization = {
      authorized:
        true,

      executable:
        true,

      outcome:
        GOVERNANCE_OUTCOMES.APPROVED,

      approvalId:
        approval.approvalId,

      tenantId:
        approval.tenantId,

      provider:
        approval.provider,

      operation:
        OPERATION,

      state:
        approval.state,

      scopeFingerprint:
        approval.scopeFingerprint,

      maker:
        approval.maker,

      checker:
        approval.checker,

      approvalCount,

      requiredApprovers,

      originalIdempotencyKey:
        approval.originalIdempotencyKey,

      reference:
        approval.reference,

      amountMinor:
        approval.amountMinor,

      currency:
        approval.currency,

      expiresAt:
        approval.expiresAt,

      riskLevel:
        approval.riskLevel,

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

          executeProviderCallHere:
            false,

          authoritativeBoundary:
            'TITECH_FINANCIAL_CORE / CANONICAL_DISBURSEMENT_SERVICE',
        }),
    };

    return deepFreeze(
      authorization,
    );
  }

  _invalidVerification(
    approval,
    outcome,
    code,
    details = {},
  ) {
    return deepFreeze({
      authorized:
        false,

      executable:
        false,

      outcome,

      approvalId:
        approval?.approvalId,

      state:
        approval?.state,

      code,

      details:
        sanitizeObject(
          details,
          'details',
          0,
          this._metadataLimits(),
        ),
    });
  }

  buildExecutionAuthorization(
    input = {},
  ) {
    const approval =
      input.approval ?? {};

    if (
      !approval?.approvalId
    ) {
      return {
        authorized:
          false,

        executable:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        code:
          'APPROVAL_REQUIRED',
      };
    }

    if (
      upper(
        approval.state,
      ) !==
      APPROVAL_STATES.APPROVED
    ) {
      return {
        authorized:
          false,

        executable:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        code:
          'APPROVAL_NOT_APPROVED',
      };
    }

    if (
      this._expiryIsReached(
        approval,
      )
    ) {
      return {
        authorized:
          false,

        executable:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.EXPIRED,

        code:
          'APPROVAL_EXPIRED',
      };
    }

    const expected =
      disbursementScopeFingerprint({
        ...input,

        tenantId:
          input.tenantId ??
          approval.tenantId,

        provider:
          input.provider ??
          approval.provider,

        reference:
          input.reference ??
          approval.reference,

        amount:
          input.amount ??
          approval.amount,

        amountMinor:
          input.amountMinor ??
          approval.amountMinor,

        currency:
          input.currency ??
          approval.currency,

        commandId:
          input.commandId ??
          approval.commandId,

        originalIdempotencyKey:
          input.originalIdempotencyKey ??
          approval.originalIdempotencyKey,

        beneficiaryId:
          input.beneficiaryId ??
          approval.beneficiaryId,

        riskLevel:
          input.riskLevel ??
          approval.scope?.riskLevel ??
          approval.riskLevel,

        policyVersion:
          input.policyVersion ??
          approval.scope?.policyVersion ??
          approval.policyVersion,

        scope:
          input.scope ??
          approval.scope?.customScope,
      });

    if (
      expected !==
      approval.scopeFingerprint
    ) {
      return {
        authorized:
          false,

        executable:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.STALE,

        code:
          'APPROVAL_SCOPE_MISMATCH',
      };
    }

    const actorId =
      actorIdOf(
        input.actor ??
          input.executor,
      );

    if (
      actorId &&
      !this.config
        .allowMakerToExecute &&
      approval.maker ===
        actorId
    ) {
      return {
        authorized:
          false,

        executable:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        code:
          'MAKER_EXECUTION_RESTRICTION',
      };
    }

    if (
      this.config
        .requireOriginalIdempotencyKey &&
      !approval
        .originalIdempotencyKey
    ) {
      return {
        authorized:
          false,

        executable:
          false,

        outcome:
          GOVERNANCE_OUTCOMES.INVALID,

        code:
          'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
      };
    }

    return deepFreeze({
      authorized:
        true,

      executable:
        true,

      outcome:
        GOVERNANCE_OUTCOMES.APPROVED,

      approvalId:
        approval.approvalId,

      tenantId:
        approval.tenantId,

      provider:
        approval.provider,

      operation:
        OPERATION,

      scopeFingerprint:
        approval.scopeFingerprint,

      originalIdempotencyKey:
        approval.originalIdempotencyKey,

      reference:
        approval.reference,

      amountMinor:
        approval.amountMinor,

      currency:
        approval.currency,

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

          executeProviderCallHere:
            false,

          authoritativeBoundary:
            'TITECH_FINANCIAL_CORE / CANONICAL_DISBURSEMENT_SERVICE',
        }),
    });
  }

  health() {
    const repositoryReady =
      Boolean(
        this.approvalRepository,
      );

    const policyReady =
      Boolean(
        this.policyEngine,
      );

    const auditReady =
      Boolean(
        this.auditService,
      );

    const atomicTransitionReady =
      Boolean(
        this._repositoryMethod(
          'transition',
          'atomicTransition',
          'compareAndSetTransition',
          'updateState',
        ),
      );

    const healthy =
      repositoryReady &&
      (
        !this.config
          .requirePolicyEngine ||
        policyReady
      ) &&
      (
        !this.config
          .requireAuditBoundary ||
        auditReady
      ) &&
      (
        !this.config
          .requireAtomicTransitions ||
        atomicTransitionReady
      );

    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      healthy,

      status:
        healthy
          ? 'UP'
          : 'DEGRADED',

      dependencies: {
        approvalRepository:
          repositoryReady,

        policyEngine:
          policyReady,

        roleService:
          Boolean(
            this.roleService,
          ),

        userService:
          Boolean(
            this.userService,
          ),

        auditService:
          auditReady,

        eventBus:
          Boolean(
            this.eventBus,
          ),

        atomicTransition:
          atomicTransitionReady,
      },

      controls: {
        makerChecker:
          this.config
            .requireMakerChecker,

        originalIdempotencyKey:
          this.config
            .requireOriginalIdempotencyKey,

        policyEngineRequired:
          this.config
            .requirePolicyEngine,

        auditRequired:
          this.config
            .requireAuditBoundary,

        atomicTransitionsRequired:
          this.config
            .requireAtomicTransitions,
      },
    };
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      supportsCreate:
        true,

      supportsSubmit:
        true,

      supportsApproval:
        true,

      supportsRejection:
        true,

      supportsCancellation:
        true,

      supportsSupersede:
        true,

      supportsExpiry:
        true,

      supportsReplayProtection:
        true,

      supportsScopeFingerprinting:
        true,

      supportsMakerChecker:
        this.config
          .requireMakerChecker,

      supportsMultiApproverQuorum:
        true,

      supportsExecutionVerification:
        true,

      supportsOriginalIdempotencyPreservation:
        true,

      supportsAudit:
        Boolean(
          this.auditService,
        ),

      supportsEvents:
        Boolean(
          this.eventBus,
        ),

      directProviderExecution:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,
    });
  }

  diagnostics() {
    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      health:
        this.health(),

      configuration: {
        defaultTtlMs:
          this.config
            .defaultTtlMs,

        minTtlMs:
          this.config
            .minTtlMs,

        maxTtlMs:
          this.config
            .maxTtlMs,

        defaultRequiredApprovers:
          this.config
            .defaultRequiredApprovers,

        maxRequiredApprovers:
          this.config
            .maxRequiredApprovers,

        amountApprovalTierCount:
          Array.isArray(
            this.config
              .amountApprovalTiers,
          )
            ? this.config
                .amountApprovalTiers
                .length
            : 0,
      },
    };
  }

  /* ------------------------------------------------------------------------- *
   * Backwards-compatible enterprise aliases
   * ------------------------------------------------------------------------- */

  requestApproval(
    input = {},
  ) {
    return this.authorize(
      input,
    );
  }

  create(
    input = {},
  ) {
    return this.authorize(
      input,
    );
  }

  submitForApproval(
    input = {},
  ) {
    return this.submit(
      input,
    );
  }

  approveRequest(
    input = {},
  ) {
    return this.approve(
      input,
    );
  }

  rejectRequest(
    input = {},
  ) {
    return this.reject(
      input,
    );
  }

  cancelRequest(
    input = {},
  ) {
    return this.cancel(
      input,
    );
  }

  supersedeRequest(
    input = {},
  ) {
    return this.supersede(
      input,
    );
  }

  verifyApproval(
    input = {},
  ) {
    return this.verifyForExecution(
      input,
    );
  }
}

const approvalRequiredForVerification =
  (approval) =>
    approval?.approvalRequired !==
      false ||
    Number(
      approval?.requiredApprovers ??
        1,
    ) > 0;

export const createApprovalWorkflow =
  (options = {}) =>
    new AirtelDisbursementApprovalWorkflow(
      options,
    );

export const defaultApprovalWorkflow =
  createApprovalWorkflow({
    approvalRepository: null,
    policyEngine: null,
    auditService: null,
  });

export const approvalWorkflow =
  defaultApprovalWorkflow;

export const ApprovalWorkflow =
  AirtelDisbursementApprovalWorkflow;

export const AirtelPaymentApprovalWorkflow =
  AirtelDisbursementApprovalWorkflow;

export default AirtelDisbursementApprovalWorkflow;