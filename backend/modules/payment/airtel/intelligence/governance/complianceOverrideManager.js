'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Compliance Override Manager
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/governance/complianceOverrideManager.js
 *
 * Purpose:
 *   Controlled exception governance for compliance-policy decisions affecting
 *   Airtel payment operations. This module provides a narrow, auditable
 *   mechanism for requesting, reviewing, approving, activating, consuming,
 *   revoking and expiring explicitly scoped compliance overrides.
 *
 * Responsibilities:
 *   - Maintain the lifecycle of compliance override requests.
 *   - Enforce tenant isolation and Airtel provider scope.
 *   - Bind every override to an immutable operation/control fingerprint.
 *   - Enforce maker-checker separation of duties.
 *   - Prevent overrides of controls configured as legally/operationally
 *     non-overridable.
 *   - Enforce bounded TTL, usage and break-glass constraints.
 *   - Re-evaluate policy before approval and execution authorization.
 *   - Delegate persistence and atomic state transitions to injected adapters.
 *   - Produce redacted audit events and deterministic governance evidence.
 *
 * Non-responsibilities:
 *   - No direct provider API calls.
 *   - No MongoDB/database writes.
 *   - No wallet, balance, financial transaction, journal or ledger mutation.
 *   - No Financial Core posting or settlement.
 *   - No KYC/AML/sanctions implementation.
 *   - No replacement for the authoritative compliance/risk policy engine.
 *   - No authority to override statutory/legal controls merely because a user
 *     presents an override request.
 *
 * Financial/compliance safety principles:
 *   1. An override is an exception to one named control, not a blanket bypass.
 *   2. An override is scoped by tenant, provider, control, operation and
 *      immutable operation identity/fingerprint.
 *   3. Mandatory hard-stop controls remain non-overridable by default.
 *   4. Maker and checker must be different principals by default.
 *   5. Break-glass is shorter-lived and cannot weaken non-overridable controls.
 *   6. Approval does not itself execute a payment or mutate financial state.
 *   7. The authoritative Financial Core remains responsible for financial
 *      posting, identity and idempotency.
 *   8. Execution-time verification must re-check scope, expiry, policy and
 *      usage state; an old approval must not authorize a changed operation.
 *   9. Persistence adapters must provide atomic compare-and-set transitions
 *      for approval/consumption operations.
 *   10. Audit evidence must be useful without retaining credentials or raw
 *       provider request/response payloads.
 *
 * Module format:
 *   ESM-compatible with dependency injection and no mandatory project-local
 *   imports, reducing circular dependency risk during the platform migration.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const ENGINE_NAME = 'airtel-compliance-override-manager';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';

export const OVERRIDE_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  SUPERSEDED: 'SUPERSEDED',
  CONSUMED: 'CONSUMED',
});

export const OVERRIDE_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REVOKE: 'REVOKE',
  EXPIRE: 'EXPIRE',
  SUPERSEDE: 'SUPERSEDE',
  CONSUME: 'CONSUME',
});

export const OVERRIDE_DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  BLOCK: 'BLOCK',
});

export const OVERRIDE_MODES = Object.freeze({
  STANDARD: 'STANDARD',
  BREAK_GLASS: 'BREAK_GLASS',
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
  COLLECTION: 'COLLECTION',
  DISBURSEMENT: 'DISBURSEMENT',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
  SETTLEMENT: 'SETTLEMENT',
});

export const OVERRIDABLE_CONTROL_TYPES = Object.freeze({
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  DOCUMENTATION_GAP: 'DOCUMENTATION_GAP',
  NON_CRITICAL_KYC_REVIEW: 'NON_CRITICAL_KYC_REVIEW',
  OPERATING_WINDOW: 'OPERATING_WINDOW',
  CONFIGURED_VELOCITY_LIMIT: 'CONFIGURED_VELOCITY_LIMIT',
  CONFIGURED_TRANSACTION_LIMIT: 'CONFIGURED_TRANSACTION_LIMIT',
  CONFIGURED_RISK_THRESHOLD: 'CONFIGURED_RISK_THRESHOLD',
  CUSTOMER_SERVICE_EXCEPTION: 'CUSTOMER_SERVICE_EXCEPTION',
});

export const NON_OVERRIDABLE_CONTROL_TYPES = Object.freeze({
  SANCTIONS_HARD_BLOCK: 'SANCTIONS_HARD_BLOCK',
  LEGAL_PROHIBITION: 'LEGAL_PROHIBITION',
  COURT_ORDER: 'COURT_ORDER',
  COMPROMISED_SECURITY: 'COMPROMISED_SECURITY',
  INVALID_FINANCIAL_IDENTITY: 'INVALID_FINANCIAL_IDENTITY',
  DUPLICATE_FINANCIAL_EXECUTION: 'DUPLICATE_FINANCIAL_EXECUTION',
  CONFIRMED_FRAUD_HARD_BLOCK: 'CONFIRMED_FRAUD_HARD_BLOCK',
  PROVIDER_SECURITY_BLOCK: 'PROVIDER_SECURITY_BLOCK',
});

export const OUTCOMES = Object.freeze({
  AUTHORIZED: 'AUTHORIZED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  BLOCKED: 'BLOCKED',
  STALE: 'STALE',
  EXPIRED: 'EXPIRED',
  REPLAY: 'REPLAY',
  REVOKED: 'REVOKED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
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

const DEFAULTS = Object.freeze({
  requireTenantId: true,
  enforceAirtelProvider: true,
  requireMakerChecker: true,
  requireCheckerForBreakGlass: true,
  disallowMakerExecution: true,
  defaultTtlMs: 15 * 60 * 1000,
  breakGlassTtlMs: 5 * 60 * 1000,
  minTtlMs: 30 * 1000,
  maxTtlMs: 24 * 60 * 60 * 1000,
  breakGlassMaxTtlMs: 15 * 60 * 1000,
  defaultMaxUses: 1,
  maxAllowedUses: 10,
  maxReasonLength: 3000,
  maxCommentLength: 2000,
  maxActorIdLength: 160,
  maxTenantIdLength: 160,
  maxReferenceLength: 240,
  allowMultipleUse: true,
  failClosedOnPolicyError: true,
  failClosedOnRepositoryError: true,
  requireBusinessJustification: true,
  requireControlEvidence: false,
  allowBreakGlass: true,
});

const TERMINAL_STATES = new Set([
  OVERRIDE_STATES.REJECTED,
  OVERRIDE_STATES.REVOKED,
  OVERRIDE_STATES.EXPIRED,
  OVERRIDE_STATES.SUPERSEDED,
  OVERRIDE_STATES.CONSUMED,
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [OVERRIDE_STATES.DRAFT]: new Set([
    OVERRIDE_STATES.PENDING,
    OVERRIDE_STATES.REVOKED,
  ]),
  [OVERRIDE_STATES.PENDING]: new Set([
    OVERRIDE_STATES.APPROVED,
    OVERRIDE_STATES.REJECTED,
    OVERRIDE_STATES.REVOKED,
    OVERRIDE_STATES.EXPIRED,
    OVERRIDE_STATES.SUPERSEDED,
  ]),
  [OVERRIDE_STATES.APPROVED]: new Set([
    OVERRIDE_STATES.CONSUMED,
    OVERRIDE_STATES.REVOKED,
    OVERRIDE_STATES.EXPIRED,
    OVERRIDE_STATES.SUPERSEDED,
  ]),
  [OVERRIDE_STATES.REJECTED]: new Set(),
  [OVERRIDE_STATES.REVOKED]: new Set(),
  [OVERRIDE_STATES.EXPIRED]: new Set(),
  [OVERRIDE_STATES.SUPERSEDED]: new Set(),
  [OVERRIDE_STATES.CONSUMED]: new Set(),
});

const SECRET_FIELD_PATTERN =
  /(password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|card(number)?|private.?key|access.?key|api.?key|signature|credential|raw(request|response)|provider.?payload)/i;

const SENSITIVE_PATH_PATTERN =
  /(request|response)\.(body|payload|headers|raw)|(^|\.)(authorization|cookie|token|secret|password|pin|otp|cvv|pan)$/i;

const normalizeString = (value, maxLength = 240) => {
  if (value === undefined || value === null) return undefined;
  const valueString = String(value).trim();
  if (!valueString) return undefined;
  return valueString.slice(0, maxLength);
};

const upper = (value) => normalizeString(value, 120)?.toUpperCase();

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const stableSerialize = (value) => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
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

const clone = (value) =>
  value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));

