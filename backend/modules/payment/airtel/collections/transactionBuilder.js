'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collection Transaction Builder
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/collections/transactionBuilder.js
 *
 * Architectural role
 * ------------------
 * Canonical deterministic command-construction boundary for Airtel inbound
 * COLLECTION operations. The builder converts an already validated collection
 * intent into a provider-neutral request envelope that the Airtel provider
 * adapter may translate into its wire contract.
 *
 * Canonical path
 * --------------
 *
 *   Collection Service
 *          |
 *          v
 *   Transaction Builder
 *          |
 *          v
 *   Airtel Provider Adapter
 *          |
 *          v
 *   Provider Network
 *
 *   Provider-confirmed outcome
 *          |
 *          v
 *   Financial Core / Ledger
 *
 * Responsibilities
 * ----------------
 * - Normalize tenant/provider/operation/transaction identity.
 * - Preserve the original collection idempotency key.
 * - Normalize exact minor-unit amount and currency representations.
 * - Normalize payer/source identity and Uganda MSISDN conventions.
 * - Reject unsafe offline states before an executable command is produced.
 * - Build deterministic provider-request, status, callback, reconciliation,
 *   reversal and compensation command envelopes.
 * - Produce stable semantic fingerprints and correlation identifiers.
 * - Separate provider-facing fields from internal metadata and secret material.
 * - Validate callback URL and provider-facing references without performing I/O.
 * - Expose health/capability/diagnostic information without side effects.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel HTTP/API calls.
 * - No OAuth/token acquisition or credential handling.
 * - No direct database/Redis/repository access.
 * - No ledger/journal posting.
 * - No balance/wallet mutation.
 * - No authorization/maker-checker decisions.
 * - No KYC/AML/sanctions/fraud source-of-truth adjudication.
 * - No provider outcome adjudication.
 * - No settlement/finality decision.
 * - No automatic retries.
 * - No creation of replacement transaction or idempotency identities.
 *
 * Financial safety principles
 * ---------------------------
 * 1. The original transaction identity remains immutable.
 * 2. The original idempotency identity remains immutable across retries/status
 *    checks/callback correlation/reconciliation.
 * 3. Corrective operations require distinct compensation/reversal identities.
 * 4. Exact integer minor units are the authoritative amount representation.
 * 5. Ambiguous/pending provider outcomes are never converted into settlement.
 * 6. LOCAL_ONLY/PENDING_SYNC/SYNCING states are operational states, not proof
 *    of financial settlement.
 * 7. The generated envelope is deterministic for the same semantic intent.
 * 8. Access tokens and other secrets are accepted only as non-persisted input
 *    context and are never embedded in the built request envelope.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.collections.transaction-builder';
export const ENGINE_NAME = 'airtel-collection-transaction-builder';
export const ENGINE_VERSION = '4.0.0';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 4;
export const HASH_ALGORITHM = 'sha256';

export const COMMAND_TYPES = Object.freeze({
  COLLECTION: 'COLLECTION',
  STATUS: 'STATUS',
  CALLBACK: 'CALLBACK',
  RECONCILIATION: 'RECONCILIATION',
  REVERSAL: 'REVERSAL',
  COMPENSATION: 'COMPENSATION',
});

export const BUILD_OUTCOMES = Object.freeze({
  BUILT: 'BUILT',
  INVALID: 'INVALID',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  REPLAY: 'REPLAY',
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

export const UNSAFE_OFFLINE_STATES = Object.freeze([
  OFFLINE_STATES.LOCAL_ONLY,
  OFFLINE_STATES.PENDING_SYNC,
  OFFLINE_STATES.SYNCING,
  OFFLINE_STATES.SERVER_REJECTED,
  OFFLINE_STATES.CONFLICT,
  OFFLINE_STATES.REQUIRES_REVIEW,
]);

export const PROVIDER_REQUEST_KINDS = Object.freeze({
  COLLECTION: 'COLLECTION',
  STATUS: 'STATUS',
});

export const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  requireAirtelProvider: true,
  requireCollectionOperation: true,
  requireTransactionId: true,
  requireReference: true,
  requireOriginalIdempotencyKey: true,
  requireAmountMinor: true,
  requirePositiveAmount: true,
  requireCurrency: true,
  requirePayer: true,
  requirePhoneNumber: true,
  requireCountry: true,
  requireCallbackUrl: false,
  requireOfflineServerAcceptance: true,
  rejectUnsafeOfflineState: true,
  allowLegacyAmountAlias: true,
  allowUnvalidatedPayer: false,
  allowCrossCurrency: false,
  enforceSupportedCountry: true,
  enforceSupportedCurrency: true,
  enforceUgandaPhoneNumber: true,
  requireFinancialIdentity: true,
  requireSemanticFingerprint: true,
  generateCommandId: true,
  generateCorrelationId: true,
  maxTenantIdLength: 160,
  maxTransactionIdLength: 240,
  maxCollectionIdLength: 240,
  maxReferenceLength: 240,
  maxIdempotencyKeyLength: 240,
  maxPayerIdLength: 240,
  maxPhoneNumberLength: 32,
  maxCallbackUrlLength: 2000,
  maxPurposeCodeLength: 120,
  maxProviderReferenceLength: 240,
  maxCorrelationIdLength: 240,
  maxOperationIdLength: 200,
  maxRequestIdLength: 200,
  maxTraceIdLength: 200,
  maxActorIdLength: 200,
  maxDescriptionLength: 500,
  maxMetadataDepth: 5,
  maxMetadataKeys: 64,
  maxMetadataArrayLength: 50,
  maxMetadataStringLength: 1000,
  maxPayloadBytes: 256 * 1024,
  defaultCountry: 'UG',
  defaultCurrency: 'UGX',
  countryDialCode: '256',
  countryNationalDigits: 9,
  supportedCountries: Object.freeze(['UG']),
  supportedCurrencies: Object.freeze(['UGX']),
  commandVersion: '1.0',
});

export const FINANCIAL_BOUNDARY = Object.freeze({
  providerCalls: false,
  persistence: false,
  ledgerWrites: false,
  balanceMutation: false,
  walletMutation: false,
  settlementFinality: false,
  authorization: false,
  kycAmlAdjudication: false,
  originalIdentityReplacement: false,
  authoritativeFinancialBoundary: 'TITECH_FINANCIAL_CORE',
});

