'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Command Center Orchestrator
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/operations/commandCenterOrchestrator.js
 *
 * Purpose:
 *   Enterprise-grade command and decision orchestration for Airtel payment
 *   operations. Composes regulatory, retry, recommendation and reconciliation
 *   intelligence into a deterministic operational control plane while keeping
 *   provider calls, persistence and financial mutation behind authoritative
 *   service boundaries.
 *
 * Architectural Position:
 *
 *   HTTP / Worker / Provider Callback / Offline Sync
 *                         |
 *                         v
 *                Command Center Orchestrator
 *                  /        |         \
 *                 /         |          \
 *                v          v           v
 *          Regulatory     Retry      Recommendation
 *          Intelligence Intelligence  Intelligence
 *                 \          |          /
 *                  \         |         /
 *                   +--------+--------+
 *                            |
 *                            v
 *                 Reconciliation / Repair
 *                            |
 *                            v
 *                       Command Plan
 *                            |
 *                            v
 *                    Payment Orchestrator
 *                            |
 *                            v
 *                       Airtel Adapter
 *                            |
 *                            v
 *                       Financial Core
 *                       Transaction/Ledger
 *
 * RESPONSIBILITIES
 * ----------------
 * - Normalize and validate operational commands.
 * - Preserve tenant/provider/payment identity and original idempotency context.
 * - Coordinate regulatory, retry, route recommendation, reconciliation and repair
 *   intelligence.
 * - Convert intelligence outputs into explicit deterministic command plans.
 * - Apply safety gates before delegated provider actions.
 * - Distinguish execution, status-check, reconciliation, repair, sync and review.
 * - Treat offline local states as non-final until server-authoritative processing.
 * - Revalidate financial command plans before delegated execution.
 * - Enforce maker-checker for governed financial actions.
 * - Produce deterministic command fingerprints and tenant-scoped command keys.
 * - Produce safe audit envelopes and structured diagnostics.
 * - Remain stateless and concurrency-safe.
 *
 * NON-RESPONSIBILITIES / IMPORTANT BOUNDARIES
 * --------------------------------------------
 * - Does NOT call Airtel APIs directly.
 * - Does NOT write MongoDB, Redis or other persistence records.
 * - Does NOT mutate balances, wallets, transactions or ledger entries.
 * - Does NOT itself perform Financial Core posting.
 * - Does NOT replace the canonical resilience/circuit-breaker layer.
 * - Does NOT override regulatory BLOCK or reconciliation conflict decisions.
 * - Does NOT blindly retry an ambiguous financial operation.
 * - Does NOT generate a new financial identity for a provider retry.
 * - Does NOT treat a command plan as proof of settlement.
 *
 * FINANCIAL SAFETY PRINCIPLES
 * ---------------------------
 * - Original financial idempotency identity is preserved on retry.
 * - Provider/financial success prevents duplicate execution.
 * - Ambiguous outcome => status check / reconciliation before replay.
 * - Offline queue states are not final settlement.
 * - Financial posting remains authoritative in TITech Financial Core.
 * - Commercial failure after financial posting is a reconciliation condition.
 * - Execution must pass tenant, identity, compliance and approval gates.
 *
 * MODULE FORMAT
 * -------------
 * TITech backend uses ESM semantics. This file uses native ESM and Node built-ins
 * only; no new runtime dependency is introduced.
 *
 * =============================================================================
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-command-center-orchestrator';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';

export const COMMANDS = Object.freeze([
  'INITIATE',
  'RETRY',
  'STATUS_CHECK',
  'RECONCILE',
  'REPAIR',
  'SETTLE',
  'REFUND',
  'REVERSE',
  'CANCEL',
  'SYNC_OFFLINE',
  'REVIEW',
]);

export const OPERATIONS = Object.freeze([
  'COLLECTION',
  'DISBURSEMENT',
  'REFUND',
  'REVERSAL',
  'STATUS',
]);

export const COMMAND_STATES = Object.freeze([
  'RECEIVED',
  'VALIDATING',
  'INTELLIGENCE_EVALUATED',
  'PLANNED',
  'READY',
  'EXECUTING',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
  'REVIEW_REQUIRED',
  'RECONCILIATION_REQUIRED',
  'NO_ACTION',
  'DEFERRED',
]);

export const ACTIONS = Object.freeze([
  'EXECUTE_OPERATION',
  'RETRY',
  'STATUS_CHECK',
  'RECONCILE',
  'CREATE_REPAIR_PLAN',
  'EXECUTE_REPAIR_PLAN',
  'SETTLE_THROUGH_FINANCIAL_CORE',
  'REQUIRE_REVIEW',
  'BLOCK',
  'DEFER_SYNC',
  'NO_ACTION',
]);

export const OFFLINE_STATES = Object.freeze([
  'LOCAL_ONLY',
  'PENDING_SYNC',
  'SYNCING',
  'SERVER_ACCEPTED',
  'SERVER_REJECTED',
  'CONFLICT',
  'REQUIRES_REVIEW',
  'CONFIRMED',
]);

export const DECISIONS = Object.freeze([
  'EXECUTE',
  'RETRY',
  'STATUS_CHECK',
  'RECONCILE',
  'REPAIR',
  'REVIEW',
  'BLOCK',
  'DEFER',
  'NO_ACTION',
]);

export const EXECUTION_MODES = Object.freeze([
  'PLAN_ONLY',
  'DELEGATED',
]);

export const SEVERITIES = Object.freeze([
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const MAKER_CHECKER_STATES = Object.freeze([
  'NOT_REQUIRED',
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

const FINANCIAL_COMMANDS = new Set([
  'INITIATE',
  'RETRY',
  'SETTLE',
  'REFUND',
  'REVERSE',
  'CANCEL',
]);

const FINANCIAL_IMPACTING_ACTIONS = new Set([
  'EXECUTE_OPERATION',
  'RETRY',
  'EXECUTE_REPAIR_PLAN',
  'SETTLE_THROUGH_FINANCIAL_CORE',
]);

const SUCCESS_STATUSES = new Set([
  'SUCCESS',
  'SUCCEEDED',
  'COMPLETED',
  'SETTLED',
  'PAID',
]);

const TERMINAL_FAILURE_STATUSES = new Set([
  'FAILED',
  'FAILURE',
  'DECLINED',
  'REJECTED',
  'CANCELLED',
  'CANCELED',
  'EXPIRED',
]);

const AMBIGUOUS_STATUSES = new Set([
  'UNKNOWN',
  'TIMEOUT',
  'NO_RESPONSE',
  'PENDING_UNKNOWN',
]);

const PENDING_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'INITIATED',
  'SUBMITTED',
  'QUEUED',
]);

const DEFAULT_POLICY = Object.freeze({
  providerScope: PROVIDER,
  requireTenantId: true,
  requirePaymentIdentityForFinancialCommands: true,
  requireOriginalIdempotencyKeyForRetry: true,
  requireActorForExecution: true,
  requireMakerCheckerForFinancialActions: true,
  requireRevalidationForFinancialExecution: true,
  failClosedOnRegulatoryUnavailable: true,
  failClosedOnReconciliationUnavailable: false,
  maxCommandSteps: 20,
  maxDiagnostics: 100,
  maxMetadataKeys: 50,
  integrationTimeoutMs: 5000,
  executionTimeoutMs: 30000,
  maxClockSkewMs: 5 * 60 * 1000,
  allowOfflineExecution: false,
});

export class AirtelCommandCenterError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AirtelCommandCenterError';
    this.code = options.code || 'AIRTEL_COMMAND_CENTER_ERROR';
    this.statusCode = options.statusCode || 500;
    this.details = Object.freeze({ ...(options.details || {}) });
    this.cause = options.cause || null;
    Error.captureStackTrace?.(this, AirtelCommandCenterError);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepClone(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const output = [];
    seen.set(value, output);
    for (const item of value) output.push(deepClone(item, seen));
    return output;
  }

  if (!isPlainObject(value)) return String(value);

  const output = {};
  seen.set(value, output);
  for (const [key, item] of Object.entries(value)) {
    output[key] = deepClone(item, seen);
  }
  return output;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function integer(value, fallback = null) {
  const numeric = finiteNumber(value, fallback);
  return numeric === null ? null : Math.trunc(numeric);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeString(value, field, maxLength = 256, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  if (!normalized) return fallback;

  if (normalized.length > maxLength) {
    throw new AirtelCommandCenterError(
      `${field} exceeds the maximum allowed length.`,
      {
        code: 'COMMAND_FIELD_TOO_LONG',
        statusCode: 422,
        details: { field, maxLength },
      },
    );
  }

  return normalized;
}

function upper(value, field, fallback = null, maxLength = 128) {
  const normalized = normalizeString(value, field, maxLength, fallback);
  return normalized ? normalized.toUpperCase() : fallback;
}

function normalizeEnum(value, field, allowed, fallback = null) {
  const normalized = upper(value, field, fallback);
  if (!normalized) return fallback;
  if (!allowed.includes(normalized)) {
    throw new AirtelCommandCenterError(
      `${field} has an unsupported value.`,
      {
        code: 'COMMAND_ENUM_INVALID',
        statusCode: 422,
        details: { field, value: normalized, allowed },
      },
    );
  }
  return normalized;
}

function normalizeDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AirtelCommandCenterError(
      `${field} must be a valid date.`,
      {
        code: 'COMMAND_DATE_INVALID',
        statusCode: 422,
        details: { field },
      },
    );
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
  return createHash('sha256')
    .update(stableSerialize(value))
    .digest('hex');
}

function sanitizeMetadata(metadata, maxKeys = 50) {
  if (!isPlainObject(metadata)) return {};

  const blocked = new Set([
    'password',
    'passwd',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'authorization',
    'cookie',
    'pin',
    'otp',
    'cvv',
    'cvc',
    'pan',
    'cardNumber',
    'rawProviderResponse',
    'requestBody',
    'responseBody',
  ]);

  const result = {};
  let count = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (count >= maxKeys) break;
    if (blocked.has(key)) continue;
    if (key.length > 128) continue;
    result[key] = deepClone(value);
    count += 1;
  }

  return result;
}

function safeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || null,
    message: String(error.message || 'Unknown error').slice(0, 400),
    statusCode: integer(error.statusCode, null),
  };
}

