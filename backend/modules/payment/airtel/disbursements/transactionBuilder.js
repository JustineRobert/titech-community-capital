'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Transaction Builder
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/transactionBuilder.js
 *
 * Architectural role
 * ------------------
 * Canonical deterministic command-construction boundary for Airtel outbound
 * disbursements. The builder converts an already-authorized disbursement intent
 * into a provider-adapter request envelope without performing any external
 * financial side effect.
 *
 * Canonical path
 * --------------
 *
 *   Disbursement Service
 *          |
 *          v
 *   Transaction Builder
 *          |
 *          v
 *   Airtel Provider Adapter
 *          |
 *          v
 *   Financial Core / Ledger
 *
 * Responsibilities
 * ----------------
 * - Validate and normalize the exact financial command shape.
 * - Preserve tenant, transaction and original idempotency identities.
 * - Produce deterministic request/fingerprint material.
 * - Normalize beneficiary identity without adjudicating KYC/AML/fraud.
 * - Separate provider-facing data from internal governance metadata.
 * - Build disbursement, status, callback, reversal and compensation command
 *   envelopes for downstream adapters/financial services.
 * - Prevent unsafe offline states and conflicting identity reuse.
 * - Redact secrets from diagnostic/audit projections.
 * - Expose capabilities and health without performing a provider call.
 *
 * Non-responsibilities
 * --------------------
 * - No Airtel HTTP/API calls.
 * - No provider authentication/token acquisition.
 * - No direct ledger/journal posting.
 * - No direct balance/wallet mutation.
 * - No database/repository access.
 * - No payment authorization or maker-checker decisions.
 * - No KYC/AML/sanctions/fraud source-of-truth decisions.
 * - No provider-result adjudication or settlement finality.
 * - No creation of a second financial transaction identity.
 *
 * Financial safety principles
 * ---------------------------
 * 1. The builder preserves the originating financial identity.
 * 2. The original idempotency key is never replaced with a generated key for a
 *    financial disbursement.
 * 3. A compensation/reversal operation must use a distinct correction identity.
 * 4. Exact minor-unit strings are used for authoritative amount fields.
 * 5. The builder never infers accounting accounts from beneficiary/provider data.
 * 6. Unresolved local/offline states are rejected before execution command
 *    construction.
 * 7. Rebuilding an identical command produces the same semantic fingerprint and
 *    stable provider correlation identity.
 * 8. Provider adapters are responsible for translating this canonical envelope
 *    into provider-specific wire formats.
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
  STATUS_OPERATION,
  COMPENSATION_OPERATION,
  COUNTRY_CODES,
  CURRENCY_CODES,
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  SUPPORTED_COUNTRIES,
  SUPPORTED_CURRENCIES,
  MONEY_POLICY,
  LIMITS,
  UNSAFE_OFFLINE_STATES,
  ERROR_CODES,
  normalizeProvider,
  normalizeOperation,
  normalizeMinorUnitAmount,
  isPositiveMinorUnitAmount,
  isUnsafeOfflineState,
} from './constants.js';

export const ENGINE_NAME = 'airtel-disbursement-transaction-builder';
export const ENGINE_VERSION = '3.0.0';
export const COMPONENT = ENGINE_NAME;

export const COMMAND_TYPES = Object.freeze({
  DISBURSEMENT: 'DISBURSEMENT',
  STATUS: 'STATUS',
  CALLBACK: 'CALLBACK',
  REVERSAL: 'REVERSAL',
  COMPENSATION: 'COMPENSATION',
});

export const BUILD_OUTCOMES = Object.freeze({
  BUILT: 'BUILT',
  REPLAY: 'REPLAY',
  INVALID: 'INVALID',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
});

export const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  requireAirtelProvider: true,
  requireDisbursementOperation: true,
  requireTransactionId: true,
  requireReference: true,
  requireOriginalIdempotencyKey: true,
  requireAmountMinor: true,
  requirePositiveAmount: true,
  requireCurrency: true,
  requireBeneficiary: true,
  rejectUnsafeOfflineStates: true,
  requireProviderSpecificReference: false,
  allowLegacyAmountAlias: true,
  allowUnvalidatedBeneficiary: false,
  requireBeneficiaryFingerprint: false,
  requireCountry: false,
  enforceSupportedCountry: true,
  enforceSupportedCurrency: true,
  enforceCurrencyMatchesCountry: true,
  allowCrossCurrency: false,
  allowCompensationWithoutOriginalKey: false,
  maxTenantIdLength: LIMITS.tenantIdLength ?? 160,
  maxTransactionIdLength: LIMITS.transactionIdLength ?? 240,
  maxDisbursementIdLength: LIMITS.paymentIdLength ?? 240,
  maxReferenceLength: LIMITS.referenceLength ?? 240,
  maxIdempotencyKeyLength: LIMITS.idempotencyKeyLength ?? 320,
  maxPurposeCodeLength: 120,
  maxBeneficiaryIdLength: LIMITS.beneficiaryIdLength ?? 240,
  maxProviderReferenceLength: LIMITS.referenceLength ?? 240,
  maxCorrelationIdLength: LIMITS.correlationIdLength ?? 240,
  maxRequestIdLength: LIMITS.requestIdLength ?? 240,
  maxTraceIdLength: LIMITS.traceIdLength ?? 240,
  maxActorIdLength: LIMITS.actorIdLength ?? 200,
  maxDescriptionLength: 500,
  maxMetadataDepth: LIMITS.metadataDepth ?? 5,
  maxMetadataKeys: LIMITS.metadataKeys ?? 64,
  maxMetadataArrayLength: LIMITS.metadataArrayLength ?? 100,
  maxMetadataStringLength: LIMITS.metadataStringLength ?? 2048,
  maxPayloadBytes: 256 * 1024,
  idPrefix: 'airtel-dsb',
  commandVersion: '1.0',
  generateCommandId: true,
});

const PRIVATE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const SECRET_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|set-cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|client.?secret|credential|signature|raw(request|response)|provider.?payload)/i;

const UNSAFE_KEY_PATTERN = /(^\$)|\./;

const SUCCESS_OUTCOMES = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'SUCCESSFUL',
  'COMPLETED',
  'SETTLED',
  'POSTED',
  'PAID',
  'CONFIRMED',
]);

const FAILURE_OUTCOMES = new Set([
  'FAILED',
  'FAILURE',
  'REJECTED',
  'DECLINED',
  'DENIED',
  'CANCELLED',
  'CANCELED',
  'EXPIRED',
]);

const AMBIGUOUS_OUTCOMES = new Set([
  'UNKNOWN',
  'AMBIGUOUS',
  'TIMEOUT',
  'NO_RESPONSE',
  'INDETERMINATE',
]);

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
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

const text = (value, maxLength = 240) => {
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
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
};