const PRIVATE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const SECRET_KEY_PATTERN = /(password|secret|token|authorization|cookie|set-cookie|otp|pin|cvv|cvc|pan|private.?key|api.?key|client.?secret|credential|signature|raw(request|response)|provider.?payload|access.?token|refresh.?token)/i;
const UNSAFE_KEY_PATTERN = /(^\$)|\./;
const MSISDN_PATTERN = /^2567\d{8}$/;

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date),
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function upper(value) {
  if (value === undefined || value === null) return undefined;
  const result = String(value).trim().toUpperCase();
  return result || undefined;
}

function text(value, maxLength = 240) {
  if (value === undefined || value === null) return undefined;
  const result = String(value).trim();
  return result ? result.slice(0, maxLength) : undefined;
}

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function stable(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && Object.is(value, -0)) return '0';
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash(HASH_ALGORITHM)
    .update(
      typeof value === 'string' ? value : stable(value),
      'utf8',
    )
    .digest('hex');
}

function nowMs(clock) {
  try {
    const value =
      typeof clock === 'function'
        ? clock()
        : clock?.now?.();
    if (value instanceof Date) return value.getTime();
    if (Number.isFinite(Number(value))) return Number(value);
  } catch {
    // Fallback to system clock.
  }
  return Date.now();
}

function nowIso(clock) {
  return new Date(nowMs(clock)).toISOString();
}

function sanitize(value, depth = 0, config = DEFAULT_CONFIG) {
  if (depth > config.maxMetadataDepth) return '[TRUNCATED]';
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    return value.slice(0, config.maxMetadataStringLength);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, config.maxMetadataArrayLength)
      .map((item) => sanitize(item, depth + 1, config));
  }
  if (!isPlainObject(value)) return String(value);

  const result = {};
  for (const key of Object.keys(value).slice(0, config.maxMetadataKeys)) {
    if (
      PRIVATE_KEYS.has(key) ||
      UNSAFE_KEY_PATTERN.test(key)
    ) {
      continue;
    }
    result[key] = SECRET_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitize(value[key], depth + 1, config);
  }
  return result;
}

function payloadBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function normalizeAmountMinor(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new AirtelTransactionBuilderError(
        'amountMinor must be a positive safe integer when provided as a number.',
        {
          code: 'TRANSACTION_BUILDER_INVALID_AMOUNT',
          httpStatus: 422,
        },
      );
    }
    return String(value);
  }

  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new AirtelTransactionBuilderError(
        'amountMinor must be greater than zero.',
        {
          code: 'TRANSACTION_BUILDER_INVALID_AMOUNT',
          httpStatus: 422,
        },
      );
    }
    return value.toString();
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized) || /^0+$/.test(normalized)) {
    throw new AirtelTransactionBuilderError(
      'amountMinor must be a positive integer minor-unit representation.',
      {
        code: 'TRANSACTION_BUILDER_INVALID_AMOUNT',
        httpStatus: 422,
      },
    );
  }

  return normalized.replace(/^0+(?=\d)/, '');
}

function normalizeCurrency(value, config) {
  const currency = upper(value ?? config.defaultCurrency);
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new AirtelTransactionBuilderError(
      'currency must be a valid three-letter currency code.',
      {
        code: 'TRANSACTION_BUILDER_INVALID_CURRENCY',
        httpStatus: 422,
      },
    );
  }

  if (
    config.enforceSupportedCurrency &&
    !config.supportedCurrencies.includes(currency)
  ) {
    throw new AirtelTransactionBuilderError(
      `Currency ${currency} is not supported by the Airtel collection contract.`,
      {
        code: 'TRANSACTION_BUILDER_UNSUPPORTED_CURRENCY',
        httpStatus: 422,
        details: { currency },
      },
    );
  }

  return currency;
}

function normalizeCountry(value, config) {
  const country = upper(value ?? config.defaultCountry);

  if (!country || country.length !== 2) {
    throw new AirtelTransactionBuilderError(
      'country must be a two-letter country code.',
      {
        code: 'TRANSACTION_BUILDER_INVALID_COUNTRY',
        httpStatus: 422,
      },
    );
  }

  if (
    config.enforceSupportedCountry &&
    !config.supportedCountries.includes(country)
  ) {
    throw new AirtelTransactionBuilderError(
      `Country ${country} is not supported by the Airtel collection contract.`,
      {
        code: 'TRANSACTION_BUILDER_UNSUPPORTED_COUNTRY',
        httpStatus: 422,
        details: { country },
      },
    );
  }

  return country;
}

function normalizeUgandaMsisdn(value, config) {
  if (value === undefined || value === null) {
    if (config.requirePhoneNumber) {
      throw new AirtelTransactionBuilderError(
        'payer phone number is required.',
        {
          code: 'TRANSACTION_BUILDER_PHONE_REQUIRED',
          httpStatus: 422,
        },
      );
    }
    return undefined;
  }

  let raw = String(value).trim().replace(/[\s-]/g, '');

  if (raw.startsWith('+')) raw = raw.slice(1);
  if (raw.startsWith('00')) raw = raw.slice(2);

  if (raw.startsWith('0')) {
    raw = `${config.countryDialCode}${raw.slice(1)}`;
  }

  if (
    config.enforceUgandaPhoneNumber &&
    !MSISDN_PATTERN.test(raw)
  ) {
    throw new AirtelTransactionBuilderError(
      'payer phone number must be a valid Uganda MSISDN.',
      {
        code: 'TRANSACTION_BUILDER_INVALID_MSISDN',
        httpStatus: 422,
        details: {
          country: config.defaultCountry,
        },
      },
    );
  }

  return raw.slice(0, config.maxPhoneNumberLength);
}

function normalizeCallbackUrl(value, config) {
  const callbackUrl = text(
    value,
    config.maxCallbackUrlLength,
  );

  if (!callbackUrl) {
    if (config.requireCallbackUrl) {
      throw new AirtelTransactionBuilderError(
        'callbackUrl is required.',
        {
          code: 'TRANSACTION_BUILDER_CALLBACK_URL_REQUIRED',
          httpStatus: 422,
        },
      );
    }
    return undefined;
  }

  let parsed;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new AirtelTransactionBuilderError(
      'callbackUrl must be an absolute URL.',
      {
        code: 'TRANSACTION_BUILDER_INVALID_CALLBACK_URL',
        httpStatus: 422,
      },
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AirtelTransactionBuilderError(
      'callbackUrl must use HTTP or HTTPS.',
      {
        code: 'TRANSACTION_BUILDER_INVALID_CALLBACK_URL',
        httpStatus: 422,
      },
    );
  }

  return parsed.toString();
}

function normalizeOfflineState(input) {
  return upper(
    input.offlineState ??
      input.syncState ??
      input.offline?.state ??
      input.sync?.state,
  );
}

