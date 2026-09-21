'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Beneficiary Validation Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/beneficiaryValidator.js
 *
 * Architectural role
 * ------------------
 * Canonical pre-execution beneficiary safety boundary for Airtel outbound
 * disbursements. The validator converts an externally supplied beneficiary
 * envelope into a normalized, bounded and policy-ready validation result.
 *
 * Responsibilities
 * ----------------
 * - Validate beneficiary structure and party identifier semantics.
 * - Normalize MSISDN values without relying on a third-party dependency.
 * - Enforce tenant/provider/country/currency/operation scope.
 * - Validate disbursement amount, reference and financial identity context.
 * - Invoke injected beneficiary-directory, blacklist, KYC, AML, fraud/risk and
 *   custom validation adapters.
 * - Distinguish PASS / REVIEW / BLOCK outcomes.
 * - Produce deterministic, privacy-preserving fingerprints for the beneficiary
 *   and validation scope.
 * - Emit bounded audit evidence and optional domain events.
 * - Remain stateless and safe for concurrent use.
 *
 * Non-responsibilities
 * --------------------
 * - Does not call Airtel provider APIs.
 * - Does not authorize or approve a payment.
 * - Does not mutate wallet, balance, ledger, transaction or settlement state.
 * - Does not become the KYC, AML, sanctions or fraud source of truth.
 * - Does not persist beneficiary records directly.
 * - Does not store provider credentials, OTPs, PINs or raw provider payloads.
 * - Does not treat LOCAL_ONLY/PENDING_SYNC as server-authoritative execution.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Tenant isolation is mandatory by default.
 * 2. Airtel is the default provider scope.
 * 3. Beneficiary identifiers are hashed for durable evidence/logging.
 * 4. Monetary values are represented as canonical strings; no floating-point
 *    arithmetic is used for financial comparisons.
 * 5. Missing mandatory compliance evidence fails closed when configured.
 * 6. Conflicting/stale beneficiary evidence becomes REVIEW, never silent PASS.
 * 7. Validation is a gate, not an authorization grant.
 * 8. Custom rules are deterministic, bounded and ordered by priority.
 * 9. Audit/event boundaries receive sanitized data only.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only; no new runtime dependency is required.
 * =============================================================================
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-disbursement-beneficiary-validator';
export const ENGINE_VERSION = '2.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const OPERATION = 'DISBURSEMENT';
export const SCHEMA_VERSION = 1;

export const VALIDATION_OUTCOMES = Object.freeze({
  PASS: 'PASS',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
  ERROR: 'ERROR',
});

export const VALIDATION_CODES = Object.freeze({
  VALID: 'BENEFICIARY_VALID',
  REQUIRED: 'BENEFICIARY_REQUIRED',
  STRUCTURE_INVALID: 'BENEFICIARY_STRUCTURE_INVALID',
  TENANT_REQUIRED: 'TENANT_REQUIRED',
  TENANT_SCOPE_MISMATCH: 'TENANT_SCOPE_MISMATCH',
  PROVIDER_SCOPE_VIOLATION: 'PROVIDER_SCOPE_VIOLATION',
  COUNTRY_REQUIRED: 'COUNTRY_REQUIRED',
  UNSUPPORTED_COUNTRY: 'UNSUPPORTED_COUNTRY',
  CURRENCY_REQUIRED: 'CURRENCY_REQUIRED',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  PARTY_ID_REQUIRED: 'BENEFICIARY_PARTY_ID_REQUIRED',
  PARTY_TYPE_INVALID: 'BENEFICIARY_PARTY_TYPE_INVALID',
  PARTY_ID_INVALID: 'BENEFICIARY_PARTY_ID_INVALID',
  MSISDN_INVALID: 'BENEFICIARY_MSISDN_INVALID',
  MSISDN_COUNTRY_MISMATCH: 'BENEFICIARY_MSISDN_COUNTRY_MISMATCH',
  REFERENCE_REQUIRED: 'DISBURSEMENT_REFERENCE_REQUIRED',
  IDEMPOTENCY_KEY_REQUIRED: 'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
  AMOUNT_REQUIRED: 'DISBURSEMENT_AMOUNT_REQUIRED',
  AMOUNT_INVALID: 'DISBURSEMENT_AMOUNT_INVALID',
  AMOUNT_TOO_LOW: 'DISBURSEMENT_AMOUNT_TOO_LOW',
  AMOUNT_TOO_HIGH: 'DISBURSEMENT_AMOUNT_TOO_HIGH',
  OFFLINE_UNSAFE: 'BENEFICIARY_OFFLINE_STATE_UNSAFE',
  BLACKLISTED: 'BENEFICIARY_BLACKLISTED',
  KYC_FAILED: 'BENEFICIARY_KYC_FAILED',
  KYC_REQUIRED: 'BENEFICIARY_KYC_REQUIRED',
  AML_FAILED: 'BENEFICIARY_AML_FAILED',
  AML_REQUIRED: 'BENEFICIARY_AML_REQUIRED',
  SANCTIONS_FAILED: 'BENEFICIARY_SANCTIONS_FAILED',
  FRAUD_BLOCKED: 'BENEFICIARY_FRAUD_BLOCKED',
  RISK_REVIEW: 'BENEFICIARY_RISK_REVIEW',
  DIRECTORY_NOT_FOUND: 'BENEFICIARY_NOT_FOUND',
  DIRECTORY_INACTIVE: 'BENEFICIARY_INACTIVE',
  DIRECTORY_CONFLICT: 'BENEFICIARY_DIRECTORY_CONFLICT',
  RULE_REJECTED: 'BENEFICIARY_RULE_REJECTED',
  RULE_REVIEW: 'BENEFICIARY_RULE_REVIEW',
  SERVICE_UNAVAILABLE: 'BENEFICIARY_VALIDATION_SERVICE_UNAVAILABLE',
});

export const PARTY_ID_TYPES = Object.freeze({
  MSISDN: 'MSISDN',
  ACCOUNT: 'ACCOUNT',
  WALLET: 'WALLET',
  MERCHANT: 'MERCHANT',
  EXTERNAL_ID: 'EXTERNAL_ID',
});

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
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

const DEFAULT_COUNTRY_RULES = Object.freeze({
  UG: Object.freeze({
    dialCode: '256',
    defaultCurrency: 'UGX',
    msisdnNationalDigits: 9,
    nationalPrefixes: Object.freeze(['0']),
  }),
});

const DEFAULTS = Object.freeze({
  requireTenantId: true,
  provider: PROVIDER,
  operation: OPERATION,

  defaultCountry: 'UG',
  supportedCountries: Object.freeze(['UG']),
  countryRules: DEFAULT_COUNTRY_RULES,
  allowUnknownCountries: true,

  defaultCurrency: 'UGX',
  supportedCurrencies: Object.freeze(['UGX']),
  allowUnknownCurrencies: false,
  currencyByCountry: Object.freeze({
    UG: 'UGX',
  }),

  defaultPartyIdType: PARTY_ID_TYPES.MSISDN,
  allowedPartyIdTypes: Object.freeze([
    PARTY_ID_TYPES.MSISDN,
    PARTY_ID_TYPES.ACCOUNT,
    PARTY_ID_TYPES.WALLET,
    PARTY_ID_TYPES.MERCHANT,
    PARTY_ID_TYPES.EXTERNAL_ID,
  ]),

  msisdnMinDigits: 8,
  msisdnMaxDigits: 15,
  enforceCountryDialCode: true,
  enforceNationalPrefix: true,
  allowedMsisdnPatterns: Object.freeze({}),

  accountIdPattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$/,
  walletIdPattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$/,
  merchantIdPattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$/,
  externalIdPattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,95}$/,

  requireReference: true,
  requireOriginalIdempotencyKey: true,
  requireAmountMinor: true,
  requireCurrency: true,

  minimumAmountMinor: undefined,
  maximumAmountMinor: undefined,

  rejectUnresolvedOfflineStates: true,
  rejectInactiveBeneficiary: true,
  rejectDirectoryMismatch: true,

  requireKyc: false,
  requireAml: false,
  requireSanctions: false,
  requireFraudCheck: false,

  failClosedOnBlacklistError: true,
  failClosedOnKycError: true,
  failClosedOnAmlError: true,
  failClosedOnSanctionsError: true,
  failClosedOnFraudError: true,
  failClosedOnDirectoryError: false,
  failClosedOnRuleError: true,
  failClosedOnAuditError: false,

  maxRules: 100,
  maxReasonLength: 1000,
  maxReferenceLength: 240,
  maxTenantIdLength: 160,
  maxBeneficiaryIdLength: 240,
  maxMetadataKeys: 60,
  maxMetadataDepth: 4,
  maxMetadataArray: 40,
  maxMetadataStringLength: 400,

  eventTypePrefix:
    'PAYMENT.AIRTEL.DISBURSEMENT.BENEFICIARY',
});

