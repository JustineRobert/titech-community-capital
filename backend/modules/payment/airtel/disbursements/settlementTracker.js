'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Settlement Tracker
 * =============================================================================
 * File:
 *   backend/modules/payment/airtel/disbursements/settlementTracker.js
 *
 * Architectural role
 * ------------------
 * Tenant-scoped operational tracking boundary for Airtel outbound disbursement
 * settlement state. This module records provider and reconciliation evidence;
 * it is NOT the financial ledger, balance engine, provider adapter or finality
 * authority.
 *
 * Canonical flow
 * --------------
 * Airtel Disbursement Service -> Settlement Tracker -> provider evidence /
 * reconciliation evidence -> operational state -> audit / outbox / SLA.
 *
 * Responsibilities
 * ----------------
 * - Create and track settlement lifecycle records.
 * - Preserve transaction/reference/idempotency identities.
 * - Enforce conservative transitions with optimistic concurrency where the
 *   repository supports compare-and-set semantics.
 * - Map provider outcomes without treating provider acceptance as accounting
 *   settlement.
 * - Store financial/reconciliation evidence separately from tracking state.
 * - Protect tenant boundaries and reject conflicting identities.
 * - Emit bounded audit/event projections and operational metrics.
 * - Support legacy-compatible create/register/transition/status APIs.
 *
 * Non-responsibilities
 * --------------------
 * - No Airtel HTTP or credential handling.
 * - No ledger/journal writes.
 * - No balance/wallet mutation.
 * - No accounting account selection.
 * - No KYC/AML/sanctions/fraud adjudication.
 * - No reconciliation adjudication.
 * - No blind financial retry or compensation.
 * - No destructive historical rewrite.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Tracking state is not accounting state.
 * 2. UNKNOWN/AMBIGUOUS provider outcomes remain unresolved until authoritative
 *    status/reconciliation evidence resolves them.
 * 3. Original transaction and idempotency identity are preserved.
 * 4. Duplicate creation and replayed transitions are idempotent where the
 *    repository can prove that safely; conflicting identities fail closed.
 * 5. Tenant identity is mandatory for reads and writes.
 * 6. Atomic CAS is preferred for state transitions.
 * 7. Raw provider request/response data never enters audit/event projections.
 * 8. Event/audit/SLA failures do not silently rewrite persisted state.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  PROVIDER as CANONICAL_PROVIDER,
  OPERATION as CANONICAL_OPERATION,
  SCHEMA_VERSION as CANONICAL_SCHEMA_VERSION,
} from './constants.js';

export const ENGINE_NAME = 'airtel-disbursement-settlement-tracker';
export const ENGINE_VERSION = '3.1.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = CANONICAL_PROVIDER ?? 'AIRTEL';
export const OPERATION = CANONICAL_OPERATION ?? 'DISBURSEMENT';
export const SCHEMA_VERSION = Number.isInteger(CANONICAL_SCHEMA_VERSION)
  ? CANONICAL_SCHEMA_VERSION
  : 1;

export const SETTLEMENT_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUBMITTED: 'SUBMITTED',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILING: 'RECONCILING',
  RECONCILED: 'RECONCILED',
  EXPIRED: 'EXPIRED',
});

export const TERMINAL_STATES = Object.freeze([
  SETTLEMENT_STATUS.COMPLETED,
  SETTLEMENT_STATUS.FAILED,
  SETTLEMENT_STATUS.REVERSED,
  SETTLEMENT_STATUS.CANCELLED,
  SETTLEMENT_STATUS.RECONCILED,
  SETTLEMENT_STATUS.EXPIRED,
]);

export const ACTIVE_STATES = Object.freeze([
  SETTLEMENT_STATUS.CREATED,
  SETTLEMENT_STATUS.PENDING,
  SETTLEMENT_STATUS.PROCESSING,
  SETTLEMENT_STATUS.SUBMITTED,
  SETTLEMENT_STATUS.PROVIDER_ACCEPTED,
  SETTLEMENT_STATUS.UNKNOWN,
  SETTLEMENT_STATUS.RECONCILIATION_REQUIRED,
  SETTLEMENT_STATUS.RECONCILING,
]);

export const ALLOWED_TRANSITIONS = Object.freeze({
  [SETTLEMENT_STATUS.CREATED]: Object.freeze([
    'CREATED', 'PENDING', 'PROCESSING', 'SUBMITTED', 'CANCELLED', 'UNKNOWN',
  ]),
  [SETTLEMENT_STATUS.PENDING]: Object.freeze([
    'PENDING', 'PROCESSING', 'SUBMITTED', 'PROVIDER_ACCEPTED', 'COMPLETED',
    'FAILED', 'CANCELLED', 'EXPIRED', 'UNKNOWN', 'RECONCILIATION_REQUIRED',
  ]),
  [SETTLEMENT_STATUS.PROCESSING]: Object.freeze([
    'PROCESSING', 'SUBMITTED', 'PROVIDER_ACCEPTED', 'COMPLETED', 'FAILED',
    'REVERSED', 'CANCELLED', 'EXPIRED', 'UNKNOWN', 'RECONCILIATION_REQUIRED',
  ]),
  [SETTLEMENT_STATUS.SUBMITTED]: Object.freeze([
    'SUBMITTED', 'PROVIDER_ACCEPTED', 'COMPLETED', 'FAILED', 'REVERSED',
    'UNKNOWN', 'RECONCILIATION_REQUIRED',
  ]),
  [SETTLEMENT_STATUS.PROVIDER_ACCEPTED]: Object.freeze([
    'PROVIDER_ACCEPTED', 'COMPLETED', 'FAILED', 'REVERSED', 'UNKNOWN',
    'RECONCILIATION_REQUIRED',
  ]),
  [SETTLEMENT_STATUS.UNKNOWN]: Object.freeze([
    'UNKNOWN', 'PENDING', 'PROCESSING', 'SUBMITTED', 'PROVIDER_ACCEPTED',
    'COMPLETED', 'FAILED', 'REVERSED', 'CANCELLED', 'RECONCILIATION_REQUIRED',
    'RECONCILING',
  ]),
  [SETTLEMENT_STATUS.RECONCILIATION_REQUIRED]: Object.freeze([
    'RECONCILIATION_REQUIRED', 'RECONCILING', 'RECONCILED', 'COMPLETED',
    'FAILED', 'REVERSED', 'UNKNOWN',
  ]),
  [SETTLEMENT_STATUS.RECONCILING]: Object.freeze([
    'RECONCILING', 'RECONCILED', 'RECONCILIATION_REQUIRED', 'COMPLETED',
    'FAILED', 'REVERSED', 'UNKNOWN',
  ]),
  [SETTLEMENT_STATUS.RECONCILED]: Object.freeze([
    'RECONCILED',
    'COMPLETED',
    'REVERSED',
  ]),
  [SETTLEMENT_STATUS.COMPLETED]: Object.freeze([
    'COMPLETED',
    'REVERSED',
  ]),
  [SETTLEMENT_STATUS.FAILED]: Object.freeze([
    'FAILED',
    'RECONCILIATION_REQUIRED',
  ]),
  [SETTLEMENT_STATUS.REVERSED]: Object.freeze([
    'REVERSED',
  ]),
  [SETTLEMENT_STATUS.CANCELLED]: Object.freeze([
    'CANCELLED',
  ]),
  [SETTLEMENT_STATUS.EXPIRED]: Object.freeze([
    'EXPIRED',
    'RECONCILIATION_REQUIRED',
  ]),
});

export const PROVIDER_STATUS_MAPPING = Object.freeze({
  SUCCESS: 'COMPLETED',
  SUCCEEDED: 'COMPLETED',
  SUCCESSFUL: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  SETTLED: 'COMPLETED',
  PAID: 'COMPLETED',

  FAILED: 'FAILED',
  FAILURE: 'FAILED',
  ERROR: 'FAILED',
  REJECTED: 'FAILED',
  DECLINED: 'FAILED',
  DENIED: 'FAILED',

  PENDING: 'PROCESSING',
  PROCESSING: 'PROCESSING',

  INITIATED: 'SUBMITTED',
  SUBMITTED: 'SUBMITTED',
  QUEUED: 'SUBMITTED',

  ACCEPTED: 'PROVIDER_ACCEPTED',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',

  REVERSED: 'REVERSED',

  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',

  EXPIRED: 'EXPIRED',
});

export const PROVIDER_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  PENDING: 'PENDING',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN: 'UNKNOWN',
});

export const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  requireAirtelProvider: true,
  requireOperation: true,
  requireSettlementId: true,

  requireOriginalIdempotencyKey: false,
  requireReference: false,
  requireProviderReferenceForProviderRecord: false,

  allowCreateFromProviderEvent: true,
  allowTransitionFromUnknown: true,
  allowPostTerminalReconciliation: false,

  requireAtomicTransitionForConcurrentWrites: false,

  maxTenantIdLength: 160,
  maxSettlementIdLength: 240,
  maxTransactionIdLength: 240,
  maxReferenceLength: 240,
  maxProviderReferenceLength: 240,
  maxIdempotencyKeyLength: 320,
  maxCorrelationIdLength: 240,
  maxExecutionIdLength: 240,
  maxActorIdLength: 200,
  maxReasonLength: 1000,

  maxMetadataDepth: 5,
  maxMetadataKeys: 64,
  maxMetadataArrayLength: 100,
  maxMetadataStringLength: 2048,

  maxTimelineEntries: 500,
  maxTimelineMetadataKeys: 25,

  defaultCurrency: 'UGX',

  publishEvents: true,
  writeAudit: true,
  evaluateSla: true,

  eventOnIdempotentTransition: false,

  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  failClosedOnSlaError: false,
});

const PRIVATE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const UNSAFE_KEY = /(^\$)|\./;

const SECRET_KEY =
  /(password|secret|token|authorization|cookie|set-cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|client.?secret|signature|credentials|raw(request|response)|provider.?payload)/i;

