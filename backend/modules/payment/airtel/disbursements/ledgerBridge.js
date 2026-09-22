'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Ledger Bridge
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/ledgerBridge.js
 *
 * Architectural role
 * ------------------
 * Controlled accounting-adapter boundary between the Airtel disbursement
 * bounded context and TITech's canonical Financial Core / ledger-posting
 * infrastructure.
 *
 * The bridge translates an Airtel financial event into a canonical accounting
 * command. It does NOT become another ledger implementation.
 *
 * Canonical path
 * --------------
 *
 *   Airtel Disbursement Service
 *             |
 *             v
 *       Ledger Bridge
 *             |
 *       +-----+-----------------------+
 *       |                             |
 *       v                             v
 * Financial Core              Ledger Posting Service
 *       |                             |
 *       +---------------+-------------+
 *                       |
 *                       v
 *                Canonical Ledger
 *
 * Responsibilities
 * ----------------
 * - Enforce tenant/provider/operation scope at the accounting boundary.
 * - Preserve the original financial transaction identity.
 * - Derive a deterministic accounting posting identity from the originating
 *   financial identity unless the Financial Core owns the accounting identity.
 * - Validate exact monetary representations without floating-point arithmetic.
 * - Reject ambiguous/unknown provider outcomes before accounting finalization.
 * - Delegate accounting mutation to the canonical Financial Core or explicitly
 *   injected ledger-posting service.
 * - Support explicit settlement verification and controlled reversal/compensation
 *   delegation.
 * - Provide stable aliases used by existing payment services without creating a
 *   second accounting API implementation.
 * - Produce bounded, sanitized audit/metric evidence.
 * - Expose health/readiness/capability information without authorizing financial
 *   operations.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel HTTP calls, OAuth/token handling or provider authentication.
 * - No provider callback signature verification.
 * - No direct MongoDB/Mongoose model or repository access.
 * - No direct balance/wallet mutation.
 * - No direct ledger/journal persistence.
 * - No selection of accounting accounts from provider-controlled references.
 * - No KYC/AML/sanctions/fraud adjudication.
 * - No approval/maker-checker authorization.
 * - No blind retries for unknown financial outcomes.
 * - No silent accounting repair.
 * - No deletion/editing of historical accounting records.
 * - No assumption that provider acceptance alone equals financial settlement.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Provider outcome must be known before accounting finalization.
 * 2. Ambiguous, timeout and unknown outcomes route to status/reconciliation;
 *    they are never posted as success by inference.
 * 3. The originating financial transaction ID and original idempotency identity
 *    remain immutable and are carried into accounting metadata.
 * 4. Accounting posting identity is deterministic and tenant-scoped.
 * 5. A corrective/reversal operation receives a distinct idempotency identity
 *    linked to the original financial identity.
 * 6. Account identifiers are accepted only when supplied by an authoritative
 *    accounting layer; provider references are never promoted to accounts.
 * 7. Ledger posting must satisfy the canonical double-entry invariant inside the
 *    downstream accounting boundary.
 * 8. A successful accounting commit must never be converted into a reported
 *    failure merely because audit/metrics publication failed afterwards.
 * 9. Legacy ledger fallback is disabled by default and is available only through
 *    explicit dependency injection and configuration.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const ENGINE_NAME = 'airtel-disbursement-ledger-bridge';
export const ENGINE_VERSION = '3.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const DEFAULT_OPERATION = 'DISBURSEMENT';
export const SCHEMA_VERSION = 1;

export const BRIDGE_OUTCOMES = Object.freeze({
  POSTED: 'POSTED',
  SETTLED: 'SETTLED',
  ALREADY_POSTED: 'ALREADY_POSTED',
  VERIFIED: 'VERIFIED',
  NOT_VERIFIED: 'NOT_VERIFIED',
  REVERSED: 'REVERSED',
  REPLAY: 'REPLAY',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  FAILED: 'FAILED',
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
  requireOriginalIdempotencyKey: true,
  requireTransactionIdentityForFinancialPost: true,
  requireAmountMinor: true,
  requireCurrency: true,
  requireProviderConfirmation: true,
  rejectAmbiguousProviderOutcome: true,
  rejectUnconfirmedProviderOutcome: true,
  allowLedgerPostingFallback: true,
  allowLegacyLedgerServiceFallback: false,
  acceptAmountAlias: true,
  defaultCurrency: 'UGX',
  maxTenantIdLength: 160,
  maxTransactionIdLength: 200,
  maxReferenceLength: 240,
  maxIdempotencyKeyLength: 320,
  maxPostingKeyLength: 320,
  maxAccountIdLength: 256,
  maxCurrencyLength: 3,
  maxProviderReferenceLength: 240,
  maxDescriptionLength: 500,
  maxMetadataDepth: 5,
  maxMetadataKeys: 64,
  maxMetadataArrayLength: 100,
  maxMetadataStringLength: 2048,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
});

const SUCCESS_VALUES = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'SUCCESSFUL',
  'COMPLETED',
  'SETTLED',
  'POSTED',
  'PAID',
  'CONFIRMED',
]);

const FAILURE_VALUES = new Set([
  'FAILURE',
  'FAILED',
  'REJECTED',
  'DECLINED',
  'DENIED',
  'CANCELLED',
  'CANCELED',
  'EXPIRED',
]);

const PENDING_VALUES = new Set([
  'PENDING',
  'PROCESSING',
  'INITIATED',
  'SUBMITTED',
  'QUEUED',
  'ACCEPTED',
]);

const AMBIGUOUS_VALUES = new Set([
  'AMBIGUOUS',
  'UNKNOWN',
  'TIMEOUT',
  'NO_RESPONSE',
  'COMMIT_UNKNOWN',
  'INDETERMINATE',
]);

const PRIVATE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const SECRET_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|client.?secret|raw(request|response)|provider.?payload)/i;

const UNSAFE_MONGO_KEY_PATTERN = /(^\$)|\./;

const isObject = (value) =>
  value !== null &&
  typeof value === 'object';

const isPlainObject = (value) =>
  isObject(value) &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const isFunction = (value) =>
  typeof value === 'function';

const upper = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value)
    .trim()
    .toUpperCase();

  return normalized || undefined;
};

const stringValue = (
  value,
  maxLength = 240,
) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized
    ? normalized.slice(0, maxLength)
    : undefined;
};

const clone = (value) => {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (isPlainObject(value)) {
      return { ...value };
    }

    return value;
  }
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

const stableSerialize = (value) => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;

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
    .update(
      typeof value === 'string'
        ? value
        : stableSerialize(value),
    )
    .digest('hex');

const sanitize = (
  value,
  depth = 0,
  config = DEFAULT_CONFIG,
) => {
  if (depth > config.maxMetadataDepth) {
    return '[TRUNCATED]';
  }

  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > config.maxMetadataStringLength
      ? `${value.slice(0, config.maxMetadataStringLength)}…`
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
      .slice(0, config.maxMetadataArrayLength)
      .map((item) =>
        sanitize(item, depth + 1, config),
      );
  }

  if (!isObject(value)) {
    return String(value);
  }

  const output = {};

  for (const key of Object.keys(value).slice(
    0,
    config.maxMetadataKeys,
  )) {
    if (
      PRIVATE_KEYS.has(key) ||
      UNSAFE_MONGO_KEY_PATTERN.test(key)
    ) {
      continue;
    }

    output[key] = SECRET_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitize(value[key], depth + 1, config);
  }

  return output;
};

const requireNonEmptyString = (
  value,
  field,
  maxLength,
) => {
  const normalized = stringValue(value, maxLength);

  if (!normalized) {
    throw new AirtelLedgerBridgeError(
      `${field} is required.`,
      'LEDGER_BRIDGE_REQUIRED_FIELD',
      { field },
      { httpStatus: 422 },
    );
  }

  return normalized;
};

const normalizeAmount = (value) => {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new AirtelLedgerBridgeError(
        'Authoritative financial amounts must not use unsafe or fractional JavaScript numbers.',
        'LEDGER_BRIDGE_INVALID_AMOUNT',
        {},
        { httpStatus: 422 },
      );
    }
  }

  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new AirtelLedgerBridgeError(
        'Financial amount must be greater than zero.',
        'LEDGER_BRIDGE_INVALID_AMOUNT',
        {},
        { httpStatus: 422 },
      );
    }

    return value.toString();
  }

  const normalized = String(value).trim();

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new AirtelLedgerBridgeError(
      'amountMinor must be a non-negative exact decimal representation.',
      'LEDGER_BRIDGE_INVALID_AMOUNT',
      {},
      { httpStatus: 422 },
    );
  }

  if (
    /^0(?:\.0+)?$/.test(normalized)
  ) {
    throw new AirtelLedgerBridgeError(
      'Financial amount must be greater than zero.',
      'LEDGER_BRIDGE_INVALID_AMOUNT',
      {},
      { httpStatus: 422 },
    );
  }

  return normalized;
};

const normalizeCurrency = (
  value,
  fallback = DEFAULT_CONFIG.defaultCurrency,
) => {
  const normalized = upper(value ?? fallback);

  if (
    !normalized ||
    !/^[A-Z]{3}$/.test(normalized)
  ) {
    throw new AirtelLedgerBridgeError(
      'currency must be a three-letter ISO-style currency code.',
      'LEDGER_BRIDGE_INVALID_CURRENCY',
      {},
      { httpStatus: 422 },
    );
  }

  return normalized;
};

const actorIdOf = (actor) =>
  stringValue(
    actor?.actorId ??
      actor?.userId ??
      actor?.principalId ??
      actor?.id,
    200,
  );

const normalizeDate = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AirtelLedgerBridgeError(
      'occurredAt must be a valid date.',
      'LEDGER_BRIDGE_INVALID_DATE',
      {},
      { httpStatus: 422 },
    );
  }

  return date;
};