function normalizedActor(input, config) {
  const actor = isPlainObject(input.actor) ? input.actor : undefined;
  if (!actor) return undefined;

  const tenantId = text(
    actor.tenantId,
    config.maxTenantIdLength,
  );

  if (
    tenantId &&
    input.tenantId &&
    tenantId !== input.tenantId
  ) {
    throw new AirtelTransactionBuilderError(
      'Actor tenant does not match transaction tenant.',
      {
        code: 'TRANSACTION_BUILDER_TENANT_SCOPE_MISMATCH',
        httpStatus: 403,
      },
    );
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
    tenantId,
  };
}

function normalizedValidation(input) {
  const validation =
    isPlainObject(input.validation)
      ? input.validation
      : isPlainObject(input.collectionValidation)
        ? input.collectionValidation
        : null;

  if (!validation) return null;

  return {
    valid:
      validation.valid === true ||
      ['PASS', 'VALID', 'ALLOWED', 'ALLOW'].includes(
        upper(
          validation.outcome ??
            validation.decision ??
            validation.status,
        ),
      ),
    blocked:
      validation.blocked === true ||
      ['BLOCK', 'BLOCKED', 'DENY', 'REJECTED', 'REJECT'].includes(
        upper(
          validation.outcome ??
            validation.decision ??
            validation.status,
        ),
      ),
    review:
      validation.review === true ||
      ['REVIEW', 'PENDING', 'REQUIRES_REVIEW'].includes(
        upper(
          validation.outcome ??
            validation.decision ??
            validation.status,
        ),
      ),
    fingerprint: text(
      validation.fingerprint ??
        validation.semanticFingerprint,
      128,
    ),
  };
}

function normalizePayer(input, context, config) {
  const source =
    input.payer ??
    input.customer ??
    input.source ??
    {};

  const payer =
    isPlainObject(source)
      ? source
      : {
          partyId: source,
        };

  const payerId = text(
    payer.partyId ??
      payer.payerId ??
      payer.customerId ??
      payer.accountId ??
      payer.msisdn ??
      payer.phoneNumber ??
      payer.phone ??
      context.phoneNumber,
    config.maxPayerIdLength,
  );

  if (config.requirePayer && !payerId) {
    throw new AirtelTransactionBuilderError(
      'payer identity is required.',
      {
        code: 'TRANSACTION_BUILDER_PAYER_REQUIRED',
        httpStatus: 422,
      },
    );
  }

  return {
    partyId: payerId,
    partyType: upper(
      payer.partyType ??
        payer.type ??
        'MSISDN',
    ),
    displayName: text(
      payer.displayName ??
        payer.name ??
        payer.fullName,
      240,
    ),
    accountReference: text(
      payer.accountReference ??
        payer.externalReference,
      config.maxReferenceLength,
    ),
    fingerprint:
      text(
        payer.fingerprint ??
          payer.payerFingerprint ??
          payer.identityFingerprint,
        128,
      ) ??
      sha256({
        provider: PROVIDER,
        partyId: payerId,
        partyType: upper(
          payer.partyType ??
            payer.type ??
            'MSISDN',
        ),
      }),
  };
}

function normalizeIdentity(input, config, commandType, {
  requireTransactionId = config.requireTransactionId,
  requireReference = config.requireReference,
  requireOriginalIdempotencyKey = config.requireOriginalIdempotencyKey,
} = {}) {
  const transactionId = text(
    input.transactionId ??
      input.financialTransactionId ??
      input.collectionId ??
      input.paymentId ??
      input.id,
    config.maxTransactionIdLength,
  );

  if (requireTransactionId && !transactionId) {
    throw new AirtelTransactionBuilderError(
      'transactionId is required.',
      {
        code: 'TRANSACTION_BUILDER_TRANSACTION_ID_REQUIRED',
        httpStatus: 422,
      },
    );
  }

  const reference = text(
    input.externalReference ??
      input.collectionReference ??
      input.reference ??
      input.paymentReference ??
      transactionId,
    config.maxReferenceLength,
  );

  if (requireReference && !reference) {
    throw new AirtelTransactionBuilderError(
      'externalReference/reference is required.',
      {
        code: 'TRANSACTION_BUILDER_REFERENCE_REQUIRED',
        httpStatus: 422,
      },
    );
  }

  const originalIdempotencyKey = text(
    input.originalIdempotencyKey ??
      input.idempotencyKey ??
      input.headers?.['idempotency-key'],
    config.maxIdempotencyKeyLength,
  );

  if (
    requireOriginalIdempotencyKey &&
    !originalIdempotencyKey
  ) {
    throw new AirtelTransactionBuilderError(
      'original idempotency key is required.',
      {
        code: 'TRANSACTION_BUILDER_IDEMPOTENCY_KEY_REQUIRED',
        httpStatus: 422,
      },
    );
  }

  const providerReference = text(
    input.providerReference ??
      input.providerTransactionId ??
      input.airtelTransactionId,
    config.maxProviderReferenceLength,
  );

  const purposeCode = text(
    input.purposeCode ??
      input.collectionPurposeCode,
    config.maxPurposeCodeLength,
  );

  const commandVersion = text(
    input.commandVersion ??
      config.commandVersion,
    32,
  );

  const correlationId = text(
    input.correlationId,
    config.maxCorrelationIdLength,
  );

  const operationId = text(
    input.operationId,
    config.maxOperationIdLength,
  );

  const requestId = text(
    input.requestId,
    config.maxRequestIdLength,
  );

  const traceId = text(
    input.traceId,
    config.maxTraceIdLength,
  );

  return {
    tenantId: text(
      input.tenantId,
      config.maxTenantIdLength,
    ),
    provider: upper(input.provider ?? PROVIDER),
    operation: upper(input.operation ?? OPERATION),
    commandType,
    transactionId,
    collectionId: text(
      input.collectionId,
      config.maxCollectionIdLength,
    ),
    reference,
    originalIdempotencyKey,
    providerReference,
    purposeCode,
    commandVersion,
    correlationId,
    operationId,
    requestId,
    traceId,
  };
}

function semanticIdentity(context) {
  return {
    schemaVersion: SCHEMA_VERSION,
    commandVersion: context.commandVersion,
    tenantId: context.tenantId,
    provider: PROVIDER,
    operation: context.operation,
    commandType: context.commandType,
    transactionId: context.transactionId,
    collectionId: context.collectionId,
    reference: context.reference,
    originalIdempotencyKeyHash:
      context.originalIdempotencyKey
        ? sha256(context.originalIdempotencyKey)
        : null,
    amountMinor: context.amountMinor,
    currency: context.currency,
    country: context.country,
    phoneNumber: context.phoneNumber,
    payerFingerprint: context.payer?.fingerprint ?? null,
    purposeCode: context.purposeCode ?? null,
    callbackUrl: context.callbackUrl ?? null,
  };
}

