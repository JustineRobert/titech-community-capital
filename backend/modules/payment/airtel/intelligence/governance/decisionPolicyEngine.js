/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Decision Policy Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/governance/decisionPolicyEngine.js
 *
 * Purpose:
 *   Enterprise-grade, deterministic, versioned policy engine for the Airtel
 *   payment intelligence and decision-governance domain.
 *
 * Architectural position:
 *
 *   Payment / Intelligence Context
 *              |
 *              v
 *      Decision Policy Engine
 *        |       |       |
 *        v       v       v
 *     Policy  Evidence  Scope
 *      Pack    Signals  Validation
 *        \       |       /
 *         \      |      /
 *          v     v     v
 *          Policy Findings
 *                 |
 *                 v
 *          Governance Decision
 *                 |
 *        +--------+---------+
 *        |                  |
 *        v                  v
 *      BLOCK             REVIEW / APPROVAL
 *                           |
 *                           v
 *                    approvalWorkflow
 *                           |
 *                           v
 *                   Payment Orchestrator
 *                           |
 *                           v
 *                   TITech Financial Core
 *
 * Responsibilities:
 *   - Evaluate versioned policy packs against normalized Airtel payment context.
 *   - Enforce tenant/provider/jurisdiction/operation scope.
 *   - Support deterministic rule assertions and policy outcomes.
 *   - Produce explainable rule-level findings and governance controls.
 *   - Generate stable policy and decision fingerprints.
 *   - Perform exact decimal comparisons for monetary policy thresholds.
 *   - Distinguish BLOCK, REQUIRE_REVIEW, ALLOW and NO_POLICY outcomes.
 *   - Support tenant-specific and global policy resolution through dependency
 *     injection without persisting policy state internally.
 *   - Preserve original payment idempotency identity and financial boundaries.
 *   - Sanitize policy/evidence data for logs, diagnostics and output envelopes.
 *   - Provide policy-pack validation, diffing, dry-run and health APIs.
 *
 * Non-responsibilities / important boundaries:
 *   - Does NOT call Airtel APIs.
 *   - Does NOT create, settle, reverse, refund or execute financial transactions.
 *   - Does NOT mutate balances or write accounting entries.
 *   - Does NOT replace the authoritative KYC/AML/sanctions/fraud source systems.
 *   - Does NOT silently activate policy packs.
 *   - Does NOT persist policy packs internally; injected repositories/adapters own
 *     policy lifecycle, approval, activation and persistence.
 *   - Does NOT grant maker-checker approval or execution authorization.
 *   - Does NOT treat a recommendation, model score or policy ALLOW as proof of
 *     settlement success.
 *   - Does NOT convert LOCAL_ONLY/PENDING_SYNC/CONFLICT states into settlement.
 *
 * Production safety principles:
 *   1. Tenant context is mandatory by default.
 *   2. Airtel provider scope is mandatory by default.
 *   3. Missing mandatory policy never becomes implicit ALLOW.
 *   4. Disabled, expired, draft or superseded policy packs are not executable.
 *   5. Explicit BLOCK dominates ALLOW and advisory intelligence signals.
 *   6. Conflicting policy rules resolve conservatively according to precedence.
 *   7. Monetary values use exact decimal string arithmetic.
 *   8. Raw credentials/secrets/provider payloads never appear in findings or logs.
 *   9. Decision fingerprints include policy version/fingerprint and relevant
 *      evidence digests, allowing later reconstruction without storing raw data.
 *   10. The engine is stateless and safe for concurrent workers.
 *
 * Module format:
 *   Native ESM. Node.js built-ins only. No project-internal static imports are
 *   required to minimize circular dependency risk.
 * =============================================================================
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-decision-policy-engine';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;

export const POLICY_DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  ALLOW_WITH_CONTROLS: 'ALLOW_WITH_CONTROLS',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  BLOCK: 'BLOCK',
  NO_POLICY: 'NO_POLICY',
});

export const POLICY_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  SUPERSEDED: 'SUPERSEDED',
  RETIRED: 'RETIRED',
});

export const POLICY_MODES = Object.freeze({
  ENFORCE: 'ENFORCE',
  PREVIEW: 'PREVIEW',
  ADVISORY: 'ADVISORY',
});

export const RULE_RESULTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  ERROR: 'ERROR',
});

export const RULE_OUTCOMES = Object.freeze({
  ALLOW: 'ALLOW',
  ALLOW_WITH_CONTROLS: 'ALLOW_WITH_CONTROLS',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
  REPORT: 'REPORT',
  REQUIRE_EVIDENCE: 'REQUIRE_EVIDENCE',
});

export const RULE_OPERATORS = Object.freeze({
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  IN: 'IN',
  NOT_IN: 'NOT_IN',
  EXISTS: 'EXISTS',
  NOT_EXISTS: 'NOT_EXISTS',
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  GT: 'GT',
  GTE: 'GTE',
  LT: 'LT',
  LTE: 'LTE',
  BETWEEN: 'BETWEEN',
  DECIMAL_GT: 'DECIMAL_GT',
  DECIMAL_GTE: 'DECIMAL_GTE',
  DECIMAL_LT: 'DECIMAL_LT',
  DECIMAL_LTE: 'DECIMAL_LTE',
  DECIMAL_BETWEEN: 'DECIMAL_BETWEEN',
  MATCHES: 'MATCHES',
  PREFIX: 'PREFIX',
  SUFFIX: 'SUFFIX',
});

export const AGGREGATION_MODES = Object.freeze({
  ALL: 'ALL',
  ANY: 'ANY',
  NONE: 'NONE',
});

export const SEVERITIES = Object.freeze([
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const OPERATIONS = Object.freeze([
  'COLLECTION',
  'DISBURSEMENT',
  'REFUND',
  'REVERSAL',
  'SETTLEMENT',
  'STATUS',
  'QUERY',
]);

export const IMPACT_LEVELS = Object.freeze([
  'NON_FINANCIAL',
  'FINANCIAL',
  'COLLECTION',
  'DISBURSEMENT',
  'REFUND',
  'REVERSAL',
  'SETTLEMENT',
]);

export const POLICY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'DECISION_POLICY_INVALID_INPUT',
  INVALID_POLICY_PACK: 'DECISION_POLICY_INVALID_POLICY_PACK',
  POLICY_REQUIRED: 'DECISION_POLICY_REQUIRED',
  POLICY_UNAVAILABLE: 'DECISION_POLICY_UNAVAILABLE',
  POLICY_SCOPE_VIOLATION: 'DECISION_POLICY_SCOPE_VIOLATION',
  POLICY_NOT_ACTIVE: 'DECISION_POLICY_NOT_ACTIVE',
  POLICY_EXPIRED: 'DECISION_POLICY_EXPIRED',
  POLICY_NOT_EFFECTIVE: 'DECISION_POLICY_NOT_EFFECTIVE',
  TENANT_REQUIRED: 'DECISION_POLICY_TENANT_REQUIRED',
  PROVIDER_SCOPE_VIOLATION: 'DECISION_POLICY_PROVIDER_SCOPE_VIOLATION',
  OPERATION_REQUIRED: 'DECISION_POLICY_OPERATION_REQUIRED',
  INVALID_RULE: 'DECISION_POLICY_INVALID_RULE',
  UNSUPPORTED_OPERATOR: 'DECISION_POLICY_UNSUPPORTED_OPERATOR',
  AMBIGUOUS_POLICY: 'DECISION_POLICY_AMBIGUOUS',
  EVALUATION_FAILED: 'DECISION_POLICY_EVALUATION_FAILED',
});

const ALLOWED_PACK_STATUSES = new Set([
  POLICY_STATUSES.APPROVED,
  POLICY_STATUSES.ACTIVE,
]);

const TERMINAL_BLOCK_OUTCOMES = new Set([
  RULE_OUTCOMES.BLOCK,
  POLICY_DECISIONS.BLOCK,
]);

const REVIEW_OUTCOMES = new Set([
  RULE_OUTCOMES.REVIEW,
  RULE_OUTCOMES.REQUIRE_EVIDENCE,
  POLICY_DECISIONS.REQUIRE_REVIEW,
  POLICY_DECISIONS.NO_POLICY,
]);

const DEFAULT_CONFIG = Object.freeze({
  requireTenantId: true,
  enforceAirtelProvider: true,
  requirePolicyForFinancialImpact: true,
  requireActivePolicy: true,
  failClosedOnPolicyRepositoryError: true,
  failClosedOnRuleError: true,
  defaultMode: POLICY_MODES.ENFORCE,
  maxRules: 500,
  maxAssertionsPerRule: 50,
  maxFindings: 500,
  maxPolicies: 25,
  maxTenantIdLength: 160,
  maxPolicyIdLength: 200,
  maxVersionLength: 100,
  maxRuleIdLength: 200,
  maxReasonLength: 1200,
  maxDescriptionLength: 1500,
  maxMetadataDepth: 6,
  maxMetadataKeys: 80,
  maxMetadataArray: 100,
  maxMetadataString: 2000,
  maxDecimalScale: 18,
  defaultDecisionWhenNoRuleMatches: POLICY_DECISIONS.REQUIRE_REVIEW,
});

const SECRET_KEY_PATTERN =
  /(password|passphrase|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|private.?key|api.?key|access.?key|credential|signature|provider.?payload|raw(request|response))/i;

const PROTOTYPE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeString(value, maxLength = 240) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function upper(value, maxLength = 120) {
  return normalizeString(value, maxLength)?.toUpperCase();
}

function toIso(value, fieldName = 'date') {
  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_INPUT,
      `${fieldName} must be a valid date/time.`,
      { fieldName },
    );
  }

  return date.toISOString();
}

function nowIso(clock) {
  const value =
    typeof clock === 'function'
      ? clock()
      : clock?.now?.() ?? Date.now();

  return toIso(value, 'clock value');
}

