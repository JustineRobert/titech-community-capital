'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Service
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/disbursementService.js
 *
 * Architectural role
 * ------------------
 * Canonical orchestration boundary for Airtel outbound disbursements.
 *
 *   Request
 *      -> tenant / financial identity
 *      -> beneficiary validation
 *      -> policy / fraud controls
 *      -> idempotency reservation
 *      -> durable intent
 *      -> maker-checker governance
 *      -> atomic execution claim
 *      -> Airtel provider adapter
 *      -> Financial Core
 *      -> reconciliation / settlement tracking
 *
 * Non-responsibilities
 * --------------------
 * - No raw Airtel HTTP implementation.
 * - No provider credentials, OTPs or PINs.
 * - No direct wallet/balance/ledger mutation.
 * - No KYC/AML/sanctions source-of-truth implementation.
 * - No blind retry or blind compensation for ambiguous outcomes.
 * - No assumption that provider acceptance equals settlement.
 *
 * Production safety
 * -----------------
 * - Tenant and provider scope is mandatory.
 * - Original idempotency identity remains immutable.
 * - Money uses exact minor-unit strings.
 * - Execution is fingerprint-bound and optimistic-CAS guarded.
 * - Approval scope is revalidated immediately before execution.
 * - Ambiguous provider outcomes require status/reconciliation.
 * - Financial Core remains authoritative for accounting/settlement.
 * - Audit and event payloads are sanitized and bounded.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  PROVIDER,
  OPERATION,
  SCHEMA_VERSION,
  ACTIONS,
  DISBURSEMENT_STATES,
  TERMINAL_DISBURSEMENT_STATES,
  PROVIDER_OUTCOMES,
  PROVIDER_RESULT_CATEGORIES,
  PROVIDER_EXECUTION_STATES,
  RECONCILIATION_STATES,
  RECONCILIATION_OUTCOMES,
  COMPENSATION_TYPES,
  APPROVAL_STATES,
  ERROR_CODES,
  EVENT_TYPES,
  METRIC_NAMES,
  FINANCIAL_SAFETY_BOUNDARY,
  MONEY_POLICY,
  LIMITS,
  TTL_POLICY_MS,
  RETRY_DECISIONS,
  RISK_LEVELS,
  classifyProviderOutcome,
  isUnsafeOfflineState,
  maxRiskLevel,
  normalizeMinorUnitAmount,
  isPositiveMinorUnitAmount,
  canTransitionDisbursement,
} from './constants.js';

export const ENGINE_NAME = 'airtel-disbursement-service';
export const ENGINE_VERSION = '3.0.0';
export const COMPONENT = ENGINE_NAME;

export const SERVICE_OUTCOMES = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  READY: 'READY',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PENDING_PROVIDER: 'PENDING_PROVIDER',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  AMBIGUOUS: 'AMBIGUOUS',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  COMPENSATION_REQUIRED: 'COMPENSATION_REQUIRED',
  ESCALATED: 'ESCALATED',
  CANCELLED: 'CANCELLED',
  REPLAY: 'REPLAY',
  REVIEW: 'REVIEW',
});

const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  enforceAirtelProvider: true,
  requireReference: true,
  requireOriginalIdempotencyKey: true,
  requireAmountMinor: true,
  requireCurrency: true,
  requirePolicyEngine: true,
  requireBeneficiaryValidator: true,
  requireFinancialCore: true,
  requireAtomicRepository: true,
  requireIdempotencyManager: true,
  requireApprovalForFinancialImpact: true,
  requireApprovalWorkflow: true,
  requireFraudGuard: false,
  requireProviderAdapter: true,
  requireTransactionBuilder: true,
  requireReconciliationService: false,
  requireFinancialVerification: true,
  rejectUnresolvedOfflineStates: true,
  autoCreateCompensationCase: true,
  approvalTtlMs: TTL_POLICY_MS.approvalDefault,
  operationTtlMs: 24 * 60 * 60 * 1000,
  maxMetadataDepth: LIMITS.metadataDepth,
  maxMetadataKeys: LIMITS.metadataKeys,
  maxMetadataArrayLength: LIMITS.metadataArrayLength,
  maxMetadataStringLength: LIMITS.metadataStringLength,
  failClosedOnPolicyError: true,
  failClosedOnBeneficiaryError: true,
  failClosedOnFraudError: true,
  failClosedOnFinancialCoreError: true,
  failClosedOnIdempotencyError: true,
  failClosedOnApprovalError: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
});

const SUCCESS = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'SUCCESSFUL',
  'COMPLETED',
  'SETTLED',
  'POSTED',
  'PAID',
]);

const PENDING = new Set([
  'PENDING',
  'PROCESSING',
  'INITIATED',
  'SUBMITTED',
  'QUEUED',
  'ACCEPTED',
]);

const FAILURE = new Set([
  'FAILURE',
  'FAILED',
  'REJECTED',
  'DECLINED',
  'DENIED',
  'CANCELLED',
  'CANCELED',
  'EXPIRED',
]);

const AMBIGUOUS_HTTP = new Set([
  408,
  500,
  502,
  503,
  504,
]);

const TERMINAL = new Set(
  TERMINAL_DISBURSEMENT_STATES,
);

const PRIVATE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const SECRET_RE =
  /(password|secret|token|authorization|cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|raw(request|response)|provider.?payload)/i;

const isObject = (v) =>
  v !== null &&
  typeof v === 'object';

const isPlainObject = (v) =>
  isObject(v) &&
  !Array.isArray(v) &&
  !(v instanceof Date);

const isFn = (v) =>
  typeof v === 'function';

const upper = (v) => {
  if (
    v === undefined ||
    v === null
  ) {
    return undefined;
  }

  const s =
    String(v)
      .trim()
      .toUpperCase();

  return s || undefined;
};

const str = (
  v,
  max = 240,
) => {
  if (
    v === undefined ||
    v === null
  ) {
    return undefined;
  }

  const s =
    String(v).trim();

  return s
    ? s.slice(0, max)
    : undefined;
};

const clone = (v) =>
  v === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(v),
      );

const nowMs = (clock) => {
  try {
    const v =
      clock?.now?.();

    return Number.isFinite(v)
      ? v
      : Date.now();
  } catch {
    return Date.now();
  }
};

const nowIso = (clock) =>
  new Date(
    nowMs(clock),
  ).toISOString();

const actorIdOf = (a) =>
  str(
    a?.actorId ??
      a?.userId ??
      a?.principalId ??
      a?.id,
    LIMITS.actorIdLength,
  );

const stable = (v) => {
  if (v === undefined) {
    return 'undefined';
  }

  if (v === null) {
    return 'null';
  }

  if (v instanceof Date) {
    return `date:${v.toISOString()}`;
  }

  if (typeof v === 'bigint') {
    return `bigint:${v}`;
  }

  if (Array.isArray(v)) {
    return `[${v
      .map(stable)
      .join(',')}]`;
  }

  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(
            k,
          )}:${stable(v[k])}`,
      )
      .join(',')}}`;
  }

  if (
    typeof v === 'number' &&
    Object.is(v, -0)
  ) {
    return '0';
  }

  return JSON.stringify(v);
};

const sha256 = (v) =>
  createHash('sha256')
    .update(
      typeof v === 'string'
        ? v
        : stable(v),
    )
    .digest('hex');

const sanitize = (
  value,
  depth = 0,
  config = DEFAULT_CONFIG,
) => {
  if (
    depth >
    config.maxMetadataDepth
  ) {
    return '[TRUNCATED]';
  }

  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length >
      config.maxMetadataStringLength
      ? `${value.slice(
          0,
          config.maxMetadataStringLength,
        )}…`
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
      .slice(
        0,
        config.maxMetadataArrayLength,
      )
      .map(
        (v) =>
          sanitize(
            v,
            depth + 1,
            config,
          ),
      );
  }

  const out = {};

  for (
    const key of Object.keys(
      value,
    ).slice(
      0,
      config.maxMetadataKeys,
    )
  ) {
    if (
      PRIVATE_KEYS.has(key)
    ) {
      continue;
    }

    out[key] =
      SECRET_RE.test(key)
        ? '[REDACTED]'
        : sanitize(
            value[key],
            depth + 1,
            config,
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
    const child of Object.values(
      value,
    )
  ) {
    deepFreeze(
      child,
      seen,
    );
  }

  return Object.freeze(
    value,
  );
};

const providerOutcomeClass = (
  result,
) => {
  if (!result) {
    return (
      PROVIDER_RESULT_CATEGORIES.UNKNOWN
    );
  }

  return classifyProviderOutcome({
    outcome:
      result.outcome ??
      result.providerOutcome ??
      result.status,

    httpStatus:
      result.httpStatus,
  });
};

export class AirtelDisbursementServiceError
  extends Error
{
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message, options);

    this.name =
      'AirtelDisbursementServiceError';

    this.code = code;

    this.component =
      COMPONENT;

    this.provider =
      PROVIDER;

    this.operation =
      OPERATION;

    this.details =
      sanitize(
        details,
        0,
        options.config ??
          DEFAULT_CONFIG,
      );

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.httpStatus =
      options.httpStatus ?? 400;
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

export const buildDisbursementFingerprint = (
  input = {},
) =>
  sha256({
    schemaVersion:
      SCHEMA_VERSION,

    tenantId:
      str(
        input.tenantId,
        LIMITS.tenantIdLength,
      ),

    provider:
      PROVIDER,

    operation:
      OPERATION,

    disbursementId:
      str(
        input.disbursementId,
        LIMITS.paymentIdLength,
      ),

    reference:
      str(
        input.reference,
        LIMITS.referenceLength,
      ),

    transactionId:
      str(
        input.transactionId,
        LIMITS.transactionIdLength,
      ),

    beneficiaryFingerprint:
      str(
        input.beneficiaryFingerprint,
        128,
      ),

    amountMinor:
      normalizeMinorUnitAmount(
        input.amountMinor,
      ),

    currency:
      upper(
        input.currency,
      ),

    purposeCode:
      str(
        input.purposeCode,
        120,
      ),

    riskLevel:
      upper(
        input.riskLevel,
      ),

    policyVersion:
      str(
        input.policyVersion,
        LIMITS.policyVersionLength,
      ),

    policyFingerprint:
      str(
        input.policyFingerprint,
        128,
      ),
  });