const normalizeProviderOutcome = (
  input = {},
) => {
  // Authoritative reconciliation/confirmation evidence may resolve an
  // otherwise ambiguous provider state. It must be considered before the
  // generic boolean hints below.
  if (
    input.reconciliationConfirmed === true ||
    input.confirmationConfirmed === true
  ) {
    return PROVIDER_OUTCOMES.SUCCESS;
  }

  const raw = upper(
    input.providerOutcome ??
      input.outcome ??
      input.providerStatus ??
      input.status,
  );

  // An explicit provider status/outcome is more authoritative than a stale or
  // generic `providerConfirmed` flag. In particular, TIMEOUT/UNKNOWN must not
  // become SUCCESS merely because a caller also supplied confirmed=true.
  if (raw) {
    if (SUCCESS_VALUES.has(raw)) {
      return PROVIDER_OUTCOMES.SUCCESS;
    }

    if (FAILURE_VALUES.has(raw)) {
      return PROVIDER_OUTCOMES.FAILURE;
    }

    if (PENDING_VALUES.has(raw)) {
      return PROVIDER_OUTCOMES.PENDING;
    }

    if (AMBIGUOUS_VALUES.has(raw)) {
      return PROVIDER_OUTCOMES.AMBIGUOUS;
    }

    return PROVIDER_OUTCOMES.UNKNOWN;
  }

  if (
    input.providerConfirmed === true ||
    input.confirmed === true ||
    input.settled === true ||
    input.reconciled === true
  ) {
    return PROVIDER_OUTCOMES.SUCCESS;
  }

  return PROVIDER_OUTCOMES.UNKNOWN;
};

const isPlainMutationResult = (value) =>
  isPlainObject(value) ||
  value === null;

const hasAuthoritativeAccountingEvidence = (value) => {
  if (!isPlainObject(value)) {
    return false;
  }

  const evidenceKeys = [
    'status',
    'outcome',
    'state',
    'success',
    'posted',
    'settled',
    'duplicate',
    'replayed',
    'posting',
    'postingKey',
    'ledgerReference',
    'ledgerEntryId',
    'journalId',
    'ledgerId',
    'transactionId',
    'financialTransactionId',
    'reference',
  ];

  return evidenceKeys.some(
    (key) => value[key] !== undefined && value[key] !== null,
  );
};

/**
 * =============================================================================
 * Error type
 * =============================================================================
 */