const SENSITIVE_FIELD_PATTERN =
  /(password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|card(number)?|private.?key|access.?key|api.?key|signature|credential|raw(request|response)|provider.?payload|msisdn|phone|mobile|accountNumber)/i;

const PROTOTYPE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const isFunction = (value) =>
  typeof value === 'function';

const upper = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized.toUpperCase() : undefined;
};

const normalizeString = (
  value,
  maxLength = 240,
) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!normalized) return undefined;

  return normalized.slice(0, maxLength);
};

const normalizeDigits = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const digits = String(value).replace(/[^0-9]/g, '');
  return digits || undefined;
};

const normalizeDecimalString = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const [whole, fraction] = normalized.split('.');
  const cleanWhole = whole.replace(/^0+(?=\d)/, '') || '0';

  if (fraction === undefined) {
    return cleanWhole;
  }

  return `${cleanWhole}.${fraction}`;
};

const normalizeIntegerString = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  return normalized.replace(/^0+(?=\d)/, '') || '0';
};

const compareUnsignedIntegerStrings = (left, right) => {
  const a = normalizeIntegerString(left);
  const b = normalizeIntegerString(right);

  if (a === undefined || b === undefined) return null;

  if (a.length !== b.length) {
    return a.length > b.length ? 1 : -1;
  }

  if (a === b) return 0;
  return a > b ? 1 : -1;
};

const clone = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

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
      .map((key) =>
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

const sanitizeObject = (
  value,
  path = '',
  depth = 0,
  limits = {},
) => {
  const maxDepth = limits.maxDepth ?? 4;
  const maxKeys = limits.maxKeys ?? 60;
  const maxArray = limits.maxArray ?? 40;
  const maxStringLength = limits.maxStringLength ?? 400;

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
    if (PROTOTYPE_KEYS.has(key)) continue;

    const childPath = path
      ? `${path}.${key}`
      : key;

    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
      continue;
    }

    result[key] = sanitizeObject(
      value[key],
      childPath,
      depth + 1,
      limits,
    );
  }

  return result;
};

const actorIdOf = (actor) =>
  normalizeString(
    actor?.actorId ??
      actor?.userId ??
      actor?.principalId ??
      actor?.id,
    160,
  );

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

const riskRank = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

const maxRisk = (...levels) => {
  let selected = RISK_LEVELS.LOW;

  for (const level of levels) {
    const normalized = upper(level);
    if (
      normalized &&
      (riskRank[normalized] ?? 0) >
        (riskRank[selected] ?? 0)
    ) {
      selected = normalized;
    }
  }

  return selected;
};

const severityToRisk = (severity) => {
  switch (upper(severity)) {
    case 'CRITICAL':
      return RISK_LEVELS.CRITICAL;
    case 'HIGH':
      return RISK_LEVELS.HIGH;
    case 'MEDIUM':
      return RISK_LEVELS.MEDIUM;
    default:
      return RISK_LEVELS.LOW;
  }
};

const outcomeFromDecision = (value) => {
  const decision = upper(value);

  if (
    [
      'BLOCK',
      'DENY',
      'REJECT',
      'REJECTED',
      'FAIL',
      'FAILED',
    ].includes(decision)
  ) {
    return VALIDATION_OUTCOMES.BLOCK;
  }

  if (
    [
      'REVIEW',
      'REQUIRE_REVIEW',
      'PENDING',
      'UNKNOWN',
      'CONFLICT',
      'MANUAL_REVIEW',
    ].includes(decision)
  ) {
    return VALIDATION_OUTCOMES.REVIEW;
  }

  return VALIDATION_OUTCOMES.PASS;
};

export class BeneficiaryValidationError extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message, options);
    this.name = 'BeneficiaryValidationError';
    this.code = code;
    this.component = COMPONENT;
    this.provider = PROVIDER;
    this.operation = OPERATION;
    this.statusCode = options.httpStatus ?? 400;
    this.retryable = Boolean(options.retryable);
    this.details = sanitizeObject(details);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      component: this.component,
      provider: this.provider,
      operation: this.operation,
      statusCode: this.statusCode,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export const normalizeUgandanOrE164Msisdn = (
  value,
  country = 'UG',
  countryRules = DEFAULT_COUNTRY_RULES,
) => {
  const raw = normalizeString(value, 40);
  if (!raw) return undefined;

  const digits = normalizeDigits(raw);
  if (!digits) return undefined;

  const normalizedCountry = upper(country) ?? 'UG';
  const rule = countryRules?.[normalizedCountry];

  if (!rule?.dialCode) {
    return `+${digits}`;
  }

  if (
    digits.startsWith(
      String(rule.dialCode),
    )
  ) {
    return `+${digits}`;
  }

  if (
    digits.startsWith('0') &&
    rule.nationalPrefixes?.includes('0')
  ) {
    return `+${rule.dialCode}${digits.slice(1)}`;
  }

  return `+${digits}`;
};

export const beneficiaryFingerprint = (
  beneficiary,
  context = {},
) => {
  const normalized = normalizeBeneficiaryEnvelope(
    beneficiary,
    context,
  );

  return sha256({
    schemaVersion: SCHEMA_VERSION,
    tenantId:
      normalizeString(
        context.tenantId,
        160,
      ),
    provider: PROVIDER,
    operation: OPERATION,
    partyIdType:
      normalized.partyIdType,
    beneficiaryHash:
      normalized.beneficiaryHash,
    country: normalized.country,
    currency: normalized.currency,
    accountStatus:
      upper(
        normalized.accountStatus,
      ),
  });
};

export const normalizeBeneficiaryEnvelope = (
  beneficiary,
  context = {},
  configuration = {},
) => {
  if (!isPlainObject(beneficiary)) {
    throw new BeneficiaryValidationError(
      VALIDATION_CODES.STRUCTURE_INVALID,
      'Beneficiary must be an object.',
    );
  }

  const config = {
    ...DEFAULTS,
    ...configuration,
  };

  const country =
    upper(
      beneficiary.country ??
        beneficiary.countryCode ??
        context.country ??
        config.defaultCountry,
    );

  const currency =
    upper(
      beneficiary.currency ??
        context.currency ??
        config.currencyByCountry?.[country] ??
        config.defaultCurrency,
    );

  const partyIdType =
    upper(
      beneficiary.partyIdType ??
        beneficiary.identifierType ??
        beneficiary.type ??
        config.defaultPartyIdType,
    );

  const rawPartyId = normalizeString(
    beneficiary.partyId ??
      beneficiary.identifier ??
      beneficiary.msisdn ??
      beneficiary.phone ??
      beneficiary.phoneNumber ??
      beneficiary.accountId ??
      beneficiary.walletId ??
      beneficiary.merchantId,
    config.maxBeneficiaryIdLength,
  );

  if (!rawPartyId) {
    throw new BeneficiaryValidationError(
      VALIDATION_CODES.PARTY_ID_REQUIRED,
      'Beneficiary party identifier is required.',
    );
  }

  const normalizedPartyId =
    partyIdType === PARTY_ID_TYPES.MSISDN
      ? normalizeUgandanOrE164Msisdn(
          rawPartyId,
          country,
          config.countryRules,
        )
      : rawPartyId.trim();

  const beneficiaryHash = sha256(
    `${PROVIDER}|${country}|${partyIdType}|${normalizedPartyId}`,
  );

  return {
    partyId:
      normalizedPartyId,
    partyIdType,
    beneficiaryHash,
    country,
    currency,

    displayName: normalizeString(
      beneficiary.displayName ??
        beneficiary.name ??
        beneficiary.fullName,
      240,
    ),

    firstName: normalizeString(
      beneficiary.firstName,
      120,
    ),

    lastName: normalizeString(
      beneficiary.lastName,
      120,
    ),

    status:
      upper(
        beneficiary.status ??
          beneficiary.accountStatus,
      ),

    accountStatus:
      upper(
        beneficiary.accountStatus ??
          beneficiary.status,
      ),

    kycStatus:
      upper(
        beneficiary.kycStatus,
      ),

    amlStatus:
      upper(
        beneficiary.amlStatus,
      ),

    sanctionsStatus:
      upper(
        beneficiary.sanctionsStatus,
      ),

    riskLevel:
      upper(
        beneficiary.riskLevel,
      ),

    metadata: sanitizeObject(
      beneficiary.metadata ?? {},
      'metadata',
      0,
      {
        maxDepth:
          config.maxMetadataDepth,
        maxKeys:
          config.maxMetadataKeys,
        maxArray:
          config.maxMetadataArray,
        maxStringLength:
          config.maxMetadataStringLength,
      },
    ),
  };
};