const normalizeRequest = (
  input,
  config,
  idFactory,
) => {
  if (
    !isPlainObject(input)
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.REQUEST_REQUIRED,
      'Airtel disbursement request must be an object.',
    );
  }

  const tenantId =
    str(
      input.tenantId,
      LIMITS.tenantIdLength,
    );

  if (
    config.requireTenantId &&
    !tenantId
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.TENANT_REQUIRED,
      'tenantId is required.',
    );
  }

  const provider =
    upper(
      input.provider ??
        PROVIDER,
    );

  if (
    config.enforceAirtelProvider &&
    provider !== PROVIDER
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
      'Only Airtel is supported by this service.',
      { provider },
      { httpStatus: 409 },
    );
  }

  const reference =
    str(
      input.reference ??
        input.paymentReference ??
        input.externalReference,
      LIMITS.referenceLength,
    );

  if (
    config.requireReference &&
    !reference
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.REFERENCE_REQUIRED,
      'A stable disbursement reference is required.',
    );
  }

  const originalIdempotencyKey =
    str(
      input.originalIdempotencyKey ??
        input.idempotencyKey ??
        input.headers?.[
          'idempotency-key'
        ],
      LIMITS.idempotencyKeyLength,
    );

  if (
    config.requireOriginalIdempotencyKey &&
    !originalIdempotencyKey
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      'The original financial idempotency key is required.',
    );
  }

  const amountMinor =
    normalizeMinorUnitAmount(
      input.amountMinor ??
        input.amountInMinorUnits,
    );

  if (
    config.requireAmountMinor &&
    !amountMinor
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.AMOUNT_REQUIRED,
      'amountMinor is required and must contain only integer minor units.',
    );
  }

  if (
    amountMinor !==
      undefined &&
    !isPositiveMinorUnitAmount(
      amountMinor,
    )
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.AMOUNT_INVALID,
      'Disbursement amount must be greater than zero.',
    );
  }

  const currency =
    upper(
      input.currency ??
        'UGX',
    );

  if (
    config.requireCurrency &&
    !currency
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.CURRENCY_REQUIRED,
      'currency is required.',
    );
  }

  const offlineState =
    upper(
      input.offlineState ??
        input.syncState,
    );

  if (
    config.rejectUnresolvedOfflineStates &&
    isUnsafeOfflineState(
      offlineState,
    )
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.OFFLINE_UNSAFE,
      'Unresolved offline state cannot be executed.',
      {
        offlineState,
      },
      {
        httpStatus: 409,
      },
    );
  }

  const disbursementId =
    str(
      input.disbursementId ??
        input.commandId ??
        input.transactionId,
      LIMITS.paymentIdLength,
    ) ??
    `dsb_${idFactory()}`;

  const transactionId =
    str(
      input.transactionId ??
        input.paymentId,
      LIMITS.transactionIdLength,
    );

  const actor =
    isPlainObject(
      input.actor,
    )
      ? {
          actorId:
            actorIdOf(
              input.actor,
            ),

          role:
            upper(
              input.actor.role ??
                input.actor.actorRole,
            ),

          tenantId:
            str(
              input.actor.tenantId,
              LIMITS.tenantIdLength,
            ),
        }
      : undefined;

  if (
    actor?.tenantId &&
    actor.tenantId !== tenantId
  ) {
    throw new AirtelDisbursementServiceError(
      ERROR_CODES.TENANT_SCOPE_MISMATCH,
      'Actor tenant does not match disbursement tenant.',
      {},
      {
        httpStatus: 403,
      },
    );
  }

  return {
    ...clone(input),

    tenantId,

    provider:
      PROVIDER,

    operation:
      OPERATION,

    reference,

    originalIdempotencyKey,

    amountMinor,

    currency,

    transactionId,

    disbursementId,

    offlineState,

    actor,

    requestId:
      str(
        input.requestId,
        LIMITS.requestIdLength,
      ),

    correlationId:
      str(
        input.correlationId,
        LIMITS.correlationIdLength,
      ),

    traceId:
      str(
        input.traceId,
        LIMITS.traceIdLength,
      ),

    purposeCode:
      str(
        input.purposeCode,
        120,
      ),

    riskLevel:
      upper(
        input.riskLevel,
      ) ??
      RISK_LEVELS.MEDIUM,

    metadata:
      sanitize(
        input.metadata ?? {},
        0,
        config,
      ),
  };
};