const stable = (value) => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === 'bigint') return `bigint:${value}`;

  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable(value[key])}`,
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
        : stable(value),
    )
    .digest('hex');

const nowMs = (clock) => {
  try {
    const value = clock?.now?.();

    if (value instanceof Date) {
      return value.getTime();
    }

    if (Number.isFinite(value)) {
      return value;
    }
  } catch {
    // System time fallback.
  }

  return Date.now();
};

const nowIso = (clock) =>
  new Date(nowMs(clock)).toISOString();

const sanitize = (
  value,
  depth,
  config,
) => {
  const currentDepth = depth ?? 0;

  if (
    currentDepth >
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
          currentDepth + 1,
          config,
        ),
      );
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const result = {};

  for (
    const key of Object.keys(value).slice(
      0,
      config.maxMetadataKeys,
    )
  ) {
    if (
      PRIVATE_KEYS.has(key) ||
      UNSAFE_KEY_PATTERN.test(key)
    ) {
      continue;
    }

    result[key] = SECRET_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitize(
          value[key],
          currentDepth + 1,
          config,
        );
  }

  return result;
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

const requireField = (
  value,
  field,
  maxLength,
) => {
  const normalized = text(
    value,
    maxLength,
  );

  if (!normalized) {
    throw new AirtelTransactionBuilderError(
      `${field} is required.`,
      'TRANSACTION_BUILDER_REQUIRED_FIELD',
      { field },
      { httpStatus: 422 },
    );
  }

  return normalized;
};

const normalizeDate = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AirtelTransactionBuilderError(
      'occurredAt must be a valid timestamp.',
      'TRANSACTION_BUILDER_INVALID_TIMESTAMP',
      {},
      { httpStatus: 422 },
    );
  }

  return date;
};

const normalizeAmount = (value, config) => {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    normalizeMinorUnitAmount(value);

  if (!normalized) {
    throw new AirtelTransactionBuilderError(
      'amountMinor must contain integer minor units only.',
      'TRANSACTION_BUILDER_INVALID_AMOUNT',
      {},
      { httpStatus: 422 },
    );
  }

  if (
    config.requirePositiveAmount &&
    !isPositiveMinorUnitAmount(normalized)
  ) {
    throw new AirtelTransactionBuilderError(
      'amountMinor must be greater than zero.',
      'TRANSACTION_BUILDER_INVALID_AMOUNT',
      {},
      { httpStatus: 422 },
    );
  }

  return normalized;
};

const normalizeCurrency = (
  value,
  config,
) => {
  const currency = upper(
    value ??
      config.defaultCurrency ??
      DEFAULT_CURRENCY,
  );

  if (
    !currency ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new AirtelTransactionBuilderError(
      'currency must be a valid three-letter currency code.',
      'TRANSACTION_BUILDER_INVALID_CURRENCY',
      {},
      { httpStatus: 422 },
    );
  }

  if (
    config.enforceSupportedCurrency &&
    Array.isArray(SUPPORTED_CURRENCIES) &&
    !SUPPORTED_CURRENCIES.includes(currency)
  ) {
    throw new AirtelTransactionBuilderError(
      `Currency ${currency} is not supported by the Airtel disbursement contract.`,
      'TRANSACTION_BUILDER_UNSUPPORTED_CURRENCY',
      { currency },
      { httpStatus: 422 },
    );
  }

  return currency;
};

const normalizeCountry = (
  value,
  config,
) => {
  const country = upper(
    value ??
      config.defaultCountry ??
      DEFAULT_COUNTRY,
  );

  if (
    !country ||
    country.length !== 2
  ) {
    throw new AirtelTransactionBuilderError(
      'country must be a two-letter country code.',
      'TRANSACTION_BUILDER_INVALID_COUNTRY',
      {},
      { httpStatus: 422 },
    );
  }

  if (
    config.enforceSupportedCountry &&
    Array.isArray(SUPPORTED_COUNTRIES) &&
    !SUPPORTED_COUNTRIES.includes(country)
  ) {
    throw new AirtelTransactionBuilderError(
      `Country ${country} is not supported by the Airtel disbursement contract.`,
      'TRANSACTION_BUILDER_UNSUPPORTED_COUNTRY',
      { country },
      { httpStatus: 422 },
    );
  }

  return country;
};

const defaultCurrencyForCountry = (
  country,
) => {
  if (
    country === COUNTRY_CODES.UGANDA ||
    country === 'UG'
  ) {
    return CURRENCY_CODES.UGX;
  }

  return undefined;
};

const isStringLike = (value) =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'bigint';

const normalizeBeneficiaryInput = (
  beneficiary,
  context,
  config,
) => {
  const source =
    isPlainObject(beneficiary)
      ? beneficiary
      : {};

  if (
    !isPlainObject(beneficiary) &&
    config.requireBeneficiary
  ) {
    throw new AirtelTransactionBuilderError(
      'A beneficiary object is required.',
      'TRANSACTION_BUILDER_BENEFICIARY_REQUIRED',
      {},
      { httpStatus: 422 },
    );
  }

  const partyIdType = upper(
    source.partyIdType ??
      source.identifierType ??
      source.type ??
      context.beneficiaryIdentity?.beneficiaryIdType ??
      context.beneficiaryIdentity?.partyIdType ??
      'MSISDN',
  );

  const partyId = text(
    source.partyId ??
      source.identifier ??
      source.msisdn ??
      source.phoneNumber ??
      source.phone ??
      source.accountId ??
      source.walletId ??
      source.merchantId ??
      context.beneficiaryIdentity?.partyId ??
      context.beneficiaryIdentity?.beneficiaryId,
    config.maxBeneficiaryIdLength,
  );

  if (!partyId) {
    throw new AirtelTransactionBuilderError(
      'Beneficiary party identifier is required.',
      'TRANSACTION_BUILDER_BENEFICIARY_IDENTIFIER_REQUIRED',
      {},
      { httpStatus: 422 },
    );
  }

  if (
    !isStringLike(partyId)
  ) {
    throw new AirtelTransactionBuilderError(
      'Beneficiary party identifier has an unsupported type.',
      'TRANSACTION_BUILDER_BENEFICIARY_IDENTIFIER_INVALID',
      {},
      { httpStatus: 422 },
    );
  }

  const country =
    normalizeCountry(
      source.country ??
        source.countryCode ??
        context.country,
      config,
    );

  const currency =
    normalizeCurrency(
      source.currency ??
        context.currency ??
        defaultCurrencyForCountry(country),
      config,
    );

  if (
    config.enforceCurrencyMatchesCountry
  ) {
    const expected =
      defaultCurrencyForCountry(
        country,
      );

    if (
      expected &&
      currency !== expected &&
      !config.allowCrossCurrency
    ) {
      throw new AirtelTransactionBuilderError(
        `Currency ${currency} does not match the configured country currency ${expected}.`,
        'TRANSACTION_BUILDER_COUNTRY_CURRENCY_MISMATCH',
        {
          country,
          currency,
          expectedCurrency:
            expected,
        },
        { httpStatus: 422 },
      );
    }
  }

  const beneficiaryFingerprint =
    text(
      context.beneficiaryIdentity?.beneficiaryFingerprint ??
        context.beneficiaryIdentity?.fingerprint ??
        source.beneficiaryFingerprint ??
        source.fingerprint ??
        source.beneficiaryHash,
      128,
    ) ??
    sha256({
      provider:
        PROVIDER,
      country,
      partyIdType,
      partyId,
    });

  if (
    config.requireBeneficiaryFingerprint &&
    !beneficiaryFingerprint
  ) {
    throw new AirtelTransactionBuilderError(
      'Authoritative beneficiary fingerprint is required.',
      'TRANSACTION_BUILDER_BENEFICIARY_FINGERPRINT_REQUIRED',
      {},
      { httpStatus: 409 },
    );
  }

  const validationOutcome = upper(
    context.beneficiaryValidation?.outcome ??
      context.beneficiaryValidation?.decision ??
      source.validationOutcome,
  );

  const validationAllowed =
    context.beneficiaryValidation?.valid === true ||
    context.beneficiaryValidation?.approved === true ||
    ['PASS', 'ALLOWED', 'ALLOW'].includes(
      validationOutcome,
    );

  const validationReview =
    ['REVIEW', 'REQUIRE_REVIEW', 'PENDING'].includes(
      validationOutcome,
    );

  const validationBlocked =
    context.beneficiaryValidation?.blocked === true ||
    ['BLOCK', 'DENY', 'REJECT', 'REJECTED'].includes(
      validationOutcome,
    );

  if (validationBlocked) {
    throw new AirtelTransactionBuilderError(
      'Beneficiary validation has blocked this transaction.',
      'TRANSACTION_BUILDER_BENEFICIARY_BLOCKED',
      {
        beneficiaryFingerprint,
      },
      { httpStatus: 409 },
    );
  }

  if (
    validationReview &&
    !config.allowUnvalidatedBeneficiary
  ) {
    throw new AirtelTransactionBuilderError(
      'Beneficiary validation requires review before provider command construction.',
      'TRANSACTION_BUILDER_BENEFICIARY_REVIEW_REQUIRED',
      {
        beneficiaryFingerprint,
      },
      { httpStatus: 409 },
    );
  }

  if (
    !validationAllowed &&
    !config.allowUnvalidatedBeneficiary &&
    context.beneficiaryValidation
  ) {
    throw new AirtelTransactionBuilderError(
      'Beneficiary validation was not authoritatively passed.',
      'TRANSACTION_BUILDER_BENEFICIARY_NOT_VALIDATED',
      {
        beneficiaryFingerprint,
      },
      { httpStatus: 409 },
    );
  }

  return {
    partyId,
    partyIdType,
    country,
    currency,
    beneficiaryFingerprint,
    displayName: text(
      source.displayName ??
        source.name ??
        source.fullName,
      240,
    ),
    firstName: text(
      source.firstName,
      120,
    ),
    lastName: text(
      source.lastName,
      120,
    ),
    status: upper(
      source.status ??
        source.accountStatus,
    ),
    kycStatus: upper(
      source.kycStatus,
    ),
    normalized: true,
  };
};

const normalizeOfflineState = (input) =>
  upper(
    input.offlineState ??
      input.syncState,
  );

const normalizeActor = (
  actor,
  config,
) => {
  if (!isPlainObject(actor)) {
    return undefined;
  }

  return {
    actorId: text(
      actor.actorId ??
        actor.userId ??
        actor.principalId ??
        actor.id,
      config.maxActorIdLength,
    ),
    role: upper(
      actor.role ??
        actor.actorRole,
    ),
    tenantId: text(
      actor.tenantId,
      config.maxTenantIdLength,
    ),
  };
};

const normalizeMetadata = (
  metadata,
  config,
) =>
  sanitize(
    metadata ?? {},
    0,
    config,
  );

const commandIdentity = (context) => ({
  schemaVersion:
    SCHEMA_VERSION,
  commandVersion:
    context.commandVersion,
  tenantId:
    context.tenantId,
  provider:
    PROVIDER,
  operation:
    context.operation,
  commandType:
    context.commandType,
  transactionId:
    context.transactionId,
  disbursementId:
    context.disbursementId,
  reference:
    context.reference,
  originalIdempotencyKey:
    context.originalIdempotencyKey,
  amountMinor:
    context.amountMinor,
  currency:
    context.currency,
  country:
    context.country,
  beneficiaryFingerprint:
    context.beneficiary?.beneficiaryFingerprint,
  beneficiaryPartyIdType:
    context.beneficiary?.partyIdType,
  purposeCode:
    context.purposeCode,
});

const payloadByteSize = (value) =>
  Buffer.byteLength(
    JSON.stringify(value),
    'utf8',
  );

export const buildTransactionFingerprint = (
  context = {},
) =>
  sha256(
    commandIdentity(
      context,
    ),
  );

export const buildCommandId = (
  context = {},
) =>
  `cmd_${sha256(
    commandIdentity(
      context,
    ),
  ).slice(0, 48)}`;

export const buildProviderCorrelationId = (
  context = {},
) =>
  `airtel:${sha256({
    tenantId:
      context.tenantId,
    transactionId:
      context.transactionId,
    originalIdempotencyKey:
      context.originalIdempotencyKey,
    reference:
      context.reference,
    commandType:
      context.commandType,
  }).slice(0, 48)}`;

export const buildCompensationIdentity = ({
  tenantId,
  transactionId,
  originalIdempotencyKey,
  compensationIdempotencyKey,
}) => {
  const originalKey =
    text(
      originalIdempotencyKey,
      DEFAULT_CONFIG.maxIdempotencyKeyLength,
    );

  const compensationKey =
    text(
      compensationIdempotencyKey,
      DEFAULT_CONFIG.maxIdempotencyKeyLength,
    );

  if (!compensationKey) {
    throw new AirtelTransactionBuilderError(
      'compensationIdempotencyKey is required for a corrective financial operation.',
      'TRANSACTION_BUILDER_COMPENSATION_KEY_REQUIRED',
      {},
      { httpStatus: 422 },
    );
  }

  if (
    originalKey &&
    originalKey === compensationKey
  ) {
    throw new AirtelTransactionBuilderError(
      'Compensation idempotency identity must be distinct from the original financial identity.',
      'TRANSACTION_BUILDER_COMPENSATION_KEY_COLLISION',
      {},
      { httpStatus: 409 },
    );
  }

  return `cmp:${sha256({
    tenantId,
    transactionId,
    originalIdempotencyKeyHash:
      originalKey
        ? sha256(originalKey)
        : null,
    compensationIdempotencyKey:
      compensationKey,
  }).slice(0, 56)}`;
};

const extractBeneficiary = (input) =>
  input.beneficiary ??
  input.beneficiaryIdentity ??
  input.destination ??
  input.recipient ??
  null;

export class AirtelTransactionBuilderError extends Error {
  constructor(
    message,
    code = 'TRANSACTION_BUILDER_ERROR',
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
      'AirtelTransactionBuilderError';

    this.code =
      code;

    this.component =
      COMPONENT;

    this.provider =
      PROVIDER;

    this.operation =
      upper(
        options.operation ??
          OPERATION,
      );

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

export class AirtelDisbursementTransactionBuilder {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new AirtelTransactionBuilderError(
        'Transaction builder options must be a plain object.',
        'TRANSACTION_BUILDER_INVALID_OPTIONS',
        {},
        { httpStatus: 500 },
      );
    }

    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...(options.config ??
        options.configuration ??
        {}),
    });

    this.clock =
      options.clock ??
      {
        now: () => Date.now(),
      };

    this.logger =
      options.logger ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.idFactory =
      isFunction(options.idFactory)
        ? options.idFactory
        : () => randomUUID();
  }

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new AirtelTransactionBuilderError(
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

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[level] ??
        this.logger?.log ??
        this.logger?.info;

      if (!isFunction(method)) {
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
          ...sanitize(
            context,
            0,
            this.config,
          ),
        },
        message,
      );
    } catch {
      // Logging cannot influence command construction.
    }
  }

  #metric(
    name,
    labels = {},
  ) {
    try {
      const method =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      if (!isFunction(method)) {
        return;
      }

      method.call(
        this.metrics,
        name,
        sanitize(
          labels,
          0,
          this.config,
        ),
      );
    } catch {
      // Metrics are observational only.
    }
  }

  normalizeContext(
    input = {},
    {
      commandType =
        COMMAND_TYPES.DISBURSEMENT,
      operation =
        OPERATION,
      requireTransactionId =
        this.config.requireTransactionId,
      requireReference =
        this.config.requireReference,
      requireOriginalIdempotencyKey =
        this.config.requireOriginalIdempotencyKey,
      requireAmountMinor =
        this.config.requireAmountMinor,
      requireBeneficiary =
        this.config.requireBeneficiary,
    } = {},
  ) {
    if (!isPlainObject(input)) {
      this.#throw(
        'TRANSACTION_BUILDER_INVALID_INPUT',
        'Transaction builder input must be a plain object.',
        {},
        { httpStatus: 422 },
      );
    }

    const tenantId =
      requireField(
        input.tenantId ??
          input.context?.tenantId,
        'tenantId',
        this.config
          .maxTenantIdLength,
      );

    const provider =
      normalizeProvider(
        input.provider ??
          PROVIDER,
      );

    if (
      this.config
        .requireAirtelProvider &&
      provider !== PROVIDER
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_PROVIDER_SCOPE_VIOLATION',
        'Only the AIRTEL provider is supported by this builder.',
        {
          provider,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const normalizedOperation =
      normalizeOperation(
        operation ??
          input.operation ??
          OPERATION,
      );

    if (
      this.config
        .requireDisbursementOperation &&
      commandType ===
        COMMAND_TYPES.DISBURSEMENT &&
      normalizedOperation !== OPERATION
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_OPERATION_SCOPE_VIOLATION',
        'Disbursement commands must use the canonical DISBURSEMENT operation.',
        {
          operation:
            normalizedOperation,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const transactionId =
      text(
        input.transactionId ??
          input.financialTransactionId ??
          input.paymentId,
        this.config
          .maxTransactionIdLength,
      );

    if (
      requireTransactionId &&
      !transactionId
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_TRANSACTION_ID_REQUIRED',
        'transactionId is required for the disbursement command.',
        {},
        {
          httpStatus: 422,
          operation:
            normalizedOperation,
        },
      );
    }

    const disbursementId =
      text(
        input.disbursementId ??
          input.commandId ??
          transactionId ??
          input.reference,
        this.config
          .maxDisbursementIdLength,
      ) ??
      (
        this.config
          .generateCommandId
          ? `${this.config.idPrefix}-${this.idFactory()}`
          : undefined
      );

    const reference =
      text(
        input.reference ??
          input.paymentReference ??
          input.externalReference,
        this.config
          .maxReferenceLength,
      );

    if (
      requireReference &&
      !reference
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_REFERENCE_REQUIRED',
        'A stable disbursement reference is required.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const originalIdempotencyKey =
      text(
        input.originalIdempotencyKey ??
          input.idempotencyKey ??
          input.headers?.[
            'idempotency-key'
          ],
        this.config
          .maxIdempotencyKeyLength,
      );

    if (
      requireOriginalIdempotencyKey &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_IDEMPOTENCY_KEY_REQUIRED',
        'The originating financial idempotency key is required.',
        {},
        {
          httpStatus: 422,
          operation:
            normalizedOperation,
        },
      );
    }

    let rawAmount =
      input.amountMinor ??
      input.amountInMinorUnits;

    if (
      rawAmount === undefined &&
      this.config
        .allowLegacyAmountAlias
    ) {
      rawAmount =
        input.amount;
    }

    const amountMinor =
      normalizeAmount(
        rawAmount,
        this.config,
      );

    if (
      requireAmountMinor &&
      !amountMinor
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_AMOUNT_REQUIRED',
        'amountMinor is required for a financial disbursement command.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const offlineState =
      normalizeOfflineState(
        input,
      );

    if (
      this.config
        .rejectUnsafeOfflineStates &&
      offlineState &&
      isUnsafeOfflineState(
        offlineState,
      )
    ) {
      this.#throw(
        ERROR_CODES.OFFLINE_UNSAFE ??
          'TRANSACTION_BUILDER_OFFLINE_UNSAFE',
        'An unresolved offline state cannot produce a live financial provider command.',
        {
          offlineState,
        },
        {
          httpStatus: 409,
        },
      );
    }

    const country =
      normalizeCountry(
        input.country ??
          input.countryCode ??
          input.beneficiary?.country,
        this.config,
      );

    const currency =
      normalizeCurrency(
        input.currency ??
          input.beneficiary?.currency ??
          defaultCurrencyForCountry(
            country,
          ),
        this.config,
      );

    const actor =
      normalizeActor(
        input.actor,
        this.config,
      );

    if (
      actor?.tenantId &&
      actor.tenantId !==
        tenantId
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_ACTOR_TENANT_MISMATCH',
        'Actor tenant does not match transaction tenant.',
        {},
        {
          httpStatus: 403,
        },
      );
    }

    const beneficiaryInput =
      extractBeneficiary(
        input,
      );

    if (
      requireBeneficiary &&
      !beneficiaryInput
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_BENEFICIARY_REQUIRED',
        'Beneficiary is required for a disbursement command.',
        {},
        {
          httpStatus: 422,
        },
      );
    }

    const beneficiary =
      requireBeneficiary ||
      beneficiaryInput
        ? normalizeBeneficiaryInput(
            beneficiaryInput,
            {
              ...input,
              country,
              currency,
            },
            this.config,
          )
        : null;

    if (
      beneficiary &&
      beneficiary.currency !==
        currency &&
      !this.config.allowCrossCurrency
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_BENEFICIARY_CURRENCY_MISMATCH',
        'Beneficiary currency must match the disbursement currency.',
        {
          currency,
          beneficiaryCurrency:
            beneficiary.currency,
        },
        {
          httpStatus: 422,
        },
      );
    }

    const purposeCode =
      text(
        input.purposeCode ??
          input.purpose,
        this.config
          .maxPurposeCodeLength,
      );

    const requestId =
      text(
        input.requestId,
        this.config
          .maxRequestIdLength,
      );

    const correlationId =
      text(
        input.correlationId,
        this.config
          .maxCorrelationIdLength,
      );

    const traceId =
      text(
        input.traceId,
        this.config
          .maxTraceIdLength,
      );

    const occurredAt =
      normalizeDate(
        input.occurredAt,
        new Date(
          nowMs(
            this.clock,
          ),
        ),
      );

    const metadata =
      normalizeMetadata(
        input.metadata,
        this.config,
      );

    const description =
      text(
        input.description,
        this.config
          .maxDescriptionLength,
      ) ??
      `Airtel ${normalizedOperation.toLowerCase()} command`;

    const commandVersion =
      text(
        input.commandVersion ??
          this.config.commandVersion,
        40,
      ) ??
      this.config.commandVersion;

    const context = {
      tenantId,
      provider:
        PROVIDER,
      operation:
        normalizedOperation,
      commandType,
      commandVersion,
      transactionId,
      disbursementId,
      reference,
      originalIdempotencyKey,
      amountMinor,
      currency,
      country,
      beneficiary,
      beneficiaryValidation:
        input.beneficiaryValidation
          ? sanitize(
              input.beneficiaryValidation,
              0,
              this.config,
            )
          : undefined,
      purposeCode,
      requestId,
      correlationId,
      traceId,
      actor,
      offlineState,
      occurredAt,
      description,
      metadata,
      session:
        input.session ??
        null,
      source:
        text(
          input.source,
          160,
        ) ??
        COMPONENT,
      compensationIdempotencyKey:
        text(
          input.compensationIdempotencyKey ??
            input.reversalIdempotencyKey,
          this.config
            .maxIdempotencyKeyLength,
        ),
    };

    const fingerprint =
      buildTransactionFingerprint(
        context,
      );

    const providerCorrelationId =
      buildProviderCorrelationId(
        context,
      );

    const commandId =
      text(
        input.commandId,
        this.config
          .maxDisbursementIdLength,
      ) ??
      buildCommandId(
        context,
      );

    return {
      ...context,
      commandId,
      transactionFingerprint:
        fingerprint,
      providerCorrelationId,
    };
  }

  #buildHeader(
    context,
    commandId,
  ) {
    return {
      schemaVersion:
        SCHEMA_VERSION,
      commandVersion:
        context.commandVersion,
      engine:
        ENGINE_NAME,
      engineVersion:
        ENGINE_VERSION,
      provider:
        PROVIDER,
      operation:
        context.operation,
      commandType:
        context.commandType,
      commandId,
      requestId:
        context.requestId ??
        commandId,
      correlationId:
        context.correlationId ??
        context.providerCorrelationId,
      traceId:
        context.traceId,
      tenantId:
        context.tenantId,
    };
  }

  #buildFinancialIdentity(
    context,
  ) {
    return {
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      disbursementId:
        context.disbursementId,
      reference:
        context.reference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      transactionFingerprint:
        context.transactionFingerprint,
      provider:
        PROVIDER,
      operation:
        context.operation,
    };
  }

  #buildBeneficiaryProjection(
    context,
  ) {
    if (!context.beneficiary) {
      return null;
    }

    return {
      partyId:
        context.beneficiary.partyId,
      partyIdType:
        context.beneficiary.partyIdType,
      country:
        context.beneficiary.country,
      currency:
        context.beneficiary.currency,
      beneficiaryFingerprint:
        context.beneficiary
          .beneficiaryFingerprint,
      displayName:
        context.beneficiary.displayName,
      firstName:
        context.beneficiary.firstName,
      lastName:
        context.beneficiary.lastName,
    };
  }

  #buildSafety(
    context,
  ) {
    return {
      preserveOriginalFinancialIdentity:
        true,
      originalIdempotencyKeyRequired:
        this.config
          .requireOriginalIdempotencyKey,
      generateNewFinancialIdentity:
        false,
      directProviderCall:
        false,
      directLedgerMutation:
        false,
      directBalanceMutation:
        false,
      directWalletMutation:
        false,
      settlementFinalityAuthority:
        'TITECH_FINANCIAL_CORE',
      unresolvedOfflineStatesRejected:
        this.config
          .rejectUnsafeOfflineStates,
      providerAdapterMustTranslate:
        true,
      amountRepresentation:
        'MINOR_UNITS_STRING',
      originalIdempotencyKeyHash:
        context.originalIdempotencyKey
          ? sha256(
              context.originalIdempotencyKey,
            )
          : null,
    };
  }

  #assertPayloadSize(
    payload,
  ) {
    let bytes;

    try {
      bytes = payloadByteSize(
        payload,
      );
    } catch (error) {
      this.#throw(
        'TRANSACTION_BUILDER_PAYLOAD_SERIALIZATION_FAILED',
        'Transaction command could not be serialized safely.',
        {},
        {
          retryable: false,
          httpStatus: 422,
          cause: error,
        },
      );
    }

    if (
      bytes >
      this.config.maxPayloadBytes
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_PAYLOAD_TOO_LARGE',
        'Transaction command exceeds the configured payload limit.',
        {
          maxPayloadBytes:
            this.config.maxPayloadBytes,
          actualBytes:
            bytes,
        },
        {
          httpStatus: 413,
        },
      );
    }

    return bytes;
  }

  buildDisbursement(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          commandType:
            COMMAND_TYPES.DISBURSEMENT,
          operation:
            OPERATION,
          requireTransactionId:
            this.config
              .requireTransactionId,
          requireReference:
            this.config
              .requireReference,
          requireOriginalIdempotencyKey:
            this.config
              .requireOriginalIdempotencyKey,
          requireAmountMinor:
            this.config
              .requireAmountMinor,
          requireBeneficiary:
            this.config
              .requireBeneficiary,
        },
      );

    const commandId =
      context.commandId;

    const beneficiary =
      this.#buildBeneficiaryProjection(
        context,
      );

    const financialIdentity =
      this.#buildFinancialIdentity(
        context,
      );

    const providerRequest = {
      header:
        this.#buildHeader(
          context,
          commandId,
        ),

      financialIdentity,

      amount: {
        amountMinor:
          context.amountMinor,
        currency:
          context.currency,
        precision:
          MONEY_POLICY?.minorUnitScale ??
          0,
      },

      beneficiary,

      instruction: {
        disbursementId:
          context.disbursementId,
        reference:
          context.reference,
        purposeCode:
          context.purposeCode,
        description:
          context.description,
        country:
          context.country,
      },

      provider: {
        code:
          PROVIDER,
        correlationId:
          context.providerCorrelationId,
        idempotencyKey:
          context.originalIdempotencyKey,
        statusOperation:
          STATUS_OPERATION,
        compensationOperation:
          COMPENSATION_OPERATION,
      },

      executionContext: {
        requestId:
          context.requestId,
        correlationId:
          context.correlationId,
        traceId:
          context.traceId,
        actorId:
          context.actor?.actorId,
        source:
          context.source,
      },

      metadata:
        context.metadata,

      occurredAt:
        context.occurredAt,

      safety:
        this.#buildSafety(
          context,
        ),

      transactionFingerprint:
        context.transactionFingerprint,
    };

    const bytes =
      this.#assertPayloadSize(
        providerRequest,
      );

    const result = deepFreeze({
      outcome:
        BUILD_OUTCOMES.BUILT,
      commandType:
        COMMAND_TYPES.DISBURSEMENT,
      commandId,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      disbursementId:
        context.disbursementId,
      reference:
        context.reference,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      transactionFingerprint:
        context.transactionFingerprint,
      providerCorrelationId:
        context.providerCorrelationId,
      // Compatibility projection: existing provider adapters may consume the
      // canonical fields directly. The nested providerRequest remains the
      // authoritative structured envelope.
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      beneficiary:
        beneficiary,
      country:
        context.country,
      purposeCode:
        context.purposeCode,
      metadata:
        context.metadata,
      requestId:
        context.requestId,
      correlationId:
        context.correlationId,
      traceId:
        context.traceId,
      providerRequest,
      payloadBytes:
        bytes,
      financialSafety:
        this.#buildSafety(
          context,
        ),
    });

    this.#metric(
      'airtel.disbursement.transaction_builder.build.total',
      {
        commandType:
          COMMAND_TYPES.DISBURSEMENT,
      },
    );

    return result;
  }

  build(input = {}) {
    return this.buildDisbursement(
      input,
    );
  }

  createRequest(input = {}) {
    return this.buildDisbursement(
      input,
    );
  }

  buildStatusRequest(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          commandType:
            COMMAND_TYPES.STATUS,
          operation:
            STATUS_OPERATION,
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requireBeneficiary:
            false,
        },
      );

    if (
      !context.transactionId &&
      !context.disbursementId &&
      !context.reference &&
      !input.providerTransactionId &&
      !input.providerReference
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_STATUS_IDENTITY_REQUIRED',
        'Status command requires transaction, disbursement, reference or provider identity.',
        {},
        {
          httpStatus: 422,
          operation:
            STATUS_OPERATION,
        },
      );
    }

    const commandId =
      context.commandId;

    const providerRequest = {
      header:
        this.#buildHeader(
          context,
          commandId,
        ),

      lookup: {
        transactionId:
          context.transactionId,
        disbursementId:
          context.disbursementId,
        reference:
          context.reference,
        providerTransactionId:
          text(
            input.providerTransactionId,
            this.config
              .maxProviderReferenceLength,
          ),
        providerReference:
          text(
            input.providerReference,
            this.config
              .maxProviderReferenceLength,
          ),
      },

      financialIdentity:
        this.#buildFinancialIdentity(
          context,
        ),

      provider: {
        code:
          PROVIDER,
        correlationId:
          context.providerCorrelationId,
        statusOperation:
          STATUS_OPERATION,
      },

      executionContext: {
        requestId:
          context.requestId,
        correlationId:
          context.correlationId,
        traceId:
          context.traceId,
        source:
          context.source,
      },

      metadata:
        context.metadata,

      occurredAt:
        context.occurredAt,

      transactionFingerprint:
        context.transactionFingerprint,
    };

    const bytes =
      this.#assertPayloadSize(
        providerRequest,
      );

    return deepFreeze({
      outcome:
        BUILD_OUTCOMES.BUILT,
      commandType:
        COMMAND_TYPES.STATUS,
      commandId,
      provider:
        PROVIDER,
      operation:
        STATUS_OPERATION,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      disbursementId:
        context.disbursementId,
      reference:
        context.reference,
      providerTransactionId:
        text(
          input.providerTransactionId,
          this.config.maxProviderReferenceLength,
        ),
      providerReference:
        text(
          input.providerReference,
          this.config.maxProviderReferenceLength,
        ),
      transactionFingerprint:
        context.transactionFingerprint,
      providerRequest,
      payloadBytes:
        bytes,
      financialSafety: {
        providerCallAllowed:
          true,
        financialMutation:
          false,
        ledgerMutation:
          false,
        balanceMutation:
          false,
      },
    });
  }

  buildReversalRequest(
    input = {},
  ) {
    const originalIdempotencyKey =
      text(
        input.originalIdempotencyKey ??
          input.idempotencyKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    const compensationIdempotencyKey =
      text(
        input.compensationIdempotencyKey ??
          input.reversalIdempotencyKey ??
          input.compensationKey,
        this.config
          .maxIdempotencyKeyLength,
      );

    if (
      !this.config
        .allowCompensationWithoutOriginalKey &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_ORIGINAL_IDEMPOTENCY_REQUIRED_FOR_REVERSAL',
        'Reversal must retain the original financial idempotency identity.',
        {},
        {
          httpStatus: 422,
          operation:
            'REVERSAL',
        },
      );
    }

    const compensationIdentity =
      buildCompensationIdentity({
        tenantId:
          input.tenantId,
        transactionId:
          input.transactionId,
        originalIdempotencyKey,
        compensationIdempotencyKey,
      });

    const context =
      this.normalizeContext(
        {
          ...input,
          originalIdempotencyKey,
          compensationIdempotencyKey,
        },
        {
          commandType:
            COMMAND_TYPES.REVERSAL,
          operation:
            'REVERSAL',
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requireBeneficiary:
            false,
        },
      );

    const commandId =
      context.commandId;

    const providerRequest = {
      header:
        this.#buildHeader(
          context,
          commandId,
        ),

      financialIdentity:
        this.#buildFinancialIdentity(
          context,
        ),

      reversal: {
        compensationIdentity,
        compensationIdempotencyKey,
        originalIdempotencyKey,
        originalTransactionId:
          context.transactionId,
        originalReference:
          context.reference,
        reasonCode:
          text(
            input.reasonCode,
            160,
          ),
        reason:
          text(
            input.reason ??
              input.reasonCode,
            this.config
              .maxDescriptionLength,
          ),
      },

      provider: {
        code:
          PROVIDER,
        correlationId:
          context.providerCorrelationId,
      },

      executionContext: {
        requestId:
          context.requestId,
        correlationId:
          context.correlationId,
        traceId:
          context.traceId,
        actorId:
          context.actor?.actorId,
        source:
          context.source,
      },

      metadata:
        context.metadata,

      occurredAt:
        context.occurredAt,

      financialSafety:
        this.#buildSafety(
          context,
        ),
    };

    const bytes =
      this.#assertPayloadSize(
        providerRequest,
      );

    return deepFreeze({
      outcome:
        BUILD_OUTCOMES.BUILT,
      commandType:
        COMMAND_TYPES.REVERSAL,
      commandId,
      provider:
        PROVIDER,
      operation:
        'REVERSAL',
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      originalIdempotencyKey,
      compensationIdempotencyKey,
      compensationIdentity,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      reference:
        context.reference,
      transactionFingerprint:
        context.transactionFingerprint,
      providerRequest,
      payloadBytes:
        bytes,
      financialSafety:
        this.#buildSafety(
          context,
        ),
    });
  }

  buildCompensationRequest(
    input = {},
  ) {
    const originalIdempotencyKey =
      text(
        input.originalIdempotencyKey ??
          input.idempotencyKey,
        this.config.maxIdempotencyKeyLength,
      );

    const compensationIdempotencyKey =
      text(
        input.compensationIdempotencyKey ??
          input.reversalIdempotencyKey ??
          input.compensationKey,
        this.config.maxIdempotencyKeyLength,
      );

    if (
      !this.config.allowCompensationWithoutOriginalKey &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_ORIGINAL_IDEMPOTENCY_REQUIRED_FOR_COMPENSATION',
        'Compensation must retain the original financial idempotency identity.',
        {},
        {
          httpStatus: 422,
          operation:
            COMPENSATION_OPERATION,
        },
      );
    }

    const compensationIdentity =
      buildCompensationIdentity({
        tenantId:
          input.tenantId,
        transactionId:
          input.transactionId,
        originalIdempotencyKey,
        compensationIdempotencyKey,
      });

    const context =
      this.normalizeContext(
        {
          ...input,
          originalIdempotencyKey,
          compensationIdempotencyKey,
        },
        {
          commandType:
            COMMAND_TYPES.COMPENSATION,
          operation:
            COMPENSATION_OPERATION,
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requireBeneficiary:
            false,
        },
      );

    const commandId =
      context.commandId;

    const transactionFingerprint =
      buildTransactionFingerprint({
        ...context,
        commandType:
          COMMAND_TYPES.COMPENSATION,
        operation:
          COMPENSATION_OPERATION,
      });

    const providerCorrelationId =
      buildProviderCorrelationId({
        ...context,
        commandType:
          COMMAND_TYPES.COMPENSATION,
      });

    const providerRequest = {
      header:
        {
          ...this.#buildHeader(
            {
              ...context,
              providerCorrelationId,
            },
            commandId,
          ),
          operation:
            COMPENSATION_OPERATION,
          commandType:
            COMMAND_TYPES.COMPENSATION,
        },

      financialIdentity: {
        ...this.#buildFinancialIdentity(
          context,
        ),
        operation:
          COMPENSATION_OPERATION,
        originalTransactionId:
          context.transactionId,
        originalIdempotencyKey,
      },

      compensation: {
        compensationIdentity,
        compensationIdempotencyKey,
        originalIdempotencyKey,
        originalTransactionId:
          context.transactionId,
        originalReference:
          context.reference,
        reasonCode:
          text(
            input.reasonCode,
            160,
          ),
        reason:
          text(
            input.reason ??
              input.reasonCode,
            this.config.maxDescriptionLength,
          ),
      },

      provider: {
        code:
          PROVIDER,
        correlationId:
          providerCorrelationId,
        compensationOperation:
          COMPENSATION_OPERATION,
      },

      executionContext: {
        requestId:
          context.requestId,
        correlationId:
          context.correlationId,
        traceId:
          context.traceId,
        actorId:
          context.actor?.actorId,
        source:
          context.source,
      },

      metadata:
        context.metadata,

      occurredAt:
        context.occurredAt,

      safety:
        this.#buildSafety({
          ...context,
          originalIdempotencyKey,
        }),

      transactionFingerprint,
    };

    const bytes =
      this.#assertPayloadSize(
        providerRequest,
      );

    return deepFreeze({
      outcome:
        BUILD_OUTCOMES.BUILT,
      commandType:
        COMMAND_TYPES.COMPENSATION,
      commandId,
      provider:
        PROVIDER,
      operation:
        COMPENSATION_OPERATION,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      reference:
        context.reference,
      originalIdempotencyKey,
      compensationIdempotencyKey,
      compensationIdentity,
      transactionFingerprint,
      providerCorrelationId,
      providerRequest,
      payloadBytes:
        bytes,
      financialSafety:
        this.#buildSafety({
          ...context,
          originalIdempotencyKey,
        }),
    });
  }

  buildCallbackEnvelope(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          commandType:
            COMMAND_TYPES.CALLBACK,
          operation:
            OPERATION,
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requireBeneficiary:
            false,
        },
      );

    const providerTransactionId =
      text(
        input.providerTransactionId ??
          input.providerPaymentId ??
          input.externalTransactionId,
        this.config
          .maxProviderReferenceLength,
      );

    const providerReference =
      text(
        input.providerReference ??
          input.externalReference,
        this.config
          .maxProviderReferenceLength,
      );

    const providerOutcome =
      upper(
        input.providerOutcome ??
          input.outcome ??
          input.status,
      );

    if (
      providerOutcome &&
      AMBIGUOUS_OUTCOMES.has(
        providerOutcome,
      )
    ) {
      this.#metric(
        'airtel.disbursement.transaction_builder.callback.ambiguous.total',
      );
    }

    const envelope = {
      header:
        this.#buildHeader(
          context,
          context.commandId,
        ),

      identity: {
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        disbursementId:
          context.disbursementId,
        reference:
          context.reference,
        originalIdempotencyKey:
          context.originalIdempotencyKey,
        transactionFingerprint:
          context.transactionFingerprint,
      },

      providerEvidence: {
        providerTransactionId,
        providerReference,
        status:
          text(
            input.status,
            128,
          ),
        outcome:
          providerOutcome,
        httpStatus:
          Number.isInteger(
            Number(
              input.httpStatus,
            ),
          )
            ? Number(
                input.httpStatus,
              )
            : undefined,
      },

      reconciliation: {
        statusEvidenceOnly:
          true,
        financialFinality:
          false,
      },

      metadata:
        normalizeMetadata(
          input.metadata,
          this.config,
        ),

      occurredAt:
        context.occurredAt,

      safety: {
        callbackVerificationAuthority:
          'AIRTEL_PROVIDER_ADAPTER',
        ledgerMutation:
          false,
        balanceMutation:
          false,
      },
    };

    const bytes =
      this.#assertPayloadSize(
        envelope,
      );

    return deepFreeze({
      outcome:
        BUILD_OUTCOMES.BUILT,
      commandType:
        COMMAND_TYPES.CALLBACK,
      commandId:
        context.commandId,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      disbursementId:
        context.disbursementId,
      reference:
        context.reference,
      transactionFingerprint:
        context.transactionFingerprint,
      providerTransactionId,
      providerReference,
      providerOutcome,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      correlationId:
        context.correlationId,
      envelope,
      payloadBytes:
        bytes,
    });
  }

  normalizeProviderRequest(
    input = {},
  ) {
    if (!isPlainObject(input)) {
      this.#throw(
        'TRANSACTION_BUILDER_INVALID_PROVIDER_REQUEST',
        'Provider request must be a plain object.',
        {},
        { httpStatus: 422 },
      );
    }

    const normalized =
      sanitize(
        clone(input),
        0,
        this.config,
      );

    const provider =
      normalizeProvider(
        normalized.provider ??
          normalized.header?.provider ??
          PROVIDER,
      );

    if (
      this.config
        .requireAirtelProvider &&
      provider !== PROVIDER
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_PROVIDER_SCOPE_VIOLATION',
        'Provider request is outside the Airtel builder scope.',
        {
          provider,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return deepFreeze({
      ...normalized,
      provider:
        PROVIDER,
      component:
        COMPONENT,
      engineVersion:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
    });
  }

  fingerprint(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          commandType:
            input.commandType ??
            COMMAND_TYPES.DISBURSEMENT,
          operation:
            input.operation ??
            OPERATION,
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requireBeneficiary:
            false,
        },
      );

    return buildTransactionFingerprint(
      context,
    );
  }

  validate(
    input = {},
  ) {
    try {
      const context =
        this.normalizeContext(
          input,
          {
            commandType:
              input.commandType ??
              COMMAND_TYPES.DISBURSEMENT,
            operation:
              input.operation ??
              OPERATION,
            requireTransactionId:
              input.commandType ===
                COMMAND_TYPES.STATUS
                ? false
                : this.config
                    .requireTransactionId,
            requireReference:
              input.commandType ===
                COMMAND_TYPES.STATUS
                ? false
                : this.config
                    .requireReference,
            requireOriginalIdempotencyKey:
              input.commandType ===
                COMMAND_TYPES.STATUS
                ? false
                : this.config
                    .requireOriginalIdempotencyKey,
            requireAmountMinor:
              input.commandType ===
                COMMAND_TYPES.STATUS
                ? false
                : this.config
                    .requireAmountMinor,
            requireBeneficiary:
              input.commandType ===
                COMMAND_TYPES.STATUS
                ? false
                : this.config
                    .requireBeneficiary,
          },
        );

      return deepFreeze({
        valid:
          true,
        outcome:
          BUILD_OUTCOMES.BUILT,
        provider:
          PROVIDER,
        operation:
          context.operation,
        commandType:
          context.commandType,
        tenantId:
          context.tenantId,
        transactionId:
          context.transactionId,
        reference:
          context.reference,
        amountMinor:
          context.amountMinor,
        currency:
          context.currency,
        beneficiaryFingerprint:
          context.beneficiary
            ?.beneficiaryFingerprint,
        transactionFingerprint:
          context.transactionFingerprint,
      });
    } catch (error) {
      if (
        error instanceof
        AirtelTransactionBuilderError
      ) {
        return {
          valid:
            false,
          outcome:
            error.code ===
            'TRANSACTION_BUILDER_BENEFICIARY_REVIEW_REQUIRED'
              ? BUILD_OUTCOMES.REQUIRES_REVIEW
              : BUILD_OUTCOMES.INVALID,
          provider:
            PROVIDER,
          code:
            error.code,
          message:
            error.message,
          details:
            error.details,
        };
      }

      return {
        valid:
          false,
        outcome:
          BUILD_OUTCOMES.INVALID,
        provider:
          PROVIDER,
        code:
          'TRANSACTION_BUILDER_VALIDATION_FAILED',
        message:
          'Transaction command validation failed.',
      };
    }
  }

  health() {
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
        'UP',
      healthy:
        true,
      dependencies: {
        providerAdapter:
          false,
        financialCore:
          false,
        repository:
          false,
        database:
          false,
      },
      controls: {
        tenantIsolation:
          this.config
            .requireTenantId,
        originalIdempotencyRequired:
          this.config
            .requireOriginalIdempotencyKey,
        unsafeOfflineRejected:
          this.config
            .rejectUnsafeOfflineStates,
        exactMinorUnits:
          true,
        directProviderCall:
          false,
        directLedgerMutation:
          false,
        directBalanceMutation:
          false,
      },
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
      deterministicFingerprint:
        true,
      deterministicCommandId:
        true,
      deterministicProviderCorrelation:
        true,
      originalIdempotencyPreserved:
        true,
      distinctCompensationIdentity:
        true,
      exactMinorUnits:
        true,
      providerTranslationBoundary:
        true,
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
      settlementFinalityAuthority:
        false,
      kycAmlAuthority:
        false,
      fraudAuthority:
        false,
      authorizationAuthority:
        false,
    });
  }

  diagnostics() {
    return deepFreeze({
      component:
        COMPONENT,
      version:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      health:
        this.health(),
      capabilities:
        this.capabilities(),
      contracts: {
        buildDisbursement:
          true,
        buildStatusRequest:
          true,
        buildCallbackEnvelope:
          true,
        buildReversalRequest:
          true,
        buildCompensationRequest:
          true,
        normalizeProviderRequest:
          true,
      },
      safety: {
        writeLedgerHere:
          false,
        mutateBalanceHere:
          false,
        mutateWalletHere:
          false,
        callProviderHere:
          false,
        preserveOriginalIdempotency:
          true,
        generateNewFinancialIdentity:
          false,
        authoritativeBoundary:
          'AIRTEL_PROVIDER_ADAPTER / TITECH_FINANCIAL_CORE',
      },
    });
  }
}

export const createTransactionBuilder = (
  options = {},
) =>
  new AirtelDisbursementTransactionBuilder(
    options,
  );

export const createAirtelTransactionBuilder =
  createTransactionBuilder;

export const createAirtelDisbursementTransactionBuilder =
  createTransactionBuilder;

export const TransactionBuilder =
  AirtelDisbursementTransactionBuilder;

export const AirtelDisbursementBuilder =
  AirtelDisbursementTransactionBuilder;

export const defaultTransactionBuilder =
  createTransactionBuilder();

export const transactionBuilder =
  defaultTransactionBuilder;

export const buildDisbursement = (
  input = {},
) =>
  defaultTransactionBuilder
    .buildDisbursement(input);

export const buildStatusRequest = (
  input = {},
) =>
  defaultTransactionBuilder
    .buildStatusRequest(input);

export const buildReversalRequest = (
  input = {},
) =>
  defaultTransactionBuilder
    .buildReversalRequest(input);

export const buildCallbackEnvelope = (
  input = {},
) =>
  defaultTransactionBuilder
    .buildCallbackEnvelope(input);

export default AirtelDisbursementTransactionBuilder;