export function buildTransactionFingerprint(input = {}) {
  return sha256(
    semanticIdentity(
      normalizeForFingerprint(input),
    ),
  );
}

function normalizeForFingerprint(input) {
  const config = {
    ...DEFAULT_CONFIG,
    ...(input.configuration ?? input.config ?? {}),
    supportedCountries: DEFAULT_CONFIG.supportedCountries,
    supportedCurrencies: DEFAULT_CONFIG.supportedCurrencies,
  };

  const country = normalizeCountry(
    input.country ??
      input.countryCode,
    config,
  );

  const amountMinor = normalizeAmountMinor(
    input.amountMinor ??
      input.amount,
  );

  const currency = normalizeCurrency(
    input.currency,
    config,
  );

  const phoneNumber = normalizeUgandaMsisdn(
    input.phoneNumber ??
      input.phone ??
      input.msisdn,
    config,
  );

  return {
    commandVersion: text(
      input.commandVersion ??
        config.commandVersion,
      32,
    ),
    tenantId: text(
      input.tenantId,
      config.maxTenantIdLength,
    ),
    provider: PROVIDER,
    operation: OPERATION,
    commandType:
      upper(
        input.commandType ??
          COMMAND_TYPES.COLLECTION,
      ) ?? COMMAND_TYPES.COLLECTION,
    transactionId: text(
      input.transactionId ??
        input.financialTransactionId ??
        input.collectionId ??
        input.paymentId,
      config.maxTransactionIdLength,
    ),
    collectionId: text(
      input.collectionId,
      config.maxCollectionIdLength,
    ),
    reference: text(
      input.externalReference ??
        input.reference ??
        input.collectionReference,
      config.maxReferenceLength,
    ),
    originalIdempotencyKeyHash:
      input.originalIdempotencyKey ??
      input.idempotencyKey
        ? sha256(
            String(
              input.originalIdempotencyKey ??
                input.idempotencyKey,
            ),
          )
        : null,
    amountMinor,
    currency,
    country,
    phoneNumber,
    payerFingerprint:
      isPlainObject(input.payer)
        ? text(
            input.payer.fingerprint ??
              input.payer.payerFingerprint,
            128,
          ) ??
          sha256({
            partyId:
              input.payer.partyId ??
              input.payer.payerId ??
              phoneNumber,
            partyType:
              upper(
                input.payer.partyType ??
                  input.payer.type ??
                  'MSISDN',
              ),
          })
        : sha256({
            partyId: phoneNumber,
            partyType: 'MSISDN',
          }),
    purposeCode: text(
      input.purposeCode ??
        input.collectionPurposeCode,
      config.maxPurposeCodeLength,
    ),
    callbackUrl:
      normalizeCallbackUrl(
        input.callbackUrl,
        config,
      ) ?? null,
  };
}

function assertPayloadSize(payload, config) {
  const size = payloadBytes(payload);
  if (size > config.maxPayloadBytes) {
    throw new AirtelTransactionBuilderError(
      'Built provider command exceeds the configured payload size.',
      {
        code: 'TRANSACTION_BUILDER_PAYLOAD_TOO_LARGE',
        httpStatus: 422,
        details: {
          payloadBytes: size,
          maxPayloadBytes: config.maxPayloadBytes,
        },
      },
    );
  }
}

function validateProviderScope(context, config) {
  if (!context.tenantId && config.requireTenantId) {
    throw new AirtelTransactionBuilderError(
      'tenantId is required.',
      {
        code: 'TRANSACTION_BUILDER_TENANT_REQUIRED',
        httpStatus: 422,
      },
    );
  }

  if (
    config.requireAirtelProvider &&
    context.provider !== PROVIDER
  ) {
    throw new AirtelTransactionBuilderError(
      'Transaction builder is scoped to Airtel.',
      {
        code: 'TRANSACTION_BUILDER_PROVIDER_SCOPE_VIOLATION',
        httpStatus: 409,
        details: {
          provider: context.provider,
        },
      },
    );
  }

  if (
    config.requireCollectionOperation &&
    ![
      OPERATION,
      'STATUS',
      'CALLBACK',
      'RECONCILIATION',
      'REVERSAL',
      'COMPENSATION',
    ].includes(context.operation)
  ) {
    throw new AirtelTransactionBuilderError(
      'Unsupported Airtel collection operation.',
      {
        code: 'TRANSACTION_BUILDER_OPERATION_SCOPE_VIOLATION',
        httpStatus: 409,
        details: {
          operation: context.operation,
        },
      },
    );
  }
}

function validateOfflineSafety(
  input,
  config,
) {
  const offlineState = normalizeOfflineState(input);

  if (
    !offlineState ||
    !config.rejectUnsafeOfflineState
  ) {
    return {
      offlineState,
      offlineSafe: true,
    };
  }

  if (!UNSAFE_OFFLINE_STATES.includes(offlineState)) {
    return {
      offlineState,
      offlineSafe: true,
    };
  }

  if (
    offlineState === OFFLINE_STATES.SERVER_REJECTED ||
    offlineState === OFFLINE_STATES.CONFLICT
  ) {
    throw new AirtelTransactionBuilderError(
      'Collection command cannot be constructed from a rejected or conflicted offline state.',
      {
        code: 'TRANSACTION_BUILDER_OFFLINE_CONFLICT',
        httpStatus: 409,
        details: { offlineState },
      },
    );
  }

  if (
    config.requireOfflineServerAcceptance
  ) {
    throw new AirtelTransactionBuilderError(
      'Collection command requires server-accepted/synchronized state before provider execution.',
      {
        code: 'TRANSACTION_BUILDER_OFFLINE_UNSAFE',
        httpStatus: 409,
        details: {
          offlineState,
        },
      },
    );
  }

  return {
    offlineState,
    offlineSafe: false,
  };
}

export class AirtelTransactionBuilderError extends Error {
  constructor(
    message,
    {
      code = 'TRANSACTION_BUILDER_ERROR',
      httpStatus = 400,
      retryable = false,
      operation = OPERATION,
      details = {},
      cause = undefined,
    } = {},
  ) {
    super(
      String(message || 'Airtel transaction builder error.'),
      cause ? { cause } : undefined,
    );
    this.name = 'AirtelTransactionBuilderError';
    this.code = code;
    this.httpStatus = Number.isInteger(httpStatus)
      ? httpStatus
      : 400;
    this.retryable = Boolean(retryable);
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
      operation: this.operation,
      provider: this.provider,
      component: this.component,
      details: this.details,
    };
  }
}

