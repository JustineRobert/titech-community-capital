/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/complianceCenter.js
 *
 * Architectural role
 * ------------------
 * Enterprise compliance command-center aggregation and case-management
 * boundary for Airtel payment intelligence.
 *
 * The Compliance Center consumes authoritative/externally governed regulatory
 * intelligence, KYC/AML/sanctions/compliance evidence, governance signals,
 * approval metadata, operational alerts, and related findings. It converts
 * those signals into a bounded tenant-scoped compliance posture and an
 * auditable compliance-case view for operations, compliance officers, risk
 * teams, reviewers, and command-center APIs.
 *
 * The component is deliberately an orchestration/visibility layer. It does not
 * create a second regulatory rule engine, does not make legal determinations,
 * and does not authorize or execute financial transactions.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT legal advice and does not independently determine what law requires.
 * - NOT a KYC/AML/sanctions source-of-truth engine.
 * - NOT the regulatory policy source of truth.
 * - NOT the financial source of truth.
 * - NOT the canonical double-entry ledger.
 * - NOT a payment execution or settlement service.
 * - NOT an Airtel provider adapter.
 * - NOT a governance policy engine.
 * - NOT an approval workflow or maker-checker state machine.
 * - NOT a sanctions screening engine.
 * - NOT a transaction monitoring engine.
 * - NOT a model-training or model-serving component.
 * - NOT an immutable audit ledger.
 * - NOT a notification transport implementation.
 * - NOT an arbitrary command executor.
 * - NOT allowed to mutate balances, financial transactions, settlements or
 *   ledger state.
 * - NOT allowed to approve, authorize, reject, settle, reverse, refund or
 *   otherwise execute a payment.
 *
 * Production principles
 * ---------------------
 * - Tenant context is mandatory by default and is propagated through every
 *   read, persistence, deduplication, case and alert boundary.
 * - Provider scope is fail-closed to AIRTEL.
 * - Jurisdiction is explicit for compliance assessment when required; the
 *   center never invents jurisdiction-specific obligations.
 * - Regulatory findings remain attributable to their source engine and policy
 *   version; the center does not silently rewrite them.
 * - Missing, stale, conflicting and unavailable evidence are distinct states.
 * - A compliance BLOCK/REVIEW is a compliance control result and is never
 *   converted into a financial-core mutation by this module.
 * - Case records use deterministic semantic fingerprints, tenant-scoped
 *   idempotency and bounded evidence/findings/metadata.
 * - Compliance-case lifecycle transitions are explicit and auditable but do
 *   not duplicate approval-workflow semantics.
 * - Sensitive identifiers are digested. Secrets, authentication data, OTP/PIN,
 *   raw provider payloads and unnecessary raw PII are never persisted.
 * - Audit writes are append-only through an injected adapter.
 * - Alerts are delegated to the Alert Manager when configured; notification
 *   delivery remains outside this module.
 * - Persistence is injected through a durable repository. In-memory storage is
 *   provided only for test/local development.
 * - No internal scheduler is created. Call processDueEscalations/processDueStale
 *   from a trusted platform scheduler.
 * - Results are immutable to callers after construction.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-command-center-compliance-center';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const COMPLIANCE_OUTCOMES = Object.freeze({
  PASS: 'PASS',
  ALLOW_WITH_REPORTING: 'ALLOW_WITH_REPORTING',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
  NO_POLICY: 'NO_POLICY',
  INDETERMINATE: 'INDETERMINATE',
});

export const CASE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  ESCALATED: 'ESCALATED',
  BLOCKED: 'BLOCKED',
  CLEARED: 'CLEARED',
  CLOSED: 'CLOSED',
});

export const CASE_PRIORITY = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const EVIDENCE_STATE = Object.freeze({
  VERIFIED: 'VERIFIED',
  PRESENT: 'PRESENT',
  MISSING: 'MISSING',
  STALE: 'STALE',
  CONFLICTING: 'CONFLICTING',
  UNAVAILABLE: 'UNAVAILABLE',
  UNVERIFIED: 'UNVERIFIED',
  INVALID: 'INVALID',
});

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

export const COMPLIANCE_ACTIONS = Object.freeze({
  REVIEW: 'REVIEW',
  REQUEST_EVIDENCE: 'REQUEST_EVIDENCE',
  ESCALATE: 'ESCALATE',
  CLEAR: 'CLEAR',
  CLOSE: 'CLOSE',
  MONITOR: 'MONITOR',
});

export const COMPLIANCE_CENTER_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'COMPLIANCE_CENTER_INVALID_INPUT',
  TENANT_REQUIRED: 'COMPLIANCE_CENTER_TENANT_REQUIRED',
  PROVIDER_SCOPE_VIOLATION: 'COMPLIANCE_CENTER_PROVIDER_SCOPE_VIOLATION',
  JURISDICTION_REQUIRED: 'COMPLIANCE_CENTER_JURISDICTION_REQUIRED',
  ASSESSMENT_REQUIRED: 'COMPLIANCE_CENTER_ASSESSMENT_REQUIRED',
  CASE_REQUIRED: 'COMPLIANCE_CENTER_CASE_REQUIRED',
  CASE_NOT_FOUND: 'COMPLIANCE_CENTER_CASE_NOT_FOUND',
  RULE_ENGINE_REQUIRED: 'COMPLIANCE_CENTER_RULE_ENGINE_REQUIRED',
  SOURCE_UNAVAILABLE: 'COMPLIANCE_CENTER_SOURCE_UNAVAILABLE',
  REPOSITORY_REQUIRED: 'COMPLIANCE_CENTER_REPOSITORY_REQUIRED',
  REPOSITORY_UNAVAILABLE: 'COMPLIANCE_CENTER_REPOSITORY_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'COMPLIANCE_CENTER_IDEMPOTENCY_CONFLICT',
  FINGERPRINT_CONFLICT: 'COMPLIANCE_CENTER_FINGERPRINT_CONFLICT',
  INVALID_TRANSITION: 'COMPLIANCE_CENTER_INVALID_TRANSITION',
  TRANSITION_NOT_ALLOWED: 'COMPLIANCE_CENTER_TRANSITION_NOT_ALLOWED',
  EVIDENCE_INVALID: 'COMPLIANCE_CENTER_EVIDENCE_INVALID',
  EVIDENCE_REQUIRED: 'COMPLIANCE_CENTER_EVIDENCE_REQUIRED',
  PAYLOAD_TOO_LARGE: 'COMPLIANCE_CENTER_PAYLOAD_TOO_LARGE',
  QUERY_TOO_LARGE: 'COMPLIANCE_CENTER_QUERY_TOO_LARGE',
  FINANCIAL_EXECUTION_FORBIDDEN: 'COMPLIANCE_CENTER_FINANCIAL_EXECUTION_FORBIDDEN',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  jurisdictionRequired: true,
  maxTenantIdLength: 160,
  maxJurisdictionLength: 120,
  maxCaseIdLength: 180,
  maxDecisionIdLength: 180,
  maxAssessmentIdLength: 180,
  maxIdempotencyKeyLength: 320,
  maxTitleLength: 240,
  maxSummaryLength: 1800,
  maxReasonLength: 1000,
  maxEvidenceItems: 250,
  maxFindingItems: 250,
  maxControlItems: 100,
  maxSourceReferences: 100,
  maxTags: 50,
  maxMetadataKeys: 100,
  maxQueryLimit: 250,
  defaultQueryLimit: 50,
  maxPayloadBytes: 768 * 1024,
  maxExportBytes: 2 * 1024 * 1024,
  defaultEscalationAfterMinutes: 60,
  maxEscalationAfterMinutes: 30 * 24 * 60,
  defaultStaleAfterMinutes: 24 * 60,
  maxStaleAfterMinutes: 30 * 24 * 60,
  failClosedOnSourceError: true,
  failClosedOnRepositoryError: true,
  failClosedOnAuditError: false,
  createAlertForReview: true,
  createAlertForBlock: true,
  requireAuthoritativeEvidenceForClear: true,
});

const CASE_TRANSITIONS = Object.freeze({
  [CASE_STATUS.OPEN]: Object.freeze([
    CASE_STATUS.REVIEW_REQUIRED,
    CASE_STATUS.ESCALATED,
    CASE_STATUS.BLOCKED,
    CASE_STATUS.CLEARED,
    CASE_STATUS.CLOSED,
  ]),
  [CASE_STATUS.REVIEW_REQUIRED]: Object.freeze([
    CASE_STATUS.OPEN,
    CASE_STATUS.ESCALATED,
    CASE_STATUS.BLOCKED,
    CASE_STATUS.CLEARED,
    CASE_STATUS.CLOSED,
  ]),
  [CASE_STATUS.ESCALATED]: Object.freeze([
    CASE_STATUS.REVIEW_REQUIRED,
    CASE_STATUS.BLOCKED,
    CASE_STATUS.CLEARED,
    CASE_STATUS.CLOSED,
  ]),
  [CASE_STATUS.BLOCKED]: Object.freeze([
    CASE_STATUS.REVIEW_REQUIRED,
    CASE_STATUS.ESCALATED,
    CASE_STATUS.CLEARED,
    CASE_STATUS.CLOSED,
  ]),
  [CASE_STATUS.CLEARED]: Object.freeze([
    CASE_STATUS.CLOSED,
    CASE_STATUS.REVIEW_REQUIRED,
  ]),
  [CASE_STATUS.CLOSED]: Object.freeze([]),
});

const OUTCOME_RANK = Object.freeze({
  [COMPLIANCE_OUTCOMES.PASS]: 0,
  [COMPLIANCE_OUTCOMES.ALLOW_WITH_REPORTING]: 1,
  [COMPLIANCE_OUTCOMES.REVIEW]: 2,
  [COMPLIANCE_OUTCOMES.BLOCK]: 3,
  [COMPLIANCE_OUTCOMES.NO_POLICY]: 4,
  [COMPLIANCE_OUTCOMES.INDETERMINATE]: 5,
});

const PRIORITY_RANK = Object.freeze({
  [CASE_PRIORITY.LOW]: 0,
  [CASE_PRIORITY.MEDIUM]: 1,
  [CASE_PRIORITY.HIGH]: 2,
  [CASE_PRIORITY.CRITICAL]: 3,
});

const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /otp/i,
  /pin/i,
  /cvv/i,
  /cvc/i,
  /pan/i,
  /private.?key/i,
  /api.?key/i,
  /access.?key/i,
  /credential/i,
  /signature/i,
  /raw.?payload/i,
  /raw.?request/i,
  /raw.?response/i,
]);