const isPlain = (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  !(v instanceof Date);

const isFn = (v) =>
  typeof v === 'function';

const upper = (v) =>
  v == null
    ? undefined
    : ((String(v).trim().toUpperCase() || undefined));

const bounded = (
  v,
  max,
) =>
  v == null
    ? undefined
    : ((String(v).trim() || '').slice(0, max) || undefined);

const clone = (v) =>
  v === undefined
    ? undefined
    : (() => {
        try {
          return structuredClone(v);
        } catch {
          try {
            return JSON.parse(
              JSON.stringify(v),
            );
          } catch {
            return v;
          }
        }
      })();

const stable = (v) => {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';

  if (v instanceof Date) {
    return `date:${v.toISOString()}`;
  }

  if (typeof v === 'bigint') {
    return `bigint:${v}`;
  }

  if (Array.isArray(v)) {
    return `[${v.map(stable).join(',')}]`;
  }

  if (isPlain(v)) {
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable(v[k])}`,
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

const nowMs = (clock) => {
  try {
    const v = clock?.now?.();

    if (v instanceof Date) {
      return v.getTime();
    }

    if (Number.isFinite(v)) {
      return v;
    }
  } catch {
    // Use system time.
  }

  return Date.now();
};

const nowDate = (clock) =>
  new Date(
    nowMs(clock),
  );

const nowIso = (clock) =>
  nowDate(clock).toISOString();

const operationalFailure = (error) => {
  const status = Number(
    error?.httpStatus ??
      error?.statusCode ??
      error?.status ??
      0,
  );

  return (
    Boolean(error?.retryable) ||
    status >= 500 ||
    status === 0
  );
};

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

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
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
      .map((v) =>
        sanitize(
          v,
          depth + 1,
          config,
        ),
      );
  }

  if (!isPlain(value)) {
    return String(value);
  }

  const out = {};

  for (
    const key of Object.keys(value).slice(
      0,
      config.maxMetadataKeys,
    )
  ) {
    if (
      PRIVATE_KEYS.has(key) ||
      UNSAFE_KEY.test(key)
    ) {
      continue;
    }

    out[key] =
      SECRET_KEY.test(key)
        ? '[REDACTED]'
        : sanitize(
            value[key],
            depth + 1,
            config,
          );
  }

  return out;
};

export const buildTrackingFingerprint =
  (
    input = {},
  ) =>
    sha256({
      schemaVersion:
        SCHEMA_VERSION,

      tenantId:
        bounded(
          input.tenantId,
          160,
        ),

      provider:
        upper(
          input.provider ??
            PROVIDER,
        ),

      operation:
        upper(
          input.operation ??
            OPERATION,
        ),

      settlementId:
        bounded(
          input.settlementId,
          240,
        ),

      transactionId:
        bounded(
          input.transactionId,
          240,
        ),

      reference:
        bounded(
          input.reference,
          240,
        ),

      providerReference:
        bounded(
          input.providerReference,
          240,
        ),

      amountMinor:
        input.amountMinor ==
        null
          ? null
          : String(
              input.amountMinor,
            ),

      currency:
        upper(
          input.currency,
        ),

      originalIdempotencyKeyHash:
        input.originalIdempotencyKey
          ? sha256(
              String(
                input.originalIdempotencyKey,
              ),
            )
          : null,
    });

const extractRecordId = (
  record,
) =>
  bounded(
    record?.settlementId ??
      record?.id ??
      record?._id,
    240,
  );

const terminal = (
  status,
) =>
  TERMINAL_STATES.includes(
    upper(status),
  );

const canTransitionState = (
  from,
  to,
) =>
  Boolean(
    ALLOWED_TRANSITIONS[
      upper(from)
    ]?.includes(
      upper(to),
    ),
  );

const knownStatus = (
  status,
) =>
  Object.values(
    SETTLEMENT_STATUS,
  ).includes(
    upper(status),
  );

const normalizeAmountMinor = (
  value,
) => {
  if (
    value == null ||
    value === ''
  ) {
    return undefined;
  }

  if (
    typeof value === 'number' &&
    (
      !Number.isSafeInteger(
        value,
      ) ||
      !Number.isFinite(value)
    )
  ) {
    throw new AirtelSettlementTrackerError(
      'amountMinor must be an exact safe integer or string.',
      'SETTLEMENT_INVALID_AMOUNT',
      {},
      {
        httpStatus: 422,
      },
    );
  }

  if (
    typeof value ===
    'bigint'
  ) {
    if (
      value < 0n
    ) {
      throw new AirtelSettlementTrackerError(
        'amountMinor cannot be negative.',
        'SETTLEMENT_INVALID_AMOUNT',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    return value.toString();
  }

  const normalized =
    String(value).trim();

  if (
    !/^\d+$/.test(
      normalized,
    )
  ) {
    throw new AirtelSettlementTrackerError(
      'amountMinor must contain integer minor units only.',
      'SETTLEMENT_INVALID_AMOUNT',
      {},
      {
        httpStatus: 422,
      },
    );
  }

  return normalized;
};

const normalizeCurrency = (
  value,
  fallback,
) => {
  const normalized =
    upper(
      value ?? fallback,
    );

  if (
    !normalized ||
    !/^[A-Z]{3}$/.test(
      normalized,
    )
  ) {
    throw new AirtelSettlementTrackerError(
      'currency must be a three-letter currency code.',
      'SETTLEMENT_INVALID_CURRENCY',
      {},
      {
        httpStatus: 422,
      },
    );
  }

  return normalized;
};

const normalizeOutcome = (
  input = {},
) => {
  const raw =
    upper(
      input.providerOutcome ??
        input.outcome ??
        input.providerStatus ??
        input.status,
    );

  if (!raw) {
    return (
      input.confirmed === true ||
      input.settled === true ||
      input.reconciled === true
    )
      ? PROVIDER_OUTCOMES.SUCCESS
      : PROVIDER_OUTCOMES.UNKNOWN;
  }

  if (
    [
      'SUCCESS',
      'SUCCEEDED',
      'SUCCESSFUL',
      'COMPLETED',
      'SETTLED',
      'POSTED',
      'PAID',
      'CONFIRMED',
    ].includes(raw)
  ) {
    return PROVIDER_OUTCOMES.SUCCESS;
  }

  if (
    [
      'FAILURE',
      'FAILED',
      'REJECTED',
      'DECLINED',
      'DENIED',
      'CANCELLED',
      'CANCELED',
      'EXPIRED',
    ].includes(raw)
  ) {
    return PROVIDER_OUTCOMES.FAILURE;
  }

  if (
    [
      'PENDING',
      'PROCESSING',
      'INITIATED',
      'SUBMITTED',
      'QUEUED',
      'ACCEPTED',
      'PROVIDER_ACCEPTED',
    ].includes(raw)
  ) {
    return PROVIDER_OUTCOMES.PENDING;
  }

  if (
    [
      'AMBIGUOUS',
      'UNKNOWN',
      'TIMEOUT',
      'NO_RESPONSE',
      'INDETERMINATE',
    ].includes(raw)
  ) {
    return PROVIDER_OUTCOMES.AMBIGUOUS;
  }

  return PROVIDER_OUTCOMES.UNKNOWN;
};

const financialState = (
  financial = {},
) => {
  const status =
    upper(
      financial?.status ??
        financial?.outcome ??
        financial?.state,
    );

  if (
    financial?.verified === true ||
    financial?.confirmed === true ||
    financial?.settled === true ||
    financial?.posted === true ||
    [
      'SETTLED',
      'POSTED',
      'CONFIRMED',
      'SUCCESS',
      'SUCCEEDED',
      'COMPLETED',
    ].includes(status)
  ) {
    return 'CONFIRMED';
  }

  if (
    [
      'PENDING',
      'PROCESSING',
      'UNKNOWN',
      'AMBIGUOUS',
      'UNVERIFIED',
    ].includes(status)
  ) {
    return 'UNVERIFIED';
  }

  if (
    [
      'FAILED',
      'FAILURE',
      'REJECTED',
    ].includes(status)
  ) {
    return 'FAILED';
  }

  return 'NOT_PROVIDED';
};

export class AirtelSettlementTrackerError extends Error {
  constructor(
    message,
    code =
      'AIRTEL_SETTLEMENT_TRACKER_ERROR',
    details = {},
    options = {},
  ) {
    super(
      message,
      options.cause
        ? {
            cause:
              options.cause,
          }
        : undefined,
    );

    this.name =
      'AirtelSettlementTrackerError';

    this.code =
      code;

    this.component =
      COMPONENT;

    this.provider =
      PROVIDER;

    this.operation =
      options.operation ??
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
      Number.isInteger(
        options.httpStatus,
      )
        ? options.httpStatus
        : 400;
  }

  toJSON() {
    return {
      name:
        this.name,
      code:
        this.code,
      message:
        this.message,
      component:
        this.component,
      provider:
        this.provider,
      operation:
        this.operation,
      details:
        this.details,
      retryable:
        this.retryable,
      httpStatus:
        this.httpStatus,
    };
  }
}

export class SettlementTracker {
  constructor(options = {}) {
    if (
      !isPlain(options)
    ) {
      throw new AirtelSettlementTrackerError(
        'Settlement tracker options must be a plain object.',
        'SETTLEMENT_TRACKER_INVALID_OPTIONS',
        {},
        {
          httpStatus: 500,
        },
      );
    }

    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,
        ...(options.config ??
          options.configuration ??
          {}),
      });

    this.repository =
      options.repository ??
      options.settlementRepository ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.outboxService =
      options.outboxService ??
      null;

    this.eventPublisher =
      options.eventPublisher ??
      null;

    this.eventBus =
      options.eventBus ??
      this.eventPublisher ??
      this.outboxService ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.logger =
      options.logger ??
      null;

    this.tracer =
      options.tracer ??
      null;

    this.clock =
      options.clock ??
      {
        now: () =>
          Date.now(),
      };

    this.slaMonitor =
      options.slaMonitor ??
      null;

    this.idFactory =
      isFn(
        options.idFactory,
      )
        ? options.idFactory
        : () =>
            randomUUID();

    this.initialized =
      false;

    this.healthState = {
      status:
        'INITIALIZING',
      startedAt:
        nowDate(this.clock),
      lastActivity:
        null,
      lastError:
        null,
    };

    this.statistics = {
      tracked:
        0,
      transitions:
        0,
      idempotentTransitions:
        0,
      rejectedTransitions:
        0,
      failures:
        0,
      completed:
        0,
      reversed:
        0,
      cancelled:
        0,
      expired:
        0,
      reconciliationsRequired:
        0,
      reconciled:
        0,
      providerStatusSyncs:
        0,
      unknownProviderStatuses:
        0,
      providerEvents:
        0,
      providerEventConflicts:
        0,
      slaEvaluations:
        0,
      slaFailures:
        0,
      auditFailures:
        0,
      eventFailures:
        0,
      lookupFailures:
        0,
      createFailures:
        0,
      transitionFailures:
        0,
    };
  }

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelSettlementTrackerError(
      message,
      code,
      details,
      {
        ...options,
        operation:
          options.operation ??
          OPERATION,
        config:
          this.config,
      },
    );
  }

  #repositoryMethod(
    ...names
  ) {
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
        return {
          name,
          fn:
            this.repository[
              name
            ].bind(
              this.repository,
            ),
        };
      }
    }

    return null;
  }

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const fn =
        this.logger?.[
          level
        ] ??
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
      // Logging must never affect state.
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
      // Metrics are informational.
    }
  }

  #auditMethod() {
    return (
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write ??
      this.auditService?.createAuditLog
    );
  }

  #eventPublisher() {
    if (
      this.outboxService &&
      isFn(
        this.outboxService.publish,
      )
    ) {
      return this.outboxService;
    }

    if (
      this.eventPublisher &&
      isFn(
        this.eventPublisher.publish,
      )
    ) {
      return this.eventPublisher;
    }

    if (
      this.eventBus &&
      isFn(
        this.eventBus.publish,
      )
    ) {
      return this.eventBus;
    }

    if (
      this.eventBus &&
      isFn(
        this.eventBus.emit,
      )
    ) {
      return this.eventBus;
    }

    return null;
  }

  #providerStatusStatus(
    outcome,
  ) {
    return outcome ===
      PROVIDER_OUTCOMES.SUCCESS
      ? SETTLEMENT_STATUS.COMPLETED
      : outcome ===
          PROVIDER_OUTCOMES.FAILURE
        ? SETTLEMENT_STATUS.FAILED
        : outcome ===
            PROVIDER_OUTCOMES.PENDING
          ? SETTLEMENT_STATUS.PROCESSING
          : SETTLEMENT_STATUS.UNKNOWN;
  }

  async initialize() {
    this.validateDependencies();

    this.initialized =
      true;

    this.healthState.status =
      'READY';

    this.touchActivity();

    this.#metric(
      'airtel.disbursement.settlement_tracker.initialized.total',
    );

    return true;
  }

  async shutdown() {
    this.initialized =
      false;

    this.healthState.status =
      'STOPPING';

    this.touchActivity();

    return true;
  }

  normalizeContext(
    input = {},
    overrides = {},
  ) {
    if (
      !isPlain(input)
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_INVALID_INPUT',
        'Settlement tracker input must be a plain object.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const tenantId =
      this.requireTenantId(
        input.tenantId ??
          input.tenant?.id ??
          input.context?.tenantId,
      );

    const provider =
      upper(
        input.provider ??
          PROVIDER,
      );

    if (
      this.config
        .requireAirtelProvider &&
      provider !==
        PROVIDER
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_PROVIDER_SCOPE_VIOLATION',
        'Airtel settlement tracker accepts only AIRTEL.',
        {
          provider,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const operation =
      upper(
        input.operation ??
          OPERATION,
      );

    if (
      this.config
        .requireOperation &&
      !operation
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_OPERATION_REQUIRED',
        'Settlement tracking operation is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const settlementId =
      bounded(
        input.settlementId ??
          input.disbursementId ??
          input.commandId ??
          input.operationId,
        this.config
          .maxSettlementIdLength,
      );

    const requireSettlementId =
      overrides
        .requireSettlementId ??
      this.config
        .requireSettlementId;

    if (
      requireSettlementId &&
      !settlementId
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_SETTLEMENT_ID_REQUIRED',
        'settlementId is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const transactionId =
      bounded(
        input.transactionId ??
          input.financialTransactionId ??
          input.paymentId,
        this.config
          .maxTransactionIdLength,
      );

    const reference =
      bounded(
        input.reference ??
          input.paymentReference ??
          input.externalReference,
        this.config
          .maxReferenceLength,
      );

    const requireReference =
      overrides
        .requireReference ??
      this.config
        .requireReference;

    if (
      requireReference &&
      !reference
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_REFERENCE_REQUIRED',
        'reference is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const originalIdempotencyKey =
      bounded(
        input.originalIdempotencyKey ??
          input.idempotencyKey ??
          input.headers?.[
            'idempotency-key'
          ],
        this.config
          .maxIdempotencyKeyLength,
      );

    const requireOriginalIdempotencyKey =
      overrides
        .requireOriginalIdempotencyKey ??
      this.config
        .requireOriginalIdempotencyKey;

    if (
      requireOriginalIdempotencyKey &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_IDEMPOTENCY_KEY_REQUIRED',
        'originalIdempotencyKey is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const amountMinor =
      normalizeAmountMinor(
        input.amountMinor ??
          input.amountInMinorUnits ??
          input.amount,
      );

    const currency =
      normalizeCurrency(
        input.currency,
        this.config
          .defaultCurrency,
      );

    const providerReference =
      bounded(
        input.providerReference ??
          input.providerTransactionId ??
          input.externalProviderReference,
        this.config
          .maxProviderReferenceLength,
      );

    const providerTransactionId =
      bounded(
        input.providerTransactionId ??
          input.externalProviderId,
        this.config
          .maxTransactionIdLength,
      );

    const providerStatus =
      bounded(
        input.providerStatus ??
          input.providerState,
        128,
      );

    const providerOutcome =
      normalizeOutcome(
        input,
      );

    const financialSettlementState =
      upper(
        input.financialSettlementState ??
          financialState(
            input.financial,
          ),
      );

    const financialTransactionId =
      bounded(
        input.financialTransactionId ??
          input.financial
            ?.transactionId ??
          input.financial
            ?.financialTransactionId ??
          transactionId,
        this.config
          .maxTransactionIdLength,
      );

    const ledgerReference =
      bounded(
        input.ledgerReference ??
          input.financial
            ?.ledgerReference ??
          input.financial
            ?.ledgerEntryId ??
          input.financial
            ?.journalId,
        this.config
          .maxProviderReferenceLength,
      );

    const reconciliationState =
      upper(
        input.reconciliationState ??
          input.reconciliation
            ?.status,
      );

    const reconciliationReference =
      bounded(
        input.reconciliationReference ??
          input.reconciliation
            ?.reference,
        this.config
          .maxReferenceLength,
      );

    const settlementConfirmedAt =
      input.settlementConfirmedAt ??
      (
        financialSettlementState ===
          'CONFIRMED' &&
        (
          input.confirmedAt ||
          input.financial
            ?.confirmedAt
        )
          ? this.#date(
              input.confirmedAt ??
                input.financial
                  ?.confirmedAt,
            )
          : undefined
      );

    const actorTenant =
      bounded(
        input.actor?.tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      actorTenant &&
      actorTenant !==
        tenantId
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_TENANT_SCOPE_MISMATCH',
        'Actor tenant does not match settlement tenant.',
        {},
        {
          httpStatus: 403,
        },
      );
    }

    const correlationId =
      bounded(
        input.correlationId,
        this.config
          .maxCorrelationIdLength,
      ) ??
      `corr_${this.idFactory()}`;

    const executionId =
      bounded(
        input.executionId ??
          input.executionClaimId,
        this.config
          .maxExecutionIdLength,
      );

    const actorId =
      bounded(
        input.actorId ??
          input.actor?.actorId ??
          input.actor?.userId ??
          input.requestedBy,
        this.config
          .maxActorIdLength,
      );

    const status =
      upper(
        input.status ??
          input.nextStatus,
      );

    const metadata =
      sanitize(
        input.metadata ??
          {},
        0,
        this.config,
      );

    const reason =
      bounded(
        input.reason ??
          input.reasonCode,
        this.config
          .maxReasonLength,
      );

    const trackingFingerprint =
      bounded(
        input.trackingFingerprint,
        128,
      ) ??
      buildTrackingFingerprint({
        tenantId,
        provider,
        operation,
        settlementId,
        transactionId,
        reference,
        providerReference,
        amountMinor,
        currency,
        originalIdempotencyKey,
      });

    return {
      tenantId,
      provider,
      operation,
      settlementId,
      transactionId,
      reference,
      originalIdempotencyKey,
      amountMinor,
      currency,
      providerReference,
      providerTransactionId,
      providerStatus,
      providerOutcome,
      financialSettlementState,
      financialTransactionId,
      ledgerReference,
      reconciliationState,
      reconciliationReference,
      settlementConfirmedAt,
      correlationId,
      executionId,
      actorId,
      metadata,
      reason,
      status,
      trackingFingerprint,
      targetStatus:
        upper(
          input.targetStatus ??
            input.trackingStatus,
        ),
      attempts:
        Number.isInteger(
          input.attempts,
        )
          ? Math.max(
              0,
              input.attempts,
            )
          : undefined,
      session:
        input.session ??
        null,
    };
  }

  #date(value) {
    const date =
      value instanceof Date
        ? new Date(
            value.getTime(),
          )
        : new Date(value);

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      this.#throw(
        'SETTLEMENT_INVALID_TIMESTAMP',
        'Settlement timestamp is invalid.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    return date;
  }

  requireTenantId(
    tenantId,
  ) {
    const id =
      bounded(
        tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (!id) {
      this.#throw(
        'SETTLEMENT_TRACKER_TENANT_REQUIRED',
        'tenantId is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    return id;
  }

  async create(
    input = {},
  ) {
    const span =
      this.startSpan(
        'titech.airtel.disbursement.settlement_tracker.create',
        input,
      );

    try {
      const context =
        this.normalizeContext(
          input,
          {
            requireSettlementId:
              true,
          },
        );

      const existing =
        await this.#findExisting(
          context,
        );

      if (existing) {
        if (
          existing.trackingFingerprint &&
          existing.trackingFingerprint !==
            context.trackingFingerprint
        ) {
          this.statistics
            .providerEventConflicts++;

          this.#throw(
            'SETTLEMENT_TRACKER_IDENTITY_CONFLICT',
            'Settlement identity is already bound to a different tracking intent.',
            {
              settlementId:
                context.settlementId,
            },
            {
              httpStatus: 409,
              operation:
                context.operation,
            },
          );
        }

        this.statistics
          .idempotentTransitions++;

        return this.#project(
          existing,
        );
      }

      const status =
        context.status ??
        SETTLEMENT_STATUS.CREATED;

      if (
        !knownStatus(status)
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_INVALID_STATUS',
          `Invalid settlement tracking status ${status}.`,
          {
            status,
          },
          {
            httpStatus: 422,
          },
        );
      }

      const now =
        nowDate(
          this.clock,
        );

      const record =
        this.#buildRecord(
          context,
          status,
          now,
        );

      const saved =
        await this.#createRepositoryRecord(
          record,
          context,
        );

      this.statistics.tracked++;
      this.touchActivity();

      await this.#recordAudit(
        'SETTLEMENT_TRACKING_CREATED',
        saved,
        context,
      );

      await this.publishTransitionEvent({
        tenantId:
          context.tenantId,
        settlementId:
          context.settlementId,
        transactionId:
          context.transactionId,
        previousStatus:
          null,
        status,
        correlationId:
          context.correlationId,
        executionId:
          context.executionId,
        reason:
          context.reason ??
          'TRACKING_CREATED',
        providerStatus:
          context.providerStatus,
      });

      await this.evaluateSLAAfterTransition({
        tenantId:
          context.tenantId,
        settlementId:
          context.settlementId,
        status,
        correlationId:
          context.correlationId,
      });

      this.#metric(
        'airtel.disbursement.settlement_tracker.created.total',
      );

      return this.#project(
        saved,
      );
    } catch (error) {
      if (
        operationalFailure(error)
      ) {
        this.statistics
          .createFailures++;

        this.statistics
          .failures++;
      }

      this.setHealthError(
        error,
      );

      this.#metric(
        'airtel.disbursement.settlement_tracker.create.failure.total',
      );

      if (
        error instanceof
        AirtelSettlementTrackerError
      ) {
        throw error;
      }

      this.#throw(
        'SETTLEMENT_TRACKER_CREATE_FAILED',
        'Airtel settlement tracking record creation failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    } finally {
      span?.end?.();
    }
  }

  register(
    input = {},
  ) {
    return this.create({
      ...input,
      settlementId:
        input.settlementId ??
        input.disbursementId ??
        input.transactionId ??
        input.reference,
      status:
        input.status ??
        SETTLEMENT_STATUS.PENDING,
      amountMinor:
        input.amountMinor ??
        input.amountInMinorUnits ??
        input.amount,
      providerReference:
        input.providerReference ??
        input.providerTransactionId,
    });
  }

  async recordProviderSettlement(
    input = {},
  ) {
    const context =
      this.#normalizeProviderRecordInput(
        input,
      );

    let record =
      await this.#findExisting(
        context,
      );

    if (!record) {
      if (
        !this.config
          .allowCreateFromProviderEvent
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_PROVIDER_RECORD_NOT_FOUND',
          'Provider settlement tracking record does not exist and automatic creation is disabled.',
          {},
          {
            httpStatus: 404,
          },
        );
      }

      record =
        await this.create({
          ...context,
          status:
            context.status ??
            context.targetStatus ??
            this.#providerStatusStatus(
              context.providerOutcome,
            ),
        });
    }

    this.#assertIdentityCompatible(
      record,
      context,
    );

    const currentStatus =
      upper(
        record.status,
      ) ??
      SETTLEMENT_STATUS.UNKNOWN;

    const targetStatus =
      context.targetStatus ??
      this.#providerStatusStatus(
        context.providerOutcome,
      );

    if (
      !knownStatus(
        targetStatus,
      )
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_INVALID_STATUS',
        `Invalid settlement tracking status ${targetStatus}.`,
        {
          status:
            targetStatus,
        },
        {
          httpStatus: 422,
        },
      );
    }

    if (
      targetStatus &&
      currentStatus !==
        targetStatus
    ) {
      if (
        terminal(
          currentStatus,
        ) &&
        !this.config
          .allowPostTerminalReconciliation
      ) {
        return this.#providerResult(
          record,
          context,
          false,
          'TRACKING_ALREADY_TERMINAL',
        );
      }

      record =
        await this.transition({
          ...context,
          settlementId:
            extractRecordId(
              record,
            ),
          nextStatus:
            targetStatus,
          providerOutcome:
            context.providerOutcome,
          providerStatus:
            context.providerStatus,
          metadata:
            context.metadata,
          reason:
            context.reason ??
            'PROVIDER_SETTLEMENT_SYNC',
        });
    } else {
      record =
        await this.#updateEvidence(
          record,
          context,
          {
            allowTimeline:
              true,
          },
        );
    }

    this.statistics
      .providerEvents++;

    this.touchActivity();

    return this.#providerResult(
      record,
      context,
      true,
    );
  }

  recordSettlement(
    input = {},
  ) {
    return this.recordProviderSettlement(
      input,
    );
  }

  track(
    input = {},
  ) {
    return this.recordProviderSettlement(
      input,
    );
  }

  async transition(
    input = {},
  ) {
    const span =
      this.startSpan(
        'titech.airtel.disbursement.settlement_tracker.transition',
        input,
      );

    try {
      const context =
        this.normalizeContext(
          input,
          {
            requireSettlementId:
              true,
            requireOriginalIdempotencyKey:
              false,
            requireReference:
              false,
          },
        );

      const nextStatus =
        upper(
          input.nextStatus ??
            input.status,
        );

      if (
        !nextStatus ||
        !knownStatus(
          nextStatus,
        )
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_INVALID_STATUS',
          'A valid settlement nextStatus is required.',
          {
            status:
              nextStatus,
          },
          {
            httpStatus: 422,
          },
        );
      }

      const current =
        await this.findBySettlementId({
          tenantId:
            context.tenantId,
          settlementId:
            context.settlementId,
          session:
            context.session,
        });

      if (!current) {
        this.#throw(
          'SETTLEMENT_TRACKER_NOT_FOUND',
          'Settlement tracking record was not found within tenant scope.',
          {
            settlementId:
              context.settlementId,
          },
          {
            httpStatus: 404,
          },
        );
      }

      const currentStatus =
        upper(
          current.status,
        ) ??
        SETTLEMENT_STATUS.UNKNOWN;

      if (
        currentStatus ===
        nextStatus
      ) {
        this.statistics
          .idempotentTransitions++;

        if (
          this.config
            .eventOnIdempotentTransition
        ) {
          await this.publishTransitionEvent({
            tenantId:
              context.tenantId,
            settlementId:
              context.settlementId,
            transactionId:
              context.transactionId ??
              current.transactionId,
            previousStatus:
              currentStatus,
            status:
              nextStatus,
            correlationId:
              context.correlationId,
            executionId:
              context.executionId,
            reason:
              context.reason ??
              'IDEMPOTENT_STATUS_REPLAY',
            providerStatus:
              context.providerStatus,
          });
        }

        return this.#project(
          await this.#updateEvidence(
            current,
            context,
            {
              allowTimeline:
                false,
            },
          ),
        );
      }

      if (
        currentStatus ===
          SETTLEMENT_STATUS.UNKNOWN &&
        !this.config
          .allowTransitionFromUnknown
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_UNKNOWN_STATE_REQUIRES_REVIEW',
          'UNKNOWN settlement state requires review before progression.',
          {},
          {
            httpStatus: 409,
            retryable: true,
          },
        );
      }

      if (
        terminal(
          currentStatus,
        ) &&
        !this.config
          .allowPostTerminalReconciliation
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_TERMINAL_STATE',
          `Terminal settlement state ${currentStatus} cannot transition to ${nextStatus}.`,
          {
            currentStatus,
            nextStatus,
          },
          {
            httpStatus: 409,
          },
        );
      }

      if (
        !canTransitionState(
          currentStatus,
          nextStatus,
        )
      ) {
        this.statistics
          .rejectedTransitions++;

        this.#throw(
          'AIRTEL_SETTLEMENT_INVALID_STATE_TRANSITION',
          `Invalid Airtel settlement transition ${currentStatus} -> ${nextStatus}.`,
          {
            tenantId:
              context.tenantId,
            settlementId:
              context.settlementId,
            currentStatus,
            nextStatus,
          },
          {
            httpStatus: 409,
          },
        );
      }

      const now =
        nowDate(
          this.clock,
        );

      const result =
        await this.#applyTransition({
          tenantId:
            context.tenantId,
          settlementId:
            context.settlementId,
          current,
          currentStatus,
          nextStatus,
          context,
          now,
          timelineEntry:
            this.#timelineEntry(
              currentStatus,
              nextStatus,
              context,
              now,
            ),
        });

      this.statistics
        .transitions++;

      this.touchActivity();

      if (
        nextStatus ===
        SETTLEMENT_STATUS.COMPLETED
      ) {
        this.statistics
          .completed++;
      }

      if (
        nextStatus ===
        SETTLEMENT_STATUS.FAILED
      ) {
        this.statistics
          .failures++;
      }

      if (
        nextStatus ===
        SETTLEMENT_STATUS.REVERSED
      ) {
        this.statistics
          .reversed++;
      }

      if (
        nextStatus ===
        SETTLEMENT_STATUS.CANCELLED
      ) {
        this.statistics
          .cancelled++;
      }

      if (
        nextStatus ===
        SETTLEMENT_STATUS.EXPIRED
      ) {
        this.statistics
          .expired++;
      }

      if (
        nextStatus ===
        SETTLEMENT_STATUS.RECONCILIATION_REQUIRED
      ) {
        this.statistics
          .reconciliationsRequired++;
      }

      if (
        nextStatus ===
        SETTLEMENT_STATUS.RECONCILED
      ) {
        this.statistics
          .reconciled++;
      }

      await this.#recordAudit(
        'SETTLEMENT_TRACKING_STATUS_CHANGED',
        result,
        context,
      );

      await this.publishTransitionEvent({
        tenantId:
          context.tenantId,
        settlementId:
          context.settlementId,
        transactionId:
          context.transactionId ??
          result.transactionId,
        previousStatus:
          currentStatus,
        status:
          nextStatus,
        correlationId:
          context.correlationId,
        executionId:
          context.executionId,
        reason:
          context.reason ??
          'STATUS_TRANSITION',
        providerStatus:
          context.providerStatus,
      });

      await this.evaluateSLAAfterTransition({
        tenantId:
          context.tenantId,
        settlementId:
          context.settlementId,
        status:
          nextStatus,
        correlationId:
          context.correlationId,
      });

      this.#metric(
        'airtel.disbursement.settlement_tracker.transition.total',
      );

      return this.#project(
        result,
      );
    } catch (error) {
      if (
        operationalFailure(error)
      ) {
        this.statistics
          .transitionFailures++;

        this.statistics
          .failures++;
      }

      this.setHealthError(
        error,
      );

      this.#metric(
        'airtel.disbursement.settlement_tracker.transition.failure.total',
      );

      if (
        error instanceof
        AirtelSettlementTrackerError
      ) {
        throw error;
      }

      this.#throw(
        'SETTLEMENT_TRACKER_TRANSITION_FAILED',
        'Airtel settlement state transition failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    } finally {
      span?.end?.();
    }
  }

  synchronizeProviderStatus(
    input = {},
  ) {
    const providerStatus =
      bounded(
        input.providerStatus ??
          input.status ??
          input.providerOutcome,
        128,
      );

    if (!providerStatus) {
      this.#throw(
        'SETTLEMENT_TRACKER_PROVIDER_STATUS_REQUIRED',
        'providerStatus is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    this.statistics
      .providerStatusSyncs++;

    const mapped =
      PROVIDER_STATUS_MAPPING[
        upper(
          providerStatus,
        )
      ];

    if (!mapped) {
      this.statistics
        .unknownProviderStatuses++;

      this.#metric(
        'airtel.disbursement.settlement_tracker.unknown_provider_status.total',
      );

      return this.transition({
        ...input,
        nextStatus:
          SETTLEMENT_STATUS.UNKNOWN,
        providerStatus,
        providerOutcome:
          PROVIDER_OUTCOMES.AMBIGUOUS,
        reason:
          input.reason ??
          'PROVIDER_STATUS_UNMAPPED',
      });
    }

    return this.transition({
      ...input,
      nextStatus:
        mapped,
      providerStatus,
      providerOutcome:
        normalizeOutcome({
          providerStatus,
        }),
      reason:
        input.reason ??
        'PROVIDER_STATUS_SYNC',
    });
  }

  processProviderResult(
    input = {},
  ) {
    return this.recordProviderSettlement(
      input,
    );
  }

  markReconciliationRequired(
    input = {},
  ) {
    return this.transition({
      ...input,
      nextStatus:
        SETTLEMENT_STATUS.RECONCILIATION_REQUIRED,
      reason:
        input.reason ??
        'RECONCILIATION_REQUIRED',
      reconciliationState:
        input.reconciliationState ??
        'REQUIRED',
    });
  }

  markReconciling(
    input = {},
  ) {
    return this.transition({
      ...input,
      nextStatus:
        SETTLEMENT_STATUS.RECONCILING,
      reason:
        input.reason ??
        'RECONCILIATION_STARTED',
      reconciliationState:
        input.reconciliationState ??
        'IN_PROGRESS',
    });
  }

  markReconciled(
    input = {},
  ) {
    return this.transition({
      ...input,
      nextStatus:
        SETTLEMENT_STATUS.RECONCILED,
      reason:
        input.reason ??
        'RECONCILIATION_CONFIRMED',
      reconciliationState:
        input.reconciliationState ??
        'CONFIRMED',
    });
  }

  async findBySettlementId({
    tenantId,
    settlementId,
    session = null,
  } = {}) {
    const tid =
      this.requireTenantId(
        tenantId,
      );

    const sid =
      bounded(
        settlementId,
        this.config
          .maxSettlementIdLength,
      );

    if (!sid) {
      this.#throw(
        'SETTLEMENT_TRACKER_SETTLEMENT_ID_REQUIRED',
        'settlementId is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    try {
      const m =
        this.#repositoryMethod(
          'findBySettlementIdForTenant',
          'findOneForTenant',
          'findOne',
          'findBySettlementId',
        );

      if (!m) {
        this.#throw(
          'SETTLEMENT_TRACKER_LOOKUP_UNAVAILABLE',
          'Settlement repository lookup is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      let result;

      if (
        m.name ===
        'findBySettlementIdForTenant'
      ) {
        result =
          await m.fn(
            tid,
            sid,
            {
              session,
            },
          );
      } else if (
        m.name ===
        'findOneForTenant'
      ) {
        result =
          await m.fn(
            tid,
            {
              settlementId:
                sid,
              provider:
                PROVIDER,
              operation:
                OPERATION,
            },
            {
              session,
            },
          );
      } else if (
        m.name ===
        'findOne'
      ) {
        result =
          await m.fn(
            {
              tenantId:
                tid,
              provider:
                PROVIDER,
              operation:
                OPERATION,
              settlementId:
                sid,
            },
            {
              session,
            },
          );
      } else {
        result =
          await m.fn(
            sid,
            {
              tenantId:
                tid,
              provider:
                PROVIDER,
              operation:
                OPERATION,
              session,
            },
          );
      }

      this.touchActivity();

      return result
        ? this.#project(
            result,
          )
        : null;
    } catch (error) {
      if (
        error instanceof
        AirtelSettlementTrackerError
      ) {
        throw error;
      }

      this.statistics
        .lookupFailures++;

      this.setHealthError(
        error,
      );

      this.#throw(
        'SETTLEMENT_TRACKER_LOOKUP_FAILED',
        'Settlement tracking lookup failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    }
  }

  async findByReference({
    tenantId,
    reference,
    session = null,
  } = {}) {
    return this.#genericLookup(
      'findByReferenceForTenant',
      'findByReference',
      tenantId,
      reference,
      'reference',
      session,
    );
  }

  async findByProviderReference({
    tenantId,
    providerReference,
    session = null,
  } = {}) {
    return this.#genericLookup(
      'findByProviderReferenceForTenant',
      'findByProviderReference',
      tenantId,
      providerReference,
      'providerReference',
      session,
    );
  }

  async findByIdempotencyKey({
    tenantId,
    originalIdempotencyKey,
    session = null,
  } = {}) {
    return this.#genericLookup(
      'findByIdempotencyKeyForTenant',
      'findByIdempotencyKey',
      tenantId,
      originalIdempotencyKey,
      'originalIdempotencyKey',
      session,
    );
  }

  async #genericLookup(
    tenantMethod,
    legacyMethod,
    tenantId,
    value,
    field,
    session,
  ) {
    const tid =
      this.requireTenantId(
        tenantId,
      );

    const maxLength =
      field ===
      'originalIdempotencyKey'
        ? this.config
            .maxIdempotencyKeyLength
        : field ===
            'providerReference'
          ? this.config
              .maxProviderReferenceLength
          : this.config
              .maxReferenceLength;

    const normalized =
      bounded(
        value,
        maxLength,
      );

    if (!normalized) {
      this.#throw(
        'SETTLEMENT_TRACKER_REQUIRED_LOOKUP_VALUE',
        `${field} is required.`,
        {
          field,
        },
        {
          httpStatus: 422,
        },
      );
    }

    const m =
      this.#repositoryMethod(
        tenantMethod,
        legacyMethod,
      );

    if (!m) {
      return null;
    }

    try {
      const result =
        m.name ===
        tenantMethod
          ? await m.fn(
              tid,
              normalized,
              {
                provider:
                  PROVIDER,
                operation:
                  OPERATION,
                session,
              },
            )
          : await m.fn(
              normalized,
              {
                tenantId:
                  tid,
                provider:
                  PROVIDER,
                operation:
                  OPERATION,
                session,
              },
            );

      return result
        ? this.#project(
            result,
          )
        : null;
    } catch (error) {
      this.setHealthError(
        error,
      );

      this.#throw(
        `SETTLEMENT_TRACKER_${field.toUpperCase()}_LOOKUP_FAILED`,
        `Settlement ${field} lookup failed.`,
        {},
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    }
  }

  async timeline(
    settlementId,
    {
      tenantId,
      session = null,
    } = {},
  ) {
    const tid =
      this.requireTenantId(
        tenantId,
      );

    const sid =
      bounded(
        settlementId,
        this.config
          .maxSettlementIdLength,
      );

    if (!sid) {
      this.#throw(
        'SETTLEMENT_TRACKER_SETTLEMENT_ID_REQUIRED',
        'settlementId is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const m =
      this.#repositoryMethod(
        'getTimelineForTenant',
        'getTimeline',
      );

    if (m) {
      const result =
        m.name ===
        'getTimelineForTenant'
          ? await m.fn(
              tid,
              sid,
              {
                session,
              },
            )
          : await m.fn(
              sid,
              {
                tenantId:
                  tid,
                provider:
                  PROVIDER,
                operation:
                  OPERATION,
                session,
              },
            );

      return Array.isArray(
        result,
      )
        ? clone(result)
        : [];
    }

    const record =
      await this.findBySettlementId({
        tenantId:
          tid,
        settlementId:
          sid,
        session,
      });

    return Array.isArray(
      record?.timeline,
    )
      ? clone(
          record.timeline,
        )
      : [];
  }

  async evaluateSLA({
    settlementId,
    tenantId,
    correlationId = null,
  } = {}) {
    const tid =
      this.requireTenantId(
        tenantId,
      );

    const sid =
      bounded(
        settlementId,
        this.config
          .maxSettlementIdLength,
      );

    if (!sid) {
      this.#throw(
        'SETTLEMENT_TRACKER_SETTLEMENT_ID_REQUIRED',
        'settlementId is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    if (
      !this.slaMonitor ||
      !isFn(
        this.slaMonitor
          .evaluate,
      )
    ) {
      return null;
    }

    try {
      const result =
        await this.slaMonitor
          .evaluate({
            tenantId:
              tid,
            settlementId:
              sid,
            provider:
              PROVIDER,
            operation:
              OPERATION,
            correlationId:
              bounded(
                correlationId,
                this.config
                  .maxCorrelationIdLength,
              ),
          });

      this.statistics
        .slaEvaluations++;

      return sanitize(
        result,
        0,
        this.config,
      );
    } catch (error) {
      this.statistics
        .slaFailures++;

      this.#metric(
        'airtel.disbursement.settlement_tracker.sla.failure.total',
      );

      this.#log(
        'warn',
        'Airtel settlement SLA evaluation failed.',
        {
          tenantId:
            tid,
          settlementId:
            sid,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnSlaError
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_SLA_UNAVAILABLE',
          'Settlement SLA evaluation is unavailable.',
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

  evaluateSLAAfterTransition(
    input = {},
  ) {
    return this.config
      .evaluateSla
      ? this.evaluateSLA(
          input,
        )
      : null;
  }

  async publishTransitionEvent({
    tenantId,
    settlementId,
    transactionId = null,
    previousStatus,
    status,
    correlationId = null,
    executionId = null,
    reason = null,
    providerStatus = null,
  } = {}) {
    if (
      !this.config
        .publishEvents
    ) {
      return false;
    }

    const publisher =
      this.#eventPublisher();

    if (!publisher) {
      return false;
    }

    const event = {
      eventId:
        this.idFactory(),

      type:
        'AIRTEL_DISBURSEMENT_SETTLEMENT_STATUS_CHANGED',

      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      version:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      occurredAt:
        nowIso(
          this.clock,
        ),

      tenantId:
        bounded(
          tenantId,
          this.config
            .maxTenantIdLength,
        ),

      settlementId:
        bounded(
          settlementId,
          this.config
            .maxSettlementIdLength,
        ),

      transactionId:
        bounded(
          transactionId,
          this.config
            .maxTransactionIdLength,
        ),

      correlationId:
        bounded(
          correlationId,
          this.config
            .maxCorrelationIdLength,
        ),

      executionId:
        bounded(
          executionId,
          this.config
            .maxExecutionIdLength,
        ),

      payload: {
        previousStatus:
          upper(
            previousStatus,
          ),

        status:
          upper(status),

        reason:
          bounded(
            reason,
            this.config
              .maxReasonLength,
          ),

        providerStatus:
          bounded(
            providerStatus,
            128,
          ),
      },
    };

    try {
      const method =
        isFn(
          publisher.publish,
        )
          ? publisher.publish.bind(
              publisher,
            )
          : publisher.emit.bind(
              publisher,
            );

      await method(event);

      this.#metric(
        'airtel.disbursement.settlement_tracker.event.published.total',
      );

      return true;
    } catch (error) {
      this.statistics
        .eventFailures++;

      this.#metric(
        'airtel.disbursement.settlement_tracker.event.publish.failure.total',
      );

      this.#log(
        'error',
        'Airtel settlement tracker event publication failed.',
        {
          tenantId,
          settlementId,
          transactionId,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_EVENT_PUBLICATION_FAILED',
          'Settlement tracker event publication failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return false;
    }
  }

  isTerminal(
    status,
  ) {
    return terminal(
      status,
    );
  }

  canTransition(
    currentStatus,
    nextStatus,
  ) {
    return canTransitionState(
      currentStatus,
      nextStatus,
    );
  }

  createTransitionError({
    tenantId,
    settlementId,
    currentStatus,
    nextStatus,
  } = {}) {
    return new AirtelSettlementTrackerError(
      `Invalid Airtel settlement transition ${currentStatus} -> ${nextStatus}.`,
      'AIRTEL_SETTLEMENT_INVALID_STATE_TRANSITION',
      {
        tenantId,
        settlementId,
        currentStatus,
        nextStatus,
      },
      {
        httpStatus: 409,
      },
    );
  }

  validateDependencies() {
    if (!this.repository) {
      this.#throw(
        'SETTLEMENT_TRACKER_REPOSITORY_REQUIRED',
        'Settlement repository is required.',
        {},
        {
          httpStatus: 500,
        },
      );
    }

    if (
      !this.#repositoryMethod(
        'findBySettlementIdForTenant',
        'findOneForTenant',
        'findOne',
        'findBySettlementId',
      )
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_LOOKUP_REQUIRED',
        'Tenant-scoped settlement lookup is required.',
        {},
        {
          httpStatus: 500,
        },
      );
    }

    if (
      !this.#repositoryMethod(
        'createForTenant',
        'createSettlementForTenant',
        'create',
        'insert',
      )
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_CREATE_REQUIRED',
        'Settlement repository create operation is required.',
        {},
        {
          httpStatus: 500,
        },
      );
    }

    if (
      !this.#repositoryMethod(
        'compareAndSetStatus',
        'atomicTransition',
        'compareAndSetTransition',
        'transitionStatus',
        'updateForTenant',
        'updateSettlementForTenant',
        'updateById',
        'update',
        'patch',
      )
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_TRANSITION_REQUIRED',
        'Settlement repository transition/update operation is required.',
        {},
        {
          httpStatus: 500,
        },
      );
    }

    return true;
  }

  async health() {
    const repo =
      Boolean(
        this.repository,
      );

    const lookup =
      repo &&
      Boolean(
        this.#repositoryMethod(
          'findBySettlementIdForTenant',
          'findOneForTenant',
          'findOne',
          'findBySettlementId',
        ),
      );

    const create =
      repo &&
      Boolean(
        this.#repositoryMethod(
          'createForTenant',
          'createSettlementForTenant',
          'create',
          'insert',
        ),
      );

    const atomic =
      repo &&
      Boolean(
        this.#repositoryMethod(
          'compareAndSetStatus',
          'atomicTransition',
          'compareAndSetTransition',
          'transitionStatus',
        ),
      );

    const update =
      repo &&
      Boolean(
        this.#repositoryMethod(
          'updateForTenant',
          'updateSettlementForTenant',
          'updateById',
          'update',
          'patch',
        ),
      );

    const audit =
      !this.auditService ||
      Boolean(
        this.#auditMethod(),
      );

    const events =
      Boolean(
        this.#eventPublisher(),
      );

    const sla =
      !this.slaMonitor ||
      isFn(
        this.slaMonitor
          .evaluate,
      );

    const healthy =
      repo &&
      lookup &&
      create &&
      (
        atomic ||
        !this.config
          .requireAtomicTransitionForConcurrentWrites
      ) &&
      audit &&
      sla &&
      (
        !this.initialized ||
        [
          'READY',
          'UP',
        ].includes(
          this.healthState.status,
        )
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

      schemaVersion:
        SCHEMA_VERSION,

      status:
        healthy
          ? 'UP'
          : 'DEGRADED',

      healthy,

      initialized:
        this.initialized,

      startedAt:
        this.healthState
          .startedAt,

      lastActivity:
        this.healthState
          .lastActivity,

      lastError:
        this.healthState
          .lastError,

      dependencies: {
        repository:
          repo,

        repositoryLookup:
          lookup,

        repositoryCreate:
          create,

        repositoryAtomicTransition:
          atomic,

        repositoryUpdateTransition:
          update,

        audit,

        eventPublisher:
          events,

        slaMonitor:
          sla,
      },

      controls: {
        tenantIsolation:
          this.config
            .requireTenantId,

        originalIdempotencyOptionalByDefault:
          !this.config
            .requireOriginalIdempotencyKey,

        ambiguousOutcomePreserved:
          true,

        financialSettlementAuthority:
          false,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,

        directProviderCall:
          false,
      },

      statistics:
        this.stats(),
    };
  }

  readiness() {
    return this.health();
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantScoped:
        true,

      deterministicTrackingFingerprint:
        true,

      originalIdempotencyPreserved:
        true,

      duplicateCreateProtection:
        true,

      optimisticConcurrency:
        true,

      atomicTransitionPreferred:
        true,

      ambiguousOutcomeTracked:
        true,

      reconciliationEvidenceSeparated:
        true,

      financialSettlementFinality:
        false,

      directProviderCalls:
        false,

      directLedgerWrites:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      rawProviderPayloadPersistence:
        false,

      auditProjection:
        Boolean(
          this.auditService,
        ),

      outboxOrEventProjection:
        Boolean(
          this.eventBus ||
          this.outboxService ||
          this.eventPublisher,
        ),
    });
  }

  async diagnostics() {
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

      status:
        await this.health(),

      capabilities:
        this.capabilities(),

      stateModel: {
        statuses:
          Object.values(
            SETTLEMENT_STATUS,
          ),

        terminalStates:
          [
            ...TERMINAL_STATES,
          ],

        activeStates:
          [
            ...ACTIVE_STATES,
          ],
      },

      accountingBoundary: {
        ledgerWrites:
          false,

        balanceMutation:
          false,

        walletMutation:
          false,

        finalityAuthority:
          'TITECH_FINANCIAL_CORE / RECONCILIATION',
      },
    };
  }

  stats() {
    return {
      ...this.statistics,
    };
  }

  snapshot() {
    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      initialized:
        this.initialized,

      statistics:
        this.stats(),

      health:
        clone(
          this.healthState,
        ),
    };
  }

  #normalizeProviderRecordInput(
    input,
  ) {
    const outcome =
      normalizeOutcome(
        input,
      );

    const context =
      this.normalizeContext(
        {
          ...input,

          providerOutcome:
            outcome,

          status:
            input.status ??
            input.trackingStatus,

          settlementId:
            input.settlementId ??
            input.disbursementId ??
            input.transactionId ??
            input.reference,
        },
        {
          requireSettlementId:
            false,

          requireOriginalIdempotencyKey:
            false,

          requireReference:
            false,
        },
      );

    const targetStatus =
      upper(
        input.targetStatus ??
          input.trackingStatus,
      ) ??
      this.#providerStatusStatus(
        outcome,
      );

    if (
      this.config
        .requireProviderReferenceForProviderRecord &&
      !context.providerReference
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_PROVIDER_REFERENCE_REQUIRED',
        'providerReference is required for a provider settlement event.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    if (
      !context.settlementId
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_IDENTITY_REQUIRED',
        'A stable settlement, disbursement, transaction or reference identity is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    return {
      ...context,

      status:
        context.status ??
        targetStatus,

      targetStatus,

      providerOutcome:
        outcome,
    };
  }

  #buildRecord(
    context,
    status,
    now,
  ) {
    return {
      settlementId:
        context.settlementId,

      tenantId:
        context.tenantId,

      provider:
        PROVIDER,

      operation:
        context.operation,

      providerReference:
        context.providerReference,

      providerTransactionId:
        context.providerTransactionId,

      transactionId:
        context.transactionId,

      reference:
        context.reference,

      amountMinor:
        context.amountMinor,

      currency:
        context.currency,

      originalIdempotencyKey:
        context.originalIdempotencyKey,

      correlationId:
        context.correlationId,

      executionId:
        context.executionId,

      status,

      providerOutcome:
        context.providerOutcome,

      providerStatus:
        context.providerStatus,

      financialSettlementState:
        context.financialSettlementState,

      financialTransactionId:
        context.financialTransactionId,

      ledgerReference:
        context.ledgerReference,

      reconciliationState:
        context.reconciliationState,

      reconciliationReference:
        context.reconciliationReference,

      settlementConfirmedAt:
        context.settlementConfirmedAt,

      trackingFingerprint:
        context.trackingFingerprint,

      version:
        1,

      attempts:
        context.attempts ??
        0,

      metadata:
        context.metadata,

      timeline: [
        this.#timelineEntry(
          null,
          status,
          context,
          now,
        ),
      ],

      createdAt:
        now,

      updatedAt:
        now,
    };
  }

  #timelineEntry(
    previousStatus,
    status,
    context,
    now,
  ) {
    return {
      eventId:
        this.idFactory(),

      previousStatus:
        upper(
          previousStatus,
        ),

      status:
        upper(status),

      timestamp:
        now,

      provider:
        PROVIDER,

      providerStatus:
        bounded(
          context.providerStatus,
          128,
        ),

      providerOutcome:
        upper(
          context.providerOutcome,
        ),

      financialSettlementState:
        upper(
          context.financialSettlementState,
        ),

      reconciliationState:
        upper(
          context.reconciliationState,
        ),

      reason:
        bounded(
          context.reason,
          this.config
            .maxReasonLength,
        ),

      correlationId:
        bounded(
          context.correlationId,
          this.config
            .maxCorrelationIdLength,
        ),

      executionId:
        bounded(
          context.executionId,
          this.config
            .maxExecutionIdLength,
        ),

      actorId:
        bounded(
          context.actorId,
          this.config
            .maxActorIdLength,
        ),

      metadata:
        this.#timelineMetadata(
          context.metadata,
        ),
    };
  }

  #timelineMetadata(
    metadata,
  ) {
    const safe =
      sanitize(
        metadata ??
          {},
        0,
        this.config,
      );

    return isPlain(safe)
      ? Object.fromEntries(
          Object.entries(
            safe,
          ).slice(
            0,
            this.config
              .maxTimelineMetadataKeys,
          ),
        )
      : {};
  }

  #project(
    record,
  ) {
    if (!record) {
      return null;
    }

    const out =
      clone(record) ??
      {};

    for (
      const key of [
        'providerResponse',
        'providerRequest',
        'rawProviderResponse',
        'rawProviderRequest',
        'credentials',
        'secret',
        'token',
      ]
    ) {
      delete out[key];
    }

    if (
      Array.isArray(
        out.timeline,
      )
    ) {
      out.timeline =
        out.timeline.map(
          (entry) =>
            sanitize(
              entry,
              0,
              this.config,
            ),
        );
    }

    out.provider =
      PROVIDER;

    out.operation =
      out.operation ??
      OPERATION;

    out.schemaVersion =
      SCHEMA_VERSION;

    return out;
  }

  #providerResult(
    record,
    context,
    accepted,
    reason = null,
  ) {
    const r =
      this.#project(
        record,
      );

    return {
      accepted:
        accepted !== false,

      tracked:
        true,

      idempotent:
        Boolean(
          r.status ===
            context.targetStatus,
        ),

      status:
        r.status,

      state:
        r.status,

      outcome:
        r.status ===
        SETTLEMENT_STATUS.COMPLETED
          ? 'SUCCESS'
          : r.status ===
              SETTLEMENT_STATUS.FAILED
            ? 'FAILURE'
            : r.status ===
                SETTLEMENT_STATUS.UNKNOWN
              ? 'AMBIGUOUS'
              : 'PENDING',

      tenantId:
        r.tenantId,

      settlementId:
        r.settlementId,

      disbursementId:
        r.settlementId,

      transactionId:
        r.transactionId,

      reference:
        r.reference,

      provider:
        PROVIDER,

      providerReference:
        r.providerReference,

      originalIdempotencyKey:
        r.originalIdempotencyKey,

      providerOutcome:
        r.providerOutcome,

      providerStatus:
        r.providerStatus,

      financialSettlementState:
        r.financialSettlementState,

      financialTransactionId:
        r.financialTransactionId,

      ledgerReference:
        r.ledgerReference,

      reconciliationState:
        r.reconciliationState,

      reconciliationReference:
        r.reconciliationReference,

      trackingFingerprint:
        r.trackingFingerprint,

      reason,

      evidence: {
        status:
          r.status,

        providerOutcome:
          r.providerOutcome,

        financialSettlementState:
          r.financialSettlementState,

        reconciliationState:
          r.reconciliationState,
      },
    };
  }

  async #findExisting(
    context,
  ) {
    if (
      context.originalIdempotencyKey
    ) {
      const idempotent =
        await this.findByIdempotencyKey({
          tenantId:
            context.tenantId,
          originalIdempotencyKey:
            context.originalIdempotencyKey,
          session:
            context.session,
        });

      if (idempotent) {
        return idempotent;
      }
    }

    if (
      context.settlementId
    ) {
      const settlement =
        await this.findBySettlementId({
          tenantId:
            context.tenantId,
          settlementId:
            context.settlementId,
          session:
            context.session,
        });

      if (settlement) {
        return settlement;
      }
    }

    if (
      context.providerReference
    ) {
      const provider =
        await this.findByProviderReference({
          tenantId:
            context.tenantId,
          providerReference:
            context.providerReference,
          session:
            context.session,
        });

      if (provider) {
        return provider;
      }
    }

    if (
      context.reference
    ) {
      const reference =
        await this.findByReference({
          tenantId:
            context.tenantId,
          reference:
            context.reference,
          session:
            context.session,
        });

      if (reference) {
        return reference;
      }
    }

    return null;
  }

  async #createRepositoryRecord(
    record,
    context,
  ) {
    const method =
      this.#repositoryMethod(
        'createForTenant',
        'createSettlementForTenant',
        'create',
        'insert',
      );

    if (!method) {
      this.#throw(
        'SETTLEMENT_TRACKER_REPOSITORY_UNAVAILABLE',
        'Settlement repository create operation is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    try {
      let saved;

      if (
        method.name ===
          'createForTenant' ||
        method.name ===
          'createSettlementForTenant'
      ) {
        saved =
          await method.fn(
            context.tenantId,
            sanitize(
              record,
              0,
              this.config,
            ),
            {
              session:
                context.session,
            },
          );
      } else {
        saved =
          await method.fn(
            sanitize(
              record,
              0,
              this.config,
            ),
            {
              tenantId:
                context.tenantId,
              provider:
                PROVIDER,
              operation:
                context.operation,
              session:
                context.session,
            },
          );
      }

      if (!saved) {
        this.#throw(
          'SETTLEMENT_TRACKER_REPOSITORY_EMPTY_RESULT',
          'Settlement repository returned no created record.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return this.#project(
        saved,
      );
    } catch (error) {
      const code =
        String(
          error?.code ??
            error?.name ??
            '',
        ).toUpperCase();

      if (
        code.includes('E11000') ||
        code.includes('DUPLICATE')
      ) {
        const existing =
          await this.#findExisting(
            context,
          );

        if (existing) {
          return existing;
        }
      }

      if (
        error instanceof
        AirtelSettlementTrackerError
      ) {
        throw error;
      }

      this.setHealthError(
        error,
      );

      this.#throw(
        'SETTLEMENT_TRACKER_REPOSITORY_CREATE_FAILED',
        'Settlement tracking persistence failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    }
  }

  #assertIdentityCompatible(
    record,
    context,
  ) {
    const pairs = [
      [
        'tenantId',
        record?.tenantId,
        context?.tenantId,
      ],
      [
        'provider',
        record?.provider,
        context?.provider,
      ],
      [
        'operation',
        record?.operation,
        context?.operation,
      ],
      [
        'settlementId',
        record?.settlementId,
        context?.settlementId,
      ],
      [
        'transactionId',
        record?.transactionId,
        context?.transactionId,
      ],
      [
        'reference',
        record?.reference,
        context?.reference,
      ],
      [
        'providerReference',
        record?.providerReference,
        context?.providerReference,
      ],
      [
        'providerTransactionId',
        record?.providerTransactionId,
        context?.providerTransactionId,
      ],
      [
        'amountMinor',
        record?.amountMinor,
        context?.amountMinor,
      ],
      [
        'currency',
        record?.currency,
        context?.currency,
      ],
    ];

    for (
      const [
        field,
        existingValue,
        incomingValue,
      ] of pairs
    ) {
      if (
        existingValue == null ||
        incomingValue == null
      ) {
        continue;
      }

      if (
        String(existingValue) !==
        String(incomingValue)
      ) {
        this.statistics
          .providerEventConflicts++;

        this.#throw(
          'SETTLEMENT_TRACKER_IDENTITY_CONFLICT',
          `Settlement tracking ${field} conflicts with the existing record.`,
          {
            settlementId:
              context.settlementId,
            field,
          },
          {
            httpStatus: 409,
            operation:
              context.operation,
          },
        );
      }
    }

    if (
      record?.originalIdempotencyKey &&
      context?.originalIdempotencyKey &&
      String(
        record.originalIdempotencyKey,
      ) !==
        String(
          context.originalIdempotencyKey,
        )
    ) {
      this.statistics
        .providerEventConflicts++;

      this.#throw(
        'SETTLEMENT_TRACKER_IDENTITY_CONFLICT',
        'Settlement tracking original idempotency identity conflicts with the existing record.',
        {
          settlementId:
            context.settlementId,
        },
        {
          httpStatus: 409,
          operation:
            context.operation,
        },
      );
    }
  }

  #buildPatch(
    current,
    context,
    nextStatus,
    timelineEntry,
    now,
  ) {
    const timeline = [
      ...(
        Array.isArray(
          current.timeline,
        )
          ? current.timeline
          : []
      ),
      timelineEntry,
    ].slice(
      -this.config
        .maxTimelineEntries,
    );

    const patch = {
      status:
        nextStatus,

      providerStatus:
        context.providerStatus ??
        current.providerStatus,

      providerOutcome:
        context.providerOutcome ??
        current.providerOutcome,

      financialSettlementState:
        context.financialSettlementState ??
        current.financialSettlementState,

      financialTransactionId:
        context.financialTransactionId ??
        current.financialTransactionId,

      ledgerReference:
        context.ledgerReference ??
        current.ledgerReference,

      reconciliationState:
        context.reconciliationState ??
        current.reconciliationState,

      reconciliationReference:
        context.reconciliationReference ??
        current.reconciliationReference,

      settlementConfirmedAt:
        context.settlementConfirmedAt ??
        current.settlementConfirmedAt,

      providerReference:
        context.providerReference ??
        current.providerReference,

      providerTransactionId:
        context.providerTransactionId ??
        current.providerTransactionId,

      correlationId:
        context.correlationId ??
        current.correlationId,

      executionId:
        context.executionId ??
        current.executionId,

      originalIdempotencyKey:
        context.originalIdempotencyKey ??
        current.originalIdempotencyKey,

      trackingFingerprint:
        current.trackingFingerprint,

      timeline,

      updatedAt:
        now,

      version:
        Number(
          current.version ??
            1,
        ) + 1,
    };

    if (
      nextStatus ===
      SETTLEMENT_STATUS.COMPLETED
    ) {
      patch.trackingCompletedAt =
        now;

      patch.providerCompletedAt =
        now;
    }

    if (
      nextStatus ===
      SETTLEMENT_STATUS.REVERSED
    ) {
      patch.reversedAt =
        now;
    }

    if (
      nextStatus ===
      SETTLEMENT_STATUS.CANCELLED
    ) {
      patch.cancelledAt =
        now;
    }

    if (
      nextStatus ===
      SETTLEMENT_STATUS.EXPIRED
    ) {
      patch.expiredAt =
        now;
    }

    if (
      nextStatus ===
      SETTLEMENT_STATUS.RECONCILIATION_REQUIRED
    ) {
      patch.reconciliationRequiredAt =
        now;
    }

    if (
      nextStatus ===
      SETTLEMENT_STATUS.RECONCILED
    ) {
      patch.reconciledAt =
        now;
    }

    if (
      context.metadata &&
      Object.keys(
        context.metadata,
      ).length
    ) {
      patch.metadata = {
        ...(
          isPlain(
            current.metadata,
          )
            ? current.metadata
            : {}
        ),
        ...context.metadata,
      };
    }

    return sanitize(
      patch,
      0,
      this.config,
    );
  }

  async #applyTransition({
    tenantId,
    settlementId,
    current,
    currentStatus,
    nextStatus,
    context,
    timelineEntry,
    now,
  }) {
    const patch =
      this.#buildPatch(
        current,
        context,
        nextStatus,
        timelineEntry,
        now,
      );

    const atomic =
      this.#repositoryMethod(
        'compareAndSetStatus',
        'atomicTransition',
        'compareAndSetTransition',
        'transitionStatus',
      );

    if (atomic) {
      try {
        const result =
          await atomic.fn({
            tenantId,
            provider:
              PROVIDER,
            operation:
              context.operation,
            settlementId,
            fromState:
              currentStatus,
            toState:
              nextStatus,
            fromStatus:
              currentStatus,
            nextStatus,
            expectedVersion:
              Number(
                current.version ??
                  1,
              ),
            expectedFingerprint:
              current.trackingFingerprint,
            idempotencyKey:
              context.originalIdempotencyKey,
            actorId:
              context.actorId,
            timelineEntry,
            patch,
            session:
              context.session,
          });

        if (result) {
          return this.#project(
            result,
          );
        }

        const latest =
          await this.findBySettlementId({
            tenantId,
            settlementId,
            session:
              context.session,
          });

        if (
          latest &&
          upper(
            latest.status,
          ) ===
            nextStatus
        ) {
          this.statistics
            .idempotentTransitions++;

          return latest;
        }

        this.#throw(
          'SETTLEMENT_TRACKER_CONCURRENCY_CONFLICT',
          'Settlement transition lost an optimistic-concurrency race.',
          {
            settlementId,
            currentStatus,
            nextStatus,
          },
          {
            httpStatus: 409,
            retryable: true,
          },
        );
      } catch (error) {
        if (
          error instanceof
          AirtelSettlementTrackerError
        ) {
          throw error;
        }

        this.#throw(
          'SETTLEMENT_TRACKER_ATOMIC_TRANSITION_FAILED',
          'Atomic settlement state transition failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            cause: error,
          },
        );
      }
    }

    if (
      this.config
        .requireAtomicTransitionForConcurrentWrites
    ) {
      this.#throw(
        'SETTLEMENT_TRACKER_ATOMIC_TRANSITION_REQUIRED',
        'Atomic settlement transition support is required by configuration.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    const method =
      this.#repositoryMethod(
        'updateForTenant',
        'updateSettlementForTenant',
        'updateById',
        'update',
        'patch',
      );

    if (!method) {
      this.#throw(
        'SETTLEMENT_TRACKER_REPOSITORY_TRANSITION_UNAVAILABLE',
        'Settlement repository transition/update operation is unavailable.',
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }

    try {
      let result;

      if (
        method.name ===
          'updateForTenant' ||
        method.name ===
          'updateSettlementForTenant'
      ) {
        result =
          await method.fn(
            tenantId,
            {
              settlementId,
              provider:
                PROVIDER,
              operation:
                context.operation,
            },
            patch,
            {
              session:
                context.session,
            },
          );
      } else {
        result =
          await method.fn(
            settlementId,
            patch,
            {
              tenantId,
              provider:
                PROVIDER,
              operation:
                context.operation,
              session:
                context.session,
            },
          );
      }

      if (!result) {
        this.#throw(
          'SETTLEMENT_TRACKER_REPOSITORY_UPDATE_EMPTY_RESULT',
          'Settlement repository returned no transition result.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return this.#project(
        result,
      );
    } catch (error) {
      if (
        error instanceof
        AirtelSettlementTrackerError
      ) {
        throw error;
      }

      this.#throw(
        'SETTLEMENT_TRACKER_REPOSITORY_UPDATE_FAILED',
        'Settlement state persistence failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    }
  }

  async #updateEvidence(
    current,
    context,
    {
      allowTimeline =
        true,
    } = {},
  ) {
    const now =
      nowDate(
        this.clock,
      );

    const patch = {};

    const assign = (
      key,
      value,
    ) => {
      if (
        value !==
          undefined &&
        value !==
          current?.[key]
      ) {
        patch[key] =
          value;
      }
    };

    assign(
      'providerReference',
      context.providerReference,
    );

    assign(
      'providerTransactionId',
      context.providerTransactionId,
    );

    assign(
      'providerStatus',
      context.providerStatus,
    );

    assign(
      'providerOutcome',
      context.providerOutcome,
    );

    assign(
      'financialSettlementState',
      context.financialSettlementState,
    );

    assign(
      'financialTransactionId',
      context.financialTransactionId,
    );

    assign(
      'ledgerReference',
      context.ledgerReference,
    );

    assign(
      'reconciliationState',
      context.reconciliationState,
    );

    assign(
      'reconciliationReference',
      context.reconciliationReference,
    );

    assign(
      'settlementConfirmedAt',
      context.settlementConfirmedAt,
    );

    assign(
      'correlationId',
      context.correlationId,
    );

    assign(
      'executionId',
      context.executionId,
    );

    if (
      context.metadata &&
      Object.keys(
        context.metadata,
      ).length
    ) {
      patch.metadata = {
        ...(
          isPlain(
            current?.metadata,
          )
            ? current.metadata
            : {}
        ),
        ...context.metadata,
      };
    }

    if (
      allowTimeline &&
      (
        context.providerStatus ||
        context.providerReference ||
        context.financialSettlementState ||
        context.reconciliationState
      )
    ) {
      const timeline = [
        ...(
          Array.isArray(
            current.timeline,
          )
            ? current.timeline
            : []
        ),
        this.#timelineEntry(
          current.status,
          current.status,
          context,
          now,
        ),
      ];

      patch.timeline =
        timeline.slice(
          -this.config
            .maxTimelineEntries,
        );
    }

    if (
      !Object.keys(
        patch,
      ).length
    ) {
      return current;
    }

    patch.updatedAt =
      now;

    patch.version =
      Number(
        current.version ??
          1,
      ) + 1;

    const method =
      this.#repositoryMethod(
        'updateEvidenceForTenant',
        'patchEvidence',
        'updateForTenant',
        'updateById',
        'update',
        'patch',
      );

    if (!method) {
      return current;
    }

    try {
      let result;

      if (
        method.name ===
          'updateEvidenceForTenant' ||
        method.name ===
          'updateForTenant'
      ) {
        result =
          await method.fn(
            context.tenantId,
            {
              settlementId:
                current.settlementId,
              provider:
                PROVIDER,
              operation:
                OPERATION,
            },
            sanitize(
              patch,
              0,
              this.config,
            ),
            {
              session:
                context.session,
            },
          );
      } else if (
        method.name ===
        'patchEvidence'
      ) {
        result =
          await method.fn({
            tenantId:
              context.tenantId,
            provider:
              PROVIDER,
            operation:
              OPERATION,
            settlementId:
              current.settlementId,
            expectedVersion:
              Number(
                current.version ??
                  1,
              ),
            patch:
              sanitize(
                patch,
                0,
                this.config,
              ),
            session:
              context.session,
          });
      } else {
        result =
          await method.fn(
            current.settlementId,
            sanitize(
              patch,
              0,
              this.config,
            ),
            {
              tenantId:
                context.tenantId,
              provider:
                PROVIDER,
              operation:
                OPERATION,
              session:
                context.session,
            },
          );
      }

      return result
        ? this.#project(
            result,
          )
        : this.#project({
            ...current,
            ...patch,
          });
    } catch (error) {
      this.setHealthError(
        error,
      );

      this.#throw(
        'SETTLEMENT_TRACKER_EVIDENCE_UPDATE_FAILED',
        'Settlement evidence persistence failed.',
        {
          settlementId:
            current.settlementId,
        },
        {
          retryable: true,
          httpStatus: 503,
          cause: error,
        },
      );
    }
  }

  async #recordAudit(
    action,
    record,
    context,
  ) {
    if (
      !this.config.writeAudit
    ) {
      return null;
    }

    const method =
      this.#auditMethod();

    if (
      !isFn(method)
    ) {
      return null;
    }

    const payload =
      sanitize(
        {
          schemaVersion:
            SCHEMA_VERSION,

          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            record?.operation ??
            OPERATION,

          action,

          tenantId:
            record?.tenantId,

          settlementId:
            record?.settlementId,

          transactionId:
            record?.transactionId,

          reference:
            record?.reference,

          providerReference:
            record?.providerReference,

          providerOutcome:
            record?.providerOutcome,

          status:
            record?.status,

          financialSettlementState:
            record?.financialSettlementState,

          reconciliationState:
            record?.reconciliationState,

          correlationId:
            record?.correlationId ??
            context?.correlationId,

          executionId:
            record?.executionId ??
            context?.executionId,

          actorId:
            record?.actorId ??
            context?.actorId,

          originalIdempotencyKeyHash:
            record?.originalIdempotencyKey
              ? sha256(
                  String(
                    record.originalIdempotencyKey,
                  ),
                )
              : undefined,

          trackingFingerprint:
            record?.trackingFingerprint,

          occurredAt:
            nowIso(
              this.clock,
            ),
        },
        0,
        this.config,
      );

    try {
      return await method.call(
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
      this.statistics
        .auditFailures++;

      this.#log(
        'error',
        'Airtel settlement tracker audit write failed.',
        {
          action,
          tenantId:
            payload.tenantId,
          settlementId:
            payload.settlementId,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        this.#throw(
          'SETTLEMENT_TRACKER_AUDIT_UNAVAILABLE',
          'Settlement tracker audit boundary is unavailable.',
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

  startSpan(
    name,
    attributes = {},
  ) {
    if (
      !this.tracer ||
      !isFn(
        this.tracer.startSpan,
      )
    ) {
      return null;
    }

    try {
      const span =
        this.tracer.startSpan(
          name,
        );

      span?.setAttribute?.(
        'component',
        COMPONENT,
      );

      span?.setAttribute?.(
        'provider',
        PROVIDER,
      );

      span?.setAttribute?.(
        'operation',
        OPERATION,
      );

      for (
        const [
          key,
          value,
        ] of Object.entries(
          sanitize(
            attributes,
            0,
            this.config,
          ),
        )
      ) {
        if (
          value !== undefined &&
          value !== null
        ) {
          span?.setAttribute?.(
            key,
            String(value),
          );
        }
      }

      return span;
    } catch {
      return null;
    }
  }

  touchActivity() {
    this.healthState.lastActivity =
      nowDate(
        this.clock,
      );

    if (
      this.initialized &&
      this.healthState.status ===
        'INITIALIZING'
    ) {
      this.healthState.status =
        'READY';
    }
  }

  setHealthError(
    error,
  ) {
    if (
      !operationalFailure(
        error,
      )
    ) {
      return;
    }

    this.healthState.lastError =
      {
        name:
          bounded(
            error?.name,
            128,
          ),

        code:
          bounded(
            error?.code,
            160,
          ),

        message:
          bounded(
            error?.message,
            512,
          ),
      };

    if (
      ![
        'INITIALIZING',
        'STOPPING',
      ].includes(
        this.healthState
          .status,
      )
    ) {
      this.healthState.status =
        'DEGRADED';
    }
  }
}

export const createSettlementTracker =
  (
    options = {},
  ) =>
    new SettlementTracker(
      options,
    );

export const createAirtelSettlementTracker =
  createSettlementTracker;

export const createAirtelDisbursementSettlementTracker =
  createSettlementTracker;

export const AirtelDisbursementSettlementTracker =
  SettlementTracker;

export const defaultSettlementTracker =
  createSettlementTracker();

export const settlementTracker =
  defaultSettlementTracker;

export default SettlementTracker;