function stableNormalize(value, seen = new WeakSet()) {
  if (value === undefined) return null;
  if (value === null) return null;

  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    if (Object.is(value, -0)) return 0;
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `base64:${value.toString('base64')}`;
  }

  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return String(value);
  }

  if (seen.has(value)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_INPUT,
      'Circular policy data is not supported.',
    );
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((item) =>
      stableNormalize(item, seen));
    seen.delete(value);
    return output;
  }

  if (
    typeof value.toJSON === 'function'
    && !isPlainObject(value)
  ) {
    const output = stableNormalize(
      value.toJSON(),
      seen,
    );
    seen.delete(value);
    return output;
  }

  const output = {};

  for (const key of Object.keys(value).sort()) {
    if (PROTOTYPE_KEYS.has(key)) continue;
    output[key] = stableNormalize(value[key], seen);
  }

  seen.delete(value);

  return output;
}

function canonicalize(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  return createHash('sha256')
    .update(canonicalize(value))
    .digest('hex');
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sanitize(
  value,
  path = '',
  depth = 0,
  config = DEFAULT_CONFIG,
) {
  if (depth > config.maxMetadataDepth) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > config.maxMetadataString
      ? `${value.slice(0, config.maxMetadataString)}…`
      : value;
  }

  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[BUFFER_REDACTED]';

  if (Array.isArray(value)) {
    return value
      .slice(0, config.maxMetadataArray)
      .map((item, index) =>
        sanitize(
          item,
          `${path}[${index}]`,
          depth + 1,
          config,
        ));
  }

  const output = {};

  for (const key of Object.keys(value).slice(0, config.maxMetadataKeys)) {
    if (PROTOTYPE_KEYS.has(key)) continue;

    const childPath = path ? `${path}.${key}` : key;

    if (
      SECRET_KEY_PATTERN.test(key)
      || SECRET_KEY_PATTERN.test(childPath)
    ) {
      output[key] = '[REDACTED]';
      continue;
    }

    output[key] = sanitize(
      value[key],
      childPath,
      depth + 1,
      config,
    );
  }

  return output;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (
    !value
    || typeof value !== 'object'
    || seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

function decimalParts(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    value = String(value);
  }

  const text = normalizeString(value, 100);
  if (!text) return null;

  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;

  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  let [whole, fraction = ''] = unsigned.split('.');

  whole = whole.replace(/^0+(?=\d)/, '') || '0';
  fraction = fraction.replace(/0+$/, '');

  return {
    negative,
    whole,
    fraction,
  };
}

function compareDecimal(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);

  if (!a || !b) return null;

  if (a.negative !== b.negative) {
    return a.negative ? -1 : 1;
  }

  const sign = a.negative ? -1 : 1;
  const aWhole = a.whole.padStart(50, '0');
  const bWhole = b.whole.padStart(50, '0');

  if (aWhole < bWhole) return -1 * sign;
  if (aWhole > bWhole) return 1 * sign;

  const scale = Math.max(
    a.fraction.length,
    b.fraction.length,
  );

  const aFraction = a.fraction.padEnd(scale, '0');
  const bFraction = b.fraction.padEnd(scale, '0');

  if (aFraction < bFraction) return -1 * sign;
  if (aFraction > bFraction) return 1 * sign;

  return 0;
}

function extractPath(source, path) {
  if (!path) {
    return {
      exists: false,
      value: undefined,
    };
  }

  const normalizedPath = String(path).trim();
  if (!normalizedPath) {
    return {
      exists: false,
      value: undefined,
    };
  }

  const segments = normalizedPath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current = source;

  for (const segment of segments) {
    if (PROTOTYPE_KEYS.has(segment)) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_RULE,
        'Unsafe policy path.',
        { path: normalizedPath },
      );
    }

    if (
      current === null
      || current === undefined
      || !Object.prototype.hasOwnProperty.call(
        Object(current),
        segment,
      )
    ) {
      return {
        exists: false,
        value: undefined,
      };
    }

    current = current[segment];
  }

  return {
    exists: true,
    value: current,
  };
}

function digestEvidenceValue(value) {
  return sha256(value).slice(0, 40);
}

function normalizeArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function severityRank(severity) {
  const normalized = upper(severity, 30) ?? 'INFO';

  return {
    INFO: 10,
    LOW: 20,
    MEDIUM: 30,
    HIGH: 40,
    CRITICAL: 50,
  }[normalized] ?? 10;
}

function highestSeverity(findings = []) {
  if (!findings.length) return 'INFO';

  return findings.reduce(
    (highest, finding) =>
      severityRank(finding.severity)
        > severityRank(highest)
        ? finding.severity
        : highest,
    'INFO',
  );
}

function normalizeMode(mode, fallback) {
  const candidate = upper(mode, 40) ?? fallback;

  if (!Object.values(POLICY_MODES).includes(candidate)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_INPUT,
      `Unsupported policy evaluation mode: ${candidate}.`,
    );
  }

  return candidate;
}

function normalizeDecision(decision) {
  const candidate = upper(decision, 80);

  if (!candidate) return undefined;

  const aliases = {
    REVIEW: POLICY_DECISIONS.REQUIRE_REVIEW,
    REQUIRE_REVIEW: POLICY_DECISIONS.REQUIRE_REVIEW,
    ALLOW: POLICY_DECISIONS.ALLOW,
    ALLOW_WITH_CONTROLS: POLICY_DECISIONS.ALLOW_WITH_CONTROLS,
    BLOCK: POLICY_DECISIONS.BLOCK,
    DENY: POLICY_DECISIONS.BLOCK,
    REJECT: POLICY_DECISIONS.BLOCK,
    NO_POLICY: POLICY_DECISIONS.NO_POLICY,
  };

  return aliases[candidate] ?? candidate;
}

function outcomeToDecision(outcome) {
  const normalized = upper(outcome, 80);

  if (normalized === RULE_OUTCOMES.BLOCK) {
    return POLICY_DECISIONS.BLOCK;
  }

  if (
    normalized === RULE_OUTCOMES.REVIEW
    || normalized === RULE_OUTCOMES.REQUIRE_EVIDENCE
  ) {
    return POLICY_DECISIONS.REQUIRE_REVIEW;
  }

  if (
    normalized === RULE_OUTCOMES.ALLOW_WITH_CONTROLS
    || normalized === RULE_OUTCOMES.REPORT
  ) {
    return POLICY_DECISIONS.ALLOW_WITH_CONTROLS;
  }

  if (normalized === RULE_OUTCOMES.ALLOW) {
    return POLICY_DECISIONS.ALLOW;
  }

  return undefined;
}

function isFinancialContext(context) {
  const impact = upper(context.impactLevel);

  if (
    impact
    && impact !== 'NON_FINANCIAL'
  ) {
    return true;
  }

  const operation = upper(context.operation);

  return new Set([
    'COLLECTION',
    'DISBURSEMENT',
    'REFUND',
    'REVERSAL',
    'SETTLEMENT',
  ]).has(operation);
}

function isPolicyEffective(policy, at) {
  const now = new Date(at).getTime();
  const effectiveFrom = policy.effectiveFrom
    ? new Date(policy.effectiveFrom).getTime()
    : null;
  const effectiveTo = policy.effectiveTo
    ? new Date(policy.effectiveTo).getTime()
    : null;

  if (
    effectiveFrom !== null
    && Number.isFinite(effectiveFrom)
    && now < effectiveFrom
  ) {
    return {
      active: false,
      reason: POLICY_ERROR_CODES.POLICY_NOT_EFFECTIVE,
    };
  }

  if (
    effectiveTo !== null
    && Number.isFinite(effectiveTo)
    && now >= effectiveTo
  ) {
    return {
      active: false,
      reason: POLICY_ERROR_CODES.POLICY_EXPIRED,
    };
  }

  return {
    active: true,
    reason: null,
  };
}

function specificityScore(policy) {
  let score = 0;

  if (policy.tenantId) score += 1000;
  if (policy.country) score += 100;
  if (policy.jurisdiction) score += 100;
  if (policy.operation) score += 50;
  if (policy.productType) score += 25;
  if (policy.channel) score += 25;

  return score;
}

function policyScopeMatches(policy, context) {
  if (
    policy.provider
    && upper(policy.provider) !== PROVIDER
  ) {
    return false;
  }

  if (
    policy.tenantId
    && policy.tenantId !== context.tenantId
  ) {
    return false;
  }

  if (
    policy.country
    && upper(policy.country) !== upper(context.country)
  ) {
    return false;
  }

  if (
    policy.jurisdiction
    && upper(policy.jurisdiction) !== upper(context.jurisdiction)
  ) {
    return false;
  }

  if (
    policy.operation
    && !normalizeArray(policy.operation)
      .map((item) => upper(item))
      .includes(upper(context.operation))
  ) {
    return false;
  }

  if (
    policy.productType
    && !normalizeArray(policy.productType)
      .map((item) => upper(item))
      .includes(upper(context.productType))
  ) {
    return false;
  }

  if (
    policy.channel
    && !normalizeArray(policy.channel)
      .map((item) => upper(item))
      .includes(upper(context.channel))
  ) {
    return false;
  }

  return true;
}

