'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collection Ledger Bridge
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/collections/ledgerBridge.js
 *
 * Architectural role
 * ------------------
 * Canonical accounting-adapter boundary between the Airtel inbound collection
 * bounded context and TITech's authoritative Financial Core.
 *
 * The bridge translates a provider-confirmed COLLECTION outcome into a safe,
 * deterministic accounting command and delegates financial mutation to the
 * canonical accounting boundary. It is not a ledger implementation.
 *
 * Canonical path
 * --------------
 *
 *   Airtel CollectionService
 *            |
 *            v
 *     Collection Ledger Bridge
 *            |
 *            +------------------------------+
 *            |                              |
 *            v                              v
 *   Financial Core                  Reconciliation / Verification
 *            |
 *            v
 *     Canonical Ledger
 *
 * Responsibilities
 * ----------------
 * - Enforce tenant/provider/operation scope.
 * - Preserve original collection transaction identity.
 * - Preserve original collection idempotency identity.
 * - Derive deterministic tenant-scoped accounting posting identities.
 * - Validate exact minor-unit money representations.
 * - Reject unknown, ambiguous, pending and failed provider outcomes for
 *   accounting finalization.
 * - Delegate accounting mutation to the injected Financial Core.
 * - Optionally delegate to an explicitly enabled canonical posting service.
 * - Support authoritative posting lookup, settlement verification, reversal and
 *   compensation delegation.
 * - Emit bounded audit/event/metric evidence without leaking secrets.
 * - Expose health/readiness/capability/diagnostic information.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel HTTP/API calls.
 * - No provider authentication or credentials.
 * - No callback reception/signature verification.
 * - No KYC/AML/sanctions/fraud adjudication.
 * - No direct MongoDB/Mongoose/Redis access.
 * - No direct ledger/journal persistence.
 * - No direct balance/wallet mutation.
 * - No financial authorization or maker-checker policy.
 * - No reconciliation finality.
 * - No autonomous retry of provider operations.
 * - No creation of replacement financial or idempotency identities.
 *
 * Financial-safety principles
 * ---------------------------
 * 1. Provider success is necessary but the Financial Core remains the authority
 *    for accounting finality.
 * 2. ACCEPTED/PENDING/UNKNOWN/AMBIGUOUS/TIMEOUT outcomes never become success
 *    merely because the transport returned without an exception.
 * 3. The original transaction and idempotency identities remain immutable.
 * 4. Reversal/compensation uses a distinct corrective identity linked to the
 *    original collection identity.
 * 5. Account identifiers are accounting-owned data; provider references are
 *    never promoted to accounting accounts.
 * 6. The bridge never reports settlement merely because it constructed a
 *    posting command.
 * 7. Observability failures never undo a successful authoritative financial
 *    operation.
 * 8. Cache is not financial truth.
 * 9. All persisted/delegated financial mutations must be atomic at the
 *    authoritative boundary.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.collections.ledger-bridge';
export const ENGINE_NAME = 'airtel-collection-ledger-bridge';
export const ENGINE_VERSION = '4.0.0';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 4;
export const HASH_ALGORITHM = 'sha256';

export const BRIDGE_OUTCOMES = Object.freeze({
  POSTED: 'POSTED',
  SETTLED: 'SETTLED',
  ALREADY_POSTED: 'ALREADY_POSTED',
  VERIFIED: 'VERIFIED',
  NOT_VERIFIED: 'NOT_VERIFIED',
  REVERSED: 'REVERSED',
  COMPENSATED: 'COMPENSATED',
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
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
});

export const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  requireAirtelProvider: true,
  requireCollectionOperation: true,
  requireTransactionIdentityForPost: true,
  requireOriginalIdempotencyKeyForPost: true,
  requireAmountMinor: true,
  requireCurrency: true,
  requireProviderConfirmation: true,
  rejectAmbiguousProviderOutcome: true,
  rejectUnconfirmedProviderOutcome: true,
  allowLedgerPostingFallback: false,
  allowLegacyLedgerServiceFallback: false,
  defaultCurrency: 'UGX',
  maxTenantIdLength: 160,
  maxTransactionIdLength: 240,
  maxReferenceLength: 240,
  maxIdempotencyKeyLength: 240,
  maxPostingKeyLength: 320,
  maxProviderReferenceLength: 240,
  maxAccountIdLength: 256,
  maxCurrencyLength: 3,
  maxDescriptionLength: 500,
  maxReasonLength: 1000,
  maxMetadataDepth: 5,
  maxMetadataKeys: 70,
  maxMetadataArrayLength: 50,
  maxMetadataStringLength: 1000,
  maxLineCount: 20,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
});