function normalizeActor(actor) {
  if (!isPlainObject(actor)) return null;

  const actorId = normalizeString(
    actor.actorId ?? actor.userId ?? actor.id,
    'actor.actorId',
    256,
    null,
  );

  if (!actorId) return null;

  return {
    actorId,
    actorType: upper(actor.actorType, 'actor.actorType', 'SYSTEM', 80),
    tenantId: normalizeString(actor.tenantId, 'actor.tenantId', 128, null),
    role: upper(actor.role, 'actor.role', null, 120),
  };
}

function normalizeApproval(approval) {
  if (!isPlainObject(approval)) return null;

  return {
    approvalId: normalizeString(approval.approvalId, 'approval.approvalId', 256, null),
    approverId: normalizeString(approval.approverId, 'approval.approverId', 256, null),
    approved: approval.approved === true,
    decision: upper(approval.decision, 'approval.decision', null, 40),
    approvedAt: normalizeDate(approval.approvedAt, 'approval.approvedAt'),
    scopeFingerprint: normalizeString(
      approval.scopeFingerprint,
      'approval.scopeFingerprint',
      128,
      null,
    ),
  };
}

function normalizeProviderStatus(value) {
  return upper(value, 'providerStatus', 'UNKNOWN', 100);
}

function normalizePaymentIdentity(input) {
  return normalizeString(
    input.paymentId ??
      input.transactionId ??
      input.payment?._id ??
      input.payment?.id,
    'paymentId',
    256,
    null,
  );
}

function normalizeOriginalIdempotencyKey(input) {
  return normalizeString(
    input.idempotencyKey ??
      input.paymentIdempotencyKey ??
      input.originalIdempotencyKey ??
      input.payment?.idempotencyKey,
    'idempotencyKey',
    255,
    null,
  );
}

function inferCommand(input) {
  if (input.command) {
    return normalizeEnum(
      input.command,
      'command',
      COMMANDS,
      null,
    );
  }

  const explicitAction = upper(
    input.action,
    'action',
    null,
    100,
  );

  if (explicitAction === 'STATUS_CHECK') return 'STATUS_CHECK';
  if (explicitAction === 'RECONCILE') return 'RECONCILE';
  if (explicitAction === 'RETRY') return 'RETRY';
  if (explicitAction === 'REPAIR') return 'REPAIR';

  const eventType = upper(
    input.eventType ?? input.event,
    'eventType',
    null,
    120,
  );

  if (eventType?.includes('RECONC')) return 'RECONCILE';
  if (eventType?.includes('STATUS')) return 'STATUS_CHECK';
  if (eventType?.includes('RETRY')) return 'RETRY';
  if (eventType?.includes('REFUND')) return 'REFUND';
  if (eventType?.includes('REVERS')) return 'REVERSE';
  if (eventType?.includes('CANCEL')) return 'CANCEL';
  if (eventType?.includes('SETTLE')) return 'SETTLE';

  const outcome = upper(
    input.outcome,
    'outcome',
    null,
    80,
  );

  if (outcome === 'AMBIGUOUS') return 'STATUS_CHECK';
  if (outcome === 'PENDING') return 'STATUS_CHECK';
  if (outcome === 'FAILURE') return 'RETRY';

  return 'INITIATE';
}

function normalizeContext(input = {}) {
  if (!isPlainObject(input)) {
    throw new AirtelCommandCenterError(
      'Command center input must be a plain object.',
      {
        code: 'COMMAND_INPUT_INVALID',
        statusCode: 422,
      },
    );
  }

  const command = inferCommand(input);

  const operation = normalizeEnum(
    input.operation,
    'operation',
    OPERATIONS,
    command === 'REFUND'
      ? 'REFUND'
      : command === 'REVERSE'
        ? 'REVERSAL'
        : ['STATUS_CHECK', 'RECONCILE', 'REPAIR', 'REVIEW'].includes(command)
          ? 'STATUS'
          : 'COLLECTION',
  );

  const context = {
    command,
    operation,
    tenantId: normalizeString(input.tenantId, 'tenantId', 128, null),
    provider: upper(input.provider, 'provider', PROVIDER, 80),

    paymentId: normalizePaymentIdentity(input),
    transactionId: normalizeString(input.transactionId, 'transactionId', 256, null),
    idempotencyKey: normalizeOriginalIdempotencyKey(input),

    attemptNumber: clamp(
      integer(input.attemptNumber ?? input.retryAttempt, 0),
      0,
      100,
    ),

    providerStatus: normalizeProviderStatus(input.providerStatus),
    paymentStatus: normalizeProviderStatus(input.paymentStatus ?? input.localStatus),
    financialStatus: normalizeProviderStatus(input.financialStatus),
    outcome: upper(input.outcome, 'outcome', null, 80),

    responseReceived: input.responseReceived !== false,
    responseTimedOut: input.responseTimedOut === true,
    outcomeKnown: input.outcomeKnown !== false,

    offlineState: input.offlineState
      ? normalizeEnum(input.offlineState, 'offlineState', OFFLINE_STATES, null)
      : null,

    startedAt: normalizeDate(input.startedAt, 'startedAt'),
    lastAttemptAt: normalizeDate(input.lastAttemptAt, 'lastAttemptAt'),
    deadlineAt: normalizeDate(input.deadlineAt, 'deadlineAt'),

    actor: normalizeActor(input.actor),
    approval: normalizeApproval(input.approval),

    providerSignals: isPlainObject(input.providerSignals ?? input.health)
      ? sanitizeMetadata(input.providerSignals ?? input.health, 30)
      : {},

    error: isPlainObject(input.error)
      ? sanitizeMetadata(input.error, 30)
      : {},

    statusResponse: isPlainObject(input.statusResponse)
      ? sanitizeMetadata(input.statusResponse, 30)
      : {},

    reconciliation: isPlainObject(input.reconciliation)
      ? sanitizeMetadata(input.reconciliation, 30)
      : null,

    regulatory: isPlainObject(input.regulatory)
      ? sanitizeMetadata(input.regulatory, 30)
      : null,

    recommendation: isPlainObject(input.recommendation)
      ? sanitizeMetadata(input.recommendation, 30)
      : null,

    prediction: isPlainObject(input.prediction)
      ? sanitizeMetadata(input.prediction, 20)
      : null,

    learning: isPlainObject(input.learning)
      ? sanitizeMetadata(input.learning, 20)
      : null,

    payment: isPlainObject(input.payment)
      ? sanitizeMetadata(input.payment, 50)
      : {},

    metadata: sanitizeMetadata(input.metadata, DEFAULT_POLICY.maxMetadataKeys),
  };

  return deepFreeze(context);
}

function isFinancialCommand(command) {
  return FINANCIAL_COMMANDS.has(command);
}

function isFinancialImpactingAction(action) {
  return FINANCIAL_IMPACTING_ACTIONS.has(action);
}