export class AirtelCollectionTransactionBuilder {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new AirtelTransactionBuilderError(
        'Transaction builder options must be a plain object.',
        {
          code: 'TRANSACTION_BUILDER_INVALID_OPTIONS',
          httpStatus: 500,
        },
      );
    }

    const supplied =
      options.configuration ??
      options.config ??
      {};

    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...supplied,
      supportedCountries: Array.isArray(
        supplied.supportedCountries,
      )
        ? [...supplied.supportedCountries].map(upper)
        : DEFAULT_CONFIG.supportedCountries,
      supportedCurrencies: Array.isArray(
        supplied.supportedCurrencies,
      )
        ? [...supplied.supportedCurrencies].map(upper)
        : DEFAULT_CONFIG.supportedCurrencies,
    });

    this.clock =
      options.clock ??
      { now: () => Date.now() };

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

  #throw(code, message, details = {}, options = {}) {
    throw new AirtelTransactionBuilderError(
      message,
      {
        code,
        details,
        ...options,
        operation:
          options.operation ??
          OPERATION,
        config:
          this.config,
      },
    );
  }

  #log(level, message, context = {}) {
    try {
      const method =
        this.logger?.[level] ??
        this.logger?.log ??
        this.logger?.info;
      if (!isFunction(method)) return;

      method.call(
        this.logger,
        {
          component: COMPONENT,
          provider: PROVIDER,
          operation: OPERATION,
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

  #metric(name, labels = {}) {
    try {
      const method =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;
      if (!isFunction(method)) return;
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
        COMMAND_TYPES.COLLECTION,
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
      requirePayer =
        commandType === COMMAND_TYPES.COLLECTION
          ? this.config.requirePayer
          : false,
      requirePhoneNumber =
        commandType === COMMAND_TYPES.COLLECTION
          ? this.config.requirePhoneNumber
          : false,
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

    const base =
      normalizeIdentity(
        {
          ...input,
          operation,
        },
        this.config,
        commandType,
        {
          requireTransactionId,
          requireReference,
          requireOriginalIdempotencyKey,
        },
      );

    const tenantId = base.tenantId;
    if (
      this.config.requireTenantId &&
      !tenantId
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_TENANT_REQUIRED',
        'tenantId is required.',
        {},
        { httpStatus: 422 },
      );
    }

    if (
      requireTransactionId &&
      !base.transactionId
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_TRANSACTION_ID_REQUIRED',
        'transactionId is required.',
        {},
        { httpStatus: 422 },
      );
    }

    if (
      requireReference &&
      !base.reference
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_REFERENCE_REQUIRED',
        'reference is required.',
        {},
        { httpStatus: 422 },
      );
    }

    if (
      requireOriginalIdempotencyKey &&
      !base.originalIdempotencyKey
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_IDEMPOTENCY_KEY_REQUIRED',
        'original idempotency key is required.',
        {},
        { httpStatus: 422 },
      );
    }

    validateProviderScope(
      {
        ...base,
        tenantId,
        operation:
          upper(operation) ??
          OPERATION,
      },
      this.config,
    );

    const country = normalizeCountry(
      input.country ??
        input.countryCode,
      this.config,
    );

    const amountMinor = normalizeAmountMinor(
      input.amountMinor ??
        input.amountInMinorUnits ??
        (this.config.allowLegacyAmountAlias
          ? input.amount
          : undefined),
    );

    if (
      requireAmountMinor &&
      !amountMinor
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_AMOUNT_REQUIRED',
        'amountMinor is required.',
        {},
        {
          httpStatus: 422,
          operation:
            OPERATION,
        },
      );
    }

    if (
      amountMinor &&
      this.config.requirePositiveAmount &&
      /^0+$/.test(amountMinor)
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_INVALID_AMOUNT',
        'amountMinor must be greater than zero.',
        {},
        { httpStatus: 422 },
      );
    }

    const currency = normalizeCurrency(
      input.currency,
      this.config,
    );

    if (
      country === 'UG' &&
      currency !== 'UGX' &&
      !this.config.allowCrossCurrency
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_COUNTRY_CURRENCY_MISMATCH',
        'Uganda collection commands must use UGX unless cross-currency mode is explicitly enabled.',
        {
          country,
          currency,
        },
        { httpStatus: 422 },
      );
    }

    const phoneNumber = normalizeUgandaMsisdn(
      input.phoneNumber ??
        input.phone ??
        input.msisdn ??
        input.payer?.phoneNumber ??
        input.payer?.msisdn,
      {
        ...this.config,
        requirePhoneNumber,
      },
    );

    const payer = requirePayer || input.payer || input.customer || input.source
      ? normalizePayer(
          {
            ...input,
            phoneNumber,
          },
          {
            phoneNumber,
          },
          {
            ...this.config,
            requirePayer,
          },
        )
      : null;

    const callbackUrl =
      normalizeCallbackUrl(
        input.callbackUrl,
        this.config,
      );

    const offline =
      validateOfflineSafety(
        input,
        this.config,
      );

    const validation =
      normalizedValidation(input);

    if (
      validation?.blocked
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_VALIDATION_BLOCKED',
        'Collection validation has blocked command construction.',
        {
          validationFingerprint:
            validation.fingerprint,
        },
        { httpStatus: 409 },
      );
    }

    if (
      validation?.review &&
      !this.config.allowUnvalidatedPayer
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_REVIEW_REQUIRED',
        'Collection validation requires human/system review before command construction.',
        {
          validationFingerprint:
            validation.fingerprint,
        },
        { httpStatus: 409 },
      );
    }

    if (
      validation &&
      !validation.valid &&
      !this.config.allowUnvalidatedPayer
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_VALIDATION_REQUIRED',
        'Authoritative collection validation was not passed.',
        {
          validationFingerprint:
            validation.fingerprint,
        },
        { httpStatus: 409 },
      );
    }

    const actor =
      normalizedActor(
        {
          ...input,
          tenantId,
        },
        this.config,
      );

    const metadata =
      sanitize(
        input.metadata ?? {},
        0,
        this.config,
      );

    const description =
      text(
        input.description ??
          input.purpose ??
          'Airtel Money collection',
        this.config
          .maxDescriptionLength,
      );

    const occurredAt =
      input.occurredAt === undefined
        ? new Date(
            nowMs(
              this.clock,
            ),
          )
        : new Date(
            input.occurredAt,
          );

    if (
      Number.isNaN(
        occurredAt.getTime(),
      )
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_INVALID_TIMESTAMP',
        'occurredAt must be a valid timestamp.',
        {},
        { httpStatus: 422 },
      );
    }

    const context = {
      ...base,
      provider: PROVIDER,
      operation:
        upper(operation) ??
        OPERATION,
      commandType,
      country,
      currency,
      amountMinor,
      phoneNumber,
      payer,
      callbackUrl,
      rawAmount:
        text(input.amount, 64),
      offlineState:
        offline.offlineState,
      offlineSafe:
        offline.offlineSafe,
      validation,
      actor,
      metadata,
      description,
      occurredAt,
      accessTokenPresent:
        Boolean(input.accessToken),
      approvalId:
        text(input.approvalId, 200),
      approvalFingerprint:
        text(input.approvalFingerprint, 128),
      requestFingerprint:
        text(
          input.requestFingerprint ??
            input.financialFingerprint,
          128,
        ),
      financialIdentity:
        text(
          input.financialIdentity ??
            input.financialTransactionId ??
            input.transactionId,
          this.config
            .maxTransactionIdLength,
        ),
      settlementReference:
        text(
          input.settlementReference,
          this.config
            .maxReferenceLength,
        ),
      compensationIdempotencyKey:
        text(
          input.compensationIdempotencyKey ??
            input.compensationKey ??
            input.reversalIdempotencyKey,
          this.config
            .maxIdempotencyKeyLength,
        ),
    };

    context.semanticFingerprint =
      context.requestFingerprint ??
      (commandType === COMMAND_TYPES.COLLECTION
        ? buildTransactionFingerprint(context)
        : sha256({
            schemaVersion: SCHEMA_VERSION,
            tenantId: context.tenantId,
            provider: PROVIDER,
            operation: context.operation,
            commandType: context.commandType,
            transactionId: context.transactionId,
            collectionId: context.collectionId,
            reference: context.reference,
            providerReference: context.providerReference,
            originalIdempotencyKeyHash:
              context.originalIdempotencyKey
                ? sha256(context.originalIdempotencyKey)
                : null,
            amountMinor: context.amountMinor,
            currency: context.currency,
          }));

    if (
      this.config.requireSemanticFingerprint &&
      !context.semanticFingerprint
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_FINGERPRINT_REQUIRED',
        'A semantic transaction fingerprint is required.',
        {},
        { httpStatus: 422 },
      );
    }

    context.commandId =
      this.config.generateCommandId
        ? text(
            input.commandId,
            160,
          ) ??
          `cmd_${sha256(
            semanticIdentity(
              context,
            ),
          ).slice(0, 48)}`
        : undefined;

    context.providerCorrelationId =
      this.config.generateCorrelationId
        ? base.correlationId ??
          `airtel:${sha256({
            tenantId,
            transactionId:
              base.transactionId,
            originalIdempotencyKey:
              base.originalIdempotencyKey,
            reference:
              base.reference,
            commandType,
          }).slice(0, 48)}`
        : base.correlationId;

    return context;
  }

  buildCollection(
    input = {},
  ) {
    const context =
      this.normalizeContext(
        input,
        {
          commandType:
            COMMAND_TYPES.COLLECTION,
          operation:
            OPERATION,
        },
      );

    const providerRequest = {
      kind:
        PROVIDER_REQUEST_KINDS.COLLECTION,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      country:
        context.country,
      currency:
        context.currency,
      amountMinor:
        context.amountMinor,
      amount:
        text(input.amount, 64) ??
        context.amountMinor,
      phoneNumber:
        context.phoneNumber,
      payer:
        context.payer
          ? {
              partyId:
                context.payer.partyId,
              partyType:
                context.payer.partyType,
            }
          : undefined,
      externalReference:
        context.reference,
      idempotencyKey:
        context.originalIdempotencyKey,
      callbackUrl:
        context.callbackUrl,
      purposeCode:
        context.purposeCode,
      providerReference:
        context.providerReference,
      correlationId:
        context.providerCorrelationId,
      operationId:
        context.operationId,
      requestId:
        context.requestId,
      traceId:
        context.traceId,
      metadata:
        sanitize(
          {
            source:
              COMPONENT,
            commandId:
              context.commandId,
            collectionId:
              context.collectionId,
            transactionId:
              context.transactionId,
            financialIdentity:
              context.financialIdentity,
            semanticFingerprint:
              context.semanticFingerprint,
            schemaVersion:
              SCHEMA_VERSION,
            commandVersion:
              context.commandVersion,
          },
          0,
          this.config,
        ),
    };

    // Access tokens are deliberately not included. CollectionService already
    // carries authentication context separately to the provider adapter.
    assertPayloadSize(
      providerRequest,
      this.config,
    );

    const result = {
      outcome:
        BUILD_OUTCOMES.BUILT,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      commandType:
        COMMAND_TYPES.COLLECTION,
      commandId:
        context.commandId,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      reference:
        context.reference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      phoneNumber:
        context.phoneNumber,
      payer:
        context.payer,
      callbackUrl:
        context.callbackUrl,
      providerCorrelationId:
        context.providerCorrelationId,
      semanticFingerprint:
        context.semanticFingerprint,
      requestFingerprint:
        context.requestFingerprint ??
        context.semanticFingerprint,
      offlineState:
        context.offlineState,
      offlineSafe:
        context.offlineSafe,
      providerRequest,
      internalContext:
        sanitize(
          {
            commandVersion:
              context.commandVersion,
            operationId:
              context.operationId,
            requestId:
              context.requestId,
            traceId:
              context.traceId,
            actor:
              context.actor,
            approvalId:
              context.approvalId,
            approvalFingerprint:
              context.approvalFingerprint,
            financialIdentity:
              context.financialIdentity,
            validation:
              context.validation,
          },
          0,
          this.config,
        ),
    };

    this.#metric(
      'titech_airtel_collection_transaction_builder_built_total',
      {
        operation: OPERATION,
      },
    );

    return result;
  }

  build(input = {}) {
    return this.buildCollection(
      input,
    );
  }

  buildProviderRequest(input = {}) {
    return this.buildCollection(
      input,
    );
  }

  buildStatus(input = {}) {
    const context =
      this.normalizeContext(
        {
          ...input,
          operation:
            'STATUS',
        },
        {
          commandType:
            COMMAND_TYPES.STATUS,
          operation:
            'STATUS',
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requirePayer:
            false,
          requirePhoneNumber:
            false,
        },
      );

    const lookupReference =
      context.providerReference ??
      context.reference ??
      context.transactionId ??
      context.collectionId;

    if (!lookupReference) {
      this.#throw(
        'TRANSACTION_BUILDER_STATUS_REFERENCE_REQUIRED',
        'A provider reference, collection reference or transaction identity is required for status lookup.',
        {},
        {
          httpStatus: 422,
          operation:
            'STATUS',
        },
      );
    }

    const providerRequest = {
      kind:
        PROVIDER_REQUEST_KINDS.STATUS,
      provider:
        PROVIDER,
      operation:
        'STATUS',
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      externalReference:
        lookupReference,
      providerReference:
        context.providerReference,
      correlationId:
        context.providerCorrelationId,
      operationId:
        context.operationId,
      requestId:
        context.requestId,
      traceId:
        context.traceId,
      metadata:
        sanitize(
          {
            source:
              COMPONENT,
            commandId:
              context.commandId,
            originalIdempotencyKeyHash:
              context.originalIdempotencyKey
                ? sha256(
                    context.originalIdempotencyKey,
                  )
                : null,
            schemaVersion:
              SCHEMA_VERSION,
            commandVersion:
              context.commandVersion,
          },
          0,
          this.config,
        ),
    };

    assertPayloadSize(
      providerRequest,
      this.config,
    );

    return {
      outcome:
        BUILD_OUTCOMES.BUILT,
      provider:
        PROVIDER,
      operation:
        'STATUS',
      commandType:
        COMMAND_TYPES.STATUS,
      commandId:
        context.commandId,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      reference:
        context.reference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      providerCorrelationId:
        context.providerCorrelationId,
      semanticFingerprint:
        context.semanticFingerprint,
      providerRequest,
    };
  }

  buildReconciliation(input = {}) {
    const context =
      this.normalizeContext(
        {
          ...input,
          operation:
            'RECONCILIATION',
        },
        {
          commandType:
            COMMAND_TYPES.RECONCILIATION,
          operation:
            'RECONCILIATION',
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requirePayer:
            false,
          requirePhoneNumber:
            false,
        },
      );

    const evidence =
      sanitize(
        input.providerEvidence ??
          input.reconciliationEvidence ??
          input.evidence ??
          {},
        0,
        this.config,
      );

    const providerReference =
      context.providerReference ??
      context.reference ??
      context.transactionId ??
      context.collectionId;

    if (!providerReference) {
      this.#throw(
        'TRANSACTION_BUILDER_RECONCILIATION_REFERENCE_REQUIRED',
        'A collection/provider identity is required for reconciliation.',
        {},
        {
          httpStatus: 422,
          operation:
            'RECONCILIATION',
        },
      );
    }

    const providerRequest = {
      kind:
        COMMAND_TYPES.RECONCILIATION,
      provider:
        PROVIDER,
      operation:
        'RECONCILIATION',
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      externalReference:
        context.reference,
      providerReference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      evidence,
      correlationId:
        context.providerCorrelationId,
      operationId:
        context.operationId,
      requestId:
        context.requestId,
      traceId:
        context.traceId,
    };

    assertPayloadSize(
      providerRequest,
      this.config,
    );

    return {
      outcome:
        BUILD_OUTCOMES.BUILT,
      provider:
        PROVIDER,
      operation:
        'RECONCILIATION',
      commandType:
        COMMAND_TYPES.RECONCILIATION,
      commandId:
        context.commandId,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      reference:
        context.reference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      semanticFingerprint:
        context.semanticFingerprint,
      providerRequest,
    };
  }

  buildCallback(input = {}) {
    const context =
      this.normalizeContext(
        {
          ...input,
          operation:
            'CALLBACK',
        },
        {
          commandType:
            COMMAND_TYPES.CALLBACK,
          operation:
            'CALLBACK',
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
          requirePayer:
            false,
          requirePhoneNumber:
            false,
        },
      );

    const callbackId =
      text(
        input.callbackId ??
          input.providerCallbackId,
        240,
      );

    if (!callbackId) {
      this.#throw(
        'TRANSACTION_BUILDER_CALLBACK_ID_REQUIRED',
        'callbackId is required for callback correlation.',
        {},
        {
          httpStatus: 422,
          operation:
            'CALLBACK',
        },
      );
    }

    const providerPayload =
      sanitize(
        input.providerPayload ??
          input.payload ??
          {},
        0,
        this.config,
      );

    const callbackIdentity = {
      callbackId,
      providerReference:
        context.providerReference,
      reference:
        context.reference,
      transactionId:
        context.transactionId,
      originalIdempotencyKeyHash:
        context.originalIdempotencyKey
          ? sha256(
              context.originalIdempotencyKey,
            )
          : null,
    };

    return {
      outcome:
        BUILD_OUTCOMES.BUILT,
      provider:
        PROVIDER,
      operation:
        'CALLBACK',
      commandType:
        COMMAND_TYPES.CALLBACK,
      commandId:
        context.commandId,
      tenantId:
        context.tenantId,
      semanticFingerprint:
        sha256(callbackIdentity),
      callbackIdentity,
      providerPayload,
      internalContext:
        sanitize(
          {
            correlationId:
              context.providerCorrelationId,
            operationId:
              context.operationId,
            requestId:
              context.requestId,
            traceId:
              context.traceId,
          },
          0,
          this.config,
        ),
    };
  }

  buildReversal(input = {}) {
    const context =
      this.normalizeContext(
        {
          ...input,
          operation:
            'REVERSAL',
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
          requirePayer:
            false,
          requirePhoneNumber:
            false,
        },
      );

    const compensationKey =
      context.compensationIdempotencyKey;

    if (!compensationKey) {
      this.#throw(
        'TRANSACTION_BUILDER_REVERSAL_IDEMPOTENCY_REQUIRED',
        'A distinct reversal/compensation idempotency key is required.',
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
        compensationKey
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_REVERSAL_IDEMPOTENCY_COLLISION',
        'Reversal idempotency identity must differ from the original collection identity.',
        {},
        {
          httpStatus: 409,
          operation:
            'REVERSAL',
        },
      );
    }

    const providerRequest = {
      kind:
        COMMAND_TYPES.REVERSAL,
      provider:
        PROVIDER,
      operation:
        'REVERSAL',
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      externalReference:
        context.reference,
      providerReference:
        context.providerReference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      compensationIdempotencyKey:
        compensationKey,
      reason:
        text(
          input.reason ??
            input.reasonCode ??
            'Airtel collection reversal',
          this.config
            .maxDescriptionLength,
        ),
      correlationId:
        context.providerCorrelationId,
      operationId:
        context.operationId,
      requestId:
        context.requestId,
      traceId:
        context.traceId,
    };

    assertPayloadSize(
      providerRequest,
      this.config,
    );

    return {
      outcome:
        BUILD_OUTCOMES.BUILT,
      provider:
        PROVIDER,
      operation:
        'REVERSAL',
      commandType:
        COMMAND_TYPES.REVERSAL,
      commandId:
        context.commandId,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      compensationIdempotencyKey:
        compensationKey,
      semanticFingerprint:
        context.semanticFingerprint,
      providerRequest,
    };
  }

  buildCompensation(input = {}) {
    const context =
      this.normalizeContext(
        {
          ...input,
          operation:
            'COMPENSATION',
        },
        {
          commandType:
            COMMAND_TYPES.COMPENSATION,
          operation:
            'COMPENSATION',
          requireTransactionId:
            false,
          requireReference:
            false,
          requireOriginalIdempotencyKey:
            false,
          requireAmountMinor:
            false,
        },
      );

    const compensationKey =
      context.compensationIdempotencyKey;

    if (!compensationKey) {
      this.#throw(
        'TRANSACTION_BUILDER_COMPENSATION_IDEMPOTENCY_REQUIRED',
        'A distinct compensation idempotency key is required.',
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
        compensationKey
    ) {
      this.#throw(
        'TRANSACTION_BUILDER_COMPENSATION_IDEMPOTENCY_COLLISION',
        'Compensation identity must differ from the original collection identity.',
        {},
        {
          httpStatus: 409,
          operation:
            'COMPENSATION',
        },
      );
    }

    const providerRequest = {
      kind:
        COMMAND_TYPES.COMPENSATION,
      provider:
        PROVIDER,
      operation:
        'COMPENSATION',
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      externalReference:
        context.reference,
      providerReference:
        context.providerReference,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      compensationIdempotencyKey:
        compensationKey,
      reasonCode:
        text(
          input.reasonCode,
          160,
        ),
      reason:
        text(
          input.reason ??
            input.reasonCode ??
            'Airtel collection compensation',
          this.config
            .maxDescriptionLength,
        ),
      correlationId:
        context.providerCorrelationId,
      operationId:
        context.operationId,
      requestId:
        context.requestId,
      traceId:
        context.traceId,
    };

    assertPayloadSize(
      providerRequest,
      this.config,
    );

    return {
      outcome:
        BUILD_OUTCOMES.BUILT,
      provider:
        PROVIDER,
      operation:
        'COMPENSATION',
      commandType:
        COMMAND_TYPES.COMPENSATION,
      commandId:
        context.commandId,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      originalIdempotencyKey:
        context.originalIdempotencyKey,
      compensationIdempotencyKey:
        compensationKey,
      semanticFingerprint:
        context.semanticFingerprint,
      providerRequest,
    };
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,
      operation:
        OPERATION,
      deterministicCommands:
        true,
      deterministicFingerprinting:
        true,
      tenantScoped:
        true,
      originalIdentityPreserved:
        true,
      idempotencyIdentityPreserved:
        true,
      separateCompensationIdentity:
        true,
      exactMinorUnits:
        true,
      ugandaMsisdnNormalization:
        true,
      offlineSafetyGate:
        true,
      providerHttp:
        false,
      providerAuthentication:
        false,
      databaseAccess:
        false,
      ledgerMutation:
        false,
      balanceMutation:
        false,
      walletMutation:
        false,
      settlementFinality:
        false,
      reconciliationFinality:
        false,
    });
  }

  health() {
    return {
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      status:
        'UP',
      ready:
        true,
      version:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      capabilities:
        this.capabilities(),
      financialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  readiness() {
    return this.health();
  }

  diagnostics() {
    return {
      module:
        MODULE_NAME,
      engine:
        ENGINE_NAME,
      version:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      health:
        this.health(),
      configuration:
        sanitize(
          this.config,
          0,
          this.config,
        ),
      capabilities:
        this.capabilities(),
      security: {
        accessTokenInProviderRequest:
          false,
        rawSecretLogging:
          false,
        rawSensitiveMetadata:
          false,
        tenantScopeEnforced:
          this.config.requireTenantId,
        originalIdempotencyRequired:
          this.config.requireOriginalIdempotencyKey,
        ambiguousOutcomeAdjudication:
          false,
      },
    };
  }
}

export function createCollectionTransactionBuilder(
  options = {},
) {
  return new AirtelCollectionTransactionBuilder(
    options,
  );
}

export function createTransactionBuilder(
  options = {},
) {
  return createCollectionTransactionBuilder(
    options,
  );
}

export const AirtelCollectionTransactionBuilderError =
  AirtelTransactionBuilderError;

export const CollectionTransactionBuilder =
  AirtelCollectionTransactionBuilder;

export const TransactionBuilder =
  AirtelCollectionTransactionBuilder;

export function normalizeCollectionMsisdn(
  phoneNumber,
  configuration = {},
) {
  return normalizeUgandaMsisdn(
    phoneNumber,
    {
      ...DEFAULT_CONFIG,
      ...configuration,
    },
  );
}

export function normalizeCollectionAmountMinor(
  amountMinor,
) {
  return normalizeAmountMinor(
    amountMinor,
  );
}

export function buildCollectionCommandId(
  input = {},
) {
  const builder =
    new AirtelCollectionTransactionBuilder();
  return builder.buildCollection(
    input,
  ).commandId;
}

export function buildCollectionProviderCorrelationId(
  input = {},
) {
  const builder =
    new AirtelCollectionTransactionBuilder();
  return builder.buildCollection(
    input,
  ).providerCorrelationId;
}

export function createCollectionTransactionFingerprint(
  input = {},
) {
  return buildTransactionFingerprint(
    input,
  );
}

export function getDefaultConfiguration() {
  return clone(
    DEFAULT_CONFIG,
  );
}

export const CONSTANTS = Object.freeze({
  MODULE_NAME,
  ENGINE_NAME,
  ENGINE_VERSION,
  COMPONENT,
  PROVIDER,
  OPERATION,
  SCHEMA_VERSION,
  COMMAND_TYPES,
  BUILD_OUTCOMES,
  OFFLINE_STATES,
  UNSAFE_OFFLINE_STATES,
  PROVIDER_REQUEST_KINDS,
  FINANCIAL_BOUNDARY,
});

export default AirtelCollectionTransactionBuilder;