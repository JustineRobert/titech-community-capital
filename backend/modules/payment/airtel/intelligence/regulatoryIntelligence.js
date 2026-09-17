'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Regulatory Intelligence Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/regulatoryIntelligence.js
 *
 * Purpose:
 *   Enterprise-grade, deterministic regulatory/compliance intelligence for the
 *   Airtel payment domain. The engine evaluates versioned, externally governed
 *   policy packs against payment context; identifies missing/contradictory
 *   evidence; produces auditable compliance decisions; fingerprints policy and
 *   decisions; detects regulatory-policy changes; and prepares approval/evidence
 *   envelopes for downstream compliance, operations and payment orchestration.
 *
 * Architectural Position:
 *
 *   External Regulatory Sources / Compliance Governance
 *                         |
 *                         v
 *                Versioned Policy Pack
 *                         |
 *                         v
 *             Regulatory Intelligence Engine
 *                  /       |        \
 *                 /        |         \
 *                v         v          v
 *           Compliance   Evidence   Change Impact
 *            Decision      Gaps       Analysis
 *                |
 *                v
 *        Payment Orchestrator / Compliance Service
 *                |
 *                v
 *           TITech Financial Core
 *           Transaction / Ledger
 *
 * RESPONSIBILITIES
 * ----------------
 * - Validate tenant/provider/jurisdiction payment context.
 * - Evaluate versioned policy packs and deterministic compliance rules.
 * - Distinguish PASS, REVIEW, BLOCK and NO_POLICY states.
 * - Detect missing, stale, contradictory or untrusted regulatory evidence.
 * - Produce explainable rule-level findings without exposing sensitive payloads.
 * - Generate deterministic policy, decision and idempotency fingerprints.
 * - Compare policy versions and assess change impact.
 * - Normalize externally supplied regulatory notices without persisting them.
 * - Support approval/activation planning for governed policy changes.
 * - Support optional source/policy adapters through dependency injection.
 * - Expose health/metrics/logging hooks without introducing runtime dependencies.
 *
 * NON-RESPONSIBILITIES / IMPORTANT BOUNDARIES
 * --------------------------------------------
 * - Does NOT claim to be legal advice or determine what the law requires.
 * - Does NOT scrape or call regulators directly; source adapters do that.
 * - Does NOT silently invent jurisdiction-specific limits or obligations.
 * - Does NOT make KYC/AML/sanctions source-of-truth decisions itself; it evaluates
 *   authoritative evidence supplied by compliance systems or policy packs.
 * - Does NOT create, settle, reverse or mutate financial transactions.
 * - Does NOT mutate balances or write ledger entries.
 * - Does NOT persist policy packs, notices or decisions internally.
 * - Does NOT send regulatory reports directly.
 * - Does NOT treat a source URI alone as proof of regulatory authenticity.
 * - Does NOT automatically activate, supersede or roll back a policy pack.
 * - Does NOT bypass maker-checker / policy-governance approval.
 * - A BLOCK result is a compliance gate result for the caller; it is not a
 *   substitute for the authoritative payment/financial transaction boundary.
 *
 * PRODUCTION SAFETY PRINCIPLES
 * ----------------------------
 * - Tenant isolation is mandatory by default.
 * - Airtel is the default provider scope; cross-provider evaluation is explicit.
 * - Policy is versioned, fingerprinted and effective-dated.
 * - Missing mandatory policy is fail-closed to REVIEW/NO_POLICY, never ALLOW.
 * - Missing evidence is distinguishable from a negative finding.
 * - Conflicting evidence is never resolved silently.
 * - Sensitive values are not copied into logs, findings or audit envelopes.
 * - Decision fingerprints use opaque digests of policy-relevant evidence rather than
 *   serializing the full evidence envelope.
 * - Dynamic evidence/policy paths reject prototype-pollution segments.
 * - Supplied policy/notice fingerprints are verified rather than trusted blindly.
 * - Policy and activation plans can be re-validated against current fingerprints.
 * - Monetary comparisons use exact decimal string semantics, not binary floats.
 * - Policy activation requires explicit governance/approval metadata.
 * - The engine remains stateless and safe for concurrent workers.
 *
 * MODULE FORMAT
 * -------------
 * TITech backend targets ESM semantics. This file uses native ESM exports and
 * Node built-ins only; no new runtime dependency is required.
 *
 * =============================================================================
 */

import { createHash } from 'node:crypto';

// =============================================================================
// Engine identity
// =============================================================================

export const ENGINE_NAME = 'airtel-regulatory-intelligence';
export const ENGINE_VERSION = '1.1.0';
export const COMPONENT = ENGINE_NAME;

// =============================================================================
// Enumerations / policy constants
// =============================================================================

export const PROVIDERS = Object.freeze(['AIRTEL']);

export const OPERATIONS = Object.freeze([
  'COLLECTION',
  'DISBURSEMENT',
  'REFUND',
  'REVERSAL',
  'STATUS',
]);

export const EVALUATION_MODES = Object.freeze([
  'ENFORCE',
  'PREVIEW',
  'ADVISORY',
]);

export const COMPLIANCE_DECISIONS = Object.freeze([
  'ALLOW',
  'ALLOW_WITH_REPORTING',
  'REVIEW',
  'BLOCK',
  'NO_POLICY',
]);

export const RULE_RESULTS = Object.freeze([
  'PASS',
  'FAIL',
  'UNKNOWN',
  'NOT_APPLICABLE',
  'ERROR',
]);

export const RULE_OUTCOMES = Object.freeze([
  'ALLOW',
  'REVIEW',
  'BLOCK',
  'REPORT',
  'REQUIRE_EVIDENCE',
]);

export const POLICY_STATUSES = Object.freeze([
  'DRAFT',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'SUPERSEDED',
  'RETIRED',
]);

export const NOTICE_STATUSES = Object.freeze([
  'NEW',
  'ACKNOWLEDGED',
  'ASSESSED',
  'IMPLEMENTED',
  'REJECTED',
  'SUPERSEDED',
]);

export const SEVERITIES = Object.freeze([
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const CONTROL_FAMILIES = Object.freeze([
  'KYC',
  'AML',
  'SANCTIONS',
  'TRANSACTION_LIMIT',
  'REPORTING',
  'RECORDKEEPING',
  'DATA_PROTECTION',
  'CONSUMER_PROTECTION',
  'LICENSING',
  'CROSS_BORDER',
  'OUTSOURCING',
  'COMPLAINTS',
  'OPERATIONAL_RESILIENCE',
  'OTHER',
]);

export const POLICY_CHANGE_TYPES = Object.freeze([
  'ADDED',
  'REMOVED',
  'MODIFIED',
  'UNCHANGED',
]);

export const IMPACT_LEVELS = Object.freeze([
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const SOURCE_VERIFICATION_STATUSES = Object.freeze([
  'VERIFIED',
  'UNVERIFIED',
  'MISSING_DIGEST',
  'INVALID',
]);

export const CASE_STATUSES = Object.freeze([
  'OPEN',
  'REVIEW_REQUIRED',
  'BLOCKED',
  'CLEARED',
  'CLOSED',
]);

export const ASSERTION_OPERATORS = Object.freeze([
  'equals',
  'notEquals',
  'in',
  'notIn',
  'exists',
  'notExists',
  'truthy',
  'falsy',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
]);

const DECISION_RANK = Object.freeze({
  ALLOW: 0,
  ALLOW_WITH_REPORTING: 1,
  REVIEW: 2,
  BLOCK: 3,
  NO_POLICY: 4,
});

const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

const DEFAULT_OPTIONS = Object.freeze({
  providerScope: 'AIRTEL',
  requireTenantId: true,
  requireJurisdiction: true,
  requirePolicyPack: true,
  maxRules: 500,
  maxFindings: 250,
  maxEvidencePaths: 100,
  maxPolicySourceRefs: 50,
  maxReasonLength: 600,
  defaultMissingEvidenceOutcome: 'REVIEW',
  defaultUnknownOutcome: 'REVIEW',
  allowedEnforcePolicyStatuses: Object.freeze(['ACTIVE']),
  allowedPreviewPolicyStatuses: Object.freeze(['ACTIVE', 'APPROVED']),
  allowedAdvisoryPolicyStatuses: Object.freeze(['DRAFT', 'APPROVED', 'ACTIVE']),
  staleEvidenceAfterMs: 24 * 60 * 60 * 1000,
  requireFreshEvidenceByDefault: false,
  makerCheckerRequiredForActivation: true,
  failClosedOnPolicyError: true,
  requireVerifiedPolicySourcesInEnforce: false,
  requirePolicyTenantMatchWhenPresent: true,
  requireNoticeIdentity: true,
  maxDecisionEvidencePaths: 250,
  maxPolicyDiffChanges: 2500,
  resolverTimeoutMs: 5000,
  sourceMonitorTimeoutMs: 5000,
});

// =============================================================================
// Errors
// =============================================================================

export class AirtelRegulatoryIntelligenceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AirtelRegulatoryIntelligenceError';
    this.code = options.code || 'AIRTEL_REGULATORY_INTELLIGENCE_ERROR';
    this.statusCode = options.statusCode || 500;
    this.details = Object.freeze({ ...(options.details || {}) });
    this.cause = options.cause || null;

    Error.captureStackTrace?.(this, AirtelRegulatoryIntelligenceError);
  }
}

// =============================================================================
// Primitive helpers
// =============================================================================

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepClone(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isPlainObject(value)) return value;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = deepClone(item);
  }
  return output;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function normalizeString(value, field, maxLength = 256, { allowEmpty = false } = {}) {
  if (value === null || value === undefined) {
    if (allowEmpty) return '';
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized && !allowEmpty) return null;

  if (normalized.length > maxLength) {
    throw new AirtelRegulatoryIntelligenceError(
      `${field} exceeds the maximum allowed length.`,
      {
        code: 'REGULATORY_FIELD_TOO_LONG',
        statusCode: 422,
        details: { field, maxLength },
      },
    );
  }

  return normalized;
}

function normalizeUpper(value, field, fallback = null, maxLength = 128) {
  const normalized = normalizeString(value, field, maxLength);
  return normalized ? normalized.toUpperCase() : fallback;
}

function normalizeIdentifier(value, field, maxLength = 256) {
  return normalizeString(value, field, maxLength);
}

function normalizeDate(value, field = 'date') {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AirtelRegulatoryIntelligenceError(`${field} must be a valid date.`, {
      code: 'REGULATORY_DATE_INVALID',
      statusCode: 422,
      details: { field },
    });
  }
  return date;
}

function nowDate(clock) {
  try {
    const value = typeof clock === 'function' ? clock() : Date.now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const FORBIDDEN_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function assertSafePath(path, field = 'path') {
  const normalized = normalizeIdentifier(path, field, 300);
  if (!normalized) {
    throw new AirtelRegulatoryIntelligenceError(
      `${field} is required.`,
      {
        code: 'REGULATORY_PATH_REQUIRED',
        statusCode: 422,
        details: { field },
      },
    );
  }

  const segments = normalized.split('.').filter(Boolean);
  if (!segments.length || segments.some(segment => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    throw new AirtelRegulatoryIntelligenceError(
      `${field} contains a forbidden path segment.`,
      {
        code: 'REGULATORY_PATH_UNSAFE',
        statusCode: 422,
        details: { field },
      },
    );
  }

  return normalized;
}

function sanitizeObjectKeys(value, depth = 0, maxDepth = 20) {
  if (depth > maxDepth) {
    throw new AirtelRegulatoryIntelligenceError(
      'Regulatory payload nesting exceeds the supported depth.',
      {
        code: 'REGULATORY_PAYLOAD_TOO_DEEP',
        statusCode: 422,
        details: { maxDepth },
      },
    );
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeObjectKeys(item, depth + 1, maxDepth));
  }

  if (!isPlainObject(value)) return deepClone(value);

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      throw new AirtelRegulatoryIntelligenceError(
        'Regulatory payload contains a forbidden object key.',
        {
          code: 'REGULATORY_OBJECT_KEY_UNSAFE',
          statusCode: 422,
          details: { key },
        },
      );
    }
    output[key] = sanitizeObjectKeys(item, depth + 1, maxDepth);
  }
  return output;
}

function getPath(source, path) {
  if (!source || !path) return { exists: false, value: undefined };

  const safePath = assertSafePath(path);
  const segments = safePath.split('.').filter(Boolean);
  let current = source;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return { exists: false, value: undefined };
    }

    if (
      (typeof current !== 'object' && typeof current !== 'function') ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { exists: false, value: undefined };
    }

    current = current[segment];
  }

  return { exists: true, value: current };
}

function setPath(target, path, value) {
  const safePath = assertSafePath(path);
  const segments = safePath.split('.').filter(Boolean);
  if (!segments.length) return target;

  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!isPlainObject(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
  return target;
}

function stableNormalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableNormalize(value[key]);
        return result;
      }, {});
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

function stableSerialize(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function normalizeList(value, field, maxItems = 100) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > maxItems) {
    throw new AirtelRegulatoryIntelligenceError(
      `${field} exceeds the maximum allowed item count.`,
      {
        code: 'REGULATORY_LIST_TOO_LARGE',
        statusCode: 422,
        details: { field, maxItems },
      },
    );
  }
  return list;
}

function normalizeEnum(value, field, allowed, fallback = null) {
  const normalized = normalizeUpper(value, field, fallback);
  if (!normalized) return fallback;
  if (!allowed.includes(normalized)) {
    throw new AirtelRegulatoryIntelligenceError(
      `${field} contains unsupported value.`,
      {
        code: 'REGULATORY_ENUM_INVALID',
        statusCode: 422,
        details: { field, value: normalized, allowed },
      },
    );
  }
  return normalized;
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;

  let negative = false;
  let unsigned = raw;
  if (unsigned.startsWith('-')) {
    negative = true;
    unsigned = unsigned.slice(1);
  }

  let [whole, fraction = ''] = unsigned.split('.');
  whole = whole.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');

  const canonical = fraction ? `${whole}.${fraction}` : whole;
  return negative && canonical !== '0' ? `-${canonical}` : canonical;
}

function decimalParts(value) {
  const normalized = normalizeMoney(value);
  if (normalized === null) return null;

  let text = normalized;
  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }

  let [whole, fraction = ''] = text.split('.');
  whole = whole.replace(/^0+(?=\d)/, '') || '0';
  fraction = fraction.replace(/0+$/, '');

  return { negative, whole, fraction };
}

function compareDecimal(a, b) {
  const left = decimalParts(a);
  const right = decimalParts(b);
  if (!left || !right) return null;

  if (left.negative !== right.negative) return left.negative ? -1 : 1;

  const sign = left.negative ? -1 : 1;
  if (left.whole.length !== right.whole.length) {
    return sign * (left.whole.length > right.whole.length ? 1 : -1);
  }
  if (left.whole !== right.whole) {
    return sign * (left.whole > right.whole ? 1 : -1);
  }

  const scale = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(scale, '0');
  const rightFraction = right.fraction.padEnd(scale, '0');

  if (leftFraction === rightFraction) return 0;
  return sign * (leftFraction > rightFraction ? 1 : -1);
}