function providerOutcome(context) {
  const providerStatus = normalizeProviderStatus(context.providerStatus);

  if (
    SUCCESS_STATUSES.has(providerStatus) ||
    SUCCESS_STATUSES.has(context.paymentStatus) ||
    SUCCESS_STATUSES.has(context.financialStatus)
  ) {
    return 'SUCCESS';
  }

  if (PENDING_STATUSES.has(providerStatus)) return 'PENDING';

  if (
    AMBIGUOUS_STATUSES.has(providerStatus) ||
    context.outcomeKnown === false ||
    context.responseTimedOut
  ) {
    return 'AMBIGUOUS';
  }

  if (TERMINAL_FAILURE_STATUSES.has(providerStatus)) return 'FAILURE';

  return context.outcome || 'UNKNOWN';
}

function highestSeverity(items = []) {
  return items.reduce(
    (current, item) => {
      const severity = item?.severity || 'INFO';
      return (SEVERITY_RANK[severity] ?? 0) > (SEVERITY_RANK[current] ?? 0)
        ? severity
        : current;
    },
    'INFO',
  );
}

function normalizeEngineResult(result) {
  return isPlainObject(result) ? result : null;
}

function extractDecision(result, fallback = null) {
  if (!result) return fallback;
  return upper(
    result.decision ?? result.action ?? result.status,
    'engineDecision',
    fallback,
    100,
  );
}

function extractReason(result, fallback = '') {
  return String(
    result?.reason ??
      result?.message ??
      result?.recommendedAction ??
      fallback,
  ).slice(0, 800);
}

function commandFingerprint(context, intelligence = {}) {
  return sha256({
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,
    tenantId: context.tenantId,
    provider: context.provider,
    command: context.command,
    operation: context.operation,
    paymentId: context.paymentId,
    transactionId: context.transactionId,
    idempotencyKey: context.idempotencyKey,
    attemptNumber: context.attemptNumber,
    providerStatus: context.providerStatus,
    paymentStatus: context.paymentStatus,
    financialStatus: context.financialStatus,
    outcome: providerOutcome(context),
    offlineState: context.offlineState,
    regulatory: context.regulatory
      ? {
          decision: context.regulatory.decision,
          decisionId: context.regulatory.decisionId,
        }
      : null,
    reconciliation: context.reconciliation
      ? {
          status: context.reconciliation.status,
          fingerprint: context.reconciliation.fingerprint,
        }
      : null,
    retry: intelligence.retry
      ? {
          decision: intelligence.retry.decision,
          decisionId: intelligence.retry.decisionId,
        }
      : null,
    recommendation: intelligence.recommendation
      ? {
          action: intelligence.recommendation.action,
          provider: intelligence.recommendation.provider,
        }
      : null,
  });
}

function commandIdempotencyKey(context, commandId) {
  if (context.idempotencyKey) {
    return `airtel-command:${String(context.tenantId).toLowerCase()}:${context.idempotencyKey}:${context.command}:${commandId}`;
  }

  return `airtel-command:${String(context.tenantId).toLowerCase()}:${context.command}:${context.paymentId || 'none'}:${commandId}`;
}

function safeFinancialIdentity(context) {
  return {
    tenantId: context.tenantId,
    provider: context.provider,
    operation: context.operation,
    paymentId: context.paymentId,
    transactionId: context.transactionId,
    idempotencyKey: context.idempotencyKey,
  };
}

function approvalIsValid(context, plan) {
  if (!plan.makerChecker.required) return true;

  const actor = context.actor;
  const approval = context.approval;

  if (!actor?.actorId) return false;
  if (!approval?.approvalId) return false;
  if (!approval?.approverId) return false;
  if (approval.approved !== true) return false;
  if (actor.actorId === approval.approverId) return false;

  if (
    approval.scopeFingerprint &&
    approval.scopeFingerprint !== plan.planFingerprint
  ) {
    return false;
  }

  return true;
}

function inferOfflineAction(context) {
  switch (context.offlineState) {
    case 'LOCAL_ONLY':
    case 'PENDING_SYNC':
    case 'SYNCING':
      return 'DEFER_SYNC';
    case 'CONFLICT':
    case 'REQUIRES_REVIEW':
    case 'SERVER_REJECTED':
      return 'REVIEW';
    default:
      return null;
  }
}

// =============================================================================
// Command Center
// =============================================================================

export class AirtelCommandCenterOrchestrator {
  constructor(options = {}) {
    const supplied = isPlainObject(options) ? options : {};
    const configuredPolicy = isPlainObject(supplied.policy) ? supplied.policy : {};

    this.config = deepFreeze({
      ...DEFAULT_POLICY,
      ...configuredPolicy,
      providerScope: upper(
        supplied.providerScope ?? configuredPolicy.providerScope,
        'providerScope',
        PROVIDER,
        80,
      ),
    });

    if (this.config.providerScope !== PROVIDER) {
      throw new AirtelCommandCenterError(
        'Command center is scoped to AIRTEL.',
        {
          code: 'COMMAND_PROVIDER_SCOPE_INVALID',
          statusCode: 500,
        },
      );
    }

    this.clock = typeof supplied.clock === 'function'
      ? supplied.clock
      : () => Date.now();

    this.logger = isObject(supplied.logger) ? supplied.logger : null;
    this.metrics = isObject(supplied.metrics) ? supplied.metrics : null;

    this.retryIntelligence = supplied.retryIntelligence || null;
    this.recommendationEngine = supplied.recommendationEngine || null;
    this.regulatoryIntelligence = supplied.regulatoryIntelligence || null;
    this.reconciliationEngine = supplied.reconciliationEngine || null;
    this.reconciliationRepairEngine = supplied.reconciliationRepairEngine || null;
    this.providerHealth = supplied.providerHealth || null;

    this.executor =
      supplied.executor ||
      supplied.paymentOrchestrator ||
      supplied.executionAdapter ||
      null;
  }

  health() {
    return Object.freeze({
      success: true,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      providerScope: this.config.providerScope,
      ready: true,
      stateless: true,
      integrations: Object.freeze({
        retryIntelligence: Boolean(this.retryIntelligence),
        recommendationEngine: Boolean(this.recommendationEngine),
        regulatoryIntelligence: Boolean(this.regulatoryIntelligence),
        reconciliationEngine: Boolean(this.reconciliationEngine),
        reconciliationRepairEngine: Boolean(this.reconciliationRepairEngine),
        providerHealth: Boolean(this.providerHealth),
        executor: Boolean(this.executor),
        logger: Boolean(this.logger),
        metrics: Boolean(this.metrics),
      }),
    });
  }