export class AirtelLedgerBridgeError extends Error {
  constructor(
    message,
    code = 'LEDGER_BRIDGE_ERROR',
    details = {},
    options = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AirtelLedgerBridgeError';
    this.code = code;
    this.component = COMPONENT;
    this.provider = PROVIDER;
    this.operation = options.operation ?? DEFAULT_OPERATION;
    this.details = sanitize(
      details,
      0,
      options.config ?? DEFAULT_CONFIG,
    );
    this.retryable = Boolean(options.retryable);
    this.httpStatus =
      Number.isInteger(options.httpStatus)
        ? options.httpStatus
        : 400;
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

/**
 * =============================================================================
 * Deterministic identity helpers
 * =============================================================================
 */

export const buildLedgerPostingKey = ({
  tenantId,
  provider = PROVIDER,
  operation = DEFAULT_OPERATION,
  transactionId = null,
  originalIdempotencyKey,
  reference = null,
} = {}) => {
  const normalizedTenantId =
    stringValue(tenantId, DEFAULT_CONFIG.maxTenantIdLength) ??
    '';
  const normalizedProvider = upper(provider) ?? PROVIDER;
  const normalizedOperation =
    upper(operation) ?? DEFAULT_OPERATION;
  const normalizedTransactionId =
    stringValue(transactionId, DEFAULT_CONFIG.maxTransactionIdLength) ??
    '';
  const normalizedOriginalKey =
    stringValue(
      originalIdempotencyKey,
      DEFAULT_CONFIG.maxIdempotencyKeyLength,
    ) ?? '';
  const normalizedReference =
    stringValue(reference, DEFAULT_CONFIG.maxReferenceLength) ??
    '';

  return `ledger:${normalizedProvider.toLowerCase()}:${normalizedOperation.toLowerCase()}:${sha256({
    schemaVersion: SCHEMA_VERSION,
    tenantId: normalizedTenantId,
    provider: normalizedProvider,
    operation: normalizedOperation,
    transactionId: normalizedTransactionId,
    originalIdempotencyKey: normalizedOriginalKey,
    reference: normalizedReference,
  }).slice(0, 64)}`;
};

export const buildReversalPostingKey = ({
  tenantId,
  provider = PROVIDER,
  operation = DEFAULT_OPERATION,
  originalPostingKey,
  compensationIdempotencyKey,
} = {}) =>
  `reversal:${String(provider).toLowerCase()}:${String(operation).toLowerCase()}:${sha256({
    schemaVersion: SCHEMA_VERSION,
    tenantId: stringValue(tenantId, DEFAULT_CONFIG.maxTenantIdLength) ?? '',
    provider: upper(provider) ?? PROVIDER,
    operation: upper(operation) ?? DEFAULT_OPERATION,
    originalPostingKey:
      stringValue(originalPostingKey, DEFAULT_CONFIG.maxPostingKeyLength) ?? '',
    compensationIdempotencyKey:
      stringValue(
        compensationIdempotencyKey,
        DEFAULT_CONFIG.maxIdempotencyKeyLength,
      ) ?? '',
  }).slice(0, 64)}`;

export const buildLedgerPostingFingerprint = (
  input = {},
) =>
  sha256({
    schemaVersion: SCHEMA_VERSION,
    tenantId: stringValue(input.tenantId, DEFAULT_CONFIG.maxTenantIdLength),
    provider: upper(input.provider) ?? PROVIDER,
    operation: upper(input.operation) ?? DEFAULT_OPERATION,
    transactionId: stringValue(input.transactionId, DEFAULT_CONFIG.maxTransactionIdLength),
    originalIdempotencyKeyHash:
      input.originalIdempotencyKey
        ? sha256(String(input.originalIdempotencyKey))
        : null,
    postingKey: stringValue(input.postingKey, DEFAULT_CONFIG.maxPostingKeyLength),
    reference: stringValue(input.reference, DEFAULT_CONFIG.maxReferenceLength),
    providerReference:
      stringValue(input.providerReference, DEFAULT_CONFIG.maxProviderReferenceLength),
    amountMinor:
      input.amountMinor === undefined
        ? null
        : String(input.amountMinor),
    currency: upper(input.currency),
    providerOutcome: upper(input.providerOutcome),
    lines: Array.isArray(input.lines)
      ? input.lines.map((line) => ({
          accountId:
            stringValue(line?.accountId ?? line?.accountCode, DEFAULT_CONFIG.maxAccountIdLength),
          direction: upper(line?.direction),
          amount:
            line?.amount === undefined
              ? null
              : String(line.amount),
          currency: upper(line?.currency ?? input.currency),
        }))
      : null,
  });

/**
 * =============================================================================
 * Main bridge
 * =============================================================================
 */

export class AirtelDisbursementLedgerBridge {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new AirtelLedgerBridgeError(
        'Ledger bridge options must be a plain object.',
        'LEDGER_BRIDGE_INVALID_OPTIONS',
        {},
        { httpStatus: 500 },
      );
    }

    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...(options.config ?? options.configuration ?? {}),
    });

    this.financialCore =
      options.financialCore ??
      options.financialTransactionService ??
      null;

    this.ledgerPostingService =
      options.ledgerPostingService ??
      options.postingService ??
      null;

    this.reconciliationService =
      options.reconciliationService ??
      options.reconciliation ??
      null;

    this.legacyLedgerService =
      options.legacyLedgerService ??
      options.legacyLedger ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.logger =
      options.logger ??
      null;

    this.clock =
      options.clock ??
      { now: () => Date.now() };

    this.idFactory =
      options.idFactory ??
      (() => randomUUID());
  }

  /**
   * ---------------------------------------------------------------------------
   * Common infrastructure helpers
   * ---------------------------------------------------------------------------
   */

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelLedgerBridgeError(
      message,
      code,
      details,
      {
        ...options,
        operation:
          options.operation ??
          DEFAULT_OPERATION,
        config: this.config,
      },
    );
  }

  #log(level, message, context = {}) {
    try {
      const safeContext = sanitize(
        {
          component: COMPONENT,
          provider: PROVIDER,
          ...context,
        },
        0,
        this.config,
      );

      const candidate =
        this.logger?.[level] ??
        this.logger?.log ??
        this.logger?.info;

      candidate?.call?.(
        this.logger,
        safeContext,
        message,
      );
    } catch {
      // Observability must never alter financial state.
    }
  }

  #metric(name, labels = {}) {
    try {
      const candidate =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      candidate?.call?.(
        this.metrics,
        name,
        sanitize(labels, 0, this.config),
      );
    } catch {
      // Metrics are informational only.
    }
  }

  async #audit(action, context, result = null) {
    const method =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write ??
      this.auditService?.createAuditLog;

    if (!isFunction(method)) {
      return null;
    }

    const payload = {
      schemaVersion: SCHEMA_VERSION,
      component: COMPONENT,
      provider: PROVIDER,
      operation: context.operation,
      action,
      tenantId: context.tenantId,
      transactionId: context.transactionId,
      reference: context.reference,
      providerReference: context.providerReference,
      amountMinor: context.amountMinor,
      currency: context.currency,
      postingKey: context.postingKey,
      originalIdempotencyKeyHash:
        context.originalIdempotencyKey
          ? sha256(context.originalIdempotencyKey)
          : undefined,
      compensationIdempotencyKeyHash:
        context.compensationIdempotencyKey
          ? sha256(context.compensationIdempotencyKey)
          : undefined,
      postingFingerprint: context.postingFingerprint,
      actorId: actorIdOf(context.actor),
      outcome:
        result?.outcome ??
        result?.status ??
        undefined,
      occurredAt: nowIso(this.clock),
    };

    const safePayload = sanitize(
      payload,
      0,
      this.config,
    );

    try {
      return await method.call(
        this.auditService,
        {
          ...safePayload,
          auditFingerprint: sha256(
            safePayload,
          ),
        },
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel ledger-bridge audit publication failed.',
        {
          action,
          tenantId: context.tenantId,
          transactionId: context.transactionId,
          message: error?.message,
        },
      );

      if (this.config.failClosedOnAuditError) {
        this.#throw(
          'LEDGER_BRIDGE_AUDIT_UNAVAILABLE',
          'Ledger-bridge audit boundary is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
          },
        );
      }

      return null;
    }
  }

  async #event(type, context, result = null) {
    const method =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (!isFunction(method)) {
      return null;
    }

    const event = {
      eventId: this.idFactory(),
      type,
      occurredAt: nowIso(this.clock),
      tenantId: context.tenantId,
      provider: PROVIDER,
      operation: context.operation,
      transactionId: context.transactionId,
      reference: context.reference,
      providerReference: context.providerReference,
      postingKey: context.postingKey,
      outcome:
        result?.outcome ??
        result?.status ??
        undefined,
      fingerprint: context.postingFingerprint,
      payload: sanitize(
        {
          source: COMPONENT,
          result,
        },
        0,
        this.config,
      ),
    };

    try {
      return await method.call(
        this.eventBus,
        event,
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel ledger-bridge event publication failed.',
        {
          type,
          tenantId: context.tenantId,
          transactionId: context.transactionId,
          message: error?.message,
        },
      );

      if (this.config.failClosedOnEventError) {
        this.#throw(
          'LEDGER_BRIDGE_EVENT_PUBLICATION_FAILED',
          'Ledger-bridge event publication failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
          },
        );
      }

      return null;
    }
  }

  #financialMethod(...names) {
    for (const name of names) {
      if (
        isFunction(
          this.financialCore?.[name],
        )
      ) {
        return {
          name,
          fn: this.financialCore[name].bind(
            this.financialCore,
          ),
        };
      }
    }

    return null;
  }

  #postingMethod(...names) {
    for (const name of names) {
      if (
        isFunction(
          this.ledgerPostingService?.[name],
        )
      ) {
        return {
          name,
          fn: this.ledgerPostingService[name].bind(
            this.ledgerPostingService,
          ),
        };
      }
    }

    return null;
  }

  #reconciliationMethod(...names) {
    for (const name of names) {
      if (
        isFunction(
          this.reconciliationService?.[name],
        )
      ) {
        return {
          name,
          fn: this.reconciliationService[name].bind(
            this.reconciliationService,
          ),
        };
      }
    }

    return null;
  }

  #legacyMethod(...names) {
    if (
      !this.config.allowLegacyLedgerServiceFallback
    ) {
      return null;
    }

    for (const name of names) {
      if (
        isFunction(
          this.legacyLedgerService?.[name],
        )
      ) {
        return {
          name,
          fn: this.legacyLedgerService[name].bind(
            this.legacyLedgerService,
          ),
        };
      }
    }

    return null;
  }

  /**
   * ---------------------------------------------------------------------------
   * Context normalization and financial-safety gates
   * ---------------------------------------------------------------------------
   */

  normalizeContext(input = {}, {
    operation = null,
    requireTransactionId =
      this.config.requireTransactionIdentityForFinancialPost,
    requireOriginalIdempotencyKey =
      this.config.requireOriginalIdempotencyKey,
  } = {}) {
    if (!isPlainObject(input)) {
      this.#throw(
        'LEDGER_BRIDGE_INVALID_INPUT',
        'Ledger bridge input must be a plain object.',
        {},
        { httpStatus: 422 },
      );
    }

    const operationEnvelope =
      isPlainObject(input.operation)
        ? input.operation
        : {};

    const transactionEnvelope =
      isPlainObject(input.transaction)
        ? input.transaction
        : {};

    const settlementEnvelope =
      isPlainObject(input.settlement)
        ? input.settlement
        : {};

    const reconciliationEnvelope =
      isPlainObject(input.reconciliation)
        ? input.reconciliation
        : {};

    const confirmationEnvelope =
      isPlainObject(input.confirmation)
        ? input.confirmation
        : {};

    const tenantId = requireNonEmptyString(
      input.tenantId ??
        operationEnvelope.tenantId ??
        transactionEnvelope.tenantId ??
        settlementEnvelope.tenantId,
      'tenantId',
      this.config.maxTenantIdLength,
    );

    const provider = upper(
      input.provider ??
        operationEnvelope.provider ??
        transactionEnvelope.provider ??
        settlementEnvelope.provider ??
        PROVIDER,
    );

    if (
      this.config.requireAirtelProvider &&
      provider !== PROVIDER
    ) {
      this.#throw(
        'LEDGER_BRIDGE_PROVIDER_SCOPE_VIOLATION',
        'Airtel ledger bridge accepts only the AIRTEL provider.',
        { provider },
        {
          httpStatus: 409,
          operation:
            operation ??
            input.operationType ??
            operationEnvelope.type ??
            DEFAULT_OPERATION,
        },
      );
    }

    const resolvedOperation =
      upper(
        operation ??
          input.operationType ??
          input.type ??
          operationEnvelope.type ??
          transactionEnvelope.type ??
          DEFAULT_OPERATION,
      ) ?? DEFAULT_OPERATION;

    if (
      this.config.requireOperation &&
      !resolvedOperation
    ) {
      this.#throw(
        'LEDGER_BRIDGE_OPERATION_REQUIRED',
        'Accounting operation is required.',
        {},
        { httpStatus: 422 },
      );
    }

    const transactionId =
      stringValue(
        input.transactionId ??
          input.financialTransactionId ??
          transactionEnvelope.transactionId ??
          transactionEnvelope.financialTransactionId ??
          transactionEnvelope.id ??
          transactionEnvelope._id,
        this.config.maxTransactionIdLength,
      );

    if (
      requireTransactionId &&
      !transactionId
    ) {
      this.#throw(
        'LEDGER_BRIDGE_TRANSACTION_ID_REQUIRED',
        'transactionId is required for financial accounting.',
        {},
        {
          httpStatus: 422,
          operation: resolvedOperation,
        },
      );
    }

    const reference =
      stringValue(
        input.reference ??
          input.paymentReference ??
          input.externalReference ??
          operationEnvelope.reference ??
          transactionEnvelope.reference ??
          settlementEnvelope.reference,
        this.config.maxReferenceLength,
      );

    const originalIdempotencyKey =
      stringValue(
        input.originalIdempotencyKey ??
          input.idempotencyKey ??
          input.headers?.['idempotency-key'] ??
          operationEnvelope.originalIdempotencyKey ??
          operationEnvelope.idempotencyKey ??
          transactionEnvelope.originalIdempotencyKey ??
          transactionEnvelope.idempotencyKey ??
          settlementEnvelope.originalIdempotencyKey ??
          settlementEnvelope.idempotencyKey,
        this.config.maxIdempotencyKeyLength,
      );

    if (
      requireOriginalIdempotencyKey &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        'LEDGER_BRIDGE_IDEMPOTENCY_KEY_REQUIRED',
        'The originating financial idempotency key is required.',
        {},
        {
          httpStatus: 422,
          operation: resolvedOperation,
        },
      );
    }

    let amountMinor =
      input.amountMinor ??
      input.amountInMinorUnits ??
      operationEnvelope.amountMinor ??
      operationEnvelope.amountInMinorUnits ??
      transactionEnvelope.amountMinor ??
      transactionEnvelope.amountInMinorUnits;

    if (
      amountMinor === undefined &&
      this.config.acceptAmountAlias
    ) {
      amountMinor =
        input.amount ??
        operationEnvelope.amount ??
        transactionEnvelope.amount ??
        settlementEnvelope.amount;
    }

    amountMinor = normalizeAmount(
      amountMinor,
    );

    if (
      this.config.requireAmountMinor &&
      !amountMinor
    ) {
      this.#throw(
        'LEDGER_BRIDGE_AMOUNT_REQUIRED',
        'amountMinor is required for financial accounting.',
        {},
        {
          httpStatus: 422,
          operation: resolvedOperation,
        },
      );
    }

    const currency =
      normalizeCurrency(
        input.currency ??
          operationEnvelope.currency ??
          transactionEnvelope.currency ??
          settlementEnvelope.currency ??
          this.config.defaultCurrency,
        this.config.defaultCurrency,
      );

    const providerReference =
      stringValue(
        input.providerReference ??
          input.providerTransactionId ??
          operationEnvelope.providerReference ??
          operationEnvelope.providerTransactionId ??
          transactionEnvelope.providerReference ??
          transactionEnvelope.providerTransactionId ??
          settlementEnvelope.providerReference ??
          settlementEnvelope.providerTransactionId,
        this.config.maxProviderReferenceLength,
      );

    const reconciliationConfirmed =
      reconciliationEnvelope.confirmed === true ||
      reconciliationEnvelope.confirmedSuccess === true ||
      reconciliationEnvelope.knownSuccess === true ||
      reconciliationEnvelope.providerConfirmed === true ||
      reconciliationEnvelope.settled === true ||
      reconciliationEnvelope.financialPosted === true ||
      upper(reconciliationEnvelope.outcome ?? reconciliationEnvelope.status ?? reconciliationEnvelope.state) ===
        'CONFIRMED_SUCCESS';

    const confirmationConfirmed =
      confirmationEnvelope.confirmed === true ||
      confirmationEnvelope.providerConfirmed === true ||
      confirmationEnvelope.settled === true ||
      upper(confirmationEnvelope.outcome ?? confirmationEnvelope.status ?? confirmationEnvelope.state) ===
        'CONFIRMED';

    const providerOutcome =
      normalizeProviderOutcome({
        ...operationEnvelope,
        ...transactionEnvelope,
        ...settlementEnvelope,
        ...reconciliationEnvelope,
        ...confirmationEnvelope,
        ...input,
        reconciliationConfirmed,
        confirmationConfirmed,
      });

    const providerConfirmed =
      input.providerConfirmed === true ||
      input.confirmed === true ||
      input.settled === true ||
      input.reconciled === true ||
      reconciliationConfirmed ||
      confirmationConfirmed ||
      operationEnvelope.providerConfirmed === true ||
      operationEnvelope.confirmed === true ||
      transactionEnvelope.providerConfirmed === true ||
      transactionEnvelope.confirmed === true ||
      settlementEnvelope.providerConfirmed === true ||
      settlementEnvelope.confirmed === true ||
      providerOutcome === PROVIDER_OUTCOMES.SUCCESS;

    const actor =
      isPlainObject(input.actor)
        ? {
            actorId: actorIdOf(input.actor),
            role: upper(
              input.actor.role ??
                input.actor.actorRole,
            ),
            tenantId:
              stringValue(
                input.actor.tenantId,
                this.config.maxTenantIdLength,
              ),
          }
        : undefined;

    if (
      actor?.tenantId &&
      actor.tenantId !== tenantId
    ) {
      this.#throw(
        'LEDGER_BRIDGE_TENANT_SCOPE_MISMATCH',
        'Actor tenant does not match the accounting tenant.',
        {},
        { httpStatus: 403 },
      );
    }

    const postingKey =
      stringValue(
        input.postingKey ??
          input.accountingPostingKey ??
          operationEnvelope.postingKey ??
          operationEnvelope.accountingPostingKey,
        this.config.maxPostingKeyLength,
      ) ??
      buildLedgerPostingKey({
        tenantId,
        provider,
        operation: resolvedOperation,
        transactionId,
        originalIdempotencyKey,
        reference,
      });

    const occurredAt = normalizeDate(
      input.occurredAt ??
        operationEnvelope.occurredAt ??
        transactionEnvelope.occurredAt ??
        settlementEnvelope.occurredAt,
      new Date(nowMs(this.clock)),
    );

    const metadata = sanitize(
      input.metadata ??
        operationEnvelope.metadata ??
        transactionEnvelope.metadata ??
        settlementEnvelope.metadata ??
        {},
      0,
      this.config,
    );

    const description =
      stringValue(
        input.description ??
          operationEnvelope.description ??
          transactionEnvelope.description ??
          settlementEnvelope.description ??
          `Airtel ${resolvedOperation.toLowerCase()} accounting posting`,
        this.config.maxDescriptionLength,
      ) ??
      `Airtel ${resolvedOperation.toLowerCase()} accounting posting`;

    const debitAccountId =
      stringValue(
        input.debitAccountId ??
          input.debitAccount ??
          input.sourceAccountId ??
          operationEnvelope.debitAccountId ??
          operationEnvelope.debitAccount ??
          transactionEnvelope.debitAccountId ??
          transactionEnvelope.debitAccount,
        this.config.maxAccountIdLength,
      );

    const creditAccountId =
      stringValue(
        input.creditAccountId ??
          input.creditAccount ??
          input.destinationAccountId ??
          operationEnvelope.creditAccountId ??
          operationEnvelope.creditAccount ??
          transactionEnvelope.creditAccountId ??
          transactionEnvelope.creditAccount,
        this.config.maxAccountIdLength,
      );

    const lines =
      Array.isArray(input.lines)
        ? clone(input.lines)
        : Array.isArray(operationEnvelope.lines)
          ? clone(operationEnvelope.lines)
          : Array.isArray(transactionEnvelope.lines)
            ? clone(transactionEnvelope.lines)
            : Array.isArray(input.entries)
              ? clone(input.entries)
              : Array.isArray(operationEnvelope.entries)
                ? clone(operationEnvelope.entries)
                : Array.isArray(transactionEnvelope.entries)
                  ? clone(transactionEnvelope.entries)
                  : null;

    return {
      tenantId,
      provider,
      operation: resolvedOperation,
      transactionId,
      reference,
      originalIdempotencyKey,
      compensationIdempotencyKey:
        stringValue(
          input.compensationIdempotencyKey ??
            operationEnvelope.compensationIdempotencyKey ??
            transactionEnvelope.compensationIdempotencyKey,
          this.config.maxIdempotencyKeyLength,
        ),
      amountMinor,
      currency,
      providerReference,
      providerOutcome,
      providerConfirmed,
      postingKey,
      postingFingerprint: buildLedgerPostingFingerprint({
        tenantId,
        provider,
        operation: resolvedOperation,
        transactionId,
        originalIdempotencyKey,
        postingKey,
        reference,
        providerReference,
        amountMinor,
        currency,
        providerOutcome,
        lines,
      }),
      debitAccountId,
      creditAccountId,
      lines,
      description,
      requestedBy:
        actorIdOf(input.actor) ??
        stringValue(
          input.requestedBy ??
            input.requestedById ??
            operationEnvelope.requestedBy ??
            transactionEnvelope.requestedBy,
          200,
        ),
      actor,
      occurredAt,
      correlationId:
        stringValue(
          input.correlationId ??
            operationEnvelope.correlationId ??
            transactionEnvelope.correlationId ??
            settlementEnvelope.correlationId,
          240,
        ),
      causationId:
        stringValue(
          input.causationId ??
            operationEnvelope.causationId ??
            transactionEnvelope.causationId,
          240,
        ),
      metadata,
    };
  }

  #assertProviderAccountingSafe(
    context,
    {
      requireSuccess =
        this.config.requireProviderConfirmation,
    } = {},
  ) {
    if (
      this.config.rejectAmbiguousProviderOutcome &&
      (
        context.providerOutcome ===
          PROVIDER_OUTCOMES.AMBIGUOUS ||
        context.providerOutcome ===
          PROVIDER_OUTCOMES.UNKNOWN
      )
    ) {
      this.#throw(
        'LEDGER_BRIDGE_PROVIDER_OUTCOME_AMBIGUOUS',
        'Accounting cannot finalize while the provider outcome is ambiguous or unknown.',
        {
          providerOutcome:
            context.providerOutcome,
          providerReference:
            context.providerReference,
        },
        {
          httpStatus: 409,
          retryable: true,
          operation: context.operation,
        },
      );
    }

    if (
      context.providerOutcome ===
      PROVIDER_OUTCOMES.FAILURE
    ) {
      this.#throw(
        'LEDGER_BRIDGE_PROVIDER_FAILED',
        'A failed provider transaction cannot be posted as a successful accounting settlement.',
        {
          providerReference:
            context.providerReference,
        },
        {
          httpStatus: 409,
          operation: context.operation,
        },
      );
    }

    if (
      requireSuccess &&
      this.config.rejectUnconfirmedProviderOutcome &&
      context.providerOutcome !==
        PROVIDER_OUTCOMES.SUCCESS
    ) {
      if (
        context.providerOutcome ===
          PROVIDER_OUTCOMES.PENDING
      ) {
        this.#throw(
          'LEDGER_BRIDGE_PROVIDER_STILL_PENDING',
          'Accounting cannot finalize while the Airtel transaction remains pending.',
          {
            providerOutcome:
              context.providerOutcome,
            providerReference:
              context.providerReference,
          },
          {
            httpStatus: 409,
            retryable: true,
            operation: context.operation,
          },
        );
      }

      this.#throw(
        'LEDGER_BRIDGE_PROVIDER_NOT_CONFIRMED',
        'Accounting cannot finalize without confirmed provider success.',
        {
          providerOutcome:
            context.providerOutcome,
          providerReference:
            context.providerReference,
        },
        {
          httpStatus: 409,
          operation: context.operation,
        },
      );
    }

    return true;
  }

  #buildPostingLines(context) {
    if (Array.isArray(context.lines)) {
      return context.lines.map(
        (line, index) => {
          if (!isPlainObject(line)) {
            this.#throw(
              'LEDGER_BRIDGE_INVALID_POSTING_LINE',
              `Posting line ${index + 1} must be an object.`,
              {},
              { httpStatus: 422 },
            );
          }

          const accountId =
            stringValue(
              line.accountId ??
                line.accountCode,
              this.config.maxAccountIdLength,
            );

          if (!accountId) {
            this.#throw(
              'LEDGER_BRIDGE_ACCOUNT_REQUIRED',
              `Posting line ${index + 1} has no authoritative account identifier.`,
              {},
              { httpStatus: 422 },
            );
          }

          const direction = upper(
            line.direction,
          );

          if (
            direction !== 'DEBIT' &&
            direction !== 'CREDIT'
          ) {
            this.#throw(
              'LEDGER_BRIDGE_INVALID_DIRECTION',
              `Posting line ${index + 1} must be DEBIT or CREDIT.`,
              {},
              { httpStatus: 422 },
            );
          }

          const amount = normalizeAmount(
            line.amount,
          );

          if (!amount) {
            this.#throw(
              'LEDGER_BRIDGE_LINE_AMOUNT_REQUIRED',
              `Posting line ${index + 1} amount is required.`,
              {},
              { httpStatus: 422 },
            );
          }

          const currency =
            normalizeCurrency(
              line.currency ??
                context.currency,
              context.currency,
            );

          if (
            currency !== context.currency
          ) {
            this.#throw(
              'LEDGER_BRIDGE_CURRENCY_MISMATCH',
              `Posting line ${index + 1} currency does not match the posting currency.`,
              {},
              { httpStatus: 422 },
            );
          }

          return {
            accountId,
            direction,
            amount,
            currency,
            reference:
              stringValue(
                line.reference ??
                  context.reference,
                this.config.maxReferenceLength,
              ),
            description:
              stringValue(
                line.description ??
                  context.description,
                this.config.maxDescriptionLength,
              ),
            metadata: sanitize(
              line.metadata ?? {},
              0,
              this.config,
            ),
          };
        },
      );
    }

    if (
      context.debitAccountId &&
      context.creditAccountId
    ) {
      if (
        context.debitAccountId ===
        context.creditAccountId
      ) {
        this.#throw(
          'LEDGER_BRIDGE_IDENTICAL_ACCOUNTS',
          'Debit and credit accounts must be different.',
          {},
          { httpStatus: 422 },
        );
      }

      if (!context.amountMinor) {
        this.#throw(
          'LEDGER_BRIDGE_AMOUNT_REQUIRED',
          'amountMinor is required to build a two-line posting.',
          {},
          { httpStatus: 422 },
        );
      }

      return [
        {
          accountId:
            context.debitAccountId,
          direction: 'DEBIT',
          amount:
            context.amountMinor,
          currency:
            context.currency,
          reference:
            context.reference,
          description:
            context.description,
          metadata:
            context.metadata,
        },
        {
          accountId:
            context.creditAccountId,
          direction: 'CREDIT',
          amount:
            context.amountMinor,
          currency:
            context.currency,
          reference:
            context.reference,
          description:
            context.description,
          metadata:
            context.metadata,
        },
      ];
    }

    this.#throw(
      'LEDGER_BRIDGE_ACCOUNTING_INSTRUCTIONS_REQUIRED',
      'No authoritative accounting lines or debit/credit accounts were supplied for ledger fallback.',
      {
        transactionId:
          context.transactionId,
        reference:
          context.reference,
      },
      {
        httpStatus: 503,
        retryable: true,
        operation: context.operation,
      },
    );
  }

  #buildLedgerPostingInput(context) {
    const lines =
      this.#buildPostingLines(
        context,
      );

    return {
      tenantId:
        context.tenantId,
      postingKey:
        context.postingKey,
      transactionId:
        context.transactionId,
      paymentId:
        context.transactionId,
      provider:
        PROVIDER,
      providerReference:
        context.providerReference,
      postingType:
        context.operation ===
        'SETTLEMENT'
          ? 'SETTLEMENT'
          : 'PAYMENT',
      currency:
        context.currency,
      description:
        context.description,
      lines,
      requestedBy:
        context.requestedBy,
      source:
        COMPONENT,
      correlationId:
        context.correlationId,
      occurredAt:
        context.occurredAt,
      metadata: {
        ...context.metadata,
        provider:
          PROVIDER,
        providerReference:
          context.providerReference ??
          null,
        originalTransactionId:
          context.transactionId,
        originalIdempotencyKeyHash:
          context.originalIdempotencyKey
            ? sha256(
                context.originalIdempotencyKey,
              )
            : null,
        accountingPostingFingerprint:
          context.postingFingerprint,
        ledgerBridgeVersion:
          ENGINE_VERSION,
        schemaVersion:
          SCHEMA_VERSION,
      },
    };
  }

  #normalizeAccountingResult(
    context,
    raw,
    fallbackStatus,
  ) {
    const value =
      isPlainObject(raw)
        ? raw
        : {};

    const explicitStatus = upper(
      value.status ??
        value.outcome ??
        value.state,
    );

    const successStatus = new Set([
      'POSTED',
      'SETTLED',
      'COMPLETED',
      'SUCCESS',
      'SUCCEEDED',
      'SUCCESSFUL',
      'PAID',
      'ALREADY_POSTED',
      'REVERSED',
      'COMPENSATED',
    ]);

    const status =
      explicitStatus ??
      fallbackStatus ??
      BRIDGE_OUTCOMES.FAILED;

    const duplicate =
      value.duplicate === true ||
      value.replayed === true ||
      explicitStatus === 'ALREADY_POSTED' ||
      explicitStatus === 'REPLAY';

    const posted =
      value.posted === true ||
      value.settled === true ||
      value.success === true ||
      Boolean(
        value.posting ||
        value.journal ||
        value.journalEntry ||
        value.ledgerEntry ||
        value.ledgerReference ||
        value.journalId ||
        value.ledgerId,
      ) ||
      successStatus.has(explicitStatus);

    const ledgerReference =
      stringValue(
        value.postingKey ??
          value.ledgerReference ??
          value.journalId ??
          value.ledgerId ??
          value.posting?.postingKey ??
          value.posting?.journalId ??
          value.posting?.id ??
          value.posting?._id,
        this.config.maxPostingKeyLength,
      );

    const result = {
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        context.operation,
      status:
        posted
          ? duplicate
            ? BRIDGE_OUTCOMES.ALREADY_POSTED
            : fallbackStatus ??
              BRIDGE_OUTCOMES.POSTED
          : status ??
            BRIDGE_OUTCOMES.FAILED,
      outcome:
        posted
          ? duplicate
            ? BRIDGE_OUTCOMES.ALREADY_POSTED
            : fallbackStatus ??
              BRIDGE_OUTCOMES.POSTED
          : status ??
            BRIDGE_OUTCOMES.FAILED,
      posted,
      settled:
        value.settled === true ||
        (
          posted &&
          (
            explicitStatus === 'SETTLED' ||
            fallbackStatus === BRIDGE_OUTCOMES.SETTLED
          )
        ),
      duplicate,
      replay:
        value.replayed === true ||
        status === 'REPLAY',
      tenantId:
        context.tenantId,
      transactionId:
        stringValue(
          value.transactionId ??
            value.financialTransactionId ??
            context.transactionId,
          this.config.maxTransactionIdLength,
        ),
      reference:
        stringValue(
          value.reference ??
            context.reference,
          this.config.maxReferenceLength,
        ),
      postingKey:
        context.postingKey,
      ledgerReference,
      providerReference:
        context.providerReference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      postingFingerprint:
        context.postingFingerprint,
      raw: sanitize(
        value,
        0,
        this.config,
      ),
    };

    return result;
  }

  async #postThroughFinancialCore(
    context,
    payload,
    preferredMethods = [
      'postDisbursement',
      'settleDisbursement',
      'settleSuccessfulPayment',
      'settleProviderSettlement',
      'postProviderSettlement',
      'recordProviderSettlement',
      'postFinancialSettlement',
    ],
  ) {
    const method = this.#financialMethod(
      ...preferredMethods,
    );

    if (!method) {
      return null;
    }

    try {
      const result =
        await method.fn(payload);

      if (!hasAuthoritativeAccountingEvidence(result)) {
        this.#throw(
          'LEDGER_BRIDGE_FINANCIAL_CORE_EMPTY_RESULT',
          'Financial Core returned no accounting result.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
          },
        );
      }

      return {
        delegated: true,
        method:
          method.name,
        result,
      };
    } catch (error) {
      if (
        error instanceof
        AirtelLedgerBridgeError
      ) {
        throw error;
      }

      this.#log(
        'error',
        'Airtel accounting delegation to Financial Core failed.',
        {
          method: method.name,
          tenantId: context.tenantId,
          transactionId: context.transactionId,
          message: error?.message,
        },
      );

      this.#throw(
        'LEDGER_BRIDGE_FINANCIAL_CORE_FAILED',
        'Canonical Financial Core accounting delegation failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          operation: context.operation,
          cause: error,
        },
      );
    }
  }

  async #postThroughLedgerPostingService(
    context,
  ) {
    if (
      !this.config.allowLedgerPostingFallback
    ) {
      return null;
    }

    const method = this.#postingMethod(
      'post',
      'postJournal',
    );

    if (!method) {
      return null;
    }

    const postingInput =
      this.#buildLedgerPostingInput(
        context,
      );

    try {
      const result =
        await method.fn(
          postingInput,
          {
            session:
              context.session ??
              null,
          },
        );

      if (!hasAuthoritativeAccountingEvidence(result)) {
        this.#throw(
          'LEDGER_BRIDGE_POSTING_SERVICE_EMPTY_RESULT',
          'Canonical Ledger Posting Service returned no authoritative posting result.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
          },
        );
      }

      return {
        delegated: true,
        method:
          method.name,
        result,
      };
    } catch (error) {
      if (
        error instanceof
        AirtelLedgerBridgeError
      ) {
        throw error;
      }

      this.#log(
        'error',
        'Airtel accounting delegation to Ledger Posting Service failed.',
        {
          method: method.name,
          tenantId: context.tenantId,
          transactionId: context.transactionId,
          postingKey: context.postingKey,
          message: error?.message,
        },
      );

      this.#throw(
        'LEDGER_BRIDGE_POSTING_SERVICE_FAILED',
        'Canonical Ledger Posting Service accounting operation failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          operation: context.operation,
          cause: error,
        },
      );
    }
  }

  async #postThroughLegacyLedger(
    context,
  ) {
    const method = this.#legacyMethod(
      'postDoubleEntry',
      'postTransaction',
      'createJournal',
      'postJournal',
    );

    if (!method) {
      return null;
    }

    const lines =
      this.#buildPostingLines(
        context,
      );

    if (lines.length !== 2) {
      this.#throw(
        'LEDGER_BRIDGE_LEGACY_FALLBACK_UNSUPPORTED',
        'Legacy ledger fallback only supports an explicit two-sided posting.',
        {},
        { httpStatus: 503 },
      );
    }

    const [debit, credit] = lines;

    try {
      let result;

      if (
        method.name ===
        'postDoubleEntry'
      ) {
        result =
          await method.fn({
            tenantId:
              context.tenantId,
            transactionId:
              context.transactionId,
            debitAccount:
              debit.accountId,
            creditAccount:
              credit.accountId,
            amount:
              context.amountMinor,
            currency:
              context.currency,
            reference:
              context.reference ??
              context.postingKey,
            description:
              context.description,
            metadata:
              this.#buildLegacyMetadata(
                context,
              ),
            session:
              context.session ??
              null,
          });
      } else if (
        method.name ===
        'createJournal'
      ) {
        result =
          await method.fn({
            journalId:
              context.postingKey,
            sourceId:
              context.transactionId,
            tenantId:
              context.tenantId,
            description:
              context.description,
            reference:
              context.reference ??
              context.postingKey,
            currency:
              context.currency,
            entries:
              lines,
            metadata:
              this.#buildLegacyMetadata(
                context,
              ),
            session:
              context.session ??
              null,
          });
      } else {
        result =
          await method.fn({
            tenantId:
              context.tenantId,
            transactionId:
              context.transactionId,
            journalId:
              context.postingKey,
            reference:
              context.reference ??
              context.postingKey,
            amount:
              context.amountMinor,
            currency:
              context.currency,
            debitAccount:
              debit.accountId,
            creditAccount:
              credit.accountId,
            entries:
              lines,
            metadata:
              this.#buildLegacyMetadata(
                context,
              ),
            session:
              context.session ??
              null,
          });
      }

      if (!hasAuthoritativeAccountingEvidence(result)) {
        this.#throw(
          'LEDGER_BRIDGE_LEGACY_LEDGER_EMPTY_RESULT',
          'Explicit legacy ledger compatibility boundary returned no authoritative accounting result.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
          },
        );
      }

      return {
        delegated: true,
        legacy: true,
        method:
          method.name,
        result,
      };
    } catch (error) {
      this.#log(
        'error',
        'Explicit legacy Airtel ledger compatibility fallback failed.',
        {
          method: method.name,
          tenantId: context.tenantId,
          transactionId: context.transactionId,
          postingKey: context.postingKey,
          message: error?.message,
        },
      );

      this.#throw(
        'LEDGER_BRIDGE_LEGACY_LEDGER_FAILED',
        'Explicit legacy ledger compatibility operation failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          operation: context.operation,
          cause: error,
        },
      );
    }
  }

  #buildLegacyMetadata(context) {
    return sanitize(
      {
        ...context.metadata,
        provider:
          PROVIDER,
        providerReference:
          context.providerReference ??
          null,
        originalTransactionId:
          context.transactionId,
        originalIdempotencyKeyHash:
          context.originalIdempotencyKey
            ? sha256(
                context.originalIdempotencyKey,
              )
            : null,
        accountingPostingFingerprint:
          context.postingFingerprint,
        ledgerBridgeVersion:
          ENGINE_VERSION,
        schemaVersion:
          SCHEMA_VERSION,
      },
      0,
      this.config,
    );
  }

  async #executeAccountingPost(
    context,
    preferredFinancialMethods = undefined,
  ) {
    const financialPayload = {
      component:
        COMPONENT,
      schemaVersion:
        SCHEMA_VERSION,
      tenantId:
        context.tenantId,
      provider:
        PROVIDER,
      operation:
        context.operation,
      transactionId:
        context.transactionId,
      reference:
        context.reference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      postingKey:
        context.postingKey,
      postingFingerprint:
        context.postingFingerprint,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      providerReference:
        context.providerReference,
      providerOutcome:
        context.providerOutcome,
      providerConfirmed:
        context.providerConfirmed,
      debitAccountId:
        context.debitAccountId,
      creditAccountId:
        context.creditAccountId,
      lines:
        context.lines,
      requestedBy:
        context.requestedBy,
      actor:
        context.actor,
      occurredAt:
        context.occurredAt,
      correlationId:
        context.correlationId,
      causationId:
        context.causationId,
      session:
        context.session ??
        null,
      metadata:
        context.metadata,
      accounting: {
        mustNotCreateNewFinancialIdentity:
          true,
        mustPreserveOriginalIdempotency:
          true,
        mustNotMutateBalanceOutsideFinancialCore:
          true,
        source:
          COMPONENT,
      },
    };

    const fromFinancialCore =
      await this.#postThroughFinancialCore(
        context,
        financialPayload,
        preferredFinancialMethods ?? undefined,
      );

    if (fromFinancialCore) {
      return {
        ...fromFinancialCore,
        boundary:
          'FINANCIAL_CORE',
      };
    }

    const fromPostingService =
      await this.#postThroughLedgerPostingService(
        context,
      );

    if (fromPostingService) {
      return {
        ...fromPostingService,
        boundary:
          'LEDGER_POSTING_SERVICE',
      };
    }

    const fromLegacy =
      await this.#postThroughLegacyLedger(
        context,
      );

    if (fromLegacy) {
      return {
        ...fromLegacy,
        boundary:
          'LEGACY_LEDGER_COMPATIBILITY',
      };
    }

    this.#throw(
      'LEDGER_BRIDGE_ACCOUNTING_BOUNDARY_UNAVAILABLE',
      'No canonical accounting boundary is configured for Airtel disbursement settlement.',
      {
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
      },
      {
        retryable: true,
        httpStatus: 503,
        operation: context.operation,
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Public financial methods
   * ---------------------------------------------------------------------------
   */

  async postDisbursement(input = {}) {
    const context =
      this.normalizeContext(input, {
        operation:
          'DISBURSEMENT',
        requireTransactionId:
          this.config.requireTransactionIdentityForFinancialPost,
      });

    this.#assertProviderAccountingSafe(
      context,
      {
        requireSuccess:
          this.config.requireProviderConfirmation,
      },
    );

    const execution =
      await this.#executeAccountingPost(
        context,
        [
          'postDisbursement',
          'settleDisbursement',
          'settleSuccessfulPayment',
          'settleProviderSettlement',
          'postProviderSettlement',
          'recordProviderSettlement',
          'postFinancialSettlement',
        ],
      );

    const normalized =
      this.#normalizeAccountingResult(
        context,
        execution.result,
        BRIDGE_OUTCOMES.POSTED,
      );

    const result = {
      ...normalized,
      boundary:
        execution.boundary,
      delegatedMethod:
        execution.method ??
        null,
      providerConfirmed:
        context.providerConfirmed,
    };

    await this.#audit(
      result.duplicate
        ? 'AIRTEL_DISBURSEMENT_LEDGER_REPLAY'
        : 'AIRTEL_DISBURSEMENT_LEDGER_POSTED',
      context,
      result,
    );

    await this.#event(
      result.duplicate
        ? 'AIRTEL_DISBURSEMENT_LEDGER_REPLAYED'
        : 'AIRTEL_DISBURSEMENT_LEDGER_POSTED',
      context,
      result,
    );

    this.#metric(
      result.duplicate
        ? 'airtel_disbursement_ledger_replay_total'
        : 'airtel_disbursement_ledger_post_total',
      {
        boundary:
          execution.boundary,
      },
    );

    return result;
  }

  async settleDisbursement(input = {}) {
    const context =
      this.normalizeContext(input, {
        operation:
          'DISBURSEMENT',
        requireTransactionId:
          this.config.requireTransactionIdentityForFinancialPost,
      });

    this.#assertProviderAccountingSafe(
      context,
      {
        requireSuccess:
          true,
      },
    );

    const execution =
      await this.#executeAccountingPost(
        context,
        [
          'settleDisbursement',
          'settleSuccessfulPayment',
          'settleProviderSettlement',
          'postProviderSettlement',
          'recordProviderSettlement',
          'postFinancialSettlement',
          'postDisbursement',
        ],
      );

    const normalized =
      this.#normalizeAccountingResult(
        context,
        execution.result,
        BRIDGE_OUTCOMES.SETTLED,
      );

    const result = {
      ...normalized,
      settled:
        normalized.posted,
      settlementConfirmed:
        context.providerConfirmed,
      boundary:
        execution.boundary,
      delegatedMethod:
        execution.method ??
        null,
    };

    await this.#audit(
      result.duplicate
        ? 'AIRTEL_DISBURSEMENT_SETTLEMENT_REPLAY'
        : 'AIRTEL_DISBURSEMENT_SETTLED',
      context,
      result,
    );

    await this.#event(
      result.duplicate
        ? 'AIRTEL_DISBURSEMENT_SETTLEMENT_REPLAYED'
        : 'AIRTEL_DISBURSEMENT_SETTLED',
      context,
      result,
    );

    this.#metric(
      'airtel_disbursement_settlement_total',
      {
        boundary:
          execution.boundary,
      },
    );

    return result;
  }

  /**
   * Compatibility API used by the existing Airtel settlement service.
   *
   * This method intentionally delegates to Financial Core first. It does not
   * fabricate accounting accounts from the provider settlement payload.
   */
  async postSettlement(input = {}) {
    const context =
      this.normalizeContext(input, {
        operation:
          'SETTLEMENT',
        requireTransactionId:
          false,
        // Some existing Airtel settlement callers predate the canonical
        // idempotency header. Do not pretend a missing source key is an
        // original financial identity; the bridge still derives a stable
        // accounting posting key from the tenant/settlement identity.
        requireOriginalIdempotencyKey:
          false,
      });

    this.#assertProviderAccountingSafe(
      context,
      {
        requireSuccess:
          true,
      },
    );

    const financialMethod =
      this.#financialMethod(
        'postSettlement',
        'settleProviderSettlement',
        'postProviderSettlement',
        'recordProviderSettlement',
        'settleFinancialSettlement',
      );

    if (financialMethod) {
      const payload = {
        component:
          COMPONENT,
        schemaVersion:
          SCHEMA_VERSION,
        tenantId:
          context.tenantId,
        provider:
          PROVIDER,
        operation:
          'SETTLEMENT',
        settlement:
          sanitize(
            input.settlement ??
              input.operation ??
              input,
            0,
            this.config,
          ),
        transactionId:
          context.transactionId,
        reference:
          context.reference,
        originalIdempotencyKey:
          context.originalIdempotencyKey,
        postingKey:
          context.postingKey,
        postingFingerprint:
          context.postingFingerprint,
        amountMinor:
          context.amountMinor,
        currency:
          context.currency,
        providerReference:
          context.providerReference,
        providerOutcome:
          context.providerOutcome,
        providerConfirmed:
          context.providerConfirmed,
        actor:
          context.actor,
        session:
          context.session ??
          null,
        correlationId:
          context.correlationId,
        metadata:
          context.metadata,
      };

      try {
        const raw =
          await financialMethod.fn(
            payload,
          );
        const result = {
          ...this.#normalizeAccountingResult(
            context,
            raw,
            BRIDGE_OUTCOMES.SETTLED,
          ),
          boundary:
            'FINANCIAL_CORE',
          delegatedMethod:
            financialMethod.name,
          settled:
            Boolean(
              this.#normalizeAccountingResult(
                context,
                raw,
                BRIDGE_OUTCOMES.SETTLED,
              ).settled,
            ),
        };

        await this.#audit(
          'AIRTEL_SETTLEMENT_LEDGER_POSTED',
          context,
          result,
        );

        await this.#event(
          'AIRTEL_SETTLEMENT_LEDGER_POSTED',
          context,
          result,
        );

        return result;
      } catch (error) {
        if (
          error instanceof
          AirtelLedgerBridgeError
        ) {
          throw error;
        }

        this.#throw(
          'LEDGER_BRIDGE_SETTLEMENT_FAILED',
          'Canonical Financial Core settlement posting failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: 'SETTLEMENT',
            cause: error,
          },
        );
      }
    }

    /**
     * For compatibility, a settlement call may still be processed through the
     * generic accounting path only when explicit accounting instructions have
     * been supplied. No accounts are inferred here.
     */
    const execution =
      await this.#executeAccountingPost(
        context,
      );

    const result = {
      ...this.#normalizeAccountingResult(
        context,
        execution.result,
        BRIDGE_OUTCOMES.SETTLED,
      ),
      boundary:
        execution.boundary,
      delegatedMethod:
        execution.method ??
        null,
      settled:
        Boolean(
          this.#normalizeAccountingResult(
            context,
            execution.result,
            BRIDGE_OUTCOMES.SETTLED,
          ).settled,
        ),
    };

    await this.#audit(
      'AIRTEL_SETTLEMENT_LEDGER_POSTED',
      context,
      result,
    );

    await this.#event(
      'AIRTEL_SETTLEMENT_LEDGER_POSTED',
      context,
      result,
    );

    return result;
  }

  async getPosting(input = {}) {
    const context =
      this.normalizeContext(input, {
        operation:
          input.operationType ??
          input.operation?.type ??
          'DISBURSEMENT',
        requireTransactionId:
          false,
        requireOriginalIdempotencyKey:
          false,
      });

    const method =
      this.#postingMethod(
        'getPosting',
        'findPostingByIdempotencyKey',
        'getByPostingKey',
      );

    if (method) {
      try {
        let result;

        if (
          method.name ===
          'findPostingByIdempotencyKey'
        ) {
          result =
            await method.fn({
              tenantId:
                context.tenantId,
              postingKey:
                context.postingKey,
              session:
                context.session ??
                null,
            });
        } else {
          result =
            await method.fn({
              tenantId:
                context.tenantId,
              postingKey:
                context.postingKey,
              transactionId:
                context.transactionId,
              session:
                context.session ??
                null,
            });
        }

        return {
          found:
            Boolean(result),
          posting:
            sanitize(
              result,
              0,
              this.config,
            ),
          tenantId:
            context.tenantId,
          postingKey:
            context.postingKey,
          transactionId:
            context.transactionId,
        };
      } catch (error) {
        this.#throw(
          'LEDGER_BRIDGE_POSTING_LOOKUP_FAILED',
          'Canonical ledger posting lookup failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
            cause: error,
          },
        );
      }
    }

    const financialMethod =
      this.#financialMethod(
        'getPosting',
        'getLedgerPosting',
        'findLedgerPosting',
        'getFinancialPosting',
      );

    if (financialMethod) {
      try {
        const result =
          await financialMethod.fn({
            tenantId:
              context.tenantId,
            postingKey:
              context.postingKey,
            transactionId:
              context.transactionId,
            reference:
              context.reference,
          });

        return {
          found:
            Boolean(result),
          posting:
            sanitize(
              result,
              0,
              this.config,
            ),
          tenantId:
            context.tenantId,
          postingKey:
            context.postingKey,
          transactionId:
            context.transactionId,
        };
      } catch (error) {
        this.#throw(
          'LEDGER_BRIDGE_FINANCIAL_POSTING_LOOKUP_FAILED',
          'Financial Core ledger posting lookup failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
            cause: error,
          },
        );
      }
    }

    return {
      found: false,
      posting: null,
      tenantId:
        context.tenantId,
      postingKey:
        context.postingKey,
      transactionId:
        context.transactionId,
      supported: false,
    };
  }

  async verifySettlement(input = {}) {
    const context =
      this.normalizeContext(input, {
        operation:
          'SETTLEMENT',
        requireTransactionId:
          false,
        requireOriginalIdempotencyKey:
          false,
      });

    const method =
      this.#financialMethod(
        'verifyDisbursementSettlement',
        'verifySettlement',
        'verifyFinancialSettlement',
        'verifyProviderSettlement',
        'confirmSettlement',
      ) ??
      this.#reconciliationMethod(
        'verifySettlement',
        'verifyDisbursement',
        'confirmSettlement',
        'verify',
      );

    if (!method) {
      return {
        verified: false,
        status:
          BRIDGE_OUTCOMES.NOT_VERIFIED,
        reason:
          'No authoritative Financial Core or reconciliation verification method is configured.',
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        postingKey:
          context.postingKey,
      };
    }

    try {
      const verification =
        await method.fn({
          component:
            COMPONENT,
          tenantId:
            context.tenantId,
          provider:
            PROVIDER,
          operation:
            context.operation,
          transactionId:
            context.transactionId,
          reference:
            context.reference,
          originalIdempotencyKey:
            context.originalIdempotencyKey,
          postingKey:
            context.postingKey,
          amountMinor:
            context.amountMinor,
          currency:
            context.currency,
          providerReference:
            context.providerReference,
          providerOutcome:
            context.providerOutcome,
          providerConfirmed:
            context.providerConfirmed,
          reconciliation:
            input.reconciliation ??
            null,
          metadata:
            context.metadata,
        });

      const status = upper(
        verification?.status ??
          verification?.outcome ??
          verification?.state,
      );

      const verified =
        verification?.verified === true ||
        verification?.confirmed === true ||
        verification?.settled === true ||
        [
          'VERIFIED',
          'CONFIRMED',
          'SETTLED',
          'POSTED',
          'SUCCESS',
        ].includes(status);

      const result = {
        verified,
        status:
          verified
            ? BRIDGE_OUTCOMES.VERIFIED
            : BRIDGE_OUTCOMES.NOT_VERIFIED,
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        reference:
          context.reference,
        postingKey:
          context.postingKey,
        providerReference:
          context.providerReference,
        evidence:
          sanitize(
            verification,
            0,
            this.config,
          ),
      };

      await this.#audit(
        verified
          ? 'AIRTEL_SETTLEMENT_VERIFIED'
          : 'AIRTEL_SETTLEMENT_NOT_VERIFIED',
        context,
        result,
      );

      return result;
    } catch (error) {
      this.#throw(
        'LEDGER_BRIDGE_SETTLEMENT_VERIFICATION_FAILED',
        'Authoritative settlement verification failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          operation: context.operation,
          cause: error,
        },
      );
    }
  }

  async reverse(input = {}) {
    const context =
      this.normalizeContext(input, {
        operation:
          'REVERSAL',
        requireTransactionId:
          false,
      });

    if (
      context.providerOutcome ===
      PROVIDER_OUTCOMES.AMBIGUOUS ||
      context.providerOutcome ===
      PROVIDER_OUTCOMES.UNKNOWN
    ) {
      this.#throw(
        'LEDGER_BRIDGE_REVERSAL_REQUIRES_RECONCILIATION',
        'A reversal cannot be created from an ambiguous or unknown provider outcome without authoritative reconciliation.',
        {},
        {
          httpStatus: 409,
          retryable: true,
          operation: context.operation,
        },
      );
    }

    const compensationIdempotencyKey =
      context.compensationIdempotencyKey ??
      stringValue(
        input.reversalIdempotencyKey ??
          input.compensationKey,
        this.config.maxIdempotencyKeyLength,
      );

    if (!compensationIdempotencyKey) {
      this.#throw(
        'LEDGER_BRIDGE_REVERSAL_IDEMPOTENCY_REQUIRED',
        'A distinct reversal/compensation idempotency key is required.',
        {},
        {
          httpStatus: 422,
          operation: context.operation,
        },
      );
    }

    if (
      context.originalIdempotencyKey &&
      compensationIdempotencyKey ===
        context.originalIdempotencyKey
    ) {
      this.#throw(
        'LEDGER_BRIDGE_REVERSAL_IDEMPOTENCY_COLLISION',
        'Reversal idempotency identity must be distinct from the original financial identity.',
        {},
        {
          httpStatus: 409,
          operation: context.operation,
        },
      );
    }

    const financialMethod =
      this.#financialMethod(
        'reverseDisbursement',
        'reverseSettlement',
        'reverseFinancialTransaction',
        'executeReversal',
        'reverse',
      );

    const reversalPostingKey =
      stringValue(
        input.reversalPostingKey,
        this.config.maxPostingKeyLength,
      ) ??
      buildReversalPostingKey({
        tenantId:
          context.tenantId,
        provider:
          PROVIDER,
        operation:
          'REVERSAL',
        originalPostingKey:
          context.postingKey,
        compensationIdempotencyKey,
      });

    const originalPosting =
      input.originalPosting ??
      input.posting ??
      null;

    if (financialMethod) {
      try {
        const result =
          await financialMethod.fn({
            component:
              COMPONENT,
            schemaVersion:
              SCHEMA_VERSION,
            tenantId:
              context.tenantId,
            provider:
              PROVIDER,
            operation:
              'REVERSAL',
            transactionId:
              context.transactionId,
            reference:
              context.reference,
            originalIdempotencyKey:
              context.originalIdempotencyKey,
            compensationIdempotencyKey,
            originalPostingKey:
              context.postingKey,
            reversalPostingKey,
            originalPosting:
              sanitize(
                originalPosting,
                0,
                this.config,
              ),
            reason:
              stringValue(
                input.reason ??
                  input.reasonCode ??
                  'Airtel disbursement reversal',
                this.config.maxDescriptionLength,
              ),
            actor:
              context.actor,
            session:
              context.session ??
              null,
            correlationId:
              context.correlationId,
            metadata:
              context.metadata,
          });

        const normalized =
          this.#normalizeAccountingResult(
            context,
            result,
            BRIDGE_OUTCOMES.REVERSED,
          );

        const output = {
          ...normalized,
          outcome:
            BRIDGE_OUTCOMES.REVERSED,
          status:
            BRIDGE_OUTCOMES.REVERSED,
          reversed:
            result?.reversed === true ||
            normalized.posted === true ||
            result?.success === true,
          compensationIdempotencyKey,
          reversalPostingKey,
          boundary:
            'FINANCIAL_CORE',
          delegatedMethod:
            financialMethod.name,
        };

        await this.#audit(
          'AIRTEL_DISBURSEMENT_REVERSED',
          {
            ...context,
            compensationIdempotencyKey,
            postingKey:
              reversalPostingKey,
          },
          output,
        );

        return output;
      } catch (error) {
        if (
          error instanceof
          AirtelLedgerBridgeError
        ) {
          throw error;
        }

        this.#throw(
          'LEDGER_BRIDGE_FINANCIAL_REVERSAL_FAILED',
          'Financial Core reversal failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
            cause: error,
          },
        );
      }
    }

    const postingMethod =
      this.#postingMethod(
        'reverse',
        'reverseJournal',
      );

    if (!postingMethod) {
      this.#throw(
        'LEDGER_BRIDGE_REVERSAL_BOUNDARY_UNAVAILABLE',
        'No canonical financial reversal boundary is configured.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          operation: context.operation,
        },
      );
    }

    let effectiveOriginalPosting =
      originalPosting;

    if (!effectiveOriginalPosting) {
      const lookup =
        await this.getPosting({
          tenantId:
            context.tenantId,
          transactionId:
            context.transactionId,
          postingKey:
            context.postingKey,
          originalIdempotencyKey:
            context.originalIdempotencyKey,
          operation:
            'DISBURSEMENT',
        });

      effectiveOriginalPosting =
        lookup.posting;
    }

    if (!effectiveOriginalPosting) {
      this.#throw(
        'LEDGER_BRIDGE_ORIGINAL_POSTING_NOT_FOUND',
        'The original accounting posting required for reversal was not found.',
        {
          postingKey:
            context.postingKey,
          transactionId:
            context.transactionId,
        },
        {
          httpStatus: 404,
          operation: context.operation,
        },
      );
    }

    try {
      const result =
        await postingMethod.fn(
          {
            tenantId:
              context.tenantId,
            originalPosting:
              effectiveOriginalPosting,
            reversalPostingKey,
            reason:
              stringValue(
                input.reason ??
                  input.reasonCode ??
                  'Airtel disbursement reversal',
                this.config.maxDescriptionLength,
              ),
            requestedBy:
              context.requestedBy,
            session:
              context.session ??
              null,
          },
          {
            session:
              context.session ??
              null,
          },
        );

      const output = {
        ...this.#normalizeAccountingResult(
          context,
          result,
          BRIDGE_OUTCOMES.REVERSED,
        ),
        outcome:
          BRIDGE_OUTCOMES.REVERSED,
        status:
          BRIDGE_OUTCOMES.REVERSED,
        reversed:
          true,
        compensationIdempotencyKey,
        reversalPostingKey,
        boundary:
          'LEDGER_POSTING_SERVICE',
        delegatedMethod:
          postingMethod.name,
      };

      await this.#audit(
        'AIRTEL_DISBURSEMENT_REVERSED',
        {
          ...context,
          compensationIdempotencyKey,
          postingKey:
            reversalPostingKey,
        },
        output,
      );

      return output;
    } catch (error) {
      if (
        error instanceof
        AirtelLedgerBridgeError
      ) {
        throw error;
      }

      this.#throw(
        'LEDGER_BRIDGE_REVERSAL_FAILED',
        'Canonical ledger reversal failed.',
        {},
        {
          retryable: true,
          httpStatus: 503,
          operation: context.operation,
          cause: error,
        },
      );
    }
  }

  async compensate(input = {}) {
    const context =
      this.normalizeContext(input, {
        operation:
          'COMPENSATION',
        requireTransactionId:
          false,
      });

    const compensationIdempotencyKey =
      context.compensationIdempotencyKey ??
      stringValue(
        input.compensationKey ??
          input.compensationIdempotencyKey ??
          input.reversalIdempotencyKey,
        this.config.maxIdempotencyKeyLength,
      );

    if (!compensationIdempotencyKey) {
      this.#throw(
        'LEDGER_BRIDGE_COMPENSATION_IDEMPOTENCY_REQUIRED',
        'A distinct compensation idempotency key is required.',
        {},
        {
          httpStatus: 422,
          operation: context.operation,
        },
      );
    }

    if (
      context.originalIdempotencyKey &&
      compensationIdempotencyKey ===
        context.originalIdempotencyKey
    ) {
      this.#throw(
        'LEDGER_BRIDGE_COMPENSATION_IDEMPOTENCY_COLLISION',
        'Compensation idempotency identity must be distinct from the original financial identity.',
        {},
        {
          httpStatus: 409,
          operation: context.operation,
        },
      );
    }

    const compensationMethod =
      this.#financialMethod(
        'executeCompensation',
        'compensate',
        'executeCorrectiveOperation',
        'createCompensation',
      );

    if (compensationMethod) {
      try {
        const result =
          await compensationMethod.fn({
            component:
              COMPONENT,
            schemaVersion:
              SCHEMA_VERSION,
            tenantId:
              context.tenantId,
            provider:
              PROVIDER,
            operation:
              'COMPENSATION',
            transactionId:
              context.transactionId,
            reference:
              context.reference,
            originalIdempotencyKey:
              context.originalIdempotencyKey,
            compensationIdempotencyKey,
            originalPostingKey:
              context.postingKey,
            amountMinor:
              context.amountMinor,
            currency:
              context.currency,
            providerReference:
              context.providerReference,
            providerOutcome:
              context.providerOutcome,
            reasonCode:
              stringValue(
                input.reasonCode ??
                  input.reason,
                160,
              ),
            reason:
              stringValue(
                input.reason ??
                  input.reasonCode ??
                  'Airtel disbursement compensation',
                this.config.maxDescriptionLength,
              ),
            actor:
              context.actor,
            session:
              context.session ??
              null,
            correlationId:
              context.correlationId,
            metadata:
              context.metadata,
          });

        const output = {
          outcome:
            result?.outcome ??
            BRIDGE_OUTCOMES.REVERSED,
          status:
            result?.status ??
            BRIDGE_OUTCOMES.REVERSED,
          compensated:
            result?.compensated === true ||
            result?.success === true ||
            [
              'SUCCESS',
              'SUCCEEDED',
              'SUCCESSFUL',
              'COMPLETED',
              'COMPENSATED',
              'REVERSED',
            ].includes(
              upper(
                result?.status ??
                  result?.outcome ??
                  result?.state,
              ),
            ),
          tenantId:
            context.tenantId,
          transactionId:
            context.transactionId,
          originalIdempotencyKey:
            context.originalIdempotencyKey,
          compensationIdempotencyKey,
          originalPostingKey:
            context.postingKey,
          providerReference:
            context.providerReference,
          boundary:
            'FINANCIAL_CORE',
          delegatedMethod:
            compensationMethod.name,
          evidence:
            sanitize(
              result,
              0,
              this.config,
            ),
        };

        await this.#audit(
          'AIRTEL_DISBURSEMENT_COMPENSATED',
          {
            ...context,
            compensationIdempotencyKey,
          },
          output,
        );

        return output;
      } catch (error) {
        if (
          error instanceof
          AirtelLedgerBridgeError
        ) {
          throw error;
        }

        this.#throw(
          'LEDGER_BRIDGE_COMPENSATION_FAILED',
          'Financial Core compensation execution failed.',
          {},
          {
            retryable: true,
            httpStatus: 503,
            operation: context.operation,
            cause: error,
          },
        );
      }
    }

    return this.reverse({
      ...input,
      tenantId:
        context.tenantId,
      provider:
        PROVIDER,
      transactionId:
        context.transactionId,
      reference:
        context.reference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      compensationIdempotencyKey,
      postingKey:
        context.postingKey,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      providerReference:
        context.providerReference,
      providerOutcome:
        context.providerOutcome,
      operation:
        'REVERSAL',
    });
  }

  async verify(input = {}) {
    return this.verifySettlement(
      input,
    );
  }

  async post(input = {}) {
    return this.postDisbursement(
      input,
    );
  }

  async settle(input = {}) {
    return this.settleDisbursement(
      input,
    );
  }

  async reverseDisbursement(input = {}) {
    return this.reverse(input);
  }

  async executeCompensation(input = {}) {
    return this.compensate(input);
  }

  /**
   * ---------------------------------------------------------------------------
   * Operational introspection
   * ---------------------------------------------------------------------------
   */

  async health() {
    const financialCoreConfigured =
      Boolean(this.financialCore);
    const ledgerPostingConfigured =
      Boolean(this.ledgerPostingService);
    const reconciliationConfigured =
      Boolean(this.reconciliationService);
    const legacyConfigured =
      Boolean(
        this.legacyLedgerService,
      );

    let financialCoreHealth =
      null;

    try {
      const method =
        this.#financialMethod(
          'health',
          'healthCheck',
          'readiness',
          'isReady',
        );

      if (method) {
        financialCoreHealth =
          await method.fn();
      }
    } catch (error) {
      financialCoreHealth = {
        healthy: false,
        error:
          stringValue(
            error?.message,
            240,
          ),
      };
    }

    const healthy =
      financialCoreConfigured ||
      ledgerPostingConfigured ||
      (
        this.config
          .allowLegacyLedgerServiceFallback &&
        legacyConfigured
      );

    return {
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        DEFAULT_OPERATION,
      version:
        ENGINE_VERSION,
      healthy,
      status:
        healthy
          ? 'UP'
          : 'DEGRADED',
      boundaries: {
        financialCore:
          financialCoreConfigured,
        ledgerPostingService:
          ledgerPostingConfigured,
        reconciliation:
          reconciliationConfigured,
        legacyLedgerCompatibility:
          legacyConfigured &&
          this.config
            .allowLegacyLedgerServiceFallback,
      },
      financialCoreHealth:
        sanitize(
          financialCoreHealth,
          0,
          this.config,
        ),
      controls: {
        tenantIsolation:
          this.config.requireTenantId,
        originalIdempotencyRequired:
          this.config.requireOriginalIdempotencyKey,
        providerConfirmationRequired:
          this.config.requireProviderConfirmation,
        ambiguousOutcomeRejected:
          this.config.rejectAmbiguousProviderOutcome,
        ledgerPostingFallback:
          this.config.allowLedgerPostingFallback,
        legacyLedgerFallback:
          this.config.allowLegacyLedgerServiceFallback,
      },
    };
  }

  async readiness() {
    return this.health();
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,
      operation:
        DEFAULT_OPERATION,
      tenantScoped:
        true,
      deterministicPostingIdentity:
        true,
      deterministicPostingFingerprint:
        true,
      originalFinancialIdentityPreserved:
        true,
      separateCompensationIdentity:
        true,
      ambiguousProviderOutcomeBlocked:
        this.config.rejectAmbiguousProviderOutcome,
      providerConfirmationRequired:
        this.config.requireProviderConfirmation,
      directProviderCall:
        false,
      directDatabaseWrite:
        false,
      directLedgerMutation:
        false,
      directBalanceMutation:
        false,
      directWalletMutation:
        false,
      accountSelectionFromProviderReference:
        false,
      reconciliationAuthority:
        false,
      financialFinalityAuthority:
        false,
      canonicalFinancialBoundary:
        'TITECH_FINANCIAL_CORE',
      canonicalAccountingFallback:
        'LEDGER_POSTING_SERVICE',
    });
  }

  async diagnostics() {
    return {
      component:
        COMPONENT,
      version:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      provider:
        PROVIDER,
      operation:
        DEFAULT_OPERATION,
      health:
        await this.health(),
      capabilities:
        this.capabilities(),
      contracts: {
        primary:
          this.#financialMethod(
            'postDisbursement',
            'settleDisbursement',
            'settleSuccessfulPayment',
            'settleProviderSettlement',
            'postProviderSettlement',
            'recordProviderSettlement',
            'postFinancialSettlement',
          )?.name ?? null,
        ledgerPosting:
          this.#postingMethod(
            'post',
            'postJournal',
          )?.name ?? null,
        verification:
          this.#financialMethod(
            'verifyDisbursementSettlement',
            'verifySettlement',
            'verifyFinancialSettlement',
            'verifyProviderSettlement',
            'confirmSettlement',
          )?.name ??
          this.#reconciliationMethod(
            'verifySettlement',
            'verifyDisbursement',
            'confirmSettlement',
            'verify',
          )?.name ?? null,
        reversal:
          this.#financialMethod(
            'reverseDisbursement',
            'reverseSettlement',
            'reverseFinancialTransaction',
            'executeReversal',
            'reverse',
          )?.name ??
          this.#postingMethod(
            'reverse',
            'reverseJournal',
          )?.name ?? null,
        compensation:
          this.#financialMethod(
            'executeCompensation',
            'compensate',
            'executeCorrectiveOperation',
            'createCompensation',
          )?.name ?? null,
      },
      financialBoundary: {
        providerCalls:
          false,
        databaseWrites:
          false,
        ledgerWrites:
          false,
        balanceMutation:
          false,
        walletMutation:
          false,
        finalityAuthority:
          'TITECH_FINANCIAL_CORE',
      },
    };
  }
}