function normalizePolicyPack(input, config) {
  if (!isPlainObject(input)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_POLICY_PACK,
      'Policy pack must be a plain object.',
    );
  }

  const packId = normalizeString(
    input.packId
      ?? input.policyId
      ?? input.id,
    config.maxPolicyIdLength,
  );

  const version = normalizeString(
    input.version
      ?? input.policyVersion,
    config.maxVersionLength,
  );

  if (!packId || !version) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_POLICY_PACK,
      'Policy pack requires packId/policyId and version/policyVersion.',
    );
  }

  const status = upper(
    input.status
      ?? POLICY_STATUSES.ACTIVE,
    40,
  );

  if (!Object.values(POLICY_STATUSES).includes(status)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_POLICY_PACK,
      `Unsupported policy status: ${status}.`,
    );
  }

  const rules = Array.isArray(input.rules)
    ? input.rules
    : [];

  if (rules.length > config.maxRules) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_POLICY_PACK,
      `Policy pack exceeds the maximum of ${config.maxRules} rules.`,
      { packId, version },
    );
  }

  const normalizedRules = rules.map(
    (rule, index) =>
      normalizeRule(
        rule,
        index,
        config,
      ),
  );

  const policy = {
    packId,
    version,
    tenantId: normalizeString(
      input.tenantId,
      config.maxTenantIdLength,
    ),
    provider: upper(
      input.provider
        ?? PROVIDER,
    ),
    country: upper(input.country, 80),
    jurisdiction: upper(input.jurisdiction, 120),
    operation: input.operation
      ? normalizeArray(input.operation)
        .map((item) => upper(item, 120))
        .filter(Boolean)
      : undefined,
    productType: input.productType
      ? normalizeArray(input.productType)
        .map((item) => upper(item, 120))
        .filter(Boolean)
      : undefined,
    channel: input.channel
      ? normalizeArray(input.channel)
        .map((item) => upper(item, 80))
        .filter(Boolean)
      : undefined,
    status,
    mode: normalizeMode(
      input.mode,
      POLICY_MODES.ENFORCE,
    ),
    priority:
      Number.isInteger(input.priority)
        ? input.priority
        : 0,
    defaultDecision:
      normalizeDecision(
        input.defaultDecision
          ?? config.defaultDecisionWhenNoRuleMatches,
      )
        ?? POLICY_DECISIONS.REQUIRE_REVIEW,
    authority: normalizeString(
      input.authority,
      240,
    ),
    description: normalizeString(
      input.description,
      config.maxDescriptionLength,
    ),
    effectiveFrom: input.effectiveFrom
      ? toIso(input.effectiveFrom, 'policy.effectiveFrom')
      : undefined,
    effectiveTo: input.effectiveTo
      ? toIso(input.effectiveTo, 'policy.effectiveTo')
      : undefined,
    approvedAt: input.approvedAt
      ? toIso(input.approvedAt, 'policy.approvedAt')
      : undefined,
    approvedBy: normalizeString(
      input.approvedBy,
      160,
    ),
    controls: normalizeControls(
      input.controls,
      config,
    ),
    rules: normalizedRules,
    metadata: sanitize(
      input.metadata
        ?? {},
      'policy.metadata',
      0,
      config,
    ),
  };

  if (policy.effectiveFrom && policy.effectiveTo) {
    if (
      new Date(policy.effectiveTo).getTime()
      <= new Date(policy.effectiveFrom).getTime()
    ) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_POLICY_PACK,
        'policy.effectiveTo must be later than policy.effectiveFrom.',
        { packId, version },
      );
    }
  }

  if (policy.provider !== PROVIDER) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.POLICY_SCOPE_VIOLATION,
      'Policy provider is outside Airtel scope.',
      {
        packId,
        provider: policy.provider,
      },
    );
  }

  const policyFingerprint = sha256({
    schemaVersion: SCHEMA_VERSION,
    packId: policy.packId,
    version: policy.version,
    tenantId: policy.tenantId ?? null,
    provider: policy.provider,
    country: policy.country ?? null,
    jurisdiction: policy.jurisdiction ?? null,
    operation: policy.operation ?? null,
    productType: policy.productType ?? null,
    channel: policy.channel ?? null,
    status: policy.status,
    mode: policy.mode,
    priority: policy.priority,
    defaultDecision: policy.defaultDecision,
    authority: policy.authority ?? null,
    effectiveFrom: policy.effectiveFrom ?? null,
    effectiveTo: policy.effectiveTo ?? null,
    approvedAt: policy.approvedAt ?? null,
    approvedBy: policy.approvedBy ?? null,
    controls: policy.controls,
    rules: policy.rules,
  });

  policy.policyFingerprint = policyFingerprint;

  return deepFreeze(policy);
}

function normalizeControls(controls, config) {
  if (controls === undefined || controls === null) {
    return [];
  }

  if (!Array.isArray(controls)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_POLICY_PACK,
      'Policy controls must be an array.',
    );
  }

  return controls
    .slice(0, 100)
    .map((control, index) => {
      if (typeof control === 'string') {
        return {
          code: upper(control, 120),
          description: undefined,
          required: true,
        };
      }

      if (!isPlainObject(control)) {
        throw new AirtelDecisionPolicyError(
          POLICY_ERROR_CODES.INVALID_POLICY_PACK,
          `controls[${index}] must be an object or string.`,
        );
      }

      return {
        code: upper(control.code ?? control.id, 120),
        description: normalizeString(
          control.description,
          config.maxDescriptionLength,
        ),
        required:
          control.required !== false,
      };
    })
    .filter((item) => item.code);
}

function normalizeRule(rule, index, config) {
  if (!isPlainObject(rule)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Policy rule at index ${index} must be an object.`,
    );
  }

  const ruleId = normalizeString(
    rule.ruleId
      ?? rule.id,
    config.maxRuleIdLength,
  );

  if (!ruleId) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Policy rule at index ${index} requires ruleId/id.`,
    );
  }

  const result = upper(
    rule.result
      ?? rule.onResult
      ?? 'FAIL',
    40,
  );

  if (!Object.values(RULE_RESULTS).includes(result)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Unsupported rule result ${result} for ${ruleId}.`,
    );
  }

  const outcome = upper(
    rule.outcome
      ?? rule.effect
      ?? RULE_OUTCOMES.REVIEW,
    60,
  );

  if (!Object.values(RULE_OUTCOMES).includes(outcome)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Unsupported rule outcome ${outcome} for ${ruleId}.`,
    );
  }

  const assertions = Array.isArray(rule.assertions)
    ? rule.assertions
    : (
      rule.path
        ? [rule]
        : []
    );

  if (assertions.length > config.maxAssertionsPerRule) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Rule ${ruleId} exceeds the maximum of ${config.maxAssertionsPerRule} assertions.`,
    );
  }

  const normalizedAssertions = assertions.map(
    (assertion, assertionIndex) =>
      normalizeAssertion(
        assertion,
        ruleId,
        assertionIndex,
        config,
      ),
  );

  const aggregation = upper(
    rule.aggregation
      ?? AGGREGATION_MODES.ALL,
    20,
  );

  if (!Object.values(AGGREGATION_MODES).includes(aggregation)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Unsupported assertion aggregation ${aggregation} for ${ruleId}.`,
    );
  }

  return {
    ruleId,
    version: normalizeString(
      rule.version
        ?? rule.ruleVersion
        ?? '1',
      config.maxVersionLength,
    ),
    enabled: rule.enabled !== false,
    priority:
      Number.isInteger(rule.priority)
        ? rule.priority
        : 0,
    title: normalizeString(
      rule.title
        ?? ruleId,
      300,
    ),
    description: normalizeString(
      rule.description,
      config.maxDescriptionLength,
    ),
    severity: normalizeSeverity(
      rule.severity,
    ),
    aggregation,
    assertions: normalizedAssertions,
    outcome,
    result,
    findingCode:
      upper(
        rule.findingCode
          ?? `POLICY_${ruleId}`,
        160,
      ),
    reasonCode:
      upper(
        rule.reasonCode
          ?? rule.findingCode
          ?? `POLICY_${ruleId}`,
        160,
      ),
    controlCodes: normalizeArray(
      rule.controlCodes
        ?? rule.controls,
    )
      .map((item) => upper(item, 120))
      .filter(Boolean),
    metadata: sanitize(
      rule.metadata
        ?? {},
      `rule.${ruleId}.metadata`,
      0,
      config,
    ),
  };
}

function normalizeSeverity(value) {
  const candidate = upper(value, 30) ?? 'MEDIUM';

  if (!SEVERITIES.includes(candidate)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Unsupported rule severity: ${candidate}.`,
    );
  }

  return candidate;
}

function normalizeAssertion(
  assertion,
  ruleId,
  index,
  config,
) {
  if (!isPlainObject(assertion)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Rule ${ruleId} assertion ${index} must be an object.`,
    );
  }

  const path = normalizeString(
    assertion.path
      ?? assertion.field,
    300,
  );

  if (!path) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.INVALID_RULE,
      `Rule ${ruleId} assertion ${index} requires path/field.`,
    );
  }

  const operator = upper(
    assertion.operator
      ?? RULE_OPERATORS.EQUALS,
    40,
  );

  if (!Object.values(RULE_OPERATORS).includes(operator)) {
    throw new AirtelDecisionPolicyError(
      POLICY_ERROR_CODES.UNSUPPORTED_OPERATOR,
      `Unsupported assertion operator ${operator}.`,
      { ruleId, index, operator },
    );
  }

  const assertionValue = assertion.value !== undefined
    ? clone(assertion.value)
    : clone(assertion.expected);

  if (
    operator === RULE_OPERATORS.IN
    || operator === RULE_OPERATORS.NOT_IN
  ) {
    if (!Array.isArray(assertionValue)) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_RULE,
        `Assertion ${ruleId}/${index} requires an array value for ${operator}.`,
      );
    }
  }

  if (
    operator === RULE_OPERATORS.BETWEEN
    || operator === RULE_OPERATORS.DECIMAL_BETWEEN
  ) {
    if (
      !Array.isArray(assertionValue)
      || assertionValue.length !== 2
    ) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_RULE,
        `Assertion ${ruleId}/${index} requires [min,max] for ${operator}.`,
      );
    }
  }

  if (operator === RULE_OPERATORS.MATCHES) {
    if (typeof assertionValue !== 'string') {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_RULE,
        `Assertion ${ruleId}/${index} requires a regex string for MATCHES.`,
      );
    }

    try {
      new RegExp(assertionValue);
    } catch (error) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_RULE,
        `Assertion ${ruleId}/${index} contains an invalid regular expression.`,
        {},
        { cause: error },
      );
    }
  }

  if (
    operator.startsWith('DECIMAL_')
    && operator !== RULE_OPERATORS.DECIMAL_BETWEEN
  ) {
    if (!decimalParts(assertionValue)) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_RULE,
        `Assertion ${ruleId}/${index} requires a decimal-compatible value.`,
      );
    }
  }

  return {
    path,
    operator,
    value: sanitize(
      assertionValue,
      `rule.${ruleId}.assertion.${index}.value`,
      0,
      config,
    ),
    unknownOutcome:
      normalizeDecision(
        assertion.unknownOutcome,
      )
      ?? POLICY_DECISIONS.REQUIRE_REVIEW,
    description: normalizeString(
      assertion.description,
      config.maxDescriptionLength,
    ),
  };
}