function isMoneyLike(value) {
  return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function compareValues(actual, expected, operator) {
  switch (operator) {
    case 'equals': {
      if (isMoneyLike(actual) && isMoneyLike(expected)) {
        const comparison = compareDecimal(actual, expected);
        return comparison === 0;
      }
      return stableSerialize(actual) === stableSerialize(expected);
    }

    case 'notEquals':
      return !compareValues(actual, expected, 'equals');

    case 'in':
      return Array.isArray(expected)
        ? expected.some(item => compareValues(actual, item, 'equals'))
        : false;

    case 'notIn':
      return !compareValues(actual, expected, 'in');

    case 'exists':
      return Boolean(actual?.__exists);

    case 'notExists':
      return !Boolean(actual?.__exists);

    case 'truthy':
      return Boolean(actual);

    case 'falsy':
      return !Boolean(actual);

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const comparison = isMoneyLike(actual) && isMoneyLike(expected)
        ? compareDecimal(actual, expected)
        : (() => {
            const left = finiteNumber(actual, null);
            const right = finiteNumber(expected, null);

            if (left === null || right === null) return null;

            return left === right
              ? 0
              : left > right
                ? 1
                : -1;
          })();

      if (comparison === null) return null;

      if (operator === 'gt') return comparison > 0;
      if (operator === 'gte') return comparison >= 0;
      if (operator === 'lt') return comparison < 0;

      return comparison <= 0;
    }

    case 'between': {
      if (!Array.isArray(expected) || expected.length !== 2) return null;

      const lower = compareValues(actual, expected[0], 'gte');
      const upper = compareValues(actual, expected[1], 'lte');

      if (lower === null || upper === null) return null;

      return lower && upper;
    }

    case 'contains':
      if (typeof actual === 'string') {
        return actual.includes(String(expected));
      }

      if (Array.isArray(actual)) {
        return actual.some(item => compareValues(item, expected, 'equals'));
      }

      return false;

    case 'notContains':
      return !compareValues(actual, expected, 'contains');

    case 'startsWith':
      return typeof actual === 'string' &&
        actual.startsWith(String(expected));

    case 'endsWith':
      return typeof actual === 'string' &&
        actual.endsWith(String(expected));

    default:
      return null;
  }
}

function sanitizeReason(value, maxLength = 600) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeProvider(value, fallback = 'AIRTEL') {
  return normalizeUpper(value, 'provider', fallback, 80);
}

function normalizeJurisdiction(value) {
  return normalizeUpper(value, 'jurisdiction', null, 80);
}

function normalizeOperation(value) {
  return normalizeEnum(value, 'operation', OPERATIONS, 'COLLECTION');
}

function normalizeMode(value) {
  return normalizeEnum(value, 'mode', EVALUATION_MODES, 'ENFORCE');
}

function normalizeControlFamily(value) {
  return normalizeEnum(value, 'controlFamily', CONTROL_FAMILIES, 'OTHER');
}

function normalizeSeverity(value, fallback = 'MEDIUM') {
  return normalizeEnum(value, 'severity', SEVERITIES, fallback);
}

function normalizeOutcome(value, fallback = 'REVIEW') {
  return normalizeEnum(value, 'outcome', RULE_OUTCOMES, fallback);
}

function normalizePolicyStatus(value, fallback = 'DRAFT') {
  return normalizeEnum(value, 'policy.status', POLICY_STATUSES, fallback);
}

function safeError(error) {
  if (!error) return null;

  return {
    name: error.name || 'Error',
    code: error.code || null,
    message: sanitizeReason(error.message || 'Unknown error', 400),
  };
}

function normalizeSet(value, field) {
  return new Set(
    normalizeList(value, field, 100)
      .map(item => String(item).trim().toUpperCase())
      .filter(Boolean),
  );
}

function matchesSelector(value, configured) {
  const selectors = Array.from(
    normalizeSet(configured, 'selector'),
  );

  if (!selectors.length || selectors.includes('*')) return true;
  if (value === null || value === undefined) return false;

  return selectors.includes(
    String(value).trim().toUpperCase(),
  );
}

function normalizeApplicability(applicability = {}) {
  if (!isPlainObject(applicability)) {
    throw new AirtelRegulatoryIntelligenceError(
      'Rule applicability must be a plain object.',
      {
        code: 'REGULATORY_RULE_APPLICABILITY_INVALID',
        statusCode: 422,
      },
    );
  }

  return deepFreeze({
    providers: normalizeList(
      applicability.providers,
      'applicability.providers',
      20,
    )
      .map(value => normalizeProvider(value, null))
      .filter(Boolean),

    jurisdictions: normalizeList(
      applicability.jurisdictions,
      'applicability.jurisdictions',
      50,
    )
      .map(value => normalizeJurisdiction(value))
      .filter(Boolean),

    operations: normalizeList(
      applicability.operations,
      'applicability.operations',
      20,
    )
      .map(value => normalizeOperation(value))
      .filter(Boolean),

    countries: normalizeList(
      applicability.countries,
      'applicability.countries',
      50,
    )
      .map(value => normalizeUpper(
        value,
        'applicability.country',
        null,
        8,
      ))
      .filter(Boolean),

    channels: normalizeList(
      applicability.channels,
      'applicability.channels',
      50,
    )
      .map(value => normalizeUpper(
        value,
        'applicability.channel',
        null,
        80,
      ))
      .filter(Boolean),

    currencies: normalizeList(
      applicability.currencies,
      'applicability.currencies',
      50,
    )
      .map(value => normalizeUpper(
        value,
        'applicability.currency',
        null,
        10,
      ))
      .filter(Boolean),

    productTypes: normalizeList(
      applicability.productTypes,
      'applicability.productTypes',
      50,
    )
      .map(value => normalizeUpper(
        value,
        'applicability.productType',
        null,
        80,
      ))
      .filter(Boolean),
  });
}

function normalizeSourceRef(value) {
  if (!isPlainObject(value)) {
    throw new AirtelRegulatoryIntelligenceError(
      'Policy source reference must be a plain object.',
      {
        code: 'REGULATORY_SOURCE_REFERENCE_INVALID',
        statusCode: 422,
      },
    );
  }

  const sourceUri = normalizeString(
    value.sourceUri,
    'source.sourceUri',
    2000,
  );

  const documentDigest = normalizeIdentifier(
    value.documentDigest,
    'source.documentDigest',
    128,
  );

  return {
    authority: normalizeString(
      value.authority,
      'source.authority',
      200,
    ),
    title: normalizeString(
      value.title,
      'source.title',
      300,
    ),
    identifier: normalizeIdentifier(
      value.identifier,
      'source.identifier',
      256,
    ),
    publishedAt: normalizeDate(
      value.publishedAt,
      'source.publishedAt',
    ),
    effectiveAt: normalizeDate(
      value.effectiveAt,
      'source.effectiveAt',
    ),
    sourceUri,
    documentDigest,
    verificationStatus: documentDigest
      ? 'VERIFIED'
      : sourceUri
        ? 'MISSING_DIGEST'
        : 'UNVERIFIED',
  };
}

function normalizeRequiredEvidence(value, maxEntries = 50) {
  return normalizeList(
    value,
    'requiredEvidence',
    maxEntries,
  )
    .map(item => assertSafePath(
      item,
      'requiredEvidence.path',
    ))
    .filter(Boolean);
}

function normalizeAssertion(assertion, index) {
  if (!isPlainObject(assertion)) {
    throw new AirtelRegulatoryIntelligenceError(
      `Rule assertion ${index} must be a plain object.`,
      {
        code: 'REGULATORY_ASSERTION_INVALID',
        statusCode: 422,
        details: { index },
      },
    );
  }

  const path = assertSafePath(
    assertion.path,
    `assertions[${index}].path`,
  );

  const operator = String(
    assertion.operator || '',
  ).trim();

  if (!path) {
    throw new AirtelRegulatoryIntelligenceError(
      `Rule assertion ${index} requires path.`,
      {
        code: 'REGULATORY_ASSERTION_PATH_REQUIRED',
        statusCode: 422,
        details: { index },
      },
    );
  }

  if (!ASSERTION_OPERATORS.includes(operator)) {
    throw new AirtelRegulatoryIntelligenceError(
      `Unsupported regulatory assertion operator: ${operator}.`,
      {
        code: 'REGULATORY_ASSERTION_OPERATOR_INVALID',
        statusCode: 422,
        details: {
          index,
          operator,
          supportedOperators: ASSERTION_OPERATORS,
        },
      },
    );
  }

  return {
    path,
    operator,
    value: deepClone(assertion.value),
    unknownOutcome: normalizeOutcome(
      assertion.unknownOutcome,
      'REVIEW',
    ),
    description: sanitizeReason(
      assertion.description || '',
      400,
    ),
  };
}

function normalizeRule(rule, index) {
  if (!isPlainObject(rule)) {
    throw new AirtelRegulatoryIntelligenceError(
      `Regulatory rule ${index} must be a plain object.`,
      {
        code: 'REGULATORY_RULE_INVALID',
        statusCode: 422,
        details: { index },
      },
    );
  }

  const ruleId = normalizeIdentifier(
    rule.ruleId ?? rule.id,
    `rules[${index}].ruleId`,
    200,
  );

  if (!ruleId) {
    throw new AirtelRegulatoryIntelligenceError(
      `Regulatory rule ${index} requires ruleId.`,
      {
        code: 'REGULATORY_RULE_ID_REQUIRED',
        statusCode: 422,
        details: { index },
      },
    );
  }

  const version = normalizeIdentifier(
    rule.version ?? '1.0.0',
    `rules[${index}].version`,
    80,
  );

  const status = normalizePolicyStatus(
    rule.status,
    'ACTIVE',
  );

  const severity = normalizeSeverity(
    rule.severity,
    'MEDIUM',
  );

  const failureOutcome = normalizeOutcome(
    rule.failureOutcome,
    'REVIEW',
  );

  const unknownOutcome = normalizeOutcome(
    rule.unknownOutcome,
    'REVIEW',
  );

  const assertionsInput = normalizeList(
    rule.assertions ?? rule.conditions,
    `rules[${index}].assertions`,
    50,
  );

  const assertions = assertionsInput.map(
    (assertion, assertionIndex) =>
      normalizeAssertion(assertion, assertionIndex),
  );

  const requiredEvidence = normalizeRequiredEvidence(
    rule.requiredEvidence,
    50,
  );

  const appliesWhen = normalizeList(
    rule.appliesWhen,
    `rules[${index}].appliesWhen`,
    50,
  ).map(
    (assertion, assertionIndex) =>
      normalizeAssertion(assertion, assertionIndex),
  );

  const effectiveFrom = normalizeDate(
    rule.effectiveFrom,
    `rules[${index}].effectiveFrom`,
  );

  const effectiveTo = normalizeDate(
    rule.effectiveTo,
    `rules[${index}].effectiveTo`,
  );

  if (
    effectiveFrom &&
    effectiveTo &&
    effectiveTo < effectiveFrom
  ) {
    throw new AirtelRegulatoryIntelligenceError(
      `Regulatory rule ${ruleId} has an invalid effective window.`,
      {
        code: 'REGULATORY_RULE_EFFECTIVE_WINDOW_INVALID',
        statusCode: 422,
        details: { ruleId },
      },
    );
  }

  return {
    ruleId,
    version,
    title: sanitizeReason(
      rule.title || ruleId,
      300,
    ),
    description: sanitizeReason(
      rule.description || '',
      1000,
    ),
    controlFamily: normalizeControlFamily(
      rule.controlFamily,
    ),
    severity,
    mandatory: rule.mandatory !== false,
    failureOutcome,
    unknownOutcome,
    status,
    effectiveFrom,
    effectiveTo,
    applicability: normalizeApplicability(
      rule.applicability || {},
    ),
    appliesWhen,
    requiredEvidence,
    assertions,
    sourceRefs: normalizeList(
      rule.sourceRefs,
      'rule.sourceRefs',
      20,
    ).map(normalizeSourceRef),
    owner: normalizeIdentifier(
      rule.owner,
      'rule.owner',
      200,
    ),
    remediationHint: sanitizeReason(
      rule.remediationHint || '',
      800,
    ),
    evidenceFreshnessMs: finiteNumber(
      rule.evidenceFreshnessMs,
      null,
    ),
    requiresFreshEvidence:
      rule.requiresFreshEvidence === true,
    metadata: isPlainObject(rule.metadata)
      ? deepClone(rule.metadata)
      : {},
  };
}