const sanitizeObject = (
  value,
  path = '',
  depth = 0,
) => {
  if (depth > 6) {
    return '[TRUNCATED]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 2000
      ? `${value.slice(0, 2000)}…`
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
      .slice(0, 100)
      .map((item, index) =>
        sanitizeObject(
          item,
          `${path}[${index}]`,
          depth + 1,
        ),
      );
  }

  const out = {};

  for (const key of Object.keys(value).slice(0, 100)) {
    const childPath = path
      ? `${path}.${key}`
      : key;

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
    );
  }

  return out;
};

const deepFreeze = (
  value,
  seen = new WeakSet(),
) => {
  if (
    !value ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const child of Object.values(value)
  ) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
};

const nowMs = (clock) =>
  typeof clock?.now === 'function'
    ? clock.now()
    : Date.now();

const nowIso = (clock) =>
  new Date(nowMs(clock)).toISOString();

const actorIdOf = (actor) =>
  normalizeString(
    actor?.actorId ??
      actor?.userId ??
      actor?.id ??
      actor?.principalId,
    160,
  );

const actorRoleOf = (actor) =>
  upper(
    actor?.role ??
      actor?.actorRole ??
      actor?.type,
  );

const impactRequiresChecker = (
  impactLevel,
  config,
) => {
  const impact = upper(impactLevel);

  if (
    impact ===
    IMPACT_LEVELS.NON_FINANCIAL
  ) {
    return false;
  }

  return Boolean(
    config.requireMakerChecker,
  );
};

const isHardBlockedControl = (
  controlType,
  config,
) => {
  const normalized = upper(
    controlType,
  );

  return (
    new Set(
      config.nonOverridableControlTypes ??
        Object.values(
          NON_OVERRIDABLE_CONTROL_TYPES,
        ),
    ).has(normalized) ||
    Object.prototype.hasOwnProperty.call(
      NON_OVERRIDABLE_CONTROL_TYPES,
      normalized,
    )
  );
};

const isOfflineUnsafe = (
  state,
) =>
  [
    OFFLINE_STATES.LOCAL_ONLY,
    OFFLINE_STATES.PENDING_SYNC,
    OFFLINE_STATES.SYNCING,
    OFFLINE_STATES.SERVER_REJECTED,
    OFFLINE_STATES.CONFLICT,
    OFFLINE_STATES.REQUIRES_REVIEW,
  ].includes(upper(state));

export class AirtelComplianceOverrideError extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message, options);

    this.name =
      'AirtelComplianceOverrideError';

    this.code = code;
    this.component = COMPONENT;
    this.provider = PROVIDER;

    this.details =
      sanitizeObject(details);

    this.retryable =
      Boolean(options.retryable);

    this.httpStatus =
      options.httpStatus ?? 400;
  }
}

export const normalizeContext = (
  input = {},
) => {
  if (!isPlainObject(input)) {
    throw new AirtelComplianceOverrideError(
      'INVALID_INPUT',
      'Compliance override input must be an object.',
    );
  }

  return sanitizeObject(
    clone(input) ?? {},
  );
};

export const buildOverrideScope = (
  input = {},
) => {
  const plan =
    input.commandPlan ??
    input.plan ??
    {};

  const payment =
    input.paymentIdentity ??
    input.payment ??
    {};

  const compliance =
    input.complianceDecision ??
    input.compliance ??
    {};

  return {
    tenantId:
      normalizeString(
        input.tenantId ??
          plan.tenantId ??
          payment.tenantId,
        160,
      ),

    provider:
      upper(
        input.provider ??
          plan.provider ??
          payment.provider ??
          PROVIDER,
      ),

    controlType:
      upper(
        input.controlType ??
          input.control ??
          compliance.controlType,
      ),

    controlCode:
      normalizeString(
        input.controlCode ??
          input.reasonCode ??
          compliance.controlCode,
        180,
      ),

    command:
      upper(
        input.command ??
          plan.command,
      ),

    operation:
      upper(
        input.operation ??
          plan.operation,
      ),

    action:
      upper(
        input.action ??
          plan.action,
      ),

    operationType:
      upper(
        input.operationType ??
          plan.operationType,
      ),

    impactLevel:
      upper(
        input.impactLevel ??
          input.financialImpact ??
          plan.impactLevel ??
          plan.financialImpact,
      ),

    paymentId:
      normalizeString(
        input.paymentId ??
          payment.paymentId ??
          payment.transactionId,
        240,
      ),

    transactionId:
      normalizeString(
        input.transactionId ??
          payment.transactionId,
        240,
      ),

    originalIdempotencyKey:
      normalizeString(
        input.originalIdempotencyKey ??
          payment.originalIdempotencyKey ??
          payment.idempotencyKey ??
          plan.originalIdempotencyKey,
        240,
      ),

    currency:
      upper(
        input.currency ??
          payment.currency,
      ),

    amountMinor:
      input.amountMinor ??
      payment.amountMinor,

    riskLevel:
      upper(
        input.riskLevel ??
          plan.riskLevel ??
          compliance.riskLevel,
      ),

    offlineState:
      upper(
        input.offlineState ??
          plan.offlineState ??
          payment.offlineState,
      ),

    scope:
      isPlainObject(input.scope)
        ? sanitizeObject(input.scope)
        : undefined,
  };
};

export const overrideScopeFingerprint = (
  scope,
) =>
  sha256(
    buildOverrideScope(scope),
  );

export const canTransition = (
  from,
  to,
) =>
  Boolean(
    ALLOWED_TRANSITIONS[
      upper(from)
    ]?.has(upper(to)),
  );

export const isTerminalState = (
  state,
) =>
  TERMINAL_STATES.has(
    upper(state),
  );

export const createComplianceOverrideManager = (
  options = {},
) =>
  new AirtelComplianceOverrideManager(
    options,
  );

export class AirtelComplianceOverrideManager {
  constructor(
    options = {},
  ) {
    this.config = Object.freeze({
      ...DEFAULTS,
      ...(options.config ?? {}),
    });

    this.repository =
      options.repository ??
      options.store ??
      null;

    this.policy =
      options.policy ??
      options.policyEngine ??
      null;

    this.audit =
      options.audit ??
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
      return fn.bind(
        this.repository,
      );
    }

    if (optional) {
      return null;
    }

    if (
      this.config
        .failClosedOnRepositoryError
    ) {
      throw new AirtelComplianceOverrideError(
        'OVERRIDE_REPOSITORY_UNAVAILABLE',
        `Repository method "${method}" is required for this governance operation.`,
        { method },
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
        input.tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      this.config.requireTenantId &&
      !tenantId
    ) {
      throw new AirtelComplianceOverrideError(
        'TENANT_REQUIRED',
        'tenantId is required for compliance override governance.',
      );
    }

    return tenantId;
  }

  _requireProvider(input) {
    const provider =
      upper(
        input.provider ??
          PROVIDER,
      ) ??
      PROVIDER;

    if (
      this.config
        .enforceAirtelProvider &&
      provider !== PROVIDER
    ) {
      throw new AirtelComplianceOverrideError(
        'PROVIDER_SCOPE_VIOLATION',
        'This manager is scoped to Airtel compliance governance.',
        { provider },
      );
    }

    return provider;
  }