export class AirtelDisbursementService {
  constructor(
    options = {},
  ) {
    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,

        ...(options.config ??
          options.configuration ??
          {}),
      });

    this.providerAdapter =
      options.providerAdapter ??
      options.airtelAdapter ??
      options.adapter ??
      null;

    this.beneficiaryValidator =
      options.beneficiaryValidator ??
      null;

    this.beneficiaryResolver =
      options.beneficiaryResolver ??
      options.beneficiaryDirectory ??
      null;

    this.approvalWorkflow =
      options.approvalWorkflow ??
      null;

    this.policyEngine =
      options.policyEngine ??
      options.policy ??
      null;

    this.fraudGuard =
      options.fraudGuard ??
      options.fraudService ??
      null;

    this.idempotencyManager =
      options.idempotencyManager ??
      options.idempotency ??
      null;

    this.repository =
      options.repository ??
      options.disbursementRepository ??
      options.store ??
      null;

    this.transactionBuilder =
      options.transactionBuilder ??
      null;

    this.financialCore =
      options.financialCore ??
      options.financialTransactionService ??
      options.transactionService ??
      null;

    this.ledgerBridge =
      options.ledgerBridge ??
      null;

    this.reconciliationService =
      options.reconciliationService ??
      options.reconciliation ??
      null;

    this.settlementTracker =
      options.settlementTracker ??
      null;

    this.compensationManager =
      options.compensationManager ??
      null;

    this.stateMachine =
      options.stateMachine ??
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

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelDisbursementServiceError(
      code,
      message,
      details,
      {
        ...options,
        config: this.config,
      },
    );
  }

  #repo(...names) {
    for (
      const name of names
    ) {
      if (
        isFn(
          this.repository?.[
            name
          ],
        )
      ) {
        return this.repository[
          name
        ].bind(
          this.repository,
        );
      }
    }

    return null;
  }

  #idem(...names) {
    for (
      const name of names
    ) {
      if (
        isFn(
          this.idempotencyManager?.[
            name
          ],
        )
      ) {
        return this.idempotencyManager[
          name
        ].bind(
          this.idempotencyManager,
        );
      }
    }

    return null;
  }

  #limits() {
    return {
      maxDepth:
        this.config
          .maxMetadataDepth,

      maxKeys:
        this.config
          .maxMetadataKeys,

      maxArrayLength:
        this.config
          .maxMetadataArrayLength,

      maxStringLength:
        this.config
          .maxMetadataStringLength,
    };
  }

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const fn =
        this.logger?.[level] ??
        this.logger?.log ??
        this.logger?.info;

      fn?.call?.(
        this.logger,

        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          ...sanitize(
            context,
            0,
            this.config,
          ),
        },

        message,
      );
    } catch {
      // Observability must not affect financial state.
    }
  }

  #metric(
    name,
    labels = {},
  ) {
    try {
      const fn =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      fn?.call?.(
        this.metrics,

        name,

        sanitize(
          labels,
          0,
          this.config,
        ),
      );
    } catch {
      // Metrics are non-authoritative.
    }
  }

  async #audit(
    action,
    record,
    extra = {},
  ) {
    const fn =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write;

    if (
      !isFn(fn)
    ) {
      return null;
    }

    const payload = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      action,

      tenantId:
        record?.tenantId,

      disbursementId:
        record?.disbursementId,

      state:
        record?.state,

      outcome:
        record?.outcome,

      reference:
        record?.reference,

      transactionId:
        record?.transactionId,

      amountMinor:
        record?.amountMinor,

      currency:
        record?.currency,

      riskLevel:
        record?.riskLevel,

      originalIdempotencyKeyHash:
        record?.originalIdempotencyKey
          ? sha256(
              record.originalIdempotencyKey,
            )
          : undefined,

      fingerprint:
        record?.disbursementFingerprint,

      actorId:
        actorIdOf(
          extra.actor ??
            extra.executor ??
            record?.actor,
        ),

      extra:
        sanitize(
          extra,
          0,
          this.config,
        ),

      occurredAt:
        nowIso(
          this.clock,
        ),
    };

    try {
      return await fn.call(
        this.auditService,
        {
          ...payload,

          auditFingerprint:
            sha256(
              payload,
            ),
        },
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel disbursement audit write failed.',
        {
          action,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        this.#throw(
          ERROR_CODES.AUDIT_UNAVAILABLE,
          'Disbursement audit boundary is unavailable.',
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

  async #event(
    type,
    record,
    extra = {},
  ) {
    const fn =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (
      !isFn(fn)
    ) {
      return null;
    }

    const event = {
      eventId:
        this.idFactory(),

      type:
        EVENT_TYPES[type] ??
        type,

      occurredAt:
        nowIso(
          this.clock,
        ),

      tenantId:
        record?.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      disbursementId:
        record?.disbursementId,

      state:
        record?.state,

      outcome:
        record?.outcome,

      reference:
        record?.reference,

      transactionId:
        record?.transactionId,

      fingerprint:
        record?.disbursementFingerprint,

      payload:
        sanitize(
          extra,
          0,
          this.config,
        ),
    };

    try {
      return await fn.call(
        this.eventBus,
        event,
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel disbursement event publication failed.',
        {
          type,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this.#throw(
          ERROR_CODES.EVENT_PUBLICATION_FAILED,
          'Disbursement event publication failed.',
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

  #blocks(
    result,
  ) {
    return [
      'BLOCK',
      'DENY',
      'REJECT',
      'REJECTED',
      'FAILED',
    ].includes(
      upper(
        result?.decision ??
          result?.outcome,
      ),
    );
  }

  #requiresReview(
    result,
  ) {
    return [
      'REVIEW',
      'REQUIRE_REVIEW',
      'PENDING',
      'INDETERMINATE',
      'NO_POLICY',
    ].includes(
      upper(
        result?.decision ??
          result?.outcome,
      ),
    );
  }

  async #policy(
    request,
    validation,
    action,
    existingRecord,
  ) {
    if (
      !this.policyEngine
    ) {
      if (
        this.config
          .requirePolicyEngine
      ) {
        this.#throw(
          'POLICY_ENGINE_UNAVAILABLE',
          'A disbursement policy engine is required.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          'REQUIRE_REVIEW',

        approvalRequired:
          true,

        riskLevel:
          request.riskLevel,
      };
    }

    const fn =
      this.policyEngine
        .evaluateDisbursement ??
      this.policyEngine
        .evaluate ??
      this.policyEngine
        .assess;

    if (
      !isFn(fn)
    ) {
      this.#throw(
        'POLICY_ENGINE_CONTRACT_INVALID',
        'Configured disbursement policy engine is invalid.',
        {},
        {
          httpStatus: 503,
        },
      );
    }

    try {
      return sanitize(
        (
          await fn.call(
            this.policyEngine,
            {
              action,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              tenantId:
                request.tenantId,

              disbursementId:
                request.disbursementId,

              reference:
                request.reference,

              transactionId:
                request.transactionId,

              amountMinor:
                request.amountMinor,

              currency:
                request.currency,

              purposeCode:
                request.purposeCode,

              riskLevel:
                request.riskLevel,

              actor:
                request.actor,

              beneficiaryValidation:
                validation,

              existingRecord,

              metadata:
                request.metadata,
            },
          )
        ) ?? {},
        0,
        this.config,
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel disbursement policy evaluation failed.',
        {
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnPolicyError
      ) {
        this.#throw(
          'POLICY_ENGINE_UNAVAILABLE',
          'Disbursement policy evaluation failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          'REQUIRE_REVIEW',

        approvalRequired:
          true,

        riskLevel:
          RISK_LEVELS.HIGH,
      };
    }
  }

  async #fraud(
    request,
    validation,
  ) {
    if (
      !this.fraudGuard
    ) {
      if (
        this.config
          .requireFraudGuard
      ) {
        this.#throw(
          'FRAUD_GUARD_UNAVAILABLE',
          'Fraud guard is required.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          'ALLOW',

        riskLevel:
          request.riskLevel,
      };
    }

    const fn =
      this.fraudGuard
        .evaluateDisbursement ??
      this.fraudGuard
        .evaluate ??
      this.fraudGuard
        .check ??
      this.fraudGuard
        .assess;

    if (
      !isFn(fn)
    ) {
      this.#throw(
        'FRAUD_GUARD_CONTRACT_INVALID',
        'Configured fraud guard is invalid.',
        {},
        {
          httpStatus: 503,
        },
      );
    }

    try {
      return sanitize(
        (
          await fn.call(
            this.fraudGuard,
            {
              tenantId:
                request.tenantId,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              disbursementId:
                request.disbursementId,

              reference:
                request.reference,

              transactionId:
                request.transactionId,

              amountMinor:
                request.amountMinor,

              currency:
                request.currency,

              beneficiaryValidation:
                validation,

              metadata:
                request.metadata,
            },
          )
        ) ?? {},
        0,
        this.config,
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel disbursement fraud evaluation failed.',
        {
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnFraudError
      ) {
        this.#throw(
          'FRAUD_GUARD_UNAVAILABLE',
          'Fraud evaluation failed; disbursement is blocked.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        decision:
          'REQUIRE_REVIEW',

        riskLevel:
          RISK_LEVELS.HIGH,
      };
    }
  }

  async #beneficiary(
    request,
  ) {
    if (
      !request.beneficiary
    ) {
      this.#throw(
        ERROR_CODES.BENEFICIARY_REQUIRED,
        'Beneficiary is required.',
      );
    }

    if (
      !this.beneficiaryValidator
    ) {
      if (
        this.config
          .requireBeneficiaryValidator
      ) {
        this.#throw(
          'BENEFICIARY_VALIDATOR_UNAVAILABLE',
          'Beneficiary validator is required.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        valid:
          true,

        outcome:
          'PASS',

        fingerprint:
          sha256(
            request.beneficiary,
          ),
      };
    }

    const fn =
      this.beneficiaryValidator
        .assess ??
      this.beneficiaryValidator
        .validateDetailed ??
      this.beneficiaryValidator
        .validate;

    if (
      !isFn(fn)
    ) {
      this.#throw(
        'BENEFICIARY_VALIDATOR_CONTRACT_INVALID',
        'Beneficiary validator contract is invalid.',
        {},
        {
          httpStatus: 503,
        },
      );
    }

    try {
      return sanitize(
        (
          await fn.call(
            this.beneficiaryValidator,
            {
              tenantId:
                request.tenantId,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              beneficiary:
                request.beneficiary,

              amountMinor:
                request.amountMinor,

              currency:
                request.currency,

              reference:
                request.reference,

              originalIdempotencyKey:
                request.originalIdempotencyKey,

              offlineState:
                request.offlineState,

              riskLevel:
                request.riskLevel,

              requestId:
                request.requestId,

              correlationId:
                request.correlationId,

              traceId:
                request.traceId,

              metadata:
                request.metadata,
            },
          )
        ) ?? {},
        0,
        this.config,
      );
    } catch (error) {
      if (
        error instanceof
        AirtelDisbursementServiceError
      ) {
        throw error;
      }

      if (
        this.config
          .failClosedOnBeneficiaryError
      ) {
        this.#throw(
          ERROR_CODES.BENEFICIARY_INVALID,
          'Beneficiary validation failed.',
          {},
          {
            httpStatus:
              error?.httpStatus ??
              409,
          },
        );
      }

      return {
        valid:
          false,

        outcome:
          'REVIEW',
      };
    }
  }

  #identity(
    validation,
  ) {
    return {
      beneficiaryId:
        str(
          validation?.beneficiaryId ??
            validation?.beneficiary
              ?.beneficiaryId ??
            validation?.normalizedBeneficiary
              ?.partyId,
          LIMITS.beneficiaryIdLength,
        ),

      beneficiaryIdType:
        upper(
          validation?.beneficiaryIdType ??
            validation?.beneficiary
              ?.partyIdType ??
            validation?.normalizedBeneficiary
              ?.partyIdType,
        ),

      beneficiaryFingerprint:
        str(
          validation?.fingerprint ??
            validation?.beneficiaryFingerprint ??
            validation
              ?.normalizedBeneficiary
              ?.beneficiaryHash,
          128,
        ),
    };
  }

  #buildRecord(
    request,
    validation,
    policy,
    fraud,
  ) {
    const identity =
      this.#identity(
        validation,
      );

    const riskLevel =
      maxRiskLevel(
        request.riskLevel,
        validation?.riskLevel,
        policy?.riskLevel,
        fraud?.riskLevel,
      );

    const requiresApproval =
      Boolean(
        this.config
          .requireApprovalForFinancialImpact ||

        policy?.approvalRequired ===
          true ||

        policy?.requiredApproval ===
          true ||

        fraud?.approvalRequired ===
          true ||

        this.#requiresReview(
          policy,
        ) ||

        this.#requiresReview(
          fraud,
        ),
      );

    return {
      schemaVersion:
        SCHEMA_VERSION,

      engineName:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      disbursementId:
        request.disbursementId,

      tenantId:
        request.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      state:
        requiresApproval
          ? DISBURSEMENT_STATES.PENDING_APPROVAL
          : DISBURSEMENT_STATES.APPROVED,

      outcome:
        requiresApproval
          ? SERVICE_OUTCOMES.PENDING_APPROVAL
          : SERVICE_OUTCOMES.READY,

      reference:
        request.reference,

      transactionId:
        request.transactionId,

      amountMinor:
        request.amountMinor,

      currency:
        request.currency,

      purposeCode:
        request.purposeCode,

      beneficiaryId:
        identity.beneficiaryId,

      beneficiaryIdType:
        identity.beneficiaryIdType,

      beneficiaryFingerprint:
        identity.beneficiaryFingerprint,

      beneficiaryIdentity:
        identity,

      originalIdempotencyKey:
        request.originalIdempotencyKey,

      disbursementFingerprint:
        buildDisbursementFingerprint({
          ...request,

          beneficiaryFingerprint:
            identity.beneficiaryFingerprint,

          riskLevel,

          policyVersion:
            policy?.policyVersion,

          policyFingerprint:
            policy?.fingerprint ??
            policy?.policyFingerprint,
        }),

      policyVersion:
        str(
          policy?.policyVersion,
          LIMITS.policyVersionLength,
        ),

      policyFingerprint:
        str(
          policy?.fingerprint ??
            policy?.policyFingerprint,
          128,
        ),

      policyDecision:
        upper(
          policy?.decision ??
            policy?.outcome,
        ),

      riskLevel,

      approvalRequired:
        requiresApproval,

      requiresApproval,

      approvalId:
        undefined,

      approvalScopeFingerprint:
        undefined,

      approvalState:
        undefined,

      providerReference:
        undefined,

      providerTransactionId:
        undefined,

      providerStatus:
        undefined,

      providerResultCategory:
        undefined,

      providerExecutionState:
        PROVIDER_EXECUTION_STATES.NOT_STARTED,

      financialExecutionState:
        'NOT_STARTED',

      reconciliationState:
        RECONCILIATION_STATES.NOT_RUN,

      attempts:
        0,

      version:
        1,

      createdAt:
        nowIso(
          this.clock,
        ),

      updatedAt:
        nowIso(
          this.clock,
        ),

      expiresAt:
        new Date(
          nowMs(
            this.clock,
          ) +
            this.config
              .operationTtlMs,
        ).toISOString(),

      validation: {
        outcome:
          upper(
            validation?.outcome,
          ),

        code:
          str(
            validation?.code,
            160,
          ),

        fingerprint:
          identity.beneficiaryFingerprint,
      },

      governance: {
        policyDecision:
          upper(
            policy?.decision ??
              policy?.outcome,
          ),

        fraudDecision:
          upper(
            fraud?.decision ??
              fraud?.outcome,
          ),

        requiresApproval,
      },

      metadata:
        request.metadata,
    };
  }

  #assertScope(
    existing,
    request,
    fingerprint,
  ) {
    if (!existing) {
      return;
    }

    if (
      existing.tenantId !==
      request.tenantId
    ) {
      this.#throw(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        'Existing disbursement belongs to another tenant.',
        {},
        {
          httpStatus: 404,
        },
      );
    }

    if (
      upper(
        existing.provider,
      ) !==
        PROVIDER ||
      upper(
        existing.operation,
      ) !==
        OPERATION
    ) {
      this.#throw(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'Existing disbursement is outside Airtel scope.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    if (
      existing.originalIdempotencyKey &&
      request.originalIdempotencyKey &&
      existing.originalIdempotencyKey !==
        request.originalIdempotencyKey
    ) {
      this.#throw(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'Existing disbursement uses a different financial identity.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    if (
      fingerprint &&
      existing.disbursementFingerprint &&
      fingerprint !==
        existing.disbursementFingerprint
    ) {
      this.#throw(
        ERROR_CODES.STALE_SCOPE,
        'Existing disbursement does not match the requested financial scope.',
        {},
        {
          httpStatus: 409,
        },
      );
    }
  }

  async #findExisting(
    request,
  ) {
    const byKey =
      this.#repo(
        'findByOriginalIdempotencyKey',
        'findByIdempotencyKey',
        'getByIdempotencyKey',
      );

    if (
      byKey &&
      request.originalIdempotencyKey
    ) {
      const found =
        await byKey({
          tenantId:
            request.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          originalIdempotencyKey:
            request.originalIdempotencyKey,
        });

      if (found) {
        this.#assertScope(
          found,
          request,
        );

        return clone(
          found,
        );
      }
    }

    const byReference =
      this.#repo(
        'findByReference',
        'getByReference',
      );

    if (
      byReference &&
      request.reference
    ) {
      const found =
        await byReference({
          tenantId:
            request.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          reference:
            request.reference,
        });

      if (found) {
        this.#assertScope(
          found,
          request,
        );

        return clone(
          found,
        );
      }
    }

    return null;
  }

  async #getRecord(
    disbursementId,
    tenantId,
  ) {
    const id =
      str(
        disbursementId,
        LIMITS.paymentIdLength,
      );

    const tid =
      str(
        tenantId,
        LIMITS.tenantIdLength,
      );

    if (!tid) {
      this.#throw(
        ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required.',
      );
    }

    if (!id) {
      this.#throw(
        ERROR_CODES.REQUEST_REQUIRED,
        'disbursementId is required.',
      );
    }

    const fn =
      this.#repo(
        'findById',
        'getById',
        'getDisbursement',
        'findDisbursementById',
      );

    if (!fn) {
      this.#throw(
        'DISBURSEMENT_REPOSITORY_UNAVAILABLE',
        'Disbursement repository lookup is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const found =
      await fn(
        id,
        {
          tenantId: tid,
        },
      );

    if (!found) {
      this.#throw(
        'DISBURSEMENT_NOT_FOUND',
        'Airtel disbursement was not found within the tenant scope.',
        {
          disbursementId:
            id,
        },
        {
          httpStatus: 404,
        },
      );
    }

    this.#assertScope(
      found,
      {
        tenantId: tid,
        provider:
          PROVIDER,
        operation:
          OPERATION,
      },
    );

    return clone(
      found,
    );
  }

  async #createRecord(
    record,
  ) {
    const fn =
      this.#repo(
        'createDisbursement',
        'create',
        'insert',
      );

    if (!fn) {
      this.#throw(
        'DISBURSEMENT_REPOSITORY_UNAVAILABLE',
        'A durable disbursement repository is required.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    try {
      const saved =
        await fn(
          sanitize(
            record,
            0,
            this.config,
          ),
          {
            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,
          },
        );

      if (!saved) {
        this.#throw(
          'DISBURSEMENT_PERSIST_FAILED',
          'Disbursement record was not persisted.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return clone(
        saved,
      );
    } catch (error) {
      if (
        error instanceof
        AirtelDisbursementServiceError
      ) {
        throw error;
      }

      this.#throw(
        'DISBURSEMENT_PERSIST_FAILED',
        'Airtel disbursement persistence failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }
  }

  async #patch(
    record,
    patch,
  ) {
    const fn =
      this.#repo(
        'patchDisbursement',
        'updateDisbursement',
        'patch',
        'update',
      );

    if (!fn) {
      return null;
    }

    return clone(
      await fn({
        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        expectedVersion:
          Number(
            record.version ??
              1,
          ),

        expectedFingerprint:
          record.disbursementFingerprint,

        patch:
          sanitize(
            patch,
            0,
            this.config,
          ),
      }),
    );
  }

  async #transition(
    record,
    toState,
    options = {},
  ) {
    const fromState =
      upper(
        record.state,
      );

    const target =
      upper(
        toState,
      );

    if (
      fromState ===
      target
    ) {
      return clone(
        record,
      );
    }

    if (
      !canTransitionDisbursement(
        fromState,
        target,
      )
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        `Cannot transition disbursement from ${fromState} to ${target}.`,
        {
          disbursementId:
            record.disbursementId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const fn =
      this.#repo(
        'transitionDisbursement',
        'atomicTransition',
        'compareAndSetTransition',
        'transition',
        'updateState',
      );

    if (!fn) {
      this.#throw(
        ERROR_CODES.STALE_VERSION,
        'Atomic disbursement state transition is required.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const saved =
      await fn({
        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        fromState,

        toState:
          target,

        action:
          options.action ??
          target,

        actorId:
          actorIdOf(
            options.actor ??
              record.actor,
          ),

        expectedVersion:
          Number(
            record.version ??
              1,
          ),

        expectedFingerprint:
          record.disbursementFingerprint,

        expectedIdempotencyKey:
          record.originalIdempotencyKey,

        patch:
          sanitize(
            {
              ...(options.patch ??
                {}),

              state:
                target,

              outcome:
                options.patch
                  ?.outcome ??
                record.outcome,

              updatedAt:
                nowIso(
                  this.clock,
                ),

              version:
                Number(
                  record.version ??
                    1,
                ) + 1,
            },
            0,
            this.config,
          ),
      });

    if (!saved) {
      this.#throw(
        ERROR_CODES.STALE_VERSION,
        'Disbursement transition lost an optimistic-concurrency race.',
        {
          disbursementId:
            record.disbursementId,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return clone(
      saved,
    );
  }

  async #reserveIdempotency(
    request,
    record,
  ) {
    const fn =
      this.#idem(
        'reserve',
        'claim',
        'acquire',
        'reserveKey',
      );

    if (!fn) {
      if (
        this.config
          .requireIdempotencyManager
      ) {
        this.#throw(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Idempotency reservation is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        reserved:
          true,
      };
    }

    const result =
      await fn({
        tenantId:
          request.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        key:
          request.originalIdempotencyKey,

        originalIdempotencyKey:
          request.originalIdempotencyKey,

        requestFingerprint:
          record.disbursementFingerprint,

        resourceId:
          record.disbursementId,
      });

    if (
      result?.conflict
    ) {
      this.#throw(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'Idempotency key is bound to a different financial intent.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    if (
      result?.existing ||
      result?.duplicate ||
      result?.idempotent
    ) {
      return {
        reserved:
          false,

        record:
          result.record ??
          null,
      };
    }

    return {
      reserved:
        result?.reserved !==
        false,
    };
  }

  async #commitIdempotency(
    request,
    record,
  ) {
    const fn =
      this.#idem(
        'commit',
        'finalize',
        'complete',
        'markCommitted',
      );

    if (!fn) {
      return null;
    }

    return fn({
      tenantId:
        request.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      key:
        request.originalIdempotencyKey,

      originalIdempotencyKey:
        request.originalIdempotencyKey,

      resourceId:
        record.disbursementId,

      resourceType:
        'AIRTEL_DISBURSEMENT',

      requestFingerprint:
        record.disbursementFingerprint,
    });
  }

  async #releaseIdempotency(
    request,
  ) {
    const fn =
      this.#idem(
        'release',
        'rollback',
        'unlock',
      );

    if (!fn) {
      return null;
    }

    try {
      return await fn({
        tenantId:
          request.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        key:
          request.originalIdempotencyKey,

        originalIdempotencyKey:
          request.originalIdempotencyKey,
      });
    } catch (error) {
      this.#log(
        'error',
        'Idempotency release failed.',
        {
          message:
            error?.message,
        },
      );

      return null;
    }
  }

  async #createApproval(
    record,
    request,
  ) {
    if (
      !record.requiresApproval
    ) {
      return null;
    }

    if (
      !this.approvalWorkflow
    ) {
      if (
        this.config
          .requireApprovalWorkflow
      ) {
        this.#throw(
          ERROR_CODES.APPROVAL_REQUIRED,
          'Maker-checker approval is required but the approval workflow is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        approved:
          false,

        state:
          APPROVAL_STATES.PENDING,
      };
    }

    const authorize =
      this.approvalWorkflow
        .authorize ??
      this.approvalWorkflow
        .requestApproval ??
      this.approvalWorkflow
        .create;

    if (
      !isFn(
        authorize,
      )
    ) {
      this.#throw(
        ERROR_CODES.APPROVAL_INVALID,
        'Approval workflow contract is invalid.',
        {},
        {
          httpStatus: 503,
        },
      );
    }

    const maker =
      request.actor ??
      {
        actorId:
          'system:disbursement-service',

        role:
          'SYSTEM',

        tenantId:
          request.tenantId,
      };

    const approval =
      await authorize.call(
        this.approvalWorkflow,
        {
          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          approvalId:
            record.approvalId,

          commandId:
            record.disbursementId,

          reference:
            record.reference,

          transactionId:
            record.transactionId,

          paymentId:
            record.disbursementId,

          amountMinor:
            record.amountMinor,

          currency:
            record.currency,

          beneficiaryId:
            record.beneficiaryId,

          originalIdempotencyKey:
            record.originalIdempotencyKey,

          riskLevel:
            record.riskLevel,

          policyVersion:
            record.policyVersion,

          maker,

          ttlMs:
            this.config
              .approvalTtlMs,

          metadata:
            request.metadata,
        },
      );

    if (!approval) {
      this.#throw(
        ERROR_CODES.APPROVAL_INVALID,
        'Approval workflow returned no approval record.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    let submitted =
      approval;

    const submit =
      this.approvalWorkflow
        .submit ??
      this.approvalWorkflow
        .submitForApproval;

    if (
      isFn(submit) &&
      upper(
        approval.state,
      ) ===
        APPROVAL_STATES.DRAFT
    ) {
      submitted =
        (await submit.call(
          this.approvalWorkflow,
          {
            approvalId:
              approval.approvalId ??
              record.approvalId,

            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            reference:
              record.reference,

            transactionId:
              record.transactionId,

            originalIdempotencyKey:
              record.originalIdempotencyKey,

            actor:
              maker,

            maker,

            reason:
              'Airtel disbursement requires maker-checker authorization.',
          },
        )) ??
        approval;
    }

    const approvalId =
      str(
        submitted.approvalId ??
          approval.approvalId ??
          record.approvalId,
        LIMITS.paymentIdLength,
      );

    const approvalScopeFingerprint =
      str(
        submitted.scopeFingerprint ??
          approval.scopeFingerprint,
        128,
      );

    const updated =
      await this.#patch(
        record,
        {
          approvalId,

          approvalState:
            upper(
              submitted.state ??
                approval.state,
            ) ??
            APPROVAL_STATES.PENDING,

          approvalScopeFingerprint,

          approval:
            sanitize(
              submitted,
              0,
              this.config,
            ),
        },
      );

    await this.#audit(
      'DISBURSEMENT_APPROVAL_REQUESTED',
      updated ??
        record,
      {
        approvalId,
        approvalScopeFingerprint,
      },
    );

    return {
      ...sanitize(
        submitted,
        0,
        this.config,
      ),

      approvalId,

      scopeFingerprint:
        approvalScopeFingerprint,

      approved:
        submitted.approved ===
          true ||
        submitted.executable ===
          true ||
        upper(
          submitted.state,
        ) ===
          APPROVAL_STATES.APPROVED,
    };
  }

  async #verifyApproval(
    record,
    request,
  ) {
    if (
      !record.requiresApproval
    ) {
      return {
        approved:
          true,
      };
    }

    const fn =
      this.approvalWorkflow
        ?.verifyForExecution ??
      this.approvalWorkflow
        ?.verifyApproval;

    if (
      !isFn(fn)
    ) {
      this.#throw(
        ERROR_CODES.APPROVAL_INVALID,
        'Approval execution verification is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const result =
      await fn.call(
        this.approvalWorkflow,
        {
          approvalId:
            record.approvalId,

          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          amountMinor:
            record.amountMinor,

          currency:
            record.currency,

          reference:
            record.reference,

          transactionId:
            record.transactionId,

          originalIdempotencyKey:
            record.originalIdempotencyKey,

          scopeFingerprint:
            record.approvalScopeFingerprint ??
            record.disbursementFingerprint,

          beneficiaryId:
            record.beneficiaryId,

          beneficiaryFingerprint:
            record.beneficiaryFingerprint,

          actor:
            request.executor ??
            request.actor,

          approval:
            record.approval,
        },
      );

    const approved =
      result?.approved ===
        true ||
      result?.authorized ===
        true ||
      result?.executable ===
        true ||
      upper(
        result?.state,
      ) ===
        APPROVAL_STATES.APPROVED ||
      upper(
        result?.outcome,
      ) ===
        'APPROVED';

    const returnedScope =
      str(
        result?.scopeFingerprint ??
          result?.approval
            ?.scopeFingerprint,
        128,
      );

    if (
      approved &&
      record.approvalScopeFingerprint &&
      returnedScope &&
      returnedScope !==
        record.approvalScopeFingerprint
    ) {
      this.#throw(
        ERROR_CODES.APPROVAL_SCOPE_MISMATCH,
        'Approval scope does not match the persisted authorization.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    return {
      approved,

      code:
        approved
          ? 'APPROVAL_VERIFIED'
          : ERROR_CODES.APPROVAL_REQUIRED,

      reason:
        result?.reason,
    };
  }

  async #claim(
    record,
    actor,
  ) {
    const fn =
      this.#repo(
        'claimForExecution',
        'claimDisbursement',
        'atomicClaim',
        'claim',
      );

    if (!fn) {
      this.#throw(
        ERROR_CODES.STALE_VERSION,
        'Atomic execution claim is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const result =
      await fn({
        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        expectedState:
          record.state,

        expectedVersion:
          Number(
            record.version ??
              1,
          ),

        expectedFingerprint:
          record.disbursementFingerprint,

        expectedIdempotencyKey:
          record.originalIdempotencyKey,

        claimant:
          actorIdOf(
            actor,
          ) ??
          'system:airtel-disbursement',

        patch: {
          state:
            DISBURSEMENT_STATES.EXECUTING,

          outcome:
            'EXECUTING',

          executionClaimedAt:
            nowIso(
              this.clock,
            ),

          executionClaimedBy:
            actorIdOf(
              actor,
            ) ??
            'system:airtel-disbursement',

          attempts:
            Number(
              record.attempts ??
                0,
            ) + 1,

          updatedAt:
            nowIso(
              this.clock,
            ),

          version:
            Number(
              record.version ??
                1,
            ) + 1,
        },
      });

    if (!result) {
      return {
        claimed:
          false,

        code:
          'EXECUTION_ALREADY_CLAIMED',
      };
    }

    return {
      claimed:
        true,

      record:
        clone(result),
    };
  }

  async #buildProviderRequest(
    record,
    request,
  ) {
    const fn =
      this.transactionBuilder
        ?.buildDisbursement ??
      this.transactionBuilder
        ?.build ??
      this.transactionBuilder
        ?.createRequest;

    if (
      !isFn(fn)
    ) {
      this.#throw(
        ERROR_CODES.INTERNAL_ERROR,
        'Airtel transaction builder is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const built =
      await fn.call(
        this.transactionBuilder,
        {
          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          disbursementId:
            record.disbursementId,

          reference:
            record.reference,

          transactionId:
            record.transactionId,

          originalIdempotencyKey:
            record.originalIdempotencyKey,

          beneficiary:
            request.beneficiary,

          beneficiaryIdentity:
            record.beneficiaryIdentity,

          amountMinor:
            record.amountMinor,

          currency:
            record.currency,

          purposeCode:
            record.purposeCode,

          requestId:
            request.requestId,

          correlationId:
            request.correlationId,

          traceId:
            request.traceId,

          metadata:
            request.metadata,
        },
      );

    if (!built) {
      this.#throw(
        ERROR_CODES.INTERNAL_ERROR,
        'Transaction builder returned no provider request.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    return built;
  }

  async #providerCall(
    request,
    record,
    context,
  ) {
    const fn =
      this.providerAdapter
        ?.disburse ??
      this.providerAdapter
        ?.sendMoney ??
      this.providerAdapter
        ?.executeDisbursement ??
      this.providerAdapter
        ?.execute;

    if (
      !isFn(fn)
    ) {
      this.#throw(
        ERROR_CODES.PROVIDER_UNAVAILABLE,
        'Airtel provider adapter is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    try {
      return await fn.call(
        this.providerAdapter,
        request,
        {
          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          disbursementId:
            record.disbursementId,

          originalIdempotencyKey:
            record.originalIdempotencyKey,

          requestId:
            context.requestId,

          correlationId:
            context.correlationId,

          traceId:
            context.traceId,
        },
      );
    } catch (error) {
      const code =
        upper(
          error?.code,
        );

      const ambiguous =
        error?.name ===
          'TimeoutError' ||
        [
          'ETIMEDOUT',
          'ESOCKETTIMEDOUT',
          'UND_ERR_HEADERS_TIMEOUT',
          'UND_ERR_BODY_TIMEOUT',
          'NETWORK_ERROR',
          'PROVIDER_TIMEOUT',
          'UNKNOWN_OUTCOME',
          'NO_RESPONSE',
        ].includes(
          code,
        ) ||
        AMBIGUOUS_HTTP.has(
          Number(
            error?.status,
          ),
        );

      if (
        ambiguous
      ) {
        return {
          outcome:
            PROVIDER_OUTCOMES.AMBIGUOUS,

          code:
            ERROR_CODES.PROVIDER_AMBIGUOUS,

          reason:
            'Airtel outcome could not be established safely.',

          httpStatus:
            error?.status,
        };
      }

      return {
        outcome:
          PROVIDER_OUTCOMES.FAILURE,

        code:
          error?.code ??
          ERROR_CODES.PROVIDER_REJECTED,

        reason:
          str(
            error?.message,
            500,
          ),

        retryable:
          Boolean(
            error?.retryable,
          ),

        httpStatus:
          error?.status,
      };
    }
  }

  #normalizeProviderResult(
    result,
  ) {
    const raw =
      isPlainObject(result)
        ? result
        : {};

    const rawOutcome =
      upper(
        raw.outcome ??
          raw.providerOutcome ??
          raw.status ??
          raw.result,
      );

    let outcome =
      rawOutcome;

    if (
      SUCCESS.has(
        rawOutcome,
      )
    ) {
      outcome =
        PROVIDER_OUTCOMES.SUCCESS;
    } else if (
      FAILURE.has(
        rawOutcome,
      )
    ) {
      outcome =
        PROVIDER_OUTCOMES.FAILURE;
    } else if (
      PENDING.has(
        rawOutcome,
      )
    ) {
      outcome =
        PROVIDER_OUTCOMES.PENDING;
    } else if (
      [
        'AMBIGUOUS',
        'UNKNOWN',
        'TIMEOUT',
        'NO_RESPONSE',
      ].includes(
        rawOutcome,
      ) ||
      AMBIGUOUS_HTTP.has(
        Number(
          raw.httpStatus,
        ),
      )
    ) {
      outcome =
        PROVIDER_OUTCOMES.AMBIGUOUS;
    } else if (
      !outcome
    ) {
      outcome =
        PROVIDER_OUTCOMES.UNKNOWN;
    }

    return {
      outcome,

      category:
        providerOutcomeClass({
          outcome,
          httpStatus:
            raw.httpStatus,
        }),

      executionState:
        outcome ===
          PROVIDER_OUTCOMES.SUCCESS
          ? PROVIDER_EXECUTION_STATES.SUCCESS
          : outcome ===
              PROVIDER_OUTCOMES.FAILURE
            ? PROVIDER_EXECUTION_STATES.FAILURE
            : outcome ===
                PROVIDER_OUTCOMES.PENDING
              ? PROVIDER_EXECUTION_STATES.PENDING
              : PROVIDER_EXECUTION_STATES.AMBIGUOUS,

      providerTransactionId:
        str(
          raw.providerTransactionId ??
            raw.transactionId ??
            raw.providerId,
          LIMITS.transactionIdLength,
        ),

      providerReference:
        str(
          raw.providerReference ??
            raw.reference ??
            raw.externalReference,
          LIMITS.referenceLength,
        ),

      status:
        str(
          raw.status,
          120,
        ),

      code:
        str(
          raw.code,
          LIMITS.errorCodeLength,
        ),

      reason:
        str(
          raw.reason ??
            raw.message,
          LIMITS.metadataStringLength,
        ),

      retryable:
        Boolean(
          raw.retryable,
        ),

      httpStatus:
        Number.isInteger(
          Number(
            raw.httpStatus,
          ),
        )
          ? Number(
              raw.httpStatus,
            )
          : undefined,

      evidence:
        sanitize(
          {
            status:
              raw.status,

            outcome:
              raw.outcome,

            code:
              raw.code,

            providerTransactionId:
              raw.providerTransactionId,

            providerReference:
              raw.providerReference,

            httpStatus:
              raw.httpStatus,

            retryable:
              raw.retryable,
          },
          0,
          this.config,
        ),
    };
  }

  async #settle(
    record,
    providerResult,
    request,
  ) {
    const fn =
      this.financialCore
        ?.settleDisbursement ??
      this.financialCore
        ?.settleSuccessfulPayment ??
      this.financialCore
        ?.postDisbursement ??
      this.ledgerBridge
        ?.settleDisbursement;

    if (
      !isFn(fn)
    ) {
      if (
        this.config
          .requireFinancialCore
      ) {
        this.#throw(
          ERROR_CODES.FINANCIAL_CORE_UNAVAILABLE,
          'Financial Core settlement adapter is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        settled:
          false,

        verified:
          false,

        state:
          'UNKNOWN',
      };
    }

    try {
      const result =
        await fn.call(
          this.financialCore ??
            this.ledgerBridge,
          {
            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            disbursementId:
              record.disbursementId,

            reference:
              record.reference,

            transactionId:
              record.transactionId,

            originalIdempotencyKey:
              record.originalIdempotencyKey,

            amountMinor:
              record.amountMinor,

            currency:
              record.currency,

            beneficiaryId:
              record.beneficiaryId,

            providerTransactionId:
              providerResult.providerTransactionId,

            providerReference:
              providerResult.providerReference,

            providerResult:
              providerResult.evidence,

            requestId:
              request.requestId,

            correlationId:
              request.correlationId,

            traceId:
              request.traceId,
          },
        );

      const status =
        upper(
          result?.status ??
            result?.outcome ??
            result?.state,
        );

      const settled =
        result?.settled ===
          true ||
        result?.posted ===
          true ||
        result?.success ===
          true ||
        SUCCESS.has(
          status,
        );

      const ambiguous =
        [
          'PENDING',
          'UNKNOWN',
          'AMBIGUOUS',
        ].includes(
          status,
        );

      return {
        settled,

        verified:
          settled &&
          !ambiguous,

        state:
          settled
            ? 'SETTLED'
            : ambiguous
              ? 'AMBIGUOUS'
              : 'FAILED',

        transactionId:
          str(
            result?.transactionId ??
              result?.financialTransactionId,
            LIMITS.transactionIdLength,
          ),

        ledgerEntryId:
          str(
            result?.ledgerEntryId ??
              result?.journalEntryId,
            LIMITS.transactionIdLength,
          ),

        reference:
          str(
            result?.reference ??
              result?.operationReference,
            LIMITS.referenceLength,
          ),

        reason:
          str(
            result?.reason ??
              result?.message,
            LIMITS.metadataStringLength,
          ),

        evidence:
          sanitize(
            result,
            0,
            this.config,
          ),
      };
    } catch (error) {
      this.#log(
        'error',
        'Financial Core settlement failed or became uncertain.',
        {
          disbursementId:
            record.disbursementId,

          message:
            error?.message,
        },
      );

      return {
        settled:
          false,

        verified:
          false,

        state:
          'AMBIGUOUS',

        reason:
          'Financial Core settlement could not be established authoritatively.',
      };
    }
  }

  async #track(
    record,
    financial,
  ) {
    const fn =
      this.settlementTracker
        ?.recordProviderSettlement ??
      this.settlementTracker
        ?.recordSettlement ??
      this.settlementTracker
        ?.track;

    if (
      !isFn(fn)
    ) {
      return null;
    }

    try {
      return await fn.call(
        this.settlementTracker,
        {
          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          disbursementId:
            record.disbursementId,

          reference:
            record.reference,

          transactionId:
            record.transactionId,

          originalIdempotencyKey:
            record.originalIdempotencyKey,

          amountMinor:
            record.amountMinor,

          currency:
            record.currency,

          providerTransactionId:
            record.providerTransactionId,

          providerReference:
            record.providerReference,

          financial:
            sanitize(
              financial,
              0,
              this.config,
            ),
        },
      );
    } catch {
      return null;
    }
  }

  async #compensate(
    record,
  ) {
    if (
      !this.config
        .autoCreateCompensationCase ||
      !this.compensationManager
    ) {
      return null;
    }

    const fn =
      this.compensationManager
        .createCase ??
      this.compensationManager
        .requestCompensation;

    if (
      !isFn(fn)
    ) {
      return null;
    }

    try {
      return await fn.call(
        this.compensationManager,
        {
          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          reference:
            record.reference,

          transactionId:
            record.transactionId,

          originalIdempotencyKey:
            record.originalIdempotencyKey,

          amountMinor:
            record.amountMinor,

          currency:
            record.currency,

          providerOutcome:
            PROVIDER_OUTCOMES.FAILURE,

          financialExecutionState:
            record.financialExecutionState,

          reconciliationState:
            record.reconciliationState,

          originalScopeFingerprint:
            record.disbursementFingerprint,

          compensationType:
            COMPENSATION_TYPES.RELEASE_RESERVATION,

          reasonCode:
            record.failureCode ??
            ERROR_CODES.COMPENSATION_REQUIRED,

          metadata: {
            source:
              COMPONENT,

            disbursementId:
              record.disbursementId,
          },
        },
      );
    } catch {
      return null;
    }
  }

  async #applyProviderResult(
    record,
    providerResult,
    request,
  ) {
    const result =
      this.#normalizeProviderResult(
        providerResult,
      );

    if (
      result.outcome ===
      PROVIDER_OUTCOMES.SUCCESS
    ) {
      const accepted =
        record.state ===
        DISBURSEMENT_STATES.EXECUTING
          ? await this.#transition(
              record,
              DISBURSEMENT_STATES.PROVIDER_ACCEPTED,
              {
                action:
                  'PROVIDER_ACCEPTED',

                patch: {
                  outcome:
                    SERVICE_OUTCOMES.ACCEPTED,

                  providerOutcome:
                    result.outcome,

                  providerResultCategory:
                    result.category,

                  providerExecutionState:
                    result.executionState,

                  providerTransactionId:
                    result.providerTransactionId,

                  providerReference:
                    result.providerReference,

                  providerStatus:
                    result.status,
                },
              },
            )
          : record;

      const financial =
        await this.#settle(
          accepted,
          result,
          request,
        );

      if (
        !financial.settled
      ) {
        const recon =
          await this.#transition(
            accepted,
            DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
            {
              action:
                ACTIONS.RECONCILE,

              patch: {
                outcome:
                  SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,

                providerOutcome:
                  result.outcome,

                providerResultCategory:
                  result.category,

                providerTransactionId:
                  result.providerTransactionId,

                providerReference:
                  result.providerReference,

                financialExecutionState:
                  financial.state,

                financialEvidence:
                  financial.evidence,

                reconciliationReason:
                  financial.reason,
              },
            },
          );

        await this.#audit(
          'DISBURSEMENT_RECONCILIATION_REQUIRED',
          recon,
          {
            reason:
              financial.reason,
          },
        );

        await this.#event(
          EVENT_TYPES.RECONCILIATION_REQUIRED,
          recon,
          {
            reason:
              financial.reason,
          },
        );

        return this.#result(
          recon,
          SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,
          ERROR_CODES.RECONCILIATION_REQUIRED,
          false,
          {
            financial,
          },
        );
      }

      const success =
        await this.#transition(
          accepted,
          DISBURSEMENT_STATES.SUCCESS,
          {
            action:
              ACTIONS.MARK_SETTLED,

            patch: {
              outcome:
                SERVICE_OUTCOMES.SUCCESS,

              providerOutcome:
                result.outcome,

              providerResultCategory:
                result.category,

              providerExecutionState:
                result.executionState,

              providerTransactionId:
                result.providerTransactionId,

              providerReference:
                result.providerReference,

              financialExecutionState:
                financial.state,

              financialTransactionId:
                financial.transactionId,

              ledgerEntryId:
                financial.ledgerEntryId,

              financialReference:
                financial.reference,

              financialEvidence:
                financial.evidence,

              settledAt:
                nowIso(
                  this.clock,
                ),

              completedAt:
                nowIso(
                  this.clock,
                ),
            },
          },
        );

      await this.#track(
        success,
        financial,
      );

      await this.#audit(
        'DISBURSEMENT_SUCCEEDED',
        success,
      );

      await this.#event(
        EVENT_TYPES.SUCCEEDED,
        success,
      );

      this.#metric(
        METRIC_NAMES.EXECUTION_SUCCESS,
        {
          tenantId:
            success.tenantId,
        },
      );

      return this.#result(
        success,
        SERVICE_OUTCOMES.SUCCESS,
        'DISBURSEMENT_SUCCEEDED',
        true,
      );
    }

    if (
      [
        PROVIDER_OUTCOMES.PENDING,
        PROVIDER_OUTCOMES.AMBIGUOUS,
        PROVIDER_OUTCOMES.UNKNOWN,
      ].includes(
        result.outcome,
      )
    ) {
      const ambiguous =
        await this.#transition(
          record,
          DISBURSEMENT_STATES.AMBIGUOUS,
          {
            action:
              ACTIONS.MARK_AMBIGUOUS,

            patch: {
              outcome:
                SERVICE_OUTCOMES.AMBIGUOUS,

              providerOutcome:
                result.outcome,

              providerResultCategory:
                result.category,

              providerExecutionState:
                result.executionState,

              providerTransactionId:
                result.providerTransactionId,

              providerReference:
                result.providerReference,

              providerStatus:
                result.status,

              financialExecutionState:
                'AMBIGUOUS',

              lastProviderError:
                result.reason,
            },
          },
        );

      await this.#audit(
        'DISBURSEMENT_AMBIGUOUS',
        ambiguous,
        {
          reason:
            result.reason,
        },
      );

      await this.#event(
        EVENT_TYPES.AMBIGUOUS,
        ambiguous,
        {
          reason:
            result.reason,
        },
      );

      this.#metric(
        METRIC_NAMES.EXECUTION_AMBIGUOUS,
        {
          tenantId:
            ambiguous.tenantId,
        },
      );

      return this.#result(
        ambiguous,
        SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,
        ERROR_CODES.PROVIDER_AMBIGUOUS,
        false,
        {
          nextAction:
            RETRY_DECISIONS.STATUS_CHECK,

          provider:
            result,
        },
      );
    }

    const failed =
      await this.#transition(
        record,
        DISBURSEMENT_STATES.FAILED,
        {
          action:
            ACTIONS.MARK_FAILED,

          patch: {
            outcome:
              SERVICE_OUTCOMES.FAILED,

            providerOutcome:
              result.outcome,

            providerResultCategory:
              result.category,

            providerExecutionState:
              result.executionState,

            providerTransactionId:
              result.providerTransactionId,

            providerReference:
              result.providerReference,

            providerStatus:
              result.status,

            financialExecutionState:
              'FAILED',

            failureCode:
              result.code,

            failureReason:
              result.reason,
          },
        },
      );

    const compensation =
      await this.#compensate(
        failed,
      );

    await this.#audit(
      'DISBURSEMENT_FAILED',
      failed,
      {
        compensationCaseId:
          compensation?.caseId,
      },
    );

    await this.#event(
      EVENT_TYPES.FAILED,
      failed,
      {
        compensationCaseId:
          compensation?.caseId,
      },
    );

    this.#metric(
      METRIC_NAMES.EXECUTION_FAILURE,
      {
        tenantId:
          failed.tenantId,
      },
    );

    return this.#result(
      failed,
      SERVICE_OUTCOMES.FAILED,
      result.code ??
        ERROR_CODES.PROVIDER_REJECTED,
      false,
      {
        compensation,
      },
    );
  }

  async initiate(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        this.config,
        this.idFactory,
      );

    const existing =
      await this.#findExisting(
        request,
      );

    if (
      existing
    ) {
      return this.#result(
        existing,
        SERVICE_OUTCOMES.REPLAY,
        'DISBURSEMENT_ALREADY_EXISTS',
        existing.state ===
          DISBURSEMENT_STATES.SUCCESS,
        {
          idempotent:
            true,
        },
      );
    }

    const beneficiary =
      await this.#beneficiary(
        request,
      );

    if (
      beneficiary.valid ===
        false ||
      [
        'BLOCK',
        'DENY',
        'REJECT',
        'REJECTED',
      ].includes(
        upper(
          beneficiary.outcome,
        ),
      )
    ) {
      this.#throw(
        ERROR_CODES.BENEFICIARY_INVALID,
        beneficiary.reason ??
          'Beneficiary is not eligible for disbursement.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const policy =
      await this.#policy(
        request,
        beneficiary,
        'INITIATE',
      );

    if (
      this.#blocks(
        policy,
      )
    ) {
      this.#throw(
        ERROR_CODES.COMPLIANCE_BLOCKED,
        policy.reason ??
          'Disbursement policy blocked the request.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const fraud =
      await this.#fraud(
        request,
        beneficiary,
      );

    if (
      this.#blocks(
        fraud,
      )
    ) {
      this.#throw(
        ERROR_CODES.BENEFICIARY_BLOCKED,
        fraud.reason ??
          'Fraud controls blocked the request.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const record =
      this.#buildRecord(
        request,
        beneficiary,
        policy,
        fraud,
      );

    const reserved =
      await this.#reserveIdempotency(
        request,
        record,
      );

    if (
      !reserved.reserved &&
      reserved.record
    ) {
      return this.#result(
        reserved.record,
        SERVICE_OUTCOMES.REPLAY,
        'DISBURSEMENT_ALREADY_EXISTS',
        false,
        {
          idempotent:
            true,
        },
      );
    }

    let saved;

    try {
      saved =
        await this.#createRecord(
          record,
        );
    } catch (error) {
      await this.#releaseIdempotency(
        request,
      );

      throw error;
    }

    await this.#commitIdempotency(
      request,
      saved,
    );

    let current =
      saved;

    if (
      current.requiresApproval
    ) {
      const approval =
        await this.#createApproval(
          current,
          request,
        );

      if (
        approval?.approved
      ) {
        current =
          await this.#transition(
            current,
            DISBURSEMENT_STATES.APPROVED,
            {
              action:
                ACTIONS.APPROVE,

              patch: {
                outcome:
                  SERVICE_OUTCOMES.READY,

                approvedAt:
                  nowIso(
                    this.clock,
                  ),

                approvedBy:
                  'approval-workflow',

                approvalId:
                  approval.approvalId,

                approvalScopeFingerprint:
                  approval.scopeFingerprint,

                approval,
              },
            },
          );
      } else {
        const refreshed =
          await this.#getRecord(
            current.disbursementId,
            current.tenantId,
          ).catch(
            () => null,
          );

        if (
          refreshed
        ) {
          current =
            refreshed;
        }
      }
    }

    await this.#audit(
      'DISBURSEMENT_CREATED',
      current,
    );

    await this.#event(
      EVENT_TYPES.CREATED,
      current,
    );

    if (
      input.execute ===
      true
    ) {
      return this.execute({
        ...input,
        disbursementId:
          current.disbursementId,
      });
    }

    return this.#result(
      current,

      current.requiresApproval
        ? SERVICE_OUTCOMES.PENDING_APPROVAL
        : SERVICE_OUTCOMES.READY,

      current.requiresApproval
        ? ERROR_CODES.APPROVAL_REQUIRED
        : 'DISBURSEMENT_READY',

      false,

      {
        idempotent:
          false,

        beneficiaryValidation:
          beneficiary,

        policy,
      },
    );
  }

  async execute(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        this.config,
        this.idFactory,
      );

    let record =
      input.disbursement
        ? clone(
            input.disbursement,
          )
        : await this.#getRecord(
            request.disbursementId,
            request.tenantId,
          );

    if (
      record.state ===
      DISBURSEMENT_STATES.SUCCESS
    ) {
      return this.#result(
        record,
        SERVICE_OUTCOMES.REPLAY,
        'DISBURSEMENT_ALREADY_SETTLED',
        true,
        {
          idempotent:
            true,
        },
      );
    }

    if (
      TERMINAL.has(
        record.state,
      )
    ) {
      return this.#result(
        record,
        SERVICE_OUTCOMES.REPLAY,
        'DISBURSEMENT_TERMINAL',
        false,
        {
          idempotent:
            true,
        },
      );
    }

    if (
      [
        DISBURSEMENT_STATES.AMBIGUOUS,
        DISBURSEMENT_STATES.PROVIDER_PENDING,
      ].includes(
        record.state,
      )
    ) {
      return this.status({
        ...input,

        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,
      });
    }

    if (
      [
        DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
        DISBURSEMENT_STATES.RECONCILING,
      ].includes(
        record.state,
      )
    ) {
      return this.reconcile({
        ...input,

        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,
      });
    }

    if (
      record.requiresApproval
    ) {
      const approval =
        await this.#verifyApproval(
          record,
          request,
        );

      if (
        !approval.approved
      ) {
        return this.#result(
          record,
          SERVICE_OUTCOMES.PENDING_APPROVAL,
          approval.code ??
            ERROR_CODES.APPROVAL_REQUIRED,
          false,
          {
            reason:
              approval.reason,
          },
        );
      }

      if (
        record.state ===
        DISBURSEMENT_STATES.PENDING_APPROVAL
      ) {
        record =
          await this.#transition(
            record,
            DISBURSEMENT_STATES.APPROVED,
            {
              action:
                ACTIONS.APPROVE,

              patch: {
                outcome:
                  SERVICE_OUTCOMES.READY,

                approvedAt:
                  nowIso(
                    this.clock,
                  ),
              },
            },
          );
      }
    }

    if (
      record.state ===
      DISBURSEMENT_STATES.APPROVED
    ) {
      record =
        await this.#transition(
          record,
          DISBURSEMENT_STATES.QUEUED,
          {
            action:
              ACTIONS.EXECUTE,

            patch: {
              outcome:
                SERVICE_OUTCOMES.ACCEPTED,
            },
          },
        );
    }

    if (
      record.state ===
      DISBURSEMENT_STATES.QUEUED
    ) {
      const claim =
        await this.#claim(
          record,
          request.executor ??
            request.actor,
        );

      if (
        !claim.claimed
      ) {
        return this.#result(
          record,
          SERVICE_OUTCOMES.PENDING_PROVIDER,
          claim.code,
          false,
          {
            idempotent:
              true,
          },
        );
      }

      record =
        claim.record;
    }

    if (
      record.state !==
      DISBURSEMENT_STATES.EXECUTING
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        `Disbursement is not executable from ${record.state}.`,
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const beneficiary =
      await this.#beneficiary(
        request,
      );

    const identity =
      this.#identity(
        beneficiary,
      );

    if (
      record.beneficiaryFingerprint &&
      identity.beneficiaryFingerprint &&
      record.beneficiaryFingerprint !==
        identity.beneficiaryFingerprint
    ) {
      this.#throw(
        ERROR_CODES.STALE_SCOPE,
        'Beneficiary identity changed after authorization.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const policy =
      await this.#policy(
        request,
        beneficiary,
        'EXECUTE',
        record,
      );

    if (
      this.#blocks(
        policy,
      ) ||
      this.#requiresReview(
        policy,
      )
    ) {
      this.#throw(
        ERROR_CODES.APPROVAL_INVALID,
        'Current policy no longer permits this disbursement to execute.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const freshFingerprint =
      buildDisbursementFingerprint({
        ...request,

        beneficiaryFingerprint:
          identity.beneficiaryFingerprint,

        riskLevel:
          maxRiskLevel(
            record.riskLevel,
            policy?.riskLevel,
          ),

        policyVersion:
          policy?.policyVersion,

        policyFingerprint:
          policy?.fingerprint ??
          policy?.policyFingerprint,
      });

    if (
      record.disbursementFingerprint !==
      freshFingerprint
    ) {
      this.#throw(
        ERROR_CODES.STALE_SCOPE,
        'Disbursement scope changed after authorization.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const providerRequest =
      await this.#buildProviderRequest(
        record,
        request,
      );

    await this.#audit(
      'DISBURSEMENT_EXECUTION_STARTED',
      record,
      {
        actor:
          request.executor ??
          request.actor,
      },
    );

    await this.#event(
      EVENT_TYPES.EXECUTION_STARTED,
      record,
    );

    this.#metric(
      METRIC_NAMES.EXECUTION_TOTAL,
      {
        tenantId:
          record.tenantId,
      },
    );

    const providerResult =
      await this.#providerCall(
        providerRequest,
        record,
        request,
      );

    return this.#applyProviderResult(
      record,
      providerResult,
      request,
    );
  }

  async status(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        {
          ...this.config,

          requireAmountMinor:
            false,

          requireCurrency:
            false,

          requireReference:
            false,

          requireOriginalIdempotencyKey:
            false,
        },
        this.idFactory,
      );

    const record =
      await this.#getRecord(
        request.disbursementId,
        request.tenantId,
      );

    const fn =
      this.providerAdapter
        ?.getStatus ??
      this.providerAdapter
        ?.status ??
      this.providerAdapter
        ?.queryStatus;

    if (
      !isFn(fn)
    ) {
      this.#throw(
        ERROR_CODES.PROVIDER_UNAVAILABLE,
        'Airtel status adapter is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const raw =
      await fn.call(
        this.providerAdapter,
        {
          tenantId:
            record.tenantId,

          provider:
            PROVIDER,

          operation:
            'AIRTEL_DISBURSEMENT_STATUS',

          disbursementId:
            record.disbursementId,

          transactionId:
            record.transactionId,

          originalIdempotencyKey:
            record.originalIdempotencyKey,

          providerTransactionId:
            record.providerTransactionId,

          providerReference:
            record.providerReference,

          reference:
            record.reference,

          requestId:
            request.requestId,

          correlationId:
            request.correlationId,

          traceId:
            request.traceId,
        },
      );

    const result =
      this.#normalizeProviderResult(
        raw,
      );

    if (
      result.outcome ===
        PROVIDER_OUTCOMES.SUCCESS ||
      result.outcome ===
        PROVIDER_OUTCOMES.FAILURE ||
      result.outcome ===
        PROVIDER_OUTCOMES.PENDING ||
      result.outcome ===
        PROVIDER_OUTCOMES.AMBIGUOUS
    ) {
      return this.reconcile({
        ...input,

        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,

        statusEvidence:
          result,
      });
    }

    return this.#result(
      record,
      SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,
      ERROR_CODES.RECONCILIATION_REQUIRED,
      false,
      {
        provider:
          result,
      },
    );
  }

  async reconcile(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        {
          ...this.config,

          requireAmountMinor:
            false,

          requireCurrency:
            false,

          requireReference:
            false,

          requireOriginalIdempotencyKey:
            false,
        },
        this.idFactory,
      );

    let record =
      await this.#getRecord(
        request.disbursementId,
        request.tenantId,
      );

    if (
      record.state ===
      DISBURSEMENT_STATES.SUCCESS
    ) {
      return this.#result(
        record,
        SERVICE_OUTCOMES.SUCCESS,
        'DISBURSEMENT_ALREADY_SETTLED',
        true,
      );
    }

    if (
      !input.statusEvidence &&
      !this.reconciliationService
    ) {
      this.#throw(
        ERROR_CODES.RECONCILIATION_UNAVAILABLE,
        'Airtel reconciliation adapter is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    if (
      record.state !==
        DISBURSEMENT_STATES.RECONCILIATION_REQUIRED &&
      record.state !==
        DISBURSEMENT_STATES.RECONCILING
    ) {
      record =
        await this.#transition(
          record,
          DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
          {
            action:
              ACTIONS.RECONCILE,

            patch: {
              outcome:
                SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,
            },
          },
        );
    }

    if (
      record.state ===
      DISBURSEMENT_STATES.RECONCILIATION_REQUIRED
    ) {
      record =
        await this.#transition(
          record,
          DISBURSEMENT_STATES.RECONCILING,
          {
            action:
              ACTIONS.RECONCILE,
          },
        );
    }

    let raw =
      input.statusEvidence;

    if (
      !raw
    ) {
      const fn =
        this.reconciliationService
          ?.reconcile ??
        this.reconciliationService
          ?.check ??
        this.reconciliationService
          ?.assess;

      if (
        !isFn(fn)
      ) {
        this.#throw(
          ERROR_CODES.RECONCILIATION_UNAVAILABLE,
          'Reconciliation contract is invalid.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      raw =
        await fn.call(
          this.reconciliationService,
          {
            tenantId:
              record.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            disbursementId:
              record.disbursementId,

            transactionId:
              record.transactionId,

            reference:
              record.reference,

            originalIdempotencyKey:
              record.originalIdempotencyKey,

            providerTransactionId:
              record.providerTransactionId,

            providerReference:
              record.providerReference,

            amountMinor:
              record.amountMinor,

            currency:
              record.currency,

            context:
              request,
          },
        );
    }

    const outcome =
      upper(
        raw?.outcome ??
          raw?.reconciliationOutcome ??
          raw?.status,
      );

    const success =
      raw?.confirmedSuccess ===
        true ||
      raw?.financialPosted ===
        true ||
      [
        'SUCCESS',
        'SUCCEEDED',
        'SETTLED',
        'COMPLETED',
        'POSTED',
      ].includes(
        outcome,
      );

    const failure =
      raw?.confirmedFailure ===
        true ||
      [
        'FAILURE',
        'FAILED',
        'DECLINED',
        'REJECTED',
      ].includes(
        outcome,
      );

    const conflict =
      raw?.conflict ===
        true ||
      raw?.mismatch ===
        true ||
      raw?.repairRequired ===
        true ||
      [
        'CONFLICT',
        'MISMATCH',
        'REPAIR_REQUIRED',
      ].includes(
        outcome,
      );

    const reconEvidence =
      sanitize(
        raw,
        0,
        this.config,
      );

    const reconFingerprint =
      str(
        raw?.fingerprint,
        128,
      ) ??
      sha256(
        reconEvidence,
      );

    record =
      (await this.#patch(
        record,
        {
          reconciliationState:
            success
              ? RECONCILIATION_STATES.CONFIRMED_SUCCESS
              : failure
                ? RECONCILIATION_STATES.CONFIRMED_FAILURE
                : conflict
                  ? RECONCILIATION_STATES.CONFLICT
                  : RECONCILIATION_STATES.PENDING,

          reconciliationOutcome:
            success
              ? RECONCILIATION_OUTCOMES.CONFIRMED_SUCCESS
              : failure
                ? RECONCILIATION_OUTCOMES.CONFIRMED_FAILURE
                : conflict
                  ? RECONCILIATION_OUTCOMES.MISMATCH
                  : RECONCILIATION_OUTCOMES.PENDING,

          reconciliationFingerprint:
            reconFingerprint,

          reconciliationEvidence:
            reconEvidence,
        },
      )) ??
      record;

    if (
      success
    ) {
      const financial =
        await this.#settle(
          record,
          {
            outcome:
              PROVIDER_OUTCOMES.SUCCESS,

            providerTransactionId:
              record.providerTransactionId,

            providerReference:
              record.providerReference,
          },
          request,
        );

      if (
        !financial.settled
      ) {
        return this.#result(
          record,
          SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,
          ERROR_CODES.FINANCIAL_CORE_UNAVAILABLE,
          false,
          {
            financial,
          },
        );
      }

      const reconciled =
        await this.#transition(
          record,
          DISBURSEMENT_STATES.RECONCILED,
          {
            action:
              ACTIONS.MARK_RECONCILED,

            patch: {
              outcome:
                SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,
            },
          },
        );

      const settled =
        await this.#transition(
          reconciled,
          DISBURSEMENT_STATES.SUCCESS,
          {
            action:
              ACTIONS.MARK_SETTLED,

            patch: {
              outcome:
                SERVICE_OUTCOMES.SUCCESS,

              financialExecutionState:
                financial.state,

              financialTransactionId:
                financial.transactionId,

              ledgerEntryId:
                financial.ledgerEntryId,

              financialReference:
                financial.reference,

              completedAt:
                nowIso(
                  this.clock,
                ),
            },
          },
        );

      await this.#track(
        settled,
        financial,
      );

      await this.#audit(
        'DISBURSEMENT_RECONCILED_SUCCESS',
        settled,
      );

      await this.#event(
        EVENT_TYPES.RECONCILIATION_COMPLETED,
        settled,
      );

      return this.#result(
        settled,
        SERVICE_OUTCOMES.SUCCESS,
        'DISBURSEMENT_RECONCILED_SUCCESS',
        true,
        {
          financial,
        },
      );
    }

    if (
      failure
    ) {
      const failed =
        await this.#transition(
          record,
          DISBURSEMENT_STATES.FAILED,
          {
            action:
              ACTIONS.MARK_FAILED,

            patch: {
              outcome:
                SERVICE_OUTCOMES.FAILED,

              financialExecutionState:
                'FAILED',

              failureCode:
                ERROR_CODES.PROVIDER_REJECTED,

              failureReason:
                str(
                  raw?.reason ??
                    'Reconciliation confirmed provider failure.',
                  500,
                ),
            },
          },
        );

      await this.#audit(
        'DISBURSEMENT_RECONCILED_FAILURE',
        failed,
      );

      await this.#event(
        EVENT_TYPES.RECONCILIATION_COMPLETED,
        failed,
        {
          outcome:
            'FAILURE',
        },
      );

      return this.#result(
        failed,
        SERVICE_OUTCOMES.FAILED,
        ERROR_CODES.PROVIDER_REJECTED,
        false,
      );
    }

    const state =
      conflict
        ? DISBURSEMENT_STATES.ESCALATED
        : record.state;

    if (
      state !==
      record.state
    ) {
      record =
        await this.#transition(
          record,
          state,
          {
            action:
              ACTIONS.ESCALATE,

            patch: {
              outcome:
                SERVICE_OUTCOMES.ESCALATED,
            },
          },
        );
    }

    return this.#result(
      record,
      conflict
        ? SERVICE_OUTCOMES.ESCALATED
        : SERVICE_OUTCOMES.RECONCILIATION_REQUIRED,

      conflict
        ? ERROR_CODES.RECONCILIATION_CONFLICT
        : ERROR_CODES.RECONCILIATION_REQUIRED,

      false,

      {
        reconciliation: {
          state:
            record.reconciliationState,

          fingerprint:
            reconFingerprint,
        },
      },
    );
  }

  async cancel(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        {
          ...this.config,

          requireAmountMinor:
            false,

          requireCurrency:
            false,
        },
        this.idFactory,
      );

    const record =
      await this.#getRecord(
        request.disbursementId,
        request.tenantId,
      );

    if (
      [
        DISBURSEMENT_STATES.EXECUTING,
        DISBURSEMENT_STATES.PROVIDER_ACCEPTED,
        DISBURSEMENT_STATES.PROVIDER_PENDING,
        DISBURSEMENT_STATES.SUCCESS,
      ].includes(
        record.state,
      )
    ) {
      this.#throw(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        'A disbursement with provider or financial activity cannot be cancelled through the initiate workflow.',
        {
          state:
            record.state,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const reason =
      str(
        input.reason,
        LIMITS.reasonLength,
      );

    if (!reason) {
      this.#throw(
        'CANCELLATION_REASON_REQUIRED',
        'Cancellation reason is required.',
      );
    }

    const updated =
      await this.#transition(
        record,
        DISBURSEMENT_STATES.CANCELLED,
        {
          action:
            ACTIONS.CANCEL,

          actor:
            request.actor,

          patch: {
            outcome:
              SERVICE_OUTCOMES.CANCELLED,

            cancellationReason:
              reason,

            cancelledAt:
              nowIso(
                this.clock,
              ),
          },
        },
      );

    await this.#audit(
      'DISBURSEMENT_CANCELLED',
      updated,
      {
        reason,

        actor:
          request.actor,
      },
    );

    return this.#result(
      updated,
      SERVICE_OUTCOMES.CANCELLED,
      'DISBURSEMENT_CANCELLED',
      false,
    );
  }

  async retry(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        {
          ...this.config,

          requireAmountMinor:
            false,

          requireCurrency:
            false,

          requireReference:
            false,

          requireOriginalIdempotencyKey:
            false,
        },
        this.idFactory,
      );

    const record =
      await this.#getRecord(
        request.disbursementId,
        request.tenantId,
      );

    if (
      record.state ===
      DISBURSEMENT_STATES.SUCCESS
    ) {
      return this.#result(
        record,
        SERVICE_OUTCOMES.REPLAY,
        'DISBURSEMENT_ALREADY_SETTLED',
        true,
      );
    }

    if (
      [
        DISBURSEMENT_STATES.AMBIGUOUS,
        DISBURSEMENT_STATES.PROVIDER_PENDING,
      ].includes(
        record.state,
      )
    ) {
      return this.status({
        ...input,

        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,
      });
    }

    const fn =
      this.stateMachine
        ?.prepareRetry ??
      this.stateMachine
        ?.retryDisbursement ??
      this.stateMachine
        ?.requeue;

    if (
      !isFn(fn)
    ) {
      return this.#result(
        record,
        SERVICE_OUTCOMES.REVIEW,
        RETRY_DECISIONS.REVIEW,
        false,
        {
          reason:
            'Automatic retry requires an explicit state-machine retry transition.',

          nextAction:
            RETRY_DECISIONS.REVIEW,
        },
      );
    }

    await fn.call(
      this.stateMachine,
      {
        disbursementId:
          record.disbursementId,

        tenantId:
          record.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        expectedVersion:
          Number(
            record.version ??
              1,
          ),

        expectedFingerprint:
          record.disbursementFingerprint,

        originalIdempotencyKey:
          record.originalIdempotencyKey,

        action:
          ACTIONS.RETRY,
      },
    );

    return this.execute({
      ...input,

      disbursementId:
        record.disbursementId,

      tenantId:
        record.tenantId,
    });
  }

  async processProviderResult(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        {
          ...this.config,

          requireAmountMinor:
            false,

          requireCurrency:
            false,
        },
        this.idFactory,
      );

    const record =
      await this.#getRecord(
        request.disbursementId,
        request.tenantId,
      );

    return this.#applyProviderResult(
      record,
      input.providerResult ??
        input.result ??
        input.providerResponse,
      request,
    );
  }

  async validate(
    input = {},
  ) {
    const request =
      normalizeRequest(
        input,
        this.config,
        this.idFactory,
      );

    const beneficiary =
      await this.#beneficiary(
        request,
      );

    const policy =
      await this.#policy(
        request,
        beneficiary,
        'VALIDATE',
      );

    if (
      this.#blocks(
        policy,
      )
    ) {
      this.#throw(
        ERROR_CODES.VALIDATION_FAILED,
        policy.reason ??
          'Disbursement validation was blocked.',
        {},
        {
          httpStatus: 409,
        },
      );
    }

    const fingerprint =
      buildDisbursementFingerprint({
        ...request,

        beneficiaryFingerprint:
          this.#identity(
            beneficiary,
          ).beneficiaryFingerprint,

        policyVersion:
          policy?.policyVersion,

        policyFingerprint:
          policy?.fingerprint ??
          policy?.policyFingerprint,
      });

    return deepFreeze({
      valid:
        beneficiary.valid !==
          false &&
        !this.#requiresReview(
          policy,
        ),

      outcome:
        this.#requiresReview(
          policy,
        )
          ? SERVICE_OUTCOMES.REVIEW
          : SERVICE_OUTCOMES.READY,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        request.tenantId,

      beneficiary,

      policy,

      fingerprint,
    });
  }

  async get({
    disbursementId,
    tenantId,
  } = {}) {
    return deepFreeze(
      await this.#getRecord(
        disbursementId,
        tenantId,
      ),
    );
  }

  #result(
    record,
    outcome,
    code,
    success,
    extra = {},
  ) {
    return deepFreeze({
      success:
        Boolean(
          success,
        ),

      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      disbursementId:
        record?.disbursementId,

      tenantId:
        record?.tenantId,

      state:
        record?.state,

      outcome,

      code,

      idempotent:
        Boolean(
          extra.idempotent,
        ),

      reference:
        record?.reference,

      transactionId:
        record?.transactionId,

      amountMinor:
        record?.amountMinor,

      currency:
        record?.currency,

      beneficiaryFingerprint:
        record?.beneficiaryFingerprint,

      originalIdempotencyKey:
        record?.originalIdempotencyKey,

      providerTransactionId:
        record?.providerTransactionId,

      providerReference:
        record?.providerReference,

      disbursementFingerprint:
        record?.disbursementFingerprint,

      riskLevel:
        record?.riskLevel,

      approvalId:
        record?.approvalId,

      nextAction:
        extra.nextAction,

      financialSafety:
        FINANCIAL_SAFETY_BOUNDARY,

      ...extra,
    });
  }

  health() {
    const ready = {
      repository:
        Boolean(
          this.repository,
        ),

      atomicTransition:
        Boolean(
          this.#repo(
            'transitionDisbursement',
            'atomicTransition',
            'compareAndSetTransition',
            'transition',
            'updateState',
          ),
        ),

      atomicClaim:
        Boolean(
          this.#repo(
            'claimForExecution',
            'claimDisbursement',
            'atomicClaim',
            'claim',
          ),
        ),

      idempotency:
        Boolean(
          this.idempotencyManager,
        ),

      beneficiaryValidator:
        Boolean(
          this.beneficiaryValidator,
        ),

      providerAdapter:
        Boolean(
          this.providerAdapter,
        ),

      transactionBuilder:
        Boolean(
          this.transactionBuilder,
        ),

      financialCore:
        Boolean(
          this.financialCore ??
            this.ledgerBridge,
        ),

      policyEngine:
        Boolean(
          this.policyEngine,
        ),

      approvalWorkflow:
        Boolean(
          this.approvalWorkflow,
        ),

      reconciliationService:
        Boolean(
          this.reconciliationService,
        ),

      compensationManager:
        Boolean(
          this.compensationManager,
        ),
    };

    const healthy =
      Object.entries(
        ready,
      ).every(
        ([
          key,
          value,
        ]) => {
          if (
            [
              'reconciliationService',
              'compensationManager',
            ].includes(
              key,
            )
          ) {
            return true;
          }

          return value;
        },
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

      dependencies:
        ready,

      controls: {
        tenantIsolation:
          this.config
            .requireTenantId,

        originalIdempotency:
          this.config
            .requireOriginalIdempotencyKey,

        makerChecker:
          this.config
            .requireApprovalForFinancialImpact,

        ambiguousRequiresStatusOrReconciliation:
          true,

        financialCoreAuthoritative:
          true,

        directLedgerMutation:
          false,

        directProviderHttp:
          false,
      },
    };
  }

  readiness() {
    return this.health();
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

      schemaVersion:
        SCHEMA_VERSION,

      health:
        this.health(),

      safety:
        FINANCIAL_SAFETY_BOUNDARY,

      moneyPolicy:
        MONEY_POLICY,

      configuration:
        this.config,
    };
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      supportsInitiate:
        true,

      supportsExecute:
        true,

      supportsStatus:
        true,

      supportsReconciliation:
        true,

      supportsRetry:
        true,

      supportsCancel:
        true,

      supportsProviderCallbacks:
        true,

      deterministicFingerprint:
        true,

      originalIdempotencyPreserved:
        true,

      ambiguousBlindRetry:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directProviderHttp:
        false,

      authoritativeFinancialBoundary:
        'TITECH_FINANCIAL_CORE',
    });
  }

  initiateDisbursement(
    input = {},
  ) {
    return this.initiate(
      input,
    );
  }

  createDisbursement(
    input = {},
  ) {
    return this.initiate(
      input,
    );
  }

  disburse(
    input = {},
  ) {
    return this.initiate({
      ...input,
      execute: true,
    });
  }

  send(
    input = {},
  ) {
    return this.disburse(
      input,
    );
  }

  executeDisbursement(
    input = {},
  ) {
    return this.execute(
      input,
    );
  }

  getStatus(
    input = {},
  ) {
    return this.status(
      input,
    );
  }

  reconcileDisbursement(
    input = {},
  ) {
    return this.reconcile(
      input,
    );
  }

  cancelDisbursement(
    input = {},
  ) {
    return this.cancel(
      input,
    );
  }

  retryDisbursement(
    input = {},
  ) {
    return this.retry(
      input,
    );
  }

  processProviderCallback(
    input = {},
  ) {
    return this.processProviderResult(
      input,
    );
  }
}

export const createDisbursementService = (
  options = {},
) =>
  new AirtelDisbursementService(
    options,
  );

export const createAirtelDisbursementService =
  createDisbursementService;

export const DisbursementService =
  AirtelDisbursementService;

export const AirtelPaymentDisbursementService =
  AirtelDisbursementService;

export const defaultDisbursementService =
  createDisbursementService();

export const disbursementService =
  defaultDisbursementService;

export default AirtelDisbursementService;