const IDENTIFIER_KEY_PATTERNS = Object.freeze([
  /^phone$/i,
  /phone(number)?/i,
  /msisdn/i,
  /email/i,
  /national.?id/i,
  /^nin$/i,
  /account(number)?/i,
  /bank.?account/i,
  /wallet(number|id)?/i,
  /customer(number|id)?/i,
  /device.?id/i,
  /ip(address)?/i,
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeString(value, maxLength = 200) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function upper(value, maxLength = 80) {
  return normalizeString(value, maxLength)?.toUpperCase();
}

function toInteger(
  value,
  fallback,
  {
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
  } = {},
) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function toIso(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function addMinutes(dateIso, minutes) {
  return new Date(new Date(dateIso).getTime() + Number(minutes) * 60_000).toISOString();
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableNormalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return 'NaN';
    return value > 0 ? 'Infinity' : '-Infinity';
  }

  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `base64:${value.toString('base64')}`;
  if (value instanceof Uint8Array) return `base64:${Buffer.from(value).toString('base64')}`;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => stableNormalize(item, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value.toJSON === 'function' && !isPlainObject(value)) {
    const result = stableNormalize(value.toJSON(), seen);
    seen.delete(value);
    return result;
  }

  const result = Object.create(null);

  for (const key of Object.keys(value).sort()) {
    result[key] = stableNormalize(value[key], seen);
  }

  seen.delete(value);
  return result;
}

function canonicalize(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  const input =
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value
      : canonicalize(value);

  return createHash(HASH_ALGORITHM)
    .update(input)
    .digest('hex');
}

function digest(value) {
  return `sha256:${sha256(String(value)).slice(0, 40)}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

function redact(
  value,
  key = '',
  depth = 0,
  maxDepth = 8,
) {
  if (depth > maxDepth) return '[TRUNCATED]';
  if (value === undefined || value === null) return value;

  if (
    SENSITIVE_KEY_PATTERNS.some(
      (pattern) => pattern.test(key),
    )
  ) {
    return '[REDACTED]';
  }

  if (
    IDENTIFIER_KEY_PATTERNS.some(
      (pattern) => pattern.test(key),
    )
  ) {
    return digest(value);
  }

  if (typeof value !== 'object') {
    return (
      typeof value === 'string'
      && value.length > 700
    )
      ? `${value.slice(0, 697)}...`
      : value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(value)
    || value instanceof Uint8Array
  ) {
    return '[BINARY_REDACTED]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map(
        (item) =>
          redact(
            item,
            '',
            depth + 1,
            maxDepth,
          ),
      );
  }

  const result = Object.create(null);

  for (
    const childKey
    of Object.keys(value).slice(0, 250)
  ) {
    result[childKey] =
      redact(
        value[childKey],
        childKey,
        depth + 1,
        maxDepth,
      );
  }

  return result;
}

function safeError(error) {
  if (!error) return null;

  return {
    name:
      normalizeString(
        error.name,
        120,
      ) ?? 'Error',

    code:
      normalizeString(
        error.code,
        180,
      ) ?? null,

    message:
      normalizeString(
        error.message,
        700,
      ) ?? 'Unknown error',

    retryable:
      Boolean(
        error.retryable,
      ),
  };
}

function normalizeOutcome(value) {
  const candidate = upper(value, 60);

  if (!candidate) {
    return COMPLIANCE_OUTCOMES.INDETERMINATE;
  }

  if (
    Object.values(
      COMPLIANCE_OUTCOMES,
    ).includes(candidate)
  ) {
    return candidate;
  }

  if (candidate === 'ALLOW') {
    return COMPLIANCE_OUTCOMES.PASS;
  }

  if (candidate === 'ALLOW_WITH_CONTROLS') {
    return COMPLIANCE_OUTCOMES.ALLOW_WITH_REPORTING;
  }

  if (candidate === 'REVIEW_REQUIRED') {
    return COMPLIANCE_OUTCOMES.REVIEW;
  }

  if (candidate === 'REQUIRE_REVIEW') {
    return COMPLIANCE_OUTCOMES.REVIEW;
  }

  if (candidate === 'REQUIRE_EVIDENCE') {
    return COMPLIANCE_OUTCOMES.REVIEW;
  }

  if (candidate === 'NO_POLICY') {
    return COMPLIANCE_OUTCOMES.NO_POLICY;
  }

  return COMPLIANCE_OUTCOMES.INDETERMINATE;
}

function normalizeCaseStatus(value) {
  const candidate = upper(
    value,
    50,
  );

  return Object.values(
    CASE_STATUS,
  ).includes(candidate)
    ? candidate
    : CASE_STATUS.OPEN;
}

function normalizePriority(
  value,
  fallback = CASE_PRIORITY.MEDIUM,
) {
  const candidate = upper(
    value,
    30,
  );

  return Object.values(
    CASE_PRIORITY,
  ).includes(candidate)
    ? candidate
    : fallback;
}

function normalizeSeverity(value) {
  const candidate = upper(
    value,
    30,
  );

  return Object.prototype.hasOwnProperty.call(
    SEVERITY_RANK,
    candidate,
  )
    ? candidate
    : 'INFO';
}

function maxSeverity(values) {
  return values.reduce(
    (current, value) => {
      const candidate = normalizeSeverity(
        value,
      );

      return SEVERITY_RANK[candidate]
        > SEVERITY_RANK[current]
        ? candidate
        : current;
    },
    'INFO',
  );
}

function maxOutcome(values) {
  return values.reduce(
    (current, value) => {
      const candidate = normalizeOutcome(
        value,
      );

      return OUTCOME_RANK[candidate]
        > OUTCOME_RANK[current]
        ? candidate
        : current;
    },
    COMPLIANCE_OUTCOMES.PASS,
  );
}

function priorityFromSeverity(
  severity,
) {
  switch (
    normalizeSeverity(
      severity,
    )
  ) {
    case 'CRITICAL':
      return CASE_PRIORITY.CRITICAL;

    case 'HIGH':
      return CASE_PRIORITY.HIGH;

    case 'MEDIUM':
      return CASE_PRIORITY.MEDIUM;

    default:
      return CASE_PRIORITY.LOW;
  }
}

function normalizeTags(
  value,
  max = 50,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            normalizeString(
              item,
              80,
            ),
        )
        .filter(Boolean),
    ),
  ].slice(
    0,
    max,
  );
}

function normalizeList(
  value,
  max = 100,
  maxLength = 180,
) {
  if (
    typeof value
      === 'string'
  ) {
    value = [
      value,
    ];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            isPlainObject(item)
              ? item.code
                ?? item.id
                ?? item.name
              : item,
        )
        .map(
          (item) =>
            normalizeString(
              item,
              maxLength,
            ),
        )
        .filter(Boolean),
    ),
  ].slice(
    0,
    max,
  );
}

function normalizeEvidence(
  value,
  config,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(
      0,
      config.maxEvidenceItems,
    )
    .map(
      (item) => {
        if (!isPlainObject(item)) {
          return {
            evidenceType:
              'REFERENCE',

            referenceDigest:
              digest(item),

            state:
              EVIDENCE_STATE.UNVERIFIED,
          };
        }

        return {
          evidenceId:
            item.evidenceId
              ? digest(
                  item.evidenceId,
                )
              : null,

          type:
            normalizeString(
              item.type
                ?? item.evidenceType,
              100,
            )
            ?? 'UNKNOWN',

          source:
            normalizeString(
              item.source
                ?? item.sourceSystem,
              160,
            )
            ?? null,

          sourceReference:
            item.sourceReference
              ? digest(
                  item.sourceReference,
                )
              : null,

          state:
            upper(
              item.state
                ?? item.status,
              50,
            )
            ?? EVIDENCE_STATE.PRESENT,

          authoritative:
            item.authoritative
            === true,

          fresh:
            item.fresh !== false,

          capturedAt:
            toIso(
              item.capturedAt
                ?? item.observedAt,
              null,
            ),

          staleAt:
            toIso(
              item.staleAt,
              null,
            ),

          valueDigest:
            item.valueDigest
            ?? (
              item.value !== undefined
                ? digest(
                    item.value,
                  )
                : null
            ),

          documentDigest:
            normalizeString(
              item.documentDigest,
              180,
            )
            ?? null,

          description:
            normalizeString(
              item.description,
              700,
            )
            ?? null,

          metadata:
            redact(
              item.metadata
              ?? {},
            ),
        };
      },
    );
}

function normalizeFindings(
  value,
  config,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(
      0,
      config.maxFindingItems,
    )
    .map(
      (item) => {
        if (!isPlainObject(item)) {
          return null;
        }

        const controlFamily =
          upper(
            item.controlFamily,
            80,
          );

        return {
          findingId:
            item.findingId
              ? digest(
                  item.findingId,
                )
              : null,

          code:
            normalizeString(
              item.code
                ?? item.ruleCode
                ?? item.findingCode,
              config.maxReasonLength,
            )
            ?? 'UNSPECIFIED',

          ruleId:
            normalizeString(
              item.ruleId,
              180,
            )
            ?? null,

          ruleVersion:
            normalizeString(
              item.ruleVersion
                ?? item.version,
              100,
            )
            ?? null,

          controlFamily:
            CONTROL_FAMILIES.includes(
              controlFamily,
            )
              ? controlFamily
              : 'OTHER',

          result:
            upper(
              item.result,
              50,
            )
            ?? null,

          outcome:
            normalizeOutcome(
              item.outcome,
            ),

          severity:
            normalizeSeverity(
              item.severity,
            ),

          mandatory:
            item.mandatory !== false,

          reason:
            normalizeString(
              item.reason
                ?? item.explanation,
              config.maxReasonLength,
            )
            ?? null,

          conflict:
            item.conflict
            === true,

          blocksPayment:
            item.blocksPayment
            === true,

          remediation:
            normalizeString(
              item.remediation,
              1000,
            )
            ?? null,

          sourceRefs:
            Array.isArray(
              item.sourceRefs,
            )
              ? item.sourceRefs
                  .slice(
                    0,
                    config.maxSourceReferences,
                  )
                  .map(
                    (source) =>
                      redact(
                        source,
                      ),
                  )
              : [],

          evidence:
            normalizeEvidence(
              item.evidence,
              config,
            ),
        };
      },
    )
    .filter(Boolean);
}

function normalizeSourceSummary(
  source,
) {
  if (!isPlainObject(source)) {
    return null;
  }

  return {
    component:
      normalizeString(
        source.component
          ?? source.engine
          ?? source.name,
        160,
      )
      ?? 'UNKNOWN',

    version:
      normalizeString(
        source.version
          ?? source.engineVersion,
        100,
      )
      ?? null,

    fingerprint:
      normalizeString(
        source.fingerprint
          ?? source.decisionFingerprint
          ?? source.governanceFingerprint,
        180,
      )
      ?? null,

    outcome:
      normalizeOutcome(
        source.outcome
          ?? source.decision,
      ),

    confidence:
      Number.isFinite(
        Number(
          source.confidence,
        ),
      )
        ? Number(
            source.confidence,
          )
        : null,

    available:
      source.available !== false,

    evidenceState:
      upper(
        source.evidenceState
          ?? source.evidenceStatus,
        60,
      )
      ?? EVIDENCE_STATE.PRESENT,
  };
}

function assertPlainObject(
  value,
  name,
) {
  if (!isPlainObject(value)) {
    throw new ComplianceCenterError(
      COMPLIANCE_CENTER_ERROR_CODES
        .INVALID_INPUT,

      `${name} must be an object.`,
    );
  }
}

function assertProvider(
  provider,
) {
  const normalized =
    upper(
      provider
        ?? PROVIDER,
      30,
    );

  if (
    normalized
      !== PROVIDER
  ) {
    throw new ComplianceCenterError(
      COMPLIANCE_CENTER_ERROR_CODES
        .PROVIDER_SCOPE_VIOLATION,

      `Compliance Center scope is ${PROVIDER}.`,

      {
        provider:
          normalized,
      },
    );
  }

  return PROVIDER;
}

function assertTenant(
  tenantId,
  config,
) {
  const normalized =
    normalizeString(
      tenantId,
      config.maxTenantIdLength,
    );

  if (
    config.tenantRequired
    && !normalized
  ) {
    throw new ComplianceCenterError(
      COMPLIANCE_CENTER_ERROR_CODES
        .TENANT_REQUIRED,

      'tenantId is required.',
    );
  }

  return normalized;
}

function normalizeJurisdiction(
  jurisdiction,
  config,
) {
  const normalized =
    normalizeString(
      jurisdiction,
      config.maxJurisdictionLength,
    );

  if (
    config.jurisdictionRequired
    && !normalized
  ) {
    throw new ComplianceCenterError(
      COMPLIANCE_CENTER_ERROR_CODES
        .JURISDICTION_REQUIRED,

      'jurisdiction is required for compliance assessment.',
    );
  }

  return normalized?.toUpperCase();
}

function validateTransition(
  currentStatus,
  nextStatus,
) {
  if (
    currentStatus
      === nextStatus
  ) {
    return;
  }

  if (
    !CASE_TRANSITIONS[
      currentStatus
    ]?.includes(
      nextStatus,
    )
  ) {
    throw new ComplianceCenterError(
      COMPLIANCE_CENTER_ERROR_CODES
        .TRANSITION_NOT_ALLOWED,

      `Compliance case transition ${currentStatus} -> ${nextStatus} is not allowed.`,

      {
        currentStatus,
        nextStatus,
      },
    );
  }
}

function compactSourceDecision(
  source,
) {
  const summary =
    normalizeSourceSummary(
      source,
    );

  return summary
    ? redact(summary)
    : null;
}

export class ComplianceCenterError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'ComplianceCenterError';

    this.code =
      code;

    this.details =
      redact(details);

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.httpStatus =
      Number.isFinite(
        options.httpStatus,
      )
        ? options.httpStatus
        : 400;

    this.cause =
      options.cause;
  }
}

export class InMemoryComplianceCenterRepository {
  constructor(
    seed = {},
  ) {
    this.cases =
      Array.isArray(
        seed.cases,
      )
        ? clone(
            seed.cases,
          )
        : [];

    this.assessments =
      Array.isArray(
        seed.assessments,
      )
        ? clone(
            seed.assessments,
          )
        : [];
  }

  async saveCase(
    record,
  ) {
    const existing =
      this.cases.find(
        (item) =>
          item.tenantId
            === record.tenantId
          && item.caseId
            === record.caseId,
      );

    if (existing) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .FINGERPRINT_CONFLICT,

        'Compliance case already exists.',
      );
    }

    this.cases.push(
      clone(record),
    );

    return clone(record);
  }

  async findCase({
    tenantId,
    caseId,
  }) {
    return clone(
      this.cases.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.caseId
            === caseId,
      )
      ?? null,
    );
  }

  async findCaseByIdempotencyKey({
    tenantId,
    idempotencyKey,
  }) {
    return clone(
      this.cases.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.idempotencyKey
            === idempotencyKey,
      )
      ?? null,
    );
  }

  async findActiveByFingerprint({
    tenantId,
    semanticFingerprint,
  }) {
    return clone(
      this.cases.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.semanticFingerprint
            === semanticFingerprint
          && [
            CASE_STATUS.OPEN,
            CASE_STATUS.REVIEW_REQUIRED,
            CASE_STATUS.ESCALATED,
            CASE_STATUS.BLOCKED,
          ].includes(
            item.status,
          ),
      )
      ?? null,
    );
  }

  async updateCase({
    tenantId,
    caseId,
    patch,
    expectedVersion,
  }) {
    const index =
      this.cases.findIndex(
        (item) =>
          item.tenantId
            === tenantId
          && item.caseId
            === caseId,
      );

    if (index < 0) {
      return null;
    }

    const current =
      this.cases[
        index
      ];

    if (
      expectedVersion
        !== undefined
      && expectedVersion
        !== null
      && current.version
        !== expectedVersion
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .TRANSITION_NOT_ALLOWED,

        'Compliance case version conflict.',
      );
    }

    this.cases[
      index
    ] = {
      ...current,

      ...clone(
        patch,
      ),

      version:
        (
          current.version
          ?? 0
        )
        + 1,
    };

    return clone(
      this.cases[
        index
      ],
    );
  }

  async saveAssessment(
    record,
  ) {
    this.assessments.push(
      clone(record),
    );

    return clone(record);
  }

  async findAssessmentByIdempotencyKey({
    tenantId,
    idempotencyKey,
  }) {
    return clone(
      this.assessments.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.idempotencyKey
            === idempotencyKey,
      )
      ?? null,
    );
  }

  async listCases({
    tenantId,
    statuses,
    priorities,
    jurisdictions,
    controlFamilies,
    limit = 50,
    offset = 0,
  } = {}) {
    const rows =
      this.cases
        .filter(
          (item) =>
            item.tenantId
              === tenantId,
        )
        .filter(
          (item) =>
            !statuses?.length
            || statuses.includes(
              item.status,
            ),
        )
        .filter(
          (item) =>
            !priorities?.length
            || priorities.includes(
              item.priority,
            ),
        )
        .filter(
          (item) =>
            !jurisdictions?.length
            || jurisdictions.includes(
              item.jurisdiction,
            ),
        )
        .filter(
          (item) =>
            !controlFamilies?.length
            || controlFamilies.some(
              (value) =>
                item.controlFamilies?.includes(
                  value,
                ),
            ),
        )
        .sort(
          (a, b) =>
            String(
              b.createdAt
                ?? '',
            ).localeCompare(
              String(
                a.createdAt
                  ?? '',
              ),
            ),
        );

    return {
      entries:
        rows
          .slice(
            offset,
            offset + limit,
          )
          .map(
            clone,
          ),

      total:
        rows.length,

      limit,
      offset,

      hasMore:
        offset + limit
          < rows.length,
    };
  }

  async countByStatus({
    tenantId,
  }) {
    const counts =
      Object.fromEntries(
        Object.values(
          CASE_STATUS,
        ).map(
          (status) => [
            status,
            0,
          ],
        ),
      );

    for (
      const item
      of this.cases
    ) {
      if (
        item.tenantId
          === tenantId
        && counts[
          item.status
        ]
          !== undefined
      ) {
        counts[
          item.status
        ] += 1;
      }
    }

    return counts;
  }

  async listDueEscalations({
    tenantId,
    now,
    limit = 50,
  }) {
    const nowMs =
      new Date(
        now,
      ).getTime();

    return this.cases
      .filter(
        (item) =>
          item.tenantId
            === tenantId,
      )
      .filter(
        (item) =>
          [
            CASE_STATUS.OPEN,
            CASE_STATUS.REVIEW_REQUIRED,
          ].includes(
            item.status,
          ),
      )
      .filter(
        (item) =>
          item.escalateAt
          && new Date(
            item.escalateAt,
          ).getTime()
            <= nowMs,
      )
      .slice(
        0,
        limit,
      )
      .map(
        clone,
      );
  }

  async listDueStaleCases({
    tenantId,
    now,
    limit = 50,
  }) {
    const nowMs =
      new Date(
        now,
      ).getTime();

    return this.cases
      .filter(
        (item) =>
          item.tenantId
            === tenantId,
      )
      .filter(
        (item) =>
          ![
            CASE_STATUS.CLOSED,
            CASE_STATUS.CLEARED,
          ].includes(
            item.status,
          ),
      )
      .filter(
        (item) =>
          item.staleAt
          && new Date(
            item.staleAt,
          ).getTime()
            <= nowMs,
      )
      .slice(
        0,
        limit,
      )
      .map(
        clone,
      );
  }

  async healthCheck() {
    return {
      ok: true,

      component:
        'in-memory-compliance-center-repository',
    };
  }

  async close() {}
}

export class ComplianceCenter {
  constructor(
    options = {},
  ) {
    assertPlainObject(
      options,
      'options',
    );

    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,

        ...(
          isPlainObject(
            options.config,
          )
            ? options.config
            : {}
        ),
      });

    assertProvider(
      this.config.provider,
    );

    this.repository =
      options.repository
      ?? options.complianceRepository
      ?? null;

    this.regulatoryIntelligence =
      options.regulatoryIntelligence
      ?? options.complianceIntelligence
      ?? null;

    this.governanceService =
      options.governanceService
      ?? options.decisionGovernanceService
      ?? null;

    this.alertManager =
      options.alertManager
      ?? null;

    this.audit =
      options.audit
      ?? options.decisionAuditLedger
      ?? null;

    this.logger =
      options.logger
      ?? null;

    this.metrics =
      options.metrics
      ?? null;

    this.clock =
      typeof options.clock
        === 'function'
        ? options.clock
        : () => new Date();

    this.idFactory =
      typeof options.idFactory
        === 'function'
        ? options.idFactory
        : () =>
            `compliance-${Date.now()}-${sha256(
              `${Date.now()}-${Math.random()}`,
            ).slice(
              0,
              16,
            )}`;

    if (!this.repository) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .REPOSITORY_REQUIRED,

        'A durable compliance-center repository must be injected in production.',
      );
    }
  }

  _tenantId(
    tenantId,
  ) {
    return assertTenant(
      tenantId,
      this.config,
    );
  }

  _jurisdiction(
    jurisdiction,
  ) {
    return normalizeJurisdiction(
      jurisdiction,
      this.config,
    );
  }

  _provider(
    provider,
  ) {
    return assertProvider(
      provider ?? PROVIDER,
    );
  }

  _log(
    level,
    message,
    error = null,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[
          level
        ]
        ?? this.logger?.info;

      if (
        typeof method
          !== 'function'
      ) {
        return;
      }

      method.call(
        this.logger,
        {
          component:
            COMPONENT,

          ...redact(
            context,
          ),

          ...(error
            ? {
                error:
                  safeError(
                    error,
                  ),
              }
            : {}),
        },

        message,
      );
    } catch {
      // Logging is non-authoritative.
    }
  }

  _metric(
    name,
    labels = {},
    value = 1,
  ) {
    try {
      if (
        typeof this.metrics
          ?.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          labels,
          value,
        );
      } else if (
        typeof this.metrics
          ?.inc
          === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch {
      // Metrics are non-authoritative.
    }
  }

  async _audit(
    event,
  ) {
    if (!this.audit) {
      return {
        attempted:
          false,

        recorded:
          false,
      };
    }

    const payload =
      redact({
        eventType:
          'COMPLIANCE_CENTER_EVENT',

        stage:
          'COMPLIANCE_COMMAND_CENTER',

        provider:
          PROVIDER,

        ...event,
      });

    for (
      const methodName
      of [
        'recordDecisionEvent',
        'append',
        'record',
        'write',
      ]
    ) {
      if (
        typeof this.audit[
          methodName
        ]
          !== 'function'
      ) {
        continue;
      }

      try {
        await this.audit[
          methodName
        ](
          payload,
        );

        return {
          attempted:
            true,

          recorded:
            true,

          method:
            methodName,
        };
      } catch (
        error
      ) {
        this._log(
          'warn',

          'Compliance audit write failed.',

          error,

          {
            eventType:
              payload.eventType,
          },
        );

        if (
          this.config
            .failClosedOnAuditError
        ) {
          throw new ComplianceCenterError(
            COMPLIANCE_CENTER_ERROR_CODES
              .REPOSITORY_UNAVAILABLE,

            'Compliance audit write failed.',

            {},

            {
              httpStatus: 503,
              retryable: true,
              cause: error,
            },
          );
        }

        return {
          attempted:
            true,

          recorded:
            false,

          method:
            methodName,
        };
      }
    }

    return {
      attempted:
        false,

      recorded:
        false,
    };
  }

  async _callRegulatoryIntelligence(
    payload,
  ) {
    if (!this.regulatoryIntelligence) {
      if (
        this.config
          .failClosedOnSourceError
      ) {
        throw new ComplianceCenterError(
          COMPLIANCE_CENTER_ERROR_CODES
            .RULE_ENGINE_REQUIRED,

          'Regulatory/compliance intelligence service is not configured.',

          {},

          {
            httpStatus: 503,
            retryable: true,
          },
        );
      }

      return null;
    }

    const evaluator =
      this.regulatoryIntelligence.evaluate
      ?? this.regulatoryIntelligence.evaluatePayment
      ?? this.regulatoryIntelligence.assess;

    if (
      typeof evaluator
        !== 'function'
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .SOURCE_UNAVAILABLE,

        'Configured regulatory intelligence service does not expose an evaluation method.',

        {},

        {
          httpStatus: 503,
        },
      );
    }

    try {
      return await evaluator.call(
        this.regulatoryIntelligence,
        payload,
      );
    } catch (
      error
    ) {
      this._log(
        'error',

        'Regulatory intelligence evaluation failed.',

        error,

        {
          tenantId:
            digest(
              payload.tenantId,
            ),

          jurisdiction:
            payload.jurisdiction,
        },
      );

      if (
        this.config
          .failClosedOnSourceError
      ) {
        throw new ComplianceCenterError(
          COMPLIANCE_CENTER_ERROR_CODES
            .SOURCE_UNAVAILABLE,

          'Regulatory intelligence is unavailable and compliance assessment is fail-closed.',

          {},

          {
            httpStatus: 503,
            retryable: true,
            cause: error,
          },
        );
      }

      return null;
    }
  }

  async _callGovernance(
    payload,
  ) {
    if (!this.governanceService) {
      return null;
    }

    const evaluator =
      this.governanceService.evaluate
      ?? this.governanceService.orchestrate
      ?? this.governanceService.decide;

    if (
      typeof evaluator
        !== 'function'
    ) {
      return null;
    }

    try {
      return await evaluator.call(
        this.governanceService,
        payload,
      );
    } catch (
      error
    ) {
      this._log(
        'warn',

        'Governance enrichment failed.',

        error,

        {
          tenantId:
            digest(
              payload.tenantId,
            ),
        },
      );

      return null;
    }
  }

  _buildCompliancePosture({
    regulatory,
    governance,
    input,
  }) {
    const regulatoryOutcome =
      normalizeOutcome(
        regulatory?.decision
          ?? regulatory?.outcome,
      );

    const governanceOutcome =
      normalizeOutcome(
        governance?.decision
          ?? governance?.outcome
          ?? governance?.governance
            ?.outcome,
      );

    const findings =
      normalizeFindings(
        [
          ...(regulatory?.findings
            ?? []),

          ...(governance?.findings
            ?? []),
        ],

        this.config,
      );

    const evidence =
      normalizeEvidence(
        [
          ...(regulatory?.evidence
            ?? []),

          ...(regulatory?.decisionEvidence
            ?? []),

          ...(governance?.evidence
            ?? []),
        ],

        this.config,
      );

    const sourceOutcomes =
      [
        regulatoryOutcome,

        governance
          ? governanceOutcome
          : null,
      ].filter(Boolean);

    let outcome =
      maxOutcome(
        sourceOutcomes,
      );

    let severity =
      maxSeverity([
        ...findings.map(
          (finding) =>
            finding.severity,
        ),

        input.severity,
      ]);

    const conflicting =
      regulatoryOutcome
      && governance
      && governanceOutcome
      && regulatoryOutcome
        !== governanceOutcome
      && [
        regulatoryOutcome,
        governanceOutcome,
      ].includes(
        COMPLIANCE_OUTCOMES.BLOCK,
      );

    if (conflicting) {
      outcome =
        COMPLIANCE_OUTCOMES.REVIEW;

      severity =
        maxSeverity([
          severity,
          'HIGH',
        ]);
    }

    const missingMandatoryEvidence =
      findings.some(
        (finding) =>
          finding.mandatory
          && finding.result
            === 'UNKNOWN',
      )
      || findings.some(
        (finding) =>
          finding.outcome
            === COMPLIANCE_OUTCOMES
              .REVIEW
          && String(
            finding.reason
              ?? '',
          )
            .toUpperCase()
            .includes(
              'EVIDENCE',
            ),
      );

    const staleEvidence =
      evidence.some(
        (item) =>
          [
            EVIDENCE_STATE.STALE,
            EVIDENCE_STATE.UNAVAILABLE,
          ].includes(
            item.state,
          ),
      );

    const conflictingEvidence =
      evidence.some(
        (item) =>
          item.state
            === EVIDENCE_STATE
              .CONFLICTING,
      )
      || findings.some(
        (finding) =>
          finding.conflict
            === true,
      );

    if (
      conflictingEvidence
    ) {
      outcome =
        COMPLIANCE_OUTCOMES.REVIEW;

      severity =
        maxSeverity([
          severity,
          'HIGH',
        ]);
    }

    if (
      staleEvidence
      && outcome
        === COMPLIANCE_OUTCOMES.PASS
    ) {
      outcome =
        COMPLIANCE_OUTCOMES.REVIEW;

      severity =
        maxSeverity([
          severity,
          'MEDIUM',
        ]);
    }

    if (
      missingMandatoryEvidence
      && outcome
        === COMPLIANCE_OUTCOMES.PASS
    ) {
      outcome =
        COMPLIANCE_OUTCOMES.REVIEW;

      severity =
        maxSeverity([
          severity,
          'MEDIUM',
        ]);
    }

    if (
      !regulatory
      && !governance
    ) {
      outcome =
        COMPLIANCE_OUTCOMES.INDETERMINATE;

      severity =
        maxSeverity([
          severity,
          'HIGH',
        ]);
    }

    if (
      regulatoryOutcome
        === COMPLIANCE_OUTCOMES
          .NO_POLICY
    ) {
      outcome =
        COMPLIANCE_OUTCOMES.NO_POLICY;
    }

    const highestFinding =
      [
        ...findings,
      ].sort(
        (a, b) =>
          SEVERITY_RANK[
            b.severity
          ]
            - SEVERITY_RANK[
              a.severity
            ]
          || String(
            a.code,
          ).localeCompare(
            String(
              b.code,
            ),
          ),
      )[0]
      ?? null;

    const controlFamilies =
      [
        ...new Set(
          findings
            .map(
              (finding) =>
                finding.controlFamily,
            )
            .filter(Boolean),
        ),
      ].slice(
        0,
        this.config
          .maxControlItems,
      );

    const reasonCodes =
      [
        ...new Set([
          ...(regulatory?.reasonCodes
            ?? []),

          ...(regulatory?.reasons
            ?? []),

          ...(governance?.reasonCodes
            ?? []),

          ...findings.map(
            (finding) =>
              finding.code,
          ),
        ]
          .map(
            (value) =>
              normalizeString(
                value,
                this.config
                  .maxReasonLength,
              ),
          )
          .filter(Boolean)),
      ].slice(
        0,
        this.config
          .maxFindingItems,
      );

    return {
      outcome,

      severity,

      priority:
        priorityFromSeverity(
          severity,
        ),

      regulatoryOutcome,

      governanceOutcome:
        governance
          ? governanceOutcome
          : null,

      conflicting,

      missingMandatoryEvidence,

      staleEvidence,

      conflictingEvidence,

      highestFinding,

      findings,

      evidence,

      controlFamilies,

      reasonCodes,

      sourceSummaries: {
        regulatory:
          compactSourceDecision(
            regulatory,
          ),

        governance:
          compactSourceDecision(
            governance,
          ),
      },
    };
  }

  _buildAssessmentFingerprint({
    tenantId,
    jurisdiction,
    operation,
    subject,
    regulatory,
    governance,
    posture,
  }) {
    return `sha256:${sha256({
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenantId:
        digest(
          tenantId,
        ),

      jurisdiction,

      operation:
        normalizeString(
          operation,
          160,
        )
        ?? null,

      subject:
        redact(
          subject
          ?? {},
        ),

      regulatory:
        compactSourceDecision(
          regulatory,
        ),

      governance:
        compactSourceDecision(
          governance,
        ),

      posture: {
        outcome:
          posture.outcome,

        severity:
          posture.severity,

        controlFamilies:
          posture.controlFamilies,

        reasonCodes:
          posture.reasonCodes,

        findings:
          posture.findings,

        evidence:
          posture.evidence,
      },
    })}`;
  }

  _buildCaseFingerprint({
    tenantId,
    jurisdiction,
    title,
    sourceType,
    sourceId,
    sourceFingerprint,
    posture,
    correlationKey,
  }) {
    return `sha256:${sha256({
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenantId:
        digest(
          tenantId,
        ),

      jurisdiction,

      title,

      sourceType,

      sourceId:
        sourceId
          ? digest(
              sourceId,
            )
          : null,

      sourceFingerprint:
        sourceFingerprint
        ?? null,

      posture: {
        outcome:
          posture.outcome,

        severity:
          posture.severity,

        controlFamilies:
          posture.controlFamilies,

        reasonCodes:
          posture.reasonCodes,
      },

      correlationKey:
        correlationKey
          ? digest(
              correlationKey,
            )
          : null,
    })}`;
  }

  _normalizeAssessmentInput(
    input,
  ) {
    const tenantId =
      this._tenantId(
        input.tenantId,
      );

    const jurisdiction =
      this._jurisdiction(
        input.jurisdiction,
      );

    const provider =
      this._provider(
        input.provider,
      );

    const operation =
      normalizeString(
        input.operation,
        160,
      )
      ?? null;

    const subject =
      redact(
        input.subject
        ?? {},
      );

    const now =
      toIso(
        this.clock(),
        new Date().toISOString(),
      );

    return {
      tenantId,
      provider,
      jurisdiction,
      operation,
      subject,

      decisionId:
        normalizeString(
          input.decisionId,
          this.config
            .maxDecisionIdLength,
        )
        ?? null,

      idempotencyKey:
        normalizeString(
          input.idempotencyKey,
          this.config
            .maxIdempotencyKeyLength,
        )
        ?? null,

      evaluationMode:
        upper(
          input.evaluationMode
            ?? 'ENFORCE',
          40,
        )
        ?? 'ENFORCE',

      context:
        redact(
          input.context
          ?? input.payload
          ?? {},
        ),

      evidence:
        normalizeEvidence(
          input.evidence,
          this.config,
        ),

      actor:
        input.actor
          ? redact(
              input.actor,
            )
          : null,

      requestedAction:
        normalizeString(
          input.requestedAction,
          160,
        )
        ?? null,

      createdAt:
        now,
    };
  }

  async assess(
    input = {},
  ) {
    assertPlainObject(
      input,
      'input',
    );

    const normalized =
      this._normalizeAssessmentInput(
        input,
      );

    const regulatoryPayload = {
      ...normalized,

      tenantId:
        normalized.tenantId,

      provider:
        PROVIDER,

      jurisdiction:
        normalized.jurisdiction,

      operation:
        normalized.operation,

      decisionId:
        normalized.decisionId,

      idempotencyKey:
        normalized.idempotencyKey,

      evaluationMode:
        normalized.evaluationMode,

      subject:
        normalized.subject,

      evidence:
        normalized.evidence,

      context:
        normalized.context,

      actor:
        normalized.actor,

      requestedAction:
        normalized.requestedAction,
    };

    const regulatory =
      await this
        ._callRegulatoryIntelligence(
          regulatoryPayload,
        );

    const governance =
      await this._callGovernance({
        tenantId:
          normalized.tenantId,

        provider:
          PROVIDER,

        decisionId:
          normalized.decisionId,

        idempotencyKey:
          normalized.idempotencyKey,

        operation:
          normalized.operation,

        action:
          normalized.requestedAction,

        jurisdiction:
          normalized.jurisdiction,

        complianceOutcome:
          regulatory?.decision
          ?? regulatory?.outcome,

        findings:
          regulatory?.findings,

        evidence:
          regulatory?.evidence,
      });

    const posture =
      this._buildCompliancePosture({
        regulatory,
        governance,
        input: normalized,
      });

    const assessmentFingerprint =
      this._buildAssessmentFingerprint({
        tenantId:
          normalized.tenantId,

        jurisdiction:
          normalized.jurisdiction,

        operation:
          normalized.operation,

        subject:
          normalized.subject,

        regulatory,
        governance,
        posture,
      });

    const assessment = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      assessmentId:
        this.idFactory(),

      tenantId:
        digest(
          normalized.tenantId,
        ),

      jurisdiction:
        normalized.jurisdiction,

      operation:
        normalized.operation,

      decisionId:
        normalized.decisionId
          ? digest(
              normalized.decisionId,
            )
          : null,

      createdAt:
        normalized.createdAt,

      evaluationMode:
        normalized.evaluationMode,

      posture:
        redact(
          posture,
        ),

      sources: {
        regulatory:
          compactSourceDecision(
            regulatory,
          ),

        governance:
          compactSourceDecision(
            governance,
          ),
      },

      assessmentFingerprint,

      idempotencyKeyDigest:
        normalized.idempotencyKey
          ? digest(
              normalized.idempotencyKey,
            )
          : null,

      safety: {
        readOnlyFinancialCore:
          true,

        providerCallPerformed:
          false,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        paymentExecutionPerformed:
          false,

        approvalGranted:
          false,

        legalAdviceProvided:
          false,
      },
    };

    if (
      Buffer.byteLength(
        JSON.stringify(
          assessment,
        ),
        'utf8',
      )
      > this.config.maxPayloadBytes
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .PAYLOAD_TOO_LARGE,

        'Compliance assessment exceeds the configured payload limit.',
      );
    }

    if (
      normalized.idempotencyKey
      && typeof this.repository
        .findAssessmentByIdempotencyKey
        === 'function'
    ) {
      const existing =
        await this.repository
          .findAssessmentByIdempotencyKey({
            tenantId:
              normalized.tenantId,

            idempotencyKey:
              normalized.idempotencyKey,

            provider:
              PROVIDER,
          });

      if (existing) {
        if (
          existing.assessmentFingerprint
            !== assessmentFingerprint
        ) {
          throw new ComplianceCenterError(
            COMPLIANCE_CENTER_ERROR_CODES
              .IDEMPOTENCY_CONFLICT,

            'Compliance assessment idempotency key is associated with different semantics.',
          );
        }

        return deepFreeze({
          ...redact(
            existing,
          ),

          idempotentReplay:
            true,
        });
      }
    }

    if (
      typeof this.repository
        .saveAssessment
        === 'function'
    ) {
      try {
        await this.repository
          .saveAssessment({
            ...clone(
              assessment,
            ),

            tenantId:
              normalized.tenantId,

            idempotencyKey:
              normalized.idempotencyKey,

            sourceIds: {
              regulatoryDecisionId:
                regulatory?.decisionId
                  ? digest(
                      regulatory.decisionId,
                    )
                  : null,

              governanceDecisionId:
                governance?.decisionId
                  ? digest(
                      governance.decisionId,
                    )
                  : null,
            },
          });
      } catch (
        error
      ) {
        this._log(
          'error',

          'Compliance assessment persistence failed.',

          error,

          {
            tenantId:
              digest(
                normalized.tenantId,
              ),
          },
        );

        if (
          this.config
            .failClosedOnRepositoryError
        ) {
          throw new ComplianceCenterError(
            COMPLIANCE_CENTER_ERROR_CODES
              .REPOSITORY_UNAVAILABLE,

            'Unable to persist compliance assessment.',

            {},

            {
              httpStatus: 503,
              retryable: true,
              cause: error,
            },
          );
        }
      }
    }

    await this._audit({
      action:
        'COMPLIANCE_ASSESSMENT_COMPLETED',

      tenantId:
        digest(
          normalized.tenantId,
        ),

      jurisdiction:
        normalized.jurisdiction,

      operation:
        normalized.operation,

      assessmentId:
        digest(
          assessment.assessmentId,
        ),

      decisionId:
        assessment.decisionId,

      outcome:
        posture.outcome,

      severity:
        posture.severity,

      reasonCodes:
        posture.reasonCodes,

      assessmentFingerprint,
    });

    this._metric(
      'compliance_center_assessments_total',

      {
        outcome:
          posture.outcome,

        severity:
          posture.severity,
      },
    );

    let complianceCase =
      null;

    if (
      [
        COMPLIANCE_OUTCOMES.REVIEW,
        COMPLIANCE_OUTCOMES.BLOCK,
        COMPLIANCE_OUTCOMES.INDETERMINATE,
        COMPLIANCE_OUTCOMES.NO_POLICY,
      ].includes(
        posture.outcome,
      )
    ) {
      complianceCase =
        await this.openCaseFromAssessment({
          tenantId:
            normalized.tenantId,

          jurisdiction:
            normalized.jurisdiction,

          assessment,

          posture,

          idempotencyKey:
            normalized.idempotencyKey
              ? `case:${normalized.idempotencyKey}`
              : `case:${assessmentFingerprint}`,

          title:
            input.caseTitle,

          actorId:
            input.actorId,
        });
    }

    if (
      this.alertManager
      && this.config
        .createAlertForReview
      && posture.outcome
        === COMPLIANCE_OUTCOMES.REVIEW
    ) {
      try {
        await this.alertManager
          .createAlert({
            tenantId:
              normalized.tenantId,

            provider:
              PROVIDER,

            title:
              input.alertTitle
              ?? `Compliance review required: ${normalized.jurisdiction}`,

            message:
              input.alertMessage
              ?? 'Airtel compliance assessment requires human review.',

            category:
              'COMPLIANCE',

            sourceType:
              'REGULATORY',

            severity:
              posture.severity
                === 'INFO'
                ? 'MEDIUM'
                : posture.severity,

            sourceId:
              assessment.assessmentId,

            sourceFingerprint:
              assessmentFingerprint,

            reasonCodes:
              posture.reasonCodes,

            controls:
              posture.controlFamilies,

            evidence:
              posture.evidence,

            correlationKey:
              normalized.decisionId
              ?? assessmentFingerprint,

            idempotencyKey:
              `compliance-alert:${assessmentFingerprint}`,

            humanReviewRequired:
              true,
          });
      } catch (
        error
      ) {
        this._log(
          'warn',

          'Compliance review alert creation failed.',

          error,

          {
            assessmentId:
              digest(
                assessment.assessmentId,
              ),
          },
        );
      }
    }

    if (
      this.alertManager
      && this.config
        .createAlertForBlock
      && posture.outcome
        === COMPLIANCE_OUTCOMES.BLOCK
    ) {
      try {
        await this.alertManager
          .createAlert({
            tenantId:
              normalized.tenantId,

            provider:
              PROVIDER,

            title:
              input.alertTitle
              ?? 'Compliance block requires command-center visibility',

            message:
              input.alertMessage
              ?? 'Airtel compliance intelligence produced a BLOCK result.',

            category:
              'COMPLIANCE',

            sourceType:
              'REGULATORY',

            severity:
              'HIGH',

            sourceId:
              assessment.assessmentId,

            sourceFingerprint:
              assessmentFingerprint,

            reasonCodes:
              posture.reasonCodes,

            controls:
              posture.controlFamilies,

            evidence:
              posture.evidence,

            correlationKey:
              normalized.decisionId
              ?? assessmentFingerprint,

            idempotencyKey:
              `compliance-block-alert:${assessmentFingerprint}`,

            humanReviewRequired:
              true,
          });
      } catch (
        error
      ) {
        this._log(
          'warn',

          'Compliance block alert creation failed.',

          error,

          {
            assessmentId:
              digest(
                assessment.assessmentId,
              ),
          },
        );
      }
    }

    return deepFreeze({
      ...redact(
        assessment,
      ),

      idempotentReplay:
        false,

      case:
        complianceCase,
    });
  }

  async evaluate(
    input = {},
  ) {
    return this.assess(
      input,
    );
  }

  async check(
    input = {},
  ) {
    return this.assess(
      input,
    );
  }

  async openCaseFromAssessment({
    tenantId,
    jurisdiction,
    assessment,
    posture,
    title,
    actorId,
    idempotencyKey,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const scopedJurisdiction =
      this._jurisdiction(
        jurisdiction,
      );

    const normalizedAssessment =
      assessment
      ?? {};

    const normalizedPosture =
      posture
      ?? normalizedAssessment.posture
      ?? {};

    const sourceType =
      'REGULATORY';

    const sourceId =
      normalizedAssessment
        .assessmentId
      ?? null;

    const sourceFingerprint =
      normalizedAssessment
        .assessmentFingerprint
      ?? null;

    const caseTitle =
      normalizeString(
        title,
        this.config
          .maxTitleLength,
      )
      ?? `Compliance case: ${
        normalizedPosture.outcome
        ?? COMPLIANCE_OUTCOMES.INDETERMINATE
      }`;

    const semanticFingerprint =
      this._buildCaseFingerprint({
        tenantId:
          scopedTenant,

        jurisdiction:
          scopedJurisdiction,

        title:
          caseTitle,

        sourceType,

        sourceId,

        sourceFingerprint,

        posture:
          normalizedPosture,

        correlationKey:
          normalizedAssessment
            .decisionId
          ?? sourceFingerprint,
      });

    if (
      idempotencyKey
      && typeof this.repository
        .findCaseByIdempotencyKey
        === 'function'
    ) {
      const existing =
        await this.repository
          .findCaseByIdempotencyKey({
            tenantId:
              scopedTenant,

            idempotencyKey,

            provider:
              PROVIDER,
          });

      if (existing) {
        if (
          existing.semanticFingerprint
            !== semanticFingerprint
        ) {
          throw new ComplianceCenterError(
            COMPLIANCE_CENTER_ERROR_CODES
              .IDEMPOTENCY_CONFLICT,

            'Compliance case idempotency key is associated with different semantics.',
          );
        }

        return deepFreeze({
          ...redact(
            existing,
          ),

          idempotentReplay:
            true,

          deduplicated:
            false,
        });
      }
    }

    if (
      typeof this.repository
        .findActiveByFingerprint
        === 'function'
    ) {
      const existing =
        await this.repository
          .findActiveByFingerprint({
            tenantId:
              scopedTenant,

            semanticFingerprint,

            provider:
              PROVIDER,
          });

      if (existing) {
        return deepFreeze({
          ...redact(
            existing,
          ),

          idempotentReplay:
            false,

          deduplicated:
            true,
        });
      }
    }

    const now =
      toIso(
        this.clock(),
        new Date().toISOString(),
      );

    const outcome =
      normalizeOutcome(
        normalizedPosture.outcome,
      );

    const severity =
      normalizeSeverity(
        normalizedPosture.severity,
      );

    let initialStatus =
      CASE_STATUS.REVIEW_REQUIRED;

    if (
      outcome
        === COMPLIANCE_OUTCOMES.BLOCK
    ) {
      initialStatus =
        CASE_STATUS.BLOCKED;
    } else if (
      outcome
        === COMPLIANCE_OUTCOMES.PASS
      || outcome
        === COMPLIANCE_OUTCOMES
          .ALLOW_WITH_REPORTING
    ) {
      initialStatus =
        CASE_STATUS.OPEN;
    }

    if (
      outcome
        === COMPLIANCE_OUTCOMES.INDETERMINATE
      || outcome
        === COMPLIANCE_OUTCOMES.NO_POLICY
    ) {
      initialStatus =
        CASE_STATUS.REVIEW_REQUIRED;
    }

    const controlFamilies =
      normalizeList(
        normalizedPosture
          .controlFamilies,

        this.config
          .maxControlItems,

        100,
      );

    const reasonCodes =
      normalizeList(
        normalizedPosture
          .reasonCodes,

        this.config
          .maxFindingItems,

        this.config
          .maxReasonLength,
      );

    const findings =
      normalizeFindings(
        normalizedPosture
          .findings,

        this.config,
      );

    const evidence =
      normalizeEvidence(
        normalizedPosture
          .evidence,

        this.config,
      );

    const escalationAfterMinutes =
      toInteger(
        normalizedAssessment
          .escalationAfterMinutes,

        this.config
          .defaultEscalationAfterMinutes,

        {
          min: 1,

          max:
            this.config
              .maxEscalationAfterMinutes,
        },
      );

    const staleAfterMinutes =
      toInteger(
        normalizedAssessment
          .staleAfterMinutes,

        this.config
          .defaultStaleAfterMinutes,

        {
          min: 1,

          max:
            this.config
              .maxStaleAfterMinutes,
        },
      );

    const record = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      caseId:
        this.idFactory(),

      tenantId:
        scopedTenant,

      jurisdiction:
        scopedJurisdiction,

      title:
        caseTitle,

      summary:
        normalizeString(
          normalizedAssessment
            .summary
            ?? normalizedPosture
              .highestFinding
              ?.reason
            ?? 'Compliance review requires command-center handling.',

          this.config
            .maxSummaryLength,
        ),

      status:
        initialStatus,

      priority:
        normalizePriority(
          normalizedPosture
            .priority,

          priorityFromSeverity(
            severity,
          ),
        ),

      outcome,

      severity,

      controlFamilies,

      reasonCodes,

      findings,

      evidence,

      sourceType,

      sourceId,

      sourceFingerprint,

      decisionId:
        normalizedAssessment
          .decisionId
        ?? null,

      assessmentId:
        normalizedAssessment
          .assessmentId
        ?? null,

      semanticFingerprint,

      idempotencyKey:
        idempotencyKey
        ?? null,

      correlationKey:
        normalizedAssessment
          .decisionId
          ? digest(
              normalizedAssessment
                .decisionId,
            )
          : sourceFingerprint
            ?? null,

      createdAt:
        now,

      updatedAt:
        now,

      openedAt:
        now,

      acknowledgedAt:
        null,

      acknowledgedByDigest:
        null,

      escalatedAt:
        null,

      escalatedByDigest:
        null,

      clearedAt:
        null,

      clearedByDigest:
        null,

      closedAt:
        null,

      closedByDigest:
        null,

      closedReason:
        null,

      lifecycleHistory: [
        {
          at:
            now,

          from:
            null,

          to:
            initialStatus,

          actorDigest:
            actorId
              ? digest(
                  actorId,
                )
              : null,

          reason:
            'CASE_CREATED',
        },
      ],

      escalationHistory: [],

      staleAt:
        addMinutes(
          now,
          staleAfterMinutes,
        ),

      escalateAt:
        addMinutes(
          now,
          escalationAfterMinutes,
        ),

      version:
        1,

      metadata:
        redact(
          normalizedAssessment
            .metadata
          ?? {},
        ),

      safety: {
        providerCallPerformed:
          false,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        paymentExecutionPerformed:
          false,

        approvalGranted:
          false,
      },
    };

    if (
      Buffer.byteLength(
        JSON.stringify(
          record,
        ),
        'utf8',
      )
      > this.config.maxPayloadBytes
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .PAYLOAD_TOO_LARGE,

        'Compliance case exceeds the configured payload limit.',
      );
    }

    if (
      typeof this.repository
        .saveCase
        !== 'function'
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Compliance repository does not implement saveCase().',
      );
    }

    let saved;

    try {
      saved =
        await this.repository
          .saveCase(
            clone(record),
          );
    } catch (
      error
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Unable to persist compliance case.',

        {},

        {
          httpStatus: 503,
          retryable: true,
          cause: error,
        },
      );
    }

    await this._audit({
      action:
        'COMPLIANCE_CASE_CREATED',

      tenantId:
        digest(
          scopedTenant,
        ),

      caseId:
        digest(
          record.caseId,
        ),

      jurisdiction:
        scopedJurisdiction,

      status:
        record.status,

      priority:
        record.priority,

      outcome:
        record.outcome,

      severity:
        record.severity,

      semanticFingerprint,
    });

    this._metric(
      'compliance_center_cases_created_total',

      {
        status:
          record.status,

        severity:
          record.severity,
      },
    );

    return deepFreeze({
      ...redact(
        saved
        ?? record,
      ),

      idempotentReplay:
        false,

      deduplicated:
        false,
    });
  }

  async createCase(
    input = {},
  ) {
    assertPlainObject(
      input,
      'case input',
    );

    const tenantId =
      this._tenantId(
        input.tenantId,
      );

    const jurisdiction =
      this._jurisdiction(
        input.jurisdiction,
      );

    const posture = {
      outcome:
        normalizeOutcome(
          input.outcome,
        ),

      severity:
        normalizeSeverity(
          input.severity,
        ),

      priority:
        normalizePriority(
          input.priority,
        ),

      controlFamilies:
        normalizeList(
          input.controlFamilies,
          this.config
            .maxControlItems,
          100,
        ),

      reasonCodes:
        normalizeList(
          input.reasonCodes,

          this.config
            .maxFindingItems,

          this.config
            .maxReasonLength,
        ),

      findings:
        normalizeFindings(
          input.findings,
          this.config,
        ),

      evidence:
        normalizeEvidence(
          input.evidence,
          this.config,
        ),
    };

    const assessment = {
      assessmentId:
        normalizeString(
          input.assessmentId,
          this.config
            .maxAssessmentIdLength,
        )
        ?? null,

      assessmentFingerprint:
        normalizeString(
          input.assessmentFingerprint,
          180,
        )
        ?? null,

      decisionId:
        normalizeString(
          input.decisionId,
          this.config
            .maxDecisionIdLength,
        )
        ?? null,

      summary:
        normalizeString(
          input.summary,
          this.config
            .maxSummaryLength,
        )
        ?? null,

      metadata:
        redact(
          input.metadata
          ?? {},
        ),
    };

    return this.openCaseFromAssessment({
      tenantId,
      jurisdiction,
      assessment,
      posture,

      title:
        input.title,

      actorId:
        input.actorId,

      idempotencyKey:
        normalizeString(
          input.idempotencyKey,
          this.config
            .maxIdempotencyKeyLength,
        ),
    });
  }

  async _transitionCase({
    tenantId,
    caseId,
    nextStatus,
    actorId,
    reason,
    note,
    metadata = {},
  }) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const scopedCaseId =
      normalizeString(
        caseId,
        this.config
          .maxCaseIdLength,
      );

    if (!scopedCaseId) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .CASE_REQUIRED,

        'caseId is required.',
      );
    }

    const current =
      await this.repository
        .findCase({
          tenantId:
            scopedTenant,

          caseId:
            scopedCaseId,

          provider:
            PROVIDER,
        });

    if (!current) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .CASE_NOT_FOUND,

        `Compliance case ${scopedCaseId} was not found.`,

        {},

        {
          httpStatus: 404,
        },
      );
    }

    validateTransition(
      normalizeCaseStatus(
        current.status,
      ),

      nextStatus,
    );

    const now =
      toIso(
        this.clock(),
        new Date().toISOString(),
      );

    const lifecycle = {
      at:
        now,

      from:
        current.status,

      to:
        nextStatus,

      actorDigest:
        actorId
          ? digest(
              actorId,
            )
          : null,

      reason:
        normalizeString(
          reason,
          500,
        )
        ?? null,

      note:
        normalizeString(
          note,
          800,
        )
        ?? null,
    };

    const patch = {
      status:
        nextStatus,

      updatedAt:
        now,

      lifecycleHistory: [
        ...(current.lifecycleHistory
          ?? []),

        lifecycle,
      ].slice(
        -this.config
          .maxMetadataKeys,
      ),

      metadata:
        redact({
          ...(current.metadata
            ?? {}),

          ...(
            isPlainObject(
              metadata,
            )
              ? metadata
              : {}
          ),
        }),
    };

    if (
      nextStatus
        === CASE_STATUS.ESCALATED
    ) {
      patch.escalatedAt =
        now;

      patch.escalatedByDigest =
        actorId
          ? digest(
              actorId,
            )
          : null;

      patch.escalationHistory = [
        ...(current.escalationHistory
          ?? []),

        {
          at:
            now,

          actorDigest:
            actorId
              ? digest(
                  actorId,
                )
              : null,

          reason:
            lifecycle.reason,
        },
      ].slice(
        -this.config
          .maxMetadataKeys,
      );
    }

    if (
      nextStatus
        === CASE_STATUS.CLEARED
    ) {
      if (
        this.config
          .requireAuthoritativeEvidenceForClear
        && !(
          current.evidence
            ?? []
        ).some(
          (item) =>
            item.authoritative
              === true
            && [
              EVIDENCE_STATE.VERIFIED,
              EVIDENCE_STATE.PRESENT,
            ].includes(
              item.state,
            ),
        )
      ) {
        throw new ComplianceCenterError(
          COMPLIANCE_CENTER_ERROR_CODES
            .EVIDENCE_REQUIRED,

          'A compliance case cannot be cleared without authoritative evidence.',
        );
      }

      patch.clearedAt =
        now;

      patch.clearedByDigest =
        actorId
          ? digest(
              actorId,
            )
          : null;
    }

    if (
      nextStatus
        === CASE_STATUS.CLOSED
    ) {
      patch.closedAt =
        now;

      patch.closedByDigest =
        actorId
          ? digest(
              actorId,
            )
          : null;

      patch.closedReason =
        normalizeString(
          reason,
          this.config
            .maxReasonLength,
        )
        ?? 'CLOSED';
    }

    const updated =
      await this.repository
        .updateCase({
          tenantId:
            scopedTenant,

          caseId:
            scopedCaseId,

          patch,

          expectedVersion:
            current.version,
        });

    const finalRecord =
      updated
      ?? {
        ...current,
        ...patch,
      };

    await this._audit({
      action:
        `COMPLIANCE_CASE_${nextStatus}`,

      tenantId:
        digest(
          scopedTenant,
        ),

      caseId:
        digest(
          scopedCaseId,
        ),

      fromStatus:
        current.status,

      toStatus:
        nextStatus,

      actorDigest:
        actorId
          ? digest(
              actorId,
            )
          : null,

      reason:
        lifecycle.reason,

      semanticFingerprint:
        current.semanticFingerprint,
    });

    this._metric(
      'compliance_center_case_lifecycle_total',

      {
        from:
          current.status,

        to:
          nextStatus,
      },
    );

    return deepFreeze(
      redact(
        finalRecord,
      ),
    );
  }

  async acknowledge({
    tenantId,
    caseId,
    actorId,
    reason =
      'ACKNOWLEDGED',
    note,
  } = {}) {
    return this._transitionCase({
      tenantId,
      caseId,

      nextStatus:
        CASE_STATUS
          .REVIEW_REQUIRED,

      actorId,

      reason,

      note,
    });
  }

  async escalate({
    tenantId,
    caseId,
    actorId,
    reason =
      'ESCALATED',
    note,
  } = {}) {
    const result =
      await this._transitionCase({
        tenantId,
        caseId,

        nextStatus:
          CASE_STATUS.ESCALATED,

        actorId,

        reason,

        note,
      });

    if (
      this.alertManager
    ) {
      try {
        await this.alertManager
          .createAlert({
            tenantId,

            provider:
              PROVIDER,

            title:
              'Compliance case escalated',

            message:
              'Airtel compliance case requires escalated human attention.',

            category:
              'COMPLIANCE',

            sourceType:
              'SYSTEM',

            severity:
              'HIGH',

            sourceId:
              caseId,

            sourceFingerprint:
              result.semanticFingerprint,

            reasonCodes: [
              reason,
            ],

            correlationKey:
              result.correlationKey,

            idempotencyKey:
              `compliance-case-escalation:${caseId}:${result.version}`,

            humanReviewRequired:
              true,
          });
      } catch (
        error
      ) {
        this._log(
          'warn',

          'Escalated compliance alert creation failed.',

          error,

          {
            caseId:
              digest(
                caseId,
              ),
          },
        );
      }
    }

    return result;
  }

  async block({
    tenantId,
    caseId,
    actorId,
    reason =
      'BLOCKED',
    note,
  } = {}) {
    return this._transitionCase({
      tenantId,
      caseId,

      nextStatus:
        CASE_STATUS.BLOCKED,

      actorId,

      reason,

      note,
    });
  }

  async clear({
    tenantId,
    caseId,
    actorId,
    reason =
      'CLEARED',
    note,
    metadata,
  } = {}) {
    return this._transitionCase({
      tenantId,
      caseId,

      nextStatus:
        CASE_STATUS.CLEARED,

      actorId,

      reason,

      note,

      metadata,
    });
  }

  async close({
    tenantId,
    caseId,
    actorId,
    reason =
      'CLOSED',
    note,
  } = {}) {
    return this._transitionCase({
      tenantId,
      caseId,

      nextStatus:
        CASE_STATUS.CLOSED,

      actorId,

      reason,

      note,
    });
  }

  async reopen({
    tenantId,
    caseId,
    actorId,
    reason =
      'REOPENED_FOR_REVIEW',
    note,
  } = {}) {
    return this._transitionCase({
      tenantId,
      caseId,

      nextStatus:
        CASE_STATUS.REVIEW_REQUIRED,

      actorId,

      reason,

      note,
    });
  }

  async getCase({
    tenantId,
    caseId,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const scopedCaseId =
      normalizeString(
        caseId,
        this.config
          .maxCaseIdLength,
      );

    if (!scopedCaseId) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .CASE_REQUIRED,

        'caseId is required.',
      );
    }

    const record =
      await this.repository
        .findCase({
          tenantId:
            scopedTenant,

          caseId:
            scopedCaseId,

          provider:
            PROVIDER,
        });

    return record
      ? deepFreeze(
          redact(
            record,
          ),
        )
      : null;
  }

  async listCases({
    tenantId,
    statuses,
    priorities,
    jurisdictions,
    controlFamilies,
    limit =
      this.config
        .defaultQueryLimit,
    offset = 0,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const boundedLimit =
      toInteger(
        limit,

        this.config
          .defaultQueryLimit,

        {
          min: 1,

          max:
            this.config
              .maxQueryLimit,
        },
      );

    const boundedOffset =
      toInteger(
        offset,

        0,

        {
          min: 0,

          max:
            Number.MAX_SAFE_INTEGER,
        },
      );

    const normalizedStatuses =
      Array.isArray(
        statuses,
      )
        ? statuses
            .map(
              normalizeCaseStatus,
            )
            .slice(
              0,
              Object.keys(
                CASE_STATUS,
              ).length,
            )
        : undefined;

    const normalizedPriorities =
      Array.isArray(
        priorities,
      )
        ? priorities
            .map(
              (value) =>
                normalizePriority(
                  value,
                ),
            )
            .slice(
              0,
              Object.keys(
                CASE_PRIORITY,
              ).length,
            )
        : undefined;

    const normalizedJurisdictions =
      Array.isArray(
        jurisdictions,
      )
        ? jurisdictions
            .map(
              (value) =>
                normalizeString(
                  value,
                  this.config
                    .maxJurisdictionLength,
                )
                  ?.toUpperCase(),
            )
            .filter(Boolean)
            .slice(
              0,
              50,
            )
        : undefined;

    const normalizedControlFamilies =
      Array.isArray(
        controlFamilies,
      )
        ? controlFamilies
            .map(
              (value) =>
                upper(
                  value,
                  80,
                ),
            )
            .filter(
              (value) =>
                CONTROL_FAMILIES.includes(
                  value,
                ),
            )
            .slice(
              0,
              this.config
                .maxControlItems,
            )
        : undefined;

    if (
      typeof this.repository
        .listCases
        !== 'function'
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Compliance repository does not implement listCases().',
      );
    }

    const result =
      await this.repository
        .listCases({
          tenantId:
            scopedTenant,

          provider:
            PROVIDER,

          statuses:
            normalizedStatuses,

          priorities:
            normalizedPriorities,

          jurisdictions:
            normalizedJurisdictions,

          controlFamilies:
            normalizedControlFamilies,

          limit:
            boundedLimit,

          offset:
            boundedOffset,
        });

    return deepFreeze(
      redact(
        result,
      ),
    );
  }

  async summary({
    tenantId,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    if (
      typeof this.repository
        .countByStatus
        === 'function'
    ) {
      const counts =
        await this.repository
          .countByStatus({
            tenantId:
              scopedTenant,

            provider:
              PROVIDER,
          });

      const activeCount =
        Object.entries(
          counts,
        ).reduce(
          (
            total,
            [
              status,
              count,
            ],
          ) =>
            total
            + (
              [
                CASE_STATUS.OPEN,
                CASE_STATUS.REVIEW_REQUIRED,
                CASE_STATUS.ESCALATED,
                CASE_STATUS.BLOCKED,
              ].includes(
                status,
              )
                ? Number(
                    count
                    ?? 0,
                  )
                : 0
            ),
          0,
        );

      return deepFreeze({
        provider:
          PROVIDER,

        tenantId:
          digest(
            scopedTenant,
          ),

        counts,

        activeCount,
      });
    }

    const page =
      await this.listCases({
        tenantId:
          scopedTenant,

        limit:
          this.config
            .maxQueryLimit,

        offset:
          0,
      });

    const counts =
      Object.fromEntries(
        Object.values(
          CASE_STATUS,
        ).map(
          (status) => [
            status,
            0,
          ],
        ),
      );

    for (
      const item
      of page.entries
        ?? []
    ) {
      if (
        counts[
          item.status
        ]
          !== undefined
      ) {
        counts[
          item.status
        ] += 1;
      }
    }

    return deepFreeze({
      provider:
        PROVIDER,

      tenantId:
        digest(
          scopedTenant,
        ),

      counts,

      activeCount:
        Object.entries(
          counts,
        ).reduce(
          (
            total,
            [
              status,
              count,
            ],
          ) =>
            total
            + (
              [
                CASE_STATUS.OPEN,
                CASE_STATUS.REVIEW_REQUIRED,
                CASE_STATUS.ESCALATED,
                CASE_STATUS.BLOCKED,
              ].includes(
                status,
              )
                ? count
                : 0
            ),
          0,
        ),

      truncated:
        Boolean(
          page.hasMore,
        ),
    });
  }

  async getPosture({
    tenantId,
    jurisdiction,
    operation,
    subject,
    evidence,
    context,
    decisionId,
    idempotencyKey,
    evaluationMode,
    requestedAction,
  } = {}) {
    const result =
      await this.assess({
        tenantId,
        jurisdiction,
        operation,
        subject,
        evidence,
        context,
        decisionId,
        idempotencyKey,
        evaluationMode,
        requestedAction,
      });

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId:
        result.tenantId,

      jurisdiction:
        result.jurisdiction,

      operation:
        result.operation,

      decisionId:
        result.decisionId,

      createdAt:
        result.createdAt,

      posture:
        result.posture,

      sources:
        result.sources,

      assessmentFingerprint:
        result.assessmentFingerprint,

      safety:
        result.safety,
    });
  }

  async processDueEscalations({
    tenantId,
    now =
      this.clock(),

    limit =
      this.config
        .defaultQueryLimit,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const nowIso =
      toIso(
        now,
        new Date().toISOString(),
      );

    if (
      typeof this.repository
        .listDueEscalations
        !== 'function'
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Compliance repository does not implement listDueEscalations().',
      );
    }

    const candidates =
      await this.repository
        .listDueEscalations({
          tenantId:
            scopedTenant,

          provider:
            PROVIDER,

          now:
            nowIso,

          limit:
            toInteger(
              limit,

              this.config
                .defaultQueryLimit,

              {
                min: 1,

                max:
                  this.config
                    .maxQueryLimit,
              },
            ),
        });

    const escalated =
      [];

    for (
      const candidate
      of candidates.slice(
        0,
        this.config
          .maxQueryLimit,
      )
    ) {
      try {
        escalated.push(
          await this.escalate({
            tenantId:
              scopedTenant,

            caseId:
              candidate.caseId,

            actorId:
              'system:compliance-center',

            reason:
              'ESCALATION_DEADLINE_REACHED',
          }),
        );
      } catch (
        error
      ) {
        this._log(
          'warn',

          'Due compliance case escalation failed.',

          error,

          {
            caseId:
              digest(
                candidate.caseId,
              ),
          },
        );
      }
    }

    return deepFreeze({
      provider:
        PROVIDER,

      tenantId:
        digest(
          scopedTenant,
        ),

      evaluated:
        candidates.length,

      escalated:
        escalated.length,

      cases:
        escalated,
    });
  }

  async processDueStaleCases({
    tenantId,
    now =
      this.clock(),

    limit =
      this.config
        .defaultQueryLimit,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const nowIso =
      toIso(
        now,
        new Date().toISOString(),
      );

    if (
      typeof this.repository
        .listDueStaleCases
        !== 'function'
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,

        'Compliance repository does not implement listDueStaleCases().',
      );
    }

    const candidates =
      await this.repository
        .listDueStaleCases({
          tenantId:
            scopedTenant,

          provider:
            PROVIDER,

          now:
            nowIso,

          limit:
            toInteger(
              limit,

              this.config
                .defaultQueryLimit,

              {
                min: 1,

                max:
                  this.config
                    .maxQueryLimit,
              },
            ),
        });

    const marked =
      [];

    for (
      const candidate
      of candidates.slice(
        0,
        this.config
          .maxQueryLimit,
      )
    ) {
      try {
        marked.push(
          await this._transitionCase({
            tenantId:
              scopedTenant,

            caseId:
              candidate.caseId,

            nextStatus:
              CASE_STATUS.REVIEW_REQUIRED,

            actorId:
              'system:compliance-center',

            reason:
              'CASE_EVIDENCE_STALE',

            note:
              'Case remained open beyond the configured evidence freshness window.',

            metadata: {
              staleDetectedAt:
                nowIso,
            },
          }),
        );
      } catch (
        error
      ) {
        this._log(
          'warn',

          'Stale compliance case handling failed.',

          error,

          {
            caseId:
              digest(
                candidate.caseId,
              ),
          },
        );
      }
    }

    return deepFreeze({
      provider:
        PROVIDER,

      tenantId:
        digest(
          scopedTenant,
        ),

      evaluated:
        candidates.length,

      markedReviewRequired:
        marked.length,

      cases:
        marked,
    });
  }

  async exportCase({
    tenantId,
    caseId,
  } = {}) {
    const record =
      await this.getCase({
        tenantId,
        caseId,
      });

    if (!record) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .CASE_NOT_FOUND,

        `Compliance case ${caseId} was not found.`,

        {},

        {
          httpStatus: 404,
        },
      );
    }

    const content =
      JSON.stringify(
        record,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        content,
        'utf8',
      );

    if (
      bytes
        > this.config
          .maxExportBytes
    ) {
      throw new ComplianceCenterError(
        COMPLIANCE_CENTER_ERROR_CODES
          .PAYLOAD_TOO_LARGE,

        'Compliance case export exceeds the configured limit.',

        {
          bytes,

          maxExportBytes:
            this.config
              .maxExportBytes,
        },

        {
          httpStatus: 413,
        },
      );
    }

    return Object.freeze({
      contentType:
        'application/json',

      filename:
        `compliance-case-${digest(caseId).slice(-16)}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          content,
        )}`,

      content,
    });
  }

  async health() {
    let repository =
      null;

    let state =
      'HEALTHY';

    try {
      if (
        typeof this.repository
          ?.healthCheck
          === 'function'
      ) {
        repository =
          await this.repository
            .healthCheck();
      } else if (
        typeof this.repository
          ?.health
          === 'function'
      ) {
        repository =
          await this.repository
            .health();
      } else {
        repository = {
          ok:
            true,

          reason:
            'Repository configured; health method not implemented.',
        };
      }
    } catch (
      error
    ) {
      state =
        'UNAVAILABLE';

      repository = {
        ok:
          false,

        error:
          safeError(
            error,
          ),
      };
    }

    if (
      repository?.ok === false
      && state
        !== 'UNAVAILABLE'
    ) {
      state =
        'DEGRADED';
    }

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      state,

      healthy:
        state === 'HEALTHY',

      degraded:
        state === 'DEGRADED',

      unavailable:
        state === 'UNAVAILABLE',

      sources: {
        regulatoryIntelligence: {
          configured:
            Boolean(
              this.regulatoryIntelligence,
            ),
        },

        governanceService: {
          configured:
            Boolean(
              this.governanceService,
            ),
        },

        alertManager: {
          configured:
            Boolean(
              this.alertManager,
            ),
        },
      },

      repository:
        redact(
          repository,
        ),

      safety: {
        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        paymentExecutionPerformed:
          false,

        approvalGranted:
          false,

        legalAdviceProvided:
          false,
      },
    });
  }

  async readiness() {
    return this.health();
  }

  getComponentInfo() {
    return Object.freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      tenantIsolation:
        true,

      jurisdictionAware:
        true,

      regulatorySourceDelegation:
        true,

      governanceEnrichment:
        true,

      complianceCaseManagement:
        true,

      deterministicAssessmentFingerprint:
        true,

      deterministicCaseFingerprint:
        true,

      idempotency:
        true,

      evidenceFreshnessTracking:
        true,

      explicitLifecycleTransitions:
        true,

      boundedEvidence:
        true,

      boundedFindings:
        true,

      sensitiveIdentifierDigesting:
        true,

      rawProviderPayloadPersistence:
        false,

      legalAdvice:
        false,

      sanctionsScreeningEngine:
        false,

      amlSourceOfTruth:
        false,

      kycSourceOfTruth:
        false,

      paymentExecution:
        false,

      providerCalls:
        false,

      settlement:
        false,

      ledgerMutation:
        false,

      balanceMutation:
        false,

      approvalGrant:
        false,

      arbitraryCodeExecution:
        false,

      internalScheduler:
        false,
    });
  }
}

export function createComplianceCenter(
  options = {},
) {
  return new ComplianceCenter(
    options,
  );
}

export const createAirtelComplianceCenter =
  createComplianceCenter;

export const AirtelComplianceCenter =
  ComplianceCenter;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    COMPLIANCE_OUTCOMES,
    CASE_STATUS,
    CASE_PRIORITY,
    EVIDENCE_STATE,
    CONTROL_FAMILIES,
    COMPLIANCE_ACTIONS,
    COMPLIANCE_CENTER_ERROR_CODES,
  });

export function buildComplianceFingerprint(
  value,
) {
  return `sha256:${sha256(
    value,
  )}`;
}

export default ComplianceCenter;