const validatePattern = (
  value,
  pattern,
) => {
  if (!pattern) return true;
  if (pattern instanceof RegExp) {
    return pattern.test(value);
  }
  if (typeof pattern === 'string') {
    return new RegExp(pattern).test(value);
  }
  return true;
};

export class AirtelBeneficiaryValidator {
  constructor(options = {}) {
    this.config = Object.freeze({
      ...DEFAULTS,
      ...(options.configuration ??
        options.config ??
        {}),
    });

    this.blacklist =
      options.blacklist ??
      options.blacklistService ??
      null;

    this.beneficiaryDirectory =
      options.beneficiaryDirectory ??
      options.directoryService ??
      null;

    this.kycService =
      options.kycService ??
      null;

    this.amlService =
      options.amlService ??
      null;

    this.sanctionsService =
      options.sanctionsService ??
      null;

    this.fraudGuard =
      options.fraudGuard ??
      options.fraudService ??
      null;

    this.riskEngine =
      options.riskEngine ??
      options.riskService ??
      null;

    this.rules =
      Array.isArray(options.rules)
        ? options.rules.slice()
        : [];

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
  }

  #metadataLimits() {
    return {
      maxDepth:
        this.config.maxMetadataDepth,
      maxKeys:
        this.config.maxMetadataKeys,
      maxArray:
        this.config.maxMetadataArray,
      maxStringLength:
        this.config.maxMetadataStringLength,
    };
  }

  #configurationForCountry(
    country,
  ) {
    return (
      this.config.countryRules?.[country] ??
      null
    );
  }

  #validateTenantAndProvider({
    tenantId,
    provider,
    beneficiary,
  }) {
    const normalizedTenantId =
      normalizeString(
        tenantId,
        this.config.maxTenantIdLength,
      );

    if (
      this.config.requireTenantId &&
      !normalizedTenantId
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.TENANT_REQUIRED,
        'tenantId is required for beneficiary validation.',
      );
    }

    const beneficiaryTenantId =
      normalizeString(
        beneficiary.tenantId,
        this.config.maxTenantIdLength,
      );

    if (
      beneficiaryTenantId &&
      normalizedTenantId &&
      beneficiaryTenantId !==
        normalizedTenantId
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.TENANT_SCOPE_MISMATCH,
        'Beneficiary tenant scope does not match the validation tenant.',
        {},
        { httpStatus: 403 },
      );
    }

    const requestedProvider =
      upper(provider ?? PROVIDER);

    if (
      requestedProvider !== PROVIDER
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.PROVIDER_SCOPE_VIOLATION,
        'This validator is scoped to Airtel disbursements.',
        { provider: requestedProvider },
        { httpStatus: 409 },
      );
    }

    return normalizedTenantId;
  }

  #validateCountryCurrency(
    normalized,
  ) {
    const country =
      normalized.country;

    if (!country) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.COUNTRY_REQUIRED,
        'Beneficiary country is required.',
      );
    }

    const supportedCountries =
      new Set(
        (this.config.supportedCountries ?? [])
          .map(upper)
          .filter(Boolean),
      );

    if (
      !this.config.allowUnknownCountries &&
      !supportedCountries.has(country)
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.UNSUPPORTED_COUNTRY,
        `Country ${country} is not enabled for Airtel beneficiary validation.`,
        { country },
      );
    }

    if (
      this.config.requireCurrency &&
      !normalized.currency
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.CURRENCY_REQUIRED,
        'Disbursement currency is required.',
      );
    }

    const supportedCurrencies =
      new Set(
        (this.config.supportedCurrencies ?? [])
          .map(upper)
          .filter(Boolean),
      );

    if (
      normalized.currency &&
      !this.config.allowUnknownCurrencies &&
      !supportedCurrencies.has(
        normalized.currency,
      )
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.UNSUPPORTED_CURRENCY,
        `Currency ${normalized.currency} is not enabled for Airtel beneficiary validation.`,
        {
          currency:
            normalized.currency,
        },
      );
    }

    const expectedCurrency =
      this.config.currencyByCountry?.[
        country
      ];

    if (
      expectedCurrency &&
      normalized.currency !==
        upper(expectedCurrency)
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.UNSUPPORTED_CURRENCY,
        `Currency ${normalized.currency} is not configured for country ${country}.`,
        {
          country,
          currency:
            normalized.currency,
        },
      );
    }
  }

  #validatePartyIdentifier(
    normalized,
  ) {
    const allowed =
      new Set(
        this.config.allowedPartyIdTypes ??
          [],
      );

    if (
      !allowed.has(
        normalized.partyIdType,
      )
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.PARTY_TYPE_INVALID,
        `Beneficiary partyIdType ${normalized.partyIdType} is not supported.`,
        {
          partyIdType:
            normalized.partyIdType,
        },
      );
    }

    if (
      normalized.partyIdType ===
      PARTY_ID_TYPES.MSISDN
    ) {
      this.#validateMsisdn(
        normalized,
      );
      return;
    }

    const patternMap = {
      [PARTY_ID_TYPES.ACCOUNT]:
        this.config.accountIdPattern,
      [PARTY_ID_TYPES.WALLET]:
        this.config.walletIdPattern,
      [PARTY_ID_TYPES.MERCHANT]:
        this.config.merchantIdPattern,
      [PARTY_ID_TYPES.EXTERNAL_ID]:
        this.config.externalIdPattern,
    };

    const pattern =
      patternMap[
        normalized.partyIdType
      ];

    if (
      pattern &&
      !validatePattern(
        normalized.partyId,
        pattern,
      )
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.PARTY_ID_INVALID,
        'Beneficiary party identifier format is invalid.',
        {
          partyIdType:
            normalized.partyIdType,
        },
      );
    }
  }

  #validateMsisdn(
    normalized,
  ) {
    const digits =
      normalizeDigits(
        normalized.partyId,
      );

    if (!digits) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.MSISDN_INVALID,
        'Beneficiary MSISDN contains no digits.',
      );
    }

    if (
      digits.length <
        this.config.msisdnMinDigits ||
      digits.length >
        this.config.msisdnMaxDigits
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.MSISDN_INVALID,
        'Beneficiary MSISDN length is invalid.',
      );
    }

    const countryRule =
      this.#configurationForCountry(
        normalized.country,
      );

    if (
      this.config.enforceCountryDialCode &&
      countryRule?.dialCode
    ) {
      const dialCode =
        String(countryRule.dialCode);

      if (
        !digits.startsWith(dialCode)
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.MSISDN_COUNTRY_MISMATCH,
          'Beneficiary MSISDN does not match the configured country dial code.',
          {
            country:
              normalized.country,
          },
        );
      }

      if (
        countryRule
          .msisdnNationalDigits &&
        digits.length !==
          dialCode.length +
            Number(
              countryRule.msisdnNationalDigits,
            )
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.MSISDN_INVALID,
          'Beneficiary MSISDN length does not match the configured country rule.',
          {
            country:
              normalized.country,
          },
        );
      }
    }

    const countryPattern =
      this.config
        .allowedMsisdnPatterns?.[
        normalized.country
      ];

    if (
      countryPattern &&
      !validatePattern(
        digits,
        countryPattern,
      )
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.MSISDN_INVALID,
        'Beneficiary MSISDN does not match the configured country/operator pattern.',
        {
          country:
            normalized.country,
        },
      );
    }
  }

  #validateAmountContext(
    context,
  ) {
    const amountMinor =
      normalizeIntegerString(
        context.amountMinor ??
          context.amountInMinorUnits,
      );

    if (
      this.config.requireAmountMinor &&
      !amountMinor
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.AMOUNT_REQUIRED,
        'amountMinor is required for disbursement beneficiary validation.',
      );
    }

    if (
      amountMinor === '0'
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.AMOUNT_INVALID,
        'Disbursement amount must be greater than zero.',
      );
    }

    if (
      amountMinor &&
      this.config.minimumAmountMinor !==
        undefined
    ) {
      const minimum =
        normalizeIntegerString(
          this.config.minimumAmountMinor,
        );

      if (
        minimum &&
        compareUnsignedIntegerStrings(
          amountMinor,
          minimum,
        ) < 0
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.AMOUNT_TOO_LOW,
          'Disbursement amount is below the configured minimum.',
        );
      }
    }

    if (
      amountMinor &&
      this.config.maximumAmountMinor !==
        undefined
    ) {
      const maximum =
        normalizeIntegerString(
          this.config.maximumAmountMinor,
        );

      if (
        maximum &&
        compareUnsignedIntegerStrings(
          amountMinor,
          maximum,
        ) > 0
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.AMOUNT_TOO_HIGH,
          'Disbursement amount exceeds the configured maximum.',
        );
      }
    }

    if (
      this.config.requireReference &&
      !normalizeString(
        context.reference ??
          context.paymentReference,
        this.config.maxReferenceLength,
      )
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.REFERENCE_REQUIRED,
        'A stable disbursement reference is required.',
      );
    }

    if (
      this.config.requireOriginalIdempotencyKey &&
      !normalizeString(
        context.originalIdempotencyKey ??
          context.idempotencyKey,
        240,
      )
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.IDEMPOTENCY_KEY_REQUIRED,
        'The original financial idempotency key is required.',
      );
    }

    return {
      amountMinor,
      reference:
        normalizeString(
          context.reference ??
            context.paymentReference,
          this.config.maxReferenceLength,
        ),
      originalIdempotencyKey:
        normalizeString(
          context.originalIdempotencyKey ??
            context.idempotencyKey,
          240,
        ),
    };
  }

  #validateOfflineState(
    context,
  ) {
    const offlineState =
      upper(
        context.offlineState ??
          context.syncState ??
          context.paymentState,
      );

    if (
      this.config.rejectUnresolvedOfflineStates &&
      [
        OFFLINE_STATES.LOCAL_ONLY,
        OFFLINE_STATES.PENDING_SYNC,
        OFFLINE_STATES.SYNCING,
        OFFLINE_STATES.SERVER_REJECTED,
        OFFLINE_STATES.CONFLICT,
        OFFLINE_STATES.REQUIRES_REVIEW,
      ].includes(offlineState)
    ) {
      throw new BeneficiaryValidationError(
        VALIDATION_CODES.OFFLINE_UNSAFE,
        'Beneficiary validation cannot authorize a disbursement while its payment context remains unresolved offline.',
        { offlineState },
        { httpStatus: 409 },
      );
    }

    return offlineState;
  }

  async #directoryCheck({
    tenantId,
    beneficiary,
    context,
  }) {
    const method =
      this.beneficiaryDirectory
        ?.resolve ??
      this.beneficiaryDirectory
        ?.find ??
      this.beneficiaryDirectory
        ?.lookup ??
      null;

    if (!isFunction(method)) {
      return {
        performed: false,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        evidence: {
          source: 'NOT_CONFIGURED',
        },
      };
    }

    try {
      const result =
        (await method.call(
          this.beneficiaryDirectory,
          {
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            beneficiary,
            context: sanitizeObject(
              context,
              'context',
              0,
              this.#metadataLimits(),
            ),
          },
        )) ?? {};

      const status =
        upper(
          result.status ??
            result.accountStatus,
        );

      if (
        result.found === false ||
        result.exists === false
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.DIRECTORY_NOT_FOUND,
          reason:
            result.reason ??
            'Beneficiary was not found in the configured directory.',
          evidence: {
            source:
              'BENEFICIARY_DIRECTORY',
            found: false,
          },
        };
      }

      if (
        this.config.rejectInactiveBeneficiary &&
        [
          'INACTIVE',
          'BLOCKED',
          'SUSPENDED',
          'CLOSED',
          'DECEASED',
        ].includes(status)
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.DIRECTORY_INACTIVE,
          reason:
            result.reason ??
            'Beneficiary account is not eligible for disbursement.',
          evidence: {
            source:
              'BENEFICIARY_DIRECTORY',
            status,
          },
        };
      }

      const returnedFingerprint =
        normalizeString(
          result.beneficiaryFingerprint ??
            result.fingerprint,
          128,
        );

      if (
        returnedFingerprint &&
        returnedFingerprint !==
          beneficiary.beneficiaryHash &&
        this.config.rejectDirectoryMismatch
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.REVIEW,
          code:
            VALIDATION_CODES.DIRECTORY_CONFLICT,
          reason:
            'Directory evidence does not match the submitted beneficiary identity.',
          evidence: {
            source:
              'BENEFICIARY_DIRECTORY',
            conflict: true,
          },
        };
      }

      const decision =
        outcomeFromDecision(
          result.decision ??
            result.outcome,
        );

      return {
        performed: true,
        outcome: decision,
        code:
          decision ===
          VALIDATION_OUTCOMES.REVIEW
            ? VALIDATION_CODES.DIRECTORY_CONFLICT
            : decision ===
              VALIDATION_OUTCOMES.BLOCK
              ? VALIDATION_CODES.DIRECTORY_INACTIVE
              : VALIDATION_CODES.VALID,
        reason: result.reason,
        evidence: {
          source:
            'BENEFICIARY_DIRECTORY',
          status,
          verificationReference:
            normalizeString(
              result.verificationReference,
              160,
            ),
        },
      };
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary directory validation failed.',
        {
          code:
            VALIDATION_CODES.SERVICE_UNAVAILABLE,
          message:
            error?.message,
          beneficiaryHash:
            beneficiary.beneficiaryHash,
        },
      );

      if (
        this.config
          .failClosedOnDirectoryError
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Beneficiary directory validation is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.REVIEW,
        code:
          VALIDATION_CODES.DIRECTORY_CONFLICT,
        reason:
          'Beneficiary directory validation was unavailable.',
        evidence: {
          source:
            'BENEFICIARY_DIRECTORY',
          unavailable: true,
        },
      };
    }
  }

  async #blacklistCheck({
    tenantId,
    beneficiary,
  }) {
    const method =
      this.blacklist?.contains ??
      this.blacklist?.isBlocked ??
      this.blacklist?.find;

    if (!isFunction(method)) {
      return {
        performed: false,
        outcome:
          VALIDATION_OUTCOMES.PASS,
      };
    }

    try {
      const result =
        await method.call(
          this.blacklist,
          {
            tenantId,
            provider: PROVIDER,
            partyId:
              beneficiary.partyId,
            partyIdType:
              beneficiary.partyIdType,
            beneficiaryHash:
              beneficiary.beneficiaryHash,
          },
        );

      const blocked =
        typeof result === 'boolean'
          ? result
          : Boolean(
              result?.blocked ??
                result?.blacklisted ??
                result?.denied,
            );

      if (blocked) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.BLACKLISTED,
          reason:
            typeof result === 'object'
              ? result.reason
              : undefined,
        };
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        code:
          VALIDATION_CODES.VALID,
      };
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary blacklist validation failed.',
        {
          message:
            error?.message,
          beneficiaryHash:
            beneficiary.beneficiaryHash,
        },
      );

      if (
        this.config
          .failClosedOnBlacklistError
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Beneficiary blacklist validation is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.REVIEW,
        code:
          VALIDATION_CODES.RISK_REVIEW,
        reason:
          'Blacklist validation was unavailable.',
      };
    }
  }

  async #kycCheck({
    tenantId,
    beneficiary,
    context,
  }) {
    const method =
      this.kycService?.verify ??
      this.kycService?.check ??
      null;

    if (!isFunction(method)) {
      if (this.config.requireKyc) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.KYC_REQUIRED,
          'KYC validation is required but no KYC service is configured.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: false,
        outcome:
          VALIDATION_OUTCOMES.PASS,
      };
    }

    try {
      const result =
        (await method.call(
          this.kycService,
          {
            tenantId,
            provider: PROVIDER,
            beneficiary,
            context: sanitizeObject(
              context,
              'context',
              0,
              this.#metadataLimits(),
            ),
          },
        )) ?? {};

      const allowed =
        result.allowed ??
        result.verified ??
        result.passed;

      const decision =
        outcomeFromDecision(
          result.decision ??
            result.outcome,
        );

      if (
        allowed === false ||
        decision ===
          VALIDATION_OUTCOMES.BLOCK
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.KYC_FAILED,
          reason:
            result.reason ??
            'Beneficiary KYC validation failed.',
          evidence: {
            source: 'KYC',
            status:
              upper(result.status),
            verificationReference:
              normalizeString(
                result.verificationReference,
                160,
              ),
          },
        };
      }

      if (
        decision ===
        VALIDATION_OUTCOMES.REVIEW
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.REVIEW,
          code:
            VALIDATION_CODES.RISK_REVIEW,
          reason:
            result.reason ??
            'Beneficiary KYC requires review.',
          evidence: {
            source: 'KYC',
            status:
              upper(result.status),
          },
        };
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        code:
          VALIDATION_CODES.VALID,
        evidence: {
          source: 'KYC',
          status:
            upper(result.status),
        },
      };
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary KYC validation failed.',
        {
          message:
            error?.message,
          beneficiaryHash:
            beneficiary.beneficiaryHash,
        },
      );

      if (
        this.config
          .failClosedOnKycError
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Beneficiary KYC validation is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.REVIEW,
        code:
          VALIDATION_CODES.RISK_REVIEW,
        reason:
          'KYC validation was unavailable.',
      };
    }
  }

  async #amlCheck({
    tenantId,
    beneficiary,
    context,
  }) {
    const method =
      this.amlService?.screen ??
      this.amlService?.check ??
      null;

    if (!isFunction(method)) {
      if (this.config.requireAml) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.AML_REQUIRED,
          'AML validation is required but no AML service is configured.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: false,
        outcome:
          VALIDATION_OUTCOMES.PASS,
      };
    }

    try {
      const result =
        (await method.call(
          this.amlService,
          {
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            beneficiary,
            context: sanitizeObject(
              context,
              'context',
              0,
              this.#metadataLimits(),
            ),
          },
        )) ?? {};

      if (
        result.blocked === true ||
        result.allowed === false ||
        ['BLOCK', 'DENY', 'REJECT'].includes(
          upper(
            result.decision ??
              result.outcome,
          ),
        )
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.AML_FAILED,
          reason:
            result.reason ??
            'Beneficiary AML screening failed.',
          evidence: {
            source: 'AML',
            status:
              upper(result.status),
          },
        };
      }

      if (
        outcomeFromDecision(
          result.decision ??
            result.outcome,
        ) ===
        VALIDATION_OUTCOMES.REVIEW
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.REVIEW,
          code:
            VALIDATION_CODES.RISK_REVIEW,
          reason:
            result.reason ??
            'Beneficiary AML screening requires review.',
          evidence: {
            source: 'AML',
            status:
              upper(result.status),
          },
        };
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        code:
          VALIDATION_CODES.VALID,
        evidence: {
          source: 'AML',
          status:
            upper(result.status),
        },
      };
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary AML screening failed.',
        {
          message:
            error?.message,
          beneficiaryHash:
            beneficiary.beneficiaryHash,
        },
      );

      if (
        this.config
          .failClosedOnAmlError
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Beneficiary AML screening is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.REVIEW,
        code:
          VALIDATION_CODES.RISK_REVIEW,
        reason:
          'AML screening was unavailable.',
      };
    }
  }

  async #sanctionsCheck({
    tenantId,
    beneficiary,
    context,
  }) {
    const method =
      this.sanctionsService?.screen ??
      this.sanctionsService?.check ??
      null;

    if (!isFunction(method)) {
      if (this.config.requireSanctions) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Sanctions screening is required but no sanctions service is configured.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: false,
        outcome:
          VALIDATION_OUTCOMES.PASS,
      };
    }

    try {
      const result =
        (await method.call(
          this.sanctionsService,
          {
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            beneficiary,
            context: sanitizeObject(
              context,
              'context',
              0,
              this.#metadataLimits(),
            ),
          },
        )) ?? {};

      if (
        result.blocked === true ||
        result.matched === true ||
        result.allowed === false ||
        ['BLOCK', 'DENY', 'REJECT'].includes(
          upper(
            result.decision ??
              result.outcome,
          ),
        )
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.SANCTIONS_FAILED,
          reason:
            result.reason ??
            'Beneficiary sanctions screening failed.',
          evidence: {
            source: 'SANCTIONS',
            status:
              upper(result.status),
          },
        };
      }

      if (
        outcomeFromDecision(
          result.decision ??
            result.outcome,
        ) ===
        VALIDATION_OUTCOMES.REVIEW
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.REVIEW,
          code:
            VALIDATION_CODES.RISK_REVIEW,
          reason:
            result.reason ??
            'Beneficiary sanctions screening requires review.',
          evidence: {
            source: 'SANCTIONS',
            status:
              upper(result.status),
          },
        };
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        code:
          VALIDATION_CODES.VALID,
        evidence: {
          source: 'SANCTIONS',
          status:
            upper(result.status),
        },
      };
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary sanctions screening failed.',
        {
          message:
            error?.message,
          beneficiaryHash:
            beneficiary.beneficiaryHash,
        },
      );

      if (
        this.config
          .failClosedOnSanctionsError
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Beneficiary sanctions screening is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.REVIEW,
        code:
          VALIDATION_CODES.RISK_REVIEW,
        reason:
          'Sanctions screening was unavailable.',
      };
    }
  }

  async #fraudCheck({
    tenantId,
    beneficiary,
    context,
  }) {
    const method =
      this.fraudGuard?.evaluateBeneficiary ??
      this.fraudGuard?.evaluate ??
      this.fraudGuard?.check ??
      null;

    if (!isFunction(method)) {
      if (this.config.requireFraudCheck) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Fraud validation is required but no fraud guard is configured.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: false,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        riskLevel:
          RISK_LEVELS.LOW,
      };
    }

    try {
      const result =
        (await method.call(
          this.fraudGuard,
          {
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            beneficiary,
            context: sanitizeObject(
              context,
              'context',
              0,
              this.#metadataLimits(),
            ),
          },
        )) ?? {};

      const outcome =
        outcomeFromDecision(
          result.decision ??
            result.outcome,
        );

      const resultRisk =
        upper(
          result.riskLevel ??
            severityToRisk(
              result.severity,
            ),
        ) ??
        RISK_LEVELS.LOW;

      if (
        result.blocked === true ||
        result.allowed === false ||
        outcome ===
          VALIDATION_OUTCOMES.BLOCK
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.FRAUD_BLOCKED,
          riskLevel: resultRisk,
          reason:
            result.reason ??
            'Fraud controls blocked this beneficiary.',
          evidence: {
            source: 'FRAUD',
            severity:
              upper(result.severity),
          },
        };
      }

      if (
        outcome ===
          VALIDATION_OUTCOMES.REVIEW ||
        (riskRank[resultRisk] ?? 0) >=
          riskRank[RISK_LEVELS.HIGH]
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.REVIEW,
          code:
            VALIDATION_CODES.RISK_REVIEW,
          riskLevel: resultRisk,
          reason:
            result.reason ??
            'Fraud controls require manual review.',
          evidence: {
            source: 'FRAUD',
            severity:
              upper(result.severity),
          },
        };
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        code:
          VALIDATION_CODES.VALID,
        riskLevel: resultRisk,
        evidence: {
          source: 'FRAUD',
        },
      };
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary fraud validation failed.',
        {
          message:
            error?.message,
          beneficiaryHash:
            beneficiary.beneficiaryHash,
        },
      );

      if (
        this.config
          .failClosedOnFraudError
      ) {
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Beneficiary fraud validation is unavailable.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.REVIEW,
        code:
          VALIDATION_CODES.RISK_REVIEW,
        riskLevel:
          RISK_LEVELS.HIGH,
        reason:
          'Fraud validation was unavailable.',
      };
    }
  }

  async #riskCheck({
    tenantId,
    beneficiary,
    context,
  }) {
    const method =
      this.riskEngine?.scoreBeneficiary ??
      this.riskEngine?.score ??
      this.riskEngine?.evaluate ??
      null;

    if (!isFunction(method)) {
      return {
        performed: false,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        riskLevel:
          beneficiary.riskLevel ??
          RISK_LEVELS.LOW,
      };
    }

    try {
      const result =
        (await method.call(
          this.riskEngine,
          {
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            beneficiary,
            context: sanitizeObject(
              context,
              'context',
              0,
              this.#metadataLimits(),
            ),
          },
        )) ?? {};

      const outcome =
        outcomeFromDecision(
          result.decision ??
            result.outcome,
        );

      const resultRisk =
        upper(
          result.riskLevel ??
            result.severity,
        ) ??
        beneficiary.riskLevel ??
        RISK_LEVELS.LOW;

      if (
        outcome ===
          VALIDATION_OUTCOMES.BLOCK
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.BLOCK,
          code:
            VALIDATION_CODES.RISK_REVIEW,
          riskLevel: resultRisk,
          reason:
            result.reason ??
            'Beneficiary risk engine blocked the beneficiary.',
        };
      }

      if (
        outcome ===
          VALIDATION_OUTCOMES.REVIEW ||
        (riskRank[resultRisk] ?? 0) >=
          riskRank[RISK_LEVELS.HIGH]
      ) {
        return {
          performed: true,
          outcome:
            VALIDATION_OUTCOMES.REVIEW,
          code:
            VALIDATION_CODES.RISK_REVIEW,
          riskLevel: resultRisk,
          reason:
            result.reason ??
            'Beneficiary risk requires manual review.',
        };
      }

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.PASS,
        code:
          VALIDATION_CODES.VALID,
        riskLevel: resultRisk,
      };
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary risk evaluation failed.',
        {
          message:
            error?.message,
          beneficiaryHash:
            beneficiary.beneficiaryHash,
        },
      );

      return {
        performed: true,
        outcome:
          VALIDATION_OUTCOMES.REVIEW,
        code:
          VALIDATION_CODES.RISK_REVIEW,
        riskLevel:
          RISK_LEVELS.HIGH,
        reason:
          'Beneficiary risk evaluation was unavailable.',
      };
    }
  }

  #orderedRules() {
    return this.rules
      .filter(Boolean)
      .slice(0, this.config.maxRules)
      .sort(
        (a, b) =>
          Number(b.priority ?? 0) -
          Number(a.priority ?? 0),
      );
  }

  async #customRules({
    tenantId,
    beneficiary,
    context,
  }) {
    const findings = [];
    let outcome =
      VALIDATION_OUTCOMES.PASS;
    let riskLevel =
      beneficiary.riskLevel ??
      RISK_LEVELS.LOW;

    for (const rule of this.#orderedRules()) {
      const method =
        rule.evaluate ??
        rule.validate ??
        rule.check;

      if (!isFunction(method)) {
        if (
          this.config
            .failClosedOnRuleError
        ) {
          throw new BeneficiaryValidationError(
            VALIDATION_CODES.SERVICE_UNAVAILABLE,
            'A configured beneficiary validation rule is invalid.',
            {
              rule:
                normalizeString(
                  rule.name ??
                    rule.id,
                  160,
                ),
            },
            {
              httpStatus: 503,
            },
          );
        }

        continue;
      }

      try {
        const result =
          (await method.call(
            rule,
            {
              tenantId,
              provider: PROVIDER,
              operation: OPERATION,
              beneficiary,
              context: sanitizeObject(
                context,
                'context',
                0,
                this.#metadataLimits(),
              ),
            },
          )) ?? {};

        const ruleOutcome =
          outcomeFromDecision(
            result.decision ??
              result.outcome,
          );

        riskLevel = maxRisk(
          riskLevel,
          result.riskLevel,
          severityToRisk(
            result.severity,
          ),
        );

        if (
          ruleOutcome ===
          VALIDATION_OUTCOMES.BLOCK
        ) {
          outcome =
            VALIDATION_OUTCOMES.BLOCK;
        } else if (
          ruleOutcome ===
            VALIDATION_OUTCOMES.REVIEW &&
          outcome !==
            VALIDATION_OUTCOMES.BLOCK
        ) {
          outcome =
            VALIDATION_OUTCOMES.REVIEW;
        }

        findings.push({
          rule:
            normalizeString(
              result.ruleId ??
                rule.id ??
                rule.name,
              160,
            ),
          outcome:
            ruleOutcome,
          code:
            normalizeString(
              result.code,
              160,
            ),
          severity:
            upper(result.severity),
          reason:
            normalizeString(
              result.reason,
              this.config
                .maxReasonLength,
            ),
        });
      } catch (error) {
        this.#log(
          'error',
          'Airtel beneficiary custom rule failed.',
          {
            rule:
              normalizeString(
                rule.id ??
                  rule.name,
                160,
              ),
            message:
              error?.message,
          },
        );

        if (
          this.config
            .failClosedOnRuleError
        ) {
          throw new BeneficiaryValidationError(
            VALIDATION_CODES.SERVICE_UNAVAILABLE,
            'A beneficiary validation rule could not be evaluated.',
            {},
            {
              retryable: true,
              httpStatus: 503,
            },
          );
        }

        outcome =
          outcome ===
          VALIDATION_OUTCOMES.BLOCK
            ? outcome
            : VALIDATION_OUTCOMES.REVIEW;
      }
    }

    return {
      outcome,
      riskLevel,
      findings,
    };
  }

  async #runCheck(name, fn) {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof
        BeneficiaryValidationError
      ) {
        throw error;
      }

      this.#log(
        'error',
        `Airtel beneficiary ${name} check failed.`,
        {
          message:
            error?.message,
        },
      );

      throw new BeneficiaryValidationError(
        VALIDATION_CODES.SERVICE_UNAVAILABLE,
        `Airtel beneficiary ${name} validation is unavailable.`,
        {},
        {
          retryable: true,
          httpStatus: 503,
        },
      );
    }
  }

  #aggregateOutcome(checks) {
    let outcome =
      VALIDATION_OUTCOMES.PASS;
    let reason;
    let code =
      VALIDATION_CODES.VALID;
    let riskLevel =
      RISK_LEVELS.LOW;

    for (const check of checks) {
      if (!check) continue;

      riskLevel = maxRisk(
        riskLevel,
        check.riskLevel,
      );

      if (
        check.outcome ===
        VALIDATION_OUTCOMES.BLOCK
      ) {
        outcome =
          VALIDATION_OUTCOMES.BLOCK;
        code =
          check.code ??
          VALIDATION_CODES.RULE_REJECTED;
        reason =
          check.reason ??
          reason;
        continue;
      }

      if (
        check.outcome ===
        VALIDATION_OUTCOMES.REVIEW &&
        outcome !==
          VALIDATION_OUTCOMES.BLOCK
      ) {
        outcome =
          VALIDATION_OUTCOMES.REVIEW;
        code =
          check.code ??
          VALIDATION_CODES.RULE_REVIEW;
        reason =
          check.reason ??
          reason;
      }
    }

    return {
      outcome,
      code,
      reason,
      riskLevel,
    };
  }

  async assess({
    tenantId,
    beneficiary,
    context = {},
    provider = PROVIDER,
  } = {}) {
    const startedAt =
      nowMs(this.clock);

    const rawBeneficiary =
      beneficiary;

    try {
      const normalizedTenantId =
        this.#validateTenantAndProvider({
          tenantId,
          provider,
          beneficiary:
            rawBeneficiary ?? {},
        });

      const normalizedBeneficiary =
        normalizeBeneficiaryEnvelope(
          rawBeneficiary,
          {
            ...context,
            tenantId:
              normalizedTenantId,
            provider,
          },
          this.config,
        );

      this.#validateCountryCurrency(
        normalizedBeneficiary,
      );

      const financialContext =
        this.#validateAmountContext(
          context,
        );

      const offlineState =
        this.#validateOfflineState(
          context,
        );

      this.#validatePartyIdentifier(
        normalizedBeneficiary,
      );

      const effectiveContext = {
        ...context,
        tenantId:
          normalizedTenantId,
        provider: PROVIDER,
        operation: OPERATION,
        amountMinor:
          financialContext.amountMinor,
        reference:
          financialContext.reference,
        originalIdempotencyKey:
          financialContext.originalIdempotencyKey,
        currency:
          normalizedBeneficiary.currency,
        country:
          normalizedBeneficiary.country,
        offlineState,
      };

      const checks = [];

      checks.push(
        await this.#runCheck(
          'directory',
          () =>
            this.#directoryCheck({
              tenantId:
                normalizedTenantId,
              beneficiary:
                normalizedBeneficiary,
              context:
                effectiveContext,
            }),
        ),
      );

      checks.push(
        await this.#runCheck(
          'blacklist',
          () =>
            this.#blacklistCheck({
              tenantId:
                normalizedTenantId,
              beneficiary:
                normalizedBeneficiary,
            }),
        ),
      );

      checks.push(
        await this.#runCheck(
          'kyc',
          () =>
            this.#kycCheck({
              tenantId:
                normalizedTenantId,
              beneficiary:
                normalizedBeneficiary,
              context:
                effectiveContext,
            }),
        ),
      );

      checks.push(
        await this.#runCheck(
          'aml',
          () =>
            this.#amlCheck({
              tenantId:
                normalizedTenantId,
              beneficiary:
                normalizedBeneficiary,
              context:
                effectiveContext,
            }),
        ),
      );

      checks.push(
        await this.#runCheck(
          'sanctions',
          () =>
            this.#sanctionsCheck({
              tenantId:
                normalizedTenantId,
              beneficiary:
                normalizedBeneficiary,
              context:
                effectiveContext,
            }),
        ),
      );

      checks.push(
        await this.#runCheck(
          'fraud',
          () =>
            this.#fraudCheck({
              tenantId:
                normalizedTenantId,
              beneficiary:
                normalizedBeneficiary,
              context:
                effectiveContext,
            }),
        ),
      );

      checks.push(
        await this.#runCheck(
          'risk',
          () =>
            this.#riskCheck({
              tenantId: normalizedTenantId,
              beneficiary: normalizedBeneficiary,
              context: effectiveContext,
            }),
        ),
      );

      const rules =
        await this.#runCheck(
          'custom-rules',
          () =>
            this.#customRules({
              tenantId:
                normalizedTenantId,
              beneficiary:
                normalizedBeneficiary,
              context:
                effectiveContext,
            }),
        );

      checks.push(
        rules,
      );

      const aggregate =
        this.#aggregateOutcome(
          checks,
        );

      const scope = {
        schemaVersion:
          SCHEMA_VERSION,
        tenantId:
          normalizedTenantId,
        provider: PROVIDER,
        operation: OPERATION,
        beneficiaryHash:
          normalizedBeneficiary.beneficiaryHash,
        partyIdType:
          normalizedBeneficiary.partyIdType,
        country:
          normalizedBeneficiary.country,
        currency:
          normalizedBeneficiary.currency,
        amountMinor:
          financialContext.amountMinor,
        reference:
          financialContext.reference,
        originalIdempotencyKeyHash:
          financialContext.originalIdempotencyKey
            ? sha256(
                financialContext.originalIdempotencyKey,
              )
            : undefined,
        offlineState,
      };

      const fingerprint =
        sha256(scope);

      const evidence = checks
        .filter(Boolean)
        .map((check) => ({
          performed:
            Boolean(
              check.performed,
            ),
          outcome:
            check.outcome,
          code:
            check.code,
          riskLevel:
            check.riskLevel,
          reason:
            normalizeString(
              check.reason,
              this.config
                .maxReasonLength,
            ),
          evidence:
            sanitizeObject(
              check.evidence ?? {},
              'evidence',
              0,
              this.#metadataLimits(),
            ),
          findings:
            Array.isArray(
              check.findings,
            )
              ? check.findings
              : undefined,
        }));

      const durationMs =
        nowMs(this.clock) -
        startedAt;

      const result = {
        valid:
          aggregate.outcome ===
          VALIDATION_OUTCOMES.PASS,

        outcome:
          aggregate.outcome,

        code:
          aggregate.code,

        provider: PROVIDER,
        operation: OPERATION,
        tenantId:
          normalizedTenantId,

        beneficiaryId:
          normalizedBeneficiary.partyId,

        beneficiaryIdType:
          normalizedBeneficiary.partyIdType,

        beneficiaryHash:
          normalizedBeneficiary.beneficiaryHash,

        country:
          normalizedBeneficiary.country,

        currency:
          normalizedBeneficiary.currency,

        amountMinor:
          financialContext.amountMinor,

        reference:
          financialContext.reference,

        originalIdempotencyKey:
          financialContext.originalIdempotencyKey,

        fingerprint,

        riskLevel:
          aggregate.riskLevel,

        reason:
          aggregate.reason,

        evidence,

        normalizedBeneficiary: {
          partyId:
            normalizedBeneficiary.partyId,
          partyIdType:
            normalizedBeneficiary.partyIdType,
          country:
            normalizedBeneficiary.country,
          currency:
            normalizedBeneficiary.currency,
          beneficiaryHash:
            normalizedBeneficiary.beneficiaryHash,
          displayName:
            normalizedBeneficiary.displayName,
          firstName:
            normalizedBeneficiary.firstName,
          lastName:
            normalizedBeneficiary.lastName,
        },

        financialSafety: {
          executeProviderCallHere:
            false,
          writeLedgerHere:
            false,
          mutateBalanceHere:
            false,
          authorizePaymentHere:
            false,
          preserveOriginalIdempotencyKey:
            true,
          authoritativeBoundary:
            'TITECH_FINANCIAL_CORE / AIRTEL_DISBURSEMENT_SERVICE',
        },

        metadata: {
          schemaVersion:
            SCHEMA_VERSION,
          engineName:
            ENGINE_NAME,
          engineVersion:
            ENGINE_VERSION,
          validationDurationMs:
            durationMs,
          checkedAt:
            nowIso(this.clock),
        },
      };

      this.#metric(
        'airtel.disbursement.beneficiary.validation.completed',
        {
          outcome:
            aggregate.outcome,
          riskLevel:
            aggregate.riskLevel,
        },
      );

      if (
        aggregate.outcome ===
        VALIDATION_OUTCOMES.BLOCK
      ) {
        await this.#emitGovernanceEvent(
          'BLOCKED',
          result,
        );
      } else if (
        aggregate.outcome ===
        VALIDATION_OUTCOMES.REVIEW
      ) {
        await this.#emitGovernanceEvent(
          'REVIEW_REQUIRED',
          result,
        );
      }

      return deepFreeze(
        clone(result),
      );
    } catch (error) {
      this.#metric(
        'airtel.disbursement.beneficiary.validation.failed',
        {
          code:
            error?.code ??
            VALIDATION_CODES.SERVICE_UNAVAILABLE,
        },
      );

      if (
        error instanceof
        BeneficiaryValidationError
      ) {
        await this.#emitFailureEvidence({
          tenantId,
          beneficiary:
            rawBeneficiary,
          error,
        });
        throw error;
      }

      this.#log(
        'error',
        'Unexpected Airtel beneficiary validation failure.',
        {
          message:
            error?.message,
          tenantId,
        },
      );

      const wrapped =
        new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Airtel beneficiary validation failed unexpectedly.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );

      await this.#emitFailureEvidence({
        tenantId,
        beneficiary:
          rawBeneficiary,
        error: wrapped,
      });

      throw wrapped;
    }
  }

  async validate(input = {}) {
    const result =
      await this.assess(input);

    if (
      result.outcome ===
      VALIDATION_OUTCOMES.BLOCK
    ) {
      throw new BeneficiaryValidationError(
        result.code ??
          VALIDATION_CODES.RULE_REJECTED,
        result.reason ??
          'Beneficiary is not eligible for Airtel disbursement.',
        {
          fingerprint:
            result.fingerprint,
          beneficiaryHash:
            result.beneficiaryHash,
          outcome:
            result.outcome,
        },
        {
          httpStatus: 409,
        },
      );
    }

    if (
      result.outcome ===
        VALIDATION_OUTCOMES.REVIEW
    ) {
      throw new BeneficiaryValidationError(
        result.code ??
          VALIDATION_CODES.RULE_REVIEW,
        result.reason ??
          'Beneficiary requires review before Airtel disbursement.',
        {
          fingerprint:
            result.fingerprint,
          beneficiaryHash:
            result.beneficiaryHash,
          outcome:
            result.outcome,
        },
        {
          httpStatus: 409,
        },
      );
    }

    return result;
  }

  async validateDetailed(
    input = {},
  ) {
    return this.assess(input);
  }

  async validateOrThrow(
    input = {},
  ) {
    return this.validate(input);
  }

  normalize(
    beneficiary,
    context = {},
  ) {
    const normalized =
      normalizeBeneficiaryEnvelope(
        beneficiary,
        context,
        this.config,
      );

    this.#validateCountryCurrency(
      normalized,
    );

    this.#validatePartyIdentifier(
      normalized,
    );

    return deepFreeze(
      clone(normalized),
    );
  }

  fingerprint(
    beneficiary,
    context = {},
  ) {
    return beneficiaryFingerprint(
      beneficiary,
      context,
    );
  }

  #buildFailureAuditEnvelope({
    tenantId,
    beneficiary,
    error,
  }) {
    let beneficiaryHash;

    try {
      if (beneficiary) {
        const normalized =
          normalizeBeneficiaryEnvelope(
            beneficiary,
            { tenantId },
            this.config,
          );
        beneficiaryHash =
          normalized.beneficiaryHash;
      }
    } catch {
      beneficiaryHash = undefined;
    }

    return {
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      tenantId:
        normalizeString(
          tenantId,
          this.config.maxTenantIdLength,
        ),
      beneficiaryHash,
      outcome:
        VALIDATION_OUTCOMES.BLOCK,
      code:
        error?.code,
      reason:
        normalizeString(
          error?.message,
          this.config.maxReasonLength,
        ),
      occurredAt:
        nowIso(this.clock),
    };
  }

  async #emitFailureEvidence({
    tenantId,
    beneficiary,
    error,
  }) {
    const envelope =
      this.#buildFailureAuditEnvelope({
        tenantId,
        beneficiary,
        error,
      });

    try {
      await this.#writeAudit(
        'BENEFICIARY_VALIDATION_FAILED',
        envelope,
      );
    } catch {
      // Failure evidence is best-effort unless a caller explicitly configures
      // a hard audit requirement. The original validation error remains intact.
    }
  }

  async #emitGovernanceEvent(
    type,
    result,
  ) {
    const payload = {
      eventId:
        sha256({
          type,
          fingerprint:
            result.fingerprint,
          occurrence:
            result.metadata?.checkedAt,
        }),
      type:
        `${this.config.eventTypePrefix}.${type}`,
      occurredAt:
        result.metadata?.checkedAt ??
        nowIso(this.clock),
      tenantId:
        result.tenantId,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      beneficiaryHash:
        result.beneficiaryHash,
      fingerprint:
        result.fingerprint,
      outcome:
        result.outcome,
      code:
        result.code,
      riskLevel:
        result.riskLevel,
      reference:
        result.reference,
    };

    await this.#writeAudit(
      `BENEFICIARY_${type}`,
      payload,
    );

    const method =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (!isFunction(method)) {
      return;
    }

    try {
      await method.call(
        this.eventBus,
        payload,
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary governance event publication failed.',
        {
          type,
          message:
            error?.message,
          tenantId:
            result.tenantId,
        },
      );
    }
  }

  async #writeAudit(
    action,
    payload,
  ) {
    const method =
      this.auditService?.append ??
      this.auditService?.record ??
      this.auditService?.write;

    if (!isFunction(method)) {
      return null;
    }

    try {
      return await method.call(
        this.auditService,
        {
          schemaVersion:
            SCHEMA_VERSION,
          component:
            COMPONENT,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          action,
          payload:
            sanitizeObject(
              payload,
              'payload',
              0,
              this.#metadataLimits(),
            ),
          occurredAt:
            nowIso(this.clock),
        },
      );
    } catch (error) {
      this.#log(
        'error',
        'Airtel beneficiary audit write failed.',
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
        throw new BeneficiaryValidationError(
          VALIDATION_CODES.SERVICE_UNAVAILABLE,
          'Beneficiary audit boundary is unavailable.',
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
        sanitizeObject(labels),
      );
    } catch {
      // Observability cannot influence financial safety decisions.
    }
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
          ...sanitizeObject(
            context,
            'log',
            0,
            this.#metadataLimits(),
          ),
        },
        message,
      );
    } catch {
      // Logging must never change the validation decision.
    }
  }

  health() {
    const dependencies = {
      blacklist:
        Boolean(this.blacklist),
      beneficiaryDirectory:
        Boolean(this.beneficiaryDirectory),
      kycService:
        Boolean(this.kycService),
      amlService:
        Boolean(this.amlService),
      sanctionsService:
        Boolean(this.sanctionsService),
      fraudGuard:
        Boolean(this.fraudGuard),
      riskEngine:
        Boolean(this.riskEngine),
      auditService:
        Boolean(this.auditService),
      eventBus:
        Boolean(this.eventBus),
    };

    const requiredDependenciesReady =
      (!this.config.requireKyc ||
        dependencies.kycService) &&
      (!this.config.requireAml ||
        dependencies.amlService) &&
      (!this.config.requireSanctions ||
        dependencies.sanctionsService) &&
      (!this.config.requireFraudCheck ||
        dependencies.fraudGuard) &&
      (!this.config.requireAuditBoundary ||
        dependencies.auditService);

    return {
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      version:
        ENGINE_VERSION,
      healthy:
        requiredDependenciesReady,
      status:
        requiredDependenciesReady
          ? 'UP'
          : 'DEGRADED',
      dependencies,
      controls: {
        tenantIsolation:
          this.config.requireTenantId,
        kycRequired:
          this.config.requireKyc,
        amlRequired:
          this.config.requireAml,
        sanctionsRequired:
          this.config.requireSanctions,
        fraudCheckRequired:
          this.config.requireFraudCheck,
        rejectOfflineUnsafe:
          this.config.rejectUnresolvedOfflineStates,
        originalIdempotencyRequired:
          this.config.requireOriginalIdempotencyKey,
      },
    };
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,
      operation:
        OPERATION,
      normalizeMsisdn:
        true,
      countryAwareValidation:
        true,
      tenantIsolation:
        true,
      amountValidation:
        true,
      blacklistCheck:
        Boolean(this.blacklist),
      beneficiaryDirectoryCheck:
        Boolean(this.beneficiaryDirectory),
      kycIntegration:
        Boolean(this.kycService),
      amlIntegration:
        Boolean(this.amlService),
      sanctionsIntegration:
        Boolean(this.sanctionsService),
      fraudIntegration:
        Boolean(this.fraudGuard),
      riskIntegration:
        Boolean(this.riskEngine),
      customRules:
        this.rules.length > 0,
      deterministicFingerprint:
        true,
      privacyPreservingEvidence:
        true,
      directProviderExecution:
        false,
      directLedgerMutation:
        false,
      directBalanceMutation:
        false,
      paymentAuthorization:
        false,
    });
  }
}

export const createBeneficiaryValidator = (
  options = {},
) =>
  new AirtelBeneficiaryValidator(
    options,
  );

export const BeneficiaryValidator =
  AirtelBeneficiaryValidator;

export const defaultBeneficiaryValidator =
  createBeneficiaryValidator();

export const beneficiaryValidator =
  defaultBeneficiaryValidator;

export default AirtelBeneficiaryValidator;