/**
 * =============================================================================
 * Factories / stable aliases
 * =============================================================================
 */

export const createLedgerBridge = (
  options = {},
) =>
  new AirtelDisbursementLedgerBridge(
    options,
  );

export const createAirtelLedgerBridge =
  createLedgerBridge;

export const createAirtelDisbursementLedgerBridge =
  createLedgerBridge;

export const LedgerBridge =
  AirtelDisbursementLedgerBridge;

export const defaultLedgerBridge =
  createLedgerBridge();

export const ledgerBridge =
  defaultLedgerBridge;

export default Object.freeze({
  ENGINE_NAME,
  ENGINE_VERSION,
  COMPONENT,
  PROVIDER,
  DEFAULT_OPERATION,
  SCHEMA_VERSION,
  BRIDGE_OUTCOMES,
  PROVIDER_OUTCOMES,
  DEFAULT_CONFIG,
  AirtelLedgerBridgeError,
  AirtelDisbursementLedgerBridge,
  LedgerBridge,
  createLedgerBridge,
  createAirtelLedgerBridge,
  createAirtelDisbursementLedgerBridge,
  buildLedgerPostingKey,
  buildReversalPostingKey,
  buildLedgerPostingFingerprint,
  defaultLedgerBridge,
  ledgerBridge,
});