  _actor(
    actor,
    fieldName = 'actor',
  ) {
    if (
      !actor ||
      typeof actor !== 'object'
    ) {
      throw new AirtelComplianceOverrideError(
        'ACTOR_REQUIRED',
        `${fieldName} is required.`,
      );
    }

    const actorId =
      actorIdOf(actor);

    if (!actorId) {
      throw new AirtelComplianceOverrideError(
        'ACTOR_ID_REQUIRED',
        `${fieldName}.actorId is required.`,
      );
    }

    return {
      actorId:
        actorId.slice(
          0,
          this.config
            .maxActorIdLength,
        ),

      role:
        actorRoleOf(actor),

      tenantId:
        normalizeString(
          actor.tenantId,
          this.config
            .maxTenantIdLength,
        ),

      displayName:
        normalizeString(
          actor.displayName ??
            actor.name,
          240,
        ),

      source:
        normalizeString(
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
      throw new AirtelComplianceOverrideError(
        'ACTOR_TENANT_MISMATCH',
        `${fieldName} does not belong to the override tenant.`,
        {
          tenantId,
          actorTenantId:
            actor.tenantId,
        },
      );
    }
  }

  _ttl(input) {
    const requested =
      Number(input?.ttlMs);

    const mode =
      upper(input?.mode) ??
      OVERRIDE_MODES.STANDARD;

    if (
      mode ===
      OVERRIDE_MODES.BREAK_GLASS
    ) {
      if (
        !this.config
          .allowBreakGlass
      ) {
        throw new AirtelComplianceOverrideError(
          'BREAK_GLASS_DISABLED',
          'Break-glass compliance overrides are disabled by configuration.',
          {},
          {
            httpStatus: 403,
          },
        );
      }

      const source =
        Number.isFinite(requested)
          ? Math.trunc(requested)
          : this.config
              .breakGlassTtlMs;

      return Math.min(
        this.config
          .breakGlassMaxTtlMs,
        Math.max(
          this.config.minTtlMs,
          source,
        ),
      );
    }

    if (
      !Number.isFinite(requested)
    ) {
      return this.config
        .defaultTtlMs;
    }

    return Math.min(
      this.config.maxTtlMs,
      Math.max(
        this.config.minTtlMs,
        Math.trunc(requested),
      ),
    );
  }

  _maxUses(
    input,
    mode,
  ) {
    if (
      upper(mode) ===
      OVERRIDE_MODES.BREAK_GLASS
    ) {
      return 1;
    }

    const requested =
      Number(input?.maxUses);

    const maxUses =
      Number.isFinite(requested)
        ? Math.trunc(requested)
        : this.config
            .defaultMaxUses;

    if (
      !this.config
        .allowMultipleUse &&
      maxUses > 1
    ) {
      throw new AirtelComplianceOverrideError(
        'MULTIPLE_USE_DISABLED',
        'Multiple-use compliance overrides are disabled by configuration.',
      );
    }

    if (
      maxUses < 1 ||
      maxUses >
        this.config
          .maxAllowedUses
    ) {
      throw new AirtelComplianceOverrideError(
        'INVALID_MAX_USES',
        'Override maxUses is outside the permitted governance range.',
        {
          maxUses,
          maxAllowedUses:
            this.config
              .maxAllowedUses,
        },
      );
    }

    return maxUses;
  }

  _validateControl(
    controlType,
  ) {
    const normalized =
      upper(controlType);

    if (!normalized) {
      throw new AirtelComplianceOverrideError(
        'CONTROL_TYPE_REQUIRED',
        'controlType is required; blanket compliance bypasses are not permitted.',
      );
    }

    if (
      isHardBlockedControl(
        normalized,
        this.config,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'CONTROL_NOT_OVERRIDABLE',
        'The requested compliance control is configured as non-overridable.',
        {
          controlType:
            normalized,
        },
        {
          httpStatus: 403,
        },
      );
    }

    if (
      this.config
        .overridableControlTypes &&
      !new Set(
        this.config
          .overridableControlTypes
          .map(upper),
      ).has(normalized)
    ) {
      throw new AirtelComplianceOverrideError(
        'CONTROL_NOT_CONFIGURED_FOR_OVERRIDE',
        'The requested compliance control is not enabled for override governance.',
        {
          controlType:
            normalized,
        },
        {
          httpStatus: 403,
        },
      );
    }

    return normalized;
  }

  _validateOfflineState(
    input,
  ) {
    const state =
      upper(
        input.offlineState,
      );

    if (!state) {
      return;
    }

    if (
      isOfflineUnsafe(state)
    ) {
      throw new AirtelComplianceOverrideError(
        'OFFLINE_STATE_NOT_OVERRIDEABLE',
        'A compliance override cannot turn an unresolved offline state into final financial execution authorization.',
        {
          offlineState: state,
        },
        {
          httpStatus: 409,
        },
      );
    }
  }

  _validateIdentity(
    input,
    impactLevel,
  ) {
    if (
      !impactRequiresChecker(
        impactLevel,
        this.config,
      )
    ) {
      return;
    }

    if (
      !input
        .originalIdempotencyKey
    ) {
      throw new AirtelComplianceOverrideError(
        'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
        'Financial-impacting compliance overrides require the original tenant-scoped idempotency key.',
      );
    }
  }

  async _policyEvaluate(
    stage,
    input,
  ) {
    if (!this.policy) {
      return {
        decision: null,
        source: 'NONE',
      };
    }

    const method =
      this.policy
        .evaluateOverride ??
      this.policy
        .evaluateComplianceOverride ??
      this.policy.evaluate ??
      this.policy.assess;

    if (
      typeof method !==
      'function'
    ) {
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
            stage,
            component:
              COMPONENT,
            provider:
              PROVIDER,
            tenantId:
              input.tenantId,
            controlType:
              input.controlType,
            controlCode:
              input.controlCode,
            operation:
              input.operation,
            command:
              input.command,
            action:
              input.action,
            impactLevel:
              input.impactLevel,
            riskLevel:
              input.riskLevel,
            mode:
              input.mode,
            scopeFingerprint:
              input.scopeFingerprint,
            actor:
              sanitizeObject(
                input.actor ?? {},
              ),
            request:
              sanitizeObject(
                input.request ??
                  input,
              ),
            override:
              sanitizeObject(
                input.override ??
                  {},
              ),
          },
        );

      const decision =
        upper(
          result?.decision ??
            result?.outcome ??
            result?.status,
        );

      if (
        [
          OVERRIDE_DECISIONS.BLOCK,
          'DENY',
          'BLOCKED',
        ].includes(decision)
      ) {
        return {
          decision:
            OVERRIDE_DECISIONS.BLOCK,
          source: 'POLICY',
          result:
            sanitizeObject(
              result,
            ),
        };
      }

      if (
        [
          OVERRIDE_DECISIONS.REJECT,
          'REJECTED',
        ].includes(decision)
      ) {
        return {
          decision:
            OVERRIDE_DECISIONS.REJECT,
          source: 'POLICY',
          result:
            sanitizeObject(
              result,
            ),
        };
      }

      if (
        [
          OVERRIDE_DECISIONS.REQUIRE_REVIEW,
          'REVIEW',
        ].includes(decision)
      ) {
        return {
          decision:
            OVERRIDE_DECISIONS.REQUIRE_REVIEW,
          source: 'POLICY',
          result:
            sanitizeObject(
              result,
            ),
        };
      }

      return {
        decision:
          OVERRIDE_DECISIONS.APPROVE,
        source:
          'POLICY',
        result:
          sanitizeObject(
            result,
          ),
      };
    } catch (error) {
      this._log(
        'error',
        'Override policy evaluation failed.',
        {
          stage,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnPolicyError
      ) {
        throw new AirtelComplianceOverrideError(
          'OVERRIDE_POLICY_UNAVAILABLE',
          'Compliance policy evaluation is unavailable; the override cannot proceed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          OVERRIDE_DECISIONS.REQUIRE_REVIEW,
        source:
          'POLICY_ERROR',
      };
    }
  }

  _auditEvent(
    type,
    record,
    actor,
    extra = {},
  ) {
    const event = {
      type,
      component:
        COMPONENT,
      provider:
        PROVIDER,
      engineVersion:
        ENGINE_VERSION,
      approvalId:
        record.overrideId,
      tenantId:
        record.tenantId,
      state:
        record.state,
      action:
        record.action,
      decision:
        record.decision,
      mode:
        record.mode,
      controlType:
        record.controlType,
      controlCode:
        record.controlCode,
      scopeFingerprint:
        record.scopeFingerprint,
      maker:
        record.maker,
      checker:
        actor?.actorId,
      at:
        nowIso(
          this.clock,
        ),
      ...sanitizeObject(
        extra,
      ),
    };

    event.auditFingerprint =
      sha256(event);

    return deepFreeze(event);
  }

  async _writeAudit(
    event,
  ) {
    const fn =
      this.audit?.append ??
      this.audit?.record ??
      this.audit?.write;

    if (
      typeof fn !==
      'function'
    ) {
      return;
    }

    try {
      await fn.call(
        this.audit,
        event,
      );
    } catch (error) {
      this._log(
        'error',
        'Compliance override audit write failed.',
        {
          approvalId:
            event.approvalId,
          message:
            error?.message,
        },
      );

      throw new AirtelComplianceOverrideError(
        'OVERRIDE_AUDIT_UNAVAILABLE',
        'Compliance override governance cannot continue because its audit boundary is unavailable.',
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
      typeof method ===
      'function'
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
      const increment =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      if (
        typeof increment ===
        'function'
      ) {
        increment.call(
          this.metrics,
          name,
          sanitizeObject(
            labels,
          ),
        );
      }
    } catch {
      // Metrics must never alter compliance decisions.
    }
  }

  _buildRecord(
    input,
    maker,
    scope,
    fingerprint,
    expiresAt,
  ) {
    const tenantId =
      this._requireTenant(
        input,
      );

    const provider =
      this._requireProvider(
        input,
      );

    const mode =
      upper(input.mode) ??
      OVERRIDE_MODES.STANDARD;

    const impactLevel =
      upper(
        input.impactLevel,
      ) ??
      IMPACT_LEVELS.NON_FINANCIAL;

    const riskLevel =
      upper(
        input.riskLevel,
      ) ??
      RISK_LEVELS.MEDIUM;

    const maxUses =
      this._maxUses(
        input,
        mode,
      );

    return {
      overrideId:
        normalizeString(
          input.overrideId,
          160,
        ) ??
        this.idFactory(),

      overrideVersion:
        1,

      component:
        COMPONENT,

      engineName:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      provider,
      tenantId,

      state:
        OVERRIDE_STATES.DRAFT,

      action:
        upper(
          input.action,
        ) ??
        OVERRIDE_ACTIONS.CREATE,

      decision:
        OVERRIDE_DECISIONS.REQUIRE_REVIEW,

      mode,

      controlType:
        upper(
          input.controlType,
        ),

      controlCode:
        normalizeString(
          input.controlCode,
          180,
        ),

      impactLevel,
      riskLevel,

      maker:
        maker.actorId,

      makerActor:
        maker,

      requiredChecker:
        input.requiredChecker
          ? this._actor(
              input.requiredChecker,
              'requiredChecker',
            )
          : undefined,

      scope:
        sanitizeObject(
          scope,
        ),

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
            input.commandPlan
              ?.commandId,
          240,
        ),

      paymentId:
        normalizeString(
          input.paymentId ??
            input.paymentIdentity
              ?.paymentId,
          240,
        ),

      transactionId:
        normalizeString(
          input.transactionId ??
            input.paymentIdentity
              ?.transactionId,
          240,
        ),

      businessJustification:
        normalizeString(
          input.businessJustification ??
            input.reason,
          this.config
            .maxReasonLength,
        ),

      evidenceReference:
        normalizeString(
          input.evidenceReference ??
            input.caseReference,
          this.config
            .maxReferenceLength,
        ),

      metadata:
        sanitizeObject(
          input.metadata ??
            {},
        ),

      maxUses,

      usesConsumed:
        0,

      createdAt:
        nowIso(this.clock),

      updatedAt:
        nowIso(this.clock),

      submittedAt:
        undefined,

      approvedAt:
        undefined,

      rejectedAt:
        undefined,

      revokedAt:
        undefined,

      expiresAt:
        expiresAt.toISOString(),

      consumedAt:
        undefined,

      supersededAt:
        undefined,

      supersededBy:
        undefined,

      approvalFingerprint:
        undefined,

      auditFingerprint:
        undefined,

      version:
        1,
    };
  }

  _getIdempotencyKey(
    record,
  ) {
    return `${record.tenantId}:compliance-override:${record.overrideId}:${record.scopeFingerprint}`;
  }

  async request(
    input = {},
  ) {
    const normalized =
      normalizeContext(input);

    const maker =
      this._actor(
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

    const provider =
      this._requireProvider(
        normalized,
      );

    const controlType =
      this._validateControl(
        normalized.controlType,
      );

    const mode =
      upper(
        normalized.mode,
      ) ??
      OVERRIDE_MODES.STANDARD;

    if (
      mode ===
        OVERRIDE_MODES.BREAK_GLASS &&
      !this.config
        .allowBreakGlass
    ) {
      throw new AirtelComplianceOverrideError(
        'BREAK_GLASS_DISABLED',
        'Break-glass override mode is disabled.',
        {},
        {
          httpStatus: 403,
        },
      );
    }

    if (
      mode ===
        OVERRIDE_MODES.BREAK_GLASS &&
      this.config
        .breakGlassRequiredRoles &&
      !new Set(
        this.config
          .breakGlassRequiredRoles
          .map(upper),
      ).has(
        actorRoleOf(maker),
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'BREAK_GLASS_ROLE_REQUIRED',
        'The requesting actor is not authorized to initiate a break-glass override.',
        {
          role:
            actorRoleOf(
              maker,
            ),
        },
        {
          httpStatus: 403,
        },
      );
    }

    this._validateOfflineState(
      normalized,
    );

    const impactLevel =
      upper(
        normalized.impactLevel,
      ) ??
      IMPACT_LEVELS.NON_FINANCIAL;

    this._validateIdentity(
      {
        ...normalized,

        originalIdempotencyKey:
          normalized
            .originalIdempotencyKey ??
          normalized
            .paymentIdentity
            ?.originalIdempotencyKey ??
          normalized
            .commandPlan
            ?.originalIdempotencyKey,
      },
      impactLevel,
    );

    if (
      this.config
        .requireBusinessJustification &&
      !normalizeString(
        normalized
          .businessJustification ??
          normalized.reason,
        this.config
          .maxReasonLength,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'BUSINESS_JUSTIFICATION_REQUIRED',
        'A business justification is required for a compliance override.',
      );
    }

    if (
      this.config
        .requireControlEvidence &&
      !normalizeString(
        normalized
          .evidenceReference ??
          normalized.caseReference,
        this.config
          .maxReferenceLength,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'CONTROL_EVIDENCE_REQUIRED',
        'Evidence/case reference is required for this compliance override.',
      );
    }

    const scope =
      buildOverrideScope({
        ...normalized,
        tenantId,
        provider,
        controlType,
        impactLevel,
      });

    const fingerprint =
      overrideScopeFingerprint(
        scope,
      );

    const policy =
      await this._policyEvaluate(
        'REQUEST',
        {
          ...normalized,
          tenantId,
          provider,
          controlType,
          impactLevel,
          mode,
          scopeFingerprint:
            fingerprint,
          actor: maker,
        },
      );

    if (
      [
        OVERRIDE_DECISIONS.BLOCK,
        OVERRIDE_DECISIONS.REJECT,
      ].includes(
        policy.decision,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        policy.decision ===
          OVERRIDE_DECISIONS.BLOCK
          ? 'OVERRIDE_POLICY_BLOCKED'
          : 'OVERRIDE_POLICY_REJECTED',
        'The requested compliance override is not eligible under the active policy.',
        {
          policyDecision:
            policy.decision,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const expiresAt =
      new Date(
        nowMs(this.clock) +
          this._ttl(
            normalized,
          ),
      );

    const record =
      this._buildRecord(
        {
          ...normalized,
          tenantId,
          provider,
          controlType,
          impactLevel,
          mode,
        },
        maker,
        scope,
        fingerprint,
        expiresAt,
      );

    record.approvalId =
      record.overrideId;

    record.approvalFingerprint =
      sha256({
        overrideId:
          record.overrideId,

        tenantId:
          record.tenantId,

        scopeFingerprint:
          record.scopeFingerprint,

        maker:
          record.maker,

        expiresAt:
          record.expiresAt,
      });

    const requiresChecker =
      this.config
        .requireMakerChecker ||
      impactRequiresChecker(
        impactLevel,
        this.config,
      ) ||
      (
        mode ===
          OVERRIDE_MODES.BREAK_GLASS &&
        this.config
          .requireCheckerForBreakGlass
      );

    record.metadata = {
      ...record.metadata,

      requiresChecker,

      policyDecision:
        policy.decision ??
        null,

      policySource:
        policy.source,

      exceptionClass:
        'SCOPED_COMPLIANCE_EXCEPTION',
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
              this._getIdempotencyKey(
                record,
              ),
          },
        );
    }

    await this._writeAudit(
      this._auditEvent(
        'OVERRIDE_CREATED',
        persisted,
        maker,
        {
          requiresChecker,
        },
      ),
    );

    this._metric(
      'airtel_compliance_override_created_total',
      {
        mode,
        controlType,
        requiresChecker:
          String(
            requiresChecker,
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
      normalizeContext(input);

    const override =
      await this._get(
        normalized,
      );

    const actor =
      this._actor(
        normalized.actor ??
          normalized.maker,
        'actor',
      );

    this._assertActorTenant(
      actor,
      override.tenantId,
      'actor',
    );

    if (
      this._isExpired(
        override,
      )
    ) {
      return this._expireRecord(
        override,
        actor,
      );
    }

    if (
      override.state !==
      OVERRIDE_STATES.DRAFT
    ) {
      throw new AirtelComplianceOverrideError(
        'INVALID_SUBMIT_STATE',
        `Override cannot be submitted from ${override.state}.`,
        {
          state:
            override.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      normalized.scopeFingerprint ||
      normalized.commandPlan ||
      normalized.plan ||
      normalized.controlType
    ) {
      this._assertScopeMatch(
        override,
        normalized,
      );
    }

    const requiresChecker =
      Boolean(
        override.metadata
          ?.requiresChecker ??
          this.config
            .requireMakerChecker,
      );

    const targetState =
      requiresChecker
        ? OVERRIDE_STATES.PENDING
        : OVERRIDE_STATES.APPROVED;

    this._assertTransition(
      override.state,
      targetState,
    );

    const policy =
      await this._policyEvaluate(
        'SUBMIT',
        {
          ...normalized,

          tenantId:
            override.tenantId,

          provider:
            override.provider,

          controlType:
            override.controlType,

          impactLevel:
            override.impactLevel,

          mode:
            override.mode,

          scopeFingerprint:
            override.scopeFingerprint,

          actor,

          override,
        },
      );

    if (
      [
        OVERRIDE_DECISIONS.BLOCK,
        OVERRIDE_DECISIONS.REJECT,
      ].includes(
        policy.decision,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'OVERRIDE_SUBMIT_BLOCKED',
        'The override cannot be submitted under the current compliance policy.',
        {
          policyDecision:
            policy.decision,
        },
        {
          httpStatus: 409,
        },
      );
    }

    override.state =
      targetState;

    override.decision =
      requiresChecker
        ? OVERRIDE_DECISIONS.REQUIRE_REVIEW
        : OVERRIDE_DECISIONS.APPROVE;

    override.submittedAt =
      nowIso(this.clock);

    override.updatedAt =
      nowIso(this.clock);

    override.version =
      Number(
        override.version ?? 1,
      ) + 1;

    if (
      targetState ===
      OVERRIDE_STATES.APPROVED
    ) {
      override.approvedAt =
        nowIso(this.clock);

      override.approvalFingerprint =
        sha256({
          approvalFingerprint:
            override
              .approvalFingerprint,

          submittedAt:
            override.submittedAt,

          scopeFingerprint:
            override.scopeFingerprint,
        });
    }

    const updated =
      await this._transition(
        override,
        {
          fromState:
            OVERRIDE_STATES.DRAFT,

          toState:
            targetState,

          action:
            OVERRIDE_ACTIONS.SUBMIT,

          actor,

          expectedVersion:
            Number(
              override.version,
            ) - 1,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'OVERRIDE_SUBMITTED',
        updated,
        actor,
        {
          requiresChecker,
        },
      ),
    );

    this._metric(
      'airtel_compliance_override_submitted_total',
      {
        requiresChecker:
          String(
            requiresChecker,
          ),
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
      normalizeContext(input);

    const override =
      await this._get(
        normalized,
      );

    const checker =
      this._actor(
        normalized.checker ??
          normalized.actor,
        'checker',
      );

    this._assertActorTenant(
      checker,
      override.tenantId,
      'checker',
    );

    this._assertCheckerDistinct(
      override,
      checker,
    );

    if (
      override
        .requiredChecker
        ?.actorId &&
      override
        .requiredChecker
        .actorId !==
        checker.actorId
    ) {
      throw new AirtelComplianceOverrideError(
        'REQUIRED_CHECKER_MISMATCH',
        'The configured checker does not match the approval actor.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    if (
      this._isExpired(
        override,
      )
    ) {
      return this._expireRecord(
        override,
        checker,
      );
    }

    if (
      override.state !==
      OVERRIDE_STATES.PENDING
    ) {
      throw new AirtelComplianceOverrideError(
        'INVALID_APPROVAL_STATE',
        `Override cannot be approved from ${override.state}.`,
        {
          state:
            override.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    this._assertScopeMatch(
      override,
      normalized,
    );

    const reason =
      normalizeString(
        normalized.reason ??
          normalized.comment,
        this.config
          .maxCommentLength,
      );

    if (!reason) {
      throw new AirtelComplianceOverrideError(
        'APPROVAL_REASON_REQUIRED',
        'Checker approval requires a governance reason.',
      );
    }

    const policy =
      await this._policyEvaluate(
        'APPROVE',
        {
          ...normalized,

          tenantId:
            override.tenantId,

          provider:
            override.provider,

          controlType:
            override.controlType,

          impactLevel:
            override.impactLevel,

          mode:
            override.mode,

          scopeFingerprint:
            override.scopeFingerprint,

          actor:
            checker,

          override,
        },
      );

    if (
      [
        OVERRIDE_DECISIONS.BLOCK,
        OVERRIDE_DECISIONS.REJECT,
        OVERRIDE_DECISIONS.REQUIRE_REVIEW,
      ].includes(
        policy.decision,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        policy.decision ===
          OVERRIDE_DECISIONS.BLOCK
          ? 'OVERRIDE_APPROVAL_BLOCKED'
          : 'OVERRIDE_APPROVAL_NOT_GRANTED',
        'The override cannot be activated under the current compliance policy.',
        {
          policyDecision:
            policy.decision,
        },
        {
          httpStatus: 409,
        },
      );
    }

    this._assertTransition(
      override.state,
      OVERRIDE_STATES.APPROVED,
    );

    override.checker =
      checker.actorId;

    override.checkerActor =
      checker;

    override.approvalReason =
      reason;

    override.approvedAt =
      nowIso(this.clock);

    override.updatedAt =
      nowIso(this.clock);

    override.version =
      Number(
        override.version ?? 1,
      ) + 1;

    override.decision =
      OVERRIDE_DECISIONS.APPROVE;

    override.approvalFingerprint =
      sha256({
        previous:
          override
            .approvalFingerprint,

        checker:
          checker.actorId,

        scopeFingerprint:
          override
            .scopeFingerprint,

        approvedAt:
          override
            .approvedAt,
      });

    override.state =
      OVERRIDE_STATES.APPROVED;

    const updated =
      await this._transition(
        override,
        {
          fromState:
            OVERRIDE_STATES.PENDING,

          toState:
            OVERRIDE_STATES.APPROVED,

          action:
            OVERRIDE_ACTIONS.APPROVE,

          actor:
            checker,

          expectedVersion:
            Number(
              override.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'OVERRIDE_APPROVED',
        updated,
        checker,
        {
          reason,
        },
      ),
    );

    this._metric(
      'airtel_compliance_override_approved_total',
      {
        mode:
          override.mode,

        controlType:
          override.controlType,
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
      OVERRIDE_STATES.REJECTED,
      OVERRIDE_ACTIONS.REJECT,
      OVERRIDE_DECISIONS.REJECT,
      'REJECTED',
    );
  }

  async revoke(
    input = {},
  ) {
    return this._decide(
      input,
      OVERRIDE_STATES.REVOKED,
      OVERRIDE_ACTIONS.REVOKE,
      OVERRIDE_DECISIONS.REJECT,
      'REVOKED',
    );
  }

  async _decide(
    input,
    targetState,
    action,
    decision,
    eventName,
  ) {
    const normalized =
      normalizeContext(input);

    const override =
      await this._get(
        normalized,
      );

    const actor =
      this._actor(
        normalized.actor,
        'actor',
      );

    this._assertActorTenant(
      actor,
      override.tenantId,
      'actor',
    );

    if (
      targetState ===
      OVERRIDE_STATES.REVOKED
    ) {
      this._assertCheckerDistinct(
        override,
        actor,
      );
    }

    if (
      targetState ===
      OVERRIDE_STATES.REJECTED
    ) {
      this._assertCheckerDistinct(
        override,
        actor,
      );
    }

    if (
      ![
        OVERRIDE_STATES.DRAFT,
        OVERRIDE_STATES.PENDING,
        OVERRIDE_STATES.APPROVED,
      ].includes(
        override.state,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'INVALID_DECISION_STATE',
        `Override cannot transition to ${targetState} from ${override.state}.`,
        {
          state:
            override.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      this._isExpired(
        override,
      )
    ) {
      return this._expireRecord(
        override,
        actor,
      );
    }

    if (
      normalized.scopeFingerprint ||
      normalized.commandPlan ||
      normalized.plan
    ) {
      this._assertScopeMatch(
        override,
        normalized,
      );
    }

    const reason =
      normalizeString(
        normalized.reason ??
          normalized.comment,
        this.config
          .maxCommentLength,
      );

    if (!reason) {
      throw new AirtelComplianceOverrideError(
        'DECISION_REASON_REQUIRED',
        'A governance reason is required for rejection/revocation.',
      );
    }

    this._assertTransition(
      override.state,
      targetState,
    );

    const previousState =
      override.state;

    override.state =
      targetState;

    override.decision =
      decision;

    override.updatedAt =
      nowIso(this.clock);

    override.version =
      Number(
        override.version ?? 1,
      ) + 1;

    override.decisionReason =
      reason;

    if (
      targetState ===
      OVERRIDE_STATES.REJECTED
    ) {
      override.rejectedAt =
        nowIso(this.clock);

      override.checker =
        actor.actorId;

      override.checkerActor =
        actor;
    }

    if (
      targetState ===
      OVERRIDE_STATES.REVOKED
    ) {
      override.revokedAt =
        nowIso(this.clock);

      override.revokedBy =
        actor.actorId;

      override.revokedByActor =
        actor;
    }

    const updated =
      await this._transition(
        override,
        {
          fromState:
            previousState,

          toState:
            targetState,

          action,

          actor,

          expectedVersion:
            Number(
              override.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        `OVERRIDE_${eventName}`,
        updated,
        actor,
        {
          reason,
        },
      ),
    );

    this._metric(
      'airtel_compliance_override_decision_total',
      {
        outcome:
          eventName,
      },
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async consume(
    input = {},
  ) {
    const normalized =
      normalizeContext(input);

    const override =
      await this._get(
        normalized,
      );

    const actor =
      this._actor(
        normalized.actor ??
          normalized.executor,
        'actor',
      );

    this._assertActorTenant(
      actor,
      override.tenantId,
      'actor',
    );

    this._assertScopeMatch(
      override,
      normalized,
    );

    if (
      this._isExpired(
        override,
      )
    ) {
      return this._expireRecord(
        override,
        actor,
      );
    }

    if (
      override.state !==
      OVERRIDE_STATES.APPROVED
    ) {
      if (
        override.state ===
        OVERRIDE_STATES.CONSUMED
      ) {
        return deepFreeze({
          ...clone(
            override,
          ),

          outcome:
            OUTCOMES.REPLAY,

          executable:
            false,
        });
      }

      throw new AirtelComplianceOverrideError(
        'OVERRIDE_NOT_ACTIVE',
        `Override is not consumable from state ${override.state}.`,
        {
          state:
            override.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    this._assertFinancialSafety(
      normalized,
      override,
    );

    const remaining =
      Number(
        override.maxUses ?? 1,
      ) -
      Number(
        override.usesConsumed ??
          0,
      );

    if (remaining <= 0) {
      throw new AirtelComplianceOverrideError(
        'OVERRIDE_USAGE_EXHAUSTED',
        'Compliance override usage limit has been exhausted.',
        {
          overrideId:
            override.overrideId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const nextUses =
      Number(
        override.usesConsumed ??
          0,
      ) + 1;

    const finalUse =
      nextUses >=
      Number(
        override.maxUses ??
          1,
      );

    const targetState =
      finalUse
        ? OVERRIDE_STATES.CONSUMED
        : OVERRIDE_STATES.APPROVED;

    if (
      targetState !==
      override.state
    ) {
      this._assertTransition(
        override.state,
        targetState,
      );
    }

    const priorState =
      override.state;

    override.usesConsumed =
      nextUses;

    override.lastConsumedAt =
      nowIso(this.clock);

    override.lastConsumedBy =
      actor.actorId;

    override.updatedAt =
      nowIso(this.clock);

    override.version =
      Number(
        override.version ?? 1,
      ) + 1;

    if (finalUse) {
      override.state =
        targetState;
    }

    const consumeFn =
      this._requireRepository(
        'consume',
        {
          optional:
            true,
        },
      );

    let updated;

    if (consumeFn) {
      updated =
        await consumeFn({
          overrideId:
            override.overrideId,

          tenantId:
            override.tenantId,

          expectedVersion:
            Number(
              override.version,
            ) - 1,

          expectedState:
            priorState,

          expectedScopeFingerprint:
            override.scopeFingerprint,

          actorId:
            actor.actorId,

          targetState,

          usesConsumed:
            nextUses,

          maxUses:
            override.maxUses,

          patch:
            sanitizeObject(
              override,
            ),
        });
    } else {
      updated =
        await this._transition(
          override,
          {
            fromState:
              priorState,

            toState:
              targetState,

            action:
              OVERRIDE_ACTIONS.CONSUME,

            actor,

            expectedVersion:
              Number(
                override.version,
              ) - 1,

            requireAtomicGuard:
              true,
          },
        );
    }

    await this._writeAudit(
      this._auditEvent(
        'OVERRIDE_CONSUMED',
        updated,
        actor,
        {
          usesConsumed:
            nextUses,

          finalUse,
        },
      ),
    );

    this._metric(
      'airtel_compliance_override_consumed_total',
      {
        finalUse:
          String(
            finalUse,
          ),
      },
    );

    return deepFreeze({
      ...clone(updated),

      outcome:
        OUTCOMES.AUTHORIZED,

      executable:
        true,

      remainingUses:
        Number(
          updated.maxUses ??
            1,
        ) -
        Number(
          updated
            .usesConsumed ??
            nextUses,
        ),

      financialSafety: {
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

        complianceOverrideOnly:
          true,
      },
    });
  }

  async verifyForExecution(
    input = {},
  ) {
    const normalized =
      normalizeContext(input);

    const override =
      await this._get(
        normalized,
      );

    const tenantId =
      this._requireTenant(
        normalized,
      );

    const provider =
      this._requireProvider(
        normalized,
      );

    if (
      tenantId !==
      override.tenantId
    ) {
      return {
        outcome:
          OUTCOMES.NOT_AUTHORIZED,

        executable:
          false,

        code:
          'TENANT_SCOPE_MISMATCH',
      };
    }

    if (
      provider !==
      override.provider
    ) {
      return {
        outcome:
          OUTCOMES.NOT_AUTHORIZED,

        executable:
          false,

        code:
          'PROVIDER_SCOPE_MISMATCH',
      };
    }

    if (
      isHardBlockedControl(
        override.controlType,
        this.config,
      )
    ) {
      return {
        outcome:
          OUTCOMES.BLOCKED,

        executable:
          false,

        code:
          'CONTROL_NOT_OVERRIDABLE',

        controlType:
          override.controlType,
      };
    }

    if (
      this._isExpired(
        override,
      )
    ) {
      return {
        outcome:
          OUTCOMES.EXPIRED,

        executable:
          false,

        code:
          'OVERRIDE_EXPIRED',
      };
    }

    if (
      override.state ===
      OVERRIDE_STATES.CONSUMED
    ) {
      return {
        outcome:
          OUTCOMES.REPLAY,

        executable:
          false,

        code:
          'OVERRIDE_ALREADY_CONSUMED',
      };
    }

    if (
      override.state !==
      OVERRIDE_STATES.APPROVED
    ) {
      return {
        outcome:
          override.state ===
            OVERRIDE_STATES.PENDING
            ? OUTCOMES.PENDING
            : OUTCOMES.NOT_AUTHORIZED,

        executable:
          false,

        code:
          'OVERRIDE_NOT_APPROVED',

        state:
          override.state,
      };
    }

    try {
      this._assertScopeMatch(
        override,
        normalized,
      );

      this._assertFinancialSafety(
        normalized,
        override,
      );
    } catch (error) {
      return {
        outcome:
          error?.code ===
            'OVERRIDE_SCOPE_MISMATCH'
            ? OUTCOMES.STALE
            : OUTCOMES.NOT_AUTHORIZED,

        executable:
          false,

        code:
          error?.code ??
          'OVERRIDE_VALIDATION_FAILED',

        details:
          sanitizeObject(
            error?.details ??
              {},
          ),
      };
    }

    const checkerComplete =
      Boolean(
        !this.config
          .requireMakerChecker ||
          (
            override.maker &&
            override.checker &&
            override.maker !==
              override.checker
          ),
      );

    if (!checkerComplete) {
      return {
        outcome:
          OUTCOMES.NOT_AUTHORIZED,

        executable:
          false,

        code:
          'MAKER_CHECKER_INCOMPLETE',
      };
    }

    const policy =
      await this._policyEvaluate(
        'EXECUTION_VERIFY',
        {
          ...normalized,

          tenantId:
            override.tenantId,

          provider:
            override.provider,

          controlType:
            override.controlType,

          impactLevel:
            override.impactLevel,

          mode:
            override.mode,

          scopeFingerprint:
            override.scopeFingerprint,

          override,
        },
      );

    if (
      policy.decision ===
      OVERRIDE_DECISIONS.BLOCK
    ) {
      return {
        outcome:
          OUTCOMES.BLOCKED,

        executable:
          false,

        code:
          'POLICY_BLOCKED',
      };
    }

    if (
      policy.decision ===
      OVERRIDE_DECISIONS.REQUIRE_REVIEW
    ) {
      return {
        outcome:
          OUTCOMES.PENDING,

        executable:
          false,

        code:
          'POLICY_REQUIRES_REVIEW',
      };
    }

    const remainingUses =
      Number(
        override.maxUses ??
          1,
      ) -
      Number(
        override.usesConsumed ??
          0,
      );

    if (
      remainingUses <= 0
    ) {
      return {
        outcome:
          OUTCOMES.REPLAY,

        executable:
          false,

        code:
          'OVERRIDE_USAGE_EXHAUSTED',
      };
    }

    return deepFreeze({
      outcome:
        OUTCOMES.AUTHORIZED,

      executable:
        true,

      overrideId:
        override.overrideId,

      approvalId:
        override.approvalId ??
        override.overrideId,

      tenantId:
        override.tenantId,

      provider:
        override.provider,

      controlType:
        override.controlType,

      controlCode:
        override.controlCode,

      mode:
        override.mode,

      scopeFingerprint:
        override.scopeFingerprint,

      approvalFingerprint:
        override.approvalFingerprint,

      maker:
        override.maker,

      checker:
        override.checker,

      expiresAt:
        override.expiresAt,

      usesConsumed:
        Number(
          override
            .usesConsumed ??
            0,
        ),

      maxUses:
        Number(
          override.maxUses ??
            1,
        ),

      remainingUses,

      financialSafety: {
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

        complianceOverrideOnly:
          true,
      },
    });
  }

  _assertFinancialSafety(
    input,
    override,
  ) {
    const impact =
      upper(
        input.impactLevel ??
          override.impactLevel,
      ) ??
      IMPACT_LEVELS.NON_FINANCIAL;

    if (
      !impactRequiresChecker(
        impact,
        this.config,
      )
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
            ?.originalIdempotencyKey ??
          override.originalIdempotencyKey,
        240,
      );

    if (!key) {
      throw new AirtelComplianceOverrideError(
        'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
        'Financial-impacting execution requires the original idempotency key.',
      );
    }

    if (
      override
        .originalIdempotencyKey &&
      override
        .originalIdempotencyKey !==
        key
    ) {
      throw new AirtelComplianceOverrideError(
        'IDEMPOTENCY_SCOPE_MISMATCH',
        'Execution idempotency identity does not match the approved override.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      !input.allowFinancialMutationHere &&
      input.writeLedgerHere ===
        true
    ) {
      throw new AirtelComplianceOverrideError(
        'LEDGER_MUTATION_BOUNDARY_VIOLATION',
        'The compliance override manager cannot authorize direct ledger mutation.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    if (
      input.mutateBalanceHere ===
      true
    ) {
      throw new AirtelComplianceOverrideError(
        'BALANCE_MUTATION_BOUNDARY_VIOLATION',
        'The compliance override manager cannot authorize direct balance mutation.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }
  }

  _assertCheckerDistinct(
    override,
    checker,
  ) {
    if (
      this.config
        .requireMakerChecker &&
      override.maker &&
      override.maker ===
        checker.actorId
    ) {
      throw new AirtelComplianceOverrideError(
        'MAKER_CHECKER_SEPARATION_VIOLATION',
        'The maker cannot act as the checker for a governed compliance override.',
        {
          maker:
            override.maker,

          checker:
            checker.actorId,
        },
        {
          httpStatus:
            409,
        },
      );
    }
  }

  _assertScopeMatch(
    override,
    input,
  ) {
    const explicitFingerprint =
      normalizeString(
        input.scopeFingerprint,
        128,
      );

    const fingerprint =
      explicitFingerprint ??
      overrideScopeFingerprint({
        ...input,

        tenantId:
          input.tenantId ??
          override.tenantId,

        provider:
          input.provider ??
          override.provider,

        controlType:
          input.controlType ??
          input.control ??
          override.controlType,
      });

    if (
      fingerprint !==
      override.scopeFingerprint
    ) {
      throw new AirtelComplianceOverrideError(
        'OVERRIDE_SCOPE_MISMATCH',
        'The compliance override does not match the exact operation/control being acted upon.',
        {
          overrideId:
            override.overrideId,

          expected:
            override
              .scopeFingerprint,

          received:
            fingerprint,
        },
        {
          httpStatus:
            409,
        },
      );
    }
  }

  _assertTransition(
    from,
    to,
  ) {
    if (
      !canTransition(
        from,
        to,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'INVALID_STATE_TRANSITION',
        `Cannot transition override from ${from} to ${to}.`,
        {
          from,
          to,
        },
        {
          httpStatus:
            409,
        },
      );
    }
  }

  _isExpired(
    record,
  ) {
    const expiry =
      new Date(
        record.expiresAt,
      ).getTime();

    if (
      !Number.isFinite(
        expiry,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'INVALID_EXPIRY',
        'Override expiry is invalid.',
        {
          overrideId:
            record.overrideId,
        },
      );
    }

    return (
      expiry <=
      nowMs(this.clock)
    );
  }

  async _expireRecord(
    override,
    actor,
  ) {
    if (
      isTerminalState(
        override.state,
      )
    ) {
      return deepFreeze(
        clone(override),
      );
    }

    if (
      !this._isExpired(
        override,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'OVERRIDE_NOT_EXPIRED',
        'Override has not reached its configured expiry time.',
        {
          expiresAt:
            override.expiresAt,
        },
        {
          httpStatus:
            409,
        },
      );
    }

    this._assertTransition(
      override.state,
      OVERRIDE_STATES.EXPIRED,
    );

    const previousState =
      override.state;

    override.state =
      OVERRIDE_STATES.EXPIRED;

    override.decision =
      OVERRIDE_DECISIONS.REJECT;

    override.expiredAt =
      nowIso(this.clock);

    override.updatedAt =
      nowIso(this.clock);

    override.version =
      Number(
        override.version ?? 1,
      ) + 1;

    const updated =
      await this._transition(
        override,
        {
          fromState:
            previousState,

          toState:
            OVERRIDE_STATES.EXPIRED,

          action:
            OVERRIDE_ACTIONS.EXPIRE,

          actor,

          expectedVersion:
            Number(
              override.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'OVERRIDE_EXPIRED',
        updated,
        actor,
      ),
    );

    this._metric(
      'airtel_compliance_override_expired_total',
      {},
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async supersede(
    input = {},
  ) {
    const normalized =
      normalizeContext(input);

    const override =
      await this._get(
        normalized,
      );

    const actor =
      this._actor(
        normalized.actor,
        'actor',
      );

    this._assertActorTenant(
      actor,
      override.tenantId,
      'actor',
    );

    if (
      ![
        OVERRIDE_STATES.DRAFT,
        OVERRIDE_STATES.PENDING,
        OVERRIDE_STATES.APPROVED,
      ].includes(
        override.state,
      )
    ) {
      throw new AirtelComplianceOverrideError(
        'INVALID_SUPERSEDE_STATE',
        `Override cannot be superseded from ${override.state}.`,
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    const replacementId =
      normalizeString(
        normalized
          .replacementOverrideId ??
          normalized
            .supersededBy,
        160,
      );

    if (!replacementId) {
      throw new AirtelComplianceOverrideError(
        'REPLACEMENT_OVERRIDE_REQUIRED',
        'replacementOverrideId is required when superseding an override.',
      );
    }

    const reason =
      normalizeString(
        normalized.reason ??
          normalized.comment,
        this.config
          .maxCommentLength,
      );

    if (!reason) {
      throw new AirtelComplianceOverrideError(
        'SUPERSEDE_REASON_REQUIRED',
        'A supersede reason is required.',
      );
    }

    this._assertScopeMatch(
      override,
      normalized,
    );

    this._assertTransition(
      override.state,
      OVERRIDE_STATES.SUPERSEDED,
    );

    const previousState =
      override.state;

    override.state =
      OVERRIDE_STATES.SUPERSEDED;

    override.decision =
      OVERRIDE_DECISIONS.REJECT;

    override.supersededBy =
      replacementId;

    override.supersededAt =
      nowIso(this.clock);

    override.supersedeReason =
      reason;

    override.updatedAt =
      nowIso(this.clock);

    override.version =
      Number(
        override.version ?? 1,
      ) + 1;

    const updated =
      await this._transition(
        override,
        {
          fromState:
            previousState,

          toState:
            OVERRIDE_STATES.SUPERSEDED,

          action:
            OVERRIDE_ACTIONS.SUPERSEDE,

          actor,

          expectedVersion:
            Number(
              override.version,
            ) - 1,

          requireAtomicGuard:
            true,
        },
      );

    await this._writeAudit(
      this._auditEvent(
        'OVERRIDE_SUPERSEDED',
        updated,
        actor,
        {
          replacementOverrideId:
            replacementId,

          reason,
        },
      ),
    );

    return deepFreeze(
      clone(updated),
    );
  }

  async get(
    input = {},
  ) {
    return deepFreeze(
      clone(
        await this._get(
          normalizeContext(
            input,
          ),
        ),
      ),
    );
  }

  async _get(
    input,
  ) {
    const overrideId =
      normalizeString(
        input.overrideId ??
          input.approvalId ??
          input.id,
        160,
      );

    if (!overrideId) {
      throw new AirtelComplianceOverrideError(
        'OVERRIDE_ID_REQUIRED',
        'overrideId is required.',
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

    const override =
      await getFn(
        overrideId,
        {
          tenantId,
        },
      );

    if (!override) {
      throw new AirtelComplianceOverrideError(
        'OVERRIDE_NOT_FOUND',
        'Compliance override was not found within the tenant scope.',
        {
          overrideId,
          tenantId,
        },
        {
          httpStatus:
            404,
        },
      );
    }

    if (
      override.tenantId !==
      tenantId
    ) {
      throw new AirtelComplianceOverrideError(
        'TENANT_SCOPE_MISMATCH',
        'Compliance override tenant scope mismatch.',
        {},
        {
          httpStatus:
            404,
        },
      );
    }

    if (
      override.provider !==
      PROVIDER
    ) {
      throw new AirtelComplianceOverrideError(
        'PROVIDER_SCOPE_VIOLATION',
        'Compliance override provider is outside Airtel scope.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    return clone(override);
  }

  async _transition(
    record,
    transition,
  ) {
    const fn =
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

    if (!fn) {
      if (
        this.config
          .failClosedOnRepositoryError
      ) {
        throw new AirtelComplianceOverrideError(
          'OVERRIDE_TRANSITION_REPOSITORY_UNAVAILABLE',
          'An atomic compliance-override transition adapter is required in production.',
          {
            overrideId:
              record.overrideId,
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
        await fn({
          overrideId:
            record.overrideId,

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
            transition.actor
              ?.actorId,

          patch:
            sanitizeObject(
              record,
            ),
        });

      if (!result) {
        throw new AirtelComplianceOverrideError(
          'OVERRIDE_TRANSITION_REJECTED',
          'The compliance override transition was not committed.',
          {
            overrideId:
              record.overrideId,
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
        AirtelComplianceOverrideError
      ) {
        throw error;
      }

      this._log(
        'error',
        'Compliance override transition failed.',
        {
          overrideId:
            record.overrideId,

          toState:
            transition.toState,

          message:
            error?.message,
        },
      );

      throw new AirtelComplianceOverrideError(
        'OVERRIDE_TRANSITION_FAILED',
        'Compliance override transition failed; no authorization should be inferred.',
        {
          overrideId:
            record.overrideId,
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

  buildAuthorizationEnvelope(
    record,
    input = {},
  ) {
    const verification = {
      approvalId:
        record.overrideId,

      tenantId:
        record.tenantId,

      provider:
        record.provider,

      controlType:
        record.controlType,

      controlCode:
        record.controlCode,

      mode:
        record.mode,

      state:
        record.state,

      scopeFingerprint:
        record.scopeFingerprint,

      approvalFingerprint:
        record.approvalFingerprint,

      originalIdempotencyKey:
        record.originalIdempotencyKey,

      expiresAt:
        record.expiresAt,

      usesConsumed:
        Number(
          record
            .usesConsumed ??
            0,
        ),

      maxUses:
        Number(
          record.maxUses ??
            1,
        ),

      actorId:
        actorIdOf(
          input.actor ??
            input.executor,
        ),

      financialSafety: {
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

        complianceOverrideOnly:
          true,
      },
    };

    return deepFreeze({
      authorized:
        true,

      envelopeFingerprint:
        sha256(
          verification,
        ),

      authorization:
        verification,
    });
  }

  // ---------------------------------------------------------------------------
  // Backwards-compatible aliases for service/controller wiring.
  // ---------------------------------------------------------------------------

  create(
    input = {},
  ) {
    return this.request(
      input,
    );
  }

  requestOverride(
    input = {},
  ) {
    return this.request(
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

  approveOverride(
    input = {},
  ) {
    return this.approve(
      input,
    );
  }

  rejectOverride(
    input = {},
  ) {
    return this.reject(
      input,
    );
  }

  revokeOverride(
    input = {},
  ) {
    return this.revoke(
      input,
    );
  }

  verifyOverride(
    input = {},
  ) {
    return this.verifyForExecution(
      input,
    );
  }

  consumeOverride(
    input = {},
  ) {
    return this.consume(
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

      repositoryConfigured:
        Boolean(
          this.repository,
        ),

      policyConfigured:
        Boolean(
          this.policy,
        ),

      auditConfigured:
        Boolean(
          this.audit,
        ),

      makerCheckerEnabled:
        Boolean(
          this.config
            .requireMakerChecker,
        ),

      breakGlassEnabled:
        Boolean(
          this.config
            .allowBreakGlass,
        ),

      nonOverridableControls:
        Object.values(
          NON_OVERRIDABLE_CONTROL_TYPES,
        ),

      healthy:
        Boolean(
          this.repository,
        ),
    };
  }
}

export const
  defaultComplianceOverrideManager =
    createComplianceOverrideManager({
      repository: null,
    });

export const complianceOverrideManager =
  defaultComplianceOverrideManager;

export const ComplianceOverrideManager =
  AirtelComplianceOverrideManager;

export const buildScopeFingerprint =
  overrideScopeFingerprint;

export default
  AirtelComplianceOverrideManager;