function normalizePolicyPack(
  policyPack,
  {
    now = new Date(),
    maxRules = 500,
    maxSourceRefs = 50,
  } = {},
) {
  if (!isPlainObject(policyPack)) {
    throw new AirtelRegulatoryIntelligenceError(
      'policyPack must be a plain object.',
      {
        code: 'REGULATORY_POLICY_PACK_INVALID',
        statusCode: 422,
      },
    );
  }

  const packId = normalizeIdentifier(
    policyPack.packId ?? policyPack.id,
    'policyPack.packId',
    200,
  );

  const version = normalizeIdentifier(
    policyPack.version ?? '1.0.0',
    'policyPack.version',
    80,
  );

  const tenantId = normalizeIdentifier(
    policyPack.tenantId ?? policyPack.tenant?.id,
    'policyPack.tenantId',
    128,
  );

  const jurisdiction = normalizeJurisdiction(
    policyPack.jurisdiction,
  );

  const provider = normalizeProvider(
    policyPack.provider,
    'AIRTEL',
  );

  const status = normalizePolicyStatus(
    policyPack.status,
    'DRAFT',
  );

  const effectiveFrom = normalizeDate(
    policyPack.effectiveFrom,
    'policyPack.effectiveFrom',
  );

  const effectiveTo = normalizeDate(
    policyPack.effectiveTo,
    'policyPack.effectiveTo',
  );

  if (!packId || !jurisdiction) {
    throw new AirtelRegulatoryIntelligenceError(
      'policyPack.packId and policyPack.jurisdiction are required.',
      {
        code: 'REGULATORY_POLICY_PACK_IDENTITY_REQUIRED',
        statusCode: 422,
      },
    );
  }

  if (
    effectiveFrom &&
    effectiveTo &&
    effectiveTo < effectiveFrom
  ) {
    throw new AirtelRegulatoryIntelligenceError(
      'Policy pack effectiveTo cannot be earlier than effectiveFrom.',
      {
        code: 'REGULATORY_POLICY_PACK_EFFECTIVE_WINDOW_INVALID',
        statusCode: 422,
      },
    );
  }

  const rulesInput = normalizeList(
    policyPack.rules,
    'policyPack.rules',
    maxRules,
  );

  if (rulesInput.length > maxRules) {
    throw new AirtelRegulatoryIntelligenceError(
      'Policy pack has too many rules.',
      {
        code: 'REGULATORY_POLICY_PACK_TOO_MANY_RULES',
        statusCode: 422,
        details: { maxRules },
      },
    );
  }

  const sourceRefs = normalizeList(
    policyPack.sourceRefs,
    'policyPack.sourceRefs',
    maxSourceRefs,
  ).map(normalizeSourceRef);

  const normalizedRules = rulesInput.map(
    (rule, index) =>
      normalizeRule(rule, index),
  );

  const duplicateRuleIds = normalizedRules
    .map(rule => rule.ruleId)
    .filter(
      (ruleId, index, all) =>
        all.indexOf(ruleId) !== index,
    );

  if (duplicateRuleIds.length) {
    throw new AirtelRegulatoryIntelligenceError(
      'Policy pack contains duplicate rule identifiers.',
      {
        code: 'REGULATORY_POLICY_DUPLICATE_RULE_ID',
        statusCode: 422,
        details: {
          ruleIds: [
            ...new Set(duplicateRuleIds),
          ],
        },
      },
    );
  }

  const normalized = {
    packId,
    version,
    tenantId,
    jurisdiction,
    provider,
    status,
    title: sanitizeReason(
      policyPack.title || packId,
      300,
    ),
    description: sanitizeReason(
      policyPack.description || '',
      1200,
    ),
    authority: normalizeString(
      policyPack.authority,
      'policyPack.authority',
      300,
    ),
    effectiveFrom,
    effectiveTo,
    approvedAt: normalizeDate(
      policyPack.approvedAt,
      'policyPack.approvedAt',
    ),
    approvedBy: normalizeIdentifier(
      policyPack.approvedBy,
      'policyPack.approvedBy',
      256,
    ),
    supersedes: normalizeIdentifier(
      policyPack.supersedes,
      'policyPack.supersedes',
      200,
    ),
    sourceRefs,
    rules: normalizedRules,
    metadata: isPlainObject(policyPack.metadata)
      ? deepClone(policyPack.metadata)
      : {},
  };

  if (
    normalized.status === 'ACTIVE' &&
    !normalized.approvedAt
  ) {
    normalized.metadata.governanceApprovalMetadataMissing = true;
  }

  normalized.policyFingerprint = sha256({
    packId: normalized.packId,
    version: normalized.version,
    tenantId: normalized.tenantId,
    jurisdiction: normalized.jurisdiction,
    provider: normalized.provider,
    status: normalized.status,
    effectiveFrom:
      normalized.effectiveFrom?.toISOString() || null,
    effectiveTo:
      normalized.effectiveTo?.toISOString() || null,
    authority: normalized.authority,
    sourceRefs: normalized.sourceRefs,
    rules: normalized.rules,
  });

  if (policyPack.policyFingerprint) {
    const suppliedFingerprint = normalizeIdentifier(
      policyPack.policyFingerprint,
      'policyPack.policyFingerprint',
      128,
    );

    if (
      suppliedFingerprint !==
      normalized.policyFingerprint
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'Supplied policy fingerprint does not match the normalized policy content.',
        {
          code: 'REGULATORY_POLICY_FINGERPRINT_MISMATCH',
          statusCode: 409,
          details: {
            packId: normalized.packId,
            version: normalized.version,
          },
        },
      );
    }
  }

  normalized.effectiveNow =
    (!effectiveFrom || now >= effectiveFrom) &&
    (!effectiveTo || now <= effectiveTo);

  return deepFreeze(normalized);
}

function policyApplies(rule, context) {
  const applicability = rule.applicability || {};

  if (
    !matchesSelector(
      context.provider,
      applicability.providers,
    )
  ) {
    return false;
  }

  if (
    !matchesSelector(
      context.jurisdiction,
      applicability.jurisdictions,
    )
  ) {
    return false;
  }

  if (
    !matchesSelector(
      context.operation,
      applicability.operations,
    )
  ) {
    return false;
  }

  if (
    !matchesSelector(
      context.country,
      applicability.countries,
    )
  ) {
    return false;
  }

  if (
    !matchesSelector(
      context.channel,
      applicability.channels,
    )
  ) {
    return false;
  }

  if (
    !matchesSelector(
      context.currency,
      applicability.currencies,
    )
  ) {
    return false;
  }

  if (
    !matchesSelector(
      context.productType,
      applicability.productTypes,
    )
  ) {
    return false;
  }

  return true;
}

function normalizeEvidenceEnvelope(evidence = {}) {
  if (!isPlainObject(evidence)) {
    throw new AirtelRegulatoryIntelligenceError(
      'evidence must be a plain object.',
      {
        code: 'REGULATORY_EVIDENCE_INVALID',
        statusCode: 422,
      },
    );
  }

  return sanitizeObjectKeys(evidence);
}

function sanitizeSensitivePath(path) {
  const normalized = String(path || '')
    .trim()
    .toLowerCase();

  const sensitiveTerms = [
    'password',
    'passwd',
    'secret',
    'apikey',
    'api_key',
    'access_token',
    'refresh_token',
    'authorization',
    'cookie',
    'pin',
    'otp',
    'cvv',
    'cvc',
    'pan',
    'cardnumber',
  ];

  return sensitiveTerms.some(
    term => normalized.includes(term),
  );
}

function digestSensitiveValue(value) {
  return sha256({
    value: stableNormalize(value),
  }).slice(0, 32);
}

function evidenceMetadata(
  path,
  value,
  exists,
  observedAt = null,
) {
  return {
    path,
    exists,
    observed: exists,
    valueDigest: exists
      ? digestSensitiveValue(value)
      : null,
    observedAt: observedAt
      ? new Date(observedAt).toISOString()
      : null,
  };
}

function getEvidenceTimestamp(
  evidence,
  path,
) {
  const direct = getPath(
    evidence,
    `${path}.observedAt`,
  );

  if (direct.exists && direct.value) {
    return normalizeDate(
      direct.value,
      `${path}.observedAt`,
    );
  }

  const root = getPath(
    evidence,
    path,
  );

  if (
    root.exists &&
    isPlainObject(root.value) &&
    root.value.observedAt
  ) {
    return normalizeDate(
      root.value.observedAt,
      `${path}.observedAt`,
    );
  }

  return null;
}

function extractEvidenceValue(
  evidence,
  path,
) {
  const found = getPath(
    evidence,
    path,
  );

  if (!found.exists) {
    return {
      exists: false,
      value: undefined,
    };
  }

  if (
    isPlainObject(found.value) &&
    Object.prototype.hasOwnProperty.call(
      found.value,
      'value',
    )
  ) {
    return {
      exists: true,
      value: found.value.value,
    };
  }

  return {
    exists: true,
    value: found.value,
  };
}

function evaluateAssertion(
  assertion,
  evidence,
) {
  const found = extractEvidenceValue(
    evidence,
    assertion.path,
  );

  if (!found.exists) {
    if (
      ['exists', 'notExists'].includes(
        assertion.operator,
      )
    ) {
      const wrapped = {
        __exists: false,
      };

      return {
        result: Boolean(
          compareValues(
            wrapped,
            assertion.value,
            assertion.operator,
          ),
        ),
        state: 'EVALUATED',
        exists: false,
        value: undefined,
      };
    }

    return {
      result: null,
      state: 'UNKNOWN',
      exists: false,
      value: undefined,
    };
  }

  if (
    assertion.operator === 'exists' ||
    assertion.operator === 'notExists'
  ) {
    const wrapped = {
      __exists: found.exists,
    };

    return {
      result: Boolean(
        compareValues(
          wrapped,
          assertion.value,
          assertion.operator,
        ),
      ),
      state: 'EVALUATED',
      exists: true,
      value: found.value,
    };
  }

  const result = compareValues(
    found.value,
    assertion.value,
    assertion.operator,
  );

  if (result === null) {
    return {
      result: null,
      state: 'UNKNOWN',
      exists: true,
      value: found.value,
    };
  }

  return {
    result: Boolean(result),
    state: 'EVALUATED',
    exists: true,
    value: found.value,
  };
}

function assertionFingerprint(assertion) {
  return sha256({
    path: assertion.path,
    operator: assertion.operator,
    value: assertion.value,
    unknownOutcome: assertion.unknownOutcome,
  });
}

function ruleFingerprint(rule) {
  return sha256({
    ruleId: rule.ruleId,
    version: rule.version,
    title: rule.title,
    controlFamily: rule.controlFamily,
    severity: rule.severity,
    mandatory: rule.mandatory,
    failureOutcome: rule.failureOutcome,
    unknownOutcome: rule.unknownOutcome,
    status: rule.status,
    effectiveFrom:
      rule.effectiveFrom?.toISOString() || null,
    effectiveTo:
      rule.effectiveTo?.toISOString() || null,
    applicability: rule.applicability,
    appliesWhen: rule.appliesWhen,
    requiredEvidence: rule.requiredEvidence,
    assertions: rule.assertions.map(
      assertion => assertionFingerprint(assertion),
    ),
    sourceRefs: rule.sourceRefs,
    owner: rule.owner,
    remediationHint: rule.remediationHint,
    evidenceFreshnessMs:
      rule.evidenceFreshnessMs,
  });
}

function decisionFromFindings(
  findings,
  policyAvailable,
) {
  if (!policyAvailable) return 'NO_POLICY';

  let decision = 'ALLOW';

  for (const finding of findings) {
    if (
      finding.outcome === 'BLOCK' ||
      finding.blocksPayment === true
    ) {
      return 'BLOCK';
    }

    if (
      finding.outcome === 'REVIEW' ||
      finding.outcome === 'REQUIRE_EVIDENCE'
    ) {
      decision = 'REVIEW';
      continue;
    }

    if (
      finding.outcome === 'REPORT' &&
      decision === 'ALLOW'
    ) {
      decision = 'ALLOW_WITH_REPORTING';
    }
  }

  return decision;
}

function highestSeverity(findings) {
  let result = 'INFO';

  for (const finding of findings) {
    if (
      (SEVERITY_RANK[finding.severity] ?? 0) >
      (SEVERITY_RANK[result] ?? 0)
    ) {
      result = finding.severity;
    }
  }

  return result;
}

function confidenceForEvaluation({
  policyAvailable,
  findings,
  applicableRuleCount,
  evaluatedRuleCount,
}) {
  if (!policyAvailable) return 0;
  if (applicableRuleCount === 0) return 0.25;

  const coverage = clamp(
    evaluatedRuleCount /
      applicableRuleCount,
  );

  let confidence =
    0.50 +
    coverage * 0.45;

  if (
    findings.some(
      item => item.result === 'UNKNOWN',
    )
  ) {
    confidence -= 0.20;
  }

  if (
    findings.some(
      item => item.conflict === true,
    )
  ) {
    confidence -= 0.30;
  }

  if (
    findings.some(
      item => item.severity === 'CRITICAL',
    )
  ) {
    confidence -= 0.20;
  }

  return Number(
    clamp(confidence).toFixed(4),
  );
}

function buildFinding({
  code,
  rule,
  result,
  outcome,
  severity,
  reason,
  evidence = [],
  remediation = null,
  conflict = false,
  blocksPayment = false,
}) {
  const sourceRefs = (
    rule?.sourceRefs || []
  ).map(source => ({
    authority: source.authority || null,
    identifier: source.identifier || null,
    title: source.title || null,
    sourceUri: source.sourceUri || null,
  }));

  return {
    findingId: sha256({
      code,
      ruleId: rule?.ruleId || null,
      ruleVersion: rule?.version || null,
      result,
      outcome,
      evidence,
    }).slice(0, 32),

    code,
    ruleId: rule?.ruleId || null,
    ruleVersion: rule?.version || null,
    controlFamily:
      rule?.controlFamily || 'OTHER',

    result,
    outcome,
    severity,
    mandatory:
      rule?.mandatory !== false,

    reason: sanitizeReason(reason),
    evidence,

    remediation: sanitizeReason(
      remediation ||
      rule?.remediationHint ||
      '',
      800,
    ) || null,

    conflict: Boolean(conflict),
    blocksPayment:
      Boolean(blocksPayment),

    sourceRefs,
  };
}

function summarizeFinding(findings) {
  return Object.freeze({
    total: findings.length,

    pass: findings.filter(
      item => item.result === 'PASS',
    ).length,

    fail: findings.filter(
      item => item.result === 'FAIL',
    ).length,

    unknown: findings.filter(
      item => item.result === 'UNKNOWN',
    ).length,

    notApplicable: findings.filter(
      item => item.result === 'NOT_APPLICABLE',
    ).length,

    errors: findings.filter(
      item => item.result === 'ERROR',
    ).length,

    blocks: findings.filter(
      item => item.outcome === 'BLOCK',
    ).length,

    reviews: findings.filter(
      item =>
        item.outcome === 'REVIEW' ||
        item.outcome === 'REPORT' ||
        item.outcome === 'REQUIRE_EVIDENCE',
    ).length,
  });
}