function evaluateOperator(
  operator,
  actual,
  exists,
  expected,
) {
  switch (operator) {
    case RULE_OPERATORS.EXISTS:
      return exists;

    case RULE_OPERATORS.NOT_EXISTS:
      return !exists;

    case RULE_OPERATORS.TRUE:
      return exists && actual === true;

    case RULE_OPERATORS.FALSE:
      return exists && actual === false;

    case RULE_OPERATORS.EQUALS:
      return exists && stableNormalize(actual) === stableNormalize(expected);

    case RULE_OPERATORS.NOT_EQUALS:
      return exists && stableNormalize(actual) !== stableNormalize(expected);

    case RULE_OPERATORS.IN:
      return exists
        && Array.isArray(expected)
        && expected.some(
          (candidate) =>
            stableNormalize(candidate)
              === stableNormalize(actual),
        );

    case RULE_OPERATORS.NOT_IN:
      return exists
        && Array.isArray(expected)
        && !expected.some(
          (candidate) =>
            stableNormalize(candidate)
              === stableNormalize(actual),
        );

    case RULE_OPERATORS.GT:
      return exists
        && Number.isFinite(Number(actual))
        && Number(actual) > Number(expected);

    case RULE_OPERATORS.GTE:
      return exists
        && Number.isFinite(Number(actual))
        && Number(actual) >= Number(expected);

    case RULE_OPERATORS.LT:
      return exists
        && Number.isFinite(Number(actual))
        && Number(actual) < Number(expected);

    case RULE_OPERATORS.LTE:
      return exists
        && Number.isFinite(Number(actual))
        && Number(actual) <= Number(expected);

    case RULE_OPERATORS.BETWEEN:
      return exists
        && Array.isArray(expected)
        && Number.isFinite(Number(actual))
        && Number(actual) >= Number(expected[0])
        && Number(actual) <= Number(expected[1]);

    case RULE_OPERATORS.DECIMAL_GT: {
      const comparison = compareDecimal(actual, expected);
      return comparison !== null && comparison > 0;
    }

    case RULE_OPERATORS.DECIMAL_GTE: {
      const comparison = compareDecimal(actual, expected);
      return comparison !== null && comparison >= 0;
    }

    case RULE_OPERATORS.DECIMAL_LT: {
      const comparison = compareDecimal(actual, expected);
      return comparison !== null && comparison < 0;
    }

    case RULE_OPERATORS.DECIMAL_LTE: {
      const comparison = compareDecimal(actual, expected);
      return comparison !== null && comparison <= 0;
    }

    case RULE_OPERATORS.DECIMAL_BETWEEN: {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const low = compareDecimal(actual, expected[0]);
      const high = compareDecimal(actual, expected[1]);

      return (
        low !== null
        && high !== null
        && low >= 0
        && high <= 0
      );
    }

    case RULE_OPERATORS.MATCHES:
      return exists
        && typeof actual === 'string'
        && new RegExp(String(expected)).test(actual);

    case RULE_OPERATORS.PREFIX:
      return exists
        && String(actual).startsWith(String(expected));

    case RULE_OPERATORS.SUFFIX:
      return exists
        && String(actual).endsWith(String(expected));

    default:
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.UNSUPPORTED_OPERATOR,
        `Unsupported policy operator: ${operator}.`,
      );
  }
}

function evaluateAssertion(
  assertion,
  context,
) {
  const extracted = extractPath(
    context,
    assertion.path,
  );

  let result;

  try {
    result = evaluateOperator(
      assertion.operator,
      extracted.value,
      extracted.exists,
      assertion.value,
    );
  } catch (error) {
    return {
      result:
        RULE_RESULTS.ERROR,

      reason:
        POLICY_ERROR_CODES.EVALUATION_FAILED,

      extracted,

      error,
    };
  }

  if (!extracted.exists) {
    return {
      result:
        RULE_RESULTS.UNKNOWN,

      reason:
        'EVIDENCE_NOT_PRESENT',

      extracted,
    };
  }

  return {
    result:
      result
        ? RULE_RESULTS.PASS
        : RULE_RESULTS.FAIL,

    reason:
      result
        ? 'ASSERTION_MATCHED'
        : 'ASSERTION_DID_NOT_MATCH',

    extracted,
  };
}

function aggregateAssertions(
  assertions,
  aggregation,
) {
  if (!assertions.length) {
    return {
      result: RULE_RESULTS.NOT_APPLICABLE,
      unknown: false,
    };
  }

  const statuses = assertions.map(
    (assertion) => assertion.result,
  );

  const hasError = statuses.includes(
    RULE_RESULTS.ERROR,
  );

  const hasUnknown = statuses.includes(
    RULE_RESULTS.UNKNOWN,
  );

  const passes = statuses.filter(
    (item) => item === RULE_RESULTS.PASS,
  ).length;

  const fails = statuses.filter(
    (item) => item === RULE_RESULTS.FAIL,
  ).length;

  if (hasError) {
    return {
      result:
        RULE_RESULTS.ERROR,
      unknown:
        false,
    };
  }

  switch (aggregation) {
    case AGGREGATION_MODES.ALL:
      if (fails > 0) {
        return {
          result:
            RULE_RESULTS.FAIL,
          unknown:
            false,
        };
      }

      if (hasUnknown) {
        return {
          result:
            RULE_RESULTS.UNKNOWN,
          unknown:
            true,
        };
      }

      return {
        result:
          passes === assertions.length
            ? RULE_RESULTS.PASS
            : RULE_RESULTS.UNKNOWN,
        unknown:
          passes !== assertions.length,
      };

    case AGGREGATION_MODES.ANY:
      if (passes > 0) {
        return {
          result:
            RULE_RESULTS.PASS,
          unknown:
            false,
        };
      }

      if (hasUnknown) {
        return {
          result:
            RULE_RESULTS.UNKNOWN,
          unknown:
            true,
        };
      }

      return {
        result:
          RULE_RESULTS.FAIL,
        unknown:
          false,
      };

    case AGGREGATION_MODES.NONE:
      if (passes > 0) {
        return {
          result:
            RULE_RESULTS.FAIL,
          unknown:
            false,
        };
      }

      if (hasUnknown) {
        return {
          result:
            RULE_RESULTS.UNKNOWN,
          unknown:
            true,
        };
      }

      return {
        result:
          RULE_RESULTS.PASS,
        unknown:
          false,
      };

    default:
      return {
        result:
          RULE_RESULTS.ERROR,
        unknown:
          false,
      };
  }
}

function buildRuleFinding(
  rule,
  assertionEvaluations,
  aggregation,
  policy,
) {
  const aggregate = aggregateAssertions(
    assertionEvaluations.map(
      (item) => item.evaluation,
    ),
    aggregation,
  );

  const outcome = rule.outcome;

  const finding = {
    ruleId:
      rule.ruleId,

    ruleVersion:
      rule.version,

    title:
      rule.title,

    description:
      rule.description,

    result:
      aggregate.result,

    outcome:
      aggregate.result === RULE_RESULTS.PASS
        ? outcome
        : aggregate.result === RULE_RESULTS.UNKNOWN
          ? RULE_OUTCOMES.REQUIRE_EVIDENCE
          : aggregate.result === RULE_RESULTS.ERROR
            ? RULE_OUTCOMES.REVIEW
            : undefined,

    configuredOutcome:
      outcome,

    severity:
      rule.severity,

    code:
      rule.findingCode,

    reasonCode:
      aggregate.result === RULE_RESULTS.UNKNOWN
        ? 'EVIDENCE_INCOMPLETE'
        : aggregate.result === RULE_RESULTS.ERROR
          ? POLICY_ERROR_CODES.EVALUATION_FAILED
          : rule.reasonCode,

    aggregation,

    assertions:
      assertionEvaluations.map(
        (item) => ({
          path:
            item.assertion.path,

          operator:
            item.assertion.operator,

          result:
            item.evaluation.result,

          reason:
            item.evaluation.reason,

          exists:
            item.evaluation.extracted.exists,

          valueDigest:
            item.evaluation.extracted.exists
              ? digestEvidenceValue(
                item.evaluation.extracted.value,
              )
              : null,

          expectedDigest:
            item.assertion.value !== undefined
              ? digestEvidenceValue(
                item.assertion.value,
              )
              : null,

          description:
            item.assertion.description,
        }),
      ),

    controlCodes:
      rule.controlCodes,

    policy: {
      packId:
        policy.packId,

      version:
        policy.version,

      fingerprint:
        policy.policyFingerprint,
    },
  };

  return finding;
}

function decisionFromFindings(
  findings,
  policy,
  context,
  config,
) {
  // Policy rules are trigger rules: their assertions describe the condition
  // under which the configured outcome applies. A failed assertion therefore
  // means the rule did not trigger; it must not be interpreted as a violation.
  const blockFindings = findings.filter(
    (finding) =>
      finding.result === RULE_RESULTS.PASS
      && finding.configuredOutcome
      === RULE_OUTCOMES.BLOCK,
  );

  const reviewFindings = findings.filter(
    (finding) =>
      finding.result === RULE_RESULTS.ERROR
      ||
      finding.result === RULE_RESULTS.UNKNOWN
      ||
      (
        finding.result === RULE_RESULTS.PASS
        && (
          finding.configuredOutcome
          === RULE_OUTCOMES.REVIEW
          ||
          finding.configuredOutcome
          === RULE_OUTCOMES.REQUIRE_EVIDENCE
        )
      ),
  );

  const controlFindings = findings.filter(
    (finding) =>
      finding.result === RULE_RESULTS.PASS
      && (
        finding.configuredOutcome
        === RULE_OUTCOMES.ALLOW_WITH_CONTROLS
        ||
        finding.configuredOutcome
        === RULE_OUTCOMES.REPORT
      ),
  );

  if (blockFindings.length > 0) {
    return {
      decision:
        POLICY_DECISIONS.BLOCK,

      rationale:
        'At least one applicable policy rule produced a blocking outcome.',

      blockFindings,
      reviewFindings,
      controlFindings,
    };
  }

  if (reviewFindings.length > 0) {
    return {
      decision:
        POLICY_DECISIONS.REQUIRE_REVIEW,

      rationale:
        'One or more policy rules require additional evidence or human review.',

      blockFindings,
      reviewFindings,
      controlFindings,
    };
  }

  if (controlFindings.length > 0) {
    return {
      decision:
        POLICY_DECISIONS.ALLOW_WITH_CONTROLS,

      rationale:
        'Policy permits the operation subject to explicit governance controls.',

      blockFindings,
      reviewFindings,
      controlFindings,
    };
  }

  const matchedRules = findings.filter(
    (finding) =>
      finding.result === RULE_RESULTS.PASS
      && finding.configuredOutcome
      === RULE_OUTCOMES.ALLOW,
  );

  if (matchedRules.length > 0) {
    return {
      decision:
        POLICY_DECISIONS.ALLOW,

      rationale:
        'Applicable policy rules passed without additional controls.',

      blockFindings,
      reviewFindings,
      controlFindings,
    };
  }

  const defaultDecision =
    normalizeDecision(
      policy.defaultDecision,
    )
      ?? config.defaultDecisionWhenNoRuleMatches;

  if (
    isFinancialContext(context)
    && defaultDecision
      === POLICY_DECISIONS.ALLOW
  ) {
    return {
      decision:
        POLICY_DECISIONS.REQUIRE_REVIEW,

      rationale:
        'A financial-impact operation cannot obtain implicit ALLOW from a policy pack with no applicable passing rule.',

      blockFindings,
      reviewFindings,
      controlFindings,
    };
  }

  return {
    decision:
      defaultDecision,

    rationale:
      'No applicable policy rule produced an explicit outcome; the policy default was applied.',

    blockFindings,
    reviewFindings,
    controlFindings,
  };
}