  planSync(input = {}) {
    const now = nowDate(this.clock);
    const context = normalizeContext(input);
    const validation = this.#validateContext(context);

    if (!validation.valid) {
      return this.#buildPlan({
        context,
        now,
        decision: validation.decision,
        state: validation.state,
        action: validation.action,
        severity: validation.severity,
        reason: validation.reason,
        findings: validation.findings,
        intelligence: {},
      });
    }

    const findings = [...validation.findings];
    const intelligence = {};
    const offlineAction = inferOfflineAction(context);

    if (offlineAction === 'DEFER_SYNC') {
      findings.push({
        code: 'OFFLINE_NOT_SERVER_AUTHORITY',
        severity: 'HIGH',
        message:
          'The payment remains in a local/offline state and is not final settlement.',
      });

      return this.#buildPlan({
        context,
        now,
        decision: 'DEFER',
        state: 'DEFERRED',
        action: 'DEFER_SYNC',
        severity: 'HIGH',
        reason:
          'Offline state must be processed by the server-authoritative synchronization protocol before provider or financial execution.',
        findings,
        intelligence,
      });
    }

    if (offlineAction === 'REVIEW') {
      findings.push({
        code: 'OFFLINE_CONFLICT_REVIEW_REQUIRED',
        severity: 'CRITICAL',
        message:
          'Offline state indicates conflict/review and cannot be replayed as an ordinary payment operation.',
      });

      return this.#buildPlan({
        context,
        now,
        decision: 'REVIEW',
        state: 'REVIEW_REQUIRED',
        action: 'REQUIRE_REVIEW',
        severity: 'CRITICAL',
        reason:
          'Offline synchronization conflict requires controlled review.',
        findings,
        intelligence,
      });
    }

    const outcome = providerOutcome(context);

    if (outcome === 'SUCCESS') {
      findings.push({
        code: 'AUTHORITATIVE_SUCCESS_PRECEDENCE',
        severity: 'CRITICAL',
        message:
          'Current provider/commercial/financial state indicates success; duplicate financial execution is prohibited.',
      });

      return this.#buildPlan({
        context,
        now,
        decision: 'NO_ACTION',
        state: 'NO_ACTION',
        action: 'NO_ACTION',
        severity: 'CRITICAL',
        reason:
          'Existing successful/settled state makes another financial operation unsafe.',
        findings,
        intelligence,
      });
    }

    if (context.regulatory) {
      intelligence.regulatory = normalizeEngineResult(context.regulatory);
    }

    if (this.regulatoryIntelligence) {
      const result = this.#invokeSyncEngine(
        this.regulatoryIntelligence,
        ['analyzeSync', 'evaluateSync'],
        this.#regulatoryPayload(context),
      );

      if (result.result) intelligence.regulatory = result.result;

      if (result.error && this.config.failClosedOnRegulatoryUnavailable) {
        findings.push({
          code: 'REGULATORY_ENGINE_UNAVAILABLE',
          severity: 'CRITICAL',
          message:
            'Regulatory intelligence could not be evaluated and policy requires fail-closed behavior.',
        });

        return this.#buildPlan({
          context,
          now,
          decision: 'REVIEW',
          state: 'REVIEW_REQUIRED',
          action: 'REQUIRE_REVIEW',
          severity: 'CRITICAL',
          reason:
            'Regulatory intelligence is unavailable.',
          findings,
          intelligence,
        });
      }
    }

    const regulatoryDecision = extractDecision(
      intelligence.regulatory,
      null,
    );

    if (
      ['BLOCK', 'DENY', 'REJECT'].includes(regulatoryDecision) ||
      intelligence.regulatory?.blocked === true
    ) {
      findings.push({
        code: 'REGULATORY_BLOCK',
        severity: 'CRITICAL',
        message:
          'Regulatory intelligence blocks the requested operational action.',
      });

      return this.#buildPlan({
        context,
        now,
        decision: 'BLOCK',
        state: 'BLOCKED',
        action: 'BLOCK',
        severity: 'CRITICAL',
        reason: extractReason(
          intelligence.regulatory,
          'Regulatory intelligence blocked the operation.',
        ),
        findings,
        intelligence,
      });
    }

    if (
      ['REVIEW', 'NO_POLICY'].includes(regulatoryDecision) ||
      intelligence.regulatory?.reviewRequired === true
    ) {
      findings.push({
        code: 'REGULATORY_REVIEW_REQUIRED',
        severity: 'HIGH',
        message:
          'Regulatory intelligence requires review before operational execution.',
      });

      return this.#buildPlan({
        context,
        now,
        decision: 'REVIEW',
        state: 'REVIEW_REQUIRED',
        action: 'REQUIRE_REVIEW',
        severity: 'HIGH',
        reason: extractReason(
          intelligence.regulatory,
          'Regulatory review is required.',
        ),
        findings,
        intelligence,
      });
    }

    if (context.reconciliation) {
      intelligence.reconciliation = normalizeEngineResult(context.reconciliation);
    }

    const reconciliationRequired =
      ['RECONCILE', 'REPAIR', 'STATUS_CHECK'].includes(context.command) ||
      outcome === 'AMBIGUOUS' ||
      outcome === 'PENDING';

    if (this.reconciliationEngine && reconciliationRequired) {
      const result = this.#invokeSyncEngine(
        this.reconciliationEngine,
        ['reconcileSync', 'analyzeSync'],
        this.#reconciliationPayload(context),
      );

      if (result.result) intelligence.reconciliation = result.result;

      if (
        result.error &&
        this.config.failClosedOnReconciliationUnavailable
      ) {
        findings.push({
          code: 'RECONCILIATION_ENGINE_UNAVAILABLE',
          severity: 'CRITICAL',
          message:
            'Reconciliation intelligence is unavailable and policy requires fail-closed behavior.',
        });

        return this.#buildPlan({
          context,
          now,
          decision: 'REVIEW',
          state: 'RECONCILIATION_REQUIRED',
          action: 'RECONCILE',
          severity: 'CRITICAL',
          reason:
            'Reconciliation could not be established.',
          findings,
          intelligence,
        });
      }
    }

    const reconciliationDecision = extractDecision(
      intelligence.reconciliation,
      null,
    );

    const reconciliationStatus = upper(
      intelligence.reconciliation?.status,
      'reconciliation.status',
      null,
      100,
    );

    if (
      intelligence.reconciliation?.contradiction === true ||
      ['BLOCKED', 'CONFLICT', 'MISMATCH'].includes(reconciliationStatus) ||
      reconciliationDecision === 'BLOCK'
    ) {
      findings.push({
        code: 'RECONCILIATION_CONFLICT',
        severity: 'CRITICAL',
        message:
          'Reconciliation evidence is contradictory or blocked.',
      });

      return this.#buildPlan({
        context,
        now,
        decision: 'RECONCILE',
        state: 'RECONCILIATION_REQUIRED',
        action: 'RECONCILE',
        severity: 'CRITICAL',
        reason:
          'Current provider/local/financial evidence requires reconciliation.',
        findings,
        intelligence,
      });
    }

    if (context.command === 'RECONCILE') {
      return this.#buildPlan({
        context,
        now,
        decision: 'RECONCILE',
        state: 'READY',
        action: 'RECONCILE',
        severity: 'INFO',
        reason:
          'Explicit reconciliation command is ready for delegated operations processing.',
        findings,
        intelligence,
      });
    }

    if (context.command === 'STATUS_CHECK') {
      return this.#buildPlan({
        context,
        now,
        decision: 'STATUS_CHECK',
        state: 'READY',
        action: 'STATUS_CHECK',
        severity: 'INFO',
        reason:
          'Provider status verification is ready.',
        findings,
        intelligence,
      });
    }

    if (context.command === 'REPAIR') {
      const repair = this.#buildRepairPlanSync(context);
      intelligence.repair = repair.result || repair;

      if (repair.blocked) {
        findings.push({
          code: repair.code,
          severity: 'CRITICAL',
          message: repair.reason,
        });

        return this.#buildPlan({
          context,
          now,
          decision: 'REVIEW',
          state: 'REVIEW_REQUIRED',
          action: 'REQUIRE_REVIEW',
          severity: 'CRITICAL',
          reason: repair.reason,
          findings,
          intelligence,
        });
      }

      return this.#buildPlan({
        context,
        now,
        decision: 'REPAIR',
        state: 'READY',
        action: repair.action,
        severity: repair.severity,
        reason: repair.reason,
        findings,
        intelligence,
      });
    }

    if (context.command === 'SYNC_OFFLINE') {
      return this.#buildPlan({
        context,
        now,
        decision: 'DEFER',
        state: 'DEFERRED',
        action: 'DEFER_SYNC',
        severity: 'MEDIUM',
        reason:
          'Offline synchronization belongs to the server-authoritative synchronization workflow.',
        findings,
        intelligence,
      });
    }

    if (context.command === 'REVIEW') {
      return this.#buildPlan({
        context,
        now,
        decision: 'REVIEW',
        state: 'REVIEW_REQUIRED',
        action: 'REQUIRE_REVIEW',
        severity: 'HIGH',
        reason:
          'Explicit operational review command received.',
        findings,
        intelligence,
      });
    }

    if (context.command === 'RETRY') {
      if (!this.retryIntelligence) {
        return this.#buildPlan({
          context,
          now,
          decision: 'REVIEW',
          state: 'REVIEW_REQUIRED',
          action: 'REQUIRE_REVIEW',
          severity: 'HIGH',
          reason:
            'Safe retry determination requires the canonical retry intelligence engine.',
          findings: [
            ...findings,
            {
              code: 'RETRY_INTELLIGENCE_UNAVAILABLE',
              severity: 'HIGH',
              message:
                'Retry intelligence is not configured.',
            },
          ],
          intelligence,
        });
      }

      const retryResult = this.#invokeSyncEngine(
        this.retryIntelligence,
        ['analyzeSync', 'shouldRetry', 'createRetryPlanSync'],
        this.#retryPayload(context),
      );

      if (retryResult.result) intelligence.retry = retryResult.result;

      if (retryResult.error) {
        return this.#buildPlan({
          context,
          now,
          decision: 'REVIEW',
          state: 'REVIEW_REQUIRED',
          action: 'REQUIRE_REVIEW',
          severity: 'HIGH',
          reason:
            'Retry intelligence could not establish a safe retry decision.',
          findings: [
            ...findings,
            {
              code: 'RETRY_INTELLIGENCE_ERROR',
              severity: 'HIGH',
              message:
                'Retry intelligence evaluation failed.',
            },
          ],
          intelligence,
        });
      }

      const retryDecision = extractDecision(
        intelligence.retry,
        null,
      );

      if (
        retryDecision === 'RETRY' ||
        intelligence.retry?.retry === true
      ) {
        return this.#buildPlan({
          context,
          now,
          decision: 'RETRY',
          state: 'READY',
          action: 'RETRY',
          severity: 'INFO',
          reason: extractReason(
            intelligence.retry,
            'Retry is permitted by retry intelligence.',
          ),
          findings,
          intelligence,
        });
      }

      if (
        retryDecision === 'STATUS_CHECK' ||
        retryDecision === 'RECONCILE'
      ) {
        return this.#buildPlan({
          context,
          now,
          decision: retryDecision,
          state:
            retryDecision === 'RECONCILE'
              ? 'RECONCILIATION_REQUIRED'
              : 'READY',
          action:
            retryDecision === 'RECONCILE'
              ? 'RECONCILE'
              : 'STATUS_CHECK',
          severity: 'HIGH',
          reason: extractReason(
            intelligence.retry,
            'Retry intelligence requires status/reconciliation first.',
          ),
          findings,
          intelligence,
        });
      }

      return this.#buildPlan({
        context,
        now,
        decision: retryDecision === 'STOP' ? 'BLOCK' : 'REVIEW',
        state:
          retryDecision === 'STOP'
            ? 'BLOCKED'
            : 'REVIEW_REQUIRED',
        action:
          retryDecision === 'STOP'
            ? 'BLOCK'
            : 'REQUIRE_REVIEW',
        severity: 'HIGH',
        reason: extractReason(
          intelligence.retry,
          'Retry intelligence did not permit automatic retry.',
        ),
        findings,
        intelligence,
      });
    }

    if (
      ['INITIATE', 'SETTLE', 'REFUND', 'REVERSE', 'CANCEL'].includes(
        context.command,
      )
    ) {
      if (context.recommendation) {
        intelligence.recommendation = normalizeEngineResult(
          context.recommendation,
        );
      }

      if (
        !intelligence.recommendation &&
        this.recommendationEngine
      ) {
        const result = this.#invokeSyncEngine(
          this.recommendationEngine,
          ['recommendSync', 'scoreCandidate'],
          this.#recommendationPayload(context),
        );

        if (result.result) {
          intelligence.recommendation = result.result;
        }
      }

      const routeAction = upper(
        intelligence.recommendation?.action,
        'recommendation.action',
        null,
        100,
      );

      if (
        ['REQUIRE_REVIEW', 'DEFER', 'NO_ELIGIBLE_ROUTE'].includes(
          routeAction,
        )
      ) {
        findings.push({
          code: 'ROUTE_RECOMMENDATION_REVIEW',
          severity: 'HIGH',
          message:
            'Provider route recommendation does not permit direct execution.',
        });

        return this.#buildPlan({
          context,
          now,
          decision: 'REVIEW',
          state: 'REVIEW_REQUIRED',
          action: 'REQUIRE_REVIEW',
          severity: 'HIGH',
          reason:
            'Provider route recommendation requires operational review.',
          findings,
          intelligence,
        });
      }

      return this.#buildPlan({
        context,
        now,
        decision: 'EXECUTE',
        state: 'READY',
        action:
          context.command === 'SETTLE'
            ? 'SETTLE_THROUGH_FINANCIAL_CORE'
            : 'EXECUTE_OPERATION',
        severity: 'INFO',
        reason:
          'Command passed the configured intelligence gates and is ready for delegated payment orchestration.',
        findings,
        intelligence,
      });
    }

    return this.#buildPlan({
      context,
      now,
      decision: 'REVIEW',
      state: 'REVIEW_REQUIRED',
      action: 'REQUIRE_REVIEW',
      severity: 'HIGH',
      reason:
        'No safe command execution path was established.',
      findings,
      intelligence,
    });
  }

  async plan(input = {}) {
    const base = this.planSync(input);
    const diagnostics = [];
    let enrichedInput = { ...input };
    const context = normalizeContext(input);

    if (
      context.command === 'RETRY' &&
      this.retryIntelligence &&
      !base.intelligence?.retry
    ) {
      const result = await this.#invokeAsyncEngine(
        this.retryIntelligence,
        ['analyze', 'createRetryPlan'],
        this.#retryPayload(context),
      );
      diagnostics.push(result.diagnostic);
      if (result.result) enrichedInput.retry = result.result;
    }

    if (
      this.regulatoryIntelligence &&
      !base.intelligence?.regulatory
    ) {
      const result = await this.#invokeAsyncEngine(
        this.regulatoryIntelligence,
        ['analyze', 'evaluate'],
        this.#regulatoryPayload(context),
      );
      diagnostics.push(result.diagnostic);
      if (result.result) enrichedInput.regulatory = result.result;
    }

    if (
      this.reconciliationEngine &&
      !base.intelligence?.reconciliation &&
      ['STATUS_CHECK', 'RECONCILE', 'REPAIR'].includes(context.command)
    ) {
      const result = await this.#invokeAsyncEngine(
        this.reconciliationEngine,
        ['reconcile', 'analyze'],
        this.#reconciliationPayload(context),
      );
      diagnostics.push(result.diagnostic);
      if (result.result) enrichedInput.reconciliation = result.result;
    }

    if (
      this.recommendationEngine &&
      ['INITIATE', 'SETTLE', 'REFUND', 'REVERSE', 'CANCEL'].includes(
        context.command,
      )
    ) {
      const result = await this.#invokeAsyncEngine(
        this.recommendationEngine,
        ['recommend', 'recommendProvider'],
        this.#recommendationPayload(context),
      );
      diagnostics.push(result.diagnostic);
      if (result.result) enrichedInput.recommendation = result.result;
    }

    const enriched = this.planSync(enrichedInput);

    return deepFreeze({
      ...enriched,
      asyncIntegrationsAttempted: diagnostics.length > 0,
      integrationDiagnostics: diagnostics,
    });
  }

  async orchestrate(input = {}) {
    return this.plan(input);
  }

  orchestrateSync(input = {}) {
    return this.planSync(input);
  }

  async executePlan(plan, executionContext = {}) {
    if (!isPlainObject(plan)) {
      throw new AirtelCommandCenterError(
        'Command plan must be a plain object.',
        {
          code: 'COMMAND_PLAN_INVALID',
          statusCode: 422,
        },
      );
    }

    if (!this.executor) {
      throw new AirtelCommandCenterError(
        'No payment orchestrator executor is configured.',
        {
          code: 'COMMAND_EXECUTOR_UNAVAILABLE',
          statusCode: 503,
        },
      );
    }

    const context = normalizeContext({
      ...executionContext,
      tenantId: executionContext.tenantId ?? plan.tenantId,
      provider: executionContext.provider ?? plan.provider,
      command: executionContext.command ?? plan.command,
      operation: executionContext.operation ?? plan.operation,
      paymentId: executionContext.paymentId ?? plan.paymentId,
      transactionId: executionContext.transactionId ?? plan.transactionId,
      idempotencyKey: executionContext.idempotencyKey ?? plan.originalIdempotencyKey,
      attemptNumber: executionContext.attemptNumber ?? plan.attemptNumber,
      providerStatus: executionContext.providerStatus ?? plan.providerStatus,
      paymentStatus: executionContext.paymentStatus ?? plan.paymentStatus,
      financialStatus: executionContext.financialStatus ?? plan.financialStatus,
      offlineState: executionContext.offlineState ?? plan.offlineState,
      actor: executionContext.actor ?? plan.makerChecker?.maker,
      approval: executionContext.approval ?? plan.makerChecker?.checkerApproval,
    });

    if (context.tenantId !== plan.tenantId) {
      throw new AirtelCommandCenterError(
        'Command plan tenant scope does not match execution context.',
        {
          code: 'COMMAND_TENANT_SCOPE_MISMATCH',
          statusCode: 403,
        },
      );
    }

    if (context.provider !== this.config.providerScope) {
      throw new AirtelCommandCenterError(
        'Command plan provider scope does not match command center scope.',
        {
          code: 'COMMAND_PROVIDER_SCOPE_MISMATCH',
          statusCode: 422,
        },
      );
    }

    if (!this.config.allowOfflineExecution && context.offlineState) {
      const offlineAction = inferOfflineAction(context);
      if (offlineAction) {
        throw new AirtelCommandCenterError(
          'Offline state does not permit delegated financial execution.',
          {
            code: 'COMMAND_OFFLINE_EXECUTION_PROHIBITED',
            statusCode: 409,
          },
        );
      }
    }

    if (
      ['BLOCK', 'REVIEW', 'DEFER', 'NO_ACTION', 'RECONCILE'].includes(
        plan.decision,
      )
    ) {
      throw new AirtelCommandCenterError(
        `Command plan ${plan.decision} is not directly executable.`,
        {
          code: 'COMMAND_PLAN_NOT_EXECUTABLE',
          statusCode: 409,
          details: {
            decision: plan.decision,
            action: plan.action,
          },
        },
      );
    }

    if (
      this.config.requireActorForExecution &&
      !context.actor?.actorId
    ) {
      throw new AirtelCommandCenterError(
        'An identified actor is required for command execution.',
        {
          code: 'COMMAND_EXECUTION_ACTOR_REQUIRED',
          statusCode: 401,
        },
      );
    }

    if (
      isFinancialImpactingAction(plan.action) &&
      plan.makerChecker.required &&
      !approvalIsValid(context, plan)
    ) {
      throw new AirtelCommandCenterError(
        'Maker-checker approval is required and must be valid, scoped and distinct from the maker.',
        {
          code: 'COMMAND_MAKER_CHECKER_REQUIRED',
          statusCode: 403,
        },
      );
    }

    if (
      plan.action === 'RETRY' &&
      this.config.requireOriginalIdempotencyKeyForRetry &&
      !context.idempotencyKey
    ) {
      throw new AirtelCommandCenterError(
        'Financial retry execution requires the original idempotency key.',
        {
          code: 'COMMAND_RETRY_IDEMPOTENCY_REQUIRED',
          statusCode: 422,
        },
      );
    }

    let currentPlan = plan;
    let revalidated = null;

    if (
      this.config.requireRevalidationForFinancialExecution &&
      isFinancialImpactingAction(plan.action) &&
      executionContext.revalidate !== false
    ) {
      revalidated = this.planSync({
        ...executionContext,
        tenantId: context.tenantId,
        provider: context.provider,
        command: context.command,
        operation: context.operation,
        paymentId: context.paymentId,
        transactionId: context.transactionId,
        idempotencyKey: context.idempotencyKey,
        attemptNumber: context.attemptNumber,
        providerStatus: context.providerStatus,
        paymentStatus: context.paymentStatus,
        financialStatus: context.financialStatus,
        offlineState: context.offlineState,
        actor: context.actor,
        approval: context.approval,
      });

      if (
        !revalidated.planFingerprint ||
        revalidated.action !== plan.action ||
        revalidated.decision !== plan.decision
      ) {
        throw new AirtelCommandCenterError(
          'Command plan changed during revalidation; execution stopped.',
          {
            code: 'COMMAND_PLAN_STALE',
            statusCode: 409,
            details: {
              originalAction: plan.action,
              currentAction: revalidated.action,
              originalDecision: plan.decision,
              currentDecision: revalidated.decision,
            },
          },
        );
      }

      currentPlan = revalidated;

      if (
        currentPlan.makerChecker.required &&
        !approvalIsValid(context, currentPlan)
      ) {
        throw new AirtelCommandCenterError(
          'Maker-checker approval does not match the revalidated plan.',
          {
            code: 'COMMAND_REVALIDATED_APPROVAL_INVALID',
            statusCode: 403,
          },
        );
      }
    }

    const payload = {
      commandPlan: deepClone(currentPlan),
      executionContext: {
        ...safeFinancialIdentity(context),
        actor: context.actor,
        approval: context.approval,
        requestId: normalizeString(
          executionContext.requestId,
          'requestId',
          256,
          null,
        ),
        correlationId: normalizeString(
          executionContext.correlationId,
          'correlationId',
          256,
          null,
        ),
      },
      financialSafety: {
        originalIdempotencyKey: context.idempotencyKey,
        preserveOriginalIdempotencyKey: true,
        generateNewFinancialIdentity: false,
        writeLedgerHere: false,
        mutateBalanceHere: false,
        authoritativeBoundary: 'TITECH_FINANCIAL_CORE',
      },
    };

    const methodName = [
      'executeCommandPlan',
      'executePlan',
      'dispatch',
      'execute',
    ].find(
      name => typeof this.executor?.[name] === 'function',
    );

    if (!methodName) {
      throw new AirtelCommandCenterError(
        'Configured executor exposes no supported command execution method.',
        {
          code: 'COMMAND_EXECUTOR_METHOD_NOT_FOUND',
          statusCode: 503,
        },
      );
    }

    try {
      const result = await this.#withTimeout(
        Promise.resolve(this.executor[methodName](payload)),
        this.config.executionTimeoutMs,
      );

      this.#metricIncrement('airtel_command_center_execution_total');

      return deepFreeze({
        success: true,
        executed: true,
        method: methodName,
        commandId: currentPlan.commandId,
        planFingerprint: currentPlan.planFingerprint,
        revalidated: Boolean(revalidated),
        result,
      });
    } catch (error) {
      this.#metricIncrement('airtel_command_center_execution_failures_total');
      this.#log('error', {
        event: 'airtel_command_center_execution_failed',
        tenantId: context.tenantId,
        provider: context.provider,
        command: context.command,
        operation: context.operation,
        paymentId: context.paymentId,
        commandId: currentPlan.commandId,
        code: error?.code || 'COMMAND_EXECUTION_FAILED',
      });

      throw new AirtelCommandCenterError(
        'Delegated command execution failed.',
        {
          code: error?.code || 'COMMAND_EXECUTION_FAILED',
          statusCode: error?.statusCode || 502,
          details: {
            commandId: currentPlan.commandId,
            action: currentPlan.action,
          },
          cause: error,
        },
      );
    }
  }

  async executeCommand(plan, executionContext = {}) {
    return this.executePlan(plan, executionContext);
  }

  buildAuditEnvelope(
    plan,
    {
      actor = null,
      eventType = 'COMMAND_PLAN_GENERATED',
    } = {},
  ) {
    const normalizedActor = normalizeActor(actor);
    const auditFingerprint = sha256({
      eventType,
      commandId: plan?.commandId || null,
      planFingerprint: plan?.planFingerprint || null,
      tenantId: plan?.tenantId || null,
      provider: plan?.provider || null,
      action: plan?.action || null,
      decision: plan?.decision || null,
    }).slice(0, 40);

    return deepFreeze({
      eventType: normalizeString(
        eventType,
        'eventType',
        120,
        'COMMAND_PLAN_GENERATED',
      ),
      eventId: auditFingerprint,
      auditFingerprint,
      tenantId: plan?.tenantId || null,
      provider: plan?.provider || null,
      commandId: plan?.commandId || null,
      planFingerprint: plan?.planFingerprint || null,
      command: plan?.command || null,
      operation: plan?.operation || null,
      decision: plan?.decision || null,
      action: plan?.action || null,
      state: plan?.state || null,
      actor: normalizedActor,
      generatedAt: nowDate(this.clock).toISOString(),
    });
  }

  #validateContext(context) {
    const findings = [];

    if (this.config.requireTenantId && !context.tenantId) {
      findings.push({
        code: 'TENANT_REQUIRED',
        severity: 'CRITICAL',
        message: 'tenantId is required for command-center operations.',
      });

      return {
        valid: false,
        decision: 'REVIEW',
        state: 'REVIEW_REQUIRED',
        action: 'REQUIRE_REVIEW',
        severity: 'CRITICAL',
        reason: 'Tenant isolation cannot be established.',
        findings,
      };
    }

    if (context.provider !== this.config.providerScope) {
      findings.push({
        code: 'PROVIDER_SCOPE_MISMATCH',
        severity: 'CRITICAL',
        message: 'Provider does not match the Airtel command-center scope.',
      });

      return {
        valid: false,
        decision: 'BLOCK',
        state: 'BLOCKED',
        action: 'BLOCK',
        severity: 'CRITICAL',
        reason: 'Provider scope mismatch.',
        findings,
      };
    }

    if (
      isFinancialCommand(context.command) &&
      this.config.requirePaymentIdentityForFinancialCommands &&
      !context.paymentId &&
      context.command !== 'INITIATE'
    ) {
      findings.push({
        code: 'PAYMENT_IDENTITY_REQUIRED',
        severity: 'CRITICAL',
        message: 'A payment identity is required for this financial command.',
      });

      return {
        valid: false,
        decision: 'REVIEW',
        state: 'REVIEW_REQUIRED',
        action: 'REQUIRE_REVIEW',
        severity: 'CRITICAL',
        reason: 'Financial command cannot be safely scoped to a payment.',
        findings,
      };
    }

    if (
      context.command === 'RETRY' &&
      this.config.requireOriginalIdempotencyKeyForRetry &&
      !context.idempotencyKey
    ) {
      findings.push({
        code: 'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
        severity: 'CRITICAL',
        message: 'Retry requires the original payment idempotency key.',
      });

      return {
        valid: false,
        decision: 'REVIEW',
        state: 'REVIEW_REQUIRED',
        action: 'REQUIRE_REVIEW',
        severity: 'CRITICAL',
        reason: 'Safe retry cannot be established without original idempotency identity.',
        findings,
      };
    }

    if (
      context.deadlineAt &&
      nowDate(this.clock).getTime() >
        context.deadlineAt.getTime() +
          this.config.maxClockSkewMs
    ) {
      findings.push({
        code: 'COMMAND_DEADLINE_EXPIRED',
        severity: 'HIGH',
        message: 'Command deadline has already elapsed.',
      });

      return {
        valid: false,
        decision: 'BLOCK',
        state: 'BLOCKED',
        action: 'BLOCK',
        severity: 'HIGH',
        reason: 'Command deadline has elapsed.',
        findings,
      };
    }

    return {
      valid: true,
      decision: null,
      state: 'VALIDATING',
      action: null,
      severity: 'INFO',
      reason: null,
      findings,
    };
  }

  #buildPlan({
    context,
    now,
    decision,
    state,
    action,
    severity,
    reason,
    findings,
    intelligence,
  }) {
    const normalizedFindings = (findings || [])
      .slice(0, this.config.maxDiagnostics)
      .map(item => ({
        code: normalizeString(
          item.code,
          'finding.code',
          160,
          'UNKNOWN',
        ),
        severity: normalizeEnum(
          item.severity,
          'finding.severity',
          SEVERITIES,
          'INFO',
        ),
        message: String(
          item.message || 'No diagnostic message provided.',
        ).slice(0, 800),
      }));

    const effectiveSeverity =
      severity || highestSeverity(normalizedFindings);

    const financialAction = isFinancialImpactingAction(action);
    const makerCheckerRequired = Boolean(
      financialAction &&
        this.config.requireMakerCheckerForFinancialActions,
    );

    const intelligenceSummary = {
      regulatory: this.#engineSummary(intelligence?.regulatory),
      retry: this.#engineSummary(intelligence?.retry),
      reconciliation: this.#engineSummary(intelligence?.reconciliation),
      recommendation: this.#engineSummary(intelligence?.recommendation),
      repair: this.#engineSummary(intelligence?.repair),
    };

    const baseFingerprint = commandFingerprint(context, {
      retry: intelligence?.retry,
      recommendation: intelligence?.recommendation,
    });

    const planFingerprint = sha256({
      commandFingerprint: baseFingerprint,
      decision,
      state,
      action,
      findings: normalizedFindings,
      intelligence: intelligenceSummary,
      makerCheckerRequired,
    });

    const commandId = planFingerprint.slice(0, 40);

    const plan = {
      success: true,
      component: COMPONENT,
      engine: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,
      plannedAt: now.toISOString(),

      commandId,
      planFingerprint,
      idempotencyKey: commandIdempotencyKey(context, commandId),

      tenantId: context.tenantId,
      provider: context.provider,
      command: context.command,
      operation: context.operation,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      originalIdempotencyKey: context.idempotencyKey,

      providerStatus: context.providerStatus,
      paymentStatus: context.paymentStatus,
      financialStatus: context.financialStatus,
      offlineState: context.offlineState,

      decision,
      state,
      action,
      severity: effectiveSeverity,
      reason: String(reason || '').slice(0, 1000),

      executionMode: this.executor ? 'DELEGATED' : 'PLAN_ONLY',

      makerChecker: {
        required: makerCheckerRequired,
        state: makerCheckerRequired ? 'PENDING' : 'NOT_REQUIRED',
        maker: context.actor ? deepClone(context.actor) : null,
        checkerApproval: context.approval ? deepClone(context.approval) : null,
      },

      steps: this.#buildSteps({
        context,
        action,
        intelligence,
        commandId,
      }),

      findings: normalizedFindings,
      intelligence: intelligenceSummary,

      safety: {
        providerCallPerformed: false,
        financialMutationPerformed: false,
        ledgerMutationPerformed: false,
        newFinancialIdentityGenerated: false,
        localOfflineStateTreatedAsSettlement: false,
        authoritativeBoundary: 'TITECH_FINANCIAL_CORE',
      },

      invariants: [
        'Tenant isolation must remain intact.',
        'Original financial idempotency identity must be preserved on retry.',
        'Provider/financial success must prevent duplicate execution.',
        'Ambiguous financial outcome requires status verification or reconciliation.',
        'Regulatory BLOCK must stop execution.',
        'Ledger/balance mutations belong to the authoritative Financial Core.',
        'Command plan is orchestration guidance and not proof of settlement.',
      ],
    };

    if (plan.steps.length > this.config.maxCommandSteps) {
      throw new AirtelCommandCenterError(
        'Command plan exceeds the configured step limit.',
        {
          code: 'COMMAND_PLAN_TOO_MANY_STEPS',
          statusCode: 422,
        },
      );
    }

    return deepFreeze(plan);
  }

  #buildSteps({
    context,
    action,
    intelligence,
    commandId,
  }) {
    const steps = [];

    const add = ({
      stepId,
      type,
      description,
      authority,
      financialImpact = false,
      payload = {},
    }) => {
      steps.push({
        stepId,
        type,
        description,
        authority,
        financialImpact,
        required: true,
        payload: sanitizeMetadata(
          payload,
          this.config.maxMetadataKeys,
        ),
      });
    };

    if (intelligence?.regulatory) {
      add({
        stepId: `${commandId}:regulatory`,
        type: 'REGULATORY_GATE',
        description:
          'Confirm current regulatory intelligence gate before execution.',
        authority: 'REGULATORY_INTELLIGENCE',
        payload: {
          decision:
            intelligence.regulatory.decision ??
            intelligence.regulatory.action ??
            null,
          decisionId:
            intelligence.regulatory.decisionId ?? null,
        },
      });
    }

    if (action === 'RECONCILE') {
      add({
        stepId: `${commandId}:reconcile`,
        type: 'RECONCILIATION',
        description:
          'Submit current provider/local/financial evidence to the authoritative reconciliation workflow.',
        authority: 'RECONCILIATION_SERVICE',
        payload: {
          paymentId: context.paymentId,
          transactionId: context.transactionId,
          originalIdempotencyKey: context.idempotencyKey,
        },
      });
      return steps;
    }

    if (action === 'STATUS_CHECK') {
      add({
        stepId: `${commandId}:status`,
        type: 'PROVIDER_STATUS_CHECK',
        description:
          'Obtain authoritative provider status before financial replay.',
        authority: 'PAYMENT_ORCHESTRATOR',
        payload: {
          operation: 'STATUS',
          paymentId: context.paymentId,
          transactionId: context.transactionId,
          originalIdempotencyKey: context.idempotencyKey,
        },
      });
      return steps;
    }

    if (action === 'CREATE_REPAIR_PLAN') {
      add({
        stepId: `${commandId}:repair-plan`,
        type: 'REPAIR_PLAN',
        description:
          'Create a controlled reconciliation repair plan without directly mutating money.',
        authority: 'RECONCILIATION_REPAIR_INTELLIGENCE',
        payload: {
          paymentId: context.paymentId,
          transactionId: context.transactionId,
          originalIdempotencyKey: context.idempotencyKey,
        },
      });
      return steps;
    }

    if (action === 'RETRY') {
      add({
        stepId: `${commandId}:retry`,
        type: 'RETRY_PROVIDER_OPERATION',
        description:
          'Delegate a bounded Airtel retry using the original financial idempotency key.',
        authority: 'PAYMENT_ORCHESTRATOR',
        financialImpact: true,
        payload: {
          originalOperation: context.operation,
          paymentId: context.paymentId,
          originalIdempotencyKey: context.idempotencyKey,
          retryPlan:
            intelligence?.retry?.retry ??
            intelligence?.retry ??
            null,
        },
      });
      return steps;
    }

    if (action === 'SETTLE_THROUGH_FINANCIAL_CORE') {
      add({
        stepId: `${commandId}:settle`,
        type: 'FINANCIAL_SETTLEMENT',
        description:
          'Delegate settlement to the authoritative TITech Financial Core.',
        authority: 'TITECH_FINANCIAL_CORE',
        financialImpact: true,
        payload: {
          operation: context.operation,
          paymentId: context.paymentId,
          transactionId: context.transactionId,
          originalIdempotencyKey: context.idempotencyKey,
        },
      });
      return steps;
    }

    if (action === 'EXECUTE_REPAIR_PLAN') {
      add({
        stepId: `${commandId}:repair-execute`,
        type: 'CONTROLLED_REPAIR_EXECUTION',
        description:
          'Delegate an approved reconciliation repair through its authoritative service boundary.',
        authority: 'RECONCILIATION_REPAIR_SERVICE',
        financialImpact: true,
        payload: {
          paymentId: context.paymentId,
          transactionId: context.transactionId,
          originalIdempotencyKey: context.idempotencyKey,
          repairPlan: intelligence?.repair ?? null,
        },
      });
      return steps;
    }

    if (action === 'EXECUTE_OPERATION') {
      add({
        stepId: `${commandId}:execute`,
        type: 'PAYMENT_OPERATION',
        description:
          `Delegate ${context.command} / ${context.operation} to the canonical payment orchestrator.`,
        authority: 'PAYMENT_ORCHESTRATOR',
        financialImpact: isFinancialCommand(context.command),
        payload: {
          command: context.command,
          operation: context.operation,
          paymentId: context.paymentId,
          transactionId: context.transactionId,
          originalIdempotencyKey: context.idempotencyKey,
        },
      });
    }

    return steps;
  }

  #buildRepairPlanSync(context) {
    if (!this.reconciliationRepairEngine) {
      return {
        blocked: true,
        code: 'REPAIR_ENGINE_UNAVAILABLE',
        severity: 'CRITICAL',
        reason:
          'Controlled repair requires the reconciliation repair engine.',
        action: 'CREATE_REPAIR_PLAN',
      };
    }

    const payload = {
      tenantId: context.tenantId,
      provider: context.provider,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      providerSnapshot:
        context.payment?.provider ??
        context.statusResponse?.provider ??
        {},
      localSnapshot: context.payment,
      financialSnapshot: {
        status: context.financialStatus,
      },
      reconciliation: context.reconciliation,
    };

    const methodName = [
      'createRepairPlan',
      'previewRepair',
    ].find(
      name => typeof this.reconciliationRepairEngine?.[name] === 'function',
    );

    if (!methodName) {
      return {
        blocked: true,
        code: 'REPAIR_ENGINE_METHOD_NOT_FOUND',
        severity: 'CRITICAL',
        reason:
          'The configured repair engine exposes no supported planning method.',
        action: 'CREATE_REPAIR_PLAN',
      };
    }

    try {
      const result = this.reconciliationRepairEngine[methodName](payload);
      const blocked =
        result?.blocked === true ||
        result?.status === 'BLOCKED';
      const requiresApproval = result?.requiresApproval !== false;

      return {
        blocked,
        code: blocked
          ? 'REPAIR_PLAN_BLOCKED'
          : 'REPAIR_PLAN_CREATED',
        severity: blocked
          ? 'CRITICAL'
          : requiresApproval
            ? 'HIGH'
            : 'INFO',
        reason:
          result?.reason ||
          (blocked
            ? 'Repair evidence is not safe for execution.'
            : 'Controlled repair plan is available.'),
        action: requiresApproval
          ? 'CREATE_REPAIR_PLAN'
          : 'EXECUTE_REPAIR_PLAN',
        requiresApproval,
        result,
      };
    } catch (error) {
      return {
        blocked: true,
        code: error?.code || 'REPAIR_PLAN_CREATION_FAILED',
        severity: 'CRITICAL',
        reason:
          'Repair plan creation failed; no financial mutation is permitted.',
        action: 'CREATE_REPAIR_PLAN',
        error: safeError(error),
      };
    }
  }

  #retryPayload(context) {
    return {
      tenantId: context.tenantId,
      provider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      attemptNumber: context.attemptNumber,
      providerStatus: context.providerStatus,
      paymentStatus: context.paymentStatus,
      financialStatus: context.financialStatus,
      outcome: providerOutcome(context),
      responseReceived: context.responseReceived,
      responseTimedOut: context.responseTimedOut,
      outcomeKnown: context.outcomeKnown,
      error: context.error,
      providerSignals: context.providerSignals,
      reconciliation: context.reconciliation,
      regulatory: context.regulatory,
      prediction: context.prediction,
      learning: context.learning,
    };
  }

  #reconciliationPayload(context) {
    return {
      tenantId: context.tenantId,
      provider: context.provider,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      idempotencyKey: context.idempotencyKey,
      providerSnapshot: {
        status: context.providerStatus,
        paymentId: context.paymentId,
      },
      localSnapshot: {
        ...context.payment,
        status: context.paymentStatus,
      },
      financialSnapshot: {
        status: context.financialStatus,
        transactionId: context.transactionId,
      },
    };
  }

  #regulatoryPayload(context) {
    return {
      tenantId: context.tenantId,
      provider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      transaction: safeFinancialIdentity(context),
      evidence: {
        provider: {
          status: context.providerStatus,
        },
        local: {
          status: context.paymentStatus,
        },
        financial: {
          status: context.financialStatus,
        },
      },
      mode: 'ENFORCE',
    };
  }

  #recommendationPayload(context) {
    return {
      tenantId: context.tenantId,
      provider: context.provider,
      currentProvider: context.provider,
      operation: context.operation,
      paymentId: context.paymentId,
      transactionId: context.transactionId,
      amount: context.payment?.amount ?? null,
      currency: context.payment?.currency ?? null,
      channel: context.payment?.channel ?? null,
      country: context.payment?.country ?? null,
      candidates: [
        {
          provider: context.provider,
          routeId: context.payment?.routeId ?? null,
        },
      ],
    };
  }

  #engineSummary(result) {
    if (!result) return null;

    return {
      available: true,
      decision:
        result.decision ??
        result.action ??
        result.status ??
        null,
      decisionId:
        result.decisionId ??
        result.commandId ??
        result.repairId ??
        null,
      fingerprint:
        result.decisionFingerprint ??
        result.planFingerprint ??
        result.reconciliationFingerprint ??
        null,
      blocked: result.blocked === true,
      requiresApproval: result.requiresApproval === true,
    };
  }

  #invokeSyncEngine(engine, methodNames, payload) {
    for (const methodName of methodNames) {
      if (typeof engine?.[methodName] !== 'function') continue;

      try {
        return {
          result: normalizeEngineResult(engine[methodName](payload)),
          error: null,
          method: methodName,
        };
      } catch (error) {
        return {
          result: null,
          error,
          method: methodName,
        };
      }
    }

    return {
      result: null,
      error: new AirtelCommandCenterError(
        'Supported engine method was not found.',
        {
          code: 'COMMAND_ENGINE_METHOD_NOT_FOUND',
        },
      ),
      method: null,
    };
  }

  async #invokeAsyncEngine(engine, methodNames, payload) {
    for (const methodName of methodNames) {
      if (typeof engine?.[methodName] !== 'function') continue;

      try {
        const result = await this.#withTimeout(
          Promise.resolve(engine[methodName](payload)),
          this.config.integrationTimeoutMs,
        );

        return {
          result: normalizeEngineResult(result),
          error: null,
          diagnostic: {
            integration: engine.constructor?.name || 'unknown-engine',
            method: methodName,
            status: 'OK',
          },
        };
      } catch (error) {
        return {
          result: null,
          error,
          diagnostic: {
            integration: engine.constructor?.name || 'unknown-engine',
            method: methodName,
            status: 'FAILED',
            code: error?.code || 'COMMAND_ENGINE_FAILED',
          },
        };
      }
    }

    return {
      result: null,
      error: new AirtelCommandCenterError(
        'Supported async engine method was not found.',
        {
          code: 'COMMAND_ENGINE_METHOD_NOT_FOUND',
        },
      ),
      diagnostic: {
        integration: engine?.constructor?.name || 'unknown-engine',
        method: null,
        status: 'UNAVAILABLE',
        code: 'COMMAND_ENGINE_METHOD_NOT_FOUND',
      },
    };
  }

  async #withTimeout(promise, timeoutMs) {
    let timer;

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Command center integration timed out.');
        error.code = 'COMMAND_CENTER_INTEGRATION_TIMEOUT';
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([
        Promise.resolve(promise),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  #metricIncrement(name, value = 1) {
    try {
      if (typeof this.metrics?.increment === 'function') {
        this.metrics.increment(name, value);
        return;
      }
      if (typeof this.metrics?.inc === 'function') {
        this.metrics.inc(name, value);
        return;
      }
      this.metrics?.counter?.(name, value);
    } catch {
      // Observability failure must never change operational safety.
    }
  }

  #log(level, payload) {
    try {
      const logger = this.logger;
      if (!logger) return;
      const method = typeof logger[level] === 'function'
        ? logger[level]
        : logger.info;
      method?.call(logger, payload);
    } catch {
      // Logging failure must never change operational safety.
    }
  }
}

export function createCommandCenterOrchestrator(options = {}) {
  return new AirtelCommandCenterOrchestrator(options);
}

export const defaultCommandCenterOrchestrator =
  new AirtelCommandCenterOrchestrator();

export const commandCenterOrchestrator =
  defaultCommandCenterOrchestrator;

export {
  normalizeContext,
  providerOutcome,
  commandFingerprint,
  isFinancialCommand,
};

export default AirtelCommandCenterOrchestrator;