function normalizeActor(actor = {}) {
  if (!isPlainObject(actor)) return null;

  const actorId = normalizeIdentifier(
    actor.actorId ??
      actor.userId ??
      actor.id,
    'actor.actorId',
    256,
  );

  const actorType = normalizeUpper(
    actor.actorType,
    'actor.actorType',
    'SYSTEM',
    80,
  );

  const role = normalizeUpper(
    actor.role,
    'actor.role',
    null,
    120,
  );

  const tenantId = normalizeIdentifier(
    actor.tenantId ??
      actor.tenant?.id,
    'actor.tenantId',
    128,
  );

  return {
    actorId: actorId || null,
    actorType,
    ...(role ? { role } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}

function normalizeApproval(approval = {}) {
  if (!isPlainObject(approval)) return null;

  const approvalId = normalizeIdentifier(
    approval.approvalId,
    'approval.approvalId',
    256,
  );

  const approverId = normalizeIdentifier(
    approval.approverId,
    'approval.approverId',
    256,
  );

  const decision = normalizeUpper(
    approval.decision,
    'approval.decision',
    null,
    40,
  );

  const scopeFingerprint = normalizeIdentifier(
    approval.scopeFingerprint,
    'approval.scopeFingerprint',
    128,
  );

  return (
    approvalId ||
    approverId ||
    decision
  )
    ? {
        approvalId,
        approverId,
        approved:
          approval.approved === true,
        decision,
        approvedAt:
          normalizeDate(
            approval.approvedAt,
            'approval.approvedAt',
          ),
        scopeFingerprint,
      }
    : null;
}

function noticeFingerprint(notice) {
  return sha256({
    authority: notice.authority,
    jurisdiction:
      notice.jurisdiction,
    identifier:
      notice.identifier,
    title: notice.title,
    publishedAt:
      notice.publishedAt?.toISOString() ||
      null,
    effectiveAt:
      notice.effectiveAt?.toISOString() ||
      null,
    sourceUri: notice.sourceUri,
    documentDigest:
      notice.documentDigest,
  });
}

function normalizeNotice(notice) {
  if (!isPlainObject(notice)) {
    throw new AirtelRegulatoryIntelligenceError(
      'Regulatory notice must be a plain object.',
      {
        code: 'REGULATORY_NOTICE_INVALID',
        statusCode: 422,
      },
    );
  }

  const noticeId = normalizeIdentifier(
    notice.noticeId ?? notice.id,
    'notice.noticeId',
    256,
  );

  const authority = normalizeString(
    notice.authority,
    'notice.authority',
    300,
  );

  const jurisdiction =
    normalizeJurisdiction(
      notice.jurisdiction,
    );

  const identifier =
    normalizeIdentifier(
      notice.identifier,
      'notice.identifier',
      256,
    );

  const title = normalizeString(
    notice.title,
    'notice.title',
    400,
  );

  const publishedAt = normalizeDate(
    notice.publishedAt,
    'notice.publishedAt',
  );

  const effectiveAt = normalizeDate(
    notice.effectiveAt,
    'notice.effectiveAt',
  );

  if (
    !noticeId ||
    !authority ||
    !jurisdiction ||
    !title
  ) {
    throw new AirtelRegulatoryIntelligenceError(
      'Regulatory notice requires noticeId, authority, jurisdiction and title.',
      {
        code:
          'REGULATORY_NOTICE_IDENTITY_REQUIRED',
        statusCode: 422,
      },
    );
  }

  if (
    effectiveAt &&
    publishedAt &&
    effectiveAt < publishedAt
  ) {
    throw new AirtelRegulatoryIntelligenceError(
      'Regulatory notice effectiveAt cannot be earlier than publishedAt.',
      {
        code:
          'REGULATORY_NOTICE_EFFECTIVE_DATE_INVALID',
        statusCode: 422,
      },
    );
  }

  const sourceUri = normalizeString(
    notice.sourceUri,
    'notice.sourceUri',
    2000,
  );

  const documentDigest =
    normalizeIdentifier(
      notice.documentDigest,
      'notice.documentDigest',
      128,
    );

  const normalized = {
    noticeId,
    authority,
    jurisdiction,
    identifier,
    title,

    summary: sanitizeReason(
      notice.summary || '',
      1500,
    ),

    publishedAt,
    effectiveAt,
    sourceUri,
    documentDigest,

    sourceVerificationStatus:
      documentDigest
        ? 'VERIFIED'
        : sourceUri
          ? 'MISSING_DIGEST'
          : 'UNVERIFIED',

    status: normalizeEnum(
      notice.status,
      'notice.status',
      NOTICE_STATUSES,
      'NEW',
    ),

    affectedProducts:
      normalizeList(
        notice.affectedProducts,
        'notice.affectedProducts',
        50,
      )
        .map(value =>
          normalizeUpper(
            value,
            'notice.affectedProduct',
            null,
            100,
          ),
        )
        .filter(Boolean),

    affectedOperations:
      normalizeList(
        notice.affectedOperations,
        'notice.affectedOperations',
        20,
      )
        .map(value =>
          normalizeOperation(value),
        )
        .filter(Boolean),

    metadata:
      isPlainObject(notice.metadata)
        ? deepClone(notice.metadata)
        : {},
  };

  normalized.noticeFingerprint =
    noticeFingerprint(
      normalized,
    );

  if (notice.noticeFingerprint) {
    const suppliedFingerprint =
      normalizeIdentifier(
        notice.noticeFingerprint,
        'notice.noticeFingerprint',
        128,
      );

    if (
      suppliedFingerprint !==
      normalized.noticeFingerprint
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'Supplied notice fingerprint does not match the normalized notice content.',
        {
          code:
            'REGULATORY_NOTICE_FINGERPRINT_MISMATCH',
          statusCode: 409,
          details: {
            noticeId:
              normalized.noticeId,
          },
        },
      );
    }
  }

  return deepFreeze(normalized);
}

function normalizeContext(input = {}) {
  if (!isPlainObject(input)) {
    throw new AirtelRegulatoryIntelligenceError(
      'Regulatory intelligence input must be a plain object.',
      {
        code: 'REGULATORY_INPUT_INVALID',
        statusCode: 422,
      },
    );
  }

  return {
    tenantId: normalizeIdentifier(
      input.tenantId,
      'tenantId',
      128,
    ),

    provider: normalizeProvider(
      input.provider,
      'AIRTEL',
    ),

    operation: normalizeOperation(
      input.operation,
    ),

    jurisdiction:
      normalizeJurisdiction(
        input.jurisdiction,
      ),

    country: normalizeUpper(
      input.country,
      'country',
      null,
      8,
    ),

    channel: normalizeUpper(
      input.channel,
      'channel',
      null,
      80,
    ),

    currency: normalizeUpper(
      input.currency,
      'currency',
      null,
      10,
    ),

    productType: normalizeUpper(
      input.productType,
      'productType',
      null,
      100,
    ),

    mode: normalizeMode(
      input.mode,
    ),

    requestId: normalizeIdentifier(
      input.requestId,
      'requestId',
      256,
    ),

    correlationId:
      normalizeIdentifier(
        input.correlationId,
        'correlationId',
        256,
      ),

    idempotencyKey:
      normalizeIdentifier(
        input.idempotencyKey,
        'idempotencyKey',
        255,
      ),

    actor: normalizeActor(
      input.actor,
    ),

    approval: normalizeApproval(
      input.approval,
    ),

    transaction:
      isPlainObject(input.transaction)
        ? sanitizeObjectKeys(
            input.transaction,
          )
        : {},

    evidence:
      normalizeEvidenceEnvelope(
        input.evidence ??
          input.complianceEvidence ??
          {},
      ),

    context:
      isPlainObject(input.context)
        ? sanitizeObjectKeys(
            input.context,
          )
        : {},
  };
}

// =============================================================================
// Enterprise regulatory intelligence engine
// =============================================================================

export class AirtelRegulatoryIntelligence {
  constructor(options = {}) {
    const supplied = isPlainObject(options)
      ? options
      : {};

    const merged = {
      ...DEFAULT_OPTIONS,
      ...supplied,
    };

    const providerScope =
      normalizeProvider(
        merged.providerScope,
        'AIRTEL',
      );

    if (providerScope !== 'AIRTEL') {
      throw new AirtelRegulatoryIntelligenceError(
        'This engine is scoped to AIRTEL by default; use an explicit provider-specific engine for another provider.',
        {
          code:
            'REGULATORY_PROVIDER_SCOPE_INVALID',
          statusCode: 500,
          details: {
            providerScope,
          },
        },
      );
    }

    const maxRules =
      Math.min(
        5000,
        Math.max(
          1,
          Math.trunc(
            finiteNumber(
              merged.maxRules,
              DEFAULT_OPTIONS.maxRules,
            ),
          ),
        ),
      );

    const maxFindings =
      Math.min(
        5000,
        Math.max(
          1,
          Math.trunc(
            finiteNumber(
              merged.maxFindings,
              DEFAULT_OPTIONS.maxFindings,
            ),
          ),
        ),
      );

    const maxEvidencePaths =
      Math.min(
        1000,
        Math.max(
          1,
          Math.trunc(
            finiteNumber(
              merged.maxEvidencePaths,
              DEFAULT_OPTIONS.maxEvidencePaths,
            ),
          ),
        ),
      );

    const maxDecisionEvidencePaths =
      Math.min(
        1000,
        Math.max(
          1,
          Math.trunc(
            finiteNumber(
              merged.maxDecisionEvidencePaths,
              DEFAULT_OPTIONS.maxDecisionEvidencePaths,
            ),
          ),
        ),
      );

    const maxPolicyDiffChanges =
      Math.min(
        10000,
        Math.max(
          1,
          Math.trunc(
            finiteNumber(
              merged.maxPolicyDiffChanges,
              DEFAULT_OPTIONS.maxPolicyDiffChanges,
            ),
          ),
        ),
      );

    const staleEvidenceAfterMs =
      Math.max(
        0,
        Math.trunc(
          finiteNumber(
            merged.staleEvidenceAfterMs,
            DEFAULT_OPTIONS.staleEvidenceAfterMs,
          ),
        ),
      );

    this.config = deepFreeze({
      ...merged,

      providerScope,

      maxRules,
      maxFindings,
      maxEvidencePaths,
      maxDecisionEvidencePaths,
      maxPolicyDiffChanges,

      staleEvidenceAfterMs,

      maxReasonLength:
        Math.min(
          2000,
          Math.max(
            50,
            Math.trunc(
              finiteNumber(
                merged.maxReasonLength,
                DEFAULT_OPTIONS.maxReasonLength,
              ),
            ),
          ),
        ),

      allowedEnforcePolicyStatuses:
        Object.freeze(
          normalizeList(
            merged.allowedEnforcePolicyStatuses,
            'allowedEnforcePolicyStatuses',
            20,
          )
            .map(value =>
              normalizePolicyStatus(value),
            )
            .filter(Boolean),
        ),

      allowedPreviewPolicyStatuses:
        Object.freeze(
          normalizeList(
            merged.allowedPreviewPolicyStatuses,
            'allowedPreviewPolicyStatuses',
            20,
          )
            .map(value =>
              normalizePolicyStatus(value),
            )
            .filter(Boolean),
        ),

      allowedAdvisoryPolicyStatuses:
        Object.freeze(
          normalizeList(
            merged.allowedAdvisoryPolicyStatuses,
            'allowedAdvisoryPolicyStatuses',
            20,
          )
            .map(value =>
              normalizePolicyStatus(value),
            )
            .filter(Boolean),
        ),

      requireVerifiedPolicySourcesInEnforce:
        Boolean(
          merged.requireVerifiedPolicySourcesInEnforce,
        ),

      requirePolicyTenantMatchWhenPresent:
        Boolean(
          merged.requirePolicyTenantMatchWhenPresent,
        ),

      requireNoticeIdentity:
        Boolean(
          merged.requireNoticeIdentity,
        ),

      resolverTimeoutMs:
        Math.min(
          30000,
          Math.max(
            50,
            Math.trunc(
              finiteNumber(
                merged.resolverTimeoutMs,
                DEFAULT_OPTIONS.resolverTimeoutMs,
              ),
            ),
          ),
        ),

      sourceMonitorTimeoutMs:
        Math.min(
          30000,
          Math.max(
            50,
            Math.trunc(
              finiteNumber(
                merged.sourceMonitorTimeoutMs,
                DEFAULT_OPTIONS.sourceMonitorTimeoutMs,
              ),
            ),
          ),
        ),
    });

    this.clock =
      typeof supplied.clock === 'function'
        ? supplied.clock
        : () => Date.now();

    this.logger =
      isObject(supplied.logger)
        ? supplied.logger
        : null;

    this.metrics =
      isObject(supplied.metrics)
        ? supplied.metrics
        : null;

    this.policyResolver =
      supplied.policyResolver ||
      supplied.policyStore ||
      null;

    this.sourceAdapter =
      supplied.sourceAdapter ||
      supplied.regulatorySourceAdapter ||
      null;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  health() {
    return Object.freeze({
      success: true,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      providerScope:
        this.config.providerScope,

      ready: true,
      stateless: true,

      failClosedOnPolicyError:
        Boolean(
          this.config.failClosedOnPolicyError,
        ),

      integrations: Object.freeze({
        policyResolver:
          Boolean(this.policyResolver),

        sourceAdapter:
          Boolean(this.sourceAdapter),

        metrics:
          Boolean(this.metrics),

        logger:
          Boolean(this.logger),
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // Public synchronous APIs
  // ---------------------------------------------------------------------------

  analyzeSync(input = {}) {
    const context =
      this.#normalizeAndValidateContext(
        input,
      );

    const now =
      nowDate(this.clock);

    const policyInput =
      input.policyPack ??
      input.policy ??
      null;

    let policyPack = null;
    let policyError = null;

    if (policyInput) {
      try {
        policyPack =
          normalizePolicyPack(
            policyInput,
            {
              now,
              maxRules:
                this.config.maxRules,
              maxSourceRefs:
                this.config.maxPolicySourceRefs,
            },
          );
      } catch (error) {
        policyError = error;
      }
    }

    return this.#evaluateContext(
      context,
      policyPack,
      {
        now,
        policyError,
      },
    );
  }

  evaluateSync(input = {}) {
    return this.analyzeSync(input);
  }

  createEvidenceRequest(input = {}) {
    const result =
      this.analyzeSync({
        ...input,
        mode: 'ADVISORY',
      });

    return Object.freeze({
      success: true,

      decisionId:
        result.decisionId,

      tenantId:
        result.tenantId,

      provider:
        result.provider,

      jurisdiction:
        result.jurisdiction,

      missingEvidence:
        result.missingEvidence,

      staleEvidence:
        result.staleEvidence,

      contradictions:
        result.contradictions,

      recommendedNextAction:
        result.missingEvidence.length ||
        result.staleEvidence.length ||
        result.contradictions.length
          ? 'REFRESH_OR_RESOLVE_EVIDENCE'
          : 'NO_ADDITIONAL_EVIDENCE_REQUIRED',
    });
  }

  diffPolicyPacks(
    previousPolicyPack,
    nextPolicyPack,
  ) {
    const now =
      nowDate(this.clock);

    const previous =
      normalizePolicyPack(
        previousPolicyPack,
        {
          now,
          maxRules:
            this.config.maxRules,
          maxSourceRefs:
            this.config.maxPolicySourceRefs,
        },
      );

    const next =
      normalizePolicyPack(
        nextPolicyPack,
        {
          now,
          maxRules:
            this.config.maxRules,
          maxSourceRefs:
            this.config.maxPolicySourceRefs,
        },
      );

    if (
      previous.provider !==
      next.provider
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'Policy diff provider mismatch.',
        {
          code:
            'REGULATORY_POLICY_PROVIDER_MISMATCH',
          statusCode: 409,
          details: {
            previous:
              previous.provider,
            next:
              next.provider,
          },
        },
      );
    }

    if (
      previous.jurisdiction !==
      next.jurisdiction
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'Policy diff jurisdiction mismatch.',
        {
          code:
            'REGULATORY_POLICY_JURISDICTION_MISMATCH',
          statusCode: 409,
          details: {
            previous:
              previous.jurisdiction,
            next:
              next.jurisdiction,
          },
        },
      );
    }

    const previousMap =
      new Map(
        previous.rules.map(
          rule => [
            rule.ruleId,
            rule,
          ],
        ),
      );

    const nextMap =
      new Map(
        next.rules.map(
          rule => [
            rule.ruleId,
            rule,
          ],
        ),
      );

    const changes = [];

    for (const rule of next.rules) {
      const previousRule =
        previousMap.get(
          rule.ruleId,
        );

      if (!previousRule) {
        changes.push({
          type: 'ADDED',
          ruleId:
            rule.ruleId,
          previousVersion: null,
          nextVersion:
            rule.version,
          severity:
            rule.severity,
          controlFamily:
            rule.controlFamily,
          fingerprint:
            ruleFingerprint(rule),
        });

        continue;
      }

      const previousFingerprint =
        ruleFingerprint(
          previousRule,
        );

      const nextFingerprint =
        ruleFingerprint(
          rule,
        );

      if (
        previousFingerprint !==
        nextFingerprint
      ) {
        changes.push({
          type: 'MODIFIED',
          ruleId:
            rule.ruleId,
          previousVersion:
            previousRule.version,
          nextVersion:
            rule.version,
          previousStatus:
            previousRule.status,
          nextStatus:
            rule.status,
          previousSeverity:
            previousRule.severity,
          nextSeverity:
            rule.severity,
          controlFamily:
            rule.controlFamily,
          fingerprint:
            nextFingerprint,
        });
      } else {
        changes.push({
          type: 'UNCHANGED',
          ruleId:
            rule.ruleId,
          previousVersion:
            previousRule.version,
          nextVersion:
            rule.version,
          severity:
            rule.severity,
          controlFamily:
            rule.controlFamily,
          fingerprint:
            nextFingerprint,
        });
      }
    }

    for (const rule of previous.rules) {
      if (nextMap.has(rule.ruleId)) {
        continue;
      }

      changes.push({
        type: 'REMOVED',
        ruleId:
          rule.ruleId,
        previousVersion:
          rule.version,
        nextVersion:
          null,
        severity:
          rule.severity,
        controlFamily:
          rule.controlFamily,
        fingerprint:
          ruleFingerprint(rule),
      });
    }

    const materialChanges =
      changes.filter(
        change =>
          change.type !==
          'UNCHANGED',
      );

    if (
      materialChanges.length >
      this.config.maxPolicyDiffChanges
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'Policy diff exceeds the configured change limit.',
        {
          code:
            'REGULATORY_POLICY_DIFF_TOO_LARGE',
          statusCode: 422,
          details: {
            maxPolicyDiffChanges:
              this.config.maxPolicyDiffChanges,
          },
        },
      );
    }

    const highest =
      materialChanges.reduce(
        (current, change) => {
          const changeSeverity =
            change.severity ||
            'INFO';

          return (
            (
              SEVERITY_RANK[
                changeSeverity
              ] ?? 0
            ) >
            (
              SEVERITY_RANK[
                current
              ] ?? 0
            )
          )
            ? changeSeverity
            : current;
        },
        'INFO',
      );

    return deepFreeze({
      success: true,

      provider:
        next.provider,

      jurisdiction:
        next.jurisdiction,

      previousPolicy: {
        packId:
          previous.packId,
        version:
          previous.version,
        status:
          previous.status,
        fingerprint:
          previous.policyFingerprint,
      },

      nextPolicy: {
        packId:
          next.packId,
        version:
          next.version,
        status:
          next.status,
        fingerprint:
          next.policyFingerprint,
      },

      totalChanges:
        materialChanges.length,

      highestSeverity:
        highest,

      changes,

      diffFingerprint:
        sha256({
          previous:
            previous.policyFingerprint,
          next:
            next.policyFingerprint,
          changes,
        }),
    });
  }

  assessChangeImpact(
    diff = {},
    {
      context = {},
      decisionSamples = [],
    } = {},
  ) {
    if (!isPlainObject(diff)) {
      throw new AirtelRegulatoryIntelligenceError(
        'Policy diff must be a plain object.',
        {
          code:
            'REGULATORY_POLICY_DIFF_INVALID',
          statusCode: 422,
        },
      );
    }

    const changes =
      Array.isArray(diff.changes)
        ? diff.changes
        : [];

    const applicableSamples =
      Array.isArray(decisionSamples)
        ? decisionSamples
        : [];

    const impacted = [];

    for (const change of changes) {
      if (
        !change ||
        change.type ===
          'UNCHANGED'
      ) {
        continue;
      }

      let impact = 'LOW';

      if (
        change.type === 'REMOVED'
      ) {
        impact = 'HIGH';
      }

      if (
        change.type === 'MODIFIED'
      ) {
        impact = 'MEDIUM';
      }

      if (
        change.type === 'ADDED'
      ) {
        impact = 'MEDIUM';
      }

      if (
        change.severity ===
        'CRITICAL'
      ) {
        impact = 'CRITICAL';
      } else if (
        change.severity ===
          'HIGH' &&
        impact !== 'CRITICAL'
      ) {
        impact = 'HIGH';
      }

      if (
        applicableSamples.some(
          sample =>
            sample?.ruleId ===
              change.ruleId &&
            sample?.outcome ===
              'BLOCK',
        )
      ) {
        impact =
          impact === 'CRITICAL'
            ? 'CRITICAL'
            : 'HIGH';
      }

      impacted.push({
        ruleId:
          change.ruleId,
        changeType:
          change.type,
        controlFamily:
          change.controlFamily ||
          'OTHER',
        severity:
          change.severity ||
          'INFO',
        impact,
      });
    }

    const highestImpact =
      impacted.reduce(
        (current, item) =>
          (
            SEVERITY_RANK[
              item.impact
            ] ?? 0
          ) >
          (
            SEVERITY_RANK[
              current
            ] ?? 0
          )
            ? item.impact
            : current,
        'NONE',
      );

    return deepFreeze({
      success: true,

      context:
        isPlainObject(context)
          ? deepClone(context)
          : {},

      highestImpact,

      requiresGovernanceApproval:
        ['HIGH', 'CRITICAL'].includes(
          highestImpact,
        ),

      requiresRegressionEvaluation:
        impacted.length > 0,

      impactedRules:
        impacted,

      impactFingerprint:
        sha256({
          diffFingerprint:
            diff.diffFingerprint ||
            null,
          impacted,
        }),
    });
  }

  buildPolicyActivationPlan({
    policyPack,
    previousPolicyPack = null,
    actor = null,
    approval = null,
    reason = null,
  } = {}) {
    const now =
      nowDate(this.clock);

    const next =
      normalizePolicyPack(
        policyPack,
        {
          now,
          maxRules:
            this.config.maxRules,
          maxSourceRefs:
            this.config.maxPolicySourceRefs,
        },
      );

    const previous =
      previousPolicyPack
        ? normalizePolicyPack(
            previousPolicyPack,
            {
              now,
              maxRules:
                this.config.maxRules,
              maxSourceRefs:
                this.config.maxPolicySourceRefs,
            },
          )
        : null;

    const normalizedActor =
      normalizeActor(actor);

    const normalizedApproval =
      normalizeApproval(approval);

    if (next.status !== 'ACTIVE') {
      throw new AirtelRegulatoryIntelligenceError(
        'Policy activation plan requires a policy pack with ACTIVE target status.',
        {
          code:
            'REGULATORY_ACTIVATION_TARGET_NOT_ACTIVE',
          statusCode: 422,
        },
      );
    }

    if (
      normalizedActor?.tenantId &&
      next.tenantId &&
      normalizedActor.tenantId !==
        next.tenantId
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'Policy activation maker is outside the policy tenant scope.',
        {
          code:
            'REGULATORY_ACTIVATION_TENANT_MISMATCH',
          statusCode: 403,
        },
      );
    }

    if (
      this.config
        .makerCheckerRequiredForActivation
    ) {
      if (!normalizedActor?.actorId) {
        throw new AirtelRegulatoryIntelligenceError(
          'Policy activation planning requires an identified maker.',
          {
            code:
              'REGULATORY_ACTIVATION_MAKER_REQUIRED',
            statusCode: 422,
          },
        );
      }

      if (
        !normalizedApproval?.approvalId ||
        !normalizedApproval.approverId ||
        normalizedApproval.approved !==
          true
      ) {
        throw new AirtelRegulatoryIntelligenceError(
          'Policy activation requires explicit checker approval.',
          {
            code:
              'REGULATORY_ACTIVATION_CHECKER_APPROVAL_REQUIRED',
            statusCode: 422,
          },
        );
      }

      if (
        normalizedActor.actorId ===
        normalizedApproval.approverId
      ) {
        throw new AirtelRegulatoryIntelligenceError(
          'Policy activation maker and checker must be distinct principals.',
          {
            code:
              'REGULATORY_ACTIVATION_MAKER_CHECKER_CONFLICT',
            statusCode: 409,
          },
        );
      }
    }

    const diff =
      previous
        ? this.diffPolicyPacks(
            previous,
            next,
          )
        : null;

    const impact =
      diff
        ? this.assessChangeImpact(
            diff,
          )
        : deepFreeze({
            success: true,

            highestImpact:
              'HIGH',

            requiresGovernanceApproval:
              true,

            requiresRegressionEvaluation:
              true,

            impactedRules:
              next.rules.map(
                rule => ({
                  ruleId:
                    rule.ruleId,
                  changeType:
                    'ADDED',
                  controlFamily:
                    rule.controlFamily,
                  severity:
                    rule.severity,
                  impact:
                    rule.severity ===
                    'CRITICAL'
                      ? 'CRITICAL'
                      : rule.severity ===
                          'HIGH'
                        ? 'HIGH'
                        : 'MEDIUM',
                }),
              ),
          });

    const activationId =
      sha256({
        provider:
          next.provider,
        jurisdiction:
          next.jurisdiction,
        packId:
          next.packId,
        version:
          next.version,
        fingerprint:
          next.policyFingerprint,
        previousPolicyFingerprint:
          previous
            ?.policyFingerprint ||
          null,
        actor:
          normalizedActor,
        approval:
          normalizedApproval,
      }).slice(0, 40);

    return deepFreeze({
      success: true,

      activationId,

      idempotencyKey:
        `regulatory-activation:${next.provider.toLowerCase()}:${next.jurisdiction.toLowerCase()}:${activationId}`,

      status:
        'PENDING_APPROVAL_EXECUTION',

      tenantId:
        next.tenantId ||
        normalizedActor?.tenantId ||
        null,

      provider:
        next.provider,

      jurisdiction:
        next.jurisdiction,

      policy: {
        packId:
          next.packId,
        version:
          next.version,
        fingerprint:
          next.policyFingerprint,
        effectiveFrom:
          next.effectiveFrom?.toISOString() ||
          null,
      },

      previousPolicy:
        previous
          ? {
              packId:
                previous.packId,
              version:
                previous.version,
              fingerprint:
                previous.policyFingerprint,
            }
          : null,

      impact,

      maker:
        normalizedActor,

      checkerApproval:
        normalizedApproval,

      reason:
        sanitizeReason(
          reason || '',
          this.config.maxReasonLength,
        ) || null,

      invariants:
        Object.freeze([
          'Policy version/fingerprint must match at execution time.',
          'Activation must remain tenant/governance scoped.',
          'Activation must not silently rewrite historical decisions.',
          'Previous active policy must remain auditable after supersession.',
          'Financial posting remains outside this engine and inside Financial Core.',
        ]),
    });
  }

  validatePolicyPack(
    policyPack,
    {
      mode = 'ENFORCE',
      tenantId = null,
    } = {},
  ) {
    const now =
      nowDate(this.clock);

    const normalizedMode =
      normalizeMode(mode);

    const normalized =
      normalizePolicyPack(
        policyPack,
        {
          now,
          maxRules:
            this.config.maxRules,
          maxSourceRefs:
            this.config.maxPolicySourceRefs,
        },
      );

    const policyStatusAllowed =
      policyStatusAllowedHelper(
        normalized.status,
        normalizedMode,
        this.config,
      );

    const tenantMatches =
      !normalized.tenantId ||
      !tenantId ||
      normalized.tenantId ===
        normalizeIdentifier(
          tenantId,
          'tenantId',
          128,
        );

    const sourceIssues =
      normalized.sourceRefs
        .filter(
          source =>
            source.sourceUri &&
            !source.documentDigest,
        )
        .map(source => ({
          identifier:
            source.identifier,
          sourceUri:
            source.sourceUri,
        }));

    const valid =
      Boolean(
        policyStatusAllowed &&
        normalized.effectiveNow &&
        tenantMatches &&
        normalized.rules.length > 0 &&
        !(
          normalizedMode ===
            'ENFORCE' &&
          this.config
            .requireVerifiedPolicySourcesInEnforce &&
          sourceIssues.length
        ),
      );

    return deepFreeze({
      success: true,
      valid,
      mode: normalizedMode,

      tenantId:
        tenantId
          ? String(tenantId)
          : null,

      policy: {
        packId:
          normalized.packId,
        version:
          normalized.version,
        tenantId:
          normalized.tenantId,
        provider:
          normalized.provider,
        jurisdiction:
          normalized.jurisdiction,
        status:
          normalized.status,
        fingerprint:
          normalized.policyFingerprint,
        effectiveNow:
          normalized.effectiveNow,
      },

      checks: {
        statusAllowed:
          policyStatusAllowed,

        effectiveNow:
          normalized.effectiveNow,

        tenantMatches,

        rulesPresent:
          normalized.rules.length >
          0,

        sourceIssues:
          sourceIssues.length,
      },

      sourceIssues,
    });
  }

  validatePolicyActivationPlan(
    plan,
    {
      currentPolicyPack = null,
      approval = null,
      actor = null,
      tenantId = null,
    } = {},
  ) {
    if (!isPlainObject(plan)) {
      throw new AirtelRegulatoryIntelligenceError(
        'Policy activation plan must be a plain object.',
        {
          code:
            'REGULATORY_ACTIVATION_PLAN_INVALID',
          statusCode: 422,
        },
      );
    }

    const normalizedActor =
      normalizeActor(
        actor ?? plan.maker,
      );

    const normalizedApproval =
      normalizeApproval(
        approval ??
          plan.checkerApproval,
      );

    if (
      !plan.activationId ||
      !plan.policy?.fingerprint
    ) {
      return deepFreeze({
        success: true,
        valid: false,
        status: 'INVALID',
        reasons: [
          'ACTIVATION_ID_OR_POLICY_FINGERPRINT_MISSING',
        ],
      });
    }

    const current =
      currentPolicyPack
        ? normalizePolicyPack(
            currentPolicyPack,
            {
              now:
                nowDate(
                  this.clock,
                ),
              maxRules:
                this.config.maxRules,
              maxSourceRefs:
                this.config
                  .maxPolicySourceRefs,
            },
          )
        : null;

    const tenantMatches =
      !tenantId ||
      !plan.tenantId ||
      String(plan.tenantId) ===
        String(tenantId);

    const approvalValid =
      !this.config
        .makerCheckerRequiredForActivation ||
      (
        normalizedApproval?.approvalId &&
        normalizedApproval?.approverId &&
        normalizedApproval.approved ===
          true &&
        normalizedActor?.actorId &&
        normalizedActor.actorId !==
          normalizedApproval.approverId
      );

    const currentFingerprintMatches =
      !current ||
      current.policyFingerprint ===
        plan.policy.fingerprint;

    const reasons = [];

    if (!tenantMatches) {
      reasons.push(
        'TENANT_SCOPE_MISMATCH',
      );
    }

    if (!approvalValid) {
      reasons.push(
        'CHECKER_APPROVAL_INVALID',
      );
    }

    if (!currentFingerprintMatches) {
      reasons.push(
        'POLICY_FINGERPRINT_CHANGED',
      );
    }

    return deepFreeze({
      success: true,

      valid:
        reasons.length === 0,

      status:
        reasons.length
          ? 'INVALID'
          : 'VALID',

      activationId:
        String(plan.activationId),

      tenantMatches,

      approvalValid,

      currentFingerprintMatches,

      reasons,
    });
  }

  buildEvidenceManifest(input = {}) {
    const context =
      this.#normalizeAndValidateContext(
        input,
      );

    const result =
      this.analyzeSync({
        ...input,
        mode:
          input.mode ||
          'ADVISORY',
      });

    const paths =
      new Map();

    for (const path of [
      ...result.missingEvidence.map(
        item => item.path,
      ),

      ...result.staleEvidence.map(
        item => item.path,
      ),

      ...result.findings.flatMap(
        finding =>
          (finding.evidence || [])
            .map(
              item =>
                item.path,
            )
            .filter(Boolean),
      ),
    ]) {
      paths.set(path, true);
    }

    return deepFreeze({
      success: true,

      tenantId:
        context.tenantId,

      provider:
        context.provider,

      jurisdiction:
        context.jurisdiction,

      decisionId:
        result.decisionId,

      policyFingerprint:
        result.policy?.fingerprint ||
        null,

      evidence:
        [...paths.keys()]
          .slice(
            0,
            this.config
              .maxEvidencePaths,
          )
          .map(path => {
            const found =
              extractEvidenceValue(
                context.evidence,
                path,
              );

            return evidenceMetadata(
              path,
              found.value,
              found.exists,
              getEvidenceTimestamp(
                context.evidence,
                path,
              ),
            );
          }),

      requestedAt:
        nowDate(
          this.clock,
        ).toISOString(),
    });
  }

  analyzeBatchSync(inputs = []) {
    if (!Array.isArray(inputs)) {
      throw new AirtelRegulatoryIntelligenceError(
        'analyzeBatchSync requires an array.',
        {
          code:
            'REGULATORY_BATCH_INPUT_INVALID',
          statusCode: 422,
        },
      );
    }

    const results =
      inputs.map(
        input =>
          this.analyzeSync(
            input,
          ),
      );

    const tenantIds =
      new Set(
        results.map(
          result =>
            result.tenantId,
        ),
      );

    return deepFreeze({
      success: true,

      count:
        results.length,

      mixedTenantBatch:
        tenantIds.size > 1,

      results,
    });
  }

  async analyzeBatch(inputs = []) {
    if (!Array.isArray(inputs)) {
      throw new AirtelRegulatoryIntelligenceError(
        'analyzeBatch requires an array.',
        {
          code:
            'REGULATORY_BATCH_INPUT_INVALID',
          statusCode: 422,
        },
      );
    }

    const results =
      await Promise.all(
        inputs.map(
          input =>
            this.analyze(
              input,
            ),
        ),
      );

    const tenantIds =
      new Set(
        results.map(
          result =>
            result.tenantId,
        ),
      );

    return deepFreeze({
      success: true,

      count:
        results.length,

      mixedTenantBatch:
        tenantIds.size > 1,

      results,
    });
  }

  buildComplianceCase(
    result,
    {
      actor = null,
      caseStatus = null,
    } = {},
  ) {
    if (!isPlainObject(result)) {
      throw new AirtelRegulatoryIntelligenceError(
        'result must be a plain object.',
        {
          code:
            'REGULATORY_CASE_RESULT_INVALID',
          statusCode: 422,
        },
      );
    }

    const normalizedActor =
      normalizeActor(actor);

    const derivedStatus =
      result.decision === 'BLOCK'
        ? 'BLOCKED'
        : result.decision ===
              'REVIEW' ||
            result.decision ===
              'NO_POLICY'
          ? 'REVIEW_REQUIRED'
          : 'CLEARED';

    const normalizedStatus =
      caseStatus
        ? normalizeEnum(
            caseStatus,
            'caseStatus',
            CASE_STATUSES,
            derivedStatus,
          )
        : derivedStatus;

    const caseId =
      sha256({
        tenantId:
          result.tenantId,
        provider:
          result.provider,
        jurisdiction:
          result.jurisdiction,
        decisionId:
          result.decisionId,
        status:
          normalizedStatus,
      }).slice(0, 40);

    return deepFreeze({
      success: true,

      caseId,

      idempotencyKey:
        `regulatory-case:${String(result.tenantId).toLowerCase()}:${caseId}`,

      status:
        normalizedStatus,

      tenantId:
        result.tenantId,

      provider:
        result.provider,

      jurisdiction:
        result.jurisdiction,

      decisionId:
        result.decisionId,

      policyFingerprint:
        result.policy?.fingerprint ||
        null,

      severity:
        result.highestSeverity ||
        'INFO',

      actor:
        normalizedActor,

      openedAt:
        nowDate(
          this.clock,
        ).toISOString(),

      reasonCodes:
        result.findings.map(
          finding =>
            finding.code,
        ),

      invariants:
        Object.freeze([
          'Compliance cases are tenant-scoped.',
          'A case does not mutate the financial transaction or ledger.',
          'Case closure does not override an authoritative payment decision.',
          'Regulatory source-of-truth remains externally governed.',
        ]),
    });
  }

  buildAuditEnvelope(
    result,
    {
      actor = null,
      eventType =
        'REGULATORY_DECISION_EVALUATED',
    } = {},
  ) {
    if (!isPlainObject(result)) {
      throw new AirtelRegulatoryIntelligenceError(
        'result must be a plain object.',
        {
          code:
            'REGULATORY_AUDIT_RESULT_INVALID',
          statusCode: 422,
        },
      );
    }

    const normalizedActor =
      normalizeActor(actor);

    const auditFingerprint =
      sha256({
        eventType,
        tenantId:
          result.tenantId ||
          null,
        decisionId:
          result.decisionId ||
          null,
        decisionFingerprint:
          result.decisionFingerprint ||
          null,
        policyFingerprint:
          result.policy?.fingerprint ||
          null,
      }).slice(0, 40);

    return deepFreeze({
      eventType:
        normalizeIdentifier(
          eventType,
          'eventType',
          120,
        ),

      eventId:
        auditFingerprint,

      auditFingerprint,

      tenantId:
        result.tenantId ||
        null,

      provider:
        result.provider ||
        null,

      jurisdiction:
        result.jurisdiction ||
        null,

      decisionId:
        result.decisionId ||
        null,

      decision:
        result.decision ||
        null,

      severity:
        result.highestSeverity ||
        'INFO',

      mode:
        result.mode ||
        null,

      decisionFingerprint:
        result.decisionFingerprint ||
        null,

      actor:
        normalizedActor,

      policy:
        result.policy
          ? {
              packId:
                result.policy.packId,

              version:
                result.policy.version,

              fingerprint:
                result.policy.fingerprint,
            }
          : null,

      findingSummary:
        result.findingSummary ||
        null,

      generatedAt:
        nowDate(
          this.clock,
        ).toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Public asynchronous APIs
  // ---------------------------------------------------------------------------

  async analyze(input = {}) {
    const supplied =
      isPlainObject(input)
        ? input
        : {};

    let policyPack =
      supplied.policyPack ??
      supplied.policy ??
      null;

    let resolverDiagnostics = [];

    if (
      !policyPack &&
      this.policyResolver
    ) {
      const context =
        this.#normalizeAndValidateContext(
          supplied,
        );

      const resolved =
        await this.#resolvePolicyPack(
          context,
          resolverDiagnostics,
        );

      policyPack =
        resolved;
    }

    const result =
      this.analyzeSync({
        ...supplied,
        ...(policyPack
          ? { policyPack }
          : {}),
      });

    return deepFreeze({
      ...result,
      resolverDiagnostics,
    });
  }

  async evaluate(input = {}) {
    return this.analyze(input);
  }

  async monitorRegulatorySources(
    input = {},
  ) {
    const context =
      this.#normalizeAndValidateContext({
        ...input,
        mode: 'ADVISORY',
      });

    if (!this.sourceAdapter) {
      return deepFreeze({
        success: false,
        status: 'UNAVAILABLE',
        code:
          'REGULATORY_SOURCE_ADAPTER_UNAVAILABLE',
        provider:
          context.provider,
        jurisdiction:
          context.jurisdiction,
        notices: [],
      });
    }

    const methodNames = [
      'fetchUpdates',
      'listUpdates',
      'getUpdates',
      'monitor',
    ];

    const methodName =
      methodNames.find(
        name =>
          typeof this
            .sourceAdapter?.[name] ===
          'function',
      );

    if (!methodName) {
      return deepFreeze({
        success: false,
        status: 'UNAVAILABLE',
        code:
          'REGULATORY_SOURCE_METHOD_NOT_FOUND',
        provider:
          context.provider,
        jurisdiction:
          context.jurisdiction,
        notices: [],
      });
    }

    const payload = {
      tenantId:
        context.tenantId,

      provider:
        context.provider,

      jurisdiction:
        context.jurisdiction,

      country:
        context.country,

      operation:
        context.operation,

      since:
        normalizeDate(
          input.since,
          'since',
        ),

      until:
        normalizeDate(
          input.until,
          'until',
        ),

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };

    try {
      const raw =
        await this.#withTimeout(
          Promise.resolve(
            this.sourceAdapter[
              methodName
            ](payload),
          ),
          finiteNumber(
            input.timeoutMs,
            this.config
              .sourceMonitorTimeoutMs,
          ),
        );

      const items =
        Array.isArray(raw)
          ? raw
          : raw?.notices ??
            raw?.updates ??
            [];

      const normalizedItems =
        normalizeList(
          items,
          'regulatory notices',
          500,
        );

      const notices =
        normalizedItems
          .map(
            normalizeNotice,
          )
          .filter(
            notice =>
              notice.jurisdiction ===
              context.jurisdiction,
          );

      const filteredCount =
        notices.length !==
        normalizedItems.length
          ? normalizedItems.length -
            notices.length
          : 0;

      this.#metricIncrement(
        'airtel_regulatory_source_updates_total',
        notices.length,
      );

      if (filteredCount > 0) {
        this.#metricIncrement(
          'airtel_regulatory_source_updates_scope_filtered_total',
          filteredCount,
        );
      }

      this.#log('info', {
        event:
          'airtel_regulatory_source_monitor_completed',

        provider:
          context.provider,

        jurisdiction:
          context.jurisdiction,

        noticeCount:
          notices.length,
      });

      return deepFreeze({
        success: true,

        status: 'OK',

        method:
          methodName,

        provider:
          context.provider,

        jurisdiction:
          context.jurisdiction,

        noticeCount:
          notices.length,

        scopeFilteredNoticeCount:
          filteredCount,

        sourceVerificationSummary: {
          verified:
            notices.filter(
              notice =>
                notice.sourceVerificationStatus ===
                'VERIFIED',
            ).length,

          missingDigest:
            notices.filter(
              notice =>
                notice.sourceVerificationStatus ===
                'MISSING_DIGEST',
            ).length,

          unverified:
            notices.filter(
              notice =>
                notice.sourceVerificationStatus ===
                'UNVERIFIED',
            ).length,
        },

        notices,
      });
    } catch (error) {
      this.#metricIncrement(
        'airtel_regulatory_source_monitor_failures_total',
      );

      this.#log('warn', {
        event:
          'airtel_regulatory_source_monitor_failed',

        provider:
          context.provider,

        jurisdiction:
          context.jurisdiction,

        code:
          error?.code ||
          'REGULATORY_SOURCE_MONITOR_FAILED',
      });

      return deepFreeze({
        success: false,

        status: 'FAILED',

        code:
          error?.code ||
          'REGULATORY_SOURCE_MONITOR_FAILED',

        provider:
          context.provider,

        jurisdiction:
          context.jurisdiction,

        notices: [],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private context validation/evaluation
  // ---------------------------------------------------------------------------

  #normalizeAndValidateContext(input) {
    const context =
      normalizeContext(input);

    if (
      this.config.requireTenantId &&
      !context.tenantId
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'tenantId is required for regulatory intelligence.',
        {
          code:
            'REGULATORY_TENANT_REQUIRED',
          statusCode: 422,
        },
      );
    }

    if (
      context.provider !==
      this.config.providerScope
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        `Regulatory intelligence provider scope mismatch: expected ${this.config.providerScope}, received ${context.provider}.`,
        {
          code:
            'REGULATORY_PROVIDER_SCOPE_MISMATCH',
          statusCode: 422,
          details: {
            expected:
              this.config.providerScope,

            received:
              context.provider,
          },
        },
      );
    }

    if (
      this.config.requireJurisdiction &&
      !context.jurisdiction
    ) {
      throw new AirtelRegulatoryIntelligenceError(
        'jurisdiction is required for regulatory intelligence.',
        {
          code:
            'REGULATORY_JURISDICTION_REQUIRED',
          statusCode: 422,
        },
      );
    }

    return deepFreeze(context);
  }

  #evaluateContext(
    context,
    policyPack,
    {
      now,
      policyError,
    },
  ) {
    const policyAvailable =
      Boolean(policyPack) &&
      !policyError;

    const policyStatusAllowed =
      policyPack
        ? policyStatusAllowedHelper(
            policyPack.status,
            context.mode,
            this.config,
          )
        : false;

    const policyWindowActive =
      policyPack?.effectiveNow !==
      false;

    const tenantScopeMatches =
      policyPack?.tenantId
        ? policyPack.tenantId ===
          context.tenantId
        : true;

    const sameScope =
      policyPack
        ? (
            policyPack.provider ===
              context.provider &&
            policyPack.jurisdiction ===
              context.jurisdiction &&
            (
              !this.config
                .requirePolicyTenantMatchWhenPresent ||
              tenantScopeMatches
            )
          )
        : false;

    const preliminaryFindings = [];
    const missingEvidence = [];
    const staleEvidence = [];
    const contradictions = [];

    if (policyError) {
      preliminaryFindings.push(
        buildFinding({
          code:
            'POLICY_PACK_INVALID',

          rule: null,

          result:
            'ERROR',

          outcome:
            this.config
              .failClosedOnPolicyError
              ? 'REVIEW'
              : 'ALLOW',

          severity:
            'CRITICAL',

          reason:
            'The supplied regulatory policy pack could not be normalized safely.',

          remediation:
            'Correct the policy pack before using it as an enforcement source.',
        }),
      );
    }

    if (!policyPack) {
      preliminaryFindings.push(
        buildFinding({
          code:
            'POLICY_PACK_MISSING',

          rule: null,

          result:
            'UNKNOWN',

          outcome:
            'REVIEW',

          severity:
            'CRITICAL',

          reason:
            'No applicable regulatory policy pack was supplied or resolved.',

          remediation:
            'Resolve an approved policy pack for the tenant jurisdiction and provider.',
        }),
      );
    } else if (
      !policyStatusAllowed
    ) {
      preliminaryFindings.push(
        buildFinding({
          code:
            'POLICY_STATUS_NOT_ALLOWED',

          rule: null,

          result:
            'UNKNOWN',

          outcome:
            'REVIEW',

          severity:
            'CRITICAL',

          reason:
            `Policy pack status ${policyPack.status} is not permitted in ${context.mode} mode.`,

          remediation:
            'Use a governed policy pack status permitted for the selected evaluation mode.',
        }),
      );
    } else if (
      !policyWindowActive
    ) {
      preliminaryFindings.push(
        buildFinding({
          code:
            'POLICY_EFFECTIVE_WINDOW_INVALID',

          rule: null,

          result:
            'UNKNOWN',

          outcome:
            'REVIEW',

          severity:
            'HIGH',

          reason:
            'Policy pack is outside its configured effective date window.',

          remediation:
            'Resolve the policy pack effective for the evaluation timestamp.',
        }),
      );
    } else if (
      !sameScope
    ) {
      preliminaryFindings.push(
        buildFinding({
          code:
            'POLICY_SCOPE_MISMATCH',

          rule: null,

          result:
            'ERROR',

          outcome:
            'BLOCK',

          severity:
            'CRITICAL',

          reason:
            'Policy provider, jurisdiction or tenant scope does not match the evaluation context.',

          conflict:
            true,

          blocksPayment:
            true,

          remediation:
            'Do not evaluate or execute against a cross-scope policy pack.',
        }),
      );
    } else if (
      context.mode ===
        'ENFORCE' &&
      this.config
        .requireVerifiedPolicySourcesInEnforce &&
      policyPack.sourceRefs.some(
        source =>
          source.sourceUri &&
          !source.documentDigest,
      )
    ) {
      preliminaryFindings.push(
        buildFinding({
          code:
            'POLICY_SOURCE_DIGEST_MISSING',

          rule: null,

          result:
            'UNKNOWN',

          outcome:
            'REVIEW',

          severity:
            'HIGH',

          reason:
            'At least one policy source reference lacks a document digest required by enforcement configuration.',

          remediation:
            'Attach a cryptographic document digest to each externally sourced policy reference before enforcement.',
        }),
      );
    }

    let applicableRuleCount = 0;
    let evaluatedRuleCount = 0;

    const ruleFindings = [];
    const appliedRules = [];

    if (
      policyPack &&
      policyStatusAllowed &&
      policyWindowActive &&
      sameScope
    ) {
      for (const rule of policyPack.rules) {
        if (
          rule.status !==
            'ACTIVE' &&
          context.mode ===
            'ENFORCE'
        ) {
          continue;
        }

        if (
          !policyApplies(
            rule,
            context,
          )
        ) {
          continue;
        }

        applicableRuleCount += 1;

        const applicabilityResult =
          this.#evaluateAppliesWhen(
            rule,
            context.evidence,
          );

        if (
          applicabilityResult ===
          'NO'
        ) {
          ruleFindings.push(
            buildFinding({
              code:
                'RULE_NOT_APPLICABLE',

              rule,

              result:
                'NOT_APPLICABLE',

              outcome:
                'ALLOW',

              severity:
                'INFO',

              reason:
                'Rule applicability conditions were not satisfied for this payment context.',
            }),
          );

          continue;
        }

        if (
          applicabilityResult ===
          'UNKNOWN'
        ) {
          const outcome =
            rule.unknownOutcome ||
            this.config
              .defaultUnknownOutcome;

          ruleFindings.push(
            buildFinding({
              code:
                'RULE_APPLICABILITY_UNKNOWN',

              rule,

              result:
                'UNKNOWN',

              outcome,

              severity:
                rule.severity,

              reason:
                'Rule applicability could not be established because required context evidence is missing or indeterminate.',

              remediation:
                'Provide the missing applicability evidence or explicitly govern an alternative rule path.',
            }),
          );

          evaluatedRuleCount += 1;

          continue;
        }

        const missingForRule =
          this.#findMissingEvidence(
            rule,
            context.evidence,
          );

        if (
          missingForRule.length
        ) {
          for (
            const path of
              missingForRule
          ) {
            if (
              !missingEvidence.some(
                item =>
                  item.path ===
                    path &&
                  item.ruleId ===
                    rule.ruleId,
              )
            ) {
              missingEvidence.push({
                path,

                ruleId:
                  rule.ruleId,

                controlFamily:
                  rule.controlFamily,

                required:
                  true,
              });
            }
          }

          const outcome =
            rule.unknownOutcome ||
            this.config
              .defaultMissingEvidenceOutcome;

          ruleFindings.push(
            buildFinding({
              code:
                'RULE_EVIDENCE_MISSING',

              rule,

              result:
                'UNKNOWN',

              outcome,

              severity:
                rule.severity,

              reason:
                'Required compliance evidence is missing; the rule cannot be established as satisfied.',

              evidence:
                missingForRule.map(
                  path => ({
                    path,

                    present:
                      false,

                    sensitive:
                      sanitizeSensitivePath(
                        path,
                      ),
                  }),
                ),

              remediation:
                'Collect authoritative evidence before allowing automated settlement where policy requires it.',
            }),
          );

          evaluatedRuleCount += 1;

          continue;
        }

        const stale =
          this.#findStaleEvidence(
            rule,
            context.evidence,
            now,
          );

        for (
          const staleItem of
            stale
        ) {
          staleEvidence.push({
            ...staleItem,

            ruleId:
              rule.ruleId,

            controlFamily:
              rule.controlFamily,
          });
        }

        const assertionResults =
          rule.assertions.map(
            assertion => ({
              assertion,

              evaluation:
                evaluateAssertion(
                  assertion,
                  context.evidence,
                ),
            }),
          );

        const unknownAssertions =
          assertionResults.filter(
            item =>
              item.evaluation
                .state ===
              'UNKNOWN',
          );

        if (
          unknownAssertions.length
        ) {
          const outcome =
            rule.unknownOutcome ||
            this.config
              .defaultUnknownOutcome;

          ruleFindings.push(
            buildFinding({
              code:
                'RULE_ASSERTION_UNKNOWN',

              rule,

              result:
                'UNKNOWN',

              outcome,

              severity:
                rule.severity,

              reason:
                'One or more compliance assertions could not be evaluated deterministically.',

              evidence:
                unknownAssertions.map(
                  item => ({
                    path:
                      item
                        .assertion
                        .path,

                    present:
                      item
                        .evaluation
                        .exists,

                    sensitive:
                      sanitizeSensitivePath(
                        item
                          .assertion
                          .path,
                      ),
                  }),
                ),

              remediation:
                'Refresh or correct authoritative evidence before relying on the rule result.',
            }),
          );

          evaluatedRuleCount += 1;

          continue;
        }

        const failed =
          assertionResults.filter(
            item =>
              item.evaluation
                .result ===
              false,
          );

        const passed =
          failed.length === 0;

        evaluatedRuleCount += 1;

        if (passed) {
          ruleFindings.push(
            buildFinding({
              code:
                'RULE_SATISFIED',

              rule,

              result:
                'PASS',

              outcome:
                'ALLOW',

              severity:
                'INFO',

              reason:
                'All configured regulatory assertions for the applicable rule were satisfied.',

              evidence:
                rule.assertions.map(
                  assertion => ({
                    path:
                      assertion.path,

                    present:
                      true,

                    satisfied:
                      true,

                    sensitive:
                      sanitizeSensitivePath(
                        assertion.path,
                      ),
                  }),
                ),
            }),
          );
        } else {
          const outcome =
            rule.failureOutcome ||
            'REVIEW';

          const conflict =
            failed.some(
              item =>
                this.#detectAssertionConflict(
                  item.assertion,
                  context.evidence,
                ),
            );

          const blocksPayment =
            outcome ===
              'BLOCK' &&
            rule.mandatory !==
              false;

          const finding =
            buildFinding({
              code:
                'RULE_VIOLATION',

              rule,

              result:
                'FAIL',

              outcome,

              severity:
                rule.severity,

              reason:
                'One or more mandatory regulatory assertions failed.',

              evidence:
                failed.map(
                  item => ({
                    path:
                      item
                        .assertion
                        .path,

                    present:
                      item
                        .evaluation
                        .exists,

                    satisfied:
                      false,

                    sensitive:
                      sanitizeSensitivePath(
                        item
                          .assertion
                          .path,
                      ),
                  }),
                ),

              conflict,

              blocksPayment,
            });

          ruleFindings.push(
            finding,
          );
        }

        appliedRules.push({
          ruleId:
            rule.ruleId,

          version:
            rule.version,

          controlFamily:
            rule.controlFamily,

          fingerprint:
            ruleFingerprint(
              rule,
            ),
        });
      }
    }

    contradictions.push(
      ...this.#detectContradictions(
        context.evidence,
      ),
    );

    for (
      const contradiction of
        contradictions
    ) {
      ruleFindings.push(
        buildFinding({
          code:
            contradiction.code,

          rule: null,

          result:
            'FAIL',

          outcome:
            'REVIEW',

          severity:
            'CRITICAL',

          reason:
            contradiction.reason,

          evidence:
            contradiction.fields,

          conflict:
            true,

          blocksPayment:
            true,

          remediation:
            contradiction.remediation,
        }),
      );
    }

    if (
      policyPack &&
      policyPack.rules.length === 0 &&
      policyStatusAllowed &&
      policyWindowActive &&
      sameScope
    ) {
      preliminaryFindings.push(
        buildFinding({
          code:
            'POLICY_PACK_RULES_EMPTY',

          rule: null,

          result:
            'UNKNOWN',

          outcome:
            'REVIEW',

          severity:
            'CRITICAL',

          reason:
            'The applicable policy pack contains no compliance rules and therefore cannot provide a meaningful enforcement basis.',

          remediation:
            'Publish a governed policy pack containing the controls applicable to this provider and jurisdiction.',
        }),
      );
    }

    const findings =
      [
        ...preliminaryFindings,
        ...ruleFindings,
      ].slice(
        0,
        this.config.maxFindings,
      );

    const decision =
      decisionFromFindings(
        findings,
        policyAvailable &&
          policyStatusAllowed &&
          policyWindowActive &&
          sameScope,
      );

    const severity =
      highestSeverity(findings);

    const confidence =
      confidenceForEvaluation({
        policyAvailable:
          policyAvailable &&
          policyStatusAllowed &&
          policyWindowActive &&
          sameScope,

        findings,

        applicableRuleCount,

        evaluatedRuleCount,
      });

    const decisionFingerprint =
      sha256({
        tenantId:
          context.tenantId,

        provider:
          context.provider,

        operation:
          context.operation,

        jurisdiction:
          context.jurisdiction,

        country:
          context.country,

        channel:
          context.channel,

        currency:
          context.currency,

        productType:
          context.productType,

        mode:
          context.mode,

        transaction:
          this.#safeTransactionIdentity(
            context.transaction,
          ),

        evidenceFingerprint:
          this.#evidenceFingerprint(
            context.evidence,
            policyPack,
          ),

        policyFingerprint:
          policyPack?.policyFingerprint ||
          null,

        findings:
          findings.map(
            item => ({
              code:
                item.code,

              ruleId:
                item.ruleId,

              ruleVersion:
                item.ruleVersion,

              result:
                item.result,

              outcome:
                item.outcome,

              severity:
                item.severity,

              conflict:
                item.conflict,
            }),
          ),
      });

    const decisionId =
      decisionFingerprint.slice(
        0,
        40,
      );

    const idempotencyKey =
      `airtel-regulatory:${String(context.tenantId).toLowerCase()}:${decisionId}`;

    const result = {
      success: true,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      evaluatedAt:
        now.toISOString(),

      decisionId,

      idempotencyKey,

      decisionFingerprint,

      tenantId:
        context.tenantId,

      provider:
        context.provider,

      operation:
        context.operation,

      jurisdiction:
        context.jurisdiction,

      country:
        context.country,

      channel:
        context.channel,

      currency:
        context.currency,

      productType:
        context.productType,

      mode:
        context.mode,

      decision,

      recommendedAction:
        this.#recommendedAction(
          decision,
          findings,
        ),

      highestSeverity:
        severity,

      confidence,

      policy:
        policyPack
          ? {
              packId:
                policyPack.packId,

              version:
                policyPack.version,

              tenantId:
                policyPack.tenantId ||
                null,

              status:
                policyPack.status,

              fingerprint:
                policyPack.policyFingerprint,

              authority:
                policyPack.authority ||
                null,

              effectiveFrom:
                policyPack.effectiveFrom?.toISOString() ||
                null,

              effectiveTo:
                policyPack.effectiveTo?.toISOString() ||
                null,
            }
          : null,

      findingSummary:
        summarizeFinding(
          findings,
        ),

      findings,

      missingEvidence:
        missingEvidence.slice(
          0,
          this.config
            .maxEvidencePaths,
        ),

      staleEvidence:
        staleEvidence.slice(
          0,
          this.config
            .maxEvidencePaths,
        ),

      contradictions,

      appliedRules,

      governance: {
        makerCheckerRequired:
          decision ===
            'BLOCK' ||
          findings.some(
            item =>
              item.outcome ===
              'REVIEW',
          ),

        activationOutsideScope:
          false,

        policyApprovalPresent:
          Boolean(
            policyPack?.approvedAt ||
              policyPack?.approvedBy,
          ),
      },

      safety: {
        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        complianceSourceOfTruth:
          'EXTERNALLY_GOVERNED_POLICY_AND_AUTHORITATIVE_EVIDENCE',
      },

      diagnostics: {
        policyError:
          safeError(
            policyError,
          ),

        applicableRuleCount,

        evaluatedRuleCount,

        missingEvidenceCount:
          missingEvidence.length,

        staleEvidenceCount:
          staleEvidence.length,

        contradictionCount:
          contradictions.length,

        policyStatusAllowed,

        policyWindowActive,

        sameScope,

        tenantScopeMatches,

        policySourceDigestIssues:
          policyPack
            ? policyPack.sourceRefs.filter(
                source =>
                  source.sourceUri &&
                  !source.documentDigest,
              ).length
            : 0,
      },
    };

    this.#metricIncrement(
      'airtel_regulatory_evaluations_total',
    );

    this.#metricIncrement(
      `airtel_regulatory_decisions_${decision.toLowerCase()}_total`,
    );

    if (
      decision === 'BLOCK'
    ) {
      this.#metricIncrement(
        'airtel_regulatory_blocks_total',
      );
    }

    if (
      missingEvidence.length
    ) {
      this.#metricIncrement(
        'airtel_regulatory_missing_evidence_total',
        missingEvidence.length,
      );
    }

    this.#log('info', {
      event:
        'airtel_regulatory_evaluation_completed',

      tenantId:
        context.tenantId,

      provider:
        context.provider,

      jurisdiction:
        context.jurisdiction,

      operation:
        context.operation,

      decision,

      severity,

      confidence,

      decisionId,

      policyFingerprint:
        policyPack?.policyFingerprint ||
        null,
    });

    return deepFreeze(
      result,
    );
  }

  #evaluateAppliesWhen(
    rule,
    evidence,
  ) {
    if (
      !rule.appliesWhen?.length
    ) {
      return 'YES';
    }

    let hasUnknown = false;

    for (
      const assertion of
        rule.appliesWhen
    ) {
      const evaluation =
        evaluateAssertion(
          assertion,
          evidence,
        );

      if (
        evaluation.state ===
        'UNKNOWN'
      ) {
        hasUnknown = true;
      } else if (
        evaluation.result ===
        false
      ) {
        return 'NO';
      }
    }

    return hasUnknown
      ? 'UNKNOWN'
      : 'YES';
  }

  #findMissingEvidence(
    rule,
    evidence,
  ) {
    const required =
      new Set(
        rule.requiredEvidence ||
          [],
      );

    for (
      const assertion of [
        ...(rule.assertions ||
          []),

        ...(rule.appliesWhen ||
          []),
      ]
    ) {
      if (
        ![
          'exists',
          'notExists',
        ].includes(
          assertion.operator,
        )
      ) {
        required.add(
          assertion.path,
        );
      }
    }

    const missing = [];

    for (
      const path of required
    ) {
      const found =
        extractEvidenceValue(
          evidence,
          path,
        );

      if (
        !found.exists ||
        found.value === null ||
        found.value ===
          undefined ||
        found.value === ''
      ) {
        missing.push(path);
      }
    }

    return missing;
  }

  #findStaleEvidence(
    rule,
    evidence,
    now,
  ) {
    const freshnessWindow =
      rule.evidenceFreshnessMs ??
      this.config
        .staleEvidenceAfterMs;

    if (
      !freshnessWindow ||
      freshnessWindow <= 0
    ) {
      return [];
    }

    const stale = [];

    const candidatePaths =
      new Set([
        ...(rule.requiredEvidence ||
          []),

        ...(rule.assertions ||
          []).map(
            assertion =>
              assertion.path,
          ),
      ]);

    for (
      const path of
        candidatePaths
    ) {
      const timestamp =
        getEvidenceTimestamp(
          evidence,
          path,
        );

      if (!timestamp) {
        if (
          rule.requiresFreshEvidence ||
          this.config
            .requireFreshEvidenceByDefault
        ) {
          stale.push({
            path,

            reason:
              'EVIDENCE_TIMESTAMP_MISSING',
          });
        }

        continue;
      }

      const ageMs =
        Math.max(
          0,
          now.getTime() -
            timestamp.getTime(),
        );

      if (
        ageMs >
        freshnessWindow
      ) {
        stale.push({
          path,

          reason:
            'EVIDENCE_STALE',

          ageMs,

          freshnessWindowMs:
            freshnessWindow,
        });
      }
    }

    return stale;
  }

  #detectAssertionConflict(
    assertion,
    evidence,
  ) {
    const found =
      extractEvidenceValue(
        evidence,
        assertion.path,
      );

    if (
      !found.exists
    ) {
      return false;
    }

    if (
      !isPlainObject(
        found.value,
      ) ||
      Array.isArray(
        found.value,
      )
    ) {
      return false;
    }

    const sourceStates =
      found.value.sources;

    if (
      !Array.isArray(
        sourceStates,
      ) ||
      sourceStates.length < 2
    ) {
      return false;
    }

    const serialized =
      new Set(
        sourceStates.map(
          item =>
            stableSerialize(
              item?.value,
            ),
        ),
      );

    return (
      serialized.size > 1
    );
  }

  #detectContradictions(
    evidence,
  ) {
    const contradictions = [];

    const contradictionPairs = [
      [
        'provider.transactionId',
        'local.providerTransactionId',
      ],

      [
        'provider.reference',
        'local.providerReference',
      ],

      [
        'provider.amount',
        'local.amount',
      ],

      [
        'provider.currency',
        'local.currency',
      ],

      [
        'financial.amount',
        'local.amount',
      ],

      [
        'financial.currency',
        'local.currency',
      ],
    ];

    for (
      const [
        leftPath,
        rightPath,
      ] of contradictionPairs
    ) {
      const left =
        extractEvidenceValue(
          evidence,
          leftPath,
        );

      const right =
        extractEvidenceValue(
          evidence,
          rightPath,
        );

      if (
        !left.exists ||
        !right.exists
      ) {
        continue;
      }

      const currencyPair =
        leftPath.endsWith(
          '.currency',
        ) ||
        rightPath.endsWith(
          '.currency',
        );

      const amountPair =
        leftPath.endsWith(
          '.amount',
        ) ||
        rightPath.endsWith(
          '.amount',
        );

      let different;

      if (
        amountPair &&
        isMoneyLike(
          left.value,
        ) &&
        isMoneyLike(
          right.value,
        )
      ) {
        different =
          compareDecimal(
            left.value,
            right.value,
          ) !== 0;
      } else if (
        currencyPair
      ) {
        different =
          String(
            left.value,
          )
            .trim()
            .toUpperCase() !==
          String(
            right.value,
          )
            .trim()
            .toUpperCase();
      } else {
        different =
          stableSerialize(
            left.value,
          ) !==
          stableSerialize(
            right.value,
          );
      }

      if (!different) {
        continue;
      }

      contradictions.push({
        code:
          'EVIDENCE_CONTRADICTION',

        reason:
          `Authoritative evidence fields ${leftPath} and ${rightPath} disagree.`,

        remediation:
          'Resolve the source discrepancy before automated compliance gating or financial settlement.',

        fields: [
          {
            path:
              leftPath,

            present:
              true,

            valueDigest:
              digestSensitiveValue(
                left.value,
              ),

            sensitive:
              sanitizeSensitivePath(
                leftPath,
              ),
          },

          {
            path:
              rightPath,

            present:
              true,

            valueDigest:
              digestSensitiveValue(
                right.value,
              ),

            sensitive:
              sanitizeSensitivePath(
                rightPath,
              ),
          },
        ],
      });
    }

    const kycStatus =
      extractEvidenceValue(
        evidence,
        'customer.kyc.status',
      );

    const kycVerified =
      extractEvidenceValue(
        evidence,
        'customer.kyc.verified',
      );

    if (
      kycStatus.exists &&
      kycVerified.exists
    ) {
      const statusVerified =
        String(
          kycStatus.value,
        )
          .trim()
          .toUpperCase() ===
        'VERIFIED';

      const booleanVerified =
        Boolean(
          kycVerified.value,
        );

      if (
        statusVerified !==
        booleanVerified
      ) {
        contradictions.push({
          code:
            'KYC_STATUS_VERIFICATION_CONTRADICTION',

          reason:
            'KYC status and KYC verification flag disagree.',

          remediation:
            'Resolve the KYC source-of-truth discrepancy before proceeding.',

          fields: [
            {
              path:
                'customer.kyc.status',

              present:
                true,

              valueDigest:
                digestSensitiveValue(
                  kycStatus.value,
                ),

              sensitive:
                false,
            },

            {
              path:
                'customer.kyc.verified',

              present:
                true,

              valueDigest:
                digestSensitiveValue(
                  kycVerified.value,
                ),

              sensitive:
                false,
            },
          ],
        });
      }
    }

    const amlStatus =
      extractEvidenceValue(
        evidence,
        'customer.aml.status',
      );

    const amlCleared =
      extractEvidenceValue(
        evidence,
        'customer.aml.cleared',
      );

    if (
      amlStatus.exists &&
      amlCleared.exists
    ) {
      const statusCleared =
        [
          'CLEAR',
          'CLEARED',
          'PASS',
          'PASSED',
        ].includes(
          String(
            amlStatus.value,
          )
            .trim()
            .toUpperCase(),
        );

      const booleanCleared =
        Boolean(
          amlCleared.value,
        );

      if (
        statusCleared !==
        booleanCleared
      ) {
        contradictions.push({
          code:
            'AML_STATUS_CLEARANCE_CONTRADICTION',

          reason:
            'AML status and AML clearance flag disagree.',

          remediation:
            'Resolve the AML source-of-truth discrepancy before proceeding.',

          fields: [
            {
              path:
                'customer.aml.status',

              present:
                true,

              valueDigest:
                digestSensitiveValue(
                  amlStatus.value,
                ),

              sensitive:
                false,
            },

            {
              path:
                'customer.aml.cleared',

              present:
                true,

              valueDigest:
                digestSensitiveValue(
                  amlCleared.value,
                ),

              sensitive:
                false,
            },
          ],
        });
      }
    }

    return contradictions;
  }

  #safeTransactionIdentity(
    transaction,
  ) {
    if (
      !isPlainObject(
        transaction,
      )
    ) {
      return {};
    }

    const safe = {};

    for (
      const key of [
        'transactionId',
        'paymentId',
        'idempotencyKey',
        'providerTransactionId',
        'providerReference',
        'amount',
        'currency',
        'operation',
        'purpose',
      ]
    ) {
      if (
        transaction[key] ===
          undefined ||
        transaction[key] ===
          null
      ) {
        continue;
      }

      safe[key] =
        sanitizeSensitivePath(
          key,
        )
          ? digestSensitiveValue(
              transaction[key],
            )
          : transaction[key];
    }

    return safe;
  }

  #evidenceFingerprint(
    evidence,
    policyPack = null,
  ) {
    const candidatePaths =
      new Set([
        'provider.transactionId',
        'provider.reference',
        'provider.amount',
        'provider.currency',

        'local.providerTransactionId',
        'local.providerReference',
        'local.amount',
        'local.currency',

        'financial.amount',
        'financial.currency',

        'customer.kyc.status',
        'customer.kyc.verified',

        'customer.aml.status',
        'customer.aml.cleared',
      ]);

    for (
      const rule of
        policyPack?.rules ||
        []
    ) {
      for (
        const path of
          rule.requiredEvidence ||
          []
      ) {
        candidatePaths.add(
          path,
        );
      }

      for (
        const assertion of
          rule.assertions ||
          []
      ) {
        candidatePaths.add(
          assertion.path,
        );
      }

      for (
        const assertion of
          rule.appliesWhen ||
          []
      ) {
        candidatePaths.add(
          assertion.path,
        );
      }
    }

    const manifest = [];

    for (
      const path of [
        ...candidatePaths,
      ]
        .sort()
        .slice(
          0,
          this.config
            .maxDecisionEvidencePaths,
        )
    ) {
      let found;

      try {
        found =
          extractEvidenceValue(
            evidence,
            path,
          );
      } catch {
        found = {
          exists: false,
          value: undefined,
        };
      }

      manifest.push({
        path,

        exists:
          Boolean(
            found.exists,
          ),

        valueType:
          found.exists
            ? Array.isArray(
                found.value,
              )
              ? 'array'
              : found.value ===
                  null
                ? 'null'
                : typeof found.value
            : 'missing',

        valueDigest:
          found.exists
            ? digestSensitiveValue(
                found.value,
              )
            : null,
      });
    }

    return sha256(
      manifest,
    );
  }

  #recommendedAction(
    decision,
    findings,
  ) {
    if (
      decision === 'BLOCK'
    ) {
      return 'BLOCK_PAYMENT_PENDING_COMPLIANCE_RESOLUTION';
    }

    if (
      decision === 'REVIEW'
    ) {
      return 'REQUIRE_COMPLIANCE_REVIEW';
    }

    if (
      decision === 'NO_POLICY'
    ) {
      return 'DEFER_UNTIL_POLICY_RESOLVED';
    }

    if (
      decision ===
      'ALLOW_WITH_REPORTING'
    ) {
      return 'ALLOW_WITH_REPORTING_OBLIGATION';
    }

    return 'ALLOW_SUBJECT_TO_PAYMENT_ORCHESTRATOR_AND_FINANCIAL_CORE';
  }

  async #resolvePolicyPack(
    context,
    diagnostics,
  ) {
    const methodNames = [
      'resolve',
      'resolvePolicyPack',
      'getApplicablePolicyPack',
      'getPolicyPack',
      'findApplicablePolicyPack',
    ];

    const methodName =
      methodNames.find(
        name =>
          typeof this
            .policyResolver?.[name] ===
          'function',
      );

    if (!methodName) {
      diagnostics.push({
        integration:
          'policyResolver',

        status:
          'UNAVAILABLE',

        code:
          'REGULATORY_POLICY_RESOLVER_METHOD_NOT_FOUND',
      });

      return null;
    }

    const payload = {
      tenantId:
        context.tenantId,

      provider:
        context.provider,

      operation:
        context.operation,

      jurisdiction:
        context.jurisdiction,

      country:
        context.country,

      channel:
        context.channel,

      currency:
        context.currency,

      productType:
        context.productType,

      mode:
        context.mode,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };

    try {
      const raw =
        await this.#withTimeout(
          Promise.resolve(
            this.policyResolver[
              methodName
            ](payload),
          ),
          this.config
            .resolverTimeoutMs,
        );

      const policy =
        raw?.policyPack ??
        raw?.policy ??
        raw;

      if (!policy) {
        diagnostics.push({
          integration:
            'policyResolver',

          status:
            'EMPTY',

          method:
            methodName,
        });

        return null;
      }

      diagnostics.push({
        integration:
          'policyResolver',

        status:
          'OK',

        method:
          methodName,
      });

      return policy;
    } catch (error) {
      diagnostics.push({
        integration:
          'policyResolver',

        status:
          'FAILED',

        method:
          methodName,

        code:
          error?.code ||
          'REGULATORY_POLICY_RESOLVER_FAILED',
      });

      this.#log('warn', {
        event:
          'airtel_regulatory_policy_resolver_failed',

        tenantId:
          context.tenantId,

        provider:
          context.provider,

        jurisdiction:
          context.jurisdiction,

        code:
          error?.code ||
          'REGULATORY_POLICY_RESOLVER_FAILED',
      });

      return null;
    }
  }

  async #withTimeout(
    promise,
    timeoutMs = 5000,
  ) {
    const bounded =
      Math.min(
        30000,
        Math.max(
          50,
          Math.trunc(
            finiteNumber(
              timeoutMs,
              5000,
            ),
          ),
        ),
      );

    let timer;

    const timeout =
      new Promise(
        (_, reject) => {
          timer =
            setTimeout(
              () => {
                const error =
                  new Error(
                    'Regulatory intelligence integration timed out.',
                  );

                error.code =
                  'REGULATORY_INTEGRATION_TIMEOUT';

                reject(error);
              },
              bounded,
            );

          timer.unref?.();
        },
      );

    try {
      return await Promise.race(
        [
          Promise.resolve(
            promise,
          ),

          timeout,
        ],
      );
    } finally {
      clearTimeout(timer);
    }
  }

  #metricIncrement(
    name,
    value = 1,
  ) {
    try {
      if (
        typeof this.metrics
          ?.increment ===
        'function'
      ) {
        this.metrics.increment(
          name,
          value,
        );

        return;
      }

      if (
        typeof this.metrics?.inc ===
        'function'
      ) {
        this.metrics.inc(
          name,
          value,
        );

        return;
      }

      if (
        typeof this.metrics
          ?.counter ===
        'function'
      ) {
        this.metrics.counter(
          name,
          value,
        );
      }
    } catch {
      // Metrics failure must never change a compliance decision.
    }
  }

  #log(
    level,
    payload,
  ) {
    try {
      const logger =
        this.logger;

      if (!logger) return;

      const method =
        typeof logger[level] ===
        'function'
          ? logger[level]
          : logger.info;

      method?.call(
        logger,
        payload,
      );
    } catch {
      // Logging failure must never change the evaluation outcome.
    }
  }
}

function policyStatusAllowedHelper(
  status,
  mode,
  options,
) {
  const statuses =
    mode === 'ENFORCE'
      ? options
          .allowedEnforcePolicyStatuses
      : mode ===
          'PREVIEW'
        ? options
            .allowedPreviewPolicyStatuses
        : options
            .allowedAdvisoryPolicyStatuses;

  return statuses.includes(
    status,
  );
}

// =============================================================================
// Factory / singleton
// =============================================================================

export function createRegulatoryIntelligence(
  options = {},
) {
  return new AirtelRegulatoryIntelligence(
    options,
  );
}

export const defaultRegulatoryIntelligence =
  new AirtelRegulatoryIntelligence();

export const regulatoryIntelligence =
  defaultRegulatoryIntelligence;

export {
  normalizePolicyPack,
  normalizeNotice,
  compareDecimal,
};

export default AirtelRegulatoryIntelligence;