export const FINANCIAL_BOUNDARY = Object.freeze({
  providerHttp: false,
  directDatabaseWrite: false,
  directLedgerWrite: false,
  directJournalWrite: false,
  directBalanceMutation: false,
  directWalletMutation: false,
  authorization: false,
  reconciliationFinality: false,
  settlementFinality: false,
  preserveOriginalTransactionIdentity: true,
  preserveOriginalIdempotencyIdentity: true,
  authoritativeBoundary: 'TITECH_FINANCIAL_CORE',
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
  'CONFIRMED_SUCCESS',
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
  'CONFIRMED_FAILURE',
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
  /(password|secret|token|authorization|cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|client.?secret|raw(request|response)|provider.?payload|access.?token|refresh.?token)/i;

const UNSAFE_MONGO_KEY_PATTERN = /(^\$)|\./;

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPlainObject(value) {
  return (
    isObject(value) &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function upper(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value)
    .trim()
    .toUpperCase();

  return normalized || undefined;
}

function stringValue(
  value,
  maxLength = 240,
) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();

  return normalized
    ? normalized.slice(0, maxLength)
    : undefined;
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(
      JSON.stringify(value),
    );
  } catch {
    return isPlainObject(value)
      ? { ...value }
      : value;
  }
}

function stableSerialize(value) {
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }

  if (typeof value === 'bigint') {
    return `bigint:${value.toString()}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(
            key,
          )}:${stableSerialize(
            value[key],
          )}`,
      )
      .join(',')}}`;
  }

  if (
    typeof value === 'number' &&
    Object.is(value, -0)
  ) {
    return '0';
  }

  return JSON.stringify(value);
}

function sha256(value) {
  return createHash(
    HASH_ALGORITHM,
  )
    .update(
      typeof value === 'string'
        ? value
        : stableSerialize(value),
      'utf8',
    )
    .digest('hex');
}

function sanitize(
  value,
  depth = 0,
  config = DEFAULT_CONFIG,
) {
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
      .map((item) =>
        sanitize(
          item,
          depth + 1,
          config,
        ),
      );
  }

  if (!isObject(value)) {
    return String(value);
  }

  const output = {};

  for (const key of Object.keys(
    value,
  ).slice(
    0,
    config.maxMetadataKeys,
  )) {
    if (
      PRIVATE_KEYS.has(key) ||
      UNSAFE_MONGO_KEY_PATTERN.test(key)
    ) {
      continue;
    }

    output[key] =
      SECRET_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : sanitize(
            value[key],
            depth + 1,
            config,
          );
  }

  return output;
}

function nowMs(clock) {
  try {
    const value =
      clock &&
      typeof clock.now ===
        'function'
        ? clock.now()
        : Date.now();

    if (value instanceof Date) {
      return value.getTime();
    }

    const numeric = Number(value);

    return Number.isFinite(numeric)
      ? numeric
      : Date.now();
  } catch {
    return Date.now();
  }
}

function nowIso(clock) {
  return new Date(
    nowMs(clock),
  ).toISOString();
}

function normalizeAmountMinor(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  if (typeof value === 'number') {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value <= 0
    ) {
      throw new AirtelCollectionLedgerBridgeError(
        'amountMinor must be a positive safe integer when supplied as a number.',
        {
          code:
            'LEDGER_BRIDGE_INVALID_AMOUNT',
          httpStatus: 422,
        },
      );
    }

    return String(value);
  }

  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new AirtelCollectionLedgerBridgeError(
        'amountMinor must be greater than zero.',
        {
          code:
            'LEDGER_BRIDGE_INVALID_AMOUNT',
          httpStatus: 422,
        },
      );
    }

    return value.toString();
  }

  const normalized = String(
    value,
  ).trim();

  if (
    !/^\d+$/.test(normalized) ||
    /^0+$/.test(normalized)
  ) {
    throw new AirtelCollectionLedgerBridgeError(
      'amountMinor must be a positive integer minor-unit representation.',
      {
        code:
          'LEDGER_BRIDGE_INVALID_AMOUNT',
        httpStatus: 422,
      },
    );
  }

  return normalized.replace(
    /^0+(?=\d)/,
    '',
  );
}

function normalizeCurrency(
  value,
  fallback = DEFAULT_CONFIG.defaultCurrency,
) {
  const normalized = upper(
    value ?? fallback,
  );

  if (
    !normalized ||
    !/^[A-Z]{3}$/.test(normalized)
  ) {
    throw new AirtelCollectionLedgerBridgeError(
      'currency must be a valid three-letter currency code.',
      {
        code:
          'LEDGER_BRIDGE_INVALID_CURRENCY',
        httpStatus: 422,
      },
    );
  }

  return normalized;
}

function normalizeDate(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AirtelCollectionLedgerBridgeError(
      'occurredAt must be a valid date.',
      {
        code:
          'LEDGER_BRIDGE_INVALID_DATE',
        httpStatus: 422,
      },
    );
  }

  return date;
}

function providerOutcomeFrom(
  input = {},
) {
  const reconciliation =
    isPlainObject(
      input.reconciliation,
    )
      ? input.reconciliation
      : {};

  const confirmation =
    isPlainObject(
      input.confirmation,
    )
      ? input.confirmation
      : {};

  if (
    reconciliation.confirmedSuccess ===
      true ||
    reconciliation.knownSuccess ===
      true ||
    confirmation.confirmed === true
  ) {
    return PROVIDER_OUTCOMES.SUCCESS;
  }

  const raw = upper(
    input.providerOutcome ??
      input.outcome ??
      input.providerStatus ??
      input.status ??
      reconciliation.outcome ??
      reconciliation.status ??
      confirmation.outcome ??
      confirmation.status,
  );

  if (!raw) {
    return PROVIDER_OUTCOMES.UNKNOWN;
  }

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

function hasAccountingEvidence(
  value,
) {
  if (!isPlainObject(value)) {
    return false;
  }

  return [
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
  ].some(
    (key) =>
      value[key] !==
        undefined &&
      value[key] !== null,
  );
}

function buildLineFingerprint(
  lines = [],
) {
  if (!Array.isArray(lines)) {
    return null;
  }

  return lines.map(
    (line) => ({
      accountId:
        stringValue(
          line?.accountId ??
            line?.accountCode,
          DEFAULT_CONFIG.maxAccountIdLength,
        ),
      direction: upper(
        line?.direction,
      ),
      amountMinor:
        line?.amountMinor ===
            undefined &&
        line?.amount === undefined
          ? null
          : String(
              line.amountMinor ??
                line.amount,
            ),
      currency: upper(
        line?.currency,
      ),
    }),
  );
}

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

export class AirtelCollectionLedgerBridgeError
  extends Error {
  constructor(
    message,
    {
      code =
        'LEDGER_BRIDGE_ERROR',
      httpStatus = 400,
      retryable = false,
      operation = OPERATION,
      details = {},
      cause = undefined,
    } = {},
  ) {
    super(
      String(
        message ||
          'Airtel collection ledger bridge error.',
      ),
      cause
        ? { cause }
        : undefined,
    );

    this.name =
      'AirtelCollectionLedgerBridgeError';
    this.code = code;
    this.httpStatus =
      Number.isInteger(httpStatus)
        ? httpStatus
        : 400;
    this.retryable =
      Boolean(retryable);
    this.operation = operation;
    this.provider = PROVIDER;
    this.component = COMPONENT;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      provider: this.provider,
      operation: this.operation,
      component: this.component,
      details: this.details,
    };
  }
}

/**
 * =============================================================================
 * Deterministic accounting identities
 * =============================================================================
 */

export function buildCollectionLedgerPostingKey({
  tenantId,
  provider = PROVIDER,
  operation = OPERATION,
  transactionId,
  originalIdempotencyKey,
  reference = null,
} = {}) {
  const payload = {
    schemaVersion:
      SCHEMA_VERSION,
    tenantId:
      stringValue(
        tenantId,
        DEFAULT_CONFIG.maxTenantIdLength,
      ) ?? '',
    provider:
      upper(provider) ??
      PROVIDER,
    operation:
      upper(operation) ??
      OPERATION,
    transactionId:
      stringValue(
        transactionId,
        DEFAULT_CONFIG.maxTransactionIdLength,
      ) ?? '',
    originalIdempotencyKeyHash:
      originalIdempotencyKey
        ? sha256(
            String(
              originalIdempotencyKey,
            ),
          )
        : null,
    reference:
      stringValue(
        reference,
        DEFAULT_CONFIG.maxReferenceLength,
      ) ?? '',
  };

  return `ledger:airtel:collection:${sha256(
    payload,
  ).slice(0, 64)}`;
}

export function buildCollectionLedgerPostingFingerprint(
  input = {},
) {
  return sha256({
    schemaVersion:
      SCHEMA_VERSION,
    tenantId:
      stringValue(
        input.tenantId,
        DEFAULT_CONFIG.maxTenantIdLength,
      ),
    provider:
      upper(input.provider) ??
      PROVIDER,
    operation:
      upper(input.operation) ??
      OPERATION,
    transactionId:
      stringValue(
        input.transactionId,
        DEFAULT_CONFIG.maxTransactionIdLength,
      ),
    originalIdempotencyKeyHash:
      input.originalIdempotencyKey
        ? sha256(
            String(
              input.originalIdempotencyKey,
            ),
          )
        : null,
    postingKey:
      stringValue(
        input.postingKey,
        DEFAULT_CONFIG.maxPostingKeyLength,
      ),
    reference:
      stringValue(
        input.reference,
        DEFAULT_CONFIG.maxReferenceLength,
      ),
    providerReference:
      stringValue(
        input.providerReference,
        DEFAULT_CONFIG.maxProviderReferenceLength,
      ),
    amountMinor:
      input.amountMinor ===
        undefined
        ? null
        : String(
            input.amountMinor,
          ),
    currency:
      upper(input.currency),
    providerOutcome:
      upper(
        input.providerOutcome,
      ),
    lines:
      buildLineFingerprint(
        input.lines,
      ),
  });
}

export function buildCollectionReversalPostingKey({
  tenantId,
  originalPostingKey,
  compensationIdempotencyKey,
} = {}) {
  return `reversal:airtel:collection:${sha256(
    {
      schemaVersion:
        SCHEMA_VERSION,
      tenantId:
        stringValue(
          tenantId,
          DEFAULT_CONFIG.maxTenantIdLength,
        ) ?? '',
      originalPostingKey:
        stringValue(
          originalPostingKey,
          DEFAULT_CONFIG.maxPostingKeyLength,
        ) ?? '',
      compensationIdempotencyKey:
        stringValue(
          compensationIdempotencyKey,
          DEFAULT_CONFIG.maxIdempotencyKeyLength,
        ) ?? '',
    },
  ).slice(0, 64)}`;
}

/**
 * =============================================================================
 * Bridge implementation
 * =============================================================================
 */

export class AirtelCollectionLedgerBridge {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new AirtelCollectionLedgerBridgeError(
        'Ledger bridge options must be a plain object.',
        {
          code:
            'LEDGER_BRIDGE_INVALID_OPTIONS',
          httpStatus: 500,
        },
      );
    }

    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...(options.configuration ??
        options.config ??
        {}),
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
      options.metrics ?? null;

    this.logger =
      options.logger ?? null;

    this.clock =
      options.clock ?? {
        now: () => Date.now(),
      };

    this.idFactory =
      options.idFactory ??
      (() => randomUUID());
  }

  #throw(
    message,
    code,
    details = {},
    options = {},
  ) {
    throw new AirtelCollectionLedgerBridgeError(
      message,
      {
        code,
        details,
        ...options,
        operation:
          options.operation ??
          OPERATION,
      },
    );
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

      if (!isFunction(fn)) {
        return;
      }

      fn.call(
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
      // Logging is non-authoritative.
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

      if (!isFunction(fn)) {
        return;
      }

      fn.call(
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
    context,
    result = null,
  ) {
    const fn =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write ??
      this.auditService?.createAuditLog;

    if (!isFunction(fn)) {
      return null;
    }

    const payload = sanitize(
      {
        schemaVersion:
          SCHEMA_VERSION,
        component:
          COMPONENT,
        provider:
          PROVIDER,
        operation:
          context.operation,
        action,
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        reference:
          context.reference,
        providerReference:
          context.providerReference,
        amountMinor:
          context.amountMinor,
        currency:
          context.currency,
        postingKey:
          context.postingKey,
        originalIdempotencyKeyHash:
          context.originalIdempotencyKey
            ? sha256(
                context.originalIdempotencyKey,
              )
            : null,
        compensationIdempotencyKeyHash:
          context.compensationIdempotencyKey
            ? sha256(
                context.compensationIdempotencyKey,
              )
            : null,
        postingFingerprint:
          context.postingFingerprint,
        actorId:
          context.actor?.actorId ??
          context.requestedBy ??
          null,
        outcome:
          result?.outcome ??
          result?.status ??
          null,
        occurredAt:
          nowIso(this.clock),
      },
      0,
      this.config,
    );

    try {
      return await fn.call(
        this.auditService,
        {
          ...payload,
          auditFingerprint:
            sha256(payload),
        },
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel collection ledger-bridge audit publication failed.',
        {
          action,
          tenantId:
            context.tenantId,
          transactionId:
            context.transactionId,
          errorCode:
            error?.code,
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnAuditError
      ) {
        this.#throw(
          'Ledger-bridge audit boundary is unavailable.',
          'LEDGER_BRIDGE_AUDIT_UNAVAILABLE',
          {},
          {
            httpStatus: 503,
            retryable: true,
          },
        );
      }

      return null;
    }
  }

  async #event(
    type,
    context,
    result = null,
  ) {
    const fn =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (!isFunction(fn)) {
      return null;
    }

    const payload = sanitize(
      {
        eventId:
          this.idFactory(),
        type,
        occurredAt:
          nowIso(this.clock),
        provider:
          PROVIDER,
        operation:
          context.operation,
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        reference:
          context.reference,
        providerReference:
          context.providerReference,
        postingKey:
          context.postingKey,
        postingFingerprint:
          context.postingFingerprint,
        outcome:
          result?.outcome ??
          result?.status ??
          null,
        source:
          COMPONENT,
      },
      0,
      this.config,
    );

    try {
      return await fn.call(
        this.eventBus,
        payload,
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel collection ledger-bridge event publication failed.',
        {
          type,
          tenantId:
            context.tenantId,
          transactionId:
            context.transactionId,
          errorCode:
            error?.code,
        },
      );

      if (
        this.config
          .failClosedOnEventError
      ) {
        this.#throw(
          'Ledger-bridge event publication failed.',
          'LEDGER_BRIDGE_EVENT_PUBLICATION_FAILED',
          {},
          {
            httpStatus: 503,
            retryable: true,
          },
        );
      }

      return null;
    }
  }

  #method(
    target,
    names,
  ) {
    if (!target) {
      return null;
    }

    for (const name of names) {
      if (
        isFunction(
          target?.[name],
        )
      ) {
        return {
          name,
          fn: target[
            name
          ].bind(target),
        };
      }
    }

    return null;
  }

  #financialMethod(
    ...names
  ) {
    return this.#method(
      this.financialCore,
      names,
    );
  }

  #postingMethod(
    ...names
  ) {
    return this.#method(
      this.ledgerPostingService,
      names,
    );
  }

  #reconciliationMethod(
    ...names
  ) {
    return this.#method(
      this.reconciliationService,
      names,
    );
  }

  #legacyMethod(
    ...names
  ) {
    if (
      !this.config
        .allowLegacyLedgerServiceFallback
    ) {
      return null;
    }

    return this.#method(
      this.legacyLedgerService,
      names,
    );
  }

  normalizeContext(
    input = {},
    {
      operation = OPERATION,
      requireTransactionId =
        this.config
          .requireTransactionIdentityForPost,
      requireOriginalIdempotencyKey =
        this.config
          .requireOriginalIdempotencyKeyForPost,
    } = {},
  ) {
    if (!isPlainObject(input)) {
      this.#throw(
        'Ledger bridge input must be a plain object.',
        'LEDGER_BRIDGE_INVALID_INPUT',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const transaction =
      isPlainObject(
        input.transaction,
      )
        ? input.transaction
        : {};

    const collection =
      isPlainObject(
        input.collection,
      )
        ? input.collection
        : {};

    const settlement =
      isPlainObject(
        input.settlement,
      )
        ? input.settlement
        : {};

    const reconciliation =
      isPlainObject(
        input.reconciliation,
      )
        ? input.reconciliation
        : {};

    const confirmation =
      isPlainObject(
        input.confirmation,
      )
        ? input.confirmation
        : {};

    const tenantId =
      stringValue(
        input.tenantId ??
          transaction.tenantId ??
          collection.tenantId ??
          settlement.tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      this.config
        .requireTenantId &&
      !tenantId
    ) {
      this.#throw(
        'tenantId is required.',
        'LEDGER_BRIDGE_TENANT_REQUIRED',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const provider =
      upper(
        input.provider ??
          transaction.provider ??
          collection.provider ??
          settlement.provider ??
          PROVIDER,
      ) ?? PROVIDER;

    if (
      this.config
        .requireAirtelProvider &&
      provider !== PROVIDER
    ) {
      this.#throw(
        'Airtel collection ledger bridge accepts only the AIRTEL provider.',
        'LEDGER_BRIDGE_PROVIDER_SCOPE_VIOLATION',
        {
          provider,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const resolvedOperation =
      upper(
        operation ??
          input.operationType ??
          input.type ??
          transaction.type ??
          collection.type ??
          settlement.type ??
          OPERATION,
      ) ?? OPERATION;

    if (
      this.config
        .requireCollectionOperation &&
      ![
        OPERATION,
        'SETTLEMENT',
        'REVERSAL',
        'COMPENSATION',
      ].includes(
        resolvedOperation,
      )
    ) {
      this.#throw(
        'Unsupported collection accounting operation.',
        'LEDGER_BRIDGE_OPERATION_INVALID',
        {
          operation:
            resolvedOperation,
        },
        {
          httpStatus: 409,
          operation:
            resolvedOperation,
        },
      );
    }

    const transactionId =
      stringValue(
        input.transactionId ??
          input.financialTransactionId ??
          input.collectionId ??
          input.paymentId ??
          transaction.transactionId ??
          transaction.financialTransactionId ??
          transaction.collectionId ??
          transaction.paymentId ??
          transaction.id ??
          transaction._id ??
          collection.transactionId ??
          collection.financialTransactionId ??
          collection.collectionId ??
          collection.paymentId ??
          collection.id ??
          collection._id,
        this.config
          .maxTransactionIdLength,
      );

    if (
      requireTransactionId &&
      !transactionId
    ) {
      this.#throw(
        'transactionId is required for financial accounting.',
        'LEDGER_BRIDGE_TRANSACTION_ID_REQUIRED',
        {},
        {
          httpStatus: 422,
          operation:
            resolvedOperation,
        },
      );
    }

    const reference =
      stringValue(
        input.reference ??
          input.paymentReference ??
          input.externalReference ??
          input.collectionReference ??
          transaction.reference ??
          transaction.paymentReference ??
          transaction.externalReference ??
          transaction.collectionReference ??
          collection.reference ??
          collection.paymentReference ??
          collection.externalReference ??
          collection.collectionReference ??
          settlement.reference,
        this.config
          .maxReferenceLength,
      );

    const originalIdempotencyKey =
      stringValue(
        input.originalIdempotencyKey ??
          input.idempotencyKey ??
          input.headers?.[
            'idempotency-key'
          ] ??
          transaction.originalIdempotencyKey ??
          transaction.idempotencyKey ??
          collection.originalIdempotencyKey ??
          collection.idempotencyKey ??
          settlement.originalIdempotencyKey ??
          settlement.idempotencyKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    if (
      requireOriginalIdempotencyKey &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        'The original collection idempotency key is required.',
        'LEDGER_BRIDGE_IDEMPOTENCY_KEY_REQUIRED',
        {},
        {
          httpStatus: 422,
          operation:
            resolvedOperation,
        },
      );
    }

    const compensationIdempotencyKey =
      stringValue(
        input.compensationIdempotencyKey ??
          input.compensationKey ??
          input.reversalIdempotencyKey ??
          transaction.compensationIdempotencyKey ??
          collection.compensationIdempotencyKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    let amountMinor =
      input.amountMinor ??
      input.amountInMinorUnits ??
      transaction.amountMinor ??
      collection.amountMinor ??
      settlement.amountMinor;

    if (
      amountMinor ===
        undefined &&
      this.config
        .acceptAmountAlias !== false
    ) {
      amountMinor =
        input.amount ??
        transaction.amount ??
        collection.amount ??
        settlement.amount;
    }

    if (
      amountMinor !==
      undefined
    ) {
      amountMinor =
        normalizeAmountMinor(
          amountMinor,
        );
    }

    if (
      this.config
        .requireAmountMinor &&
      !amountMinor &&
      [
        OPERATION,
        'SETTLEMENT',
      ].includes(
        resolvedOperation,
      )
    ) {
      this.#throw(
        'amountMinor is required for financial accounting.',
        'LEDGER_BRIDGE_AMOUNT_REQUIRED',
        {},
        {
          httpStatus: 422,
          operation:
            resolvedOperation,
        },
      );
    }

    const currency =
      normalizeCurrency(
        input.currency ??
          transaction.currency ??
          collection.currency ??
          settlement.currency ??
          this.config
            .defaultCurrency,
        this.config
          .defaultCurrency,
      );

    const providerReference =
      stringValue(
        input.providerReference ??
          input.providerTransactionId ??
          input.providerReferenceId ??
          transaction.providerReference ??
          transaction.providerTransactionId ??
          collection.providerReference ??
          collection.providerTransactionId ??
          settlement.providerReference ??
          settlement.providerTransactionId,
        this.config
          .maxProviderReferenceLength,
      );

    const providerOutcome =
      providerOutcomeFrom({
        ...transaction,
        ...collection,
        ...settlement,
        ...input,
        reconciliation,
        confirmation,
      });

    const providerConfirmed =
      input.providerConfirmed ===
        true ||
      input.confirmed === true ||
      input.settled === true ||
      input.reconciled === true ||
      transaction.providerConfirmed ===
        true ||
      collection.providerConfirmed ===
        true ||
      settlement.providerConfirmed ===
        true ||
      reconciliation.confirmedSuccess ===
        true ||
      reconciliation.knownSuccess ===
        true ||
      confirmation.confirmed ===
        true ||
      providerOutcome ===
        PROVIDER_OUTCOMES.SUCCESS;

    const actor =
      isPlainObject(
        input.actor,
      )
        ? {
            actorId:
              stringValue(
                input.actor
                  .actorId ??
                  input.actor
                    .userId ??
                  input.actor
                    .principalId ??
                  input.actor.id,
                200,
              ),
            role:
              upper(
                input.actor
                  .role ??
                  input.actor
                    .actorRole,
              ),
            tenantId:
              stringValue(
                input.actor
                  .tenantId,
                this.config
                  .maxTenantIdLength,
              ),
          }
        : undefined;

    if (
      actor?.tenantId &&
      actor.tenantId !==
        tenantId
    ) {
      this.#throw(
        'Actor tenant does not match collection accounting tenant.',
        'LEDGER_BRIDGE_TENANT_SCOPE_MISMATCH',
        {},
        {
          httpStatus: 403,
        },
      );
    }

    const postingKey =
      stringValue(
        input.postingKey ??
          input.accountingPostingKey ??
          transaction.postingKey ??
          collection.postingKey ??
          settlement.postingKey,
        this.config
          .maxPostingKeyLength,
      ) ??
      buildCollectionLedgerPostingKey({
        tenantId,
        provider,
        operation:
          resolvedOperation,
        transactionId,
        originalIdempotencyKey,
        reference,
      });

    const lines =
      Array.isArray(
        input.lines,
      )
        ? clone(input.lines)
        : Array.isArray(
            input.entries,
          )
          ? clone(input.entries)
          : Array.isArray(
              transaction.lines,
            )
            ? clone(
                transaction.lines,
              )
            : Array.isArray(
                collection.lines,
              )
              ? clone(
                  collection.lines,
                )
              : null;

    const debitAccountId =
      stringValue(
        input.debitAccountId ??
          input.debitAccount ??
          input.sourceAccountId ??
          transaction.debitAccountId ??
          collection.debitAccountId,
        this.config
          .maxAccountIdLength,
      );

    const creditAccountId =
      stringValue(
        input.creditAccountId ??
          input.creditAccount ??
          input.destinationAccountId ??
          transaction.creditAccountId ??
          collection.creditAccountId,
        this.config
          .maxAccountIdLength,
      );

    const occurredAt =
      normalizeDate(
        input.occurredAt ??
          transaction.occurredAt ??
          collection.occurredAt ??
          settlement.occurredAt,
        new Date(
          nowMs(
            this.clock,
          ),
        ),
      );

    const metadata =
      sanitize(
        input.metadata ??
          transaction.metadata ??
          collection.metadata ??
          settlement.metadata ??
          {},
        0,
        this.config,
      );

    const description =
      stringValue(
        input.description ??
          transaction.description ??
          collection.description ??
          settlement.description ??
          'Airtel collection accounting posting',
        this.config
          .maxDescriptionLength,
      ) ??
      'Airtel collection accounting posting';

    const requestedBy =
      stringValue(
        input.requestedBy ??
          input.requestedById ??
          transaction.requestedBy ??
          collection.requestedBy,
        200,
      );

    const correlationId =
      stringValue(
        input.correlationId ??
          transaction.correlationId ??
          collection.correlationId ??
          settlement.correlationId,
        240,
      );

    const causationId =
      stringValue(
        input.causationId ??
          transaction.causationId ??
          collection.causationId,
        240,
      );

    const context = {
      tenantId,
      provider,
      operation:
        resolvedOperation,
      transactionId,
      reference,
      originalIdempotencyKey,
      compensationIdempotencyKey,
      amountMinor,
      currency,
      providerReference,
      providerOutcome,
      providerConfirmed,
      postingKey,
      debitAccountId,
      creditAccountId,
      lines,
      description,
      requestedBy,
      actor,
      occurredAt,
      correlationId,
      causationId,
      metadata,
      session:
        input.session ?? null,
    };

    context.postingFingerprint =
      buildCollectionLedgerPostingFingerprint(
        context,
      );

    return context;
  }

  #assertAccountingSafe(
    context,
    {
      requireSuccess = true,
    } = {},
  ) {
    if (!requireSuccess) {
      return true;
    }

    if (
      (
        context.providerOutcome ===
          PROVIDER_OUTCOMES.AMBIGUOUS ||
        context.providerOutcome ===
          PROVIDER_OUTCOMES.UNKNOWN
      ) &&
      this.config
        .rejectAmbiguousProviderOutcome
    ) {
      this.#throw(
        'Accounting cannot finalize an ambiguous or unknown Airtel collection outcome.',
        'LEDGER_BRIDGE_PROVIDER_OUTCOME_AMBIGUOUS',
        {
          providerOutcome:
            context.providerOutcome,
          providerReference:
            context.providerReference,
        },
        {
          httpStatus: 409,
          retryable: true,
          operation:
            context.operation,
        },
      );
    }

    if (
      (
        context.providerOutcome ===
          PROVIDER_OUTCOMES.PENDING ||
        context.providerOutcome ===
          PROVIDER_OUTCOMES.ACCEPTED
      ) &&
      this.config
        .rejectUnconfirmedProviderOutcome
    ) {
      this.#throw(
        'Accounting cannot finalize a pending Airtel collection.',
        'LEDGER_BRIDGE_PROVIDER_STILL_PENDING',
        {
          providerOutcome:
            context.providerOutcome,
          providerReference:
            context.providerReference,
        },
        {
          httpStatus: 409,
          retryable: true,
          operation:
            context.operation,
        },
      );
    }

    if (
      context.providerOutcome ===
        PROVIDER_OUTCOMES.FAILURE ||
      context.providerOutcome ===
        PROVIDER_OUTCOMES.REJECTED
    ) {
      this.#throw(
        'A failed or rejected Airtel collection cannot be posted as successful accounting.',
        'LEDGER_BRIDGE_PROVIDER_FAILED',
        {
          providerOutcome:
            context.providerOutcome,
          providerReference:
            context.providerReference,
        },
        {
          httpStatus: 409,
          operation:
            context.operation,
        },
      );
    }

    if (
      this.config
        .requireProviderConfirmation &&
      context.providerOutcome !==
        PROVIDER_OUTCOMES.SUCCESS
    ) {
      this.#throw(
        'Confirmed Airtel collection success is required before accounting finalization.',
        'LEDGER_BRIDGE_PROVIDER_NOT_CONFIRMED',
        {
          providerOutcome:
            context.providerOutcome,
          providerReference:
            context.providerReference,
        },
        {
          httpStatus: 409,
          operation:
            context.operation,
        },
      );
    }

    return true;
  }

  #buildPostingLines(
    context,
  ) {
    if (
      Array.isArray(
        context.lines,
      )
    ) {
      if (
        context.lines.length <
          2 ||
        context.lines.length >
          this.config
            .maxLineCount
      ) {
        this.#throw(
          'Accounting lines must contain at least two entries.',
          'LEDGER_BRIDGE_INVALID_POSTING_LINES',
          {},
          {
            httpStatus: 422,
            operation:
              context.operation,
          },
        );
      }

      return context.lines.map(
        (
          line,
          index,
        ) => {
          if (
            !isPlainObject(
              line,
            )
          ) {
            this.#throw(
              `Posting line ${index + 1} must be an object.`,
              'LEDGER_BRIDGE_INVALID_POSTING_LINE',
              {},
              {
                httpStatus: 422,
                operation:
                  context.operation,
              },
            );
          }

          const accountId =
            stringValue(
              line.accountId ??
                line.accountCode,
              this.config
                .maxAccountIdLength,
            );

          const direction =
            upper(
              line.direction,
            );

          const amountMinor =
            normalizeAmountMinor(
              line.amountMinor ??
                line.amount,
            );

          const currency =
            normalizeCurrency(
              line.currency ??
                context.currency,
              context.currency,
            );

          if (!accountId) {
            this.#throw(
              `Posting line ${index + 1} has no authoritative account identifier.`,
              'LEDGER_BRIDGE_ACCOUNT_REQUIRED',
              {},
              {
                httpStatus: 422,
                operation:
                  context.operation,
              },
            );
          }

          if (
            ![
              'DEBIT',
              'CREDIT',
            ].includes(
              direction,
            )
          ) {
            this.#throw(
              `Posting line ${index + 1} must be DEBIT or CREDIT.`,
              'LEDGER_BRIDGE_INVALID_DIRECTION',
              {},
              {
                httpStatus: 422,
                operation:
                  context.operation,
              },
            );
          }

          if (!amountMinor) {
            this.#throw(
              `Posting line ${index + 1} amount is required.`,
              'LEDGER_BRIDGE_LINE_AMOUNT_REQUIRED',
              {},
              {
                httpStatus: 422,
                operation:
                  context.operation,
              },
            );
          }

          if (
            currency !==
            context.currency
          ) {
            this.#throw(
              `Posting line ${index + 1} currency does not match the collection currency.`,
              'LEDGER_BRIDGE_CURRENCY_MISMATCH',
              {},
              {
                httpStatus: 422,
                operation:
                  context.operation,
              },
            );
          }

          return {
            accountId,
            direction,
            amountMinor,
            currency,
            reference:
              stringValue(
                line.reference ??
                  context.reference,
                this.config
                  .maxReferenceLength,
              ),
            description:
              stringValue(
                line.description ??
                  context.description,
                this.config
                  .maxDescriptionLength,
              ),
            metadata:
              sanitize(
                line.metadata ??
                  {},
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
          'Debit and credit accounts must be different.',
          'LEDGER_BRIDGE_IDENTICAL_ACCOUNTS',
          {},
          {
            httpStatus: 422,
            operation:
              context.operation,
          },
        );
      }

      if (!context.amountMinor) {
        this.#throw(
          'amountMinor is required to build a two-sided accounting posting.',
          'LEDGER_BRIDGE_AMOUNT_REQUIRED',
          {},
          {
            httpStatus: 422,
            operation:
              context.operation,
          },
        );
      }

      return [
        {
          accountId:
            context.debitAccountId,
          direction:
            'DEBIT',
          amountMinor:
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
          direction:
            'CREDIT',
          amountMinor:
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
      'No authoritative accounting lines or accounting-owned debit/credit accounts were supplied.',
      'LEDGER_BRIDGE_ACCOUNTING_INSTRUCTIONS_REQUIRED',
      {
        transactionId:
          context.transactionId,
      },
      {
        httpStatus: 503,
        retryable: true,
        operation:
          context.operation,
      },
    );
  }

  #buildFinancialPayload(
    context,
  ) {
    const lines =
      this.#buildPostingLines(
        context,
      );

    return {
      component:
        COMPONENT,
      schemaVersion:
        SCHEMA_VERSION,
      provider:
        PROVIDER,
      operation:
        context.operation,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      reference:
        context.reference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      compensationIdempotencyKey:
        context.compensationIdempotencyKey,
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
      lines,
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
        context.session,
      metadata: {
        ...context.metadata,
        sourceComponent:
          COMPONENT,
        originalTransactionId:
          context.transactionId,
        originalIdempotencyKeyHash:
          context.originalIdempotencyKey
            ? sha256(
                context.originalIdempotencyKey,
              )
            : null,
        providerReference:
          context.providerReference ??
          null,
        accountingPostingFingerprint:
          context.postingFingerprint,
        schemaVersion:
          SCHEMA_VERSION,
        bridgeVersion:
          ENGINE_VERSION,
        collectionFinancialIdentityPreserved:
          true,
      },
      accountingSafety: {
        mustPreserveOriginalTransactionIdentity:
          true,
        mustPreserveOriginalIdempotencyIdentity:
          true,
        mustNotCreateReplacementFinancialIdentity:
          true,
        mustNotMutateBalancesOutsideFinancialCore:
          true,
        mustTreatProviderAcceptanceAsNonFinal:
          true,
      },
    };
  }

  #normalizeAccountingResult(
    context,
    raw,
    fallbackOutcome =
      BRIDGE_OUTCOMES.POSTED,
  ) {
    const value =
      isPlainObject(raw)
        ? raw
        : {};

    const explicit =
      upper(
        value.status ??
          value.outcome ??
          value.state,
      );

    const duplicate =
      value.duplicate ===
        true ||
      value.replayed ===
        true ||
      [
        'ALREADY_POSTED',
        'REPLAY',
        'DUPLICATE',
      ].includes(
        explicit,
      );

    const posted =
      value.posted ===
        true ||
      value.success ===
        true ||
      value.settled ===
        true ||
      Boolean(
        value.posting ||
          value.journal ||
          value.journalEntry ||
          value.ledgerEntry ||
          value.ledgerReference ||
          value.journalId ||
          value.ledgerId,
      ) ||
      [
        'POSTED',
        'SETTLED',
        'COMPLETED',
        'SUCCESS',
        'SUCCEEDED',
        'ALREADY_POSTED',
      ].includes(
        explicit,
      );

    const settled =
      value.settled ===
        true ||
      explicit ===
        'SETTLED';

    return {
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        context.operation,
      outcome:
        duplicate
          ? BRIDGE_OUTCOMES.ALREADY_POSTED
          : posted
            ? fallbackOutcome
            : BRIDGE_OUTCOMES.FAILED,
      status:
        duplicate
          ? BRIDGE_OUTCOMES.ALREADY_POSTED
          : posted
            ? fallbackOutcome
            : BRIDGE_OUTCOMES.FAILED,
      posted,
      settled,
      duplicate,
      replay:
        value.replayed ===
          true ||
        explicit ===
          'REPLAY',
      tenantId:
        context.tenantId,
      transactionId:
        stringValue(
          value.transactionId ??
            value.financialTransactionId ??
            context.transactionId,
          this.config
            .maxTransactionIdLength,
        ),
      reference:
        stringValue(
          value.reference ??
            context.reference,
          this.config
            .maxReferenceLength,
        ),
      postingKey:
        context.postingKey,
      ledgerReference:
        stringValue(
          value.ledgerReference ??
            value.journalId ??
            value.ledgerId ??
            value.posting
              ?.postingKey ??
            value.posting?.id ??
            value.posting?._id,
          this.config
            .maxPostingKeyLength,
        ),
      providerReference:
        context.providerReference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      postingFingerprint:
        context.postingFingerprint,
      evidence:
        sanitize(
          value,
          0,
          this.config,
        ),
    };
  }

  async #invokeFinancialCore(
    context,
    payload,
    methods,
  ) {
    const method =
      this.#financialMethod(
        ...methods,
      );

    if (!method) {
      return null;
    }

    try {
      const result =
        await method.fn(
          payload,
        );

      if (
        !hasAccountingEvidence(
          result,
        )
      ) {
        this.#throw(
          'Financial Core returned no authoritative accounting evidence.',
          'LEDGER_BRIDGE_FINANCIAL_CORE_EMPTY_RESULT',
          {},
          {
            httpStatus: 503,
            retryable: true,
            operation:
              context.operation,
          },
        );
      }

      return {
        boundary:
          'FINANCIAL_CORE',
        method:
          method.name,
        result,
      };
    } catch (error) {
      if (
        error instanceof
        AirtelCollectionLedgerBridgeError
      ) {
        throw error;
      }

      this.#throw(
        'Canonical Financial Core accounting delegation failed.',
        'LEDGER_BRIDGE_FINANCIAL_CORE_FAILED',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            context.operation,
          cause:
            error,
        },
      );
    }
  }

  async #invokePostingService(
    context,
    payload,
  ) {
    if (
      !this.config
        .allowLedgerPostingFallback
    ) {
      return null;
    }

    const method =
      this.#postingMethod(
        'post',
        'postJournal',
        'createPosting',
      );

    if (!method) {
      return null;
    }

    try {
      const result =
        await method.fn(
          payload,
          {
            session:
              context.session,
          },
        );

      if (
        !hasAccountingEvidence(
          result,
        )
      ) {
        this.#throw(
          'Canonical posting service returned no authoritative result.',
          'LEDGER_BRIDGE_POSTING_SERVICE_EMPTY_RESULT',
          {},
          {
            httpStatus: 503,
            retryable: true,
            operation:
              context.operation,
          },
        );
      }

      return {
        boundary:
          'LEDGER_POSTING_SERVICE',
        method:
          method.name,
        result,
      };
    } catch (error) {
      if (
        error instanceof
        AirtelCollectionLedgerBridgeError
      ) {
        throw error;
      }

      this.#throw(
        'Canonical posting service accounting operation failed.',
        'LEDGER_BRIDGE_POSTING_SERVICE_FAILED',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            context.operation,
          cause:
            error,
        },
      );
    }
  }

  async postCollection(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          operation:
            OPERATION,
        },
      );

    this.#assertAccountingSafe(
      context,
      {
        requireSuccess:
          this.config
            .requireProviderConfirmation,
      },
    );

    const payload =
      this.#buildFinancialPayload(
        context,
      );

    const execution =
      await this.#invokeFinancialCore(
        context,
        payload,
        [
          'postCollection',
          'settleCollection',
          'recordCollectionSettlement',
          'postProviderCollection',
          'settleProviderCollection',
          'postFinancialCollection',
        ],
      ) ??
      await this.#invokePostingService(
        context,
        payload,
      );

    if (!execution) {
      this.#throw(
        'No canonical accounting boundary is configured for Airtel collections.',
        'LEDGER_BRIDGE_ACCOUNTING_BOUNDARY_UNAVAILABLE',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            context.operation,
        },
      );
    }

    const result = {
      ...this.#normalizeAccountingResult(
        context,
        execution.result,
        BRIDGE_OUTCOMES.POSTED,
      ),
      boundary:
        execution.boundary,
      delegatedMethod:
        execution.method,
    };

    await this.#audit(
      result.duplicate
        ? 'AIRTEL_COLLECTION_LEDGER_REPLAY'
        : 'AIRTEL_COLLECTION_LEDGER_POSTED',
      context,
      result,
    );

    await this.#event(
      result.duplicate
        ? 'AIRTEL_COLLECTION_LEDGER_REPLAYED'
        : 'AIRTEL_COLLECTION_LEDGER_POSTED',
      context,
      result,
    );

    this.#metric(
      result.duplicate
        ? 'titech_airtel_collection_ledger_replay_total'
        : 'titech_airtel_collection_ledger_post_total',
      {
        boundary:
          execution.boundary,
      },
    );

    return result;
  }

  async settleCollection(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          operation:
            OPERATION,
        },
      );

    this.#assertAccountingSafe(
      context,
      {
        requireSuccess: true,
      },
    );

    const settlementContext = {
      ...context,
      operation:
        'SETTLEMENT',
    };

    const payload =
      this.#buildFinancialPayload(
        settlementContext,
      );

    const execution =
      await this.#invokeFinancialCore(
        settlementContext,
        payload,
        [
          'settleCollection',
          'settleSuccessfulCollection',
          'settleProviderCollection',
          'recordCollectionSettlement',
          'postFinancialCollection',
          'postCollection',
        ],
      ) ??
      await this.#invokePostingService(
        settlementContext,
        payload,
      );

    if (!execution) {
      this.#throw(
        'No canonical accounting settlement boundary is configured.',
        'LEDGER_BRIDGE_ACCOUNTING_BOUNDARY_UNAVAILABLE',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            'SETTLEMENT',
        },
      );
    }

    const result = {
      ...this.#normalizeAccountingResult(
        settlementContext,
        execution.result,
        BRIDGE_OUTCOMES.SETTLED,
      ),
      boundary:
        execution.boundary,
      delegatedMethod:
        execution.method,
      settled:
        true,
    };

    await this.#audit(
      result.duplicate
        ? 'AIRTEL_COLLECTION_SETTLEMENT_REPLAY'
        : 'AIRTEL_COLLECTION_SETTLED',
      settlementContext,
      result,
    );

    await this.#event(
      result.duplicate
        ? 'AIRTEL_COLLECTION_SETTLEMENT_REPLAYED'
        : 'AIRTEL_COLLECTION_SETTLED',
      settlementContext,
      result,
    );

    this.#metric(
      'titech_airtel_collection_settlement_total',
      {
        boundary:
          execution.boundary,
      },
    );

    return result;
  }

  async postSettlement(
    input = {},
  ) {
    return this.settleCollection({
      ...input,
      operationType:
        'SETTLEMENT',
    });
  }

  async verifyCollectionSettlement(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          operation:
            OPERATION,
          requireTransactionId:
            false,
          requireOriginalIdempotencyKey:
            false,
        },
      );

    const method =
      this.#financialMethod(
        'verifyCollectionSettlement',
        'verifySettlement',
        'verifyFinancialSettlement',
        'verifyProviderCollection',
        'confirmCollection',
      ) ??
      this.#reconciliationMethod(
        'verifyCollectionSettlement',
        'verifySettlement',
        'verifyCollection',
        'confirmSettlement',
        'verify',
      );

    if (!method) {
      return {
        verified:
          false,
        status:
          BRIDGE_OUTCOMES.NOT_VERIFIED,
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        postingKey:
          context.postingKey,
        reason:
          'No authoritative Financial Core or reconciliation verification method is configured.',
      };
    }

    try {
      const evidence =
        await method.fn({
          component:
            COMPONENT,
          schemaVersion:
            SCHEMA_VERSION,
          provider:
            PROVIDER,
          operation:
            context.operation,
          tenantId:
            context.tenantId,
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
          metadata:
            context.metadata,
        });

      const status =
        upper(
          evidence?.status ??
            evidence?.outcome ??
            evidence?.state,
        );

      const verified =
        evidence?.verified ===
          true ||
        evidence?.confirmed ===
          true ||
        evidence?.settled ===
          true ||
        [
          'VERIFIED',
          'CONFIRMED',
          'SETTLED',
          'POSTED',
          'SUCCESS',
          'CONFIRMED_SUCCESS',
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
            evidence,
            0,
            this.config,
          ),
      };

      await this.#audit(
        verified
          ? 'AIRTEL_COLLECTION_SETTLEMENT_VERIFIED'
          : 'AIRTEL_COLLECTION_SETTLEMENT_NOT_VERIFIED',
        context,
        result,
      );

      return result;
    } catch (error) {
      if (
        error instanceof
        AirtelCollectionLedgerBridgeError
      ) {
        throw error;
      }

      this.#throw(
        'Authoritative collection settlement verification failed.',
        'LEDGER_BRIDGE_SETTLEMENT_VERIFICATION_FAILED',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            context.operation,
          cause:
            error,
        },
      );
    }
  }

  async verifySettlement(
    input = {},
  ) {
    return this.verifyCollectionSettlement(
      input,
    );
  }

  async getPosting(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          operation:
            upper(
              input.operationType ??
                input.operation ??
                OPERATION,
            ) ??
            OPERATION,
          requireTransactionId:
            false,
          requireOriginalIdempotencyKey:
            false,
        },
      );

    const postingMethod =
      this.#postingMethod(
        'getPosting',
        'findPostingByKey',
        'findPostingByIdempotencyKey',
        'getByPostingKey',
      );

    const financialMethod =
      this.#financialMethod(
        'getPosting',
        'getLedgerPosting',
        'findLedgerPosting',
        'findCollectionPosting',
      );

    const method =
      postingMethod ??
      financialMethod;

    if (!method) {
      return {
        found:
          false,
        supported:
          false,
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        postingKey:
          context.postingKey,
      };
    }

    try {
      const result =
        await method.fn({
          tenantId:
            context.tenantId,
          transactionId:
            context.transactionId,
          postingKey:
            context.postingKey,
          reference:
            context.reference,
        });

      return {
        found:
          Boolean(result),
        supported:
          true,
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        postingKey:
          context.postingKey,
        posting:
          sanitize(
            result,
            0,
            this.config,
          ),
      };
    } catch (error) {
      this.#throw(
        'Collection accounting posting lookup failed.',
        'LEDGER_BRIDGE_POSTING_LOOKUP_FAILED',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            context.operation,
          cause:
            error,
        },
      );
    }
  }

  async reverse(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          operation:
            'REVERSAL',
          requireTransactionId:
            false,
          requireOriginalIdempotencyKey:
            false,
        },
      );

    const compensationIdempotencyKey =
      context.compensationIdempotencyKey;

    if (
      !compensationIdempotencyKey
    ) {
      this.#throw(
        'A distinct reversal/compensation idempotency key is required.',
        'LEDGER_BRIDGE_REVERSAL_IDEMPOTENCY_REQUIRED',
        {},
        {
          httpStatus: 422,
          operation:
            'REVERSAL',
        },
      );
    }

    if (
      context.originalIdempotencyKey &&
      context.originalIdempotencyKey ===
        compensationIdempotencyKey
    ) {
      this.#throw(
        'Reversal idempotency identity must differ from the original collection identity.',
        'LEDGER_BRIDGE_REVERSAL_IDEMPOTENCY_COLLISION',
        {},
        {
          httpStatus: 409,
          operation:
            'REVERSAL',
        },
      );
    }

    if (
      [
        PROVIDER_OUTCOMES.AMBIGUOUS,
        PROVIDER_OUTCOMES.UNKNOWN,
        PROVIDER_OUTCOMES.PENDING,
        PROVIDER_OUTCOMES.ACCEPTED,
      ].includes(
        context.providerOutcome,
      )
    ) {
      this.#throw(
        'Collection reversal requires authoritative reconciliation when provider outcome is not final.',
        'LEDGER_BRIDGE_REVERSAL_REQUIRES_RECONCILIATION',
        {
          providerOutcome:
            context.providerOutcome,
        },
        {
          httpStatus: 409,
          retryable: true,
          operation:
            'REVERSAL',
        },
      );
    }

    const reversalPostingKey =
      stringValue(
        input.reversalPostingKey,
        this.config
          .maxPostingKeyLength,
      ) ??
      buildCollectionReversalPostingKey({
        tenantId:
          context.tenantId,
        originalPostingKey:
          context.postingKey,
        compensationIdempotencyKey,
      });

    const financialMethod =
      this.#financialMethod(
        'reverseCollection',
        'reverseSettlement',
        'reverseFinancialTransaction',
        'executeReversal',
        'reverse',
      );

    const postingMethod =
      this.#postingMethod(
        'reverse',
        'reverseJournal',
      );

    const method =
      financialMethod ??
      postingMethod;

    if (!method) {
      this.#throw(
        'No canonical financial reversal boundary is configured.',
        'LEDGER_BRIDGE_REVERSAL_BOUNDARY_UNAVAILABLE',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            'REVERSAL',
        },
      );
    }

    const payload = {
      component:
        COMPONENT,
      schemaVersion:
        SCHEMA_VERSION,
      provider:
        PROVIDER,
      operation:
        'REVERSAL',
      tenantId:
        context.tenantId,
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
      providerReference:
        context.providerReference,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      reason:
        stringValue(
          input.reason ??
            input.reasonCode ??
            'Airtel collection reversal',
          this.config
            .maxReasonLength,
        ),
      requestedBy:
        context.requestedBy,
      actor:
        context.actor,
      correlationId:
        context.correlationId,
      session:
        context.session,
      metadata:
        context.metadata,
    };

    try {
      const raw =
        await method.fn(
          payload,
        );

      const result = {
        ...this.#normalizeAccountingResult(
          {
            ...context,
            operation:
              'REVERSAL',
            postingKey:
              reversalPostingKey,
          },
          raw,
          BRIDGE_OUTCOMES.REVERSED,
        ),
        outcome:
          BRIDGE_OUTCOMES.REVERSED,
        status:
          BRIDGE_OUTCOMES.REVERSED,
        reversed:
          raw?.reversed ===
            true ||
          raw?.success ===
            true ||
          raw?.posted ===
            true ||
          raw?.settled ===
            true,
        compensationIdempotencyKey,
        reversalPostingKey,
        boundary:
          financialMethod
            ? 'FINANCIAL_CORE'
            : 'LEDGER_POSTING_SERVICE',
        delegatedMethod:
          method.name,
      };

      await this.#audit(
        'AIRTEL_COLLECTION_REVERSED',
        {
          ...context,
          operation:
            'REVERSAL',
          postingKey:
            reversalPostingKey,
        },
        result,
      );

      await this.#event(
        'AIRTEL_COLLECTION_REVERSED',
        {
          ...context,
          operation:
            'REVERSAL',
          postingKey:
            reversalPostingKey,
        },
        result,
      );

      return result;
    } catch (error) {
      if (
        error instanceof
        AirtelCollectionLedgerBridgeError
      ) {
        throw error;
      }

      this.#throw(
        'Collection financial reversal failed.',
        'LEDGER_BRIDGE_REVERSAL_FAILED',
        {},
        {
          httpStatus: 503,
          retryable: true,
          operation:
            'REVERSAL',
          cause:
            error,
        },
      );
    }
  }

  async reverseCollection(
    input = {},
  ) {
    return this.reverse({
      ...input,
      operation:
        'REVERSAL',
    });
  }

  async compensate(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          operation:
            'COMPENSATION',
          requireTransactionId:
            false,
          requireOriginalIdempotencyKey:
            false,
        },
      );

    const compensationIdempotencyKey =
      context.compensationIdempotencyKey;

    if (
      !compensationIdempotencyKey
    ) {
      this.#throw(
        'A distinct compensation idempotency key is required.',
        'LEDGER_BRIDGE_COMPENSATION_IDEMPOTENCY_REQUIRED',
        {},
        {
          httpStatus: 422,
          operation:
            'COMPENSATION',
        },
      );
    }

    if (
      context.originalIdempotencyKey &&
      context.originalIdempotencyKey ===
        compensationIdempotencyKey
    ) {
      this.#throw(
        'Compensation identity must differ from the original collection identity.',
        'LEDGER_BRIDGE_COMPENSATION_IDEMPOTENCY_COLLISION',
        {},
        {
          httpStatus: 409,
          operation:
            'COMPENSATION',
        },
      );
    }

    const method =
      this.#financialMethod(
        'compensateCollection',
        'executeCompensation',
        'compensate',
        'executeCorrectiveOperation',
        'createCompensation',
      );

    if (method) {
      try {
        const raw =
          await method.fn({
            component:
              COMPONENT,
            schemaVersion:
              SCHEMA_VERSION,
            provider:
              PROVIDER,
            operation:
              'COMPENSATION',
            tenantId:
              context.tenantId,
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
            reasonCode:
              stringValue(
                input.reasonCode,
                160,
              ),
            reason:
              stringValue(
                input.reason ??
                  input.reasonCode ??
                  'Airtel collection compensation',
                this.config
                  .maxReasonLength,
              ),
            requestedBy:
              context.requestedBy,
            actor:
              context.actor,
            correlationId:
              context.correlationId,
            session:
              context.session,
            metadata:
              context.metadata,
          });

        const status =
          upper(
            raw?.status ??
              raw?.outcome ??
              raw?.state,
          );

        const compensated =
          raw?.compensated ===
            true ||
          raw?.success ===
            true ||
          [
            'COMPENSATED',
            'REVERSED',
            'COMPLETED',
            'SUCCESS',
            'SUCCEEDED',
          ].includes(
            status,
          );

        const result = {
          outcome:
            compensated
              ? BRIDGE_OUTCOMES.COMPENSATED
              : BRIDGE_OUTCOMES.REQUIRES_REVIEW,
          status:
            compensated
              ? BRIDGE_OUTCOMES.COMPENSATED
              : BRIDGE_OUTCOMES.REQUIRES_REVIEW,
          compensated,
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
            method.name,
          evidence:
            sanitize(
              raw,
              0,
              this.config,
            ),
        };

        await this.#audit(
          'AIRTEL_COLLECTION_COMPENSATION_EXECUTED',
          {
            ...context,
            operation:
              'COMPENSATION',
          },
          result,
        );

        await this.#event(
          'AIRTEL_COLLECTION_COMPENSATION_EXECUTED',
          {
            ...context,
            operation:
              'COMPENSATION',
          },
          result,
        );

        return result;
      } catch (error) {
        if (
          error instanceof
          AirtelCollectionLedgerBridgeError
        ) {
          throw error;
        }

        this.#throw(
          'Collection compensation execution failed.',
          'LEDGER_BRIDGE_COMPENSATION_FAILED',
          {},
          {
            httpStatus: 503,
            retryable: true,
            operation:
              'COMPENSATION',
            cause:
              error,
          },
        );
      }
    }

    return this.reverse({
      ...input,
      operation:
        'REVERSAL',
      compensationIdempotencyKey,
      provider:
        PROVIDER,
      tenantId:
        context.tenantId,
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
    });
  }

  async post(
    input = {},
  ) {
    return this.postCollection(
      input,
    );
  }

  async settle(
    input = {},
  ) {
    return this.settleCollection(
      input,
    );
  }

  async verify(
    input = {},
  ) {
    return this.verifyCollectionSettlement(
      input,
    );
  }

  async executeCompensation(
    input = {},
  ) {
    return this.compensate(
      input,
    );
  }

  async health() {
    const financialCore =
      Boolean(
        this.financialCore,
      );

    const postingService =
      Boolean(
        this.ledgerPostingService &&
          this.config
            .allowLedgerPostingFallback,
      );

    const reconciliation =
      Boolean(
        this.reconciliationService,
      );

    const legacy =
      Boolean(
        this.legacyLedgerService &&
          this.config
            .allowLegacyLedgerServiceFallback,
      );

    let financialCoreHealth =
      null;

    const method =
      this.#financialMethod(
        'health',
        'healthCheck',
        'readiness',
        'isReady',
      );

    if (method) {
      try {
        financialCoreHealth =
          await method.fn();
      } catch (error) {
        financialCoreHealth = {
          healthy:
            false,
          code:
            error?.code ??
            null,
        };
      }
    }

    const healthy =
      financialCore ||
      postingService ||
      legacy;

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
      ready:
        healthy,
      boundaries: {
        financialCore,
        ledgerPostingService:
          postingService,
        reconciliation,
        legacyLedgerCompatibility:
          legacy,
      },
      financialCoreHealth:
        sanitize(
          financialCoreHealth,
          0,
          this.config,
        ),
      controls: {
        tenantIsolation:
          this.config
            .requireTenantId,
        providerConfirmationRequired:
          this.config
            .requireProviderConfirmation,
        ambiguousOutcomeRejected:
          this.config
            .rejectAmbiguousProviderOutcome,
        directLedgerMutation:
          false,
        directBalanceMutation:
          false,
        directWalletMutation:
          false,
      },
      financialBoundary:
        FINANCIAL_BOUNDARY,
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
        OPERATION,
      tenantScoped:
        true,
      deterministicPostingIdentity:
        true,
      deterministicPostingFingerprint:
        true,
      exactMinorUnitMoney:
        true,
      originalTransactionIdentityPreserved:
        true,
      originalIdempotencyIdentityPreserved:
        true,
      distinctCompensationIdentity:
        true,
      ambiguousOutcomeProtection:
        true,
      providerConfirmationRequired:
        this.config
          .requireProviderConfirmation,
      directProviderCalls:
        false,
      directPersistence:
        false,
      directLedgerMutation:
        false,
      directBalanceMutation:
        false,
      directWalletMutation:
        false,
      settlementFinality:
        false,
      reconciliationFinality:
        false,
      accountSelectionFromProviderReference:
        false,
      authoritativeFinancialBoundary:
        'TITECH_FINANCIAL_CORE',
      explicitLedgerPostingFallback:
        this.config
          .allowLedgerPostingFallback,
      legacyLedgerFallback:
        this.config
          .allowLegacyLedgerServiceFallback,
    });
  }

  async diagnostics() {
    return {
      module:
        MODULE_NAME,
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      engine:
        ENGINE_NAME,
      engineVersion:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      health:
        await this.health(),
      capabilities:
        this.capabilities(),
      contracts: {
        postCollection:
          this.#financialMethod(
            'postCollection',
            'settleCollection',
            'recordCollectionSettlement',
            'postProviderCollection',
            'settleProviderCollection',
            'postFinancialCollection',
          )?.name ??
          null,

        postFallback:
          this.#postingMethod(
            'post',
            'postJournal',
            'createPosting',
          )?.name ??
          null,

        verify:
          this.#financialMethod(
            'verifyCollectionSettlement',
            'verifySettlement',
            'verifyFinancialSettlement',
            'verifyProviderCollection',
            'confirmCollection',
          )?.name ??
          this.#reconciliationMethod(
            'verifyCollectionSettlement',
            'verifySettlement',
            'verifyCollection',
            'confirmSettlement',
            'verify',
          )?.name ??
          null,

        reverse:
          this.#financialMethod(
            'reverseCollection',
            'reverseSettlement',
            'reverseFinancialTransaction',
            'executeReversal',
            'reverse',
          )?.name ??
          this.#postingMethod(
            'reverse',
            'reverseJournal',
          )?.name ??
          null,

        compensate:
          this.#financialMethod(
            'compensateCollection',
            'executeCompensation',
            'compensate',
            'executeCorrectiveOperation',
            'createCompensation',
          )?.name ??
          null,
      },

      financialBoundary:
        FINANCIAL_BOUNDARY,

      security: {
        rawProviderPayloadPersistence:
          false,
        rawProviderPayloadAudit:
          false,
        rawProviderPayloadEvent:
          false,
        rawIdempotencyKeyAudit:
          false,
        rawIdempotencyKeyEvent:
          false,
        tenantIsolation:
          true,
        ambiguousProviderOutcomeProtection:
          true,
      },
    };
  }

  snapshot() {
    return {
      module:
        MODULE_NAME,
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      engine:
        ENGINE_NAME,
      engineVersion:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      capabilities:
        this.capabilities(),
      financialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }
}

export const createCollectionLedgerBridge =
  (options = {}) =>
    new AirtelCollectionLedgerBridge(
      options,
    );

export const createLedgerBridge =
  createCollectionLedgerBridge;

export const CollectionLedgerBridge =
  AirtelCollectionLedgerBridge;

export const LedgerBridge =
  AirtelCollectionLedgerBridge;

export const DEFAULT_CONFIGURATION =
  DEFAULT_CONFIG;

export function normalizeCollectionAmountMinor(
  value,
) {
  return normalizeAmountMinor(
    value,
  );
}

export function normalizeCollectionCurrency(
  value,
  fallback =
    DEFAULT_CONFIG.defaultCurrency,
) {
  return normalizeCurrency(
    value,
    fallback,
  );
}

export default AirtelCollectionLedgerBridge;