export class AirtelDecisionPolicyError extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message, options);

    this.name =
      'AirtelDecisionPolicyError';

    this.code =
      code;

    this.component =
      COMPONENT;

    this.provider =
      PROVIDER;

    this.details =
      details;

    this.retryable =
      Boolean(options.retryable);

    this.httpStatus =
      options.httpStatus ?? 400;
  }
}

export class AirtelDecisionPolicyEngine {
  constructor(options = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...(options.config ?? {}),
    });

    this.policyRepository =
      options.policyRepository
      ?? options.repository
      ?? options.policyStore
      ?? null;

    this.defaultPolicyPack =
      options.policyPack
      ?? options.defaultPolicyPack
      ?? null;

    this.policyResolver =
      options.policyResolver
      ?? null;

    this.logger =
      options.logger
      ?? null;

    this.metrics =
      options.metrics
      ?? null;

    this.clock =
      options.clock
      ?? {
        now: () => Date.now(),
      };
  }

  _now() {
    return nowIso(this.clock);
  }

  _normalizeContext(input = {}) {
    if (!isPlainObject(input)) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_INPUT,
        'Policy evaluation input must be an object.',
      );
    }

    const context = clone(input) ?? {};

    delete context.password;
    delete context.secret;
    delete context.token;
    delete context.authorization;
    delete context.cookie;
    delete context.otp;
    delete context.pin;
    delete context.rawRequest;
    delete context.rawResponse;
    delete context.providerPayload;

    const tenantId = normalizeString(
      context.tenantId,
      this.config.maxTenantIdLength,
    );

    if (
      this.config.requireTenantId
      && !tenantId
    ) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required for policy evaluation.',
        {},
        {
          httpStatus: 400,
        },
      );
    }

    const provider = upper(
      context.provider
        ?? PROVIDER,
    );

    if (
      this.config.enforceAirtelProvider
      && provider !== PROVIDER
    ) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'Policy engine is scoped to the Airtel provider.',
        { provider },
        {
          httpStatus: 409,
        },
      );
    }

    const operation = upper(
      context.operation
        ?? context.operationType,
      this.config.maxOperationLength
        ?? 120,
    );

    if (!operation) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.OPERATION_REQUIRED,
        'operation or operationType is required for policy evaluation.',
      );
    }

    const impactLevel = upper(
      context.impactLevel
        ?? context.financialImpact
        ?? (
          context.isFinancialImpact
            ? 'FINANCIAL'
            : undefined
        ),
      80,
    )
      ?? (
        isFinancialContext({ operation })
          ? 'FINANCIAL'
          : 'NON_FINANCIAL'
      );

    return {
      tenantId,
      provider,
      operation,
      operationType: upper(
        context.operationType,
        120,
      ),
      impactLevel,
      country: upper(
        context.country,
        80,
      ),
      jurisdiction: upper(
        context.jurisdiction,
        120,
      ),
      channel: upper(
        context.channel,
        80,
      ),
      productType: upper(
        context.productType,
        120,
      ),
      currency: upper(
        context.currency,
        20,
      ),
      amountMinor:
        context.amountMinor === undefined
          ? undefined
          : String(context.amountMinor),
      paymentId:
        normalizeString(
          context.paymentId
            ?? context.paymentIdentity?.paymentId,
          240,
        ),
      transactionId:
        normalizeString(
          context.transactionId
            ?? context.paymentIdentity?.transactionId,
          240,
        ),
      providerReference:
        normalizeString(
          context.providerReference
            ?? context.paymentIdentity?.providerReference,
          240,
        ),
      originalIdempotencyKey:
        normalizeString(
          context.originalIdempotencyKey
            ?? context.paymentIdentity?.originalIdempotencyKey
            ?? context.paymentIdentity?.idempotencyKey
            ?? context.idempotencyKey,
          300,
        ),
      offlineState:
        upper(
          context.offlineState
            ?? context.paymentIdentity?.offlineState,
          80,
        ),
      riskLevel:
        upper(
          context.riskLevel
            ?? context.risk?.level
            ?? context.prediction?.riskLevel,
          50,
        ),
      modelVersion:
        normalizeString(
          context.modelVersion
            ?? context.model?.version
            ?? context.model?.modelVersion,
          120,
        ),
      policyPackHint:
        normalizeString(
          context.policyPackId
            ?? context.policyId,
          200,
        ),
      policyVersionHint:
        normalizeString(
          context.policyVersion,
          100,
        ),
      input: sanitize(
        context.input
          ?? context.context
          ?? context,
        'evaluation.input',
        0,
        this.config,
      ),
      evidence:
        sanitize(
          context.evidence
            ?? {},
          'evaluation.evidence',
          0,
          this.config,
        ),
    };
  }

  async _resolvePolicyPack(
    context,
    input,
  ) {
    if (input.policyPack) {
      return normalizePolicyPack(
        input.policyPack,
        this.config,
      );
    }

    if (this.policyResolver) {
      const resolve =
        typeof this.policyResolver === 'function'
          ? this.policyResolver
          : this.policyResolver.resolve
            ?? this.policyResolver.getPolicyPack
            ?? this.policyResolver.resolvePolicy;

      if (typeof resolve !== 'function') {
        throw new AirtelDecisionPolicyError(
          POLICY_ERROR_CODES.POLICY_UNAVAILABLE,
          'Configured policy resolver does not expose a supported resolve method.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      try {
        const resolved =
          await resolve.call(
            this.policyResolver,
            {
              tenantId:
                context.tenantId,

              provider:
                PROVIDER,

              operation:
                context.operation,

              jurisdiction:
                context.jurisdiction,

              country:
                context.country,

              channel:
                context.channel,

              productType:
                context.productType,

              policyPackId:
                context.policyPackHint,

              policyVersion:
                context.policyVersionHint,
            },
          );

        if (Array.isArray(resolved)) {
          return this._selectPolicyPack(
            resolved,
            context,
          );
        }

        if (!resolved) {
          return null;
        }

        return normalizePolicyPack(
          resolved.policyPack
            ?? resolved,
          this.config,
        );
      } catch (error) {
        this._log(
          'error',
          'Decision policy resolver failed.',
          {
            error:
              this._safeError(error),
          },
        );

        if (
          this.config.failClosedOnPolicyRepositoryError
        ) {
          throw new AirtelDecisionPolicyError(
            POLICY_ERROR_CODES.POLICY_UNAVAILABLE,
            'Decision policy could not be resolved safely.',
            {},
            {
              retryable: true,
              httpStatus: 503,
              cause: error,
            },
          );
        }

        return null;
      }
    }

    if (this.policyRepository) {
      const resolve =
        this.policyRepository.getActivePolicy
        ?? this.policyRepository.resolve
        ?? this.policyRepository.getPolicy
        ?? this.policyRepository.findActive;

      if (typeof resolve !== 'function') {
        throw new AirtelDecisionPolicyError(
          POLICY_ERROR_CODES.POLICY_UNAVAILABLE,
          'Configured policy repository does not expose a supported resolver.',
          {},
          {
            retryable: true,
            httpStatus: 503,
          },
        );
      }

      try {
        const resolved =
          await resolve.call(
            this.policyRepository,
            {
              tenantId:
                context.tenantId,

              provider:
                PROVIDER,

              operation:
                context.operation,

              jurisdiction:
                context.jurisdiction,

              country:
                context.country,

              channel:
                context.channel,

              productType:
                context.productType,

              policyPackId:
                context.policyPackHint,

              policyVersion:
                context.policyVersionHint,
            },
          );

        if (Array.isArray(resolved)) {
          return this._selectPolicyPack(
            resolved,
            context,
          );
        }

        if (!resolved) return null;

        return normalizePolicyPack(
          resolved.policyPack
            ?? resolved,
          this.config,
        );
      } catch (error) {
        this._log(
          'error',
          'Decision policy repository lookup failed.',
          {
            error:
              this._safeError(error),
          },
        );

        if (
          this.config.failClosedOnPolicyRepositoryError
        ) {
          throw new AirtelDecisionPolicyError(
            POLICY_ERROR_CODES.POLICY_UNAVAILABLE,
            'Decision policy repository is unavailable.',
            {},
            {
              retryable: true,
              httpStatus: 503,
              cause: error,
            },
          );
        }

        return null;
      }
    }

    if (this.defaultPolicyPack) {
      return normalizePolicyPack(
        this.defaultPolicyPack,
        this.config,
      );
    }

    return null;
  }

  _selectPolicyPack(
    candidates,
    context,
  ) {
    const normalized = candidates
      .slice(0, this.config.maxPolicies)
      .map((candidate) =>
        normalizePolicyPack(
          candidate.policyPack
            ?? candidate,
          this.config,
        ))
      .filter((policy) =>
        policyScopeMatches(
          policy,
          context,
        ));

    if (!normalized.length) return null;

    const effective = normalized.filter(
      (policy) =>
        ALLOWED_PACK_STATUSES.has(policy.status)
        && isPolicyEffective(
          policy,
          this._now(),
        ).active,
    );

    if (!effective.length) return null;

    effective.sort(
      (a, b) =>
        specificityScore(b)
          - specificityScore(a)
        || b.priority - a.priority
        || String(b.version).localeCompare(
          String(a.version),
          undefined,
          { numeric: true },
        )
        || a.packId.localeCompare(b.packId),
    );

    const first = effective[0];

    const sameSpecificity = effective.filter(
      (candidate) =>
        specificityScore(candidate)
        === specificityScore(first)
        && candidate.priority
        === first.priority,
    );

    if (sameSpecificity.length > 1) {
      const distinctFingerprints = new Set(
        sameSpecificity.map(
          (item) => item.policyFingerprint,
        ),
      );

      if (distinctFingerprints.size > 1) {
        throw new AirtelDecisionPolicyError(
          POLICY_ERROR_CODES.AMBIGUOUS_POLICY,
          'Multiple equally specific active policy packs apply to this decision context.',
          {
            packIds:
              sameSpecificity.map(
                (item) =>
                  `${item.packId}:${item.version}`,
              ),
          },
          {
            httpStatus: 409,
          },
        );
      }
    }

    return first;
  }

  _assertPolicyUsable(
    policy,
    context,
    mode,
  ) {
    if (!policy) {
      if (
        this.config.requirePolicyForFinancialImpact
        && isFinancialContext(context)
      ) {
        return {
          usable:
            false,

          decision:
            POLICY_DECISIONS.NO_POLICY,

          reason:
            'NO_APPLICABLE_POLICY',
        };
      }

      return {
        usable:
          false,

        decision:
          POLICY_DECISIONS.NO_POLICY,

        reason:
          'NO_APPLICABLE_POLICY',
      };
    }

    if (
      this.config.requireActivePolicy
      && !ALLOWED_PACK_STATUSES.has(
        policy.status,
      )
    ) {
      return {
        usable:
          false,

        decision:
          POLICY_DECISIONS.NO_POLICY,

        reason:
          'POLICY_NOT_ACTIVE',
      };
    }

    const effectiveness =
      isPolicyEffective(
        policy,
        this._now(),
      );

    if (!effectiveness.active) {
      return {
        usable:
          false,

        decision:
          POLICY_DECISIONS.NO_POLICY,

        reason:
          effectiveness.reason,
      };
    }

    if (!policyScopeMatches(policy, context)) {
      return {
        usable:
          false,

        decision:
          POLICY_DECISIONS.NO_POLICY,

        reason:
          'POLICY_SCOPE_MISMATCH',
      };
    }

    if (
      mode === POLICY_MODES.ENFORCE
      && policy.mode
      === POLICY_MODES.ADVISORY
    ) {
      return {
        usable:
          true,

        advisoryOnly:
          true,

        decision:
          POLICY_DECISIONS.REQUIRE_REVIEW,

        reason:
          'POLICY_ADVISORY_ONLY',
      };
    }

    return {
      usable:
        true,

      advisoryOnly:
        mode !== POLICY_MODES.ENFORCE
        || policy.mode !== POLICY_MODES.ENFORCE,

      decision:
        null,

      reason:
        null,
    };
  }

  _evaluateRule(
    rule,
    context,
    policy,
  ) {
    if (!rule.enabled) {
      return {
        applicable:
          false,

        finding: {
          ruleId:
            rule.ruleId,

          ruleVersion:
            rule.version,

          result:
            RULE_RESULTS.NOT_APPLICABLE,

          outcome:
            RULE_OUTCOMES.ALLOW,

          configuredOutcome:
            rule.outcome,

          severity:
            rule.severity,

          code:
            rule.findingCode,

          reasonCode:
            'RULE_DISABLED',

          assertions: [],

          controlCodes:
            rule.controlCodes,
        },
      };
    }

    try {
      const evaluations =
        rule.assertions.map(
          (assertion) => ({
            assertion,
            evaluation:
              evaluateAssertion(
                assertion,
                context.input,
              ),
          }),
        );

      const finding =
        buildRuleFinding(
          rule,
          evaluations,
          rule.aggregation,
          policy,
        );

      const applicable =
        finding.result
        !== RULE_RESULTS.NOT_APPLICABLE;

      return {
        applicable,
        finding,
      };
    } catch (error) {
      if (this.config.failClosedOnRuleError) {
        throw new AirtelDecisionPolicyError(
          POLICY_ERROR_CODES.EVALUATION_FAILED,
          `Policy rule ${rule.ruleId} failed during evaluation.`,
          {
            ruleId:
              rule.ruleId,
          },
          {
            retryable: false,
            httpStatus: 422,
            cause: error,
          },
        );
      }

      return {
        applicable:
          true,

        finding: {
          ruleId:
            rule.ruleId,

          ruleVersion:
            rule.version,

          title:
            rule.title,

          description:
            rule.description,

          result:
            RULE_RESULTS.ERROR,

          outcome:
            RULE_OUTCOMES.REVIEW,

          configuredOutcome:
            rule.outcome,

          severity:
            'CRITICAL',

          code:
            rule.findingCode,

          reasonCode:
            POLICY_ERROR_CODES.EVALUATION_FAILED,

          assertions: [],

          controlCodes:
            rule.controlCodes,
        },
      };
    }
  }

  _normalizeRules(policy) {
    return [...policy.rules].sort(
      (a, b) =>
        b.priority - a.priority
        || b.severity.length - a.severity.length
        || a.ruleId.localeCompare(b.ruleId),
    );
  }

  _buildDecisionFingerprint(
    context,
    policy,
    findings,
    decision,
  ) {
    return sha256({
      schemaVersion:
        SCHEMA_VERSION,

      tenantId:
        context.tenantId,

      provider:
        context.provider,

      operation:
        context.operation,

      impactLevel:
        context.impactLevel,

      country:
        context.country
        ?? null,

      jurisdiction:
        context.jurisdiction
        ?? null,

      channel:
        context.channel
        ?? null,

      productType:
        context.productType
        ?? null,

      currency:
        context.currency
        ?? null,

      amountMinorDigest:
        context.amountMinor !== undefined
          ? digestEvidenceValue(
            context.amountMinor,
          )
          : null,

      paymentIdDigest:
        context.paymentId
          ? digestEvidenceValue(
            context.paymentId,
          )
          : null,

      transactionIdDigest:
        context.transactionId
          ? digestEvidenceValue(
            context.transactionId,
          )
          : null,

      providerReferenceDigest:
        context.providerReference
          ? digestEvidenceValue(
            context.providerReference,
          )
          : null,

      originalIdempotencyKeyDigest:
        context.originalIdempotencyKey
          ? digestEvidenceValue(
            context.originalIdempotencyKey,
          )
          : null,

      offlineState:
        context.offlineState
        ?? null,

      riskLevel:
        context.riskLevel
        ?? null,

      policyId:
        policy?.packId
        ?? null,

      policyVersion:
        policy?.version
        ?? null,

      policyFingerprint:
        policy?.policyFingerprint
        ?? null,

      decision,

      findings:
        findings.map(
          (finding) => ({
            ruleId:
              finding.ruleId,

            ruleVersion:
              finding.ruleVersion,

            result:
              finding.result,

            outcome:
              finding.configuredOutcome,

            severity:
              finding.severity,

            code:
              finding.code,

            reasonCode:
              finding.reasonCode,

            assertionResults:
              finding.assertions.map(
                (assertion) => ({
                  path:
                    assertion.path,

                  operator:
                    assertion.operator,

                  result:
                    assertion.result,

                  valueDigest:
                    assertion.valueDigest,

                  expectedDigest:
                    assertion.expectedDigest,
                }),
              ),
          }),
        ),
    });
  }

  async evaluate(
    input = {},
    options = {},
  ) {
    const context =
      this._normalizeContext(
        input,
      );

    const mode =
      normalizeMode(
        options.mode
          ?? input.mode,
        this.config.defaultMode,
      );

    const policy =
      await this._resolvePolicyPack(
        context,
        input,
      );

    const usability =
      this._assertPolicyUsable(
        policy,
        context,
        mode,
      );

    if (!usability.usable) {
      const decision =
        usability.decision
        ?? POLICY_DECISIONS.NO_POLICY;

      const decisionFingerprint =
        this._buildDecisionFingerprint(
          context,
          policy,
          [],
          decision,
        );

      const result = {
        success:
          true,

        component:
          COMPONENT,

        engine:
          ENGINE_NAME,

        engineVersion:
          ENGINE_VERSION,

        schemaVersion:
          SCHEMA_VERSION,

        evaluatedAt:
          this._now(),

        decisionId:
          decisionFingerprint.slice(
            0,
            40,
          ),

        decisionFingerprint,

        policyFingerprint:
          policy?.policyFingerprint
          ?? null,

        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          context.operation,

        operationType:
          context.operationType,

        impactLevel:
          context.impactLevel,

        mode,

        decision,

        outcome:
          decision,

        recommendedAction:
          decision === POLICY_DECISIONS.BLOCK
            ? 'BLOCK'
            : decision === POLICY_DECISIONS.ALLOW
              ? 'PROCEED_TO_GOVERNED_EXECUTION'
              : 'REQUIRE_REVIEW',

        highestSeverity:
          decision === POLICY_DECISIONS.BLOCK
            ? 'CRITICAL'
            : 'HIGH',

        confidence:
          decision === POLICY_DECISIONS.NO_POLICY
            ? 0
            : null,

        policy:
          policy
            ? this._publicPolicySummary(
              policy,
            )
            : null,

        findings: [
          {
            code:
              usability.reason,

            reasonCode:
              usability.reason,

            severity:
              decision === POLICY_DECISIONS.BLOCK
                ? 'CRITICAL'
                : 'HIGH',

            result:
              RULE_RESULTS.UNKNOWN,

            outcome:
              RULE_OUTCOMES.REQUIRE_EVIDENCE,

            configuredOutcome:
              RULE_OUTCOMES.REQUIRE_EVIDENCE,

            message:
              this._noPolicyMessage(
                usability.reason,
              ),
          },
        ],

        findingSummary:
          this._summarizeFindings([]),

        appliedRules: [],

        missingEvidence: [
          'applicable_policy',
        ],

        governance: {
          makerCheckerRequired:
            isFinancialContext(context),

          approvalRequired:
            isFinancialContext(context),

          policyApprovalPresent:
            Boolean(
              policy?.approvedAt
              || policy?.approvedBy,
            ),
        },

        safety: {
          financialMutationPerformed:
            false,

          ledgerMutationPerformed:
            false,

          providerCallPerformed:
            false,

          decisionAuthority:
            'POLICY_EVALUATION_ONLY',
        },

        diagnostics: {
          policyAvailable:
            Boolean(policy),

          policyUsability:
            usability,

          failClosed:
            isFinancialContext(context),
        },
      };

      this._metric(
        'policy_no_policy_total',
        {
          operation:
            context.operation,
        },
      );

      return deepFreeze(
        result,
      );
    }

    const sortedRules =
      this._normalizeRules(
        policy,
      );

    const findings = [];

    for (const rule of sortedRules) {
      if (findings.length >= this.config.maxFindings) {
        break;
      }

      const evaluated =
        this._evaluateRule(
          rule,
          context,
          policy,
        );

      if (evaluated.finding) {
        findings.push(
          evaluated.finding,
        );
      }
    }

    const decisionAggregate =
      decisionFromFindings(
        findings,
        policy,
        context,
        this.config,
      );

    let decision =
      decisionAggregate.decision;

    if (
      usability.advisoryOnly
      && decision
        === POLICY_DECISIONS.BLOCK
    ) {
      decision =
        POLICY_DECISIONS.BLOCK;
    }

    const decisionFingerprint =
      this._buildDecisionFingerprint(
        context,
        policy,
        findings,
        decision,
      );

    const highest =
      highestSeverity(
        findings,
      );

    const confidence =
      this._calculateConfidence(
        findings,
        decision,
      );

    const controls = [
      ...policy.controls,
      ...findings.flatMap(
        (finding) =>
          finding.controlCodes ?? [],
      ),
    ];

    const uniqueControls = [
      ...new Map(
        controls.map(
          (control) => [
            control.code
              ?? control,
            control,
          ],
        ),
      ).values(),
    ];

    const result = {
      success:
        true,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      evaluatedAt:
        this._now(),

      decisionId:
        decisionFingerprint.slice(
          0,
          40,
        ),

      idempotencyKey:
        `airtel-policy:${String(
          context.tenantId,
        ).toLowerCase()}:${decisionFingerprint.slice(
          0,
          40,
        )}`,

      decisionFingerprint,

      policyFingerprint:
        policy.policyFingerprint,

      tenantId:
        context.tenantId,

      provider:
        PROVIDER,

      operation:
        context.operation,

      operationType:
        context.operationType,

      country:
        context.country,

      jurisdiction:
        context.jurisdiction,

      channel:
        context.channel,

      productType:
        context.productType,

      currency:
        context.currency,

      impactLevel:
        context.impactLevel,

      mode,

      decision,

      outcome:
        decision,

      recommendedAction:
        decision === POLICY_DECISIONS.BLOCK
          ? 'BLOCK'
          : decision === POLICY_DECISIONS.REQUIRE_REVIEW
            ? 'REQUIRE_REVIEW'
            : decision === POLICY_DECISIONS.ALLOW_WITH_CONTROLS
              ? 'PROCEED_WITH_CONTROLS'
              : 'PROCEED_TO_GOVERNED_EXECUTION',

      highestSeverity:
        highest,

      confidence,

      rationale:
        decisionAggregate.rationale,

      policy:
        this._publicPolicySummary(
          policy,
        ),

      findingSummary:
        this._summarizeFindings(
          findings,
        ),

      findings:
        findings.slice(
          0,
          this.config.maxFindings,
        ),

      appliedRules:
        findings
          .filter(
            (finding) =>
              finding.result
              !== RULE_RESULTS.NOT_APPLICABLE,
          )
          .map(
            (finding) => ({
              ruleId:
                finding.ruleId,

              ruleVersion:
                finding.ruleVersion,

              result:
                finding.result,

              outcome:
                finding.configuredOutcome,

              severity:
                finding.severity,
            }),
          ),

      controls:
        uniqueControls,

      missingEvidence:
        findings
          .filter(
            (finding) =>
              finding.result
              === RULE_RESULTS.UNKNOWN,
          )
          .flatMap(
            (finding) =>
              finding.assertions
                .filter(
                  (assertion) =>
                    assertion.exists
                    === false,
                )
                .map(
                  (assertion) =>
                    assertion.path,
                ),
          )
          .slice(
            0,
            100,
          ),

      governance: {
        makerCheckerRequired:
          decision === POLICY_DECISIONS.BLOCK
          || decision === POLICY_DECISIONS.REQUIRE_REVIEW
          || isFinancialContext(context),

        approvalRequired:
          decision === POLICY_DECISIONS.REQUIRE_REVIEW
          || (
            isFinancialContext(context)
            && (
              decision
              === POLICY_DECISIONS.ALLOW_WITH_CONTROLS
            )
          ),

        policyApprovalPresent:
          Boolean(
            policy.approvedAt
            || policy.approvedBy,
          ),

        policyMode:
          policy.mode,

        advisoryOnly:
          usability.advisoryOnly,
      },

      safety: {
        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        decisionAuthority:
          'POLICY_EVALUATION_ONLY',

        executionAuthorizationRequired:
          isFinancialContext(context)
          && decision
            !== POLICY_DECISIONS.BLOCK,

        originalIdempotencyKeyPreserved:
          Boolean(
            context.originalIdempotencyKey,
          ),
      },

      diagnostics: {
        applicableRuleCount:
          findings.filter(
            (finding) =>
              finding.result
              !== RULE_RESULTS.NOT_APPLICABLE,
          ).length,

        evaluatedRuleCount:
          sortedRules.filter(
            (rule) => rule.enabled,
          ).length,

        blockFindingCount:
          decisionAggregate.blockFindings.length,

        reviewFindingCount:
          decisionAggregate.reviewFindings.length,

        controlFindingCount:
          decisionAggregate.controlFindings.length,

        policyFingerprint:
          policy.policyFingerprint,

        resolverConfigured:
          Boolean(this.policyResolver),

        repositoryConfigured:
          Boolean(this.policyRepository),
      },
    };

    this._metric(
      'policy_evaluated_total',
      {
        operation:
          context.operation,

        decision,

        riskLevel:
          context.riskLevel
          ?? 'UNKNOWN',
      },
    );

    return deepFreeze(
      result,
    );
  }

  async evaluateGovernance(
    input = {},
    options = {},
  ) {
    return this.evaluate(
      input,
      options,
    );
  }

  async evaluateDecision(
    input = {},
    options = {},
  ) {
    return this.evaluate(
      input,
      options,
    );
  }

  async assess(
    input = {},
    options = {},
  ) {
    return this.evaluate(
      input,
      options,
    );
  }

  async preview(
    input = {},
  ) {
    return this.evaluate(
      input,
      {
        mode:
          POLICY_MODES.PREVIEW,
      },
    );
  }

  async evaluateAdvisory(
    input = {},
  ) {
    return this.evaluate(
      input,
      {
        mode:
          POLICY_MODES.ADVISORY,
      },
    );
  }

  validatePolicyPack(
    policyPack,
  ) {
    const policy =
      normalizePolicyPack(
        policyPack,
        this.config,
      );

    const errors = [];
    const warnings = [];

    if (!policy.rules.length) {
      warnings.push(
        'Policy pack contains no rules.',
      );
    }

    if (
      !policy.approvedAt
      && !policy.approvedBy
      && policy.status
      === POLICY_STATUSES.ACTIVE
    ) {
      warnings.push(
        'ACTIVE policy pack does not carry explicit approval metadata.',
      );
    }

    if (
      isFinancialContext({
        operation:
          policy.operation?.[0]
          ?? 'COLLECTION',
      })
      && policy.defaultDecision
      === POLICY_DECISIONS.ALLOW
    ) {
      warnings.push(
        'Financial-impact policy has ALLOW as its default; callers should require explicit matching allow rules.',
      );
    }

    return deepFreeze({
      valid:
        errors.length === 0,

      errors,

      warnings,

      policy: this._publicPolicySummary(
        policy,
      ),
    });
  }

  async diffPolicyPacks(
    leftPolicyPack,
    rightPolicyPack,
  ) {
    const left =
      normalizePolicyPack(
        leftPolicyPack,
        this.config,
      );

    const right =
      normalizePolicyPack(
        rightPolicyPack,
        this.config,
      );

    const leftRules =
      new Map(
        left.rules.map(
          (rule) => [
            rule.ruleId,
            rule,
          ],
        ),
      );

    const rightRules =
      new Map(
        right.rules.map(
          (rule) => [
            rule.ruleId,
            rule,
          ],
        ),
      );

    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];

    for (const [ruleId, rule] of rightRules) {
      const previous = leftRules.get(
        ruleId,
      );

      if (!previous) {
        added.push(ruleId);
        continue;
      }

      const before = sha256(previous);
      const after = sha256(rule);

      if (before === after) {
        unchanged.push(ruleId);
      } else {
        changed.push({
          ruleId,
          before,
          after,
        });
      }
    }

    for (const ruleId of leftRules.keys()) {
      if (!rightRules.has(ruleId)) {
        removed.push(ruleId);
      }
    }

    return deepFreeze({
      left: {
        packId:
          left.packId,

        version:
          left.version,

        fingerprint:
          left.policyFingerprint,
      },

      right: {
        packId:
          right.packId,

        version:
          right.version,

        fingerprint:
          right.policyFingerprint,
      },

      changed: {
        added,
        removed,
        changed,
        unchanged,
      },

      policyLevelChanges: {
        statusChanged:
          left.status
          !== right.status,

        modeChanged:
          left.mode
          !== right.mode,

        defaultDecisionChanged:
          left.defaultDecision
          !== right.defaultDecision,

        scopeChanged:
          sha256({
            tenantId:
              left.tenantId,
            country:
              left.country,
            jurisdiction:
              left.jurisdiction,
            operation:
              left.operation,
            productType:
              left.productType,
            channel:
              left.channel,
          })
          !== sha256({
            tenantId:
              right.tenantId,
            country:
              right.country,
            jurisdiction:
              right.jurisdiction,
            operation:
              right.operation,
            productType:
              right.productType,
            channel:
              right.channel,
          }),
      },
    });
  }

  buildAuditEnvelope(
    result,
    {
      actor = null,
      eventType = 'POLICY_DECISION_EVALUATED',
    } = {},
  ) {
    if (
      !result
      || typeof result !== 'object'
    ) {
      throw new AirtelDecisionPolicyError(
        POLICY_ERROR_CODES.INVALID_INPUT,
        'result is required to build a policy audit envelope.',
      );
    }

    const normalizedActor =
      actor
        ? {
          actorId:
            normalizeString(
              actor.actorId
                ?? actor.userId
                ?? actor.id,
              160,
            ),

          role:
            upper(
              actor.role
                ?? actor.actorRole,
              100,
            ),

          tenantId:
            normalizeString(
              actor.tenantId,
              160,
            ),
        }
        : undefined;

    const auditFingerprint = sha256({
      eventType,
      tenantId:
        result.tenantId
        ?? null,
      decisionId:
        result.decisionId
        ?? null,
      decisionFingerprint:
        result.decisionFingerprint
        ?? null,
      policyFingerprint:
        result.policyFingerprint
        ?? null,
    });

    return deepFreeze({
      eventType:
        upper(
          eventType,
          160,
        ),

      eventId:
        auditFingerprint.slice(
          0,
          40,
        ),

      auditFingerprint,

      tenantId:
        result.tenantId
        ?? null,

      provider:
        result.provider
        ?? PROVIDER,

      operation:
        result.operation
        ?? null,

      decisionId:
        result.decisionId
        ?? null,

      decision:
        result.decision
        ?? null,

      severity:
        result.highestSeverity
        ?? 'INFO',

      decisionFingerprint:
        result.decisionFingerprint
        ?? null,

      policyFingerprint:
        result.policyFingerprint
        ?? null,

      actor:
        normalizedActor,

      findings:
        (result.findings ?? [])
          .slice(0, 100)
          .map((finding) => ({
            code:
              finding.code,

            ruleId:
              finding.ruleId,

            ruleVersion:
              finding.ruleVersion,

            result:
              finding.result,

            outcome:
              finding.configuredOutcome
                ?? finding.outcome,

            severity:
              finding.severity,

            reasonCode:
              finding.reasonCode,
          })),

      generatedAt:
        this._now(),
    });
  }

  _publicPolicySummary(policy) {
    if (!policy) return null;

    return {
      packId:
        policy.packId,

      version:
        policy.version,

      tenantId:
        policy.tenantId
        ?? null,

      provider:
        policy.provider,

      status:
        policy.status,

      mode:
        policy.mode,

      priority:
        policy.priority,

      fingerprint:
        policy.policyFingerprint,

      authority:
        policy.authority
        ?? null,

      effectiveFrom:
        policy.effectiveFrom
        ?? null,

      effectiveTo:
        policy.effectiveTo
        ?? null,

      approvedAt:
        policy.approvedAt
        ?? null,

      approvedBy:
        policy.approvedBy
        ?? null,

      defaultDecision:
        policy.defaultDecision,

      ruleCount:
        policy.rules.length,
    };
  }

  _summarizeFindings(findings) {
    const counts = {
      total:
        findings.length,

      pass:
        0,

      fail:
        0,

      unknown:
        0,

      error:
        0,

      notApplicable:
        0,

      block:
        0,

      review:
        0,

      controls:
        0,
    };

    for (const finding of findings) {
      if (finding.result === RULE_RESULTS.PASS) counts.pass += 1;
      if (finding.result === RULE_RESULTS.FAIL) counts.fail += 1;
      if (finding.result === RULE_RESULTS.UNKNOWN) counts.unknown += 1;
      if (finding.result === RULE_RESULTS.ERROR) counts.error += 1;
      if (finding.result === RULE_RESULTS.NOT_APPLICABLE) counts.notApplicable += 1;

      if (
        finding.configuredOutcome
        === RULE_OUTCOMES.BLOCK
      ) counts.block += 1;

      if (
        finding.configuredOutcome
        === RULE_OUTCOMES.REVIEW
        || finding.configuredOutcome
        === RULE_OUTCOMES.REQUIRE_EVIDENCE
      ) counts.review += 1;

      if (
        finding.configuredOutcome
        === RULE_OUTCOMES.ALLOW_WITH_CONTROLS
        || finding.configuredOutcome
        === RULE_OUTCOMES.REPORT
      ) counts.controls += 1;
    }

    return counts;
  }

  _calculateConfidence(
    findings,
    decision,
  ) {
    if (!findings.length) {
      return decision === POLICY_DECISIONS.NO_POLICY
        ? 0
        : null;
    }

    const applicable = findings.filter(
      (finding) =>
        finding.result
        !== RULE_RESULTS.NOT_APPLICABLE,
    );

    if (!applicable.length) return 0;

    const deterministic = applicable.filter(
      (finding) =>
        finding.result
        !== RULE_RESULTS.UNKNOWN
        && finding.result
        !== RULE_RESULTS.ERROR,
    ).length;

    const evidenceCompleteness =
      deterministic / applicable.length;

    let base = 0.70 + (0.25 * evidenceCompleteness);

    if (
      decision === POLICY_DECISIONS.BLOCK
    ) {
      base = Math.max(
        base,
        0.90,
      );
    }

    if (
      decision === POLICY_DECISIONS.REQUIRE_REVIEW
    ) {
      base = Math.min(
        base,
        0.85,
      );
    }

    return Number(
      Math.min(
        1,
        Math.max(0, base),
      ).toFixed(4),
    );
  }

  _noPolicyMessage(reason) {
    const messages = {
      NO_APPLICABLE_POLICY:
        'No applicable policy pack was available for the decision context.',

      POLICY_NOT_ACTIVE:
        'A matching policy pack exists but is not active/approved for enforcement.',

      POLICY_NOT_EFFECTIVE:
        'A matching policy pack exists but is not yet within its effective window.',

      POLICY_EXPIRED:
        'A matching policy pack exists but its effective window has expired.',

      POLICY_SCOPE_MISMATCH:
        'Available policy scope does not match the decision context.',
    };

    return messages[reason]
      ?? 'Policy evaluation could not establish an enforceable policy outcome.';
  }

  _safeError(error) {
    if (!error) return null;

    return {
      name:
        error.name
        ?? 'Error',

      code:
        error.code
        ?? null,

      message:
        normalizeString(
          error.message
            ?? 'Unknown error',
          400,
        ),

      retryable:
        Boolean(error.retryable),
    };
  }

  _log(
    level,
    message,
    context = {},
  ) {
    const method =
      this.logger?.[level]
      ?? this.logger?.info;

    if (typeof method !== 'function') return;

    try {
      method.call(
        this.logger,
        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          ...sanitize(
            context,
            '',
            0,
            this.config,
          ),
        },
        message,
      );
    } catch {
      // Logging must never affect policy evaluation.
    }
  }

  _metric(
    name,
    labels = {},
  ) {
    try {
      const metric =
        this.metrics?.[name]
        ?? this.metrics?.increment
        ?? this.metrics?.counter;

      if (typeof metric !== 'function') return;

      if (
        metric === this.metrics.increment
        || metric === this.metrics.counter
      ) {
        metric.call(
          this.metrics,
          name,
          sanitize(
            labels,
            '',
            0,
            this.config,
          ),
        );
      } else {
        metric.call(
          this.metrics,
          sanitize(
            labels,
            '',
            0,
            this.config,
          ),
        );
      }
    } catch {
      // Metrics must never affect policy evaluation.
    }
  }

  async health() {
    let repository = null;

    if (
      this.policyRepository
      && typeof this.policyRepository.healthCheck
      === 'function'
    ) {
      try {
        repository = await this.policyRepository.healthCheck();
      } catch (error) {
        repository = {
          ok: false,
          error: this._safeError(error),
        };
      }
    }

    const configured = Boolean(
      this.defaultPolicyPack
      || this.policyRepository
      || this.policyResolver,
    );

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      healthy:
        configured
        && repository?.ok !== false,

      policyConfigured:
        configured,

      policyResolverConfigured:
        Boolean(
          this.policyResolver,
        ),

      policyRepositoryConfigured:
        Boolean(
          this.policyRepository,
        ),

      defaultPolicyConfigured:
        Boolean(
          this.defaultPolicyPack,
        ),

      productionSafety: {
        tenantRequired:
          this.config.requireTenantId,

        airtelProviderEnforced:
          this.config.enforceAirtelProvider,

        financialPolicyRequired:
          this.config.requirePolicyForFinancialImpact,

        activePolicyRequired:
          this.config.requireActivePolicy,

        failClosedOnPolicyRepositoryError:
          this.config.failClosedOnPolicyRepositoryError,

        failClosedOnRuleError:
          this.config.failClosedOnRuleError,
      },

      repository,
    });
  }

  async readiness() {
    return this.health();
  }

  getComponentInfo() {
    return Object.freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      responsibilities:
        'Versioned deterministic Airtel payment decision-policy evaluation',

      writesFinancialLedger:
        false,

      mutatesBalances:
        false,

      callsProviderApis:
        false,

      grantsExecutionAuthorization:
        false,

      authoritativeFinancialBoundary:
        'TITECH_FINANCIAL_CORE',
    });
  }
}

export function createDecisionPolicyEngine(
  options = {},
) {
  return new AirtelDecisionPolicyEngine(
    options,
  );
}

export const createAirtelDecisionPolicyEngine =
  createDecisionPolicyEngine;

export const AirtelPaymentDecisionPolicyEngine =
  AirtelDecisionPolicyEngine;

export default AirtelDecisionPolicyEngine;

export const constants = Object.freeze({
  ENGINE_NAME,
  ENGINE_VERSION,
  COMPONENT,
  PROVIDER,
  SCHEMA_VERSION,
});